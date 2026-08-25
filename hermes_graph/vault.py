"""Obsidian-compatible Markdown vault topology indexing."""

from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from pathlib import Path
from urllib.parse import unquote

from .storage import get_setting, get_vault_counts, replace_vault_projection


WIKILINK_RE = re.compile(r"!??\[\[([^\]\n]+)\]\]")


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
    return {
        "path": str(root),
        "name": root.name,
        "notes": len(resolved_documents),
        "links": len(edges),
    }


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
    }
