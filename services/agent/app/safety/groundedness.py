"""Groundedness self-check for generated outreach (Phase 2 · Workstream I).

Catches invented claims that a content-moderation API would happily pass: it asks the
active provider whether the draft only makes claims supported by the provided context
(job context + resume summary/evidence). Skips (returns grounded) when no provider is
configured; fails open on any error.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from pydantic import BaseModel

from app.llm.provider import llm_available

logger = logging.getLogger("jobops.agent.safety")


@dataclass
class GroundednessVerdict:
    grounded: bool
    unsupported_claims: list[str] = field(default_factory=list)
    skipped: bool = False


class _GroundCheck(BaseModel):
    grounded: bool
    unsupported_claims: list[str] = []


_SYSTEM = (
    "You verify a drafted job-search outreach message. Flag any claim — achievements, "
    "skills, employers, or company facts — that is NOT supported by the provided context. "
    "Respond grounded=true only if every claim is supported; otherwise list the unsupported "
    "claims."
)


def check_groundedness(draft: str, context: str) -> GroundednessVerdict:
    if not draft.strip() or not llm_available():
        return GroundednessVerdict(grounded=True, skipped=True)
    try:
        from app.llm.provider import get_model

        model, _ = get_model()
        structured = model.with_structured_output(_GroundCheck)
        human = f"CONTEXT:\n{context}\n\nDRAFT MESSAGE:\n{draft}"
        result = structured.invoke([("system", _SYSTEM), ("human", human)])
        return GroundednessVerdict(
            grounded=result.grounded, unsupported_claims=result.unsupported_claims
        )
    except Exception:  # noqa: BLE001 - best-effort; fail open with a log
        logger.warning("Groundedness check unavailable; allowing", exc_info=True)
        return GroundednessVerdict(grounded=True, skipped=True)
