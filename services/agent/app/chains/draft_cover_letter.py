"""Write the body of a cover letter for one posting from the base résumé (#416).

The model gets the posting (guarded, as tailoring sends it), the résumé's facts, lines and
skills, the keywords the candidate confirmed, and the length asked for (Concise or Full). It
answers with paragraphs only. The API checks every sentence against the résumé, drops any it
can't ground, and adds the letterhead, date, greeting and sign-off itself.

One call, no retry: a paid call runs once, and a failure surfaces as the API's 503.
"""

from __future__ import annotations

import logging

from app.chains.posting import guarded_posting
from app.llm.provider import get_model
from app.prompts import COVER_LETTER_SYSTEM
from app.safety.injection import annotate_trace, injection_refused
from app.schemas import CoverLetterOutput, CoverLetterRequest, CoverLetterResponse

logger = logging.getLogger("jobops.agent.draft_cover_letter")

_LENGTHS = {
    "concise": "concise (150 to 200 words, 3 short paragraphs)",
    "full": "full (300 to 400 words, 4 paragraphs)",
}


def _one_line(text: str) -> str:
    return " ".join(text.split())


def _human_message(req: CoverLetterRequest, jd_block: str) -> str:
    parts = [
        jd_block,
        f"LENGTH: {req.length}\nWrite a {_LENGTHS[req.length]} letter.",
        "RÉSUMÉ FACTS (read-only):\n" + req.facts,
    ]
    if req.lines:
        parts.append("RÉSUMÉ LINES:\n" + "\n".join(f"- {_one_line(line)}" for line in req.lines))
    if req.skills:
        parts.append("SKILLS:\n" + ", ".join(req.skills))
    parts.append(
        "CONFIRMED KEYWORDS (the candidate has these):\n"
        + (", ".join(req.confirmed_keywords) or "none")
    )
    return "\n\n".join(parts)


def draft_cover_letter(req: CoverLetterRequest, config: dict | None = None) -> CoverLetterResponse:
    model, label = get_model()

    jd_block, verdict = guarded_posting(
        req.job_title, req.company, req.keywords, req.description_text, req.confirmed_keywords
    )
    annotate_trace(config, verdict)
    if injection_refused(verdict):
        return CoverLetterResponse(paragraphs=[], model_used=label, refused=True)

    structured = model.with_structured_output(CoverLetterOutput)
    messages = [("system", COVER_LETTER_SYSTEM), ("human", _human_message(req, jd_block))]
    result = structured.invoke(messages, config=config or None)
    payload = result.model_dump() if hasattr(result, "model_dump") else dict(result)
    logger.info(
        "Cover letter (%s) via %s: %d paragraphs",
        req.length,
        label,
        len(payload.get("paragraphs") or []),
    )
    return CoverLetterResponse(**payload, model_used=label)
