"""Resumable still renders: a job record per RunPod job, a lease per render, and an
optional signed completion callback.

Design: docs/director/DECISIONS/0002-tool-adapters.md ("GPU jobs"), and the video
runner's queue / lease / `resume_orphans` it mirrors (`video_runner.py`).

A still render (`/render`) runs as a subprocess that submits one RunPod job per
region-variant and polls it to the end. Before this module the job id lived only in
that subprocess, so a container restart (every push to `main` is one) lost every job
in flight — paid for, and never collected. Now each render gets a stable `jobRef`
and leaves this in R2, beside the project and out of hydrated staging:

    <client>/<project>/_jobs/still/<jobRef>/
        render.json             # who asked, which manifest, status, callback, GPU time
        job_001.json            # one per RunPod job: id, endpoint, GPU, region, slot,
                                # status, and once settled its execution time (`usage`)
        job_001.payload.json    # the submitted job body, kept until it settles —
                                # what a re-queue resubmits

The container that runs the render holds a lease on the jobRef (`iw_common.lease`,
renewed while the subprocess lives). A fresh container looks at boot for renders
still `running` whose lease nobody holds, re-attaches to each job still marked
`submitted`, and collects it the way the subprocess would have. A job RunPod no
longer knows is resubmitted ONCE from its stored payload; a second loss fails it.
A render the old container still held at boot (a rolling deploy overlaps the two)
is re-checked once its lease can have expired, and a finished render whose callback
was never delivered is delivered again — at least once, so a receiver dedupes on
`jobRef`.

A job is CLAIMED before its variant is written: `submitted` -> `collecting`, with
the variant's filename, on a conditional write. Whoever loses that write does not
persist, and a job found `collecting` after a crash is finished under the same
filename, created `If-None-Match: *` — so a job is never saved twice.

Every write is conditional: records are created `If-None-Match: *` and changed
`If-Match` on the ETag just read (`_cas`). The manifest itself is only written by
the caller's finish hook, which goes through `_write_manifest_at`.

Fails open throughout: R2 that cannot be read or written costs the resumability of
this render, never the render.

Billing (ADR-0006): each settled job keeps the `executionTime` RunPod reported for it
and the GPU the endpoint ran it on (`RUNPOD_ENDPOINT_GPU`, recorded at submit). The
render's `runpod` summary — `{gpu, seconds, delaySeconds, jobs, unreported}` — is what
`/progress?jobRef=` and the completion callback carry, so the Director worker can price
the render from `pricing.json`. No price is computed here.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
import uuid
from typing import Callable

import cloud_paths as project_paths
import storage
from iw_common import errors, lease

# Which container this is — the same identity the video runner claims with, so one
# process is one lease holder across both runners.
INSTANCE_ID = ((os.environ.get("RAILWAY_REPLICA_ID")
                or os.environ.get("RAILWAY_DEPLOYMENT_ID")
                or uuid.uuid4().hex)[:24])

LEASE_TOOL = "atlasStill"
LEASE_RENEW_SECONDS = lease.LEASE_HEARTBEAT_MS / 1000.0
# A render held by another container at boot is looked at again after its lease
# can have expired, this many times. A rolling deploy's overlap is well under a
# minute, so the tail is only for an old container that is slow to die.
DEFER_RECHECK_SECONDS = lease.LEASE_TTL_MS / 1000.0 + 15
DEFER_RECHECKS = 40
# A render older than this is not resumed: RunPod dropped its jobs long ago, and
# re-queueing them would spend on a render nobody is waiting for. It is settled
# `failed` instead, so its callback still fires. The same window bounds callback
# redelivery.
RESUME_WINDOW_HOURS = float(os.environ.get("STILL_RESUME_WINDOW_HOURS") or 12)
# The subprocess gives a job 30 minutes from submit; a resumed job gets the same.
JOB_TIMEOUT_SECONDS = 1800
POLL_SECONDS = 2.0
STATUS_GRACE_SECONDS = 180.0
# A 404 on a job RunPod should know is re-checked on this schedule before it is
# believed — the same schedule as `batch_atlas.NOT_FOUND_RECHECK_SECONDS`.
NOT_FOUND_RECHECK_SECONDS = (10.0, 20.0, 40.0, 80.0)
CALLBACK_TIMEOUT_SECONDS = 10
CALLBACK_RETRY_SECONDS = (2.0, 8.0)
# A token may live at most this long: a caller mints one per render.
MAX_TOKEN_TTL_SECONDS = 24 * 3600
# How long a signed callback POST stays acceptable to a receiver that checks `t=`.
SIGNATURE_TOLERANCE_SECONDS = 300

TERMINAL = ("finished", "failed", "cancelled")
SETTLEABLE = ("submitted", "collecting")
_REF_RE = re.compile(r"^st_[0-9a-f]{16}$")
_TOKEN_SCOPE = "atlas-callback.v1"

# Renders this process is running, resuming or delivering right now. Adoption
# checks it so a render this container owns is never taken on a second time.
_LIVE: set[str] = set()
_LIVE_LOCK = threading.Lock()

# Seams the fixtures replace.
_sleep = time.sleep
_now = time.time


# --------------------------------------------------------------------------
# Keys + records
# --------------------------------------------------------------------------

def new_job_ref() -> str:
    return f"st_{uuid.uuid4().hex[:16]}"


def valid_job_ref(ref: str) -> bool:
    return bool(_REF_RE.match(ref or ""))


def _prefix() -> str:
    """`<client>/<project>` for the CALLING thread's context. Not via `resolve()`,
    which hydrates the project's staging — a boot sweep over every project would
    pull them all."""
    return project_paths.r2_project_prefix(
        project_paths.r2_slug(project_paths.client_name()),
        project_paths.r2_slug(project_paths.project_name()))


def _root() -> str:
    return f"{_prefix()}/_jobs/still"


def _render_key(ref: str) -> str:
    return f"{_root()}/{ref}/render.json"


def _job_key(ref: str, seq: int) -> str:
    return f"{_root()}/{ref}/job_{seq:03d}.json"


def _payload_key(ref: str, seq: int) -> str:
    return f"{_root()}/{ref}/job_{seq:03d}.payload.json"


def _read(key: str) -> tuple[dict | None, str | None]:
    """The stored doc and its ETag; `(None, None)` when absent. Raises
    `storage.ObjectUnreadable` when R2 could not be asked."""
    got = storage.get_with_etag(key)
    if not got:
        return None, None
    body, etag = got
    try:
        doc = json.loads(body)
    except ValueError:
        return None, etag
    return (doc if isinstance(doc, dict) else None), etag


def _dump(doc: dict) -> bytes:
    return json.dumps(doc, indent=2, ensure_ascii=False).encode("utf-8")


def _create(key: str, doc: dict) -> bool:
    """Create-only. False when the key is already taken or R2 refused."""
    try:
        storage.put(key, _dump(doc), "application/json", if_none_match="*")
        return True
    except storage.Conflict:
        return False
    except Exception as e:  # noqa: BLE001 — fail open: the render goes on
        print(f"[still-jobs] could not create {key} ({e})", flush=True)
        return False


def _cas(key: str, mutate: Callable[[dict], dict | None],
         attempts: int = 5) -> dict | None:
    """Read-modify-write on the ETag just read. `mutate` returns the new doc, or
    None to leave it alone. Returns what landed, else None (nothing there, mutate
    declined, R2 unreachable, or it kept losing)."""
    for _ in range(attempts):
        try:
            doc, etag = _read(key)
        except Exception as e:  # noqa: BLE001
            print(f"[still-jobs] could not read {key} ({e})", flush=True)
            return None
        if doc is None:
            return None
        new = mutate(json.loads(json.dumps(doc)))
        if new is None:
            return None
        try:
            storage.put(key, _dump(new), "application/json", if_match=etag or "*")
            return new
        except storage.Conflict:
            continue
        except Exception as e:  # noqa: BLE001
            print(f"[still-jobs] could not write {key} ({e})", flush=True)
            return None
    print(f"[still-jobs] {key}: gave up after {attempts} conflicting writes", flush=True)
    return None


def _jobs(ref: str) -> list[dict]:
    """Every job record of a render, in slot order."""
    out: list[dict] = []
    prefix = f"{_root()}/{ref}/job_"
    for o in storage.list_keys(prefix):
        k = str(o.get("key") or "")
        if not k.endswith(".json") or k.endswith(".payload.json"):
            continue
        doc, _etag = _read(k)
        if doc:
            out.append(doc)
    return sorted(out, key=lambda j: int(j.get("seq") or 0))


def variants_of(jobs: list[dict]) -> list[dict]:
    return [{"region": j.get("region"), "variant": j.get("variant"),
             "slot": j.get("seq")}
            for j in jobs if j.get("status") == "done" and j.get("variant")]


def _seconds_of(job: dict) -> float | None:
    usage = job.get("usage")
    s = usage.get("seconds") if isinstance(usage, dict) else None
    return float(s) if isinstance(s, (int, float)) and not isinstance(s, bool) else None


def runpod_summary(jobs: list[dict]) -> dict | None:
    """The render's GPU time, for billing (ADR-0006): the execution seconds of every
    RunPod job that reported one — a failed job's time was spent too — and the GPU
    they ran on. None when no job reported any (a receiver then has nothing to bill
    and says so). `gpu` is None unless every reported job names the same one, so a
    sum is never priced by the wrong card; `unreported` counts the RunPod jobs that
    settled without a time (lost, abandoned, never read to the end)."""
    reported = [j for j in jobs if _seconds_of(j) is not None]
    if not reported:
        return None
    gpus = {str(j.get("gpu") or "") for j in reported}
    gpu = gpus.pop() if len(gpus) == 1 and "" not in gpus else None
    delay = sum(float((j.get("usage") or {}).get("delaySeconds") or 0) for j in reported)
    return {
        "gpu": gpu,
        "seconds": round(sum(_seconds_of(j) or 0.0 for j in reported), 3),
        "delaySeconds": round(delay, 3),
        "jobs": len(reported),
        "unreported": sum(1 for j in jobs
                          if j.get("transport") == "runpod"
                          and j.get("status") not in SETTLEABLE
                          and _seconds_of(j) is None),
    }


# --------------------------------------------------------------------------
# The render's own side (ui_server)
# --------------------------------------------------------------------------

def open_render(ref: str, *, manifest: str, names: list[str], variants: int,
                user: str = "", callback: dict | None = None) -> bool:
    """Record a render as `running` under the calling thread's project."""
    doc = {
        "jobRef": ref,
        "client": project_paths.client_name(),
        "project": project_paths.project_name(),
        "manifest": manifest,
        "names": list(names),
        "variants": int(variants),
        "user": user,
        "status": "running",
        "owner": INSTANCE_ID,
        "submittedAt": _now(),
    }
    if callback:
        doc["callback"] = {"url": callback["url"], "token": callback["token"]}
    return _create(_render_key(ref), doc)


def record_plan(ref: str, total: int) -> None:
    """How many jobs this render will submit — what tells a resume whether the
    restart left regions that never started."""
    def _m(d: dict) -> dict:
        d["total"] = int(total)
        return d
    _cas(_render_key(ref), _m)


def close_render(ref: str, status: str, error: str = "") -> dict | None:
    """Move a `running` render to a terminal status, with the variants it made.
    Returns the closed doc only to the caller that made the transition.

    A job still `submitted` at this point outlived the process that was polling it
    (a stop, or a subprocess that died): it is cancelled on RunPod — nothing will
    collect it now — and recorded `abandoned`."""
    try:
        jobs = _jobs(ref)
    except Exception:  # noqa: BLE001
        jobs = []
    for j in jobs:
        if j.get("status") not in SETTLEABLE:
            continue
        if j.get("status") == "submitted" and j.get("jobId"):
            import batch_atlas
            why = batch_atlas.runpod_cancel(str(j["jobId"]), str(j.get("endpoint") or ""))
            if why:
                print(f"[still-jobs] {ref}: could not cancel abandoned job "
                      f"{j['jobId']} ({why})", flush=True)
        settled = record_settled(ref, int(j["seq"]), "abandoned",
                                 error=f"render {status}")
        if settled:
            j.update(settled)
    variants = variants_of(jobs)
    runpod = runpod_summary(jobs)

    def _m(d: dict) -> dict | None:
        if d.get("status") in TERMINAL:
            return None
        d.update(status=status, finishedAt=_now(), variants=variants)
        if runpod:
            d["runpod"] = runpod
        if error:
            d["error"] = error[:500]
        return d
    return _cas(_render_key(ref), _m)


# --------------------------------------------------------------------------
# The subprocess side (batch_atlas)
# --------------------------------------------------------------------------

def record_submitted(ref: str, seq: int, *, region: str, job_id: str,
                     endpoint: str, payload: dict, gpu: str = "",
                     provenance: dict | None = None) -> None:
    """A RunPod job is in flight. The payload is stored FIRST so a record that
    exists always has what a re-queue needs. `gpu` is the card the endpoint runs
    on now (`batch_atlas.runpod_endpoint_gpu`), kept with the job so a later change
    of endpoint never re-prices it."""
    try:
        storage.put(_payload_key(ref, seq), json.dumps(payload).encode("utf-8"),
                    "application/json", if_none_match="*")
    except Exception as e:  # noqa: BLE001 — resumable without it, just not re-queueable
        print(f"[still-jobs] could not store the payload of {ref}/{seq} ({e})",
              flush=True)
    _create(_job_key(ref, seq), {
        "jobRef": ref, "seq": int(seq), "region": region, "transport": "runpod",
        "jobId": job_id, "endpoint": endpoint, "gpu": gpu or None,
        "submittedAt": _now(), "status": "submitted", "requeued": False,
        "provenance": provenance,
    })


def record_local(ref: str, seq: int, *, region: str, variant: str) -> None:
    """A variant rendered on a live ComfyUI (not resumable: the job is the
    subprocess's own connection) — recorded so the callback can name it."""
    _create(_job_key(ref, seq), {
        "jobRef": ref, "seq": int(seq), "region": region, "transport": "comfy",
        "submittedAt": _now(), "status": "done", "variant": variant,
    })


def claim_collect(ref: str, seq: int, variant: str) -> bool:
    """Take the right to save this job's render as `variant`: `submitted` ->
    `collecting`, or a rename of a claim this container already holds. False when
    somebody else holds it or it is settled — the caller must not save."""
    def _m(d: dict) -> dict | None:
        st = d.get("status")
        if st == "collecting" and d.get("collector") != INSTANCE_ID:
            return None
        if st not in SETTLEABLE:
            return None
        d.update(status="collecting", collector=INSTANCE_ID, variant=variant)
        return d
    try:
        exists, _etag = _read(_job_key(ref, seq))
    except Exception:  # noqa: BLE001 — a store we cannot ask holds nobody
        return True
    if exists is None:
        return True    # no record (it could not be written): nothing to claim against
    return _cas(_job_key(ref, seq), _m) is not None


def record_settled(ref: str, seq: int, status: str, *, variant: str = "",
                   error: str = "", usage: dict | None = None) -> dict | None:
    """Settle a job still in flight. A job already settled is left as it is — the
    first answer wins, so a late writer cannot undo a collected render. `usage` is
    the job's time off its last status read (`batch_atlas.runpod_usage`), kept
    whatever the status: a failed job billed all the same."""
    def _m(d: dict) -> dict | None:
        if d.get("status") not in SETTLEABLE:
            return None
        d.update(status=status, settledAt=_now())
        d.pop("collector", None)
        if variant:
            d["variant"] = variant
        if error:
            d["error"] = error[:500]
        if usage:
            d["usage"] = usage
        return d
    done = _cas(_job_key(ref, seq), _m)
    if done is not None:
        try:
            storage.delete(_payload_key(ref, seq))
        except Exception:  # noqa: BLE001 — a stray payload costs bytes, not behaviour
            pass
    return done


# --------------------------------------------------------------------------
# Lease
# --------------------------------------------------------------------------

def _lease_key(ref: str) -> lease.LeaseKey:
    parts = _prefix().strip("/").split("/")
    return lease.LeaseKey(LEASE_TOOL, parts[-2], parts[-1], ref)


def _holder() -> lease.LeaseHolder:
    return lease.LeaseHolder("atlas-tool", INSTANCE_ID)


class Hold:
    """This container's lease on one render, renewed until `release()` — or until
    a renewal is refused, which means somebody took it (`lost`)."""

    def __init__(self, ref: str) -> None:
        self.ref = ref
        self.key = _lease_key(ref)
        self.lost = False
        self._stop = threading.Event()
        self.acquired = lease.acquire(self.key, _holder())
        with _LIVE_LOCK:
            _LIVE.add(ref)
        if self.acquired:
            threading.Thread(target=self._beat, daemon=True,
                             name=f"still-lease-{ref}").start()

    def _beat(self) -> None:
        while not self._stop.wait(LEASE_RENEW_SECONDS):
            try:
                if not lease.heartbeat(self.key, _holder()):
                    self.lost = True
                    return
            except Exception:  # noqa: BLE001 — expiry is the backstop
                pass

    def release(self) -> None:
        self._stop.set()
        with _LIVE_LOCK:
            _LIVE.discard(self.ref)
        try:
            lease.release(self.key, _holder())
        except Exception:  # noqa: BLE001
            pass


def _held_elsewhere(ref: str) -> bool:
    try:
        row = lease.held_by(_lease_key(ref))
    except Exception:  # noqa: BLE001 — unreadable holds nobody
        return False
    return row is not None and not lease.is_same_holder(row, _holder())


def _take(ref: str) -> Hold | str:
    """This container's hold on `ref`, or why not: `"busy"` (we already have it)
    or `"held"` (another container does)."""
    with _LIVE_LOCK:
        if ref in _LIVE:
            return "busy"
        _LIVE.add(ref)
    if _held_elsewhere(ref):
        with _LIVE_LOCK:
            _LIVE.discard(ref)
        return "held"
    hold = Hold(ref)
    if not hold.acquired:
        hold.release()
        return "held"
    return hold


# --------------------------------------------------------------------------
# Re-attaching
# --------------------------------------------------------------------------

def _await(job_id: str, endpoint: str,
           since: float) -> tuple[str, object, dict | None]:
    """Poll one RunPod job to an answer: `("completed", output, usage)`,
    `("failed", detail, usage)` or `("lost", reason, None)` — lost meaning RunPod
    has no record of it, the one case a re-queue can help. `usage` is the job's
    time off the read that answered (`batch_atlas.runpod_usage`), or None."""
    import batch_atlas
    unreadable_since = 0.0
    rechecks = 0

    def _timed_out() -> tuple[str, object, dict | None]:
        why = batch_atlas.runpod_cancel(job_id, endpoint)
        return "failed", "timed out after 30 min" + (
            f" (and RunPod would not cancel it: {why})" if why else ""), None

    # The cap is checked only AFTER a read that is not an answer: a job resumed
    # an hour after it was submitted may well have COMPLETED, and that render is
    # still collectable for as long as RunPod keeps the record.
    while True:
        now = _now()
        try:
            st = batch_atlas.runpod_status(job_id, endpoint)
        except Exception as e:  # noqa: BLE001 — a bad READ is not a bad job
            if getattr(e, "code", None) == 404:
                if rechecks < len(NOT_FOUND_RECHECK_SECONDS):
                    _sleep(NOT_FOUND_RECHECK_SECONDS[rechecks])
                    rechecks += 1
                    continue
                return "lost", "RunPod has no record of the job", None
            unreadable_since = unreadable_since or now
            if now - unreadable_since >= STATUS_GRACE_SECONDS:
                why = batch_atlas.runpod_cancel(job_id, endpoint)
                return "failed", f"lost contact with RunPod: {str(e)[:200]}" + (
                    f" (and RunPod would not cancel it: {why})" if why else ""), None
            if now - since > JOB_TIMEOUT_SECONDS:
                return _timed_out()
            _sleep(POLL_SECONDS)
            continue
        unreadable_since = 0.0
        rechecks = 0
        status = str(st.get("status") or "").upper()
        usage = batch_atlas.runpod_usage(st)
        if status == "COMPLETED":
            out = st.get("output") or {}
            if isinstance(out, dict) and out.get("error"):
                return "failed", str(out.get("error"))[:300], usage
            return "completed", out, usage
        if status in ("FAILED", "CANCELLED", "TIMED_OUT"):
            return "failed", f"job {status}: {str(st.get('error') or '')[:300]}", usage
        if now - since > JOB_TIMEOUT_SECONDS:
            return _timed_out()
        _sleep(POLL_SECONDS)


def _already_saved(variant: str) -> bool:
    """Is this variant in R2 already? A job left `collecting` by a process that
    died after its write and before its settle is done, not owed."""
    if not variant:
        return False
    try:
        return storage.head(f"{_prefix()}/batch/{variant}") is not None
    except Exception:  # noqa: BLE001 — unknown: the exclusive write below decides
        return False


def _finish_job(ref: str, job: dict) -> str:
    """Drive one in-flight job to a settled status, re-queueing it once if
    RunPod lost it. Returns the status it settled at."""
    import batch_atlas
    seq = int(job["seq"])
    fixed = str(job.get("variant") or "") if job.get("status") == "collecting" else ""
    if fixed and _already_saved(fixed):
        record_settled(ref, seq, "done", variant=fixed)
        return "done"
    while True:
        since = float(job.get("requeuedAt") or job.get("submittedAt") or _now())
        outcome, detail, usage = _await(str(job["jobId"]),
                                        str(job.get("endpoint") or ""), since)
        if outcome == "completed":
            try:
                fname, _blob = batch_atlas.persist_serverless_output(
                    str(job["region"]), detail, provenance=job.get("provenance"),
                    claim=lambda name: claim_collect(ref, seq, name),
                    filename=fixed or None, exclusive=True)
            except Exception as e:  # noqa: BLE001
                record_settled(ref, seq, "failed", error=str(e), usage=usage)
                return "failed"
            if fname is None:
                return "claimed"   # somebody else is saving it
            record_settled(ref, seq, "done", variant=fname, usage=usage)
            print(f"[still-jobs] {ref}: collected {fname} after a restart", flush=True)
            return "done"
        if outcome == "lost" and not job.get("requeued"):
            requeued = _requeue(ref, job)
            if requeued is not None:
                job = requeued
                continue
        record_settled(ref, seq, "lost" if outcome == "lost" else "failed",
                       error=str(detail), usage=usage)
        return "lost" if outcome == "lost" else "failed"


def _requeue(ref: str, job: dict) -> dict | None:
    """Resubmit a lost job from its stored payload — once. The record is marked
    `requeued` BEFORE the submit, so no crash between the two can earn it a
    second try."""
    import batch_atlas
    seq = int(job["seq"])
    try:
        payload, _etag = _read(_payload_key(ref, seq))
    except Exception:  # noqa: BLE001
        payload = None
    if not payload:
        return None

    def _claim(d: dict) -> dict | None:
        if d.get("status") not in SETTLEABLE or d.get("requeued"):
            return None
        d.update(requeued=True, previousJobId=d.get("jobId"), requeuedAt=_now())
        return d
    if _cas(_job_key(ref, seq), _claim) is None:
        return None
    try:
        jid, eid = batch_atlas.runpod_submit(payload)
    except Exception as e:  # noqa: BLE001
        print(f"[still-jobs] {ref}/{seq}: re-queue refused ({e})", flush=True)
        return None

    gpu = batch_atlas.runpod_endpoint_gpu() or None

    def _bind(d: dict) -> dict | None:
        if d.get("status") not in SETTLEABLE:
            return None
        d.update(jobId=jid, endpoint=eid, gpu=gpu)
        return d
    bound = _cas(_job_key(ref, seq), _bind)
    if bound is None:
        # The job is polled from memory below either way; only a restart before
        # it settles would lose it, and then this line is how to find it.
        print(f"[still-jobs] {ref}/{seq}: re-queued as RunPod job {jid} on endpoint "
              f"{eid} but could not record it", flush=True)
    print(f"[still-jobs] {ref}: RunPod lost job {seq} ({job.get('region')}); "
          f"re-queued once as {jid}", flush=True)
    return bound or {**job, "jobId": jid, "endpoint": eid, "gpu": gpu,
                     "requeued": True, "requeuedAt": _now()}


def _resume(ref: str, ctx: tuple[str, str], hold: Hold,
            finish: Callable[[dict], None] | None) -> None:
    """Collect every job of an orphaned render, then close it like a render
    that ran to the end: finish hook, terminal status, callback."""
    try:
        project_paths.set_context(*ctx)
        project_paths.ensure_lazy("batch/")
        doc, _etag = _read(_render_key(ref))
        if not doc or doc.get("status") in TERMINAL:
            return
        jobs = _jobs(ref)
        old = _now() - float(doc.get("submittedAt") or 0) > RESUME_WINDOW_HOURS * 3600
        for j in jobs:
            if j.get("status") not in SETTLEABLE or hold.lost:
                continue
            if old:
                record_settled(ref, int(j["seq"]), "lost", error="too old to resume")
                continue
            try:
                _finish_job(ref, j)
            except Exception as e:  # noqa: BLE001 — one job must not sink the rest
                errors.capture_error(e, job="still-resume", job_ref=ref)
                record_settled(ref, int(j["seq"]), "failed", error=str(e))
        if hold.lost:
            print(f"[still-jobs] {ref}: another container took this render over; "
                  "leaving it to them", flush=True)
            return
        jobs = _jobs(ref)
        done = [j for j in jobs if j.get("status") == "done"]
        bad = [j for j in jobs if j.get("status") not in ("done",) + SETTLEABLE]
        total = doc.get("total")
        unstarted = max(0, int(total) - len(jobs)) if total is not None else 0
        if done and finish:
            try:
                finish(doc)
            except Exception as e:  # noqa: BLE001 — same as a render's post-hook
                print(f"[still-jobs] {ref}: post-render step skipped ({e})", flush=True)
        if bad or unstarted or total is None:
            why = []
            if bad:
                why.append(f"{len(bad)} job(s) failed or were lost")
            if unstarted:
                why.append(f"{unstarted} job(s) never started")
            if total is None:
                why.append("the render was interrupted before its plan was recorded")
            closed = close_render(ref, "failed",
                                  "interrupted by a restart: " + "; ".join(why))
        else:
            closed = close_render(ref, "finished")
        if closed:
            deliver_callback(closed)
    except Exception as e:  # noqa: BLE001
        errors.capture_error(e, job="still-resume", job_ref=ref)
        print(f"[still-jobs] could not resume {ref} ({e})", flush=True)
    finally:
        hold.release()


def adopt(ref: str, finish: Callable[[dict], None] | None = None,
          *, wait: bool = False) -> str:
    """Take an orphaned render on in THIS container. `"adopted"`, `"busy"` (this
    process already has it) or `"held"` (another container does)."""
    hold = _take(ref)
    if not isinstance(hold, Hold):
        return hold
    ctx = (project_paths.client_name(), project_paths.project_name())
    if wait:
        _resume(ref, ctx, hold, finish)
    else:
        threading.Thread(target=_resume, args=(ref, ctx, hold, finish), daemon=True,
                         name=f"still-resume-{ref}").start()
    return "adopted"


def _owes_callback(doc: dict) -> bool:
    """A closed render whose callback never landed, recently enough to matter."""
    return (doc.get("status") in TERMINAL and bool(doc.get("callback"))
            and not doc.get("callbackDelivered")
            and _now() - float(doc.get("finishedAt") or 0)
            < RESUME_WINDOW_HOURS * 3600)


def redeliver(ref: str) -> str:
    """Deliver a closed render's undelivered callback again, under its lease so
    two containers do not both send it. Same answers as `adopt`."""
    hold = _take(ref)
    if not isinstance(hold, Hold):
        return hold
    try:
        doc, _etag = _read(_render_key(ref))
        if doc and _owes_callback(doc):
            deliver_callback(doc)
    except Exception as e:  # noqa: BLE001
        print(f"[still-jobs] could not redeliver {ref} ({e})", flush=True)
    finally:
        hold.release()
    return "adopted"


def _visit(ref: str, finish, wait: bool) -> str:
    """What the sweep does with one render: adopt it if it is running, redeliver
    its callback if it owes one. `"held"` means look again later."""
    doc, _etag = _read(_render_key(ref))
    if not doc:
        return "done"
    if doc.get("status") == "running":
        return adopt(ref, finish, wait=wait)
    if _owes_callback(doc):
        return redeliver(ref)
    return "done"


def _project_keys() -> list[tuple[str, str]]:
    """Every (client, project) in the bucket whose names are real slugs. Anything
    else at the top level (`_users/`, …) is not a project, and `set_context` would
    quietly fall back to the env default for it."""
    out: list[tuple[str, str]] = []
    for cp in storage.list_prefixes("", complete=False):
        for pp in storage.list_prefixes(cp, complete=False):
            parts = pp.strip("/").split("/")
            if len(parts) != 2:
                continue
            c, p = parts
            if project_paths.r2_slug(c) == c and project_paths.r2_slug(p) == p:
                out.append((c, p))
    return out


def resume_orphans(finish: Callable[[dict], None] | None = None,
                   *, wait: bool = False) -> list[str]:
    """At boot: adopt every render the last container left `running`, redeliver
    callbacks that never landed, and keep looking at the renders another container
    still held until its lease has had time to expire. Returns the jobRefs adopted
    on the first pass. Never raises — a bucket it cannot sweep costs the recovery,
    not the tool."""
    adopted: list[str] = []
    deferred: list[tuple[str, str, str]] = []
    try:
        projects = _project_keys()
    except Exception as e:  # noqa: BLE001
        print(f"[still-jobs] could not list projects ({e})", flush=True)
        return adopted
    for client, project in projects:
        try:
            project_paths.set_context(client, project)
            for pref in storage.list_prefixes(f"{_root()}/", complete=False):
                ref = pref.rstrip("/").rsplit("/", 1)[-1]
                if not valid_job_ref(ref):
                    continue
                got = _visit(ref, finish, wait)
                if got == "adopted":
                    adopted.append(ref)
                elif got == "held":
                    deferred.append((client, project, ref))
        except Exception as e:  # noqa: BLE001 — one project must not stop the rest
            print(f"[still-jobs] could not scan {client}/{project} ({e})", flush=True)
    if adopted:
        print(f"[still-jobs] resuming {len(adopted)} render(s) interrupted by the "
              f"last restart: {', '.join(adopted)}", flush=True)
    if deferred:
        print(f"[still-jobs] {len(deferred)} render(s) still held by the previous "
              "container; looking again once its lease can have expired", flush=True)
        if wait:
            _recheck_deferred(deferred, finish, wait)
        else:
            threading.Thread(target=_recheck_deferred, args=(deferred, finish, False),
                             daemon=True, name="still-resume-deferred").start()
    return adopted


def _recheck_deferred(deferred: list[tuple[str, str, str]], finish,
                      wait: bool) -> None:
    """The boot sweep runs while the old container is still up and renewing its
    leases, so most of what it finds is `held`. Without this, those renders waited
    for the next boot — by when RunPod had dropped the results."""
    for _ in range(DEFER_RECHECKS):
        if not deferred:
            return
        _sleep(DEFER_RECHECK_SECONDS)
        still: list[tuple[str, str, str]] = []
        for client, project, ref in deferred:
            try:
                project_paths.set_context(client, project)
                if _visit(ref, finish, wait) == "held":
                    still.append((client, project, ref))
            except Exception as e:  # noqa: BLE001
                print(f"[still-jobs] could not re-check {ref} ({e})", flush=True)
        deferred = still
    if deferred:
        print(f"[still-jobs] gave up waiting on {len(deferred)} render(s) another "
              "container still holds", flush=True)


def job_view(ref: str, finish: Callable[[dict], None] | None = None) -> dict | None:
    """`/progress?jobRef=`: the render's state and its jobs, for the CALLER's
    project. A render left `running` by a container that is gone is adopted here
    too, so a watcher's read is a further way in for an orphan. Raises
    `storage.ObjectUnreadable` when R2 cannot be read."""
    if not valid_job_ref(ref):
        return None
    doc, _etag = _read(_render_key(ref))
    if not doc:
        return None
    if doc.get("status") == "running":
        adopt(ref, finish)
    jobs = _jobs(ref)
    view = {k: v for k, v in doc.items() if k != "callback"}
    if doc.get("callback"):
        view["callback"] = {k: v for k, v in doc["callback"].items() if k != "token"}
    view["jobs"] = [{k: v for k, v in j.items() if k != "provenance"} for j in jobs]
    view["variants"] = variants_of(jobs)
    # Live from the jobs, so a watcher sees the time a running render has spent so far.
    runpod = runpod_summary(jobs)
    if runpod:
        view["runpod"] = runpod
    else:
        view.pop("runpod", None)
    return view


# --------------------------------------------------------------------------
# Completion callback
# --------------------------------------------------------------------------

def _secret() -> bytes:
    return (os.environ.get("ATLAS_CALLBACK_SECRET") or "").encode("utf-8")


def _token_mac(secret: bytes, url: str, exp: int) -> str:
    return hmac.new(secret, f"{_TOKEN_SCOPE}|{url}|{exp}".encode("utf-8"),
                    hashlib.sha256).hexdigest()


def mint_callback_token(url: str, ttl_seconds: int = 6 * 3600,
                        secret: bytes | None = None) -> str:
    """`v1.<exp>.<hex>`. A caller (the Director adapter) mints this with the same
    secret; this one is the reference implementation and the fixtures' minter."""
    exp = int(_now()) + int(ttl_seconds)
    return f"v1.{exp}.{_token_mac(secret or _secret(), url, exp)}"


def parse_callback(payload: dict) -> tuple[dict | None, str]:
    """`(callback, "")`, `(None, "")` when none was asked for, or `(None, why)`.

    The token is what stops `/render` being a way to make this server POST to any
    address: only a holder of `ATLAS_CALLBACK_SECRET` can mint one, and it binds
    the exact URL and an expiry."""
    url = str(payload.get("callbackUrl") or "").strip()
    token = str(payload.get("callbackToken") or "").strip()
    if not url and not token:
        return None, ""
    secret = _secret()
    if not secret:
        return None, "callbacks are not configured on this server"
    if not url or not token:
        return None, "a callback needs both callbackUrl and callbackToken"
    parsed = urllib.parse.urlparse(url)
    local = parsed.hostname in ("localhost", "127.0.0.1")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and local):
        return None, "the callback URL must be https"
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != "v1" or not parts[1].isdigit():
        return None, "the callback token is malformed"
    exp = int(parts[1])
    if exp < _now():
        return None, "the callback token has expired"
    if exp - _now() > MAX_TOKEN_TTL_SECONDS:
        return None, "the callback token lives longer than a day"
    if not hmac.compare_digest(parts[2], _token_mac(secret, url, exp)):
        return None, "the callback token does not match this URL"
    return {"url": url, "token": token}, ""


def sign_body(body: bytes, ts: int | None = None,
              secret: bytes | None = None) -> str:
    """`t=<unix>,v1=<hex HMAC-SHA256 of "<t>." + body>` — the X-Atlas-Signature."""
    ts = int(_now()) if ts is None else int(ts)
    mac = hmac.new(secret or _secret(), f"{ts}.".encode("utf-8") + body,
                   hashlib.sha256).hexdigest()
    return f"t={ts},v1={mac}"


def verify_signature(body: bytes, header: str, secret: bytes,
                     tolerance: int = SIGNATURE_TOLERANCE_SECONDS) -> bool:
    """The receiver's check, kept beside the signer so the two cannot drift."""
    fields = dict(p.split("=", 1) for p in (header or "").split(",") if "=" in p)
    try:
        ts = int(fields.get("t", ""))
    except ValueError:
        return False
    if abs(_now() - ts) > tolerance:
        return False
    want = hmac.new(secret, f"{ts}.".encode("utf-8") + body,
                    hashlib.sha256).hexdigest()
    return hmac.compare_digest(fields.get("v1", ""), want)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """The token binds ONE URL; following a redirect would POST the signed body
    and the token somewhere it never named."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def _post(url: str, body: bytes, headers: dict) -> int:
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    with _OPENER.open(req, timeout=CALLBACK_TIMEOUT_SECONDS) as r:
        return int(r.status)


def deliver_callback(doc: dict) -> bool:
    """POST `{jobRef, status, variants, runpod?}` to the render's callback, signed —
    `runpod` only when a job reported its time. A render with no callback does
    nothing. Never raises; never logs the token or secret. Delivery is recorded on
    the render, and the boot sweep redelivers one that never landed."""
    cb = doc.get("callback") or {}
    url = str(cb.get("url") or "")
    if not url:
        return False
    secret = _secret()
    host = urllib.parse.urlparse(url).hostname or "?"
    if not secret:
        print(f"[still-jobs] {doc.get('jobRef')}: callback to {host} not sent — "
              "ATLAS_CALLBACK_SECRET is unset", flush=True)
        return False
    msg = {"jobRef": doc.get("jobRef"), "status": doc.get("status"),
           "variants": doc.get("variants") or []}
    if doc.get("runpod"):
        msg["runpod"] = doc["runpod"]
    if doc.get("error"):
        msg["error"] = doc["error"]
    body = json.dumps(msg).encode("utf-8")
    headers = {"Content-Type": "application/json", "User-Agent": "InvisibleAtlas/1.0",
               "X-Atlas-Signature": sign_body(body, secret=secret),
               "X-Atlas-Callback-Token": str(cb.get("token") or "")}
    delivered = False
    for attempt in range(len(CALLBACK_RETRY_SECONDS) + 1):
        try:
            code = _post(url, body, headers)
            if 200 <= code < 300:
                delivered = True
                break
            print(f"[still-jobs] {doc.get('jobRef')}: callback to {host} answered "
                  f"{code}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"[still-jobs] {doc.get('jobRef')}: callback to {host} failed "
                  f"({type(e).__name__})", flush=True)
        if attempt < len(CALLBACK_RETRY_SECONDS):
            _sleep(CALLBACK_RETRY_SECONDS[attempt])

    def _m(d: dict) -> dict:
        d["callbackDelivered"] = delivered
        return d
    try:
        _cas(_render_key(str(doc.get("jobRef") or "")), _m)
    except Exception:  # noqa: BLE001
        pass
    return delivered
