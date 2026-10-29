"""The posting as the tailoring and cover-letter chains send it (#351, #416).

The title, company and keywords come from the posting too, so they go in the same delimited
block as its text: an instruction in a scraped title is data like one in the description.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable

from app.safety.injection import InjectionVerdict, scan_for_injection, wrap_untrusted
from app.safety.pii import maybe_redact

logger = logging.getLogger("jobops.agent.posting")


def guarded_posting(
    job_title: str,
    company: str,
    keywords: Iterable[str],
    description_text: str,
    also_scan: Iterable[str] = (),
) -> tuple[str, InjectionVerdict]:
    """The posting as one JOB DESCRIPTION block, and the injection scan of it.

    All of it, and ``also_scan`` (the confirmed keywords), is scanned. Only the description is
    PII-redacted: the redactor reads keywords such as "ASP.NET/C#" as URLs.
    """
    keywords = list(keywords)
    header = f"Title: {job_title}\nCompany: {company}\n"
    if keywords:
        header += "Keywords from the posting: " + ", ".join(keywords) + "\n"
    verdict = scan_for_injection("\n".join([header, description_text, *also_scan]))
    if verdict.flagged:
        logger.warning("Possible prompt injection in the posting; patterns=%s", verdict.patterns)
    description = maybe_redact(description_text) or ""
    return wrap_untrusted(header + "\n" + description, "JOB DESCRIPTION"), verdict
