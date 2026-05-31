"""Cloud drop-in replacement for project_paths.py.

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
"""
from __future__ import annotations

import os
import re
import threading
from pathlib import Path

import storage

STAGING_BASE = Path(os.environ.get("ATLAS_STAGING", "/tmp/atlas-tool"))
TOOL_NAMESPACE = "atlas_maker"
USER_AGENT = "InvisibleAtlas/1.0"  # Cloudflare blocks Python-urllib's default UA

# Reserved client key for legacy / NULL clientKey rows.
UNASSIGNED_CLIENT = "unassigned"

# Shared contract with the launcher: a project/client key is a slug.
PROJECT_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def valid_project(key: str | None) -> str | None:
    """Return the key if it matches the shared slug contract, else None."""
    if key and PROJECT_SLUG_RE.match(key):
        return key
    return None


def valid_client(key: str | None) -> str | None:
    """Same slug rule as projects; kept as a separate alias so calling code
    reads clearly at the call site."""
    if key and PROJECT_SLUG_RE.match(key):
        return key
    return None


def _safe_proj_name(name: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in (name or "default"))[:60]


def env_project() -> str:
    """The default project from env (used until set_context() overrides it)."""
    return (os.environ.get("IW_PROJECT_NAME") or "").strip() or os.environ.get(
        "ATLAS_PROJECT", "cloud"
    )


def env_client() -> str:
    """The default client from env (used until set_context() overrides it).

    Order: `IW_CLIENT_NAME` (launcher-pinned) -> `ATLAS_CLIENT` -> `unassigned`.
    """
    return (os.environ.get("IW_CLIENT_NAME") or "").strip() or os.environ.get(
        "ATLAS_CLIENT", UNASSIGNED_CLIENT
    )


# Request-local context. Under ThreadingHTTPServer each request runs on its own
# thread, so a thread-local store is effectively a per-request store. A thread
# that has not set a context falls back to the env defaults (see _ctx()).
_ctx = threading.local()


def _ctx_get() -> tuple[str, str]:
    """The calling thread's (client, project), env defaults if unset."""
    client = getattr(_ctx, "client", None)
    project = getattr(_ctx, "project", None)
    if client is None or project is None:
        client = env_client()
        project = env_project()
        _ctx.client = client
        _ctx.project = project
    return client, project


def project_name() -> str:
    return _ctx_get()[1]


def client_name() -> str:
    return _ctx_get()[0]


def set_context(client: str | None, project: str | None) -> bool:
    """Switch THIS thread's active (client, project). Idempotent if unchanged.

    Validates both keys against the slug contract; invalid/empty falls back to
    the env default for that key. Returns True if EITHER actually changed for
    this thread — the caller should then re-resolve paths and re-hydrate
    staging."""
    cur_client, cur_project = _ctx_get()
    new_client = valid_client((client or "").strip()) or env_client()
    new_project = valid_project((project or "").strip()) or env_project()
    if new_client == cur_client and new_project == cur_project:
        return False
    _ctx.client = new_client
    _ctx.project = new_project
    return True


# Back-compat alias for code that still calls the old single-key entry point.
def set_project(key: str) -> bool:
    return set_context(client_name(), key)


def comfy_url() -> str:
    base = (os.environ.get("COMFY_URL") or "").strip()
    return base.rstrip("/")


def cf_headers() -> dict[str, str]:
    """Cloudflare Access service-token headers + a non-blocked User-Agent."""
    h = {"User-Agent": USER_AGENT}
    cid = os.environ.get("CF_ACCESS_CLIENT_ID")
    sec = os.environ.get("CF_ACCESS_CLIENT_SECRET")
    if cid and sec:
        h["CF-Access-Client-Id"] = cid
        h["CF-Access-Client-Secret"] = sec
    return h


def prefix_for_tool(tool: str, client: str, project: str) -> str:
    """Canonical R2 prefix for any tool. Single source of truth used both
    internally and by handoff callers (e.g. Sheet->Atlas manifest writes)."""
    return f"{tool}/{client}/{project}"


def r2_project_prefix(client_key: str, proj_key: str) -> str:
    return prefix_for_tool(TOOL_NAMESPACE, client_key, proj_key)


# (client, project) pairs already hydrated this process. Shared across threads,
# so a tiny lock guards the set; the actual pull is best-effort.
_HYDRATED: set[tuple[str, str]] = set()
_HYDRATE_LOCK = threading.Lock()


def hydrate(client_key: str, proj_key: str, staging_root: Path, force: bool = False) -> None:
    """Pull this (client, project)'s R2 subtree into staging once per process.

    Manifests + config are pulled SYNCHRONOUSLY (a handful of small files — the
    UI needs them to render regions). Refs/outputs (potentially thousands of
    PNGs) are pulled in a BACKGROUND thread so the server starts listening
    immediately instead of blocking boot for minutes (which would trip
    Railway's healthcheck).

    `force=True` (used on a runtime context SWITCH) re-pulls even a (c,p)
    already hydrated this process, so the new context's freshest manifests are
    in staging before it's served."""
    key = (client_key, proj_key)
    with _HYDRATE_LOCK:
        if key in _HYDRATED and not force:
            return
        _HYDRATED.add(key)
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
    """Set THIS thread's active (client, project) and, if changed, re-hydrate
    its staging from R2. Returns the fresh resolve() dict on a real switch, else
    None.

    Resolution/validation lives in set_context(); because the context is
    thread-local, a concurrent request on another thread can't observe this
    thread's switch — no global lock is needed around the switch itself."""
    if not set_context(client, project):
        return None
    pp = resolve()  # rebuilds paths/prefix for the new (c,p) + mkdir's them
    hydrate(
        _safe_proj_name(client_name()),
        _safe_proj_name(project_name()),
        pp["staging_root"],
        force=True,
    )
    return pp


# Back-compat: old single-key entrypoint maps onto the current client.
def switch_project(key: str) -> dict | None:
    return switch_context(client_name(), key)


# Compatibility no-ops for callers that import these from project_paths.
def list_projects() -> list[str]:
    return [project_name()]


def project_root() -> Path | None:
    return None
