"""Video session runner for the Flipbook video mode.

Design: docs/design/invisible-flipbook-video.md (build-plan step 1).

Generates N variations of a video from a blueprint, one RunPod Serverless job
each, and persists every result as an animated WEBP under

    <client>/<project>/video/<session-id>/
        meta.json          # blueprint, prompt, params, per-variation seed + status
        001.webp …         # one per variation

These are AUTHORING artifacts and never enter `deploy/` — a game references the
packed sheet and the clip, never a video.

Three deliberate departures from the still-image path in `batch_atlas`:

1. **Stateless.** Every call carries its own session id and its own context.
   Nothing here reads or writes the process-global active manifest / render
   state, so two users on one project cannot clobber each other's session (the
   hazard `docs/status/atlas-maker.md` open item 4 describes for the still path).

2. **Its own submit/poll loop** rather than `batch_atlas._runpod_run_and_wait`.
   That helper returns only the final output, but a video session needs the job
   id while the job is in flight — for live status and for cancellation. The
   thin transport helpers (`_runpod_post` / `_runpod_get`) are reused as-is.

3. **Its own workflow builder** rather than `build_workflow_blueprint`. That one
   is region-oriented: it resolves the prompt through `_resolve_text` (which
   merges the global style string and randomises the seed) and fills the
   `width`/`height` roles from the `GEN_WIDTH`/`GEN_HEIGHT` module globals, whose
   config default is 1024 — sized for stills, and ruinous pushed through an
   81-frame video batch. A video session needs an exact prompt and an exact seed
   per variation, so it drives the bindings directly. The actual injection logic
   (`_set_node_input`, `_effective_param_value`) is reused, not reimplemented.
"""
from __future__ import annotations

import base64
import json
import os
import random
import re
import threading
import time
from pathlib import Path

import batch_atlas
import blueprints
import cloud_paths as project_paths
import storage

# One video session at a time, process-wide. A session is N GPU jobs on a paid
# endpoint; letting sessions stack up is a spend hazard, not a feature. Mirrors
# how `_render_state["running"]` gates the still-image render.
_LOCK = threading.RLock()
_SESSIONS: dict[str, dict] = {}
_ACTIVE: str | None = None

# A variation count high enough to be useful, low enough that a fat-fingered
# number can't queue an afternoon of GPU time.
MAX_VARIATIONS = 12
# Poll cadence + overall per-job cap. Wan 2.2 14B on a cold worker loads ~29 GB
# of weights before it samples anything, so the cap is generous by necessity.
POLL_SECONDS = 3.0
JOB_TIMEOUT_SECONDS = 1800
# Seeds are echoed into meta.json, which a browser parses — beyond 2^53 a JSON
# number silently loses integer precision, so a "locked" seed would round to a
# different one and stop reproducing its own render.
MAX_SEED = (1 << 53) - 1

_SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{4,64}$")


def _now() -> float:
    return time.time()


def _new_session_id() -> str:
    return time.strftime("%Y%m%d_%H%M%S") + "_" + f"{random.randrange(1 << 16):04x}"


def valid_session_id(sid: str) -> bool:
    return bool(_SESSION_RE.match(str(sid or "")))


def _video_prefix() -> str:
    """`<client>/<project>/video` for the CALLING thread's context."""
    pp = project_paths.resolve()
    return f"{pp['r2_project_prefix']}/video"


def _session_dir(session_id: str) -> Path:
    pp = project_paths.resolve()
    d = Path(pp["staging_root"]) / "video" / session_id
    d.mkdir(parents=True, exist_ok=True)
    return d


# --------------------------------------------------------------------------
# Workflow assembly
# --------------------------------------------------------------------------
def build_video_workflow(
    blueprint: dict,
    prompt: str,
    negative: str,
    seed: int,
    source_ref: str,
    overrides: dict | None,
    filename_prefix: str,
) -> dict:
    """Drive a blueprint's graph for ONE video variation. Returns a fresh graph;
    the blueprint's own graph is never mutated.

    `source_ref` is a staging-relative / Sheet-Maker ref path in exactly the form
    a region's `style_ref` takes, so `_serverless_workflow_images` resolves it
    through the same `_locate_ref_in_staging` routing (including the lazy R2
    pull for a cold project).
    """
    import copy

    wf = copy.deepcopy(blueprint.get("graph") or {})
    bindings = blueprint.get("bindings") or {}

    batch_atlas._set_node_input(wf, bindings.get("positive"), prompt)
    batch_atlas._set_node_input(wf, bindings.get("negative"), negative)
    batch_atlas._set_node_input(wf, bindings.get("seed"), int(seed))
    if source_ref:
        batch_atlas._set_node_input(wf, bindings.get("style_ref"), source_ref)
        batch_atlas._set_node_input(wf, bindings.get("shape_ref"), source_ref)

    # `width`/`height` are intentionally NOT filled here — see the module
    # docstring. A video blueprint exposes generation size as params instead.

    ov = overrides if isinstance(overrides, dict) else {}
    for p in (blueprint.get("params") or []):
        if not isinstance(p, dict):
            continue
        key = str(p.get("key", "")).strip()
        if not key:
            continue
        raw = ov[key] if (key in ov and ov[key] not in ("", None)) else p.get("default")
        if raw is None:
            continue
        value = batch_atlas._effective_param_value(p, raw)
        if value is batch_atlas._UNSET:
            continue
        batch_atlas._set_node_input(
            wf, {"node": p.get("node"), "field": p.get("field")}, value)

    out_binding = bindings.get("output") or {}
    out_node = wf.get(str(out_binding.get("node", "")).strip())
    if isinstance(out_node, dict):
        out_node.setdefault("inputs", {})["filename_prefix"] = filename_prefix
    return wf


def blueprint_wants_source_image(blueprint: dict) -> bool:
    """True when the graph has a bound ref role — i.e. it is image-to-video and a
    run without a source image will die in ref resolution."""
    b = blueprint.get("bindings") or {}
    return bool(b.get("style_ref") or b.get("shape_ref"))


# --------------------------------------------------------------------------
# RunPod submit / poll (own loop: we need the job id while it is in flight)
# --------------------------------------------------------------------------
def _submit(wf: dict) -> tuple[str, dict]:
    """Base64 the graph's refs, POST /run, return (job_id, mutated_workflow)."""
    images = batch_atlas._serverless_workflow_images(wf)
    resp = batch_atlas._runpod_post("/run", {"input": {"workflow": wf, "images": images}})
    jid = resp.get("id")
    if not jid:
        raise RuntimeError(f"RunPod /run did not return a job id: {resp}")
    return str(jid), wf


def _cancel_job(job_id: str) -> None:
    """Best-effort remote cancel. A cancelled session should stop BURNING, not
    just stop reporting — but a failure here must never mask the local stop."""
    try:
        batch_atlas._runpod_post(f"/cancel/{job_id}", {})
    except Exception:  # noqa: BLE001 — local cancellation still stands
        pass


def _await_job(job_id: str, var: dict, should_stop) -> dict:
    """Poll one job to completion. Updates `var` in place with the live RunPod
    status so the UI can say "IN_QUEUE" vs "IN_PROGRESS" rather than a spinner.
    Raises on failure/timeout; returns the worker `output` on success."""
    deadline = _now() + JOB_TIMEOUT_SECONDS
    while _now() < deadline:
        if should_stop():
            _cancel_job(job_id)
            raise _Cancelled()
        time.sleep(POLL_SECONDS)
        st = batch_atlas._runpod_get(f"/status/{job_id}")
        status = str(st.get("status") or "").upper()
        with _LOCK:
            var["remote_status"] = status
        if status == "COMPLETED":
            return st.get("output") or {}
        if status in ("FAILED", "CANCELLED", "TIMED_OUT"):
            detail = st.get("error") or st.get("output") or st
            raise RuntimeError(f"job {status}: {str(detail)[:400]}")
    _cancel_job(job_id)
    raise TimeoutError(
        f"job {job_id} timed out after {JOB_TIMEOUT_SECONDS // 60} min")


class _Cancelled(Exception):
    """Session cancelled by the user — not an error to report as a failure."""


def _pick_video_output(out: dict, filename_prefix: str) -> tuple[str, bytes]:
    """Choose the animated WEBP from a worker result and decode it.

    `SaveAnimatedWEBP` reports under the worker's `images` key (verified against
    ComfyUI v0.33.1 — `UI.ImageSaveHelper` → `SavedImages.as_dict()` returns
    `{"images": …}`), so the existing collector carries it. A graph may ALSO emit
    a preview, so prefer our own filename prefix, then any `.webp`, and only then
    fall back to the first entry.
    """
    if isinstance(out, dict) and out.get("error"):
        detail = out.get("detail")
        raise RuntimeError(
            f"{out.get('error')}" + (f" ({detail})" if detail else ""))
    items = (out or {}).get("images") or (out or {}).get("gifs") or []
    if not items:
        raise RuntimeError(f"job returned no output files (output={out!r})")
    base = os.path.basename(filename_prefix).lower()
    ours = [i for i in items
            if str(i.get("filename", "")).lower().startswith(base)]
    webps = [i for i in (ours or items)
             if str(i.get("filename", "")).lower().endswith(".webp")]
    chosen = (webps or ours or items)[0]
    b64 = chosen.get("image") or chosen.get("data")
    if not b64:
        raise RuntimeError(
            f"output entry carried no data: {str(chosen)[:200]}")
    return str(chosen.get("filename") or "output.webp"), base64.b64decode(b64)


def _persist(session_id: str, index: int, blob: bytes) -> str:
    """Write one variation to staging + R2. Returns the stored filename."""
    fname = f"{index:03d}.webp"
    (_session_dir(session_id) / fname).write_bytes(blob)
    storage.put(f"{_video_prefix()}/{session_id}/{fname}", blob, "image/webp")
    return fname


def _write_meta(session_id: str, session: dict) -> None:
    """Mirror the session to `meta.json` so a page reload (or a restart) can
    recover it. Written after every variation, not just at the end — an
    interrupted session should still list what it managed to produce."""
    body = json.dumps(_public(session), indent=2).encode("utf-8")
    try:
        (_session_dir(session_id) / "meta.json").write_bytes(body)
        storage.put(f"{_video_prefix()}/{session_id}/meta.json",
                    body, "application/json")
    except Exception as e:  # noqa: BLE001 — a meta write must not kill a session
        print(f"[video] meta write failed for {session_id}: {e}", flush=True)


# --------------------------------------------------------------------------
# Session lifecycle
# --------------------------------------------------------------------------
def _public(session: dict) -> dict:
    """The JSON-safe view of a session (drops the internal graph/thread refs)."""
    return {k: v for k, v in session.items() if not k.startswith("_")}


def _run_session(session_id: str, ctx: tuple[str, str]) -> None:
    """Worker thread: run every variation in turn.

    SEQUENTIAL by design. The serverless handler deliberately keeps ComfyUI warm
    between jobs when VRAM allows, so consecutive variations reuse a loaded model
    instead of paying the ~29 GB Wan load again; fanning out in parallel would
    trade that for N cold starts. Results still stream in one tile at a time, so
    the grid fills progressively either way.
    """
    # A new thread does NOT inherit the request thread's thread-local context —
    # without this every path resolves to the env-default project.
    project_paths.set_context(*ctx)
    with _LOCK:
        session = _SESSIONS.get(session_id)
    if not session:
        return

    def should_stop() -> bool:
        with _LOCK:
            return bool(session.get("cancel"))

    bp = session["_blueprint"]
    for var in session["variations"]:
        if should_stop():
            with _LOCK:
                if var["status"] == "queued":
                    var["status"] = "cancelled"
            continue
        if var["status"] in ("done", "failed", "cancelled"):
            # Terminal already. On a RESUMED session this is what stops a paid job
            # being submitted twice: a variation we could not re-attach to is
            # marked failed by `_adopt` and left for the author to re-roll
            # deliberately, rather than silently re-billed.
            continue
        prefix = f"iwvid_{session_id}_{var['index']:03d}"
        # RESUME: a variation already carrying a job id was submitted by a
        # PREVIOUS process. Re-attach to that job rather than paying for it twice
        # — RunPod holds the result, and the GPU time is already spent.
        existing = str(var.get("job_id") or "")
        try:
            if existing and var["status"] == "running":
                print(f"[video] {session_id} v{var['index']:03d} re-attaching to "
                      f"job {existing}", flush=True)
                job_id = existing
            else:
                with _LOCK:
                    var.update(status="running", started=_now())
                    session["status"] = "running"
                _write_meta(session_id, session)
                wf = build_video_workflow(
                    bp, session["prompt"], session["negative"], var["seed"],
                    session["source_ref"], session["params"], prefix)
                job_id, wf = _submit(wf)
                with _LOCK:
                    var["job_id"] = job_id
                # Persist the id BEFORE waiting. This used to be written only once
                # the variation FINISHED, so a restart mid-job lost the only handle
                # to a job that was already running (and already paid for) — the
                # session then sat at "running" forever with its result stranded.
                _write_meta(session_id, session)
            out = _await_job(job_id, var, should_stop)
            _, blob = _pick_video_output(out, prefix)
            fname = _persist(session_id, var["index"], blob)
            with _LOCK:
                var.update(status="done", file=fname, bytes=len(blob),
                           finished=_now(), error="")
        except _Cancelled:
            with _LOCK:
                var.update(status="cancelled", finished=_now())
        except Exception as e:  # noqa: BLE001 — one bad variation must not kill the rest
            with _LOCK:
                var.update(status="failed", error=str(e)[:600], finished=_now())
            print(f"[video] {session_id} v{var['index']:03d} failed: {e}", flush=True)
        _write_meta(session_id, session)

    with _LOCK:
        done = sum(1 for v in session["variations"] if v["status"] == "done")
        session.update(
            status="cancelled" if session.get("cancel") and not done else "finished",
            finished=_now(), done_count=done)
    _write_meta(session_id, session)
    global _ACTIVE
    with _LOCK:
        if _ACTIVE == session_id:
            _ACTIVE = None


def start_session(req: dict, ctx: tuple[str, str], user: str = "") -> dict:
    """Validate a generate request and start a session. Raises ValueError with a
    user-readable message on anything the caller can fix."""
    global _ACTIVE
    bp_id = str(req.get("blueprint") or "").strip()
    if not bp_id:
        raise ValueError("Pick a blueprint first.")
    bp = blueprints.get_blueprint(bp_id)
    if not bp:
        raise ValueError(
            f"Blueprint '{bp_id}' not found in the shared library "
            "(it may need seeding, or the tool may need a restart to hydrate).")

    # The picker only lists video blueprints, but a stale tab or a hand-made
    # request can still name an image one — and an image graph through this runner
    # burns a GPU job to produce a single still nothing here can use.
    kind = str((bp.get("meta") or {}).get("kind") or "image").strip().lower()
    if kind != "video":
        raise ValueError(
            f"'{(bp.get('meta') or {}).get('name', bp_id)}' is an {kind} blueprint "
            "(it belongs to the Atlas Maker). Pick a video blueprint.")

    prompt = str(req.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("Enter a prompt.")
    negative = str(req.get("negative") or "").strip()
    source_ref = str(req.get("source_ref") or "").strip()
    if blueprint_wants_source_image(bp) and not source_ref:
        raise ValueError(
            f"'{bp.get('meta', {}).get('name', bp_id)}' is an image-to-video "
            "blueprint — pick a source image to animate.")

    try:
        count = int(req.get("variations") or 1)
    except (TypeError, ValueError):
        raise ValueError("Variations must be a whole number.")
    if count < 1 or count > MAX_VARIATIONS:
        raise ValueError(f"Variations must be between 1 and {MAX_VARIATIONS}.")

    params = req.get("params")
    params = params if isinstance(params, dict) else {}

    # Explicit seeds (a re-roll of one tile, or reproducing a locked render) win;
    # anything missing gets a fresh one. Recorded per variation either way, so a
    # result can always be reproduced.
    given = req.get("seeds")
    given = given if isinstance(given, list) else []

    with _LOCK:
        if _ACTIVE and _SESSIONS.get(_ACTIVE, {}).get("status") in ("running", "queued"):
            raise ValueError(
                "A video session is already running. Wait for it to finish, or "
                "cancel it first.")
        session_id = _new_session_id()
        session = {
            "id": session_id,
            "client": ctx[0],
            "project": ctx[1],
            "user": user,
            "blueprint": bp["id"],
            "blueprint_name": (bp.get("meta") or {}).get("name") or bp["id"],
            "prompt": prompt,
            "negative": negative,
            "source_ref": source_ref,
            "params": params,
            "status": "queued",
            "cancel": False,
            "created": _now(),
            "finished": 0.0,
            "done_count": 0,
            "variations": [
                {
                    "index": i + 1,
                    "seed": int(given[i]) if (i < len(given) and str(given[i]).strip())
                            else random.randrange(0, MAX_SEED),
                    "status": "queued",
                    "job_id": "",
                    "remote_status": "",
                    "file": "",
                    "bytes": 0,
                    "error": "",
                    "started": 0.0,
                    "finished": 0.0,
                }
                for i in range(count)
            ],
            "_blueprint": bp,
        }
        _SESSIONS[session_id] = session
        _ACTIVE = session_id

    threading.Thread(target=_run_session, args=(session_id, ctx),
                     daemon=True).start()
    return _public(session)


def get_session(session_id: str) -> dict | None:
    """Live session state, falling back to the persisted `meta.json` — and
    ADOPTING a session whose worker thread died with it.

    A session lives in a module-level dict, so a deploy or a crash takes its
    worker thread with it. Without adoption the stored meta says "running"
    forever, a job that RunPod already finished is never collected, and the GPU
    time is simply lost. Reading the session is the natural moment to notice,
    because it is exactly when someone is looking at it.
    """
    if not valid_session_id(session_id):
        return None
    with _LOCK:
        s = _SESSIONS.get(session_id)
        if s:
            return _public(s)
    raw = storage.get(f"{_video_prefix()}/{session_id}/meta.json")
    if not raw:
        return None
    try:
        stored = json.loads(raw)
    except ValueError:
        return None
    if stored.get("status") in ("running", "queued"):
        stored = _adopt(stored) or stored
    return stored


def _adopt(stored: dict) -> dict | None:
    """Take over an orphaned session: put it back in memory and restart its
    worker, which resumes from each variation's recorded state."""
    global _ACTIVE
    sid = str(stored.get("id") or "")
    if not valid_session_id(sid):
        return None
    bp = blueprints.get_blueprint(str(stored.get("blueprint") or ""))
    if not bp:
        # Blueprint gone: say so instead of leaving it "running" forever.
        stored["status"] = "cancelled"
        for v in stored.get("variations", []):
            if v.get("status") in ("running", "queued"):
                v["status"] = "failed"
                v["error"] = ("The blueprint this session used is no longer in "
                              "the library, so it cannot be resumed.")
        return stored
    for v in stored.get("variations", []):
        # Submitted-but-unrecorded: the id was lost with the process, so we
        # cannot re-attach and must not silently re-submit a paid job.
        if v.get("status") == "running" and not v.get("job_id"):
            v["status"] = "failed"
            v["error"] = ("Interrupted by a service restart before its job id was "
                          "recorded — re-roll this variation.")
    ctx = (str(stored.get("client") or ""), str(stored.get("project") or ""))
    with _LOCK:
        if _ACTIVE and _ACTIVE != sid:
            active = _SESSIONS.get(_ACTIVE, {})
            if active.get("status") in ("running", "queued"):
                return stored  # something else is genuinely running; don't stack
        stored["_blueprint"] = bp
        stored.setdefault("cancel", False)
        _SESSIONS[sid] = stored
        _ACTIVE = sid
    print(f"[video] adopted orphaned session {sid}", flush=True)
    threading.Thread(target=_run_session, args=(sid, ctx), daemon=True).start()
    return _public(stored)


def cancel_session(session_id: str) -> dict:
    """Stop a running session: no further variations start, and the in-flight
    job is cancelled remotely so it stops costing money."""
    if not valid_session_id(session_id):
        raise ValueError("Bad session id.")
    with _LOCK:
        s = _SESSIONS.get(session_id)
        if not s:
            raise ValueError("No such running session.")
        s["cancel"] = True
        in_flight = [v.get("job_id") for v in s["variations"]
                     if v["status"] == "running" and v.get("job_id")]
    for jid in in_flight:
        _cancel_job(jid)
    return {"ok": True, "id": session_id, "cancelling": len(in_flight)}


def list_sessions() -> list[dict]:
    """Every session for the calling thread's project, newest first. R2 is the
    source of truth (it survives a restart); live in-memory state wins where both
    exist, because it is fresher than the last `meta.json` flush."""
    out: dict[str, dict] = {}
    try:
        prefix = _video_prefix() + "/"
        for obj in storage.list_keys(prefix):
            key = obj.get("key", "")
            if not key.endswith("/meta.json"):
                continue
            sid = key[len(prefix):].split("/", 1)[0]
            raw = storage.get(key)
            if not raw:
                continue
            try:
                out[sid] = json.loads(raw)
            except ValueError:
                continue
    except Exception as e:  # noqa: BLE001 — R2 hiccup: fall back to memory
        print(f"[video] session listing failed: {e}", flush=True)
    with _LOCK:
        for sid, s in _SESSIONS.items():
            if s.get("project") == project_paths.project_name():
                out[sid] = _public(s)
    return sorted(out.values(), key=lambda s: s.get("created", 0), reverse=True)


def delete_session(session_id: str) -> dict:
    """Remove a session's objects from R2 + staging. Nothing prunes
    `<project>/video/` on its own, so this is the only way a session goes away."""
    if not valid_session_id(session_id):
        raise ValueError("Bad session id.")
    with _LOCK:
        s = _SESSIONS.get(session_id)
        if s and s.get("status") in ("running", "queued"):
            raise ValueError("Cancel the session before deleting it.")
        _SESSIONS.pop(session_id, None)
    prefix = f"{_video_prefix()}/{session_id}/"
    removed = 0
    try:
        for obj in storage.list_keys(prefix):
            storage.delete(obj["key"])
            removed += 1
    except Exception as e:  # noqa: BLE001
        print(f"[video] delete failed for {session_id}: {e}", flush=True)
    try:
        d = Path(project_paths.resolve()["staging_root"]) / "video" / session_id
        for f in sorted(d.glob("*")):
            f.unlink()
        d.rmdir()
    except OSError:
        pass
    return {"ok": True, "id": session_id, "removed": removed}


def read_variation(session_id: str, name: str) -> bytes | None:
    """One stored file, staging first then R2 (a restart empties staging)."""
    if not valid_session_id(session_id):
        return None
    if not re.match(r"^[A-Za-z0-9_.-]{1,64}$", str(name or "")):
        return None
    local = Path(project_paths.resolve()["staging_root"]) / "video" / session_id / name
    try:
        if local.is_file():
            return local.read_bytes()
    except OSError:
        pass
    return storage.get(f"{_video_prefix()}/{session_id}/{name}")
