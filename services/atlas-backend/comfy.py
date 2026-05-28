"""Thin ComfyUI HTTP client. Targets a configurable base URL (a Cloudflare
Tunnel to the user's local ComfyUI), with optional Cloudflare Access service-
token headers. Pure stdlib (urllib)."""
from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request


class ComfyError(Exception):
    pass


def _headers() -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    cid = os.environ.get("CF_ACCESS_CLIENT_ID")
    csec = os.environ.get("CF_ACCESS_CLIENT_SECRET")
    if cid and csec:
        h["CF-Access-Client-Id"] = cid
        h["CF-Access-Client-Secret"] = csec
    return h


def _get(base: str, path: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(base.rstrip("/") + path, headers=_headers())
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
        base.rstrip("/") + "/prompt", data=data, headers=_headers(), method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        body = json.loads(r.read())
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
