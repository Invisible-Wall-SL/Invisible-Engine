"""The shared MODEL MIRROR, read as a delivery oracle.

`comfyui-models/` in R2 plus the manifest at `tools/invisible-launcher/
models-manifest.json` are how a model file actually travels between the three
machines that matter: an artist's desktop pulls from it via the Invisible
Launcher's "Sync models", a RunPod network volume is filled from it by
`runpod/pull-models.py`, and `runpod/push-models.py` is what puts things in.
Nothing in the render path had ever read it, so a missing model produced a
checklist that named a file and a folder and said nothing at all about where the
bytes are or how to get them.

THE AUTHORITY SPLIT, which every function here is written to preserve:

    THE TARGET'S OWN INVENTORY IS THE ONLY THING ALLOWED TO REFUSE A RENDER.
    THIS MODULE IS ONLY EVER ALLOWED TO EXPLAIN HOW TO FIX ONE.

No state this module can be in — R2 down, no manifest, a stale manifest, two
files with one name, an indexed object that 404s — may set `ready = False` or
otherwise stop a render that would have worked. The worst a broken mirror is
allowed to do is say less. That is what makes an R2 outage structurally
incapable of costing anybody a render.

Imports ONLY `storage` + stdlib, deliberately: `comfy_catalog` does a top-level
`import batch_atlas`, and in the render subprocess `batch_atlas` IS `__main__`,
so any edge back into it re-executes the whole module as a second object with
its own `COMFY_BASE` and caches. Every I/O primitive is injectable and resolved
INSIDE the function body — `batch_atlas` imports this module at module scope, so
a default argument naming something absent from the `storage.py` re-export list
would be an import-time crash that kills every render, not a render-time one.
"""
from __future__ import annotations

import json
import time

import storage

# Both literals are duplicated in `runpod/push-models.py` and (the manifest key)
# `runpod/pull-models.py`, which are standalone `__main__` scripts with their own
# boto3 client and import nothing from the service. `test_model_mirror.py` pins
# them against each other so a fifth definition is a test failure, not drift.
MIRROR_PREFIX = "comfyui-models"
MANIFEST_KEY = "tools/invisible-launcher/models-manifest.json"

# How long a loaded manifest is trusted in-process; mirrors `comfy_catalog`'s.
# A render reads it once per blueprint, so this only collapses repeats.
_LOAD_TTL = 60.0

_cache: dict = {"t": 0.0, "index": None}


def _empty(state: str, reason: str) -> dict:
    return {"state": state, "reason": reason, "prefix": MIRROR_PREFIX,
            "by_key": {}, "by_name": {}}


def load_index(*, get_bytes=None) -> dict:
    """The manifest as a lookup index.

    Returns `{state, reason, prefix, by_key, by_name}` where state is 'ready' |
    'absent' | 'unreadable'. `get_strict`, not `get`: `get` folds a genuine 404
    and an R2 timeout into the same `None`, and telling those apart is this
    module's entire product — 'there is no manifest row for your model' is a
    real finding, 'we could not ask' is not.

    Never raises, never writes. `prefix` comes off the doc's own `base_prefix`
    because that is the value `push-models.py` hard-exits over and the one the
    launcher presigns against; the constant is only the floor under it.
    """
    # An INJECTED reader is a caller asking for that specific read, so it never
    # serves or fills the process-wide cache — otherwise one test's fake manifest
    # would answer the next one's.
    shared = get_bytes is None
    get_bytes = get_bytes or storage.get_strict
    now = time.time()
    cached = _cache.get("index")
    if shared and cached is not None and now - float(_cache["t"]) < _LOAD_TTL:
        return cached
    try:
        raw = get_bytes(MANIFEST_KEY)
    except storage.ObjectUnreadable as e:
        return _empty("unreadable", str(e))
    except Exception as e:  # noqa: BLE001 — a broken read is never "absent"
        return _empty("unreadable", f"{type(e).__name__}: {e}")
    if raw is None:
        index = _empty("absent", f"no {MANIFEST_KEY} in R2")
        if shared:
            _cache.update({"t": now, "index": index})
        return index
    try:
        doc = json.loads(raw.decode("utf-8"))
    except Exception as e:  # noqa: BLE001 — truncated/garbled bytes
        return _empty("unreadable", f"manifest did not parse: {e}")
    if not isinstance(doc, dict):
        return _empty("unreadable", "manifest is not an object")

    by_key: dict = {}
    by_name: dict = {}
    for row in doc.get("models") or []:
        if not isinstance(row, dict):
            continue
        key = str(row.get("key") or "").strip()
        name = str(row.get("name") or "").strip()
        if not key or not name:
            continue
        entry = {
            "key": key,
            "dir": str(row.get("dir") or "").strip(),
            "name": name,
            "size": int(row.get("size") or 0),
            "sha256": str(row.get("sha256") or "").strip(),
        }
        by_key[key] = entry
        by_name.setdefault(name, []).append(entry)
    index = {
        "state": "ready",
        "reason": "",
        "prefix": str(doc.get("base_prefix") or "").strip() or MIRROR_PREFIX,
        "by_key": by_key,
        "by_name": by_name,
    }
    if shared:
        _cache.update({"t": now, "index": index})
    return index


def constructed_key(model: dict, index: dict) -> str:
    """`<prefix>/<save_path>/<filename>` — where a model WOULD live if it were
    mirrored. Empty when there is no filename to build one from."""
    name = str(model.get("filename") or "").strip()
    if not name:
        return ""
    prefix = str(index.get("prefix") or MIRROR_PREFIX).strip("/")
    save_path = str(model.get("save_path") or model.get("dir") or "").strip("/")
    return f"{prefix}/{save_path}/{name}" if save_path else f"{prefix}/{name}"


def resolve(model: dict, index: dict) -> dict:
    """Where this model is in the mirror, as far as the index can say. PURE.

    Returns `{state, key, dir, name, size, sha256, matched_on, candidates}` with
    state in ('hit', 'miss', 'ambiguous', 'unknown').

    Match order:
      1. the constructed `<prefix>/<save_path>/<filename>`, when save_path is
         known — an exact key is the only unambiguous answer;
      2. `filename` alone, which ADOPTS the mirror's own `dir`. That dir is
         authoritative about placement (`pull-models.py` writes `<dest>/<dir>/
         <name>`) where `save_path` is a derived guess and deliberately carries
         the legacy `unet`/`clip` aliases;
      3. a STORED `model['r2_key']` — and ONLY when the live index could not be
         read. It is a cache, never an override of a live answer, or an
         auto-written key outlives the file it names forever.

    Two rows with one name in different folders resolve to NOTHING: choosing
    would be a coin flip that sends gigabytes at the wrong loader's folder.
    """
    name = str(model.get("filename") or "").strip()
    out = {"state": "unknown", "key": "", "dir": "", "name": name,
           "size": 0, "sha256": "", "matched_on": "", "candidates": []}
    if index.get("state") != "ready":
        stored = str(model.get("r2_key") or "").strip()
        if stored:
            out.update({"state": "hit", "key": stored, "matched_on": "stored_r2_key",
                        "dir": str(model.get("save_path") or "").strip(),
                        "size": int(model.get("size") or 0),
                        "sha256": str(model.get("sha256") or "").strip()})
        else:
            out["state"] = "unknown"
        return out
    if not name:
        out["state"] = "miss"
        return out

    key = constructed_key(model, index)
    hit = index["by_key"].get(key) if key else None
    if hit:
        out.update({"state": "hit", "matched_on": "key", **_row(hit)})
        return out

    rows = index["by_name"].get(name) or []
    if len(rows) == 1:
        out.update({"state": "hit", "matched_on": "filename", **_row(rows[0])})
        return out
    if len(rows) > 1:
        out["state"] = "ambiguous"
        out["candidates"] = [r["key"] for r in rows]
        return out

    out["state"] = "miss"
    out["key"] = key
    return out


def _row(entry: dict) -> dict:
    return {"key": entry["key"], "dir": entry["dir"], "name": entry["name"],
            "size": entry["size"], "sha256": entry["sha256"]}


def verify(resolution: dict, model: dict, index: dict, *, head=None) -> dict:
    """One strict HEAD against the resolved (or constructed) key.

    On a HIT it promotes to verified, or demotes to 'indexed_but_gone' when the
    manifest indexes an object that is not in the bucket. On a MISS it HEADs the
    constructed key anyway — an object that exists under `comfyui-models/` with
    no manifest row is the exact `reindex` state `push-models.py` keeps a bucket
    for: the bytes are in R2 but "Sync models" will never fetch them, which is a
    completely different remedy from "nobody has ever uploaded this".

    `ObjectUnreadable` leaves the verdict exactly as it was: a transport blip
    must never be reported as a file going missing.
    """
    head = head or storage.head
    state = resolution.get("state")
    if state not in ("hit", "miss"):
        return resolution
    key = resolution.get("key") or constructed_key(model, index)
    if not key:
        return resolution
    try:
        meta = head(key)
    except storage.ObjectUnreadable:
        return resolution
    except Exception:  # noqa: BLE001 — an unverified verdict is still a verdict
        return resolution
    if state == "hit":
        if meta is None:
            resolution["state"] = "indexed_but_gone"
        else:
            resolution["verified"] = True
            if not resolution.get("size"):
                resolution["size"] = int(meta.get("size") or 0)
    elif meta is not None:
        resolution["state"] = "in_bucket_unindexed"
        resolution["key"] = key
        resolution["size"] = int(meta.get("size") or 0)
    return resolution


_PULL_LINE = ("python services/atlas-tool/runpod/pull-models.py --dest "
              "/workspace/ComfyUI/models")


def describe(resolution: dict, target: str) -> str:
    """The one-sentence remedy: the exact file, the key, the size, and the BUTTON
    or COMMAND a human touches. Same voice as the graph guards — a message that
    names no control is a message nobody can act on."""
    state = resolution.get("state")
    name = resolution.get("name") or "the model"
    key = resolution.get("key") or ""
    size = resolution.get("size") or 0
    sized = f" ({storage.human_bytes(int(size))})" if size else ""
    serverless = target == "serverless"

    if state == "hit":
        if resolution.get("matched_on") == "stored_r2_key":
            # The live manifest could not be read, so this is the key the
            # DECLARATION remembers. Say so — it may name a file that has since
            # been removed from the mirror, and nothing here checked.
            where = ("run  " + _PULL_LINE + "  on a pod, then start a fresh "
                     "worker") if serverless else \
                    "click 'Sync models' in the Invisible Launcher, then restart ComfyUI"
            return (f"the model mirror could not be read; this blueprint records "
                    f"'{name}' at {key}{sized}. If that is still current, {where}.")
        if serverless:
            return (f"'{name}' IS in the model mirror at {key}{sized} — on a pod "
                    f"with the network volume mounted run  {_PULL_LINE}  then "
                    "start a fresh worker (a running one keeps its old file list).")
        return (f"'{name}' IS in the model mirror at {key}{sized} — click "
                "'Sync models' in the Invisible Launcher, then restart ComfyUI "
                "(it only scans models/ at startup).")
    if state == "in_bucket_unindexed":
        return (f"'{name}' is in R2 at {key}{sized} but NO manifest row indexes "
                "it, so 'Sync models' will never fetch it. Re-run "
                "runpod/push-models.py --apply from the machine that has it to "
                "index it.")
    if state == "indexed_but_gone":
        return (f"the model mirror lists '{name}' at {key} but the object is not "
                "in the bucket — re-upload it with runpod/push-models.py --apply "
                "from the machine that has it.")
    if state == "ambiguous":
        cands = ", ".join(str(c) for c in resolution.get("candidates") or [])
        return (f"the model mirror holds several files named '{name}' ({cands}) — "
                "nothing was chosen. Say which folder this graph means, or remove "
                "the duplicate.")
    if state == "miss":
        return (f"'{name}' is not in the model mirror at all — add it with "
                "scripts/seed-comfyui-models.py (or runpod/push-models.py "
                "--apply) from the machine that has the file.")
    return (f"could not read the model mirror ({resolution.get('reason') or 'no reason given'})"
            f" — this is NOT evidence that '{name}' is missing from it.")


def short_status(resolution: dict) -> str:
    """The mirror verdict in a few words, for a diagnostic card.

    The card sits directly above a banner that prints the full checklist with
    the whole remedy on it, so restating the remedy here would be the third
    printing of one finding — `emit` already prints the card's own canonical
    text as well."""
    state = (resolution or {}).get("state")
    size = (resolution or {}).get("size") or 0
    sized = f" ({storage.human_bytes(int(size))})" if size else ""
    if state == "hit":
        return f"in the model mirror at {resolution.get('key')}{sized}"
    if state == "in_bucket_unindexed":
        return f"in R2 at {resolution.get('key')}{sized} but not indexed"
    if state == "indexed_but_gone":
        return "listed in the model mirror, but the object is gone"
    if state == "ambiguous":
        return "several files with this name in the mirror — none chosen"
    if state == "miss":
        return "not in the model mirror"
    return "model mirror could not be read"


def enrich(entries: list, target: str, *, get_bytes=None, head=None) -> str:
    """Write a `mirror` verdict + a `remedy` sentence onto each row IN PLACE.

    The one impure entry point the render path calls, and the only place the two
    R2 reads happen — after a result exists, so a run where everything is already
    installed makes no R2 calls at all. Returns the index state so the caller can
    name it. Every failure degrades to 'unknown'; nothing here can raise into a
    render.
    """
    if not entries:
        return "skipped"
    try:
        index = load_index(get_bytes=get_bytes)
    except Exception as e:  # noqa: BLE001 — load_index already catches, belt and braces
        index = _empty("unreadable", f"{type(e).__name__}: {e}")
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        try:
            res = resolve(entry, index)
            if index.get("state") != "ready":
                res.setdefault("reason", index.get("reason", ""))
            else:
                res = verify(res, entry, index, head=head)
            if res.get("size"):
                res["size_human"] = storage.human_bytes(int(res["size"]))
            entry["mirror"] = res
            entry["remedy"] = describe(res, target)
        except Exception as e:  # noqa: BLE001 — an explanation must never fail a run
            entry["mirror"] = {"state": "unknown", "reason": f"{type(e).__name__}: {e}"}
            entry["remedy"] = describe(entry["mirror"], target)
    return str(index.get("state") or "unknown")


# `blueprints.merge_model_provenance` re-emits the provenance half of an entry
# in `blueprints.MODEL_PROVENANCE_KEYS` order on every run, and the rescan writer
# runs merge and THEN annotate. So a key appended at the end here is a key the
# NEXT merge moves — different bytes for identical content, which turns the
# rescan's `if man_bytes == before` no-op into a second R2 put plus a
# `hydrate(force=True)`. This module must not import `blueprints` (see the module
# docstring), so the order is restated here and `test_model_mirror.py` pins the
# two against each other.
_PROVENANCE_ORDER = ("url", "r2_key", "sha256", "base", "size", "name", "type")


def _canonical(entry: dict) -> dict:
    """`entry` with its provenance keys moved to the back in the order the next
    `merge_model_provenance` will emit them."""
    out = {k: v for k, v in entry.items() if k not in _PROVENANCE_ORDER}
    for key in _PROVENANCE_ORDER:
        if key in entry:
            out[key] = entry[key]
    return out


def annotate(models: list, index: dict) -> tuple[list, int]:
    """Stamp `r2_key`/`sha256`/`size` onto the declarations that resolve. PURE.

    Copies the three values VERBATIM out of the index and nothing else — no
    timestamp, no presigned URL, no verified flag — and leaves the entry in the
    key order the next `merge_model_provenance` will produce, so a second turn of
    the REAL cycle (derive -> merge -> annotate -> json.dumps) is byte-identical,
    not just a second call to this function. That determinism is load-bearing:
    `_rescanblueprintmodels` decides whether to write at all with a raw
    `if man_bytes == before`, so a reordered key turns every click into a fresh
    R2 put plus a `hydrate(force=True)`.

    Writes nothing at all unless the index is 'ready', and NEVER removes a key:
    an R2 hiccup during a rescan must not strip provenance off every declared
    model and then persist that.
    """
    out: list = []
    changed = 0
    ready = index.get("state") == "ready"
    for m in models or []:
        if not isinstance(m, dict):
            out.append(m)
            continue
        entry = dict(m)
        if ready:
            res = resolve(entry, index)
            if res.get("state") == "hit":
                add = {"r2_key": res["key"]}
                if res.get("sha256"):
                    add["sha256"] = res["sha256"]
                if res.get("size"):
                    add["size"] = res["size"]
                if any(entry.get(k) != v for k, v in add.items()):
                    changed += 1
                entry.update(add)
                entry = _canonical(entry)
        out.append(entry)
    return out, changed
