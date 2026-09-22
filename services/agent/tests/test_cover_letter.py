from unittest.mock import MagicMock, patch

from app.chains.draft_outreach import draft_outreach
from app.schemas import DraftOutreachRequest, OutreachDraftLLM


def test_cover_letter_message_type():
    req = DraftOutreachRequest(
        message_type="cover_letter",
        company="Acme Corp",
        contact_name="Sarah Connor",
        contact_role="Director of Engineering",
        job_context="Looking for a Staff Engineer with Kubernetes and TypeScript experience.",
        resume_summary="Senior Engineer with 8 years of distributed systems and TypeScript.",
    )
    assert req.message_type == "cover_letter"

    mock_llm = MagicMock()
    mock_llm.with_structured_output.return_value.invoke.return_value = OutreachDraftLLM(
        subject="Application for Staff Engineer - Jane Doe",
        draft_text=(
            "Dear Sarah Connor,\n\n"
            "I am writing to express my strong interest in the Staff Engineer role at Acme Corp. "
            "With over 8 years of experience building distributed systems in TypeScript, I believe "
            "my technical background aligns directly with your engineering priorities.\n\n"
            "Sincerely,\nJane Doe"
        ),
        safety_notes="",
    )

    with patch("app.chains.draft_outreach.get_model", return_value=(mock_llm, "test-model")):
        res = draft_outreach(req)

    assert "Dear Sarah Connor" in res.draft_text
    assert "Acme Corp" in res.draft_text
    assert res.subject == "Application for Staff Engineer - Jane Doe"
