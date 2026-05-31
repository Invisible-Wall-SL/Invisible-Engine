"""Shared ComfyUI client headers — the Cloudflare 403 avoidance fix.

Single source of truth for talking to the remote ComfyUI tunnel:

  - ``USER_AGENT`` — Cloudflare blocks Python-urllib's default UA with a 403, so
    EVERY ComfyUI HTTP call must send this custom User-Agent.
  - ``comfy_url()`` — the full tunnel base URL from the ``COMFY_URL`` env var.
  - ``cf_headers()`` — the non-blocked User-Agent + the Cloudflare Access
    service-token headers (``CF-Access-Client-Id`` / ``CF-Access-Client-Secret``)
    read from env.

The atlas-tool's ``cloud_paths`` re-exports these and feeds them into
``resolve()`` (``comfy_url`` / ``cf_headers`` keys), which ``batch_atlas.py``
consumes — so this module is the one place the UA + CF headers are defined.
"""
from __future__ import annotations

import os

# Cloudflare blocks Python-urllib's default UA → 403; this one is allowed.
USER_AGENT = "InvisibleAtlas/1.0"


def comfy_url() -> str:
    """The full ComfyUI tunnel base URL from env (no trailing slash)."""
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
