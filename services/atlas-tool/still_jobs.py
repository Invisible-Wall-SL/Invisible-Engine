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
        render.json             # who asked, which manifest, status, callback
        job_001.json            # one per RunPod job: id, endpoint, region, slot, status
        job_001.payload.json    # the submitted job body, kept until it settles —
                                # what a re-queue resubmits

The container that runs the render holds a lease on the jobRef (`iw_common.lease`,
renewed while the subprocess lives). A fresh container looks at boot for renders
still `running` whose lease nobody holds, re-attaches to each job still marked
`submitted`, and collects it the way the subprocess would have. A job RunPod no
longer knows is resubmitted ONCE from its stored payload; a second loss fails it.

Every write is conditional: records are created `If-None-Match: *` and changed
`If-Match` on the ETag just read (`_cas`). The manifest itself is only written by
the caller's finish hook, which goes through `_write_manifest_at`.

Fails open throughout: R2 that cannot be read or written costs the resumability of
this render, never the render.
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
# A render older than this is not resumed: RunPod dropped its jobs long ago, and
# re-queueing them would spend on a render nobody is waiting for. It is settled
# `failed` instead, so its callback still fires.
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
# How long a signed callback POST stays acceptable to a receiver that checks `t=`.
SIGNATURE_TOLERANCE_SECONDS = 300

TERMINAL = ("finished", "failed", "cancelled")
_REF_RE = re.compile(r"^st_[0-9a-f]{16}$")
_TOKEN_SCOPE = "atlas-callback.v1"

# Renders this process is running or resuming right now. Adopt-on-read checks it so
# a render this container owns is never adopted a second time beside itself.
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


def _root() -> str:
    """`<client>/<project>/_jobs/still` for the CALLING thread's context."""
    return f"{project_paths.resolve()['r2_project_prefix']}/_jobs/still"


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
    """Move a `running` render to a terminal status. Returns the closed doc only
    to the caller that made the transition, so its callback fires exactly once.

    Records a render's own death or stop too: any job still `submitted` was
    abandoned with it (Stop cancelled it on RunPod)."""
    def _m(d: dict) -> dict | None:
        if d.get("status") in TERMINAL:
            return None
        d.update(status=status, finishedAt=_now())
        if error:
            d["error"] = error[:500]
        return d
    closed = _cas(_render_key(ref), _m)
    if closed is None:
        return None
    try:
        jobs = _jobs(ref)
    except Exception:  # noqa: BLE001
        jobs = []
    for j in jobs:
        if j.get("status") == "submitted":
            record_settled(ref, int(j["seq"]), "abandoned", error=f"render {status}")
    closed["variants"] = variants_of([j for j in jobs if j.get("status") == "done"])
    return closed


# --------------------------------------------------------------------------
# The subprocess side (batch_atlas)
# --------------------------------------------------------------------------

def record_submitted(ref: str, seq: int, *, region: str, job_id: str,
                     endpoint: str, payload: dict,
                     provenance: dict | None = None) -> None:
    """A RunPod job is in flight. The payload is stored FIRST so a record that
    exists always has what a re-queue needs."""
    try:
        storage.put(_payload_key(ref, seq), json.dumps(payload).encode("utf-8"),
                    "application/json", if_none_match="*")
    except Exception as e:  # noqa: BLE001 — resumable without it, just not re-queueable
        print(f"[still-jobs] could not store the payload of {ref}/{seq} ({e})",
              flush=True)
    _create(_job_key(ref, seq), {
        "jobRef": ref, "seq": int(seq), "region": region, "transport": "runpod",
        "jobId": job_id, "endpoint": endpoint, "submittedAt": _now(),
        "status": "submitted", "requeued": False, "provenance": provenance,
    })


def record_local(ref: str, seq: int, *, region: str, variant: str) -> None:
    """A variant rendered on a live ComfyUI (not resumable: the job is the
    subprocess's own connection) — recorded so the callback can name it."""
    _create(_job_key(ref, seq), {
        "jobRef": ref, "seq": int(seq), "region": region, "transport": "comfy",
        "submittedAt": _now(), "status": "done", "variant": variant,
    })


def record_settled(ref: str, seq: int, status: str, *, variant: str = "",
                   error: str = "") -> dict | None:
    """Settle a `submitted` job. A job already settled is left as it is — the
    first answer wins, so a late writer cannot undo a collected render."""
    def _m(d: dict) -> dict | None:
        if d.get("status") != "submitted":
            return None
        d.update(status=status, settledAt=_now())
        if variant:
            d["variant"] = variant
        if error:
            d["error"] = error[:500]
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
    parts = project_paths.resolve()["r2_project_prefix"].strip("/").split("/")
    return lease.LeaseKey(LEASE_TOOL, parts[-2], parts[-1], ref)


def _holder() -> lease.LeaseHolder:
    return lease.LeaseHolder("atlas-tool", INSTANCE_ID)


class Hold:
    """This container's lease on one render, renewed until `release()`."""

    def __init__(self, ref: str) -> None:
        self.ref = ref
        self.key = _lease_key(ref)
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
                lease.heartbeat(self.key, _holder())
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


# --------------------------------------------------------------------------
# Re-attaching
# --------------------------------------------------------------------------

def _await(job_id: str, endpoint: str, since: float) -> tuple[str, object]:
    """Poll one RunPod job to an answer: `("completed", output)`,
    `("failed", detail)` or `("lost", reason)` — lost meaning RunPod has no
    record of it, the one case a re-queue can help."""
    import batch_atlas
    unreadable_since = 0.0
    rechecks = 0

    def _timed_out() -> tuple[str, object]:
        why = batch_atlas.runpod_cancel(job_id, endpoint)
        return "failed", "timed out after 30 min" + (
            f" (and RunPod would not cancel it: {why})" if why else "")

    # The cap is checked only AFTER a read that is not an answer: a job resumed
    # an hour after it was submitted may well have COMPLETED, and that render is
    # still collectable for as long as RunPod keeps the record.
    while True:
        now = _now()
        try:
            st = batch_atlas._runpod_get(f"/status/{job_id}", endpoint)
        except Exception as e:  # noqa: BLE001 — a bad READ is not a bad job
            if getattr(e, "code", None) == 404:
                if rechecks < len(NOT_FOUND_RECHECK_SECONDS):
                    _sleep(NOT_FOUND_RECHECK_SECONDS[rechecks])
                    rechecks += 1
                    continue
                return "lost", "RunPod has no record of the job"
            unreadable_since = unreadable_since or now
            if now - unreadable_since >= STATUS_GRACE_SECONDS:
                why = batch_atlas.runpod_cancel(job_id, endpoint)
                return "failed", f"lost contact with RunPod: {str(e)[:200]}" + (
                    f" (and RunPod would not cancel it: {why})" if why else "")
            if now - since > JOB_TIMEOUT_SECONDS:
                return _timed_out()
            _sleep(POLL_SECONDS)
            continue
        unreadable_since = 0.0
        rechecks = 0
        status = str(st.get("status") or "").upper()
        if status == "COMPLETED":
            out = st.get("output") or {}
            if isinstance(out, dict) and out.get("error"):
                return "failed", str(out.get("error"))[:300]
            return "completed", out
        if status in ("FAILED", "CANCELLED", "TIMED_OUT"):
            return "failed", f"job {status}: {str(st.get('error') or '')[:300]}"
        if now - since > JOB_TIMEOUT_SECONDS:
            return _timed_out()
        _sleep(POLL_SECONDS)


def _finish_job(ref: str, job: dict) -> str:
    """Drive one `submitted` job to a settled status, re-queueing it once if
    RunPod lost it. Returns the status it settled at."""
    import batch_atlas
    seq = int(job["seq"])
    while True:
        since = float(job.get("requeuedAt") or job.get("submittedAt") or _now())
        outcome, detail = _await(str(job["jobId"]), str(job.get("endpoint") or ""),
                                 since)
        if outcome == "completed":
            try:
                fname, _blob = batch_atlas.persist_serverless_output(
                    str(job["region"]), detail, provenance=job.get("provenance"))
            except Exception as e:  # noqa: BLE001
                record_settled(ref, seq, "failed", error=str(e))
                return "failed"
            record_settled(ref, seq, "done", variant=fname)
            print(f"[still-jobs] {ref}: collected {fname} after a restart", flush=True)
            return "done"
        if outcome == "lost" and not job.get("requeued"):
            requeued = _requeue(ref, job)
            if requeued is not None:
                job = requeued
                continue
        record_settled(ref, seq, "lost" if outcome == "lost" else "failed",
                       error=str(detail))
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
        if d.get("status") != "submitted" or d.get("requeued"):
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

    def _bind(d: dict) -> dict | None:
        if d.get("status") != "submitted":
            return None
        d.update(jobId=jid, endpoint=eid)
        return d
    bound = _cas(_job_key(ref, seq), _bind)
    print(f"[still-jobs] {ref}: RunPod lost job {seq} ({job.get('region')}); "
          f"re-queued once as {jid}", flush=True)
    return bound or {**job, "jobId": jid, "endpoint": eid, "requeued": True,
                     "requeuedAt": _now()}


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
            if j.get("status") != "submitted":
                continue
            if old:
                record_settled(ref, int(j["seq"]), "lost", error="too old to resume")
                continue
            try:
                _finish_job(ref, j)
            except Exception as e:  # noqa: BLE001 — one job must not sink the rest
                errors.capture_error(e, job="still-resume", job_ref=ref)
                record_settled(ref, int(j["seq"]), "failed", error=str(e))
        jobs = _jobs(ref)
        done = [j for j in jobs if j.get("status") == "done"]
        bad = [j for j in jobs if j.get("status") not in ("done", "submitted")]
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
          *, wait: bool = False) -> bool:
    """Take an orphaned render on in THIS container: one nobody's lease covers and
    this process is not already running. True when it was adopted."""
    with _LIVE_LOCK:
        if ref in _LIVE:
            return False
        _LIVE.add(ref)
    if _held_elsewhere(ref):
        with _LIVE_LOCK:
            _LIVE.discard(ref)
        return False
    hold = Hold(ref)
    if not hold.acquired:
        hold.release()
        return False
    ctx = (project_paths.client_name(), project_paths.project_name())
    if wait:
        _resume(ref, ctx, hold, finish)
    else:
        threading.Thread(target=_resume, args=(ref, ctx, hold, finish), daemon=True,
                         name=f"still-resume-{ref}").start()
    return True


def _project_prefixes() -> list[str]:
    out: list[str] = []
    for client in storage.list_prefixes("", complete=False):
        out += storage.list_prefixes(client, complete=False)
    return out


def resume_orphans(finish: Callable[[dict], None] | None = None,
                   *, wait: bool = False) -> list[str]:
    """At boot: adopt every render the last container left `running`. Returns the
    jobRefs adopted. Never raises — a bucket it cannot sweep costs the recovery,
    not the tool."""
    adopted: list[str] = []
    try:
        prefixes = _project_prefixes()
    except Exception as e:  # noqa: BLE001
        print(f"[still-jobs] could not list projects ({e})", flush=True)
        return adopted
    for pp in prefixes:
        try:
            client, project = pp.strip("/").split("/", 1)
        except ValueError:
            continue
        try:
            project_paths.set_context(client, project)
            for ref in storage.list_prefixes(f"{_root()}/", complete=False):
                ref = ref.rstrip("/").rsplit("/", 1)[-1]
                if not valid_job_ref(ref):
                    continue
                doc, _etag = _read(_render_key(ref))
                if not doc or doc.get("status") != "running":
                    continue
                if adopt(ref, finish, wait=wait):
                    adopted.append(ref)
        except Exception as e:  # noqa: BLE001 — one project must not stop the rest
            print(f"[still-jobs] could not scan {pp} ({e})", flush=True)
    if adopted:
        print(f"[still-jobs] resuming {len(adopted)} render(s) interrupted by the "
              f"last restart: {', '.join(adopted)}", flush=True)
    return adopted


def job_view(ref: str, finish: Callable[[dict], None] | None = None) -> dict | None:
    """`/progress?jobRef=`: the render's state and its jobs, for the CALLER's
    project. A render left `running` by a container that is gone is adopted here
    too — the reader is the job watcher, so this is where an orphan the boot sweep
    deferred (its old container was still draining) gets picked up."""
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
    """`v1.<exp>.<hex>` — the launcher's half, mirrored here for the fixtures and
    for anyone wiring a caller in Python."""
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


def _post(url: str, body: bytes, headers: dict) -> int:
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=CALLBACK_TIMEOUT_SECONDS) as r:
        return int(r.status)


def deliver_callback(doc: dict) -> bool:
    """POST `{jobRef, status, variants}` to the render's callback, signed. A render
    with no callback does nothing. Never raises; never logs the token or secret."""
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
