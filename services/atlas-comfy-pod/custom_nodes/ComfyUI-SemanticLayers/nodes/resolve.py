"""Node 3 — Semantic Subject Resolver.

Decides which detected character is THE character. This is a relational judgement about
the whole set, which is why it is not left to the VLM: a model can be completely correct
that a layer shows a person and still have no basis for calling that person the subject.

With no characters in the set, nothing is promoted and MAIN_CHARACTER stays empty.
"""

from __future__ import annotations

from ..semantic.routing import Thresholds, resolve_subjects
from ..semantic.schema import LAYER_METADATA, LayerMetadataSet
from ..semantic.scoring import SubjectWeights
from ..semantic.taxonomy import Role

CATEGORY = "semantic layers"


class SemanticSubjectResolver:
    @classmethod
    def INPUT_TYPES(cls):
        weight = {"min": 0.0, "max": 4.0, "step": 0.05}
        return {
            "required": {
                "layer_metadata": (LAYER_METADATA,),
                "area_weight": (
                    "FLOAT",
                    {"default": 1.0, **weight, "tooltip": "How much of the frame the "
                     "layer covers."},
                ),
                "centrality_weight": (
                    "FLOAT",
                    {"default": 1.0, **weight, "tooltip": "How close its centroid is to "
                     "the frame centre."},
                ),
                "prominence_weight": (
                    "FLOAT",
                    {"default": 0.7, **weight, "tooltip": "How large it is on screen "
                     "(normalised bounding-box diagonal)."},
                ),
                "semantic_weight": (
                    "FLOAT",
                    {"default": 1.0, **weight, "tooltip": "The category's importance "
                     "from the taxonomy."},
                ),
                "confidence_weight": (
                    "FLOAT",
                    {"default": 0.5, **weight, "tooltip": "The analyzer's confidence in "
                     "its own description."},
                ),
                "layer_order_weight": (
                    "FLOAT",
                    {"default": 0.0, **weight, "tooltip": "Later layers score higher. "
                     "0 by default — leaning on incoming order is exactly what this "
                     "extension exists to avoid."},
                ),
                "min_character_confidence": (
                    "FLOAT",
                    {"default": 0.60, "min": 0.0, "max": 1.0, "step": 0.05,
                     "tooltip": "A character below this cannot become the main one."},
                ),
                "ambiguity_margin": (
                    "FLOAT",
                    {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01,
                     "tooltip": "If the winner beats the runner-up by less than this, "
                     "still pick it but flag both as uncertain. 0 disables the check."},
                ),
            }
        }

    RETURN_TYPES = (LAYER_METADATA, "STRING")
    RETURN_NAMES = ("LAYER_METADATA", "report")
    FUNCTION = "resolve"
    CATEGORY = CATEGORY
    DESCRIPTION = (
        "Pick the main character from the detected characters using configurable, "
        "measurable signals. Promotes exactly one, or none at all."
    )

    def resolve(
        self,
        layer_metadata: LayerMetadataSet,
        area_weight: float,
        centrality_weight: float,
        prominence_weight: float,
        semantic_weight: float,
        confidence_weight: float,
        layer_order_weight: float,
        min_character_confidence: float,
        ambiguity_margin: float,
    ):
        if not isinstance(layer_metadata, LayerMetadataSet):
            raise TypeError(
                "Semantic Subject Resolver expects LAYER_METADATA — wire Semantic Layer "
                "Analyze into this input."
            )

        weights = SubjectWeights(
            area=float(area_weight),
            centrality=float(centrality_weight),
            prominence=float(prominence_weight),
            semantic=float(semantic_weight),
            confidence=float(confidence_weight),
            order=float(layer_order_weight),
        )
        if weights.total() <= 0:
            raise ValueError(
                "Semantic Subject Resolver: every weight is 0, so no candidate can be "
                "ranked. Give at least one signal a non-zero weight."
            )

        resolved = resolve_subjects(
            layer_metadata,
            weights=weights,
            thresholds=Thresholds(uncertain=float(min_character_confidence)),
            min_character_confidence=float(min_character_confidence),
            ambiguity_margin=float(ambiguity_margin),
        )

        report: list[str] = []
        characters = [m for m in resolved.items if m.is_character]
        report.append(f"characters detected: {len(characters)}")

        main_id = resolved.metadata.get("main_character")
        if main_id:
            main = resolved.get(main_id)
            signals = main.extra.get("subject_signals", {}) if main else {}
            label = (main.description or main.object_type or "character") if main else "?"
            report.append(
                f"{Role.MAIN_CHARACTER}: [{main.source_layer}] {label} "
                f"(score {main.score:.3f})"
            )
            if signals:
                report.append(
                    "  signals: " + ", ".join(f"{k}={v:.2f}" for k, v in sorted(signals.items()))
                )
            margin = resolved.metadata.get("subject_margin")
            if margin is not None:
                report.append(f"  margin over runner-up: {margin:.3f}")
            if resolved.metadata.get("subject_ambiguous"):
                report.append("  AMBIGUOUS — margin below the configured threshold")
        else:
            report.append(
                f"{Role.MAIN_CHARACTER}: none — "
                f"{resolved.metadata.get('subject_note', 'no candidate')}"
            )

        seconds = [m for m in resolved.items if m.role == Role.SECONDARY_CHARACTER]
        if seconds:
            report.append(
                f"{Role.SECONDARY_CHARACTER}: "
                + ", ".join(f"[{m.source_layer}]{m.description or m.object_type}" for m in seconds)
            )

        return (resolved, "\n".join(report))
