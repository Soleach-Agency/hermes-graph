"""Obsidian-compatible Markdown vault topology indexing."""

from __future__ import annotations

import hashlib
import re
import threading
import time
import atexit
from collections import defaultdict
from pathlib import Path
from urllib.parse import unquote

from .storage import apply_vault_delta, get_setting, get_snapshot, get_vault_counts, replace_vault_projection


WIKILINK_RE = re.compile(r"!??\[\[([^\]\n]+)\]\]")
_WATCHER_LOCK = threading.Lock()
_WATCHER: "VaultWatcher | None" = None


def _stable_id(prefix: str, value: str) -> str:
    digest = hashlib.sha1(value.encode("utf-8"), usedforsecurity=False).hexdigest()[:16]
    return f"{prefix}:{digest}"


def _is_vault_markdown(path: Path, root: Path) -> bool:
    relative = path.relative_to(root)
    return path.suffix.lower() == ".md" and not any(part.startswith(".") for part in relative.parts)


def _link_target(raw: str) -> str:
    target = unquote(raw.split("|", 1)[0]).strip()
    target = target.split("#", 1)[0].split("^", 1)[0].strip().replace("\\", "/")
    return target.removesuffix(".md").strip("/")


def _title(path: Path, text: str) -> str:
    for line in text[:8_000].splitlines():
        if line.startswith("# "):
            return line[2:].strip() or path.stem
    return path.stem


def index_vault(path_value: str | Path) -> dict[str, object]:
    root = Path(path_value).expanduser().resolve()
    if not root.is_dir():
        raise ValueError(f"Vault directory does not exist: {root}")

    records: list[dict[str, object]] = []
    aliases: dict[str, list[str]] = defaultdict(list)
    by_relative: dict[str, str] = {}

    for path in sorted(root.rglob("*.md")):
        if not _is_vault_markdown(path, root):
            continue
        relative = path.relative_to(root).as_posix()
        relative_key = relative.removesuffix(".md").casefold()
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
            mtime_ns = path.stat().st_mtime_ns
        except OSError:
            continue
        node_id = _stable_id("note", relative_key)
        title = _title(path, text)
        raw_links = [_link_target(match) for match in WIKILINK_RE.findall(text)]
        raw_links = [target for target in raw_links if target]
        record = {
            "id": node_id,
            "label": title,
            "mtime_ns": mtime_ns,
            "metadata": {
                "path": relative,
                "folder": path.parent.relative_to(root).as_posix(),
                "vault": root.name,
            },
            "raw_links": raw_links,
        }
        records.append(record)
        by_relative[relative_key] = node_id
        aliases[path.stem.casefold()].append(node_id)
        aliases[title.casefold()].append(node_id)

    def resolve(source_path: str, target: str) -> str | None:
        key = target.casefold()
        direct = by_relative.get(key)
        if direct:
            return direct
        source_parent = Path(source_path).parent
        relative_key = (source_parent / target).as_posix().removesuffix(".md").casefold()
        relative = by_relative.get(relative_key)
        if relative:
            return relative
        matches = aliases.get(Path(target).name.casefold(), [])
        return matches[0] if len(matches) == 1 else None

    edges: list[dict[str, object]] = []
    resolved_documents: list[dict[str, object]] = []
    seen_edges: set[tuple[str, str]] = set()
    for record in records:
        targets: list[str] = []
        for raw_target in record.pop("raw_links"):
            target_id = resolve(str(record["metadata"]["path"]), str(raw_target))
            pair = (str(record["id"]), target_id or "")
            if not target_id or target_id == record["id"] or pair in seen_edges:
                continue
            seen_edges.add(pair)
            targets.append(target_id)
            edges.append(
                {
                    "id": _stable_id("wikilink", f"{pair[0]}->{pair[1]}"),
                    "source": pair[0],
                    "target": pair[1],
                    "metadata": {"source": "vault"},
                }
            )
        record["links"] = targets
        resolved_documents.append(record)

    replace_vault_projection(str(root), resolved_documents, edges)
    return {"path": str(root), "name": root.name, "notes": len(resolved_documents), "links": len(edges)}


def _document(root: Path, path: Path) -> dict[str, object] | None:
    if not path.is_file() or not _is_vault_markdown(path, root):
        return None
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
        mtime_ns = path.stat().st_mtime_ns
    except OSError:
        return None
    relative = path.relative_to(root).as_posix()
    return {"id": _stable_id("note", relative.removesuffix(".md").casefold()), "label": _title(path, text), "mtime_ns": mtime_ns, "metadata": {"path": relative, "folder": path.parent.relative_to(root).as_posix(), "vault": root.name}, "raw_links": [_link_target(value) for value in WIKILINK_RE.findall(text)]}


def sync_vault_change(path_value: str | Path, path: str | Path, previous_path: str | Path | None = None) -> bool:
    """Apply one filesystem change without a full vault scan or rewrite."""
    root = Path(path_value).expanduser().resolve()
    current = Path(path)
    current = (current if current.is_absolute() else root / current).resolve()
    old_relative = None
    if previous_path:
        previous = Path(previous_path)
        previous = (previous if previous.is_absolute() else root / previous).resolve()
        try:
            old_relative = previous.relative_to(root).as_posix()
        except ValueError:
            return False
    document = _document(root, current)
    if document is None and old_relative is None:
        try:
            old_relative = current.relative_to(root).as_posix()
        except ValueError:
            return False
    if document is None and old_relative and any(part.startswith(".") for part in Path(old_relative).parts):
        return False
    notes = [node for node in get_snapshot()["nodes"] if node["kind"] == "note"]
    by_path = {str(node["metadata"].get("path", "")).removesuffix(".md").casefold(): node["id"] for node in notes}
    aliases: dict[str, list[str]] = defaultdict(list)
    for node in notes:
        aliases[Path(str(node["metadata"].get("path", ""))).stem.casefold()].append(node["id"])
        aliases[str(node["label"]).casefold()].append(node["id"])
    edges: list[dict[str, object]] = []
    source_id = None
    if document:
        source_id = str(document["id"])
        source_path = str(document["metadata"]["path"])
        by_path[source_path.removesuffix(".md").casefold()] = source_id
        aliases[Path(source_path).stem.casefold()].append(source_id)
        aliases[str(document["label"]).casefold()].append(source_id)
        targets: list[str] = []
        for raw in document.pop("raw_links"):
            target = by_path.get(str(raw).casefold()) or by_path.get((Path(source_path).parent / str(raw)).as_posix().casefold())
            if not target:
                matches = aliases.get(Path(str(raw)).name.casefold(), [])
                target = matches[0] if len(matches) == 1 else None
            if target and target != source_id and target not in targets:
                targets.append(target)
        document["links"] = targets
        edges = [{"id": _stable_id("wikilink", f"{source_id}->{target}"), "source": source_id, "target": target, "metadata": {"source": "vault"}} for target in targets]
    remove_paths = [old_relative] if old_relative and (not document or old_relative != document["metadata"]["path"]) else []
    return apply_vault_delta(str(root), [document] if document else [], edges, remove_paths=remove_paths, replace_edge_sources=[source_id] if source_id else [])


def reconcile_vault(path_value: str | Path) -> dict[str, object]:
    """Explicit full recovery for missed events, watcher overflow, and restart."""
    return {**index_vault(path_value), "recovered": True}


class VaultWatcher:
    """Dependency-free local watcher with deterministic polling reconciliation."""

    def __init__(self, root: str | Path, interval: float = 1.0):
        self.root = Path(root).expanduser().resolve()
        self.interval = interval
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._state: dict[str, int] = {}

    def _scan(self) -> dict[str, int]:
        if not self.root.is_dir():
            return {}
        result: dict[str, int] = {}
        for item in self.root.rglob("*.md"):
            if _is_vault_markdown(item, self.root):
                try:
                    result[item.relative_to(self.root).as_posix()] = item.stat().st_mtime_ns
                except OSError:
                    pass
        return result

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._state = self._scan()
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="hermes-graph-vault", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=max(1.0, self.interval * 3))

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def poll_once(self) -> bool:
        """Apply one polling delta; public for deterministic recovery tests."""
        if not self.root.is_dir():
            return False
        current = self._scan()
        changed = False
        for relative in sorted(set(self._state) | set(current)):
            if self._state.get(relative) != current.get(relative):
                changed = sync_vault_change(self.root, relative) or changed
        self._state = current
        return changed

    def _run(self) -> None:
        unavailable = False
        while not self._stop.wait(self.interval):
            if not self.root.is_dir():
                unavailable = True
                continue
            if unavailable:
                reconcile_vault(self.root)
                self._state = self._scan()
                unavailable = False
            self.poll_once()


def configure_vault(path_value: str | Path) -> dict[str, object]:
    """Full connect/refresh plus exactly one active watcher for the selected vault."""
    global _WATCHER
    result = index_vault(path_value)
    root = Path(result["path"])
    _start_vault_watcher(root)
    return {**result, "watching": bool(_WATCHER and _WATCHER.running)}


def _start_vault_watcher(root: Path) -> None:
    """Keep exactly one watcher alive for the selected resolved Vault root."""
    global _WATCHER
    with _WATCHER_LOCK:
        if _WATCHER and _WATCHER.root != root:
            _WATCHER.stop()
            _WATCHER = None
        if _WATCHER is None:
            _WATCHER = VaultWatcher(root)
            _WATCHER.start()


def resume_configured_vault_watcher() -> bool:
    """Recover missed changes and resume the persisted Vault after Dashboard restart."""
    path = get_setting("vault_path")
    if not path:
        return False
    root = Path(path).expanduser().resolve()
    if not root.is_dir():
        return False
    reconcile_vault(root)
    _start_vault_watcher(root)
    return bool(_WATCHER and _WATCHER.running)


def stop_vault_watcher() -> None:
    global _WATCHER
    with _WATCHER_LOCK:
        if _WATCHER:
            _WATCHER.stop()
        _WATCHER = None


atexit.register(stop_vault_watcher)


def vault_status() -> dict[str, object]:
    path = get_setting("vault_path")
    if not path:
        return {"configured": False, "path": "", "name": "", "notes": 0, "links": 0}
    root = Path(path)
    notes, links = get_vault_counts()
    return {
        "configured": True,
        "path": str(root),
        "name": root.name,
        "available": root.is_dir(),
        "notes": notes,
        "links": links,
        "watching": bool(_WATCHER and _WATCHER.running),
    }
