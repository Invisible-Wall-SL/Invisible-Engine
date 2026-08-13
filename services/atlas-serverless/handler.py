"""RunPod Serverless handler for the Atlas Maker ComfyUI worker.

Job contract (compatible with runpod-worker-comfy):

    input = {
        "workflow": { ... },                 # a ComfyUI /prompt "prompt" graph (API format)
        "images":  [ {"name": "...", "image": "<base64>"} ]   # optional LoadImage refs
    }

Returns:  { "images": [ {"filename": "...", "image": "<base64>"} ] }
   or:    { "error": "...", "detail": ... }

ComfyUI runs locally in this container (started by start.sh) and reads models from the
attached Network Volume via /ComfyUI/extra_model_paths.yaml.
"""
from __future__ import annotations

import base64
import io
import time
import uuid

import requests
import runpod

COMFY = "http://127.0.0.1:8188"
READY_TIMEOUT = 600      # ComfyUI cold-start (load nodes) before first job
JOB_TIMEOUT = 1800       # a single generation


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
    inp = job.get("input") or {}
    workflow = inp.get("workflow")
    if not workflow:
        return {"error": "input.workflow is required"}

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


# ComfyUI is started in the background by start.sh; block until it answers, then serve.
_wait_for_comfy()
runpod.serverless.start({"handler": handler})
