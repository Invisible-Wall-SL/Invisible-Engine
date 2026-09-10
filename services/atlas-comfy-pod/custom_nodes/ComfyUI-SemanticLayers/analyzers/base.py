"""The analyzer interface and registry.

An analyzer answers exactly one question: **what is in this layer?** It returns a
description and, optionally, a confidence. It never returns a role, never ranks layers
against each other, and never sees the taxonomy's role table. That boundary is what lets
the Qwen decomposer — or the VLM — be swapped without touching the routing system.

Implement a new backend by subclassing BaseSemanticAnalyzer and calling
`register_analyzer`. It appears in the node's dropdown automatically.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional, Sequence

from ..semantic.schema import SemanticLayer, SemanticLayerSet
from ..utils.batching import chunks
from ..utils.cache import CACHE, ObservationCache


class AnalyzerUnavailable(RuntimeError):
    """Raised when a backend cannot run — missing weights, missing package, no GPU.

    Always carries an actionable message: the node surfaces it verbatim so the user
    reads "download X into Y", not "NoneType has no attribute".
    """


@dataclass
class LayerObservation:
    """What an analyzer saw. Purely descriptive."""

    description: str = ""
    object_type: str = ""
    confidence: float = 0.0
    analyzer: str = ""
    #: Set ONLY by a backend that classifies directly rather than describing — a
    #: zero-shot scorer picking from the taxonomy's own categories already knows the
    #: answer, and running its output back through keyword matching would both
    #: double-count the uncertainty and risk disagreeing with itself. A captioner leaves
    #: this empty and lets the rules decide.
    category: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def is_empty(self) -> bool:
        return not self.description.strip() and not self.object_type.strip()


@dataclass
class AnalysisContext:
    """Everything an analyzer may need that is not the layer itself."""

    layer_count: int = 0
    image_dimensions: tuple[int, int] = (0, 0)
    source: str = "unknown"
    settings: dict[str, Any] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def note(self, message: str) -> None:
        self.notes.append(message)


class BaseSemanticAnalyzer(ABC):
    """Base class for every semantic backend."""

    #: Registry key and the value shown in the node dropdown.
    name: str = "base"
    #: One-line description shown in the node tooltip.
    description: str = ""
    #: True when the backend needs the `captions` text input to do anything.
    requires_text: bool = False
    #: Max layers per forward pass; 1 means "no batching".
    batch_size: int = 1

    def prepare(self, layer_set: SemanticLayerSet, context: AnalysisContext) -> None:
        """Hook for loading weights / parsing inputs once per run. May raise
        AnalyzerUnavailable."""

    @abstractmethod
    def analyze(self, layer: SemanticLayer, context: AnalysisContext) -> LayerObservation:
        """Describe one layer."""

    def analyze_many(
        self, layers: Sequence[SemanticLayer], context: AnalysisContext
    ) -> list[LayerObservation]:
        """Describe a chunk. Override for a backend that can do a real batched pass."""
        return [self.analyze(layer, context) for layer in layers]

    def run(
        self,
        layer_set: SemanticLayerSet,
        context: AnalysisContext,
        cache: Optional[ObservationCache] = None,
        use_cache: bool = True,
    ) -> list[LayerObservation]:
        """Analyze a whole set, with caching and batching applied around `analyze_many`."""
        self.prepare(layer_set, context)
        cache = cache or CACHE
        settings = dict(context.settings)

        results: dict[str, LayerObservation] = {}
        pending: list[SemanticLayer] = []

        for layer in layer_set.layers:
            if use_cache:
                hit = cache.get(ObservationCache.key(self.name, layer.layer_id, settings))
                if hit is not None:
                    results[layer.layer_id] = hit
                    continue
            pending.append(layer)

        for chunk in chunks(pending, self.batch_size):
            observations = self.analyze_many(chunk, context)
            if len(observations) != len(chunk):
                raise RuntimeError(
                    f"analyzer '{self.name}' returned {len(observations)} observations "
                    f"for {len(chunk)} layers"
                )
            for layer, obs in zip(chunk, observations):
                obs.analyzer = obs.analyzer or self.name
                results[layer.layer_id] = obs
                if use_cache:
                    cache.put(ObservationCache.key(self.name, layer.layer_id, settings), obs)

        return [results[layer.layer_id] for layer in layer_set.layers]

    def close(self) -> None:
        """Release weights. Called when a node wants VRAM back."""


# --- registry ----------------------------------------------------------------------

_REGISTRY: dict[str, type[BaseSemanticAnalyzer]] = {}


def register_analyzer(cls: type[BaseSemanticAnalyzer]) -> type[BaseSemanticAnalyzer]:
    _REGISTRY[cls.name] = cls
    return cls


def available_analyzers() -> list[str]:
    """Registry keys in a stable order, so the node dropdown never reshuffles."""
    return sorted(_REGISTRY.keys())


def get_analyzer(name: str, **kwargs: Any) -> BaseSemanticAnalyzer:
    cls = _REGISTRY.get(name)
    if cls is None:
        known = ", ".join(available_analyzers()) or "<none registered>"
        raise AnalyzerUnavailable(f"unknown analyzer {name!r}. Available: {known}")
    return cls(**kwargs)
