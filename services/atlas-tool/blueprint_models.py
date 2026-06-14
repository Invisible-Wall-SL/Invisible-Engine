"""Blueprint model auto-download via the ComfyUI-Manager queue API (B43 phase 4).

Given a blueprint's ``models[]``, this "prepare" step makes the LOCAL ComfyUI
have every model the graph needs BEFORE the workflow is submitted — by driving
ComfyUI-Manager's model-install queue over the SAME tunnel + CF Access headers +
``InvisibleAtlas`` User-Agent as every other ComfyUI call.

Confirmed Manager contract (spike against the installed source — handlers in
``glob/manager_server.py``: ``queue/status``, ``queue/start``,
``queue/install_model``, ``reboot``, plus the whitelist check):

  * ``POST /manager/queue/install_model`` — JSON body IS the model dict. Returns
    **400 "Invalid model install request is detected"** UNLESS the model matches
    Manager's curated ``model-list.json`` by *(``save_path``, ``base``,
    ``filename``)* — the catalog-only (whitelist) constraint. Custom-URL models
    that aren't in the catalog can NOT be auto-installed → manual checklist.
    Returns **403** if Manager's security level is above "middle". **200** =
    QUEUED (not yet downloaded). Content-Type MUST be ``application/json``.
  * ``POST /manager/queue/start`` — starts the worker thread. 200, or **201 if a
    run is already in progress**. Rejects simple-form content-types → send
    ``application/json`` (body ``{}``).
  * ``GET /manager/queue/status`` → ``{total_count, done_count,
    in_progress_count, is_processing}``. Poll until ``is_processing`` is false
    AND ``in_progress_count == 0``.
  * ``POST /manager/reboot`` — restarts ComfyUI via ``os.execv`` → the HTTP
    connection DROPS / times out; treat a dropped/empty response as expected
    success, then poll ``/system_stats`` until ComfyUI is back. Rejects
    simple-form content-types; requires security level "middle".

Fail-safe everywhere: a missing Manager (404 on ``/manager/*``), an unreachable
ComfyUI, a per-model 400/403, or any transport error degrades to a readable
manual checklist — this step NEVER raises an unhandled exception. The decision
to FAIL the generation (because a required model is still missing) is left to
the caller, which already knows how to print the checklist (mirroring
``preflight_models``).

The two HTTP primitives and the installed-check are INJECTED (``http_post`` /
``http_get`` / ``is_installed``) so the offline self-test can stub them with no
network. In ``batch_atlas`` they're bound to the stdlib twins there.
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

# Catalog match keys (the whitelist tuple) + the download URL. A model missing
# ANY of these can't satisfy `check_whitelist_for_model` → not auto-installable.
CATALOG_KEYS = ("url", "save_path", "base", "filename")


@dataclass
class PrepareResult:
    """Structured outcome of the prepare step.

    ``ready`` is True only when nothing the blueprint declared is still missing.
    ``still_missing`` entries are dicts carrying enough to print a manual
    checklist: ``filename``, ``save_path``, ``base``, ``url``, ``reason``.
    """

    ready: bool = True
    installed: list = field(default_factory=list)       # filenames newly queued+resolved
    still_missing: list = field(default_factory=list)   # [{filename, save_path, base, url, reason}]
    notes: list = field(default_factory=list)           # human log lines (also printed)


# Signatures of the injected primitives:
#   http_post(path, body_obj) -> (status_int, text)        ; raises HTTPNotFound on 404
#   http_get(path) -> dict (parsed JSON)                   ; raises on transport error
#   is_installed(field, filename) -> bool                  ; /object_info enum check
HttpPost = Callable[[str, dict], "tuple[int, str]"]
HttpGet = Callable[[str], dict]
IsInstalled = Callable[[str, str], bool]


class ManagerAbsent(Exception):
    """Raised by an injected ``http_post``/``http_get`` when a ``/manager/*``
    route returns 404 — i.e. ComfyUI-Manager isn't installed. The prepare step
    catches it and degrades to the manual checklist."""


class ComfyUnreachable(Exception):
    """Raised by an injected primitive when ComfyUI can't be reached at all."""


def _log(result: PrepareResult, msg: str) -> None:
    print(msg, flush=True)
    result.notes.append(msg)


def _is_installable(model: dict) -> bool:
    """A model can be auto-installed only if it carries every catalog match key
    (``save_path``/``base``/``filename``) plus a download ``url``."""
    return all(str(model.get(k, "")).strip() for k in CATALOG_KEYS)


def _checklist_entry(model: dict, reason: str) -> dict:
    return {
        "filename": model.get("filename") or "(unnamed)",
        "save_path": model.get("save_path") or model.get("dir") or "",
        "base": model.get("base") or "",
        "url": model.get("url") or model.get("source") or "",
        "reason": reason,
    }


def _install_body(model: dict) -> dict:
    """The Manager install_model body: the catalog match keys + url, plus an
    optional ``ui_id`` (Manager echoes it in progress events; harmless)."""
    body = {
        "url": str(model["url"]).strip(),
        "filename": str(model["filename"]).strip(),
        "save_path": str(model["save_path"]).strip(),
        "base": str(model["base"]).strip(),
    }
    # Optional metadata Manager tolerates; keep it minimal + correct.
    if model.get("name"):
        body["name"] = str(model["name"])
    if model.get("type"):
        body["type"] = str(model["type"])
    body["ui_id"] = body["filename"]
    return body


def auto_install_enabled() -> bool:
    """Kill-switch (default ENABLED). When ``BLUEPRINT_AUTO_INSTALL_MODELS`` is
    explicitly falsy, the prepare step does NOT install/reboot — it only emits
    the checklist of missing models (the safer no-reboot behaviour, since a
    reboot interrupts in-flight ComfyUI work)."""
    v = (os.environ.get("BLUEPRINT_AUTO_INSTALL_MODELS") or "").strip().lower()
    return v not in ("0", "false", "no", "off")


def prepare_blueprint_models(
    models: list,
    *,
    http_post: HttpPost,
    http_get: HttpGet,
    is_installed: IsInstalled,
    status_timeout: float = 3600.0,
    reboot_timeout: float = 300.0,
    poll_interval: float = 3.0,
    sleep: Callable[[float], None] = time.sleep,
    now: Callable[[], float] = time.monotonic,
    on_rebooted: Optional[Callable[[], None]] = None,
) -> PrepareResult:
    """Make ComfyUI have every model in ``models``; return a structured result.

    Never raises: every failure mode (Manager absent, ComfyUI down, per-model
    400/403, transport error) is captured into ``still_missing`` with a readable
    ``reason``. The caller decides whether a non-empty ``still_missing`` should
    FAIL the generation.

    ``on_rebooted`` (optional) is invoked exactly once, right after ComfyUI is
    confirmed back online and BEFORE the step-5 install recheck — but ONLY when a
    reboot actually happened. The caller uses it to invalidate any time-cached
    install/alive state so the recheck reads the freshly-restarted server, not a
    stale pre-reboot verdict. It is NOT called on any no-reboot path (kill-switch
    off, nothing queued, Manager absent, ComfyUI unreachable).
    """
    result = PrepareResult()
    if not models:
        return result  # ready, nothing to do

    # 1. Skip already-installed models (the /object_info enum check). Partition
    #    the MISSING into installable (full catalog keys) vs not (-> checklist).
    to_queue: list[dict] = []
    for m in models:
        fld = str(m.get("field", "")).strip()
        fname = str(m.get("filename", "")).strip()
        try:
            present = bool(fld and fname and is_installed(fld, fname))
        except ComfyUnreachable:
            _log(result, "[prepare] ComfyUI unreachable — cannot check or install "
                         "models; listing them all as a manual checklist.")
            result.ready = False
            for mm in models:
                result.still_missing.append(
                    _checklist_entry(mm, "ComfyUI unreachable (could not verify)"))
            return result
        except Exception as e:  # noqa: BLE001 — a flaky enum read shouldn't crash prepare
            _log(result, f"[prepare] install-check error for '{fname}': {e} "
                         "(treating as missing)")
            present = False
        if present:
            _log(result, f"[prepare] already installed: {fname}")
            continue
        if _is_installable(m):
            to_queue.append(m)
        else:
            _log(result, f"[prepare] '{fname or '(unnamed)'}' is missing and not "
                         "in a catalog-installable shape (needs url+save_path+base+"
                         "filename) — manual install required.")
            result.ready = False
            result.still_missing.append(
                _checklist_entry(m, "not in ComfyUI-Manager catalog shape "
                                    "(missing url/save_path/base) — install manually"))

    if not to_queue:
        return result  # everything either installed or already on the checklist

    # Kill-switch: when disabled, do NOT install/reboot. Emit the missing
    # installable models as a checklist too (safer no-reboot behaviour).
    if not auto_install_enabled():
        _log(result, "[prepare] BLUEPRINT_AUTO_INSTALL_MODELS is disabled — "
                     "skipping auto-install/reboot; listing missing models.")
        result.ready = False
        for m in to_queue:
            result.still_missing.append(
                _checklist_entry(m, "auto-install disabled "
                                    "(BLUEPRINT_AUTO_INSTALL_MODELS=off)"))
        return result

    # 2. Queue each installable-missing model. Per-model 400/403 -> checklist
    #    (do NOT abort the others). 404 on /manager/* -> Manager absent.
    queued: list[dict] = []
    for m in to_queue:
        body = _install_body(m)
        try:
            # This POST only QUEUES the install (returns fast); the actual
            # multi-GB download is awaited later via _poll_queue_done, NOT by
            # this request's timeout.
            status, text = http_post("/manager/queue/install_model", body)
        except ManagerAbsent:
            _log(result, "[prepare] ComfyUI-Manager not installed "
                         "(/manager/queue/install_model -> 404).")
            result.ready = False
            for mm in to_queue:
                result.still_missing.append(
                    _checklist_entry(mm, "ComfyUI-Manager not installed — "
                                        "install this model manually"))
            return result
        except ComfyUnreachable:
            _log(result, "[prepare] ComfyUI unreachable while queueing installs.")
            result.ready = False
            for mm in to_queue:
                result.still_missing.append(
                    _checklist_entry(mm, "ComfyUI unreachable (install not queued)"))
            return result
        except Exception as e:  # noqa: BLE001
            _log(result, f"[prepare] queue error for '{body['filename']}': {e}")
            result.ready = False
            result.still_missing.append(
                _checklist_entry(m, f"install request failed: {e}"))
            continue
        if status == 200:
            _log(result, f"[prepare] queued for download: {body['filename']}")
            queued.append(m)
        elif status == 400:
            _log(result, f"[prepare] '{body['filename']}' not in ComfyUI-Manager's "
                         "curated model catalog (400) — can't auto-install.")
            result.ready = False
            result.still_missing.append(
                _checklist_entry(m, "not in ComfyUI-Manager's curated catalog "
                                    "(only catalog models auto-install) — install "
                                    "manually"))
        elif status == 403:
            _log(result, f"[prepare] '{body['filename']}' rejected (403): ComfyUI-"
                         "Manager security level is above 'middle'.")
            result.ready = False
            result.still_missing.append(
                _checklist_entry(m, "ComfyUI-Manager security level blocks auto-"
                                    "install (set it to 'middle' or below) — install "
                                    "manually"))
        else:
            _log(result, f"[prepare] '{body['filename']}' install_model returned "
                         f"HTTP {status}: {text[:200]}")
            result.ready = False
            result.still_missing.append(
                _checklist_entry(m, f"install_model returned HTTP {status}"))

    if not queued:
        return result  # nothing got queued; checklist already populated

    # 3. Start the worker; poll status until idle.
    try:
        start_status, _ = http_post("/manager/queue/start", {})
    except ManagerAbsent:
        _log(result, "[prepare] ComfyUI-Manager not installed (/manager/queue/start "
                     "-> 404).")
        result.ready = False
        for m in queued:
            result.still_missing.append(
                _checklist_entry(m, "ComfyUI-Manager not installed — install manually"))
        return result
    except Exception as e:  # noqa: BLE001
        _log(result, f"[prepare] queue/start failed: {e}")
        result.ready = False
        for m in queued:
            result.still_missing.append(
                _checklist_entry(m, f"could not start the install worker: {e}"))
        return result
    # 200 normal, 201 = already in progress; both mean "worker running".
    _log(result, f"[prepare] install worker started (HTTP {start_status}); "
                 "downloading… (this can take a while for multi-GB checkpoints)")

    if not _poll_queue_done(result, http_get, status_timeout, poll_interval, sleep, now):
        # Timed out / errored: don't reboot into an unknown state — checklist.
        result.ready = False
        for m in queued:
            result.still_missing.append(
                _checklist_entry(m, "download did not finish in time — re-run prepare "
                                    "or install manually"))
        return result

    # 4. Reboot ONCE (batched) so ComfyUI rescans models/, then wait for it back.
    _reboot(result, http_post)
    if not _wait_comfy_back(result, http_get, reboot_timeout, poll_interval, sleep, now):
        result.ready = False
        for m in queued:
            result.still_missing.append(
                _checklist_entry(m, "ComfyUI did not come back after reboot — restart "
                                    "it manually, then re-run"))
        return result

    # A reboot DID happen and ComfyUI is back: drop any pre-reboot cached
    # install/alive verdicts so the step-5 recheck reads the live server (a
    # stale "missing"/"down" cache here would falsely fail the run).
    if on_rebooted is not None:
        try:
            on_rebooted()
        except Exception:  # noqa: BLE001 — a cache-bust hook must never fail prepare
            pass

    # 5. Re-check /object_info; anything still missing -> checklist.
    for m in queued:
        fld = str(m.get("field", "")).strip()
        fname = str(m.get("filename", "")).strip()
        try:
            present = bool(fld and fname and is_installed(fld, fname))
        except Exception:  # noqa: BLE001
            present = False
        if present:
            _log(result, f"[prepare] installed + verified: {fname}")
            result.installed.append(fname)
        else:
            _log(result, f"[prepare] '{fname}' still not visible after install + "
                         "reboot.")
            result.ready = False
            result.still_missing.append(
                _checklist_entry(m, "downloaded but not visible in ComfyUI after "
                                    "reboot — check the target folder / filename"))
    return result


# Right after POST /manager/queue/start returns 200, the worker thread may not
# have flipped `is_processing` true yet (and total_count can still read 0) — so
# the FIRST status poll can transiently look idle with nothing downloaded. If we
# trusted that, we'd reboot prematurely and then report the model "still
# missing". So an idle reading is only trusted once we have positive evidence
# the queue really ran: either we observed `is_processing` go true at least once,
# OR the queue advertised real work (`total_count > 0` and everything done), OR a
# short startup grace elapsed (the worker may finish a tiny/cached download
# before our first poll). `_STARTUP_GRACE` bounds how long an all-zero reading is
# distrusted; the overall `timeout` still caps the whole poll.
_STARTUP_GRACE = 8.0


def _poll_queue_done(
    result: PrepareResult,
    http_get: HttpGet,
    timeout: float,
    interval: float,
    sleep: Callable[[float], None],
    now: Callable[[], float],
) -> bool:
    """Poll /manager/queue/status until the queue is genuinely done. Returns True
    when done, False on timeout / repeated transport failure.

    Done = the queue actually ran (`total_count > 0` and `done_count >=
    total_count`) and the worker is idle (`not is_processing and
    in_progress_count == 0`). A bare idle reading (e.g. `total_count == 0`
    straight after start) is NOT trusted until we've either seen processing begin
    or the startup grace has elapsed — this defeats the worker-start race."""
    start = now()
    deadline = start + timeout
    last_done = -1
    fails = 0
    saw_processing = False
    while now() < deadline:
        try:
            st = http_get("/manager/queue/status")
            fails = 0
        except ManagerAbsent:
            _log(result, "[prepare] /manager/queue/status -> 404 (Manager vanished?).")
            return False
        except Exception as e:  # noqa: BLE001 — transient; retry a few times
            fails += 1
            if fails >= 5:
                _log(result, f"[prepare] queue/status unreadable ({e}); giving up "
                             "the poll.")
                return False
            sleep(interval)
            continue
        in_prog = int(st.get("in_progress_count", 0) or 0)
        done = int(st.get("done_count", 0) or 0)
        total = int(st.get("total_count", 0) or 0)
        processing = bool(st.get("is_processing", False))
        if processing or in_prog > 0:
            saw_processing = True
        if done != last_done:
            _log(result, f"[prepare] download progress: {done}/{total} done, "
                         f"{in_prog} in progress")
            last_done = done
        idle = (not processing) and in_prog == 0
        if idle:
            # Trust an idle reading only with positive evidence the queue ran:
            # real completed work, OR we already saw it processing, OR the
            # startup grace expired (covers a download that finished before our
            # first poll). Never resolve on an all-zero pre-start reading.
            completed = total > 0 and done >= total
            grace_over = (now() - start) >= _STARTUP_GRACE
            if completed or saw_processing or grace_over:
                return True
        sleep(interval)
    _log(result, "[prepare] timed out waiting for downloads to finish.")
    return False


def _reboot(result: PrepareResult, http_post: HttpPost) -> None:
    """POST /manager/reboot. ComfyUI restarts via os.execv, so the connection
    DROPS — a transport error / empty response here is EXPECTED success, not a
    failure. A 403 (security level) is the only genuine 'reboot refused'."""
    try:
        status, _ = http_post("/manager/reboot", {})
        if status == 403:
            _log(result, "[prepare] reboot refused (403) — ComfyUI-Manager security "
                         "level blocks reboot. Restart ComfyUI manually to load the "
                         "new models.")
        else:
            _log(result, f"[prepare] reboot acknowledged (HTTP {status}).")
    except ManagerAbsent:
        _log(result, "[prepare] /manager/reboot -> 404; restart ComfyUI manually.")
    except Exception:  # noqa: BLE001 — DROPPED connection is the normal os.execv case
        _log(result, "[prepare] reboot issued; connection dropped as expected "
                     "(ComfyUI restarting).")


def _wait_comfy_back(
    result: PrepareResult,
    http_get: HttpGet,
    timeout: float,
    interval: float,
    sleep: Callable[[float], None],
    now: Callable[[], float],
) -> bool:
    """Poll /system_stats until ComfyUI answers again after the reboot."""
    deadline = now() + timeout
    while now() < deadline:
        try:
            http_get("/system_stats")
            _log(result, "[prepare] ComfyUI is back online.")
            return True
        except Exception:  # noqa: BLE001 — still restarting; keep waiting
            sleep(interval)
    _log(result, "[prepare] ComfyUI did not come back within the reboot timeout.")
    return False


def format_checklist(result: PrepareResult) -> str:
    """Readable multi-line checklist of the still-missing models, in the same
    spirit as ``preflight_models``' error block. Empty string when ready."""
    if not result.still_missing:
        return ""
    lines = ["The following model(s) could not be auto-installed and must be "
             "added to your local ComfyUI manually:"]
    for m in result.still_missing:
        dest = m.get("save_path") or "(unknown folder)"
        url = m.get("url") or "(no source URL)"
        lines.append(f"  - {m.get('filename')}  ->  models/{dest}/")
        lines.append(f"      source: {url}")
        lines.append(f"      reason: {m.get('reason')}")
    lines.append("  Put each file in the named ComfyUI models/<folder>, then "
                 "restart ComfyUI (it only scans at startup) and retry.")
    return "\n".join(lines)
