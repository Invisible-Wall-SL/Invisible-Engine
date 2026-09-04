"""RunPod Serverless handler for the Atlas Maker ComfyUI worker.

Job contract (compatible with runpod-worker-comfy):

    input = {
        "workflow": { ... },                 # a ComfyUI /prompt "prompt" graph (API format)
        "images":  [ {"name": "...", "image": "<base64>"} ],  # optional LoadImage refs
        "upload_urls": ["<presigned PUT>", ...]               # optional, see _collect_images
    }

Returns:  { "images": [ {"filename": "...", "slot": 0, "bytes": N} ] }   # uploaded
   or:    { "images": [ {"filename": "...", "image": "<base64>"} ] }     # inline
   or:    { "error": "...", "detail": ... }

`upload_urls` is what lifts RunPod's fixed payload cap: with them a render goes
straight to object storage and only its slot number comes back. Without them (an
older caller) everything works exactly as before, capped at ~20 MB.

This handler OWNS the ComfyUI process: it starts it, waits for readiness, and
RESTARTS it before every job after the first. The restart is deliberate — some
blueprint nodes (e.g. comfyui_controlnet_aux's DepthAnything) load models through a
HuggingFace `transformers` pipeline that lives OUTSIDE ComfyUI's memory manager, so
ComfyUI's own /free can't release them and VRAM accumulates across jobs on a warm
worker until it OOMs on a 24 GB card. A fresh process per job guarantees a clean GPU.
ComfyUI reads models from the attached Network Volume via the /ComfyUI/models symlink
set up in start.sh.

CANCELLATION needs two env vars on the endpoint — `RUNPOD_ENDPOINT_ID` and
`RUNPOD_API_KEY`. RunPod's `/cancel` marks a job cancelled but never interrupts a
synchronous handler, so without them a cancelled job renders to completion and bills
for it while the UI reports it stopped. With them, a running job asks RunPod whether
it is still wanted and stops itself when it is not. See `_job_cancelled`.
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
RUNPOD_API = "https://api.runpod.ai/v2"
# The commit this image was built from, stamped in by the Dockerfile. Printed at boot
# and attached to every error, because a serverless endpoint pinned to `:latest`
# caches by digest — a push to that tag need not roll the workers, and until this
# there was nothing in the container that could tell you which code was running.
WORKER_BUILD = os.environ.get("WORKER_BUILD") or "unknown"
READY_TIMEOUT = 600      # ComfyUI (re)start: load nodes before a job can run
# One generation. This is the FOURTH clock on a job (endpoint Execution Timeout ->
# `video_runner.JOB_TIMEOUT_SECONDS` -> this -> ComfyUI itself) and the only one that
# was never raised with the others: at 1800 it silently became the binding limit the
# moment an endpoint was set past 30 min, failing a render the endpoint was still
# happy to run with "generation timed out" instead of anything about the real cap.
# Keep it at or above the endpoint's Execution Timeout — RunPod's is the authority,
# this is only a backstop for a prompt ComfyUI never finishes or reports.
JOB_TIMEOUT = int(os.environ.get("COMFY_JOB_TIMEOUT") or 9000)
# How often a running job asks RunPod whether it has been cancelled. 5s is ~0.3% of
# a 30-min render's wall time and bounds the waste after a cancel to one poll.
CANCEL_POLL_SECONDS = float(os.environ.get("CANCEL_POLL_SECONDS") or 5)
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


class _Cancelled(Exception):
    """RunPod says this job was cancelled while we were rendering it."""


_warned_no_cancel_creds = False


def _job_cancelled(job_id: str) -> bool:
    """Has this job been cancelled out from under us?

    RunPod's `/cancel` marks the JOB cancelled, but a SYNCHRONOUS handler is never
    interrupted — nothing here is asked to stop, so the worker renders to completion,
    billing the whole time, and throws the result away. From the outside that reads as
    "the UI says cancelled but the GPU is still going", which is exactly what it was.

    So the worker has to ask. This is the same public status route the Atlas Maker's
    runner polls, with the same credentials, rather than an SDK internal.

    Fail-SAFE, in the direction that costs nothing: an unreadable status is NOT a
    cancellation (a flaky read must never abort a paid render — the mirror of the
    grace window on the runner's side of the same API).
    """
    global _warned_no_cancel_creds
    eid = (os.environ.get("RUNPOD_ENDPOINT_ID") or "").strip()
    key = (os.environ.get("RUNPOD_API_KEY") or "").strip()
    if not eid or not key:
        if not _warned_no_cancel_creds:
            _warned_no_cancel_creds = True
            print("[handler] RUNPOD_ENDPOINT_ID / RUNPOD_API_KEY are not set on this "
                  "endpoint, so a cancelled job CANNOT be noticed here: it will render "
                  "to completion and bill for it. Set both to make Cancel stop the GPU.",
                  flush=True)
        return False
    try:
        st = requests.get(f"{RUNPOD_API}/{eid}/status/{job_id}",
                          headers={"Authorization": f"Bearer {key}"}, timeout=15).json()
    except Exception:  # noqa: BLE001 — a bad READ is not a cancellation
        return False
    # TIMED_OUT and FAILED mean nobody is coming for this result either, so the same
    # stop applies — there is no one left to hand it to.
    return str(st.get("status") or "").upper() in ("CANCELLED", "TIMED_OUT", "FAILED")


def _abort_generation() -> None:
    """Stop the WORK, not just the wait.

    `/interrupt` ends the running prompt promptly and is the graceful half; killing
    ComfyUI is what GUARANTEES it (an interrupt lands between nodes, so a job stuck
    inside a 14 GB model load would otherwise keep going) and frees the VRAM with it.
    Leaving the process dead is safe: the next job's `_maybe_restart_comfy` cannot read
    stats from a dead server, so it starts a fresh one.
    """
    try:
        requests.post(f"{COMFY}/interrupt", timeout=15)
    except Exception:  # noqa: BLE001 — the kill below is the guarantee
        pass
    _stop_comfy()


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


def _await_result(prompt_id: str, job_id: str = "",
                  timeout: int = JOB_TIMEOUT) -> dict:
    """Wait for the prompt, checking every `CANCEL_POLL_SECONDS` whether the job has
    been cancelled — this loop is where a job spends essentially all of its life, so
    it is the only place worth watching. Raises `_Cancelled` if it has been."""
    t0 = last_check = time.time()
    while time.time() - t0 < timeout:
        h = requests.get(f"{COMFY}/history/{prompt_id}", timeout=30).json()
        if prompt_id in h:
            return h[prompt_id]
        now = time.time()
        if job_id and now - last_check >= CANCEL_POLL_SECONDS:
            last_check = now
            if _job_cancelled(job_id):
                raise _Cancelled()
        time.sleep(1)
    raise RuntimeError(f"generation timed out after {timeout}s")


def _put_to_url(url: str, data: bytes) -> bool:
    """PUT one rendered file straight to object storage. True when it landed.

    The URL is presigned by the caller and scoped to a single key, so this worker
    holds no storage credentials — which matters, because the image is public on
    GHCR.
    """
    try:
        r = requests.put(url, data=data, timeout=900)
    except Exception as e:  # noqa: BLE001 — fall back to the wire
        print(f"[handler] upload failed ({e}); returning the file through RunPod "
              "instead, which caps it at ~20 MB.", flush=True)
        return False
    if 200 <= r.status_code < 300:
        return True
    print(f"[handler] upload rejected (HTTP {r.status_code}: {r.text[:200]}); "
          "returning the file through RunPod instead, which caps it at ~20 MB.",
          flush=True)
    return False


def _collect_images(hist: dict, upload_urls: list | None = None) -> list[dict]:
    """Gather the rendered files. With `upload_urls`, each one goes STRAIGHT to
    object storage and only a slot number comes back.

    That is what takes a render off RunPod's API, whose payload cap is fixed — 10 MB
    on `/run`, 20 MB on `/runsync`, and base64 inflating a file by a third on the way
    — and whose own guidance for a large result is object storage. A lossless WEBP of
    opaque frames clears that cap easily, which is how switching a background cutout
    off came to break a render for a reason nothing about backgrounds explains.

    Output i goes to slot i, in the order ComfyUI reports them; WHICH file is the
    render stays the caller's decision, so the two sides cannot disagree about it.
    Falls back to base64 per file if an upload does not land, so a bad URL degrades
    to the old ceiling instead of losing the render.
    """
    urls = upload_urls or []
    out: list[dict] = []
    slot = 0
    for node_out in hist.get("outputs", {}).values():
        for img in node_out.get("images", []):
            params = {
                "filename": img["filename"],
                "subfolder": img.get("subfolder", ""),
                "type": img.get("type", "output"),
            }
            data = requests.get(f"{COMFY}/view", params=params, timeout=120).content
            entry = {"filename": img["filename"], "bytes": len(data)}
            if slot < len(urls) and _put_to_url(urls[slot], data):
                entry["slot"] = slot
                print(f"[handler] {img['filename']} ({len(data):,} bytes) uploaded to "
                      f"slot {slot}", flush=True)
            else:
                entry["image"] = base64.b64encode(data).decode()
            out.append(entry)
            slot += 1
    return out


def _describe_execution_error(status: dict) -> str:
    """The one line an author can act on, from ComfyUI's history `status`:
    `<node_type> #<id>: <ExceptionType>: <message>`.

    ComfyUI records the failure as an `execution_error` event under `messages`;
    the rest of the status is bookkeeping. The message is whitespace-collapsed
    and capped because the tool keeps 400 characters of an error, and the node
    name has to survive ahead of a traceback-sized message."""
    for entry in status.get("messages") or []:
        if not (isinstance(entry, (list, tuple)) and len(entry) == 2):
            continue
        kind, data = entry
        if kind != "execution_error" or not isinstance(data, dict):
            continue
        node = str(data.get("node_type") or "?")
        node_id = str(data.get("node_id") or "")
        exc = str(data.get("exception_type") or "").rsplit(".", 1)[-1]
        msg = " ".join(str(data.get("exception_message") or "").split())[:240]
        where = f"{node} #{node_id}" if node_id else node
        return f"{where}: {exc}: {msg}" if exc else f"{where}: {msg}"
    return ""


def _fail(msg: str, **extra) -> dict:
    """An error result that says WHICH WORKER produced it — IN the message.

    RunPod keeps only the `error` STRING of a failing handler result: the
    `worker_build` and `detail` keys beside it never reached the tool, which is
    why thirteen failed variations all read `job FAILED: comfy execution error`
    and not one word more. The keys stay for the worker log; the string is what
    travels."""
    return {"error": f"{msg} [worker {WORKER_BUILD}]",
            "worker_build": WORKER_BUILD, **extra}


def handler(job: dict) -> dict:
    global _jobs_done
    print(f"[handler] job {job.get('id')} on worker build {WORKER_BUILD}", flush=True)
    inp = job.get("input") or {}
    workflow = inp.get("workflow")
    if not workflow:
        return _fail("input.workflow is required")

    # Every job after the first gets a fresh ComfyUI so VRAM from the previous job
    # (including transformers-loaded models ComfyUI can't free) is fully released.
    if _jobs_done > 0:
        try:
            _maybe_restart_comfy()
        except Exception as e:  # noqa: BLE001
            return _fail(f"ComfyUI restart failed: {e}")
    _jobs_done += 1

    try:
        for im in inp.get("images", []) or []:
            _upload_image(im["name"], im["image"])
        client_id = str(uuid.uuid4())
        prompt_id = _queue(workflow, client_id)
        hist = _await_result(prompt_id, str(job.get("id") or ""))
    except _Cancelled:
        # Nobody is waiting for this result; the only thing that still matters is
        # that the GPU stops. RunPod discards a cancelled job's output, so what is
        # returned here is for the worker log, not for a caller.
        print(f"[handler] job {job.get('id')} was cancelled — stopping the "
              "generation and freeing the GPU.", flush=True)
        _abort_generation()
        return _fail("cancelled", detail="stopped on request")
    except Exception as e:  # noqa: BLE001
        return _fail(str(e))

    status = hist.get("status", {})
    if status.get("status_str") == "error":
        why = _describe_execution_error(status)
        return _fail(f"comfy execution error — {why}" if why else "comfy execution error",
                     detail=status)

    images = _collect_images(hist, inp.get("upload_urls"))
    if not images:
        return _fail("generation produced no images", detail=status)
    return {"images": images}


# Start ComfyUI, wait until it answers, then serve. Guarded so the module can be
# IMPORTED without spawning a GPU server — `start.sh` runs this as `python -u
# /handler.py`, so the worker is unaffected, while `test_handler.py` can exercise the
# stopping logic. That the module could not be imported is a large part of why the
# one behaviour here that costs money when it is wrong had no test at all.
if __name__ == "__main__":
    print(f"[handler] atlas-comfy-worker build {WORKER_BUILD} "
          f"(JOB_TIMEOUT={JOB_TIMEOUT}s, cancel-aware="
          f"{bool(os.environ.get('RUNPOD_ENDPOINT_ID') and os.environ.get('RUNPOD_API_KEY'))})",
          flush=True)
    _start_comfy()
    _wait_for_comfy()
    runpod.serverless.start({"handler": handler})
