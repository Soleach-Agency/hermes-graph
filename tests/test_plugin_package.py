from __future__ import annotations

import json
import importlib.util
import sys
import unittest
from pathlib import Path

from hermes_graph.hooks import HOOKS


ROOT = Path(__file__).resolve().parent.parent


class PluginPackageTests(unittest.TestCase):
    def test_root_entrypoint_supports_namespaced_plugin_loading(self):
        module_name = "_hermes_graph_plugin_doctor_fixture"
        spec = importlib.util.spec_from_file_location(
            module_name,
            ROOT / "__init__.py",
            submodule_search_locations=[str(ROOT)],
        )
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        try:
            spec.loader.exec_module(module)
        finally:
            sys.modules.pop(module_name, None)

        self.assertTrue(callable(module.register))

    def test_native_manifest_matches_registered_hooks(self):
        text = (ROOT / "plugin.yaml").read_text(encoding="utf-8")
        declared_hooks: list[str] = []
        in_hooks = False
        for line in text.splitlines():
            if line == "provides_hooks:":
                in_hooks = True
                continue
            if in_hooks and line.startswith("  - "):
                declared_hooks.append(line.removeprefix("  - "))
            elif in_hooks and line and not line.startswith(" "):
                in_hooks = False

        self.assertIn("name: hermes-graph", text)
        self.assertIn("manifest_version: 2", text)
        self.assertEqual(set(declared_hooks), set(HOOKS))

    def test_dashboard_bundle_is_declared_and_prebuilt(self):
        manifest = json.loads(
            (ROOT / "dashboard" / "manifest.json").read_text(encoding="utf-8")
        )

        self.assertEqual(manifest["name"], "hermes-graph")
        self.assertEqual(manifest["api"], "plugin_api.py")
        self.assertTrue((ROOT / "dashboard" / manifest["entry"]).is_file())
        self.assertTrue((ROOT / "dashboard" / manifest["css"]).is_file())


if __name__ == "__main__":
    unittest.main()
