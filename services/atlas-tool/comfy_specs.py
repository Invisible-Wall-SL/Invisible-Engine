"""A ComfyUI node's REAL input contract, read from `/object_info` and normalized.

Why this exists: the Flipbook video mode's "publish a blueprint from a workflow"
importer used to type a param from the value the graph happened to bake in. A
baked `1.0` says "float" and nothing else — not that the node declares 0..1, not
that a neighbouring input is a COMBO over the twelve installed BiRefNet models.
So a published blueprint carried no domain at all, the Settings panel had nothing
to bound its inputs with, and a `sensitivity` of 50 reached the GPU and was
rejected there:

    /prompt rejected (400): node 372 "sensitivity": Value 50.0 bigger than max of 1.0

The node's own declaration is the only place that answer exists, and it is one
GET away. Same reasoning as `ui_server.ADV_RANGES`: an out-of-range value makes
ComfyUI reject the WHOLE prompt, so the UI bounds the input and the server clamps.

Two shapes are served from one normalizer:
  * `specs_for_classes` — what the IMPORTER needs, keyed by class, for a graph it
    is holding client-side and has not published yet;
  * `specs_for_blueprint` — what the Generate PANEL needs, keyed by param key, so
    an already-published blueprint refreshes its dropdowns against whatever the
    pod has installed today without being re-imported.

Both take the TARGET the render will run on (`comfy_catalog.TARGETS`): a contract
must describe the machine that will load the model, and "pod" and "local" are
different installs. Which ComfyUI to ask, the HTTP client and the per-target
catalogs are `comfy_catalog`'s — this module never picks a host itself. Every
COMBO list read live is handed back to the catalog (`remember`), and the target's
catalog is the middle tier when nothing answers: the last list anything saw,
before the caller falls back to what the blueprint was published with. Ranges
have no catalog tier; a number is bounded by what the blueprint recorded, or not
at all.

Everything here is fail-safe by construction. The pod is usually asleep: an
unreachable ComfyUI, an unknown class and a malformed spec are all NORMAL, and
each one means "this input has no known contract" — never an error. The caller
then keeps whatever it already had (the baked options, the value-guessed type).
"""
from __future__ import annotations

import time as _time
from typing import Callable
from urllib.error import HTTPError, URLError

import batch_atlas
import comfy_catalog

# ComfyUI writes a sentinel rather than omitting a limit — `sys.float_info.max`
# on a float, `0xffffffffffffffff` on a seed. Those are "no limit", not a range:
# carrying them through would put a slider across 1.8e19 in front of the author
# and give the clamp a bound that can never bite. Anything this wide is dropped,
# which leaves the param honestly UNBOUNDED. Real limits are far below it
# (MAX_RESOLUTION is 16384, a step count 10000).
_UNBOUNDED = 1e9

# How long one class's spec is trusted in-process. Short, because the point of
# reading live is that a model installed on the pod ten minutes ago shows up.
_TTL = 60.0
# A read that reached nothing is remembered for less: the pod waking up is the
# common case and re-probing it every minute costs one small GET.
_MISS_TTL = 20.0
# The pod is often asleep, and the importer blocks a modal on this. Fail fast.
_TIMEOUT = 6.0

# Keyed by (target, class): the same class is a different contract on a
# different install — a pod's BiRefNet lists the pod's model files.
_cache: dict[tuple[str, str], tuple[float, dict | None]] = {}


def _source(target: str, alive: Callable[[], bool] | None = None) -> str:
    """The ComfyUI whose contracts describe the machine that will RUN the graph
    on `target`, or `""`. The rule is `comfy_catalog._probe_sources`' — "pod" is
    a RunPod pod and never the local tunnel, "local" is the tunnel and nothing
    else — unwrapped to a base URL. Never raises."""
    src = comfy_catalog._probe_sources(comfy_catalog._target(target),
                                       alive or batch_atlas._comfy_alive,
                                       comfy_catalog._http_get_json)
    return src[0] if src else ""


def _num(v, want_int: bool):
    try:
        n = int(round(float(v))) if want_int else float(v)
    except (TypeError, ValueError):
        return None
    return n if abs(n) < _UNBOUNDED else None


def normalize_input(spec) -> dict | None:
    """One `/object_info` input declaration -> the shape a blueprint param speaks.

    ComfyUI's declaration is `[type, opts]` where `type` is either a type NAME
    (`"FLOAT"`, `"INT"`, `"BOOLEAN"`, `"STRING"`) or, for a COMBO, the list of
    values itself. Anything else — `IMAGE`, `MODEL`, `LATENT` — is a wired input
    with no widget behind it, so there is nothing for a param to drive and it is
    left out rather than described as text.
    """
    if not isinstance(spec, (list, tuple)) or not spec:
        return None
    kind = spec[0]
    opts = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
    if isinstance(kind, (list, tuple)):
        values = [str(v) for v in kind if isinstance(v, (str, int, float, bool))]
        if not values:
            return None
        default = opts.get("default")
        return {
            "kind": "select",
            "options": values,
            "default": str(default) if default is not None else values[0],
        }
    name = str(kind).upper()
    if name in ("INT", "FLOAT"):
        want_int = name == "INT"
        out: dict = {"kind": "int" if want_int else "float"}
        for field in ("default", "min", "max", "step"):
            if field in opts:
                n = _num(opts[field], want_int)
                if n is not None:
                    out[field] = n
        return out
    if name == "BOOLEAN":
        return {"kind": "bool", "default": bool(opts.get("default", False))}
    if name == "STRING":
        return {"kind": "text", "multiline": bool(opts.get("multiline", False)),
                "default": str(opts.get("default", ""))}
    return None


def normalize_class(info: dict) -> dict:
    """Every writable input of one class, `{field: spec}`. Covers `optional` as
    well as `required` — a node's interesting knobs are routinely optional, and a
    param can drive either."""
    if not isinstance(info, dict):
        return {}
    inputs = info.get("input")
    if not isinstance(inputs, dict):
        return {}
    out: dict = {}
    for bucket in ("required", "optional"):
        fields = inputs.get(bucket)
        if not isinstance(fields, dict):
            continue
        for field, spec in fields.items():
            norm = normalize_input(spec)
            if norm is not None:
                out[str(field)] = norm
    return out


def _read_class(base: str, cls: str, target: str) -> dict | None:
    """One class's normalized inputs, or None if it could not be read. Cached —
    including the miss, so a wall of unknown classes in a big graph does not turn
    into a wall of timeouts."""
    now = _time.time()
    key = (target, cls)
    hit = _cache.get(key)
    if hit is not None and now - hit[0] < (_TTL if hit[1] else _MISS_TTL):
        return hit[1]
    try:
        info = comfy_catalog._http_get_json(f"{base}/object_info/{cls}",
                                            dict(batch_atlas.CF_HEADERS), _TIMEOUT)
        norm = normalize_class(info.get(cls) if isinstance(info, dict) else None)
    except (HTTPError, URLError, KeyError, ValueError, TypeError,
            ConnectionError, TimeoutError, OSError):
        norm = None
    # A COMBO list seen live is an answer the Settings dropdowns want too.
    for field, spec in (norm or {}).items():
        if spec.get("kind") == "select":
            comfy_catalog.remember(cls, field, spec["options"], target)
    _cache[key] = (now, norm or None)
    return norm or None


def specs_for_classes(classes, *, target: str = "local",
                      source: str | None = None) -> dict:
    """`{class: {field: spec}}` for every class that could be read on `target`.

    A class ComfyUI does not have (a custom node the pod lacks) is simply absent
    from the result — the importer then falls back to guessing from the baked
    value for that node alone, rather than the whole import failing.
    """
    target = comfy_catalog._target(target)
    names = [str(c).strip() for c in (classes or []) if str(c).strip()]
    src = _source(target) if source is None else source
    if not src or not names:
        return {"ok": False, "target": target, "source": src or "", "classes": {},
                "note": _no_source_note(target) if not src else ""}
    out: dict = {}
    for cls in dict.fromkeys(names):
        norm = _read_class(src, cls, target)
        if norm:
            out[cls] = norm
    if out:
        # Content-gated and rate-limited inside: a read that changed no list is
        # not an R2 PUT.
        comfy_catalog.commit_live()
    return {"ok": bool(out), "target": target, "source": src, "classes": out,
            "note": "" if out else
                    f"{src} answered but declared none of these node types."}


def _no_source_note(target: str) -> str:
    """One plain sentence for the modal. Not `comfy_catalog._unreachable_note`,
    which tells the user to press ⟳ — here the remedy is to pick the file again."""
    if target == "pod":
        return ("No RunPod pod is answering, so node contracts could not be read — "
                "start one on the /comfyui page (or pin COMFY_CATALOG_URL) and pick "
                "the file again. Nothing is wrong; the pod is probably asleep.")
    return (f"Your ComfyUI did not answer at {batch_atlas.COMFY_BASE}, so node "
            "contracts could not be read — start ComfyUI and the tunnel, then "
            "pick the file again.")


def param_class_field(param: dict, graph: dict) -> tuple[str, str]:
    """Where a param's live contract lives: `(class_type, field)`, or `("", "")`.

    `options_from` wins because it is an authored statement, and it is the only
    thing that helps when the param drives a `Primitive*` node — the primitive's
    own domain is wide open, so the list the author actually wants belongs to the
    node it feeds. With no declaration, the param's own (node, field) resolved
    through the graph is the answer, which is what lets a blueprint published
    before `options_from` existed refresh anyway.
    """
    src = param.get("options_from")
    if isinstance(src, dict):
        cls = str(src.get("class", "")).strip()
        field = str(src.get("field", "")).strip()
        if cls and field:
            return cls, field
    node = graph.get(str(param.get("node", "")).strip()) if isinstance(graph, dict) else None
    if isinstance(node, dict):
        cls = str(node.get("class_type", "")).strip()
        field = str(param.get("field", "")).strip()
        if cls and field:
            return cls, field
    return "", ""


def specs_for_blueprint(blueprint: dict, *, target: str = "local") -> dict:
    """`{param key: spec}` for one published blueprint's params on `target`.

    This is what makes "install a model on the pod, reopen the blueprint, it is in
    the dropdown" true with no re-import: the blueprint stores the graph, so every
    param's class is resolvable here even when it was published before anything
    recorded one.
    """
    target = comfy_catalog._target(target)
    params = [p for p in (blueprint.get("params") or []) if isinstance(p, dict)]
    graph = blueprint.get("graph") or {}
    wanted = {}
    for p in params:
        cls, field = param_class_field(p, graph)
        if cls:
            wanted[str(p.get("key", ""))] = (cls, field)
    res = specs_for_classes({c for c, _ in wanted.values()}, target=target)
    by_class = res.get("classes") or {}
    out = {}
    for key, (cls, field) in wanted.items():
        spec = (by_class.get(cls) or {}).get(field)
        if spec is None:
            # The middle tier: the target's catalog — the last list anything saw
            # for this input (⟳ caches a blueprint's lists there too). Lists only;
            # a range has no catalog and stays what was published.
            stored = comfy_catalog.stored_options(cls, field, target)
            if stored:
                spec = {"kind": "select", "options": stored}
        if spec:
            out[key] = spec
    return {"ok": bool(out), "target": target, "source": res.get("source", ""),
            "params": out, "note": res.get("note", "")}
