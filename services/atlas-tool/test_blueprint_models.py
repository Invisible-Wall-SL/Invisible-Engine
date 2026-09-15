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
        catalog: list | None = None,     # rows /externalmodel/getlist returns
        catalog_raises: Exception | None = None,
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
        self.catalog = catalog or []
        self.catalog_raises = catalog_raises

        self.posts: list[tuple[str, dict]] = []
        self.gets: list[str] = []
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
        self.gets.append(path)
        if self.manager_absent:
            raise bm.ManagerAbsent(path)
        if path == bm.CATALOG_PATH:
            if self.catalog_raises:
                raise self.catalog_raises
            return {"models": self.catalog}
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

    def read_catalog(self) -> bool:
        return bm.CATALOG_PATH in self.gets

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


def test_k_no_verdict_is_not_missing():
    """(k) `is_installed` -> None on a NON-installable model is an advisory, not
    a refusal. Five of the fourteen fields in `blueprints.MODEL_FIELD_DIRS` have
    no loader in `batch_atlas._MODEL_FIELD_NODES`, so they can never be read; a
    derived declaration can never satisfy the catalog shape either. Reported as
    "missing" that was an unclearable checklist line blocking a render that
    would have worked."""
    m = {"field": "pulid_file", "filename": "ip-adapter.bin"}  # no url/base
    fm = FakeManager()
    res = run([m], fm, is_installed=lambda f, n: None)
    check(res.ready, "(k) ready — a non-answer never refuses the run")
    check(len(res.still_missing) == 0, "(k) nothing refusal-grade")
    check(len(res.advisories) == 1, "(k) one advisory instead")
    check(res.advisories[0]["filename"] == "ip-adapter.bin", "(k) advisory names the file")
    check(len(fm.install_posts()) == 0, "(k) nothing queued (not installable)")
    check(not fm.rebooted(), "(k) no reboot")
    check("could not be verified" in bm.format_advisories(res),
          "(k) the advisories block says it could not be verified")


def test_l_no_verdict_still_queues_an_installable_model():
    """(l) `is_installed` -> None on an INSTALLABLE model must STILL be queued.
    Manager's (save_path, base, filename) whitelist is the real gate and a
    redundant install is a near no-op, so declining to try on 'cannot tell'
    would silently remove the model's only automatic delivery path."""
    fm = FakeManager()
    seen = {"n": 0}

    def is_installed(field, name):
        # Never a verdict, before or after the reboot.
        seen["n"] += 1
        return None

    res = run([catalog_model("q.safetensors")], fm, is_installed=is_installed)
    check(len(fm.install_posts()) == 1, "(l) the install was queued anyway")
    check(fm.install_posts()[0][1]["filename"] == "q.safetensors",
          "(l) and it queued the right file")
    check(res.ready, "(l) ready — the post-reboot non-answer is not fatal either")
    check(len(res.still_missing) == 0, "(l) nothing refusal-grade")


def test_m_phase5_no_verdict_is_an_advisory():
    """(m) A None on the POST-REBOOT recheck is an advisory too. Otherwise a
    hand-authored model on an unmapped field is queued, downloaded (multi-GB),
    rebooted for, and THEN declared 'still not visible' — a SystemExit(2) after
    paying the whole download."""
    fm = FakeManager()

    def is_installed(field, name):
        # Definitely absent before the reboot; unreadable after it.
        return None if fm.rebooted() else False

    res = run([catalog_model("late.safetensors")], fm, is_installed=is_installed)
    check(fm.rebooted(), "(m) the install ran and rebooted")
    check(res.ready, "(m) ready — 'could not verify' after the reboot is not fatal")
    check(len(res.still_missing) == 0, "(m) nothing refusal-grade")
    check(any(e["filename"] == "late.safetensors" for e in res.advisories),
          "(m) the file is on the advisories instead")
    check("late.safetensors" in res.installed, "(m) and it counts as installed")


def test_n_survey_installs_nothing():
    """(n) The serverless path is a MESSAGE, not a gate. `survey_blueprint_models`
    touches no primitive at all, so a pod render can neither install onto nor
    reboot the artist's desktop — and it can never refuse."""
    fm = FakeManager()
    models = [catalog_model("a.safetensors"),
              {"field": "pulid_file", "filename": "b.bin"}]
    res = bm.survey_blueprint_models(models)
    check(res.ready, "(n) survey can never refuse")
    check(len(res.still_missing) == 0, "(n) nothing refusal-grade")
    check(len(res.advisories) == 2, "(n) every declared model is reported")
    check(fm.posts == [], "(n) not one POST was sent")
    check(not fm.rebooted(), "(n) nobody's ComfyUI was rebooted")
    check(bm.survey_blueprint_models([]).ready, "(n) an empty list is fine too")


def test_o_provenance_reaches_the_checklist():
    """(o) `_checklist_entry` must carry `r2_key`/`sha256`/`size` through. It is
    the single constructor of every reported row, and the caller's mirror
    enrichment falls back to a stored key when R2 cannot be read — which it
    cannot do if the key was dropped here."""
    m = {"field": "ckpt_name", "filename": "priv.safetensors",
         "r2_key": "comfyui-models/checkpoints/priv.safetensors",
         "sha256": "abc123", "size": 1234}
    fm = FakeManager()
    res = run([m], fm, is_installed=lambda f, n: False)
    row = res.still_missing[0]
    check(row.get("r2_key") == "comfyui-models/checkpoints/priv.safetensors",
          "(o) r2_key survives onto the checklist row")
    check(row.get("sha256") == "abc123", "(o) so does sha256")
    check(row.get("size") == 1234, "(o) and size")


def test_p_a_model_with_no_field_is_asked_about_anyway():
    """(p) A `models[]` entry with no `field` is legal — `_validate_models`
    normalises it to "" and the back-compat {source, dir} shape predates the key
    — and it is the CANNOT-CHECK case, not the not-installed one. Guarding the
    call with `if fld and fname` manufactured a hard False without asking
    anything: a non-installable one was refused with zero presence evidence, and
    an installable one was queued, downloaded, rebooted for, and THEN declared
    still not visible."""
    asked: list[tuple] = []

    def is_installed(field, name):
        asked.append((field, name))
        return None

    fm = FakeManager()
    res = run([{"filename": "unfielded.bin"}], fm, is_installed=is_installed)
    check(asked == [("", "unfielded.bin")], "(p) the primitive was actually asked")
    check(res.ready, "(p) ready — nothing answered 'missing'")
    check(len(res.still_missing) == 0, "(p) nothing refusal-grade")
    check(len(res.advisories) == 1, "(p) one advisory instead")

    # The installable half of the fork: it must survive the whole install +
    # reboot round trip without the phase-5 recheck inventing a False either.
    m = dict(catalog_model("nofield.safetensors"))
    m.pop("field")
    fm2 = FakeManager()
    res2 = run([m], fm2, is_installed=is_installed)
    check(len(fm2.install_posts()) == 1, "(p) the installable one was queued")
    check(res2.ready, "(p) and the post-reboot non-answer is not fatal")
    check(len(res2.still_missing) == 0, "(p) still nothing refusal-grade")


def test_q_a_delivery_failure_is_not_a_presence_verdict():
    """(q) Manager's 400 ("not in my curated catalog"), an absent Manager, a
    disabled kill-switch, a stalled download — every one of them says "I could
    not deliver this file", never "it is not on the target". Refusing over one
    for a model whose presence was never established (a `pulid_file` with a
    hand-added url is exactly that model) kills a render on a question nobody
    answered. The same failure with a real False verdict behind it stays
    refusal-grade."""
    private = {"field": "pulid_file", "filename": "pulid_flux.safetensors",
               "url": "https://example/pulid", "save_path": "pulid",
               "base": "FLUX.1"}

    for label, kw in (("400 not in the catalog",
                       {"install_status": {"pulid_flux.safetensors": 400}}),
                      ("403 security level",
                       {"install_status": {"pulid_flux.safetensors": 403}}),
                      ("Manager absent", {"manager_absent": True}),
                      ("ComfyUI unreachable", {"unreachable": True})):
        fm = FakeManager(**kw)
        res = run([private], fm, is_installed=lambda f, n: None)
        check(res.ready, f"(q) {label}: no verdict -> the run is not refused")
        check(len(res.still_missing) == 0, f"(q) {label}: nothing refusal-grade")
        check(len(res.advisories) == 1, f"(q) {label}: reported as an advisory")

        known = FakeManager(**kw)
        res2 = run([dict(private, field="ckpt_name")], known,
                   is_installed=lambda f, n: False)
        check(not res2.ready, f"(q) {label}: a real 'absent' still refuses")
        check(len(res2.still_missing) == 1, f"(q) {label}: on the checklist")

    fm = FakeManager()
    off = run([private], fm, is_installed=lambda f, n: None,
              env={"BLUEPRINT_AUTO_INSTALL_MODELS": "0"})
    check(off.ready, "(q) kill-switch off: no verdict -> not refused")
    check(len(off.advisories) == 1, "(q) kill-switch off: reported as an advisory")

    stalled = FakeManager(status_seq=[{"total_count": 1, "done_count": 0,
                                       "in_progress_count": 1,
                                       "is_processing": True}])
    slow = run([private], stalled, is_installed=lambda f, n: None,
               status_timeout=5.0)
    check(slow.ready, "(q) download timeout: no verdict -> not refused")
    check(len(slow.still_missing) == 0, "(q) download timeout: nothing refused")
    check(len(slow.advisories) == 1, "(q) download timeout: an advisory instead")


# --------------------------------------------------------------------------
# Catalog enrichment (2026-09-09). Auto-install had never once fired for an
# uploaded blueprint: a graph-derived model carries no url and no base, so it
# failed `_is_installable` at the first gate and Manager was never contacted.
# --------------------------------------------------------------------------
def derived_model(fname="a.safetensors", field="ckpt_name",
                  save_path="checkpoints"):
    """Exactly what `blueprints.derive_models_from_graph` emits — a field, a
    filename and a folder. No url, no base; that is the whole problem."""
    return {"field": field, "filename": fname, "save_path": save_path}


def catalog_row(fname="a.safetensors", save_path="checkpoints", base="SDXL",
                url="https://cat/a.safetensors", type_="checkpoint",
                name="A Model"):
    return {"filename": fname, "save_path": save_path, "base": base,
            "url": url, "type": type_, "name": name}


def test_r_derived_model_is_enriched_and_queued():
    """(r) A derived model the catalog knows becomes installable and is queued."""
    m = derived_model()
    fm = FakeManager(catalog=[catalog_row()])
    res = run([m], fm, is_installed=lambda f, n: fm.rebooted())
    posts = fm.install_posts()
    check(fm.read_catalog(), "(r) the catalog was read")
    check(len(posts) == 1, "(r) the enriched model was queued")
    body = posts[0][1] if posts else {}
    check(body.get("url") == "https://cat/a.safetensors", "(r) catalog url in body")
    check(body.get("base") == "SDXL", "(r) catalog base in body")
    check(body.get("save_path") == "checkpoints", "(r) save_path in body")
    check(m.get("save_path") == "checkpoints",
          "(r) the DERIVED save_path is left intact for model_mirror")
    check(res.ready, "(r) nothing refused")
    check("a.safetensors" in res.installed,
          "(r) a model that could never install before now installs")


def test_s_subfolder_catalog_row_is_refused():
    """(s) A catalog row installing into a SUBFOLDER is never adopted."""
    m = derived_model(fname="cn.safetensors", field="control_net_name",
                      save_path="controlnet")
    fm = FakeManager(catalog=[catalog_row(fname="cn.safetensors",
                                          save_path="controlnet/SDXL",
                                          type_="controlnet")])
    res = run([m], fm, is_installed=lambda f, n: False)
    check(len(fm.install_posts()) == 0, "(s) no install POST for a subfolder row")
    check(not res.ready, "(s) it stays on the checklist")
    check("url" not in m or not m["url"], "(s) nothing was written onto the model")


def test_t_ambiguous_catalog_rows_adopt_nothing():
    """(t) Two catalog rows with one filename adopt NOTHING — no coin flip."""
    m = derived_model(fname="diffusion_pytorch_model.safetensors",
                      field="lora_name", save_path="loras")
    rows = [
        catalog_row(fname="diffusion_pytorch_model.safetensors",
                    save_path="loras", base="SD1.5",
                    url="https://cat/one.safetensors", type_="lora"),
        catalog_row(fname="diffusion_pytorch_model.safetensors",
                    save_path="loras", base="SDXL",
                    url="https://cat/two.safetensors", type_="lora"),
    ]
    fm = FakeManager(catalog=rows)
    res = run([m], fm, is_installed=lambda f, n: False)
    check(len(fm.install_posts()) == 0, "(t) ambiguity queues nothing")
    check(not res.ready, "(t) it stays on the checklist")


def test_u_alias_folder_is_adopted():
    """(u) `unet` and `diffusion_models` are one folder to ComfyUI, so adopt."""
    m = derived_model(fname="flux.safetensors", field="unet_name",
                      save_path="unet")
    fm = FakeManager(catalog=[catalog_row(fname="flux.safetensors",
                                          save_path="diffusion_models",
                                          base="FLUX.1",
                                          url="https://cat/flux.safetensors",
                                          type_="diffusion_model")])
    run([m], fm, is_installed=lambda f, n: False)
    posts = fm.install_posts()
    check(len(posts) == 1, "(u) the alias folder was adopted")
    body = posts[0][1] if posts else {}
    check(body.get("save_path") == "diffusion_models",
          "(u) the body carries MANAGER's spelling, which the whitelist compares")
    check(m.get("save_path") == "unet",
          "(u) the model keeps OURS, which model_mirror builds its key from")


def test_v_unmappable_field_is_never_enriched():
    """(v) A model with no save_path is not enriched — nothing to check against."""
    m = {"field": "weird_name", "filename": "a.safetensors", "save_path": ""}
    fm = FakeManager(catalog=[catalog_row()])
    res = run([m], fm, is_installed=lambda f, n: False)
    check(len(fm.install_posts()) == 0, "(v) an unmappable field queues nothing")
    check(not res.ready, "(v) it stays on the checklist")


def test_w_default_save_path_row_carries_type():
    """(w) A `default` row is passed through verbatim, with its type."""
    m = derived_model(fname="up.safetensors", field="vae_name", save_path="vae")
    fm = FakeManager(catalog=[catalog_row(fname="up.safetensors",
                                          save_path="default", base="SD1.5",
                                          url="https://cat/up.safetensors",
                                          type_="VAE")])
    run([m], fm, is_installed=lambda f, n: False)
    posts = fm.install_posts()
    check(len(posts) == 1, "(w) a 'default' row is adoptable")
    body = posts[0][1] if posts else {}
    check(body.get("save_path") == "default",
          "(w) 'default' reaches Manager verbatim (the whitelist compares it)")
    check(body.get("type") == "VAE",
          "(w) type rides along — get_model_dir resolves 'default' through it")


def test_x_unreadable_catalog_changes_nothing():
    """(x) An unreadable catalog degrades to the old behaviour, never a crash."""
    m = derived_model()
    fm = FakeManager(catalog_raises=bm.ComfyUnreachable("catalog down"))
    res = run([m], fm, is_installed=lambda f, n: False)
    check(len(fm.install_posts()) == 0, "(x) nothing queued")
    check(not res.ready, "(x) still on the checklist, as before enrichment")
    check(any("a.safetensors" == e["filename"] for e in res.still_missing),
          "(x) reported by filename")


def test_y_install_body_always_names_the_model():
    """(y) `name` is always sent — do_install_model logs it before downloading."""
    fm = FakeManager()
    run([catalog_model("n.safetensors")], fm, is_installed=lambda f, n: False)
    body = fm.install_posts()[0][1]
    check(body.get("name") == "n.safetensors",
          "(y) a model with no name falls back to its filename, never omitted")


def test_z_no_catalog_read_when_nothing_needs_it():
    """(z) A fully-declared (or fully-installed) list makes no catalog call."""
    fm = FakeManager()
    run([catalog_model("d.safetensors")], fm, is_installed=lambda f, n: False)
    check(not fm.read_catalog(), "(z) an already-installable model reads nothing")
    fm2 = FakeManager()
    run([derived_model()], fm2, is_installed=lambda f, n: True)
    check(not fm2.read_catalog(), "(z) an already-installed model reads nothing")


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
        test_k_no_verdict_is_not_missing,
        test_l_no_verdict_still_queues_an_installable_model,
        test_m_phase5_no_verdict_is_an_advisory,
        test_n_survey_installs_nothing,
        test_o_provenance_reaches_the_checklist,
        test_p_a_model_with_no_field_is_asked_about_anyway,
        test_q_a_delivery_failure_is_not_a_presence_verdict,
        test_r_derived_model_is_enriched_and_queued,
        test_s_subfolder_catalog_row_is_refused,
        test_t_ambiguous_catalog_rows_adopt_nothing,
        test_u_alias_folder_is_adopted,
        test_v_unmappable_field_is_never_enriched,
        test_w_default_save_path_row_carries_type,
        test_x_unreadable_catalog_changes_nothing,
        test_y_install_body_always_names_the_model,
        test_z_no_catalog_read_when_nothing_needs_it,
    ]
    for t in tests:
        print(f"\n{t.__name__}: {t.__doc__.splitlines()[0]}")
        t()
    print(f"\n{'=' * 48}\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
