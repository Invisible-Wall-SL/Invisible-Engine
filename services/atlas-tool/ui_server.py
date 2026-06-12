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
import atlas_writers  # noqa: E402  (TexturePacker JSON for game-loadable deploy)
import batch_atlas  # noqa: E402  (reuse the geometry resolver — single source)
import blueprints  # noqa: E402  (shared, data-driven ComfyUI pipeline library)
import shine  # noqa: E402  (local *_shine derivation, no ComfyUI)

# Self-contained tool folder (Tools/<Tool Name>/). All code, config and
# manifests live here together; per-game ComfyUI dirs come from project_paths.
import storage  # noqa: E402  (R2 object storage + staging mirror)
from iw_common.diagnostics import canonical, diag, parse_diag_line  # noqa: E402
from iw_common.splash import splash_html  # noqa: E402  (shared CRT boot splash)
from diag_catalog import CATALOG  # noqa: E402


def _diag(code: str, **ctx) -> str:
    """Canonical (what/why/fix) string for a sync-handler failure return.

    The returned text is shown in the toast; the UI promotes any string that
    starts with a severity glyph (✖/⚠/ℹ) into a colored diagnostic card.
    """
    return canonical(diag(code, CATALOG, **ctx))

SELF = Path(__file__).resolve().parent
TOOLS = SELF

# ---------------------------------------------------------------------------
# Request-local path resolution.
#
# The server is a ThreadingHTTPServer (one thread per request). The active
# (client, project) lives in project_paths' thread-local context, so every
# path must be resolved PER REQUEST, on the request's own thread — never copied
# into a module global that another concurrent request could overwrite.
#
# To keep the original ~130 call sites (BATCH_DIR / INPUT_DIR / ...) unchanged
# while making each read thread-local, these names are bound to tiny proxies
# that resolve the live value from project_paths.resolve() on EVERY access.
# A `BATCH_DIR / "x"`, `INPUT_DIR.exists()`, `f"{R2_PREFIX}/..."`,
# `Path(STAGING_ROOT)` etc. all hit the calling thread's current context.
# ---------------------------------------------------------------------------


class _PathProxy:
    """A Path that always reflects the calling thread's resolved context.

    `_key` indexes project_paths.resolve(); `_sub` is an optional child path
    appended to it (used for CONFIG_PATH = staging_root / 'atlas_config.json').
    Delegates every attribute/operator to a freshly-resolved Path, so existing
    pathlib usage works unchanged and is request-local."""

    __slots__ = ("_key", "_sub")

    def __init__(self, key: str, sub: str | None = None):
        self._key = key
        self._sub = sub

    def _live(self) -> Path:
        p = Path(project_paths.resolve()[self._key])
        return p / self._sub if self._sub else p

    def __fspath__(self) -> str:
        return str(self._live())

    def __str__(self) -> str:
        return str(self._live())

    def __repr__(self) -> str:
        return repr(self._live())

    def __truediv__(self, other):
        return self._live() / other

    def __rtruediv__(self, other):
        return other / self._live()

    def __eq__(self, other):
        return self._live() == other

    def __hash__(self):
        return hash(self._live())

    def __getattr__(self, name):
        return getattr(self._live(), name)


class _StrProxy:
    """A str that always reflects the calling thread's resolved context (used
    for R2_PREFIX / COMFY_HOST). `.get()`-style miss returns ''."""

    __slots__ = ("_key",)

    def __init__(self, key: str):
        self._key = key

    def _live(self) -> str:
        return project_paths.resolve().get(self._key) or ""

    def __str__(self) -> str:
        return self._live()

    def __bool__(self) -> bool:
        return bool(self._live())

    def __format__(self, spec) -> str:
        return format(self._live(), spec)

    def __eq__(self, other):
        return self._live() == other

    def __hash__(self):
        return hash(self._live())

    def __getattr__(self, name):
        return getattr(self._live(), name)


BATCH_DIR = _PathProxy("batch_dir")
ATLAS_DIR = _PathProxy("atlas_dir")
INPUT_DIR = _PathProxy("input_dir")
# Cloud: config + manifests live in the R2-backed staging tree (not the app
# dir), so user edits survive container restarts.
STAGING_ROOT = _PathProxy("staging_root")
MANIFEST_DIR = _PathProxy("manifest_dir")
CONFIG_PATH = _PathProxy("staging_root", "atlas_config.json")
R2_PREFIX = _StrProxy("r2_project_prefix")
COMFY_HOST = _StrProxy("comfy_host")


# Local-disk size/format helpers live in iw_common.storage (shared with the
# Sheet Maker); re-exposed under the original private names so the call sites
# below stay unchanged.
_dir_size = storage.dir_size
_human_bytes = storage.human_bytes


def _mirror(p: Path) -> None:
    """Write-through: mirror a staging file to its R2 key so it persists."""
    r2_prefix = str(R2_PREFIX)
    staging_root = Path(STAGING_ROOT)
    if not r2_prefix:
        return
    try:
        rel = Path(p).resolve().relative_to(staging_root.resolve()).as_posix()
        storage.push_file(Path(p), f"{r2_prefix}/{rel}")
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


def _truthy_env(name: str) -> bool:
    """A loose env truthiness test for boolean flags (1/true/yes/on)."""
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


# Blueprint publishing (upload/overwrite) is the only WRITE path into the SHARED
# cross-project library, so it's gated separately from the read/run gate above —
# and gated by KNOWLEDGE OF A SECRET, not a forgeable flag. The launcher appends
# `bp=<ATLAS_BLUEPRINT_SECRET>` to the /atlas redirect ONLY for users holding the
# `blueprintPublish` capability (mirrors how it appends `?k=<ATLAS_TOOL_SECRET>`);
# the tool sets a per-session `atlas_bp=<secret>` cookie and publishing requires
# that the param/cookie EQUAL the secret. A bare `bp=1` is meaningless — every
# atlas user already holds `?k=`, so a non-secret flag would let anyone publish.
# When no publish secret is configured the tool falls back to dev/local rules:
# open only if there's no tool secret at all (local) or the explicit env override.
ATLAS_BLUEPRINT_SECRET = os.environ.get("ATLAS_BLUEPRINT_SECRET", "").strip()
ATLAS_BLUEPRINT_PUBLISH = _truthy_env("ATLAS_BLUEPRINT_PUBLISH")

# POST routes that write/remove ref images → mirror staging refs to R2 after.
_REF_MUTATING_ROUTES = {
    "/setref", "/setoutput", "/userefimg", "/userefall", "/shinefrom",
    "/shinemode", "/fxbuild", "/clearref", "/clearoutput", "/setmode",
    "/delvariants", "/uploadatlas",
}


# Minimal default config used when none exists yet in R2/staging (first run).
# Secrets (comfy.org key) come from env, never persisted here.
DEFAULT_CONFIG = {
    "manifest_path": "atlas_manifest_symbols.json",
    "comfy_host": str(COMFY_HOST),
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
    # Inner-fit transparent margin per element (see batch_atlas._DEFAULTS).
    # 0 = edge-to-edge in-slot; opt-in per atlas. Keep in sync with batch_atlas.
    "padding_pct": 0.0,
    "gen_width": 1024,
    "gen_height": 1024,
    "auto_fx_rebuild": "on",
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
BUILD = "v15-extra-prompts"  # shown in the startup banner so you can verify the live code

_render_state = {"running": False, "log": "", "done": False, "cur": 0,
                 "total": 0, "diagnostics": []}
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
    ("rembg", "Remove background (cutout)", "text"),
    ("auto_fx_rebuild", "Auto-rebuild FX layers on render/compose", "text"),
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
    "checkpoint", "lora", "lora_strength", "controlnet", "rmbg_model", "rembg",
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
    "rembg":
        "Remove the background after generating (subject cutout → transparent "
        "PNG). Keep ON for game icons/symbols. Turn OFF for a full-bleed image "
        "that must keep its background — e.g. a game BACKGROUND scene — so the "
        "saved PNG is the opaque render. Per-atlas: blank = inherit global.",
    "mockup_image":
        "Optional default IPAdapter style image, used for any region that has "
        "no own style_ref / atlas slice. It transfers overall look (palette, "
        "shading, finish) — not shape. Per-region slices override it. Leave "
        "blank to skip style transfer entirely (prompt + ControlNet only).",
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
        "its atlas slot. Default 0 = edge-to-edge (no border) — full-bleed "
        "backgrounds fill exactly. Raise it (e.g. 0.1) only if you want "
        "breathing room so neighbouring symbols don't touch.",
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


def _pipeline_options_html(current: str) -> str:
    """<option>s for the pipeline <select>: the three built-in Python paths
    under a "Built-in" optgroup, then every SHARED blueprint (that isn't one of
    the three built-in keywords — those reference blueprints share an id with a
    built-in and stay on the built-in Python path per the run_region dispatch,
    so we never double-list them) under a "Blueprints" optgroup.

    The current value is always kept selectable even if its blueprint vanished
    from the library (so saving never silently changes a configured pipeline).
    Best-effort on the blueprint list — an R2/hydrate hiccup just yields the
    three built-ins (never raises into the page render)."""
    cur = current or "sdxl"
    try:
        bps = blueprints.list_blueprints()
    except Exception:  # noqa: BLE001 — UI must render even if R2 is down
        bps = []
    # Blueprint optgroup: ids that aren't one of the three built-in keywords.
    extra = [b for b in bps
             if str(b.get("id", "")) not in PIPELINE_OPTIONS]
    known_ids = set(PIPELINE_OPTIONS) | {str(b.get("id", "")) for b in extra}

    out = ['<optgroup label="Built-in">']
    for v in PIPELINE_OPTIONS:
        sel = " selected" if v == cur else ""
        out.append(f'<option value="{html.escape(v, quote=True)}"{sel}>'
                   f'{html.escape(v)}</option>')
    out.append('</optgroup>')
    if extra:
        out.append('<optgroup label="Blueprints">')
        for b in extra:
            bid = str(b.get("id", ""))
            name = str(b.get("name", "") or bid)
            sel = " selected" if bid == cur else ""
            out.append(f'<option value="{html.escape(bid, quote=True)}"{sel}>'
                       f'{html.escape(name)}</option>')
        out.append('</optgroup>')
    # Keep an unknown current value (a blueprint that was removed) selectable so
    # saving doesn't silently rewrite it.
    if cur and cur not in known_ids:
        out.append(f'<option value="{html.escape(cur, quote=True)}" selected>'
                   f'{html.escape(cur)} (not in library)</option>')
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
                f'{_pipeline_options_html(cur or "sdxl")}</select>')
    if key == "rembg":
        # on/off cutout toggle. Per-atlas keeps a blank "(inherit global)"
        # choice; the global config picks a concrete on/off (default on).
        norm = "" if cur == "" else ("on" if batch_atlas._truthy(cur, True)
                                     else "off")
        if allow_blank:
            return (f'<select{common}>'
                    f'{_opt_html(["on", "off"], norm, blank_label)}</select>')
        return (f'<select{common}>'
                f'{_opt_html(["on", "off"], norm or "on")}</select>')
    if key == "auto_fx_rebuild":
        # Global on/off; a missing/blank value means ON (default).
        norm = "on" if batch_atlas._truthy(cur, True) else "off"
        return (f'<select{common}>'
                f'{_opt_html(["on", "off"], norm)}</select>')
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


def _manifest_deploy_stem(m: dict, manifest_filename: str) -> str:
    """The deployed output stem a generation manifest produces — i.e. the
    sheet/atlas filename the editor sees. Mirrors _deployatlas' field access
    so the deep-link resolve stays consistent: `deploy_basename` wins, else the
    basename of `deploy_path`, else the manifest stem sans `atlas_manifest_`."""
    base = str(m.get("deploy_basename", "")).strip()
    if base:
        return Path(base).stem
    dp = str(m.get("deploy_path", "")).replace("\\", "/").strip().strip("/")
    if dp:
        tail = dp.rsplit("/", 1)[-1]
        # `deploy_path` is normally a folder prefix, but legacy values may name
        # the file directly; only treat it as a filename if it has a suffix.
        if tail and Path(tail).suffix:
            return Path(tail).stem
    return Path(manifest_filename).stem.replace("atlas_manifest_", "")


def resolve_atlas_to_manifest(atlas: str) -> str | None:
    """Map a deployed sheet/atlas filename (what the editor sprite uses, e.g.
    'reels_frame.json') to the generation manifest that owns it. Returns the
    manifest filename (in MANIFEST_DIR) or None if no Atlas Maker recipe owns
    this atlas. Best-effort and exception-safe — callers fall back on None."""
    try:
        if not atlas:
            return None
        want = Path(atlas).name
        manifests = list_manifests()
        # 1) Direct: the atlas IS a known manifest (atlas_manifest_*.json/.atlas).
        if want in manifests:
            return want
        # 2) By deployed output stem.
        want_stem = Path(want).stem
        if not MANIFEST_DIR.exists():
            return None
        for mp in sorted(MANIFEST_DIR.glob("atlas_manifest_*.json")):
            try:
                m = json.loads(mp.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if not isinstance(m, dict):
                continue
            if _manifest_deploy_stem(m, mp.name) == want_stem:
                return mp.name
        return None
    except Exception:  # noqa: BLE001 — resolution must never break the index
        return None


def _tp_frame_to_region(name: str, f: dict) -> dict:
    """Convert ONE TexturePacker (json-hash) frame to the Atlas Maker snake_case
    region. Mirrors apps/launcher-api/scripts/lib/tpRegions.mjs::tpFrameToRegion
    exactly: frame.x/y/w/h → on-page rect (w/h = unrotated trimmed size);
    rotated bool; spriteSourceSize.x/y → off_x/off_y; sourceSize.w/h →
    orig_w/orig_h."""
    fr = (f.get("frame") if isinstance(f, dict) else None) or {}
    fw = int(fr.get("w") or 0)
    fh = int(fr.get("h") or 0)
    sss = (f.get("spriteSourceSize") if isinstance(f, dict) else None) or {}
    src = (f.get("sourceSize") if isinstance(f, dict) else None) or {}
    return {
        "name": name,
        "x": int(fr.get("x") or 0),
        "y": int(fr.get("y") or 0),
        "w": fw,
        "h": fh,
        "rotated": bool(isinstance(f, dict) and f.get("rotated")),
        "off_x": int(sss.get("x") or 0),
        "off_y": int(sss.get("y") or 0),
        "orig_w": int(src.get("w") or fw),
        "orig_h": int(src.get("h") or fh),
    }


def _tp_frame_entries(frames) -> list[tuple[str, dict]]:
    """Normalize a TexturePacker `frames` block (json-hash object OR json-array)
    into [(name, frame)] entries. Array frames carry their key in `filename`.
    Mirrors tpRegions.mjs::tpFrameEntries."""
    if isinstance(frames, list):
        out = []
        for f in frames:
            if isinstance(f, dict):
                nm = str(f.get("filename") or "")
                if nm:
                    out.append((nm, f))
        return out
    if isinstance(frames, dict):
        return [(str(k), v) for k, v in frames.items() if isinstance(v, dict)]
    return []


def _normalize_converted_region(r: dict) -> dict | None:
    """Normalize an already-converted editor/seed region (camelCase OR
    snake_case) to the Atlas Maker snake_case shape. Returns None if it lacks a
    usable name/rect."""
    if not isinstance(r, dict):
        return None
    name = r.get("name")
    if not name:
        return None

    def pick(*keys, default=None):
        for k in keys:
            if r.get(k) is not None:
                return r[k]
        return default

    try:
        x = int(pick("x", default=0))
        y = int(pick("y", default=0))
        w = int(pick("w"))
        h = int(pick("h"))
    except (TypeError, ValueError):
        return None
    return {
        "name": name,
        "x": x, "y": y, "w": w, "h": h,
        "rotated": bool(r.get("rotated")),
        "off_x": int(pick("off_x", "offX", default=0)),
        "off_y": int(pick("off_y", "offY", default=0)),
        "orig_w": int(pick("orig_w", "origW", default=w)),
        "orig_h": int(pick("orig_h", "origH", default=h)),
    }


def _slice_region_from_page(src: Image.Image, region: dict) -> Image.Image | None:
    """Cut one region's upright art out of the packed page image. Mirrors
    slice_atlas.slice_regions' rotation handling: w/h are the UNROTATED size, so
    a rotated frame occupies (h x w) on the page and is rotated +90 back upright
    (the exact inverse of the unified compose's PIL rotate(-90) PixiJS-standard
    pack). Returns None if the rect is empty / out of bounds."""
    sw, sh = src.size
    x = int(region.get("x", 0))
    y = int(region.get("y", 0))
    w = int(region.get("w") or 0)
    h = int(region.get("h") or 0)
    rotated = bool(region.get("rotated"))
    pw, ph = (h, w) if rotated else (w, h)
    box = (max(0, x), max(0, y), min(sw, x + pw), min(sh, y + ph))
    if box[2] <= box[0] or box[3] <= box[1]:
        return None
    crop = src.crop(box)
    if rotated:
        crop = crop.rotate(90, expand=True)
    return crop


def _import_asset_map_deploy(stem: str) -> tuple[str, str]:
    """Best-effort (deploy_path, deploy_basename) for an imported sheet, read
    from the project's asset-map (<R2_PREFIX>/asset-map.json) keyed by stem.
    Missing/invalid map → ("", stem) so a later Deploy still has a basename and
    the existing 'no deploy_path' warning prompts the user. Never raises."""
    deploy_path = ""
    deploy_basename = stem
    try:
        prefix = str(R2_PREFIX) if R2_PREFIX else ""
        if not prefix:
            return deploy_path, deploy_basename
        blob = storage.get(f"{prefix}/asset-map.json")
        if not blob:
            return deploy_path, deploy_basename
        amap = json.loads(blob)
        if not isinstance(amap, dict):
            return deploy_path, deploy_basename
        entry = amap.get(stem)
        if entry is None:  # case-insensitive fallback
            entry = {str(k).lower(): v for k, v in amap.items()}.get(stem.lower())
        if isinstance(entry, dict):
            dp = str(entry.get("deploy_path", "")).replace("\\", "/").strip().strip("/")
            if dp and not (re.match(r"^[A-Za-z]:/", dp) or dp.startswith("/")):
                deploy_path = dp
            mb = str(entry.get("deploy_basename", "")).strip()
            if mb:
                deploy_basename = mb
    except Exception:  # noqa: BLE001 — asset-map is optional, never fatal
        pass
    return deploy_path, deploy_basename


def _page_only_hint(m: dict, stem: str) -> bool:
    """Best-effort: does the active manifest resolve to a Spine target, so the
    Deploy UI should pre-check "Page-only (Spine page)"? Mirrors triggers 1 & 2
    of _deployatlas' page-only detection (manifest flag + asset-map kind), the
    two cheap/no-network-after-startup checks. Trigger 3 (probing the deployed
    `.json` in R2) is intentionally skipped here — it's the server's safety net
    at deploy time, too heavy/uncertain for a UI hint. Never raises."""
    try:
        if m.get("deploy_page_only") or m.get("page_only"):
            return True
        prefix = str(R2_PREFIX) if R2_PREFIX else ""
        if not prefix:
            return False
        blob = storage.get(f"{prefix}/asset-map.json")
        if not blob:
            return False
        amap = json.loads(blob)
        if not isinstance(amap, dict):
            return False
        man_base = str(m.get("deploy_basename", "")).strip()
        cands = [c for c in (man_base, stem) if c]
        entry = None
        for c in cands:
            if c in amap:
                entry = amap[c]
                break
        if entry is None:  # case-insensitive fallback
            lowered = {str(k).lower(): v for k, v in amap.items()}
            for c in cands:
                hit = lowered.get(c.lower())
                if hit is not None:
                    entry = hit
                    break
        if isinstance(entry, dict):
            return str(entry.get("kind", "")).strip().lower() == "spine"
    except Exception:  # noqa: BLE001 — asset-map is optional, never fatal
        pass
    return False


def import_sheet_to_manifest(atlas: str) -> str | None:
    """Auto-import an existing TexturePacker / editor sheet into a NEW Atlas
    Maker generation manifest and make it active. Returns the new manifest
    filename (atlas_manifest_<stem>.json) on success, else None. Fully
    exception-safe — any failure returns None so the deep-link renders a notice,
    never a 500.

    The source sheet is the hydrated `manifests/<basename(atlas)>` JSON. Both
    shapes are handled: raw TexturePacker (`frames`+`meta`) and an
    already-converted editor/seed manifest (`regions`+`atlas.source_image_path`).
    Each region's CURRENT art is sliced out of the page and bound as its
    `output_override` (mirrored to R2), so the cards show the existing art and
    Create Atlas re-packs it (re-fit from the sliced art) until the user
    replaces a frame."""
    try:
        if not atlas:
            return None
        name = Path(atlas).name
        stem = Path(atlas).stem
        MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
        # An existing recipe for this stem (resolve only missed it because its
        # deploy stem diverged) must be ACTIVATED, never overwritten — a rewrite
        # would destroy the user's prompts/seeds/refs. Open it instead.
        existing = MANIFEST_DIR / f"atlas_manifest_{stem}.json"
        if existing.exists():
            try:
                cfg = load_config()
                cfg["manifest_path"] = existing.name
                save_config(cfg)
                return existing.name
            except OSError:
                return None
        src_path = MANIFEST_DIR / name
        if not src_path.exists():
            # The sheet JSON itself may not be hydrated yet — pull by basename.
            pulled = batch_atlas._hydrate_from_r2_by_name(name)
            if pulled is not None and pulled.exists():
                src_path = pulled
        if not src_path.exists():
            return None
        try:
            doc = json.loads(src_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if not isinstance(doc, dict):
            return None

        # --- Parse regions + page metadata from whichever shape we got. ------
        regions: list[dict] = []
        page_name = ""
        page_ref = ""
        width = height = 0
        if isinstance(doc.get("frames"), (dict, list)):
            # Raw TexturePacker (frames + meta).
            for fname, f in _tp_frame_entries(doc.get("frames")):
                regions.append(_tp_frame_to_region(fname, f))
            meta = doc.get("meta") or {}
            page_name = Path(str(meta.get("image") or "").replace("\\", "/")).name
            size = meta.get("size") or {}
            width = int(size.get("w") or 0)
            height = int(size.get("h") or 0)
        elif isinstance(doc.get("regions"), list):
            # Already-converted editor/seed manifest.
            for r in doc.get("regions"):
                norm = _normalize_converted_region(r)
                if norm is not None:
                    regions.append(norm)
            atlas_block = doc.get("atlas") or {}
            page_ref = (atlas_block.get("source_image_path")
                        or atlas_block.get("source_image") or "")
            page_name = Path(str(page_ref).replace("\\", "/")).name
            width = int(doc.get("width") or atlas_block.get("width") or 0)
            height = int(doc.get("height") or atlas_block.get("height") or 0)
        if not regions:
            return None

        # --- Split into the two buckets the tool uses. ----------------------
        upright = [r for r in regions if not r.get("rotated")]
        rotated = [r for r in regions if r.get("rotated")]

        # --- Resolve the page image into staging so we can slice it. --------
        page_path: Path | None = None
        if page_name:
            for cand in (MANIFEST_DIR / page_name,
                         INPUT_DIR / "refs" / "atlas" / page_name,
                         INPUT_DIR / page_name):
                if cand.exists():
                    page_path = cand
                    break
            if page_path is None:
                # Sheet-Maker page ref: hydrate by EXACT key (no list scan),
                # preserving the sheets/sheet_src subtree — same as the other
                # resolvers. Non-sheet refs fall back to the basename scan.
                page_srel = batch_atlas._staging_rel(page_ref) if page_ref else ""
                if page_srel.startswith("sheets/") or page_srel.startswith("sheet_src/"):
                    pulled = batch_atlas._hydrate_from_r2_by_name(page_name, r2_key=page_ref)
                else:
                    pulled = batch_atlas._hydrate_from_r2_by_name(page_name)
                if pulled is not None and pulled.exists():
                    page_path = pulled
        if page_path is None or not page_path.exists():
            return None

        # --- Slice each region's CURRENT art and bind it as output_override.
        try:
            page_img = Image.open(page_path).convert("RGBA")
        except Exception:  # noqa: BLE001 — unreadable page → can't import
            return None
        if not width or not height:
            width, height = page_img.size
        (INPUT_DIR / "refs").mkdir(parents=True, exist_ok=True)
        for r in upright + rotated:
            try:
                crop = _slice_region_from_page(page_img, r)
                if crop is None:
                    continue
                rel = f"refs/useroutput_{r['name']}.png"
                crop.save(INPUT_DIR / rel)
                _mirror(INPUT_DIR / rel)  # persist verbatim art to R2
                r["output_override"] = rel
            except Exception:  # noqa: BLE001 — one bad region must not abort all
                continue

        # --- Stage the page so source_image_candidates() finds it later. ----
        page_staged_rel = f"refs/atlas/{page_name}"
        try:
            dest = INPUT_DIR / page_staged_rel
            if not dest.exists():
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(page_path.read_bytes())
                _mirror(dest)
        except OSError:
            page_staged_rel = page_name  # best-effort; geometry still works

        # --- Deploy target (best-effort from asset-map). --------------------
        deploy_path, deploy_basename = _import_asset_map_deploy(stem)

        # --- Build + persist the manifest in the tool's own shape. ----------
        manifest = {
            "atlas": {
                "source_image": page_staged_rel,
                "source_image_path": page_staged_rel,
                "width": width,
                "height": height,
                "format": "RGBA8888",
            },
            "width": width,
            "height": height,
            "style": {"positive_prefix": "", "positive_suffix": "",
                      "negative": ""},
            "regions": upright,
            "rotated_regions": rotated,
            "deploy_path": deploy_path,
            "deploy_basename": deploy_basename,
        }
        out_name = f"atlas_manifest_{stem}.json"
        out_path = MANIFEST_DIR / out_name
        out_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False),
                            encoding="utf-8")
        _mirror(out_path)

        # --- Activate it. ---------------------------------------------------
        try:
            cfg = load_config()
            cfg["manifest_path"] = out_name
            save_config(cfg)
        except OSError:
            return None
        return out_name
    except Exception:  # noqa: BLE001 — import must never break the deep-link
        return None


def _drop_fx_snapshot(name: str) -> None:
    """Discard a region's frozen FX source (refs/fxsrc_<name>.png) so the
    next FX build re-captures from the new image. Called whenever the real
    source changes: user supplies an image, reverts, or switches to AI."""
    try:
        (INPUT_DIR / f"refs/fxsrc_{name}.png").unlink(missing_ok=True)
    except OSError:
        pass


def _resolve_region_ref(ref: str) -> Path | None:
    """Resolve a region reference field (shape_ref / style_ref) to a real file
    in staging. Handles three forms:
      - absolute container path → as-is;
      - a Sheet-Maker key (`sheets/…` / `sheet_src/…`, with or without the
        `<C>/<P>` prefix) → lazy-hydrate the subtree, return STAGING_ROOT /
        _staging_rel(ref); hydrate that exact key by-name if not on disk yet;
      - anything else → INPUT_DIR-relative (legacy refs/ behaviour, unchanged).
    Returns the resolved Path if it exists, else None."""
    if not ref:
        return None
    if Path(ref).is_absolute():
        p = Path(ref)
        return p if p.exists() else None
    srel = batch_atlas._staging_rel(ref)
    if srel.startswith("sheets/") or srel.startswith("sheet_src/"):
        project_paths.ensure_lazy(
            "sheets/" if srel.startswith("sheets/") else "sheet_src/")
        p = STAGING_ROOT / srel
        if p.exists():
            return p
        pulled = batch_atlas._hydrate_from_r2_by_name(Path(srel).name, r2_key=ref)
        return pulled if (pulled and pulled.exists()) else None
    p = INPUT_DIR / ref
    return p if p.exists() else None


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
    another from the dropdown or recreate it.

    UNIFY: Sheet-Maker manifests carry R2 keys (`atlas.atlas_file`,
    `atlas.source_image_path`, per-region `shape_ref`) under `sheets/` /
    `sheet_src/`. The Section-2 resolvers (atlas_file_path,
    source_image_candidates, _resolve_region_ref) now hydrate those keys
    DIRECTLY from their Sheet-Maker location into staging — so there is no
    longer a copy/ingest step here. load_manifest just parses + returns."""
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


def _refresh_manifest_from_r2(sel: str) -> None:
    """Re-pull a manifest (and its bound Sheet-Maker `.atlas`) by EXACT R2 key
    into staging, overwriting the staged copies.

    The staging tree hydrates from R2 once per process, but the Sheet Maker
    keeps re-exporting to the same fixed keys (`manifests/atlas_manifest_
    <sheet>.json`, `sheets/<sheet>/<sheet>.atlas`) while this process runs —
    so on manifest ACTIVATION (dropdown switch / deep-link) the staged copies
    may be stale. Loading — and worse, auto-seed re-SAVING — a stale staged
    manifest would push it back to R2 and overwrite the Sheet Maker's fresh
    export. Two exact GETs, only on a real switch; best-effort: an R2 miss or
    outage keeps the local copy (never blanks a working manifest)."""
    name = Path(str(sel).replace("\\", "/")).name
    if not name:
        return
    r2_prefix = str(R2_PREFIX)
    if not r2_prefix:
        return
    try:
        blob = storage.get(f"{r2_prefix}/manifests/{name}")
        if blob:
            dest = MANIFEST_DIR / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(blob)
            print(f"[atlas] refreshed manifest from R2: {name}", flush=True)
    except Exception:  # noqa: BLE001 — keep the staged copy on any R2 trouble
        return
    if not name.lower().endswith(".json"):
        return
    try:
        m = json.loads((MANIFEST_DIR / name).read_text(encoding="utf-8"))
        ref = (m.get("atlas") or {}).get("atlas_file") or ""
        srel = batch_atlas._staging_rel(ref) if ref else ""
        if srel.startswith(("sheets/", "sheet_src/")):
            # _hydrate_from_r2_by_name(r2_key=…) writes the fetched bytes
            # unconditionally (no exists() skip), so this force-refreshes the
            # staged geometry even though atlas_file_path's own cand.exists()
            # early-return would otherwise keep serving the stale copy.
            batch_atlas._hydrate_from_r2_by_name(Path(srel).name, r2_key=ref)
    except Exception:  # noqa: BLE001 — geometry refresh is best-effort too
        pass


# Set by all_regions() when the manifest names regions the bound `.atlas`
# geometry doesn't have (stale staged geometry); _index() shows it as a banner.
_geom_warning: str = ""


def all_regions(m: dict) -> list[dict]:
    """Geometry-aware. When the manifest is bound to a `.atlas`, cards are
    built from the `.atlas` regions merged with this manifest's creative
    data (by name). No `.atlas` → legacy cell-grid / explicit-geometry list."""
    global _geom_warning
    # Reset on entry so a previous manifest's warning can't outlive a switch
    # to a legacy/unbound manifest or a parse failure.
    _geom_warning = ""
    ap = batch_atlas.atlas_file_path(m, manifest_path())
    if ap and ap.exists():
        try:
            atlas_data = atlas_format.parse_atlas(ap)
            merged = batch_atlas.merge_atlas_regions(m, atlas_data)
            # Observability (merge stays .atlas-authoritative): a manifest
            # region with no `.atlas` counterpart is silently dropped by the
            # merge — usually a sign the staged geometry is stale vs R2.
            have = {r.get("name") for r in atlas_data.get("regions", [])}
            missing = [r["name"]
                       for r in (list(m.get("regions") or [])
                                 + list(m.get("rotated_regions") or []))
                       if r.get("name") and r["name"] not in have]
            if missing:
                msg = (f"{len(missing)} manifest region(s) missing from "
                       f"{ap.name} — geometry may be stale; press "
                       f"↻ Refresh from R2")
                if msg != _geom_warning:  # log once per state, not per call
                    print(f"[atlas] {msg} ({', '.join(missing[:10])})",
                          flush=True)
                _geom_warning = msg
            else:
                _geom_warning = ""
            return merged
        except (OSError, ValueError):
            pass
    return list(m.get("regions", [])) + list(m.get("rotated_regions", []))


def atlas_file() -> Path:
    stem = manifest_path().stem.replace("atlas_manifest_", "")
    return ATLAS_DIR / f"{stem}_new.png"


def variant_files(name: str) -> list[Path]:
    # The variant pile hydrates lazily (cloud_paths excludes batch/ from the
    # eager pull). Pull it on first access for this (client, project) so the
    # gallery / compose see every variant that exists in R2 — never an empty
    # local dir. ensure_lazy is idempotent + incremental, so this is a cheap
    # no-op after the first call.
    project_paths.ensure_lazy("batch/")
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


# ---------------------------------------------------------------------------
# Local FX build core (shared by the manual ⚙ endpoint and the automated
# rebuild on render/compose). One code path — see Handler._fxbuild (thin
# wrapper) and rebuild_fx_layers (batch wrapper).
# ---------------------------------------------------------------------------

def fx_source(m: dict, name: str) -> Path | None:
    """Source image for a local FX build. If the region is an FX layer of a
    base element (`<base>_shine`/`_glow`/`_shadow`/`_blur`/`_zoom`) and that
    base has a committed image, derive from it (so the FX matches the
    regenerated base). Otherwise, in order: the frozen FX-source snapshot (so
    rebuilds stay idempotent and never stack FX-on-FX); the region's committed
    user image (the picture shown on the card); its picked/latest generated
    variant; finally its own reference (style_ref / shape_ref / atlas slice)."""
    project_paths.ensure_lazy("batch/")  # variant pile hydrates on demand
    regions = all_regions(m)
    _info = shine.fx_layer_info(name)  # canonical FX-suffix classifier
    if _info:
        base = next((r for r in regions if r["name"] == _info["base"]), None)
        if base is not None:
            s = (batch_atlas.override_image_path(base)
                 or batch_atlas._pick_variant_png(BATCH_DIR, base))
            if s and s.exists():
                return s
    region = next((r for r in regions if r["name"] == name), None) or {}
    # 1. Frozen original captured at the first FX build (see build_fx_region).
    #    Always wins so re-tuning params re-derives from the SAME source
    #    instead of recolouring an already-recoloured image.
    snap = INPUT_DIR / f"refs/fxsrc_{name}.png"
    if snap.exists():
        return snap
    # 2. The user's committed image (what's shown on the card).
    up = batch_atlas.override_image_path(region)
    if up and up.exists():
        return up
    # 3. Picked / locked / latest generated variant.
    s = batch_atlas._pick_variant_png(BATCH_DIR, region)
    if s and s.exists():
        return s
    # 4. The region's own reference (original atlas slice, etc.). Refs may be a
    #    Sheet-Maker `sheets/`/`sheet_src/` key — _resolve_region_ref hydrates it.
    for key in ("style_ref", "shape_ref"):
        ref = region.get(key)
        if ref:
            p = _resolve_region_ref(ref)
            if p is not None:
                return p
    return None


def build_fx_region(m: dict, name: str, mode: str | None = None,
                    payload: dict | None = None) -> tuple[bool, str]:
    """Build a region locally (shine/shadow/colour/glow/blur/zoom) from its
    source, bind the result as output_override, and persist the params under
    region['fx'][mode]. No ComfyUI / no credits. Operates on the passed `m`;
    the CALLER is responsible for save_manifest(m). `mode` defaults to the
    region's stored mode; `payload` (None → stored params only) supplies
    overriding numeric/string params for a manual tune. Mirrors the result PNG
    to R2 so it persists. Returns (True, success_msg) or (False, diag_msg)."""
    src = fx_source(m, name)
    if not src:
        return (False, _diag("NO_REFERENCE_IMAGE", name=name))
    # Freeze the resolved source the first time FX is built for this region.
    # The FX result is written to useroutput_<name>.png, which is ALSO where a
    # user "use my image" picture lives — without this frozen copy a second
    # build (e.g. tweaking the colour) would recolour the already-recoloured
    # output. fx_source returns this snapshot first, so every rebuild derives
    # from the original. Invalidated on new image / revert / switch to AI.
    snap = INPUT_DIR / f"refs/fxsrc_{name}.png"
    if not snap.exists():
        try:
            snap.parent.mkdir(parents=True, exist_ok=True)
            snap.write_bytes(Path(src).read_bytes())
            src = snap
        except OSError:
            pass  # snapshot is an optimisation; build from src regardless
    # Ensure the region exists (creating a name-only stub for .atlas-bound
    # manifests, same as Handler._ensure_region).
    r = None
    for bucket in ("regions", "rotated_regions"):
        for cand in m.get(bucket, []):
            if cand.get("name") == name:
                r = cand
                break
        if r is not None:
            break
    if r is None:
        if any(x["name"] == name for x in all_regions(m)):
            r = {"name": name}
            m.setdefault("regions", []).append(r)
        else:
            return (False, _diag("REGION_NOT_FOUND", name=name))
    if mode is None:
        mode = r.get("mode")
    if mode not in shine.FX_PRESETS:
        return (False, _diag("FX_BUILD_FAILED", mode=mode or "?",
                             err=f"unknown FX mode '{mode}'"))
    defaults, ranges = shine.FX_PRESETS[mode]
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
        return (False, _diag("FX_BUILD_FAILED", mode=mode,
                             err=f"{type(e).__name__}: {e}"))
    (INPUT_DIR / "refs").mkdir(parents=True, exist_ok=True)
    rel = f"refs/useroutput_{name}.png"
    img.save(INPUT_DIR / rel)
    _mirror(INPUT_DIR / rel)  # persist the FX result to R2
    r["output_override"] = rel
    r["mode"] = mode
    fx = r.setdefault("fx", {})
    fx[mode] = params
    if mode == "glow":
        r["shine"] = params  # legacy key — old halo params lived here
    ps = ", ".join(f"{k} {v}" for k, v in params.items())
    return (True, f"{name}: built {mode} from {src.name} ({ps}). "
            f"Create Atlas to apply; switch mode to AI gen to undo.")


def rebuild_fx_layers(m: dict, base_names: set | None = None) -> list[str]:
    """Automatically rebuild configured FX layers from their (current) bases.

    Global toggle: config['auto_fx_rebuild'] — a MISSING key reads as ON.
    Candidates: regions whose name is a canonical FX layer (shine.fx_layer_info
    returns truthy), whose base region exists in the manifest, and whose stored
    mode is a known FX preset. When `base_names` is given (render case) keep
    only candidates whose base is in that set; when None (compose case) keep
    all. Layers are ordered by suffix depth so a layer whose base is ITSELF an
    FX layer rebuilds after its base. Each build is best-effort (one failure
    never aborts the rest). The CALLER saves the manifest. Returns the names
    that rebuilt successfully."""
    if not batch_atlas._truthy(load_config().get("auto_fx_rebuild"), True):
        return []
    regions = all_regions(m)
    existing = {r["name"] for r in regions}
    candidates = []
    for r in regions:
        name = r.get("name", "")
        info = shine.fx_layer_info(name)
        if not info:
            continue
        if info["base"] not in existing:
            continue
        if r.get("mode") not in shine.FX_PRESETS:
            continue
        if base_names is not None and info["base"] not in base_names:
            continue
        candidates.append(name)

    def _depth(nm: str) -> int:
        # Count how many FX suffixes a name carries (FX-on-FX nesting), so a
        # deeper layer builds AFTER the shallower one it derives from.
        depth, cur = 0, nm
        while True:
            inf = shine.fx_layer_info(cur)
            if not inf:
                break
            depth += 1
            cur = inf["base"]
        return depth

    candidates.sort(key=_depth)
    rebuilt: list[str] = []
    for name in candidates:
        try:
            ok, _ = build_fx_region(m, name)
            if ok:
                rebuilt.append(name)
        except Exception as e:  # noqa: BLE001
            print(f"[FX rebuild skipped] {name}: {e}")
    return rebuilt


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


def _run_cmd(cmd: list[str], total: int, post_hook=None,
             pre_note: str | None = None) -> None:
    global _render_proc, _stopped
    _stopped = False
    with _render_lock:
        _render_state.update(running=True,
                             log=(f"{pre_note}\n" if pre_note else ""),
                             done=False, cur=0, total=total, diagnostics=[])
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
            # A structured diagnostic marker line (@@DIAG@@{json}) becomes a
            # card and is hidden from the visible log — its human-readable
            # canonical form was already printed on the preceding line, so the
            # log stays readable.
            d = parse_diag_line(line)
            with _render_lock:
                if d is not None:
                    _render_state["diagnostics"].append(d)
                    continue
                _render_state["log"] += line
                mt = _PROG_RE.search(line)
                if mt:
                    _render_state["cur"] = int(mt.group(1))
                    _render_state["total"] = int(mt.group(2))
        proc.wait()
        with _render_lock:
            tag = "[STOPPED by user]" if _stopped else f"[exit {proc.returncode}]"
            _render_state["log"] += f"\n{tag}\n"
        if post_hook and not _stopped:
            try:
                note = post_hook()
                if note:
                    with _render_lock:
                        _render_state["log"] += f"\n{note}\n"
            except Exception as e:  # noqa: BLE001
                with _render_lock:
                    _render_state["log"] += f"\n[FX auto-rebuild skipped] {e}\n"
    except Exception as e:  # noqa: BLE001
        with _render_lock:
            _render_state["log"] += f"\n[ERROR] {e}\n"
    finally:
        _render_proc = None
        with _render_lock:
            _render_state.update(running=False, done=True)


def run_render(names: list[str], variants: int = 1,
               ctx: tuple[str, str] | None = None) -> None:
    # These run on a NEW worker thread, so the request thread's thread-local
    # (client, project) is NOT inherited — re-apply it here before resolving the
    # manifest path / subprocess env, else everything falls back to the env
    # default context (unassigned/cloud) and the subprocess resolves the wrong
    # tree (geometry "not found in R2").
    if ctx:
        project_paths.set_context(*ctx)
    # The subprocess reads batch/ from local disk (already_generated seed-match
    # skips re-rendering pinned variants). It hydrates lazily, so pull it here
    # before spawning, else the subprocess sees an empty pile.
    project_paths.ensure_lazy("batch/")
    cmd = [PY, str(TOOLS / "batch_atlas.py"),
           "--manifest", str(manifest_path()),
           "--only", ",".join(names), "--include-rotated",
           "--variants", str(max(1, variants))]

    def _post():
        m = load_manifest()
        rebuilt = rebuild_fx_layers(m, base_names=set(names))
        if rebuilt:
            save_manifest(m)
            return ("Auto-rebuilt %d FX layer(s) from regenerated base(s): %s"
                    % (len(rebuilt), ", ".join(rebuilt)))
        return None

    _run_cmd(cmd, len(names) * max(1, variants), post_hook=_post)


def run_compose(ctx: tuple[str, str] | None = None) -> None:
    # See run_render: re-apply the request thread's context on this worker.
    if ctx:
        project_paths.set_context(*ctx)
    # Compose picks each region's variant PNG from batch/ in the subprocess, so
    # the variant pile must be on local disk first (it hydrates lazily).
    project_paths.ensure_lazy("batch/")
    # Refresh ALL FX layers from their current bases before composing, so the
    # atlas reflects the latest art. Best-effort: never block compose.
    pre_note = None
    try:
        m = load_manifest()
        rebuilt = rebuild_fx_layers(m, base_names=None)
        if rebuilt:
            save_manifest(m)
            pre_note = ("Auto-rebuilt %d FX layer(s) before compose: %s"
                        % (len(rebuilt), ", ".join(rebuilt)))
    except Exception as e:  # noqa: BLE001
        pre_note = f"[FX auto-rebuild skipped] {e}"
    # Pass the active manifest explicitly (full staging path) so compose reads
    # the same creative manifest the UI shows — not whatever the subprocess's
    # config default would resolve against the script dir.
    cmd = [PY, str(TOOLS / "batch_atlas.py"),
           "--manifest", str(manifest_path()),
           "--include-rotated", "--include-hidden", "--compose-only"]
    _run_cmd(cmd, 1, pre_note=pre_note)


# The CRT boot splash lives in iw_common.splash (shared with the Sheet
# Maker). Default WORK pool = the atlas phrases, so behavior is unchanged.
SPLASH = splash_html("ATLAS MAKER")


# Unified tool bar — HTML/CSS/JS twin of the launcher's $lib/ToolTopBar.svelte.
# Kept as a SEPARATE non-`.format()` string because its inline SVG / JS objects
# are full of literal braces; injected into PAGE via the {iw_toolbar} slot so we
# don't have to double every brace. The launcher bakes ?home=<origin> (emblem
# target) and ?tools=<url-encoded [{id,name,url}]> (role-gated, current tool
# removed) into the redirect; the ICON map mirrors roles.ts TOOL_ICONS by id.
# See docs/design/unified-tool-bar.md.
IW_TOOLBAR = """<header class="iw-toolbar">
 <a class="iw-brand" id="iw-home" href="https://app.invisiblewall.org" title="Invisible Launcher">
  <svg width="22" height="18" viewBox="0 0 366 304" aria-hidden="true">
   <g fill="currentColor">
    <polygon points="20,50 40,73 336,9 336,5"/>
    <polygon points="13,55 28,80 21,278 17,278"/>
   </g>
  </svg>
  <span>INVISIBLE ATLAS MAKER</span>
 </a>
 <nav class="iw-switcher" id="iw-switcher" aria-label="Switch tool"></nav>
</header>
<script>
(function () {
  var qp = new URLSearchParams(location.search);
  var home = qp.get('home');
  var homeEl = document.getElementById('iw-home');
  if (home && homeEl) homeEl.href = home;
  var ICON = {
    editor: '<rect x="4" y="4" width="11" height="11" rx="1"/><rect x="9" y="9" width="11" height="11" rx="1"/>',
    sheetMaker: '<rect x="3" y="3" width="9" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="10" width="7" height="4" rx="1"/><rect x="3" y="14" width="13" height="7" rx="1"/>',
    atlasTool: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    componentEditor: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="6" height="6" rx="1"/><rect x="13" y="11" width="4" height="6" rx="1"/>',
    storybook: '<path d="M12 6c-1.5-1.6-3.8-2.5-6.5-2.5H4v14h1.5c2.7 0 5 .9 6.5 2.5 1.5-1.6 3.8-2.5 6.5-2.5H20v-14h-1.5c-2.7 0-5 .9-6.5 2.5z"/><line x1="12" y1="6" x2="12" y2="20"/>',
    spineViewer: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><line x1="7.6" y1="16.4" x2="16.4" y2="7.6"/><circle cx="12" cy="12" r="1.3"/>',
    fontMaker: '<path d="M5 17 9.5 6h1L15 17"/><line x1="6.7" y1="13" x2="13.3" y2="13"/><line x1="4" y1="20" x2="20" y2="20"/>',
    localization: '<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3c2.6 2.6 2.6 15.4 0 18"/><path d="M12 3c-2.6 2.6-2.6 15.4 0 18"/>',
    ftpBrowser: '<circle cx="5" cy="6" r="1"/><line x1="9" y1="6" x2="20" y2="6"/><circle cx="5" cy="12" r="1"/><line x1="9" y1="12" x2="20" y2="12"/><circle cx="5" cy="18" r="1"/><line x1="9" y1="18" x2="20" y2="18"/>'
  };
  function svg(id) {
    var b = ICON[id];
    if (!b) return '';
    return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + b + '</svg>';
  }
  var tools = [];
  try { tools = JSON.parse(qp.get('tools') || '[]'); } catch (e) {}
  var nav = document.getElementById('iw-switcher');
  if (nav && Array.isArray(tools)) {
    tools.forEach(function (t) {
      if (!t || !t.url) return;
      var a = document.createElement('a');
      a.className = 'iw-tool';
      a.href = t.url;
      a.title = t.name || '';
      var ic = document.createElement('span');
      ic.className = 'ic';
      ic.innerHTML = svg(t.id);
      var lb = document.createElement('span');
      lb.className = 'label';
      lb.textContent = (t.name || '').replace(/^Invisible /, '');
      a.appendChild(ic);
      a.appendChild(lb);
      nav.appendChild(a);
    });
  }
})();
</script>
"""

PAGE = """<!doctype html><html><head><meta charset="utf-8">
<title>Invisible Atlas Maker</title>
<style>
 body{{font-family:system-ui,Arial;background:#1d1d22;color:#e8e8ea;margin:0;padding:0 20px 40px}}
 /* unified tool bar — visual twin of the launcher $lib/ToolTopBar.svelte */
 .iw-toolbar{{display:flex;align-items:center;gap:16px;padding:8px 0;border-bottom:1px solid #333}}
 .iw-brand{{display:flex;align-items:center;gap:9px;flex:none;font-weight:700;
   letter-spacing:.14em;text-transform:uppercase;color:#7ee0c0;font-size:14px;
   text-decoration:none;white-space:nowrap}}
 .iw-switcher{{display:flex;align-items:center;gap:4px;min-width:0;flex:1 1 auto;overflow:hidden}}
 .iw-tool{{display:inline-flex;align-items:center;gap:6px;flex:none;padding:5px 9px;
   border-radius:8px;border:1px solid transparent;color:#b9b9c4;text-decoration:none;
   font-size:12px;font-weight:600;white-space:nowrap}}
 .iw-tool:hover{{background:#23232a;border-color:#2f2f37;color:#fff}}
 .iw-tool .ic{{display:inline-flex;width:16px;height:16px}}
 .iw-tool .ic svg{{width:16px;height:16px;display:block}}
 @media (max-width:1100px){{.iw-tool .label{{display:none}} .iw-tool{{padding:6px}}}}
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
 #diags{{margin-top:14px;display:flex;flex-direction:column;gap:8px}}
 #diags:empty{{display:none}}
 .diag{{display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border-radius:7px;border:1px solid #333;background:#1b1b1f;font-size:13px;line-height:1.4}}
 .diag-ic{{flex:0 0 auto;font-size:15px;line-height:1.3}}
 .diag-body{{flex:1 1 auto;min-width:0}}
 .diag-title{{font-weight:700;color:#eee;margin-bottom:3px}}
 .diag-explain{{color:#c7c7cf;white-space:pre-wrap}}
 .diag-fix{{color:#9fb6d6;margin-top:5px}}
 .diag-error{{border-color:#7a2b2b;background:#241616}}
 .diag-error .diag-ic{{color:#ff6b6b}}
 .diag-warn{{border-color:#7a5a1f;background:#241f12}}
 .diag-warn .diag-ic{{color:#ffc14d}}
 .diag-info{{border-color:#2b557a;background:#141d24}}
 .diag-info .diag-ic{{color:#5db0ff}}
</style></head><body>
{iw_toolbar}
{notice}
<div class="bar">
 <div class="bargrp" title="Atlas-level actions: edit, save, compose, view, deploy">
  <span class="glbl">Atlas</span>
  <button onclick="saveAll()" class="alt">💾 Save changes</button>
  <button onclick="selAll(true)" class="alt">Select all</button>
  <button onclick="selAll(false)" class="alt">Select none</button>
  <button onclick="createAtlas()" id="abtn" style="background:#629432">🧩 Create Atlas</button>
  <button onclick="useRefAll()" class="alt" title="Seed every EMPTY region's atlas tile from its own reference image (verbatim — no AI). Never overwrites a region that already has a generated image. ✕ revert restores generation per region.">⤵ Refs → generated</button>
  <button onclick="sliceAtlas()" class="alt" title="Cut the Atlas source image into per-region crops and set them as each region's IPAdapter style ref">✂ Slice source → refs</button>
  <button onclick="uploadAtlas()" class="alt" title="Upload a .atlas geometry file (and its source page image) into R2 and repoint this manifest, so Slice/Compose resolve in the cloud">⬆ Upload .atlas</button>
  <input type="file" id="uplAtlasFile" accept=".atlas" style="display:none" onchange="onAtlasFilePicked()">
  <input type="file" id="uplAtlasImg" accept="image/*" style="display:none" onchange="onAtlasImgPicked()">
  <button onclick="viewAtlas()" class="alt">🖼 View atlas</button>
  <button onclick="deployAtlas()" class="alt" title="Copy the built atlas (.png/.webp) to this manifest's Deploy folder, overwriting <stem>.png/.webp there. Set the folder in Atlas settings.">📦 Deploy atlas</button>
  <label id="pageOnlyLbl" style="margin:0 2px 0 6px;font-size:13px;color:#bbb;display:inline-flex;align-items:center;gap:4px" title="Write only the page image (.webp/.png); skip the .json/.atlas so a Spine skeleton isn't overwritten. Auto-on for Spine targets.">
   <input type="checkbox" id="pageOnly"{page_only_attrs} style="margin:0">Page-only (Spine page)</label>
  {page_only_note}
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
 <button onclick="refreshR2(this)" class="alt" title="Re-pull this project's manifests from R2 (e.g. after exporting a sheet from the Sheet Maker) without restarting or switching projects">↻ Refresh from R2</button>
 <button onclick="clearCache(this)" class="alt" title="Discard the local copy of this project and re-download it from R2, matching the cloud exactly. Files deleted from the cloud are dropped here too; unsaved local work is lost. R2 is the source of truth.">↺ Reset from R2</button>
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
{blueprints_panel}
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
<div id="bpmodal" class="modal" onclick="if(event.target===this)closeBp()">
 <div class="modalbox" style="width:min(620px,94vw)">
  <div class="modalhdr"><span id="bptitle">New blueprint</span><button onclick="closeBp()">✕ close</button></div>
  <div style="padding:14px 18px 18px;display:flex;flex-direction:column;gap:11px;font-size:13px">
   <div style="color:#888;font-size:12px">Pick a ComfyUI <b>API-format</b> workflow.json (Settings → "Save (API Format)"), then map each role onto a node in your graph. positive / seed / output are required.</div>
   <label style="display:flex;flex-direction:column;gap:3px;color:#aaa">Workflow file (API format)
    <input type="file" id="bpFile" accept=".json,application/json" onchange="onBpFilePicked()" style="background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:7px">
   </label>
   <div id="bpmeta" style="display:none;flex-direction:column;gap:11px">
    <label style="display:flex;flex-direction:column;gap:3px;color:#aaa">Name
     <input id="bpName" placeholder="My Pipeline" style="background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:7px">
    </label>
    <label style="display:flex;flex-direction:column;gap:3px;color:#aaa">Description
     <textarea id="bpDesc" rows="2" style="background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:7px;resize:vertical"></textarea>
    </label>
    <label style="display:flex;flex-direction:column;gap:3px;color:#aaa">Base (ref/output conventions)
     <select id="bpBase" style="background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:7px">
      <option value="sdxl">sdxl</option><option value="flux">flux</option><option value="gpt_image">gpt_image</option>
     </select>
    </label>
    <div style="color:#aaa;font-weight:600;margin-top:2px">Bindings (role → node)</div>
    <div id="bpBindings" style="display:flex;flex-direction:column;gap:8px"></div>
   </div>
   <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
    <button id="bpSave" onclick="saveBlueprint()" style="display:none">Publish blueprint</button>
    <span id="bpstat" style="color:#999"></span>
   </div>
  </div>
 </div>
</div>
<div id="diags"></div>
<pre id="log"></pre>
<script>
// --- Diagnostics (what / why / how-to-fix cards) -------------------------
var DIAG_GLYPHS={{'✖':'error','⚠':'warn','ℹ':'info'}};
function _diagCard(sev,title,explain,fix){{
 var card=document.createElement('div');
 card.className='diag diag-'+sev;
 var ic=document.createElement('span'); ic.className='diag-ic';
 ic.textContent=(sev==='error'?'✖':(sev==='warn'?'⚠':'ℹ'));
 var body=document.createElement('div'); body.className='diag-body';
 var h=document.createElement('div'); h.className='diag-title';
 h.textContent=title||''; body.appendChild(h);
 if(explain){{var p=document.createElement('div'); p.className='diag-explain';
  p.textContent=explain; body.appendChild(p);}}
 if(fix){{var f=document.createElement('div'); f.className='diag-fix';
  f.textContent='How to fix: '+fix; body.appendChild(f);}}
 card.appendChild(ic); card.appendChild(body);
 return card;
}}
function renderDiagnostics(list){{
 var box=document.getElementById('diags'); if(!box)return;
 box.innerHTML='';
 (list||[]).forEach(function(d){{
  if(!d)return;
  box.appendChild(_diagCard(d.severity||'error',d.title||d.code||'',
   d.explain||'',d.fix||''));
 }});
}}
// A sync handler may return a canonical string ("<glyph> Title\\nexplain\\n
// → Fix: ...") in the toast. If it starts with a severity glyph, promote it
// to a colored card in #diags and return true (caller should NOT reload, so
// the card stays visible).
function flashDiag(msg){{
 var box=document.getElementById('diags'); if(!box||!msg)return false;
 var sev=DIAG_GLYPHS[msg.charAt(0)];
 if(!sev)return false;
 var lines=msg.split('\\n');
 var title=lines[0].slice(1).trim();
 var fix=''; var explainLines=[];
 for(var i=1;i<lines.length;i++){{
  var ln=lines[i];
  var fm=ln.replace(/^\\s*→?\\s*Fix:\\s*/,'');
  if(fm!==ln){{ fix=fm.trim(); }} else {{ explainLines.push(ln); }}
 }}
 box.innerHTML='';
 box.appendChild(_diagCard(sev,title,explainLines.join('\\n').trim(),fix));
 return true;
}}
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
// A BLUEPRINT pipeline (an id that isn't one of the three built-in keywords)
// pins its own models in its graph, so the built-in model <select>s (the
// sdxl/flux/gpt_image groups) are hidden; the universal "all" + generic "both"
// generation fields (size, padding, etc.) stay editable since a blueprint runs
// through the same ComfyUI path.
const BUILTIN_PIPES=['sdxl','flux','gpt_image'];
// id -> list of bound role names, for every shared blueprint (built-ins
// excluded — they use the Python path). Drives which ref fields a blueprint
// pipeline shows (a blueprint that doesn't bind shape_ref hides its UI).
const BP_BOUND_ROLES={bp_bound_roles_js};
function isBlueprintPipe(p){{ return !!p && BUILTIN_PIPES.indexOf(p)<0; }}
function bpBinds(p,role){{
 let r=BP_BOUND_ROLES[p]; return !!r && r.indexOf(role)>=0;
}}
function pipeVisible(g,p){{
 if(!g||g==='all')return true;
 if(isBlueprintPipe(p)) return g==='both';
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
// --- Blueprints: upload an API-format ComfyUI graph + bind roles ----------
let _bpGraph=null;   // parsed API/prompt node dict from the picked file
// Role -> required (must be bound) + candidate filter over (id, node).
const BP_ROLES=[
 ['positive',true],['negative',false],['seed',true],
 ['width',false],['height',false],
 ['style_ref',false],['shape_ref',false],['output',true]];
function bpCandidates(role,graph){{
 // Candidate-filter nodes by class_type / inputs so each role only offers
 // nodes that can plausibly fill it (matches the design's binding step).
 let out=[];
 for(const id of Object.keys(graph)){{
  const n=graph[id]||{{}}; const ct=String(n.class_type||'');
  const inp=n.inputs||{{}};
  let ok=false;
  if(role==='positive'||role==='negative') ok=/CLIPTextEncode/i.test(ct);
  else if(role==='seed') ok=('seed' in inp)||('noise_seed' in inp);
  else if(role==='width') ok=('width' in inp);
  else if(role==='height') ok=('height' in inp);
  else if(role==='style_ref'||role==='shape_ref') ok=/LoadImage/i.test(ct);
  else if(role==='output') ok=/SaveImage/i.test(ct);
  if(ok) out.push([id,ct]);
 }}
 return out;
}}
// Default node-input field per role (the binding's `field`). output has none.
const BP_FIELD={{positive:'text',negative:'text',seed:'seed',width:'width',
 height:'height',style_ref:'image',shape_ref:'image'}};
function openNewBlueprint(){{
 _bpGraph=null;
 document.getElementById('bpFile').value='';
 document.getElementById('bpmeta').style.display='none';
 document.getElementById('bpSave').style.display='none';
 document.getElementById('bpName').value='';
 document.getElementById('bpDesc').value='';
 document.getElementById('bpstat').textContent='';
 document.getElementById('bpmodal').classList.add('open');
}}
function closeBp(){{document.getElementById('bpmodal').classList.remove('open');}}
function onBpFilePicked(){{
 let f=document.getElementById('bpFile').files[0]; if(!f)return;
 let rd=new FileReader();
 rd.onload=()=>{{
  let g;
  try{{ g=JSON.parse(rd.result); }}
  catch(e){{ document.getElementById('bpstat').textContent='✖ Not valid JSON: '+e; return; }}
  if(!g||typeof g!=='object'||Array.isArray(g)){{
   document.getElementById('bpstat').textContent='✖ Not an API-format node dict.'; return; }}
  // Heuristic API-format check: every value is a node with a class_type.
  let bad=Object.keys(g).find(k=>!g[k]||typeof g[k]!=='object'||!('class_type' in g[k]));
  if(bad!==undefined){{
   document.getElementById('bpstat').textContent='✖ Node "'+bad+'" has no class_type — export in API format, not the editor format.';
   return; }}
  _bpGraph=g;
  if(!document.getElementById('bpName').value){{
   document.getElementById('bpName').value=f.name.replace(/\\.json$/i,''); }}
  buildBpBindings();
  document.getElementById('bpmeta').style.display='flex';
  document.getElementById('bpSave').style.display='';
  document.getElementById('bpstat').textContent='';
 }};
 rd.readAsText(f);
}}
function buildBpBindings(){{
 let wrap=document.getElementById('bpBindings'); wrap.innerHTML='';
 BP_ROLES.forEach(([role,req])=>{{
  let cands=bpCandidates(role,_bpGraph);
  let row=document.createElement('label');
  row.style.cssText='display:flex;align-items:center;gap:8px;color:#aaa';
  let lbl=document.createElement('span');
  lbl.style.cssText='min-width:90px'; lbl.textContent=role+(req?' *':'');
  let sel=document.createElement('select');
  sel.dataset.bprole=role;
  sel.style.cssText='flex:1;background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:6px';
  if(!req){{ let o=document.createElement('option'); o.value=''; o.textContent='(not used)'; sel.appendChild(o); }}
  cands.forEach(([id,ct])=>{{ let o=document.createElement('option'); o.value=id; o.textContent='node '+id+' — '+ct; sel.appendChild(o); }});
  if(req&&!cands.length){{ let o=document.createElement('option'); o.value=''; o.textContent='⚠ no matching node'; sel.appendChild(o); }}
  row.appendChild(lbl); row.appendChild(sel); wrap.appendChild(row);
 }});
}}
async function saveBlueprint(overwrite){{
 if(!_bpGraph) return;
 let st=document.getElementById('bpstat'); st.textContent='⬆ Publishing…';
 let bindings={{}};
 document.querySelectorAll('#bpBindings [data-bprole]').forEach(sel=>{{
  let role=sel.dataset.bprole, node=sel.value;
  if(!node) return;
  let b={{node:node}};
  if(role!=='output') b.field=BP_FIELD[role]||'';
  bindings[role]=b;
 }});
 let body={{name:document.getElementById('bpName').value,
  description:document.getElementById('bpDesc').value,
  base:document.getElementById('bpBase').value,
  workflow_text:JSON.stringify(_bpGraph),
  bindings:bindings, overwrite:!!overwrite}};
 let msg;
 try{{ let r=await fetch('/uploadblueprint',{{method:'POST',body:JSON.stringify(body)}});
  msg=(r.status===404)?'Upload endpoint missing — restart the service':await r.text();
 }}catch(e){{ msg='Publish failed: '+e; }}
 // A pre-existing id prompts to overwrite (mirror the .atlas confirm style).
 if(msg.indexOf('⚠')===0 && msg.indexOf('already exists')>=0 && !overwrite){{
  st.textContent=msg;
  if(confirm(msg.replace('⚠ ','')+'\\n\\nOverwrite it?')) return saveBlueprint(true);
  return;
 }}
 st.textContent=msg;
 if(msg.indexOf('✓')===0) setTimeout(()=>location.reload(),1600);
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
 t.textContent=msg; if(st)st.textContent=msg; flashDiag(msg);
 if(msg.indexOf('✓')===0) setTimeout(()=>location.reload(),2500);
}}
async function refreshR2(btn){{
 // Re-pull manifests/config for the active project from R2, then reload so the
 // manifest dropdown picks up anything exported since this page loaded.
 let t=document.getElementById('toast');
 if(t){{ t.style.display='inline-block'; t.textContent='↻ Refreshing…'; }}
 let st=document.getElementById('stat'); if(st)st.textContent='↻ Refreshing…';
 if(btn) btn.disabled=true;
 let msg;
 try{{ let r=await fetch('/refresh',{{method:'POST',body:'{{}}'}});
  msg=(r.status===404)?'Refresh endpoint missing — restart the service':await r.text();
 }}catch(e){{ msg='Refresh request failed: '+e; }}
 if(t)t.textContent=msg; if(st)st.textContent=msg;
 if(btn) btn.disabled=false;
 if(msg.indexOf('✓')===0) setTimeout(()=>location.reload(),900);
}}
async function clearCache(btn){{
 if(!confirm('Reset this project from the cloud?\\n\\nRe-downloads everything '
  +'from R2 and DROPS any local files that were deleted from the cloud. '
  +'Unsaved local work is lost. R2 is the source of truth.')) return;
 let t=document.getElementById('toast');
 if(t){{ t.style.display='inline-block'; t.textContent='↺ Resetting…'; }}
 let st=document.getElementById('stat'); if(st)st.textContent='↺ Resetting…';
 if(btn) btn.disabled=true;
 let msg;
 try{{ let r=await fetch('/clearcache',{{method:'POST',body:'{{}}'}});
  msg=(r.status===404)?'Clear-cache endpoint missing — restart the service':await r.text();
 }}catch(e){{ msg='Clear-cache request failed: '+e; }}
 if(t)t.textContent=msg; if(st)st.textContent=msg;
 if(btn) btn.disabled=false;
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
  let msg=await r.text(); document.getElementById('stat').textContent=msg;
  if(!flashDiag(msg)) setTimeout(()=>location.reload(),700);
 }};
 rd.readAsDataURL(f);
}}
async function useRefImg(name){{
 let r=await fetch('/userefimg',{{method:'POST',body:JSON.stringify({{name:name}})}});
 let msg=await r.text(); document.getElementById('stat').textContent=msg;
 if(!flashDiag(msg)) setTimeout(()=>location.reload(),700);
}}
async function revertImage(name){{
 let r=await fetch('/clearoutput',{{method:'POST',body:JSON.stringify({{name:name}})}});
 let msg=await r.text(); document.getElementById('stat').textContent=msg;
 if(!flashDiag(msg)) setTimeout(()=>location.reload(),700);
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
 let msg=await r.text(); document.getElementById('stat').textContent=msg;
 if(!flashDiag(msg)) setTimeout(()=>location.reload(),500);
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
 let msg=await r.text(); document.getElementById('stat').textContent=msg;
 if(!flashDiag(msg)) setTimeout(()=>location.reload(),600);
}}
async function useRefAll(){{
 if(!confirm("Seed every EMPTY region's atlas tile from its reference image? "
  +"Regions that already have a generated image are left untouched. "
  +"(✕ revert restores generation per region.)"))return;
 let r=await fetch('/userefall',{{method:'POST',body:JSON.stringify({{}})}});
 let msg=await r.text(); document.getElementById('stat').textContent=msg;
 if(!flashDiag(msg)) setTimeout(()=>location.reload(),600);
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
 let msg=await r.text(); document.getElementById('stat').textContent=msg;
 if(!flashDiag(msg)) setTimeout(()=>location.reload(),800);
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
 let msg=await r.text(); document.getElementById('stat').textContent=msg;
 if(!flashDiag(msg)) setTimeout(()=>location.reload(),800);
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
 let bp=isBlueprintPipe(eff);
 document.querySelectorAll('#advform label[data-pipe]').forEach(l=>{{
  let vis=pipeVisible(l.dataset.pipe,eff);
  // For a blueprint pipeline, a ref field shows only if the blueprint binds
  // that role (its graph has a LoadImage node for it) — otherwise the ref
  // has nowhere to go, so hide the input.
  if(vis&&bp){{
   let adv=l.querySelector('[data-adv]'), role=adv&&adv.dataset.adv;
   if((role==='style_ref'||role==='shape_ref')&&!bpBinds(eff,role)) vis=false;
  }}
  l.style.display=vis?'':'none';
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
 let pb=document.getElementById('pageOnly');
 let url='/deployatlas'+((pb&&pb.checked)?'?page_only=1':'');
 try{{ let r=await fetch(url,{{method:'POST',body:'{{}}'}});
  msg=(r.status===404)?'Deploy endpoint missing — restart run_ui.bat':await r.text();
 }}catch(e){{ msg='Deploy failed: '+e; }}
 t.textContent=msg; if(st)st.textContent=msg; flashDiag(msg);
}}
async function stopRender(){{
 let sb=document.getElementById('sbtn'); sb.disabled=true; sb.textContent='■ Stopping…';
 await fetch('/stop',{{method:'POST',body:'{{}}'}});
}}
async function poll(){{
 let r=await fetch('/progress'); let j=await r.json();
 renderDiagnostics(j.diagnostics||[]);
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
 _fsCurDir=j.rel||'';        // clean repo-relative path (NOT the display label)
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
// Editor deep-link: scroll to + briefly flash the targeted region's card.
// {flash_region} is the region key's stem (server-resolved) or empty.
(function(){{
 var rn={flash_region};
 if(!rn) return;
 window.addEventListener('DOMContentLoaded',function(){{
  var c=document.querySelector('.card[data-name="'+rn+'"]');
  if(!c) return;
  try{{ c.scrollIntoView({{behavior:'smooth',block:'center'}}); }}catch(e){{}}
  c.style.transition='box-shadow .25s, outline-color .25s';
  c.style.outline='3px solid #ffd166';
  c.style.boxShadow='0 0 0 4px rgba(255,209,102,.35)';
  setTimeout(function(){{
   c.style.outline='3px solid transparent';
   c.style.boxShadow='none';
  }},2200);
 }});
}})();
</script></body></html>"""

CARD = """<div class="card{card_cls}" data-name="{name}" data-effpipe="{eff_pipe}" data-usedseed="{used_seed}" data-lockedseed="{locked_seed}" data-variant="{variant}">
 <h3><input type="checkbox" class="sel" {checked}> {name}{gpt_badge}
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

        The chosen context is set on THIS request thread (thread-local), so a
        concurrent request for a different project is fully isolated. The path
        proxies (BATCH_DIR / INPUT_DIR / ...) and project_paths.resolve() both
        read this thread's context, so no module-global copy and no global lock
        are needed."""
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

        # Thread-local: switch_context sets THIS request thread's context and
        # (on a real switch) hydrates its staging. The path proxies pick the
        # new context up automatically on their next access — no module-global
        # copy to refresh, no lock.
        project_paths.switch_context(chosen_client, chosen_project)

    # Back-compat alias — kept so any legacy in-process call still works.
    def _resolve_project(self) -> None:
        self._resolve_context()

    def _resolve_publish(self) -> None:
        """Decide whether THIS request may publish a blueprint and set
        `self.can_publish` (read by `_uploadblueprint` and exposed to the page
        so the "＋ New blueprint" affordance only shows when allowed).

        Mirrors the `?k=` secret handling in `_gate`: the launcher hands off
        `bp=<ATLAS_BLUEPRINT_SECRET>` ONLY for users holding `blueprintPublish`,
        and we require the param/cookie to EQUAL that secret. We stick it in a
        session cookie `atlas_bp=<secret>` (same attributes as the gate's
        `atlas_tool` cookie) so the capability survives the in-tool navigations
        that drop the param. A non-secret flag would be forgeable — every atlas
        user already holds the read secret, so `bp=1` would gate nothing.

        Must run AFTER `_resolve_context()` (which initializes `_extra_cookies`)
        so the extra Set-Cookie rides along on the response."""
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        param_bp = q.get("bp", [""])[0]
        cookie_bp = ""
        for part in (self.headers.get("Cookie", "") or "").split(";"):
            part = part.strip()
            if part.startswith("atlas_bp="):
                cookie_bp = part[len("atlas_bp="):]
                break
        if ATLAS_BLUEPRINT_SECRET:
            # Production model: knowledge of the publish secret == permission.
            if param_bp == ATLAS_BLUEPRINT_SECRET and cookie_bp != ATLAS_BLUEPRINT_SECRET:
                self._extra_cookies.append(
                    f"atlas_bp={ATLAS_BLUEPRINT_SECRET}; Path=/; HttpOnly; "
                    "SameSite=None; Secure")
            self.can_publish = (
                param_bp == ATLAS_BLUEPRINT_SECRET
                or cookie_bp == ATLAS_BLUEPRINT_SECRET)
        else:
            # No publish secret configured → dev/local fallback: allow only when
            # the tool runs fully open (no read secret) or the explicit env
            # override is set. Fail safe (closed) when a read secret is set but
            # no publish secret is — never forgeable-open in a deployed tool.
            self.can_publish = bool(not ATLAS_TOOL_SECRET or ATLAS_BLUEPRINT_PUBLISH)

    def _handle_deeplink(self, qs: dict) -> bool:
        """Editor "Open in Atlas Maker" deep-link (shared URL contract).

        The editor/launcher sends the user to `/?atlas=<sheetFile>&region=<key>`
        (plus k/client/project/home). When `atlas` is present we resolve it to
        the generation manifest that OWNS it and make that the active manifest,
        optionally flashing the region's card. When NO Atlas Maker recipe owns
        the atlas, we auto-import the existing TexturePacker/editor sheet into a
        fresh generation manifest and open THAT — so "Open in Atlas Maker"
        always lands in the Atlas Maker (it silently creates the recipe the
        first time). The old Sheet Maker fallback redirect is gone.

        Returns True if a redirect response was already sent (caller must stop);
        False to continue rendering the index. Fully defensive: any error just
        returns False so the index renders normally."""
        # Defaults so _index() can read these unconditionally.
        self._deeplink_region = ""
        self._deeplink_notice = ""
        try:
            atlas = (qs.get("atlas", [""])[0] or "").strip()
            if not atlas:
                return False
            region = (qs.get("region", [""])[0] or "").strip()
            resolved = resolve_atlas_to_manifest(atlas)
            if resolved:
                # Activate it exactly like the session dropdown does.
                try:
                    cfg = load_config()
                    _was = cfg.get("manifest_path", "")
                    cfg["manifest_path"] = resolved
                    save_config(cfg)
                    # Re-activating an EXISTING sheet-derived recipe: fill its
                    # empty atlas tiles from refs (same rule as the dropdown).
                    # Only on a real switch + only for sheet manifests + only
                    # when something gets seeded (avoid pointless R2 writes).
                    # Exact-key refresh FIRST (same rule as _saveconfig): the
                    # seed's save_manifest must write back the FRESH manifest,
                    # never push a stale staged copy over a Sheet Maker export.
                    if resolved != _was:
                        _refresh_manifest_from_r2(resolved)
                        nm = load_manifest()
                        if bool(nm.get("export_prefix")):
                            res = self._seed_refs_into_outputs(nm, only_empty=True)
                            if res["seeded"]:
                                save_manifest(nm)
                except OSError:
                    pass
                except Exception:  # noqa: BLE001 — never 500 a deep-link
                    pass
                if region:
                    self._deeplink_region = Path(region).stem
                return False
            # No Atlas Maker recipe → auto-import the existing sheet into a new
            # generation manifest and open it (always lands in the Atlas Maker).
            imported = import_sheet_to_manifest(atlas)
            if imported:
                if region:
                    self._deeplink_region = Path(region).stem
                return False  # render index → the newly-active manifest loads
            # Import failed → visible notice, NO redirect.
            self._deeplink_notice = _diag("ATLAS_IMPORT_FAILED", atlas=atlas)
            return False
        except Exception:  # noqa: BLE001 — a bad deep-link must never 500
            self._deeplink_region = ""
            self._deeplink_notice = ""
            return False

    def do_GET(self):
        ok, self._set_cookie = self._gate()
        if not ok:
            self._send(403, "text/plain", b"forbidden")
            return
        self._resolve_context()
        self._resolve_publish()
        path = urllib.parse.urlparse(self.path).path
        if path == "/":
            # Splash is for the *first* visit (launcher → browser). Subsequent
            # reloads (after editing a region, picking a picture, etc.) skip
            # straight to the UI via `?fast=1` — the splash JS sets that on
            # first swap via history.replaceState, so browser-reload preserves
            # it. New tab/window with bare `/` still gets the splash.
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            # Editor "Open in Atlas Maker" deep-link: resolve atlas→manifest
            # (auto-importing the existing sheet into a fresh manifest when no
            # recipe owns it yet) BEFORE serving the splash, so the right
            # manifest is active when the UI renders.
            if self._handle_deeplink(qs):
                return  # a redirect response was already sent (rare)
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
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if self._handle_deeplink(qs):
                return
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
        self._resolve_publish()
        length = int(self.headers.get("Content-Length", 0))
        # Blueprint upload writes attacker-sized JSON to the SHARED library +
        # staging, so cap it (a real workflow graph is well under this).
        if self.path == "/uploadblueprint" and length > 4_000_000:
            self._send(200, "text/plain",
                       b"Blueprint upload too large (max ~4 MB).")
            return
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
                ctx = (project_paths.client_name(), project_paths.project_name())
                threading.Thread(target=run_render, args=(names, variants, ctx),
                                 daemon=True).start()
            self._send(200, "text/plain", b"started")
        elif self.path == "/createatlas":
            if not _render_state["running"]:
                ctx = (project_paths.client_name(), project_paths.project_name())
                threading.Thread(target=run_compose, args=(ctx,),
                                 daemon=True).start()
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
        elif self.path == "/uploadblueprint":
            try:
                payload = json.loads(raw)
            except ValueError:
                self._send(200, "text/plain",
                           b"Invalid request body (not JSON).")
                return
            self._send(200, "text/plain",
                       self._uploadblueprint(payload).encode())
        elif self.path == "/refresh":
            self._send(200, "text/plain", self._refresh().encode())
        elif self.path == "/clearcache":
            self._send(200, "text/plain", self._clearcache().encode())
        elif self.path == "/sliceatlas":
            self._send(200, "text/plain", self._sliceatlas().encode())
        elif urllib.parse.urlparse(self.path).path == "/deployatlas":
            # `page_only=1` query param = explicit user override (the "Page-only
            # (Spine page)" checkbox) forcing the spine-page deploy. OR-ed with
            # the manifest-flag / asset-map / skeleton auto-detection inside
            # _deployatlas — auto-detect still wins when unchecked.
            _q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            _po = str((_q.get("page_only") or ["0"])[0]).strip().lower()
            force_page_only = _po in ("1", "true", "yes", "on")
            self._send(200, "text/plain",
                       self._deployatlas(force_page_only=force_page_only).encode())
        elif self.path == "/setref":
            self._send(200, "text/plain", self._setref(json.loads(raw)).encode())
        elif self.path == "/clearref":
            self._send(200, "text/plain", self._clearref(json.loads(raw)).encode())
        elif self.path == "/setoutput":
            self._send(200, "text/plain", self._setoutput(json.loads(raw)).encode())
        elif self.path == "/userefimg":
            self._send(200, "text/plain", self._userefimg(json.loads(raw)).encode())
        elif self.path == "/userefall":
            self._send(200, "text/plain", self._userefall(json.loads(raw)).encode())
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
                p = _resolve_region_ref(ref)
                if p is not None:
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

    def _uploadblueprint(self, payload: dict) -> str:
        """Save a user-supplied ComfyUI graph + bindings as a new shared
        blueprint, writing `_shared/blueprints/<id>/{workflow.json,
        blueprint.json}` to BOTH staging and R2 directly (blueprints live
        OUTSIDE the project tree, so the per-route project push does NOT cover
        them — we push to `_shared/blueprints/` like seed_blueprints.py).

        payload: {name, description, base, workflow_text, bindings, overwrite?}.
        `bindings` is role -> {node, field?} (output has no field). The write is
        gated on `self.can_publish` (set by `_resolve_publish`). On success the
        library is re-hydrated so the new blueprint is immediately selectable in
        the pipeline picker, and the new id is returned. Never raises a 500 —
        every failure path returns a readable string."""
        if not getattr(self, "can_publish", False):
            return ("✖ You're not allowed to publish blueprints. Ask an admin "
                    "for the 'Publish blueprints' permission.")

        name = str(payload.get("name", "")).strip()
        if not name:
            return "Give the blueprint a name."
        base = str(payload.get("base", "sdxl")).strip().lower() or "sdxl"
        if base not in ("sdxl", "flux", "gpt_image"):
            return ("✖ base must be one of sdxl / flux / gpt_image "
                    f"(got '{base}').")
        description = str(payload.get("description", "")).strip()
        workflow_text = payload.get("workflow_text", "")
        if not str(workflow_text).strip():
            return "The workflow.json was empty — pick an API-format export."
        bindings = payload.get("bindings")
        if not isinstance(bindings, dict):
            return "✖ Missing the role→node bindings."
        # Drop empty/blank bindings so an unbound optional role isn't persisted
        # as a half-filled {node:'', ...} (the loader treats absent = skip).
        clean_bindings: dict = {}
        for role, b in bindings.items():
            if role not in blueprints.KNOWN_ROLES or not isinstance(b, dict):
                continue
            node = str(b.get("node", "")).strip()
            if not node:
                continue
            entry = {"node": node}
            if role != "output":
                field = str(b.get("field", "")).strip()
                if not field:
                    return (f"✖ Role '{role}' needs a node input field "
                            "(none selected).")
                entry["field"] = field
            clean_bindings[role] = entry

        # Validate the graph is parseable, API-format, and the bindings resolve.
        try:
            graph = json.loads(workflow_text)
        except ValueError as e:
            return f"✖ workflow.json isn't valid JSON: {e}"

        bp_id = project_paths.r2_slug(name)
        if not bp_id:
            return "✖ Couldn't derive a blueprint id from that name."
        # Built-in reference ids are the proven Python path — never let an upload
        # clobber them (selecting that id keeps the built-in builder anyway).
        if bp_id in PIPELINE_OPTIONS:
            return (f"✖ '{bp_id}' is a built-in pipeline id and can't be "
                    "overwritten. Pick a different name.")
        overwrite = bool(payload.get("overwrite", False))
        if blueprints.get_blueprint(bp_id) is not None and not overwrite:
            return (f"⚠ A blueprint '{bp_id}' already exists. Re-submit with "
                    "overwrite to replace it.")

        manifest = {
            "version": 1,
            "id": bp_id,
            "name": name,
            "description": description,
            "author": self._publish_author(),
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "base": base,
            "bindings": clean_bindings,
            "models": [],
        }
        try:
            blueprints.validate_against_graph(bp_id, manifest, graph)
        except ValueError as e:
            return f"✖ {e}"

        # Persist: staging mirror + R2 (the canonical store). Write the manifest
        # we just validated (re-serialized) and the original graph text.
        man_bytes = json.dumps(manifest, indent=2).encode("utf-8")
        wf_bytes = json.dumps(graph, indent=2).encode("utf-8")
        try:
            dest = blueprints.BLUEPRINTS_STAGING / bp_id
            dest.mkdir(parents=True, exist_ok=True)
            (dest / "blueprint.json").write_bytes(man_bytes)
            (dest / "workflow.json").write_bytes(wf_bytes)
            prefix = f"{blueprints.SHARED_BLUEPRINTS_PREFIX}/{bp_id}"
            storage.put(f"{prefix}/blueprint.json", man_bytes)
            storage.put(f"{prefix}/workflow.json", wf_bytes)
        except Exception as e:  # noqa: BLE001 — disk/R2 hiccup, not a crash
            return f"✖ Could not save blueprint '{bp_id}': {e}"

        # Re-hydrate so it's listable/selectable right away (and confirm it
        # loads cleanly through the same path the runner uses).
        try:
            blueprints.hydrate(force=True)
        except Exception:  # noqa: BLE001 — staging copy already written
            pass
        if blueprints.get_blueprint(bp_id) is None:
            return (f"⚠ Saved '{bp_id}' but it didn't reload cleanly — check the "
                    "bindings and try again.")
        verb = "Updated" if overwrite else "Published"
        return (f"✓ {verb} blueprint '{bp_id}' — select it in the pipeline "
                "dropdown (reload to refresh the list).")

    def _publish_author(self) -> str:
        """Best-effort username to stamp on an uploaded blueprint. The launcher
        handoff doesn't currently forward an identity, so this is "uploaded"
        unless an env (`IW_USER_NAME`) carries one. Kept as a single seam so a
        future handoff field only changes here."""
        return (os.environ.get("IW_USER_NAME", "").strip() or "uploaded")

    def _sliceatlas(self) -> str:
        # Pass the FULL staging manifest path (not just .name) so the subprocess
        # reads the right file even if its own context resolution differs; and
        # hand off the UI's active (client, project) via IW_* so it resolves
        # MANIFEST_DIR/INPUT_DIR under the same prefix (mirrors _run_cmd).
        cmd = [PY, str(TOOLS / "slice_atlas.py"),
               "--manifest", str(manifest_path()), "--as", "style_ref"]
        env = dict(os.environ)
        env["IW_PROJECT_NAME"] = project_paths.project_name()
        env["IW_CLIENT_NAME"] = project_paths.client_name()
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=300,
                               cwd=str(SELF), env=env)
        except subprocess.TimeoutExpired:
            return _diag("SLICE_FAILED", err="timed out after 300s")
        out = (p.stdout or "").strip().splitlines()
        tail = out[-1] if out else ""
        if p.returncode != 0:
            err = (p.stderr or p.stdout or "").strip().splitlines()
            return _diag("SLICE_FAILED", err=(err[-1] if err else "see console"))
        return "✓ " + (tail or "sliced")

    def _refresh(self) -> str:
        """Re-pull the ACTIVE (client, project) subtree from R2 into staging on
        demand, so manifests another tool just exported (e.g. a Sheet Maker
        save landing in the SHARED <c>/<p>/manifests/) show up without a
        service restart or a project switch.

        The active context is already set on this request thread by
        do_POST -> _resolve_context(); we re-derive the same (client_key,
        proj_key, staging_root) cloud_paths would for it and force-hydrate.
        hydrate() pulls manifests + config SYNCHRONOUSLY (so list_manifests()
        is fresh by the time we return) and backgrounds the heavy refs/outputs
        pull — same split as boot. The hydrate targets THIS request thread's own
        per-(client, project) staging tree (thread-local context), so concurrent
        different-project refreshes can't collide — no lock. Never 500s on an R2
        hiccup: a transient failure returns an actionable message instead."""
        try:
            client_key = project_paths.r2_slug(
                project_paths.client_name())
            proj_key = project_paths.r2_slug(
                project_paths.project_name())
            project_paths.hydrate(client_key, proj_key, Path(STAGING_ROOT),
                                  force=True)
            # Also re-pull the SHARED blueprint library so a newly-seeded /
            # uploaded blueprint shows up in the pipeline picker without a
            # service restart (blueprints.hydrate() is otherwise once-per-
            # process). Best-effort: never let an R2 hiccup here fail the
            # whole refresh.
            try:
                blueprints.hydrate(force=True)
            except Exception:  # noqa: BLE001 — transient; manifests still fresh
                pass
            n = len(list_manifests())
        except Exception as e:  # noqa: BLE001 — transient R2 issue, not fatal
            return ("↻ Refresh from R2 hit a snag — try again in a moment "
                    f"({type(e).__name__}: {e})")
        return f"✓ Refreshed from R2 — {n} manifest(s) available"

    def _clearcache(self) -> str:
        """TRUE reset of the ACTIVE (client, project) from R2: rmtree the whole
        per-project staging subtree, then force-hydrate to rebuild it EXACTLY
        from R2. Because pull_prefix only adds/overwrites (never prunes) and our
        listings come from the local staging glob, a file deleted from R2 (e.g.
        via the launcher FTP browser or a separate container) would otherwise
        linger here forever. Deleting the whole subtree first guarantees staging
        matches R2 afterwards — anything dropped from R2 is dropped here too.

        Inactive project trees are still deleted whole (bound disk growth). The
        active subtree is deleted whole as well, then force-hydrate re-pulls the
        eager subtrees (manifests/ + atlas_config.json sync, input/ + atlas/ in
        the background) and clears the lazy guards so batch/ + deploy/ re-pull on
        demand. R2 is canonical, so nothing local is unique — local-disk only,
        never touches R2 (no _unmirror). Returns the bytes freed.

        Serialized against the render lock and the lazy-hydrate lock so the
        rmtree can't interleave with an in-flight generation or `ensure_lazy`
        pull (which would otherwise leave a half-populated `batch/` behind its
        still-set guard). Active lazy guards are discarded BEFORE the rmtree
        (under the lazy lock), not relying solely on the post-rmtree
        force-hydrate. The active (client, project) context is preserved — we
        rebuild the same project in place, never switch."""
        base = Path(project_paths.STAGING_BASE).resolve()
        active = Path(STAGING_ROOT).resolve()
        client_key = project_paths.r2_slug(project_paths.client_name())
        proj_key = project_paths.r2_slug(project_paths.project_name())
        before = _dir_size(base)
        # _render_lock: no generation may be writing variants into batch/ while
        # we prune. _lazy_lock: no ensure_lazy pull may be populating a lazy
        # subtree. Both are coarse but cheap (clearcache is rare).
        with _render_lock, project_paths.lazy_lock():
            # Discard the active guards first so a concurrent ensure_lazy parked
            # on the lazy lock re-pulls after us instead of trusting a stale
            # guard over the tree we are about to delete.
            project_paths.discard_active_lazy_guards()
            # Drop every other (client, project) tree entirely, AND the active
            # one — guarded so we only ever rmtree a per-(client, project)
            # subtree, never STAGING_BASE itself or a stray sibling at the wrong
            # depth.
            if base.exists():
                for client_dir in base.iterdir():
                    if not client_dir.is_dir():
                        continue
                    for proj_dir in client_dir.iterdir():
                        if proj_dir.is_dir():
                            shutil.rmtree(proj_dir, ignore_errors=True)
                    if not any(client_dir.iterdir()):
                        shutil.rmtree(client_dir, ignore_errors=True)
            # Re-ensure the active project's essential dirs exist (the tool reads
            # them directly; resolve() also recreates them, but make it explicit
            # so a read between here and the next resolve() can't trip).
            for d in (INPUT_DIR, BATCH_DIR, ATLAS_DIR, MANIFEST_DIR):
                try:
                    Path(d).mkdir(parents=True, exist_ok=True)
                except OSError:
                    pass
            # Rebuild the active project from R2: manifests/ + atlas_config sync
            # (so list_manifests() is fresh and any R2-deleted manifest is gone),
            # input/ + atlas/ background, batch/ + deploy/ lazily on next access.
            try:
                project_paths.hydrate(client_key, proj_key, active, force=True)
            except Exception:  # noqa: BLE001 — best-effort re-hydrate
                pass
        freed = max(0, before - _dir_size(base))
        return f"✓ Reset from R2 — freed {_human_bytes(freed)}"

    def _deployatlas(self, force_page_only: bool = False) -> str:
        """Cloud deploy: copy the composed atlas (<stem>_new.png/webp/atlas in
        the staging ATLAS_DIR) to an R2 deploy location. `deploy_path` in the
        manifest is treated as an R2 key PREFIX (default
        '<r2_project_prefix>/deploy'); `deploy_basename` overrides the name."""
        m = load_manifest()
        stem = manifest_path().stem.replace("atlas_manifest_", "")
        out_base = str(m.get("deploy_basename", "")).strip() or stem
        # `deploy_path` is an R2 KEY PREFIX, always INSIDE this project's R2 space
        # (R2_PREFIX = <client>/<project>). Legacy/local manifests — and
        # the old placeholder text — may hold a Windows path like "C:/..." or an
        # absolute path; used verbatim those create a junk object keyed off a drive
        # letter at the bucket root (the "deploying to C:/" bug). Normalize: drop
        # drive/absolute paths, and nest any other relative value under the project
        # prefix so Deploy can never escape the game's space.
        raw = str(m.get("deploy_path", "")).replace("\\", "/").strip().strip("/")
        if raw and (re.match(r"^[A-Za-z]:/", raw) or raw.startswith("/")):
            raw = ""
        # Resolve the thread-local proxy to a plain str once — it supports
        # f-strings but NOT `+` (it's a _StrProxy), so concatenation below must
        # use the resolved value.
        prefix = str(R2_PREFIX) if R2_PREFIX else ""
        base = f"{prefix}/deploy" if prefix else "deploy"
        # AUTO-RESOLVE: when no explicit `deploy_path` is set on the manifest,
        # try the project's asset-map (published by the sibling tool at
        # `<client>/<project>/asset-map.json`) before falling back to the flat
        # deploy/ root. The map keys each game asset stem to where the game
        # loads it: { "<stem>": {"deploy_path": "sprites/<name>",
        # "deploy_basename": "<name>"}, … } mirroring static/assets/. Read it
        # FRESH from R2 every deploy so a newly-published map is honoured
        # without a tool restart; tolerate a missing/invalid map as "no map".
        auto_note = ""
        # The asset-map entry matched for THIS deploy (by basename/name) — kept
        # around past the auto-resolve block so the page-only detection below can
        # read its `kind` ("spine" vs "sprite") without re-reading the map.
        map_entry: dict | None = None
        man_base = str(m.get("deploy_basename", "")).strip()
        if prefix:
            asset_map: dict = {}
            try:
                blob = storage.get(f"{prefix}/asset-map.json")
                if blob:
                    loaded = json.loads(blob)
                    if isinstance(loaded, dict):
                        asset_map = loaded
            except Exception:  # noqa: BLE001 — any miss/parse error = no map
                asset_map = {}
            if asset_map:
                # Candidate keys, in priority order: the manifest's
                # deploy_basename, the stem/out_base being deployed, then the
                # manifest filename sans `atlas_manifest_`/ext.
                cands = [c for c in (man_base, out_base, stem) if c]
                entry = None
                for c in cands:
                    if c in asset_map:
                        entry = asset_map[c]
                        break
                if entry is None:  # case-insensitive fallback
                    lowered = {str(k).lower(): v for k, v in asset_map.items()}
                    for c in cands:
                        hit = lowered.get(c.lower())
                        if hit is not None:
                            entry = hit
                            break
                if isinstance(entry, dict):
                    map_entry = entry
            # AUTO-RESOLVE: when no explicit `deploy_path` is set on the
            # manifest, adopt the matched asset-map entry's deploy_path/basename.
            if map_entry is not None and not raw:
                mapped = str(map_entry.get("deploy_path", "")).replace(
                    "\\", "/").strip().strip("/")
                if mapped and not (re.match(r"^[A-Za-z]:/", mapped)
                                   or mapped.startswith("/")):
                    raw = mapped
                    # Adopt the map's basename only if the manifest had none.
                    if not man_base:
                        mb = str(map_entry.get("deploy_basename", "")).strip()
                        if mb:
                            out_base = mb
                    auto_note = (
                        f"ℹ deploy_path auto-resolved from asset-map → {raw}")
        # `deploy_path` is the subpath UNDER deploy/ that mirrors the game's
        # static/assets/ layout (e.g. `sprites/symbolsStatic`). Strip a redundant
        # leading `deploy/` if the user included it, so it never double-nests.
        if raw == "deploy":
            raw = ""
        elif raw.startswith("deploy/"):
            raw = raw[len("deploy/") :]
        # SMART DEFAULT: still no subpath (no manifest value, no asset-map hit) →
        # mirror the game's static/assets/ layout with `<kind>/<out_base>` instead
        # of dumping to the flat deploy/ ROOT (which the game can't load from).
        # Infer spine from the CHEAP signals already at hand — no R2 probe (the
        # page-only skeleton probe below needs dest_prefix and runs later).
        if not raw and out_base:
            likely_spine = bool(force_page_only or m.get("deploy_page_only")
                                or m.get("page_only"))
            if not likely_spine and isinstance(map_entry, dict):
                likely_spine = str(
                    map_entry.get("kind", "")).strip().lower() == "spine"
            raw = f"{'spines' if likely_spine else 'sprites'}/{out_base}"
            note = (f"ℹ deploy_path defaulted → {raw} (mirrors static/assets/; "
                    f"set a Deploy prefix to override)")
            auto_note = f"{auto_note}  {note}" if auto_note else note
        if not raw:
            dest_prefix = base
        elif prefix and (raw == prefix or raw.startswith(prefix + "/")):
            dest_prefix = raw  # caller gave a fully-qualified key inside the project
        else:
            dest_prefix = f"{base}/{raw}"  # nest the mirrored subpath under deploy/
        # PAGE-ONLY MODE — for a Spine target the deploy destination already holds
        # a `<base>.json` that is the SKELETON (~88 KB) plus a `<base>.atlas`; the
        # normal sprite-sheet path would write a TexturePacker `<base>.json` over
        # the skeleton and break the animation. When this is a spine page we deploy
        # ONLY the page image(s) and leave the skeleton + .atlas untouched. Trigger
        # on the first true of (cheap → best-effort):
        #   0. the user's "Page-only (Spine page)" checkbox (`force_page_only`,
        #      from the `page_only=1` query param) — an explicit override,
        #   1. manifest flag `deploy_page_only` / `page_only`,
        #   2. the matched asset-map entry's `kind == "spine"`,
        #   3. an existing `<dest>/<base>.json` in R2 parses as a Spine skeleton
        #      (top-level bones/skeleton/slots) rather than a TexturePacker map.
        page_only = bool(force_page_only or m.get("deploy_page_only")
                         or m.get("page_only"))
        if not page_only and isinstance(map_entry, dict):
            page_only = str(map_entry.get("kind", "")).strip().lower() == "spine"
        if not page_only:
            try:
                existing = storage.get(f"{dest_prefix}/{out_base}.json")
                if existing:
                    doc = json.loads(existing)
                    if isinstance(doc, dict):
                        is_tp = isinstance(doc.get("frames"), (dict, list)) \
                            and isinstance(doc.get("meta"), dict)
                        is_spine = any(k in doc for k in
                                       ("bones", "skeleton", "slots"))
                        if is_spine and not is_tp:
                            page_only = True
            except Exception:  # noqa: BLE001 — missing/invalid = not detectable
                pass
        # STICKY PAGE-ONLY — once a deploy resolves to page-only (by checkbox OR
        # any auto-detect trigger above), persist `deploy_page_only` on the
        # manifest so the decision survives. Next deploy hits trigger #1 with no
        # network probe, and the UI hint (`_page_only_hint`) pre-checks the box.
        # Net effect: a spine reskin is ticked at most once — and a real spine
        # target auto-detects on the first deploy, so usually never. Best-effort;
        # a save failure must never block the deploy.
        if page_only and not m.get("deploy_page_only"):
            try:
                m["deploy_page_only"] = True
                save_manifest(m)
            except Exception:  # noqa: BLE001 — persistence is a convenience
                pass
        # Page-only deploys ship JUST the page image(s); never a `.atlas` (the
        # spine target's own .atlas must stay intact). Normal deploys also carry
        # the composed `.atlas`.
        page_suffixes = {".png", ".webp"} if page_only else {".png", ".webp", ".atlas"}
        sources = sorted(p for p in ATLAS_DIR.glob(f"{stem}_new.*")
                         if p.suffix.lower() in page_suffixes)
        if not sources:
            return (f"📦 Nothing to deploy — no {stem}_new.(png|webp|atlas) in "
                    f"the composed output. Create Atlas first.")
        # `deploy_path` carries the MIRRORED subpath (live-assets.md step 1):
        # when it nests under the game's `static/assets/` layout (e.g.
        # `sprites/symbolsStatic`) the deploy lands at
        # `<C>/<P>/deploy/sprites/symbolsStatic/<base>.{json,webp,png,atlas}`,
        # mirroring `static/assets/sprites/symbolsStatic/...` verbatim. When no
        # subpath is configured we fall back to the flat `deploy/<base>.*` and
        # note it (no mirrored layout was set on this manifest).
        mirrored = bool(raw)
        copied = []
        page_src = None  # the deployed page image the .json should point at
        skipped_empty = []
        for src in sources:
            data = src.read_bytes()
            # NEVER deploy a 0-byte page (e.g. a failed WEBP encode): meta.image
            # would point at an empty page → the game can't load the spritesheet
            # → the whole atlas renders as nothing. Skip it; the valid page below
            # (PNG) is used instead.
            if src.suffix.lower() in {".png", ".webp"} and not data:
                skipped_empty.append(src.name)
                continue
            key = f"{dest_prefix}/{out_base}{src.suffix}"
            try:
                storage.put(key, data)
            except Exception as e:  # noqa: BLE001
                return _diag("DEPLOY_FAILED", src=src.name, key=key,
                             err=f"{type(e).__name__}: {e}")
            copied.append(key)
            suf = src.suffix.lower()
            if suf == ".webp":
                page_src = src  # prefer the .webp the game loads
            elif suf == ".png" and page_src is None:
                page_src = src
        # Additionally emit the game-loadable TexturePacker spritesheet
        # (<base>.json), so deploy/ holds exactly the frames+meta format the
        # engine loads (live-assets.md step 1). Geometry comes from the BOUND
        # `.atlas` (the manifest's authoritative region map) when available —
        # NOT a `_new.atlas`, which compose doesn't produce — parsed to the same
        # normalized regions; otherwise it falls back to the manifest's own
        # `regions[]` (cell-grid / region manifests have NO sibling `.atlas`, but
        # they already carry per-region geometry). Additive: never blocks the
        # .png/.webp deploy above.
        json_note = ""
        spine_note = ""
        if page_only:
            # Spine target: page image(s) already deployed above. SKIP the
            # TexturePacker `<base>.json` writer entirely so the spine skeleton
            # (also named `<base>.json`) and its `<base>.atlas` are left intact.
            pages = ", ".join(
                f"{out_base}{s.suffix}" for s in sources
                if s.suffix.lower() in {".png", ".webp"})
            spine_note = (
                f"ℹ Spine page-only deploy — wrote {pages or out_base + '.png/.webp'}; "
                f"skipped TexturePacker .json so the spine skeleton + .atlas "
                f"stay intact.\n")
        tp_regions: list[dict] | None = None  # normalized region dicts for the writer
        page_w = page_h = 0
        atlas_path = batch_atlas.atlas_file_path(m, manifest_path())
        if not page_only and atlas_path is not None and atlas_path.exists():
            # First choice: the bound `.atlas` is the authoritative region map.
            try:
                parsed = atlas_format.parse_atlas(atlas_path)
                tp_regions = parsed["regions"]
                page_w, page_h = parsed["page"]["width"], parsed["page"]["height"]
            except Exception as e:  # noqa: BLE001
                json_note = (f"  ⚠ Bound .atlas could not be parsed "
                             f"({type(e).__name__}: {e}); ")
                atlas_path = None  # fall through to the manifest-regions fallback
        if not page_only and tp_regions is None:
            # Fallback: build the spritesheet from the manifest's own regions.
            # Read BOTH region buckets — `regions` AND `rotated_regions` — exactly
            # like every other manifest walk in this file (e.g. all_regions / the
            # `for bucket in ("regions", "rotated_regions")` loops). Reading only
            # `regions` silently drops every rotated_regions symbol from the
            # deployed frame-map even though its art is in the page, so the game
            # can't address it (blank symbol).
            # Manifest regions in this tool are snake_case ({name,x,y,w,h,rotated}
            # plus optional off_x/off_y/orig_w/orig_h when atlas-bound); a region
            # manifest authored elsewhere may use camelCase (offX/origW/…) — read
            # BOTH defensively. Missing offset/orig => a non-trimmed full frame.
            man_regions = [r for bucket in ("regions", "rotated_regions")
                           for r in (m.get(bucket) or []) if isinstance(r, dict)]
            normed: list[dict] = []
            for r in man_regions:
                name = r.get("name")
                if not name:
                    continue
                try:
                    rx, ry = int(r["x"]), int(r["y"])
                    rw, rh = int(r["w"]), int(r["h"])
                except (KeyError, TypeError, ValueError):
                    continue  # a region without a complete rect can't be a frame
                def _pick(*keys, default=None):
                    for k in keys:
                        if r.get(k) is not None:
                            return r[k]
                    return default
                normed.append({
                    "name": name,
                    "x": rx, "y": ry, "w": rw, "h": rh,
                    "rotated": bool(r.get("rotated")),
                    "off_x": int(_pick("off_x", "offX", default=0)),
                    "off_y": int(_pick("off_y", "offY", default=0)),
                    "orig_w": int(_pick("orig_w", "origW", default=rw)),
                    "orig_h": int(_pick("orig_h", "origH", default=rh)),
                })
            if normed:
                tp_regions = normed
                # Page size: prefer the manifest's atlas block, else the actual
                # deployed page image's pixel size (always correct).
                atl = m.get("atlas") or {}
                try:
                    page_w = int(atl["width"])
                    page_h = int(atl["height"])
                except (KeyError, TypeError, ValueError):
                    page_w = page_h = 0
                if (page_w <= 0 or page_h <= 0) and page_src is not None:
                    try:
                        with Image.open(page_src) as _pg:
                            page_w, page_h = _pg.size
                    except Exception:  # noqa: BLE001
                        page_w = page_h = 0
        if page_only:
            pass  # page-only: no TexturePacker .json (see spine_note above)
        elif tp_regions and page_src is not None and page_w > 0 and page_h > 0:
            try:
                page_image = f"{out_base}{page_src.suffix}"
                tp_path = ATLAS_DIR / f"{stem}_new.json"
                atlas_writers.write_texturepacker_json(
                    tp_path, page_image, page_w, page_h, tp_regions)
                json_key = f"{dest_prefix}/{out_base}.json"
                storage.put(json_key, tp_path.read_bytes())
                copied.append(json_key)
            except Exception as e:  # noqa: BLE001
                json_note += (f"  ⚠ Spritesheet JSON not written "
                              f"({type(e).__name__}: {e}) — page image deployed.")
        elif page_src is None:
            json_note += ("  ⚠ No .webp/.png page in composed output → "
                          "TexturePacker .json skipped (meta.image would dangle).")
        elif not tp_regions:
            json_note += ("  ⚠ No bound .atlas AND no manifest regions[] for this "
                          "manifest → no TexturePacker .json emitted. Game "
                          "spritesheet not produced; only the page image was "
                          "deployed.")
        else:
            json_note += ("  ⚠ Could not determine page image size → "
                          "TexturePacker .json skipped (meta.size would be 0).")
        if skipped_empty:
            json_note += (f"  ⚠ Skipped empty page file(s) {', '.join(skipped_empty)} "
                          f"(0 bytes — likely a failed WEBP encode); deployed the "
                          f"valid page instead.")
        if not mirrored:
            # Deployed to the flat deploy/ ROOT because no `deploy_path` subpath
            # was set. The files ARE deployed, but the game loads from
            # static/assets/<deploy_path>/... so it will NOT find them at the
            # root. Lead with a loud warning (not a soft note buried at the end).
            warning = (
                "⚠ DEPLOYED TO deploy/ ROOT — no `deploy_path` set, so the game "
                "will NOT find these files. Set this manifest's Deploy prefix to "
                "the asset's game path (mirrors static/assets/), e.g. "
                "`sprites/<name>` or `spines/<group>`, then deploy again.")
            return (f"{spine_note}{warning}\n"
                    f"✓ Deployed to R2: {', '.join(copied)}{json_note}")
        head = f"{auto_note}\n" if auto_note else ""
        return (f"{spine_note}{head}"
                f"✓ Deployed to R2: {', '.join(copied)}{json_note}")

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
        """R2 file picker. Browses the project's R2 asset repo (mirrored into
        staging) as a folder tree. Rooted at STAGING_ROOT with an ALLOWED-ROOTS
        whitelist — the picker may descend only into `input/` (legacy refs),
        the Sheet-Maker `sheets/`/`sheet_src/` subtrees, and `atlas/`.

        Returned `path` values are RELATIVIZED PER ROOT so existing callers don't
        break: an `input/` pick comes back input-rooted (e.g. `refs/foo.png`),
        exactly as before, since the region fields + INPUT_DIR resolvers expect
        that; a sheet pick comes back STAGING_ROOT-rooted (e.g.
        `sheets/foo/bar.png`), which the Section-2 resolvers
        (_resolve_region_ref / atlas_file_path / source_image_candidates) now
        accept. `rel`/`up` navigation stays STAGING_ROOT-relative throughout.

        `key` tunes the filter: `atlas_file` also lists `.atlas` geometry;
        `deploy_path` lists folders only. Everything else lists images."""
        img_exts = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
        exts = img_exts | {".atlas"} if key == "atlas_file" else img_exts
        folder_only = key == "deploy_path"
        try:
            root = STAGING_ROOT.resolve()
            root.mkdir(parents=True, exist_ok=True)
            input_root = INPUT_DIR.resolve()
            # Permitted subtrees under STAGING_ROOT. Anything outside these snaps
            # back to root (which lists only their top-level names).
            allowed = [input_root, (root / "sheets").resolve(),
                       (root / "sheet_src").resolve(), (root / "atlas").resolve()]
            # Hydrate the Sheet-Maker subtrees lazily so they're populated before
            # we list them (they're not eagerly pulled at project open).
            project_paths.ensure_lazy("sheets/")
            project_paths.ensure_lazy("sheet_src/")
            rel = (path or "").strip().replace("\\", "/").strip("/")
            # Legacy field values (e.g. `refs/atlas/foo.png` → folder `refs/atlas`)
            # are INPUT_DIR-relative with no allowed top-level segment; map them to
            # `input/<rel>` so the picker opens at that folder instead of snapping
            # to root. STAGING-rooted nav paths already lead with an allowed segment.
            top = rel.split("/", 1)[0] if rel else ""
            if rel and top not in ("input", "sheets", "sheet_src", "atlas"):
                rel = f"input/{rel}"
            cur = (root / rel).resolve()
            # Allow root itself, or any path AT/UNDER one of the allowed subtrees.
            ok = (cur == root) or any(
                sub == cur or sub in cur.parents for sub in allowed)
            if not ok or not cur.is_dir():
                cur, rel = root, ""

            def _file_path(e: Path) -> str:
                # FILE picks are per-root: input/ files come back input-rooted
                # (unchanged legacy behaviour — region fields + INPUT_DIR
                # resolvers expect `refs/…`); sheet files come back STAGING-rooted
                # (`sheets/…`), which the Section-2 resolvers now accept.
                er = e.resolve()
                try:
                    if er == input_root or input_root in er.parents:
                        return er.relative_to(input_root).as_posix()
                except (OSError, ValueError):
                    pass
                return er.relative_to(root).as_posix()

            dirs, files = [], []
            if cur == root:
                # At root, list ONLY the allowed subdir names (input/sheets/…).
                # Dir nav paths are ALWAYS STAGING-rooted (the browser re-roots
                # at STAGING_ROOT), so input/ navigates as `input`, sheets as
                # `sheets`, etc. — independent of the per-root file relativization.
                for sub in allowed:
                    if sub.is_dir():
                        dirs.append({"name": sub.name,
                                     "path": sub.relative_to(root).as_posix()})
            else:
                for e in sorted(cur.iterdir(), key=lambda p: p.name.lower()):
                    try:
                        if e.is_dir():
                            # STAGING-rooted nav path so fsList(d.path) re-roots
                            # correctly under STAGING_ROOT for every subtree.
                            dirs.append({"name": e.name,
                                         "path": e.resolve().relative_to(root).as_posix()})
                        elif not folder_only and e.suffix.lower() in exts:
                            files.append({"name": e.name, "path": _file_path(e)})
                    except (OSError, ValueError):
                        continue
            if rel == "":
                up = None
            else:
                parent = Path(rel).parent.as_posix()
                up = "" if parent == "." else parent
            cur_label = "R2 repo: " + (rel or "(root)")
            return json.dumps({"ok": True, "cur": cur_label, "rel": rel,
                               "up": up, "dirs": dirs,
                               "files": files}).encode()
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
            "R2 destination prefix (inside this project's space) for the "
            "📦 Deploy atlas button. The tool uploads "
            "<manifest-stem>_new.(png|webp|atlas) here as "
            "<manifest-stem>.(png|webp|atlas), overwriting existing keys. "
            "Blank = the project's default 'deploy/' prefix. A relative value "
            "(e.g. 'deploy/symbols') is nested under the project; local paths "
            "like C:/… are ignored and fall back to the default.",
            quote=True)
        atlas_fields.append(
            f'<label><span class="lblrow">Deploy prefix (R2) '
            f'<span style="color:#888;font-size:10px">· this atlas</span>'
            f'<span class="qm" title="{deploy_tip}">&#9432;</span></span>'
            f'<span class="filefld">'
            f'<input data-cfg="deploy_path" type="text" value="{deploy_val}"'
            f' title="{deploy_tip}" placeholder="blank = deploy/  ·  e.g. deploy/symbols">'
            f'<button type="button" class="fbtn" title="Browse R2 folders in '
            f'this project" onclick="openFs(\'deploy_path\')"'
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
        # Page-only (Spine page) hint: pre-check the Deploy checkbox + show a
        # small note when the active manifest resolves to a Spine target. This is
        # only a HINT — server-side auto-detect still forces page-only for spines
        # even if the user unchecks it, and the checkbox forces it for any target.
        _po_stem = manifest_path().stem.replace("atlas_manifest_", "")
        page_only_hint = _page_only_hint(load_manifest(), _po_stem)
        page_only_attrs = " checked" if page_only_hint else ""
        page_only_note = (
            '<span id="pageOnlyNote" style="font-size:12px;color:#7fd6a0;'
            'margin-left:2px" title="This manifest maps to a Spine skeleton; '
            'page-only is on so the .json/.atlas skeleton is not overwritten.">'
            'Spine target &rarr; page-only</span>'
            if page_only_hint else "")
        # Deep-link state (set by _handle_deeplink before render; defaults so a
        # plain page load is unaffected).
        dl_region = getattr(self, "_deeplink_region", "") or ""
        dl_notice = getattr(self, "_deeplink_notice", "") or ""
        notices = []
        if _load_warning:
            notices.append(
                f'<div style="margin:10px 0;padding:10px 14px;'
                f'background:#5a3a1a;border:1px solid #b9802f;'
                f'border-radius:6px;color:#ffd9a0;font-size:13px">'
                f'⚠ {html.escape(_load_warning)}</div>')
        if _geom_warning:
            # Set by all_regions() while the cards above were built: manifest
            # regions absent from the bound `.atlas` (stale staged geometry).
            notices.append(
                f'<div style="margin:10px 0;padding:10px 14px;'
                f'background:#5a3a1a;border:1px solid #b9802f;'
                f'border-radius:6px;color:#ffd9a0;font-size:13px">'
                f'⚠ {html.escape(_geom_warning)}</div>')
        if dl_notice:
            # _diag() returns canonical multi-line text (glyph + why + fix);
            # render it as a info-toned banner, preserving line breaks.
            notices.append(
                f'<div style="margin:10px 0;padding:10px 14px;'
                f'background:#1d3a4a;border:1px solid #2f7fb9;'
                f'border-radius:6px;color:#a0d6ff;font-size:13px;'
                f'white-space:pre-line">{html.escape(dl_notice)}</div>')
        blueprints_panel = self._blueprints_panel_html(
            getattr(self, "can_publish", False), g_pipe)
        # role-binding map for every non-built-in blueprint, for the client's
        # ref-field show/hide logic (a blueprint hides a ref field it doesn't
        # bind). Best-effort — empty map on any R2 trouble.
        bp_bound: dict[str, list[str]] = {}
        try:
            for _b in blueprints.list_blueprints():
                _bid = str(_b.get("id", ""))
                if _bid in PIPELINE_OPTIONS:
                    continue
                _full = blueprints.get_blueprint(_bid)
                if _full:
                    bp_bound[_bid] = list((_full.get("bindings") or {}).keys())
        except Exception:  # noqa: BLE001 — never break the page render
            bp_bound = {}
        return PAGE.format(
            iw_toolbar=IW_TOOLBAR,
            cards="".join(cards),
            blueprints_panel=blueprints_panel,
            bp_bound_roles_js=json.dumps(bp_bound),
            global_fields="".join(global_fields),
            atlas_fields="".join(atlas_fields),
            spine_link=spine_link,
            page_only_attrs=page_only_attrs,
            page_only_note=page_only_note,
            manifest_select=manifest_select,
            project_select=project_select,
            proj_qm=f'<span class="qm" title="{html.escape(help_for("project", cfg), quote=True)}">&#9432;</span>',
            manifest_qm=f'<span class="qm" title="{html.escape(help_for("manifest_path", cfg), quote=True)}">&#9432;</span>',
            manifest_name=html.escape(manifest_path().name),
            global_neg=html.escape(_style.get("negative", "")),
            global_pre=html.escape(_style.get("positive_prefix", "")),
            global_suf=html.escape(_style.get("positive_suffix", "")),
            flash_region=json.dumps(dl_region),
            notice="".join(notices),
        )

    def _blueprints_panel_html(self, can_publish: bool, active_pipe: str) -> str:
        """The "Blueprints" settings section: the shared library list + (when
        the request may publish) the "＋ New blueprint" button that opens the
        upload/bind modal. Read-only for everyone; the create affordance is
        hidden when `can_publish` is false (server-side too — `_uploadblueprint`
        refuses). Best-effort list — an R2 hiccup just shows none."""
        try:
            bps = blueprints.list_blueprints()
        except Exception:  # noqa: BLE001 — never break the page on R2 trouble
            bps = []
        rows = []
        for b in bps:
            bid = str(b.get("id", ""))
            name = str(b.get("name", "") or bid)
            desc = str(b.get("description", ""))
            base = str(b.get("base", ""))
            builtin = bid in PIPELINE_OPTIONS
            tag = " · built-in reference" if builtin else ""
            active = " · ● selected" if bid == active_pipe else ""
            rows.append(
                f'<div style="padding:7px 0;border-top:1px solid #2a2a2e">'
                f'<b style="color:#ddd">{html.escape(name)}</b> '
                f'<code style="color:#7fa">{html.escape(bid)}</code>'
                f'<span style="color:#888;font-size:11px"> · base '
                f'{html.escape(base)}{tag}{active}</span>'
                f'<div style="color:#999;font-size:12px;margin-top:2px">'
                f'{html.escape(desc)}</div></div>')
        listing = ("".join(rows) if rows else
                   '<div style="color:#888;font-size:13px;padding:6px 0">'
                   'No blueprints in the shared library yet.</div>')
        new_btn = ""
        if can_publish:
            new_btn = (
                '<button onclick="openNewBlueprint()" style="margin:10px 0 0" '
                'title="Upload a ComfyUI API-format workflow and bind its roles '
                'as a new shared blueprint">＋ New blueprint</button>')
        note = ("" if can_publish else
                '<div style="color:#777;font-size:12px;margin-top:8px">'
                'Publishing new blueprints needs the &ldquo;Publish '
                'blueprints&rdquo; permission.</div>')
        return (
            '<details class="settings">'
            '<summary>🧩 Blueprints — shared ComfyUI pipeline library</summary>'
            '<div style="padding-top:6px">'
            '<div style="font-size:13px;color:#bbb;margin-bottom:6px">'
            'Data-driven pipelines anyone can publish and everyone can run. '
            'Select one in the <b>Pipeline</b> dropdown (Global settings) to '
            'generate with it. Built-in sdxl/flux/gpt_image use their proven '
            'Python path even though they appear here as references.</div>'
            f'<div>{listing}</div>{new_btn}{note}'
            '</div></details>')

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
            return _diag("MISSING_IMAGE_DATA")
        try:
            raw = base64.b64decode(b64)
            img = Image.open(io.BytesIO(raw))
        except Exception as e:  # noqa: BLE001
            return _diag("SOURCE_IMAGE_INVALID", err=f"{type(e).__name__}: {e}")
        (INPUT_DIR / "refs").mkdir(parents=True, exist_ok=True)
        rel = f"refs/useroutput_{name}.png"
        img.convert("RGBA").save(INPUT_DIR / rel)
        _mirror(INPUT_DIR / rel)  # persist the user image to R2
        _drop_fx_snapshot(name)
        m = load_manifest()
        r = self._ensure_region(m, name)
        if r is None:
            return _diag("REGION_NOT_FOUND", name=name)
        r["output_override"] = rel
        save_manifest(m)
        return (f"Using your image for {name} (not processed). "
                f"Create Atlas to apply; ✕ revert to generate again.")

    def _bind_ref_as_output(self, m: dict, region: dict) -> tuple[bool, str]:
        """Core of "use this region's reference image as its atlas tile":
        resolve the region's ref (shape_ref → style_ref), snapshot it to
        refs/useroutput_<name>.png (verbatim — no AI, no RMBG), mirror to R2,
        drop the stale FX snapshot, and set output_override on the region's
        PERSISTED creative entry (via _ensure_region — `region` may be a merged
        .atlas view that isn't itself saved).

        Does NOT call save_manifest — the caller persists once (so this is
        safe to call in a bulk loop).

        Return contract: (ok, detail). Element 2 is dual-purpose by `ok`:
          - ok=True  → detail is the source filename (src.name), for display.
          - ok=False → detail is a failure reason: the sentinel "noref" when
            the region has no usable reference, else a decode-error string."""
        name = region.get("name", "")
        src = None
        for key in ("shape_ref", "style_ref"):
            ref = region.get(key)
            if ref:
                p = _resolve_region_ref(ref)
                if p is not None:
                    src = p
                    break
        if src is None:
            return (False, "noref")
        try:
            img = Image.open(src).convert("RGBA")
        except Exception as e:  # noqa: BLE001
            return (False, f"{type(e).__name__}: {e}")
        r = self._ensure_region(m, name)
        if r is None:
            return (False, "noref")
        (INPUT_DIR / "refs").mkdir(parents=True, exist_ok=True)
        rel = f"refs/useroutput_{name}.png"
        img.save(INPUT_DIR / rel)
        _mirror(INPUT_DIR / rel)  # persist the user image to R2
        _drop_fx_snapshot(name)
        r["output_override"] = rel
        return (True, src.name)

    def _region_has_output(self, region: dict) -> bool:
        """True when a region already has a committed/available atlas tile —
        either a user output_override that resolves to a real file, or a
        generated variant PNG exists for it. Centralized so the bulk seed and
        any future caller share one definition of "already has an image".

        NOTE: callers must hydrate batch/ first (the variant pile is a lazy
        subtree not pulled at startup); _seed_refs_into_outputs does this once
        before its loop so the variant check sees R2 variants after a switch."""
        if batch_atlas.override_image_path(region) is not None:
            return True
        try:
            return bool(batch_atlas.variant_files(BATCH_DIR, region["name"]))
        except Exception:  # noqa: BLE001 — missing dir / odd name → no variant
            return False

    def _seed_refs_into_outputs(self, m: dict, names: list[str] | None = None,
                                only_empty: bool = True) -> dict:
        """Bulk: bind each region's reference image as its atlas tile.
        Skips regions not in `names` (when given), regions that already have
        an image (when only_empty), and regions with no usable ref. Does NOT
        save — the caller persists once. Returns counts + the seeded names."""
        # Hydrate the lazy variant pile ONCE before the only_empty check below:
        # batch/ is excluded from the startup pull, so right after a manifest
        # switch (when auto-seed fires) the variant PNGs may not be on local
        # disk yet. Without this, _region_has_output wrongly returns False and
        # the seed would overwrite an existing generated variant. Idempotent.
        project_paths.ensure_lazy("batch/")
        want = set(names) if names else None
        seeded: list[str] = []
        skipped_existing = 0
        noref = 0  # region genuinely has no reference image
        bad = 0    # ref present but unopenable (decode/format failure)
        for region in all_regions(m):
            nm = region.get("name", "")
            if want is not None and nm not in want:
                continue
            if only_empty and self._region_has_output(region):
                skipped_existing += 1
                continue
            ok, reason = self._bind_ref_as_output(m, region)
            if ok:
                seeded.append(nm)
            elif reason == "noref":
                noref += 1
            else:  # ref existed but could not be decoded
                bad += 1
        return {"seeded": len(seeded), "skipped_existing": skipped_existing,
                "noref": noref, "bad": bad, "names": seeded}

    def _userefimg(self, payload: dict) -> str:
        """Bind a region's CURRENT reference image (the one shown in the ref
        figure: shape_ref, else style_ref / atlas slice) as that region's
        atlas tile (output_override) — verbatim, no AI, no RMBG. Snapshots
        it to refs/useroutput_<name>.png so later ref changes don't alter a
        committed tile and ✕ revert restores generation."""
        name = payload.get("name", "")
        if not name:
            return _diag("REGION_NOT_FOUND", name=name)
        m = load_manifest()
        region = next((r for r in all_regions(m) if r["name"] == name), None)
        if region is None:
            return _diag("REGION_NOT_FOUND", name=name)
        ok, reason = self._bind_ref_as_output(m, region)
        if not ok:
            if reason == "noref":
                return _diag("NO_REFERENCE_IMAGE", name=name)
            return _diag("SOURCE_IMAGE_INVALID", err=reason)
        save_manifest(m)
        return (f"{name}: using its reference image ({reason}) as the "
                f"atlas tile — not processed. Create Atlas to apply; "
                f"✕ revert to generate again.")

    def _userefall(self, payload: dict) -> str:
        """Bulk "Copy all refs → generated": seed every EMPTY region's atlas
        tile from its reference image. Never overwrites a region that already
        has a generated/committed image. One save_manifest for the whole op."""
        m = load_manifest()
        names = payload.get("names") or None
        res = self._seed_refs_into_outputs(m, names=names, only_empty=True)
        if res["seeded"]:
            save_manifest(m)
        parts = [f"Seeded {res['seeded']} empty region(s) from their reference"]
        if res["skipped_existing"]:
            parts.append(f"{res['skipped_existing']} already had an image")
        if res["noref"]:
            parts.append(f"{res['noref']} had no ref")
        if res.get("bad"):
            parts.append(f"{res['bad']} had an unreadable ref")
        return " · ".join(parts)

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
            _unmirror(INPUT_DIR / f"refs/useroutput_{name}.png")  # drop the stale R2 image too
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
            return _diag("NOTHING_TO_PASTE")
        m = load_manifest()
        srcr = next((r for b in ("regions", "rotated_regions")
                     for r in m.get(b, []) if r.get("name") == src), None)
        if srcr is None:
            return _diag("NOTHING_TO_PASTE")
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
            return _diag("HALO_BAD_SUFFIX", name=name)
        project_paths.ensure_lazy("batch/")  # variant pile hydrates on demand
        base_name = name[: -len(suf)]
        m = load_manifest()
        regions = all_regions(m)
        base = next((r for r in regions if r["name"] == base_name), None)
        if base is None:
            return _diag("NO_BASE_REGION", name=name, base_name=base_name)
        src = (batch_atlas.override_image_path(base)
               or batch_atlas._pick_variant_png(BATCH_DIR, base))
        if not src or not src.exists():
            return _diag("NO_REFERENCE_IMAGE", name=base_name)
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
            return _diag("GLOW_FAILED", err=f"{type(e).__name__}: {e}")
        (INPUT_DIR / "refs").mkdir(parents=True, exist_ok=True)
        rel = f"refs/useroutput_{name}.png"
        img.save(INPUT_DIR / rel)
        r = self._ensure_region(m, name)
        if r is None:
            return _diag("REGION_NOT_FOUND", name=name)
        r["output_override"] = rel
        r["shine"] = params  # remember settings for next time / re-runs
        save_manifest(m)
        return (f"{name}: glow from '{base_name}' ({src.name}) — "
                f"color {params['color']}, blur {params['blur']}, "
                f"amount {params['intensity']}, layers {params['layers']}. "
                f"Create Atlas to apply; ✕ revert to undo.")

    def _fx_source(self, m: dict, name: str) -> Path | None:
        """Thin delegate to the module-level fx_source (shared with the
        automated rebuild). See fx_source for the resolution order."""
        return fx_source(m, name)

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
        """Build a region locally (shine/shadow/colour/glow/blur/zoom) from
        its source, bind the result as output_override, and persist the params
        under region['fx'][mode]. No ComfyUI / no credits. A manual build
        ALWAYS runs (ignores the auto-rebuild toggle) and shares the build core
        with the automated rebuild via build_fx_region."""
        name = payload.get("name", "")
        mode = str(payload.get("mode", "")).strip().lower()
        if mode not in shine.FX_PRESETS:
            return _diag("FX_BUILD_FAILED", mode=mode or "?",
                         err=f"unknown FX mode '{mode}'")
        m = load_manifest()
        ok, msg = build_fx_region(m, name, mode, payload)
        if ok:
            save_manifest(m)
        return msg

    def _saveconfig(self, edits: dict) -> str:
        cfg = load_config()
        # Did the Session dropdown switch the ACTIVE manifest? (compare against
        # the value BEFORE we apply edits). Used to auto-seed sheet-derived
        # manifests from their refs on activation — see below.
        _prev_mp = cfg.get("manifest_path", "")
        _new_mp = str(edits.get("manifest_path", _prev_mp)).strip()
        _switched_manifest = bool(_new_mp) and _new_mp != _prev_mp
        if _switched_manifest:
            # Staging hydrates from R2 once per process, but the Sheet Maker
            # re-exports to the same fixed keys while we run — pull the NEWLY
            # selected manifest (+ its bound .atlas geometry) by exact key
            # BEFORE anything loads (and the auto-seed below possibly SAVES)
            # it, so a stale staged copy can never overwrite a fresh export.
            _refresh_manifest_from_r2(_new_mp)
        m = load_manifest()
        settings = m.get("settings") or {}
        atlas = m.setdefault("atlas", {})
        numeric = {k for k, _, t in CONFIG_FIELDS if t == "number"}
        # Only persist the (still-active = PREVIOUS) manifest when this request
        # actually wrote a manifest-backed field. A pure Session-dropdown switch
        # POSTs only {manifest_path} (a config field) — unconditionally saving
        # here pushed a possibly-stale previous manifest back to R2 on every
        # switch. Settings-panel saves (which post the manifest-bound fields)
        # still persist as before.
        manifest_dirty = False

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
                    manifest_dirty = True
                elif k in m:
                    m.pop(k)
                    manifest_dirty = True
            elif k in _ATLAS_GEOM_KEYS:
                sv = str(v).strip()
                if sv == "":
                    continue  # never wipe required atlas geometry
                mk = _ATLAS_GEOM_KEYS[k]
                atlas[mk] = int(float(sv)) if k in _ATLAS_GEOM_NUMERIC else sv
                manifest_dirty = True
            elif k in PER_ATLAS_KEYS:
                sv = str(v).strip()
                if sv == "":
                    if k in settings:            # blank => inherit global
                        settings.pop(k)
                        manifest_dirty = True
                else:
                    settings[k] = _num(v) if k in numeric else v
                    manifest_dirty = True
            else:
                cfg[k] = _num(v) if k in numeric else v

        if settings:
            m["settings"] = settings
        else:
            m.pop("settings", None)
        if manifest_dirty:
            save_manifest(m)
        save_config(cfg)
        # Auto-seed on ACTIVATION (not on every render): when the Session
        # dropdown switches to a sheet-derived manifest (Sheet Maker stamps a
        # truthy `export_prefix`), fill its EMPTY atlas tiles from each
        # region's reference image. load_manifest now resolves to the newly
        # active file (config was just saved) — and that file was just exact-key
        # refreshed from R2 above, so the seed's save_manifest writes back FRESH
        # data; only_empty never overwrites an existing image, and we only save
        # when something was actually seeded.
        if _switched_manifest:
            try:
                nm = load_manifest()
                if bool(nm.get("export_prefix")):
                    res = self._seed_refs_into_outputs(nm, only_empty=True)
                    if res["seeded"]:
                        save_manifest(nm)
            except Exception:  # noqa: BLE001 — a seed hiccup must not 500 a save
                pass
        return "Settings saved (per-atlas overrides + globals)"


def main():
    from iw_banner import print_banner
    print_banner("Atlas Maker", BUILD,
                 footer=f"http://{HOST}:{PORT}   ·   Ctrl+C to stop")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
