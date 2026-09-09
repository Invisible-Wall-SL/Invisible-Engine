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
import uuid
from pathlib import Path

import batch_atlas
import blueprints
import cloud_paths as project_paths
import storage
from iw_common import lease

# WHICH CONTAINER THIS IS. A Railway rolling deploy overlaps the old container and
# the new one, so "am I the owner of this session?" needs an answer that outlives a
# process, and `_LOCK` cannot give one. Railway's own deployment id when it is
# there, a random id when it is not; the commit prefix is for readable logs.
INSTANCE_ID = ((os.environ.get("RAILWAY_REPLICA_ID")
                or os.environ.get("RAILWAY_DEPLOYMENT_ID")
                or uuid.uuid4().hex)[:24])

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
# The ETag of the last `meta.json` this process wrote, per key: the read half of the
# compare-and-swap that keeps a stale snapshot from landing last.
_META_ETAGS: dict[str, str] = {}

# How many sessions may WAIT behind the running one. The queue is serial, so it
# never raises the burn RATE — but it does extend the tail, and an author who
# lines up five full sessions and walks away should be told, not surprised.
# A waiting session has spent nothing, so cancelling one is free.
MAX_QUEUED_SESSIONS = 4
# How far back `resume_orphans` looks at boot. A doc older than this is not a
# session anyone is waiting on — RunPod dropped its jobs long ago — so re-attaching
# to it could only ever fail, slowly, once per container start.
RESUME_WINDOW_HOURS = float(os.environ.get("VIDEO_RESUME_WINDOW_HOURS") or 12)
# How often one project's hand-off prefix is swept off the back of a session
# listing. The boot sweep covers a restart; this covers a container that keeps
# running for days. 0 turns the listing-side sweep off (the boot one still runs).
SLOT_SWEEP_MINUTES = float(os.environ.get("VIDEO_SLOT_SWEEP_MINUTES") or 60)
# How long the dispatcher may sleep before it has to renew the session lease. Below
# `LEASE_TTL_MS` with room to spare, so an ordinary wait cannot let our own lease
# lapse under us and hand the session to a boot sweep that is standing by.
LEASE_RENEW_SECONDS = lease.LEASE_HEARTBEAT_MS / 1000.0
_LAST_SWEEP: dict[tuple[str, str], float] = {}
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
# The same budget for a run of 404s, which is a much shorter one because a 404 is
# an ANSWER, not a failure to answer: RunPod has no record of the job. Only one
# reading of that is innocent — a job it has not indexed in the seconds after
# submit — and it resolves in seconds. The other reading is a record already
# dropped (RunPod keeps a finished job about half an hour), where waiting the full
# three minutes only delays the collect from R2 that actually recovers the render.
NOT_FOUND_GRACE_SECONDS = 15.0
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

    # `_effective_param_value` is the second line of defence, and it only bites
    # on a param that DECLARES a domain: an int/float outside `min`/`max` is
    # clamped into range, a `select` outside `options` falls back to the default.
    # Same reasoning as `ui_server.ADV_RANGES` — an out-of-range value makes
    # ComfyUI reject the whole prompt (400), so the UI bounds the input and the
    # server clamps. A param published with NO bounds is unclamped by
    # construction, which is why the importer reads them off `/object_info`
    # (`comfy_specs`) rather than guessing from the baked value.
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
def _slot_prefix(session_id: str, index: int) -> str:
    """The hand-off prefix for one variation. ONE definition of this shape: five
    settle paths now derive slot keys from it, and a second spelling would send one
    of them looking in the wrong place."""
    return f"iwvid_{session_id}_{int(index):03d}"


# The reverse of `_slot_prefix` + `_upload_slot_keys`: what the sweeper reads a
# session id and a variation index back OUT of a hand-off object's name.
_SLOT_RE = re.compile(r"/_out/iwvid_([A-Za-z0-9_-]+?)_(\d{3})_\d+\.webp$")


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
    # EMPTY THE SLOTS BEFORE THE JOB RUNS. Their keys are derived from the session
    # id and the variation index, so a re-roll reuses the ones its own earlier
    # attempt wrote into — and a leftover is normal, since the slots are only
    # cleared on a successful collect. Without this, a re-roll that ends unreadable
    # would rescue the PREVIOUS attempt's render and call it the new seed's.
    _clear_upload_slots(keys)
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


def _await_job(job_id: str, var: dict, should_stop, resumed: bool = False) -> dict:
    """Poll one job to completion. Updates `var` in place with the live RunPod
    status so the UI can say "IN_QUEUE" vs "IN_PROGRESS" rather than a spinner.
    Raises on failure/timeout; returns the worker `output` on success.

    An UNREADABLE poll is not a failed job. RunPod's status API returns the odd
    500, and a job it has not indexed yet can 404 for a beat; the render carries
    on regardless. This used to let a single bad read raise straight out and kill
    the variation — with the job left running, billing out the endpoint's whole
    timeout, its result collected by nobody. Reads are now tolerated for
    `STATUS_GRACE_SECONDS` of CONTINUOUS failure before the job is given up on.

    Giving up raises `_Unresolved`, never a plain failure, because "we could not
    read the outcome" is not "the render did not happen": the worker uploads to R2
    itself, so the caller can still go and look. What it must NOT do is report a
    finished render as a red tile, which is what a run of 404s did on 2026-09-07 —
    five renders sat complete in their hand-off slots while their tiles read "lost
    contact with RunPod".
    """
    deadline = _now() + JOB_TIMEOUT_SECONDS
    unreadable_since = 0.0
    last_read_error = ""
    ever_read = False
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
                only_not_found = True
            only_not_found = only_not_found and getattr(e, "code", None) == 404
            # The short grace is for a record that is GONE, and the only way to know
            # one ever existed is to have read it — or to have re-attached to a job
            # an earlier process submitted, which is the case that actually meets
            # these 404s. A job never read may simply not be INDEXED yet, and giving
            # up on that in fifteen seconds abandons a live render, uncancelled, to
            # bill out the endpoint's own timeout with nobody collecting it.
            gone = only_not_found and (ever_read or resumed)
            grace = NOT_FOUND_GRACE_SECONDS if gone else STATUS_GRACE_SECONDS
            if _now() - unreadable_since < grace:
                # Say so rather than freezing on the last status, so the author
                # can see the tool is retrying and not that the job has stalled.
                with _LOCK:
                    var["remote_status"] = "RECONNECTING"
                continue
            if gone:
                # Not a broken connection — an answer. Cancelling a job RunPod has
                # no record of would just be a second 404, so don't pretend to; the
                # caller looks in the hand-off slot, which is where the render is.
                raise _Unresolved(
                    f"RunPod no longer has a record of job {job_id}. It drops a "
                    "finished job about half an hour after it completes, so this "
                    "usually means the render finished while nothing was watching "
                    "it — a service restart.")
            # Genuinely out of contact. The job may well still be running, so
            # stop it rather than leave it burning to the endpoint's own timeout
            # with nobody left to collect what it produces.
            _cancel_job(job_id)
            raise _Unresolved(
                f"lost contact with RunPod for "
                f"{int(_now() - unreadable_since)}s while job {job_id} was "
                f"running, so it was stopped — {last_read_error[:300]}")
        unreadable_since = 0.0
        ever_read = True
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
    raise _Unresolved(
        f"job {job_id} timed out after {JOB_TIMEOUT_SECONDS // 60} min")


class _Cancelled(Exception):
    """Session cancelled by the user — not an error to report as a failure."""


class _Unresolved(RuntimeError):
    """The job's OUTCOME could not be read — RunPod never said finished or failed.

    Kept apart from an ordinary failure because the render may exist regardless:
    the worker uploads straight to R2, so a result nobody was there to collect is
    still sitting in its hand-off slot. Every raise of this is followed by a look
    in that slot before the variation is called failed.
    """


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


def _rescue_upload(keys: list | None, newer_than: float = 0.0) -> bytes | None:
    """The render sitting in a hand-off slot, when the job's own outcome was never
    read. `None` when there is nothing there.

    This is the whole point of uploading to R2 rather than returning the file
    through RunPod: the render outlives the process that ordered it. A deploy takes
    the poller with it, the GPU finishes anyway and PUTs the result, and by the time
    anyone looks again RunPod has dropped the job record — so the only surviving
    handle on a paid render is the slot, whose key is derivable from the session id
    and the variation index (`_upload_slot_keys`).

    Reads through `get_strict`, RETRIED, because "the slot is empty" and "R2 could
    not be asked" are different answers and `storage.get` returns None for both —
    which would report a finished render as a failure over one flaky read, the very
    bug this function exists to fix, one layer down.

    Picks the same way `_pick_video_output` does rather than taking the first thing
    it finds: a graph may emit a preview alongside the clip, and slot order is the
    worker's output order, not a ranking. An animated WEBP is the one with an
    `ANIM` chunk; failing that, the largest.

    Best-effort by construction: nothing here raises, because a slot that really is
    empty just means the variation failed the way it used to.
    """
    keys = list(keys or [])
    if keys and newer_than:
        # Only slots written since this attempt began. The mtime is on the object,
        # so one delimited listing of the shared prefix answers for all of them.
        try:
            common = os.path.commonprefix(keys)
            fresh = {str(o.get("key")) for o in storage.list_keys(common)
                     if float(o.get("mtime") or 0) >= newer_than}
            keys = [k for k in keys if k in fresh]
        except Exception as e:  # noqa: BLE001 — unlistable means unproven, so drop
            print(f"[video] could not date the hand-off slots ({e}); "
                  "not collecting from them", flush=True)
            return None
    found: list[bytes] = []
    for k in keys:
        for attempt in range(3):
            try:
                blob = storage.get_strict(k)
            except storage.ObjectUnreadable:
                time.sleep(0.15 * (attempt + 1))
                continue
            if blob:
                found.append(blob)
            break
    if not found:
        return None
    animated = [b for b in found if b[:4] == b"RIFF" and b"ANIM" in b[:64]]
    return max(animated or found, key=len)


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


def _has_render(v: dict) -> bool:
    return v.get("status") == "done" and bool(v.get("file"))


def _win(mine: dict, theirs: dict | None) -> dict:
    """Which of two versions of one variation survives a merge.

    A deliberate removal outranks everything: `discard_variation` writes `deleted`,
    and a stale snapshot that still remembers the render would otherwise resurrect a
    tile its author had thrown away. Then a finished render beats one without,
    whichever side it came from. When BOTH sides have a render — which the lease is
    there to prevent, but which a fail-open window can still produce — the later one
    wins, so at least the answer is deterministic rather than order-of-arrival.
    """
    if theirs is None:
        return mine
    if "deleted" in (mine.get("status"), theirs.get("status")):
        return mine if mine.get("status") == "deleted" else theirs
    if _has_render(mine) and _has_render(theirs):
        return mine if float(mine.get("finished") or 0) >= \
            float(theirs.get("finished") or 0) else theirs
    if _has_render(theirs) and not _has_render(mine):
        return theirs
    return mine


def _merge_meta(ours: dict, theirs: dict) -> dict:
    """Our doc reconciled with the one that landed while we were writing it.

    The rule that matters: **a finished render never loses.** The reported bug was
    one container collecting a render, persisting `00N.webp` and marking the tile
    `done`, while the other container's older snapshot landed last and put the tile
    back to `failed` — the render surviving in R2 with no tile pointing at it. So a
    variation that has a `file` beats one that does not, whichever side it came from.

    `cancel` is sticky for the same reason in the other direction: a stop that
    landed anywhere must not be un-asked by a writer that had not heard about it.
    Variations are unioned by index, so a concurrent ＋ Add or ⧉ duplicate is not
    dropped by a snapshot taken before it.
    """
    out = dict(theirs)
    out.update({k: v for k, v in ours.items() if k != "variations"})
    out["cancel"] = bool(ours.get("cancel") or theirs.get("cancel"))
    # A SESSION THAT ENDED STAYS ENDED. Taking every scalar from ours put a session
    # the other container had finished back to `running` — and a `running` doc is
    # one `resume_orphans` re-dispatches and the slot sweep refuses to tidy.
    if theirs.get("status") in ("finished", "cancelled") \
            and ours.get("status") not in ("finished", "cancelled"):
        out["status"] = theirs["status"]
        out["finished"] = theirs.get("finished") or ours.get("finished") or 0
    by_index: dict = {}
    for v in (theirs.get("variations") or []):
        by_index[v.get("index")] = v
    for v in (ours.get("variations") or []):
        i = v.get("index")
        other = by_index.get(i)
        by_index[i] = _win(v, other)
    out["variations"] = [by_index[i] for i in sorted(by_index, key=lambda x: (x is None, x))]
    out["done_count"] = sum(1 for v in out["variations"] if v.get("status") == "done")
    return out


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
        key = f"{_video_prefix()}/{session_id}/meta.json"
        try:
            merged = False
            for attempt in range(3):
                etag = _META_ETAGS.get(key)
                if etag is None:
                    # Nothing written by US yet, so we do not know what is there —
                    # read it, and if something is, merge onto it rather than over it.
                    got = storage.get_with_etag(key)
                    if got is not None:
                        try:
                            doc = _merge_meta(doc, json.loads(got[0]))
                            merged = True
                        except ValueError:
                            pass  # a corrupt doc is not worth preserving
                        etag = got[1]
                body = json.dumps(doc, indent=2).encode("utf-8")
                try:
                    (_session_dir(session_id) / "meta.json").write_bytes(body)
                    new_etag = storage.put(
                        key, body, "application/json",
                        if_match=etag, if_none_match=None if etag else "*")
                except storage.Conflict:
                    # SOMEBODY ELSE WROTE FIRST. Never abort and never overwrite:
                    # take their doc, fold ours into it, and try again. This is the
                    # whole point — a 412 that dropped our write would lose a `done`
                    # exactly as loudly as the clobber it replaced.
                    _META_ETAGS.pop(key, None)
                    got = storage.get_with_etag(key)
                    if got is None:
                        continue
                    try:
                        doc = _merge_meta(doc, json.loads(got[0]))
                        merged = True
                    except ValueError:
                        pass
                    _META_ETAGS[key] = got[1]
                    continue
                if new_etag:
                    _META_ETAGS[key] = new_etag
                else:
                    _META_ETAGS.pop(key, None)
                if merged:
                    # FOLD IT BACK. The repair has to reach memory, not just R2:
                    # the next write takes the fast path on our cached etag, and
                    # would put our un-merged snapshot straight back over the top —
                    # undoing the collected render this whole mechanism just saved.
                    with _LOCK:
                        live = _SESSIONS.get(session_id)
                        if live is not None and live is session:
                            live["variations"] = doc["variations"]
                            for k in ("status", "finished", "cancel", "done_count"):
                                if k in doc:
                                    live[k] = doc[k]
                return
            # The cached etag is the etag of what WE last wrote; three failures
            # mean we wrote none of them, so keeping it would send the next write
            # down the fast path on a value that was never ours.
            _META_ETAGS.pop(key, None)
            print(f"[video] meta for {session_id} lost three races in a row; "
                  "leaving the other writer's doc alone", flush=True)
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


def _lease_key(session_id: str) -> lease.LeaseKey:
    """This session's lease. `toolId` is deliberately NOT `flipbook` — that is the
    clip tool's id, and a clip id and a session id share one keyspace under it."""
    prefix = _video_prefix()
    client, project = prefix[: -len("/video")].split("/", 1)
    return lease.LeaseKey("flipbookVideo", client, project, session_id)


def _holder() -> lease.LeaseHolder:
    """WHO IS CLAIMING: this container, and nothing about the person who started the
    session. One process runs sessions for several users, so keying identity on the
    session's user would give one container as many identities as it has users — and
    `is_same_holder` compares both halves, so the container would not recognise its
    OWN rows. Every release would be a no-op, and Cancel's takeover would look
    foreign to the very dispatcher it is meant to reach."""
    return lease.LeaseHolder("atlas-tool", INSTANCE_ID)


def _held_elsewhere(session_id: str) -> dict | None:
    """The row of ANOTHER container that holds this session, or None.

    Read, never enforced: a caller uses it to defer, not to decide whether it is
    allowed. Fails open — an unreadable lease reads as nobody's.
    """
    try:
        row = lease.held_by(_lease_key(session_id))
    except Exception:  # noqa: BLE001
        return None
    return None if row is None or lease.is_same_holder(row, _holder()) \
        else row


def _hold_is_ours(session_id: str, *, strict: bool = False) -> bool:
    """Do we still own this session?

    `strict` is for the ONE call site where "proceed" is not the conservative
    answer: the check immediately before `_submit`. Everywhere else an unreadable
    lease costs a deferral — a render collected slightly later. There it costs a
    render outright, because `_submit` clears the hand-off slots and would delete
    whatever the other container's job has already uploaded into them. The price of
    failing closed there is one re-queue, which is the branch right below it.
    """
    try:
        row = lease.held_by(_lease_key(session_id))
    except Exception:  # noqa: BLE001
        return not strict
    return row is None or lease.is_same_holder(row, _holder())


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
    threading.Thread(target=_run_session, args=(session_id, ctx), daemon=True,
                     name=f"video-session-{session_id}").start()
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
        if session and not lease.acquire(_lease_key(session_id), _holder()):
            # Another container is running this session. Do not touch it: its owner
            # is submitting, collecting and settling, and a second dispatcher here
            # would submit the same variations again — paying twice, and worse,
            # `_submit` empties the hand-off slots, so the second submit would
            # DELETE the render the first one's job had already uploaded.
            print(f"[video] {session_id} is held by another container; leaving it",
                  flush=True)
            # DROPPED from memory, not just skipped. `get_session` short-circuits on
            # `_SESSIONS`, so a session left installed here would be frozen at this
            # snapshot for the life of the container: readers never see the other
            # container's progress and `_adopt` — the only path that re-checks the
            # lease — can never run for it again.
            with _LOCK:
                _SESSIONS.pop(session_id, None)
            session = None
        if session:
            try:
                _run_variations(session_id, session, ctx)
            except Exception as e:  # noqa: BLE001 — record it; never wedge the queue
                print(f"[video] {session_id} runner died: {e}", flush=True)
                with _LOCK:
                    session["error"] = str(e)[:400]
                    dying = [v for v in session["variations"]
                             if v["status"] in ("queued", "running")]
                # The dispatcher falling over says nothing about the renders its
                # variations may already have delivered, so look before failing
                # them — the same rule `_run_variation` follows one level down.
                # Outside the lock: this reads R2.
                for v in dying:
                    if _collect_stranded(
                            session_id, v,
                            _upload_slot_keys(_slot_prefix(session_id, v["index"])),
                            "its session's runner died",
                            newer_than=float(v.get("started") or 0)):
                        continue
                    with _LOCK:
                        v.update(status="failed", error=str(e)[:400],
                                 finished=_now())
            if session.pop("_lost_lease", False):
                # Somebody else owns this session now. Write NOTHING terminal: a
                # `finished` from a container that has just been told to stand down
                # lands over a session the new owner is actively running, and the
                # doc flaps between the two. Let go and let the owner settle it.
                with _LOCK:
                    _SESSIONS.pop(session_id, None)
                    _META_ETAGS.pop(
                        f"{_video_prefix()}/{session_id}/meta.json", None)
                _release(session_id)
                return
            with _LOCK:
                done = sum(1 for v in session["variations"] if v["status"] == "done")
                # A collect-only pass left the untouched tail alone on purpose, so
                # this session is not FINISHED — it is where it was, minus the
                # renders just rescued. Say that, and then LET GO of it: the next
                # read re-adopts it as an ordinary resume and starts what is left,
                # which keeps "only a person starts a job" true without stranding
                # the tail behind a status nothing would ever revisit.
                handed_back = bool(
                    session.get("_collect_only") and not session.get("cancel")
                    and any(v["status"] == "queued" for v in session["variations"]))
                if handed_back:
                    session.update(status="running", done_count=done)
                else:
                    session.update(
                        status="cancelled" if session.get("cancel") and not done
                        else "finished",
                        finished=_now(), done_count=done)
            _write_meta(session_id, session)
            if handed_back:
                with _LOCK:
                    if _SESSIONS.get(session_id) is session:
                        del _SESSIONS[session_id]
                print(f"[video] {session_id} collected what was already running; "
                      "its unstarted tiles wait for someone to open it", flush=True)
    finally:
        try:
            lease.release(_lease_key(session_id), _holder())
        except Exception:  # noqa: BLE001 — expiry is the backstop
            pass
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
        threading.Thread(target=_run_session, args=nxt, daemon=True,
                         name=f"video-session-{nxt[0]}").start()


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
        stopping: list[dict] = []
        # RENEWED HERE, on the dispatcher's own loop, because this is where owning
        # the session actually lives. A heartbeat on a timer would keep the lease
        # alive for a dispatcher that had died; one on a variation thread would keep
        # it alive for a session nothing was driving.
        if not lease.heartbeat(_lease_key(session_id), _holder()):
            with _CV:
                if not in_flight:
                    print(f"[video] {session_id} was taken over; standing down",
                          flush=True)
                    session["_lost_lease"] = True
                    break
                # Drain what is already paid for — those jobs are ours to collect,
                # and their writes merge — but claim nothing further.
                _CV.wait(LEASE_RENEW_SECONDS)
                continue
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
                        stopping.append(v)
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
            #
            # A `_collect_only` pass takes ONLY the re-attach half. It is the boot
            # sweep's pass: nobody asked for anything at that moment, so finishing
            # a grid's untouched tail would submit brand-new jobs unattended, hours
            # after its author walked away, once per rollout that caught it. The
            # tail stays `queued` and starts when a person opens the session.
            var = next((v for v in session["variations"]
                        if v["index"] not in in_flight
                        and ((v["status"] == "running" and v.get("job_id"))
                             or (v["status"] == "queued"
                                 and not session.get("_collect_only")))),
                       None)
            if var is None:
                if not in_flight:
                    break
                # BOUNDED, so the loop comes back round to renew. An untimed wait
                # here sleeps for the whole of a render — minutes — while the lease
                # lives 45 seconds, so our own lease would lapse under us and the
                # session would read as free to every other container.
                _CV.wait(LEASE_RENEW_SECONDS)
                continue
            if len(in_flight) >= PARALLEL_JOBS:
                _CV.wait(LEASE_RENEW_SECONDS)
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
            if not _collect_stranded(
                    session_id, var,
                    _upload_slot_keys(_slot_prefix(session_id, var["index"])),
                    "its worker thread could not start",
                    newer_than=float(var.get("started") or 0)):
                with _CV:
                    var.update(status="failed", error=str(e)[:600],
                               finished=_now())
                print(f"[video] {session_id} v{var['index']:03d} could not "
                      f"start: {e}", flush=True)
    # A stop settles these, and an unclaimed `running` one is a resumed tile whose
    # worker may already have PUT its render — so look before discarding it. Done
    # outside `_CV` because it reads R2.
    for v in stopping:
        if not _collect_stranded(
                session_id, v,
                _upload_slot_keys(_slot_prefix(session_id, v["index"])),
                "the session was stopped after the worker had uploaded",
                newer_than=float(v.get("started") or 0)):
            with _LOCK:
                v.update(status="cancelled", finished=_now())
    # Drain. On cancel this is what actually stops the spend: each thread's
    # `should_stop` makes `_await_job` cancel its own job remotely on the way out.
    # Bounded for the same reason as the waits above: the drain outlasts a render,
    # and a lease nobody is renewing is a session everybody thinks is free.
    while True:
        with _CV:
            if not in_flight:
                break
            _CV.wait(LEASE_RENEW_SECONDS)
        lease.heartbeat(_lease_key(session_id), _holder())


def _run_variation(session_id: str, session: dict, bp: dict, var: dict,
                   resume: bool, should_stop) -> None:
    """Run ONE claimed variation to a terminal status: submit (or re-attach),
    await, collect, persist. Never raises — a bad variation is recorded on the
    slot so the rest of the session carries on."""
    prefix = _slot_prefix(session_id, var["index"])
    # BOUND BEFORE THE TRY, because the failure arms read it. Everything that can
    # go wrong before `_submit` returns — RunPod refusing `/run`, a missing ref
    # image, a bad blueprint, an R2 hiccup on the first `_write_meta` — used to be
    # recorded as a red tile with its reason; reading an unbound name in the
    # handler instead raised out of a function whose contract is "never raises",
    # leaving the tile spinning at `running` with no error and no way to re-roll it.
    upload_keys: list = []
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
            if not _hold_is_ours(session_id, strict=True):
                # The last check before the only line that spends money. Put the
                # slot back so whoever does own the session picks it up.
                with _LOCK:
                    # `started` is left ALONE: every rescue path dates a hand-off
                    # slot against it (`newer_than=`), and zeroing it would let a
                    # stale object from an earlier attempt be collected as this
                    # variation's render — wrong bytes under a recorded recipe.
                    var["status"] = "queued"
                print(f"[video] {session_id} v{var['index']:03d} not submitted — "
                      "another container owns this session now", flush=True)
                return
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
        out = _await_job(job_id, var, should_stop, resumed=resume)
        _, blob = _pick_video_output(out, prefix, upload_keys)
        _keep(session_id, var, blob, upload_keys)
    except _Cancelled:
        # A stop that lands after the worker has already PUT its result. The GPU
        # time is spent either way, so take the render rather than throw it away —
        # and note that a re-roll of this slot would DELETE it (`_submit` empties
        # the slots), so "leave it there for later" is not a real option.
        if not _collect_stranded(session_id, var, upload_keys,
                                 "the stop landed after the worker had uploaded"):
            with _LOCK:
                var.update(status="cancelled", finished=_now())
    except Exception as e:  # noqa: BLE001 — one bad variation must not kill the rest
        # EVERY way of ending badly looks in the slot, not just the unreadable
        # ones. `_Unresolved` was the only arm that did, which left a finished
        # render stranded whenever RunPod reported FAILED/TIMED_OUT/CANCELLED
        # after the worker's upload, or handed back an empty payload — the same
        # "paid render, red tile" the rescue exists to prevent, one branch along.
        if not _collect_stranded(session_id, var, upload_keys,
                                 f"the job ended unusably ({str(e)[:160]})"):
            with _LOCK:
                var.update(status="failed", error=str(e)[:600], finished=_now())
            print(f"[video] {session_id} v{var['index']:03d} failed: {e}", flush=True)
    _write_meta(session_id, session)


def _keep(session_id: str, var: dict, blob: bytes, upload_keys: list | None) -> None:
    """Persist a collected render and settle its variation as done."""
    fname = _persist(session_id, var["index"], blob)
    # The hand-off slots are scratch. `_persist` has just written the real
    # object, so leaving them would double every session's storage and put
    # files under the session prefix that nothing references.
    _clear_upload_slots(upload_keys)
    with _LOCK:
        var.update(status="done", file=fname, bytes=len(blob),
                   finished=_now(), error="")


def _collect_stranded(session_id: str, var: dict, upload_keys: list | None,
                      why: str, newer_than: float = 0.0) -> bool:
    """Take the render out of the hand-off slot when the job itself ended badly.
    True when there was one. The caller settles the variation only if this is False.

    What stops it collecting the WRONG render is that `_submit` empties the slots
    before the job runs, so whatever is in them belongs to this attempt. Two callers
    do NOT go through `_submit` — `_adopt`'s lost-job-id arm, and a `queued`
    variation caught by the runner-died sweep — so they pass `newer_than` (the
    attempt's `started`) and a slot older than that is ignored. Without it, a tile
    stopped and then re-rolled could come back green showing the CANCELLED
    attempt's render under the new seed's recipe: wrong bytes, silently, which is
    worse than the red tile it replaces.
    """
    try:
        blob = _rescue_upload(upload_keys, newer_than=newer_than)
        if blob is None:
            return False
        # `remote_status` is a record in `meta.json`, not something the page shows —
        # the tile is `done` an instant later and the UI only renders it while a
        # tile is running. It is here so the next person reading a session doc can
        # see which tiles came back this way.
        with _LOCK:
            var["remote_status"] = "RECOVERED"
        _keep(session_id, var, blob, upload_keys)
    except Exception as e:  # noqa: BLE001 — a rescue that fails is just a miss
        # NOTHING here may escape. These calls happen inside `except` arms, where a
        # raise is not caught by a sibling handler: it escapes `_run_variation`,
        # whose claim is already cleared by `run_one`'s `finally`, so the dispatcher
        # re-picks the still-`running` tile as a resume candidate and spins on it —
        # measured at ~500 re-attaches in six seconds, with `_ACTIVE` pinned and
        # every later Generate refused. An R2 PUT wobble is enough to trigger it,
        # which is precisely what `_rescue_upload` already retries for.
        print(f"[video] {session_id} v{var['index']:03d} could not collect a "
              f"stranded render ({e})", flush=True)
        return False
    print(f"[video] {session_id} v{var['index']:03d} collected its render from "
          f"R2 — {why}", flush=True)
    return True


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

    # PERSIST BEFORE DISPATCHING. Until this, a new session lived only in
    # `_SESSIONS`: `meta.json` was first written by the WORKER, when it began the
    # first variation. A session waiting its turn behind another therefore existed
    # nowhere but in RAM, and a restart — a deploy, a crash — erased it with no trace
    # at all. Not a lost render, a lost REQUEST: no file, no record, nothing to
    # recover, exactly "as if they were never registered".
    #
    # Queueing is what makes it likely rather than theoretical. The tool invites you
    # to line several ideas up behind the one running, and every one of them was
    # unwritten until its turn came — so the more work you had queued, the more a
    # single restart took.
    _write_meta(session_id, session)
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
    stored = _stored_session(session_id)
    if stored is None:
        raise ValueError("No such session.")
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


def _drop_variation_file(session_id: str, index: int) -> str:
    """Remove one variation's stored render from R2 and staging, and say whether
    the removal was CONFIRMED: `''` when the object is provably gone, otherwise a
    sentence describing what is still stored.

    Best-effort on the ACT — an object that is already gone IS the wanted end
    state, not an error — but not on the REPORT. `storage.delete` swallows every
    error, so a read-only token dropped the tile from the grid while its bytes
    stayed in the bucket, under a confirm dialog that says "removed for good".
    The caller decides what to do with the string: `discard_variation` shows it,
    a re-roll ignores it because the render about to be written overwrites the
    same key anyway.

    Verified with `head`, not `exists`: `exists` folds a throttled or timed-out
    HEAD into "gone", which is the one answer this must never invent.
    """
    fname = f"{index:03d}.webp"
    key = f"{_video_prefix()}/{session_id}/{fname}"
    try:
        storage.delete(key)
    except Exception as e:  # noqa: BLE001 — the local removal still stands
        print(f"[video] could not drop {session_id}/{fname}: {e}", flush=True)
    left = ""
    try:
        if storage.head(key) is not None:
            left = (f"The tile was removed here, but its render ({fname}) is STILL "
                    "stored in R2 — the tool's R2 token may lack delete permission.")
    except Exception as e:  # noqa: BLE001 — unconfirmed is not confirmed-gone
        left = (f"The tile was removed here, but whether its render ({fname}) left "
                f"R2 could not be confirmed ({type(e).__name__}) — it may still be stored.")
    if left:
        print(f"[video] {session_id}/{fname}: {left}", flush=True)
    # Staging goes either way: the slot reads `deleted` from here on, so the grid
    # never draws the tile again and nothing would serve these bytes — keeping them
    # would only hold disk against a render nobody can reach.
    try:
        (Path(project_paths.resolve()["staging_root"]) / "video" / session_id
         / fname).unlink()
    except OSError:
        pass
    return left


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

    A byte removal R2 refused comes back as `warning` on the session, NOT as an
    error: the author asked for the tile to go, and it does. Failing the call
    would leave a tile on screen that was asked to be removed in order to report
    a storage problem the author cannot act on from the grid — so the discard
    stands and the surviving object is named. The whole-session 🗑 is the
    opposite case and refuses loudly (see `delete_session`), because there the
    row IS the thing that would otherwise lie about what it removed.
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

    warning = _drop_variation_file(session_id, index)
    _write_meta(session_id, session)
    out = _public(session)
    if warning:
        # Per-response, never persisted: it describes THIS removal, and a stored
        # warning would follow the session around long after it stopped being true.
        out["warning"] = warning
    return out


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
    stored = _stored_session(session_id)
    if stored is None:
        return None
    if stored.get("status") in ("running", "queued"):
        stored = _adopt(stored) or stored
    return stored


def _adopt(stored: dict, collect_only: bool = False) -> dict | None:
    """Take over an orphaned session: put it back in memory and restart its
    worker, which resumes from each variation's recorded state.

    `collect_only` narrows that to the jobs RunPod is ALREADY holding — the boot
    sweep's mode, where nobody asked for anything just now. See `resume_orphans`.
    """
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
            if v.get("status") not in ("running", "queued"):
                continue
            # A missing blueprint blocks RE-RUNNING the session. It says nothing
            # about a render that already exists, so collect that first.
            if _collect_stranded(
                    sid, v, _upload_slot_keys(_slot_prefix(sid, v.get("index") or 0)),
                    "its blueprint is gone, but the render was not",
                    newer_than=float(v.get("started") or 0)):
                continue
            v["status"] = "failed"
            v["error"] = ("The blueprint this session used is no longer in "
                          "the library, so it cannot be resumed.")
        _write_meta(sid, stored)
        return stored
    for v in stored.get("variations", []):
        # Submitted-but-unrecorded: the id was lost with the process, so we
        # cannot re-attach and must not silently re-submit a paid job.
        if v.get("status") == "running" and not v.get("job_id"):
            # But the RENDER may be here regardless. The slot keys come from the
            # session id and the variation index, never from the job id — so this
            # is the one lost-job case where the result is still addressable, and
            # marking it failed without looking threw away a finished render.
            if _collect_stranded(
                    sid, v, _upload_slot_keys(_slot_prefix(sid, v.get("index") or 0)),
                    "it lost its job id to a restart",
                    newer_than=float(v.get("started") or 0)):
                # PERSISTED HERE. `_keep` has already emptied the slot, so unlike a
                # `failed` verdict this one is not re-derivable: a later read that
                # found the doc still saying `running` would look in an empty slot,
                # write `failed`, and orphan the render it had just rescued.
                _write_meta(sid, stored)
                continue
            v["status"] = "failed"
            v["error"] = ("Interrupted by a service restart before its job id was "
                          "recorded, and nothing was uploaded — re-roll this "
                          "variation.")
    other = _held_elsewhere(sid)
    if other is not None:
        # A live owner in another container. Hand back what storage says and touch
        # nothing: adopting would install a second dispatcher over the same session.
        print(f"[video] {sid} is held by {other.get('holderSessionId')}; "
              "not adopting", flush=True)
        return _public(stored) if "_blueprint" in stored else stored
    ctx = (str(stored.get("client") or ""), str(stored.get("project") or ""))
    with _LOCK:
        # CHECK AND INSERT UNDER ONE LOCK. Every caller reads `_SESSIONS`, decides
        # the session is orphaned, and only then gets here — so two of them (a boot
        # sweep and the browser reconnecting to the same session, which is exactly
        # when both happen) could each install their OWN dict over the same id and
        # start a second worker on it. Two workers keep separate `in_flight` sets,
        # so neither excludes the other's claim: the same queued variation is
        # submitted twice, one job id is overwritten and never collected, and the
        # two dicts race each other's `meta.json` writes.
        live = _SESSIONS.get(sid)
        if live is not None:
            return _public(live)
        stored["_blueprint"] = bp
        stored["_collect_only"] = collect_only
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
    threading.Thread(target=_run_session, args=(sid, ctx), daemon=True,
                     name=f"video-session-{sid}").start()
    return _public(stored)


def _meta_keys_since(cutoff: float) -> list[str]:
    """Every `<client>/<project>/video/<id>/meta.json` in the bucket written since
    `cutoff`.

    The client and project levels are DELIMITED listings — folder names only — so
    finding which projects even have a `video/` costs a handful of calls instead of
    paging the whole asset repo. Below that it does list every object under
    `video/` and filter, which is the session `.webp`s too: a few hundred keys per
    project, once per container start (~8s across the real bucket), and the mtime
    it needs lives on the object, not in its name.
    """
    keys: list[str] = []
    for pp in _project_prefixes():
        for o in storage.list_keys(f"{pp}video/"):
            k = str(o.get("key") or "")
            if k.endswith("/meta.json") and float(o.get("mtime") or 0) >= cutoff:
                keys.append(k)
    return keys


def _project_prefixes() -> list[str]:
    """Every `<client>/<project>/` in the bucket, from two DELIMITED listings —
    folder names only, so finding which projects exist costs a handful of calls
    rather than paging the whole asset repo."""
    out: list[str] = []
    for client in storage.list_prefixes(""):
        out += storage.list_prefixes(client)
    return out


def _is_mid_render(doc: dict) -> bool:
    """True when this stored session has work RunPod is already holding: at least
    one variation `running` with a job id.

    Which SESSIONS the boot sweep will touch. What it then does inside one is the
    other half of the same rule — `_adopt(collect_only=True)`, which re-attaches to
    those jobs and leaves every `queued` slot alone. Both halves say the same
    thing: a boot collects work already paid for and starts nothing, because
    nobody asked for anything at that moment.
    """
    return str(doc.get("status")) == "running" and any(
        v.get("status") == "running" and v.get("job_id")
        for v in doc.get("variations") or [])


def boot_recovery() -> None:
    """What a fresh container does about the one that went away: re-attach to the
    jobs it left in flight, then sweep every project's hand-off prefix for renders
    nothing is coming back for. In that order — a session adopted by the first pass
    is live, and the sweep deliberately leaves live sessions alone."""
    resume_orphans()
    try:
        prefixes = _project_prefixes()
    except Exception as e:  # noqa: BLE001 — a sweep we cannot start is not an outage
        print(f"[video] could not list projects to sweep ({e})", flush=True)
        return
    for pp in prefixes:
        try:
            client, project = pp.strip("/").split("/", 1)
        except ValueError:
            continue
        # The context belongs to the PROJECT being swept: `_persist` and
        # `_write_meta` resolve it, and without this a collected render would land
        # in the env-default project.
        project_paths.set_context(client, project)
        sweep_stranded_slots(pp)


def resume_orphans() -> list[str]:
    """Re-attach, at startup, to every session the previous container left in
    flight. Returns the session ids adopted.

    Adoption already existed — but only as something a READ triggers, and the
    reader is a person. On 2026-09-07 three Railway rollouts orphaned two sessions
    and nobody opened them for two and a half hours; by then RunPod had dropped
    every job record (it keeps a finished one about half an hour) and five
    finished renders had to be recovered from their hand-off slots by hand (eight
    more, from earlier in the week, were found in the same sweep). A
    container that looks the moment it boots re-attaches within seconds, while the
    job is still readable and its result still collectable the ordinary way.

    It COLLECTS; it does not start. A session qualifies only with a job already in
    flight (`_is_mid_render`), and it is adopted `collect_only`, so the variations
    its author had queued behind that job stay queued — finishing a grid unattended
    hours later, once per rollout that caught it, is spending nobody asked for. The
    session is handed back to storage still `running`, and opening it resumes the
    rest the ordinary way, which is a person deciding to spend.

    Never raises: this runs beside the server's own startup, and a bucket it cannot
    sweep must cost the recovery, not the tool.
    """
    adopted: list[str] = []
    try:
        keys = _meta_keys_since(_now() - RESUME_WINDOW_HOURS * 3600)
    except Exception as e:  # noqa: BLE001 — a sweep we cannot run is not an outage
        print(f"[video] could not scan for interrupted sessions ({e})", flush=True)
        return adopted
    for key in keys:
        try:
            doc = _read_session_doc(key)
            if not doc or not _is_mid_render(doc):
                continue
            sid = str(doc.get("id") or "")
            with _LOCK:
                if sid in _SESSIONS:
                    continue

            # WHERE THE DOC LIVES is what says which project it belongs to. Its own
            # `client`/`project` fields are the same answer when all is well, but a
            # missing or unslugged one falls back to the env default inside
            # `set_context` — and then `_adopt`, `_persist` and `_write_meta` all
            # land in the wrong project. The key cannot be wrong: it is the address
            # the doc was read from.
            client, project = key.split("/", 2)[:2]
            doc["client"], doc["project"] = client, project
            project_paths.set_context(client, project)
            # AFTER the context is set, never before: the lease path is resolved
            # from the calling thread's project, so a check made up here would read
            # `<previous project>/_leases/...` — almost always absent, so it would
            # answer "nobody holds it" for every session but one.
            if _held_elsewhere(sid) is not None:
                # The old container is still draining this one. A boot sweep is the
                # least aggressive claimant in the system: when that container goes,
                # the lease expires and the next read adopts.
                continue
            # One running session plus a full queue behind it is everything the
            # runner can hold. Adopting past that would fill `_QUEUE` with sessions
            # nobody asked for now and refuse the author's next Generate.
            if len(adopted) >= 1 + MAX_QUEUED_SESSIONS:
                print(f"[video] more interrupted sessions than the queue holds; "
                      f"{key} stays for whoever opens it", flush=True)
                continue
            _adopt(doc, collect_only=True)
            # Membership, not `_adopt`'s return value: it answers with the session
            # either way, including the one case where it takes nothing on — a
            # blueprint that no longer exists, which it settles and writes back.
            with _LOCK:
                if sid in _SESSIONS:
                    adopted.append(sid)
        except Exception as e:  # noqa: BLE001 — one bad doc must not stop the rest
            print(f"[video] could not resume {key} ({e})", flush=True)
    if adopted:
        print(f"[video] resuming {len(adopted)} session(s) interrupted by the last "
              f"restart: {', '.join(adopted)}", flush=True)
    return adopted


def _slot_owner(key: str) -> tuple[str, int] | None:
    """`(session id, variation index)` for a hand-off object, or None if the name
    is not one of ours. Reads the shape `_slot_prefix` writes."""
    m = _SLOT_RE.search(key)
    return (m.group(1), int(m.group(2))) if m else None


def _maybe_sweep_slots() -> None:
    """Kick a sweep of the CALLING thread's project, at most every
    `SLOT_SWEEP_MINUTES`.

    Off the back of a session listing because that is the moment someone is
    actually looking at these sessions, and in a thread because a listing must
    never wait on a bucket walk.
    """
    if SLOT_SWEEP_MINUTES <= 0:
        return
    ctx = (project_paths.client_name(), project_paths.project_name())
    with _LOCK:
        if _now() - _LAST_SWEEP.get(ctx, 0.0) < SLOT_SWEEP_MINUTES * 60:
            return
        _LAST_SWEEP[ctx] = _now()

    def run() -> None:
        # A new thread inherits no context, and the sweep writes files.
        project_paths.set_context(*ctx)
        sweep_stranded_slots()

    threading.Thread(target=run, daemon=True, name="video-slot-sweep").start()


def sweep_stranded_slots(project_prefix: str = "") -> dict:
    """Re-home anything left in `video/_out/`, and delete what can never be homed.

    Every terminal path collects from the hand-off slot now, so in principle a slot
    is only ever occupied between a worker's PUT and its collect. This is what makes
    that CHECKABLE rather than assumed: on 2026-09-07 thirteen finished renders sat
    in `_out/` for up to five days and were found only because someone went looking,
    and nothing but this would have said so.

    Per slot object, decided from what the session doc says:
      * variation not settled, slot written since the attempt began → COLLECT it
      * variation already `done`, or gone, or the session doc is gone → DELETE it
        (scratch a failed `_clear_upload_slots` left behind, or a re-roll's leavings)
      * slot older than the attempt's `started` → DELETE it: `_submit` would have
        cleared it, and it can never legitimately be collected as this attempt
      * session still `running`/`queued`, or live in this process → LEAVE IT ALONE.
        A job in flight may have uploaded seconds ago and its own poller is about to
        collect; taking it first would leave that poller reporting "the worker said
        it uploaded, but nothing is there".

    Returns `{collected, deleted, left}`. Never raises: this runs beside a listing
    and at container start, and a bucket it cannot sweep must cost the sweep only.
    """
    pp = project_prefix or f"{project_paths.resolve()['r2_project_prefix']}/"
    out = {"collected": 0, "deleted": 0, "left": 0}
    try:
        objs = storage.list_keys(f"{pp}video/_out/")
    except Exception as e:  # noqa: BLE001 — an unlistable prefix is not an outage
        print(f"[video] could not sweep {pp}video/_out/ ({e})", flush=True)
        return out
    by_session: dict[str, list[tuple[int, str, float]]] = {}
    for o in objs:
        key = str(o.get("key") or "")
        owner = _slot_owner(key)
        if owner:
            by_session.setdefault(owner[0], []).append(
                (owner[1], key, float(o.get("mtime") or 0)))
    for sid, slots in sorted(by_session.items()):
        try:
            out_one = _sweep_one_session(pp, sid, slots)
        except Exception as e:  # noqa: BLE001 — one bad session must not stop the rest
            print(f"[video] could not sweep {sid} ({e})", flush=True)
            out["left"] += len(slots)
            continue
        for k in out:
            out[k] += out_one[k]
    if out["collected"] or out["deleted"]:
        print(f"[video] slot sweep of {pp}: collected {out['collected']}, "
              f"deleted {out['deleted']}, left {out['left']}", flush=True)
    return out


def _sweep_one_session(pp: str, sid: str,
                       slots: list[tuple[int, str, float]]) -> dict:
    """The sweep's verdict for one session's leftover slot objects."""
    out = {"collected": 0, "deleted": 0, "left": 0}
    doc = _read_session_doc(f"{pp}video/{sid}/meta.json") if valid_session_id(sid) \
        else None
    with _LOCK:
        live = sid in _SESSIONS
    if doc is not None and _held_elsewhere(sid) is not None:
        out["left"] += len(slots)
        return out
    if doc is not None and (live or doc.get("status") in ("running", "queued")):
        out["left"] += len(slots)
        return out
    by_index = {v.get("index"): v for v in (doc or {}).get("variations", [])}
    touched = False
    for index, key, mtime in sorted(slots):
        var = by_index.get(index)
        started = float((var or {}).get("started") or 0)
        if var is not None and var.get("status") != "done" and mtime >= started:
            if _collect_stranded(sid, var, [key],
                                 "it was found by the hand-off sweep",
                                 newer_than=started):
                out["collected"] += 1
                touched = True
                continue
            out["left"] += 1
            continue
        # Nothing can ever collect this one: the tile is done, the variation or the
        # whole session is gone, or the object predates the attempt it would be
        # offered as. `_submit` deletes exactly these on the next attempt anyway.
        storage.delete(key)
        out["deleted"] += 1
    if touched and doc is not None:
        _write_meta(sid, doc)
    return out


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
    # STOP IS THE TAKEOVER. It must reach a session whichever container owns it —
    # "the session someone most wants to stop is the one a restart orphaned" — so it
    # claims the lease rather than asking for it. The old owner's next write then
    # loses its compare-and-swap and stands down instead of re-writing `running`.
    try:
        lease.takeover(_lease_key(session_id), _holder())
    except Exception:  # noqa: BLE001 — a stop is never blocked by its own bookkeeping
        pass
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
            stopping = [v for v in s["variations"]
                        if settle and v["status"] in ("queued", "running")]
    if s and stopping:
        # Outside the lock: this reads R2. A `running` tile here carries a job id
        # whose worker may already have PUT its render — the queued-orphan case
        # reaches this arm just by opening two sessions after a redeploy.
        for v in stopping:
            if not _collect_stranded(
                    session_id, v,
                    _upload_slot_keys(_slot_prefix(session_id, v["index"])),
                    "the session was stopped after the worker had uploaded",
                    newer_than=float(v.get("started") or 0)):
                with _LOCK:
                    v.update(status="cancelled", finished=_now())
    if s and settle:
        with _LOCK:
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
    stored = _stored_session(session_id)
    if stored is None:
        raise ValueError("No such session.")
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
        # The session someone most wants to stop is the orphaned one — which is
        # also the one whose job has had the longest to finish and upload.
        if _collect_stranded(
                session_id, v,
                _upload_slot_keys(_slot_prefix(session_id, v.get("index") or 0)),
                "the session was stopped after the worker had uploaded",
                newer_than=float(v.get("started") or 0)):
            continue
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


def _read_session_doc(key: str) -> dict | None:
    """One session's stored doc. `None` only when it is genuinely not there or is
    unparseable; a transport failure is RETRIED and then raised.

    The retry is the point. This runs once per session on every listing, so with
    thirty-odd sessions a single flaky read per refresh is likely rather than rare —
    and the old code turned each one into a session that had simply ceased to exist.
    """
    last = None
    for attempt in range(3):
        try:
            raw = storage.get_strict(key)
        except storage.ObjectUnreadable as e:
            last = e
            time.sleep(0.15 * (attempt + 1))
            continue
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except ValueError:
            return None  # a corrupt doc really is unusable; skipping it is honest
    raise last  # type: ignore[misc]


def _stored_session(session_id: str) -> dict | None:
    """This session's stored doc, or None when it genuinely is not there.

    Every path that reads one goes through here, because they all had the same fault:
    `storage.get` answers a flaky read and a missing object identically, so a moment's
    trouble reaching R2 made a session that exists look like a session that never did
    — "no such session" on open, on cancel, on add. The listing was only the loudest
    version of it.
    """
    return _read_session_doc(f"{_video_prefix()}/{session_id}/meta.json")


def list_sessions() -> list[dict]:
    """Every session for the calling thread's project, newest first. R2 is the
    source of truth (it survives a restart); live in-memory state wins where both
    exist, because it is fresher than the last `meta.json` flush.

    RAISES rather than returning a short list. Both halves of this used to swallow:
    a failed read of one session's doc was indistinguishable from that session not
    existing (`storage.get` returns None for both), and a failed LISTING fell back to
    whatever happened to be in memory. Either way the caller got a plausible, ordered,
    complete-looking answer that was missing work — which is exactly what "after a
    refresh most of my generations disappear, as if they were never registered"
    was: nothing was ever lost from the bucket, the list just stopped mentioning it.

    A short list nobody can tell is short is worse than an error, because the author
    acts on it — re-running renders they already have, or believing an afternoon's
    work is gone.
    """
    out: dict[str, dict] = {}
    prefix = _video_prefix() + "/"
    keys = [o.get("key", "") for o in storage.list_keys(prefix)
            if str(o.get("key", "")).endswith("/meta.json")]
    # Concurrent because it is one round trip per session and they are independent —
    # thirty of them in series is both slow and thirty chances to trip.
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=8) as pool:
        docs = list(pool.map(_read_session_doc, keys))
    for key, doc in zip(keys, docs):
        if doc is not None:
            out[key[len(prefix):].split("/", 1)[0]] = doc
    with _LOCK:
        for sid, s in _SESSIONS.items():
            # CLIENT AND project. Matching on the project alone was survivable while
            # only requests put sessions in memory; the boot sweep loads every
            # client's, so two clients sharing a project slug (`cloud`, the default,
            # is the obvious pair) would each list the other's.
            if (s.get("project") == project_paths.project_name()
                    and s.get("client") == project_paths.client_name()):
                out[sid] = _public(s)
    _maybe_sweep_slots()
    return sorted(out.values(), key=lambda s: s.get("created", 0), reverse=True)


def _survivors(prefixes: tuple[str, ...]) -> list[str]:
    """Re-list `prefixes` and return the keys that OUTLIVED a delete.

    `storage.delete` swallows every error — a read-only token, a transport blip —
    so the delete path itself cannot tell a removal from a no-op, and answering
    "deleted" for objects still sitting in the bucket is the exact false success
    the Sheet Maker's delete had to grow a verify pass to stop telling.

    A listing that RAISES counts as a survivor, not as clean: "I could not check"
    and "there is nothing there" are different answers, and only one of them may
    be reported as a successful delete.
    """
    left: list[str] = []
    for prefix in prefixes:
        try:
            left += [o["key"] for o in storage.list_keys(prefix)]
        except Exception as e:  # noqa: BLE001 — unconfirmed reads as not-gone
            left.append(f"{prefix} (could not re-list: {type(e).__name__}: {e})")
    return left


def delete_session(session_id: str) -> dict:
    """Remove a session's objects from R2 + staging. Nothing prunes
    `<project>/video/` on its own, so this is the only way a session goes away.

    R2 is the SOURCE OF TRUTH and it is VERIFIED: after deleting we re-list the
    prefixes and raise if anything survived, so a delete that R2 refused is
    reported instead of being drawn as a session that went away. The rail is
    rebuilt from the stored `meta.json`, so a refused delete puts the session
    straight back rather than stranding its bytes behind a row nobody can see.
    """
    if not valid_session_id(session_id):
        raise ValueError("Bad session id.")
    with _LOCK:
        s = _SESSIONS.get(session_id)
        if s and s.get("status") in ("running", "queued"):
            raise ValueError("Cancel the session before deleting it.")
        _SESSIONS.pop(session_id, None)
        if session_id in _QUEUE:
            _QUEUE.remove(session_id)
    removed = 0
    # The session's own objects AND its hand-off slots. The slots live under
    # `video/_out/`, not under the session, so deleting only the session prefix
    # leaked one file per stranded render — unreferenced, unreachable, and paid for.
    prefixes = (f"{_video_prefix()}/{session_id}/",
                f"{_video_prefix()}/_out/{_slot_prefix(session_id, 0)[:-3]}")
    try:
        lease.release(_lease_key(session_id), _holder())
        storage.delete(_lease_key(session_id).path())
    except Exception:  # noqa: BLE001 — a stale lease expires on its own
        pass
    _META_ETAGS.pop(f"{_video_prefix()}/{session_id}/meta.json", None)
    for prefix in prefixes:
        try:
            for obj in storage.list_keys(prefix):
                storage.delete(obj["key"])
                removed += 1
        except Exception as e:  # noqa: BLE001
            print(f"[video] delete failed for {session_id}: {e}", flush=True)

    # VERIFY before reporting success — and before clearing staging, so a refused
    # delete leaves the renders still viewable here instead of half-gone. The
    # leftover key is named because a PARTIAL delete (meta.json gone, one render
    # left) drops the session from the rail, and then this message is the only
    # thing that says where the orphan is.
    remaining = _survivors(prefixes)
    if remaining:
        print(f"[video] delete left {len(remaining)} object(s) for {session_id}: "
              f"{remaining[0]}", flush=True)
        raise ValueError(
            f"Could not delete this session from R2 — {len(remaining)} object(s) "
            "still remain at the source, so it was NOT removed. The tool's R2 "
            "token may lack delete permission. "
            f"(First leftover: {remaining[0]})")

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
