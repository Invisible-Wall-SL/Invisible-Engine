"""Taxonomy loading. The single source of truth for roles and categories.

Nodes import Role/Category from here and never spell a role string inline. The concrete
role list, category properties and keyword rules come from configs/default_taxonomy.yaml
so the taxonomy can be extended without editing Python.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Optional


class Role:
    """Stable internal role identifiers. These are the pipeline's public vocabulary."""

    BACKGROUND = "BACKGROUND"
    MAIN_CHARACTER = "MAIN_CHARACTER"
    SECONDARY_CHARACTER = "SECONDARY_CHARACTER"
    ASSET = "ASSET"
    ENVIRONMENT = "ENVIRONMENT"
    EFFECT = "EFFECT"
    OTHER = "OTHER"
    UNRESOLVED = "UNRESOLVED"


class Category:
    BACKGROUND = "background"
    CHARACTER = "character"
    ASSET = "asset"
    ENVIRONMENT = "environment"
    EFFECT = "effect"
    OTHER = "other"
    UNKNOWN = "unknown"


#: The router's fixed output order. Adding a role to the YAML does not change this —
#: unmapped roles surface on OTHER, which keeps the downstream interface stable.
ROUTER_OUTPUT_ROLES = (
    Role.BACKGROUND,
    Role.MAIN_CHARACTER,
    Role.SECONDARY_CHARACTER,
    Role.ASSET,
    Role.ENVIRONMENT,
    Role.EFFECT,
    Role.OTHER,
)

DEFAULT_TAXONOMY_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "configs",
    "default_taxonomy.yaml",
)


@dataclass
class CategorySpec:
    name: str
    default_role: str = Role.UNRESOLVED
    is_character: bool = False
    is_background: bool = False
    importance: float = 0.0


@dataclass
class Rule:
    category: str
    object_type: str = ""
    priority: int = 0
    keywords: tuple[str, ...] = ()


@dataclass
class Taxonomy:
    roles: tuple[str, ...]
    categories: dict[str, CategorySpec]
    rules: tuple[Rule, ...]
    source_path: str = ""
    version: int = 1

    def category(self, name: str) -> CategorySpec:
        return self.categories.get(name) or self.categories.get(Category.UNKNOWN) or CategorySpec(
            name=Category.UNKNOWN
        )

    def default_role(self, category: str) -> str:
        return self.category(category).default_role

    def importance(self, category: str) -> float:
        return self.category(category).importance

    def is_valid_role(self, role: str) -> bool:
        return role in self.roles


# --- built-in fallback -------------------------------------------------------------
# Used when PyYAML is missing or the config file cannot be read. It keeps the extension
# functional (with a clear note in the report) instead of failing the whole graph, but
# it is intentionally minimal — the YAML is the real taxonomy.
_FALLBACK: dict[str, Any] = {
    "version": 1,
    "roles": list(ROUTER_OUTPUT_ROLES) + [Role.UNRESOLVED],
    "categories": {
        "background": {"default_role": Role.BACKGROUND, "is_background": True, "importance": 0.10},
        "character": {
            "default_role": Role.SECONDARY_CHARACTER,
            "is_character": True,
            "importance": 1.00,
        },
        "asset": {"default_role": Role.ASSET, "importance": 0.50},
        "environment": {"default_role": Role.ENVIRONMENT, "importance": 0.30},
        "effect": {"default_role": Role.EFFECT, "importance": 0.35},
        "other": {"default_role": Role.OTHER, "importance": 0.20},
        "unknown": {"default_role": Role.UNRESOLVED, "importance": 0.0},
    },
    "rules": [
        {
            "category": "effect",
            "object_type": "particles",
            "priority": 90,
            "keywords": ["smoke", "fire", "spark", "particle", "glow", "mist", "fog", "dust"],
        },
        {
            "category": "character",
            "object_type": "person",
            "priority": 80,
            "keywords": ["person", "man", "woman", "boy", "girl", "child", "human", "figure"],
        },
        {
            "category": "character",
            "object_type": "creature",
            "priority": 78,
            "keywords": ["dog", "cat", "horse", "bird", "dragon", "monster", "creature", "animal"],
        },
        {
            "category": "asset",
            "object_type": "prop",
            "priority": 55,
            "keywords": ["chair", "table", "car", "sword", "box", "prop", "object", "item"],
        },
        {
            "category": "environment",
            "object_type": "terrain",
            "priority": 40,
            "keywords": ["ground", "floor", "grass", "tree", "rock", "mountain", "water", "road"],
        },
        {
            "category": "background",
            "object_type": "backdrop",
            "priority": 30,
            "keywords": ["background", "sky", "cloud", "horizon", "backdrop", "wall", "gradient"],
        },
    ],
}


def _build(data: dict[str, Any], source_path: str) -> Taxonomy:
    roles = tuple(str(r) for r in data.get("roles") or _FALLBACK["roles"])
    if Role.UNRESOLVED not in roles:
        roles = roles + (Role.UNRESOLVED,)

    categories: dict[str, CategorySpec] = {}
    for name, spec in (data.get("categories") or {}).items():
        spec = spec or {}
        categories[str(name)] = CategorySpec(
            name=str(name),
            default_role=str(spec.get("default_role", Role.UNRESOLVED)),
            is_character=bool(spec.get("is_character", False)),
            is_background=bool(spec.get("is_background", False)),
            importance=float(spec.get("importance", 0.0)),
        )
    if Category.UNKNOWN not in categories:
        categories[Category.UNKNOWN] = CategorySpec(
            name=Category.UNKNOWN, default_role=Role.UNRESOLVED
        )

    rules: list[Rule] = []
    for raw in data.get("rules") or []:
        keywords = tuple(
            str(k).strip().lower() for k in (raw.get("keywords") or []) if str(k).strip()
        )
        if not keywords:
            continue
        rules.append(
            Rule(
                category=str(raw.get("category", Category.UNKNOWN)),
                object_type=str(raw.get("object_type", "")),
                priority=int(raw.get("priority", 0)),
                keywords=keywords,
            )
        )
    # Highest priority first so the matcher can stop reasoning about order elsewhere.
    rules.sort(key=lambda r: -r.priority)

    return Taxonomy(
        roles=roles,
        categories=categories,
        rules=tuple(rules),
        source_path=source_path,
        version=int(data.get("version", 1)),
    )


_cache: dict[str, Taxonomy] = {}


def load_taxonomy(path: str = "") -> Taxonomy:
    """Load (and cache) a taxonomy. Falls back to the built-in one on any problem.

    Never raises: a broken taxonomy file degrades to the fallback with a note on the
    returned object, because failing a whole render over a YAML typo is worse than
    routing with a smaller keyword set and saying so.
    """
    key = path or DEFAULT_TAXONOMY_PATH
    if key in _cache:
        return _cache[key]

    data: Optional[dict[str, Any]] = None
    note = ""
    try:
        import yaml  # PyYAML ships with ComfyUI

        with open(key, "r", encoding="utf-8") as fh:
            loaded = yaml.safe_load(fh)
        if isinstance(loaded, dict):
            data = loaded
        else:
            note = f"taxonomy at {key} is not a mapping; using built-in fallback"
    except FileNotFoundError:
        note = f"taxonomy file not found at {key}; using built-in fallback"
    except ImportError:
        note = "PyYAML unavailable; using built-in fallback taxonomy"
    except Exception as exc:  # noqa: BLE001 - report, never crash the graph
        note = f"failed to read taxonomy at {key} ({exc}); using built-in fallback"

    taxonomy = _build(data if data is not None else _FALLBACK, "" if data is None else key)
    if note:
        taxonomy.source_path = taxonomy.source_path or "<built-in fallback>"
        taxonomy.categories.setdefault(Category.UNKNOWN, CategorySpec(name=Category.UNKNOWN))
        setattr(taxonomy, "load_note", note)
    _cache[key] = taxonomy
    return taxonomy


def clear_cache() -> None:
    _cache.clear()
