"""Turn a job description into something worth retrieving with.

Passing the raw JD as the retrieval query broke both sides of hybrid retrieval:

- **Lexical.** ``websearch_to_tsquery`` ANDs bare terms, so a 400-word JD compiled to a
  ~98-node conjunction that no resume chunk could satisfy. It matched 0/16 rows of the
  gold set, RRF fused ``[dense, []]`` (= dense), and "hybrid" was byte-identical to
  vector on every row.
- **Dense.** ``all-MiniLM-L6-v2`` truncates at 256 word-pieces, so the query vector
  represented the JD's header -- usually company boilerplate -- rather than its
  requirements.

``distill_query`` produces a short, requirement-shaped query. ``parse_job`` already
extracts exactly the right signal, so parsed skills are used when available and a
bounded keyword extraction is the fallback for unparsed paths.

Pure stdlib, like ``chunk.py`` -- imports cleanly in the light CI job.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable, Sequence

# Default cap on distilled terms. Keeps the query well inside MiniLM's 256 word-piece
# budget while leaving room for a title and multi-word skills.
DEFAULT_MAX_TERMS = 12

# Generic English function words plus the recruiting boilerplate that dominates a JD by
# frequency. Without the second group a frequency-ranked fallback returns "experience",
# "team", and "opportunity" instead of the technologies worth matching on.
_STOPWORDS = frozenset(
    """
    a about above after again against all am an and any are as at be because been before
    being below between both but by can cannot could did do does doing down during each
    few for from further had has have having he her here hers him his how if in into is it
    its itself just may me might more most must my no nor not now of off on once only or
    other ought our ours out over own same she should so some such than that the their
    theirs them then there these they this those through to too under until up very was we
    were what when where which while who whom whose why will with would you your yours
    ability across also applicant applicants based benefits candidate candidates career
    close collaborate collaboration company competitive consideration culture customers
    deliver design develop drive employer employment environment equal excellent
    experience fast features flexible focus grow growing help hybrid impact including join
    looking love make manage members mission office opportunity organization ownership
    paid participate partner partners people plus position preferred product production
    pto qualified qualifications receive regard remote required requirements
    responsibilities role roles skills strong successful support team teams technologies
    unlimited using value values work working world years
    """.split()
)

# Keep +/# so "c++" and "c#" survive tokenization; drop everything else.
_TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9+#.\-]*")

# Where a JD actually states its requirements. Frequency alone ranks the header's
# boilerplate ("Acme", "Corp", "partners") above technologies named once at the end, so
# the fallback narrows to these sections before counting.
_REQUIREMENTS_HEADING = re.compile(
    r"^[^\S\n]*[-*#\s]*(requirements?|qualifications?|responsibilities|skills?|"
    r"must[- ]haves?|nice[- ]to[- ]haves?|what you.{0,25}?(bring|do|need)|"
    r"who you are|tech(nical)?[- ](stack|skills?)|experience with)\b",
    re.IGNORECASE | re.MULTILINE,
)

# Below this, a "requirements section" is too thin to rank and the whole text is safer.
_MIN_SECTION_CHARS = 60


def _clean_terms(terms: Iterable[str] | None) -> list[str]:
    return [term.strip() for term in (terms or []) if term and term.strip()]


def _dedupe(terms: Iterable[str]) -> list[str]:
    """Order-preserving, case-insensitive dedupe."""
    seen: set[str] = set()
    unique: list[str] = []
    for term in terms:
        key = term.casefold()
        if key not in seen:
            seen.add(key)
            unique.append(term)
    return unique


def requirements_section(text: str) -> str:
    """The part of a JD from its first requirements-ish heading onward.

    Returns the whole text when no such heading exists (or the tail is too short to be
    worth narrowing to). Crude, but it targets the one structural regularity job posts
    reliably have: boilerplate first, requirements last.
    """
    match = _REQUIREMENTS_HEADING.search(text or "")
    if not match:
        return text or ""
    section = text[match.start() :]
    return section if len(section) >= _MIN_SECTION_CHARS else (text or "")


def extract_keywords(text: str, limit: int = DEFAULT_MAX_TERMS) -> list[str]:
    """Frequency-ranked content words from a JD's requirements section.

    A blunt instrument, and deliberately so: it only runs when nothing parsed the job,
    and its job is to beat "the entire job description", not to be a keyphrase extractor.
    Ties break toward first appearance, which within a requirements list approximates
    "most important first" and keeps the result deterministic.
    """
    tokens = [match.group(0) for match in _TOKEN.finditer(requirements_section(text))]
    first_seen: dict[str, int] = {}
    counts: Counter[str] = Counter()
    for index, token in enumerate(tokens):
        key = token.casefold().strip(".-")
        if len(key) < 3 or key in _STOPWORDS:
            continue
        counts[key] += 1
        first_seen.setdefault(key, index)
    ranked = sorted(counts, key=lambda key: (-counts[key], first_seen[key]))
    # Return the original casing of each keyword's first occurrence.
    originals = {}
    for token in tokens:
        originals.setdefault(token.casefold().strip(".-"), token)
    return [originals.get(key, key) for key in ranked[:limit]]


def distill_query(
    job_description: str,
    required_skills: Sequence[str] | None = None,
    preferred_skills: Sequence[str] | None = None,
    title: str | None = None,
    max_terms: int = DEFAULT_MAX_TERMS,
) -> str:
    """A compact retrieval query: title + parsed skills, else extracted keywords.

    Returned as comma-separated terms -- readable in a trace, and natural enough text
    for the dense encoder and the cross-encoder reranker. Use :func:`terms_for` to get
    the same terms as a list for the lexical side.
    """
    terms = terms_for(job_description, required_skills, preferred_skills, title, max_terms)
    return ", ".join(terms)


def terms_for(
    job_description: str,
    required_skills: Sequence[str] | None = None,
    preferred_skills: Sequence[str] | None = None,
    title: str | None = None,
    max_terms: int = DEFAULT_MAX_TERMS,
) -> list[str]:
    """The distilled terms behind :func:`distill_query`, in priority order."""
    parsed = _clean_terms(required_skills) + _clean_terms(preferred_skills)
    terms = _clean_terms([title]) + parsed
    if not parsed:
        # Nothing parsed this job: fall back to keywords, keeping any title first.
        remaining = max(0, max_terms - len(terms))
        terms += extract_keywords(job_description, limit=remaining)
    return _dedupe(terms)[:max_terms]


def build_lexical_tsquery(terms: Iterable[str]) -> str:
    """Quoted, OR-joined terms for ``websearch_to_tsquery``.

    Both halves matter, and both were verified against Postgres:

    - **OR, not AND.** ``websearch_to_tsquery`` conjoins bare terms; a resume chunk
      almost never contains every requirement, so AND matches nothing and ``ts_rank_cd``
      never gets to rank partial matches.
    - **Quote every term.** Unquoted, a leading ``-`` is the negation operator
      (``-drop`` -> ``!!'drop'``, *excluding* the chunks we want) and a bare ``or``
      becomes an operator. Embedded double quotes are stripped first: ``a"b`` would
      otherwise close the quote early and parse the rest as ``&``, silently restoring
      the AND semantics this function exists to avoid.
    """
    quoted = []
    for term in terms:
        cleaned = (term or "").replace('"', "").strip()
        if cleaned:
            quoted.append(f'"{cleaned}"')
    return " or ".join(quoted)
