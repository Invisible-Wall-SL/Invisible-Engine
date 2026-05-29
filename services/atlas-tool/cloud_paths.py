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
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import storage

STAGING_BASE = Path(os.environ.get("ATLAS_STAGING", "/tmp/atlas-tool"))
TOOL_NAMESPACE = "atlas_maker"
USER_AGENT = "InvisibleAtlas/1.0"  # Cloudflare blocks Python-urllib's default UA

# Shared contract with the launcher: a project key is a slug; "cloud" is the
# default / pre-existing key.
PROJECT_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def valid_project(key: str | None) -> str | None:
    """Return the key if it matches the shared slug contract, else None."""
    if key and PROJECT_SLUG_RE.match(key):
        return key
    return None


def _safe_proj_name(name: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in (name or "default"))[:60]


def env_project() -> str:
    """The default project from env (used until set_project() overrides it)."""
    return (os.environ.get("IW_PROJECT_NAME") or "").strip() or os.environ.get(
        "ATLAS_PROJECT", "cloud"
    )


# Current project for this process. Defaults to env; set_project() switches it
# at runtime (project-centric mode). Kept as module state so every resolve() —
# and thus every path other modules read — reflects the switch.
_CURRENT_PROJECT: str = env_project()


def project_name() -> str:
    return _CURRENT_PROJECT


def set_project(key: str) -> bool:
    """Switch the active project at runtime. Idempotent if unchanged.

    Validates against the slug contract (falls back to the env default for an
    invalid/empty key). Returns True if the project actually changed — the
    caller should then re-resolve paths and re-hydrate staging."""
    global _CURRENT_PROJECT
    chosen = valid_project((key or "").strip()) or env_project()
    if chosen == _CURRENT_PROJECT:
        return False
    _CURRENT_PROJECT = chosen
    return True


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


def r2_project_prefix(proj_key: str) -> str:
    return f"{TOOL_NAMESPACE}/cloud/{proj_key}"


_HYDRATED: set[str] = set()


def hydrate(proj_key: str, staging_root: Path, force: bool = False) -> None:
    """Pull this project's R2 subtree into staging once per process.

    Manifests + config are pulled SYNCHRONOUSLY (a handful of small files — the
    UI needs them to render regions). Refs/outputs (potentially thousands of
    PNGs) are pulled in a BACKGROUND thread so the server starts listening
    immediately instead of blocking boot for minutes (which would trip
    Railway's healthcheck).

    `force=True` (used on a runtime project SWITCH) re-pulls even a project
    already hydrated this process, so the new project's freshest manifests are
    in staging before it's served."""
    if proj_key in _HYDRATED and not force:
        return
    _HYDRATED.add(proj_key)
    base = r2_project_prefix(proj_key)
    kr = base + "/"

    # Synchronous: manifests + config (small, needed for first render).
    for sub in ("manifests/", "atlas_config.json"):
        try:
            storage.pull_prefix(base + "/" + sub, staging_root, kr)
        except Exception:  # noqa: BLE001 — first run / empty bucket is fine
            pass

    # Background: refs + outputs (large; only needed for thumbnails/generation).
    import threading

    def _bg() -> None:
        for sub in ("input/", "output/"):
            try:
                storage.pull_prefix(base + "/" + sub, staging_root, kr)
            except Exception:  # noqa: BLE001
                pass

    threading.Thread(target=_bg, name="atlas-hydrate", daemon=True).start()


def resolve() -> dict:
    prefix_name = os.environ.get("ATLAS_OUTPUT_PREFIX", "HotFruits")
    proj = project_name()
    proj_key = _safe_proj_name(proj)

    staging_root = STAGING_BASE / proj_key
    input_dir = staging_root / "input"
    output_root = staging_root / "output"
    batch_dir = output_root / prefix_name / "batch"
    atlas_dir = output_root / prefix_name / "atlas"
    manifest_dir = staging_root / "manifests"

    # Pull existing state from R2 before the tool reads it.
    hydrate(proj_key, staging_root)

    for d in (input_dir, batch_dir, atlas_dir, manifest_dir):
        try:
            d.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass

    return {
        "project": proj,
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
        "comfy_filename_prefix_base": f"{TOOL_NAMESPACE}/cloud/{proj_key}/{prefix_name}",
        "r2_project_prefix": r2_project_prefix(proj_key),
        "staging_root": staging_root,
    }


def switch_project(key: str) -> dict | None:
    """Set the active project and, if it changed, re-hydrate its staging from
    R2. Returns the fresh resolve() dict on a real switch, else None.

    Resolution/validation lives in set_project(); the caller (request handler)
    should guard this with its own lock so an interleaved request can't observe
    half-hydrated staging."""
    if not set_project(key):
        return None
    pp = resolve()  # rebuilds paths/prefix for the new project + mkdir's them
    hydrate(_safe_proj_name(project_name()), pp["staging_root"], force=True)
    return pp


# Compatibility no-ops for callers that import these from project_paths.
def list_projects() -> list[str]:
    return [project_name()]


def project_root() -> Path | None:
    return None
