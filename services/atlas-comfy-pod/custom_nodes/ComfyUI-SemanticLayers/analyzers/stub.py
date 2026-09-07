"""Deterministic stub analyzer — for tests and for wiring a graph before a VLM exists.

It does NOT invent semantics. With no scripted answer for a layer it returns an empty
observation, so the layer honestly lands in UNRESOLVED. Scripted answers are supplied
through settings, keyed by layer id or index, which is what makes it useful in tests:
the same content gets the same answer no matter what order it arrives in.
"""

from __future__ import annotations

from typing import Any

from .base import (
    AnalysisContext,
    BaseSemanticAnalyzer,
    LayerObservation,
    register_analyzer,
)
from ..semantic.schema import SemanticLayer


@register_analyzer
class StubAnalyzer(BaseSemanticAnalyzer):
    name = "stub"
    description = (
        "Test/mock backend. Returns only scripted answers from settings['scripted']; "
        "unscripted layers stay unknown. Never fabricates."
    )

    def analyze(self, layer: SemanticLayer, context: AnalysisContext) -> LayerObservation:
        scripted: dict[str, Any] = context.settings.get("scripted") or {}
        entry = scripted.get(layer.layer_id)
        if entry is None:
            entry = scripted.get(str(layer.source_index))
        if entry is None:
            return LayerObservation(
                description="",
                confidence=0.0,
                extra={"reason": "stub analyzer has no scripted answer for this layer"},
            )
        if isinstance(entry, str):
            return LayerObservation(description=entry, confidence=1.0)
        return LayerObservation(
            description=str(entry.get("description", "")),
            object_type=str(entry.get("object_type", "")),
            confidence=float(entry.get("confidence", 1.0)),
            extra={"scripted": True},
        )
