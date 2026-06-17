"""Contact-PII redaction (Phase 2 · Workstream H).

Scoped to high-precision identifiers — email, URL, phone, SSN — that are NOT needed for
parse/score, so a candidate's skills and experience are preserved while contact details
are stripped before text reaches a third-party LLM or a Langfuse trace.

Phone matching is digit-count filtered (10-15 digits) so ISO dates, salaries, and
ZIP-like numbers are not mistaken for phone numbers. Street addresses are intentionally
out of scope to keep precision high; Microsoft Presidio is the documented heavier-NER
upgrade path.
"""

from __future__ import annotations

import re
from typing import Any

from app.config import settings

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_URL = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
# Bare profile URLs (e.g. linkedin.com/in/jane, github.com/jane): a domain on a known web
# TLD *with a path*. The TLD allowlist + required "/path" keep tech terms like
# "Node.js/Express" or "React.js" from being mistaken for URLs.
_TLD = r"(?:com|net|org|io|dev|ai|co|me|app|xyz|info|us|uk|ca|edu|gov)"
_BARE_URL = re.compile(rf"\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.{_TLD}/[^\s,;]+", re.IGNORECASE)
_SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
# Candidate phone-like run; confirmed by digit count in the replacer below.
_PHONE_CANDIDATE = re.compile(r"\+?\d[\d ().\-]{7,}\d")


def redact_contact_pii(text: str) -> tuple[str, dict[str, int]]:
    """Return ``(redacted_text, counts_by_kind)``. Idempotent and never raises."""
    counts = {"email": 0, "url": 0, "ssn": 0, "phone": 0}
    if not text:
        return text, counts

    out, counts["email"] = _EMAIL.subn("[EMAIL]", text)
    out, counts["url"] = _URL.subn("[URL]", out)
    out, bare_urls = _BARE_URL.subn("[URL]", out)
    counts["url"] += bare_urls
    out, counts["ssn"] = _SSN.subn("[SSN]", out)

    def _phone(match: re.Match[str]) -> str:
        digits = sum(ch.isdigit() for ch in match.group(0))
        if 10 <= digits <= 15:
            counts["phone"] += 1
            return "[PHONE]"
        return match.group(0)

    out = _PHONE_CANDIDATE.sub(_phone, out)
    return out, counts


def redact_pii_in_obj(data: Any) -> Any:
    """Recursively redact contact-PII in strings within dicts/lists/tuples.

    Used as the Langfuse trace ``mask`` so trace inputs/outputs are scrubbed. Non-string
    leaves are returned unchanged; the result stays JSON-serializable when the input was.
    """
    if isinstance(data, str):
        return redact_contact_pii(data)[0]
    if isinstance(data, dict):
        return {key: redact_pii_in_obj(value) for key, value in data.items()}
    if isinstance(data, list):
        return [redact_pii_in_obj(value) for value in data]
    if isinstance(data, tuple):
        return tuple(redact_pii_in_obj(value) for value in data)
    return data


def maybe_redact(text: str | None) -> str | None:
    """Redact contact-PII when redaction is enabled (default on); a no-op otherwise."""
    if text is None or not settings.pii_redaction_enabled:
        return text
    return redact_contact_pii(text)[0]
