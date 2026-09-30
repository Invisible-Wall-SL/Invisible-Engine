# Invisible Flipbook — status

> Design: [docs/design/invisible-flipbook.md](../design/invisible-flipbook.md) · Video design: [invisible-flipbook-video.md](../design/invisible-flipbook-video.md) · Guide: [docs/tools/flipbook.md](../tools/flipbook.md) · Agent: [`.claude/agents/invisible-flipbook.md`](../../.claude/agents/invisible-flipbook.md) · Detail: [flipbook-history.md](flipbook-history.md)

**One-line state:** Shipped on `main` — clips are authored at `/flipbook`, ship to games, and are
played by Symbols, the Scene Editor, the Rigger and FX. 🎬 Video mode generates on the RunPod GPU
(owner-confirmed 2026-09-01) and a render can become a clip, a download, or Atlas Maker source art;
the specifics listed in open item 1 are still unobserved on a real run.

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
  failure; a 404 on a job already read gives up in 15 s.
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
2. **Pre-fetch the BiRefNet weights into the Network Volume.** Nothing does
   (`runpod/provision.sh`, `fetch-models.py`); every variant shares `models/RMBG/BiRefNet/`, and a
   concurrent first download once tore a `.py` and failed every cutout for 14 hours. Until then,
   run the first use of a new BiRefNet model with **1 variation**.
3. **A 404 for a reason other than an expired record** (rotated `RUNPOD_ENDPOINT_ID`, a RunPod
   incident) is given up on in 15 s without a cancel, so a live job keeps billing. Mitigation:
   re-check the slot once after a delay before settling the tile.
4. **Rename-repair hint is unconfirmed** — `sheet_session.json` is one open sheet's state, so
   per-sheet recovery of `src` must be verified before the tool promises "did you mean…".
5. **＋ Blueprint does not flag an unexposed NUMERIC knob** (only boolean switch gates) — "this
   int matters" has no clean signal. Deliberate.

## Blocked (owner / external)

- **Re-publish the imported video blueprint with a pod running** — the one imported before the
  contract reader carries no bounds or lists; ＋ Blueprint on the same API export bakes them in.
  Until then keep Bck Sensitivity in 0..1 by hand.

## Recent changes

Detail for each entry is in [flipbook-history.md](flipbook-history.md).

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
