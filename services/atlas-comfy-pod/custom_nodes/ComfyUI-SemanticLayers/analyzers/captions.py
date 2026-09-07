"""Caption-driven analyzer — the practical, model-agnostic default.

Instead of binding this extension to one VLM, this backend consumes plain text: wire ANY
captioner already in your graph (Florence-2, JoyCaption, WD14, an LLM node, or your own
typing) into the Analyze node's `captions` input and the taxonomy does the rest.

Two input styles:

    keyed (recommended)         unkeyed (positional)
    0 = blue sky and clouds     blue sky and clouds
    1 = woman in a red jacket   woman in a red jacket
    2 = wooden chair            wooden chair

Keys may be the original layer index or a stable layer id. Unkeyed lines are matched in
the incoming layer order — that is inherently an assertion about position, so the node
records a note saying the pairing came from order, not from content.
"""

from __future__ import annotations

import re
from typing import Optional

from .base import (
    AnalysisContext,
    BaseSemanticAnalyzer,
    LayerObservation,
    register_analyzer,
)
from ..semantic.schema import SemanticLayer, SemanticLayerSet

_KEYED = re.compile(r"^\s*(?P<key>[A-Za-z0-9_#-]+)\s*(?:=|:|->)\s*(?P<text>.+?)\s*$")


def parse_captions(text: str) -> tuple[dict[str, str], list[str], list[str]]:
    """-> (keyed captions, positional captions, warnings)."""
    keyed: dict[str, str] = {}
    positional: list[str] = []
    warnings: list[str] = []

    for lineno, raw in enumerate((text or "").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = _KEYED.match(line)
        if m and not m.group("text").startswith("//"):
            key = m.group("key").strip()
            if key in keyed:
                warnings.append(f"line {lineno}: duplicate caption for {key!r}; later wins")
            keyed[key] = m.group("text").strip()
        else:
            positional.append(line)

    if keyed and positional:
        warnings.append(
            f"{len(positional)} unkeyed line(s) alongside keyed ones; unkeyed lines are "
            "matched positionally and may pair with the wrong layer"
        )
    return keyed, positional, warnings


@register_analyzer
class CaptionAnalyzer(BaseSemanticAnalyzer):
    name = "captions"
    description = (
        "Reads per-layer captions from the `captions` input (any captioner node, or "
        "typed by hand) and classifies them through the taxonomy. No model loaded."
    )
    requires_text = True

    def __init__(self) -> None:
        self._keyed: dict[str, str] = {}
        self._positional: list[str] = []
        self._used_positional = 0

    def prepare(self, layer_set: SemanticLayerSet, context: AnalysisContext) -> None:
        text = str(context.settings.get("captions", "") or "")
        self._keyed, self._positional, warnings = parse_captions(text)
        self._used_positional = 0
        for warning in warnings:
            context.note(warning)

        if not self._keyed and not self._positional:
            context.note(
                "captions analyzer: no caption text supplied — every layer will be "
                "UNRESOLVED. Wire a captioner into `captions`, or pick another analyzer."
            )
        elif self._positional and not self._keyed:
            context.note(
                f"captions analyzer: {len(self._positional)} unkeyed caption(s) matched by "
                "layer order. Use '<index> = text' or '<layer_id> = text' to pin them to "
                "content instead."
            )

        supplied = len(self._keyed) + len(self._positional)
        if supplied and supplied != len(layer_set):
            context.note(
                f"captions analyzer: {supplied} caption(s) for {len(layer_set)} layer(s) — "
                "layers without a caption stay UNRESOLVED"
            )

    def _lookup(self, layer: SemanticLayer) -> tuple[str, str]:
        """-> (caption, how it was matched)."""
        if layer.layer_id in self._keyed:
            return self._keyed[layer.layer_id], "layer_id"
        index_key = str(layer.source_index)
        if index_key in self._keyed:
            return self._keyed[index_key], "index"
        if self._used_positional < len(self._positional):
            caption = self._positional[self._used_positional]
            self._used_positional += 1
            return caption, "position"
        return "", ""

    def analyze(self, layer: SemanticLayer, context: AnalysisContext) -> LayerObservation:
        caption, how = self._lookup(layer)
        if not caption:
            return LayerObservation(
                description="",
                confidence=0.0,
                extra={"reason": "no caption supplied for this layer"},
            )

        # A human/VLM statement about a layer is taken at face value; how well that
        # statement maps onto a category is the taxonomy's call, not ours.
        confidence = float(context.settings.get("caption_confidence", 1.0))
        return LayerObservation(
            description=caption,
            confidence=max(0.0, min(1.0, confidence)),
            extra={"matched_by": how},
        )

    def run(self, layer_set, context, cache=None, use_cache=True):
        # Positional matching is stateful across the set, so caching individual layers
        # would hand back a caption meant for a different position. Content-keyed
        # captions are cheap to recompute anyway.
        return super().run(layer_set, context, cache=cache, use_cache=False)
