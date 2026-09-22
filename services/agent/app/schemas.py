"""Pydantic schemas.

The output schemas intentionally mirror the TypeScript contracts in
``apps/api/src/lib/analysis-core.ts`` (``ParsedJobOutput``, ``FitScoreOutput``)
and ``prompts/*.md`` so the Node API can consume agent responses without any
shape translation and fall back to its deterministic mock when this service is
unavailable.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

Seniority = Literal["junior", "mid", "senior", "lead", "unknown"]
ApplyRecommendation = Literal["apply", "review", "pass"]
MessageType = Literal[
    "recruiter_email",
    "linkedin_connection",
    "referral_request",
    "follow_up",
    "thank_you",
    "cover_letter",
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


class SubSignals(BaseModel):
    """Component sub-signals that contribute to the overall fit score."""

    skills_match: int = Field(
        default=50,
        description="Match between candidate skills and required/preferred skills, 0-100.",
    )
    title_seniority: int = Field(
        default=50,
        description="Match between role title/seniority level and candidate background, 0-100.",
    )
    salary_fit: int = Field(
        default=50,
        description="Alignment between posting compensation and candidate preferences, 0-100.",
    )
    sponsorship_likelihood: int = Field(
        default=50,
        description="Likelihood of H-1B or visa sponsorship if required by candidate, 0-100.",
    )


class FitScoreLLM(BaseModel):
    """Fields the model produces for a fit assessment.

    The 0-100 bounds live in the field *descriptions* (which reach the model through the
    structured-output JSON schema) rather than as ``ge``/``le`` validators. A hard
    validator turns a model that answers 105 into a ``ValidationError`` and fails the
    whole request; ``score_fit`` clamps instead, so a near-miss becomes a usable answer
    (#199). ``FitScoreResponse`` is what callers see, and it is always in range.
    """

    fit_score: int = Field(description="Overall fit, 0-100.")
    sub_signals: SubSignals = Field(default_factory=SubSignals)
    matched_skills: list[str] = Field(default_factory=list)
    missing_skills: list[str] = Field(default_factory=list)
    ats_keywords: list[str] = Field(default_factory=list)
    fit_summary: str = ""
    recommended_resume_angle: str = ""
    apply_recommendation: ApplyRecommendation = "review"
    confidence_score: int = Field(default=50, description="Confidence, 0-100.")


class FeedCuratorAnalysis(BaseModel):
    """Structured curation assessment produced by the feed-curator specialist graph."""

    fit_score: int = Field(description="Overall fit score, 0-100.")
    sub_signals: SubSignals = Field(default_factory=SubSignals)
    matched_skills: list[str] = Field(default_factory=list)
    missing_skills: list[str] = Field(default_factory=list)
    ats_keywords: list[str] = Field(default_factory=list)
    fit_summary: str = Field(
        default="", description="Concise rationale explaining the fit assessment."
    )
    recommended_resume_angle: str = Field(
        default="", description="Strategic angle to highlight in applications."
    )
    apply_recommendation: ApplyRecommendation = "review"
    confidence_score: int = Field(default=50, description="Confidence in this assessment, 0-100.")


class OutreachDraftLLM(BaseModel):
    """Fields the model produces for an outreach message."""

    subject: str = ""
    draft_text: str = ""
    safety_notes: str = ""


class WeeklyRecommendationsLLM(BaseModel):
    recommendations: str = ""


# --- Phase 8 agent outputs --------------------------------------------------


class InterviewPrep(BaseModel):
    """Prep brief produced by the interview-prep agent."""

    likely_questions: list[str] = Field(default_factory=list)
    talking_points: list[str] = Field(default_factory=list)
    gaps_to_address: list[str] = Field(default_factory=list)
    questions_to_ask: list[str] = Field(default_factory=list)


class SkillGapItem(BaseModel):
    skill: str
    why_it_matters: str = ""
    learning_resources: list[str] = Field(default_factory=list)
    estimated_time: str = ""


class SkillGapPlan(BaseModel):
    summary: str = ""
    prioritized_skills: list[SkillGapItem] = Field(default_factory=list)


class ResearchBrief(BaseModel):
    """Company/role research brief produced by the research agent."""

    company_summary: str = ""
    recent_signals: list[str] = Field(default_factory=list)
    role_context: str = ""
    talking_points: list[str] = Field(default_factory=list)
    questions_to_ask: list[str] = Field(default_factory=list)
    used_web_search: bool = False


# --- API request bodies ----------------------------------------------------


class ParseJobRequest(BaseModel):
    description_text: str


class ScoreFitRequest(BaseModel):
    description_text: str
    resume_text: str
    profile_text: str
    # The parsed role title. Retrieval distills its query from title + skills, so without
    # this a role whose only parsed skill is generic ("communication") retrieves on that
    # word alone instead of the role (#202 review).
    title: str | None = None
    required_skills: list[str] | None = None
    preferred_skills: list[str] | None = None
    ats_keywords: list[str] | None = None
    # Scopes RAG retrieval so a user's resume only grounds their own scoring.
    user_id: str | None = None
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


class InterviewPrepRequest(BaseModel):
    job_description: str
    resume_text: str | None = None
    company: str | None = None
    role: str | None = None


class ResearchRequest(BaseModel):
    company: str
    role: str | None = None
    context: str | None = None


class SkillGapRequest(BaseModel):
    missing_skills: list[str] = Field(default_factory=list)
    job_description: str | None = None
    resume_text: str | None = None


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    """A multi-turn conversational request for the global assistant widget."""

    messages: list[ChatMessage] = Field(default_factory=list)
    # Optional context about the job the user is currently viewing (untrusted).
    context: str | None = None
    # Scopes any future per-user grounding; carried through for traceability.
    user_id: str | None = None
    # Scopes specialist tool executions to the current job (e.g. tailor, apply, scout).
    job_id: str | None = None


# --- Phase 11 telemetry -----------------------------------------------------


class ActivityPoint(BaseModel):
    date: str
    discovered: int = 0
    outreach_drafted: int = 0
    outreach_sent: int = 0


class TelemetryRequest(BaseModel):
    series: list[ActivityPoint] = Field(default_factory=list)


class TelemetryNarrationLLM(BaseModel):
    narrative: str = ""
    recommendations: list[str] = Field(default_factory=list)


class TelemetryInsights(BaseModel):
    metric: str
    total: float
    trend: str  # rising | falling | flat
    moving_average_7d: float
    anomaly_dates: list[str] = Field(default_factory=list)
    forecast_next: float
    narrative: str = ""
    recommendations: list[str] = Field(default_factory=list)
    series_labels: list[str] = Field(default_factory=list)
    series_values: list[float] = Field(default_factory=list)
    llm_used: bool = False


# --- API responses (add server-controlled fields) --------------------------


class FitScoreResponse(FitScoreLLM):
    # Re-imposed here: whatever the model said, what leaves the service is in range.
    fit_score: int = Field(ge=0, le=100, description="Overall fit, 0-100.")
    confidence_score: int = Field(default=50, ge=0, le=100)
    model_used: str


class OutreachDraftResponse(OutreachDraftLLM):
    model_used: str


# --- Structured Resume & Tailoring Schemas (Epic 4, #275) ------------------


class ResumeLocation(BaseModel):
    address: str | None = None
    city: str | None = None
    region: str | None = None
    postal_code: str | None = None
    country_code: str | None = None


class ResumeProfile(BaseModel):
    network: str = Field(description="Platform name, e.g. LinkedIn, GitHub, Portfolio")
    username: str | None = None
    url: str


class ResumeBasics(BaseModel):
    name: str
    label: str | None = Field(default=None, description="Current professional title")
    email: str
    phone: str | None = None
    url: str | None = None
    summary: str = ""
    location: ResumeLocation | None = None
    profiles: list[ResumeProfile] = Field(default_factory=list)


class ResumeWorkExperience(BaseModel):
    id: str | None = None
    company: str
    position: str
    location: str | None = None
    start_date: str
    end_date: str | None = None
    current: bool = False
    summary: str = ""
    highlights: list[str] = Field(default_factory=list)


class ResumeEducation(BaseModel):
    id: str | None = None
    institution: str
    area: str | None = None
    study_type: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    gpa: str | None = None
    highlights: list[str] = Field(default_factory=list)


class ResumeSkill(BaseModel):
    category: str = Field(description="Category name, e.g. Languages & Frameworks, Cloud")
    skills: list[str] = Field(default_factory=list)


class ResumeProject(BaseModel):
    id: str | None = None
    name: str
    description: str = ""
    highlights: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    url: str | None = None


class ResumeCertificate(BaseModel):
    name: str
    issuer: str
    date: str | None = None
    url: str | None = None


class StructuredResume(BaseModel):
    basics: ResumeBasics
    work: list[ResumeWorkExperience] = Field(default_factory=list)
    education: list[ResumeEducation] = Field(default_factory=list)
    skills: list[ResumeSkill] = Field(default_factory=list)
    projects: list[ResumeProject] = Field(default_factory=list)
    certificates: list[ResumeCertificate] = Field(default_factory=list)


class ResumeChangeDetail(BaseModel):
    section: str = Field(description="Section or path edited, e.g. summary, work[0].highlights")
    old_text: str | None = None
    new_text: str
    rationale: str


class TailoredResumeOutput(BaseModel):
    change_summary: str = Field(description="High-level 1-2 sentence summary of tailored changes")
    change_details: list[ResumeChangeDetail] = Field(
        default_factory=list, description="Per-section old->new changes and rationale"
    )
    structured_resume: StructuredResume = Field(description="The tailored structured resume")


class ParseResumeRequest(BaseModel):
    resume_text: str = Field(description="Raw resume text to parse into a structured model")



class ApplicationPackQuestionAnswer(BaseModel):
    question_text: str
    question_hash: str
    answer: str
    category: str = "custom"  # work_authorization | salary | why_us | behavioral | custom
    # source: qa_memory | profile | preferences | research | generated | unanswerable
    source: str = "generated"
    flagged: bool = False


class ApplicationPackContactBlock(BaseModel):
    name: str = ""
    email: str = ""
    phone: str = ""
    location: str = ""
    linkedin: str = ""
    github: str = ""
    portfolio: str = ""


class ApplicationPackOutput(BaseModel):
    job_id: str
    company: str
    title: str
    resume_version_id: str | None = None
    resume_file_url: str | None = None
    cover_letter_id: str | None = None
    cover_letter_text: str | None = None
    contact_block: ApplicationPackContactBlock = Field(default_factory=ApplicationPackContactBlock)
    answers: list[ApplicationPackQuestionAnswer] = Field(default_factory=list)
    flagged_questions: list[str] = Field(default_factory=list)
    generated_at: str = ""


class BuildApplicationPackRequest(BaseModel):
    job_id: str
    company: str
    title: str
    description_text: str = ""
    base_resume: StructuredResume | None = None
    profile_text: str | None = None
    preferences: dict[str, Any] = Field(default_factory=dict)
    qa_memory: list[dict[str, Any]] = Field(default_factory=list)
    research_output: dict[str, Any] | None = None
    resume_version_id: str | None = None
    resume_file_url: str | None = None
    cover_letter_id: str | None = None
    cover_letter_text: str | None = None


class JobContactEvidence(BaseModel):
    url: str
    title: str | None = None
    snippet: str | None = None


class DiscoveredContact(BaseModel):
    name: str = Field(description="Full name of the contact person")
    role_title: str = Field(description="Job title or role of the contact")
    evidence: list[JobContactEvidence] = Field(
        default_factory=list,
        description="Public web sources proving this person is at the company or in this role. MUST have >=1 valid public URL.",
    )
    relevance: str | None = Field(default=None, description="Why this person is relevant to the job posting")
    email: str | None = Field(default=None, description="Public corporate contact email if publicly available, or null")
    linkedin_url: str | None = Field(default=None, description="Public web profile URL (e.g. public LinkedIn profile, company team bio, GitHub profile)")
    notes: str | None = Field(default=None, description="Additional context or notes about the contact")


class ConnectionScoutOutput(BaseModel):
    job_id: str | None = None
    company: str
    title: str
    contacts: list[DiscoveredContact] = Field(default_factory=list)
    search_queries_used: list[str] = Field(default_factory=list)
    scouted_at: str = ""


class ScoutConnectionsRequest(BaseModel):
    job_id: str | None = None
    company: str
    title: str
    description_text: str = ""
