"""Canonical serialization + SHA-256 integrity for decision records (Layer 5).

The canonical form is deterministic: sorted keys, no whitespace, UTF-8, stable
value coercion. The record hash always covers the canonical form WITHOUT the
hash/anchoring fields themselves.
"""

import hashlib
import json
from datetime import date, datetime
from decimal import Decimal


def _stable(value):
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {k: _stable(v) for k, v in sorted(value.items())}
    if isinstance(value, (list, tuple)):
        return [_stable(v) for v in value]
    return value


def canonical_json(payload: dict) -> str:
    """Deterministic JSON string — the byte-exact input to the hash."""
    return json.dumps(_stable(payload), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def hash_record(canonical_payload: dict) -> tuple[str, str]:
    """Returns (hash, canonical_json_string)."""
    text = canonical_json(canonical_payload)
    return sha256_hex(text), text
