# Invisible Scene Editor — status

> Design: [docs/design/invisible-editor.md](../design/invisible-editor.md) · Guide: [docs/tools/invisible-editor.md](../tools/invisible-editor.md) · Agent: [`.claude/agents/invisible-components.md`](../../.claude/agents/invisible-components.md) (component system + both editors)
>
> Companion tool: [Component Editor status](./component-editor.md) — this editor **places** component instances; that tool **authors** the `ComponentDef`s.

**One-line state:** Built and in daily use — the full build plan + Templates/Import are on `main`,
and an authored screen (new, reordered, HUD or menu) mounts in the shipped game in Screens-list
order. ⏳ Many render paths are code-verified only; the auth-gated canvas is owner-verified live.

## Current state

Launcher-native, full-page WebGL/canvas layout editor at `/editor` (auth + `editor`-tool gated; SSR off, `load` runs server-side). Project-centric: loads the active project's `scenes.json`, asset library (atlases/spines/sheets/effects/clips), components (+ the project's component defaults), and its game-type template. Layout is written to R2 at `editor/<client>/<project>/scenes.json` on a debounced, ETag-conditional autosave; the engine fetches it at boot (`GET /api/editor/doc`) and renders it via `<LayoutScene>`, falling back to the checked-in `editor-scenes.ts` fixture.

Shipped capabilities on `main`:

- **Screens** — game + HUD lists (reorder, rename, hide, duplicate, delete); per-screen **space** (`game` / `standard` with left/right/top/bottom alignment / `canvas` / `background` cover-fit); **Always on top**, **Behind the reels** and **Zoom with anticipation** ticks; roles (incl. `betMenu` / `autoSpin`, one `SCENE_ROLE_LABELS` list in `engine-layout/sceneRole.ts`); scaffold from a **game kind** (`lines`, `ways` filled; `bookOf`; `cluster`/`scatter` skeleton-only by decision), **import composed reference**, add-missing-screens, "Save as new game kind", "＋ New bet menu / auto spin screen".
- **Every authored screen ships.** `extraMountScenes` / `fullReplaceHudScenes` (`engine-layout/genericMountScenes.ts`) mount author screens the game doesn't reserve, and `sceneLayerZIndex` gives every mount path the Screens-list z; under a screen-driving v2 flow every screen mounts through `<FlowV2Mount>`. Flow owns visibility (no "Shows during" gates).
- **Canvas** — real-texture rendering (live spine skeletons, live FX particles, playing flipbook clips, spine/sprite/flipbook board symbols through one `reelGridGeometry`), zoom/pan/Fit, multi-select, transform handles, snap guides, undo/redo, copy/cut/paste/duplicate. Instances preview through the project's component-defaults sidecar, so the canvas draws what the game draws.
- **Library placement** — Text / Rect / Reel, atlas pages + regions (per-region drag thumbnails), spines (project + `_shared/spines/`, upload), sheet regions, **Invisible FX** effects, **Invisible Flipbook** clips, components.
- **Properties** — transform / tint / **blend** (`normal`/`add`/`multiply`/`screen`/`overlay`/`lighten`, not on spine nodes) / text box (width/height, align, auto-fit) / spine anim + slot fill / **Plays on signal** cues on spine and flipbook nodes (free-text signal here, declared signals in `/components`) / **background cover** (fit cover·contain·width·height, cover scale, align) / **Art bounds** for sprite regions / reel-grid overflow, perspective and ground tiles / node actions. Symbol size is not authored anywhere: symbols contain-fit their cell by their own art.
- **Device layouts** — per-layoutType overrides of transform, blend, visibility, cover fit/scale, text style and component params; per-layoutType **Canvas Size** (the MAIN box the runtime adopts). The bucket set is an authorable **layout profile** (Game Settings → Layout; pipeline default in Admin → Settings); `DEFAULT_LAYOUT_PROFILE` reproduces the legacy four exactly.
- **Game Settings** — per-project boot splash (`bootLoader`), layout profile.
- **Version history** — each save backs up the `scenes.json` it replaces (throttled, newest 20 kept; reference load, Overwrite-with-mine and restore always back up). **History…** opens the shared `$lib/DocHistoryModal.svelte` over `/api/editor/backups`; a restore is ETag-conditional and itself undoable.
- **Concurrency** — conditional autosave (stale ETag ⇒ 409 ⇒ **Reload theirs / Overwrite with mine**, autosave paused); custom kinds and templates are create-only / ETag-guarded.
- **Templates** — template-authoring mode (tag `slotId`s, save `editor/templates/<gameType>.json`) + slot/asset-issue warnings on save.
- **Pipeline** — layout-doc bake + **editor-art export** (`deploy/editor-art/`) travel export→deploy→bake→pull→register; Art bounds ship as TexturePacker trim, component `spine`-param bundles and `_shared/` spines export like placed ones.

## Open items / next

1. **HUD parity gap** — the corner logo/game-name containers still ignore `scale` in-game, so scaling those two corner texts in the editor won't ship.
2. **Animated / book-event content stays coded** — symbols, win-line draws and count-ups mount via the engine `mount`/`bind` escape hatch; the editor only places their anchor and has no book-event playback.
3. **HUD Readout background size** — a width/height override moves the draw but not the instance's selection frame (`nodeBox` doesn't read instance params).
4. **`LayoutDoc.version` is typed `1`** while `editorStorage.ts` writes `DOC_VERSION = 2`; the launcher build doesn't type-check, so this ships green. Widen the type.

## Blocked (owner / external)

- **Rotate `EDITOR_DOC_SECRET`** — it is set on the launcher; rotation is on the owner's security-rotation list ([launcher status](launcher.md)).
- **Live-verify** — interactive feel (undo/redo, copy/paste, multi-select) and the render paths marked ⏳ below build clean; the owner confirms them in the running editor.

## Recent changes

Lessons that recur in this tool, each paid for at least once below: **a new doc field must be added
to its server whitelist** (`normalizeScene`, `normalizeAlign`, `normalizeGameSettings`,
`componentStorage`'s `PARAM_KINDS`, the node-kind set — an unlisted field renders locally and is
silently dropped on save); **the launcher `vite build` is not a type-check** (run `svelte-check`);
**"shows in the editor" ≠ "ships"** (check the export walks the new reference).

- 2026-09-29 — **Docs caught up with the code**: new screens have mounted in the game in list order since the generic-mount work (the old open item said otherwise); `reelGrid.symbolSizeRatios` is long gone (symbols are sized by their art); the guide's pane layout matches the 2026-08-11 shell. `EDITOR_DOC_SECRET` is set; rotation is the owner item.
- 2026-09-29 — **History… uses the shared version-history modal** (#859, live `4f32e773`). The
  backup list moved off the `askText` prompt onto `$lib/DocHistoryModal.svelte`, the picker
  `/flow-v2`, `/symbols`, `/config` and `/components` use (#847/#857). Same `/api/editor/backups`
  API; restore sends this tab's ETag (stale ⇒ 409 in the modal), cancels the pending autosave,
  is refused while a save is in flight, and re-arms autosave if it fails.
- 2026-09-23 — **The bet menu and the auto-spin menu are screens you build here.** Two Screens
  buttons seed the engine defaults (`hudMenuScenes.ts`) tagged with the new `betMenu` / `autoSpin`
  roles (a second press selects the existing one). The role list was hand-copied into three places
  (dropdown, `setSceneRole`, `normalizeScene`'s whitelist) and now derives from one
  `SCENE_ROLE_LABELS`, typed `Record<SceneRole, string>` so a new role is a compile error until
  listed. A repeater's data source is a dropdown (`REPEATER_SOURCE_CATALOG`, custom sources kept);
  a new built-in `optionCard` ("Option Tile") is what a repeater stamps; new Action keys `betMenu`
  / `autoSpinStart` / `close` and four auto-spin readout sources. Engine half in [flow.md](flow.md).
  ⏳ Editor half not browser-verified.
- 2026-09-17 — **The canvas previews instances through the project's component DEFAULTS sidecar.**
  No editor call site supplied `resolveComponentParams`' third layer, so a shared def previewed
  with its own values while the game rendered the project's. `/editor` now loads
  `listComponentDefaults` and threads it into every instance resolve (spine readiness, drawing,
  repeaters, selection box, text/spine layers). No sidecar ⇒ `{}` ⇒ parity.
- 2026-09-17 — **A `standard` screen can be pinned to the TOP of the window.** `top` had never been
  written for the v-axis. Five surfaces learned it; the trap is `normalizeAlign` in
  `editorStorage.ts`, without which `top` renders locally and is dropped on save. `MainContainer`'s
  `getY()` keeps its exact `bottom`/centred expressions (75/75 offline parity assertions). Runtime
  released (`faa176ed`). ⏳ Save round-trip not browser-verified.
- 2026-09-16 → 09-18 — **Blend modes on placed art, and the four traps that took three releases.**
  `BaseNode.blendMode` + per-layoutType override, one definition in `engine-layout/blendMode.ts`
  with a reader per surface (Pixi / Canvas2D / CSS). The editor blends on the ELEMENT: one canvas
  per consecutive blend run carrying CSS `mix-blend-mode`, `.wrap` isolated, scene groups without
  `z-index` (blending inside a transparent surface, or across a stacking context, is a no-op).
  Traps, each now guarded by `check:symbol-layers`:
  (1) **spine can't blend** — `SpinePipe` batches slots with their own blend, so the control is
  withheld via `BLENDABLE_KINDS`/`canBlendKind()` (per-slot blend lives in the Rigger);
  (2) **`overlay`/`lighten` are backdrop-reading filters** — they need our registration AND
  `useBackBuffer: true` in `app.init()`, or `FilterSystem` skips them silently (Pixi logs a warning);
  (3) **Pixi's stock advanced filters treat premultiplied colour as straight**, so partial alpha
  blended much weaker than the editor — we register corrected filters
  (`pixi-svelte/src/lib/advancedBlendModes.ts`) before the `Application` is built, and every
  advanced mode the editor offers must have one;
  (4) **filter vs backdrop resolution** — on a 150%-scaled display the power-of-two roundings
  diverged and the blend covered 75% of the node with a hard seam; fixed by `resolution: 'inherit'`.
  Method: read back a PIXEL against the `normal` baseline, and sweep `resolution`; a filter being
  assigned proves nothing. Owner-confirmed live in `/editor` 2026-09-17.
- 2026-09-16 — **A correctly deployed atlas was served as the OLD art in `/editor`, `/symbols` and
  `/flipbook`.** The 2026-07-14 guard rejected a deployed page whenever the manifest was newer, and
  fell back to an older source page of a different size. A manifest mtime is not evidence the
  geometry changed. `deployedPage.ts isDeployedPageStale` now rejects the deploy only when the
  SOURCE page is also newer than it (`check:deployed-page`, 16 assertions, mutation-verified; the
  reasoning is in the doc comment). Deployed `ed7bf11a`.
- 2026-09-14 — **Background cover: per-axis fit, alignment, per-layout overrides.** `fit` gained
  `width`/`height`; the anchor now slides the fitted art within the overflow (CSS `object-position`
  semantics, one formula in `coverTransform`); `NodeOverride` carries `fit` + `coverScale`, which
  also fixed `backgroundCoverStretch` ignoring a per-ratio stretch. The componentInstance cover is
  threaded inside `coverBoxTransform` so the editor-baked `coverBox` path aligns identically;
  `tools/bg-scene-spike/coverBox.ts` guards the pair. Released `6e59e0fe` (#659), measured parity.
- 2026-09-14 — **Flipbook nodes get "Plays on signal" (a cue picks a clip), rebindable per
  placement** via a **Flipbook (this placement)** panel. The cue's loop is a tri-state select
  (inherit / loop / once) — a checkbox would make "inherit" unreachable. No "fire on complete":
  `<Flipbook>` has no completion hook. ⏳ Not browser-verified.
- 2026-09-09 — **"Plays on signal" renders in the Scene Editor.** The cue block was gated on
  `componentSignals.length > 0`, which `/editor` never passes, so it was dead here. Gate widened
  by `componentMode`: free-text signal in `/editor` (matched on the open component-signal bus, the
  same name a Flow **Fire Cue** broadcasts), declared-signal dropdown in `/components`.
- 2026-09-08 — **Symbol overflow X/Y on the reel grid.** Grows the board's clip only (no cell or
  seat moves); spent whenever nothing is travelling, so Land/Win/Explosion/Intro may spill while
  the roll and a cascade's fall stay clipped. Stepped boards grow at outer edges only. Pinned by
  `scripts/verify-symbol-overflow.mjs`. Engine detail in [engine.md](engine.md).
- 2026-09-08 — **A background screen frames the same overlay in game as in the editor.** The two
  surfaces measured a background `componentInstance`'s cover box differently (the runtime skipped
  spine/text/clip children). The editor now bakes the union it previewed into `node.coverBox`
  (per instance, base bucket only), read first by `LayoutNodeView`. A non-cover node on a
  background screen now uses the shared `anchoredPosition`. By design, cover targets the live
  window in game and the bucket in the editor. Guarded by `tools/bg-scene-spike/coverBox.ts`.
- 2026-09-03 — **The spine preview loader uses ONE runtime (4.2), loaded once**, captured at load.
  Per-line loading let two runtimes race for `window.spine` (`physics is undefined`, blank cells).
  The 4.1 built-ins pose under 4.2 (`scripts/check-builtin-spines.mjs`).
- 2026-09-02 — **Reel-cell spine previews fit the rig's box where its header puts it**
  (`measureSpineBounds` via `authoredSpineBox`), matching `<SpineProvider centreBox>`.
- 2026-09-02 — **The instance-param panel shows the value the game RUNS**, including a def's
  `defaultInstanceParams` seed (`instanceParamEffective`). The raw read drew "On loaded" unchecked
  while the game ran it.
- 2026-09-01 — **A HUD Readout's background is per-instance art** — a Background param group
  (image/tint/width/height) drawn by `HudTicker` from the same param context; the editor reads it
  through a data-driven `TileImageBinding` catalog entry. The stand-in chip uses the real
  `HUD_TILE_WIDTH`/`HEIGHT`.
- 2026-08-28 — **Art bounds for sprite regions** — a per-`<assetKey>::<region>` box stored in its
  own doc (`editor/art-bounds.json`, not the manifest: a packer rewrites manifests, and changing a
  region's trim there re-bases every frozen `.irig` mesh). Ships as trim folded into the exported
  TexturePacker JSON, so no new asset class. One box implementation (`applyClipBounds`) and one
  fit helper (`$lib/boundsFit.ts`); the overlay must share an exactly-sized wrapper with the
  thumbnail or its drag drifts by the stage border.
- 2026-08-27 — **Flipbook-bound symbols draw on the board** (they fell to the amber marker: the
  cell's `assetKey` is the clip's sheet, not a frame). A symbol-kind union widened in
  `symbolsStorage` has to be walked to every surface that switches on it.
- 2026-08-25 — **The Library gained a Flipbooks section.** The doc normalizer's node-kind set now
  derives from `engine-layout`'s `LAYOUT_NODE_KINDS`; a kind missing from it is drawn, then erased
  on save (`pnpm --filter flipbook-spike run scene-node`).
- 2026-08-21 — **A `_shared/spines/` bundle previewed and shipped nothing.** `editorArtExport` read
  the shared skeleton index only for projects with no index of their own; it now uses
  `loadSkeletonIndexWithShared()`. The shared tier carries the engine's 29 Spine bundles, one per
  skeleton ([guide](../tools/invisible-editor.md#the-shared-spine-library)).
- 2026-08-21 — **Perspective board.** "Perspective (advanced)" is SHAPE only (`farScale`,
  `vanishX`); roll-vs-swap behaviour moved to Game Config → Reel behaviour because a `reelGrid` is
  authored per layoutType. `reelGridGeometry()` is the one definition both canvas layers read,
  asserted seat-for-seat against the game (`scripts/verify-reel-grid-geometry.mjs`).
- 2026-08-20 — **`ways` is a first-class kind** — `standardTemplate(gameType)` backs `lines`/`ways`
  and `defaultLayout('ways')` is a filled reference (the two games ship byte-identical frame art;
  ways drops `specialBook`). Lines parity: `pnpm --filter bg-scene-spike run waysreference`.
- 2026-08-20 — **Per-project boot splash** (`GameSettings.bootLoader`); `normalizeGameSettings` is a
  strict whitelist. Detail in [engine.md](engine.md).
- 2026-08-18 — **Board spine symbols draw on the canvas** through the WebGL layer, contain-fit to
  the seat; `measureSpineBounds` moved to `editorSpine.client.ts`. Verified live.
- 2026-08-17 — **Auto-fit works on a width-only box**, and the text-box params
  (`TEXT_BOX_LAYOUT_*`) are shared by Text Box and Info Bar; `mergeBuiltinCodedParams` retrofits
  saved defs. `isTextBoxInstance` requires a text-only def. Released `4a17ed6a` (#329).
- 2026-08-11 — **Shell re-layout**: left = Screens tree with inline outline, right = tabbed
  Properties | Library | Template, action row under the top bar; the canvas top row
  (`.canvas-top`, `z-index:2000`) holds the device bar and actions and wraps instead of overlapping.
- 2026-08-10 — **Per-ratio TEXT STYLE and COMPONENT PARAMS** — `NodeOverride.style` / `.params`,
  merged by `resolveOverrideTextStyle` / `resolveLayoutInstanceParams` on both surfaces;
  structural params stay base-only. Needs a runtime publish to render.
- 2026-07-31 — **Text box model** (`engine-layout/textBoxLayout.ts`): a `width` makes text wrap and
  align inside a box, resize handles change the box (never `scale`), `autoFit` shrinks the font; a
  Text Box component instance's drag writes `boxWidth`/`boxHeight`. `mergeBuiltinCodedParams` also
  unions `paramBindings`, or a frozen saved def shows new params wired to nothing.
- 2026-07-28 — **Coded builtin spines get animation/slot/bone dropdowns** from the generated
  `builtinSpineMeta.generated.ts` (`scripts/gen-builtin-spines.mjs`, pre-commit `--check`).
- 2026-07-23 — **A spine referenced by a component `spine`-kind PARAM ships** (`collectArtRefs`
  walked only placed spine nodes) and its animation dropdowns populate
  (`instancePreviewSpineBundle`).
- 2026-07-20 — **Built-in UI regions resolve everywhere** via `engine-layout/builtinRegions.ts` and
  the launcher's vendored `static/builtin/sheets/`; the dangling-region export warning no longer
  flags engine-shipped art.
- 2026-07-17 — **`screenAnchor` is canvas-space only** — one shared `anchoredPosition` for runtime
  and both editor surfaces (there were three copies, which is how they drifted). Also:
  `freeSpinsRemaining`/`freeSpinsCurrent` readouts (count down or up), an unset boolean param shows
  its default, and `COMPONENT_PARAM_KINDS` / `SYMBOL_STATES` each have one home.
- 2026-07-16 — **Layering** — `Scene.behindReels` (band -500, under the board), `Scene.alwaysOnTop`
  (pinned band), and one resolver `sceneLayerZIndex` for every mount path. `LayoutDoc` v1→v2 with
  an idempotent backfill that pins the splash / legacy celebration screens. Band map low→high:
  authored bg (-1000) → coded bg (-900) → behind-reels (-500+i) → board (0) → list (100+i) →
  pinned (9000+i) → engine gates (10000). Also: authorable `boardGlow` scene.
- 2026-07-16 — **Autosave no longer clobbers a concurrent author** (Phase 1 of
  [multi-user-concurrency](../design/multi-user-concurrency.md)) — verified live with two tabs.
- 2026-07-15 — HUD Readout per-text style and align params; `markDirty()` bumps
  `canvasRedrawNonce` because the redraw effects track a field whitelist + the nonce only.
- Before 2026-07-15 — see [history](../history.md) (FX preview, reel-grid knobs, cover-fit, the
  removal of "Shows during").
