"""Offline guard: a render can neither hang forever nor be silently refused.

Run:  PYTHONPATH=../_shared py test_render_slot.py   (from services/atlas-tool)

Reported as "my images are still processing and I am getting no error", with an
empty ComfyUI queue AND an empty ComfyUI history — i.e. the job never arrived
anywhere, yet the panel showed "Rendering 0/2..." indefinitely. Two independent
defects had to line up:

  1. `batch_atlas.comfy_post` — the ONE call that submits the job (`/prompt`) —
     passed no `timeout`, so `urlopen` fell back to `socket.getdefaulttimeout()`
     (None) and waited forever. With the Cloudflare tunnel's connector down the
     edge still completes TCP+TLS and then never answers, so the read could not
     return: no exception, no error, no end. Every OTHER call in that module was
     already capped, and the comment above `_COMFY_HTTP_TIMEOUT` had made this
     exact argument for `comfy_get` -- naming /prompt as answering "in tens of
     ms". comfy_post was simply missed.
  2. `/render` answered "started" unconditionally, even when it had NOT spawned
     a thread because `_render_state["running"]` was already set -- and that
     flag only ever cleared in the render's own `finally`, which a hung
     subprocess never reaches. So after (1), every retry looked accepted and
     nothing ran, for the life of the container.

ASCII only in the labels: a non-Latin-1 glyph aborts the suite on this box's
cp1252 console.
"""
from __future__ import annotations

import os
import sys

import batch_atlas as ba
import ui_server as u

FAILED: list[str] = []
PASSED: list[str] = []


def _say(text: str) -> None:
    """Print through this console's encoding: a FAILING assertion may dump
    panel HTML carrying glyphs cp1252 cannot encode, and the diagnostic must
    not destroy the diagnosis."""
    enc = sys.stdout.encoding or "utf-8"
    print(text.encode(enc, errors="replace").decode(enc, errors="replace"))


def check(label: str, got, want) -> None:
    ok = got == want
    _say(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        _say(f"       got  {got!r}\n       want {want!r}")


def check_in(label: str, needle: str, haystack: str) -> None:
    ok = needle in haystack
    _say(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        _say(f"       {needle!r} not found in:\n       {haystack!r}")


def check_not_in(label: str, needle: str, haystack: str) -> None:
    ok = needle not in haystack
    _say(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        _say(f"       {needle!r} unexpectedly found in:\n       {haystack!r}")


class FakeProc:
    """Stands in for the batch_atlas subprocess. `alive` mirrors Popen.poll()
    returning None while it runs."""

    def __init__(self, alive: bool):
        self._alive = alive

    def poll(self):
        return None if self._alive else 0


def reset(running: bool = False, proc=None, cur: int = 0, total: int = 0,
          started: float = 0.0) -> None:
    u._render_state.update(running=running, done=False, log="", cur=cur,
                           total=total, diagnostics=[], started=started)
    u._render_proc = proc                      # type: ignore[assignment]


# --------------------------------------------------------------------------
# 1. The submit call is capped
# --------------------------------------------------------------------------
def test_the_submit_call_cannot_wait_forever() -> None:
    seen: dict = {}

    def fake_urlopen(req, timeout="MISSING"):
        seen["timeout"] = timeout
        raise AssertionError("stop here - we only care about the timeout arg")

    real = ba.urlopen
    ba.urlopen = fake_urlopen                  # type: ignore[assignment]
    try:
        try:
            ba.comfy_post("/prompt", {"x": 1})
        except AssertionError:
            pass
    finally:
        ba.urlopen = real                      # type: ignore[assignment]

    check("comfy_post passes a timeout at all", seen.get("timeout") != "MISSING",
          True)
    check("and it is finite", isinstance(seen.get("timeout"), (int, float))
          and seen["timeout"] > 0, True)
    check("matching the module constant", seen.get("timeout"),
          ba._COMFY_POST_TIMEOUT)
    check("the constant is a sane order of magnitude",
          1.0 <= ba._COMFY_POST_TIMEOUT <= 600.0, True)


def test_a_timeout_is_reported_not_raised_raw() -> None:
    """urllib wraps a headers-phase timeout in URLError, but one landing
    mid-BODY surfaces as a raw TimeoutError -- neither URLError nor
    ConnectionError -- and would escape as an unhandled traceback."""
    def timing_out(req, timeout=None):
        raise TimeoutError("timed out")

    real = ba.urlopen
    ba.urlopen = timing_out                    # type: ignore[assignment]
    try:
        try:
            ba.comfy_post("/prompt", {"x": 1})
            outcome = "no exception"
        except SystemExit as e:
            outcome = f"SystemExit({e.code})"
        except TimeoutError:
            outcome = "raw TimeoutError escaped"
        except Exception as e:  # noqa: BLE001
            outcome = f"{type(e).__name__}"
    finally:
        ba.urlopen = real                      # type: ignore[assignment]
    check("a mid-body timeout becomes the readable 'Cannot reach ComfyUI' exit",
          outcome, "SystemExit(2)")


# --------------------------------------------------------------------------
# 2. The render slot is honest, and self-heals
# --------------------------------------------------------------------------
def test_an_idle_slot_is_claimed() -> None:
    reset(running=False)
    started, msg = u.claim_render_slot()
    check("an idle slot starts", (started, msg), (True, "started"))
    check("and is marked running synchronously, before the thread runs",
          u._render_state["running"], True)


def test_a_live_render_is_refused_out_loud() -> None:
    reset(running=True, proc=FakeProc(alive=True))
    started, msg = u.claim_render_slot()
    check("a second render is refused", started, False)
    check("the refusal is not the word 'started'", msg.strip() != "started",
          True)
    check("and it says what to do", "Stop" in msg, True)
    check("the live render keeps the slot", u._render_state["running"], True)


def test_the_refusal_says_how_far_along_and_how_long() -> None:
    """"A render is already running" alone cannot be acted on: it reads the
    same whether the GPU is 3 images into a 16-image batch or wedged since
    lunch — and the only offered remedy (Stop) destroys work in flight. The
    owner hit exactly that ambiguity and had to ask whether it was safe to
    press Stop; the answer needed a query against their GPU."""
    import time as _t
    reset(running=True, proc=FakeProc(alive=True), cur=3, total=16,
          started=_t.time() - 9 * 60)
    started, msg = u.claim_render_slot()
    check("still refused", started, False)
    check_in("says how far along", "3/16", msg)
    check_in("says how long it has been going", "9 minutes ago", msg)
    check_in("and still says what to do", "press Stop", msg)

    # Before the batch size is known, say so rather than printing "0/0".
    reset(running=True, proc=FakeProc(alive=True), cur=0, total=0,
          started=_t.time())
    _, msg = u.claim_render_slot()
    check_in("an unstarted batch reads honestly", "still starting up", msg)
    check_not_in("and never shows 0/0", "0/0", msg)
    check_in("a fresh render reads 'just now'", "just now", msg)

    # A claim stamps the clock, so the NEXT refusal can measure from it.
    reset(running=False)
    check("no clock before the claim", u._render_state["started"], 0.0)
    u.claim_render_slot()
    check("claiming stamps the start time",
          u._render_state["started"] > 0.0, True)


def test_a_stale_flag_heals_instead_of_blocking_forever() -> None:
    # The state after the outage: flag set, subprocess gone. Previously this
    # refused every render for the life of the container, in silence.
    reset(running=True, proc=FakeProc(alive=False))
    started, msg = u.claim_render_slot()
    check("a dead subprocess frees the slot", (started, msg), (True, "started"))
    check("and the new render owns it", u._render_state["running"], True)

    # Same, with no subprocess object at all (a render that died before spawn).
    reset(running=True, proc=None)
    started, _ = u.claim_render_slot()
    check("no subprocess at all also frees the slot", started, True)


def test_my_computer_pointed_at_runpod_is_called_out() -> None:
    """Reported as "why is it looking for that online when I need to render on
    my computer?" — the panel said

        My computer · Model lists unavailable — your ComfyUI has never answered
        at https://pdn5pxpkrchofk-8188.proxy.runpod.net

    which is true and useless: COMFY_URL (documented as the tunnel to the
    user's OWN ComfyUI) had been pointed at a RunPod pod, so "My computer"
    addressed a data centre and the message sent them off to restart a tunnel
    that was never the problem."""
    flagged = [
        "https://pdn5pxpkrchofk-8188.proxy.runpod.net",   # the reported value
        "https://abc-8188.proxy.runpod.net/",
        "https://api.runpod.ai/v2/zygcn869ff2uyx",
    ]
    fine = [
        "https://comfy.invisiblewall.org",                # the named tunnel
        "https://random-words.trycloudflare.com",         # a quick tunnel
        "http://127.0.0.1:8188",                          # straight local
        "",                                               # unset: a different error
    ]
    for url in flagged:
        check(f"flagged: {url}", bool(u.local_target_misconfigured(url)), True)
    for url in fine:
        check(f"allowed: {url or '(empty)'}",
              u.local_target_misconfigured(url), "")
    msg = u.local_target_misconfigured(flagged[0])
    check_in("the message says it is a RunPod machine", "RunPod machine", msg)
    check_in("and names the variable to change", "COMFY_URL", msg)
    check_in("and gives the value to use", "comfy.invisiblewall.org", msg)
    check_in("and offers the other way out", "choose RunPod", msg)


def test_the_contradiction_outranks_every_status_tier() -> None:
    """A RUNNING pod at that address would answer, and the strip would proudly
    report 'live from your ComfyUI' while rendering on the wrong machine. The
    contradiction has to win over reachability, not follow it."""
    real_base = ba.COMFY_BASE
    try:
        ba.COMFY_BASE = "https://pdn5pxpkrchofk-8188.proxy.runpod.net"
        out = u._model_status_html("local")
        check_in("the strip leads with the contradiction",
                 "pointing at RunPod, not your computer", out)
        check_not_in("and never claims it is live", "live from your ComfyUI", out)
        check_not_in("nor blames the tunnel", "start ComfyUI + the", out)
        # The RunPod target is unaffected — that address is correct for it.
        pod_out = u._model_status_html("pod")
        check_not_in("the pod target is not flagged",
                     "pointing at RunPod, not your computer", pod_out)
        # A proper tunnel is left alone.
        ba.COMFY_BASE = "https://comfy.invisiblewall.org"
        out = u._model_status_html("local")
        check_not_in("a real tunnel is not flagged",
                     "pointing at RunPod, not your computer", out)
    finally:
        ba.COMFY_BASE = real_base


def test_the_pod_wake_follows_the_address_the_render_will_use() -> None:
    """The wake-up exists to start the machine a render is ABOUT TO TALK TO.
    It used to fire for every non-local render — including serverless ones,
    where RunPod spins its own worker and a resumed GPU pod is billed for
    nothing. Tying it to the address makes changing COMFY_URL safe."""
    import runpod_control as rc
    saved = os.environ.get("RUNPOD_POD_ID")
    try:
        os.environ["RUNPOD_POD_ID"] = "pdn5pxpkrchofk"
        check("the pod we are about to use IS woken",
              rc.targets_our_pod("https://pdn5pxpkrchofk-8188.proxy.runpod.net"),
              True)
        check("the tunnel does not wake a pod",
              rc.targets_our_pod("https://comfy.invisiblewall.org"), False)
        check("a DIFFERENT pod is not woken",
              rc.targets_our_pod("https://other-8188.proxy.runpod.net"), False)
        check("an empty url wakes nothing", rc.targets_our_pod(""), False)
        os.environ.pop("RUNPOD_POD_ID")
        check("no configured pod, nothing to wake",
              rc.targets_our_pod("https://pdn5pxpkrchofk-8188.proxy.runpod.net"),
              False)
    finally:
        if saved is None:
            os.environ.pop("RUNPOD_POD_ID", None)
        else:
            os.environ["RUNPOD_POD_ID"] = saved


def test_a_malformed_catalog_url_is_ignored_not_probed() -> None:
    """Found live as `https://s3api-eu-ro-1.runpod.io s3://wvi855bwh8/` — the
    Network Volume's S3 endpoint and bucket pasted together, space and all.
    urlparse reads that host as `s3api-eu-ro-1.runpod.io s3`, so every probe
    fails and the panel only says nothing answered."""
    import comfy_catalog as cc
    saved = os.environ.get("COMFY_CATALOG_URL")
    try:
        for bad in ["https://s3api-eu-ro-1.runpod.io s3://wvi855bwh8/",
                    "s3://wvi855bwh8/", "not a url", "ftp://host/x"]:
            os.environ["COMFY_CATALOG_URL"] = bad
            check(f"ignored: {bad[:44]}", cc.catalog_url(), "")
        for good in ["https://pdn5pxpkrchofk-8188.proxy.runpod.net",
                     "http://volume-pod:8188"]:
            os.environ["COMFY_CATALOG_URL"] = good + "/"
            check(f"kept: {good[:44]}", cc.catalog_url(), good)
    finally:
        if saved is None:
            os.environ.pop("COMFY_CATALOG_URL", None)
        else:
            os.environ["COMFY_CATALOG_URL"] = saved


def test_stop_cancels_the_remote_job_not_just_the_local_poller() -> None:
    """Owner: "I pressed stop, and I expected all the jobs queued to be
    canceled." Killing the subprocess only ended OUR side — a RunPod job kept
    rendering and BILLING, and ComfyUI's pending queue was never cleared
    (`/interrupt` aborts only what is executing right now).

    The worker was always ready for this: handler.py polls RunPod every 5s via
    `_job_cancelled` precisely so a cancelled job stops instead of running to
    completion. Nobody was calling `/cancel`."""
    cancelled: list[str] = []
    posted: list[str] = []

    real_cancel = ba.runpod_cancel
    real_urlopen = u.urllib.request.urlopen
    ba.runpod_cancel = lambda jid: (cancelled.append(jid) or "")  # type: ignore

    def fake_urlopen(req, timeout=None):
        posted.append(req.full_url)
        class R:
            def read(self): return b"{}"
        return R()

    u.urllib.request.urlopen = fake_urlopen    # type: ignore[assignment]
    try:
        reset(running=True, proc=FakeProc(alive=False))
        u._render_state["runpodJob"] = "c0d8c00d-f9c3-46ff-9857-f30f7f5af7f1-e2"
        msg = u.stop_render()
        check("the remote job is cancelled",
              cancelled, ["c0d8c00d-f9c3-46ff-9857-f30f7f5af7f1-e2"])
        check_in("and Stop says so", "cancelled", msg)
        check("ComfyUI is interrupted AND its queue cleared",
              [p.rsplit("/", 1)[-1] for p in posted], ["interrupt", "queue"])
        check("the job id is consumed, so a second Stop cannot re-cancel it",
              u._render_state["runpodJob"], "")

        # A local render has no RunPod job — Stop must not invent one.
        cancelled.clear(); posted.clear()
        reset(running=True, proc=FakeProc(alive=False))
        u.stop_render()
        check("no RunPod job, no cancel call", cancelled, [])
        check("ComfyUI is still interrupted + cleared",
              [p.rsplit("/", 1)[-1] for p in posted], ["interrupt", "queue"])

        # A cancel that FAILS must not stop the rest of Stop.
        cancelled.clear(); posted.clear()
        ba.runpod_cancel = lambda jid: "HTTPError: 500"   # type: ignore
        reset(running=True, proc=FakeProc(alive=False))
        u._render_state["runpodJob"] = "bad-job"
        msg = u.stop_render()
        check_in("a failed cancel is reported, not swallowed",
                 "could not cancel", msg)
        check("and ComfyUI is still told to stop",
              [p.rsplit("/", 1)[-1] for p in posted], ["interrupt", "queue"])
    finally:
        ba.runpod_cancel = real_cancel          # type: ignore[assignment]
        u.urllib.request.urlopen = real_urlopen  # type: ignore[assignment]


def test_an_unreadable_poll_does_not_fail_a_running_still_render() -> None:
    """The still path used to raise on the FIRST bad `/status` read, so one RunPod
    500 — or a 404 for a job it had not indexed yet — killed a region whose render
    was still going and still billing. The video path learned this in #540; this is
    the same lesson on the transport every SDXL/FLUX region goes through.

    Fixtured against the loop directly, because there is no hand-off slot on this
    path: a job genuinely lost here is a lost render, so the grace IS the guard."""
    real_get, real_post = ba._runpod_get, ba._runpod_post
    real_cancel, real_sleep = ba.runpod_cancel, ba.time.sleep
    real_grace = ba.STATUS_GRACE_SECONDS
    cancelled: list = []
    ba.time.sleep = lambda _s: None
    ba._runpod_post = lambda path, payload: {"id": "job-still-1"}
    ba.runpod_cancel = lambda jid: (cancelled.append(jid) or "")
    try:
        reads = {"n": 0}

        def flaky(path):
            reads["n"] += 1
            if reads["n"] == 1:
                return {"status": "IN_PROGRESS"}
            if reads["n"] in (2, 3):
                raise ba.RunPodHTTPError(500, "RunPod /status failed: HTTP 500")
            return {"status": "COMPLETED", "output": {"images": [{"x": 1}]}}

        ba._runpod_get = flaky
        out = ba._runpod_run_and_wait({"input": {}}, "H1")
        check("a blip mid-render does not fail the region",
              out, {"images": [{"x": 1}]})
        check("and nothing is cancelled over a read that merely failed",
              cancelled, [])

        cancelled.clear()
        ba.STATUS_GRACE_SECONDS = 0.05

        def always_500(path):
            raise ba.RunPodHTTPError(500, "RunPod /status failed: HTTP 500")

        ba._runpod_get = always_500
        try:
            ba._runpod_run_and_wait({"input": {}}, "H1")
            check("a job we can no longer read is failed", False, True)
        except RuntimeError as e:
            check_in("the message says contact was lost", "lost contact", str(e))
        check("and it is stopped so it stops burning", cancelled, ["job-still-1"])
    finally:
        ba._runpod_get, ba._runpod_post = real_get, real_post
        ba.runpod_cancel, ba.time.sleep = real_cancel, real_sleep
        ba.STATUS_GRACE_SECONDS = real_grace


def test_a_purged_still_job_is_named_as_such_and_not_cancelled() -> None:
    """A 404 after a successful read is an ANSWER — RunPod drops a finished job's
    record after ~30 min — so it gives up on the short budget, does not pretend to
    cancel a job that no longer exists, and does not blame the graph. A 404 BEFORE
    any successful read is just a job not indexed yet, and keeps the long grace."""
    real_get, real_post = ba._runpod_get, ba._runpod_post
    real_cancel, real_sleep = ba.runpod_cancel, ba.time.sleep
    real_short, real_long = ba.NOT_FOUND_GRACE_SECONDS, ba.STATUS_GRACE_SECONDS
    real_emit = ba.emit
    cancelled: list = []
    diags: list = []
    ba.time.sleep = lambda _s: None
    ba._runpod_post = lambda path, payload: {"id": "job-still-2"}
    ba.runpod_cancel = lambda jid: (cancelled.append(jid) or "")
    ba.emit = lambda line: diags.append(str(line))
    try:
        reads = {"n": 0}

        def read_then_gone(path):
            reads["n"] += 1
            if reads["n"] == 1:
                return {"status": "IN_PROGRESS"}
            raise ba.RunPodHTTPError(404, "RunPod /status: HTTP 404 Not Found")

        ba._runpod_get = read_then_gone
        ba.NOT_FOUND_GRACE_SECONDS = 0.05
        ba.STATUS_GRACE_SECONDS = 30.0   # if this were used, the test would hang
        try:
            ba._runpod_run_and_wait({"input": {}}, "H1")
            check("a purged job raises", False, True)
        except RuntimeError as e:
            check_in("named as an expired record, not a network fault",
                     "no longer has a record", str(e))
        check("nothing is cancelled that RunPod has no record of", cancelled, [])
        check("the diagnostic points at RunPod, not the graph",
              any("RUNPOD_STATUS_UNREADABLE" in d for d in diags), True)
        check("COMFY_NODE_FAILED is NOT emitted for a transport failure",
              any("COMFY_NODE_FAILED" in d for d in diags), False)

        cancelled.clear()
        diags.clear()
        ba.STATUS_GRACE_SECONDS = 0.05

        def always_404(path):
            raise ba.RunPodHTTPError(404, "RunPod /status: HTTP 404 Not Found")

        ba._runpod_get = always_404
        try:
            ba._runpod_run_and_wait({"input": {}}, "H1")
        except RuntimeError as e:
            check_in("a job never once read reads as lost contact",
                     "lost contact", str(e))
        check("and IS stopped, because it may be live", cancelled, ["job-still-2"])
    finally:
        ba._runpod_get, ba._runpod_post = real_get, real_post
        ba.runpod_cancel, ba.time.sleep = real_cancel, real_sleep
        ba.NOT_FOUND_GRACE_SECONDS, ba.STATUS_GRACE_SECONDS = real_short, real_long
        ba.emit = real_emit


def test_the_job_id_reaches_the_ui_without_polluting_the_log() -> None:
    """The UI process cannot know the job id any other way — it lives in the
    subprocess. It rides a marker line, which must never show up as log noise."""
    check("the marker is distinctive", ba.RUNPOD_JOB_MARK.startswith("@@"), True)
    line = f"{ba.RUNPOD_JOB_MARK}abc123-e2\n"
    check("a marker line is recognised", line.startswith(ba.RUNPOD_JOB_MARK),
          True)
    check("and yields a clean id",
          line[len(ba.RUNPOD_JOB_MARK):].strip(), "abc123-e2")
    check("an ordinary log line is not mistaken for one",
          "   ... serverless job abc123-e2 IN_QUEUE (16s elapsed)\n".startswith(
              ba.RUNPOD_JOB_MARK), False)


def test_stop_clears_the_slot_for_the_next_render() -> None:
    reset(running=True, proc=FakeProc(alive=False))
    u.claim_render_slot()                      # heals + claims
    u._render_state.update(running=False, done=True)   # what the finally does
    started, msg = u.claim_render_slot()
    check("after a render ends the slot is free again", (started, msg),
          (True, "started"))


if __name__ == "__main__":
    real_proc = u._render_proc
    try:
        for fn in (test_the_submit_call_cannot_wait_forever,
                   test_a_timeout_is_reported_not_raised_raw,
                   test_an_idle_slot_is_claimed,
                   test_a_live_render_is_refused_out_loud,
                   test_the_refusal_says_how_far_along_and_how_long,
                   test_a_stale_flag_heals_instead_of_blocking_forever,
                   test_my_computer_pointed_at_runpod_is_called_out,
                   test_the_contradiction_outranks_every_status_tier,
                   test_the_pod_wake_follows_the_address_the_render_will_use,
                   test_a_malformed_catalog_url_is_ignored_not_probed,
                   test_stop_cancels_the_remote_job_not_just_the_local_poller,
                   test_an_unreadable_poll_does_not_fail_a_running_still_render,
                   test_a_purged_still_job_is_named_as_such_and_not_cancelled,
                   test_the_job_id_reaches_the_ui_without_polluting_the_log,
                   test_stop_clears_the_slot_for_the_next_render):
            print(f"\n-- {fn.__name__}")
            fn()
    finally:
        u._render_proc = real_proc              # type: ignore[assignment]
        u._render_state.update(running=False, done=False, log="")
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
