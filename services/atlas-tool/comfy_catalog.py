"""Persisted ComfyUI `/object_info` catalog, so the Settings dropdowns survive a
ComfyUI that isn't answering.

Why this exists: `batch_atlas._available(node, field)` reads the installed-model
lists LIVE from `{COMFY_BASE}/object_info/<node>`, and returns `None` the moment
`_comfy_alive()` fails. The hosted tool runs `COMFY_TRANSPORT=serverless` — the
RunPod endpoint is a job queue, not a long-lived HTTP server, and `comfy_host` is
blank — so `COMFY_BASE` never answers and EVERY model dropdown silently degraded
to a free-text box. A typo in a checkpoint name then only surfaced as a failed
render.

So the enum lists are cached in R2 under ONE shared, non-project key: what
ComfyUI has installed is a property of the ComfyUI install, not of a client or a
project, and every user of every project wants the same answer.

Contract, in order of trust:
  1. a LIVE `/object_info` read (authoritative — a model added today shows up),
  2. this catalog (the last time anything answered),
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
from urllib.request import Request, urlopen

import batch_atlas
import storage

# Shared across every client/project — mirrors the `_shared/blueprints/` and
# `_shared/spines/` precedent.
CATALOG_KEY = "_shared/comfy/catalog.json"

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

_cache: dict[str, object] = {"t": 0.0, "doc": None}
_pending: dict[str, list[str]] = {}   # live lists seen this process, not yet stored
_last_write = 0.0


def field_key(node: str, field: str) -> str:
    """The catalog's flat key for one enum. `|` because neither a ComfyUI node
    class name nor an input name contains it."""
    return f"{node}|{field}"


# --- read path ---------------------------------------------------------------

def load(*, force: bool = False) -> dict:
    """The stored catalog, or `{}` if there isn't one / it can't be read.

    Never raises: an R2 outage or a truncated object must not take the Settings
    page down with it — it just means the dropdowns fall back a tier."""
    now = _time.time()
    doc = _cache.get("doc")
    if not force and doc is not None and now - float(_cache["t"]) < _LOAD_TTL:
        return doc  # type: ignore[return-value]
    parsed: dict = {}
    try:
        raw = storage.get(CATALOG_KEY)
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
    _cache["doc"] = parsed
    _cache["t"] = now
    return parsed


def stored_options(node: str, field: str) -> list[str] | None:
    """The catalog's list for one enum, or None if it isn't in there."""
    vals = (load().get("fields") or {}).get(field_key(node, field))
    return list(vals) if isinstance(vals, list) and vals else None


def options(node: str, field: str, *,
            available: Callable[[str, str], list[str] | None] | None = None,
            ) -> list[str] | None:
    """Valid values for `node.field` — live if ComfyUI answers, else the stored
    catalog, else None (the caller then decides: static seed, or free text).

    A live hit is remembered for `commit_live()`; this function itself never
    touches R2 beyond the cached `load()`."""
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
    return stored_options(node, field)


def commit_live(*, now: Callable[[], float] = _time.time) -> bool:
    """Store the live lists `options()` has seen — but only if they genuinely
    differ from what's already in R2, and at most once per cooldown.

    This is the one write reachable from the render path, and it is
    content-gated precisely so a page reload is not an R2 PUT."""
    global _last_write
    if not _pending:
        return False
    current = load()
    fields = dict(current.get("fields") or {})
    if all(fields.get(k) == v for k, v in _pending.items()):
        return False
    t = now()
    if t - _last_write < _WRITE_COOLDOWN:
        return False
    fields.update(_pending)
    if _store(fields, str(batch_atlas.COMFY_BASE), t):
        _last_write = t
        _pending.clear()
        return True
    return False


# --- status (what the Settings panel tells the user) -------------------------

def status(*, alive: Callable[[], bool] | None = None) -> dict:
    """Where this render's model lists came from, for the panel's status line.

    `live` reuses `_comfy_alive()`'s cached verdict, so asking costs nothing on
    top of the probe the dropdowns already did."""
    probe = alive or batch_atlas._comfy_alive
    try:
        is_live = bool(probe())
    except Exception:  # noqa: BLE001
        is_live = False
    doc = load()
    fields = doc.get("fields") or {}
    return {
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
    """Optional always-on ComfyUI to read model lists from — e.g. the CPU volume
    pod the launcher already reads for its "What's installed" panel. Read at call
    time (not import) so setting the Railway var takes effect on redeploy without
    a code change. Read-only by construction: we only ever GET /object_info, so
    pointing this at a pod never starts, resumes or bills one."""
    return (os.environ.get("COMFY_CATALOG_URL") or "").strip().rstrip("/")


def _probe_sources(alive: Callable[[], bool],
                   http_get: Callable[[str, dict], dict],
                   ) -> tuple[str, str] | None:
    """First source that answers `/object_info`, as (base_url, label)."""
    try:
        if alive():
            return (str(batch_atlas.COMFY_BASE), str(batch_atlas.COMFY_BASE))
    except Exception:  # noqa: BLE001
        pass
    base = catalog_url()
    if base:
        try:
            http_get(f"{base}/system_stats", dict(batch_atlas.CF_HEADERS))
            return (base, base)
        except Exception:  # noqa: BLE001 — not answering = not a source
            pass
    return None


def _store(fields: dict[str, list[str]], source: str, fetched_at: float) -> bool:
    doc = {"fetchedAt": float(fetched_at), "source": str(source),
           "fields": {k: list(v) for k, v in fields.items() if v}}
    try:
        storage.put(CATALOG_KEY,
                    json.dumps(doc, indent=1).encode("utf-8"),
                    content_type="application/json")
    except Exception:  # noqa: BLE001 — a failed store is not a failed refresh
        return False
    _cache["doc"] = doc
    _cache["t"] = _time.time()
    return True


def refresh(pairs: Iterable[Sequence[str]], *,
            alive: Callable[[], bool] | None = None,
            http_get: Callable[[str, dict], dict] | None = None,
            now: Callable[[], float] = _time.time) -> dict:
    """Probe every (node, field) and store the result as the new catalog.

    `pairs` is passed in rather than read from `ui_server.MODEL_FIELDS` — that
    module imports THIS one, so reaching back would be circular.

    A probe that reaches nothing returns `ok: False` and leaves the stored
    catalog alone: an unreachable ComfyUI is not evidence that the models are
    gone, and blanking a good catalog would take the dropdowns down with it."""
    probe_alive = alive or batch_atlas._comfy_alive
    get_json = http_get or (lambda url, headers: _http_get_json(url, headers))
    src = _probe_sources(probe_alive, get_json)
    if src is None:
        cur = load(force=True)
        configured = " (COMFY_CATALOG_URL is not set)" if not catalog_url() else ""
        return {
            "ok": False, "source": "", "fields": len(cur.get("fields") or {}),
            "values": sum(len(v) for v in (cur.get("fields") or {}).values()),
            "fetchedAt": float(cur.get("fetchedAt") or 0.0),
            "note": ("No ComfyUI answered — neither the configured transport nor "
                     f"COMFY_CATALOG_URL{configured}. The stored catalog was left "
                     "untouched."),
        }
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
        cur = load(force=True)
        return {
            "ok": False, "source": label,
            "fields": len(cur.get("fields") or {}),
            "values": sum(len(v) for v in (cur.get("fields") or {}).values()),
            "fetchedAt": float(cur.get("fetchedAt") or 0.0),
            "note": (f"{label} answered but listed no model enums — the stored "
                     "catalog was left untouched."),
        }
    t = now()
    # Merged, not replaced: a source that simply doesn't have (say) the RMBG
    # node would otherwise DELETE a list we already had, dropping that field
    # back to free text. A probe answers "here is what I have", never "here is
    # what exists"; the status line's timestamp is what surfaces staleness.
    merged = dict(load(force=True).get("fields") or {})
    merged.update(found)
    stored = _store(merged, label, t)
    _pending.clear()
    return {
        "ok": stored, "source": label, "fields": len(found),
        "values": sum(len(v) for v in found.values()), "fetchedAt": t,
        "note": ("" if stored else
                 "Read the lists but could not write them to R2 — they apply to "
                 "this container only."),
    }
