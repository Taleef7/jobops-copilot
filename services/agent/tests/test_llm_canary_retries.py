"""The canary's retries (#413), through the image's pinned OpenAI SDK.

The SDK retries a failed or timed-out request twice, so one canary call could take 3 times
the 60 s request timeout, and both calls about 6 minutes, while the API waits 140 s and the
workflows 150 s. The caller gave up first and reported "the agent timed out" instead of the
provider's error. The canary now makes one attempt per call; the calls users make keep the
retries.

No request leaves the process: every one is answered by the fake transport below.
"""

import json
import re
from pathlib import Path

import httpx
import openai
import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.config import Settings, settings
from app.llm import provider
from app.llm.canary import run_llm_canary

KEY = "s3cret-shared-key"
REPO = Path(__file__).resolve().parents[3]

_TITLE = {
    "id": "resp_1",
    "object": "response",
    "created_at": 1,
    "status": "completed",
    "model": "gpt-6-luna",
    "parallel_tool_calls": True,
    "tool_choice": "auto",
    "tools": [],
    "output": [
        {
            "type": "message",
            "id": "msg_1",
            "status": "completed",
            "role": "assistant",
            "content": [
                {
                    "type": "output_text",
                    "annotations": [],
                    "text": json.dumps({"title": "Senior Data Engineer"}),
                }
            ],
        }
    ],
}


def _title(request):
    return httpx.Response(200, json=_TITLE)


def _overloaded(request):
    # retry-after-ms keeps the SDK's wait before a retry to 1 ms.
    return httpx.Response(
        500,
        json={"error": {"message": "The engine is currently overloaded", "type": "server_error"}},
        headers={"retry-after-ms": "1"},
    )


def _timed_out(request):
    raise httpx.ReadTimeout("timed out", request=request)


@pytest.fixture()
def fake_openai(monkeypatch):
    """The env model is gpt-6-luna; ``fake_openai(*answers)`` answers the nth request with
    the nth answer (the last one from then on) and returns the requests made."""
    monkeypatch.setattr(settings, "llm_provider", "openai")
    monkeypatch.setattr(settings, "openai_api_key", "sk-test-oa")
    monkeypatch.setattr(settings, "openai_model", "gpt-6-luna")
    monkeypatch.setattr(settings, "openai_reasoning_effort", "medium")
    provider.get_model.cache_clear()
    requests: list[httpx.Request] = []

    def answer_with(*answers):
        def handle_request(self, request):
            requests.append(request)
            return answers[min(len(requests), len(answers)) - 1](request)

        monkeypatch.setattr(httpx.HTTPTransport, "handle_request", handle_request)
        return requests

    yield answer_with
    provider.get_model.cache_clear()


def _api_canary_wait_s() -> float:
    text = (REPO / "apps" / "api" / "src" / "lib" / "llm-canary.ts").read_text(encoding="utf-8")
    match = re.search(r"LLM_CANARY_TIMEOUT_MS\s*=\s*([\d_]+)", text)
    assert match, "LLM_CANARY_TIMEOUT_MS not found in apps/api/src/lib/llm-canary.ts"
    return int(match.group(1).replace("_", "")) / 1000


def test_the_canary_worst_case_fits_inside_the_api_wait(fake_openai):
    # The slow case: the first call answers and the second times out.
    requests = fake_openai(_title, _timed_out)

    with pytest.raises(openai.APITimeoutError):
        run_llm_canary()

    # One request per call, so at worst two request timeouts (infra leaves REQUEST_TIMEOUT
    # at its default), with room left in the API's wait for a cold start (the 15 s its own
    # test allows).
    assert len(requests) == 2
    assert all(r.url.path == "/v1/responses" for r in requests)
    cold_start_s = 15
    worst_s = len(requests) * Settings(_env_file=None).request_timeout
    assert worst_s + cold_start_s <= _api_canary_wait_s()


def test_a_provider_error_comes_back_after_one_request(fake_openai):
    requests = fake_openai(_overloaded)

    with pytest.raises(openai.InternalServerError, match="overloaded"):
        run_llm_canary()

    assert len(requests) == 1


def test_health_llm_reports_the_provider_error_as_a_503(fake_openai, monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", KEY)
    requests = fake_openai(_overloaded)

    res = TestClient(main.app).get("/health/llm", headers={"X-Agent-Key": KEY})

    assert res.status_code == 503
    body = res.json()
    assert body["ok"] is False
    assert "The engine is currently overloaded" in body["error"]
    assert len(requests) == 1


@pytest.mark.parametrize("failure", [_overloaded, _timed_out])
def test_user_facing_calls_keep_the_sdk_retries(fake_openai, failure):
    requests = fake_openai(failure)
    chat, _ = provider.get_model()

    with pytest.raises(openai.APIError):
        chat.invoke("Extract the job title from this posting.")

    # The first attempt and the SDK's default retries (2 on the image's openai 2.48.0).
    assert openai.DEFAULT_MAX_RETRIES > 0
    assert len(requests) == 1 + openai.DEFAULT_MAX_RETRIES
