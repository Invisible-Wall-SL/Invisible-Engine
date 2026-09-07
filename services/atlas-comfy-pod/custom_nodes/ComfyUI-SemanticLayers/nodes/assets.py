"""Nodes 5 & 6 — the collection accessors.

The router deliberately does NOT flatten same-role layers into one image internally: it
keeps them as a SEMANTIC_ASSETS collection so downstream graphs can filter, select,
export or inspect individual items. These two nodes are how you get pixels back out.
"""

from __future__ import annotations

import torch

from ..semantic.schema import (
    SEMANTIC_ASSETS,
    SEMANTIC_LAYERS,
    SemanticAssetSet,
    SemanticLayerSet,
)
from ..semantic.taxonomy import ROUTER_OUTPUT_ROLES, Role
from ..utils.image import MERGE_MODES, blank_image, merge_layers

CATEGORY = "semantic layers"

ROLE_CHOICES = tuple(list(ROUTER_OUTPUT_ROLES) + [Role.UNRESOLVED])


def _empty(height: int, width: int) -> tuple[torch.Tensor, torch.Tensor]:
    return blank_image(height, width, 3), torch.zeros((1, max(1, height), max(1, width)))


class SemanticAssetSelector:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "assets": (SEMANTIC_ASSETS,),
                "index": (
                    "INT",
                    {"default": -1, "min": -1, "max": 4096,
                     "tooltip": "-1 returns every matching asset (combined by "
                     "merge_mode); 0+ picks one."},
                ),
                "object_type": (
                    "STRING",
                    {"default": "", "tooltip": "Exact object_type filter, e.g. "
                     "'furniture' or 'vehicle'. Empty = any."},
                ),
                "label_contains": (
                    "STRING",
                    {"default": "", "tooltip": "Case-insensitive substring of the label."},
                ),
                "merge_mode": (MERGE_MODES, {"default": "batch"}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "INT", SEMANTIC_ASSETS)
    RETURN_NAMES = ("IMAGE", "MASK", "labels", "count", "SEMANTIC_ASSETS")
    FUNCTION = "select"
    CATEGORY = CATEGORY
    DESCRIPTION = "Filter and fetch assets from a SEMANTIC_ASSETS collection."

    def select(
        self,
        assets: SemanticAssetSet,
        index: int,
        object_type: str,
        label_contains: str,
        merge_mode: str,
    ):
        if not isinstance(assets, SemanticAssetSet):
            raise TypeError("Semantic Asset Selector: 'assets' must be SEMANTIC_ASSETS")

        width, height = assets.image_dimensions
        filtered = assets.filtered(
            object_type=object_type.strip(), label_contains=label_contains.strip()
        )
        picked = list(filtered.assets)

        if index >= 0:
            if index >= len(picked):
                labels = f"index {index} out of range ({len(picked)} matching asset(s))"
                img, mask = _empty(height, width)
                return (img, mask, labels, 0, filtered)
            picked = [picked[index]]

        if not picked:
            img, mask = _empty(height, width)
            return (img, mask, "no matching assets", 0, filtered)

        if (width, height) == (0, 0):
            height, width = int(picked[0].image.shape[1]), int(picked[0].image.shape[2])

        image, mask = merge_layers(
            [a.image for a in picked], [a.alpha for a in picked], mode=merge_mode
        )
        labels = "\n".join(f"{a.asset_id}: {a.label} ({a.category})" for a in picked)
        return (image, mask, labels, len(picked), filtered)


class SemanticRoleSelect:
    """Pull the IMAGE + MASK for any role out of a routed SEMANTIC_LAYERS collection.

    The router's seven IMAGE outputs are the convenient path; this is the one to use
    when you also need the coverage mask, or want UNRESOLVED layers.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "semantic_layers": (
                    SEMANTIC_LAYERS,
                    {"tooltip": "The router's SEMANTIC_LAYERS output (roles assigned)."},
                ),
                "role": (ROLE_CHOICES, {"default": Role.MAIN_CHARACTER}),
                "merge_mode": (MERGE_MODES, {"default": "alpha_over"}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "STRING")
    RETURN_NAMES = ("IMAGE", "MASK", "count", "labels")
    FUNCTION = "select"
    CATEGORY = CATEGORY
    DESCRIPTION = "Fetch the image and coverage mask for one semantic role."

    def select(self, semantic_layers: SemanticLayerSet, role: str, merge_mode: str):
        if not isinstance(semantic_layers, SemanticLayerSet):
            raise TypeError("Semantic Role Select: 'semantic_layers' must be SEMANTIC_LAYERS")

        width, height = semantic_layers.image_dimensions
        if (width, height) == (0, 0) and len(semantic_layers):
            first = semantic_layers.layers[0].image
            height, width = int(first.shape[1]), int(first.shape[2])

        picked = [layer for layer in semantic_layers.layers if layer.metadata.role == role]
        if not picked:
            img, mask = _empty(height, width)
            return (img, mask, 0, f"no layers routed to {role}")

        # Same deterministic ordering the router uses, so this node and the router's
        # own outputs never disagree about compositing order.
        picked.sort(key=lambda layer: (-layer.metadata.area_ratio, layer.layer_id))
        image, mask = merge_layers(
            [layer.image for layer in picked],
            [layer.alpha for layer in picked],
            mode=merge_mode,
        )
        labels = "\n".join(
            f"[{layer.metadata.source_layer}] "
            f"{layer.metadata.description or layer.metadata.object_type or 'unlabelled'}"
            f" ({layer.metadata.confidence:.0%})"
            for layer in picked
        )
        return (image, mask, len(picked), labels)
