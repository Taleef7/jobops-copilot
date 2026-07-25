"""Replicate-run noise estimation: how much does this eval move when nothing changes?

The retrieval sweep compares modes whose scores differ by a few hundredths. Before any
such delta can be called a result, you need to know how much the pipeline moves on its
own — the generator samples at a non-zero temperature and the Ragas judge is itself an
LLM.

Observing that two identical-input runs differed by some amount shows variance of that
order *occurred*; it does not bound it. This module runs the same configuration N times
and reports an actual interval, so a between-mode delta can be compared against the
spread of a no-op change.

Retrieval is held fixed: ``vector`` mode over an already-ingested resume returns the
same chunks every time, so all observed movement is generator + judge variance.
"""

from __future__ import annotations

import json
import logging
import statistics
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from app.config import settings
from app.rag.store import retrieve_resume_evidence
from evals.evidence import Evidence
from evals.retrieval import EVAL_USER_ID
from evals.run import run_fit_score_eval

logger = logging.getLogger("jobops.evals")

# Metrics worth a spread estimate: the rank correlation plus every Ragas score.
_RAGAS_METRICS = ("faithfulness", "answer_relevancy", "context_recall")


def summarize_spread(values: list[float | None]) -> dict:
    """Centre and worst case for one metric across replicates.

    ``max_pairwise_delta`` is the headline: it is the widest gap between any two runs
    of the *same* configuration, which is directly comparable to a between-mode delta.
    ``None`` values (a Ragas metric that failed to score) are dropped rather than
    treated as zero.
    """
    present = [v for v in values if v is not None]
    if not present:
        return {
            "n": 0,
            "mean": None,
            "stdev": None,
            "min": None,
            "max": None,
            "max_pairwise_delta": None,
        }
    return {
        "n": len(present),
        "mean": round(statistics.fmean(present), 4),
        # Sample stdev: these replicates are a sample of possible runs, not the
        # population of them. Undefined for a single observation.
        "stdev": round(statistics.stdev(present), 4) if len(present) > 1 else None,
        "min": round(min(present), 4),
        "max": round(max(present), 4),
        "max_pairwise_delta": round(max(present) - min(present), 4),
    }


def run_replicates(
    rows: list[dict],
    resume_text: str,
    *,
    replicates: int = 5,
    k: int = 4,
    mode: str = "vector",
    rerank: bool = False,
    retrieve_evidence: Callable = retrieve_resume_evidence,
    score_eval: Callable = run_fit_score_eval,
    parsed_by_id: dict[str, dict] | None = None,
) -> dict:
    """Score the same evidence ``replicates`` times; return the per-metric spread.

    Every replicate is handed the *same* ``Evidence``, retrieved once up front — if the
    inputs varied between runs this would measure retrieval, not noise.

    ``mode`` picks which retrieval configuration to freeze. Estimating the spread of the
    *specific* mode under discussion matters: a single sweep value has landed outside its
    own five-replicate range three times now, so a "mode A beats mode B" claim needs the
    winning mode replicated too, not just the reference one.
    """
    if replicates < 2:
        raise ValueError("noise estimation needs at least 2 replicates")

    original = (settings.rag_retrieval_mode, settings.rag_rerank_enabled)
    try:
        settings.rag_retrieval_mode = mode
        settings.rag_rerank_enabled = rerank
        # Retrieve once and freeze it, so every replicate is byte-identical.
        # Same parsed fields the sweep and production use, so the spread is measured on
        # the configuration actually being compared (#202 review).
        lookup = parsed_by_id or {}
        frozen = {
            index: Evidence(
                retrieved_context=tuple(
                    retrieve_evidence(
                        resume_text,
                        row["description_text"],
                        k=k,
                        user_id=EVAL_USER_ID,
                        required_skills=(lookup.get(row.get("id")) or {}).get("required_skills"),
                        title=(lookup.get(row.get("id")) or {}).get("title"),
                    )
                )
            )
            for index, row in enumerate(rows)
        }
        by_row = {id(row): frozen[index] for index, row in enumerate(rows)}

        runs = []
        for attempt in range(replicates):
            logger.info("noise replicate %d/%d", attempt + 1, replicates)
            metrics = score_eval(rows, resume_text, evidence_for=lambda row: by_row[id(row)])
            runs.append(
                {
                    "rank_correlation_spearman": metrics.get("rank_correlation_spearman"),
                    **{name: (metrics.get("ragas") or {}).get(name) for name in _RAGAS_METRICS},
                }
            )
    finally:
        settings.rag_retrieval_mode, settings.rag_rerank_enabled = original

    metric_names = ("rank_correlation_spearman", *_RAGAS_METRICS)
    return {
        "mode": mode + ("+rerank" if rerank else ""),
        "replicates": replicates,
        "runs": runs,
        "spread": {name: summarize_spread([run[name] for run in runs]) for name in metric_names},
    }


def render_noise_markdown(report: dict) -> str:
    lines = ["# JobOps Copilot — Eval Noise Floor", ""]
    lines.append(f"- Generated: `{report['generated_at']}`")
    lines.append(f"- Judge / model: `{report.get('provider') or 'n/a'}`")
    if report["status"] != "ok":
        lines += ["", f"> Skipped: {report.get('skipped_reason')}"]
        return "\n".join(lines) + "\n"

    lines += [
        f"- Configuration: `{report['mode']}` retrieval, **{report['replicates']} replicates**",
        "",
        "Identical evidence every run — retrieval is frozen up front, so all movement below",
        "is generator sampling + Ragas judge variance. Compare a between-mode delta against",
        "`max pairwise Δ`: a difference smaller than what a *no-op change* produces is not a",
        "result.",
        "",
        "| metric | mean | stdev | min | max | max pairwise Δ |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for name, spread in report["spread"].items():
        if not spread["n"]:
            lines.append(f"| {name} | _n/a_ | _n/a_ | _n/a_ | _n/a_ | _n/a_ |")
            continue
        lines.append(
            f"| {name} | {spread['mean']} | {spread['stdev']} | {spread['min']} "
            f"| {spread['max']} | **{spread['max_pairwise_delta']}** |"
        )
    return "\n".join(lines) + "\n"


def noise_main(output_dir: Path | None = None, replicates: int = 5) -> int:
    """Entry for ``python -m evals.run --noise-floor [N]``."""
    logging.basicConfig(level=logging.INFO)
    output_dir = output_dir or Path(__file__).parent
    generated_at = datetime.now(UTC).isoformat(timespec="seconds")

    from app.rag.store import rag_available
    from evals.retrieval import load_gold_parses
    from evals.run import _DATA_DIR, _load_jsonl, _provider_ready, get_model

    if not _provider_ready() or not rag_available():
        reason = "no provider key configured" if not _provider_ready() else "no database configured"
        report = {
            "generated_at": generated_at,
            "status": "skipped",
            "skipped_reason": reason,
            "provider": None,
        }
    else:
        _, provider_label = get_model()
        rows = _load_jsonl(_DATA_DIR / "fit_score.jsonl")
        resume = (_DATA_DIR / "sample_resume.txt").read_text(encoding="utf-8")
        report = {
            "generated_at": generated_at,
            "status": "ok",
            "provider": provider_label,
            **run_replicates(
                rows, resume, replicates=replicates, parsed_by_id=load_gold_parses()
            ),
        }

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "noise_report.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    (output_dir / "noise_report.md").write_text(render_noise_markdown(report), encoding="utf-8")
    print(render_noise_markdown(report))
    return 0
