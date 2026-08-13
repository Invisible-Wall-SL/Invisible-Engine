# Qwen Cartoon-Character Blueprint

A workflow for generating **classic-American modern-cartoon characters** on the
ComfyUI R&D pod ([docs/status/comfyui.md](../status/comfyui.md)), consistent enough
to feed the **Spine / Invisible Rigger** for animation.

> **Why Qwen and not FLUX/PuLID:** we ship *commercial* games, and the FLUX+PuLID+
> antelopev2 blueprint is **non-commercial** (FLUX.1/2 [dev] = paid BFL license;
> InsightFace antelopev2 = non-commercial research only) — fine for R&D, **not
> clearable for shipped assets**. **Qwen-Image is Apache-2.0** → commercially clean.
> See the licensing findings in the ComfyUI R&D pod history / INFRA notes.

Build the graph from ComfyUI's **own** Qwen template (correct node wiring for the
installed version), then apply the settings + prompts below. No untested JSON to debug.

## Models (on the shared volume — download once, all pods reuse)
All from the Apache-2.0 Comfy-Org build; native ComfyUI support, **no custom node**:

| File | → `ComfyUI/models/…` |
|---|---|
| `qwen_image_fp8_e4m3fn.safetensors` | `diffusion_models/` |
| `qwen_2.5_vl_7b_fp8_scaled.safetensors` | `text_encoders/` |
| `qwen_image_vae.safetensors` | `vae/` |
| `Qwen-Image-Lightning-8steps-V1.0.safetensors` (optional 8-step speedup) | `loras/` |

Download detached + resumable (16 connections) — see the exact `aria2c` commands in
the ComfyUI R&D pod history. Qwen FP8 ≈ **16 GB VRAM** (fits 24 GB; comfy on 32 GB).

## Stage 1 — Generate the character
1. **Base graph:** ComfyUI → **Workflow → Browse Templates → Qwen-Image** (auto-loads the three models).
2. **Speed LoRA:** add a **`LoraLoaderModelOnly`** between the model loader and the KSampler → `Qwen-Image-Lightning-8steps-V1.0.safetensors`, strength `1.0`.
3. **Settings** (tuned for the 8-step Lightning LoRA):

   | Setting | Value |
   |---|---|
   | Latent size | **1024 × 1536** (full-body) |
   | Steps | **8** |
   | CFG | **1.0** |
   | Sampler | **euler** |
   | Scheduler | **simple** |
   | Denoise | **1.0** |

4. **Positive prompt** (swap the bracketed description):
   > Full-body character design of [a plucky teenage inventor girl with round goggles and a tool belt], modern American cartoon style, bold clean black outlines, flat cel shading, simple geometric shapes, exaggerated expressive proportions, big expressive eyes, bright saturated colors, clean vector-like rendering, front-facing standing T-pose, plain solid white background, character reference sheet

5. **Negative prompt:**
   > photorealistic, 3d render, realistic skin, gradient shading, noisy, blurry, low quality, watermark, text, signature, busy background, cluttered, extra limbs, deformed hands

6. **Queue** and iterate the description until the character is right. The plain white
   background + T-pose is deliberate — it makes rigging clean.

## Stage 2 — Consistent turnarounds & expressions
Uses **Qwen-Image-Edit** (a *separate* model from the generator — one more small
download to the volume; get the exact files the same way as Stage 1). Commercial-safe,
**no InsightFace**.

- Feed the Stage-1 character in as the **reference image**.
- Prompt each variation, plain white background: *"same character, side profile view"* /
  *"…3/4 back view"* / *"…happy expression"* / *"…surprised expression"*, etc.
- Qwen Edit preserves the source identity → a **consistent turnaround + expression sheet**.

Alternative for tighter identity: train a **per-character LoRA** on the sheet (10–15 clean
crops) — pure Apache-safe, no face-recognition model.

## Stage 3 — Export to the Rigger
The plain-background turnaround/expression sheets → **Spine / the Invisible Rigger**
(bones, mesh, weights, animation) → drops into the game slots.

## Making it a reusable blueprint
Once a graph works, export it in ComfyUI (**Settings → Save (API Format)**) and upload it
as a shared **Atlas Maker blueprint** (Atlas Maker → ＋ New blueprint → bind the roles) so
the whole team can generate with it — see [invisible-blueprints.md](../design/invisible-blueprints.md).
