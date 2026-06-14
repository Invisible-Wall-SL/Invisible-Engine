"""Offline self-test for blueprint_models.prepare_blueprint_models (B43 §4).

This guards the risky reboot / poll / cache flow that drives ComfyUI-Manager's
model-install queue. The module was designed for injection: the two HTTP
primitives (``http_post`` / ``http_get``), the installed-check (``is_installed``)
and the clocks (``sleep`` / ``now``) are all parameters, so every branch runs
with zero network here.

Run:  py test_blueprint_models.py
Exits non-zero if any assertion fails; prints "N passed, 0 failed" on success.
"""
from __future__ import annotations

import sys

import blueprint_models as bm


# --------------------------------------------------------------------------
# Tiny injection harness: a scriptable ComfyUI-Manager double.
# --------------------------------------------------------------------------
class FakeManager:
    """Records POSTs and answers GETs from a scripted status sequence.

    ``manager_absent`` raises ManagerAbsent (404) on every /manager/* route.
    ``unreachable`` raises ComfyUnreachable on every route.
    ``install_status`` maps a filename -> the int status install_model returns.
    ``start_status`` is what /manager/queue/start returns.
    ``status_seq`` is the list of dicts /manager/queue/status yields in order
        (the last one repeats once exhausted).
    ``reboot_status`` is what /manager/reboot returns (or raise via reboot_raises).
    """

    def __init__(
        self,
        *,
        manager_absent: bool = False,
        unreachable: bool = False,
        install_status: dict | None = None,
        default_install_status: int = 200,
        start_status: int = 200,
        status_seq: list[dict] | None = None,
        reboot_status: int = 200,
        reboot_raises: bool = True,  # os.execv drops the connection
        system_stats_up_after: int = 0,  # /system_stats succeeds from this call on
    ):
        self.manager_absent = manager_absent
        self.unreachable = unreachable
        self.install_status = install_status or {}
        self.default_install_status = default_install_status
        self.start_status = start_status
        self.status_seq = status_seq or [
            {"total_count": 1, "done_count": 1, "in_progress_count": 0,
             "is_processing": False},
        ]
        self.reboot_status = reboot_status
        self.reboot_raises = reboot_raises
        self.system_stats_up_after = system_stats_up_after

        self.posts: list[tuple[str, dict]] = []
        self._status_i = 0
        self._sysstat_calls = 0

    # -- POST ---------------------------------------------------------------
    def post(self, path: str, body: dict) -> tuple[int, str]:
        self.posts.append((path, body))
        if self.manager_absent:
            raise bm.ManagerAbsent(path)
        if self.unreachable:
            raise bm.ComfyUnreachable("down")
        if path == "/manager/queue/install_model":
            fname = body.get("filename", "")
            return self.install_status.get(fname, self.default_install_status), "ok"
        if path == "/manager/queue/start":
            return self.start_status, "ok"
        if path == "/manager/reboot":
            if self.reboot_raises:
                raise bm.ComfyUnreachable("connection dropped (execv)")
            return self.reboot_status, "ok"
        raise AssertionError(f"unexpected POST {path}")

    # -- GET ----------------------------------------------------------------
    def get(self, path: str) -> dict:
        if self.manager_absent:
            raise bm.ManagerAbsent(path)
        if path == "/manager/queue/status":
            i = min(self._status_i, len(self.status_seq) - 1)
            self._status_i += 1
            return self.status_seq[i]
        if path == "/system_stats":
            self._sysstat_calls += 1
            if self._sysstat_calls <= self.system_stats_up_after:
                raise bm.ComfyUnreachable("still rebooting")
            return {"system": {"comfyui_version": "test"}}
        raise AssertionError(f"unexpected GET {path}")

    # -- helpers ------------------------------------------------------------
    def install_posts(self) -> list[tuple[str, dict]]:
        return [p for p in self.posts if p[0] == "/manager/queue/install_model"]

    def rebooted(self) -> bool:
        return any(p[0] == "/manager/reboot" for p in self.posts)

    def started(self) -> bool:
        return any(p[0] == "/manager/queue/start" for p in self.posts)


# A clock that never really sleeps but advances `now` by the requested delay,
# so timeouts/grace windows are exercised deterministically and instantly.
class FakeClock:
    def __init__(self) -> None:
        self.t = 0.0

    def sleep(self, dt: float) -> None:
        self.t += dt

    def now(self) -> float:
        return self.t


def run(models, fm: FakeManager, *, is_installed, env=None, **kw):
    """Invoke prepare with the fake manager + fast clock. `env` patches
    os.environ for the kill-switch test."""
    import os
    saved = {}
    if env:
        for k, v in env.items():
            saved[k] = os.environ.get(k)
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    clock = FakeClock()
    try:
        return bm.prepare_blueprint_models(
            models,
            http_post=fm.post,
            http_get=fm.get,
            is_installed=is_installed,
            sleep=clock.sleep,
            now=clock.now,
            **kw,
        )
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


# --------------------------------------------------------------------------
# Test cases
# --------------------------------------------------------------------------
PASS = 0
FAIL = 0


def check(cond: bool, label: str) -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {label}")
    else:
        FAIL += 1
        print(f"  FAIL {label}")


def catalog_model(fname="model.safetensors"):
    return {
        "field": "ckpt_name", "filename": fname,
        "url": "https://example/model.safetensors",
        "save_path": "checkpoints", "base": "SDXL",
    }


def test_a_installable_post_body():
    """(a) An installable catalog model produces the correct install POST body."""
    fm = FakeManager()
    run([catalog_model("a.safetensors")], fm, is_installed=lambda f, n: False)
    posts = fm.install_posts()
    check(len(posts) == 1, "(a) one install_model POST sent")
    body = posts[0][1]
    check(body.get("url") == "https://example/model.safetensors", "(a) url in body")
    check(body.get("filename") == "a.safetensors", "(a) filename in body")
    check(body.get("save_path") == "checkpoints", "(a) save_path in body")
    check(body.get("base") == "SDXL", "(a) base in body")
    check(body.get("ui_id") == "a.safetensors", "(a) ui_id mirrors filename")


def test_b_non_catalog_no_post():
    """(b) A non-catalog model (no url/save_path) -> checklist, no POST."""
    m = {"field": "ckpt_name", "filename": "custom.safetensors"}  # no url/save_path/base
    fm = FakeManager()
    res = run([m], fm, is_installed=lambda f, n: False)
    check(len(fm.install_posts()) == 0, "(b) no install POST for non-catalog model")
    check(not res.ready, "(b) result not ready")
    check(any("custom.safetensors" == e["filename"] for e in res.still_missing),
          "(b) non-catalog model on checklist")
    check(not fm.started(), "(b) worker not started")


def test_c_per_model_400_403():
    """(c) Per-model 400 and 403 -> checklist; a 200 model still proceeds."""
    good = catalog_model("good.safetensors")
    bad400 = catalog_model("bad400.safetensors")
    bad403 = catalog_model("bad403.safetensors")
    fm = FakeManager(install_status={
        "bad400.safetensors": 400,
        "bad403.safetensors": 403,
        "good.safetensors": 200,
    })

    def installed(field, name):
        # All missing before reboot; only the good (200) model present after.
        return fm.rebooted() and name == "good.safetensors"

    res = run([good, bad400, bad403], fm, is_installed=installed)
    check(len(fm.install_posts()) == 3, "(c) all three queued attempts POSTed")
    missing = {e["filename"] for e in res.still_missing}
    check("bad400.safetensors" in missing, "(c) 400 model on checklist")
    check("bad403.safetensors" in missing, "(c) 403 model on checklist")
    check(fm.started(), "(c) worker started for the good model")
    check("good.safetensors" in res.installed, "(c) good model resolved")
    check(not res.ready, "(c) result not ready (two still missing)")


def test_d_full_sequence_fires():
    """(d) Full start->poll->reboot->wait->recheck sequence when queued."""
    fm = FakeManager(
        status_seq=[
            {"total_count": 1, "done_count": 0, "in_progress_count": 1,
             "is_processing": True},
            {"total_count": 1, "done_count": 1, "in_progress_count": 0,
             "is_processing": False},
        ],
    )
    res = run([catalog_model()], fm, is_installed=lambda f, n: fm.rebooted())
    check(fm.started(), "(d) queue/start fired")
    check(fm.rebooted(), "(d) reboot fired")
    check(res.ready, "(d) ready after full sequence")
    check("model.safetensors" in res.installed, "(d) model recorded installed")


def test_e_already_installed_skipped():
    """(e) Already-installed model -> skipped, no POST, ready."""
    fm = FakeManager()
    res = run([catalog_model()], fm, is_installed=lambda f, n: True)
    check(len(fm.install_posts()) == 0, "(e) no install POST when already installed")
    check(not fm.started(), "(e) worker not started")
    check(not fm.rebooted(), "(e) no reboot")
    check(res.ready, "(e) ready")


def test_f_manager_absent():
    """(f) Manager absent (404 everywhere) -> checklist, no crash."""
    fm = FakeManager(manager_absent=True)
    # is_installed returns False (not installed) so it tries to queue, then the
    # install_model POST raises ManagerAbsent (404).
    res = run([catalog_model()], fm, is_installed=lambda f, n: False)
    check(not res.ready, "(f) not ready when Manager absent")
    check(len(res.still_missing) == 1, "(f) the model is on the checklist")
    check(not fm.rebooted(), "(f) no reboot when Manager absent")


def test_g_kill_switch_off():
    """(g) Kill-switch off -> checklist only, no install/start/reboot."""
    fm = FakeManager()
    res = run([catalog_model()], fm, is_installed=lambda f, n: False,
              env={"BLUEPRINT_AUTO_INSTALL_MODELS": "off"})
    check(len(fm.install_posts()) == 0, "(g) no install POST with kill-switch off")
    check(not fm.started(), "(g) worker not started")
    check(not fm.rebooted(), "(g) no reboot")
    check(not res.ready, "(g) not ready (listed as missing)")
    check(any("disabled" in e["reason"] for e in res.still_missing),
          "(g) checklist cites disabled auto-install")


def test_h_still_missing_required():
    """(h) Required model still missing after install+reboot -> not ready."""
    fm = FakeManager()
    # is_installed never returns True -> still missing after reboot.
    res = run([catalog_model()], fm, is_installed=lambda f, n: False)
    check(fm.rebooted(), "(h) reboot still attempted")
    check(not res.ready, "(h) not ready when model stays invisible")
    check(any("not visible" in e["reason"] for e in res.still_missing),
          "(h) checklist explains post-reboot invisibility")


def test_i_worker_start_race():
    """(i) NEW: idle/total_count=0 immediately after start must NOT be declared
    done prematurely. The status reads idle-with-zero-work first (the worker
    hasn't flipped is_processing), then real progress, then completes."""
    fm = FakeManager(
        status_seq=[
            # Race window: worker not started yet — idle, nothing counted.
            {"total_count": 0, "done_count": 0, "in_progress_count": 0,
             "is_processing": False},
            # Worker now picked up the job.
            {"total_count": 1, "done_count": 0, "in_progress_count": 1,
             "is_processing": True},
            # Done for real.
            {"total_count": 1, "done_count": 1, "in_progress_count": 0,
             "is_processing": False},
        ],
    )
    # is_installed: missing until reboot, then present (download succeeded).
    res = run([catalog_model()], fm, is_installed=lambda f, n: fm.rebooted())
    # Critical: it must NOT have rebooted on the first idle/zero reading; it must
    # wait for real progress then complete -> ready, with the model installed.
    check(res.ready, "(i) ready (did not resolve on the premature idle reading)")
    check("model.safetensors" in res.installed, "(i) model installed after real run")
    # The poll must have consumed past the first (race) status to see progress.
    check(fm._status_i >= 3, "(i) poll waited through the start race")


def test_i2_pure_premature_idle_blocked():
    """(i) Direct check on the poll: a lone idle/zero reading before the grace
    elapses does not resolve; it only resolves once real work shows up."""
    res = bm.PrepareResult()
    fm = FakeManager(
        status_seq=[
            {"total_count": 0, "done_count": 0, "in_progress_count": 0,
             "is_processing": False},  # race window — must be distrusted
            {"total_count": 2, "done_count": 2, "in_progress_count": 0,
             "is_processing": True},   # processing observed
            {"total_count": 2, "done_count": 2, "in_progress_count": 0,
             "is_processing": False},  # now genuinely done
        ],
    )
    clock = FakeClock()
    done = bm._poll_queue_done(res, fm.get, 120.0, 1.0, clock.sleep, clock.now)
    check(done, "(i) poll eventually reports done")
    # Must have read more than the first status (didn't trust the race reading).
    check(fm._status_i >= 3, "(i) poll did not resolve on the first idle reading")


def test_j_post_reboot_recheck_uses_fresh_state():
    """(j) NEW: the post-reboot recheck must read FRESH install state. We model a
    cache via a flag that on_rebooted() flips; is_installed honours the flag.
    Before reboot it reports missing (stale cache); only after on_rebooted busts
    the cache does it report installed. Result must be ready."""
    cache = {"busted": False, "raw_installed": False}

    fm = FakeManager(
        status_seq=[
            {"total_count": 1, "done_count": 1, "in_progress_count": 0,
             "is_processing": True},
            {"total_count": 1, "done_count": 1, "in_progress_count": 0,
             "is_processing": False},
        ],
    )

    def on_rebooted():
        # The real model is on disk after reboot; busting the cache lets the
        # check see it. Simulate the cache going live.
        cache["busted"] = True
        cache["raw_installed"] = True

    def is_installed(field, name):
        # Stale pre-reboot cache says "missing"; only a busted cache sees truth.
        if not cache["busted"]:
            return False
        return cache["raw_installed"]

    res = run([catalog_model()], fm, is_installed=is_installed,
              on_rebooted=on_rebooted)
    check(fm.rebooted(), "(j) reboot fired")
    check(cache["busted"], "(j) on_rebooted hook ran (cache busted)")
    check(res.ready, "(j) ready because recheck used fresh (busted) state")
    check("model.safetensors" in res.installed, "(j) model verified post-reboot")


def test_j2_no_reboot_no_cache_bust():
    """(j) The on_rebooted hook must NOT fire on no-reboot paths (already
    installed -> no reboot -> no bust)."""
    fired = {"v": False}

    def on_rebooted():
        fired["v"] = True

    fm = FakeManager()
    run([catalog_model()], fm, is_installed=lambda f, n: True, on_rebooted=on_rebooted)
    check(not fired["v"], "(j) on_rebooted NOT called when nothing rebooted")


def main() -> int:
    tests = [
        test_a_installable_post_body,
        test_b_non_catalog_no_post,
        test_c_per_model_400_403,
        test_d_full_sequence_fires,
        test_e_already_installed_skipped,
        test_f_manager_absent,
        test_g_kill_switch_off,
        test_h_still_missing_required,
        test_i_worker_start_race,
        test_i2_pure_premature_idle_blocked,
        test_j_post_reboot_recheck_uses_fresh_state,
        test_j2_no_reboot_no_cache_bust,
    ]
    for t in tests:
        print(f"\n{t.__name__}: {t.__doc__.splitlines()[0]}")
        t()
    print(f"\n{'=' * 48}\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
