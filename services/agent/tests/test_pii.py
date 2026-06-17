"""Phase 2 · H — contact-PII redaction (pure redactor + redaction before LLM calls)."""

from app.safety.pii import maybe_redact, redact_contact_pii, redact_pii_in_obj

# --- H1: the redactor --------------------------------------------------------


def test_redacts_email_phone_url_ssn():
    clean, counts = redact_contact_pii(
        "Reach me at a.b@x.com or +1 (415) 555-2671, portfolio https://me.dev, SSN 123-45-6789."
    )
    assert "a.b@x.com" not in clean and "[EMAIL]" in clean
    assert "555-2671" not in clean and "[PHONE]" in clean
    assert "https://me.dev" not in clean and "[URL]" in clean
    assert "123-45-6789" not in clean and "[SSN]" in clean
    assert counts == {"email": 1, "url": 1, "ssn": 1, "phone": 1}


def test_preserves_skills_dates_and_salaries():
    # ISO dates (8 digits) and salaries must NOT be mistaken for phone numbers.
    text = "5 years of Python and RAG; employed 2021-06-01 to 2026-06-17; salary 120000."
    clean, counts = redact_contact_pii(text)
    assert clean == text
    assert sum(counts.values()) == 0


def test_redact_pii_in_obj_recurses():
    masked = redact_pii_in_obj({"a": "mail a@b.com", "b": ["x", "call 415-555-2671 now"], "n": 3})
    assert masked["a"] == "mail [EMAIL]"
    assert masked["b"][1] == "call [PHONE] now"
    assert masked["n"] == 3  # non-strings untouched


# --- H2: redaction toggle ----------------------------------------------------


def test_maybe_redact_respects_toggle(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "pii_redaction_enabled", True)
    assert maybe_redact("a@b.com") == "[EMAIL]"
    monkeypatch.setattr(settings, "pii_redaction_enabled", False)
    assert maybe_redact("a@b.com") == "a@b.com"
    assert maybe_redact(None) is None


# --- H2: chains strip PII before the LLM call --------------------------------


class _FakeStructured:
    def __init__(self, sink, result):
        self._sink = sink
        self._result = result

    def invoke(self, messages, config=None):
        self._sink["messages"] = messages
        return self._result


class _FakeModel:
    def __init__(self, sink, result):
        self._sink = sink
        self._result = result

    def with_structured_output(self, _schema):
        return _FakeStructured(self._sink, self._result)


def _human_text(sink) -> str:
    # messages are (role, content) tuples; return the concatenated human content.
    return "\n".join(content for role, content in sink["messages"] if role == "human")


def test_score_fit_redacts_pii_before_llm(monkeypatch):
    from app.chains import score_fit as sf
    from app.config import settings
    from app.schemas import FitScoreLLM, ScoreFitRequest

    monkeypatch.setattr(settings, "pii_redaction_enabled", True)
    sink: dict = {}
    fake = _FakeModel(sink, FitScoreLLM(fit_score=50))
    monkeypatch.setattr(sf, "get_model", lambda: (fake, "fake"))

    sf.score_fit(
        ScoreFitRequest(
            description_text="Role at Acme",
            resume_text="Jane Doe jane@doe.com +1 (415) 555-2671",
            profile_text="see https://jane.dev",
            retrieved_context=["contact me at jane@doe.com"],
        )
    )
    human = _human_text(sink)
    assert "jane@doe.com" not in human and "[EMAIL]" in human
    assert "555-2671" not in human and "[PHONE]" in human
    assert "https://jane.dev" not in human and "[URL]" in human


def test_parse_job_redacts_pii_before_llm(monkeypatch):
    from app.chains import parse_job as pj
    from app.config import settings
    from app.schemas import ParsedJob

    monkeypatch.setattr(settings, "pii_redaction_enabled", True)
    sink: dict = {}
    monkeypatch.setattr(pj, "get_model", lambda: (_FakeModel(sink, ParsedJob(title="X")), "fake"))

    pj.parse_job("Apply via recruiter@acme.com or call 415-555-2671")
    human = _human_text(sink)
    assert "recruiter@acme.com" not in human and "[EMAIL]" in human
    assert "555-2671" not in human and "[PHONE]" in human


# --- H3: Langfuse trace mask -------------------------------------------------


def test_langfuse_mask_redacts_nested_when_enabled(monkeypatch):
    from app.config import settings
    from app.obs.langfuse import _mask

    monkeypatch.setattr(settings, "pii_redaction_enabled", True)
    masked = _mask(data={"input": "email a@b.com", "items": ["call 415-555-2671"]})
    assert masked["input"] == "email [EMAIL]"
    assert masked["items"][0] == "call [PHONE]"


def test_langfuse_mask_noop_when_disabled(monkeypatch):
    from app.config import settings
    from app.obs.langfuse import _mask

    monkeypatch.setattr(settings, "pii_redaction_enabled", False)
    payload = {"input": "email a@b.com"}
    assert _mask(data=payload) == payload


# --- review fix: bare profile URLs + Phase 8 agent prompts --------------------


def test_redacts_bare_profile_urls():
    clean, counts = redact_contact_pii("Profiles: linkedin.com/in/jane-doe and github.com/jane")
    assert "linkedin.com/in/jane-doe" not in clean
    assert "github.com/jane" not in clean
    assert clean.count("[URL]") == 2 and counts["url"] == 2


def test_bare_url_does_not_redact_tech_terms():
    # No path / non-web TLD -> not a URL; tech stacks must survive.
    text = "Stack: Node.js, React.js, socket.io and TypeScript"
    clean, counts = redact_contact_pii(text)
    assert clean == text and counts["url"] == 0


def test_interview_prep_agent_redacts_pii_before_llm(monkeypatch):
    from app.agents import runner
    from app.config import settings
    from app.schemas import InterviewPrep, InterviewPrepRequest

    monkeypatch.setattr(settings, "pii_redaction_enabled", True)
    sink: dict = {}

    class _FakeAgent:
        def invoke(self, payload, config=None):
            sink["content"] = payload["messages"][0]["content"]
            return {"messages": [], "structured_response": InterviewPrep()}

    monkeypatch.setattr(runner, "create_agent", lambda *a, **k: _FakeAgent())
    monkeypatch.setattr(runner, "get_model", lambda: (object(), "fake"))

    runner.run_interview_prep(
        InterviewPrepRequest(job_description="Role at Acme", resume_text="Jane jane@doe.com")
    )
    assert "jane@doe.com" not in sink["content"] and "[EMAIL]" in sink["content"]
