"""Deterministic manual overrides — the highest-priority signal in the pipeline.

Text format, one assignment per line. Blank lines and `#` comments are ignored:

    4 = main_character        # by original layer index
    2: background             # ':' works too
    a1b2c3d4e5 -> effect      # by stable layer id

Anything that does not parse is reported back to the user rather than silently dropped;
a typo in an override must never look like "the model decided that".
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional, Sequence

from .schema import LayerMetadata
from .taxonomy import Taxonomy

_LINE = re.compile(r"^\s*(?P<key>[^=:\->#]+?)\s*(?:=|:|->)\s*(?P<role>[A-Za-z_ ]+)\s*$")


@dataclass
class Override:
    key: str  # layer id, or the string form of a source index
    role: str
    by_index: bool
    line: int


@dataclass
class OverrideSet:
    items: list[Override] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.items)

    def for_meta(self, meta: LayerMetadata) -> Optional[Override]:
        """Last matching rule wins, so a later line can correct an earlier one."""
        found: Optional[Override] = None
        for item in self.items:
            if item.by_index:
                if str(meta.source_layer) == item.key:
                    found = item
            elif meta.layer_id == item.key:
                found = item
        return found


def parse_overrides(text: str, taxonomy: Taxonomy) -> OverrideSet:
    out = OverrideSet()
    if not text or not text.strip():
        return out

    for lineno, raw in enumerate(text.splitlines(), start=1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        m = _LINE.match(line)
        if not m:
            out.errors.append(f"line {lineno}: cannot parse {raw.strip()!r} (expected 'layer = ROLE')")
            continue

        key = m.group("key").strip()
        role = m.group("role").strip().upper().replace(" ", "_")
        if not taxonomy.is_valid_role(role):
            valid = ", ".join(taxonomy.roles)
            out.errors.append(f"line {lineno}: unknown role {role!r} (valid: {valid})")
            continue
        out.items.append(
            Override(key=key, role=role, by_index=key.isdigit(), line=lineno)
        )
    return out


def apply_overrides(metas: Sequence[LayerMetadata], overrides: OverrideSet) -> int:
    """Stamp overridden roles onto metadata. Returns how many layers were overridden."""
    applied = 0
    for meta in metas:
        hit = overrides.for_meta(meta)
        if hit is None:
            continue
        meta.role = hit.role
        meta.uncertain = False
        meta.extra["overridden"] = True
        meta.note(f"override (line {hit.line}): {hit.key} -> {hit.role}")
        applied += 1
    return applied


def unmatched_keys(metas: Sequence[LayerMetadata], overrides: OverrideSet) -> list[str]:
    """Override keys that matched no layer — almost always a typo worth surfacing."""
    ids = {m.layer_id for m in metas}
    indices = {str(m.source_layer) for m in metas}
    missing = []
    for item in overrides.items:
        if item.by_index and item.key not in indices:
            missing.append(f"line {item.line}: no layer with index {item.key}")
        elif not item.by_index and item.key not in ids:
            missing.append(f"line {item.line}: no layer with id {item.key!r}")
    return missing
