"""Parse a raw job description into structured fields with a real LLM."""

from __future__ import annotations

from app.llm.provider import get_model
from app.prompts import JOB_PARSER_SYSTEM
from app.safety.pii import maybe_redact
from app.schemas import ParsedJob


def parse_job(description_text: str, config: dict | None = None) -> ParsedJob:
    model, _ = get_model()
    structured = model.with_structured_output(ParsedJob)
    messages = [
        ("system", JOB_PARSER_SYSTEM),
        ("human", f"Job description:\n\n{maybe_redact(description_text)}"),
    ]
    return structured.invoke(messages, config=config or None)
