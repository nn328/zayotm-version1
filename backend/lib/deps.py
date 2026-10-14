"""Demo identity + role-based authorization (Layer 2).

Prototype identity model: seeded demo users, acting identity sent as the
X-Acting-User-Id header by the frontend (no passwords in the demo). Every
role-restricted route is enforced SERVER-SIDE; production SSO is an
integration point, not implemented here — documented as future work.
"""

from fastapi import Request

from lib.db import db
from lib.errors import ApiError


async def get_actor(request: Request) -> dict:
    uid = request.headers.get("x-acting-user-id", "")
    if not uid:
        raise ApiError(401, "no_actor", "Missing X-Acting-User-Id — pick a demo identity first.")
    user = await db.users.find_one({"id": uid})
    if not user:
        raise ApiError(401, "unknown_actor", "Unknown demo identity. Reload the identity list.")
    from lib.db import clean

    return clean(user) or {}


def require_roles(user: dict, roles: set[str], action: str) -> None:
    if user.get("role") not in roles:
        raise ApiError(
            403,
            "role_denied",
            f"Role '{user.get('role')}' is not authorized to {action}. "
            f"Allowed: {', '.join(sorted(roles))}. Switch the demo identity in the top bar.",
            {"required_roles": sorted(roles), "your_role": user.get("role")},
        )


ROLE_PERMISSIONS = {
    "executive": {"run": True, "approve": True, "configure": True},
    "approver": {"run": True, "approve": True, "configure": False},
    "analyst": {"run": True, "approve": False, "configure": False},
}
