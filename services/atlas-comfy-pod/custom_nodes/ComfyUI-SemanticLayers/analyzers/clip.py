"""CLIP zero-shot analyzer — the default backend.

Unlike a captioner, this does not write prose that then has to be keyword-matched. It
scores each layer directly against the concepts the taxonomy already lists, which means:

* **The candidate labels ARE the taxonomy.** No second vocabulary to drift out of sync —
  add `raft` to the YAML and CLIP starts looking for rafts. It reads keywords and
  categories only; `default_role` is none of an analyzer's business.
* **Confidence is calibrated.** A softmax over the candidate set, marginalised per
  category, instead of the fixed constant a captioner has to invent.
* **It reads pixels**, so reordering layers reorders the descriptions with them. That is
  the whole reason this is the default rather than `captions`.

Why CLIP and not Florence-2: CLIP is native to transformers (no `auto_map`, no
downloaded modeling code) and has been for years. Florence-2 ships its own Python via
`trust_remote_code`, frozen at 2024 — and while transformers 4.51+ added a native
Florence-2, nobody published weights in that format, so both paths are dead on modern
transformers. See docs/status/comfyui.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Sequence

from .base import (
    AnalysisContext,
    AnalyzerUnavailable,
    BaseSemanticAnalyzer,
    LayerObservation,
    register_analyzer,
)
from ..semantic.schema import SemanticLayer, SemanticLayerSet
from ..semantic.taxonomy import load_taxonomy
from ..utils.image import to_pil

MODELS = (
    "openai/clip-vit-base-patch32",
    "openai/clip-vit-large-patch14",
    "laion/CLIP-ViT-H-14-laion2B-s32B-b79K",
)

#: Prompt ensembling — averaging a few phrasings is standard CLIP practice and measurably
#: steadier than any single template, especially for stylised game art.
PROMPT_TEMPLATES = (
    "a photo of {}",
    "an illustration of {}",
    "a game asset of {}",
)

#: Below this fraction of the frame, a layer is cropped to its bounding box before
#: scoring. A subject occupying 8% of a mostly-empty plate reads as "empty plate" to
#: CLIP; cropped, it reads as itself.
CROP_BELOW_COVERAGE = 0.9
#: Padding around the bbox when cropping, as a fraction of the box.
CROP_PADDING = 0.08


def _normalise(features):
    """L2-normalise embeddings, as CLIPModel.forward does before comparing them."""
    return features / features.norm(dim=-1, keepdim=True)


#: Embeddings are taken via `text_model`/`vision_model` + the projection heads rather than
#: `get_text_features()` / `get_image_features()`. On transformers 5.16.1 those helpers
#: return a `BaseModelOutputWithPooling` whose `pooler_output` is PRE-projection — using
#: it compiles, runs, and silently compares text and image vectors from different spaces.
#: The explicit path was verified to reproduce `CLIPModel.forward`'s own `text_embeds` /
#: `image_embeds` exactly (once normalised), on that version.


@dataclass(frozen=True)
class Concept:
    keyword: str
    category: str
    object_type: str


def build_concepts(taxonomy) -> list[Concept]:
    """Every distinct keyword in the taxonomy becomes a candidate label.

    First rule to claim a keyword wins, matching the priority order the rules are already
    sorted into — so `smoke` stays an effect even if some later rule also mentions it.
    """
    seen: set[str] = set()
    out: list[Concept] = []
    for rule in taxonomy.rules:
        for keyword in rule.keywords:
            if keyword in seen:
                continue
            seen.add(keyword)
            out.append(
                Concept(keyword=keyword, category=rule.category, object_type=rule.object_type)
            )
    return out


def crop_box(bbox, width: int, height: int, padding: float = CROP_PADDING):
    """Pad a bbox and clamp it to the frame. Returns None if it is degenerate."""
    if not bbox:
        return None
    x0, y0, x1, y1 = bbox
    if x1 <= x0 or y1 <= y0:
        return None
    pad_x = int((x1 - x0) * padding)
    pad_y = int((y1 - y0) * padding)
    x0 = max(0, x0 - pad_x)
    y0 = max(0, y0 - pad_y)
    x1 = min(width, x1 + pad_x)
    y1 = min(height, y1 + pad_y)
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    return (x0, y0, x1, y1)


def rank_categories(probs, concepts: Sequence[Concept]):
    """Aggregate per-concept probabilities into per-category ones.

    Uses the BEST concept in each category, then renormalises across categories — not the
    sum. Summing looks like a proper marginal but is not: the taxonomy lists 121 asset
    keywords against 22 background ones, so a sum hands `asset` five times the prior for
    no reason other than how many words someone happened to write in the YAML. Taking the
    max makes a category's score depend on how well its BEST label fits, which is
    invariant to that. Renormalising then puts the result back on a 0..1 scale the
    confidence thresholds can read.
    """
    best_in: dict[str, tuple[float, Concept]] = {}
    for prob, concept in zip(probs, concepts):
        current = best_in.get(concept.category)
        if current is None or prob > current[0]:
            best_in[concept.category] = (float(prob), concept)

    total = sum(score for score, _ in best_in.values())
    if total <= 0:
        ranked = [(name, 0.0) for name in best_in]
    else:
        ranked = [(name, score / total) for name, (score, _) in best_in.items()]
    ranked.sort(key=lambda kv: -kv[1])
    return ranked, best_in


@register_analyzer
class ClipZeroShotAnalyzer(BaseSemanticAnalyzer):
    name = "clip"
    description = (
        "Zero-shot: scores each layer against the taxonomy's own concepts with CLIP. "
        "Reads pixels, so layer order never matters. Confidence is a real probability."
    )
    batch_size = 8

    def __init__(self) -> None:
        self._model = None
        self._processor = None
        self._device = None
        self._dtype = None
        self._loaded_id = ""
        self._concepts: list[Concept] = []
        self._text_features = None
        self._concept_key = ""

    # --- setup ---------------------------------------------------------------------

    def prepare(self, layer_set: SemanticLayerSet, context: AnalysisContext) -> None:
        model_id = str(context.settings.get("clip_model", MODELS[0]))
        taxonomy = load_taxonomy(str(context.settings.get("taxonomy_path", "") or "").strip())

        self._load_model(model_id, context)

        concepts = build_concepts(taxonomy)
        if not concepts:
            raise AnalyzerUnavailable(
                "the taxonomy defines no keywords, so there is nothing for CLIP to score "
                "against. Check configs/default_taxonomy.yaml (or your taxonomy_path)."
            )

        key = f"{model_id}|{taxonomy.source_path}|{len(concepts)}"
        if key != self._concept_key:
            self._concepts = concepts
            self._text_features = self._encode_concepts(concepts)
            self._concept_key = key
            context.note(
                f"clip: {len(concepts)} concept(s) from "
                f"{taxonomy.source_path or 'built-in taxonomy'}"
            )

    def _load_model(self, model_id: str, context: AnalysisContext) -> None:
        if self._model is not None and self._loaded_id == model_id:
            return
        try:
            import torch
            from transformers import CLIPModel, CLIPProcessor
        except ImportError as exc:
            raise AnalyzerUnavailable(
                "the 'clip' analyzer needs `transformers` and `torch`, both of which "
                "ComfyUI normally ships. Switch the analyzer to 'captions' if this "
                "environment genuinely lacks them."
            ) from exc

        self._device, self._dtype = _pick_device()
        try:
            self._processor = CLIPProcessor.from_pretrained(model_id)
            self._model = (
                CLIPModel.from_pretrained(model_id, torch_dtype=self._dtype)
                .to(self._device)
                .eval()
            )
        except Exception as exc:  # noqa: BLE001 - offline, bad id, disk full…
            raise AnalyzerUnavailable(
                f"could not load CLIP model {model_id!r}: {exc}\n"
                "First use downloads it from HuggingFace, so this fails without network "
                "access. CLIP is native to transformers, so unlike Florence-2 there is no "
                "remote-code or version-skew failure mode here — if this fails it is the "
                "download, the id, or the disk."
            ) from exc
        self._loaded_id = model_id
        context.note(f"clip: {model_id} on {self._device} ({self._dtype})")

    def _encode_concepts(self, concepts: Sequence[Concept]):
        """Text side is computed once per (model, taxonomy) and reused for every layer."""
        import torch

        prompts = [t.format(c.keyword) for c in concepts for t in PROMPT_TEMPLATES]
        inputs = self._processor(text=prompts, return_tensors="pt", padding=True)
        inputs = {k: v.to(self._device) for k, v in inputs.items()}
        with torch.inference_mode():
            pooled = self._model.text_model(**inputs).pooler_output
            feats = _normalise(self._model.text_projection(pooled))
        # Mean-pool the template ensemble back down to one vector per concept.
        feats = feats.view(len(concepts), len(PROMPT_TEMPLATES), -1).mean(dim=1)
        return _normalise(feats)

    # --- scoring --------------------------------------------------------------------

    def _prepare_image(self, layer: SemanticLayer):
        """PIL image for CLIP, cropped to the layer's content when that is known."""
        image = to_pil(layer.image).convert("RGB")
        meta = layer.metadata
        if meta.area_ratio and meta.area_ratio < CROP_BELOW_COVERAGE:
            box = crop_box(meta.bbox, image.width, image.height)
            if box is not None:
                return image.crop(box), True
        return image, False

    def analyze(self, layer: SemanticLayer, context: AnalysisContext) -> LayerObservation:
        return self.analyze_many([layer], context)[0]

    def analyze_many(
        self, layers: Sequence[SemanticLayer], context: AnalysisContext
    ) -> list[LayerObservation]:
        if self._model is None or self._text_features is None:
            raise AnalyzerUnavailable("clip analyzer used before prepare() succeeded")

        import torch

        images, cropped = [], []
        for layer in layers:
            image, was_cropped = self._prepare_image(layer)
            images.append(image)
            cropped.append(was_cropped)

        inputs = self._processor(images=images, return_tensors="pt")
        pixel_values = inputs["pixel_values"].to(self._device, self._dtype)
        with torch.inference_mode():
            pooled = self._model.vision_model(pixel_values=pixel_values).pooler_output
            feats = _normalise(self._model.visual_projection(pooled))

        scale = self._model.logit_scale.exp().detach()
        logits = scale.float() * feats.float() @ self._text_features.float().T
        all_probs = logits.softmax(dim=-1).cpu()

        out: list[LayerObservation] = []
        for row, was_cropped in zip(all_probs, cropped):
            ranked, best_in = rank_categories(row.tolist(), self._concepts)
            category, confidence = ranked[0]
            _, concept = best_in[category]
            runner_up = ranked[1] if len(ranked) > 1 else (None, 0.0)
            out.append(
                LayerObservation(
                    description=concept.keyword,
                    object_type=concept.object_type,
                    category=category,
                    confidence=float(confidence),
                    extra={
                        "cropped_to_bbox": was_cropped,
                        "runner_up": runner_up[0],
                        "margin": round(float(confidence) - float(runner_up[1]), 4),
                        "top_categories": {c: round(p, 4) for c, p in ranked[:4]},
                        "model": self._loaded_id,
                    },
                )
            )
        return out

    def close(self) -> None:
        self._model = None
        self._processor = None
        self._text_features = None
        self._loaded_id = ""
        self._concept_key = ""
        try:
            import comfy.model_management as mm

            mm.soft_empty_cache()
        except Exception:  # noqa: BLE001
            pass


def _pick_device():
    import torch

    try:
        import comfy.model_management as mm

        device = mm.get_torch_device()
        return device, torch.float16 if mm.should_use_fp16(device) else torch.float32
    except Exception:  # noqa: BLE001 - standalone / test use
        if torch.cuda.is_available():
            return torch.device("cuda"), torch.float16
        return torch.device("cpu"), torch.float32
