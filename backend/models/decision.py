"""Pydantic v2 models — decision cases, optimization, trust (typed API boundary)."""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class Candidate(BaseModel):
    po_id: str
    supplier_id: str | None = None
    supplier_name: str | None = None
    department: str = ""
    category: str = ""
    item: str = ""
    amount: float = 0
    cost: float = 0
    priority: str = ""
    needed_by: str | None = None
    value_score: float = 0
    value_model: str | None = None
    excluded: bool = False
    exclusion_reason: str | None = None
    rule_hits: list[str] = []


class DecisionCase(BaseModel):
    id: str
    title: str
    description: str = ""
    dataset_id: str
    run_id: str | None = None
    status: str  # draft | in_review | approved | rejected | revision_requested
    candidates: list[Candidate] = []
    constraints: list[dict] = []
    budget_envelope: float = 0
    alternatives: list[dict] = []
    formulation: dict | None = None
    uncertainty: dict | None = None
    escalation: dict | None = None
    evidence: list[dict] = []
    executive_summary: str = ""
    rationale: str = ""
    limitations: list[str] = []
    selected_solution: dict | None = None
    optimization_run_id: str | None = None
    recommendation: dict | None = None
    approvals: list[dict] = []
    created_at: datetime | None = None


class OptimizationRun(BaseModel):
    id: str
    case_id: str
    created_at: datetime | None = None
    formulation: dict = {}
    classical: dict = {}
    quantum: dict = {}
    validation: dict = {}
    selected: dict = {}
    policy: str = "best validated objective (feasible first, then objective value)"


class RecommendationIn(BaseModel):
    pass


class ApprovalIn(BaseModel):
    action: str  # approve | reject | revise
    reason: str = Field(min_length=3, max_length=2000)


class DecisionRecordModel(BaseModel):
    id: str
    case_id: str
    record_type: str = "zayotm.decision_record"
    hash: str
    algorithm: str = "SHA-256"
    canonical: dict = {}
    anchored: dict | None = None
    tamper_tests: list[dict] = []
    created_at: datetime | None = None


class AnchorIn(BaseModel):
    pass


class RecordIn(BaseModel):
    case_id: str
