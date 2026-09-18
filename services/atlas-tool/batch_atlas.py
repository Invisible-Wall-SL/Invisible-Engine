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
import base64
import io
import json
import os
import random
import re
import sys
import threading
import time
import uuid
import difflib
import urllib.parse
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from PIL import Image

SELF = Path(__file__).resolve().parent
# Make the sibling modules (cloud_paths, …) importable early — load_config()
# below resolves the staging config through cloud_paths, BEFORE the main import
# block at the bottom of the header runs.
sys.path.insert(0, str(SELF))
# The UI writes atlas_config.json into the R2-backed STAGING dir for the active
# (client, project) — NOT next to this script. The generation subprocess gets
# that context via IW_CLIENT_NAME/IW_PROJECT_NAME (set by ui_server), so it can
# resolve the same file; reading SELF/atlas_config.json (which the cloud image
# doesn't even ship) silently fell back to _DEFAULTS, so every GLOBAL-only
# setting — the pipeline selector above all — was stuck on its default ("sdxl"),
# which is why a selected blueprint never ran. `CONFIG_PATH` stays as the
# script-dir fallback for the original local tool / a bare dev run.
CONFIG_PATH = SELF / "atlas_config.json"


def _config_paths() -> list[Path]:
    """Where to look for atlas_config.json, in priority order: the active
    (client, project) STAGING copy the UI writes, then the script-dir fallback."""
    paths: list[Path] = []
    try:
        import cloud_paths as _cp  # sibling; SELF is on sys.path above
        staging = _cp.resolve().get("staging_root")
        if staging:
            paths.append(Path(staging) / "atlas_config.json")
    except Exception:  # noqa: BLE001 — staging unresolvable (bare/offline run)
        pass
    paths.append(CONFIG_PATH)
    return paths

_DEFAULTS = {
    # CLI argparse fallback only — the cloud UI ALWAYS passes --manifest with
    # the resolved active-manifest path, so this never fires there. Blank (not
    # a fabricated sample name) so a bare run on a fresh project fails clearly
    # instead of 404ing on an `atlas_manifest_symbolsStatic.json` it doesn't own.
    "manifest_path": "",
    "mockup_image": "",
    "checkpoint": "juggernautXL_ragnarokBy.safetensors",
    "lora": "gameIconInstitute3d_v10.safetensors",
    "lora_strength": 0.85,
    "controlnet": "controlnet-union-sdxl-1.0-promax.safetensors",
    "rmbg_model": "RMBG-2.0",
    # Whether to run the RMBG background cutout after VAE decode. ON (default)
    # = transparent-background game icons/symbols. Turn OFF for full-bleed
    # images that should keep their background (e.g. a game BACKGROUND scene),
    # so the saved PNG is the opaque render straight from the VAE.
    "rembg": True,
    "ipadapter_weight": 0.35,
    "ipadapter_weight_type": "style transfer",
    "controlnet_strength": 0.7,
    "controlnet_end_percent": 0.85,
    "ksampler_steps": 35,
    "ksampler_cfg": 8.5,
    # Inner-fit transparent margin around each element INSIDE its own packed
    # slot (distinct from the Sheet Maker's inter-region gutter). 0 = the art
    # fills its slot edge-to-edge; opt-in per atlas via manifest settings.
    # Never silently inset the art — a 0.12 default once shrank full-bleed
    # backgrounds to ~80% (with fit_mode=fill: border = P/(1+2P) ≈ 9.7%).
    "padding_pct": 0.0,
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
    # The shipped ComfyUI first-party node is "OpenAIGPTImage1" → model
    # "gpt-image-1" (the only value its 'model' widget accepts today). The
    # gpt-image-1.5 / gpt-image-2 strings + the Custom/2K/4K size path below
    # are kept for forward-compat but are OPT-IN: with an unreleased model the
    # node rejects the /prompt (HTTP 400), so the default must be the real one.
    "gpt_image_model": "gpt-image-1",     # gpt-image-1 (real) | gpt-image-1.5/2 (future)
    # "match_ref" (default) = pick the closest REAL preset to the original
    # reference's aspect ratio so GPT returns roughly the right shape:
    # 1024x1024 (square) | 1536x1024 (landscape) | 1024x1536 (portrait).
    # Or set a fixed preset verbatim: 1024x1024 | 1024x1536 | 1536x1024 | auto.
    # (gpt-image-2 ONLY, if/when it ships, also accepts a Custom size at the
    # exact ref aspect + 2K/4K presets — used automatically when that model is
    # selected.) fit_to_region still does the final exact-slot resize, so this
    # only controls the SHAPE GPT generates in.
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


# Model/enum settings that are REQUIRED wherever they appear in a graph, so a
# blank is never a valid choice for them — only a value ComfyUI will reject
# with `value_not_in_list`.
#
# The distinction that matters: an OPTIONAL model is expressed by leaving the
# NODE OUT (see build_workflow_flux — `if FLUX_CHECKPOINT: … else: …`, and the
# optional LoRA / ControlNet / Redux blocks), never by passing "" to a node
# that runs. So blank stays meaningful for `flux_checkpoint`, `flux_lora`,
# `lora`, `flux_controlnet`, `controlnet`, `flux_redux_style_model` and
# `mockup_image` — clearing those genuinely disables that step — while a blank
# in the set below can only ever produce:
#
#   /prompt rejected (400): vae_name: '' not in ['ae.safetensors', …]
#
# after a queued job and a cold start have already been paid for.
REQUIRED_MODEL_KEYS = {
    "checkpoint", "rmbg_model",
    "flux_unet", "flux_clip_t5", "flux_clip_l", "flux_vae",
    "flux_weight_dtype", "flux_sampler", "flux_scheduler", "flux_clip_vision",
    "ipadapter_weight_type",
}


def blank_shadows_default(key: str, value) -> bool:
    """True when a saved BLANK would shadow a default that must not be blank —
    a NUMERIC one, or a REQUIRED_MODEL_KEYS one.

    The Settings panel posts every field it renders, blanks included, and a
    blank global value used to be stored verbatim. `ui_server.load_config`
    reads atlas_config.json RAW — it does NOT merge these defaults — so any key
    a config predates rendered as an empty box, and one Save then wrote
    `"flux_guidance": ""`. That "" overrode the 3.5 here and killed every FLUX
    render at `float('')`:

        ValueError: could not convert string to float: ''

    A number has no meaningful blank, so an empty value means "unset" and the
    default stands — which also heals a config already poisoned that way, with
    no migration.

    The same is true of a REQUIRED model name, which the first fix wrongly left
    out: `"flux_vae": ""` survived, reached the graph, and came back from the
    GPU as `vae_name: '' not in [...]` — a paid job to learn that a required
    field was empty. OPTIONAL model keys stay blank-able, because clearing them
    really does disable a step (see REQUIRED_MODEL_KEYS for the distinction)."""
    default = _DEFAULTS.get(key)
    if str(value).strip() != "":
        return False
    if key in REQUIRED_MODEL_KEYS:
        return str(default or "").strip() != ""
    return (isinstance(default, (int, float))
            and not isinstance(default, bool))


def load_config() -> dict:
    cfg = dict(_DEFAULTS)
    for path in _config_paths():
        try:
            if path.exists():
                user = json.loads(path.read_text(encoding="utf-8"))
                cfg.update({k: v for k, v in user.items()
                            if not k.startswith("_")
                            and not blank_shadows_default(k, v)})
                return cfg
        except (json.JSONDecodeError, OSError):
            continue
    return cfg


CFG = load_config()

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cloud_paths as project_paths  # noqa: E402
import atlas_format  # noqa: E402
import storage  # noqa: E402
import shine  # noqa: E402
import blueprints  # noqa: E402
import blueprint_models  # noqa: E402
import comfy_specs  # noqa: E402
import shared_taxonomy  # noqa: E402
import model_mirror  # noqa: E402
from iw_common.diagnostics import diag, emit  # noqa: E402
from diag_catalog import CATALOG  # noqa: E402

# Context handoff:
#   - As a SUBPROCESS (generation), ui_server passes the active (client,
#     project) via IW_CLIENT_NAME + IW_PROJECT_NAME, so this process has a
#     single, correct env context.
#   - When IMPORTED BY ui_server, helper functions here (atlas_file_path,
#     normalize_shape_ref, source_image_candidates, resolve_manifest_arg, …)
#     run on a REQUEST THREAD whose (client, project) is thread-local. So the
#     per-(client, project) path globals below must resolve LIVE per access,
#     never freeze the import-time env-default context — otherwise a non-default
#     project's refs/manifests would resolve into the env-default staging tree
#     (cross-tenant corruption). They are bound to tiny proxies that re-resolve
#     project_paths.resolve() on every use; existing `INPUT_DIR / x`,
#     `BATCH_DIR.mkdir()`, f"{COMFY_PREFIX_BASE}/…" usage is unchanged.


class _PathProxy:
    """A Path that always reflects the calling thread's resolved context.

    `_key` indexes project_paths.resolve(). Delegates every attribute/operator
    to a freshly-resolved Path, so all pathlib usage works unchanged and is
    request-local under ui_server's ThreadingHTTPServer."""

    __slots__ = ("_key",)

    def __init__(self, key: str):
        self._key = key

    def _live(self) -> Path:
        return Path(project_paths.resolve()[self._key])

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
    for OUTPUT_PREFIX / COMFY_PREFIX_BASE)."""

    __slots__ = ("_key",)

    def __init__(self, key: str):
        self._key = key

    def _live(self) -> str:
        return str(project_paths.resolve().get(self._key) or "")

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


# ComfyUI endpoint + headers come from env (COMFY_URL / CF Access), identical
# for every project, so a one-time snapshot is fine and not a race surface.
_PP = project_paths.resolve()
COMFY_HOST = _PP["comfy_host"]
# Cloud: full tunnel base URL (https) + Cloudflare Access headers + non-blocked
# User-Agent. comfy_post/get/view all target COMFY_BASE with CF_HEADERS.
COMFY_BASE = (_PP.get("comfy_url") or f"http://{COMFY_HOST}").rstrip("/")
CF_HEADERS = dict(_PP.get("cf_headers") or {})

# Which ComfyUI transport run_region uses. Unset / "http" (DEFAULT) = talk to a
# live ComfyUI at COMFY_BASE (/upload/image, /prompt, /history, /view). Env
# "serverless" = submit the generation as a RunPod Serverless job instead
# (POST /run + poll /status, base64 refs + base64 result). Read from env so a
# single Railway var flips the backend without touching per-project config.
COMFY_TRANSPORT = (os.environ.get("COMFY_TRANSPORT") or "http").strip().lower() or "http"

# Per-(client, project) — MUST be live (thread-local) for the imported-by-UI
# path; in the subprocess they resolve the single env context, unchanged.
BATCH_DIR = _PathProxy("batch_dir")
ATLAS_DIR = _PathProxy("atlas_dir")
INPUT_DIR = _PathProxy("input_dir")
# The (client, project)-rooted staging dir itself (parent of input/batch/atlas).
# Sheet-Maker artifacts mirror into `sheets/` and `sheet_src/` SIBLINGS of
# input/, so resolving them needs the staging root, not INPUT_DIR.
STAGING_ROOT = _PathProxy("staging_root")
# Where manifests (and `.atlas` files picked into the tool) live in the
# R2-backed staging mirror — NOT the script dir. A bare `--manifest` name must
# resolve here, else compose/slice hit /app/<name> and FileNotFoundError.
MANIFEST_DIR = _PathProxy("manifest_dir")
OUTPUT_PREFIX = _StrProxy("output_prefix")
# ComfyUI's output root is the SHARED workspace, so the filename_prefix we hand
# it must include the per-project unified prefix (e.g. "borut/hotfruits/batch/h3")
# or variants land in the wrong project's folder.
COMFY_PREFIX_BASE = _StrProxy("comfy_filename_prefix_base")

MOCKUP_IMAGE = CFG["mockup_image"]
CHECKPOINT = CFG["checkpoint"]
LORA = CFG["lora"]
LORA_STRENGTH = CFG["lora_strength"]
CONTROLNET = CFG["controlnet"]
RMBG_MODEL = CFG["rmbg_model"]
# Normalize to a real bool at load: the UI saves "on"/"off" strings, the
# default is a bool. Anything not explicitly falsy means cutout ON.
REMBG = str(CFG["rembg"]).strip().lower() not in ("0", "false", "no", "off")
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
    "rembg": "REMBG",
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


# Config keys whose module global is NOT the raw config value — the same
# normalisation the import-time `X = CFG["x"]` derivations above apply. Kept as
# a map so `refresh_config_globals` can never drift from them; add an entry here
# whenever one of those lines grows a coercion.
_CONFIG_GLOBAL_NORMALIZERS = {
    "rembg": lambda v: str(v).strip().lower() not in ("0", "false", "no", "off"),
}


def refresh_config_globals() -> dict:
    """Re-derive the CFG-backed module globals from the CURRENT config. Returns
    {config key: value} for everything reset.

    `CFG` and every `X = CFG["x"]` global above are evaluated ONCE, at import.
    In the render subprocess that is correct — it imports, runs one job, exits.
    In the long-lived UI process it is not, and in two compounding ways:
    `_config_paths()` resolves `atlas_config.json` under the ACTIVE (client,
    project) staging root, so the import-time snapshot is pinned both to the
    moment that worker booted (before any ⚙ Save settings) AND to whichever
    project it happened to resolve then. An in-process reader therefore sees
    another era's — or another project's — settings, while the render
    subprocess it claims to be describing reads the current ones.

    `resolve_blueprint_workflow` is the one such reader today, and it was wrong
    in exactly that way: it refused a live `characterdesignertest3` render as
    "pipeline 'flux' is a built-in" and reported the gen size as 1969x1222 while
    the config said 1024x1024 — an export whose whole purpose is to state what
    a real run sends.

    Scoped to `_SETTINGS_GLOBALS`, which is precisely the set callers snapshot
    and restore around the window they refresh in, so a refresh can never
    outlive it. Deliberately does NOT rebind the `CFG` global: every read of it
    is an import-time derivation (none at runtime), so rebinding would change
    nothing and would make `CFG` mean two different things.
    """
    cfg = load_config()
    reset: dict = {}
    for key, gname in _SETTINGS_GLOBALS.items():
        if key not in cfg:
            continue
        normalize = _CONFIG_GLOBAL_NORMALIZERS.get(key)
        value = normalize(cfg[key]) if normalize else cfg[key]
        globals()[gname] = value
        reset[key] = value
    return reset


# Active manifest["atlas"], set in main(). Lets fit_to_region fall back to a
# per-atlas default cell size (atlas.cell_width/cell_height) — and ultimately
# the full atlas — when a region omits its own w/h/x/y. A region with explicit
# geometry is unaffected (back-compat for multi-region atlases).
ATLAS_META: dict = {}

# Per-manifest blueprint exposed-param overrides (B43 Phase 8): key -> raw value,
# resolved in main() from manifest["settings"]["bpParams"][<active blueprint>].
# Empty by default so headless/built-in paths and a blueprint with no params are
# byte-identical (build_workflow_blueprint falls back to each param's default).
BP_PARAM_OVERRIDES: dict = {}

# Sentinel: "no usable value" — _effective_param_value returns this when even the
# param's default can't be coerced, so the runner leaves the node input at the
# graph's baked value instead of injecting garbage.
_UNSET = object()


class _CoerceError(Exception):
    """Raised by _coerce_param when a value can't be coerced to the declared
    type, so callers can fall back to the param's default instead of injecting
    a wrong-typed value onto a node input."""


def _coerce_param(value, ptype: str):
    """Coerce a raw param value (string from the UI, or a JSON literal) to the
    type the blueprint declared, so it lands on the node input as the right
    Python type. Raises _CoerceError on an uncoercible numeric/bool so the
    caller can fall back to the param's default rather than passing garbage
    onto the node (which would make remote ComfyUI reject the whole prompt)."""
    if value is None:
        return None
    t = (ptype or "").lower()
    try:
        if t == "int":
            return int(float(value)) if isinstance(value, str) else int(value)
        if t == "float":
            return float(value)
        if t == "bool":
            return _truthy(value, False)
        # text / select / unknown -> string
        return str(value)
    except (TypeError, ValueError) as e:
        raise _CoerceError(str(e)) from e


def _effective_param_value(p: dict, raw):
    """Resolve the EFFECTIVE value to inject for one declared blueprint param.

    `raw` is the override (when set) else the param's default. Degrades
    gracefully so a bad/out-of-range user value never reaches the node input:
      - coercion to the declared `type` fails  -> fall back to the param's
        `default` (re-coerced);
      - numeric value out of declared `min`/`max` -> clamp into range;
      - `select` value not in `options`        -> fall back to `default`.
    If even the default is unusable, returns the _UNSET sentinel so the caller
    leaves the node input at whatever the graph shipped with (never garbage).
    Validation guarantees the param structure, so the default is normally valid.
    """
    ptype = str(p.get("type", "text")).lower()
    default = p.get("default")

    def _coerce_or_default(val):
        try:
            return _coerce_param(val, ptype)
        except _CoerceError:
            if val is default or default is None:
                return _UNSET
            try:
                return _coerce_param(default, ptype)
            except _CoerceError:
                return _UNSET

    value = _coerce_or_default(raw)
    if value is _UNSET or value is None:
        return value

    if ptype in ("int", "float"):
        lo = p.get("min")
        hi = p.get("max")
        try:
            if lo is not None and value < (lo := _coerce_param(lo, ptype)):
                value = lo
            if hi is not None and value > (hi := _coerce_param(hi, ptype)):
                value = hi
        except (_CoerceError, TypeError):
            pass
    elif ptype == "select":
        options = p.get("options")
        if isinstance(options, list) and options and value not in [
                str(o) for o in options]:
            # Out-of-domain select value -> fall back to the (valid) default.
            try:
                dv = _coerce_param(default, ptype) if default is not None else _UNSET
            except _CoerceError:
                dv = _UNSET
            value = dv if (dv is _UNSET or dv in [str(o) for o in options]) else _UNSET
    return value


# The layouts this tool LAYS OUT ITSELF, as against reading a pre-authored
# `.atlas` or falling back to the legacy no-layout cell grid. On these the
# manifest owns its regions and every rect is DERIVED OUTPUT, re-stamped from
# scratch on every Create Atlas:
#   pack - ui_server.auto_pack_layout measures each region's generated art and
#          packs it into an auto-sized page.
#   grid - ui_server.grid_layout flows the regions, IN MANIFEST ORDER, through a
#          fixed cell grid whose page and cell size the author typed in
#          ⚙ Settings (`atlas.width/height/cell_width/cell_height`).
# They differ in who decides the page size — the packer on `pack`, the author on
# `grid` — but they agree on everything the callers below test for: the page is
# composed here, the rects have exactly one producer, and no `.atlas` outranks
# them. A gate that means "this tool owns the layout" must ask THIS, not
# `layout == "pack"`.
FROM_SCRATCH_LAYOUTS = frozenset({"pack", "grid"})


def atlas_layout(m: dict) -> str:
    """`manifest["atlas"]["layout"]`, normalized. Absent/blank = "" — the
    `.atlas`-bound / legacy cell-grid manifests, which declare nothing."""
    return str((m.get("atlas") or {}).get("layout", "")).strip().lower()


def is_from_scratch(m: dict) -> bool:
    """Does this tool lay this manifest out itself? See FROM_SCRATCH_LAYOUTS."""
    return atlas_layout(m) in FROM_SCRATCH_LAYOUTS


def is_atlas_bound(m: dict) -> bool:
    """Is this manifest BOUND to a pre-authored `.atlas` file?

    That file is the authoritative region map: `atlas_writers` parses it, a
    same-named manifest region may not override its geometry (`_GEOM_KEYS`),
    and the deploy prefers it over `regions[]`. Nothing in this tool re-derives
    those rects, and the `.atlas` on disk would no longer describe the page if
    something did."""
    return bool(str((m.get("atlas") or {}).get("atlas_file", "")).strip())


# Whether the ART's transparent border takes part in placing it. Stored
# per-manifest at `atlas.pack_trim`; the labels the dropdown shows live in
# `ui_server.PACK_TRIM_MODES`, keyed by these, the same split FROM_SCRATCH_LAYOUTS
# / ATLAS_LAYOUT_MODES already uses.
#   alpha - the element is the art's ALPHA BBOX: it is cropped to its own ink
#           before anything else happens, so where the ink sat on its canvas is
#           discarded and each frame is re-placed on its own.
#   keep  - the element is the WHOLE AUTHORED CANVAS, transparent edges
#           included. Nothing reads the alpha, so every frame drawn on one
#           canvas gets the identical canvas->rect transform and the animation
#           keeps the registration it was drawn with.
PACK_TRIM_MODES = frozenset({"alpha", "keep"})

# NOT CROPPING IS THE DEFAULT (owner direction 2026-09-17). It was `alpha` while
# the setting only reached the packer; cropping art the author did not ask to
# have cropped is the surprising half, so the un-set manifest now gets the
# faithful one. Stored manifests are NOT rewritten: an atlas with an explicit
# `pack_trim` keeps exactly what it says.
PACK_TRIM_DEFAULT = "keep"


def pack_trim_mode(m: dict) -> str:
    """The `atlas.pack_trim` choice for this manifest, normalized. Anything
    unrecognised — including absent and blank — reads as PACK_TRIM_DEFAULT."""
    v = str((m.get("atlas") or {}).get("pack_trim", "")).strip().lower()
    return v if v in PACK_TRIM_MODES else PACK_TRIM_DEFAULT


def keep_full_frame(m: dict) -> bool:
    """Does compose place this manifest's art WITHOUT cropping it to its ink?

    GATED ON `is_from_scratch`, and that gate is the whole safety property. On a
    `.atlas`-bound manifest the packed (w, h) is the rig's authored footprint and
    filling it from the alpha bbox is the verified-correct behaviour
    (`fit_to_region`); the same is true of a Sheet-Maker cell, whose explicit
    `fit_mode:"contain"` is a byte-for-byte parity contract with
    `packer.compose`. Neither of those rects was derived from the art, so
    neither may be re-interpreted by a setting the author last touched on some
    other atlas. Only `pack`/`grid` — where THIS tool derived every rect in the
    same run that composes them — read it.

    `is_atlas_bound` is asked TOO, and it is not redundant. A manifest can hold
    both: the Source .atlas row renders on every panel, so typing a path onto a
    `pack` atlas leaves `layout` and `atlas_file` set at once, and compose then
    takes its geometry from the `.atlas` (`main` overwrites width/height from
    the page and the regions come from `merge_atlas_regions`) while
    `is_from_scratch` still answers True. Those rects are a rig's authored
    footprints; filling them from the alpha bbox is the verified-correct
    behaviour and a re-offset rig is the worst failure this tool has. The
    `.atlas` wins."""
    return (is_from_scratch(m) and not is_atlas_bound(m)
            and pack_trim_mode(m) == "keep")


def can_choose_layout(m: dict) -> bool:
    """May the author CHOOSE this manifest's layout in 🧩 Atlas settings?

    NOT the same question as `is_from_scratch`, and conflating the two is the
    fault this exists to fix. `is_from_scratch` asks whether the tool ALREADY
    lays this manifest out — it is the right gate for compose, slice, the page
    pointer and the deploy, all of which act on the geometry as it stands. This
    asks whether handing the layout to the tool would DESTROY something that
    only exists outside it, which is true of exactly one shape: a manifest bound
    to a `.atlas`.

    The third shape is why they differ. A legacy / authored-geometry manifest
    has NO `layout` and NO `atlas_file`, but real rects (typically with an
    `offX/offY/origW/origH` trim and a `texturepacker_json`) written by an
    exporter or by hand. `is_from_scratch` is False for it, so gating the
    dropdown on that predicate withheld the one control that could ever GIVE it
    a layout — the atlases with no layout were the only ones that could not
    choose one. Its rects are still lost by a switch (see
    `ui_server.switch_atlas_layout`, which says so in the reply), but they are
    lost to a choice the author made with the consequence named, not to a
    control they were refused."""
    return not is_atlas_bound(m)


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


def _staging_rel(key: str) -> str:
    """Map a (possibly project-prefixed) R2 key to a STAGING_ROOT-relative path.

    The Sheet Maker writes keys WITH the `<client>/<project>/` prefix (e.g.
    `borut/hotfruits/sheets/foo/bar.png`), but STAGING_ROOT is ALREADY
    project-rooted, so building `STAGING_ROOT / <key>` verbatim yields
    `staging_root/<C>/<P>/sheets/...` (file-not-found). Strip a leading
    `r2_project_prefix + "/"` if present and return the remainder
    (`sheets/foo/bar.png`); keys that already lack the prefix pass through.
    Always normalises Windows separators and strips a leading slash."""
    k = (key or "").replace("\\", "/").lstrip("/")
    try:
        prefix = project_paths.resolve().get("r2_project_prefix") or ""
    except Exception:  # noqa: BLE001
        prefix = ""
    if prefix:
        prefix = prefix.replace("\\", "/").strip("/")
        if k == prefix:
            return ""
        if k.startswith(prefix + "/"):
            return k[len(prefix) + 1:]
    return k


def _hydrate_from_r2_by_name(name: str, r2_key: str | None = None) -> Path | None:
    """Pull a geometry/page file into staging when it isn't on local disk yet.

    Two modes:
      - `r2_key` given (a full R2 key, e.g. a Sheet-Maker `sheets/…`/`sheet_src/…`
        artifact): fetch that EXACT key (no list scan) and write it to
        `STAGING_ROOT / _staging_rel(r2_key)`, preserving the sheets/sheet_src
        subtree. Returns that local path.
      - no `r2_key`: a legacy/Windows-authored manifest names an atlas/page by
        bare basename. Probe the two historic locations (`input/refs/atlas/<name>`
        — the INPUT_DIR mirror — and the shared `manifests/<name>`) writing to
        `INPUT_DIR/refs/atlas/<name>`, AND scan `sheets/`/`sheet_src/` for a key
        whose basename matches, writing that to `STAGING_ROOT / _staging_rel(key)`.

    Best-effort; returns None if R2 is empty/down."""
    try:
        r2_prefix = project_paths.resolve().get("r2_project_prefix")
    except Exception:  # noqa: BLE001
        return None
    if not r2_prefix:
        return None
    # Direct by-key fetch: write into staging preserving the sheets/ subtree.
    # The caller may pass either a full prefixed key (`<C>/<P>/sheets/…`, from a
    # self-contained manifest) or a staging-relative one (`sheets/…`, from an
    # /fsbrowse pick). Normalise to the staging-relative remainder, then rebuild
    # the canonical full R2 key for storage.get — and dest from STAGING_ROOT.
    if r2_key:
        srel = _staging_rel(r2_key)
        if not srel:  # ref equal to the project prefix → don't write to staging root
            return None
        full_key = f"{r2_prefix}/{srel}"
        blob = storage.get(full_key)
        if not blob:
            return None
        dest = STAGING_ROOT / srel
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(blob)
            return dest
        except OSError:
            return None
    if not name:
        return None
    # Historic locations — write to refs/atlas/ as today.
    for key in (f"{r2_prefix}/input/refs/atlas/{name}", f"{r2_prefix}/manifests/{name}"):
        blob = storage.get(key)
        if blob:
            dest = INPUT_DIR / "refs" / "atlas" / name
            try:
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(blob)
                return dest
            except OSError:
                return None
    # Sheet-Maker subtrees: basename scan, then fetch the exact key and write it
    # into staging preserving the sheets/sheet_src subtree.
    for sub in ("sheets/", "sheet_src/"):
        try:
            entries = storage.list_keys(f"{r2_prefix}/{sub}")
        except Exception:  # noqa: BLE001
            entries = []
        for entry in entries:
            key = entry.get("key") if isinstance(entry, dict) else str(entry)
            if not key or os.path.basename(key) != name:
                continue
            blob = storage.get(key)
            if not blob:
                continue
            dest = STAGING_ROOT / _staging_rel(key)
            try:
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(blob)
                print(f"[atlas] hydrate-by-name {name} <- {key}")
                return dest
            except OSError:
                return None
    return None


def atlas_file_path(manifest: dict, manifest_path: Path) -> Path | None:
    """Resolve the bound `.atlas` for this manifest, or None for the legacy
    cell-grid path. Either the selected file IS a `.atlas`, or the JSON
    manifest's atlas block names one via `atlas_file` (absolute, or a path
    resolved inside the R2-backed staging tree).

    A relative `atlas_file` is resolved against the staging locations the
    cloud port writes to — alongside the manifest, and the INPUT_DIR mirror
    of the R2 asset repo (the form `/fsbrowse` returns) — falling back to a
    bare name next to the app dir for legacy/local manifests."""
    if manifest_path.suffix.lower() == ".atlas":
        return manifest_path
    ref = (manifest.get("atlas") or {}).get("atlas_file")
    if not ref:
        return None
    p = Path(ref)
    # A genuine container-absolute path that exists wins (legacy/local runs).
    # A Windows-authored absolute path (e.g. "C:\\...\\symbols.atlas") is NOT
    # is_absolute() on Linux, so it must NOT be joined onto INPUT_DIR verbatim
    # (that's the B27 bug: /data/.../input/C:/.../symbols.atlas). Instead we
    # normalise separators + derive a real bare name (POSIX-aware) and try the
    # `refs/atlas/` upload location — the same robustness source_image_candidates
    # already has for the page image.
    if p.is_absolute() and p.exists():
        return p
    rel = ref.replace("\\", "/").lstrip("/")
    name = Path(rel).name  # rel uses '/', so this is the true basename
    cands: list[Path] = []
    # Sheet-Maker artifact: `atlas_file` is an R2 key under sheets/ (packed
    # `.atlas`) or sheet_src/ (loose). STAGING_ROOT mirrors the project root 1:1,
    # so the staged copy lives at STAGING_ROOT / <subtree-relative>. Hydrate that
    # subtree lazily first, then offer the staged path BEFORE the basename
    # fallbacks below. _staging_rel() strips the project prefix (CRITICAL —
    # raw `STAGING_ROOT / <key>` would double the <C>/<P> prefix).
    srel = _staging_rel(ref)
    if srel.startswith("sheets/") or srel.startswith("sheet_src/"):
        project_paths.ensure_lazy("sheets/" if srel.startswith("sheets/") else "sheet_src/")
        cands.append(STAGING_ROOT / srel)
    cands += [manifest_path.parent / rel, INPUT_DIR / rel,
              manifest_path.parent / name, INPUT_DIR / "refs" / "atlas" / name,
              INPUT_DIR / name, SELF / name]
    for cand in cands:
        if cand.exists():
            return cand
    # Nothing on disk yet — the manifest was likely authored offline with a
    # local/Windows `atlas_file`, but seed_r2 / the Sheet Maker placed the
    # geometry in R2. A sheets/ key fetches by exact key; otherwise pull by
    # basename so resolution succeeds without a manual upload.
    if srel.startswith("sheets/") or srel.startswith("sheet_src/"):
        pulled = _hydrate_from_r2_by_name(name, r2_key=ref)
    else:
        pulled = _hydrate_from_r2_by_name(name)
    if pulled is not None:
        return pulled
    # Still nothing — report against the location an Upload .atlas / the
    # B14 self-contained ingest writes to, so the message names a real R2 path.
    return INPUT_DIR / "refs" / "atlas" / name


def resolve_manifest_arg(arg: str) -> Path:
    """Resolve a `--manifest` CLI arg to a path in the R2-backed staging tree.

    The original tool ran on a local checkout, so a bare manifest name (or a
    legacy `tools/...` value) resolved against the script dir. In the cloud the
    manifests live in the staging mirror (`MANIFEST_DIR`), NOT next to the
    script, so a bare/relative name must resolve there — otherwise compose/slice
    hit `/app/<name>` and raise FileNotFoundError (the B15 bug class).

    An absolute path is honoured as-is; otherwise we strip any directory part
    (Windows or POSIX) and resolve the bare filename against MANIFEST_DIR."""
    p = Path(arg)
    if p.is_absolute():
        return p
    name = Path(arg.replace("\\", "/")).name
    return MANIFEST_DIR / name


def source_image_candidates(manifest: dict, atlas_path: Path | None,
                            page_image: str) -> list[Path]:
    """Ordered candidate paths for the atlas source page image, normalising
    Windows separators and stripping absolute local prefixes that won't exist
    in the Linux container. Shared by slice (per-region crops) and any caller
    that needs the original page bitmap.

    Resolution order:
      1. manifest atlas.source_image — absolute (honoured), else resolved
         against the staging INPUT_DIR mirror by its full relative path AND by
         its bare name under `refs/atlas/` (where B10's /uploadatlas writes it);
      2. the bound `.atlas`'s page image, next to the `.atlas` file;
      3. <input>/<page>,  <input>/refs/<page>,  <input>/refs/atlas/<page>."""
    cands: list[Path] = []
    atlas_meta = manifest.get("atlas") or {}
    # Sheet-Maker self-contained manifests carry the packed PAGE PNG as an R2 key
    # in `source_image_path` (under sheets/). STAGING_ROOT mirrors the project
    # root 1:1, so the staged copy is STAGING_ROOT / _staging_rel(key) — offered
    # FIRST (highest priority) so it wins over legacy basename guesses, and used
    # as the by-key fallback. _staging_rel() strips the <C>/<P> prefix (CRITICAL:
    # raw STAGING_ROOT / <key> would double it).
    #
    # `atlas/` is in the same family: a `pack` atlas names the page the tool
    # ITSELF composed (`atlas/<stem>_new.webp`, mirrored to R2 by
    # ui_server.publish_pack_page) so its rects and its page come from one
    # producer. It is not lazy — hydrate pulls `atlas/` in the background at
    # startup — but it still has to be offered here by key, or the by-BASENAME
    # fallback below scans only the historic refs/sheets locations and never
    # finds it.
    sip = atlas_meta.get("source_image_path")
    sip_srel = _staging_rel(sip) if sip else ""
    sip_sub = next((s for s in ("sheets/", "sheet_src/", "atlas/")
                    if sip_srel.startswith(s)), "")
    if sip_sub:
        if sip_sub != "atlas/":
            project_paths.ensure_lazy(sip_sub)
        cands.append(STAGING_ROOT / sip_srel)
    si = atlas_meta.get("source_image")
    if si:
        p = Path(si)
        if p.is_absolute():
            cands.append(p)
        else:
            rel = si.replace("\\", "/").lstrip("/")
            name = Path(rel).name
            cands += [INPUT_DIR / rel, INPUT_DIR / "refs" / "atlas" / name]
    if page_image:
        pg = Path(page_image.replace("\\", "/")).name
        if atlas_path is not None:
            cands.append(atlas_path.parent / pg)
        cands += [INPUT_DIR / pg, INPUT_DIR / "refs" / pg,
                  INPUT_DIR / "refs" / "atlas" / pg]
    # Nothing on disk yet — auto-hydrate from R2. A `source_image_path` naming a
    # known subtree (a Sheet-Maker `sheets/` page, a composed `atlas/` page)
    # fetches by EXACT key, preserving that subtree; otherwise the legacy page
    # (seeded under refs/atlas/) pulls by basename. Same as atlas_file_path.
    if not any(c.exists() for c in cands):
        if sip_sub:
            name = Path(sip_srel).name
            pulled = _hydrate_from_r2_by_name(name, r2_key=sip)
        else:
            name = Path((si or page_image or "").replace("\\", "/")).name
            pulled = _hydrate_from_r2_by_name(name)
        if pulled is not None:
            cands.append(pulled)
    return cands


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


# Cap on the ONE call that submits the job (`/prompt`). It had no timeout at
# all, so `urlopen` fell back to `socket.getdefaulttimeout()` — None — and
# waited FOREVER. That is not theoretical: with the Cloudflare tunnel's
# connector down, the edge still completes the TCP+TLS handshake and then never
# answers, so the render blocked on a socket read that could not return, the
# subprocess never exited, and the panel showed "Rendering 0/2..." indefinitely
# with no error to show. The comment above `_COMFY_HTTP_TIMEOUT` already made
# this exact argument for `comfy_get` (and even names /prompt as answering "in
# tens of ms") — `comfy_post` was simply missed. Generous, because a big
# workflow JSON crosses the tunnel here, but finite.
_COMFY_POST_TIMEOUT = 60.0


def comfy_post(path: str, payload: dict) -> dict:
    req = Request(
        f"{COMFY_BASE}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **CF_HEADERS},
    )
    try:
        return json.loads(urlopen(req, timeout=_COMFY_POST_TIMEOUT).read())
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        # A 502/503/504 comes from the Cloudflare tunnel EDGE, not ComfyUI: the
        # tunnel is reachable but the origin (the user's LOCAL ComfyUI) didn't
        # answer. ComfyUI itself rejects a bad prompt with 400 + JSON — never a
        # 502 HTML page — so calling this "rejected the prompt" (and dumping the
        # payload) misleads. Report it as an unreachable origin instead.
        if e.code in (502, 503, 504):
            print("\n=== ComfyUI did not respond ===")
            print(f"The tunnel returned HTTP {e.code} for {COMFY_BASE}{path}.")
            print("The Cloudflare tunnel is up, but your LOCAL ComfyUI behind "
                  "it did not answer — most likely it isn't running, is still "
                  "booting, or crashed / ran out of VRAM on a previous job.")
            print("Fix: on the GPU machine, start (or restart) ComfyUI and "
                  "confirm the cloudflared tunnel points at it, then retry. "
                  "A 502 is never a problem with the prompt, the blueprint, or "
                  "this tool.")
            raise SystemExit(2)
        if e.code in (401, 403):
            print("\n=== ComfyUI access denied ===")
            print(f"The tunnel returned HTTP {e.code} for {COMFY_BASE}{path}.")
            print("The Cloudflare Access service token (CF-Access-Client-*) was "
                  "rejected or is missing — check the atlas-tool env hasn't "
                  "expired, then retry.")
            raise SystemExit(2)
        # A 400 with a "missing_node_type" means the blueprint's graph uses a
        # CUSTOM NODE the user's local ComfyUI doesn't have installed — a setup
        # gap, not a bad prompt. Turn the raw JSON into a clear, actionable
        # instruction (this recurs when importing blueprints with dependencies).
        try:
            _err = (json.loads(body) or {}).get("error") or {}
        except Exception:  # noqa: BLE001 — not JSON / unexpected shape
            _err = {}
        if isinstance(_err, dict) and _err.get("type") == "missing_node_type":
            _xi = _err.get("extra_info") or {}
            _ct = str(_xi.get("class_type") or "?")
            _title = str(_xi.get("node_title") or _ct)
            print("\n=== ComfyUI is missing a custom node ===")
            print(f"This blueprint uses '{_title}' ({_ct}), which is NOT "
                  "installed in the ComfyUI this run targets, so the graph was "
                  "rejected. Validation stops at the FIRST unknown class, so "
                  "there may be more behind it — assert_nodes_installed lists "
                  "them all before a job is spent, and only stays quiet when "
                  "the target could not be probed.")
            print("Fix: switch the generation target to RunPod, where the packs "
                  "pinned in services/atlas-comfy-pod/nodes.json are already "
                  "baked — or make this ComfyUI match that image with "
                  "services/atlas-comfy-pod/tools/sync-local-nodes.py, then "
                  "restart it. Installing by hand from ComfyUI-Manager works "
                  "too, but it pulls the pack's TIP, which is the drift those "
                  "pins exist to prevent.")
            raise RuntimeError(f"ComfyUI is missing custom node '{_ct}'.")
        # Any other genuine ComfyUI rejection (bad prompt, node error): show the
        # body + payload so the graph can be fixed. Raise RuntimeError so main()
        # renders a clean banner instead of a raw Python traceback.
        print("\n=== ComfyUI rejected the prompt ===")
        print(f"HTTP {e.code} {e.reason}")
        print(body)
        print("\n=== Payload sent (first 4 KB) ===")
        print(json.dumps(payload, indent=2)[:4096])
        raise RuntimeError(f"ComfyUI rejected the prompt (HTTP {e.code}).")
    # TimeoutError explicitly: urllib wraps a timeout waiting for the response
    # HEADERS in URLError, but one that lands mid-BODY (after urlopen returned)
    # surfaces raw, and it is neither a URLError nor a ConnectionError — it
    # would escape as an unhandled traceback instead of this message.
    except (URLError, ConnectionError, TimeoutError) as e:
        print("\n=== Cannot reach ComfyUI ===")
        print(f"No server responding at {COMFY_BASE}")
        print(f"Reason: {e}")
        print("Fix: make sure ComfyUI is running and reachable over the tunnel "
              "(COMFY_URL), then retry.")
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
    req = Request(f"{COMFY_BASE}{path}", headers=CF_HEADERS)
    return json.loads(urlopen(req, timeout=_COMFY_HTTP_TIMEOUT).read())


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
_COMFY_PROBE_HTTP_TIMEOUT = 3.0  # tunnel + Cloudflare Access adds latency
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
    # Cloud: a single tight HTTP GET to /system_stats over the tunnel (TCP
    # probing host:port doesn't apply to an https tunnel behind Access).
    try:
        req = Request(f"{COMFY_BASE}/system_stats", headers=CF_HEADERS)
        urlopen(req, timeout=_COMFY_PROBE_HTTP_TIMEOUT).read()
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


def _bust_comfy_caches() -> None:
    """Drop the time-cached ComfyUI verdicts so the NEXT `_comfy_alive()` /
    `_available()` re-probes the live server instead of returning a stale
    value. Called right after a Manager reboot: the pre-reboot cache may say a
    model is missing (or Comfy is down) when the freshly-restarted server now
    has it — trusting that stale read would falsely fail the run."""
    _avail_cache.clear()
    _comfy_alive_cache["t"] = 0.0
    _comfy_alive_cache["ok"] = False


# FLUX (and SD3) latents carry 16 channels; SD1.x/SDXL latents carry 4. A VAE
# from the wrong family never decodes — it dies inside VAEDecode with
# "expected input[1, 16, 128, 128] to have 4 channels, but got 16 channels
# instead". That is the LAST node of the graph, so the sampler has already
# burned the full step count on the GPU before anyone learns the VAE was wrong.
_FLUX_LATENT_CHANNELS = 16

# ComfyUI's built-in tiny autoencoders, by latent channels. These four are in
# the VAELoader dropdown on every install (they ship with ComfyUI — there is no
# file to add), which puts `taesdxl` one row away from `taef1` in the FLUX VAE
# picker. They are also the only VAE names whose family is knowable from the
# NAME alone: a user's own *.safetensors can be anything, and refusing unknown
# names would block every legitimately-named FLUX VAE, so those stay ComfyUI's
# call.
_TAE_LATENT_CHANNELS = {
    "taesd": 4,      # SD1.x / SD2.x
    "taesdxl": 4,    # SDXL
    "taesd3": 16,    # SD3
    "taef1": 16,     # FLUX
}


def wrong_family_vae(vae_name: str,
                     latent_channels: int = _FLUX_LATENT_CHANNELS) -> int | None:
    """The latent-channel count of `vae_name` when it is a KNOWN mismatch for a
    `latent_channels`-channel pipeline, else None (compatible, or a name whose
    family we cannot know). Pure — no ComfyUI call — so the guard is testable
    offline."""
    got = _TAE_LATENT_CHANNELS.get(str(vae_name or "").strip().lower())
    return None if got is None or got == latent_channels else got


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
    # The enum loop below reads COMFY_BASE — the ARTIST'S desktop over the
    # tunnel. On the serverless transport the render runs on a RunPod worker
    # whose inventory is fixed in its own image, so a desktop enum can only
    # produce a wrong answer: with the tunnel up this refused pod renders
    # because the DESKTOP lacked the checkpoint. Same reasoning as
    # `_probe_ready`. Only the enum reads are dropped — the VAE-family guard
    # further down asks no target anything, and skipping it on serverless would
    # pay a cold start plus a full sampling run for a mistake that is free to
    # catch here.
    if COMFY_TRANSPORT == "serverless":
        checks = []
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
    # Existence is not compatibility. `taesdxl` IS in the VAELoader enum, so
    # every check above passes and ComfyUI queues the job happily — the SDXL
    # decoder only meets the FLUX latent at VAEDecode, minutes of GPU later.
    # The all-in-one checkpoint path is exempt: its VAE comes out of the
    # checkpoint, so there is no name to get wrong.
    if str(PIPELINE).lower() == "flux" and not FLUX_CHECKPOINT:
        got = wrong_family_vae(FLUX_VAE)
        if got is not None:
            problems.append(
                f"  {_FIELD_SETTING_LABEL['vae_name']} is '{FLUX_VAE}', a "
                f"{got}-channel VAE, but FLUX latents carry "
                f"{_FLUX_LATENT_CHANNELS} channels.\n"
                f"    ComfyUI accepts the NAME, so the job would queue, sample "
                f"for the full step count, then die at the final node with "
                f"'expected input[1, {_FLUX_LATENT_CHANNELS}, ...] to have "
                f"{got} channels'.\n"
                f"    Fix: set it to 'ae.safetensors' (the FLUX autoencoder) "
                f"or 'taef1' (ComfyUI's built-in tiny FLUX VAE - faster, "
                f"softer). 'taesd' and 'taesdxl' are SD1.x/SDXL only.")
    if problems:
        print("\n=== Model preflight failed ===")
        print("\n".join(problems))
        raise SystemExit(2)


# --------------------------------------------------------------------------
# Blueprint model auto-download (B43 phase 4) — drives ComfyUI-Manager's queue
# API over the SAME tunnel + CF headers + UA. The stdlib HTTP twins below are
# injected into blueprint_models.prepare_blueprint_models so that pure helper
# stays network-free + unit-testable. Manager routes that 404 mean Manager
# isn't installed → ManagerAbsent; a torn-down connection on /reboot is the
# expected os.execv case (handled inside the prepare step).
# --------------------------------------------------------------------------
def _manager_post(path: str, body: dict) -> tuple[int, str]:
    """POST JSON to a /manager/* route. Returns (status, text). Maps a 404 to
    ManagerAbsent (Manager not installed) and a connection failure to
    ComfyUnreachable; other HTTP statuses (400/403/200/201) come back as
    (status, text) so the caller can branch per-model."""
    data = json.dumps(body or {}).encode("utf-8")
    req = Request(
        f"{COMFY_BASE}{path}", data=data,
        headers={"Content-Type": "application/json", **CF_HEADERS},
        method="POST",
    )
    try:
        with urlopen(req, timeout=30) as r:
            return r.getcode(), r.read().decode("utf-8", "replace")
    except HTTPError as e:
        if e.code == 404:
            raise blueprint_models.ManagerAbsent(path)
        return e.code, e.read().decode("utf-8", "replace")
    except (URLError, ConnectionError, OSError) as e:
        raise blueprint_models.ComfyUnreachable(str(e))


def _manager_get(path: str) -> dict:
    """GET a /manager/* (or /system_stats, or /externalmodel/getlist) route →
    parsed JSON. `path` may carry a query string. 404 → ManagerAbsent; transport
    failure → ComfyUnreachable."""
    req = Request(f"{COMFY_BASE}{path}", headers=CF_HEADERS)
    try:
        with urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except HTTPError as e:
        if e.code == 404:
            raise blueprint_models.ManagerAbsent(path)
        raise blueprint_models.ComfyUnreachable(f"HTTP {e.code}")
    except (URLError, ConnectionError, OSError) as e:
        raise blueprint_models.ComfyUnreachable(str(e))


def _model_installed(field: str, filename: str) -> bool | None:
    """Is `filename` already a valid value for `field` in some loader's
    /object_info enum? True / False / None — the same three-valued discipline
    `_class_info` uses.

    `None` means NO VERDICT, not "missing": the field has no entry in
    `_MODEL_FIELD_NODES` (five of `blueprints.MODEL_FIELD_DIRS`' fourteen do
    not), or the enum could not be read at all. Reporting those as `False` made
    them a permanent checklist line no amount of syncing could clear, because a
    DERIVED declaration carries no url/base and so can never be auto-installed
    out of it either."""
    if not _comfy_alive():
        raise blueprint_models.ComfyUnreachable("ComfyUI not answering")
    node = _MODEL_FIELD_NODES.get(field)
    if not node:
        return None
    avail = _available(node, field)
    if avail is None:
        return None
    return filename in avail


# Maps a model's /object_info enum field → a loader node that exposes it, so the
# installed-check can read the right dropdown. Mirrors the loader fields the
# built-in graphs use; extend as new blueprint loaders appear.
_MODEL_FIELD_NODES = {
    "ckpt_name": "CheckpointLoaderSimple",
    "lora_name": "LoraLoader",
    "vae_name": "VAELoader",
    "control_net_name": "ControlNetLoader",
    "unet_name": "UNETLoader",
    "clip_name": "CLIPVisionLoader",
    "clip_name1": "DualCLIPLoader",
    "clip_name2": "DualCLIPLoader",
    "style_model_name": "StyleModelLoader",
}

# Which Settings field feeds each loader input, so the guard below can name the
# thing the user has to fix rather than the ComfyUI input they never chose.
_FIELD_SETTING_LABEL = {
    "vae_name": "FLUX VAE (flux_vae)",
    "unet_name": "FLUX UNet (flux_unet)",
    "clip_name1": "FLUX CLIP T5-XXL (flux_clip_t5)",
    "clip_name2": "FLUX CLIP L (flux_clip_l)",
    "clip_name": "FLUX CLIP-Vision (flux_clip_vision)",
    "ckpt_name": "Checkpoint (checkpoint / flux_checkpoint)",
    "lora_name": "LoRA (lora / flux_lora)",
    "control_net_name": "ControlNet (controlnet / flux_controlnet)",
    "style_model_name": "FLUX Redux model (flux_redux_style_model)",
    "sampler_name": "FLUX sampler (flux_sampler)",
    "scheduler": "FLUX scheduler (flux_scheduler)",
    "weight_dtype": "FLUX weight dtype (flux_weight_dtype)",
}


def assert_models_named(wf: dict) -> None:
    """Refuse to SUBMIT a graph that carries an empty model/enum name.

    A node that should not run is left OUT of the graph — that is how every
    optional model is expressed — so a model input that IS present and empty is
    always a mistake, and ComfyUI always rejects it:

        /prompt rejected (400): vae_name: '' not in ['ae.safetensors', …]

    Before this guard that verdict cost a queued RunPod job and a cold start to
    obtain, and arrived as a wall of JSON naming a node number. Checking the
    built graph costs nothing and names the setting instead.

    Scoped to model/enum inputs on purpose: plenty of string inputs are validly
    empty (FLUX's negative prompt is literally `"text": ""`), and only these
    carry an /object_info enum that "" can never satisfy."""
    bad: list[str] = []
    for node_id, node in sorted((wf or {}).items()):
        if not isinstance(node, dict):
            continue
        cls = str(node.get("class_type", "?"))
        for field, value in (node.get("inputs") or {}).items():
            # A list is a wire to another node, never a name — skip it.
            if not isinstance(value, str) or value.strip():
                continue
            if field in _MODEL_FIELD_NODES or field in _FIELD_SETTING_LABEL:
                label = _FIELD_SETTING_LABEL.get(field, field)
                bad.append(f"  node {node_id} ({cls}).{field} <- {label}")
    if not bad:
        return
    print("\n=== A required model name is empty ===")
    print("\n".join(bad))
    print("\nComfyUI would reject this prompt with 'value_not_in_list'. Set "
          "these in the Atlas Maker's Settings panel (an empty box there means "
          "'unset', and a required field falls back to its default) and retry. "
          "No job was submitted.")
    raise RuntimeError(
        "Refusing to submit: "
        + "; ".join(b.strip() for b in bad)
        + ". Set them in Settings and retry.")


# Does the ComfyUI we are about to submit to declare this class? Keyed by
# (base, class) so switching target mid-process can never inherit the other
# machine's answer. Process-lifetime and no TTL on purpose: a generation run is
# a subprocess, and a newly installed node is not loaded until ComfyUI restarts
# anyway, so nothing can change under us within one run.
# Values: the class's `/object_info` entry (a dict) when the target has it, `False`
# when the target answered "no such class", and no entry at all when the probe reached
# no verdict. Storing the PAYLOAD rather than a bool is what lets the model check below
# reuse the node check's requests instead of doubling them.
_CLASS_PRESENT: dict[tuple[str, str], dict | bool] = {}

# Cap on how many distinct classes one preflight probes. A blueprint graph is
# tens of nodes; past this it is pathological, and a guard is not worth turning
# into a stampede of tunnel round trips.
_NODE_PROBE_CAP = 80

# A core class every ComfyUI ships. Probed FIRST as a sentinel: if even this
# reads absent, the probe is broken (a route that moved, an edge answering 404
# for everything) and the guard must stay silent rather than accuse a healthy
# install of missing every node in the graph. A guard that cries wolf gets
# ignored, which costs more than the failure it was added to catch.
_PROBE_SENTINEL = "SaveImage"


def _class_info(cls: str) -> dict | bool | None:
    """The class's `/object_info` entry, `False` when the target does not have
    it, or None when the probe reached no verdict.

    `/object_info/<class>` answers `{"<class>": {…}}` for a registered class and
    `{}` for one it does not know (some builds 404 instead) — so ABSENCE is a
    real answer here, not a failure. Everything else (timeout, tunnel error,
    unparseable body) is None, so neither guard can fire on a flaky
    connection."""
    key = (COMFY_BASE, cls)
    if key in _CLASS_PRESENT:
        return _CLASS_PRESENT[key]
    try:
        info = comfy_get(f"/object_info/{urllib.parse.quote(cls)}")
        entry = info.get(cls) if isinstance(info, dict) else None
        found = entry if isinstance(entry, dict) else False
    except HTTPError as e:
        if e.code != 404:
            return None
        found = False
    except (URLError, ConnectionError, TimeoutError, ValueError, OSError):
        return None
    _CLASS_PRESENT[key] = found
    return found


def _class_installed(cls: str) -> bool | None:
    """True / False / None — the presence question, over `_class_info`."""
    info = _class_info(cls)
    return None if info is None else info is not False


def _probe_ready() -> bool:
    """May a guard base a REFUSAL on what `/object_info` says here?

    No on the serverless transport (there is no live ComfyUI to ask; that
    worker's inventory is fixed in its own image), no when ComfyUI is not
    answering (the run's own unreachable path says it better), and no when the
    sentinel class reads absent — a probe that denies `SaveImage` is broken, and
    a guard that cries wolf gets ignored, which costs more than the failure it
    was added to catch."""
    if COMFY_TRANSPORT == "serverless" or not _comfy_alive():
        return False
    return _class_installed(_PROBE_SENTINEL) is True


def assert_nodes_installed(wf: dict) -> None:
    """Refuse to SUBMIT a graph whose node TYPES the target does not have.

    ComfyUI rejects such a graph with `missing_node_type`, but its validation
    stops at the first unknown class — so a blueprint built against a pack the
    target lacks gets enumerated one failed submission at a time. Asking
    `/object_info` per distinct class costs a few small GETs, once (answers are
    cached, so only the first region pays), and names the whole gap in one
    message.

    Sibling of assert_models_named: same gate, one layer down. That one checks
    the graph NAMES a model; this one checks its nodes exist at all.

    Silent — never a verdict — when it cannot know: on the serverless transport
    (no live ComfyUI to ask; that worker's node set is fixed elsewhere), when
    ComfyUI is not answering (the run's own unreachable path says it better),
    when the graph is implausibly large, and when the sentinel probe fails."""
    if not _probe_ready():
        return
    used: dict[str, list[str]] = {}
    for node_id, node in (wf or {}).items():
        if not isinstance(node, dict):
            continue
        cls = str(node.get("class_type") or "").strip()
        if cls:
            used.setdefault(cls, []).append(str(node_id))
    if not used or len(used) > _NODE_PROBE_CAP:
        return
    missing = [c for c in sorted(used) if _class_installed(c) is False]
    if not missing:
        return
    print("\n=== ComfyUI is missing custom nodes ===")
    print(f"This graph needs {len(missing)} node type(s) that {COMFY_BASE} "
          f"does not have:")
    for cls in missing:
        ids = ", ".join(sorted(used[cls], key=lambda s: (len(s), s)))
        print(f"  {cls}  (graph node {ids})")
    print("\nNothing was submitted. ComfyUI's own rejection stops at the first "
          "unknown class, so finding these by running costs one failed job "
          "each.")
    print("Fix, cheapest first:")
    print("  * Switch the generation target to RunPod — the pod image and the "
          "serverless worker carry the packs pinned in "
          "services/atlas-comfy-pod/nodes.json.")
    print("  * Or make this ComfyUI match that image, then RESTART it:")
    print("      python services/atlas-comfy-pod/tools/sync-local-nodes.py "
          "--comfy-root <your ComfyUI>")
    print("  * A class no pinned pack provides has to be added to nodes.json "
          "first (/comfyui -> Custom nodes -> Add), or it will fail on RunPod "
          "too.")
    print("Models stay a separate problem: a node loading is not its weights "
          "being present.")
    raise RuntimeError(
        f"Refusing to submit: ComfyUI at {COMFY_BASE} is missing node type(s) "
        + ", ".join(missing)
        + ". Sync the node packs (see above) or switch the generation target "
          "to RunPod, then retry.")


# A baked value ending in one of these is a FILE the target has to hold, which is what
# makes it safe to check against the node's own enum. Every other combo (sampler_name,
# scheduler, weight_dtype, a node's mode switch) is left alone on purpose: ComfyUI lets a
# class override list validation with VALIDATE_INPUTS, `/object_info` does not say which
# ones do, and a guard that refuses a legal graph is worse than the 400 it saves.
#
# ONE definition, in `blueprints` (which imports nothing from here, so this direction is
# the only one that isn't a cycle): `blueprints.derive_models_from_graph` reads a graph
# with this same rule at IMPORT time, and the two must never drift — a model the
# declaration misses is a model this guard then refuses at submit time.
_MODEL_VALUE_EXTS = blueprints.MODEL_FILE_EXTS


def _enum_options(entry: dict, field: str) -> list[str] | None:
    """The option list ComfyUI declares for `field`, or None if that input is
    not a combo. `/object_info` spells a combo as `[[opt, …], {…}]` and every
    other type as `["INT", {…}]` — so a LIST in slot 0 is the whole test."""
    inputs = (entry.get("input") or {}) if isinstance(entry, dict) else {}
    for bucket in ("required", "optional"):
        spec = (inputs.get(bucket) or {}).get(field)
        if isinstance(spec, list) and spec and isinstance(spec[0], list):
            opts = spec[0]
            if all(isinstance(o, str) for o in opts):
                return opts
    return None


def assert_graph_models_present(wf: dict) -> None:
    """Refuse to SUBMIT a graph naming a model file the target does not have.

    The third gate, and the one the other two leave open. `assert_models_named`
    catches an EMPTY name; `assert_nodes_installed` catches a missing node TYPE;
    neither looks at the model names a BLUEPRINT bakes into its graph. Nothing
    did: `preflight_models` checks the names the SETTINGS panel produces for the
    three built-in pipelines, and a blueprint is covered only by what it
    declares in `models[]` — so a blueprint that declares nothing sails through
    and dies on ComfyUI's `value_not_in_list`.

    That is not hypothetical (2026-09-07): a blueprint authored on the R&D pod
    asked the artist's local ComfyUI for `flux1-dev-fp8.safetensors` and
    `comic-style-lora-000002.safetensors`, neither of which that machine has.
    Which is the recurring shape — a graph carries the FILENAMES of the machine
    it was built on, so a target switch is a model-inventory switch.

    Unlike a missing node type, ComfyUI reports every bad name in one 400, so
    the win here is narrower: one submitted job, which on the serverless path is
    a queued RunPod job and a cold start. The check itself is free — it reads
    the `/object_info` entries `assert_nodes_installed` already fetched.

    Scoped to values that look like FILES (see `_MODEL_VALUE_EXTS`), so a prompt,
    a `filename_prefix` or a sampler name can never be mistaken for one."""
    if not _probe_ready():
        return
    bad: list[tuple[str, str, str, str, list[str]]] = []
    for node_id, node in sorted((wf or {}).items()):
        if not isinstance(node, dict):
            continue
        cls = str(node.get("class_type") or "").strip()
        entry = _class_info(cls) if cls else None
        # A class the target lacks has no enums to read, and is already the node
        # guard's verdict — reporting it twice would only muddy that message.
        if not isinstance(entry, dict):
            continue
        for field, value in sorted((node.get("inputs") or {}).items()):
            # A list is a wire to another node, never a filename.
            if not isinstance(value, str) or not value.strip():
                continue
            if not value.lower().endswith(_MODEL_VALUE_EXTS):
                continue
            opts = _enum_options(entry, str(field))
            if opts is None or value in opts:
                continue
            bad.append((str(node_id), cls, str(field), value, opts))
    if not bad:
        return
    print("\n=== A model this graph names is not on the target ===")
    for node_id, cls, field, value, opts in bad:
        print(f"  node {node_id} ({cls}).{field} = {value!r}")
        # Rank on the STEM, not the whole filename: every candidate shares the
        # extension, and that shared tail alone scores ~0.5, which is how
        # `comic-style-lora-000002` once "matched" `gameIconInstitute3d_v10`.
        stems = {}
        for o in opts:
            stems.setdefault(o.rsplit(".", 1)[0], o)
        near = [stems[s] for s in difflib.get_close_matches(
            value.rsplit(".", 1)[0], list(stems), n=2, cutoff=0.5)]
        if near:
            print(f"      closest it HAS: {', '.join(near)}")
        elif opts:
            shown = ", ".join(opts[:4]) + ("…" if len(opts) > 4 else "")
            print(f"      it has: {shown}")
        else:
            print("      it has NOTHING in that folder")
    print(f"\nNothing was submitted. {COMFY_BASE} would answer 400 "
          "'value_not_in_list'; on the serverless path that costs a queued job "
          "and a cold start to be told the same thing.")
    print("A graph carries the filenames of the machine it was BUILT on, so "
          "this is usually a target mismatch rather than a broken blueprint:")
    print("  * If the blueprint was authored on the R&D pod, run it there — its "
          "volume is where those files live.")
    print("  * Otherwise put the named files in the matching models folder and "
          "RESTART ComfyUI (it reads the folders once, at startup).")
    print("  * Or point the blueprint's parameters at a file this target does "
          "have, remembering a different LoRA is a different look.")
    raise RuntimeError(
        "Refusing to submit: "
        + "; ".join(f"node {n} ({c}).{f} wants {v}" for n, c, f, v, _ in bad)
        + f" — not present on {COMFY_BASE}. Run it on the machine that has them "
          "(the pod, if that is where the blueprint was authored), or install "
          "them there and retry.")


def prepare_blueprint_models_for_run(models: list) -> blueprint_models.PrepareResult:
    """Make the local ComfyUI have every model a blueprint declares before its
    graph is submitted (B43 §4). Returns a structured PrepareResult; NEVER
    raises (a missing Manager / dead ComfyUI / per-model rejection all degrade
    to PrepareResult.still_missing). The caller fails the run if required models
    remain missing — mirroring preflight_models — rather than submitting a
    doomed prompt."""
    return blueprint_models.prepare_blueprint_models(
        models or [],
        http_post=_manager_post,
        http_get=_manager_get,
        is_installed=_model_installed,
        on_rebooted=_bust_comfy_caches,
    )


def comfy_view(filename: str, subfolder: str, type_: str) -> bytes:
    qs = urllib.parse.urlencode(
        {"filename": filename, "subfolder": subfolder, "type": type_}
    )
    req = Request(f"{COMFY_BASE}/view?{qs}", headers=CF_HEADERS)
    return urlopen(req, timeout=120).read()


import uuid as _uuid


def comfy_upload_image(filename: str, data: bytes) -> str:
    """Upload bytes to ComfyUI's input dir (POST /upload/image, multipart) and
    return the name to reference in a LoadImage node. Cloud-only: the remote
    ComfyUI can't see our staging refs, so every LoadImage source is uploaded
    first. Pure stdlib multipart so we keep deps to Pillow + boto3."""
    boundary = f"----InvisibleAtlas{_uuid.uuid4().hex}"
    safe = os.path.basename(filename) or "ref.png"
    parts: list[bytes] = []
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(
        f'Content-Disposition: form-data; name="image"; filename="{safe}"\r\n'.encode()
    )
    parts.append(b"Content-Type: application/octet-stream\r\n\r\n")
    parts.append(data)
    parts.append(f"\r\n--{boundary}\r\n".encode())
    parts.append(b'Content-Disposition: form-data; name="type"\r\n\r\ninput')
    parts.append(f"\r\n--{boundary}\r\n".encode())
    parts.append(b'Content-Disposition: form-data; name="overwrite"\r\n\r\ntrue')
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    body = b"".join(parts)
    req = Request(
        f"{COMFY_BASE}/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}", **CF_HEADERS},
        method="POST",
    )
    resp = json.loads(urlopen(req, timeout=120).read())
    name = resp.get("name", safe)
    sub = resp.get("subfolder")
    return f"{sub}/{name}" if sub else name


def _locate_ref_in_staging(relpath: str) -> Path | None:
    """Resolve a LoadImage `image` value to a real file in the R2-backed
    staging mirror. Region refs take several forms:
      - an absolute container path (legacy/local) → as-is;
      - a Sheet-Maker key (`sheets/…` / `sheet_src/…`, with or without the
        `<C>/<P>` prefix) → lazy-hydrate the subtree and resolve under
        STAGING_ROOT (NOT INPUT_DIR — the Sheet-Maker subtrees mirror the
        project root, not the `input/` mirror); by-key hydrate if not on disk
        yet. This is where painted `shape_ref` silhouettes live;
      - INPUT_DIR-relative (`refs/foo.png`) → the historic ref location;
      - the global `mockup_image` style fallback, a free-text path that may be
        a bare filename / stale value → basename search of the known ref dirs.

    Returns the first hit, else None. Mirrors `ui_server._resolve_region_ref`
    so generation resolves the same Sheet-Maker refs the UI preview does — the
    cold-project gap that left `sheet_src/` shape refs un-uploaded (B-flowtest)."""
    p = Path(relpath)
    if p.is_absolute():
        return p if p.exists() else None
    # Sheet-Maker subtree key (shape_ref silhouettes, packed sheet sources).
    # STAGING_ROOT mirrors <C>/<P> 1:1, so the staged copy is STAGING_ROOT /
    # _staging_rel(key); _staging_rel strips any project prefix (CRITICAL —
    # raw STAGING_ROOT / <key> would double <C>/<P>). Lazy-hydrate the subtree
    # first (a cold project never pulled sheet_src/ eagerly), then fall back to
    # an exact by-key fetch so resolution succeeds even before the bulk pull.
    srel = _staging_rel(relpath)
    if srel.startswith("sheets/") or srel.startswith("sheet_src/"):
        project_paths.ensure_lazy(
            "sheets/" if srel.startswith("sheets/") else "sheet_src/")
        staged = STAGING_ROOT / srel
        if staged.exists():
            return staged
        pulled = _hydrate_from_r2_by_name(Path(srel).name, r2_key=relpath)
        return pulled if (pulled and pulled.exists()) else None
    direct = INPUT_DIR / relpath
    if direct.exists():
        return direct
    # Not on local disk yet. `input/` is mirrored ONCE per process (hydrate's
    # background pull), so a ref written to R2 SINCE that pull is invisible to
    # this container no matter how correct it is — which is the normal case for
    # a Flipbook source image the author uploaded a minute ago. Fetch that exact
    # key rather than re-pulling the whole subtree; the by-key mode writes to
    # STAGING_ROOT/input/<relpath>, i.e. exactly the `direct` path above.
    input_key = relpath if relpath.startswith("input/") else f"input/{relpath}"
    pulled = _hydrate_from_r2_by_name(os.path.basename(relpath), r2_key=input_key)
    if pulled is not None and pulled.exists():
        return pulled
    # Bare-filename fallback: find it by basename anywhere under refs/, then
    # at the INPUT_DIR root. Mirrors how the UI tolerates loosely-stored refs.
    base = os.path.basename(relpath)
    if base:
        refs_dir = INPUT_DIR / "refs"
        if refs_dir.is_dir():
            hit = next(iter(sorted(refs_dir.rglob(base))), None)
            if hit and hit.is_file():
                return hit
        root_hit = INPUT_DIR / base
        if root_hit.is_file():
            return root_hit
    return None


def _iter_workflow_refs(wf: dict):
    """Yield (node, relpath, src_path) for every LoadImage node in wf, resolving
    each ref to a real file in the R2-backed staging mirror. Does NOT mutate wf.

    This is the shared "which refs, what file" routing both transports need: the
    http path uploads each src via /upload/image; the serverless path base64-
    encodes it into RunPod's input.images[]. The remote/worker ComfyUI cannot see
    our filesystem, so an unresolved ref would ship as a raw staging/R2-key path
    and be rejected with an opaque `LoadImage: Invalid image file` 400. Rather
    than degrade to "leaving as-is" (the cold-project bug where a `sheet_src/`
    shape ref that exists only in R2 was never pulled, then sent verbatim), we
    raise a clear, actionable RuntimeError naming the missing ref — caught by
    main()'s GENERATION STOPPED banner."""
    for node in wf.values():
        if not isinstance(node, dict) or node.get("class_type") != "LoadImage":
            continue
        relpath = (node.get("inputs") or {}).get("image")
        if not relpath or not isinstance(relpath, str):
            continue
        src = _locate_ref_in_staging(relpath)
        if src is None:
            raise RuntimeError(
                f"Reference image not found: \"{relpath}\". It is wired into a "
                f"LoadImage node but is missing from staging and could not be "
                f"pulled from R2. Check the region's shape_ref / style_ref "
                f"points at an image that exists in this project (e.g. a "
                f"sheet_src/ sprite or a refs/ upload), then regenerate."
            )
        yield node, relpath, src


def _upload_workflow_refs(wf: dict) -> None:
    """Rewrite every LoadImage node's `image` from a staging-relative ref path
    to a name uploaded to the remote ComfyUI (http transport). Mutates wf in
    place."""
    for node, relpath, src in _iter_workflow_refs(wf):
        try:
            node["inputs"]["image"] = comfy_upload_image(src.name, src.read_bytes())
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(
                f"Failed to upload reference image \"{relpath}\" to ComfyUI: {e}"
            ) from e


def _serverless_workflow_images(wf: dict) -> list[dict]:
    """Build RunPod's input.images[] from every LoadImage ref, rewriting each
    node's `image` to the bare filename the worker will save it under (serverless
    transport). Mirrors _upload_workflow_refs but base64-encodes the bytes into
    the job payload instead of POSTing them to /upload/image — the worker writes
    each {name, image} into ComfyUI's input dir before queuing the prompt, so the
    LoadImage name must match the images[] name. Mutates wf in place; returns the
    images list (deduped by name)."""
    images: list[dict] = []
    seen: set[str] = set()
    for node, relpath, src in _iter_workflow_refs(wf):
        name = os.path.basename(src.name) or "ref.png"
        node["inputs"]["image"] = name
        if name in seen:
            continue
        seen.add(name)
        try:
            b64 = base64.b64encode(src.read_bytes()).decode("ascii")
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(
                f"Failed to read reference image \"{relpath}\" for the RunPod "
                f"serverless job: {e}"
            ) from e
        images.append({"name": name, "image": b64})
    return images


def normalize_shape_ref(shape_ref_relpath: str) -> str:
    """Open the shape_ref PNG, find its non-black content bbox, and rebuild
    a 1024x1024 black canvas with the content centered at SHAPE_REF_FILL_PCT
    coverage. Saves to refs/_normalized/<name>.png and returns the new
    relative path for ComfyUI. Ensures every shape ref has consistent margin
    regardless of how the user painted it.

    The shape_ref may be a plain INPUT_DIR ref OR a Sheet-Maker `sheet_src/`
    key (a painted silhouette that lives under STAGING_ROOT, not INPUT_DIR, and
    on a cold project only in R2). Resolve it through the shared locator —
    which lazy-hydrates / by-key pulls the Sheet-Maker subtrees — so the Canny
    normalisation actually runs instead of silently passing the raw key
    through to a LoadImage node ComfyUI can't open."""
    src_path = _locate_ref_in_staging(shape_ref_relpath)
    if src_path is None:
        return shape_ref_relpath  # _upload_workflow_refs raises a clear error

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
    """Effective pipeline id for one region: its own 'pipeline' override (set in
    the advanced popup) if present, else the global/per-atlas PIPELINE.

    Returns the raw pipeline id string — a built-in keyword ('sdxl', 'flux',
    'gpt_image') OR a blueprint id (anything else). Callers branch on the three
    built-ins and treat any other value as a blueprint id (e.g.
    `_prepare_blueprint_models_or_fail`, which feeds it to `blueprints.get_blueprint`)."""
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


def _gpt_preset_for_ref(w: int, h: int) -> str:
    """Closest REAL OpenAIGPTImage1 preset to the reference's aspect ratio —
    the only sizes gpt-image-1 actually accepts. Square -> 1024x1024,
    clearly landscape -> 1536x1024, clearly portrait -> 1024x1536. Used so
    'match_ref' returns the right SHAPE without the (gpt-image-2-only) Custom
    size that the shipped node rejects. fit_to_region does the exact resize."""
    w = max(1, int(w))
    h = max(1, int(h))
    ratio = w / h
    if ratio >= 1.2:
        return "1536x1024"
    if ratio <= 1 / 1.2:
        return "1024x1536"
    return "1024x1024"


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
        # GPT 'transparent' (gpt-image-1) ALREADY returns an alpha-cut RGBA — the
        # downstream RMBG pass is redundant, and it would need an extra
        # 'Images to RGB' flatten node (custom pack) that isn't always installed.
        # Skip rembg and let GPT's transparent output be the saved result.
        rembg = False

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
    #   - blank / "match_ref" (the default)                    -> the closest
    #     REAL preset to the ORIGINAL REFERENCE's aspect (gpt-image-1), so GPT
    #     returns the right SHAPE without a forced square that fit_to_region
    #     then has to crop. gpt-image-2 (if/when it ships) instead gets a
    #     Custom size at the exact ref aspect.
    size_cfg = str(region.get("gpt_image_size") or GPT_IMAGE_SIZE or "").strip()
    if size_cfg in _GPT_PRESET_SIZES or size_cfg == "Custom":
        gpt_inputs["size"] = size_cfg
    elif size_cfg.lower() in _GPT_MATCH_REF:
        if model == "gpt-image-2":
            # gpt-image-2 (future) accepts a Custom size at the exact ref
            # aspect; only used when that model is explicitly selected.
            cw, ch = _gpt_custom_dims(*_gpt_ref_dims(ref, region))
            gpt_inputs["size"] = "Custom"
            gpt_inputs["custom_width"] = cw
            gpt_inputs["custom_height"] = ch
        else:
            # gpt-image-1 (shipped): pick the closest REAL preset to the ref
            # aspect instead of a forced square the slot then has to crop.
            gpt_inputs["size"] = _gpt_preset_for_ref(*_gpt_ref_dims(ref, region))
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


# The stored taxonomy, read once per batch rather than once per region. A batch renders
# many regions through this function and the file does not change mid-run; the TTL is
# only so a long-lived ui_server process picks up an edit without a restart.
_TAXONOMY_TTL_S = 60.0
_taxonomy_cache: dict = {"text": None, "at": 0.0}


def _shared_taxonomy_text() -> str:
    """The stored taxonomy, or "" when there is none / it cannot be read.

    Never raises. A taxonomy is an IMPROVEMENT on the bundled default, so an R2 hiccup
    must degrade to "render with the bundled vocabulary", never to "fail the render".
    """
    now = time.time()
    if _taxonomy_cache["text"] is not None and now - _taxonomy_cache["at"] < _TAXONOMY_TTL_S:
        return _taxonomy_cache["text"]
    text = ""
    try:
        stored, _etag = shared_taxonomy.load()
        text = stored or ""
    except Exception as exc:  # noqa: BLE001 — storage hiccup must not fail a render
        print(f"[taxonomy] could not read {shared_taxonomy.SHARED_TAXONOMY_KEY}: {exc}")
    _taxonomy_cache.update(text=text, at=now)
    return text


def _inject_shared_taxonomy(wf: dict) -> None:
    """Put the shared taxonomy on every node in `wf` that can take one."""
    text = _shared_taxonomy_text()
    if not text:
        return

    # Ask the target which classes actually declare the input. On the serverless
    # transport there is no live ComfyUI to ask, so this comes back unreadable and
    # `inject` falls to its graph-driven rule: fill the field only where the graph
    # ITSELF names it. That is the right fallback rather than a weakness — an API
    # export carries every widget the node had when it was exported, so the field's
    # presence in the graph IS the record of whether that pack knew about it.
    declares = None
    try:
        classes = {str(n.get("class_type") or "") for n in wf.values()
                   if isinstance(n, dict)}
        target = "serverless" if COMFY_TRANSPORT == "serverless" else "local"
        specs = comfy_specs.specs_for_classes(sorted(c for c in classes if c), target=target)
        if specs.get("ok"):
            known = specs.get("classes") or {}

            def declares(cls: str):  # noqa: F811 — deliberate: only when readable
                spec = known.get(cls)
                if spec is None:
                    return False  # the target answered, and does not have this class
                return shared_taxonomy.TAXONOMY_INPUT in spec
    except Exception as exc:  # noqa: BLE001 — a contract read must not fail a render
        print(f"[taxonomy] could not read node contracts ({exc}); "
              "falling back to the graph's own fields")

    try:
        touched = shared_taxonomy.inject(wf, text, declares_input=declares)
    except Exception as exc:  # noqa: BLE001
        print(f"[taxonomy] injection skipped: {exc}")
        return
    if touched:
        print(f"[taxonomy] applied the shared taxonomy to node(s) {', '.join(touched)}")


def _set_node_input(graph: dict, binding: dict | None, value) -> None:
    """Set graph[<node>].inputs[<field>] = value for one role binding. No-op if
    the binding is absent (optional role) or its node/field isn't in the graph
    (a graph that doesn't use that role just doesn't carry it). Tolerant by
    design: a blueprint is user-supplied data, so a stale binding shouldn't
    crash the run — the role simply doesn't get injected."""
    if not isinstance(binding, dict):
        return
    node_id = str(binding.get("node", "")).strip()
    field = str(binding.get("field", "")).strip()
    if not node_id or not field:
        return
    node = graph.get(node_id)
    if not isinstance(node, dict):
        return
    node.setdefault("inputs", {})[field] = value


def build_workflow_blueprint(
    region: dict, style: dict, blueprint: dict, overrides: dict | None = None
) -> tuple[dict, str]:
    """Generic, data-driven pipeline runner: drive ANY ComfyUI graph via its
    blueprint bindings instead of a hardcoded Python builder.

    `blueprint` is the loaded dict from blueprints.get_blueprint(): {id, graph,
    bindings, meta}. We deep-copy the API-format graph and apply the bindings
    (design §2):
      - positive/negative/seed via the SAME style+region combine + random-seed
        logic the sdxl branch of build_workflow uses (reused via _resolve_text);
      - width/height (when bound) from the configured generation size;
      - the style_ref / shape_ref LoadImage nodes get the region's staging ref
        path, so the existing _upload_workflow_refs uploads them unchanged;
      - the output (SaveImage) node's filename_prefix is set to this project's
        prefix, exactly like the built-in builders.

    Returns (wf, output_node_id) — run_region reads the result from
    output_node_id (the blueprint's bindings.output.node), generalizing the
    previously-hardcoded SaveImage node "17".
    """
    import copy

    bindings = blueprint.get("bindings") or {}
    wf = copy.deepcopy(blueprint.get("graph") or {})

    # Prompt / negative / seed — identical resolution to the sdxl branch.
    prompt, negative, seed = _resolve_text(region, style)
    _set_node_input(wf, bindings.get("positive"), prompt)
    _set_node_input(wf, bindings.get("negative"), negative)
    _set_node_input(wf, bindings.get("seed"), seed)

    # Generation size (only when the graph exposes width/height roles).
    _set_node_input(wf, bindings.get("width"), GEN_WIDTH)
    _set_node_input(wf, bindings.get("height"), GEN_HEIGHT)

    # Reference images — point the bound LoadImage node(s) at the region's ref.
    # The card gives a region ONE ref image (stored as `shape_ref`), but a
    # blueprint may bind `style_ref` (IP-Adapter/Redux appearance), `shape_ref`
    # (ControlNet silhouette), or both. Route the region's single ref to
    # WHICHEVER role the blueprint actually binds, so a card upload fills a
    # style-ref blueprint too — otherwise a bound-but-unfilled LoadImage keeps
    # the graph's baked authoring path (e.g. "pasted/image (4).png") and the run
    # dies in _upload_workflow_refs. style_ref = the raw image; shape_ref = the
    # normalized silhouette. A role the blueprint doesn't bind is a no-op.
    any_ref = (region.get("style_ref") or region.get("shape_ref")
               or (MOCKUP_IMAGE if MOCKUP_IMAGE else None))
    if any_ref and bindings.get("style_ref"):
        _set_node_input(wf, bindings.get("style_ref"), any_ref)
    shape_src = region.get("shape_ref") or region.get("style_ref")
    if shape_src and bindings.get("shape_ref"):
        _set_node_input(
            wf, bindings.get("shape_ref"), normalize_shape_ref(shape_src))

    # Safety net for a ref LoadImage the author never bound to a role: a path
    # under ComfyUI's `pasted/` or `clipspace/` scratch dirs is a pasted/clipboard
    # image baked into the graph at authoring time — NEVER a real project asset,
    # so _upload_workflow_refs can't resolve it and the run dies. If the region
    # supplied a ref, redirect any such still-baked node to it; otherwise leave
    # it for the clear "reference image not found" error.
    if any_ref:
        for _node in wf.values():
            if (not isinstance(_node, dict)
                    or _node.get("class_type") != "LoadImage"):
                continue
            _img = str((_node.get("inputs") or {}).get("image", "")
                       ).replace("\\", "/").lower()
            if _img.startswith("pasted/") or _img.startswith("clipspace/"):
                _node.setdefault("inputs", {})["image"] = any_ref

    # Exposed params ("general settings"): each declared param sets its EFFECTIVE
    # value onto its bound node input — a per-manifest override if present, else
    # the param's baked default. Coerced by the declared type. A blueprint with
    # no params, or no overrides, leaves the graph's baked values untouched (so
    # built-in/headless paths are byte-identical). Applied AFTER bindings so a
    # param can't accidentally clobber a role's injection (validation already
    # forbids targeting a role's (node, field)).
    ov = overrides if isinstance(overrides, dict) else {}
    for p in (blueprint.get("params") or []):
        if not isinstance(p, dict):
            continue
        key = str(p.get("key", "")).strip()
        if not key:
            continue
        raw = ov[key] if (key in ov and ov[key] not in ("", None)) else p.get("default")
        if raw is None:
            continue
        # Resolve the effective value with graceful fallback: a bad override
        # drops to the param's default; numeric values clamp to min/max; an
        # out-of-domain select falls back to the default. _UNSET => leave the
        # node input at whatever the graph shipped with (never inject garbage).
        value = _effective_param_value(p, raw)
        if value is _UNSET:
            continue
        _set_node_input(
            wf, {"node": p.get("node"), "field": p.get("field")}, value)

    # The shared semantic taxonomy, injected into any node that declares the input.
    # AFTER the params on purpose: a blueprint that states its own taxonomy (as a param
    # or a baked value) keeps it, and a param the artist CLEARED falls back to the stored
    # one rather than to an empty vocabulary.
    _inject_shared_taxonomy(wf)

    # Output: set the SaveImage filename_prefix to this project's prefix (same
    # as the builders) and resolve the node id run_region reads from.
    out_binding = bindings.get("output") or {}
    out_node_id = str(out_binding.get("node", "")).strip() or "17"
    out_node = wf.get(out_node_id)
    if isinstance(out_node, dict):
        out_node.setdefault("inputs", {})["filename_prefix"] = (
            f"{COMFY_PREFIX_BASE}/batch/{region['name']}")

    return wf, out_node_id


# Serializes the snapshot/apply/restore of the manifest-settings module globals
# below. `build_workflow_blueprint` reads a few plain module globals
# (GEN_WIDTH/GEN_HEIGHT/MOCKUP_IMAGE) that `apply_manifest_settings` mutates.
# In the ui_server process (ThreadingHTTPServer = one thread per request) the
# resolved-workflow export runs IN-PROCESS, concurrently with other request
# threads — so two requests applying different manifests would clobber each
# other's globals mid-resolve. We hold this lock for the whole apply→build→
# restore window so a real run/another export can't observe a half-applied
# state. COMFY_PREFIX_BASE is a thread-local _StrProxy (safe already) and the
# (client,project) path context is the caller's thread-local, untouched here.
_RESOLVE_GLOBALS_LOCK = threading.Lock()


def _binding_source_labels(blueprint: dict) -> dict:
    """(node_id, field) -> human source label, derived from a blueprint's
    bindings + params. Used by the resolved-workflow diff to say WHAT drove each
    changed input: a role name (positive/negative/seed/width/height/style_ref/
    shape_ref/output), `param:<key>`, or — for the SaveImage prefix — set by the
    caller. A node/field can be driven by at most one binding OR one param
    (validation forbids double-drive), so this map is unambiguous."""
    out: dict = {}
    bindings = blueprint.get("bindings") or {}
    for role, b in bindings.items():
        if role == "output" or not isinstance(b, dict):
            continue
        n = str(b.get("node", "")).strip()
        f = str(b.get("field", "")).strip()
        if n and f:
            out[(n, f)] = role
    for p in (blueprint.get("params") or []):
        if not isinstance(p, dict):
            continue
        n = str(p.get("node", "")).strip()
        f = str(p.get("field", "")).strip()
        key = str(p.get("key", "")).strip()
        if n and f and key:
            out[(n, f)] = f"param:{key}"
    return out


def _node_title(node: dict, fallback: str = "") -> str:
    """A node's display title: its `_meta.title` if present, else its
    `class_type`. Mirrors the loader's `bpNodeOpt` titling so the diff table and
    the binder dropdown name the same node identically."""
    if not isinstance(node, dict):
        return fallback
    meta = node.get("_meta")
    if isinstance(meta, dict):
        t = str(meta.get("title", "")).strip()
        if t:
            return t
    return str(node.get("class_type", "")).strip() or fallback


def resolve_blueprint_workflow(
    manifest: dict, region_name: str | None = None,
    blueprint_id: str | None = None,
) -> tuple[dict, str, list[dict]]:
    """Resolve the EXACT API/prompt graph a real run POSTs to ComfyUI for one
    region, plus a baked→injected changes diff. The single source of truth is
    `build_workflow_blueprint` (no duplicated injection logic) — the returned
    graph is byte-identical to what generation sends.

    Returns (wf, output_node_id, changes). `changes` is a list of
    {node, title, field, baked, resolved, source} for every scalar input that
    the pipeline set differently from (or in addition to) the baked blueprint
    graph. Wired links (array-valued inputs) are skipped.

    Faithful gen size + settings: a real run is a FRESH subprocess import (so
    its CFG-derived globals are current) that then calls
    `apply_manifest_settings`, overlaying `manifest["settings"]` onto the module
    globals the runner reads (GEN_WIDTH/GEN_HEIGHT/MOCKUP_IMAGE/PIPELINE/…). We
    replicate BOTH halves here, in that order — `refresh_config_globals()` stands
    in for the fresh import, then the manifest overlay goes on top, because this
    process imported once and its snapshot belongs to another era and possibly
    another project (see that function). Under
    `_RESOLVE_GLOBALS_LOCK`, snapshotting EVERY settings-driven global (plus
    ATLAS_META, used by other resolvers) and restoring them in `finally` — so a
    concurrent request never sees a half-applied state and the export reflects
    THIS manifest's gen size, not the process default. Overrides are passed
    explicitly to the runner (not via the BP_PARAM_OVERRIDES global), matching
    how main() reads them but avoiding that shared mutable global entirely.
    Raises ValueError with a readable message on any user-facing problem."""
    import copy

    if not isinstance(manifest, dict):
        raise ValueError("manifest is not an object")
    style = manifest.get("style") or {}

    with _RESOLVE_GLOBALS_LOCK:
        # Snapshot the globals a real run mutates, apply this manifest's
        # settings, then restore in finally — the whole window is locked.
        snapshot = {gname: globals().get(gname)
                    for gname in _SETTINGS_GLOBALS.values()}
        atlas_meta_snapshot = dict(ATLAS_META)
        try:
            ATLAS_META.clear()
            ATLAS_META.update(manifest.get("atlas") or {})
            refresh_config_globals()
            apply_manifest_settings(manifest)

            # The region list a real run would build (atlas-bound vs creative).
            regions = list(manifest.get("regions") or [])

            # Pick the region: by name, else the first non-hidden region (the
            # default selection a run starts from).
            region = None
            if region_name:
                region = next(
                    (r for r in regions if r.get("name") == region_name), None)
                if region is None:
                    raise ValueError(
                        f"region '{region_name}' not found in this manifest")
            else:
                region = next(
                    (r for r in regions
                     if not r.get("skip_unless_explicit")), None)
                if region is None and regions:
                    region = regions[0]
            if region is None:
                raise ValueError("this manifest has no regions to resolve")

            # Blueprint id: explicit arg, else the region's effective pipeline,
            # else the manifest's active pipeline (apply_manifest_settings put it
            # on PIPELINE). A built-in keyword is not a blueprint.
            bp_id = (blueprint_id or "").strip() or region_pipeline(region)
            if str(bp_id).lower() in ("sdxl", "flux", "gpt_image"):
                raise ValueError(
                    f"pipeline '{bp_id}' is a built-in (hardcoded Python "
                    "builder), not a blueprint — resolved-workflow export "
                    "applies to blueprint pipelines only")
            blueprint = blueprints.get_blueprint(bp_id)
            if not blueprint:
                raise ValueError(
                    f"blueprint '{bp_id}' not found in the shared library")

            # Overrides EXACTLY as main() loads them: main() reads
            # settings.bpParams[<active GLOBAL pipeline>] into BP_PARAM_OVERRIDES
            # (apply_manifest_settings just put that pipeline on PIPELINE) and
            # feeds the SAME dict to every region — regardless of a per-region
            # `pipeline` override. So key overrides by the active pipeline, NOT
            # by bp_id, or the export would diverge from a real run for a region
            # whose pipeline differs from the manifest's. Passed explicitly so we
            # never touch the BP_PARAM_OVERRIDES global.
            active_pipe = str(PIPELINE).strip().lower()
            overrides = ((manifest.get("settings") or {})
                         .get("bpParams") or {}).get(active_pipe)
            if not isinstance(overrides, dict):
                overrides = None

            baked = copy.deepcopy(blueprint.get("graph") or {})
            wf, out_node_id = build_workflow_blueprint(
                region, style, blueprint, overrides)
        finally:
            for gname, val in snapshot.items():
                globals()[gname] = val
            ATLAS_META.clear()
            ATLAS_META.update(atlas_meta_snapshot)

    # Diff baked vs resolved — scalar inputs only (skip wired array links).
    sources = _binding_source_labels(blueprint)
    out_binding = (blueprint.get("bindings") or {}).get("output") or {}
    out_node = str(out_binding.get("node", "")).strip() or out_node_id
    changes: list[dict] = []
    for node_id, node in wf.items():
        if not isinstance(node, dict):
            continue
        r_inputs = node.get("inputs") or {}
        b_node = baked.get(node_id) if isinstance(baked.get(node_id), dict) else {}
        b_inputs = b_node.get("inputs") or {}
        title = _node_title(node, fallback=str(node_id))
        for field, r_val in r_inputs.items():
            if isinstance(r_val, list):
                continue  # wired link, not a scalar the runner sets
            b_val = b_inputs.get(field, _UNSET)
            if b_val is not _UNSET and b_val == r_val:
                continue  # unchanged
            if (node_id, field) in sources:
                source = sources[(node_id, field)]
            elif node_id == out_node and field == "filename_prefix":
                source = "filename_prefix"
            elif b_val is _UNSET:
                source = "new"
            else:
                source = ""
            changes.append({
                "node": str(node_id),
                "title": title,
                "field": field,
                "baked": (None if b_val is _UNSET else b_val),
                "resolved": r_val,
                "source": source,
            })
    return wf, out_node_id, changes


def build_workflow(region: dict, style: dict, atlas_path: str) -> dict:
    pipe = region_pipeline(region)
    if pipe == "gpt_image":
        return build_workflow_gpt(region, style)
    if pipe == "flux":
        return build_workflow_flux(region, style, atlas_path)
    # Atlas-bound regions come from the .atlas with no creative entry yet, so
    # 'prompt' may be absent — treat missing/empty as "no region prompt".
    # Positive/negative/seed: shared with the blueprint runner (single source
    # of truth) — prefix/suffix combine, region-appends-or-replaces-global
    # negative, and a per-region seed lock else random.
    prompt, negative, seed = _resolve_text(region, style)

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

    # IPAdapter style transfer is opt-in: a region's own style_ref, else the
    # global mockup_image if one is configured. With neither set there is no
    # style reference, so we skip the IPAdapter chain entirely (nodes 3/5/6)
    # and the KSampler reads the model straight from the LoRA loader — mirrors
    # how the FLUX builder treats Redux. No hardcoded mockup default.
    style_ref = region.get("style_ref") or (MOCKUP_IMAGE if MOCKUP_IMAGE else None)
    use_ipa = bool(style_ref)
    model_link = ["6", 0] if use_ipa else ["2", 0]

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
        "12": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": GEN_WIDTH, "height": GEN_HEIGHT, "batch_size": 1},
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
                "model": model_link,
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
        "17": {
            "class_type": "SaveImage",
            "inputs": {
                "images": ["14", 0],
                "filename_prefix": f"{COMFY_PREFIX_BASE}/batch/{region['name']}",
            },
        },
    }

    # RMBG cutout is opt-out: ON (default) for transparent icons; OFF keeps the
    # opaque render for full-bleed backgrounds. When on, the save reads the
    # cutout (node 16) instead of the raw VAE decode (node 14). _truthy on both
    # levels so a per-atlas override stored as "on"/"off" is read correctly.
    if _truthy(region.get("rembg"), _truthy(REMBG, True)):
        wf["16"] = {
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
        }
        wf["17"]["inputs"]["images"] = ["16", 0]

    if use_ipa:
        # IPAdapterAdvanced only accepts weight in [-1, 5]; an out-of-range
        # value makes ComfyUI reject the whole prompt (HTTP 400). Clamp + warn.
        ipa_weight = float(region.get("ipadapter_weight", IPADAPTER_WEIGHT))
        if not -1.0 <= ipa_weight <= 5.0:
            clamped = max(-1.0, min(5.0, ipa_weight))
            print(f"  ! ipadapter_weight {ipa_weight} for region "
                  f"'{region.get('name', '?')}' is out of range [-1, 5]; "
                  f"clamped to {clamped}", flush=True)
            ipa_weight = clamped
        wf["3"] = {"class_type": "LoadImage", "inputs": {"image": style_ref}}
        wf["5"] = {
            "class_type": "IPAdapterUnifiedLoader",
            "inputs": {"model": ["2", 0], "preset": "PLUS (high strength)"},
        }
        wf["6"] = {
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
    wf["17"] = {
        "class_type": "SaveImage",
        "inputs": {"images": ["14", 0],
                   "filename_prefix": f"{COMFY_PREFIX_BASE}/batch/{region['name']}"},
    }
    # RMBG cutout is opt-out (see build_workflow): OFF keeps the opaque render
    # for full-bleed backgrounds; ON (default) saves the transparent cutout.
    if _truthy(region.get("rembg"), _truthy(REMBG, True)):
        wf["16"] = {
            "class_type": "RMBG",
            "inputs": {
                "image": ["14", 0], "model": RMBG_MODEL, "sensitivity": 1.0,
                "process_res": 1024, "mask_blur": 0, "mask_offset": 0,
                "invert_output": False, "background": "Alpha",
            },
        }
        wf["17"]["inputs"]["images"] = ["16", 0]
    return wf


# --------------------------------------------------------------------------
# RunPod Serverless transport (COMFY_TRANSPORT=serverless).
#
# Instead of a live ComfyUI over the tunnel, submit the api-prompt graph to a
# RunPod Serverless endpoint: POST {base}/run with {input:{workflow, images}},
# then poll {base}/status/{id}. The worker uploads images[], queues the prompt,
# polls history and returns {images:[{filename, image:<b64>}]} — decoded here
# and fed into the SAME _persist_variant path the http transport uses. See
# docs/design/comfyui-serverless.md and services/atlas-serverless/handler.py.
# --------------------------------------------------------------------------
# Marker line carrying the in-flight RunPod job id to the UI process, which
# cannot otherwise know it. `ui_server.stop_render` reads it so Stop can cancel
# the REMOTE job, not just the local poller.
RUNPOD_JOB_MARK = "@@RUNPOD_JOB@@"
# How long a run of UNREADABLE status polls is tolerated before a job is given
# up on, and the shorter budget for a run of 404s — a job RunPod has no record of,
# which is an ANSWER rather than a failure to answer. Same values and the same
# reasoning as the video runner's (`video_runner.py`), restated here because that
# module imports THIS one, not the other way round.
STATUS_GRACE_SECONDS = 180.0
NOT_FOUND_GRACE_SECONDS = 15.0


def runpod_cancel(job_id: str) -> str:
    """Ask RunPod to cancel `job_id`. Returns "" on success, else a reason.

    Called from the UI process on Stop. Best-effort by design: a cancel that
    fails must not stop us terminating the local subprocess."""
    if not (job_id or "").strip():
        return "no job id"
    try:
        _runpod_post(f"/cancel/{job_id.strip()}", {})
        return ""
    except Exception as e:  # noqa: BLE001 - report, never raise into Stop
        return f"{type(e).__name__}: {e}"


class RunPodHTTPError(RuntimeError):
    """RunPod answered with an HTTP error status, which is KEPT on the exception.

    The code matters because 404 is not the same kind of answer as the rest. A 5xx
    is a failure to answer — the job carries on and the next poll may well read it.
    A 404 on `/status/<id>` is an answer: RunPod has no record of that job. It drops
    a finished job's record about half an hour after it completes, so 404 usually
    means the render finished while nothing was watching it, not that anything is
    unreachable. Callers that must tell those apart read `.code`; the message is
    unchanged, so callers that don't still behave exactly as before.
    """

    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code


def _runpod_endpoint_base() -> str:
    eid = (os.environ.get("RUNPOD_ENDPOINT_ID") or "").strip()
    if not eid:
        raise RuntimeError(
            "COMFY_TRANSPORT=serverless but RUNPOD_ENDPOINT_ID is not set. "
            "Set the RunPod endpoint id in the atlas-tool env, then retry.")
    return f"https://api.runpod.ai/v2/{eid}"


def _runpod_headers() -> dict:
    key = (os.environ.get("RUNPOD_API_KEY") or "").strip()
    if not key:
        raise RuntimeError(
            "COMFY_TRANSPORT=serverless but RUNPOD_API_KEY is not set. "
            "Set the RunPod API key in the atlas-tool env, then retry.")
    return {"Authorization": f"Bearer {key}", "User-Agent": "InvisibleAtlas/1.0"}


def _runpod_post(path: str, payload: dict) -> dict:
    base = _runpod_endpoint_base()
    req = Request(
        f"{base}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **_runpod_headers()},
        method="POST",
    )
    try:
        with urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RunPodHTTPError(
            e.code, f"RunPod {path} failed: HTTP {e.code} {e.reason}: {body[:500]}")
    except (URLError, ConnectionError, OSError) as e:
        raise RuntimeError(f"Cannot reach RunPod endpoint at {base}{path}: {e}")


def _runpod_get(path: str) -> dict:
    base = _runpod_endpoint_base()
    req = Request(f"{base}{path}", headers=_runpod_headers())
    try:
        with urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RunPodHTTPError(
            e.code, f"RunPod {path} failed: HTTP {e.code} {e.reason}: {body[:500]}")
    except (URLError, ConnectionError, OSError) as e:
        raise RuntimeError(f"Cannot reach RunPod endpoint at {base}{path}: {e}")


def _runpod_run_and_wait(job: dict, region_name: str) -> dict:
    """Submit a job to /run and poll /status until it finishes. Returns the
    worker's `output` on COMPLETED; raises a clear RuntimeError on
    FAILED/CANCELLED/TIMED_OUT (with any error detail) and TimeoutError on the
    overall cap. IN_QUEUE / IN_PROGRESS mean keep waiting (cold starts load
    models to VRAM, so allow ~30 min).

    An unreadable poll is not a failed job — the same lesson the video path had to
    learn twice. RunPod's status API returns the odd 500, and a job it has not
    indexed yet 404s for a beat, and BOTH used to raise straight out of this loop
    and fail a region whose render was still going (and still billing). Reads are
    tolerated for `STATUS_GRACE_SECONDS` of continuous failure. There is no
    hand-off slot to rescue from on the still path — this transport returns its
    image through RunPod — so a genuinely lost job is still a lost render here."""
    resp = _runpod_post("/run", job)
    jid = resp.get("id")
    if not jid:
        raise RuntimeError(f"RunPod /run did not return a job id: {resp}")
    # Announce the job id on a machine-readable line so the UI can CANCEL it if
    # the user presses Stop. Killing this subprocess only stops the polling —
    # the worker keeps rendering and billing unless RunPod is told. The worker
    # is already built to notice (handler.py `_job_cancelled`); nobody was
    # telling it.
    print(f"{RUNPOD_JOB_MARK}{jid}", flush=True)
    deadline = time.time() + 1800  # 30 min cap — cold start + model load + gen
    started = time.time()
    last_tick = started
    unreadable_since = 0.0
    last_read_error = ""
    ever_read = False
    only_not_found = True
    while time.time() < deadline:
        time.sleep(2.0)
        now = time.time()
        try:
            st = _runpod_get(f"/status/{jid}")
        except Exception as e:  # noqa: BLE001 — a bad READ is not a bad job
            last_read_error = str(e)
            if not unreadable_since:
                unreadable_since = now
                only_not_found = True
            only_not_found = only_not_found and getattr(e, "code", None) == 404
            # A 404 on a job we HAVE read is an answer: RunPod drops a finished
            # job's record after ~30 min, so there is nothing left to wait for. A
            # 404 before any successful read is just a job not indexed yet, and a
            # run that stops being 404-only is an unreadable API again — so the
            # latch, and the fall back to the long grace, both matter.
            gone = only_not_found and ever_read
            grace = NOT_FOUND_GRACE_SECONDS if gone else STATUS_GRACE_SECONDS
            if now - unreadable_since < grace:
                if now - last_tick >= 15:
                    print(f"   ... serverless job {jid} unreadable, retrying "
                          f"({int(now - unreadable_since)}s)")
                    last_tick = now
                continue
            if gone:
                # No cancel: asking RunPod to stop a job it has no record of is
                # just a second 404 (`video_runner._await_job` says the same).
                emit(diag("RUNPOD_STATUS_UNREADABLE", CATALOG, name=region_name,
                          msg="the job record has expired"))
                raise RuntimeError(
                    f"RunPod no longer has a record of job {jid} for region "
                    f"'{region_name}', so its result is gone (a finished job is "
                    f"dropped after about half an hour)")
            why = runpod_cancel(jid)
            emit(diag("RUNPOD_STATUS_UNREADABLE", CATALOG, name=region_name,
                      msg=last_read_error[:300]))
            raise RuntimeError(
                f"RunPod job {jid} for region '{region_name}': lost contact for "
                f"{int(now - unreadable_since)}s, so it was stopped — "
                f"{last_read_error[:300]}"
                + (f" (and RunPod would not cancel it: {why} — it may still be "
                   f"running and billing)" if why else ""))
        unreadable_since = 0.0
        ever_read = True
        status = str(st.get("status") or "").upper()
        if status == "COMPLETED":
            return st.get("output") or {}
        if status in ("FAILED", "CANCELLED", "TIMED_OUT"):
            detail = st.get("error") or st.get("output") or st
            emit(diag("COMFY_NODE_FAILED", CATALOG, name=region_name,
                      node="runpod", msg=f"job {status}: {detail}"))
            raise RuntimeError(
                f"RunPod job {jid} for region '{region_name}' ended {status}: "
                f"{detail}")
        if now - last_tick >= 15:
            print(f"   ... serverless job {jid} {status or 'PENDING'} "
                  f"({int(now - started)}s elapsed)")
            last_tick = now
    emit(diag("COMFY_TIMEOUT", CATALOG, name=region_name))
    raise TimeoutError(
        f"RunPod job {jid} for region '{region_name}' timed out after 30 min")


def _next_variant_filename(region_name: str) -> str:
    """ComfyUI names saves with an incrementing per-output counter, but each
    serverless job hits a FRESH worker whose counter restarts at 00001 — so every
    variant of a region would collide on '<region>_00001_.png' and overwrite the
    last. Mirror ComfyUI's scheme locally: the region's highest existing id in the
    batch dir + 1, keeping the '<region>_<NNNNN>_.png' shape the gallery globs for."""
    mx = 0
    pat = re.compile(rf"^{re.escape(region_name)}_(\d+)_?\.png$", re.IGNORECASE)
    try:
        for p in BATCH_DIR.glob(f"{region_name}_*.png"):
            m = pat.match(p.name)
            if m:
                mx = max(mx, int(m.group(1)))
    except Exception:  # noqa: BLE001
        pass
    return f"{region_name}_{mx + 1:05d}_.png"


def _run_region_serverless(region: dict, wf: dict) -> Image.Image:
    """Run one region through the RunPod Serverless transport. Base64-encodes
    the LoadImage refs into input.images[] (same names the http path uploads),
    submits the identical api-prompt graph, decodes the returned base64 image and
    persists it via the SAME _persist_variant path the http transport uses."""
    images = _serverless_workflow_images(wf)
    out = _runpod_run_and_wait(
        {"input": {"workflow": wf, "images": images}}, region["name"])
    # The worker can report a graph/execution failure as {"error", "detail"}
    # inside `output` on an otherwise-COMPLETED job — surface it as a clear error
    # rather than the generic "no images" below.
    if isinstance(out, dict) and out.get("error"):
        detail = out.get("detail")
        emit(diag("COMFY_NODE_FAILED", CATALOG, name=region["name"],
                  node="runpod", msg=str(out.get("error"))))
        raise RuntimeError(
            f"RunPod serverless job for region '{region['name']}' failed: "
            f"{out.get('error')}" + (f" ({detail})" if detail else ""))
    out_images = (out or {}).get("images") or []
    if not out_images:
        emit(diag("COMFY_NODE_FAILED", CATALOG, name=region["name"],
                  node="runpod", msg="serverless job returned no images"))
        raise RuntimeError(
            f"RunPod serverless job for region '{region['name']}' returned no "
            f"images (output={out!r}).")
    rname = region["name"]
    # Prefer the SaveImage output (its worker filename is region-prefixed) over any
    # preview/temp image the graph may also emit, so we don't persist a preview.
    saves = [im for im in out_images
             if str(im.get("filename", "")).lower().startswith(rname.lower() + "_")]
    chosen = (saves or out_images)[0]
    b64 = chosen.get("image")
    if not b64:
        raise RuntimeError(
            f"RunPod serverless job for region '{rname}' returned an "
            f"image entry with no base64 data: {chosen!r}")
    blob = base64.b64decode(b64)
    # Assign a UNIQUE name per variant — every serverless job hits a fresh worker
    # whose ComfyUI counter restarts at 00001, so reusing the worker filename makes
    # all variants collide on '<region>_00001_.png' and overwrite each other. The
    # next-free local id (mirrors ComfyUI's counter) keeps every variant, and the
    # PNG still carries its embedded seed so lock / Create Atlas work unchanged.
    filename = _next_variant_filename(rname)
    _persist_variant(rname, filename, blob)
    return Image.open(io.BytesIO(blob)).convert("RGBA")


def run_region(region: dict, style: dict, atlas_path: str, client_id: str) -> Image.Image:
    # Pipeline dispatch: the three built-ins (sdxl/flux/gpt_image) use the
    # proven hardcoded Python builders with the historical SaveImage node "17".
    # Anything else is treated as a blueprint id — if one exists in the shared
    # library, drive its graph via the generic, data-driven runner instead. The
    # selection stays config-driven (the region/atlas `pipeline` value); a
    # missing blueprint falls through to build_workflow, which then runs the
    # default sdxl path (region_pipeline isn't one of the three -> sdxl branch).
    pipe = region_pipeline(region)
    out_node = "17"
    if pipe in ("sdxl", "flux", "gpt_image"):
        wf = build_workflow(region, style, atlas_path)
    else:
        # A non-built-in pipeline id is a blueprint. If it won't load we must
        # NOT silently fall back to build_workflow (the built-in SDXL path):
        # that quietly generates convincing-but-wrong art from the WRONG
        # pipeline, so a user who selected a blueprint gets SDXL with no hint
        # (exactly this bug — a FLUX blueprint that silently rendered SDXL).
        # Fail loudly and point at the reason instead.
        bp = blueprints.get_blueprint(pipe)
        if bp is None:
            raise RuntimeError(
                f"Pipeline '{pipe}' is a blueprint, but it could not be loaded "
                f"from the shared library — so this region did NOT run your "
                f"blueprint. Refusing to silently generate with the built-in "
                f"SDXL pipeline instead. Likely causes: the blueprint failed "
                f"validation on load (look above for a '[blueprints] invalid "
                f"{pipe}: …' or '[blueprints] skipped {pipe}: …' line naming the "
                f"exact reason), or it isn't published to the shared library / "
                f"didn't hydrate. Fix or re-import the blueprint, or pick a "
                f"valid pipeline, then retry.")
        wf, out_node = build_workflow_blueprint(
            region, style, bp, BP_PARAM_OVERRIDES)
    # Last gate before the graph costs anything — covers the built-in pipelines
    # and blueprints alike, whatever produced the empty name.
    assert_models_named(wf)
    # …and that the graph's node TYPES exist on the target at all. One small
    # probe per distinct class, cached, so only the first region pays.
    assert_nodes_installed(wf)
    # …and that the files those nodes NAME are on the target. Free: it reads the
    # /object_info entries the call above already fetched.
    assert_graph_models_present(wf)
    # Serverless transport: submit the SAME api-prompt graph as a RunPod job
    # (base64 refs in, base64 image out) instead of talking to a live ComfyUI.
    if COMFY_TRANSPORT == "serverless":
        return _run_region_serverless(region, wf)
    # Cloud: the remote ComfyUI can't read our staging refs — upload each
    # LoadImage source first and rewrite the node to the uploaded name.
    _upload_workflow_refs(wf)
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
                ml = (msg or "").lower()
                if msg and ("login" in ml or "unauthor" in ml):
                    emit(diag("COMFY_AUTH", CATALOG))
                elif msg and ("payment required" in ml
                              or "add credits" in ml
                              or "insufficient" in ml
                              or "quota" in ml):
                    emit(diag("COMFY_PAYMENT", CATALOG, name=region["name"]))
                else:
                    emit(diag("COMFY_NODE_FAILED", CATALOG,
                              name=region["name"], node=node,
                              msg=msg or "unknown error"))
                raise RuntimeError(
                    f"ComfyUI failed on region '{region['name']}' at node "
                    f"{node}: {msg or 'unknown error'}")
            saves = entry.get("outputs", {}).get(out_node, {}).get("images", [])
            if saves:
                meta = saves[0]
                blob = comfy_view(meta["filename"], meta["subfolder"], meta["type"])
                # Cloud: ComfyUI saved the variant to ITS OWN disk (remote), so it
                # won't appear in our staging BATCH_DIR the way the shared-FS local
                # setup assumed. Persist the fetched bytes (PNG keeps its embedded
                # seed metadata) into staging BATCH_DIR — so the gallery's variant
                # globbing/seed-reading works unchanged — and mirror to R2.
                _persist_variant(region["name"], meta["filename"], blob)
                return Image.open(io.BytesIO(blob)).convert("RGBA")
    emit(diag("COMFY_TIMEOUT", CATALOG, name=region["name"]))
    raise TimeoutError(f"Region {region['name']} timed out after 20 min")


def _persist_variant(region_name: str, filename: str, blob: bytes) -> None:
    try:
        BATCH_DIR.mkdir(parents=True, exist_ok=True)
        fname = os.path.basename(filename) or f"{region_name}_view.png"
        dest = BATCH_DIR / fname
        dest.write_bytes(blob)
        # Resolve the prefixes live (thread-local context) rather than the
        # import-time _PP snapshot, so a UI-process call reflects the calling
        # thread's project (the generate subprocess has a single env context).
        _pp = project_paths.resolve()
        r2_prefix = _pp.get("r2_project_prefix")
        if r2_prefix:
            try:
                import storage
                # Unified layout: variants live at <C>/<P>/batch (the old
                # output/<P> nesting is gone — matches cloud_paths batch_dir).
                storage.put(
                    f"{r2_prefix}/batch/{fname}", blob, "image/png"
                )
            except Exception:  # noqa: BLE001 — R2 mirror is best-effort
                pass
    except Exception as e:  # noqa: BLE001
        print(f"[persist] variant write failed: {e}", flush=True)


# PADDING_PCT and SHAPE_REF_FILL_PCT are loaded from atlas_config.json at top.


def _packer_compose_tile(img: Image.Image, rw: int, rh: int,
                         rotated: bool) -> Image.Image:
    """Byte-for-byte replica of sheet-tool `packer.compose`'s per-region paste.

    A Sheet-Maker-authored cell is packed by packer.compose and the rig is
    authored against THAT page, so a rebuild here must reproduce the placement
    exactly — any divergence in scale, centring or rounding silently re-offsets
    every attachment on republish. Keep the two in lockstep; if packer.compose
    changes, change this with it.
    """
    nw, nh = img.width, img.height
    if nw > 0 and nh > 0:
        # The 1.0 clamp is packer's contract: art is never upscaled/stretched,
        # a larger cell just gains transparent margin.
        scale = min(rw / nw, rh / nh, 1.0)
        iw = max(1, round(nw * scale))
        ih = max(1, round(nh * scale))
    else:
        iw, ih = rw, rh
    if (img.width, img.height) != (iw, ih):
        img = img.resize((iw, ih), Image.LANCZOS)
    if (rw, rh) != (iw, ih):
        # Centre the VISIBLE art (its bounding box), not the image rectangle.
        # Rotated cells fall back to rectangle centring (the bbox would be in
        # pre-rotation space). crop() pads the window with transparent pixels.
        bbox = None if rotated else img.getbbox()
        if bbox:
            cw, ch = bbox[2] - bbox[0], bbox[3] - bbox[1]
            ox = (rw - cw) // 2 - bbox[0]
            oy = (rh - ch) // 2 - bbox[1]
            img = img.crop((-ox, -oy, -ox + rw, -oy + rh))
        else:
            tile = Image.new("RGBA", (rw, rh), (0, 0, 0, 0))
            tile.alpha_composite(img, ((rw - iw) // 2, (rh - ih) // 2))
            img = tile
    if rotated:
        img = img.rotate(-90, expand=True)  # clockwise
    return img


def _fx_parity_tile(img: Image.Image, rw: int, rh: int, rotated: bool,
                    place: dict) -> Image.Image:
    """Place an FX layer on the sheet-parity path by its BASE's transform.

    `_packer_compose_tile` centres a cell on its OWN visible bbox, which is the
    right answer for a cell that stands alone and the wrong one for an FX layer:
    an FX layer's position is not its own, it is its base's (the same premise as
    `fx_registration_crop`, which is why the legacy path crops it to a
    base-derived box). For every SYMMETRIC effect the two answers coincide — a
    glow's halo is concentric with the glyph it grew from, so its own bbox
    centre IS its base's. For the one asymmetric effect, `shine.make_shadow`,
    they do not: the drop is carried by where the blob sits relative to the
    glyph, and centring the blob's bbox is precisely the operation that throws
    that away.

    `place` comes from `fx_registration` and says, in FX-canvas coordinates:
      scale   the factor the BASE's canvas gets (its rect / its canvas, never
              upscaling) — used here INSTEAD of this layer's own, so the two
              layers land at one pixel scale however much margin this one's
              canvas carries;
      anchor  the base's ink-bbox centre;
      rel     where that centre lands inside the rect, normalised — 0.5 when the
              base is bbox-centred, and its verbatim position when the base's
              scaled canvas exactly fills its rect (in which case nothing is
              re-centred at all and this reduces to a straight paste).

    Only reached when `fx_registration` says this layer's ink DISAGREES with its
    base's; everything that agrees goes to `_packer_compose_tile` untouched, so
    the parity contract is kept exactly rather than reproduced.

    A ROTATED cell is placed by its canvas, not by the anchor — packer centres a
    rotated cell's rectangle (a bbox would be in pre-rotation space), so that is
    what its base got and what registers with it. The canvas is concentric with
    the base's by construction, so this still carries the drop.
    """
    s = place["scale"]
    iw = max(1, round(img.width * s))
    ih = max(1, round(img.height * s))
    if (img.width, img.height) != (iw, ih):
        img = img.resize((iw, ih), Image.LANCZOS)
    if rotated:
        ox, oy = (rw - iw) // 2, (rh - ih) // 2
    else:
        ax, ay = place["anchor"]
        ox = int(round(rw * place["rel"][0] - ax * s))
        oy = int(round(rh * place["rel"][1] - ay * s))
    if (ox, oy) != (0, 0) or (rw, rh) != (iw, ih):
        img = img.crop((-ox, -oy, -ox + rw, -oy + rh))
    if rotated:
        img = img.rotate(-90, expand=True)  # clockwise
    return img


def fit_to_region(img: Image.Image, region: dict,
                  crop_box: tuple[int, int, int, int] | None = None,
                  fx_place: dict | None = None) -> Image.Image:
    """Place the regenerated element into its packed slot.

    The element is cropped to its ALPHA content (Spine only ever renders the
    alpha channel — using the RGBA bbox here wrongly kept the webp page's
    colored-but-transparent gutter, which then got letterbox-inset and made
    trimmed elements render small in-game).

    `crop_box` overrides that self-derived alpha bbox. It exists for FX layers
    (`<base>_glow`, ...), whose own alpha bbox is DELIBERATELY bigger than
    their base's (the halo blooms past the glyph) — cropping them to it would
    scale the glyph down relative to its base and break registration. See
    fx_registration_crop, which builds the box from the BASE's bbox instead.

    For a Spine/.atlas slot the packed (w, h) IS the element's authored
    footprint (true for EVERY region, trimmed or not — `helmet` is untrimmed
    but still occupies an exact 360x198 slot the rig expects filled), and the
    game's `.atlas` is never rewritten, so the faithful reproduction is to
    fill the slot exactly — NOT letterbox to preserve the new art's own
    aspect (that shrinks the element in-game). Only true legacy cell-grid
    projects (manifest regions with no bound `.atlas`, hence no orig_*
    geometry) keep the old aspect-pad behaviour so they don't regress.

    An EXPLICIT `fit_mode: "contain"` (the Sheet Maker writes it on every cell,
    and the 🖼 To Atlas Maker export stamps the author's `fit` choice) marks a
    cell that packer.compose packed and the rig was authored against, so it
    takes a separate sheet-parity path that replays packer.compose verbatim (no
    alpha-crop, no padding, never upscale, centre the visible bbox). That is NOT
    the same `contain` the default fallback picks for a legacy cell-grid region,
    which keeps its alpha-crop + letterbox behaviour unchanged.

    `atlas.pack_trim` (see `keep_full_frame`) decides WHAT is being placed;
    `fit_mode` decides HOW it maps into the rect. The two are orthogonal
    everywhere except the sheet-parity short-circuit above, which is neither:
    it maps the whole canvas but CENTRES IT BY THE INK, so on any rect the
    scaled canvas does not exactly fill — a cell of a different aspect, or one
    bigger than the canvas, which is the ordinary `grid` case — it re-centres
    every frame on its own ink and the animation stops moving as drawn. Under
    `keep` that short-circuit is therefore bypassed: ink-blind wins, because
    being ink-blind is the entire content of the setting. Under `alpha` nothing
    here changes at all.
    """
    keep_full = keep_full_frame({"atlas": ATLAS_META})
    # target is the region's UNROTATED size (w, h). For a rotated region we
    # fit the upright art to (w, h) and rotate(+90) at the very end so it
    # lands as the (h x w) packed footprint the .atlas expects.
    _, _, target_w, target_h = region_box(region)
    # Atlas-bound iff merge_atlas_regions stamped the .atlas trim geometry on
    # it. Trimmed vs untrimmed is irrelevant — any .atlas slot must be filled.
    spine_slot = "orig_w" in region and "orig_h" in region

    if img.mode != "RGBA":
        img = img.convert("RGBA")

    # An EXPLICIT "contain" (the Sheet Maker stamps it on every cell it writes)
    # is a placement CONTRACT, not a preference: replay packer.compose so a
    # republish is a no-op for the rig. Must stay an explicit-only check — the
    # default fallback below also resolves to "contain" for legacy cell-grid
    # regions, which must keep their alpha-crop behaviour. `crop_box` is
    # deliberately unused here: there is no alpha-crop to override, and packer
    # centres the visible bbox for base and FX cells alike — EXCEPT that an FX
    # layer has no placement of its own (see `_fx_parity_tile`), so when the
    # caller resolved its base AND the two disagree about where the ink is, we
    # replay packer.compose about the BASE's ink instead of this layer's. Every
    # symmetric effect agrees and goes to the replay untouched, byte for byte;
    # what disagrees is a drop shadow, whose whole content is the offset that
    # centring its own blob deletes.
    if not keep_full and (
            str(region.get("fit_mode", "")).strip().lower() == "contain"):
        if fx_place is not None and not fx_place["replay"]:
            return _fx_parity_tile(img, target_w, target_h,
                                   bool(region.get("rotated")), fx_place)
        return _packer_compose_tile(img, target_w, target_h,
                                    bool(region.get("rotated")))

    if not keep_full:
        # 1) Crop to actual visible content — ALPHA bbox, not RGBA. An FX layer
        #    passes its base-derived box instead (see above); PIL pads an
        #    out-of-canvas box with transparent, which is what keeps the halo's
        #    room symmetric rather than clamped.
        alpha_bbox = crop_box or img.getchannel("A").getbbox()
        if alpha_bbox:
            img = img.crop(alpha_bbox)

        # 2) Uniform padding (floor 0, so padding_pct = 0 is edge-to-edge).
        pad_w = max(0, int(round(img.width * PADDING_PCT)))
        pad_h = max(0, int(round(img.height * PADDING_PCT)))
        if pad_w or pad_h:
            padded = Image.new(
                "RGBA", (img.width + 2 * pad_w, img.height + 2 * pad_h),
                (0, 0, 0, 0))
            padded.paste(img, (pad_w, pad_h), img)
            img = padded
    # …and under `keep` neither step runs. Not just the crop: `crop_box` is an
    # alpha box too (`fx_registration_crop` derives it from the BASE's bbox,
    # to re-register a halo against a glyph that WAS cropped), and it is moot
    # here — an FX layer is rendered on its base's canvas, so leaving both of
    # them whole registers them by construction. The padding goes with it
    # because it is margin for a tight crop: the authored canvas already
    # carries whatever margin the art has, and re-padding it would shrink the
    # frame inside its own rect — on `pack`, where the rect IS the canvas,
    # measurably so.

    # How the element maps into the slot — the element being the alpha crop
    # above, or, under `keep`, the whole canvas. Per-region 'fit_mode' wins; the
    # default keeps the verified-correct behaviour (Spine slot = fill exactly;
    # legacy cell-grid = contain, == the old pad-to-aspect path). All three are
    # a pure function of the element's SIZE, so under `keep` all three give
    # every frame on one canvas the identical transform:
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
        # upright (w x h) -> packed (h x w), the STANDARD TexturePacker /
        # PixiJS convention: pack 90 clockwise so Pixi's Spritesheet parser
        # (frame rect built as (x, y, h, w) + rotate:2 = groupD8 S) un-rotates
        # it back to upright at render time. One convention for ALL rotated
        # frames (spine-slot and non-spine alike) — proven by the PIL<->Pixi
        # round-trip in _rot_roundtrip_check.py: PIL rotate(-90) is the unique
        # direction that renders upright under rotate:2. The slicer + editor
        # un-rotate as the exact inverse of this.
        img = img.rotate(-90, expand=True)

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
    1. the exact file the user picked & committed ("variant" id), while that
       pick is still live — authoritative because a locked seed is reused
       across renders, so many variants share one seed and seed-matching can't
       tell them apart. A pick the slot has since re-rendered past is spent
       (see effective_variant), so this composes what the card displays;
    2. else the file whose embedded seed matches a locked "seed";
    3. else the most recent variant."""
    files = variant_files(batch_dir, region["name"])
    if not files:
        return None
    picked = effective_variant(region, _variant_id(files[-1]))
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


def fx_registration(img: Image.Image, region: dict,
                    by_name: dict, batch_dir: Path) -> dict | None:
    """How an FX layer is placed so it stays registered with its base element.

    An FX layer (`<base>_glow` / `_shadow` / ...) is built by shine.py from the
    base's OWN source image, onto the base's canvas with the glyph in the SAME
    place — or, for an offset drop shadow, onto that canvas grown SYMMETRICALLY
    (`shine.make_shadow`), which keeps the two concentric while giving the blob
    room to sit off-centre. Either way the layer lives in the base's pixel
    space and must be placed by the base's numbers, never by its own ink:

      box     the crop box for the alpha path. The FX layer's own alpha bbox is
              deliberately larger than its base's (the halo blooms into the
              margin), so cropping to it scales the glyph down and shifts it —
              the FX then renders offset and resized under a rig that expects
              the two slots to line up. Cropping to the base's bare bbox would
              register but throw the halo away, so the box is the base's bbox
              GROWN about its centre by the ratio of the two authored slots:
              the slot IS the element's footprint budget, so this is the
              largest halo the packed rect can carry, and it lands at exactly
              the base's scale (identical for `fill`, `contain` and `cover`,
              since both boxes are scaled by the same factors). A same-size FX
              slot degenerates to the base's bbox: the halo is then
              geometrically un-drawable, not discarded by us.
      scale /
      anchor /
      rel     the base's transform, for the sheet-parity path — see
              `_fx_parity_tile`, which uses them instead of centring this
              layer's own bbox.

    All coordinates are in the FX image's canvas, so a shadow's symmetric
    margin is already folded in.

    Returns None — i.e. today's self-cropping behaviour — for a non-FX region,
    an unresolvable base, or an FX image that is NOT its base's canvas or that
    canvas symmetrically grown (hand-made or stale FX art isn't in the base's
    pixel space, so the numbers would be meaningless).
    """
    info = shine.fx_layer_info(region.get("name", ""))
    if info is None:
        return None
    base = by_name.get(info["base"])
    if base is None:
        return None
    src = override_image_path(base) or _pick_variant_png(batch_dir, base)
    if src is None:
        return None
    try:
        with Image.open(src) as f:
            base_img = f.convert("RGBA")
    except (OSError, ValueError):
        return None
    # A margin has to be symmetric AND whole on both axes to be a margin: an
    # odd or negative difference means this is some other canvas, not the
    # base's with room added around it.
    dw, dh = img.width - base_img.width, img.height - base_img.height
    if dw < 0 or dh < 0 or dw % 2 or dh % 2:
        return None
    mx, my = dw // 2, dh // 2
    bb = base_img.getchannel("A").getbbox()
    if not bb:
        return None
    try:
        _, _, base_w, base_h = region_box(base)
        _, _, fx_w, fx_h = region_box(region)
    except (TypeError, ValueError):
        # No geometry to register against — region_box falls back to
        # ATLAS_META, which is empty outside the compose subprocess (the
        # inspector calls this too).
        return None
    if not (base_w and base_h and fx_w and fx_h):
        return None
    x0, y0, x1, y1 = bb[0] + mx, bb[1] + my, bb[2] + mx, bb[3] + my
    half_w = (x1 - x0) * (fx_w / base_w) / 2
    half_h = (y1 - y0) * (fx_h / base_h) / 2
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    # The base's own parity transform: its canvas scaled into its rect, never
    # upscaled. If that exactly fills the rect, packer.compose re-centres
    # NOTHING and the base's ink keeps its place on the canvas — so the anchor
    # must land at that same relative place, not at the middle. Otherwise the
    # base's bbox IS centred, and the anchor goes to the middle.
    bs = min(base_w / base_img.width, base_h / base_img.height, 1.0)
    if (max(1, round(base_img.width * bs)),
            max(1, round(base_img.height * bs))) == (base_w, base_h):
        rel = ((cx - mx) * bs / base_w, (cy - my) * bs / base_h)
    else:
        rel = (0.5, 0.5)
    # Is the standalone replay already the right answer? It is whenever this
    # layer's ink is centred on its base's ON THE BASE'S OWN CANVAS — a glow's
    # halo, a recolour, a centred zoom. Then `_packer_compose_tile` and
    # `_fx_parity_tile` agree about WHERE, and handing those to the replay keeps
    # the sheet-parity contract exact rather than "within a pixel" (the two
    # round their integer offsets from different box widths). Measured with
    # `img.getbbox()`, not the alpha bbox, because the question is about the box
    # packer WOULD centre, and packer measures RGBA — a layer with a coloured
    # but transparent gutter is placed by that gutter.
    #
    # A canvas that GREW is never replayed: only `make_shadow` grows one, and it
    # grows one precisely because the layer carries an offset its ink does not
    # show. (A blurred full-bleed silhouette's blob fills the whole margin and
    # reads as perfectly centred — exactly the case the replay would flatten.)
    own = img.getbbox()
    replay = (mx, my) == (0, 0) and (own is None or (
        abs((own[0] + own[2]) / 2 - cx) <= 0.5
        and abs((own[1] + own[3]) / 2 - cy) <= 0.5))
    return {"box": (int(round(cx - half_w)), int(round(cy - half_h)),
                    int(round(cx + half_w)), int(round(cy + half_h))),
            "scale": bs, "anchor": (cx, cy), "rel": rel, "replay": replay}


def fx_registration_crop(img: Image.Image, region: dict,
                         by_name: dict, batch_dir: Path
                         ) -> tuple[int, int, int, int] | None:
    """`fx_registration`'s crop box alone, for the alpha path's `crop_box`."""
    reg = fx_registration(img, region, by_name, batch_dir)
    return None if reg is None else reg["box"]


def region_locked(region: dict) -> bool:
    """Is this region pinned against re-rendering?

    `lock` is explicit since the variant pick was untangled from it — a pick
    says WHICH generated file to compose, not that the slot must stop
    rendering, so the old "a stored seed (or, for seedless GPT, a stored
    pick) means locked" inference would now read every pick as a lock. That
    inference survives only as the fallback for manifests written before the
    flag existed, where a stored seed/pick really could only mean locked."""
    if "lock" in region:
        return bool(region["lock"])
    return "seed" in region or bool(str(region.get("variant", "")).strip())


def _variant_newer(a: str, b: str) -> bool:
    """Is variant id `a` newer than `b`? The ids are ComfyUI's zero-padded
    per-region counter, so compare them as numbers when they parse. Strictly
    greater, never `!=`: deleting the newest file frees its id, and an id that
    went DOWN means art was removed, not added."""
    try:
        return int(a) > int(b)
    except (TypeError, ValueError):
        return bool(a) and bool(b) and a != b


def effective_variant(region: dict, newest_id: str) -> str:
    """The picked file id this region should actually use, or "" for "the newest".

    A pick says WHICH of the files that existed when you clicked it to compose.
    It is SPENT the moment the slot renders again: the fresh art is what the
    card shows, so it must also be what Create Atlas composes — otherwise the
    page quietly ships a file the page is no longer displaying.

    `variant_at` records the newest id that existed when the pick was made, so
    "has this slot rendered since?" is a fact of the stored manifest. It used
    to be reconstructed after each run instead, from an in-memory snapshot
    taken before the subprocess started — which held only while the post-render
    hook ran, the browser's poll loop reached its refresh, and no blanket save
    posted the card's stale id back in between. Any one of those missing left
    the slot pinned to old art with nothing on screen to say so.

    Legacy pins (written before the field existed) date themselves to their own
    id: the newest file we can prove existed at pick time is the picked one.

    A LOCKED pick is never spent — outliving future renders is precisely what
    the lock promises."""
    picked = str(region.get("variant", "")).strip()
    if not picked:
        return ""
    if region_locked(region):
        return picked
    at = str(region.get("variant_at", "")).strip() or picked
    return "" if _variant_newer(newest_id, at) else picked


def already_generated(batch_dir: Path, region: dict) -> Path | None:
    """When a region is LOCKED and a matching variant already exists, return
    that file (so generation can skip it — no point re-rendering a pinned
    result). 'Matching' = the picked-variant id, else a file whose embedded
    seed equals the locked seed. Unlocked regions always return None (they're
    meant to produce fresh variants).

    GPT-Image-1 has no embedded seed, so a locked gpt_image region pins its
    result by the variant pick alone. Re-running it would mean another paid
    OpenAI call for an image the user already chose."""
    if not region_locked(region):
        return None
    files = variant_files(batch_dir, region["name"])
    if not files:
        return None
    picked = str(region.get("variant", "")).strip()
    if picked:
        for p in files:
            if _variant_id(p) == picked:
                return p
    if region_pipeline(region) == "gpt_image":
        return None
    locked = region.get("seed")
    if locked is None:
        return None
    for p in files:
        if _seed_in_png(p) == locked:
            return p
    return None


def _prepare_blueprint_models_or_fail(gen_regions: list[dict]) -> None:
    """Run the blueprint model prepare step for every blueprint pipeline used by
    the regions about to generate, and FAIL the run (readable checklist) if a
    required model is still missing afterwards.

    Built-in pipelines (sdxl/flux/gpt_image) are skipped — their models are
    handled by preflight_models. Only blueprints with a non-empty `models[]`
    trigger any work; a blueprint with no declared models is a no-op.

    TRANSPORT-AWARE, and it has to be: the prepare step's whole apparatus —
    `_model_installed`, the Manager install queue, `POST /manager/reboot` — talks
    to COMFY_BASE, the ARTIST'S desktop over the tunnel. A serverless render runs
    somewhere else entirely, so pointing this at the desktop had two bad
    outcomes and no good one: with the tunnel up it installed onto and REBOOTED
    someone else's machine mid-work, and with the tunnel down `ComfyUnreachable`
    put every declared model on the checklist and killed a pod render whose
    volume had the files. The serverless target gets a survey — a message, never
    a gate. Same reasoning `_probe_ready` already encodes for the graph guards.

    The mirror lookup happens HERE, once per blueprint and only after a result
    exists, so a run where everything is installed makes no R2 calls — and every
    reported row gets a verdict, including the ComfyUnreachable short-circuit and
    the Manager-400 branch a private model actually lands on."""
    # Distinct blueprint ids in play (region override else global PIPELINE),
    # excluding the three built-ins.
    bp_ids: list[str] = []
    for r in gen_regions:
        pipe = region_pipeline(r)
        if pipe in ("sdxl", "flux", "gpt_image"):
            continue
        if pipe not in bp_ids:
            bp_ids.append(pipe)
    if not bp_ids:
        return

    serverless = COMFY_TRANSPORT == "serverless"
    target = "serverless" if serverless else "local"
    where = "the RunPod worker" if serverless else "your ComfyUI"
    # Paired with `where`, from the SAME boolean, so the explanation and the
    # remedy can never disagree about which machine ran the job.
    assurance = (
        "To be sure a RunPod worker has them, run python "
        "services/atlas-tool/runpod/pull-models.py --dest "
        "/workspace/ComfyUI/models on a pod with the network volume mounted, "
        "then start a fresh worker (a running one keeps its old file list)."
        if serverless else
        "To be sure your ComfyUI has them, check its models/ folder on that "
        "machine — it only scans models/ at startup, so a file added since the "
        "last start stays invisible until you restart it."
    )

    failures: list[str] = []
    for bp_id in bp_ids:
        bp = blueprints.get_blueprint(bp_id)
        if not bp:
            continue  # run_region falls back to sdxl for a missing blueprint
        models = (bp.get("meta") or {}).get("models") or []
        if not models:
            continue  # blueprint declares no models → nothing to prepare
        print(f"\n=== Preparing models for blueprint '{bp_id}' "
              f"({len(models)} declared, target: {target}) ===", flush=True)
        if serverless:
            result = blueprint_models.survey_blueprint_models(models)
        else:
            result = prepare_blueprint_models_for_run(models)
        if result.installed:
            print(f"[prepare] '{bp_id}': installed "
                  f"{', '.join(result.installed)}", flush=True)
        model_mirror.enrich(result.still_missing + result.advisories, target)
        if result.advisories:
            print(blueprint_models.format_advisories(result), flush=True)
            emit(diag("BLUEPRINT_MODEL_UNVERIFIED", CATALOG, bp=bp_id,
                      where=where, assurance=assurance,
                      files="\n".join(
                          f"  {m.get('filename')} — "
                          f"{model_mirror.short_status(m.get('mirror'))}"
                          for m in result.advisories)))
        if not result.ready:
            checklist = blueprint_models.format_checklist(result)
            failures.append(f"Blueprint '{bp_id}':\n{checklist}")
            emit(diag("BLUEPRINT_MODEL_MISSING", CATALOG, bp=bp_id, where=where,
                      files="\n".join(
                          f"  {m.get('filename')} -> models/"
                          f"{m.get('save_path') or '?'}/ — "
                          f"{model_mirror.short_status(m.get('mirror'))}"
                          for m in result.still_missing)))

    if failures:
        bar = "=" * 64
        print(f"\n{bar}\n  BLUEPRINT MODELS MISSING ({where})\n", flush=True)
        print("\n\n".join(failures), flush=True)
        print(bar, flush=True)
        raise SystemExit(2)


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

    manifest_path = resolve_manifest_arg(args.manifest)
    if manifest_path.suffix.lower() == ".atlas":
        # A `.atlas` was selected directly: pure geometry, no creative manifest.
        manifest = {"atlas": {}, "style": {"positive_prefix": "",
                    "positive_suffix": "", "negative": ""}, "regions": []}
    else:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    atlas = dict(manifest.get("atlas") or {})
    # A DERIVED manifest (e.g. the Flipbook video mode's packed frame sheet)
    # carries no AI authoring block at all — it must still compose.
    style = manifest.get("style") or {}

    atlas_path = atlas_file_path(manifest, manifest_path)
    atlas_bound = atlas_path is not None
    if atlas_bound and not atlas_path.exists():
        ref = (manifest.get("atlas") or {}).get("atlas_file") or atlas_path.name
        emit(diag("ATLAS_GEOMETRY_MISSING", CATALOG, ref=ref))
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

    # Blueprint exposed-param overrides (B43 Phase 8): when the active pipeline
    # is a blueprint, pull this manifest's saved overrides for THAT blueprint id
    # (namespaced so switching blueprints doesn't cross-contaminate) into the
    # module global the generic runner reads. A built-in pipeline or a blueprint
    # with no saved overrides leaves it empty (defaults apply) — no behavior
    # change for the proven paths.
    BP_PARAM_OVERRIDES.clear()
    _active_pipe = str(PIPELINE).strip().lower()
    if _active_pipe not in ("sdxl", "flux", "gpt_image"):
        _bp_params = ((manifest.get("settings") or {}).get("bpParams") or {})
        _this = _bp_params.get(_active_pipe)
        if isinstance(_this, dict):
            BP_PARAM_OVERRIDES.update(_this)
            if BP_PARAM_OVERRIDES:
                print("Blueprint param overrides for "
                      f"'{_active_pipe}': "
                      + ", ".join(f"{k}={v}"
                                  for k, v in BP_PARAM_OVERRIDES.items()))

    if atlas_bound:
        # Rotation is per-region metadata from the `.atlas`; everything is
        # included (no rotated-split exclusion — that would drop ~half the
        # atlas). --include-rotated is a no-op in this mode.
        regions = merge_atlas_regions(manifest, atlas_data)
    else:
        regions = list(manifest["regions"])
        if args.include_rotated:
            regions += manifest.get("rotated_regions", [])
    # The full region universe (BEFORE the --only / hidden filtering below). An
    # FX layer's base may sit OUTSIDE the current selection, so FX layers are
    # classified against this set — else selecting only the FX cells (not their
    # bases) misreads them as plain "use my own image" overrides and wrongly
    # warns "nothing to generate — every region uses your own image".
    # Keyed by name too: compose resolves an FX layer's BASE through this, and
    # the base can sit outside the current selection (same reason as above).
    all_regions_by_name = {r["name"]: r for r in regions}
    all_region_names = set(all_regions_by_name)
    if args.only:
        wanted = {s.strip() for s in args.only.split(",")}
        regions = [r for r in regions if r["name"] in wanted]
    elif not args.include_hidden:
        regions = [r for r in regions if not r.get("skip_unless_explicit")]

    if not regions:
        emit(diag("NO_REGIONS_SELECTED", CATALOG))
        return

    batch_dir = BATCH_DIR

    if args.compose_only:
        # Assemble the atlas from already-generated PNGs. No ComfyUI calls.
        # A from-scratch ('pack' layout) atlas only gets its page size once
        # auto_pack_layout has measured generated art; composing before anything
        # is generated leaves width/height unset. Fail with a readable line
        # rather than a KeyError on the canvas.
        try:
            page_w, page_h = int(atlas["width"]), int(atlas["height"])
        except (KeyError, TypeError, ValueError):
            page_w = page_h = 0
        if page_w <= 0 or page_h <= 0:
            if atlas_layout(manifest) == "grid":
                print("Nothing to compose yet — this atlas has no page "
                      "geometry. Set Atlas width and Atlas height in Settings "
                      "(on a grid layout the page is yours, not the packer's), "
                      "then Create Atlas.")
            else:
                print("Nothing to compose yet — this atlas has no page "
                      "geometry. Generate at least one region, then Create "
                      "Atlas (the page is packed from the generated art).")
            return
        canvas = Image.new("RGBA", (page_w, page_h), (0, 0, 0, 0))
        placed = 0
        # A from-scratch atlas's rects are DERIVED: the layout pass stamps one
        # on every region it placed and leaves none on a region it did not, so
        # "no rect" means "not on this page" and there is no authored geometry
        # to fall back to. region_box's fallback would answer (0, 0, page) —
        # which for a region that acquired art in the window between that
        # measurement and this subprocess (a render finishing while Create Atlas
        # runs) paints one symbol across the WHOLE sheet, destroying every other
        # region's pixels. On `grid` the same fallback is a quieter version of
        # the same wrong answer: cell_width/cell_height ARE set there, so every
        # unplaced region would be painted into the top-left cell, one over
        # another. Both layouts refuse instead; the legacy no-layout cell grid
        # keeps that fallback on purpose, for a single full-page image.
        derived_layout = is_from_scratch(manifest)

        def _unplaced(r: dict) -> bool:
            return derived_layout and not all(
                r.get(k) is not None for k in ("x", "y", "w", "h"))

        for region in regions:
            if _unplaced(region):
                print(f"  skip {region['name']}: not placed on this page "
                      f"(no rect — re-run Create Atlas to pack it in)")
                continue
            ov = override_image_path(region)
            if ov is not None:
                img = Image.open(ov).convert("RGBA")
                fx = fx_registration(img, region, all_regions_by_name,
                                     batch_dir)
                img = fit_to_region(img, region,
                                    fx["box"] if fx else None, fx)
                rx, ry, _, _ = region_box(region)
                canvas.paste(img, (rx, ry), img)
                placed += 1
                print(f"  placed {region['name']} <- {ov.name} "
                      f"(user image — not processed)")
                continue
            if region.get("output_override"):
                emit(diag("OUTPUT_OVERRIDE_FILE_MISSING", CATALOG,
                          name=region["name"],
                          path=region["output_override"]))
            src = _pick_variant_png(batch_dir, region)
            if not src:
                print(f"  skip {region['name']}: no generated variant found")
                continue
            img = Image.open(src).convert("RGBA")
            fx = fx_registration(img, region, all_regions_by_name, batch_dir)
            img = fit_to_region(img, region, fx["box"] if fx else None, fx)
            rx, ry, _, _ = region_box(region)
            canvas.paste(img, (rx, ry), img)
            placed += 1
            print(f"  placed {region['name']} <- {src.name}")
        out_path = (Path(args.output) if args.output else
                    ATLAS_DIR /
                    f"{manifest_path.stem.replace('atlas_manifest_', '')}_new.png")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        # A `<stem>_new.webp` from an EARLIER run must not outlive this save.
        # It is the file both the page pointer and deploy PREFER, so a stale
        # webp sitting beside a fresh png is a page of the wrong size waiting to
        # be published under the rects this compose just produced. Deleting it
        # here — immediately before the two saves — means the only webp that can
        # exist from now on is the one written below, and if that encode fails
        # the png is unambiguously the page. (It is deleted HERE and not at the
        # top of compose on purpose: a compose that dies before this point must
        # leave the previous page deployable.)
        webp_path = out_path.with_suffix(".webp")
        try:
            webp_path.unlink(missing_ok=True)
        except OSError:
            pass
        canvas.save(out_path)
        print(f"Composed {placed}/{len(regions)} regions")
        print(f"Saved {out_path}")
        # WEBP is best-effort: if encoding fails or yields a 0-byte file (some
        # Pillow builds can't encode large RGBA WEBP), REMOVE the broken file so
        # deploy never copies a corrupt page that the game then fails to load
        # (meta.image would point at an empty page → whole atlas gone). The PNG
        # above is always valid; deploy falls back to it.
        try:
            canvas.save(webp_path, "WEBP", quality=95)
            if webp_path.stat().st_size == 0:
                raise ValueError("WEBP encoder produced a 0-byte file")
            print(f"Saved {webp_path}")
        except Exception as e:  # noqa: BLE001 — webp is optional, never fatal
            try:
                webp_path.unlink(missing_ok=True)
            except OSError:
                pass
            print(f"WARNING: WEBP not written ({type(e).__name__}: {e}); "
                  f"PNG-only page — deploy will ship this game page as .png "
                  f"(no WebP twin to prefer)")
        return

    # ---- generation mode: produce per-region variant PNGs only (no atlas) ----
    client_id = str(uuid.uuid4())
    variants = max(1, args.variants)
    jobs: list[dict] = []
    # A region is only treated as "use my own image" (skipped from
    # generation) when its override file actually EXISTS. A region flagged
    # output_override whose file is gone is NOT skipped — we warn and let it
    # fall through to normal generation, so a missing image never silently
    # leaves the region blank.
    def _is_fx_layer(r: dict) -> dict | None:
        """A region is a LOCAL-FX layer (derived from a base — never AI
        generated) when its name carries a canonical FX suffix, the base it
        derives from EXISTS IN THE MANIFEST (not necessarily in the current
        selection — an FX cell can be processed on its own), and its stored
        `mode` is a known FX preset. Returns fx_layer_info (with `mode`) or None.
        Guards against a coincidental '_zoom'-named region with no matching
        base."""
        info = shine.fx_layer_info(r.get("name", ""))
        if info is None or info["base"] not in all_region_names:
            return None
        if str(r.get("mode") or "").strip().lower() not in shine.FX_PRESETS:
            return None
        return info

    # A region is only treated as "use my own image" (skipped from generation)
    # when its override file actually EXISTS. A region flagged output_override
    # whose file is gone is NOT skipped — we warn and let it fall through to
    # normal generation, so a missing image never silently leaves it blank.
    # A mode'd FX layer (recognised by _is_fx_layer) is ALSO skipped even when
    # it has no committed image yet: it's derived locally by rebuild_fx_layers
    # from its base, so AI-generating it would waste credits and produce wrong
    # art (a sheet-derived FX cell arrives mode'd-but-unbuilt — see shine.py /
    # the Sheet Maker's FX picker).
    overridden = []
    gen_regions = []
    fx_over = []
    fx_details = []
    for r in regions:
        info = _is_fx_layer(r)
        has_override = bool(r.get("output_override"))
        if info is not None and (not has_override
                                 or override_image_path(r) is not None):
            # Local-FX layer: skip generation whether or not it's built yet.
            fx_over.append(r["name"])
            fx_details.append(f"{r['name']} ← {info['base']} ({info['mode']})")
        elif not has_override:
            gen_regions.append(r)
        elif override_image_path(r) is not None:
            overridden.append(r["name"])
        else:
            emit(diag("OUTPUT_OVERRIDE_FILE_MISSING", CATALOG,
                      name=r["name"], path=r["output_override"]))
            gen_regions.append(r)
    # Genuine "use my own image" regions (a committed override that is NOT an
    # FX layer) — reported separately from the FX skips below.
    plain_over = list(overridden)
    if fx_over:
        emit(diag("FX_LAYERS_SKIPPED", CATALOG,
                  count=len(fx_over), names="; ".join(fx_details)))
    if plain_over:
        if gen_regions or fx_over:
            emit(diag("SOME_REGIONS_OVERRIDDEN", CATALOG,
                      count=len(plain_over), names=", ".join(plain_over)))
        else:
            emit(diag("ALL_REGIONS_OVERRIDDEN", CATALOG))
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
            emit(diag("LOCKED_ALREADY_GENERATED", CATALOG,
                      count=len(done), names=", ".join(done)))
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

    # Effective pipeline per job — so the log states plainly WHICH pipeline runs
    # and, for a blueprint, whether it actually loaded (vs. a built-in path).
    # This is the diagnostic that ends "I picked my blueprint but got SDXL":
    # a `sdxl (built-in)` line here means the blueprint id never reached this
    # subprocess (unsaved / wrong config); a `blueprint — FAILED TO LOAD` line
    # means it's selected but broken.
    for _p in sorted({region_pipeline(r) for r in jobs}):
        if _p in ("sdxl", "flux", "gpt_image"):
            print(f"Pipeline: {_p} (built-in)")
        else:
            _ok = blueprints.get_blueprint(_p) is not None
            print(f"Pipeline: {_p} (blueprint) — "
                  + ("loaded OK" if _ok
                     else "FAILED TO LOAD (will error at generate)"))

    if not jobs:
        # The genuinely all-overridden case is already reported precisely at
        # the override partition above (before the locked-skip). We must NOT
        # re-emit ALL_REGIONS_OVERRIDDEN here: by this point gen_regions has
        # been reduced by the locked/already-generated filter, so a mixed case
        # (e.g. 1 override + 2 locked) would falsely claim "every region uses
        # your own image". The accurate cards (SOME_REGIONS_OVERRIDDEN +
        # LOCKED_ALREADY_GENERATED, or ALL_REGIONS_OVERRIDDEN) have already
        # been emitted upstream — just state plainly that there is no work.
        if fx_over and not plain_over and not gen_regions and not done:
            # Pure FX-only selection: not an error. The FX_LAYERS_SKIPPED info
            # card already explained it; say plainly that AI had nothing to do
            # but the FX layers derive from their base on Create Atlas.
            print(f"No AI generation needed — the {len(fx_over)} selected FX "
                  "layer(s) derive from their base (rebuilt on Create Atlas).")
        else:
            print("Nothing to generate (all selected regions already done or "
                  "use a user image).")
        return

    preflight_models(gen_regions)

    # Blueprint model auto-download (B43 §4): for every BLUEPRINT pipeline in
    # play (a region/atlas `pipeline` that isn't a built-in id), ensure the
    # local ComfyUI has the models the blueprint declares — installing missing
    # catalog models via ComfyUI-Manager (kill-switch:
    # BLUEPRINT_AUTO_INSTALL_MODELS). Built-in sdxl/flux/gpt_image regions keep
    # using preflight_models above, untouched. If a required model can't be
    # provided, fail with a readable checklist rather than submitting a doomed
    # prompt — same contract as preflight_models.
    _prepare_blueprint_models_or_fail(gen_regions)

    # A from-scratch ('pack' layout) atlas has no source page, so `source_image`
    # is absent — and it's only a style-ref fallback for the built-in builders
    # anyway (a blueprint ignores it entirely). Use "" ("no source") rather than
    # a hard lookup so generation works before any page exists.
    source_image = atlas.get("source_image") or ""
    for i, region in enumerate(jobs, start=1):
        label = f"{region['name']} ({region.get('fruit', '?')})"
        flag = " [rotated]" if region.get("rotated") else ""
        print(f"[{i}/{len(jobs)}] {label}{flag} ...", flush=True)
        run_region(region, style, source_image, client_id)

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
