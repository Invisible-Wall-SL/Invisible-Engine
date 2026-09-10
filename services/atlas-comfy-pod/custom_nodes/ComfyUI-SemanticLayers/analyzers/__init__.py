"""Analyzer backends. Importing this package registers every built-in analyzer.

Optional backends must never break the import: a missing package is a reason for ONE
dropdown entry to be absent, not for the whole extension to fail to load.
"""

from .base import (  # noqa: F401
    AnalysisContext,
    AnalyzerUnavailable,
    BaseSemanticAnalyzer,
    LayerObservation,
    available_analyzers,
    get_analyzer,
    register_analyzer,
)

# Always available — no weights, no third-party packages.
from . import geometry  # noqa: F401
from . import captions  # noqa: F401
from . import stub  # noqa: F401

# Optional backends. Each registers its dropdown entry even when weights are missing;
# the failure then happens at run time with an actionable message. A backend whose
# IMPORT fails must cost only its own entry, never the extension.
try:
    from . import clip  # noqa: F401
except Exception as _exc:  # noqa: BLE001
    import logging

    logging.getLogger(__name__).info(
        "ComfyUI-SemanticLayers: clip analyzer unavailable (%s)", _exc
    )

try:
    from . import florence2  # noqa: F401
except Exception as _exc:  # noqa: BLE001
    import logging

    logging.getLogger(__name__).info(
        "ComfyUI-SemanticLayers: florence2 analyzer unavailable (%s)", _exc
    )

__all__ = [
    "AnalysisContext",
    "AnalyzerUnavailable",
    "BaseSemanticAnalyzer",
    "LayerObservation",
    "available_analyzers",
    "get_analyzer",
    "register_analyzer",
]
