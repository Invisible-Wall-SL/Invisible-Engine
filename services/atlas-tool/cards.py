"""Blueprint cards (ADR-0008 §2): what a blueprint's author knows and
`blueprint.json` does not — when to use it, what it needs, what it costs, what
goes wrong — kept beside the blueprint it describes:

    _shared/blueprints/<id>/card.json                  # the current card
    _shared/blueprints/<id>/card.history/<rev>.json    # every earlier version

One card per pipeline id. The three built-in ids describe what RUNS under them
(the Python builders), so their settings are Settings keys, not params.

A card in `status: reviewed` is the owner's approval of that blueprint for
agents; only `GET /blueprints` consumers read it (inert for human renders). It
counts as `draft` again as soon as the blueprint's graph or mapping changes
(`effective_status` -> "stale"), on any save without review, and on any
re-publish of the blueprint (`reset_on_republish`).

Every write is a compare-and-swap. A card is read straight from R2 (never the
staging mirror) with its ETag; a user save is checked against the version the
page loaded (`docsave.check`, no rev-merge: a card save REPLACES the card) and
lands with `If-Match` on that ETag (`If-None-Match: *` for a create). The
previous version is written to history CREATE-ONLY before the new card lands.

No ui_server import: the Settings key sets the built-in cards are checked
against are passed in (`builtin_keys`).
"""
from __future__ import annotations

import copy
import json
import math
import time
from pathlib import Path

import blueprints
import storage
from iw_common import docsave, launch
from iw_common.context import r2_slug

BUILTIN_IDS = ("sdxl", "flux", "gpt_image")
BUILTIN_NAMES = {"sdxl": "SDXL (built-in)", "flux": "FLUX (built-in)",
                 "gpt_image": "GPT-Image (built-in)"}
CARD_VERSION = 1
TOOL = "atlas"
REVIEW_CAP = launch.REVIEW_CAP

CARD_SEEDS = Path(__file__).resolve().parent / "card_seeds"

# Region (`ADV_FIELDS`) keys that are not card settings: the refs are the card's
# `inputs`, and the pipeline is the card's own id.
NON_SETTING_ADV_KEYS = ("pipeline", "style_ref", "shape_ref")

STATUSES = ("draft", "reviewed")
INPUT_KEYS = ("prompt", "negative", "reference", "shape", "sourceImage", "mask",
              "layer")
INPUT_VALUES = ("required", "optional", "none")
OUTPUT_KINDS = ("image", "video")
CHAIN_POSITIONS = ("generate", "process", "extract")
GPU_SOURCES = ("guess", "measured")
BILLING = ("gpu", "credits")
LICENCES = ("ok", "blocked", "conditional")
SCOPES = ("atlas", "region")

MAX_TEXT = 300
MAX_LIST = 20

# Written by the server, never taken from a client: an editor that sends any of
# these back (it holds the whole card) has them replaced, not refused.
SERVER_FIELDS = ("version", "id", "status", "rev", "builtin", "graphSha",
                 "mapSha", "reviewedBy", "reviewedAt", "resetReason",
                 docsave.SAVED_BY)
CLIENT_FIELDS = ("purpose", "whenToUse", "whenNotToUse", "inputs", "outputs",
                 "settings", "chain", "gpu", "variants", "billing", "licence",
                 "gotchas")
TOP_KEYS = frozenset(SERVER_FIELDS + CLIENT_FIELDS)
_REQUIRED_TOP = ("version", "id", "status", "rev", "purpose", "inputs",
                 "outputs", "chain", "gpu", "variants", "billing", "licence")
_OUTPUT_KEYS = frozenset(("kind", "alpha", "count", "sizeRule", "fixedPx",
                          "frames", "fps"))
_SETTING_KEYS = frozenset(("key", "default", "min", "max", "options", "scope",
                           "note", "draft", "final"))
_CHAIN_KEYS = frozenset(("position", "follows", "precedes"))
_GPU_KEYS = frozenset(("secondsPerImage", "coldStart", "source",
                       "qualityModeSeconds", "apiWallSeconds", "minVramGb"))
_VARIANT_KEYS = ("draft", "final", "max")

HISTORY_LIMIT = 50
# How many history versions `GET /card` reads in full; older ones are listed by
# rev and read one at a time (`GET /card/history`) when the editor asks.
HISTORY_DETAIL = 5
# A session carries the caps of its launch for SESSION_TTL (12 h). A review is
# the owner's approval for agents, so it is accepted only this soon after the
# launcher last decided the caller holds `pipelineMerge` — a revoked permission
# lingers at most this long instead of half a day.
REVIEW_MAX_AGE = 30 * 60
_TRANSIENT_ATTEMPTS = 3


class CardRefused(Exception):
    """The caller may not do this to a card (a capability, not a validation
    problem) — the route answers 403."""


# --------------------------------------------------------------------------
# Keys and capabilities
# --------------------------------------------------------------------------

def card_key(bp_id: str) -> str:
    return f"{blueprints.SHARED_BLUEPRINTS_PREFIX}/{bp_id}/card.json"


def history_prefix(bp_id: str) -> str:
    return f"{blueprints.SHARED_BLUEPRINTS_PREFIX}/{bp_id}/card.history/"


def history_key(bp_id: str, rev: int) -> str:
    return f"{history_prefix(bp_id)}{int(rev)}.json"


def doc_id(bp_id: str) -> str:
    """The card's id in `X-IW-Doc-Bases` / `X-IW-Doc-Versions`."""
    return f"card:{bp_id}"


def norm_id(raw) -> str:
    """The blueprint id a card is filed under, slugged like the library's dirs;
    "" for an empty id (`r2_slug` would turn that into "default")."""
    text = str(raw or "").strip()
    return r2_slug(text) if text else ""


def builtin_keys(per_atlas_keys, adv_fields) -> dict:
    """The Settings keys a built-in card may name: `{atlas: [...], region: [...]}`
    from ui_server's `PER_ATLAS_KEYS` and `ADV_FIELDS`. Global-only keys are in
    neither, so they can never become a card setting."""
    region = sorted({f[0] for f in adv_fields} - set(NON_SETTING_ADV_KEYS))
    return {"atlas": sorted(per_atlas_keys), "region": region}


def is_agent(identity) -> bool:
    return bool(getattr(identity, "act_tool", "") or "")


def _review_holder(identity) -> bool:
    """A person holding `pipelineMerge` on a signed BROWSER launch. Never an
    agent, never an api-token call (a server acting for someone, whatever caps
    it carries), never a legacy `?k=` session (it names itself in the URL)."""
    if identity is None or is_agent(identity):
        return False
    return bool(getattr(identity, "is_browser", False)) and identity.can(REVIEW_CAP)


def review_needs_relaunch(identity, now: float | None = None) -> bool:
    """Holds `pipelineMerge`, but the launch behind this session is older than
    `REVIEW_MAX_AGE`: re-opening the tool from the launcher re-checks it."""
    t = time.time() if now is None else now
    return (_review_holder(identity)
            and t - float(getattr(identity, "issued_at", 0) or 0) > REVIEW_MAX_AGE)


def can_review(identity, now: float | None = None) -> bool:
    """May this caller mark a card reviewed? A recent signed browser launch
    holding `pipelineMerge` (see `REVIEW_MAX_AGE`), or anyone on a local dev
    tool with no gate (the gate never opens on Railway)."""
    if identity is not None and not is_agent(identity) and identity.via == "open":
        return True
    return _review_holder(identity) and not review_needs_relaunch(identity, now)


def can_edit(identity, can_publish: bool) -> bool:
    """Draft saves need the publish capability; an agent never writes a card."""
    return bool(can_publish) and identity is not None and not is_agent(identity)


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

def _is_num(v) -> bool:
    return (isinstance(v, (int, float)) and not isinstance(v, bool)
            and math.isfinite(v))


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _is_scalar(v) -> bool:
    return isinstance(v, (str, bool)) or _is_num(v)


def _closed(obj: dict, allowed, path: str, errors: list) -> None:
    for k in obj:
        if k not in allowed:
            errors.append(f"{path}{k}: unknown key")


def _enum(v, allowed, path: str, errors: list) -> None:
    if v not in allowed:
        errors.append(f"{path}: must be one of {' / '.join(allowed)} (got {v!r})")


def _text_list(v, path: str, errors: list) -> list:
    if v is None:
        return []
    if not isinstance(v, list):
        errors.append(f"{path}: must be a list of strings")
        return []
    if len(v) > MAX_LIST:
        errors.append(f"{path}: at most {MAX_LIST} entries (got {len(v)})")
    for i, s in enumerate(v):
        if not isinstance(s, str):
            errors.append(f"{path}[{i}]: must be a string")
        elif len(s) > MAX_TEXT:
            errors.append(f"{path}[{i}]: at most {MAX_TEXT} characters")
    return v


def _px_map(v, path: str, errors: list) -> None:
    if not isinstance(v, dict):
        errors.append(f'{path}: must be an object of pixel size -> seconds, e.g. {{"1024": 12}}')
        return
    for px, secs in v.items():
        if not (isinstance(px, str) and px.isdigit() and int(px) > 0):
            errors.append(f"{path}: key {px!r} must be a pixel size like \"1024\"")
        if not _is_num(secs) or secs <= 0:
            errors.append(f"{path}.{px}: must be a number > 0")


def _check_inputs(v, errors: list) -> None:
    if not isinstance(v, dict):
        errors.append("inputs: must be an object")
        return
    _closed(v, INPUT_KEYS, "inputs.", errors)
    for k in INPUT_KEYS:
        if k not in v:
            errors.append(f"inputs.{k}: required")
        else:
            _enum(v[k], INPUT_VALUES, f"inputs.{k}", errors)


def _check_outputs(v, errors: list) -> None:
    if not isinstance(v, dict):
        errors.append("outputs: must be an object")
        return
    _closed(v, _OUTPUT_KEYS, "outputs.", errors)
    _enum(v.get("kind"), OUTPUT_KINDS, "outputs.kind", errors)
    if not isinstance(v.get("alpha"), bool):
        errors.append("outputs.alpha: must be true or false")
    if not _is_int(v.get("count")) or v["count"] < 1:
        errors.append("outputs.count: must be a whole number >= 1")
    if "sizeRule" in v and (not isinstance(v["sizeRule"], str) or len(v["sizeRule"]) > MAX_TEXT):
        errors.append(f"outputs.sizeRule: must be a string of at most {MAX_TEXT} characters")
    for k in ("fixedPx", "frames"):
        if k in v and (not _is_int(v[k]) or v[k] < 1):
            errors.append(f"outputs.{k}: must be a whole number >= 1")
    if "fps" in v and (not _is_num(v["fps"]) or v["fps"] <= 0):
        errors.append("outputs.fps: must be a number > 0")


def _check_settings(v, errors: list) -> list:
    if v is None:
        return []
    if not isinstance(v, list):
        errors.append("settings: must be a list")
        return []
    seen: set = set()
    for i, s in enumerate(v):
        path = f"settings[{i}]"
        if not isinstance(s, dict):
            errors.append(f"{path}: must be an object")
            continue
        _closed(s, _SETTING_KEYS, f"{path}.", errors)
        key = s.get("key")
        if not isinstance(key, str) or not key.strip():
            errors.append(f"{path}.key: required")
        elif key in seen:
            errors.append(f"{path}.key: '{key}' appears twice")
        else:
            seen.add(key)
            path = f"settings[{i}] ({key})"
        if "default" in s and not _is_scalar(s["default"]):
            errors.append(f"{path}.default: must be a string, number or true/false")
        for k in ("min", "max", "draft", "final"):
            if k in s and not _is_num(s[k]):
                errors.append(f"{path}.{k}: must be a number")
        if _is_num(s.get("min")) and _is_num(s.get("max")) and s["min"] > s["max"]:
            errors.append(f"{path}: min {s['min']} is above max {s['max']}")
        if "options" in s:
            opts = s["options"]
            if not isinstance(opts, list) or not opts or not all(_is_scalar(o) for o in opts):
                errors.append(f"{path}.options: must be a non-empty list of values")
        if "scope" in s:
            _enum(s["scope"], SCOPES, f"{path}.scope", errors)
        if "note" in s and (not isinstance(s["note"], str) or len(s["note"]) > MAX_TEXT):
            errors.append(f"{path}.note: must be a string of at most {MAX_TEXT} characters")
    return v


def _check_chain(v, errors: list) -> None:
    if not isinstance(v, dict):
        errors.append("chain: must be an object")
        return
    _closed(v, _CHAIN_KEYS, "chain.", errors)
    _enum(v.get("position"), CHAIN_POSITIONS, "chain.position", errors)
    v["follows"] = _text_list(v.get("follows"), "chain.follows", errors)
    v["precedes"] = _text_list(v.get("precedes"), "chain.precedes", errors)


def _check_gpu(v, errors: list) -> None:
    if not isinstance(v, dict):
        errors.append("gpu: must be an object")
        return
    _closed(v, _GPU_KEYS, "gpu.", errors)
    if "secondsPerImage" not in v:
        errors.append("gpu.secondsPerImage: required (may be {} while unknown)")
    else:
        _px_map(v["secondsPerImage"], "gpu.secondsPerImage", errors)
    if not _is_num(v.get("coldStart")) or v["coldStart"] < 0:
        errors.append("gpu.coldStart: must be a number >= 0")
    _enum(v.get("source"), GPU_SOURCES, "gpu.source", errors)
    if "qualityModeSeconds" in v:
        _px_map(v["qualityModeSeconds"], "gpu.qualityModeSeconds", errors)
    if "apiWallSeconds" in v and (not _is_num(v["apiWallSeconds"]) or v["apiWallSeconds"] < 0):
        errors.append("gpu.apiWallSeconds: must be a number >= 0")
    if "minVramGb" in v and (not _is_num(v["minVramGb"]) or v["minVramGb"] <= 0):
        errors.append("gpu.minVramGb: must be a number > 0")


def _check_variants(v, errors: list) -> None:
    if not isinstance(v, dict):
        errors.append("variants: must be an object")
        return
    _closed(v, _VARIANT_KEYS, "variants.", errors)
    for k in _VARIANT_KEYS:
        if not _is_int(v.get(k)) or v[k] < 0:
            errors.append(f"variants.{k}: must be a whole number >= 0")
    if all(_is_int(v.get(k)) for k in _VARIANT_KEYS):
        for k in ("draft", "final"):
            if v[k] > v["max"]:
                errors.append(f"variants.{k}: {v[k]} is above max {v['max']}")


def validate_structure(card) -> tuple[dict, list[str]]:
    """The schema alone (types, enums, ranges, closed keys) — no blueprint.
    Returns `(normalized copy, errors)`; the copy fills the optional lists."""
    if not isinstance(card, dict):
        return {}, ["card: must be a JSON object"]
    c = copy.deepcopy(card)
    errors: list[str] = []
    _closed(c, TOP_KEYS, "", errors)
    for k in _REQUIRED_TOP:
        if k not in c:
            errors.append(f"{k}: required")
    if "version" in c and c["version"] != CARD_VERSION:
        errors.append(f"version: must be {CARD_VERSION}")
    if "id" in c and (not isinstance(c["id"], str) or not c["id"]
                      or norm_id(c["id"]) != c["id"]):
        errors.append("id: must be the blueprint id (lowercase letters, digits, _)")
    if "status" in c:
        _enum(c["status"], STATUSES, "status", errors)
    if "rev" in c and (not _is_int(c["rev"]) or c["rev"] < 1):
        errors.append("rev: must be a whole number >= 1")
    if "builtin" in c and not isinstance(c["builtin"], bool):
        errors.append("builtin: must be true or false")
    for k in ("graphSha", "mapSha", "reviewedBy", "reviewedAt", "resetReason"):
        if k in c and not isinstance(c[k], str):
            errors.append(f"{k}: must be a string")
    if docsave.SAVED_BY in c and not isinstance(c[docsave.SAVED_BY], dict):
        errors.append(f"{docsave.SAVED_BY}: must be an object")
    if "purpose" in c:
        p = c["purpose"]
        if not isinstance(p, str) or not p.strip():
            errors.append("purpose: required (one line on what this pipeline is for)")
        elif len(p) > MAX_TEXT:
            errors.append(f"purpose: at most {MAX_TEXT} characters")
    for k in ("whenToUse", "whenNotToUse", "gotchas"):
        c[k] = _text_list(c.get(k), k, errors)
    if "inputs" in c:
        _check_inputs(c["inputs"], errors)
    if "outputs" in c:
        _check_outputs(c["outputs"], errors)
    c["settings"] = _check_settings(c.get("settings"), errors)
    if "chain" in c:
        _check_chain(c["chain"], errors)
    if "gpu" in c:
        _check_gpu(c["gpu"], errors)
    if "variants" in c:
        _check_variants(c["variants"], errors)
    if "billing" in c:
        _enum(c["billing"], BILLING, "billing", errors)
    if "licence" in c:
        _enum(c["licence"], LICENCES, "licence", errors)
    return c, errors


def _builtin_setting_problems(settings: list, keys: dict) -> list[str]:
    atlas, region = set(keys.get("atlas") or ()), set(keys.get("region") or ())
    out = []
    for i, s in enumerate(settings):
        if not isinstance(s, dict) or not isinstance(s.get("key"), str):
            continue
        key, scope = s["key"], s.get("scope", "atlas")
        path = f"settings[{i}] ({key})"
        if key not in atlas and key not in region:
            out.append(f"{path}: not a per-atlas or per-region setting of the built-in "
                       "pipeline (global-only and unknown keys cannot be card settings)")
        elif scope == "region" and key not in region:
            out.append(f"{path}: a per-atlas setting only — drop scope 'region'")
        elif scope != "region" and key not in atlas:
            out.append(f"{path}: a per-region setting only — set scope 'region'")
    return out


def _param_setting_problems(settings: list, params: list) -> list[str]:
    by_key = {p.get("key"): p for p in params if isinstance(p, dict)}
    out = []
    for i, s in enumerate(settings):
        if not isinstance(s, dict) or not isinstance(s.get("key"), str):
            continue
        key = s["key"]
        path = f"settings[{i}] ({key})"
        p = by_key.get(key)
        if p is None:
            out.append(f"{path}: not one of this blueprint's exposed settings "
                       f"({', '.join(sorted(k for k in by_key if k)) or 'it exposes none'})")
            continue
        lo, hi = p.get("min"), p.get("max")
        for f in ("min", "max", "default", "draft", "final"):
            v = s.get(f)
            if not _is_num(v):
                continue
            if (_is_num(lo) and v < lo) or (_is_num(hi) and v > hi):
                out.append(f"{path}.{f}: {v} is outside the blueprint's own range "
                           f"{lo if _is_num(lo) else '…'}–{hi if _is_num(hi) else '…'}")
        if (isinstance(s.get("options"), list) and p.get("type") == "select"
                and isinstance(p.get("options"), list)):
            extra = [o for o in s["options"] if o not in p["options"]]
            if extra:
                out.append(f"{path}.options: {extra!r} are not options of the blueprint's "
                           "select")
    return out


def blueprint_kind(blueprint: dict | None) -> str:
    meta = (blueprint or {}).get("meta") or {}
    return str(meta.get("kind") or blueprints.DEFAULT_BLUEPRINT_KIND)


def validate_card(card, *, bp_id: str, blueprint: dict | None,
                  builtin_keys: dict) -> tuple[dict, list[str]]:
    """The schema PLUS the ADR §2 rules against the blueprint the card describes
    (`blueprints.get_blueprint(bp_id)`, or None for a built-in id). Returns
    `(normalized, errors)`; an empty list means the card may be saved."""
    norm, errors = validate_structure(card)
    if not norm:
        return norm, errors
    builtin = bp_id in BUILTIN_IDS
    if norm.get("id") not in (None, bp_id):
        errors.append(f"id: '{norm.get('id')}' is not this blueprint ('{bp_id}')")
    if norm.get("builtin") is True and not builtin:
        errors.append(f"builtin: only {', '.join(BUILTIN_IDS)} are built-in pipelines")
    settings = [s for s in norm.get("settings") or [] if isinstance(s, dict)]
    inputs = norm.get("inputs") if isinstance(norm.get("inputs"), dict) else {}
    outputs = norm.get("outputs") if isinstance(norm.get("outputs"), dict) else {}
    if builtin:
        errors += _builtin_setting_problems(settings, builtin_keys)
        kind = "image"
    elif blueprint is None:
        errors.append(f"no such blueprint '{bp_id}' in the library")
        return norm, errors
    else:
        errors += _param_setting_problems(settings, blueprint.get("params") or [])
        kind = blueprint_kind(blueprint)
        roles = set((blueprint.get("bindings") or {}).keys())
        if inputs.get("prompt") not in (None, "none") and "positive" not in roles:
            errors.append("inputs.prompt: this blueprint binds no positive prompt, so a "
                          "prompt goes nowhere — set it to none")
        if inputs.get("sourceImage") == "required" and not roles & {"style_ref", "shape_ref"}:
            errors.append("inputs.sourceImage: required needs a style_ref or shape_ref "
                          "binding, and this blueprint has neither")
    if outputs.get("kind") in OUTPUT_KINDS and outputs["kind"] != kind:
        errors.append(f"outputs.kind: '{outputs['kind']}' but this blueprint is "
                      f"kind '{kind}'")
    return norm, errors


def review_problems(card) -> list[str]:
    """What blocks REVIEW (not a draft save)."""
    out = []
    if not isinstance(card, dict):
        return ["no card"]
    if card.get("billing") == "credits":
        out.append("credit-billed cards cannot be reviewed for agents until ADR-0006 "
                   "tracks credits")
    gpu = card.get("gpu") if isinstance(card.get("gpu"), dict) else {}
    if not gpu.get("secondsPerImage"):
        out.append("gpu.secondsPerImage is empty — give at least one size's seconds")
    return out


def effective_status(card, blueprint) -> str:
    """"reviewed" | "draft" | "stale" ("none" for no card). Stale = reviewed
    against a graph or mapping the library no longer holds, or a blueprint that
    is gone; it counts as draft everywhere."""
    if not isinstance(card, dict):
        return "none"
    if card.get("status") != "reviewed":
        return "draft"
    if card.get("id") in BUILTIN_IDS:
        return "reviewed"
    if not blueprint:
        return "stale"
    if (card.get("graphSha") != blueprint.get("graph_sha")
            or card.get("mapSha") != blueprint.get("map_sha")):
        return "stale"
    return "reviewed"


# --------------------------------------------------------------------------
# Storage: read, CAS write, history
# --------------------------------------------------------------------------

def _dump(card: dict) -> bytes:
    return json.dumps(card, indent=2, ensure_ascii=False).encode("utf-8")


def read_card(bp_id: str) -> tuple[dict | None, str | None]:
    """`(card, verbatim etag)` straight from R2; `(None, None)` when there is no
    card, `(None, etag)` when the stored body is not a JSON object (a save may
    still replace it). Raises `storage.ObjectUnreadable` when R2 cannot be
    asked — never read as "no card"."""
    got = storage.get_with_etag(card_key(bp_id))
    if got is None:
        return None, None
    return docsave.parse_doc(got[0]), got[1]


def _is_transient(e: Exception) -> bool:
    """R2's 409 `ConditionalRequestConflict` (two conditional writes raced) —
    retried; unlike the 412 `storage.Conflict` it says nothing about the card."""
    resp = getattr(e, "response", None)
    if not isinstance(resp, dict):
        return False
    return (resp.get("ResponseMetadata", {}).get("HTTPStatusCode") == 409
            or str(resp.get("Error", {}).get("Code") or "") == "ConditionalRequestConflict")


def _put(key: str, body: bytes, *, if_match: str | None = None,
         if_none_match: str | None = None) -> str | None:
    """Every card write carries a precondition; `storage.Conflict` propagates."""
    for attempt in range(_TRANSIENT_ATTEMPTS):
        try:
            return storage.put(key, body, "application/json", if_match=if_match,
                               if_none_match=if_none_match)
        except storage.Conflict:
            raise
        except Exception as e:  # noqa: BLE001 — classified below
            if _is_transient(e) and attempt < _TRANSIENT_ATTEMPTS - 1:
                time.sleep(0.1 * (attempt + 1))
                continue
            raise
    return None


class _HistoryTaken(Exception):
    """Even the renumbered history slot holds a different version."""


def _filed(key: str, body: bytes) -> bool:
    """Create-only history write; True when `key` now holds exactly `body`. A
    collision with IDENTICAL bytes is that same version, left by a save whose
    card write then lost (or by a writer racing us from the same base — the
    card's own If-Match picks the winner)."""
    try:
        _put(key, body, if_none_match="*")
        return True
    except storage.Conflict:
        got = storage.get_with_etag(key)
        return got is not None and got[0] == body


def _history_revs(bp_id: str) -> list[int]:
    revs = []
    for obj in storage.list_keys(history_prefix(bp_id)):
        name = str(obj.get("key", "")).rsplit("/", 1)[-1]
        stem = name[:-5] if name.endswith(".json") else ""
        if stem.isdigit():
            revs.append(int(stem))
    return revs


def _write_history(bp_id: str, rev: int, body: bytes) -> int:
    """Keep the version being replaced, create-only; returns the rev it is filed
    under. A DIFFERENT version already under `rev` is never a concurrent saver
    (one from the same base files identical bytes) but a reused rev — history
    left by a deleted blueprint, or an unedited card the bundled sync replaced
    after a save that never landed. Refusing would wedge the card for good, so
    the version is filed above the newest history entry instead; the card's
    If-Match still decides who wins."""
    if _filed(history_key(bp_id, rev), body):
        return rev
    filed = max(_history_revs(bp_id) + [rev]) + 1
    doc = docsave.parse_doc(body)
    if doc is not None:
        body = _dump({**doc, "rev": filed})
    if not _filed(history_key(bp_id, filed), body):
        raise _HistoryTaken(history_key(bp_id, filed))
    return filed


def _conflict(bp_id: str, reason: str) -> docsave.DocConflict:
    """A refusal naming the version that is there NOW (who saved it, its ETag)."""
    got = storage.get_with_etag(card_key(bp_id))
    if got is None:
        return docsave.DocConflict(doc_id(bp_id), docsave.DELETED)
    return docsave.DocConflict(doc_id(bp_id), reason, etag=got[1],
                               doc=docsave.parse_doc(got[0]))


def _replace(bp_id: str, new: dict, cur_body: bytes | None, cur_etag: str | None,
             cur_rev: int) -> str | None:
    """History of the current version, then the new card on the current ETag.
    Raises `DocConflict` when either precondition fails; nothing of ours lands
    on a refusal before the card write, and the card write is the last step."""
    if cur_etag is not None and cur_body is not None:
        try:
            new["rev"] = _write_history(bp_id, cur_rev, cur_body) + 1
        except _HistoryTaken:
            raise _conflict(bp_id, docsave.STALE) from None
    try:
        if cur_etag is None:
            return _put(card_key(bp_id), _dump(new), if_none_match="*")
        return _put(card_key(bp_id), _dump(new), if_match=cur_etag)
    except storage.Conflict:
        raise _conflict(bp_id, docsave.EXISTS if cur_etag is None else docsave.STALE) from None


def _rev_of(card) -> int:
    rev = (card or {}).get("rev")
    return rev if _is_int(rev) and rev >= 1 else 0


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _who(identity) -> str:
    return (str(getattr(identity, "name", "") or "")
            or str(getattr(identity, "sub", "") or "") or "someone")


def lookup_blueprint(bp_id: str) -> dict | None:
    """The library blueprint a card describes; None for a built-in id (its card
    describes the Python builder, not the reference graph under that id)."""
    if bp_id in BUILTIN_IDS:
        return None
    return blueprints.get_blueprint(bp_id)


def _assemble(bp_id: str, incoming: dict, cur: dict | None, blueprint: dict | None,
              *, status: str, reviewed_by: str = "", reset_reason: str = "") -> dict:
    """The card to store: the client's fields as sent (unknown keys kept, so the
    closed-schema check names them) under server-owned fields."""
    builtin = bp_id in BUILTIN_IDS
    card: dict = {
        "version": CARD_VERSION,
        "id": bp_id,
        "status": status,
        "rev": _rev_of(cur) + 1,
    }
    if builtin:
        card["builtin"] = True
    card["graphSha"] = "" if builtin else str((blueprint or {}).get("graph_sha") or "")
    card["mapSha"] = "" if builtin else str((blueprint or {}).get("map_sha") or "")
    card["reviewedBy"] = reviewed_by
    card["reviewedAt"] = _now_iso() if reviewed_by else ""
    if reset_reason:
        card["resetReason"] = reset_reason
    for k, v in incoming.items():
        if k not in SERVER_FIELDS:
            card[k] = copy.deepcopy(v)
    gpu = card.get("gpu")
    if isinstance(gpu, dict):
        cur_gpu = (cur or {}).get("gpu") if isinstance((cur or {}).get("gpu"), dict) else {}
        # Only measured billing data may say "measured"; the editor cannot.
        gpu["source"] = cur_gpu.get("source") if cur_gpu.get("source") in GPU_SOURCES else "guess"
    return card


def save_card(bp_id: str, incoming, *, base: docsave.Base | None, identity,
              can_publish: bool, review: bool, builtin_keys: dict) -> dict:
    """A person's save from the card editor. Returns `{ok: True, card, etag,
    version}` or `{ok: False, errors}` (nothing written). Raises `CardRefused`
    for a missing capability and `docsave.DocConflict` when the card is not the
    version the page loaded (or a create finds one there)."""
    if is_agent(identity):
        raise CardRefused("An agent cannot write a blueprint card — propose a draft "
                          "in the run's project for the owner to copy instead.")
    if not can_edit(identity, can_publish):
        raise CardRefused("You're not allowed to edit blueprint cards. Ask an admin "
                          "for the 'Publish blueprints' permission.")
    if review and review_needs_relaunch(identity):
        raise CardRefused("Your launch is more than 30 minutes old. Open the Atlas Maker "
                          "again from the launcher to mark a card reviewed — that is "
                          "where the 'pipelineMerge' permission is re-checked.")
    if review and not can_review(identity):
        raise CardRefused("Marking a card reviewed needs the owner's 'pipelineMerge' "
                          "permission on a browser launch of the Atlas Maker.")
    bp_id = norm_id(bp_id)
    if not bp_id:
        return {"ok": False, "errors": ["no blueprint id"]}
    if not isinstance(incoming, dict):
        return {"ok": False, "errors": ["card: must be a JSON object"]}
    # A review pins the graph the BUCKET holds: a lagging staging mirror must
    # never let an old graph be approved under a new one's id.
    blueprint = (blueprints.read_blueprint_r2(bp_id) if review else lookup_blueprint(bp_id)
                 ) if bp_id not in BUILTIN_IDS else None
    if bp_id not in BUILTIN_IDS and blueprint is None:
        return {"ok": False, "errors": [f"no such blueprint '{bp_id}' in the library"]}

    got = storage.get_with_etag(card_key(bp_id))
    cur_body, cur_etag = (got[0], got[1]) if got is not None else (None, None)
    cur = docsave.parse_doc(cur_body)
    docsave.check(doc_id(bp_id), base, cur_etag, cur, allow_rev_merge=False,
                  missing_base=docsave.STALE)

    card = _assemble(bp_id, incoming, cur, blueprint,
                     status="reviewed" if review else "draft",
                     reviewed_by=_who(identity) if review else "")
    card, errors = validate_card(card, bp_id=bp_id, blueprint=blueprint,
                                 builtin_keys=builtin_keys)
    if review and not errors:
        errors = review_problems(card)
    if errors:
        return {"ok": False, "errors": errors}
    docsave.stamp(card, identity, TOOL)
    new_etag = _replace(bp_id, card, cur_body, cur_etag, _rev_of(cur))
    return {"ok": True, "card": card, "etag": docsave.norm_etag(new_etag),
            "version": docsave.version(new_etag, card)}


def reset_on_republish(bp_id: str, identity, *, what: str = "re-published",
                       by: str | None = None) -> bool:
    """A blueprint change (a re-publish, a models rescan, a bundled update at
    boot) changes what the card was reviewed against, so a reviewed card goes
    back to draft with the reason recorded. A machine write: no page base, CAS
    on the ETag it just read, one retry when another write lands in between,
    and the author stamp carried through (the reset is in `resetReason`).
    Returns whether a card was reset."""
    bp_id = norm_id(bp_id)
    for attempt in range(2):
        got = storage.get_with_etag(card_key(bp_id))
        if got is None:
            return False
        cur = docsave.parse_doc(got[0])
        if not cur or cur.get("status") != "reviewed":
            return False
        new = copy.deepcopy(cur)
        new.update(status="draft", rev=_rev_of(cur) + 1, reviewedBy="", reviewedAt="",
                   resetReason=f"blueprint {what} by {by or _who(identity)} at {_now_iso()}")
        try:
            _replace(bp_id, new, got[0], got[1], _rev_of(cur))
            return True
        except docsave.DocConflict:
            if attempt:
                raise
    return False


def card_history(bp_id: str, detail: int = HISTORY_LIMIT) -> list[dict]:
    """`[{rev, status, savedBy, reviewedBy, reviewedAt, resetReason}]`, newest
    first: the current card, then the stored history (the newest
    `HISTORY_LIMIT`). Only the newest `detail` versions are read; older ones
    are `{rev, loaded: False}`, for the editor to fetch when clicked."""
    bp_id = norm_id(bp_id)

    def entry(card: dict) -> dict:
        by = docsave.saved_by_of(card) or {}
        return {"rev": _rev_of(card), "status": str(card.get("status") or ""),
                "savedBy": {"name": str(by.get("name") or ""), "at": str(by.get("at") or ""),
                            "tool": str(by.get("tool") or "")},
                "reviewedBy": str(card.get("reviewedBy") or ""),
                "reviewedAt": str(card.get("reviewedAt") or ""),
                "resetReason": str(card.get("resetReason") or "")}

    out = []
    cur, _ = read_card(bp_id)
    if cur:
        out.append(entry(cur))
    for i, rev in enumerate(sorted(_history_revs(bp_id), reverse=True)[:HISTORY_LIMIT]):
        if i >= detail:
            out.append({"rev": rev, "loaded": False})
            continue
        doc = docsave.parse_doc(storage.get_strict(history_key(bp_id, rev)))
        if doc:
            out.append(entry(doc))
    return out


def get_history_version(bp_id: str, rev) -> dict | None:
    try:
        n = int(rev)
    except (TypeError, ValueError):
        return None
    if n < 0:
        return None
    return docsave.parse_doc(storage.get_strict(history_key(norm_id(bp_id), n)))


# --------------------------------------------------------------------------
# What the editor and GET /blueprints read
# --------------------------------------------------------------------------

def prefill(bp_id: str, blueprint: dict | None) -> dict:
    """A new draft card read off the graph (ADR §2): inputs from the bound
    roles, settings from the params, the kind from the blueprint."""
    if bp_id in BUILTIN_IDS or blueprint is None:
        roles: set = {"positive"}
        params: list = []
    else:
        roles = set((blueprint.get("bindings") or {}).keys())
        params = blueprint.get("params") or []
    has_prompt = "positive" in roles
    has_style = "style_ref" in roles
    inputs = {k: "none" for k in INPUT_KEYS}
    if has_prompt:
        inputs["prompt"] = "required"
    if "negative" in roles:
        inputs["negative"] = "optional"
    if has_style:
        if has_prompt:
            inputs["reference"] = "optional"
        else:
            inputs["sourceImage"] = "required"
    if "shape_ref" in roles:
        inputs["shape"] = "optional"
    settings = []
    for p in params:
        if not isinstance(p, dict) or not p.get("key"):
            continue
        s = {"key": p["key"]}
        for k in ("default", "min", "max", "options"):
            if _is_scalar(p.get(k)) or (k == "options" and isinstance(p.get(k), list)):
                s[k] = p[k]
        settings.append(s)
    kind = "image" if bp_id in BUILTIN_IDS else blueprint_kind(blueprint)
    return {
        "version": CARD_VERSION, "id": bp_id, "status": "draft", "rev": 1,
        "purpose": "", "whenToUse": [], "whenNotToUse": [],
        "inputs": inputs,
        "outputs": {"kind": kind, "alpha": False, "count": 1},
        "settings": settings,
        "chain": {"position": "generate" if has_prompt else "process",
                  "follows": [], "precedes": []},
        "gpu": {"secondsPerImage": {}, "coldStart": 0, "source": "guess"},
        "variants": {"draft": 1, "final": 1, "max": 1},
        "billing": "gpu", "licence": "conditional", "gotchas": [],
    }


def describe_blueprint(bp_id: str, blueprint: dict | None, builtin_keys: dict) -> dict:
    """What the editor and the listing say about the pipeline a card describes."""
    if bp_id in BUILTIN_IDS:
        return {"id": bp_id, "name": BUILTIN_NAMES.get(bp_id, bp_id), "kind": "image",
                "builtin": True, "roles": [], "params": [], "graphSha": "", "mapSha": "",
                "settingsKeys": {"atlas": list(builtin_keys.get("atlas") or []),
                                 "region": list(builtin_keys.get("region") or [])}}
    meta = (blueprint or {}).get("meta") or {}
    return {"id": bp_id, "name": str(meta.get("name") or bp_id),
            "kind": blueprint_kind(blueprint), "builtin": False,
            "roles": sorted((blueprint or {}).get("bindings") or {}),
            "params": list((blueprint or {}).get("params") or []),
            "graphSha": str((blueprint or {}).get("graph_sha") or ""),
            "mapSha": str((blueprint or {}).get("map_sha") or "")}


def judged_against(bp_id: str, card, staged: dict | None) -> dict | None:
    """The blueprint a card's state and problems are judged against. A REVIEWED
    library card is compared with what the bucket holds (two reads), so a
    lagging mirror can never keep a changed graph looking approved; anything
    else is judged against the staging mirror, which costs nothing."""
    if (bp_id in BUILTIN_IDS or not isinstance(card, dict)
            or card.get("status") != "reviewed"):
        return staged
    return blueprints.read_blueprint_r2(bp_id)


def library_ids() -> list[str]:
    """Every pipeline id a card can describe: the built-ins, then the library
    (minus its reference copies under the built-in ids — the built-in entry
    stands for those)."""
    lib = [str(m.get("id") or "") for m in blueprints.list_blueprints()]
    return list(BUILTIN_IDS) + [i for i in lib if i and i not in BUILTIN_IDS]


def list_entries(*, kind: str | None, include_all: bool, identity,
                 builtin_keys: dict, gpu: str) -> dict:
    """`GET /blueprints`. By default (and ALWAYS for an agent) only blueprints
    whose card is effectively reviewed; `include_all` lists every pipeline id
    with or without a card, for the editor. Raises `storage.ObjectUnreadable`
    when a card cannot be read — a listing that silently dropped one would
    present a short catalogue as the whole one."""
    if is_agent(identity):
        include_all = False
    want = str(kind or "").strip().lower()
    out = []
    for bp_id in library_ids():
        blueprint = lookup_blueprint(bp_id)
        if bp_id not in BUILTIN_IDS and blueprint is None:
            continue
        info = describe_blueprint(bp_id, blueprint, builtin_keys)
        if want and info["kind"] != want:
            continue
        card, etag = read_card(bp_id)
        live = judged_against(bp_id, card, blueprint)
        status = effective_status(card, live)
        if not include_all and status != "reviewed":
            continue
        problems = (validate_card(card, bp_id=bp_id, blueprint=live,
                                  builtin_keys=builtin_keys)[1] if card else [])
        # What agents get must be usable as written: a reviewed card that no
        # longer validates (a Settings key removed, a range moved) is withheld.
        if not include_all and problems:
            continue
        out.append({**info, "status": status, "stale": status == "stale",
                    "card": card, "cardEtag": docsave.norm_etag(etag), "problems": problems})
    return {"gpu": gpu or "", "blueprints": out}


def card_view(bp_id: str, *, identity, can_publish: bool, builtin_keys: dict) -> dict | None:
    """`GET /card`: everything the editor needs for one id; None for an id that
    is neither built-in nor in the library."""
    bp_id = norm_id(bp_id)
    if not bp_id:
        return None
    blueprint = lookup_blueprint(bp_id)
    if bp_id not in BUILTIN_IDS and blueprint is None:
        return None
    card, etag = read_card(bp_id)
    live = judged_against(bp_id, card, blueprint)
    problems = (validate_card(card, bp_id=bp_id, blueprint=live,
                              builtin_keys=builtin_keys)[1] if card else [])
    info = describe_blueprint(bp_id, blueprint, builtin_keys)
    return {
        "id": bp_id,
        "card": card,
        "etag": docsave.norm_etag(etag),
        "version": docsave.version(etag, card),
        "status": effective_status(card, live),
        "problems": problems,
        "reviewProblems": review_problems(card) if card else [],
        "history": card_history(bp_id, detail=HISTORY_DETAIL),
        "canReview": can_review(identity) and can_edit(identity, can_publish),
        "reviewNeedsRelaunch": review_needs_relaunch(identity) and can_edit(identity, can_publish),
        "canEdit": can_edit(identity, can_publish),
        "blueprint": info,
        "prefill": None if card else prefill(bp_id, blueprint),
        "measured": None,
    }


# --------------------------------------------------------------------------
# Bundled cards and the catalogue seed
# --------------------------------------------------------------------------

def _shipped_review(card) -> bool:
    """A card file in the repo may only ever be a draft: a review is the owner's
    act in the editor, stamped by `pipelineMerge`, never a value in a file."""
    return isinstance(card, dict) and card.get("status", "draft") != "draft"


def sync_bundled_cards(src: Path = blueprints.BUNDLED_SRC, *, dry_run: bool = False,
                       log=print) -> list[tuple[str, str]]:
    """Ship each `blueprints_src/<id>/card.json` to the library: create it when
    absent; replace it only when nobody ever edited it (no `saved_by`) and the
    bytes differ, on its ETag; never touch an edited one. A non-built-in card
    takes `graphSha`/`mapSha` from the blueprint the library holds. Returns
    `[(id, action)]`."""
    done: list[tuple[str, str]] = []
    if not Path(src).is_dir():
        return done
    for d in sorted(x for x in Path(src).iterdir() if x.is_dir()):
        f = d / "card.json"
        if not f.is_file():
            continue
        bp_id = d.name
        try:
            card = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            log(f"[cards] bundled card '{bp_id}' unreadable: {e}")
            continue
        if not isinstance(card, dict):
            log(f"[cards] bundled card '{bp_id}' is not a JSON object, not shipped")
            done.append((bp_id, "skipped: not a JSON object"))
            continue
        if card.get("id") != bp_id:
            log(f"[cards] bundled card in '{bp_id}/' says id {card.get('id')!r}, not shipped")
            done.append((bp_id, "skipped: id does not match its directory"))
            continue
        if _shipped_review(card):
            log(f"[cards] bundled card '{bp_id}' says status '{card.get('status')}', not "
                "shipped: only the editor's pipelineMerge review makes a card reviewed")
            done.append((bp_id, "refused: shipped as reviewed"))
            continue
        if bp_id not in BUILTIN_IDS:
            bp = blueprints.read_blueprint_r2(bp_id)
            if bp is None:
                done.append((bp_id, "skipped: blueprint not in the library"))
                continue
            card["graphSha"], card["mapSha"] = bp["graph_sha"], bp["map_sha"]
        errors = validate_structure(card)[1]
        if errors:
            log(f"[cards] bundled card '{bp_id}' is invalid, not shipped: {errors}")
            continue
        body = _dump(card)
        got = storage.get_with_etag(card_key(bp_id))
        if got is None:
            action, cond = "created", {"if_none_match": "*"}
        else:
            if docsave.saved_by_of(docsave.parse_doc(got[0])):
                done.append((bp_id, "kept: edited in the tool"))
                continue
            if got[0] == body:
                done.append((bp_id, "unchanged"))
                continue
            action, cond = "updated", {"if_match": got[1]}
        if not dry_run:
            try:
                _put(card_key(bp_id), body, **cond)
            except storage.Conflict:
                done.append((bp_id, "skipped: written meanwhile"))
                continue
        done.append((bp_id, action))
        log(f"[cards] {'would have ' if dry_run else ''}{action} bundled card '{bp_id}'")
    return done


def seed_catalogue_cards(seeds: Path = CARD_SEEDS, *, dry_run: bool = False,
                         log=print) -> list[tuple[str, str]]:
    """First draft cards for published library blueprints (`card_seeds/<id>.json`).
    A seed is written only when its blueprint is in the library with the graph
    it was written against (`graphSha`), and only CREATE-only: an existing card
    is never touched, so an owner's edit always wins and a re-run is a no-op.
    Settings keys are not checked here (the graphs are not in the repo); the
    editor shows any mismatch as a problem. Returns `[(id, action)]`."""
    done: list[tuple[str, str]] = []
    if not Path(seeds).is_dir():
        return done
    for f in sorted(Path(seeds).glob("*.json")):
        try:
            seed = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            log(f"[cards] seed '{f.name}' unreadable: {e}")
            continue
        if not isinstance(seed, dict):
            log(f"[cards] seed '{f.name}' is not a JSON object")
            continue
        bp_id = norm_id(seed.get("id")) or f.stem
        if _shipped_review(seed):
            log(f"[cards] seed '{bp_id}' says status '{seed.get('status')}', not written: "
                "only the editor's pipelineMerge review makes a card reviewed")
            done.append((bp_id, "refused: shipped as reviewed"))
            continue
        bp = blueprints.read_blueprint_r2(bp_id)
        if bp is None:
            done.append((bp_id, "skipped: not in the library"))
            continue
        if bp["graph_sha"] != seed.get("graphSha"):
            done.append((bp_id, f"skipped: graph is {bp['graph_sha']}, the seed was "
                                f"written against {seed.get('graphSha')}"))
            continue
        if storage.get_with_etag(card_key(bp_id)) is not None:
            done.append((bp_id, "skipped: a card exists"))
            continue
        card = dict(seed, mapSha=bp["map_sha"])
        errors = validate_structure(card)[1]
        if errors:
            log(f"[cards] seed '{bp_id}' is invalid, not written: {errors}")
            continue
        if not dry_run:
            try:
                _put(card_key(bp_id), _dump(card), if_none_match="*")
            except storage.Conflict:
                done.append((bp_id, "skipped: a card exists"))
                continue
        done.append((bp_id, "created"))
        log(f"[cards] {'would have ' if dry_run else ''}seeded card '{bp_id}'")
    return done
