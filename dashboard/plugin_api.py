"""Dashboard API routes for Hermes Graph."""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel


PLUGIN_ROOT = Path(__file__).resolve().parent.parent
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from hermes_graph.storage import (  # noqa: E402
    get_events,
    get_snapshot,
    get_snapshot_at,
    get_timeline_range,
)
from hermes_graph.vault import (  # noqa: E402
    configure_vault as configure_vault_index,
    resume_configured_vault_watcher,
    vault_status,
)


resume_configured_vault_watcher()


router = APIRouter()


class VaultConfiguration(BaseModel):
    path: str


@router.get("/snapshot")
async def snapshot(at: int | None = Query(default=None, ge=0)):
    if at is not None:
        return await asyncio.to_thread(get_snapshot_at, at)
    return await asyncio.to_thread(get_snapshot)


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
