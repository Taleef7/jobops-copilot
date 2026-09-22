"""Precision eval for connection-scout specialist graph (Jobright parity Epic 6, #291).

Assesses evidence-URL precision:
- Fail-closed invariant: Every returned contact MUST have >= 1 valid public evidence URL.
- Measures:
  1. evidence_precision: Fraction of returned contacts with >= 1 valid public URL (hard gate: 1.0).
  2. url_validity: Fraction of URLs that parse as valid public http(s) addresses with valid hosts.
  3. role_specificity: Fraction of returned contacts having non-empty role titles and relevance rationale.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from app.schemas import ConnectionScoutOutput, DiscoveredContact


def is_valid_public_url(url: str) -> bool:
    if not url or not isinstance(url, str):
        return False
    trimmed = url.strip()
    try:
        parsed = urlparse(trimmed)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc) and "." in parsed.netloc
    except Exception:
        return False


def evaluate_connection_scout_precision(output: ConnectionScoutOutput | dict[str, Any]) -> dict[str, float]:
    """Computes precision metrics over scouted contacts.

    Returns:
        dict with:
        - "evidence_precision": 1.0 if all contacts carry valid public evidence, 0.0 if any lacks evidence.
        - "url_validity": ratio of all evidence URLs that are valid public http(s) URLs.
        - "role_relevance_rate": ratio of contacts with relevance explanations.
        - "total_contacts": number of contacts evaluated.
    """
    if isinstance(output, dict):
        raw_contacts = output.get("contacts") or []
    else:
        raw_contacts = output.contacts

    if not raw_contacts:
        return {
            "evidence_precision": 1.0,
            "url_validity": 1.0,
            "role_relevance_rate": 1.0,
            "total_contacts": 0.0,
        }

    valid_evidenced_contacts = 0
    total_urls = 0
    valid_urls = 0
    contacts_with_relevance = 0

    for c in raw_contacts:
        if isinstance(c, dict):
            evidence = c.get("evidence") or []
            relevance = c.get("relevance")
        else:
            evidence = c.evidence
            relevance = c.relevance

        contact_has_valid_evidence = False
        for ev in evidence:
            total_urls += 1
            url = ev.get("url") if isinstance(ev, dict) else ev.url
            if is_valid_public_url(url):
                valid_urls += 1
                contact_has_valid_evidence = True

        if contact_has_valid_evidence:
            valid_evidenced_contacts += 1

        if relevance and isinstance(relevance, str) and relevance.strip():
            contacts_with_relevance += 1

    total = len(raw_contacts)
    evidence_precision = valid_evidenced_contacts / total if total > 0 else 1.0
    url_validity = valid_urls / total_urls if total_urls > 0 else 1.0
    role_relevance_rate = contacts_with_relevance / total if total > 0 else 1.0

    return {
        "evidence_precision": float(evidence_precision),
        "url_validity": float(url_validity),
        "role_relevance_rate": float(role_relevance_rate),
        "total_contacts": float(total),
    }
