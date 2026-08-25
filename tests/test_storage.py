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

    def test_cleanup_expired_removes_transient_entities_and_records_deletes(self):
        with patch.object(storage, "utc_timestamp", return_value=100.0):
            storage.upsert_node("agent:1", "agent", "Agent")
            storage.record_event("scene.node_upsert", {"node": {
                "id": "agent:1", "kind": "agent", "label": "Agent",
                "status": "observed", "color": None, "size": None,
                "pressure": None, "metadata": {},
            }}, source="projection")
            storage.upsert_node(
                "result:1", "result", "Result",
                metadata={"createdAt": 90.0, "ttlSeconds": 10},
            )
            storage.record_event("scene.node_upsert", {"node": {
                "id": "result:1", "kind": "result", "label": "Result",
                "status": "observed", "color": None, "size": None,
                "pressure": None, "metadata": {"createdAt": 90.0, "ttlSeconds": 10},
            }}, source="projection")
            storage.upsert_node(
                "note:1", "note", "Persistent",
                metadata={"createdAt": 90.0, "ttlSeconds": 10},
            )
            storage.record_event("scene.node_upsert", {"node": {
                "id": "note:1", "kind": "note", "label": "Persistent",
                "status": "observed", "color": None, "size": None,
                "pressure": None, "metadata": {"createdAt": 90.0, "ttlSeconds": 10},
            }}, source="projection")
            storage.upsert_edge(
                "returned:1", "agent:1", "result:1", "returned",
                metadata={"createdAt": 90.0, "ttlSeconds": 10},
            )
            storage.record_event("scene.edge_upsert", {"edge": {
                "id": "returned:1", "source": "agent:1", "target": "result:1",
                "kind": "returned", "active": True,
                "metadata": {"createdAt": 90.0, "ttlSeconds": 10},
            }}, source="projection")
            storage.upsert_edge(
                "belongs:1", "agent:1", "note:1", "belongs_to",
            )
            storage.record_event("scene.edge_upsert", {"edge": {
                "id": "belongs:1", "source": "agent:1", "target": "note:1",
                "kind": "belongs_to", "active": True, "metadata": {},
            }}, source="projection")

        with patch.object(storage, "utc_timestamp", return_value=99.999):
            before = storage.get_snapshot()
        before_cursor = before["cursor"]
        removed = storage.cleanup_expired(now=99.999)
        self.assertEqual(removed, {"nodes": [], "edges": []})

        removed = storage.cleanup_expired(now=100.0)
        self.assertEqual(removed, {"nodes": ["result:1"], "edges": ["returned:1"]})
        after = storage.get_snapshot()
        self.assertEqual({node["id"] for node in after["nodes"]}, {"agent:1", "note:1"})
        self.assertEqual([edge["id"] for edge in after["edges"]], ["belongs:1"])
        self.assertEqual(
            [event["type"] for event in storage.get_events(before_cursor)],
            ["scene.edge_delete", "scene.node_delete"],
        )
        self.assertEqual(storage.cleanup_expired(now=100.0), {"nodes": [], "edges": []})
        historical_before = storage.get_snapshot_at(before_cursor)
        historical_after = storage.get_snapshot_at(after["cursor"])
        self.assertEqual(len(historical_before["nodes"]), 3)
        self.assertEqual(len(historical_before["edges"]), 2)
        self.assertEqual(len(historical_after["nodes"]), 2)
        self.assertEqual([edge["id"] for edge in historical_after["edges"]], ["belongs:1"])

    def test_cleanup_expired_removes_orphaned_temporary_edges(self):
        storage.upsert_edge(
            "called:orphan", "missing", "tool", "called",
            metadata={"createdAt": 10.0, "ttlSeconds": 1},
        )
        storage.upsert_edge(
            "retrieved:orphan", "tool", "missing", "retrieved",
            metadata={"createdAt": 10.0, "ttlSeconds": 1},
        )

        self.assertEqual(
            storage.cleanup_expired(now=11.0),
            {"nodes": [], "edges": ["called:orphan", "retrieved:orphan"]},
        )
        self.assertEqual(storage.get_snapshot()["edges"], [])

    def test_cleanup_expired_covers_every_temporary_edge_kind(self):
        for node_id in ("agent:1", "tool:1", "note:1", "result:1"):
            kind = "result" if node_id == "result:1" else "agent"
            metadata = {"createdAt": 10.0, "ttlSeconds": 1} if kind == "result" else {}
            storage.upsert_node(node_id, kind, node_id, metadata=metadata)
        for kind, source, target in (
            ("called", "agent:1", "tool:1"),
            ("retrieved", "tool:1", "note:1"),
            ("returned", "tool:1", "result:1"),
        ):
            storage.upsert_edge(
                f"{kind}:1", source, target, kind,
                metadata={"createdAt": 10.0, "ttlSeconds": 1},
            )

        removed = storage.cleanup_expired(now=11.0)
        self.assertEqual(
            removed["edges"], ["called:1", "retrieved:1", "returned:1"]
        )
        self.assertEqual(removed["nodes"], ["result:1"])


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
