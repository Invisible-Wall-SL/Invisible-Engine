"""The pure routing brain: metadata in, role assignments out. No tensors, no ComfyUI.

Everything that decides WHERE a layer goes lives here, which is what makes the central
guarantee testable: `route()` is a function of layer CONTENT and metadata only, never of
position in the input list. Shuffle the layers and every assignment is identical.

Decision priority, highest first (matches the documented contract):
  1. explicit manual override
  2. deterministic semantic rules  (category -> default_role from the taxonomy)
  3. subject resolver              (which character is THE character)
  4. AI/VLM classification         (feeds 2 by producing the category + confidence)
  5. fallback to UNRESOLVED
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Sequence

from .overrides import OverrideSet, apply_overrides, unmatched_keys
from .schema import LayerMetadata, LayerMetadataSet
from .scoring import SubjectWeights, rank_subjects
from .taxonomy import ROUTER_OUTPUT_ROLES, Role, Taxonomy


class ReviewMode:
    AUTO = "AUTO"
    REVIEW = "REVIEW"
    MANUAL = "MANUAL"


MODES = (ReviewMode.AUTO, ReviewMode.REVIEW, ReviewMode.MANUAL)

#: Deterministic orderings for layers that share a role. "source" is the one option
#: that reintroduces a dependency on the incoming order — offered because a decomposer
#: with genuine depth order may want it, and clearly labelled as such.
MERGE_ORDERS = ("area_desc", "score_desc", "source")


@dataclass
class Thresholds:
    """Confidence gates. Below `uncertain` nothing is routed; between the two it is
    routed but flagged, so a caller can review instead of trusting silently."""

    auto: float = 0.85
    uncertain: float = 0.60

    def band(self, confidence: float) -> str:
        if confidence >= self.auto:
            return "auto"
        if confidence >= self.uncertain:
            return "uncertain"
        return "reject"


@dataclass
class RoutingPlan:
    """Role -> ordered layer ids, plus everything a human needs to audit the decision."""

    assignments: dict[str, list[str]] = field(default_factory=dict)
    metadata: LayerMetadataSet = field(default_factory=LayerMetadataSet)
    notes: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def ids_for(self, role: str) -> list[str]:
        return list(self.assignments.get(role, []))

    def counts(self) -> dict[str, int]:
        return {role: len(ids) for role, ids in self.assignments.items()}


def _order_key(meta: LayerMetadata, mode: str):
    if mode == "source":
        return (meta.source_layer, meta.layer_id)
    if mode == "score_desc":
        return (-meta.score, meta.layer_id)
    return (-meta.area_ratio, meta.layer_id)  # area_desc: biggest first == furthest back


def _decided_by(meta: LayerMetadata) -> str:
    return str(meta.extra.get("role_source", ""))


# --- step 3: subject resolution ----------------------------------------------------


def resolve_subjects(
    meta_set: LayerMetadataSet,
    weights: SubjectWeights,
    thresholds: Thresholds,
    min_character_confidence: float = 0.0,
    ambiguity_margin: float = 0.0,
) -> LayerMetadataSet:
    """Promote exactly one character to MAIN_CHARACTER; the rest become SECONDARY.

    With no characters in the set, nothing is promoted — MAIN_CHARACTER stays genuinely
    empty rather than being filled with the least-bad candidate.
    """
    out = meta_set.copy()
    floor = max(min_character_confidence, thresholds.uncertain)

    candidates = [
        m
        for m in out.items
        if m.is_character and not m.is_composite and _decided_by(m) != "override"
    ]
    eligible = [m for m in candidates if m.confidence >= floor]

    for m in candidates:
        if m not in eligible:
            m.note(
                f"subject: confidence {m.confidence:.2f} below floor {floor:.2f}; "
                "not eligible to be the main character"
            )

    if not eligible:
        out.metadata["main_character"] = None
        out.metadata["character_count"] = len(candidates)
        if candidates:
            out.metadata["subject_note"] = "characters found but none passed the confidence floor"
        else:
            out.metadata["subject_note"] = "no character layers detected"
        return out

    ranked = rank_subjects(eligible, weights, len(out.items))
    by_id = {m.layer_id: m for m in out.items}
    for entry in ranked:
        by_id[entry.layer_id].score = entry.score
        by_id[entry.layer_id].extra["subject_signals"] = {
            k: round(v, 4) for k, v in entry.signals.items()
        }

    winner = ranked[0]
    runner_up = ranked[1] if len(ranked) > 1 else None
    margin = winner.score - runner_up.score if runner_up else 1.0

    ambiguous = bool(runner_up) and ambiguity_margin > 0.0 and margin < ambiguity_margin

    for entry in ranked:
        meta = by_id[entry.layer_id]
        is_main = entry.layer_id == winner.layer_id
        meta.role = Role.MAIN_CHARACTER if is_main else Role.SECONDARY_CHARACTER
        meta.extra["role_source"] = "resolver"
        meta.note(
            f"subject: score {entry.score:.3f} -> {meta.role}"
            + (f" (margin {margin:.3f} over runner-up)" if is_main and runner_up else "")
        )
        if ambiguous:
            meta.uncertain = True
            meta.note(
                f"subject: AMBIGUOUS — margin {margin:.3f} < required {ambiguity_margin:.3f}"
            )

    out.metadata["main_character"] = winner.layer_id
    out.metadata["character_count"] = len(candidates)
    out.metadata["subject_margin"] = round(margin, 4)
    out.metadata["subject_ambiguous"] = ambiguous
    return out


# --- steps 1, 2, 5: role assignment ------------------------------------------------


def route(
    meta_set: LayerMetadataSet,
    taxonomy: Taxonomy,
    overrides: Optional[OverrideSet] = None,
    thresholds: Optional[Thresholds] = None,
    mode: str = ReviewMode.AUTO,
    merge_order: str = "area_desc",
) -> RoutingPlan:
    """Assign a role to every layer and group them. Pure function of the metadata."""
    thresholds = thresholds or Thresholds()
    out = meta_set.copy()
    notes: list[str] = []
    errors: list[str] = list(overrides.errors) if overrides else []

    if mode not in MODES:
        notes.append(f"unknown mode {mode!r}; falling back to {ReviewMode.AUTO}")
        mode = ReviewMode.AUTO

    # --- 2 + 5: taxonomy default role, gated by confidence -------------------------
    for meta in out.items:
        if meta.is_composite:
            meta.role = Role.OTHER
            meta.extra["role_source"] = "composite"
            meta.note("routing: flagged as the composite/flattened plane -> OTHER")
            continue

        if mode == ReviewMode.MANUAL:
            meta.role = Role.UNRESOLVED
            meta.extra["role_source"] = "manual-mode"
            meta.note("routing: MANUAL mode — only explicit overrides assign a role")
            continue

        band = thresholds.band(meta.confidence)
        if band == "reject":
            meta.role = Role.UNRESOLVED
            meta.uncertain = True
            meta.extra["role_source"] = "confidence"
            meta.note(
                f"routing: confidence {meta.confidence:.2f} < {thresholds.uncertain:.2f} "
                "-> UNRESOLVED (not forced into a category)"
            )
            continue

        if band == "uncertain":
            meta.uncertain = True
            meta.note(
                f"routing: confidence {meta.confidence:.2f} in review band "
                f"[{thresholds.uncertain:.2f}, {thresholds.auto:.2f}) — routed but flagged"
            )

        # The resolver already had the final word on characters.
        if _decided_by(meta) == "resolver":
            continue

        role = taxonomy.default_role(meta.semantic_category)
        meta.role = role
        meta.extra["role_source"] = "taxonomy"
        meta.note(f"routing: category '{meta.semantic_category}' -> {role}")

    # --- 1: overrides have the last word -------------------------------------------
    if overrides and len(overrides):
        for meta in out.items:
            hit = overrides.for_meta(meta)
            if hit is not None:
                meta.extra["role_source"] = "override"
        applied = apply_overrides(out.items, overrides)
        notes.append(f"{applied} layer(s) assigned by explicit override")
        errors.extend(unmatched_keys(out.items, overrides))

    if mode == ReviewMode.REVIEW:
        notes.append("REVIEW mode: routing applied; inspect confidence + notes before trusting it")

    # --- grouping -------------------------------------------------------------------
    if merge_order not in MERGE_ORDERS:
        notes.append(f"unknown merge_order {merge_order!r}; using area_desc")
        merge_order = "area_desc"
    if merge_order == "source":
        notes.append(
            "merge_order='source' uses the incoming layer order — the one setting that "
            "makes output depend on how the decomposer ordered its layers"
        )

    assignments: dict[str, list[str]] = {role: [] for role in ROUTER_OUTPUT_ROLES}
    assignments[Role.UNRESOLVED] = []
    for meta in sorted(out.items, key=lambda m: _order_key(m, merge_order)):
        role = meta.role if taxonomy.is_valid_role(meta.role) else Role.UNRESOLVED
        if role not in assignments:
            # A taxonomy-defined role with no dedicated output still has to go somewhere
            # predictable rather than vanishing.
            notes.append(f"role {role!r} has no dedicated output; routed to OTHER")
            role = Role.OTHER
        assignments[role].append(meta.layer_id)

    return RoutingPlan(assignments=assignments, metadata=out, notes=notes, errors=errors)


def summarise(plan: RoutingPlan, taxonomy: Taxonomy) -> str:
    """A compact, copy-pasteable audit of a routing decision."""
    lines = [f"layers: {len(plan.metadata)}   taxonomy: {taxonomy.source_path or 'built-in'}"]
    for role in list(ROUTER_OUTPUT_ROLES) + [Role.UNRESOLVED]:
        ids = plan.ids_for(role)
        if not ids:
            lines.append(f"  {role:<20} -")
            continue
        lookup = plan.metadata.by_id()
        parts = []
        for lid in ids:
            m = lookup[lid]
            flag = " ?" if m.uncertain else ""
            label = m.description or m.object_type or m.semantic_category
            parts.append(f"[{m.source_layer}]{label} {m.confidence:.0%}{flag}")
        lines.append(f"  {role:<20} {', '.join(parts)}")
    for note in plan.notes:
        lines.append(f"  note: {note}")
    for err in plan.errors:
        lines.append(f"  ERROR: {err}")
    return "\n".join(lines)
