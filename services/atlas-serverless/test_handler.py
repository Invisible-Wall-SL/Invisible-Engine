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

    def __init__(self, remote_status="IN_PROGRESS", hist=None, status_raises=False,
                 put_status=200, view_bytes=b"WEBPDATA"):
        self.remote_status = remote_status
        self.hist = hist
        self.status_raises = status_raises
        self.put_status = put_status
        self.view_bytes = view_bytes
        self.uploaded: list = []
        self.calls: list[str] = []

    def get(self, url, **kw):
        self.calls.append(f"GET {url}")
        if "/history/" in url:
            return types.SimpleNamespace(
                status_code=200, json=lambda: (self.hist or {}))
        if "/view" in url:
            return types.SimpleNamespace(status_code=200, content=self.view_bytes)
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

    def put(self, url, data=None, **kw):
        self.calls.append(f"PUT {url}")
        self.uploaded.append((url, data))
        return types.SimpleNamespace(status_code=self.put_status, text="nope")


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


def test_every_error_says_which_worker_produced_it() -> None:
    """"Is the endpoint running the new image?" was, three times running, only
    answerable by noticing that an error quoted a number we had since changed. A
    `:latest` endpoint caches by digest, so a push to that tag need not roll the
    workers — and nothing in the container said otherwise. The answer now travels
    with the failure."""
    def body(_fake):
        return handler.handler({"id": "j1", "input": {}})

    out, _ = with_world(body, env=LIVE)
    check("a rejected job still says what was wrong",
          out.get("error"), f"input.workflow is required [worker {handler.WORKER_BUILD}]")
    check("and which build said it", out.get("worker_build"), handler.WORKER_BUILD)
    check("which is a real value in a built image, not a placeholder",
          isinstance(handler.WORKER_BUILD, str) and bool(handler.WORKER_BUILD), True)


def test_a_node_failure_names_the_node_and_the_exception() -> None:
    """Thirteen failed variations in one session all read `job FAILED: comfy
    execution error` and not one word more, because RunPod keeps only the `error`
    STRING of a failing result — the `detail` beside it, which held ComfyUI's
    node and exception, never left the worker. What an author needs to act on has
    to be IN the string."""
    status = {
        "status_str": "error", "completed": False,
        "messages": [
            ["execution_start", {"prompt_id": "p1"}],
            ["execution_error", {
                "prompt_id": "p1", "node_id": "202", "node_type": "BiRefNetRMBG",
                "exception_type": "torch.OutOfMemoryError",
                "exception_message": "CUDA out of memory.\n  Tried to allocate 2.00 GiB. "
                                     "GPU 0 has a total capacity of 23.5 GiB",
                "traceback": ["File …"] * 40,
            }],
        ],
    }
    check("the node, the exception class and its first line are the summary",
          handler._describe_execution_error(status),
          "BiRefNetRMBG #202: OutOfMemoryError: CUDA out of memory. Tried to allocate "
          "2.00 GiB. GPU 0 has a total capacity of 23.5 GiB")
    check("a status with no execution_error event summarizes to nothing",
          handler._describe_execution_error({"status_str": "error", "messages": []}), "")
    long = dict(status)
    long["messages"] = [["execution_error", {
        "node_type": "KSampler", "exception_type": "RuntimeError",
        "exception_message": "x" * 1000}]]
    check("a traceback-sized message is capped so the node name survives the tool's 400",
          len(handler._describe_execution_error(long)) < 300, True)

    out = handler._fail(f"comfy execution error — {handler._describe_execution_error(status)}",
                        detail=status)
    check("and the string RunPod keeps carries node, exception AND build",
          out["error"].startswith("comfy execution error — BiRefNetRMBG #202: OutOfMemoryError")
          and out["error"].endswith(f"[worker {handler.WORKER_BUILD}]"), True)


HIST = {"outputs": {"363": {"images": [{"filename": "iwvid_001_00001_.webp"}]}}}


def test_a_render_goes_to_storage_not_through_runpod() -> None:
    """RunPod's payload cap is FIXED — 10 MB on /run, 20 MB on /runsync, and base64
    inflates a file by a third on the way — so a big render cannot be returned, only
    routed around. A lossless WEBP of opaque frames clears that cap easily, which is
    how turning a background cutout off came to break a render outright."""
    big = b"x" * (40 * 1024 * 1024)

    def body(_fake):
        return handler._collect_images(HIST, ["https://r2.example/slot0?sig=abc"])

    out, _ = with_world(body, env=LIVE, view_bytes=big)
    check("the file is reported by SLOT, not by value",
          out, [{"filename": "iwvid_001_00001_.webp", "bytes": len(big),
                 "slot": 0}])
    check("so nothing large crosses RunPod's API at all",
          any("image" in e for e in out), False)


def test_the_bytes_really_reach_the_url() -> None:
    def body(fake):
        handler._collect_images(HIST, ["https://r2.example/slot0?sig=abc"])
        return fake.uploaded

    out, _ = with_world(body, env=LIVE, view_bytes=b"REALBYTES")
    check("exactly one upload, to the URL it was handed",
          [(u, d) for u, d in out], [("https://r2.example/slot0?sig=abc", b"REALBYTES")])


def test_a_failed_upload_degrades_instead_of_losing_the_render() -> None:
    """A bad or expired URL must cost the ceiling, not the work."""
    def body(_fake):
        return handler._collect_images(HIST, ["https://r2.example/slot0?sig=abc"])

    out, _ = with_world(body, env=LIVE, put_status=403, view_bytes=b"REALBYTES")
    check("it falls back to returning the file inline", "image" in out[0], True)
    check("and does not claim a slot it never used", "slot" in out[0], False)


def test_without_urls_nothing_changes() -> None:
    """An older caller sends no `upload_urls`; that path must be untouched, or a
    stale tool and a fresh worker stop understanding each other."""
    def body(_fake):
        return handler._collect_images(HIST)

    out, _ = with_world(body, env=LIVE, view_bytes=b"REALBYTES")
    check("the file comes back inline, exactly as before",
          out, [{"filename": "iwvid_001_00001_.webp", "bytes": 9,
                 "image": "UkVBTEJZVEVT"}])


def test_slots_line_up_with_output_order() -> None:
    """The caller keeps the picking rule and maps slot -> key positionally, so slot i
    MUST be output i — including when an upload fails and one comes back inline."""
    hist = {"outputs": {"a": {"images": [{"filename": "preview.png"},
                                         {"filename": "iwvid_001_00001_.webp"}]}}}

    def body(_fake):
        return handler._collect_images(hist, ["https://r2.example/0", "https://r2.example/1"])

    out, _ = with_world(body, env=LIVE)
    check("each output claims its own slot, in order",
          [(e["filename"], e.get("slot")) for e in out],
          [("preview.png", 0), ("iwvid_001_00001_.webp", 1)])

    # More outputs than slots: the extras must NOT silently reuse slot 0.
    def body2(_fake):
        return handler._collect_images(hist, ["https://r2.example/0"])

    out2, _ = with_world(body2, env=LIVE)
    check("an output with no slot left comes back inline instead",
          [(e["filename"], e.get("slot"), "image" in e) for e in out2],
          [("preview.png", 0, False), ("iwvid_001_00001_.webp", None, True)])


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
    test_every_error_says_which_worker_produced_it()
    test_a_render_goes_to_storage_not_through_runpod()
    test_the_bytes_really_reach_the_url()
    test_a_failed_upload_degrades_instead_of_losing_the_render()
    test_a_node_failure_names_the_node_and_the_exception()
    test_without_urls_nothing_changes()
    test_slots_line_up_with_output_order()
    test_job_timeout_is_not_the_binding_cap()
    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: {', '.join(FAILED)}")
        sys.exit(1)
    print("all handler fixtures pass")
