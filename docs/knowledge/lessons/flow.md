# Flow — lessons

What has bitten Flow work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/flow.md](../../status/flow.md); this file only keeps the traps.
A kind change that shipped the old kind's flow (`flow-wrong-kind`):
[game-maker.md](game-maker.md#a-kind-change-shipped-the-old-kinds-flow).

### Publish answered 502 instead of naming the cause
- **Symptom:** Publish failed with an opaque 502; nothing said the flow was the problem.
- **Cause:** `isFlowV2Doc` only proves `graph` is an object, so a half-initialised doc reached the
  export with `graph.nodes` missing and threw inside the bundle build; a thrown or `error()` answer
  surfaces as a 502 and hides why (`apps/launcher-api/src/lib/server/flowV2Export.ts`).
- **Fix:** `isAuthoredFlowV2` checks `Array.isArray(graph.nodes)` and treats such a doc as
  un-authored (pruned). Conflict paths answer `json({ error: 'conflict' }, { status: 409 })`.
- **Guard:** rule, `.claude/agents/pipeline-concurrency.md` checklist item 6. **PR:** not recorded

### A Play Cinematic node did nothing in every game
- **Symptom:** `playCinematic` never played (an awaited one did not wait); a Show node's
  `durationMs` read 0, although the game implemented all three.
- **Cause:** `createFlowV2Env` did not forward `playCinematic` / `stopCinematic` /
  `containerAnimationMs` to the interpreter.
- **Fix:** the factory forwards every capability `runtime.ts` calls.
- **Guard:** `packages/engine-flow-v2/envFactory.fixture.ts` reads `env.*` calls off `runtime.ts`.
- **PR:** not recorded (2026-10-16) · source: `docs/status/flow.md`

### A Branch on a trigger field never took then
- **Symptom:** `meterUpdate → Branch($trigger.full eq 1)` never ran its `then` chain.
- **Cause:** the inspector seeded the literal as `int`; `eq` is strict `===`, so `true === 1`.
- **Fix:** `guardOperandType` / `triggerOwners` (`packages/engine-flow-v2/src/triggers.ts`) type the
  side by its chain's event; a `guard-type-mismatch` warning with a one-click fix.
- **Guard:** `check:flow-guard-types`.
- **PR:** not recorded (2026-10-15) · source: `docs/status/flow.md`

### A live game sat on its background with an empty console
- **Symptom:** a flow screen showed nothing in play; no error anywhere.
- **Cause:** a deleted scene stays in `FlowDoc.containers`; `showContainer` mounted it and
  `<FlowV2Mount>` silently skipped it.
- **Fix:** `containersMissingScene` feeds a game boot error (`flowV2MissingScreens.ts`), a
  `container-scene-missing` warning and a Publish note.
- **Guard:** `containerScenes.fixture.ts`, `flowV2MissingScreens.fixture.ts`, publish-gate §13.
- **PR:** not recorded (2026-10-03) · source: `docs/status/flow.md`

### A kind was authored against the Book-of vocabulary
- **Symptom:** ways, then cluster and scatter projects offered `setExpandingSymbol` and the lines
  symbols, and their seeds were the Book-of flow.
- **Cause:** `templateVocabulary()` falls back to `BOOK_OF_VOCAB` for an unregistered `templateId`,
  and `DRIVEN_SEED_FALLBACKS` handed those kinds the `bookOf` seed (`drivenSeed.ts`).
- **Fix:** each kind registers its own vocabulary and seed. A new kind must too.
- **Guard:** flow-spike `v2vocab` / `v2holdandwin`; `check:flow-publish-gate` per kind.
- **PR:** not recorded (2026-08-20, 2026-10-01) · source: `docs/status/flow-history.md`

### The BET readout had no pin to wire
- **Symptom:** "I can't replace the hard-coded bet submenu": no `onBetMenu` pin on a live project.
- **Cause:** only seeded readouts got `action: 'betMenu'`; an older or palette-dropped readout
  projected nothing. The gate passed because it used its own copy of `projectContainerEvents`.
- **Fix:** `normalizeHudScenes` (engine-layout) gives every bet `hudReadout` the action at load.
- **Guard:** `check:hud-menu-pins` now calls the real `projectContainerEvents`. Gates must call the
  real function, never a copy. **PR:** not recorded (2026-09-30) · source: `docs/status/flow.md`

### A known-red baseline hid a real bug
- **Symptom:** the flow-spike suite carried "6 known reds" for weeks.
- **Cause:** one red was a real bug: the offline translator wired every omitted optional param to
  `$trigger.<param>` (`engine-flow-migrate/src/translate.ts`); others were stale assertions.
- **Fix:** all fixed; every `tools/flow-spike` script runs in `pnpm check:all` (CI `Checks`).
- **Guard:** CI. Never accept a red baseline; fix or delete the check.
- **PR:** not recorded (2026-09-30) · source: `docs/status/flow.md`

### Validating at Publish did not protect players
- **Symptom:** a flow saved invalid after publishing still reached players.
- **Cause:** games booted the live `/api/editor/runtime`, which assembled the currently stored doc.
- **Fix:** players boot the published snapshot; Publish validates the flow that snapshot ships
  (`checkShippedFlowV2`). An invalid autosave reaches only `ie_authoring=1` boots.
- **Guard:** `check:flow-publish-gate`. Details: [game-maker status](../../status/game-maker.md).
- **PR:** not recorded (2026-09-29) · source: `docs/status/flow.md`

### Two wires from one exec-out ran only one
- **Symptom:** an exec-out wired to two nodes silently drove one of them.
- **Cause:** the runtime follows one wire per exec-out (`nextExec` → `graph.exec.find`).
- **Fix:** `exec-out-fanout` error in `validateFlowDoc`; the editor's `addExecEdgeIn` replaces the
  old wire. The fan-in issue key was also fixed (it pointed at two characters).
- **Guard:** flow-spike `v2execfanout`; `check:flow-publish-gate`.
- **PR:** #833 (2026-09-28) · source: `docs/status/flow.md`

### New projects published with no intro, outro or buy cards
- **Symptom:** free-spin intro/outro missing; buy cards never worked on any scaffolded project.
- **Cause:** a project nobody opened in Flow had no stored flow after the coded screens retired
  (#807); `engineOwnedOnly` (engine-layout) dropped `repeater` nodes from the scaffold.
- **Fix:** `projectScaffold.ts` writes `freshDrivenSeedDoc(gameType)`; scaffold keeps repeaters.
- **Guard:** `check:flow-publish-gate` (every built-in kind's scaffold passes its own gate).
- **PR:** #833 (2026-09-28) · source: `docs/status/flow.md`

### One tap skipped the count and dismissed the screen
- **Symptom:** the outro's tap-to-skip landed the total and closed the screen in the same press.
- **Cause:** `<ContinuePressMask>` ran the newest press on any pointer-up, so a press already down
  when an overlay armed counted as a tap on it (also held Space auto-repeat).
- **Fix:** `createPressStarts` (`packages/components-layout/src/pressStarts.ts`): a release counts
  only if its down was seen on that surface after it armed.
- **Guard:** none named. **PR:** #810 (2026-09-28) · source: `docs/status/flow.md`

### Engine values were unreachable from a Branch
- **Symptom:** a guard on "is autoplay live" could not be written; `$engine.balance` errored.
- **Cause:** `linesEngineReader` answered ten scalars nothing declared; the picker and
  `validateFlowDoc` key off the vocabulary, which listed only collections.
- **Fix:** `TemplateVocabulary.values`, transcribed from the reader's key set.
- **Guard:** `linesEngineReader` is typed over `LINES_ENGINE_KEYS` (a compile error on drift).
- **PR:** not recorded (2026-09-23) · source: `docs/status/flow.md`

### A round hung forever on a screen nothing could close
- **Symptom:** the round froze on a held screen with no way out.
- **Cause:** `showContainer{awaitComplete}` blocks the chain and the book pump with no timeout
  (owner decision); the screen had no tap or completion source.
- **Fix:** validator only: `hold-without-release` (error) and `tap-without-hold` (info), fed by a
  `containerTaps` map from the scenes. No runtime timeout, by design.
- **Guard:** `validateFlowDoc`; Publish refuses errors. **PR:** not recorded (2026-09-18)

### Wait for this cue to finish did not wait
- **Symptom:** `fireCue characterSpin` with the wait tick ran straight into the next cue.
- **Cause:** an author-named cue rides the component-signal bus, which has no completion channel;
  `Promise.all([])` settled at once.
- **Fix:** measure the cue: `cueAnimationDurationMs` (`engine-layout/src/lib/cueDuration.ts`).
- **Guard:** none named. A tick the runtime cannot honour must not be offered.
- **PR:** not recorded (2026-09-16) · source: `docs/status/flow.md`

### Turbo greyed out on every seeded project
- **Symptom:** on `test6` the turbo button was always grey and slam-stop dead; SPIN at idle worked.
- **Cause:** the celebration lock in `Game.svelte` read a MOUNTED intro/outro container as a
  PRESENTING one, and the seed mounts both once at start.
- **Fix:** the lock tests each container by what it is presenting, not by mount.
- **Guard:** none named. **PR:** not recorded (2026-09-16) · source: `docs/status/flow.md`

### A flipbook's cues were missing from the Cues palette
- **Symptom:** a frame-animated character could not be fired from the flow.
- **Cause:** `collectSceneCueNames` walked `spine` nodes only; `refResolves` requires the cue in
  `vocab.cues`, so the cue was unauthorable, not just hidden.
- **Fix:** walk both cued kinds. A new cued node kind must be added there.
- **Guard:** none named. **PR:** not recorded (2026-09-14) · source: `docs/status/flow-history.md`

### A splash screen became the game's background
- **Symptom:** a `space:'background'` splash hid in the flow but stayed drawn behind the game.
- **Cause:** `Game.svelte` drew every background-space scene a second time as a persistent backdrop.
- **Fix:** under a driven flow `bgScenes` is empty; the flow owns visibility. Driven projects must
  `showContainer` their background screen or it does not render.
- **Guard:** none named. **PR:** not recorded (2026-09-02) · source: `docs/status/flow-history.md`

### A buy card press committed no bet mode
- **Symptom:** a flow-shown buy card armed `selectBetMode` with `undefined`.
- **Cause:** `registerFlowPress` dropped the `<Repeater>`'s third `payload` arg; a second,
  payload-less `onSelect` pin from the item's `select` signal could also be wired.
- **Fix:** payload forwarded to `resolveFlowV2Press`; `deriveContainerEvents` de-dupes by id.
- **Guard:** none named. **PR:** not recorded (2026-08-05) · source: `docs/status/flow-history.md`

### A rig screen vanished the moment it mounted
- **Symptom:** "rig and FX stopped playing": a screen held by a Delay fed from `durationMs` closed.
- **Cause:** an old runtime or an unmeasurable pin gave the Delay 0/NaN, so it fired at once.
- **Fix:** `resolveDelayMs` (`packages/engine-flow-v2/src/runtime.ts`) falls back to the authored
  literal `ms` floor when the wired value is not finite and positive.
- **Guard:** flow-spike `delayfailsafe`.
- **PR:** not recorded (2026-08-03) · source: `docs/status/flow-history.md`

### A tap in a short window hung the outro
- **Symptom:** the free-spin outro never closed if the player tapped ~300 ms too early.
- **Cause:** `complete()` arrived before `awaitComplete()` registered its hold and was dropped.
- **Fix:** `createContainerMountModel` (`packages/engine-flow-v2/src/mount.ts`) latches a completion
  for containers in `awaitCompleteContainerIds(doc)` only. Signals and holds must be order-free.
- **Guard:** flow-spike harnesses. **PR:** not recorded (2026-07-30)

### Reels missing after tap to start
- **Symptom:** Test1 tapped in to an empty game with no reels.
- **Cause:** a "half-on" flow owned `tapToStart` and showed screens but did not own `load`, so
  `flowV2DrivesScreens` was false and nothing mounted `basegame`.
- **Fix:** `flowScreenDrivingStatus` detects it; `createLinesFlowV2` logs one error and hands
  `load` / `tapToStart` back to the coded path. Seeds now own `load`.
- **Guard:** none named. **PR:** not recorded (2026-07-23) · source: `docs/status/flow-history.md`

### A fresh project's flow edits were silently dropped
- **Symptom:** `/flow-v2` on a new project showed a sample, and every edit was gone on reload.
- **Cause:** autosave was gated on `data.doc !== null`, so nothing ever posted the first save.
- **Fix:** `loadFlowV2DocForEditor` lazy-seeds a starter doc; the save gate follows the resolved
  project scope. Ship paths keep the null-returning `loadFlowV2Doc`.
- **Guard:** none named. **PR:** not recorded (2026-07-23) · source: `docs/status/flow-history.md`

### A free-spin counter showed NaN on the first spin
- **Symptom:** the counter read NaN on spin one, then counted from spin two.
- **Cause:** one `gameSignals` node shows every event's data pins; a pin wired into another event's
  chain reads the firing event's payload, which lacks the field.
- **Fix:** `signal-cross-event` error (a `triggerOwners` walk); container-event pins are own roots.
- **Guard:** flow-spike `v2signalscope`.
- **PR:** not recorded (2026-07-17) · source: `docs/status/flow-history.md`

### The inspector showed a value the doc does not store
- **Symptom:** an optional pin looked "off" while the game ran it "on"; `unfilled-data-in` on pins
  that showed a value; `data-in-shadowed` that no control could clear.
- **Cause:** editors drew a phantom default (`false`, first enum) and stored nothing until changed.
- **Fix:** tri-state `— default —` selects; params carry `optional`; wired pins hide literals.
- **Guard:** flow-spike `v2optional`.
- **PR:** not recorded (2026-07-17, 2026-08-07) · source: `docs/status/flow-history.md`

### Spikes broke while the builds stayed green
- **Symptom:** every flow-spike loading `BOOK_OF_VOCAB` failed; launcher and game built fine.
- **Cause:** `constants-shared` had no `exports` map or `type: module`; Vite guesses, Node does not.
- **Fix:** made it Node-resolvable. A package imported by a tsx harness must resolve under Node.
- **Guard:** the spikes run in `pnpm check:all`.
- **PR:** not recorded (2026-07-17) · source: `docs/status/flow-history.md`

### A save in one tab could write another project's flow
- **Symptom:** risk found in review: switching project in another tab retargeted this tab's save.
- **Cause:** the save route resolves the project from the session; the page loaded from `?project=`.
- **Fix:** the body carries `projectKey`; a mismatch is 409 `scope-mismatch`, and `force` never
  bypasses it (`apps/launcher-api/src/routes/api/flow-v2/save/+server.ts`).
- **Guard:** `check:doc-backups` covers the route. **PR:** not recorded (2026-07-16)

### Reading a flow doc as inert when it is not
- **Symptom:** twice, a session claimed a project's flow "drives nothing".
- **Cause:** the v2 graph is `{nodes, exec, data}`; there is no `edges` field, so
  `graph.edges || []` reads empty. Ownership also comes from wired `gameSignals` pins.
- **Fix:** ask the running game: `window.__IE_FLOW_V2__.ownsEvent(...)`, or use `flowOwnsSignal`.
- **Guard:** rule. **PR:** not recorded (2026-07-16) · source: `docs/status/flow.md`

### A wrong field in a loop crashed or hung the round
- **Symptom:** `o.map is not a function`; `$item.pisition` hung an awaited action forever.
- **Cause:** the validator derived pins per node, blind to the enclosing `forEach` and wired types.
- **Fix:** `deriveGraphPins` (`packages/engine-flow-v2/src/scope.ts`) types loop items and checks
  `$item.<member>`; the canvas, inspector and drop gate share it.
- **Guard:** `validateFlowDoc` (`type-mismatch`, `accessor-unresolved`).
- **PR:** not recorded (2026-07-16) · source: `docs/status/flow-history.md`

### Pressing Spin played the free-spin intro
- **Symptom:** after collapsing a group, Spin triggered the free-spin intro in the game.
- **Cause:** flatten kept group-body node ids that collided with the main graph, cross-wiring edges.
- **Fix:** `expandGroup` renames colliding body ids; `freshNodeIdIn` reserves nested ids;
  `duplicate-id` warning with `dedupeGroupBodyIds` (`packages/engine-flow-v2/src/collapse.ts`).
- **Guard:** flow-spike `v2group`.
- **PR:** not recorded (2026-07-10) · source: `docs/history.md`

### HUD buttons invisible in the game but fine in the editor
- **Symptom:** bet +/- were hoverable but had no art and no action in the deployed remake.
- **Cause:** `<FlowV2Mount>` stacked by `ContainerRef.z` frozen at the v1→v2 migration, which no
  longer matched the Scene Editor's screen order.
- **Fix:** `flowV2Runtime.svelte.ts` re-stamps z from `sceneLayerZIndex(editorDoc.scenes, …)`.
- **Guard:** none named. **PR:** not recorded (2026-07-09) · source: `docs/history.md`

### Flow-wired buttons were silent
- **Symptom:** a HUD button whose press the flow owns made no press sound.
- **Cause:** a flow-owned press skips the button's `onpress`, where the sound was broadcast.
- **Fix:** `registerFlowPress` in `Game.svelte` broadcasts the press sound before dispatch.
- **Guard:** none named. **PR:** not recorded (2026-07-08) · source: `docs/history.md`
