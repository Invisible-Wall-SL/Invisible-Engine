"""
Batch atlas regeneration for Hot Fruits.

Reads tools/atlas_manifest_<atlas>.json, runs each region through the
ComfyUI symbol pipeline via the /prompt API, and assembles the results
onto a single PNG (+ WebP) matching the original atlas dimensions.

PREREQUISITES
    pip install pillow
    ComfyUI must be running on COMFY_HOST (default 127.0.0.1:8188).
    All checkpoints / LoRAs / ControlNets referenced below must be installed.

USAGE
    python tools/batch_atlas.py                       # default manifest, non-rotated only
    python tools/batch_atlas.py --include-rotated     # also rotated regions
    python tools/batch_atlas.py --only h1,h2,w        # subset
    python tools/batch_atlas.py --manifest tools/atlas_manifest_symbols.json
"""

from __future__ import annotations

import argparse
import io
import json
import os
import random
import re
import sys
import time
import uuid
import urllib.parse
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from PIL import Image

SELF = Path(__file__).resolve().parent
CONFIG_PATH = SELF / "atlas_config.json"

_DEFAULTS = {
    "comfy_host": "127.0.0.1:8189",
    "manifest_path": "tools/atlas_manifest_symbolsStatic.json",
    "mockup_image": "hotFruits_MockUp.png",
    "checkpoint": "juggernautXL_ragnarokBy.safetensors",
    "lora": "gameIconInstitute3d_v10.safetensors",
    "lora_strength": 0.85,
    "controlnet": "controlnet-union-sdxl-1.0-promax.safetensors",
    "rmbg_model": "RMBG-2.0",
    "ipadapter_weight": 0.35,
    "ipadapter_weight_type": "style transfer",
    "controlnet_strength": 0.7,
    "controlnet_end_percent": 0.85,
    "ksampler_steps": 35,
    "ksampler_cfg": 8.5,
    "padding_pct": 0.12,
    "shape_ref_fill_pct": 0.75,
    "gen_width": 1024,
    "gen_height": 1024,
    # Which pipeline graph build_workflow emits. "sdxl" = the original
    # checkpoint+LoRA+IPAdapter+ControlNet graph. "flux" = UNet/dual-CLIP/VAE
    # + FluxGuidance + FLUX LoRA + Redux (style ref) + ControlNet.
    "pipeline": "sdxl",
    # ---- FLUX-only settings (ignored when pipeline=sdxl) ----
    # All-in-one FP8 checkpoint (UNet+CLIP+VAE in one file, loaded via
    # CheckpointLoaderSimple). When set it OVERRIDES flux_unet/clip/vae below.
    # Easiest path: Comfy-Org flux1-schnell-fp8 (Apache-2.0, commercial-OK).
    "flux_checkpoint": "",
    "flux_unet": "flux1-dev.safetensors",
    "flux_weight_dtype": "fp8_e4m3fn",
    "flux_clip_t5": "t5xxl_fp16.safetensors",
    "flux_clip_l": "clip_l.safetensors",
    "flux_vae": "ae.safetensors",
    "flux_lora": "",
    "flux_lora_strength": 0.9,
    "flux_guidance": 3.5,
    "flux_steps": 20,
    "flux_sampler": "euler",
    "flux_scheduler": "simple",
    "flux_controlnet": "",
    "flux_redux_style_model": "flux1-redux-dev.safetensors",
    "flux_clip_vision": "sigclip_vision_patch14_384.safetensors",
    "flux_redux_strength": 1.0,
    # ---- GPT-Image-1 settings ----
    # Used by regions whose effective pipeline is "gpt_image" (set globally/
    # per-atlas via the pipeline setting, or per-region in the advanced
    # popup). These regions run through ComfyUI's first-party OpenAIGPTImage1
    # API node: the region's reference image (shape_ref, else style_ref — the
    # same image shown on the card) + its gpt_prompt are sent for an image
    # edit, billed to comfy.org credits (no OpenAI key — the node
    # authenticates through ComfyUI; sign in to comfy.org in ComfyUI once).
    # The IMAGE output goes through SaveImage like every other pipeline, so
    # variants / lock / Create Atlas work unchanged.
    "gpt_image_model": "gpt-image-2",     # gpt-image-1 | gpt-image-1.5 | gpt-image-2
    # "match_ref" (default) = Custom size at the ORIGINAL REFERENCE's aspect
    # ratio so GPT returns the right shape (gpt-image-2 only; older models
    # fall back to 1024x1024). Or a fixed preset: 1024x1024 | 1024x1536 |
    # 1536x1024 | auto | (gpt-image-2 also) 2048x2048 | 2048x1152 | 1152x2048
    # | 3840x2160 | 2160x3840. fit_to_region still does the final exact-slot
    # resize, so this only controls the SHAPE GPT generates in.
    "gpt_image_size": "match_ref",        # match_ref | <preset WxH> | auto
    "gpt_image_quality": "low",           # low | medium | high  (low = cheapest)
    "gpt_image_background": "transparent",  # transparent | auto | opaque
    # gpt-image-2 HARD-rejects background=transparent (and GPT often returns
    # opaque anyway). So, like the SDXL/FLUX graphs, run an RMBG cutout after
    # the GPT node by default. Per-region 'gpt_rembg' (on/off) overrides this
    # (turn OFF for full-frame art you want kept whole, e.g. a logo plate).
    "gpt_image_rembg": True,
    # comfy.org API key for ComfyUI API nodes (OpenAIGPTImage1 etc.). The
    # browser login only authorizes jobs started from the ComfyUI web UI;
    # this tool submits headless /prompt jobs, which carry no session — so a
    # key is required. Generate one in your Comfy account at
    # platform.comfy.org (API Keys). Read from the COMFY_ORG_API_KEY env var
    # first, then this config value (env keeps it out of the repo).
    "comfy_org_api_key": "",
    # UI-only: optional USD->EUR multiplier for the header credits chip
    # (comfy.org reports balance in USD). 0 = show USD only.
    "credits_eur_rate": 0,
}


def load_config() -> dict:
    cfg = dict(_DEFAULTS)
    if CONFIG_PATH.exists():
        try:
            user = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            cfg.update({k: v for k, v in user.items() if not k.startswith("_")})
        except (json.JSONDecodeError, OSError):
            pass
    return cfg


CFG = load_config()

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cloud_paths as project_paths  # noqa: E402
import atlas_format  # noqa: E402
_PP = project_paths.resolve()
COMFY_HOST = _PP["comfy_host"]
BATCH_DIR = _PP["batch_dir"]
ATLAS_DIR = _PP["atlas_dir"]
INPUT_DIR = _PP["input_dir"]
OUTPUT_PREFIX = _PP["output_prefix"]
# Phase 2: ComfyUI's output root is the SHARED workspace, so the
# filename_prefix we hand it must include the per-tool + per-project
# namespace (e.g. "atlas_maker/Borut_Hotfruits/HotFruits/batch/h3") or
# variants land in the wrong project's folder.
COMFY_PREFIX_BASE = _PP["comfy_filename_prefix_base"]

MOCKUP_IMAGE = CFG["mockup_image"]
CHECKPOINT = CFG["checkpoint"]
LORA = CFG["lora"]
LORA_STRENGTH = CFG["lora_strength"]
CONTROLNET = CFG["controlnet"]
RMBG_MODEL = CFG["rmbg_model"]
IPADAPTER_WEIGHT = CFG["ipadapter_weight"]
IPADAPTER_WEIGHT_TYPE = CFG["ipadapter_weight_type"]
CONTROLNET_STRENGTH = CFG["controlnet_strength"]
CONTROLNET_END_PERCENT = CFG["controlnet_end_percent"]
KSAMPLER_STEPS = CFG["ksampler_steps"]
KSAMPLER_CFG = CFG["ksampler_cfg"]
GEN_WIDTH = CFG["gen_width"]
GEN_HEIGHT = CFG["gen_height"]
PADDING_PCT = CFG["padding_pct"]
SHAPE_REF_FILL_PCT = CFG["shape_ref_fill_pct"]
MANIFEST_REL = CFG["manifest_path"]

PIPELINE = CFG["pipeline"]
FLUX_CHECKPOINT = CFG["flux_checkpoint"]
FLUX_UNET = CFG["flux_unet"]
FLUX_WEIGHT_DTYPE = CFG["flux_weight_dtype"]
FLUX_CLIP_T5 = CFG["flux_clip_t5"]
FLUX_CLIP_L = CFG["flux_clip_l"]
FLUX_VAE = CFG["flux_vae"]
FLUX_LORA = CFG["flux_lora"]
FLUX_LORA_STRENGTH = CFG["flux_lora_strength"]
FLUX_GUIDANCE = CFG["flux_guidance"]
FLUX_STEPS = CFG["flux_steps"]
FLUX_SAMPLER = CFG["flux_sampler"]
FLUX_SCHEDULER = CFG["flux_scheduler"]
FLUX_CONTROLNET = CFG["flux_controlnet"]
FLUX_REDUX_STYLE_MODEL = CFG["flux_redux_style_model"]
FLUX_CLIP_VISION = CFG["flux_clip_vision"]
FLUX_REDUX_STRENGTH = CFG["flux_redux_strength"]
GPT_IMAGE_MODEL = CFG["gpt_image_model"]
GPT_IMAGE_SIZE = CFG["gpt_image_size"]
GPT_IMAGE_QUALITY = CFG["gpt_image_quality"]
GPT_IMAGE_BACKGROUND = CFG["gpt_image_background"]
GPT_IMAGE_REMBG = CFG["gpt_image_rembg"]
COMFY_ORG_API_KEY = CFG["comfy_org_api_key"]


def _truthy(v, default: bool) -> bool:
    if v in (None, ""):
        return default
    if isinstance(v, bool):
        return v
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def comfy_org_api_key() -> str:
    return os.environ.get("COMFY_ORG_API_KEY") or str(COMFY_ORG_API_KEY or "")

# Settings that a manifest may override per-atlas via its "settings" block.
# atlas_config.json stays the shared default; manifest["settings"][k], when
# present and non-empty, wins. Maps config key -> module global it drives.
_SETTINGS_GLOBALS = {
    "mockup_image": "MOCKUP_IMAGE",
    "checkpoint": "CHECKPOINT",
    "lora": "LORA",
    "lora_strength": "LORA_STRENGTH",
    "controlnet": "CONTROLNET",
    "rmbg_model": "RMBG_MODEL",
    "ipadapter_weight": "IPADAPTER_WEIGHT",
    "ipadapter_weight_type": "IPADAPTER_WEIGHT_TYPE",
    "controlnet_strength": "CONTROLNET_STRENGTH",
    "controlnet_end_percent": "CONTROLNET_END_PERCENT",
    "ksampler_steps": "KSAMPLER_STEPS",
    "ksampler_cfg": "KSAMPLER_CFG",
    "gen_width": "GEN_WIDTH",
    "gen_height": "GEN_HEIGHT",
    "padding_pct": "PADDING_PCT",
    "shape_ref_fill_pct": "SHAPE_REF_FILL_PCT",
    "pipeline": "PIPELINE",
    "flux_checkpoint": "FLUX_CHECKPOINT",
    "flux_unet": "FLUX_UNET",
    "flux_weight_dtype": "FLUX_WEIGHT_DTYPE",
    "flux_clip_t5": "FLUX_CLIP_T5",
    "flux_clip_l": "FLUX_CLIP_L",
    "flux_vae": "FLUX_VAE",
    "flux_lora": "FLUX_LORA",
    "flux_lora_strength": "FLUX_LORA_STRENGTH",
    "flux_guidance": "FLUX_GUIDANCE",
    "flux_steps": "FLUX_STEPS",
    "flux_sampler": "FLUX_SAMPLER",
    "flux_scheduler": "FLUX_SCHEDULER",
    "flux_controlnet": "FLUX_CONTROLNET",
    "flux_redux_style_model": "FLUX_REDUX_STYLE_MODEL",
    "flux_clip_vision": "FLUX_CLIP_VISION",
    "flux_redux_strength": "FLUX_REDUX_STRENGTH",
    "gpt_image_model": "GPT_IMAGE_MODEL",
    "gpt_image_size": "GPT_IMAGE_SIZE",
    "gpt_image_quality": "GPT_IMAGE_QUALITY",
    "gpt_image_background": "GPT_IMAGE_BACKGROUND",
    "gpt_image_rembg": "GPT_IMAGE_REMBG",
}


def apply_manifest_settings(manifest: dict) -> dict:
    """Overlay manifest['settings'] onto the CFG-derived module globals.
    Empty string / None means 'inherit the global default' (no override).
    Returns the keys actually applied (for logging)."""
    overrides = manifest.get("settings") or {}
    applied = {}
    for key, gname in _SETTINGS_GLOBALS.items():
        if key in overrides and overrides[key] not in ("", None):
            globals()[gname] = overrides[key]
            applied[key] = overrides[key]
    return applied


# Active manifest["atlas"], set in main(). Lets fit_to_region fall back to a
# per-atlas default cell size (atlas.cell_width/cell_height) — and ultimately
# the full atlas — when a region omits its own w/h/x/y. A region with explicit
# geometry is unaffected (back-compat for multi-region atlases).
ATLAS_META: dict = {}


def region_box(region: dict) -> tuple[int, int, int, int]:
    """Resolve a region's (x, y, w, h). Explicit region values win; missing
    w/h fall back to atlas.cell_width/cell_height, then the full atlas size;
    missing x/y default to 0. Enables a single full-atlas image by simply
    omitting geometry on the region."""
    aw = ATLAS_META.get("width")
    ah = ATLAS_META.get("height")
    cw = ATLAS_META.get("cell_width") or aw
    ch = ATLAS_META.get("cell_height") or ah
    w = region.get("w") or cw
    h = region.get("h") or ch
    return int(region.get("x", 0)), int(region.get("y", 0)), int(w), int(h)


# Geometry fields the `.atlas` owns. When an atlas is bound these are taken
# from the `.atlas` and a same-named manifest region may NOT override them —
# the manifest keeps only creative data (prompt, seed, refs, weights, ...).
_GEOM_KEYS = {"x", "y", "w", "h", "rotated", "bounds", "offsets", "rotate",
              "off_x", "off_y", "orig_w", "orig_h"}


def region_trim(region: dict) -> tuple[int, int, int, int]:
    """Spine trim for a region: (off_x, off_y, orig_w, orig_h).

    A Spine/libGDX region is the *tight* (transparent border removed) crop of
    a larger logical attachment of size orig_w x orig_h; the crop's bottom-
    left sits at (off_x, off_y) from the original's bottom-left (Y-up). The
    skeleton is authored against orig_w x orig_h, so faithful reproduction
    must rebuild that logical frame, not just fill the packed rect. Untrimmed
    regions report orig == packed and off == 0 (no-op)."""
    _, _, w, h = region_box(region)
    ow = int(region.get("orig_w") or w)
    oh = int(region.get("orig_h") or h)
    ox = int(region.get("off_x") or 0)
    oy = int(region.get("off_y") or 0)
    return ox, oy, ow, oh


def atlas_file_path(manifest: dict, manifest_path: Path) -> Path | None:
    """Resolve the bound `.atlas` for this manifest, or None for the legacy
    cell-grid path. Either the selected file IS a `.atlas`, or the JSON
    manifest's atlas block names one via `atlas_file` (absolute, or a name
    resolved next to the manifests)."""
    if manifest_path.suffix.lower() == ".atlas":
        return manifest_path
    ref = (manifest.get("atlas") or {}).get("atlas_file")
    if not ref:
        return None
    p = Path(ref)
    if p.is_absolute():
        return p
    return SELF / p.name


def merge_atlas_regions(manifest: dict, atlas_data: dict) -> list[dict]:
    """Geometry comes from the `.atlas`; creative data from the JSON manifest's
    same-named region (matched by `name`). A manifest region with no `.atlas`
    counterpart is ignored; an `.atlas` region with no creative entry still
    renders (empty prompt) so nothing silently disappears."""
    creative = {r["name"]: r for r in (manifest.get("regions") or []) if r.get("name")}
    out: list[dict] = []
    for ar in atlas_data["regions"]:
        merged = {k: v for k, v in creative.get(ar["name"], {}).items()
                  if k not in _GEOM_KEYS}
        merged.update({
            "name": ar["name"],
            "x": ar["x"], "y": ar["y"], "w": ar["w"], "h": ar["h"],
            "rotated": ar["rotated"],
            "off_x": ar.get("off_x", 0), "off_y": ar.get("off_y", 0),
            "orig_w": ar.get("orig_w", ar["w"]),
            "orig_h": ar.get("orig_h", ar["h"]),
        })
        out.append(merged)
    return out


def comfy_post(path: str, payload: dict) -> dict:
    req = Request(
        f"http://{COMFY_HOST}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        return json.loads(urlopen(req).read())
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print("\n=== ComfyUI rejected the prompt ===")
        print(f"HTTP {e.code} {e.reason}")
        print(body)
        print("\n=== Payload sent (first 4 KB) ===")
        print(json.dumps(payload, indent=2)[:4096])
        raise
    except (URLError, ConnectionError) as e:
        print("\n=== Cannot reach ComfyUI ===")
        print(f"No server responding at http://{COMFY_HOST}")
        print(f"Reason: {e}")
        print("Fix: make sure ComfyUI is running on that host:port "
              "(launch it via the Invisible Launcher, then retry).")
        raise SystemExit(2)


import socket as _socket
import time as _time

# Default 5s timeout on every comfy_get HTTP call. Without it, urlopen waits
# for socket.getdefaulttimeout() — usually None on Windows, i.e. forever.
# Any genuine ComfyUI call (LoraLoader lists, /prompt, /history) responds
# in tens of ms when the server is alive; if it doesn't, we'd rather fail
# fast than hang the UI thread.
_COMFY_HTTP_TIMEOUT = 5.0


def comfy_get(path: str) -> dict:
    return json.loads(urlopen(f"http://{COMFY_HOST}{path}",
                              timeout=_COMFY_HTTP_TIMEOUT).read())


# `_available()` is called ~14× when the UI renders the Settings panel
# (one per model-list dropdown). When ComfyUI is DOWN, each urlopen waits
# ~2s for the connect to fail — that's a 28-second page render after every
# Save Settings. Caching the result (and an even-cheaper "is the port
# listening?" probe) keeps the UI snappy whether ComfyUI is running or not.
#
# The probe used to be a bare TCP connect — fine for "is it up?" but it
# missed the trickier failure mode where ComfyUI's port accepts (alive at
# the socket level) but its HTTP handler is hung or slow. In that state
# every _available() urlopen would hang up to _COMFY_HTTP_TIMEOUT, so 14
# cold model-list calls could still stretch to a 15-30 second freeze. The
# probe now does a real HTTP GET with a tight 600ms budget so we only mark
# Comfy "alive" when its HTTP is actually answering.
_AVAIL_TTL = 30.0          # model lists rarely change mid-session
_COMFY_PROBE_TTL = 10.0    # cache the up/down verdict this long
_COMFY_PROBE_HTTP_TIMEOUT = 0.6
_avail_cache: dict[tuple[str, str], tuple[float, list[str] | None]] = {}
_comfy_alive_cache: dict[str, float | bool] = {"t": 0.0, "ok": False}


def _comfy_alive() -> bool:
    """Sub-second probe that ComfyUI is actually answering HTTP — not just
    listening on the port. Result is cached for _COMFY_PROBE_TTL so the UI
    doesn't keep retrying every page render. /system_stats is a known
    cheap endpoint ComfyUI always implements.

    Two-stage: TCP first (instant fail if port closed) then a tight HTTP
    GET (catches the "port open but server hung" case)."""
    now = _time.time()
    if now - float(_comfy_alive_cache["t"]) < _COMFY_PROBE_TTL:
        return bool(_comfy_alive_cache["ok"])
    _comfy_alive_cache["t"] = now
    _comfy_alive_cache["ok"] = False
    try:
        host, port = COMFY_HOST.split(":", 1)
    except ValueError:
        return False
    try:
        with _socket.create_connection((host, int(port)), timeout=0.2):
            pass
    except (OSError, ValueError):
        return False
    try:
        urlopen(f"http://{COMFY_HOST}/system_stats",
                timeout=_COMFY_PROBE_HTTP_TIMEOUT).read()
        _comfy_alive_cache["ok"] = True
    except (HTTPError, URLError, ConnectionError, OSError):
        _comfy_alive_cache["ok"] = False
    return bool(_comfy_alive_cache["ok"])


def _available(node: str, field: str) -> list[str] | None:
    """The list of valid values ComfyUI accepts for node.field (e.g. the
    LoraLoader's lora_name). None if it can't be read (skip the check).

    Cached for _AVAIL_TTL seconds. When ComfyUI is down, returns None
    immediately via the alive-probe instead of waiting up to
    _COMFY_HTTP_TIMEOUT per urlopen."""
    key = (node, field)
    now = _time.time()
    hit = _avail_cache.get(key)
    if hit is not None and now - hit[0] < _AVAIL_TTL:
        return hit[1]
    if not _comfy_alive():
        _avail_cache[key] = (now, None)
        return None
    try:
        info = comfy_get(f"/object_info/{node}")
        opts = info[node]["input"]["required"][field][0]
        val = list(opts) if isinstance(opts, list) else None
    except (HTTPError, URLError, KeyError, ValueError, ConnectionError,
            TimeoutError, OSError):
        val = None
    _avail_cache[key] = (now, val)
    return val


def preflight_models(regions: list[dict]) -> None:
    """Fail early with a readable message (not a raw HTTP 400 traceback) if a
    checkpoint / LoRA name isn't one ComfyUI actually has. ComfyUI only sees
    models present in its shared models dir at startup — a freshly added file
    needs a ComfyUI restart, and the name must match exactly incl. extension."""
    # GPT-Image-1 regions use ComfyUI's OpenAIGPTImage1 API node (comfy.org
    # credits, no local checkpoint/LoRA), so they're irrelevant to the model
    # name checks below — exclude them. Auth/credit errors surface from
    # ComfyUI's own job result if the user isn't signed in to comfy.org.
    regions = [r for r in regions if region_pipeline(r) != "gpt_image"]
    if not regions:
        return  # nothing left needs ComfyUI models

    if str(PIPELINE).lower() == "flux":
        if FLUX_CHECKPOINT:
            # All-in-one checkpoint path: only the single file matters.
            loader_checks = [("CheckpointLoaderSimple", "ckpt_name",
                              "FLUX checkpoint", {FLUX_CHECKPOINT})]
        else:
            loader_checks = [
                ("UNETLoader", "unet_name", "FLUX UNet", {FLUX_UNET}),
                ("DualCLIPLoader", "clip_name1", "FLUX CLIP (T5)",
                 {FLUX_CLIP_T5}),
                ("DualCLIPLoader", "clip_name2", "FLUX CLIP (L)",
                 {FLUX_CLIP_L}),
                ("VAELoader", "vae_name", "FLUX VAE", {FLUX_VAE}),
            ]
        checks = loader_checks + [
            ("LoraLoaderModelOnly", "lora_name", "FLUX LoRA",
             {FLUX_LORA} if FLUX_LORA else set()),
            ("StyleModelLoader", "style_model_name", "FLUX Redux model",
             {FLUX_REDUX_STYLE_MODEL} if FLUX_REDUX_STYLE_MODEL else set()),
            ("CLIPVisionLoader", "clip_name", "FLUX CLIP-Vision",
             {FLUX_CLIP_VISION} if FLUX_REDUX_STYLE_MODEL else set()),
            ("ControlNetLoader", "control_net_name", "FLUX ControlNet",
             {FLUX_CONTROLNET} if FLUX_CONTROLNET else set()),
        ]
    else:
        checks = [
            ("CheckpointLoaderSimple", "ckpt_name", "checkpoint",
             {region.get("checkpoint", CHECKPOINT) for region in regions}),
            ("LoraLoader", "lora_name", "LoRA", {LORA}),
        ]
    problems: list[str] = []
    for node, field, label, wanted in checks:
        avail = _available(node, field)
        if avail is None:
            continue  # couldn't query — let ComfyUI be the judge
        for name in sorted(w for w in wanted if w):
            if name not in avail:
                shown = "\n      ".join(avail[:25]) or "(none installed)"
                more = f"\n      … (+{len(avail) - 25} more)" if len(avail) > 25 else ""
                problems.append(
                    f"  {label} '{name}' is not available in ComfyUI.\n"
                    f"    ComfyUI currently lists:\n      {shown}{more}\n"
                    f"    Fix: put the file in the SHARED models dir ComfyUI "
                    f"scans (same folder as the listed ones), use the EXACT "
                    f"filename incl. extension, then restart ComfyUI via the "
                    f"Invisible Launcher (it only scans at startup). Note SDXL "
                    f"and FLUX models are not interchangeable.")
    if problems:
        print("\n=== Model preflight failed ===")
        print("\n".join(problems))
        raise SystemExit(2)


def comfy_view(filename: str, subfolder: str, type_: str) -> bytes:
    qs = urllib.parse.urlencode(
        {"filename": filename, "subfolder": subfolder, "type": type_}
    )
    return urlopen(f"http://{COMFY_HOST}/view?{qs}").read()


def normalize_shape_ref(shape_ref_relpath: str) -> str:
    """Open the shape_ref PNG, find its non-black content bbox, and rebuild
    a 1024x1024 black canvas with the content centered at SHAPE_REF_FILL_PCT
    coverage. Saves to refs/_normalized/<name>.png and returns the new
    relative path for ComfyUI. Ensures every shape ref has consistent margin
    regardless of how the user painted it."""
    src_path = INPUT_DIR / shape_ref_relpath
    if not src_path.exists():
        return shape_ref_relpath  # let ComfyUI report the missing-file error

    src = Image.open(src_path).convert("L")  # grayscale
    # Bbox of non-black pixels (threshold 10 to ignore JPEG artifacts)
    threshold = src.point(lambda p: 255 if p > 10 else 0)
    bbox = threshold.getbbox()
    if not bbox:
        return shape_ref_relpath

    cropped = src.crop(bbox)
    target_size = 1024
    target_fill = int(target_size * SHAPE_REF_FILL_PCT)
    src_w, src_h = cropped.size
    scale = min(target_fill / src_w, target_fill / src_h)
    new_w = max(1, int(round(src_w * scale)))
    new_h = max(1, int(round(src_h * scale)))
    resized = cropped.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new("L", (target_size, target_size), 0)
    canvas.paste(resized, ((target_size - new_w) // 2, (target_size - new_h) // 2))

    out_relpath = f"refs/_normalized/{Path(shape_ref_relpath).stem}.png"
    out_path = INPUT_DIR / out_relpath
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out_path)
    return out_relpath


def _resolve_text(region: dict, style: dict) -> tuple[str, str, int]:
    """Shared positive/negative/seed resolution for both pipeline builders."""
    r_pos = str(region.get("prompt", "")).strip()
    if region.get("positive_replace"):
        prompt = r_pos
    else:
        parts = [str(style.get("positive_prefix", "")).strip(), r_pos,
                 str(style.get("positive_suffix", "")).strip()]
        prompt = ", ".join(p for p in parts if p)
    g_neg = style.get("negative", "")
    r_neg = str(region.get("negative", "")).strip()
    if r_neg and region.get("negative_replace"):
        negative = r_neg
    elif g_neg and r_neg:
        negative = f"{g_neg}, {r_neg}"
    else:
        negative = r_neg or g_neg
    seed = region.get("seed", random.randint(0, 2**31 - 1))
    return prompt, negative, seed


def region_pipeline(region: dict) -> str:
    """Effective pipeline for one region: its own 'pipeline' override (set in
    the advanced popup) if present, else the global/per-atlas PIPELINE.
    One of 'sdxl', 'flux', 'gpt_image'."""
    rp = str(region.get("pipeline", "")).strip().lower()
    return rp or str(PIPELINE).lower()


def gpt_reference_image(region: dict) -> str | None:
    """ComfyUI LoadImage path for the image GPT-Image-1 edits — the SAME
    reference the card shows: a painted shape_ref wins, else the style_ref /
    atlas slice. Returned as-is for LoadImage (a path relative to the ComfyUI
    input dir, or absolute). None if the region has no usable reference."""
    for key in ("shape_ref", "style_ref"):
        ref = region.get(key)
        if not ref:
            continue
        p = Path(ref) if Path(ref).is_absolute() else INPUT_DIR / ref
        if p.exists():
            return ref
    return None


# Preset size strings the OpenAIGPTImage1 node accepts verbatim (gpt-image-2
# adds the 2K/4K ones; gpt-image-1/1.5 only the first four). Anything NOT in
# here and not "Custom" is treated as a request to match the reference ratio.
_GPT_PRESET_SIZES = {
    "auto", "1024x1024", "1024x1536", "1536x1024",
    "2048x2048", "2048x1152", "1152x2048", "3840x2160", "2160x3840",
}
# Sentinels (or empty) meaning "generate at the original reference's aspect".
_GPT_MATCH_REF = {"", "match_ref", "match", "reference", "ref", "auto_ref"}


def _gpt_custom_dims(w: int, h: int) -> tuple[int, int]:
    """Clamp an arbitrary (w, h) to what OpenAIGPTImage1's Custom size allows
    for gpt-image-2: each edge multiple of 16 in [1024, 3840], aspect ratio
    <= 3:1, total pixels in [655_360, 8_294_400]. Keeps the reference aspect
    as closely as the rounding/cap permits; fit_to_region does the final
    exact-slot resize, so this only has to preserve the SHAPE, not the size."""
    w = max(1, int(w))
    h = max(1, int(h))
    ratio = max(w, h) / min(w, h)
    if ratio > 3.0:  # node hard-rejects > 3:1 — cap the long edge
        if w >= h:
            w = h * 3
        else:
            h = w * 3
    # Scale so the SHORT edge sits at the 1024 floor, then round to /16 and
    # clamp both edges to [1024, 3840]. With short~1024 and ratio<=3 the long
    # edge is <=3072 and total pixels stay inside the node's budget.
    scale = 1024.0 / min(w, h)

    def q(v: float) -> int:
        return int(max(1024, min(3840, round(v / 16.0) * 16)))

    cw, ch = q(w * scale), q(h * scale)
    if max(cw, ch) / min(cw, ch) > 3.0:  # rounding may have nudged it over
        if cw >= ch:
            cw = q(ch * 3)
        else:
            ch = q(cw * 3)
    return cw, ch


def _gpt_ref_dims(ref: str, region: dict) -> tuple[int, int]:
    """Pixel dimensions of the region's original reference image (what GPT
    edits), falling back to the region's authored slot box if it can't be
    read. This is the aspect the user wants the generation to come back in."""
    try:
        p = Path(ref) if Path(ref).is_absolute() else INPUT_DIR / ref
        with Image.open(p) as im:
            return im.size
    except (OSError, ValueError):
        _, _, w, h = region_box(region)
        return int(w), int(h)


def build_workflow_gpt(region: dict, style: dict) -> dict:
    """GPT-Image (default gpt-image-2) via ComfyUI's first-party API node
    (OpenAIGPTImage1).

    LoadImage(reference) -> OpenAIGPTImage1(prompt + image edit) -> SaveImage.
    Runs on comfy.org credits (the node authenticates itself through ComfyUI;
    no OpenAI key here), so it reuses the exact same /prompt post + poll +
    SaveImage->variant flow as the SDXL/FLUX pipelines. The save node id is
    "17" so run_region's existing output lookup is unchanged.

    Default size is "match_ref": a Custom size at the original reference's
    aspect ratio (gpt-image-2 only) so the result comes back the right shape
    instead of a square. gpt-image-2 forbids background=transparent, so the
    cutout is done by the RMBG pass instead (same as the local pipelines)."""
    name = region.get("name", "?")
    ref = gpt_reference_image(region)
    if ref is None:
        print(f"\n=== {name}: no reference image for GPT-Image-1 ===")
        print("Set a shape ref or style ref (or slice the atlas) first — "
              "GPT-Image-1 edits that image.")
        raise SystemExit(2)
    prompt = str(region.get("gpt_prompt", "")).strip()
    if not prompt:
        print(f"\n=== {name}: gpt_prompt is empty ===")
        print("Open the region's advanced popup and enter a GPT instruction "
              '(e.g. "make the skin look like a watermelon").')
        raise SystemExit(2)

    model = str(region.get("gpt_image_model")
                or GPT_IMAGE_MODEL or "gpt-image-2")

    rembg = _truthy(region.get("gpt_rembg"), bool(GPT_IMAGE_REMBG))
    background = str(region.get("gpt_image_background")
                     or GPT_IMAGE_BACKGROUND or "transparent")
    if model == "gpt-image-2" and background == "transparent":
        # gpt-image-2 HARD-rejects background=transparent (ValueError in the
        # node). It is the default here, so force opaque and let the RMBG
        # pass below make the alpha cutout (same as the rembg branch). Without
        # this every gpt-image-2 render would fail before the API call.
        background = "opaque"
        rembg = _truthy(region.get("gpt_rembg"), True)
    elif rembg and background == "transparent":
        # GPT 'transparent' emits an RGBA image; the RMBG node only accepts
        # RGB (3-channel) and dies with a 4-vs-3 tensor mismatch. RMBG makes
        # the cutout anyway, so feed it an opaque RGB image.
        background = "opaque"

    gpt_inputs = {
        "prompt": prompt,
        "image": ["3", 0],
        "model": model,
        "quality": str(region.get("gpt_image_quality")
                       or GPT_IMAGE_QUALITY or "low"),
        "background": background,
        "n": 1,
        # Random per-render seed. The node's seed doesn't steer the API
        # output, but it changes the prompt's cache key so ComfyUI actually
        # RE-EXECUTES the node every render. Without this, an identical
        # workflow is served from ComfyUI's execution cache: no API call, no
        # charge — and no new image (the "nothing happens / not charged" bug).
        "seed": random.randint(0, 2**31 - 1),
    }
    # Size resolution:
    #   - an explicit preset string ("1536x1024", "auto", …)  -> sent as-is
    #   - "WxH" the user typed                                 -> sent as-is
    #   - blank / "match_ref" (the new default)                -> Custom size
    #     matching the ORIGINAL REFERENCE's aspect ratio so GPT returns the
    #     right shape instead of a forced square that fit_to_region then has
    #     to crop/squash. Custom requires gpt-image-2; older models fall back
    #     to the cheapest square.
    size_cfg = str(region.get("gpt_image_size") or GPT_IMAGE_SIZE or "").strip()
    if size_cfg in _GPT_PRESET_SIZES or size_cfg == "Custom":
        gpt_inputs["size"] = size_cfg
    elif size_cfg.lower() in _GPT_MATCH_REF:
        if model == "gpt-image-2":
            cw, ch = _gpt_custom_dims(*_gpt_ref_dims(ref, region))
            gpt_inputs["size"] = "Custom"
            gpt_inputs["custom_width"] = cw
            gpt_inputs["custom_height"] = ch
        else:
            gpt_inputs["size"] = "1024x1024"
    else:
        gpt_inputs["size"] = size_cfg  # pass through (e.g. a literal "WxH")

    _size_log = (f"{gpt_inputs.get('custom_width')}x"
                 f"{gpt_inputs.get('custom_height')} (ref-aspect)"
                 if gpt_inputs.get("size") == "Custom"
                 else gpt_inputs.get("size"))
    print(f"   GPT-Image ({gpt_inputs['model']}, {gpt_inputs['quality']}, "
          f"size={_size_log}, bg={gpt_inputs['background']}, "
          f"rembg={'on' if rembg else 'off'}) "
          f"editing {ref} — \"{prompt[:80]}\"", flush=True)

    wf = {
        "3": {"class_type": "LoadImage", "inputs": {"image": ref}},
        "15": {"class_type": "OpenAIGPTImage1", "inputs": gpt_inputs},
        "17": {
            "class_type": "SaveImage",
            "inputs": {
                "images": ["15", 0],
                "filename_prefix": f"{COMFY_PREFIX_BASE}/batch/{name}",
            },
        },
    }
    if rembg:
        # GPT returns a 4-channel (RGBA) tensor even with bg=opaque; the RMBG
        # node only accepts 3-channel RGB ("tensor a (4) must match b (3)").
        # 'Images to RGB' flattens it first, then RMBG cuts the background
        # (same model the SDXL/FLUX graphs use) so the tile composes w/ alpha.
        wf["18"] = {
            "class_type": "Images to RGB",
            "inputs": {"images": ["15", 0]},
        }
        wf["16"] = {
            "class_type": "RMBG",
            "inputs": {
                "image": ["18", 0],
                "model": RMBG_MODEL,
                "sensitivity": 1.0,
                "process_res": 1024,
                "mask_blur": 0,
                "mask_offset": 0,
                "invert_output": False,
                "background": "Alpha",
            },
        }
        wf["17"]["inputs"]["images"] = ["16", 0]
    return wf


def build_workflow(region: dict, style: dict, atlas_path: str) -> dict:
    pipe = region_pipeline(region)
    if pipe == "gpt_image":
        return build_workflow_gpt(region, style)
    if pipe == "flux":
        return build_workflow_flux(region, style, atlas_path)
    # Atlas-bound regions come from the .atlas with no creative entry yet, so
    # 'prompt' may be absent — treat missing/empty as "no region prompt".
    r_pos = str(region.get("prompt", "")).strip()
    if region.get("positive_replace"):
        prompt = r_pos                           # checkbox: ignore prefix/suffix
    else:
        parts = [str(style.get("positive_prefix", "")).strip(), r_pos,
                 str(style.get("positive_suffix", "")).strip()]
        prompt = ", ".join(p for p in parts if p)
    # Negative: global style negative, with the optional per-region negative
    # appended so the two form one combined prompt. Blank region negative =>
    # global only (lets us A/B global-only vs global+region per symbol).
    g_neg = style.get("negative", "")
    r_neg = str(region.get("negative", "")).strip()
    if r_neg and region.get("negative_replace"):
        negative = r_neg                       # checkbox: region replaces global
    elif g_neg and r_neg:
        negative = f"{g_neg}, {r_neg}"         # default: append region to global
    else:
        negative = r_neg or g_neg              # only one present
    # Seed: random per run unless region locks one with "seed" field.
    seed = region.get("seed", random.randint(0, 2**31 - 1))

    raw_shape_ref = region.get("shape_ref")
    shape_ref = normalize_shape_ref(raw_shape_ref) if raw_shape_ref else None
    try:
        cn_strength = float(region.get("controlnet_strength",
                                       CONTROLNET_STRENGTH))
    except (TypeError, ValueError):
        cn_strength = float(CONTROLNET_STRENGTH)
    cn_end = region.get("controlnet_end_percent", CONTROLNET_END_PERCENT)
    # strength 0 => fully bypass ControlNet (no model load / Canny pass).
    use_cn = bool(shape_ref) and cn_strength > 0

    if use_cn:
        positive_link = ["9", 0]
        negative_link = ["9", 1]
    else:
        positive_link = ["10", 0]
        negative_link = ["11", 0]

    # IPAdapterAdvanced only accepts weight in [-1, 5]; an out-of-range value
    # makes ComfyUI reject the whole prompt (HTTP 400). Clamp + warn instead.
    ipa_weight = float(region.get("ipadapter_weight", IPADAPTER_WEIGHT))
    if not -1.0 <= ipa_weight <= 5.0:
        clamped = max(-1.0, min(5.0, ipa_weight))
        print(f"  ! ipadapter_weight {ipa_weight} for region "
              f"'{region.get('name', '?')}' is out of range [-1, 5]; "
              f"clamped to {clamped}", flush=True)
        ipa_weight = clamped

    wf: dict = {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": region.get("checkpoint", CHECKPOINT)},
        },
        "2": {
            "class_type": "LoraLoader",
            "inputs": {
                "model": ["1", 0],
                "clip": ["1", 1],
                "lora_name": LORA,
                "strength_model": LORA_STRENGTH,
                "strength_clip": LORA_STRENGTH,
            },
        },
        "3": {"class_type": "LoadImage", "inputs": {"image": region.get("style_ref", MOCKUP_IMAGE)}},
        "12": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": GEN_WIDTH, "height": GEN_HEIGHT, "batch_size": 1},
        },
        "5": {
            "class_type": "IPAdapterUnifiedLoader",
            "inputs": {"model": ["2", 0], "preset": "PLUS (high strength)"},
        },
        "6": {
            "class_type": "IPAdapterAdvanced",
            "inputs": {
                "model": ["5", 0],
                "ipadapter": ["5", 1],
                "image": ["3", 0],
                "weight": ipa_weight,
                "weight_type": IPADAPTER_WEIGHT_TYPE,
                "combine_embeds": "concat",
                "start_at": 0.0,
                "end_at": 1.0,
                "embeds_scaling": "V only",
            },
        },
        "10": {
            "class_type": "CLIPTextEncode",
            "inputs": {"clip": ["2", 1], "text": prompt},
        },
        "11": {
            "class_type": "CLIPTextEncode",
            "inputs": {"clip": ["2", 1], "text": negative},
        },
        "13": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["6", 0],
                "positive": positive_link,
                "negative": negative_link,
                "latent_image": ["12", 0],
                "seed": seed,
                "steps": KSAMPLER_STEPS,
                "cfg": KSAMPLER_CFG,
                "sampler_name": "dpmpp_2m",
                "scheduler": "karras",
                "denoise": 1.0,
            },
        },
        "14": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["13", 0], "vae": ["1", 2]},
        },
        "16": {
            "class_type": "RMBG",
            "inputs": {
                "image": ["14", 0],
                "model": RMBG_MODEL,
                "sensitivity": 1.0,
                "process_res": 1024,
                "mask_blur": 0,
                "mask_offset": 0,
                "invert_output": False,
                "background": "Alpha",
            },
        },
        "17": {
            "class_type": "SaveImage",
            "inputs": {
                "images": ["16", 0],
                "filename_prefix": f"{COMFY_PREFIX_BASE}/batch/{region['name']}",
            },
        },
    }

    if use_cn:
        wf["4"] = {"class_type": "LoadImage", "inputs": {"image": shape_ref}}
        wf["7"] = {
            "class_type": "CannyEdgePreprocessor",
            "inputs": {
                "image": ["4", 0],
                "low_threshold": 100,
                "high_threshold": 200,
                "resolution": 1024,
            },
        }
        wf["8"] = {
            "class_type": "ControlNetLoader",
            "inputs": {"control_net_name": CONTROLNET},
        }
        wf["9"] = {
            "class_type": "ControlNetApplyAdvanced",
            "inputs": {
                "positive": ["10", 0],
                "negative": ["11", 0],
                "control_net": ["8", 0],
                "image": ["7", 0],
                "strength": cn_strength,
                "start_percent": 0.0,
                "end_percent": cn_end,
            },
        }

    return wf


def build_workflow_flux(region: dict, style: dict, atlas_path: str) -> dict:
    """FLUX(.dev) + Redux graph — the FLUX analogue of the SDXL builder.

    UNet/dual-CLIP/VAE loaders -> optional FLUX LoRA -> CLIP text -> optional
    Redux (the FLUX stand-in for IPAdapter style transfer: encodes the
    style_ref / atlas slice through CLIP-Vision and applies it to the
    conditioning) -> optional ControlNet from the Canny shape_ref ->
    FluxGuidance -> KSampler (cfg 1.0) -> VAE decode -> RMBG cutout -> save.

    UNVERIFIED: written to canonical ComfyUI FLUX/Redux node wiring but not
    run here (no GPU). Node/model names depend on what's installed; the
    preflight + ComfyUI's own validation will flag mismatches with a clear
    message rather than a silent bad image.
    """
    prompt, _negative, seed = _resolve_text(region, style)

    raw_shape_ref = region.get("shape_ref")
    shape_ref = normalize_shape_ref(raw_shape_ref) if raw_shape_ref else None
    try:
        cn_strength = float(region.get("controlnet_strength",
                                       CONTROLNET_STRENGTH))
    except (TypeError, ValueError):
        cn_strength = float(CONTROLNET_STRENGTH)
    cn_end = region.get("controlnet_end_percent", CONTROLNET_END_PERCENT)
    # strength 0 => fully bypass ControlNet (don't load the model / run Canny),
    # consistent with LoRA/Redux at 0.
    use_cn = bool(shape_ref) and bool(FLUX_CONTROLNET) and cn_strength > 0
    style_ref = region.get("style_ref") or (MOCKUP_IMAGE if MOCKUP_IMAGE else None)
    # Per-region Redux strength: how hard the reference image steers the
    # result. 0 = Redux OFF for this region (prompt fully controls; the busy
    # original art stops being copied back). Blank/absent inherits the global
    # flux_redux_strength. This is the main lever for "I want just the number".
    try:
        redux_strength = float(region.get("redux_strength", FLUX_REDUX_STRENGTH))
    except (TypeError, ValueError):
        redux_strength = float(FLUX_REDUX_STRENGTH)
    use_redux = (bool(style_ref) and bool(FLUX_REDUX_STYLE_MODEL)
                 and redux_strength > 0)

    # Two ways to load FLUX: a single all-in-one FP8 checkpoint (easiest —
    # CheckpointLoaderSimple gives MODEL/CLIP/VAE in one), or the split
    # UNet + dual-CLIP + VAE loaders. flux_checkpoint, when set, wins.
    if FLUX_CHECKPOINT:
        wf: dict = {
            "1": {"class_type": "CheckpointLoaderSimple",
                  "inputs": {"ckpt_name": FLUX_CHECKPOINT}},
        }
        model_base = ["1", 0]
        clip_ref = ["1", 1]
        vae_ref = ["1", 2]
    else:
        wf = {
            "1": {"class_type": "UNETLoader",
                  "inputs": {"unet_name": FLUX_UNET,
                             "weight_dtype": FLUX_WEIGHT_DTYPE}},
            "2": {"class_type": "DualCLIPLoader",
                  "inputs": {"clip_name1": FLUX_CLIP_T5,
                             "clip_name2": FLUX_CLIP_L, "type": "flux"}},
            "3": {"class_type": "VAELoader",
                  "inputs": {"vae_name": FLUX_VAE}},
        }
        model_base = ["1", 0]
        clip_ref = ["2", 0]
        vae_ref = ["3", 0]

    wf["12"] = {
        "class_type": "EmptySD3LatentImage",
        "inputs": {"width": GEN_WIDTH, "height": GEN_HEIGHT,
                   "batch_size": 1},
    }
    wf["10"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"clip": clip_ref, "text": prompt},
    }
    wf["11"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"clip": clip_ref, "text": ""},  # FLUX: empty negative
    }

    # Optional FLUX LoRA (model-only — FLUX LoRAs don't touch CLIP).
    # Per-region strength: blank/absent inherits the global; 0 = LoRA OFF
    # for this region (e.g. drop a decorative Y2K LoRA on one symbol).
    try:
        lora_strength = float(region.get("flux_lora_strength",
                                         FLUX_LORA_STRENGTH))
    except (TypeError, ValueError):
        lora_strength = float(FLUX_LORA_STRENGTH)
    model_src = model_base
    if FLUX_LORA and lora_strength != 0:
        wf["4"] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {"model": model_base, "lora_name": FLUX_LORA,
                       "strength_model": lora_strength},
        }
        model_src = ["4", 0]

    pos_cond = ["10", 0]
    neg_cond = ["11", 0]

    # Redux: original element as a style reference (IPAdapter's FLUX analogue).
    if use_redux:
        wf["20"] = {
            "class_type": "StyleModelLoader",
            "inputs": {"style_model_name": FLUX_REDUX_STYLE_MODEL},
        }
        wf["21"] = {
            "class_type": "CLIPVisionLoader",
            "inputs": {"clip_name": FLUX_CLIP_VISION},
        }
        wf["22"] = {"class_type": "LoadImage", "inputs": {"image": style_ref}}
        wf["23"] = {
            "class_type": "CLIPVisionEncode",
            "inputs": {"clip_vision": ["21", 0], "image": ["22", 0],
                       "crop": "center"},
        }
        wf["24"] = {
            "class_type": "StyleModelApply",
            "inputs": {
                "conditioning": pos_cond,
                "style_model": ["20", 0],
                "clip_vision_output": ["23", 0],
                "strength": redux_strength,
                "strength_type": "multiply",
            },
        }
        pos_cond = ["24", 0]

    # Optional ControlNet from the Canny shape_ref (holds the silhouette).
    if use_cn:
        wf["30"] = {"class_type": "LoadImage", "inputs": {"image": shape_ref}}
        wf["31"] = {
            "class_type": "CannyEdgePreprocessor",
            "inputs": {"image": ["30", 0], "low_threshold": 100,
                       "high_threshold": 200, "resolution": 1024},
        }
        wf["32"] = {
            "class_type": "ControlNetLoader",
            "inputs": {"control_net_name": FLUX_CONTROLNET},
        }
        wf["33"] = {
            "class_type": "ControlNetApplyAdvanced",
            "inputs": {
                "positive": pos_cond, "negative": neg_cond,
                "control_net": ["32", 0], "image": ["31", 0],
                "strength": cn_strength, "start_percent": 0.0,
                "end_percent": cn_end,
            },
        }
        pos_cond, neg_cond = ["33", 0], ["33", 1]

    wf["40"] = {
        "class_type": "FluxGuidance",
        "inputs": {"conditioning": pos_cond, "guidance": float(FLUX_GUIDANCE)},
    }
    wf["13"] = {
        "class_type": "KSampler",
        "inputs": {
            "model": model_src,
            "positive": ["40", 0],
            "negative": neg_cond,
            "latent_image": ["12", 0],
            "seed": seed,
            "steps": int(FLUX_STEPS),
            "cfg": 1.0,  # FLUX dev is guidance-distilled; CFG stays 1.0
            "sampler_name": FLUX_SAMPLER,
            "scheduler": FLUX_SCHEDULER,
            "denoise": 1.0,
        },
    }
    wf["14"] = {
        "class_type": "VAEDecode",
        "inputs": {"samples": ["13", 0], "vae": vae_ref},
    }
    wf["16"] = {
        "class_type": "RMBG",
        "inputs": {
            "image": ["14", 0], "model": RMBG_MODEL, "sensitivity": 1.0,
            "process_res": 1024, "mask_blur": 0, "mask_offset": 0,
            "invert_output": False, "background": "Alpha",
        },
    }
    wf["17"] = {
        "class_type": "SaveImage",
        "inputs": {"images": ["16", 0],
                   "filename_prefix": f"{COMFY_PREFIX_BASE}/batch/{region['name']}"},
    }
    return wf


def run_region(region: dict, style: dict, atlas_path: str, client_id: str) -> Image.Image:
    wf = build_workflow(region, style, atlas_path)
    payload = {"prompt": wf, "client_id": client_id}
    # API nodes (OpenAIGPTImage1, …) authenticate via the comfy.org key in
    # extra_data — the browser login doesn't apply to headless /prompt jobs.
    # Harmless to send for non-API workflows, so always include when set.
    key = comfy_org_api_key()
    if key:
        payload["extra_data"] = {"api_key_comfy_org": key}
    resp = comfy_post("/prompt", payload)
    pid = resp["prompt_id"]

    deadline = time.time() + 1200  # 20 min cap — first run downloads can be slow
    started = time.time()
    last_tick = started
    while time.time() < deadline:
        time.sleep(2.0)
        now = time.time()
        if now - last_tick >= 15:
            print(f"   ... still waiting ({int(now - started)}s elapsed, check ComfyUI console for progress)")
            last_tick = now
        hist = comfy_get(f"/history/{pid}")
        entry = hist.get(pid)
        if entry:
            # Fail fast on a ComfyUI execution error instead of polling until
            # the 20-min timeout (e.g. an API node erroring "Please login
            # first", a bad model, an OOM). Surface the node + message.
            status = entry.get("status") or {}
            if status.get("status_str") == "error":
                msg = node = None
                for m in status.get("messages", []):
                    if m and m[0] == "execution_error":
                        info = m[1] or {}
                        node = info.get("node_type") or info.get("node_id")
                        msg = (info.get("exception_message") or "").strip()
                        break
                hint = ""
                ml = (msg or "").lower()
                if msg and ("login" in ml or "unauthor" in ml):
                    hint = ("\n   Fix: the ComfyUI browser login does NOT "
                            "apply to this tool's headless jobs. Generate a "
                            "comfy.org API key (platform.comfy.org -> API "
                            "Keys) and set it as 'comfy.org API key' in "
                            "Settings (or the COMFY_ORG_API_KEY env var). "
                            "No credits were charged.")
                elif msg and ("payment required" in ml
                              or "add credits" in ml
                              or "insufficient" in ml
                              or "quota" in ml):
                    hint = ("\n   Fix: the paid image API (e.g. OpenAI "
                            "GPT-Image) for this node has no credit balance. "
                            "Either top up that account, or switch region "
                            f"'{region['name']}' off the paid pipeline "
                            "(set its manifest 'pipeline' to sdxl/flux to "
                            "render locally for free). No credits were "
                            "charged for this attempt.")
                raise RuntimeError(
                    f"ComfyUI failed on region '{region['name']}' at node "
                    f"{node}: {msg or 'unknown error'}{hint}")
            saves = entry.get("outputs", {}).get("17", {}).get("images", [])
            if saves:
                meta = saves[0]
                blob = comfy_view(meta["filename"], meta["subfolder"], meta["type"])
                return Image.open(io.BytesIO(blob)).convert("RGBA")
    raise TimeoutError(f"Region {region['name']} timed out after 20 min")


# PADDING_PCT and SHAPE_REF_FILL_PCT are loaded from atlas_config.json at top.


def fit_to_region(img: Image.Image, region: dict) -> Image.Image:
    """Place the regenerated element into its packed slot.

    The element is cropped to its ALPHA content (Spine only ever renders the
    alpha channel — using the RGBA bbox here wrongly kept the webp page's
    colored-but-transparent gutter, which then got letterbox-inset and made
    trimmed elements render small in-game).

    For a Spine/.atlas slot the packed (w, h) IS the element's authored
    footprint (true for EVERY region, trimmed or not — `helmet` is untrimmed
    but still occupies an exact 360x198 slot the rig expects filled), and the
    game's `.atlas` is never rewritten, so the faithful reproduction is to
    fill the slot exactly — NOT letterbox to preserve the new art's own
    aspect (that shrinks the element in-game). Only true legacy cell-grid
    projects (manifest regions with no bound `.atlas`, hence no orig_*
    geometry) keep the old aspect-pad behaviour so they don't regress.
    """
    # target is the region's UNROTATED size (w, h). For a rotated region we
    # fit the upright art to (w, h) and rotate(+90) at the very end so it
    # lands as the (h x w) packed footprint the .atlas expects.
    _, _, target_w, target_h = region_box(region)
    # Atlas-bound iff merge_atlas_regions stamped the .atlas trim geometry on
    # it. Trimmed vs untrimmed is irrelevant — any .atlas slot must be filled.
    spine_slot = "orig_w" in region and "orig_h" in region

    if img.mode != "RGBA":
        img = img.convert("RGBA")

    # 1) Crop to actual visible content — ALPHA bbox, not RGBA.
    alpha_bbox = img.getchannel("A").getbbox()
    if alpha_bbox:
        img = img.crop(alpha_bbox)

    # 2) Uniform padding (floor 0, so padding_pct = 0 is edge-to-edge).
    pad_w = max(0, int(round(img.width * PADDING_PCT)))
    pad_h = max(0, int(round(img.height * PADDING_PCT)))
    if pad_w or pad_h:
        padded = Image.new(
            "RGBA", (img.width + 2 * pad_w, img.height + 2 * pad_h), (0, 0, 0, 0))
        padded.paste(img, (pad_w, pad_h), img)
        img = padded

    # How the element maps into the slot. Per-region 'fit_mode' wins; the
    # default keeps the verified-correct behaviour (Spine slot = fill exactly;
    # legacy cell-grid = contain, == the old pad-to-aspect path):
    #   fill    - stretch to the slot exactly (no margins; distorts if the
    #             element's aspect != the slot's authored aspect)
    #   contain - uniform scale to fit inside the slot, transparent margins
    #             (never distorts; element may not fill the slot)
    #   cover   - uniform scale to cover the slot, crop the overflow (never
    #             distorts, always fills; trims the element's excess margin —
    #             the right pick for AI art whose aspect can't match the slot,
    #             e.g. a wide wordmark inside a 1.5:1 GPT image)
    mode = str(region.get("fit_mode", "")).strip().lower() or (
        "fill" if spine_slot else "contain")
    cw, ch = img.size
    if mode == "fill":
        img = img.resize((target_w, target_h), Image.LANCZOS)
    elif mode == "cover":
        s = max(target_w / cw, target_h / ch)
        rw, rh = max(1, round(cw * s)), max(1, round(ch * s))
        img = img.resize((rw, rh), Image.LANCZOS)
        left, top = (rw - target_w) // 2, (rh - target_h) // 2
        img = img.crop((left, top, left + target_w, top + target_h))
    else:  # contain
        s = min(target_w / cw, target_h / ch)
        rw, rh = max(1, round(cw * s)), max(1, round(ch * s))
        scaled = img.resize((rw, rh), Image.LANCZOS)
        img = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
        img.paste(scaled, ((target_w - rw) // 2, (target_h - rh) // 2), scaled)

    if region.get("rotated"):
        # upright (w x h) -> packed (h x w). A bound .atlas (Spine) wants
        # rotate(+90), the exact inverse of the slicer's rotate(-90)
        # page->upright, so slice/regenerate/compose round-trips and matches
        # what the descriptor expects. Manifest-only atlases (no .atlas) are
        # consumed the other way round and need rotate(-90).
        img = img.rotate(90 if spine_slot else -90, expand=True)

    return img


def _seed_in_png(path: Path) -> int | None:
    try:
        prompt = Image.open(path).info.get("prompt")
        if not prompt:
            return None
        for node in json.loads(prompt).values():
            if node.get("class_type") == "KSampler":
                return node["inputs"].get("seed")
    except Exception:  # noqa: BLE001
        return None
    return None


def _variant_id(p: Path) -> str:
    """ComfyUI writes '<region>_<NNNNN>_.png'; region names can contain
    underscores, so match the final digit group, not split('_')[1]."""
    m = re.search(r"_(\d+)_?$", p.stem)
    return m.group(1) if m else p.stem


def variant_files(batch_dir: Path, name: str) -> list[Path]:
    """All variant PNGs for EXACTLY this region, sorted.

    ComfyUI writes '<region>_<NNNNN>_.png'. A naive glob('<name>_*.png')
    also matches regions that merely share the prefix — '10x' would pick up
    every '10x_shine_*.png', and since 's' > '0' those sort last so the
    'latest' for 10x became a 10x_shine file (same image/seed on both cards,
    and Create Atlas composing the wrong art). Require the region name to be
    followed immediately by the numeric variant id."""
    pat = re.compile(rf"^{re.escape(name)}_\d+_?\.png$", re.IGNORECASE)
    return sorted(p for p in batch_dir.glob(f"{name}_*.png")
                  if pat.match(p.name))


def override_image_path(region: dict) -> Path | None:
    """Resolve a region's user-supplied output image (output_override), if
    set and present. When a region has this, the atlas uses the user's image
    verbatim — no ComfyUI generation, no RMBG. Path is absolute or relative
    to the ComfyUI input dir. Clearing output_override reverts to normal
    generation."""
    ov = region.get("output_override")
    if not ov:
        return None
    p = Path(ov) if Path(ov).is_absolute() else INPUT_DIR / ov
    return p if p.exists() else None


def _pick_variant_png(batch_dir: Path, region: dict) -> Path | None:
    """Pick the variant PNG to compose, in priority order:
    1. the exact file the user picked & committed ("variant" id) — this is
       authoritative because a locked seed is reused across renders, so many
       variants share one seed and seed-matching can't tell them apart;
    2. else the file whose embedded seed matches a locked "seed";
    3. else the most recent variant."""
    files = variant_files(batch_dir, region["name"])
    if not files:
        return None
    picked = str(region.get("variant", "")).strip()
    if picked:
        for p in files:
            if _variant_id(p) == picked:
                return p
    # Seed-match only for ComfyUI pipelines. GPT-Image-1 PNGs carry NO
    # embedded seed, so a leftover SDXL "seed" in the manifest (e.g. a slot
    # switched from sdxl->gpt_image) would otherwise pin an OLD sdxl variant
    # that happens to share that seed, and silently ignore newer GPT renders.
    if region_pipeline(region) != "gpt_image":
        locked = region.get("seed")
        if locked is not None:
            for p in files:
                if _seed_in_png(p) == locked:
                    return p
    return files[-1]


def already_generated(batch_dir: Path, region: dict) -> Path | None:
    """When a region's seed is LOCKED and a matching variant already exists,
    return that file (so generation can skip it — no point re-rendering a
    pinned result). 'Matching' = the committed picked-variant id, else a file
    whose embedded seed equals the locked seed. Unlocked regions always
    return None (they're meant to produce fresh variants).

    GPT-Image-1 has no embedded seed, so a gpt_image region pins its result
    by a committed variant pick instead. Re-running it would mean another
    paid OpenAI call for an image the user already chose, so a committed
    pick is treated as 'already generated' for GPT slots."""
    files = variant_files(batch_dir, region["name"])
    if region_pipeline(region) == "gpt_image":
        picked = str(region.get("variant", "")).strip()
        if picked and files:
            for p in files:
                if _variant_id(p) == picked:
                    return p
        return None
    if "seed" not in region:
        return None
    if not files:
        return None
    picked = str(region.get("variant", "")).strip()
    if picked:
        for p in files:
            if _variant_id(p) == picked:
                return p
    locked = region.get("seed")
    for p in files:
        if _seed_in_png(p) == locked:
            return p
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=MANIFEST_REL)
    ap.add_argument("--output", default=None)
    ap.add_argument("--include-rotated", action="store_true")
    ap.add_argument("--include-hidden", action="store_true",
                    help="Include regions marked 'skip_unless_explicit' in the manifest (dead atlas slots).")
    ap.add_argument("--only", default=None, help="Comma-separated region names. Overrides skip_unless_explicit.")
    ap.add_argument("--variants", type=int, default=1,
                    help="How many variants to generate per non-locked region (each a fresh random seed).")
    ap.add_argument("--compose-only", action="store_true",
                    help="Do NOT generate. Assemble the atlas from existing variant PNGs "
                         "(per region: the file matching its locked seed, else the latest).")
    ap.add_argument("--force", action="store_true",
                    help="Regenerate even locked regions that already have a "
                         "matching variant (default: skip them).")
    args = ap.parse_args()

    manifest_path = SELF / Path(args.manifest).name  # tolerate legacy "tools/..."
    if manifest_path.suffix.lower() == ".atlas":
        # A `.atlas` was selected directly: pure geometry, no creative manifest.
        manifest = {"atlas": {}, "style": {"positive_prefix": "",
                    "positive_suffix": "", "negative": ""}, "regions": []}
    else:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    atlas = dict(manifest.get("atlas") or {})
    style = manifest["style"]

    atlas_path = atlas_file_path(manifest, manifest_path)
    atlas_bound = atlas_path is not None
    if atlas_bound and not atlas_path.exists():
        print(f"Bound .atlas not found: {atlas_path}\n"
              "Fix the manifest's atlas.atlas_file (absolute path, or a name "
              "next to the manifests).")
        raise SystemExit(2)

    if atlas_bound:
        atlas_data = atlas_format.parse_atlas(atlas_path)
        pg = atlas_data["page"]
        # `.atlas` owns the canvas geometry; manifest atlas block keeps only
        # non-geometry hints (e.g. an explicit source_image override).
        atlas["width"] = pg["width"]
        atlas["height"] = pg["height"]
        atlas.setdefault("source_image", pg["image"])
        atlas.pop("cell_width", None)
        atlas.pop("cell_height", None)
        print(f"Geometry: {atlas_path.name} "
              f"({len(atlas_data['regions'])} regions, "
              f"page {pg['width']}x{pg['height']})")

    ATLAS_META.clear()
    ATLAS_META.update(atlas)

    applied = apply_manifest_settings(manifest)
    if applied:
        print("Per-atlas settings overriding globals: "
              + ", ".join(f"{k}={v}" for k, v in applied.items()))

    if atlas_bound:
        # Rotation is per-region metadata from the `.atlas`; everything is
        # included (no rotated-split exclusion — that would drop ~half the
        # atlas). --include-rotated is a no-op in this mode.
        regions = merge_atlas_regions(manifest, atlas_data)
    else:
        regions = list(manifest["regions"])
        if args.include_rotated:
            regions += manifest.get("rotated_regions", [])
    if args.only:
        wanted = {s.strip() for s in args.only.split(",")}
        regions = [r for r in regions if r["name"] in wanted]
    elif not args.include_hidden:
        regions = [r for r in regions if not r.get("skip_unless_explicit")]

    if not regions:
        print("No regions selected. Aborting.")
        return

    batch_dir = BATCH_DIR

    if args.compose_only:
        # Assemble the atlas from already-generated PNGs. No ComfyUI calls.
        canvas = Image.new("RGBA", (atlas["width"], atlas["height"]), (0, 0, 0, 0))
        placed = 0
        for region in regions:
            ov = override_image_path(region)
            if ov is not None:
                img = Image.open(ov).convert("RGBA")
                img = fit_to_region(img, region)
                rx, ry, _, _ = region_box(region)
                canvas.paste(img, (rx, ry), img)
                placed += 1
                print(f"  placed {region['name']} <- {ov.name} "
                      f"(user image — not processed)")
                continue
            if region.get("output_override"):
                print(f"  ! {region['name']}: output_override set but file "
                      f"missing ({region['output_override']}) — "
                      f"falling back to generated variant")
            src = _pick_variant_png(batch_dir, region)
            if not src:
                print(f"  skip {region['name']}: no generated variant found")
                continue
            img = Image.open(src).convert("RGBA")
            img = fit_to_region(img, region)
            rx, ry, _, _ = region_box(region)
            canvas.paste(img, (rx, ry), img)
            placed += 1
            print(f"  placed {region['name']} <- {src.name}")
        out_path = (Path(args.output) if args.output else
                    ATLAS_DIR /
                    f"{manifest_path.stem.replace('atlas_manifest_', '')}_new.png")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(out_path)
        canvas.save(out_path.with_suffix(".webp"), "WEBP", quality=95)
        print(f"Composed {placed}/{len(regions)} regions")
        print(f"Saved {out_path}")
        print(f"Saved {out_path.with_suffix('.webp')}")
        return

    # ---- generation mode: produce per-region variant PNGs only (no atlas) ----
    client_id = str(uuid.uuid4())
    variants = max(1, args.variants)
    jobs: list[dict] = []
    overridden = [r["name"] for r in regions if r.get("output_override")]
    gen_regions = [r for r in regions if not r.get("output_override")]
    if overridden:
        print(f"Skipping {len(overridden)} region(s) with a user output image "
              f"(not processed): {', '.join(overridden)}")
    # Locked + already generated => don't re-process (unless --force).
    done = []
    if not args.force:
        kept = []
        for r in gen_regions:
            hit = already_generated(batch_dir, r)
            if hit is not None:
                done.append(f"{r['name']} ({hit.name})")
            else:
                kept.append(r)
        gen_regions = kept
        if done:
            print(f"Skipping {len(done)} locked region(s) already generated "
                  f"(use --force to regenerate): {', '.join(done)}")
    gpt_capped = []
    for region in gen_regions:
        if region_pipeline(region) == "gpt_image":
            passes = 1            # each GPT call is billed real money —
            if variants > 1:      # never silently fire `variants` of them
                gpt_capped.append(region["name"])
        elif "seed" in region:
            passes = 1
        else:
            passes = variants
        jobs.extend([region] * passes)
    if gpt_capped:
        print(f"Cost guard: {len(gpt_capped)} GPT-Image-1 region(s) capped "
              f"to 1 variant (not {variants}) — each GPT call is paid: "
              f"{', '.join(gpt_capped)}")

    print(f"Generation: regions {len(gen_regions)}  variants {variants}  "
          f"total jobs {len(jobs)}  (atlas NOT composed — use Create Atlas)")

    if not jobs:
        print("Nothing to generate (all selected regions use a user image).")
        return

    preflight_models(gen_regions)

    for i, region in enumerate(jobs, start=1):
        label = f"{region['name']} ({region.get('fruit', '?')})"
        flag = " [rotated]" if region.get("rotated") else ""
        print(f"[{i}/{len(jobs)}] {label}{flag} ...", flush=True)
        run_region(region, style, atlas["source_image"], client_id)

    print(f"Done generating. Variant PNGs saved in {BATCH_DIR}")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, TimeoutError) as e:
        # A ComfyUI / paid-API failure (payment, login, OOM, timeout) is an
        # expected operational outcome, not a tool bug — show it as a clean,
        # readable banner in the UI log instead of dumping a Python traceback
        # and dying with a bare [exit 1].
        bar = "=" * 64
        print(f"\n{bar}\n  GENERATION STOPPED\n\n  {e}\n{bar}",
              flush=True)
        sys.exit(1)
