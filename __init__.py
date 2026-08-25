"""Hermes Graph agent plugin entry point."""

from .hermes_graph.hooks import register_hooks


def register(ctx):
    """Register observer-only lifecycle hooks with Hermes."""
    register_hooks(ctx)
