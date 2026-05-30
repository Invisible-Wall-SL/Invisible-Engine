"""
Invisible Atlas Maker — local web UI (by Invisible Wall SL).

Lists every region from the active manifest. Per region: toggle render on/off,
edit the prompt, lock/unlock/change the seed, view latest output + shape ref,
see which seed produced the current output and lock it with one click.
A Settings panel edits global atlas_config.json. Live render progress on the
button; thumbnails + seeds refresh in place when done (no full reload).

Run:  python tools/ui_server.py   →  http://127.0.0.1:8765
Zero external deps (stdlib http.server + Pillow).
"""

from __future__ import annotations

import base64
import html
import io
import json
import os
import re
import shutil
import string
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cloud_paths as project_paths  # noqa: E402
import atlas_format  # noqa: E402
import batch_atlas  # noqa: E402  (reuse the geometry resolver — single source)
import shine  # noqa: E402  (local *_shine derivation, no ComfyUI)

# Self-contained tool folder (Tools/<Tool Name>/). All code, config and
# manifests live here together; per-game ComfyUI dirs come from project_paths.
import storage  # noqa: E402  (R2 object storage + staging mirror)

SELF = Path(__file__).resolve().parent
TOOLS = SELF

_PP = project_paths.resolve()
BATCH_DIR = _PP["batch_dir"]
ATLAS_DIR = _PP["atlas_dir"]
INPUT_DIR = _PP["input_dir"]
COMFY_HOST = _PP["comfy_host"]
# Cloud: config + manifests live in the R2-backed staging tree (not the app
# dir), so user edits survive container restarts.
STAGING_ROOT = _PP["staging_root"]
MANIFEST_DIR = _PP["manifest_dir"]
R2_PREFIX = _PP.get("r2_project_prefix")
CONFIG_PATH = STAGING_ROOT / "atlas_config.json"

# Project-centric mode: the launcher sends `?project=<key>` on the first
# request. We remember it in a cookie and re-hydrate staging on a switch.
# Serialised so an interleaved request can't observe half-hydrated staging.
_project_lock = threading.Lock()


def _apply_project_paths(pp: dict) -> None:
    """Re-point every module-level path at the (possibly new) project. Other
    functions read these via global lookup at call time, so reassigning the
    module globals here genuinely redirects all file ops to the new project."""
    global _PP, BATCH_DIR, ATLAS_DIR, INPUT_DIR, COMFY_HOST
    global STAGING_ROOT, MANIFEST_DIR, R2_PREFIX, CONFIG_PATH
    _PP = pp
    BATCH_DIR = pp["batch_dir"]
    ATLAS_DIR = pp["atlas_dir"]
    INPUT_DIR = pp["input_dir"]
    COMFY_HOST = pp["comfy_host"]
    STAGING_ROOT = pp["staging_root"]
    MANIFEST_DIR = pp["manifest_dir"]
    R2_PREFIX = pp.get("r2_project_prefix")
    CONFIG_PATH = STAGING_ROOT / "atlas_config.json"


def _mirror(p: Path) -> None:
    """Write-through: mirror a staging file to its R2 key so it persists."""
    if not (R2_PREFIX and STAGING_ROOT):
        return
    try:
        rel = Path(p).resolve().relative_to(Path(STAGING_ROOT).resolve()).as_posix()
        storage.push_file(Path(p), f"{R2_PREFIX}/{rel}")
    except Exception:  # noqa: BLE001 — best-effort mirror
        pass


def _unmirror(p: Path) -> None:
    """Delete the R2 counterpart of a removed staging file."""
    if not (R2_PREFIX and STAGING_ROOT):
        return
    try:
        rel = Path(p).resolve().relative_to(Path(STAGING_ROOT).resolve()).as_posix()
        storage.delete(f"{R2_PREFIX}/{rel}")
    except Exception:  # noqa: BLE001
        pass


# Shared-secret access gate (the tool runs behind the launcher). Unset = open.
ATLAS_TOOL_SECRET = os.environ.get("ATLAS_TOOL_SECRET", "")

# POST routes that write/remove ref images → mirror staging refs to R2 after.
_REF_MUTATING_ROUTES = {
    "/setref", "/setoutput", "/userefimg", "/shinefrom", "/shinemode",
    "/fxbuild", "/clearref", "/clearoutput", "/setmode", "/delvariants",
    "/uploadatlas",
}


# Minimal default config used when none exists yet in R2/staging (first run).
# Secrets (comfy.org key) come from env, never persisted here.
DEFAULT_CONFIG = {
    "manifest_path": "atlas_manifest_symbols.json",
    "comfy_host": COMFY_HOST,
    "pipeline": "sdxl",
    "checkpoint": "juggernautXL_ragnarokBy.safetensors",
    "lora": "gameIconInstitute3d_v10.safetensors",
    "lora_strength": 0.85,
    "controlnet": "controlnet-union-sdxl-1.0-promax.safetensors",
    "rmbg_model": "RMBG-2.0",
    "ipadapter_weight": 0.35,
    "ipadapter_weight_type": "style transfer",
    "controlnet_strength": 0.7,
    "controlnet_end_percent": 0.85,
    "ksampler_steps": 30,
    "ksampler_cfg": 8.5,
    "padding_pct": 0.12,
    "gen_width": 1024,
    "gen_height": 1024,
}
LOGO_CANDIDATES = [
    # Bundled with the service (works in the container). The local Windows
    # paths below are kept as fallbacks for running the tool on the dev box.
    Path(__file__).resolve().parent / "iw-emblem.svg",
    Path(r"C:/Invisible Wall SL/Company Website/Images/iw-emblem.svg"),
    Path(r"C:/Invisible Wall SL/Company Website/Images/iw-emblem.png"),
]
PY = sys.executable
PORT = int(os.environ.get("PORT", "8765"))
HOST = os.environ.get("ATLAS_BIND_HOST", "0.0.0.0")
BUILD = "v15-extra-prompts"  # shown in the header so you can verify the live code

_render_state = {"running": False, "log": "", "done": False, "cur": 0, "total": 0}
_render_lock = threading.Lock()
_render_proc: subprocess.Popen | None = None
_stopped = False
# Short-lived cache for the comfy.org balance so the auto-refreshing header
# chip doesn't hammer the billing API (and survives a brief outage).
_credits_cache = {"t": 0.0, "payload": None}
_CREDITS_TTL = 25.0
_PROG_RE = re.compile(r"\[(\d+)/(\d+)\]")

ADV_FIELDS = [
    ("pipeline", "Pipeline (this slot)", ""),
    ("ipadapter_weight", "IPAdapter weight", "ipadapter_weight"),
    ("redux_strength", "Redux strength (0 = off, prompt takes over)",
     "flux_redux_strength"),
    ("flux_lora_strength", "FLUX LoRA strength (0 = no LoRA here)",
     "flux_lora_strength"),
    ("controlnet_strength", "ControlNet strength", "controlnet_strength"),
    ("controlnet_end_percent", "ControlNet end %", "controlnet_end_percent"),
    ("checkpoint", "Checkpoint override", "checkpoint"),
    ("style_ref", "Style ref (IPAdapter / Redux image)", "mockup_image"),
    ("shape_ref", "Shape ref (ControlNet silhouette)", ""),
    ("fit_mode", "Fit mode — how the art maps into the slot", ""),
    ("gpt_rembg", "GPT: cut background (RMBG)", ""),
]
# Which pipeline each advanced override belongs to. Identical concept to the
# Settings panel's data-pipe: a field shows when its group is "both" or
# equals the slot's effective pipeline ("sdxl" / "flux" / "gpt_image").
ADV_PIPE = {
    "pipeline": "all",       # the selector itself — always visible
    "ipadapter_weight": "sdxl",
    "checkpoint": "sdxl",
    "redux_strength": "flux",
    "flux_lora_strength": "flux",
    "controlnet_strength": "both",   # ComfyUI local only, hidden for gpt
    "controlnet_end_percent": "both",
    "style_ref": "all",      # the slot's reference image — used by gpt too
    "shape_ref": "both",     # ControlNet silhouette — local pipelines only
    "fit_mode": "all",       # slot mapping — applies to every pipeline
    "gpt_rembg": "gpt_image",
}
# Advanced fields rendered as a <select>. "" = inherit the default.
ADV_SELECT = {
    "pipeline": ["", "sdxl", "flux", "gpt_image"],
    "fit_mode": ["", "fill", "contain", "cover"],
    "gpt_rembg": ["", "on", "off"],
}
# Hover tooltips for advanced fields (shown on the row + an ⓘ marker).
ADV_TIPS = {
    "pipeline":
        "Which generator this slot uses. Blank = inherit the atlas/global "
        "pipeline. sdxl / flux = local ComfyUI. gpt_image = OpenAI "
        "GPT-Image-1 via ComfyUI's API node (spends comfy.org credits; "
        "needs a comfy.org API key in Settings).",
    "fit_mode":
        "How the regenerated art is mapped into this slot's fixed size.  "
        "• fill: stretch to the slot exactly — no margins, but DISTORTS if "
        "the art's aspect differs from the slot (use when the art already "
        "matches the slot, e.g. fruit / face).  "
        "• contain: scale to fit inside, keep aspect, transparent margins — "
        "never distorts but may not fill the slot (looks smaller).  "
        "• cover: scale to fill, keep aspect, crop the overflow — never "
        "distorts and always fills; best for AI art whose aspect can't "
        "match the slot (e.g. a wide wordmark inside a square-ish GPT "
        "image).  Blank = default: fill for Spine .atlas slots, contain "
        "for legacy cell grids.",
    "shape_ref":
        "A silhouette image (this slot's own) fed to ControlNet so the "
        "generated art follows its outline. Pick from R2 to point at a ref "
        "already in the asset repo. Blank = no ControlNet for this slot.",
    "gpt_rembg":
        "GPT-Image-1 almost always returns an OPAQUE image, which composes "
        "as a solid rectangle over the scene. ON runs the same RMBG cutout "
        "the SDXL/FLUX pipelines use so the tile gets clean alpha. Turn OFF "
        "only for full-frame art you want kept whole (e.g. a rectangular "
        "plate). Blank = the global default (Settings).",
}
ADV_NUMERIC = {"ipadapter_weight", "redux_strength", "flux_lora_strength",
               "controlnet_strength", "controlnet_end_percent"}
# ComfyUI-valid ranges (min, max, step) — values outside these make ComfyUI
# reject the whole prompt (HTTP 400), so the UI bounds the inputs and the
# server clamps on save as a second line of defence.
ADV_RANGES = {
    "ipadapter_weight": (-1.0, 5.0, 0.05),
    "redux_strength": (0.0, 3.0, 0.05),
    "flux_lora_strength": (0.0, 2.0, 0.05),
    "controlnet_strength": (0.0, 10.0, 0.01),
    "controlnet_end_percent": (0.0, 1.0, 0.01),
}
ADV_MULTILINE = set()  # GPT instruction + negative live on the card
ADV_BOOL = set()

CONFIG_FIELDS = [
    ("pipeline", "Pipeline", "text"),
    ("comfy_host", "ComfyUI host:port", "text"),
    ("mockup_image", "Global style mockup", "text"),
    ("checkpoint", "Checkpoint", "text"),
    ("lora", "LoRA", "text"),
    ("lora_strength", "LoRA strength", "number"),
    ("controlnet", "ControlNet model", "text"),
    ("rmbg_model", "RMBG model", "text"),
    ("ipadapter_weight", "IPAdapter weight", "number"),
    ("ipadapter_weight_type", "IPAdapter weight type", "text"),
    ("controlnet_strength", "ControlNet strength", "number"),
    ("controlnet_end_percent", "ControlNet end %", "number"),
    ("ksampler_steps", "Sampler steps", "number"),
    ("ksampler_cfg", "CFG scale", "number"),
    ("padding_pct", "Atlas padding %", "number"),
    ("shape_ref_fill_pct", "Shape-ref fill %", "number"),
    ("gen_width", "Gen width", "number"),
    ("gen_height", "Gen height", "number"),
    # ---- FLUX-only (shown only when Pipeline = flux) ----
    ("flux_checkpoint", "FLUX all-in-one checkpoint", "text"),
    ("flux_unet", "FLUX UNet", "text"),
    ("flux_weight_dtype", "FLUX weight dtype", "text"),
    ("flux_clip_t5", "FLUX CLIP (T5-XXL)", "text"),
    ("flux_clip_l", "FLUX CLIP (L)", "text"),
    ("flux_vae", "FLUX VAE", "text"),
    ("flux_lora", "FLUX LoRA", "text"),
    ("flux_lora_strength", "FLUX LoRA strength", "number"),
    ("flux_guidance", "FLUX guidance", "number"),
    ("flux_steps", "FLUX steps", "number"),
    ("flux_sampler", "FLUX sampler", "text"),
    ("flux_scheduler", "FLUX scheduler", "text"),
    ("flux_controlnet", "FLUX ControlNet", "text"),
    ("flux_redux_style_model", "FLUX Redux model", "text"),
    ("flux_clip_vision", "FLUX CLIP-Vision", "text"),
    ("flux_redux_strength", "FLUX Redux strength", "number"),
    # ---- GPT-Image-1 via ComfyUI API node (comfy.org credits, no key) ----
    ("gpt_image_model", "GPT image model", "text"),
    ("gpt_image_size", "GPT image size", "text"),
    ("gpt_image_quality", "GPT image quality", "text"),
    ("gpt_image_background", "GPT image background", "text"),
    ("gpt_image_rembg", "GPT cut background (true/false)", "text"),
    ("comfy_org_api_key", "comfy.org API key (API nodes)", "text"),
    ("credits_eur_rate", "Credits → EUR rate (0 = off)", "number"),
]

# Fields whose value is a model file ComfyUI knows: rendered as a <select>
# populated live from /object_info (node, field). Falls back to a text input
# if ComfyUI is unreachable. The current value is always kept as an option
# even if ComfyUI doesn't list it (so nothing silently changes).
MODEL_FIELDS = {
    "checkpoint": ("CheckpointLoaderSimple", "ckpt_name"),
    "lora": ("LoraLoader", "lora_name"),
    "controlnet": ("ControlNetLoader", "control_net_name"),
    "rmbg_model": ("RMBG", "model"),
    "flux_checkpoint": ("CheckpointLoaderSimple", "ckpt_name"),
    "flux_unet": ("UNETLoader", "unet_name"),
    "flux_weight_dtype": ("UNETLoader", "weight_dtype"),
    "flux_clip_t5": ("DualCLIPLoader", "clip_name1"),
    "flux_clip_l": ("DualCLIPLoader", "clip_name2"),
    "flux_vae": ("VAELoader", "vae_name"),
    "flux_lora": ("LoraLoaderModelOnly", "lora_name"),
    "flux_sampler": ("KSampler", "sampler_name"),
    "flux_scheduler": ("KSampler", "scheduler"),
    "flux_controlnet": ("ControlNetLoader", "control_net_name"),
    "flux_redux_style_model": ("StyleModelLoader", "style_model_name"),
    "flux_clip_vision": ("CLIPVisionLoader", "clip_name"),
}

# Which pipeline a field belongs to (controls show/hide). Anything not listed
# is "both" = the two local ComfyUI pipelines (sdxl OR flux), hidden under
# gpt_image. "all" = every pipeline incl. gpt_image (truly universal fields).
PIPE_GROUP = {
    "pipeline": "all", "comfy_host": "all", "padding_pct": "all",
    "comfy_org_api_key": "all", "credits_eur_rate": "all",
    "checkpoint": "sdxl", "lora": "sdxl", "lora_strength": "sdxl",
    "controlnet": "sdxl", "ipadapter_weight": "sdxl",
    "ipadapter_weight_type": "sdxl", "ksampler_steps": "sdxl",
    "ksampler_cfg": "sdxl",
    "flux_checkpoint": "flux",
    "flux_unet": "flux", "flux_weight_dtype": "flux", "flux_clip_t5": "flux",
    "flux_clip_l": "flux", "flux_vae": "flux", "flux_lora": "flux",
    "flux_lora_strength": "flux", "flux_guidance": "flux",
    "flux_steps": "flux", "flux_sampler": "flux", "flux_scheduler": "flux",
    "flux_controlnet": "flux", "flux_redux_style_model": "flux",
    "flux_clip_vision": "flux", "flux_redux_strength": "flux",
    "gpt_image_model": "gpt_image", "gpt_image_size": "gpt_image",
    "gpt_image_quality": "gpt_image", "gpt_image_background": "gpt_image",
    "gpt_image_rembg": "gpt_image",
}
PIPELINE_OPTIONS = ["sdxl", "flux", "gpt_image"]

# Free-text PATH fields that get a 📁 browse button (server-side file
# picker). Model fields stay ComfyUI-driven dropdowns; these are real
# filesystem paths (also accept a UNC \\server\share path or an http URL).
FILE_FIELDS = {"mockup_image", "atlas_source_image", "atlas_file"}
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif",
               ".tga", ".tif", ".tiff", ".avif"}

# Subset of CONFIG_FIELDS that can be overridden per-atlas. Stored in the
# active manifest's "settings" block; atlas_config.json keeps the shared
# default (shown as the input placeholder; blank input = inherit global).
# Everything else (comfy_host, mockup_image, manifest_path, project) stays
# truly global.
PER_ATLAS_KEYS = {
    "checkpoint", "lora", "lora_strength", "controlnet", "rmbg_model",
    "ipadapter_weight", "ipadapter_weight_type", "controlnet_strength",
    "controlnet_end_percent", "ksampler_steps", "ksampler_cfg",
    "padding_pct", "shape_ref_fill_pct", "gen_width", "gen_height",
}

# Editable manifest["atlas"] geometry, surfaced in the Settings panel.
# UI key -> manifest atlas key. Always per-manifest (no global fallback).
ATLAS_GEOM_FIELDS = [
    ("atlas_file", "Source .atlas (geometry)", "text", "atlas_file"),
    ("atlas_width", "Atlas width", "number", "width"),
    ("atlas_height", "Atlas height", "number", "height"),
    ("atlas_cell_width", "Default cell width", "number", "cell_width"),
    ("atlas_cell_height", "Default cell height", "number", "cell_height"),
    ("atlas_format", "Atlas format", "text", "format"),
    ("atlas_source_image", "Atlas source image", "text", "source_image"),
]
_ATLAS_GEOM_KEYS = {ui: mk for ui, _, _, mk in ATLAS_GEOM_FIELDS}
_ATLAS_GEOM_NUMERIC = {"atlas_width", "atlas_height",
                       "atlas_cell_width", "atlas_cell_height"}

# Plain-language explanation for every Settings field. {lora}/{ckpt}/{cn}/
# {rmbg} are filled with the current values so the tip names the actual model
# in use (e.g. "follows the LoRA 'gameIconInstitute3d_v10' more closely").
SETTING_HELP = {
    "comfy_host":
        "Where ComfyUI is listening (host:port). The launcher derives this "
        "from the active project — only change it if ComfyUI runs elsewhere. "
        "Generation fails fast with a clear message if nothing answers here.",
    "mockup_image":
        "Default IPAdapter style image, used for any region that has no own "
        "style_ref / atlas slice. It transfers overall look (palette, "
        "shading, finish) — not shape. Per-region slices override it.",
    "checkpoint":
        "The SDXL base model ('{ckpt}') that actually draws every symbol. "
        "Biggest single lever on overall art style; changing it re-bases the "
        "look of the whole atlas.",
    "lora":
        "Extra style adapter ('{lora}') layered on the checkpoint to push a "
        "specific aesthetic (here: game-icon / 3D-icon look).",
    "lora_strength":
        "How strongly the generation follows the LoRA '{lora}', making the "
        "result look closer to that LoRA's style. 0 = LoRA off; ~0.6-0.9 "
        "typical; >1 can overpower the checkpoint and distort shapes.",
    "controlnet":
        "The ControlNet model ('{cn}') used when a region has a shape_ref. "
        "It forces the generated art to follow that reference's edges "
        "(Canny), holding the original silhouette / spacing.",
    "rmbg_model":
        "Background-removal model ('{rmbg}') that cuts the generated symbol "
        "out to a clean transparent PNG before it's placed in the atlas.",
    "ipadapter_weight":
        "How hard the IPAdapter style image is applied. Higher = the result "
        "hugs the reference's colours/finish more; too high flattens detail "
        "and variety. Valid -1 to 5; ~0.3-0.8 typical.",
    "ipadapter_weight_type":
        "How the IPAdapter influence is distributed (e.g. 'style transfer' "
        "biases palette/finish over composition). Leave default unless you "
        "know the IPAdapter modes.",
    "controlnet_strength":
        "How strictly the art obeys the shape_ref edges. Higher = silhouette "
        "locked tight (less seed variety, fewer creative results); lower = "
        "looser, more varied. 0-10, ~0.6-0.9 typical.",
    "controlnet_end_percent":
        "Fraction of the denoise during which ControlNet stays active. ~0.8 "
        "shapes early structure then frees up for detail; 1.0 enforces the "
        "outline to the very end (most rigid). 0-1.",
    "ksampler_steps":
        "Diffusion steps per image. More = cleaner/more detailed but slower; "
        "diminishing returns past ~35-45 for SDXL.",
    "ksampler_cfg":
        "Prompt adherence (CFG). Higher = follows the prompt more literally "
        "but can look harsh/over-saturated; lower = softer, more creative. "
        "~6-9 typical for SDXL.",
    "padding_pct":
        "Transparent margin added around each symbol when it's fitted into "
        "its atlas slot. 0 = edge-to-edge (no border); ~0.1 leaves breathing "
        "room so neighbours don't touch.",
    "shape_ref_fill_pct":
        "How much of the 1024² canvas the shape_ref silhouette is scaled to "
        "fill before generation. Higher = bigger subject / tighter framing; "
        "keeps every symbol a consistent size regardless of how the ref was "
        "drawn.",
    "gen_width":
        "Pixel width SDXL renders at before the result is fitted to the slot. "
        "1024 is SDXL's sweet spot; smaller is faster but softer.",
    "gen_height":
        "Pixel height SDXL renders at before the result is fitted to the "
        "slot. 1024 is SDXL's sweet spot; smaller is faster but softer.",
    "atlas_width":
        "Full atlas canvas width in pixels. When a .atlas is bound this is "
        "read from it and ignored here.",
    "atlas_height":
        "Full atlas canvas height in pixels. When a .atlas is bound this is "
        "read from it and ignored here.",
    "atlas_cell_width":
        "Fallback slot width for regions with no explicit geometry — only "
        "used in the legacy cell-grid mode (no .atlas bound).",
    "atlas_cell_height":
        "Fallback slot height for regions with no explicit geometry — only "
        "used in the legacy cell-grid mode (no .atlas bound).",
    "atlas_format":
        "Pixel format tag stored in the manifest (e.g. RGBA). Informational; "
        "does not change generation.",
    "atlas_file":
        "Optional Spine/libGDX .atlas that owns region geometry (x/y/w/h). "
        "Browse to or paste an absolute path, or a name next to the manifests. "
        "Leave blank for the legacy cell-grid mode (slices by the settings "
        "cell size instead).",
    "atlas_source_image":
        "The ORIGINAL atlas image, used by 'Slice source -> refs' to cut a "
        "per-region reference crop. Absolute path, or a name inside the "
        "active project's ComfyUI input folder.",
    "manifest_path":
        "Active atlas: pick a JSON manifest (creative data) or a .atlas "
        "(geometry). Switching reloads all region cards. Project switches "
        "need a run_ui.bat restart.",
    "project":
        "Which launcher project's ComfyUI dirs receive output / supply "
        "inputs. Save, then restart run_ui.bat — paths resolve at startup.",
    "pipeline":
        "Which generation graph to use. 'sdxl' = checkpoint + LoRA + "
        "IPAdapter + ControlNet (the original). 'flux' = FLUX UNet/CLIP/VAE "
        "+ FluxGuidance + FLUX LoRA + Redux (FLUX's style-reference) + "
        "ControlNet. SDXL and FLUX models are NOT interchangeable; the "
        "fields below switch to match the selected pipeline.",
    "flux_checkpoint":
        "Single all-in-one FP8 FLUX checkpoint (UNet+CLIP+VAE in one file, "
        "via CheckpointLoaderSimple). Easiest setup — e.g. Comfy-Org "
        "flux1-schnell-fp8 (Apache-2.0, commercial-OK). When set it OVERRIDES "
        "the separate UNet/CLIP/VAE fields below; leave blank to use those.",
    "flux_unet":
        "The FLUX diffusion model (UNet), e.g. flux1-dev. Loaded via "
        "UNETLoader. Ignored if 'FLUX all-in-one checkpoint' is set. This is "
        "FLUX's equivalent of the SDXL checkpoint.",
    "flux_weight_dtype":
        "Precision the FLUX UNet is loaded at. fp8_e4m3fn saves VRAM with "
        "minor quality cost; 'default' uses full precision (more VRAM).",
    "flux_clip_t5":
        "FLUX's large text encoder (T5-XXL). Pair with the CLIP-L below; "
        "FLUX needs both via DualCLIPLoader.",
    "flux_clip_l":
        "FLUX's secondary text encoder (CLIP-L), loaded alongside T5-XXL.",
    "flux_vae":
        "FLUX VAE (e.g. ae.safetensors) used to decode the latent to pixels.",
    "flux_lora":
        "Optional FLUX LoRA (model-only — FLUX LoRAs don't touch CLIP). "
        "Blank = no LoRA. Must be a FLUX LoRA, not an SDXL one.",
    "flux_lora_strength":
        "How strongly the FLUX LoRA is applied. ~0.8-1.0 typical; higher "
        "pushes its style harder.",
    "flux_guidance":
        "FLUX distilled guidance (via FluxGuidance, replaces CFG). ~3.5 is "
        "the dev default; higher = stronger prompt adherence, can over-bake.",
    "flux_steps":
        "Diffusion steps for FLUX. ~20 is typical for flux-dev; more is "
        "slower with diminishing returns.",
    "flux_sampler":
        "Sampler for FLUX (euler is the safe default). Must be one ComfyUI "
        "lists for KSampler.",
    "flux_scheduler":
        "Scheduler for FLUX ('simple' is the safe default for flux-dev).",
    "flux_controlnet":
        "Optional FLUX ControlNet model. Blank = no ControlNet (shape_ref "
        "ignored in FLUX). Must be a FLUX ControlNet, not the SDXL union one.",
    "flux_redux_style_model":
        "FLUX Redux style model — FLUX's stand-in for the SDXL IPAdapter. "
        "Lets a region's style_ref / atlas slice steer the look. Blank "
        "disables Redux. Requires the Redux model installed in ComfyUI.",
    "flux_clip_vision":
        "CLIP-Vision model Redux uses to encode the reference image (e.g. "
        "sigclip vision). Required for Redux.",
    "flux_redux_strength":
        "How strongly the Redux reference influences the result. ~1.0 = "
        "full; lower loosens the resemblance to the original element.",
    "gpt_image_model":
        "Model for the OpenAIGPTImage1 ComfyUI API node: gpt-image-1, "
        "gpt-image-1.5 or gpt-image-2. Runs on comfy.org credits — no "
        "OpenAI key; just sign in to comfy.org inside ComfyUI once.",
    "gpt_image_size":
        "match_ref (default) generates at the original reference's aspect "
        "ratio so the result isn't a squashed square (gpt-image-2 only). Or "
        "a fixed preset: auto, 1024x1024, 1024x1536, 1536x1024, 2048x2048, "
        "2048x1152, 1152x2048, 3840x2160, 2160x3840.",
    "gpt_image_quality":
        "Render quality for gpt_image edits: low, medium or high. Higher "
        "costs more comfy.org credits and is slower.",
    "gpt_image_background":
        "gpt-image-2 forbids transparent (auto-forced to opaque + RMBG "
        "cutout). opaque/auto keep a background; RMBG still cuts it out.",
    "gpt_image_rembg":
        "true = run an RMBG cutout after every GPT slot (GPT usually "
        "ignores the transparent request and returns an opaque image that "
        "would composite as a solid rectangle). Per-slot 'GPT: cut "
        "background' in ⚙ advanced overrides this.",
    "credits_eur_rate":
        "Optional USD→EUR multiplier for the header credits chip "
        "(comfy.org reports balance in USD). e.g. 0.92 shows '≈ €…'. "
        "0 = off (show USD only). Purely a display estimate — comfy.org "
        "does the actual billing in its own units.",
    "comfy_org_api_key":
        "comfy.org API key for ComfyUI API nodes (gpt_image). REQUIRED — "
        "the ComfyUI browser login only covers jobs run from the web UI; "
        "this tool submits headless jobs. Create a key in your Comfy "
        "account at platform.comfy.org (API Keys). Env var "
        "COMFY_ORG_API_KEY overrides this.",
}


def help_for(key: str, cfg: dict) -> str:
    """Tooltip text for a setting, with the current model names filled in."""
    txt = SETTING_HELP.get(key, "")
    if not txt:
        return ""
    return txt.format(
        lora=cfg.get("lora", "?"),
        ckpt=cfg.get("checkpoint", "?"),
        cn=cfg.get("controlnet", "?"),
        rmbg=cfg.get("rmbg_model", "?"),
    )


def _opt_html(values, current: str, blank_label: str = "") -> str:
    """Build <option>s. A blank choice is always available when blank_label
    is given (so any model dropdown can be cleared). A non-empty current
    value that ComfyUI doesn't list is preserved (marked) so saving never
    silently changes it."""
    out = []
    vals = [str(v) for v in values]
    if blank_label:
        sel = " selected" if current == "" else ""
        out.append(f'<option value=""{sel}>{html.escape(blank_label)}</option>')
    if current and current not in vals:
        out.append(f'<option value="{html.escape(current, quote=True)}" '
                    f'selected>{html.escape(current)} (not in ComfyUI)</option>')
    for v in vals:
        sel = " selected" if v == current else ""
        out.append(f'<option value="{html.escape(v, quote=True)}"{sel}>'
                    f'{html.escape(v)}</option>')
    return "".join(out)


def _control_html(key: str, typ: str, value, cache: dict, *,
                   allow_blank: bool = False, blank_label: str = "",
                   placeholder: str = "", title: str = "",
                   step: str = "") -> str:
    """Inner form element for a settings field: a <select> for the pipeline
    and for model-file fields (populated live from ComfyUI, current value
    always kept), else the plain <input>. All carry data-cfg so the existing
    save logic and cfgData() pick them up unchanged."""
    cur = "" if value is None else str(value)
    common = f' data-cfg="{key}" title="{title}"'
    if key == "pipeline":
        return (f'<select{common}>'
                f'{_opt_html(PIPELINE_OPTIONS, cur or "sdxl")}</select>')
    nf = MODEL_FIELDS.get(key)
    if nf is not None:
        if nf not in cache:
            try:
                cache[nf] = batch_atlas._available(nf[0], nf[1])
            except Exception:  # noqa: BLE001 — UI must render even if Comfy down
                cache[nf] = None
        avail = cache[nf]
        if avail:
            # Always offer a blank choice: per-atlas blank = inherit global;
            # global blank = literally empty (e.g. clear flux_checkpoint /
            # flux_controlnet so the optional node is skipped).
            bl = blank_label if allow_blank else "(blank — none)"
            return f'<select{common}>{_opt_html(avail, cur, bl)}</select>'
    inp = (f'<input{common} type="{typ}" '
           f'value="{html.escape(cur, quote=True)}" '
           f'placeholder="{html.escape(placeholder, quote=True)}"{step}>')
    if key in FILE_FIELDS:
        return (f'<span class="filefld">{inp}'
                f'<button type="button" class="fbtn" title="Browse for a '
                f'file (local, network \\\\share, or paste a URL)" '
                f'onclick="openFs(\'{key}\')">📁</button></span>')
    return inp


# Friendlier control labels per FX param key (fallback: the key itself).
_FX_LABELS = {
    "color": "color", "blur": "size", "intensity": "amount",
    "layers": "bloom", "opacity": "opacity", "offset_x": "dx",
    "offset_y": "dy", "amount": "amount", "blend": "blend",
    "threshold": "cutoff", "softness": "soft", "boost": "boost",
    "overlay": "base", "base_alpha_floor": "ghost",
    "kind": "kind", "radius": "radius", "preserve_alpha": "sharp",
    "steps": "steps", "cx": "cx", "cy": "cy",
}
_FX_BLURB = {
    "shine": ("✨ Shine — extract bright pixels of the source into an "
              "additive highlight layer (rest transparent)"),
    "glow": "🌟 Glow — base glyph + tinted halo grown from its silhouette",
    "shadow": "🌑 Shadow — soft silhouette blob of the source (local)",
    "colour": "🎨 Colour — recolour the source image (local)",
    "blur": ("💨 Blur — gaussian / horizontal / vertical / box softening. "
             "Optional 'sharp' keeps the silhouette crisp (RGB blur only)"),
    "zoom": ("🔭 Zoom — radial burst around (cx, cy). 'amount' = zoom span; "
             "'steps' = smoothness; 'sharp' keeps silhouette crisp"),
}


def _fx_controls(name: str, mode: str, saved: dict) -> str:
    """Per-region control group for a local FX mode (shine / shadow /
    colour): one input per preset param + a Build button. Pre-filled from
    the region's saved params for that mode."""
    if mode not in shine.FX_PRESETS:
        return ""
    defaults, ranges = shine.FX_PRESETS[mode]
    d = dict(defaults)
    d.update({k: v for k, v in (saved or {}).items() if v not in ("", None)})
    n = html.escape(name)
    rows = []
    for key, dv in defaults.items():
        lbl = _FX_LABELS.get(key, key)
        cls = f"fx-{key}"
        if key == "color":
            rows.append(
                f'<label>{lbl} <input type="color" class="{cls}" '
                f'value="{html.escape(str(d[key]), quote=True)}"></label>')
            continue
        if key == "blend":
            opts = "".join(
                f'<option value="{o}"'
                f'{" selected" if str(d[key]) == o else ""}>{o}</option>'
                for o in shine.COLOUR_BLENDS)
            rows.append(
                f'<label>{lbl} <select class="{cls}" '
                f'title="overlay/soft_light keep the original texture &amp; '
                f'shading; tint = flat colour">{opts}</select></label>')
            continue
        if key == "kind":
            opts = "".join(
                f'<option value="{o}"'
                f'{" selected" if str(d[key]) == o else ""}>{o}</option>'
                for o in shine.BLUR_KINDS)
            rows.append(
                f'<label>{lbl} <select class="{cls}" '
                f'title="gaussian = symmetric 2D; horizontal/vertical = 1D '
                f'smear along that axis; box = uniform (harsher)">'
                f'{opts}</select></label>')
            continue
        lo, hi = ranges.get(key, (None, None))
        step = "1" if isinstance(dv, int) else (
            "0.05" if (hi is not None and hi <= 3) else "0.5")
        mn = f' min="{lo}"' if lo is not None else ""
        mx = f' max="{hi}"' if hi is not None else ""
        rows.append(
            f'<label>{lbl} <input type="number" class="{cls}" step="{step}"'
            f'{mn}{mx} style="width:58px" value="{d[key]}"></label>')
    return (
        f'<div class="shinebox" style="margin-top:6px;border-top:1px solid '
        f'#36363d;padding-top:6px">'
        f'<div style="font-size:11px;color:#aaa;margin-bottom:4px">'
        f'{_FX_BLURB.get(mode, mode)} — tweak &amp; build</div>'
        f'<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;'
        f'font-size:11px;color:#999">{"".join(rows)}</div>'
        f'<button class="mini" style="margin-top:5px" '
        f'onclick="fxBuild(\'{n}\')" title="Build this region locally from '
        f'its source with the settings above (no ComfyUI, no credits)">'
        f'⚙ build {html.escape(mode)}</button></div>'
    )


# Back-compat: old callers/tests referenced _shine_controls.
def _shine_controls(name: str, saved: dict) -> str:
    return _fx_controls(name, "shine", saved)


def load_config() -> dict:
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError, OSError):
        # First run (empty R2/staging): seed a default so Settings works.
        cfg = dict(DEFAULT_CONFIG)
        try:
            save_config(cfg)
        except OSError:
            pass
        return cfg


def save_config(cfg: dict) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    _mirror(CONFIG_PATH)


def creative_manifest_path() -> Path:
    """The editable JSON that stores *creative* data (prompts, seeds, refs).
    Geometry is never stored here when an `.atlas` is bound. If a bare
    `.atlas` is the active selection, creative edits live in its sibling
    `atlas_manifest_<stem>.json`, auto-created and bound to that `.atlas`
    so nothing the user types is lost."""
    name = load_config().get("manifest_path", "atlas_manifest_symbolsStatic.json")
    sel = Path(name).name  # tolerate legacy "tools/..." values
    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    if sel.lower().endswith(".atlas"):
        jp = MANIFEST_DIR / f"atlas_manifest_{Path(sel).stem}.json"
        if not jp.exists():
            jp.write_text(json.dumps({
                "atlas": {"atlas_file": sel},
                "style": {"positive_prefix": "", "positive_suffix": "", "negative": ""},
                "regions": [],
            }, indent=2, ensure_ascii=False), encoding="utf-8")
            _mirror(jp)
        return jp
    return MANIFEST_DIR / sel


def manifest_path() -> Path:
    return creative_manifest_path()


def list_manifests() -> list[str]:
    if not MANIFEST_DIR.exists():
        return []
    js = sorted(p.name for p in MANIFEST_DIR.glob("atlas_manifest_*.json"))
    at = sorted(p.name for p in MANIFEST_DIR.glob("*.atlas"))
    return js + at


def _drop_fx_snapshot(name: str) -> None:
    """Discard a region's frozen FX source (refs/fxsrc_<name>.png) so the
    next FX build re-captures from the new image. Called whenever the real
    source changes: user supplies an image, reverts, or switches to AI."""
    try:
        (INPUT_DIR / f"refs/fxsrc_{name}.png").unlink(missing_ok=True)
    except OSError:
        pass


def _empty_manifest() -> dict:
    return {"atlas": {}, "style": {"positive_prefix": "",
            "positive_suffix": "", "negative": ""}, "regions": []}


# Set by load_manifest() when the configured manifest is missing/corrupt;
# _index() turns it into a visible banner instead of letting the page 500.
_load_warning: str = ""


def load_manifest() -> dict:
    """The active manifest, or an empty in-memory instance if the configured
    file was renamed/deleted/corrupted. Never raises — a bad manifest must not
    take the whole UI down; it surfaces as a banner so the user can pick
    another from the dropdown or recreate it."""
    global _load_warning
    mp = manifest_path()
    try:
        m = json.loads(mp.read_text(encoding="utf-8"))
        _load_warning = ""
        return m
    except FileNotFoundError:
        _load_warning = (f"Manifest \"{mp.name}\" was not found (renamed or "
                         f"deleted). Showing an empty instance — pick another "
                         f"manifest from Settings, or Save to recreate it.")
    except (ValueError, OSError) as e:
        _load_warning = (f"Manifest \"{mp.name}\" could not be read "
                         f"({type(e).__name__}: {e}). Showing an empty "
                         f"instance — fix the file or pick another in "
                         f"Settings.")
    return _empty_manifest()


def save_manifest(data: dict) -> None:
    mp = manifest_path()
    mp.parent.mkdir(parents=True, exist_ok=True)
    mp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    _mirror(mp)


def all_regions(m: dict) -> list[dict]:
    """Geometry-aware. When the manifest is bound to a `.atlas`, cards are
    built from the `.atlas` regions merged with this manifest's creative
    data (by name). No `.atlas` → legacy cell-grid / explicit-geometry list."""
    ap = batch_atlas.atlas_file_path(m, manifest_path())
    if ap and ap.exists():
        try:
            return batch_atlas.merge_atlas_regions(m, atlas_format.parse_atlas(ap))
        except (OSError, ValueError):
            pass
    return list(m.get("regions", [])) + list(m.get("rotated_regions", []))


def atlas_file() -> Path:
    stem = manifest_path().stem.replace("atlas_manifest_", "")
    return ATLAS_DIR / f"{stem}_new.png"


def variant_files(name: str) -> list[Path]:
    if not BATCH_DIR.exists():
        return []
    # Exact-region match only. A plain glob('<name>_*.png') also matches
    # prefix-sharing regions ('10x' would grab '10x_shine_*'), which made
    # both cards show the same image/seed and Create Atlas pick wrong art.
    return batch_atlas.variant_files(BATCH_DIR, name)


def latest_output(name: str) -> Path | None:
    files = variant_files(name)
    return files[-1] if files else None


def variant_id(p: Path) -> str:
    """ComfyUI saves '<prefix>_<NNNNN>_.png'. Extract the trailing numeric
    counter. Region names may contain underscores (m1_4x, m2_5x…), so a
    naive split('_')[1] is wrong — match the final digit group instead."""
    m = re.search(r"_(\d+)_?$", p.stem)
    return m.group(1) if m else p.stem


def variant_path(name: str, vid: str) -> Path | None:
    for p in variant_files(name):
        if variant_id(p) == vid:
            return p
    return None


def seed_of(path: Path) -> int | None:
    """Read the KSampler seed from a ComfyUI PNG's embedded prompt metadata."""
    try:
        info = Image.open(path).info
        prompt = info.get("prompt")
        if not prompt:
            return None
        data = json.loads(prompt)
        for node in data.values():
            if node.get("class_type") == "KSampler":
                return node["inputs"].get("seed")
    except Exception:  # noqa: BLE001
        return None
    return None


def thumb_bytes(path: Path, box: int = 240) -> bytes:
    img = Image.open(path).convert("RGBA")
    img.thumbnail((box, box), Image.LANCZOS)
    bg = Image.new("RGBA", img.size, (32, 32, 36, 255))
    bg.alpha_composite(img)
    buf = io.BytesIO()
    bg.convert("RGB").save(buf, "JPEG", quality=85)
    return buf.getvalue()


def stop_render() -> str:
    """Terminate the running batch_atlas subprocess and best-effort interrupt
    the in-flight ComfyUI generation."""
    global _stopped
    _stopped = True
    proc = _render_proc
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
    try:  # best effort: tell ComfyUI to abort the current job
        req = urllib.request.Request(
            f"{batch_atlas.COMFY_BASE}/interrupt", data=b"", method="POST",
            headers=batch_atlas.CF_HEADERS)
        urllib.request.urlopen(req, timeout=5).read()
    except Exception:  # noqa: BLE001
        pass
    return "Stopping…"


def _run_cmd(cmd: list[str], total: int) -> None:
    global _render_proc, _stopped
    _stopped = False
    with _render_lock:
        _render_state.update(running=True, log="", done=False, cur=0, total=total)
    try:
        # Generation runs as a subprocess that re-resolves the (client,
        # project) from env at its own start — so pass the UI's *current*
        # context through (IW_CLIENT_NAME + IW_PROJECT_NAME win in
        # cloud_paths.env_client()/env_project()), else a switched UI would
        # generate into the env-default context.
        env = dict(os.environ)
        env["IW_PROJECT_NAME"] = project_paths.project_name()
        env["IW_CLIENT_NAME"] = project_paths.client_name()
        proc = subprocess.Popen(cmd, cwd=str(SELF), env=env, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, text=True, bufsize=1)
        _render_proc = proc
        for line in proc.stdout:
            with _render_lock:
                _render_state["log"] += line
                mt = _PROG_RE.search(line)
                if mt:
                    _render_state["cur"] = int(mt.group(1))
                    _render_state["total"] = int(mt.group(2))
        proc.wait()
        with _render_lock:
            tag = "[STOPPED by user]" if _stopped else f"[exit {proc.returncode}]"
            _render_state["log"] += f"\n{tag}\n"
    except Exception as e:  # noqa: BLE001
        with _render_lock:
            _render_state["log"] += f"\n[ERROR] {e}\n"
    finally:
        _render_proc = None
        with _render_lock:
            _render_state.update(running=False, done=True)


def run_render(names: list[str], variants: int = 1) -> None:
    cmd = [PY, str(TOOLS / "batch_atlas.py"),
           "--only", ",".join(names), "--include-rotated",
           "--variants", str(max(1, variants))]
    _run_cmd(cmd, len(names) * max(1, variants))


def run_compose() -> None:
    cmd = [PY, str(TOOLS / "batch_atlas.py"),
           "--include-rotated", "--include-hidden", "--compose-only"]
    _run_cmd(cmd, 1)


SPLASH = """<!doctype html><html><head><meta charset="utf-8">
<title>Invisible Atlas Maker — booting…</title>
<style>
 html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden}
 body{font-family:'Consolas','Courier New','Lucida Console',monospace;
      color:#33ff66;font-size:15px;line-height:1.45;
      text-shadow:0 0 1px #33ff66,0 0 6px rgba(51,255,102,.55)}
 .crt{position:relative;width:100%;height:100%;padding:36px 44px;box-sizing:border-box;
      overflow:hidden}
 /* phosphor scanlines */
 .crt::before{content:"";position:absolute;inset:0;pointer-events:none;
   background:repeating-linear-gradient(0deg,
     rgba(0,0,0,0) 0px,rgba(0,0,0,0) 2px,
     rgba(0,0,0,.18) 3px,rgba(0,0,0,.18) 4px);
   mix-blend-mode:multiply;z-index:2}
 /* vignette + curvature hint */
 .crt::after{content:"";position:absolute;inset:0;pointer-events:none;
   background:radial-gradient(ellipse at center,
     rgba(0,0,0,0) 55%,rgba(0,0,0,.55) 100%);z-index:3}
 .scr{position:relative;z-index:1;white-space:pre-wrap;word-break:break-word}
 .ttl{font-size:18px;font-weight:bold;letter-spacing:2px}
 .dim{opacity:.55}
 .ok{color:#9cff9c}
 .err{color:#ff6e6e;text-shadow:0 0 6px rgba(255,80,80,.6)}
 .cur{display:inline-block;width:.55em;height:1em;vertical-align:-2px;
      background:#33ff66;box-shadow:0 0 6px #33ff66;
      animation:blink 1s steps(1) infinite}
 @keyframes blink{50%{opacity:0}}
 /* subtle CRT power-on flash */
 @keyframes power{0%{opacity:0;transform:scaleY(.02)}
                  40%{opacity:1;transform:scaleY(1)}
                  100%{opacity:1;transform:scaleY(1)}}
 .crt{animation:power .55s ease-out 1}
</style></head>
<body><div class="crt"><pre class="scr" id="scr"></pre></div>
<script>
(function(){
 const scr=document.getElementById('scr');

 // ASCII logo — mirrors the Invisible Wall corner-bracket emblem
 // (heavy box-drawing ┏━ / ┃) with the wordmark inset. Revealed line by
 // line at startup, then the typewriter runs underneath it.
 const LOGO=[
  "",
  "   ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  "   ┃",
  "   ┃    I N V I S I B L E   W A L L   S L",
  "   ┃    ─────────────────────────────────────",
  "   ┃    A T L A S   M A K E R     ·     v1.0",
  "   ┃",
  ""
 ];

 // Brief intro + dateline. Always plays in full.
 const INTRO=[
  {pre:"BIOS POST 1981  ·  640K base  ·  64512K extended free", cls:"dim"},
  {pre:"(c) Invisible Wall SL  ·  terminal mode",               cls:"dim"},
  {pre:""}
 ];
 // Looping pool. Typed in sequence, restarts at the top if the real UI
 // hasn't arrived yet — so the screen stays alive however long the boot
 // takes. Mix of real-ish probes, atlas-themed work, and BBS-era flavor.
 const WORK=[
  {pre:"> Heating cathode-ray tube",          tail:"OK"},
  {pre:"> Allocating phosphor buffer",        tail:"OK"},
  {pre:"> Calibrating scanlines",             tail:"OK"},
  {pre:"> Reading atlas_config.json",         tail:"OK"},
  {pre:"> Resolving active project",          tail:"OK"},
  {pre:"> Negotiating with ComfyUI",          tail:"OK"},
  {pre:"> Walking manifest directory",        tail:"OK"},
  {pre:"> Parsing region geometry",           tail:"OK"},
  {pre:"> Indexing prior variants",           tail:"OK"},
  {pre:"> Verifying seed integrity",          tail:"OK"},
  {pre:"> Cross-checking shape references",   tail:"OK"},
  {pre:"> Probing GPU memory",                tail:"OK"},
  {pre:"> Warming up Stable Diffusion",       tail:"OK"},
  {pre:"> Linking IPAdapter weights",         tail:"OK"},
  {pre:"> Aligning rim-light vectors",        tail:"OK"},
  {pre:"> Polishing 3D fruit shaders",        tail:"OK"},
  {pre:"> Loading LoRA: gameIconInstitute3d", tail:"OK"},
  {pre:"> Loading LoRA: Y2K TYPEFACE FLUX",   tail:"OK"},
  {pre:"> Reticulating splines",              tail:"OK"},
  {pre:"> Hydrating UI state",                tail:"OK"},
  {pre:"> Refreshing comfy.org credit chip",  tail:"OK"},
  {pre:"> Composing region grid",             tail:"OK"},
  {pre:"> Defragmenting pixel cache",         tail:"OK"},
  {pre:"> Tuning mascot: watermelon (shades)",tail:"OK"},
  {pre:"> Tuning mascot: orange (bow tie)",   tail:"OK"},
  {pre:"> Brewing fresh phosphor green",      tail:"OK"},
  {pre:"> Sharpening Canny edges",            tail:"OK"},
  {pre:"> Computing optimal seed lattice",    tail:"OK"},
  {pre:"> Sweeping ControlNet latent space",  tail:"OK"},
  {pre:"> Inflating PNG decompressor",        tail:"OK"},
  {pre:"> Greasing the atlas packer",         tail:"OK"},
  {pre:"> Lighting up neon-purple frame",     tail:"OK"},
  {pre:"> Asking the slot machine for luck",  tail:"OK"},
  {pre:"> Waking subprocess.Popen",           tail:"OK"},
  {pre:"> Annealing the random generator",    tail:"OK"}
 ];

 // The server is, by definition, ready — if the splash HTML reached the
 // browser, the HTTP server is up. So no probe is needed. We just play
 // the splash for a short MIN_TIME, then navigate to `?fast=1` where
 // _index() renders ONCE for the real UI. Before this we were fetching
 // /_index_html as a "readiness probe" which itself triggered a full
 // _index() render server-side — so every cold start rendered the heavy
 // UI twice (probe + navigation).
 const MIN_SPLASH_MS=1400;   // hard floor so the logo + a few lines play
 const splashStart=Date.now();
 let uiErr=null;
 const ready=()=>(Date.now()-splashStart)>=MIN_SPLASH_MS;

 const CURSOR='<span class="cur"></span>';
 const FILL=44;        // column at which [ OK ] right-aligns
 const TICK_MIN=28,TICK_MAX=46;  // jittered per char so it feels human
 const DOT=14;
 const PAUSE_MIN=120,PAUSE_MAX=260;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const jitter=(lo,hi)=>lo+Math.floor(Math.random()*(hi-lo+1));
 const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

 // Render = committed lines + the live in-progress line + cursor.
 const lines=[];
 let live='';
 // Auto-scroll the screen as content grows past one viewport.
 function paint(){
  scr.innerHTML=lines.join('\\n')+(lines.length?'\\n':'')+live+CURSOR;
  window.scrollTo(0,document.body.scrollHeight);
 }

 // (ready() is defined up top — true once MIN_SPLASH_MS has elapsed.
 // typeLine() / run() consult it to bail out of typing as soon as we're
 // allowed to navigate, so the splash never overstays its welcome.)

 async function typeLine(p){
  const text=p.pre||'';
  const cls=p.cls||'';
  const open=cls?'<span class="'+cls+'">':'';
  const close=cls?'</span>':'';
  live='';
  for(let i=0;i<text.length;i++){
   if(ready()){ // commit what's typed so far, bail.
    if(i>0){ lines.push(open+esc(text.slice(0,i))+close); }
    live=''; paint(); return;
   }
   live=open+esc(text.slice(0,i+1))+close;
   paint();
   await sleep(jitter(TICK_MIN,TICK_MAX));
  }
  if(typeof p.tail!=='undefined'){
   const pad=Math.max(3,FILL-text.length);
   let dots='';
   for(let i=0;i<pad;i++){
    if(ready()){
     lines.push(open+esc(text)+close+dots);
     live=''; paint(); return;
    }
    dots+='.';
    live=open+esc(text)+close+dots;
    paint();
    await sleep(DOT);
   }
   if(p.tail){
    live=open+esc(text)+close+dots+' [ <span class="ok">'+esc(p.tail)+'</span> ]';
    paint();
   }
  }
  lines.push(live);
  live='';
  paint();
  // Inter-line pause is the *worst* place to be slow once fetch is in —
  // skip the pause entirely when ready.
  if(!ready()) await sleep(jitter(PAUSE_MIN,PAUSE_MAX));
 }

 // Pool iterator that yields lines indefinitely, shuffling each cycle so a
 // long boot doesn't show the exact same sequence twice.
 function* poolForever(arr){
  const a=arr.slice();
  while(true){
   for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
   }
   for(const x of a) yield x;
  }
 }

 (async function run(){
  // Reveal the ASCII logo line by line — fast, no typewriter (block chars
  // would look noisy typed). Brief stagger so it draws in like a CRT
  // refresh sweep rather than blinking in all at once. Skip the per-line
  // pause once the fetch is in, so we never linger.
  for(const ln of LOGO){
   lines.push('<span class="ttl">'+esc(ln)+'</span>');
   paint();
   if(ready()) break;
   await sleep(55);
  }
  if(!ready()){
   for(const p of INTRO){ if(ready()) break; await typeLine(p); }
  }
  if(!ready()){
   const gen=poolForever(WORK);
   while(!ready()){
    const {value}=gen.next();
    await typeLine(value);
   }
  }
  if(uiErr){
   lines.push('');
   lines.push('<span class="err">&gt; FATAL: '+esc(uiErr)+'</span>');
   lines.push('<span class="dim">Check the launcher console and retry.</span>');
   paint();
   return;
  }
  // Navigate to the real UI. Uses location.replace so the splash doesn't
  // stay in browser history (Back button skips it). `?fast=1` makes the
  // server skip the splash for any subsequent reload — that's how Save
  // Settings (and any other location.reload() in the UI) avoids replaying
  // the splash every time.
  window.location.replace('?fast=1');
 })();
})();
</script></body></html>"""


PAGE = """<!doctype html><html><head><meta charset="utf-8">
<title>Invisible Atlas Maker</title>
<style>
 body{{font-family:system-ui,Arial;background:#1d1d22;color:#e8e8ea;margin:0;padding:0 20px 40px}}
 header{{display:flex;align-items:center;gap:14px;padding:16px 0;border-bottom:1px solid #333}}
 header img.logo{{height:42px;width:42px;object-fit:contain}}
 header .t{{font-size:18px;font-weight:600}} header .s{{font-size:12px;color:#888}}
 .credits{{float:right;font-size:13px;font-weight:600;color:#cfeede;background:#2e6b3e;border:1px solid #3f8a52;border-radius:6px;padding:6px 12px;text-decoration:none;white-space:nowrap}}
 .credits.low{{background:#7a4a1f;border-color:#a4702f;color:#ffe2bd}}
 .credits.err{{background:#7a2f2f;border-color:#a44;color:#ffd5d5}}
 .filefld{{display:flex;gap:4px;align-items:stretch}} .filefld input{{flex:1}}
 .fbtn{{background:#444;color:#fff;border:0;border-radius:4px;padding:0 9px;cursor:pointer;font-size:14px}} .fbtn:hover{{background:#555}}
 .fsrow{{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;cursor:pointer}}
 .fsrow:hover{{background:#33333a}} .fsrow .ic{{width:18px;text-align:center}}
 .fsrow.file{{color:#cfeede}} .fsrow.up{{color:#9bb;font-weight:600}}
 .bar{{position:sticky;top:0;background:#1d1d22;padding:10px 6px;border-bottom:1px solid #333;margin-bottom:16px;z-index:50;display:flex;flex-wrap:wrap;align-items:center;gap:8px}}
 .bargrp{{display:flex;align-items:center;gap:6px;padding:6px 10px 6px 8px;border-radius:8px;background:#23232a;border:1px solid #2f2f37;position:relative}}
 .bargrp > .glbl{{font-size:10px;color:#8a8a95;text-transform:uppercase;letter-spacing:.6px;font-weight:700;padding:0 6px 0 2px;border-right:1px solid #34343d;margin-right:4px;align-self:stretch;display:flex;align-items:center}}
 .barspacer{{flex:1}}
 .barstatus{{display:flex;align-items:center;gap:8px;margin-left:auto}}
 button,a.btnlink{{background:#3f789e;color:#fff;border:0;padding:9px 16px;border-radius:6px;cursor:pointer;font-size:14px;position:relative;overflow:hidden}}
 button:hover,a.btnlink:hover{{background:#4f8aae}} button:disabled{{cursor:wait}}
 a.btnlink{{text-decoration:none;display:inline-block;line-height:normal;box-sizing:border-box}}
 button.alt,a.btnlink.alt{{background:#444}} button.alt:hover,a.btnlink.alt:hover{{background:#555}}
 #rbtn .fill{{position:absolute;left:0;top:0;bottom:0;background:rgba(255,255,255,.22);width:0%;transition:width .4s}}
 #rbtn span.lbl{{position:relative;z-index:1}}
 .toast{{display:none;margin-left:14px;padding:6px 12px;border-radius:6px;background:#2e6b3e;color:#cfeede;font-size:13px}}
 details.settings{{background:#27272d;border:1px solid #36363d;border-radius:8px;margin-bottom:18px;padding:0 14px}}
 /* Session bar = the two "starting point" pickers (active project + active
    manifest). Visually distinct from settings details so they read as
    context-switchers, not as another field group buried in Global. */
 .sessionbar{{display:flex;align-items:center;gap:14px;flex-wrap:wrap;
   background:linear-gradient(180deg,#2a3340,#222831);
   border:1px solid #3f4d5e;border-left:4px solid #6fb0c8;
   border-radius:8px;padding:12px 18px;margin-bottom:14px;
   box-shadow:0 1px 0 rgba(255,255,255,.04) inset}}
 .sessionbar .ssn-title{{font-size:11px;letter-spacing:1.2px;
   text-transform:uppercase;color:#9ec6d6;font-weight:700;margin-right:4px}}
 .sessionbar .ssn-field{{display:flex;align-items:center;gap:6px;
   font-size:12px;color:#cfd8df}}
 .sessionbar select{{background:#1a1f26;color:#eaeef3;
   border:1px solid #46566a;border-radius:5px;padding:6px 8px;
   font-size:13px;min-width:200px}}
 .sessionbar select:hover{{border-color:#6fb0c8}}
 .sessionbar .qm{{cursor:help;color:#6fb0c8;font-weight:700;
   border:1px solid #3a5b66;border-radius:50%;padding:0 5px;font-size:11px}}
 .sessionbar .ssn-note{{font-size:11px;color:#7e93a6;margin-left:auto}}
 .sessionbar.busy{{opacity:.65;pointer-events:none}}
 details.settings summary{{cursor:pointer;padding:12px 0;font-weight:600}}
 .cfggrid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;padding:6px 0 16px}}
 .cfggrid label{{display:flex;flex-direction:column;font-size:12px;color:#aaa;gap:3px}}
 .cfggrid .qm{{cursor:help;color:#6fb0c8;font-weight:700;margin-left:5px;border:1px solid #3a5b66;border-radius:50%;padding:0 5px;font-size:11px}}
 .cfggrid .lblrow{{display:flex;align-items:center}}
 .cfggrid input,.cfggrid select{{background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:6px;font-size:13px}}
 .grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:16px}}
 .card{{background:#27272d;border:1px solid #36363d;border-radius:8px;padding:12px}}
 .card h3{{margin:0 0 8px;font-size:15px}} .card .role{{color:#999;font-size:12px;margin-bottom:8px}}
 .imgs{{display:flex;gap:8px;margin-bottom:8px}}
 .imgs figure{{margin:0;flex:1;text-align:center}}
 .imgs a{{display:block}}
 .imgs img{{width:100%;height:160px;object-fit:contain;background:#1a1a1e;border-radius:4px;transition:transform .18s;cursor:zoom-in}}
 .imgs img:hover{{transform:scale(2.4);position:relative;z-index:30;box-shadow:0 0 24px #000}}
 .imgwrap{{position:relative;display:block}}
 /* reference picture: no zoom rollover — a click-to-use overlay instead */
 .refwrap{{position:relative;display:block}}
 .refwrap img{{cursor:pointer}}
 .refwrap img:hover{{transform:none;box-shadow:none;z-index:auto}}
 .usebtn{{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
   background:rgba(18,18,22,.55);color:#fff;font-size:13px;font-weight:700;letter-spacing:.5px;
   border:0;border-radius:4px;cursor:pointer;opacity:0;transition:opacity .12s}}
 .refwrap:hover .usebtn{{opacity:1}}
 .usebtn:hover{{background:rgba(46,107,62,.78)}}
 /* transparent guard strips: hovering the top/bottom 20% does NOT hover
    the image, so no zoom there and the variants button stays reachable */
 .hz{{position:absolute;left:0;width:100%;height:20%;z-index:35}}
 .hz.top{{top:0}} .hz.bot{{bottom:0}}
 .vbtn{{position:absolute;left:6px;bottom:6px;z-index:40;font-size:10px;padding:3px 7px;background:rgba(18,18,22,.78);color:#e0e0e2;border:1px solid #4a4a52;border-radius:4px;cursor:pointer;transition:opacity .12s}}
 .vbtn:hover{{background:rgba(45,45,54,.96);border-color:#6a9}}
 /* shine mode: only the shine controls + the preview; everything else off */
 .cpbtn,.ptbtn{{font-size:11px;padding:1px 6px;margin-left:4px;background:#2a2a31;color:#cdd;border:1px solid #444;border-radius:4px;cursor:pointer}}
 .cpbtn:hover,.ptbtn:hover{{background:#34343d;border-color:#6a9}}
 .ptbtn{{display:none}}            /* shown only once something is copied */
 .cppill{{margin-left:12px;padding:5px 10px;border-radius:6px;background:#2e3a2e;color:#cfe7cf;font-size:12px}}
 .cppill a{{color:#9ad29a;text-decoration:none;font-weight:600}}
 .modesel{{float:right;font-size:11px;background:#1a1a1e;color:#ddd;border:1px solid #3a5b66;border-radius:4px;padding:2px 5px;margin-left:6px;cursor:pointer}}
 .shinebox{{display:none}}
 .card.smode .shinebox{{display:block}}
 .card.smode .vbtn,
 .card.smode .ovctl,
 .card.smode .reffig,
 .card.smode .seedrow,
 .card.smode .promptbox,
 .card.smode .advrow{{display:none}}
 /* hide the button while the image is hovered (zoomed); hovering the
    button itself doesn't hover the image, so it stays clickable */
 .imgwrap a:hover ~ .vbtn{{opacity:0;pointer-events:none}}
 .imgs figcaption{{font-size:11px;color:#888;margin-top:2px}}
 .refctl{{display:flex;flex-direction:column;gap:4px;margin-top:6px;align-items:center}}
 .refctl input[type=file]{{font-size:10px;max-width:180px;color:#aaa}}
 .filerow{{display:flex;align-items:center;gap:6px}}
 .xbtn{{background:#9e3f3f;color:#fff;font-size:11px;padding:4px 7px;line-height:1;flex:none}}
 .xbtn:hover{{background:#c24b4b}}
 .modal{{display:none;position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:100;align-items:center;justify-content:center}}
 .modal.open{{display:flex}}
 .modalbox{{background:#26262c;border:1px solid #444;border-radius:10px;width:min(1100px,92vw);max-height:88vh;display:flex;flex-direction:column}}
 .modalhdr{{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #3a3a42;font-size:15px;font-weight:600}}
 .modalhdr button{{background:#444;padding:6px 12px}}
 .modalgrid{{overflow:auto;padding:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}}
 .mv{{position:relative;cursor:pointer;border:3px solid transparent;border-radius:6px;text-align:center;background:#1a1a1e;padding:6px}}
 .mv:hover{{border-color:#4f8aae}} .mv.sel{{border-color:#e0a030}}
 .mv img{{width:100%;height:160px;object-fit:contain;display:block}}
 .mv small{{font-size:11px;color:#9bb;font-family:monospace}}
 .mv .mvc{{position:absolute;top:8px;left:8px;width:20px;height:20px;cursor:pointer;z-index:2}}
 .modalhdr span button{{margin-left:6px}}
 textarea{{width:100%;box-sizing:border-box;background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:6px;font-size:12px;font-family:monospace;min-height:80px;resize:vertical}}
 .row{{display:flex;align-items:center;gap:8px;margin:6px 0;font-size:13px;flex-wrap:wrap}}
 input[type=text]{{background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:5px;width:130px}}
 .lock{{color:#e0a030}} .free{{color:#6a9}}
 .promptbox{{margin-top:6px;border:1px solid #36363d;border-radius:6px;background:#202024}}
 .promptbox summary{{cursor:pointer;padding:6px 8px;font-size:12px;font-weight:600;color:#9bb;user-select:none}}
 .promptbox[open] summary{{border-bottom:1px solid #36363d;margin-bottom:8px}}
 .promptbox .plbl{{display:block;font-size:11px;color:#888;padding:0 8px;margin:6px 0 3px}}
 .promptbox textarea{{width:calc(100% - 16px);margin:0 8px 4px;min-height:60px}}
 .promptbox textarea.pr{{min-height:80px}}
 .promptbox .rneglbl{{display:flex;align-items:center;gap:6px;font-size:12px;color:#aaa;padding:2px 8px 8px}}
 .negbadge{{color:#e0a030;font-weight:600}}
 .gptbadge{{background:#2e6b3e;color:#cfeede;font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;margin-left:6px;vertical-align:middle}}
 .usedseed{{font-size:12px;color:#9bb;font-family:monospace}}
 .mini{{font-size:11px;padding:4px 8px}}
 #log{{white-space:pre-wrap;background:#111;color:#9c9;padding:10px;border-radius:6px;font-family:monospace;font-size:12px;max-height:220px;overflow:auto;margin-top:14px;display:none}}
</style></head><body>
<header>
 <img class="logo" src="/logo" alt="IW">
 <div><div class="t">Invisible Atlas Maker</div>
 <div class="s">by Invisible Wall SL &nbsp;·&nbsp; Manifest: {manifest_name} &nbsp;·&nbsp; <b style="color:#6a9">build {build}</b></div></div>
</header>
{notice}
<div class="bar">
 <div class="bargrp" title="Atlas-level actions: edit, save, compose, view, deploy">
  <span class="glbl">Atlas</span>
  <button onclick="saveAll()" class="alt">💾 Save changes</button>
  <button onclick="selAll(true)" class="alt">Select all</button>
  <button onclick="selAll(false)" class="alt">Select none</button>
  <button onclick="createAtlas()" id="abtn" style="background:#629432">🧩 Create Atlas</button>
  <button onclick="sliceAtlas()" class="alt" title="Cut the Atlas source image into per-region crops and set them as each region's IPAdapter style ref">✂ Slice source → refs</button>
  <button onclick="uploadAtlas()" class="alt" title="Upload a .atlas geometry file (and its source page image) into R2 and repoint this manifest, so Slice/Compose resolve in the cloud">⬆ Upload .atlas</button>
  <input type="file" id="uplAtlasFile" accept=".atlas" style="display:none" onchange="onAtlasFilePicked()">
  <input type="file" id="uplAtlasImg" accept="image/*" style="display:none" onchange="onAtlasImgPicked()">
  <button onclick="viewAtlas()" class="alt">🖼 View atlas</button>
  <button onclick="deployAtlas()" class="alt" title="Copy the built atlas (.png/.webp) to this manifest's Deploy folder, overwriting <stem>.png/.webp there. Set the folder in Atlas settings.">📦 Deploy atlas</button>
  {spine_link}
 </div>
 <div class="bargrp" title="Generation/rendering controls — talks to ComfyUI">
  <span class="glbl">Processing</span>
  <button onclick="renderSel()" id="rbtn"><span class="fill"></span><span class="lbl">▶ Render selected</span></button>
  <button onclick="stopRender()" id="sbtn" style="background:#9e3f3f;display:none">■ Stop</button>
  <label style="margin:0 4px 0 6px;font-size:13px;color:#bbb">variants/symbol
   <input type="number" id="variants" value="4" min="1" max="30" style="width:56px;background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:5px;margin-left:4px"></label>
 </div>
 <div class="bargrp" title="Reference & account links">
  <span class="glbl">Docs/credits</span>
  <a class="alt" href="/docs" target="_blank" title="What every control does — opens a self-contained reference page" style="display:inline-block;padding:9px 16px;border-radius:6px;color:#fff;background:#444;text-decoration:none;font-size:14px">📖 Docs</a>
  <a id="credits" class="credits" href="https://platform.comfy.org" target="_blank" title="comfy.org API-node credit balance (click to top up). Refreshes automatically.">◆ credits …</a>
 </div>
 <div class="barstatus">
  <span id="cppill" class="cppill" style="display:none"></span>
  <span id="toast" class="toast">✓ Done</span>
  <span id="stat" style="color:#999"></span>
 </div>
</div>
<div class="sessionbar" id="sessionbar">
 <span class="ssn-title">Session</span>
 <span class="ssn-field"><span>Active project{proj_qm}</span>{project_select}</span>
 <span class="ssn-field"><span>Active manifest{manifest_qm}</span>{manifest_select}</span>
 <span class="ssn-note">switching reloads the page</span>
</div>
<details class="settings">
 <summary>⚙ Global settings (atlas_config.json — shared defaults)</summary>
 <div class="cfggrid">{global_fields}</div>
 <button onclick="saveCfg(this)" style="margin-bottom:14px">Save settings</button>
 <span id="cfgstat" style="margin-left:12px;color:#999"></span>
</details>
<details class="settings" open>
 <summary>🧩 Atlas settings — {manifest_name} (per-atlas; blank = inherit global)</summary>
 <div class="cfggrid">{atlas_fields}</div>
 <button onclick="saveCfg(this)" style="margin-bottom:14px">Save settings</button>
 <span id="cfgstat2" style="margin-left:12px;color:#999"></span>
</details>
<details class="settings">
 <summary>📝 Atlas style — applies to all regions in <b>{manifest_name}</b> (per-atlas, not shared)</summary>
 <div style="padding-top:6px">
  <div style="font-size:13px;color:#bbb;margin-bottom:6px">Stored in this manifest only (<code>style.*</code>) — each atlas keeps its own. Final positive = <b>prefix</b> + region prompt + <b>suffix</b>. Per-region negatives are appended to (or, with the per-region checkbox, replace) this atlas's negative.</div>
  <label style="display:block;font-size:12px;color:#aaa;margin:6px 0 3px">Atlas positive prefix (style.positive_prefix)</label>
  <textarea id="gpre" rows="3" style="width:100%;background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:7px;font-size:13px;font-family:monospace;resize:vertical">{global_pre}</textarea>
  <label style="display:block;font-size:12px;color:#aaa;margin:8px 0 3px">Atlas positive suffix (style.positive_suffix)</label>
  <textarea id="gsuf" rows="3" style="width:100%;background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:7px;font-size:13px;font-family:monospace;resize:vertical">{global_suf}</textarea>
  <div data-pipe="sdxl">
   <label style="display:block;font-size:12px;color:#aaa;margin:8px 0 3px">Atlas negative (style.negative) <span style="color:#888;font-size:10px">· SDXL only — FLUX ignores negatives</span></label>
   <textarea id="gneg" rows="6" style="width:100%;background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:7px;font-size:13px;font-family:monospace;resize:vertical">{global_neg}</textarea>
  </div>
  <button onclick="saveGlobalStyle()" style="margin-top:8px">Save atlas style</button>
  <span id="gnegstat" style="margin-left:12px;color:#999"></span>
 </div>
</details>
<div class="grid">{cards}</div>
<div id="modal" class="modal" onclick="if(event.target===this)closeModal()">
 <div class="modalbox">
  <div class="modalhdr"><span id="mtitle">Variants</span>
   <span>
    <button class="alt" onclick="mvCheckAll(true)">Check all</button>
    <button class="alt" onclick="mvCheckAll(false)">Uncheck</button>
    <button onclick="delVariants()" style="background:#9e3f3f">🗑 Delete checked</button>
    <button onclick="closeModal()">✕ close</button>
   </span>
  </div>
  <div id="mgrid" class="modalgrid"></div>
 </div>
</div>
<div id="advmodal" class="modal" onclick="if(event.target===this)closeAdv()">
 <div class="modalbox" style="width:min(480px,92vw)">
  <div class="modalhdr"><span id="advtitle">Advanced</span><button onclick="closeAdv()">✕ close</button></div>
  <div id="advform" style="padding:18px;display:flex;flex-direction:column;gap:12px"></div>
  <div style="padding:0 18px 18px">
   <button onclick="saveAdv()">Save overrides</button>
   <span style="color:#888;font-size:12px;margin-left:10px">empty field = use global setting</span>
  </div>
 </div>
</div>
<div id="fsmodal" class="modal" onclick="if(event.target===this)closeFs()">
 <div class="modalbox" style="width:min(680px,94vw)">
  <div class="modalhdr"><span id="fstitle">Pick a file</span><button onclick="closeFs()">✕ close</button></div>
  <div style="padding:14px 18px 0;display:flex;gap:6px">
   <input id="fspath" placeholder="paste a path, \\\\server\\share, or http(s):// URL" style="flex:1;background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:8px;font-size:13px">
   <button class="mini" onclick="fsGo()">Go</button>
   <button class="mini" onclick="fsUseTyped()" title="Use exactly what's typed (a UNC path or a URL)">Use this</button>
   <button class="mini" id="fspickdir" onclick="fsUseCurDir()" title="Use the folder currently shown above" style="display:none;background:#629432">✓ Use this folder</button>
  </div>
  <div id="fscur" style="padding:8px 18px 0;color:#888;font-size:12px;word-break:break-all"></div>
  <div id="fslist" style="padding:10px 18px 18px;max-height:55vh;overflow:auto;font-size:13px"></div>
 </div>
</div>
<pre id="log"></pre>
<script>
function selAll(v){{document.querySelectorAll('.sel').forEach(c=>c.checked=v);}}
function collect(){{
 let regs=[];
 document.querySelectorAll('.card').forEach(c=>{{
  regs.push({{name:c.dataset.name,
   selected:c.querySelector('.sel').checked,
   prompt:c.querySelector('.pr').value,
   gpt_prompt:c.querySelector('.gptpr').value,
   lock:c.querySelector('.lk').checked,
   seed:c.querySelector('.sd').value.trim(),
   variant:c.dataset.variant||'',
   negative:c.querySelector('.rneg').value,
   negative_replace:c.querySelector('.rnegrep').checked,
   positive_replace:c.querySelector('.rposrep').checked}});
 }});
 return regs;
}}
function cfgData(){{let o={{}};document.querySelectorAll('[data-cfg]').forEach(el=>{{o[el.dataset.cfg]=el.value;}});return o;}}
async function switchSession(sel){{
 // Session-bar dropdowns (active project / active manifest) are context
 // switchers — saving + reloading is the whole interaction, no button.
 // POSTs only the changed field so any unsaved edits in the Atlas /
 // Global settings panels aren't silently committed too.
 const bar=document.getElementById('sessionbar');
 if(bar) bar.classList.add('busy');
 const key=sel.getAttribute('data-cfg');
 try{{
  await fetch('/saveconfig',{{method:'POST',
                              body:JSON.stringify({{[key]:sel.value}})}});
 }}catch(_){{ if(bar) bar.classList.remove('busy'); return; }}
 location.reload();
}}
async function saveCfg(btn){{
 // Route the "Settings saved..." line to the status <span> that lives right
 // next to the clicked button — not to the first one on the page. With two
 // Save buttons (Global + Atlas) the previous always-#cfgstat write meant
 // saving Atlas settings printed feedback under the Global button.
 let stat=(btn&&btn.nextElementSibling)||document.getElementById('cfgstat');
 let r=await fetch('/saveconfig',{{method:'POST',body:JSON.stringify(cfgData())}});
 if(stat) stat.textContent=await r.text(); else await r.text();
 setTimeout(()=>location.reload(),900);
}}
// ONE rule everywhere (Settings, advanced popup, cards): a field shows when
// its data-pipe group matches the active pipeline.
//   all  -> every pipeline (incl. gpt_image)
//   both -> the two local ComfyUI pipelines only (sdxl OR flux), never gpt
//   sdxl|flux|gpt_image -> that pipeline only
function pipeVisible(g,p){{
 if(!g||g==='all')return true;
 if(g==='both')return p==='sdxl'||p==='flux';
 return g===p;
}}
function globalPipe(){{
 let ps=document.querySelector('[data-cfg="pipeline"]');
 return (ps&&ps.value)||'sdxl';
}}
function applyPipe(){{                 // Settings panel (global + per-atlas)
 let p=globalPipe();
 document.querySelectorAll('.cfggrid [data-pipe]').forEach(l=>{{
  l.style.display=pipeVisible(l.getAttribute('data-pipe'),p)?'':'none';
 }});
 applyCardPipes();   // a card inheriting the global pipeline follows it
}}
function applyCardPipes(){{            // each card uses its OWN effective pipe
 let gp=globalPipe();
 document.querySelectorAll('.card').forEach(c=>{{
  let p=c.dataset.effpipe||gp;
  c.querySelectorAll('[data-pipe]').forEach(l=>{{
   l.style.display=pipeVisible(l.getAttribute('data-pipe'),p)?'':'none';
  }});
 }});
}}
document.addEventListener('DOMContentLoaded',function(){{
 let p=document.querySelector('[data-cfg="pipeline"]');
 if(p)p.addEventListener('change',applyPipe);
 applyPipe();
}});
async function saveAll(){{
 let r=await fetch('/save',{{method:'POST',body:JSON.stringify(collect())}});
 document.getElementById('stat').textContent=await r.text();
}}
async function saveGlobalStyle(){{
 let body={{positive_prefix:document.getElementById('gpre').value,
  positive_suffix:document.getElementById('gsuf').value,
  negative:document.getElementById('gneg').value}};
 let r=await fetch('/saveglobalstyle',{{method:'POST',body:JSON.stringify(body)}});
 document.getElementById('gnegstat').textContent=await r.text();
}}
let _uplAtlas=null;   // {{name,text}} held between the two file pickers
function uploadAtlas(){{ _uplAtlas=null; document.getElementById('uplAtlasFile').value=''; document.getElementById('uplAtlasFile').click(); }}
function onAtlasFilePicked(){{
 let f=document.getElementById('uplAtlasFile').files[0]; if(!f)return;
 let rd=new FileReader();
 rd.onload=()=>{{ _uplAtlas={{name:f.name,text:rd.result}};
  if(confirm('Also upload the source page image for '+f.name+'? (needed for Slice / Compose to resolve the atlas page in the cloud)')){{
   let im=document.getElementById('uplAtlasImg'); im.value=''; im.click();
  }} else {{ sendAtlasUpload(null); }}
 }};
 rd.readAsText(f);
}}
function onAtlasImgPicked(){{
 let f=document.getElementById('uplAtlasImg').files[0];
 if(!f){{ sendAtlasUpload(null); return; }}
 let rd=new FileReader();
 rd.onload=()=>{{ let b64=String(rd.result).split(',')[1]||''; sendAtlasUpload({{name:f.name,data:b64}}); }};
 rd.readAsDataURL(f);
}}
async function sendAtlasUpload(img){{
 if(!_uplAtlas)return;
 let st=document.getElementById('stat'); if(st)st.textContent='⬆ Uploading .atlas…';
 let body={{atlas_name:_uplAtlas.name,atlas_text:_uplAtlas.text}};
 if(img){{ body.image_name=img.name; body.image_data=img.data; }}
 let msg;
 try{{ let r=await fetch('/uploadatlas',{{method:'POST',body:JSON.stringify(body)}});
  msg=(r.status===404)?'Upload endpoint missing — restart the service':await r.text();
 }}catch(e){{ msg='Upload failed: '+e; }}
 if(st)st.textContent=msg;
 _uplAtlas=null;
 if(msg.indexOf('✓')===0) setTimeout(()=>location.reload(),2200);
}}
async function sliceAtlas(){{
 if(!confirm('Cut the Atlas source image into per-region crops and set each as its IPAdapter style ref? Existing prompts/seeds are kept.'))return;
 let t=document.getElementById('toast');
 t.style.display='inline-block'; t.textContent='✂ Slicing…';
 let st=document.getElementById('stat'); if(st)st.textContent='✂ Slicing…';
 let msg;
 try{{ let r=await fetch('/sliceatlas',{{method:'POST',body:'{{}}'}});
  msg=(r.status===404)?'Slice endpoint missing — restart run_ui.bat':await r.text();
 }}catch(e){{ msg='Slice request failed: '+e; }}
 t.textContent=msg; if(st)st.textContent=msg;
 if(msg.indexOf('✓')===0) setTimeout(()=>location.reload(),2500);
}}
function updateLock(c){{
 let slot=c.querySelector('.lockslot'); if(!slot)return;
 let lk=c.querySelector('.lk');
 // LOCKED is a *committed resting state* only: shown when the lock checkbox
 // is on and the user has NOT just selected a variant (dirty flag). Browsing
 // / selecting variants always shows the button so you can lock your pick.
 // Lock never happens implicitly — only via the button or the checkbox.
 // Committed = lock on, not mid-browse, AND we have something to pin: a
 // seed (sdxl/flux) OR an explicit variant id (GPT has no seed, so the
 // picked file id IS the lock key).
 let ls=c.dataset.lockedseed||'', vid=c.dataset.variant||'';
 if(c.dataset.dirty!=='1' && lk && lk.checked && (ls||vid)){{
  let what=ls?('seed '+ls):('variant #'+vid);
  slot.innerHTML='<b style="color:#e0a030">🔒 LOCKED · '+what+'</b>';
 }}else{{
  slot.innerHTML='<button class="mini alt" onclick="useSeed(\\''+c.dataset.name+'\\')" title="Pin the currently shown output so Create Atlas always uses exactly it (seed for sdxl/flux, file id for GPT)">🔒 lock this pick</button>';
 }}
}}
function onLockToggle(cb){{
 let c=cb.closest('.card');
 c.dataset.dirty='0';
 if(cb.checked){{
  let s=c.querySelector('.sd').value.trim();
  c.dataset.lockedseed=s;            // lock to whatever Current Seed holds
 }}else{{
  c.dataset.lockedseed='';           // untick truly unlocks
 }}
 updateLock(c);
 saveAll();
}}
function updateAllLocks(){{document.querySelectorAll('.card').forEach(updateLock);}}
function useSeed(name){{
 let c=document.querySelector('.card[data-name="'+name+'"]');
 let s=c.dataset.usedseed, vid=c.dataset.variant||'';
 let hasSeed=s&&s!=='None';
 if(!hasSeed && !vid){{alert('Pick a variant first (▦ variants), then lock');return;}}
 if(hasSeed)c.querySelector('.sd').value=s;
 c.querySelector('.lk').checked=true;
 c.dataset.lockedseed=hasSeed?s:'';   // GPT: no seed — locked by variant id
 c.dataset.dirty='0';        // committing the lock clears the browsing state
 updateLock(c);
 saveAll();
}}
function uploadRef(name){{
 let c=document.querySelector('.card[data-name="'+name+'"]');
 let f=c.querySelector('.rf').files[0];
 if(!f){{alert('Pick an image file first');return;}}
 let rd=new FileReader();
 rd.onload=async()=>{{
  let b64=rd.result.split(',')[1];
  let r=await fetch('/setref',{{method:'POST',body:JSON.stringify({{name:name,data:b64}})}});
  document.getElementById('stat').textContent=await r.text();
  let cb=Date.now();
  c.querySelectorAll('img').forEach(im=>{{if(im.src.includes('/ref/'))im.src='/ref/'+name+'?t='+cb;}});
 }};
 rd.readAsDataURL(f);
}}
async function clearRef(name){{
 let r=await fetch('/clearref',{{method:'POST',body:JSON.stringify({{name:name}})}});
 document.getElementById('stat').textContent=await r.text();
 let c=document.querySelector('.card[data-name="'+name+'"]');
 c.querySelectorAll('img').forEach(im=>{{if(im.src.includes('/ref/'))im.src='/ref/'+name+'?t='+Date.now();}});
}}
function useMyImage(name){{
 let c=document.querySelector('.card[data-name="'+name+'"]');
 let f=c.querySelector('.of').files[0];
 if(!f){{alert('Pick an image file first');return;}}
 let rd=new FileReader();
 rd.onload=async()=>{{
  let b64=rd.result.split(',')[1];
  let r=await fetch('/setoutput',{{method:'POST',body:JSON.stringify({{name:name,data:b64}})}});
  document.getElementById('stat').textContent=await r.text();
  setTimeout(()=>location.reload(),700);
 }};
 rd.readAsDataURL(f);
}}
async function useRefImg(name){{
 let r=await fetch('/userefimg',{{method:'POST',body:JSON.stringify({{name:name}})}});
 document.getElementById('stat').textContent=await r.text();
 setTimeout(()=>location.reload(),700);
}}
async function revertImage(name){{
 let r=await fetch('/clearoutput',{{method:'POST',body:JSON.stringify({{name:name}})}});
 document.getElementById('stat').textContent=await r.text();
 setTimeout(()=>location.reload(),700);
}}
async function shineMode(name,on){{
 let r=await fetch('/shinemode',{{method:'POST',body:JSON.stringify({{name:name,on:on}})}});
 document.getElementById('stat').textContent=await r.text();
 let c=document.querySelector('.card[data-name="'+name+'"]');
 if(c)c.classList.toggle('smode',on);
}}
function _cpSrc(){{return sessionStorage.getItem('cfgsrc');}}
function cpRefresh(){{
 let s=_cpSrc(), p=document.getElementById('cppill');
 document.querySelectorAll('.ptbtn').forEach(b=>b.style.display=s?'inline-block':'none');
 if(!p)return;
 if(s){{p.style.display='';p.innerHTML='📋 settings from <b>'+s+'</b> · '
  +'<a href="#" onclick="pasteSel(event)">Paste into selected</a> · '
  +'<a href="#" onclick="cpClear(event)">✕</a>';}}
 else{{p.style.display='none';}}
}}
function copyCfg(n){{
 sessionStorage.setItem('cfgsrc',n);
 document.getElementById('stat').textContent='Copied settings from '+n+' (not reference/seed) — click 📥 on a target, or Paste into selected';
 cpRefresh();
}}
function cpClear(e){{if(e)e.preventDefault();sessionStorage.removeItem('cfgsrc');cpRefresh();}}
async function pasteCfg(n){{
 let s=_cpSrc();
 if(!s){{alert('Copy a region first with ⧉');return;}}
 if(s===n){{document.getElementById('stat').textContent='Source and target are the same';return;}}
 let r=await fetch('/copyfrom',{{method:'POST',body:JSON.stringify({{src:s,dsts:[n]}})}});
 document.getElementById('stat').textContent=await r.text();
 setTimeout(()=>location.reload(),500);
}}
async function pasteSel(e){{
 if(e)e.preventDefault();
 let s=_cpSrc(); if(!s)return;
 let dsts=[...document.querySelectorAll('.card')].filter(c=>{{
   let cb=c.querySelector('.sel'); return cb&&cb.checked;}})
  .map(c=>c.dataset.name).filter(x=>x&&x!==s);
 if(!dsts.length){{alert('Tick the target cards first (the selection checkboxes)');return;}}
 if(!confirm('Paste settings from '+s+' into '+dsts.length+' selected region(s)? (reference image, seed and lock are kept per-region)'))return;
 let r=await fetch('/copyfrom',{{method:'POST',body:JSON.stringify({{src:s,dsts:dsts}})}});
 document.getElementById('stat').textContent=await r.text();
 setTimeout(()=>location.reload(),600);
}}
document.addEventListener('DOMContentLoaded',cpRefresh);
async function shineFrom(name){{
 let c=document.querySelector('.card[data-name="'+name+'"]');
 let g=s=>c.querySelector(s);
 let body={{name:name,
  color:g('.sh-color')?g('.sh-color').value:undefined,
  blur:g('.sh-blur')?g('.sh-blur').value:undefined,
  intensity:g('.sh-intensity')?g('.sh-intensity').value:undefined,
  layers:g('.sh-layers')?g('.sh-layers').value:undefined}};
 document.getElementById('stat').textContent='✨ building shine…';
 let r=await fetch('/shinefrom',{{method:'POST',body:JSON.stringify(body)}});
 document.getElementById('stat').textContent=await r.text();
 setTimeout(()=>location.reload(),800);
}}
async function setMode(name,mode){{
 await saveAll();   // don't lose card edits across the reload
 document.getElementById('stat').textContent='switching '+name+' → '+mode+'…';
 let r=await fetch('/setmode',{{method:'POST',body:JSON.stringify({{name:name,mode:mode}})}});
 document.getElementById('stat').textContent=await r.text();
 setTimeout(()=>location.reload(),700);
}}
async function fxBuild(name){{
 let c=document.querySelector('.card[data-name="'+name+'"]');
 let sel=c.querySelector('.modesel');
 let body={{name:name,mode:sel?sel.value:''}};
 c.querySelectorAll('[class*="fx-"]').forEach(el=>{{
  let m=(el.className.match(/fx-([a-z_]+)/));
  if(m)body[m[1]]=el.value;
 }});
 document.getElementById('stat').textContent='⚙ building '+body.mode+'…';
 let r=await fetch('/fxbuild',{{method:'POST',body:JSON.stringify(body)}});
 document.getElementById('stat').textContent=await r.text();
 setTimeout(()=>location.reload(),800);
}}
let _modalName=null;
function selectVariant(name,id,seed){{
 let c=document.querySelector('.card[data-name="'+name+'"]');
 let valid=(seed!=null&&seed!=='None'&&String(seed).trim()!=='');
 c.dataset.usedseed=valid?seed:'None';
 // The file id is the real identity of the pick: when a seed is locked,
 // every variant of this region shares that seed, so seed alone can't say
 // WHICH file you chose. Persist the id so compose-only uses this exact one.
 c.dataset.variant=id;
 // Mirror the picked seed into the Current Seed input: that field is the
 // single source of truth for every save path (saveAll/collect AND the
 // lock checkbox via onLockToggle). Without this, ticking lock after
 // picking a variant persists the stale seed instead of the chosen one.
 if(valid)c.querySelector('.sd').value=seed;
 let cb=Date.now();
 let im=c.querySelector('.bigsel'); im.src='/vthumb/'+name+'?id='+id+'&t='+cb;
 c.querySelector('.biglink').href='/vfull/'+name+'?id='+id+'&t='+cb;
 c.querySelector('.selcap').textContent='output · seed '+(valid?seed:'—');
 c.dataset.dirty='1';        // browsing/selecting: always offer the lock button
 updateLock(c);
 closeModal();
}}
async function openVariants(name){{
 _modalName=name;
 document.getElementById('mtitle').textContent='Variants — '+name+' (click one to select it)';
 let g=document.getElementById('mgrid'); g.innerHTML='loading…';
 let j=await (await fetch('/variants/'+name)).json();
 if(!j.length){{g.innerHTML='<div style=color:#888;padding:30px>No variants generated yet for '+name+'. Render it first.</div>';}}
 else{{
  g.innerHTML='';
  let cur=document.querySelector('.card[data-name="'+name+'"]').dataset.usedseed;
  j.forEach(d=>{{
   let div=document.createElement('div'); div.className='mv';
   if(String(d.seed)===String(cur))div.classList.add('sel');
   let cb=document.createElement('input');
   cb.type='checkbox'; cb.className='mvc'; cb.value=d.id;
   cb.title='mark for deletion';
   cb.onclick=e=>e.stopPropagation();
   let img=document.createElement('img'); img.src='/vthumb/'+name+'?id='+d.id+'&t='+Date.now();
   let cap=document.createElement('small'); cap.textContent='seed '+(d.seed??'?');
   div.appendChild(cb); div.appendChild(img); div.appendChild(cap);
   div.onclick=()=>selectVariant(name,d.id,d.seed);
   g.appendChild(div);
  }});
 }}
 document.getElementById('modal').classList.add('open');
}}
function closeModal(){{document.getElementById('modal').classList.remove('open');}}
let _advName=null;
async function openAdv(name){{
 _advName=name;
 document.getElementById('advtitle').textContent='Advanced overrides — '+name;
 let j=await (await fetch('/regionadv/'+name)).json();
 _advGlobalPipe=j.effective||'sdxl';
 let f=document.getElementById('advform'); f.innerHTML='';
 let labelText=fd=>fd.label+(fd.tip?'  ⓘ':'');
 j.fields.forEach(fd=>{{
  let lab=document.createElement('label');
  lab.dataset.pipe=fd.pipe||'all';
  if(fd.tip)lab.title=fd.tip;
  if(fd.select){{
   lab.style.cssText='display:flex;flex-direction:column;font-size:12px;color:#aaa;gap:3px';
   let sel=document.createElement('select');
   sel.dataset.adv=fd.key;
   sel.style.cssText='background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:7px;font-size:13px';
   (fd.options||[]).forEach(o=>{{
    let op=document.createElement('option'); op.value=o;
    op.textContent=(o===''?('(inherit global: '+fd.placeholder+')'):o);
    if(String(fd.value)===o)op.selected=true;
    sel.appendChild(op);
   }});
   if(fd.key==='pipeline')sel.addEventListener('change',applyAdvPipe);
   lab.appendChild(document.createTextNode(labelText(fd)));
   lab.appendChild(sel); f.appendChild(lab); return;
  }}
  if(fd.bool){{
   lab.style.cssText='display:flex;flex-direction:row;align-items:center;font-size:12px;color:#aaa;gap:8px';
   let inp=document.createElement('input');
   inp.type='checkbox'; inp.dataset.adv=fd.key; inp.checked=!!fd.value;
   lab.appendChild(inp); lab.appendChild(document.createTextNode(labelText(fd)));
   f.appendChild(lab); return;
  }}
  lab.style.cssText='display:flex;flex-direction:column;font-size:12px;color:#aaa;gap:3px';
  let inp=document.createElement(fd.multiline?'textarea':'input');
  inp.dataset.adv=fd.key; inp.value=fd.value;
  inp.placeholder=(fd.multiline?'blank = global only · global: ':'global: ')+fd.placeholder;
  inp.style.cssText='background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:7px;font-size:13px';
  if(fd.multiline){{inp.rows=5;inp.style.resize='vertical';inp.style.fontFamily='monospace';}}
  if(fd.numeric){{inp.type='number';
    if(fd.range){{inp.min=fd.range[0];inp.max=fd.range[1];inp.step=fd.range[2];
      inp.title='Valid range '+fd.range[0]+' to '+fd.range[1];}}
    else{{inp.step='any';}}
  }}
  lab.appendChild(document.createTextNode(labelText(fd)));
  // Reference-image fields get a "Pick from R2" button that opens the same
  // /fsbrowse picker and writes the chosen R2-relative path into the input.
  if(fd.key==='style_ref'||fd.key==='shape_ref'){{
   let row=document.createElement('div');
   row.style.cssText='display:flex;gap:6px;align-items:center';
   inp.style.flex='1';
   let btn=document.createElement('button');
   btn.type='button'; btn.className='mini'; btn.textContent='📁 Pick from R2';
   btn.title='Browse the R2 asset repo and use the selected image as this slot\\'s '+fd.key;
   btn.onclick=()=>openFs(fd.key,inp);
   row.appendChild(inp); row.appendChild(btn);
   lab.appendChild(row); f.appendChild(lab); return;
  }}
  lab.appendChild(inp); f.appendChild(lab);
 }});
 applyAdvPipe();
 document.getElementById('advmodal').classList.add('open');
}}
let _advGlobalPipe='sdxl';
function applyAdvPipe(){{
 // Exact same rule as Settings/cards (pipeVisible). "" on the per-slot
 // selector inherits the global pipeline.
 let ps=document.querySelector('#advform [data-adv="pipeline"]');
 let eff=(ps&&ps.value)||_advGlobalPipe;
 document.querySelectorAll('#advform label[data-pipe]').forEach(l=>{{
  l.style.display=pipeVisible(l.dataset.pipe,eff)?'':'none';
 }});
}}
function closeAdv(){{document.getElementById('advmodal').classList.remove('open');}}
async function saveAdv(){{
 let vals={{}};
 document.querySelectorAll('#advform [data-adv]').forEach(el=>{{vals[el.dataset.adv]=(el.type==='checkbox')?(el.checked?'1':''):el.value;}});
 let r=await fetch('/saveadv',{{method:'POST',body:JSON.stringify({{name:_advName,fields:vals}})}});
 document.getElementById('stat').textContent=await r.text();
 // Reflect a per-slot pipeline change on the card immediately (no reload):
 // update its effective pipeline + GPT badge, then re-apply card show/hide.
 let card=document.querySelector('.card[data-name="'+_advName+'"]');
 if(card){{
  let eff=(vals.pipeline||'').trim().toLowerCase()||globalPipe();
  card.dataset.effpipe=eff;
  let h=card.querySelector('h3'), b=h&&h.querySelector('.gptbadge');
  if(eff==='gpt_image'&&!b){{
   let s=document.createElement('span'); s.className='gptbadge';
   s.title='This slot is edited by GPT-Image-1, not the local pipeline';
   s.textContent='GPT';
   h.querySelector('.cpbtn').insertAdjacentElement('beforebegin',s);
  }}else if(eff!=='gpt_image'&&b){{b.remove();}}
  applyCardPipes();
 }}
 closeAdv();
}}
function mvCheckAll(v){{document.querySelectorAll('#mgrid .mvc').forEach(c=>c.checked=v);}}
async function delVariants(){{
 let ids=[...document.querySelectorAll('#mgrid .mvc:checked')].map(c=>c.value);
 if(!ids.length){{alert('Check the variants you want to delete first');return;}}
 if(!confirm('Delete '+ids.length+' variant file(s)? This cannot be undone.'))return;
 let r=await fetch('/delvariants',{{method:'POST',body:JSON.stringify({{name:_modalName,ids:ids}})}});
 document.getElementById('stat').textContent=await r.text();
 openVariants(_modalName);
}}
async function refreshCards(){{
 let j=await (await fetch('/cardsdata')).json(); let cb=Date.now();
 for(let d of j){{
  let c=document.querySelector('.card[data-name="'+d.name+'"]'); if(!c)continue;
  c.querySelectorAll('img').forEach(im=>{{
   // Only bump the cache-bust 't'; keep other params (e.g. a picked
   // variant's ?id=…) — stripping them made those thumbs 404 to the
   // no-variant placeholder until a full reload.
   let u=new URL(im.src, location.href);
   u.searchParams.set('t', cb);
   im.src=u.pathname+u.search;
  }});
  c.dataset.usedseed=d.seed_used;
  let cap=c.querySelector('.selcap');
  if(cap)cap.textContent='output · seed '+(d.seed_used??'—');
  c.dataset.dirty='0';        // post-render: back to committed resting state
  updateLock(c);
 }}
}}
async function renderSel(){{
 await saveAll();
 let sel=collect().filter(x=>x.selected).map(x=>x.name);
 if(!sel.length){{alert('Nothing selected');return;}}
 let v=parseInt(document.getElementById('variants').value)||1;
 let b=document.getElementById('rbtn'); b.disabled=true;
 document.getElementById('sbtn').style.display='inline-block';
 document.getElementById('toast').style.display='none';
 document.getElementById('log').style.display='block';
 await fetch('/render',{{method:'POST',body:JSON.stringify({{names:sel,variants:v}})}});
 poll();
}}
async function createAtlas(){{
 await saveAll();
 document.getElementById('rbtn').disabled=true;
 document.getElementById('toast').style.display='none';
 document.getElementById('log').style.display='block';
 await fetch('/createatlas',{{method:'POST',body:'{{}}'}});
 poll();
}}
function viewAtlas(){{window.open('/atlasimg?t='+Date.now(),'_blank');}}
async function deployAtlas(){{
 let t=document.getElementById('toast');
 t.style.display='inline-block'; t.textContent='📦 Deploying…';
 let st=document.getElementById('stat'); if(st)st.textContent='📦 Deploying…';
 let msg;
 try{{ let r=await fetch('/deployatlas',{{method:'POST',body:'{{}}'}});
  msg=(r.status===404)?'Deploy endpoint missing — restart run_ui.bat':await r.text();
 }}catch(e){{ msg='Deploy failed: '+e; }}
 t.textContent=msg; if(st)st.textContent=msg;
}}
async function stopRender(){{
 let sb=document.getElementById('sbtn'); sb.disabled=true; sb.textContent='■ Stopping…';
 await fetch('/stop',{{method:'POST',body:'{{}}'}});
}}
async function poll(){{
 let r=await fetch('/progress'); let j=await r.json();
 document.getElementById('log').textContent=j.log;
 document.getElementById('log').scrollTop=1e9;
 let b=document.getElementById('rbtn');
 let pct=j.total? Math.round(100*j.cur/j.total):0;
 b.querySelector('.fill').style.width=pct+'%';
 b.querySelector('.lbl').textContent=j.running?('⏳ Rendering '+j.cur+'/'+j.total+'…'):'▶ Render selected';
 if(j.running){{setTimeout(poll,1200);}}
 else{{
  b.disabled=false; b.querySelector('.fill').style.width='0%';
  let sb=document.getElementById('sbtn');
  sb.style.display='none'; sb.disabled=false; sb.textContent='■ Stop';
  document.getElementById('stat').textContent='';
  let t=document.getElementById('toast'); t.style.display='inline-block';
  refreshCards();
  refreshCredits();   // a render/compose may have spent credits
 }}
}}
async function refreshCredits(){{
 let el=document.getElementById('credits'); if(!el)return;
 try{{
  let j=await (await fetch('/credits')).json();
  el.classList.remove('low','err');
  if(j.ok){{
   let eur=(j.eur!=null)?(' ≈ €'+j.eur.toFixed(2)):'';
   el.textContent='◆ '+j.balance.toFixed(2)+(j.currency?' '+j.currency:'')+eur+' credits';
   el.title="comfy.org's own balance (api.comfy.org/customers/balance) — "
    +"this tool shows it verbatim, NO conversion. effective="+j.balance
    +" "+j.currency+(j.pending?(" · pending="+j.pending):"")
    +(j.prepaid?(" · prepaid="+j.prepaid):"")
    +(j.eur!=null?(" · €"+j.eur+" at your configured rate"):
      " · set 'credits_eur_rate' in Settings for a € estimate")
    +". comfy.org's API does not expose per-image cost — only the balance "
    +"delta reveals it. Click to top up.";
   if(j.balance<5)el.classList.add('low');
  }}else{{
   el.textContent='◆ credits: '+(j.error||'n/a'); el.classList.add('err');
  }}
 }}catch(e){{ el.textContent='◆ credits: n/a'; el.classList.add('err'); }}
}}
let _fsTarget=null;
let _fsFolderMode=false;
let _fsCurDir='';
let _fsInputEl=null;   // explicit target (advanced popup ref pickers)
function _fsInput(){{return _fsInputEl||document.querySelector('[data-cfg="'+_fsTarget+'"]');}}
// Open the R2 picker against a specific input element (used by the per-region
// style_ref / shape_ref pickers, whose inputs carry data-adv not data-cfg).
function openFs(key,inputEl){{
 _fsInputEl=inputEl||null;   // default: resolve target via data-cfg
 _fsTarget=key;
 _fsFolderMode=(key==='deploy_path');
 document.getElementById('fstitle').textContent=
  (_fsFolderMode?'Pick a folder — ':'Pick a file — ')+key;
 document.getElementById('fspickdir').style.display=_fsFolderMode?'inline-block':'none';
 let cur=(_fsInput()&&_fsInput().value||'').trim();
 document.getElementById('fspath').value=cur;
 // Files: start in the path's folder. Folders: start in the path itself.
 let start='';
 if(cur && !/^https?:\\/\\//i.test(cur)){{
  if(_fsFolderMode){{ start=cur; }}
  else {{
   let i=Math.max(cur.lastIndexOf('\\\\'),cur.lastIndexOf('/'));
   if(i>0)start=cur.slice(0,i);
  }}
 }}
 document.getElementById('fsmodal').classList.add('open');
 fsList(start);
}}
function closeFs(){{document.getElementById('fsmodal').classList.remove('open');}}
async function fsList(p){{
 let box=document.getElementById('fslist');
 box.innerHTML='loading…';
 let j;
 try{{ j=await (await fetch('/fsbrowse?path='+encodeURIComponent(p||'')+'&key='+encodeURIComponent(_fsTarget||''))).json(); }}
 catch(e){{ box.innerHTML='<div style=color:#e88>browse failed</div>'; return; }}
 _fsCurDir=j.cur||'';
 document.getElementById('fscur').textContent=j.cur?('📂 '+j.cur):'📂 This PC';
 if(!j.ok){{ box.innerHTML='<div style="color:#e88;padding:8px">'+(j.error||'error')+'</div>'; return; }}
 box.innerHTML='';
 let mk=(cls,ic,label,onclick)=>{{
  let d=document.createElement('div'); d.className='fsrow '+cls;
  d.innerHTML='<span class="ic">'+ic+'</span><span></span>';
  d.lastChild.textContent=label; d.onclick=onclick; box.appendChild(d);
 }};
 if(j.up!==null) mk('up','⬆','.. (up)',()=>fsList(j.up));
 j.dirs.forEach(d=>mk('dir','📁',d.name,()=>fsList(d.path)));
 j.files.forEach(f=>mk('file','🖼',f.name,()=>fsPick(f.path)));
 if(!j.dirs.length && !j.files.length){{
  let hint=_fsFolderMode?'(no subfolders here — click "Use this folder" above to pick it)':'(no folders or images here)';
  box.insertAdjacentHTML('beforeend','<div style="color:#888;padding:8px">'+hint+'</div>');
 }}
}}
function fsGo(){{fsList(document.getElementById('fspath').value.trim());}}
function fsUseTyped(){{
 let v=document.getElementById('fspath').value.trim();
 if(v) fsPick(v);
}}
function fsUseCurDir(){{
 if(_fsCurDir) fsPick(_fsCurDir);
}}
function fsPick(path){{
 let inp=_fsInput();
 if(inp){{ inp.value=path; inp.dispatchEvent(new Event('change')); }}
 closeFs();
}}
document.addEventListener('keydown',e=>{{if(e.key==='Escape'){{closeModal();closeAdv();closeFs();}}}});
window.addEventListener('DOMContentLoaded',function(){{
 updateAllLocks(); refreshCredits(); setInterval(refreshCredits,60000);
}});
</script></body></html>"""

CARD = """<div class="card{card_cls}" data-name="{name}" data-effpipe="{eff_pipe}" data-usedseed="{used_seed}" data-lockedseed="{locked_seed}" data-variant="{variant}">
 <h3><input type="checkbox" class="sel" {checked}> {name} — {fruit}{gpt_badge}
  <button class="cpbtn" title="Copy settings (prompt + advanced + shine; NOT reference image, seed or lock)" onclick="copyCfg('{name}')">⧉</button><button class="ptbtn" title="Paste copied settings into this region" onclick="pasteCfg('{name}')">📥</button>{mode_sel}</h3>
 <div class="role">{role}</div>
 <div class="imgs">
  <figure>
   <div class="imgwrap">
    <a class="biglink" href="{biglink}" target="_blank"><img src="{bigthumb}" class="bigsel"></a>
    <span class="hz top"></span><span class="hz bot"></span>
    <button class="vbtn" type="button" onclick="openVariants('{name}')">▦ variants</button>
   </div>
   <figcaption class="selcap">{out_cap}</figcaption>
   <div class="refctl">
    <div class="ovctl">
     <div class="filerow">
      <input type="file" class="of" accept="image/*" onchange="useMyImage('{name}')" title="Pick an image to use as the final atlas tile for this region — applied immediately, no AI generation, no background removal">
      <button class="mini xbtn" onclick="revertImage('{name}')" title="Remove the user image so this region is generated again">✕</button>
     </div>
    </div>
    {fx_controls}
   </div>
  </figure>
  <figure class="reffig">
   <div class="refwrap">
    <img src="/ref/{name}?t={cb}">
    <button class="usebtn" type="button" onclick="useRefImg('{name}')" title="Use this reference image as this slot's atlas tile (verbatim — no AI, no background removal)">USE THIS IMAGE</button>
   </div>
   <figcaption>{ref_kind}</figcaption>
   <div class="refctl">
    <div class="filerow">
     <input type="file" class="rf" accept="image/*" onchange="uploadRef('{name}')" title="Pick a reference image — applied immediately">
     <button class="mini xbtn" onclick="clearRef('{name}')" title="Clear the reference image">✕</button>
    </div>
   </div>
  </figure>
 </div>
 <div class="row seedrow">
  <label>Current Seed</label>
  <input type="text" class="sd" value="{seed}" placeholder="random">
  <label title="use this seed on every render"><input type="checkbox" class="lk" {locked} onchange="onLockToggle(this)"> lock</label>
  <span class="lockslot"></span>
 </div>
 <details class="promptbox">
  <summary>📝 Extra prompts{neg_badge}</summary>
  <div data-pipe="both">
   <label class="plbl">Positive — region prompt (between atlas prefix &amp; suffix)</label>
   <textarea class="pr">{prompt}</textarea>
   <label class="rneglbl"><input type="checkbox" class="rposrep" {rpos_replace}> Replace atlas positive (use only this, ignore prefix/suffix)</label>
  </div>
  <div data-pipe="sdxl">
   <label class="plbl">Negative — region <span style="color:#888;font-size:10px">· SDXL only — FLUX ignores negatives</span></label>
   <textarea class="rneg" rows="3" placeholder="blank = use atlas negative only">{rneg}</textarea>
   <label class="rneglbl"><input type="checkbox" class="rnegrep" {rneg_replace}> Replace atlas negative (default: append to it)</label>
  </div>
  <div data-pipe="gpt_image">
   <label class="plbl">GPT instruction <span style="color:#888;font-size:10px">· edits this slot's reference image (gpt_image pipeline)</span></label>
   <textarea class="gptpr" rows="3" placeholder="e.g. make the skin look like a watermelon">{gpt_prompt}</textarea>
  </div>
 </details>
 <div class="row advrow" style="justify-content:flex-end;margin-top:6px">
  <button class="mini" onclick="openAdv('{name}')">⚙ advanced</button>
 </div>
</div>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, ctype, body: bytes, extra_headers: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        merged = dict(getattr(self, "_set_cookie", None) or {})
        merged.update(extra_headers or {})
        for k, v in merged.items():
            self.send_header(k, v)
        # Additional Set-Cookie headers (a dict can't hold two) — e.g. the
        # project cookie set alongside the gate's secret cookie.
        for c in getattr(self, "_extra_cookies", None) or ():
            self.send_header("Set-Cookie", c)
        self.end_headers()
        self.wfile.write(body)

    def _gate(self) -> tuple[bool, dict | None]:
        """Shared-secret access gate (the tool sits behind the launcher).
        Open when ATLAS_TOOL_SECRET is unset. Accepts the secret via cookie,
        `X-Atlas-Secret` header, or `?k=` query (which also sets the cookie so
        the iframe's later asset/fetch requests pass)."""
        if not ATLAS_TOOL_SECRET:
            return True, None
        cookie = self.headers.get("Cookie", "") or ""
        if f"atlas_tool={ATLAS_TOOL_SECRET}" in cookie:
            return True, None
        if self.headers.get("X-Atlas-Secret") == ATLAS_TOOL_SECRET:
            return True, None
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if q.get("k", [""])[0] == ATLAS_TOOL_SECRET:
            return True, {
                "Set-Cookie": f"atlas_tool={ATLAS_TOOL_SECRET}; Path=/; "
                              f"HttpOnly; SameSite=None; Secure"
            }
        return False, None

    def _resolve_context(self) -> None:
        """Pick + apply the (client, project) for THIS request.

        Resolution order for EACH key (independently):
          1. `?client=` / `?project=` query param (slug-validated)
          2. `iw_client` / `iw_project` cookie
          3. env default (`ATLAS_CLIENT` / `ATLAS_PROJECT`)

        A valid query param sticks into the matching cookie so in-tool
        navigation (which drops the param) stays in the same context. Legacy
        single-`?project=` requests fall back to the env-default client (no
        cross-tool client lookup — the launcher always passes both now).

        On a real switch we re-resolve paths + re-hydrate staging under a lock
        so an interleaved request never sees half-hydrated staging."""
        self._extra_cookies = []
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        p_param = (q.get("project", [""])[0] or "").strip()
        c_param = (q.get("client", [""])[0] or "").strip()
        cookie = self.headers.get("Cookie", "") or ""
        mp = re.search(r"iw_project=([^;]+)", cookie)
        mc = re.search(r"iw_client=([^;]+)", cookie)
        cookie_project = (mp.group(1).strip() if mp else "")
        cookie_client = (mc.group(1).strip() if mc else "")

        chosen_project = (project_paths.valid_project(p_param)
                          or project_paths.valid_project(cookie_project)
                          or project_paths.env_project())
        chosen_client = (project_paths.valid_client(c_param)
                         or project_paths.valid_client(cookie_client)
                         or project_paths.env_client())

        if p_param:
            self._extra_cookies.append(
                f"iw_project={chosen_project}; Path=/; SameSite=None; Secure")
        if c_param:
            self._extra_cookies.append(
                f"iw_client={chosen_client}; Path=/; SameSite=None; Secure")

        with _project_lock:
            pp = project_paths.switch_context(chosen_client, chosen_project)
            if pp is not None:
                _apply_project_paths(pp)

    # Back-compat alias — kept so any legacy in-process call still works.
    def _resolve_project(self) -> None:
        self._resolve_context()

    def do_GET(self):
        ok, self._set_cookie = self._gate()
        if not ok:
            self._send(403, "text/plain", b"forbidden")
            return
        self._resolve_context()
        path = urllib.parse.urlparse(self.path).path
        if path == "/":
            # Splash is for the *first* visit (launcher → browser). Subsequent
            # reloads (after editing a region, picking a picture, etc.) skip
            # straight to the UI via `?fast=1` — the splash JS sets that on
            # first swap via history.replaceState, so browser-reload preserves
            # it. New tab/window with bare `/` still gets the splash.
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if qs.get("fast", ["0"])[0] == "1":
                t0 = time.time()
                body = self._index().encode("utf-8")
                dt = time.time() - t0
                # Server-side timing log so a "blank for N seconds after the
                # splash" complaint can be diagnosed: this number IS the
                # render budget. If it's small but the user still waits,
                # the wait is browser parse/render (not the Python side).
                print(f"[/?fast=1] _index() = {dt*1000:.0f} ms  "
                      f"({len(body)/1024:.0f} KB)", flush=True)
                self._send(200, "text/html; charset=utf-8", body)
            else:
                self._send(200, "text/html; charset=utf-8",
                           SPLASH.encode("utf-8"))
        elif path == "/_index_html":
            t0 = time.time()
            body = self._index().encode("utf-8")
            dt = time.time() - t0
            print(f"[/_index_html] _index() = {dt*1000:.0f} ms  "
                  f"({len(body)/1024:.0f} KB)", flush=True)
            self._send(200, "text/html; charset=utf-8", body)
        elif path == "/favicon.ico":
            # Browsers request favicon.ico on every page load. 404 is harmless
            # but it clutters the launcher console / DevTools network panel.
            # Reuse the existing logo as the tab icon — cheap and silences it.
            self._serve_logo()
        elif path == "/docs":
            import docs  # local import keeps startup cheap
            import sys as _sys
            html_body = docs.render_docs(_sys.modules[__name__])
            self._send(200, "text/html; charset=utf-8", html_body.encode("utf-8"))
        elif path == "/logo":
            self._serve_logo()
        elif path.startswith("/thumb/"):
            self._serve_img(self._latest(path), thumb=True, label="no output yet")
        elif path.startswith("/full/"):
            self._serve_img(self._latest(path), thumb=False, label="no output yet")
        elif path.startswith("/ref/"):
            self._serve_img(self._refpath(path), thumb=True, label="no ref")
        elif path.startswith("/fullref/"):
            self._serve_img(self._refpath(path), thumb=False, label="no ref")
        elif path.startswith("/outthumb/"):
            self._serve_img(self._outpath(path), thumb=True, label="no user image")
        elif path.startswith("/outfull/"):
            self._serve_img(self._outpath(path), thumb=False, label="no user image")
        elif path == "/progress":
            with _render_lock:
                self._send(200, "application/json", json.dumps(_render_state).encode())
        elif path == "/credits":
            self._send(200, "application/json", self._credits())
        elif path == "/fsbrowse":
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            self._send(200, "application/json",
                       self._fsbrowse(qs.get("path", [""])[0],
                                      qs.get("key", [""])[0]))
        elif path == "/cardsdata":
            self._send(200, "application/json", self._cardsdata())
        elif path.startswith("/regionadv/"):
            self._send(200, "application/json", self._regionadv(path.rsplit("/", 1)[-1]))
        elif path == "/atlasimg":
            af = atlas_file()
            if af.exists():
                self._send(200, "image/png", af.read_bytes())
            else:
                self._send(404, "text/plain", b"No atlas built yet. Use 'Build final atlas'.")
        elif path.startswith("/variants/"):
            name = path.rsplit("/", 1)[-1]
            items = [{"id": variant_id(p), "seed": seed_of(p)}
                     for p in reversed(variant_files(name))]
            self._send(200, "application/json", json.dumps(items).encode())
        elif path.startswith("/vthumb/"):
            self._serve_variant(self.path, thumb=True)
        elif path.startswith("/vfull/"):
            self._serve_variant(self.path, thumb=False)
        else:
            self._send(404, "text/plain", b"not found")

    def do_POST(self):
        ok, self._set_cookie = self._gate()
        if not ok:
            self._send(403, "text/plain", b"forbidden")
            return
        self._resolve_context()
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length).decode("utf-8")
        if self.path == "/save":
            self._send(200, "text/plain", self._save(json.loads(raw)).encode())
        elif self.path == "/saveconfig":
            self._send(200, "text/plain", self._saveconfig(json.loads(raw)).encode())
        elif self.path == "/render":
            payload = json.loads(raw)
            names = payload.get("names", [])
            variants = int(payload.get("variants", 1))
            if not _render_state["running"]:
                threading.Thread(target=run_render, args=(names, variants),
                                 daemon=True).start()
            self._send(200, "text/plain", b"started")
        elif self.path == "/createatlas":
            if not _render_state["running"]:
                threading.Thread(target=run_compose, daemon=True).start()
            self._send(200, "text/plain", b"composing")
        elif self.path == "/stop":
            self._send(200, "text/plain", stop_render().encode())
        elif self.path == "/delvariants":
            self._send(200, "text/plain", self._delvariants(json.loads(raw)).encode())
        elif self.path == "/saveadv":
            self._send(200, "text/plain", self._saveadv(json.loads(raw)).encode())
        elif self.path == "/saveglobalstyle":
            self._send(200, "text/plain", self._saveglobalstyle(json.loads(raw)).encode())
        elif self.path == "/uploadatlas":
            self._send(200, "text/plain", self._uploadatlas(json.loads(raw)).encode())
        elif self.path == "/sliceatlas":
            self._send(200, "text/plain", self._sliceatlas().encode())
        elif self.path == "/deployatlas":
            self._send(200, "text/plain", self._deployatlas().encode())
        elif self.path == "/setref":
            self._send(200, "text/plain", self._setref(json.loads(raw)).encode())
        elif self.path == "/clearref":
            self._send(200, "text/plain", self._clearref(json.loads(raw)).encode())
        elif self.path == "/setoutput":
            self._send(200, "text/plain", self._setoutput(json.loads(raw)).encode())
        elif self.path == "/userefimg":
            self._send(200, "text/plain", self._userefimg(json.loads(raw)).encode())
        elif self.path == "/clearoutput":
            self._send(200, "text/plain", self._clearoutput(json.loads(raw)).encode())
        elif self.path == "/shinefrom":
            self._send(200, "text/plain", self._shinefrom(json.loads(raw)).encode())
        elif self.path == "/shinemode":
            self._send(200, "text/plain", self._shinemode(json.loads(raw)).encode())
        elif self.path == "/copyfrom":
            self._send(200, "text/plain", self._copyfrom(json.loads(raw)).encode())
        elif self.path == "/setmode":
            self._send(200, "text/plain", self._setmode(json.loads(raw)).encode())
        elif self.path == "/fxbuild":
            self._send(200, "text/plain", self._fxbuild(json.loads(raw)).encode())
        else:
            self._send(404, "text/plain", b"not found")
            return
        # Durability: mirror staging refs to R2 after handlers that write/remove
        # ref images, so they survive container restarts (R2 is source of truth).
        if self.path in _REF_MUTATING_ROUTES and R2_PREFIX:
            try:
                storage.push_dir(INPUT_DIR, f"{R2_PREFIX}/input")
            except Exception:  # noqa: BLE001
                pass

    # helpers ----------------------------------------------------------
    def _latest(self, path: str) -> Path | None:
        name = urllib.parse.urlparse(path).path.rsplit("/", 1)[-1]
        return latest_output(name)

    def _refpath(self, path: str) -> Path | None:
        name = urllib.parse.urlparse(path).path.rsplit("/", 1)[-1]
        m = load_manifest()
        region = next((r for r in all_regions(m) if r["name"] == name), None)
        if not region:
            return None
        # Show whatever reference the region has: a painted shape_ref wins
        # (it's what you'd hand-edit), else the style_ref / atlas slice so
        # sliced crops are visible in the card immediately.
        for key in ("shape_ref", "style_ref"):
            ref = region.get(key)
            if ref:
                p = Path(ref) if Path(ref).is_absolute() else INPUT_DIR / ref
                if p.exists():
                    return p
        return None

    def _serve_img(self, p: Path | None, thumb: bool, label: str):
        if p and p.exists():
            if thumb:
                self._send(200, "image/jpeg", thumb_bytes(p))
            else:
                self._send(200, "image/png", p.read_bytes())
            return
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="220" height="160">'
               f'<rect width="220" height="160" fill="#1a1a1e"/><text x="110" y="84" '
               f'fill="#666" font-size="13" text-anchor="middle">{label}</text></svg>')
        self._send(200, "image/svg+xml", svg.encode())

    def _regionadv(self, name: str) -> bytes:
        m = load_manifest()
        cfg = load_config()
        region = next((r for r in all_regions(m) if r["name"] == name), None) or {}
        g_neg = m.get("style", {}).get("negative", "")
        g_pipe = str(cfg.get("pipeline", "sdxl")).lower() or "sdxl"
        # Effective pipeline for this slot: its own override, else the global.
        # Drives which fields the popup shows (client-side, live on change).
        effective = str(region.get("pipeline", "")).strip().lower() or g_pipe
        fields = []
        spine = "orig_w" in region  # atlas-bound (drives fit_mode default)
        for key, label, cfg_key in ADV_FIELDS:
            is_bool = key in ADV_BOOL
            if key in ADV_SELECT:
                # Dropdown override. "" = inherit; the effective default is
                # shown as the blank option / placeholder.
                if key == "pipeline":
                    ph = g_pipe
                elif key == "fit_mode":
                    ph = "fill" if spine else "contain"
                elif key == "gpt_rembg":
                    ph = "on" if cfg.get("gpt_image_rembg", True) else "off"
                else:
                    ph = ""
                fields.append({
                    "key": key,
                    "label": label,
                    "value": str(region.get(key, "")),
                    "placeholder": ph,
                    "numeric": False,
                    "range": None,
                    "multiline": False,
                    "bool": False,
                    "select": True,
                    "options": ADV_SELECT[key],
                    "pipe": ADV_PIPE.get(key, "both"),
                    "tip": ADV_TIPS.get(key, ""),
                })
                continue
            # Negative's global default lives in manifest style, not config.
            placeholder = g_neg if key == "negative" else cfg.get(cfg_key or "", "")
            value = bool(region.get(key, False)) if is_bool else region.get(key, "")
            fields.append({
                "key": key,
                "label": label,
                "value": value,                    # current per-region override ("" = none)
                "placeholder": placeholder,        # global default shown as hint
                "numeric": key in ADV_NUMERIC,
                "range": ADV_RANGES.get(key),   # [min, max, step] or null
                "multiline": key in ADV_MULTILINE,
                "bool": is_bool,
                "select": False,
                "options": None,
                "pipe": ADV_PIPE.get(key, "both"),
                "tip": ADV_TIPS.get(key, ""),
            })
        return json.dumps({"name": name, "fields": fields,
                           "effective": effective}).encode()

    def _uploadatlas(self, payload: dict) -> str:
        """Upload a `.atlas` geometry file (+ optional source page image) into
        the project's R2-backed staging tree and repoint the active manifest's
        atlas block at staging-relative paths, so Slice/Compose resolve in the
        cloud (local Windows paths never would).

        payload: {atlas_name, atlas_text, image_name?, image_data(b64)?}.
        Files land under refs/atlas/ (mirrored to R2 by the post-route push),
        and atlas.atlas_file / atlas.source_image are rewritten to that
        INPUT_DIR-relative form — the same form batch_atlas resolves."""
        atlas_name = Path(str(payload.get("atlas_name", "")).strip()).name
        atlas_text = payload.get("atlas_text", "")
        if not atlas_name or not atlas_name.lower().endswith(".atlas"):
            return "Pick a .atlas file to upload."
        if not atlas_text:
            return "The .atlas file was empty."
        dest_dir = INPUT_DIR / "refs" / "atlas"
        dest_dir.mkdir(parents=True, exist_ok=True)
        atlas_rel = f"refs/atlas/{atlas_name}"
        try:
            (INPUT_DIR / atlas_rel).write_text(atlas_text, encoding="utf-8")
        except OSError as e:
            return f"Could not write {atlas_name}: {e}"
        # Parse the page image name the .atlas references (line 2 of a libGDX
        # atlas), so we can default source_image to the uploaded page.
        page_image = ""
        try:
            page_image = atlas_format.parse_atlas(INPUT_DIR / atlas_rel)["page"]["image"]
        except Exception:  # noqa: BLE001 — keep the upload even if parse is odd
            page_image = ""
        img_rel = ""
        img_name = Path(str(payload.get("image_name", "")).strip()).name
        img_b64 = payload.get("image_data", "")
        if img_name and img_b64:
            try:
                raw = base64.b64decode(img_b64)
                Image.open(io.BytesIO(raw))  # validate it's an image
            except Exception as e:  # noqa: BLE001
                return f"Invalid source image: {e}"
            img_rel = f"refs/atlas/{img_name}"
            try:
                (INPUT_DIR / img_rel).write_bytes(raw)
            except OSError as e:
                return f"Could not write {img_name}: {e}"
        m = load_manifest()
        atlas = m.setdefault("atlas", {})
        atlas["atlas_file"] = atlas_rel
        if img_rel:
            atlas["source_image"] = img_rel
        elif page_image:
            # No image uploaded: point source_image at the page name so a
            # later upload / R2 pick under refs/atlas resolves it.
            atlas.setdefault("source_image", f"refs/atlas/{Path(page_image).name}")
        save_manifest(m)
        tail = f" + source {img_rel}" if img_rel else ""
        return (f"✓ Uploaded {atlas_rel}{tail} and repointed "
                f"{manifest_path().name} — reload to see regions.")

    def _sliceatlas(self) -> str:
        cmd = [PY, str(TOOLS / "slice_atlas.py"),
               "--manifest", manifest_path().name, "--as", "style_ref"]
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        except subprocess.TimeoutExpired:
            return "✂ Slice timed out"
        out = (p.stdout or "").strip().splitlines()
        tail = out[-1] if out else ""
        if p.returncode != 0:
            err = (p.stderr or p.stdout or "").strip().splitlines()
            return "✂ Slice failed: " + (err[-1] if err else "see console")
        return "✓ " + (tail or "sliced")

    def _deployatlas(self) -> str:
        """Cloud deploy: copy the composed atlas (<stem>_new.png/webp/atlas in
        the staging ATLAS_DIR) to an R2 deploy location. `deploy_path` in the
        manifest is treated as an R2 key PREFIX (default
        '<r2_project_prefix>/deploy'); `deploy_basename` overrides the name."""
        m = load_manifest()
        stem = manifest_path().stem.replace("atlas_manifest_", "")
        out_base = str(m.get("deploy_basename", "")).strip() or stem
        dest_prefix = str(m.get("deploy_path", "")).strip().strip("/")
        if not dest_prefix:
            dest_prefix = f"{R2_PREFIX}/deploy" if R2_PREFIX else "deploy"
        sources = sorted(p for p in ATLAS_DIR.glob(f"{stem}_new.*")
                         if p.suffix.lower() in {".png", ".webp", ".atlas"})
        if not sources:
            return (f"📦 Nothing to deploy — no {stem}_new.(png|webp|atlas) in "
                    f"the composed output. Create Atlas first.")
        copied = []
        for src in sources:
            key = f"{dest_prefix}/{out_base}{src.suffix}"
            try:
                storage.put(key, src.read_bytes())
            except Exception as e:  # noqa: BLE001
                return f"📦 Deploy to R2 failed for {src.name} -> {key}: {e}"
            copied.append(key)
        return f"✓ Deployed to R2: {', '.join(copied)}"

    def _saveglobalstyle(self, payload: dict) -> str:
        m = load_manifest()
        style = m.setdefault("style", {})
        applied = []
        for key in ("positive_prefix", "positive_suffix", "negative"):
            if key in payload:
                style[key] = str(payload[key]).strip()
                applied.append(key)
        save_manifest(m)
        return f"Atlas style saved to {manifest_path().name} ({', '.join(applied)}) — re-render to apply"

    def _saveadv(self, payload: dict) -> str:
        name = payload.get("name", "")
        vals = payload.get("fields", {})
        m = load_manifest()
        applied = []
        # Atlas-bound: create a name-only creative stub if this region has no
        # JSON entry yet, so advanced overrides have somewhere to live.
        ap = batch_atlas.atlas_file_path(m, manifest_path())
        if ap and ap.exists() and name:
            names = {r.get("name") for b in ("regions", "rotated_regions")
                     for r in m.get(b, [])}
            if name not in names:
                m.setdefault("regions", []).append({"name": name})
        for bucket in ("regions", "rotated_regions"):
            for r in m.get(bucket, []):
                if r["name"] != name:
                    continue
                for key, _, _ in ADV_FIELDS:
                    raw = str(vals.get(key, "")).strip()
                    if key in ADV_BOOL:
                        if raw:
                            r[key] = True
                            applied.append(key)
                        elif key in r:
                            del r[key]            # unchecked => default behavior
                    elif raw == "":
                        if key in r:
                            del r[key]            # blank => revert to global
                    elif key in ADV_NUMERIC:
                        try:
                            v = float(raw)
                        except ValueError:
                            continue
                        lo, hi, _ = ADV_RANGES.get(key, (None, None, None))
                        if lo is not None:
                            v = max(lo, min(hi, v))
                        r[key] = v
                        applied.append(key)
                    else:
                        r[key] = raw
                        applied.append(key)
        save_manifest(m)
        return f"Advanced saved for {name} ({len(applied)} override(s))"

    def _delvariants(self, payload: dict) -> str:
        name = payload.get("name", "")
        ids = payload.get("ids", [])
        deleted = 0
        for vid in ids:
            # variant_path only returns files from a glob inside BATCH_DIR,
            # so this is safe against path traversal via name/vid.
            p = variant_path(name, str(vid))
            if p and p.exists() and p.parent == BATCH_DIR:
                try:
                    p.unlink()
                    deleted += 1
                except OSError:
                    pass
        return f"Deleted {deleted} variant(s)"

    def _serve_variant(self, path: str, thumb: bool):
        # /vthumb/<name>?id=00005
        parsed = urllib.parse.urlparse(path)
        name = parsed.path.rsplit("/", 1)[-1]
        qs = urllib.parse.parse_qs(parsed.query)
        vid = qs.get("id", [""])[0]
        p = variant_path(name, vid)
        self._serve_img(p, thumb=thumb, label="no variant")

    def _serve_logo(self):
        for p in LOGO_CANDIDATES:
            if p.exists():
                if p.suffix == ".svg":
                    # currentColor renders black inside <img> (invisible on the
                    # dark header) — bake in the light theme colour instead.
                    svg = p.read_text(encoding="utf-8").replace(
                        "currentColor", "#e8e8ea")
                    self._send(200, "image/svg+xml", svg.encode("utf-8"))
                else:
                    self._send(200, "image/png", p.read_bytes())
                return
        self._send(200, "image/svg+xml",
                   b'<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42">'
                   b'<rect width="42" height="42" rx="6" fill="#3f789e"/>'
                   b'<text x="21" y="27" fill="#fff" font-size="16" font-weight="bold" '
                   b'text-anchor="middle">IW</text></svg>')

    def _fsbrowse(self, path: str, key: str = "") -> bytes:
        """R2 file picker. Browses the project's R2 asset repo (mirrored into the
        local staging INPUT_DIR) as a folder tree, returning INPUT_DIR-relative
        paths — which is exactly what region `style_ref`/`source_image` fields
        expect. `path` is the relative subfolder ("" = repo root). Read-only.

        `key` tunes the filter: `atlas_file` also lists `.atlas` geometry;
        `deploy_path` lists folders only. Everything else lists images."""
        img_exts = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
        exts = img_exts | {".atlas"} if key == "atlas_file" else img_exts
        folder_only = key == "deploy_path"
        try:
            root = INPUT_DIR.resolve()
            root.mkdir(parents=True, exist_ok=True)
            rel = (path or "").strip().replace("\\", "/").strip("/")
            cur = (root / rel).resolve()
            # Never escape the repo root.
            if root != cur and root not in cur.parents:
                cur, rel = root, ""
            if not cur.is_dir():
                cur, rel = root, ""
            dirs, files = [], []
            for e in sorted(cur.iterdir(), key=lambda p: p.name.lower()):
                try:
                    rp = e.relative_to(root).as_posix()
                    if e.is_dir():
                        dirs.append({"name": e.name, "path": rp})
                    elif not folder_only and e.suffix.lower() in exts:
                        files.append({"name": e.name, "path": rp})
                except (OSError, ValueError):
                    continue
            if rel == "":
                up = None
            else:
                parent = Path(rel).parent.as_posix()
                up = "" if parent == "." else parent
            cur_label = "R2 repo: " + (rel or "(root)")
            return json.dumps({"ok": True, "cur": cur_label, "up": up,
                               "dirs": dirs, "files": files}).encode()
        except Exception as e:  # noqa: BLE001 — picker must never 500 the UI
            return json.dumps({"ok": False, "error": str(e)}).encode()

    def _credits(self) -> bytes:
        """comfy.org credit balance for the header chip. Cached briefly so
        the auto-refresh can't hammer the billing API. Same source ComfyUI's
        own Settings → Credits panel uses (api.comfy.org/customers/balance)."""
        now = time.time()
        c = _credits_cache
        if c["payload"] is not None and now - c["t"] < _CREDITS_TTL:
            return json.dumps(c["payload"]).encode()
        key = batch_atlas.comfy_org_api_key()
        if not key:
            return json.dumps({
                "ok": False,
                "error": "no comfy.org API key (set it in Settings)"}).encode()
        try:
            req = urllib.request.Request(
                "https://api.comfy.org/customers/balance",
                headers={"X-API-KEY": key, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=10) as r:
                j = json.loads(r.read())
            bal = j.get("effective_balance_micros")
            if bal is None:
                bal = j.get("amount_micros", 0)
            bal = float(bal)
            payload = {
                "ok": True,
                "balance": round(bal, 2),
                "currency": str(j.get("currency", "")).upper(),
                # comfy.org's own raw fields, surfaced for cross-checking —
                # this tool does NO conversion, it mirrors these verbatim.
                "pending": round(float(j.get("pending_charges_micros", 0)), 2),
                "prepaid": round(float(j.get("prepaid_balance_micros", 0)), 2),
            }
            try:
                rate = float(load_config().get("credits_eur_rate", 0) or 0)
            except (TypeError, ValueError):
                rate = 0.0
            if rate > 0:
                payload["eur"] = round(bal * rate, 2)
        except urllib.error.HTTPError as e:
            payload = {"ok": False, "error": f"HTTP {e.code}"}
        except Exception as e:  # noqa: BLE001 — header must never break the UI
            payload = {"ok": False, "error": "unreachable"}
        if payload.get("ok"):
            c["payload"], c["t"] = payload, now   # only cache good reads
        return json.dumps(payload).encode()

    def _cardsdata(self) -> bytes:
        out = []
        for r in all_regions(load_manifest()):
            p = latest_output(r["name"])
            out.append({"name": r["name"], "seed_used": seed_of(p) if p else None})
        return json.dumps(out).encode()

    def _index(self) -> str:
        m = load_manifest()
        _style = m.get("style", {})
        cfg = load_config()
        cb = int(time.time())
        cards = []
        g_pipe = str(cfg.get("pipeline", "sdxl")).lower() or "sdxl"
        for r in all_regions(m):
            name = r["name"]
            eff_pipe = str(r.get("pipeline", "")).strip().lower() or g_pipe
            # Card mode: explicit r["mode"], else legacy shine_mode flag,
            # else AI gen. Old _shine regions stay AI unless shine_mode set
            # (preserves prior behaviour).
            # Legacy `shine_mode` flag pre-dates the rename: its behaviour was
            # the halo halo build, which is now `glow`. Map accordingly.
            region_mode = str(r.get("mode", "")).strip().lower() or (
                "glow" if r.get("shine_mode") else "ai")
            if region_mode not in ("ai", "colour", "shadow", "shine", "glow",
                                   "blur", "zoom"):
                region_mode = "ai"
            has_seed = "seed" in r
            # Committed lock = a seed OR an explicit variant pick (GPT has no
            # seed, so a picked file id is its only lock key).
            committed_lock = has_seed or bool(str(r.get("variant", "")).strip())
            p = latest_output(name)
            us = seed_of(p) if p else None
            # If a specific variant was picked & committed, show THAT file
            # (its embedded seed may be shared with other variants, so the
            # file id — not the seed — is the source of truth for the pick).
            picked = str(r.get("variant", ""))
            has_override = batch_atlas.override_image_path(r) is not None
            if has_override:
                bigthumb = f"/outthumb/{name}?t={cb}"
                biglink = f"/outfull/{name}?t={cb}"
                out_cap = "★ your image · NOT processed"
            elif picked and variant_path(name, picked):
                bigthumb = f"/vthumb/{name}?id={picked}&t={cb}"
                biglink = f"/vfull/{name}?id={picked}&t={cb}"
                out_cap = f"output · seed {us if us is not None else '—'}"
            else:
                bigthumb = f"/thumb/{name}?t={cb}"
                biglink = f"/full/{name}?t={cb}"
                out_cap = f"output · seed {us if us is not None else '—'}"
            rneg = str(r.get("negative", ""))
            rneg_replace = bool(r.get("negative_replace", False))
            rpos_replace = bool(r.get("positive_replace", False))
            if r.get("shape_ref"):
                ref_kind = "shape ref"
            elif r.get("style_ref"):
                ref_kind = "style ref · atlas slice"
            else:
                ref_kind = "no ref"
            cards.append(CARD.format(
                ref_kind=html.escape(ref_kind),
                name=html.escape(name),
                eff_pipe=html.escape(eff_pipe),
                fruit=html.escape(str(r.get("fruit", ""))),
                role=html.escape(str(r.get("role", ""))),
                checked="" if r.get("skip_unless_explicit") else "checked",
                locked="checked" if committed_lock else "",
                seed=html.escape(str(r.get("seed", ""))),
                locked_seed=html.escape(str(r.get("seed", ""))),
                prompt=html.escape(str(r.get("prompt", ""))),
                gpt_prompt=html.escape(str(r.get("gpt_prompt", ""))),
                used_seed=us if us is not None else "None",
                used_seed_lbl=us if us is not None else "—",
                out_cap=html.escape(out_cap),
                fx_controls=(
                    _fx_controls(name, region_mode,
                                 (r.get("fx") or {}).get(region_mode)
                                 or (r.get("shine") if region_mode == "glow"
                                     else {}))
                    if region_mode != "ai" else ""),
                card_cls=(" smode" if region_mode != "ai" else ""),
                mode_sel=(
                    '<select class="modesel" title="What this slot produces. '
                    'AI gen = the pipeline (sdxl/flux/gpt). Colour / Shadow / '
                    'Shine / Glow = local image ops (no ComfyUI, no credits) '
                    'built from this slot\'s source." '
                    f'onchange="setMode(\'{html.escape(name)}\',this.value)">'
                    + "".join(
                        f'<option value="{mv}"'
                        f'{" selected" if mv == region_mode else ""}>{ml}'
                        f'</option>'
                        for mv, ml in (("ai", "AI gen"), ("colour", "Colour"),
                                       ("shadow", "Shadow"),
                                       ("shine", "Shine"), ("glow", "Glow"),
                                       ("blur", "Blur"), ("zoom", "Zoom")))
                    + '</select>'),
                variant=html.escape(picked),
                bigthumb=bigthumb,
                biglink=biglink,
                rneg=html.escape(rneg),
                rneg_replace="checked" if rneg_replace else "",
                rpos_replace="checked" if rpos_replace else "",
                neg_badge=(" <span class='negbadge'>● has region negative</span>"
                           if rneg and str(cfg.get("pipeline", "sdxl")).lower() != "flux"
                           else ""),
                gpt_badge=(
                    "<span class='gptbadge' title='This slot is edited by "
                    "GPT-Image-1, not the local pipeline'>GPT</span>"
                    if eff_pipe == "gpt_image" else ""),
                cb=cb,
            ))
        msettings = m.get("settings") or {}
        matlas = m.get("atlas") or {}
        global_fields = []   # atlas_config.json shared defaults
        atlas_fields = []    # per-atlas overrides + this atlas's geometry
        model_cache: dict = {}  # (node,field) -> list, fetched once per page
        for key, label, typ in CONFIG_FIELDS:
            step = " step=any" if typ == "number" else ""
            tip = help_for(key, cfg)
            tip_esc = html.escape(tip, quote=True)
            qm = (f'<span class="qm" title="{tip_esc}">&#9432;</span>'
                  if tip else "")
            pipe = PIPE_GROUP.get(key, "both")
            if key in PER_ATLAS_KEYS:
                # per-atlas override: value = manifest override (blank =
                # inherit), placeholder / blank option shows the global.
                ov = msettings.get(key, "")
                gv = str(cfg.get(key, ""))
                itip = html.escape(
                    (tip + "  ·  " if tip else "")
                    + f"Blank = inherit global ({gv})", quote=True)
                ctrl = _control_html(
                    key, typ, ov, model_cache, allow_blank=True,
                    blank_label=f"(inherit global: {gv})",
                    placeholder=f"global: {gv}", title=itip, step=step)
                atlas_fields.append(
                    f'<label data-pipe="{pipe}"><span class="lblrow">'
                    f'{html.escape(label)} '
                    f'<span style="color:#888;font-size:10px">· per-atlas</span>'
                    f'{qm}</span>{ctrl}</label>'
                )
            else:
                ctrl = _control_html(key, typ, cfg.get(key, ""), model_cache,
                                     title=tip_esc, step=step)
                global_fields.append(
                    f'<label data-pipe="{pipe}"><span class="lblrow">'
                    f'{html.escape(label)}{qm}</span>{ctrl}</label>'
                )
        for ui_key, label, typ, mk in ATLAS_GEOM_FIELDS:
            val = html.escape(str(matlas.get(mk, "")))
            step = " step=any" if typ == "number" else ""
            tip = help_for(ui_key, cfg)
            tip_esc = html.escape(tip, quote=True)
            qm = (f'<span class="qm" title="{tip_esc}">&#9432;</span>'
                  if tip else "")
            ctl = (f'<input data-cfg="{ui_key}" type="{typ}" value="{val}"'
                   f' title="{tip_esc}"{step}>')
            if ui_key in FILE_FIELDS:
                ctl = (f'<span class="filefld">{ctl}'
                       f'<button type="button" class="fbtn" title="Browse '
                       f'for a file (local, network \\\\share, or paste a '
                       f'URL)" onclick="openFs(\'{ui_key}\')">📁</button>'
                       f'</span>')
            atlas_fields.append(
                f'<label><span class="lblrow">{html.escape(label)} '
                f'<span style="color:#888;font-size:10px">· this atlas</span>'
                f'{qm}</span>{ctl}</label>'
            )
        deploy_val = html.escape(str(m.get("deploy_path", "")))
        deploy_tip = html.escape(
            "Destination folder for the 📦 Deploy atlas button. The tool "
            "copies <manifest-stem>_new.(png|webp|atlas) here as "
            "<manifest-stem>.(png|webp|atlas), overwriting existing files. "
            "Leave blank to disable the button for this atlas.",
            quote=True)
        atlas_fields.append(
            f'<label><span class="lblrow">Deploy folder '
            f'<span style="color:#888;font-size:10px">· this atlas</span>'
            f'<span class="qm" title="{deploy_tip}">&#9432;</span></span>'
            f'<span class="filefld">'
            f'<input data-cfg="deploy_path" type="text" value="{deploy_val}"'
            f' title="{deploy_tip}" placeholder="e.g. C:/Invisible Wall SL/'
            f'iGaming/Borut/HotFruits/static/assets/symbols">'
            f'<button type="button" class="fbtn" title="Browse for a folder '
            f'(local or \\\\server\\share)" onclick="openFs(\'deploy_path\')"'
            f'>📁</button></span></label>'
        )
        deploy_base_val = html.escape(str(m.get("deploy_basename", "")))
        mstem = manifest_path().stem.replace("atlas_manifest_", "")
        deploy_base_tip = html.escape(
            "Optional filename (no extension) used in the deploy folder. "
            f"Blank = use the manifest stem (current: '{mstem}'). Set this "
            "when the game's asset filename differs from the manifest name — "
            "e.g. manifest 'mmBG' but the game expects 'mm_bg'. The .png/.webp/"
            ".atlas extension is appended automatically.",
            quote=True)
        atlas_fields.append(
            f'<label><span class="lblrow">Deploy basename '
            f'<span style="color:#888;font-size:10px">· this atlas</span>'
            f'<span class="qm" title="{deploy_base_tip}">&#9432;</span></span>'
            f'<input data-cfg="deploy_basename" type="text" value="{deploy_base_val}"'
            f' title="{deploy_base_tip}" placeholder="(blank = {html.escape(mstem)})"></label>'
        )
        active = cfg.get("manifest_path", "")
        opts = "".join(
            f'<option value="{html.escape(mp)}"{" selected" if mp == active else ""}>'
            f'{html.escape(mp)}</option>' for mp in list_manifests()
        )
        manifest_select = (
            f'<select data-cfg="manifest_path" onchange="switchSession(this)" '
            f'title="Switch the active atlas manifest. Saves and reloads the '
            f'page so the new regions show immediately.">{opts}</select>'
        )
        cur_proj = cfg.get("project", "")
        projs = project_paths.list_projects()
        popts = "".join(
            f'<option value="{html.escape(pn)}"{" selected" if pn == cur_proj else ""}>'
            f'{html.escape(pn)}</option>' for pn in projs
        ) or '<option value="">(launcher config not found)</option>'
        project_select = (
            f'<select data-cfg="project" onchange="switchSession(this)" '
            f'title="Switch active project. Saves immediately; close and '
            f'reopen this tool window for the project paths to fully '
            f'reload (Python module-level state).">{popts}</select>'
        )
        # When this manifest came from the Spine Viewer, offer a jump back to
        # the exact skeleton (it cache-busts, so freshly-deployed art shows).
        _spine = (load_manifest().get("spine") or {})
        spine_link = ""
        if _spine.get("viewer_url"):
            spine_link = (
                f'<a href="{html.escape(_spine["viewer_url"], quote=True)}" target="spineviewer" '
                f'class="btnlink alt" '
                f'title="Open this skeleton in the Invisible Spine Viewer '
                f'({html.escape(str(_spine.get("name", "")), quote=True)})">🦴 View in Spine</a>'
            )
        return PAGE.format(
            cards="".join(cards),
            global_fields="".join(global_fields),
            atlas_fields="".join(atlas_fields),
            spine_link=spine_link,
            manifest_select=manifest_select,
            project_select=project_select,
            proj_qm=f'<span class="qm" title="{html.escape(help_for("project", cfg), quote=True)}">&#9432;</span>',
            manifest_qm=f'<span class="qm" title="{html.escape(help_for("manifest_path", cfg), quote=True)}">&#9432;</span>',
            manifest_name=html.escape(manifest_path().name),
            global_neg=html.escape(_style.get("negative", "")),
            global_pre=html.escape(_style.get("positive_prefix", "")),
            global_suf=html.escape(_style.get("positive_suffix", "")),
            build=BUILD,
            notice=(f'<div style="margin:10px 0;padding:10px 14px;'
                    f'background:#5a3a1a;border:1px solid #b9802f;'
                    f'border-radius:6px;color:#ffd9a0;font-size:13px">'
                    f'⚠ {html.escape(_load_warning)}</div>'
                    if _load_warning else ""),
        )

    def _save(self, edits: list[dict]) -> str:
        m = load_manifest()
        by_name = {e["name"]: e for e in edits}
        changed = 0
        # Atlas-bound: the JSON holds only creative data and may have no entry
        # yet for a given `.atlas` region. Create a name-only stub (never any
        # geometry) so the loop below can persist the user's prompt/seed/etc.
        # Skip empty edits so saveAll() doesn't bloat the file with 200 stubs.
        ap = batch_atlas.atlas_file_path(m, manifest_path())
        if ap and ap.exists():
            try:
                atlas_names = {ar["name"] for ar in
                               atlas_format.parse_atlas(ap)["regions"]}
            except (OSError, ValueError):
                atlas_names = set()
            m.setdefault("regions", [])
            existing = {r.get("name") for r in m["regions"]}
            for e in edits:
                nm = e.get("name")
                if not nm or nm in existing or nm not in atlas_names:
                    continue
                meaningful = (
                    str(e.get("prompt", "")).strip()
                    or str(e.get("gpt_prompt", "")).strip()
                    or (e.get("lock") and e.get("seed"))
                    or str(e.get("negative", "")).strip()
                    or e.get("negative_replace") or e.get("positive_replace")
                    or not e.get("selected")
                )
                if meaningful:
                    m["regions"].append({"name": nm})
                    existing.add(nm)
        for bucket in ("regions", "rotated_regions"):
            for r in m.get(bucket, []):
                e = by_name.get(r["name"])
                if not e:
                    continue
                # SAFETY: never wipe an existing non-empty prompt with an
                # empty textarea. saveAll() submits every card on each Save/
                # Render; a blank/unloaded textarea must not destroy a region
                # the user isn't actively editing.
                new_p = e.get("prompt", "")
                cur_p = r.get("prompt", "")
                if new_p.strip() and new_p != cur_p:
                    r["prompt"] = new_p
                    changed += 1
                if e["selected"]:
                    r.pop("skip_unless_explicit", None)
                else:
                    r["skip_unless_explicit"] = True
                vid = str(e.get("variant", "")).strip()
                if e["lock"] and (e["seed"] or vid):
                    # Lock key: a seed (sdxl/flux) AND/OR an explicit variant
                    # id. GPT images have NO embedded seed, so the picked file
                    # id is the only identity — persist it so compose pins
                    # exactly that file instead of falling back to the latest.
                    if e["seed"]:
                        try:
                            r["seed"] = int(e["seed"])
                        except ValueError:
                            r.pop("seed", None)
                    else:
                        r.pop("seed", None)
                    if vid:
                        r["variant"] = vid
                    else:
                        r.pop("variant", None)
                else:
                    r.pop("seed", None)
                    r.pop("variant", None)
                # Per-region negative (card, under the prompt). Blank => use
                # global only. The card always round-trips the stored value,
                # so an empty box is a deliberate clear, not data loss.
                rneg = str(e.get("negative", "")).strip()
                if rneg:
                    r["negative"] = rneg
                else:
                    r.pop("negative", None)
                if e.get("negative_replace"):
                    r["negative_replace"] = True
                else:
                    r.pop("negative_replace", None)
                if e.get("positive_replace"):
                    r["positive_replace"] = True
                else:
                    r.pop("positive_replace", None)
                # GPT instruction (card, used when the slot's pipeline is
                # gpt_image). Card always round-trips the stored value, so a
                # blank box is a deliberate clear, not data loss.
                rgpt = str(e.get("gpt_prompt", "")).strip()
                if rgpt:
                    r["gpt_prompt"] = rgpt
                else:
                    r.pop("gpt_prompt", None)
        save_manifest(m)
        return f"Saved ({changed} prompt change(s))"

    def _setref(self, payload: dict) -> str:
        name = payload.get("name", "")
        b64 = payload.get("data", "")
        if not name or not b64:
            return "Missing name or image data"
        try:
            raw = base64.b64decode(b64)
            img = Image.open(io.BytesIO(raw))
        except Exception as e:  # noqa: BLE001
            return f"Invalid image: {e}"
        refs_dir = INPUT_DIR / "refs"
        refs_dir.mkdir(parents=True, exist_ok=True)
        rel = f"refs/userref_{name}.png"
        img.convert("RGBA").save(INPUT_DIR / rel)
        m = load_manifest()
        ok = False
        for bucket in ("regions", "rotated_regions"):
            for r in m.get(bucket, []):
                if r["name"] == name:
                    r["shape_ref"] = rel
                    ok = True
        if not ok:
            return f"Region {name} not found"
        save_manifest(m)
        return f"Shape ref set for {name} → {rel}"

    def _clearref(self, payload: dict) -> str:
        name = payload.get("name", "")
        m = load_manifest()
        cleared = False
        for bucket in ("regions", "rotated_regions"):
            for r in m.get(bucket, []):
                if r["name"] != name:
                    continue
                for field in ("shape_ref", "style_ref"):
                    if field in r:
                        del r[field]
                        cleared = True
        save_manifest(m)
        return f"Reference cleared for {name}" if cleared else f"{name} had no reference"

    def _ensure_region(self, m: dict, name: str) -> dict | None:
        """Return the creative entry for `name`, creating a name-only stub
        when the manifest is .atlas-bound and has none yet (so output
        overrides work on atlas regions). None if `name` isn't a real
        region."""
        for bucket in ("regions", "rotated_regions"):
            for r in m.get(bucket, []):
                if r.get("name") == name:
                    return r
        if any(x["name"] == name for x in all_regions(m)):
            r = {"name": name}
            m.setdefault("regions", []).append(r)
            return r
        return None

    def _outpath(self, path: str) -> Path | None:
        name = urllib.parse.urlparse(path).path.rsplit("/", 1)[-1]
        m = load_manifest()
        region = next((r for r in all_regions(m) if r["name"] == name), None)
        return batch_atlas.override_image_path(region) if region else None

    def _setoutput(self, payload: dict) -> str:
        """Set a user-supplied final image for a region. The atlas will use
        it verbatim (no generation, no RMBG) until it's cleared."""
        name = payload.get("name", "")
        b64 = payload.get("data", "")
        if not name or not b64:
            return "Missing name or image data"
        try:
            raw = base64.b64decode(b64)
            img = Image.open(io.BytesIO(raw))
        except Exception as e:  # noqa: BLE001
            return f"Invalid image: {e}"
        (INPUT_DIR / "refs").mkdir(parents=True, exist_ok=True)
        rel = f"refs/useroutput_{name}.png"
        img.convert("RGBA").save(INPUT_DIR / rel)
        _drop_fx_snapshot(name)
        m = load_manifest()
        r = self._ensure_region(m, name)
        if r is None:
            return f"Region {name} not found"
        r["output_override"] = rel
        save_manifest(m)
        return (f"Using your image for {name} (not processed). "
                f"Create Atlas to apply; ✕ revert to generate again.")

    def _userefimg(self, payload: dict) -> str:
        """Bind a region's CURRENT reference image (the one shown in the ref
        figure: shape_ref, else style_ref / atlas slice) as that region's
        atlas tile (output_override) — verbatim, no AI, no RMBG. Snapshots
        it to refs/useroutput_<name>.png so later ref changes don't alter a
        committed tile and ✕ revert restores generation."""
        name = payload.get("name", "")
        if not name:
            return "Missing region name"
        m = load_manifest()
        region = next((r for r in all_regions(m) if r["name"] == name), None)
        if region is None:
            return f"Region {name} not found"
        src = None
        for key in ("shape_ref", "style_ref"):
            ref = region.get(key)
            if ref:
                p = Path(ref) if Path(ref).is_absolute() else INPUT_DIR / ref
                if p.exists():
                    src = p
                    break
        if src is None:
            return (f"{name} has no reference image yet — set one (⬆ set "
                    f"ref) or slice the atlas first")
        try:
            img = Image.open(src).convert("RGBA")
        except Exception as e:  # noqa: BLE001
            return f"Can't read reference: {e}"
        (INPUT_DIR / "refs").mkdir(parents=True, exist_ok=True)
        rel = f"refs/useroutput_{name}.png"
        img.save(INPUT_DIR / rel)
        _drop_fx_snapshot(name)
        r = self._ensure_region(m, name)
        if r is None:
            return f"Region {name} not found"
        r["output_override"] = rel
        save_manifest(m)
        return (f"{name}: using its reference image ({src.name}) as the "
                f"atlas tile — not processed. Create Atlas to apply; "
                f"✕ revert to generate again.")

    def _clearoutput(self, payload: dict) -> str:
        name = payload.get("name", "")
        m = load_manifest()
        cleared = False
        for bucket in ("regions", "rotated_regions"):
            for r in m.get(bucket, []):
                if r.get("name") == name and "output_override" in r:
                    del r["output_override"]
                    cleared = True
        if cleared:
            save_manifest(m)
            _drop_fx_snapshot(name)
            f = INPUT_DIR / f"refs/useroutput_{name}.png"
            try:
                f.unlink(missing_ok=True)
            except OSError:
                pass
            return f"Reverted {name} — it will be generated again on render"
        return f"{name} had no user image"

    # Never copied between regions: identity/geometry, results, and the
    # per-region bits that must stay original — style_ref (each region's own
    # reference image) and seed (the locked seed / lock state is per-result).
    _COPY_BLOCK = {"name", "x", "y", "w", "h", "rotated", "bounds", "offsets",
                   "rotate", "output_override", "variant", "fruit", "role",
                   "style_ref", "seed"}

    def _copyfrom(self, payload: dict) -> str:
        """Copy tuning settings (prompt, negatives, replace flags, every
        advanced override, shine settings + mode) from one region to others.
        NOT copied: identity/geometry, the generated result, the reference
        image (style_ref), or the seed/lock — those stay per-region."""
        src = payload.get("src", "")
        dsts = [d for d in (payload.get("dsts") or []) if d and d != src]
        if not src or not dsts:
            return "Nothing to paste"
        m = load_manifest()
        srcr = next((r for b in ("regions", "rotated_regions")
                     for r in m.get(b, []) if r.get("name") == src), None)
        if srcr is None:
            return f"'{src}' has no saved settings to copy yet"
        keys = [k for k in srcr if k not in self._COPY_BLOCK]
        import copy as _copy
        n = 0
        for d in dsts:
            r = self._ensure_region(m, d)
            if r is None:
                continue
            for k in list(r.keys()):           # clear old settings first
                if k not in self._COPY_BLOCK and k != "name":
                    del r[k]
            for k in keys:                     # then apply source's
                r[k] = _copy.deepcopy(srcr[k])
            n += 1
        save_manifest(m)
        return (f"Pasted {len(keys)} setting(s) from '{src}' into "
                f"{n} region(s)")

    def _shinemode(self, payload: dict) -> str:
        """LEGACY: toggles the old `shine_mode` flag (now interpreted as
        `glow`). Live UI uses /setmode for this. Accepts `_shine` or `_glow`
        suffixed regions."""
        name = payload.get("name", "")
        on = bool(payload.get("on"))
        if not (name.endswith("_shine") or name.endswith("_glow")):
            return f"{name} can't be a halo (no _shine / _glow suffix)"
        m = load_manifest()
        r = self._ensure_region(m, name)
        if r is None:
            return f"Region {name} not found"
        if on:
            r["shine_mode"] = True
        else:
            r.pop("shine_mode", None)
        save_manifest(m)
        return f"{name}: shine mode {'ON' if on else 'OFF'}"

    def _shinefrom(self, payload: dict) -> str:
        """LEGACY: builds a halo (now called `glow`) on a `_shine`/`_glow`
        region from its base sibling. Kept for backwards compatibility — the
        live UI uses the generic /setmode + /fxbuild flow. The halo behaviour
        moved to `make_glow`, so this endpoint now produces a glow."""
        name = payload.get("name", "")
        suf = next((s for s in ("_glow", "_shine") if name.endswith(s)), None)
        if not suf:
            return f"{name} is not a *_shine / *_glow region"
        base_name = name[: -len(suf)]
        m = load_manifest()
        regions = all_regions(m)
        base = next((r for r in regions if r["name"] == base_name), None)
        if base is None:
            return f"No base region '{base_name}' for {name}"
        src = (batch_atlas.override_image_path(base)
               or batch_atlas._pick_variant_png(BATCH_DIR, base))
        if not src or not src.exists():
            return (f"Base '{base_name}' has no generated image yet — "
                    f"generate/lock it first, then make the glow")
        rgn_for_params = next((r for b in ("regions", "rotated_regions")
                               for r in m.get(b, []) if r.get("name") == name),
                              None) or {}
        prev = rgn_for_params.get("shine", {})  # legacy halo params
        p = dict(shine.GLOW_DEFAULTS)
        p.update({k: v for k, v in prev.items() if v not in ("", None)})
        p.update({k: v for k, v in (payload or {}).items()
                  if k in shine.GLOW_DEFAULTS and v not in ("", None)})

        def _clamp(key, cast):
            lo, hi = shine.GLOW_RANGES[key]
            try:
                return max(lo, min(hi, cast(p[key])))
            except (TypeError, ValueError):
                return shine.GLOW_DEFAULTS[key]

        params = {
            "color": str(p.get("color") or shine.GLOW_DEFAULTS["color"]),
            "blur": _clamp("blur", float),
            "intensity": _clamp("intensity", float),
            "layers": int(_clamp("layers", float)),
        }
        try:
            from PIL import Image
            img = shine.make_glow(
                Image.open(src),
                color=shine.hex_to_rgb(params["color"]),
                blur=params["blur"],
                intensity=params["intensity"],
                layers=params["layers"],
            )
        except Exception as e:  # noqa: BLE001
            return f"Glow failed: {e}"
        (INPUT_DIR / "refs").mkdir(parents=True, exist_ok=True)
        rel = f"refs/useroutput_{name}.png"
        img.save(INPUT_DIR / rel)
        r = self._ensure_region(m, name)
        if r is None:
            return f"Region {name} not found"
        r["output_override"] = rel
        r["shine"] = params  # remember settings for next time / re-runs
        save_manifest(m)
        return (f"{name}: glow from '{base_name}' ({src.name}) — "
                f"color {params['color']}, blur {params['blur']}, "
                f"amount {params['intensity']}, layers {params['layers']}. "
                f"Create Atlas to apply; ✕ revert to undo.")

    def _fx_source(self, m: dict, name: str) -> Path | None:
        """Source image for a local FX build. If the region is an FX layer of
        a base element (`<base>_shine` / `<base>_glow` / `<base>_shadow`) and
        that base has a committed image, derive from it (so the FX matches
        the regenerated base). Otherwise, in order: the frozen FX-source
        snapshot (so rebuilds stay idempotent and never stack FX-on-FX); the
        region's committed user image (the picture shown on the card); its
        picked/latest generated variant; finally its own reference
        (style_ref / shape_ref / atlas slice)."""
        regions = all_regions(m)
        for suf in ("_shine", "_glow", "_shadow", "_blur", "_zoom"):
            if name.endswith(suf):
                base = next((r for r in regions
                             if r["name"] == name[: -len(suf)]), None)
                if base is not None:
                    s = (batch_atlas.override_image_path(base)
                         or batch_atlas._pick_variant_png(BATCH_DIR, base))
                    if s and s.exists():
                        return s
        region = next((r for r in regions if r["name"] == name), None) or {}
        # 1. Frozen original captured at the first FX build (see _fxbuild).
        #    Always wins so re-tuning params re-derives from the SAME source
        #    instead of recolouring an already-recoloured image.
        snap = INPUT_DIR / f"refs/fxsrc_{name}.png"
        if snap.exists():
            return snap
        # 2. The user's committed image (what's shown on the card). Safe to
        #    use unconditionally: FX writes its result to the same
        #    useroutput_<name>.png, but it ALWAYS snapshots first, so once an
        #    FX has run step 1 returns the frozen original and we never reach
        #    here with an FX result. No snapshot => this file can only be the
        #    user's own picked/ref image.
        up = batch_atlas.override_image_path(region)
        if up and up.exists():
            return up
        # 3. Picked / locked / latest generated variant.
        s = batch_atlas._pick_variant_png(BATCH_DIR, region)
        if s and s.exists():
            return s
        # 4. The region's own reference (original atlas slice, etc.).
        for key in ("style_ref", "shape_ref"):
            ref = region.get(key)
            if ref:
                p = Path(ref) if Path(ref).is_absolute() else INPUT_DIR / ref
                if p.exists():
                    return p
        return None

    def _setmode(self, payload: dict) -> str:
        """Persist a region's card mode: ai | colour | shadow | shine | glow
        | blur. Switching to 'ai' drops any local-FX output_override (+ its
        file) so normal generation takes over again."""
        name = payload.get("name", "")
        mode = str(payload.get("mode", "ai")).strip().lower() or "ai"
        if mode not in ("ai", "colour", "shadow", "shine", "glow", "blur",
                        "zoom"):
            return f"Unknown mode '{mode}'"
        m = load_manifest()
        r = self._ensure_region(m, name)
        if r is None:
            return f"Region {name} not found"
        if mode == "ai":
            r.pop("mode", None)
            r.pop("shine_mode", None)  # legacy flag
            fx_rel = f"refs/useroutput_{name}.png"
            if r.get("output_override") == fx_rel:
                r.pop("output_override", None)
                try:
                    (INPUT_DIR / fx_rel).unlink(missing_ok=True)
                except OSError:
                    pass
            _drop_fx_snapshot(name)
            save_manifest(m)
            return f"{name}: AI gen (local FX cleared) — render to regenerate"
        r["mode"] = mode
        r.pop("shine_mode", None)
        save_manifest(m)
        return (f"{name}: {mode} mode — set the controls and ⚙ build, "
                f"then Create Atlas")

    def _fxbuild(self, payload: dict) -> str:
        """Build a region locally (shine/shadow/colour) from its source,
        bind the result as output_override, and persist the params under
        region['fx'][mode]. No ComfyUI / no credits."""
        name = payload.get("name", "")
        mode = str(payload.get("mode", "")).strip().lower()
        if mode not in shine.FX_PRESETS:
            return f"Unknown FX mode '{mode}'"
        m = load_manifest()
        src = self._fx_source(m, name)
        if not src:
            return (f"{name}: no source image yet — set a reference / slice "
                    f"the atlas (or generate the base) first")
        # Freeze the resolved source the first time FX is built for this
        # region. The FX result is written to useroutput_<name>.png, which is
        # ALSO where a user "use my image" picture lives — without this frozen
        # copy a second build (e.g. tweaking the colour) would recolour the
        # already-recoloured output. _fx_source returns this snapshot first,
        # so every rebuild derives from the original. Invalidated when the
        # user supplies a new image / reverts / switches back to AI.
        snap = INPUT_DIR / f"refs/fxsrc_{name}.png"
        if not snap.exists():
            try:
                snap.parent.mkdir(parents=True, exist_ok=True)
                snap.write_bytes(Path(src).read_bytes())
                src = snap
            except OSError:
                pass  # snapshot is an optimisation; build from src regardless
        defaults, ranges = shine.FX_PRESETS[mode]
        r = self._ensure_region(m, name)
        if r is None:
            return f"Region {name} not found"
        # Legacy r["shine"] dict held the OLD halo params (now `glow`).
        prev = (r.get("fx") or {}).get(mode) or (
            r.get("shine") if mode == "glow" else {}) or {}
        p = dict(defaults)
        p.update({k: v for k, v in prev.items() if v not in ("", None)})
        p.update({k: v for k, v in (payload or {}).items()
                  if k in defaults and v not in ("", None)})

        def _clampnum(key):
            dv = defaults[key]
            try:
                v = float(p[key])
            except (TypeError, ValueError):
                return dv
            lo, hi = ranges.get(key, (None, None))
            if lo is not None:
                v = max(lo, min(hi, v))
            return int(round(v)) if isinstance(dv, int) else v

        params = {}
        for key, dv in defaults.items():
            # String params (color, blend mode) pass through; numerics clamp.
            params[key] = (str(p.get(key) or dv)
                           if isinstance(dv, str) else _clampnum(key))
        try:
            base_img = Image.open(src)
            if mode == "shine":
                img = shine.make_shine(
                    base_img,
                    threshold=params["threshold"],
                    softness=params["softness"],
                    boost=params["boost"],
                    overlay=params["overlay"],
                    base_alpha_floor=params["base_alpha_floor"],
                    blur=params["blur"])
            elif mode == "glow":
                img = shine.make_glow(
                    base_img, color=shine.hex_to_rgb(params["color"]),
                    blur=params["blur"], intensity=params["intensity"],
                    layers=params["layers"])
            elif mode == "shadow":
                img = shine.make_shadow(
                    base_img, color=shine.hex_to_rgb(params["color"]),
                    blur=params["blur"], opacity=params["opacity"],
                    offset_x=params["offset_x"], offset_y=params["offset_y"])
            elif mode == "blur":
                img = shine.make_blur(
                    base_img, kind=params.get("kind", "gaussian"),
                    radius=params["radius"],
                    preserve_alpha=params["preserve_alpha"])
            elif mode == "zoom":
                img = shine.make_zoom(
                    base_img, amount=params["amount"],
                    steps=params["steps"], cx=params["cx"], cy=params["cy"],
                    preserve_alpha=params["preserve_alpha"])
            else:  # colour
                img = shine.make_recolour(
                    base_img, color=shine.hex_to_rgb(params["color"]),
                    amount=params["amount"],
                    blend=params.get("blend", "overlay"))
        except Exception as e:  # noqa: BLE001
            return f"{mode} build failed: {e}"
        (INPUT_DIR / "refs").mkdir(parents=True, exist_ok=True)
        rel = f"refs/useroutput_{name}.png"
        img.save(INPUT_DIR / rel)
        r["output_override"] = rel
        r["mode"] = mode
        fx = r.setdefault("fx", {})
        fx[mode] = params
        if mode == "glow":
            r["shine"] = params  # legacy key — old halo params lived here
        save_manifest(m)
        ps = ", ".join(f"{k} {v}" for k, v in params.items())
        return (f"{name}: built {mode} from {src.name} ({ps}). "
                f"Create Atlas to apply; switch mode to AI gen to undo.")

    def _saveconfig(self, edits: dict) -> str:
        cfg = load_config()
        m = load_manifest()
        settings = m.get("settings") or {}
        atlas = m.setdefault("atlas", {})
        numeric = {k for k, _, t in CONFIG_FIELDS if t == "number"}

        def _num(v):
            try:
                return float(v) if "." in str(v) else int(v)
            except ValueError:
                return v

        for k, v in edits.items():
            if k in ("deploy_path", "deploy_basename"):
                sv = str(v).strip()
                if sv:
                    m[k] = sv
                else:
                    m.pop(k, None)
            elif k in _ATLAS_GEOM_KEYS:
                sv = str(v).strip()
                if sv == "":
                    continue  # never wipe required atlas geometry
                mk = _ATLAS_GEOM_KEYS[k]
                atlas[mk] = int(float(sv)) if k in _ATLAS_GEOM_NUMERIC else sv
            elif k in PER_ATLAS_KEYS:
                sv = str(v).strip()
                if sv == "":
                    settings.pop(k, None)        # blank => inherit global
                else:
                    settings[k] = _num(v) if k in numeric else v
            else:
                cfg[k] = _num(v) if k in numeric else v

        if settings:
            m["settings"] = settings
        else:
            m.pop("settings", None)
        save_manifest(m)
        save_config(cfg)
        return "Settings saved (per-atlas overrides + globals)"


def main():
    from iw_banner import print_banner
    print_banner("Atlas Maker", BUILD,
                 footer=f"http://{HOST}:{PORT}   ·   Ctrl+C to stop")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
