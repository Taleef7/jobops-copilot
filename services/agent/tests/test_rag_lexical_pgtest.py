"""Lexical retrieval against a REAL Postgres — the test that would have caught #198.

Every other RAG test mocks the cursor, so they happily assert that a query string was
passed to `websearch_to_tsquery` without ever asking Postgres whether it *matches
anything*. It didn't: a raw job description compiles to a ~98-node AND-conjunction that
no resume chunk can satisfy, so the lexical side returned zero rows for 16/16 gold-set
JDs and "hybrid" silently degraded to vector-only.

Skipped unless DATABASE_URL is set (CI's `db` job provides a pgvector Postgres with the
migrations applied). Needs psycopg only -- no embeddings, no torch.
"""

from __future__ import annotations

import os
import uuid

import pytest

from app.rag.query import build_lexical_tsquery, terms_for

pytest.importorskip("psycopg")

pytestmark = pytest.mark.skipif(
    not os.getenv("DATABASE_URL"), reason="needs a real Postgres (DATABASE_URL)"
)

# Deliberately realistic: mostly company boilerplate, requirements near the end. This
# shape is exactly why truncating the dense query and ANDing the lexical one both fail.
_JD = """
About Acme Corp
Acme is a fast-growing, remote-friendly company. We value collaboration, ownership, and
impact. We offer competitive benefits, unlimited PTO, and a supportive environment where
you can grow your career. Acme is an equal opportunity employer and all qualified
applicants will receive consideration for employment without regard to any protected
characteristic. Our team partners across the organization to deliver features our
customers love.

Responsibilities
- Design, build, and operate backend services
- Collaborate with product and design partners
- Participate in on-call rotation

Requirements
- Strong experience with Python and Django
- Production experience with Postgres and Kubernetes
- Comfortable with Terraform and CI/CD pipelines
"""

_RESUME_CHUNKS = [
    "Alex Rivera — Senior Software Engineer with eight years building web platforms.",
    "SKILLS: Python, Django, FastAPI, Postgres, Kubernetes, Terraform, AWS.",
    "EXPERIENCE: Led migration of a monolith to containerized services on Kubernetes.",
    "EDUCATION: BSc Computer Science. Interests include climbing and photography.",
]


@pytest.fixture
def seeded(request):
    """Insert resume chunks under a unique source_id; always clean up."""
    import psycopg

    from app.rag.store import _vector_literal

    source_id = f"pgtest-{uuid.uuid4().hex[:12]}"
    user_id = f"pgtest-user-{uuid.uuid4().hex[:8]}"
    zero_vector = _vector_literal([0.0] * 384)

    conn = psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=10)
    with conn, conn.cursor() as cur:
        for index, chunk in enumerate(_RESUME_CHUNKS):
            cur.execute(
                "insert into embeddings "
                "(id, user_id, source_type, source_id, chunk_index, chunk_text, embedding) "
                "values (%s, %s, 'resume', %s, %s, %s, %s::vector)",
                (str(uuid.uuid4()), user_id, source_id, index, chunk, zero_vector),
            )
        conn.commit()

    def cleanup():
        url = os.environ["DATABASE_URL"]
        with psycopg.connect(url, connect_timeout=10) as c, c.cursor() as cur:
            cur.execute("delete from embeddings where source_id = %s", (source_id,))
            c.commit()

    request.addfinalizer(cleanup)
    return source_id, user_id


def _lexical_hits(source_id: str, user_id: str, tsquery: str) -> list[str]:
    import psycopg

    from app.rag.store import _lexical_candidates

    url = os.environ["DATABASE_URL"]
    with psycopg.connect(url, connect_timeout=10) as conn, conn.cursor() as cur:
        rows = _lexical_candidates(
            cur,
            tsquery,
            10,
            "where source_id = %s and user_id is not distinct from %s",
            [source_id, user_id],
        )
    return [row[1] for row in rows]


def test_the_raw_job_description_matches_nothing(seeded):
    """The bug, pinned. Kept as a test so the regression is unmistakable if reintroduced."""
    source_id, user_id = seeded
    assert _lexical_hits(source_id, user_id, _JD) == []


def test_a_distilled_query_actually_matches(seeded):
    """The fix: OR-joined distilled terms retrieve the relevant chunks."""
    source_id, user_id = seeded
    terms = terms_for(_JD, required_skills=["Python", "Django", "Postgres", "Kubernetes"])
    hits = _lexical_hits(source_id, user_id, build_lexical_tsquery(terms))

    assert hits, "lexical side returned nothing — hybrid has silently degraded to vector"
    # The skills chunk is the obvious best match; it must be in the result set.
    assert any("SKILLS:" in hit for hit in hits)


def test_ranking_prefers_the_chunk_covering_more_requirements(seeded):
    """OR semantics is only useful if ts_rank_cd then orders by coverage."""
    source_id, user_id = seeded
    terms = terms_for(_JD, required_skills=["Python", "Django", "Postgres", "Kubernetes"])
    hits = _lexical_hits(source_id, user_id, build_lexical_tsquery(terms))

    assert "SKILLS:" in hits[0]
    # The unrelated chunk must not outrank the technical ones.
    assert "EDUCATION:" not in hits[0]


def test_the_unparsed_fallback_also_matches(seeded):
    """Paths with no parsed skills (e.g. /rag/search) must still retrieve something."""
    source_id, user_id = seeded
    hits = _lexical_hits(source_id, user_id, build_lexical_tsquery(terms_for(_JD)))
    assert hits, "keyword fallback produced a query that matches nothing"


def test_lexical_stays_tenant_scoped(seeded):
    """OR semantics widens what matches — it must not widen *whose* rows match."""
    source_id, _ = seeded
    terms = terms_for(_JD, required_skills=["Python", "Django"])
    assert _lexical_hits(source_id, "somebody-else", build_lexical_tsquery(terms)) == []
