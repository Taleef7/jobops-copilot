"""Retrieval-query distillation + lexical tsquery construction (#198).

The bug these cover: `retrieve_resume_evidence` passed the *whole job description* as
the retrieval query. `websearch_to_tsquery` ANDs bare terms, so a JD became a ~98-node
conjunction matching 0/16 chunks -- the lexical side of "hybrid" never fired and hybrid
was byte-identical to vector. The dense side was separately truncated to MiniLM's
256-token limit, so the query vector represented the JD header, not its requirements.

No database and no embedding model here -- these are string-construction tests.
"""

from __future__ import annotations

from app.rag.query import build_lexical_tsquery, distill_query

_JD = """
About Acme Corp
We are a fast-growing team that values collaboration and ownership. Acme is an equal
opportunity employer offering competitive benefits, unlimited PTO, and a hybrid work
environment in our downtown office.

Responsibilities
- Build and operate backend services in Python and Django
- Manage our Postgres databases and Kubernetes clusters
- Partner with the team to deliver features

Requirements
- Strong Python experience
- Familiarity with Django, Postgres, Kubernetes
"""


# --- distillation -----------------------------------------------------------


def test_parsed_skills_are_preferred_over_the_raw_description():
    query = distill_query(
        _JD, required_skills=["Python", "Django", "Kubernetes"], title="Senior Backend Engineer"
    )

    assert "Python" in query and "Django" in query and "Kubernetes" in query
    assert "Senior Backend Engineer" in query
    # The boilerplate that dominated the truncated dense query must be gone.
    assert "equal opportunity" not in query.lower()
    assert "unlimited PTO" not in query
    assert len(query) < len(_JD) / 3


def test_preferred_skills_are_included_after_required_ones():
    query = distill_query(_JD, required_skills=["Python"], preferred_skills=["Terraform"])
    assert query.index("Python") < query.index("Terraform")


def test_terms_are_deduped_case_insensitively():
    query = distill_query(_JD, required_skills=["Python", "python", "PYTHON", "Django"])
    assert query.lower().count("python") == 1
    assert "Django" in query


def test_term_count_is_capped_so_the_query_stays_embeddable():
    """MiniLM truncates at 256 word-pieces; an unbounded query silently loses its tail."""
    skills = [f"Skill{i}" for i in range(50)]
    query = distill_query(_JD, required_skills=skills, max_terms=12)
    assert len([t for t in query.split(", ") if t]) <= 12
    assert "Skill0" in query
    assert "Skill49" not in query


def test_falls_back_to_keywords_when_no_skills_were_parsed():
    """/rag/search and any unparsed path still needs a usable query."""
    query = distill_query(_JD)

    assert query  # not empty
    assert len(query) < len(_JD) / 2
    lowered = query.lower()
    assert "python" in lowered
    # Recruiting boilerplate must not crowd out the technical signal.
    for boilerplate in ("opportunity", "benefits", "collaboration", "employer"):
        assert boilerplate not in lowered


def test_fallback_drops_stopwords_and_short_tokens():
    query = distill_query("We are looking for an engineer to do the work with our team in Python")
    lowered = query.lower()
    for stop in (" we ", " are ", " for ", " an ", " to ", " the ", " with ", " our "):
        assert stop not in f" {lowered} "
    assert "python" in lowered


def test_empty_input_yields_an_empty_query_rather_than_raising():
    assert distill_query("") == ""
    assert distill_query("", required_skills=[]) == ""


def test_whitespace_only_skills_are_ignored():
    query = distill_query(_JD, required_skills=["  ", "", "Python"])
    assert query.strip().startswith("Python") or "Python" in query


# --- lexical tsquery --------------------------------------------------------


def test_terms_are_or_joined_so_partial_matches_can_rank():
    """AND semantics is the whole bug: no resume chunk satisfies every JD term."""
    assert build_lexical_tsquery(["Python", "Django"]) == '"Python" or "Django"'


def test_each_term_is_quoted_so_a_leading_hyphen_cannot_negate():
    """Verified against Postgres: unquoted `-drop` parses to `!!'drop'` (NOT drop),
    which would *exclude* matching chunks. Quoting yields a plain 'drop' lexeme."""
    assert build_lexical_tsquery(["-drop", "Python"]) == '"-drop" or "Python"'


def test_embedded_quotes_are_stripped():
    """Verified against Postgres: `"a"b" or "python"` parses to `'b' & 'python'` --
    an embedded quote silently flips the whole query back to AND semantics."""
    assert build_lexical_tsquery(['a"b', "Python"]) == '"ab" or "Python"'


def test_the_or_keyword_as_a_term_cannot_become_an_operator():
    assert build_lexical_tsquery(["or", "Python"]) == '"or" or "Python"'


def test_blank_and_empty_terms_are_dropped():
    assert build_lexical_tsquery(["", "   ", "Python"]) == '"Python"'
    assert build_lexical_tsquery([]) == ""
    assert build_lexical_tsquery(['"']) == ""


def test_multiword_terms_stay_phrases():
    assert build_lexical_tsquery(["machine learning"]) == '"machine learning"'
