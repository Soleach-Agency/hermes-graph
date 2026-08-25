"""Bounded startup projection of locally persisted Hermes runtime sessions."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any

from .storage import hermes_home, machine_hermes_home, replace_runtime_hydration_projection


_RUNTIME_PROVENANCE = "runtime_sessions"
_REQUIRED_SESSION_COLUMNS = {"id", "source", "started_at"}
_SESSION_COLUMNS = (
    "id", "source", "model", "model_config", "parent_session_id", "started_at", "ended_at",
    "end_reason", "input_tokens", "output_tokens", "title", "profile_name",
)


def _id(prefix: str, value: Any) -> str:
    digest = hashlib.sha1(str(value).encode("utf-8"), usedforsecurity=False).hexdigest()[:12]
    return f"{prefix}:{digest}"


def discover_runtime_stores(profile_name: str | None = None) -> dict[str, Path]:
    """Return only the canonical local session stores that actually exist."""
    machine_home = machine_hermes_home()
    stores: dict[str, Path] = {}
    default_store = machine_home / "state.db"
    if default_store.is_file():
        stores["default"] = default_store
    profiles_dir = machine_home / "profiles"
    if profiles_dir.is_dir():
        for profile_dir in sorted(profiles_dir.iterdir(), key=lambda item: item.name):
            store = profile_dir / "state.db"
            if profile_dir.is_dir() and store.is_file():
                stores[profile_dir.name] = store
    current_store = hermes_home() / "state.db"
    if current_store.is_file():
        stores.setdefault(profile_name or hermes_home().name, current_store)
    return stores


def _rows_from_store(path: Path) -> list[dict[str, Any]] | None:
    """Read a validated subset of a canonical session store without touching messages."""
    try:
        connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    except (OSError, sqlite3.Error):
        return None
    connection.row_factory = sqlite3.Row
    try:
        tables = {str(row["name"]) for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        if "sessions" not in tables:
            return None
        available = {str(row["name"]) for row in connection.execute("PRAGMA table_info(sessions)")}
        if not _REQUIRED_SESSION_COLUMNS.issubset(available):
            return None
        columns = [column for column in _SESSION_COLUMNS if column in available]
        selected = ", ".join(f'"{column}"' for column in columns)
        rows = connection.execute(f"SELECT {selected} FROM sessions ORDER BY started_at, id").fetchall()
        return [{column: row[column] for column in columns} for row in rows]
    except sqlite3.Error:
        return None
    finally:
        connection.close()


def _status(row: dict[str, Any]) -> str:
    return "active" if row.get("ended_at") is None else "completed"


def _is_delegate(row: dict[str, Any]) -> bool:
    raw = row.get("model_config")
    if not isinstance(raw, str) or not raw:
        return False
    try:
        config = json.loads(raw)
    except (TypeError, ValueError):
        return False
    return isinstance(config, dict) and bool(config.get("_delegate_from"))


def hydrate_runtime(runtime_stores: dict[str, Path] | None = None, *, profile_name: str | None = None) -> dict[str, int]:
    """Project current runtime sessions through normal replayable mutations."""
    stores = runtime_stores if runtime_stores is not None else discover_runtime_stores(profile_name=profile_name)
    nodes: dict[str, dict[str, Any]] = {}
    edges: dict[str, dict[str, Any]] = {}
    records: list[tuple[str, dict[str, Any]]] = []
    supported_stores = 0
    for store_profile, path in sorted(stores.items()):
        rows = _rows_from_store(Path(path))
        if rows is None:
            continue
        supported_stores += 1
        records.extend((str(row.get("profile_name") or store_profile), row) for row in rows if row.get("id"))
    profiles_by_session: dict[str, str | None] = {}
    for profile, row in records:
        session_id = str(row["id"])
        existing = profiles_by_session.get(session_id, profile)
        profiles_by_session[session_id] = profile if existing == profile else None
    for profile, row in records:
        session_id = str(row["id"])
        session = _id("session", session_id)
        agent = _id("agent", f"runtime:{profile}:{session_id}")
        status = _status(row)
        nodes[session] = {"id": session, "kind": "session", "label": str(row.get("title") or session_id), "status": status, "color": None, "size": None, "pressure": None, "metadata": {"platform": row.get("source"), "profile": profile, "provenance": _RUNTIME_PROVENANCE}}
        agent_metadata: dict[str, Any] = {"profile": profile, "sessionId": session_id, "contextAvailable": False, "provenance": _RUNTIME_PROVENANCE}
        for stored, projected in (("input_tokens", "inputTokens"), ("output_tokens", "outputTokens")):
            if isinstance(row.get(stored), (int, float)):
                agent_metadata[projected] = row[stored]
        nodes[agent] = {"id": agent, "kind": "subagent" if _is_delegate(row) else "agent", "label": str(row.get("model") or "Hermes agent"), "status": status, "color": None, "size": None, "pressure": None, "metadata": agent_metadata}
        edges[f"belongs:{agent}:{session}"] = {"id": f"belongs:{agent}:{session}", "source": agent, "target": session, "kind": "belongs_to", "active": True, "metadata": {"provenance": _RUNTIME_PROVENANCE}}
    for profile, row in records:
        parent_id = row.get("parent_session_id")
        if not isinstance(parent_id, str) or parent_id not in profiles_by_session:
            continue
        session_id = str(row["id"])
        parent_session = _id("session", parent_id)
        session = _id("session", session_id)
        edges[f"parent:{parent_session}:{session}"] = {"id": f"parent:{parent_session}:{session}", "source": parent_session, "target": session, "kind": "parent_session", "active": True, "metadata": {"provenance": _RUNTIME_PROVENANCE}}
        parent_profile = profiles_by_session[parent_id]
        if _is_delegate(row) and parent_profile is not None:
            parent_agent = _id("agent", f"runtime:{parent_profile}:{parent_id}")
            agent = _id("agent", f"runtime:{profile}:{session_id}")
            edges[f"spawned:{parent_agent}:{agent}"] = {"id": f"spawned:{parent_agent}:{agent}", "source": parent_agent, "target": agent, "kind": "spawned", "active": True, "metadata": {"provenance": _RUNTIME_PROVENANCE}}
    replace_runtime_hydration_projection(_RUNTIME_PROVENANCE, list(nodes.values()), list(edges.values()))
    return {"hydratedSessions": sum(1 for _, row in records if row.get("id")), "stores": supported_stores}
