"""Canonical R2 prefix helpers for atlas-backend.

Standalone (no iw_common import) so this dormant service stays self-contained.
Mirrors the rest of the platform's path scheme:

  - R2 layout: `<client>/<project>/...` (unified single-project repo — no
    `<tool>/` segment; client/project isolation preserved at the root)
  - slug: `r2_slug` (lowercase, non-alphanumerics -> `_`, 60-char cap) — byte-
    identical to `iw_common.context.r2_slug`, the tools, and the launcher
  - env precedence (same as atlas-tool/cloud_paths):
      IW_CLIENT_NAME / IW_PROJECT_NAME  (launcher-pinned, win first)
      ATLAS_CLIENT   / ATLAS_PROJECT    (service defaults)
      "unassigned"   / "cloud"          (hard fallbacks)
"""
from __future__ import annotations

import os
import re

UNASSIGNED_CLIENT = "unassigned"
PROJECT_DEFAULT = "cloud"

PROJECT_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def r2_slug(name: str | None) -> str:
    """Canonical R2 slug, identical to iw_common.context.r2_slug."""
    return re.sub(r"[^a-z0-9]", "_", (name or "default").lower())[:60] or "default"


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
    """`<client>/<project>` (unified repo) — mirrors the launcher's projectPrefix
    and the tools' project_prefix. Slugged via r2_slug so hyphenated keys map to
    the same prefix everywhere."""
    return f"{r2_slug(resolve_client(client))}/{r2_slug(resolve_project(project))}"


def safe_key(key: str) -> str:
    """Defensive guard for caller-supplied R2 read keys: reject traversal and
    absolute keys. Returns the key unchanged when safe."""
    if not key or key.startswith("/") or ".." in key.split("/"):
        raise ValueError(f"Unsafe R2 key: {key!r}")
    return key


def safe_output_prefix(prefix: str) -> str:
    """Constrain a caller-chosen output prefix: reject traversal / absolute
    prefixes. Returns it unchanged when safe. (No tool-namespace constraint in
    the unified layout — callers scope to their `<client>/<project>/` tree.)"""
    if not prefix or prefix.startswith("/") or ".." in prefix.split("/"):
        raise ValueError(f"Unsafe output prefix: {prefix!r}")
    return prefix
