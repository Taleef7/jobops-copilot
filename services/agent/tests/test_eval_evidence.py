"""Eval-harness integrity: what the generator sees must equal what the judge sees.

These are the tests that would have caught the leak fixed in #197 — the retrieval
sweep fed the *whole* resume to the generator in every mode (including ``off``) and
only varied the judge's contexts, so the published "~3x faithfulness" delta measured
judge visibility rather than retrieval.

Every assertion here is about the *inputs* to the generator and the judge, so they
run with no provider, no database, and no LLM.
"""

from __future__ import annotations

import pytest

from app.rag.chunk import chunk_text
from evals import retrieval, run
from evals.evidence import Evidence

_JD = "Senior Python engineer. Must know Django, Postgres, and Kubernetes."
_RESUME = "Jane Doe.\n\nBuilt Django services on Postgres.\n\nRan Kubernetes in production."


def _rows():
    return [
        {"id": "r1", "description_text": _JD, "expected": {"fit_label": 70, "reference": "ref"}}
    ]


@pytest.fixture
def capture(monkeypatch):
    """Capture the generator request and the judge samples for one eval run."""
    seen: dict = {}

    def fake_score_fit(request):
        seen["request"] = request

        class _Resp:
            fit_score = 50
            fit_summary = "summary"

        return _Resp()

    def fake_ragas(samples, _model, _embeddings):
        seen["samples"] = samples
        return {"faithfulness": 0.5}

    monkeypatch.setattr(run, "score_fit", fake_score_fit)
    monkeypatch.setattr(run, "get_model", lambda: (object(), "fake:model"))
    monkeypatch.setattr(run, "fit_ragas_scores", fake_ragas)
    return seen


# --- the leak itself -------------------------------------------------------


def test_off_mode_hides_the_resume_from_the_generator(capture):
    """``off`` is the no-retrieval floor: the model gets the JD and nothing else.

    Before #197 this passed the whole resume via ``resume_text`` while telling the
    judge there was no evidence -- which is how a resume-blind baseline scored the
    *highest* fit-vs-label Spearman in the published table.
    """
    run.run_fit_score_eval(_rows(), _RESUME, evidence_for=lambda _row: Evidence())

    request = capture["request"]
    assert request.resume_text == ""
    assert list(request.retrieved_context) == []
    assert _RESUME not in _generator_prompt_inputs(request)


def test_retrieval_modes_feed_the_resume_only_through_retrieval(capture):
    """In the sweep the resume reaches the generator *only* as retrieved chunks."""
    chunks = ("Built Django services on Postgres.",)
    run.run_fit_score_eval(
        _rows(), _RESUME, evidence_for=lambda _row: Evidence(retrieved_context=chunks)
    )

    request = capture["request"]
    assert request.resume_text == ""
    assert tuple(request.retrieved_context) == chunks


def test_full_resume_mode_feeds_the_whole_resume(capture):
    """The production-path reference row: the whole resume in the prompt, no chunks."""
    run.run_fit_score_eval(
        _rows(), _RESUME, evidence_for=lambda _row: Evidence(resume_text=_RESUME)
    )

    request = capture["request"]
    assert request.resume_text == _RESUME
    assert list(request.retrieved_context) == []


# --- the invariant that keeps it fixed -------------------------------------


@pytest.mark.parametrize(
    "evidence",
    [
        Evidence(),
        Evidence(retrieved_context=("Ran Kubernetes in production.",)),
        Evidence(resume_text=_RESUME),
        Evidence(resume_text=_RESUME, retrieved_context=("Built Django services on Postgres.",)),
    ],
    ids=["off", "retrieval-only", "full-resume", "full-resume+retrieval"],
)
def test_judge_sees_exactly_what_the_generator_saw(capture, evidence):
    """The judge's contexts are derived from the same Evidence the generator got.

    The JD is always included: a fit summary legitimately cites role requirements,
    which live in the JD, not the resume.
    """
    run.run_fit_score_eval(_rows(), _RESUME, evidence_for=lambda _row: evidence)

    judge_contexts = capture["samples"][0]["retrieved_contexts"]
    assert judge_contexts == evidence.judge_contexts(_JD)

    # Nothing the generator could not see may appear in the judge's contexts.
    # Compared on normalized whitespace: chunk_text re-joins paragraphs with a single
    # newline, so a chunk is not a literal substring of the resume it came from.
    generator_text = _normalize(" ".join(_generator_prompt_inputs(capture["request"])))
    for context in judge_contexts:
        if context != _JD:
            assert _normalize(context) in generator_text


def test_evidence_judge_contexts_chunk_the_resume_and_dedupe():
    """A retrieved chunk that is also part of the full resume is not double-counted."""
    chunk = chunk_text(_RESUME)[0]
    evidence = Evidence(resume_text=_RESUME, retrieved_context=(chunk,))

    contexts = evidence.judge_contexts(_JD)
    assert contexts.count(chunk) == 1
    assert contexts[-1] == _JD
    assert set(chunk_text(_RESUME)).issubset(set(contexts))


def test_default_evidence_is_the_whole_resume(capture):
    """``python -m evals.run`` (no ``evidence_for``) keeps measuring the production path."""
    run.run_fit_score_eval(_rows(), _RESUME)

    request = capture["request"]
    assert request.resume_text == _RESUME
    assert capture["samples"][0]["retrieved_contexts"] == [*chunk_text(_RESUME), _JD]


# --- the sweep wires the modes to the right evidence ------------------------


def test_sweep_modes_map_to_the_documented_evidence():
    """Each mode's Evidence matches the table published in EVALS.md."""
    plans: dict[str, Evidence] = {}

    def fake_score(rows, resume_text, evidence_for):
        plans[fake_score.mode] = evidence_for(rows[0])
        return {"rank_correlation_spearman": 0.5, "ragas": {}}

    for mode in retrieval.RETRIEVAL_MODES:
        fake_score.mode = mode
        retrieval.run_retrieval_modes(
            _rows(),
            _RESUME,
            modes=(mode,),
            retrieve_evidence=lambda *a, **k: ["retrieved-chunk"],
            score_eval=fake_score,
            fts_ready=lambda: True,
        )

    assert plans["off"] == Evidence()
    for mode in ("vector", "hybrid", "hybrid+rerank"):
        assert plans[mode] == Evidence(retrieved_context=("retrieved-chunk",)), mode
    assert plans["full-resume"] == Evidence(resume_text=_RESUME)
    assert plans["full-resume+vector"] == Evidence(
        resume_text=_RESUME, retrieved_context=("retrieved-chunk",)
    )


def test_sweep_scopes_ingest_to_an_eval_tenant(monkeypatch):
    """A sweep must never write unowned (``user_id IS NULL``) rows into ``embeddings``.

    Unowned rows are readable by any ``retrieve(user_id=None)`` caller, so an eval run
    against a shared database would otherwise leave the sample resume where real
    retrieval could reach it.
    """
    seen: dict = {}

    def fake_retrieve_evidence(resume_text, jd, k, user_id=None):
        seen["user_id"] = user_id
        return ["chunk"]

    retrieval.run_retrieval_modes(
        _rows(),
        _RESUME,
        modes=("vector",),
        retrieve_evidence=fake_retrieve_evidence,
        score_eval=lambda rows, resume_text, evidence_for: (
            evidence_for(rows[0]),
            {"rank_correlation_spearman": 0.5, "ragas": {}},
        )[1],
        fts_ready=lambda: True,
    )

    assert seen["user_id"] == retrieval.EVAL_USER_ID
    assert seen["user_id"]


def _generator_prompt_inputs(request) -> list[str]:
    """Every string the score-fit prompt is built from (see chains/score_fit.py)."""
    return [request.description_text, request.resume_text, *request.retrieved_context]


def _normalize(text: str) -> str:
    return " ".join(text.split())
