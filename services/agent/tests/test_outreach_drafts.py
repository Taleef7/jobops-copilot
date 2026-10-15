"""What an outreach draft may contain (#354): no "[Name]" placeholders, and a LinkedIn
connection note within LinkedIn's 300 characters. The model is faked; nothing leaves the test.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import main
from app.chains import draft_outreach as outreach_module
from app.schemas import DraftOutreachRequest, OutreachDraftLLM


class _FakeStructured:
    """Answers each call with the next draft text, and keeps the messages it was sent."""

    def __init__(self, texts: list[str]):
        self._texts = list(texts)
        self.calls: list[list] = []

    def invoke(self, messages, config=None):
        self.calls.append(list(messages))
        return OutreachDraftLLM(subject="Hello", draft_text=self._texts.pop(0))


class _FakeModel:
    def __init__(self, structured):
        self._structured = structured

    def with_structured_output(self, _schema):
        return self._structured


@pytest.fixture
def fake_model(monkeypatch):
    def install(*texts: str) -> _FakeStructured:
        structured = _FakeStructured(list(texts))
        monkeypatch.setattr(
            outreach_module, "get_model", lambda: (_FakeModel(structured), "fake:model")
        )
        return structured

    # The output guardrails are tested elsewhere; keep them out of the way here.
    monkeypatch.setattr(
        outreach_module,
        "check_groundedness",
        lambda *a, **k: type("G", (), {"grounded": True, "unsupported_claims": []})(),
    )
    monkeypatch.setattr(
        outreach_module,
        "moderate_text",
        lambda *a, **k: type("M", (), {"allowed": True, "categories": []})(),
    )
    return install


def _request(message_type: str = "linkedin_connection", **overrides) -> DraftOutreachRequest:
    base = {
        "message_type": message_type,
        "company": "Acme",
        "job_context": "Backend engineer at Acme, Go and Postgres.",
        "resume_summary": "Built Go services on Postgres.",
    }
    base.update(overrides)
    return DraftOutreachRequest(**base)


def _note(length: int) -> str:
    text = "Hi there, I build Go services on Postgres and would like to connect. "
    return (text * (length // len(text) + 1))[:length]


# --- placeholders -------------------------------------------------------------------


def test_a_draft_with_a_name_placeholder_is_rejected(fake_model):
    fake_model("Hi [Name], I build Go services and would like to connect.")

    with pytest.raises(ValueError, match="placeholder"):
        outreach_module.draft_outreach(_request("recruiter_email"))


def test_the_endpoint_answers_a_placeholder_draft_with_an_error(fake_model, monkeypatch):
    fake_model("Dear [Hiring Manager], I would like to apply.")
    monkeypatch.setattr(main, "llm_available", lambda: True)

    res = TestClient(main.app).post(
        "/draft-outreach", json={"message_type": "cover_letter", "company": "Acme"}
    )

    # A2's path: the API reads a 502 as "the AI couldn't answer" and saves nothing.
    assert res.status_code == 502


def test_a_draft_without_a_contact_name_keeps_a_neutral_greeting(fake_model):
    fake_model("Hi there, I build Go services and would like to connect.")

    result = outreach_module.draft_outreach(_request("recruiter_email"))

    assert result.draft_text.startswith("Hi there,")


# --- LinkedIn's 300 characters ------------------------------------------------------


def test_a_420_character_connection_note_is_shortened_once(fake_model):
    structured = fake_model(_note(420), _note(280))

    result = outreach_module.draft_outreach(_request())

    assert len(structured.calls) == 2
    assert "300 characters" in structured.calls[1][-1][1]
    assert len(result.draft_text) == 280
    assert "over 300 characters" not in result.safety_notes.lower()


def test_a_note_still_over_300_characters_is_flagged(fake_model):
    structured = fake_model(_note(420), _note(350))

    result = outreach_module.draft_outreach(_request())

    assert len(structured.calls) == 2
    assert len(result.draft_text) == 350
    assert "over 300 characters" in result.safety_notes.lower()


def test_a_note_within_the_limit_is_not_redrafted(fake_model):
    structured = fake_model(_note(290))

    outreach_module.draft_outreach(_request())

    assert len(structured.calls) == 1


def test_an_email_has_no_character_limit(fake_model):
    structured = fake_model(_note(420))

    result = outreach_module.draft_outreach(_request("recruiter_email"))

    assert len(structured.calls) == 1
    assert len(result.draft_text) == 420
