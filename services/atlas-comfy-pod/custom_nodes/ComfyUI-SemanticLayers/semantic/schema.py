"""Internal data model for ComfyUI-SemanticLayers.

Deliberately torch-free: nothing in this module imports torch, so the whole semantic
layer (classification, scoring, resolution, routing) is unit-testable without a GPU,
without ComfyUI, and without any model weights. Tensors live on SemanticLayer.image /
.mask / .alpha as opaque objects; only utils/ and nodes/ ever look inside them.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any, Iterable, Iterator, Optional

# --- custom ComfyUI socket type names ---------------------------------------------
# These strings ARE the wire types on the graph. ComfyUI treats any unknown uppercase
# string as an opaque custom type and only connects sockets whose names match, which is
# exactly the guarantee we want: a SEMANTIC_LAYERS output cannot be wired into an IMAGE.
SEMANTIC_LAYERS = "SEMANTIC_LAYERS"
LAYER_METADATA = "LAYER_METADATA"
SEMANTIC_ASSETS = "SEMANTIC_ASSETS"


@dataclass
class LayerMetadata:
    """Everything known about one layer, and where each fact came from.

    Split into three bands on purpose:
      * observation  — what an analyzer measured or read (description, object_type, bbox…)
      * judgement    — what the taxonomy concluded (semantic_category, is_character…)
      * assignment   — what the pipeline decided (role, score, uncertain)

    Nothing here is ever invented: a field left at its default means "not determined",
    which is a different statement from a confident negative.
    """

    layer_id: str
    source_layer: int = 0

    # observation
    description: str = ""
    object_type: str = ""
    bbox: Optional[tuple[int, int, int, int]] = None  # x0, y0, x1, y1 in pixels
    area_ratio: float = 0.0  # opaque pixels / total pixels, 0..1
    centroid: Optional[tuple[float, float]] = None  # normalised 0..1, (x, y)
    prominence: float = 0.0  # normalised bbox diagonal, 0..1

    # judgement
    semantic_category: str = "unknown"
    is_character: bool = False
    is_background: bool = False
    importance: float = 0.0
    confidence: float = 0.0

    # assignment
    role: str = "UNRESOLVED"
    score: float = 0.0
    uncertain: bool = False

    # provenance / diagnostics
    analyzer: str = ""
    alpha_source: str = "none"
    is_composite: bool = False
    notes: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)

    def note(self, message: str) -> None:
        """Append a human-readable trace line. The debug node prints these."""
        self.notes.append(message)

    def copy(self, **changes: Any) -> "LayerMetadata":
        out = replace(self)
        out.notes = list(self.notes)
        out.extra = dict(self.extra)
        for key, value in changes.items():
            setattr(out, key, value)
        return out

    def to_dict(self) -> dict[str, Any]:
        return {
            "layer_id": self.layer_id,
            "source_layer": self.source_layer,
            "description": self.description,
            "object_type": self.object_type,
            "semantic_category": self.semantic_category,
            "role": self.role,
            "confidence": round(self.confidence, 4),
            "importance": round(self.importance, 4),
            "score": round(self.score, 4),
            "is_character": self.is_character,
            "is_background": self.is_background,
            "uncertain": self.uncertain,
            "is_composite": self.is_composite,
            "bbox": list(self.bbox) if self.bbox else None,
            "area_ratio": round(self.area_ratio, 4),
            "centroid": [round(c, 4) for c in self.centroid] if self.centroid else None,
            "prominence": round(self.prominence, 4),
            "analyzer": self.analyzer,
            "alpha_source": self.alpha_source,
            "notes": list(self.notes),
            "extra": dict(self.extra),
        }


@dataclass
class LayerMetadataSet:
    """The LAYER_METADATA socket payload — metadata for a whole layer set."""

    items: list[LayerMetadata] = field(default_factory=list)
    source: str = "unknown"
    image_dimensions: tuple[int, int] = (0, 0)  # (width, height)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __len__(self) -> int:
        return len(self.items)

    def __iter__(self) -> Iterator[LayerMetadata]:
        return iter(self.items)

    def by_id(self) -> dict[str, LayerMetadata]:
        return {m.layer_id: m for m in self.items}

    def get(self, layer_id: str) -> Optional[LayerMetadata]:
        for m in self.items:
            if m.layer_id == layer_id:
                return m
        return None

    def copy(self) -> "LayerMetadataSet":
        return LayerMetadataSet(
            items=[m.copy() for m in self.items],
            source=self.source,
            image_dimensions=self.image_dimensions,
            metadata=dict(self.metadata),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "image_dimensions": list(self.image_dimensions),
            "layer_count": len(self.items),
            "layers": [m.to_dict() for m in self.items],
            "metadata": dict(self.metadata),
        }


@dataclass
class SemanticLayer:
    """One layer: pixels, optional coverage, and its metadata.

    `image` is a [1, H, W, C] ComfyUI IMAGE tensor. `mask` and `alpha` are [1, H, W]
    when present and None when genuinely unknown — an all-ones mask would be a claim
    that the layer is fully opaque, which we must not make on the layer's behalf.
    """

    layer_id: str
    image: Any
    mask: Any = None
    alpha: Any = None
    source_index: int = 0
    metadata: LayerMetadata = field(default_factory=lambda: LayerMetadata(layer_id=""))

    def __post_init__(self) -> None:
        if not self.metadata.layer_id:
            self.metadata.layer_id = self.layer_id
            self.metadata.source_layer = self.source_index


@dataclass
class SemanticLayerSet:
    """The SEMANTIC_LAYERS socket payload. Holds an arbitrary number of layers."""

    layers: list[SemanticLayer] = field(default_factory=list)
    source: str = "unknown"
    image_dimensions: tuple[int, int] = (0, 0)  # (width, height)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __len__(self) -> int:
        return len(self.layers)

    def __iter__(self) -> Iterator[SemanticLayer]:
        return iter(self.layers)

    def by_id(self) -> dict[str, SemanticLayer]:
        return {layer.layer_id: layer for layer in self.layers}

    def metadata_set(self) -> LayerMetadataSet:
        return LayerMetadataSet(
            items=[layer.metadata.copy() for layer in self.layers],
            source=self.source,
            image_dimensions=self.image_dimensions,
            metadata=dict(self.metadata),
        )

    def with_metadata(self, meta: LayerMetadataSet) -> "SemanticLayerSet":
        """Return a set whose layers carry `meta`, matched by layer_id (never by index)."""
        lookup = meta.by_id()
        layers = [
            SemanticLayer(
                layer_id=layer.layer_id,
                image=layer.image,
                mask=layer.mask,
                alpha=layer.alpha,
                source_index=layer.source_index,
                metadata=lookup.get(layer.layer_id, layer.metadata).copy(),
            )
            for layer in self.layers
        ]
        return SemanticLayerSet(
            layers=layers,
            source=self.source,
            image_dimensions=self.image_dimensions,
            metadata={**self.metadata, **meta.metadata},
        )


@dataclass
class SemanticAsset:
    """One entry in a SEMANTIC_ASSETS collection."""

    asset_id: str
    label: str
    category: str
    image: Any
    mask: Any = None
    alpha: Any = None
    metadata: Optional[LayerMetadata] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "asset_id": self.asset_id,
            "label": self.label,
            "category": self.category,
            "object_type": self.metadata.object_type if self.metadata else "",
            "confidence": round(self.metadata.confidence, 4) if self.metadata else 0.0,
            "layer_id": self.metadata.layer_id if self.metadata else "",
        }


@dataclass
class SemanticAssetSet:
    """The SEMANTIC_ASSETS socket payload — an inspectable, filterable collection."""

    assets: list[SemanticAsset] = field(default_factory=list)
    source: str = "unknown"
    image_dimensions: tuple[int, int] = (0, 0)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __len__(self) -> int:
        return len(self.assets)

    def __iter__(self) -> Iterator[SemanticAsset]:
        return iter(self.assets)

    def filtered(
        self,
        object_type: str = "",
        label_contains: str = "",
        category: str = "",
    ) -> "SemanticAssetSet":
        def keep(a: SemanticAsset) -> bool:
            if category and a.category != category:
                return False
            if object_type:
                got = a.metadata.object_type if a.metadata else ""
                if got != object_type:
                    return False
            if label_contains and label_contains.lower() not in a.label.lower():
                return False
            return True

        return SemanticAssetSet(
            assets=[a for a in self.assets if keep(a)],
            source=self.source,
            image_dimensions=self.image_dimensions,
            metadata=dict(self.metadata),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "count": len(self.assets),
            "assets": [a.to_dict() for a in self.assets],
        }


def stable_layer_ids(fingerprints: Iterable[str]) -> list[str]:
    """Turn per-layer content fingerprints into unique, order-independent ids.

    Two layer sets holding the same images in a different order get the same ids, which
    is what makes routing order-independent. Identical duplicates are disambiguated with
    a deterministic suffix — layers that are byte-identical are interchangeable anyway.
    """
    seen: dict[str, int] = {}
    out: list[str] = []
    for fp in fingerprints:
        n = seen.get(fp, 0)
        seen[fp] = n + 1
        out.append(fp if n == 0 else f"{fp}#{n + 1}")
    return out
