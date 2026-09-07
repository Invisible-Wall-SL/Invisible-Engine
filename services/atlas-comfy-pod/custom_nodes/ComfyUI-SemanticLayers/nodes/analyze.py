"""Node 2 — Semantic Layer Analyze.

Runs a pluggable analyzer over every layer, then maps each description onto the taxonomy.
The node answers "WHAT IS THIS?" only: it may conclude `semantic_category = character`,
but it never assigns MAIN_CHARACTER. That decision belongs to the subject resolver.

Confidence composition:

    metadata.confidence = observation.confidence x rule.confidence

The first factor is how much the backend trusts its own description; the second is how
cleanly that description maps onto a category. A hand-written caption that hits a keyword
exactly lands at 1.00 x 0.90 = 0.90 (auto-route). A geometry guess at a backdrop lands at
0.72 x 0.90 = 0.65, inside the review band — routed, but flagged.
"""

from __future__ import annotations

from typing import Optional

from ..analyzers import (
    AnalysisContext,
    AnalyzerUnavailable,
    available_analyzers,
    get_analyzer,
)
from ..analyzers.florence2 import MODELS as FLORENCE_MODELS, TASKS as FLORENCE_TASKS
from ..semantic.rules import apply_category, classify_text
from ..semantic.schema import LAYER_METADATA, SEMANTIC_LAYERS, SemanticLayerSet
from ..semantic.taxonomy import load_taxonomy
from ..utils.cache import CACHE

CATEGORY = "semantic layers"

_ANALYZERS = available_analyzers()
_DEFAULT_ANALYZER = "captions" if "captions" in _ANALYZERS else _ANALYZERS[0]


class SemanticLayerAnalyze:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "semantic_layers": (SEMANTIC_LAYERS,),
                "analyzer": (
                    _ANALYZERS,
                    {
                        "default": _DEFAULT_ANALYZER,
                        "tooltip": "captions = classify text from any captioner node "
                        "(no model loaded). geometry = coverage stats only. florence2 = "
                        "load a VLM (downloads weights). stub = tests.",
                    },
                ),
                "captions": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "tooltip": "For the 'captions' analyzer. One per line, ideally "
                        "keyed:\n0 = blue sky and clouds\n1 = woman in a red jacket\n"
                        "2 = wooden chair\nKeys may be the layer index or a layer id.",
                    },
                ),
                "caption_confidence": (
                    "FLOAT",
                    {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05,
                     "tooltip": "How much to trust the supplied captions themselves."},
                ),
                "use_cache": (
                    "BOOLEAN",
                    {"default": True, "tooltip": "Reuse observations for identical layer "
                     "content, so tweaking a downstream weight does not re-run the VLM."},
                ),
                "taxonomy_path": (
                    "STRING",
                    {"default": "", "tooltip": "Path to a taxonomy YAML. Empty = the "
                     "bundled configs/default_taxonomy.yaml."},
                ),
            },
            "optional": {
                "florence_model": (FLORENCE_MODELS, {"default": FLORENCE_MODELS[0]}),
                "florence_task": (FLORENCE_TASKS, {"default": FLORENCE_TASKS[1]}),
            },
        }

    RETURN_TYPES = (LAYER_METADATA, SEMANTIC_LAYERS, "STRING")
    RETURN_NAMES = ("LAYER_METADATA", "SEMANTIC_LAYERS", "report")
    FUNCTION = "analyze"
    CATEGORY = CATEGORY
    DESCRIPTION = (
        "Describe every layer with a pluggable analyzer and classify it through the "
        "taxonomy. Produces categories and confidence — never roles."
    )

    def analyze(
        self,
        semantic_layers: SemanticLayerSet,
        analyzer: str,
        captions: str,
        caption_confidence: float,
        use_cache: bool,
        taxonomy_path: str,
        florence_model: Optional[str] = None,
        florence_task: Optional[str] = None,
    ):
        taxonomy = load_taxonomy(taxonomy_path.strip())
        report: list[str] = []
        note = getattr(taxonomy, "load_note", "")
        if note:
            report.append(f"taxonomy: {note}")

        if not isinstance(semantic_layers, SemanticLayerSet):
            raise TypeError(
                "Semantic Layer Analyze expects a SEMANTIC_LAYERS collection — wire "
                "Semantic Layer Normalize into this input."
            )

        meta_set = semantic_layers.metadata_set()
        if len(semantic_layers) == 0:
            report.append("no layers to analyze")
            return (meta_set, semantic_layers, "\n".join(report))

        context = AnalysisContext(
            layer_count=len(semantic_layers),
            image_dimensions=semantic_layers.image_dimensions,
            source=semantic_layers.source,
            settings={
                "captions": captions,
                "caption_confidence": float(caption_confidence),
                "florence_model": florence_model or FLORENCE_MODELS[0],
                "florence_task": florence_task or FLORENCE_TASKS[1],
            },
        )

        try:
            backend = get_analyzer(analyzer)
            observations = backend.run(
                semantic_layers, context, cache=CACHE, use_cache=bool(use_cache)
            )
        except AnalyzerUnavailable as exc:
            # An unavailable backend is a configuration problem, not a modelling result.
            # Fail loudly rather than emitting empty metadata that looks like a verdict.
            raise AnalyzerUnavailable(f"Semantic Layer Analyze: {exc}") from exc

        described = classified = 0
        for meta, obs in zip(meta_set.items, observations):
            meta.analyzer = obs.analyzer or analyzer
            if obs.extra.get("reason"):
                meta.note(f"{meta.analyzer}: {obs.extra['reason']}")

            if obs.is_empty:
                meta.description = ""
                meta.confidence = 0.0
                meta.semantic_category = "unknown"
                meta.importance = 0.0
                meta.note(f"{meta.analyzer}: nothing observed — left unclassified")
                continue

            described += 1
            meta.description = obs.description or obs.object_type
            match = classify_text(f"{obs.description} {obs.object_type}".strip(), taxonomy)
            combined = float(obs.confidence) * float(match.confidence)
            apply_category(meta, match, taxonomy, confidence=combined)
            if match.matched:
                classified += 1
            else:
                meta.note(
                    "described but no taxonomy rule matched — extend configs/"
                    "default_taxonomy.yaml to classify it"
                )
            if obs.object_type and not match.object_type:
                meta.object_type = obs.object_type

        for line in context.notes:
            report.append(line)
        report.append(
            f"analyzer '{analyzer}': described {described}/{len(meta_set)} layer(s), "
            f"classified {classified}"
        )
        if use_cache:
            stats = CACHE.stats()
            report.append(
                f"cache: {stats['hits']} hit(s), {stats['misses']} miss(es), "
                f"{stats['entries']} entr(ies)"
            )

        counts: dict[str, int] = {}
        for meta in meta_set.items:
            counts[meta.semantic_category] = counts.get(meta.semantic_category, 0) + 1
        report.append(
            "categories: " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items()))
        )

        return (meta_set, semantic_layers.with_metadata(meta_set), "\n".join(report))


class SemanticCacheClear:
    """Small utility: drop cached observations (e.g. after changing a captioner)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "layer_metadata": (LAYER_METADATA,),
                "clear": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = (LAYER_METADATA, "STRING")
    RETURN_NAMES = ("LAYER_METADATA", "report")
    FUNCTION = "run"
    CATEGORY = CATEGORY
    DESCRIPTION = "Clear the analyzer observation cache. Pass-through for metadata."

    def run(self, layer_metadata, clear: bool):
        if not clear:
            return (layer_metadata, "cache untouched")
        stats = CACHE.stats()
        CACHE.clear()
        return (layer_metadata, f"cleared analyzer cache ({stats['entries']} entries)")
