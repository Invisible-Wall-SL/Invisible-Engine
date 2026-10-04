"""Offline fixtures for resumable still renders (`still_jobs.py`): no RunPod, no R2.

Run:  PYTHONPATH=../_shared py test_still_jobs.py   (from services/atlas-tool)

What each group stands for:

  * RESUME — a container restart used to lose every still job in flight, paid for
    and never collected. A render left `running` must be re-attached at boot,
    its finished job collected as a variant, the post-render step run and the
    render closed — and a render another container still holds left alone.
  * RE-QUEUE ONCE — a job RunPod has no record of is resubmitted from its stored
    payload exactly once; a second loss fails it rather than spending again.
  * CALLBACK — only a token minted with ATLAS_CALLBACK_SECRET can make this server
    POST anywhere, the POST is signed, and neither secret nor token reaches a log.
  * NO CALLBACK — the render, its `/render` answer and `/progress` stay as they
    were; a CLI run of batch_atlas records nothing.

ASCII only in the labels: a non-Latin-1 glyph aborts the suite on a cp1252 console.
"""
from __future__ import annotations

import base64
import contextlib
import io
import json
import os
import sys
import tempfile
import threading

import batch_atlas
import still_jobs
import storage
import ui_server as u
from iw_common import storage as shared_storage

FAILED: list[str] = []
SECRET = b"test-callback-secret-not-real"
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")
        FAILED.append(label)


class Bucket:
    """R2 with real preconditions: a fixture whose put ignored If-Match could not
    tell a compare-and-swap from a blind overwrite."""

    def __init__(self) -> None:
        self.o: dict[str, tuple[bytes, str]] = {}
        self.n = 0

    def put(self, k, b, c=None, *, if_match=None, if_none_match=None):
        if if_none_match == "*" and k in self.o:
            raise storage.Conflict(k)
        if if_match and if_match != "*" and (k not in self.o or self.o[k][1] != if_match):
            raise storage.Conflict(k)
        self.n += 1
        self.o[k] = (b, f'"e{self.n}"')
        return self.o[k][1]

    def get_with_etag(self, k):
        return self.o.get(k)

    def get(self, k):
        return self.o[k][0] if k in self.o else None

    def delete(self, k):
        self.o.pop(k, None)

    def list_keys(self, p, complete=True):
        return [{"key": k, "mtime": 0} for k in sorted(self.o) if k.startswith(p)]

    def list_prefixes(self, p, complete=True):
        return sorted({k[:len(p) + k[len(p):].index("/") + 1]
                       for k in self.o if k.startswith(p) and "/" in k[len(p):]})

    def doc(self, k):
        return json.loads(self.o[k][0])


R2 = Bucket()
TMP = tempfile.mkdtemp(prefix="still-jobs-")
PERSISTED: list[tuple[str, str]] = []
ROOT = "clientx/projecty/_jobs/still"


def install() -> None:
    global R2
    R2 = Bucket()
    for mod in (storage, shared_storage):
        for name in ("put", "get_with_etag", "get", "delete", "list_keys",
                     "list_prefixes"):
            setattr(mod, name, getattr(R2, name))
    # still_jobs reads `storage` (the tool's shim, whose names were bound at its
    # import) and the lease reads `iw_common.storage`: both must be the double.
    still_jobs.storage = storage
    still_jobs.project_paths.resolve = lambda: {
        "r2_project_prefix": "clientx/projecty", "batch_dir": TMP, "staging_root": TMP}
    still_jobs.project_paths.set_context = lambda *a, **k: True
    still_jobs.project_paths.client_name = lambda: "clientx"
    still_jobs.project_paths.project_name = lambda: "projecty"
    still_jobs.project_paths.ensure_lazy = lambda sub: None
    still_jobs._sleep = lambda s: None
    still_jobs._LIVE.clear()
    PERSISTED.clear()
    batch_atlas._persist_variant = (
        lambda rname, fname, blob, provenance=None: PERSISTED.append((rname, fname)))
    batch_atlas._next_variant_filename = lambda rname: f"{rname}_00007_.png"
    batch_atlas.runpod_cancel = lambda jid, eid: ""
    os.environ["ATLAS_CALLBACK_SECRET"] = SECRET.decode()


class RunPod:
    """`/status` answers per job id, and every `/run` it was asked for."""

    def __init__(self, answers: dict[str, list]) -> None:
        self.answers = answers
        self.submitted: list[dict] = []

    def get(self, path, endpoint):
        jid = path.rsplit("/", 1)[-1]
        seq = self.answers.get(jid) or [404]
        ans = seq.pop(0) if len(seq) > 1 else seq[0]
        if ans == 404:
            raise batch_atlas.RunPodHTTPError(404, "not found")
        return ans

    def submit(self, payload):
        if len(self.submitted) >= 3:
            raise RuntimeError("the fixture refuses a runaway re-queue loop")
        self.submitted.append(payload)
        return f"requeued-{len(self.submitted)}", "ep1"

    def install(self) -> None:
        batch_atlas._runpod_get = self.get
        batch_atlas.runpod_submit = self.submit


def completed() -> dict:
    return {"status": "COMPLETED",
            "output": {"images": [{"filename": "H1_00001_.png",
                                   "image": base64.b64encode(PNG).decode()}]}}


def interrupted_render(ref: str = "st_00000000000000aa", *, jobs: int = 1,
                       total: int | None = 1, callback: dict | None = None) -> str:
    """What a container leaves behind when it dies mid-render: a `running` doc and
    `submitted` job records, written through the same calls the render makes."""
    still_jobs.open_render(ref, manifest="hero.json", names=["H1"], variants=jobs,
                           callback=callback)
    if total is not None:
        still_jobs.record_plan(ref, total)
    for seq in range(1, jobs + 1):
        still_jobs.record_submitted(ref, seq, region="H1", job_id=f"job-{seq}",
                                    endpoint="ep1", payload={"input": {"seq": seq}})
    return ref


# --------------------------------------------------------------------------
# Resume
# --------------------------------------------------------------------------

def test_resume_after_a_restart_collects_the_job() -> None:
    install()
    RunPod({"job-1": [{"status": "IN_PROGRESS"}, completed()]}).install()
    ref = interrupted_render()
    finished: list[str] = []
    adopted = still_jobs.resume_orphans(
        finish=lambda doc: finished.append(doc["manifest"]), wait=True)
    check("the boot sweep adopts the interrupted render", adopted, [ref])
    job = R2.doc(f"{ROOT}/{ref}/job_001.json")
    check("its job is collected as the region's next variant",
          (job["status"], job["variant"]), ("done", "H1_00007_.png"))
    check("...through the same persist path the subprocess uses",
          PERSISTED, [("H1", "H1_00007_.png")])
    check("the post-render step runs on the render's own manifest", finished,
          ["hero.json"])
    check("the render is closed finished",
          R2.doc(f"{ROOT}/{ref}/render.json")["status"], "finished")
    check("the settled job's payload is cleaned up",
          f"{ROOT}/{ref}/job_001.payload.json" in R2.o, False)
    check("the lease is let go once the render is settled",
          any("/_leases/" in k for k in R2.o), False)
    check("a second boot finds nothing left to adopt",
          still_jobs.resume_orphans(wait=True), [])


def test_a_render_another_container_holds_is_left_alone() -> None:
    install()
    rp = RunPod({"job-1": [completed()]})
    rp.install()
    ref = interrupted_render()
    other = still_jobs.lease.LeaseHolder("atlas-tool", "the-old-container")
    still_jobs.lease.acquire(still_jobs._lease_key(ref), other)
    check("a render whose old container is still draining is not adopted",
          still_jobs.resume_orphans(wait=True), [])
    check("...and its job is not touched",
          R2.doc(f"{ROOT}/{ref}/job_001.json")["status"], "submitted")


def test_a_render_this_container_is_running_is_never_adopted_beside_itself() -> None:
    install()
    RunPod({"job-1": [completed()]}).install()
    ref = "st_00000000000000bb"
    hold = still_jobs.Hold(ref)
    interrupted_render(ref)
    view = still_jobs.job_view(ref)
    check("a progress read of our own live render does not adopt it",
          R2.doc(f"{ROOT}/{ref}/job_001.json")["status"], "submitted")
    check("...and reports it running", view["status"], "running")
    hold.release()


def test_a_restart_that_left_regions_unstarted_says_so() -> None:
    install()
    RunPod({"job-1": [completed()]}).install()
    ref = interrupted_render(total=3)
    still_jobs.resume_orphans(wait=True)
    doc = R2.doc(f"{ROOT}/{ref}/render.json")
    check("collected work is kept, but the render is not called finished",
          (doc["status"], "2 job(s) never started" in doc.get("error", "")),
          ("failed", True))


def test_progress_by_job_ref() -> None:
    install()
    RunPod({"job-1": [{"status": "IN_PROGRESS"}]}).install()
    token = still_jobs.mint_callback_token("https://launcher.example/cb")
    ref = interrupted_render(callback={"url": "https://launcher.example/cb",
                                       "token": token})
    hold = still_jobs.Hold(ref)
    view = still_jobs.job_view(ref)
    check("a jobRef reports its render's state", (view["jobRef"], view["status"]),
          (ref, "running"))
    check("...and its jobs", [j["status"] for j in view["jobs"]], ["submitted"])
    check("...never the callback token", "token" in json.dumps(view), False)
    check("an unknown jobRef is None", still_jobs.job_view("st_0000000000000000"), None)
    check("a malformed jobRef is None", still_jobs.job_view("../../etc"), None)
    hold.release()


# --------------------------------------------------------------------------
# Re-queue once
# --------------------------------------------------------------------------

def test_a_lost_job_is_requeued_once_and_collected() -> None:
    install()
    rp = RunPod({"job-1": [404], "requeued-1": [completed()]})
    rp.install()
    ref = interrupted_render()
    still_jobs.resume_orphans(wait=True)
    job = R2.doc(f"{ROOT}/{ref}/job_001.json")
    check("the stored payload is resubmitted", rp.submitted, [{"input": {"seq": 1}}])
    check("the record names the new job and the one it replaced",
          (job["jobId"], job["previousJobId"], job["requeued"]),
          ("requeued-1", "job-1", True))
    check("the re-queued job is collected", (job["status"], job["variant"]),
          ("done", "H1_00007_.png"))
    check("the render is closed finished",
          R2.doc(f"{ROOT}/{ref}/render.json")["status"], "finished")


def test_a_job_lost_twice_is_not_requeued_again() -> None:
    install()
    rp = RunPod({"job-1": [404], "requeued-1": [404]})
    rp.install()
    ref = interrupted_render()
    still_jobs.resume_orphans(wait=True)
    job = R2.doc(f"{ROOT}/{ref}/job_001.json")
    check("exactly one resubmit", len(rp.submitted), 1)
    check("the second loss settles the job lost", job["status"], "lost")
    check("...and fails the render",
          R2.doc(f"{ROOT}/{ref}/render.json")["status"], "failed")


def test_a_job_that_failed_on_runpod_is_not_requeued() -> None:
    install()
    rp = RunPod({"job-1": [{"status": "FAILED", "error": "OOM"}]})
    rp.install()
    ref = interrupted_render()
    still_jobs.resume_orphans(wait=True)
    check("a real failure is not spent on again", rp.submitted, [])
    check("...it is recorded as failed",
          R2.doc(f"{ROOT}/{ref}/job_001.json")["status"], "failed")


def test_a_requeue_claim_cannot_be_won_twice() -> None:
    install()
    rp = RunPod({})
    rp.install()
    ref = interrupted_render()
    job = R2.doc(f"{ROOT}/{ref}/job_001.json")
    first = still_jobs._requeue(ref, dict(job))
    second = still_jobs._requeue(ref, dict(job))
    check("the first re-queue goes through", bool(first), True)
    check("a second, from the same stale record, is refused", second, None)
    check("...so RunPod saw one resubmit", len(rp.submitted), 1)


def test_an_old_completed_job_is_still_collected() -> None:
    install()
    RunPod({"job-1": [completed()]}).install()
    ref = interrupted_render()
    key = f"{ROOT}/{ref}/job_001.json"
    job = R2.doc(key)
    job["submittedAt"] -= 3600
    R2.put(key, json.dumps(job).encode())
    still_jobs.resume_orphans(wait=True)
    check("a job past the 30 min cap that has COMPLETED is collected, not timed out",
          R2.doc(key)["status"], "done")


# --------------------------------------------------------------------------
# Callback
# --------------------------------------------------------------------------

def test_callback_token_signing_and_verification() -> None:
    install()
    url = "https://launcher.example/api/director/jobs/cb"
    token = still_jobs.mint_callback_token(url)
    cb, why = still_jobs.parse_callback({"callbackUrl": url, "callbackToken": token})
    check("a token minted for the URL is accepted", (cb, why),
          ({"url": url, "token": token}, ""))
    check("the same token for another URL is refused",
          still_jobs.parse_callback({"callbackUrl": "https://evil.example/x",
                                     "callbackToken": token})[1],
          "the callback token does not match this URL")
    old = still_jobs.mint_callback_token(url, ttl_seconds=-10)
    check("an expired token is refused",
          still_jobs.parse_callback({"callbackUrl": url, "callbackToken": old})[1],
          "the callback token has expired")
    forged = still_jobs.mint_callback_token(url, secret=b"someone-elses-secret")
    check("a token minted with another secret is refused",
          still_jobs.parse_callback({"callbackUrl": url, "callbackToken": forged})[1],
          "the callback token does not match this URL")
    plain = "http://launcher.example/cb"
    check("plain http is refused off localhost",
          still_jobs.parse_callback({"callbackUrl": plain,
                                     "callbackToken": still_jobs.mint_callback_token(plain)})[1],
          "the callback URL must be https")
    check("a URL without a token is refused",
          still_jobs.parse_callback({"callbackUrl": url})[1],
          "a callback needs both callbackUrl and callbackToken")
    os.environ.pop("ATLAS_CALLBACK_SECRET")
    check("with no secret configured every callback is refused",
          still_jobs.parse_callback({"callbackUrl": url, "callbackToken": token})[1],
          "callbacks are not configured on this server")
    os.environ["ATLAS_CALLBACK_SECRET"] = SECRET.decode()

    body = b'{"jobRef":"st_1","status":"finished","variants":[]}'
    sig = still_jobs.sign_body(body)
    check("a signed body verifies", still_jobs.verify_signature(body, sig, SECRET), True)
    check("a changed body does not",
          still_jobs.verify_signature(body + b" ", sig, SECRET), False)
    check("another secret does not",
          still_jobs.verify_signature(body, sig, b"other"), False)
    stale = still_jobs.sign_body(body, ts=int(still_jobs._now()) - 3600)
    check("a replayed old signature does not",
          still_jobs.verify_signature(body, stale, SECRET), False)
    check("a garbage header does not", still_jobs.verify_signature(body, "x", SECRET),
          False)


def test_the_callback_fires_once_signed_and_never_logs_secrets() -> None:
    install()
    RunPod({"job-1": [completed()]}).install()
    url = "https://launcher.example/cb"
    token = still_jobs.mint_callback_token(url)
    posts: list[tuple[str, bytes, dict]] = []
    attempts = {"n": 0}

    def fake_post(u_, body, headers):
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise OSError("connection reset")
        posts.append((u_, body, headers))
        return 204
    still_jobs._post = fake_post
    ref = interrupted_render(callback={"url": url, "token": token})
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        still_jobs.resume_orphans(wait=True)
    check("a failed delivery is retried and lands once", len(posts), 1)
    target, body, headers = posts[0]
    msg = json.loads(body)
    check("it POSTs to the callback URL", target, url)
    check("with {jobRef, status, variants}", msg, {
        "jobRef": ref, "status": "finished",
        "variants": [{"region": "H1", "variant": "H1_00007_.png", "slot": 1}]})
    check("signed with the server secret",
          still_jobs.verify_signature(body, headers["X-Atlas-Signature"], SECRET), True)
    check("carrying the caller's token back", headers["X-Atlas-Callback-Token"], token)
    log = out.getvalue()
    check("the secret never reaches the log", SECRET.decode() in log, False)
    check("the token never reaches the log", token in log, False)
    check("delivery is recorded",
          R2.doc(f"{ROOT}/{ref}/render.json")["callbackDelivered"], True)
    check("closing an already-closed render fires nothing again",
          still_jobs.close_render(ref, "finished"), None)


# --------------------------------------------------------------------------
# No callback: nothing changes
# --------------------------------------------------------------------------

def test_no_callback_changes_nothing() -> None:
    install()
    check("a /render with no callback parses to none, without complaint",
          still_jobs.parse_callback({"names": ["H1"], "variants": 2}), (None, ""))
    posted: list = []
    still_jobs._post = lambda *a: posted.append(a) or 200
    check("a render with no callback posts nothing",
          (still_jobs.deliver_callback({"jobRef": "st_1", "status": "finished"}),
           posted), (False, []))

    # A CLI run of batch_atlas (no ATLAS_JOB_REF) records nothing at all.
    batch_atlas.JOB_REF = ""
    batch_atlas._serverless_workflow_images = lambda wf: []
    batch_atlas._runpod_run_and_wait = (
        lambda job, name, on_submit=None: completed()["output"])
    batch_atlas._run_region_serverless({"name": "H1"}, {})
    check("without a jobRef the subprocess writes no job record", R2.o, {})

    # With one, the same call leaves a settled record and no payload.
    ref = "st_00000000000000cc"
    still_jobs.open_render(ref, manifest="hero.json", names=["H1"], variants=1)
    batch_atlas.JOB_REF = ref

    def run_and_wait(job, name, on_submit=None):
        on_submit("job-9", "ep1")
        return completed()["output"]
    batch_atlas._runpod_run_and_wait = run_and_wait
    batch_atlas._run_region_serverless({"name": "H1"}, {})
    batch_atlas.JOB_REF = ""
    job = R2.doc(f"{ROOT}/{ref}/job_001.json")
    check("with a jobRef the subprocess records the job and settles it",
          (job["jobId"], job["status"], job["variant"]),
          ("job-9", "done", "H1_00007_.png"))
    check("...dropping the payload once it cannot be needed",
          f"{ROOT}/{ref}/job_001.payload.json" in R2.o, False)


class FakeHandler(u.Handler):
    """The real `_post` + `_send`, over captured bytes."""

    def __init__(self, body: dict, accept: str = "") -> None:
        raw = json.dumps(body).encode("utf-8")
        self.path = "/render"
        self.headers = {"Content-Length": str(len(raw))}
        if accept:
            self.headers["Accept"] = accept
        self.rfile = io.BytesIO(raw)
        self.wfile = io.BytesIO()
        self._identity = None
        self.sent_headers: dict = {}
        self.code = None

    def _authenticate(self):
        return True

    def _resolve_context(self):
        pass

    def _resolve_publish(self):
        self.can_publish = False

    def _render_owner(self):
        return None

    def send_response(self, code, message=None):
        self.code = code

    def send_header(self, k, v):
        self.sent_headers[k] = v

    def end_headers(self):
        pass


def test_the_render_route() -> None:
    install()
    started: list[tuple] = []
    real_thread = u.threading.Thread

    class _NoThread:
        def __init__(self, target=None, args=(), kwargs=None, daemon=None, name=None):
            self.args = args

        def start(self):
            started.append(self.args)
    u.threading.Thread = _NoThread
    u.claim_render_slot = lambda owner=None: (True, "started")
    try:
        h = FakeHandler({"names": ["H1"], "variants": 2})
        h.do_POST()
        check("the page's /render still answers the same plain text",
              (h.code, h.wfile.getvalue()), (200, b"started"))
        ref = h.sent_headers.get("X-Atlas-Job-Ref", "")
        check("...plus the jobRef, in a header it never reads",
              still_jobs.valid_job_ref(ref), True)
        check("...and no callback is passed on", started[-1][5], None)

        url = "https://launcher.example/cb"
        token = still_jobs.mint_callback_token(url)
        h = FakeHandler({"names": ["H1"], "callbackUrl": url, "callbackToken": token},
                        accept="application/json")
        h.do_POST()
        ans = json.loads(h.wfile.getvalue())
        check("an adapter asking for JSON gets the jobRef in the body",
              (ans["started"], still_jobs.valid_job_ref(ans["jobRef"])), (True, True))
        check("...and its verified callback reaches the render",
              started[-1][5], {"url": url, "token": token})

        n = len(started)
        h = FakeHandler({"names": ["H1"], "callbackUrl": "https://evil.example/x",
                         "callbackToken": token}, accept="application/json")
        h.do_POST()
        check("a callback that fails verification refuses the render before it starts",
              (h.code, len(started)), (400, n))

        u.claim_render_slot = lambda owner=None: (False, "A render is already running")
        h = FakeHandler({"names": ["H1"]})
        h.do_POST()
        check("a refused render gets no jobRef",
              (h.wfile.getvalue(), "X-Atlas-Job-Ref" in h.sent_headers),
              (b"A render is already running", False))
    finally:
        u.threading.Thread = real_thread


def test_a_render_records_and_closes_its_job_ref() -> None:
    install()
    u._render_job = lambda names, variants, user, job_ref="": 0
    u.manifest_path = lambda: u.Path("/staging/manifests/hero.json")
    posted: list = []
    still_jobs._post = lambda *a: posted.append(a) or 200
    ref = "st_00000000000000dd"
    u.run_render(["H1"], 1, ("clientx", "projecty"), "alice", ref, None)
    doc = R2.doc(f"{ROOT}/{ref}/render.json")
    check("a render with a jobRef is recorded and closed finished",
          (doc["status"], doc["manifest"], doc["user"]), ("finished", "hero.json", "alice"))
    check("...posting nothing without a callback", posted, [])
    check("...and letting its lease go", any("/_leases/" in k for k in R2.o), False)
    u._stopped = True
    u.run_render(["H1"], 1, ("clientx", "projecty"), "alice", "st_00000000000000ee")
    u._stopped = False
    check("a stopped render closes cancelled",
          R2.doc(f"{ROOT}/st_00000000000000ee/render.json")["status"], "cancelled")


if __name__ == "__main__":
    threading.excepthook = lambda a: FAILED.append(f"thread: {a.exc_value!r}")
    test_resume_after_a_restart_collects_the_job()
    test_a_render_another_container_holds_is_left_alone()
    test_a_render_this_container_is_running_is_never_adopted_beside_itself()
    test_a_restart_that_left_regions_unstarted_says_so()
    test_progress_by_job_ref()
    test_a_lost_job_is_requeued_once_and_collected()
    test_a_job_lost_twice_is_not_requeued_again()
    test_a_job_that_failed_on_runpod_is_not_requeued()
    test_a_requeue_claim_cannot_be_won_twice()
    test_an_old_completed_job_is_still_collected()
    test_callback_token_signing_and_verification()
    test_the_callback_fires_once_signed_and_never_logs_secrets()
    test_no_callback_changes_nothing()
    test_the_render_route()
    test_a_render_records_and_closes_its_job_ref()
    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: {', '.join(FAILED)}")
        sys.exit(1)
    print("all still-jobs fixtures pass")
