"""Audit router — chronological, filterable workflow event log (Layer 5)."""

from fastapi import APIRouter, Query

from lib.db import clean, db

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("")
async def list_events(
    action: str = Query(default=""),
    actor: str = Query(default=""),
    entity_type: str = Query(default=""),
    q: str = Query(default=""),
    limit: int = Query(default=150, le=500),
):
    query: dict = {}
    if action:
        query["action"] = {"$regex": action, "$options": "i"}
    if actor:
        query["actor"] = {"$regex": actor, "$options": "i"}
    if entity_type:
        query["entity_type"] = entity_type
    if q:
        query["summary"] = {"$regex": q, "$options": "i"}
    events = [clean(e) for e in await db.audit_events.find(query).sort("ts", -1).to_list(limit)]
    return [e for e in events if e]
