# Model licences — the generation pipeline

**What this is.** An inventory of every model/weights file the production generation path
(atlas-tool → RunPod serverless ComfyUI, plus the Flipbook video runner) can load, the licence each
one is under, and whether a studio that **sells** the resulting art and games to operators may use
it. It ends with licence-cleared replacements per role and a recommendation table.

**Not legal advice.** This is a factual reading of public model cards and licence texts as of
**2026-09-29**, gathered to help the owner decide. Anything marked *blocked* or *unknown* should go
to counsel before it is relied on, as should any licence purchase (BFL, BRIA, InsightFace).

**Machine-readable twin:** [`services/atlas-tool/model_licences.json`](../../services/atlas-tool/model_licences.json)
— one entry per model with `commercial: clear | conditional | blocked | unknown`. The generator reads
it to stamp every asset with the models that made it (see [Provenance](#provenance-what-each-asset-records)).
Change a status there and here in the same commit.

## Headline

1. **Every built-in image pipeline's default is blocked for commercial use today.**
   - **SDXL** (the default pipeline): the always-wired `gameIconInstitute3d_v10` LoRA is marked
     no-commercial / no-derivatives on Civitai.
   - **FLUX**: `flux1-dev`, its `ae` VAE and `flux1-redux-dev` are under the FLUX.1 [dev]
     Non-Commercial License.
   - **All three** (sdxl, flux, gpt_image) cut out backgrounds with **RMBG-2.0** by default, which is
     CC BY-NC 4.0.
2. **Running FLUX [dev] for a paying business needs a commercial licence, even though outputs are
   "yours".** The FLUX [dev] licence lets you use outputs for any purpose, commercial included. But it
   defines non-commercial use as use that brings no direct or indirect payment, and it names
   revenue-generating activity as commercial. A studio making art to sell is therefore using the
   model commercially, and that needs a licence from BFL ([bfl.ai/licensing](https://bfl.ai/licensing)).
3. **Every face-identity path is blocked, whatever it runs on.** PuLID (FLUX.1 or FLUX.2) needs
   **InsightFace antelopev2**, whose pretrained models are for non-commercial research only.
   Attaching a face makes an otherwise clean stack non-commercial.
4. **One fully clean image path already exists and is fetched onto the fleet:** Qwen-Image (2512)
   with its Qwen2.5-VL-7B encoder, VAE and the Toon LoRA. FLUX.2 [klein] 4B with its Qwen3-4B
   encoder and FLUX.2 VAE is the second. Wan 2.2 video (model, umT5, VAE, Lightning LoRAs) is clean
   as well.
5. **The Wan flipbook's default matting, `BiRefNet_toonout`, has an unrecorded licence.** The
   BiRefNet family it is fine-tuned from is MIT.

## Inventory — what the production path can load

The model dropdowns are open-ended: they list whatever the target ComfyUI reports. So "optional"
below means *any* file on the RunPod network volume. The volume is filled from R2 `comfyui-models/`,
which `scripts/seed-comfyui-models.py` mirrors from the owner's local `Shared/Models`, and from
`services/atlas-comfy-pod/tools/fetch-models.py`. **No weights are baked into the worker image.**
Settings resolve in this order: `_DEFAULTS` (`batch_atlas.py:71-181`) → `atlas_config.json` →
per-atlas `manifest.settings` → per-region keys.

### SDXL — built-in `build_workflow` (`batch_atlas.py:2659`), the default pipeline

| File / id | Role | Default? | Where | Status |
|---|---|---|---|---|
| `juggernautXL_ragnarokBy.safetensors` | checkpoint | default (`checkpoint`, per-region too) | `batch_atlas.py:76`, `ui_server.py:260`, `blueprints_src/sdxl` | conditional |
| `gameIconInstitute3d_v10.safetensors` | LoRA @ 0.85 | default, **always wired** (a blank name 400s) | `batch_atlas.py:77`, `ui_server.py:261` | **blocked** |
| `controlnet-union-sdxl-1.0-promax.safetensors` | ControlNet | only with a `shape_ref` | `batch_atlas.py:79` | clear |
| IPAdapter preset `PLUS (high strength)`, which resolves to `ip-adapter-plus_sdxl_vit-h` + CLIP-ViT-H-14-laion2B | style transfer | only with a style ref / mockup | `batch_atlas.py:2787` | clear (secondary) |
| `RMBG-2.0` | background removal | default (`rmbg_model`) unless `rembg` is off | `batch_atlas.py:82` | **blocked** |

### FLUX.1 — built-in `build_workflow_flux` (`batch_atlas.py:2835`)

| File / id | Role | Default? | Where | Status |
|---|---|---|---|---|
| `flux1-dev.safetensors` (fp8 at load) | UNet | default unless `flux_checkpoint` is set | `batch_atlas.py:112` | **blocked** |
| `t5xxl_fp16.safetensors` | T5 encoder | default | `:114` | clear |
| `clip_l.safetensors` | CLIP-L encoder | default | `:115` | clear |
| `ae.safetensors` | VAE | default | `:116` | **blocked** (FLUX.1-dev copy) |
| `flux1-redux-dev.safetensors` | Redux style model | with a style ref | `:124` | **blocked** |
| `sigclip_vision_patch14_384.safetensors` | Redux vision encoder | with Redux | `:125` | clear |
| `flux_checkpoint` | all-in-one checkpoint override | optional, blank (the comment suggests schnell) | `:105-107` | depends on the file |
| `flux_lora`, `flux_controlnet` | LoRA / ControlNet | optional, blank | `:117`, `:123` | depends on the file |
| `RMBG-2.0` | background removal | default | `:82` | **blocked** |

### gpt_image — `OpenAIGPTImage1` via the comfy.org API node (`batch_atlas.py:2123`)

`gpt-image-1` (default, `:137`), `1.5` or `2`. No local weights. Under the OpenAI Services
Agreement the customer owns the output, so the model itself is **clear**. The default cutout that
follows it is `RMBG-2.0`, which is **blocked**.

### Artist blueprints on R2 (not in the repo)

These graphs are published to `_shared/blueprints/` and run on prod because their nodes are
`prod: true` in `nodes.json`. The one known graph, `characterdesignertest3`, is pinned by
`test_blueprint_derive.py`. It loads:

| Model | Status |
|---|---|
| `flux1-dev-fp8` | **blocked** |
| `comic-style-lora-000002` (trained on the pod, FLUX.1-dev base) | **blocked** |
| `t5xxl_fp8_e4m3fn` | clear |
| `clip_l` | clear |
| `ae` | **blocked** |
| `pulid_flux_v0.9.1` | clear |
| antelopev2 (loaded by the node) | **blocked** |
| EVA02-CLIP-L-14-336 (loaded by the node) | clear |
| facexlib retinaface + bisenet (loaded by the node) | unknown |

An artist SAM3 background-removal graph also exists (`sam3.1_multiplex_fp16`, licence unknown).
**Enumerating the rest needs an R2 listing.** From now on the provenance stamp records each
blueprint's models as it runs.

### Video — `wan22_i2v_flipbook` (`video_runner.build_video_workflow`, `video_runner.py:188`)

| Model | Status |
|---|---|
| `wan2.2_i2v_high_noise_14B_fp8_scaled` | clear |
| `wan2.2_i2v_low_noise_14B_fp8_scaled` | clear |
| `umt5_xxl_fp8_e4m3fn_scaled` | clear |
| `wan_2.1_vae` | clear |
| the lightx2v 4-step LoRAs (`fast_lora`) | clear |
| matting `BiRefNet_toonout` (param `birefnet_model`, 12 options) | **unknown** |

All the files except the matting model come from the `Comfy-Org/Wan_2.x_ComfyUI_Repackaged` repos.

### R&D-only sets (`fetch-models.py`, not on the prod worker)

| Set | Status |
|---|---|
| `flux2-klein` (4B fp8, Qwen3-4B, FLUX.2 VAE) | clear |
| `flux2-dev` (Mistral Small 3 encoder) | **blocked** |
| Flux.2 Turbo LoRA | **blocked** |
| `pulid-flux2` | the adapter is MIT, but the pipeline is blocked through antelopev2 |
| `qwen-image` (2512, Qwen2.5-VL-7B, VAE) | clear |
| `qwen-toon` | clear |
| Wan T2V / TI2V-5B | clear |

The Qwen character guide (`docs/guides/qwen-cartoon-character-blueprint.md`) names
`qwen_image_fp8_e4m3fn` and the Qwen-Image-Lightning 8-step LoRA. Both are Apache-2.0.

### Weights custom nodes download themselves

- **ComfyUI-RMBG** (prod):
  - `RMBG-2.0` comes from the `1038lab/RMBG-2.0` re-host of `briaai/RMBG-2.0`. The node's Apache
    header covers the node code, not these weights.
  - It also serves `INSPYRENET`, `BEN`, `BEN2` and `BiRefNet*`.
- **PuLID-Flux**:
  - EVA02-CLIP-L-14-336 goes to the HF cache, which is not on the volume, so each cold worker
    re-fetches it.
  - facexlib `detection_Resnet50_Final` + `parsing_bisenet` come from facexlib's GitHub releases and
    land in site-packages.
  - antelopev2 must already be on the volume (`services/atlas-serverless/start.sh:7-10`).
- **ComfyUI-SemanticLayers** (prod): its default `clip` analyzer downloads `openai/clip-vit-base-patch32`
  (MIT). It can optionally use CLIP-ViT-L / ViT-H or Florence-2 (MIT).
- **Upscalers:** no production code path loads one. `4x-UltraSharp` appears only in a test fixture,
  and `RealESRGAN_x4plus` is on the owner's model share.

## Licence detail

Key to the columns:

- **Outputs** — may the images be used commercially?
- **Model use** — may a revenue-earning studio run the model to make them?
- **Conf.** — confidence in the finding:
  - **V** — verified from a primary source (model card, licence file, Civitai API, official text).
  - **S** — from a secondary source or inferred.
  - **U** — unknown.

| Model | Licence | Outputs | Model use | Obligations | Conf. |
|---|---|---|---|---|---|
| [FLUX.1 \[dev\]](https://github.com/black-forest-labs/flux/blob/main/model_licenses/LICENSE-FLUX1-dev) incl. fp8/gguf repacks, `ae` | FLUX.1 [dev] Non-Commercial v1.1.1 (also listed under FLUX [dev] NC v2.0) | yes, except to train competing models | **no** without a BFL licence | notice; output filtering/review; AI disclosure where required; LoRAs/fine-tunes are Derivatives | V |
| [FLUX.1 Redux \[dev\]](https://huggingface.co/black-forest-labs/FLUX.1-Redux-dev), [Krea \[dev\]](https://huggingface.co/black-forest-labs/FLUX.1-Krea-dev) | FLUX.1 [dev] NC | as dev | **no** | as dev | V |
| [FLUX.1 \[schnell\]](https://huggingface.co/black-forest-labs/FLUX.1-schnell) | Apache-2.0 | yes | yes | Apache notice | V |
| [FLUX.2 \[dev\]](https://github.com/black-forest-labs/flux2/blob/main/model_licenses/LICENSE-FLUX-DEV), klein **9B** | FLUX [dev] NC v2.0 | as dev | **no**; covered by BFL paid tiers | as dev | V |
| [FLUX.2 \[klein\] 4B / 4B Base](https://huggingface.co/black-forest-labs/FLUX.2-klein-base-4B) | Apache-2.0 | yes | yes | Apache notice | V |
| [FLUX.2 VAE](https://github.com/black-forest-labs/flux2) | Apache-2.0 | yes | yes | Apache notice | V |
| [Mistral Small 3.2](https://huggingface.co/mistralai/Mistral-Small-3.2-24B-Instruct-2506) (FLUX.2-dev encoder) | Apache-2.0 | yes | yes | Apache notice | V |
| [PuLID-FLUX](https://huggingface.co/guozinan/PuLID) v0.9.x | Apache-2.0 | yes (adapter) | adapter yes; **stack no** | Apache notice | V |
| [PuLID-Flux2 klein](https://huggingface.co/Fayens/Pulid-Flux2) | MIT | yes (adapter) | adapter yes; **stack no** | MIT notice | S |
| [InsightFace antelopev2 / buffalo_l](https://github.com/deepinsight/insightface#license) | code MIT; **models non-commercial research only** | n/a | **no** (commercial licence from InsightFace) | — | V |
| [EVA02-CLIP-L-14-336](https://huggingface.co/QuanSun/EVA-CLIP) | MIT | yes | yes | MIT notice | V |
| [facexlib](https://github.com/xinntao/facexlib) retinaface / bisenet weights | repo MIT; weights unstated | ? | ? | — | U |
| [T5-v1.1-XXL](https://huggingface.co/google/t5-v1_1-xxl), [umT5-XXL](https://huggingface.co/google/umt5-xxl), [SigLIP so400m](https://huggingface.co/google/siglip-so400m-patch14-384) | Apache-2.0 | yes | yes | Apache notice | V |
| [CLIP-L](https://github.com/openai/CLIP/blob/main/LICENSE) | MIT | yes | yes | MIT notice | V |
| [SDXL base 1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/main/LICENSE.md) | CreativeML Open RAIL++-M | yes | yes | Attachment A use restrictions, passed on if distributed/hosted | V |
| [SDXL VAE](https://huggingface.co/stabilityai/sdxl-vae) | MIT | yes | yes | MIT notice | V |
| [Juggernaut XL Ragnarok](https://civitai.com/models/133005/juggernaut-xl) | Open RAIL++-M + Civitai permissions | **yes** (commercial image use ticked) | conditional: selling images is ticked; running it as our own paid generation service is not | **credit the creator** | V |
| [gameIconInstitute3d v1.0](https://civitai.com/models/284567/game-icon-institute3d) | Civitai: no commercial use, no derivatives ("personal study" only) | **no** | **no** | — | V |
| `comic-style-lora-000002` | own training on a FLUX.1-dev base, so a Derivative under FLUX.1 [dev] NC | as dev | **no** | training-data rights unrecorded | S |
| [controlnet-union-sdxl-1.0 promax](https://huggingface.co/xinsir/controlnet-union-sdxl-1.0) | Apache-2.0 | yes | yes | Apache notice | V |
| [IP-Adapter plus SDXL](https://huggingface.co/h94/IP-Adapter) + CLIP-ViT-H | Apache-2.0 / MIT | yes | yes | notices | S |
| [4x-UltraSharp](https://huggingface.co/Kim2091/UltraSharp) | CC BY-NC-SA 4.0 | **no** (per the author) | **no** | BY-NC-SA | V |
| [RMBG-2.0](https://huggingface.co/briaai/RMBG-2.0) / [RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4) | CC BY-NC 4.0 / bria-rmbg-1.4 | **no** | **no** without a BRIA agreement | — | V |
| [BiRefNet](https://huggingface.co/ZhengPeng7/BiRefNet) (general, `_HR`, `-matting`, `_lite`) | MIT | yes | yes | MIT notice | V |
| `BiRefNet_toonout` | fine-tune, licence unrecorded | ? | ? | — | U |
| [BEN2 base](https://huggingface.co/PramaLLC/BEN2) | MIT (the "full" BEN2 is proprietary) | yes | yes | MIT notice | V |
| [InSPyReNet](https://github.com/plemeri/transparent-background) | code MIT; checkpoints unstated | ? | ? | — | U |
| [Qwen-Image](https://huggingface.co/Qwen/Qwen-Image) (2512, Layered, Edit-2509) | Apache-2.0 | yes | yes | Apache notice | V |
| [Qwen2.5-VL-7B](https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct), [Qwen3-4B](https://huggingface.co/Qwen/Qwen3-4B) | Apache-2.0 (the 7B only; the 3B/72B siblings differ) | yes | yes | Apache notice | V |
| [Toon-Tacular Qwen LoRA](https://huggingface.co/renderartist/Toon-Tacular-Qwen-LoRA), [Qwen-Image-Lightning](https://huggingface.co/lightx2v/Qwen-Image-Lightning) | Apache-2.0 | yes | yes | Apache notice | S |
| [Wan 2.2](https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B) (I2V/T2V-A14B, TI2V-5B, VAE) | Apache-2.0 | yes | yes | Apache notice; the card's prohibited-use list | V |
| [Wan2.2-Lightning LoRAs](https://huggingface.co/lightx2v/Wan2.2-Lightning) | Apache-2.0 | yes | yes | Apache notice | V |
| Comfy-Org `*_repackaged` | inherit the upstream licence (repackaging changes nothing) | upstream | upstream | upstream | V/S |
| [gpt-image-1/1.5/2](https://openai.com/policies/services-agreement/) (API) | OpenAI Services Agreement | yes: output is assigned to the customer (§4.1) | yes (API) | usage policies; no training competing models (§3.3(e)); comfy.org terms too | V |
| SAM 3 (`sam3.1_multiplex`) | not checked | ? | ? | — | U |

## What blocks commercial use today

In order of reach, most assets first:

1. **RMBG-2.0**: the default cutout on sdxl, flux and gpt_image. It is a single setting
   (`rmbg_model`).
2. **gameIconInstitute3d_v10**: always wired into every SDXL render. It needs a small code change so
   the LoRA slot can be empty (today a blank name fails the render).
3. **FLUX.1 [dev] family** (`flux1-dev*`, `ae`, `flux1-redux-dev`, and every LoRA trained on it,
   including `comic-style-lora`). This covers the FLUX pipeline and the artist character blueprints.
4. **InsightFace antelopev2**: every PuLID path, on FLUX.1 and FLUX.2 alike.
5. **Unknowns to resolve before shipping**:
   - `BiRefNet_toonout` (the Wan flipbook default)
   - the facexlib weights
   - InSPyReNet
   - SAM 3
   - the contents of the artist blueprints and of the volume itself, neither of which is recorded in
     the repo

Juggernaut XL is **conditional** rather than blocked. Images may be sold, but the licence requires a
credit. It also does not cover running the model as our own paid generation service; generating art
in-house to sell fits the permissions as published.

## Replacements per role

The VRAM figures are for the fleet's 24–32 GB cards, from the fetch-models set notes and the
upstream cards. Quality notes are qualitative. **Nothing has been A/B-tested on our prompts.**

| Role | Today | Licence-cleared replacement | Expected quality | VRAM / speed | Switch cost |
|---|---|---|---|---|---|
| Background removal (image pipelines) | RMBG-2.0 (NC) | **BEN2** base (MIT), in the same `RMBG.model` enum | comparable on hard edges; less proven on our art | ~1–2 GB, similar | **config only** (`rmbg_model: "BEN2"`). The node pulls it from the `1038lab/BEN2` re-host, so first confirm that it is the MIT base, not the proprietary "full" BEN2 |
| | | **BiRefNet** general / `_HR` / `-matting` (MIT) | `_HR` is the strongest on fine edges at 2048 px; `-matting` suits soft alpha | ~2–4 GB (`_HR` more) | the builders must use the `BiRefNetRMBG` node, as the Wan blueprint already does |
| Matting (Wan flipbook) | `BiRefNet_toonout` (unknown) | `BiRefNet` general / `-matting` (MIT) | toonout is tuned for toon art, so expect some loss on flat-shaded edges | same | blueprint param default |
| SDXL style LoRA | gameIconInstitute3d (NC, no derivatives) | **none** (strength 0), or a LoRA we train on **art we own** over SDXL base / Juggernaut | loses the icon look until our own LoRA exists | none | code: allow an empty LoRA slot; train our own |
| SDXL checkpoint | Juggernaut XL (conditional) | keep **with credit**, or SDXL base 1.0 (Open RAIL++-M, clean) | base is noticeably weaker than Juggernaut | same | config |
| FLUX text-to-image | FLUX.1 [dev] (NC) | **FLUX.2 [klein] 4B** (Apache, fetched as `flux2-klein`) | a newer family; supports multi-reference edits natively | ~12.5 GB on disk; fits 24 GB without offload | a new blueprint, or point the FLUX builder at klein (a different graph shape) |
| | | **FLUX.1 [schnell]** (Apache) | same architecture; 1–4 steps; less detail and prompt adherence than dev; dev LoRAs do not transfer cleanly | same as dev (~12 GB fp8), much faster | config (`flux_checkpoint` / `flux_unet`), plus the schnell `ae` |
| | | **Qwen-Image 2512** (Apache, fetched) | strong prompt adherence and text rendering; the one path clean end to end | ~20 GB peak (the encoder and model load in turn) | blueprint (the character guide already uses it) |
| | | a **BFL self-hosted commercial licence** | keeps FLUX.1/2-dev quality | unchanged | a purchase; pricing unpublished, and tier coverage of FLUX.1-dev must be confirmed with BFL sales |
| Style reference | FLUX Redux (NC) | FLUX.2 klein multi-reference, or Qwen-Image-Edit-2509 (Apache), or IPAdapter on SDXL (Apache/MIT) | different conditioning; needs prompt retuning | klein ~12.5 GB; Qwen-Edit ~20 GB+ | a blueprint |
| Face / character identity | PuLID + antelopev2 (NC) | **Qwen-Image-Edit-2509** reference-image editing (Apache, no face detector) | identity by reference image rather than an embedding; looser on likeness, fine for stylised characters | ~20 GB+ | a blueprint. InfiniteYou is **not** an alternative (CC BY-NC, and it also uses InsightFace) |
| | | an InsightFace commercial licence | keeps PuLID | unchanged | a purchase |
| Character / comic LoRA | `comic-style-lora` on FLUX.1-dev | retrain on **FLUX.2 klein 4B** or **Qwen-Image** using training art we own | depends on retraining | as the base | retraining; record the training-set provenance |
| Upscaler (not in prod) | 4x-UltraSharp (NC) | Real-ESRGAN x4plus (BSD-3, on the share), 4x-Nomos8kSC (CC-BY-4.0, credit), 4x-NMKD-Siax (WTFPL) | UltraSharp is sharper on some art; Nomos8kSC is a close peer | small | drop-in file |
| Video | Wan 2.2 (Apache) | **no change** | — | — | — |
| API image | gpt-image (clear) | **no change** (note the comfy.org terms) | — | — | — |

## Recommendation (the owner decides)

| # | Action | Unblocks | Risk | Effort |
|---|---|---|---|---|
| 1 | Switch the default `rmbg_model` **RMBG-2.0 → BEN2**, then move the builders to BiRefNet if BEN2's edges disappoint | every sdxl / flux / gpt_image asset's cutout | low: one setting, reversible | config |
| 2 | Make the SDXL LoRA slot **optional** and default it **off**; stop using gameIconInstitute3d | every SDXL asset | low; the look changes | small code change |
| 3 | Keep Juggernaut **with a credit line** (add it to the game credits / delivery notes), or confirm terms with RunDiffusion | SDXL | low | none / an email |
| 4 | Make **Qwen-Image 2512** (and klein 4B) the production path for new characters and hero art; keep FLUX.1-dev R&D-only | FLUX and character work | medium: quality retuning | new prod blueprints + putting the weights on the prod volume |
| 5 | Retire PuLID from shippable work. Use Qwen-Image-Edit-2509 for identity, or buy an InsightFace licence | character identity | medium | blueprint, or a purchase |
| 6 | If FLUX [dev] quality is essential, **price a BFL self-hosted licence** and confirm it covers FLUX.1 [dev] + Redux | FLUX as-is | cost | a purchase |
| 7 | Resolve the unknowns: BiRefNet_toonout, facexlib, InSPyReNet, SAM 3; list the R2 blueprints and the volume contents | certainty | — | owner / a read-only R2 listing |
| 8 | Add a publish/deploy warning for assets whose provenance is `blocked`/`unknown`, the way Sound's licence summary warns | stops a blocked asset shipping silently | low: it informs, it never blocks | a follow-up change |

Items 1–3 cover the default SDXL path end to end: SDXL base or Juggernaut with credit, no LoRA,
BEN2 cutout, and a clean ControlNet/IPAdapter.

## Provenance: what each asset records

This groundwork shipped alongside this doc. It is inert: it changes no default and blocks nothing.

- **Per variant (the generated image):** `run_region` reads the final ComfyUI graph that it
  submitted. It resolves every model named in it: loader filenames, enum-valued models such as
  `RMBG.model` and the IPAdapter preset, and the weights PuLID nodes load by themselves. Each one is
  checked against `model_licences.json`. The result goes to a sidecar
  `batch/<variant>.provenance.json` beside the PNG (staging + R2). It records:
  - the pipeline / blueprint
  - the models, each with its licence id and status
  - an overall `commercial` (worst of the models: blocked > unknown > conditional > clear)
  - `blocked_by` and `unknown`
  - the licence-table date
- **In the atlas manifest:** each region gets `provenance` from the variant that actually composes.
  The manifest also gets a top-level `provenance_summary`. Assets generated before 2026-09-29 read
  `unknown` (no sidecar).
- **Video:** each variation in the Flipbook session `meta.json` carries `provenance`.
- **Already present:** ComfyUI embeds the full resolved graph in each PNG's `prompt` text chunk, so
  older variants can be audited after the fact.

## Sources

Primary sources were read on 2026-09-29. The main ones:

- **BFL:** licence texts in the `black-forest-labs/flux` and `flux2` repos, and
  [bfl.ai/licensing](https://bfl.ai/licensing).
- **Hugging Face model cards and LICENSE files** linked in the tables above.
- **Civitai model pages (API permission flags):**
  - Juggernaut XL, [133005](https://civitai.com/models/133005/juggernaut-xl)
  - Game Icon Institute3d, [284567](https://civitai.com/models/284567/game-icon-institute3d)
  - the related SDXL LoRA, 542999
- **InsightFace:** the README licence section.
- **OpenAI:** the Services Agreement.
- **Kim2091/UltraSharp:** the model card plus the author's reply in HF discussion #4.
