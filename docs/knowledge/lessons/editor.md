# Editor — lessons

What has bitten editor work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/editor.md](../../status/editor.md); this file only keeps the traps.
It covers the Scene Editor (`/editor`), screen timelines ([cinematic](../../status/cinematic.md))
and win text as the game draws it ([win-text](../../status/win-text.md)). Components:
[components.md](components.md).

### A canvas screen ended differently on a wider window

- **Symptom:** a feature intro's curtains met on one PC and left a strip of reels open on another.
- **Cause:** the game drew a `canvas` screen one window pixel per unit; the editor frames it at the
  design box (`LayoutScene`): curtains keyed to 1200 px each met only up to a 2400 px window.
- **Fix:** opt-in `Scene.scaleWithWindow`; new Hold and Win projects get it ticked on intro/outro.
  Ultrawide can still open a strip: key curtains larger and anchor them to the edges.
- **Guard:** `check:canvas-window-scale`, `check:scene-scale-with-window`; repro at 2848x1602.
- **PR:** #1315 (2026-10-25) · source: `docs/status/editor.md` · session 016sy31TWY7BzxzvRsmoEkyX

### A background Rect showed black past 1920 by 1080 in game

- **Symptom:** full-bleed in the editor's Desktop frame, black edges on a bigger window in game.
- **Cause:** the game drew a top-level Rect on a `background` screen at raw window pixels; only
  image, rig, clip and component nodes cover-fitted.
- **Fix:** `coversBackgroundWindow` (`engine-layout/coverTransform.ts`), read by both surfaces.
- **Guard:** `packages/engine-layout/scripts/test-cover-fit.mjs`.
- **PR:** not recorded (2026-10-23) · source: `docs/status/editor.md`

### A rig draws in one place and selects in another

- **Symptom:** a placed rig's art sits far from its selection box (the `R_Widget` reports, ~950 px).
- **Cause:** first blamed on the rig's origin; measuring 23 stock rigs disproved it (frames up to
  1428 px off-centre). Really a second copy of the placement maths: the box centred the Bounds
  size on the origin, the rig layer ignored the anchor on `canvas` screens and the box fit.
- **Fix:** one origin rule (`rigOriginAnchor`) and one mapping (`placedRigTransform`) for both.
- **Guard:** `check:rig-origin-box`. ⊕ Centre origin re-fits an unlocked frame first, or it drifts.
- **PR:** #1270, #1274 (2026-10-20); earlier not recorded · session 01Vy9y2XwRJtbLm115iUxbWX

### A timeline restarted part-way or stuck on frame 0 in game

- **Symptom:** an intro played twice or jumped back when a later intro ended (Wait off); pot
  timelines never moved and the Flow chain after hung.
- **Cause:** `<Cinematic>`'s re-arm `$effect` read reactive state: `time` (every tick re-ran it),
  then `props.doc.id` through entries `<FlowV2Cinematics>` rebuilds when any screen starts or ends.
- **Fix:** the effect reads only `$derived` doc id, start and a per-play `playId`.
- **Guard:** `check:screen-timeline-mounts` (only it rebuilds entries); `check:cinematic-ticker`.
- **PR:** #1316 (2026-10-24); earlier not recorded · session 017TVs6Ky38n1yQQjwGcPyeB

### Base-game art drew over the reels after a timeline

- **Symptom:** after the intro played, the `Reel.png` frame sat on top of the reels all session.
- **Cause:** a keyed remount (`{#key basegameDrive?.key}`) appends the pixi-svelte child last, and
  those layers share the board's parent (`Game.svelte`).
- **Fix:** each keyed mount sits in its own `<Container>`, as `<FlowV2Mount>` already did.
- **Guard:** `check:screen-timeline-mounts` requires the wrapper.
- **PR:** not recorded (2026-10-23) · source: `docs/status/cinematic.md`

### A screen timeline cue never reached an On cue Element FX

- **Symptom:** a `signal:` cue on a screen timeline played nothing; the editor's ▶ fired no cues.
- **Cause:** `FlowV2Cinematics.routeCue` broadcast on the game event bus; `ElementFxPlayer` listens
  on the component-signal bus.
- **Fix:** screen-hosted `signal:NAME` also fires on that bus (`screenCueSignal`); ▶ previews it.
- **Guard:** `check:screen-cue-fx`.
- **PR:** not recorded (2026-10-23) · source: `docs/status/editor.md`

### A placed component looks different in the editor than in game

- **Symptom:** frames looked alike and sat higher in the editor; each tier had its own look in game.
- **Cause:** editor renderers resolved instances by bare id (latest def) while the game draws the
  pinned version; a still rig drew its setup pose, the game its state machine's rest state. Check
  the pin first: a v1 pin under a v5 save looks old in Scene Editor and game alike.
- **Fix:** `instanceDef` + `componentPins.client.ts`; `applyRestingPose`, `restingStateStrip`.
- **Guard:** `check:editor-instance-parity`. When editor and game disagree, suspect the editor.
- **PR:** #1296 (2026-10-22) · source: `docs/status/editor.md` · session 01PRe8zNYgJiF1wLW4Xm3vfA

### A placed component selects a small box in the middle

- **Symptom:** the canvas draws the whole pot, but the selection box is a small rect.
- **Cause:** `nodeBox` walked a def one level; a group or bound part got a fixed or chip box. Same
  class: a HUD Readout's box ignored the instance's background image (2026-10-08).
- **Fix:** one walk (`contentBox` in `editorCanvas.helpers.ts`) unions what each node draws.
- **Guard:** `check:component-content-box`.
- **PR:** not recorded (2026-10-22) · source: `docs/status/editor.md`

### A timeline looked right in the editor and did nothing in game

- **Symptom:** a feature intro, the Pots screen or the base game keyed in Animate never moved in
  game, or a second misplaced copy animated and vanished.
- **Cause:** `createFlowV2Env` dropped `playCinematic`; then the player drew its own copy of the
  host screen instead of the one on stage (screens the game mounts itself were never "up").
- **Fix:** the player drives the shown screen (`driveScreen`, `screenDrives.svelte.ts`).
- **Guard:** `packages/engine-flow-v2/envFactory.fixture.ts`; `check:screen-timeline-mounts`.
- **PR:** not recorded (2026-10-16, 2026-10-21) · source: `docs/status/cinematic.md`

### Svelte-check errors hid real crashes in the baseline

- **Symptom:** `<Cinematic>` threw on every in-game mount; later every `playCinematic` was a no-op.
- **Cause:** svelte-check reported both (`ts:2339`, excess properties), but the errors sat in
  `svelte-check-baseline.json`, so CI stayed green.
- **Fix:** both fixed; baseline lowered. Read new baseline entries; never absorb them blindly.
- **Guard:** `pnpm check:svelte` (ratchet only); the fixtures above.
- **PR:** not recorded (2026-10-01, 2026-10-16) · source: `docs/status/cinematic.md`

### The editor canvas turned white

- **Symptom:** the earliest screens (Background, Base game) vanished under a white sheet.
- **Cause:** each rig, text and FX overlay opened its own WebGL context; past the browser's 16,
  Chrome drops the oldest and paints it opaque white (found in headless Chromium).
- **Fix:** two shared contexts copied into per-overlay 2D canvases (`sharedGl.client.ts`); they
  outlive a layer, so unmount must free its rig instances and textures itself.
- **Guard:** `check:editor-gl-contexts` fails any other editor file that opens a context.
- **PR:** #1254 (2026-10-16) · source: `docs/status/editor.md` · session 018p88xDA43Xw6keRgHkv3HM

### The editor crashed on every load

- **Symptom:** `/editor` threw `Cannot access … before initialization` on load.
- **Cause:** the lease take-over re-arm block read `lease` ~1500 lines above `const lease`.
  `vite build`, `svelte-check` and `check:undefined-names` all pass such a file.
- **Fix:** the block follows `saveState`.
- **Guard:** `pnpm check:svelte-init-order`.
- **PR:** #1190 → #1195 (2026-10-14) · source: `docs/status/editor.md`

### A save from the editor landed in another project

- **Symptom:** (review) a tool-bar click after another tab switched project could save one
  project's layout into another.
- **Cause:** writes named the session's project, not the one the page was loaded for.
- **Fix:** every write names `loadedProjectKey`; routes refuse a mismatch (`scopeMismatch`, 409).
- **Guard:** `check:component-links` (every write `fetch(` pinned); `check:editor-write-scope`.
- **PR:** not recorded (2026-10-13) · source: `docs/status/editor.md`

### Art picked in the editor is blank in the game

- **Symptom:** a sprite, rig, font or portrait-only image shows in the editor, missing in game.
- **Cause:** the editor reads R2 directly; the export walk missed the reference: doc art at all
  (2026-06-10), fonts (06-12), component `spine` params (07-23), `_shared/spines/` (08-21),
  per-ratio `overrides[layout].params` (10-03, `editorArtExport.ts` `collectArtRefs`).
- **Fix:** each walk added; overrides via `instanceParamMaps`. Root rule 8: export → register.
- **Guard:** `check:art-scope` (runs the real `exportEditorArt`); `check:renderable-fonts`.
- **PR:** not recorded (latest 2026-10-03) · source: `docs/status/editor.md`

### The editor behaved as lines on a Hold and Win project

- **Symptom:** no Pots screen offered, no Pot Meter in Components.
- **Cause:** the client took the kind from `doc.gameType`, which a layout loaded from the lines
  reference set to `lines`. Every other tool reads the stored project kind.
- **Fix:** the load returns `projectKind` (`storedProjectGameType`); the client prefers it.
- **Guard:** none dedicated.
- **PR:** not recorded (2026-10-02) · source: `docs/status/editor.md`

### Every authored win text vanished at once

- **Symptom:** the tool, the bake and the runtime bundle all lost every authored template.
- **Cause:** `.strict()` families failed on a field a newer launcher wrote, and the reader fell
  back to `{ version: 1 }`; a newer `version` did the same.
- **Fix:** `normalizeWinTextDoc` strips unknown keys (`stripUnknownKeys`); saves graft them back.
- **Guard:** `check:doc-readers-unknown-fields`; `check:save-keeps-unknown-blocks`.
- **PR:** not recorded (2026-10-01, 2026-10-02) · source: `docs/status/win-text.md`

### A new screen field rendered then vanished after save

- **Symptom:** a new `Scene` field (role, `align: top`, a node kind) draws, then is gone on reload.
- **Cause:** `editorStorage.ts` rebuilds a scene from a whitelist (`normalizeScene`,
  `normalizeAlign`, `normalizeGameSettings`, `NODE_KINDS`); an unlisted field is silently dropped.
- **Fix:** thread every new field through it; lists derive from one source (`LAYOUT_NODE_KINDS`,
  `SCENE_ROLE_LABELS` typed `Record<SceneRole, string>`). Node bodies pass through verbatim.
- **Guard:** per-field round-trip gates (e.g. `check:scene-scale-with-window`); else none.
- **PR:** not recorded (2026-06-24 to 2026-09-23) · source: `docs/status/editor.md`

### A blend looked weaker or seamed in game

- **Symptom:** `overlay`/`lighten` did nothing, partial alpha blended weak, a hard seam at 150%.
- **Cause:** backdrop filters need `useBackBuffer: true`; Pixi's advanced filters treat
  premultiplied colour as straight; filter and backdrop resolutions diverged. Rigs cannot blend.
- **Fix:** `advancedBlendModes.ts`, `resolution: 'inherit'`, `BLENDABLE_KINDS`.
- **Guard:** `check:symbol-layers`. Prove a blend by reading a pixel, not by the filter being set.
- **PR:** not recorded (2026-09-16 to 2026-09-18) · source: `docs/status/editor.md`

### The editor showed the old art after a re-pack

- **Symptom:** after re-pack and deploy, regions were cut wrong or the old picture came back.
- **Cause:** the page pick took the editor's own `deploy/editor-art/` output (2026-06-10), then a
  guard rejected a fresh deploy whenever the manifest was newer (2026-09-16).
- **Fix:** `pickDeployedPage` skips editor-art; `isDeployedPageStale` needs the source page newer.
- **Guard:** `check:deployed-page`.
- **PR:** not recorded (2026-09-16) · source: `docs/status/editor.md`

### A boxed info bar ignored symbol as image

- **Symptom:** the toast printed the symbol's name with `toast.symbolAsImage` ticked.
- **Cause:** a node with `boxWidth` took the `<TextBox>` branch in `LayoutNodeView`, which strips
  the inline image; the localized bar needs the box.
- **Fix:** `<InlineImageText>` honours the box; the inline-image test runs before the box test.
- **Guard:** `packages/engine-layout/scripts/test-inline-image-box.mjs`.
- **PR:** not recorded (2026-08-18) · source: `docs/status/win-text.md`

### The info bar's symbol size did nothing in game

- **Symptom:** `toast.symbolImageSize` at 130% drew the same symbol as 100%.
- **Cause:** `InlineImageText` capped the sized height at the box, and a real bar's plaque is
  shallower than its font, so the 100% symbol already filled it.
- **Fix:** cap the 100% height, then scale: `min(textHeight, contentHeight) × scale`. Test a size
  option where the real bar's limits already bind, not only on a free-standing row.
- **Guard:** `test-inline-image-box.mjs` §7 "130% in a fitted plaque".
- **PR:** not recorded (2026-10-28) · source: `docs/status/win-text.md`

### Every game app's build broke while dev stayed green

- **Symptom:** `vite dev` and the launcher worked; every game app failed to build.
- **Cause:** `engine-layout` imported the rig runtime without declaring it; the launcher declared
  it, so its build resolved it.
- **Fix:** declared at the same pin as `pixi-svelte` (one rig runtime). Declare what you import.
- **Guard:** none dedicated; build the games, not only the dev server.
- **PR:** not recorded (2026-08-17) · source: `docs/status/cinematic.md`

### A setting worked from Game Maker but not from the bake

- **Symptom:** a project that turned the win-symbol replay off shipped it on.
- **Cause:** `winCycle` was carried by `runtimeBundle.ts` but missing from the bake path's
  whitelist (`bake-editor-doc.mjs`).
- **Fix:** added. A new baked-data class must reach both bundle paths.
- **Guard:** none dedicated.
- **PR:** not recorded (2026-07-24) · source: `docs/status/win-text.md`

### Editor and game drifted because placement maths was copied

- **Symptom:** canvas nodes placed, boxed and scaled differently than in game.
- **Cause:** three copies of the `screenAnchor` maths drifted; `nodeTransform` game-mapped a
  `canvas` node with no anchor, which the game draws raw.
- **Fix:** one shared helper per rule: `anchoredPosition`, `reelGridGeometry`, `coverTransform`,
  `aspectBox`; editor and `LayoutNodeView` both call it.
- **Guard:** `scripts/verify-reel-grid-geometry.mjs`, `test-cover-fit.mjs`; else none.
- **PR:** not recorded (2026-06-20, 2026-07-17) · source: `docs/history.md`

### The canvas did not repaint after a Properties edit

- **Symptom:** changing an anchor or param in the panel did nothing on the canvas.
- **Cause:** the redraw effects track a field whitelist plus a nonce, never a deep node mutation;
  the Component Editor passed no nonce at all.
- **Fix:** every panel edit bumps the nonce (`markDirty()` → `canvasRedrawNonce`).
- **Guard:** none. A new edit path must bump the nonce.
- **PR:** not recorded (2026-07-15) · source: `docs/history.md`

### An author screen showed in the editor but not in the game

- **Symptom:** a new HUD screen or the info bar drew in the editor; the game showed a fallback.
- **Cause:** `Game.svelte` mounted scenes by hard-coded id (`infoBar`, `basegame`…); the editor
  mints `hud_…` ids.
- **Fix:** `extraMountScenes` mounts every unreserved screen in list order; identity is
  `Scene.role` (`sceneByRole`), never an id. See [components](components.md) (no hard-coding).
- **Guard:** `test-resting-scenes.mjs`; the generic mount itself.
- **PR:** not recorded (2026-06-19, 2026-06-29, 2026-07-01) · source: `docs/history.md`

### A rig shows in the editor but not in the game

- **Symptom:** a placed rig, or a component's own rig, never loads in game; or draws half size.
- **Cause:** the game looks a rig up by bundle name; `editorArtExport` registered the full R2
  prefix, and the key rewrite skipped component defs. The editor loaded at 1×, the bake at ×2.
- **Fix:** export and defs use `bundleFromAssetKey` / `resolveRigKeysForGame`;
  `EDITOR_RIG_LOAD_SCALE` is shared.
- **Guard:** none dedicated; `check:art-scope` covers the export walk.
- **PR:** not recorded (2026-06-18, 2026-06-29) · source: `docs/history.md`

### A new sheet's art did not reach the game

- **Symptom:** a deployed sheet "didn't ship"; only its uniquely named region showed new art.
- **Cause:** the engine loads every sheet into one map by bare frame name, last loaded wins, and a
  remake sheet reused the old sheet's region names (`assetLoad.ts`, `LayoutNodeView`).
- **Fix:** frames register scoped too (`<assetKey>::<region>`, `editorArtKey.ts`); a sprite tries
  the scoped key first (`fallbackKey`); `image` params store the scoped ref.
- **Guard:** the bake prints `region "X" exists in N sheets` (`bake-editor-doc.mjs`).
- **PR:** not recorded (2026-06-12, 2026-06-17) · source: `docs/history.md`

### HUD rotation was dropped in game

- **Symptom:** a rotated (or free-placed) HUD element looked right in the editor, not in game.
- **Cause:** the HUD bar and corners render through the bespoke `LayoutEditable.svelte`, which
  re-implements placement; `hudPos()` returned no rotation and dropped free nodes.
- **Fix:** rotation and free nodes added. Still open: corner logo and game name ignore `scale`.
- **Guard:** none. Check `LayoutEditable` whenever a transform field is added.
- **PR:** not recorded (2026-06-10, 2026-06-14) · source: `docs/history.md`
