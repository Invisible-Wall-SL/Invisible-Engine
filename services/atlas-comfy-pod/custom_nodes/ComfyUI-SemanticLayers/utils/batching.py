"""Batching helpers for analyzers.

A VLM pass is the expensive part of this pipeline, so analyzers are handed layers in
chunks and are free to run one forward pass per chunk. Analyzers that cannot batch just
ignore the grouping — `BaseSemanticAnalyzer.analyze_many` handles that fallback.
"""

from __future__ import annotations

from typing import Iterator, Sequence, TypeVar

T = TypeVar("T")


def chunks(items: Sequence[T], size: int) -> Iterator[list[T]]:
    """Split into fixed-size chunks; size <= 0 means "one chunk with everything"."""
    if size <= 0:
        if items:
            yield list(items)
        return
    for start in range(0, len(items), size):
        yield list(items[start : start + size])
