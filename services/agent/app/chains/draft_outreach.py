"""Draft an outreach message for human review with a real LLM."""

from __future__ import annotations

import re

from app.llm.provider import get_model
from app.prompts import OUTREACH_DRAFTER_SYSTEM
from app.safety.groundedness import check_groundedness
from app.safety.injection import (
    annotate_trace,
    guard_untrusted,
    injection_refused,
    scan_for_injection,
)
from app.safety.moderation import moderate_text
from app.safety.pii import maybe_redact
from app.schemas import DraftOutreachRequest, OutreachDraftLLM, OutreachDraftResponse

# Hard limits by message type (#354). LinkedIn cuts a connection note at 300 characters
# (200 on a free account).
CHARACTER_LIMITS = {"linkedin_connection": 300}

# "[Name]", "[Company]", "[Your Name]": text the user would have to fill in before sending.
_PLACEHOLDER = re.compile(r"\[[^\[\]\n]+\]")


def _reject_placeholders(draft: OutreachDraftLLM) -> None:
    """A draft with a placeholder is not a draft: fail, and the API saves nothing (#354)."""
    found = _PLACEHOLDER.search(f"{draft.subject}\n{draft.draft_text}")
    if found:
        raise ValueError(f"The draft has a placeholder: {found.group(0)}")


def draft_outreach(req: DraftOutreachRequest, config: dict | None = None) -> OutreachDraftResponse:
    # The job context and contact record are attacker-influenced: both can be populated
    # by URL autofill from a scraped posting. Scan everything, delimit the free-text
    # block, and honour INJECTION_ACTION before spending a model call (#200).
    contact_text = " ".join(
        value for value in (req.contact_name, req.contact_role, req.company) if value
    )
    verdict = scan_for_injection(f"{req.job_context or ''}\n{contact_text}")
    annotate_trace(config, verdict)
    if injection_refused(verdict):
        return OutreachDraftResponse(
            subject="",
            draft_text="",
            safety_notes="BLOCKED: suspected prompt-injection in the job or contact context.",
            model_used=get_model()[1],
        )

    model, label = get_model()
    structured = model.with_structured_output(OutreachDraftLLM)

    parts = [f"Message type: {req.message_type}"]
    # The contact record is URL-autofillable, so it is untrusted too. Scanning alone
    # isn't enough under the default flag mode (a detected payload still proceeds), and
    # the system rule only protects *delimited* content -- so wrap it, don't just label
    # it with bare "Contact name:" lines the rule doesn't cover (#204 review).
    contact_lines = [
        f"{field}: {value}"
        for field, value in (
            ("Contact name", req.contact_name),
            ("Contact role", req.contact_role),
            ("Company", req.company),
        )
        if value
    ]
    if contact_lines:
        block, _ = guard_untrusted("\n".join(contact_lines), "CONTACT")
        parts.append(block)
    if req.job_context:
        # guard_untrusted redacts PII and neutralizes dash-runs that could forge an END
        # line and break out of the block.
        block, _ = guard_untrusted(req.job_context, "JOB CONTEXT")
        parts.append(block)
    if req.resume_summary:
        summary = maybe_redact(req.resume_summary)
        parts.append(f"Resume summary (only truthful claims allowed):\n{summary}")
    if req.retrieved_context:
        evidence = "\n".join(f"- {maybe_redact(chunk)}" for chunk in req.retrieved_context)
        parts.append("Relevant resume evidence to draw from:\n" + evidence)

    messages = [("system", OUTREACH_DRAFTER_SYSTEM), ("human", "\n\n".join(parts))]
    result = structured.invoke(messages, config=config or None)
    _reject_placeholders(result)

    limit = CHARACTER_LIMITS.get(req.message_type)
    if limit and len(result.draft_text) > limit:
        # Ask once for a shorter one. If it is still too long, the user is told, rather than
        # sent a note cut off mid-sentence.
        shorter = structured.invoke(
            [
                *messages,
                ("ai", result.draft_text),
                (
                    "human",
                    f"That is {len(result.draft_text)} characters. Rewrite it in at most "
                    f"{limit} characters, spaces included, with the same true claims.",
                ),
            ],
            config=config or None,
        )
        _reject_placeholders(shorter)
        if shorter.draft_text.strip() and len(shorter.draft_text) < len(result.draft_text):
            result = shorter

    # Output guardrails: moderate the draft for safety and check it is grounded in the
    # provided context (catches invented claims a moderation API would pass). Both surface
    # in safety_notes; a moderation block withholds the body for human review.
    notes = [result.safety_notes] if result.safety_notes else []
    if limit and len(result.draft_text) > limit:
        notes.append(
            f"Over {limit} characters ({len(result.draft_text)}). "
            f"LinkedIn allows {limit}, or 200 on a free account."
        )
    ctx = "\n\n".join(
        maybe_redact(part)
        for part in (req.job_context, req.resume_summary, *(req.retrieved_context or []))
        if part
    )
    grounded = check_groundedness(result.draft_text, ctx)
    if not grounded.grounded:
        claims = "; ".join(grounded.unsupported_claims) or "unsupported claims present"
        notes.append(f"UNVERIFIED claims: {claims}")
    moderation = moderate_text(result.draft_text)
    if not moderation.allowed:
        flagged = ", ".join(moderation.categories) or "policy violation"
        notes.append(f"BLOCKED by moderation: {flagged}")
        result.draft_text = "[withheld pending human review — failed safety moderation]"
    if notes:
        result.safety_notes = " | ".join(notes)

    return OutreachDraftResponse(**result.model_dump(), model_used=label)
