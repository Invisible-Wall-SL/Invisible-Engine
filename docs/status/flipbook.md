# Invisible Flipbook — status

> Design: [docs/design/invisible-flipbook.md](../design/invisible-flipbook.md) · Guide: [docs/tools/flipbook.md](../tools/flipbook.md) · Agent: `.claude/agents/invisible-flipbook.md`

**One-line state:** _(2026-09-01)_ **Any ComfyUI video graph can be published now, not just one
shaped like the reference.** The ＋ Blueprint dialog follows a wire back to the `Primitive` node
that actually holds a prompt/seed, ranks candidates instead of filtering them (every node input
stays listed), pre-fills a role only when the best answer is unique, and reads a setting's key,
type and default off the graph — an owner export whose knobs were all converted to inputs could
not bind `positive` or `seed` at all before. Was _(2026-09-01)_ **A video tile can be DUPLICATED with new settings.** ⧉ on a
finished card opens the whole recipe — prompt, negative, source image and every blueprint setting —
holds the seed, and runs it as a NEW tile beside the original, which is how you see what one
setting does (owner: *"a version with the background removal, and one without it"*). Still not
live-verified on a GPU: it is the same unproven chain as the rest of 🎬 mode. Was _(2026-08-31)_
**A third consumer: the Rigger.** A rig animation event can bind a clip (`event.flipbook`) the way it already binds an FX effect, so a clip plays on a rig's own beat, on a bound bone, at a slot's depth — see [status/rigger](rigger.md). Was _(2026-08-28)_ Bounds shipped and took two fixes to become usable — the box drew 562px from its art, then the resizable preview grew in Y without limit. The preview is now a proper **pan/zoom viewport** (scroll to zoom about the pointer, drag to pan, Fit, drag-grip height), all three browser-verified and fixtured. **A clip now declares HOW it plays and HOW BIG it is** —
`direction` (forward / reverse / ping-pong), `flipX`/`flipY`, and a `bounds` box drawn over the
preview with the Rigger's drag handles; the same box exists for a plain sprite region
(`editor/art-bounds.json`, authored in the Scene Editor and folded into the shipped sheet at
export). Every placement can override direction/mirror as well as fps/loop. Was _(2026-08-26)_ **A video mode is being built** ([design](../design/invisible-flipbook-video.md)) — generate N video variations from a ComfyUI blueprint, pick one, turn its frames into a clip. Steps 0–3 are code-complete — the serverless-safe `wan22_i2v_flipbook` blueprint, the session runner, the 🎬 mode UI, and video→packed sheet→clip; **nothing is live-verified on a GPU yet** — the blueprint still has to be seeded and one real job run. Was _(2026-08-25)_ **The Scene Editor can place a clip** — a `flipbook` node in the `LayoutNode` union, dragged from the Library's new Flipbooks section, playing live on the editor canvas and mounted as `<Flipbook>` by `LayoutNodeView` in the game. Was _(2026-07-24)_: First consumer LIVE + the atlas-ref collision is closed for BOTH storable forms — a flipbook symbol plays its OWN clip, not the last-loaded sheet's. Was _(2026-07-21)_: First consumer LIVE — a flipbook clip binds as a symbol state and renders in the runtime. Was: Authoring **and shipping** work end-to-end; **no consumer reads a clip yet**. Clips are created at `/flipbook`, travel the full export→bake→pull→register chain, and are registered at boot — but nothing resolves a `clipId`, so a clip still renders nowhere in a game. Step 6 (consumers) is the only thing between a clip and pixels.

## Current state
Live on `main` (steps 1–8 of the design doc's build plan; step 6's FX half is optional — see Open items):

- **The preview grew in Y without limit until the tool was unusable — it is now a real pan/zoom
  viewport** (owner report, within a day of the resize shipping: *“the canvas is growing in Y size
  to the infinite, making the all tool impossible to use”*).
  - **Cause: a measurement fed back into what it measured.** The resize observer read the stage's
    height with `getBoundingClientRect()` — the BORDER box — and assigned it as the styled height,
    which is the CONTENT box. Each pass added the 2px border, so the two could never converge and
    the stage climbed 2px per tick forever. Reproduced in a browser: 248px → **650px in 200 ticks**,
    still climbing. The new model is flat at its styled height through the same 200 passes.
  - **The fix is the shape of the API, not a guard.** The viewport height is owned by a grip that
    writes pointer DELTAS; the observer writes only `contentRect` into variables that no style
    reads back, and the pane inside is absolutely positioned so it cannot size its parent. Nothing
    measured is written back into what is measured — stated in `panZoom.ts` and pinned by
    `node apps/launcher-api/panZoom.fixture.ts`.
  - **It is a canvas tool now**, which is what was asked for: scroll to zoom about the pointer,
    drag to pan, − / + / ⬚ Fit, and a drag grip for the viewport height.
  - **Zoom changes the thumbnail's PIXEL size, never a CSS scale.** That keeps the pane unscaled,
    so the bounds overlay's positioning context stays in plain screen pixels: `boxFit` needs no
    zoom term and `BoundsBox` needed no change. Verified in a browser at 20 / 100 / 250 / 600%
    and after panning — the overlay sits on its art to within 0.01px at every one, and the art
    under the cursor is identical before and after a zoom about it.
  - Fixtures: `node apps/launcher-api/panZoom.fixture.ts` — the anchor invariant, the clamps, and
    the specific trap that a zoom pinned at the cap must be a NO-OP (otherwise a wheel held at the
    limit walks the pane off screen).

- **The bounds box landed nowhere near its art — and the preview is now resizable** (owner
  report, the day it shipped: *“when I click it is in a complete different place of the canvas
  and I can´t place it right in anyway”*). The overlay's numbers are relative to the THUMBNAIL,
  and the thumbnail is centred inside a much wider stage — so parenting the overlay to the STAGE
  put it `(stageWidth − thumbnail) / 2` px to the left of the art it described, with every drag
  off by the same amount because `BoundsBox` measures pointers against whatever element it is
  handed. Measured in a browser at a 1400px window: **562px of drift**, now 0.0. Both hosts wrap
  the thumbnail and the overlay in ONE exactly-sized element, which is both the positioning
  context and the drag frame. The Scene Editor's box had the same fault in miniature (its stage's
  1px border), fixed the same way.
  - **The fit maths is now one function**, `$lib/boundsFit.ts` (`boxFit` / `boxRect` /
    `artAtOffset`), shared by both editors instead of copied into each — so the parenting rule has
    one place to be stated, and one place to be pinned:
    `node apps/launcher-api/boundsFit.fixture.ts` simulates BOTH layouts and asserts the fixed one
    lands on the art while the old one is half the leftover width away, so a refactor that
    re-parents the overlay fails there rather than in someone's hands.
  - **Why the build didn't catch it, and what did:** this is geometry between two DOM elements, so
    a green `vite build` says nothing and the offline fixtures could not see it either. It was
    reproduced and then verified in a real browser — a standalone page carrying the page's actual
    CSS, comparing the overlay's client rect against the rect the canvas drew for the same box,
    at four stage sizes. That check is what the new fixture distils.
  - **The preview stage is RESIZABLE** (owner ask). A native CSS resize grip, a `ResizeObserver`
    feeding the measured size to both the thumbnail and the fit, and the chosen height kept in
    `localStorage`. 240px was fine for judging frame order and never fine for placing a box.

- **Step 8 — playback control + bounds** ([design](../design/invisible-flipbook.md) §"Playback",
  §"Bounds"). Both are the answer to one owner ask: the Rigger lets you declare the box a rig is
  sized by, and *“we do not have a similar option for flipbooks and sprites”*.
  - **Direction is a WALK over the authored order, not a second clip.** `playbackIndices` in
    `engine-flipbook/playback.ts` is the single definition, returning INDICES so a missing frame
    can't shift the walk; ping-pong is `0…n-1` then back down to `1`, turnaround frames NOT
    repeated. `resolveClipFrames` applies it to the TEXTURE array, so PIXI's `AnimatedSprite`
    needs no direction-aware clock — and the `/flipbook` preview + the editor canvas walk the
    same indices, so all three agree on what frame is showing.
  - **Every duration is measured off the walk.** A ping-pong cycle is `2n−2` ticks, so
    `flipbookCycleMs` (the flow duration walk) and `SymbolFlipbook`'s state revert both count
    `playbackFrameCount`. Timing either off `frames.length` reverts a symbol at the turnaround,
    which reads as "the win animation doesn't play" rather than as a timing bug.
  - **Mirroring is the SIGN of `scale`, applied after the sizing props.** PIXI's `width` setter is
    `scale.x = value / localWidth * sign` — it preserves the sign — so `abs(scale) × sign` is
    order-independent, where a `scale={{x:-1}}` prop would be a race between the flip and the size
    (`propsSyncEffect` re-assigns every prop on any change, in object-key order).
  - **A clip's `bounds` reaches pixels as `orig` + `trim`, not as new maths.** `applyClipBounds`
    re-states each frame with the box as its declared size and the art at its position inside —
    the same pair PIXI builds a texture from, and what a trimmed atlas frame already is. So
    `<Flipbook>` rebuilds its textures (sharing each `source`: one small object per frame, no
    upload) and nothing downstream learns a new concept: `texture.width` reports the box,
    `width`/`height` size it, the anchor lands on its centre, cover-fit measures it.
  - **A box SMALLER than the art is load-bearing, not a validation gap.** The art overflows rather
    than being cropped — how a symbol is sized by the part that reads while a wide invisible
    flourish hangs outside the cell. Verified against the REAL pixi build, not against a reading of
    it: `pnpm --filter flipbook-spike run pixi-bounds` asserts `texture.width` is `orig` and that
    `updateQuadBounds` positions the quad from `trim` with no clamping.
  - **The sprite half is `editor/art-bounds.json`** — the same box for a plain region, keyed
    `<assetKey>::<region>`, authored in the Scene Editor's Properties panel with the SAME overlay
    (`$lib/BoundsBox.svelte`, now the canonical domain-A impl — [ui-inventory](../ui-inventory.md)
    §15). Deliberately NOT in the sheet manifest (a packer rewrites those, and altering a region's
    trim there re-bases every frozen `.irig` mesh — the RawRegion landmine) and deliberately NOT a
    new shipped asset class: `editorArtExport` folds each box into the `sourceSize` /
    `spriteSourceSize` of the TexturePacker JSON it already writes, so the game gains no code and
    nothing is stranded at an R2 prefix (rule 8).
  - **Defaults are DROPPED on save, never stored.** `forward`, un-mirrored and no-box are what
    every clip authored before this played as, so an untouched clip round-trips byte-identical and
    the normalizer stays idempotent.
  - **`RegionThumb` gained an optional `box` prop** so the boxed preview is the shared thumbnail
    doing its own contain-fit against the box — no second cropping routine, and every other caller
    is byte-identical.
  - Fixtures: `pnpm --filter flipbook-spike run playback` (20 assertions incl. the
    `engine-layout` copy of the length formula agreeing with `engine-flipbook`'s at every count),
    `run bounds`, `run pixi-bounds`, plus `node apps/launcher-api/artBounds.fixture.ts` for the
    doc's scoping + degenerate-box rules. `run doc` and `run frames` extended for the new fields.
  - **Not yet exercised on a real project.** The maths and the PIXI contract are fixtured; the two
    UIs (the `/flipbook` box editor, the Properties panel's Art bounds) have been built and the
    launcher builds clean, but nobody has dragged a box on a live project yet.

- **Step 6 — the Scene Editor consumer.** A `flipbook` node joins the `LayoutNode` union, carrying only a `clipId` + placement (`width`/`height`/`tint`, and per-PLACEMENT `fps`/`loop` overrides). `LayoutNodeView` mounts `<Flipbook>` for it in the exact shape of the `sprite` branch — size folded into width/height so "what you size in the editor" is what the game draws. Authored by dragging a clip out of the Library's new **Flipbooks** section (`/api/editor/flipbooks` → `loadFlipbookDoc`, so the editor resolves frames through the SAME atlas-ref repair the ship path runs and can't fall into the flat bare-name cache the runtime avoids).
  - **The editor PLAYS it, it does not chip it.** Unlike an `effect` (a WebGL emitter the 2D canvas genuinely cannot run), a clip is atlas frames in order — so each frame draws through the same `drawArtRegionSprite` a region sprite uses, and the author judges the animation at its real position and size. A single rAF loop drives it, gated on a *visible* scene actually carrying a `flipbook` node (`sceneHasFlipbook`, mirroring `sceneHasEffect`), so a project without one repaints exactly as before. The preview always LOOPS — the clock is the page's, not a per-node playhead, so honouring `loop:false` would freeze a one-shot on its last frame from the moment the doc opened.
  - **`naturalSize` uses frame 0, never the frame playing.** Frames of one animation are rarely identical rects; a size that changed 24×/second would jitter the selection box, the resize handles and the hit-test under the cursor.
  - **A clip COVERS the window like any other background art.** On a `space:'background'` screen — or with the "Cover / full-screen fill" toggle on a flow-gated `canvas` screen — the node takes the same true-cover path a sprite does (`coverTransform` from the art's natural size, centred, per-axis `scale`), and stops being drag-resizable in the editor. It measures frame 0 for the same reason `naturalSize` does, resolved through `flipbookCoverRef` with `resolveClipFrames`' scoped→bare precedence so the cover measures the texture that actually plays. Which kinds cover lives in ONE exported list (`isCoverFitKind` / `isCoverArtKind` in `engine-layout/coverTransform.ts`) — see [engine status](engine.md); the `flipbook` kind originally reached none of the five hand-written gates, so a background clip rendered at its authored size in both the editor and the game.
  - **`LAYOUT_NODE_KINDS`** is now an exported runtime value and `editorStorage.ts`'s accepted-kind `Set` derives from it. The hand-copied list was the live version of the `COMPONENT_PARAM_KINDS` bug this repo paid for twice: a kind missing there is **dropped on save** — drawn in the editor, erased by the round-trip, with the launcher's `vite build` green throughout. Fixture: `pnpm --filter flipbook-spike run scene-node` (it also covers `resolveTransform`'s SIZED list, where a missing kind silently ignores authored `width`/`height`).
  - **A dangling clip is said out loud, twice** — the node draws a 🎞 chip on canvas and counts in the header's asset-issues pill, and the Properties panel names the missing id. It has to be: `<Flipbook>` has no whole-sheet fallback (a scramble of unrelated frames is worse than nothing), so the game renders literally nothing.
  - **`sceneAnimationDurationMs` reaches it** via the `flipbookMs` seam that was wired for this in advance, now widened to take the placement's `loop`. A LOOPING clip deliberately reports `undefined`: a loop has no end, so an ambient background must never become "the screen's animation" and hold a `showContainer` beat. `flipbookCycleMs` in `engine-layout` owns that rule for every caller.
  - **No pipeline change was needed** — the export already ships every clip and adds each one's `assetKey` + frames to `usedRegions`, so a placed clip's sheet travels without the layout doc referencing it.

- **Step 7 — the ship chain (rule 8)** is wired: a clip now travels export→`deploy/clips/`→bake→pull→register.
  - **`flipbookExport.ts` + `/api/editor/export-clips`** mirror `effectExport.ts` + `/api/editor/export-effects` exactly (same deploy token `?k=` gate, same per-doc file + `index.json`, same stale-object prune, idempotent). A clip carries **no binary assets** — its frames are regions of a sheet the editor-art export already ships — so this is a pure-JSON copy.
  - **Deliberate divergence: clips are NOT reachability-pruned.** The bake prunes unreachable *effects*; an equivalent filter for clips would ship **zero**, because no consumer references a `clipId` until step 6 lands. A clip is a name list plus two numbers, so shipping all of them is negligible. Documented in the exporter's header; add the filter once consumers exist.
  - **Clip frames are now real references.** `editorArtExport` adds each clip's `assetKey` to the manifests it ships and every frame to `usedRegions`, so a clip's sheet auto-ships and a renamed/deleted region is visible to the dangling guard (the same fix already applied to FX `art.frames[]`).
  - **A dangling clip frame is FATAL at bake**, not a warning — the one place clips deliberately differ from sprite regions. New `EditorArtIndex.clipMissing` (`{clipId, frames}[]`) attributes each missing frame to its clip, and the bake `bail()`s naming both. Rationale (design §"What this design does about it" #2): a dangling *sprite* region draws an invisible node — obvious; a dangling *clip frame* silently **shortens** an animation that still plays and still looks plausible, so it can pass review and ship wrong.
  - **Bundle parity holds.** `flipbooks` is omitted from the baked bundle entirely when a project has no clips, so a no-clip game's bundle stays byte-identical. `apps/lines` gains `bakedFlipbooks()` (same runtime→baked→empty resolution as `bakedRigFx()`) and calls `registerFlipbooks(bakedFlipbooks())` at boot beside `registerEffects`/`registerRigFx`.
  - `clips` was added to the pull script's `GENERATED_SUBTREES` so a deleted clip's stale mirrored file is pruned like a deleted effect's.

- **`/flipbook` tool (step 4)** — three-column authoring page in the launcher. Left: saved-clip rail + Name / Save / Save As / Delete. Centre: the ordered frame list (HTML5 drag-reorder, numbered 1..N, per-frame duplicate = a HOLD and remove) under a playback preview with play/pause, a frame scrubber, fps and loop. Right: source-sheet select over the project's `manifests/*.json` + a filterable region grid that click-appends frames.
  - **No new rendering code.** The preview and every thumbnail reuse the editor's `RegionThumb.svelte` (shared page-image decode + the rotated-region un-rotation); playback is just an accumulator-clocked rAF advancing an index, so no second PIXI app and no duplicated cropping routine. Region rects come from the existing `/api/editor/regions`; the page image from `/api/editor/asset` — both gained `flipbook` as an `altTool` beside `fx`/`rigger` (entitlement only; the R2 prefix allow-list is unchanged).
  - **`/api/flipbook/save` + `/api/flipbook/delete`** mirror the `/fx` pair exactly: shared `gate` on the `flipbook` tool, session-bound scope, a scope-mismatch guard against a tab whose project moved under it, and ETag compare-and-swap → 409 with a create-vs-update-specific message.
  - **Author-time dangling detection** (design §"Referential integrity") — opening a clip re-reads its sheet's live region set; a frame whose region is gone is struck through in red and counted in a tool-bar pill. A silently shortened animation looks plausible, so it is surfaced at author time rather than discovered at bake.
  - `engine-flipbook` was missing from `apps/launcher-api/package.json`, so `flipbookStorage.ts` could not resolve at build; added as `workspace:*`.

- **Clips span SHEETS.** A frame entry is either a bare region name (resolved against the clip's primary `assetKey`) or an atlas-scoped `<assetKey>::<region>` ref — the same encoding the Scene Editor's image params use. Forced by reality: a multipacked cocos export interleaves one animation across pages (a real 49-frame sequence arrived split over four 2048² pages, frame 0 on page 0, frames 1–7 on page 1, frame 11 on page 3), so a single-sheet clip literally cannot express it. `clipSheetKeys` / `clipFrameRefs` / `parseFrameRef` in `engine-flipbook`; the export ships every sheet a clip touches, and dangling frames are validated **per sheet** (`coveredBySheet`) so a frame scoped to page 1 is never excused by a same-named region on page 0. In `/flipbook`, switching sheets no longer clears the frame list — it is the normal way to add frames from another page — and rows carry a sheet chip once a clip spans more than one.
- **Step 5 — runtime playback seam.** `<Flipbook clip={…}>` in `pixi-svelte` gives `AnimatedSprite` its FIRST call site (it and `SpriteSheet` had worked with zero consumers because nothing upstream produced frame order). `resolveClipFrames` in `engine-flipbook` owns the editor-art scoped→bare key precedence and is offline-fixtured. `animationSpeed = fps/60`. **Deliberately NO whole-sheet fallback** — `ParticleEmitter` binds the entire sheet when a layer resolves nothing, which sprays arbitrary wrong art; an unresolvable clip renders NOTHING and reports its missing frames once.
- **`packages/engine-flipbook`** — `FlipbookDoc` / `FlipbookClip` types + `normalizeFlipbookDoc`, mirroring `engine-fx`. Deliberately dependency-free so it stays Node-resolvable for fixtures. `registerFlipbooks` / `resolveFlipbook` live in `engine-layout` beside `registerEffects` / `registerRigFx` (same module-scoped `Map`, same latest-wins).
- **`tools/flipbook-spike`** — offline fixtures (`run doc`, `run registry`, `run frames`, `run cover`), since the launcher build is not a type check. Assert frame order survives verbatim, duplicate frames are kept (a held frame), a bad fps falls back to the default, normalization is idempotent, and a dangling `clipId` resolves to `undefined` rather than throwing.
- **FX flipbook honesty fix** — `bindArt` no longer emits a dead `loop: true` alongside `framerate: -1` (the library coerces it to `false`, so flipbook particles have always played once per lifetime, contrary to the old doc comment). Both fx-spike fixtures now assert `loop` stays absent. **Not a behaviour change** — making looping real would silently restyle every authored effect in a shipped game.
- **Dangling FX frame names are now reported** — `editorArtExport` counts a layer's `art.frames[]` as used regions, so a renamed/deleted region shows up in `index.missing`. Previously invisible at every stage, degrading to `EffectLayer` dropping frames or `ParticleEmitter` binding the whole sheet.
- **Sheet Maker natural ordering** — upload order drives region order drives manifest order, which the clip editor reads; see [sheet-maker status](sheet-maker.md).

- **Video mode, steps 0–1** ([design](../design/invisible-flipbook-video.md)) — a `/flipbook` mode that generates video from a blueprint and turns the picked result into a clip. Landed so far, **none of it exercised on a real GPU**:
  - **`blueprints_src/wan22_i2v_flipbook/`** — the owner's Wan 2.2 I2V graph, made serverless-safe. Its one unavailable node (`ImageResizeKJv2`, KJNodes, baked into neither the worker nor the pod image) is replaced by core `ImageScale`, pixel-identical at these settings; `BiRefNetRMBG` needed nothing because it comes from `1038lab/ComfyUI-RMBG`, which the worker already bakes. `ComfySwitchNode` + `ComfyMathExpression` were verified present in ComfyUI core at the pinned v0.33.1. The save node's `fps` is now WIRED to the generation fps node rather than copied, so the preview can never drift from the motion rate again.
  - **`width`/`height` are deliberately UNBOUND.** `build_workflow_blueprint` fills those roles from `GEN_WIDTH`/`GEN_HEIGHT`, whose config default is **1024** because they were sized for stills — injecting that into `WanImageToVideo` across an 81-frame batch is a VRAM/wall-clock blowup. Generation size is a param instead. This is the single easiest way to silently wreck a video blueprint; the fixture asserts it.
  - **`video_runner.py` + fifteen `/video/*` routes** — stateless, session-scoped, remote-cancelling; one session RUNS at a time and the rest QUEUE behind it, with at most `VIDEO_PARALLEL_JOBS` (default 1) of its variations in flight at once. Results land in `<C>/<P>/video/<id>/` and never enter `deploy/`.
  - Fixtures: `PYTHONPATH="../_shared:." py test_video_runner.py` from `services/atlas-tool` (404 checks, RunPod/R2/paths stubbed; the PYTHONPATH is not optional — without it the suite dies on `No module named 'iw_common'`). **Count it, don't add to it** — the figure here was wrong twice, each time by doing arithmetic on the previous stale one: `grep -c '^ok'` over a run is the only honest source.
  - **Step 2 — the 🎬 mode UI.** `/flipbook` switches surfaces with the canonical `<CanvasModeBar inline>` in the ToolTopBar's `meta` snippet; the mode itself is `VideoMode.svelte` (its own component — the clip editor is already 1300 lines and the two share nothing but the project). Blueprint picker, prompt, source-image picker, variation count, params rendered from the blueprint's own `params[]`, live progress, results grid.
    - **No `<video>` element** — an animated WEBP plays, loops and honours alpha in a plain `<img>`. The checkerboard behind each tile is load-bearing: it is how the author sees whether the cutout produced real alpha rather than a matte-coloured rectangle.
    - **`api/flipbook/video/[...path]` is an explicit ALLOW-LIST, not a pass-through** — a forwarding rest route would hand any flipbook user the whole atlas-tool surface (`/render`, `/deleteblueprint`, `/createatlas`) under a gate that never mentions them. Canonical `toolScope.gate` on `flipbook`; the tool secret never reaches the browser.
    - **No 5th file browser was built** — the source-image picker proxies the atlas-tool's `/fsbrowse`, which already returns paths in the exact per-root form the runner resolves ([ui-inventory](../ui-inventory.md) §1, §14).
    - The per-tile "🎞 Make flipbook" button is present but **disabled and labelled** as arriving with step 3 — the shape is visible, the dead end is not hidden.
    - Verified: `pnpm --filter launcher-api build` green, `svelte-check` reports **zero** errors in the touched files (32 other files carry pre-existing errors), eslint clean except one pre-existing `href` warning unchanged from HEAD.
  - **Step 3 — video → clip.** `video_to_clip.py` + `POST /video/toclip` / `GET /video/probe`, and a trim panel in the mode (range · stride · max size, with a live frame count and an **opaque-frames warning** before anything is packed). Extract → downscale → alpha-trim → MaxRects-pack → page PNG + TexturePacker JSON + Invisible manifest into `manifests/`; the launcher then writes the clip through the existing `/api/flipbook/save` and opens it in the clip editor. **The TOOL makes the sheet, the LAUNCHER makes the clip** — clip storage, its ETag CAS and its edit lease stay where they already live.
    - **Trim is recorded in camelCase** (`offX/offY/origW/origH`). `parseRegions` reads only camelCase; snake_case is silently dropped and the animation PULSES — the .plist bug, again. Fixtured.
    - **Trim measures the ALPHA channel, not `Image.getbbox()`** — which crops black borders off an opaque frame. Fixtured both ways.
    - **Pages cap at 2048** (81 frames on one AUTO page is ~4200px tall) and frames spill onto more pages; every frame ref is **atlas-scoped even on a single page**, so a bare name can never fall into the flat cache where sheets collide.
    - **fps comes from the WEBP's own frame duration / stride.** Pillow fills `info["duration"]` only after an explicit `seek()` + `load()` — reading it off `ImageSequence.Iterator` gives `None`. The first draft had that bug; the fixture caught it.
    - **Blueprints carry a `kind` (`image` | `video`) and each tool's picker filters to its own** (owner report: the video mode listed the Atlas Maker's image blueprints). Declared, never inferred — sniffing the graph for an animated save node would mis-file a blueprint the moment someone uses a node we did not anticipate. Absent = `image`, so every existing blueprint keeps working and keeps showing up where it did; the MANAGEMENT list stays unfiltered so a video blueprint is still deletable. `video_runner` re-checks the kind behind the filtered picker.
  - **Bundled blueprints SYNC, they no longer seed-once** (owner report: the new BiRefNet settings were still missing after they shipped). The first self-seed published only what the library LACKED — which protected edits but froze every bundled blueprint at whatever was seeded first, so adding a param to `blueprints_src/` in the repo had no effect on the live tool and nothing said the definition was stale. The distinction that makes an update safe was already in the data: a bundled blueprint carries `author: iw-builtin`, while `_uploadblueprint` stamps the real username. So: absent → publish; present, still ours, bytes differ → update; present under someone else's author → left completely alone; identical → no write at all. Fixtured for all four.
  - **The full BiRefNet surface is exposed** (owner ask). All eight node inputs are now params — model (the node's real 12-entry list), sensitivity, mask blur, mask offset, invert, refine foreground, background mode and background colour — verified against `py/AILab_BiRefNet.py` in `1038lab/ComfyUI-RMBG` at the **pinned `RMBG_REF`**, not guessed. That matters: a param value outside the node's domain is a run-time graph rejection, which no validation on our side would catch. Reading the real contract also exposed two faults in the authored graph: **`mask_blur` was `0.8` on an input the node declares INT 0–64** (never a valid value; now 1, the nearest thing to the slight blur intended), and **`background_color` was `"Alpha"`** — the `background` value duplicated into a COLORCODE field, harmless while background is Alpha and wrong the moment anyone switches to Color (now `#222222`, the node's own default). `sensitivity` was absent from the graph entirely, so it was added at the node default — a param can only drive a field the graph actually carries.
  - **Cancel works on a session this process does not own** (owner report: the button did nothing). Two faults compounding: `cancel_session` refused an orphaned session outright ("no such running session") — which is precisely the session someone wants to stop — and the UI called it, got a 200 carrying `{error}`, and **ignored the body**, so a refusal was indistinguishable from a dead button. Cancel now closes an unowned session out in the STORED doc (and remote-cancels any job it has an id for), and the UI surfaces the refusal and re-reads the session instead of waiting for a poll that, for a dead worker, never comes. Only a **running** variation is treated as in flight — a queued one may still carry an id from an earlier attempt, and cancelling that would target a job the session no longer owns (the fixture caught exactly this).
  - **A finished session can be read back and re-run** (owner ask). The runner already recorded the whole recipe — `negative`, `source_ref` and the param overrides travel beside the prompt in every `_public()` payload — but the launcher's `Session` interface declared only the four fields the grid needed to draw, so the rest arrived and was thrown away. Now: a collapsed **recipe panel** under the session bar (summary = the prompt, which is the line that used to scroll out of the rail the moment another session was selected), and **↻ Use these settings**, which loads blueprint + prompt + negative + source + variation count + overrides back into the Generate rail and focuses the prompt box. **No seeds are sent**, so re-running an unchanged recipe rolls new variations rather than reproducing the old ones — the per-tile seed button is still the way to reproduce one exactly. Pure UI: no schema change, no new endpoint, nothing new stored.
    - **Only the OVERRIDES are shown, and the panel says so.** A param the author never touched was never sent, so it ran at the blueprint's default *at the time* — and since bundled blueprints now sync, that default is not recoverable after the fact. Rendering today's default as "what was used" would be a plausible lie, which is worse than an absence.
    - **Two un-restorable cases are told apart, because they are different facts.** A param the blueprint no longer declares is flagged per-row and dropped on restore (`generate()` filters unknown keys at send time anyway, so keeping it would leave the rail holding a ghost that never travels). A blueprint that is **gone from the library** says so ONCE on its own row, leaves the picker alone, and restores only the prompt + source — applying its params to whichever blueprint happens to be selected would quietly run a different recipe under the same name. The first draft used one label for both, which claimed a deleted blueprint had "removed" its params.
    - Verified in a browser against stubbed payloads in the exact shape `_public()` returns (three sessions: full, gone-blueprint, running-and-empty): labels resolve through the blueprint (`fps` → "Frames per second"), untouched params stay at their defaults, the button disables while a session is in flight, the note clears on session switch and on Generate, and the re-sent payload matches the recorded recipe field-for-field with types intact.
  - **A literal NUL byte had crept into `VideoMode.svelte`** (a NUL used as an option-value separator in a Svelte `<option value>`), which made git and grep classify the source as **binary** — hiding it from diffs and code search. Replaced with `::`.
  - **A session now survives a service restart** (owner report: RunPod said 1 job COMPLETED while the grid still showed variation 1 running after 8 minutes). A session lives in a module-level dict, so a deploy takes its worker thread with it — and the job id was written to `meta.json` only when a variation FINISHED, so a restart mid-job lost the only handle to work that was already running and already paid for. The session then sat at "running" forever with its result stranded. Two fixes: the job id is persisted **before** the wait, and reading an orphaned session **adopts** it — back into memory, worker restarted, re-attaching to each recorded job rather than re-submitting it. A variation interrupted before its id was recorded is marked **failed with the reason**, never silently re-billed. Fixtured by simulating the restart against the real stored meta.
  - **The video mode has its OWN ＋ Blueprint uploader** (owner ask). Deliberately not a copy of the Atlas Maker's modal: it publishes `kind: video` (forced server-side, so this route cannot quietly publish into the Atlas Maker's picker) and it **omits the `width`/`height` roles entirely** — binding those on a video blueprint is actively harmful, because the generic runner fills them from the still-image `GEN_WIDTH`/`GEN_HEIGHT` (1024). A picker that cannot offer the trap beats one that documents it. Gated twice: the button only renders for a holder of `blueprintPublish` (from the loader), and the proxy re-checks the capability server-side before appending `bp` — the gate is by KNOWLEDGE OF THE SECRET, not a forgeable flag. The candidate filter mirrors `bpCandidates` in `ui_server.py` and **cannot be shared** (opposite sides of the A/B line in [ui-inventory](../ui-inventory.md)) — keep the two in step by hand.
  - **The whole POST dispatch now parses the path.** `/uploadblueprint` had the same raw-`self.path` bug as `/video/generate` — including its 4 MB body cap, which a proxied upload would have skipped entirely. All 29 comparisons in `do_POST` now use a parsed `post_path`, so POST agrees with GET and any route works whether it is called bare (the tool's own page, cookies) or with a query string (the proxy, which has no cookies and must pass context that way).
  - **A video blueprint could not be PUBLISHED at all** (owner report: the New-blueprint modal offered the wrong options). Two faults: the `output` role filtered candidates on `/SaveImage/i`, which excludes `SaveAnimatedWEBP` / `SaveWEBM` / `VHS_VideoCombine` — so a video graph showed "⚠ no matching node" on a REQUIRED role and could never publish; and the modal had no way to declare a kind, so even a successful publish landed as `image` and never reached the video picker. The output role now matches on `filename_prefix` (which IS the contract — the runner stamps the prefix onto that node), and the modal gained a **Kind** selector that swaps the Base options with it. Proven by running the real `bpCandidates` over the real graph in Node: `output → SaveAnimatedWEBP #200`.
  - **Bundled blueprints now self-seed.** The live library was found holding four hand-uploaded blueprints and NONE of the three built-ins — `seed_blueprints.py` had never been run against it, so "adding a built-in is just another `blueprints_src/<id>/` folder" was never actually true; it depended on someone running a script with production R2 credentials by hand. The service already ships those files (`COPY services/atlas-tool/ .`) and holds the credentials, so `hydrate` now publishes any bundled id the library lacks and mirrors it into staging on the same boot. **Never overwrites** — an id already in R2 is left exactly as it is, so an edited blueprint is safe and the seed is idempotent (both proven offline).
  - **The proxied POSTs 404'd** (owner report on Generate). `do_GET` parses the path but `do_POST` compared `self.path` RAW — and the launcher proxy MUST append `?k=&client=&project=&user=` because it has no cookies to carry context, so `/video/generate?k=…` never matched `/video/generate` and fell through to the 404. The video routes now compare a parsed `post_path`; every other POST route is untouched. GET worked throughout, which is why the blueprint list populated and only Generate failed.
  - Fixtures: `py test_video_to_clip.py` — builds a REAL animated WEBP and runs the REAL packer, asserting trim numbers, composed-page pixels, source frame order across a multi-page split, stride/range/downscale, and the blank-frame placeholder.

## Open items / next
1. **Video mode HAS now run on a real GPU** — owner, 2026-09-01: *"I run it on the Runpod GPU and it works great"*. That closes the "never proven" half of this item: everything downstream of a real WEBP was fixtured and had never seen a model's actual output, and now it has. **The DETAIL is still open**, because what was reported was the outcome, not the four things only a real run can answer: whether the WEBP comes back `RGBA` with the cutout on; whether `BiRefNet_toonout`'s weights resolve on a **cold** worker (they are NOT in `fetch-models.py`); whether a full-length payload clears RunPod's ~20 MB `/status` cap; and whether the session went past the grid through **pick → pack → clip in the editor**. Treat all four as *unobserved*, not as passing — the cold-worker weight miss in particular cannot show up on a warm run, so a green session says nothing about it. Note them next time a session runs.
2. **Step 6 — consumers: DONE.** Symbols (a `flipbook` cell), the Scene Editor (a placed `flipbook` node) and the Rigger (a rig-timeline `event.flipbook` binding, 2026-08-31) all read a clip. FX still has no `clipId?` on `EmitterArt` — an FX layer names its frames directly, so this is a convenience (author the order once in `/flipbook` instead of clicking checkboxes), not a gap.
3. **Add the clip reachability filter**, now that placements exist to be reachable FROM, so an orphan/scratch clip stops shipping (parity with the effects prune in `bake-editor-doc.mjs`). Note the walk must cover FOUR referrers, not one: scene `flipbook` nodes (incl. nested in containers + component defs), symbol cells' `clipId`, and — since 2026-08-31 — the `rigFlipbooks` manifest's `clipId`s, or the prune would delete clips that are genuinely in use. The rig referrer is the awkward one: it lives in the rig `.irig`, not in the layout doc, so the filter has to read the manifest the clips export now returns rather than walking the doc.
4. **Rename-repair hint is unconfirmed** — `src` survives a rename, but `sheet_session.json` is one open sheet's working state, so per-sheet durable recovery of `src` must be verified before the tool promises "did you mean…".
5. **The ＋ Blueprint modal flags an unexposed boolean gate: DONE** (2026-09-01, see Recent changes). What is NOT covered: an unexposed **numeric** knob that is equally load-bearing (the 1024 generation size on the same blueprint reached the render the same way a wrong boolean did). A boolean gating a switch is a clean signal with no false positives; "this int matters" is not, so it was deliberately left out rather than guessed at.
6. **Two known holes the R2 rescue does NOT cover** (the third, the cross-container one, is closed — see Recent changes), all found by adversarial review rather than
   by a loss, and all narrower than what shipped:
   - ~~**Two containers can own one session.**~~ **DONE** — the CAS floor + the session lease
     (see Recent changes). **The prescription written here was wrong** and is worth keeping as a
     warning: it said "a lease/owner field in `meta.json`", which is the one shape
     `docs/design/multi-user-concurrency.md` explicitly forbids — a lease inside the document is
     clobbered by the very race it exists to prevent, so it would have "fixed" the bug with the bug.
   - **A 404 for a reason other than an expired record** — a rotated or mistyped
     `RUNPOD_ENDPOINT_ID`, a RunPod API incident — is given up on in 15 s **without** a cancel, so a
     live job keeps billing. Cheap mitigation: on that path, if the slot is empty, re-check it once
     after a delay before settling the tile.
   - ~~**`video/_out/` has no sweeper.**~~ **DONE** — `sweep_stranded_slots` (see Recent changes).

## Blocked (owner / external)
- **Re-publish the imported video blueprint with a pod running** (owner, 2026-09-04). The one
  imported before the contract reader landed carries no bounds or lists; ＋ Blueprint on the
  same API export bakes them in. No env var is needed any more: since #576 ⟳ (and this reader)
  find a running RunPod pod through the RunPod API, and `COMFY_CATALOG_URL` is only an optional
  pin (`docs/INFRA.md`). Until the re-publish, the panel bounds that blueprint only while a pod
  answers or ⟳ has cached its lists, and Bck Sensitivity stays in 0..1 by hand.
- (Earlier in this work `pnpm --filter launcher-api build` was genuinely RED — `symbols/+page.svelte` imported `builtinSpineKey` / `hasBuiltinSpine` which `editorSpine.client.ts` did not export, a Rollup *resolve* failure, not a stripped type error. Both are now exported at `editorSpine.client.ts:89-91` and the build is green; verified 2026-07-20.)

## Recent changes
- 2026-09-07 — **Two containers can no longer both own one video session, and a stale one can no
  longer undo a finished render.** The last structural hole from the 2026-09-07 incident: a Railway
  rolling deploy overlaps the old container and the new one, and `_adopt`'s check-and-insert is
  idempotent only WITHIN a process. So both could dispatch the same session — paying twice, and
  worse, `_submit` empties the hand-off slots before its job runs, so the second submit **deletes
  the render the first one's job already uploaded** — and `_write_meta` was a blind overwrite, so
  the loser's older snapshot could land last and put a collected tile back to `failed` with
  `00N.webp` sitting in R2 and nothing pointing at it.
  - **The floor: `meta.json` is a compare-and-swap.** `iw_common/storage.py` `put` takes
    keyword-only `if_match`/`if_none_match` and returns the new ETag; `get_with_etag` is the read
    half, keeping the ETag verbatim (`head` strips the quotes, which makes its value the wrong thing
    to build a precondition from); `Conflict` is 412-only, because R2's 409 is transient. This is
    the design doc's Phase 3 touch item, unstarted until now, and **verified against the live bucket
    before anything was built on it** — a stale `IfMatch` really is refused and the stale body
    really does not land. A 412 never drops our write: `_merge_meta` folds our doc onto theirs and
    re-CASes, because an abort here would lose a `done` exactly as loudly as the clobber it
    replaced. **A finished render never loses a merge** — the variation carrying a `file` wins from
    whichever side it came — `cancel` is sticky, and variations union by index so a concurrent
    ＋ Add is not dropped by an older snapshot.
  - **The lease: one owner per session, across processes.** `iw_common/lease.py` mirrors
    `lease.ts` 1:1 (10 s heartbeat / 45 s TTL, the same 4-tuple key, pure `is_takeable` /
    `is_same_holder`, `acquire`/`heartbeat`/`release`/`takeover`), so a later move onto the
    `doc_leases` table is a transport swap. `_run_session` acquires before it dispatches and
    releases in its `finally`; the dispatcher renews on its own loop (a timer would keep a dead
    dispatcher's lease alive); `_run_variation` re-checks ownership **immediately before `_submit`**,
    the one line that spends money, and re-queues the slot rather than paying twice; `_adopt`,
    `resume_orphans` and the slot sweep all defer to a live holder; and **Cancel is the takeover** —
    the session someone most wants to stop is the one another container is holding.
  - **Where it lives is a documented departure**, recorded as a Phase 3a amendment in the design
    doc: a lease belongs in Postgres, but these services hold no session and no DB credentials,
    `holder_user_id` is a foreign key to a real user and a container is not one, and routing the
    claim through the launcher would fail open during exactly the deploy it exists to survive. It is
    a SEPARATE R2 object claimed by conditional write, not a flag inside the doc — the property the
    rule protects (it cannot be clobbered by the race it prevents) holds by a different mechanism.
  - Everything **fails open**: an unreadable or unwritable lease behaves as though there were none,
    — with one honest caveat: the CAS is the floor for the DOC's state, and the destructive half of a
    double-submit (a second `_submit` deleting the first job's uploaded render) has no precondition
    behind it, so failing open re-accepts that risk for as long as R2 itself is unreachable.
  - **The first cut of this was not shippable, and the review is why.** Five defects, four fatal to
    the feature: the lease was never renewed during a render (the dispatcher blocked in an untimed
    `_CV.wait()` for minutes while the lease lives 45 s, so it lapsed under us and the session read
    as free to every other container); `release`/`takeover` were handed a different holder identity
    from `acquire`, so a container did not recognise its own rows — every release was a no-op, and
    Cancel's takeover made the dispatcher stand down **without settling its tiles**, quietly undoing
    a previously-fixed bug; a container that stood down still wrote a terminal status over the new
    owner's doc; and the CAS merge reached R2 but was never folded back into memory, so the very
    next write undid the repair. The `boto3` floor was wrong too: `IfMatch` first appears in
    **1.35.69**, not 1.35.0, and below it every call site turns a `ParamValidationError` into a
    silently wrong answer — including `acquire`, which would have failed open forever and made the
    whole mechanism inert while looking healthy. Each has a fixture that fails without its fix.
  - Fixtures: 404 checks (was 363) — the merge rules on their own (a render never loses, a delete is
    not resurrected, an ended session stays ended, both-done is deterministic); the reported bug end
    to end AND the write after it; a held session is not adopted, submits nothing and keeps its
    slot; the lease is renewed while a job runs; an expired lease is taken over and the tail runs
    exactly once; Stop reaches a session this container does not own; the store failing leaves the
    session running to completion; and the takeable boundary matches the SQL twin's. The dispatcher threads are
    named (`video-session-<id>`) — worth it in a log, and it gives a fixture something honest to
    wait on: a session's terminal STATUS is written before its dispatcher releases the runner and
    the lease, so a test that mutated the doc the instant it saw `finished` was racing that tail.
- 2026-09-07 — **`video/_out/` is swept, so "no render is ever stranded" is checkable instead of
  assumed.** Every terminal path collects from the hand-off slot now, which means a slot should only
  ever be occupied between a worker's PUT and its collect — but nothing proved it, and the thirteen
  renders recovered earlier that day had sat there for up to five days, found only because someone
  went looking. `sweep_stranded_slots` walks a project's `_out/` prefix and decides each object from
  what the session doc says:
  - a variation not settled, with a slot written since that attempt began → **collect it** (persist,
    mark the tile `done`, empty the slot, write the doc back);
  - a variation already `done`, or gone, or the whole session gone → **delete it**: scratch a failed
    `_clear_upload_slots` left behind;
  - a slot **older than the attempt's `started`** → delete it. `_submit` would have cleared it on the
    next attempt, and it can never legitimately be offered as this attempt's render;
  - a session still `running`/`queued`, or live in this process → **left alone**. A job in flight may
    have uploaded seconds ago with its own poller about to collect it, and taking it first would
    leave that poller reporting "the worker said it uploaded, but nothing is there" — the sweep
    becoming the thing it exists to prevent.
  It runs from two places: **at container boot** (`boot_recovery` — re-attach first, then sweep, in
  that order, since an adopted session is live and the sweep skips live ones), and **off the back of
  a session listing**, throttled to once per project per `VIDEO_SLOT_SWEEP_MINUTES` (default 60, 0
  disables) and on a thread, so a listing never waits on a bucket walk and a long-running container
  does not have to be restarted for the guarantee to hold. `_slot_owner` reads a session id and
  variation index back out of a slot name — the reverse of `_slot_prefix`, kept beside it so the two
  spellings cannot drift. Fixtures: 363 checks (was 345) — a strand is re-homed and a second sweep
  is a no-op; scratch beside a `done` tile, a discarded variation and a dead session are all deleted;
  a live session's slot is untouched; and the name round-trips while session objects and ordinary
  assets are not mistaken for slots.
- 2026-09-07 — **The R2 rescue now covers every way a variation can end, not just the unreadable
  ones.** An adversarial re-read of what had just shipped found the guard was one branch narrower
  than its own docs claimed: the collect hung off `except _Unresolved`, so a finished render sitting
  in its hand-off slot was still thrown away whenever RunPod reported **FAILED/TIMED_OUT** after the
  worker's upload, handed back an **empty payload**, or the author's **Stop** landed a moment late —
  and `_adopt`'s one irrecoverable case (a variation interrupted before its job id reached storage)
  never looked either, though the slot keys come from the session id and the variation index and
  never from the job id. A second review pass then found four more settle-without-looking arms one
  level up — the dispatcher's cancel sweep, BOTH of `cancel_session`'s arms (including the
  orphaned-session one, the stop people reach for most), `_adopt`'s blueprint-gone verdict and the
  thread-start failure — plus `delete_session`, which walked only the session prefix and so leaked
  every stranded slot object forever. All of them go through `_collect_stranded` now, and
  `_slot_prefix` gives that key shape ONE definition. Each was the same "paid render, red tile" the
  rescue exists to prevent. The clear-at-submit invariant is what makes the wide version safe: whatever is in the
  slot belongs to *this* attempt, so `_collect_stranded` can run from the generic failure arm
  without ever resurrecting a stale render. It also had to be wide, not just wider: with the slots
  cleared at submit, a tile stranded by one of those paths loses its render the moment its author
  re-rolls it.
  - **`_runpod_run_and_wait` (the still-image path) got the same read tolerance** it had never had:
    one 500 or one not-yet-indexed 404 used to raise straight out of the poll loop and fail a region
    whose render was still going. It now tolerates `STATUS_GRACE_SECONDS` of continuous failure,
    treats a 404 *after* a successful read as "the record is gone", and cancels on the way out.
    There is no hand-off slot on that transport, so a genuinely lost job is still a lost render
    there — the fix is the grace, not a rescue.
  - **Docs corrected against the shipped code** (they had drifted within hours): the fixture count
    here said 245 and the suite is 329; this file still called Watch Paths the fix "still owed"
    while `INFRA.md` recorded them as set; the 404 bullet stated the short grace unconditionally
    where the code requires the job to have been read or re-attached; INFRA's "count FOUR successes"
    deploy recipe predated the Watch Paths that make the count path-dependent; and INFRA claimed a
    rollout "cannot spend money on your behalf", which is true of the boot sweep but not of a
    browser tab left open on a running session — a *read* adopts the ordinary way and resumes the
    queued tail — on the first poll after the collected job finishes and the session is handed back, not within seconds of the container answering.
  - **Two regressions the same review caught before they shipped**, both introduced by the widening
    itself: `upload_keys` was read by the new failure arm but bound INSIDE the `try`, so any failure
    before `_submit` returned (RunPod refusing `/run` is the ordinary one) raised `UnboundLocalError`
    out of a function whose contract is "never raises" — the tile then spun at `running` with no
    error, un-re-rollable, while the session reported `finished`. And `_collect_stranded` could
    itself raise from inside an `except` arm, escaping the same way: with the claim already released,
    the dispatcher re-picked the still-`running` tile and spun (~500 re-attaches in six seconds,
    `_ACTIVE` pinned, every later Generate refused). An R2 PUT wobble was enough. Both are fixtured.
  - **A slot is trusted only when it is not stale.** The safety argument for collecting broadly is
    that `_submit` empties the slots first — true for the paths that go through it, false for
    `_adopt`'s lost-id arm and for a `queued` tile caught by a sweep, which never do. Those pass
    `newer_than=<the attempt's started>` and ignore an older object, so a tile stopped and then
    re-rolled can never come back green showing the cancelled attempt's render under the new seed's
    recipe — wrong bytes under a recorded recipe, which is worse than the red tile it replaces.
  - Fixtures: 345 checks here (was 319), plus 10 in `test_render_slot.py` (73, was 63) for the
    still-image poll loop, which had none at all. They cover a FAILED job whose render landed, an
    empty payload with a full slot, a stop after the upload, a lost job id with and without a render
    in R2, a submit refused before any job exists, a rescue that cannot be persisted, a stale slot,
    a rescue during adoption being written back, stopping an orphaned session, and a delete taking
    its slots with it.
- 2026-09-07 — **A deploy mid-render stopped costing the render.** Owner: *"lost contact with
  RunPod for 182s … I had 3 computers generating, but no result were showing, also one of them
  looked stuck."* RunPod never went away. Three Railway rollouts that day
  (`326daa95`, `ff64e95c` — a docs-only commit — and `a3b2691c`; at the time every push to
  `main` redeployed this service — Watch Paths, set the same day, now scope that to pushes
  under `services/atlas-tool/**` or `services/_shared/**`, `docs/INFRA.md`) each swapped the container mid-session. The GPU finished the
  orphaned jobs anyway and PUT each render into its presigned hand-off slot, but the process
  that would have collected it was gone; two and a half hours later, when the sessions were
  reopened, RunPod had dropped the job records (it keeps a finished job ~30 min) and answered
  `404 job not found` — which `_await_job` spent its full three-minute grace on and then
  reported as lost contact. **Thirteen finished renders were reported to the author as failures**
  while sitting complete in R2 — five that day, and eight more going back to 2026-09-02, every
  one of them carrying the same `lost contact with RunPod for 18Xs` on its tile: the sweep of
  `video/_out/` that recovered them is what showed this had been happening all week, not once.
  (All thirteen were moved back into their sessions by hand.) The orphaning also
  broke the one-session-at-a-time rule — the adopted session ran beside the abandoned one's live
  jobs — so six jobs contended for three workers: 46 min in queue, then a 100-minute job that
  had to be cancelled.
  - **The outcome and the render are now separate questions.** `_await_job` raises `_Unresolved`
    (not a failure) whenever it could not read what happened, and `_run_variation` looks in the
    hand-off slot before calling a variation failed — the keys are derivable, so any process can
    collect any job's render (#559's fix, one step further along).
  - **A 404 is an answer, not silence.** `batch_atlas.RunPodHTTPError` keeps the status code, and
    a run of 404s **on a job we have already read, or re-attached to** gives up after
    `NOT_FOUND_GRACE_SECONDS` (15) instead of `STATUS_GRACE_SECONDS` (180), cancels nothing (there
    is nothing there to cancel), and says the record is gone rather than blaming the network. A 404
    on a job never once read keeps the long grace and still cancels — RunPod also 404s a job it has
    not indexed yet, and giving up on that in fifteen seconds would abandon a live, billing render.
  - **The container re-attaches when it BOOTS** (`resume_orphans`, `ui_server.main`), instead of
    waiting for a person to open the page — which is what let the jobs age past RunPod's record.
    A delimited bucket sweep (`storage.list_prefixes`, ~8 s, `VIDEO_RESUME_WINDOW_HOURS` back)
    finds sessions that are `running` with a `job_id` in flight. **A boot COLLECTS; it never
    starts.** Both halves of that are enforced: `_is_mid_render` picks only sessions with a job
    already paid for, and `_adopt(collect_only=True)` leaves every `queued` slot of that session
    alone — finishing a grid's tail unattended, hours later and once per rollout, is spending
    nobody asked for. The session is handed back to storage still `running` (and dropped from
    memory), so opening it resumes the rest the ordinary way: a person deciding to spend.
  - Two hazards the review caught on the way, both older than this change. **`_adopt` was not
    idempotent** — check-then-insert across a released lock, so a boot sweep and a reconnecting
    browser could each install their own dict for one session id and run two workers over it,
    with separate `in_flight` sets claiming the same variation twice. It is one check-and-insert
    under `_LOCK` now. And **the hand-off slots are emptied at submit**, not only on a successful
    collect: their keys are derived from session id + index, so a re-roll inherits whatever its
    own earlier attempt left there and could have rescued the previous seed's render as the new
    one's. Also: the boot sweep takes a session's project from the KEY it was read under (a
    doc's own field falls back to the env default when unslugged, which would write the session
    into the wrong project), caps what it adopts at the queue depth, and `list_sessions` now
    matches a live session on client AND project.
  - Fixtures (319 checks): a purged job whose render is in the slot ends `done` on the short
    grace with nothing cancelled; a purged job with an empty slot fails and names the cause; a
    404 on a job never once read keeps the LONG grace and stops the job (RunPod also 404s a job
    it has not indexed yet); a 404-then-500 run latches back to the long grace; a re-roll cannot
    rescue the attempt before it; the rescue prefers the animated clip over a preview and retries
    an unreadable slot; a boot collects the running job and leaves the queued tail, which only
    opening the session starts; and two adopters cannot take one session twice. **The real fix was Watch Paths on the Railway
    services** — set the same day on all four repo-root services (`docs/INFRA.md`), and
    proved live the same evening: #602 (atlas-tool only) was *Skipped* by atlas-backend,
    sheet-tool and the test-server, while #601 (which also touches `services/_shared/**`)
    was correctly built by the two services that vendor it. This change is what makes a
    swap survivable; that setting is what stops most swaps happening at all.
- 2026-09-04 — **A rig-timeline `event.flipbook` binding now plays wherever the rig is mounted.** The clip half of the same two-mount-sites gap; `<SpineProvider>` resolves and mounts bound clips itself now. Detail in [fx status](fx.md).
- 2026-09-04 — **A failed render now names the node and the exception — thirteen tiles read
  `job FAILED: comfy execution error` and nothing else.** Owner, right after the contract fix
  shipped: *"I still get job FAILED: comfy execution error"* — a DIFFERENT failure (ComfyUI
  accepted the prompt; a node raised at runtime) and the panel could not say which. The
  worker's `_fail` put ComfyUI's `execution_error` event (node type, id, exception, message)
  in a `detail` key beside the `error` string — and RunPod keeps only the STRING of a failing
  result, so `detail` and #550's `worker_build` never left the worker. Now the string itself
  reads `comfy execution error — <node> #<id>: <Exception>: <message> [worker <sha>]`
  (`_describe_execution_error`; message whitespace-collapsed and capped so the node survives
  the tool's 400-character keep). Needs the worker image rebuilt (CI on a push under
  `services/atlas-serverless/**`) AND the endpoint moved to the new `:<sha>` tag — a `:latest`
  endpoint caches by digest (`docs/INFRA.md`). The failing session (`20260904_093054_0ed4`,
  `WanLoopingVideo (3)`, 13/13 failed, 40 s–6 min each) stays unexplained until that lands or
  the RunPod worker log is read for one of its job ids (`b915948a-…-e2`).
- 2026-09-03 — **A blueprint imported from a workflow carried no domain, so `sensitivity: 50`
  reached the GPU.** Owner: *"/prompt rejected (400) … node 372 sensitivity: Value 50.0 bigger
  than max of 1.0 — it started today, I have no problem in the atlas maker."*
  - The ＋ Blueprint importer typed every setting from the value the graph baked in
    (`inferParamType`): a baked `1.0` says "float" and nothing else. So an imported blueprint
    published with no `min`/`max`, the panel had nothing to bound, and the runner's clamp
    (`_effective_param_value`, which only bites on a DECLARED domain) had nothing to clamp to.
    The hand-authored `wan22_i2v_flipbook` declares 0..1 and a 12-model list, which is why the
    built-in path never showed it. The same gap put "Bck Model" in a free-text box and "Bck
    Alpha" in a textarea: the importer could not know they were COMBOs.
  - Fixed upstream of the clamp. `services/atlas-tool/comfy_specs.py` reads a node's REAL
    contract from ComfyUI `/object_info` (`FLOAT`/`INT` → min/max/step, COMBO → the option list,
    `BOOLEAN`, `STRING` multiline; ComfyUI's 1e308 "no limit" sentinels publish as unbounded),
    served by `POST /video/nodespecs` (allow-listed in the launcher proxy). The importer prefers
    it over the value guess (`applySpecToRow`), publishes `min`/`max`/`step`, and records
    `options_from: {class, field}` on a select so the list can be re-read — keyed on the CLASS so
    it survives a re-import that renumbers nodes. `blueprints._validate_params` whitelists
    `options_from`; a key missing from that tuple is dropped silently on publish. The Atlas
    Maker page's OWN ＋ Blueprint importer (vanilla JS in `ui_server.py`, `syncFromField`) got
    the identical treatment — it had the identical guess — so the two importers stay in step.
  - **Panels:** a numeric with both bounds is a slider + number box, clamped on change — HTML
    `min`/`max` on a number input only fail form validation and never stopped the 50. Option
    lists refresh LIVE on every panel open (the Generate rail here, 🎛 Blueprint settings on the
    Atlas Maker page), and a saved value the live list lacks stays selected, marked "(not
    installed)", rather than being rewritten. `specs_for_blueprint` resolves a param's class
    through the blueprint's own graph, so a blueprint published BEFORE this gets live bounds and
    lists in the panel with no re-publish — whenever a catalog ComfyUI answers.
  - **Which ComfyUI answers is the point.** A contract must describe the machine that will RUN
    the graph. Main's #573/#576 model (`run_on`: *RunPod* vs *My computer*, one catalog each) is
    the rule, and `comfy_specs` asks `comfy_catalog._probe_sources` for that target: *RunPod* =
    a pinned `COMFY_CATALOG_URL` or a running pod discovered through the RunPod API, never
    `COMFY_URL` (still set in production, and it is the owner's LOCAL tunnel); *My computer* =
    `COMFY_URL` only. The Atlas Maker's importer/panel follow the project's `run_on` (`surface:
    "atlas"` on the request); a video render never consults `run_on` — it runs in-process on
    the service default — so the Flipbook reads `_env_run_on()`, the pod in production.
    Nothing answering is normal and never an error.
  - Built ON #571–#580's `comfy_catalog`, not beside it: its source probe, HTTP client,
    per-target catalogs and `COMFY_CATALOG_URL`. The contract reader adds `remember()` (a COMBO
    list seen live on *My computer* joins the local catalog's next `commit_live`) and ⟳ Refresh
    model lists now also caches every published blueprint's select lists (`options_from`, or
    the node the param drives) for its target — so a blueprint's dropdown shows the last-seen
    pod list while no pod is running, before the import-day bake. Also fixed on the way: #571
    had committed the `/video/nodespecs` dispatch line without its handler (it read a working
    tree that already held half of this), a latent 500 on `main` that the proxy never reached.
  - Fixtures: `test_node_contracts_are_read_not_guessed`, `test_a_sleeping_pod_is_not_an_error`,
    `test_the_catalog_is_the_machine_that_runs_the_graph`,
    `test_options_from_survives_the_param_whitelist`, and
    `test_a_param_with_no_declared_domain_cannot_be_clamped` — the 400 itself, reproduced.
  - **The owner's existing blueprint:** re-publish it (＋ Blueprint on the same API export, with
    a pod running) to bake the bounds and lists in; or rely on the live panel read whenever a
    pod answers, and on ⟳ having cached its lists. Until either, keep Bck Sensitivity in 0..1.
- 2026-09-03 — **A session did not exist anywhere until a worker touched it.** The destructive half
  of *"after a refresh most of my generations disappear, as if they were never registered"* — and
  the phrase was literally true.
  - `start_session` built the session, put it in `_SESSIONS`, dispatched and returned. **`meta.json`
    was first written by the WORKER**, when it began the first variation. A session waiting its turn
    behind another therefore existed nowhere but in RAM, and a restart erased it leaving no file, no
    record and nothing to recover. Not a lost render — a lost REQUEST.
  - **Queueing is what makes it likely rather than theoretical.** The tool actively invites you to
    line several ideas up behind the one running (`MAX_QUEUED_SESSIONS = 4`), and every one of them
    was unwritten until its turn came. So the more work you had queued, the more a single deploy
    took — and there were about a dozen deploys on 2026-09-02.
  - Fixed by persisting before dispatch. `_adopt` already restores a doc whose variations are all
    `queued`, so a queued session now survives a restart and resumes instead of vanishing.
  - **Why the earlier scans said nothing was lost, and were right:** they looked for renders without
    records and for gaps in a session's slots. A session erased before its first variation leaves
    neither — no file, no slot, no dir. The scans bounded the damage correctly; they could not see
    a request that never reached storage at all.
  - Fixture: a session queued behind a running one is on disk before any worker touches it, and
    survives `_SESSIONS` being cleared with its prompt and every slot intact. **Confirmed to fail
    against the old order.**
- 2026-09-03 — **A renamed setting kept the node's name in the Generate panel.** Owner, after a
  publish where every row read `BiRefNetRemoveBackgroundRMBG`, `…RMBG2`, `…RMBG3` despite the names
  they had typed: *"can we use the string I am actually inputting in the fields?"*
  - **Cause:** the row's first box is the **key** and the second the **label**, and the panel shows
    the label. Picking a node prefilled BOTH with the suggested key; typing a new key left the
    label holding the old suggestion, so the typed name was published as an id nobody sees.
  - **Fix:** the label now follows the key while it still holds what the row auto-filled (blank, or
    the last suggestion); a label the author typed is left alone. Placeholders say which box is
    which (`label (shown in the panel)`). Same fix in the Atlas Maker's Python-rendered twin modal
    (`ui_server.py` `key.oninput`), which had the identical prefill.
  - Already-published blueprints keep their old labels — re-publish (overwrite) to pick up the
    typed names.
- 2026-09-03 — **Sessions "disappeared" from the picker without anything ever being lost.** Owner:
  *"my generation do not get registered … after a refresh most of my generations disappear, as if
  they were never registered! This is a destructive way of working"*.
  - **Nothing was destroyed. The LIST stopped mentioning it.** Scanned the live bucket first —
    15,307 objects: **0** renders present but unrecorded, **0** index gaps across 38 sessions, no
    `done_count` disagreements, no sessions under a wrong project prefix, and all four mutation
    paths (`add`/`duplicate`/`regenerate`/`discard`) persist before returning. The data was intact
    the whole time.
  - **`storage.get` answers "missing" and "could not read" identically — both `None`.** So
    `list_sessions`, which does ONE round trip per session and skips a falsy read, turned any flaky
    read into a session that had never existed. With thirty-odd sessions that is thirty chances per
    refresh: likely rather than rare, and worse the longer the tool has been used. When the LISTING
    itself failed it was quieter still — a bare `except` fell back to whatever was in memory and
    served that as the answer.
  - **A short list nobody can tell is short is worse than an error**, because the author acts on it:
    re-running renders they already have, or believing an afternoon's work is gone. The listing now
    retries a failed read, distinguishes a genuinely absent doc (skip — honest) from an unreadable
    one (raise), and `/video/sessions` answers **503 with a readable message** rather than a
    plausible, ordered, incomplete list. Reads are concurrent now too, which is both faster and a
    smaller window.
  - **`storage.get_strict` is the fix's core** — `None` only for a real not-found, `ObjectUnreadable`
    for anything that is a failure to ASK. Classification verified against the REAL bucket: an
    existing key returns bytes, a missing one returns `None` and does not raise (so a deleted
    session can never take the whole listing down).
  - **Three more reads had the same fault** and now share one path: opening a session, cancelling
    one, and loading one to edit all produced "No such session" for a session sitting right there.
    The listing was the loudest version, not the only one.
  - Fixtures: a single flaky read is retried rather than dropping a session; a read that will not
    come back raises instead of shortening the list; a genuinely absent doc is still skipped; open
    and cancel each ride out a bad read. **Confirmed to fail against the old swallow.**
- 2026-09-03 — **The variation caps are gone** (owner: *"we have a cap on the amounts of variations we can send to runpod … I never asked for this cap"*). Three ceilings had shipped unasked: 12 variations per Generate / ＋ Add request (`MAX_VARIATIONS`, mirrored as `max="12"` on both inputs), 36 live slots per session (`MAX_SESSION_VARIATIONS`, enforced on add and on ⧉ duplicate), and `VIDEO_PARALLEL_JOBS` clamped to 8. All three are removed — the only refusal left on a count is one below 1. The endpoint's own worker count is the real bound on parallelism and the owner sets that, so a second number in code could only ever disagree with it. Fixture: a session grows past 150 slots through both ＋ Add and ⧉, and a count of −1 is still refused (244 checks). Guides updated in both copies of `flipbook.md`.
- 2026-09-02 — **A twelve-tile grid ran on ONE of the endpoint's three workers.** Owner
  report: the RunPod endpoint is sized for three workers, and only one ever ran, however big
  the grid. The runner submitted one job at a time by design, and RunPod's autoscaler wakes a
  second worker only when a second job is WAITING — so a serial runner keeps every other
  worker asleep, whatever the endpoint is sized to.
  - **`_run_variations` is now a dispatcher.** It claims the lowest eligible slot under
    `_LOCK`, hands it to a daemon thread (`_run_variation`, the old loop body, with the
    project context re-set the way `_run_session` sets it) and keeps up to `PARALLEL_JOBS`
    in flight on a `Condition`. It returns only once every thread it started has finished,
    because `_run_session` hands the runner to the next queued session on return. The
    re-pick is unchanged — a re-roll or `＋ Add` armed mid-run is still collected by the
    pass under way — and sessions still run one at a time (`_ACTIVE` / `_QUEUE` untouched):
    this is parallelism WITHIN a session, never across them.
  - **`VIDEO_PARALLEL_JOBS`** (default **1**, no upper clamp since 2026-09-03) is the cap. The default is
    deliberately serial — byte-for-byte what ran before — because each extra worker pays
    its own cold start (the ~29 GB Wan load a warm worker would have skipped) and
    multiplies the burn RATE by the same factor, so it only pays off on a big grid. Set it
    to the endpoint's max workers (the owner's is 3) and never above: the surplus just sits
    IN_QUEUE. Sessions still never overlap, so the ceiling on spend is this number, not the
    number of sessions queued.
  - **`meta.json` writes are serialised** under a dedicated `_META_LOCK`, snapshot + put as
    one unit (the snapshot itself under `_LOCK`). Two variations finishing together would
    otherwise each serialise a session the other is still mutating and race their bodies to
    R2, where the OLDER one can land last and quietly undo a `done` that was already true.
  - Fixtures: the fan-out peaks at exactly the cap and never above across twelve tiles,
    each landing in its own slot; `PARALLEL_JOBS = 1` stays serial (the second job goes out
    only after the first finished); a cancel mid-fan-out `/cancel`s every in-flight job,
    reads `cancelled` (never `failed`) and releases the runner to a following session; one
    failed job leaves the other eleven `done`. **Not verified on a live endpoint** — the
    proof there is the Requests tab showing three workers busy on one session, which needs
    `VIDEO_PARALLEL_JOBS=3` set on `atlas-tool` and a redeploy.
  - **Two review fixes, both reproduced at `PARALLEL_JOBS > 1`.** The dispatcher's
    condition is module-level (`_CV`) and both `_dispatch`'s already-active branch and
    `cancel_session` `notify_all()` it, so a re-roll / `＋ Add` armed while the dispatcher
    sleeps is submitted into a free slot at once instead of after the next in-flight job
    happens to exit (and a stop's `queued → cancelled` sweep is immediate). That sweep now
    also settles a `running` tile the pass never claimed — an adopted doc holding more
    running slots than the cap now allows, whose job `cancel_session` had already
    `/cancel`led — which used to stay `running` with no thread behind it and refuse every
    re-roll with "still rendering. Cancel the session first". Alongside: the worker threads
    take their project context from the same `ctx` `_run_session` sets its own from, and the
    fixtures' `set_context` stub records its caller's thread id, so the fan-out fixture
    proves the context is set on the worker threads rather than assuming it.
- 2026-09-02 — **A render the worker had already uploaded could be lost by the process that came to
  collect it.** First live run of the R2 hand-off:
  `output entry carried no data: {'bytes': 5918564, 'filename': '…', 'slot': 0}` — and the file was
  in R2 all along, 5,918,564 bytes, exactly the size the worker reported.
  - **The upload keys lived only in the submitting process.** A deploy mid-render (this one, as it
    happens) hands the job to a fresh container, which re-attaches by the persisted `job_id` and
    knows nothing else the old process arranged. The result then says `slot 0` with no key list to
    resolve `0` against, so it fell through to the base64 branch and reported missing data for a
    render that was finished and paid for.
  - **Exactly the trap the persisted `job_id` was added for, one field along** — the comment saying
    so sits four lines below the bug. Adding a second piece of per-job state without asking whether
    it survives a restart is the repeatable mistake here, not this particular field.
  - **Fixed by derivation, not by another stored field.** `_upload_slot_keys(prefix)` is one
    definition called by both paths; `prefix` is built from the session id and the variation index,
    so two different processes compute the same keys from the same two facts and nothing can fall
    out of step.
  - **And the misroute is now legible.** An entry naming a slot carries no bytes, so falling through
    to base64 reported "carried no data" — which reads as a broken worker when only the lookup was
    missing. With no keys it now says the render is in R2 and was not collected.
  - Fixture: a fresh process derives the same keys from the prefix alone and finds the render; plus
    the no-keys, unissued-slot and missing-object messages.
- 2026-09-02 — **A render no longer comes back through RunPod, so its payload cap stops applying.**
  Owner: *"the 20MB limitation is a bit of a bottleneck for us, is there any way to remove it?"* —
  the cap itself, no: RunPod's limits are fixed (10 MB `/run`, 20 MB `/runsync`, plus a third again
  for base64) and their own guidance for a large result is object storage. So the render is routed
  around it instead.
  - **The worker PUTs straight to R2 and returns a slot number.** `video_runner` presigns a few
    PUT-only, single-key, expiring URLs at submit and passes them as `input.upload_urls`; nothing
    large crosses RunPod's API at all. Verified end-to-end against the REAL bucket, not a double: a
    3 MB body presigned, PUT with no credentials, read back byte-identical, deleted.
  - **No credentials on the worker.** Its image is public on GHCR, so a presigned URL — one key, no
    read, no listing, expiring — is the difference between "nothing worth stealing" and a leaked
    bucket key. It also needs no new dependency: the image already has `requests`.
  - **The PICKING rule stays on the tool side**, and only the bytes move. The worker uploads output
    i to slot i in ComfyUI's own order; teaching it which file is "the render" would put one
    decision on both sides of the wire and let them disagree.
  - **Both directions degrade rather than fail** — a worker predating this ignores the field and
    base64s as before; a runner that cannot reach R2 to sign runs the old way at the old ceiling; a
    rejected upload falls back to inline per FILE, not per job. So a stale endpoint image is a
    smaller ceiling, never a broken render.
  - Scratch objects live at `<client>/<project>/video/_out/` and are deleted the moment the real
    render is written. Safe there because `list_sessions` counts only `*/meta.json`, so they can
    never be mistaken for a session.
  - Fixtures: worker side — a 40 MB render is reported by slot with nothing inline, the bytes reach
    the URL they were given, a 403 degrades to inline, no URLs behaves exactly as before, and slots
    line up with output order even when one falls back. Tool side — the `.webp` still wins over a
    preview and its bytes come from the slot it claimed, an unissued slot is refused, a missing
    object says the URL may have expired, and an unreachable R2 still completes a session.
- 2026-09-02 — **"It is still failing when I check the bool that suppose to not run the background
  removal" — and the answer had nothing to do with backgrounds.** Owner report; the error was
  `job returned no output files (output={})`.
  - **The correlation in the records is total and was the whole diagnosis.** Across five sessions of
    `wanloopingvideo__3_`: every variation with the cutout ON finished (16 renders, 1.4–4.5 MB);
    every variation with it OFF failed this way (16 renders, 0 exceptions).
  - **It is not the graph, and the durations prove it.** The failing runs took **927–1061s** — full
    generations — and RunPod reported them **COMPLETED**. The worker returns `{"images": …}` or
    `{"error": …}` and never nothing, so an empty payload means the render finished and the RESULT
    was lost coming back: too large for RunPod to hand over (~20 MB).
  - **Nor is it the export size**, which is what it looks like at first. Session `_25a3` ran
    **640×640 with the cutout ON** and every variation landed at ~4.5 MB. Same size, cutout off,
    nothing comes back. What changes is compressibility: `SaveAnimatedWEBP` is baked
    **`lossless: true`**, and a lossless WEBP of opaque frames is several times the size of one that
    is mostly transparent. The cutout was silently holding the payload under the cap.
  - **The same shape as `fast_lora`, one node along**: a load-bearing input baked into the graph
    and never exposed, so no UI could reach it. `lossless` (and `quality`) on node `363` are now
    params — **defaults left at the author's baked values**, because which way they point is an
    authoring decision and only the unreachability was the bug. The built-in blueprint exposes both,
    which is why it never hit this.
  - **Note the gate warning could NOT have caught this**, exactly as its fixture says: `lossless` is
    a widget among a dozen on a save node, not a boolean gating a switch. The warning is
    deliberately narrow to stay false-positive-free; this is the cost of that choice, and it is
    still the right trade.
  - **The message now names the cause.** `job returned no output files (output={})` pointed at the
    graph — the one place the answer is not. An EMPTY payload is now told apart from a populated one
    with no images in it, and says the file was too large, that a lossless WEBP without a cutout is
    what usually does it, and which setting fixes it.
  - Fixtures: `test_an_empty_payload_names_its_real_cause` — the empty case explains itself and
    names `lossless`, a populated-but-imageless result keeps the old wording, and a worker error
    still wins over both.
- 2026-09-02 — **Cancel does something on the session that most needs it.** Owner, testing the
  cancel fix: *"I try to click the cancel button under the queue button, but nothing is
  happening!"* — and it genuinely was not: the click reached the tool, set the flag, and left.
  - **The settle test asked the wrong question.** It read "is any variation running?" and inferred
    a worker from the answer. A session ADOPTED from its stored doc after a restart breaks that
    inference completely — its variations still say `running` because that is what they said when
    the old process died — so `cancel_session` saw work in flight, assumed a thread was watching
    it, and handed everything to a worker that does not exist. It is now `_ACTIVE != session_id`,
    which is the whole of the fact "someone will act on this".
  - **Caught from the RECORD, not from a repro.** `<c>/<p>/video/20260902_083441_25a3/meta.json`
    sat at `status: running`, variation 5 `running`, **`cancel: false`**, its meta untouched for 32
    minutes while a second session wrote its own every few minutes. `cancel: false` after the
    author had clicked is the whole diagnosis: the flag was set in memory and persisted nowhere,
    because `_write_meta` was only reached on the settling path. It is now written on both.
  - The two are one bug seen twice: nothing acted on the flag, and nothing recorded that it had
    been asked for — so a restart forgot the stop as well.
  - Fixture: `test_cancelling_a_session_no_worker_owns` builds that state exactly (a second session
    holding the runner, an orphan in `_SESSIONS` with a frozen `running` variation and a job id)
    and asserts the settle, the remote stop, that a finished slot is untouched, and that R2 records
    it. Confirmed to fail against the old test.
- 2026-09-02 — **Cancel stops the GPU, not just the wait.** Owner: *"I have canceled jobs, and the
  UI is telling me they are cancelled, but when I look at the runpod, I can see the server is still
  running and generating."*
  - **The cancel was always being sent. RunPod just does not interrupt a synchronous handler.**
    `/cancel` marks the JOB cancelled and discards whatever it eventually returns; the worker is
    never told, so `handler.py`'s `_await_result` went on polling ComfyUI and ComfyUI went on
    sampling — billing for the whole render, to hand the result to nobody. Every surface on our
    side (session, tile, button) was reporting the truth it had: we *asked*.
  - **So the worker asks.** A running job now polls its own status on the SAME public route the
    runner uses (`/v2/<endpoint>/status/<job>`), and on `CANCELLED` / `TIMED_OUT` / `FAILED` —
    all three mean nobody is coming for the result — it stops itself. Deliberately the public API
    and not an SDK internal: it is the one contract here that is already proven in production.
  - **Stopping means `/interrupt` AND killing ComfyUI.** An interrupt lands between nodes, so a job
    inside a 14 GB model load would sail through it; the kill is the guarantee, and frees the VRAM
    with it. Leaving the process dead is safe — the next job's `_maybe_restart_comfy` cannot read
    stats from a dead server, so it starts a fresh one.
  - **Fail-safe in the direction that costs nothing:** an unreadable status is NOT a cancellation.
    The exact mirror of the runner's grace window on the same API — there a flaky read must not
    fail a live job, here it must not abort one.
  - **Needs two env vars ON THE ENDPOINT** (`RUNPOD_ENDPOINT_ID`, `RUNPOD_API_KEY` — see
    [INFRA](../INFRA.md)). Without them the worker cannot ask and behaves exactly as before, so it
    says so in the container log at the first check rather than silently billing for cancelled work.
  - **A cancel RunPod refuses is no longer swallowed.** `_cancel_job` caught every exception and
    returned nothing, so a cancel that never landed left a job rendering at full cost with every
    surface saying it had stopped. It now returns a bool, logs the failure, and `cancel_session`
    hands back a `warning` naming the jobs — surfaced where the modal already shows errors. The
    local stop still stands; the author is simply told what it did not reach.
  - **A fourth clock, found while reading for this:** the worker's own `JOB_TIMEOUT` was a
    hardcoded **1800**. With the endpoint at 9000s and `VIDEO_JOB_TIMEOUT_SECONDS` at 9600, that
    had silently become the shortest cap on a job — a 1024² quality render would have died at 30
    minutes reporting "generation timed out", blaming ComfyUI for a limit nobody had raised. Now
    `COMFY_JOB_TIMEOUT`, default 9000.
  - **`handler.py` had no tests, which is most of how this happened** — nothing runs it but a
    rebuild, and the one behaviour that costs real money when it is wrong was never asserted. Its
    boot block is now under `if __name__ == "__main__"` (start.sh runs it as a script, so the
    worker is unaffected) and `py test_handler.py` covers the stop, the kill, the fail-safe read,
    the missing-credentials warning, the untouched happy path, and the cap.
  - Fixtures: `py services/atlas-serverless/test_handler.py`, plus a runner case that a refused
    cancel is reported and an accepted one stays silent.
- 2026-09-01 — **The publish modal now says which switches nothing will be able to reach.**
  Closes the open item the `executionTimeout` outage left behind: a blueprint's `params[]` are the
  ONLY inputs the runner writes, so an undeclared one keeps whatever the ComfyUI export saved,
  forever — and an unticked boolean looks exactly like one that does not matter.
  - **The signal is fan-out to switch GATES, and it has no false positives on either graph we can
    check.** A candidate is the same shape `resolveKnob` already calls a knob (exactly one input,
    nothing wired in) holding a boolean; it counts how many `switch` inputs it reaches. Run over the
    built-in `wan22_i2v_flipbook` it returns nodes `171` and `203` — **exactly the two booleans that
    blueprint's hand-written manifest exposes as params**, out of 35 nodes. That equality is the
    fixture's central assertion: a heuristic that disagrees with the one blueprint we know is
    correctly authored is wrong whatever else it finds.
  - **The forward walk through `Primitive*` relays is the whole difficulty.** A ComfyUI SUBGRAPH
    republishes an outer value as its own primitive inside, so the top-level gate drives NOTHING
    that looks like a switch — on the graph that caused the outage, node `361` reaches its ten
    switches through two relays in two different subgraphs. Counting direct consumers finds nothing
    at all on precisely the graphs this exists for. Matching is by input NAME (`switch`/`boolean`),
    not by class: `on_true`/`on_false` are inputs on that same switch node, so a class test counts
    every switch three times.
  - **It fixes rather than describes.** Each flagged gate carries an **Expose** button that appends
    a settings row already pointed at it, with key/type/default read off the graph by the existing
    `setParamTarget`. Recomputed as bindings and rows change, so it CLEARS as it is acted on —
    a warning that cannot clear is one authors learn to skip.
  - **Live-verified against the real imported graph**, in a browser, driving the served page's own
    JS: the box lists `SetTurbo (#361) · value — baked false, switches 10 inputs` and
    `RemoveBackground (#374) · ... 1 input`; one click on Expose produces a `bool` row keyed
    `SetTurbo` defaulting `false` and drops it from the list; exposing both hides the box; removing
    a row brings it back. The Expose button stays inside the panel down to a 420px-wide modal.
  - **Both modals, and the drift between them is now a test.** The Atlas Maker's twin is
    hand-written inline JS in a `.format()`ed Python page and cannot import the Svelte module (the
    A/B line in [ui-inventory](../ui-inventory.md)) — which is how the previous pair of
    hand-maintained heuristics in these two modals drifted until an owner hit it (#534). The
    fixture now LIFTS `bpUnexposedGates` and friends out of `ui_server.py`, undoubles the braces
    exactly as `PAGE.format()` does, and asserts the twin returns byte-identical results to the
    module on both graphs. Confirmed to go red by mutating the twin.
  - **Not covered on purpose:** an unexposed NUMERIC knob. The same blueprint's 1024 generation size
    reached the render exactly the way the wrong boolean did, but "this int matters" has no clean
    signal, and a warning that cries wolf is worse than none.
  - Fixtures: `node apps/launcher-api/blueprintGates.fixture.ts` (18 assertions incl. the built-in
    reference answer, the relay hop, the cycle guard, four must-not-flag shapes, and the twin
    parity).
- 2026-09-01 — **Every video job on a newly-imported blueprint failed, and the cause was one
  unexposed boolean.** Owner report: *"I have tried to run a few videos on the runpod, on a GPU with
  enough memory I used before and worked, and they all failed."* The session records
  (`<c>/<p>/video/<id>/meta.json`) named it exactly: **`job FAILED: executionTimeout exceeded`** on
  every variation — RunPod killing the job at ~925s, NOT ComfyUI rejecting the graph. So no node and
  no model was missing; the graph validated and ran, and simply never finished.
  - **A published blueprint's params are the only knobs the runner can turn, and the slow/fast gate
    was not one of them.** The imported `wanloopingvideo__3_` graph gates both its Wan passes on node
    `361` (`PrimitiveBoolean`, baked `false`) feeding ten `ComfySwitchNode`s. `false` selects **50
    steps, cfg 3.5** (so two model evals a step) and the **raw 14B UNets without the lightx2v 4-step
    LoRA**. The built-in `wan22_i2v_flipbook` has the identical gate at node `171`, also baked
    `false` — the whole difference is that it DECLARES it as the param `fast_lora` with
    `default: true`, and `build_video_workflow` writes every declared default onto the graph before
    submitting. An undeclared node keeps its baked value forever, and no UI can reach it.
  - **So a graph's baked value is a DEFAULT only for the inputs the manifest names**, which is the
    trap the ＋ Blueprint modal still cannot warn about: it binds what you tick, and a boolean you
    did not tick looks exactly like a boolean that does not matter. Compounded here by
    `SetWidth`/`SetHeight` at 1024 (the export downscales to 320 regardless; the built-in generates
    at 640) and by the graph being a LOOP — `WanImageToVideo` then `WanFirstLastFrameToVideo` fed
    from pass 1's first/last frames, four ~14 GB UNet loads in one job. Roughly 12–24× the built-in's
    compute for a render that takes ~100s warm.
  - **Fixed in the live library, not in code**: `_shared/blueprints/wanloopingvideo__3_/blueprint.json`
    gained a `fast_lora` bool (node `361`), and the generation size — already exposed, but baked at
    1024 — was temporarily dropped to 640 to get a render through at all. Verified through the
    tool's own `validate_against_graph` and then by running the real `build_video_workflow` over it.
    Confirmed by the next owner session: first variation **COMPLETED** in ~17 min, which the
    timestamps place 2½ minutes after the patch landed — so that run was fast mode at 640, not the
    quality path, and says nothing about how long the quality path takes.
    `blueprints.hydrate()` is once-per-process, so a library edited underneath a running service
    needs **↻ Refresh from R2** (or a restart) — a reload of `/flipbook` will not do it.
  - **Both values are back where the author put them** (owner's call, 2026-09-02, once the endpoint
    timeout was raised to 9000s): `fast_lora` defaults `false` and the size defaults 1024, so an
    untouched session now renders byte-for-byte what the imported graph baked — 50 steps, cfg 3.5,
    raw 14B UNets at 1024². **That is the point, and it is worth stating plainly: the bug was never
    the VALUE, it was that no value could be chosen.** Exposing the knob was the whole fix; which
    way it points is an authoring decision, and both are now tick-boxes in the Settings panel, per
    session, with no republish. The `min`/`max` bounds added alongside were removed again — a 1280
    ceiling nobody asked for would cap a resolution the author is deliberately raising.
- 2026-09-01 — **A single unreadable status poll no longer throws away a paid, still-running job.**
  Straight after the above, one variation died on
  `RunPod /status/… failed: HTTP 500 Internal Server Error` with `remote_status` still
  **`IN_PROGRESS`** — the render was fine; only the read failed. `_await_job` called
  `_runpod_get` bare, so any transport blip raised out of the poll loop, marked the variation FAILED,
  and left the job running to bill out the endpoint's whole timeout with nobody to collect it. (The
  same shape had already eaten a variation on a `404 job not found`.)
  - **Tolerated in TIME, not in tries** (`STATUS_GRACE_SECONDS = 180`): an API wobble lasts minutes,
    so at a 3s cadence a retry COUNT would give up in seconds. The tile shows `RECONNECTING` while
    retrying rather than freezing on the last status. Only CONTINUOUS failure counts — one good read
    resets the window. When contact really is lost the job is **cancelled** before failing, so it
    stops burning.
  - **`JOB_TIMEOUT_SECONDS` was 1800 and had become a second, hidden cap.** The two clocks start in
    different places — RunPod times a job from worker pickup, this one from submit — so a tighter
    local cap cancels renders the endpoint was still happy to finish. Now `9600`, overridable with
    `VIDEO_JOB_TIMEOUT_SECONDS`; it must stay ABOVE the endpoint's Execution Timeout, which is the
    authority. This only backstops a job RunPod never resolves at all. (Owner had just raised the
    endpoint to 9000s for a 17-minute two-pass render — every one of those would have been cancelled
    at 30 minutes by us.)
  - Fixtures: `py test_video_runner.py` — a job rides out two mid-render 500s and completes with no
    error and no cancel; contact lost for the whole grace window fails it, says *lost contact*, and
    stops the job; and the local cap is asserted loose enough for a multi-pass blueprint.
- 2026-09-01 — **A tile in the 🎬 grid opens its render at full resolution, in its own window.**
  Owner ask: *"in the grid list of the flipbook video generation, I would like to be able to click
  on a card and open it for view in full resolution on a separated window."* A grid column bottoms
  out at 220px, so every tile was a heavy downscale of a 512–1900px render and the two things the
  checkerboard exists to reveal — an alpha fringe left by the cutout, one smeared frame — were not
  actually visible in it.
  - **A window, not an overlay, on purpose.** What an author does with a full-res view is compare:
    against the grid it came from, or against a second variation open beside it. A modal covering
    the grid cannot do either. The window is named per `(session, variation)`, so clicking the same
    tile twice refocuses the window already showing that render instead of stacking copies.
  - **No new route and no server change.** `fullViewHtml()` writes a self-contained document into a
    blank window, which inherits the page's origin and with it the session cookie that
    `/api/flipbook/video/file` gates on. The title (blueprint name included) is HTML-escaped into it.
  - **Fit is measured, not predicted.** `window.resizeTo` is a request a window manager is free to
    ignore — it was observed being ignored — so the popup decides 1:1-vs-fit from the pane it
    actually ended up in, re-decides on resize, and stops deciding the moment the author touches the
    toggle (button, or `F`; `Esc` closes). Verified in real Chrome against a 1791×1909 and a 386×1645
    image: auto-fit on open, manual 1:1 sticks, same-tile reuse reports the same window object.
- 2026-09-01 — **First real GPU generation, and ⧉ confirmed live in production.** Owner ran 🎬
  mode on the RunPod Serverless endpoint and reported it works, then confirmed the duplicate
  button once #529 deployed (*"it works, the button is there and duplicates fine"*). That retires
  the caveat these docs carried since the mode was built. The four specifics nobody observed are
  folded into open item 1 rather than assumed closed — see there.
  - **The deploy needed BOTH services and only one is externally checkable.** The launcher was
    verified by probing the new proxy route until it flipped **404 → 401**; the control matters,
    because a route that does not exist stays 404 while one that does reaches the auth gate, so
    the flip is the deploy and not noise. `atlas-tool` answers **403 on every path including
    `/`** — there is no unauthenticated deploy signal on it at all, so the only real proof of the
    pair is pressing ⧉ once: launcher-alone shows the button and then answers a bare
    `404 not found` on submit. Worth knowing for every future change that straddles the two.
- 2026-09-01 — **The video-blueprint publisher ranks candidates instead of excluding them, and
  reads a graph's knobs through the wire.** Owner ask, with a `WanLoopingVideo` export that could
  not be published at all: *"my inputs have changed quite a bit from the original one … these
  nodes are now gone, or anyway they are not the one I want to expose … can we make it more
  dynamic so it would work in the future when I need to import with different operations?"*
  - **Cause: the modal's heuristics were a FILTER, and the binding field was hardcoded per role.**
    `positive` offered only `/CLIPTextEncode/` nodes and always wrote `inputs.text`; `seed` offered
    only a node carrying `seed`/`noise_seed` and always wrote `inputs.seed`. That holds only for a
    graph whose knobs are still widgets on the consuming node. The moment an author does what every
    reusable ComfyUI graph does — "convert widget to input", so the prompt is a `PrimitiveString`
    and the seed a `PrimitiveInt` wired in — the heuristic approves a node whose field the role
    cannot write, and the node the author *meant* (`#369.value`) is not in the list at all. Both
    required roles were unbindable, so the dialog could only ever answer "Bind positive, seed
    first."
  - **The fix is `resolveKnob`: follow the wire back to the widget.** A role suggestion for a
    linked input walks upstream through pass-through relays to the primitive that holds the value,
    and binds THAT. On the owner's graph this is load-bearing beyond convenience — both halves of
    the animation read the same primitives, so writing over `CLIPTextEncode.text` would have cut
    the second half off from the prompt.
  - **Suggestions are now a ranking over a complete list.** Rank 0 = a knob reached through a wire,
    1 = a raw widget, 2 = the wrong polarity (a negative encoder offered for `positive`); every
    `(node · input)` in the graph follows under **All node inputs**. A heuristic that has not
    anticipated a network can no longer corner a role — the worst case is a longer list.
  - **Roles pre-fill only when the top rank is uniquely held.** On this graph that binds five of
    six automatically (negative → `NegText #370.value`, seed → `Seed #371.value`, both refs →
    `LoadImage #97.image`, output → `SaveAnimatedWEBP #363`) and correctly leaves `positive` empty,
    because a first-half and a second-half prompt are two equally good answers and only the author
    knows which is "the" prompt.
  - **A setting reads its key, type and default off the graph.** They were typed by hand into a row
    that defaulted to `int` and an empty default — and an empty default publishes as **0**, so an
    exposed `ExportFPS` shipped as 0 fps. Type comes from the node's CLASS first (a `PrimitiveFloat`
    holding `1` is a float, not an int — otherwise a duration knob refuses `1.5`). Rows also carry
    `label` and `group`, and `select` finally has an options field (it was in the type dropdown but
    had no way to supply `options`, so publishing one was a guaranteed rejection).
  - **A second prompt is now a first-class field, not a 90px input.** Follow-up from the owner on
    the same graph: *"I have 2 positive prompt, and I want both to be available to the user."* Only
    one prompt can hold the `positive` role (it is what the Prompt box writes), so the other has to
    reach the author as a setting — and a `text` param rendered as the 90px inline input every
    numeric knob shares, which is not somewhere anyone writes a prompt. A param may now declare
    `multiline`, which renders a full-width `<textarea>`; the publish row ticks it automatically
    when the graph's baked value reads as PROSE (>40 chars, or several words), so `#222222` and
    `ComfyUI` stay narrow and a lobster paragraph does not. **Its group also starts open** — every
    group was a collapsed `<details>`, which is right for a dozen occasional knobs and wrong for a
    prompt you write on every run. `multiline` had to be added to the passthrough tuples in BOTH
    `blueprints._validate_params` and `_uploadblueprint`, which keep only recognized keys — it was
    dropped silently otherwise. Verified in a browser (280×57 textarea for the prose param, 90px
    for `background_color`, group auto-open, the toggle's auto-tick on all three cases) and through
    the real `validate_against_graph`, which preserves it.
  - **The tool's own param rules are checked before the request**: a reserved key, a duplicate key,
    a half-filled row (silently dropped before), and a node input driven by both a role and a
    setting — the last one greyed out in the picker at the point of choosing.
  - Verified: the real functions extracted from the component and run against the owner's export
    (`resolveKnob` reaches `#369/#368/#370/#371`, the prefills are exactly the five above); the
    modal driven in a browser on an isolated harness (bindings, auto-filled setting rows, the
    double-drive grey-out, the captured publish payload); and that payload fed through the tool's
    real `blueprints.validate_against_graph`, which accepts it — with the encoder wires left intact
    after injection.
  - **`bpCandidates` in `services/atlas-tool/ui_server.py` is the Atlas Maker's twin of this and is
    still on the old exclude-only model** — a still-image graph built the same way hits the same
    wall there. Not touched (different tool, not in the ask); the divergence is noted in both files.
- 2026-09-01 — **⧉ Duplicate with new settings: one tile's recipe, run again as a new tile.**
  Owner ask: *"a duplicate this with new settings button for each card already processed … keep the
  same seed and make a variation from a different prompt/settings … a version with the background
  removal, and one without it."*
  - **It is the OPPOSITE of ↻ in both directions, and that is why both exist.** ↻ *replaces* a slot
    and moves two knobs (prompt, seed); ⧉ *appends* a slot and moves every knob (prompt, negative,
    source image, every blueprint param) while HOLDING the seed. Appending is load-bearing for the
    stated use: the thing being compared against has to survive, or there is no comparison. Holding
    the seed is load-bearing for the same reason — otherwise the difference you see is another roll
    of the dice, not the setting you changed. This settles open question 2 in the design doc.
  - **A variation can now depart from its session's recipe on more than the prompt.** A slot carries
    an optional `settings` bag (`negative` / `source_ref` / `params`), and only what actually
    DIFFERS from the session goes in it — a full copy would read in the grid as "this tile is
    special" and would pin params that were never overridden.
  - **The merge has exactly one definition**, `_variation_recipe(session, var)` in
    `video_runner.py`. The workflow build, the tile's "what is different about this one" line and
    the panel's starting values all read it; the client's `variationRecipe` is its twin and has to
    stay one, or the grid describes renders the runner did not produce.
  - **`settings` keys are read by PRESENCE, not truth.** A duplicate made to *drop* the negative
    stores `{"negative": ""}`, which must mean "none" rather than "the session's" — the trap a
    truthiness fallback (the older `prompt` field's rule, correct only because a prompt can never
    legitimately be empty) would walk straight into. Fixtured.
  - **The blueprint is deliberately NOT a knob.** It is the session's identity and its params are
    the schema every tile in the grid is described by, so another blueprint is another session.
  - **The card layout was the owner's stated worry and was measured, not eyeballed.** A third icon
    button next to a label that already ellipses is exactly how a control gets pushed out of a
    card. Verified in a browser against the tile's real CSS at eight container widths (1400 → 170):
    the four controls stay on one line with **9px to spare** at the grid's 220px minimum, the label
    is never truncated, and nothing leaves the card. The row also gained `flex-wrap` plus an 88px
    floor on the label, so a card narrower than the grid's own minimum folds the icons onto a
    second line instead of overflowing.
  - **The source picker is one component with two destinations**, not a second copy: `openPicker`
    takes a target and `setSource` writes to the rail's field or the panel's. Same for the param
    field markup, now a `{#snippet}` rendered by both panels.
  - Verified live in a browser by mounting the real component against a stubbed API: the panel
    opens on the tile's own recipe (including a duplicated tile's, so chaining works), a pick made
    from inside it lands in the panel and not in the rail, and the posted body is exactly what the
    runner accepts. Fixtures: `py test_video_runner.py` —
    `test_duplicate_a_variation_with_new_settings` (incl. that the duplicate's GRAPH really has the
    cutout off while the original's has it on) and `test_a_session_will_not_grow_past_its_ceiling`.
- 2026-08-31 — **The Rigger became the third consumer: a rig animation event can play a clip.**
  Owner ask on the Rigger side (*"add flipbooks to the rigger, so I can mix rigs, flipbook and FX in
  the animator"*); the flipbook-side story is short because almost nothing here had to change.
  - **A clip needed NO new travel.** `flipbookExport` already ships every authored clip un-pruned and
    reports every sheet they touch, so a rig-bound clip and its atlas were already reaching the game
    — only the BINDING is new (`rigFlipbooks`, keyed by the rig's bundle folder, riding the same
    `export-clips` trigger because it carries no assets of its own).
  - **The per-use vocabulary was reused verbatim.** A binding's `fps`/`loop`/`direction`/`flipX`/
    `flipY` go through the SAME `foldFlipbookPlayback` a placed node and a symbol cell use, so one
    clip walks the same way wherever it is bound and there is still exactly one definition of
    "`undefined` inherits, `false` does not".
  - **`clipSheetKeys` earned its keep again**: the Rigger preview cuts frames per SHEET, so a clip
    interleaved across four atlas pages previews whole rather than one-page-and-three-quarters-missing.
  - The open reachability filter (item 3) gained a fourth referrer — see there.
  - Details, including the preview's frame-cut geometry gate, in [status/rigger](rigger.md).
- 2026-08-28 — **the session rail says WHICH run, not which recipe** (owner report: the list is too long and unrecognisable, with a screenshot of ~20 rows all reading `Wan 2.2 I2V — flipbook source · 10 · 3d ago`). A native `<select>` cannot show a picture, so the rail is now **`$lib/RunPicker.svelte`** — a popover whose every row is a lazy thumbnail of that run's first render + the prompt it was asked for + dim meta, with a green dot for still-working and red for stopped. **The name is DERIVED from the prompt, never stored**: no schema change, and every session already in the project gets one retroactively; it is cut on a word boundary, because a title sliced mid-word reads as corruption.
  - Built as a **shared** component and catalogued as [ui-inventory](../ui-inventory.md) §16, per the `reuse-check` procedure — nothing in domain A covered it (§6's client/project selector is flagged buggy, §14 is the tile grid inside one run), and the launcher does not consume `packages/components-*`, so `$lib/` is its shared location (where `ToolTopBar` and `ColorField` already live). It knows nothing about sessions, prompts or R2: the caller maps its records into `RunPickerItem` and derives the title.
  - The picker's face merges the **polled** session over its `recent` row, or it would still be claiming `queued · #2 in line` long after that session started rendering — `recent` is only re-read when a session goes terminal.
  - Verified by mounting the REAL component in the REAL app on a temporary public route (`pnpm --dir apps/launcher-api exec vite dev`), not in a replica: open/select/backdrop/Escape all exercised, and a measured pass confirms no title or meta crosses its row edge, only the over-long title ellipses, thumbs carry `loading="lazy"`, a run with no render yet draws the checkerboard rather than a broken image, and the list stays inside the viewport with no page scroll. Console clean. The route was deleted afterwards.
- 2026-08-28 — **the video tile's buttons were falling out of the card** (owner report). The footer was ONE flex row holding `#001`, a 16-to-20-digit seed and four controls — about 300px of content in a grid column that bottoms out at `minmax(220px, 1fr)`, so ↻ and 🗑 were pushed clean outside the tile and `overflow: hidden` ate them. Two rows now (identity, then actions), with the seed and the Make-flipbook label allowed to ellipse (`min-width: 0` — without it a flex child refuses to shrink below its content and widens the row instead). Measured, not eyeballed: a harness built from the component's OWN `<style>` block puts the real markup at 220/241/255px and asserts no footer child crosses the card edge — 0px overflow at every width against 70–92px before.
- 2026-08-28 — **a video tile can be re-rolled, deleted, or added to — inside its own session** (owner ask: per-card delete + regenerate, and "generate with the same prompt in the same session, maybe change the prompt and regenerate the same seed"). A session's grid is the unit an author works in — ten rolls of one idea, most thrown away, two chased — so all three actions stay inside it. A re-roll that opened a NEW session would scatter one idea across the dropdown and hide the comparison that is the whole point.
  - **↻ re-rolls one slot in place**, on two independent knobs: hold the SEED and change the prompt (what does one word do to a fixed roll of the dice), or hold the PROMPT and take a new seed (another roll of the same idea). A changed prompt is recorded **on the variation**, never on the session — overwriting the session's prompt would silently relabel the provenance of every other tile in the grid, the same reason `params` records only what the author overrode.
  - **🗑 deletes one variation's render.** The SLOT stays, marked `deleted`, and the grid stops drawing it. Its index is its identity and its filename (`003.webp`), so resequencing the array would rename art underneath a clip already packed from it — new variations therefore number on from the highest index ever used, deleted slots included.
  - **＋ Add appends more rolls to a live session.** (A 36-slot ceiling shipped with this and was removed on 2026-09-03 — see Recent changes.)
  - **The worker now RE-PICKS the lowest pending slot each iteration** instead of walking `variations` once. That is what makes all three work mid-run: a slot armed while a pass is under way is collected by that pass, with no second worker and no second session. It also removes a latent hazard — `＋ Add` mutates the very list the old `for` loop was iterating.
  - `_dispatch` is now the single place a session takes the runner or joins the queue; `start_session`, re-roll and add all go through it, so none of them can invent a different answer to "is the runner free?".
  - Fixtures: four more scenarios (141 checks total) — a re-roll holds the seed and records its prompt on the tile alone, a discard removes the render from R2 *and* staging while leaving indexes alone, an add numbers on past a deleted slot, and a re-roll issued mid-run is picked up by the pass already going. Three `_ACTIVE is None` assertions were also **de-flaked**: a session's status flips terminal a beat before `_release` runs, so they now wait for the hand-off instead of racing it.
- 2026-08-28 — **a clip's WALK is now a per-binding choice on both consumers, not just placed nodes**
  (owner report: reversing a clip in a game meant authoring a second clip). A `flipbook` symbol cell
  gained the `fps`/`direction`/`flipX`/`flipY` block a `FlipbookNode` has had since #515, and the
  precedence itself was pulled into one shared `foldFlipbookPlayback` in `engine-layout`'s
  `registerFlipbooks.ts` — next to the `flipbookPlaybackFrameCount` duplication and for the same
  stated reason, since `engine-layout` must not gain a dependency on `engine-flipbook`. Detail in
  [symbols status](symbols.md); fixture `pnpm --filter flipbook-spike run fold`.
- 2026-08-28 — **a second video prompt QUEUES instead of costing you the first one** (owner report: several sessions with different prompts, expecting them to line up on RunPod; instead an error, a cancelled session, and it kept failing). Four faults compounding, each fixed where it lives:
  - **The runner refused a second session** ("A video session is already running. Wait for it to finish, or cancel it first"), and **the UI offered no way to queue one** — ▶ Generate was *replaced* by ■ Cancel while a session ran, so the only route to a second prompt was killing the first. The tool talked an author into throwing away a paid render. Now `_ACTIVE` owns the runner and `_QUEUE` is the line behind it: a second session is accepted as `queued` with its **place in line**, starts by itself when the GPU frees up, and cancels for free while it waits (nothing has been spent). Cap `MAX_QUEUED_SESSIONS = 4` — the queue is serial so it never raises the burn RATE, but it does extend the tail, and the refusal at the cap names the way out. Sessions still never run in parallel: that IS the spend hazard, and it would lose the warm-model reuse a sequential session is built around.
  - **A cancel was reported as a FAILURE.** `_await_job` checked the stop flag *before* its 3 s sleep and polled *after*, so a cancel landing during the sleep was read back as RunPod's own `CANCELLED` and raised — painting the author's stop as a red FAILED tile with a raw status dict as its "error" (exactly what the owner's screenshot shows on #001). The flag is now re-checked after the sleep, before the poll. A bare remote `CANCELLED` we did NOT ask for still reports, but as a sentence rather than a dict.
  - **A dead worker wedged the tool permanently.** `_ACTIVE` was cleared by a plain assignment at the end of the happy path, so any escape before it — a bad context, a missing `_blueprint` on an adopted doc — left it pinned to a thread that no longer existed and *every* later Generate answered "already running", with no way out short of restarting the container. The hand-off is now a `finally`; a crashed session is closed out with its reason, and `start_session` also steps over a stale `_ACTIVE` whose session is not live.
  - **Cancel now settles a session no worker will ever notice** — one still waiting in line, or one whose thread died — instead of setting a flag nobody reads. Adoption follows the same rule: an orphan found while something else is running joins the queue rather than being dropped, and a session whose blueprint is gone has that verdict **written back**, so the stored doc stops claiming to run.
  - Fixtures: four new scenarios in `test_video_runner.py` — a second session queues and runs on its own, the cap refuses with a way out, a cancel reads as `cancelled` with no error text while still stopping the job remotely, and a worker that throws releases the runner so the next session runs.
- 2026-08-28 — **a video session shows the recipe that made it, and can re-run it** (owner ask): a collapsed recipe panel (prompt, negative, source, variations, changed settings) plus **↻ Use these settings**, which reloads the whole recipe into Generate with no seeds, so the next run is new variations of the same idea. Every field was already in the payload and was being discarded by an under-declared `Session` interface. Detail under Current state — including why only the overrides are shown, and why a missing PARAM and a missing BLUEPRINT are said differently.
- 2026-08-27 — **the video mode's Source image has three sources, not one** (owner ask). One modal, three tabs: the existing proxied `/fsbrowse` (unchanged — it is still the only thing that knows the tool's per-root ref relativization), an **atlas region**, and a **file from the author's computer**. The two new ones are deliberately NOT a fourth file browser: a region is not a file and a local file is not in the project, so each has to become one, and both end in a ref the runner already resolves. Three things this needed, each in the place that owns it:
  - **`(app)/editor/regionCrop.ts`** — crops one region out of its page at NATIVE size, keeping the untrimmed frame and the alpha, straight to a PNG blob. It cannot share `RegionThumb`'s draw call (that one contain-fits into a square preview box), but it shares the geometry contract — untrimmed canvas + packed rect at `offX/offY`, rotated frames stored 90° CW and therefore un-rotated CCW. Verified against the real module in a browser fixture: rotation direction (a marker at the packed rect's top-right lands at `offX,offY`), the trim padding staying transparent, and the untrimmed canvas size — the three things a transcription of that math gets wrong.
  - **`api/flipbook/source-url`** — mints a presigned R2 PUT for `input/refs/flipbook/<name>` and returns the `refs/…` ref in the SAME response, so the key and the ref cannot drift. The bytes never travel through the launcher: adapter-node's `BODY_SIZE_LIMIT` is 512 KB and a symbol crop clears that easily, so a proxied upload would 413 (same reason the font + spine uploaders presign). Names are content-addressed, so re-picking the same region while iterating on a prompt reuses one object instead of piling up near-duplicates.
  - **`_locate_ref_in_staging` now falls back to an exact by-key R2 pull for an `input/`-rooted ref.** Without it the feature could not have worked at all, and the reason is worth keeping: `input/` is mirrored into staging ONCE per process, so a ref uploaded minutes ago is invisible to a container that hydrated before it — the generation would fail with "Reference image not found" naming a path that is provably in R2. The by-key mode already existed for the Sheet-Maker subtrees and writes to exactly the path the `direct` check looks at. This closes the same stale-mirror hole for every input ref, not just Flipbook's.
- 2026-08-27 — **a clip bound to a SYMBOL now shows on the Scene Editor's board** (owner report: symbols were visible in Book of Borut, which uses no clips, and missing on a project that does). The clip, the cell and the ship chain were all correct — the editor's reel preview simply had no `flipbook` branch. Detail in [editor status](editor.md).
- 2026-08-26 — **a placed clip cover-fits a `background` screen** (owner report: it did not fill the window, and was still drag-resizable in the editor). The cover math was fine; its GATE listed `sprite | spine` in five separate places, so the later-added `flipbook` kind reached none of them. Now one exported `isCoverFitKind` / `isCoverArtKind` pair every gate reads — detail in [engine status](engine.md). A clip hand-scaled to fit a background screen must have its `scale.x`/`scale.y` reset to 1, since `scale` is now the STRETCH on top of the cover. Reaching a live game needs a runtime release + reconcile.
- 2026-08-26 — **video mode, steps 0–3**: the serverless-safe `wan22_i2v_flipbook` blueprint, the session runner, the 🎬 mode UI, and video→sheet→clip (detail under Current state). Not yet run on a GPU.
- 2026-08-25 — **A placed clip rendered a STILL FRAME in game — and so, silently, has every flipbook symbol cell since that consumer shipped.** Owner report on `test6`: the flipbook on the background screen shows one frame. Diagnosed live in the running game: the `AnimatedSprite` was on stage with **all 160 frames resolved**, `animationSpeed 0.2`, `loop true` — and `playing: false, currentFrame: 0`.
  - **Cause:** PIXI's `AnimatedSprite.textures` setter ends in `gotoAndStop(0)`. `propsSyncEffect` is ONE `$effect` that re-assigns **every** prop whenever **any** tracked prop changes, so the first unrelated change after mount — alpha, x, a resize, a `loadedAssets` update — re-assigned `textures` and stopped playback. It never restarted, because the `play` effect only re-runs when `play` itself changes, and `play` is a constant `true`. Reproduced live: `sprite.textures = sprite.textures` flips `playing` to `false` synchronously, every time.
  - **Why it survived review:** the failure renders as a still frame, which is indistinguishable from a correctly-drawn one-frame clip. Nothing errors, nothing warns, the node is in the right place at the right size.
  - **Fix:** `textures` leaves `propsSyncEffect`'s sync set (`ignore: ['play','textures']`) and is assigned only when the frame LIST actually changed — a CONTENT comparison, since the upstream array is a `$derived` rebuilt on every recompute — carrying playback across a genuine change. The decision is the extracted pure `framesChanged` (`pixi-svelte/src/lib/animatedSpriteFrames.ts`), following the `shouldApplySpineAnimation` precedent; `packages/pixi-svelte/fixtures/animatedSpriteFrames.fixture.ts` reproduces the old still-frame behaviour AND pins the new one. `LayoutNodeView` also hoists the per-placement clip into a `$derived` so its identity stops churning.
  - **This is an `<AnimatedSprite>` fix, not a scene-node one** — it repairs the Symbols flipbook consumer at the same time. Reaching online games needs a runtime release.
  - **Method note for the next person debugging a live game through a headless browser pane:** the first pass of this diagnosis was WRONG. Readings showed `Ticker.shared` firing 0 times with an empty listener chain, which looked conclusively like "the engine never ticks an AnimatedSprite" — but `document.hidden` was `true`, so rAF was suspended and every rate reading was an artifact. Only the SYNCHRONOUS reads (resolved frame count, `playing`, the textures-setter behaviour) were trustworthy. **In a hidden tab, measure state, never rates.**
- 2026-08-25 — **step 6, Scene Editor half: a clip can be PLACED on a screen.** Library → Flipbooks section → drag → a `flipbook` node that plays live on the canvas and mounts `<Flipbook>` in the game (details under Current state). Two adjacent fixes rode along because the same code was open: `EditorOutline`'s `kindGlyph` was non-exhaustive, so `effect` and `rect` nodes had NO glyph in the outline tree (and the function fell off the end); and `setSpriteSize`'s single-cast to `Record<string, unknown>` was a comparability error that only surfaced once the union widened. The `/flipbook` guide's "no cross-sheet clips" line was also stale — clips have spanned sheets since 2026-07-24.
- 2026-07-24 — **THE actual cause of "one symbol plays another's animation": cross-sheet detection.** `detectSequencesAcross` grouped runs by region-name STEM across every sheet in the project. The Sheet Maker names EVERY sheet's regions `frame_0000…`, so all of a project's symbol sheets landed in ONE stem group with the SAME index range: each sheet's index N broke the run at the next sheet's index N, the only surviving run was an arbitrary tail, and its `primary` — which becomes `clip.assetKey` — could be a **different symbol's sheet**. Clicking the single "Detected animation" offer while looking at the Lotus sheet therefore authored an H4 clip. Measured on 49/30/20-frame sheets: one offer, 20 frames, starting on a scoped Gem frame; on 24+49 sheets the only offer was 49 frames of the OTHER sheet; on two equal sheets, nothing was offered at all. Now the two cases are told apart by the numbering itself — indices **unique** across sheets ⇒ a genuine multipack, merge (the owner's real 4-page 49-frame export is unchanged); any index on **two or more** sheets ⇒ separate animations sharing a naming convention, detect each sheet independently. The `/flipbook` offer list now labels each run by its SHEET (the stem cannot distinguish them), highlights the open sheet's run, and keys the `{#each}` by `primary::firstFrame` (a stem key collided and Svelte dropped rows). Fixture: `pnpm --filter flipbook-spike run sequences`. **Existing clips authored before this are still wrong on disk — re-apply the offer for the right sheet and re-save.**
- 2026-07-24 — **atlas-ref repair now covers BOTH unscopeable forms** (reported on `test1`: symbol H3 "Lotus" played H4's animation while its static sprite stayed correct, and its win line sometimes never appeared). `fe2485d` repaired only a bare manifest BASENAME resolved against `manifests/`; a Sheet-Maker **output prefix** (`…/sheets/S_Lotus/`) and a basename whose manifest lives under a **sheet folder** both slipped through, so `resolveClipFrames` fell to the flat bare-name cache where every sheet's `frame_0000…` collide. `isBareManifestBasename`/`needsAtlasRefRepair` moved into `engine-layout` beside `isManifestAssetKey` (pipeline and runtime can no longer disagree about "scopeable"), and one shared `createAtlasRefResolver` (`manifestBasename.ts`) now serves BOTH the Flipbook (`loadFlipbookDoc`) and Symbols (`canonicalizeSymbolsDocForExport`) ship paths. Fixture: `pnpm --filter flipbook-spike run atlas-ref` reproduces the collision against the real `resolveClipFrames` and proves the repair. Paired engine fix: a DANGLING clip no longer completes on mount — `SymbolFlipbook` holds `MISSING_CLIP_HOLD_MS`, because `winInfo` shows the win line then hides it once the symbols finish, so a same-tick completion drew and cleared the (un-animated by default) line inside one frame and the payline was never seen.
- 2026-07-21 — flipbook clips now feed the LIVE runtime bundle (`assembleRuntimeBundle` runs `exportClips`), so `resolveFlipbook` resolves in the `?runtime=1` authoring preview, not only from a baked bundle. Paired with a `_runtime/lines` runtime release carrying the `SymbolFlipbook` dispatch — without both, a flipbook symbol cell fell through to the Spine renderer (`0853895`).
- 2026-07-21 — trim now flows atlas→manifest→tool so plist-imported frames stop pulsing: RegionThumb honours `offX/offY/origW/origH`, `build_manifest` carries them, and `loadRegionSet` backfills them from the TexturePacker JSON for existing imports.
- 2026-07-20 — step 7: clips travel export→bake→pull→register; dangling clip frames are FATAL at bake.
- 2026-07-20 — step 5: `<Flipbook>` runtime playback seam (`b1d73bf`).
- 2026-07-20 — the `/flipbook` tool + its save/delete endpoints + `docs/tools/flipbook.md`.
- 2026-07-20 — sheet-tool natural sprite ordering (`d7107f4`).
- 2026-07-20 — `FlipbookDoc` schema, canonicalizer, clip registry + fixtures (`54e3e25`).
- 2026-07-20 — dangling FX frame names reported at export (`ee3073a`); dead `loop` flag dropped from the flipbook art binding (`3bf16aa`).
