"""ComfyUI workflow builders. First slice: a minimal SDXL txt2img graph to
prove the cloud->ComfyUI->R2 chain. The full Atlas Maker pipelines (refs,
ControlNet, IPAdapter, FLUX, gpt_image) will be ported here next."""
from __future__ import annotations

import random


def sdxl_txt2img(
    ckpt: str,
    positive: str,
    negative: str = "",
    width: int = 1024,
    height: int = 1024,
    steps: int = 30,
    cfg: float = 7.0,
    sampler: str = "euler",
    scheduler: str = "normal",
    seed: int | None = None,
) -> tuple[dict, int]:
    if seed is None:
        seed = random.randint(0, 2**32 - 1)
    graph = {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1},
        },
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": positive, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["4", 1]}},
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": sampler,
                "scheduler": scheduler,
                "denoise": 1.0,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": "atlas_backend/test", "images": ["8", 0]},
        },
    }
    return graph, seed
