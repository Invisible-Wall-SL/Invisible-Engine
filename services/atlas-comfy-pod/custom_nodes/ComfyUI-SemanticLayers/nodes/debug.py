"""Node 7 — Semantic Layer Debug.

A contact sheet of every layer with its id, detected label, category, assigned role and
confidence. This is the node you keep wired while tuning a taxonomy: routing bugs are
almost always classification bugs, and they are obvious the moment you can see all the
layers side by side with what the pipeline decided about each one.
"""

from __future__ import annotations

import json
from typing import Optional, Sequence

import torch

from ..semantic.schema import (
    LAYER_METADATA,
    SEMANTIC_LAYERS,
    LayerMetadata,
    LayerMetadataSet,
    SemanticLayerSet,
)
from ..semantic.taxonomy import Role
from ..utils.image import blank_image, from_pil, rgb_of, to_pil

CATEGORY = "semantic layers"

_BG = (24, 24, 28)
_CELL = (34, 34, 40)
_TEXT = (232, 232, 236)
_MUTED = (150, 150, 160)
_WARN = (245, 176, 66)

_ROLE_COLOURS = {
    Role.BACKGROUND: (86, 140, 220),
    Role.MAIN_CHARACTER: (94, 214, 130),
    Role.SECONDARY_CHARACTER: (140, 200, 170),
    Role.ASSET: (214, 176, 92),
    Role.ENVIRONMENT: (120, 190, 200),
    Role.EFFECT: (200, 130, 220),
    Role.OTHER: (150, 150, 160),
    Role.UNRESOLVED: (222, 96, 96),
}


def _font(size: int):
    from PIL import ImageFont

    for name in ("arial.ttf", "DejaVuSans.ttf", "LiberationSans-Regular.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:  # noqa: BLE001 - font hunting is best-effort by nature
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1 has no size argument
        return ImageFont.load_default()


def _fit(text: str, font, max_width: int) -> str:
    if not text:
        return ""
    try:
        if font.getlength(text) <= max_width:
            return text
    except Exception:  # noqa: BLE001
        return text[:40]
    ellipsis = "…"
    out = text
    while out and font.getlength(out + ellipsis) > max_width:
        out = out[:-1]
    return (out + ellipsis) if out else ""


class SemanticLayerDebug:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "semantic_layers": (SEMANTIC_LAYERS,),
                "columns": ("INT", {"default": 4, "min": 1, "max": 16}),
                "cell_size": ("INT", {"default": 256, "min": 64, "max": 1024, "step": 32}),
                "show_notes": (
                    "BOOLEAN",
                    {"default": False, "tooltip": "Print the full decision trail for "
                     "each layer under its thumbnail."},
                ),
            },
            "optional": {
                "layer_metadata": (
                    LAYER_METADATA,
                    {"tooltip": "Optional. When omitted the layers' own metadata is "
                     "used, so this node works at any point in the chain."},
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("contact_sheet", "metadata_json")
    FUNCTION = "render"
    CATEGORY = CATEGORY
    OUTPUT_NODE = True
    DESCRIPTION = (
        "Contact sheet of every layer with its id, label, category, role and confidence, "
        "plus the full metadata as JSON."
    )

    def render(
        self,
        semantic_layers: SemanticLayerSet,
        columns: int,
        cell_size: int,
        show_notes: bool,
        layer_metadata: Optional[LayerMetadataSet] = None,
    ):
        if not isinstance(semantic_layers, SemanticLayerSet):
            raise TypeError("Semantic Layer Debug: 'semantic_layers' must be SEMANTIC_LAYERS")

        meta_set = layer_metadata if isinstance(layer_metadata, LayerMetadataSet) else None
        lookup = meta_set.by_id() if meta_set else {}
        metas: list[LayerMetadata] = [
            lookup.get(layer.layer_id, layer.metadata) for layer in semantic_layers.layers
        ]

        payload = {
            "source": semantic_layers.source,
            "image_dimensions": list(semantic_layers.image_dimensions),
            "layer_count": len(semantic_layers),
            "layers": [m.to_dict() for m in metas],
            "roles": self._role_counts(metas),
        }
        metadata_json = json.dumps(payload, indent=2)

        if not semantic_layers.layers:
            return (blank_image(64, 256, 3), metadata_json)

        sheet = self._draw(
            [layer.image for layer in semantic_layers.layers],
            metas,
            max(1, int(columns)),
            max(64, int(cell_size)),
            bool(show_notes),
        )
        return (sheet, metadata_json)

    # --- drawing --------------------------------------------------------------------

    @staticmethod
    def _role_counts(metas: Sequence[LayerMetadata]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for m in metas:
            counts[m.role] = counts.get(m.role, 0) + 1
        return counts

    def _draw(
        self,
        images: Sequence[torch.Tensor],
        metas: Sequence[LayerMetadata],
        columns: int,
        cell_size: int,
        show_notes: bool,
    ) -> torch.Tensor:
        from PIL import Image, ImageDraw

        pad = max(6, cell_size // 24)
        title_size = max(11, cell_size // 18)
        body_size = max(10, cell_size // 22)
        title_font = _font(title_size)
        body_font = _font(body_size)

        note_lines = 0
        if show_notes:
            note_lines = max((len(m.notes) for m in metas), default=0)
        text_rows = 4 + note_lines
        text_height = pad + text_rows * (body_size + 3) + title_size + 4
        cell_w = cell_size + pad * 2
        cell_h = cell_size + text_height + pad

        rows = (len(images) + columns - 1) // columns
        sheet = Image.new("RGB", (cell_w * columns, cell_h * rows), _BG)
        draw = ImageDraw.Draw(sheet)

        for i, (image, meta) in enumerate(zip(images, metas)):
            col, row = i % columns, i // columns
            ox, oy = col * cell_w, row * cell_h
            draw.rectangle([ox + 2, oy + 2, ox + cell_w - 3, oy + cell_h - 3], fill=_CELL)

            thumb = to_pil(rgb_of(image)).convert("RGB")
            thumb.thumbnail((cell_size, cell_size), Image.LANCZOS)
            tx = ox + pad + (cell_size - thumb.width) // 2
            ty = oy + pad + (cell_size - thumb.height) // 2
            sheet.paste(thumb, (tx, ty))

            colour = _ROLE_COLOURS.get(meta.role, _MUTED)
            draw.rectangle(
                [ox + pad, oy + pad, ox + pad + cell_size - 1, oy + pad + cell_size - 1],
                outline=colour,
                width=2,
            )

            text_x = ox + pad
            text_y = oy + pad + cell_size + pad
            max_w = cell_size

            draw.text(
                (text_x, text_y),
                _fit(f"[{meta.source_layer}] {meta.layer_id}", title_font, max_w),
                font=title_font,
                fill=_MUTED,
            )
            text_y += title_size + 4

            label = meta.description or meta.object_type or "(nothing observed)"
            draw.text(
                (text_x, text_y),
                _fit(label, body_font, max_w),
                font=body_font,
                fill=_TEXT if meta.description else _MUTED,
            )
            text_y += body_size + 3

            # Category (what it IS) and role (what the pipeline DID with it) are
            # deliberately distinct concepts, so they must never read as one repeated
            # word when they happen to coincide.
            draw.text(
                (text_x, text_y),
                _fit(f"is: {meta.semantic_category}", body_font, max_w),
                font=body_font,
                fill=_MUTED,
            )
            text_y += body_size + 3

            draw.text(
                (text_x, text_y),
                _fit(f"→ {meta.role}", body_font, max_w),
                font=body_font,
                fill=colour,
            )
            text_y += body_size + 3

            conf = f"{meta.confidence:.0%}"
            if meta.uncertain:
                conf += "  UNCERTAIN"
            if meta.extra.get("overridden"):
                conf += "  OVERRIDE"
            draw.text(
                (text_x, text_y),
                _fit(conf, body_font, max_w),
                font=body_font,
                fill=_WARN if meta.uncertain else _MUTED,
            )
            text_y += body_size + 3

            if show_notes:
                for note in meta.notes:
                    draw.text(
                        (text_x, text_y), _fit(note, body_font, max_w), font=body_font, fill=_MUTED
                    )
                    text_y += body_size + 3

        return from_pil(sheet)
