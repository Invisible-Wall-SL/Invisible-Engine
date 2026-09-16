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
from ..analyzers.clip import MODELS as CLIP_MODELS
from ..analyzers.florence2 import MODELS as FLORENCE_MODELS, TASKS as FLORENCE_TASKS
from ..semantic.rules import RuleMatch, apply_category, classify_text
from ..semantic.schema import LAYER_METADATA, SEMANTIC_LAYERS, SemanticLayerSet
from ..semantic.taxonomy import load_taxonomy
from ..utils.cache import CACHE

CATEGORY = "semantic layers"

_ANALYZERS = available_analyzers()

#: Preference order for the default. `clip` first because it makes the pipeline's central
#: promise true on its own: it scores each layer FROM THE PIXELS, so reordering the layers
#: reorders the answers with them. `captions` keyed by index is an assertion about a SLOT
#: — swap two layers and it silently describes the wrong one, which is the hardcoding this
#: extension exists to remove. It stays available (and is right when a captioner is
#: already in the graph), just not the default. `florence2` is deliberately NOT preferred:
#: it needs remote code that no longer runs on current transformers, and no native-format
#: weights exist — see docs/status/comfyui.md.
_PREFERRED_DEFAULTS = ("clip", "captions", "geometry")
_DEFAULT_ANALYZER = next(
    (name for name in _PREFERRED_DEFAULTS if name in _ANALYZERS), _ANALYZERS[0]
)


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
                        "tooltip": "clip (default) = score every layer against the "
                        "taxonomy's own concepts. Reads pixels, so layer order never "
                        "matters, and the confidence is a real probability. FIRST RUN "
                        "DOWNLOADS ~600 MB. captions = classify text you supply, or any "
                        "captioner node's output; captions keyed by index describe a "
                        "SLOT, so reordering layers mislabels them. geometry = coverage "
                        "stats only, never identifies content. florence2 = broken on "
                        "current transformers, kept for older installs. stub = tests.",
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
                     "bundled configs/default_taxonomy.yaml. Ignored when taxonomy_yaml "
                     "is filled in."},
                ),
            },
            "optional": {
                "clip_model": (CLIP_MODELS, {"default": CLIP_MODELS[0]}),
                "florence_model": (FLORENCE_MODELS, {"default": FLORENCE_MODELS[0]}),
                "florence_task": (FLORENCE_TASKS, {"default": FLORENCE_TASKS[1]}),
                # LAST on purpose. ComfyUI stores widgets_values POSITIONALLY, so a new
                # widget inserted above these would shift every saved graph's values by
                # one — a graph would come back with its clip_model in taxonomy_yaml and
                # no error anywhere. Append; never insert.
                "taxonomy_yaml": (
                    "STRING",
                    {"default": "", "multiline": True, "tooltip": "The taxonomy ITSELF, "
                     "as YAML, instead of a path to it. Wins over taxonomy_path. Use this "
                     "when the render has no durable filesystem to read a file from — the "
                     "Atlas Maker's production target is a serverless worker whose "
                     "container is thrown away, so a path there can never resolve. The "
                     "Router reads this one when its own taxonomy inputs are empty, so a "
                     "single blueprint param drives both nodes and they cannot diverge."},
                ),
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
        taxonomy_yaml: Optional[str] = None,
        clip_model: Optional[str] = None,
        florence_model: Optional[str] = None,
        florence_task: Optional[str] = None,
    ):
        taxonomy_text = (taxonomy_yaml or "").strip()
        taxonomy = load_taxonomy(taxonomy_path.strip(), taxonomy_text)
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
        # Carry the taxonomy SOURCE forward on the metadata so the Router can inherit it
        # rather than being told twice. Two nodes each holding their own copy is two
        # vocabularies that silently drift apart — and the analyzer scoring against one
        # while the router resolves against another is invisible in the output.
        meta_set.metadata["taxonomy_path"] = taxonomy_path.strip()
        meta_set.metadata["taxonomy_yaml"] = taxonomy_text
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
                "clip_model": clip_model or CLIP_MODELS[0],
                # The clip backend builds its candidate labels from the taxonomy, so it
                # needs to load the same one this node did — both halves, or an inline
                # taxonomy would score against the bundled vocabulary instead of its own.
                "taxonomy_path": taxonomy_path.strip(),
                "taxonomy_yaml": taxonomy_text,
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

            if obs.category:
                # The backend classified directly (a zero-shot scorer choosing among the
                # taxonomy's own categories). Its confidence IS the answer — passing it
                # back through keyword matching would multiply in a second, unrelated
                # uncertainty for a mapping that is exact by construction.
                match = RuleMatch(
                    category=obs.category,
                    object_type=obs.object_type,
                    confidence=float(obs.confidence),
                    keyword=obs.description,
                    exact=True,
                )
                apply_category(meta, match, taxonomy, confidence=float(obs.confidence))
                classified += 1
                continue

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
