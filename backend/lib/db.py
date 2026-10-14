"""Shared Mongo handle — import `client`/`db` from here (server.py, routers, seed.py)."""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel

load_dotenv(Path(__file__).parent.parent / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logger = logging.getLogger(__name__)


def clean(doc: dict | None) -> dict | None:
    """Strip Mongo's _id so it never leaks into a JSON response."""
    if doc is None:
        return None
    doc = dict(doc)
    doc.pop("_id", None)
    return doc


# One entry per collection: every field a route filters, sorts, or dedupes on. Applied by ensure_indexes() at startup.
INDEXES: dict[str, list[IndexModel]] = {
    "status_checks": [IndexModel([("timestamp", DESCENDING)], name="timestamp_desc")],
    "users": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("role", ASCENDING)], name="role"),
    ],
    "datasets": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("created_at", DESCENDING)], name="created_desc"),
    ],
    "dataset_rows": [
        IndexModel([("dataset_id", ASCENDING), ("source_file", ASCENDING), ("row_number", ASCENDING)], name="dataset_file_row"),
    ],
    "findings": [
        IndexModel([("dataset_id", ASCENDING), ("kind", ASCENDING)], name="dataset_kind"),
        IndexModel([("run_id", ASCENDING)], name="run_id"),
    ],
    "documents": [IndexModel([("id", ASCENDING)], name="id", unique=True)],
    "agent_runs": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("dataset_id", ASCENDING), ("started_at", DESCENDING)], name="dataset_started"),
    ],
    "cases": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("status", ASCENDING), ("created_at", DESCENDING)], name="status_created"),
    ],
    "optimization_runs": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("case_id", ASCENDING), ("created_at", DESCENDING)], name="case_created"),
    ],
    "approvals": [
        IndexModel([("case_id", ASCENDING), ("ts", DESCENDING)], name="case_ts"),
    ],
    "decision_records": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("case_id", ASCENDING)], name="case_id"),
        IndexModel([("hash", ASCENDING)], name="hash"),
    ],
    "ledger_state": [IndexModel([("key", ASCENDING)], name="key", unique=True)],
    "ledger_txs": [
        IndexModel([("tx_hash", ASCENDING)], name="tx_hash", unique=True),
        IndexModel([("decision_id", ASCENDING)], name="decision_id"),
    ],
    "audit_events": [
        IndexModel([("ts", DESCENDING)], name="ts_desc"),
        IndexModel([("action", ASCENDING)], name="action"),
    ],
    "settings": [IndexModel([("key", ASCENDING)], name="key", unique=True)],
    "demo_metadata": [IndexModel([("key", ASCENDING)], name="key", unique=True)],
    "eval_results": [IndexModel([("created_at", DESCENDING)], name="created_desc")],
}


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:  # one at a time so a bad spec skips only itself
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:  # never block boot on an index; the log line names what to fix
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)
