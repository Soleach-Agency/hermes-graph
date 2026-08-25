from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import hermes_graph.storage as storage
from hermes_graph.hooks import make_observer
from hermes_graph.vault import VaultWatcher, index_vault, reconcile_vault, sync_vault_change


class VaultIndexTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.db_path = self.root / "events.sqlite3"
        self.vault = self.root / "My Vault"
        self.vault.mkdir()
        self.path_patch = patch.object(storage, "database_path", lambda: self.db_path)
        self.path_patch.start()

    def tearDown(self):
        self.path_patch.stop()
        self.temp_dir.cleanup()

    def test_indexes_wikilinks_and_excludes_hidden_directories(self):
        (self.vault / "Alpha.md").write_text("# Alpha\n[[Beta]]\n[[Folder/Gamma|alias]]")
        (self.vault / "Beta.md").write_text("# Beta\n[[Alpha#section]]")
        folder = self.vault / "Folder"
        folder.mkdir()
        (folder / "Gamma.md").write_text("# Gamma\n")
        hidden = self.vault / ".obsidian"
        hidden.mkdir()
        (hidden / "Ignored.md").write_text("[[Alpha]]")

        result = index_vault(self.vault)
        snapshot = storage.get_snapshot()

        self.assertEqual(result["notes"], 3)
        self.assertEqual(result["links"], 3)
        self.assertEqual(len([node for node in snapshot["nodes"] if node["kind"] == "note"]), 3)
        self.assertEqual(len([edge for edge in snapshot["edges"] if edge["kind"] == "references"]), 3)
        self.assertTrue(all("Ignored" not in node["label"] for node in snapshot["nodes"]))

    def test_reindex_removes_deleted_notes_from_live_and_replay_projection(self):
        alpha = self.vault / "Alpha.md"
        beta = self.vault / "Beta.md"
        alpha.write_text("[[Beta]]")
        beta.write_text("hello")
        index_vault(self.vault)
        beta.unlink()

        result = index_vault(self.vault)
        snapshot = storage.get_snapshot()
        historical = storage.get_snapshot_at(snapshot["cursor"])

        self.assertEqual(result["notes"], 1)
        self.assertEqual(len([node for node in snapshot["nodes"] if node["kind"] == "note"]), 1)
        self.assertEqual(len([node for node in historical["nodes"] if node["kind"] == "note"]), 1)

    def test_vault_tool_results_connect_to_resolved_note_nodes(self):
        (self.vault / "Alpha.md").write_text("# Alpha")
        (self.vault / "Beta.md").write_text("# Beta")
        index_vault(self.vault)

        make_observer("post_tool_call")(
            session_id="session-1",
            tool_name="semantic_search",
            result={"matches": [{"path": "Alpha.md"}, {"title": "Beta"}]},
        )
        snapshot = storage.get_snapshot()
        retrieved = [edge for edge in snapshot["edges"] if edge["kind"] == "retrieved"]

        self.assertEqual(len(retrieved), 2)
        self.assertTrue(all(edge["metadata"]["ttlSeconds"] == 30 for edge in retrieved))

    def test_incremental_edit_updates_only_affected_note_and_is_idempotent(self):
        alpha = self.vault / "Alpha.md"
        beta = self.vault / "Beta.md"
        alpha.write_text("# Alpha\n[[Beta]]")
        beta.write_text("# Beta")
        index_vault(self.vault)
        before = storage.get_snapshot()["cursor"]

        alpha.write_text("# Updated Alpha")
        changed = sync_vault_change(self.vault, alpha)
        snapshot = storage.get_snapshot()
        after = snapshot["cursor"]

        self.assertTrue(changed)
        self.assertEqual(after - before, 2)
        self.assertEqual(
            sorted(node["label"] for node in snapshot["nodes"] if node["kind"] == "note"),
            ["Beta", "Updated Alpha"],
        )
        self.assertFalse(sync_vault_change(self.vault, alpha))
        self.assertEqual(storage.get_snapshot()["cursor"], after)

    def test_incremental_rename_replaces_path_stable_identity_and_replays(self):
        alpha = self.vault / "Alpha.md"
        beta = self.vault / "Beta.md"
        alpha.write_text("[[Beta]]")
        beta.write_text("# Beta")
        index_vault(self.vault)
        old_id = next(node["id"] for node in storage.get_snapshot()["nodes"] if node["label"] == "Beta")
        renamed = self.vault / "Renamed.md"
        beta.rename(renamed)

        self.assertTrue(sync_vault_change(self.vault, renamed, beta))
        snapshot = storage.get_snapshot()
        historical = storage.get_snapshot_at(snapshot["cursor"])

        self.assertNotIn(old_id, {node["id"] for node in snapshot["nodes"]})
        self.assertEqual(snapshot["nodes"], historical["nodes"])
        self.assertEqual(snapshot["edges"], historical["edges"])

    def test_reconciliation_converges_after_missed_delete(self):
        alpha = self.vault / "Alpha.md"
        beta = self.vault / "Beta.md"
        alpha.write_text("[[Beta]]")
        beta.write_text("# Beta")
        index_vault(self.vault)
        beta.unlink()

        result = reconcile_vault(self.vault)
        snapshot = storage.get_snapshot()

        self.assertTrue(result["recovered"])
        self.assertEqual(result["notes"], 1)
        self.assertEqual(len([node for node in snapshot["nodes"] if node["kind"] == "note"]), 1)
        self.assertEqual(len([edge for edge in snapshot["edges"] if edge["kind"] == "references"]), 0)

    def test_watcher_poll_applies_create_and_delete_without_full_refresh(self):
        watcher = VaultWatcher(self.vault)
        watcher._state = watcher._scan()
        alpha = self.vault / "Alpha.md"
        alpha.write_text("# Alpha")
        self.assertTrue(watcher.poll_once())
        alpha.unlink()
        self.assertTrue(watcher.poll_once())
        self.assertEqual(storage.get_vault_counts(), (0, 0))


if __name__ == "__main__":
    unittest.main()
