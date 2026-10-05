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
- **Pipeline** — layout-doc bake + **editor-art export** (`deploy/editor-art/`) travel export→deploy→bake→pull→register; Art bounds ship as TexturePacker trim, component `spine`-param bundles and `_shared/` spines export like placed ones, and art picked only in a per-layoutType param override ships too.

## Open items / next

1. **HUD parity gap** — the corner logo/game-name containers still ignore `scale` in-game, so scaling those two corner texts in the editor won't ship.
2. **Animated / book-event content stays coded** — symbols, win-line draws and count-ups mount via the engine `mount`/`bind` escape hatch; the editor only places their anchor and has no book-event playback.
3. **HUD Readout background size** — a width/height override moves the draw but not the instance's selection frame (`nodeBox` doesn't read instance params).
4. **`LayoutDoc.version` is typed `1`** while `editorStorage.ts` writes `DOC_VERSION = 2`; the launcher build doesn't type-check, so this ships green. Widen the type.

## Blocked (owner / external)

- **Rotate `EDITOR_DOC_SECRET`** — it is set on the launcher; rotation is on the owner's security-rotation list ([launcher status](launcher.md)).
- **Live-verify** — interactive feel (undo/redo, copy/paste, multi-select) and the render paths marked ⏳ below build clean; the owner confirms them in the running editor.

## Recent changes
- 2026-10-05 — **Invisible Director can drive this tool.** Invisible Director's `scene.get_layout` /
  `scene.update_nodes` (`apps/launcher-api/src/lib/server/director/ops/scene.ts`) save through
  `editorStorage.saveDoc`, under `If-Match`, stamping `saved_by` (`tool: 'director'`, the agent, the
  run). It moves and re-skins existing nodes only (a project with no layout, an unknown screen or
  node is refused), and refuses any node locked in the editor or bound to the math: the reel grid, a
  repeater, a bet/buy/feature binding on the node, a parent, a child or its component def, and
  anything on the bet-menu, buy-feature, buy-confirm or mode screens. A save without a stamp drops a
  carried one (`savedBy.ts`). The page is unchanged.
- 2026-10-02 — **A param can name a component** (Hold and Win 12c, #1006). A `component`-kind param
  (the Letters Strip's `tile`) is a select of the project's components in Properties, minus the
  instance's own. Detail: [hold-and-win](hold-and-win.md).
- 2026-10-02 — **Swap a placed instance's component** (Hold and Win 12c, #1006). A **component**
  select in an instance's Properties switches the def it draws. It keeps the placement and params,
  and drops the version pin. Example: a Pot Meter to the game's Pot copy. Detail:
  [hold-and-win](hold-and-win.md).

- 2026-10-03 — **Spine param dropdowns follow the active ratio.** With the canvas on a ratio whose
  override swaps a placed component's rig, a `spineAnimation` / `spineSlot` / `spineBone` param
  field still listed the BASE rig's names (`primarySpineBundle` / `effectiveSpineBundle` read
  `node.params` only), though its value saves into that ratio's override. They now read
  `instanceParamValue`, the ratio-aware value the param fields already show. The "Spine (this
  placement)" fields deliberately stay on the base rig (`instanceSpineBoundName`): what they write
  (`spineRestOverrides` / `stateAnimationOverrides`) is per-node and plays in every ratio.
  `scripts/verify-editor-ratio-spine-params.mjs` runs the real resolvers sliced from
  `EditorProperties.svelte`.
- 2026-10-03 — **Art picked in a per-ratio instance override ships** (rule 8). `collectArtRefs`
  (`editorArtExport.ts`) classified only an instance's base `params` by param kind, never
  `overrides[layoutType].params`, which the runtime applies per ratio
  (`resolveLayoutInstanceParams`). A portrait-only `image` pick (the HUD Readout's
  `backgroundImage`; the Hold and Win Phase 12c skins add more) looked right in the editor and
  rendered blank in the portrait game unless another node used the same sheet; a `spine` pick
  shipped no bundle. The export and the ship-path atlas-ref repair (`atlasRefRepair.ts`, which had
  the same blind spot and left a legacy ref in an override unpinned) now walk
  `instanceParamMaps(node)` (`engine-layout/componentParams.ts`), so the Scene Editor's art scope
  sees it too. A pinned instance's params are now classified by its pinned def's kinds, not
  latest's. `check:art-scope` part 6 runs the real `exportEditorArt` and `isProjectArtAllowed`
  over an in-memory R2 and proves all of it.
- 2026-10-02 — **Bind to value** (Hold and Win Phase 12b): the shared Properties panel gains a
  *Bind to value* section (a number drives a node's transform, visibility, fill, clip frame, spine
  scrub or bone), and a test-value scrub previews it on the canvas and the text / spine / effect
  overlays. `nodeTransform` / `childLocalTransform` take an optional resolver; only the draw paths
  pass the preview's, so drags, hit-tests and selection keep the authored transform. Detail:
  [hold-and-win](hold-and-win.md).
- 2026-10-02 — **Measured: no project is broken by an old shared-def pin.** No live doc or
  published snapshot pins `featurecard` (the card arrives at latest). `c_kzdbwen7@11` is pinned by
  `test2`, `test6` and `bookofborutremake`, and its node does still carry Borut's full spine prefix,
  but the node binds `assetKey` to the `rspinbuttonnewSpine` param (non-empty default), so the static
  prefix is unreachable (`staticSpineKeyIsReachable`), and every instance sets that param to the
  project's own spine (`R_spinbutton` in test2, `R_Plus`/`R_Minus`/… in test6), which their
  published snapshots ship with no stranded-spine warning. The open item that said otherwise is
  withdrawn.

- 2026-10-02 — **The shared `featureCard` and spin button draw their spine + font in every
  project.** The open item "cross-project spine/font/flipbook the editor cannot preview" was
  mis-framed: unlike an atlas (which the export copies in), the EXPORT does not ship another
  project's spine, font or clip either, so a preview allowance would have shown art that never ships
  (rule 8). Measured on R2: no shared def names a flipbook clip; the latest `featurecard` names spine
  `R_BuyBonus` + bitmap font `Tungsten-Bold`, and `c_kzdbwen7` (spin button) names
  `R_SpinButtonNew` — all owned only by `bookofborutremake`, so every other project drew them
  missing in the editor AND the game. Fix = put the art in the shared library, which both chains
  already fall back to: the two bundles promoted to `_shared/spines/` and the font to
  `_shared/fonts/` (+ the library's first `fonts.json`). Two code changes make that land:
  **fonts** — a project's renderable fonts are now its catalog MERGED with the library
  (`loadRenderableFonts`, project wins by id/folder) in the editor, Symbols and the export; before,
  the library was read only by a project with NO catalog, the spine bug `loadSkeletonIndexWithShared`
  fixed. The Font Maker keeps its project-else-library catalog (where its writes/deletes land).
  **promote** — `/admin` → promote spine no longer copies `source.json`, which re-linked the
  "snapshot" to the authoring project's sheet (a re-pack there would rewrite the shared copy).
  Fixtures: `check:renderable-fonts`, `check:shared-spine-promote` (mutant-checked). A project picks
  the art up on its next export / publish.

- 2026-10-02 — **A manifest's own fields read R2 only inside its own project (#990 review
  follow-up).** `loadRegionSet` drove R2 reads off author-writable manifest fields with no scope:
  `resolvePageKey` existence-probed `source_image_path` / `export_prefix` candidates and the
  stale-deploy guard HEADed `source_image_path` (a planted manifest could learn whether ANY key
  exists), and `backfillMissingGeometry` read `texturepacker_json` verbatim. Every such read is now
  held to the manifest key's own `<client>/<project>/` (`manifestHome` / `ownedByManifest` in
  `editorRegions.ts`; `_shared/sheets/` for a library sheet, which has no `deploy/`). The page is
  also resolved in the MANIFEST's project, not the caller's: a legacy atlas borrowed from a sibling
  project lost its page, or showed the caller's same-stem deployed page under the other project's
  rects. `loadRegionSet(sheet)` therefore no longer takes the caller's client/project. Nit:
  `candidateAtlases` refuses `_`-rooted keys, so a client slugging to `_shared` can't claim the
  library. `check:art-scope` now runs the real `loadRegionSet` over an in-memory R2 that records
  every key touched (a mutant with the guard off fails 8 cases).

- 2026-10-02 — **Art scope hotfix (#987 follow-up, security).** An atlas PAGE is built from the
  manifest's own fields (`resolvePageKey`), which anyone who can write that project can set: an
  author could plant `<own project>/manifests/atlas_manifest_x.json` whose page named ANY file of
  another project in the client (e.g. its `editor/scenes.json`) and stream it through
  `/api/editor/asset`. A page is now trusted only inside its manifest's own project and only as an
  image (`pageAllowed`), and a manifest only at the producer path
  `<client>/<project>/manifests/atlas_manifest_*.json`. A failed scope rebuild keeps the last good
  scope instead of emptying it. Fixture cases for the planted page.

- 2026-10-02 — **The editor draws art a shared component def brings from another project.** The
  shared `hudReadout` def's frame lives in `invisible_wall/test6`'s `S_UI` atlas and `featureCard`'s
  in `bookofborutremake`'s `S_Game_UI2`, so every project placing them — new or old — drew grey
  "UI_0005_WidgetBig" placeholders: `/api/editor/regions` and `/api/editor/asset` read only the
  project's own prefix + the shared library and 403'd those sheets (the game was fine — the export
  copies them into the project). Both gates now also allow the ATLASES the project's doc and its
  resolved component defs reference (`projectArtScope.ts`, built on the export's own walk,
  `referencedArtRefs`) — only keys shaped like `…/manifests/atlas_manifest_*.json` that load as a
  region set, plus that atlas's page; never an arbitrary `.json`, image or folder a doc names. Held
  to the project's own client, and off for the shared `unassigned` pseudo-client and the default
  project. A scope that cannot be built refuses (403) and is remembered; cached 60 s, re-checked
  at most every 10 s before a refusal so freshly bound art is not refused for long.
  `check:art-scope`. Verified against R2 for `hw-3pots-sample`: `test6`'s `S_UI` + its page and
  `S_Game_UI2` allowed; an unreferenced atlas and another project's `editor/scenes.json` refused.
- 2026-10-02 — **Respin Cell Tiles preview:** selecting a `respinCells` instance draws every reel
  cell as an empty respin cell with the tile (tint, gap) over it (`drawRespinCellTilesPreview`), since
  the respin board exists only in the game.

Lessons that recur in this tool, each paid for at least once below: **a new doc field must be added
to its server whitelist** (`normalizeScene`, `normalizeAlign`, `normalizeGameSettings`,
`componentStorage`'s `PARAM_KINDS`, the node-kind set — an unlisted field renders locally and is
silently dropped on save); **the launcher `vite build` is not a type-check** (run `svelte-check`);
**"shows in the editor" ≠ "ships"** (check the export walks the new reference).

- 2026-10-02 — **The editor follows the PROJECT's game kind, not the layout's.** Reported on
  `hw-3pots-sample` after #972: no Pots screen offered, no Pot Meter in the Components list. Its
  layout was loaded from the lines reference, so `doc.gameType` is `lines`. The client took
  `projectGameType` from `doc.gameType` first, so the kind-gated surfaces (Components palette
  `componentOfferedForKind`, **Add missing screens** `getFullSceneSet`, the Properties symbol
  states, the cross-type load warning) all behaved as lines on a Hold and Win project. Every
  other tool (`/config`, `/symbols`, `/win-text`, the mock, publish) already follows the stored
  project kind. The load now returns `projectKind` (`storedProjectGameType`, `null` for a legacy row
  with none) and the client prefers it. A legacy project with no stored kind keeps the old order
  (doc, then template). Server-side template, slot and config resolution still read `doc.gameType`
  first (unchanged). ⏳ Not browser-verified.
- 2026-10-01 — **In-game view: the canvas draws what the idle game shows.** Reported on
  `hw-3pots-sample`: every screen drew at once (buy cards, confirm dialog, bet menu over the
  board), with labelled "Panel" / "spine: Spine" / "Button ribbon" boxes for Feature Card parts
  that have no art picked. A canvas-toolbar toggle **🎮 In-game view** (on by default, kept per
  project in the editor's UI localStorage) now draws only the screens at rest
  (`engine-layout` `isShownAtRest` / `inGameViewSceneIds`): it drops the transient ids `Game.svelte`
  mounts only for a moment (loading, win visual, free-spin intro/outro/counter, special book,
  Hold and Win beat screens, buy feature/confirm, round confirm, bet menu, auto spin), the
  transient roles (incl. every `mode` screen) and `visibleSource`-gated screens. The edited screen
  is always added. For a mode screen, its mode's non-beat screens are added too. The Screens list
  italicises what it leaves off. In the same view, a NESTED sprite/spine with no art bound
  (empty region and key, or an empty bound spine key) draws nothing instead of its placeholder,
  as in the game. The Component Editor does not pass the prop, so it keeps its placeholders.
  `test-resting-scenes.mjs` pins the at-rest set per kind.
  - **Add missing screens** also fixed: it matched by ROLE, and every Hold and Win feature screen
    shares `role: 'mode'`. So once any mode screen existed, the rest counted as present and were
    never offered. `mode` now matches by id only. Added screens are inserted after their
    predecessor in the kind's own set, not appended (appending put Pots above the HUD).
  - ⏳ Not browser-verified (no launcher login in the session). The placeholders on the HUD
    readouts (`UI_0005_WidgetBig`) and the buy button (`spine: R_BuyBonus`) are a different thing:
    those are real art references the canvas failed to load. They are not diagnosed — the doc and
    R2 were not readable from the session.
- 2026-10-01 — **Hold and Win kind** (#951): "New game from kind → holdAndWin" now scaffolds the real Hold and Win screen set (jackpot bar, pots, the `holdAndWin` mode screens, the base-game message host — see [hold-and-win status](hold-and-win.md)), and the Library's **Components** list is filtered by the project's kind (`componentOfferedForKind`): the seven Hold and Win components appear only in a Hold and Win project. Palette only — a placed instance always renders. Other kinds' scene sets are hash-pinned unchanged (`test-hold-and-win-template.mjs`).
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
