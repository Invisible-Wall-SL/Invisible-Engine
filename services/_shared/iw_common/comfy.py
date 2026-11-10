"""Shared ComfyUI client — headers, JSON calls, and reading a prompt's history.

Single source of truth for talking to a ComfyUI, whether over the Cloudflare
tunnel (the atlas-tool) or on localhost inside the RunPod worker
(``services/atlas-serverless/handler.py``):

  - ``USER_AGENT`` — Cloudflare blocks Python-urllib's default UA with a 403, so
    EVERY ComfyUI HTTP call must send this custom User-Agent.
  - ``comfy_url()`` — the full tunnel base URL from the ``COMFY_URL`` env var.
  - ``cf_headers(env)`` — the non-blocked User-Agent + the Cloudflare Access
    service-token headers (``CF-Access-Client-Id`` / ``CF-Access-Client-Secret``)
    read from ``env`` (the process environment by default).
  - ``routed_headers(base, comfy_env)`` — the headers a render started with
    per-user ``comfy_env`` overrides sends (per-user-comfyui-routing.md).
  - ``get_json`` / ``post_json`` / ``history_entry`` — stdlib (urllib) calls.
  - ``execution_error`` / ``describe_execution_error`` — the failure ComfyUI
    records in a history entry's ``status``.

STDLIB ONLY. The RunPod worker image carries this module beside ``handler.py``
(CI copies it into that build context), so nothing here may import a package
the worker does not install, nor another ``iw_common`` module.
"""
from __future__ import annotations

import json
import os
from collections.abc import Mapping
from urllib.request import Request, urlopen

# Cloudflare blocks Python-urllib's default UA → 403; this one is allowed.
USER_AGENT = "InvisibleAtlas/1.0"


def comfy_url() -> str:
    """The full ComfyUI tunnel base URL from env (no trailing slash)."""
    base = (os.environ.get("COMFY_URL") or "").strip()
    return base.rstrip("/")


def cf_headers(env: Mapping[str, str] | None = None) -> dict[str, str]:
    """Cloudflare Access service-token headers + a non-blocked User-Agent, from
    `env` (default: the process environment). The token goes out only when BOTH
    halves are set and non-empty."""
    env = os.environ if env is None else env
    h = {"User-Agent": USER_AGENT}
    cid = env.get("CF_ACCESS_CLIENT_ID")
    sec = env.get("CF_ACCESS_CLIENT_SECRET")
    if cid and sec:
        h["CF-Access-Client-Id"] = cid
        h["CF-Access-Client-Secret"] = sec
    return h


def routed_headers(base: Mapping[str, str], comfy_env: Mapping[str, str]) -> dict[str, str]:
    """The headers a render started with `comfy_env` (its env overrides) sends.

    Without a per-user `COMFY_URL` the shared `base` headers apply unchanged.
    With one, the shared CF Access token is DROPPED — it must never reach
    another origin — and each per-user half that is set takes its place."""
    headers = dict(base)
    if "COMFY_URL" in comfy_env:
        headers = {k: v for k, v in headers.items()
                   if not k.lower().startswith("cf-access")}
        if comfy_env.get("CF_ACCESS_CLIENT_ID"):
            headers["CF-Access-Client-Id"] = comfy_env["CF_ACCESS_CLIENT_ID"]
        if comfy_env.get("CF_ACCESS_CLIENT_SECRET"):
            headers["CF-Access-Client-Secret"] = comfy_env["CF_ACCESS_CLIENT_SECRET"]
    return headers


def get_json(url: str, headers: Mapping[str, str], timeout: float) -> dict:
    """One GET, its body parsed as JSON. HTTP and network errors propagate
    (`HTTPError` / `URLError` / `TimeoutError`) for the caller to word."""
    return json.loads(urlopen(Request(url, headers=dict(headers)), timeout=timeout).read())


def post_json(url: str, payload: object, headers: Mapping[str, str], timeout: float) -> dict:
    """One JSON POST, the answer parsed as JSON. Errors propagate as in `get_json`."""
    req = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
    )
    return json.loads(urlopen(req, timeout=timeout).read())


def history_entry(base: str, prompt_id: str, headers: Mapping[str, str],
                  timeout: float) -> dict | None:
    """The `/history/<prompt_id>` entry, or None while ComfyUI has not finished it."""
    return get_json(f"{base}/history/{prompt_id}", headers, timeout).get(prompt_id)


def execution_error(status: Mapping | None) -> dict | None:
    """The data of the first `execution_error` event in a history entry's
    `status`, or None when there is none.

    ComfyUI records a failed prompt as an `["execution_error", {...}]` pair under
    `status.messages` (`node_type`, `node_id`, `exception_type`,
    `exception_message`, …); everything else there is bookkeeping. A malformed
    entry is skipped rather than trusted."""
    for entry in (status or {}).get("messages") or []:
        if not (isinstance(entry, (list, tuple)) and len(entry) == 2):
            continue
        kind, data = entry
        if kind == "execution_error" and isinstance(data, dict):
            return data
    return None


def describe_execution_error(status: Mapping | None) -> str:
    """The one line an author can act on: `<node_type> #<id>: <ExceptionType>: <message>`,
    or "" when the status records no execution error.

    The message is whitespace-collapsed and capped because the Atlas Maker keeps
    400 characters of an error, and the node name has to survive ahead of a
    traceback-sized message."""
    data = execution_error(status)
    if data is None:
        return ""
    node = str(data.get("node_type") or "?")
    node_id = str(data.get("node_id") or "")
    exc = str(data.get("exception_type") or "").rsplit(".", 1)[-1]
    msg = " ".join(str(data.get("exception_message") or "").split())[:240]
    where = f"{node} #{node_id}" if node_id else node
    return f"{where}: {exc}: {msg}" if exc else f"{where}: {msg}"
