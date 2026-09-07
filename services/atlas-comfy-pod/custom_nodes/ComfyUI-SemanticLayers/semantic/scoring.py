"""Main-character scoring.

"Is this a character?" is a classification question, answered by an analyzer + rules.
"Which character is THE character?" is a relational question about the whole layer set,
answered here. Keeping them apart is the reason a VLM that is certain a layer shows a
person still does not get to decide that the person is the subject.

Every signal is normalised to 0..1 and combined with configurable weights.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Sequence

from .schema import LayerMetadata

#: Longest possible distance from frame centre in normalised coords.
_MAX_CENTRE_DIST = math.sqrt(0.5 ** 2 + 0.5 ** 2)


@dataclass
class SubjectWeights:
    """Weights for the main-character score. Any weight may be 0 to disable a signal.

    `order` is 0 by default on purpose: leaning on the incoming layer order is exactly
    the assumption this extension exists to remove. It is exposed because a pipeline
    whose decomposer *does* emit meaningful depth order may legitimately want it.
    """

    area: float = 1.0
    centrality: float = 1.0
    prominence: float = 0.7
    semantic: float = 1.0
    confidence: float = 0.5
    order: float = 0.0

    def total(self) -> float:
        return self.area + self.centrality + self.prominence + self.semantic + self.confidence + self.order


@dataclass
class SubjectScore:
    layer_id: str
    score: float
    signals: dict[str, float]


def centrality_of(centroid: Optional[tuple[float, float]]) -> float:
    """1.0 dead centre, 0.0 in a corner. Unknown centroid scores neutral."""
    if not centroid:
        return 0.5
    cx, cy = centroid
    dist = math.sqrt((cx - 0.5) ** 2 + (cy - 0.5) ** 2)
    return max(0.0, 1.0 - dist / _MAX_CENTRE_DIST)


def order_of(meta: LayerMetadata, layer_count: int) -> float:
    """Later layers score higher — in most decompositions later == nearer the camera."""
    if layer_count <= 1:
        return 0.5
    return max(0.0, min(1.0, meta.source_layer / (layer_count - 1)))


def score_layer(meta: LayerMetadata, weights: SubjectWeights, layer_count: int) -> SubjectScore:
    signals = {
        "area": max(0.0, min(1.0, meta.area_ratio)),
        "centrality": centrality_of(meta.centroid),
        "prominence": max(0.0, min(1.0, meta.prominence)),
        "semantic": max(0.0, min(1.0, meta.importance)),
        "confidence": max(0.0, min(1.0, meta.confidence)),
        "order": order_of(meta, layer_count),
    }
    total = weights.total()
    if total <= 0:
        return SubjectScore(layer_id=meta.layer_id, score=0.0, signals=signals)

    weighted = (
        weights.area * signals["area"]
        + weights.centrality * signals["centrality"]
        + weights.prominence * signals["prominence"]
        + weights.semantic * signals["semantic"]
        + weights.confidence * signals["confidence"]
        + weights.order * signals["order"]
    )
    return SubjectScore(layer_id=meta.layer_id, score=weighted / total, signals=signals)


def rank_subjects(
    metas: Sequence[LayerMetadata],
    weights: SubjectWeights,
    layer_count: int,
) -> list[SubjectScore]:
    """Score and rank candidates, highest first.

    Ties break on layer_id — never on position in the input list — so shuffling the
    incoming layers cannot change which candidate wins.
    """
    scores = [score_layer(m, weights, layer_count) for m in metas]
    scores.sort(key=lambda s: (-s.score, s.layer_id))
    return scores
