"""Tests for connection-scout specialist graph and evidence precision evals."""
from __future__ import annotations

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from app.graph.connection_scout import (
    build_connection_scout_graph,
    is_valid_public_url,
    scout_contacts_for_job,
    validate_and_filter_contacts,
)
from app.schemas import DiscoveredContact, JobContactEvidence
from evals.connection_scout_eval import evaluate_connection_scout_precision


def test_is_valid_public_url():
    assert is_valid_public_url("https://example.com/team/alice") is True
    assert is_valid_public_url("http://news.ycombinator.com/item?id=123") is True
    assert is_valid_public_url("https://sub.domain.co.uk/page") is True

    # Invalid cases
    assert is_valid_public_url("") is False
    assert is_valid_public_url("ftp://server/file") is False
    assert is_valid_public_url("not a url") is False
    assert is_valid_public_url("http://localhost") is False
    assert is_valid_public_url("https://") is False


def test_validate_and_filter_contacts_fail_closed():
    """Verify that unevidenced or invalidly-evidenced contacts are dropped."""
    test_contacts = [
        # Valid contact with 1 valid URL
        DiscoveredContact(
            name="Alice Smith",
            role_title="Director of Engineering",
            evidence=[JobContactEvidence(url="https://acme.corp/team/alice", title="Team Bio")],
            relevance="Hiring Manager",
        ),
        # Invalid contact: 0 evidence URLs
        DiscoveredContact(
            name="Bob Hallucination",
            role_title="Recruiter",
            evidence=[],
            relevance="Recruiter",
        ),
        # Invalid contact: invalid URL
        DiscoveredContact(
            name="Charlie BadUrl",
            role_title="Staff Engineer",
            evidence=[JobContactEvidence(url="not-a-valid-url")],
            relevance="Peer",
        ),
        # Invalid contact: missing name
        DiscoveredContact(
            name="",
            role_title="VP Engineering",
            evidence=[JobContactEvidence(url="https://acme.corp/vp")],
        ),
    ]

    filtered = validate_and_filter_contacts(test_contacts)
    assert len(filtered) == 1
    assert filtered[0].name == "Alice Smith"
    assert filtered[0].evidence[0].url == "https://acme.corp/team/alice"


@pytest.mark.anyio
async def test_scout_contacts_for_job_with_evidence():
    """Verify scout_contacts_for_job produces verified contacts with public evidence."""
    snippets = [
        {
            "title": "Stripe Engineering Leadership",
            "snippet": "Claire Hughes leads the core payments infrastructure team as Engineering Director.",
            "url": "https://stripe.com/blog/payments-infra-leadership",
        }
    ]

    output = await scout_contacts_for_job(
        company="Stripe",
        title="Staff Software Engineer, Payments",
        description_text="Building reliable global payments infrastructure.",
        provided_evidence_snippets=snippets,
    )

    assert output.company == "Stripe"
    assert len(output.contacts) >= 1
    for c in output.contacts:
        assert len(c.evidence) >= 1
        assert all(is_valid_public_url(ev.url) for ev in c.evidence)

    # Precision eval check
    eval_metrics = evaluate_connection_scout_precision(output)
    assert eval_metrics["evidence_precision"] == 1.0
    assert eval_metrics["url_validity"] == 1.0


@pytest.mark.anyio
async def test_connection_scout_graph_execution():
    """Test full execution of connection-scout LangGraph graph."""
    checkpointer = InMemorySaver()
    graph = build_connection_scout_graph(checkpointer=checkpointer)

    thread_id = "user_test_scout:connection-scout:job_123"
    config = {"configurable": {"thread_id": thread_id}}

    initial_input = {
        "user_id": "user_test_scout",
        "job_id": "job_123",
        "input": {
            "company": "Datadog",
            "title": "Software Engineer, Logs",
            "description_text": "High throughput distributed logging platform.",
            "evidence_snippets": [
                {
                    "title": "Datadog Engineering Team",
                    "snippet": "Alex Rivera is a Senior Engineering Manager on the Logs Platform team.",
                    "url": "https://datadog.com/team/alex-rivera",
                }
            ],
        },
    }

    updates = []
    async for update in graph.astream(initial_input, config, stream_mode="updates"):
        updates.append(update)

    state = await graph.aget_state(config)
    assert state.values.get("status") == "done"
    output = state.values.get("output", {})
    assert "contacts" in output
    assert len(output["contacts"]) >= 1

    # Invariant: Every returned contact has valid public evidence
    for contact_data in output["contacts"]:
        evidence_list = contact_data.get("evidence", [])
        assert len(evidence_list) >= 1
        for ev in evidence_list:
            assert is_valid_public_url(ev.get("url", ""))


def test_connection_scout_precision_eval_on_noisy_dataset():
    """Evaluates precision metric behavior when unevidenced items exist."""
    clean_contacts = [
        DiscoveredContact(
            name="Eve Manager",
            role_title="Engineering Manager",
            evidence=[JobContactEvidence(url="https://company.org/team/eve")],
            relevance="Hiring Manager",
        ),
        DiscoveredContact(
            name="Frank Recruiter",
            role_title="Tech Recruiter",
            evidence=[JobContactEvidence(url="https://company.org/careers/frank")],
            relevance="Recruiter",
        ),
    ]

    metrics = evaluate_connection_scout_precision({"contacts": clean_contacts})
    assert metrics["evidence_precision"] == 1.0
    assert metrics["url_validity"] == 1.0
    assert metrics["role_relevance_rate"] == 1.0
    assert metrics["total_contacts"] == 2.0
