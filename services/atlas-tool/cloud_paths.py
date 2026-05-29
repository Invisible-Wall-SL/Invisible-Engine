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
from pathlib import Path

import storage

STAGING_BASE = Path(os.environ.get("ATLAS_STAGING", "/tmp/atlas-tool"))
TOOL_NAMESPACE = "atlas_maker"
USER_AGENT = "InvisibleAtlas/1.0"  # Cloudflare blocks Python-urllib's default UA


def _safe_proj_name(name: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in (name or "default"))[:60]


def project_name() -> str:
    return (os.environ.get("IW_PROJECT_NAME") or "").strip() or os.environ.get(
        "ATLAS_PROJECT", "cloud"
    )


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


def hydrate(proj_key: str, staging_root: Path) -> None:
    """Pull this project's whole R2 subtree into staging once per process."""
    if proj_key in _HYDRATED:
        return
    _HYDRATED.add(proj_key)
    prefix = r2_project_prefix(proj_key)
    try:
        storage.pull_prefix(prefix + "/", staging_root, prefix + "/")
    except Exception:  # noqa: BLE001 — first run / empty bucket is fine
        pass


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


# Compatibility no-ops for callers that import these from project_paths.
def list_projects() -> list[str]:
    return [project_name()]


def project_root() -> Path | None:
    return None
