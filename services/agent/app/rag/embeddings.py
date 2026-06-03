"""Hugging Face sentence-transformers embeddings (runs on PyTorch).

The model import and load are lazy so the rest of the service (and CI) does not
need torch installed unless embeddings are actually used.
"""

from __future__ import annotations

from functools import lru_cache

EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
EMBED_DIM = 384


@lru_cache(maxsize=1)
def _get_model():
    from sentence_transformers import SentenceTransformer  # lazy: pulls torch

    return SentenceTransformer(EMBED_MODEL)


def embed_texts(texts: list[str]) -> list[list[float]]:
    model = _get_model()
    vectors = model.encode(list(texts), normalize_embeddings=True)
    return [vector.tolist() for vector in vectors]


def embed_query(text: str) -> list[float]:
    return embed_texts([text])[0]
