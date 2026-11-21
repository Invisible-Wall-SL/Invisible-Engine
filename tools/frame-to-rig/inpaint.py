"""Frame to rig, step 4 — make what each part hides (docs/design/frame-to-rig.md §4.4).

Every pixel a part loses under a part drawn in front of it must be made, or the rig shows a hole
when that part moves. One ComfyUI pass per part: the frame cropped around the part, the occluded
area greyed and noise-masked, the edit model told what continues there; outside the mask the
frame's own pixels are composited back, so nothing visible changes.

    python inpaint.py inputs  --out out/                   # after proof.py holes: crops, masks, prompts
    python inpaint.py graph   --out out/ --model qwen      # API graphs: Qwen-Image-Edit-2509 (RunPod)
    python inpaint.py graph   --out out/ --model klein     #             FLUX.2 [klein] base 4B (local)
    python inpaint.py run     --out out/ --model klein --comfy http://127.0.0.1:8188
    python inpaint.py merge   --out out/ --model klein     # results → whole parts → proof.py parts
    python inpaint.py repose  --out out/ --model klein [--run]  # the frame re-posed, arms down

Models (both Apache-2.0, read 2026-11-21): Qwen-Image-Edit-2509 (`Qwen/Qwen-Image-Edit-2509`) and
FLUX.2 [klein] base 4B (`black-forest-labs/FLUX.2-klein-base-4B`; the 9B klein is non-commercial).
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
import uuid
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

LONG_SIDE = 1024
BG = (255, 255, 255)
HOLE = (128, 128, 128)
GROW = 4  # px the mask grows past the occluded area, so the fill blends into the part's own pixels

KEEP = (
    " Keep everything outside the grey area exactly as it is: the same character, style, colours, "
    "lighting and line work. Do not draw anything in the white background."
)
PROMPTS = {
    "torso": "Fill the grey area with the rest of the body and its clothing as they continue behind "
    "where the arms and hands were: the same fabric, folds, print, colours and shading. Do not draw "
    "arms, hands or fingers.",
    "upper_arm": "Fill the grey area with the rest of the upper arm as it continues behind the forearm "
    "and hand in front of it: the same skin, muscles, tattoos and shading, ending in a rounded elbow. "
    "Do not draw a forearm, a hand or fingers.",
    "lower_arm": "Fill the grey area with the rest of the forearm as it continues behind the hand, up "
    "to the wrist: the same skin, jewellery and shading. Do not draw a hand or fingers.",
    "hand": "Fill the grey area with the rest of the hand and its fingers as they continue behind "
    "what covers them: the same skin, rings and shading.",
    "head": "Fill the grey area with the rest of the head and neck: the same skin, hair and shading.",
}


def prompt_for(part: str) -> str:
    kind = part.rsplit("_", 1)[0] if part[-2:] in ("_l", "_r") else part
    return PROMPTS.get(kind, PROMPTS["torso"]) + KEEP


def cmd_inputs(a) -> None:
    out = Path(a.out)
    d = out / "inpaint"
    d.mkdir(exist_ok=True)
    rgba = np.array(Image.open(out / "frame.png").convert("RGBA")).astype(np.float32)
    whole = dict(np.load(out / "whole.npz"))
    h, w = rgba.shape[:2]
    al = rgba[..., 3:4] / 255.0
    base = rgba[..., :3] * al + np.array(BG, np.float32) * (1 - al)
    jobs = []
    for key in sorted(whole):
        if not key.endswith("__occluded"):
            continue
        part = key[: -len("__occluded")]
        occ = whole[key]
        if occ.sum() < a.min_px:
            continue
        ys, xs = np.nonzero(whole[part])
        bw, bh = xs.max() - xs.min(), ys.max() - ys.min()
        pad = int(0.3 * max(bw, bh))
        x0, y0 = max(0, xs.min() - pad), max(0, ys.min() - pad)
        x1, y1 = min(w, xs.max() + pad), min(h, ys.max() + pad)
        k = LONG_SIDE / max(x1 - x0, y1 - y0)
        cw, ch = int(round((x1 - x0) * k / 16)) * 16, int(round((y1 - y0) * k / 16)) * 16
        mask = cv2.dilate(
            occ.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * GROW + 1,) * 2)
        )
        if a.context == "frame":
            img = base.copy()
        else:
            # The part alone: whatever is drawn in front of it is gone, so nothing in the picture
            # invites the model to draw it back (with the frame around it, klein drew the arms
            # back into the torso's hole).
            img = np.zeros_like(base) + np.array(BG, np.float32)
            own = whole[part] & ~occ
            img[own] = base[own]
        img[mask.astype(bool)] = HOLE
        crop = cv2.resize(img[y0:y1, x0:x1], (cw, ch), interpolation=cv2.INTER_CUBIC)
        mcrop = cv2.resize(mask[y0:y1, x0:x1] * 255, (cw, ch), interpolation=cv2.INTER_NEAREST)
        Image.fromarray(np.clip(crop, 0, 255).astype(np.uint8)).save(d / f"{part}.png")
        Image.fromarray(mcrop).save(d / f"{part}_mask.png")
        jobs.append(
            {
                "part": part,
                "box": [int(x0), int(y0), int(x1), int(y1)],
                "size": [cw, ch],
                "occluded_px": int(occ.sum()),
                "prompt": prompt_for(part),
            }
        )
    (d / "jobs.json").write_text(json.dumps(jobs, indent=1), encoding="utf8")
    print(json.dumps([{k: v for k, v in j.items() if k != "prompt"} for j in jobs], indent=1))


def graph(model: str, image: str, mask: str, prompt: str, size, seed: int) -> dict:
    """One inpaint pass as a ComfyUI API prompt. Node classes are ComfyUI core only."""
    w, h = size
    g: dict = {
        "load": {"class_type": "LoadImage", "inputs": {"image": image}},
        "mask_img": {"class_type": "LoadImage", "inputs": {"image": mask}},
        "mask": {
            "class_type": "ImageToMask",
            "inputs": {"image": ["mask_img", 0], "channel": "red"},
        },
        "save": {
            "class_type": "SaveImage",
            "inputs": {"images": ["out", 0], "filename_prefix": "frame_to_rig"},
        },
        "out": {
            "class_type": "ImageCompositeMasked",
            "inputs": {
                "destination": ["load", 0],
                "source": ["decode", 0],
                "x": 0,
                "y": 0,
                "resize_source": False,
                "mask": ["mask", 0],
            },
        },
    }
    if model == "qwen":
        g.update(
            {
                "unet": {
                    "class_type": "UNETLoader",
                    "inputs": {
                        "unet_name": "qwen_image_edit_2509_fp8_e4m3fn.safetensors",
                        "weight_dtype": "default",
                    },
                },
                "clip": {
                    "class_type": "CLIPLoader",
                    "inputs": {
                        "clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors",
                        "type": "qwen_image",
                        "device": "default",
                    },
                },
                "vae": {
                    "class_type": "VAELoader",
                    "inputs": {"vae_name": "qwen_image_vae.safetensors"},
                },
                "pos": {
                    "class_type": "TextEncodeQwenImageEditPlus",
                    "inputs": {
                        "clip": ["clip", 0],
                        "vae": ["vae", 0],
                        "image1": ["load", 0],
                        "prompt": prompt,
                    },
                },
                "neg": {
                    "class_type": "TextEncodeQwenImageEditPlus",
                    "inputs": {
                        "clip": ["clip", 0],
                        "vae": ["vae", 0],
                        "image1": ["load", 0],
                        "prompt": "",
                    },
                },
                "enc": {
                    "class_type": "VAEEncode",
                    "inputs": {"pixels": ["load", 0], "vae": ["vae", 0]},
                },
                "noise_mask": {
                    "class_type": "SetLatentNoiseMask",
                    "inputs": {"samples": ["enc", 0], "mask": ["mask", 0]},
                },
                "shift": {
                    "class_type": "ModelSamplingAuraFlow",
                    "inputs": {"model": ["unet", 0], "shift": 3.0},
                },
                "norm": {
                    "class_type": "CFGNorm",
                    "inputs": {"model": ["shift", 0], "strength": 1.0},
                },
                "sample": {
                    "class_type": "KSampler",
                    "inputs": {
                        "model": ["norm", 0],
                        "positive": ["pos", 0],
                        "negative": ["neg", 0],
                        "latent_image": ["noise_mask", 0],
                        "seed": seed,
                        "steps": 20,
                        "cfg": 2.5,
                        "sampler_name": "euler",
                        "scheduler": "simple",
                        "denoise": 1.0,
                    },
                },
                "decode": {
                    "class_type": "VAEDecode",
                    "inputs": {"samples": ["sample", 0], "vae": ["vae", 0]},
                },
            }
        )
    else:
        g.update(
            {
                "unet": {
                    "class_type": "UNETLoader",
                    "inputs": {
                        "unet_name": "flux-2-klein-base-4b-fp8.safetensors",
                        "weight_dtype": "default",
                    },
                },
                "clip": {
                    "class_type": "CLIPLoader",
                    "inputs": {
                        "clip_name": "qwen_3_4b.safetensors",
                        "type": "flux2",
                        "device": "default",
                    },
                },
                "vae": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
                "text": {
                    "class_type": "CLIPTextEncode",
                    "inputs": {"clip": ["clip", 0], "text": prompt},
                },
                "empty": {
                    "class_type": "CLIPTextEncode",
                    "inputs": {"clip": ["clip", 0], "text": ""},
                },
                "enc": {
                    "class_type": "VAEEncode",
                    "inputs": {"pixels": ["load", 0], "vae": ["vae", 0]},
                },
                "pos": {
                    "class_type": "ReferenceLatent",
                    "inputs": {"conditioning": ["text", 0], "latent": ["enc", 0]},
                },
                "neg": {
                    "class_type": "ReferenceLatent",
                    "inputs": {"conditioning": ["empty", 0], "latent": ["enc", 0]},
                },
                "noise_mask": {
                    "class_type": "SetLatentNoiseMask",
                    "inputs": {"samples": ["enc", 0], "mask": ["mask", 0]},
                },
                "guider": {
                    "class_type": "CFGGuider",
                    "inputs": {
                        "model": ["unet", 0],
                        "positive": ["pos", 0],
                        "negative": ["neg", 0],
                        "cfg": 5.0,
                    },
                },
                "sampler": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
                "sigmas": {
                    "class_type": "Flux2Scheduler",
                    "inputs": {"steps": 20, "width": w, "height": h},
                },
                "noise": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
                "sample": {
                    "class_type": "SamplerCustomAdvanced",
                    "inputs": {
                        "noise": ["noise", 0],
                        "guider": ["guider", 0],
                        "sampler": ["sampler", 0],
                        "sigmas": ["sigmas", 0],
                        "latent_image": ["noise_mask", 0],
                    },
                },
                "decode": {
                    "class_type": "VAEDecode",
                    "inputs": {"samples": ["sample", 0], "vae": ["vae", 0]},
                },
            }
        )
    return g


REPOSE = (
    "The same character standing with both arms hanging straight down at the sides, relaxed, hands "
    "open beside the thighs, facing the viewer. Keep the same character, face, hair, glasses, "
    "jewellery, clothing, tattoos, colours, lighting, art style, size and framing; plain white "
    "background."
)


def repose_graph(model: str, image: str, size, seed: int) -> dict:
    """The whole frame re-posed with the arms down (no mask): what the arms hid comes into view,
    and only those pixels are taken. Also the fallback for a limb the frame foreshortens."""
    w, h = size
    g = graph(model, image, image, REPOSE, size, seed)
    for n in ("mask_img", "mask", "noise_mask", "out"):
        g.pop(n)
    g["save"]["inputs"]["images"] = ["decode", 0]
    if model == "qwen":
        g["sample"]["inputs"]["latent_image"] = ["enc", 0]
    else:
        g["latent"] = {
            "class_type": "EmptyFlux2LatentImage",
            "inputs": {"width": w, "height": h, "batch_size": 1},
        }
        g["sample"]["inputs"]["latent_image"] = ["latent", 0]
    return g


def cmd_repose(a) -> None:
    out = Path(a.out)
    d = out / "inpaint"
    d.mkdir(exist_ok=True)
    rgba = np.array(Image.open(out / "frame.png").convert("RGBA")).astype(np.float32)
    al = rgba[..., 3:4] / 255.0
    base = rgba[..., :3] * al + np.array(BG, np.float32) * (1 - al)
    h, w = base.shape[:2]
    k = LONG_SIDE / max(w, h)
    size = [int(round(w * k / 16)) * 16, int(round(h * k / 16)) * 16]
    Image.fromarray(
        np.clip(cv2.resize(base, tuple(size), interpolation=cv2.INTER_CUBIC), 0, 255).astype(
            np.uint8
        )
    ).save(d / "repose.png")
    g = repose_graph(a.model, "ftr_repose.png", size, a.seed)
    (d / f"repose.{a.model}.api.json").write_text(json.dumps(g, indent=1), encoding="utf8")
    if a.comfy and a.run:
        _upload(a.comfy, d / "repose.png", "ftr_repose.png")
        t0 = time.time()
        img = _queue(a.comfy, g, a.timeout)
        (d / f"repose.{a.model}.out.png").write_bytes(img)
        print("repose", round(time.time() - t0, 1), "s")


def _queue(comfy: str, g: dict, timeout: float) -> bytes:
    pid = _post(f"{comfy}/prompt", json.dumps({"prompt": g}).encode(), "application/json")[
        "prompt_id"
    ]
    t0 = time.time()
    while True:
        time.sleep(3)
        with urllib.request.urlopen(f"{comfy}/history/{pid}", timeout=30) as r:
            hist = json.loads(r.read())
        if pid in hist:
            break
        if time.time() - t0 > timeout:
            _post(f"{comfy}/interrupt", b"{}", "application/json")
            raise SystemExit(f"gave up after {timeout:.0f} s (interrupted)")
    st = hist[pid].get("status", {})
    if st.get("status_str") == "error":
        raise SystemExit(json.dumps(st)[:2000])
    img = hist[pid]["outputs"]["save"]["images"][0]
    q = f"filename={img['filename']}&subfolder={img['subfolder']}&type={img['type']}"
    with urllib.request.urlopen(f"{comfy}/view?{q}", timeout=60) as r:
        return r.read()


def cmd_graph(a) -> None:
    d = Path(a.out) / "inpaint"
    jobs = json.loads((d / "jobs.json").read_text(encoding="utf8"))
    for j in jobs:
        g = graph(
            a.model,
            f"ftr_{j['part']}.png",
            f"ftr_{j['part']}_mask.png",
            j["prompt"],
            j["size"],
            a.seed,
        )
        (d / f"{j['part']}.{a.model}.api.json").write_text(json.dumps(g, indent=1), encoding="utf8")
    print(f"wrote {len(jobs)} graphs to {d}")


def _post(url: str, data: bytes, ctype: str) -> dict:
    req = urllib.request.Request(url, data=data, headers={"Content-Type": ctype})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def _upload(comfy: str, path: Path, name: str) -> None:
    b = uuid.uuid4().hex
    body = (
        (
            f'--{b}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\n'
            f"Content-Type: image/png\r\n\r\n"
        ).encode()
        + path.read_bytes()
        + f'\r\n--{b}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--{b}--\r\n'.encode()
    )
    _post(f"{comfy}/upload/image", body, f"multipart/form-data; boundary={b}")


def cmd_run(a) -> None:
    """Run each pass on a ComfyUI server, one at a time, and fetch the result (the proof's runner;
    the product queues these as atlas-tool jobs, never a wait loop in a request)."""
    d = Path(a.out) / "inpaint"
    jobs = json.loads((d / "jobs.json").read_text(encoding="utf8"))
    timing = {}
    for j in jobs:
        if a.only and j["part"] not in a.only.split(","):
            continue
        part = j["part"]
        _upload(a.comfy, d / f"{part}.png", f"ftr_{part}.png")
        _upload(a.comfy, d / f"{part}_mask.png", f"ftr_{part}_mask.png")
        g = json.loads((d / f"{part}.{a.model}.api.json").read_text(encoding="utf8"))
        t0 = time.time()
        (d / f"{part}.{a.model}.out.png").write_bytes(_queue(a.comfy, g, a.timeout))
        timing[part] = round(time.time() - t0, 1)
        print(part, timing[part], "s", flush=True)
    (d / f"timing.{a.model}.json").write_text(json.dumps(timing, indent=1), encoding="utf8")


def cmd_merge(a) -> None:
    """Paste each result back into the frame at the part's occluded pixels only: the part's
    whole image = its visible pixels, the frame's pixels where it overlaps a part behind, and the
    made pixels where a part in front covered it."""
    out = Path(a.out)
    d = out / "inpaint"
    jobs = json.loads((d / "jobs.json").read_text(encoding="utf8"))
    rgba = np.array(Image.open(out / "frame.png").convert("RGBA"))
    whole = dict(np.load(out / "whole.npz"))
    made = {}
    for j in jobs:
        p = d / f"{j['part']}.{a.model}.out.png"
        if not p.exists():
            continue
        x0, y0, x1, y1 = j["box"]
        res = np.array(Image.open(p).convert("RGB"))
        res = cv2.resize(res, (x1 - x0, y1 - y0), interpolation=cv2.INTER_AREA)
        full = rgba.copy()
        occ = whole[f"{j['part']}__occluded"]
        sub = full[y0:y1, x0:x1, :3]
        sub[occ[y0:y1, x0:x1]] = res[occ[y0:y1, x0:x1]]
        full[..., 3] = 255
        made[j["part"]] = full
    np.savez_compressed(out / f"made.{a.model}.npz", **made)
    print("merged", sorted(made))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd")
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="qwen", choices=["qwen", "klein"])
    ap.add_argument("--comfy", default="http://127.0.0.1:8188")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--min-px", dest="min_px", type=int, default=400)
    ap.add_argument("--only")
    ap.add_argument("--context", default="part", choices=["part", "frame"])
    ap.add_argument("--timeout", type=float, default=900)
    ap.add_argument("--run", action="store_true")
    args = ap.parse_args()
    {
        "inputs": cmd_inputs,
        "graph": cmd_graph,
        "run": cmd_run,
        "merge": cmd_merge,
        "repose": cmd_repose,
    }[args.cmd](args)
