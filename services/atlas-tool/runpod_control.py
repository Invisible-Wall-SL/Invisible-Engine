"""RunPod on-demand pod lifecycle (docs/design/runpod-comfyui-backend.md).

When RUNPOD_API_KEY + RUNPOD_POD_ID are set, the atlas-tool RESUMES the pod before
a render (waiting until ComfyUI answers) and STOPS it after RUNPOD_IDLE_MINUTES of
no renders — so the GPU only bills while work is happening. Everything is
FAIL-SAFE: any API/network error degrades to "just proceed" and never blocks or
crashes a render. When the env is unset every function is a no-op (behaves exactly
as before). Uses the RunPod GraphQL API + a plain ComfyUI readiness poll, stdlib
only."""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.request

_GQL = "https://api.runpod.io/graphql"
_UA = "InvisibleAtlas/1.0"
_last_activity = time.time()
_watchdog_started = False


def _key() -> str:
    return (os.environ.get("RUNPOD_API_KEY") or "").strip()


def _pod() -> str:
    return (os.environ.get("RUNPOD_POD_ID") or "").strip()


def enabled() -> bool:
    return bool(_key() and _pod())


def _idle_seconds() -> int:
    try:
        return max(60, int(float(os.environ.get("RUNPOD_IDLE_MINUTES", "10"))) * 60)
    except (TypeError, ValueError):
        return 600


def _gql(query: str) -> dict | None:
    """POST a GraphQL query to RunPod. Returns the parsed JSON or None on any
    error (caller treats None as 'unknown / proceed')."""
    try:
        req = urllib.request.Request(
            f"{_GQL}?api_key={_key()}",
            data=json.dumps({"query": query}).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": _UA},
        )
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8") or "{}")
    except Exception:  # noqa: BLE001 — any failure => unknown
        return None


def desired_status() -> str | None:
    """The pod's desiredStatus ('RUNNING' / 'EXITED' / …) or None if unknown."""
    d = _gql(f'query {{ pod(input:{{podId:"{_pod()}"}}) '
             f'{{ desiredStatus runtime {{ uptimeInSeconds }} }} }}')
    try:
        return d["data"]["pod"]["desiredStatus"]
    except Exception:  # noqa: BLE001
        return None


def _resume() -> None:
    _gql(f'mutation {{ podResume(input:{{podId:"{_pod()}", gpuCount:1}}) '
         f'{{ id desiredStatus }} }}')


def _stop() -> None:
    _gql(f'mutation {{ podStop(input:{{podId:"{_pod()}"}}) '
         f'{{ id desiredStatus }} }}')


def _comfy_up(url: str) -> bool:
    """True if ComfyUI answers /system_stats at `url`."""
    if not url:
        return False
    try:
        req = urllib.request.Request(
            url.rstrip("/") + "/system_stats", headers={"User-Agent": _UA})
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False


def mark_activity() -> None:
    global _last_activity
    _last_activity = time.time()


def ensure_pod_ready(comfy_url: str, log=lambda m: None,
                     timeout: float = 300.0) -> None:
    """Before a render: if the pod is stopped, resume it and wait until ComfyUI
    answers. Streams short status lines via `log`. No-op when not configured;
    never raises (fail-safe: on any error it just lets the render proceed)."""
    mark_activity()
    if not enabled():
        return
    url = (comfy_url or os.environ.get("COMFY_URL") or "").strip()
    try:
        if _comfy_up(url):
            return  # already warm
        if desired_status() != "RUNNING":
            log("Waking the GPU pod (on-demand) — this takes ~1–3 min…")
            _resume()
        else:
            log("Pod is on; waiting for ComfyUI to come up…")
        deadline = time.time() + timeout
        while time.time() < deadline:
            time.sleep(6)
            if _comfy_up(url):
                log("GPU pod ready — generating.")
                return
        log("Pod didn't answer in time — trying the render anyway (it will "
            "report if ComfyUI is unreachable).")
    except Exception:  # noqa: BLE001 — never block a render on lifecycle issues
        return


def start_idle_watchdog(is_rendering=lambda: False) -> None:
    """Start a background thread that STOPS the pod after RUNPOD_IDLE_MINUTES of
    no renders (and never while a render is running). Call once at server start.
    No-op when not configured."""
    global _watchdog_started
    if _watchdog_started or not enabled():
        return
    _watchdog_started = True

    def loop():
        while True:
            time.sleep(60)
            try:
                if is_rendering():
                    continue
                if time.time() - _last_activity < _idle_seconds():
                    continue
                if desired_status() == "RUNNING":
                    _stop()
                    mark_activity()  # reset so we don't hammer stop
            except Exception:  # noqa: BLE001
                pass

    threading.Thread(target=loop, daemon=True).start()
