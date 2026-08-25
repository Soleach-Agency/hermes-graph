"""Hermes Graph agent plugin entry point."""

from .hermes_graph.hooks import register_hooks
from .hermes_graph.hydration import hydrate_runtime
from .hermes_graph.kanban import hydrate_kanban


def register(ctx):
    """Register observer-only lifecycle hooks with Hermes."""
    register_hooks(ctx)
    hydrate_runtime(profile_name=getattr(ctx, "profile_name", None))
    hydrate_kanban()
