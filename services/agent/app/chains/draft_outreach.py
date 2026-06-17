"""Draft an outreach message for human review with a real LLM."""

from __future__ import annotations

from app.llm.provider import get_model
from app.prompts import OUTREACH_DRAFTER_SYSTEM
from app.schemas import DraftOutreachRequest, OutreachDraftLLM, OutreachDraftResponse


def draft_outreach(req: DraftOutreachRequest, config: dict | None = None) -> OutreachDraftResponse:
    model, label = get_model()
    structured = model.with_structured_output(OutreachDraftLLM)

    parts = [f"Message type: {req.message_type}"]
    if req.contact_name:
        parts.append(f"Contact name: {req.contact_name}")
    if req.contact_role:
        parts.append(f"Contact role: {req.contact_role}")
    if req.company:
        parts.append(f"Company: {req.company}")
    if req.job_context:
        parts.append(f"Job context:\n{req.job_context}")
    if req.resume_summary:
        parts.append(f"Resume summary (only truthful claims allowed):\n{req.resume_summary}")
    if req.retrieved_context:
        evidence = "\n".join(f"- {chunk}" for chunk in req.retrieved_context)
        parts.append("Relevant resume evidence to draw from:\n" + evidence)

    messages = [("system", OUTREACH_DRAFTER_SYSTEM), ("human", "\n\n".join(parts))]
    result = structured.invoke(messages, config=config or None)
    return OutreachDraftResponse(**result.model_dump(), model_used=label)
