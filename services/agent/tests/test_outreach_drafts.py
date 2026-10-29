"""What an outreach draft may contain (#354): no "[Name]"-style placeholders, and a LinkedIn
connection note within LinkedIn's 300 characters. The model is faked; nothing leaves the test.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import main
from app.chains import draft_outreach as outreach_module
from app.schemas import DraftOutreachRequest, OutreachDraftLLM


class _FakeStructured:
    """Answers each call with the next draft text (or raises it), and keeps the messages."""

    def __init__(self, texts: list[str | Exception]):
        self._texts = list(texts)
        self.calls: list[list] = []

    def invoke(self, messages, config=None):
        self.calls.append(list(messages))
        text = self._texts.pop(0)
        if isinstance(text, Exception):
            raise text
        return OutreachDraftLLM(subject="Hello", draft_text=text)


class _FakeModel:
    def __init__(self, structured):
        self._structured = structured

    def with_structured_output(self, _schema):
        return self._structured


@pytest.fixture
def fake_model(monkeypatch):
    def install(*texts: str | Exception) -> _FakeStructured:
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


def _last_prompt(structured: _FakeStructured) -> str:
    return structured.calls[-1][-1][1]


# --- placeholders -------------------------------------------------------------------


@pytest.mark.parametrize(
    "placeholder",
    [
        "[Name]",
        "[First Name]",
        "{Name}",
        "<Name>",
        "__NAME__",
        "[Your Name]",
        "[Hiring Manager]",
        "[Company]",
        "{{company}}",
        "[EMAIL]",
        "[PHONE]",
        "[URL]",
        "[Date]",
        "[Recipient]",
        "[Recruiter's Name]",
        "[Insert Name]",
        "[Manager's Name]",
        "[Previous Company]",
        "[Specific Project]",
        "[LinkedIn URL]",
        "[Mr./Ms. Last Name]",
        "{first_name}",
        "[First_Name]",
        "[X] years",
    ],
)
def test_a_draft_that_keeps_a_placeholder_is_asked_again_then_rejected(fake_model, placeholder):
    structured = fake_model(
        f"Hi {placeholder}, I build Go services and would like to connect.",
        f"Hello {placeholder}, I would like to connect.",
    )

    with pytest.raises(ValueError, match="placeholder"):
        outreach_module.draft_outreach(_request("recruiter_email"))

    assert len(structured.calls) == 2
    assert "placeholder" in _last_prompt(structured).lower()


def test_a_placeholder_is_asked_again_once_and_the_fixed_draft_kept(fake_model):
    structured = fake_model(
        "Hi [Name], I build Go services and would like to connect.",
        "Hi there, I build Go services and would like to connect.",
    )

    result = outreach_module.draft_outreach(_request("recruiter_email"))

    assert len(structured.calls) == 2
    assert result.draft_text.startswith("Hi there,")


@pytest.mark.parametrize(
    "text",
    [
        "As the posting says [sic], it's remote.",
        "You wrote that the team [...] ships weekly.",
        "You wrote that the team […] ships weekly.",
    ],
)
def test_the_usual_editorial_brackets_are_not_placeholders(fake_model, text):
    structured = fake_model(text)

    result = outreach_module.draft_outreach(_request("recruiter_email"))

    assert len(structured.calls) == 1
    assert result.draft_text == text


def test_bracketed_text_from_the_inputs_is_kept(fake_model):
    # The posting's own title says "[Remote]"; repeating it is not a placeholder.
    text = "I saw the Backend Engineer [Remote] role and would like to connect."
    structured = fake_model(text)

    result = outreach_module.draft_outreach(
        _request("recruiter_email", job_context="Backend Engineer [Remote]. Build Go services.")
    )

    assert len(structured.calls) == 1
    assert result.draft_text == text


@pytest.mark.parametrize(
    "metavariable",
    ["[X] years", "[Y]", "[N]", "[X1]", "[Role]", "[Position]", "[Title]", "[Company]", "[Date]",
     "[Location]", "[Skill]", "[Skills]", "[Number]", "[Amount]", "[City]"],
)
def test_a_template_metavariable_from_the_inputs_is_still_a_placeholder(fake_model, metavariable):
    # A posting template that says "[X] years" or "[Role]" doesn't make them real text.
    structured = fake_model(
        f"I have the {metavariable} experience you ask for.",
        f"I'd like to talk about the {metavariable} role.",
    )

    with pytest.raises(ValueError, match="placeholder"):
        outreach_module.draft_outreach(
            _request("recruiter_email", job_context=f"We need {metavariable} of experience.")
        )

    assert len(structured.calls) == 2


def test_a_placeholder_from_a_posting_template_is_still_a_placeholder(fake_model):
    structured = fake_model(
        "I'd like to join [Company Name] as a backend engineer.",
        "I'd like to join [Company Name] to build Go services.",
    )

    with pytest.raises(ValueError, match="placeholder"):
        outreach_module.draft_outreach(
            _request("recruiter_email", job_context="Join [Company Name] as a backend engineer.")
        )

    assert len(structured.calls) == 2


def test_the_endpoint_answers_a_placeholder_draft_with_an_error(fake_model, monkeypatch):
    fake_model("Dear [Hiring Manager], I would like to apply.", "Dear [Hiring Manager], hello.")
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
    assert "300 characters" in _last_prompt(structured)
    assert len(result.draft_text) == 280
    assert "over 300 characters" not in result.safety_notes.lower()


def test_a_note_still_over_300_characters_is_flagged(fake_model):
    structured = fake_model(_note(420), _note(350))

    result = outreach_module.draft_outreach(_request())

    assert len(structured.calls) == 2
    assert len(result.draft_text) == 350
    assert "over 300 characters" in result.safety_notes.lower()


def test_a_shorter_note_with_a_placeholder_keeps_the_first_note_flagged(fake_model):
    first = _note(420)
    fake_model(first, "Hi [Name] I'd like to connect.")

    result = outreach_module.draft_outreach(_request())

    assert result.draft_text == first
    assert "over 300 characters" in result.safety_notes.lower()


def test_a_failed_shortening_keeps_the_first_note_flagged(fake_model):
    first = _note(420)
    fake_model(first, RuntimeError("provider timed out"))

    result = outreach_module.draft_outreach(_request())

    assert result.draft_text == first
    assert "over 300 characters" in result.safety_notes.lower()


def test_characters_are_counted_as_the_web_and_linkedin_count_them(fake_model):
    # 299 characters and one emoji: 300 code points, but 301 UTF-16 units.
    structured = fake_model(_note(299) + "\U0001f44b", _note(280))

    outreach_module.draft_outreach(_request())

    assert len(structured.calls) == 2


def test_a_note_within_the_limit_is_not_redrafted(fake_model):
    structured = fake_model(_note(290))

    outreach_module.draft_outreach(_request())

    assert len(structured.calls) == 1


def test_an_email_has_no_character_limit(fake_model):
    structured = fake_model(_note(420))

    result = outreach_module.draft_outreach(_request("recruiter_email"))

    assert len(structured.calls) == 1
    assert len(result.draft_text) == 420


def test_a_draft_never_points_out_what_the_candidate_lacks():
    # Live drafts volunteered "I may not be a fit" that nothing asked for (#416).
    from app.prompts import OUTREACH_DRAFTER_SYSTEM

    assert "what the candidate lacks" in OUTREACH_DRAFTER_SYSTEM.lower()
