"""Licence provenance for a generated asset: which models made it, and may a
studio that SELLS the result have run them?

Pure and stdlib-only on purpose — `batch_atlas` (the render subprocess) and
`video_runner` both import it, and neither may pay for, or be broken by, this
bookkeeping. `provenance()` never raises: an odd graph yields an "unknown"
stamp, not a failed render.

The licence data is `model_licences.json` beside this module (human write-up:
docs/reference/model-licences.md). A model is recognised three ways:

  * a string input whose value ends in a model-file extension (the same rule
    `blueprints.derive_models_from_graph` and the submit-time guard use);
  * a known (class_type, field) pair whose value is a node ENUM with no
    extension (`RMBG.model = 'RMBG-2.0'`);
  * weights a node loads by itself (PuLID's InsightFace / EVA-CLIP / facexlib),
    added from the node class alone and flagged `implicit`.

NOT legal advice — see the json's `_about`.
"""
from __future__ import annotations

import fnmatch
import json
import posixpath
import threading
from datetime import datetime, timezone
from pathlib import Path

LICENCES_PATH = Path(__file__).resolve().parent / "model_licences.json"

# Mirror of `blueprints.MODEL_FILE_EXTS`. Not imported: `blueprints` pulls in
# storage/boto3, and this module must stay importable anywhere. A test pins the
# two tuples equal, so they cannot drift silently.
MODEL_FILE_EXTS = (".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".sft",
                   ".gguf", ".onnx")

# Enum-valued model inputs: the value names a model but carries no extension.
ENUM_MODEL_FIELDS = {
    ("RMBG", "model"),
    ("BiRefNetRMBG", "model"),
    ("IPAdapterUnifiedLoader", "preset"),
    ("OpenAIGPTImage1", "model"),
}

# The CLIP vision encoder the IPAdapter PLUS / ViT-H presets load by themselves.
_IPADAPTER_VIT_H = "CLIP-ViT-H-14-laion2B-s32B-b79K"

_INSIGHTFACE_LOADERS = ("PulidFluxInsightFaceLoader", "PulidInsightFaceLoader")
_EVA_CLIP_LOADERS = ("PulidFluxEvaClipLoader", "PulidEvaClipLoader")
_PULID_APPLIERS = ("ApplyPulidFlux", "ApplyPulid")

COMMERCIAL_VALUES = ("clear", "conditional", "unknown", "blocked")
# Worst first: blocked > unknown > conditional > clear.
_SEVERITY = {"clear": 0, "conditional": 1, "unknown": 2, "blocked": 3}

_LOCK = threading.Lock()
_CACHE: dict | None = None


def load_licences() -> dict:
    """The parsed licence file, read once per process. An unreadable file is
    cached as an empty table (every model then reads "unknown") and logged
    once — a broken json must never cost a render anything."""
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    with _LOCK:
        if _CACHE is None:
            try:
                data = json.loads(LICENCES_PATH.read_text(encoding="utf-8"))
                if not isinstance(data, dict) or not isinstance(
                        data.get("models"), list):
                    raise ValueError("no models[] list")
            except Exception as e:  # noqa: BLE001
                print(f"[provenance] licence table unreadable: {e}", flush=True)
                data = {"version": 0, "checked": None, "models": []}
            _CACHE = data
    return _CACHE


def lookup(value) -> dict | None:
    """The licence entry for one loader value, or None. Case-insensitive
    fnmatch against the whole value AND its basename (so both
    'models/loras/x.safetensors' and an 'org/repo' enum resolve); the FIRST
    entry with any matching pattern wins."""
    if not isinstance(value, str) or not value.strip():
        return None
    full = value.strip().replace("\\", "/").lower()
    cands = [full]
    base = posixpath.basename(full)
    if base and base != full:
        cands.append(base)
    for entry in load_licences().get("models") or []:
        if not isinstance(entry, dict):
            continue
        for pat in entry.get("match") or []:
            if not isinstance(pat, str):
                continue
            p = pat.lower()
            if any(fnmatch.fnmatchcase(c, p) for c in cands):
                return entry
    return None


def _is_link(v) -> bool:
    return isinstance(v, (list, tuple))


def models_in_workflow(wf) -> list[dict]:
    """Every model an api-prompt graph loads, as
    `[{node, class_type, field, value, implicit?}]`, deduped by value
    (case-insensitive, first sighting kept). Wires (`["3", 0]`) are skipped;
    a malformed node is skipped rather than raised on."""
    out: list[dict] = []
    seen: set[str] = set()

    def add(node, cls, field, value, implicit=False):
        if not isinstance(value, str) or not value.strip():
            return
        key = value.strip().lower()
        if key in seen:
            return
        seen.add(key)
        rec = {"node": str(node), "class_type": cls, "field": field,
               "value": value.strip()}
        if implicit:
            rec["implicit"] = True
        out.append(rec)

    if not isinstance(wf, dict):
        return out
    for node_id, node in wf.items():
        if not isinstance(node, dict):
            continue
        cls = str(node.get("class_type") or "")
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            inputs = {}
        for field, v in inputs.items():
            if _is_link(v) or not isinstance(v, str):
                continue
            if v.strip().lower().endswith(MODEL_FILE_EXTS):
                add(node_id, cls, field, v)
            elif (cls, field) in ENUM_MODEL_FIELDS:
                add(node_id, cls, field, v)
                if cls == "IPAdapterUnifiedLoader" and (
                        "PLUS" in v.upper() or "VIT-H" in v.upper()):
                    add(node_id, cls, None, _IPADAPTER_VIT_H, implicit=True)
        if cls in _INSIGHTFACE_LOADERS:
            # `provider` is CPU/CUDA/ROCM, not a model — only a value that the
            # table knows as an implicit weight (e.g. 'buffalo_l') overrides.
            named = next((v for v in inputs.values()
                          if isinstance(v, str)
                          and (lookup(v) or {}).get("implicit")), None)
            add(node_id, cls, None, named or "antelopev2", implicit=True)
        elif cls in _EVA_CLIP_LOADERS:
            add(node_id, cls, None, "EVA02-CLIP-L-14-336", implicit=True)
        elif cls in _PULID_APPLIERS:
            add(node_id, cls, None, "retinaface_resnet50", implicit=True)
            add(node_id, cls, None, "bisenet", implicit=True)
    return out


def worst_of(values) -> str:
    """The most restrictive commercial status in `values` ("clear" if empty).
    Anything outside the known set counts as "unknown"."""
    worst = "clear"
    for v in values:
        v = v if v in _SEVERITY else "unknown"
        if _SEVERITY[v] > _SEVERITY[worst]:
            worst = v
    return worst


def _blueprint_ref(blueprint) -> dict | None:
    if not blueprint:
        return None
    if isinstance(blueprint, str):
        return {"id": blueprint, "graph_sha": ""}
    if isinstance(blueprint, dict):
        meta = blueprint.get("meta") if isinstance(blueprint.get("meta"), dict) else {}
        return {"id": str(blueprint.get("id") or meta.get("id") or ""),
                "graph_sha": str(blueprint.get("graph_sha")
                                 or meta.get("graph_sha") or "")}
    return None


def provenance(wf, *, pipeline, blueprint=None) -> dict:
    """The provenance stamp for one render of `wf`. Never raises.

    `commercial` is the worst of the models' statuses; a model the table does
    not know is "unknown", and a graph in which no model was recognised at all
    is "unknown" too (an empty list proves nothing)."""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    try:
        table = load_licences()
        models = []
        for m in models_in_workflow(wf):
            entry = lookup(m["value"]) or {}
            status = entry.get("commercial")
            rec = {"value": m["value"], "class_type": m["class_type"],
                   "field": m["field"]}
            if m.get("implicit"):
                rec["implicit"] = True
            rec.update({
                "licence_id": entry.get("id"),
                "licence": entry.get("licence", ""),
                "commercial": status if status in _SEVERITY else "unknown",
                "licence_url": entry.get("licence_url", ""),
            })
            models.append(rec)
        overall = (worst_of(r["commercial"] for r in models)
                   if models else "unknown")
        return {
            "version": 1,
            "pipeline": pipeline,
            "blueprint": _blueprint_ref(blueprint),
            "models": models,
            "commercial": overall,
            "blocked_by": [r["value"] for r in models
                           if r["commercial"] == "blocked"],
            "unknown": [r["value"] for r in models
                        if r["commercial"] == "unknown"],
            "licences_checked": table.get("checked"),
            "generated_at": now,
        }
    except Exception as e:  # noqa: BLE001 — provenance must never fail a render
        return {"version": 1, "pipeline": pipeline, "blueprint": None,
                "models": [], "commercial": "unknown", "blocked_by": [],
                "unknown": [], "licences_checked": None, "generated_at": now,
                "error": f"{type(e).__name__}: {e}"}


def summarise(stamps) -> dict:
    """Roll per-region stamps up into one atlas-level verdict:
    `{commercial, blocked_by (sorted unique), regions_unknown, at}`.
    `regions_unknown` counts regions whose OWN verdict is unknown."""
    stamps = [s for s in stamps if isinstance(s, dict)]
    blocked: set[str] = set()
    for s in stamps:
        for v in s.get("blocked_by") or []:
            if isinstance(v, str):
                blocked.add(v)
    return {
        "commercial": (worst_of(s.get("commercial") for s in stamps)
                       if stamps else "unknown"),
        "blocked_by": sorted(blocked),
        "regions_unknown": sum(1 for s in stamps
                               if s.get("commercial") not in
                               ("clear", "conditional", "blocked")),
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def sidecar_name(variant_filename: str) -> str:
    """`H1_00003_.png` -> `H1_00003_.provenance.json`."""
    stem = posixpath.basename(str(variant_filename).replace("\\", "/"))
    if "." in stem:
        stem = stem.rsplit(".", 1)[0]
    return f"{stem}.provenance.json"
