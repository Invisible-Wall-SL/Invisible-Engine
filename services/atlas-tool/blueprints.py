"""Blueprint loader for the Invisible Atlas Maker pipeline.

A *blueprint* is a shareable, data-driven ComfyUI pipeline: a graph in
ComfyUI **API/prompt** format plus a small binding descriptor that maps
semantic roles (positive prompt, seed, refs, output node, …) onto that
graph's own node IDs. It lets a single GENERIC runner drive any graph,
replacing the per-pipeline hardcoded Python builders in `batch_atlas.py`.

This module is the read side (the backbone): it lists/loads blueprints from a
global, cross-project R2 prefix (`_shared/blueprints/`, mirroring the existing
`_shared/spines/` sharing precedent) hydrated into a local staging tree, and
validates each `blueprint.json`. There is deliberately NO publish/upload path
here yet (that's a later phase); read-only is enough for built-in pipelines.

Storage layout (R2 + staging mirror it 1:1):

    _shared/blueprints/<id>/blueprint.json   # manifest: meta + bindings + base
    _shared/blueprints/<id>/workflow.json    # ComfyUI API/prompt graph
    _shared/blueprints/<id>/thumb.png        # optional preview (unused by runner)

`<id>` is an `r2_slug` (lowercase, non-alphanumerics -> `_`), the same slug rule
used for client/project keys.

No secrets here: R2 creds come from env via `storage` / `iw_common.storage`.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path

import storage
from cloud_paths import STAGING_BASE
from iw_common.context import r2_slug

# Global, cross-project prefix — NOT under any <client>/<project>. Every authed
# user reads the same library (same model as `_shared/spines/`). The staging
# mirror lives outside the per-(client,project) trees so it's shared too.
SHARED_BLUEPRINTS_PREFIX = "_shared/blueprints"
BLUEPRINTS_STAGING = STAGING_BASE / "_shared" / "blueprints"

# Roles a blueprint MUST map for the generic runner to drive its graph. `output`
# is required (where the bytes come from); `positive`/`seed` are required so the
# prompt + per-render cache-busting seed always have a home. The ref roles
# (`style_ref`/`shape_ref`) and size roles are OPTIONAL — a graph may bake its
# own size or take no style reference (the runner skips an absent role).
REQUIRED_ROLES = ("positive", "seed", "output")
OPTIONAL_ROLES = ("negative", "width", "height", "style_ref", "shape_ref")
KNOWN_ROLES = REQUIRED_ROLES + OPTIONAL_ROLES

# Hydrate the shared tree once per process (cheap, incremental pull thereafter).
_HYDRATED = False
_HYDRATE_LOCK = threading.Lock()


def hydrate(force: bool = False) -> None:
    """Pull `_shared/blueprints/` from R2 into staging once per process.

    Incremental (`pull_prefix` skips files already on disk by size), so repeat
    calls are near-free no-ops. Best-effort: a first run / empty bucket / R2
    error leaves staging as-is rather than raising into a request. `force`
    re-pulls (used by an explicit refresh) — there's no per-request force."""
    global _HYDRATED
    with _HYDRATE_LOCK:
        if _HYDRATED and not force:
            return
        _HYDRATED = True
    try:
        BLUEPRINTS_STAGING.mkdir(parents=True, exist_ok=True)
        storage.pull_prefix(
            SHARED_BLUEPRINTS_PREFIX + "/",
            BLUEPRINTS_STAGING,
            SHARED_BLUEPRINTS_PREFIX + "/",
        )
    except Exception:  # noqa: BLE001 — first run / empty bucket / transient
        with _HYDRATE_LOCK:
            _HYDRATED = False


def _validate_manifest(bp_id: str, manifest: dict) -> dict:
    """Validate + normalize a parsed blueprint.json. Raises ValueError on a
    structural problem (missing roles, malformed binding) so the loader can
    skip a bad blueprint with a readable message rather than failing a run
    deep inside the runner."""
    if not isinstance(manifest, dict):
        raise ValueError(f"blueprint '{bp_id}': blueprint.json is not an object")
    bindings = manifest.get("bindings")
    if not isinstance(bindings, dict):
        raise ValueError(f"blueprint '{bp_id}': missing 'bindings' object")
    for role in REQUIRED_ROLES:
        b = bindings.get(role)
        if not isinstance(b, dict) or not str(b.get("node", "")).strip():
            raise ValueError(
                f"blueprint '{bp_id}': required role '{role}' is unmapped "
                f"(need bindings.{role}.node)")
    # `output` carries no field (it's a whole-node lookup); every other mapped
    # role needs a `field` to inject into.
    for role, b in bindings.items():
        if role == "output" or not isinstance(b, dict):
            continue
        if not str(b.get("field", "")).strip():
            raise ValueError(
                f"blueprint '{bp_id}': role '{role}' has no 'field'")
    return manifest


def validate_against_graph(bp_id: str, manifest: dict, graph: dict) -> dict:
    """Full validation for an UPLOAD: structural manifest checks (reusing
    `_validate_manifest`) PLUS that every mapped binding points at a node which
    actually exists in `graph` (the API/prompt node dict). Raises ValueError
    with a readable message on any problem so the upload handler can return it
    verbatim (never a 500)."""
    if not isinstance(graph, dict) or not graph:
        raise ValueError(
            f"blueprint '{bp_id}': workflow.json is not a non-empty API-format "
            "node dict (expected {{'<nodeId>': {{'class_type': ..., 'inputs': "
            "...}}, ...}})")
    for node_id, node in graph.items():
        if not isinstance(node, dict) or "class_type" not in node:
            raise ValueError(
                f"blueprint '{bp_id}': node '{node_id}' is not an API-format "
                "node (missing 'class_type') — export the workflow in API "
                "format, not the editor format")
    _validate_manifest(bp_id, manifest)
    bindings = manifest["bindings"]
    for role, b in bindings.items():
        if not isinstance(b, dict):
            continue
        node_id = str(b.get("node", "")).strip()
        if node_id and node_id not in graph:
            raise ValueError(
                f"blueprint '{bp_id}': role '{role}' is bound to node "
                f"'{node_id}', which is not in the workflow graph")
    return manifest


def _read_blueprint_dir(d: Path) -> dict | None:
    """Load one blueprint directory -> {id, graph, bindings, meta} or None if it
    isn't a usable blueprint (missing/unreadable files, invalid manifest)."""
    bp_id = d.name
    man_path = d / "blueprint.json"
    wf_path = d / "workflow.json"
    if not man_path.is_file() or not wf_path.is_file():
        return None
    try:
        manifest = json.loads(man_path.read_text(encoding="utf-8"))
        graph = json.loads(wf_path.read_text(encoding="utf-8"))
    except (ValueError, OSError) as e:
        print(f"[blueprints] skipped '{bp_id}': {e}", flush=True)
        return None
    try:
        _validate_manifest(bp_id, manifest)
    except ValueError as e:
        print(f"[blueprints] invalid '{bp_id}': {e}", flush=True)
        return None
    if not isinstance(graph, dict):
        print(f"[blueprints] skipped '{bp_id}': workflow.json is not a node dict",
              flush=True)
        return None
    bindings = manifest["bindings"]
    meta = {k: v for k, v in manifest.items() if k != "bindings"}
    meta.setdefault("id", bp_id)
    return {"id": bp_id, "graph": graph, "bindings": bindings, "meta": meta}


def list_blueprints() -> list[dict]:
    """All readable blueprints in the shared library -> list of meta dicts
    ({id, name, description, base, …}), sorted by id. Hydrates first."""
    hydrate()
    out: list[dict] = []
    if not BLUEPRINTS_STAGING.is_dir():
        return out
    for d in sorted(p for p in BLUEPRINTS_STAGING.iterdir() if p.is_dir()):
        bp = _read_blueprint_dir(d)
        if bp:
            out.append(bp["meta"])
    return out


def get_blueprint(blueprint_id: str) -> dict | None:
    """Load one blueprint by id -> {id, graph, bindings, meta} or None if it
    doesn't exist / isn't valid. `blueprint_id` is slugged so a launcher key
    and an on-disk dir name resolve identically."""
    if not blueprint_id:
        return None
    hydrate()
    bp_id = r2_slug(blueprint_id)
    d = BLUEPRINTS_STAGING / bp_id
    if not d.is_dir():
        return None
    return _read_blueprint_dir(d)
