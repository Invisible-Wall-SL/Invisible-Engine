"""Cloud drop-in replacement for project_paths.py (Invisible Sheet Maker).

Same `resolve()` dict shape the tool already consumes, but:
  - input_dir / output_root point at a local *staging* directory (ephemeral
    container disk) so all existing pathlib/PIL code is unchanged;
  - the staging tree mirrors an R2 prefix 1:1 (see storage.py) so state
    survives container restarts.

The Sheet Maker is pure Pillow/CPU — it does NOT drive ComfyUI. It packs loose
sprite PNGs into a sheet and writes a `.atlas` / TexturePacker JSON / the
Invisible AI manifest. In the cloud the authored manifest is also dropped into
the cloud Atlas Maker's R2 prefix (`atlas_maker_manifest_prefix`) so it shows
up in that tool's manifest list after a restart.

Extra keys added to resolve(): `r2_project_prefix`, `staging_root`,
`atlas_maker_manifest_prefix`, `client`. `atlas_maker_dir` is None in the
cloud (no sibling folder); handoff happens over R2 instead.

**Client isolation (Option B):** R2 layout is `<tool>/<client>/<project>/...`.

**Concurrency (request-local context):** the server is a ThreadingHTTPServer
(one thread per request), so the active (client, project) is held in a
`threading.local()` — thread-local == request-local. `set_context` /
`switch_context` write the CALLING thread's local; `resolve()` reads the calling
thread's state (env defaults if unset). Two concurrent requests for different
projects each see their own context; reads are lock-free. The staging tree is
keyed by (client, project) so their local-disk trees never collide.
"""
from __future__ import annotations

import os
import re
import threading
from pathlib import Path

import storage

STAGING_BASE = Path(os.environ.get("SHEET_STAGING", "/tmp/sheet-tool"))
TOOL_NAMESPACE = "sheet_maker"
# The cloud Atlas Maker's R2 prefix (so an authored manifest can be handed off).
ATLAS_NAMESPACE = "atlas_maker"

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
    """Same slug rule as projects; alias kept for caller clarity."""
    if key and PROJECT_SLUG_RE.match(key):
        return key
    return None


def _safe_proj_name(name: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in (name or "default"))[:60]


def env_project() -> str:
    """The default project from env (used until set_context() overrides it)."""
    return (os.environ.get("IW_PROJECT_NAME") or "").strip() or os.environ.get(
        "SHEET_PROJECT", "cloud"
    )


def env_client() -> str:
    """The default client from env (used until set_context() overrides it).

    Order: `IW_CLIENT_NAME` (launcher-pinned) -> `SHEET_CLIENT` -> `unassigned`.
    """
    return (os.environ.get("IW_CLIENT_NAME") or "").strip() or os.environ.get(
        "SHEET_CLIENT", UNASSIGNED_CLIENT
    )


# Request-local context. Under ThreadingHTTPServer each request runs on its own
# thread, so a thread-local store is effectively a per-request store. A thread
# that has not set a context falls back to the env defaults (see _ctx_get()).
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
    this thread."""
    cur_client, cur_project = _ctx_get()
    new_client = valid_client((client or "").strip()) or env_client()
    new_project = valid_project((project or "").strip()) or env_project()
    if new_client == cur_client and new_project == cur_project:
        return False
    _ctx.client = new_client
    _ctx.project = new_project
    return True


# Back-compat alias.
def set_project(key: str) -> bool:
    return set_context(client_name(), key)


def prefix_for_tool(tool: str, client: str, project: str) -> str:
    """Canonical R2 prefix for any tool. Single source of truth used both
    internally and for the Sheet->Atlas manifest handoff."""
    return f"{tool}/{client}/{project}"


def r2_project_prefix(client_key: str, proj_key: str) -> str:
    return prefix_for_tool(TOOL_NAMESPACE, client_key, proj_key)


def atlas_maker_manifest_prefix(client_key: str, proj_key: str) -> str:
    """Where the cloud Atlas Maker reads its manifests for the same (c, p)."""
    return f"{prefix_for_tool(ATLAS_NAMESPACE, client_key, proj_key)}/manifests"


# (client, project) pairs already hydrated this process. Shared across threads,
# so a tiny lock guards the set; the actual pull is best-effort.
_HYDRATED: set[tuple[str, str]] = set()
_HYDRATE_LOCK = threading.Lock()


def hydrate(client_key: str, proj_key: str, staging_root: Path, force: bool = False) -> None:
    """Pull this (client, project)'s R2 subtree into staging once per process.

    Outputs (coords/manifests, small) pull synchronously so the sheet list
    renders immediately; uploaded sprites (potentially many PNGs) pull in a
    background thread so the server starts listening straight away instead of
    blocking boot (which would trip Railway's healthcheck)."""
    key = (client_key, proj_key)
    with _HYDRATE_LOCK:
        if key in _HYDRATED and not force:
            return
        _HYDRATED.add(key)
    base = r2_project_prefix(client_key, proj_key)
    kr = base + "/"

    # Synchronous: output coords/manifests (small, needed for the sheet list).
    try:
        storage.pull_prefix(base + "/output/", staging_root, kr)
    except Exception:  # noqa: BLE001 — first run / empty bucket is fine
        pass

    # Background: uploaded sprite PNGs (potentially many, only needed to edit).
    def _bg() -> None:
        try:
            storage.pull_prefix(base + "/input/", staging_root, kr)
        except Exception:  # noqa: BLE001
            pass

    threading.Thread(target=_bg, name="sheet-hydrate", daemon=True).start()


def resolve() -> dict:
    proj = project_name()
    client = client_name()
    proj_key = _safe_proj_name(proj)
    client_key = _safe_proj_name(client)

    staging_root = STAGING_BASE / client_key / proj_key
    input_dir = staging_root / "input"        # uploaded loose PNGs (per sheet subdir)
    output_root = staging_root / "output"     # packed sheet + coords + manifest

    # Pull existing state from R2 before the tool reads it.
    hydrate(client_key, proj_key, staging_root)

    for d in (input_dir, output_root):
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
        # No sibling folder in the cloud; manifest handoff goes over R2.
        "atlas_maker_dir": None,
        "r2_project_prefix": r2_project_prefix(client_key, proj_key),
        "atlas_maker_manifest_prefix": atlas_maker_manifest_prefix(client_key, proj_key),
        "staging_root": staging_root,
    }


def switch_context(client: str | None, project: str | None) -> dict | None:
    """Set THIS thread's active (client, project) and, if changed, re-hydrate
    its staging from R2. Returns the fresh resolve() dict on a real switch, else
    None. Thread-local context means no global lock is needed around the
    switch."""
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


def atlas_maker_dir() -> Path | None:
    return None
