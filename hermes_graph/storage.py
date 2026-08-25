"""SQLite event history and current scene projection for Hermes Graph."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


SCHEMA_VERSION = 2
PLUGIN_ID = "hermes-graph"
_SCHEMA_LOCK = threading.Lock()
_INITIALIZED_PATHS: set[Path] = set()


def hermes_home() -> Path:
    return Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")).expanduser()


def machine_hermes_home() -> Path:
    """Resolve profile homes back to the shared machine-level Hermes home."""
    home = hermes_home()
    if home.parent.name == "profiles":
        return home.parent.parent
    return home


def database_path() -> Path:
    override = os.environ.get("HERMES_GRAPH_DATA_DIR")
    data_dir = Path(override).expanduser() if override else machine_hermes_home() / "plugin-data" / PLUGIN_ID
    legacy = machine_hermes_home() / PLUGIN_ID / "events.sqlite3"
    if legacy.exists():
        return legacy
    return data_dir / "events.sqlite3"


def utc_timestamp() -> float:
    return time.time()


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


@contextmanager
def connect(path: Path | None = None) -> Iterator[sqlite3.Connection]:
    db_path = path or database_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    try:
        ensure_schema(conn, db_path)
        yield conn
        conn.commit()
    finally:
        conn.close()


def ensure_schema(conn: sqlite3.Connection, path: Path) -> None:
    if path in _INITIALIZED_PATHS:
        return
    with _SCHEMA_LOCK:
        if path in _INITIALIZED_PATHS:
            return
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS events (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL UNIQUE,
                event_type TEXT NOT NULL,
                occurred_at REAL NOT NULL,
                source TEXT NOT NULL,
                session_id TEXT,
                payload_json TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_events_occurred_at
                ON events(occurred_at);
            CREATE INDEX IF NOT EXISTS idx_events_session_id
                ON events(session_id);

            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                label TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'observed',
                color TEXT,
                size REAL,
                pressure REAL,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);

            CREATE TABLE IF NOT EXISTS edges (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
            CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS vault_documents (
                path TEXT PRIMARY KEY,
                node_id TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                links_json TEXT NOT NULL DEFAULT '[]',
                mtime_ns INTEGER NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )
        conn.execute(
            "INSERT OR REPLACE INTO metadata(key, value) VALUES('schema_version', ?)",
            (str(SCHEMA_VERSION),),
        )
        conn.commit()
        _INITIALIZED_PATHS.add(path)


def record_event(
    event_type: str,
    payload: dict[str, Any],
    *,
    source: str = "hermes",
    session_id: str | None = None,
    event_id: str | None = None,
    occurred_at: float | None = None,
) -> int:
    event_id = event_id or str(uuid.uuid4())
    occurred_at = occurred_at or utc_timestamp()
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT OR IGNORE INTO events(
                event_id, event_type, occurred_at, source, session_id, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (event_id, event_type, occurred_at, source, session_id, _json(payload)),
        )
        if cursor.rowcount == 0:
            row = conn.execute(
                "SELECT sequence FROM events WHERE event_id = ?", (event_id,)
            ).fetchone()
            return int(row["sequence"])
        return int(cursor.lastrowid)


def upsert_node(
    node_id: str,
    kind: str,
    label: str,
    *,
    status: str = "observed",
    color: str | None = None,
    size: float | None = None,
    pressure: float | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    now = utc_timestamp()
    metadata = metadata or {}
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO nodes(
                id, kind, label, status, color, size, pressure,
                metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                kind = excluded.kind,
                label = excluded.label,
                status = excluded.status,
                color = COALESCE(excluded.color, nodes.color),
                size = COALESCE(excluded.size, nodes.size),
                pressure = COALESCE(excluded.pressure, nodes.pressure),
                metadata_json = excluded.metadata_json,
                updated_at = excluded.updated_at
            """,
            (
                node_id,
                kind,
                label,
                status,
                color,
                size,
                pressure,
                _json(metadata),
                now,
                now,
            ),
        )


def upsert_edge(
    edge_id: str,
    source_id: str,
    target_id: str,
    kind: str,
    *,
    active: bool = True,
    metadata: dict[str, Any] | None = None,
) -> None:
    now = utc_timestamp()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO edges(
                id, source_id, target_id, kind, active,
                metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                source_id = excluded.source_id,
                target_id = excluded.target_id,
                kind = excluded.kind,
                active = excluded.active,
                metadata_json = excluded.metadata_json,
                updated_at = excluded.updated_at
            """,
            (
                edge_id,
                source_id,
                target_id,
                kind,
                int(active),
                _json(metadata or {}),
                now,
                now,
            ),
        )


def get_snapshot() -> dict[str, Any]:
    with connect() as conn:
        cursor_row = conn.execute(
            "SELECT COALESCE(MAX(sequence), 0) AS cursor FROM events"
        ).fetchone()
        nodes = [
            {
                "id": row["id"],
                "kind": row["kind"],
                "label": row["label"],
                "status": row["status"],
                "color": row["color"],
                "size": row["size"],
                "pressure": row["pressure"],
                "metadata": json.loads(row["metadata_json"]),
            }
            for row in conn.execute("SELECT * FROM nodes ORDER BY created_at, id")
        ]
        edges = [
            {
                "id": row["id"],
                "source": row["source_id"],
                "target": row["target_id"],
                "kind": row["kind"],
                "active": bool(row["active"]),
                "metadata": json.loads(row["metadata_json"]),
            }
            for row in conn.execute(
                "SELECT * FROM edges WHERE active = 1 ORDER BY created_at, id"
            )
        ]
        return {
            "schemaVersion": SCHEMA_VERSION,
            "cursor": int(cursor_row["cursor"]),
            "nodes": nodes,
            "edges": edges,
        }


def get_snapshot_at(sequence: int) -> dict[str, Any]:
    """Rebuild a historical scene from normalized scene mutation events."""
    target = max(0, sequence)
    nodes: dict[str, dict[str, Any]] = {}
    edges: dict[str, dict[str, Any]] = {}
    with connect() as conn:
        max_row = conn.execute(
            "SELECT COALESCE(MAX(sequence), 0) AS cursor FROM events"
        ).fetchone()
        resolved_cursor = min(target, int(max_row["cursor"]))
        rows = conn.execute(
            """
            SELECT event_type, payload_json FROM events
            WHERE sequence <= ?
              AND event_type IN (
                'scene.node_upsert', 'scene.edge_upsert',
                'scene.node_delete', 'scene.edge_delete'
              )
            ORDER BY sequence
            """,
            (resolved_cursor,),
        )
        for row in rows:
            payload = json.loads(row["payload_json"])
            if row["event_type"] == "scene.node_delete":
                nodes.pop(payload["id"], None)
            elif row["event_type"] == "scene.edge_delete":
                edges.pop(payload["id"], None)
            elif row["event_type"] == "scene.node_upsert":
                incoming = payload["node"]
                previous = nodes.get(incoming["id"], {})
                merged = {**previous, **incoming}
                for optional in ("color", "size", "pressure"):
                    if incoming.get(optional) is None and optional in previous:
                        merged[optional] = previous[optional]
                nodes[incoming["id"]] = merged
            else:
                incoming = payload["edge"]
                edges[incoming["id"]] = {**edges.get(incoming["id"], {}), **incoming}

    return {
        "schemaVersion": SCHEMA_VERSION,
        "cursor": resolved_cursor,
        "nodes": list(nodes.values()),
        "edges": [edge for edge in edges.values() if edge.get("active", True)],
    }


def get_events(after: int, limit: int = 1000) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 5000))
    with connect() as conn:
        return [
            {
                "sequence": int(row["sequence"]),
                "id": row["event_id"],
                "type": row["event_type"],
                "occurredAt": row["occurred_at"],
                "source": row["source"],
                "sessionId": row["session_id"],
                "payload": json.loads(row["payload_json"]),
            }
            for row in conn.execute(
                """
                SELECT * FROM events
                WHERE sequence > ?
                ORDER BY sequence
                LIMIT ?
                """,
                (max(0, after), safe_limit),
            )
        ]


def get_timeline_range(seconds: float | None = None) -> dict[str, Any]:
    """Resolve a wall-clock playback window to stable event cursors."""
    with connect() as conn:
        bounds = conn.execute(
            """
            SELECT MIN(sequence) AS first_cursor, MAX(sequence) AS last_cursor,
                   MIN(occurred_at) AS first_at, MAX(occurred_at) AS last_at
            FROM events
            """
        ).fetchone()
        if bounds["last_cursor"] is None:
            return {
                "startCursor": 0,
                "endCursor": 0,
                "startAt": None,
                "endAt": None,
            }

        first_cursor = int(bounds["first_cursor"])
        start_at = float(bounds["first_at"])
        if seconds is not None and seconds > 0:
            cutoff = float(bounds["last_at"]) - seconds
            start = conn.execute(
                """
                SELECT sequence, occurred_at FROM events
                WHERE occurred_at >= ? ORDER BY sequence LIMIT 1
                """,
                (cutoff,),
            ).fetchone()
            if start:
                first_cursor = int(start["sequence"])
                start_at = float(start["occurred_at"])

        return {
            "startCursor": max(0, first_cursor - 1),
            "endCursor": int(bounds["last_cursor"]),
            "startAt": start_at,
            "endAt": float(bounds["last_at"]),
        }


def get_setting(key: str, default: Any = None) -> Any:
    with connect() as conn:
        row = conn.execute(
            "SELECT value_json FROM settings WHERE key = ?", (key,)
        ).fetchone()
    return json.loads(row["value_json"]) if row else default


def set_setting(key: str, value: Any) -> None:
    now = utc_timestamp()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = excluded.updated_at
            """,
            (key, _json(value), now),
        )


def get_vault_counts() -> tuple[int, int]:
    with connect() as conn:
        notes = conn.execute("SELECT COUNT(*) AS count FROM vault_documents").fetchone()
        links = conn.execute(
            "SELECT COUNT(*) AS count FROM edges WHERE id LIKE 'wikilink:%' AND active = 1"
        ).fetchone()
    return int(notes["count"]), int(links["count"])


def resolve_vault_node_ids(references: list[str]) -> list[str]:
    if not references:
        return []
    with connect() as conn:
        rows = conn.execute(
            "SELECT path, node_id, title FROM vault_documents"
        ).fetchall()
    exact: dict[str, str] = {}
    aliases: dict[str, list[str]] = {}
    for row in rows:
        path_key = str(row["path"]).replace("\\", "/").removesuffix(".md").casefold()
        exact[path_key] = row["node_id"]
        for alias in (Path(path_key).name, str(row["title"]).casefold()):
            aliases.setdefault(alias, []).append(row["node_id"])
    resolved: list[str] = []
    for reference in references[:20]:
        key = reference.replace("\\", "/").removesuffix(".md").strip("/").casefold()
        node_id = exact.get(key)
        if not node_id:
            matches = aliases.get(Path(key).name, [])
            node_id = matches[0] if len(matches) == 1 else None
        if node_id and node_id not in resolved:
            resolved.append(node_id)
    return resolved


def replace_vault_projection(
    vault_path: str,
    documents: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> None:
    """Atomically replace only the vault-owned scene projection and retain replay events."""
    now = utc_timestamp()
    with connect() as conn:
        previous_node_ids = {
            row["node_id"] for row in conn.execute("SELECT node_id FROM vault_documents")
        }
        previous_edge_ids = {
            row["id"]
            for row in conn.execute("SELECT id FROM edges WHERE id LIKE 'wikilink:%'")
        }
        next_node_ids = {document["id"] for document in documents}
        next_edge_ids = {edge["id"] for edge in edges}

        removed_nodes = previous_node_ids - next_node_ids
        removed_edges = previous_edge_ids - next_edge_ids
        conn.executemany("DELETE FROM nodes WHERE id = ?", [(item,) for item in removed_nodes])
        conn.executemany("DELETE FROM edges WHERE id = ?", [(item,) for item in previous_edge_ids])
        conn.execute("DELETE FROM vault_documents")

        conn.executemany(
            """
            INSERT INTO nodes(
                id, kind, label, status, metadata_json, created_at, updated_at
            ) VALUES (?, 'note', ?, 'observed', ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                kind = 'note', label = excluded.label, status = 'observed',
                metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
            """,
            [
                (document["id"], document["label"], _json(document["metadata"]), now, now)
                for document in documents
            ],
        )
        conn.executemany(
            """
            INSERT INTO vault_documents(path, node_id, title, links_json, mtime_ns, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    document["metadata"]["path"], document["id"], document["label"],
                    _json(document.get("links", [])), document["mtime_ns"], now,
                )
                for document in documents
            ],
        )
        conn.executemany(
            """
            INSERT INTO edges(
                id, source_id, target_id, kind, active,
                metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, 'references', 1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                source_id = excluded.source_id, target_id = excluded.target_id,
                kind = 'references', active = 1,
                metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
            """,
            [
                (edge["id"], edge["source"], edge["target"], _json(edge["metadata"]), now, now)
                for edge in edges
            ],
        )
        conn.execute(
            """
            INSERT INTO settings(key, value_json, updated_at) VALUES ('vault_path', ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value_json = excluded.value_json, updated_at = excluded.updated_at
            """,
            (_json(vault_path), now),
        )

        event_rows: list[tuple[str, str, float, str, None, str]] = []
        for node_id in removed_nodes:
            event_rows.append((str(uuid.uuid4()), "scene.node_delete", now, "vault", None, _json({"id": node_id})))
        for edge_id in removed_edges:
            event_rows.append((str(uuid.uuid4()), "scene.edge_delete", now, "vault", None, _json({"id": edge_id})))
        for document in documents:
            node = {
                "id": document["id"], "kind": "note", "label": document["label"],
                "status": "observed", "color": None, "size": None, "pressure": None,
                "metadata": document["metadata"],
            }
            event_rows.append((str(uuid.uuid4()), "scene.node_upsert", now, "vault", None, _json({"node": node})))
        for edge in edges:
            projected = {**edge, "kind": "references", "active": True}
            event_rows.append((str(uuid.uuid4()), "scene.edge_upsert", now, "vault", None, _json({"edge": projected})))
        conn.executemany(
            """
            INSERT INTO events(event_id, event_type, occurred_at, source, session_id, payload_json)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            event_rows,
        )
