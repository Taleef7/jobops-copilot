"""Parse raw resume text into a structured JSON-Resume-style model via LLM.

The chain receives unstructured resume text (plain text or text extracted from
a PDF) and returns a `StructuredResume` Pydantic model.  The model is provider-
agnostic thanks to LangChain's `with_structured_output`.

This is the backend for the one-time migration flow described in the design spec:
"LLM parses the existing stored resume text into the structured model -> owner
reviews/edits in a 'base resume editor' -> saved as the canonical base."
"""

from __future__ import annotations

import logging

from app.llm.provider import get_model
from app.safety.pii import maybe_redact
from app.schemas import StructuredResume

logger = logging.getLogger("jobops.agent.parse_resume")

PARSE_RESUME_SYSTEM = """\
You are a professional resume parser.  Given raw resume text, extract every
piece of information into the structured JSON schema provided.

Rules
-----
1. Extract EXACTLY what the candidate wrote — never invent skills, employers,
   titles, dates, metrics, or credentials that are absent from the input.
2. For work experience highlights, convert prose paragraphs into concise bullet
   points where possible.
3. If a field is genuinely absent from the text, omit it (set it to null /
   empty array / empty string as appropriate for the schema).
4. Normalize dates to ISO 8601 (YYYY-MM-DD) when recognizable; use the first
   of the month when only month+year are given (e.g. "Jan 2024" → "2024-01-01").
5. Group skills into meaningful categories (e.g. "Programming Languages",
   "Frameworks", "Cloud", "DevOps", "Soft Skills").
6. If the resume contains a professional summary or objective, put it in
   basics.summary.  If none exists, synthesize a one-sentence factual summary
   from the content (state only facts present in the resume).
"""


def parse_resume_text(resume_text: str, config: dict | None = None) -> StructuredResume:
    """Parse raw resume text into a StructuredResume via LLM structured output."""
    model, label = get_model()

    structured = model.with_structured_output(StructuredResume)

    result: StructuredResume = structured.invoke(
        [
            {"role": "system", "content": PARSE_RESUME_SYSTEM},
            {"role": "user", "content": f"Parse the following resume:\n\n{resume_text}"},
        ],
        config=config,
    )

    logger.info("Resume parsed successfully via %s", label)
    return result
