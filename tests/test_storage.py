from __future__ import annotations

import tempfile
import unittest
import os
from pathlib import Path
from unittest.mock import patch

import hermes_graph.storage as storage


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.path = Path(self.temp_dir.name) / "events.sqlite3"
        self.path_patch = patch.object(storage, "database_path", lambda: self.path)
        self.path_patch.start()

    def tearDown(self):
        self.path_patch.stop()
        self.temp_dir.cleanup()

    def test_snapshot_and_cursor(self):
        sequence = storage.record_event(
            "session.started", {"session_id": "s-1"}, session_id="s-1"
        )
        storage.upsert_node("session:s-1", "session", "Session 1", status="active")
        storage.upsert_node("tool:web", "tool", "Web", status="observed")
        storage.upsert_edge(
            "called:s-1:web", "session:s-1", "tool:web", "called"
        )

        snapshot = storage.get_snapshot()
        self.assertEqual(snapshot["cursor"], sequence)
        self.assertEqual(len(snapshot["nodes"]), 2)
        self.assertEqual(snapshot["edges"][0]["kind"], "called")
        self.assertEqual(storage.get_events(0)[0]["type"], "session.started")

    def test_event_ids_are_idempotent(self):
        first = storage.record_event("tool.started", {}, event_id="fixed")
        second = storage.record_event("tool.started", {}, event_id="fixed")

        self.assertEqual(first, second)
        self.assertEqual(len(storage.get_events(0)), 1)

    def test_historical_snapshot_replays_scene_mutations(self):
        first = storage.record_event(
            "scene.node_upsert",
            {
                "node": {
                    "id": "agent:1",
                    "kind": "agent",
                    "label": "Agent",
                    "status": "active",
                    "color": None,
                    "size": None,
                    "pressure": 0.2,
                    "metadata": {},
                }
            },
            source="projection",
        )
        second = storage.record_event(
            "scene.node_upsert",
            {
                "node": {
                    "id": "agent:1",
                    "kind": "agent",
                    "label": "Agent",
                    "status": "active",
                    "color": None,
                    "size": None,
                    "pressure": 0.9,
                    "metadata": {},
                }
            },
            source="projection",
        )

        self.assertEqual(storage.get_snapshot_at(first)["nodes"][0]["pressure"], 0.2)
        self.assertEqual(storage.get_snapshot_at(second)["nodes"][0]["pressure"], 0.9)

    def test_timeline_range_resolves_recent_window_and_maximum(self):
        first = storage.record_event("event.old", {}, occurred_at=1_000)
        storage.record_event("event.middle", {}, occurred_at=10_000)
        last = storage.record_event("event.new", {}, occurred_at=20_000)

        recent = storage.get_timeline_range(5_000)
        maximum = storage.get_timeline_range()

        self.assertEqual(recent["startCursor"], last - 1)
        self.assertEqual(recent["endCursor"], last)
        self.assertEqual(maximum["startCursor"], max(0, first - 1))
        self.assertEqual(maximum["endCursor"], last)


class ProfileStoragePathTests(unittest.TestCase):
    def test_profile_home_resolves_to_shared_machine_database(self):
        with tempfile.TemporaryDirectory() as root:
            profile_home = Path(root) / "profiles" / "luna"
            with patch.dict(
                os.environ,
                {"HERMES_HOME": str(profile_home)},
                clear=False,
            ):
                self.assertEqual(
                    storage.database_path(),
                    Path(root) / "plugin-data" / "hermes-graph" / "events.sqlite3",
                )


if __name__ == "__main__":
    unittest.main()
