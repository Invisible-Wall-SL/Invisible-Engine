"""Geometry-only analyzer — measurements, never semantics.

This backend needs no model and is always available. It reads the coverage statistics
the normalizer already measured and reports the one thing pixels alone can honestly
support: whether a layer behaves like a full-frame backdrop.

It will never claim a layer is a character. A compact centred blob might be a person, a
chair or a puff of smoke, and geometry cannot tell them apart — so it says "unknown"
and lets the router send the layer to UNRESOLVED rather than inventing a category.
Pair it with `captions` or a VLM backend to get real semantics.
"""

from __future__ import annotations

from .base import (
    AnalysisContext,
    BaseSemanticAnalyzer,
    LayerObservation,
    register_analyzer,
)
from ..semantic.schema import SemanticLayer

#: A layer must cover at least this much of the frame to read as a backdrop.
BACKDROP_COVERAGE = 0.95
#: ...and hug at least this much of the frame border.
BACKDROP_EDGE_CONTACT = 0.90
#: Deliberately inside the default review band (0.60-0.85): a full-frame layer is
#: *probably* the backdrop, and the pipeline should say "probably", not "certainly".
BACKDROP_CONFIDENCE = 0.72


@register_analyzer
class GeometryAnalyzer(BaseSemanticAnalyzer):
    name = "geometry"
    description = (
        "No model. Flags full-frame layers as backdrops from coverage/edge stats; "
        "everything else is left unknown rather than guessed."
    )

    def analyze(self, layer: SemanticLayer, context: AnalysisContext) -> LayerObservation:
        meta = layer.metadata
        coverage = float(meta.area_ratio)
        edge = float(meta.extra.get("edge_contact", 0.0))
        alpha_known = meta.alpha_source not in ("", "none")

        if coverage >= BACKDROP_COVERAGE and edge >= BACKDROP_EDGE_CONTACT:
            detail = "with alpha" if alpha_known else "no transparency information"
            return LayerObservation(
                description="full-frame backdrop plate",
                object_type="backdrop",
                confidence=BACKDROP_CONFIDENCE,
                extra={
                    "reason": f"coverage {coverage:.2f}, edge contact {edge:.2f} ({detail})",
                    "geometry_only": True,
                },
            )

        return LayerObservation(
            description="",
            object_type="",
            confidence=0.0,
            extra={
                "reason": (
                    f"coverage {coverage:.2f}, edge contact {edge:.2f} — geometry cannot "
                    "identify content; supply captions or use a VLM analyzer"
                ),
                "geometry_only": True,
            },
        )
