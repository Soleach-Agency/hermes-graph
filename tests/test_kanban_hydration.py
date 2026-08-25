from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import hermes_graph.hooks as hooks
import hermes_graph.storage as storage
from hermes_graph.kanban import hydrate_kanban


class KanbanHydrationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.projection = Path(self.temp_dir.name) / "events.sqlite3"
        self.board_count = 0
        self.path_patch = patch.object(storage, "database_path", lambda: self.projection)
        self.path_patch.start()

    def tearDown(self):
        self.path_patch.stop()
        self.temp_dir.cleanup()

    def board(self, rows: list[tuple], links: list[tuple[str, str]] = ()) -> Path:
        self.board_count += 1
        path = Path(self.temp_dir.name) / f"kanban-{self.board_count}.db"
        conn = sqlite3.connect(path)
        try:
            conn.executescript(
                """
                CREATE TABLE tasks (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    body TEXT,
                    assignee TEXT,
                    status TEXT NOT NULL,
                    block_kind TEXT
                );
                CREATE TABLE task_links (
                    parent_id TEXT NOT NULL,
                    child_id TEXT NOT NULL,
                    PRIMARY KEY (parent_id, child_id)
                );
                """
            )
            conn.executemany(
                "INSERT INTO tasks(id, title, body, assignee, status, block_kind) VALUES (?, ?, ?, ?, ?, ?)",
                rows,
            )
            conn.executemany(
                "INSERT INTO task_links(parent_id, child_id) VALUES (?, ?)", links
            )
            conn.commit()
        finally:
            conn.close()
        return path

    def test_hydrates_visible_tasks_and_dependency_topology_without_private_bodies(self):
        board = self.board(
            [
                ("parent", "Parent", "private parent body", "terra", "todo", None),
                ("child", "Child", "private child body", "luna", "blocked", "needs_input"),
                ("hidden", "Archived", "private archived body", "luna", "archived", None),
            ],
            [("parent", "child")],
        )

        result = hydrate_kanban(board)
        snapshot = storage.get_snapshot()
        nodes = {node["id"]: node for node in snapshot["nodes"]}
        parent = hooks._id("task", "parent")
        child = hooks._id("task", "child")
        edges = {edge["id"]: edge for edge in snapshot["edges"]}

        self.assertEqual(result, {"hydratedTasks": 2, "stores": 1})
        self.assertEqual(nodes[parent]["label"], "Parent")
        self.assertEqual(nodes[parent]["metadata"], {"assignee": "terra", "provenance": "kanban"})
        self.assertEqual(nodes[child]["status"], "blocked")
        self.assertEqual(nodes[child]["metadata"]["blockKind"], "needs_input")
        self.assertNotIn(hooks._id("task", "hidden"), nodes)
        self.assertEqual(edges[f"depends:{child}:{parent}"]["kind"], "depends_on")
        self.assertEqual(edges[f"depends:{child}:{parent}"]["source"], child)
        self.assertEqual(edges[f"depends:{child}:{parent}"]["target"], parent)
        self.assertEqual(edges[f"blocked:{child}:{parent}"]["kind"], "blocked_by")
        self.assertTrue(all("private" not in str(event["payload"]) for event in storage.get_events(0)))

    def test_repeated_hydration_is_idempotent_and_replayable(self):
        board = self.board([("task", "Todo", "secret", "luna", "todo", None)])

        hydrate_kanban(board)
        first_snapshot = storage.get_snapshot()
        first_events = storage.get_events(0)
        hydrate_kanban(board)

        self.assertEqual(storage.get_snapshot(), first_snapshot)
        self.assertEqual(storage.get_events(0), first_events)
        self.assertEqual(storage.get_snapshot_at(first_snapshot["cursor"]), first_snapshot)

    def test_live_claim_hook_updates_hydrated_task_identity_and_wins_over_stale_hydration(self):
        board = self.board([("task", "Todo", "secret", "luna", "todo", None)])
        hydrate_kanban(board)
        hydrated_cursor = storage.get_snapshot()["cursor"]
        hooks.make_observer("kanban_task_claimed")(task_id="task", title="Todo", assignee="luna")
        claimed_cursor = storage.get_snapshot()["cursor"]

        hydrate_kanban(self.board([]))
        nodes = {node["id"]: node for node in storage.get_snapshot()["nodes"]}
        task = hooks._id("task", "task")

        self.assertEqual(nodes[task]["status"], "doing")
        self.assertEqual(len([node for node in nodes.values() if node["id"] == task]), 1)
        self.assertEqual(
            {node["id"]: node["status"] for node in storage.get_snapshot_at(hydrated_cursor)["nodes"]}[task],
            "todo",
        )
        self.assertEqual(
            {node["id"]: node["status"] for node in storage.get_snapshot_at(claimed_cursor)["nodes"]}[task],
            "doing",
        )

    def test_reconciles_only_stale_kanban_owned_entities(self):
        board = self.board([("task", "Todo", "secret", None, "todo", None)])
        hydrate_kanban(board)
        hooks.project("on_session_start", {"session_id": "session-1", "title": "Live"})

        hydrate_kanban(self.board([]))
        ids = {node["id"] for node in storage.get_snapshot()["nodes"]}

        self.assertNotIn(hooks._id("task", "task"), ids)
        self.assertIn(hooks._id("session", "session-1"), ids)

    def test_unsupported_schema_is_safely_omitted(self):
        path = Path(self.temp_dir.name) / "unsupported.db"
        conn = sqlite3.connect(path)
        try:
            conn.execute("CREATE TABLE unrelated (id TEXT PRIMARY KEY)")
            conn.commit()
        finally:
            conn.close()

        self.assertEqual(hydrate_kanban(path), {"hydratedTasks": 0, "stores": 0})
        self.assertEqual(storage.get_snapshot()["nodes"], [])


if __name__ == "__main__":
    unittest.main()
