"""Hermes lifecycle hook normalization and scene projection."""

from __future__ import annotations

import hashlib
import json
import re
import time
from typing import Any, Callable

from .storage import (
    cleanup_expired,
    get_setting,
    record_event,
    resolve_vault_node_ids,
    upsert_edge as store_upsert_edge,
    upsert_node as store_upsert_node,
)


HOOKS = (
    "pre_tool_call",
    "post_tool_call",
    "pre_api_request",
    "post_api_request",
    "api_request_error",
    "on_session_start",
    "on_session_end",
    "on_session_finalize",
    "on_session_reset",
    "subagent_start",
    "subagent_stop",
    "kanban_task_claimed",
    "kanban_task_completed",
    "kanban_task_blocked",
)


def _clean(value: Any, depth: int = 0) -> Any:
    """Keep observer payloads compact and JSON-safe without storing raw prompts."""
    if depth > 4:
        return "[truncated]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value if len(value) <= 1000 else value[:1000] + "…"
    if isinstance(value, dict):
        blocked = {
            "assistant_message",
            "conversation_history",
            "output",
            "prompt",
            "request_messages",
            "result",
            "tool_result",
            "user_message",
            "messages",
        }
        secret_fragments = ("password", "secret", "token", "api_key", "authorization", "cookie")
        cleaned = {}
        for key, item in value.items():
            normalized = str(key).lower()
            if normalized in blocked:
                continue
            if any(fragment in normalized for fragment in secret_fragments):
                cleaned[str(key)] = "[redacted]"
            else:
                cleaned[str(key)] = _clean(item, depth + 1)
        return cleaned
    if isinstance(value, (list, tuple)):
        return [_clean(item, depth + 1) for item in value[:50]]
    return str(value)


def _id(prefix: str, value: Any) -> str:
    raw = str(value or "unknown")
    digest = hashlib.sha1(raw.encode("utf-8"), usedforsecurity=False).hexdigest()[:12]
    return f"{prefix}:{digest}"


def _session_id(payload: dict[str, Any]) -> str | None:
    value = payload.get("session_id") or payload.get("child_session_id")
    return str(value) if value else None


def _usage_pressure(payload: dict[str, Any]) -> float | None:
    usage = payload.get("usage") or {}
    if not isinstance(usage, dict):
        return None
    used = (
        usage.get("prompt_tokens")
        or usage.get("input_tokens")
        or usage.get("total_tokens")
        or payload.get("approx_input_tokens")
    )
    maximum = (
        payload.get("context_limit")
        or payload.get("max_context_tokens")
        or payload.get("context_length")
    )
    try:
        if used is None or not maximum or float(maximum) <= 0:
            return None
        return max(0.0, min(1.0, float(used) / float(maximum)))
    except (TypeError, ValueError):
        return None


def _canonical_tool_name(tool_name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", tool_name.casefold()).strip("_")


def _tool_rule(tool_name: str) -> dict[str, str] | None:
    preferences = get_setting("graph_preferences", {})
    rules = preferences.get("toolRules", []) if isinstance(preferences, dict) else []
    canonical = _canonical_tool_name(tool_name)
    for candidate in rules if isinstance(rules, list) else []:
        if not isinstance(candidate, dict):
            continue
        if _canonical_tool_name(str(candidate.get("tool") or "")) != canonical:
            continue
        direction = str(candidate.get("direction") or "local").lower()
        if direction not in {"vault", "external", "local"}:
            direction = "local"
        return {
            "tool": str(candidate.get("tool") or tool_name),
            "direction": direction,
            "referenceField": str(candidate.get("referenceField") or "").strip(),
        }
    return None


def _tool_direction(tool_name: str) -> str:
    rule = _tool_rule(tool_name)
    if rule:
        return rule["direction"]
    return _heuristic_tool_direction(tool_name)


def _heuristic_tool_direction(tool_name: str) -> str:
    normalized = tool_name.lower()
    vault_terms = ("rag", "semantic", "fuzzy", "vault", "memory", "note", "obsidian")
    external_terms = (
        "browser",
        "github",
        "http",
        "krea",
        "mcp",
        "search",
        "web",
    )
    if any(term in normalized for term in vault_terms):
        return "vault"
    if any(term in normalized for term in external_terms):
        return "external"
    return "local"


def _result_count(value: Any) -> int:
    if isinstance(value, (list, tuple)):
        return min(20, len(value))
    if isinstance(value, dict):
        for key in ("results", "items", "data", "matches"):
            candidate = value.get(key)
            if isinstance(candidate, (list, tuple)):
                return min(20, len(candidate))
        return 1 if value else 0
    if isinstance(value, str) and len(value) <= 1_000_000:
        try:
            return _result_count(json.loads(value))
        except (TypeError, ValueError):
            return 1 if value.strip() else 0
    return 1 if value is not None else 0


def _result_references(
    value: Any, depth: int = 0, reference_field: str | None = None
) -> list[str]:
    """Extract only short note identifiers from tool output, never result content."""
    if depth > 4:
        return []
    if isinstance(value, str):
        if len(value) <= 1_000_000:
            if depth == 0:
                try:
                    return _result_references(json.loads(value), depth + 1, reference_field)
                except (TypeError, ValueError):
                    pass
            field = (reference_field or "").casefold().strip()
            if field:
                localized_labels = {
                    "path": {"path", "yol"},
                    "file": {"file", "dosya"},
                    "filepath": {"filepath", "file path", "dosya yolu"},
                    "source": {"source", "kaynak"},
                    "title": {"title", "başlık", "baslik"},
                }
                labels = localized_labels.get(field, {field})
                found: list[str] = []
                for line in value.splitlines():
                    cleaned = line.strip().removeprefix(">").strip()
                    label, separator, candidate = cleaned.partition(":")
                    if separator and label.casefold().strip() in labels:
                        candidate = candidate.strip().strip("`")
                        if candidate and len(candidate) <= 500:
                            found.append(candidate)
                    if len(found) >= 20:
                        break
                if found or len(value) > 500:
                    return found
        if reference_field:
            return []
        return [value] if len(value) <= 500 else []
    if isinstance(value, (list, tuple)):
        found: list[str] = []
        for item in value[:20]:
            found.extend(_result_references(item, depth + 1, reference_field))
            if len(found) >= 20:
                break
        return found[:20]
    if isinstance(value, dict):
        found = []
        reference_keys = (
            {reference_field.casefold()}
            if reference_field
            else {"file", "filepath", "note", "path", "source", "title"}
        )
        for key, item in value.items():
            if str(key).lower() in reference_keys and isinstance(item, str) and len(item) <= 500:
                found.append(item)
            elif isinstance(item, (dict, list, tuple)) or (
                reference_field and isinstance(item, str)
            ):
                found.extend(_result_references(item, depth + 1, reference_field))
            if len(found) >= 20:
                break
        return found[:20]
    return []


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
    node = {
        "id": node_id,
        "kind": kind,
        "label": label,
        "status": status,
        "color": color,
        "size": size,
        "pressure": pressure,
        "metadata": metadata or {},
    }
    store_upsert_node(
        node_id,
        kind,
        label,
        status=status,
        color=color,
        size=size,
        pressure=pressure,
        metadata=metadata,
    )
    record_event("scene.node_upsert", {"node": node}, source="projection")


def upsert_edge(
    edge_id: str,
    source_id: str,
    target_id: str,
    kind: str,
    *,
    active: bool = True,
    metadata: dict[str, Any] | None = None,
) -> None:
    edge = {
        "id": edge_id,
        "source": source_id,
        "target": target_id,
        "kind": kind,
        "active": active,
        "metadata": metadata or {},
    }
    store_upsert_edge(
        edge_id,
        source_id,
        target_id,
        kind,
        active=active,
        metadata=metadata,
    )
    record_event("scene.edge_upsert", {"edge": edge}, source="projection")


def project(event_name: str, payload: dict[str, Any]) -> None:
    session = _session_id(payload)
    session_node = _id("session", session) if session else None

    if event_name == "on_session_start" and session_node:
        upsert_node(
            session_node,
            "session",
            str(payload.get("title") or session or "Session"),
            status="active",
            metadata={"platform": payload.get("platform")},
        )
    elif event_name in {"on_session_end", "on_session_finalize", "on_session_reset"} and session_node:
        if event_name == "on_session_finalize":
            status = "completed"
        elif event_name == "on_session_reset":
            status = "reset"
        else:
            # on_session_end fires after each run_conversation call, not only
            # when the session itself is permanently closed.
            status = "interrupted" if payload.get("interrupted") else "idle"
        metadata = {"platform": payload.get("platform")}
        if status in {"completed", "reset"}:
            metadata["completedAt"] = time.time()
        upsert_node(
            session_node,
            "session",
            str(payload.get("title") or session or "Session"),
            status=status,
            metadata=metadata,
        )
    elif event_name == "subagent_start":
        # child_session_id exists on both start and stop payloads; use it as
        # the stable identity so the completion event updates the same node.
        child_key = payload.get("child_session_id") or payload.get("child_subagent_id")
        parent_key = payload.get("parent_subagent_id") or payload.get("parent_session_id")
        child = _id("agent", child_key)
        parent = _id("agent", parent_key)
        upsert_node(
            parent,
            "agent",
            str(parent_key or "Parent agent"),
            status="active",
        )
        upsert_node(
            child,
            "subagent",
            str(payload.get("child_role") or child_key or "Subagent"),
            status="active",
            metadata={"goal": payload.get("child_goal")},
        )
        upsert_edge(f"spawned:{parent}:{child}", parent, child, "spawned")
    elif event_name == "subagent_stop":
        child_key = (
            payload.get("child_subagent_id")
            or payload.get("subagent_id")
            or payload.get("child_session_id")
        )
        child = _id("agent", child_key)
        child_status = str(payload.get("child_status") or "completed")
        metadata = {"durationMs": payload.get("duration_ms")}
        if child_status.lower() in {"completed", "done", "stopped"}:
            metadata["completedAt"] = time.time()
        upsert_node(
            child,
            "subagent",
            str(payload.get("child_role") or child_key or "Subagent"),
            status=child_status,
            metadata=metadata,
        )
    elif event_name in {"pre_tool_call", "post_tool_call"}:
        tool_name = payload.get("tool_name") or payload.get("name") or "tool"
        owner_key = payload.get("task_id") or payload.get("turn_id") or session or "global"
        owner = _id("agent", owner_key) if owner_key != session else session_node
        tool = _id("tool", f"{owner_key}:{tool_name}")
        rule = _tool_rule(str(tool_name))
        direction = rule["direction"] if rule else _heuristic_tool_direction(str(tool_name))
        upsert_node(
            tool,
            "tool",
            str(tool_name),
            status="active" if event_name == "pre_tool_call" else "observed",
            metadata={
                "direction": direction,
                "owner": owner,
                "referenceField": rule["referenceField"] if rule else "",
            },
        )
        if owner:
            owner_kind = "session" if owner == session_node else "agent"
            upsert_node(owner, owner_kind, str(owner_key), status="active")
            if session_node and owner != session_node:
                upsert_edge(
                    f"belongs:{owner}:{session_node}",
                    owner,
                    session_node,
                    "belongs_to",
                )
            if payload.get("task_id"):
                task = _id("task", payload["task_id"])
                upsert_edge(f"works-on:{owner}:{task}", owner, task, "works_on")
            called_at = time.time()
            upsert_edge(
                f"called:{owner}:{tool}",
                owner,
                tool,
                "called",
                metadata={"createdAt": called_at, "ttlSeconds": 30},
            )
        if event_name == "post_tool_call" and direction == "external":
            created_at = time.time()
            for result_index in range(int(payload.get("result_count") or 0)):
                result = _id("result", f"{tool}:{created_at}:{result_index}")
                upsert_node(
                    result,
                    "result",
                    f"{tool_name} result {result_index + 1}",
                    status="active",
                    metadata={
                        "tool": tool,
                        "createdAt": created_at,
                        "ttlSeconds": 30,
                    },
                )
                upsert_edge(
                    f"returned:{tool}:{result}",
                    tool,
                    result,
                    "returned",
                    metadata={"createdAt": created_at, "ttlSeconds": 30},
                )
        elif event_name == "post_tool_call" and direction == "vault":
            created_at = time.time()
            for note_id in payload.get("result_node_ids") or []:
                upsert_edge(
                    f"retrieved:{tool}:{note_id}:{created_at}",
                    tool,
                    note_id,
                    "retrieved",
                    metadata={"createdAt": created_at, "ttlSeconds": 30},
                )
    elif event_name in {"pre_api_request", "post_api_request", "api_request_error"}:
        agent_key = payload.get("task_id") or payload.get("turn_id") or session
        agent = _id("agent", agent_key)
        pressure = _usage_pressure(payload)
        status = "failed" if event_name == "api_request_error" else "active"
        upsert_node(
            agent,
            "agent",
            str(payload.get("model") or "Hermes agent"),
            status=status,
            pressure=pressure,
            metadata={
                "model": payload.get("model"),
                "provider": payload.get("provider"),
                "sessionId": session,
            },
        )
        if session_node:
            upsert_node(session_node, "session", str(session), status="active")
            upsert_edge(f"belongs:{agent}:{session_node}", agent, session_node, "belongs_to")
    elif event_name.startswith("kanban_task_"):
        task_key = payload.get("task_id")
        task = _id("task", task_key)
        status = event_name.removeprefix("kanban_task_")
        metadata = {
            "board": payload.get("board"),
            "assignee": payload.get("assignee"),
            "reason": payload.get("reason"),
        }
        if status == "completed":
            metadata["completedAt"] = time.time()
            status = "done"
        elif status == "claimed":
            status = "doing"
        upsert_node(
            task,
            "task",
            str(payload.get("title") or task_key or "Kanban task"),
            status=status,
            metadata=metadata,
        )
        assignee = payload.get("assignee")
        if assignee:
            agent = _id("agent", assignee)
            upsert_node(agent, "agent", str(assignee), status="active")
            upsert_edge(f"assigned:{task}:{agent}", task, agent, "assigned_to")


def make_observer(event_name: str, profile_name: str | None = None) -> Callable[..., None]:
    def observer(**kwargs: Any) -> None:
        # Catch up missed TTL work on every local lifecycle callback. The
        # snapshot endpoint also runs the same idempotent transaction.
        cleanup_expired()
        payload = _clean(kwargs)
        if profile_name and not payload.get("profile_name"):
            payload["profile_name"] = profile_name
        if event_name == "post_tool_call":
            raw_result = kwargs.get("result", kwargs.get("tool_result"))
            payload["result_count"] = _result_count(raw_result)
            tool_name = str(kwargs.get("tool_name") or kwargs.get("name") or "tool")
            rule = _tool_rule(tool_name)
            if (rule["direction"] if rule else _heuristic_tool_direction(tool_name)) == "vault":
                payload["result_node_ids"] = resolve_vault_node_ids(
                    _result_references(
                        raw_result,
                        reference_field=rule["referenceField"] if rule else None,
                    )
                )
        session = _session_id(payload)
        record_event(event_name, payload, session_id=session)
        project(event_name, payload)

    observer.__name__ = f"observe_{event_name}"
    return observer


def register_hooks(ctx: Any) -> None:
    profile_name = getattr(ctx, "profile_name", None)
    for hook_name in HOOKS:
        ctx.register_hook(hook_name, make_observer(hook_name, profile_name))
