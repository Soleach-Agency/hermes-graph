"""Read-only projection of the supported local Hermes Kanban schema."""

from __future__ import annotations

import hashlib
import os
import sqlite3
from pathlib import Path
from typing import Any

from .storage import machine_hermes_home, replace_runtime_hydration_projection


_KANBAN_PROVENANCE = "kanban"
_REQUIRED_TASK_COLUMNS = {"id", "title", "status"}
_TASK_COLUMNS = ("id", "title", "assignee", "status", "block_kind")


def _id(prefix: str, value: str) -> str:
    digest = hashlib.sha1(value.encode("utf-8"), usedforsecurity=False).hexdigest()[:12]
    return f"{prefix}:{digest}"


def discover_kanban_store() -> Path | None:
    """Resolve Hermes's documented worker-pinned board or default board path."""
    override = os.environ.get("HERMES_KANBAN_DB", "").strip()
    path = Path(override).expanduser() if override else machine_hermes_home() / "kanban.db"
    return path if path.is_file() else None


def _read_board(path: Path) -> tuple[list[dict[str, Any]], list[tuple[str, str]]] | None:
    try:
        connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    except (OSError, sqlite3.Error):
        return None
    connection.row_factory = sqlite3.Row
    try:
        tables = {str(row["name"]) for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        if "tasks" not in tables:
            return None
        columns = {str(row["name"]) for row in connection.execute("PRAGMA table_info(tasks)")}
        if not _REQUIRED_TASK_COLUMNS.issubset(columns):
            return None
        selected = [column for column in _TASK_COLUMNS if column in columns]
        rows = connection.execute(
            f"SELECT {', '.join(selected)} FROM tasks WHERE status != 'archived' ORDER BY id"
        ).fetchall()
        task_ids = {str(row["id"]) for row in rows}
        links: list[tuple[str, str]] = []
        if "task_links" in tables:
            links = [
                (str(row["parent_id"]), str(row["child_id"]))
                for row in connection.execute("SELECT parent_id, child_id FROM task_links ORDER BY parent_id, child_id")
                if str(row["parent_id"]) in task_ids and str(row["child_id"]) in task_ids
            ]
        return ([{column: row[column] for column in selected} for row in rows], links)
    except sqlite3.Error:
        return None
    finally:
        connection.close()


def _status(value: Any) -> str:
    status = str(value or "observed")
    return {"running": "doing", "done": "done", "archived": "archived"}.get(status, status)


def hydrate_kanban(store: Path | None = None) -> dict[str, int]:
    """Hydrate concise live Kanban topology without reading bodies or comments.

    Dependency arrows point from the dependent child to its parent: ``child
    --depends_on--> parent``. A blocked child with an unfinished parent also
    receives ``child --blocked_by--> parent``. The board has no separate
    blocker-relation table, so no other blocker relationship is inferred.
    """
    path = store if store is not None else discover_kanban_store()
    if path is None:
        replace_runtime_hydration_projection(_KANBAN_PROVENANCE, [], [])
        return {"hydratedTasks": 0, "stores": 0}
    loaded = _read_board(Path(path))
    if loaded is None:
        return {"hydratedTasks": 0, "stores": 0}
    rows, links = loaded
    nodes: dict[str, dict[str, Any]] = {}
    task_statuses: dict[str, str] = {}
    for row in rows:
        task_id = str(row["id"])
        task_statuses[task_id] = _status(row.get("status"))
        metadata: dict[str, Any] = {"provenance": _KANBAN_PROVENANCE}
        if row.get("assignee"):
            metadata["assignee"] = str(row["assignee"])
        if row.get("block_kind"):
            metadata["blockKind"] = str(row["block_kind"])
        node_id = _id("task", task_id)
        nodes[node_id] = {"id": node_id, "kind": "task", "label": str(row["title"]), "status": task_statuses[task_id], "color": None, "size": None, "pressure": None, "metadata": metadata}
    edges: dict[str, dict[str, Any]] = {}
    for parent_id, child_id in links:
        parent = _id("task", parent_id)
        child = _id("task", child_id)
        dependency_id = f"depends:{child}:{parent}"
        edges[dependency_id] = {"id": dependency_id, "source": child, "target": parent, "kind": "depends_on", "active": True, "metadata": {"provenance": _KANBAN_PROVENANCE}}
        if task_statuses.get(child_id) == "blocked" and task_statuses.get(parent_id) != "done":
            blocker_id = f"blocked:{child}:{parent}"
            edges[blocker_id] = {"id": blocker_id, "source": child, "target": parent, "kind": "blocked_by", "active": True, "metadata": {"provenance": _KANBAN_PROVENANCE}}
    replace_runtime_hydration_projection(_KANBAN_PROVENANCE, list(nodes.values()), list(edges.values()))
    return {"hydratedTasks": len(nodes), "stores": 1}
