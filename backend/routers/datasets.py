"""Datasets router — sample loading, CSV upload, schema/quality inspection."""

import csv
import io
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile

from lib.audit import audit
from lib.db import clean, db
from lib.deps import get_actor
from lib.demo_content import ensure_demo_content
from lib.engines.data_understanding import profile_file
from lib.errors import ApiError

router = APIRouter(prefix="/datasets", tags=["datasets"])

SAMPLE_DIR = Path(__file__).parent.parent / "sample_data"
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_ROWS = 5000


def _read_csv_rows(text: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        cleaned = {(k or "").strip(): (v if v is not None else "") for k, v in row.items() if k}
        rows.append(cleaned)
        if len(rows) >= MAX_ROWS:
            break
    return rows


async def _ingest(name: str, source: str, files: list[tuple[str, list[dict]]], actor: dict) -> dict:
    dataset_id = uuid.uuid4().hex
    profiles = []
    total_rows = 0
    for file_name, rows in files:
        profile = profile_file(file_name, rows)
        profiles.append(profile)
        total_rows += len(rows)
        docs = [
            {"id": uuid.uuid4().hex, "dataset_id": dataset_id, "source_file": file_name, "row_number": i, "data": row}
            for i, row in enumerate(rows)
        ]
        if docs:
            await db.dataset_rows.insert_many(docs)

    dataset = {
        "id": dataset_id,
        "name": name,
        "source": source,
        "files": profiles,
        "total_rows": total_rows,
        "quality_score": min((p["quality"]["score"] for p in profiles), default=0),
        "created_at": datetime.now(timezone.utc),
        "created_by": actor["name"],
    }
    await db.datasets.insert_one(dict(dataset))  # copy: insert_one injects a non-JSON _id
    await audit(
        "dataset.loaded",
        actor["name"],
        actor["role"],
        "dataset",
        dataset_id,
        f"Dataset '{name}' ingested: {len(files)} file(s), {total_rows} rows, quality {dataset['quality_score']}/100.",
        {"source": source, "files": [p["file"] for p in profiles]},
    )
    return dataset


@router.post("/load-sample")
async def load_sample(actor: dict = Depends(get_actor)):
    await ensure_demo_content()
    if not SAMPLE_DIR.exists():
        raise ApiError(500, "sample_data_missing", "Bundled sample data directory is missing on the server.")
    files = []
    for csv_path in sorted(SAMPLE_DIR.glob("*.csv")):
        rows = _read_csv_rows(csv_path.read_text(encoding="utf-8"))
        files.append((csv_path.stem, rows))
    if not files:
        raise ApiError(500, "sample_data_missing", "No sample CSV files found on the server.")
    dataset = await _ingest("Q4-2025 Procurement & Supply Chain Operations (sample)", "sample", files, actor)
    return dataset


@router.post("/upload")
async def upload(actor: dict = Depends(get_actor), files: list[UploadFile] = File(...)):
    parsed = []
    notes = []
    for f in files[:5]:
        content = await f.read()
        if len(content) > MAX_FILE_BYTES:
            raise ApiError(413, "file_too_large", f"{f.filename}: files are limited to 5 MB in this prototype.")
        text = content.decode("utf-8-sig", errors="replace")
        try:
            rows = _read_csv_rows(text)
        except Exception as exc:  # noqa: BLE001
            raise ApiError(422, "bad_csv", f"{f.filename}: could not parse as CSV ({exc}).") from exc
        if not rows:
            raise ApiError(422, "bad_csv", f"{f.filename}: no rows parsed — is it a headered CSV?")
        name = (f.filename or f"upload-{len(parsed) + 1}").rsplit(".", 1)[0][:60]
        if len(text.splitlines()) - 1 > MAX_ROWS:
            notes.append(f"{name}: truncated to the first {MAX_ROWS} rows.")
        parsed.append((name, rows))
    dataset = await _ingest(f"Uploaded dataset ({', '.join(n for n, _ in parsed)})", "upload", parsed, actor)
    return {**(clean(dataset) or {}), "notes": notes}


@router.get("")
async def list_datasets():
    out = []
    async for d in db.datasets.find().sort("created_at", -1):
        d = clean(d) or {}
        out.append(d)
    return out


@router.get("/{dataset_id}")
async def get_dataset(dataset_id: str):
    dataset = clean(await db.datasets.find_one({"id": dataset_id}))
    if not dataset:
        raise ApiError(404, "not_found", "Dataset not found.")
    rows = [clean(r) for r in await db.dataset_rows.find({"dataset_id": dataset_id}).sort("row_number", 1).to_list(200)]
    return {**dataset, "sample_rows": rows[:60]}


@router.get("/{dataset_id}/findings")
async def get_findings(dataset_id: str):
    findings = [clean(f) for f in await db.findings.find({"dataset_id": dataset_id}).sort("ts", -1).to_list(1000)]
    return [f for f in findings if f]
