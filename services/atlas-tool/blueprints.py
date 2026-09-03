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
import shutil
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

# Exposed-parameter ("general settings") types a blueprint author may declare.
# A param carries a baked DEFAULT (the "general setting") and renders as an
# editable control in the Atlas Maker Settings panel; the generic runner sets
# its effective value (per-manifest override, else default) onto the bound
# node input. `select`/`text`/`bool` are strings/booleans; `int`/`float` are
# numeric (with optional min/max/step bounds).
PARAM_TYPES = ("int", "float", "text", "bool", "select")

# WHICH TOOL a blueprint belongs to. `image` blueprints drive the Atlas Maker's
# region generation; `video` blueprints drive the Flipbook's video mode. They are
# NOT interchangeable — a video graph pushed through the still-image runner
# produces nothing useful, and an image graph offered in the video mode is just a
# trap — so each tool lists only its own kind.
#
# Declared, never inferred. "does the graph end in an animated save node?" would
# be a guess that silently mis-files a blueprint the moment someone uses a save
# node we did not anticipate.
#
# ABSENT = "image", so every blueprint authored before this keeps working and
# keeps showing up exactly where it did.
BLUEPRINT_KINDS = ("image", "video")
DEFAULT_BLUEPRINT_KIND = "image"

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
        # After the pull, so the comparison is against what the library really
        # holds rather than a stale local mirror.
        _sync_bundled()
    except Exception as e:  # noqa: BLE001 — first run / empty bucket / transient
        # Say it out loud. This used to be wholly silent, which meant a service
        # that could not reach R2 served stale staging copies forever with no
        # signal at all — see `library_status`.
        print(f"[blueprints] hydrate FAILED ({type(e).__name__}): {e}", flush=True)
        with _HYDRATE_LOCK:
            _HYDRATED = False


# The blueprints baked into THIS image (`COPY services/atlas-tool/ .`), which is
# also where `seed_blueprints.py` reads from.
BUNDLED_SRC = Path(__file__).resolve().parent / "blueprints_src"


BUNDLED_AUTHOR = "iw-builtin"


def _sync_bundled() -> None:
    """Keep the shared library's copy of each BUNDLED blueprint in step with this
    image, without ever clobbering one a human has taken over.

    The first version of this only published what was MISSING, which protected
    edits but froze every bundled blueprint at whatever was seeded first: adding
    a param to `blueprints_src/` in the repo then had no effect on the live
    library at all, and the tool went on serving the older definition with no
    sign anything was stale. That is what "I am still missing some options"
    turned out to be.

    The distinction that makes an update safe is already in the data. A bundled
    blueprint carries `author: iw-builtin`; `_uploadblueprint` stamps the real
    username on anything published through the tool. So:

      * absent            -> publish it
      * present, still ours (author unchanged) and BYTES DIFFER -> update it
      * present, someone else's author -> leave it completely alone
      * present and identical -> no write at all (so this is a cheap no-op)
    """
    if not BUNDLED_SRC.is_dir():
        return
    for d in sorted(x for x in BUNDLED_SRC.iterdir() if x.is_dir()):
        man, wf = d / "blueprint.json", d / "workflow.json"
        if not man.is_file() or not wf.is_file():
            continue
        key = f"{SHARED_BLUEPRINTS_PREFIX}/{d.name}/blueprint.json"
        try:
            stored = storage.get(key)
        except Exception as e:  # noqa: BLE001 — can't ask R2 ⇒ don't guess
            print(f"[blueprints] bundled-sync check failed for '{d.name}': {e}",
                  flush=True)
            return
        action = "seeded"
        if stored is not None:
            if stored == man.read_bytes():
                continue  # identical: nothing to do, and no pointless write
            try:
                owner = str((json.loads(stored) or {}).get("author") or "")
            except ValueError:
                # A copy we cannot parse is already broken — the tool skips it at
                # load — so restoring the bundled definition strictly helps.
                owner = BUNDLED_AUTHOR
            if owner != BUNDLED_AUTHOR:
                print(f"[blueprints] '{d.name}' was re-published by '{owner}' — "
                      "leaving it alone", flush=True)
                continue
            action = "updated"
        try:
            for name in ("blueprint.json", "workflow.json", "thumb.png"):
                f = d / name
                if not f.is_file():
                    continue
                blob = f.read_bytes()
                storage.put(f"{SHARED_BLUEPRINTS_PREFIX}/{d.name}/{name}", blob)
                # Mirror into staging too, so it is live on THIS boot rather than
                # only after the next restart's pull.
                dest = BLUEPRINTS_STAGING / d.name
                dest.mkdir(parents=True, exist_ok=True)
                (dest / name).write_bytes(blob)
            print(f"[blueprints] {action} bundled blueprint '{d.name}'", flush=True)
        except Exception as e:  # noqa: BLE001 — one bad blueprint, keep going
            print(f"[blueprints] could not sync bundled '{d.name}': {e}", flush=True)


def library_status() -> dict:
    """What the blueprint library ACTUALLY contains, and whether R2 was reachable.

    This exists because the failure it diagnoses is invisible by construction:
    `storage.pull_prefix` "never raises" (it returns 0 on error) and `hydrate`
    swallows what is left, so a service that cannot reach R2 keeps serving
    whatever stale copies are on its persistent volume — old blueprints present,
    a newly-seeded one absent, and not one line of error anywhere. Diagnosing
    that from the outside is impossible; this reports the three facts that
    separate every cause:

      * `in_r2`   — what the bucket holds RIGHT NOW (the seed's side of it)
      * `on_disk` — what the staging mirror holds (the hydrate's side)
      * `loaded`  — what actually parsed + validated, with each one's kind

    A blueprint in `in_r2` but not `on_disk` means the service has not hydrated
    since it was seeded (restart it). In `on_disk` but not `loaded` means it was
    REJECTED — `skipped` says why. In neither means the seed never landed.
    """
    hydrate()
    out: dict = {"in_r2": [], "on_disk": [], "loaded": [], "skipped": [],
                 "r2_error": "", "prefix": SHARED_BLUEPRINTS_PREFIX}
    try:
        ids = set()
        for obj in storage.list_keys(SHARED_BLUEPRINTS_PREFIX + "/"):
            rest = str(obj.get("key", ""))[len(SHARED_BLUEPRINTS_PREFIX) + 1:]
            if "/" in rest:
                ids.add(rest.split("/", 1)[0])
        out["in_r2"] = sorted(ids)
    except Exception as e:  # noqa: BLE001 — an unreachable bucket IS the finding
        out["r2_error"] = str(e)[:300]
    try:
        out["on_disk"] = sorted(d.name for d in BLUEPRINTS_STAGING.iterdir()
                                if d.is_dir())
    except OSError as e:
        out["r2_error"] = out["r2_error"] or f"staging unreadable: {e}"
    for name in out["on_disk"]:
        bp = _read_blueprint_dir(BLUEPRINTS_STAGING / name)
        if bp:
            meta = bp["meta"]
            out["loaded"].append({
                "id": bp["id"],
                "kind": str(meta.get("kind") or DEFAULT_BLUEPRINT_KIND),
                "name": str(meta.get("name") or bp["id"]),
            })
        else:
            out["skipped"].append({"id": name, "why": _rejection_reason(name)})
    return out


def _rejection_reason(bp_id: str) -> str:
    """Re-run the load for ONE blueprint and return the error text, so a rejected
    blueprint can say why in the UI instead of only in a log nobody reads."""
    d = BLUEPRINTS_STAGING / bp_id
    try:
        manifest = json.loads((d / "blueprint.json").read_text(encoding="utf-8"))
        graph = json.loads((d / "workflow.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return f"unreadable: {e}"
    if not isinstance(graph, dict) or not graph:
        return "workflow.json is not an API-format node dict"
    try:
        _validate_manifest(bp_id, manifest)
    except ValueError as e:
        return str(e)
    return "unknown"


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
    kind = str(manifest.get("kind") or DEFAULT_BLUEPRINT_KIND).strip().lower()
    if kind not in BLUEPRINT_KINDS:
        raise ValueError(
            f"blueprint '{bp_id}': kind '{kind}' is not one of "
            f"{', '.join(BLUEPRINT_KINDS)}")
    manifest["kind"] = kind
    _validate_params(bp_id, manifest, bindings)
    _validate_models(bp_id, manifest)
    _validate_custom_nodes(bp_id, manifest)
    return manifest


def _validate_custom_nodes(bp_id: str, manifest: dict) -> list:
    """Validate + normalize the OPTIONAL `custom_nodes[]` array (B?? §10).

    Each entry declares a ComfyUI custom-node repo the blueprint's graph needs
    (e.g. PuLID for a `PulidModelLoader` node). The companion agent git-clones
    any missing one into `custom_nodes/<name>` and pins `commit` if given.
    `custom_nodes` defaults to `[]`; a blueprint without it is unchanged. Each
    entry needs a `name` (the on-disk dir) and a git `url`; `commit` is optional
    (pin for reproducibility). Raises ValueError with a readable message on a
    structurally broken entry so the loader can skip a bad blueprint."""
    nodes = manifest.get("custom_nodes")
    if nodes in (None, ""):
        manifest["custom_nodes"] = []
        return []
    if not isinstance(nodes, list):
        raise ValueError(f"blueprint '{bp_id}': 'custom_nodes' must be an array")
    out = []
    seen = set()
    for i, n in enumerate(nodes):
        if not isinstance(n, dict):
            raise ValueError(
                f"blueprint '{bp_id}': custom_nodes[{i}] is not an object")
        name = str(n.get("name", "")).strip()
        url = str(n.get("url", "")).strip()
        if not name:
            raise ValueError(
                f"blueprint '{bp_id}': custom_nodes[{i}] needs a 'name' "
                "(its custom_nodes/ folder)")
        if not url:
            raise ValueError(
                f"blueprint '{bp_id}': custom node '{name}' needs a git 'url'")
        if name in seen:
            raise ValueError(
                f"blueprint '{bp_id}': duplicate custom node '{name}'")
        seen.add(name)
        entry = {"name": name, "url": url}
        commit = str(n.get("commit", "")).strip()
        if commit:
            entry["commit"] = commit
        out.append(entry)
    manifest["custom_nodes"] = out
    return out


def _validate_models(bp_id: str, manifest: dict) -> list:
    """Validate + normalize the OPTIONAL `models[]` array.

    Each entry declares what ComfyUI must have installed. The catalog match keys
    (`url`, `save_path`, `base`, `filename`) gate AUTO-INSTALL via
    ComfyUI-Manager (B43 §4): a model carrying all of them is installable from
    Manager's curated catalog; one missing any is simply not auto-installable
    and falls to the manual checklist — so they are OPTIONAL here, NOT hard-
    required. `field` (the /object_info enum field, e.g. `ckpt_name`) is kept
    for the installed-check. Back-compat: the older `{source, dir}` shape maps
    onto `{url, save_path}` (source→url, dir→save_path) when the aligned keys
    are absent. Raises ValueError only on a structurally broken entry."""
    models = manifest.get("models")
    if models in (None, ""):
        manifest["models"] = []
        return []
    if not isinstance(models, list):
        raise ValueError(f"blueprint '{bp_id}': 'models' must be an array")
    out = []
    for i, m in enumerate(models):
        if not isinstance(m, dict):
            raise ValueError(
                f"blueprint '{bp_id}': models[{i}] is not an object")
        # Aligned keys win; fall back to the legacy {source, dir} names so old
        # blueprint.json files keep loading.
        url = str(m.get("url") or m.get("source") or "").strip()
        save_path = str(m.get("save_path") or m.get("dir") or "").strip()
        norm = {
            "field": str(m.get("field", "")).strip(),
            "filename": str(m.get("filename", "")).strip(),
            "save_path": save_path,
            "base": str(m.get("base", "")).strip(),
            "url": url,
        }
        # Optional verify/progress metadata + catalog niceties, passed through.
        # `r2_key` = an ARTIST-UPLOADED model file at `_shared/models/<sha256>/…`
        # (B?? §10) — the companion pulls this into `models/<save_path>/` when the
        # model isn't a public/catalog download. `sha256` pins the exact version.
        for opt in ("sha256", "size", "name", "type", "r2_key"):
            if m.get(opt) not in (None, ""):
                norm[opt] = m[opt]
        out.append(norm)
    manifest["models"] = out
    return out


def _validate_options_from(bp_id: str, key: str, src) -> None:
    """`options_from` says where a select param's list can be re-read LIVE:
    `{"class": "<ComfyUI class_type>", "field": "<input name>"}`.

    Keyed on the CLASS, never a node id — the point is "whatever this ComfyUI
    offers for that input today", and a class survives a graph re-import that
    renumbers every node. The baked `options` array stays as the offline
    fallback, so a blueprint remains portable and a sleeping pod costs nothing.
    """
    if src in (None, ""):
        return
    if not isinstance(src, dict):
        raise ValueError(
            f"blueprint '{bp_id}': param '{key}' has an 'options_from' that is "
            "not an object (expected {'class': ..., 'field': ...})")
    cls = str(src.get("class", "")).strip()
    field = str(src.get("field", "")).strip()
    if not cls or not field:
        raise ValueError(
            f"blueprint '{bp_id}': param '{key}' has an 'options_from' without "
            "a 'class' and a 'field' (the ComfyUI node class and input name its "
            "list comes from)")


def _validate_params(bp_id: str, manifest: dict, bindings: dict) -> list:
    """Validate the OPTIONAL `params[]` array (exposed "general settings").

    `params` defaults to `[]`; a blueprint without it is unchanged. Each entry
    must have a unique `key`, a known `type`, and a `node`+`field` it drives.
    A param key may NOT collide with a binding role or another param key, and a
    param may NOT target a (node, field) already driven by a binding (no
    double-drive). Returns the normalized list (also stored back on the
    manifest so loaders/callers see a clean `params`). Raises ValueError with a
    readable message on any problem (the loader skips a bad blueprint, the
    upload handler returns the message verbatim)."""
    params = manifest.get("params")
    if params in (None, ""):
        manifest["params"] = []
        return []
    if not isinstance(params, list):
        raise ValueError(f"blueprint '{bp_id}': 'params' must be an array")
    # (node, field) pairs already driven by a binding — a param can't re-drive.
    bound_targets = set()
    for role, b in bindings.items():
        if role == "output" or not isinstance(b, dict):
            continue
        n = str(b.get("node", "")).strip()
        f = str(b.get("field", "")).strip()
        if n and f:
            bound_targets.add((n, f))
    seen_keys = set()
    out = []
    for i, p in enumerate(params):
        if not isinstance(p, dict):
            raise ValueError(
                f"blueprint '{bp_id}': params[{i}] is not an object")
        key = str(p.get("key", "")).strip()
        if not key:
            raise ValueError(
                f"blueprint '{bp_id}': params[{i}] has no 'key'")
        if key in KNOWN_ROLES:
            raise ValueError(
                f"blueprint '{bp_id}': param key '{key}' collides with a "
                "binding role name — pick a different key")
        if key in seen_keys:
            raise ValueError(
                f"blueprint '{bp_id}': duplicate param key '{key}'")
        seen_keys.add(key)
        ptype = str(p.get("type", "")).strip().lower()
        if ptype not in PARAM_TYPES:
            raise ValueError(
                f"blueprint '{bp_id}': param '{key}' has invalid type "
                f"'{ptype}' (one of {', '.join(PARAM_TYPES)})")
        node = str(p.get("node", "")).strip()
        field = str(p.get("field", "")).strip()
        if not node or not field:
            raise ValueError(
                f"blueprint '{bp_id}': param '{key}' needs a 'node' and "
                "'field' (the node input it drives)")
        if (node, field) in bound_targets:
            raise ValueError(
                f"blueprint '{bp_id}': param '{key}' targets node {node}."
                f"{field}, which is already driven by a binding — a node "
                "input can't be driven by both a role and a param")
        if ptype == "select" and not (
                isinstance(p.get("options"), list) and p.get("options")):
            raise ValueError(
                f"blueprint '{bp_id}': select param '{key}' needs a non-empty "
                "'options' array")
        # Normalize: keep only recognized keys (drop noise), default missing
        # label to the key. Bounds/options/step are passed through untouched.
        #
        # `multiline` is a presentation hint on a `text` param: the value is
        # prose (a second prompt, a caption), not a token like `#222222`, so the
        # tool gives it a full-width box instead of the narrow inline input every
        # other setting gets. Purely cosmetic — the runner injects the string the
        # same either way — but without it a graph with two prompts can only
        # expose the second one through a field too small to read it in.
        _validate_options_from(bp_id, key, p.get("options_from"))
        norm = {
            "key": key, "type": ptype, "node": node, "field": field,
            "label": str(p.get("label", "")).strip() or key,
            "default": p.get("default"),
        }
        # This tuple is a WHITELIST: a key missing from it is dropped silently on
        # publish, and the blueprint then behaves as if the author never declared
        # it. Add here first when the param shape grows.
        for opt in ("min", "max", "step", "options", "options_from", "group",
                    "multiline"):
            if opt in p:
                norm[opt] = p[opt]
        out.append(norm)
    manifest["params"] = out
    return out


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
    # Every exposed param must point at a node/field that actually exists in
    # the graph (so the runner can set it). `params` was normalized in
    # `_validate_manifest`.
    for p in manifest.get("params", []):
        node_id = str(p.get("node", "")).strip()
        field = str(p.get("field", "")).strip()
        node = graph.get(node_id)
        if not isinstance(node, dict):
            raise ValueError(
                f"blueprint '{bp_id}': param '{p.get('key')}' targets node "
                f"'{node_id}', which is not in the workflow graph")
        inputs = node.get("inputs")
        if not isinstance(inputs, dict) or field not in inputs:
            raise ValueError(
                f"blueprint '{bp_id}': param '{p.get('key')}' targets input "
                f"'{field}' on node '{node_id}', which that node doesn't have")
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
    params = manifest.get("params") or []
    custom_nodes = manifest.get("custom_nodes") or []
    # meta carries everything except bindings (incl. the normalized params +
    # custom_nodes), so list_blueprints()/get_blueprint() surface them to the UI.
    # params + custom_nodes are ALSO promoted to the top level for the runner /
    # the companion prepare step (B?? §10).
    meta = {k: v for k, v in manifest.items() if k != "bindings"}
    meta.setdefault("id", bp_id)
    return {"id": bp_id, "graph": graph, "bindings": bindings,
            "params": params, "custom_nodes": custom_nodes, "meta": meta}


def list_blueprints(kind: str | None = None) -> list[dict]:
    """Readable blueprints in the shared library -> list of meta dicts
    ({id, name, description, base, kind, …}), sorted by id. Hydrates first.

    `kind` filters to one tool's blueprints ("image" / "video"); None lists every
    kind, which is what a MANAGEMENT surface wants (hiding a kind there would
    strand it with no way to delete it). A tool's PICKER should always pass its
    own kind — offering the other tool's networks is a trap, not a feature."""
    hydrate()
    out: list[dict] = []
    if not BLUEPRINTS_STAGING.is_dir():
        return out
    want = str(kind).strip().lower() if kind else ""
    for d in sorted(p for p in BLUEPRINTS_STAGING.iterdir() if p.is_dir()):
        bp = _read_blueprint_dir(d)
        if not bp:
            continue
        meta = bp["meta"]
        if want and str(meta.get("kind") or DEFAULT_BLUEPRINT_KIND) != want:
            continue
        out.append(meta)
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


def delete_blueprint(blueprint_id: str) -> dict:
    """Remove a shared blueprint: every object under
    `_shared/blueprints/<id>/` in R2 PLUS its staging mirror dir. Returns
    `{id, deleted, existed}` (deleted = R2 objects removed). Raises ValueError
    only on an empty id. Best-effort per object / on the local rmtree — a
    partially-present blueprint still gets cleaned up as far as possible, and a
    missing one is a no-op (`existed=False`). The id is slugged so it matches
    the on-disk dir and the stored `pipeline` value identically."""
    bp_id = r2_slug(blueprint_id or "")
    if not bp_id:
        raise ValueError("no blueprint id")
    prefix = f"{SHARED_BLUEPRINTS_PREFIX}/{bp_id}/"
    try:
        keys = [o["key"] for o in storage.list_keys(prefix)]
    except Exception:  # noqa: BLE001 — R2 hiccup: fall back to the known files
        keys = [f"{prefix}blueprint.json", f"{prefix}workflow.json",
                f"{prefix}thumb.png"]
    deleted = 0
    for k in keys:
        try:
            storage.delete(k)
            deleted += 1
        except Exception:  # noqa: BLE001 — keep deleting the rest
            pass
    d = BLUEPRINTS_STAGING / bp_id
    existed_local = d.is_dir()
    if existed_local:
        try:
            shutil.rmtree(d)
        except OSError:
            pass
    return {"id": bp_id, "deleted": deleted,
            "existed": bool(deleted) or existed_local}
