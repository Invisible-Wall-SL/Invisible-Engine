"""Node 4 — Semantic Layer Router.

The fixed downstream interface. Whatever came in — 3 layers, 7, or 12, in any order —
comes out on the same seven sockets. Nothing is discarded: the routed SEMANTIC_LAYERS
output still carries every original layer with its mask/alpha and full decision trail.
"""

from __future__ import annotations

from typing import Optional

import torch

from ..semantic.overrides import parse_overrides
from ..semantic.routing import (
    MERGE_ORDERS,
    MODES,
    ReviewMode,
    Thresholds,
    route,
    summarise,
)
from ..semantic.schema import (
    LAYER_METADATA,
    SEMANTIC_ASSETS,
    SEMANTIC_LAYERS,
    LayerMetadataSet,
    SemanticAsset,
    SemanticAssetSet,
    SemanticLayerSet,
)
from ..semantic.taxonomy import ROUTER_OUTPUT_ROLES, Role, load_taxonomy
from ..utils.image import MERGE_MODES, blank_image, merge_layers

CATEGORY = "semantic layers"


class SemanticLayerRouter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "semantic_layers": (SEMANTIC_LAYERS,),
                "layer_metadata": (LAYER_METADATA,),
                "mode": (
                    MODES,
                    {
                        "default": ReviewMode.AUTO,
                        "tooltip": "AUTO routes automatically. REVIEW routes but reports "
                        "every confidence for inspection. MANUAL routes ONLY what the "
                        "overrides name; everything else is UNRESOLVED.",
                    },
                ),
                "auto_threshold": (
                    "FLOAT",
                    {"default": 0.85, "min": 0.0, "max": 1.0, "step": 0.01,
                     "tooltip": "At or above this, routing is trusted silently."},
                ),
                "uncertain_threshold": (
                    "FLOAT",
                    {"default": 0.60, "min": 0.0, "max": 1.0, "step": 0.01,
                     "tooltip": "Below this a layer goes to UNRESOLVED rather than being "
                     "forced into a category to fill an output."},
                ),
                "merge_mode": (
                    MERGE_MODES,
                    {"default": "alpha_over", "tooltip": "How layers sharing a role are "
                     "combined. 'batch' keeps them as separate frames."},
                ),
                "merge_order": (
                    MERGE_ORDERS,
                    {"default": "area_desc", "tooltip": "Compositing order. 'area_desc' "
                     "paints the largest first (furthest back) and is independent of the "
                     "incoming layer order; 'source' deliberately uses that order."},
                ),
                "overrides": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "tooltip": "Highest-priority assignments, one per line:\n"
                        "4 = main_character\n2 = background\nKeys may be the layer index "
                        "or a layer id.",
                    },
                ),
                "taxonomy_path": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = (
        "IMAGE",
        "IMAGE",
        "IMAGE",
        "IMAGE",
        "IMAGE",
        "IMAGE",
        "IMAGE",
        SEMANTIC_ASSETS,
        SEMANTIC_LAYERS,
        LAYER_METADATA,
        "STRING",
    )
    RETURN_NAMES = (
        "BACKGROUND",
        "MAIN_CHARACTER",
        "SECONDARY_CHARACTERS",
        "ASSETS",
        "ENVIRONMENT",
        "EFFECTS",
        "OTHER",
        "SEMANTIC_ASSETS",
        "SEMANTIC_LAYERS",
        "LAYER_METADATA",
        "report",
    )
    FUNCTION = "route_layers"
    CATEGORY = CATEGORY
    DESCRIPTION = (
        "Route any number of layers onto a fixed set of semantic outputs. Downstream "
        "nodes never see the decomposer's layer count or ordering."
    )

    def route_layers(
        self,
        semantic_layers: SemanticLayerSet,
        layer_metadata: LayerMetadataSet,
        mode: str,
        auto_threshold: float,
        uncertain_threshold: float,
        merge_mode: str,
        merge_order: str,
        overrides: str,
        taxonomy_path: str,
    ):
        if not isinstance(semantic_layers, SemanticLayerSet):
            raise TypeError("Semantic Layer Router: 'semantic_layers' must be SEMANTIC_LAYERS")
        if not isinstance(layer_metadata, LayerMetadataSet):
            raise TypeError("Semantic Layer Router: 'layer_metadata' must be LAYER_METADATA")

        taxonomy = load_taxonomy(taxonomy_path.strip())
        thresholds = Thresholds(auto=float(auto_threshold), uncertain=float(uncertain_threshold))
        if thresholds.auto < thresholds.uncertain:
            raise ValueError(
                f"Semantic Layer Router: auto_threshold ({thresholds.auto:.2f}) is below "
                f"uncertain_threshold ({thresholds.uncertain:.2f}) — nothing could ever "
                "be routed confidently."
            )

        override_set = parse_overrides(overrides, taxonomy)
        plan = route(
            layer_metadata,
            taxonomy=taxonomy,
            overrides=override_set,
            thresholds=thresholds,
            mode=mode,
            merge_order=merge_order,
        )

        width, height = semantic_layers.image_dimensions
        if (width, height) == (0, 0) and len(semantic_layers):
            first = semantic_layers.layers[0].image
            height, width = int(first.shape[1]), int(first.shape[2])
        by_id = semantic_layers.by_id()

        images: list[torch.Tensor] = []
        empties: list[str] = []
        for role in ROUTER_OUTPUT_ROLES:
            ids = [lid for lid in plan.ids_for(role) if lid in by_id]
            if not ids:
                empties.append(role)
                images.append(blank_image(height, width, 3))
                continue
            picked = [by_id[lid] for lid in ids]
            merged, _mask = merge_layers(
                [layer.image for layer in picked],
                [layer.alpha for layer in picked],
                mode=merge_mode,
            )
            images.append(merged)

        assets = self._build_assets(plan, by_id, semantic_layers)
        routed_layers = semantic_layers.with_metadata(plan.metadata)

        report = [summarise(plan, taxonomy)]
        if empties:
            report.append(
                "empty output(s): " + ", ".join(empties) + " — emitted as a black frame "
                "with an all-zero mask rather than being filled with a wrong layer"
            )
        unresolved = plan.ids_for(Role.UNRESOLVED)
        if unresolved:
            report.append(
                f"{len(unresolved)} layer(s) UNRESOLVED — visible on the SEMANTIC_LAYERS "
                "output; raise confidence, add taxonomy rules, or set an override"
            )
        if override_set.errors:
            report.append("override problems:\n  " + "\n  ".join(override_set.errors))

        return (*images, assets, routed_layers, plan.metadata, "\n".join(report))

    @staticmethod
    def _build_assets(plan, by_id, layer_set: SemanticLayerSet) -> SemanticAssetSet:
        """ASSET-routed layers as an inspectable collection, never pre-flattened."""
        assets: list[SemanticAsset] = []
        for n, layer_id in enumerate(plan.ids_for(Role.ASSET), start=1):
            layer = by_id.get(layer_id)
            if layer is None:
                continue
            meta = plan.metadata.get(layer_id) or layer.metadata
            label = meta.description or meta.object_type or "unlabelled asset"
            assets.append(
                SemanticAsset(
                    asset_id=f"asset_{n:03d}",
                    label=label,
                    category=meta.object_type or meta.semantic_category,
                    image=layer.image,
                    mask=layer.mask,
                    alpha=layer.alpha,
                    metadata=meta,
                )
            )
        return SemanticAssetSet(
            assets=assets,
            source=layer_set.source,
            image_dimensions=layer_set.image_dimensions,
            metadata={"count": len(assets)},
        )
