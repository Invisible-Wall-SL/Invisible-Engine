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
import storage  # noqa: E402
import shine  # noqa: E402
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

# Per-(client, project) — MUST be live (thread-local) for the imported-by-UI
# path; in the subprocess they resolve the single env context, unchanged.
BATCH_DIR = _PathProxy("batch_dir")
ATLAS_DIR = _PathProxy("atlas_dir")
INPUT_DIR = _PathProxy("input_dir")
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


def _hydrate_from_r2_by_name(name: str) -> Path | None:
    """Pull a geometry/page file into staging by its bare basename when it isn't
    on local disk yet. A legacy/Windows-authored manifest names an atlas/page
    that lives in R2 (seeded by seed_r2.py) but was never hydrated into this
    container's staging — so resolve it from the active project's R2 tree at the
    two locations it can live (`input/refs/atlas/<name>` — the INPUT_DIR mirror —
    and the shared `manifests/<name>`), drop it into `INPUT_DIR/refs/atlas/<name>`
    and return that local path. Best-effort; returns None if R2 is empty/down."""
    if not name:
        return None
    try:
        r2_prefix = project_paths.resolve().get("r2_project_prefix")
    except Exception:  # noqa: BLE001
        return None
    if not r2_prefix:
        return None
    for key in (f"{r2_prefix}/input/refs/atlas/{name}", f"{r2_prefix}/manifests/{name}"):
        try:
            blob = storage.get(key)
        except Exception:  # noqa: BLE001
            blob = None
        if blob:
            dest = INPUT_DIR / "refs" / "atlas" / name
            try:
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(blob)
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
    for cand in (manifest_path.parent / rel, INPUT_DIR / rel,
                 manifest_path.parent / name, INPUT_DIR / "refs" / "atlas" / name,
                 INPUT_DIR / name, SELF / name):
        if cand.exists():
            return cand
    # Nothing on disk yet — the manifest was likely authored offline with a
    # local/Windows `atlas_file`, but seed_r2 placed the geometry in R2. Pull it
    # into staging by basename so resolution succeeds without a manual upload.
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
    si = (manifest.get("atlas") or {}).get("source_image")
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
    # Legacy/offline manifest: the page lives in R2 (seeded under refs/atlas/)
    # but isn't in staging yet. If nothing on disk matches, pull it by basename
    # so compose/slice find it — same auto-hydrate atlas_file_path does.
    if not any(c.exists() for c in cands):
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


def comfy_post(path: str, payload: dict) -> dict:
    req = Request(
        f"{COMFY_BASE}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **CF_HEADERS},
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
    staging mirror. Region refs are normally INPUT_DIR-relative (e.g.
    `refs/foo.png`), but the global `mockup_image` style fallback is a
    free-text path that may be a bare filename (`hotFruits_MockUp.png`), an
    absolute/UNC path, or a stale value. Try, in order: an absolute path as
    given; INPUT_DIR/<relpath>; then a basename search of the known ref dirs
    (INPUT_DIR root + refs/ tree). Returns the first hit, else None."""
    p = Path(relpath)
    if p.is_absolute():
        return p if p.exists() else None
    direct = INPUT_DIR / relpath
    if direct.exists():
        return direct
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


def _upload_workflow_refs(wf: dict) -> None:
    """Rewrite every LoadImage node's `image` from a staging-relative ref path
    to a name uploaded to the remote ComfyUI. Mutates wf in place."""
    for node in wf.values():
        if not isinstance(node, dict) or node.get("class_type") != "LoadImage":
            continue
        relpath = (node.get("inputs") or {}).get("image")
        if not relpath or not isinstance(relpath, str):
            continue
        src = _locate_ref_in_staging(relpath)
        if src is None:
            print(f"[upload] ref not in staging, leaving as-is: {relpath}", flush=True)
            continue
        try:
            node["inputs"]["image"] = comfy_upload_image(src.name, src.read_bytes())
        except Exception as e:  # noqa: BLE001
            print(f"[upload] failed for {relpath}: {e}", flush=True)


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


def run_region(region: dict, style: dict, atlas_path: str, client_id: str) -> Image.Image:
    wf = build_workflow(region, style, atlas_path)
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
            saves = entry.get("outputs", {}).get("17", {}).get("images", [])
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

    manifest_path = resolve_manifest_arg(args.manifest)
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
        emit(diag("NO_REGIONS_SELECTED", CATALOG))
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
                emit(diag("OUTPUT_OVERRIDE_FILE_MISSING", CATALOG,
                          name=region["name"],
                          path=region["output_override"]))
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
        print(f"Composed {placed}/{len(regions)} regions")
        print(f"Saved {out_path}")
        # WEBP is best-effort: if encoding fails or yields a 0-byte file (some
        # Pillow builds can't encode large RGBA WEBP), REMOVE the broken file so
        # deploy never copies a corrupt page that the game then fails to load
        # (meta.image would point at an empty page → whole atlas gone). The PNG
        # above is always valid; deploy falls back to it.
        webp_path = out_path.with_suffix(".webp")
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
                  f"PNG-only page")
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
    overridden = []
    gen_regions = []
    for r in regions:
        if not r.get("output_override"):
            gen_regions.append(r)
        elif override_image_path(r) is not None:
            overridden.append(r["name"])
        else:
            emit(diag("OUTPUT_OVERRIDE_FILE_MISSING", CATALOG,
                      name=r["name"], path=r["output_override"]))
            gen_regions.append(r)
    # Split the overridden set into FX layers (derived locally from a base —
    # skipped BY DESIGN) vs genuine "use my own image" regions. A name only
    # counts as an FX layer when shine.fx_layer_info() recognises its suffix
    # AND the base it derives from is actually present in the selection (so a
    # coincidental '_zoom'-named region with no matching base isn't
    # misclassified as FX).
    region_names = {r["name"] for r in regions}
    fx_over = []
    fx_details = []
    plain_over = []
    for name in overridden:
        info = shine.fx_layer_info(name)
        if info is not None and info["base"] in region_names:
            fx_over.append(name)
            fx_details.append(f"{name} ← {info['base']} ({info['mode']})")
        else:
            plain_over.append(name)
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

    if not jobs:
        # The genuinely all-overridden case is already reported precisely at
        # the override partition above (before the locked-skip). We must NOT
        # re-emit ALL_REGIONS_OVERRIDDEN here: by this point gen_regions has
        # been reduced by the locked/already-generated filter, so a mixed case
        # (e.g. 1 override + 2 locked) would falsely claim "every region uses
        # your own image". The accurate cards (SOME_REGIONS_OVERRIDDEN +
        # LOCKED_ALREADY_GENERATED, or ALL_REGIONS_OVERRIDDEN) have already
        # been emitted upstream — just state plainly that there is no work.
        print("Nothing to generate (all selected regions already done or "
              "use a user image).")
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
