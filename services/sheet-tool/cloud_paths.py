"""Cloud drop-in replacement for project_paths.py (Invisible Sheet Maker).

Same `resolve()` dict shape the tool already consumes, but:
  - input_dir / output_root point at a local *staging* directory (ephemeral
    container disk) so all existing pathlib/PIL code is unchanged;
  - the staging tree mirrors an R2 prefix 1:1 (see storage.py) so state
    survives container restarts.

The Sheet Maker is pure Pillow/CPU — it does NOT drive ComfyUI. It packs loose
sprite PNGs into a sheet and writes a `.atlas` / TexturePacker JSON / the
Invisible AI manifest. The authored manifest lands in the SHARED `manifests/`
folder both tools read/write — no cross-tool copy needed.

Extra keys added to resolve(): `r2_project_prefix`, `staging_root`,
`manifest_dir`, `client`. `atlas_maker_dir` is None in the cloud (no sibling
folder); the shared `manifests/` tree replaces the old handoff.

**Unified project repo:** R2 layout is `<client>/<project>/...`, organized by
asset type and SHARED by all tools (the old `<tool>/` segment is retired). The
Sheet Maker's subfolders are `manifests/` (shared with the Atlas Maker),
`sheet_src/<sheet>/` (uploaded loose sprites), `sheets/<sheet>/` (packed
output). Client/project isolation is preserved — still `<C>/<P>` at the root.

**Concurrency (request-local context):** the server is a ThreadingHTTPServer
(one thread per request), so the active (client, project) is held in a
`threading.local()` — thread-local == request-local. `set_context` /
`switch_context` write the CALLING thread's local; `resolve()` reads the calling
thread's state (env defaults if unset). Two concurrent requests for different
projects each see their own context; reads are lock-free. The staging tree is
keyed by (client, project) so their local-disk trees never collide.

This module is now a THIN tool-specific layer: the thread-local context base,
R2 storage and slug validation all live in `iw_common`. The full public API
(every name the tool imports) is preserved here as wrappers.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path

import storage

from iw_common.context import (
    PROJECT_SLUG_RE,
    UNASSIGNED_CLIENT,
    ToolContext,
    prefix_for_tool,
    project_prefix,
    r2_slug,
    safe_proj_name as _safe_proj_name,
    valid_client,
    valid_project,
)

STAGING_BASE = Path(os.environ.get("SHEET_STAGING", "/tmp/sheet-tool"))
TOOL_NAMESPACE = "sheet_maker"

# One per-tool thread-local context (env names + defaults supplied here).
_CTX = ToolContext(
    tool_namespace=TOOL_NAMESPACE,
    project_env_var="SHEET_PROJECT",
    client_env_var="SHEET_CLIENT",
    project_default="cloud",
    client_default=UNASSIGNED_CLIENT,
)


# --- env defaults (public API; delegate to the shared context) ---------------

def env_project() -> str:
    """The default project from env (used until set_context() overrides it)."""
    return _CTX.env_project()


def env_client() -> str:
    """The default client from env (used until set_context() overrides it)."""
    return _CTX.env_client()


# --- request-local context (public API; delegate to the shared context) ------

def _ctx_get() -> tuple[str, str]:
    """The calling thread's (client, project), env defaults if unset."""
    return _CTX.ctx_get()


def project_name() -> str:
    return _CTX.project_name()


def client_name() -> str:
    return _CTX.client_name()


def set_context(client: str | None, project: str | None) -> bool:
    """Switch THIS thread's active (client, project). Idempotent if unchanged.

    Validates both keys against the slug contract; invalid/empty falls back to
    the env default for that key. Returns True if EITHER actually changed for
    this thread."""
    return _CTX.set_context(client, project)


# Back-compat alias.
def set_project(key: str) -> bool:
    return set_context(client_name(), key)


def r2_project_prefix(client_key: str, proj_key: str) -> str:
    return _CTX.r2_project_prefix(client_key, proj_key)


# (client, project) pairs already hydrated this process. Aliased to the shared
# context's set/lock so the race-fix invariant (per-instance state) is intact.
_HYDRATED: set[tuple[str, str]] = _CTX.hydrated
_HYDRATE_LOCK: threading.Lock = _CTX.hydrate_lock

# Heavy subtree pulled LAZILY (on first access) rather than eagerly at project
# open — the uploaded sprite pile grows without bound and a cold project never
# needs it. `ensure_lazy` hydrates it on first use.
_LAZY_SUBTREES = ("sheet_src/",)
_LAZY_DONE: set[tuple[str, str, str]] = set()
# Reentrant: clearcache holds it across a force-`hydrate()` call, which itself
# re-takes this lock to discard the force-cleared guards.
_LAZY_LOCK = threading.RLock()


def lazy_lock():
    """The (reentrant) lock guarding the lazy-hydrate guard set. Exposed so clearcache can
    serialize its rmtree against any in-flight `ensure_lazy` pull. Holding it
    across the rmtree closes the window where a half-pulled sheet_src/ could be
    left behind a still-set guard."""
    return _LAZY_LOCK


def discard_active_lazy_guards() -> None:
    """Drop the active (client, project)'s lazy guards so the next access
    re-pulls. MUST be called while holding `lazy_lock()` (clearcache does)."""
    client_key = r2_slug(client_name())
    proj_key = r2_slug(project_name())
    for sub in _LAZY_SUBTREES:
        _LAZY_DONE.discard((client_key, proj_key, sub))


def hydrate(client_key: str, proj_key: str, staging_root: Path, force: bool = False) -> None:
    """Pull this (client, project)'s R2 subtree into staging once per process.

    Manifests/config/packed sheets (small, needed for the sheet + project lists)
    pull synchronously; uploaded sprites (potentially many PNGs) pull in a
    background thread so the server starts listening straight away instead of
    blocking boot (which would trip Railway's healthcheck). manifests/ is SHARED
    with the Atlas Maker — pulling it lets the project browser list BOTH tools'
    manifests."""
    key = (client_key, proj_key)
    with _CTX.hydrate_lock:
        if key in _CTX.hydrated and not force:
            return
        _CTX.hydrated.add(key)
    if force:
        with _LAZY_LOCK:
            for sub in _LAZY_SUBTREES:
                _LAZY_DONE.discard((client_key, proj_key, sub))
    base = r2_project_prefix(client_key, proj_key)
    kr = base + "/"

    # Synchronous: shared manifests + config + packed sheets (small, needed for
    # the project/sheet lists in the unified asset-typed layout). The uploaded
    # sprite pile (sheet_src/) is NOT pulled — it grows without bound and is only
    # needed once a sheet is actively edited, so it hydrates lazily on first
    # access (see ensure_lazy) instead of for every cold project.
    for sub in ("manifests/", "sheet_config.json", "sheet_session.json", "sheets/"):
        try:
            storage.pull_prefix(base + "/" + sub, staging_root, kr)
        except Exception:  # noqa: BLE001 — first run / empty bucket is fine
            pass


def ensure_lazy(subtree: str) -> None:
    """Pull a lazy subtree (e.g. "sheet_src/") for THIS thread's active (client,
    project) on first access, once per process. Idempotent and incremental:
    `pull_prefix` skips files already on disk by size, so repeat calls are cheap
    no-ops. A file added to R2 after the first pull won't appear until the next
    process / explicit Refresh — the same contract as hydrate(). Best-effort:
    any R2 error leaves the local dir as-is and clears the guard so a later
    access retries, rather than raising into a request.

    The whole pull runs UNDER `_LAZY_LOCK` (not just the guard flip) so clearcache
    — which takes the same lock — can never rmtree a tree mid-pull and leave a
    half-populated sheet_src/ behind its still-set guard. Lazy pulls are once-per-
    subtree-per-process and idempotent, so serializing them is effectively free."""
    sub = subtree if subtree.endswith("/") else subtree + "/"
    client_key = r2_slug(client_name())
    proj_key = r2_slug(project_name())
    key = (client_key, proj_key, sub)
    base = r2_project_prefix(client_key, proj_key)
    staging_root = STAGING_BASE / client_key / proj_key
    with _LAZY_LOCK:
        if key in _LAZY_DONE:
            return
        _LAZY_DONE.add(key)
        try:
            storage.pull_prefix(base + "/" + sub, staging_root, base + "/")
        except Exception:  # noqa: BLE001 — first run / empty bucket / transient
            _LAZY_DONE.discard(key)


def resolve() -> dict:
    proj = project_name()
    client = client_name()
    proj_key = r2_slug(proj)
    client_key = r2_slug(client)

    # Staging subdir names match the unified R2 asset-typed layout 1:1 so the
    # staging tree mirrors `<C>/<P>/<subfolder>` directly:
    #   input_dir    -> sheet_src/<sheet>     (uploaded loose PNGs, per sheet)
    #   output_root  -> sheets/<sheet>        (packed sheet PNG + coords)
    #   manifest_dir -> manifests/            (SHARED with the Atlas Maker)
    staging_root = STAGING_BASE / client_key / proj_key
    input_dir = staging_root / "sheet_src"
    output_root = staging_root / "sheets"
    manifest_dir = staging_root / "manifests"

    # Pull existing state from R2 before the tool reads it.
    hydrate(client_key, proj_key, staging_root)

    for d in (input_dir, output_root, manifest_dir):
        try:
            d.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass

    return {
        "project": proj,
        "client": client,
        "project_key": proj_key,
        "project_root": None,
        "input_dir": input_dir,
        "output_root": output_root,
        # Shared project manifest folder (both tools read/write it).
        "manifest_dir": manifest_dir,
        # No sibling folder in the cloud; manifests now land in the shared tree.
        "atlas_maker_dir": None,
        "r2_project_prefix": r2_project_prefix(client_key, proj_key),
        "staging_root": staging_root,
    }


def switch_context(client: str | None, project: str | None) -> dict | None:
    """Set THIS thread's active (client, project) and, if it changed, re-resolve
    its staging paths. Returns the fresh resolve() dict on a real switch, else
    None. Thread-local context means no global lock is needed around the switch.

    resolve() already hydrates this (client, project) ONCE per process (guarded
    by the _HYDRATED dedup set). We deliberately do NOT force a re-pull here:
    under the ThreadingHTTPServer every request runs on a FRESH thread whose
    thread-local context starts empty, so set_context() reports a "change" on
    essentially every request — forcing a re-hydrate here spawned a full
    sheet_src/+sheets/ R2 pull per request, exhausting threads/memory (RuntimeError:
    can't start new thread). On-demand refresh is the explicit "Refresh from R2"
    button, which force-hydrates when asked."""
    if not set_context(client, project):
        return None
    return resolve()  # rebuilds paths/prefix + hydrates once per (c,p)


# Back-compat: old single-key entrypoint maps onto the current client.
def switch_project(key: str) -> dict | None:
    return switch_context(client_name(), key)


# Compatibility no-ops for callers that import these from project_paths.
def list_projects() -> list[str]:
    return [project_name()]


def project_root() -> Path | None:
    return None


def atlas_maker_dir() -> Path | None:
    return None


__all__ = [
    "STAGING_BASE",
    "TOOL_NAMESPACE",
    "UNASSIGNED_CLIENT",
    "PROJECT_SLUG_RE",
    "valid_project",
    "valid_client",
    "project_prefix",
    "r2_slug",
    "_safe_proj_name",
    "env_project",
    "env_client",
    "_ctx_get",
    "project_name",
    "client_name",
    "set_context",
    "set_project",
    "prefix_for_tool",
    "r2_project_prefix",
    "_HYDRATED",
    "_HYDRATE_LOCK",
    "hydrate",
    "ensure_lazy",
    "lazy_lock",
    "discard_active_lazy_guards",
    "resolve",
    "switch_context",
    "switch_project",
    "list_projects",
    "project_root",
    "atlas_maker_dir",
]
