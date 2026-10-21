"""Parse a raw job description into structured fields with a real LLM."""

from __future__ import annotations

from app.llm.provider import get_model
from app.prompts import JOB_PARSER_SYSTEM
from app.safety.injection import annotate_trace, guard_job_description, injection_refused
from app.schemas import ParsedJob

BLOCKED_SUMMARY = "Blocked: suspected prompt-injection in the job description."


class PostingRefused(Exception):
    """The guard refused the posting as instructions to the AI (INJECTION_ACTION=refuse).

    An error, not an empty parse: the Add job form would show that as a posting that
    states nothing (#355). /parse-job answers 422 with code "input_refused".
    """


def parse_job(description_text: str, config: dict | None = None) -> ParsedJob:
    # Treat the JD as untrusted: scan for injection, redact PII, and delimit it.
    jd_block, verdict = guard_job_description(description_text)
    annotate_trace(config, verdict)
    if injection_refused(verdict):
        raise PostingRefused(BLOCKED_SUMMARY)

    model, _ = get_model()
    structured = model.with_structured_output(ParsedJob)
    messages = [
        ("system", JOB_PARSER_SYSTEM),
        ("human", f"Job description:\n\n{jd_block}"),
    ]
    return structured.invoke(messages, config=config or None)
