"""Node 1 — Semantic Layer Normalize.

Turns whatever the decomposer emitted into a SEMANTIC_LAYERS collection with stable,
content-derived ids and measured geometry. This is the ONLY node that knows what a Qwen
layer batch looks like; swap the decomposer and only this node changes.

Qwen-Image-Layered specifics (verified against ComfyUI 0.21.0, see README): the sampler
produces a 5-D latent [B, 16, layers+1, H/8, W/8]; the official template runs it through
`LatentCutToBatch(dim="t")` then `VAEDecode`, which yields ONE IMAGE batch of layers+1
frames, 3-channel RGB, no alpha and no per-layer metadata. Everything this node knows
about coverage it therefore has to measure.
"""

from __future__ import annotations

from typing import Optional

import torch

from ..semantic.schema import (
    LAYER_METADATA,
    SEMANTIC_LAYERS,
    LayerMetadata,
    SemanticLayer,
    SemanticLayerSet,
    stable_layer_ids,
)
from ..utils.image import ALPHA_MODES, LayerShapeError, derive_alpha, ensure_bhwc, fingerprint, split_batch
from ..utils.masks import coverage_of_layer

COMPOSITE_CHOICES = ("none", "first", "last")

CATEGORY = "semantic layers"


class SemanticLayerNormalize:
    """Normalize an arbitrary layer batch into SEMANTIC_LAYERS."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": (
                    "IMAGE",
                    {
                        "tooltip": "The decomposer's output. For Qwen-Image-Layered wire "
                        "VAE Decode (after Latent Cut To Batch, dim=t) straight in — any "
                        "number of layers is fine."
                    },
                ),
                "alpha_mode": (
                    ALPHA_MODES,
                    {
                        "default": "auto",
                        "tooltip": "How to obtain per-layer coverage. 'auto' uses a real "
                        "alpha channel, then the mask input, then keys a uniform black/"
                        "white border — and reports 'none' when it cannot tell, rather "
                        "than inventing transparency.",
                    },
                ),
                "alpha_tolerance": (
                    "FLOAT",
                    {"default": 0.04, "min": 0.0, "max": 1.0, "step": 0.01,
                     "tooltip": "Luminance cutoff for black/white keying."},
                ),
                "composite_layer": (
                    COMPOSITE_CHOICES,
                    {
                        "default": "none",
                        "tooltip": "Qwen emits layers+1 planes; one is usually the "
                        "flattened composite. Mark it here if you know which. Default "
                        "'none' assumes nothing about ordering.",
                    },
                ),
                "drop_composite": (
                    "BOOLEAN",
                    {"default": False, "tooltip": "Remove the marked composite plane "
                     "entirely instead of routing it to OTHER."},
                ),
                "source_label": (
                    "STRING",
                    {"default": "qwen_image_layered", "tooltip": "Recorded in metadata "
                     "so downstream nodes can tell decomposers apart."},
                ),
            },
            "optional": {
                "masks": (
                    "MASK",
                    {"tooltip": "Optional per-layer coverage. One mask per layer, or a "
                     "single mask applied to all."},
                ),
            },
        }

    RETURN_TYPES = (SEMANTIC_LAYERS, LAYER_METADATA, "STRING")
    RETURN_NAMES = ("SEMANTIC_LAYERS", "LAYER_METADATA", "report")
    FUNCTION = "normalize"
    CATEGORY = CATEGORY
    DESCRIPTION = (
        "Normalize any number of decomposed layers into a SEMANTIC_LAYERS collection "
        "with stable content-derived ids, preserved alpha/masks and measured geometry."
    )

    def normalize(
        self,
        images: torch.Tensor,
        alpha_mode: str,
        alpha_tolerance: float,
        composite_layer: str,
        drop_composite: bool,
        source_label: str,
        masks: Optional[torch.Tensor] = None,
    ):
        report: list[str] = []

        try:
            batch = ensure_bhwc(images)
        except LayerShapeError as exc:
            raise LayerShapeError(f"Semantic Layer Normalize: {exc}") from exc

        if batch.shape[0] == 0:
            empty = SemanticLayerSet(
                layers=[],
                source=source_label or "unknown",
                image_dimensions=(int(batch.shape[2]), int(batch.shape[1])),
                metadata={"warning": "input image batch was empty"},
            )
            report.append("no layers in the input batch — nothing to normalize")
            return (empty, empty.metadata_set(), "\n".join(report))

        frames = split_batch(batch)
        height, width = int(batch.shape[1]), int(batch.shape[2])
        count = len(frames)

        mask_frames = self._prepare_masks(masks, count, report)
        composite_index = self._composite_index(composite_layer, count)

        alphas: list[Optional[torch.Tensor]] = []
        sources: list[str] = []
        for i, frame in enumerate(frames):
            alpha, source = derive_alpha(
                frame,
                mode=alpha_mode,
                tolerance=float(alpha_tolerance),
                mask=mask_frames[i] if mask_frames else None,
            )
            alphas.append(alpha)
            sources.append(source)

        ids = stable_layer_ids(fingerprint(frame) for frame in frames)

        layers: list[SemanticLayer] = []
        for i, (frame, alpha, alpha_source, layer_id) in enumerate(
            zip(frames, alphas, sources, ids)
        ):
            is_composite = i == composite_index
            if is_composite and drop_composite:
                continue

            coverage = coverage_of_layer(frame, alpha)
            meta = LayerMetadata(
                layer_id=layer_id,
                source_layer=i,
                bbox=coverage.bbox,
                area_ratio=coverage.area_ratio,
                centroid=coverage.centroid,
                prominence=coverage.prominence,
                alpha_source=alpha_source,
                is_composite=is_composite,
            )
            meta.extra["edge_contact"] = round(coverage.edge_contact, 4)
            meta.extra["is_empty"] = coverage.is_empty
            meta.extra["size"] = [int(frame.shape[2]), int(frame.shape[1])]
            if coverage.is_empty:
                meta.note("normalize: layer has no content above the coverage threshold")
            if is_composite:
                meta.note(f"normalize: marked as the composite plane ({composite_layer})")

            layers.append(
                SemanticLayer(
                    layer_id=layer_id,
                    image=frame,
                    mask=mask_frames[i] if mask_frames else None,
                    alpha=alpha,
                    source_index=i,
                    metadata=meta,
                )
            )

        with_alpha = sum(1 for s in sources if s != "none")
        report.append(f"normalized {len(layers)} layer(s) from a batch of {count} at {width}x{height}")
        report.append(
            f"coverage: {with_alpha}/{count} layer(s) have alpha "
            f"({', '.join(sorted(set(sources)))})"
        )
        if with_alpha == 0:
            report.append(
                "note: no transparency information available — this is expected for "
                "Qwen-Image-Layered (its VAE decodes to RGB). Geometry signals will treat "
                "every layer as full-frame; supply masks for real coverage."
            )
        if composite_index is not None:
            action = "dropped" if drop_composite else "routed to OTHER"
            report.append(f"composite plane: index {composite_index} ({action})")

        layer_set = SemanticLayerSet(
            layers=layers,
            source=source_label or "unknown",
            image_dimensions=(width, height),
            metadata={
                "input_batch": count,
                "alpha_mode": alpha_mode,
                "alpha_sources": sources,
                "composite_index": composite_index,
            },
        )
        return (layer_set, layer_set.metadata_set(), "\n".join(report))

    # --- helpers -------------------------------------------------------------------

    @staticmethod
    def _prepare_masks(
        masks: Optional[torch.Tensor], count: int, report: list[str]
    ) -> Optional[list[torch.Tensor]]:
        if masks is None:
            return None
        m = masks
        if m.ndim == 2:
            m = m.unsqueeze(0)
        if m.ndim == 4:
            m = m[..., 0]
        if m.ndim != 3:
            report.append(f"ignoring MASK input with unusable shape {tuple(masks.shape)}")
            return None

        if m.shape[0] == count:
            return [m[i : i + 1] for i in range(count)]
        if m.shape[0] == 1:
            report.append(f"one mask supplied for {count} layers — applied to all of them")
            return [m[0:1] for _ in range(count)]
        report.append(
            f"MASK batch has {m.shape[0]} entries for {count} layers — ignoring it "
            "(supply one mask per layer, or a single mask for all)"
        )
        return None

    @staticmethod
    def _composite_index(choice: str, count: int) -> Optional[int]:
        if choice == "first":
            return 0
        if choice == "last":
            return count - 1
        return None
