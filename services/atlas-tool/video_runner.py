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

1. **Stateless, and QUEUED rather than refused.** Every call carries its own
   session id and its own context, so nothing here reads or writes the
   process-global active manifest / render state and two users on one project
   cannot clobber each other's session (the hazard `docs/status/atlas-maker.md`
   open item 4 describes for the still path). One session holds the runner at a
   time; the next one waits in `_QUEUE` instead of being turned away.

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

# ONE session holds the runner at a time, process-wide — but a second one QUEUES
# rather than being refused. Running sessions CONCURRENTLY is the spend hazard,
# and it would also throw away the warm-worker reuse that makes a session
# sequential in the first place; making the author cancel a live run just to line
# the next prompt up is not a guard, it is a way to lose a paid render. `_ACTIVE`
# is the session that owns the runner, `_QUEUE` is who gets it next, in order.
_LOCK = threading.RLock()
_SESSIONS: dict[str, dict] = {}
_ACTIVE: str | None = None
_QUEUE: list[str] = []
# The dispatcher's wake-up. Module-level rather than local to `_run_variations`
# because a worker exiting is only ONE of the things that must wake it: a slot
# re-armed mid-run (`_dispatch`) and a stop (`cancel_session`) are the others,
# and neither could reach a condition the loop kept to itself.
_CV = threading.Condition(_LOCK)
# Serialises `meta.json` writes. Separate from `_LOCK` on purpose: the write is an
# R2 put, and holding the session lock across a network call would stall every
# status poll and every page read for its duration.
_META_LOCK = threading.Lock()

# How many sessions may WAIT behind the running one. The queue is serial, so it
# never raises the burn RATE — but it does extend the tail, and an author who
# lines up five full sessions and walks away should be told, not surprised.
# A waiting session has spent nothing, so cancelling one is free.
MAX_QUEUED_SESSIONS = 4
# Poll cadence + overall per-job cap. Wan 2.2 14B on a cold worker loads ~29 GB
# of weights before it samples anything, so the cap is generous by necessity.
POLL_SECONDS = 3.0
# Deliberately LOOSER than the endpoint's own Execution Timeout, because the two
# clocks start in different places: RunPod times a job from when a worker picks
# it up, this one from submit. A cap TIGHTER than the endpoint's therefore
# cancels renders the endpoint was still happy to finish — which 30 min silently
# became the moment a blueprint ran two Wan passes in one job. RunPod's setting
# is the authority on how long a render may take; this is only a backstop for a
# job it never resolves at all, so it just has to stay above it.
JOB_TIMEOUT_SECONDS = int(os.environ.get("VIDEO_JOB_TIMEOUT_SECONDS") or 9600)
# How many of ONE session's variations may be in flight at once. Default 1 —
# serial, exactly the behaviour before this knob existed. RunPod's autoscaler only
# wakes a second worker when a second job is waiting, so a runner that submits one
# job at a time leaves every other worker on the endpoint asleep, however many are
# configured. Raising this spreads a grid across them — but each extra worker pays
# its own cold start (the ~29 GB Wan load a warm worker would have skipped) and
# multiplies the burn RATE by the same factor, so it only pays off on a big grid.
# Never set it above the endpoint's max workers: the surplus jobs just sit
# IN_QUEUE, billed for nothing and reported as waiting. Sessions still run one at
# a time regardless — this is parallelism WITHIN a session, not across them.
# There is no ceiling here: the endpoint's worker count is the real one, and the
# owner sets that, so a second number would only ever be wrong.
PARALLEL_JOBS = max(1, int(os.environ.get("VIDEO_PARALLEL_JOBS") or 1))
# How long a run of UNREADABLE status polls is tolerated before a job is given up
# on. Losing the poll is not losing the job — the worker renders (and bills)
# either way — so one 500 from RunPod's status API must never fail a variation
# fifteen minutes into a twenty-minute render, which is exactly what it did.
# Budgeted in TIME rather than tries: an API wobble lasts minutes, and at a 3s
# cadence a retry COUNT would give up in seconds.
STATUS_GRACE_SECONDS = 180.0
# Seeds are echoed into meta.json, which a browser parses — beyond 2^53 a JSON
# number silently loses integer precision, so a "locked" seed would round to a
# different one and stop reproducing its own render.
MAX_SEED = (1 << 53) - 1
# How many outputs one job may hand back through R2. A video graph emits one file;
# the spare slots cover a graph that also saves a preview. Each slot costs one
# presigned URL (a signature, no request), so a small pool is cheaper than teaching
# the worker our picking rule — which would put the same decision on both sides of
# the wire and let them disagree.
UPLOAD_SLOTS = 4
# Long enough for a cold worker to load ~29 GB of weights and render before the URL
# expires, since it is signed at SUBMIT time and used at the very end of the job.
UPLOAD_URL_TTL = 4 * 3600

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
def _upload_slot_keys(prefix: str) -> list[str]:
    """Where this variation's hand-off objects live. ONE definition, called by both
    the submit path and the re-attach path.

    It has to be derivable rather than remembered, because the process that signs the
    URLs need not be the process that collects the result: a deploy mid-render hands
    the job to a fresh container, which re-attaches by the persisted `job_id` and
    otherwise knows nothing about what the old one arranged. `prefix` is built from
    the session id and the variation index, so both processes compute the same keys
    from the same two facts — no new stored field to fall out of step with.
    """
    return [f"{_video_prefix()}/_out/{prefix}_{i}.webp" for i in range(UPLOAD_SLOTS)]


def _upload_slots(prefix: str) -> tuple[list[str], list[str]]:
    """Presigned PUT URLs the worker can drop its outputs into, and their keys.

    This is what takes the render OFF RunPod's API. Their payload cap is fixed —
    10 MB on `/run`, 20 MB on `/runsync`, and base64 inflates a file by a third on
    the way — and their own guidance for a large result is object storage. A lossless
    WEBP of opaque frames goes past it easily, which is why turning a background
    cutout off used to break a render for a reason nothing about backgrounds
    explains.

    The URLs are scoped to one key each and expire, so the worker holds no
    credentials: the image is public on GHCR, and nothing in it is worth stealing.

    Best-effort. If R2 cannot be reached to sign, the job simply runs the old way and
    returns base64 — smaller renders keep working rather than every render failing.
    """
    urls, keys = [], []
    try:
        for key in _upload_slot_keys(prefix):
            urls.append(storage.presign_put(key, UPLOAD_URL_TTL))
            keys.append(key)
    except Exception as e:  # noqa: BLE001 — no hand-off is a degraded run, not a dead one
        print(f"[video] could not presign upload slots ({e}); falling back to "
              "returning the render through RunPod, which caps it at ~20 MB.",
              flush=True)
        return [], []
    return urls, keys


def _submit(wf: dict, prefix: str = "") -> tuple[str, dict, list[str]]:
    """Base64 the graph's refs, POST /run, return (job_id, workflow, upload_keys)."""
    images = batch_atlas._serverless_workflow_images(wf)
    urls, keys = _upload_slots(prefix) if prefix else ([], [])
    payload = {"workflow": wf, "images": images}
    if urls:
        # A worker that predates this ignores the key and base64s as before, so a
        # stale endpoint image keeps working instead of failing on an input it does
        # not understand.
        payload["upload_urls"] = urls
    resp = batch_atlas._runpod_post("/run", {"input": payload})
    jid = resp.get("id")
    if not jid:
        raise RuntimeError(f"RunPod /run did not return a job id: {resp}")
    return str(jid), wf, keys


def _cancel_job(job_id: str) -> bool:
    """Remote cancel; True when RunPod accepted it. A cancelled session should stop
    BURNING, not just stop reporting — but a failure here must never mask the local
    stop, so it is still caught.

    It is REPORTED now rather than swallowed in silence. A cancel that never landed
    leaves a job running at full cost while every surface says it stopped, and that
    is precisely the state nobody could see: the caller turns a False into something
    the author is told, instead of the tool quietly believing itself.

    NOTE this only asks RunPod to cancel. Whether the WORKER then stops is the
    worker's own business — a synchronous handler is not interrupted by a cancel, so
    `services/atlas-serverless/handler.py` has to poll for it. A True here means
    "RunPod took the request", never "the GPU has stopped".
    """
    try:
        batch_atlas._runpod_post(f"/cancel/{job_id}", {})
        return True
    except Exception as e:  # noqa: BLE001 — local cancellation still stands
        print(f"[video] could not cancel job {job_id} on RunPod ({e}) — it may still "
              "be running and billing.", flush=True)
        return False


def _cancel_warning(failed: list) -> str:
    """What to tell the author when RunPod would not take a cancel. Says the cost
    out loud: a job we could not stop keeps rendering, and keeps charging."""
    n = len(failed)
    return (f"Stopped here, but RunPod would not cancel {n} running "
            f"job{'' if n == 1 else 's'} ({', '.join(failed[:3])}"
            f"{'…' if n > 3 else ''}) — {'it may' if n == 1 else 'they may'} still "
            "be rendering and billing. Check the endpoint's Requests tab.")


def _await_job(job_id: str, var: dict, should_stop) -> dict:
    """Poll one job to completion. Updates `var` in place with the live RunPod
    status so the UI can say "IN_QUEUE" vs "IN_PROGRESS" rather than a spinner.
    Raises on failure/timeout; returns the worker `output` on success.

    An UNREADABLE poll is not a failed job. RunPod's status API returns the odd
    500, and a job it has not indexed yet can 404 for a beat; the render carries
    on regardless. This used to let a single bad read raise straight out and kill
    the variation — with the job left running, billing out the endpoint's whole
    timeout, its result collected by nobody. Reads are now tolerated for
    `STATUS_GRACE_SECONDS` of CONTINUOUS failure before the job is given up on.
    """
    deadline = _now() + JOB_TIMEOUT_SECONDS
    unreadable_since = 0.0
    last_read_error = ""
    while _now() < deadline:
        if should_stop():
            _cancel_job(job_id)
            raise _Cancelled()
        time.sleep(POLL_SECONDS)
        # Re-check BEFORE reading the status. A cancel that lands during the sleep
        # has ALREADY cancelled the job remotely, so polling first reads RunPod's
        # CANCELLED and reports the author's own stop as a red FAILED tile with a
        # raw status dict in it — which is exactly what a stopped session looked
        # like.
        if should_stop():
            _cancel_job(job_id)
            raise _Cancelled()
        try:
            st = batch_atlas._runpod_get(f"/status/{job_id}")
        except Exception as e:  # noqa: BLE001 — a bad READ is not a bad job
            last_read_error = str(e)
            if not unreadable_since:
                unreadable_since = _now()
            if _now() - unreadable_since < STATUS_GRACE_SECONDS:
                # Say so rather than freezing on the last status, so the author
                # can see the tool is retrying and not that the job has stalled.
                with _LOCK:
                    var["remote_status"] = "RECONNECTING"
                continue
            # Genuinely out of contact. The job may well still be running, so
            # stop it rather than leave it burning to the endpoint's own timeout
            # with nobody left to collect what it produces.
            _cancel_job(job_id)
            raise RuntimeError(
                f"lost contact with RunPod for "
                f"{int(_now() - unreadable_since)}s while job {job_id} was "
                f"running, so it was stopped — {last_read_error[:300]}")
        unreadable_since = 0.0
        status = str(st.get("status") or "").upper()
        with _LOCK:
            var["remote_status"] = status
        if status == "COMPLETED":
            return st.get("output") or {}
        if status == "CANCELLED":
            # Cancelled, but not by us — stopped in the RunPod console, or dropped
            # by the endpoint. Say that, rather than printing the status dict.
            raise RuntimeError(
                "the GPU job was cancelled on RunPod before it finished — "
                "re-roll this variation to try again")
        if status in ("FAILED", "TIMED_OUT"):
            detail = st.get("error") or st.get("output") or st
            raise RuntimeError(f"job {status}: {str(detail)[:400]}")
    _cancel_job(job_id)
    raise TimeoutError(
        f"job {job_id} timed out after {JOB_TIMEOUT_SECONDS // 60} min")


class _Cancelled(Exception):
    """Session cancelled by the user — not an error to report as a failure."""


def _pick_video_output(out: dict, filename_prefix: str,
                       upload_keys: list | None = None) -> tuple[str, bytes]:
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
        # An EMPTY result is a different failure from a result with no images in it,
        # and the two used to read the same. The worker always returns either
        # `{"images": …}` or `{"error": …}` — never nothing — so an empty payload
        # from a job RunPod calls COMPLETED means the render finished and the RESULT
        # was lost between the worker and us, which in practice means it was too big
        # for RunPod to hand back.
        #
        # It is worth naming the cause, because the setting that triggers it looks
        # unrelated: measured on one blueprint, the SAME render is 4.5 MB with the
        # BiRefNet cutout on and blows the cap with it off — a lossless WEBP of
        # opaque frames is several times the size of one that is mostly transparent.
        # Turning off "remove background" therefore breaks a render for a reason
        # nothing about backgrounds explains, and "no output files" pointed at the
        # graph, which is exactly where the answer is not.
        if not out:
            raise RuntimeError(
                "the render finished but RunPod handed back no result — which "
                "means the file was too large for it to return (~20 MB). A "
                "LOSSLESS animated WEBP of opaque frames is several times the size "
                "of the same clip with an alpha cutout, so this usually appears the "
                "moment background removal is switched off. Turn the blueprint's "
                "`lossless` setting off, or lower the export size, and re-roll.")
        raise RuntimeError(f"job returned no output files (output={out!r})")
    base = os.path.basename(filename_prefix).lower()
    ours = [i for i in items
            if str(i.get("filename", "")).lower().startswith(base)]
    webps = [i for i in (ours or items)
             if str(i.get("filename", "")).lower().endswith(".webp")]
    chosen = (webps or ours or items)[0]
    name = str(chosen.get("filename") or "output.webp")
    # The PICKING stays here, on one side of the wire, and only the BYTES move. The
    # worker uploads output i to slot i and reports which slot it used; teaching it
    # to choose instead would put the same decision in two places and let them
    # disagree about which file the render actually is.
    if chosen.get("slot") is not None:
        # An entry that names a slot has NO bytes in it, so falling through to the
        # base64 branch here reports "carried no data" — which reads as a broken
        # worker when the render is sitting in R2, whole, and only the lookup is
        # missing. Say what is actually absent.
        if not upload_keys:
            raise RuntimeError(
                f"the worker uploaded this render (slot {chosen.get('slot')}, "
                f"{chosen.get('bytes', '?')} bytes) but this process has no upload "
                "keys to fetch it with — the render is in R2 and was not collected.")
        try:
            slot = int(chosen["slot"])
        except (TypeError, ValueError):
            raise RuntimeError(f"worker reported a bad upload slot: {chosen!r}")
        if not 0 <= slot < len(upload_keys):
            raise RuntimeError(
                f"worker used upload slot {slot}, which was never handed out")
        blob = storage.get(upload_keys[slot])
        if not blob:
            raise RuntimeError(
                "the worker reported it uploaded the render, but nothing is at "
                f"{upload_keys[slot]} — the upload URL may have expired mid-render.")
        return name, blob
    b64 = chosen.get("image") or chosen.get("data")
    if not b64:
        raise RuntimeError(
            f"output entry carried no data: {str(chosen)[:200]}")
    return name, base64.b64decode(b64)


def _clear_upload_slots(keys: list | None) -> None:
    """Delete the hand-off scratch objects. Best-effort: a leftover costs storage,
    never a render."""
    for k in (keys or []):
        try:
            storage.delete(k)
        except Exception:  # noqa: BLE001
            pass


def _persist(session_id: str, index: int, blob: bytes) -> str:
    """Write one variation to staging + R2. Returns the stored filename."""
    fname = f"{index:03d}.webp"
    (_session_dir(session_id) / fname).write_bytes(blob)
    storage.put(f"{_video_prefix()}/{session_id}/{fname}", blob, "image/webp")
    return fname


def _write_meta(session_id: str, session: dict) -> None:
    """Mirror the session to `meta.json` so a page reload (or a restart) can
    recover it. Written after every variation, not just at the end — an
    interrupted session should still list what it managed to produce.

    Snapshot and write are ONE unit under `_META_LOCK`. With several variations in
    flight two of them can finish together, and without this each would serialise
    a session the other is still mutating and then race its body to R2 — where the
    OLDER snapshot can land last and quietly undo a `done` that was already true.
    The snapshot itself is taken under `_LOCK`, so it never walks a variation list
    mid-append.
    """
    with _META_LOCK:
        with _LOCK:
            # `queue_position` is true only at this instant, so it is served, never
            # stored — a persisted one would still claim "3rd in line" a week later.
            doc = {k: v for k, v in _public(session).items() if k != "queue_position"}
            body = json.dumps(doc, indent=2).encode("utf-8")
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
    """The JSON-safe view of a session (drops the internal graph/thread refs),
    plus its LIVE place in line — 0 when it is running or already done."""
    out = {k: v for k, v in session.items() if not k.startswith("_")}
    sid = session.get("id")
    with _LOCK:
        out["queue_position"] = _QUEUE.index(sid) + 1 if sid in _QUEUE else 0
    return out


def _runner_busy() -> bool:
    """True while a session genuinely holds the runner. A stale `_ACTIVE` — left by
    a worker that died with its process — is NOT busy and must not lock the tool
    out, which is the state this used to fall into permanently."""
    with _LOCK:
        return bool(_ACTIVE) and _SESSIONS.get(_ACTIVE, {}).get("status") in (
            "running", "queued")


def _dispatch(session_id: str, ctx: tuple[str, str]) -> bool:
    """Give a session the runner if it is free, else put it at the back of the
    line. Returns True when it starts right now.

    A session that ALREADY holds the runner is left alone: its worker re-picks the
    lowest pending variation every iteration, so a slot re-armed mid-run is
    collected without a second thread ever touching the session. It is WOKEN,
    though: with nothing eligible and a job still in flight the dispatcher sleeps
    on `_CV`, and until this notified it the re-armed slot sat `queued` beside
    free workers until whichever job was in flight happened to finish.
    """
    global _ACTIVE
    with _LOCK:
        if _ACTIVE == session_id:
            _CV.notify_all()
            return False
        if _runner_busy():
            if session_id not in _QUEUE:
                _QUEUE.append(session_id)
            return False
        _ACTIVE = session_id
    threading.Thread(target=_run_session, args=(session_id, ctx), daemon=True).start()
    return True


def _run_session(session_id: str, ctx: tuple[str, str]) -> None:
    """Worker thread: own the runner for one session, then hand it on.

    Everything that can throw lives inside, because the hand-on is a `finally`.
    It used to be a plain assignment at the end of the happy path, so ANY escape
    before it — a bad context, a missing `_blueprint` on an adopted doc — left
    `_ACTIVE` pinned to a thread that no longer existed, and every later Generate
    answered "a video session is already running" with no way out short of
    restarting the container.
    """
    try:
        # A new thread does NOT inherit the request thread's thread-local context —
        # without this every path resolves to the env-default project.
        project_paths.set_context(*ctx)
        with _LOCK:
            session = _SESSIONS.get(session_id)
        if session:
            try:
                _run_variations(session_id, session, ctx)
            except Exception as e:  # noqa: BLE001 — record it; never wedge the queue
                print(f"[video] {session_id} runner died: {e}", flush=True)
                with _LOCK:
                    session["error"] = str(e)[:400]
                    for v in session["variations"]:
                        if v["status"] in ("queued", "running"):
                            v.update(status="failed", error=str(e)[:400],
                                     finished=_now())
            with _LOCK:
                done = sum(1 for v in session["variations"] if v["status"] == "done")
                session.update(
                    status="cancelled" if session.get("cancel") and not done
                    else "finished",
                    finished=_now(), done_count=done)
            _write_meta(session_id, session)
    finally:
        _release(session_id)


def _release(session_id: str) -> None:
    """Hand the runner to the next session in line.

    Only the session that OWNS the runner may release it: if `_ACTIVE` has moved
    on already (a stale entry that a later Generate stepped over), a late-dying
    thread must not hijack the queue on its way out.
    """
    global _ACTIVE
    nxt = None
    with _LOCK:
        if _ACTIVE != session_id:
            return
        _ACTIVE = None
        while _QUEUE:
            sid = _QUEUE.pop(0)
            s = _SESSIONS.get(sid)
            if not s or s.get("cancel") or s.get("status") in ("finished",
                                                               "cancelled"):
                continue  # cancelled while it waited — nothing was ever spent on it
            _ACTIVE = sid
            nxt = (sid, (str(s.get("client") or ""), str(s.get("project") or "")))
            break
    if nxt:
        threading.Thread(target=_run_session, args=nxt, daemon=True).start()


def _run_variations(session_id: str, session: dict, ctx: tuple[str, str]) -> None:
    """Run every variation of one session, at most `PARALLEL_JOBS` in flight.

    Each in-flight variation is a RunPod job on a worker of its own, and every
    worker keeps its own warm model between the jobs it is handed — so a session
    fanned out over three workers pays three cold starts and then reuses three
    loaded models, where a serial one pays a single cold start and reuses one.
    That is why the default is still 1: the serverless handler deliberately keeps
    ComfyUI warm when VRAM allows, so consecutive variations on one worker skip
    the ~29 GB Wan load, and fanning out only pays off when a grid is big enough
    for the extra cold starts to amortise. Results stream in one tile at a time
    either way, so the grid fills progressively.

    The loop here is a DISPATCHER: it claims the lowest eligible variation, marks
    it running and hands it to a thread, then waits on `_CV` for a slot to free
    up — or for a slot to be re-armed, or for a stop; see `_CV`. It returns only
    once every thread it started has finished — a variation still in flight after
    this returns would be racing the next session, which `_run_session` hands the
    runner to on return.
    """
    def should_stop() -> bool:
        with _LOCK:
            return bool(session.get("cancel"))

    bp = session["_blueprint"]
    # `ctx` is the one `_run_session` set its own context from, passed on rather
    # than re-derived, so there is a single answer to where this session's files
    # land. A variation thread does NOT inherit this thread's thread-local context
    # any more than this thread inherited the request's; without re-setting it,
    # `_persist` and `_write_meta` land in the env-default project.
    in_flight: set[int] = set()

    def run_one(var: dict, resume: bool) -> None:
        try:
            project_paths.set_context(*ctx)
            _run_variation(session_id, session, bp, var, resume, should_stop)
        finally:
            with _CV:
                in_flight.discard(var["index"])
                _CV.notify_all()

    while True:
        with _CV:
            if session.get("cancel"):
                for v in session["variations"]:
                    # `queued` never started. `running` and NOT claimed is a resume
                    # candidate this pass never reached — an adopted doc holding
                    # more running slots than the cap now allows — whose job
                    # `cancel_session` has already `/cancel`led. No thread is behind
                    # it, so nothing else will ever settle it; left `running`, it
                    # refused every re-roll with "still rendering. Cancel the
                    # session first" — after the session HAD been cancelled.
                    if v["status"] == "queued" or (
                            v["status"] == "running" and v["index"] not in in_flight):
                        v.update(status="cancelled", finished=_now())
                break
            # RE-PICKED every iteration rather than iterated once, so a slot armed
            # WHILE this pass is running — a re-roll of an earlier tile, or fresh
            # variations added to the session — is collected by the pass already
            # under way instead of needing a second worker.
            #
            # `running` + a job id is the RESUME case: that job is already paid
            # for, so it is re-attached. A variation whose id was lost is marked
            # failed by `_adopt` and left for the author to re-roll deliberately,
            # never silently re-billed. Every exit from the worker is terminal
            # (and a claimed slot is excluded here), so this cannot spin.
            var = next((v for v in session["variations"]
                        if v["index"] not in in_flight
                        and (v["status"] == "queued"
                             or (v["status"] == "running" and v.get("job_id")))),
                       None)
            if var is None:
                if not in_flight:
                    break
                _CV.wait()
                continue
            if len(in_flight) >= PARALLEL_JOBS:
                _CV.wait()
                continue
            # CLAIMED under the lock, before the thread exists, so the next
            # iteration cannot hand the same slot to a second thread. Whether this
            # is a re-attach is decided HERE, from the status at claim time: the
            # resume case keeps its `running` — that is what it was when the old
            # process died, and `started` belongs to that submit, not to this.
            in_flight.add(var["index"])
            resume = var["status"] == "running"
            if not resume:
                var.update(status="running", started=_now())
                session["status"] = "running"
        try:
            threading.Thread(target=run_one, args=(var, resume),
                             daemon=True).start()
        except RuntimeError as e:
            # A thread that never started never reaches `run_one`'s finally, so
            # its claim has to be undone here or the drain below waits forever.
            with _CV:
                in_flight.discard(var["index"])
                var.update(status="failed", error=str(e)[:600], finished=_now())
            print(f"[video] {session_id} v{var['index']:03d} could not start: {e}",
                  flush=True)
    # Drain. On cancel this is what actually stops the spend: each thread's
    # `should_stop` makes `_await_job` cancel its own job remotely on the way out.
    with _CV:
        while in_flight:
            _CV.wait()


def _run_variation(session_id: str, session: dict, bp: dict, var: dict,
                   resume: bool, should_stop) -> None:
    """Run ONE claimed variation to a terminal status: submit (or re-attach),
    await, collect, persist. Never raises — a bad variation is recorded on the
    slot so the rest of the session carries on."""
    prefix = f"iwvid_{session_id}_{var['index']:03d}"
    try:
        if resume:
            # A variation already carrying a job id was submitted by a PREVIOUS
            # process. Re-attach to that job rather than paying for it twice —
            # RunPod holds the result, and the GPU time is already spent.
            job_id = str(var.get("job_id") or "")
            print(f"[video] {session_id} v{var['index']:03d} re-attaching to "
                  f"job {job_id}", flush=True)
            # Re-derive where that job was told to put its output. This was an
            # empty list, so a render the worker had ALREADY uploaded could not be
            # found by the process that came to collect it: the result said "slot
            # 0" and there was nothing to resolve 0 against, so a finished, paid
            # render was reported as "output entry carried no data" while the file
            # sat in R2. The same trap the persisted `job_id` below was added for,
            # one field along.
            upload_keys = _upload_slot_keys(prefix)
        else:
            _write_meta(session_id, session)
            recipe = _variation_recipe(session, var)
            wf = build_video_workflow(
                bp, recipe["prompt"], recipe["negative"], var["seed"],
                recipe["source_ref"], recipe["params"], prefix)
            job_id, wf, upload_keys = _submit(wf, prefix)
            with _LOCK:
                var["job_id"] = job_id
            # Persist the id BEFORE waiting. This used to be written only once
            # the variation FINISHED, so a restart mid-job lost the only handle
            # to a job that was already running (and already paid for) — the
            # session then sat at "running" forever with its result stranded.
            _write_meta(session_id, session)
        out = _await_job(job_id, var, should_stop)
        _, blob = _pick_video_output(out, prefix, upload_keys)
        fname = _persist(session_id, var["index"], blob)
        # The hand-off slots are scratch. `_persist` has just written the real
        # object, so leaving them would double every session's storage and put
        # files under the session prefix that nothing references.
        _clear_upload_slots(upload_keys)
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
    if count < 1:
        raise ValueError("Variations must be at least 1.")

    params = req.get("params")
    params = params if isinstance(params, dict) else {}

    # Explicit seeds (a re-roll of one tile, or reproducing a locked render) win;
    # anything missing gets a fresh one. Recorded per variation either way, so a
    # result can always be reproduced.
    given = req.get("seeds")
    given = given if isinstance(given, list) else []

    with _LOCK:
        if _runner_busy() and len(_QUEUE) >= MAX_QUEUED_SESSIONS:
            raise ValueError(
                f"{len(_QUEUE)} sessions are already waiting behind the running "
                f"one, which is the limit ({MAX_QUEUED_SESSIONS}). Cancel one to "
                "make room — a session that has not started yet has spent "
                "nothing, so cancelling it is free.")
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
                    # Set only when this ONE slot was re-rolled against a different
                    # prompt than the session's; empty means "the session's".
                    "prompt": "",
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

    _dispatch(session_id, ctx)
    return _public(session)


def _new_variation(index: int, seed: int | None = None) -> dict:
    return {
        "index": index,
        "seed": random.randrange(0, MAX_SEED) if seed is None else int(seed),
        "status": "queued",
        "prompt": "",
        "job_id": "",
        "remote_status": "",
        "file": "",
        "bytes": 0,
        "error": "",
        "started": 0.0,
        "finished": 0.0,
    }


def _variation_recipe(session: dict, var: dict) -> dict:
    """What ONE slot actually runs: the session's recipe with that slot's own
    overrides laid over it. The single place the two are merged — the workflow
    build, the tile's "what is different about this one" line and the duplicate
    panel's starting values all have to agree, and they only can if they read the
    same function.

    A slot's `settings` keys are tested for PRESENCE, not truth: a duplicate made
    to drop the negative prompt stores `{"negative": ""}`, which must mean "no
    negative", not "fall back to the session's". `prompt` is the older field and
    keeps its own truthiness rule — it can never legitimately be empty.
    """
    st = var.get("settings")
    st = st if isinstance(st, dict) else {}
    params = st.get("params")
    return {
        "prompt": var.get("prompt") or session.get("prompt", ""),
        "negative": st.get("negative", session.get("negative", "")),
        "source_ref": st.get("source_ref", session.get("source_ref", "")),
        "params": params if isinstance(params, dict) else (session.get("params") or {}),
    }


def _load_for_edit(session_id: str, need_blueprint: bool = True) -> dict:
    """The in-memory session, hydrating it from the stored doc when this process
    does not hold it. Unlike `_adopt` it never starts a worker — the caller
    decides whether there is anything left to run."""
    if not valid_session_id(session_id):
        raise ValueError("Bad session id.")
    with _LOCK:
        s = _SESSIONS.get(session_id)
    if s:
        return s
    raw = storage.get(f"{_video_prefix()}/{session_id}/meta.json")
    if not raw:
        raise ValueError("No such session.")
    try:
        stored = json.loads(raw)
    except ValueError:
        raise ValueError("That session's record is unreadable.")
    bp = blueprints.get_blueprint(str(stored.get("blueprint") or ""))
    if not bp and need_blueprint:
        raise ValueError(
            "The blueprint this session used is no longer in the video library, "
            "so it cannot be re-run.")
    with _LOCK:
        stored["_blueprint"] = bp
        stored.setdefault("cancel", False)
        _SESSIONS.setdefault(session_id, stored)
        return _SESSIONS[session_id]


def _find_variation(session: dict, index: int) -> dict:
    for v in session.get("variations", []):
        if v.get("index") == index:
            return v
    raise ValueError(f"This session has no variation #{index}.")


def _live_variations(session: dict) -> list[dict]:
    return [v for v in session.get("variations", []) if v.get("status") != "deleted"]


def _drop_variation_file(session_id: str, index: int) -> None:
    """Remove one variation's stored render from R2 and staging. Best-effort: an
    object that is already gone IS the wanted end state, not an error."""
    fname = f"{index:03d}.webp"
    try:
        storage.delete(f"{_video_prefix()}/{session_id}/{fname}")
    except Exception as e:  # noqa: BLE001 — the local removal still stands
        print(f"[video] could not drop {session_id}/{fname}: {e}", flush=True)
    try:
        (Path(project_paths.resolve()["staging_root"]) / "video" / session_id
         / fname).unlink()
    except OSError:
        pass


def _reopen(session: dict) -> None:
    """Put a settled session back in the runnable state. A session still running
    is left exactly as it is — its worker re-picks pending slots on its own."""
    if session.get("cancel") and session.get("status") in ("running", "queued"):
        raise ValueError(
            "This session is still stopping. Give it a moment, then try again.")
    if session.get("status") in ("finished", "cancelled"):
        session.update(status="queued", cancel=False, finished=0.0)


def regenerate_variation(session_id: str, req: dict, ctx: tuple[str, str]) -> dict:
    """Re-roll ONE variation, in place, in the session it belongs to.

    The two axes an author actually wants are independent and both live here:
    hold the SEED and change the prompt to see what one word does to a fixed roll
    of the dice, or hold the PROMPT and take a new seed for another roll of the
    same idea. A changed prompt is recorded on the VARIATION, never on the
    session — overwriting the session's prompt would silently relabel the
    provenance of every other tile in the grid.
    """
    session = _load_for_edit(session_id)
    try:
        index = int(req.get("index"))
    except (TypeError, ValueError):
        raise ValueError("Which variation? No index was given.")
    var = _find_variation(session, index)

    with _LOCK:
        if var["status"] == "running":
            raise ValueError(
                "That variation is still rendering. Cancel the session first, "
                "then re-roll it.")
        if var["status"] == "deleted":
            raise ValueError("That variation was deleted.")
        _reopen(session)

        prompt = req.get("prompt")
        if prompt is not None:
            prompt = str(prompt).strip()
            if not prompt:
                raise ValueError("Enter a prompt.")
            var["prompt"] = "" if prompt == session.get("prompt") else prompt

        raw_seed = str(req.get("seed") or "").strip()
        if raw_seed:
            try:
                seed = int(raw_seed)
            except ValueError:
                raise ValueError("A seed must be a whole number.")
            if not 0 <= seed <= MAX_SEED:
                raise ValueError(f"A seed must be between 0 and {MAX_SEED}.")
        else:
            seed = random.randrange(0, MAX_SEED)

        var.update(_new_variation(index, seed), prompt=var.get("prompt", ""))

    # The old render is being REPLACED. Leaving it behind would serve a stale tile
    # for as long as the new job takes, under the same deterministic filename.
    _drop_variation_file(session_id, index)
    _write_meta(session_id, session)
    _dispatch(session_id, ctx)
    return _public(session)


def duplicate_variation(session_id: str, req: dict, ctx: tuple[str, str]) -> dict:
    """Run ONE slot's recipe again as a NEW slot, with anything about it changed.

    The difference from a re-roll is the whole point of it: a re-roll REPLACES a
    tile and moves two knobs (prompt, seed), while this ADDS a tile and moves all
    of them — prompt, negative, source image and every blueprint setting — while
    HOLDING the seed by default. That is the experiment an author actually runs:
    the same roll of the dice with the cutout on and with it off, side by side in
    one grid. Replacing the first render would destroy the comparison being made.

    What differs from the SESSION's recipe is recorded on the slot and nothing
    else is, for the same reason a re-rolled prompt is: the session's recipe still
    describes the rest of the grid, and overwriting it would silently relabel the
    provenance of every other tile.

    The blueprint is deliberately NOT changeable here. It is the session's
    identity — its params are the schema every tile in the grid is described by —
    so another blueprint is another session, which is what Generate is for.
    """
    session = _load_for_edit(session_id)
    bp = session["_blueprint"]
    try:
        index = int(req.get("index"))
    except (TypeError, ValueError):
        raise ValueError("Which variation? No index was given.")
    src = _find_variation(session, index)
    if src.get("status") == "deleted":
        raise ValueError(
            "That variation was deleted, so there is no recipe left to duplicate.")

    # Everything unstated falls back to what the SOURCE tile ran, not to the
    # session's — duplicating a duplicate has to carry the first one's changes
    # forward, or the second experiment quietly reverts to the original recipe.
    base = _variation_recipe(session, src)

    prompt = str(req.get("prompt", base["prompt"]) or "").strip()
    if not prompt:
        raise ValueError("Enter a prompt.")
    negative = str(req.get("negative", base["negative"]) or "").strip()
    source_ref = str(req.get("source_ref", base["source_ref"]) or "").strip()
    if blueprint_wants_source_image(bp) and not source_ref:
        raise ValueError(
            f"'{(bp.get('meta') or {}).get('name', session.get('blueprint'))}' is "
            "an image-to-video blueprint — pick a source image to animate.")

    params = req.get("params")
    params = params if isinstance(params, dict) else base["params"]

    # A held seed is the DEFAULT, because holding it is what makes the two tiles
    # comparable. Blank means "roll a new one" — the author asked for that.
    if "seed" in req:
        raw_seed = str(req.get("seed") or "").strip()
        if raw_seed:
            try:
                seed = int(raw_seed)
            except ValueError:
                raise ValueError("A seed must be a whole number.")
            if not 0 <= seed <= MAX_SEED:
                raise ValueError(f"A seed must be between 0 and {MAX_SEED}.")
        else:
            seed = random.randrange(0, MAX_SEED)
    else:
        seed = int(src["seed"])

    # Only DIFFERENCES from the session are stored. A slot carrying a full copy of
    # a recipe it never departed from would read in the UI as "this tile is
    # special" and, worse, pin settings that were never overridden — the session's
    # `params` records only what was changed for exactly that reason.
    settings: dict = {}
    if negative != (session.get("negative") or ""):
        settings["negative"] = negative
    if source_ref != (session.get("source_ref") or ""):
        settings["source_ref"] = source_ref
    if params != (session.get("params") or {}):
        settings["params"] = params

    with _LOCK:
        _reopen(session)
        # Numbering continues from the HIGHEST index ever used, deleted slots
        # included: `003.webp` may still be referenced by a clip made from it.
        nxt = max((v["index"] for v in session["variations"]), default=0) + 1
        var = _new_variation(nxt, seed)
        var["prompt"] = "" if prompt == session.get("prompt") else prompt
        if settings:
            var["settings"] = settings
        # Where it came from, so a grid of near-identical tiles can still say which
        # experiment each one belongs to. Provenance only — nothing reads it back.
        var["from_index"] = index
        session["variations"].append(var)

    _write_meta(session_id, session)
    _dispatch(session_id, ctx)
    return _public(session)


def discard_variation(session_id: str, req: dict) -> dict:
    """Delete ONE variation's render.

    The SLOT stays, marked `deleted`. Its index is its identity and its filename
    (`003.webp`), so renumbering the grid would rename results underneath a clip
    that was made from one. The mode simply stops drawing a deleted tile; the
    session's own 🗑 is still what removes everything.
    """
    session = _load_for_edit(session_id, need_blueprint=False)
    try:
        index = int(req.get("index"))
    except (TypeError, ValueError):
        raise ValueError("Which variation? No index was given.")
    var = _find_variation(session, index)

    with _LOCK:
        if var["status"] == "running":
            raise ValueError(
                "That variation is still rendering. Cancel the session first, "
                "then delete it.")
        var.update(status="deleted", prompt="", job_id="", remote_status="",
                   file="", bytes=0, error="", finished=_now())
        var.pop("settings", None)
        session["done_count"] = sum(
            1 for v in session["variations"] if v["status"] == "done")

    _drop_variation_file(session_id, index)
    _write_meta(session_id, session)
    return _public(session)


def add_variations(session_id: str, req: dict, ctx: tuple[str, str]) -> dict:
    """Append N more rolls of the SAME recipe to an existing session.

    The alternative — a whole new session per handful of variations — scatters one
    idea across a dropdown and makes the grid you are actually comparing the one
    thing you cannot see at once.
    """
    session = _load_for_edit(session_id)
    try:
        count = int(req.get("count") or 1)
    except (TypeError, ValueError):
        raise ValueError("Variations must be a whole number.")
    if count < 1:
        raise ValueError("Variations must be at least 1.")

    with _LOCK:
        _reopen(session)
        # Numbering continues from the HIGHEST index ever used, deleted slots
        # included: `003.webp` may still be referenced by a clip made from it.
        nxt = max((v["index"] for v in session["variations"]), default=0) + 1
        session["variations"].extend(
            _new_variation(nxt + i) for i in range(count))

    _write_meta(session_id, session)
    _dispatch(session_id, ctx)
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
        # Blueprint gone: say so instead of leaving it "running" forever. WRITTEN
        # back, not just returned — an unpersisted verdict means the stored doc
        # still says "running" and every later read re-derives the same thing.
        stored["status"] = "cancelled"
        stored["finished"] = _now()
        for v in stored.get("variations", []):
            if v.get("status") in ("running", "queued"):
                v["status"] = "failed"
                v["error"] = ("The blueprint this session used is no longer in "
                              "the library, so it cannot be resumed.")
        _write_meta(sid, stored)
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
        stored["_blueprint"] = bp
        stored.setdefault("cancel", False)
        _SESSIONS[sid] = stored
        busy = (_ACTIVE and _ACTIVE != sid
                and _SESSIONS.get(_ACTIVE, {}).get("status") in ("running",
                                                                 "queued"))
        if busy:
            # Something else genuinely holds the runner. LINE THE ORPHAN UP rather
            # than dropping it: it resumes from its recorded state, so waiting
            # costs nothing and the jobs it already paid for are still collected.
            if sid not in _QUEUE:
                _QUEUE.append(sid)
        else:
            _ACTIVE = sid
    if busy:
        print(f"[video] queued orphaned session {sid}", flush=True)
        return _public(stored)
    print(f"[video] adopted orphaned session {sid}", flush=True)
    threading.Thread(target=_run_session, args=(sid, ctx), daemon=True).start()
    return _public(stored)


def cancel_session(session_id: str) -> dict:
    """Stop a session: no further variations start, and any in-flight job is
    cancelled remotely so it stops costing money.

    Works on a session this process does NOT own. That is the case that matters:
    a session orphaned by a restart is exactly the one someone wants to stop, and
    refusing it ("no such running session") left the only stop button inert while
    the stored doc went on claiming to run.
    """
    if not valid_session_id(session_id):
        raise ValueError("Bad session id.")
    with _LOCK:
        s = _SESSIONS.get(session_id)
        if s:
            s["cancel"] = True
            # Wake the dispatcher, if one owns this session. Its `queued →
            # cancelled` sweep runs on its next pass, and without this that pass
            # came only when the next in-flight job exited — the stop was real
            # but the grid went on reading `queued` until then.
            _CV.notify_all()
            if session_id in _QUEUE:
                _QUEUE.remove(session_id)
            live = [v for v in s["variations"] if v["status"] == "running"]
            in_flight = [v["job_id"] for v in live if v.get("job_id")]
            # WHO WILL ACT ON THE FLAG? A worker notices `cancel` only if one
            # actually owns this session, and `_ACTIVE` is the whole of that fact.
            #
            # This used to ask a different question — "is any variation running?" —
            # and infer a worker from the answer. A session ADOPTED from its stored
            # doc after a restart breaks that inference completely: its variations
            # still say `running` because that is what they said when the old
            # process died, so the old test saw work in flight, assumed a thread was
            # watching it, and left everything to a worker that does not exist. The
            # session then sat at "running" forever and Cancel did nothing at all —
            # visibly nothing, since the flag was not even persisted (see below).
            # Which is precisely the session anyone most wants to stop.
            settle = _ACTIVE != session_id
            if settle:
                for v in s["variations"]:
                    if v["status"] in ("queued", "running"):
                        v.update(status="cancelled", finished=_now())
                s.update(status="cancelled", finished=_now())
    if s:
        failed = [jid for jid in in_flight if not _cancel_job(jid)]
        # ALWAYS persist. `cancel` used to be written only on the settling path, so
        # on the other one the flag lived in memory and nowhere else: the stored doc
        # went on saying `cancel: false`, and a restart forgot the stop had ever been
        # asked for. Cheap, and it makes the record match what the author did.
        _write_meta(session_id, s)
        if settle:
            _release(session_id)
        out = {"ok": True, "id": session_id, "cancelling": len(in_flight),
               "adopted": False}
        if failed:
            out["warning"] = _cancel_warning(failed)
        return out

    # Not ours: close it out in the STORED doc, so it stops claiming to run even
    # though no thread here will ever update it.
    raw = storage.get(f"{_video_prefix()}/{session_id}/meta.json")
    if not raw:
        raise ValueError("No such session.")
    try:
        stored = json.loads(raw)
    except ValueError:
        raise ValueError("That session's record is unreadable.")
    stopped = []
    for v in stored.get("variations", []):
        if v.get("status") not in ("running", "queued"):
            continue
        # Only a RUNNING variation has a job in flight. A queued one may still
        # carry an id from an earlier attempt, and cancelling that would target a
        # job this session no longer owns — matching the in-memory branch, which
        # has always filtered on `running`.
        if v.get("status") == "running" and v.get("job_id"):
            stopped.append(v["job_id"])
        v["status"] = "cancelled"
        v["finished"] = _now()
    stored["cancel"] = True
    stored["status"] = "cancelled"
    stored["finished"] = _now()
    failed = [jid for jid in stopped if not _cancel_job(jid)]
    _write_meta(session_id, stored)
    out = {"ok": True, "id": session_id, "cancelling": len(stopped),
           "adopted": True}
    if failed:
        out["warning"] = _cancel_warning(failed)
    return out


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
        if session_id in _QUEUE:
            _QUEUE.remove(session_id)
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
