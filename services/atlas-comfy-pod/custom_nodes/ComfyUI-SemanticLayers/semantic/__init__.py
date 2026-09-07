"""The semantic core: schema, taxonomy, rules, scoring, overrides and routing.

Nothing in this package imports torch or ComfyUI. Everything that decides where a layer
goes is a pure function of metadata, which is what makes the routing guarantee testable.
"""

from .schema import (  # noqa: F401
    LAYER_METADATA,
    SEMANTIC_ASSETS,
    SEMANTIC_LAYERS,
    LayerMetadata,
    LayerMetadataSet,
    SemanticAsset,
    SemanticAssetSet,
    SemanticLayer,
    SemanticLayerSet,
    stable_layer_ids,
)
from .taxonomy import (  # noqa: F401
    ROUTER_OUTPUT_ROLES,
    Category,
    Role,
    Taxonomy,
    load_taxonomy,
)
from .routing import (  # noqa: F401
    MERGE_ORDERS,
    MODES,
    ReviewMode,
    RoutingPlan,
    Thresholds,
    resolve_subjects,
    route,
    summarise,
)
from .scoring import SubjectWeights  # noqa: F401
from .overrides import OverrideSet, parse_overrides  # noqa: F401
from .rules import apply_category, classify_text  # noqa: F401
