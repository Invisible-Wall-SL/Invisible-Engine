# Components — lessons

What has bitten components work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/component-editor.md](../../status/component-editor.md); this file
only keeps the traps. It covers `ComponentDef`s, the built-ins (`engine-layout`
`builtinComponents.ts`), the Components side of `/editor` and the ship chain (closure → bake →
runtime bundle). Screen-side traps: [editor.md](editor.md).

### A pinned component's segment never shipped
- **Symptom:** the editor drew a counter's first segment; the game drew the default one.
- **Cause:** the closure walked latest defs only, so a component only an older pinned version
  names (`segmentedCounter` v4 → `c_55h9isri`) never reached the bundle.
- **Fix:** `resolveComponentClosureWithPins` (`engine-layout`), called by the bake, the runtime
  bundle and the art export alike. Still open: nested pins draw the latest (status item 2).
- **Guard:** `packages/engine-layout/scripts/test-component-closure.mjs`.
- **PR:** not recorded (2026-10-25) · source: `docs/status/component-editor.md`

### A duplicated end cap drew nothing in game
- **Symptom:** after making end caps with ⧉ Duplicate, the game drew only the middle segment.
- **Cause:** first blamed on the copy, the 0x0 measure, the depth cap or rig layer. Really the game
  was a snapshot published before the copies existed; `ComponentInstance` skips an unknown id.
- **Fix:** a variant with no def falls back to the middle segment and warns once
  (`missingRepeaterVariants`); `resolveComponentClosure` reports misses via `onMissing`.
- **Guard:** `check:component-repeat-segments`. Compare the publish time with the save time first.
- **PR:** not recorded (2026-10-23) · status/component-editor.md · session 014uefTiRepQPj2icdVTrddt

### A counter inside a component rendered no segments
- **Symptom:** a segmented counter nested in another component drew nothing.
- **Cause:** it nested past `MAX_COMPONENT_DEPTH` (then 2, `registerComponents.ts`), and the
  nested instance never got the repeater's `index` / `count`.
- **Fix:** depth raised to 3; all three renderers cut at the same depth (the Component Editor
  counts the open one as a level). Widen it only when a game needs it; the cap is cycle-guarded.
- **Guard:** `check:component-repeat-segments`. A 1-2-3 in game can be an old pin, not the counter.
- **PR:** not recorded (2026-10-23) · status/component-editor.md · session 01PRe8zNYgJiF1wLW4Xm3vfA

### A ticked game default turns off every time
- **Symptom:** a _This game's defaults_ tick "is not getting saved, it turns off every time".
- **Cause:** _Save component_ wrote only the def, not the defaults sidecar (separate `SaveState`);
  and the Screens side kept the page-load defaults, so a saved default still read as off there.
- **Fix:** `saveComponent` also saves dirty defaults; `onDefaultsChange` refreshes the Screens side.
- **Guard:** none dedicated (verified headless over the real `ComponentWorkspace`).
- **PR:** not recorded (2026-10-16) · source: `docs/status/component-editor.md`

### Fix generically through the engine's extension points
- **Symptom:** deleting a coded path to land a new one broke shipped docs that still use it.
- **Cause:** published games bake data the coded path reads (`visibleSource` on Borut's instances,
  the coded `Win` / `Transition` overlays).
- **Fix:** defang, don't gut: stop authoring it, keep the runtime honouring it; land the new path
  as an opt-in (Authored overlays) or a registry (`isComponentMounted`). Deactivate by config.
- **Guard:** the current-games harness ([targets](../targets.md) non-negotiable 1); else review.
- **PR:** not recorded (2026-07-03, 2026-10-01, 2026-10-14) · source: `docs/history.md`

### An older launcher's save erased a component's newer fields
- **Symptom:** fields a newer launcher wrote (state machine, events…) vanished from R2 on save.
- **Cause:** `saveComponent` rebuilt the def from what this build knows.
- **Fix:** the save keeps stored unknown fields per entity, matched by id (`componentFields.ts`);
  a deleted entity is never resurrected. Rule: `docs/conventions/doc-readers.md`.
- **Guard:** `check:save-keeps-unknown-blocks` (components section).
- **PR:** #1185 (2026-10-13) · source: `docs/status/component-editor.md`

### A component param control is missing or does nothing
- **Symptom:** a new coded param never appears on a saved copy; or a picked image changes nothing.
- **Cause:** a saved def is a frozen snapshot; `mergeBuiltinCodedParams` now lists the coded params,
  but a fork that replaced the coded part has no node bound to them, so the control is dead.
- **Fix:** **Expose image as param** (`exposeImageParam`) binds `region`; `unusedPartParamKeys`
  hides params no remaining part reads. If a control does nothing, the node is not bound.
- **Guard:** none dedicated.
- **PR:** not recorded (2026-06-11, 09-01, 2026-10-08) · source: `docs/status/component-editor.md`

### A Hold and Win component copy was offered to every kind
- **Symptom:** a project copy of a kind-gated built-in shows in a lines project's palette.
- **Cause:** `componentStorage` does not persist `ComponentDef.capability`; a saved fork keeps the
  built-in's gate only by its id (`componentOfferedForKind`), so a copy under a NEW id has none.
- **Fix:** none; known behaviour. Palette only: a placed instance always renders.
- **Guard:** `test-hold-and-win-template.mjs` (scene sets only).
- **PR:** #951 (2026-10-01) · source: `docs/status/component-editor.md`

### A shared component's rig shipped as nothing in every other game
- **Symptom:** other games logged `Rig: key "…/bookofborutremake/spines/R_Cage…" is not found`.
- **Cause:** six `_shared/editor-components/` defs named one project's rig by its full prefix; the
  export resolves a bundle only in the reading project or `_shared/spines/`.
- **Fix:** `healForeignRigRefs` re-points at the shared copy, clears a param-bound key, else refuses
  with the promote path. Shared art belongs in `_shared/`; param-ise per-game art.
- **Guard:** the save and promote refusal itself (`componentStorage.ts`); no fixture.
- **PR:** not recorded (2026-09-18) · source: `docs/status/component-editor.md`

### This game's defaults did nothing or lost an edit
- **Symptom:** a per-project default had no effect; two authors' saves silently deleted keys.
- **Cause:** `listComponentDefaults` keyed by `r2Slug(id)` (`hudreadout`) while consumers look up
  `hudReadout`; the client adopted the server ETag but kept local values (a blind overwrite).
- **Fix:** the sidecar stamps the real id (`{ id, params }`); ETag adopted only with the values.
- **Guard:** `check:component-defaults-lookup`; `check:doc-backups`.
- **PR:** #722, #723 (2026-09-17) · source: `docs/status/component-editor.md`

### The instance panel showed a value the game does not run
- **Symptom:** a box read unchecked (or the def's default) while the canvas and game ran it ticked.
- **Cause:** `instanceParamEffective` skipped layers `resolveComponentParams` applies: the def's
  `defaultInstanceParams` seed (2026-09-02), then the project defaults (2026-09-17).
- **Fix:** it mirrors `resolveComponentParams` exactly. One resolver, read by every surface.
- **Guard:** none dedicated.
- **PR:** #723 (2026-09-17) · source: `docs/status/component-editor.md`

### A component conflict answered 502 instead of 409
- **Symptom:** a racing component save showed a server error, not the conflict prompt.
- **Cause:** `componentStorage.ts` threw `ConflictError` without importing it (`ReferenceError`).
  The launcher build is not a type-check.
- **Fix:** imported. Answer conflicts with `json(…, 409)`, never `error()`, which 502s.
- **Guard:** the offline CAS harness of that change; `pnpm check:svelte`.
- **PR:** not recorded (2026-08-04) · source: `docs/status/component-editor.md`

### Never hard-code a game's id, size or tier list
- **Symptom:** a renamed screen, a new id or another game's tiers silently falls back to a default.
- **Cause:** literals in engine code: scene ids in `Game.svelte`, reserved HUD ids, a fixed
  big/super/mega win set, `STANDARD_MAIN_SIZES_MAP` in the Component Editor preview.
- **Fix:** read it from data: `Scene.role`, an instance's `action` / `source`, the config's tiers
  (`winComponentDef(tiers)`), the project's `mainSizesMap`, capability flags (not kind names).
- **Guard:** none; code review. `docs/design/flow-driven-game.md` §8.6 forbids magic ids.
- **PR:** not recorded (2026-06-10, 06-22, 07-01, 2026-08-03) · source: `docs/history.md`

### A new param kind vanished on save
- **Symptom:** a param of a new kind showed in the editor and was gone after save, twice.
- **Cause:** `componentStorage` filtered params by a hand-copied kind list.
- **Fix:** `PARAM_KINDS` derives from `COMPONENT_PARAM_KINDS` (one home in `engine-layout`).
- **Guard:** the derivation; `check:doc-readers-unknown-fields`. Same class:
  [editor.md](editor.md#a-new-screen-field-rendered-then-vanished-after-save).
- **PR:** not recorded (2026-07-17) · source: `docs/status/editor.md`

### The Component Editor previewed in the wrong box
- **Symptom:** a full-screen intro component looked different in game than in the Component Editor.
- **Cause:** the page hard-coded `STANDARD_MAIN_SIZES_MAP` (1920×1080) while the game mounts it in
  the project's main box (Borut 1422×800); canvas nodes without an anchor were game-mapped.
- **Fix:** both editors feed `EditorCanvas` the project's `mainSizesMap`; `canvas` stays raw.
- **Guard:** none dedicated.
- **PR:** not recorded (2026-06-20, 2026-06-22) · source: `docs/history.md`
