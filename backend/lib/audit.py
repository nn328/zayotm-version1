"""Audit trail helper — every consequential action writes an immutable event (Layer 5)."""

from datetime import datetime, timezone

from lib.db import db


async def audit(action: str, actor: str, actor_role: str, entity_type: str, entity_id: str, summary: str, metadata: dict | None = None) -> str:
    event = {
        "id": __import__("uuid").uuid4().hex,
        "ts": datetime.now(timezone.utc),
        "actor": actor,
        "actor_role": actor_role,
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "summary": summary,
        "metadata": metadata or {},
    }
    await db.audit_events.insert_one(event)
    return event["id"]
