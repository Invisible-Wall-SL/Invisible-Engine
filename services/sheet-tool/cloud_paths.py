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
`atlas_maker_manifest_prefix`. `atlas_maker_dir` is None in the cloud (no
sibling folder); handoff happens over R2 instead.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import storage

STAGING_BASE = Path(os.environ.get("SHEET_STAGING", "/tmp/sheet-tool"))
TOOL_NAMESPACE = "sheet_maker"
# The cloud Atlas Maker's R2 prefix (so an authored manifest can be handed off).
ATLAS_NAMESPACE = "atlas_maker"

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
        "SHEET_PROJECT", "cloud"
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


def r2_project_prefix(proj_key: str) -> str:
    return f"{TOOL_NAMESPACE}/cloud/{proj_key}"


def atlas_maker_manifest_prefix(proj_key: str) -> str:
    """Where the cloud Atlas Maker reads its manifests for the same project."""
    return f"{ATLAS_NAMESPACE}/cloud/{proj_key}/manifests"


_HYDRATED: set[str] = set()


def hydrate(proj_key: str, staging_root: Path, force: bool = False) -> None:
    """Pull this project's R2 subtree into staging once per process.

    Outputs (coords/manifests, small) pull synchronously so the sheet list
    renders immediately; uploaded sprites (potentially many PNGs) pull in a
    background thread so the server starts listening straight away instead of
    blocking boot (which would trip Railway's healthcheck).

    `force=True` (used on a runtime project SWITCH) re-pulls even a project
    already hydrated this process, so the new project's freshest sheets are in
    staging before it's served."""
    if proj_key in _HYDRATED and not force:
        return
    _HYDRATED.add(proj_key)
    base = r2_project_prefix(proj_key)
    kr = base + "/"

    # Synchronous: output coords/manifests (small, needed for the sheet list).
    try:
        storage.pull_prefix(base + "/output/", staging_root, kr)
    except Exception:  # noqa: BLE001 — first run / empty bucket is fine
        pass

    # Background: uploaded sprite PNGs (potentially many, only needed to edit).
    import threading

    def _bg() -> None:
        try:
            storage.pull_prefix(base + "/input/", staging_root, kr)
        except Exception:  # noqa: BLE001
            pass

    threading.Thread(target=_bg, name="sheet-hydrate", daemon=True).start()


def resolve() -> dict:
    proj = project_name()
    proj_key = _safe_proj_name(proj)

    staging_root = STAGING_BASE / proj_key
    input_dir = staging_root / "input"        # uploaded loose PNGs (per sheet subdir)
    output_root = staging_root / "output"     # packed sheet + coords + manifest

    # Pull existing state from R2 before the tool reads it.
    hydrate(proj_key, staging_root)

    for d in (input_dir, output_root):
        try:
            d.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass

    return {
        "project": proj,
        "project_key": proj_key,
        "project_root": None,
        "input_dir": input_dir,
        "output_root": output_root,
        # No sibling folder in the cloud; manifest handoff goes over R2.
        "atlas_maker_dir": None,
        "r2_project_prefix": r2_project_prefix(proj_key),
        "atlas_maker_manifest_prefix": atlas_maker_manifest_prefix(proj_key),
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


def atlas_maker_dir() -> Path | None:
    return None
