"""Canonical R2 prefix helpers for atlas-backend.

Standalone (no iw_common import) so this dormant service stays self-contained.
Mirrors the rest of the platform's path scheme:

  - tool namespace fixed to `atlas_maker`
  - R2 layout: `atlas_maker/<client>/<project>/...` (Option B client isolation)
  - slug contract: `^[a-z0-9][a-z0-9_-]{0,63}$`
  - env precedence (same as atlas-tool/cloud_paths):
      IW_CLIENT_NAME / IW_PROJECT_NAME  (launcher-pinned, win first)
      ATLAS_CLIENT   / ATLAS_PROJECT    (service defaults)
      "unassigned"   / "cloud"          (hard fallbacks)
"""
from __future__ import annotations

import os
import re

TOOL_NAMESPACE = "atlas_maker"
UNASSIGNED_CLIENT = "unassigned"
PROJECT_DEFAULT = "cloud"

PROJECT_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def _valid_slug(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    return value if PROJECT_SLUG_RE.match(value) else None


def env_client() -> str:
    """IW_CLIENT_NAME (launcher) > ATLAS_CLIENT > unassigned."""
    return (
        _valid_slug(os.environ.get("IW_CLIENT_NAME"))
        or _valid_slug(os.environ.get("ATLAS_CLIENT"))
        or UNASSIGNED_CLIENT
    )


def env_project() -> str:
    """IW_PROJECT_NAME (launcher) > ATLAS_PROJECT > cloud."""
    return (
        _valid_slug(os.environ.get("IW_PROJECT_NAME"))
        or _valid_slug(os.environ.get("ATLAS_PROJECT"))
        or PROJECT_DEFAULT
    )


def resolve_client(client: str | None) -> str:
    return _valid_slug(client) or env_client()


def resolve_project(project: str | None) -> str:
    return _valid_slug(project) or env_project()


def project_prefix(client: str | None, project: str | None) -> str:
    """`atlas_maker/<client>/<project>` — mirrors the launcher's projectPrefix
    and the tools' prefix_for_tool('atlas_maker', client, project)."""
    return f"{TOOL_NAMESPACE}/{resolve_client(client)}/{resolve_project(project)}"


def safe_key(key: str) -> str:
    """Defensive guard for caller-supplied R2 read keys: reject traversal and
    absolute keys. Returns the key unchanged when safe."""
    if not key or key.startswith("/") or ".." in key.split("/"):
        raise ValueError(f"Unsafe R2 key: {key!r}")
    return key


def safe_output_prefix(prefix: str) -> str:
    """Constrain a caller-chosen output prefix to the atlas_maker namespace and
    reject traversal / absolute prefixes. Returns it unchanged when safe."""
    if not prefix or prefix.startswith("/") or ".." in prefix.split("/"):
        raise ValueError(f"Unsafe output prefix: {prefix!r}")
    if not (prefix == TOOL_NAMESPACE or prefix.startswith(TOOL_NAMESPACE + "/")):
        raise ValueError(f"Output prefix must be under '{TOOL_NAMESPACE}/': {prefix!r}")
    return prefix
