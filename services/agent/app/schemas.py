"""Pydantic schemas.

The output schemas intentionally mirror the TypeScript contracts in
``apps/api/src/lib/analysis-core.ts`` (``ParsedJobOutput``, ``FitScoreOutput``)
and ``prompts/*.md`` so the Node API can consume agent responses without any
shape translation and fall back to its deterministic mock when this service is
unavailable.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Seniority = Literal["junior", "mid", "senior", "lead", "unknown"]
ApplyRecommendation = Literal["apply", "review", "pass"]
MessageType = Literal[
    "recruiter_email",
    "linkedin_connection",
    "referral_request",
    "follow_up",
    "thank_you",
]


# --- LLM structured outputs ------------------------------------------------


class ParsedJob(BaseModel):
    """Structured job description. Matches ParsedJobOutput in the Node API."""

    company: str | None = Field(default=None, description="Hiring company, or null if unknown.")
    title: str | None = Field(default=None, description="Role title, or null if unknown.")
    required_skills: list[str] = Field(default_factory=list)
    preferred_skills: list[str] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)
    seniority: Seniority = "unknown"
    cloud_tools: list[str] = Field(default_factory=list)
    automation_tools: list[str] = Field(default_factory=list)
    summary: str = ""


class FitScoreLLM(BaseModel):
    """Fields the model produces for a fit assessment."""

    fit_score: int = Field(ge=0, le=100, description="Overall fit, 0-100.")
    matched_skills: list[str] = Field(default_factory=list)
    missing_skills: list[str] = Field(default_factory=list)
    ats_keywords: list[str] = Field(default_factory=list)
    fit_summary: str = ""
    recommended_resume_angle: str = ""
    apply_recommendation: ApplyRecommendation = "review"
    confidence_score: int = Field(default=50, ge=0, le=100)


class OutreachDraftLLM(BaseModel):
    """Fields the model produces for an outreach message."""

    subject: str = ""
    draft_text: str = ""
    safety_notes: str = ""


class WeeklyRecommendationsLLM(BaseModel):
    recommendations: str = ""


# --- API request bodies ----------------------------------------------------


class ParseJobRequest(BaseModel):
    description_text: str


class ScoreFitRequest(BaseModel):
    description_text: str
    resume_text: str
    profile_text: str
    required_skills: list[str] | None = None
    preferred_skills: list[str] | None = None
    ats_keywords: list[str] | None = None
    # Optional retrieved resume evidence (Phase 10 RAG). When present the model
    # is instructed to ground its assessment in these snippets.
    retrieved_context: list[str] | None = None


class DraftOutreachRequest(BaseModel):
    message_type: MessageType
    contact_name: str | None = None
    contact_role: str | None = None
    company: str | None = None
    job_context: str | None = None
    resume_summary: str | None = None
    retrieved_context: list[str] | None = None


class WeeklyRecommendationsRequest(BaseModel):
    metrics: dict[str, int] = Field(default_factory=dict)
    common_missing_skills: list[str] = Field(default_factory=list)


# --- API responses (add server-controlled fields) --------------------------


class FitScoreResponse(FitScoreLLM):
    model_used: str


class OutreachDraftResponse(OutreachDraftLLM):
    model_used: str
