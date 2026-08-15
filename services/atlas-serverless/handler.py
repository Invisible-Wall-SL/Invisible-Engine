"""RunPod Serverless handler for the Atlas Maker ComfyUI worker.

Job contract (compatible with runpod-worker-comfy):

    input = {
        "workflow": { ... },                 # a ComfyUI /prompt "prompt" graph (API format)
        "images":  [ {"name": "...", "image": "<base64>"} ]   # optional LoadImage refs
    }

Returns:  { "images": [ {"filename": "...", "image": "<base64>"} ] }
   or:    { "error": "...", "detail": ... }

This handler OWNS the ComfyUI process: it starts it, waits for readiness, and
RESTARTS it before every job after the first. The restart is deliberate — some
blueprint nodes (e.g. comfyui_controlnet_aux's DepthAnything) load models through a
HuggingFace `transformers` pipeline that lives OUTSIDE ComfyUI's memory manager, so
ComfyUI's own /free can't release them and VRAM accumulates across jobs on a warm
worker until it OOMs on a 24 GB card. A fresh process per job guarantees a clean GPU.
ComfyUI reads models from the attached Network Volume via the /ComfyUI/models symlink
set up in start.sh.
"""
from __future__ import annotations

import base64
import io
import os
import subprocess
import time
import uuid

import requests
import runpod

COMFY = "http://127.0.0.1:8188"
READY_TIMEOUT = 600      # ComfyUI (re)start: load nodes before a job can run
JOB_TIMEOUT = 1800       # a single generation
COMFY_CMD = ["python", "-u", "/ComfyUI/main.py",
             "--listen", "127.0.0.1", "--port", "8188", "--disable-auto-launch"]
# Between jobs, restart ComfyUI (dropping its cache) only when free VRAM falls below
# this fraction of total — otherwise keep it warm so the execution cache (model load,
# PuLID encode, depth preprocess) carries across variants. Tunable per-endpoint via
# the RESTART_VRAM_FRACTION env var, no rebuild needed. Higher = restart more (safer);
# lower = keep warm more (faster). 0.6 suits a 24 GB card with this heavy blueprint.
RESTART_VRAM_FRACTION = float(os.environ.get("RESTART_VRAM_FRACTION", "0.6"))

_comfy_proc: subprocess.Popen | None = None
_jobs_done = 0


def _start_comfy() -> None:
    global _comfy_proc
    _comfy_proc = subprocess.Popen(COMFY_CMD)


def _stop_comfy() -> None:
    """Kill ComfyUI; its CUDA context dies with the process, freeing ALL VRAM."""
    global _comfy_proc
    if _comfy_proc is not None:
        try:
            _comfy_proc.terminate()
            try:
                _comfy_proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                _comfy_proc.kill()
                _comfy_proc.wait(timeout=15)
        except Exception:  # noqa: BLE001
            pass
        _comfy_proc = None


def _wait_for_comfy(timeout: int = READY_TIMEOUT) -> None:
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        try:
            if requests.get(f"{COMFY}/system_stats", timeout=5).status_code == 200:
                return
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(2)
    raise RuntimeError(f"ComfyUI did not become ready in {timeout}s ({last})")


def _restart_comfy() -> None:
    """Fresh ComfyUI process = fully released VRAM (incl. non-ComfyUI-managed models)."""
    _stop_comfy()
    _start_comfy()
    _wait_for_comfy()


def _vram_free_fraction() -> float | None:
    """Fraction (0..1) of GPU VRAM currently free per ComfyUI, or None if unknown."""
    try:
        stats = requests.get(f"{COMFY}/system_stats", timeout=10).json()
        dev = (stats.get("devices") or [{}])[0] or {}
        total = float(dev.get("vram_total") or 0)
        free = float(dev.get("vram_free") or 0)
        if total > 0:
            return free / total
    except Exception:  # noqa: BLE001
        pass
    return None


def _maybe_restart_comfy() -> None:
    """Restart ComfyUI only when VRAM is low enough to risk an OOM on the next job.
    With headroom we keep it warm so the execution cache carries across variants (big
    speedup on roomy GPUs). If free VRAM is unknown, restart to stay safe."""
    frac = _vram_free_fraction()
    if frac is None or frac < RESTART_VRAM_FRACTION:
        _restart_comfy()


def _upload_image(name: str, b64: str) -> None:
    data = base64.b64decode(b64)
    files = {"image": (name, io.BytesIO(data), "image/png")}
    r = requests.post(f"{COMFY}/upload/image", files=files,
                      data={"overwrite": "true"}, timeout=120)
    r.raise_for_status()


def _queue(workflow: dict, client_id: str) -> str:
    r = requests.post(f"{COMFY}/prompt",
                      json={"prompt": workflow, "client_id": client_id}, timeout=60)
    if r.status_code != 200:
        # ComfyUI returns a helpful JSON error body (e.g. missing node / bad input).
        raise RuntimeError(f"/prompt rejected ({r.status_code}): {r.text[:800]}")
    return r.json()["prompt_id"]


def _await_result(prompt_id: str, timeout: int = JOB_TIMEOUT) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = requests.get(f"{COMFY}/history/{prompt_id}", timeout=30).json()
        if prompt_id in h:
            return h[prompt_id]
        time.sleep(1)
    raise RuntimeError(f"generation timed out after {timeout}s")


def _collect_images(hist: dict) -> list[dict]:
    out: list[dict] = []
    for node_out in hist.get("outputs", {}).values():
        for img in node_out.get("images", []):
            params = {
                "filename": img["filename"],
                "subfolder": img.get("subfolder", ""),
                "type": img.get("type", "output"),
            }
            data = requests.get(f"{COMFY}/view", params=params, timeout=120).content
            out.append({"filename": img["filename"],
                        "image": base64.b64encode(data).decode()})
    return out


def handler(job: dict) -> dict:
    global _jobs_done
    inp = job.get("input") or {}
    workflow = inp.get("workflow")
    if not workflow:
        return {"error": "input.workflow is required"}

    # Every job after the first gets a fresh ComfyUI so VRAM from the previous job
    # (including transformers-loaded models ComfyUI can't free) is fully released.
    if _jobs_done > 0:
        try:
            _maybe_restart_comfy()
        except Exception as e:  # noqa: BLE001
            return {"error": f"ComfyUI restart failed: {e}"}
    _jobs_done += 1

    try:
        for im in inp.get("images", []) or []:
            _upload_image(im["name"], im["image"])
        client_id = str(uuid.uuid4())
        prompt_id = _queue(workflow, client_id)
        hist = _await_result(prompt_id)
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}

    status = hist.get("status", {})
    if status.get("status_str") == "error":
        return {"error": "comfy execution error", "detail": status}

    images = _collect_images(hist)
    if not images:
        return {"error": "generation produced no images", "detail": status}
    return {"images": images}


# Start ComfyUI, wait until it answers, then serve.
_start_comfy()
_wait_for_comfy()
runpod.serverless.start({"handler": handler})
