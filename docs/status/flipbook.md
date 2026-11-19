# Invisible Flipbook — status

> Design: [docs/design/invisible-flipbook.md](../design/invisible-flipbook.md) · Video design: [invisible-flipbook-video.md](../design/invisible-flipbook-video.md) · Character clips plan: [character-facings-network.md](../design/character-facings-network.md) · Guide: [docs/tools/flipbook.md](../tools/flipbook.md) · Agent: [`.claude/agents/invisible-flipbook.md`](../../.claude/agents/invisible-flipbook.md) · Detail: [flipbook-history.md](flipbook-history.md)

**One-line state:** Shipped on `main` — clips are authored at `/flipbook`, ship to games, and are
played by Symbols, the Scene Editor, the Rigger and FX. 🎬 Video mode generates on the RunPod GPU
(owner-confirmed 2026-09-01) and a render can become a clip, a download, or Atlas Maker source art;
the specifics listed in open item 1 are still unobserved on a real run. **Characters mode**
(a character's whole clip set at once) is built on its branch (2026-11-19), run on a local
launcher with made-up art only.

## Current state

All of the design's build plan (steps 1–8) and video mode steps 0–3 are on `main`. The why behind
each piece is in [flipbook-history.md](flipbook-history.md) ("Build detail by feature").

**Clips**
- **`packages/engine-flipbook`** — `FlipbookDoc` / `FlipbookClip` + `normalizeFlipbookDoc`
  (dependency-free, Node-resolvable). A clip has a primary `assetKey`, an ORDERED frame list (a
  repeated frame is a hold), `fps`, `loop`, and optional `direction` (forward / reverse /
  ping-pong), `flipX`/`flipY` and a `bounds` box; defaults are dropped on save. A frame is a bare
  region name or an atlas-scoped `<assetKey>::<region>` ref, so one clip spans sheets
  (`clipSheetKeys` / `clipFrameRefs`).
- **`/flipbook` Clips mode** — saved-clip rail, drag-reorderable frame list, preview (play/pause,
  scrubber, fps, loop, direction, mirror) in a pan/zoom viewport with a height grip, a bounds box
  (`$lib/BoundsBox.svelte`, fit maths in `$lib/boundsFit.ts`), a source-sheet region grid with
  sequence detection, and **↻ Refresh from R2** (clears the region, page-image and crop caches).
  `/api/flipbook/save` + `delete` are `flipbook`-gated, session-scoped, ETag-CAS (409 on a stale
  save). Dangling frames are struck through and counted at author time.
- **Runtime** — `<Flipbook>` in `pixi-svelte` (the first `AnimatedSprite` call site): frames
  resolved by `resolveClipFrames` (scoped → bare precedence, no whole-sheet fallback — an
  unresolvable clip renders nothing); direction is a walk over indices (`playbackIndices`),
  mirroring is the sign of `scale`, `bounds` reach pixels as `orig` + `trim` (`applyClipBounds`).
  `textures` is assigned only when the frame list really changes (PIXI's setter stops playback).
  `registerFlipbooks` / `resolveFlipbook` live in `engine-layout`; per-use playback overrides fold
  through one `foldFlipbookPlayback`.
- **Consumers** — a Symbols `flipbook` cell, a Scene Editor `flipbook` node (plays live on the
  canvas, cover-fits a background screen, can be swapped by a signal `cue`), a Rigger
  `event.flipbook` binding (plays wherever the rig is mounted), and FX particle art.
- **Ship chain** — `flipbookExport.ts` → `deploy/clips/` → bake → pull → `registerFlipbooks`
  (`bakedFlipbooks()`); the live runtime bundle runs the same export. Only clips something plays
  ship (`clipReachability.ts` `collectPlayedClipIds`, shared with the art export; unknown ⇒ ship
  all). A dangling clip frame is FATAL at bake. Atlas refs are repaired on the ship path
  (`createAtlasRefResolver`) so a bare `frame_0000` can never fall into the flat cache where every
  sheet's frames collide.

**Characters mode** (`CharacterMode.svelte` / `CharacterPanel.svelte` /
`CharacterDirections.svelte`; pure modules in `apps/launcher-api/src/lib/flipbook/`)
- **What it is for** — an arcade character plays clips found by NAME,
  `<prefix>_<state>_<facing>` (`engine-layout` `characterClips.ts`). The mode shows and makes a
  character's whole set. `?mode=characters` opens on it.
- **Nothing of the game's rule is restated.** A clip's name is the first id
  `resolveCharacterClip` asks for, and the stand-ins are the ids it asks for next
  (`characterSet.ts` `characterClipCandidates`), so the grid, the valid names and the stand-in
  of a missing cell follow any change made there. Which characters a project has is
  `projectCharacters.ts`: the config's online characters through `characterClipsIn`, as
  `apps/lines` `clipLookOf` resolves them, plus the Salmons built-ins and any component with a
  block that the config does not list yet.
- **Reads** — one new route, `GET /api/flipbook/characters`: the characters, every clip id, and
  the clips under a character's prefix in full. Its sources are `clipReachability`'s.
- **Writes** — only the tool's own `/api/flipbook/save`, one request per clip
  (`characterWrites.ts`). A new clip is sent with `baseEtag: null` and never `force`, so a clip
  that exists comes back `exists` and is untouched. A saved clip (the one Bounds box) is read
  fresh, saved with only its box changed against the ETag read, under its edit lease
  (`leaseOnce.ts`, a `LeaseState` taken for one write). The clip open in Clips mode is under
  that tab's own lease already: it is read again after a write, and left alone while it has
  unsaved edits.
- **Facings** — 4 or 8 is saved into the character's component (`characterFacings.ts`) through
  the editor's own `GET ?stored=project` + conditional `POST /api/editor/component`, the way
  ✎ Rename saves, under the `componentEditor` lease. A content change, so the component gets a
  new version. Offered only for a project-scope component that carries the block, to a user
  who holds the Scene Editor.
- **Ship chain** — no new step. A clip the mode makes is an ordinary clip under a character's
  prefix, which `clipReachability` already counts as played. Every clip under the prefix
  ships, a misnamed one too.
- **Gate** — `check:flipbook-characters` (launcher): 120 checks, 14,504 grid cells compared with
  `resolveCharacterClip`, 38 of 38 mutants caught.

**🎬 Video mode** (`VideoMode.svelte`; runner in `services/atlas-tool`)
- **Generate** — pick a `kind: video` blueprint (bundled ones sync from `blueprints_src/` on boot;
  the author's own publish via **＋ Blueprint**, which follows wires back to primitives, ranks
  candidates, reads node contracts from ComfyUI `/object_info`, and flags unexposed boolean
  gates), a prompt, a source image (atlas region, file browser, or upload via presigned PUT), a
  variation count (no ceiling) and settings (bounded sliders / live option lists).
- **Runner** — `video_runner.py`: one session runs at a time, up to four queue behind it, and
  `VIDEO_PARALLEL_JOBS` variations of it run at once. The worker PUTs each render to a presigned R2
  hand-off slot (`video/_out/`), so RunPod's payload cap does not apply. Session docs are persisted
  before dispatch, written by CAS, and owned through an R2 lease (`iw_common/lease.py`); a
  container re-attaches to paid in-flight jobs at boot (collect only, never start), any process can
  collect any slot, and `sweep_stranded_slots` re-homes or clears what is left. Cancel stops the
  GPU (the worker polls its own status and kills ComfyUI). Status polls tolerate 180 s of
  failure; a 404 on a job already read is re-read at +10/+30/+70/+150 s, then **cancelled** (job
  id + endpoint logged) before the tile settles from its slot. Every path that abandons a job
  still possibly running cancels it; a known-terminal one is never cancelled. A job is polled,
  cancelled and re-attached on the endpoint it was submitted to (`job_endpoint`, persisted with
  `job_id`), so rotating `RUNPOD_ENDPOINT_ID` cannot strand one; a variation persisted before
  that field existed falls back to the env, with a log line naming the job.
- **Cutout weights** — RMBG-2.0 and all 12 BiRefNet variants are fetched onto the volume by
  `fetch-models.py --set rmbg --set birefnet` (commit-pinned, sha256-checked). The worker never
  links the volume's `models/RMBG/`: at boot it verifies that set file by file and stages what
  passes into its own disk, so the node loads it offline. A file that fails is left out and the
  node downloads it into that container only (slower, never shared); the boot log names the
  file and the fix.
- **Per tile** — full-resolution view in its own window, ↻ re-roll (hold seed or prompt), ⧉
  duplicate with new settings (seed held), 🗑 (verified against R2), ⤓ download (the WEBP, or a
  full-res PNG zip + `info.json`), **🎞 Make flipbook** (extract → alpha-trim → pack ≤2048 pages →
  manifest; the launcher writes the clip), and **🖼 To Atlas Maker** (full-res untrimmed frames as
  `style_ref` reference images in a new `grid` atlas; nothing packed, active atlas not switched).
- **Sessions** — a thumbnail run picker (`$lib/RunPicker.svelte`), a recipe panel with **↻ Use
  these settings**, and a confirmed whole-session delete that verifies against R2.

## Open items / next

1. **Observe a real run end to end.** Unobserved: whether the WEBP comes back `RGBA` with the cutout
   on; whether a full-length render clears the hand-off path on a real endpoint; and whether a
   session goes **pick → pack → clip in the editor**, **⤓ zip** on a full 81-frame render, and
   **🖼 To Atlas Maker → regenerate** on real R2.
2. **Rename-repair hint is unconfirmed** — `sheet_session.json` is one open sheet's state, so
   per-sheet recovery of `src` must be verified before the tool promises "did you mean…".
3. **＋ Blueprint does not flag an unexposed NUMERIC knob** (only boolean switch gates) — "this
   int matters" has no clean signal. Deliberate.

4. **Evaluate Wan2.2-Animate-2 for character clips — desk half done, renders owed** (see the
   section below). Blocked on a pod session and the inputs (owner list).
5. **Character facings network — planned 2026-11-19; stills tried once on klein, the rest owed**
   ([design](../design/character-facings-network.md)). 8-direction clips for Salmons' bear and
   fisherman: stills per facing, then this tool's 🎬 Video per state. Built so far: the draft
   stills blueprint `qwen_character_facing` and its card, checked offline only
   (`test_character_facing_blueprint.py`, 36 checks). **That blueprint has never run on a GPU,
   and no video has run.** The stills half of the design's §8 ran on FLUX.2 [klein] 4B on the
   owner's PC, twice: words alone did not turn the bear, a guide image per facing did (§8
   "Second pass"; the bear is now a biped in the owner's cartoon style). Next, the owner's call:
   approve or redo the stills, normalise their size, and the motion half (which also answers open
   item 1's alpha question). Not built: tile labels, the character set panel in 🎬 Video,
   Make all clips from tiles, the measuring script. What they feed is built:
   a clip **🎞 Make flipbook** names `<prefix>_<state>_<facing>` shows in Characters mode's grid,
   and its per-state loop and one Bounds box are `characterSet.ts` `defaultStateSettings` and
   `characterWrites.ts` `applyBoundsToClips`.
6. **Characters mode has not met real data.** Verified on a local launcher (production build,
   local Postgres, a local S3 stand-in) with a made-up bear and fisherman: 36 browser checks,
   and the real export, bake and pull of that project. Not run: the live launcher, R2, the real
   `salmons` project, a published game drawing the clips it made.
7. **Characters mode, left out.** It cannot add a clip block to a component (a developer
   writes it), move `hand`, drag the box (numbers only; Clips mode drags), or delete a
   misnamed clip. A stray clip under a character's prefix still ships: reachability is by
   prefix, on purpose (over-collect, never drop).

## Evaluation: Wan2.2-Animate-2 for character clips (2026-11-16, in progress)

Idea: animate a game character from a **driving motion video** (reference image + driving video +
prompt → the character doing that motion), as a complement to the current Wan 2.2 I2V blueprint,
which stays for symbol/FX loops. R&D only: nothing ships and the worker image is untouched.

**Settled from source (no GPU needed):**
- **ComfyUI core supports it at our pin.** `WanAnimate2ToVideo` + `WanAnimate2Cache`
  (`comfy_extras/nodes_wan.py`) and the `animate2` model type (`comfy/ldm/wan/model_animate2.py`,
  landed 2026-08-07) are in **v0.33.1**, so the pod AND the serverless worker can already run it.
  **No custom node.** The cutout reuses `BiRefNetRMBG`, which is already on both images.
- **No pose extractor.** The node VAE-encodes the raw driving frames (`pose_video`), so the v1
  Animate stack (controlnet_aux pose and face crops, KJNodes) is not needed.
- **Weights** are the `Comfy-Org/Wan-Animate-2` repack (Apache-2.0):
  `wan_animate_2{,_distill}_int8_convrot` (16.65 GB each; bf16 is 32.79 GB) and
  `clip_vision_h` (1.26 GB). The Base template also uses `lightx2v_I2V_14B_480p_cfg_step_distill_rank64`
  (0.74 GB). `umt5_xxl_fp8_e4m3fn_scaled` is byte-identical to the file the `wan22-i2v` set already
  put on the volume (same LFS oid), and `wan_2.1_vae` serves as the VAE. That is **~35 GB new**
  for both checkpoints, or ~18 GB for Distilled alone.
- **The official templates are not runnable as-is at v0.33.1.** The Distilled template is all core
  nodes present at the pin. The Base template's long-video loop (`StartLoop`/`EndLoop`/
  `GetItemFromList`) landed in core on 2026-09-14, after v0.33.1. That only matters past one
  81-frame segment, and a Flipbook clip is one segment, so the spike graph is a single pass.
- **"Base" in ComfyUI is not the card's Base.** The Base template runs the Base int8 weights with
  the lightx2v LoRA at 6 steps (lcm, CFG 1). Distilled runs 10 steps (lcm, CFG 1). The model
  card's Base is 40 steps with CFG. The spike compares all three.
- **VRAM (estimate, unmeasured):** 16.65 GB of int8 DiT, with the fp8 umT5 loaded before it rather
  than beside it. This fits a 24 GB RTX 4090 with the pose cache on CPU
  (`WanAnimate2Cache device=cpu` costs ~12.5 GB of system RAM at 480×832×81). It fits a 32 GB RTX
  PRO 4500 with the cache on GPU. The official README quotes only 8×A800 for 720p, so 640² is
  our default, as for Wan 2.2.

**Judged from the design (verify on the renders):**
- **Canvas stability is driven by the motion clip, not the model.** The output copies the driving
  body's translation, so a walk or run must be filmed **in place** with a static camera (the camera
  is text-steerable: "static camera"). Otherwise the clip walks off its canvas. The pack keeps
  each frame's trim offset, so in-place motion cannot drift after packing.
- **Looping is not built in.** The node has no end-frame input, unlike our I2V path's first-frame
  anchor. A loop is only as good as the driving clip's own loop, and `continue_motion` only extends
  forward.
- **Background comes from the prompt**, not the reference, so prompt a plain flat background to give
  the matte an easy job.
- **Identity on 2D art is the open risk.** The model is trained on human motion. A humanoid cartoon
  should transfer; a fruit, a coin or a creature with no limbs likely will not. That case stays on
  Wan 2.2 I2V.

**What a "go" would cost (its own pipeline-change branch):** a second input role in Video mode,
because today the only image binding is `style_ref`. The new role is a driving-video upload,
uploaded to ComfyUI by `video_runner.py`. It also needs a `kind: video` blueprint and card, plus
the ~18 GB Distilled set on the volume (a `fetch-models.py` set). There is no worker-image change.

**Still owed (needs the owner):** the renders. That means 3–4 cases (idle, walk in place,
attack/win) of one existing character, run as Distilled vs Base+LoRA vs Base, and compared with that
character's Wan 2.2 clip. For each case, judge identity, `loop_seam`, `drift_px` after cutout, and
seconds and $ per clip. The ready-to-run kit is `animate2_graph.py` / `run_spike.py` /
`measure.py`, in the session notes folder (not in the repo). **Recommendation until then:
conditional go for humanoid characters only.** It is cheap to adopt because there is no new node
and no image change. Decide after the renders.

## Blocked (owner / external)

- **Character facings experiment (open item 5).** Needs RunPod credit, 21 GB free on the volume
  for `qwen_image_edit_2509_fp8_e4m3fn.safetensors` (the one attempt to store it was refused on
  quota, [status/rigger](rigger.md)), an R&D pod session, and the owner's eye on the result. The
  owner's decisions are the design's §11.

- **Animate-2 renders (open item 4).** Needs an On-Demand R&D pod (≈1.5 h on a 4090, ~$1–2), a
  one-time ~35 GB weight fetch onto `Invisible_RunPod_Storage`, the reference PNG and Wan 2.2
  baseline session of one character, and three in-place driving clips (ours: phone footage or a
  Wan 2.2 T2V mannequin render).

- **Roll out the checksummed cutout weights** (2026-09-30). The new worker is safe in any order
  (an unfetched volume only means each cold worker downloads its cutout model privately), but it
  is only offline once the volume is fetched:
  1. On an R&D pod from the rebuilt `atlas-comfy-pod` image:
     `python /fetch-models.py --set rmbg --set birefnet` (≈7.5 GB; weights already on the volume
     that match are hashed and kept), then `python /fetch-models.py --verify --set rmbg --set birefnet`.
  2. Point the serverless endpoint at `atlas-comfy-worker:<full merge sha>`.
  3. One cheap render: a single-variation image generation with the default cutout; the worker
     boot log must read `== verified 20 file(s) of rmbg+birefnet` with no download banner.

- **Re-publish the imported video blueprint with a pod running** — the one imported before the
  contract reader carries no bounds or lists; ＋ Blueprint on the same API export bakes them in.
  Until then keep Bck Sensitivity in 0..1 by hand.

## Recent changes

Detail for each entry is in [flipbook-history.md](flipbook-history.md).

- 2026-11-19 — **Characters mode** (owner request: "a small panel that lists the clips a
  character needs, flags missing or misnamed ones, makes them in bulk and previews the
  directions"). A third mode of `/flipbook`, no registry entry; what it does and how it writes
  is under "Current state". Launcher only: no package is touched, so `check:runtime-bytes` is not
  reached. Two things read from the code on the way that the request had otherwise:
  - **A clip's saved Loop does not change the game.** `<SpawnLayer>` folds the animator's own
    `loop` over the clip's (`foldFlipbookPlayback`) and reads a one-shot's length with
    `flipbookCycleMs(id, false)`. So "a one-shot saved as a loop" is flagged as a **note**, not
    as something that draws wrongly. No Bounds, a differing box and a saved Mirror X do change
    the game (`scale = width / bounds.w`; `flipX = clip.flipX !== look.flipX`).
  - **Every clip under a character's prefix ships**, a misnamed one too
    (`clipIdsOfPrefixes`). The mode says so and leaves the delete to the author.

  `detectSequencesAcross` already took a `minLength`; the mode calls it with 1 and adds each
  unnumbered region as a run of one (`detectClipRuns`), so `engine-flipbook` is unchanged and
  Clips mode's offers are the same.
  Verified on a local launcher only (open item 6): `check:flipbook-characters` 120; in Chromium,
  the copy, the bulk make with a clip appearing meanwhile, the box with a clip leased by another
  user and with the open clip clean and dirty, the stills, the facings save; then the real
  `export/clips`, `bake-editor-doc.mjs` and `pull-project-assets.mjs` on that project (23 clips,
  2 sheets, the component's `facings: 8` at v2 in the bundle), and `registerFlipbooks` over the
  baked clips resolving the same clip as the panel drew for all 56 cells of the bear and the
  fisherman.
- 2026-11-19 — **Character facings: second stills pass, with guide images.** The owner asked for
  the bear on two feet and the cartoon style of a game mock-up. 10 stills on the owner's PC with
  FLUX.2 [klein] 4B, a character crop plus a grey block-figure guide per facing: both characters
  turned to all five facings (9 of 10 the right way), which words alone had not done. The guide
  did not set size or foot position, and a few details drift between views. Detail and what it
  changes: the design's [§8 "Second pass"](../design/character-facings-network.md).
- 2026-11-19 — **Character facings: first stills run, on FLUX.2 [klein] 4B on the owner's PC.**
  15 stills through the tunnel (bear master, bear `e`, fisherman master), about 105 to 135 s each
  on an 8 GB laptop GPU. The bear comes out in the art's colours and ink, but words alone did not
  turn it and keep it the same bear, and camera height, size and foot line differ between views;
  the fisherman has two candidates. Verdicts are the owner's. That PC cannot sensibly run the
  Qwen or Wan models (8 GB of VRAM). The motion half was started and called off before any
  render; two small Wan files stayed on the PC. Prompts, timings, the read against S1 to S4, the
  prompt lessons, the node-input answers for §9 and the proposed second pass are in the design's
  [§8 "Results"](../design/character-facings-network.md).

- 2026-11-19 — **Character facings network planned; the stills blueprint drafted.** Owner asked
  for 8-direction animations for Salmons' bear and fisherman, with a ComfyUI network as one source
  of the frames. The plan is [character-facings-network.md](../design/character-facings-network.md).
  Drafted in `services/atlas-tool/blueprints_src/qwen_character_facing/`: the bundled
  Qwen-Image-Edit-2509 graph with an empty square 1024 latent, so a reference of any shape gives a
  square still. `test_character_facing_blueprint.py` (36 checks, 21 of 21 mutants caught) holds it
  to the validators, to the node classes and inputs the bundled Qwen graphs already name, and to
  models the licence registry marks clear. Nothing was added to the pod image or the fetch list.
  Read on the way, for open item 1: the docs do not say which blueprint the GPU runs used (the
  sessions they describe in detail used the owner's looping one), and the one packed sheet they
  measure, `S_New_Squid_Idle`, held fully opaque frames with its cutout setting unrecorded
  ([status/atlas-maker](atlas-maker.md), 2026-09-16).

- 2026-11-16 — **Wan2.2-Animate-2 evaluation, desk half.** Confirmed that ComfyUI v0.33.1 core runs
  it with no custom node and that the weights are Apache-2.0. Added licence entries
  (`wan-animate-2`, `wan-clip-vision-h`, `lightx2v-wan2.1-i2v-distill-lora`, plus the bf16 VAE
  spelling) to `model_licences.json` + `model-licences.md`. Renders owed (open item 4).

- 2026-10-05 — **Invisible Director can drive this tool.** Invisible Director's adapters (PLAN 2.6,
  `apps/launcher-api/src/lib/server/director/ops/`) now read and write this tool's clips
  (`flipbook.list_clips` / `flipbook.save_clip`) through its own storage module, under `If-Match`,
  stamping `saved_by` (`tool: 'director'`, the agent, the run). A save without a stamp drops a
  carried one (`savedBy.ts`), so `saved_by` always names the last save. The page is unchanged.
- 2026-10-01 — **A RunPod job is addressed on the endpoint it was submitted to.** Status, cancel,
  re-attach and every orphan cancel (Stop, delete, blueprint-gone adopt) built their URL from the
  CURRENT `RUNPOD_ENDPOINT_ID`, so after a rotation an old job 404ed, its cancel missed, and it
  billed on. `batch_atlas.runpod_submit` returns `(job id, endpoint)`; the variation persists the
  endpoint as `job_endpoint` beside `job_id`, and `_runpod_get` / `_runpod_post` /
  `runpod_cancel` now take the endpoint explicitly. A variation without one (persisted before
  this) uses the env endpoint and logs `job <id> has no recorded endpoint; assuming <ep> …`.
  The Atlas Maker's still path carries the endpoint on its `@@RUNPOD_JOB@@` marker, so its Stop
  cancels there too. Open item 2 closed (later items renumbered). Offline only, RunPod mocked:
  `test_video_runner.py` + `test_render_slot.py` (3 + 2 new fixtures).

- 2026-09-30 — **Cutout weights pre-fetched and checksummed; abandoned RunPod jobs are
  cancelled.** The pinned BiRefNet loader rewrites `birefnet.py` in place on every load, so the
  shared `models/RMBG/` was being written by every worker — which is why the 2026-09-04 tear
  persisted, not only how it started. Open items 2 and 3 closed; detail in the history file.

- 2026-09-30 — **Leaving with unsaved edits asks in-app too**: the page's own `beforeunload` (reload / tab close only) is replaced by the shared `guardUnsavedWork`, so a tool-bar switch or Back with an unsaved clip raises the app's confirm (Cancel / Leave anyway) instead of discarding it. Pagehide lease release unchanged. (Small enough to need no history entry — see the launcher status of the same date.)
- 2026-09-30 — Stale "clips are not reachability-pruned" comments in `flipbookExport.ts` and
  `bake-editor-doc.mjs` corrected (open item 6 closed).
- 2026-09-29 — **Docs caught up**: unplayed clips have not shipped since #645 and 🖼 To Atlas Maker is merged (both were still described as open). Status detail split into [flipbook-history.md](flipbook-history.md).
- 2026-09-17 — **🖼 To Atlas Maker** (#704) and its `grid` layout (#712): the export writes loose
  reference PNGs and a seed page size; only Create Atlas refuses over capacity.
- 2026-09-16 — **"Re-packed atlas, tool still draws the old art"** was the shared server-side
  page resolver ([editor status](editor.md)); the in-session client caches (incl.
  `regionCrop.ts`'s, which fed stale art to a GPU run) got **↻ Refresh from R2**. `invalidateAll()`
  is safe only because no `$effect` syncs `data` back into the editing state — keep it that way.
- 2026-09-14 — Whole-session delete confirms first; a placed clip can be swapped by a signal cue.
- 2026-09-09 — **Unplayed clips no longer ship** (#645) — reachability is shared by the art and
  clip exports, because gating only the art left a registered clip with no textures, which the
  bake refuses. Session delete and per-tile 🗑 now verify against R2.
- 2026-09-08 — ⤓ download (WEBP or full-res PNG zip + `info.json`); the zip is fetched, never
  linked, so a refusal can't land on disk as `….zip`; over budget raises, never truncates.
- 2026-09-07 — **Deploys mid-render stopped costing renders**: thirteen finished renders had been
  reported as failures. Outcome and render are separate questions (`_Unresolved`, collect from the
  slot); boot re-attach; the rescue covers every settle path; `_out/` is swept; session docs are
  CAS'd and leased across containers (a lease inside the doc would be clobbered by the race it
  prevents; `boto3` ≥ 1.35.69 for `IfMatch`). Railway Watch Paths now stop most swaps.
- 2026-09-04 — **Fourteen hours of failed renders were one torn file** on the shared volume
  (diagnosed from the RunPod log export); failed renders now name the node and exception.
- 2026-09-03 — Imported blueprints read node contracts from `/object_info`; a session is persisted
  before dispatch (a queued one existed only in RAM); a flaky read no longer drops a session from
  the list (`storage.get_strict`); variation caps removed; typed setting labels are kept.
- 2026-09-02 — Parallel variations within a session (`VIDEO_PARALLEL_JOBS`); renders return via R2
  hand-off slots, keys derived rather than stored; an empty payload names `lossless` as the likely
  cause; cancel reaches orphaned sessions and stops the GPU (`handler.py` now tested).
- 2026-09-01 — **First real GPU generation** (owner-confirmed) and ⧉ duplicate live. The imported
  blueprint's failures were an unexposed `fast_lora` gate (a graph's baked value is a default only
  for inputs the manifest names); the publish modal now flags such gates. Status polls tolerate
  transient failure; full-resolution tile view.
- 2026-08-31 — The Rigger became the third consumer (`event.flipbook`).
- 2026-08-28 — Direction / mirror / bounds (step 8) and the pan/zoom preview (a measurement had
  been fed back into what it measured); the bounds overlay had been parented to the wrong element
  (562px drift); per-binding walk on symbol cells; run picker; tile re-roll / delete / ＋ Add;
  sessions queue; a stop reads as `cancelled`, not failed.
- 2026-08-27 — Source image from an atlas region or an upload; a symbol-bound clip draws on the
  Scene Editor board.
- 2026-08-26 — A placed clip cover-fits a background screen (`isCoverFitKind`).
- 2026-08-25 — **A placed clip rendered a still frame in game** — and so had every flipbook symbol
  cell; PIXI's `textures` setter calls `gotoAndStop(0)`. In a hidden tab, measure state, never
  rates. Step 6: a clip can be placed in the Scene Editor.
- 2026-07-24 — Cross-sheet sequence detection authored one symbol's clip from another's sheet;
  atlas-ref repair covers both unscopeable forms.
- 2026-07-21 — Clips feed the live runtime bundle; trim flows atlas → manifest → tool.
- 2026-07-20 — Schema, registry, `/flipbook`, `<Flipbook>`, and the ship chain (steps 1–7).
