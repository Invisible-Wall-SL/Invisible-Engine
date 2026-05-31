"""Shared ComfyUI client — the Cloudflare 403 avoidance fix + submit/poll client.

Single source of truth for talking to the remote ComfyUI tunnel:

  - ``USER_AGENT`` — Cloudflare blocks Python-urllib's default UA with a 403, so
    EVERY ComfyUI HTTP call must send this custom User-Agent.
  - ``comfy_url()`` — the full tunnel base URL from the ``COMFY_URL`` env var.
  - ``cf_headers()`` — the non-blocked User-Agent + the Cloudflare Access
    service-token headers (``CF-Access-Client-Id`` / ``CF-Access-Client-Secret``)
    read from env.

The atlas-tool's ``cloud_paths`` re-exports the header helpers and feeds them
into ``resolve()`` (``comfy_url`` / ``cf_headers`` keys), which ``batch_atlas.py``
consumes — so this module is the one place the UA + CF headers are defined.

The submit/poll/upload/fetch client below (used by atlas-backend) routes every
request through ``cf_headers()`` so the production-critical UA + CF headers stay
single-sourced even for the richer client wrappers.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

# Cloudflare blocks Python-urllib's default UA → 403; this one is allowed.
USER_AGENT = "InvisibleAtlas/1.0"


class ComfyError(Exception):
    pass


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


def _json_headers() -> dict[str, str]:
    """``cf_headers()`` plus a JSON Content-Type (for POST /prompt etc.)."""
    return {"Content-Type": "application/json", **cf_headers()}


# --------------------------------------------------------------------------
# Submit / poll / upload / fetch client (used by atlas-backend)
# --------------------------------------------------------------------------
def upload_image(base: str, filename: str, data: bytes, image_type: str = "input") -> str:
    """Upload bytes to ComfyUI's input dir (POST /upload/image, multipart) so a
    LoadImage node can reference them. Returns the name to use in LoadImage."""
    import requests  # local import; only needed for multipart

    resp = requests.post(
        base.rstrip("/") + "/upload/image",
        files={"image": (filename, data, "application/octet-stream")},
        data={"type": image_type, "overwrite": "true"},
        headers=cf_headers(),
        timeout=60,
    )
    resp.raise_for_status()
    j = resp.json()
    name = j["name"]
    if j.get("subfolder"):
        name = f"{j['subfolder']}/{name}"
    return name


def _get(base: str, path: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(base.rstrip("/") + path, headers=cf_headers())
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def system_stats(base: str) -> dict:
    return json.loads(_get(base, "/system_stats"))


def submit_prompt(base: str, graph: dict, extra_data: dict | None = None) -> str:
    payload: dict = {"prompt": graph}
    if extra_data:
        payload["extra_data"] = extra_data
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        base.rstrip("/") + "/prompt", data=data, headers=_json_headers(), method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        raise ComfyError(f"ComfyUI rejected the workflow ({e.code}): {detail}")
    pid = body.get("prompt_id")
    if not pid:
        raise ComfyError(f"No prompt_id in response: {body}")
    return pid


def wait_images(base: str, prompt_id: str, timeout: int = 600) -> list[dict]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        hist = json.loads(_get(base, f"/history/{prompt_id}"))
        entry = hist.get(prompt_id)
        if entry:
            images: list[dict] = []
            for node in entry.get("outputs", {}).values():
                images.extend(node.get("images", []))
            if images:
                return images
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                raise ComfyError(f"ComfyUI reported an error: {status}")
        time.sleep(2)
    raise ComfyError("Timed out waiting for ComfyUI generation")


def fetch_image(base: str, image: dict) -> bytes:
    q = urllib.parse.urlencode(
        {
            "filename": image["filename"],
            "subfolder": image.get("subfolder", ""),
            "type": image.get("type", "output"),
        }
    )
    return _get(base, "/view?" + q, timeout=60)
