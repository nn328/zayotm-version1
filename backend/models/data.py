"""Pydantic v2 models — datasets, findings, agent runs (typed API boundary)."""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class DatasetFileSummary(BaseModel):
    file: str
    row_count: int
    quality: dict = {}


class DatasetSummary(BaseModel):
    id: str
    name: str
    source: str
    files: list[DatasetFileSummary] = []
    total_rows: int = 0
    quality_score: float = 0
    created_at: datetime | None = None


class DatasetDetail(DatasetSummary):
    schema_preview: list[dict] = []
    sample_rows: list[dict] = []


class Finding(BaseModel):
    id: str
    dataset_id: str
    run_id: str | None = None
    case_id: str | None = None
    kind: str
    engine: str
    rule_id: str | None = None
    title: str
    reason: str
    severity: str
    record_ids: list[str] = []
    fields: list[str] = []
    policy_ref: Optional[str] = None
    score: Optional[float] = None
    ts: datetime | None = None


class AgentTrace(BaseModel):
    agent: str
    name: str
    type: str = ""
    status: str
    duration_ms: float = 0
    summary: str = ""
    output: Any = None
    llm_used: bool = False
    error: str | None = None
    note: str | None = None


class WorkflowRunIn(BaseModel):
    dataset_id: str


class AgentRun(BaseModel):
    id: str
    dataset_id: str
    dataset_name: str | None = None
    status: str
    mode: str = ""
    started_at: datetime | None = None
    finished_at: datetime | None = None
    agents: list[AgentTrace] = []
    routing_decisions: list[dict] = []
    uncertainty: dict | None = None
    escalation: dict | None = None
    evidence: list[dict] = []
    case_id: str | None = None
    llm: dict = {}
    errors: list[str] = []
