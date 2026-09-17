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
import contextlib
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
import traceback
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image, ImageChops

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cloud_paths as project_paths  # noqa: E402
import atlas_format  # noqa: E402
import atlas_writers  # noqa: E402  (TexturePacker JSON for game-loadable deploy)
import batch_atlas  # noqa: E402  (reuse the geometry resolver — single source)
import blueprints  # noqa: E402  (shared, data-driven ComfyUI pipeline library)
import comfy_catalog  # noqa: E402  (model lists that survive a dead/serverless ComfyUI)
import shine  # noqa: E402  (local *_shine derivation, no ComfyUI)
import pack  # noqa: E402  (MaxRects bin packer for from-scratch auto-pack atlases)
import runpod_control  # noqa: E402  (RunPod on-demand pod resume/idle-stop)
import video_runner  # noqa: E402  (Flipbook video sessions — blueprint -> animated WEBP)
import video_to_clip  # noqa: E402  (Flipbook video -> packed sheet -> clip frames)
import video_to_refs  # noqa: E402  (Flipbook video -> Atlas Maker reference images)
import model_mirror  # noqa: E402  (R2 model mirror — where a declared model file lives)

# Self-contained tool folder (Tools/<Tool Name>/). All code, config and
# manifests live here together; per-game ComfyUI dirs come from project_paths.
import storage  # noqa: E402  (R2 object storage + staging mirror)
import shared_taxonomy  # noqa: E402  (the one semantic taxonomy every render injects)
from iw_common.diagnostics import canonical, diag, parse_diag_line  # noqa: E402
from iw_common.splash import splash_html  # noqa: E402  (shared CRT boot splash)
from iw_common import imgcache  # noqa: E402  (disk thumb cache + ETag/304 helpers)
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
    for R2_PREFIX). `.get()`-style miss returns ''."""

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
    # No phantom default manifest name: a fresh project owns no `atlas_manifest_
    # symbols*.json`, so seeding one made the slice / settings panel target a
    # file the project doesn't have. Blank → active_manifest_name() resolves to
    # the project's first real manifest (matching the Session dropdown).
    "manifest_path": "",
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
                 "total": 0, "diagnostics": [], "started": 0.0,
                 "runpodJob": ""}
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
    ("run_on", "Run generation on", "text"),
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
    "ipadapter_weight_type": ("IPAdapterAdvanced", "weight_type"),
}

# Fields whose valid values are a FIXED enum — knowable with no network at all,
# unlike MODEL_FIELDS (which list whatever files an install happens to have).
# This is a FLOOR, never an override: `_options_for` tries live /object_info,
# then the persisted catalog, and only then this seed. So a ComfyUI that offers
# a sampler we've never heard of still wins, and a value the user already has
# configured is preserved either way (see `_opt_html`).
#
# Some of these have no ComfyUI enum behind them at all: `gpt_image_size`'s
# `match_ref` and `gpt_image_rembg` are OUR options (read by the gpt_image
# builder), and `atlas_format` is a manifest tag. Those are seed-only by nature.
ENUM_FIELDS: dict[str, list[str]] = {
    "flux_weight_dtype": ["default", "fp8_e4m3fn", "fp8_e4m3fn_fast",
                          "fp8_e5m2"],
    "flux_sampler": [
        "euler", "euler_cfg_pp", "euler_ancestral", "euler_ancestral_cfg_pp",
        "heun", "heunpp2", "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast",
        "dpm_adaptive", "dpmpp_2s_ancestral", "dpmpp_2s_ancestral_cfg_pp",
        "dpmpp_sde", "dpmpp_sde_gpu", "dpmpp_2m", "dpmpp_2m_cfg_pp",
        "dpmpp_2m_sde", "dpmpp_2m_sde_gpu", "dpmpp_3m_sde", "dpmpp_3m_sde_gpu",
        "ddpm", "lcm", "ipndm", "ipndm_v", "deis", "res_multistep",
        "res_multistep_cfg_pp", "gradient_estimation", "ddim", "uni_pc",
        "uni_pc_bh2"],
    "flux_scheduler": ["simple", "sgm_uniform", "karras", "exponential",
                       "ddim_uniform", "beta", "normal", "linear_quadratic",
                       "kl_optimal"],
    "ipadapter_weight_type": [
        "linear", "ease in", "ease out", "ease in-out", "reverse in-out",
        "weak input", "weak output", "weak middle", "strong middle",
        "style transfer", "composition", "strong style transfer",
        "style and composition", "style transfer precise",
        "composition precise"],
    "gpt_image_model": ["gpt-image-1", "gpt-image-1.5", "gpt-image-2"],
    "gpt_image_size": ["match_ref", "auto", "1024x1024", "1024x1536",
                       "1536x1024", "2048x2048", "2048x1152", "1152x2048",
                       "3840x2160", "2160x3840"],
    "gpt_image_quality": ["low", "medium", "high"],
    "gpt_image_background": ["opaque", "auto", "transparent"],
    "gpt_image_rembg": ["true", "false"],
    "atlas_format": ["RGBA8888", "RGBA4444", "RGB888", "RGB565"],
}

# Which pipeline a field belongs to (controls show/hide). Anything not listed
# is "both" = the two local ComfyUI pipelines (sdxl OR flux), hidden under
# gpt_image. "all" = every pipeline incl. gpt_image (truly universal fields).
PIPE_GROUP = {
    "pipeline": "all", "run_on": "all", "padding_pct": "all",
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

# Where a render runs — the ⚙ "Run generation on" setting. Blank = whatever the
# service env says (`COMFY_TRANSPORT`; production = serverless = pod), so an
# untouched config keeps today's behaviour. The render subprocess reads its
# transport from the env (`batch_atlas.COMFY_TRANSPORT`), which is why the
# choice is applied as an env override rather than a new code path — the same
# seam per-user routing already uses (`resolve_user_comfy_env`). The model
# dropdowns follow the same choice (`comfy_catalog` keeps one catalog per
# target), because the list must be the files of the machine that will load them.
RUN_ON_OPTIONS = {
    "pod": "RunPod — cloud GPU (serverless endpoint)",
    "local": "My computer — my own ComfyUI over the tunnel",
}
RUN_ON_TRANSPORT = {"pod": "serverless", "local": "http"}


def _env_run_on() -> str:
    """The service default a blank setting resolves to."""
    tr = (os.environ.get("COMFY_TRANSPORT") or "http").strip().lower()
    return "pod" if tr == "serverless" else "local"


def effective_run_on(cfg: dict | None = None) -> str:
    val = str((cfg if cfg is not None else load_config()).get("run_on")
              or "").strip().lower()
    return val if val in RUN_ON_OPTIONS else _env_run_on()


def run_on_env(target: str) -> dict:
    """The env override the render subprocess needs to run on `target`."""
    return {"COMFY_TRANSPORT": RUN_ON_TRANSPORT.get(target,
                                                    RUN_ON_TRANSPORT[_env_run_on()])}


def _run_on_options_html(cur: str) -> str:
    """<option>s for the run_on <select>: the blank service default (named, so
    the user can see what blank means), then the two targets. An unknown
    stored value is kept selectable so saving never silently rewrites it."""
    default_lbl = RUN_ON_OPTIONS[_env_run_on()]
    out = [f'<option value=""{" selected" if cur == "" else ""}>'
           f'(service default: {html.escape(default_lbl)})</option>']
    if cur and cur not in RUN_ON_OPTIONS:
        out.append(f'<option value="{html.escape(cur, quote=True)}" selected>'
                   f'{html.escape(cur)} (custom)</option>')
    for v, lbl in RUN_ON_OPTIONS.items():
        sel = " selected" if v == cur else ""
        out.append(f'<option value="{v}"{sel}>{html.escape(lbl)}</option>')
    return "".join(out)

# Free-text PATH fields that get a 📁 browse button (server-side file
# picker). Model fields stay ComfyUI-driven dropdowns; these are real
# filesystem paths (also accept a UNC \\server\share path or an http URL).
FILE_FIELDS = {"mockup_image", "atlas_source_image", "atlas_file"}
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif",
               ".tga", ".tif", ".tiff", ".avif"}

# Subset of CONFIG_FIELDS that can be overridden per-atlas. Stored in the
# active manifest's "settings" block; atlas_config.json keeps the shared
# default (shown as the input placeholder; blank input = inherit global).
# Everything else (mockup_image, manifest_path, project) stays
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
    ("atlas_layout", "Layout", "text", "layout"),
    ("atlas_width", "Atlas width", "number", "width"),
    ("atlas_height", "Atlas height", "number", "height"),
    ("atlas_cell_width", "Default cell width", "number", "cell_width"),
    ("atlas_cell_height", "Default cell height", "number", "cell_height"),
    ("atlas_format", "Atlas format", "text", "format"),
    ("atlas_source_image", "Atlas source image", "text", "source_image"),
    ("atlas_pack_trim", "Frame trim", "text", "pack_trim"),
]
_ATLAS_GEOM_KEYS = {ui: mk for ui, _, _, mk in ATLAS_GEOM_FIELDS}
_ATLAS_GEOM_NUMERIC = {"atlas_width", "atlas_height",
                       "atlas_cell_width", "atlas_cell_height"}

# The `atlas.layout` choices the 🧩 Atlas settings panel offers, and how each
# one reads. The KEYS are `batch_atlas.FROM_SCRATCH_LAYOUTS` — the layouts this
# tool lays out ITSELF — because those are exactly the ones it is safe to move
# between (see `atlas_geom_fields_for`). Stated once, pinned by a fixture, so a
# layout added there can never quietly become unofferable here.
ATLAS_LAYOUT_MODES = {
    "pack": "Pack the art (the tool sizes the page)",
    "grid": "Grid of cells (your atlas + cell size are used as they are)",
}

# The THIRD choice, offered only to an atlas whose geometry was authored outside
# this tool — no `layout` and no `.atlas`, but real rects from an exporter or by
# hand (`batch_atlas.can_choose_layout`). It is neither `pack` nor `grid`, and
# the dropdown must not pretend otherwise: without it the row would open showing
# "Pack the art" for such an atlas, and one Save would hand its authored rects to
# the packer to re-measure. That is worse than having no row at all.
#
# ITS VALUE IS BLANK, ON PURPOSE. `_ATLAS_GEOM_KEYS` SKIPS a blank value on save
# ("never wipe required atlas geometry"), so picking it writes nothing and clears
# nothing — a true no-op. This DELIBERATELY reverses the "no blank option" rule
# that `atlas_pack_trim` and the two real layouts follow, and for the opposite
# reason: there a blank would LOOK changeable while doing nothing, here "does
# nothing" is exactly the honest meaning of "leave the authored geometry alone".
# Do not "fix" this back to a named value.
ATLAS_LAYOUT_AUTHORED = ""
ATLAS_LAYOUT_AUTHORED_LABEL = "Authored geometry (leave as is)"

# Which layout each geometry row is ALIVE in — the exact parallel of PIPE_GROUP,
# and driven client-side by the same mechanism (`data-layout`/`applyAtlasLayout`
# is `data-pipe`/`applyPipe`, reused).
#   both        -> the row means something under either layout (the default)
#   pack | grid -> ONLY under that one; under the other NOTHING reads it
# Measured, not guessed:
#   · `cell_width`/`cell_height` ARE the grid. Under `pack` nothing reads them:
#     the packer stamps an explicit w/h onto every region, so `region_box`'s
#     cell fallback never fires.
#   · `pack_trim` is NOT IN HERE, and used to be (#719, wrongly: `grid`). It is
#     read twice — `auto_pack_layout` measures with it, and
#     `batch_atlas.fit_to_region` PLACES with it on every from-scratch atlas,
#     which is both layouts. Hiding it under `grid` took away the author's only
#     say over cropping while the cropping went on happening, one function
#     along: a grid cell whose aspect differs from the art's, or which is bigger
#     than it, re-centres every frame on its own ink. "Only `auto_pack_layout`
#     calls `pack_trim_mode`" was true and was not the question.
# A dead field that looks live is what cost the owner an atlas: 2048x2048 typed
# into Atlas width/height on a `pack` atlas, saved, then overwritten by the
# packer's 1028x25652 on the next Create Atlas. A LIVE field that was hidden for
# looking dead is the same fault from the other side, and cost him the control.
ATLAS_GEOM_LAYOUT_GROUP = {
    "atlas_cell_width": "grid",
    "atlas_cell_height": "grid",
}
ATLAS_GEOM_LAYOUT_BOTH = "both"

# The rows the layout OWNS rather than reads: under this layout the field is
# derived OUTPUT (`auto_pack_layout` writes `atlas.width/height` from the art),
# so it renders read-only instead of accepting input it would discard. The page
# size stays on screen because it is genuinely diagnostic — only the editable
# box goes. READONLY, NEVER DISABLED: a readonly input still posts its value,
# so `cfgData()` round-trips it and a hidden/locked field can never be wiped.
ATLAS_GEOM_READONLY_IN = {"atlas_width": "pack", "atlas_height": "pack"}
ATLAS_GEOM_READONLY_NOTE = "set by the packer from your art"


def atlas_geom_fields_for(m: dict) -> list[tuple[str, str, str, str]]:
    """The geometry rows 🧩 Atlas settings renders for THIS manifest.

    All of ATLAS_GEOM_FIELDS except `atlas_layout`, which is withheld from an
    atlas BOUND to a `.atlas` (`batch_atlas.can_choose_layout`). THAT GATE IS
    THE SAFETY PROPERTY OF THE WHOLE SWITCH: the bound file is the authoritative
    region map, so handing it to the packer would re-measure the ART, re-pack it
    and OVERWRITE `atlas.width/height` — the `.atlas` on disk would no longer
    describe the page, and there is no undo.

    IT IS NOT GATED ON `is_from_scratch`, which is what #717 shipped and what
    blocked the owner. "No `layout`" is not "bound": the legacy /
    authored-geometry manifests (real rects, an `offX/offY/origW/origH` trim, a
    `texturepacker_json`, and no `.atlas` anywhere) also have no `layout`, so
    that gate withheld the dropdown from precisely the atlases that had no
    layout to show in it — the only ones that needed it. They get the row, with
    a third `ATLAS_LAYOUT_AUTHORED` choice selected so it opens saying what they
    actually are rather than "Pack the art"; moving off it is destructive and
    `switch_atlas_layout`'s reply says so.

    Module-level and pure so the fixtures exercise the gate that ships."""
    return [f for f in ATLAS_GEOM_FIELDS
            if f[0] != "atlas_layout" or batch_atlas.can_choose_layout(m)]


def layout_row_visible(group: str, layout: str) -> bool:
    """Is a geometry row with this `data-layout` group shown under `layout`?

    The Python twin of the page's `layoutVisible(g,L)` — the server renders the
    first state and the browser re-applies it on every dropdown change, so the
    two must agree or the panel changes shape the moment JS runs."""
    return group in ("", ATLAS_GEOM_LAYOUT_BOTH) or group == layout


def atlas_geom_rows_html(m: dict, cfg: dict,
                         cache: dict | None = None) -> list[str]:
    """The 🧩 Atlas settings geometry rows for THIS manifest — one <label> each.

    A from-scratch atlas gets its rows LAYOUT-AWARE (see
    ATLAS_GEOM_LAYOUT_GROUP / ATLAS_GEOM_READONLY_IN): the rows that are dead
    under the chosen layout are hidden, and Atlas width/height render read-only
    under `pack`, where the packer writes them.

    Rendered hidden, NOT omitted. `cfgData()` walks `[data-cfg]` and reads
    `.value`, which a `display:none` input still has — so the panel keeps
    posting a hidden row's stored value and pack→grid→pack cannot lose the cell
    size or the trim choice the author set. Omitting the markup would also make
    the live toggle impossible: switching to Grid must REVEAL the cell fields
    you then have to fill, and there is nothing to reveal if the server left
    them out.

    A `.atlas`-bound / legacy cell-grid manifest has no layout to be aware OF
    (`is_from_scratch` is False) and its cell size is live —
    `batch_atlas.region_box` really does fall back to it — so it gets none of
    this and renders exactly as before. That is decided by `is_from_scratch`,
    NOT by whether the Layout row is offered: a legacy atlas now gets the row
    (`atlas_geom_fields_for`) while still rendering every other row plain, which
    is right — until it has a layout there is nothing to hide or lock, and the
    page's `applyAtlasLayout` finds no `data-layout` rows to toggle. The rows
    become aware on the reload after the switch is saved.

    Module-level and pure so the fixtures render what ships."""
    cache = {} if cache is None else cache
    matlas = m.get("atlas") or {}
    aware = batch_atlas.is_from_scratch(m)
    layout = batch_atlas.atlas_layout(m) if aware else ""
    rows: list[str] = []
    for ui_key, label, typ, mk in atlas_geom_fields_for(m):
        step = " step=any" if typ == "number" else ""
        tip = help_for(ui_key, cfg)
        tip_esc = html.escape(tip, quote=True)
        qm = (f'<span class="qm" title="{tip_esc}">&#9432;</span>'
              if tip else "")
        group = ATLAS_GEOM_LAYOUT_GROUP.get(
            ui_key, ATLAS_GEOM_LAYOUT_BOTH) if aware else ""
        ro_in = ATLAS_GEOM_READONLY_IN.get(ui_key, "") if aware else ""
        # Through _control_html so these get the same treatment as every
        # other setting: atlas_format becomes its enum <select>, the two
        # path fields keep their 📁 browse button.
        ctl = _control_html(ui_key, typ, matlas.get(mk, ""), cache,
                            title=tip_esc, step=step,
                            readonly=bool(ro_in) and ro_in == layout)
        attrs = ""
        if group:
            attrs += f' data-layout="{group}"'
            if not layout_row_visible(group, layout):
                attrs += ' style="display:none"'
        note = ""
        if ro_in:
            attrs += f' data-ro-layout="{ro_in}"'
            hide = "" if ro_in == layout else ' style="display:none"'
            note = (f'<span class="rohint"{hide}>· '
                    f'{html.escape(ATLAS_GEOM_READONLY_NOTE)}</span>')
        rows.append(
            f'<label{attrs}><span class="lblrow">{html.escape(label)} '
            f'<span style="color:#888;font-size:10px">· this atlas</span>'
            f'{qm}</span>{ctl}{note}</label>'
        )
    return rows


# Plain-language explanation for every Settings field. {lora}/{ckpt}/{cn}/
# {rmbg} are filled with the current values so the tip names the actual model
# in use (e.g. "follows the LoRA 'gameIconInstitute3d_v10' more closely").
SETTING_HELP = {
    "run_on":
        "Which machine renders your regions. RunPod = the cloud GPU (the "
        "serverless endpoint — pay per job, nothing to start; needs the models "
        "installed on the pod volume). My computer = your own ComfyUI on your "
        "GPU, reached over the tunnel the desktop launcher runs — your "
        "installed models, no per-job cost. The model dropdowns below follow "
        "this choice. Blank = the service default.",
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
        "Full atlas canvas width in pixels. Layout = Grid of cells: yours — "
        "read as you set it and never overwritten. Layout = Pack the art: the "
        "packer's OUTPUT, so it is shown read-only — Create Atlas measures "
        "your art and writes the page size it chose. When a .atlas is bound "
        "this is read from that file and ignored here.",
    "atlas_height":
        "Full atlas canvas height in pixels. Layout = Grid of cells: yours — "
        "read as you set it and never overwritten. Layout = Pack the art: the "
        "packer's OUTPUT, so it is shown read-only — Create Atlas measures "
        "your art and writes the page size it chose. When a .atlas is bound "
        "this is read from that file and ignored here.",
    "atlas_cell_width":
        "The width of the cell every region is laid into under Layout = Grid "
        "of cells — the grid IS this size, so changing it re-flows the whole "
        "page on the next Create Atlas. Hidden under Layout = Pack the art, "
        "where nothing reads it: packing gives every region its own explicit "
        "size. Also the fallback slot width for a legacy cell-grid manifest "
        "(no .atlas bound) whose regions carry no geometry.",
    "atlas_cell_height":
        "The height of the cell every region is laid into under Layout = Grid "
        "of cells — the grid IS this size, so changing it re-flows the whole "
        "page on the next Create Atlas. Hidden under Layout = Pack the art, "
        "where nothing reads it: packing gives every region its own explicit "
        "size. Also the fallback slot height for a legacy cell-grid manifest "
        "(no .atlas bound) whose regions carry no geometry.",
    "atlas_format":
        "Pixel format tag stored in the manifest (e.g. RGBA). Informational; "
        "does not change generation.",
    "atlas_layout":
        "Who decides where every region sits — and which size fields below are "
        "yours. The other fields follow this choice the moment you change it: "
        "anything the chosen layout does not read is hidden or locked, so no "
        "box here can take a number and quietly discard it. Pack the art = the "
        "tool measures what you generated, packs it as tightly as it can, and "
        "OVERWRITES Atlas "
        "width/height with the page it chose — so those two show read-only, "
        "and Default cell width/height disappear (packing gives every region "
        "its own size). Grid of cells = your Atlas width/height and Default "
        "cell width/height are READ and never overwritten; the regions flow "
        "through that grid in manifest order (left to right, then down), and it "
        "re-flows on every Create Atlas — change a cell size, press Create "
        "Atlas, every frame moves. Frame trim stays on screen: it decides "
        "whether your art is cropped to its ink before it goes in the cell, "
        "under this layout too. Grid is the one for a flipbook/animation, "
        "where the frames must share one cell. Switching CLEARS every region's "
        "current rect (it belongs to the layout you are leaving); the next "
        "Create Atlas lays them all out again. Authored geometry (leave as is) "
        "= this atlas's rects were made somewhere else — an export, or by hand "
        "— and nothing here touches them; it is what an atlas with no layout "
        "already is, so choosing it saves nothing and changes nothing. Moving "
        "OFF it is the one switch you cannot undo: those rects and their trim "
        "are discarded and re-derived from your art, and this tool has no copy "
        "of them. Not shown at all for an atlas bound to a .atlas — that file "
        "is its geometry, and it keeps it.",
    "atlas_pack_trim":
        "Whether Create Atlas cuts the transparent edges off your art before "
        "placing it. Works under BOTH layouts. Keep the whole frame (the "
        "default) = the image goes in exactly as you made it, edges and all, "
        "so every frame drawn on the same canvas is scaled and positioned the "
        "same way — that is what keeps an ANIMATION registered, with the "
        "character moving the way it was drawn instead of drifting "
        "up/down/left/right. Crop each frame to its visible pixels = each "
        "frame is cut down to its own ink first, then placed on its own. Under "
        "Pack the art that gives the smallest page, which is what you want for "
        "symbols, placed one at a time. Under Grid of cells it makes each "
        "frame fill its cell on its own terms, so the art jumps between "
        "frames. Changing this takes effect on the next Create Atlas.",
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


def _opt_html(values, current: str, blank_label: str = "",
              unknown_marker: str = "(not in ComfyUI)") -> str:
    """Build <option>s. A blank choice is always available when blank_label
    is given (so any model dropdown can be cleared). A non-empty current
    value the list doesn't carry is preserved (marked with `unknown_marker`)
    so saving never silently changes it — "(not in ComfyUI)" for an installed-
    file list, "(custom)" for a static enum, where ComfyUI was never asked."""
    out = []
    vals = [str(v) for v in values]
    if blank_label:
        sel = " selected" if current == "" else ""
        out.append(f'<option value=""{sel}>{html.escape(blank_label)}</option>')
    if current and current not in vals:
        marker = f" {unknown_marker}" if unknown_marker else ""
        out.append(f'<option value="{html.escape(current, quote=True)}" '
                    f'selected>{html.escape(current)}{marker}</option>')
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
        # IMAGE blueprints only — this is the Atlas Maker's pipeline picker, and a
        # video network selected here would generate nothing usable.
        bps = blueprints.list_blueprints(kind="image")
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


def _models_note(models: list, dropped: list) -> str:
    """One human sentence about a blueprint's derived `models[]`, appended to the
    upload/rescan reply. Names the files rather than counting them: the whole
    point of declaring models is that somebody can SEE which ones a graph will
    ask the target machine for, and "5 models" tells nobody whether the fp8 UNet
    is among them. A dropped entry (in the old manifest, no longer in the graph)
    is called out too, so a removal is never silent."""
    if not models and not dropped:
        return " Declares no models (nothing in the graph names a model file)."
    parts = []
    if models:
        names = ", ".join(str(m.get("filename", "?")) for m in models)
        parts.append(f" Declares {len(models)} model(s): {names}.")
    if dropped:
        gone = ", ".join(str(m.get("filename", "?")) for m in dropped)
        parts.append(f" Dropped {len(dropped)} no longer in the graph: {gone}.")
    return "".join(parts)


def _annotate_from_mirror(models: list, author: str | None) -> tuple[list, str]:
    """Stamp `r2_key`/`sha256`/`size` onto the declarations the shared model
    mirror can place, and return them plus one sentence for the reply.

    Best-effort by construction — it returns `models` untouched and says why on
    every failure, because an annotation is a convenience and a blueprint write
    is not. Three guards:

      * a BUNDLED blueprint (`author: iw-builtin`) is never annotated.
        `blueprints._sync_bundled` restores the repo copy over R2 AND staging
        whenever a bundled manifest's bytes differ, and both writers call
        `hydrate(force=True)` right after their own put — so annotating one
        writes bytes the very next hydrate reverts, and the tool would report
        success while behaving as if it had failed. `wan22_i2v_flipbook` is the
        live case: bundled, rescannable, and declaring real multi-GB models.
      * an index that is not 'ready' writes nothing. Persisting an empty
        annotation because R2 hiccuped would strip provenance and keep it
        stripped.
      * any exception at all is a skip, never a failed save.
    """
    if not models:
        return models, ""
    if str(author or "").strip() == blueprints.BUNDLED_AUTHOR:
        return models, (" Model-mirror keys not written: this is a bundled "
                        "blueprint, and the next hydrate restores the repo copy "
                        "over anything written here.")
    try:
        index = model_mirror.load_index()
        if index.get("state") != "ready":
            return models, (" Model-mirror keys not written: the mirror is "
                            f"{index.get('state')} ({index.get('reason')}).")
        annotated, changed = model_mirror.annotate(models, index)
        misses = [str(m.get("filename") or "?") for m in annotated
                  if model_mirror.resolve(m, index).get("state") != "hit"]
    except Exception as e:  # noqa: BLE001 — never turn a lookup into a failed save
        return models, f" Model-mirror keys not written ({e})."
    hits = len(annotated) - len(misses)
    note = f" {hits} of {len(annotated)} resolve in the model mirror"
    if misses:
        verb = "does" if len(misses) == 1 else "do"
        note += f"; {', '.join(misses)} {verb} not."
    else:
        note += "."
    if changed:
        note += f" Wrote keys for {changed}."
    return annotated, note


def _options_for(key: str, cache: dict,
                 target: str = "local") -> tuple[list[str] | None, str]:
    """Dropdown values for a settings field, plus the marker `_opt_html` should
    put on a configured value the list doesn't carry.

    Precedence — live `/object_info` > the persisted catalog > the static enum
    seed. `comfy_catalog.options` owns the first two (for the "pod" target there
    is no live tier — see that module); the seed is a floor so the enum fields
    stay dropdowns even when NOTHING has ever answered. `cache` is the
    per-render (node, field) memo, so a page does at most one alive-probe."""
    nf = MODEL_FIELDS.get(key)
    if nf is not None:
        if nf not in cache:
            try:
                cache[nf] = comfy_catalog.options(nf[0], nf[1], target=target)
            except Exception:  # noqa: BLE001 — UI must render even if Comfy down
                cache[nf] = None
        avail = cache[nf]
        if avail:
            return list(avail), "(not in ComfyUI)"
    seed = ENUM_FIELDS.get(key)
    if seed:
        return list(seed), "(custom)"
    return None, ""


def _rel_time(epoch: float) -> str:
    """'4 minutes ago' — a catalog's age matters more than its timestamp."""
    if epoch <= 0:
        return "at an unknown time"
    secs = max(0, int(time.time() - epoch))
    for span, unit in ((86400, "day"), (3600, "hour"), (60, "minute")):
        if secs >= span:
            n = secs // span
            return f"{n} {unit}{'s' if n != 1 else ''} ago"
    return "just now"


# Hosts that are unmistakably NOT "my computer". `COMFY_URL` is documented as
# the Cloudflare tunnel to the user's own ComfyUI — `iw_common.comfy.comfy_url`
# literally says "the full ComfyUI tunnel base URL" — but nothing enforces it,
# and it was at some point pointed at a RunPod pod. "My computer" then silently
# addressed a machine in a data centre, and the panel said "your ComfyUI has
# never answered at https://<pod>-8188.proxy.runpod.net": true, and baffling.
_REMOTE_HOST_MARKERS = (".proxy.runpod.net", "runpod.ai", "runpod.io")


def local_target_misconfigured(url: str) -> str:
    """Why `url` cannot be the user's own machine, or "" if it's plausible.

    Checked BEFORE reachability: a running pod at that address would answer
    happily and render on the wrong machine, which is worse than not answering
    at all."""
    host = (urllib.parse.urlparse(url or "").hostname or "").lower()
    if any(marker in host for marker in _REMOTE_HOST_MARKERS):
        return (f"{url} is a RunPod machine, not your computer. Set COMFY_URL "
                "on the atlas-tool service to your tunnel "
                "(https://comfy.invisiblewall.org), or choose RunPod above.")
    return ""


def _model_status_html(target: str = "local") -> str:
    """The Settings panel's "where did these dropdowns come from" strip, for
    the machine the render will run on.

    The failure this exists for is SILENT: with nothing answering at
    COMFY_BASE, every model field used to fall back to a plain text input with
    no explanation, so a stale or mistyped checkpoint name only surfaced as a
    failed render half an hour later."""
    try:
        st = comfy_catalog.status(target)
    except Exception:  # noqa: BLE001 — the panel renders regardless
        st = {"live": False, "cached": False, "source": "", "fetchedAt": 0.0}
    btn = ('<button type="button" class="alt" onclick="refreshModels(this)" '
           'title="Re-probe the selected machine for its installed model lists '
           'and store them, so these dropdowns keep working when nothing is '
           'answering">⟳ Refresh model lists</button>'
           '<span id="mdlstatmsg" style="color:#999"></span>')
    pod = target == "pod"
    lead = f'<b>{"RunPod" if pod else "My computer"}</b> · '
    base = html.escape(str(batch_atlas.COMFY_BASE))
    # A contradiction outranks every tier: if "My computer" is addressing a
    # RunPod host, saying "not answering" (or worse, "live") describes the
    # wrong machine and sends the user off to restart a tunnel that was never
    # the problem.
    if not pod:
        mis = local_target_misconfigured(str(batch_atlas.COMFY_BASE))
        if mis:
            return (f'<div class="mdlstat bad"><span>{lead}<b>This is pointing '
                    f'at RunPod, not your computer</b> — {html.escape(mis)}'
                    f'</span>{btn}</div>')
    if st.get("live"):
        return (f'<div class="mdlstat ok"><span>{lead}Model lists: '
                f'<b>live from your ComfyUI</b> ({base})</span>{btn}</div>')
    if st.get("cached"):
        src = html.escape(str(st.get("source") or "an earlier probe"))
        when = _rel_time(float(st.get("fetchedAt") or 0.0))
        tail = ("RunPod\'s workers can\'t be asked live — ⟳ re-reads whichever "
                "pod is running" if pod else
                "your ComfyUI isn\'t answering right now — start ComfyUI + the "
                "tunnel, then ⟳")
        return (f'<div class="mdlstat warn"><span>{lead}Model lists: <b>cached '
                f'{html.escape(when)}</b> from {src} — {tail}</span>{btn}</div>')
    if pod:
        return (f'<div class="mdlstat bad"><span>{lead}<b>Model lists '
                'unavailable</b> — serverless workers can\'t be asked for what '
                'is installed. Start any pod on the <b>/comfyui</b> page (they '
                'share the volume the workers use), then ⟳ — nothing to '
                f'configure.</span>{btn}</div>')
    return (f'<div class="mdlstat bad"><span>{lead}<b>Model lists unavailable</b> '
            f'— your ComfyUI has never answered at <code>{base}</code>; these '
            'fields stay free-text. Start ComfyUI + the tunnel (desktop '
            f'launcher), then ⟳.</span>{btn}</div>')


def _control_html(key: str, typ: str, value, cache: dict, *,
                   allow_blank: bool = False, blank_label: str = "",
                   placeholder: str = "", title: str = "",
                   step: str = "", target: str = "local",
                   readonly: bool = False) -> str:
    """Inner form element for a settings field: a <select> for the pipeline
    and for model-file fields (populated live from ComfyUI, current value
    always kept), else the plain <input>. All carry data-cfg so the existing
    save logic and cfgData() pick them up unchanged.

    `readonly` applies to the plain <input> only — it exists for the geometry
    fields a layout OWNS (`ATLAS_GEOM_READONLY_IN`), which are numbers and
    never dropdowns. Readonly and not disabled on purpose: the value still
    posts, so locking a field can never wipe it."""
    cur = "" if value is None else str(value)
    common = f' data-cfg="{key}" title="{title}"'
    if key == "pipeline":
        return (f'<select{common}>'
                f'{_pipeline_options_html(cur or "sdxl")}</select>')
    if key == "run_on":
        return f'<select{common}>{_run_on_options_html(cur)}</select>'
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
    if key == "atlas_layout":
        # An atlas this tool ALREADY lays out gets exactly the two named
        # choices and no blank — same reason as `atlas_pack_trim` below: a blank
        # _ATLAS_GEOM_KEYS value is SKIPPED on save, so a blank option there
        # would look changeable and silently do nothing.
        #
        # Anything else is the authored-geometry kind (`atlas_geom_fields_for`
        # withholds this row only from a BOUND atlas, so an unrecognised or
        # absent value reaching here means "no layout", not "pack"). It gets a
        # THIRD choice, selected, whose value is blank precisely BECAUSE a blank
        # is skipped on save — see ATLAS_LAYOUT_AUTHORED. Falling back to `pack`
        # here, as this used to, would open the row on "Pack the art" for an
        # atlas whose rects were authored elsewhere and let one Save hand them to
        # the packer.
        norm = cur.strip().lower()
        choices = list(ATLAS_LAYOUT_MODES.items())
        if norm not in ATLAS_LAYOUT_MODES:
            norm = ATLAS_LAYOUT_AUTHORED
            choices.insert(0, (ATLAS_LAYOUT_AUTHORED,
                               ATLAS_LAYOUT_AUTHORED_LABEL))
        opts = "".join(
            f'<option value="{v}"{" selected" if v == norm else ""}>'
            f'{html.escape(lbl)}</option>' for v, lbl in choices)
        return f'<select{common}>{opts}</select>'
    if key == "atlas_pack_trim":
        # Two named choices, no blank: a blank _ATLAS_GEOM_KEYS value is SKIPPED
        # on save ("never wipe required atlas geometry"), so offering one would
        # make the setting look changeable and silently not change. Absent
        # normalizes to the default, so an untouched atlas keeps its behaviour.
        norm = cur.strip().lower()
        if norm not in PACK_TRIM_MODES:
            norm = PACK_TRIM_DEFAULT
        opts = "".join(
            f'<option value="{v}"{" selected" if v == norm else ""}>'
            f'{html.escape(lbl)}</option>' for v, lbl in PACK_TRIM_MODES.items())
        return f'<select{common}>{opts}</select>'
    avail, marker = _options_for(key, cache, target)
    if avail:
        # Per-atlas blank = inherit the global, always offered. A GLOBAL blank
        # means "no model" — only honest for an OPTIONAL one (clearing
        # flux_checkpoint / flux_controlnet skips that node). For a required
        # field there is no "none": offering it invited the choice that comes
        # back from the GPU as `vae_name: '' not in [...]`, so it now shows the
        # default it would fall back to instead.
        if allow_blank:
            bl = blank_label
        elif key in batch_atlas.REQUIRED_MODEL_KEYS:
            d = batch_atlas._DEFAULTS.get(key)
            bl = f"(default: {d})" if str(d or "").strip() else ""
        else:
            bl = "(blank — none)"
        return (f'<select{common}>'
                f'{_opt_html(avail, cur, bl, marker)}</select>')
    inp = (f'<input{common} type="{typ}" '
           f'value="{html.escape(cur, quote=True)}" '
           f'placeholder="{html.escape(placeholder, quote=True)}"{step}'
           f'{" readonly" if readonly else ""}>')
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


NUMERIC_CONFIG_KEYS = {k for k, _, t in CONFIG_FIELDS if t == "number"}


def cfg_num(v):
    """A settings value as a number when it reads like one, else unchanged."""
    try:
        return float(v) if "." in str(v) else int(v)
    except ValueError:
        return v


def _blank_means_unset(key: str) -> bool:
    """A blank on this key is 'unset' (drop it, let the default apply) rather
    than a value. Numerics, plus the model names that are required wherever
    they appear — see `batch_atlas.REQUIRED_MODEL_KEYS`."""
    return key in NUMERIC_CONFIG_KEYS or key in batch_atlas.REQUIRED_MODEL_KEYS


def apply_global_edit(cfg: dict, key: str, value) -> None:
    """Apply ONE global (atlas_config.json) edit from the Settings panel.

    A blank that means "unset" drops the key instead of storing "". The panel posts every
    field it renders, blanks included, and `load_config` below reads the file
    RAW — it does not merge `batch_atlas._DEFAULTS` — so a key the config
    predates rendered as an empty box and one Save stored `"flux_guidance": ""`.
    That "" then shadowed the 3.5 default and killed every FLUX render at
    `float('')`. Dropping the key restores the default AND heals a config
    already poisoned that way on its next save.

    Text keys keep blank-means-blank: a blank `flux_controlnet` /
    `flux_redux_style_model` disables that optional node by design. The
    per-atlas branch already had this rule (blank = inherit the global); the
    global branch was the one that never got it."""
    if _blank_means_unset(key) and str(value).strip() == "":
        cfg.pop(key, None)
        return
    cfg[key] = cfg_num(value) if key in NUMERIC_CONFIG_KEYS else value


def effective_global(cfg: dict, key: str) -> str:
    """The global value a per-atlas field actually inherits — the stored one, or
    the engine default when it is unset. "(inherit global: )" told the author
    the global was EMPTY when the render would use 1024; `batch_atlas` is the
    one that decides, so ask it."""
    gv = str(cfg.get(key, "")).strip()
    if gv:
        return gv
    d = ba_default(key)
    return "" if d is None else str(d)


def ba_default(key: str):
    """`batch_atlas`'s default for a settings key, or None if it has none."""
    d = batch_atlas._DEFAULTS.get(key)
    return None if d is None or str(d).strip() == "" else d


def default_placeholder(key: str, typ: str, value) -> str:
    """What an EMPTY numeric box should say. An empty box reads like "0"; the
    render actually uses `batch_atlas._DEFAULTS[key]`, so show that. Only
    numerics — for a text key an empty box genuinely means empty."""
    if typ != "number" or str(value).strip() != "":
        return ""
    d = batch_atlas._DEFAULTS.get(key)
    if isinstance(d, bool) or not isinstance(d, (int, float)):
        return ""
    return f"default: {d}"


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


def active_manifest_name() -> str:
    """The active manifest's basename for THIS project.

    Resolution order — must MATCH the Session-bar dropdown so the per-atlas
    settings/style panel header and the slice never target a different file
    than the one the user sees selected:
      1. the configured `manifest_path` (basename), if it names a manifest the
         project actually owns;
      2. otherwise the project's FIRST real manifest (what the dropdown shows
         when nothing is `selected` — `list_manifests()[0]`);
      3. otherwise "" (a brand-new project with no manifest yet).

    NEVER fabricate a hardcoded sample name (the old `symbolsStatic` default):
    a new project owns no such file, so the slice / settings panel would
    FileNotFoundError on a manifest it doesn't own and desync from the
    dropdown. A stale configured value (e.g. a manifest deleted out from under
    us) likewise falls through to the first real one rather than 404ing."""
    name = Path(str(load_config().get("manifest_path", ""))).name
    owned = list_manifests()
    if name and name in owned:
        return name
    return owned[0] if owned else ""


def creative_manifest_path() -> Path:
    """The editable JSON that stores *creative* data (prompts, seeds, refs).
    Geometry is never stored here when an `.atlas` is bound. If a bare
    `.atlas` is the active selection, creative edits live in its sibling
    `atlas_manifest_<stem>.json`, auto-created and bound to that `.atlas`
    so nothing the user types is lost."""
    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    sel = active_manifest_name()
    if not sel:
        # Brand-new project with no manifest yet: return a placeholder path
        # under MANIFEST_DIR (load_manifest() surfaces the "pick/compose a
        # manifest first" banner; nothing is fabricated on disk).
        return MANIFEST_DIR / "atlas_manifest.json"
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


_pinned_manifest = threading.local()


@contextlib.contextmanager
def pinned_manifest(mp: Path):
    """Pin the ACTIVE manifest to `mp` for this thread only.

    A long job (compose, a render's post-hook, a manifest-activation seed) has
    to keep working on the manifest it STARTED on. Its own reads and writes can
    name the path explicitly, but the helpers underneath cannot: all_regions()
    resolves the bound `.atlas` through manifest_path(), so a dropdown change
    from another tab mid-job would merge a different atlas's geometry onto
    these regions — and region names (H1, L1, …) collide across atlases, so
    nothing would look wrong until the wrong art shipped.

    Thread-local, exactly like cloud_paths' (client, project) context and for
    exactly the same reason: ThreadingHTTPServer gives every request its own
    thread, so pinning here cannot leak into anyone else's. NEVER make this a
    module global — that is the race cloud_paths.py exists to have removed."""
    prev = getattr(_pinned_manifest, "path", None)
    _pinned_manifest.path = Path(mp)
    try:
        yield _pinned_manifest.path
    finally:
        _pinned_manifest.path = prev


def manifest_path() -> Path:
    pinned = getattr(_pinned_manifest, "path", None)
    return pinned if pinned is not None else creative_manifest_path()


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
    out = {
        "name": name,
        "x": x, "y": y, "w": w, "h": h,
        "rotated": bool(r.get("rotated")),
        "off_x": int(pick("off_x", "offX", default=0)),
        "off_y": int(pick("off_y", "offY", default=0)),
    }
    # TRIM, only when the source ACTUALLY carries it. Defaulting orig_* to w/h
    # is not a harmless no-op: `fit_to_region` reads their mere PRESENCE as
    # `spine_slot` and switches the default from `contain` to `fill`, so
    # synthesizing them turns an untrimmed cell-grid cell into a slot whose art
    # gets stretched to the rect. An absent trim must stay absent.
    ow = pick("orig_w", "origW")
    oh = pick("orig_h", "origH")
    if ow is not None and oh is not None:
        try:
            out["orig_w"], out["orig_h"] = int(ow), int(oh)
        except (TypeError, ValueError):
            pass
    # Creative fields survive the handoff. `fit_mode` above all: it is a
    # PLACEMENT CONTRACT, not a preference — the Sheet Maker stamps
    # `fit_mode:"contain"` on every cell it writes so compose replays
    # packer.compose verbatim. Rebuilding a closed geometry-only dict dropped
    # it, and the region then fell to the alpha-crop-and-rescale default: the
    # rects stayed right while the art inside them was re-derived from its
    # alpha bbox and resized to the slot.
    for k in ("fit_mode", "prompt", "shape_ref", "seed", "mode", "pipeline",
              "negative"):
        v = r.get(k)
        if v not in (None, ""):
            out[k] = v
    return out


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
    `output_override` (mirrored to R2) with `fit_mode:"contain"`, so the cards
    show the existing art and Create Atlas reproduces the sheet byte-for-byte
    until the user replaces a frame."""
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
        cell_grid = False        # editor/seed manifest -> cells, not Spine slots
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
            cell_grid = True
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
                # A CELL's bound art is this cell, cut from the page at exactly
                # w x h, so the faithful recompose is a verbatim paste. Say so
                # explicitly: without it the region falls to the alpha-crop-and-
                # rescale default, which re-derives the art from its ink bounds
                # and resizes it to the rect -- the sheet's placement (art at
                # natural size, centred in a padded cell) is lost and the very
                # first Create Atlas silently rewrites every frame. setdefault,
                # so a fit_mode the source chose still wins.
                #
                # NOT stamped for a raw TexturePacker/.atlas import: there the
                # rect is a rig's authored footprint and `fill` is the deliberate
                # default (see fit_to_region) so regenerated art fills the slot
                # the game already renders, rather than letterboxing inside it.
                if cell_grid:
                    r.setdefault("fit_mode", "contain")
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


# Marker `sheet-tool/atlas_writers.build_manifest` stamps on every manifest it
# writes. It is the only reliable way to tell a Sheet-Maker page (cells: art at
# natural size, centred) from a rig's `.atlas` (slots: art fills the footprint),
# and the two want opposite placement.
_SHEET_MAKER_MARK = "Invisible Sheet Maker"


def _page_basename(m: dict) -> str:
    atlas = m.get("atlas") or {}
    ref = str(atlas.get("source_image") or atlas.get("source_image_path") or "")
    return Path(ref.replace("\\", "/")).name


def _sheet_manifest_for(m: dict) -> dict | None:
    """The Sheet-Maker manifest that authored the page `m` is built on, if any.

    Joined on the PAGE BASENAME, which survives every rewrite of the path around
    it (the Sheet Maker stores a bare name, an import stores `refs/atlas/<name>`).
    Returns None whenever the evidence is absent — a rig's `.atlas` has no Sheet
    Maker manifest, and must not be "repaired" into cell placement."""
    page = _page_basename(m)
    if not page or not MANIFEST_DIR.exists():
        return None
    for mp in sorted(MANIFEST_DIR.glob("atlas_manifest_*.json")):
        try:
            doc = json.loads(mp.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(doc, dict):
            continue
        if _SHEET_MAKER_MARK not in str(doc.get("_comment", "")):
            continue
        if _page_basename(doc) != page:
            continue
        return doc
    return None


def repair_sheet_fit_mode(m: dict) -> list[str]:
    """Restore the `fit_mode` a Sheet-Maker handoff dropped. Returns the names
    repaired (empty when there is nothing to do).

    Both routes into this tool used to strip the contract, and a manifest
    written before the fix is still stripped ON DISK — the fix stops new damage,
    it cannot undo old:

      * the editor/seed-manifest branch rebuilt each region as a closed
        geometry-only dict, so `fit_mode` never survived;
      * the raw-TexturePacker branch never had it — the Sheet Maker's own `.json`
        declares `sourceSize` = the full cell, so `_tp_frame_to_region` hands
        every cell an `orig_w`/`orig_h` whose mere PRESENCE `fit_to_region` reads
        as `spine_slot`, defaulting it to `fill` = stretch to the rect.

    Either way the rects stay right while the art inside them is re-derived from
    its ink bounds and rescaled, so it reads as a packing bug.

    Repairs from EVIDENCE, never inference: the value is copied from the region
    of the same name in the Sheet-Maker manifest that authored this page. No
    such manifest (a rig's `.atlas`, a from-scratch atlas) → nothing is touched,
    so `fill` stays the default where a slot really is a rig's footprint. An
    explicit `fit_mode` already on the region always wins — this fills a hole,
    it does not overrule a choice."""
    try:
        sheet = _sheet_manifest_for(m)
        if sheet is None:
            return []
        want = {}
        for r in sheet.get("regions") or []:
            nm, fm = r.get("name"), str(r.get("fit_mode", "")).strip()
            if nm and fm:
                want[nm] = fm
        if not want:
            return []
        fixed = []
        # The manifest's OWN region dicts, not `all_regions` — that returns
        # freshly merged copies for an `.atlas`-bound manifest, so writing to
        # them would repair nothing. `fit_mode` is creative data anyway, which
        # `merge_atlas_regions` carries over from here by name.
        for r in (list(m.get("regions") or [])
                  + list(m.get("rotated_regions") or [])):
            if not isinstance(r, dict) or str(r.get("fit_mode", "")).strip():
                continue
            fm = want.get(r.get("name"))
            if fm:
                r["fit_mode"] = fm
                fixed.append(r["name"])
        return fixed
    except Exception:  # noqa: BLE001 — a repair must never break a compose
        return []


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


def newest_variant_id(name: str) -> str:
    files = variant_files(name)
    return variant_id(files[-1]) if files else ""


def output_view(name: str, region: dict
                ) -> tuple[str, str, str, int | None, str]:
    """The output figure for a region: (thumb, full, caption, seed, pick).

    Shared by the page build and /cardsdata so a post-render refresh shows
    exactly what a reload would — the card used to keep a stale `?id=` after a
    render superseded the pick, and to caption a picked variant with the
    LATEST file's seed instead of the picked file's.

    It returns the pick it resolved as well as the image built from it, because
    the card carries that id in `data-variant` and posts it back on every save:
    recomputing it at the call site is how the two drift, and a card that
    re-asserts a spent pick writes it straight back into the manifest.

    Priority matches batch_atlas._pick_variant_png: a committed user image
    wins, then the LIVE picked variant (see batch_atlas.effective_variant —
    a pick the slot has re-rendered past is spent), then the newest file.

    Each url's cache-bust `?t=` is the SOURCE file's mtime+size — not a
    per-page-load timestamp. So a plain reload stays fully cacheable (no
    thumbnail re-decode storm), yet the url changes the moment a slot's image
    actually changes (re-render / new pick / re-upload)."""
    override_p = batch_atlas.override_image_path(region)
    if override_p is not None:
        t = imgcache.thumb_token(override_p)
        return (f"/outthumb/{name}?t={t}", f"/outfull/{name}?t={t}",
                "★ your image · NOT processed", None, "")
    files = variant_files(name)
    picked = batch_atlas.effective_variant(
        region, variant_id(files[-1]) if files else "")
    p = next((q for q in files if variant_id(q) == picked), None) if picked else None
    if p is not None:
        t = imgcache.thumb_token(p)
        thumb = f"/vthumb/{name}?id={picked}&t={t}"
        full = f"/vfull/{name}?id={picked}&t={t}"
    else:
        picked = ""
        p = files[-1] if files else None
        t = imgcache.thumb_token(p) if p else "0"
        thumb, full = f"/thumb/{name}?t={t}", f"/full/{name}?t={t}"
    us = seed_of(p) if p else None
    return (thumb, full, f"output · seed {us if us is not None else '—'}",
            us, picked)


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
    """Disk-cached thumbnail. Routes through the shared cache (keyed on src
    path+mtime+size+box) so a many-thumbnail page reads cheap JPEGs instead of
    re-decoding every full-size image on each request — the 502-storm fix. The
    cache lives under THIS request's staging root (request-thread-local context;
    never a module-global), so it stays inside the active (client, project) tree
    and is invalidated structurally when the source mtime changes."""
    try:
        cache_dir = project_paths.resolve().get("staging_root")
    except Exception:  # noqa: BLE001 — fall back to OS temp if context is unset
        cache_dir = None
    return imgcache.cached_thumb(path, box, cache_dir=cache_dir)


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
    candidates whose BASE was processed (base in the set) OR whose FX layer was
    itself processed (name in the set); when None (compose case) keep all.
    Layers are ordered by suffix depth so a layer whose base is ITSELF an
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
        # `base_names` scopes the render case to what was just processed. Rebuild
        # this FX layer when EITHER its base was regenerated (base in the set) OR
        # the FX layer ITSELF was selected/processed (name in the set) — so
        # "select the FX cell → Process" derives it, not only "process the base".
        if base_names is not None and not (
                info["base"] in base_names or name in base_names):
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
    """Stop everything this render started — locally AND remotely.

    Killing the subprocess only ends OUR side. Two things kept going:

    * a RunPod job carried on rendering and BILLING. The worker is already
      built to notice a cancel (`handler.py::_job_cancelled` polls RunPod
      every 5s precisely so a cancelled job stops instead of running to
      completion) — nobody was ever calling `/cancel`.
    * ComfyUI's PENDING queue was never cleared. `/interrupt` aborts only the
      job executing right now, so anything queued behind it starts next.

    Every step is best-effort and independent: a failure in one must not stop
    the others, and none of them may raise into the Stop button."""
    global _stopped
    _stopped = True
    done: list[str] = []
    with _render_lock:
        job_id = str(_render_state.get("runpodJob") or "")
        _render_state["runpodJob"] = ""
    proc = _render_proc
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
        done.append("render stopped")
    if job_id:
        why = batch_atlas.runpod_cancel(job_id)
        done.append(f"RunPod job {job_id[:8]} cancelled" if not why
                    else f"could not cancel RunPod job {job_id[:8]} ({why})")
    for path, body, label in (
            ("/interrupt", b"", "current job interrupted"),
            ("/queue", json.dumps({"clear": True}).encode(), "queue cleared")):
        try:
            req = urllib.request.Request(
                f"{batch_atlas.COMFY_BASE}{path}", data=body, method="POST",
                headers={"Content-Type": "application/json",
                         **batch_atlas.CF_HEADERS})
            urllib.request.urlopen(req, timeout=5).read()
            done.append(label)
        except Exception:  # noqa: BLE001 — nothing listening is normal here
            pass
    return "Stopping… " + (", ".join(done) if done else "nothing was running")


def _run_cmd(cmd: list[str], total: int, post_hook=None,
             pre_note: str | None = None, comfy_env: dict | None = None) -> None:
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
        # Per-user ComfyUI routing (per-user-comfyui-routing.md): when the active
        # user has registered their own ComfyUI, override COMFY_URL / CF Access
        # in the subprocess env so their jobs run on THEIR box. Empty ⇒ the
        # inherited global COMFY_URL (shared tunnel) is kept.
        if comfy_env:
            env.update(comfy_env)
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
                # The in-flight RunPod job id, so Stop can cancel the REMOTE
                # job. Kept out of the visible log — it is plumbing, and the
                # readable "... serverless job <id> IN_QUEUE" line already
                # tells the user what is running.
                if line.startswith(batch_atlas.RUNPOD_JOB_MARK):
                    _render_state["runpodJob"] = line[
                        len(batch_atlas.RUNPOD_JOB_MARK):].strip()
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
                # The hook does the FX rebuild AND the superseded-pick cleanup;
                # neither is worth failing a finished render over.
                with _render_lock:
                    _render_state["log"] += f"\n[post-render step skipped] {e}\n"
    except Exception as e:  # noqa: BLE001
        with _render_lock:
            _render_state["log"] += f"\n[ERROR] {e}\n"
    finally:
        _render_proc = None
        with _render_lock:
            _render_state.update(running=False, done=True)


def resolve_user_comfy_env(user_id: str) -> dict:
    """Per-user ComfyUI routing (per-user-comfyui-routing.md).

    Given the active user, read their registered ComfyUI endpoint from R2
    (`_users/<slug>/comfy.json`) and return the env overrides the render
    subprocess needs: `COMFY_URL` (+ CF Access headers for a named tunnel).
    Returns `{}` when the user hasn't registered one — the caller then keeps the
    global `COMFY_URL` (the shared tunnel), so nothing breaks during rollout.
    Best-effort: any R2 miss / parse error → `{}` (fall back to shared)."""
    slug = project_paths.r2_slug(user_id or "")
    if not slug:
        return {}
    try:
        blob = storage.get(f"_users/{slug}/comfy.json")
    except Exception:  # noqa: BLE001 — R2 hiccup ⇒ fall back to the shared tunnel
        return {}
    if not blob:
        return {}
    try:
        rec = json.loads(blob)
    except (ValueError, TypeError):
        return {}
    url = str((rec or {}).get("url", "")).strip().rstrip("/")
    if not url:
        return {}
    env = {"COMFY_URL": url}
    cid = str(rec.get("cf_access_id", "")).strip()
    sec = str(rec.get("cf_access_secret", "")).strip()
    # A named tunnel (a) carries a per-user CF Access token; a quick tunnel (b)
    # has none — either way CLEAR the inherited GLOBAL CF headers so the shared
    # tunnel's token never leaks onto a different origin (cf_headers() treats an
    # empty value as absent).
    env["CF_ACCESS_CLIENT_ID"] = cid
    env["CF_ACCESS_CLIENT_SECRET"] = sec
    return env


def claim_render_slot() -> tuple[bool, str]:
    """Take the render slot, or explain why not. `(started, message)`.

    Two failures this closes, which together produced "it renders forever and
    shows no error":

    * `/render` used to answer "started" unconditionally — even when it had NOT
      spawned a thread because `running` was already set. Every retry looked
      accepted, and the panel kept polling a render that did not exist.
    * `running` had no way back to False except the render's own `finally`. A
      subprocess that hung (see `_COMFY_POST_TIMEOUT` — a `/prompt` with no
      timeout against a dead tunnel connector blocked forever) left the flag
      stuck for the life of the container, so every later render was refused
      in silence.

    So a claim now also SELF-HEALS: if the flag says running but the subprocess
    is gone (or there never was one), the flag is stale and the slot is free."""
    with _render_lock:
        if _render_state["running"]:
            proc = _render_proc
            alive = proc is not None and proc.poll() is None
            if alive:
                return False, ("A render is already running "
                               f"{_render_progress()} — press Stop to cancel "
                               "it before starting another.")
            # Server log, not the panel log: `_run_cmd` resets `log` when the
            # new render starts, so anything written here would vanish.
            print("[render] stale 'running' flag with no live subprocess - "
                  "clearing it and starting the new render.", flush=True)
        _render_state.update(running=True, done=False, started=time.time())
    return True, "started"


def _render_progress() -> str:
    """"(3/16, started 9 minutes ago)" — what the refusal above was missing.

    "A render is already running" alone cannot be acted on: it reads the same
    whether the GPU is 3 images into a 16-image batch or wedged since lunch,
    and the only offered remedy (Stop) destroys work in flight. The server
    already knows both numbers; saying them turns the dialog into a decision.
    Called under `_render_lock`."""
    cur, total = _render_state.get("cur", 0), _render_state.get("total", 0)
    bits = [f"{cur}/{total}"] if total else ["still starting up"]
    started = float(_render_state.get("started") or 0.0)
    if started:
        bits.append(f"started {_rel_time(started)}")
    return f"({', '.join(bits)})"


def _comfy_answers(url: str, comfy_env: dict) -> bool:
    """One tight GET to `<url>/system_stats` with the headers the render
    subprocess will use — the per-user tunnel's CF Access token when a record
    is in play, else the shared one — so "My computer" fails in a sentence
    before the render, not as a stack of upload timeouts inside it."""
    headers = dict(batch_atlas.CF_HEADERS)
    if "COMFY_URL" in comfy_env:
        headers = {k: v for k, v in headers.items()
                   if not k.lower().startswith("cf-access")}
        if comfy_env.get("CF_ACCESS_CLIENT_ID"):
            headers["CF-Access-Client-Id"] = comfy_env["CF_ACCESS_CLIENT_ID"]
        if comfy_env.get("CF_ACCESS_CLIENT_SECRET"):
            headers["CF-Access-Client-Secret"] = comfy_env["CF_ACCESS_CLIENT_SECRET"]
    try:
        comfy_catalog._http_get_json(f"{url.rstrip('/')}/system_stats", headers)
        return True
    except Exception:  # noqa: BLE001 — not answering, whatever the reason
        return False


def _read_manifest_at(mp: Path) -> dict | None:
    """Parse a manifest by EXACT path, or None if it can't be read.

    Unlike load_manifest() this never re-resolves the ACTIVE manifest from
    config: a background render has to write back the manifest it rendered,
    not whichever one is active when it finishes. Region names (H1, L1, …)
    collide across atlases, so switching manifests mid-render would otherwise
    apply one atlas's cleanup to another's regions."""
    try:
        return json.loads(mp.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_manifest_at(mp: Path, data: dict) -> None:
    mp.parent.mkdir(parents=True, exist_ok=True)
    mp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    _mirror(mp)


def _drop_dangling_pick(name: str) -> bool:
    """Clear a region's pick when the file it names no longer exists."""
    with _manifest_lock:
        m = load_manifest()
        dropped = False
        for bucket in ("regions", "rotated_regions"):
            for r in m.get(bucket, []):
                vid = str(r.get("variant", "")).strip()
                if r.get("name") != name or not vid:
                    continue
                if variant_path(name, vid) is None:
                    r.pop("variant", None)
                    r.pop("variant_at", None)
                    dropped = True
        if dropped:
            save_manifest(m)
        return dropped


_manifest_lock = threading.RLock()
"""Serialises load->mutate->save on the active manifest.

ThreadingHTTPServer gives every request its own thread, so two of them could
read the same manifest and write back two divergent copies — the last one
wins and the other user's edit is gone. Now that a variant pick commits on
click, these writes are frequent and small, so a plain mutex costs nothing.

A SLOW producer must not hold it: the FX rebuild is seconds of PIL work plus
an R2 upload per layer, and freezing every save in the UI for that long is its
own bug. Those paths run their work on a detached copy and then re-apply only
the fields they own onto a manifest re-read INSIDE the lock — see
persist_region_fields / rebuild_fx_layers_at."""


# What an FX build WRITES onto a region (build_fx_region). Re-applying exactly
# these onto a freshly read manifest is what lets the slow build run unlocked.
_FX_RESULT_KEYS = ("output_override", "mode", "fx", "shine")
# The one field the ref seed binds (_bind_ref_as_output). Same discipline: it
# decodes and mirrors an image per region, so its snapshot goes stale too.
_SEED_RESULT_KEYS = ("output_override",)


def _bucket_region(m: dict, name: str) -> dict | None:
    """The region's entry in the manifest's OWN buckets.

    Not all_regions(): for an `.atlas`-bound manifest that merges geometry into
    fresh dicts, so mutating what it returns persists nothing."""
    for bucket in ("regions", "rotated_regions"):
        for r in m.get(bucket, []):
            if r.get("name") == name:
                return r
    return None


def _region_fingerprint(m: dict, name: str, keys: tuple[str, ...]) -> str:
    """A comparable snapshot of the fields a slow job WRITES on one region.

    Its one job: tell "nobody touched this while we worked" from "somebody
    rewrote it". A region with no creative entry fingerprints as all-null, so
    a not-yet-existing region compares equal to itself — which is what makes
    the stub branch in persist_region_fields reachable for `.atlas`-bound
    manifests.

    It does NOT cover what the job READ. An FX layer is derived from its BASE
    region's image (fx_source), and the base is a different region whose pick
    can change mid-build; the result is then bound from art the base no longer
    shows. That self-heals on the next Create Atlas (which rebuilds every
    layer first), so it is left uncovered deliberately rather than widened
    into a cross-region dependency."""
    r = _bucket_region(m, name) or {}
    return json.dumps({k: r.get(k) for k in keys}, sort_keys=True, default=str)


def _fingerprints(m: dict, keys: tuple[str, ...]) -> dict[str, str]:
    """Fingerprint every region the manifest KNOWS, not just the ones with a
    creative entry: an `.atlas`-bound region the user has never edited has no
    entry yet, and leaving it out made `before.get(name)` None — which can
    never equal a real fingerprint, so its result was always dropped."""
    names = {r["name"] for bucket in ("regions", "rotated_regions")
             for r in m.get(bucket, []) if r.get("name")}
    names |= {r["name"] for r in all_regions(m) if r.get("name")}
    return {n: _region_fingerprint(m, n, keys) for n in names}


def _lift_region_fields(m: dict, names: list[str] | set[str],
                        keys: tuple[str, ...]) -> dict[str, dict]:
    """Pull just `keys` off each named region, detached from `m`."""
    out: dict[str, dict] = {}
    for name in names:
        r = _bucket_region(m, name)
        if r is not None:
            out[name] = json.loads(json.dumps({k: r[k] for k in keys if k in r},
                                              default=str))
    return out


def persist_region_fields(mp: Path, results: dict[str, dict],
                          before: dict[str, str], keys: tuple[str, ...]
                          ) -> tuple[list[str], list[str]]:
    """Write a slow job's per-region result onto the manifest as it stands NOW.

    Returns (written, skipped). This is the whole fix for the lost-save window:
    the job's own copy of the manifest is seconds stale by the time it finishes,
    and writing that copy back carried every OTHER field with it — so a prompt,
    seed or variant pick saved meanwhile was silently overwritten. Only `keys`
    travel, and only onto regions whose fingerprint still matches what the job
    started from.

    A `skipped` region keeps the MANIFEST the concurrent writer left. It does
    not undo the image file that writer's build and this one both wrote to
    `refs/useroutput_<name>.png` (and mirrored to R2) — whichever finished last
    is on disk. Callers say so, and name the layer, so a wrong-looking tile has
    an obvious remedy instead of being a mystery."""
    written: list[str] = []
    skipped: list[str] = []
    with _manifest_lock:
        fresh = _read_manifest_at(mp)
        if fresh is None:
            return [], sorted(results)
        for name, fields in results.items():
            if _region_fingerprint(fresh, name, keys) != before.get(
                    name, _region_fingerprint({}, name, keys)):
                skipped.append(name)
                continue
            r = _bucket_region(fresh, name)
            if r is None:
                # Same name-only stub build_fx_region would create for an
                # `.atlas`-bound manifest, and the same refusal if the geometry
                # no longer knows this region at all.
                if not any(x.get("name") == name for x in all_regions(fresh)):
                    skipped.append(name)
                    continue
                r = {"name": name}
                fresh.setdefault("regions", []).append(r)
            r.update(fields)
            written.append(name)
        if written:
            _write_manifest_at(mp, fresh)
    return written, skipped


def rebuild_fx_layers_at(mp: Path, base_names: set | None = None
                         ) -> tuple[list[str], list[str]]:
    """rebuild_fx_layers, persisted without clobbering a concurrent save.

    Builds on a detached copy with NO lock held (each layer is PIL work plus an
    R2 upload), then re-applies only the FX fields under the lock. Returns
    (rebuilt, skipped) — `skipped` names layers somebody re-tuned mid-build,
    whose own params were kept instead."""
    m = _read_manifest_at(mp)
    if m is None:
        return [], []
    before = _fingerprints(m, _FX_RESULT_KEYS)
    rebuilt = rebuild_fx_layers(m, base_names=base_names)
    if not rebuilt:
        return [], []
    return persist_region_fields(
        mp, _lift_region_fields(m, rebuilt, _FX_RESULT_KEYS),
        before, _FX_RESULT_KEYS)


def _fx_skip_note(skipped: list[str]) -> str:
    """What a skipped layer actually means, and what to do about it."""
    return ("Kept the settings you saved during the rebuild for %d FX layer(s): "
            "%s. Their image file is whichever build finished last — press "
            "⚙ build on those cells if the tile looks wrong."
            % (len(skipped), ", ".join(skipped)))


def _drop_superseded_picks(m: dict) -> list[str]:
    """Clear every variant pick a render has already spent. Mutates `m`.

    Housekeeping, not the rule: `batch_atlas.effective_variant` decides what
    the card shows and what Create Atlas composes, and it ignores a spent pick
    whether or not this ever runs. Dropping the field keeps the manifest
    legible — a stored pin means "this is the file in use" — and is what lets
    the render report how many slots moved on.

    It used to BE the rule, comparing against a snapshot of each slot's newest
    id taken before the subprocess started. That made the correct card depend
    on a background hook completing, so a stopped, crashed or exception-ing
    post-render step left the slot pinned to old art for good. A slot that
    produced no new file is still untouched here — its newest id has not moved
    past the pick's — so nothing is lost to a render that failed."""
    dropped: list[str] = []
    for bucket in ("regions", "rotated_regions"):
        for r in m.get(bucket, []):
            name = r.get("name")
            if not name or not str(r.get("variant", "")).strip():
                continue
            if batch_atlas.effective_variant(r, newest_variant_id(name)):
                continue
            r.pop("variant", None)
            r.pop("variant_at", None)
            dropped.append(name)
    return dropped


def run_render(names: list[str], variants: int = 1,
               ctx: tuple[str, str] | None = None, user: str = "") -> None:
    # These run on a NEW worker thread, so the request thread's thread-local
    # (client, project) is NOT inherited — re-apply it here before resolving the
    # manifest path / subprocess env, else everything falls back to the env
    # default context (unassigned/cloud) and the subprocess resolves the wrong
    # tree (geometry "not found in R2").
    if ctx:
        project_paths.set_context(*ctx)
    comfy_env = resolve_user_comfy_env(user)
    chosen = str(load_config().get("run_on") or "").strip().lower()
    target = chosen if chosen in RUN_ON_OPTIONS else _env_run_on()
    comfy_env.update(run_on_env(target))
    total = len(names) * max(1, variants)
    # RunPod on-demand: if the pod is asleep, wake it and wait for ComfyUI before
    # the subprocess tries to talk to it. Streams "waking the pod…" to the render
    # panel so the wait is visible. No-op / fail-safe when RunPod isn't configured.
    # An EXPLICIT "My computer" never wakes a pod — that would bill a GPU the
    # user just said not to use.
    _warm: list[str] = []

    def _wlog(m):
        _warm.append(m)
        with _render_lock:
            _render_state.update(running=True, done=False, cur=0, total=total,
                                 log="\n".join(_warm) + "\n", diagnostics=[])

    # Wake the on-demand pod only when this render will actually TALK to it.
    # It used to fire for every non-local render, including serverless ones —
    # where RunPod spins its own worker and a resumed GPU pod is billed for
    # nothing. `targets_our_pod` ties the wake-up to the address the render is
    # about to use, so it survives COMFY_URL being (correctly) the tunnel.
    wake_url = comfy_env.get("COMFY_URL") or str(batch_atlas.COMFY_BASE)
    if target == "local" and runpod_control.targets_our_pod(wake_url):
        runpod_control.ensure_pod_ready(wake_url, log=_wlog)
    if target == "local":
        url = comfy_env.get("COMFY_URL") or str(batch_atlas.COMFY_BASE)
        # Before asking whether it answers: is it even the right machine? A
        # RUNNING pod at this address would answer and render remotely, which
        # is exactly the outcome the user chose "My computer" to avoid.
        mis = local_target_misconfigured(url)
        if mis:
            with _render_lock:
                _render_state.update(
                    running=False, done=True, cur=0, total=total, diagnostics=[],
                    log=(f"✖ Run generation on = My computer, but the address "
                         f"configured for it is not your computer.\n{mis}\n"
                         "Nothing was submitted.\n"))
            return
        if not _comfy_answers(url, comfy_env):
            with _render_lock:
                _render_state.update(
                    running=False, done=True, cur=0, total=total, diagnostics=[],
                    log=(f"✖ Run generation on = My computer, but nothing "
                         f"answered at {url}.\nStart ComfyUI and the tunnel "
                         "(desktop launcher), or switch to RunPod in ⚙ Global "
                         "settings, then retry.\n"))
            return
    # The subprocess reads batch/ from local disk (already_generated seed-match
    # skips re-rendering pinned variants). It hydrates lazily, so pull it here
    # before spawning, else the subprocess sees an empty pile.
    project_paths.ensure_lazy("batch/")
    # The manifest THIS render is for. _post must write back to it by path: the
    # active manifest can be switched from another tab while a render runs, and
    # region names collide across atlases.
    mp = manifest_path()
    cmd = [PY, str(TOOLS / "batch_atlas.py"),
           "--manifest", str(mp),
           "--only", ",".join(names), "--include-rotated",
           "--variants", str(max(1, variants))]

    def _post():
        with pinned_manifest(mp):
            return _post_locked()

    def _post_locked():
        notes = []
        rebuilt, fx_skipped = rebuild_fx_layers_at(mp, base_names=set(names))
        if rebuilt:
            notes.append("Auto-rebuilt %d FX layer(s) from regenerated base(s): %s"
                         % (len(rebuilt), ", ".join(rebuilt)))
        if fx_skipped:
            notes.append(_fx_skip_note(fx_skipped))
        with _manifest_lock:
            m = _read_manifest_at(mp)
            if m is None:
                return "\n".join(notes) or None
            dropped = _drop_superseded_picks(m)
            if dropped:
                _write_manifest_at(mp, m)
        if dropped:
            # Not "…now show the fresh render": the sweep covers every region,
            # not just this run's, so it also clears picks an EARLIER render
            # already spent. Those slots have been showing their latest all
            # along — this is the manifest catching up, not the card moving.
            notes.append("Cleared %d variant pick(s) that newer art had "
                         "superseded — %s on the latest render: %s"
                         % (len(dropped),
                            "they are" if len(dropped) > 1 else "it is",
                            ", ".join(dropped)))
        return "\n".join(notes) or None

    _run_cmd(cmd, total, post_hook=_post, comfy_env=comfy_env,
             pre_note=("\n".join(_warm) if _warm else None))


# Page-width cap for the from-scratch auto-pack layout. The sheet grows only if
# a single trimmed sprite is wider than this; the height auto-crops to whatever
# the packed content uses. Inter-sprite gap (px) keeps neighbours from bleeding.
AUTO_PACK_MAX_WIDTH = 2048
AUTO_PACK_PADDING = 2

# What a from-scratch re-pack must CLEAR off a region: the packed rect it stamps
# IS the frame, so any trim/fit_mode a previous pack or an import left behind now
# describes a frame that no longer exists.
#
# Both spellings, deliberately. This tool writes trim snake_case, but camelCase is
# a real producer spelling in this codebase, not a typo: `video_to_clip.py`
# `_build_manifest` emits `offX/offY/origW/origH` because the launcher's
# `parseRegions` (apps/launcher-api/src/lib/server/editorRegions.ts) reads ONLY
# camelCase — and that file's `RawRegion` comment explains at length why teaching
# it snake_case is a versioned migration, not a parser tweak. So the fix belongs
# here, on the consumer: match what producers write rather than change it.
#
# No producer reaches this today — the Flipbook sheet stopped declaring
# `layout:"pack"` (#682), which is the only way in. The clear covers both spellings
# anyway, because the readers on THIS side (`_normalize_converted_region`,
# `_deployatlas`'s manifest-regions fallback) take either, and a surviving `orig_*`
# is live input rather than a dead field: its mere PRESENCE is what `fit_to_region`
# reads as `spine_slot`, flipping placement from `contain` to `fill`. A clear that
# silently skips half the spellings it is aimed at is a wrong answer waiting for
# the next producer that declares `pack`.
_REPACK_CLEARED_KEYS = ("off_x", "off_y", "orig_w", "orig_h",
                        "offX", "offY", "origW", "origH",
                        "fit_mode", "bounds", "offsets")

# What 🧩 Atlas settings' Frame trim dropdown offers. The KEYS are
# `batch_atlas.PACK_TRIM_MODES` and the meaning is stated THERE, beside the code
# that acts on it — same split as ATLAS_LAYOUT_MODES / FROM_SCRATCH_LAYOUTS, and
# pinned by a fixture so a mode added there cannot become unofferable here.
#
# The labels say what the choice DOES and stop. They used to also promise what
# it buys you ("smallest page", "all frames share one centre") — both of which
# were claims about `pack` alone, and the second is one this tool can only make
# when every region's art is on one canvas (`auto_pack_layout` warns when it is
# not). The consequences belong in the tooltip, where they can be conditional.
PACK_TRIM_MODES = {
    "alpha": "Crop each frame to its visible pixels",
    "keep": "Keep the whole frame, transparent edges included",
}
PACK_TRIM_DEFAULT = batch_atlas.PACK_TRIM_DEFAULT

# ONE implementation, in the module that reads it at compose time. A second
# normalizer here is how the panel and the page come to disagree about what an
# unset manifest does — and `batch_atlas` cannot import this module.
pack_trim_mode = batch_atlas.pack_trim_mode


# The four trim fields, snake_case -> the camelCase a producer may have used.
# Both spellings are real here: this tool writes snake_case, `video_to_clip`
# writes camelCase because the launcher's `parseRegions` reads only that — see
# `_REPACK_CLEARED_KEYS` for why the fix belongs on the consumer side.
_TRIM_CAMEL = {"off_x": "offX", "off_y": "offY",
               "orig_w": "origW", "orig_h": "origH"}


def _recorded_trim(r: dict) -> tuple[int, int, int, int] | None:
    """The trim this region already records — (off_x, off_y, orig_w, orig_h) —
    or None when it records none. Either spelling; the `orig_*` pair is what
    makes a record exist (the offsets default to 0, as everywhere else here)."""
    def _pick(snake: str, default=None):
        for k in (snake, _TRIM_CAMEL[snake]):
            if r.get(k) is not None:
                return r[k]
        return default
    ow, oh = _pick("orig_w"), _pick("orig_h")
    if ow is None or oh is None:
        return None
    try:
        return (int(_pick("off_x", 0)), int(_pick("off_y", 0)),
                int(ow), int(oh))
    except (TypeError, ValueError):
        return None


def _carried_trim(r: dict, img_size: tuple[int, int],
                  box: tuple[int, int, int, int]) -> dict:
    """The trim a re-packed region must KEEP, in the spelling it already uses.

    A re-pack changes WHERE a frame sits on the page. It does not change what
    the frame's original canvas was — that is a property of the source art,
    invariant under repacking. Dropping it is how a 25-frame animation ends up
    with 24 different "original canvases": with no record, every consumer
    (`_deployatlas`'s `_pick(…, default=rw)`, the launcher's `parseRegions`)
    reasonably fills the gap with the frame's own packed size, so each frame
    declares itself its own tight crop and PIXI anchors every one on a
    different centre. The character then walks around as the clip plays.

    `box` is the crop being packed out of an `img_size` canvas (the alpha bbox,
    or the whole canvas under `pack_trim: "keep"`). The record COMPOSES: the
    bound art IS the crop the old record describes, so the original canvas
    carries over unchanged and the offset just moves further inside it.

    Only ever PRESERVES, never invents. A region that recorded no trim gets
    none, so every atlas packed before this existed re-packs byte-identically.
    And the carry is gated on the art still BEING that crop (file size == the
    rect the record was written for): after a regenerate the art is new and the
    old canvas describes nothing, so it is dropped exactly as before."""
    prev = _recorded_trim(r)
    if prev is None:
        return {}
    try:
        had = (int(r["w"]), int(r["h"]))
    except (KeyError, TypeError, ValueError):
        return {}
    if had != tuple(img_size):
        return {}
    pox, poy, pw, ph = prev
    ox, oy = pox + int(box[0]), poy + int(box[1])
    cw, ch = int(box[2] - box[0]), int(box[3] - box[1])
    if (ox, oy) == (0, 0) and (cw, ch) == (pw, ph):
        return {}  # nothing is trimmed away — no record is the honest answer
    camel = any(k in r for k in _TRIM_CAMEL.values())
    out = {"off_x": ox, "off_y": oy, "orig_w": pw, "orig_h": ph}
    return {(_TRIM_CAMEL[k] if camel else k): v for k, v in out.items()}


def _sanitize_region_name(raw: str) -> str:
    """A region name is used verbatim as a variant-file prefix
    (`<name>_00001_.png`) and a manifest key, so keep it filesystem-safe:
    letters/digits/_/- only, other runs collapse to a single '_'."""
    s = re.sub(r"[^A-Za-z0-9_-]+", "_", str(raw).strip())
    return s.strip("_-")


# The geometry a `pack` atlas's packer OWNS. On this layout these fields are
# pure DERIVED OUTPUT — re-stamped from scratch on every Create Atlas — so a
# region the packer did not place must not be left holding any of them.
#
# Built FROM `_REPACK_CLEARED_KEYS` rather than restating it, because the two
# halves of the same clear must not drift: a PLACED region gets that tuple
# popped, an UNPLACED one gets this one, and for a while they disagreed — the
# unplaced branch kept the camelCase spellings (`offX`/`origW`/…) that the
# placed branch had learned to clear. Dormant, but exactly the trap
# `_REPACK_CLEARED_KEYS` exists to close: a surviving `orig_*` is live input,
# not a dead field — its mere PRESENCE is what `fit_to_region` reads as
# `spine_slot`, flipping placement from `contain` to `fill`. The rect itself
# (and the legacy `rotate` spelling, per batch_atlas._GEOM_KEYS) is what this
# adds on top: an unplaced region has no placement at all, not just no trim.
_PACK_GEOM_KEYS = ("x", "y", "w", "h", "rotated", "rotate") + _REPACK_CLEARED_KEYS


def _strip_pack_geometry(regions: list[dict],
                         keys: tuple[str, ...] = _PACK_GEOM_KEYS) -> list[str]:
    """Clear the packer-owned geometry off regions it did not place.

    Returns the names that ACTUALLY lost a rect (had a complete x/y/w/h), which
    is the only part worth reporting: a region that never had one is the
    ordinary "added but not generated yet" case and says nothing.

    `keys` exists for the ONE other caller that clears a slightly smaller set —
    `switch_atlas_layout`, which keeps the author's `fit_mode`. It is a
    parameter rather than a second copy of this loop because "clear these, and
    report who lost a rect" is the part that must never diverge between them.

    Why this has to happen: the packer re-runs from scratch every Create Atlas
    and re-sizes the page, so a rect it did not just write describes the
    PREVIOUS page. Leaving one behind made `_deployatlas`'s manifest-regions
    fallback emit a TexturePacker frame for it — a well-formed descriptor
    pointing at arbitrary pixels of the new page, so the frame shipped showing
    some other symbol's art with nothing anywhere to say so."""
    dropped: list[str] = []
    for r in regions:
        had_rect = all(k in r and r[k] is not None for k in ("x", "y", "w", "h"))
        if any(k in r for k in keys):
            for k in keys:
                r.pop(k, None)
            if had_rect:
                dropped.append(r["name"])
    return dropped


# What moving BETWEEN the from-scratch layouts clears off every region: the
# whole packer-owned set except `fit_mode`. Derived from `_PACK_GEOM_KEYS` so a
# field added there is cleared by the switch too, without a second list to keep
# in step.
#
# `fit_mode` is the one field in that set that is AUTHORED rather than derived:
# the 🖼 To Atlas Maker export stamps the author's `fit` choice on every region
# ("the ONE placement field this export writes"), and it means the same thing on
# both sides of the switch. `_GRID_CLEARED_KEYS` already refuses to clear it, for
# the reason spelled out there — dropping it puts every frame back on the
# alpha-crop-and-rescale default, which is the per-frame re-centring a flipbook
# must not have, and `grid_layout` would never put it back. The pack side loses
# nothing by keeping it: auto_pack pops and re-derives `fit_mode` from
# `pack_trim` on every region it places.
_LAYOUT_SWITCH_CLEARED_KEYS = tuple(k for k in _PACK_GEOM_KEYS
                                    if k != "fit_mode")


def switch_atlas_layout(m: dict, want: str) -> tuple[bool, list[str]]:
    """Give an atlas a from-scratch layout, clearing the geometry the state it
    is leaving owned.

    Why the clear. A `pack` rect describes a page the packer sized from the art;
    a `grid` rect describes a cell the author sized. Neither survives the move,
    so a rect left behind is the same class of fault `_strip_pack_geometry`
    already exists for — a well-formed frame addressing arbitrary pixels of a
    page nothing laid out. It matters MOST where the incoming layout writes
    nothing at all: `grid_layout` deliberately changes nothing when the regions
    overflow the page, and nothing when the cell size is missing (which is
    exactly the state a just-switched `pack` atlas is in, since a packer never
    wrote one). Without this the old pack rects would simply survive that refusal
    and deploy as if they were the grid. After the clear every region is
    UNPLACED until the next Create Atlas re-stamps it, which is a state the rest
    of the tool already handles by name (compose skips it, the deploy emits no
    frame for it). What is NOT cleared is the author's `fit_mode` — see
    `_LAYOUT_SWITCH_CLEARED_KEYS`.

    THE THIRD STARTING STATE, and the one that costs the most. An authored-
    geometry manifest (no `layout`, no `.atlas`, but real rects with their trim)
    is allowed through — `batch_atlas.can_choose_layout`, not `is_from_scratch`,
    is the gate, because otherwise the atlases with no layout are the only ones
    that can never be given one. The clear is the same clear, but what it costs
    is NOT the same: between `pack` and `grid` only derived output is dropped
    and the next Create Atlas re-stamps it, whereas here the rects came from an
    exporter or a person and nothing in this tool can put them back. So the
    caller's reply names that explicitly (`_saveconfig`); this is the one route
    into the switch where "press Create Atlas again" is not the whole story.

    Refuses anything that is not one of `FROM_SCRATCH_LAYOUTS`, and any manifest
    BOUND to a `.atlas` — see `atlas_geom_fields_for` for why that one must
    never be handed to the packer. The same layout again is not a move, so an
    ordinary Save (the panel posts every field every time) never costs a region
    its rect.

    Returns `(changed, lost)` — whether `m` was mutated (the caller's save
    signal) and the names that actually lost a rect. Mutates `m`; the CALLER
    saves, the same contract as the two layout passes."""
    new = str(want).strip().lower()
    if new not in batch_atlas.FROM_SCRATCH_LAYOUTS:
        return False, []
    if not batch_atlas.can_choose_layout(m):
        return False, []
    if batch_atlas.atlas_layout(m) == new:
        return False, []
    lost = _strip_pack_geometry(
        [r for bucket in ("regions", "rotated_regions")
         for r in (m.get(bucket) or [])
         if isinstance(r, dict) and r.get("name")],
        _LAYOUT_SWITCH_CLEARED_KEYS)
    atlas = m.setdefault("atlas", {})
    atlas["layout"] = new
    # Same pop as both layout passes make: the descriptor names the page of the
    # layout being left, and the launcher's `backfillMissingGeometry` treats it
    # as AUTHORITATIVE — it would hand every region that old rect straight back
    # by name, undoing the clear one layer up.
    atlas.pop("texturepacker_json", None)
    return True, lost


def _rect_on_page(n: dict, page_w: int, page_h: int) -> bool:
    """Does this normalized region's rect actually lie on the page?

    A rect that leaves the page cannot be the region's art — it is geometry
    left over from a differently-sized sheet, and the frame built from it would
    address arbitrary (or absent) pixels. Module-level and pure so the guard
    that keeps such a frame out of the deployed `.json` is the one the tests
    exercise, not a copy of it.

    Rotation: `atlas_writers.write_texturepacker_json` never swaps w/h, so a
    rotated region's footprint on the page is (h x w), not (w x h). Checking
    the display size would both pass a rect that overruns the edge and fail one
    that fits."""
    fw, fh = (n["h"], n["w"]) if n.get("rotated") else (n["w"], n["h"])
    return (n["x"] >= 0 and n["y"] >= 0 and fw > 0 and fh > 0
            and n["x"] + fw <= page_w and n["y"] + fh <= page_h)


def _rect_has_ink(page_alpha: Image.Image, n: dict) -> bool:
    """Does the page actually carry art under this region's rect?

    A rect the page is transparent under is a frame the game will resolve to
    nothing — an invisible symbol, with a well-formed descriptor saying it
    should be there. On a `pack` atlas that state is definitionally a fault:
    auto_pack only ever stamps a rect after measuring NON-EMPTY art, so a blank
    one means the art went away between that measurement and compose (compose's
    own "no generated variant found" skip is the door it goes out of).

    Module-level and pure for the same reason as `_rect_on_page`: the guard the
    tests exercise must be the guard that ships. Same (h x w) footprint rule."""
    fw, fh = (n["h"], n["w"]) if n.get("rotated") else (n["w"], n["h"])
    box = (n["x"], n["y"], n["x"] + fw, n["y"] + fh)
    return page_alpha.crop(box).getbbox() is not None


def _lost_rect_note(lost: list[str]) -> str:
    """Say out loud that a region left the atlas. It has no art on the new page,
    so the deploy will emit no frame for it and the game will fail to find it —
    a missing frame is loud, but only if the tool says which ones went."""
    return ("\n⚠ %d region(s) had no art to place and were REMOVED from the "
            "atlas (their old rect pointed into the previous page). The "
            "deployed .json will have no frame for them until they are "
            "generated: %s" % (len(lost), ", ".join(lost[:8])
                               + (" …" if len(lost) > 8 else "")))


def auto_pack_layout(m: dict) -> tuple[str | None, bool]:
    """From-scratch (`atlas.layout == "pack"`) atlases: derive the page layout
    from the generated art instead of a pre-authored `.atlas`.

    For each region, measure its committed variant / override at its ALPHA-
    trimmed footprint (the same crop compose's default `contain` path uses), pack
    all of them into an auto-sized page, then stamp `x/y/w/h(/rotated)` back onto
    each region plus `atlas.width/height`. `atlas.pack_trim: "keep"` — THE
    DEFAULT — measures the whole canvas instead, so frames authored on one
    canvas keep one common centre (see `batch_atlas.PACK_TRIM_MODES`); an
    explicit `"alpha"` asks for the tight crop.
    Either way a trim the region ALREADY recorded is preserved, re-based onto the
    new crop — see `_carried_trim`. Compose then places each region via
    the default contain path — rect == trimmed bbox ⇒ 1:1, no scaling — and
    `_deployatlas`'s manifest-regions fallback emits the TexturePacker descriptor
    from these same fields. Re-running after adding/generating regions re-packs,
    so the page morphs to fit.

    Regions with no committed image yet are left UNPLACED — and are STRIPPED of
    the packer-owned geometry (`_strip_pack_geometry`), because on a re-pack
    every other region moves onto a newly-sized page and a rect left behind
    describes the old one. Compose already skips a region with no variant, so
    the region simply is not in this atlas; the deploy then emits no frame for
    it (rather than a frame onto arbitrary pixels), and the note names any that
    lost a rect — dropping a symbol from the sheet is a change the user must see.

    The strip runs ONLY when at least one region measured. Measuring nothing at
    all is also what a failed staging hydration looks like, and wiping every
    rect on a network blip would be the bigger harm — see the `not items` branch.

    Returns `(note, changed)`. `changed` is the save signal, kept separate from
    the note because the caller used to infer it from a leading "⚠" and the two
    are not the same question. Mutates `m`; the CALLER saves it — same contract
    as rebuild_fx_layers, and the reason is the same: this opens every region's
    art to measure it, so the read->mutate->save cycle has to be closed by whoever
    holds the manifest lock, not from in here. Never raises — any failure returns
    a readable note and leaves the prior geometry untouched. Returns
    `(None, False)` when `m` is not a pack atlas (so callers no-op silently) —
    `grid` deliberately included: a grid atlas is from-scratch too, but its page
    and cell size are the AUTHOR's input, so `grid_layout` lays it out and this
    must not touch it (packing one would overwrite the very fields the author
    set)."""
    if batch_atlas.atlas_layout(m) != "pack":
        return None, False
    regions = [r for bucket in ("regions", "rotated_regions")
               for r in (m.get(bucket) or [])
               if isinstance(r, dict) and r.get("name")]
    batch_dir = Path(str(BATCH_DIR))
    items: list[dict] = []
    by_name: dict[str, dict] = {}
    skipped: list[str] = []
    keep_full = pack_trim_mode(m) == "keep"
    carried: dict[str, dict] = {}   # name -> the trim record to re-stamp
    for r in regions:
        src = (batch_atlas.override_image_path(r)
               or batch_atlas._pick_variant_png(batch_dir, r))
        bbox = None
        size = (0, 0)
        if src is not None:
            try:
                with Image.open(src) as im:
                    rgba = im.convert("RGBA")
                    size = rgba.size
                    bbox = rgba.getchannel("A").getbbox()
            except Exception:  # noqa: BLE001 — an unreadable variant = unplaced
                bbox = None
        if not bbox:
            # No ink (or no readable file) = nothing to place. Unchanged under
            # `keep`: a rect the page is blank under is refused at deploy
            # anyway (`_rect_has_ink`), so packing full-canvas emptiness would
            # only buy a frame that gets dropped one step later.
            skipped.append(r["name"])
            continue
        # `keep` packs the WHOLE canvas the art was rendered on, so frames that
        # share a canvas share a centre. `alpha` packs the ink only.
        box = (0, 0, size[0], size[1]) if keep_full else bbox
        w, h = box[2] - box[0], box[3] - box[1]
        items.append({"name": r["name"], "w": int(w), "h": int(h)})
        by_name[r["name"]] = r
        carried[r["name"]] = _carried_trim(r, size, box)
    if not items:
        # Deliberately does NOT strip. Measuring nothing at all is equally the
        # signature of a FAILED STAGING HYDRATION — cloud_paths.ensure_lazy
        # swallows every R2 error and leaves `batch/` as it found it — and
        # clearing every region's geometry on a transient network fault, then
        # mirroring that manifest back to R2, is a worse harm than the stale
        # rects it would remove. The strip below runs only once at least one
        # region has measured, which is the proof that hydration worked.
        # The page this produces is caught at the other end instead: a composed
        # page with no ink in it refuses to deploy a frame map at all.
        stale = [r["name"] for r in regions
                 if all(k in r and r[k] is not None for k in ("x", "y", "w", "h"))]
        note = ("⚠ Auto-pack: nothing generated yet — generate at least one "
                "region before Create Atlas.")
        if stale:
            note += ("\n⚠ %d region(s) still carry a rect from an earlier "
                     "packing while NOTHING measured this time. If that is a "
                     "hydration glitch rather than an empty atlas, do not "
                     "deploy — reload and Create Atlas again first: %s"
                     % (len(stale), ", ".join(stale[:8])
                        + (" …" if len(stale) > 8 else "")))
        return note, False
    try:
        result = pack.pack(items, width=AUTO_PACK_MAX_WIDTH, height=0,
                           padding=AUTO_PACK_PADDING, allow_rotation=False)
    except ValueError as e:
        return f"⚠ Auto-pack failed: {e}", False
    placed: set[str] = set()
    for pr in result["regions"]:
        r = by_name.get(pr["name"])
        if r is None:
            continue
        r["x"], r["y"] = int(pr["x"]), int(pr["y"])
        r["w"], r["h"] = int(pr["w"]), int(pr["h"])
        r["rotated"] = bool(pr["rotated"])
        placed.add(pr["name"])
        # Clear first, then re-stamp what survives the re-pack. Everything in
        # `_REPACK_CLEARED_KEYS` describes the PREVIOUS packing, so it all goes
        # — but a recorded trim is not only a description of the old rect, it
        # also names the frame's ORIGINAL CANVAS, which the re-pack did not
        # change. `_carried_trim` re-derives it against the new crop; a region
        # that recorded none still ends up with none, exactly as before.
        for k in _REPACK_CLEARED_KEYS:
            r.pop(k, None)
        r.update(carried.get(pr["name"]) or {})
        if keep_full:
            # The rect IS the whole canvas, so the art is pasted verbatim: with
            # `contain` the scale comes out at exactly 1.0 and the paste at
            # (0, 0). Stamped rather than left to the default because the
            # default is read from the region — `_carried_trim` may have just
            # put an `orig_w`/`orig_h` back on it, which `fit_to_region` reads
            # as `spine_slot` and answers with `fill`. Same pixels here (a 1:1
            # stretch), but only by arithmetic: name the placement instead of
            # relying on it.
            r["fit_mode"] = "contain"
    # Everything the packer did NOT just place is off this page — including a
    # measured item the packer somehow returned nothing for. Its old rect now
    # points into a differently-sized sheet, so it goes.
    lost = _strip_pack_geometry([r for r in regions if r["name"] not in placed])
    atlas = m.setdefault("atlas", {})
    atlas["layout"] = "pack"
    atlas["width"] = int(result["width"])
    atlas["height"] = int(result["height"])
    # The TexturePacker descriptor named here (if any) describes the page this
    # re-pack just superseded, and the launcher's `backfillMissingGeometry`
    # treats it as AUTHORITATIVE — it overwrites every rect it can match by name.
    # Left in place it silently restores the OLD packing on top of the NEW page,
    # so rects and pixels disagree again one layer up. There is no replacement to
    # name: compose emits a descriptor only at Deploy. It is also the one route
    # by which a region stripped just above could be handed a rect back.
    atlas.pop("texturepacker_json", None)
    note = (f"Auto-packed {len(placed)} region(s) → page "
            f"{result['width']}×{result['height']}"
            + (" (full frames kept — one common centre)" if keep_full else ""))
    kept = sum(1 for n in placed if carried.get(n))
    if kept:
        note += (f"; kept the recorded original canvas on {kept} region(s) "
                 f"(a re-pack moves a frame, it does not re-author it)")
    if keep_full:
        # `keep` keeps whatever canvas each region's COMMITTED ART is on. It
        # cannot give back a canvas the art was already cropped to, and it does
        # not make two differently-sized renders agree. When the canvases do
        # not agree the mode has NOT delivered what its label promises, and
        # saying "full frames kept — one common centre" over the top of that
        # would be the same silent wrong answer this setting exists to end.
        canvases = sorted({(by_name[n]["w"], by_name[n]["h"]) for n in placed})
        if len(canvases) > 1:
            note += ("\n⚠ 'Keep the full frame' packed %d DIFFERENT canvas "
                     "sizes (%s%s), so these frames still do NOT share one "
                     "centre. This mode keeps the canvas each region's "
                     "committed art is on — it cannot give back a canvas the "
                     "art was already cropped to. Re-render the regions at one "
                     "output size, or re-run the session that authored them."
                     % (len(canvases),
                        ", ".join(f"{w}×{h}" for w, h in canvases[:3]),
                        " …" if len(canvases) > 3 else ""))
    if skipped:
        note += (f"; {len(skipped)} not generated yet (skipped): "
                 f"{', '.join(skipped[:8])}"
                 + (" …" if len(skipped) > 8 else ""))
    if lost:
        note += _lost_rect_note(lost)
    return note, True


# What a grid re-flow must CLEAR off a region it places. The rect it stamps IS
# the authored cell, never a tight crop, so any trim record left on the region
# describes a frame this layout does not have — and a surviving `orig_*` is live
# input, not a dead field: its mere PRESENCE is what `fit_to_region` reads as
# `spine_slot`, flipping an un-annotated region's placement from `contain` to
# `fill`. Both spellings, for the reason spelled out on `_REPACK_CLEARED_KEYS`.
# `rotated`/`rotate` go for the same reason the rect does: a grid cell is
# upright by construction, and a stale flag makes every consumer compute the
# footprint as (h x w) — `_rect_on_page`, `_rect_has_ink` and the TexturePacker
# writer all swap on it.
#
# `fit_mode` is DELIBERATELY NOT cleared, and that is the one real difference
# from the pack path. There it is derived output (auto_pack picks it from
# `pack_trim`); here it is the author's placement choice, stamped at export from
# the 🖼 To Atlas Maker `fit` control and editable after — clearing it would
# silently drop every frame back to the alpha-crop-and-rescale default, which is
# exactly the per-frame re-centring a flipbook must not have.
_GRID_CLEARED_KEYS = tuple(
    k for k in _REPACK_CLEARED_KEYS if k != "fit_mode") + ("rotated", "rotate")


def grid_layout(m: dict) -> tuple[str | None, bool]:
    """Cell-grid (`atlas.layout == "grid"`) atlases: flow the regions through
    the page the AUTHOR sized, in manifest order.

    The opposite of `auto_pack_layout` in the one way that matters: there the
    packer decides the page and overwrites `atlas.width/height` with its own
    result, so the Settings fields are output and typing in them does nothing.
    Here those four fields — `atlas.width`, `atlas.height`, `atlas.cell_width`,
    `atlas.cell_height` — are INPUT. They are read, never written. Region `i`
    lands at `x = (i % cols) * cell_width`, `y = (i // cols) * cell_height`,
    at exactly one cell's size, with `cols = width // cell_width` and
    `rows = height // cell_height`.

    MANIFEST ORDER IS THE ANIMATION. The 🖼 To Atlas Maker export writes one
    region per frame in frame order, so a sort — by name, by size, by anything —
    would re-order the flipbook. Regions are taken exactly as they lie, `regions`
    then `rotated_regions` (every manifest walk in this file reads both buckets;
    a grid atlas normally has only the first).

    RE-RUN TO RE-FLOW. This runs on every Create Atlas, from the manifest's
    CURRENT settings — that is the whole point. Change the cell size in
    ⚙ Settings, press Create Atlas, and every rect moves. Nothing is frozen at
    export time.

    ONE PAGE, AND A REFUSAL RATHER THAN A SILENT TRUNCATION. `batch_atlas` has
    no page concept — a manifest has a single `source_image` — so there is no
    second sheet to overflow onto. When the regions outnumber the cells NOTHING
    is changed and the note names the capacity, the count and the three knobs
    that fix it. Same rule as `MAX_REF_FRAMES` and the ref-zip ceiling: this
    tool refuses rather than shortens, because a short atlas and a complete one
    look identical once they are a manifest.

    Returns `(note, changed)`, mutates `m`, and the CALLER saves — the same
    contract as `auto_pack_layout`, for the same reason. Never raises: every
    bad input comes back as a readable note with the prior geometry untouched.
    Returns `(None, False)` when `m` is not a grid atlas."""
    if batch_atlas.atlas_layout(m) != "grid":
        return None, False
    try:
        atlas = m.setdefault("atlas", {})

        def _dim(key: str) -> int:
            try:
                return int(float(atlas.get(key) or 0))
            except (TypeError, ValueError):
                return 0

        page_w, page_h = _dim("width"), _dim("height")
        cell_w, cell_h = _dim("cell_width"), _dim("cell_height")
        labels = {"width": "Atlas width", "height": "Atlas height",
                  "cell_width": "Default cell width",
                  "cell_height": "Default cell height"}
        missing_keys = [k for k, v in (("width", page_w), ("height", page_h),
                                       ("cell_width", cell_w),
                                       ("cell_height", cell_h)) if v <= 0]
        if missing_keys:
            fix = ("Set all four in 🧩 Atlas settings (Atlas width/height + "
                   "Default cell width/height), then Create Atlas again.")
            if all(k.startswith("cell_") for k in missing_keys):
                # THE pack -> grid LANDING. A packed atlas has a page (the
                # packer wrote width/height) and has never had a cell size —
                # nothing in the pack layout reads one — so this branch is the
                # first thing the author sees straight after switching, and
                # "Default cell width is missing" alone reads as a fault rather
                # than as the one step left to take. No cell size is invented
                # for them: the cell IS the layout, so a guess would lay the
                # atlas out in a grid they never chose and it would look
                # deliberate.
                fix = ("That is normal right after switching a packed atlas to "
                       "the grid layout: the packer sized the page, but only "
                       "you can say how big a cell is. Type it in 🧩 Atlas "
                       "settings (Default cell width + Default cell height), "
                       "then press Create Atlas again — every region will be "
                       "laid out in that grid, in manifest order. Nothing is "
                       "guessed for you, because the cell size IS the layout.")
            return ("⚠ Grid layout: nothing was laid out — %s %s missing (or "
                    "zero, or not a number). %s"
                    % (", ".join(labels[k] for k in missing_keys),
                       "is" if len(missing_keys) == 1 else "are", fix)), False
        if cell_w > page_w or cell_h > page_h:
            return (f"⚠ Grid layout: the cell ({cell_w}×{cell_h}) is bigger "
                    f"than the page ({page_w}×{page_h}), so not one whole cell "
                    f"fits and nothing was laid out. Lower Default cell "
                    f"width/height, or raise Atlas width/height.", False)

        regions = [r for bucket in ("regions", "rotated_regions")
                   for r in (m.get(bucket) or [])
                   if isinstance(r, dict) and r.get("name")]
        if not regions:
            return ("⚠ Grid layout: this atlas has no regions yet — nothing to "
                    "lay out."), False

        cols, rows = page_w // cell_w, page_h // cell_h
        capacity = cols * rows
        if capacity < len(regions):
            return (f"⚠ Grid layout: this {page_w}×{page_h} page holds "
                    f"{cols}×{rows} = {capacity} cell(s) of {cell_w}×{cell_h}, "
                    f"but the atlas has {len(regions)} region(s) — "
                    f"{len(regions) - capacity} would not fit. NOTHING was "
                    f"re-laid out (the manifest keeps the geometry it had): an "
                    f"atlas is ONE page here, so an overflowing grid is refused "
                    f"rather than silently shortened. Any one of these fixes "
                    f"it — raise Atlas width/height, lower Default cell "
                    f"width/height, or re-export from the Flipbook with a "
                    f"bigger stride (fewer frames)."), False

        changed = False
        for i, r in enumerate(regions):
            want = {"x": (i % cols) * cell_w, "y": (i // cols) * cell_h,
                    "w": cell_w, "h": cell_h}
            if any(r.get(k) != v for k, v in want.items()):
                changed = True
            r.update(want)
            for k in _GRID_CLEARED_KEYS:
                if k in r:
                    r.pop(k, None)
                    changed = True
        # Same reason as auto_pack_layout's pop: a TexturePacker descriptor
        # names the page this re-flow just superseded, and the launcher's
        # `backfillMissingGeometry` treats it as AUTHORITATIVE — it would
        # overwrite every rect by name and restore the OLD grid on the NEW page.
        if atlas.pop("texturepacker_json", None) is not None:
            changed = True

        spare = capacity - len(regions)
        note = (f"Grid layout: {len(regions)} region(s) → a {cols}×{rows} grid "
                f"of {cell_w}×{cell_h} cells on the {page_w}×{page_h} page you "
                f"set" + (f" ({spare} cell(s) spare)" if spare else ""))
        slack = [f"{n}px {where}" for n, where in
                 ((page_w - cols * cell_w, "on the right"),
                  (page_h - rows * cell_h, "at the bottom")) if n]
        if slack:
            # Say it, because it is the arithmetic the author did not do: a
            # 1000px page of 300px cells wastes 100px that LOOKS like it should
            # have held something.
            note += (f"\nℹ No whole cell fits in the last "
                     f"{' and '.join(slack)}, so that page area stays empty — "
                     f"the page is not an exact multiple of the cell.")
        return note, changed
    except Exception as e:  # noqa: BLE001 — a layout hiccup never breaks compose
        return (f"⚠ Grid layout failed ({type(e).__name__}: {e}) — the manifest "
                f"was not saved, so it keeps the geometry it had."), False


def _page_mtime(p: Path) -> float | None:
    """`p`'s mtime, or None when it is not a readable non-empty file."""
    try:
        st = p.stat()
    except OSError:
        return None
    return st.st_mtime if p.is_file() and st.st_size > 0 else None


def _composed_page(stem: str) -> tuple[Path | None, str | None]:
    """The page compose just wrote for `stem`, in the format deploy prefers,
    plus a note when a candidate was rejected. (None, None) when neither is
    there.

    `.webp` when it encoded to something non-empty (compose deletes a broken
    one), else the `.png` compose always writes.

    A webp OLDER than the png beside it is NOT the page compose just wrote — it
    is a leftover (or, on the cloud, a copy hydration restored from R2 over the
    fresh one). It used to win anyway, because this preferred `.webp`
    unconditionally, and it was then published under the new rects and deployed:
    frames cropped out of a page of the wrong size, and every rect past the
    short page's bottom edge dropped. An older webp is therefore ignored in
    favour of the png, and said out loud."""
    webp = ATLAS_DIR / f"{stem}_new.webp"
    png = ATLAS_DIR / f"{stem}_new.png"
    wt, pt = _page_mtime(webp), _page_mtime(png)
    if wt is not None and pt is not None and wt < pt - 1:
        return png, (f"ℹ Ignored {webp.name}: it is OLDER than {png.name} "
                     f"beside it, so it is not the page this compose wrote — "
                     f"used the .png.")
    if wt is not None:
        return webp, None
    if pt is not None:
        return png, None
    return None, None


def publish_pack_page(mp: Path, started_at: float) -> str | None:
    """Point a re-laid-out FROM-SCRATCH atlas's manifest at the page THIS tool
    composed, and make that page real in R2 first. Returns a log note, or None
    for a manifest this does not apply to.

    WHY. A from-scratch manifest's rects are re-derived on every Create Atlas —
    by `auto_pack_layout` from the generated art on `pack`, by `grid_layout`
    from the author's cell size on `grid` — so its geometry has exactly one
    producer: this tool. Its `atlas.source_image_path` pointed somewhere else
    entirely — a Flipbook sheet under `sheets/`, an imported page under
    `refs/atlas/` — pages NOBODY re-derives. The manifest therefore invalidated
    its own declared page the first time it was re-laid out: fresh rects, a page
    of a different size, and every consumer that crops the declared page by those
    rects (the editor, `/symbols`, `/flipbook`) slicing the wrong pixels. Naming
    our own composed page closes it — the rects and the page now come from the
    same producer, in the same run. `grid` needs it for exactly the same reason
    `pack` does: the export that creates one seeds `source_image` with nothing
    at all, and re-running Create Atlas after a cell-size change re-writes every
    rect, so a page pointer left alone would name whatever was there before.

    ORDERING. The page does not exist when `auto_pack_layout` runs (it is what
    compose is about to make) and its extension is not known until the WEBP
    encode either succeeds or doesn't. So the fields are written HERE, after the
    compose subprocess, and only after the bytes are in R2 — never the other way
    round, because a manifest naming a key that isn't in the bucket is the very
    failure this removes. `started_at` is when compose began: a page older than
    that is a LEFTOVER from an earlier run, not this packing, so it is refused
    rather than published under the new rects.

    The window this leaves is the compose itself — between `auto_pack_layout`'s
    save and this one the manifest carries new rects and its previous page
    pointer. That window is structural (compose must read the geometry it is
    composing, so the geometry has to be saved first) and it is not a
    regression: before this, that mismatched state was the PERMANENT one."""
    with _manifest_lock:
        m = _read_manifest_at(mp) or {}
    atlas = m.get("atlas") or {}
    if not batch_atlas.is_from_scratch(m):
        return None
    stem = mp.stem.replace("atlas_manifest_", "")
    page, pick_note = _composed_page(stem)
    tail = f"\n{pick_note}" if pick_note else ""
    if page is None:
        return ("⚠ Page pointer not updated: compose wrote no "
                f"{stem}_new.(webp|png) — the manifest still names its previous "
                f"page.")
    try:
        fresh = page.stat().st_mtime >= started_at - 2
    except OSError:
        fresh = False
    if not fresh:
        return (f"⚠ Page pointer not updated: {page.name} predates this compose "
                f"(leftover from an earlier run) — the manifest still names its "
                f"previous page." + tail)
    # THE STRUCTURAL CHECK, and the only one that cannot be fooled: MEASURE the
    # page. An mtime says when a file was last written, not what is in it —
    # hydration restoring an old page from R2 over the fresh one stamps a
    # perfectly fresh mtime on stale bytes, and that is exactly how a 2047x1173
    # page came to be published under a 1934x1612 packing (test6, 2026-09-16).
    # A page whose real size contradicts the manifest it would be published
    # under is never correct, so it is refused rather than pointed at: every
    # rect would crop the wrong pixels, and every rect past the shorter page's
    # edge would be dropped at deploy.
    try:
        with Image.open(page) as _pg:
            real = _pg.size
    except Exception as e:  # noqa: BLE001 — unreadable page = not publishable
        return (f"⚠ Page pointer not updated: {page.name} could not be read "
                f"({type(e).__name__}: {e}) — the manifest still names its "
                f"previous page." + tail)
    try:
        want = (int(atlas["width"]), int(atlas["height"]))
    except (KeyError, TypeError, ValueError):
        want = (0, 0)
    if want[0] > 0 and want[1] > 0 and real != want:
        return (f"⚠ Page pointer not updated: {page.name} is {real[0]}×{real[1]} "
                f"but this atlas packed {want[0]}×{want[1]} — that page is not "
                f"what this compose laid out (a leftover, or a copy restored "
                f"from R2 over it). Publishing it would crop every frame out of "
                f"the wrong canvas and drop the rows past its bottom edge. The "
                f"manifest still names its previous page; re-run Create Atlas."
                + tail)
    prefix = str(R2_PREFIX)
    if not prefix:
        return None  # local/dev with no bucket: nothing to point at
    key = f"{prefix}/atlas/{page.name}"
    try:
        storage.push_file(page, key)
    except Exception as e:  # noqa: BLE001 — a failed PUT must not rewrite fields
        return (f"⚠ Composed page not mirrored to R2 ({type(e).__name__}: {e}) "
                f"— the manifest still names its previous page rather than a key "
                f"that isn't in the bucket." + tail)
    with _manifest_lock:
        m = _read_manifest_at(mp) or {}
        atlas = m.setdefault("atlas", {})
        if not batch_atlas.is_from_scratch(m):
            return None  # re-read: it stopped owning its layout mid-compose
        was = str(atlas.get("source_image_path", ""))
        atlas["source_image"] = page.name
        atlas["source_image_path"] = key
        # Same reason as auto_pack_layout's pop — a descriptor for a page we just
        # replaced outranks the manifest's own rects in the launcher.
        atlas.pop("texturepacker_json", None)
        # `export_prefix` is deliberately LEFT: it is true provenance (where this
        # manifest came from) and it gates the ref auto-seed on activation.
        _write_manifest_at(mp, m)
    return (f"Page → {key}" + (f" (was {was})" if was and was != key else "")
            + tail)


# All four present and non-None = the region is PLACED on this page. Exactly the
# test `batch_atlas`'s compose applies (`_unplaced`), and it has to be: the guard
# below asks the question compose is about to answer, so a looser one here would
# let through a page compose then draws nothing on.
_PLACED_RECT_KEYS = ("x", "y", "w", "h")


def nothing_is_placed(m: dict) -> bool:
    """Would composing `m` draw NOT ONE region, because none of them has a rect?

    ONLY EVER TRUE FOR A FROM-SCRATCH ATLAS, and that restriction is the whole
    subtlety. On `pack`/`grid` a rect is derived output — the layout pass stamps
    one on every region it placed and none on the rest — so compose refuses
    `region_box`'s (0, 0, page) fallback for a region without one and skips it.
    A `.atlas`-bound or authored-geometry manifest reaches that same fallback ON
    PURPOSE (a single full-page image is authored by omitting the geometry), so
    a missing rect there is a placement rather than an absence and this stays
    False for it. `is_from_scratch`, not `layout == "pack"`, for the reason
    given on FROM_SCRATCH_LAYOUTS.

    ZERO, NOT "SOME". Half a page of rects is the normal working state — regions
    are generated a few at a time, and `auto_pack_layout` places the ones that
    have art and strips the ones that do not. Such an atlas must keep composing
    exactly as before: the placed regions are drawn, the rest are skipped. Only
    an atlas where compose would draw literally nothing is refused."""
    if not batch_atlas.is_from_scratch(m):
        return False
    return not any(
        all(r.get(k) is not None for k in _PLACED_RECT_KEYS)
        for bucket in ("regions", "rotated_regions")
        for r in (m.get(bucket) or [])
        if isinstance(r, dict) and r.get("name"))


def _blank_compose_report(m: dict, layout_note: str | None,
                          pre_note: str | None) -> str:
    """What the render panel shows INSTEAD of composing an empty page.

    The layout note is the RESULT of this run, not a preamble: it is the reason
    nothing was laid out and it already ends in the action that fixes it (type a
    cell size / generate a region, then Create Atlas). Reusing it verbatim is
    deliberate — a third wording of "no cell size" would be one more place for
    the advice to drift out of step with the code that refuses."""
    n = sum(1 for bucket in ("regions", "rotated_regions")
            for r in (m.get(bucket) or [])
            if isinstance(r, dict) and r.get("name"))
    layout = batch_atlas.atlas_layout(m) or "from-scratch"
    what = (f"Not one of this {layout} atlas's {n} region(s) is placed — none "
            f"of them has a rect"
            if n else f"This {layout} atlas has no regions at all")
    head = ("✖ Create Atlas composed NOTHING, and this atlas still shows the "
            "page it showed before.\n"
            f"{what}, so compose would have skipped every single region and "
            "written an EMPTY page over the one you have. Here is why, and "
            "what fixes it:\n")
    reason = layout_note or ("Generate at least one region — or, on a grid "
                             "atlas, set Default cell width + Default cell "
                             "height in 🧩 Atlas settings — then press Create "
                             "Atlas again.")
    return "\n".join(p for p in (pre_note, head, reason) if p) + "\n"


def run_compose(ctx: tuple[str, str] | None = None) -> None:
    # See run_render: re-apply the request thread's context on this worker.
    if ctx:
        project_paths.set_context(*ctx)
    # SAY "RUNNING" BEFORE THE SLOW PART, not when the subprocess starts.
    # `/createatlas` starts this thread and the page polls /progress right after
    # the POST returns; poll() stops the moment it reads `running: false`. Every
    # step below — the staging hydrate, the FX rebuild, the layout pass — used
    # to run with the flag still down, so a poll landing in that window ended
    # the loop against the PREVIOUS run's log. That was survivable while the
    # compose always wrote a page (it appeared anyway); it is not survivable now
    # that a run can end in a refusal whose only trace is this log. The `finally`
    # is what makes claiming it safe: whatever happens in here — the refusal
    # below, a raise, a subprocess that never starts — the flag comes back down.
    with _render_lock:
        _render_state.update(running=True, done=False, cur=0, total=1,
                             diagnostics=[], started=time.time(),
                             log="Create Atlas: preparing…\n")
    try:
        # Compose picks each region's variant PNG from batch/ in the subprocess,
        # so the variant pile must be on local disk first (it hydrates lazily).
        project_paths.ensure_lazy("batch/")
        with pinned_manifest(manifest_path()) as mp:
            _run_compose_pinned(mp)
    finally:
        with _render_lock:
            _render_state.update(running=False, done=True)


def _run_compose_pinned(mp: Path) -> None:
    """The compose pre-passes + the subprocess, all against ONE manifest.

    `mp` is pinned for this thread (pinned_manifest), so the helpers underneath
    — all_regions' `.atlas` resolution above all — see it too, not whatever the
    dropdown points at by the time they run."""
    # Refresh ALL FX layers from their current bases before composing, so the
    # atlas reflects the latest art. Best-effort: never block compose.
    pre_note = None
    try:
        rebuilt, fx_skipped = rebuild_fx_layers_at(mp, base_names=None)
        if rebuilt:
            pre_note = ("Auto-rebuilt %d FX layer(s) before compose: %s"
                        % (len(rebuilt), ", ".join(rebuilt)))
        if fx_skipped:
            _fs = _fx_skip_note(fx_skipped)
            pre_note = f"{pre_note}\n{_fs}" if pre_note else _fs
    except Exception as e:  # noqa: BLE001
        pre_note = f"[FX auto-rebuild skipped] {e}"
    # Restore any `fit_mode` a pre-fix handoff stripped, BEFORE the subprocess
    # reads the manifest. This is the moment the damage would land: without it
    # a stripped cell composes through the alpha-crop-and-rescale default and
    # every frame is silently rewritten. Says what it repaired — a placement
    # change the user did not ask for should never be silent.
    try:
        # Under the lock end to end: this one only inspects manifest fields, so
        # the whole cycle is microseconds and nothing can slip between the read
        # and the write.
        with _manifest_lock:
            m = _read_manifest_at(mp) or {}
            repaired = repair_sheet_fit_mode(m)
            if repaired:
                _write_manifest_at(mp, m)
        if repaired:
            _rn = ("Restored the sheet's placement on %d region(s) whose "
                   "fit_mode an earlier handoff dropped (they would otherwise "
                   "have been stretched to their rect): %s"
                   % (len(repaired), ", ".join(repaired[:8])
                      + (" …" if len(repaired) > 8 else "")))
            pre_note = f"{pre_note}\n{_rn}" if pre_note else _rn
    except Exception as e:  # noqa: BLE001 — never block compose on a repair
        _rn = f"[fit_mode repair skipped] {e}"
        pre_note = f"{pre_note}\n{_rn}" if pre_note else _rn
    # From-scratch atlases lay themselves out and write geometry onto the
    # manifest BEFORE the compose subprocess reads it: `pack` packs the
    # generated art into an auto-sized page, `grid` re-flows the regions through
    # the page + cell size the author set in ⚙ Settings. Both are re-derived on
    # EVERY Create Atlas — that is how an edited cell size reaches the page.
    # Each gates on its own layout, so exactly one of them ever does anything;
    # both no-op (None, False) for `.atlas`-bound / legacy cell-grid manifests.
    layout_note: str | None = None
    try:
        # Under the lock end to end. It measures every region's art, so it is
        # not instant — but it reads the same local files compose is about to
        # read anyway, and the geometry it stamps has to match the manifest the
        # subprocess is handed one line later.
        #
        # The write at the end does reach the network: _write_manifest_at
        # mirrors to R2 inside the lock, so a stalled PUT stalls saves. That is
        # true of every manifest write here (save_manifest always did it) and is
        # exactly why the SLOW producers above re-apply their fields instead of
        # being wrapped — this lock is for short writes, not for work.
        with _manifest_lock:
            m = _read_manifest_at(mp) or {}
            pack_note, pack_changed = auto_pack_layout(m)
            grid_note, grid_changed = grid_layout(m)
            # Save on the functions' OWN signal, not on the shape of their note.
            # The gate used to be `not note.startswith("⚠")` — but "nothing
            # generated yet" is a ⚠ that now still clears stale rects, and a
            # manifest neither owns is a None that must not be written. Only
            # they know whether they mutated anything.
            if pack_changed or grid_changed:
                _write_manifest_at(mp, m)
        layout_note = "\n".join(n for n in (pack_note, grid_note) if n) or None
    except Exception as e:  # noqa: BLE001 — never block compose on a layout hiccup
        layout_note = f"[auto-layout skipped] {e}"
    # NOTHING TO DRAW ⇒ NOTHING TO COMPOSE. The layout passes above refuse on
    # purpose — no cell size on `grid`, nothing generated yet on `pack` — and a
    # refusal leaves every region without a rect. Compose then skips every one
    # of them (batch_atlas's `_unplaced`) and still writes a page: a blank
    # atlas.width × atlas.height canvas, which `publish_pack_page` then points
    # the manifest at, superseding the page that was there. That is how a
    # correct refusal upstream came out as "my atlas is always empty now".
    # So refuse the compose too: no subprocess, no post-hook, and
    # `atlas.source_image`/`source_image_path` left exactly as they are.
    #
    # The layout note becomes the RESULT of the run instead of a preamble under
    # an empty page — it is the reason, and it already names the fix.
    #
    # Read back from DISK, deliberately: `mp` is what the subprocess is handed,
    # so the bytes on disk are what it would compose. That also keeps the guard
    # honest when the block above failed before (or during) its save.
    with _manifest_lock:
        laid_out = _read_manifest_at(mp) or {}
    if nothing_is_placed(laid_out):
        with _render_lock:
            _render_state.update(
                running=False, done=True, cur=0, total=1, diagnostics=[],
                log=_blank_compose_report(laid_out, layout_note, pre_note))
        return
    if layout_note:
        pre_note = f"{pre_note}\n{layout_note}" if pre_note else layout_note
    # Pass the manifest explicitly (full staging path) so compose reads the same
    # creative manifest the steps above just prepared — not whatever the
    # subprocess's config default would resolve against the script dir, and not
    # a different atlas if the dropdown moved while those steps ran.
    cmd = [PY, str(TOOLS / "batch_atlas.py"),
           "--manifest", str(mp),
           "--include-rotated", "--include-hidden", "--compose-only"]
    # `started_at` is read by the post-hook to tell the page compose is ABOUT to
    # write from a leftover of an earlier run (see publish_pack_page).
    started_at = time.time()
    _run_cmd(cmd, 1, pre_note=pre_note,
             post_hook=lambda: publish_pack_page(mp, started_at))


# The CRT boot splash lives in iw_common.splash (shared with the Sheet
# Maker). Default WORK pool = the atlas phrases, so behavior is unchanged.
SPLASH = splash_html("ATLAS MAKER")

# Vanilla ColorField (Photoshop-style picker) — twin of the launcher's
# $lib/ColorField.svelte and apps/launcher-api/static/shared/color-field.js.
# Enhances every <input type="color"> (e.g. the FX 'color' param) into the same
# click-drag popover the Svelte tools use. Injected as a PAGE.format() VALUE
# slot so its braces are NOT reprocessed. Keep in sync — see docs/ui-inventory.md §11.
try:
    COLOR_FIELD_JS = (Path(__file__).resolve().parent / "color-field.js").read_text(
        encoding="utf-8")
except OSError:
    COLOR_FIELD_JS = ""


# Blueprint exposed-params panel (B43 Phase 8). A static container the client
# fills with editable controls for the ACTIVE blueprint's params (re-rendered on
# pipeline change). Injected as a PAGE.format() VALUE slot so its braces are NOT
# reprocessed; the rendering JS lives inside PAGE (braces doubled there).
_BP_PARAMS_PANEL_HTML = (
    '<details class="settings" id="bpParamsPanel" style="display:none">'
    '<summary>🎛 Blueprint settings — '
    '<span id="bpParamsTitle"></span></summary>'
    '<div style="font-size:12px;color:#888;padding:2px 0 8px">'
    'Tunable knobs this blueprint exposes. Blank a field to fall back to its '
    'baked default. Saved per-atlas, per-blueprint.</div>'
    '<div class="cfggrid" id="bpParamsGrid"></div>'
    '<button onclick="saveBpParams(this)" style="margin-bottom:14px">'
    'Save blueprint settings</button>'
    '<span id="bpParamsStat" style="margin-left:12px;color:#999"></span>'
    '<div style="border-top:1px solid #36363d;margin-top:10px;padding-top:10px">'
    '<div style="font-size:12px;color:#888;padding-bottom:6px">'
    'See EXACTLY the ComfyUI graph this pipeline POSTs to /prompt for a real '
    'run — width/height, seed, prompts, refs and params are all injected, so '
    'copying your blueprint into ComfyUI by hand does NOT reproduce it.</div>'
    '<label class="lblrow" style="display:inline-block;margin-right:8px">Region '
    '<select id="bpResRegion" style="margin-left:4px"></select></label>'
    '<button onclick="resolveBpWorkflow(this)">'
    '⤓ Resolved workflow (as the pipeline sends it)</button>'
    '<span id="bpResStat" style="margin-left:12px;color:#999"></span>'
    '<div id="bpResOut" style="display:none;margin-top:10px"></div>'
    '</div>'
    '</details>')


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
    comfyui: '<circle cx="5" cy="7" r="2"/><circle cx="5" cy="17" r="2"/><circle cx="17" cy="12" r="2"/><path d="M7 7.6l8 3.2"/><path d="M7 16.4l8-3.2"/><path d="M19 12h2"/>',
    componentEditor: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="6" height="6" rx="1"/><rect x="13" y="11" width="4" height="6" rx="1"/>',
    storybook: '<path d="M12 6c-1.5-1.6-3.8-2.5-6.5-2.5H4v14h1.5c2.7 0 5 .9 6.5 2.5 1.5-1.6 3.8-2.5 6.5-2.5H20v-14h-1.5c-2.7 0-5 .9-6.5 2.5z"/><line x1="12" y1="6" x2="12" y2="20"/>',
    spineViewer: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><line x1="7.6" y1="16.4" x2="16.4" y2="7.6"/><circle cx="12" cy="12" r="1.3"/>',
    fontMaker: '<path d="M5 17 9.5 6h1L15 17"/><line x1="6.7" y1="13" x2="13.3" y2="13"/><line x1="4" y1="20" x2="20" y2="20"/>',
    localization: '<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3c2.6 2.6 2.6 15.4 0 18"/><path d="M12 3c-2.6 2.6-2.6 15.4 0 18"/>',
    ftpBrowser: '<circle cx="5" cy="6" r="1"/><line x1="9" y1="6" x2="20" y2="6"/><circle cx="5" cy="12" r="1"/><line x1="9" y1="12" x2="20" y2="12"/><circle cx="5" cy="18" r="1"/><line x1="9" y1="18" x2="20" y2="18"/>',
    gameMaker: '<rect x="2" y="7" width="20" height="10" rx="4"/><line x1="7" y1="12" x2="9" y2="12"/><line x1="8" y1="11" x2="8" y2="13"/><circle cx="15.5" cy="11" r="0.9" fill="currentColor" stroke="none"/><circle cx="17.5" cy="13" r="0.9" fill="currentColor" stroke="none"/>',
    gameConfig: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="M15 4v16"/><path d="M3 9.5h18"/><path d="M3 14.5h18"/>',
    flow: '<rect x="3" y="4" width="6" height="5" rx="1"/><rect x="15" y="9" width="6" height="5" rx="1"/><rect x="3" y="15" width="6" height="5" rx="1"/><path d="M9 6.5h3a2 2 0 0 1 2 2v1"/><path d="M9 17.5h3a2 2 0 0 0 2-2v-1"/>',
    fx: '<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="M5.6 5.6l2.8 2.8"/><path d="M15.6 15.6l2.8 2.8"/><path d="M18.4 5.6l-2.8 2.8"/><path d="M8.4 15.6l-2.8 2.8"/><circle cx="12" cy="12" r="1.6"/>',
    flipbook: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M7 5v4"/><path d="M11 5v4"/><path d="M15 5v4"/><path d="M7 15v4"/><path d="M11 15v4"/><path d="M15 15v4"/>',
    winText: '<path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2z"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="11.5" x2="13" y2="11.5"/>',
    sound: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4z"/><path d="M15.5 9.5a4 4 0 0 1 0 5"/><path d="M18 7a7.5 7.5 0 0 1 0 10"/>',
    rigger: '<circle cx="5" cy="19" r="1.8"/><line x1="6.3" y1="17.7" x2="11.5" y2="12.5"/><circle cx="13" cy="11" r="1.8"/><line x1="14.3" y1="9.7" x2="17" y2="7"/><rect x="16" y="4" width="3.5" height="3.5" rx="0.6"/>',
    symbols: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><rect x="9.6" y="9.6" width="4.8" height="4.8" rx="0.6" fill="currentColor" stroke="none"/>'
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
      if (/^#[0-9a-fA-F]{6}$/.test(t.accent || '')) ic.style.color = t.accent;
      var lb = document.createElement('span');
      lb.className = 'label';
      lb.textContent = (t.name || '').replace(/^Invisible /, '');
      a.appendChild(ic);
      a.appendChild(lb);
      nav.appendChild(a);
    });
  }
  // Responsive collapse — mirrors $lib/ToolTopBar.svelte. Drop the labels to an
  // icon-only row only when the labelled row would actually overflow its track
  // (measured, with hysteresis so it re-expands once room returns); if the
  // icon-only row still overflows, scroll it rather than clipping tools.
  if (nav) {
    var compact = false, naturalWidth = 0;
    var measure = function () {
      if (compact) {
        if (naturalWidth && nav.clientWidth >= naturalWidth + 8) {
          compact = false;
          nav.classList.remove('compact');
        }
      } else {
        naturalWidth = nav.scrollWidth;
        if (nav.scrollWidth > nav.clientWidth + 1) {
          compact = true;
          nav.classList.add('compact');
        }
      }
    };
    if (window.ResizeObserver) new ResizeObserver(measure).observe(nav);
    else window.addEventListener('resize', measure);
    measure();
  }
})();
</script>
"""

# The `.iw-toolbar` chrome's CSS. Like IW_TOOLBAR above this is a SEPARATE
# non-`.format()` string (single braces) so both PAGE (via the {iw_toolbar_css}
# slot) and the Region Overlay Inspector (ATLASVIEW, which is .replace()-based)
# render byte-identical tool-bar chrome from ONE definition.
IW_TOOLBAR_CSS = """
 /* unified tool bar — visual twin of the launcher $lib/ToolTopBar.svelte */
 .iw-toolbar{display:flex;align-items:center;gap:16px;padding:8px 0;border-bottom:1px solid #333}
 .iw-brand{display:flex;align-items:center;gap:9px;flex:none;font-weight:700;
   letter-spacing:.14em;text-transform:uppercase;color:#7ee0c0;font-size:14px;
   text-decoration:none;white-space:nowrap}
 .iw-switcher{display:flex;align-items:center;gap:4px;min-width:0;flex:1 1 auto;overflow:hidden}
 .iw-tool{display:inline-flex;align-items:center;gap:6px;flex:none;padding:5px 9px;
   border-radius:8px;border:1px solid transparent;color:#b9b9c4;text-decoration:none;
   font-size:12px;font-weight:600;white-space:nowrap}
 .iw-tool:hover{background:#23232a;border-color:#2f2f37;color:#fff}
 .iw-tool .ic{display:inline-flex;width:16px;height:16px}
 .iw-tool .ic svg{width:16px;height:16px;display:block}
 /* Collapse to icon-only when the labelled row would overflow the bar's own track
    (measured in JS), not at a blunt viewport breakpoint; scroll if even icon-only
    overflows rather than clipping tools off the edge. */
 .iw-switcher.compact .iw-tool .label{display:none}
 .iw-switcher.compact .iw-tool{padding:6px}
 /* icon-only still overflows → scroll rather than clipping tools off the edge */
 .iw-switcher.compact{overflow-x:auto;overflow-y:hidden}
"""

# ---------------------------------------------------------------------------
# Region Overlay Inspector (`/atlasview`) — the "🖼 View atlas" target.
#
# WHY: two composers disagree on what a region rect MEANS, so the same
# `bounds:` can produce visibly different art depending on who wrote the page.
# The inspector answers that with three INDEPENDENT readings, deliberately kept
# apart because they know different amounts:
#
# 1. INK COVERAGE (`FILLS` / `INSET n%`) — measured client-side from the
#    composed page: how much of the rect the art's alpha bbox covers. This is a
#    MEASUREMENT, NOT a provenance verdict, and must never be presented as one.
#    An earlier revision of this page claimed FILLS => "written by a
#    fill-the-slot composer" and a mixed page => "one page, two producers".
#    That inference is UNSOUND and was removed; innocent causes of FILLS in the
#    owner's own data:
#      * `T_UI_Spin_Edge` INSET 88% vs `T_UI_Spin_Edge_glow` FILLS 100% — same
#        art, same placement; shine.py's halo just blooms to the canvas edge.
#        More ink, not a different producer.
#      * `T_UI_Min`/`_Plus`/`_Turbo` FILLS with 0,0,0,0 margins — full-bleed
#        icon art renders edge-to-edge under the SHEET packer too (its scale
#        clamps at 1.0 and the canvas already equals the rect).
#    And the converse: an atlas-composed `fit_mode:"contain"` region reads
#    INSET despite having been upscaled. Coverage is still worth showing — it
#    is how you SEE a region sitting small in its slot — it just cannot testify
#    about who wrote it.
#
# 2. PLACEMENT MODE — which branch of `batch_atlas.fit_to_region` this region
#    will take on the NEXT compose (see `_placement_mode`, which mirrors that
#    dispatch — including the manifest's Frame trim, which decides whether the
#    art is cropped to its ink first and is passed in). This is read from the
#    manifest, not the pixels, and answers "will the sheet-parity path
#    (912e8f5) do anything for this page?" — only an EXPLICIT
#    `fit_mode:"contain"` reaches it, and only sheet-tool's
#    `atlas_writers.build_manifest` writes that field. A manifest imported from
#    a `.atlas` (`_tp_frame_to_region`) carries trim but no `fit_mode`, so its
#    regions default to `fill` and the parity fix is a no-op for them.
#
# 3. SHEET PARITY (`MATCHES SHEET` / `DIFFERS` / `NO SOURCE`) — the decisive
#    test and the headline. Server-side (`_parity_of`), per region: recompose
#    the tile from the region's SOURCE ART through the real
#    `_packer_compose_tile` and compare against the page's actual rect pixels.
#    Unlike (1) this is evidence rather than inference, and it directly
#    predicts whether re-running "Create Atlas" would move the region. Run
#    on-demand from the page (one `/parityscan` pass) — it opens every source
#    image, so it is not done eagerly on load.
#
# Reuse (docs/ui-inventory.md §5/§7): the alpha-bbox scan + cursor-anchored
# wheel zoom are ported from the Sheet Maker's canvas idiom
# (services/sheet-tool/ui.html `computeBbox` / `#viewport` wheel handler) — the
# named domain-B reference impl. Chrome comes from IW_TOOLBAR/IW_TOOLBAR_CSS.
#
# Built with `.replace()` on __TOKEN__ placeholders, NOT `.format()`, so the
# inline JS/CSS keeps its literal braces. Inline JS uses DOUBLE quotes inside
# single-quoted attributes (see gotcha_atlas_inline_js_quote_collision).
# ---------------------------------------------------------------------------
def _js_json(value) -> str:
    """JSON for embedding in an inline `<script>`. Escapes `<` so a region name
    containing `</script>` can't break out of the block (json.dumps alone does
    not escape it) — region names come from a manifest we don't author."""
    return json.dumps(value).replace("<", "\\u003c")


def _placement_mode(r: dict, keep_full: bool = False) -> dict:
    """Which branch of `batch_atlas.fit_to_region` this region will take.

    MIRRORS that function's dispatch exactly — keep the two in lockstep. The
    order matters and is not re-derivable by eye:
      0. `keep_full` (`batch_atlas.keep_full_frame` — `atlas.pack_trim: "keep"`
         on a from-scratch atlas) removes the alpha from the dispatch
         ENTIRELY: the sheet-parity short-circuit is skipped, nothing is
         cropped and nothing is padded, and the whole canvas is what `mode`
         then maps;
      1. otherwise an EXPLICIT `fit_mode == "contain"` short-circuits to the
         sheet-parity path (`_packer_compose_tile`, a verbatim replay of
         packer.compose);
      2. otherwise `mode = explicit or ("fill" if spine_slot else "contain")`,
         where `spine_slot = "orig_w" in region and "orig_h" in region`;
      3. that `mode` selects fill / cover / (else) the alpha-crop + letterbox
         "contain" — so an UNKNOWN explicit value silently lands on letterbox,
         which is why it gets its own label rather than being called "contain".

    `keep_full` is a property of the MANIFEST, not of the region, so it is
    passed in — `_view_region`'s caller has the manifest. Defaulting it to False
    keeps the answer right for every caller holding a region alone: the modes
    that ignore it (`.atlas`-bound, Sheet-Maker, legacy) are exactly the ones
    `keep_full_frame` gates out.

    Only sheet-tool's `atlas_writers.build_manifest` and the 🖼 To Atlas Maker
    export stamp `fit_mode:"contain"`; the `.atlas`/TexturePacker import path
    (`_tp_frame_to_region`) writes trim geometry but NO `fit_mode`. So this is
    the field that decides whether the sheet-parity path is reachable at all
    for a given manifest — hence the inspector reports it per region.

    `key` is stable (for counting/CSS); `label` is prose for the UI.
    Module-level + pure so it can be exercised offline."""
    explicit = str(r.get("fit_mode", "")).strip().lower()
    spine_slot = "orig_w" in r and "orig_h" in r
    if explicit == "contain" and not keep_full:
        return {"key": "parity", "label": "contain (explicit) → sheet parity",
                "note": "replays packer.compose verbatim — a Sheet-Maker cell "
                        "recomposes byte-identically to its sheet"}
    src = "the whole frame" if keep_full else "the alpha bbox"
    crop = ("no crop (Frame trim = keep the whole frame)" if keep_full
            else "crop to the alpha bbox")
    mode = explicit or ("fill" if spine_slot else "contain")
    if mode == "fill":
        return {"key": "fill",
                "label": "fill (explicit)" if explicit
                         else "fill (spine-slot default)",
                "note": f"{crop}, then stretch {src} to the slot exactly"}
    if mode == "cover":
        return {"key": "cover", "label": "cover (explicit)",
                "note": f"{crop}, scale {src} to cover the slot, "
                        f"crop the overflow"}
    return {"key": "contain",
            "label": ("contain (cell-grid default)" if not explicit
                      else "contain (explicit)" if explicit == "contain"
                      else "contain (fallback from \"%s\")" % explicit),
            "note": f"{crop}, uniform-scale {src} to fit, letterbox "
                    f"with transparent margin"}


def _view_region(r: dict, keep_full: bool = False) -> dict | None:
    """Normalize ONE region for the Region Overlay Inspector's payload.
    Returns None for a region with no usable rect (nothing to outline).
    Module-level + pure so the overlay math can be exercised offline."""
    try:
        w, h = int(r["w"]), int(r["h"])
    except (KeyError, TypeError, ValueError):
        return None
    pm = _placement_mode(r, keep_full)
    ox = int(r.get("off_x", 0) or 0)
    oy = int(r.get("off_y", 0) or 0)
    ow = int(r.get("orig_w", w) or w)
    oh = int(r.get("orig_h", h) or h)
    return {
        "name": str(r.get("name", "")),
        "x": int(r.get("x", 0) or 0),
        "y": int(r.get("y", 0) or 0),
        "w": w, "h": h,
        "rotated": bool(r.get("rotated")),
        "off_x": ox, "off_y": oy, "orig_w": ow, "orig_h": oh,
        # Only flag REAL trim — an untrimmed region's "frame" IS its rect, so
        # drawing it would just double every outline. Mirrors the `offsets:`
        # emit condition in atlas_format.write_atlas.
        "trim": (ox, oy, ow, oh) != (0, 0, w, h),
        "mode": pm["key"], "modeLabel": pm["label"], "modeNote": pm["note"],
    }


# Max per-channel difference still called MATCHES SHEET. In principle the test
# is EXACT: `_packer_compose_tile` is deterministic, PNG is lossless, and both
# sides run the identical LANCZOS resize, so a genuinely sheet-composed region
# recomposes byte-identically (measured: max delta 0 across a synthetic page —
# see the offline proof). The tolerance exists only to absorb a page that made
# a lossy round-trip somewhere (e.g. a WEBP-sourced re-import); it is far below
# any real placement difference, which moves ink by whole pixels and shows up
# as a delta of ~255 on the edges, not 2.
PARITY_TOL = 2


def _parity_source(region: dict) -> Path | None:
    """The art `compose` would place for this region, resolved the SAME way
    compose does (`override_image_path` first, else the picked/locked/latest
    variant). Any divergence here would make the parity verdict a lie."""
    p = batch_atlas.override_image_path(region)
    if p is not None and p.exists():
        return p
    p = batch_atlas._pick_variant_png(BATCH_DIR, region)
    return p if p is not None and p.exists() else None


def _ink_bbox(im: Image.Image):
    """Alpha bbox — the same ink test both composers apply."""
    return im.getchannel("A").getbbox()


def _parity_of(region: dict, page: Image.Image) -> dict:
    """Does this region's page pixels match what `packer.compose` would produce
    from its source art? THE discriminator — unlike the ink-fill ratio it is
    evidence, not inference, and it directly predicts whether re-running
    "Create Atlas" would move the region.

    Recomposes the tile through the REAL `batch_atlas._packer_compose_tile`
    (never a local copy — the parity fix is verified and must not be perturbed)
    and replays compose's `canvas.paste(img, (rx, ry), img)` onto a transparent
    canvas. That paste is NOT a no-op: PIL applies the mask to every band, so a
    semi-transparent pixel lands as `src * a` (and alpha as `a * a / 255`).
    Comparing the bare tile against the page would therefore differ on every
    soft edge — the paste must be replayed for the comparison to mean anything.
    """
    src = _parity_source(region)
    if src is None:
        return {"verdict": "NO SOURCE", "delta": "",
                "why": "no output_override and no generated variant — the art "
                       "compose would place can't be resolved, so this "
                       "region's pixels can't be predicted"}
    # A region with no rect is not on this page at all, so there is nothing to
    # compare. Must be answered BEFORE region_box, which in this process raises
    # on it: `batch_atlas.ATLAS_META` is only populated in the compose
    # subprocess, so its fallback resolves to int(None) here.
    if not all(region.get(k) is not None for k in ("x", "y", "w", "h")):
        return {"verdict": "NO SOURCE", "delta": "",
                "why": "not placed on this page — the region has no rect, so "
                       "Create Atlas did not pack it in (generate it first)"}
    rx, ry, tw, th = batch_atlas.region_box(region)
    rotated = bool(region.get("rotated"))
    try:
        with Image.open(src) as raw:
            img = raw.convert("RGBA")
        tile = batch_atlas._packer_compose_tile(img, tw, th, rotated)
    except (OSError, ValueError) as e:
        return {"verdict": "NO SOURCE", "delta": "",
                "why": f"source {src.name} could not be read: {e}"}
    fw, fh = tile.size
    expect = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    expect.paste(tile, (0, 0), tile)
    actual = page.crop((rx, ry, rx + fw, ry + fh))

    diff = ImageChops.difference(expect, actual)
    max_delta = max((hi for _, hi in diff.getextrema()), default=0)
    if max_delta <= PARITY_TOL:
        return {"verdict": "MATCHES SHEET", "delta": f"max Δ {max_delta}",
                "why": "the page pixels are what packer.compose produces from "
                       "this art — re-running Create Atlas would not move it",
                "src": src.name, "maxDelta": max_delta}

    eb, ab = _ink_bbox(expect), _ink_bbox(actual)
    bits = []
    if eb and ab:
        ew, eh = eb[2] - eb[0], eb[3] - eb[1]
        aw, ah = ab[2] - ab[0], ab[3] - ab[1]
        sw = (aw / ew) if ew else 0.0
        sh = (ah / eh) if eh else 0.0
        bits.append(f"{sw:.2f}x" if abs(sw - sh) < 0.02
                    else f"{sw:.2f}x×{sh:.2f}x")
        bits.append(f"origin ({eb[0]},{eb[1]})→({ab[0]},{ab[1]})")
    elif ab and not eb:
        bits.append("expected empty, page has ink")
    elif eb and not ab:
        bits.append("expected ink, page is empty")
    bits.append(f"max Δ {max_delta}")
    return {"verdict": "DIFFERS", "delta": ", ".join(bits),
            "why": "the page pixels are NOT packer.compose's output for this "
                   "art — some other placement wrote this rect, so a "
                   "re-Create-Atlas would move it",
            "src": src.name, "maxDelta": max_delta}


ATLASVIEW = """<!doctype html><html><head><meta charset="utf-8">
<title>Region overlay — Invisible Atlas Maker</title>
<style>
 body{font-family:system-ui,Arial;background:#1d1d22;color:#e8e8ea;margin:0;
   padding:0 20px;height:100vh;box-sizing:border-box;display:flex;flex-direction:column}
__TOOLBAR_CSS__
 .wrap{flex:1 1 auto;display:flex;gap:12px;min-height:0;padding:10px 0 12px}
 .side{width:290px;flex:none;display:flex;flex-direction:column;gap:8px;min-height:0}
 .panel{background:#23232a;border:1px solid #2f2f37;border-radius:8px;padding:10px}
 .panel h3{margin:0 0 8px;font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:#8a8a95}
 #viewport{flex:1 1 auto;position:relative;background:#141417;border:1px solid #2f2f37;
   border-radius:8px;overflow:hidden;min-width:0;cursor:grab}
 #viewport.drag{cursor:grabbing}
 #view{display:block;width:100%;height:100%}
 .hud{position:absolute;left:10px;bottom:10px;background:rgba(20,20,23,.86);
   border:1px solid #34343d;border-radius:6px;padding:6px 10px;font-size:12px;color:#b9b9c4}
 .sumbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#23232a;
   border:1px solid #2f2f37;border-radius:8px;padding:10px 14px;margin-top:10px;font-size:13px}
 .sumbar .mix{background:#241f12;border:1px solid #7a5a1f;color:#ffc14d;
   border-radius:5px;padding:4px 9px;font-weight:600}
 .sumbar .grp{display:flex;align-items:center;gap:6px}
 .sumbar .sep{color:#4a4a55}
 .tag{display:inline-block;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:700}
 .tag.fills{background:#3a2a12;color:#ffbf6d;border:1px solid #6a4a1f}
 .tag.inset{background:#241f12;color:#ffc14d;border:1px solid #7a5a1f}
 .tag.empty{background:#2a2a30;color:#8a8a95;border:1px solid #3a3a44}
 .tag.parity{background:#14331f;color:#7fe0a0;border:1px solid #2f6b42}
 .tag.differs{background:#4a1f1f;color:#ff8f8f;border:1px solid #7a2b2b}
 .tag.nosrc{background:#2a2a30;color:#8a8a95;border:1px solid #3a3a44}
 .tag.mode{background:#1c2c3d;color:#8ec8ff;border:1px solid #35566f;font-weight:600}
 .tag.mode.m-parity{background:#14331f;color:#7fe0a0;border-color:#2f6b42}
 .rows{overflow:auto;flex:1 1 auto;min-height:0}
 .row{padding:6px 8px;border-radius:5px;cursor:pointer;border:1px solid transparent;font-size:12px}
 .row:hover{background:#2b2b33} .row.sel{background:#243447;border-color:#5db0ff}
 .row .nm{color:#e8e8ea;font-weight:600;word-break:break-all}
 .row .sub{color:#8a8a95;font-size:11px;margin-top:2px;font-family:ui-monospace,Consolas,monospace}
 input[type=text]{width:100%;box-sizing:border-box;background:#1a1a1e;color:#ddd;
   border:1px solid #333;border-radius:4px;padding:6px 8px;font-size:13px}
 label.tog{display:flex;align-items:center;gap:7px;font-size:12px;color:#c7c7cf;padding:3px 0;cursor:pointer}
 .sw{width:11px;height:11px;border-radius:2px;flex:none}
 button{background:#444;color:#fff;border:0;padding:7px 12px;border-radius:6px;cursor:pointer;font-size:13px}
 button:hover{background:#555}
 .err{margin:40px auto;max-width:560px;background:#241616;border:1px solid #7a2b2b;
   border-radius:8px;padding:18px;color:#ffd5d5}
 .legend{font-size:11px;color:#8a8a95;line-height:1.5;margin-top:8px}
</style></head><body>
__TOOLBAR__
<div class="wrap">
 <div class="side">
  <div class="panel">
   <h3>Overlays</h3>
   <label class="tog"><input type="checkbox" id="tRect" checked>
    <span class="sw" style="background:#5db0ff"></span>Region rect (manifest bounds)</label>
   <label class="tog"><input type="checkbox" id="tArt" checked>
    <span class="sw" style="background:#ffc14d"></span>Art alpha bbox (measured)</label>
   <label class="tog"><input type="checkbox" id="tTrim" checked>
    <span class="sw" style="background:#7ee0c0"></span>Untrimmed frame (Y-down)</label>
   <label class="tog"><input type="checkbox" id="tLbl" checked>
    <span class="sw" style="background:#8a8a95"></span>Labels</label>
   <div style="display:flex;gap:6px;margin-top:8px">
    <button onclick="fitView()">Fit</button>
    <button onclick="zoomBy(1.25)">+</button>
    <button onclick="zoomBy(0.8)">&minus;</button>
   </div>
  </div>
  <div class="panel">
   <h3>Sheet parity</h3>
   <div style="font-size:11px;color:#8a8a95;line-height:1.45;margin-bottom:8px">
    Recomposes every region from its source art through the real
    <code>packer.compose</code> replay and diffs it against the page pixels.
    Reads every source image, so it runs on demand.</div>
   <button id="pbtn" onclick="runParity()">&#9654; Run sheet-parity scan</button>
   <div id="pstat" style="font-size:11px;color:#8a8a95;margin-top:6px"></div>
  </div>
  <div class="panel" style="display:flex;flex-direction:column;flex:1 1 auto;min-height:0">
   <h3>Regions (<span id="rcount">0</span>)</h3>
   <input type="text" id="filter" placeholder="filter by name…" oninput="renderList()">
   <div class="rows" id="rows"></div>
  </div>
 </div>
 <div id="viewport"><canvas id="view"></canvas>
  <div class="hud" id="hud">loading…</div>
 </div>
</div>
<div class="sumbar" id="sumbar">measuring…</div>
<div class="legend" style="padding-bottom:10px">
 <b>Sheet parity</b> (run the scan) recomposes the region from its source art with the real
 <code>packer.compose</code> replay and diffs it against the page pixels.
 <span class="tag parity">MATCHES SHEET</span> = identical within a tolerance of
 <b>max &Delta;__TOL__</b> per channel &mdash; re-running <b>Create Atlas</b> would not move it.
 <span class="tag differs">DIFFERS</span> = something else placed this rect; the delta reports how
 far off (ink scale ratio + origin shift). <span class="tag nosrc">NO SOURCE</span> = the art
 can't be resolved, so nothing can be predicted. This is the only reading here that is
 <i>evidence</i> of how a region was placed.
 <br>
 <b>Placement mode</b> is read from the manifest: which branch of <code>fit_to_region</code> the
 NEXT compose will take. Only an <b>explicit <code>fit_mode:"contain"</code></b> reaches the
 sheet-parity path, and only the Sheet Maker writes that field &mdash; regions imported from a
 <code>.atlas</code> carry trim but no <code>fit_mode</code> and default to <b>fill</b>.
 <br>
 <b>Ink coverage</b> is a measurement, <i>not</i> a verdict about who wrote the page.
 <span class="tag fills">FILLS</span> = the alpha bbox reaches the rect edge on both axes
 (&ge;__FILLT__%); <span class="tag inset">INSET n%</span> = it covers n% of the rect's smaller
 axis. Both composers can produce either: full-bleed art FILLS under the sheet packer too, an FX
 halo FILLS while its base is INSET, and a <code>contain</code> region reads INSET even when it was
 upscaled. Use it to SEE an element sitting small in its slot &mdash; not to infer provenance.
 Fill % and margins are in the region's <i>unrotated</i> (authored) axes.
 The untrimmed frame is drawn in the manifest's own TexturePacker Y-DOWN-from-top
 <code>off_y</code> convention (NOT Spine's Y-up) — as stored, uncorrected.
</div>
<script>
var REGIONS = __REGIONS__;
var PAGE_URL = __PAGE_URL__;
var MANIFEST = __MANIFEST__;
var HAS_PAGE = __HAS_PAGE__;

var C_RECT = "#5db0ff", C_ART = "#ffc14d", C_TRIM = "#7ee0c0", C_SEL = "#ffffff";
var FILL_T = 0.98;            // >= this on BOTH axes (unrotated) => FILLS
var PARITY = {};              // name -> /parityscan verdict (empty until run)
var PARITY_RUN = false;

var cv = document.getElementById("view");
var ctx = cv.getContext("2d");
var vp = document.getElementById("viewport");
var pageImg = null, pageW = 0, pageH = 0;
var pctx = null;              // offscreen 2d ctx holding the page pixels
var zoom = 1, panX = 0, panY = 0, sel = "";

function $(id){ return document.getElementById(id); }

/* A rotated region's PACKED FOOTPRINT on the page is (h x w): both composers
   fit the art upright to (w, h) and then PIL rotate(-90, expand) it. So w/h in
   the manifest are the UNROTATED size and must be swapped to read the page. */
function footprint(r){
  return r.rotated ? {x:r.x, y:r.y, w:r.h, h:r.w} : {x:r.x, y:r.y, w:r.w, h:r.h};
}

/* Untrimmed frame in PAGE space, in the manifest's own Y-down convention.
   Unrotated: the trimmed rect sits at (off_x, off_y) inside (orig_w, orig_h).
   Rotated: rotate(-90) maps upright (u, v) -> page-local (h - v, u), so the
   upright frame [-off_x, -off_x+orig_w] x [-off_y, -off_y+orig_h] becomes
   x: h + off_y - orig_h .. h + off_y   (width orig_h)
   y: -off_x .. -off_x + orig_w         (height orig_w)
   Sanity: an untrimmed rotated region (off=0, orig=w/h) gives back (x, y, h, w). */
function trimFrame(r){
  if(!r.trim) return null;
  if(r.rotated) return {x:r.x + r.h + r.off_y - r.orig_h, y:r.y - r.off_x,
                        w:r.orig_h, h:r.orig_w};
  return {x:r.x - r.off_x, y:r.y - r.off_y, w:r.orig_w, h:r.orig_h};
}

/* Opaque bounding box of the page pixels under a rect (page space).
   Ported from the Sheet Maker's computeBbox (services/sheet-tool/ui.html):
   alpha > 0, which is exactly what PIL's getchannel("A").getbbox() — the test
   BOTH composers apply — considers ink. Same-origin /atlasimg, so no taint. */
function bboxIn(f){
  var x0 = Math.max(0, f.x), y0 = Math.max(0, f.y);
  var x1 = Math.min(pageW, f.x + f.w), y1 = Math.min(pageH, f.y + f.h);
  if(x1 <= x0 || y1 <= y0) return null;
  var w = x1 - x0, h = y1 - y0;
  var d = pctx.getImageData(x0, y0, w, h).data;
  var bx0 = w, by0 = h, bx1 = 0, by1 = 0, found = false;
  for(var y = 0; y < h; y++){
    var row = y * w;
    for(var x = 0; x < w; x++){
      if(d[(row + x) * 4 + 3] > 0){
        found = true;
        if(x < bx0) bx0 = x;
        if(x >= bx1) bx1 = x + 1;
        if(y < by0) by0 = y;
        if(y >= by1) by1 = y + 1;
      }
    }
  }
  if(!found) return null;
  return {x:x0 + bx0, y:y0 + by0, w:bx1 - bx0, h:by1 - by0};
}

/* Measure one region's INK COVERAGE: alpha bbox + how much of the rect it
   covers. `cov` is a description of the pixels, NOT a claim about which
   composer wrote them (full-bleed art fills the rect under either one) — see
   the ATLASVIEW header. Fill/margins are reported in the region's UNROTATED
   axes so they line up with its w x h label (a rotated region's page-space
   bbox has its axes swapped). */
function measure(r){
  var f = footprint(r);
  var bb = bboxIn(f);
  if(!bb) return {cov:"EMPTY", bbox:null, fillW:0, fillH:0, fill:0,
                  ml:0, mt:0, mr:0, mb:0};
  var lx = bb.x - f.x, ly = bb.y - f.y;                 // bbox origin in the rect
  var bw = bb.w, bh = bb.h, ol = lx, ot = ly;
  if(r.rotated){                                        // page axes -> upright axes
    bw = bb.h; bh = bb.w;
    ol = ly;                                            // upright u = page-local y
    ot = f.w - (lx + bb.w);                             // upright v = h - page-local x
  }
  var fw = r.w ? bw / r.w : 0, fh = r.h ? bh / r.h : 0;
  var cov = (fw >= FILL_T && fh >= FILL_T) ? "FILLS" : "INSET";
  return {cov:cov, bbox:bb, fillW:fw, fillH:fh, fill:Math.min(fw, fh),
          ml:ol, mt:ot, mr:r.w - (ol + bw), mb:r.h - (ot + bh)};
}

function pct(v){ return Math.round(v * 100) + "%"; }
function covLabel(m){ return m.cov === "INSET" ? "INSET " + pct(m.fill) : (m.cov || "?"); }
function covClass(m){
  return m.cov === "FILLS" ? "fills" : m.cov === "EMPTY" ? "empty" : "inset";
}
function parityClass(v){
  return v === "MATCHES SHEET" ? "parity" : v === "DIFFERS" ? "differs" : "nosrc";
}

/* ---------- view transform ---------- */
function fitView(){
  var availW = vp.clientWidth - 40, availH = vp.clientHeight - 40;
  zoom = Math.min(availW / pageW, availH / pageH, 4);
  if(!isFinite(zoom) || zoom <= 0) zoom = 1;
  panX = (vp.clientWidth - pageW * zoom) / 2;
  panY = (vp.clientHeight - pageH * zoom) / 2;
  draw();
}
function zoomBy(f){ zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, f); }
/* cursor-anchored zoom — the Sheet Maker's #viewport wheel idiom, expressed as
   a pan offset (this canvas transforms, it doesn't scroll). */
function zoomAt(sx, sy, f){
  var nz = Math.max(0.02, Math.min(32, zoom * f));
  if(nz === zoom) return;
  panX = sx - (sx - panX) * (nz / zoom);
  panY = sy - (sy - panY) * (nz / zoom);
  zoom = nz;
  draw();
}
function focusRegion(name){
  var r = REGIONS.filter(function(q){ return q.name === name; })[0];
  if(!r) return;
  sel = name;
  var f = footprint(r);
  zoom = Math.max(0.02, Math.min(32,
    Math.min((vp.clientWidth - 80) / f.w, (vp.clientHeight - 80) / f.h, 8)));
  panX = vp.clientWidth / 2 - (f.x + f.w / 2) * zoom;
  panY = vp.clientHeight / 2 - (f.y + f.h / 2) * zoom;
  draw();
  renderList();
}

/* ---------- draw ---------- */
function sxOf(x){ return x * zoom + panX; }
function syOf(y){ return y * zoom + panY; }

function box(f, col, dash){
  ctx.strokeStyle = col;
  ctx.lineWidth = 1;
  ctx.setLineDash(dash || []);
  ctx.strokeRect(Math.round(sxOf(f.x)) + 0.5, Math.round(syOf(f.y)) + 0.5,
                 Math.round(f.w * zoom), Math.round(f.h * zoom));
  ctx.setLineDash([]);
}

function draw(){
  var W = vp.clientWidth, H = vp.clientHeight;
  var dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if(!pageImg) return;
  // checkerboard so transparent margin reads as transparent, not as black
  var t = 8;
  ctx.fillStyle = "#26262c"; ctx.fillRect(sxOf(0), syOf(0), pageW * zoom, pageH * zoom);
  ctx.fillStyle = "#1e1e23";
  ctx.save();
  ctx.beginPath(); ctx.rect(sxOf(0), syOf(0), pageW * zoom, pageH * zoom); ctx.clip();
  for(var yy = 0; yy < Math.ceil(pageH * zoom / t) + 1; yy++)
    for(var xx = (yy % 2); xx < Math.ceil(pageW * zoom / t) + 1; xx += 2)
      ctx.fillRect(sxOf(0) + xx * t, syOf(0) + yy * t, t, t);
  ctx.restore();
  ctx.imageSmoothingEnabled = zoom < 3;
  ctx.drawImage(pageImg, sxOf(0), syOf(0), pageW * zoom, pageH * zoom);
  box({x:0, y:0, w:pageW, h:pageH}, "#3a3a44");

  var showRect = $("tRect").checked, showArt = $("tArt").checked;
  var showTrim = $("tTrim").checked, showLbl = $("tLbl").checked;
  ctx.font = "11px ui-monospace,Consolas,monospace";
  ctx.textBaseline = "alphabetic";
  REGIONS.forEach(function(r){
    var f = footprint(r);
    var isSel = r.name === sel;
    if(showTrim){ var tf = trimFrame(r); if(tf) box(tf, C_TRIM, [3, 3]); }
    if(showRect) box(f, isSel ? C_SEL : C_RECT);
    if(showArt && r._m && r._m.bbox) box(r._m.bbox, isSel ? C_SEL : C_ART, [2, 2]);
    if(showLbl && (zoom > 0.22 || isSel)){
      var lbl = r.name + "  " + r.w + "\\u00d7" + r.h + (r.rotated ? " \\u21bb" : "");
      /* Parity is the headline once scanned — it is evidence; coverage is only
         a description of the ink, so it steps down to the trailing slot. */
      var p = PARITY[r.name];
      var text = lbl + (p ? "  [" + p.verdict + "]" : "") +
                 (r._m ? "  " + covLabel(r._m) : "");
      var tw = ctx.measureText(text).width;
      var lx = Math.round(sxOf(f.x)), ly = Math.round(syOf(f.y));
      ctx.fillStyle = "rgba(15,15,18,.82)";
      ctx.fillRect(lx, ly - 14, tw + 8, 14);
      ctx.fillStyle = isSel ? C_SEL
        : p ? (p.verdict === "MATCHES SHEET" ? "#7fe0a0"
               : p.verdict === "DIFFERS" ? "#ff8f8f" : "#8a8a95")
        : (r._m && r._m.cov === "EMPTY") ? "#8a8a95" : "#ffc14d";
      ctx.fillText(text, lx + 4, ly - 3);
    }
  });
  $("hud").textContent = pageW + " \\u00d7 " + pageH + " px \\u00b7 " +
    Math.round(zoom * 100) + "% \\u00b7 " + REGIONS.length + " regions" +
    (sel ? " \\u00b7 " + sel : "");
}

/* ---------- list + summary ---------- */
function renderList(){
  var q = ($("filter").value || "").toLowerCase();
  var rows = $("rows");
  rows.innerHTML = "";
  var shown = 0;
  REGIONS.forEach(function(r){
    if(q && r.name.toLowerCase().indexOf(q) < 0) return;
    shown++;
    var m = r._m || {};
    var d = document.createElement("div");
    d.className = "row" + (r.name === sel ? " sel" : "");
    var p = PARITY[r.name];
    /* Order = confidence: parity (evidence) first, then the mode the next
       compose will use, then ink coverage (a description, not a verdict). */
    var head = "<div class=\\"nm\\">" + esc(r.name) +
      (p ? " <span class=\\"tag " + parityClass(p.verdict) + "\\" title=\\"" +
           esc(p.why || "") + "\\">" + esc(p.verdict) + "</span>" : "") +
      " <span class=\\"tag " + covClass(m) + "\\">" + covLabel(m) + "</span></div>";
    var mode = "<div class=\\"sub\\"><span class=\\"tag mode m-" + esc(r.mode) +
      "\\" title=\\"" + esc(r.modeNote || "") + "\\">" + esc(r.modeLabel) + "</span></div>";
    var delta = (p && p.delta)
      ? "<div class=\\"sub\\">" + esc(p.delta) + (p.src ? " \\u00b7 " + esc(p.src) : "") + "</div>"
      : (p ? "<div class=\\"sub\\">" + esc(p.why || "") + "</div>" : "");
    d.innerHTML = head + mode + delta +
      "<div class=\\"sub\\">" + r.x + "," + r.y + " " + r.w + "\\u00d7" + r.h +
      (r.rotated ? " rot" : "") + (r.trim ? " trim" : "") +
      (m.bbox ? " \\u00b7 fill " + pct(m.fillW) + "\\u00d7" + pct(m.fillH) +
        " \\u00b7 m " + m.ml + "," + m.mt + "," + m.mr + "," + m.mb : "") +
      "</div>";
    d.addEventListener("click", function(){ focusRegion(r.name); });
    rows.appendChild(d);
  });
  $("rcount").textContent = shown + (shown === REGIONS.length ? "" : " / " + REGIONS.length);
}
function esc(s){ var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

/* Summary. Three separate readings, never blended into one "verdict":
   parity (evidence) > placement mode (what the next compose will do) > ink
   coverage (a measurement). Deliberately makes NO claim about who wrote the
   page — a FILLS/INSET mix does not imply two producers. */
var MODE_ORDER = ["parity", "fill", "contain", "cover"];
function summarize(){
  var cov = {FILLS:0, INSET:0, EMPTY:0};
  var modes = {}, modeLabel = {};
  REGIONS.forEach(function(r){
    if(r._m && cov[r._m.cov] !== undefined) cov[r._m.cov]++;
    modes[r.mode] = (modes[r.mode] || 0) + 1;
    modeLabel[r.mode] = r.modeLabel;
  });
  var s = "<span class=\\"grp\\"><b>" + REGIONS.length + "</b> regions on <code>" +
    esc(MANIFEST) + "</code></span>";

  /* Headline: the recompose verdict, once it has been run. */
  if(PARITY_RUN){
    var pc = {"MATCHES SHEET":0, "DIFFERS":0, "NO SOURCE":0};
    REGIONS.forEach(function(r){
      var p = PARITY[r.name];
      if(p && pc[p.verdict] !== undefined) pc[p.verdict]++;
    });
    s += "<span class=\\"sep\\">|</span><span class=\\"grp\\"><b>Sheet parity:</b> " +
      "<span class=\\"tag parity\\">MATCHES SHEET</span> " + pc["MATCHES SHEET"] +
      " <span class=\\"tag differs\\">DIFFERS</span> " + pc["DIFFERS"] +
      " <span class=\\"tag nosrc\\">NO SOURCE</span> " + pc["NO SOURCE"] + "</span>";
  }

  /* Does the sheet-parity path apply to this page at all? */
  var mbits = [];
  MODE_ORDER.concat(Object.keys(modes)).forEach(function(k){
    if(!modes[k] || mbits.indexOf(k) >= 0) return;
    mbits.push(k);
  });
  var mtxt = mbits.map(function(k){
    return "<span class=\\"tag mode m-" + esc(k) + "\\">" + esc(modeLabel[k]) +
           "</span> " + modes[k];
  }).join(" ");
  s += "<span class=\\"sep\\">|</span><span class=\\"grp\\"><b>Placement:</b> " + mtxt + "</span>";
  if(!modes.parity){
    s += " <span class=\\"mix\\">\\u26a0 No region on this page carries an explicit " +
      "fit_mode:\\"contain\\", so the sheet-parity compose path is unreachable here \\u2014 " +
      "this manifest was not written by the Sheet Maker.</span>";
  }

  s += "<span class=\\"sep\\">|</span><span class=\\"grp\\"><b>Ink coverage:</b> " +
    "<span class=\\"tag fills\\">FILLS</span> " + cov.FILLS + " " +
    "<span class=\\"tag inset\\">INSET</span> " + cov.INSET +
    (cov.EMPTY ? " <span class=\\"tag empty\\">EMPTY</span> " + cov.EMPTY : "") +
    "</span>";
  $("sumbar").innerHTML = s;
}

/* On-demand: one server pass recomposes every region through the real
   packer.compose replay and diffs it against the page. */
function runParity(){
  var b = $("pbtn");
  b.disabled = true;
  $("pstat").textContent = "recomposing " + REGIONS.length + " regions\\u2026";
  fetch("/parityscan?t=" + Date.now()).then(function(res){ return res.json(); })
   .then(function(j){
     b.disabled = false;
     if(j.error){ $("pstat").textContent = "failed: " + j.error; return; }
     PARITY = j.regions || {};
     PARITY_RUN = true;
     $("pstat").textContent = "done in " + j.ms + " ms \\u00b7 tolerance max \\u0394 " + j.tol;
     summarize(); renderList(); draw();
   })
   .catch(function(e){ b.disabled = false; $("pstat").textContent = "failed: " + e; });
}

/* ---------- interaction ---------- */
vp.addEventListener("wheel", function(e){
  e.preventDefault();
  var rb = vp.getBoundingClientRect();
  zoomAt(e.clientX - rb.left, e.clientY - rb.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
}, {passive:false});

var drag = null;
vp.addEventListener("mousedown", function(e){
  drag = {x:e.clientX, y:e.clientY, px:panX, py:panY, moved:false};
  vp.classList.add("drag");
});
window.addEventListener("mousemove", function(e){
  if(!drag) return;
  var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if(Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
  panX = drag.px + dx; panY = drag.py + dy;
  draw();
});
window.addEventListener("mouseup", function(e){
  if(drag && !drag.moved){
    var rb = vp.getBoundingClientRect();
    var px = (e.clientX - rb.left - panX) / zoom, py = (e.clientY - rb.top - panY) / zoom;
    var hit = "";
    REGIONS.forEach(function(r){
      var f = footprint(r);
      if(px >= f.x && px < f.x + f.w && py >= f.y && py < f.y + f.h) hit = r.name;
    });
    sel = hit;
    draw();
    renderList();
  }
  drag = null;
  vp.classList.remove("drag");
});
["tRect", "tArt", "tTrim", "tLbl"].forEach(function(id){
  $(id).addEventListener("change", draw);
});
window.addEventListener("resize", draw);

/* ---------- boot ---------- */
if(!HAS_PAGE){
  document.body.innerHTML = "<div class=\\"err\\"><b>No composed atlas yet.</b><br>" +
    "Build one with <b>\\ud83e\\udde9 Create Atlas</b> in the Atlas Maker, then re-open this view." +
    "</div>";
} else {
  var im = new Image();
  im.onload = function(){
    pageImg = im; pageW = im.naturalWidth; pageH = im.naturalHeight;
    var off = document.createElement("canvas");
    off.width = pageW; off.height = pageH;
    pctx = off.getContext("2d", {willReadFrequently:true});
    pctx.drawImage(im, 0, 0);
    REGIONS.forEach(function(r){ r._m = measure(r); });
    summarize();
    renderList();
    fitView();
  };
  im.onerror = function(){ $("hud").textContent = "failed to load the composed page"; };
  im.src = PAGE_URL;
}
</script>
</body></html>
"""

PAGE = """<!doctype html><html><head><meta charset="utf-8">
<title>Invisible Atlas Maker</title>
<script>{color_field_js}</script>
<script>
/* Every region paints two thumbs (output + reference), so a 60-region atlas
   asks for ~120 images. Whatever drops one of them — the proxy, a worker
   thread, a decode — the browser keeps that broken tile for the life of the
   page, and the art "isn't there" even though the file is. So no image load
   is allowed to fail once: retry with backoff, and only mark a tile after it
   has refused four times.

   In <head> so it is listening before the first card <img> is parsed, and in
   the capture phase because load/error do not bubble. The `retry` param is
   throwaway — a failed response can be negatively cached, so the URL has to
   change for the browser to actually re-request. */
(function(){{
 var BACKOFF=[400,1200,3000,7000];
 document.addEventListener('error',function(e){{
  var im=e.target;
  if(!im||im.tagName!=='IMG')return;
  var n=+(im.dataset.imgretry||0);
  if(n>=BACKOFF.length){{
   im.classList.add('imgfail');
   im.title='This image failed to load '+(n+1)+' times. Reload the page to try again.';
   return;
  }}
  im.dataset.imgretry=n+1;
  var src=im.src;
  setTimeout(function(){{
   // The src moved on while we waited (refreshCards, a variant pick) — that
   // newer load owns the tile now, and re-asserting a stale URL would show
   // the previous render.
   if(im.src!==src)return;
   var u=new URL(src,location.href);
   u.searchParams.set('retry',n+1);
   im.src=u.pathname+u.search;
  }},BACKOFF[n]);
 }},true);
 document.addEventListener('load',function(e){{
  var im=e.target;
  if(im&&im.tagName==='IMG'&&im.dataset.imgretry){{
   delete im.dataset.imgretry; im.classList.remove('imgfail');
  }}
 }},true);
}})();
</script>
<style>
 body{{font-family:system-ui,Arial;background:#1d1d22;color:#e8e8ea;margin:0;padding:0 20px 40px}}
{iw_toolbar_css}
 .credits{{float:right;font-size:13px;font-weight:600;color:#cfeede;background:#2e6b3e;border:1px solid #3f8a52;border-radius:6px;padding:6px 12px;text-decoration:none;white-space:nowrap}}
 .credits.low{{background:#7a4a1f;border-color:#a4702f;color:#ffe2bd}}
 .credits.err{{background:#7a2f2f;border-color:#a44;color:#ffd5d5}}
 .filefld{{display:flex;gap:4px;align-items:stretch}} .filefld input{{flex:1}}
 .fbtn{{background:#444;color:#fff;border:0;border-radius:4px;padding:0 9px;cursor:pointer;font-size:14px}} .fbtn:hover{{background:#555}}
 .fsrow{{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;cursor:pointer}}
 .fsrow:hover{{background:#33333a}} .fsrow .ic{{width:18px;text-align:center}}
 .fsrow.file{{color:#cfeede}} .fsrow.up{{color:#9bb;font-weight:600}}
 .bar{{position:sticky;top:0;background:#1d1d22;padding:10px 6px;border-bottom:1px solid #333;margin-bottom:16px;z-index:50;display:flex;flex-wrap:wrap;align-items:center;gap:14px}}
 .bargrp{{display:flex;align-items:center;gap:6px;padding:6px 10px 6px 8px;border-radius:8px;background:#23232a;border:1px solid #2f2f37;position:relative}}
 .bargrp > .glbl{{font-size:10px;color:#8a8a95;text-transform:uppercase;letter-spacing:.6px;font-weight:700;padding:0 6px 0 2px;border-right:1px solid #34343d;margin-right:4px;align-self:stretch;display:flex;align-items:center}}
 .barspacer{{flex:1}}
 .barstatus{{display:flex;align-items:center;gap:8px;margin-left:auto}}
 button,a.btnlink{{background:#3f789e;color:#fff;border:0;padding:9px 16px;border-radius:6px;cursor:pointer;font-size:14px;position:relative;overflow:hidden}}
 button:hover,a.btnlink:hover{{background:#4f8aae}} button:disabled{{cursor:wait}}
 a.btnlink{{text-decoration:none;display:inline-block;line-height:normal;box-sizing:border-box}}
 button.alt,a.btnlink.alt{{background:#444}} button.alt:hover,a.btnlink.alt:hover{{background:#555}}
 button.done{{background:#2e8b46 !important}}
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
 /* Where the model dropdowns' values came from. Without this a degraded
    free-text field was the only signal that anything had gone wrong. */
 .mdlstat{{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
   font-size:12px;line-height:1.45;padding:8px 10px;margin:2px 0 10px;
   border-radius:6px;border:1px solid #36363d;background:#212127}}
 .mdlstat.ok{{border-color:#3c6b3c;color:#9ed49e}}
 .mdlstat.warn{{border-color:#7a6224;color:#e0bc6a}}
 .mdlstat.bad{{border-color:#7a3535;color:#e08a8a}}
 .mdlstat button{{font-size:12px;padding:4px 9px}}
 .cfggrid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;padding:6px 0 16px}}
 .cfggrid label{{display:flex;flex-direction:column;font-size:12px;color:#aaa;gap:3px}}
 .cfggrid .qm{{cursor:help;color:#6fb0c8;font-weight:700;margin-left:5px;border:1px solid #3a5b66;border-radius:50%;padding:0 5px;font-size:11px}}
 .cfggrid .lblrow{{display:flex;align-items:center}}
 .cfggrid input,.cfggrid select{{background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:6px;font-size:13px}}
 .cfggrid input[readonly]{{background:#141416;color:#8f8f96;border-style:dashed;cursor:default}}
 .cfggrid .rohint{{color:#8a8a95;font-size:10px;font-style:italic}}
 .grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:16px}}
 .card{{background:#27272d;border:1px solid #36363d;border-radius:8px;padding:12px}}
 .card h3{{margin:0 0 8px;font-size:15px}} .card .role{{color:#999;font-size:12px;margin-bottom:8px}}
 .imgs{{display:flex;gap:8px;margin-bottom:8px}}
 .imgs figure{{margin:0;flex:1;text-align:center}}
 .imgs a{{display:block}}
 .imgs img{{width:100%;height:160px;object-fit:contain;background:#1a1a1e;border-radius:4px;transition:transform .18s;cursor:zoom-in}}
 .imgfail{{outline:2px solid #a44;outline-offset:-2px}}
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
 .modalbox{{background:#26262c;border:1px solid #444;border-radius:10px;width:min(1100px,92vw);max-height:88vh;display:flex;flex-direction:column;overflow:hidden}}
 .modalhdr{{flex:none;display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #3a3a42;font-size:15px;font-weight:600}}
 .modalhdr button{{background:#444;padding:6px 12px}}
 /* The one scrolling region of a modal. `min-height:0` is the load-bearing half:
    a flex item defaults to `min-height:auto`, which refuses to shrink below its
    content, so a body that outgrows the 88vh box spills PAST it -- and .modal is a
    fixed full-viewport flexbox, so that overflow lands off-screen with nothing to
    scroll. Every modal body wants this class; a form that GROWS (the New-blueprint
    modal's + Add) is the one that breaks without it. */
 .modalbody{{flex:1 1 auto;min-height:0;overflow:auto}}
 /* Actions pinned under the scroll, so Publish cannot be pushed out of reach by the
    rows the author just added. */
 .modalfoot{{flex:none;display:flex;align-items:center;gap:10px;padding:12px 18px;border-top:1px solid #3a3a42}}
 .modalgrid{{flex:1 1 auto;min-height:0;overflow:auto;padding:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}}
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
 <div class="bargrp" title="Save edits and pick which regions render">
  <button onclick="saveAll()" id="saveBtn" style="background:#629432">💾 Save changes</button>
  <button onclick="selAll(true)" class="alt">Select all</button>
  <button onclick="selAll(false)" class="alt">Select none</button>
 </div>
 <div class="bargrp" title="Prepare per-region reference art from the source page">
  <span class="glbl">Source / Refs</span>
  <button onclick="sliceAtlas()" class="alt" title="Cut the Atlas source image into per-region crops and set them as each region's IPAdapter style ref">✂ Slice source → refs</button>
  <button onclick="useRefAll()" class="alt" title="Seed every EMPTY region's atlas tile from its own reference image (verbatim — no AI). Never overwrites a region that already has a generated image. ✕ revert restores generation per region.">⤵ Refs → generated</button>
 </div>
 <div class="bargrp" title="Atlas-level actions: compose, view, deploy">
  <span class="glbl">Atlas</span>
  <button onclick="createAtlas()" id="abtn" style="background:#629432">🧩 Create Atlas</button>
  <button onclick="viewAtlas()" id="vbtn" class="alt" title="Open the Region Overlay Inspector: the composed page with every manifest rect outlined, plus each region's ACTUAL art alpha bbox re-measured from the pixels — shows whether the art fills its rect or sits inset in it.">🖼 View atlas</button>
  <button onclick="deployAtlas()" id="dbtn" class="alt" title="Copy the built atlas (.png/.webp) to this manifest's Deploy folder, overwriting <stem>.png/.webp there. Set the folder in Atlas settings.">📦 Deploy atlas</button>
  {spine_link}
 </div>
 <div class="bargrp" title="Generation/rendering controls — talks to ComfyUI">
  <span class="glbl">Processing</span>
  <button onclick="renderSel()" id="rbtn"><span class="fill"></span><span class="lbl">▶ Render selected</span></button>
  <button onclick="stopRender()" id="sbtn" style="background:#9e3f3f;display:none">■ Stop</button>
  <label style="margin:0 4px 0 6px;font-size:13px;color:#bbb">variants/symbol
   <input type="number" id="variants" value="1" min="1" max="30" style="width:56px;background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:5px;margin-left:4px"></label>
 </div>
 {blueprint_grp}
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
 <button onclick="newAtlas()" class="alt" title="Create a brand-new, empty atlas from scratch (auto-pack layout) — asks for its name first. Add regions and generate them from prompts; Create Atlas packs them into a page automatically.">＋ New atlas</button>
 <button onclick="addRegion()" class="alt" title="Add a new region to the active atlas. Give it a name; edit its prompt on the card, generate, then Create Atlas re-packs the page to fit.">＋ Add region</button>
 <button onclick="refreshR2(this)" class="alt" title="Re-pull this project's manifests from R2 (e.g. after exporting a sheet from the Sheet Maker) without restarting or switching projects">↻ Refresh from R2</button>
 <button onclick="clearCache(this)" class="alt" title="Discard the local copy of this project and re-download it from R2, matching the cloud exactly. Files deleted from the cloud are dropped here too; unsaved local work is lost. R2 is the source of truth.">↺ Reset from R2</button>
 <span class="ssn-note">switching reloads the page</span>
</div>
<details class="settings">
 <summary>⚙ Global settings (atlas_config.json — shared defaults)</summary>
 {model_status}
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
<details class="settings" id="gstylepanel">
 <summary>📝 Atlas style — applies to all regions in <b>{manifest_name}</b> (per-atlas, not shared)<span id="gstyledirty" style="display:none;margin-left:8px;color:#1c1408;background:#fbbf24;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:600">● unsaved — this render will NOT use it</span></summary>
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
  <button id="gstylesave" onclick="saveGlobalStyle()" style="margin-top:8px">Save atlas style</button>
  <span id="gnegstat" style="margin-left:12px;color:#999"></span>
 </div>
</details>
{bp_params_panel}
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
<div id="namodal" class="modal" onclick="if(event.target===this)closeNewAtlas()">
 <div class="modalbox" style="width:min(440px,92vw)" onkeydown="onNewAtlasKey(event)">
  <div class="modalhdr"><span>New atlas</span><button onclick="closeNewAtlas()">✕ close</button></div>
  <div class="modalbody" style="padding:14px 18px 18px;display:flex;flex-direction:column;gap:10px">
   <label style="font-size:13px;display:flex;align-items:center;gap:8px">Atlas name <input id="nanamein" type="text" placeholder="e.g. symbols_hd" autocomplete="off" spellcheck="false" style="flex:1;width:auto" oninput="onNewAtlasName()"></label>
   <div id="nawarn" style="font-size:12px;color:#e0a030;min-height:16px;line-height:1.35"></div>
   <div style="display:flex;justify-content:flex-end;gap:8px"><button class="alt" onclick="closeNewAtlas()">Cancel</button><button onclick="confirmNewAtlas()">Create</button></div>
  </div>
 </div>
</div>
<div id="advmodal" class="modal" onclick="if(event.target===this)closeAdv()">
 <div class="modalbox" style="width:min(480px,92vw)">
  <div class="modalhdr"><span id="advtitle">Advanced</span><button onclick="closeAdv()">✕ close</button></div>
  <div id="advform" class="modalbody" style="padding:18px;display:flex;flex-direction:column;gap:12px"></div>
  <div class="modalfoot">
   <button onclick="saveAdv()">Save overrides</button>
   <span style="color:#888;font-size:12px">empty field = use global setting</span>
  </div>
 </div>
</div>
<div id="fsmodal" class="modal" onclick="if(event.target===this)closeFs()">
 <div class="modalbox" style="width:min(680px,94vw)">
  <div class="modalhdr"><span id="fstitle">Pick a file</span><button onclick="closeFs()">✕ close</button></div>
  <div style="flex:none;padding:14px 18px 0;display:flex;gap:6px">
   <input id="fspath" placeholder="paste a path, \\\\server\\share, or http(s):// URL" style="flex:1;background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:8px;font-size:13px">
   <button class="mini" onclick="fsGo()">Go</button>
   <button class="mini" onclick="fsUseTyped()" title="Use exactly what's typed (a UNC path or a URL)">Use this</button>
   <button class="mini" id="fspickdir" onclick="fsUseCurDir()" title="Use the folder currently shown above" style="display:none;background:#629432">✓ Use this folder</button>
  </div>
  <div id="fscur" style="flex:none;padding:8px 18px 0;color:#888;font-size:12px;word-break:break-all"></div>
  <div id="fslist" class="modalbody" style="padding:10px 18px 18px;font-size:13px"></div>
 </div>
</div>
<div id="bpmodal" class="modal" onclick="if(event.target===this)closeBp()">
 <div class="modalbox" style="width:min(620px,94vw)">
  <div class="modalhdr"><span id="bptitle">New blueprint</span><button onclick="closeBp()">✕ close</button></div>
  <div class="modalbody" style="padding:14px 18px 18px;display:flex;flex-direction:column;gap:11px;font-size:13px">
   <div style="color:#888;font-size:12px">Pick a ComfyUI <b>API-format</b> workflow.json (Settings → "Save (API Format)"), then map each role onto a node in your graph. Only <b>output</b> is required — a processing graph with no sampler or prompt binds nothing else and publishes fine.</div>
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
    <label style="display:flex;flex-direction:column;gap:3px;color:#aaa">Kind (which tool this blueprint is for)
     <select id="bpKind" onchange="bpKindChanged()" style="background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:7px">
      <option value="image">Image &mdash; Atlas Maker region generation</option>
      <option value="video">Video &mdash; Flipbook video mode</option>
     </select>
    </label>
    <div style="color:#666;font-size:11px;margin-top:-4px">Each tool lists only its own kind, so an image blueprint never shows up in the video picker and vice versa.</div>
    <label style="display:flex;flex-direction:column;gap:3px;color:#aaa">Base model family (a label — it does NOT choose what runs)
     <select id="bpBase" style="background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:7px">
      <option value="sdxl">sdxl</option><option value="flux">flux</option><option value="gpt_image">gpt_image</option>
     </select>
    </label>
    <div style="color:#666;font-size:11px;margin-top:-4px">Recorded on the blueprint so the library reads sensibly. <b>Nothing dispatches on it</b> — it shares its wording with the built-in pipelines, which has been read as "this is what will run". What actually runs is <b>⚙ Settings → Pipeline</b>.</div>
    <div style="color:#aaa;font-weight:600;margin-top:2px">Bindings (role → node)</div>
    <div id="bpBindings" style="display:flex;flex-direction:column;gap:8px"></div>
    <div id="bpBindNote" style="display:none;color:#888;font-size:11px;line-height:1.5;margin-top:2px"></div>
    <div style="color:#aaa;font-weight:600;margin-top:8px;display:flex;align-items:center;gap:10px">Exposed settings (optional)
     <button type="button" onclick="addBpParam()" style="font-size:11px;padding:3px 8px">＋ Add</button></div>
    <div style="color:#888;font-size:11px">Tunable knobs (steps, cfg, sampler…) the author exposes. Each carries a default — the "general setting" — and renders as an editable control in the Settings panel. Pick a node + input that ISN'T already bound as a role.</div>
    <div id="bpRoleNote" style="display:none;color:#fbbf24;font-size:11px;line-height:1.5;border:1px solid #78350f;border-radius:6px;background:#1c1408;padding:8px;margin:6px 0"></div>
    <div id="bpGates" style="display:none;color:#fbbf24;font-size:11px;line-height:1.5;border:1px solid #78350f;border-radius:6px;background:#1c1408;padding:8px;margin:6px 0"></div>
    <p id="bpSpecsNote" style="display:none;color:#999;font-size:11px;margin:0 0 6px"></p>
    <div id="bpParams" style="display:flex;flex-direction:column;gap:10px"></div>
    <label style="display:flex;align-items:center;gap:7px;color:#aaa;font-size:12px;margin-top:4px"><input type="checkbox" id="bpUseNow" checked>
     Use it for this atlas straight away (sets ⚙ Settings → Pipeline)</label>
    <div style="color:#666;font-size:11px;margin-top:-4px">Publishing only adds the blueprint to the shared library. Until something selects it, this atlas keeps rendering with the pipeline it already had — which is how a processing blueprint gets published and the next render still comes out of the built-in SDXL generator.</div>
   </div>
  </div>
  <div id="bpfoot" class="modalfoot" style="display:none">
   <button id="bpSave" onclick="saveBlueprint()" style="display:none">Publish blueprint</button>
   <span id="bpstat" style="color:#999"></span>
  </div>
 </div>
</div>
<div id="bpManageModal" class="modal" onclick="if(event.target===this)closeManageBp()">
 <div class="modalbox" style="width:min(560px,94vw)">
  <div class="modalhdr"><span>Manage blueprints</span><button onclick="closeManageBp()">✕ close</button></div>
  <div class="modalbody" style="padding:14px 18px 18px;display:flex;flex-direction:column;gap:11px;font-size:13px">
   <div style="color:#888;font-size:12px">Shared blueprints in the library. Deleting one removes it for everyone; any atlas whose pipeline is set to it will need a different pipeline.</div>
   <div id="bpManageList" style="display:flex;flex-direction:column;gap:6px"></div>
   <span id="bpManageStat" style="color:#999"></span>
  </div>
 </div>
</div>
<div id="taxModal" class="modal" onclick="if(event.target===this)closeTaxonomy()">
 <div class="modalbox" style="width:min(860px,96vw)">
  <div class="modalhdr"><span>Semantic taxonomy (shared)</span><button onclick="closeTaxonomy()">✕ close</button></div>
  <div class="modalbody" style="padding:14px 18px 18px;display:flex;flex-direction:column;gap:10px;font-size:13px">
   <div style="color:#888;font-size:12px">
    One taxonomy for everyone, stored once and injected into every render that has a node
    which takes one — no filesystem, no re-publish, the same on every machine. A blueprint
    that sets its own taxonomy keeps it. With the <b>clip</b> analyzer these keywords
    <b>are</b> the labels layers are scored against, so a subject the vocabulary does not
    name lands in UNRESOLVED.
   </div>
   <textarea id="taxText" spellcheck="false" style="width:100%;height:46vh;font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.45;background:#111;color:#ddd;border:1px solid #333;border-radius:4px;padding:8px"></textarea>
   <div style="display:flex;align-items:center;gap:10px">
    <button onclick="saveTaxonomy()" title="Checked before it is stored — a taxonomy that would not load is refused here rather than falling back silently at render time">💾 Save</button>
    <button onclick="loadTaxonomy()" class="alt" title="Discard edits and re-read what is stored">↻ Reload</button>
    <span id="taxStat" style="color:#999"></span>
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
// From-scratch atlas flow: create an empty pack-layout atlas, add/remove
// regions. Each POSTs, shows the server's note, and reloads on success ('✓').
async function _postReload(url,body){{
 let bar=document.getElementById('sessionbar'); if(bar) bar.classList.add('busy');
 let msg;
 try{{ let r=await fetch(url,{{method:'POST',body:JSON.stringify(body)}});
  msg=(r.status===404)?'Endpoint missing — restart the service':await r.text();
 }}catch(e){{ msg='Failed: '+e; }}
 let stat=document.getElementById('stat'); if(stat) stat.textContent=msg;
 if(msg.indexOf('✓')>=0){{ location.reload(); return; }}
 if(bar) bar.classList.remove('busy');
 if(msg.indexOf('⚠')!==0 && msg.indexOf('✓')<0) alert(msg);
}}
// New atlas: named in a dialog BEFORE anything is written; an existing name is
// flagged live and confirmed on Create (which then sends overwrite:true).
function atlasSlug(s){{ return (s||'').toLowerCase().replace(/[^a-z0-9]/g,'_').slice(0,60); }}
function existingAtlases(){{
 return [...document.querySelectorAll('[data-cfg="manifest_path"] option')]
  .map(o=>(o.value.match(/^atlas_manifest_(.+)\\.json$/)||[])[1]).filter(Boolean);
}}
// Existing manifests keep their case; the server reuses that spelling.
function newAtlasTarget(raw){{
 let slug=atlasSlug(raw), hit=existingAtlases().find(n=>n.toLowerCase()===slug)||'';
 return {{slug:slug, name:hit||slug, exists:!!hit}};
}}
function newAtlas(){{
 let i=document.getElementById('nanamein'); i.value=''; onNewAtlasName();
 document.getElementById('namodal').classList.add('open'); i.focus();
}}
function closeNewAtlas(){{ document.getElementById('namodal').classList.remove('open'); }}
function onNewAtlasName(){{
 let raw=document.getElementById('nanamein').value.trim(), t=newAtlasTarget(raw), w='';
 if(t.slug && t.name!==raw) w+='Will be saved as "'+t.name+'". ';
 if(t.exists) w+='⚠ An atlas named "'+t.name+'" already exists — Create will replace it with an empty atlas.';
 document.getElementById('nawarn').textContent=w;
}}
function onNewAtlasKey(e){{
 if(e.key==='Enter' && e.target.id==='nanamein'){{ e.preventDefault(); confirmNewAtlas(); }}
}}
function confirmNewAtlas(){{
 let raw=document.getElementById('nanamein').value.trim(), t=newAtlasTarget(raw);
 if(!t.slug){{ document.getElementById('nawarn').textContent='Give the atlas a name.'; document.getElementById('nanamein').focus(); return; }}
 if(t.exists && !confirm('An atlas named "'+t.name+'" already exists.\\n\\n'
   +'Replace it with a new, empty atlas? Its manifest (regions, prompts, layout) is overwritten — on R2 too, with no undo. Generated variant images stay on disk.\\n\\n'
   +'Cancel to pick a different name.')) return;
 closeNewAtlas();
 _postReload('/newatlas',{{name:raw,overwrite:t.exists}});
}}
function addRegion(){{
 let name=prompt('Region name (letters, numbers, _ or -). You\\'ll set its prompt on the card:');
 if(name===null) return;
 name=name.trim(); if(!name) return;
 _postReload('/addregion',{{name:name}});
}}
function delRegion(name){{
 if(!name) return;
 if(!confirm('Remove region \"'+name+'\" from this atlas? (generated variants are kept)')) return;
 _postReload('/delregion',{{name:name}});
}}
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
 let txt=await r.text();
 if(stat) stat.textContent=txt;
 // The reload wipes this line, and 900ms is plenty for "Settings saved".
 // A LONGER reply is one the server went out of its way to write — the layout
 // switch reports how many regions just lost their rect, and the reload is
 // exactly what brings those now-unplaced cards back. Let it be read first.
 setTimeout(()=>location.reload(),txt.length>90?5000:900);
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
// id -> [param def, …] for every blueprint that exposes params; and this
// manifest's saved overrides (id -> {{key: value}}), namespaced by blueprint id.
const BP_PARAMS={bp_params_js};
const BP_PARAM_VALUES={bp_param_values_js};
// [{{id,name}}] of every shared blueprint + whether this user may delete them —
// drives the manage/delete list in the New-blueprint modal.
const BP_LIST={bp_list_js};
const BP_CAN_PUBLISH={bp_can_publish_js};
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
 renderBpParams(p);  // exposed-param controls for the active blueprint
 applyCardPipes();   // a card inheriting the global pipeline follows it
}}
// The SAME rule as data-pipe, for the geometry rows of 🧩 Atlas settings: a row
// shows when its data-layout group is 'both' or matches the chosen Layout.
// Client-side and immediate, BEFORE any save — picking Grid has to reveal the
// very cell fields you then need to fill, and waiting for a save+reload would
// hide them at exactly the moment they matter. Server-rendered state matches
// (`layout_row_visible`), so the panel does not change shape when this runs.
function layoutVisible(g,L){{ return !g||g==='both'||g===L; }}
function atlasLayoutNow(){{
 let s=document.querySelector('[data-cfg="atlas_layout"]');
 return (s&&s.value)||'';
}}
function applyAtlasLayout(){{
 // Blank = no Layout control (a .atlas-bound atlas) or the authored-geometry
 // choice. Either way there is no layout to be aware of and the cell size is
 // live, so touch nothing. Such a panel also carries no data-layout rows to
 // toggle — they become aware on the reload after a layout is actually saved.
 let L=atlasLayoutNow(); if(!L) return;
 document.querySelectorAll('.cfggrid [data-layout]').forEach(l=>{{
  l.style.display=layoutVisible(l.getAttribute('data-layout'),L)?'':'none';
 }});
 // Atlas width/height under 'pack' are the packer's OUTPUT. readOnly, never
 // disabled: a readonly input still posts, so cfgData() cannot drop its value.
 document.querySelectorAll('.cfggrid [data-ro-layout]').forEach(l=>{{
  let ro=l.getAttribute('data-ro-layout')===L;
  l.querySelectorAll('input').forEach(i=>{{ i.readOnly=ro; }});
  let n=l.querySelector('.rohint'); if(n) n.style.display=ro?'':'none';
 }});
}}
// Render the active blueprint's exposed-param controls into the Blueprint
// settings panel. Hidden unless the active pipeline is a blueprint with params.
// Pre-filled from this manifest's saved overrides, else each param's default.
function renderBpParams(p){{
 let panel=document.getElementById('bpParamsPanel');
 let grid=document.getElementById('bpParamsGrid');
 if(!panel||!grid) return;
 let defs=(isBlueprintPipe(p)&&BP_PARAMS[p])||null;
 if(!defs||!defs.length){{ panel.style.display='none'; grid.innerHTML=''; return; }}
 panel.dataset.bpid=p;
 document.getElementById('bpParamsTitle').textContent=p;
 let saved=(BP_PARAM_VALUES[p])||{{}};
 grid.innerHTML='';
 defs.forEach(d=>{{
  let key=d.key; if(!key) return;
  let val=(key in saved)?saved[key]:d.default;
  let lab=document.createElement('label');
  let cap=document.createElement('span'); cap.className='lblrow';
  cap.textContent=(d.label||key);
  let ctl;
  if(d.type==='bool'){{
   ctl=document.createElement('select');
   // Blank '— default —' option so a bool can be UNSET (fall back to the baked
   // default) just like the blank-a-field rule for the other types; the save
   // path drops a blank value. Only an explicit true/false is an override.
   [['','— default —'],['true','true'],['false','false']].forEach(o=>{{let op=document.createElement('option');op.value=o[0];op.textContent=o[1];ctl.appendChild(op);}});
   ctl.value=(key in saved)?((val===true||val==='true'||val===1||val==='1')?'true':'false'):'';
  }} else if(d.type==='select'){{
   ctl=document.createElement('select');
   (d.options||[]).forEach(o=>{{let op=document.createElement('option');op.value=o;op.textContent=o;ctl.appendChild(op);}});
   if(val!=null) ctl.value=String(val);
  }} else if(d.type==='text'&&d.multiline){{
   // Prose (a second prompt, a caption) — a full-width box, not the narrow
   // inline input the numeric knobs share. See `multiline` in blueprints.py.
   ctl=document.createElement('textarea');
   ctl.rows=3;
   ctl.style.cssText='width:100%;resize:vertical';
   ctl.value=(val==null)?'':String(val);
  }} else {{
   ctl=document.createElement('input');
   if(d.type==='int'||d.type==='float'){{
    ctl.type='number';
    if(d.min!=null) ctl.min=d.min;
    if(d.max!=null) ctl.max=d.max;
    if(d.step!=null) ctl.step=d.step; else if(d.type==='float') ctl.step='any';
   }}
   ctl.value=(val==null)?'':String(val);
  }}
  ctl.dataset.bpparam=key;
  lab.appendChild(cap);
  // A numeric with BOTH bounds gets a slider beside the number box — two views
  // of one value. HTML min/max on a number input only fail form validation;
  // they never stopped a 50 being typed into a 0..1 field and sent, which is
  // how ComfyUI came to reject a whole prompt over one `sensitivity`. Clamped
  // on change/blur, not on every keystroke, so "0." can still become "0.5".
  // The slider never writes into an UNTOUCHED row: blank still means default.
  if(ctl.type==='number'&&isFinite(parseFloat(d.min))&&isFinite(parseFloat(d.max))){{
   let lo=parseFloat(d.min), hi=parseFloat(d.max);
   let row=document.createElement('span');
   row.style.cssText='display:flex;gap:6px;align-items:center';
   let rng=document.createElement('input'); rng.type='range';
   rng.min=ctl.min; rng.max=ctl.max; rng.step=(ctl.step==='any')?'0.01':ctl.step;
   rng.style.flex='1';
   rng.value=(ctl.value==='')?String(d.default!=null?d.default:lo):ctl.value;
   rng.addEventListener('input',()=>{{ ctl.value=rng.value; }});
   let clamp=()=>{{
    if(ctl.value==='') return;
    let n=Math.min(hi,Math.max(lo,parseFloat(ctl.value)));
    if(!isNaN(n)){{ ctl.value=String(n); rng.value=String(n); }}
   }};
   ctl.addEventListener('change',clamp); ctl.addEventListener('blur',clamp);
   ctl.style.width='5.5em';
   row.appendChild(rng); row.appendChild(ctl); lab.appendChild(row);
  }} else {{
   lab.appendChild(ctl);
  }}
  grid.appendChild(lab);
 }});
 panel.style.display='';
 refreshBpParamLists(p);
}}
// Re-read each param's contract from the ComfyUI that answers `/video/nodespecs`
// every time the panel renders, so a model dropped on the pod's volume today is
// in the dropdown today — no re-import. What the panel drew first is the BAKED
// list, and it stays when nothing answers (a sleeping pod is the normal case).
// The saved value is never dropped: a choice the live list lacks stays selected
// and says so — the rule the Settings panel's model fields already follow.
async function refreshBpParamLists(p){{
 let panel=document.getElementById('bpParamsPanel');
 let res=null;
 try{{
  let r=await fetch('/video/nodespecs',{{method:'POST',body:JSON.stringify({{blueprint:p,surface:'atlas'}})}});
  res=await r.json();
 }}catch(e){{ return; }}
 if(!res||!res.ok||!panel||panel.dataset.bpid!==p) return;
 Object.entries(res.params||{{}}).forEach(([key,spec])=>{{
  let el=document.querySelector('#bpParamsGrid [data-bpparam="'+CSS.escape(key)+'"]');
  if(!el) return;
  if(spec.kind==='select'&&el.tagName==='SELECT'&&Array.isArray(spec.options)){{
   let cur=el.value;
   el.innerHTML='';
   spec.options.forEach(o=>{{let op=document.createElement('option');op.value=o;op.textContent=o;el.appendChild(op);}});
   if(cur&&spec.options.indexOf(cur)<0){{
    let op=document.createElement('option');op.value=cur;op.textContent=cur+' (not installed)';el.appendChild(op);
   }}
   if(cur) el.value=cur;
  }} else if((spec.kind==='int'||spec.kind==='float')&&el.type==='number'){{
   if(spec.min!=null) el.min=spec.min;
   if(spec.max!=null) el.max=spec.max;
   if(spec.step!=null) el.step=spec.step;
  }}
 }});
}}
async function saveBpParams(btn){{
 let panel=document.getElementById('bpParamsPanel');
 let stat=document.getElementById('bpParamsStat');
 if(!panel) return;
 let bpid=panel.dataset.bpid||globalPipe();
 let vals={{}};
 document.querySelectorAll('#bpParamsGrid [data-bpparam]').forEach(el=>{{
  vals[el.dataset.bpparam]=el.value;
 }});
 let body={{bpParams:{{[bpid]:vals}}}};
 let r=await fetch('/saveconfig',{{method:'POST',body:JSON.stringify(body)}});
 let msg=await r.text();
 if(stat) stat.textContent=msg;
 // Keep the in-page saved map in sync so a later pipeline switch + return shows
 // the just-saved values without a reload.
 BP_PARAM_VALUES[bpid]=vals;
}}
// --- Resolved workflow export: show EXACTLY the graph the pipeline POSTs ----
function activeManifestName(){{
 let s=document.querySelector('[data-cfg="manifest_path"]');
 return (s&&s.value)||'';
}}
function bpResEsc(s){{
 return String(s).replace(/[&<>]/g,c=>({{'&':'&amp;','<':'&lt;','>':'&gt;'}}[c]));
}}
function bpResShow(v){{
 if(v===null||v===undefined) return '<span style="color:#777">—</span>';
 if(typeof v==='object') return bpResEsc(JSON.stringify(v));
 let s=String(v); if(s==='') return '<span style="color:#777">(empty)</span>';
 return bpResEsc(s);
}}
async function resolveBpWorkflow(btn){{
 let stat=document.getElementById('bpResStat');
 let out=document.getElementById('bpResOut');
 let panel=document.getElementById('bpParamsPanel');
 let bpid=(panel&&panel.dataset.bpid)||globalPipe();
 let man=activeManifestName();
 if(!man){{ if(stat)stat.textContent='No active manifest.'; return; }}
 let reg=(document.getElementById('bpResRegion')||{{}}).value||'';
 if(stat)stat.textContent='Resolving…';
 let qs='manifest='+encodeURIComponent(man)
   +(bpid?'&blueprint='+encodeURIComponent(bpid):'')
   +(reg?'&region='+encodeURIComponent(reg):'');
 let j;
 try{{ j=await (await fetch('/blueprintresolved?'+qs)).json(); }}
 catch(e){{ if(stat)stat.textContent='Request failed: '+e; return; }}
 if(!j||!j.ok){{ if(stat)stat.textContent=(j&&j.error)||'Failed.'; return; }}
 if(stat)stat.textContent='';
 // Populate / refresh the region picker from the returned region list.
 let sel=document.getElementById('bpResRegion');
 if(sel&&Array.isArray(j.regions)){{
  let had=sel.value;
  sel.innerHTML='';
  j.regions.forEach(n=>{{ let o=document.createElement('option');
    o.value=n; o.textContent=n; sel.appendChild(o); }});
  if(had&&j.regions.indexOf(had)>=0) sel.value=had;
 }}
 // Build the changes table: Node / Field / Baked → Pipeline value / Source.
 let rows=(j.changes||[]).map(c=>
  '<tr><td style="white-space:nowrap"><b>'+bpResEsc(c.title)+'</b>'
  +' <span style="color:#777">#'+bpResEsc(c.node)+'</span></td>'
  +'<td>'+bpResEsc(c.field)+'</td>'
  +'<td style="color:#c88">'+bpResShow(c.baked)+'</td>'
  +'<td style="color:#8c8">'+bpResShow(c.resolved)+'</td>'
  +'<td style="color:#88a">'+bpResEsc(c.source||'')+'</td></tr>'
 ).join('');
 if(!rows) rows='<tr><td colspan="5" style="color:#888">'
  +'No injected changes — the pipeline sends this blueprint graph as baked.'
  +'</td></tr>';
 let notes=(j.notes||[]).map(n=>'<li>'+bpResEsc(n)+'</li>').join('');
 let seedTxt=(j.seed!==null&&j.seed!==undefined)
  ?('<b>Seed:</b> '+bpResEsc(j.seed)) : '';
 out.innerHTML=
  '<div style="font-size:12px;color:#aaa;margin-bottom:6px">'+seedTxt
  +(seedTxt?' &nbsp;·&nbsp; ':'')+'<b>Output node:</b> #'
  +bpResEsc(j.output_node)+'</div>'
  +'<table style="width:100%;border-collapse:collapse;font-size:12px">'
  +'<thead><tr style="text-align:left;color:#999;border-bottom:1px solid #444">'
  +'<th>Node</th><th>Field</th><th>Baked</th><th>Pipeline value</th>'
  +'<th>Source</th></tr></thead><tbody>'+rows+'</tbody></table>'
  +(notes?('<ul style="font-size:12px;color:#999;margin:8px 0 0;'
    +'padding-left:18px">'+notes+'</ul>'):'')
  +'<button style="margin-top:10px" onclick="bpResDownload()">'
  +'⬇ Download workflow.json</button>';
 out.style.display='';
 window._bpResWf=j.workflow;
}}
function bpResDownload(){{
 if(!window._bpResWf){{ return; }}
 let blob=new Blob([JSON.stringify(window._bpResWf,null,2)],
   {{type:'application/json'}});
 let a=document.createElement('a');
 a.href=URL.createObjectURL(blob);
 a.download='workflow.json';
 document.body.appendChild(a); a.click();
 setTimeout(()=>{{ URL.revokeObjectURL(a.href); a.remove(); }},0);
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
 let al=document.querySelector('[data-cfg="atlas_layout"]');
 if(al)al.addEventListener('change',applyAtlasLayout);
 applyAtlasLayout();
 // What the manifest holds right now: these textareas were rendered from it.
 _styleSaved=_styleNow();
 _STYLE_IDS.forEach(id=>{{
  let el=document.getElementById(id);
  if(el) el.addEventListener('input',gstyleSync);
 }});
 gstyleSync();
}});
// Flash a green "✓ Done" on an action button, then restore its label. The real
// label is captured once (dataset.lbl) so rapid re-clicks never freeze on Done.
function flashDone(btn){{
 if(!btn)return;
 if(!btn.dataset.lbl)btn.dataset.lbl=btn.innerHTML;
 if(btn._t)clearTimeout(btn._t);
 btn.innerHTML='✓ Done';btn.classList.add('done');
 btn._t=setTimeout(()=>{{btn.innerHTML=btn.dataset.lbl;btn.classList.remove('done');btn._t=null;}},1800);
}}
async function saveAll(){{
 let r=await fetch('/save',{{method:'POST',body:JSON.stringify(collect())}});
 let msg=await r.text();
 // A refused save must not read as a successful one. fetch only rejects on a
 // transport failure, so a 500 (or an expired gate) used to be shown in #stat
 // as if it were the "Saved (…)" note and flash the button green.
 if(!r.ok) throw new Error('HTTP '+r.status+(msg?' — '+msg.slice(0,200):''));
 flashDone(document.getElementById('saveBtn'));
 return msg;
}}
// The atlas style is the ONE settings panel the main "Save changes" does not
// carry: collect() sends the region cards, and these three textareas persist
// only through their own button below. Type a prompt here, press the big Save,
// render — and the render uses the SAVED text while your typing sits on screen
// looking applied. That is silent and it costs a GPU render to notice, so the
// panel now says when it is holding something the next render will ignore.
//
// Compared stripped, because _saveglobalstyle strips before writing — otherwise a
// trailing newline would leave the panel permanently, wrongly dirty.
let _styleSaved=null;
const _STYLE_IDS=['gpre','gsuf','gneg'];
function _styleNow(){{
 return _STYLE_IDS.map(id=>{{
  let el=document.getElementById(id); return el?el.value.trim():'';
 }});
}}
function gstyleDirty(){{
 if(!_styleSaved) return false;
 let now=_styleNow();
 return now.some((v,i)=>v!==_styleSaved[i]);
}}
function gstyleSync(){{
 let badge=document.getElementById('gstyledirty');
 let btn=document.getElementById('gstylesave');
 let dirty=gstyleDirty();
 if(badge) badge.style.display=dirty?'':'none';
 if(btn) btn.style.background=dirty?'#e0a030':'';
}}
// For the fire-and-forget callers: never leave a failed save as an unhandled
// rejection with the page still showing the edit as though it stuck.
function saveAllLoud(){{
 return saveAll().then(m=>{{document.getElementById('stat').textContent=m; return m;}})
  .catch(e=>{{document.getElementById('stat').textContent=
   '⚠ Save failed: '+e.message+' — press 💾 Save changes to retry';}});
}}
// Save, and say whether it is safe to go on. A Render / Create Atlas / mode
// switch that runs past a REFUSED save works from stale server-side data --
// which is how a discarded edit turns into a wrong atlas with nothing to see.
async function savedOk(what){{
 try{{ document.getElementById('stat').textContent=await saveAll(); return true; }}
 catch(e){{
  let m='⚠ '+what+' cancelled — your changes did not save ('+e.message+').';
  document.getElementById('stat').textContent=m;
  alert(m+'\\n\\nPress 💾 Save changes to retry, then try again.');
  return false;
 }}
}}
async function saveGlobalStyle(){{
 let body={{positive_prefix:document.getElementById('gpre').value,
  positive_suffix:document.getElementById('gsuf').value,
  negative:document.getElementById('gneg').value}};
 let r=await fetch('/saveglobalstyle',{{method:'POST',body:JSON.stringify(body)}});
 let msg=await r.text();
 document.getElementById('gnegstat').textContent=msg;
 // Re-baseline only on a save that landed, so a failed write stays flagged.
 if(msg.indexOf('saved')>=0) _styleSaved=_styleNow();
 gstyleSync();
 return msg;
}}
// --- Blueprints: upload an API-format ComfyUI graph + bind roles ----------
let _bpGraph=null;   // parsed API/prompt node dict from the picked file
// The graph's node CONTRACTS, class -> input -> spec, read off ComfyUI once per
// picked file (`comfy_specs`). A baked `1.0` says "float" and nothing else; the
// contract says 0..1, or that the input is a COMBO over the installed models.
// Empty when nothing answered — a sleeping pod is the normal case — and each
// setting then falls back to the baked-value guess, unbounded and listless.
let _bpSpecs={{}};
let _bpPick=0;       // which picked file a contract read belongs to; a stale answer must not land on the next
function bpSpecsNote(msg){{
 let el=document.getElementById('bpSpecsNote');
 if(el){{ el.textContent=msg; el.style.display=msg?'':'none'; }}
}}
// Role -> EXPECTED (worth warning about when a graph offers one and the author
// left it unbound) + candidate filter over (id, node). Only `output` actually
// blocks a publish: it is where the bytes come from. `positive` and `seed` used
// to block too, which made a PROCESSING blueprint — an upscale, relight or
// matting graph with no sampler and no text encoder — impossible to publish at
// all: the modal demanded a seed the graph had nothing to bind. See bpRoleWarn.
const BP_ROLES=[
 ['positive',true],['negative',false],['seed',true],
 ['width',false],['height',false],
 ['style_ref',false],['shape_ref',false],['output',true]];
// The role a publish cannot do without.
const BP_STRUCTURAL='output';
// A ComfyUI API input is either a widget value or a link [nodeId, slot].
function bpLinkSource(v){{
 return (Array.isArray(v) && typeof v[0]==='string') ? v[0] : null;
}}
// Walk backwards from a node input to the WIDGET that actually feeds it.
//
// "Convert widget to input" is how any reusable ComfyUI graph is authored: the
// prompt, the seed, the size stop being widgets on the consuming node and become
// Primitive* nodes wired in, sometimes through a relay or two. Binding the
// consuming end would overwrite that wire with a literal and cut every other
// consumer off from the value; binding the upstream widget is what the author
// means. Returns the input unchanged when it is already a widget, and stops at
// anything that is not a plain pass-through (a switch, a math node) rather than
// guessing which of its inputs is "the" one.
function bpResolveKnob(node,field,seen){{
 seen=seen||[];
 const here={{node:node,field:field}};
 const g=_bpGraph||{{}};
 const up=bpLinkSource(((g[node]||{{}}).inputs||{{}})[field]);
 if(!up || seen.indexOf(up)>=0 || !g[up]) return here;
 seen.push(up);
 const inputs=(g[up]||{{}}).inputs||{{}};
 const widgets=Object.keys(inputs).filter(f=>bpLinkSource(inputs[f])===null);
 const wires=Object.keys(inputs).filter(f=>bpLinkSource(inputs[f])!==null);
 // A primitive holding exactly one widget IS the knob.
 if(widgets.length===1 && !wires.length) return {{node:up,field:widgets[0]}};
 // A pass-through relay (one input, itself a wire) — keep walking.
 if(!widgets.length && wires.length===1) return bpResolveKnob(up,wires[0],seen);
 return here;
}}
// Targets that plausibly fill a role, best first — a RANKING, not a filter.
//
// This used to be a filter, and BP_FIELD hardcoded the field per role. That
// holds only for a graph whose knobs are still widgets on the consuming node:
// the moment an author converts them to inputs, the CLIPTextEncode this approves
// takes its `text` from a wire, the role cannot write it, and the primitive that
// actually holds the prompt is not offered at all — leaving a REQUIRED role with
// no usable option and no way forward. Ported from VideoMode.svelte (2026-09-01),
// which hit exactly that on a two-part Wan i2v graph.
//
// Rank 0 = a knob the author factored out (reached by following the wire back
// from the node that consumes the value), because a graph carrying both a
// primitive and the widget it feeds is one whose author already said which is
// the control. Rank 1 = a raw widget on the consuming node. Rank 2 = a node
// whose title says it is the OTHER polarity (a negative encoder offered for
// `positive`) — still listed, just last.
function bpCandidates(role,graph){{
 let out=[];
 const add=(t,via,rank)=>{{
  if(!graph[t.node]) return;
  if(out.some(o=>o.node===t.node && o.field===t.field)) return;
  out.push({{node:t.node,field:t.field,via:via,rank:rank}});
 }};
 for(const id of Object.keys(graph)){{
  const n=graph[id]||{{}}; const ct=String(n.class_type||'');
  const title=(n._meta&&n._meta.title)?String(n._meta.title):'';
  const inp=n.inputs||{{}};
  if(role==='output'){{
   // A save node is whatever the runner can stamp a `filename_prefix` onto — that IS
   // the contract. Testing the CLASS NAME for /SaveImage/ excluded SaveAnimatedWEBP,
   // SaveWEBM and VHS_VideoCombine, so a video graph could never bind `output` and the
   // modal showed "no matching node" with no way forward.
   if(('filename_prefix' in inp)||/Save|VideoCombine/i.test(ct)) add({{node:id,field:''}},'',0);
  }} else if(role==='positive'||role==='negative'){{
   if(!/CLIPTextEncode/i.test(ct) || !('text' in inp)) continue;
   const isNeg=/negative/i.test(title);
   const wanted=(role==='negative')?isNeg:!isNeg;
   const k=bpResolveKnob(id,'text');
   const viaWire=(k.node!==id);
   add(k, viaWire?('feeds '+bpNodeOpt(id)):'', wanted?(viaWire?0:1):2);
  }} else if(role==='seed'){{
   ['noise_seed','seed'].forEach(f=>{{
    if(!(f in inp)) return;
    const k=bpResolveKnob(id,f);
    const viaWire=(k.node!==id);
    add(k, viaWire?('feeds '+bpNodeOpt(id)):'', viaWire?0:1);
   }});
  }} else if(role==='width'||role==='height'){{
   if(!(role in inp)) continue;
   const k=bpResolveKnob(id,role);
   const viaWire=(k.node!==id);
   add(k, viaWire?('feeds '+bpNodeOpt(id)):'', viaWire?0:1);
  }} else if(role==='style_ref'||role==='shape_ref'){{
   if(!/LoadImage/i.test(ct)) continue;
   add({{node:id,field:('image' in inp)?'image':(Object.keys(inp)[0]||'image')}},'',0);
  }}
 }}
 return out.sort((a,b)=>a.rank-b.rank);
}}
// EVERY node input in the graph, so no role is ever cornered by a heuristic that
// did not anticipate this workflow. Wired inputs are included and marked:
// overwriting a link with a literal is legal in ComfyUI and is what the old
// node-only picker did, so the escape hatch has to keep offering it.
function bpAllInputs(){{
 const g=_bpGraph||{{}}; let out=[];
 for(const id of Object.keys(g)){{
  const inp=(g[id]||{{}}).inputs||{{}};
  for(const f of Object.keys(inp)){{
   out.push({{node:id,field:f,wired:bpLinkSource(inp[f])!==null}});
  }}
 }}
 return out;
}}
// The select value a role binding carries. `output` binds a WHOLE node, so it
// carries the bare id; everything else carries node::field.
function bpBindValue(role,t){{ return (role==='output')?t.node:(t.node+'::'+t.field); }}
// Human label for a node option. Prefers the title the author gave the node in
// ComfyUI (API exports carry it as `_meta.title`); falls back to class_type. The
// id is kept (#id) so identically-titled nodes stay distinguishable.
function bpNodeOpt(id){{
 const n=(_bpGraph||{{}})[id]||{{}};
 const ct=String(n.class_type||'');
 const t=(n._meta&&n._meta.title)?String(n._meta.title).trim():'';
 return (t&&t!==ct) ? (t+' — '+ct+' (#'+id+')') : ('node '+id+' — '+ct);
}}
function openNewBlueprint(){{
 _bpGraph=null;
 document.getElementById('bpFile').value='';
 document.getElementById('bpmeta').style.display='none';
 document.getElementById('bpSave').style.display='none';
 document.getElementById('bpName').value='';
 document.getElementById('bpDesc').value='';
 bpStat('');
 let pw=document.getElementById('bpParams'); if(pw)pw.innerHTML='';
 ['bpGates','bpRoleNote','bpBindNote'].forEach(id=>{{
  let w=document.getElementById(id);
  if(w){{ w.innerHTML=''; w.style.display='none'; }}
 }});
 document.getElementById('bpmodal').classList.add('open');
}}
// Dedicated "Manage blueprints" modal (its own toolbar button) — lists every
// shared blueprint with a delete button per row.
function openManageBlueprints(){{
 document.getElementById('bpManageStat').textContent='';
 renderBpManage();
 document.getElementById('bpManageModal').classList.add('open');
}}
function closeManageBp(){{document.getElementById('bpManageModal').classList.remove('open');}}

// --- Shared semantic taxonomy -------------------------------------------
// The etag from the last read. Sent back on save so two people editing cannot
// silently overwrite each other — the server refuses a stale write rather than
// taking the last one to click Save.
var _taxEtag=null;
function taxStat(s){{document.getElementById('taxStat').textContent=s||'';}}
function openTaxonomy(){{
 document.getElementById('taxModal').classList.add('open');
 loadTaxonomy();
}}
function closeTaxonomy(){{document.getElementById('taxModal').classList.remove('open');}}
function loadTaxonomy(){{
 taxStat('reading…');
 fetch('/taxonomy/get',{{method:'POST',body:'{{}}'}})
  .then(r=>r.json())
  .then(r=>{{
   if(r.error){{ taxStat('✖ '+r.error); return; }}
   _taxEtag=r.etag||null;
   document.getElementById('taxText').value=r.text||'';
   taxStat(r.text ? (r.summary||'') :
    'Nothing stored yet — paste a taxonomy and save. Start from configs/default_taxonomy.yaml in the pack.');
  }})
  .catch(e=>taxStat('✖ '+e));
}}
function saveTaxonomy(){{
 taxStat('saving…');
 fetch('/taxonomy/save',{{method:'POST',body:JSON.stringify(
   {{text:document.getElementById('taxText').value,etag:_taxEtag}})}})
  .then(r=>r.json())
  .then(r=>{{
   if(r.conflict){{
    // Deliberately does NOT reload over the top: their edits are in the box.
    taxStat('✖ Somebody else saved since you opened this. ↻ Reload to see theirs '
            +'(your edits in the box will be lost), or copy yours out first.');
    return;
   }}
   if(!r.ok){{ taxStat('✖ '+(r.error||'refused')); return; }}
   _taxEtag=r.etag;
   taxStat('✔ saved — '+(r.summary||'')
           +((r.warnings&&r.warnings.length)?('  ⚠ '+r.warnings.join('; ')):''));
  }})
  .catch(e=>taxStat('✖ '+e));
}}
function renderBpManage(){{
 let box=document.getElementById('bpManageList'); if(!box) return;
 box.innerHTML='';
 if(!BP_LIST || !BP_LIST.length){{
  let e=document.createElement('div'); e.style.cssText='color:#888';
  e.textContent='No blueprints in the library yet — upload one first.';
  box.appendChild(e); return;
 }}
 BP_LIST.forEach(bp=>{{
  let row=document.createElement('div');
  row.style.cssText='display:flex;align-items:center;gap:8px;border:1px solid #2a2a2e;border-radius:5px;padding:7px 9px';
  let nm=document.createElement('span'); nm.style.cssText='flex:1;color:#ddd';
  nm.textContent=bp.name+(bp.name!==bp.id?(' ('+bp.id+')'):'');
  let n=bp.nmodels||0;
  let cnt=document.createElement('span'); cnt.style.cssText='color:#888;font-size:11px';
  cnt.textContent=n?(n+' model'+(n===1?'':'s')):'no models declared';
  // The digest of the graph the library actually holds. A publish reports
  // PRESENCE, never CONTENT, so re-uploading the wrong file used to be
  // indistinguishable from success — compare this to your local file.
  let sha=document.createElement('code');
  sha.style.cssText='color:#7aa2c8;font-size:11px;letter-spacing:.3px';
  sha.textContent=bp.sha||'--';
  sha.title='sha256 of the stored graph (canonical JSON, first 12 chars). Recompute it from your own file with the one-liner in docs/tools/atlas-maker.md and compare.';
  let scan=document.createElement('button'); scan.type='button'; scan.textContent='⟳ Rescan models';
  scan.style.cssText='font-size:11px;padding:4px 9px';
  scan.title='Re-read the stored graph and declare the model files it names.';
  scan.onclick=()=>rescanBlueprintModels(bp.id);
  let del=document.createElement('button'); del.type='button'; del.textContent='🗑 Delete';
  del.style.cssText='font-size:11px;padding:4px 9px';
  del.onclick=()=>deleteBlueprint(bp.id,bp.name);
  row.appendChild(nm); row.appendChild(sha); row.appendChild(cnt);
  row.appendChild(scan); row.appendChild(del); box.appendChild(row);
 }});
}}
// Blueprints authored before models[] was derived at import declare nothing, so
// nothing can check or install what their graph asks for. This re-reads the
// stored graph server-side; human-added url/r2_key/sha256 survive.
async function rescanBlueprintModels(id){{
 let st=document.getElementById('bpManageStat');
 if(st) st.textContent='⟳ Rescanning …';
 let msg;
 try{{ let r=await fetch('/rescanblueprintmodels',{{method:'POST',body:JSON.stringify({{id:id}})}});
  msg=(r.status===404)?'Endpoint missing — restart the service':await r.text();
 }}catch(e){{ msg='Rescan failed: '+e; }}
 if(st) st.textContent=msg;
 if(msg.indexOf('✓')>=0) setTimeout(()=>location.reload(),2500);
}}
async function deleteBlueprint(id,name){{
 if(!confirm('Delete blueprint "'+(name||id)+'" from the SHARED library?\\n\\n'
   +'This removes it for everyone. Any atlas whose pipeline is set to it will '
   +'need a different pipeline. This cannot be undone.')) return;
 let st=document.getElementById('bpManageStat'); if(st) st.textContent='🗑 Deleting…';
 let msg;
 try{{ let r=await fetch('/deleteblueprint',{{method:'POST',body:JSON.stringify({{id:id}})}});
  msg=(r.status===404)?'Endpoint missing — restart the service':await r.text();
 }}catch(e){{ msg='Delete failed: '+e; }}
 if(st) st.textContent=msg;
 if(msg.indexOf('✓')>=0) setTimeout(()=>location.reload(),1200);
}}
function closeBp(){{document.getElementById('bpmodal').classList.remove('open');}}
// The footer holds the ONLY publish button, pinned under the scrolling body so a
// long settings list cannot push it off-screen. It stays hidden until it has
// something to carry -- an empty action bar under a two-field dialog reads as a
// rendering bug -- which is why every status write goes through bpStat().
function bpStat(msg){{
 document.getElementById('bpstat').textContent=msg||'';
 bpFootSync();
}}
function bpFootSync(){{
 let f=document.getElementById('bpfoot'); if(!f) return;
 f.style.display=(document.getElementById('bpSave').style.display!=='none'
  || document.getElementById('bpstat').textContent!=='') ? 'flex' : 'none';
}}
function onBpFilePicked(){{
 let f=document.getElementById('bpFile').files[0]; if(!f)return;
 let rd=new FileReader();
 rd.onload=()=>{{
  let g;
  try{{ g=JSON.parse(rd.result); }}
  catch(e){{ bpStat('✖ Not valid JSON: '+e); return; }}
  if(!g||typeof g!=='object'||Array.isArray(g)){{
   bpStat('✖ Not an API-format node dict.'); return; }}
  // Heuristic API-format check: every value is a node with a class_type.
  let bad=Object.keys(g).find(k=>!g[k]||typeof g[k]!=='object'||!('class_type' in g[k]));
  if(bad!==undefined){{
   bpStat('✖ Node "'+bad+'" has no class_type — export in API format, not the editor format.');
   return; }}
  _bpGraph=g;
  // Not awaited: a sleeping pod would hold the modal for the read's whole timeout,
  // so rows made in the meantime are revisited when the contracts land.
  let mine=++_bpPick;
  _bpSpecs={{}}; bpSpecsNote('');
  let classes=Object.values(g).map(n=>String((n||{{}}).class_type||'')).filter((c,i,a)=>c&&a.indexOf(c)===i);
  fetch('/video/nodespecs',{{method:'POST',body:JSON.stringify({{classes:classes,surface:'atlas'}})}})
   .then(r=>r.json())
   .then(r=>{{
    if(mine!==_bpPick) return;
    _bpSpecs=(r&&r.classes)||{{}};
    bpSpecsNote((r&&r.ok)?'':((r&&r.note)||'ComfyUI did not answer, so bounds and option lists were not read — these settings will not be range-checked.'));
    document.querySelectorAll('#bpParams .bpparam').forEach(row=>{{ if(row._bpSync) row._bpSync(); }});
   }})
   .catch(()=>{{ if(mine===_bpPick) bpSpecsNote('ComfyUI could not be asked for node contracts — these settings will not be range-checked.'); }});
  if(!document.getElementById('bpName').value){{
   document.getElementById('bpName').value=f.name.replace(/\\.json$/i,''); }}
  buildBpBindings();
  document.getElementById('bpmeta').style.display='flex';
  document.getElementById('bpSave').style.display='';
  bpStat('');
  bpGateWarn();
 }};
 rd.readAsText(f);
}}
function buildBpBindings(){{
 let wrap=document.getElementById('bpBindings'); wrap.innerHTML='';
 const all=bpAllInputs();
 // A (node,field) prefilled for one role is not offered to the next. Two roles on ONE
 // input is a silent wrong render, not a conflict anyone is told about: at render time
 // the later role overwrites the earlier one. The case that bites is a single-LoadImage
 // processing graph, where style_ref and shape_ref both matched it and shape_ref won —
 // so the graph received `normalize_shape_ref`'s grayscale silhouette on a black canvas
 // instead of the artwork. A one-CLIPTextEncode graph had the same shape with
 // positive/negative. The author can still pick the collision deliberately; it just is
 // no longer the default.
 let taken=new Map();
 let skipped=[];
 BP_ROLES.forEach(([role,req])=>{{
  let cands=bpCandidates(role,_bpGraph);
  let row=document.createElement('label');
  row.style.cssText='display:flex;align-items:center;gap:8px;color:#aaa';
  let lbl=document.createElement('span');
  lbl.style.cssText='min-width:90px';
  // A star on a role this graph cannot offer is a demand the author cannot meet,
  // which is exactly how the seed blocked every processing graph. Star `output`
  // always (it is the one hard requirement) and the rest only when there is
  // something to pick.
 lbl.textContent=role+((req&&(role===BP_STRUCTURAL||cands.length))?' *':'');
  let sel=document.createElement('select');
  sel.dataset.bprole=role;
  sel.style.cssText='flex:1;background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:6px';
  // Always offer "(not used)", even on a required role: the old modal made a
  // required role default to whatever the filter happened to approve FIRST, so a
  // wrong binding could publish without the author ever looking at that row.
  let blank=document.createElement('option'); blank.value=''; blank.textContent='(not used)';
  sel.appendChild(blank);
  if(cands.length){{
   let g=document.createElement('optgroup'); g.label='Suggested';
   cands.forEach(c=>{{
    let o=document.createElement('option');
    o.value=bpBindValue(role,c);
    o.textContent=bpNodeOpt(c.node)+(c.field?(' · '+c.field):'')+(c.via?(' — '+c.via):'');
    g.appendChild(o);
   }});
   sel.appendChild(g);
  }}
  let ga=document.createElement('optgroup');
  ga.label=(role==='output')?'All nodes':'All node inputs';
  if(role==='output'){{
   Object.keys(_bpGraph||{{}}).forEach(id=>{{
    let o=document.createElement('option'); o.value=id; o.textContent=bpNodeOpt(id); ga.appendChild(o);
   }});
  }} else {{
   all.forEach(t=>{{
    let o=document.createElement('option');
    o.value=t.node+'::'+t.field;
    o.textContent=bpNodeOpt(t.node)+' · '+t.field+(t.wired?' (wired)':'');
    ga.appendChild(o);
   }});
  }}
  sel.appendChild(ga);
  // Pre-fill only when the best suggestion is unambiguous — one target alone at
  // the top rank. Two equally good candidates (a graph with a first-half and a
  // second-half prompt) is a choice only the author can make.
  if(cands.length && (cands.length===1 || cands[0].rank!==cands[1].rank)){{
   let v=bpBindValue(role,cands[0]);
   if(taken.has(v)) skipped.push([role,taken.get(v)]);
   else {{ sel.value=v; taken.set(v,role); }}
  }}
  sel.onchange=()=>{{ document.querySelectorAll('#bpParams .bpparam').forEach(r=>{{
   if(r._bpRefresh) r._bpRefresh();
  }}); bpGateWarn(); bpRoleWarn(); }};
  row.appendChild(lbl); row.appendChild(sel); wrap.appendChild(row);
 }});
 let note=document.getElementById('bpBindNote');
 if(note){{
  note.innerHTML=skipped.length ? ('Left unbound on purpose: '
   +skipped.map(p=>'<b>'+p[0]+'</b> (the same input is already bound as <b>'+p[1]
    +'</b>)').join(', ')
    +'. Two roles on one input do not both apply — the later one overwrites the earlier, silently. Pick it anyway only if that is what you want.') : '';
  note.style.display=skipped.length?'':'none';
 }}
 bpRoleWarn();
}}
// An EXPECTED role left unbound on a graph that could satisfy it. Not a blocker:
// the author may want a fixed seed, or no prompt injected. But leaving it unbound
// by accident is silent at render time — the graph keeps whatever value its
// export baked, on every region — so say what will happen while the graph is
// still on screen. A role the graph cannot offer at all is not mentioned: there
// is nothing the author could do about it.
function bpRoleWarn(){{
 let box=document.getElementById('bpRoleNote'); if(!box) return;
 if(!_bpGraph){{ box.style.display='none'; box.innerHTML=''; return; }}
 let bound=new Set();
 document.querySelectorAll('#bpBindings [data-bprole]').forEach(sel=>{{
  if(sel.value) bound.add(sel.dataset.bprole);
 }});
 const CONSEQUENCE={{
  positive:'every region renders the prompt your export baked in, so the prompt on each card is ignored',
  seed:'every region and every new variant comes out identical, because the graph keeps the seed your export baked in'}};
 let hits=Object.keys(CONSEQUENCE).filter(r=>
  !bound.has(r) && bpCandidates(r,_bpGraph).length);
 if(!hits.length){{ box.style.display='none'; box.innerHTML=''; return; }}
 box.innerHTML='';
 let head=document.createElement('div');
 head.innerHTML='<b>⚠ '+(hits.length===1?('The '+hits[0]+' role is'):(hits.join(' and ')+' roles are'))
  +' unbound, but this graph has '+(hits.length===1?'one':'them')+'.</b> Publishing is allowed — this is a warning, not a refusal.';
 box.appendChild(head);
 hits.forEach(r=>{{
  let row=document.createElement('div');
  row.style.cssText='margin-top:6px';
  row.textContent='• '+r+' — '+CONSEQUENCE[r]+'.';
  box.appendChild(row);
 }});
 box.style.display='';
}}
// Current role->{{node,field}} set (from the binding selects) so a param can't
// offer a (node,field) already driven by a role (no double-drive). Reads the
// FIELD the author picked rather than a hardcoded per-role default.
function bpBoundTargets(){{
 let s=new Set();
 document.querySelectorAll('#bpBindings [data-bprole]').forEach(sel=>{{
  let role=sel.dataset.bprole, v=sel.value;
  if(!v||role==='output') return;
  let i=v.indexOf('::');
  if(i<0) return;
  s.add(v.slice(0,i)+'\\u0000'+v.slice(i+2));
 }});
 return s;
}}
// Scalar/enum inputs on a node that are NOT graph links (links are arrays) —
// the candidates a param can drive. Skips inputs already bound as a role.
function bpParamFields(nodeId){{
 let n=(_bpGraph||{{}})[nodeId]||{{}}; let inp=n.inputs||{{}};
 let bound=bpBoundTargets(); let out=[];
 for(const f of Object.keys(inp)){{
  let v=inp[f];
  if(Array.isArray(v)) continue;                 // a wired link, not a knob
  if(bound.has(nodeId+'\\u0000'+f)) continue;     // already a role target
  out.push(f);
 }}
 return out;
}}
// Infer a param type from a node input's baked value — and from the node's CLASS
// first, because the value alone lies about whole numbers: a PrimitiveFloat
// holding 1 (a duration, a cfg) reads as an int, and an int param would then
// refuse the 1.5 the knob exists to allow. The author can still change it.
function bpInferType(v,ct){{
 ct=String(ct||'');
 if(/PrimitiveBoolean|Boolean/i.test(ct)) return 'bool';
 if(/PrimitiveFloat|Float/i.test(ct)) return 'float';
 if(/PrimitiveInt/i.test(ct)) return 'int';
 if(/PrimitiveString/i.test(ct)) return 'text';
 if(typeof v==='boolean') return 'bool';
 if(typeof v==='number') return Number.isInteger(v)?'int':'float';
 return 'text';
}}
// A baked string that reads as PROSE rather than a token — long, or several
// words. What separates a second prompt from '#222222' or 'euler', and so what
// decides whether the setting gets a prompt-sized box in the settings panel.
function bpLooksLikeProse(v){{
 return typeof v==='string' && (v.length>40 || /\\s\\S+\\s/.test(v.trim()));
}}
// A first-guess param key from the NODE's own title, not the field name. On a
// graph whose knobs were converted to inputs every one of them is called
// `value`, so keying off the field gave a dozen rows all keyed `value` — which
// the tool rejects as duplicates. Kept off the reserved role names and made
// unique against the keys already in the modal.
// `selfEl` is the key input being filled — it MUST be excluded from the
// uniqueness check. Counting the row's own current key made every re-point
// collide with itself, so a row retargeted twice came out `SaveAnimatedWEBP2`,
// then `…3`, climbing on every change.
function bpSuggestKey(node,field,selfEl){{
 const n=(_bpGraph||{{}})[node]||{{}};
 const ct=String(n.class_type||'');
 const t=(n._meta&&n._meta.title)?String(n._meta.title).trim():'';
 let stem=((t&&t!==ct)?t:(ct+'_'+field)).replace(/[^A-Za-z0-9]+/g,'')||'param';
 const reserved=['positive','negative','seed','width','height','style_ref','shape_ref','output'];
 let used=[];
 document.querySelectorAll('#bpParams .bpparam [data-pkey]').forEach(el=>{{
  if(el!==selfEl && el.value.trim()) used.push(el.value.trim());
 }});
 let key=(reserved.indexOf(stem)>=0)?(stem+'_'+field):stem;
 let i=2;
 while(used.indexOf(key)>=0) key=stem+(i++);
 return key;
}}
// Baked mode switches this graph carries that NOTHING will be able to reach.
//
// A published blueprint's params are the ONLY inputs the runner writes; every
// other input keeps whatever the ComfyUI export saved, forever. That is what a
// day of `executionTimeout` failures turned out to be — an imported graph gated
// both its Wan passes on one PrimitiveBoolean left at false, selecting 50 steps
// with no speed LoRA, and nothing in the tool could change it. The built-in
// blueprint has the identical gate and differs only in exposing it. An unticked
// boolean looks exactly like one that does not matter, so the modal has to say
// which is which.
//
// Kept in step BY HAND with apps/launcher-api/src/lib/blueprintGates.ts, which is
// the tested twin (`node apps/launcher-api/blueprintGates.fixture.ts`) — this is a
// Python-rendered page and that is Svelte, opposite sides of the A/B line in
// docs/ui-inventory.md, so they cannot share the module.

// Matched by input NAME, not by class: `on_true`/`on_false` are inputs on that
// same switch node and are data, not the gate, so a class test counts every
// switch three times. `switch` is what core's ComfySwitchNode uses.
const BP_GATE_INPUTS=['switch','boolean'];
// Which (node, input) each node FEEDS — the forward index. Every other walk here
// runs backwards, from a consumer to the widget behind it; this one has to run
// forwards, because the question is what a knob CONTROLS.
function bpFeedIndex(){{
 let out={{}}; const g=_bpGraph||{{}};
 for(const id of Object.keys(g)){{
  const inp=(g[id]||{{}}).inputs||{{}};
  for(const f of Object.keys(inp)){{
   const s=bpLinkSource(inp[f]);
   if(!s) continue;
   (out[s]=out[s]||[]).push({{node:id,field:f}});
  }}
 }}
 return out;
}}
// How many switch gates a node's value ultimately reaches, following it forward
// through Primitive* relays. The relay hop is the point: a ComfyUI SUBGRAPH
// republishes an outer value as its own Primitive* node inside, so a top-level
// gate drives NOTHING that looks like a switch directly, and counting only direct
// consumers finds nothing at all on exactly the graphs this exists for.
function bpGateReach(feeds,id,seen){{
 seen=seen||[]; let n=0; const g=_bpGraph||{{}};
 for(const t of (feeds[id]||[])){{
  if(BP_GATE_INPUTS.indexOf(t.field)>=0){{ n++; continue; }}
  const ct=String((g[t.node]||{{}}).class_type||'');
  if(/^Primitive/i.test(ct) && seen.indexOf(t.node)<0){{
   seen.push(t.node); n+=bpGateReach(feeds,t.node,seen);
  }}
 }}
 return n;
}}
// A candidate is the same shape bpResolveKnob already calls a knob: exactly one
// input, nothing wired into it. That is what a Primitive* pulled out of a widget
// looks like, and it keeps a switch's own on_true/on_false out of the list.
function bpUnexposedGates(){{
 const g=_bpGraph; if(!g) return [];
 const feeds=bpFeedIndex();
 let taken=bpBoundTargets();
 document.querySelectorAll('#bpParams .bpparam').forEach(row=>{{
  let ns=row.querySelector('[data-pnode]'), fs=row.querySelector('[data-pfield]');
  if(ns&&fs&&ns.value&&fs.value) taken.add(ns.value+'\\u0000'+fs.value);
 }});
 let out=[];
 for(const id of Object.keys(g)){{
  const inp=(g[id]||{{}}).inputs||{{}};
  const fields=Object.keys(inp);
  if(fields.length!==1) continue;
  const f=fields[0];
  if(bpLinkSource(inp[f])!==null) continue;
  if(typeof inp[f]!=='boolean') continue;
  if(taken.has(id+'\\u0000'+f)) continue;
  const n=bpGateReach(feeds,id);
  if(n) out.push({{node:id,field:f,value:inp[f],switches:n}});
 }}
 return out.sort((a,b)=>(b.switches-a.switches)||String(a.node).localeCompare(String(b.node)));
}}
// Redraw the warning. Called wherever a binding or a settings row changes, so it
// CLEARS as it is acted on rather than nagging about a switch just exposed.
function bpGateWarn(){{
 let box=document.getElementById('bpGates'); if(!box) return;
 const gates=_bpGraph?bpUnexposedGates():[];
 if(!gates.length){{ box.style.display='none'; box.innerHTML=''; return; }}
 box.innerHTML='';
 let head=document.createElement('div');
 head.innerHTML='<b>⚠ This graph has '+(gates.length===1?'a switch':(gates.length+' switches'))
  +' nothing will be able to reach.</b> Only exposed settings are written at render '
  +'time — everything else keeps the value your ComfyUI export saved, on every '
  +'render, with no way to change it here.';
 box.appendChild(head);
 gates.forEach(gt=>{{
  let row=document.createElement('div');
  row.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px';
  let txt=document.createElement('span');
  txt.style.minWidth='0';
  txt.textContent=bpNodeOpt(gt.node)+' · '+gt.field+' — baked '+String(gt.value)
   +', switches '+gt.switches+(gt.switches===1?' input':' inputs');
  let b=document.createElement('button'); b.type='button'; b.textContent='Expose';
  b.style.cssText='font-size:11px;padding:3px 7px;flex:none';
  b.onclick=()=>bpExposeGate(gt.node,gt.field);
  row.appendChild(txt); row.appendChild(b);
  box.appendChild(row);
 }});
 box.style.display='';
}}
// Add a settings row already pointed at a gate, so the warning FIXES the thing it
// warns about instead of describing it. Key, type and default then come from
// syncFromField reading the graph, exactly as if the input had been picked by hand.
function bpExposeGate(node,field){{
 addBpParam();
 let rows=document.querySelectorAll('#bpParams .bpparam');
 let row=rows[rows.length-1]; if(!row) return;
 let ns=row.querySelector('[data-pnode]'), fs=row.querySelector('[data-pfield]');
 if(!ns||!fs) return;
 ns.value=node;
 if(row._bpRefresh) row._bpRefresh();
 fs.value=field;
 fs.dispatchEvent(new Event('change'));
 bpGateWarn();
}}
function addBpParam(){{
 let wrap=document.getElementById('bpParams'); if(!wrap||!_bpGraph) return;
 let row=document.createElement('div');
 row.className='bpparam';
 row.style.cssText='display:flex;flex-direction:column;gap:5px;border:1px solid #2a2a2e;border-radius:5px;padding:8px';
 // node select (only nodes with at least one unbound scalar input)
 let nodes=Object.keys(_bpGraph).filter(id=>bpParamFields(id).length>0);
 let nodeSel=document.createElement('select'); nodeSel.dataset.pnode='1';
 nodeSel.style.cssText='background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:5px';
 nodes.forEach(id=>{{ let o=document.createElement('option'); o.value=id;
  o.textContent=bpNodeOpt(id); nodeSel.appendChild(o); }});
 let fieldSel=document.createElement('select'); fieldSel.dataset.pfield='1';
 fieldSel.style.cssText='background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:5px';
 let typeSel=document.createElement('select'); typeSel.dataset.ptype='1';
 typeSel.style.cssText='background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:5px';
 ['int','float','text','bool','select'].forEach(t=>{{ let o=document.createElement('option'); o.value=t; o.textContent=t; typeSel.appendChild(o); }});
 let key=document.createElement('input'); key.dataset.pkey='1'; key.placeholder='key (e.g. steps)';
 key.style.cssText='background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:5px';
 let label=document.createElement('input'); label.dataset.plabel='1'; label.placeholder='label (shown in the panel)';
 label.style.cssText='background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:5px';
 let def=document.createElement('input'); def.dataset.pdefault='1'; def.placeholder='default';
 def.style.cssText='background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:5px';
 let opts=document.createElement('input'); opts.dataset.poptions='1'; opts.placeholder='options (comma-sep, select only)';
 opts.style.cssText='background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:5px;display:none';
 let mn=document.createElement('input'); mn.dataset.pmin='1'; mn.placeholder='min'; mn.type='number';
 mn.style.cssText='background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:5px;width:70px';
 let mx=document.createElement('input'); mx.dataset.pmax='1'; mx.placeholder='max'; mx.type='number';
 mx.style.cssText='background:#1a1a1e;color:#ddd;border:1px solid #333;border-radius:4px;padding:5px;width:70px';
 // A `text` param whose value is PROSE — a second prompt, a caption — gets a
 // full-width box in the settings panel instead of the narrow inline input every
 // other setting shares. Only ONE prompt can hold the `positive` role, so on a
 // two-prompt graph the other reaches the author as a setting, and a narrow field
 // is not somewhere anyone writes a prompt.
 let mlWrap=document.createElement('label');
 mlWrap.style.cssText='display:none;align-items:center;gap:5px;color:#888;font-size:11px';
 let ml=document.createElement('input'); ml.type='checkbox'; ml.dataset.pmultiline='1';
 let mlTxt=document.createElement('span'); mlTxt.textContent='prompt-sized box';
 mlWrap.appendChild(ml); mlWrap.appendChild(mlTxt);
 let rm=document.createElement('button'); rm.type='button'; rm.textContent='✕'; rm.title='remove';
 rm.style.cssText='font-size:11px;padding:3px 7px';
 rm.onclick=()=>{{ row.remove(); bpGateWarn(); }};
 // when node changes, repopulate fields + prefill key/default/type from the baked value
 function refreshFields(){{
  let keep=fieldSel.value;
  fieldSel.innerHTML='';
  bpParamFields(nodeSel.value).forEach(f=>{{ let o=document.createElement('option'); o.value=f; o.textContent=f; fieldSel.appendChild(o); }});
  if(keep && bpParamFields(nodeSel.value).indexOf(keep)>=0) fieldSel.value=keep;
  syncFromField();
 }}
 function syncTypeUi(){{
  opts.style.display=(typeSel.value==='select')?'':'none';
  mlWrap.style.display=(typeSel.value==='text')?'flex':'none';
 }}
 // What syncFromField last auto-filled. A prefill that only ran `if(!key.value)`
 // froze the row on whatever node it was CREATED with — addBpParam ends by
 // selecting the graph's first node, so every row came out keyed after that node
 // and defaulted to its value, and re-pointing the row silently changed nothing
 // but the type. Re-filling a field the author has not touched (its value is
 // still exactly what we put there) follows the node; the moment they type,
 // their text is theirs and the prefill stops.
 let autoKey='', autoLabel='', autoDef='', autoMin='', autoMax='', autoOpts='';
 function syncFromField(){{
  let v=((_bpGraph[nodeSel.value]||{{}}).inputs||{{}})[fieldSel.value];
  let ct=(_bpGraph[nodeSel.value]||{{}}).class_type;
  if(key.value===''||key.value===autoKey){{
   key.value=bpSuggestKey(nodeSel.value,fieldSel.value||'',key); autoKey=key.value;
  }}
  if(label.value===''||label.value===autoLabel){{ label.value=key.value; autoLabel=label.value; }}
  if(def.value===''||def.value===autoDef){{
   def.value=(v===undefined||v===null||Array.isArray(v))?'':String(v); autoDef=def.value;
  }}
  // The contract wins over the value (see `_bpSpecs`). A class ComfyUI did not
  // describe falls back to the baked-value guess; a `Primitive*` node's own
  // domain is wide open and stays honestly unbounded either way.
  let spec=(_bpSpecs[ct]||{{}})[fieldSel.value];
  typeSel.value=spec?spec.kind:bpInferType(v,ct);
  ml.checked=(typeSel.value==='text' && ((spec&&spec.multiline===true)||bpLooksLikeProse(v)));
  let auto=(el,was,next)=>{{ if(el.value===''||el.value===was) el.value=next; return next; }};
  let numeric=!!spec&&(spec.kind==='int'||spec.kind==='float');
  autoMin=auto(mn,autoMin,(numeric&&spec.min!=null)?String(spec.min):'');
  autoMax=auto(mx,autoMax,(numeric&&spec.max!=null)?String(spec.max):'');
  row._bpStep=(numeric&&spec.step!=null)?spec.step:null;
  autoOpts=auto(opts,autoOpts,(spec&&spec.kind==='select')?(spec.options||[]).join(', '):'');
  row._bpOptionsFrom=(spec&&spec.kind==='select')?{{class:ct,field:fieldSel.value}}:null;
  syncTypeUi();
  bpGateWarn();
 }}
 // A role binding changing can free or take a (node,field), so the field list is
 // rebuilt from the binding selects rather than frozen at Add time.
 row._bpRefresh=refreshFields;
 row._bpSync=syncFromField;
 nodeSel.onchange=refreshFields; fieldSel.onchange=syncFromField;
 typeSel.onchange=syncTypeUi;
 // The label follows the key until the author types a label of their own. The
 // label is what the settings panel SHOWS, and the row prefilled it with the
 // suggested key — so renaming the key published a setting still labelled after
 // the node, and the name typed into the row's first box never reached the panel.
 key.oninput=()=>{{ if(label.value===''||label.value===autoLabel){{ label.value=key.value; autoLabel=label.value; }} }};
 let r1=document.createElement('div'); r1.style.cssText='display:flex;gap:6px;flex-wrap:wrap;align-items:center';
 r1.appendChild(nodeSel); r1.appendChild(fieldSel); r1.appendChild(typeSel); r1.appendChild(mlWrap); r1.appendChild(rm);
 let r2=document.createElement('div'); r2.style.cssText='display:flex;gap:6px;flex-wrap:wrap;align-items:center';
 r2.appendChild(key); r2.appendChild(label); r2.appendChild(def); r2.appendChild(mn); r2.appendChild(mx);
 row.appendChild(r1); row.appendChild(r2); row.appendChild(opts);
 wrap.appendChild(row);
 refreshFields();
 // The list grows downward inside the scrolling body: without this, + Add appends a
 // row below the fold and the author has to go looking for what they just added.
 // Instant, not smooth: a smooth scroll is a silent no-op while the document is
 // hidden, and there is nothing worth animating about a one-row jump.
 row.scrollIntoView({{block:'nearest'}});
}}
function collectBpParams(){{
 let out=[];
 document.querySelectorAll('#bpParams .bpparam').forEach(row=>{{
  let g=s=>{{ let el=row.querySelector(s); return el?el.value.trim():''; }};
  let key=g('[data-pkey]'); let node=g('[data-pnode]'); let field=g('[data-pfield]');
  if(!key||!node||!field) return;
  let type=g('[data-ptype]')||'text';
  let p={{key:key,type:type,node:node,field:field,label:g('[data-plabel]')||key}};
  let dv=g('[data-pdefault]');
  if(dv!==''){{
   if(type==='int') p.default=parseInt(dv,10);
   else if(type==='float') p.default=parseFloat(dv);
   else if(type==='bool') p.default=(dv==='true'||dv==='1'||dv==='on');
   else p.default=dv;
  }}
  let mn=g('[data-pmin]'),mx=g('[data-pmax]');
  if(mn!=='') p.min=parseFloat(mn);
  if(mx!=='') p.max=parseFloat(mx);
  if(row._bpStep!=null&&(type==='int'||type==='float')) p.step=row._bpStep;
  if(type==='select'){{
   let o=g('[data-poptions]'); if(o) p.options=o.split(',').map(s=>s.trim()).filter(Boolean);
   // Where the list can be re-read LIVE — keyed on the node CLASS, which survives
   // a re-import that renumbers nodes. The baked `options` stay as the fallback.
   if(row._bpOptionsFrom) p.options_from=row._bpOptionsFrom;
  }}
  if(type==='text'){{
   let el=row.querySelector('[data-pmultiline]');
   if(el&&el.checked) p.multiline=true;
  }}
  out.push(p);
 }});
 return out;
}}
// Base names the ref/output CONVENTIONS, which differ per kind: the image bases are
// the three built-in pipelines, while a video base names a model family and is only
// metadata (nothing dispatches on it), so that list can grow without touching code.
function bpKindChanged(){{
 const kind=document.getElementById('bpKind').value;
 const sel=document.getElementById('bpBase');
 const opts=(kind==='video')
  ? [['wan22-i2v','wan22-i2v (image → video)'],['wan22-t2v','wan22-t2v (text → video)'],['other','other']]
  : [['sdxl','sdxl'],['flux','flux'],['gpt_image','gpt_image']];
 sel.innerHTML='';
 for(const [v,label] of opts){{
  const o=document.createElement('option'); o.value=v; o.textContent=label; sel.appendChild(o);
 }}
}}
async function saveBlueprint(overwrite){{
 if(!_bpGraph) return;
 bpStat('⬆ Publishing…');
 let bindings={{}};
 document.querySelectorAll('#bpBindings [data-bprole]').forEach(sel=>{{
  let role=sel.dataset.bprole, v=sel.value;
  if(!v) return;
  if(role==='output'){{ bindings[role]={{node:v}}; return; }}
  let i=v.indexOf('::');
  if(i<0) return;                       // node-only value on a field role: skip
  bindings[role]={{node:v.slice(0,i), field:v.slice(i+2)}};
 }});
 // `output` alone. A graph with no sampler has no seed to bind and a graph with
 // no text encoder has no prompt; refusing those made every processing blueprint
 // unpublishable. bpRoleWarn has already said what an unbound role will cost.
 if(!bindings[BP_STRUCTURAL]){{
  bpStat('Bind '+BP_STRUCTURAL+' first — it is the node the image is read from.');
  return; }}
 let body={{name:document.getElementById('bpName').value,
  description:document.getElementById('bpDesc').value,
  kind:document.getElementById('bpKind').value,
  base:document.getElementById('bpBase').value,
  workflow_text:JSON.stringify(_bpGraph),
  bindings:bindings, params:collectBpParams(), overwrite:!!overwrite,
  // The server sets the pipeline itself — it is the side that knows the slugged
  // id, so nothing has to parse one back out of the reply text.
  use_for_atlas:!!(document.getElementById('bpUseNow')||{{}}).checked}};
 let msg;
 try{{ let r=await fetch('/uploadblueprint',{{method:'POST',body:JSON.stringify(body)}});
  msg=(r.status===404)?'Upload endpoint missing — restart the service':await r.text();
 }}catch(e){{ msg='Publish failed: '+e; }}
 // A pre-existing id prompts to overwrite (mirror the .atlas confirm style).
 if(msg.indexOf('⚠')===0 && msg.indexOf('already exists')>=0 && !overwrite){{
  bpStat(msg);
  if(confirm(msg.replace('⚠ ','')+'\\n\\nOverwrite it?')) return saveBlueprint(true);
  return;
 }}
 bpStat(msg);
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
async function refreshModels(btn){{
 // Re-probe ComfyUI for its /object_info model lists and store them, then
 // reload so every dropdown re-renders from the fresh catalog.
 let s=document.getElementById('mdlstatmsg');
 if(s)s.textContent='⟳ Probing ComfyUI…';
 if(btn) btn.disabled=true;
 let msg;
 try{{ let r=await fetch('/refreshmodels',{{method:'POST',body:'{{}}'}});
  msg=(r.status===404)?'Refresh-models endpoint missing — restart the service':await r.text();
 }}catch(e){{ msg='Refresh-models request failed: '+e; }}
 if(s)s.textContent=msg;
 if(btn) btn.disabled=false;
 if(msg.indexOf('✓')===0) setTimeout(()=>location.reload(),1200);
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
 saveAllLoud();
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
 saveAllLoud();
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
 // Don't lose card edits across the reload this triggers.
 if(!await savedOk('Mode switch')) return;
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
async function selectVariant(name,id,seed){{
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
 // Commit the pick NOW. It used to ride along on the next saveAll(), which
 // dropped it unless the slot was also locked — so the card showed your pick
 // while Create Atlas quietly composed the newest file instead. And say so if
 // the save is REFUSED: the card is already showing the pick, so a silent
 // rejection here is the very symptom this whole change exists to end.
 await savedOk('The variant pick');
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
   let img=document.createElement('img'); img.loading='lazy'; img.decoding='async';
   img.src='/vthumb/'+name+'?id='+d.id+'&t='+Date.now();
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
 // The server clears a pin whose file just went, so the CARD has to follow it.
 // Left on the deleted id, the next saveAll() (a lock toggle, the next pick,
 // Render, Create Atlas) wrote that dangling pin straight back — and ids get
 // reused, so it would land on the next render's unrelated art.
 await refreshCards();
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
  // The output figure comes from the SERVER, which owns the pick: a render
  // supersedes an unlocked one, so the card must follow it off a stale ?id=
  // instead of showing a file Create Atlas will no longer compose.
  c.dataset.variant=d.variant||'';
  let im=c.querySelector('.bigsel'), lk=c.querySelector('.biglink');
  // Its ?t= is the source file's own mtime+size token, so an unchanged slot
  // stays cached and a re-rendered one refreshes — no blanket cache-bust.
  if(im&&d.thumb)im.src=d.thumb;
  if(lk&&d.full)lk.href=d.full;
  // JSON null must land as the same 'None' the page build writes, or
  // useSeed() puts the string 'null' in the seed box.
  c.dataset.usedseed=(d.seed_used??'None');
  let cap=c.querySelector('.selcap');
  if(cap)cap.textContent=d.cap||('output · seed '+(d.seed_used??'—'));
  c.dataset.dirty='0';        // post-render: back to committed resting state
  updateLock(c);
 }}
}}
async function renderSel(){{
 // Before saveAll(), so declining writes nothing. A render is the expensive way
 // to discover the prompt on screen was never the prompt that was sent.
 if(gstyleDirty()){{
  let panel=document.getElementById('gstylepanel');
  if(!confirm('The Atlas style panel has unsaved changes.\\n\\n'
   +'This render would use the SAVED prefix/suffix, not what is on screen — the big "Save changes" button does not save this panel.\\n\\n'
   +'OK — save the atlas style, then render.\\nCancel — go back to it.')){{
   if(panel){{ panel.open=true; panel.scrollIntoView({{block:'nearest'}}); }}
   return;
  }}
  let msg=await saveGlobalStyle();
  if(gstyleDirty()){{
   if(panel){{ panel.open=true; panel.scrollIntoView({{block:'nearest'}}); }}
   alert('The atlas style did not save, so the render was not started:\\n\\n'+msg);
   return;
  }}
 }}
 if(!await savedOk('Render')) return;
 let sel=collect().filter(x=>x.selected).map(x=>x.name);
 if(!sel.length){{alert('Nothing selected');return;}}
 let v=parseInt(document.getElementById('variants').value)||1;
 let b=document.getElementById('rbtn'); b.disabled=true;
 document.getElementById('sbtn').style.display='inline-block';
 document.getElementById('toast').style.display='none';
 document.getElementById('log').style.display='block';
 // The server's answer is not decoration: it refuses when a render is already
 // running. Ignoring it used to leave the button spinning on a render this
 // click never started.
 let ok=await (await fetch('/render',{{method:'POST',body:JSON.stringify({{names:sel,variants:v}})}})).text();
 if(ok.trim()!=='started'){{
  document.getElementById('stat').textContent=ok;
  b.disabled=false; document.getElementById('sbtn').style.display='none';
  alert(ok); return;
 }}
 poll();
}}
// Button to flash "✓ Done" on when the create/compose poll loop finishes.
let _atlasDoneBtn=null;
async function createAtlas(){{
 if(!await savedOk('Create Atlas')) return;
 _atlasDoneBtn=document.getElementById('abtn');
 document.getElementById('rbtn').disabled=true;
 document.getElementById('toast').style.display='none';
 document.getElementById('log').style.display='block';
 await fetch('/createatlas',{{method:'POST',body:'{{}}'}});
 poll();
}}
// Opens the Region Overlay Inspector (not the bare page bytes): it draws each
// manifest rect over the composed pixels and re-measures the art's real alpha
// bbox, so a rect/pixel mismatch is visible + screenshottable. location.search
// rides along so the tool bar's ?home/?tools switcher renders in the new tab
// (and ?k= re-arms the gate cookie if this tab was the one that carried it).
function viewAtlas(){{
  var q=location.search||'';
  window.open('/atlasview'+q+(q?'&':'?')+'t='+Date.now(),'_blank');
  flashDone(document.getElementById('vbtn'));
}}
async function deployAtlas(){{
 let t=document.getElementById('toast');
 t.style.display='inline-block'; t.textContent='📦 Deploying…';
 let st=document.getElementById('stat'); if(st)st.textContent='📦 Deploying…';
 let msg;
 try{{ let r=await fetch('/deployatlas',{{method:'POST',body:'{{}}'}});
  msg=(r.status===404)?'Deploy endpoint missing — restart run_ui.bat':await r.text();
 }}catch(e){{ msg='Deploy failed: '+e; }}
 t.textContent=msg; if(st)st.textContent=msg; flashDiag(msg);
 if(msg.indexOf('✓')===0) flashDone(document.getElementById('dbtn'));
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
  if(_atlasDoneBtn){{ flashDone(_atlasDoneBtn); _atlasDoneBtn=null; }}
  refreshCards();
  refreshCredits();   // a render/compose may have spent credits
 }}
}}
// The SERVER owns the render, not this tab. #log and #sbtn are display:none
// until renderSel() reveals them, and poll() only ever starts from a click in
// THIS tab — so a reload (or leaving the page and coming back) mid-render used
// to show a fully idle page with a live render still going behind it: no Stop
// button, no log, no diagnostics, and the progress bar back at "▶ Render
// selected". The only surviving hint was /render refusing the NEXT click with
// "a render is already running (2/2, started 2 minutes ago) — press Stop",
// naming a Stop button that was no longer on the page. Ask /progress on load
// and take the server's answer as the truth.
async function adoptServerRender(){{
 let j;
 try{{ j=await (await fetch('/progress')).json(); }}catch(e){{ return; }}
 // The log and diagnostics outlive the run that produced them — `_run_cmd`
 // clears both when the NEXT render starts, so what is here belongs to the
 // most recent one. Restore them whether or not something is still running:
 // after a FAILED render they are the entire record of what went wrong, and
 // a reload used to be enough to lose it.
 renderDiagnostics(j.diagnostics||[]);
 if(j.log){{
  let lg=document.getElementById('log');
  lg.style.display='block'; lg.textContent=j.log; lg.scrollTop=1e9;
 }}
 if(!j.running) return;
 document.getElementById('rbtn').disabled=true;
 document.getElementById('sbtn').style.display='inline-block';
 document.getElementById('toast').style.display='none';
 poll();   // takes over the progress bar, the label and the Stop lifecycle
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
document.addEventListener('keydown',e=>{{if(e.key==='Escape'){{closeModal();closeAdv();closeFs();closeNewAtlas();}}}});
window.addEventListener('DOMContentLoaded',function(){{
 updateAllLocks(); refreshCredits(); setInterval(refreshCredits,60000);
 adoptServerRender();
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
  <button class="cpbtn" title="Copy settings (prompt + advanced + shine; NOT reference image, seed or lock)" onclick="copyCfg('{name}')">⧉</button><button class="ptbtn" title="Paste copied settings into this region" onclick="pasteCfg('{name}')">📥</button>{del_btn}{mode_sel}</h3>
 <div class="role">{role}</div>
 <div class="imgs">
  <figure>
   <div class="imgwrap">
    <a class="biglink" href="{biglink}" target="_blank"><img src="{bigthumb}" class="bigsel" loading="lazy" decoding="async"></a>
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
    <img src="/ref/{name}?t={cb}" loading="lazy" decoding="async">
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


def apply_region_edits(edits: list[dict]) -> str:
    """Merge one page's worth of card edits into the active manifest.

    Module level and self-less by nature — it only ever touched the
    manifest. Handler._save is the thin locked wrapper over it."""
    m = load_manifest()
    by_name = {e["name"]: e for e in edits}
    changed = 0
    picks = 0
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
                # A variant pick is the WHOLE of what a promptless region
                # can say. `.atlas`-bound regions get a card from the
                # geometry file whether or not the manifest holds an entry,
                # so leaving the pick out of this gate meant no stub, no
                # entry, and the pick dropped — the same silent loss, for
                # every atlas driven by the global prefix/suffix alone.
                or str(e.get("variant", "")).strip()
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
            # The picked variant is WHICH generated file this region shows
            # and composes; the lock is whether the slot may be re-rendered.
            # They used to share one branch, so a pick made without also
            # ticking lock was thrown away on the very next save — the card
            # kept showing it while Create Atlas silently composed the
            # newest file instead. Persist the pick on its own.
            vid = str(e.get("variant", "")).strip()
            new_pick = vid != str(r.get("variant", ""))
            if new_pick:
                picks += 1
            if vid:
                r["variant"] = vid
                # Which generation the pick belongs to: the newest file that
                # existed when it was made. That is what says whether a later
                # render has spent it (batch_atlas.effective_variant).
                # Stamped ONLY when the pick actually changes — saveAll()
                # re-posts every card's current pick on every save, and
                # re-stamping there would silently un-spend a pick the last
                # render had already superseded, which is the whole bug.
                if new_pick:
                    at = newest_variant_id(r["name"])
                    if at:
                        r["variant_at"] = at
                    else:
                        r.pop("variant_at", None)
            else:
                r.pop("variant", None)
                r.pop("variant_at", None)
            # Store the lock EXPLICITLY (both ways). It used to be inferred
            # from a stored seed, or — for GPT, which has no embedded seed —
            # from a stored pick; with the pick now saved unlocked too, that
            # inference would read every pick as a lock.
            # A tick with NOTHING to pin (no seed, no pick) is not a lock,
            # it's an intent — same rule the card has always drawn (updateLock
            # shows "lock this pick", not LOCKED). Storing it would tick the
            # box on reload beside that very button, and claim a slot is
            # pinned that re-renders every time.
            r["lock"] = bool(e["lock"]) and bool(e["seed"] or vid)
            if e["lock"] and e["seed"]:
                try:
                    r["seed"] = int(e["seed"])
                except ValueError:
                    r.pop("seed", None)
            else:
                r.pop("seed", None)
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
    # Name the pick explicitly. "Saved (0 prompt change(s))" after clicking
    # a variant read as "nothing happened" — which is exactly what USED to
    # happen to an unlocked pick.
    note = f"Saved ({changed} prompt change(s)"
    return note + (f", {picks} variant pick(s))" if picks else ")")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, ctype, body: bytes, extra_headers: dict | None = None):
        self._responded = True
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        merged = dict(getattr(self, "_set_cookie", None) or {})
        merged.update(extra_headers or {})
        # Default to no-store (config/JSON/HTML are dynamic). A caller that wants
        # a cacheable response (image routes, via imgcache.cache_headers) passes
        # its own Cache-Control, which then wins — don't emit both.
        if "Cache-Control" not in merged:
            self.send_header("Cache-Control", "no-store")
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
        # Per-user ComfyUI routing (per-user-comfyui-routing.md): the launcher
        # forwards the logged-in user as `?user=` (stuck into an `iw_user` cookie
        # so in-tool navigation keeps it). Used ONLY to route generation to that
        # user's own registered ComfyUI; blank ⇒ the shared tunnel. Not a tenant
        # boundary (that's client/project), so a plain slug is enough.
        u_param = (q.get("user", [""])[0] or "").strip()
        mu = re.search(r"iw_user=([^;]+)", cookie)
        self._user_id = (project_paths.r2_slug(u_param)
                         or (mu.group(1).strip() if mu else ""))
        if u_param and self._user_id:
            self._extra_cookies.append(
                f"iw_user={self._user_id}; Path=/; SameSite=None; Secure")

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
                        # By path + under the lock, same as the dropdown twin
                        # in _saveconfig: the seed decodes and mirrors an image
                        # per region, so writing its whole starting snapshot
                        # back would undo anything saved meanwhile.
                        with pinned_manifest(manifest_path()) as mp:
                            with _manifest_lock:
                                nm = _read_manifest_at(mp) or {}
                                # Heal a pre-fix handoff on ACTIVATION too, not
                                # only in the compose pre-pass, so the
                                # inspector's placement readout tells the truth
                                # straight away instead of reporting `fill`
                                # until someone risks a Create Atlas.
                                # Deliberately NOT gated on `export_prefix`
                                # like the seed below: an imported manifest
                                # lost that field as well, and the repair is
                                # evidence-gated on its own.
                                if repair_sheet_fit_mode(nm):
                                    _write_manifest_at(mp, nm)
                            if bool(nm.get("export_prefix")):
                                before = _fingerprints(nm, _SEED_RESULT_KEYS)
                                res = self._seed_refs_into_outputs(
                                    nm, only_empty=True)
                                if res["names"]:
                                    persist_region_fields(
                                        mp,
                                        _lift_region_fields(nm, res["names"],
                                                            _SEED_RESULT_KEYS),
                                        before, _SEED_RESULT_KEYS)
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
        self._dispatch(self._get)

    def _dispatch(self, fn) -> None:
        """Run one request handler, and answer even when it raises.

        An exception that escapes here reaches socketserver, which closes the
        socket having written nothing. On an image route the browser sees that
        as a broken tile forever — the file was fine, the request just never
        got an answer. A 500 with a body is honest and, unlike a dead socket,
        is something the page's retry loader can act on."""
        self._responded = False
        try:
            fn()
        except Exception as e:  # noqa: BLE001 — a silent drop is worse
            traceback.print_exc()
            if self._responded:
                return  # headers already on the wire; a second reply is garbage
            try:
                self._send(500, "text/plain",
                           f"{type(e).__name__}: {e}".encode())
            except OSError:
                pass  # client hung up first

    def _get(self):
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
        elif path == "/blueprintresolved":
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            self._send(200, "application/json",
                       self._blueprintresolved(
                           qs.get("manifest", [""])[0],
                           qs.get("region", [""])[0],
                           qs.get("blueprint", [""])[0]))
        elif path == "/cardsdata":
            self._send(200, "application/json", self._cardsdata())
        # --- Flipbook video sessions (docs/design/invisible-flipbook-video.md).
        # Stateless + session-scoped: none of these touch the active manifest,
        # so a video session and an atlas render can't clobber each other.
        elif path == "/video/blueprints":
            # VIDEO blueprints only. The Atlas Maker's image networks share the
            # same shared library but are a different tool's; offering them here
            # is a trap, not a feature.
            self._send(200, "application/json",
                       json.dumps(blueprints.list_blueprints(kind="video")).encode())
        elif path == "/video/library":
            # Diagnostic: what R2 holds vs what hydrated vs what validated. The
            # empty-list case used to be indistinguishable between "seed never
            # landed", "service has not restarted" and "blueprint rejected".
            self._send(200, "application/json",
                       json.dumps(blueprints.library_status()).encode())
        elif path == "/video/sessions":
            # A listing that cannot be completed answers with an ERROR, never with the
            # part of it that happened to load. A short list is indistinguishable from
            # a true one at the UI, so the author reads it as work that vanished.
            try:
                self._send(200, "application/json",
                           json.dumps(video_runner.list_sessions()).encode())
            except Exception as e:  # noqa: BLE001 — the finding IS that R2 was unreadable
                print(f"[video] session listing failed: {e}", flush=True)
                self._send(503, "application/json", json.dumps({
                    "error": "Could not read this project's video sessions from "
                             "storage, so the list would have been incomplete. "
                             "Nothing is lost — try again in a moment.",
                }).encode())
        elif path == "/video/status":
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            s = video_runner.get_session(qs.get("session", [""])[0])
            if s is None:
                self._send(404, "application/json", b'{"error":"no such session"}')
            else:
                self._send(200, "application/json", json.dumps(s).encode())
        elif path == "/video/probe":
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            self._send(200, "application/json",
                       self._video_probe(qs.get("session", [""])[0],
                                         qs.get("v", [""])[0]))
        elif path == "/video/file":
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            blob = video_runner.read_variation(qs.get("session", [""])[0],
                                               qs.get("v", [""])[0])
            if blob is None:
                self._send(404, "text/plain", b"not found")
            else:
                self._send(200, "image/webp", blob)
        elif path == "/video/zip":
            # The interchange export: one variation's frames as PNGs. `v` is the
            # variation INDEX here, as it is for /video/probe — not the stored
            # filename /video/file takes — because this route has to refuse a
            # variation that has not finished, which only the session doc knows.
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            self._video_zip(qs.get("session", [""])[0], qs.get("v", [""])[0])
        elif path.startswith("/regionadv/"):
            self._send(200, "application/json", self._regionadv(path.rsplit("/", 1)[-1]))
        elif path == "/atlasimg":
            af = atlas_file()
            if af.exists():
                self._send(200, "image/png", af.read_bytes())
            else:
                self._send(404, "text/plain", b"No atlas built yet. Use 'Build final atlas'.")
        elif path == "/atlasview":
            self._send(200, "text/html; charset=utf-8",
                       self._atlasview().encode("utf-8"))
        elif path == "/parityscan":
            self._send(200, "application/json", self._parityscan())
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
        self._dispatch(self._post)

    def _post(self):
        ok, self._set_cookie = self._gate()
        if not ok:
            self._send(403, "text/plain", b"forbidden")
            return
        self._resolve_context()
        self._resolve_publish()
        length = int(self.headers.get("Content-Length", 0))
        # The tool's own page POSTs to BARE paths and carries its (client, project)
        # in cookies. The launcher proxy has no cookies, so it MUST append
        # `?k=&client=&project=&user=` — and a raw `self.path` comparison never
        # matches a proxied POST, so the route silently falls through to the 404.
        # GET has always parsed (see do_GET); this makes POST agree. Every bare
        # path is unchanged by the parse, so the tool's own calls behave exactly
        # as before — the only difference is that a proxied call now resolves.
        post_path = urllib.parse.urlparse(self.path).path
        # Blueprint upload writes attacker-sized JSON to the SHARED library +
        # staging, so cap it (a real workflow graph is well under this).
        if post_path == "/uploadblueprint" and length > 4_000_000:
            self._send(200, "text/plain",
                       b"Blueprint upload too large (max ~4 MB).")
            return
        raw = self.rfile.read(length).decode("utf-8")
        if post_path == "/taxonomy/get":
            self._send(200, "application/json",
                       json.dumps(self._taxonomy_get()).encode())
        elif post_path == "/taxonomy/save":
            self._send(200, "application/json",
                       json.dumps(self._taxonomy_save(json.loads(raw or "{}"))).encode())
        elif post_path == "/save":
            self._send(200, "text/plain", self._save(json.loads(raw)).encode())
        elif post_path == "/saveconfig":
            self._send(200, "text/plain", self._saveconfig(json.loads(raw)).encode())
        elif post_path == "/render":
            payload = json.loads(raw)
            names = payload.get("names", [])
            variants = int(payload.get("variants", 1))
            started, msg = claim_render_slot()
            if started:
                ctx = (project_paths.client_name(), project_paths.project_name())
                user = getattr(self, "_user_id", "") or ""
                threading.Thread(target=run_render,
                                 args=(names, variants, ctx, user),
                                 daemon=True).start()
            self._send(200, "text/plain", msg.encode())
        elif post_path == "/createatlas":
            if not _render_state["running"]:
                ctx = (project_paths.client_name(), project_paths.project_name())
                threading.Thread(target=run_compose, args=(ctx,),
                                 daemon=True).start()
            self._send(200, "text/plain", b"composing")
        elif post_path == "/stop":
            self._send(200, "text/plain", stop_render().encode())
        elif post_path == "/delvariants":
            self._send(200, "text/plain", self._delvariants(json.loads(raw)).encode())
        elif post_path == "/newatlas":
            self._send(200, "text/plain", self._newatlas(json.loads(raw)).encode())
        elif post_path == "/addregion":
            self._send(200, "text/plain", self._addregion(json.loads(raw)).encode())
        elif post_path == "/delregion":
            self._send(200, "text/plain", self._delregion(json.loads(raw)).encode())
        elif post_path == "/saveadv":
            self._send(200, "text/plain", self._saveadv(json.loads(raw)).encode())
        elif post_path == "/saveglobalstyle":
            self._send(200, "text/plain", self._saveglobalstyle(json.loads(raw)).encode())
        elif post_path == "/uploadatlas":
            self._send(200, "text/plain", self._uploadatlas(json.loads(raw)).encode())
        elif post_path == "/uploadblueprint":
            try:
                payload = json.loads(raw)
            except ValueError:
                self._send(200, "text/plain",
                           b"Invalid request body (not JSON).")
                return
            self._send(200, "text/plain",
                       self._uploadblueprint(payload).encode())
        elif post_path == "/deleteblueprint":
            self._send(200, "text/plain",
                       self._deleteblueprint(json.loads(raw)).encode())
        elif post_path == "/rescanblueprintmodels":
            self._send(200, "text/plain",
                       self._rescanblueprintmodels(json.loads(raw)).encode())
        elif post_path == "/refresh":
            self._send(200, "text/plain", self._refresh().encode())
        elif post_path == "/clearcache":
            self._send(200, "text/plain", self._clearcache().encode())
        elif post_path == "/refreshmodels":
            self._send(200, "text/plain", self._refreshmodels().encode())
        elif post_path == "/sliceatlas":
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
        elif post_path == "/setref":
            self._send(200, "text/plain", self._setref(json.loads(raw)).encode())
        elif post_path == "/clearref":
            self._send(200, "text/plain", self._clearref(json.loads(raw)).encode())
        elif post_path == "/setoutput":
            self._send(200, "text/plain", self._setoutput(json.loads(raw)).encode())
        elif post_path == "/userefimg":
            self._send(200, "text/plain", self._userefimg(json.loads(raw)).encode())
        elif post_path == "/userefall":
            self._send(200, "text/plain", self._userefall(json.loads(raw)).encode())
        elif post_path == "/clearoutput":
            self._send(200, "text/plain", self._clearoutput(json.loads(raw)).encode())
        elif post_path == "/shinefrom":
            self._send(200, "text/plain", self._shinefrom(json.loads(raw)).encode())
        elif post_path == "/shinemode":
            self._send(200, "text/plain", self._shinemode(json.loads(raw)).encode())
        elif post_path == "/copyfrom":
            self._send(200, "text/plain", self._copyfrom(json.loads(raw)).encode())
        elif post_path == "/setmode":
            self._send(200, "text/plain", self._setmode(json.loads(raw)).encode())
        elif post_path == "/fxbuild":
            self._send(200, "text/plain", self._fxbuild(json.loads(raw)).encode())
        elif post_path == "/video/nodespecs":
            # A contract lookup, not a session action — so not through `_video`,
            # which scopes a route to one session, and never a ref-mutating route.
            self._send(200, "application/json", self._video_nodespecs(raw))
        elif post_path in ("/video/generate", "/video/cancel", "/video/delete",
                           "/video/toclip", "/video/torefs", "/video/regen",
                           "/video/discard", "/video/add", "/video/duplicate"):
            self._send(200, "application/json", self._video(post_path, raw))
        else:
            self._send(404, "text/plain", b"not found")
            return
        # Durability: mirror staging refs to R2 after handlers that write/remove
        # ref images, so they survive container restarts (R2 is source of truth).
        if post_path in _REF_MUTATING_ROUTES and R2_PREFIX:
            try:
                storage.push_dir(INPUT_DIR, f"{R2_PREFIX}/input")
            except Exception:  # noqa: BLE001
                pass

    # helpers ----------------------------------------------------------
    def _video(self, route: str, raw: str) -> bytes:
        """POST side of the Flipbook video session API.

        Anything the caller can fix comes back as `{"error": "<message>"}` with a
        200, so the tool renders the message verbatim — same contract the
        blueprint upload uses, and the reason `video_runner` raises `ValueError`
        for user-fixable problems and everything else for real faults."""
        try:
            payload = json.loads(raw or "{}")
        except ValueError:
            return b'{"error":"Request body was not valid JSON."}'
        if not isinstance(payload, dict):
            return b'{"error":"Request body was not a JSON object."}'
        try:
            if route == "/video/generate":
                # The worker thread cannot read this request thread's
                # thread-local context, so capture it here and hand it over.
                ctx = (project_paths.client_name(), project_paths.project_name())
                user = getattr(self, "_user_id", "") or ""
                return json.dumps(
                    video_runner.start_session(payload, ctx, user)).encode()
            sid = str(payload.get("session") or "")
            if route == "/video/cancel":
                return json.dumps(video_runner.cancel_session(sid)).encode()
            if route in ("/video/regen", "/video/add", "/video/duplicate"):
                # All three re-open a settled session and hand it back to the
                # runner, so all three need the caller's context for the same
                # reason generate does — a worker thread resolves paths from its
                # own thread-local.
                ctx = (project_paths.client_name(), project_paths.project_name())
                fn = {"/video/regen": video_runner.regenerate_variation,
                      "/video/add": video_runner.add_variations,
                      "/video/duplicate": video_runner.duplicate_variation}[route]
                return json.dumps(fn(sid, payload, ctx)).encode()
            if route == "/video/discard":
                return json.dumps(
                    video_runner.discard_variation(sid, payload)).encode()
            if route == "/video/toclip":
                # Packing is seconds of Pillow work, not minutes of GPU — so it
                # runs INLINE on the request thread rather than becoming a second
                # background-job system with its own status polling.
                return json.dumps(video_to_clip.build_clip_sheet(
                    sid,
                    int(payload.get("variation") or 0),
                    name=str(payload.get("name") or ""),
                    start=int(payload.get("start") or 0),
                    end=int(payload.get("end") or 0),
                    stride=int(payload.get("stride") or 1),
                    max_size=int(payload.get("max_size") or 0),
                )).encode()
            if route == "/video/torefs":
                # The other export: the same frames as Atlas Maker REFERENCE
                # images (full size, untrimmed, unpacked) + an empty `grid`
                # manifest pointing at them. Inline for the same reason toclip
                # is — Pillow seconds, not GPU minutes. NOT in
                # `_REF_MUTATING_ROUTES`: that mirror re-pushes the WHOLE input
                # tree, and this route has already put every file it wrote.
                # `fit` is optional and validated by the module (an unknown one
                # raises ValueError → the `{"error": …}` shape below).
                return json.dumps(video_to_refs.build_ref_set(
                    sid,
                    int(payload.get("variation") or 0),
                    name=str(payload.get("name") or ""),
                    start=int(payload.get("start") or 0),
                    end=int(payload.get("end") or 0),
                    stride=int(payload.get("stride") or 1),
                    fit=str(payload.get("fit") or video_to_refs.DEFAULT_FIT),
                )).encode()
            return json.dumps(video_runner.delete_session(sid)).encode()
        except ValueError as e:
            return json.dumps({"error": str(e)}).encode()
        except Exception as e:  # noqa: BLE001 — never 500 into the tool UI
            print(f"[video] {route} failed: {e}", flush=True)
            return json.dumps({"error": f"{type(e).__name__}: {e}"}).encode()

    def _video_nodespecs(self, raw: str) -> bytes:
        """What ComfyUI declares its node inputs to BE — ranges and option lists.

        Two callers, one read (see `comfy_specs`): the blueprint IMPORTER sends
        `classes[]` for the graph it is holding, so a param gets the node's own
        min/max and a COMBO becomes a dropdown instead of a free-text box; the
        Generate PANEL sends `blueprint` and gets each param's current list, so a
        model installed on the pod today shows up without a re-import.

        A pod that is asleep is the NORMAL case, not an error — it answers
        `ok:false` with a note and the caller keeps what it already had.

        The contract is read for the machine that will RUN the graph: the Atlas
        Maker page (`surface: "atlas"`) follows the project's ⚙ *Run generation
        on*; a video render never consults that setting — it runs in-process on
        the service default — so the Flipbook reads the default target."""
        import comfy_specs  # local import: this is the only route that reads contracts
        try:
            payload = json.loads(raw or "{}")
        except ValueError:
            return b'{"error":"Request body was not valid JSON."}'
        if not isinstance(payload, dict):
            return b'{"error":"Request body was not a JSON object."}'
        target = (effective_run_on() if payload.get("surface") == "atlas"
                  else _env_run_on())
        try:
            classes = payload.get("classes")
            bp_id = str(payload.get("blueprint") or "").strip()
            if isinstance(classes, list) and classes:
                out = comfy_specs.specs_for_classes(classes, target=target)
            elif bp_id:
                bp = blueprints.get_blueprint(bp_id)
                out = (comfy_specs.specs_for_blueprint(bp, target=target) if bp else
                       {"ok": False, "source": "", "params": {},
                        "note": f"No blueprint '{bp_id}' in the library."})
            else:
                out = {"ok": False, "source": "", "classes": {},
                       "note": "Ask for `classes` (a list) or a `blueprint` id."}
            return json.dumps(out).encode()
        except Exception as e:  # noqa: BLE001 — an unreadable contract is never fatal
            print(f"[video] nodespecs failed: {e}", flush=True)
            return json.dumps({"ok": False, "source": "", "classes": {},
                               "note": f"{type(e).__name__}: {e}"}).encode()

    def _video_probe(self, session: str, variation: str) -> bytes:
        """Frame count / size / fps / has-alpha for ONE variation — what the trim
        panel needs to show a cost before the author commits to packing."""
        try:
            return json.dumps(
                video_to_clip.probe_variation(session, int(variation or 0))).encode()
        except ValueError as e:
            return json.dumps({"error": str(e)}).encode()
        except Exception as e:  # noqa: BLE001 — never 500 into the tool UI
            return json.dumps({"error": f"{type(e).__name__}: {e}"}).encode()

    def _video_zip(self, session: str, variation: str) -> None:
        """One variation's frames as a PNG sequence in a ZIP.

        Answers with an ERROR STATUS + JSON on refusal, never with a broken zip:
        a browser saves whatever it is given under the name it was asked for, so
        a 200 carrying `{"error": …}` becomes a `.zip` that will not open and
        says nothing about why."""
        try:
            fname, blob = video_to_clip.frame_zip(session, int(variation or 0))
        except ValueError as e:
            self._send(400, "application/json", json.dumps({"error": str(e)}).encode())
            return
        except Exception as e:  # noqa: BLE001 — never 500 into the tool UI
            self._send(500, "application/json",
                       json.dumps({"error": f"{type(e).__name__}: {e}"}).encode())
            return
        self._send(200, "application/zip", blob,
                   {"Content-Disposition": f'attachment; filename="{fname}"'})

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
            # ETag from the source file's mtime+size: cheap (a stat, no read) and
            # changes whenever the image is rewritten (re-render / re-upload), so
            # a freshly regenerated image still refreshes in place. For the full
            # image we can 304 BEFORE reading the file; for a thumb we can 304
            # before the (cached) decode — both skip the body when unchanged.
            etag = imgcache.etag_for_path(p)
            inm = self.headers.get("If-None-Match")
            if etag and imgcache.not_modified(inm, etag):
                self._send(304, "image/jpeg" if thumb else "image/png", b"",
                           imgcache.cache_headers(etag))
                return
            headers = imgcache.cache_headers(etag)
            if thumb:
                self._send(200, "image/jpeg", thumb_bytes(p), headers)
            else:
                self._send(200, "image/png", p.read_bytes(), headers)
            return
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="220" height="160">'
               f'<rect width="220" height="160" fill="#1a1a1e"/><text x="110" y="84" '
               f'fill="#666" font-size="13" text-anchor="middle">{label}</text></svg>')
        self._send(200, "image/svg+xml", svg.encode())

    def _atlasview(self) -> str:
        """Region Overlay Inspector page (`/atlasview`) — see ATLASVIEW.

        Serves the manifest's CURRENT region geometry (the same
        `all_regions()` merge the cards use, so `.atlas`-bound manifests get
        the authoritative `bounds:`/`offsets:` from the `.atlas`) alongside the
        composed page. The page bytes come from the existing `/atlasimg` route
        — this page never re-serves them."""
        m = load_manifest()
        keep_full = batch_atlas.keep_full_frame(m)
        regions = [v for v in (_view_region(r, keep_full)
                               for r in all_regions(m)) if v]
        af = atlas_file()
        # Cache-bust the page bytes: "Create Atlas" rewrites the same filename,
        # so a re-opened inspector must not measure the previous compose.
        img_url = "/atlasimg?t=" + str(int(time.time() * 1000))
        return (ATLASVIEW
                .replace("__TOOLBAR_CSS__", IW_TOOLBAR_CSS)
                .replace("__TOOLBAR__", IW_TOOLBAR)
                .replace("__REGIONS__", _js_json(regions))
                .replace("__PAGE_URL__", _js_json(img_url))
                .replace("__MANIFEST__", _js_json(manifest_path().name))
                .replace("__TOL__", str(PARITY_TOL))
                .replace("__FILLT__", "98")
                .replace("__HAS_PAGE__", "true" if af.exists() else "false"))

    def _parityscan(self) -> bytes:
        """Sheet-parity verdict for every region (see `_parity_of`).

        One pass: the composed page is opened ONCE and each region's source is
        recomposed against it. Called on demand from the inspector (a button),
        not on load — it reads every source PNG off staging."""
        af = atlas_file()
        if not af.exists():
            return json.dumps({"error": "no composed atlas yet"}).encode()
        project_paths.ensure_lazy("batch/")  # variant pile hydrates on demand
        out = {}
        t0 = time.time()
        try:
            with Image.open(af) as raw:
                page = raw.convert("RGBA")
        except (OSError, ValueError) as e:
            return json.dumps({"error": f"page unreadable: {e}"}).encode()
        for r in all_regions(load_manifest()):
            name = str(r.get("name", ""))
            if not name:
                continue
            try:
                out[name] = _parity_of(r, page)
            except Exception as e:  # noqa: BLE001 — one bad region must not
                # sink the whole scan; report it in place of a verdict.
                out[name] = {"verdict": "NO SOURCE", "delta": "",
                             "why": f"parity check failed: {e}"}
        return json.dumps({"regions": out, "tol": PARITY_TOL,
                           "ms": int((time.time() - t0) * 1000)}).encode()

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
        kind = str(payload.get("kind", "")).strip().lower() or "image"
        if kind not in blueprints.BLUEPRINT_KINDS:
            return (f"✖ kind must be one of "
                    f"{' / '.join(blueprints.BLUEPRINT_KINDS)} (got '{kind}').")
        base = str(payload.get("base", "")).strip().lower()
        if kind == "image":
            base = base or "sdxl"
            if base not in ("sdxl", "flux", "gpt_image"):
                return ("✖ base must be one of sdxl / flux / gpt_image "
                        f"(got '{base}').")
        else:
            # A video blueprint's base names a model family (wan22-i2v, …), which
            # is metadata we do not dispatch on — so it is free-form rather than a
            # list that would need editing every time a new model lands.
            base = base or kind
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

        # Exposed params ("general settings") — optional. Each carries a baked
        # default + the node/field it drives. We keep only the recognized shape
        # here; blueprints._validate_params does the real validation (key/type,
        # role/key collisions, no double-drive) and validate_against_graph
        # checks the node/field exist. Anything malformed surfaces as a readable
        # string, never a 500.
        raw_params = payload.get("params")
        clean_params: list = []
        if raw_params is not None:
            if not isinstance(raw_params, list):
                return "✖ 'params' must be a list."
            for i, p in enumerate(raw_params):
                if not isinstance(p, dict):
                    return f"✖ params[{i}] must be an object."
                key = str(p.get("key", "")).strip()
                if not key:
                    return f"✖ params[{i}] needs a key."
                ptype = str(p.get("type", "")).strip().lower()
                node = str(p.get("node", "")).strip()
                field = str(p.get("field", "")).strip()
                entry = {"key": key, "type": ptype, "node": node,
                         "field": field,
                         "label": str(p.get("label", "")).strip() or key,
                         "default": p.get("default")}
                for opt in ("min", "max", "step", "options", "group",
                            "multiline"):
                    if p.get(opt) not in (None, ""):
                        entry[opt] = p[opt]
                clean_params.append(entry)

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
        existing = blueprints.get_blueprint(bp_id)
        if existing is not None and not overwrite:
            return (f"⚠ A blueprint '{bp_id}' already exists. Re-submit with "
                    "overwrite to replace it.")

        # What this graph needs INSTALLED, read off the graph itself. Until this
        # existed every uploaded blueprint declared `models: []`, which is why a
        # graph naming two files the target machine didn't have reached the GPU
        # (2026-09-07) — nothing declared them, so nothing could check or install
        # them. On an overwrite the previous manifest's human-added provenance
        # (`url`/`r2_key`/`sha256`/...) is folded back on; entries the graph no
        # longer references are dropped and named in the reply.
        models, dropped_models = blueprints.merge_model_provenance(
            blueprints.derive_models_from_graph(graph),
            (existing or {}).get("meta", {}).get("models"))
        author = self._publish_author()
        # Where each of those files lives in the shared model mirror, recorded
        # now so the render path can name a key and a size instead of only a
        # filename. Best-effort: never blocks the publish.
        models, mirror_note = _annotate_from_mirror(models, author)

        manifest = {
            "version": 1,
            "id": bp_id,
            "name": name,
            "description": description,
            "author": author,
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "base": base,
            "kind": kind,
            "bindings": clean_bindings,
            "params": clean_params,
            "models": models,
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
        # Publishing only puts a blueprint in the shared library. Nothing SELECTS
        # it, so the next render still went through whatever pipeline the atlas
        # already had — reported as "I published my background-removal blueprint
        # and my image came back regenerated", because the untouched default is
        # the built-in SDXL text-to-image path. Done here rather than in the
        # browser because this is the only side that knows the slugged id.
        selected = ""
        if payload.get("use_for_atlas"):
            try:
                self._saveconfig({"pipeline": bp_id})
                selected = (" and selected it as this atlas's pipeline "
                            "(⚙ Settings → Pipeline)")
            except Exception as e:  # noqa: BLE001 — the publish itself succeeded
                selected = (f" — but could not select it as the pipeline ({e}); "
                            "pick it in ⚙ Settings → Pipeline yourself")
        else:
            selected = (" — select it in ⚙ Settings → Pipeline, or it will not "
                        "run (reload to refresh the list)")
        return (f"✓ {verb} blueprint '{bp_id}'{selected}."
                + _models_note(manifest["models"], dropped_models) + mirror_note)

    def _deleteblueprint(self, payload: dict) -> str:
        """Remove a blueprint from the shared library (R2 + staging). Gated on
        `self.can_publish` exactly like upload — deleting a shared blueprint is a
        write to the global library. Never raises; returns a readable string
        (leading '✓' ⇒ the client reloads). A built-in reference id can't be
        deleted (selecting it keeps the built-in Python path anyway)."""
        if not getattr(self, "can_publish", False):
            return ("✖ You're not allowed to delete blueprints. Ask an admin "
                    "for the 'Publish blueprints' permission.")
        bp_id = str(payload.get("id", "")).strip()
        if not bp_id:
            return "✖ No blueprint id given."
        if bp_id in PIPELINE_OPTIONS:
            return (f"✖ '{bp_id}' is a built-in pipeline id, not a deletable "
                    "blueprint.")
        try:
            res = blueprints.delete_blueprint(bp_id)
        except ValueError as e:
            return f"✖ {e}"
        if not res.get("existed"):
            return f"⚠ No blueprint '{res.get('id', bp_id)}' in the library."
        # Re-hydrate so the pipeline picker + manage list drop it immediately.
        try:
            blueprints.hydrate(force=True)
        except Exception:  # noqa: BLE001
            pass
        return (f"✓ Deleted blueprint '{res['id']}' ({res['deleted']} file(s) "
                "removed). Any atlas still set to it will need a different "
                "pipeline.")

    def _rescanblueprintmodels(self, payload: dict) -> str:
        """Re-derive an EXISTING blueprint's `models[]` from its stored graph and
        save the manifest back (staging + R2), the same way an upload does.

        Import-time derivation only helps blueprints imported from now on, and
        every blueprint authored so far declares `models: []` — this is how those
        catch up without re-uploading the graph by hand. Human-added provenance
        on the old entries (`url`/`r2_key`/`sha256`/...) is folded onto the fresh
        derivation; entries the graph no longer references are dropped and named
        in the reply. Gated on `self.can_publish` exactly like upload/delete — it
        writes to the SHARED library. Never raises; returns a readable string
        (leading '✓' ⇒ the client reloads)."""
        if not getattr(self, "can_publish", False):
            return ("✖ You're not allowed to edit blueprints. Ask an admin "
                    "for the 'Publish blueprints' permission.")
        bp_id = str(payload.get("id", "")).strip()
        if not bp_id:
            return "✖ No blueprint id given."
        if bp_id in PIPELINE_OPTIONS:
            return (f"✖ '{bp_id}' is a built-in pipeline id, not an uploaded "
                    "blueprint — its models come from the Settings panel.")
        bp = blueprints.get_blueprint(bp_id)
        if bp is None:
            return (f"⚠ No readable blueprint '{bp_id}' in the library "
                    "(missing, or its manifest doesn't load).")
        bp_id = bp["id"]
        graph = bp["graph"]
        models, dropped = blueprints.merge_model_provenance(
            blueprints.derive_models_from_graph(graph),
            bp["meta"].get("models"))

        # Rewrite the STORED manifest rather than re-serializing the loaded meta,
        # so nothing outside `models` can be reshaped by a rescan.
        dest = blueprints.BLUEPRINTS_STAGING / bp_id
        man_path = dest / "blueprint.json"
        try:
            manifest = json.loads(man_path.read_text(encoding="utf-8"))
            before = man_path.read_bytes()
        except (OSError, ValueError) as e:
            return f"✖ Could not read blueprint '{bp_id}': {e}"
        # Annotated against the STORED author, so a bundled blueprint is skipped
        # here and not written back for the next hydrate to revert.
        models, mirror_note = _annotate_from_mirror(models, manifest.get("author"))
        manifest["models"] = models
        try:
            blueprints.validate_against_graph(bp_id, manifest, graph)
        except ValueError as e:
            return f"✖ {e}"
        man_bytes = json.dumps(manifest, indent=2).encode("utf-8")
        if man_bytes == before:
            return (f"✓ '{bp_id}' is already up to date."
                    + _models_note(manifest["models"], dropped) + mirror_note)
        try:
            dest.mkdir(parents=True, exist_ok=True)
            man_path.write_bytes(man_bytes)
            storage.put(
                f"{blueprints.SHARED_BLUEPRINTS_PREFIX}/{bp_id}/blueprint.json",
                man_bytes)
        except Exception as e:  # noqa: BLE001 — disk/R2 hiccup, not a crash
            return f"✖ Could not save blueprint '{bp_id}': {e}"
        try:
            blueprints.hydrate(force=True)
        except Exception:  # noqa: BLE001 — staging copy already written
            pass
        return (f"✓ Rescanned '{bp_id}'."
                + _models_note(manifest["models"], dropped) + mirror_note)

    def _publish_author(self) -> str:
        """Best-effort username to stamp on an uploaded blueprint. The launcher
        handoff doesn't currently forward an identity, so this is "uploaded"
        unless an env (`IW_USER_NAME`) carries one. Kept as a single seam so a
        future handoff field only changes here."""
        return (os.environ.get("IW_USER_NAME", "").strip() or "uploaded")

    def _blueprintresolved(self, manifest_name: str, region: str = "",
                           blueprint: str = "") -> bytes:
        """Resolve the EXACT API/prompt graph the blueprint pipeline POSTs to
        ComfyUI for a real run of `manifest_name`, plus a baked→injected diff.

        Read-only debugging seam: loads the named manifest from staging (same
        resolver compose/slice use), then calls
        `batch_atlas.resolve_blueprint_workflow` — the single source of truth for
        injection. The (client, project) context is THIS request thread's
        (already set by `_resolve_context`), so the manifest + blueprint library
        resolve under the right prefix, exactly like sibling endpoints.

        Returns JSON {ok, workflow, output_node, seed, changes, regions, notes}.
        Any failure is reported as {ok:false, error:<message>} (never a 500),
        consistent with the other handlers."""
        try:
            sel = Path((manifest_name or "").replace("\\", "/")).name
            if not sel:
                return json.dumps(
                    {"ok": False, "error": "no manifest specified"}).encode()
            mp = batch_atlas.resolve_manifest_arg(sel)
            if not mp.exists():
                # Lazy-pull from R2 by name (manifests hydrate at startup, but a
                # just-created one may only be on R2 in this worker's view).
                # _hydrate_from_r2_by_name writes the pulled blob to its OWN
                # location (refs/atlas/<name>) and returns that path — it does
                # NOT populate the MANIFEST_DIR slot — so read the manifest from
                # the returned path rather than re-checking `mp`.
                pulled = batch_atlas._hydrate_from_r2_by_name(sel)
                if pulled is not None and pulled.exists():
                    mp = pulled
            if not mp.exists() or mp.suffix.lower() == ".atlas":
                return json.dumps({
                    "ok": False,
                    "error": (f"manifest '{sel}' not found, or is a bare .atlas "
                              "with no creative recipe to resolve"),
                }).encode()
            manifest = json.loads(mp.read_text(encoding="utf-8"))

            # Region picker source: every region the manifest carries (atlas-
            # bound manifests merge geometry from their `.atlas`, so reflect that
            # too — the names are what the UI dropdown needs).
            regions = [r.get("name") for r in (manifest.get("regions") or [])
                       if r.get("name")]
            try:
                ap = batch_atlas.atlas_file_path(manifest, mp)
                if ap and ap.exists():
                    merged = batch_atlas.merge_atlas_regions(
                        manifest, atlas_format.parse_atlas(ap))
                    regions = [r["name"] for r in merged if r.get("name")]
            except (OSError, ValueError):
                pass

            wf, out_node, changes = batch_atlas.resolve_blueprint_workflow(
                manifest, region or None, blueprint or None)

            seed = None
            # The concrete seed baked into the resolved wf is the authoritative
            # value — read it back from a 'seed' change entry if present.
            for c in changes:
                if c.get("source") == "seed":
                    seed = c.get("resolved")
                    break

            notes = [
                "The exported JSON is ComfyUI API/prompt format: POST it to "
                "ComfyUI's /prompt and it runs identically to the pipeline. "
                "Loading it onto the canvas needs ComfyUI's API-format loader.",
            ]
            # Warn when the resolved seed is random (unpinned region): a real run
            # would draw a fresh one each time, so this export is one sample.
            pinned = False
            try:
                reg = None
                if region:
                    reg = next((r for r in (manifest.get("regions") or [])
                                if r.get("name") == region), None)
                else:
                    reg = next((r for r in (manifest.get("regions") or [])
                                if not r.get("skip_unless_explicit")), None)
                pinned = bool(reg and reg.get("seed") is not None)
            except Exception:  # noqa: BLE001
                pinned = False
            if not pinned and seed is not None:
                notes.append(
                    f"This region has no pinned seed — the pipeline draws a "
                    f"fresh random seed every run, so seed {seed} is just this "
                    "export's sample. Pin the region's seed (or set it in "
                    "ComfyUI) to reproduce.")

            return json.dumps({
                "ok": True,
                "workflow": wf,
                "output_node": out_node,
                "seed": seed,
                "changes": changes,
                "regions": regions,
                "notes": notes,
            }).encode()
        except ValueError as e:
            return json.dumps({"ok": False, "error": str(e)}).encode()
        except Exception as e:  # noqa: BLE001 — never 500 a debug seam
            return json.dumps(
                {"ok": False,
                 "error": f"{type(e).__name__}: {e}"}).encode()

    def _sliceatlas(self) -> str:
        # No manifest in this project yet → don't hand slice_atlas a fabricated
        # path (the old `symbolsStatic` default 404'd here). Surface an
        # actionable message instead, matching the empty-project banner.
        if not active_manifest_name():
            return _diag("SLICE_FAILED", err=(
                "No atlas manifest selected for this project. Compose an "
                "atlas (Create Atlas) or pick one in the Session bar, then "
                "retry the slice."))
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

    @staticmethod
    def _blueprint_enum_pairs() -> set:
        """Every (class, input) a published blueprint's select settings read their
        list from — `options_from` when the author recorded one, else the node
        the setting drives. Never fails ⟳ over a bad blueprint in the library."""
        import comfy_specs
        out: set = set()
        try:
            for b in blueprints.list_blueprints():
                full = blueprints.get_blueprint(str(b.get("id", "")))
                if not full:
                    continue
                graph = full.get("graph") or {}
                for p in full.get("params") or []:
                    if isinstance(p, dict) and p.get("type") == "select":
                        cls, field = comfy_specs.param_class_field(p, graph)
                        if cls:
                            out.add((cls, field))
        except Exception:  # noqa: BLE001 — the library is a bonus here, not the job
            pass
        return out

    def _refreshmodels(self) -> str:
        """⟳ Refresh model lists: re-probe ComfyUI for its /object_info enums
        and persist them, so the Settings dropdowns keep working while nothing
        is answering (the hosted tool's normal state under
        `COMFY_TRANSPORT=serverless`).

        Busts the time-based ComfyUI caches first — otherwise a pod that came up
        30 seconds ago is still remembered as down and the probe skips it."""
        batch_atlas._bust_comfy_caches()
        # MODEL_FIELDS already covers every enum-backed node — the sampler,
        # scheduler, dtype and IPAdapter weight-type fields are mapped there
        # too, and their ENUM_FIELDS entry is only the offline floor. A published
        # blueprint's select settings are enum-backed the same way, and caching
        # them here is what lets its dropdown show the pod's list while no pod is
        # running (`comfy_specs.specs_for_blueprint`'s middle tier).
        pairs = sorted(set(MODEL_FIELDS.values()) | self._blueprint_enum_pairs())
        target = effective_run_on()
        try:
            res = comfy_catalog.refresh(pairs, target=target)
        except Exception as e:  # noqa: BLE001 — report, never 500 the button
            return f"⟳ Refresh failed ({type(e).__name__}: {e})"
        if not res.get("ok"):
            return f"⚠ {res.get('note') or 'Nothing to refresh.'}"
        who = "RunPod" if target == "pod" else "your ComfyUI"
        return (f"✓ Model lists for {who} refreshed from {res.get('source')} — "
                f"{res.get('fields')} list(s), {res.get('values')} value(s)")

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
        # STICKY PAGE-ONLY — once a deploy resolves to page-only (via any
        # auto-detect trigger above), persist `deploy_page_only` on the manifest
        # so the decision survives. Next deploy hits trigger #1 with no network
        # probe. Net effect: a real spine target auto-detects on the first deploy
        # and stays page-only thereafter. Best-effort; a save failure must never
        # block the deploy.
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
        # WHICH FILE IS THE PAGE — decided by MEASURING it, BEFORE a single byte
        # is uploaded. Deploy globs `<stem>_new.*` on its own (it can run long
        # after the compose that wrote them), so it must make this judgement for
        # itself and not inherit the page pointer's.
        #
        # Preference is still WebP — it is what the game loads. But a candidate
        # whose real pixel size is not the size these rects were packed into is
        # not this atlas's page at all: it is a leftover from an earlier packing
        # or, on the cloud, a copy hydration restored from R2 over the fresh one.
        # Shipping it puts every frame in the wrong place and drops every rect
        # past the shorter page's bottom edge — test6, 2026-09-16: 25 frames
        # packed 1934×1612, a 2047×1173 page deployed, 7 frames gone and the clip
        # playing 18 frames. Size is the test, not mtime: hydration stamps stale
        # bytes with a brand-new mtime, and an mtime cannot see inside a file.
        # With no declared size to check against (nothing packed yet) the fallback
        # is the ordering rule — a `.webp` older than the `.png` beside it is not
        # the page the last compose wrote.
        _decl = m.get("atlas") or {}
        try:
            decl_w, decl_h = int(_decl["width"]), int(_decl["height"])
        except (KeyError, TypeError, ValueError):
            decl_w = decl_h = 0
        cands = [p for suf in (".webp", ".png")
                 for p in sources
                 if p.suffix.lower() == suf and _page_mtime(p) is not None]
        # The ordering rule comes FIRST, because it catches what the size rule
        # cannot: a stale page that happens to be the same size as the fresh one
        # (a re-render of the same layout) would otherwise be preferred on its
        # extension alone and ship the wrong ART. Compose writes the `.png` and
        # then the `.webp`, so a webp older than the png beside it was not
        # written by the same run.
        ordered_out: list[Path] = []
        if len(cands) == 2 and (_page_mtime(cands[0]) or 0) < (
                _page_mtime(cands[1]) or 0) - 1:
            ordered_out, cands = [cands[0]], cands[1:]
        measured: list[tuple[Path, tuple[int, int]]] = []
        for c in cands:
            try:
                with Image.open(c) as _pg:
                    measured.append((c, _pg.size))
            except Exception:  # noqa: BLE001 — unreadable = not a page
                pass
        page_pick: Path | None = None
        wrong_size: list[str] = []   # measured, and not this atlas's page
        if decl_w > 0 and decl_h > 0 and measured:
            for c, size in measured:
                if size == (decl_w, decl_h):
                    page_pick = c
                    break
                wrong_size.append(f"{c.name} ({size[0]}×{size[1]})")
            if page_pick is None:
                return (f"⚠ REFUSED to deploy — this manifest packed its "
                        f"{len(m.get('regions') or [])} region(s) into "
                        f"{decl_w}×{decl_h}, but the composed page is "
                        f"{', '.join(wrong_size)}. The page and the rects come "
                        f"from different runs, so every frame would be cropped "
                        f"out of the wrong canvas and every rect past the page's "
                        f"edge would be dropped. NOTHING was uploaded — what is "
                        f"already deployed still stands. Re-run Create Atlas, "
                        f"then deploy again.")
        elif measured:
            page_pick = measured[0][0]
        # Whatever lost is not uploaded: the loop below must not put a page in
        # the bucket that this pre-pass just rejected. `.atlas` (spine geometry)
        # and any 0-byte file stay in `sources` — the loop reports those itself.
        rejected = ordered_out + [c for c, _ in measured if c is not page_pick]
        sources = [s for s in sources if s not in rejected]
        skipped_stale = [c.name for c in rejected]
        real_w, real_h = next(
            ((w, h) for c, (w, h) in measured if c is page_pick), (0, 0))
        page_ink: bool | None = None  # None = not measured; False = blank page
        # The page's alpha, kept for the per-rect ink test below. Held rather
        # than re-opened: it is one band of an image already read, and the test
        # is a crop per frame.
        page_alpha: Image.Image | None = None
        if page_pick is not None and not page_only:
            try:
                with Image.open(page_pick) as _pg:
                    page_alpha = _pg.convert("RGBA").getchannel("A")
                    page_ink = page_alpha.getbbox() is not None
            except Exception:  # noqa: BLE001
                page_ink = None
                page_alpha = None
        # WEBP-ONLY GAME PAGES: compose writes BOTH `<stem>_new.png` (always) and
        # `<stem>_new.webp` (best-effort). Historically deploy shipped both, so a
        # game ended up with a dead `.png` twin next to the `.webp` it actually
        # loads (e.g. `SD2_Coin.png` beside `SD2_Coin.webp`). When a NON-EMPTY
        # `.webp` page is present we ship WebP-only: skip the `.png` page here and
        # delete any stale `.png` sibling from R2 below. The 0-byte guard still
        # falls back to the PNG page if the WebP is missing/broken (never ship a
        # dead page). `.atlas` (spine geometry) is unaffected and still copied.
        have_webp_page = any(
            s.suffix.lower() == ".webp" and s.read_bytes() for s in sources)
        for src in sources:
            data = src.read_bytes()
            # NEVER deploy a 0-byte page (e.g. a failed WEBP encode): meta.image
            # would point at an empty page → the game can't load the spritesheet
            # → the whole atlas renders as nothing. Skip it; the valid page below
            # (PNG) is used instead.
            if src.suffix.lower() in {".png", ".webp"} and not data:
                skipped_empty.append(src.name)
                continue
            # Skip the PNG page when a valid WebP page exists — WebP-only pages.
            if src.suffix.lower() == ".png" and have_webp_page:
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
        # Remove a stale `.png` page left by a previous (dual-format) deploy so it
        # stops lingering beside the WebP the game now loads. Best-effort:
        # storage.delete already swallows errors.
        if have_webp_page:
            storage.delete(f"{dest_prefix}/{out_base}.png")
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
        # Manifest regions the fallback below REFUSED to describe. Both are
        # reported in the deploy note: a frame the game can't find is loud on
        # its own, but only if the tool says which ones went missing and why.
        no_rect: list[str] = []   # no complete x/y/w/h — not on this page
        off_page: list[str] = []  # a rect that leaves the page — stale geometry
        # Evidence for the "invented canvas" note: how many framed regions
        # carry a real trim record, and how many distinct packed sizes there
        # are. Only the fallback fills these; a bound `.atlas` owns its own.
        trimmed_count = 0
        framed_sizes: set[tuple[int, int]] = set()
        # `real_w/real_h`, `page_alpha` and `page_ink` were measured BEFORE the
        # upload (see the size guard above) — ground truth for both rect guards
        # below, and for the bound-`.atlas` path as much as the fallback.
        blank: list[str] = []     # a rect the page has no ink under
        # DELIBERATELY `pack` alone, not `is_from_scratch`. The two things this
        # flag decides both rest on a property only AUTO-PACKING has: a pack rect
        # is stamped ONLY after measuring non-empty art, so a blank one is
        # definitionally a fault (drop the frame) and same-sized frames with no
        # trim record are definitionally destroyed trim (warn). Neither holds on
        # `grid`: grid_layout never opens an image, so an ungenerated region gets
        # its cell like every other one — a blank cell there is the ordinary
        # "not generated yet" state, and the non-pack branch already says exactly
        # that ("kept, but the game will render them as nothing"). Dropping it
        # instead would turn a visible hole into a missing frame. (The trim
        # warning is moot on a grid anyway: every frame is one cell, so
        # `framed_sizes` can never exceed one.)
        _is_pack = batch_atlas.atlas_layout(m) == "pack"
        atlas_path = batch_atlas.atlas_file_path(m, manifest_path())
        if not page_only and atlas_path is not None and atlas_path.exists():
            # First choice: the bound `.atlas` is the authoritative region map.
            try:
                parsed = atlas_format.parse_atlas(atlas_path)
                # Read BOTH before committing either: assigning `tp_regions`
                # first and then raising on the page header left it set, so the
                # `tp_regions is None` gate below never fired and the promised
                # fall-through to the manifest regions never happened.
                _regions = parsed["regions"]
                _pw, _ph = parsed["page"]["width"], parsed["page"]["height"]
                tp_regions, page_w, page_h = _regions, _pw, _ph
            except Exception as e:  # noqa: BLE001
                json_note = (f"  ⚠ Bound .atlas could not be parsed "
                             f"({type(e).__name__}: {e}); ")
                tp_regions = None
                page_w = page_h = 0
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
                    # A region without a complete rect can't be a frame. On a
                    # `pack` atlas that is the normal "added but not generated
                    # yet" state (auto_pack_layout strips the geometry off
                    # anything it did not place) — but the game will fail to
                    # find the frame, so it is named below rather than dropped
                    # in silence.
                    no_rect.append(str(name))
                    continue
                def _pick(*keys, default=None):
                    for k in keys:
                        if r.get(k) is not None:
                            return r[k]
                    return default
                if _recorded_trim(r) is not None:
                    trimmed_count += 1
                framed_sizes.add((rw, rh))
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
                # Refuse a frame whose rect is not on the page (`_rect_on_page`
                # — the shipped predicate, not a copy). Emitting one produced a
                # well-formed `.json` whose symbol silently showed the wrong
                # picture. Measured against the REAL page only: a stale
                # `atlas.width` must not be allowed to condemn regions that are
                # genuinely on the sheet.
                if real_w > 0 and real_h > 0:
                    keep: list[dict] = []
                    for n in normed:
                        if _rect_on_page(n, real_w, real_h):
                            keep.append(n)
                        else:
                            off_page.append(n["name"])
                    normed = keep
                # A rect the page is blank under is the PARTIAL version of the
                # blank-page case below: the descriptor says a symbol is there
                # and the game resolves it to nothing. Only compose can produce
                # it — its "no generated variant found" skip drops a region that
                # still holds a rect, when the art goes away between auto_pack's
                # measurement and the subprocess. Refused only on a `pack`
                # layout, where a rect is only ever stamped after measuring
                # non-empty art so a blank one is definitionally a fault; a
                # bound `.atlas` is authored elsewhere and may legitimately
                # carry an empty slot, so there it is reported, not dropped.
                if page_alpha is not None and normed:
                    inked, empty = [], []
                    for n in normed:
                        (inked if _rect_has_ink(page_alpha, n) else empty
                         ).append(n)
                    blank = [n["name"] for n in empty]
                    if blank and _is_pack:
                        normed = inked
                if normed:
                    tp_regions = normed
                    # Page size: prefer the manifest's atlas block, else the
                    # actual deployed page image's pixel size.
                    atl = m.get("atlas") or {}
                    try:
                        page_w = int(atl["width"])
                        page_h = int(atl["height"])
                    except (KeyError, TypeError, ValueError):
                        page_w = page_h = 0
                    if page_w <= 0 or page_h <= 0:
                        page_w, page_h = real_w, real_h
        if page_only:
            pass  # page-only: no TexturePacker .json (see spine_note above)
        elif page_ink is False:
            # The page has no ink ANYWHERE, so every frame in the map would
            # address blank pixels. This is what a compose over a staging dir
            # that failed to hydrate leaves behind — and it is exactly the case
            # auto_pack_layout refuses to "repair" by clearing rects, because a
            # network blip must not rewrite the manifest. Refuse the frame map
            # instead: a game with no spritesheet fails at load, loudly and at
            # the right place.
            json_note += ("  ⚠ REFUSED to write the spritesheet .json — the "
                          "composed page is entirely blank, so every frame "
                          "would point at empty pixels. Nothing was generated, "
                          "or the variant pile did not load. The page image was "
                          "deployed; re-run Create Atlas and deploy again.")
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
        elif not tp_regions and (off_page or no_rect or blank):
            # Regions existed — they were all refused. Saying "no regions[]"
            # here would be false, and flatly contradicted by the note the
            # refusal appends below.
            json_note += ("  ⚠ EVERY region was refused, so no TexturePacker "
                          ".json was emitted (see below). Game spritesheet not "
                          "produced; only the page image was deployed.")
        elif not tp_regions:
            json_note += ("  ⚠ No bound .atlas AND no manifest regions[] for this "
                          "manifest → no TexturePacker .json emitted. Game "
                          "spritesheet not produced; only the page image was "
                          "deployed.")
        else:
            json_note += ("  ⚠ Could not determine page image size → "
                          "TexturePacker .json skipped (meta.size would be 0).")
        # Say which regions did NOT make it into the frame map. Only the
        # manifest-regions fallback can produce these; the bound-`.atlas` path
        # leaves both lists empty. A missing frame is a loud failure in the game
        # — name it here so it is loud in the tool that caused it too.
        def _names(v: list[str]) -> str:
            return ", ".join(v[:8]) + (" …" if len(v) > 8 else "")
        if off_page:
            json_note += (f"  ⚠ {len(off_page)} region(s) DROPPED from the "
                          f"spritesheet .json — their rect lies outside the "
                          f"{real_w}×{real_h} page, so it is geometry left over "
                          f"from an earlier packing and the frame would have "
                          f"shown the wrong art. Re-run Create Atlas, then "
                          f"deploy again: {_names(off_page)}")
        if no_rect:
            json_note += (f"  ⚠ {len(no_rect)} region(s) have no placement on "
                          f"this page and got no frame — generate them, then "
                          f"Create Atlas + deploy: {_names(no_rect)}")
        if blank:
            what = ("DROPPED from the spritesheet .json" if _is_pack
                    else "kept, but the game will render them as nothing")
            json_note += (f"  ⚠ {len(blank)} region(s) have a rect the page is "
                          f"BLANK under, so they were {what}. Compose could not "
                          f"find their art (it went away between Create Atlas "
                          f"measuring it and the compose run). Re-generate "
                          f"them, then Create Atlas + deploy: {_names(blank)}")
        # Name the symptom, not just the cause. A dropped frame surfaces in the
        # game as a flipbook playing SHORT or a symbol that renders nothing —
        # `Flipbook.svelte` console.errors the clip id and the frame names when
        # it happens. Saying so here is what lets someone meeting that console
        # line work back to the deploy that caused it. (Deliberately NOT a
        # lookup against the launcher's clip docs: that couples this tool to
        # their format to bridge a gap both ends already report.)
        if blank or off_page:
            json_note += ("  ℹ In the game a dropped frame reads as a flipbook "
                          "playing SHORT, or a symbol rendering nothing — the "
                          "console names the clip and the frames.")
        if (_is_pack and tp_regions and trimmed_count == 0
                and len(framed_sizes) > 1):
            # NOT a guess, and not repairable here: the frames' true canvas is
            # simply not in the data any more. `sourceSize` has to be written,
            # so the fallback fills the gap with each frame's own packed size
            # (`_pick(…, default=rw)`). That is correct for genuinely untrimmed
            # art — which is uniformly sized, because nothing was cut off it —
            # and is the exact signature of DESTROYED trim when the sizes all
            # differ: every frame then declares itself its own tight crop and
            # the game anchors each on a different centre. Say it out loud;
            # silence here is what let a whole animation ship jittering.
            json_note += (
                f"  ⚠ {len(tp_regions)} frame(s) carry NO trim record, yet they "
                f"have {len(framed_sizes)} different sizes — so each one was "
                f"written with sourceSize = its own packed size and the frames "
                f"do NOT share a common centre. For a symbol sheet that is "
                f"fine. For an ANIMATION it is the up/down/left/right jitter. "
                f"Fix it BEFORE the art is cropped: set this atlas's 'Frame "
                f"trim' to keep the whole frame and re-run Create Atlas, while "
                f"each region's committed art still has its margins. Once a "
                f"page of tight crops is all that is left there is nothing to "
                f"restore from — what was cut off is recorded nowhere — and a "
                f"Flipbook sheet has to be re-made by re-running its video "
                f"session.")
        if real_w > 0 and page_w > 0 and (page_w, page_h) != (real_w, real_h):
            # `meta.size` came from the manifest but the page shipped at a
            # different size, so every frame's rect is read against the wrong
            # canvas. Not repaired here (which of the two is right depends on
            # whether compose has run since) — but never left unsaid.
            json_note += (f"  ⚠ meta.size says {page_w}×{page_h} while the "
                          f"deployed page is actually {real_w}×{real_h} — the "
                          f"manifest describes a different page than the one "
                          f"shipped. Re-run Create Atlas, then deploy again.")
        if skipped_stale:
            json_note += (f"  ⚠ Did NOT ship {', '.join(skipped_stale)} — not "
                          f"this atlas's page (a leftover from an earlier "
                          f"packing, or a copy restored from R2 over the fresh "
                          f"one). {page_pick.name if page_pick else 'Nothing'} "
                          f"was deployed instead.")
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

    def _newatlas(self, payload: dict) -> str:
        """Create a brand-new, from-scratch atlas — an empty `pack`-layout
        manifest (no bound `.atlas`) — and make it the active selection. Regions
        are added later (＋ Add region), generated from prompts, and laid out by
        Create Atlas (auto_pack_layout). Never raises — returns a readable note;
        a leading '✓' tells the client to reload."""
        name = str(payload.get("name", "")).strip()
        if not name:
            return "Give the atlas a name."
        slug = project_paths.r2_slug(name)
        if not slug:
            return "✖ Couldn't derive an atlas name from that — use letters/numbers."
        fname = f"atlas_manifest_{slug}.json"
        # Manifests authored elsewhere (the Sheet Maker keeps case) would be a
        # SECOND file next to the lowercase slug on Linux, so an existing name
        # is matched ignoring case and its spelling reused.
        fname = next((m for m in list_manifests() if m.lower() == fname.lower()), fname)
        shown = fname[len("atlas_manifest_"):-len(".json")]
        dest = MANIFEST_DIR / fname
        if dest.exists() and not bool(payload.get("overwrite", False)):
            # Don't clobber an existing atlas — switch to it instead.
            cfg = load_config()
            cfg["manifest_path"] = fname
            save_config(cfg)
            return (f"⚠ An atlas '{shown}' already exists — switched to it rather "
                    f"than overwriting. ✓ reload.")
        manifest = {
            "atlas": {"layout": "pack"},
            "style": {"positive_prefix": "", "positive_suffix": "", "negative": ""},
            "regions": [],
        }
        try:
            MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
            dest.write_text(json.dumps(manifest, indent=2, ensure_ascii=False),
                            encoding="utf-8")
            _mirror(dest)
        except OSError as e:
            return f"✖ Couldn't create the atlas: {e}"
        cfg = load_config()
        cfg["manifest_path"] = fname
        save_config(cfg)
        return f"✓ Created atlas '{shown}' — add regions, generate, then Create Atlas."

    def _addregion(self, payload: dict) -> str:
        """Append a named region to the active manifest (from-scratch flow). The
        region starts name-only; its prompt/seed/refs are edited on the card and
        it's generated + auto-packed like any other. '✓' ⇒ client reloads."""
        name = _sanitize_region_name(payload.get("name", ""))
        if not name:
            return "Give the region a name (letters, numbers, _ or -)."
        m = load_manifest()
        existing = {r.get("name") for bucket in ("regions", "rotated_regions")
                    for r in (m.get(bucket) or []) if isinstance(r, dict)}
        if name in existing:
            return f"⚠ A region '{name}' already exists."
        m.setdefault("regions", []).append({"name": name})
        save_manifest(m)
        return f"✓ Added region '{name}'."

    def _delregion(self, payload: dict) -> str:
        """Remove a region (both buckets) from the active manifest. '✓' ⇒
        client reloads. Does NOT delete generated variants — re-adding the same
        name picks them back up."""
        name = str(payload.get("name", "")).strip()
        if not name:
            return "No region specified."
        m = load_manifest()
        removed = False
        for bucket in ("regions", "rotated_regions"):
            lst = m.get(bucket)
            if not isinstance(lst, list):
                continue
            kept = [r for r in lst
                    if not (isinstance(r, dict) and r.get("name") == name)]
            if len(kept) != len(lst):
                m[bucket] = kept
                removed = True
        if not removed:
            return f"⚠ No region '{name}' to remove."
        save_manifest(m)
        return f"✓ Removed region '{name}'."

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
        # Drop a pick whose file just went. Variant ids are a counter, not a
        # uuid — the serverless transport hands out "highest existing + 1" and
        # the http one keeps whatever ComfyUI named the file — so a deleted id
        # can come back around, and a dangling pin would silently snap onto
        # that unrelated art. Falls back to the newest, like a region never
        # picked.
        if deleted and _drop_dangling_pick(name):
            return f"Deleted {deleted} variant(s) — {name} is back to its latest"
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
        """What each card's output figure should show RIGHT NOW.

        Carries the pick (and the image built from it), not just a seed: a
        render supersedes an unlocked pick server-side, so the card has to be
        told which file it is on now instead of keeping its stale `?id=`."""
        out = []
        for r in all_regions(load_manifest()):
            name = r["name"]
            thumb, full, cap, us, picked = output_view(name, r)
            out.append({"name": name, "seed_used": us, "variant": picked,
                        "thumb": thumb, "full": full, "cap": cap})
        return json.dumps(out).encode()

    def _index(self) -> str:
        m = load_manifest()
        _style = m.get("style", {})
        cfg = load_config()
        cards = []
        g_pipe = str(cfg.get("pipeline", "sdxl")).lower() or "sdxl"
        # A from-scratch atlas (`pack` or `grid`) owns its regions in the
        # manifest, so each card gets a delete affordance. An `.atlas`-bound
        # atlas takes its regions from the geometry file — deleting one here is
        # meaningless. Grid belongs on this side for the same reason pack does:
        # its regions ARE the manifest's list, and on the next Create Atlas the
        # grid simply re-flows around the gap.
        is_pack = batch_atlas.is_from_scratch(m)
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
            # The lock is the region's own flag — NOT "a variant was picked".
            # Picking which generated file to compose and refusing to re-render
            # the slot are separate choices; conflating them meant a pick could
            # only be saved by also locking, so an unlocked pick was dropped.
            committed_lock = batch_atlas.region_locked(r)
            # If a specific variant was picked, show THAT file (its embedded
            # seed may be shared with other variants, so the file id — not the
            # seed — is the source of truth for the pick). output_view owns
            # that decision and hands back the pick it resolved, so the card's
            # image and its data-variant can never disagree.
            bigthumb, biglink, out_cap, us, picked = output_view(name, r)
            ref_token = imgcache.thumb_token(self._refpath(f"/ref/{name}"))
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
                cb=ref_token,
                del_btn=(
                    '<button class="cpbtn" title="Remove this region from the '
                    f'atlas" onclick="delRegion(\'{html.escape(name)}\')">🗑'
                    '</button>' if is_pack else ""),
            ))
        msettings = m.get("settings") or {}
        global_fields = []   # atlas_config.json shared defaults
        atlas_fields = []    # per-atlas overrides + this atlas's geometry
        model_cache: dict = {}  # (node,field) -> list, fetched once per page
        # The machine the render will run on — its files are the only lists
        # worth showing, so every dropdown and the status strip follow it.
        target = effective_run_on(cfg)
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
                gv = effective_global(cfg, key)
                itip = html.escape(
                    (tip + "  ·  " if tip else "")
                    + f"Blank = inherit global ({gv})", quote=True)
                ctrl = _control_html(
                    key, typ, ov, model_cache, allow_blank=True,
                    blank_label=f"(inherit global: {gv})",
                    placeholder=f"global: {gv}", title=itip, step=step,
                    target=target)
                atlas_fields.append(
                    f'<label data-pipe="{pipe}"><span class="lblrow">'
                    f'{html.escape(label)} '
                    f'<span style="color:#888;font-size:10px">· per-atlas</span>'
                    f'{qm}</span>{ctrl}</label>'
                )
            else:
                ctrl = _control_html(
                    key, typ, cfg.get(key, ""), model_cache, title=tip_esc,
                    step=step, target=target,
                    placeholder=default_placeholder(key, typ, cfg.get(key, "")))
                global_fields.append(
                    f'<label data-pipe="{pipe}"><span class="lblrow">'
                    f'{html.escape(label)}{qm}</span>{ctrl}</label>'
                )
        # NOT ATLAS_GEOM_FIELDS directly: `atlas_layout` is withheld from a
        # `.atlas`-bound atlas, which can therefore never be handed to the
        # packer. See `atlas_geom_fields_for`, and `atlas_geom_rows_html` for
        # the layout-awareness of the rows.
        atlas_fields.extend(atlas_geom_rows_html(m, cfg, model_cache))
        # Both field loops are done, so model_cache now holds every list this
        # render read. Persist them only if a LIVE probe found something the
        # stored catalog doesn't already have — commit_live is content-gated and
        # rate-limited precisely so a page reload is never an R2 PUT.
        try:
            comfy_catalog.commit_live()
        except Exception:  # noqa: BLE001 — caching is never worth a 500
            pass
        model_status = _model_status_html(target)
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
        # Select the RESOLVED active manifest (same resolution the panel header
        # + slice use) so the dropdown can never disagree with them when the
        # config value is blank/stale — the desync that surfaced a fabricated
        # default in the header while the dropdown showed the real first sheet.
        active = active_manifest_name()
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
        # Toolbar "Upload blueprint" group — only for users who may publish to
        # the shared library (server-side `_uploadblueprint` enforces the same).
        blueprint_grp = (
            '<div class="bargrp" title="Publish or remove shared ComfyUI '
            'blueprints"><span class="glbl">Blueprint</span>'
            '<button onclick="openNewBlueprint()" class="alt" title="Upload a '
            'ComfyUI API-format workflow and bind its roles as a new shared '
            'blueprint">⬆ Upload blueprint</button>'
            '<button onclick="openManageBlueprints()" class="alt" title="View '
            'and delete shared blueprints">🗑 Manage blueprints</button>'
            '<button onclick="openTaxonomy()" class="alt" title="Edit the shared '
            'semantic taxonomy every render injects — the vocabulary the layer '
            'analyzer scores against">🏷 Taxonomy</button></div>'
            if getattr(self, "can_publish", False) else "")
        # role-binding map for every non-built-in blueprint, for the client's
        # ref-field show/hide logic (a blueprint hides a ref field it doesn't
        # bind). Best-effort — empty map on any R2 trouble.
        bp_bound: dict[str, list[str]] = {}
        # Exposed-param defs per blueprint id (for the client to render editable
        # controls when that blueprint is the active pipeline) + THIS manifest's
        # saved overrides (namespaced by blueprint id). Best-effort — empty on
        # any R2 trouble so the page still renders.
        bp_params: dict[str, list] = {}
        # id + display name for every shared blueprint — drives the "manage /
        # delete" list in the New-blueprint modal.
        bp_list: list[dict] = []
        try:
            for _b in blueprints.list_blueprints():
                _bid = str(_b.get("id", ""))
                if _bid in PIPELINE_OPTIONS:
                    continue
                # `nmodels` = how many model files this blueprint declares, so
                # the manage list can show "no models declared" — the state every
                # blueprint authored before import-time derivation is in.
                bp_list.append({"id": _bid,
                                "name": str(_b.get("name", "") or _bid),
                                "nmodels": len(_b.get("models") or []),
                                "sha": str(_b.get("graph_sha", ""))})
                _full = blueprints.get_blueprint(_bid)
                if _full:
                    bp_bound[_bid] = list((_full.get("bindings") or {}).keys())
                    _ps = _full.get("params") or []
                    if _ps:
                        bp_params[_bid] = _ps
        except Exception:  # noqa: BLE001 — never break the page render
            bp_bound = {}
            bp_params = {}
            bp_list = []
        bp_param_values = (
            (load_manifest().get("settings") or {}).get("bpParams") or {})
        if not isinstance(bp_param_values, dict):
            bp_param_values = {}
        return PAGE.format(
            color_field_js=COLOR_FIELD_JS,
            iw_toolbar=IW_TOOLBAR,
            iw_toolbar_css=IW_TOOLBAR_CSS,
            cards="".join(cards),
            blueprint_grp=blueprint_grp,
            bp_params_panel=_BP_PARAMS_PANEL_HTML,
            bp_bound_roles_js=json.dumps(bp_bound),
            bp_params_js=json.dumps(bp_params),
            bp_param_values_js=json.dumps(bp_param_values),
            bp_list_js=json.dumps(bp_list),
            bp_can_publish_js=json.dumps(bool(getattr(self, "can_publish", False))),
            global_fields="".join(global_fields),
            model_status=model_status,
            atlas_fields="".join(atlas_fields),
            spine_link=spine_link,
            manifest_select=manifest_select,
            project_select=project_select,
            proj_qm=f'<span class="qm" title="{html.escape(help_for("project", cfg), quote=True)}">&#9432;</span>',
            manifest_qm=f'<span class="qm" title="{html.escape(help_for("manifest_path", cfg), quote=True)}">&#9432;</span>',
            manifest_name=html.escape(
                active_manifest_name() or "(no manifest — compose or pick one)"),
            global_neg=html.escape(_style.get("negative", "")),
            global_pre=html.escape(_style.get("positive_prefix", "")),
            global_suf=html.escape(_style.get("positive_suffix", "")),
            flash_region=json.dumps(dl_region),
            notice="".join(notices),
        )

    def _taxonomy_get(self) -> dict:
        """Read the shared taxonomy for the editor. Returns its text plus the ETag the
        save must send back, so a concurrent edit is refused rather than silently lost.

        Never raises: the modal shows `error` and the artist can still retry."""
        try:
            text, etag = shared_taxonomy.load()
        except Exception as exc:  # noqa: BLE001 — R2 hiccup is a message, not a 500
            return {"error": f"could not read the taxonomy: {exc}"}
        rep = shared_taxonomy.validate(text) if text else None
        return {
            "text": text or "",
            "etag": etag or "",
            # Summarise what is STORED, which may already be invalid if it was written
            # by something other than this editor.
            "summary": (rep.summary() if rep else ""),
            "ok": bool(rep.ok) if rep else True,
        }

    def _taxonomy_save(self, payload: dict) -> dict:
        """Validate and store the shared taxonomy.

        Gated on `can_publish` like blueprint upload — this one file changes what EVERY
        render classifies against, so it is at least as consequential as publishing one
        blueprint. Refuses a taxonomy that would not load: the node's own behaviour is to
        fall back to a much smaller vocabulary and carry on, so this is the last point at
        which a typo is visible to the person who made it."""
        if not getattr(self, "can_publish", False):
            return {"ok": False, "error": "You're not allowed to edit the shared "
                                          "taxonomy. Ask an admin for the 'Publish "
                                          "blueprints' permission."}
        text = str(payload.get("text", ""))
        etag = str(payload.get("etag", "") or "") or None
        rep = shared_taxonomy.validate(text)
        if not rep.ok:
            return {"ok": False, "error": "; ".join(rep.errors), "errors": rep.errors}
        try:
            new_etag = shared_taxonomy.save(text, if_match=etag)
        except storage.Conflict:
            return {"ok": False, "conflict": True}
        except ValueError as exc:  # validate() disagreed inside save() — belt and braces
            return {"ok": False, "error": str(exc)}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"could not save: {exc}"}
        return {"ok": True, "etag": new_etag, "summary": rep.summary(),
                "warnings": rep.warnings}

    def _save(self, edits: list[dict]) -> str:
        # Serialised: two tabs saving at once would each read the manifest,
        # mutate their own copy and write it back — the second silently erasing
        # the first. Now that a variant pick commits the moment it is clicked,
        # this path is hot enough for that to be a real collision.
        with _manifest_lock:
            return apply_region_edits(edits)

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
        regions = all_regions(m)
        present = {r.get("name") for r in regions}
        seeded: list[str] = []
        skipped_existing = 0
        noref = 0  # region genuinely has no reference image
        bad = 0    # ref present but unopenable (decode/format failure)
        for region in regions:
            nm = region.get("name", "")
            if want is not None and nm not in want:
                continue
            # Never bind an FX layer's raw ref verbatim: a `<base>_<mode>` cell
            # (mode a known preset, base present) is DERIVED from its base by
            # rebuild_fx_layers — seeding its own copy would ship the un-FX'd
            # base pixels in the FX slot. The caller rebuilds these instead.
            fx = shine.fx_layer_info(nm)
            if (fx is not None and fx["base"] in present
                    and str(region.get("mode") or "").strip().lower()
                    in shine.FX_PRESETS):
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
                   "rotate", "output_override", "variant", "variant_at",
                   "fruit", "role", "style_ref", "seed", "lock"}

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
        # Same discipline as the automated rebuild: the build is PIL work plus
        # an R2 upload, so it runs on a detached copy and only the FX fields are
        # re-applied onto the manifest as it stands afterwards. Writing the
        # whole copy back used to undo whatever else was saved meanwhile.
        mp = manifest_path()
        m = _read_manifest_at(mp)
        if m is None:
            return _diag("FX_BUILD_FAILED", mode=mode,
                         err="the manifest could not be read")
        before = _fingerprints(m, _FX_RESULT_KEYS)
        ok, msg = build_fx_region(m, name, mode, payload)
        if ok:
            _, skipped = persist_region_fields(
                mp, _lift_region_fields(m, [name], _FX_RESULT_KEYS),
                before, _FX_RESULT_KEYS)
            if skipped:
                # Lead with the glyph: flashDiag only promotes a message whose
                # FIRST character is a severity marker, and fxBuild reloads the
                # page 800ms later when it isn't — which would wipe this exact
                # warning and leave the card showing the build as applied.
                return (f"⚠ {name} was re-tuned from another tab while this "
                        "build ran, so the newer settings were kept and THIS "
                        "build was not saved. Re-apply yours if you still "
                        f"want it.\n{msg}")
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
        numeric = NUMERIC_CONFIG_KEYS
        # Only persist the (still-active = PREVIOUS) manifest when this request
        # actually wrote a manifest-backed field. A pure Session-dropdown switch
        # POSTs only {manifest_path} (a config field) — unconditionally saving
        # here pushed a possibly-stale previous manifest back to R2 on every
        # switch. Settings-panel saves (which post the manifest-bound fields)
        # still persist as before.
        manifest_dirty = False
        # The layout this save MOVED the atlas to (blank = no move), and how
        # many regions actually lost a rect to it. Said out loud in the reply:
        # the switch clears every rect, so the page reloads with the region
        # cards unplaced, and the author must be told that is the switch doing
        # its job rather than the atlas breaking.
        _layout_switch = ""
        _layout_lost = 0
        _layout_was_authored = False
        _num = cfg_num

        for k, v in edits.items():
            if k == "bpParams":
                # Blueprint exposed-param overrides (B43 Phase 8). Namespaced by
                # blueprint id under settings["bpParams"][<bpId>] so switching
                # blueprints never cross-contaminates. The client posts only the
                # ACTIVE blueprint's submap; we MERGE per-blueprint (other ids'
                # saved values are preserved). A blank value drops that key
                # (falls back to the param's baked default at generate time).
                if not isinstance(v, dict):
                    continue
                bp_all = settings.get("bpParams")
                if not isinstance(bp_all, dict):
                    bp_all = {}
                for bp_id, vals in v.items():
                    if not isinstance(vals, dict):
                        continue
                    cur = bp_all.get(str(bp_id))
                    if not isinstance(cur, dict):
                        cur = {}
                    for pk, pv in vals.items():
                        if str(pv).strip() == "":
                            cur.pop(pk, None)
                        else:
                            cur[pk] = pv
                    if cur:
                        bp_all[str(bp_id)] = cur
                    else:
                        bp_all.pop(str(bp_id), None)
                if bp_all:
                    settings["bpParams"] = bp_all
                else:
                    settings.pop("bpParams", None)
                manifest_dirty = True
            elif k in ("deploy_path", "deploy_basename"):
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
                    # Never wipe required atlas geometry. This is also what
                    # makes ATLAS_LAYOUT_AUTHORED a genuine no-op: that choice
                    # posts a blank and is dropped here, before the switch below
                    # is even reached, so "leave the authored geometry alone"
                    # writes nothing and clears nothing.
                    continue
                if k == "atlas_layout":
                    # Not a plain field write: changing the layout also clears
                    # the rects the state being left owned, and the helper
                    # decides whether this even IS a change (the panel posts
                    # every field on every save). It refuses a `.atlas`-BOUND
                    # manifest, so a stale tab or a hand-made POST cannot hand
                    # one to the packer either.
                    _was_authored = not batch_atlas.is_from_scratch(m)
                    switched, lost = switch_atlas_layout(m, sv)
                    if switched:
                        _layout_switch = batch_atlas.atlas_layout(m)
                        _layout_lost = len(lost)
                        # Read BEFORE the switch: afterwards the manifest is
                        # from-scratch either way, and the reply has to say
                        # which kind of geometry was just given up.
                        _layout_was_authored = _was_authored
                        manifest_dirty = True
                    # ALWAYS, switched or not: an unrecognised value must not
                    # fall through to the generic `atlas[mk] = sv` below and
                    # write itself into `atlas.layout`, where anything outside
                    # FROM_SCRATCH_LAYOUTS reads as ".atlas-bound" and silently
                    # turns off every from-scratch gate in the tool.
                    continue
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
                apply_global_edit(cfg, k, v)

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
                # Same read-modify-write discipline as run_compose: pin the
                # manifest by path (another tab can switch the active one while
                # this seeds, and save_manifest would then write THIS content to
                # THAT atlas), and never write back a whole snapshot taken
                # before slow work — the seed decodes and mirrors an image per
                # region, the FX rebuild another.
                with pinned_manifest(manifest_path()) as mp:
                    with _manifest_lock:
                        nm = _read_manifest_at(mp) or {}
                        # Same repair as the deep-link path — the Session
                        # dropdown is the other way a damaged manifest becomes
                        # active.
                        if repair_sheet_fit_mode(nm):
                            _write_manifest_at(mp, nm)
                    if bool(nm.get("export_prefix")):
                        before = _fingerprints(nm, _SEED_RESULT_KEYS)
                        res = self._seed_refs_into_outputs(nm, only_empty=True)
                        if res["names"]:
                            persist_region_fields(
                                mp, _lift_region_fields(nm, res["names"],
                                                        _SEED_RESULT_KEYS),
                                before, _SEED_RESULT_KEYS)
                        # Derive any FX layers (`<base>_<mode>` cells) from
                        # their now-seeded bases so a sheet-derived manifest
                        # arrives with its FX tiles already built — the user's
                        # "load and it picks up the FX" expectation. The seed
                        # above deliberately leaves FX cells un-bound; the
                        # rebuild fills them here.
                        rebuild_fx_layers_at(mp, base_names=None)
            except Exception:  # noqa: BLE001 — a seed hiccup must not 500 a save
                pass
        if _layout_switch:
            # What was given up, and it is not the same thing on both routes.
            # pack <-> grid drops derived output the next Create Atlas re-stamps;
            # leaving AUTHORED geometry drops rects (and their trim) that an
            # exporter or a person made and that nothing here can rebuild. Say
            # which, in the reply — the only channel there is, and the reason the
            # 5s status hold exists.
            if _layout_was_authored:
                cost = (("This atlas's geometry was authored outside this tool, "
                         "and that is what you just gave up: %d region(s) lost "
                         "the rect and trim they were authored with, and "
                         "nothing here can put those back — the next Create "
                         "Atlas lays every region out from scratch."
                         % _layout_lost) if _layout_lost else
                        "Its geometry was authored outside this tool, but no "
                        "region actually had a rect, so nothing was given up.")
            else:
                cost = (("%d region(s) lost the rect the previous layout gave "
                         "them." % _layout_lost) if _layout_lost else
                        "No region had a rect from the previous layout.")
            return ("Settings saved — layout is now '%s'. %s%s Press "
                    "🧩 Create Atlas to lay the regions out again."
                    % (_layout_switch, cost,
                       " Set Default cell width/height first."
                       if _layout_switch == "grid" else ""))
        return "Settings saved (per-atlas overrides + globals)"


class _Server(ThreadingHTTPServer):
    # A page with N regions asks for ~2N images in one burst. The stdlib
    # backlog of 5 lets the OS refuse everything past the fifth pending
    # connection, and a refused connection is exactly the broken tile the user
    # sees for art that is really there. Queue the burst instead of dropping it.
    request_queue_size = 128


def main():
    from iw_banner import print_banner
    print_banner("Atlas Maker", BUILD,
                 footer=f"http://{HOST}:{PORT}   ·   Ctrl+C to stop")
    # RunPod on-demand: auto-stop the pod after idle (no-op unless configured).
    runpod_control.start_idle_watchdog(
        is_rendering=lambda: bool(_render_state.get("running")))
    # Every push to main redeploys this service, so a container swap routinely
    # lands in the middle of a video session. Collect whatever the last container
    # was rendering NOW rather than waiting for someone to open the page: RunPod
    # keeps a finished job about half an hour, and after that a paid render is only
    # recoverable by hand. In a thread because it sweeps the bucket, and the server
    # has to answer while it does.
    threading.Thread(target=video_runner.boot_recovery, daemon=True,
                     name="video-resume").start()
    _Server((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
