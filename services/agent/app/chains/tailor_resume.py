"""Tailor a base résumé to one posting as edits to its lines (#351).

The model gets the résumé's read-only facts and its editable lines (the summary and each
bullet, labelled by path), and answers with edits, bullet and skill orders, and the posting's
requirements the résumé doesn't support. The API applies the edits to the base résumé and
checks each one against it, so the model never returns a résumé.

One call, no retry: a paid call runs once, and a failure surfaces as the API's 503.
"""

from __future__ import annotations

import json
import logging

from app.llm.provider import get_model
from app.prompts import TAILOR_RESUME_SYSTEM
from app.safety.injection import annotate_trace, guard_job_description, injection_refused
from app.schemas import TailorResumeOutput, TailorResumeRequest, TailorResumeResponse

logger = logging.getLogger("jobops.agent.tailor_resume")

# json.dumps leaves these raw, and each one starts a new line for a reader.
_LINE_SEPARATORS = {"\u2028": "\\u2028", "\u2029": "\\u2029", "\u0085": "\\u0085"}


def _json_text(text: str) -> str:
    """The line as one JSON string on one line: é and en dashes stay readable."""
    rendered = json.dumps(text, ensure_ascii=False)
    for raw, escaped in _LINE_SEPARATORS.items():
        rendered = rendered.replace(raw, escaped)
    return rendered


def _human_message(req: TailorResumeRequest, jd_block: str) -> str:
    parts = [f"Target job: {req.job_title} at {req.company}", jd_block]
    if req.keywords:
        parts.append(
            "Keywords from the posting (use one only where the rules allow it): "
            + ", ".join(req.keywords)
        )
    parts.append("BASE RÉSUMÉ FACTS (read-only):\n" + req.facts)
    if req.skills:
        parts.append("SKILLS (reorder only):\n" + ", ".join(req.skills))
    if req.skill_categories:
        parts.append("SKILL CATEGORIES:\n" + ", ".join(req.skill_categories))
    parts.append(
        "CONFIRMED KEYWORDS (the candidate has these):\n"
        + (", ".join(req.confirmed_keywords) or "none")
    )
    # One JSON string per line, so a line break inside a line (the summary is a text box)
    # can't look like an unlabelled line of its own.
    parts.append(
        "EDITABLE LINES (label: JSON string):\n"
        + "\n".join(f"{ln.path}: {_json_text(ln.text)}" for ln in req.lines)
    )
    return "\n\n".join(parts)


def tailor_resume(req: TailorResumeRequest, config: dict | None = None) -> TailorResumeResponse:
    model, label = get_model()

    jd_block, verdict = guard_job_description(req.description_text)
    annotate_trace(config, verdict)
    if injection_refused(verdict):
        return TailorResumeResponse(
            change_summary="Not tailored: suspected prompt injection in the job description.",
            edits=[],
            highlight_orders=[],
            skills_order=list(req.skills),
            added_skills=[],
            gaps=[],
            model_used=label,
        )

    structured = model.with_structured_output(TailorResumeOutput)
    messages = [("system", TAILOR_RESUME_SYSTEM), ("human", _human_message(req, jd_block))]
    result = structured.invoke(messages, config=config or None)
    payload = result.model_dump() if hasattr(result, "model_dump") else dict(result)
    logger.info("Résumé tailored via %s: %d edits", label, len(payload.get("edits") or []))
    return TailorResumeResponse(**payload, model_used=label)
