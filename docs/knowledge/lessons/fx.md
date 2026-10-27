# FX — lessons

What has bitten FX work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/fx.md](../../status/fx.md); this file only keeps the traps.
It also holds the traps of [Shader Graph](../../status/shader-graph.md),
[Flipbook](../../status/flipbook.md) and [Sound](../../status/sound.md), under their own headings.
The tools-vs-game renderer split is in [symbols lessons](symbols.md); Flow-side FX timing is in
[flow lessons](flow.md).

## Invisible FX, Element FX and particles

### An effect on a symbol state never showed in game
- **Symptom:** "I added an FX to Land and can't see it in game"; a melt-only explosion never played.
- **Cause:** the board returns a symbol to `static` when its land art reports done, and a still
  reports on frame one, so the effect was cut the frame it started; no-art explosions were skipped.
- **Fix:** `stateFxGate` (`apps/lines`) holds the beat for ending `enter` effects
  (`ElementFxPlayer` `ondone`); `symbolStateHasBeat` counts an ending effect as authored.
- **Guard:** `check:element-fx`, `check:symbol-fx`.
- **PR:** not recorded (2026-10-22) · source: `docs/status/fx.md`

### The editor previewed one copy of a nested effect
- **Symptom:** three Pot Meters on a screen previewed one beam, at the last pot; the game drew 3.
- **Cause:** `EditorEffectLayer` keyed emitters by node id, which every placement of a component
  shares; bounds reports kept only the last one.
- **Fix:** placements keyed by id path (`depthKey`); reports stay by node id, unioned with
  `mergeSpreadBoxes`.
- **Guard:** `check:fx-node-params`, `check:depth-segments` §5.
- **PR:** not recorded (2026-10-16) · source: `docs/status/fx.md`

### The editor drew FX in a different order or place than the game
- **Symptom:** FX ignored outline order, covered later art, or sat at the origin (editor only).
- **Cause:** the editor stacks one surface per kind (2D, rig, text, FX), so FX drew over all art;
  rebuilds never re-appended containers; `placement.offset` was not read. The game was right.
- **Fix:** `depthSegments` (`editorCanvas.helpers.ts`), walked into components and groups;
  re-append in tree order; free layers sit at `planLayer(layer).offset`.
- **Guard:** `check:depth-segments`.
- **PR:** not recorded (2026-10-15) · source: `docs/status/fx.md`

### A bone-bound FX turned the opposite way in the game
- **Symptom:** right in `/fx` and the Rigger, wrongly oriented in the exported game.
- **Cause:** `<RigBoneAttach followRotation>` negated a y-up angle on a skeleton RigView already
  poses y-down, so it flipped twice; a draw-slot binding also added the bone angle on top.
- **Fix:** one rule, `boneRotationInParent` (`packages/pixi-svelte/src/lib/rigBoneRotation.ts`),
  used by every bone follower and by `/fx`'s `FxStage`.
- **Guard:** `packages/pixi-svelte/fixtures/rigBoneRotation.fixture.ts` (game angle = Rigger angle).
- **PR:** not recorded (2026-10-15) · source: `docs/status/fx.md`

### A phantom particle burst in the top-left corner
- **Symptom:** an effect fired in place and also, unscoped, at the stage origin.
- **Cause:** `Effects.svelte` auto-mounts every unplaced event effect at (0,0); the "placed" walk
  missed effects bound to a rig (2026-07-13) and effects inside component defs (2026-10-03).
- **Fix:** exclude `rigFxEffectIds()`; one walk, `collectPlacedEffectIds` (engine-layout), over
  scenes and every shipped def, shared by the game and `effectReachability.ts`.
- **Guard:** `packages/engine-layout/scripts/test-placed-effects.mjs`.
- **PR:** not recorded (2026-10-03; found by #1006) · source: `docs/status/fx.md`, `docs/history.md`

### Manual Save overwrote a colleague's newer save
- **Symptom:** Save never asked before overwriting; same on `/symbols` and `/localization`.
- **Cause:** `onclick={saveEffect}` with `saveEffect(force = false)`: the click event arrived as a
  truthy `force`, so the ETag check was skipped.
- **Fix:** `onclick={() => saveEffect()}`.
- **Guard:** `pnpm --filter launcher-api check:event-bound-flags` (Lint workflow).
- **PR:** #821 (2026-09-28) · source: `docs/status/fx.md`

### FX bound on a rig never appeared in game
- **Symptom:** ten `event.fx` keyframes on the big-win rig `R_Wins` drew nothing; the bake was ok.
- **Cause:** `<RiggedEffect>` was mounted by two hand-copied blocks (scene `spine` node and symbol
  rig); ~20 other rig mount sites (win, backdrops, transitions, cinematics) never resolved rig FX.
- **Fix:** `<RigProvider>` mounts bound effects and clips itself, through `rigBoundContent`.
- **Guard:** none named. Baked and correct is not shipped: check every reader of the data.
- **PR:** not recorded (2026-09-04) · source: `docs/status/fx.md`

### An atlas page loaded as null from a query-string URL
- **Symptom:** particle art drew as placeholder dots (2026-07-08); the Tier-B backdrop rig never
  loaded (2026-08-20).
- **Cause:** Pixi's `Assets.load` picks a loader by the URL's extension after dropping the query,
  so `/rig-viewer/file?…&name=x.webp` and `/api/editor/asset?key=…` resolve to `null`.
- **Fix:** `loadPageSource` (fetch → `createImageBitmap` → `ImageSource`). Never `Assets.load` such
  URLs. **Guard:** none named.
- **PR:** not recorded (2026-07-08, 2026-08-20) · source: `docs/status/fx.md`, `docs/history.md`

### Effects ran faster in the game than in the editor
- **Symptom:** authored delays were mis-timed; the game ran effects ~2.34× faster than `/fx`.
- **Cause:** the game stepped emitters by `deltaMS * 0.00234`, the preview by `deltaMS / 1000`.
- **Fix:** one scalar, `DEFAULT_EMIT_SPEED` / `emitterDeltaSeconds`
  (`packages/engine-fx/src/playback.ts`), used by every emitter renderer.
- **Guard:** none named. A new renderer must step through `emitterDeltaSeconds`.
- **PR:** not recorded (2026-08-03) · source: `docs/status/fx.md`

### Rig FX fired on the wrong rigs and drew off-symbol
- **Symptom:** a bullethole fired on every rig with a `gunshots` event; a star effect vanished.
- **Cause:** `RiggedEffect` listened on the shared event bus keyed by bare name, and mounted as a
  sibling of the rig, so it missed the rig's fit transform and was clipped by `BoardMask`.
- **Fix:** listen to the host skeleton's own `AnimationState`; mount under `fxParent` on the rig.
- **Guard:** none named. **PR:** not recorded (2026-07-13) · source: `docs/history.md`

### Online games had no FX while the offline bake did
- **Symptom:** runtime-mode games (`runtime:lines`) showed no placed or rig FX.
- **Cause:** `buildRuntimeBundle` (`runtimeBundle.ts`) omitted `effects` / `rigFx`; only the bake
  (`bake-editor-doc.mjs`) embedded them.
- **Fix:** the bundle calls the same exporters. Any new class must reach both paths (CLAUDE.md
  rule 8). **Guard:** none named; the shader class has `check:shader-pipeline`.
- **PR:** not recorded (2026-07-13) · source: `docs/history.md`

### Particle art missing in game, present in the editor
- **Symptom:** sprite particles never textured in the live game.
- **Cause:** `<ParticleEmitter>` bound `loadedAssets[assetKey]`, but editor-art export registers
  frames under `<assetKey>::<frame>`, so the lookup was `undefined`.
- **Fix:** `EffectLayer.svelte` resolves each frame scoped-then-bare, as `LayoutNodeView` does.
- **Guard:** none named. **PR:** not recorded (2026-07-08) · source: `docs/history.md`

### Save then reopen showed an empty effect
- **Symptom:** a layer authored before binding art was gone after Save.
- **Cause:** `normalizeEffectDoc` (`packages/engine-fx/src/normalize.ts`), run on save, dropped
  layers with no `art.assetKey`: the save normaliser was doing the ship gate's job.
- **Fix:** keep the layer with empty art (renders nothing). Validate at bake, not at save.
- **Guard:** none named. **PR:** not recorded (2026-07-08) · source: `docs/history.md`

## Shader Graph

### A name like proto or toString broke a lookup
- **Symptom:** found in review: a node value `__proto__` set the prototype; `material.params`
  lookups read inherited keys such as `toString`.
- **Cause:** plain objects used as maps over author-chosen names.
- **Fix:** own-key lookups and guarded writes. Treat every author-named key as hostile.
- **Guard:** the step's fixtures. **PR:** #1329 (2026-10-24), #1366 (2026-10-26)

### An effect from a newer launcher drew a broken shader
- **Symptom:** risk: a graph using a step-6 node, played by an older runtime.
- **Cause:** the runtime links the GLSL library from its own copy, which lacks the new entry.
- **Fix:** `readCustomElementFx` drops an effect whose calls it lacks (`unknownEfxCalls`,
  `EFX_HEADER_FUNCTIONS`); it plays nothing. Rollback floor in `docs/design/games-deploy.md`.
- **Guard:** `packages/engine-shadergraph/compile.fixture.ts`. **PR:** #1333 (2026-10-24)

### Deleting a graph lost recent work
- **Symptom:** found in review: delete promised History, but up to 5 minutes of edits were gone.
- **Cause:** autosave backs up at most every 5 minutes; delete did not copy first.
- **Fix:** `deleteDocWithBackup` copies the graph into History before deleting.
- **Guard:** none named. **PR:** #1330 (2026-10-24) · source: `docs/status/shader-graph.md`

### A custom effect a game names shipped as nothing
- **Symptom:** Publish was silent when a graph was deleted or failed to compile; a graph named
  "index" lost its deployed file to the index.
- **Cause:** no check of `custom:<id>` names against the shipped set; the index shared the id space.
- **Fix:** `unshippedCustomKinds` → `shaderEffectsMissing` on Publish and the bake; index is
  `_index.json` and no id starts with `_` (`shaderExport.ts`).
- **Guard:** `check:shader-pipeline` (in `check:all`). **PR:** #1329 (2026-10-24)

## Flipbook

### Unplayed-clip pruning broke the bake
- **Symptom:** gating only the art export left a registered clip with no textures; the bake refused.
- **Cause:** art and clip exports decided reachability separately.
- **Fix:** one rule, `collectPlayedClipIds` (`clipReachability.ts`), shared by both exports.
- **Guard:** the bake's fatal dangling-frame check. **PR:** #645 (2026-09-09)

### A placed clip rendered a still frame
- **Symptom:** a flipbook on a screen (and every flipbook symbol cell) showed frame 0, no error.
- **Cause:** Pixi's `AnimatedSprite.textures` setter calls `gotoAndStop(0)`; `propsSyncEffect`
  re-assigned every prop on any change, so the first unrelated update stopped playback.
- **Fix:** `textures` assigned only when frames change (`framesChanged`,
  `pixi-svelte/src/lib/animatedSpriteFrames.ts`). In a hidden tab, measure state, not rates.
- **Guard:** `packages/pixi-svelte/fixtures/animatedSpriteFrames.fixture.ts`.
- **PR:** not recorded (2026-08-25)

### A new node kind missed gates listed in five places
- **Symptom:** a placed clip did not cover-fit a background screen.
- **Cause:** the cover gate listed `sprite | spine` in five places; `flipbook` reached none of them.
- **Fix:** one exported `isCoverFitKind` / `isCoverArtKind` pair. Grep kind lists for a new kind.
- **Guard:** `packages/engine-layout/scripts/test-cover-fit.mjs`. **PR:** not recorded (2026-08-26)

### One symbol played another symbol's animation
- **Symptom:** the "Detected animation" offer on the Lotus sheet authored an H4 clip.
- **Cause:** `detectSequencesAcross` grouped by region-name stem across sheets; Sheet Maker
  names every sheet's regions `frame_0000…`, so runs from different sheets merged.
- **Fix:** within-sheet and cross-sheet detection told apart; frame refs are atlas-scoped
  (`createAtlasRefResolver`) so a bare `frame_0000` never reaches the flat cache.
- **Guard:** none named. **PR:** not recorded (2026-07-24)

### Fourteen hours of video renders failed on one torn file
- **Symptom:** every BiRefNet cutout failed, whichever model was picked.
- **Cause:** all variants share `models/RMBG/BiRefNet/`; the node rewrites `birefnet.py` on every
  load, and parallel workers tore it on the shared volume.
- **Fix:** weights pre-fetched and checksummed (`fetch-models.py --set rmbg --set birefnet`);
  failed renders name the node and exception.
- **Guard:** none named. **PR:** not recorded (2026-09-04, 2026-09-30)

## Sound

### A newer enum value wiped the sound library
- **Symptom:** risk: one `kind` / `status` / `origin` a newer launcher wrote emptied the library.
- **Cause:** Zod enums failed the parse, the load fell back to empty, and the export pruned
  `deploy/sounds/`.
- **Fix:** a read maps unknown values to defaults and logs; a save still answers 400. Rule:
  `docs/conventions/doc-readers.md` "Unknown enum values".
- **Guard:** `check-doc-readers-unknown-fields`. **PR:** not recorded (2026-10-01)

### A removed sound still shipped in desktop builds
- **Symptom:** superseded files stayed in `static/assets/sounds/` and shipped.
- **Cause:** `sounds` was never in `GENERATED_SUBTREES`
  (`apps/launcher-api/scripts/lib/assetReachability.mjs`), though the status file said it was.
- **Fix:** added. Verify claims with `git log -S`, not with the docs.
- **Guard:** none named. **PR:** not recorded (2026-09-28) · source: `docs/status/sound.md`

### Uploaded music was twice the size it needed
- **Symptom:** a 256 kbps bed (6.84 MB) reached every player.
- **Cause:** nothing looked at an upload's encoding; only a 25 MB size cap existed.
- **Fix:** `audioTranscode.ts` caps the exported copy at 128 kbps, kept only when smaller
  (`KEEP_BELOW`), cached in `sounds/_transcode.json`; uploads are never touched. `wav` is skipped.
- **Guard:** none named. **PR:** #775 (2026-09-23) · source: `docs/status/sound.md`

### A flow volume made later music quiet or did nothing
- **Symptom:** one `soundMusic(theme, 0.3)` re-mixed every later restore; volume `2` did nothing.
- **Cause:** music entries live forever, so `volume ?? sound.soundVolume` made a level sticky;
  howler ignores volumes outside 0..1.
- **Fix:** an unasked firing resets to the row level; `usablePlayVolume` discards out-of-range.
- **Guard:** `packages/utils-sound/banks.fixture.ts`. **PR:** not recorded (2026-09-15)

### Sounds never uploaded and nobody noticed
- **Symptom:** "uploading" showed, then the sounds were nowhere; the 25 MB cap was unreachable.
- **Cause:** the multipart body went through the launcher, which truncates at adapter-node's 512 KB
  `BODY_SIZE_LIMIT`; leaving mid-decode dropped the file with no guard.
- **Fix:** `presignSoundUpload` (browser PUTs straight to R2, like fonts, rigs and flipbooks);
  `beforeNavigate` confirms leaving mid-upload. Large uploads never go through the launcher.
- **Guard:** none named. **PR:** not recorded (2026-09-15) · source: `docs/status/sound.md`

### A sound name was pinned silent for the session
- **Symptom:** a sound that failed once never played, even after its bank loaded; an unknown music
  track silenced the game.
- **Cause:** an unplayable name was stored as `playing` with a null id that never ends; a `soundId`
  is unique only within its own `Howl`.
- **Fix:** resolve the howl before playing (`howlFor`); every stop / fade addresses its own bank.
- **Guard:** `packages/utils-sound/banks.fixture.ts`. **PR:** not recorded (2026-08-26)
