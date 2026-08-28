# Invisible Flipbook — Video mode (AI video → clip) — design + build plan

> A **mode of `/flipbook`**, not a new tool (no launcher-registry entry) — the same relationship
> 🎬 Cinematic has to `/rigger`. Generate N variations of a video from a ComfyUI blueprint, watch
> them play in a grid, pick one, and turn it into a `FlipbookClip`. Current state lives in
> [docs/status/flipbook.md](../status/flipbook.md). Owner direction 2026-08-26.
> Related: [invisible-blueprints.md](invisible-blueprints.md) (what a blueprint is),
> [comfyui-serverless.md](comfyui-serverless.md) (the transport this rides),
> [invisible-flipbook.md](invisible-flipbook.md) (the clip the mode produces).

## Why this belongs in Flipbook, not the Atlas Maker

The Atlas Maker's unit of work is **a region of an atlas** — one still, generated from one prompt,
composed into a packed page. A video is a *sequence*, and the only thing in this repo that owns
"an ordered, named, timed group of frames" is `FlipbookDoc`. Routing video through the Atlas
Maker would mean inventing sequence ownership in the one tool that has no concept of order (the
`invisible-flipbook.md` §"Why a tool, not a field" argument, unchanged).

What the Atlas Maker *does* own and this mode reuses wholesale: the blueprint library, the generic
blueprint runner, the RunPod Serverless transport, and the MaxRects packer.

## The chain

```
blueprint (_shared/blueprints/<id>)          ← already exists, incl. the upload button
  → N RunPod Serverless jobs, one seed each  ← _runpod_run_and_wait, already exists
  → N animated WEBPs in R2                   ← NEW: <client>/<project>/video/<session>/
  → results grid, each tile plays itself     ← NEW: /flipbook 🎬 mode
  → pick one, trim (range · stride · size)   ← NEW
  → Pillow ImageSequence → frames            ← NEW, no ffmpeg (see "Why WEBP")
  → pack.py auto-pack → page + manifest      ← already exists (from-scratch atlas auto-pack)
  → FlipbookClip, frames in order            ← /api/flipbook/save, already exists
```

### Why WEBP is the format to standardise on

The blueprint ends in an animated-WEBP save node, and that choice removes three problems at once:

- **No ffmpeg.** Pillow (already a dependency, `>=10.4.0`) reads animated WebP through
  `ImageSequence.Iterator`. A WEBM/mp4 output would need `apt-get install ffmpeg` in the
  `atlas-tool` image and a second decode path.
- **Alpha survives.** WebP carries an alpha channel; VP9/h264 effectively do not. This matters
  more than it sounds — see "Alpha is the blueprint's job" below.
- **The grid is free.** An animated WebP plays, loops and respects alpha inside a plain `<img>`.
  No `<video>` element, no poster frames, no playback state to manage.

`SaveAnimatedWEBP` is expected to report under ComfyUI's `outputs[*].images`, which the existing
worker collector already walks — but that is an assumption until one real job proves it, and it is
step 0 of the build plan for exactly that reason.

### Alpha is the blueprint's job, not the extractor's

Background removal in this pipeline happens in a **ComfyUI node inside the graph**, not on the
Python side — the `atlas-tool` requirements are Pillow and boto3, nothing else. The built-in
pipelines use RMBG-2.0 (`batch_atlas.py:82-87`); the owner's video blueprint uses **BiRefNet**.
Either way the matte must be produced per frame *inside the graph*, before the WEBP save. The
extractor will not (and should not) grow a second, divergent matting implementation.

Two things about that are unverified and are folded into step 0:

1. **Does the node exist on the serverless worker?** The worker image bakes exactly five node
   packs, pinned to SHAs (`services/atlas-serverless/Dockerfile:49-65`): `ComfyUI_IPAdapter_plus`,
   `1038lab/ComfyUI-RMBG`, `comfyui_controlnet_aux`, `PuLID_ComfyUI`, and the vendored
   `ComfyUI-PuLID-Flux`. `1038lab/ComfyUI-RMBG` ships BiRefNet among its models, so a BiRefNet
   node *from that pack* is already present — one from any other repo is not, and the graph will
   fail on serverless while working fine on the R&D pod. **This is the main risk of promoting a
   pod workflow to serverless** and it is answerable statically by reading the workflow JSON.
2. **Does alpha survive the save?** ComfyUI `IMAGE` tensors are RGB by convention, with the matte
   riding alongside as a `MASK`; whether a 4-channel frame reaches the animated-WEBP file depends
   on how the graph joins them and on what the save node writes. One real job settles it —
   `Image.open(result).mode` is either `RGBA` or it is not.

A blueprint whose frames come back opaque produces opaque symbol art, and the tool should say so
rather than silently pack a black box.

## The reference blueprint (`WanIMGtoVIDandBCKG`)

The owner's Wan 2.2 I2V graph, read node-by-node 2026-08-26. Everything below is measured from
that JSON, not assumed.

### Node availability on the pinned worker — one gap

The worker pins ComfyUI **v0.33.1** (`atlas-serverless/Dockerfile:35`, equal to `atlas-comfy-pod`)
plus five SHA-pinned node packs. Against that:

| Node | Source | On the worker? |
|---|---|---|
| `WanImageToVideo`, `KSamplerAdvanced`, `ModelSamplingSD3`, `UNETLoader`, `CLIPLoader`, `VAELoader`, `LoraLoaderModelOnly`, `VAEDecode`, `LoadImage`, `CLIPTextEncode` | core | ✅ |
| `PrimitiveInt` / `PrimitiveFloat` / `PrimitiveBoolean` | core `nodes_primitive.py` | ✅ |
| `ComfySwitchNode` (×6) | core `nodes_logic.py` — **verified present at v0.33.1** | ✅ |
| `ComfyMathExpression` | core `nodes_math.py` — **verified present at v0.33.1** | ✅ |
| `BiRefNetRMBG` | `1038lab/ComfyUI-RMBG` — the pack we already bake (`RMBG_REF`) | ✅ |
| **`ImageResizeKJv2`** | **`kijai/ComfyUI-KJNodes` — baked in NEITHER image** | ❌ |

KJNodes is presumably Manager-installed on the R&D pod's persistent volume (the pod bakes
`ComfyUI-Manager`, the serverless worker does not and has no persistence). **Fix: replace node 196
with core `ImageScale`** rather than adding a sixth pinned pack. Node 196 is configured
`keep_proportion: "stretch"`, 640² → 320², `divisible_by: 2` (a no-op at 320) — so `pad_color` and
`crop_position` never apply, and core `ImageScale` (`nearest-exact`, 320×320, `crop: disabled`) is
pixel-for-pixel equivalent. One fewer custom-node dependency on a graph that must run on a fixed
image.

### What the graph actually produces

- **It is IMAGE → video.** `LoadImage` (97) feeds `WanImageToVideo.start_image`. The mode therefore
  needs a **source-image picker**, not just a prompt — and that is a gift, not a cost: point it at
  an existing symbol region and the model animates *that* art. The Atlas Maker's `/fsbrowse` R2
  picker is the reusable precedent.
- **`SaveAnimatedWEBP` (200) reports under ComfyUI's `outputs[*].images`**, which the existing
  `_collect_images` already walks. The `gifs`/`videos` widening is still worth doing for future
  blueprints, but it is **no longer blocking**.
- **81 frames at 320×320.** Node 193 computes `floor(duration × fps + 1)` = `floor(5 × 16 + 1)`.
  Alpha-trimmed, that packs into roughly 2–3 pages of 2048² — comfortably under the budget a 512²
  output would have cost.
- **Alpha is OFF by default.** Node 203 (`RemoveBCKG?`) is `false`, so switch 201 takes `on_false`
  = the plain resize. The BiRefNet branch (202, `BiRefNet_toonout`, `background: "Alpha"`) is fully
  wired but bypassed. For symbol art it wants to be ON — expose it as a param. Its weights
  auto-download into `models/RMBG/` on first use and are **not** in `fetch-models.py`, so whether
  they are on the serverless network volume is unverified.
- **The two fps disagree.** Generation is 16 fps (node 192, and it drives the frame count); the
  save node writes the WEBP at 12. The clip's default fps should come from **node 192**, the
  intended motion rate — not from the save node.
- **The 4-step LoRA branch is OFF** (node 171 `false` → 20 steps, cfg 3.5, two-stage 14B). The
  branch is wired to `wan2.2_i2v_lightx2v_4steps_lora_v1_*`, which is the `wan22-turbo` set already
  in `fetch-models.py`. For "generate N variations and browse them", 20 → 4 steps is the difference
  between browsing and waiting. Expose it, default ON for variation runs.
- **`lossless: true` is a payload risk.** 81 lossless 320² RGBA frames plausibly lands near
  RunPod's ~20 MB `/status` cap once base64-expanded. Default variation runs to `lossless: false,
  quality: 90`; if a lossless master is ever wanted, the worker must write to R2 directly instead
  of returning bytes inline.

### Bindings — published as `blueprints_src/wan22_i2v_flipbook/`

Prepared 2026-08-26 and **verified against the real validator**
(`blueprints.validate_against_graph`): 15 params, 6 models, `custom_nodes: []`, every binding and
every param target proven to exist in the graph.

| Role | Node | Note |
|---|---|---|
| `positive` | `170.text` | |
| `negative` | `194.text` | |
| `seed` | `180.noise_seed` | **Not 181** — that stage has `add_noise: disable`, so its seed is inert |
| `output` | `200` | `SaveAnimatedWEBP` carries `filename_prefix`, the same field the runner sets |
| `style_ref` | `97.image` | Mechanically the ref role; call it **Source image** in the UI |
| `width` / `height` | **deliberately UNBOUND** | see below |

**`width`/`height` must NOT be bound.** `build_workflow_blueprint` fills those roles from
`GEN_WIDTH`/`GEN_HEIGHT` (`batch_atlas.py:1675`), whose config defaults are **1024**
(`batch_atlas.py:101`) because they were sized for stills. Injecting 1024² into `WanImageToVideo`
across an 81-frame batch is a VRAM and wall-clock blowup versus the tested 640². Generation size is
exposed as the `gen_width`/`gen_height` params instead, so it is explicit and cannot inherit a
still-image setting. (The role names are reserved, hence the `gen_` prefix — a param key that
collides with a role is a validation error.)

Two params carry a warning in their own label: `steps` and `cfg` drive nodes 168/177, which the
switches read **only while `fast_lora` is off**. Unlabelled, they would be phantom controls — set
them in fast mode and nothing happens.

`BiRefNet_toonout` is left baked in the graph rather than exposed as a `select`: the node's model
enum at the pinned `RMBG_REF` is unverified, and a wrong option string is a graph rejection at run
time. Expose it once the enum is read off a live `/object_info`.

### One existing code path must not be reused as-is

`_run_region_serverless` ends with `Image.open(blob).convert("RGBA")` and persists a `.png` — which
would flatten an animated WEBP to frame 0. The video runner needs its own persist branch. This is
new code beside the still path, **not** a change to it.

## Two libraries, one store

A blueprint declares a **`kind`** — `image` (the Atlas Maker's region generation) or
`video` (this mode). They share the `_shared/blueprints/` store but are **not
interchangeable**: a video graph pushed through the still-image runner produces nothing
usable, and an image graph offered in the video picker is a trap. So each tool's PICKER
filters to its own kind, while the MANAGEMENT list stays unfiltered — hiding a kind there
would strand it with no way to delete it.

**Declared, never inferred.** "Does the graph end in an animated save node?" would be a
guess that silently mis-files a blueprint the moment someone uses a save node we did not
anticipate. **Absent = `image`**, so every blueprint authored before this keeps working
and keeps appearing exactly where it did. `video_runner` re-checks the kind as well:
the picker is filtered, but a stale tab can still name an image blueprint, and running
one burns a GPU job to produce a single still.

## Where each piece runs

| Piece | Home | Why |
|---|---|---|
| Job submit + poll, WEBP → R2 | `services/atlas-tool`, new JSON endpoints | `blueprints.py`, `_runpod_run_and_wait`, `pack.py`, R2 staging and the per-(client,project) path resolver all already live in that one process |
| Frame extract + pack + manifest | same | Pillow + `pack.py` + `auto_pack_layout` are there |
| Blueprint upload | same, existing `/uploadblueprint` | ONE shared library, one upload path, one `bp=` publish gate — a second uploader is exactly the duplication the house rules exist to prevent |
| Mode UI, clip creation | `apps/launcher-api` `/flipbook` | The session cookie, the tool entitlement and the project scope are the launcher's; the browser never sees `ATLAS_TOOL_SECRET` |

The launcher's `/api/flipbook/video/*` endpoints **proxy** to `atlas-tool` with the same handoff
`/atlas` already builds (`k` + `client` + `project` + `user`).

**Deliberately NOT reusing the Atlas Maker's active-manifest state.** The video endpoints are
stateless: every call carries its own session id and target sheet name. The process-global active
manifest is a known hazard (atlas-maker status, open item 4 — per-user isolation is designed but
unbuilt), and a new surface should not enlist in it.

## Storage

```
<client>/<project>/video/<session-id>/
  meta.json            # blueprint id, prompt, params, fps, per-variation seed + status
  001.webp … NNN.webp  # one per variation
```

Authoring artifacts only — **these never enter `deploy/`**. Nothing in a game references a video;
the game gets the packed sheet and the clip. Rule 8 is satisfied by the existing chain, because
`editorArtExport` already adds a clip's `assetKey` and every frame to `usedRegions`, so the sheet
this mode generates ships *because* the clip points at it.

## Frame budget (the constraint that shapes the UI)

A 5-second generation is 80+ frames. At 512² that is roughly five 2048² pages — a large bite out
of a project's asset budget for one animation. So the trim step is not a nicety:

- **range** (first/last frame), **stride** (every Nth frame), **max size** (downscale before pack)
- each frame is alpha-trimmed before packing, so the cost is ink, not canvas
- a live readout — *"48 frames → 1 page (2048×1408)"* — before anything is written

## Build plan

0. **Make the blueprint serverless-safe, then publish it.** Swap node 196 `ImageResizeKJv2` →
   core `ImageScale` (the one missing node); default `lossless` off; add the bindings + params
   from the table above; publish through the existing `/uploadblueprint`. Then **one real job**
   confirms the three things reading the JSON cannot: that the WEBP comes back with an alpha
   channel when `RemoveBCKG?` is on (`Image.open(result).mode == "RGBA"`), that the
   `BiRefNet_toonout` weights resolve on a cold worker, and that the returned payload fits under
   RunPod's `/status` cap. Widening `_collect_images` to `gifs`/`videos`
   ([handler.py](../../services/atlas-serverless/handler.py)) rides along for future blueprints,
   but this one does not need it.
1. **Runner — DONE** (2026-08-26). `services/atlas-tool/video_runner.py` + seven routes in
   `ui_server.py`: `POST /video/{generate,cancel,delete}` and
   `GET /video/{blueprints,sessions,status,file}`. Sessions persist to
   `<C>/<P>/video/<id>/` (`meta.json` + `NNN.webp`), rewritten after **every** variation so an
   interrupted run still lists what it produced. Fixtures: `py test_video_runner.py` (46 checks,
   RunPod/R2/paths stubbed — no GPU, no credentials).
   - **Sequential by design.** The serverless handler keeps ComfyUI warm between jobs when VRAM
     allows, so consecutive variations reuse a loaded model instead of paying the ~29 GB Wan load
     again; fanning out would trade that for N cold starts. Tiles still fill progressively.
   - **Its own submit/poll loop**, not `_runpod_run_and_wait` — that helper returns only the final
     output, and a session needs the job id *while in flight*, for live status and for cancel.
     Cancel is remote (`POST /cancel/{job}`), so a cancelled session stops **burning**, not just
     stops reporting.
   - **One session RUNS at a time, process-wide — the rest QUEUE.** Running sessions
     concurrently is the spend hazard, and it would also throw away the warm-worker reuse that
     makes a session sequential in the first place. Refusing them outright was a different
     mistake: the tool's only advice was "cancel it first", so lining up a second prompt meant
     killing a paid render. `_ACTIVE` owns the runner, `_QUEUE` is the line behind it (cap
     `MAX_QUEUED_SESSIONS`, a waiting session having spent nothing and cancelling for free), and
     the hand-off is a `finally` — a worker that dies can no longer wedge the tool.
   - **Seeds are capped at 2^53−1.** They are echoed into `meta.json`, which a browser parses —
     a larger integer silently loses precision in JSON, so a "locked" seed would round to a
     different one and stop reproducing its own render.
   - A failed variation is recorded and the session continues; one bad job does not kill the run.
   - **A session is EDITABLE, not a frozen batch.** One slot can be re-rolled in place (`/video/regen`),
     one render deleted (`/video/discard`), and more rolls appended (`/video/add`) — all within the
     session, because the grid is the comparison the author is making and splitting it across
     sessions hides that. Two consequences worth stating: a re-rolled prompt is recorded on the
     VARIATION (the session's prompt still describes every other tile), and a deleted slot keeps its
     index (that index is the stored filename, and a clip may already be packed from it), so new
     variations number on from the highest ever used. The worker re-picks the lowest pending slot
     each iteration rather than iterating the list once, which is what lets any of this happen while
     a pass is already running.
2. **Mode UI — DONE** (2026-08-26). `/flipbook` gains a 🎬 Video mode via the canonical
   `<CanvasModeBar inline>` in the ToolTopBar's `meta` snippet; the surface itself is
   `VideoMode.svelte` (a separate component — the clip editor is already 1300 lines and the two
   modes share nothing but the project). Blueprint picker + description, prompt/negative,
   source-image picker, variation count, params rendered from the blueprint's own `params[]`
   grouped by `group`, live progress, and a results grid.
   - **No `<video>` element.** An animated WEBP plays, loops and honours alpha in a plain `<img>`.
     The checkerboard behind each tile is load-bearing: it is how the author sees whether the
     cutout produced real alpha rather than a matte-coloured rectangle.
   - **`api/flipbook/video/[...path]` is an explicit ALLOW-LIST, not a pass-through.** A rest route
     that forwarded whatever it was given would hand any flipbook user the entire atlas-tool
     surface — `/render`, `/deleteblueprint`, `/createatlas` — under a gate that never mentions
     them. Auth is the canonical `toolScope.gate` on `flipbook`; `ATLAS_TOOL_SECRET` is appended
     server-side and never reaches the browser.
   - **The source-image picker proxies the atlas-tool's `/fsbrowse`** rather than becoming the
     launcher's 5th file browser — it already returns paths in the exact per-root form the runner
     resolves, and a re-implementation would drift from it (`docs/ui-inventory.md` §1).
   - Polling runs only while a session is actually in flight, and the page re-attaches to a session
     still running from a previous visit.
   - **Not yet built:** the per-tile "🎞 Make flipbook" button is present but DISABLED and
     labelled as arriving with step 3 — the shape is visible, the dead end is not hidden.
3. **Video → clip — DONE** (2026-08-26). `video_to_clip.py` + `POST /video/toclip` and
   `GET /video/probe`. Extract → downscale → alpha-trim → MaxRects-pack → page PNG +
   TexturePacker JSON + Invisible manifest; the launcher then writes the clip through the
   existing `/api/flipbook/save` and opens it in the clip editor. Fixtures:
   `py test_video_to_clip.py` (builds a real animated WEBP and runs the real packer).
   **The split is deliberate: the TOOL makes the sheet, the LAUNCHER makes the clip** — clip
   storage, its ETag compare-and-swap and its edit lease belong to the launcher.
   Four things here are load-bearing, each with a fixture:
   - **Trim is RECORDED, not just applied**, as `offX/offY/origW/origH` in **camelCase**. The
     launcher's `parseRegions` reads only camelCase; the snake_case the packer and composers speak
     is silently dropped, and every frame's tight rect then scales to fill its box independently —
     the animation PULSES. This repo already paid for that once on .plist imports.
   - **Trim by the ALPHA channel, never `Image.getbbox()`.** `getbbox()` measures non-zero pixels
     across all bands, so on an opaque frame it crops black borders off the art.
     `getchannel("A").getbbox()` returns the whole box for an opaque frame — no trim, correct.
   - **Paste without a mask.** `paste(img, xy, img)` applies the mask to every band, landing a
     semi-transparent pixel as `src * a` — a premultiply the page must not carry.
   - **Pages cap at 2048.** One AUTO-packed page of 81 frames is ~4200px tall, past what many GPUs
     accept. Frames spill onto extra pages, which costs nothing: clips have spanned sheets since
     2026-07-24 and every frame ref emitted here is atlas-scoped.
   - **Frame refs are ALWAYS atlas-scoped**, even on a single page. A bare name resolves against the
     flat cache where every sheet's `frame_0000…` collide — the exact bug that made one symbol play
     another's animation.
   - **The clip's fps comes from the WEBP's own frame duration**, divided by the stride. Pillow
     populates `info["duration"]` only after an explicit `seek()` + `load()`; reading it off
     `ImageSequence.Iterator` returns `None` and the fps silently falls back to a default. The
     first draft had exactly that bug and the fixture caught it.
4. **Docs (rules 6 + 9).** `docs/tools/flipbook.md` gains the mode; `docs/status/flipbook.md` gains
   the state. No registry entry changes — this is a mode, not a tool.

## Open questions

1. **Cost visibility.** N video variations on a serverless GPU is materially more expensive than N
   stills. The generate button should show an estimate before spending.
2. **Re-roll semantics.** Does a re-rolled variation replace its tile or append? (The Atlas Maker
   appends and keeps every variant; the same is probably right here, but video is heavier.)
3. **Session retention.** Nothing prunes `<project>/video/` today. A weekly sweep, a per-session
   delete, or both.
