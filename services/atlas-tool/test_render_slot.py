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

import sys

import batch_atlas as ba
import ui_server as u

FAILED: list[str] = []
PASSED: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")


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
                   test_stop_clears_the_slot_for_the_next_render):
            print(f"\n-- {fn.__name__}")
            fn()
    finally:
        u._render_proc = real_proc              # type: ignore[assignment]
        u._render_state.update(running=False, done=False, log="")
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
