"""Parse a raw job description into structured fields with a real LLM."""

from __future__ import annotations

from app.llm.provider import get_model
from app.prompts import JOB_PARSER_SYSTEM
from app.schemas import ParsedJob


def parse_job(description_text: str) -> ParsedJob:
    model, _ = get_model()
    structured = model.with_structured_output(ParsedJob)
    messages = [
        ("system", JOB_PARSER_SYSTEM),
        ("human", f"Job description:\n\n{description_text}"),
    ]
    return structured.invoke(messages)
