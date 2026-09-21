"""Tests for resume-tailor specialist graph and Zero-Invented-Facts evals."""
from __future__ import annotations

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from app.graph.resume_tailor import build_resume_tailor_graph
from app.safety.groundedness import check_resume_groundedness
from app.schemas import (
    ResumeBasics,
    ResumeEducation,
    ResumeSkill,
    ResumeWorkExperience,
    StructuredResume,
)

SAMPLE_BASE_RESUME = StructuredResume(
    basics=ResumeBasics(
        name="Sam Taylor",
        label="Software Engineer",
        email="sam@example.com",
        summary="Backend engineer focused on distributed databases and Python services.",
    ),
    work=[
        ResumeWorkExperience(
            company="DataFlow Inc",
            position="Software Engineer",
            start_date="2021-06-01",
            end_date="2024-01-01",
            highlights=[
                "Built ingestion pipelines processing 2TB/day",
                "Optimized Postgres query performance by 35%",
            ],
        )
    ],
    education=[
        ResumeEducation(
            institution="University of Washington",
            area="Informatics",
            study_type="B.S.",
        )
    ],
    skills=[
        ResumeSkill(category="Languages", skills=["Python", "SQL", "Go"]),
        ResumeSkill(category="Data", skills=["PostgreSQL", "Kafka"]),
    ],
)


@pytest.mark.anyio
async def test_resume_tailor_graph_run_and_interrupt():
    """Test full execution of resume_tailor graph pausing at the interrupt step."""
    checkpointer = InMemorySaver()
    graph = build_resume_tailor_graph(checkpointer=checkpointer)

    thread_id = "user_test_1:resume-tailor:job_abc"
    config = {"configurable": {"thread_id": thread_id}}

    initial_input = {
        "user_id": "user_test_1",
        "job_id": "job_abc",
        "input": {
            "base_resume": SAMPLE_BASE_RESUME.model_dump(),
            "job": {
                "title": "Senior Backend Engineer",
                "company": "CloudScale",
                "description_text": "Looking for a Python/Go backend engineer with strong PostgreSQL experience.",
                "ats_keywords": ["Python", "PostgreSQL", "Distributed Systems"],
            },
        },
    }

    # First turn: runs tailor node up to the approval interrupt
    updates = []
    async for update in graph.astream(initial_input, config, stream_mode="updates"):
        updates.append(update)

    state = await graph.aget_state(config)

    # Verify interrupt happened and contains approval payload
    assert len(state.tasks) > 0
    interrupts = state.tasks[0].interrupts
    assert len(interrupts) == 1
    approval_data = interrupts[0].value
    assert "version_id" in approval_data
    assert approval_data["job_id"] == "job_abc"
    assert "change_summary" in approval_data

    # Resume turn: simulate user approving the draft
    resume_command = Command(resume={"approved": True, "feedback": "Looks great!"})
    resume_updates = []
    async for update in graph.astream(resume_command, config, stream_mode="updates"):
        resume_updates.append(update)

    final_state = await graph.aget_state(config)
    output = final_state.values.get("output", {})
    assert output.get("approved") is True
    assert output.get("user_feedback") == "Looks great!"
    assert output.get("agent_id") == "resume-tailor"
    assert "structured_resume" in output


@pytest.mark.anyio
async def test_resume_tailor_fails_when_no_base_resume():
    """Test that tailoring fails gracefully if base resume is absent."""
    checkpointer = InMemorySaver()
    graph = build_resume_tailor_graph(checkpointer=checkpointer)

    thread_id = "user_test_2:resume-tailor:job_xyz"
    config = {"configurable": {"thread_id": thread_id}}

    initial_input = {
        "user_id": "user_test_2",
        "job_id": "job_xyz",
        "input": {
            "job": {"title": "Engineer", "description_text": "Need python dev."},
        },
    }

    async for _ in graph.astream(initial_input, config, stream_mode="updates"):
        pass

    state = await graph.aget_state(config)
    assert state.values.get("status") == "failed"
    assert "error" in state.values.get("output", {})


def test_zero_invented_facts_groundedness_check():
    """Verify groundedness check evaluates zero-invented-facts invariant."""
    base_text = "Name: Sam Taylor\nSkills: Python, PostgreSQL\nExperience: Built ingestion pipelines at DataFlow Inc"

    # Case A: Honest tailored version (same facts, reworded)
    honest_tailored = "Name: Sam Taylor\nSkills: Python, PostgreSQL\nExperience: Scaled DataFlow Inc data pipelines"
    honest_verdict = check_resume_groundedness(honest_tailored, base_text)
    assert honest_verdict.grounded is True

    # Case B: Empty text returns grounded
    assert check_resume_groundedness("", base_text).grounded is True
