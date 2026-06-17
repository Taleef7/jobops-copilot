"""Output moderation for generated text (Phase 2 · Workstream I).

Provider-agnostic so non-OpenAI deployments are still covered:
  1. If an OpenAI moderation key is set (``MODERATION_OPENAI_API_KEY`` or ``OPENAI_API_KEY``),
     use OpenAI's free moderation endpoint.
  2. Otherwise, run a lightweight LLM safety self-check via the *active* provider.
Skips (allows) only when moderation is disabled, the text is empty, or no provider is
configured at all — so the app degrades gracefully, consistent with the rest of the agent.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from pydantic import BaseModel

from app.config import settings
from app.llm.provider import llm_available

logger = logging.getLogger("jobops.agent.safety")


@dataclass
class ModerationVerdict:
    allowed: bool
    categories: list[str] = field(default_factory=list)
    skipped: bool = False


class _SafetyCheck(BaseModel):
    safe: bool
    reasons: list[str] = []


_SELF_CHECK_SYSTEM = (
    "You are a content-safety classifier for professional job-search outreach. "
    "Decide whether the message is safe and professional, with no harassment, hate, "
    "sexual, violent, or otherwise policy-violating content. Respond with safe=true or "
    "false and brief reasons when unsafe."
)


def _openai_moderate(text: str, api_key: str) -> ModerationVerdict | None:
    """OpenAI moderation endpoint; returns ``None`` on any error so the caller can fall back."""
    try:
        from openai import OpenAI

        result = OpenAI(api_key=api_key).moderations.create(
            model="omni-moderation-latest", input=text
        ).results[0]
        categories = (
            [name for name, hit in result.categories.model_dump(by_alias=True).items() if hit]
            if result.flagged
            else []
        )
        return ModerationVerdict(allowed=not result.flagged, categories=categories)
    except Exception:  # noqa: BLE001 - fall back to the provider self-check
        logger.warning("OpenAI moderation unavailable; trying provider self-check", exc_info=True)
        return None


def _provider_self_check(text: str) -> ModerationVerdict:
    """LLM safety self-check via the active provider; fails open on any error."""
    try:
        from app.llm.provider import get_model

        model, _ = get_model()
        structured = model.with_structured_output(_SafetyCheck)
        result = structured.invoke([("system", _SELF_CHECK_SYSTEM), ("human", text)])
        return ModerationVerdict(
            allowed=result.safe,
            categories=[] if result.safe else (result.reasons or ["unsafe"]),
        )
    except Exception:  # noqa: BLE001 - moderation is best-effort; fail open with a log
        logger.warning("Provider safety self-check unavailable; allowing", exc_info=True)
        return ModerationVerdict(allowed=True, skipped=True)


def moderate_text(text: str) -> ModerationVerdict:
    if not settings.moderation_enabled or not text.strip():
        return ModerationVerdict(allowed=True, skipped=True)
    key = settings.moderation_openai_api_key or settings.openai_api_key
    if key:
        verdict = _openai_moderate(text, key)
        if verdict is not None:
            return verdict
    if llm_available():
        return _provider_self_check(text)
    return ModerationVerdict(allowed=True, skipped=True)
