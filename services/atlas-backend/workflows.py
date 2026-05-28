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


def _resolve_text(region: dict, style: dict) -> tuple[str, str, int]:
    """Positive/negative/seed resolution (ported from batch_atlas)."""
    r_pos = str(region.get("prompt", "")).strip()
    if region.get("positive_replace"):
        prompt = r_pos
    else:
        parts = [
            str(style.get("positive_prefix", "")).strip(),
            r_pos,
            str(style.get("positive_suffix", "")).strip(),
        ]
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


def sdxl_region(cfg: dict, region: dict, style: dict, prefix: str = "atlas_maker/cloud") -> tuple[dict, int]:
    """Port of batch_atlas.build_workflow (SDXL branch): checkpoint -> LoRA ->
    IPAdapter(style_ref) -> CLIP -> optional ControlNet(shape_ref Canny) ->
    KSampler -> VAEDecode -> RMBG -> SaveImage.

    `region['style_ref']` / `region['shape_ref']` must already be ComfyUI image
    names (the caller uploads the R2 ref bytes to ComfyUI first). `cfg` is the
    atlas_config dict. Returns (graph, seed)."""
    prompt, negative, seed = _resolve_text(region, style)

    style_ref = region.get("style_ref") or cfg.get("mockup_image", "")
    shape_ref = region.get("shape_ref") or None

    try:
        cn_strength = float(region.get("controlnet_strength", cfg.get("controlnet_strength", 0.7)))
    except (TypeError, ValueError):
        cn_strength = float(cfg.get("controlnet_strength", 0.7))
    cn_end = region.get("controlnet_end_percent", cfg.get("controlnet_end_percent", 0.85))
    use_cn = bool(shape_ref) and cn_strength > 0

    positive_link = ["9", 0] if use_cn else ["10", 0]
    negative_link = ["9", 1] if use_cn else ["11", 0]

    ipa_weight = float(region.get("ipadapter_weight", cfg.get("ipadapter_weight", 0.35)))
    ipa_weight = max(-1.0, min(5.0, ipa_weight))

    wf: dict = {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": region.get("checkpoint") or cfg["checkpoint"]},
        },
        "2": {
            "class_type": "LoraLoader",
            "inputs": {
                "model": ["1", 0],
                "clip": ["1", 1],
                "lora_name": cfg["lora"],
                "strength_model": cfg.get("lora_strength", 0.85),
                "strength_clip": cfg.get("lora_strength", 0.85),
            },
        },
        "3": {"class_type": "LoadImage", "inputs": {"image": style_ref}},
        "12": {
            "class_type": "EmptyLatentImage",
            "inputs": {
                "width": int(cfg.get("gen_width", 1024)),
                "height": int(cfg.get("gen_height", 1024)),
                "batch_size": 1,
            },
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
                "weight_type": cfg.get("ipadapter_weight_type", "style transfer"),
                "combine_embeds": "concat",
                "start_at": 0.0,
                "end_at": 1.0,
                "embeds_scaling": "V only",
            },
        },
        "10": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 1], "text": prompt}},
        "11": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 1], "text": negative}},
        "13": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["6", 0],
                "positive": positive_link,
                "negative": negative_link,
                "latent_image": ["12", 0],
                "seed": seed,
                "steps": int(cfg.get("ksampler_steps", 35)),
                "cfg": float(cfg.get("ksampler_cfg", 8.5)),
                "sampler_name": "dpmpp_2m",
                "scheduler": "karras",
                "denoise": 1.0,
            },
        },
        "14": {"class_type": "VAEDecode", "inputs": {"samples": ["13", 0], "vae": ["1", 2]}},
        "16": {
            "class_type": "RMBG",
            "inputs": {
                "image": ["14", 0],
                "model": cfg.get("rmbg_model", "RMBG-2.0"),
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
                "filename_prefix": f"{prefix}/batch/{region['name']}",
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
        wf["8"] = {"class_type": "ControlNetLoader", "inputs": {"control_net_name": cfg["controlnet"]}}
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

    return wf, seed
