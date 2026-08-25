from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import hermes_graph.hooks as hooks
import hermes_graph.storage as storage


class FakeContext:
    def __init__(self, profile_name=None):
        self.callbacks = {}
        self.profile_name = profile_name

    def register_hook(self, name, callback):
        self.callbacks[name] = callback


class HookTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.path = Path(self.temp_dir.name) / "events.sqlite3"
        self.path_patch = patch.object(storage, "database_path", lambda: self.path)
        self.path_patch.start()

    def tearDown(self):
        self.path_patch.stop()
        self.temp_dir.cleanup()

    def test_registers_supported_observer_hooks(self):
        context = FakeContext()
        hooks.register_hooks(context)
        self.assertEqual(set(context.callbacks), set(hooks.HOOKS))

    def test_session_and_subagent_hooks_project_scene_and_history(self):
        context = FakeContext()
        hooks.register_hooks(context)

        context.callbacks["on_session_start"](
            session_id="session-1", platform="cli", title="Main session"
        )
        context.callbacks["subagent_start"](
            parent_session_id="session-1",
            parent_turn_id="turn-1",
            parent_subagent_id="main",
            child_session_id="session-2",
            child_subagent_id="researcher-1",
            child_role="Researcher",
            child_goal="Inspect plugin hooks",
        )

        snapshot = storage.get_snapshot()
        kinds = {node["kind"] for node in snapshot["nodes"]}
        self.assertIn("session", kinds)
        self.assertIn("agent", kinds)
        self.assertIn("subagent", kinds)
        self.assertTrue(any(edge["kind"] == "spawned" for edge in snapshot["edges"]))

        historical = storage.get_snapshot_at(snapshot["cursor"])
        self.assertEqual(len(historical["nodes"]), len(snapshot["nodes"]))
        self.assertEqual(len(historical["edges"]), len(snapshot["edges"]))

    def test_session_end_is_idle_until_finalize(self):
        context = FakeContext()
        hooks.register_hooks(context)

        context.callbacks["on_session_start"](session_id="session-1", platform="cli")
        context.callbacks["on_session_end"](
            session_id="session-1", platform="cli", completed=True, interrupted=False
        )
        idle = next(node for node in storage.get_snapshot()["nodes"] if node["kind"] == "session")
        self.assertEqual(idle["status"], "idle")

        context.callbacks["on_session_finalize"](session_id="session-1", platform="cli")
        finalized = next(
            node for node in storage.get_snapshot()["nodes"] if node["kind"] == "session"
        )
        self.assertEqual(finalized["status"], "completed")

    def test_subagent_stop_updates_the_started_child(self):
        context = FakeContext()
        hooks.register_hooks(context)
        context.callbacks["subagent_start"](
            parent_session_id="session-1",
            child_session_id="session-2",
            child_subagent_id="researcher-1",
            child_role="Researcher",
        )
        context.callbacks["subagent_stop"](
            parent_session_id="session-1",
            child_session_id="session-2",
            child_role="Researcher",
            child_status="failed",
            duration_ms=1250,
        )

        children = [node for node in storage.get_snapshot()["nodes"] if node["kind"] == "subagent"]
        self.assertEqual(len(children), 1)
        self.assertEqual(children[0]["status"], "failed")
        self.assertEqual(children[0]["metadata"]["durationMs"], 1250)

    def test_prompt_fields_are_not_recorded(self):
        cleaned = hooks._clean(
            {
                "session_id": "session-1",
                "user_message": "private input",
                "request_messages": ["private history"],
                "api_key": "secret-key",
                "params": {"password": "secret-password", "path": "/tmp/file"},
                "model": "test-model",
            }
        )
        self.assertNotIn("user_message", cleaned)
        self.assertNotIn("request_messages", cleaned)
        self.assertEqual(cleaned["api_key"], "[redacted]")
        self.assertEqual(cleaned["params"]["password"], "[redacted]")
        self.assertEqual(cleaned["params"]["path"], "/tmp/file")
        self.assertEqual(cleaned["model"], "test-model")

    def test_registered_observer_records_source_profile(self):
        context = FakeContext(profile_name="luna")
        hooks.register_hooks(context)
        context.callbacks["on_session_start"](session_id="session-1", platform="cli")

        event = storage.get_events(0)[0]
        self.assertEqual(event["payload"]["profile_name"], "luna")

    def test_external_tool_results_become_temporary_result_nodes(self):
        observer = hooks.make_observer("post_tool_call")
        observer(
            session_id="session-1",
            tool_name="web_search",
            result={"results": [{"title": "one"}, {"title": "two"}]},
        )

        snapshot = storage.get_snapshot()
        tools = [node for node in snapshot["nodes"] if node["kind"] == "tool"]
        results = [node for node in snapshot["nodes"] if node["kind"] == "result"]
        returned = [edge for edge in snapshot["edges"] if edge["kind"] == "returned"]

        self.assertEqual(tools[0]["metadata"]["direction"], "external")
        self.assertEqual(len(results), 2)
        self.assertEqual(len(returned), 2)
        self.assertEqual(results[0]["metadata"]["ttlSeconds"], 30)
        self.assertIn("createdAt", returned[0]["metadata"])
        called = [edge for edge in snapshot["edges"] if edge["kind"] == "called"]
        self.assertIn("createdAt", called[0]["metadata"])


if __name__ == "__main__":
    unittest.main()
