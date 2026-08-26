from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import hermes_graph.hooks as hooks
import hermes_graph.storage as storage
from hermes_graph.hydration import hydrate_runtime


class RuntimeHydrationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.path = Path(self.temp_dir.name) / "events.sqlite3"
        self.path_patch = patch.object(storage, "database_path", lambda: self.path)
        self.path_patch.start()

    def tearDown(self):
        self.path_patch.stop()
        self.temp_dir.cleanup()

    def runtime_store(self, name: str, rows: list[tuple]) -> Path:
        path = Path(self.temp_dir.name) / f"{name}.db"
        conn = sqlite3.connect(path)
        try:
            conn.executescript(
                """
                CREATE TABLE sessions (
                    id TEXT PRIMARY KEY,
                    source TEXT NOT NULL,
                    model TEXT,
                    model_config TEXT,
                    parent_session_id TEXT,
                    started_at REAL NOT NULL,
                    ended_at REAL,
                    end_reason TEXT,
                    input_tokens INTEGER,
                    output_tokens INTEGER,
                    title TEXT,
                    system_prompt TEXT
                );
                """
            )
            conn.executemany(
                """
                INSERT INTO sessions(
                    id, source, model, model_config, parent_session_id, started_at,
                    ended_at, end_reason, input_tokens, output_tokens, title, system_prompt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            conn.commit()
        finally:
            conn.close()
        return path

    def test_hydrates_supported_sessions_agents_and_explicit_parentage(self):
        runtime = self.runtime_store(
            "luna",
            [
                (
                    "root-1", "cli", "model-a", "{}", None, 10.0, None, None,
                    120, 30, "Main session", "must never be read",
                ),
                (
                    "child-1", "cli", "model-b", '{"_delegate_from":"root-1"}',
                    "root-1", 11.0, 12.0, "done", 40, 10, "Research", "private prompt",
                ),
            ],
        )

        result = hydrate_runtime({"luna": runtime})
        snapshot = storage.get_snapshot()
        nodes = {node["id"]: node for node in snapshot["nodes"]}
        root_session = hooks._id("session", "root-1")
        child_session = hooks._id("session", "child-1")
        root_agent = hooks._id("agent", "root-1")
        child_agent = hooks._id("agent", "child-1")

        self.assertEqual(result["hydratedSessions"], 2)
        self.assertEqual(nodes[root_session]["status"], "active")
        self.assertEqual(nodes[child_session]["status"], "completed")
        self.assertEqual(nodes[root_agent]["metadata"]["profile"], "luna")
        self.assertEqual(nodes[root_agent]["metadata"]["inputTokens"], 120)
        self.assertIsNone(nodes[root_agent]["pressure"])
        self.assertEqual(nodes[child_agent]["kind"], "subagent")
        self.assertTrue(
            any(
                edge["kind"] == "parent_session"
                and edge["source"] == root_session
                and edge["target"] == child_session
                for edge in snapshot["edges"]
            )
        )
        self.assertTrue(
            all("prompt" not in str(event["payload"]).lower() for event in storage.get_events(0))
        )

    def test_unsupported_or_empty_store_is_ignored(self):
        empty = self.runtime_store("empty", [])
        unsupported = Path(self.temp_dir.name) / "unsupported.db"
        conn = sqlite3.connect(unsupported)
        try:
            conn.execute("CREATE TABLE unrelated (id TEXT PRIMARY KEY)")
            conn.commit()
        finally:
            conn.close()

        empty_result = hydrate_runtime({"default": empty})
        result = hydrate_runtime({"default": unsupported})

        self.assertEqual(empty_result, {"hydratedSessions": 0, "stores": 1})
        self.assertEqual(result, {"hydratedSessions": 0, "stores": 0})
        self.assertEqual(storage.get_snapshot()["nodes"], [])
        self.assertEqual(storage.get_events(0), [])

    def test_repeated_hydration_creates_no_duplicate_projection_or_replay_events(self):
        runtime = self.runtime_store(
            "default",
            [("session-1", "cli", "model", "{}", None, 1.0, None, None, 2, 3, "One", "private")],
        )

        hydrate_runtime({"default": runtime})
        first_snapshot = storage.get_snapshot()
        first_events = storage.get_events(0)
        hydrate_runtime({"default": runtime})

        self.assertEqual(storage.get_snapshot(), first_snapshot)
        self.assertEqual(storage.get_events(0), first_events)
        historical = storage.get_snapshot_at(first_snapshot["cursor"])
        self.assertEqual(historical["nodes"], first_snapshot["nodes"])
        self.assertEqual(historical["edges"], first_snapshot["edges"])

    def test_hydrates_explicit_parentage_across_profile_stores(self):
        root = self.runtime_store(
            "default",
            [("root-1", "cli", "model-a", "{}", None, 1.0, None, None, 2, 3, "One", "private")],
        )
        child = self.runtime_store(
            "luna",
            [
                (
                    "child-1", "cli", "model-b", '{"_delegate_from":"root-1"}',
                    "root-1", 2.0, None, None, 4, 5, "Two", "private",
                )
            ],
        )

        hydrate_runtime({"default": root, "luna": child})
        edges = storage.get_snapshot()["edges"]
        root_session = hooks._id("session", "root-1")
        child_session = hooks._id("session", "child-1")
        root_agent = hooks._id("agent", "root-1")
        child_agent = hooks._id("agent", "child-1")

        self.assertTrue(
            any(
                edge["kind"] == "parent_session"
                and edge["source"] == root_session
                and edge["target"] == child_session
                for edge in edges
            )
        )
        self.assertTrue(
            any(
                edge["kind"] == "spawned"
                and edge["source"] == root_agent
                and edge["target"] == child_agent
                for edge in edges
            )
        )

    def test_stale_hydration_does_not_delete_a_subsequent_live_hook_node(self):
        runtime = self.runtime_store(
            "default",
            [("session-1", "cli", "model", "{}", None, 1.0, None, None, 2, 3, "One", "private")],
        )
        hydrate_runtime({"default": runtime})
        hooks.project("on_session_start", {"session_id": "session-1", "platform": "cli"})

        hydrate_runtime({})
        nodes = {node["id"]: node for node in storage.get_snapshot()["nodes"]}

        self.assertIn(hooks._id("session", "session-1"), nodes)
        self.assertNotIn(hooks._id("agent", "runtime:default:session-1"), nodes)


if __name__ == "__main__":
    unittest.main()
