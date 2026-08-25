"""SQLite event history and current scene projection for Hermes Graph."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


SCHEMA_VERSION = 3
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

            CREATE TABLE IF NOT EXISTS runtime_hydration_entities (
                provenance TEXT NOT NULL,
                entity_kind TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                projected_at REAL NOT NULL,
                created_by_hydration INTEGER NOT NULL,
                PRIMARY KEY (provenance, entity_kind, entity_id)
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


_DELETE_EVENT_NAMESPACE = uuid.UUID("2f7d4bd2-9b6a-4c73-9a53-4f4f9f4c5ad3")
_LIFECYCLE_CLEANUP_LOCK = threading.Lock()
_LAST_LIFECYCLE_CLEANUP = 0.0


def _expiry(metadata_json: str, now: float) -> bool:
    try:
        metadata = json.loads(metadata_json)
        created_at = float(metadata.get("createdAt"))
        ttl_seconds = float(metadata.get("ttlSeconds"))
    except (AttributeError, TypeError, ValueError, json.JSONDecodeError):
        return False
    return ttl_seconds >= 0 and created_at + ttl_seconds <= now


def _delete_event_id(event_type: str, entity_id: str, created_at: float) -> str:
    return str(uuid.uuid5(_DELETE_EVENT_NAMESPACE, f"{event_type}:{entity_id}:{created_at!r}"))


def lifecycle_fade_seconds() -> float:
    preferences = get_setting("graph_preferences", {})
    try:
        fade_hours = float(
            preferences.get("theme", {}).get("kanbanFadeHours", 24)
            if isinstance(preferences, dict)
            else 24
        )
    except (AttributeError, TypeError, ValueError):
        fade_hours = 24
    return max(6, min(48, fade_hours)) * 3600


def cleanup_expired(now: float | None = None) -> dict[str, list[str]]:
    """Remove expired transient projection rows and append replayable deletes.

    The transaction takes the SQLite writer lock, making concurrent cleanup and
    hook activity serialize. Delete events are deterministic for one entity
    lifecycle, so retries after a crash cannot duplicate history.
    """
    global _LAST_LIFECYCLE_CLEANUP
    explicit_now = now is not None
    now = utc_timestamp() if now is None else float(now)
    monotonic_now = time.monotonic()
    with _LIFECYCLE_CLEANUP_LOCK:
        run_lifecycle_cleanup = (
            explicit_now or monotonic_now - _LAST_LIFECYCLE_CLEANUP >= 60
        )
        if run_lifecycle_cleanup:
            _LAST_LIFECYCLE_CLEANUP = monotonic_now
    fade_seconds = lifecycle_fade_seconds() if run_lifecycle_cleanup else 0
    with connect() as conn:
        expired_result_nodes = [
            row for row in conn.execute(
                "SELECT id, kind, status, created_at, metadata_json FROM nodes WHERE kind = 'result'"
            ) if _expiry(row["metadata_json"], now)
        ]
        temporary_edges = list(conn.execute(
            """
            SELECT id, source_id, target_id, kind, created_at, metadata_json
            FROM edges WHERE kind IN ('called', 'retrieved', 'returned')
            """
        ))
        endpoint_ids = {
            str(value)
            for row in temporary_edges
            for value in (row["source_id"], row["target_id"])
        }
        live_endpoint_ids: set[str] = set()
        if endpoint_ids:
            endpoint_list = sorted(endpoint_ids)
            for start in range(0, len(endpoint_list), 800):
                batch = endpoint_list[start : start + 800]
                placeholders = ",".join("?" for _ in batch)
                live_endpoint_ids.update(
                    str(row["id"])
                    for row in conn.execute(
                        f"SELECT id FROM nodes WHERE id IN ({placeholders})", batch
                    )
                )

        node_rows = (
            list(conn.execute(
                "SELECT id, kind, status, created_at, metadata_json FROM nodes"
            ))
            if run_lifecycle_cleanup
            else []
        )
        by_id = {str(row["id"]): row for row in node_rows}
        completion: dict[str, float] = {}
        completed_statuses = {"done", "completed", "stopped", "reset"}
        for row in node_rows:
            if str(row["status"]).lower() not in completed_statuses:
                continue
            try:
                metadata = json.loads(row["metadata_json"])
                completed_at = float(metadata.get("completedAt"))
            except (AttributeError, TypeError, ValueError, json.JSONDecodeError):
                continue
            if completed_at > 0:
                completion[str(row["id"])] = completed_at

        owner_edges = (
            list(conn.execute(
                """
                SELECT id, source_id, target_id, kind, created_at, metadata_json
                FROM edges WHERE kind IN ('belongs_to', 'works_on')
                """
            ))
            if run_lifecycle_cleanup
            else []
        )
        owner_targets: dict[str, list[str]] = {}
        for edge in owner_edges:
            owner_targets.setdefault(str(edge["source_id"]), []).append(
                str(edge["target_id"])
            )
        changed = True
        while changed:
            changed = False
            for owner, targets in owner_targets.items():
                if owner in completion or owner not in by_id or not targets:
                    continue
                if all(target in completion for target in targets):
                    completion[owner] = max(completion[target] for target in targets)
                    changed = True
        for row in node_rows:
            if row["kind"] != "tool":
                continue
            try:
                owner = str(json.loads(row["metadata_json"]).get("owner") or "")
            except (AttributeError, TypeError, json.JSONDecodeError):
                owner = ""
            if owner in completion:
                completion[str(row["id"])] = completion[owner]

        expired_lifecycle_nodes = [
            row
            for row in node_rows
            if str(row["id"]) in completion
            and now
            >= completion[str(row["id"])]
            + fade_seconds * (0.3 if row["kind"] == "tool" else 1.0)
        ]
        expired_nodes_by_id = {
            str(row["id"]): row
            for row in [*expired_result_nodes, *expired_lifecycle_nodes]
        }
        expired_node_ids = set(expired_nodes_by_id)
        expired_edges_by_id = {
            str(row["id"]): row
            for row in temporary_edges
            if _expiry(row["metadata_json"], now)
            or str(row["source_id"]) not in live_endpoint_ids
            or str(row["target_id"]) not in live_endpoint_ids
            or row["source_id"] in expired_node_ids
            or row["target_id"] in expired_node_ids
        }
        if expired_node_ids:
            for row in conn.execute(
                "SELECT id, source_id, target_id, kind, created_at, metadata_json FROM edges"
            ):
                if row["source_id"] in expired_node_ids or row["target_id"] in expired_node_ids:
                    expired_edges_by_id[str(row["id"])] = row
        expired_edge_ids = set(expired_edges_by_id)

        # Edges are removed first so the live projection never contains a
        # dangling reference, including during result-node expiry.
        if expired_edge_ids:
            conn.executemany("DELETE FROM edges WHERE id = ?", [(item,) for item in expired_edge_ids])
        if expired_node_ids:
            conn.executemany("DELETE FROM nodes WHERE id = ?", [(item,) for item in expired_node_ids])

        event_rows: list[tuple[str, str, float, str, None, str]] = []
        for row in sorted(expired_edges_by_id.values(), key=lambda item: item["id"]):
            event_rows.append((
                _delete_event_id("scene.edge_delete", row["id"], float(row["created_at"])),
                "scene.edge_delete", now, "projection", None, _json({"id": row["id"]}),
            ))
        for row in sorted(expired_nodes_by_id.values(), key=lambda item: item["id"]):
            event_rows.append((
                _delete_event_id("scene.node_delete", row["id"], float(row["created_at"])),
                "scene.node_delete", now, "projection", None, _json({"id": row["id"]}),
            ))
        if event_rows:
            conn.executemany(
                """
                INSERT OR IGNORE INTO events(
                    event_id, event_type, occurred_at, source, session_id, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                event_rows,
            )
        return {
            "nodes": sorted(expired_node_ids),
            "edges": sorted(expired_edge_ids),
        }


def get_snapshot() -> dict[str, Any]:
    cleanup_expired()
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


def get_cursor_timestamp(sequence: int) -> float:
    with connect() as conn:
        row = conn.execute(
            "SELECT occurred_at FROM events WHERE sequence <= ? ORDER BY sequence DESC LIMIT 1",
            (max(0, sequence),),
        ).fetchone()
    return float(row["occurred_at"]) if row else 0.0


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


def get_vault_document(path: str) -> dict[str, Any] | None:
    """Return projection metadata only; Markdown bodies are never persisted."""
    with connect() as conn:
        row = conn.execute("SELECT * FROM vault_documents WHERE path = ?", (path,)).fetchone()
    if not row:
        return None
    return {
        "path": row["path"], "id": row["node_id"], "label": row["title"],
        "links": json.loads(row["links_json"]), "mtime_ns": int(row["mtime_ns"]),
    }


def apply_vault_delta(
    vault_path: str, documents: list[dict[str, Any]], edges: list[dict[str, Any]], *,
    remove_paths: list[str] | None = None, replace_edge_sources: list[str] | None = None,
) -> bool:
    """Atomically apply changed vault documents and their wikilink edges only."""
    now = utc_timestamp()
    changed = False
    remove_paths = remove_paths or []
    replace_edge_sources = replace_edge_sources or []
    with connect() as conn:
        removed_ids = [
            row["node_id"] for path in remove_paths
            for row in conn.execute("SELECT node_id FROM vault_documents WHERE path = ?", (path,))
        ]
        stale_edges = {
            row["id"] for node_id in set(removed_ids + replace_edge_sources)
            for row in conn.execute(
                "SELECT id FROM edges WHERE id LIKE 'wikilink:%' AND (source_id = ? OR target_id = ?)",
                (node_id, node_id),
            )
        }
        existing_docs = {
            row["path"]: row for row in conn.execute(
                "SELECT path, node_id, title, links_json, mtime_ns FROM vault_documents"
            )
        }
        next_edges = {edge["id"]: edge for edge in edges}
        existing_edges = {
            row["id"]: row for row in conn.execute(
                "SELECT id, source_id, target_id, metadata_json FROM edges WHERE id LIKE 'wikilink:%'"
            )
        }
        for path in remove_paths:
            row = existing_docs.get(path)
            if row:
                conn.execute("DELETE FROM vault_documents WHERE path = ?", (path,))
                conn.execute("DELETE FROM nodes WHERE id = ?", (row["node_id"],))
                changed = True
                event_id = hashlib.sha1(f"vault:delete:{row['node_id']}".encode()).hexdigest()
                conn.execute("INSERT OR IGNORE INTO events(event_id,event_type,occurred_at,source,session_id,payload_json) VALUES(?,?,?,?,?,?)", (event_id, "scene.node_delete", now, "vault", None, _json({"id": row["node_id"]})))
        for document in documents:
            prior = existing_docs.get(document["metadata"]["path"])
            semantic = (document["id"], document["label"], document["metadata"], document.get("links", []), document["mtime_ns"])
            previous = None if not prior else (prior["node_id"], prior["title"], json.loads(prior["links_json"]), int(prior["mtime_ns"]))
            if previous and previous == (semantic[0], semantic[1], semantic[3], semantic[4]):
                continue
            changed = True
            conn.execute("INSERT INTO nodes(id,kind,label,status,metadata_json,created_at,updated_at) VALUES(?, 'note', ?, 'observed', ?, ?, ?) ON CONFLICT(id) DO UPDATE SET label=excluded.label, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at", (document["id"], document["label"], _json(document["metadata"]), now, now))
            conn.execute("INSERT INTO vault_documents(path,node_id,title,links_json,mtime_ns,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET node_id=excluded.node_id,title=excluded.title,links_json=excluded.links_json,mtime_ns=excluded.mtime_ns,updated_at=excluded.updated_at", (document["metadata"]["path"], document["id"], document["label"], _json(document.get("links", [])), document["mtime_ns"], now))
            node = {"id": document["id"], "kind": "note", "label": document["label"], "status": "observed", "color": None, "size": None, "pressure": None, "metadata": document["metadata"]}
            event_id = hashlib.sha1(f"vault:upsert:{_json(node)}".encode()).hexdigest()
            conn.execute("INSERT OR IGNORE INTO events(event_id,event_type,occurred_at,source,session_id,payload_json) VALUES(?,?,?,?,?,?)", (event_id, "scene.node_upsert", now, "vault", None, _json({"node": node})))
        for edge_id in stale_edges:
            conn.execute("DELETE FROM edges WHERE id = ?", (edge_id,))
            changed = True
            event_id = hashlib.sha1(f"vault:edge-delete:{edge_id}".encode()).hexdigest()
            conn.execute("INSERT OR IGNORE INTO events(event_id,event_type,occurred_at,source,session_id,payload_json) VALUES(?,?,?,?,?,?)", (event_id, "scene.edge_delete", now, "vault", None, _json({"id": edge_id})))
        for edge in next_edges.values():
            projected = {**edge, "kind": "references", "active": True}
            previous = existing_edges.get(edge["id"])
            if previous and previous["source_id"] == edge["source"] and previous["target_id"] == edge["target"]:
                continue
            changed = True
            conn.execute("INSERT INTO edges(id,source_id,target_id,kind,active,metadata_json,created_at,updated_at) VALUES(?,?,?,'references',1,?,?,?) ON CONFLICT(id) DO UPDATE SET source_id=excluded.source_id,target_id=excluded.target_id,active=1,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at", (edge["id"], edge["source"], edge["target"], _json(edge["metadata"]), now, now))
            event_id = hashlib.sha1(f"vault:edge-upsert:{_json(projected)}".encode()).hexdigest()
            conn.execute("INSERT OR IGNORE INTO events(event_id,event_type,occurred_at,source,session_id,payload_json) VALUES(?,?,?,?,?,?)", (event_id, "scene.edge_upsert", now, "vault", None, _json({"edge": projected})))
        conn.execute("INSERT INTO settings(key,value_json,updated_at) VALUES('vault_path',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at", (_json(vault_path), now))
    return changed


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


def replace_runtime_hydration_projection(
    provenance: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> None:
    """Reconcile one bounded hydration source without erasing live-hook state.

    The ownership ledger distinguishes entities first created by hydration from
    matching ids that existed before it. A later live hook changes ``updated_at``;
    stale hydration then drops only its ownership record and leaves that live
    projection intact.
    """
    next_nodes = {node["id"]: node for node in nodes}
    next_edges = {edge["id"]: edge for edge in edges}
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        event_rows: list[tuple[str, str, float, str, None, str]] = []

        def sync_entity(entity_kind: str, entity: dict[str, Any]) -> None:
            table = "nodes" if entity_kind == "node" else "edges"
            entity_id = entity["id"]
            existing = conn.execute(
                f"SELECT * FROM {table} WHERE id = ?", (entity_id,)
            ).fetchone()
            ownership = conn.execute(
                """
                SELECT projected_at, created_by_hydration
                FROM runtime_hydration_entities
                WHERE provenance = ? AND entity_kind = ? AND entity_id = ?
                """,
                (provenance, entity_kind, entity_id),
            ).fetchone()
            now = utc_timestamp()
            changed = False
            created = existing is None
            if entity_kind == "node":
                values = (
                    entity["kind"], entity["label"], entity["status"], entity.get("color"),
                    entity.get("size"), entity.get("pressure"), _json(entity.get("metadata", {})),
                )
                if existing is None:
                    conn.execute(
                        """
                        INSERT INTO nodes(
                            id, kind, label, status, color, size, pressure,
                            metadata_json, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (entity_id, *values, now, now),
                    )
                    changed = True
                else:
                    previous = (
                        existing["kind"], existing["label"], existing["status"],
                        existing["color"], existing["size"], existing["pressure"],
                        existing["metadata_json"],
                    )
                    if previous != values:
                        conn.execute(
                            """
                            UPDATE nodes SET kind = ?, label = ?, status = ?, color = ?,
                                size = ?, pressure = ?, metadata_json = ?, updated_at = ?
                            WHERE id = ?
                            """,
                            (*values, now, entity_id),
                        )
                        changed = True
            else:
                values = (
                    entity["source"], entity["target"], entity["kind"], int(entity.get("active", True)),
                    _json(entity.get("metadata", {})),
                )
                if existing is None:
                    conn.execute(
                        """
                        INSERT INTO edges(
                            id, source_id, target_id, kind, active,
                            metadata_json, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (entity_id, *values, now, now),
                    )
                    changed = True
                else:
                    previous = (
                        existing["source_id"], existing["target_id"], existing["kind"],
                        existing["active"], existing["metadata_json"],
                    )
                    if previous != values:
                        conn.execute(
                            """
                            UPDATE edges SET source_id = ?, target_id = ?, kind = ?, active = ?,
                                metadata_json = ?, updated_at = ? WHERE id = ?
                            """,
                            (*values, now, entity_id),
                        )
                        changed = True
            projected_at = now if changed else float(existing["updated_at"])
            created_by_hydration = int(
                ownership["created_by_hydration"] if ownership is not None else created
            )
            conn.execute(
                """
                INSERT INTO runtime_hydration_entities(
                    provenance, entity_kind, entity_id, projected_at, created_by_hydration
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(provenance, entity_kind, entity_id) DO UPDATE SET
                    projected_at = excluded.projected_at,
                    created_by_hydration = excluded.created_by_hydration
                """,
                (provenance, entity_kind, entity_id, projected_at, created_by_hydration),
            )
            if changed:
                event_rows.append(
                    (
                        str(uuid.uuid4()),
                        f"scene.{entity_kind}_upsert",
                        now,
                        f"runtime_hydration:{provenance}",
                        None,
                        _json({entity_kind: entity}),
                    )
                )

        for edge in next_edges.values():
            sync_entity("edge", edge)
        for node in next_nodes.values():
            sync_entity("node", node)

        def remove_stale(entity_kind: str, retained_ids: set[str]) -> None:
            table = "nodes" if entity_kind == "node" else "edges"
            owned = conn.execute(
                """
                SELECT entity_id, projected_at, created_by_hydration
                FROM runtime_hydration_entities
                WHERE provenance = ? AND entity_kind = ?
                """,
                (provenance, entity_kind),
            ).fetchall()
            for row in owned:
                entity_id = str(row["entity_id"])
                if entity_id in retained_ids:
                    continue
                current = conn.execute(
                    f"SELECT updated_at FROM {table} WHERE id = ?", (entity_id,)
                ).fetchone()
                now = utc_timestamp()
                if (
                    current is not None
                    and bool(row["created_by_hydration"])
                    and float(current["updated_at"]) == float(row["projected_at"])
                ):
                    conn.execute(f"DELETE FROM {table} WHERE id = ?", (entity_id,))
                    event_rows.append(
                        (
                            str(uuid.uuid4()),
                            f"scene.{entity_kind}_delete",
                            now,
                            f"runtime_hydration:{provenance}",
                            None,
                            _json({"id": entity_id}),
                        )
                    )
                conn.execute(
                    """
                    DELETE FROM runtime_hydration_entities
                    WHERE provenance = ? AND entity_kind = ? AND entity_id = ?
                    """,
                    (provenance, entity_kind, entity_id),
                )

        remove_stale("edge", set(next_edges))
        remove_stale("node", set(next_nodes))
        conn.executemany(
            """
            INSERT INTO events(event_id, event_type, occurred_at, source, session_id, payload_json)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            event_rows,
        )
