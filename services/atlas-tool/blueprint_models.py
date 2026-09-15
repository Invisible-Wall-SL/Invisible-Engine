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
  * ``GET /externalmodel/getlist?mode=cache`` — the curated catalog itself, which
    is what makes ``enrich_from_catalog`` possible: the whitelist grants
    permission for a *(save_path, base, filename)* NAME, and ``do_install_model``
    then downloads the ``url`` off the REQUEST body, so a catalog row is a
    permission slip rather than the source of the bytes.

A second spike (2026-09-09, Manager ``3.39.3-178``) settled the question that
keeps coming back: **no security level opens the whitelist.** The level gate and
``check_whitelist_for_model`` are independent checks and the latter has no
security branch at all, so ``weak`` clears the 403 and still eats the 400. Nor is
Manager a way to pull our own R2 mirror: ``download_url_with_agent`` reads the
whole response into memory and only ``github.com`` / ``huggingface.co`` /
``heibox`` URLs take the streaming path, so a multi-GB presigned URL is an OOM.
See ``docs/design/invisible-blueprints.md`` §4.

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
# `save_path` is read through `_install_save_path`, not off the model directly.
CATALOG_KEYS = ("url", "save_path", "base", "filename")

# Manager's route for its curated catalog — the same JSON `check_whitelist_for_model`
# consults, so a row matched here is a row that gate accepts. `mode=cache` is the
# channel copy (refreshed daily, and the FIRST thing the whitelist reads); the
# on-disk `local` copy is its fallback and a strict subset in practice.
CATALOG_PATH = "/externalmodel/getlist?mode=cache"

# ComfyUI scans MORE THAN ONE physical `models/` dir for some loader keys, so a
# file installed into either name of a pair is reachable from a graph naming the
# other. Straight off ComfyUI's `folder_paths.folder_names_and_paths` + its
# `map_legacy`. A pair NOT listed here is a genuinely different folder, and
# adopting a catalog row across one would send gigabytes at a loader that never
# reads them — the same "a wrong folder is worse than no folder" rule
# `blueprints.MODEL_FIELD_DIRS` is written to.
_FOLDER_EQUIVALENTS = (
    frozenset({"unet", "diffusion_models"}),
    frozenset({"clip", "text_encoders"}),
    frozenset({"controlnet", "t2i_adapter"}),
)

# Manager's own `model_dir_name_map` (manager_server.py): how a catalog row with
# `save_path: "default"` resolves — through its `type` — to a folder.
_CATALOG_TYPE_DIRS = {
    "checkpoints": "checkpoints", "checkpoint": "checkpoints",
    "unclip": "checkpoints", "text_encoders": "text_encoders",
    "clip": "text_encoders", "vae": "vae", "lora": "loras",
    "t2i-adapter": "controlnet", "t2i-style": "controlnet",
    "controlnet": "controlnet", "clip_vision": "clip_vision",
    "gligen": "gligen", "upscale": "upscale_models",
    "embedding": "embeddings", "embeddings": "embeddings",
    "unet": "diffusion_models", "diffusion_model": "diffusion_models",
}


@dataclass
class PrepareResult:
    """Structured outcome of the prepare step.

    ``ready`` is True only when nothing the blueprint declared is still missing.
    ``still_missing`` entries are dicts carrying enough to print a manual
    checklist: ``filename``, ``save_path``, ``base``, ``url``, ``reason``.

    The two lists are NOT interchangeable, and the difference is the whole
    contract: ``still_missing`` is REFUSAL-GRADE — the target's own inventory
    said the file is not there, and the caller kills the run over it.
    ``advisories`` never is. It carries the "could not be verified" rows (an
    unmappable field, a target with no live inventory to ask), which are printed
    so a human can act but must never set ``ready`` False — "we could not check"
    laundered into "it is missing" blocks renders that would have worked.
    """

    ready: bool = True
    installed: list = field(default_factory=list)       # filenames newly queued+resolved
    still_missing: list = field(default_factory=list)   # [{filename, save_path, base, url, reason}]
    advisories: list = field(default_factory=list)      # same shape; NEVER refusal-grade
    notes: list = field(default_factory=list)           # human log lines (also printed)


# Signatures of the injected primitives:
#   http_post(path, body_obj) -> (status_int, text)        ; raises HTTPNotFound on 404
#   http_get(path) -> dict (parsed JSON)                   ; raises on transport error
#   is_installed(field, filename) -> bool | None           ; /object_info enum check,
#       None = NO VERDICT (unmapped field, unreadable enum) — never "missing"
HttpPost = Callable[[str, dict], "tuple[int, str]"]
HttpGet = Callable[[str], dict]
IsInstalled = Callable[[str, str], "bool | None"]


class ManagerAbsent(Exception):
    """Raised by an injected ``http_post``/``http_get`` when a ``/manager/*``
    route returns 404 — i.e. ComfyUI-Manager isn't installed. The prepare step
    catches it and degrades to the manual checklist."""


class ComfyUnreachable(Exception):
    """Raised by an injected primitive when ComfyUI can't be reached at all."""


def _log(result: PrepareResult, msg: str) -> None:
    print(msg, flush=True)
    result.notes.append(msg)


def _install_save_path(model: dict) -> str:
    """The ``save_path`` an install POST must carry.

    Manager's OWN spelling for the catalog row we adopted (``catalog_save_path``)
    when there is one, else our derived folder. The two differ whenever the row
    says ``default`` or uses one of ComfyUI's alias dirs, and they must stay
    apart: ``check_whitelist_for_model`` compares Manager's spelling, while
    ``model_mirror.resolve`` builds ``comfyui-models/<save_path>/<filename>`` out
    of OURS and documents that it "deliberately carries the legacy
    ``unet``/``clip`` aliases". Collapsing them would break the mirror lookup for
    exactly the models enrichment just made installable."""
    return (str(model.get("catalog_save_path", "")).strip()
            or str(model.get("save_path", "")).strip())


def _is_installable(model: dict) -> bool:
    """A model can be auto-installed only if it carries every catalog match key
    (``save_path``/``base``/``filename``) plus a download ``url`` — with
    ``save_path`` read through ``_install_save_path``, so a catalog row adopted
    by ``enrich_from_catalog`` counts."""
    if not _install_save_path(model):
        return False
    return all(str(model.get(k, "")).strip()
               for k in ("url", "base", "filename"))


def _same_folder(a: str, b: str) -> bool:
    """Do these two ``models/`` dir names denote the same folder to ComfyUI?"""
    a, b = a.strip().lower(), b.strip().lower()
    if not a or not b:
        return False
    if a == b:
        return True
    return any(a in klass and b in klass for klass in _FOLDER_EQUIVALENTS)


def _catalog_dir(row: dict) -> str:
    """The folder a catalog row installs into, or "" when it can't be known.

    Mirrors Manager's ``get_model_dir``: an explicit ``save_path`` wins, and the
    literal ``default`` is resolved through the row's ``type``."""
    save_path = str(row.get("save_path") or "").strip()
    if save_path and save_path != "default":
        return save_path
    return _CATALOG_TYPE_DIRS.get(str(row.get("type") or "").strip().lower(), "")


def _adoptable_row(model: dict, rows: list) -> Optional[dict]:
    """The ONE catalog row it is safe to adopt for ``model``, or None.

    Three refusals, all of them about where the bytes land:

    * a row whose install dir carries a SUBFOLDER is rejected even on the right
      branch — ``controlnet/SDXL`` writes ``models/controlnet/SDXL/x.safetensors``,
      which ComfyUI enumerates as ``SDXL/x.safetensors``, so the graph's bare
      ``x.safetensors`` still would not resolve and we would have paid for the
      download to move the failure later;
    * a row on a folder that is not ours (nor an alias of it) is rejected;
    * candidates that disagree on ``(save_path, base, url)`` adopt NOTHING — 20
      catalog rows are named ``diffusion_pytorch_model.safetensors``, and
      choosing between them is the coin flip ``model_mirror.resolve`` also
      refuses to make.

    A model whose own ``save_path`` is empty is never enriched: the field was
    unmappable, so there is nothing to check a candidate against, and guessing
    the folder is the one outcome worse than leaving it on the checklist."""
    want = str(model.get("save_path") or "").strip()
    if not want:
        return None
    keep = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if not all(str(row.get(k, "")).strip() for k in ("url", "base", "filename")):
            continue
        where = _catalog_dir(row)
        if not where or "/" in where or "\\" in where:
            continue
        if not _same_folder(where, want):
            continue
        keep.append(row)
    if not keep:
        return None
    identity = {(str(r.get("save_path") or "").strip(),
                 str(r["base"]).strip(), str(r["url"]).strip()) for r in keep}
    return keep[0] if len(identity) == 1 else None


def enrich_from_catalog(
    models: list,
    *,
    http_get: HttpGet,
    result: Optional[PrepareResult] = None,
) -> int:
    """Fill in ``url``/``base`` from the TARGET's ComfyUI-Manager catalog.

    The reason auto-install existed without ever running: a blueprint's
    ``models[]`` is derived from its own graph, and
    ``blueprints.derive_models_from_graph`` returns ``{field, filename,
    save_path}`` — a graph names a model, it does not carry a download URL or a
    catalog ``base``. So ``_is_installable`` was false at the first gate for every
    derived model and Manager was never contacted at all.

    Reading the catalog HERE rather than at import time is deliberate: the
    catalog belongs to the target, a blueprint is shared across targets, and a
    URL frozen into a manifest goes stale where a live read cannot.

    Returns how many models were enriched. Never raises: an absent Manager, an
    unreachable ComfyUI or a malformed payload leaves every model exactly as it
    was, which is the pre-existing behaviour."""
    result = result if result is not None else PrepareResult()
    targets = [m for m in models
               if isinstance(m, dict) and str(m.get("filename", "")).strip()
               and not _is_installable(m)]
    if not targets:
        return 0
    try:
        payload = http_get(CATALOG_PATH)
    except ManagerAbsent:
        _log(result, "[prepare] no ComfyUI-Manager catalog to enrich from "
                     "(/externalmodel/getlist -> 404).")
        return 0
    except Exception as e:  # noqa: BLE001 — enrichment is a bonus, never a gate
        _log(result, f"[prepare] could not read the model catalog: {e} — "
                     "declared models keep whatever they already carry.")
        return 0
    by_name: dict[str, list] = {}
    for row in (payload or {}).get("models") or []:
        if isinstance(row, dict):
            # Exact, case-sensitive — the whitelist compares filenames that way.
            name = str(row.get("filename") or "").strip()
            if name:
                by_name.setdefault(name, []).append(row)
    if not by_name:
        return 0
    filled = 0
    for m in targets:
        row = _adoptable_row(m, by_name.get(str(m["filename"]).strip(), []))
        if row is None:
            continue
        m["url"] = str(row["url"]).strip()
        m["base"] = str(row["base"]).strip()
        m["catalog_save_path"] = str(row.get("save_path") or "").strip()
        for key in ("name", "type"):
            if not str(m.get(key, "")).strip() and str(row.get(key, "")).strip():
                m[key] = str(row[key]).strip()
        filled += 1
        _log(result, f"[prepare] '{m['filename']}' is in ComfyUI-Manager's "
                     f"catalog ({m['base']} -> models/{_catalog_dir(row)}/) — "
                     "auto-install is possible after all.")
    return filled


def _checklist_entry(model: dict, reason: str) -> dict:
    """The one constructor of every reported row.

    It carries the model's PROVENANCE (`r2_key`/`sha256`/`size`) through as well
    as its identity, because the caller's mirror-enrichment pass needs a stored
    key to fall back on when the live manifest cannot be read — and dropping it
    here is why a resolved key could never reach the human."""
    entry = {
        "filename": model.get("filename") or "(unnamed)",
        "save_path": model.get("save_path") or model.get("dir") or "",
        "base": model.get("base") or "",
        "url": model.get("url") or model.get("source") or "",
        "reason": reason,
    }
    for key in ("r2_key", "sha256", "size"):
        if model.get(key) not in (None, ""):
            entry[key] = model[key]
    return entry


def _report(result: PrepareResult, model: dict, verdict, reason: str) -> None:
    """File one failed-delivery row, refusal-grade ONLY if the target answered.

    Manager's 400/403, an absent Manager, a stalled download, an unreachable
    ComfyUI mid-queue — every one of them says "I could not deliver this file",
    never "it is not on the target". Refusing over one for a model whose
    presence was never established (``verdict is None``: an unmappable field, an
    unreadable enum) kills a render on a question nobody ever answered."""
    entry = _checklist_entry(model, reason)
    if verdict is None:
        result.advisories.append(entry)
    else:
        result.still_missing.append(entry)
        result.ready = False


def _install_body(model: dict) -> dict:
    """The Manager install_model body: the catalog match keys + url, plus an
    optional ``ui_id`` (Manager echoes it in progress events; harmless)."""
    body = {
        "url": str(model["url"]).strip(),
        "filename": str(model["filename"]).strip(),
        "save_path": _install_save_path(model),
        "base": str(model["base"]).strip(),
    }
    # `name` is NOT optional in practice: `do_install_model` logs `json_data
    # ['name']` before downloading, and the KeyError from a body without one is
    # caught by its own `except Exception` and reported as a generic "Model
    # installation error" — a failure that looks like a dead URL. Fall back to
    # the filename rather than omitting it.
    body["name"] = str(model.get("name") or "").strip() or body["filename"]
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
    #    Each entry carries its PRESENCE VERDICT alongside the model, because
    #    every later branch reports a DELIVERY failure and only the verdict says
    #    whether the target ever claimed the file was absent.
    pending: list[tuple[dict, "bool | None"]] = []
    for m in models:
        # An empty `field` is legal (`_validate_models` normalises it to "" and
        # the legacy {source, dir} shape predates the key), and it is exactly
        # the "cannot check" case — so it goes THROUGH the primitive, which
        # answers None, rather than being short-circuited to a flat False here.
        fld = str(m.get("field", "")).strip()
        fname = str(m.get("filename", "")).strip()
        try:
            present = is_installed(fld, fname) if fname else False
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
                         "(no verdict)")
            present = None
        if present is True:
            _log(result, f"[prepare] already installed: {fname}")
            continue
        pending.append((m, present))

    # 1b. A DERIVED declaration carries no url/base, so every model on an
    #     uploaded blueprint reaches here un-installable and auto-install could
    #     never fire. Ask the target's own Manager catalog whether it knows any
    #     of them — ONE read, and only when something actually needs it, so a run
    #     whose models are all installed or all hand-declared makes no extra call.
    if any(not _is_installable(m) for m, _ in pending):
        enrich_from_catalog([m for m, _ in pending], http_get=http_get,
                            result=result)

    # 1c. Partition what is left. Installable wins over an absent verdict: the
    #     whitelist is the real gate, so declining to try would remove the only
    #     delivery path a model has.
    to_queue: list[tuple[dict, "bool | None"]] = []
    for m, present in pending:
        fname = str(m.get("filename", "")).strip()
        if _is_installable(m):
            if present is None:
                _log(result, f"[prepare] cannot verify '{fname}' on this target; "
                             "queueing the install anyway.")
            to_queue.append((m, present))
        elif present is None:
            # No verdict and no way to install it either: the only honest report
            # is "could not check". Calling it missing would refuse the render
            # over a file that may well be sitting on the target.
            _log(result, f"[prepare] could not verify '{fname or '(unnamed)'}' on "
                         "this target — reporting it, not refusing over it.")
            result.advisories.append(
                _checklist_entry(m, "could not be verified on this target "
                                    "(no readable inventory for this field)"))
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
        for m, present in to_queue:
            _report(result, m, present, "auto-install disabled "
                                        "(BLUEPRINT_AUTO_INSTALL_MODELS=off)")
        return result

    # 2. Queue each installable-missing model. Per-model 400/403 -> checklist
    #    (do NOT abort the others). 404 on /manager/* -> Manager absent.
    queued: list[tuple[dict, "bool | None"]] = []
    for m, present in to_queue:
        body = _install_body(m)
        try:
            # This POST only QUEUES the install (returns fast); the actual
            # multi-GB download is awaited later via _poll_queue_done, NOT by
            # this request's timeout.
            status, text = http_post("/manager/queue/install_model", body)
        except ManagerAbsent:
            _log(result, "[prepare] ComfyUI-Manager not installed "
                         "(/manager/queue/install_model -> 404).")
            for mm, pp in to_queue:
                _report(result, mm, pp, "ComfyUI-Manager not installed — "
                                        "install this model manually")
            return result
        except ComfyUnreachable:
            _log(result, "[prepare] ComfyUI unreachable while queueing installs.")
            for mm, pp in to_queue:
                _report(result, mm, pp,
                        "ComfyUI unreachable (install not queued)")
            return result
        except Exception as e:  # noqa: BLE001
            _log(result, f"[prepare] queue error for '{body['filename']}': {e}")
            _report(result, m, present, f"install request failed: {e}")
            continue
        if status == 200:
            _log(result, f"[prepare] queued for download: {body['filename']}")
            queued.append((m, present))
        elif status == 400:
            _log(result, f"[prepare] '{body['filename']}' not in ComfyUI-Manager's "
                         "curated model catalog (400) — can't auto-install.")
            _report(result, m, present,
                    "not in ComfyUI-Manager's curated catalog (only catalog "
                    "models auto-install) — install manually")
        elif status == 403:
            _log(result, f"[prepare] '{body['filename']}' rejected (403): ComfyUI-"
                         "Manager security level is above 'middle'.")
            _report(result, m, present,
                    "ComfyUI-Manager security level blocks auto-install (set it "
                    "to 'middle' or below) — install manually")
        else:
            _log(result, f"[prepare] '{body['filename']}' install_model returned "
                         f"HTTP {status}: {text[:200]}")
            _report(result, m, present,
                    f"install_model returned HTTP {status}")

    if not queued:
        return result  # nothing got queued; checklist already populated

    # 3. Start the worker; poll status until idle.
    try:
        start_status, _ = http_post("/manager/queue/start", {})
    except ManagerAbsent:
        _log(result, "[prepare] ComfyUI-Manager not installed (/manager/queue/start "
                     "-> 404).")
        for m, present in queued:
            _report(result, m, present,
                    "ComfyUI-Manager not installed — install manually")
        return result
    except Exception as e:  # noqa: BLE001
        _log(result, f"[prepare] queue/start failed: {e}")
        for m, present in queued:
            _report(result, m, present,
                    f"could not start the install worker: {e}")
        return result
    # 200 normal, 201 = already in progress; both mean "worker running".
    _log(result, f"[prepare] install worker started (HTTP {start_status}); "
                 "downloading… (this can take a while for multi-GB checkpoints)")

    if not _poll_queue_done(result, http_get, status_timeout, poll_interval, sleep, now):
        # Timed out / errored: don't reboot into an unknown state — checklist.
        for m, present in queued:
            _report(result, m, present,
                    "download did not finish in time — re-run prepare or "
                    "install manually")
        return result

    # 4. Reboot ONCE (batched) so ComfyUI rescans models/, then wait for it back.
    _reboot(result, http_post)
    if not _wait_comfy_back(result, http_get, reboot_timeout, poll_interval, sleep, now):
        for m, present in queued:
            _report(result, m, present,
                    "ComfyUI did not come back after reboot — restart it "
                    "manually, then re-run")
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
    for m, _phase1 in queued:
        fld = str(m.get("field", "")).strip()
        fname = str(m.get("filename", "")).strip()
        try:
            present = is_installed(fld, fname) if fname else False
        except Exception:  # noqa: BLE001
            present = None
        if present is True:
            _log(result, f"[prepare] installed + verified: {fname}")
            result.installed.append(fname)
        elif present is None:
            # The download was paid for and the reboot done; a non-answer here
            # must not turn that into a SystemExit. Same rule as phase 1.
            _log(result, f"[prepare] installed '{fname}'; could not verify it on "
                         "this target.")
            result.installed.append(fname)
            result.advisories.append(
                _checklist_entry(m, "installed; could not be verified on this "
                                    "target (no readable inventory for this field)"))
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


def survey_blueprint_models(models: list) -> PrepareResult:
    """The read-only sibling of ``prepare_blueprint_models``, for a target we can
    neither ask nor install onto (the RunPod Serverless worker: its inventory is
    baked into an image, it holds no R2 credential, and nothing can restart it
    mid-invocation).

    Every declared model becomes ONE advisory and ``ready`` stays True. That is
    deliberate: with no legitimate inventory to read, any refusal here would be
    decided by something other than the target — which is how a pod render came
    to be killed by whether the artist's unrelated desktop happened to be online.
    Pure, no injected primitives, never raises."""
    result = PrepareResult()
    for m in models or []:
        if not isinstance(m, dict):
            continue
        result.advisories.append(
            _checklist_entry(m, "not verified — this target has no inventory to "
                                "ask (the worker's models are fixed in its image)"))
    return result


def _mirror_lines(m: dict) -> list[str]:
    """The mirror verdict + remedy an enrichment pass wrote onto a row, if any."""
    lines: list[str] = []
    # This renderer is the last thing between a refused render and a bare
    # traceback, so a row shaped wrong must cost its own two lines, not the
    # whole checklist.
    mirror = m.get("mirror")
    mirror = mirror if isinstance(mirror, dict) else {}
    if mirror:
        state = mirror.get("state")
        if state in ("hit", "in_bucket_unindexed"):
            size = mirror.get("size_human") or ""
            lines.append(f"      mirror: {mirror.get('key')}"
                         + (f"  ({size})" if size else ""))
        elif state == "ambiguous":
            lines.append("      mirror: several files with this name — "
                         + ", ".join(str(c) for c in mirror.get("candidates", [])))
        elif state == "miss":
            lines.append("      mirror: not in the model mirror")
        else:
            lines.append("      mirror: could not be read")
    if m.get("remedy"):
        lines.append(f"      -> {m['remedy']}")
    return lines


def _row(m: dict) -> list[str]:
    dest = m.get("save_path") or "(unknown folder)"
    lines = [f"  - {m.get('filename')}  ->  models/{dest}/"]
    mirror_lines = _mirror_lines(m)
    # A mirror verdict already says where the bytes are; "(no source URL)" under
    # it is noise, and a derived model never has one.
    if not mirror_lines:
        lines.append(f"      source: {m.get('url') or '(no source URL)'}")
    elif m.get("url"):
        lines.append(f"      source: {m['url']}")
    lines.append(f"      reason: {m.get('reason')}")
    lines.extend(mirror_lines)
    return lines


def format_checklist(result: PrepareResult) -> str:
    """Readable multi-line checklist of the still-missing models, in the same
    spirit as ``preflight_models``' error block. Empty string when ready."""
    if not result.still_missing:
        return ""
    lines = ["The following model(s) could not be auto-installed and must be "
             "added to your local ComfyUI manually:"]
    for m in result.still_missing:
        lines.extend(_row(m))
    lines.append("  Put each file in the named ComfyUI models/<folder>, then "
                 "restart ComfyUI (it only scans at startup) and retry.")
    return "\n".join(lines)


def format_advisories(result: PrepareResult) -> str:
    """The advisories block — same layout as the checklist, opposite meaning.
    Nothing here stopped the run; it is printed so a human can act BEFORE the
    render fails somewhere further downstream. Empty string when there are
    none."""
    if not result.advisories:
        return ""
    lines = ["The following model(s) could not be verified on this target. This "
             "is NOT evidence they are missing — the run continues:"]
    for m in result.advisories:
        lines.extend(_row(m))
    return "\n".join(lines)
