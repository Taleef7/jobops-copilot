"""LangChain agents (Phase 8).

Each agent is built with ``create_agent`` and returns a structured result via
``ToolStrategy`` (provider-agnostic, works on Claude/OpenAI/Gemini). The research
agent additionally uses the ``web_search`` tool for genuine multi-step tool use.
"""

from __future__ import annotations

from langchain.agents import create_agent
from langchain.agents.structured_output import ToolStrategy

from app.agents.mcp_tools import load_research_tools
from app.llm.provider import get_model
from app.prompts import INTERVIEW_PREP_SYSTEM, RESEARCH_SYSTEM, SKILL_GAP_SYSTEM
from app.safety.pii import maybe_redact
from app.schemas import (
    InterviewPrep,
    InterviewPrepRequest,
    ResearchBrief,
    ResearchRequest,
    SkillGapPlan,
    SkillGapRequest,
)


def _final_structured(agent, prompt: str, config: dict | None = None):
    result = agent.invoke(
        {"messages": [{"role": "user", "content": prompt}]}, config=config or None
    )
    return result, result["structured_response"]


def _used_a_tool(result) -> bool:
    return any(
        getattr(message, "type", None) == "tool"
        or message.__class__.__name__ == "ToolMessage"
        for message in result.get("messages", [])
    )


def run_interview_prep(req: InterviewPrepRequest, config: dict | None = None) -> InterviewPrep:
    model, _ = get_model()
    agent = create_agent(
        model,
        tools=[],
        system_prompt=INTERVIEW_PREP_SYSTEM,
        response_format=ToolStrategy(InterviewPrep),
    )
    parts = [f"Job description:\n{maybe_redact(req.job_description)}"]
    if req.company:
        parts.append(f"Company: {req.company}")
    if req.role:
        parts.append(f"Role: {req.role}")
    if req.resume_text:
        parts.append(f"Candidate resume (only truthful claims):\n{maybe_redact(req.resume_text)}")
    _, brief = _final_structured(agent, "\n\n".join(parts), config)
    return brief


def run_skill_gap(req: SkillGapRequest, config: dict | None = None) -> SkillGapPlan:
    model, _ = get_model()
    agent = create_agent(
        model,
        tools=[],
        system_prompt=SKILL_GAP_SYSTEM,
        response_format=ToolStrategy(SkillGapPlan),
    )
    parts = ["Missing skills: " + (", ".join(req.missing_skills) or "none provided")]
    if req.job_description:
        parts.append(f"Job description:\n{maybe_redact(req.job_description)}")
    if req.resume_text:
        parts.append(f"Resume:\n{maybe_redact(req.resume_text)}")
    _, plan = _final_structured(agent, "\n\n".join(parts), config)
    return plan


def run_research(req: ResearchRequest, config: dict | None = None) -> ResearchBrief:
    model, _ = get_model()
    agent = create_agent(
        model,
        tools=load_research_tools(),
        system_prompt=RESEARCH_SYSTEM,
        response_format=ToolStrategy(ResearchBrief),
    )
    parts = [f"Company: {req.company}"]
    if req.role:
        parts.append(f"Role: {req.role}")
    if req.context:
        parts.append(f"Additional context:\n{maybe_redact(req.context)}")
    parts.append("Research this company and role for an upcoming interview.")
    result, brief = _final_structured(agent, "\n\n".join(parts), config)
    brief.used_web_search = _used_a_tool(result)
    return brief
