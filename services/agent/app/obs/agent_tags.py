"""Per-agent Langfuse trace tags mapping (Epic 1 / #255)."""
from __future__ import annotations

AGENT_TAGS: dict[str, list[str]] = {
    "feed-curator": ["feed"],
    "resume-tailor": ["tailor"],
    "apply-copilot": ["apply"],
    "connection-scout": ["scout"],
}


def tags_for(agent_id: str) -> list[str]:
    return AGENT_TAGS.get(agent_id, [agent_id])


get_agent_tags = tags_for
