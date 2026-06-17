"""Phase 2 · I — output moderation (provider-agnostic) + groundedness on outreach."""

from app.safety.groundedness import GroundednessVerdict
from app.safety.moderation import ModerationVerdict, moderate_text

# --- I3: moderation dispatch -------------------------------------------------


def test_moderate_skips_when_disabled(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "moderation_enabled", False)
    verdict = moderate_text("anything")
    assert verdict.allowed and verdict.skipped


def test_moderate_skips_when_no_provider(monkeypatch):
    from app.config import settings

    # conftest clears provider keys; no moderation key + no provider -> skip (allow).
    monkeypatch.setattr(settings, "moderation_enabled", True)
    monkeypatch.setattr(settings, "moderation_openai_api_key", None)
    monkeypatch.setattr(settings, "openai_api_key", None)
    verdict = moderate_text("anything")
    assert verdict.allowed and verdict.skipped


def test_moderate_uses_openai_when_keyed(monkeypatch):
    from app.config import settings
    from app.safety import moderation

    monkeypatch.setattr(settings, "moderation_enabled", True)
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    monkeypatch.setattr(
        moderation, "_openai_moderate", lambda text, key: ModerationVerdict(False, ["hate"])
    )
    verdict = moderate_text("bad content")
    assert verdict.allowed is False and "hate" in verdict.categories


def test_moderate_falls_back_to_provider_self_check(monkeypatch):
    from app.config import settings
    from app.safety import moderation

    monkeypatch.setattr(settings, "moderation_enabled", True)
    monkeypatch.setattr(settings, "moderation_openai_api_key", None)
    monkeypatch.setattr(settings, "openai_api_key", None)
    monkeypatch.setattr(moderation, "llm_available", lambda: True)
    monkeypatch.setattr(
        moderation, "_provider_self_check", lambda text: ModerationVerdict(False, ["unsafe"])
    )
    verdict = moderate_text("bad content")
    assert verdict.allowed is False


# --- I4: draft_outreach applies moderation + groundedness --------------------


class _FakeStructured:
    def __init__(self, result):
        self.result = result

    def invoke(self, messages, config=None):
        return self.result


class _FakeModel:
    def __init__(self, result):
        self.result = result

    def with_structured_output(self, _schema):
        return _FakeStructured(self.result)


def _draft_with(monkeypatch, *, moderation_v, grounded_v):
    from app.chains import draft_outreach as do
    from app.schemas import DraftOutreachRequest, OutreachDraftLLM

    draft = OutreachDraftLLM(subject="s", draft_text="hi there", safety_notes="")
    monkeypatch.setattr(do, "get_model", lambda: (_FakeModel(draft), "fake"))
    monkeypatch.setattr(do, "moderate_text", lambda text: moderation_v)
    monkeypatch.setattr(do, "check_groundedness", lambda d, c: grounded_v)
    return do.draft_outreach(
        DraftOutreachRequest(message_type="recruiter_email", job_context="ctx", resume_summary="x")
    )


def test_draft_outreach_withholds_when_moderation_blocks(monkeypatch):
    resp = _draft_with(
        monkeypatch,
        moderation_v=ModerationVerdict(False, ["spam"]),
        grounded_v=GroundednessVerdict(grounded=True),
    )
    assert "BLOCKED by moderation" in resp.safety_notes
    assert "withheld" in resp.draft_text


def test_draft_outreach_flags_ungrounded_claims(monkeypatch):
    resp = _draft_with(
        monkeypatch,
        moderation_v=ModerationVerdict(True),
        grounded_v=GroundednessVerdict(grounded=False, unsupported_claims=["10 years at NASA"]),
    )
    assert "UNVERIFIED claims" in resp.safety_notes and "NASA" in resp.safety_notes
    assert resp.draft_text == "hi there"  # not withheld; flagged for human review
