"""Atlas backend — generation service.

Runs on Railway. Submits ComfyUI workflows to a LOCAL ComfyUI reached over a
Cloudflare Tunnel (COMFY_URL), fetches the result, and stores it in R2.
This first slice exposes a minimal SDXL txt2img test to prove the chain.
"""
from __future__ import annotations

import io
import os
import time
import uuid

from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel

import comfy
import compose as compose_mod
import paths
import r2
import workflows

app = FastAPI(title="Invisible Atlas Backend")


def _safe_key(key: str) -> str:
    try:
        return paths.safe_key(key)
    except ValueError as e:  # noqa: BLE001
        raise HTTPException(400, str(e))


def _safe_output_prefix(prefix: str) -> str:
    try:
        return paths.safe_output_prefix(prefix)
    except ValueError as e:  # noqa: BLE001
        raise HTTPException(400, str(e))


def _comfy_base(override: str | None) -> str:
    base = override or os.environ.get("COMFY_URL")
    if not base:
        raise HTTPException(400, "No ComfyUI URL (set COMFY_URL or pass comfy_url).")
    return base


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/comfy/stats")
def comfy_stats(comfy_url: str | None = None) -> dict:
    try:
        return comfy.system_stats(_comfy_base(comfy_url))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"ComfyUI unreachable: {e}")


class GenerateTest(BaseModel):
    prompt: str
    negative: str = ""
    ckpt: str | None = None
    width: int = 1024
    height: int = 1024
    steps: int = 30
    cfg: float = 7.0
    seed: int | None = None
    comfy_url: str | None = None
    client: str | None = None
    project: str | None = None


class GenerateTest(BaseModel):
    prompt: str
    negative: str = ""
    ckpt: str | None = None
    width: int = 1024
    height: int = 1024
    steps: int = 30
    cfg: float = 7.0
    seed: int | None = None
    comfy_url: str | None = None
    client: str | None = None
    project: str | None = None


@app.post("/generate-test")
def generate_test(req: GenerateTest) -> dict:
    base = _comfy_base(req.comfy_url)
    ckpt = req.ckpt or os.environ.get("DEFAULT_CKPT", "juggernautXL_ragnarokBy.safetensors")
    graph, seed = workflows.sdxl_txt2img(
        ckpt,
        req.prompt,
        req.negative,
        req.width,
        req.height,
        req.steps,
        req.cfg,
        seed=req.seed,
    )

    extra: dict = {}
    org_key = os.environ.get("COMFY_ORG_API_KEY")
    if org_key:
        extra["api_key_comfy_org"] = org_key

    try:
        prompt_id = comfy.submit_prompt(base, graph, extra or None)
        images = comfy.wait_images(base, prompt_id)
        img_bytes = comfy.fetch_image(base, images[0])
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Generation failed: {e}")

    prefix = paths.project_prefix(req.client, req.project)
    key = f"{prefix}/test/{int(time.time())}_{uuid.uuid4().hex[:8]}.png"
    r2.put(key, img_bytes, "image/png")
    return {"ok": True, "seed": seed, "ckpt": ckpt, "r2_key": key, "images": len(images)}


class GenerateRegion(BaseModel):
    config: dict  # the atlas_config (checkpoint, lora, controlnet, ksampler, …)
    region: dict  # one manifest region (name, prompt, seed, overrides…)
    style: dict = {}  # manifest "style" (positive_prefix/suffix, negative)
    refs: dict = {}  # {"style_ref": "<r2_key>", "shape_ref": "<r2_key>"}
    # Output location is derived server-side as atlas_maker/<client>/<project>;
    # both fall back to env (IW_*_NAME > ATLAS_* > unassigned/cloud) when unset.
    client: str | None = None
    project: str | None = None
    comfy_url: str | None = None


@app.post("/generate-region")
def generate_region(req: GenerateRegion) -> dict:
    base = _comfy_base(req.comfy_url)
    region = dict(req.region)
    prefix = paths.project_prefix(req.client, req.project)

    # Upload each R2-stored reference to ComfyUI and point the region at the
    # uploaded name, so the SDXL LoadImage nodes resolve them.
    for ref_key in ("style_ref", "shape_ref"):
        r2_key = req.refs.get(ref_key)
        if not r2_key:
            continue
        r2_key = _safe_key(r2_key)
        try:
            data = r2.get(r2_key)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(404, f"Reference '{r2_key}' not in R2: {e}")
        fname = f"{uuid.uuid4().hex}_{os.path.basename(r2_key)}"
        try:
            region[ref_key] = comfy.upload_image(base, fname, data)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(502, f"Uploading reference to ComfyUI failed: {e}")

    graph, seed = workflows.sdxl_region(req.config, region, req.style, prefix)

    extra: dict = {}
    org_key = os.environ.get("COMFY_ORG_API_KEY")
    if org_key:
        extra["api_key_comfy_org"] = org_key

    try:
        prompt_id = comfy.submit_prompt(base, graph, extra or None)
        images = comfy.wait_images(base, prompt_id)
        img_bytes = comfy.fetch_image(base, images[0])
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Generation failed: {e}")

    name = region.get("name", "region")
    key = f"{prefix}/batch/{name}/{seed}_{uuid.uuid4().hex[:6]}.png"
    r2.put(key, img_bytes, "image/png")
    return {"ok": True, "region": name, "seed": seed, "r2_key": key, "images": len(images)}


class ComposeAtlas(BaseModel):
    atlas_key: str  # R2 key of the .atlas geometry file
    images: dict[str, str]  # region_name -> R2 key of that region's image
    # Caller-chosen output location (driven by the atlas manifest's export
    # layout) but CONFINED to the atlas_maker/ namespace (see _safe_output_prefix).
    output_prefix: str  # R2 prefix; writes <prefix>.png and <prefix>.webp
    padding_pct: float = 0.12


@app.post("/compose")
def compose_atlas(req: ComposeAtlas) -> dict:
    out_prefix = _safe_output_prefix(req.output_prefix)
    atlas_bytes = r2.get(_safe_key(req.atlas_key))
    if atlas_bytes is None:
        raise HTTPException(404, f"Atlas not found in R2: {req.atlas_key}")
    atlas_text = atlas_bytes.decode("utf-8", "replace")

    imgs: dict[str, Image.Image] = {}
    for region_name, key in req.images.items():
        data = r2.get(_safe_key(key))
        if data is None:
            raise HTTPException(404, f"Region image not in R2: {key}")
        imgs[region_name] = Image.open(io.BytesIO(data))

    png, webp, placed = compose_mod.compose(atlas_text, imgs, req.padding_pct)
    r2.put(f"{out_prefix}.png", png, "image/png")
    r2.put(f"{out_prefix}.webp", webp, "image/webp")
    return {
        "ok": True,
        "placed": placed,
        "png_key": f"{out_prefix}.png",
        "webp_key": f"{out_prefix}.webp",
    }


class SliceAtlas(BaseModel):
    atlas_key: str  # R2 key of the .atlas geometry
    source_key: str  # R2 key of the source page image
    # Caller-chosen output location (driven by the atlas manifest's export
    # layout) but CONFINED to the atlas_maker/ namespace (see _safe_output_prefix).
    output_prefix: str  # crops written to <prefix>/<region>.png


@app.post("/slice")
def slice_atlas(req: SliceAtlas) -> dict:
    out_prefix = _safe_output_prefix(req.output_prefix)
    atlas_bytes = r2.get(_safe_key(req.atlas_key))
    if atlas_bytes is None:
        raise HTTPException(404, f"Atlas not found in R2: {req.atlas_key}")
    source_bytes = r2.get(_safe_key(req.source_key))
    if source_bytes is None:
        raise HTTPException(404, f"Source image not in R2: {req.source_key}")

    crops = compose_mod.slice_atlas(
        atlas_bytes.decode("utf-8", "replace"), Image.open(io.BytesIO(source_bytes))
    )
    written: dict[str, str] = {}
    for name, img in crops.items():
        buf = io.BytesIO()
        img.save(buf, "PNG")
        key = f"{out_prefix}/{name}.png"
        r2.put(key, buf.getvalue(), "image/png")
        written[name] = key
    return {"ok": True, "count": len(written), "refs": written}
