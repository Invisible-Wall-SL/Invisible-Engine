"""Cloud drop-in replacement for project_paths.py (Invisible Atlas Maker).

Same `resolve()` dict shape the tool already consumes, but:
  - input_dir / batch_dir / atlas_dir point at a local *staging* directory
    (ephemeral container disk) so all existing pathlib/PIL code is unchanged;
  - ComfyUI is reached at a full tunnel URL (COMFY_URL) with Cloudflare Access
    headers, not a bare host:port on plain http;
  - the staging tree mirrors an R2 prefix 1:1 (see storage.py) so state
    survives container restarts.

Extra keys added to resolve(): `comfy_url`, `cf_headers`, `manifest_dir`,
`r2_project_prefix`, plus key-root helpers.

**Client isolation (Option B):** R2 layout is `<tool>/<client>/<project>/...`.

**Concurrency (request-local context):** the server is a ThreadingHTTPServer
(one thread per request), so the active (client, project) is held in a
`threading.local()` — thread-local == request-local. `set_context` /
`switch_context` write the CALLING thread's local; `resolve()` reads the calling
thread's state (falling back to env defaults if this thread hasn't set one).
Two concurrent requests for different projects each see their own context;
reads are lock-free. The staging tree is keyed by (client, project) too, so
their local-disk trees never collide.

This module is now a THIN tool-specific layer: the thread-local context base,
R2 storage, ComfyUI headers and slug validation all live in `iw_common`. The
full public API (every name the tool imports) is preserved here as wrappers.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path

import storage

from iw_common.comfy import USER_AGENT, cf_headers, comfy_url
from iw_common.context import (
    PROJECT_SLUG_RE,
    UNASSIGNED_CLIENT,
    ToolContext,
    prefix_for_tool,
    safe_proj_name as _safe_proj_name,
    valid_client,
    valid_project,
)

STAGING_BASE = Path(os.environ.get("ATLAS_STAGING", "/tmp/atlas-tool"))
TOOL_NAMESPACE = "atlas_maker"

# One per-tool thread-local context (env names + defaults supplied here).
_CTX = ToolContext(
    tool_namespace=TOOL_NAMESPACE,
    project_env_var="ATLAS_PROJECT",
    client_env_var="ATLAS_CLIENT",
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
    this thread — the caller should then re-resolve paths and re-hydrate
    staging."""
    return _CTX.set_context(client, project)


# Back-compat alias for code that still calls the old single-key entry point.
def set_project(key: str) -> bool:
    return set_context(client_name(), key)


def r2_project_prefix(client_key: str, proj_key: str) -> str:
    return _CTX.r2_project_prefix(client_key, proj_key)


# (client, project) pairs already hydrated this process. Aliased to the shared
# context's set/lock so the race-fix invariant (per-instance state) is intact.
_HYDRATED: set[tuple[str, str]] = _CTX.hydrated
_HYDRATE_LOCK: threading.Lock = _CTX.hydrate_lock


def hydrate(client_key: str, proj_key: str, staging_root: Path, force: bool = False) -> None:
    """Pull this (client, project)'s R2 subtree into staging once per process.

    Manifests + config are pulled SYNCHRONOUSLY (a handful of small files — the
    UI needs them to render regions). Refs/outputs (potentially thousands of
    PNGs) are pulled in a BACKGROUND thread so the server starts listening
    immediately instead of blocking boot for minutes (which would trip
    Railway's healthcheck).

    `force=True` (the explicit "Refresh from R2" button, /refreshr2) re-pulls
    even a (c,p) already hydrated this process, so freshly-exported manifests
    show up without a restart. It must NOT be wired into the per-request context
    switch — that re-pulls the whole subtree on every request and exhausts
    threads/memory."""
    key = (client_key, proj_key)
    with _CTX.hydrate_lock:
        if key in _CTX.hydrated and not force:
            return
        _CTX.hydrated.add(key)
    base = r2_project_prefix(client_key, proj_key)
    kr = base + "/"

    # Synchronous: manifests + config (small, needed for first render).
    for sub in ("manifests/", "atlas_config.json"):
        try:
            storage.pull_prefix(base + "/" + sub, staging_root, kr)
        except Exception:  # noqa: BLE001 — first run / empty bucket is fine
            pass

    # Background: refs + outputs (large; only needed for thumbnails/generation).
    def _bg() -> None:
        for sub in ("input/", "output/"):
            try:
                storage.pull_prefix(base + "/" + sub, staging_root, kr)
            except Exception:  # noqa: BLE001
                pass

    threading.Thread(target=_bg, name="atlas-hydrate", daemon=True).start()


def resolve() -> dict:
    proj = project_name()
    client = client_name()
    proj_key = _safe_proj_name(proj)
    client_key = _safe_proj_name(client)
    # Output sub-prefix is now ALWAYS the project key (was a separate env).
    prefix_name = proj_key

    # Staging is keyed by (client, project) so two contexts (e.g. two
    # concurrent requests on different threads) never collide on local disk.
    staging_root = STAGING_BASE / client_key / proj_key
    input_dir = staging_root / "input"
    output_root = staging_root / "output"
    batch_dir = output_root / prefix_name / "batch"
    atlas_dir = output_root / prefix_name / "atlas"
    manifest_dir = staging_root / "manifests"

    # Pull existing state from R2 before the tool reads it.
    hydrate(client_key, proj_key, staging_root)

    for d in (input_dir, batch_dir, atlas_dir, manifest_dir):
        try:
            d.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass

    return {
        "project": proj,
        "client": client,
        "project_root": None,
        # legacy field kept for compatibility; cloud code should use comfy_url.
        "comfy_host": (comfy_url() or "127.0.0.1:8188").replace("https://", "").replace("http://", ""),
        "comfy_url": comfy_url(),
        "cf_headers": cf_headers(),
        "comfy_base": staging_root,
        "input_dir": input_dir,
        "batch_dir": batch_dir,
        "atlas_dir": atlas_dir,
        "manifest_dir": manifest_dir,
        "output_prefix": prefix_name,
        "comfy_filename_prefix_base": f"{TOOL_NAMESPACE}/{client_key}/{proj_key}/{prefix_name}",
        "r2_project_prefix": r2_project_prefix(client_key, proj_key),
        "staging_root": staging_root,
    }


def switch_context(client: str | None, project: str | None) -> dict | None:
    """Set THIS thread's active (client, project) and, if it changed, re-resolve
    its staging paths. Returns the fresh resolve() dict on a real switch, else
    None.

    Resolution/validation lives in set_context(); because the context is
    thread-local, a concurrent request on another thread can't observe this
    thread's switch — no global lock is needed around the switch itself.

    resolve() already hydrates this (client, project) ONCE per process (guarded
    by the _HYDRATED dedup set). We deliberately do NOT force a re-pull here:
    under the ThreadingHTTPServer every request runs on a FRESH thread whose
    thread-local context starts empty, so set_context() reports a "change" on
    essentially every request — forcing a re-hydrate here spawned a full
    input/+output/ R2 pull per request, exhausting threads/memory (RuntimeError:
    can't start new thread). On-demand refresh is the explicit "Refresh from R2"
    button (/refreshr2), which force-hydrates when asked."""
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


__all__ = [
    "STAGING_BASE",
    "TOOL_NAMESPACE",
    "USER_AGENT",
    "UNASSIGNED_CLIENT",
    "PROJECT_SLUG_RE",
    "valid_project",
    "valid_client",
    "_safe_proj_name",
    "env_project",
    "env_client",
    "_ctx_get",
    "project_name",
    "client_name",
    "set_context",
    "set_project",
    "comfy_url",
    "cf_headers",
    "prefix_for_tool",
    "r2_project_prefix",
    "_HYDRATED",
    "_HYDRATE_LOCK",
    "hydrate",
    "resolve",
    "switch_context",
    "switch_project",
    "list_projects",
    "project_root",
]
