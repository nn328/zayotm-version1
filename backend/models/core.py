"""Pydantic v2 models — system, settings, audit, eval (typed API boundary)."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class Health(BaseModel):
    status: str = "ok"
    version: str = "0.9.0-prototype"
    time: datetime | None = None
    capabilities: dict = {}


class DashboardMetrics(BaseModel):
    datasets: int = 0
    latest_quality_score: float | None = None
    open_findings: int = 0
    findings_by_severity: dict = {}
    cases_by_status: dict = {}
    pending_decisions: int = 0
    records: int = 0
    verified_ok: int = 0
    anchored_real: int = 0
    anchored_simulated: int = 0
    audit_events: int = 0
    recent_decisions: list[dict] = []
    demo_state: dict = {}
    capabilities: dict = {}


class SettingsModel(BaseModel):
    key: str = "global"
    uncertainty_threshold: float = Field(ge=0, le=100)
    budget_envelope: float = Field(gt=0)
    contamination: float = Field(ge=0.01, le=0.5)
    qaoa_layers: int = Field(ge=1, le=4)
    qaoa_shots: int = Field(ge=128, le=20000)
    objective_weights: dict = {}
    updated_at: datetime | None = None


class AuditEvent(BaseModel):
    id: str
    ts: datetime
    actor: str
    actor_role: str = ""
    action: str
    entity_type: str = ""
    entity_id: str = ""
    summary: str = ""
    metadata: dict = {}
