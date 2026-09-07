"""ComfyUI-SemanticLayers — semantic routing for image-layer decomposition output.

Turns the variable, unordered layer batch a decomposer emits (Qwen-Image-Layered today,
anything tomorrow) into a fixed set of semantic outputs — BACKGROUND, MAIN_CHARACTER,
SECONDARY_CHARACTERS, ASSETS, ENVIRONMENT, EFFECTS, OTHER — so downstream graphs never
need to know how many layers arrived or what order they came in.

See README.md for the pipeline, the taxonomy format and the Qwen wiring.
"""

import logging

logger = logging.getLogger(__name__)

try:
    from .nodes import (
        SemanticAssetSelector,
        SemanticCacheClear,
        SemanticLayerAnalyze,
        SemanticLayerDebug,
        SemanticLayerNormalize,
        SemanticLayerRouter,
        SemanticRoleSelect,
        SemanticSubjectResolver,
    )
except Exception:  # noqa: BLE001 - a broken import must not take ComfyUI down with it
    logger.exception("ComfyUI-SemanticLayers failed to load; its nodes will be unavailable")
    NODE_CLASS_MAPPINGS = {}
    NODE_DISPLAY_NAME_MAPPINGS = {}
else:
    NODE_CLASS_MAPPINGS = {
        "SemanticLayerNormalize": SemanticLayerNormalize,
        "SemanticLayerAnalyze": SemanticLayerAnalyze,
        "SemanticSubjectResolver": SemanticSubjectResolver,
        "SemanticLayerRouter": SemanticLayerRouter,
        "SemanticAssetSelector": SemanticAssetSelector,
        "SemanticRoleSelect": SemanticRoleSelect,
        "SemanticLayerDebug": SemanticLayerDebug,
        "SemanticCacheClear": SemanticCacheClear,
    }

    NODE_DISPLAY_NAME_MAPPINGS = {
        "SemanticLayerNormalize": "Semantic Layer Normalize",
        "SemanticLayerAnalyze": "Semantic Layer Analyze",
        "SemanticSubjectResolver": "Semantic Subject Resolver",
        "SemanticLayerRouter": "Semantic Layer Router",
        "SemanticAssetSelector": "Semantic Asset Selector",
        "SemanticRoleSelect": "Semantic Role Select",
        "SemanticLayerDebug": "Semantic Layer Debug",
        "SemanticCacheClear": "Semantic Cache Clear",
    }

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
