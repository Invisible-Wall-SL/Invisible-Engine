# Blueprint catalogue — DRAFT cards

A draft `card.json` (ADR-0008 §2) for every blueprint in the Atlas Maker library, written to be
corrected fast: **every guess is marked "(check)"**. Once the owner has corrected a card it becomes
`services/atlas-tool/blueprints_src/<id>/card.json` (bundled blueprints) or is saved from Atlas
Maker's ✎ Card editor (published ones), with `status: reviewed`.

**What this draft covers and what it cannot.** This sandbox has no R2 credentials, so the
published library at `_shared/blueprints/` could not be read. The four cards below are the BUNDLED
blueprints, read from `services/atlas-tool/blueprints_src/<id>/{blueprint.json,workflow.json}` and
`docs/tools/atlas-maker.md`. Section 6 lists the published blueprints the status docs mention
(ids unknown) so nothing is invented; their cards are written when the folder arrives. Nothing in
this file is a blueprint that does not exist.

Field meanings follow the ADR's `card.json`; a card is shown here as a readable table plus the
JSON the owner can paste. `gpu.secondsPerImage` is **execution time of one image, warm worker**;
the serverless cold start (image pull plus model load) is listed separately because the first job
of a batch pays it and later ones do not (check).

---

## 1. `sdxl` — SDXL + LoRA + IPAdapter style ref (built-in)

Graph (`workflow.json`): `CheckpointLoaderSimple` (juggernautXL_ragnarokBy) → `LoraLoader`
(gameIconInstitute3d_v10, 0.85) → `IPAdapterUnifiedLoader` PLUS (high strength) →
`IPAdapterAdvanced` (weight 0.35, style transfer) from `LoadImage` (style ref) → `CLIPTextEncode`
×2 → `EmptyLatentImage` 1024² → `KSampler` (35 steps, cfg 8.5, dpmpp_2m karras) → `VAEDecode` →
`RMBG` (RMBG-2.0, Alpha) → `SaveImage`. Roles bound: positive, negative, seed, width, height,
style_ref, output. No `shape_ref` (the built-in builder adds ControlNet dynamically; this static
graph cannot). Params: `steps` 1–150 (35), `cfg` 1–20 (8.5), `sampler_name` (dpmpp_2m).

| Field | Draft value |
|---|---|
| Purpose | Text-to-image for icon-style game art (symbols, coins, buttons, plaques) with an optional style image, cut to alpha. |
| When to use | Symbols, coins and jackpot icons, UI buttons, plaques, logos as single objects on transparency; anything the template shows as a cut-out tile. The LoRA gives a glossy 3D icon look (check). The default generate step for the Symbols, Coins & jackpots and UI kit groups (check). |
| When NOT to use | Full-bleed backgrounds and reel frames: the `RMBG` node at the end cuts the scenery to a cut-out (the guide's known gotcha). Painterly or flat 2D styles when the icon LoRA fights the prompt (check). Text or lettering (SDXL mis-spells; use Font Maker). Anything that needs a silhouette (no `shape_ref` here; use the built-in `sdxl` pipeline with ControlNet, or a blueprint that binds `shape_ref`). |
| Required inputs | `prompt` required (the atlas style prefix/suffix + region prompt); `negative` optional; `reference` optional (`style_ref` → IPAdapter, 0.35 weight: a mood/style image, e.g. the mockup crop under fidelity `match`); `shape`, `sourceImage`, `mask`, `layer`: none. |
| Outputs | One RGBA PNG per variant, background removed, at `width × height`. |
| Exposed settings | `steps` default 35; drafts 22–28, finals 35–40 (check). `cfg` default 8.5; 6–9 (check). `sampler_name` default dpmpp_2m; euler_ancestral for softer drafts (check). Gen size (role `width`/`height`): drafts 512, finals 1024, max 1536 (SDXL is trained at 1024; 2048 tiles and repeats) (check). Not exposed but relevant: LoRA strength 0.85 is baked — a painterly brief cannot lower it without a re-published blueprint (check). |
| Chain position | **generate**. Follows: nothing. Precedes: a cutout/matting blueprint when RMBG-2.0's edge is not clean enough (check), an upscale, `fx` layers (`_glow`, `_shadow`). |
| GPU seconds per image | 512: ~5 s · 1024: ~12 s · 1536: ~28 s (L40S, warm) (check). Cold start 60–180 s per batch (check). `estimate-profiles.json`'s placeholder says 12–30 s at 1024. |
| Variants | drafts 3, finals 1, max 6 (check). |
| Gotchas | RMBG-2.0 is inside the graph: an opaque plate or a framed scene comes back as a cut-out. IPAdapter at 0.35 copies colour and texture, not composition: do not expect the layout of the crop. The checkpoint and LoRA licences are non-commercial in `docs/reference/model-licences.md` (check before shipping art). A locked seed + an unchanged prompt re-renders the same image: lock only approved picks. |

```json
{ "version": 1, "id": "sdxl", "status": "draft", "rev": 1, "graphSha": "(check)",
  "purpose": "Text-to-image for icon-style game art with an optional style image, cut to alpha.",
  "whenToUse": ["symbols, coins and jackpot icons, buttons, plaques, single-object logos",
                "the default generate step for Symbols, Coins & jackpots and UI kit (check)"],
  "whenNotToUse": ["full-bleed backgrounds and reel frames: RMBG cuts the scenery",
                   "painterly or flat styles the icon LoRA fights (check)", "lettering",
                   "anything that needs a silhouette: no shape_ref binding"],
  "inputs": {"prompt": "required", "negative": "optional", "reference": "optional",
             "shape": "none", "sourceImage": "none", "mask": "none", "layer": "none"},
  "outputs": {"kind": "image", "alpha": true, "count": 1},
  "settings": [
    {"key": "steps", "default": 35, "min": 20, "max": 45, "note": "22-28 for drafts (check)"},
    {"key": "cfg", "default": 8.5, "min": 6, "max": 9},
    {"key": "sampler_name", "default": "dpmpp_2m", "note": "euler_ancestral for softer drafts (check)"},
    {"key": "width", "draft": 512, "final": 1024, "max": 1536, "note": "SDXL is trained at 1024 (check)"}
  ],
  "chain": {"position": "generate", "follows": [], "precedes": ["cutout", "upscale", "fx"]},
  "gpu": {"secondsPerImage": {"512": 5, "1024": 12, "1536": 28}, "coldStart": 120, "source": "guess"},
  "variants": {"draft": 3, "final": 1, "max": 6},
  "gotchas": ["RMBG is inside the graph: plates and scenes come back as cut-outs",
              "IPAdapter copies colour and texture, not composition",
              "checkpoint and LoRA licences: see docs/reference/model-licences.md (check)",
              "LoRA strength 0.85 is baked, not a param (check)"] }
```

---

## 2. `flux` — FLUX.1 dev + LoRA + Redux style ref (built-in)

Graph: `UNETLoader` (flux1-dev, fp8_e4m3fn) + `DualCLIPLoader` (t5xxl_fp16, clip_l) + `VAELoader`
(ae) → `LoraLoaderModelOnly` (flux_lora, 0.9) → `CLIPTextEncode` (positive; negative is the empty
string and NOT bound) → `FluxGuidance` 3.5 → `EmptySD3LatentImage` 1024² → `KSampler` (20 steps,
cfg 1.0, euler simple) → `VAEDecode` → `RMBG` (RMBG-2.0, Alpha) → `SaveImage`; Redux branch:
`LoadImage` (style ref) → `CLIPVisionEncode` (sigclip) → `StyleModelApply` (flux1-redux-dev,
strength 1.0). Roles bound: positive, seed, width, height, style_ref, output. No params exposed.
`blueprint.json` says: "UNVERIFIED against a live GPU — owner-side verify owed" (the built-in flux
*pipeline* is proven on RunPod; this *blueprint* mirror is not).

| Field | Draft value |
|---|---|
| Purpose | Text-to-image with prose prompts and strong style transfer from a reference image; better composition and text adherence than SDXL, slower. |
| When to use | Backgrounds and scenes once the cutout is off (see gotchas), reel frames, win banners' artwork, hero characters, anything whose brief is a paragraph rather than tags; when the mockup crop should drive the whole look (Redux at 1.0 copies the reference hard) under fidelity `match` (check). |
| When NOT to use | Small icons where SDXL's LoRA look is wanted (check); anything needing a negative prompt (FLUX has none; say what you want instead); a silhouette (no `shape_ref`; the built-in flux pipeline has a ControlNet path but this graph does not); tight budgets: ~3× SDXL's seconds (check). |
| Required inputs | `prompt` required (prose); `negative`: none (unbound by design); `reference` optional but with Redux at 1.0 it dominates the prompt (check); `shape`, `sourceImage`, `mask`, `layer`: none. |
| Outputs | One RGBA PNG per variant, background removed. |
| Exposed settings | None in `params`. Gen size (`width`/`height`): drafts 768, finals 1024–1536, max 2048 (FLUX holds up at 1536) (check). `steps` 20 and `guidance` 3.5 are baked (check); a reviewed re-publish should expose `steps`, `guidance`, `strength` (Redux) and `strength_model` (LoRA), because "Redux strength 0 = prompt takes over" is the knob the technician needs most (check). |
| Chain position | **generate**. Precedes: upscale (a 1024 FLUX render upscaled beats a 2048 render for cost) (check), cutout, fx. |
| GPU seconds per image | 768: ~18 s · 1024: ~32 s · 1536: ~75 s (L40S, fp8, 20 steps) (check). Cold start 120–240 s: the fp8 UNet + T5 are ~17 GB to load (check). Needs ≥ 24 GB VRAM: on the RTX 4090 (24 GB) it is tight at 1536 (check). |
| Variants | drafts 2, finals 1, max 4 (check). |
| Gotchas | RMBG is inside the graph, so a background render comes back cut out — the card must say "re-publish without RMBG for scenes" until such a blueprint exists in the library (check whether one is published). The baked `flux_lora.safetensors` is a placeholder name: `models[]` lists the FLUX core files only; if the LoRA is not on the volume the render is refused by `assert_graph_models_present` (check what the volume holds). FLUX.1-dev is non-commercial (`model-licences.md`): shippable art needs a licence or the klein variant (check). Redux at 1.0 with a mockup crop reproduces the crop's style AND subject: lower it (needs the param) or drop the ref for a fresh composition. |

```json
{ "version": 1, "id": "flux", "status": "draft", "rev": 1, "graphSha": "(check)",
  "purpose": "Text-to-image with prose prompts and strong style transfer from a reference image.",
  "whenToUse": ["backgrounds, reel frames, banner artwork, hero characters (check)",
                "paragraph briefs; a crop that should drive the whole look (fidelity match)"],
  "whenNotToUse": ["small icons wanting the SDXL LoRA look (check)", "briefs that need a negative prompt",
                   "silhouettes (no shape_ref)", "tight budgets: ~3x SDXL seconds (check)"],
  "inputs": {"prompt": "required", "negative": "none", "reference": "optional",
             "shape": "none", "sourceImage": "none", "mask": "none", "layer": "none"},
  "outputs": {"kind": "image", "alpha": true, "count": 1},
  "settings": [
    {"key": "width", "draft": 768, "final": 1024, "max": 2048, "note": "1536 holds up (check)"}
  ],
  "chain": {"position": "generate", "follows": [], "precedes": ["upscale", "cutout", "fx"]},
  "gpu": {"secondsPerImage": {"768": 18, "1024": 32, "1536": 75}, "coldStart": 180, "source": "guess"},
  "variants": {"draft": 2, "final": 1, "max": 4},
  "gotchas": ["RMBG is inside the graph: scenes come back cut out",
              "flux_lora.safetensors is a placeholder name; missing from the volume = refused (check)",
              "FLUX.1-dev is non-commercial (model-licences.md) (check)",
              "Redux at 1.0 reproduces the reference's subject; no param to lower it yet",
              "unverified as a driven blueprint on a live GPU (blueprint.json)"] }
```

---

## 3. `gpt_image` — GPT-Image edit from a reference (built-in)

Graph: `LoadImage` (style ref) → `OpenAIGPTImage1` (model gpt-image-2, quality low, background
opaque, n 1, size 1024×1024, prompt, seed) → `Images to RGB` → `RMBG` (RMBG-2.0, Alpha) →
`SaveImage`. Roles bound: positive (→ `prompt`), seed, style_ref, output. No width/height (the
node's `size` enum is baked), no params. Runs on comfy.org credits (`COMFY_ORG_API_KEY`), not on
the GPU: only the RMBG pass and the wait use the worker. `blueprint.json`'s caveat: driven through
the generic runner, `positive` receives the combined style+region prompt, NOT the region's
`gpt_prompt`, and the built-in builder's size / quality / background / match-ref logic is skipped —
so this blueprint does not match the built-in `gpt_image` pipeline.

| Field | Draft value |
|---|---|
| Purpose | Edit or restyle a given image with an instruction ("make it gold", "same button, ruby instead of emerald"); strong at following instructions and at legible text. |
| When to use | Variations of an existing asset (recolour a plaque, swap a gem), a logo or wordmark where legible lettering matters (check), a quick restyle of a mockup crop under fidelity `match` when SDXL drifts (check). |
| When NOT to use | Batches of many drafts (per-image API cost, slow: 20–60 s wall each) (check); anything that needs transparency from the model (it returns opaque; RMBG cuts it, which fails on plates and scenes); anything that must be reproducible (the seed is cosmetic for an API model) (check); when the brief is a tag list (write an instruction instead). |
| Required inputs | `prompt` required (an EDIT INSTRUCTION, written by the artist as prose); `reference` **required** (the image to edit: `style_ref` is the only image input; with no ref the node has nothing to edit) (check); `negative`, `shape`, `sourceImage`, `mask`, `layer`: none. |
| Outputs | One RGBA PNG, 1024² (the baked `size`), background removed by RMBG. |
| Exposed settings | None. A reviewed re-publish should expose `quality` (low/medium/high), `size` (1024×1024 / 1536×1024 / 1024×1536) and `background` (opaque/transparent, letting RMBG be skipped) (check). Gen size: fixed 1024 (role not bound). |
| Chain position | **generate** (as an edit of a source) or **process** (restyle of a rendered variant: `refs.style` = the SDXL pick). Precedes: cutout, fx. |
| GPU seconds per image | ~2 s GPU (RMBG only) plus 20–60 s API wall time at `quality: low` (check). Billed on comfy.org credits per image, NOT in RunPod seconds: the estimate needs a `creditsPerImage` field on this card (check the price). The worker still bills the RunPod seconds the wait takes (execution + delay). |
| Variants | drafts 1–2, finals 1, max 2 (check). |
| Gotchas | Needs `COMFY_ORG_API_KEY` on the worker (the node self-authenticates); the `/credits` route shows the balance. Returns opaque images: `background: opaque` is baked, so RMBG runs on everything. The driven blueprint ignores the card's `gpt_prompt` field (use `prompt`). Content-policy refusals come back as a failed job, not an image (check). |

```json
{ "version": 1, "id": "gpt_image", "status": "draft", "rev": 1, "graphSha": "(check)",
  "purpose": "Edit or restyle a given image with a written instruction; legible text.",
  "whenToUse": ["variations of an existing asset (recolour, swap a gem)",
                "logos and wordmarks where lettering must read (check)",
                "a quick restyle of a mockup crop under fidelity match (check)"],
  "whenNotToUse": ["many drafts (per-image API cost, slow)", "assets that need model-side transparency",
                   "reproducible renders (seed is cosmetic) (check)", "tag-list briefs"],
  "inputs": {"prompt": "required", "negative": "none", "reference": "required",
             "shape": "none", "sourceImage": "none", "mask": "none", "layer": "none"},
  "outputs": {"kind": "image", "alpha": true, "count": 1, "fixedPx": 1024},
  "settings": [],
  "chain": {"position": "generate", "follows": ["sdxl", "flux"], "precedes": ["cutout", "fx"]},
  "gpu": {"secondsPerImage": {"1024": 2}, "apiWallSeconds": 40, "creditsPerImage": "(check)",
          "coldStart": 60, "source": "guess"},
  "variants": {"draft": 1, "final": 1, "max": 2},
  "gotchas": ["needs COMFY_ORG_API_KEY; billed in comfy.org credits, not GPU seconds",
              "returns opaque images: RMBG runs on everything",
              "the driven blueprint uses prompt, not the card's gpt_prompt",
              "policy refusals fail the job (check)"] }
```

---

## 4. `wan22_i2v_flipbook` — Wan 2.2 image-to-video for the Flipbook (built-in, `kind: video`)

Graph (41 nodes): `LoadImage` (source frame) → `WanImageToVideo` (640², frames =
floor(duration × fps + 1) = 81) → two-stage `KSamplerAdvanced` (high-noise then low-noise Wan 2.2
I2V A14B fp8, with 4-step lightx2v LoRAs when `fast_lora` is on, else `steps`/`cfg`) →
`VAEDecode` → `ImageScale` (320²) → optional `BiRefNetRMBG` (toonout) → `SaveAnimatedWEBP`.
Roles: positive, negative, seed, style_ref (the source still), output. `width`/`height`
deliberately unbound (the atlas gen size would blow up VRAM on 81 frames). Params: `duration`
(5 s), `fps` (16), `gen_width`/`gen_height` (640), `fast_lora` (true), `steps` (20, quality mode
only), `cfg` (3.5, quality mode only), `out_width`/`out_height` (320), `lossless` (false),
`quality` (90), `remove_background` (true), `birefnet_model` (BiRefNet_toonout), `sensitivity`,
`mask_blur`, `mask_offset`, `refine_foreground`, `invert_output`, `background` (Alpha),
`background_color`.

| Field | Draft value |
|---|---|
| Purpose | Animate a still (an approved symbol, a coin, a piece of art) into a short loop whose frames become a Flipbook clip. |
| When to use | Symbol win animations, coin spins, banner shimmer, when the template plays a flipbook clip for that symbol state and no Spine rig covers it (check). Only ever from the Flipbook video session; **not offered to the atlas technician** (`kind: video` is filtered out of the image listing, and the Flipbook's packer, not Atlas Maker, consumes the WEBP). A future animator recipe step (check). |
| When NOT to use | Anything that needs a rigged, re-timeable animation (use Rigger); still art; more than ~5 s (81 frames is the tested batch; longer multiplies VRAM and time); frame sizes above 320 output without raising `out_width` and the sheet budget (check). |
| Required inputs | `sourceImage` required (`style_ref` = the still, ideally the approved region tile on alpha); `prompt` required (motion description); `negative` optional; `reference`, `shape`, `mask`, `layer`: none. |
| Outputs | One animated WEBP (81 frames at 16 fps by default, 320² frames, alpha when `remove_background`); the Flipbook packs it into a sheet + clip. |
| Exposed settings | `duration` 0.5–10 (5); `fps` 1–30 (16); `gen_width`/`gen_height` 256–1280 step 16 (640; 640 is the tested size); `fast_lora` true (4 steps; turn off for quality mode with `steps` 20–30 and `cfg` 3–4) (check); `out_width`/`out_height` 64–1024 (320); `remove_background` true with `birefnet_model` BiRefNet_toonout (toon art) or BiRefNet-general (photo-real) (check); `mask_offset` 5 (grow the matte a little so edges are not eaten) (check); `lossless` false (a lossless WEBP can exceed the job payload cap: card gotcha). |
| Chain position | **generate** (video). Follows: an approved still from `sdxl`/`flux`/`gpt_image`. Precedes: the Flipbook's frame packer (`video_to_clip.py`), not an Atlas Maker step. |
| GPU seconds per clip | fast mode (4 steps, 640², 81 frames): ~150–240 s on an L40S; quality mode (20 steps): ~600–900 s (check). Cold start 180–300 s: two 14 GB UNets + the 6.7 GB text encoder (check). Needs a 48 GB card: the RTX 4090 (24 GB) is not enough for A14B fp8 at 81 frames (check). |
| Variants | drafts 2 (the Flipbook grid shows N variations), finals 1, max 4 (check). |
| Gotchas | `width`/`height` must stay unbound (blueprint.json explains why). `steps`/`cfg` are ignored while `fast_lora` is on. The output fps is wired to the generation fps so the preview cannot drift. The Wan 2.2 licence is Apache-2.0 (check `model-licences.md`). Keep `background: Alpha` for flipbook frames. |

```json
{ "version": 1, "id": "wan22_i2v_flipbook", "status": "draft", "rev": 1, "graphSha": "(check)",
  "purpose": "Animate a still into a short loop whose frames become a Flipbook clip.",
  "whenToUse": ["symbol win loops, coin spins, banner shimmer with no Spine rig (check)",
                "from the Flipbook video session only; never an Atlas Maker region step"],
  "whenNotToUse": ["rigged or re-timeable animation (Rigger)", "stills", "loops over ~5 s",
                   "frames above 320 without raising the sheet budget (check)"],
  "inputs": {"prompt": "required", "negative": "optional", "reference": "none", "shape": "none",
             "sourceImage": "required", "mask": "none", "layer": "none"},
  "outputs": {"kind": "video", "alpha": true, "count": 1, "frames": 81, "fps": 16},
  "settings": [
    {"key": "duration", "default": 5, "min": 1, "max": 6},
    {"key": "fps", "default": 16, "min": 8, "max": 24},
    {"key": "gen_width", "default": 640, "min": 512, "max": 768, "note": "640 is the tested size"},
    {"key": "gen_height", "default": 640, "min": 512, "max": 768},
    {"key": "fast_lora", "default": true, "note": "off = quality mode, ~4x the seconds (check)"},
    {"key": "out_width", "default": 320, "min": 128, "max": 512},
    {"key": "out_height", "default": 320, "min": 128, "max": 512},
    {"key": "remove_background", "default": true},
    {"key": "birefnet_model", "default": "BiRefNet_toonout", "note": "BiRefNet-general for photo-real (check)"},
    {"key": "mask_offset", "default": 5, "min": 0, "max": 10}
  ],
  "chain": {"position": "generate", "follows": ["sdxl", "flux", "gpt_image"], "precedes": ["flipbook-pack"]},
  "gpu": {"secondsPerImage": {"640": 200}, "qualityModeSeconds": {"640": 750}, "coldStart": 240,
          "minVramGb": 48, "source": "guess"},
  "variants": {"draft": 2, "final": 1, "max": 4},
  "gotchas": ["width/height must stay unbound", "steps/cfg ignored while fast_lora is on",
              "lossless WEBP can exceed the job payload cap", "keep background Alpha"] }
```

---

## 5. FX layers are not blueprints

The owner listed "glow" among the jobs. In Atlas Maker today a glow is an **FX layer**: a region
named `<base>_glow` (or `_shadow`, `_shine`, `_blur`, `_zoom`, `_colour`) with the matching mode,
computed by `shine.py` on the CPU from the base's committed pixels, rebuilt on every Create Atlas,
costing no GPU and no credits (guide §"FX layers"). The technician reaches it through
`atlas.add_layer {kind: 'fx', mode}` and the recipe's `layer` step, not through a card. If a GPU
glow/relight blueprint is published in R2, it gets a card like any other and sits at chain position
`finish` (check whether one exists).

## 6. Published blueprints the docs mention but this sandbox could not read

Listed so the owner can match them to the folder; **no card is drafted for any of these**, because
their `workflow.json` was not readable here and the task says not to invent. When the
`_shared/blueprints/` zip arrives, each gets a card in this file from its graph.

| Seen in | What it is | Draft card needs |
|---|---|---|
| `docs/status/atlas-maker.md` 2026-09-09 | A **background-removal** blueprint: `LoadImage → Rembg → SaveImage`, `style_ref` bound alone, `output` only. The report that produced "publishing does not select". | id; the rembg node and model; whether it keeps size; seconds (fast, CPU-bound on the worker?) (check). Chain position `process`; follows any generate; `inputs.sourceImage` required via `style_ref`. |
| same, 2026-09-09 | A **processing** blueprint: `LoadImage → UpscaleModelLoader → ImageUpscaleWithModel → SaveImage` (no seed, no prompt). The case that made `output` the only required role. | id; the upscale model and factor; output size rule (input × factor); seconds. Chain position `process` (`upscale`); precedes `cutout`/`fx`. |
| same, 2026-09-08 | A **FLUX img2img** blueprint authored against a live local ComfyUI (the runbook session). | id; the denoise/strength param; which ref role it binds (the runbook's `shape_ref` trap came from it). Chain position `process` (restyle) or `generate`. |
| same, 2026-09-07; `docs/status/comfyui.md` | **`characterdesignertest3`**: FLUX + PuLID face identity + a trained comic-style LoRA; R&D-pod models (`flux1-dev-fp8`, `comic-style-lora-000002`, `pulid_flux_v0.9.1`, `antelopev2`). | Whether it is in the production library at all: PuLID/antelopev2 are non-commercial and the pack is R&D-only (`nodes.json`), so it is probably NOT offerable to agents (check). |
| `docs/status/comfyui.md` 2026-09-07…16 | **Semantic layer extraction** graphs (`ComfyUI-SemanticLayers`: Analyze / Router over a Qwen layer decomposition; roles BACKGROUND / MAIN_CHARACTER / SECONDARY_CHARACTERS / ASSETS / ENVIRONMENT / EFFECTS / OTHER, RGBA outputs, the shared taxonomy at `_shared/semantic/taxonomy.yaml`), and the **SAM3 background-removal** graph (55 nodes, 23 types). The "⧉ Duplicate atlas" feature was built for these: one source sequence, one pass per extracted part. | ids; which output role each blueprint saves (`output` is one node, so one blueprint per extracted role, or one per pass with a `role` param?) (check); `inputs.sourceImage` required; seconds (Qwen decode is heavy) (check). Chain position `extract`; precedes `generate` (as a `style_ref`), `cutout`, `upscale`. The taxonomy is NOT a card setting (agents never write it). |

## 7. Default recipes per region group (for the New-game estimate, ADR-0008 §6)

Starting values for `estimate-profiles.json` `recipes`, all (check):

| Group | Chain |
|---|---|
| Symbols | `sdxl` 512 ×3 → `sdxl` 1024 ×1 (seed from the pick) → fx `_glow` |
| Coins & jackpots | `sdxl` 512 ×3 → `sdxl` 1024 ×1 → fx `_shine` |
| Backgrounds | `flux` 768 ×2 → `flux` 1536 ×1 (needs a no-RMBG flux card, see §2) → upscale (when published) |
| Reel frame & logo | `flux` 768 ×2 → `flux` 1024 ×1 → cutout (when published) |
| UI kit | `sdxl` 512 ×2 → `sdxl` 1024 ×1 |
| Win banners | `flux` 768 ×2 → `flux` 1024 ×1 → fx `_glow` |
