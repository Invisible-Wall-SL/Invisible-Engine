"""Persisted ComfyUI `/object_info` catalog, so the Settings dropdowns survive a
ComfyUI that isn't answering — one catalog per place a render can run.

Why this exists: `batch_atlas._available(node, field)` reads the installed-model
lists LIVE from `{COMFY_BASE}/object_info/<node>`, and returns `None` the moment
`_comfy_alive()` fails. The hosted tool's default is `COMFY_TRANSPORT=serverless`
— the RunPod endpoint is a job queue, not a long-lived HTTP server — so
`COMFY_BASE` never answers and EVERY model dropdown silently degraded to a
free-text box. A typo in a checkpoint name then only surfaced as a failed render.

Two targets, two catalogs (`TARGETS`): a render runs either on RunPod ("pod") or
on the user's own machine ("local"), and those are different installs with
different files. A dropdown must list the files of the machine that will
actually load the model, so:
  * "local" — `COMFY_BASE` (the tunnel to the user's ComfyUI) is asked LIVE, and
    what it answers is cached under `_shared/comfy/catalog.json`.
  * "pod" — there is nothing to ask live: serverless workers exist only while a
    job runs. `COMFY_CATALOG_URL` (an always-on pod that mounts the same Network
    Volume) is read on ⟳ and cached under `_shared/comfy/catalog-pod.json`.
    `COMFY_BASE` is deliberately NEVER consulted for this target — it would show
    the user's local files for a render that runs on the pod.

Shared across every client/project: what a ComfyUI has installed is a property
of the install, not of a client or a project.

Contract, in order of trust:
  1. a LIVE `/object_info` read (local target only — authoritative),
  2. the target's catalog (the last time anything answered for it),
  3. the caller's own static seed (`ui_server.ENUM_FIELDS`, for true ComfyUI
     enums whose values are fixed and knowable offline).

Everything here is fail-safe: a dead R2, malformed JSON, a hung ComfyUI — the
caller gets `{}` / `None` and the Settings page still renders. Nothing in the
read path ever writes to R2 (a page render must not cost a PUT); only `refresh()`
and one opportunistic `commit_live()` after a live render may store.
"""
from __future__ import annotations

import json
import os
import time as _time
from typing import Callable, Iterable, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import batch_atlas
import runpod_control
import storage

# Shared keys mirror the `_shared/blueprints/` and `_shared/spines/` precedent.
# "local" keeps the original key: everything that ever wrote it read COMFY_BASE,
# i.e. the user's own ComfyUI over the tunnel.
TARGETS = ("local", "pod")
CATALOG_KEYS = {
    "local": "_shared/comfy/catalog.json",
    "pod": "_shared/comfy/catalog-pod.json",
}
CATALOG_KEY = CATALOG_KEYS["local"]

# How long a loaded catalog is trusted in-process. Short: a `refresh()` in one
# container should show up in another within a page reload or two, and the read
# is a single small R2 GET.
_LOAD_TTL = 60.0
# Floor between opportunistic writes, so a flapping ComfyUI can't turn every
# render into a PUT even when its lists genuinely keep changing.
_WRITE_COOLDOWN = 300.0
# The catalog probe is a plain read of an always-on ComfyUI; keep it tight so a
# wedged host can't stall the ⟳ button for a minute.
_PROBE_TIMEOUT = 4.0

_cache: dict[str, dict] = {t: {"t": 0.0, "doc": None} for t in TARGETS}
_pending: dict[str, list[str]] = {}   # live LOCAL lists seen this process, not yet stored
_last_write = 0.0


def _target(target: str) -> str:
    return target if target in CATALOG_KEYS else "local"


def catalog_key(target: str = "local") -> str:
    return CATALOG_KEYS[_target(target)]


def field_key(node: str, field: str) -> str:
    """The catalog's flat key for one enum. `|` because neither a ComfyUI node
    class name nor an input name contains it."""
    return f"{node}|{field}"


# --- read path ---------------------------------------------------------------

def load(target: str = "local", *, force: bool = False) -> dict:
    """The stored catalog for `target`, or `{}` if there isn't one / it can't
    be read.

    Never raises: an R2 outage or a truncated object must not take the Settings
    page down with it — it just means the dropdowns fall back a tier."""
    slot = _cache[_target(target)]
    now = _time.time()
    doc = slot.get("doc")
    if not force and doc is not None and now - float(slot["t"]) < _LOAD_TTL:
        return doc  # type: ignore[return-value]
    parsed: dict = {}
    try:
        raw = storage.get(catalog_key(target))
        if raw:
            loaded = json.loads(raw.decode("utf-8"))
            if isinstance(loaded, dict):
                fields = loaded.get("fields")
                # Parsed field by field: one junk value must not cost us the
                # whole catalog, because "no catalog" is the free-text state
                # this module exists to prevent.
                try:
                    fetched = float(loaded.get("fetchedAt") or 0.0)
                except (TypeError, ValueError):
                    fetched = 0.0
                parsed = {
                    "fetchedAt": fetched,
                    "source": str(loaded.get("source") or ""),
                    "fields": {str(k): [str(x) for x in v]
                               for k, v in fields.items()
                               if isinstance(v, list) and v}
                    if isinstance(fields, dict) else {},
                }
    except Exception:  # noqa: BLE001 — any R2/parse failure = "no catalog"
        parsed = {}
    slot["doc"] = parsed
    slot["t"] = now
    return parsed


def stored_options(node: str, field: str, target: str = "local") -> list[str] | None:
    """The target catalog's list for one enum, or None if it isn't in there."""
    vals = (load(target).get("fields") or {}).get(field_key(node, field))
    return list(vals) if isinstance(vals, list) and vals else None


def options(node: str, field: str, *, target: str = "local",
            available: Callable[[str, str], list[str] | None] | None = None,
            ) -> list[str] | None:
    """Valid values for `node.field` on `target` — live if its ComfyUI answers,
    else its stored catalog, else None (the caller then decides: static seed,
    or free text).

    For "pod" there is no live source (see the module docstring), and asking
    COMFY_BASE would answer for the WRONG machine — so it is the catalog or
    nothing. A live LOCAL hit is remembered for `commit_live()`; this function
    itself never touches R2 beyond the cached `load()`."""
    if _target(target) == "pod":
        return stored_options(node, field, "pod")
    probe = available or batch_atlas._available
    live: list[str] | None
    try:
        live = probe(node, field)
    except Exception:  # noqa: BLE001 — a probe must never break a render
        live = None
    if live:
        vals = [str(v) for v in live]
        _pending[field_key(node, field)] = vals
        return vals
    return stored_options(node, field, "local")


def remember(node: str, field: str, values: Sequence[str], target: str = "local") -> None:
    """Hand a list another reader saw LIVE (`comfy_specs`, the blueprint contract
    reader) to the next `commit_live()`. Local only: the pod catalog is written
    by ⟳ alone, and a live pod read there is already the answer the caller wanted.
    The same content gate and cooldown apply, so a reader that saw nothing new
    costs no PUT."""
    if _target(target) != "local":
        return
    vals = [str(v) for v in values]
    if vals:
        _pending[field_key(node, field)] = vals


def commit_live(*, now: Callable[[], float] = _time.time) -> bool:
    """Store the live LOCAL lists `options()` has seen — but only if they
    genuinely differ from what's already in R2, and at most once per cooldown.

    This is the one write reachable from the render path, and it is
    content-gated precisely so a page reload is not an R2 PUT."""
    global _last_write
    if not _pending:
        return False
    current = load("local")
    fields = dict(current.get("fields") or {})
    if all(fields.get(k) == v for k, v in _pending.items()):
        return False
    t = now()
    if t - _last_write < _WRITE_COOLDOWN:
        return False
    fields.update(_pending)
    if _store(fields, str(batch_atlas.COMFY_BASE), t, "local"):
        _last_write = t
        _pending.clear()
        return True
    return False


# --- status (what the Settings panel tells the user) -------------------------

def status(target: str = "local", *,
           alive: Callable[[], bool] | None = None) -> dict:
    """Where this render's model lists came from, for the panel's status line.

    `live` reuses `_comfy_alive()`'s cached verdict, so asking costs nothing on
    top of the probe the dropdowns already did. For "pod" it is always False —
    nothing can be live there — without touching COMFY_BASE at all."""
    target = _target(target)
    is_live = False
    if target == "local":
        probe = alive or batch_atlas._comfy_alive
        try:
            is_live = bool(probe())
        except Exception:  # noqa: BLE001
            is_live = False
    doc = load(target)
    fields = doc.get("fields") or {}
    return {
        "target": target,
        "live": is_live,
        "cached": bool(fields),
        "source": str(doc.get("source") or ""),
        "fetchedAt": float(doc.get("fetchedAt") or 0.0),
        "fields": len(fields),
    }


# --- refresh -----------------------------------------------------------------

def _http_get_json(url: str, headers: dict, timeout: float = _PROBE_TIMEOUT) -> dict:
    """One read-only GET. Kept as a module function so tests can replace it."""
    return json.loads(urlopen(Request(url, headers=headers),
                              timeout=timeout).read())


def catalog_url() -> str:
    """OPTIONAL override for the RunPod side's list source. Normally unset —
    `pod_candidates()` finds a running pod on its own. Set it only to pin a
    specific always-on reader (e.g. the CPU volume pod the launcher's
    COMFY_VOLUME_URL points at) or to reach one the RunPod API can't list.

    Read at call time (not import) so a Railway var takes effect on redeploy
    without a code change.

    A value that cannot be an HTTP base is IGNORED rather than probed, because
    a bad one is silent: found live set to
    `https://s3api-eu-ro-1.runpod.io s3://wvi855bwh8/` — the Network Volume's
    S3 endpoint and bucket, pasted together, space and all. urlparse reads that
    host as `s3api-eu-ro-1.runpod.io s3`, every request fails, and the panel
    just says nothing answered. Ignoring it lets pod discovery take over, which
    is what actually works."""
    raw = (os.environ.get("COMFY_CATALOG_URL") or "").strip().rstrip("/")
    if not raw:
        return ""
    if not _usable_http_base(raw):
        print(f"[catalog] ignoring COMFY_CATALOG_URL={raw!r}: not an http(s) "
              "base URL (a ComfyUI address like "
              "https://<pod-id>-8188.proxy.runpod.net). Falling back to pod "
              "discovery.", flush=True)
        return ""
    return raw


def _usable_http_base(url: str) -> bool:
    """An http(s) URL with a host and no embedded whitespace."""
    if any(c.isspace() for c in url):
        return False
    parsed = urlparse(url)
    return parsed.scheme in ("http", "https") and bool(parsed.hostname)


def pod_candidates() -> list[tuple[str, str]]:
    """Where the RunPod side's model lists might be read from, best first, as
    (url, label).

    An explicit COMFY_CATALOG_URL always wins. Otherwise ASK RUNPOD which pods
    are running and derive each one's ComfyUI address from its id — nobody
    should have to copy a pod id into an env var, and a pinned id goes stale
    the moment the fleet changes.

    Any running pod is a valid reader because the fleet shares one Network
    Volume (`Invisible_RunPod_Storage`) — the same volume the serverless
    workers mount — so its `/object_info` lists exactly the files a serverless
    render will load. The chosen source is reported in the status strip, so a
    wrong-looking list is always traceable to the pod it came from.

    Strictly read-only: a GraphQL *query* plus GETs. Nothing here can start,
    resume or bill a pod — discovering a stopped pod simply means it is not a
    candidate."""
    out: list[tuple[str, str]] = []
    base = catalog_url()
    if base:
        out.append((base, f"{base} (COMFY_CATALOG_URL)"))
    try:
        for pod in runpod_control.running_pods():
            # Every port the pod might answer on, not just one: "HTTP 8189 + TCP
            # 8188" is the documented config, and a pod set up that way serves
            # NOTHING on the 8188 proxy. Probing in order costs one extra request
            # against a pod that predates the forwarder and nothing otherwise.
            for url in (pod.get("urls") or [pod.get("url")]):
                url = str(url or "")
                if url and url not in [u for u, _ in out]:
                    out.append((url, f"{pod.get('name')} ({pod.get('id')})"))
    except Exception:  # noqa: BLE001 — discovery is a convenience, never fatal
        pass
    return out


def _probe_sources(target: str, alive: Callable[[], bool],
                   http_get: Callable[[str, dict], dict],
                   ) -> tuple[str, str] | None:
    """The source `target` may be read from, as (base_url, label) — or None when
    nothing answers. Local is COMFY_BASE and nothing else; pod is a RunPod pod
    (discovered, or pinned via COMFY_CATALOG_URL) and never COMFY_BASE — see the
    module docstring for why the two must not substitute for each other."""
    if _target(target) == "pod":
        for base, label in pod_candidates():
            try:
                http_get(f"{base}/system_stats", dict(batch_atlas.CF_HEADERS))
                return (base, label)
            except Exception:  # noqa: BLE001 — not answering = try the next
                continue
        return None
    try:
        if alive():
            return (str(batch_atlas.COMFY_BASE), str(batch_atlas.COMFY_BASE))
    except Exception:  # noqa: BLE001
        pass
    return None


def _unreachable_note(target: str) -> str:
    if _target(target) == "pod":
        tried = pod_candidates()
        if not tried:
            return ("RunPod's serverless workers can't be asked for their model "
                    "lists, and no pod is running to ask instead. Start one on "
                    "the /comfyui page and press ⟳ again. The stored catalog "
                    "was left untouched.")
        names = ", ".join(label for _, label in tried[:4])
        return (f"No RunPod pod answered ({names}). A pod that is booting isn't "
                "serving ComfyUI yet — give it a minute and press ⟳ again. The "
                "stored catalog was left untouched.")
    return (f"Your ComfyUI didn't answer at {batch_atlas.COMFY_BASE} — start "
            "ComfyUI and the tunnel (desktop launcher), then ⟳. The stored "
            "catalog was left untouched.")


def _store(fields: dict[str, list[str]], source: str, fetched_at: float,
           target: str) -> bool:
    doc = {"fetchedAt": float(fetched_at), "source": str(source),
           "fields": {k: list(v) for k, v in fields.items() if v}}
    try:
        storage.put(catalog_key(target),
                    json.dumps(doc, indent=1).encode("utf-8"),
                    content_type="application/json")
    except Exception:  # noqa: BLE001 — a failed store is not a failed refresh
        return False
    slot = _cache[_target(target)]
    slot["doc"] = doc
    slot["t"] = _time.time()
    return True


def _untouched(target: str, source: str, note: str) -> dict:
    cur = load(target, force=True)
    fields = cur.get("fields") or {}
    return {
        "ok": False, "target": _target(target), "source": source,
        "fields": len(fields), "values": sum(len(v) for v in fields.values()),
        "fetchedAt": float(cur.get("fetchedAt") or 0.0), "note": note,
    }


def refresh(pairs: Iterable[Sequence[str]], *, target: str = "local",
            alive: Callable[[], bool] | None = None,
            http_get: Callable[[str, dict], dict] | None = None,
            now: Callable[[], float] = _time.time) -> dict:
    """Probe every (node, field) on `target`'s source and store the result as
    that target's new catalog.

    `pairs` is passed in rather than read from `ui_server.MODEL_FIELDS` — that
    module imports THIS one, so reaching back would be circular.

    A probe that reaches nothing returns `ok: False` and leaves the stored
    catalog alone: an unreachable ComfyUI is not evidence that the models are
    gone, and blanking a good catalog would take the dropdowns down with it."""
    target = _target(target)
    probe_alive = alive or batch_atlas._comfy_alive
    get_json = http_get or (lambda url, headers: _http_get_json(url, headers))
    src = _probe_sources(target, probe_alive, get_json)
    if src is None:
        return _untouched(target, "", _unreachable_note(target))
    base, label = src
    headers = dict(batch_atlas.CF_HEADERS)
    found: dict[str, list[str]] = {}
    for pair in pairs:
        node, field = str(pair[0]), str(pair[1])
        try:
            info = get_json(f"{base}/object_info/{node}", headers)
            opts = info[node]["input"]["required"][field][0]
        except (HTTPError, URLError, KeyError, ValueError, TypeError,
                IndexError, ConnectionError, TimeoutError, OSError):
            continue
        if isinstance(opts, list) and opts:
            found[field_key(node, field)] = [str(v) for v in opts]
    if not found:
        return _untouched(target, label,
                          f"{label} answered but listed no model enums — the "
                          "stored catalog was left untouched.")
    t = now()
    # Merged, not replaced: a source that simply doesn't have (say) the RMBG
    # node would otherwise DELETE a list we already had, dropping that field
    # back to free text. A probe answers "here is what I have", never "here is
    # what exists"; the status line's timestamp is what surfaces staleness.
    merged = dict(load(target, force=True).get("fields") or {})
    merged.update(found)
    stored = _store(merged, label, t, target)
    if target == "local":
        _pending.clear()
    return {
        "ok": stored, "target": target, "source": label, "fields": len(found),
        "values": sum(len(v) for v in found.values()), "fetchedAt": t,
        "note": ("" if stored else
                 "Read the lists but could not write them to R2 — they apply to "
                 "this container only."),
    }
