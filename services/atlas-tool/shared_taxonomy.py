"""The shared semantic taxonomy — one YAML in R2 that every render injects.

WHY THIS EXISTS
`SemanticLayerAnalyze` / `SemanticLayerRouter` grew a `taxonomy_yaml` input (the YAML
itself, not a path) because the production render target is a RunPod serverless worker
whose container is discarded after the job — no path typed into `taxonomy_path` can ever
resolve there. That made a custom taxonomy POSSIBLE in production; it did not make it
EDITABLE. The text had to be baked into each blueprint as a param default, so a one-word
vocabulary fix meant re-publishing every blueprint that used it.

This stores it ONCE, at a shared key beside the blueprints it pairs with, and the render
path injects it into any node that declares the input. Edit it anywhere, and every render
everywhere picks it up with no re-publish and nothing on any local disk.

WHY VALIDATION IS NOT OPTIONAL HERE
The node never fails a render over a bad taxonomy: it falls back to a built-in vocabulary
that is far smaller than the bundled one, notes that on its `report` output, and carries
on. From the images alone a silent fallback and a silent success are identical. So the
save path is the only place a typo can be caught while somebody is still looking at it —
`validate()` refuses a save that would not load.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Optional

import storage

# Beside `_shared/blueprints/` — the taxonomy pairs with the graphs, and blueprints are
# already global/cross-project, so scoping this per project would make one shared
# blueprint behave differently depending on which project ran it.
SHARED_TAXONOMY_KEY = "_shared/semantic/taxonomy.yaml"

# The node input this lands on. Anything in a graph that declares it gets the taxonomy.
TAXONOMY_INPUT = "taxonomy_yaml"

# UNRESOLVED is what the router assigns when nothing reaches the confidence threshold, so
# a taxonomy without it has no way to say "I do not know" and would have to guess.
REQUIRED_ROLE = "UNRESOLVED"


@dataclass
class Report:
    """The result of checking a taxonomy before it is stored.

    `ok` gates the save. `warnings` never do — they are things worth seeing that are not
    wrong (an empty keyword list is legal; it just means the CLIP analyzer has nothing to
    score that category against).
    """

    ok: bool = False
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    roles: list[str] = field(default_factory=list)
    categories: list[str] = field(default_factory=list)
    keyword_count: int = 0

    def summary(self) -> str:
        if not self.ok:
            return "; ".join(self.errors) or "invalid taxonomy"
        return (
            f"{len(self.roles)} roles, {len(self.categories)} categories, "
            f"{self.keyword_count} keywords"
        )


def validate(text: str) -> Report:
    """Parse and sanity-check a taxonomy. Never raises — every problem is an `errors`
    entry, because this runs behind a Save button and a traceback helps nobody there."""
    rep = Report()
    if not (text or "").strip():
        rep.errors.append("the taxonomy is empty")
        return rep

    try:
        # Declared in this service's requirements.txt. Imported here rather than at module
        # scope so a missing PyYAML degrades to "cannot check" on one Save instead of
        # taking the whole tool down at import.
        import yaml
    except ImportError:  # pragma: no cover - environment, not input
        rep.errors.append("PyYAML is unavailable, so the taxonomy cannot be checked")
        return rep

    try:
        data = yaml.safe_load(text)
    except Exception as exc:  # noqa: BLE001 — any parse error is a user-facing message
        rep.errors.append(f"not valid YAML: {exc}")
        return rep

    if not isinstance(data, dict):
        rep.errors.append(
            "the top level must be a mapping with `roles:` and `categories:` keys"
        )
        return rep

    roles = data.get("roles")
    if not isinstance(roles, list) or not roles:
        rep.errors.append("`roles:` must be a non-empty list")
    else:
        rep.roles = [str(r) for r in roles]
        if REQUIRED_ROLE not in rep.roles:
            rep.errors.append(f"`roles:` must include {REQUIRED_ROLE}")
        elif rep.roles[-1] != REQUIRED_ROLE:
            # The router's own loader documents this ordering; a taxonomy that breaks it
            # loads but resolves oddly, which is the worst kind of wrong.
            rep.errors.append(f"{REQUIRED_ROLE} must be LAST in `roles:`")

    categories = data.get("categories")
    if not isinstance(categories, dict) or not categories:
        rep.errors.append("`categories:` must be a non-empty mapping")
    else:
        rep.categories = [str(c) for c in categories]
        known = set(rep.roles)
        for name, spec in categories.items():
            if not isinstance(spec, dict):
                rep.errors.append(f"category `{name}` must be a mapping")
                continue
            role = str(spec.get("default_role", "")).strip()
            if not role:
                rep.errors.append(f"category `{name}` has no `default_role`")
            elif known and role not in known:
                rep.errors.append(
                    f"category `{name}` has default_role `{role}`, which is not in `roles:`"
                )

    rules = data.get("rules")
    if rules is None:
        rules = []
    if not isinstance(rules, list):
        rep.errors.append("`rules:` must be a list when present")
        rules = []

    cat_names = set(rep.categories)
    for i, rule in enumerate(rules):
        if not isinstance(rule, dict):
            rep.errors.append(f"rules[{i}] must be a mapping")
            continue
        cat = str(rule.get("category", "")).strip()
        if cat and cat_names and cat not in cat_names:
            rep.errors.append(
                f"rules[{i}] is for category `{cat}`, which `categories:` does not define"
            )
        kws = rule.get("keywords") or []
        if isinstance(kws, list):
            rep.keyword_count += len(kws)

    if not rep.errors and rep.keyword_count == 0:
        # Legal, and almost never intended: with the `clip` analyzer the keywords ARE the
        # candidate labels, so a taxonomy with none gives CLIP nothing to score against
        # and every layer lands in UNRESOLVED.
        rep.warnings.append(
            "no keywords anywhere — the clip analyzer scores layers against these, so "
            "every layer will fall to UNRESOLVED"
        )

    rep.ok = not rep.errors
    return rep


def load() -> tuple[Optional[str], Optional[str]]:
    """`(text, etag)` for the stored taxonomy, or `(None, None)` when none is stored.

    The etag is the read half of the compare-and-swap in `save()`; pass it straight back.
    A transport failure propagates (`storage.ObjectUnreadable`) rather than reading as
    absence, so "R2 hiccuped" can never be mistaken for "nobody has written one yet" and
    silently overwritten with a fresh file.
    """
    got = storage.get_with_etag(SHARED_TAXONOMY_KEY)
    if not got:
        return None, None
    body, etag = got
    return body.decode("utf-8"), etag


def save(text: str, if_match: Optional[str] = None) -> str:
    """Store the taxonomy, refusing anything `validate()` rejects. Returns the new etag.

    `if_match` is the etag from `load()`: the write lands only if nobody else has saved
    since you read, so two people editing cannot silently clobber each other. It raises
    `storage.Conflict` in that case — the caller is expected to say so and re-read rather
    than retry blindly. Omit it only for the very first write.
    """
    rep = validate(text)
    if not rep.ok:
        raise ValueError(rep.summary())
    body = text.encode("utf-8")
    kwargs: dict[str, Any] = {"content_type": "text/yaml; charset=utf-8"}
    if if_match:
        kwargs["if_match"] = if_match
    return storage.put(SHARED_TAXONOMY_KEY, body, **kwargs) or ""


def inject(
    graph: dict,
    text: str,
    declares_input: Optional[Callable[[str], Optional[bool]]] = None,
) -> list[str]:
    """Set `taxonomy_yaml` on every node in an API-format graph that can take one.

    Returns the node ids it touched, so the caller can report what happened instead of
    injecting invisibly.

    Three deliberate refusals:

    * A node whose `taxonomy_yaml` is ALREADY set (non-empty) is left alone. A blueprint
      that states its taxonomy outright means it; the stored one is a default, not an
      override.
    * A class `declares_input` says NO to is skipped. The backend may be running a pack
      older than the input, and the guard is what stops this from breaking those renders.
    * `declares_input` returning None means "could not ask" (ComfyUI unreachable, no
      contract). That is treated as YES for classes whose `inputs` already carry a
      taxonomy field, and NO otherwise — never a guess that invents an input on a node.
    """
    if not (text or "").strip() or not isinstance(graph, dict):
        return []

    touched: list[str] = []
    for node_id, node in graph.items():
        if not isinstance(node, dict):
            continue
        cls = str(node.get("class_type") or "").strip()
        if not cls:
            continue
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue

        current = inputs.get(TAXONOMY_INPUT)
        if isinstance(current, str) and current.strip():
            continue  # the blueprint said so explicitly
        if isinstance(current, list):
            continue  # wired from another node — a link is not ours to replace

        verdict = declares_input(cls) if declares_input else None
        if verdict is False:
            continue
        if verdict is None and TAXONOMY_INPUT not in inputs:
            # No contract to consult and the graph does not already name the field:
            # adding it would be inventing an input on a node that may not have one.
            continue

        inputs[TAXONOMY_INPUT] = text
        touched.append(str(node_id))

    return touched
