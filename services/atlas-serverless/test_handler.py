"""Offline fixtures for the RunPod Serverless handler (no GPU, no ComfyUI, no RunPod).

Run:  py test_handler.py        (from services/atlas-serverless)

The handler had no tests at all, which is how a cancelled job came to keep rendering:
nothing here is exercised by a build, the image only gets rebuilt on a push, and the
one behaviour that costs real money when it is wrong — stopping — was never asserted.

`runpod` is stubbed at import so the module can be imported without the SDK; every
HTTP call goes through `requests`, which is replaced wholesale per test.

What each assertion stands for:

  * RunPod's `/cancel` marks the JOB cancelled but never interrupts a SYNCHRONOUS
    handler, so the worker used to render to completion, bill for it, and throw the
    result away — while the UI said "cancelled". The wait must notice and stop.
  * Stopping means the GPU, not the wait: `/interrupt` AND killing ComfyUI, because an
    interrupt lands between nodes and a job stuck inside a 14 GB load would ignore it.
  * A flaky status read must NOT abort a paid render. That is the direction that costs
    nothing to get wrong, and everything to get wrong the other way.
  * Without the two env vars the worker cannot ask, and must say so rather than
    silently billing for cancelled work.
  * `JOB_TIMEOUT` at 1800 silently became the binding cap the moment an endpoint was
    set past 30 minutes.
"""
from __future__ import annotations

import sys
import types

# The SDK is only present in the built image. `runpod.serverless.start` is called at
# import; stub it so importing the module here does not start a server.
_rp = types.ModuleType("runpod")
_rp.serverless = types.SimpleNamespace(start=lambda *a, **k: None)
sys.modules.setdefault("runpod", _rp)

# `requests` is an image dependency, not a repo one. Every call the handler makes goes
# through this module object and each test swaps in its own double, so the import-time
# stub only has to exist.
sys.modules.setdefault("requests", types.ModuleType("requests"))

import handler  # noqa: E402

FAILED: list[str] = []


def check(label: str, got, want) -> None:
    if got == want:
        print(f"ok   {label}")
        return
    print(f"FAIL {label}\n       got  {got!r}\n       want {want!r}")
    FAILED.append(label)


class FakeRequests:
    """Stands in for `requests`. Records every call; answers /history with `hist`
    (None = still rendering) and RunPod's status route with `remote_status`."""

    def __init__(self, remote_status="IN_PROGRESS", hist=None, status_raises=False):
        self.remote_status = remote_status
        self.hist = hist
        self.status_raises = status_raises
        self.calls: list[str] = []

    def get(self, url, **kw):
        self.calls.append(f"GET {url}")
        if "/history/" in url:
            return types.SimpleNamespace(
                status_code=200, json=lambda: (self.hist or {}))
        if "api.runpod.ai" in url:
            if self.status_raises:
                raise RuntimeError("HTTP 500 Internal Server Error")
            return types.SimpleNamespace(
                status_code=200, json=lambda: {"status": self.remote_status})
        return types.SimpleNamespace(status_code=200, json=lambda: {})

    def post(self, url, **kw):
        self.calls.append(f"POST {url}")
        return types.SimpleNamespace(status_code=200, json=lambda: {},
                                     raise_for_status=lambda: None)


def with_world(fn, *, env: dict, **kw):
    """Run `fn(fake)` with `requests`, the env and the ComfyUI process stubbed."""
    import os

    fake = FakeRequests(**kw)
    real_req, real_stop = handler.requests, handler._stop_comfy
    killed: list[bool] = []
    saved = {k: os.environ.get(k) for k in
             ("RUNPOD_ENDPOINT_ID", "RUNPOD_API_KEY")}
    handler.requests = fake
    handler._stop_comfy = lambda: killed.append(True)
    handler._warned_no_cancel_creds = False
    handler.CANCEL_POLL_SECONDS = 0  # check on every pass; no real waiting
    for k, v in env.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    try:
        return fn(fake), killed
    finally:
        handler.requests, handler._stop_comfy = real_req, real_stop
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


LIVE = {"RUNPOD_ENDPOINT_ID": "ep123", "RUNPOD_API_KEY": "key123"}


def test_a_cancelled_job_stops_rendering() -> None:
    """The whole point. Owner: "I have canceled jobs, and the UI is telling me they
    are cancelled, but ... the server is still running and generating.\""""
    def body(_fake):
        try:
            handler._await_result("p1", "job-abc", timeout=5)
            return "returned normally"
        except handler._Cancelled:
            return "cancelled"
        except Exception as e:  # noqa: BLE001
            return f"{type(e).__name__}: {e}"

    out, _ = with_world(body, env=LIVE, remote_status="CANCELLED")
    check("a job cancelled on RunPod stops the wait", out, "cancelled")


def test_stopping_kills_the_gpu_work_not_just_the_wait() -> None:
    """An interrupt lands BETWEEN nodes, so a job inside a 14 GB model load would
    sail through it. Killing ComfyUI is the guarantee — and frees the VRAM."""
    def body(fake):
        handler._abort_generation()
        return [c for c in fake.calls if "interrupt" in c]

    out, killed = with_world(body, env=LIVE)
    check("the running prompt is interrupted", out, ["POST http://127.0.0.1:8188/interrupt"])
    check("and ComfyUI is killed, which is what guarantees it", killed, [True])


def test_a_flaky_status_read_never_aborts_a_paid_render() -> None:
    """The mirror of the runner's grace window on the same API: an unreadable status
    is not a cancellation. Getting this backwards throws away paid renders on a blip."""
    def body(_fake):
        return handler._job_cancelled("job-abc")

    out, _ = with_world(body, env=LIVE, status_raises=True)
    check("a 500 from the status API is not a cancellation", out, False)

    out, _ = with_world(body, env=LIVE, remote_status="IN_PROGRESS")
    check("nor is a job that is simply still running", out, False)

    for st in ("CANCELLED", "TIMED_OUT", "FAILED"):
        out, _ = with_world(body, env=LIVE, remote_status=st)
        check(f"but {st} means nobody is coming for this result", out, True)


def test_without_credentials_it_says_so() -> None:
    """The worker cannot ask without them, and silently billing for cancelled work is
    exactly the failure this whole change exists to end."""
    import io
    import contextlib

    def body(_fake):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            got = handler._job_cancelled("job-abc")
            handler._job_cancelled("job-abc")  # twice: the warning must not spam
        return got, buf.getvalue().lower()

    (got, log), _ = with_world(
        body, env={"RUNPOD_ENDPOINT_ID": None, "RUNPOD_API_KEY": None})
    check("it cannot know, so it does not claim to", got, False)
    # Lower-cased above so the assertion is about the WARNING existing, not about
    # which words the copy happens to shout.
    check("and it warns that a cancel cannot stop this worker",
          "cannot be noticed here" in log and "bill for it" in log, True)
    check("once, not once per poll", log.count("cannot be noticed here"), 1)


def test_the_wait_returns_the_history_when_it_arrives() -> None:
    """The cancel check must not have broken the normal path."""
    def body(_fake):
        return handler._await_result("p1", "job-abc", timeout=5)

    out, killed = with_world(
        body, env=LIVE, hist={"p1": {"outputs": {"9": {"images": []}}}})
    check("a finished prompt still comes back", out, {"outputs": {"9": {"images": []}}})
    check("and nothing was killed on the happy path", killed, [])


def test_job_timeout_is_not_the_binding_cap() -> None:
    """1800 silently became the shortest of four clocks the moment an endpoint was set
    past 30 min, failing a render the endpoint was happy to run and blaming ComfyUI."""
    check("the worker's own cap clears a long video render",
          handler.JOB_TIMEOUT >= 9000, True)


if __name__ == "__main__":
    test_a_cancelled_job_stops_rendering()
    test_stopping_kills_the_gpu_work_not_just_the_wait()
    test_a_flaky_status_read_never_aborts_a_paid_render()
    test_without_credentials_it_says_so()
    test_the_wait_returns_the_history_when_it_arrives()
    test_job_timeout_is_not_the_binding_cap()
    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: {', '.join(FAILED)}")
        sys.exit(1)
    print("all handler fixtures pass")
