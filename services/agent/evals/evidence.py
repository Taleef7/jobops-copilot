"""What the generator is allowed to see for one eval row — and therefore what the
judge is allowed to see.

Both sides used to be built independently: the runner always handed the whole resume
to ``score_fit`` while the retrieval sweep varied only the Ragas judge's contexts. The
two drifted, and the drift *was* the published headline — a resume-blind ``off``
baseline that had the resume in its prompt the whole time scored low faithfulness
purely because the judge could not see what the model was working from.

``Evidence`` makes that impossible: the generator's inputs and the judge's contexts
are derived from one value, so an ablation can only be run by actually withholding
evidence from the model.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.rag.chunk import chunk_text


@dataclass(frozen=True)
class Evidence:
    """The candidate evidence available for one row.

    ``resume_text`` is the whole resume handed to the generator (``""`` means the
    model gets no resume at all); ``retrieved_context`` is the top-k retrieved chunks.
    A pure retrieval ablation sets only the latter, so the resume can reach the model
    *only* through retrieval.
    """

    resume_text: str = ""
    retrieved_context: tuple[str, ...] = field(default_factory=tuple)

    def judge_contexts(self, job_description: str) -> list[str]:
        """The Ragas ``retrieved_contexts`` for this evidence — never more, never less.

        The resume is chunked so the judge receives it in the same granularity the
        retrieval modes do; a retrieved chunk that is also part of the full resume is
        counted once. The job description is always appended: a fit summary
        legitimately cites role requirements and gaps, which live in the JD, not the
        resume, so a resume-only context would mark those claims unfaithful.
        """
        contexts: list[str] = []
        for context in (*chunk_text(self.resume_text), *self.retrieved_context):
            if context not in contexts:
                contexts.append(context)
        contexts.append(job_description)
        return contexts
