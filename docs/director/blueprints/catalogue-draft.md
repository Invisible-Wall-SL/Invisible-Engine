# Blueprint catalogue — DRAFT cards

A draft `card.json` (ADR-0008 §2) for every pipeline id an Atlas Maker region can name, written
to be corrected fast: **every guess is marked "(check)"**. Once the owner has corrected a card it
becomes `services/atlas-tool/blueprints_src/<id>/card.json` (built-in and bundled ids) or is saved
from Atlas Maker's ✎ Card editor (published ones), with `status: reviewed`.

**Sources.** The three built-in cards (§A) describe what RUNS under the ids `sdxl`, `flux` and
`gpt_image`: the Python builders in `batch_atlas.py` with the Settings keys of `ui_server.py`
(`PER_ATLAS_KEYS`, `ADV_FIELDS`), not the reference graphs in `blueprints_src/`, which never run
under those ids. The seven library cards (§B) are read from the owner's export of R2
`_shared/blueprints/` (2026-10-06: each `blueprint.json` + `workflow.json`; the `graphSha` shown is
the canonical digest of that `workflow.json`), `docs/tools/atlas-maker.md`,
`docs/reference/model-licences.md` and `docs/status/atlas-maker.md`. The three built-in reference
blueprints were not in the export and need no library card.

Field meanings follow the ADR's `card.json`. `gpu.secondsPerImage` is the execution time of one
image on a warm worker; the serverless cold start is listed separately (the first job of a batch
pays it) (check all figures). Licences come from `model-licences.md`: **RMBG-2.0, the SDXL icon
LoRA, FLUX.1-dev, its VAE and Redux are all non-commercial**, so every built-in card carries a
licence gotcha the owner must settle before shipped art.

---

## A. Built-in pipelines

### A1. `sdxl` — SDXL checkpoint + icon LoRA, IPAdapter style ref, ControlNet shape ref, RMBG cutout

What runs: `build_workflow` (sdxl branch): `checkpoint` (default juggernautXL_ragnarokBy, per atlas
or per region) + `lora` (gameIconInstitute3d_v10 at `lora_strength` 0.85, always wired) →
**IPAdapter** only when the region has a `style_ref` (else the global `mockup_image`), at
`ipadapter_weight` → **ControlNet** (Canny, `controlnet` model) only when the region has a
`shape_ref` and `controlnet_strength` > 0, to `controlnet_end_percent` → KSampler
(`ksampler_steps`, `ksampler_cfg`) at `gen_width × gen_height` → **RMBG** (`rmbg_model`,
RMBG-2.0) unless `rembg` is off → variant PNG.

| Field | Draft value |
|---|---|
| Purpose | Text-to-image for icon-style game art on transparency, with an optional style image and an optional silhouette to follow. |
| When to use | Symbols, coins and jackpot icons, UI buttons, plaques, single-object logos; the default generate step for Symbols, Coins & jackpots and UI kit (check). With `shape_ref` = the template's own tile silhouette (a `sheet_src/` key) the new art keeps the old footprint, which is what fidelity `match` wants (check). |
| When NOT to use | Full-bleed backgrounds and reel frames with `rembg` on (the scenery is cut away); painterly or flat styles the icon LoRA fights (the LoRA cannot be removed, only weakened via `lora_strength`) (check); lettering (use Font Maker). |
| Required inputs | `prompt` required (atlas prefix + region prompt + suffix); `negative` optional; `reference` optional (IPAdapter, off when absent); `shape` optional (ControlNet, off when absent); `sourceImage`, `mask`, `layer`: none. |
| Outputs | One PNG per variant at the atlas's gen size, RGBA when `rembg` is on. |
| Exposed settings (per atlas) | `ksampler_steps` 35 → drafts 22–28, finals 35–40 (check); `ksampler_cfg` 8.5 → 6–9 (check); `lora_strength` 0.85 → 0.4–0.85 (check); `rembg` on (OFF for scenes and plates); `gen_width`/`gen_height` 1024 → drafts 512–768, finals 1024, max 1536 (check); `ipadapter_weight` 0.35 → 0.2–0.6 (check); `controlnet_strength` 0.6 → 0.3–0.9 and `controlnet_end_percent` → 0.4–0.8 (check); `checkpoint`, `lora`, `controlnet`, `rmbg_model` are model names from the volume (card lists the allowed ones). |
| Exposed settings (per region) | `ipadapter_weight`, `controlnet_strength`, `controlnet_end_percent`, `checkpoint`, `style_ref`, `shape_ref`, `fit_mode` (`contain` for symbols, `cover` for a wordmark in a square slot). Not settable by agents: anything only in the global config. |
| Chain position | **generate**. Precedes: `birefnet` (a cleaner matte than RMBG-2.0 on toon art) (check), `fx` layers the template has. |
| GPU seconds per image | 512: ~5 s · 1024: ~12 s · 1536: ~28 s (L40S, warm) (check); +ControlNet ~+3 s, +IPAdapter ~+2 s (check). Cold start 60–180 s (check). `estimate-profiles.json`'s placeholder says 12–30 s at 1024. |
| Variants | drafts 3, finals 1 (the pick), max 6 (check). |
| Gotchas | Licences: the LoRA is **blocked** and RMBG-2.0 **blocked**, the checkpoint conditional (`model-licences.md`). IPAdapter copies colour and texture, not composition. A `shape_ref` is normalised to a silhouette scaled to `shape_ref_fill_pct` of a 1024² canvas: a tiny fill % gives a dot. A locked region is skipped by Render selected (`already_generated`): lock only approved picks. The region's `pipeline` must be `""` or `sdxl` for this card to apply. |

```json
{ "version": 1, "id": "sdxl", "status": "draft", "rev": 1, "builtin": true,
  "purpose": "Text-to-image for icon-style game art on transparency, with optional style and silhouette refs.",
  "whenToUse": ["symbols, coins, jackpot icons, buttons, plaques, single-object logos",
                "default generate step for Symbols, Coins & jackpots, UI kit (check)",
                "shape_ref = the template tile's silhouette under fidelity match (check)"],
  "whenNotToUse": ["scenes and plates with rembg on", "styles the icon LoRA fights (check)", "lettering"],
  "inputs": {"prompt": "required", "negative": "optional", "reference": "optional", "shape": "optional",
             "sourceImage": "none", "mask": "none", "layer": "none"},
  "outputs": {"kind": "image", "alpha": true, "count": 1},
  "settings": [
    {"key": "ksampler_steps", "default": 35, "min": 20, "max": 45, "note": "22-28 for drafts (check)"},
    {"key": "ksampler_cfg", "default": 8.5, "min": 6, "max": 9},
    {"key": "lora_strength", "default": 0.85, "min": 0.4, "max": 0.85, "note": "lower for painterly (check)"},
    {"key": "rembg", "default": "on", "note": "off for scenes and plates"},
    {"key": "gen_width", "draft": 512, "final": 1024, "max": 1536},
    {"key": "gen_height", "draft": 512, "final": 1024, "max": 1536},
    {"key": "ipadapter_weight", "default": 0.35, "min": 0.2, "max": 0.6, "scope": "region"},
    {"key": "controlnet_strength", "default": 0.6, "min": 0.3, "max": 0.9, "scope": "region"},
    {"key": "controlnet_end_percent", "default": 0.6, "min": 0.4, "max": 0.8, "scope": "region"},
    {"key": "fit_mode", "default": "", "options": ["", "contain", "cover", "fill"], "scope": "region"}
  ],
  "chain": {"position": "generate", "follows": [], "precedes": ["birefnet", "fx"]},
  "gpu": {"secondsPerImage": {"512": 5, "1024": 12, "1536": 28}, "coldStart": 120, "source": "guess"},
  "variants": {"draft": 3, "final": 1, "max": 6}, "billing": "gpu", "licence": "blocked",
  "gotchas": ["LoRA and RMBG-2.0 licences are blocked, checkpoint conditional (model-licences.md)",
              "IPAdapter copies colour and texture, not composition",
              "shape_ref is normalised to a silhouette at shape_ref_fill_pct",
              "a locked region is skipped by Render selected"] }
```

### A2. `flux` — FLUX.1 dev, optional LoRA, Redux style ref, optional ControlNet, RMBG cutout

What runs: `build_workflow_flux`: `flux_unet` (flux1-dev, fp8 at load) or an all-in-one
`flux_checkpoint`, `flux_clip_t5` + `flux_clip_l`, `flux_vae` → optional `flux_lora` at
`flux_lora_strength` → **Redux** only when the region has a `style_ref` (else `mockup_image`), the
`flux_redux_style_model` is set and `redux_strength` > 0 → optional **ControlNet** (`flux_controlnet`)
when the region has a `shape_ref` → KSampler (`flux_steps`, `flux_guidance`, `flux_sampler`,
`flux_scheduler`, all global-only; cfg 1, empty negative) at the atlas gen size → RMBG unless
`rembg` is off → variant PNG. Proven on RunPod (txt2img and the ref/ControlNet path).

| Field | Draft value |
|---|---|
| Purpose | Text-to-image with prose prompts, better composition and adherence than SDXL, and a strong style transfer from a reference image; slower. |
| When to use | Backgrounds and scenes (with `rembg` OFF), reel frames, win-banner artwork, hero characters, paragraph briefs; when the mockup crop should drive the whole look (Redux at 1.0 copies the reference hard) under fidelity `match` (check). |
| When NOT to use | Small icons where the SDXL LoRA look is wanted (check); briefs that need a negative prompt (FLUX ignores it: say what you want); tight budgets (~3× SDXL seconds) (check). |
| Required inputs | `prompt` required (prose); `negative`: none; `reference` optional (Redux; `redux_strength` 0 = prompt only); `shape` optional (ControlNet, only when `flux_controlnet` is set); `sourceImage`, `mask`, `layer`: none. |
| Outputs | One PNG per variant at the atlas gen size, RGBA when `rembg` is on. |
| Exposed settings | Per atlas: `rembg` (OFF for scenes), `gen_width`/`gen_height` → drafts 768, finals 1024–1536, max 2048 (check); `lora`/`lora_strength` do not apply here (SDXL keys). Per region: `redux_strength` 1.0 → 0.3–0.8 for a fresh composition (check), `flux_lora_strength`, `controlnet_strength`, `controlnet_end_percent`, `style_ref`, `shape_ref`, `fit_mode`. Global-only, NOT agent-settable: `flux_steps` 20, `flux_guidance` 3.5, the model names. |
| Chain position | **generate**. Precedes: an upscale card (none reviewed yet: a 1024 render upscaled beats a 2048 render for cost) (check), `birefnet`, `fx`. |
| GPU seconds per image | 768: ~18 s · 1024: ~32 s · 1536: ~75 s (L40S, fp8, 20 steps) (check). Cold start 120–240 s (~17 GB of weights) (check). VRAM: comfortable on 48 GB; the endpoint card is `RUNPOD_ENDPOINT_GPU` (check which). |
| Variants | drafts 2, finals 1, max 4 (check). |
| Gotchas | FLUX.1-dev, its VAE and Redux are **blocked** licences (`model-licences.md`): shippable art needs a licence or a klein-based card. Redux at 1.0 with a mockup crop reproduces the crop's subject too: lower `redux_strength` or drop the ref. A wrong-family VAE is refused before the GPU runs (`wrong_family_vae`). `rembg` ON cuts a scene to a cut-out. |

```json
{ "version": 1, "id": "flux", "status": "draft", "rev": 1, "builtin": true,
  "purpose": "Text-to-image with prose prompts and strong style transfer from a reference image.",
  "whenToUse": ["backgrounds and scenes with rembg off, reel frames, banner art, hero characters (check)",
                "paragraph briefs; a crop that should drive the whole look (fidelity match)"],
  "whenNotToUse": ["small icons wanting the SDXL LoRA look (check)", "briefs needing a negative prompt",
                   "tight budgets: ~3x SDXL seconds (check)"],
  "inputs": {"prompt": "required", "negative": "none", "reference": "optional", "shape": "optional",
             "sourceImage": "none", "mask": "none", "layer": "none"},
  "outputs": {"kind": "image", "alpha": true, "count": 1},
  "settings": [
    {"key": "rembg", "default": "on", "note": "off for scenes"},
    {"key": "gen_width", "draft": 768, "final": 1024, "max": 2048},
    {"key": "gen_height", "draft": 768, "final": 1024, "max": 2048},
    {"key": "redux_strength", "default": 1.0, "min": 0, "max": 1.5, "scope": "region", "note": "0.3-0.8 for a fresh composition (check)"},
    {"key": "flux_lora_strength", "default": 0.9, "min": 0, "max": 1.2, "scope": "region"},
    {"key": "controlnet_strength", "default": 0.6, "min": 0.2, "max": 0.9, "scope": "region"},
    {"key": "fit_mode", "default": "", "options": ["", "contain", "cover", "fill"], "scope": "region"}
  ],
  "chain": {"position": "generate", "follows": [], "precedes": ["upscale", "birefnet", "fx"]},
  "gpu": {"secondsPerImage": {"768": 18, "1024": 32, "1536": 75}, "coldStart": 180, "source": "guess"},
  "variants": {"draft": 2, "final": 1, "max": 4}, "billing": "gpu", "licence": "blocked",
  "gotchas": ["FLUX.1-dev, ae and Redux licences are blocked (model-licences.md)",
              "Redux at 1.0 reproduces the reference's subject",
              "flux_steps and flux_guidance are global-only: not agent-settable",
              "rembg on cuts a scene to a cut-out"] }
```

### A3. `gpt_image` — GPT-Image edit from a reference (comfy.org credits)

What runs: `build_workflow_gpt`: the region's reference image (`style_ref`, else the atlas
`mockup_image`) → `OpenAIGPTImage1` with the region's **`gpt_prompt`** (not the atlas prompt),
`gpt_image_model`, `gpt_image_size` (or `match_ref`), `gpt_image_quality`, `gpt_image_background`
(all global-only) → `Images to RGB` → RMBG when `gpt_rembg` (per region) / `gpt_image_rembg` is on
→ variant PNG. Billed on comfy.org credits (`COMFY_ORG_API_KEY`); the GPU only waits and runs RMBG.

| Field | Draft value |
|---|---|
| Purpose | Edit or restyle a given image with a written instruction; strong instruction following and legible text. |
| When to use | Variations of an existing asset (recolour a plaque, swap a gem), a logo or wordmark where lettering must read (check), a quick restyle of a mockup crop under fidelity `match` when SDXL drifts (check). |
| When NOT to use | Many drafts (per-image API cost, 20–60 s wall each) (check); assets needing model-side transparency (it returns opaque; RMBG cuts it, bad on plates and scenes); reproducible renders (a locked gpt region is pinned by its pick alone: no seed); tag-list briefs (write an instruction). |
| Required inputs | `prompt` required: the region's `gpt_prompt` (an edit instruction the artist writes via `set_region_prompt.gptPrompt`); `reference` required in practice (the image to edit) (check whether the builder runs without one); `negative`, `shape`, `sourceImage`, `mask`, `layer`: none. |
| Outputs | One PNG at the global `gpt_image_size`, RGBA when `gpt_rembg` is on. |
| Exposed settings | Per region: `gpt_rembg` (on/off), `style_ref`, `fit_mode`. Global-only, not agent-settable: model, size, quality, background. |
| Chain position | **generate** or **process** (restyle of a rendered pick as its `style_ref`). Precedes: `birefnet`, `fx`. |
| GPU seconds per image | ~2 s GPU plus 20–60 s wait (check); billed in comfy.org credits per image: **`billing: credits`**, so this card cannot be reviewed for agents until ADR-0006 tracks credits, and whether the serverless worker can authenticate the API node at all is unverified (the key is only sent on the `http` transport). |
| Variants | drafts 1–2, finals 1, max 2 (check). |
| Gotchas | Needs `COMFY_ORG_API_KEY`; `/credits` shows the balance. Returns opaque images. The atlas prefix/suffix do not reach it. Policy refusals fail the job (check). Sending client mockup crops to a third-party API is the owner's call. |

```json
{ "version": 1, "id": "gpt_image", "status": "draft", "rev": 1, "builtin": true,
  "purpose": "Edit or restyle a given image with a written instruction; legible text.",
  "whenToUse": ["variations of an existing asset", "logos and wordmarks where lettering must read (check)",
                "a quick restyle of a mockup crop under fidelity match (check)"],
  "whenNotToUse": ["many drafts", "assets needing model-side transparency", "reproducible renders", "tag-list briefs"],
  "inputs": {"prompt": "required", "negative": "none", "reference": "required", "shape": "none",
             "sourceImage": "none", "mask": "none", "layer": "none"},
  "outputs": {"kind": "image", "alpha": true, "count": 1, "sizeRule": "global gpt_image_size"},
  "settings": [
    {"key": "gpt_rembg", "default": "", "options": ["", "on", "off"], "scope": "region"},
    {"key": "fit_mode", "default": "", "options": ["", "contain", "cover", "fill"], "scope": "region"}
  ],
  "chain": {"position": "generate", "follows": ["sdxl", "flux"], "precedes": ["birefnet", "fx"]},
  "gpu": {"secondsPerImage": {"1024": 2}, "apiWallSeconds": 40, "creditsPerImage": "(check)", "coldStart": 60, "source": "guess"},
  "variants": {"draft": 1, "final": 1, "max": 2}, "billing": "credits", "licence": "conditional",
  "gotchas": ["needs COMFY_ORG_API_KEY; serverless authentication unverified",
              "returns opaque images: RMBG runs on everything unless gpt_rembg is off",
              "uses gpt_prompt, not the atlas prompt", "policy refusals fail the job (check)",
              "third-party API: owner's call for client mockups"] }
```

---

## B. Library blueprints (`_shared/blueprints/`, export of 2026-10-06)

### B1. `birefnet` — BiRefNet matting (toon) · `graphSha f097cbda71df` · kind image

Graph (3 nodes): `LoadImage` → `BiRefNetRMBG` (model BiRefNet_toonout, blur 10, offset 20,
background Alpha) → `SaveImage`. Roles: `style_ref` (the source) and `output`; no prompt, no seed.
Params: `blur` 0–64 (10), `offset` −20…20 (20), `invert` (false). Published 2026-09-16.

| Field | Draft value |
|---|---|
| Purpose | Cut a still to alpha with BiRefNet; a cleaner, softer matte than RMBG-2.0 on toon and painted art (check). |
| When to use | The cutout step after any generate step whose RMBG edge is dirty or haloed; cutting a mockup crop or a hand-made image to alpha before it becomes a tile; the `process` step of every default recipe for Symbols and UI (check). |
| When NOT to use | Scenes and plates (nothing to cut); photo-real art (BiRefNet-general fits better: a param to expose, or a second card) (check); an image already on clean alpha (it re-mattes and may eat thin edges). |
| Required inputs | `sourceImage` required (`style_ref`, the raw image: the previous step's chosen variant or a crop); nothing else. |
| Outputs | One RGBA PNG at the source's size. |
| Exposed settings | `blur` 10 → 1–3 for crisp toon edges, 6–12 for soft painted edges (check); `offset` 20 → 2–6 (20 grows the matte a lot: a halo of background survives) (check); `invert` false (true keeps the background and drops the subject). |
| Chain position | **process** (cutout). Follows: `sdxl`, `flux`, `gpt_image`, an extraction card. Precedes: `finish` (set_output), `fx`. |
| GPU seconds per image | 1024: ~3 s warm (check); cold start ~60 s (the BiRefNet weights are small) (check). |
| Variants | 1 (deterministic), max 1. |
| Gotchas | The atlas style prefix/suffix and a region prompt do nothing (no `positive` role). The atlas gen size is ignored (no `width`/`height` roles): output = source size. With the atlas pipeline set to `birefnet`, every region of that atlas needs a `style_ref` or the render fails ("Reference image not found"). BiRefNet_toonout's licence is unrecorded (`model-licences.md`). |

```json
{ "version": 1, "id": "birefnet", "status": "draft", "rev": 1, "graphSha": "f097cbda71df",
  "purpose": "Cut a still to alpha with BiRefNet; cleaner than RMBG-2.0 on toon art (check).",
  "whenToUse": ["the cutout step after a generate step with a dirty RMBG edge", "cutting a crop or hand-made image to alpha"],
  "whenNotToUse": ["scenes and plates", "photo-real art (check)", "images already on clean alpha"],
  "inputs": {"prompt": "none", "negative": "none", "reference": "none", "shape": "none",
             "sourceImage": "required", "mask": "none", "layer": "none"},
  "outputs": {"kind": "image", "alpha": true, "count": 1, "sizeRule": "source size"},
  "settings": [
    {"key": "blur", "default": 10, "min": 0, "max": 16, "note": "1-3 crisp toon, 6-12 soft painted (check)"},
    {"key": "offset", "default": 20, "min": 0, "max": 20, "note": "2-6; 20 leaves a halo (check)"},
    {"key": "invert", "default": false}
  ],
  "chain": {"position": "process", "follows": ["sdxl", "flux", "gpt_image", "removebackgroundsam3__2_"], "precedes": ["finish", "fx"]},
  "gpu": {"secondsPerImage": {"1024": 3}, "coldStart": 60, "source": "guess"},
  "variants": {"draft": 1, "final": 1, "max": 1}, "billing": "gpu", "licence": "conditional",
  "gotchas": ["no prompt role: atlas style does nothing", "output = source size",
              "every region on this pipeline needs a style_ref", "BiRefNet_toonout licence unrecorded"] }
```

### B2. `removebackgroundsam3__2_` — SAM3 cutout by a text prompt · `graphSha def9d9e63ff6` · kind image

Graph (11 nodes): `LoadImage` → `SAM3_Detect` (checkpoint sam3.1_multiplex_fp16, threshold 0.3,
refine 5, `individual_masks` from a boolean) with `CLIPTextEncode` as the detection prompt (baked
"the whaler, the spear, the raft") → `Switch` (`switch` false = keep the detected objects, true =
keep everything else) → `GrowMask` (`expand` 20) → `InvertMask` → `JoinImageWithAlpha` →
`SaveImage`. Roles: `positive` (the detection prompt), `style_ref` (the source), `output`. Params:
`GrowMask` (20), `Switch` (false), `Individualmasks` (false). Published 2026-09-09.

| Field | Draft value |
|---|---|
| Purpose | Cut named objects out of a source image: keep what the prompt names (or everything but it) on alpha. |
| When to use | Extraction: pull the character, the logo or a prop out of a mockup crop or a full frame when there is more than one thing in the picture (a plain matte would keep the whole foreground); making a `style_ref` from a busy mockup; an `extract` step before a generate step under fidelity `match` (check). |
| When NOT to use | A single subject on a plain background (`birefnet` is cheaper and softer) (check); fine hair or glow edges (SAM3 masks are object masks, not mattes: expect hard edges); when the prompt would be polluted by the atlas style prefix/suffix (see gotchas). |
| Required inputs | `prompt` required: a comma-separated OBJECT LIST ("the dragon, the sword"), not an art prompt; `sourceImage` required (`style_ref`); `negative`, `reference`, `shape`, `mask`, `layer`: none. |
| Outputs | One RGBA PNG at the source size: the named objects opaque, the rest transparent (`Switch` false), or the inverse. |
| Exposed settings | `GrowMask` 20 → 4–12 (room for an edge; 20 drags background in) (check); `Switch` false (true removes the named objects instead); `Individualmasks` false (true: one mask per instance, combined) (check what the join does with several). |
| Chain position | **extract**. Follows: a mockup crop or a rendered scene. Precedes: `birefnet` (to soften the edge), a generate step (as `style_ref`), `finish`. |
| GPU seconds per image | 1024: ~6 s warm (SAM3 multiplex fp16) (check); cold start 90–150 s (the checkpoint is large) (check). |
| Variants | 1, max 1 (deterministic for a given prompt). |
| Gotchas | **The detection prompt is the `positive` role, so the atlas style prefix/suffix are prepended to it** (`_resolve_text`): the region must set `positive_replace` or the atlas style must be empty, or SAM3 is asked to find "glossy 3d game icon, the dragon". The artist writes the object list, the technician sets the replace flag. Hard mask edges by design. `sam3.1_multiplex_fp16` must be on the volume (`models[]` declares it); its licence is not in `model-licences.md` (check). Threshold 0.3 is baked (a param to expose for faint objects) (check). |

```json
{ "version": 1, "id": "removebackgroundsam3__2_", "status": "draft", "rev": 1, "graphSha": "def9d9e63ff6",
  "purpose": "Cut named objects out of a source image onto alpha, by a text prompt.",
  "whenToUse": ["extract a character, logo or prop from a busy crop or frame", "make a style_ref from a busy mockup",
                "an extract step before a generate step under fidelity match (check)"],
  "whenNotToUse": ["a single subject on a plain background: birefnet (check)", "hair and glow edges", "when the atlas style would pollute the prompt"],
  "inputs": {"prompt": "required", "negative": "none", "reference": "none", "shape": "none",
             "sourceImage": "required", "mask": "none", "layer": "none"},
  "outputs": {"kind": "image", "alpha": true, "count": 1, "sizeRule": "source size"},
  "settings": [
    {"key": "GrowMask", "default": 20, "min": 0, "max": 24, "note": "4-12 (check)"},
    {"key": "Switch", "default": false, "note": "true = remove the named objects instead"},
    {"key": "Individualmasks", "default": false}
  ],
  "chain": {"position": "extract", "follows": [], "precedes": ["birefnet", "sdxl", "flux", "finish"]},
  "gpu": {"secondsPerImage": {"1024": 6}, "coldStart": 120, "source": "guess"},
  "variants": {"draft": 1, "final": 1, "max": 1}, "billing": "gpu", "licence": "conditional",
  "gotchas": ["positive = the detection prompt: set positive_replace or the atlas style pollutes it",
              "hard object-mask edges", "sam3.1_multiplex_fp16 licence unrecorded (check)",
              "threshold 0.3 is baked (check)"] }
```

### B3. `composite4layers_sam_` — SAM3 four-layer alpha composite · `graphSha 49137d7e549d` · kind image

Graph (49 nodes): `LoadImage` → `SAM3_Detect` (threshold 0.1, refine 2, individual masks) with
the detection prompt from a `PrimitiveString` → up to four instance masks (`RandomImageFromBatch`
index 0–3; `GetMaskSizeAndCount` + compares pick how many exist) → per layer: optional invert,
`GrowMask`, `MaskBlur+`, a `SolidMask` opacity → `MaskComposite` chain (layer 1 × 2 × 3 × 4, with
adds for opacity) → `JoinImageWithAlpha` → `SaveImage` "OUTPUT". Roles: `positive` (the detection
prompt), `style_ref` (source), `output`. Params per layer 1–4: `GrowMaskLAYERn`, `MaskBlurLAYERn`,
`InvertMaskLAYERn` (true), `OpacityLAYERn` (1, 1, 0.5, 1; layer 3 has blur 75: a soft 50 % layer).
Published 2026-09-17.

| Field | Draft value |
|---|---|
| Purpose | Cut a multi-part subject out of a frame with per-part edge treatment and opacity, as one RGBA image (e.g. the character opaque, its splash at 50 % soft). |
| When to use | A frame where up to four named parts must come out together with different edges (a hard body, a soft spray, a faded shadow); the second pass of an extraction sequence after ⧉ Duplicate atlas (one source sequence, one pass per part) (check). |
| When NOT to use | One subject (B1/B2 are simpler); more than four parts; when the parts cannot be named for SAM3; when hard masks are wrong (hair, glow). |
| Required inputs | `prompt` required: the object list, in the order the layers are meant (the layer index is the detection index, which SAM3 does not promise to keep stable: check); `sourceImage` required. |
| Outputs | One RGBA PNG at the source size with the composed alpha. |
| Exposed settings | 16 per-layer knobs. Card defaults: `GrowMaskLAYERn` 0, `MaskBlurLAYERn` 2 (hard parts) or 40–75 (soft parts), `InvertMaskLAYERn` true (the graph's masks arrive inverted: leave it), `OpacityLAYERn` 1 (0.3–0.6 for a soft part). Ranges: grow −20…20, blur 0…100, opacity 0…1 (check). |
| Chain position | **extract**. Precedes: `finish`, `birefnet`. |
| GPU seconds per image | 1024: ~8 s warm (check); cold start as B2. |
| Variants | 1, max 1. |
| Gotchas | The same prompt-pollution trap as B2 (`positive_replace`). Which detected instance lands on which layer depends on SAM3's ordering, so a recipe should not rely on "layer 3 is the splash" without the owner checking the result (check). Threshold 0.1 detects faint things and false positives. Only reviewable once the owner confirms what each layer is for. |

```json
{ "version": 1, "id": "composite4layers_sam_", "status": "draft", "rev": 1, "graphSha": "49137d7e549d",
  "purpose": "Cut up to four named parts out of a frame with per-part edge and opacity, as one RGBA image.",
  "whenToUse": ["multi-part subjects with different edge treatments", "extraction passes over a duplicated atlas (check)"],
  "whenNotToUse": ["one subject", "more than four parts", "parts SAM3 cannot name", "hair and glow edges"],
  "inputs": {"prompt": "required", "negative": "none", "reference": "none", "shape": "none",
             "sourceImage": "required", "mask": "none", "layer": "none"},
  "outputs": {"kind": "image", "alpha": true, "count": 1, "sizeRule": "source size"},
  "settings": [
    {"key": "GrowMaskLAYER1", "default": 0, "min": -20, "max": 20}, {"key": "MaskBlurLAYER1", "default": 2, "min": 0, "max": 100},
    {"key": "InvertMaskLAYER1", "default": true}, {"key": "OpacityLAYER1", "default": 1, "min": 0, "max": 1},
    {"key": "GrowMaskLAYER2", "default": 0, "min": -20, "max": 20}, {"key": "MaskBlurLAYER2", "default": 2, "min": 0, "max": 100},
    {"key": "InvertMaskLAYER2", "default": true}, {"key": "OpacityLAYER2", "default": 1, "min": 0, "max": 1},
    {"key": "GrowMaskLAYER3", "default": -5, "min": -20, "max": 20}, {"key": "MaskBlurLAYER3", "default": 75, "min": 0, "max": 100},
    {"key": "InvertMaskLAYER3", "default": true}, {"key": "OpacityLAYER3", "default": 0.5, "min": 0, "max": 1},
    {"key": "GrowMaskLAYER4", "default": -5, "min": -20, "max": 20}, {"key": "MaskBlurLAYER4", "default": 0, "min": 0, "max": 100},
    {"key": "InvertMaskLAYER4", "default": true}, {"key": "OpacityLAYER4", "default": 1, "min": 0, "max": 1}
  ],
  "chain": {"position": "extract", "follows": [], "precedes": ["finish", "birefnet"]},
  "gpu": {"secondsPerImage": {"1024": 8}, "coldStart": 120, "source": "guess"},
  "variants": {"draft": 1, "final": 1, "max": 1}, "billing": "gpu", "licence": "conditional",
  "gotchas": ["positive = the detection prompt: set positive_replace", "layer order follows SAM3's instance order (check)",
              "threshold 0.1 picks up faint objects and false positives"] }
```

### B4. `characterdesignertest3` — FLUX + PuLID face + ControlNets (R&D) · `graphSha 925171cf5051` · kind unset (image)

Graph (37 nodes): FLUX dev fp8 + `comic-style-lora-000002` 0.5 → `ApplyPulidFlux` (face identity
from the reference image, weight 0.6) → ControlNets from the SAME reference (Canny, Depth Anything,
OpenPose) → KSampler 20 steps cfg 3 at 512² (`width`/`height` bound) → `SaveImage` (bound output);
a second, unbound pass upscales the first ×1.5 with Canny + Depth from the first image → a second
`SaveImage` the runner never reads. Roles: positive, negative, seed, width, height, style_ref
(node 148, the face/pose reference), output. No params, **no `models[]`** declared (a ⟳ Rescan
models is owed). Published 2026-08-11.

| Field | Draft value |
|---|---|
| Purpose | A character in a comic style with a given face and pose, from one reference photo. |
| When to use | **Not by agents.** PuLID, `antelopev2` and the trained LoRA are non-commercial and R&D-pod-only (`nodes.json`, `model-licences.md`); the pack is not in the serverless worker image. R&D on the pod, by a person. |
| When NOT to use | Any Director run; any shipped art. |
| Required inputs | `prompt`, `negative`, `reference` (the face and pose source). |
| Outputs | One opaque PNG at 512² (the bound output is the FIRST pass; the upscaled second pass is not read). |
| Exposed settings | None. |
| Chain position | generate (R&D). |
| GPU seconds per image | ~60 s at 512 with three ControlNets and PuLID (check); unverified on any machine in the repo's logs (it was refused for missing nodes and models on both). |
| Variants | n/a. |
| Gotchas | `status: draft` permanently unless the licences change: the card exists so the listing can say WHY it is not offered. The bound `output` is the 512 first pass. `flux1-dev-fp8.safetensors` and the LoRA exist only on the R&D pod. |

```json
{ "version": 1, "id": "characterdesignertest3", "status": "draft", "rev": 1, "graphSha": "925171cf5051",
  "purpose": "R&D: a comic-style character with a given face and pose, from one reference. Not for agents.",
  "whenToUse": [], "whenNotToUse": ["any Director run: PuLID and antelopev2 are non-commercial and R&D-pod-only"],
  "inputs": {"prompt": "required", "negative": "optional", "reference": "required", "shape": "none",
             "sourceImage": "none", "mask": "none", "layer": "none"},
  "outputs": {"kind": "image", "alpha": false, "count": 1, "fixedPx": 512},
  "settings": [], "chain": {"position": "generate", "follows": [], "precedes": []},
  "gpu": {"secondsPerImage": {"512": 60}, "coldStart": 240, "source": "guess"},
  "variants": {"draft": 0, "final": 0, "max": 0}, "billing": "gpu", "licence": "blocked",
  "gotchas": ["never reviewed: licence-blocked and not in the worker image", "no models[] declared",
              "the bound output is the 512 first pass"] }
```

### B5. `bluprinttest` — FLUX two-pass with a baked shape ref (test) · `graphSha 7a10c50da975` · kind unset (image)

Graph (41 nodes): FLUX dev fp8 + `comic-style-lora-000002` 0.9; a "Shape Ref" `LoadImage` (node 30,
baked `Base_Slot (1).png`, **not bound to a role**) drives Canny + Depth Anything V2 ControlNets
and the latent size (its size rounded to 16); pass 1 (KSampler 13) → pass 2 (KSampler 83) from
pass 1's latent with HED/Depth ControlNets from both images; conditioning = a fixed western-saloon
prompt (node 158) combined with the bound `positive` "Input" (node 216); fixed negative (node 11)
→ `RMBG` (RMBG-2.0) → `SaveImage` "Export" (bound output). Roles: positive, seed, output. No
params, no models declared. Description "test". Published 2026-06-17.

| Field | Draft value |
|---|---|
| Purpose | A test graph: a western-themed symbol shaped by a baked silhouette, in a comic LoRA style. |
| When to use | **Not by agents.** The shape reference is baked, not a role (the runner's unbound-LoadImage safety net may or may not fill it: check), the theme prompt is baked, and the LoRA is R&D-only. Suggested: retire it, or re-publish as a real "FLUX shaped symbol" blueprint with `shape_ref` bound to node 30, the theme moved to a `text` param, and the LoRA swapped for a shippable one. |
| Required inputs | `prompt` (combined with the baked theme). |
| Outputs | One RGBA PNG at the shape ref's size. |
| Chain position | generate (test). |
| GPU seconds per image | two FLUX passes with four ControlNets: ~90 s at 1024 (check). |
| Gotchas | `status: draft` until re-published. RMBG-2.0 and FLUX.1-dev licences blocked. The baked `Base_Slot (1).png` must exist on the target or the render dies in ref upload. |

```json
{ "version": 1, "id": "bluprinttest", "status": "draft", "rev": 1, "graphSha": "7a10c50da975",
  "purpose": "Test graph: FLUX two-pass symbol shaped by a baked silhouette. Not for agents.",
  "whenToUse": [], "whenNotToUse": ["any Director run: baked shape ref and theme, R&D LoRA; retire or re-publish"],
  "inputs": {"prompt": "required", "negative": "none", "reference": "none", "shape": "none",
             "sourceImage": "none", "mask": "none", "layer": "none"},
  "outputs": {"kind": "image", "alpha": true, "count": 1, "sizeRule": "baked shape ref size"},
  "settings": [], "chain": {"position": "generate", "follows": [], "precedes": []},
  "gpu": {"secondsPerImage": {"1024": 90}, "coldStart": 180, "source": "guess"},
  "variants": {"draft": 0, "final": 0, "max": 0}, "billing": "gpu", "licence": "blocked",
  "gotchas": ["shape ref is baked, not a role", "theme prompt baked", "RMBG-2.0 and FLUX.1-dev licences blocked"] }
```

### B6. `wan22_i2v_flipbook` — Wan 2.2 I2V flipbook source (bundled) · `graphSha 1e95138deb12` · kind video

Graph (35 nodes): `LoadImage` (source frame) → `WanImageToVideo` (640², frames = floor(duration ×
fps + 1) = 81) → two-stage `KSamplerAdvanced` (high-noise then low-noise Wan 2.2 I2V A14B fp8, the
4-step lightx2v LoRAs when `fast_lora`, else `steps`/`cfg`) → `VAEDecode` → `ImageScale` (320²) →
optional `BiRefNetRMBG` (toonout) → `SaveAnimatedWEBP`. Roles: positive, negative, seed, style_ref
(the still), output. `width`/`height` deliberately unbound. Twenty params as in `blueprint.json`
(duration, fps, gen size, fast_lora, steps/cfg, out size, lossless, quality, the cutout group).
Models: Wan 2.2 A14B high+low fp8, umT5, Wan 2.1 VAE, two lightx2v LoRAs (all clean licences).

| Field | Draft value |
|---|---|
| Purpose | Animate a still into a short clip whose frames become a Flipbook clip. |
| When to use | Symbol win animations, coin spins, banner shimmer where the template plays a flipbook clip and no Spine rig covers it (check). **From the Flipbook video session only**: `kind: video` is filtered out of the image listing, and the Flipbook's packer consumes the WEBP. A future animator step, not a technician one. |
| When NOT to use | Rigged or re-timeable animation (Rigger); stills; loops over ~5 s; a clip that must end where it starts (use B7). |
| Required inputs | `sourceImage` required (the approved tile on alpha); `prompt` required (motion); `negative` optional. |
| Outputs | One animated WEBP, 81 frames at 16 fps, 320² frames, alpha when `remove_background`. |
| Exposed settings | `duration` 1–6 (5); `fps` 8–24 (16); `gen_width`/`gen_height` 512–768 (640 tested); `fast_lora` true (off = quality mode, ~4× the seconds) (check); `out_width`/`out_height` 128–512 (320); `remove_background` true; `birefnet_model` toonout (general for photo-real) (check); `mask_offset` 0–10 (5); `lossless` false (a lossless WEBP can exceed the job payload cap). |
| Chain position | generate (video). Follows: an approved still. Precedes: the Flipbook packer. |
| GPU seconds per clip | fast mode 640², 81 frames: ~150–240 s on an L40S (check); quality mode ~600–900 s (check). Cold start 180–300 s (two 14 GB UNets + 6.7 GB encoder) (check). Needs a 48 GB card (check). |
| Variants | drafts 2, finals 1, max 4 (check). |
| Gotchas | `width`/`height` must stay unbound. `steps`/`cfg` are ignored while `fast_lora` is on. The output fps is wired to the generation fps. Keep `background: Alpha`. BiRefNet_toonout's licence is unrecorded. |

```json
{ "version": 1, "id": "wan22_i2v_flipbook", "status": "draft", "rev": 1, "graphSha": "1e95138deb12",
  "purpose": "Animate a still into a short clip whose frames become a Flipbook clip.",
  "whenToUse": ["symbol win loops, coin spins, banner shimmer with no Spine rig (check)", "from the Flipbook video session only"],
  "whenNotToUse": ["rigged animation (Rigger)", "stills", "loops over ~5 s", "clips that must end where they start (wanloopingvideo__3_)"],
  "inputs": {"prompt": "required", "negative": "optional", "reference": "none", "shape": "none",
             "sourceImage": "required", "mask": "none", "layer": "none"},
  "outputs": {"kind": "video", "alpha": true, "count": 1, "frames": 81, "fps": 16},
  "settings": [
    {"key": "duration", "default": 5, "min": 1, "max": 6}, {"key": "fps", "default": 16, "min": 8, "max": 24},
    {"key": "gen_width", "default": 640, "min": 512, "max": 768}, {"key": "gen_height", "default": 640, "min": 512, "max": 768},
    {"key": "fast_lora", "default": true}, {"key": "out_width", "default": 320, "min": 128, "max": 512},
    {"key": "out_height", "default": 320, "min": 128, "max": 512}, {"key": "remove_background", "default": true},
    {"key": "birefnet_model", "default": "BiRefNet_toonout"}, {"key": "mask_offset", "default": 5, "min": 0, "max": 10}
  ],
  "chain": {"position": "generate", "follows": ["sdxl", "flux", "gpt_image"], "precedes": ["flipbook-pack"]},
  "gpu": {"secondsPerImage": {"640": 200}, "qualityModeSeconds": {"640": 750}, "coldStart": 240, "minVramGb": 48, "source": "guess"},
  "variants": {"draft": 2, "final": 1, "max": 4}, "billing": "gpu", "licence": "conditional",
  "gotchas": ["width/height must stay unbound", "steps/cfg ignored while fast_lora is on", "lossless WEBP can exceed the payload cap", "keep background Alpha"] }
```

### B7. `wanloopingvideo__3_` — Wan 2.2 looping clip (two halves) · `graphSha 4806b0dca8e7` · kind video

Graph (83 nodes, two Wan subgraphs): first half `WanImageToVideo` from the source still with
`Text1stHalf` (bound `positive`) for `DurationStart` seconds at `Gen FPS`; second half
`WanFirstLastFrameToVideo` from the first half's LAST frame back to its FIRST frame with
`Text2ndHalf` (a `text` param) for `DurationEnd` seconds, so the clip **loops seamlessly**; both
halves batched → optional `BiRefNetRMBG` (BiRefNet-general) → resize (`ResizeWidth/Height` 320) →
`SaveAnimatedWEBP` at `ExportFPS`. `SetTurbo` switches both halves to the 4-step LoRAs. Seed bound
to a `PrimitiveInt`. Params: `SetTurbo` (false), `RemoveBackground` (true), `SetWidth`/`SetHeight`
(1024!), `DurationStart`/`DurationEnd` (1 s each), `Gen FPS` (12), `Lossless`, `quality` (80),
`ResizeWidth`/`ResizeHeight` (320), `ExportFPS` (12), `Text2ndHalf`, and the `bck *` cutout knobs.
**No `models[]` declared.** Published 2026-09-04.

| Field | Draft value |
|---|---|
| Purpose | A short clip that returns to its first frame, for idle loops and win loops that must not pop (a claw wave, a flame flicker, a coin shimmer). |
| When to use | Any symbol or UI loop the game plays continuously (Static or Win state idle loops in the Symbols SM) (check). From the Flipbook video session only, like B6. |
| When NOT to use | One-shot animations (B6); loops longer than ~2 s per half (VRAM and time at 1024²); until the two blocking gotchas below are fixed. |
| Required inputs | `sourceImage` required (the still, `style_ref`); `prompt` required (the first half's motion); `negative` optional ("camera movement" baked default); `Text2ndHalf` (the return motion, written by the artist). |
| Outputs | One animated WEBP, `(DurationStart + DurationEnd) × Gen FPS` frames at `ExportFPS`, resized to `ResizeWidth/Height`, alpha when `RemoveBackground`. |
| Exposed settings | `SetTurbo` false → **true for drafts** (4 steps vs 50) (check); `SetWidth`/`SetHeight` 1024 → 640 (1024² Wan is ~3× slower and VRAM-heavy) (check); `DurationStart`/`DurationEnd` 1 → 0.5–2; `Gen FPS` 12 → 12–16; `ResizeWidth`/`ResizeHeight` 320; `ExportFPS` = `Gen FPS`; `RemoveBackground` true; `bck model` BiRefNet-general → BiRefNet_toonout for toon art (check); `bck offset` 0 → 3–5; `Lossless` false. |
| Chain position | generate (video, loop). Follows: an approved still. Precedes: the Flipbook packer. |
| GPU seconds per clip | turbo, 640², 2 × 13 frames: ~90–150 s (check); non-turbo 50 steps at 1024²: 15–25 min (check). Cold start as B6. |
| Variants | drafts 2, finals 1, max 3 (check). |
| Gotchas | **Blocking before any agent use:** (1) `style_ref` AND `shape_ref` are both bound to node 97: `shape_ref` is written second and wins, so the source frame arrives as a normalised grayscale silhouette (the runbook trap); re-publish with `shape_ref` unbound. (2) `models[]` is empty: ⟳ Rescan models so the Wan files are declared. Also: `width`/`height` roles are unbound (right: the atlas gen size would hit the video), size is the `SetWidth/Height` params; `ExportFPS` must equal `Gen FPS` or the motion speed changes; the second half's quality depends on `Text2ndHalf` describing a return to the start pose. |

```json
{ "version": 1, "id": "wanloopingvideo__3_", "status": "draft", "rev": 1, "graphSha": "4806b0dca8e7",
  "purpose": "A short clip that returns to its first frame: seamless idle and win loops.",
  "whenToUse": ["continuous symbol and UI loops (check)", "from the Flipbook video session only"],
  "whenNotToUse": ["one-shot animations (wan22_i2v_flipbook)", "halves over ~2 s", "until shape_ref is unbound and models are declared"],
  "inputs": {"prompt": "required", "negative": "optional", "reference": "none", "shape": "none",
             "sourceImage": "required", "mask": "none", "layer": "none"},
  "outputs": {"kind": "video", "alpha": true, "count": 1},
  "settings": [
    {"key": "SetTurbo", "default": false, "note": "true for drafts (check)"},
    {"key": "SetWidth", "default": 1024, "min": 512, "max": 1024, "note": "640 recommended (check)"},
    {"key": "SetHeight", "default": 1024, "min": 512, "max": 1024},
    {"key": "DurationStart", "default": 1, "min": 0.5, "max": 2}, {"key": "DurationEnd", "default": 1, "min": 0.5, "max": 2},
    {"key": "Gen FPS", "default": 12, "min": 12, "max": 16}, {"key": "ExportFPS", "default": 12, "min": 12, "max": 16},
    {"key": "ResizeWidth", "default": 320, "min": 128, "max": 512}, {"key": "ResizeHeight", "default": 320, "min": 128, "max": 512},
    {"key": "RemoveBackground", "default": true}, {"key": "bck model", "default": "BiRefNet-general"},
    {"key": "bck offset", "default": 0, "min": 0, "max": 10}, {"key": "Text2ndHalf", "default": ""}
  ],
  "chain": {"position": "generate", "follows": ["sdxl", "flux", "gpt_image"], "precedes": ["flipbook-pack"]},
  "gpu": {"secondsPerImage": {"640": 120}, "qualityModeSeconds": {"1024": 1200}, "coldStart": 240, "minVramGb": 48, "source": "guess"},
  "variants": {"draft": 2, "final": 1, "max": 3}, "billing": "gpu", "licence": "conditional",
  "gotchas": ["BLOCKING: shape_ref bound beside style_ref on node 97 (silhouette trap): re-publish",
              "BLOCKING: models[] empty: rescan", "ExportFPS must equal Gen FPS",
              "Text2ndHalf must describe a return to the start pose"] }
```

---

## C. FX layers are not blueprints

The owner listed "glow" among the jobs. In Atlas Maker a glow is an **FX layer**: a region named
`<base>_glow` (or `_shadow`, `_shine`, `_blur`, `_zoom`, `_colour`) with the matching mode,
computed by `shine.py` on the CPU from the base's committed pixels, rebuilt on Create Atlas when
`auto_fx_rebuild` is on (the default), costing no GPU and no credits (guide §"FX layers"). The
technician fills an FX layer the template already has like any region (it has no prompt: its
pixels follow the base), and may add one only on a scratch atlas (ADR-0008 §3). No GPU glow or
relight blueprint is in the library today.

## D. Owner actions on the library (found while drafting)

| Blueprint | Action |
|---|---|
| `wanloopingvideo__3_` | **Re-publish** with `shape_ref` unbound (it is bound beside `style_ref` on node 97, so the source still arrives as a silhouette) and run ⟳ Rescan models (`models[]` is empty). |
| `bluprinttest` | Stays `draft`: retire it, or rebuild as a real "FLUX shaped symbol" blueprint (bind `shape_ref` to node 30, move the theme to a `text` param, swap the R&D LoRA). |
| `characterdesignertest3` | Stays `draft` permanently: PuLID and antelopev2 are non-commercial and R&D-pod-only. Its card exists only to say why. |
| every generate card | `licence: blocked` (SDXL LoRA, RMBG-2.0, FLUX.1-dev) until `model-licences.md` is settled; the before-publish checkpoint lists each blocked step. |

## E. What the library is missing for the default recipes

Cards the default recipes want and no reviewed blueprint provides (owner to publish, or the
recipes stay on the built-ins):
- **A scene generator without a cutout.** Both built-in generate pipelines have `rembg` as a
  per-atlas toggle, so a background atlas can run `flux` with `rembg: off`: nothing to publish,
  but the recipe must set it, and the symbol atlas must not share that atlas.
- **An upscale** (`LoadImage → UpscaleModelLoader → ImageUpscaleWithModel → SaveImage`, the
  2026-09-09 processing-graph case) for finals derived from a draft pick. Not in the export.
- **A FLUX img2img** at low denoise with the pick as `style_ref`, for a final that keeps the
  approved composition at a higher size. The 2026-09-08 runbook blueprint is not in the export.
- **A shippable style generator**: every generate card above carries a blocked licence somewhere
  (the SDXL LoRA, RMBG-2.0, FLUX.1-dev). Until `model-licences.md` is settled, no generate card can
  be `reviewed` for shipped art without the owner's explicit acceptance (check).

## F. Default recipes per region group (for the New-game estimate, ADR-0008 §6)

Starting values for `estimate-profiles.json` `recipes`, all (check), using only cards that can
exist today. Drafts render at the final size where the pick is the final.

| Group | Chain |
|---|---|
| Symbols | `sdxl` 1024 ×3 (rembg on, shape_ref = the template tile's silhouette) → `birefnet` on a scratch atlas → finish |
| Coins & jackpots | `sdxl` 1024 ×3 → `birefnet` → finish |
| Backgrounds | `flux` 1024 ×2 on its own atlas with `rembg: off` → finish (upscale when a card exists) |
| Reel frame & logo | `flux` 1024 ×2 → `birefnet` → finish |
| UI kit | `sdxl` 1024 ×2 → `birefnet` → finish |
| Win banners | `flux` 1024 ×2 → `birefnet` → finish |
