from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
from pydantic import BaseModel, Field
from bson import ObjectId


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Decision(BaseModel):
    id: str = Field(default_factory=lambda: str(ObjectId()))
    filename: str
    raw_text: str
    created_at: datetime = Field(default_factory=_now)


class IntakeContext(BaseModel):
    id: str = Field(default_factory=lambda: str(ObjectId()))
    decision_id: str
    core_decision: str = ""
    market: str = ""
    stated_beliefs: str = ""
    financial_posture: str = ""
    gaps: str = ""
    follow_up_questions: list[dict[str, Any]] = []
    follow_up_answers: dict[str, Any] = {}
    created_at: datetime = Field(default_factory=_now)


class AgentFinding(BaseModel):
    id: str = Field(default_factory=lambda: str(ObjectId()))
    decision_id: str
    agent: str
    vulnerability: str
    severity: str
    attack: str
    question: str
    sources: list[str] = []
    created_at: datetime = Field(default_factory=_now)


class Simulation(BaseModel):
    id: str = Field(default_factory=lambda: str(ObjectId()))
    decision_id: str
    seed: str = ""
    bull: str = ""
    base: str = ""
    bear: str = ""
    opinion_dynamics: dict[str, Any] = {}
    mirofish_id: str = ""
    created_at: datetime = Field(default_factory=_now)


class Verdict(BaseModel):
    id: str = Field(default_factory=lambda: str(ObjectId()))
    decision_id: str
    risk_score: int = 0
    verdict: str = ""
    executive_summary: str = ""
    key_questions: list[str] = []
    gtm_strategy: str = ""
    created_at: datetime = Field(default_factory=_now)
