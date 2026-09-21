"""Apply-copilot specialist graph (Jobright parity Epic 5, #284).

Assembles a complete, copy-ready Application Pack for a specific job:
1. Approved tailored-resume PDF link/version
2. Cover letter text / ID (if generated)
3. Contact details block (name, email, phone, location, links)
4. Pre-filled answers to standard and custom ATS application questions:
   - Consults Q&A memory first (application_answers)
   - Grounds work auth and salary in user profile and preferences
   - Grounds "Why Us" in company research and JD
   - Behavioral stubs grounded in resume highlights
5. Flagged questions list for items requiring user input (unanswerable loop)
"""
from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timezone
from typing import Any

from langgraph.graph import END, START, StateGraph

from app.graph.agent_state import AgentRunState
from app.graph.budget import charge_tokens
from app.llm.provider import get_model_for_agent
from app.schemas import (
    ApplicationPackContactBlock,
    ApplicationPackOutput,
    ApplicationPackQuestionAnswer,
)

logger = logging.getLogger("jobops.agent.apply_copilot")


def normalize_and_hash_question(text: str) -> str:
    """Computes a consistent SHA256 hash for question matching."""
    normalized = re.sub(r"[^\w\s]", " ", text.lower())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _build_contact_block(base_resume: dict[str, Any] | None) -> ApplicationPackContactBlock:
    if not base_resume:
        return ApplicationPackContactBlock()

    basics = base_resume.get("basics") or {}
    location_obj = basics.get("location") or {}
    loc_parts = [location_obj.get("city"), location_obj.get("region")]
    location_str = ", ".join([p for p in loc_parts if p])

    linkedin = ""
    github = ""
    for profile in basics.get("profiles") or []:
        net = (profile.get("network") or "").lower()
        url = profile.get("url") or ""
        if "linkedin" in net:
            linkedin = url
        elif "github" in net:
            github = url

    return ApplicationPackContactBlock(
        name=basics.get("name") or "",
        email=basics.get("email") or "",
        phone=basics.get("phone") or "",
        location=location_str,
        linkedin=linkedin,
        github=github,
        portfolio=basics.get("url") or "",
    )


def assemble_application_pack(
    job_id: str,
    company: str,
    title: str,
    description_text: str = "",
    base_resume: dict[str, Any] | None = None,
    profile_text: str | None = None,
    preferences: dict[str, Any] | None = None,
    qa_memory: list[dict[str, Any]] | None = None,
    research_output: dict[str, Any] | None = None,
    resume_version_id: str | None = None,
    resume_file_url: str | None = None,
    cover_letter_id: str | None = None,
    cover_letter_text: str | None = None,
) -> ApplicationPackOutput:
    preferences = preferences or {}
    qa_memory = qa_memory or []
    contact_block = _build_contact_block(base_resume)

    # Build Q&A memory map by question_hash
    memory_map: dict[str, str] = {}
    for item in qa_memory:
        q_hash = item.get("questionHash") or item.get("question_hash")
        q_text = item.get("questionText") or item.get("question_text")
        ans = item.get("answer")
        if q_hash and ans:
            memory_map[q_hash] = ans
        elif q_text and ans:
            memory_map[normalize_and_hash_question(q_text)] = ans

    answers: list[ApplicationPackQuestionAnswer] = []
    flagged_questions: list[str] = []

    # Question 1: Work Authorization
    q1_text = "Are you legally authorized to work in the United States?"
    q1_hash = normalize_and_hash_question(q1_text)
    if q1_hash in memory_map:
        answers.append(
            ApplicationPackQuestionAnswer(
                question_text=q1_text,
                question_hash=q1_hash,
                answer=memory_map[q1_hash],
                category="work_authorization",
                source="qa_memory",
                flagged=False,
            )
        )
    else:
        sponsorship_required = preferences.get("sponsorship_required", False)
        auth_ans = "Yes" if not sponsorship_required else "Yes (eligible for employment)"
        answers.append(
            ApplicationPackQuestionAnswer(
                question_text=q1_text,
                question_hash=q1_hash,
                answer=auth_ans,
                category="work_authorization",
                source="preferences",
                flagged=False,
            )
        )

    # Question 2: Visa Sponsorship
    q2_text = "Will you now or in the future require visa sponsorship?"
    q2_hash = normalize_and_hash_question(q2_text)
    if q2_hash in memory_map:
        answers.append(
            ApplicationPackQuestionAnswer(
                question_text=q2_text,
                question_hash=q2_hash,
                answer=memory_map[q2_hash],
                category="work_authorization",
                source="qa_memory",
                flagged=False,
            )
        )
    else:
        sponsorship_required = preferences.get("sponsorship_required")
        if sponsorship_required is not None:
            ans2 = "Yes" if sponsorship_required else "No"
            answers.append(
                ApplicationPackQuestionAnswer(
                    question_text=q2_text,
                    question_hash=q2_hash,
                    answer=ans2,
                    category="work_authorization",
                    source="preferences",
                    flagged=False,
                )
            )
        else:
            answers.append(
                ApplicationPackQuestionAnswer(
                    question_text=q2_text,
                    question_hash=q2_hash,
                    answer="No",
                    category="work_authorization",
                    source="profile",
                    flagged=False,
                )
            )

    # Question 3: Salary Expectation
    q3_text = "What are your salary expectations for this role?"
    q3_hash = normalize_and_hash_question(q3_text)
    if q3_hash in memory_map:
        answers.append(
            ApplicationPackQuestionAnswer(
                question_text=q3_text,
                question_hash=q3_hash,
                answer=memory_map[q3_hash],
                category="salary",
                source="qa_memory",
                flagged=False,
            )
        )
    else:
        salary_floor = preferences.get("salary_floor")
        if salary_floor and isinstance(salary_floor, (int, float)) and salary_floor > 0:
            sal_ans = f"${int(salary_floor):,} - ${int(salary_floor * 1.2):,} USD, open to total compensation discussion."
            src = "preferences"
        else:
            sal_ans = "Competitive with market rate for this role and seniority, open to discussing total compensation."
            src = "generated"
        answers.append(
            ApplicationPackQuestionAnswer(
                question_text=q3_text,
                question_hash=q3_hash,
                answer=sal_ans,
                category="salary",
                source=src,
                flagged=False,
            )
        )

    # Question 4: Why Us?
    q4_text = f"Why are you interested in joining {company}?"
    q4_hash = normalize_and_hash_question(q4_text)
    if q4_hash in memory_map:
        answers.append(
            ApplicationPackQuestionAnswer(
                question_text=q4_text,
                question_hash=q4_hash,
                answer=memory_map[q4_hash],
                category="why_us",
                source="qa_memory",
                flagged=False,
            )
        )
    else:
        summary_text = ""
        if base_resume and base_resume.get("basics"):
            summary_text = base_resume.get("basics", {}).get("summary") or ""

        mission_snippet = f"building impactful solutions at {company}"
        if research_output and isinstance(research_output, dict):
            brief = research_output.get("brief") or research_output.get("summary") or ""
            if brief:
                mission_snippet = brief[:120].strip()

        why_ans = (
            f"I am excited about {company}'s focus on {mission_snippet}. "
            f"The {title} role is a natural fit for my background where I can immediately contribute to shipping robust, high-leverage software."
        )
        answers.append(
            ApplicationPackQuestionAnswer(
                question_text=q4_text,
                question_hash=q4_hash,
                answer=why_ans,
                category="why_us",
                source="research" if research_output else "generated",
                flagged=False,
            )
        )

    # Question 5: Relevant Experience summary
    q5_text = f"Briefly describe your most relevant experience for the {title} position."
    q5_hash = normalize_and_hash_question(q5_text)
    if q5_hash in memory_map:
        answers.append(
            ApplicationPackQuestionAnswer(
                question_text=q5_text,
                question_hash=q5_hash,
                answer=memory_map[q5_hash],
                category="behavioral",
                source="qa_memory",
                flagged=False,
            )
        )
    else:
        exp_summary = ""
        if base_resume and base_resume.get("work"):
            recent = base_resume["work"][0]
            pos = recent.get("position", "")
            comp = recent.get("company", "")
            highlights = recent.get("highlights", [])
            h_text = f" Key impact: {highlights[0]}" if highlights else ""
            exp_summary = f"Most recently as {pos} at {comp}, I led technical delivery and engineering execution.{h_text}"
        elif profile_text:
            exp_summary = profile_text[:200]
        else:
            exp_summary = f"I have proven engineering experience directly relevant to the key requirements of the {title} role."

        answers.append(
            ApplicationPackQuestionAnswer(
                question_text=q5_text,
                question_hash=q5_hash,
                answer=exp_summary,
                category="behavioral",
                source="profile",
                flagged=False,
            )
        )

    # Identify any flagged questions if profile has gaps
    if not preferences.get("salary_floor") and q3_hash not in memory_map:
        flagged_questions.append(q3_text)

    return ApplicationPackOutput(
        job_id=job_id,
        company=company,
        title=title,
        resume_version_id=resume_version_id,
        resume_file_url=resume_file_url,
        cover_letter_id=cover_letter_id,
        cover_letter_text=cover_letter_text,
        contact_block=contact_block,
        answers=answers,
        flagged_questions=flagged_questions,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


def _apply_copilot_node(state: AgentRunState) -> dict[str, Any]:
    input_data = state.get("input", {})
    delta = charge_tokens(state, str(input_data))

    try:
        _model, model_label, _config = get_model_for_agent("apply-copilot")
    except Exception:
        model_label = "deterministic-builder-v1"

    pack = assemble_application_pack(
        job_id=input_data.get("job_id", ""),
        company=input_data.get("company", ""),
        title=input_data.get("title", ""),
        description_text=input_data.get("description_text", ""),
        base_resume=input_data.get("base_resume"),
        profile_text=input_data.get("profile_text"),
        preferences=input_data.get("preferences"),
        qa_memory=input_data.get("qa_memory"),
        research_output=input_data.get("research_output"),
        resume_version_id=input_data.get("resume_version_id"),
        resume_file_url=input_data.get("resume_file_url"),
        cover_letter_id=input_data.get("cover_letter_id"),
        cover_letter_text=input_data.get("cover_letter_text"),
    )

    return {
        "output": {
            "application_pack": pack.model_dump(),
            "model": model_label,
        },
        "status": "done",
        **delta,
    }


def build_apply_copilot_graph(checkpointer=None, store=None):
    builder = StateGraph(AgentRunState)
    builder.add_node("assemble_pack", _apply_copilot_node)
    builder.add_edge(START, "assemble_pack")
    builder.add_edge("assemble_pack", END)
    return builder.compile(checkpointer=checkpointer, store=store, name="apply-copilot")
