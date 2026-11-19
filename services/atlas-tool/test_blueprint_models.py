"""Offline self-test for blueprint_models.prepare_blueprint_models (B43 §4).

This guards the risky reboot / poll / cache flow that drives ComfyUI-Manager's
model-install queue, on both of Manager's route sets: v3 (``/manager/*``, and
v4's legacy UI, which is the same server under ``/v2/``) and v4 (``/v2/manager/*``
with its client-scoped task queue). The module was designed for injection: the
HTTP primitives (``http_post`` / ``http_get`` / ``http_get_text`` /
``channel_catalog``), the installed-check (``is_installed``) and the clocks
(``sleep`` / ``now``) are all parameters, so every branch runs with zero network
here.

Run:  py test_blueprint_models.py
Exits non-zero if any assertion fails; prints "N passed, 0 failed" on success.
"""
from __future__ import annotations

import sys

import blueprint_models as bm


# --------------------------------------------------------------------------
# Tiny injection harness: a scriptable ComfyUI-Manager double.
# --------------------------------------------------------------------------
_APIS = {"v3": bm.MANAGER_V3, "v4": bm.MANAGER_V4,
         "v4-legacy": bm.MANAGER_V4_LEGACY_UI}
_VERSIONS = {"v3": "V3.39.3", "v4": "V4.2.1", "v4-legacy": "V4.2.1"}
# What v4's `ModelMetadata` + `install_model` refuse a body without.
_V4_REQUIRED = ("client_id", "ui_id", "name", "type", "url", "filename")


class FakeManager:
    """Records POSTs and answers GETs the way the chosen Manager would.

    ``manager`` picks the server: "v3", "v4-legacy" (v4 with the legacy UI —
    v3's queue under /v2) or "v4" (the built-in default). ``manager_absent``
    raises ManagerAbsent (404) on every Manager route, version routes included.
    ``unreachable`` raises ComfyUnreachable on every POST.
    ``install_status`` maps a filename -> the int status install_model returns.
    ``start_status`` is what queue/start returns.
    ``status_seq`` is the list of dicts v3's queue/status yields in order
        (the last one repeats once exhausted).
    ``task_results`` (v4) maps a filename -> the worker's result string
        (default "success"); the v4 status/history routes are simulated from it.
    ``missing_routes`` 404 although the version route answers (a mismatch).
    ``reboot_status`` is what reboot returns (or raise via reboot_raises).
    ``catalog`` rows are what the target's catalogue route returns;
    ``channel`` rows are what the default channel's model-list.json holds.
    """

    def __init__(
        self,
        *,
        manager: str = "v3",
        manager_absent: bool = False,
        unreachable: bool = False,
        install_status: dict | None = None,
        default_install_status: int = 200,
        start_status: int = 200,
        status_seq: list[dict] | None = None,
        task_results: dict | None = None,
        task_status_seq: list[dict] | None = None,
        history_raises: Exception | None = None,
        missing_routes: tuple = (),
        reboot_status: int = 200,
        reboot_raises: bool = True,  # os.execv drops the connection
        system_stats_up_after: int = 0,  # /system_stats succeeds from this call on
        catalog: list | None = None,     # rows the target's catalogue route returns
        catalog_raises: Exception | None = None,
        channel: list | None = None,     # rows CHANNEL_CATALOG_URL returns
        channel_raises: Exception | None = None,
    ):
        self.api = _APIS[manager]
        self.version = _VERSIONS[manager]
        self.legacy_ui = manager == "v4-legacy"
        self.manager_absent = manager_absent
        self.unreachable = unreachable
        self.install_status = install_status or {}
        self.default_install_status = default_install_status
        self.start_status = start_status
        self.status_seq = status_seq or [
            {"total_count": 1, "done_count": 1, "in_progress_count": 0,
             "is_processing": False},
        ]
        self.task_results = task_results or {}
        self.task_status_seq = task_status_seq
        self.history_raises = history_raises
        self.missing_routes = missing_routes
        self.reboot_status = reboot_status
        self.reboot_raises = reboot_raises
        self.system_stats_up_after = system_stats_up_after
        self.catalog = catalog or []
        self.catalog_raises = catalog_raises
        self.channel = channel or []
        self.channel_raises = channel_raises

        self.posts: list[tuple[str, dict]] = []
        self.gets: list[str] = []
        self.channel_reads = 0
        self.tasks: list[dict] = []   # v4: what install_model accepted
        self._status_i = 0
        self._task_polls = 0
        self._sysstat_calls = 0

    def _route_404(self, path: str) -> bool:
        return self.manager_absent or path.split("?")[0] in self.missing_routes

    # -- POST ---------------------------------------------------------------
    def post(self, path: str, body: dict) -> tuple[int, str]:
        self.posts.append((path, body))
        if self._route_404(path):
            raise bm.ManagerAbsent(path)
        if self.unreachable:
            raise bm.ComfyUnreachable("down")
        if path == self.api.route("queue/install_model"):
            fname = body.get("filename", "")
            if self.api.task_queue:
                missing = [k for k in _V4_REQUIRED if not body.get(k)]
                if missing:
                    return 400, f"Missing required field: {missing[0]}"
            status = self.install_status.get(fname, self.default_install_status)
            if status == 200 and self.api.task_queue:
                self.tasks.append(body)
            return status, "ok"
        if path == self.api.route("queue/start"):
            return self.start_status, "ok"
        if path == self.api.route("reboot"):
            if self.reboot_raises:
                raise bm.ComfyUnreachable("connection dropped (execv)")
            return self.reboot_status, "ok"
        raise AssertionError(f"unexpected POST {path}")

    # -- GET ----------------------------------------------------------------
    def get_text(self, path: str) -> str:
        self.gets.append(path)
        if not self.manager_absent and path == self.api.route("version"):
            return self.version
        raise bm.ManagerAbsent(path)

    def get(self, path: str) -> dict:
        self.gets.append(path)
        if self._route_404(path):
            raise bm.ManagerAbsent(path)
        if path == "/v2/manager/is_legacy_manager_ui" and self.api.prefix == "/v2/manager":
            return {"is_legacy_manager_ui": self.legacy_ui}
        if self.api.catalog is not None and path == self.api.catalog:
            if self.catalog_raises:
                raise self.catalog_raises
            return {"models": self.catalog}
        if not self.api.task_queue and path == self.api.route("queue/status"):
            i = min(self._status_i, len(self.status_seq) - 1)
            self._status_i += 1
            return self.status_seq[i]
        if self.api.task_queue and path.startswith(self.api.route("queue/status?client_id=")):
            return self._task_status(path.split("=", 1)[1])
        if self.api.task_queue and path.startswith(self.api.route("queue/history?client_id=")):
            if self.history_raises:
                raise self.history_raises
            return {"history": self._history(path.split("=", 1)[1])}
        if path == "/system_stats":
            self._sysstat_calls += 1
            if self._sysstat_calls <= self.system_stats_up_after:
                raise bm.ComfyUnreachable("still rebooting")
            return {"system": {"comfyui_version": "test"}}
        raise AssertionError(f"unexpected GET {path}")

    def channel_catalog(self) -> dict:
        self.channel_reads += 1
        if self.channel_raises:
            raise self.channel_raises
        return {"models": self.channel}

    # v4's client-scoped status: `total_count` is OUR pending + running, so it
    # is n until the worker has taken and finished every task, then 0.
    def _task_status(self, client_id: str) -> dict:
        n = sum(1 for t in self.tasks if t["client_id"] == client_id)
        if self.task_status_seq is not None:
            i = min(self._task_polls, len(self.task_status_seq) - 1)
            self._task_polls += 1
            return self.task_status_seq[i]
        self._task_polls += 1
        if self._task_polls == 1:
            return {"total_count": n, "done_count": 0, "in_progress_count": 1,
                    "pending_count": n - 1, "is_processing": True}
        return {"total_count": 0, "done_count": n, "in_progress_count": 0,
                "pending_count": 0, "is_processing": False}

    def _history(self, client_id: str) -> dict:
        out = {}
        for t in self.tasks:
            if t["client_id"] != client_id:
                continue
            res = self.task_results.get(t["filename"], "success")
            out[t["ui_id"]] = {
                "ui_id": t["ui_id"], "client_id": client_id,
                "kind": "install-model", "result": res,
                "status": {"status_str": "success" if res == "success" else "error",
                           "completed": True, "messages": []},
            }
        return out

    # -- helpers ------------------------------------------------------------
    def install_posts(self) -> list[tuple[str, dict]]:
        return [p for p in self.posts if p[0] == self.api.route("queue/install_model")]

    def rebooted(self) -> bool:
        return any(p[0] == self.api.route("reboot") for p in self.posts)

    def read_catalog(self) -> bool:
        return self.channel_reads > 0 or (
            self.api.catalog is not None and self.api.catalog in self.gets)

    def started(self) -> bool:
        return any(p[0] == self.api.route("queue/start") for p in self.posts)

    def touched_v3_routes(self) -> bool:
        paths = [p[0] for p in self.posts] + self.gets
        return any(x.startswith(("/manager/", "/externalmodel/")) for x in paths)


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
    kw.setdefault("channel_catalog", fm.channel_catalog)
    try:
        return bm.prepare_blueprint_models(
            models,
            http_post=fm.post,
            http_get=fm.get,
            http_get_text=fm.get_text,
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
    done = bm._poll_queue_done(res, fm.get, bm.MANAGER_V3, 120.0, 1.0,
                              clock.sleep, clock.now)
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


# --------------------------------------------------------------------------
# ComfyUI-Manager v4 (2026-11-19). The Manager built into ComfyUI
# (`--enable-manager`) answers on /v2/manager/* only. Every v3 route 404'd
# there, which read as "Manager not installed" and stopped auto-install outright.
# --------------------------------------------------------------------------
def test_v4a_detection_picks_the_v2_routes():
    """(v4a) A v4 target is driven on /v2/manager/* and never on a v3 route."""
    fm = FakeManager(manager="v4")
    res = run([catalog_model("a.safetensors")], fm,
              is_installed=lambda f, n: fm.rebooted())
    check(fm.gets[0] == "/v2/manager/version", "(v4a) v4's version route is asked first")
    check(len(fm.install_posts()) == 1,
          "(v4a) one POST to /v2/manager/queue/install_model")
    check(fm.started(), "(v4a) /v2/manager/queue/start fired")
    check(fm.rebooted(), "(v4a) /v2/manager/reboot fired")
    check(not fm.touched_v3_routes(), "(v4a) no v3 route was called")
    check(res.ready and "a.safetensors" in res.installed, "(v4a) installed + verified")


def test_v4b_install_body_carries_the_task_fields():
    """(v4b) v4's body names the client and the task, and always has a type."""
    fm = FakeManager(manager="v4")
    run([catalog_model("a.safetensors"),
         dict(catalog_model("b.safetensors"), type="checkpoint")],
        fm, is_installed=lambda f, n: False)
    bodies = [b for _, b in fm.install_posts()]
    check(len(fm.tasks) == 2, "(v4b) both accepted — no 400 for a missing field")
    a, b = bodies if len(bodies) == 2 else ({}, {})
    check(str(a.get("client_id", "")).startswith("invisible-atlas-"), "(v4b) a client_id is sent")
    check(a.get("client_id") == b.get("client_id"), "(v4b) one client_id per prepare run")
    check(a.get("ui_id") != "a.safetensors" and str(a.get("ui_id", "")).endswith(
        "checkpoints/a.safetensors"), "(v4b) ui_id is scoped to the run, not a bare filename")
    check(a.get("ui_id") != b.get("ui_id"), "(v4b) each task has its own ui_id")
    check(a.get("type") == "checkpoints",
          "(v4b) a model with no type sends its folder (ModelMetadata requires one)")
    check(b.get("type") == "checkpoint", "(v4b) a declared type is sent as-is")
    again = FakeManager(manager="v4")
    run([catalog_model("a.safetensors")], again, is_installed=lambda f, n: False)
    check(again.tasks and again.tasks[0]["client_id"] != a.get("client_id"),
          "(v4b) the next run gets a fresh client_id")


def test_v4c_status_and_history_are_scoped_to_this_run():
    """(v4c) The poll and the result read ask about THIS run's tasks only."""
    fm = FakeManager(manager="v4")
    run([catalog_model()], fm, is_installed=lambda f, n: fm.rebooted())
    cid = fm.tasks[0]["client_id"] if fm.tasks else "?"
    check(f"/v2/manager/queue/status?client_id={cid}" in fm.gets,
          "(v4c) queue/status is filtered by our client_id")
    check(f"/v2/manager/queue/history?client_id={cid}" in fm.gets,
          "(v4c) queue/history is filtered by our client_id")
    check(fm._task_polls >= 2, "(v4c) the poll did not stop on an in-progress reading")


def test_v4d_derived_model_is_enriched_from_the_channel_and_queued():
    """(v4d) A derived model the catalog knows is queued on v4, which serves no
    catalogue route of its own — the default channel's list stands in."""
    m = derived_model()
    fm = FakeManager(manager="v4", channel=[catalog_row()])
    res = run([m], fm, is_installed=lambda f, n: fm.rebooted())
    check(fm.channel_reads == 1, "(v4d) the default channel's model-list.json was read once")
    check(not any("externalmodel" in g for g in fm.gets),
          "(v4d) no catalogue route was asked of a server that has none")
    posts = fm.install_posts()
    check(len(posts) == 1, "(v4d) the enriched model was queued on /v2")
    body = posts[0][1] if posts else {}
    check(body.get("url") == "https://cat/a.safetensors", "(v4d) catalog url in body")
    check(body.get("base") == "SDXL", "(v4d) catalog base in body")
    check(body.get("save_path") == "checkpoints", "(v4d) catalog save_path in body")
    check(body.get("type") == "checkpoint", "(v4d) the row's own type rides along")
    check(res.ready and "a.safetensors" in res.installed,
          "(v4d) the model installs and verifies")


def test_v4e_worker_refusals_come_from_the_history():
    """(v4e) v4 refuses in the WORKER: each refusal is reported with its reason,
    and a queue where nothing downloaded costs no reboot."""
    fm = FakeManager(manager="v4", task_results={
        "sec.safetensors": "failed",
        "cat.safetensors": "Invalid model install request is detected",
        "dl.safetensors": "Model installation error: https://example/model.safetensors",
    })
    res = run([catalog_model("sec.safetensors"), catalog_model("cat.safetensors"),
               catalog_model("dl.safetensors")], fm, is_installed=lambda f, n: False)
    reasons = {e["filename"]: e["reason"] for e in res.still_missing}
    check("security level" in reasons.get("sec.safetensors", ""),
          "(v4e) 'failed' is the security level, as v3's 403 was")
    check("curated catalog" in reasons.get("cat.safetensors", ""),
          "(v4e) the worker's whitelist refusal reads as v3's 400 did")
    check("Model installation error" in reasons.get("dl.safetensors", ""),
          "(v4e) any other result is passed through")
    check(not fm.rebooted(), "(v4e) nothing downloaded -> no reboot")
    check(not res.ready, "(v4e) not ready")

    mixed = FakeManager(manager="v4", task_results={"bad.safetensors": "failed"})
    res2 = run([catalog_model("good.safetensors"), catalog_model("bad.safetensors")],
               mixed, is_installed=lambda f, n: mixed.rebooted() and n == "good.safetensors")
    check(mixed.rebooted(), "(v4e) one real download is worth the reboot")
    check(res2.installed == ["good.safetensors"], "(v4e) the downloaded model verifies")
    check([e["filename"] for e in res2.still_missing] == ["bad.safetensors"],
          "(v4e) only the refused model is on the checklist")

    unknown = FakeManager(manager="v4", task_results={"p.safetensors": "failed"})
    res3 = run([dict(catalog_model("p.safetensors"), field="pulid_file")], unknown,
               is_installed=lambda f, n: None)
    check(res3.ready and len(res3.advisories) == 1 and not res3.still_missing,
          "(v4e) a refusal for a no-verdict model is an advisory, never a refusal")


def test_v4f_a_v4_400_is_a_malformed_body_not_the_catalog():
    """(v4f) On v4 a POST-time 400 is the body's shape — never "not in the catalog"."""
    fm = FakeManager(manager="v4", install_status={"a.safetensors": 400})
    res = run([catalog_model("a.safetensors")], fm, is_installed=lambda f, n: False)
    reason = res.still_missing[0]["reason"] if res.still_missing else ""
    check("V4.2.1 rejected the install request" in reason, "(v4f) the reason names v4's 400")
    check("curated catalog" not in reason, "(v4f) and does not blame the catalog")
    check(not fm.started(), "(v4f) nothing queued -> worker not started")


def test_v4g_404_names_the_mismatch_or_the_absence():
    """(v4g) A Manager that answers its version but 404s a route is a mismatch,
    not "not installed"; no version route at all is "not installed"."""
    fm = FakeManager(manager="v4", missing_routes=("/v2/manager/queue/install_model",))
    res = run([catalog_model()], fm, is_installed=lambda f, n: False)
    reason = res.still_missing[0]["reason"] if res.still_missing else ""
    check("V4.2.1 is installed" in reason and "route mismatch" in reason,
          "(v4g) the reason names the version and the mismatch")
    check("not installed —" not in reason, "(v4g) it does not say Manager is missing")
    check(any("route mismatch" in n for n in res.notes), "(v4g) the log names it too")

    gone = FakeManager(manager="v4", manager_absent=True)
    res2 = run([catalog_model()], gone, is_installed=lambda f, n: False)
    check(res2.still_missing and "ComfyUI-Manager not installed" in
          res2.still_missing[0]["reason"], "(v4g) no version route -> not installed")
    check(not gone.posts, "(v4g) no Manager -> no POST at all")
    check(any("--enable-manager" in n for n in res2.notes),
          "(v4g) the log names the flag the built-in Manager needs")

    late = FakeManager(manager="v4", missing_routes=("/v2/manager/reboot",))
    run([catalog_model()], late, is_installed=lambda f, n: False)
    check(late.rebooted(), "(v4g) a reboot 404 is still attempted once")


def test_v4h_legacy_ui_is_v3_under_v2():
    """(v4h) v4 with --enable-manager-legacy-ui: /v2 routes and its own /v2
    catalogue, but v3's body, batch status and POST-time whitelist."""
    fm = FakeManager(manager="v4-legacy", catalog=[catalog_row()])
    res = run([derived_model()], fm, is_installed=lambda f, n: fm.rebooted())
    check("/v2/externalmodel/getlist?mode=cache" in fm.gets,
          "(v4h) the target's own /v2 catalogue was read")
    check(fm.channel_reads == 0, "(v4h) the channel is not read when the target has one")
    body = fm.install_posts()[0][1] if fm.install_posts() else {}
    check(body.get("ui_id") == "a.safetensors" and "client_id" not in body,
          "(v4h) v3's install body")
    check(not any("client_id=" in g for g in fm.gets), "(v4h) v3's unfiltered batch status")
    check(not fm.touched_v3_routes(), "(v4h) no /manager/* route was called")
    check(res.ready and "a.safetensors" in res.installed, "(v4h) installed + verified")

    fm2 = FakeManager(manager="v4-legacy", install_status={"x.safetensors": 400})
    res2 = run([catalog_model("x.safetensors")], fm2, is_installed=lambda f, n: False)
    check(res2.still_missing and "curated catalog" in res2.still_missing[0]["reason"],
          "(v4h) a legacy-UI 400 is the whitelist, as on v3")


def test_v4i_no_readable_channel_changes_nothing():
    """(v4i) Without a readable channel catalogue a derived model stays on the
    checklist on v4 — never a crash."""
    cases = (
        ("no channel primitive", FakeManager(manager="v4", channel=[catalog_row()]),
         {"channel_catalog": None}),
        ("channel unreachable", FakeManager(manager="v4", channel_raises=OSError("offline")),
         {}),
        ("channel not a catalogue", FakeManager(manager="v4"),
         {"channel_catalog": lambda: ["not", "a", "catalogue"]}),
    )
    for label, fm, kw in cases:
        res = run([derived_model()], fm, is_installed=lambda f, n: False, **kw)
        check(not fm.install_posts(), f"(v4i) {label}: nothing queued")
        check(not res.ready and res.still_missing[0]["filename"] == "a.safetensors",
              f"(v4i) {label}: on the checklist, as before enrichment")


def test_v4j_unreadable_history_falls_back_to_the_recheck():
    """(v4j) A history that cannot be read costs one reboot, never a model."""
    fm = FakeManager(manager="v4", history_raises=bm.ComfyUnreachable("blip"))
    res = run([catalog_model()], fm, is_installed=lambda f, n: fm.rebooted())
    check(fm.rebooted(), "(v4j) rebooted, as v3 always does")
    check(res.ready and "model.safetensors" in res.installed,
          "(v4j) the /object_info recheck decides")


def test_v4k_poll_waits_for_our_tasks_and_times_out():
    """(v4k) v4's poll does not resolve while our tasks remain, and gives up at
    the timeout rather than rebooting into a half-done download."""
    stalled = FakeManager(manager="v4", task_status_seq=[
        {"total_count": 1, "done_count": 0, "in_progress_count": 1,
         "pending_count": 0, "is_processing": True}])
    res = run([catalog_model()], stalled, is_installed=lambda f, n: False,
              status_timeout=10.0)
    check(stalled._task_polls > 1, "(v4k) polled more than once")
    check(not stalled.rebooted(), "(v4k) no reboot into an unfinished download")
    check(any("did not finish in time" in e["reason"] for e in res.still_missing),
          "(v4k) timeout reported")


def test_v4l_unreachable_during_detection():
    """(v4l) ComfyUI dropping while asked its Manager version is "unreachable",
    never "not installed"."""
    fm = FakeManager(manager="v4")

    def down(path: str) -> str:
        raise bm.ComfyUnreachable("tunnel down")

    fm.get_text = down
    res = run([catalog_model()], fm, is_installed=lambda f, n: False)
    check(res.still_missing and res.still_missing[0]["reason"] ==
          "ComfyUI unreachable (install not queued)", "(v4l) reported as unreachable")
    check(not fm.posts, "(v4l) nothing POSTed")


def test_v4m_detect_manager():
    """(v4m) detect_manager asks v4 first, then v3; None when neither answers."""
    v4 = FakeManager(manager="v4")
    api = bm.detect_manager(http_get_text=v4.get_text, http_get=v4.get)
    check(api is not None and api.prefix == "/v2/manager" and api.task_queue
          and api.catalog is None and api.version == "V4.2.1", "(v4m) v4")
    v3 = FakeManager()
    api3 = bm.detect_manager(http_get_text=v3.get_text, http_get=v3.get)
    check(api3 is not None and api3.prefix == "/manager" and not api3.task_queue
          and api3.version == "V3.39.3", "(v4m) v3")
    check(v3.gets[:2] == ["/v2/manager/version", "/manager/version"],
          "(v4m) v4's route is asked before v3's")
    legacy = FakeManager(manager="v4-legacy")
    api_l = bm.detect_manager(http_get_text=legacy.get_text, http_get=legacy.get)
    check(api_l is not None and api_l.catalog == "/v2/externalmodel/getlist?mode=cache"
          and not api_l.task_queue, "(v4m) v4 with the legacy UI")
    gone = FakeManager(manager_absent=True)
    check(bm.detect_manager(http_get_text=gone.get_text, http_get=gone.get) is None,
          "(v4m) no version route -> None")
    check(bm.detect_manager(http_get_text=lambda p: "<!doctype html><html>",
                            http_get=gone.get) is None,
          "(v4m) a page served in a version route's place is not a Manager")


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
        test_v4a_detection_picks_the_v2_routes,
        test_v4b_install_body_carries_the_task_fields,
        test_v4c_status_and_history_are_scoped_to_this_run,
        test_v4d_derived_model_is_enriched_from_the_channel_and_queued,
        test_v4e_worker_refusals_come_from_the_history,
        test_v4f_a_v4_400_is_a_malformed_body_not_the_catalog,
        test_v4g_404_names_the_mismatch_or_the_absence,
        test_v4h_legacy_ui_is_v3_under_v2,
        test_v4i_no_readable_channel_changes_nothing,
        test_v4j_unreadable_history_falls_back_to_the_recheck,
        test_v4k_poll_waits_for_our_tasks_and_times_out,
        test_v4l_unreachable_during_detection,
        test_v4m_detect_manager,
    ]
    for t in tests:
        print(f"\n{t.__name__}: {t.__doc__.splitlines()[0]}")
        t()
    print(f"\n{'=' * 48}\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
