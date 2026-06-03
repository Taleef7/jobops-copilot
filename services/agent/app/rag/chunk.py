"""Lightweight text chunker for embedding. Pure stdlib (CI-safe)."""

from __future__ import annotations

import re


def chunk_text(text: str, max_chars: int = 600, overlap: int = 80) -> list[str]:
    """Split text into overlapping, paragraph-aware chunks.

    Packs whole paragraphs into windows up to ``max_chars``; hard-splits any
    single paragraph longer than the window. Returns [] for empty input.
    """
    text = (text or "").strip()
    if not text:
        return []

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    buffer = ""

    for paragraph in paragraphs:
        if buffer and len(buffer) + len(paragraph) + 1 > max_chars:
            chunks.append(buffer)
            buffer = ""

        if len(paragraph) <= max_chars:
            buffer = f"{buffer}\n{paragraph}".strip() if buffer else paragraph
            continue

        if buffer:
            chunks.append(buffer)
            buffer = ""
        step = max(1, max_chars - overlap)
        for start in range(0, len(paragraph), step):
            chunks.append(paragraph[start : start + max_chars])

    if buffer:
        chunks.append(buffer)
    return chunks
