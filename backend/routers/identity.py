"""Demo identity router — role switcher source of truth."""

from fastapi import APIRouter

from lib.db import clean, db
from lib.deps import ROLE_PERMISSIONS

router = APIRouter(prefix="/identity", tags=["identity"])


@router.get("/users")
async def list_users():
    users = await db.users.find().sort("role", 1).to_list(50)
    return [
        {
            "id": u["id"],
            "name": u["name"],
            "role": u["role"],
            "title": u.get("title", ""),
            "permissions": ROLE_PERMISSIONS.get(u["role"], {}),
        }
        for u in map(clean, users)
        if u
    ]
