"""Atlas backend — generation service.

Runs on Railway. Submits ComfyUI workflows to a LOCAL ComfyUI reached over a
Cloudflare Tunnel (COMFY_URL), fetches the result, and stores it in R2.
This first slice exposes a minimal SDXL txt2img test to prove the chain.
"""
from __future__ import annotations

import os
import time
import uuid

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import comfy
import r2
import workflows

app = FastAPI(title="Invisible Atlas Backend")


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

    key = f"atlas/test/{int(time.time())}_{uuid.uuid4().hex[:8]}.png"
    r2.put(key, img_bytes, "image/png")
    return {"ok": True, "seed": seed, "ckpt": ckpt, "r2_key": key, "images": len(images)}
