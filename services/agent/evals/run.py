"""Eval runner: score parse-job + score-fit on the gold set, write a report.

Usage::

    python -m evals.run            # writes evals/report.json + evals/report.md

Graceful degradation: with no provider key configured the run is *skipped*
(writes a status report and exits 0) so CI and key-less local runs stay green.
The Ragas judge and the live chains are only touched when a provider is present.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from app.chains.parse_job import parse_job
from app.chains.score_fit import score_fit
from app.config import settings
from app.llm.provider import get_model, resolve_provider
from app.rag.chunk import chunk_text
from app.schemas import ScoreFitRequest
from evals.gate import check_regression, check_thresholds, load_baseline, load_thresholds
from evals.metrics.extraction import exact_match, skill_prf
from evals.metrics.ragas_fit import fit_ragas_scores, mean, spearman

logger = logging.getLogger("jobops.evals")

_DATA_DIR = Path(__file__).parent / "data"

# Settings attribute holding each provider's API key.
_PROVIDER_KEYS = {
    "anthropic": "anthropic_api_key",
    "openai": "openai_api_key",
    "azure_openai": "azure_openai_api_key",
    "google_genai": "google_gemini_api_key",
}


def _provider_ready() -> bool:
    """True only when a provider is resolved *and* fully credentialed.

    Stricter than ``llm_available()``: ``resolve_provider()`` returns an explicit
    ``LLM_PROVIDER`` before checking credentials, so a ``.env`` that selects a
    provider but leaves the key (or, for Azure, the endpoint) blank would
    otherwise fall through to a failing LLM call instead of the skipped report.
    """
    provider = resolve_provider()
    attr = _PROVIDER_KEYS.get(provider or "")
    if not (attr and getattr(settings, attr, None)):
        return False
    if provider == "azure_openai" and not settings.azure_openai_endpoint:
        return False
    return True


def _load_jsonl(path: Path) -> list[dict]:
    lines = path.read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def _build_embeddings():
    """A LangChain-compatible embeddings backed by the agent's sentence-transformers
    model, so Ragas answer-relevance needs no extra provider. ``None`` if unavailable."""
    try:
        from langchain_core.embeddings import Embeddings

        from app.rag.embeddings import embed_query, embed_texts

        class _StEmbeddings(Embeddings):
            def embed_documents(self, texts):
                return embed_texts(list(texts))

            def embed_query(self, text):
                return embed_query(text)

        return _StEmbeddings()
    except Exception:  # noqa: BLE001 - answer-relevance is optional
        logger.warning("Embeddings unavailable; skipping answer-relevance", exc_info=True)
        return None


def run_parse_job_eval(rows: list[dict]) -> dict:
    """Deterministic parse-job extraction metrics over the gold set."""
    precisions, recalls, f1s, titles, seniorities = [], [], [], [], []
    errors = 0
    for row in rows:
        expected = row["expected"]
        try:
            parsed = parse_job(row["description_text"])
        except Exception:  # noqa: BLE001 - one bad row shouldn't kill the run
            # Count the failure as a zero across every metric so a flaky model is
            # penalized rather than silently dropping the row from the averages.
            logger.exception("parse_job failed for %s", row.get("id"))
            errors += 1
            precisions.append(0.0)
            recalls.append(0.0)
            f1s.append(0.0)
            titles.append(0.0)
            seniorities.append(0.0)
            continue
        precision, recall, f1 = skill_prf(parsed.required_skills, expected["required_skills"])
        precisions.append(precision)
        recalls.append(recall)
        f1s.append(f1)
        titles.append(exact_match(parsed.title, expected.get("title")))
        seniorities.append(exact_match(parsed.seniority, expected.get("seniority")))
    return {
        "n": len(rows),
        "errors": errors,
        "skill_precision": mean(precisions),
        "skill_recall": mean(recalls),
        "skill_f1": mean(f1s),
        "title_accuracy": mean(titles),
        "seniority_accuracy": mean(seniorities),
    }


def run_fit_score_eval(
    rows: list[dict],
    resume_text: str,
    contexts_for: Callable[[dict], list[str]] | None = None,
) -> dict:
    """Score-fit rank correlation + Ragas faithfulness/relevance/context-recall.

    ``contexts_for`` injects the retrieved evidence per row; it defaults to the
    whole resume chunked (today's behavior). The retrieval-mode sweep
    (``evals.retrieval``) passes a function that returns each mode's top-k chunks
    so the same scorer measures every retrieval mode.
    """
    contexts_for = contexts_for or (lambda _row: chunk_text(resume_text))
    predicted_scores, gold_labels, ragas_samples = [], [], []
    errors = 0
    for row in rows:
        expected = row["expected"]
        contexts = contexts_for(row)
        try:
            request = ScoreFitRequest(
                description_text=row["description_text"],
                resume_text=resume_text,
                profile_text="",
                retrieved_context=contexts,
            )
            response = score_fit(request)
        except Exception:  # noqa: BLE001 - one bad row shouldn't kill the run
            # Penalize the failure in the rank correlation (worst possible score
            # vs. its gold label); skip Ragas since there's no response to judge.
            logger.exception("score_fit failed for %s", row.get("id"))
            errors += 1
            predicted_scores.append(0)
            gold_labels.append(expected["fit_label"])
            continue
        predicted_scores.append(response.fit_score)
        gold_labels.append(expected["fit_label"])
        ragas_samples.append(
            {
                "user_input": (
                    "How well does this candidate's resume fit the following role?\n\n"
                    + row["description_text"]
                ),
                "response": response.fit_summary,
                # Ground faithfulness in BOTH the resume and the JD: a fit summary
                # legitimately cites role requirements/gaps, which live in the JD,
                # not the resume — so resume-only contexts would mark those claims
                # unfaithful and corrupt the score.
                "retrieved_contexts": [*contexts, row["description_text"]],
                "reference": expected["reference"],
            }
        )

    ragas_scores: dict[str, float | None] = {}
    if ragas_samples:
        try:
            ragas_scores = fit_ragas_scores(ragas_samples, get_model()[0], _build_embeddings())
        except Exception:  # noqa: BLE001 - Ragas is best-effort augmentation
            logger.exception("Ragas scoring failed; reporting rank correlation only")
    return {
        "n": len(rows),
        "errors": errors,
        "rank_correlation_spearman": spearman(predicted_scores, gold_labels),
        "ragas": ragas_scores,
    }


def render_markdown(report: dict) -> str:
    lines = ["# JobOps Copilot — Eval Report", ""]
    lines.append(f"- Generated: `{report['generated_at']}`")
    lines.append(f"- Status: **{report['status']}**")
    lines.append(f"- Judge / model: `{report.get('provider') or 'n/a'}`")
    if report["status"] != "ok":
        lines.append("")
        lines.append(f"> Skipped: {report.get('skipped_reason')}")
        return "\n".join(lines) + "\n"

    pj = report["parse_job"]
    lines += [
        "",
        "## parse-job (deterministic)",
        "",
        "| metric | score |",
        "| --- | --- |",
        f"| skill precision | {pj['skill_precision']} |",
        f"| skill recall | {pj['skill_recall']} |",
        f"| skill F1 | {pj['skill_f1']} |",
        f"| title accuracy | {pj['title_accuracy']} |",
        f"| seniority accuracy | {pj['seniority_accuracy']} |",
        f"| examples (errors) | {pj['n']} ({pj['errors']}) |",
    ]
    fs = report["fit_score"]
    ragas = fs.get("ragas", {})
    lines += [
        "",
        "## score-fit (Ragas + rank correlation)",
        "",
        "| metric | score |",
        "| --- | --- |",
        f"| fit-vs-label Spearman | {fs['rank_correlation_spearman']} |",
        f"| faithfulness | {ragas.get('faithfulness')} |",
        f"| answer relevancy | {ragas.get('answer_relevancy')} |",
        f"| context recall | {ragas.get('context_recall')} |",
        f"| examples (errors) | {fs['n']} ({fs['errors']}) |",
    ]
    return "\n".join(lines) + "\n"


def main(output_dir: Path | None = None, gate: bool = False) -> int:
    logging.basicConfig(level=logging.INFO)
    output_dir = output_dir or Path(__file__).parent
    generated_at = datetime.now(UTC).isoformat(timespec="seconds")

    if not _provider_ready():
        report = {
            "generated_at": generated_at,
            "status": "skipped",
            "skipped_reason": "no provider key configured",
            "provider": None,
        }
    else:
        _, provider_label = get_model()
        report = {
            "generated_at": generated_at,
            "status": "ok",
            "provider": provider_label,
            "parse_job": run_parse_job_eval(_load_jsonl(_DATA_DIR / "parse_job.jsonl")),
            "fit_score": run_fit_score_eval(
                _load_jsonl(_DATA_DIR / "fit_score.jsonl"),
                (_DATA_DIR / "sample_resume.txt").read_text(encoding="utf-8"),
            ),
        }

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (output_dir / "report.md").write_text(render_markdown(report), encoding="utf-8")
    print(render_markdown(report))

    # Gate (Phase 2 · J): only meaningful on a keyed run. A skipped report gates nothing,
    # so PR runs (no key) stay green. Thresholds hard-fail; regressions are flagged.
    if gate and report["status"] == "ok":
        regressions = check_regression(report, load_baseline())
        for line in regressions:
            print(f"::warning::eval regression: {line}")
        failures = check_thresholds(report, load_thresholds())
        if failures:
            for line in failures:
                print(f"::error::eval gate failed: {line}")
            return 1

    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(main(gate="--gate" in sys.argv))
