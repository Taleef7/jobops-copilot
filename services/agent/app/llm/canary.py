"""The LLM canary (#348): one tiny structured-output call and one tool call through the
same model every chain uses, so a model the provider rejects is caught by a schedule
instead of by users.

#329 switched the default to gpt-6-luna, which rejected every call for 6 days while
/health, which makes no model call, stayed green. Tool calls can fail on their own: on
gpt-6-luna they take another route than structured output (#410), and the assistant and
the agents depend on them.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.llm.provider import get_model

_POSTING = "Senior Data Engineer at Acme Corp\nRemote, full-time"


class _CanaryTitle(BaseModel):
    title: str = Field(description="The job title in the posting.")


def run_llm_canary() -> None:
    """Parse a two-line posting into a one-field schema, then make a forced tool call.

    Raises on any provider error, an empty answer or a missing tool call.
    """
    chat, _ = get_model()
    model = chat.with_structured_output(_CanaryTitle)
    result = model.invoke(f"Extract the job title from this posting.\n\n{_POSTING}")
    if not isinstance(result, _CanaryTitle) or not result.title.strip():
        raise RuntimeError("The model returned no title.")

    tooled = chat.bind_tools([_CanaryTitle], tool_choice="any")
    message = tooled.invoke(f"Call the tool with the job title from this posting.\n\n{_POSTING}")
    calls = getattr(message, "tool_calls", None) or []
    if not calls or not str(calls[0].get("args", {}).get("title", "")).strip():
        raise RuntimeError("The model made no tool call.")
