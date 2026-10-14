"""ZaYoTm seed script — idempotent. Run: cd /app/backend && python seed.py

Seeds demo users, the policy corpus, ground-truth metadata, settings, and loads
the bundled sample dataset through the same ingestion path the API uses.
Not imported by server.py.
"""

import asyncio

from lib.db import client, db, ensure_indexes
from lib.demo_content import ensure_demo_content


async def main() -> None:
    await ensure_indexes()
    await ensure_demo_content()
    print("users / policies / ground truth / settings: OK")

    # reuse the API ingestion path so profiling behaves identically
    from routers.datasets import _ingest, _read_csv_rows
    from pathlib import Path

    sample_dir = Path(__file__).parent / "sample_data"
    existing = await db.datasets.count_documents({"source": "sample"})
    if existing:
        print(f"sample dataset already loaded ({existing}) — skipping ingestion")
    else:
        files = [(p.stem, _read_csv_rows(p.read_text(encoding="utf-8"))) for p in sorted(sample_dir.glob("*.csv"))]
        dataset = await _ingest(
            "Q4-2025 Procurement & Supply Chain Operations (sample)",
            "sample",
            files,
            actor={"name": "system-seed", "role": "system"},
        )
        print(f"sample dataset: {dataset['id']} quality={dataset['quality_score']}")

    print("seed complete.")


if __name__ == "__main__":
    asyncio.run(main())
