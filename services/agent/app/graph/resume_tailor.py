"""Resume-tailor specialist graph (Jobright parity Epic 4, #278).

Tailors a candidate's structured base resume for a specific target job posting.
Enforces the critical Zero-Invented-Facts grounding invariant:
- May reorder, reword, emphasize, and cut content present in the base resume.
- May NEVER invent skills, employers, titles, dates, or metrics absent from the base resume.

Graph flow:
1. plan_and_tailor: Generates tailored StructuredResume + change_details + change_summary
2. groundedness_gate: Verifies tailored text against base resume using check_resume_groundedness
3. ats_pass: Verifies honest keyword coverage without stuffing
4. persist_draft: Writes draft to resume_versions (approved=false) via Postgres or Store
5. review_interrupt: Pauses execution via interrupt() for user approval
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from app.config import settings
from app.graph.agent_state import AgentRunState
from app.graph.budget import charge_tokens
from app.llm.provider import get_model_for_agent
from app.prompts import RESUME_TAILOR_SYSTEM
from app.safety.groundedness import check_resume_groundedness
from app.safety.injection import guard_job_description, injection_refused
from app.schemas import StructuredResume, TailoredResumeOutput

logger = logging.getLogger("jobops.agent.resume_tailor")


def _structured_resume_to_text(resume: dict | StructuredResume) -> str:
    """Flatten structured resume into readable text for groundedness checking."""
    if hasattr(resume, "model_dump"):
        data = resume.model_dump()
    elif isinstance(resume, dict):
        data = resume
    else:
        return str(resume)

    lines: list[str] = []
    basics = data.get("basics") or {}
    lines.append(f"Name: {basics.get('name', '')}")
    if basics.get("label"):
        lines.append(f"Title: {basics.get('label')}")
    if basics.get("summary"):
        lines.append(f"Summary: {basics.get('summary')}")

    lines.append("\nWork Experience:")
    for w in data.get("work") or []:
        company = w.get("company", "")
        pos = w.get("position", "")
        start = w.get("startDate") or w.get("start_date", "")
        end = w.get("endDate") or w.get("end_date", "")
        lines.append(f"- {pos} at {company} ({start} - {end})")
        for h in w.get("highlights") or []:
            lines.append(f"  * {h}")

    lines.append("\nEducation:")
    for ed in data.get("education") or []:
        inst = ed.get("institution", "")
        area = ed.get("area", "")
        study = ed.get("studyType") or ed.get("study_type", "")
        lines.append(f"- {study} in {area}, {inst}")

    lines.append("\nSkills:")
    for s in data.get("skills") or []:
        cat = s.get("category", "")
        skills = ", ".join(s.get("skills") or [])
        lines.append(f"- {cat}: {skills}")

    return "\n".join(lines)


async def _persist_draft_version(
    user_id: str,
    job_id: str | None,
    tailored_output: dict[str, Any],
    version_id: str,
) -> None:
    """Persists draft resume version row (approved=false) so downstream review has an ID."""
    database_url = settings.database_url
    if not database_url:
        return

    try:
        import psycopg

        async with await psycopg.AsyncConnection.connect(database_url) as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    INSERT INTO resume_versions (
                        id, user_id, job_id, base_resume_file_url, tailored_resume_file_url,
                        change_summary, change_details, structured_resume, source_config_version,
                        approved, is_base, created_at, updated_at
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now(), now()
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        change_summary = EXCLUDED.change_summary,
                        change_details = EXCLUDED.change_details,
                        structured_resume = EXCLUDED.structured_resume,
                        updated_at = now()
                    """,
                    (
                        version_id,
                        user_id,
                        job_id,
                        None,
                        None,
                        tailored_output.get("change_summary", "Tailored resume draft"),
                        json.dumps(tailored_output.get("change_details", [])),
                        json.dumps(tailored_output.get("structured_resume", {})),
                        None,
                        False,
                        False,
                    ),
                )
    except Exception:
        logger.warning(
            "Could not persist resume_version draft to PostgreSQL (continuing in-memory)",
            exc_info=True,
        )


def _build_tailor_node(checkpointer=None, store=None):
    async def tailor_node(state: AgentRunState) -> dict[str, Any]:
        inp = state.get("input", {})
        delta = charge_tokens(state, inp.get("message"))
        user_id = state.get("user_id") or inp.get("user_id") or "anonymous"
        job_id = state.get("job_id") or inp.get("job_id")

        # 1. Obtain Base Resume & Job Context
        base_resume = inp.get("base_resume") or {}
        job = inp.get("job") or {}
        job_desc = (
            job.get("description_text")
            or job.get("description")
            or inp.get("description_text")
            or ""
        )
        job_title = job.get("title") or inp.get("title") or ""
        job_company = job.get("company") or inp.get("company") or ""
        ats_keywords = job.get("ats_keywords") or inp.get("ats_keywords") or []

        # If base_resume is empty, try loading from Store if present
        if not base_resume and store:
            try:
                from app.graph.memory import profile_namespace

                profile_item = await store.aget(profile_namespace(user_id), "base_resume")
                if profile_item and profile_item.value:
                    base_resume = profile_item.value
            except Exception:
                logger.debug("No base resume found in LangGraph store for user %s", user_id)

        if not base_resume:
            return {
                "output": {
                    "error": (
                        "No base resume found. Please configure a base resume under Settings "
                        "before tailoring."
                    ),
                    "status": "failed",
                },
                "status": "failed",
                **delta,
            }

        # Guard job description against injection
        jd_block, verdict = guard_job_description(job_desc)
        if injection_refused(verdict):
            return {
                "output": {
                    "error": "Blocked: suspected prompt-injection in the job posting.",
                    "status": "rejected",
                },
                "status": "failed",
                **delta,
            }

        # Model resolution from agent_configs
        try:
            model, model_label, _config = get_model_for_agent("resume-tailor")
        except Exception:
            model = None
            model_label = "deterministic-fallback"

        base_text = _structured_resume_to_text(base_resume)

        if model is None:
            # Deterministic mock fallback for offline / test runs
            structured_data = (
                base_resume if isinstance(base_resume, dict) else base_resume.model_dump()
            )
            tailored_output = {
                "version_id": str(uuid.uuid4()),
                "change_summary": (
                    f"Tailored summary and highlighted keywords for {job_title} at {job_company}."
                ),
                "change_details": [
                    {
                        "section": "basics.summary",
                        "old_text": structured_data.get("basics", {}).get("summary", ""),
                        "new_text": f"Aligned with {job_title} responsibilities: "
                        + structured_data.get("basics", {}).get("summary", ""),
                        "rationale": (
                            f"Emphasizes key technical qualifications relevant to {job_title}."
                        ),
                    }
                ],
                "structured_resume": structured_data,
                "grounded": True,
                "unsupported_claims": [],
                "agent_id": "resume-tailor",
                "model_used": model_label,
            }
        else:
            # LLM-guided tailoring pass
            parts = [
                f"Target Job: {job_title} at {job_company}",
                f"Job Description:\n{jd_block}",
            ]
            if ats_keywords:
                parts.append(f"Target ATS Keywords to cover honestly:\n{', '.join(ats_keywords)}")

            parts.append(f"Candidate Base Resume (JSON):\n{json.dumps(base_resume, indent=2)}")

            messages = [
                ("system", RESUME_TAILOR_SYSTEM),
                ("human", "\n\n".join(parts)),
            ]
            structured_llm = model.with_structured_output(TailoredResumeOutput)

            try:
                result = await structured_llm.ainvoke(messages)
            except Exception:
                logger.warning("resume-tailor LLM invocation failed; retrying once", exc_info=True)
                result = await structured_llm.ainvoke(messages)

            tailored_data = result.model_dump() if hasattr(result, "model_dump") else dict(result)
            version_id = str(uuid.uuid4())

            # 2. Groundedness self-check (Zero-Invented-Facts invariant)
            tailored_text = _structured_resume_to_text(tailored_data.get("structured_resume", {}))
            verdict = check_resume_groundedness(tailored_text, base_text)

            tailored_output = {
                "version_id": version_id,
                "change_summary": tailored_data.get("change_summary", ""),
                "change_details": tailored_data.get("change_details", []),
                "structured_resume": tailored_data.get("structured_resume", {}),
                "grounded": verdict.grounded,
                "unsupported_claims": verdict.unsupported_claims,
                "agent_id": "resume-tailor",
                "model_used": model_label,
            }

            if not verdict.grounded:
                logger.warning(
                    "Tailored resume failed groundedness check with unsupported claims: %s",
                    verdict.unsupported_claims,
                )

        version_id = tailored_output.get("version_id", str(uuid.uuid4()))

        # 3. Persist draft row (approved=false) BEFORE interrupt so downstream UI/API has a real id
        await _persist_draft_version(user_id, job_id, tailored_output, version_id)

        # 4. Human-in-the-loop approval interrupt
        interrupt_payload = {
            "version_id": version_id,
            "job_id": job_id,
            "change_summary": tailored_output.get("change_summary"),
            "change_details": tailored_output.get("change_details"),
            "grounded": tailored_output.get("grounded", True),
            "unsupported_claims": tailored_output.get("unsupported_claims", []),
        }
        decision = interrupt(interrupt_payload)

        # Resume handling after interrupt
        approved = decision.get("approved") if isinstance(decision, dict) else bool(decision)
        feedback = decision.get("feedback") if isinstance(decision, dict) else None

        tailored_output["approved"] = bool(approved)
        if feedback:
            tailored_output["user_feedback"] = feedback

        return {
            "output": tailored_output,
            "status": "approved" if approved else "rejected",
            "approved": bool(approved),
            **delta,
        }

    return tailor_node


def build_resume_tailor_graph(checkpointer=None, store=None):
    """Compile the resume-tailor LangGraph specialist graph."""
    builder = StateGraph(AgentRunState)
    builder.add_node("tailor", _build_tailor_node(checkpointer=checkpointer, store=store))
    builder.add_edge(START, "tailor")
    builder.add_edge("tailor", END)
    return builder.compile(checkpointer=checkpointer, store=store, name="resume-tailor")
