"""Dashboard API routes for Hermes Graph."""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field


PLUGIN_ROOT = Path(__file__).resolve().parent.parent
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from hermes_graph.storage import (  # noqa: E402
    get_events,
    get_cursor_timestamp,
    get_setting,
    get_snapshot,
    get_snapshot_at,
    get_timeline_range,
    set_setting,
)
from hermes_graph.vault import (  # noqa: E402
    configure_vault as configure_vault_index,
    resume_configured_vault_watcher,
    vault_status,
)


resume_configured_vault_watcher()


router = APIRouter()


def _model_payload(model: BaseModel) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


class VaultConfiguration(BaseModel):
    path: str


class ToolRoutingRule(BaseModel):
    tool: str
    direction: Literal["vault", "external", "local"]
    referenceField: str = ""


class PlaybackDurationSetting(BaseModel):
    value: float = Field(default=1, ge=0.1, le=1000)
    unit: Literal["seconds", "minutes", "hours"] = "seconds"


class PlaybackPreferences(BaseModel):
    mode: Literal["fixed-duration", "per-source-hour"] = "fixed-duration"
    fixedDuration: PlaybackDurationSetting = Field(
        default_factory=lambda: PlaybackDurationSetting(value=24)
    )
    perSourceHour: PlaybackDurationSetting = Field(
        default_factory=PlaybackDurationSetting
    )


class GraphPreferences(BaseModel):
    theme: dict[str, Any]
    toolRules: list[ToolRoutingRule]
    playback: PlaybackPreferences = Field(default_factory=PlaybackPreferences)


@router.get("/snapshot")
async def snapshot(at: int | None = Query(default=None, ge=0)):
    if at is not None:
        result = await asyncio.to_thread(get_snapshot_at, at)
        result["asOf"] = await asyncio.to_thread(get_cursor_timestamp, result["cursor"])
        result["historical"] = True
        return result
    result = await asyncio.to_thread(get_snapshot)
    result["asOf"] = time.time()
    result["historical"] = False
    return result


@router.get("/events")
async def events(
    after: int = Query(default=0, ge=0),
    limit: int = Query(default=1000, ge=1, le=5000),
):
    items = await asyncio.to_thread(get_events, after, limit)
    cursor = items[-1]["sequence"] if items else after
    return {"cursor": cursor, "events": items}


@router.get("/timeline/range")
async def timeline_range(seconds: float | None = Query(default=None, gt=0)):
    return await asyncio.to_thread(get_timeline_range, seconds)


@router.get("/vault")
async def vault():
    return await asyncio.to_thread(vault_status)


@router.get("/settings")
async def settings():
    return await asyncio.to_thread(
        get_setting,
        "graph_preferences",
        {
            "theme": {},
            "toolRules": [],
            "playback": _model_payload(PlaybackPreferences()),
        },
    )


@router.put("/settings")
async def save_settings(preferences: GraphPreferences):
    rules: list[dict[str, str]] = []
    seen: set[str] = set()
    for rule in preferences.toolRules[:100]:
        tool = rule.tool.strip()[:200]
        if not tool or tool.casefold() in seen:
            continue
        seen.add(tool.casefold())
        rules.append(
            {
                "tool": tool,
                "direction": rule.direction,
                "referenceField": rule.referenceField.strip()[:100],
            }
        )
    value = {
        "theme": preferences.theme,
        "toolRules": rules,
        "playback": _model_payload(preferences.playback),
    }
    await asyncio.to_thread(set_setting, "graph_preferences", value)
    return value


@router.post("/vault/configure")
async def configure_vault_route(configuration: VaultConfiguration):
    try:
        return await asyncio.to_thread(configure_vault_index, configuration.path)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.websocket("/stream")
async def stream(websocket: WebSocket, after: int = 0):
    await websocket.accept()
    cursor = max(0, after)
    last_heartbeat = time.monotonic()
    try:
        while True:
            items = await asyncio.to_thread(get_events, cursor, 1000)
            if items:
                cursor = items[-1]["sequence"]
                await websocket.send_json({"cursor": cursor, "events": items})
                last_heartbeat = time.monotonic()
            elif time.monotonic() - last_heartbeat >= 10:
                await websocket.send_json({"cursor": cursor, "events": []})
                last_heartbeat = time.monotonic()
            await asyncio.sleep(0.35)
    except WebSocketDisconnect:
        return
