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


def reset(running: bool = False, proc=None) -> None:
    u._render_state.update(running=running, done=False, log="", cur=0, total=0,
                           diagnostics=[])
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
                   test_a_stale_flag_heals_instead_of_blocking_forever,
                   test_my_computer_pointed_at_runpod_is_called_out,
                   test_the_contradiction_outranks_every_status_tier,
                   test_the_pod_wake_follows_the_address_the_render_will_use,
                   test_a_malformed_catalog_url_is_ignored_not_probed,
                   test_stop_clears_the_slot_for_the_next_render):
            print(f"\n-- {fn.__name__}")
            fn()
    finally:
        u._render_proc = real_proc              # type: ignore[assignment]
        u._render_state.update(running=False, done=False, log="")
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
