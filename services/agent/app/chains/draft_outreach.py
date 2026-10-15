"""Draft an outreach message for human review with a real LLM."""

from __future__ import annotations

import logging
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

logger = logging.getLogger("jobops.agent.draft_outreach")

# Hard limits by message type (#354). LinkedIn cuts a connection note at 300 characters
# (200 on a free account).
CHARACTER_LIMITS = {"linkedin_connection": 300}

# Text the user would have to fill in before sending (#354): a placeholder word in [], {}, <>
# or __ __, like [Name], {Company}, <Your Name> or __NAME__, and the redaction tokens ([EMAIL],
# [PHONE], [URL]) the model sees where contact details were removed. Other brackets ([sic],
# [link], a job title's [Remote]) are ordinary text.
_PLACEHOLDER_WORDS = (
    r"your\s[^\[\]{}<>\n]{1,40}"
    r"|(?:first|last|full|contact|recipient(?:'s)?|candidate(?:'s)?|company"
    r"|hiring\s+manager(?:'s)?)?\s*name"
    r"|company|hiring\s+manager|recipient|(?:job\s+)?title|role|position|date"
    r"|e-?mail(?:\s+address)?|phone(?:\s+number)?|url|address|ssn"
)
_PLACEHOLDER = re.compile(
    "|".join(
        rf"{start}\s*(?:{_PLACEHOLDER_WORDS})\s*{end}"
        for start, end in ((r"\[", r"\]"), (r"\{", r"\}"), ("<", ">"), ("__", "__"))
    ),
    re.IGNORECASE,
)


def _placeholder(draft: OutreachDraftLLM, inputs: str) -> str | None:
    """The draft's first placeholder that isn't in the inputs themselves, or None."""
    for match in _PLACEHOLDER.finditer(f"{draft.subject}\n{draft.draft_text}"):
        if match.group(0) not in inputs:
            return match.group(0)
    return None


def _length(text: str) -> int:
    """Characters as LinkedIn and the web count them: UTF-16 code units."""
    return len(text.encode("utf-16-le")) // 2


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

    def ask_again(draft: OutreachDraftLLM, request: str) -> OutreachDraftLLM:
        follow_up = [*messages, ("ai", draft.draft_text), ("human", request)]
        return structured.invoke(follow_up, config=config or None)

    # The inputs as the user gave them: bracketed text from them is theirs, not a placeholder.
    inputs = "\n".join(
        part
        for part in (
            req.contact_name,
            req.contact_role,
            req.company,
            req.job_context,
            req.resume_summary,
            *(req.retrieved_context or []),
        )
        if part
    )

    result = structured.invoke(messages, config=config or None)
    placeholder = _placeholder(result, inputs)
    if placeholder:
        # Ask once for the draft without it. A second one means there is no draft to give, so
        # the request fails and the API saves nothing (#354).
        result = ask_again(
            result,
            f"The draft has the placeholder {placeholder}. Rewrite it with no placeholders: use "
            "the names given above, a neutral greeting, or leave the detail out.",
        )
        placeholder = _placeholder(result, inputs)
        if placeholder:
            raise ValueError(f"The draft has a placeholder: {placeholder}")

    limit = CHARACTER_LIMITS.get(req.message_type)
    if limit and _length(result.draft_text) > limit:
        # Ask once for a shorter one. If that fails or is no better, the first draft stays and
        # the user is told it is too long, rather than sent a note cut off mid-sentence.
        try:
            shorter: OutreachDraftLLM | None = ask_again(
                result,
                f"That is {_length(result.draft_text)} characters. Rewrite it in at most "
                f"{limit} characters, spaces included, with the same true claims.",
            )
        except Exception:  # noqa: BLE001 - the first draft is still usable
            logger.warning("shortening the outreach draft failed; keeping the first", exc_info=True)
            shorter = None
        if (
            shorter is not None
            and shorter.draft_text.strip()
            and _length(shorter.draft_text) < _length(result.draft_text)
            and not _placeholder(shorter, inputs)
        ):
            result = shorter

    # Output guardrails: moderate the draft for safety and check it is grounded in the
    # provided context (catches invented claims a moderation API would pass). Both surface
    # in safety_notes; a moderation block withholds the body for human review.
    notes = [result.safety_notes] if result.safety_notes else []
    if limit and _length(result.draft_text) > limit:
        notes.append(
            f"Over {limit} characters ({_length(result.draft_text)}). "
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
