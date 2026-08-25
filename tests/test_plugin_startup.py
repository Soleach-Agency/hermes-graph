from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent.parent


class FakeContext:
    profile_name = "luna"

    def __init__(self):
        self.callbacks = {}

    def register_hook(self, name, callback):
        self.callbacks[name] = callback


class PluginStartupTests(unittest.TestCase):
    def test_register_hydrates_runtime_and_kanban_after_observer_hooks(self):
        module_name = "_hermes_graph_plugin_startup_fixture"
        spec = importlib.util.spec_from_file_location(
            module_name, ROOT / "__init__.py", submodule_search_locations=[str(ROOT)]
        )
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        try:
            spec.loader.exec_module(module)
            context = FakeContext()
            with patch.object(module, "hydrate_runtime") as hydrate_runtime, patch.object(
                module, "hydrate_kanban"
            ) as hydrate_kanban:
                module.register(context)
        finally:
            sys.modules.pop(module_name, None)

        self.assertEqual(len(context.callbacks), 14)
        hydrate_runtime.assert_called_once_with(profile_name="luna")
        hydrate_kanban.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
