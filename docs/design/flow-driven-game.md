# Flow-driven game — making components fully drivable from Invisible Flow

> Build plan to close the gap between what the component/flow model *can* express and the
> owner's vision: **every component placeable on every screen, exposing its engine
> signals + component params, with the Flow graph driving the whole game** —
> loading screen → tap to enter → basegame → win-driven branching, end to end in a
> shipped game.
> Owner direction 2026-06-30 (review session). Related: `invisible-flow.md` (the runtime
> interpreter + pin model this extends), `invisible-editor.md` (the component/scene model +
> the four-registry `declare ≠ implement` contract), `live-assets.md` (the export→bake→pull→
> register chain every authored doc travels).

## 0. Status

> **Model update 2026-07-01 (supersedes the "exclusive screen swap" framing below).** The
> presentation model is now a pin-driven **active SET**, not a single active screen. A base-game
> screen PERSISTS while overlays layer on top; a screen activates on its Enter pin and removes
> ITSELF on its Complete pin. So `bigWin`/`freeSpinIntro` are no longer an *exclusive swap that
> replaces* `basegame` — they LAYER over the persisting base (a `bookEvent`/`condition` edge adds
> its target on top; a `complete` edge removes its source). The §4 "takeover" mount is now the
> TOPMOST overlay over the still-mounted base, and the reel board gates on the base-game screen
> being active (hidden during `loading`, revealed on its `complete`). See `invisible-flow.md`
> "Progress — pin-driven active-SET model (2026-07-01)" for the engine-core change. Where the
> text below says "exclusive screen"/"swap", read "layered overlay over the persisting base".

**Phases 1–4 BUILT (headless-green + build-shipped, 2026-06-30) — Phase 5+ remain.**
This doc decomposes the gap analysis from the 2026-06-30 review into phases that mirror the
Flow tool's own phase/parity-harness discipline. The review found the data model ~80%
complete; the gaps are concentrated, not diffuse. See the progress notes in §1
(loading→tap→basegame), §2 (win → bigWin/freeSpinIntro branch), §3 (engine-state `condition`
guards), and §4 (the generic exclusive-screen takeover mount). All ride dev-hook fixtures
behind a parity-inert default boot. **The runtime engine story is now complete** — every
trigger kind (bookEvent / complete-tap / condition) is live and any authored screen mounts.
The remaining work is Phase 5 (author real backing scenes + bake + ship a game — the owner's
live/editor checkpoint) and the larger Phases 6–7 (universal per-instance exposure; behaviour
layer). **Phase 6 slice 1 is also done** — the universal `action`/`visibleSource` bindings tray
(any instance clickable / lifecycle-gated regardless of def); see the §6 progress note.

### What already works (the foundation — do not rebuild)
- **Components are reusable prefabs** (`ComponentDef`) placeable on any screen via a
  `componentInstance` node (`engine-layout/src/lib/types.ts:635`, `registerComponents.ts`).
- **The four engine registries are wired at runtime** — value (`source`), action
  (`registerComponentActions`), gate (`visibleSource`), signal (spine cues) — bound at boot
  in `apps/lines/src/components/Game.svelte:274-718`.
- **Scene Editor**: full screen CRUD + a component palette + per-instance param overrides.
- **Flow is built end-to-end**: macro graph + choreography editor + interpreter + the full
  export→bake→register pipeline; `bookEvent` transitions are live at runtime
  (`presentation.ts`, `apps/lines/src/game/utils.ts:30`).

### The three structural gaps (the review's findings)
1. **Flow pins are cosmetic.** `deriveScreenPins` is consumed only by the editor model
   (`flowModel.client.ts:73`); the interpreter never reads pins, and `FlowTransition` is
   screen→screen with no `fromPin`/`toPin` (`engine-flow/src/types.ts:228`). The pin graph
   is a visual/validation projection, not a functional one.
2. **Engine signals/params are exposed per-def, not universally.** An instance can bind
   value/action/gate only if *its def declared* `source`/`action`/`visibleSource`
   (`ComponentInstance.svelte:129,149,198`). The only def-independent instance binding is
   `tapToContinue` (overlays only) — the pattern that should generalize.
3. **Exclusive screen-swapping is special-cased to `basegame`.** Generic *overlay* mounting
   of author-created custom-id screens **shipped** (PR #67, `extraMountScenes` — they mount
   as an always-on layer gated by `visibleSource`, no FlowDoc needed). What is NOT generic is
   the Flow interpreter swapping the **active exclusive screen** for any id beyond `basegame`
   (the mounter / `Game.svelte` z-order is basegame-specific, `invisible-flow.md` Phase-4 B.1).
   Also stale: the Scene Editor still *warns* a new screen "won't ship until wired in code"
   (`editor/+page.svelte:1122-1138`) and the memory note "author HUD screens aren't mounted
   in-game" — both predate PR #67 and need correcting.

### Owner decisions (2026-06-30)
- **Button → flow advance uses the EXISTING tap-to-continue screen for now.** The real
  per-button `action` trigger (functional output pins) is deferred to a later addition —
  build it once the tap-driven flow works end to end. So the near-term "press to enter" leg
  rides `complete`/`signal` edges fired by `TapToContinue.svelte`
  (`flowInterpreterHolder.ts:34,43`), which are already wired at runtime.
- Everything else in the review plan is approved.

### The owner's target flow (the acceptance scenario)
`loading` (tap to enter) → `basegame` → on win, branch to win-presentation → back to
`basegame`, running in a **shipped, baked game** (not just the dev harness). Phases 1–5
below deliver exactly this; Phases 6–7 generalize and harden it.

---

## 1. Phase 1 — Loading as a Flow screen + tap-to-enter (the entry leg)

**Goal:** the loading splash becomes a Flow screen node the author wires, and a tap advances
it to `basegame` via the existing tap overlay — no new trigger mechanism.

- Promote the coded loading splash to a generically-mountable `Scene` (id `loading`,
  `space: 'canvas'`) so the interpreter's mounter owns it instead of the hard-coded
  `LoadingScreen` mount (`Game.svelte:746-763`). Keep the coded splash as the fall-through
  when no FlowDoc authors `loading` (§7 parity invariant from `invisible-flow.md`).
- Author a `loading` screen node (`initial: true`) with a `complete` (or `signal`)
  transition to `basegame`, fired by a tap-enabled overlay instance on the loading screen
  (`tapToContinue` instance param, `tapToContinue.ts:44-47`).
- The asset-load gate stays feed-driven: the tap overlay's prompt is gated on `assetsLoaded`
  (`componentCatalog.ts:111` `VISIBILITY_SOURCE_KEYS`) so "tap to enter" only arms once load
  finishes.

**Parity harness (`tools/flow-spike/`):** with no FlowDoc the coded loading splash mounts
byte-identical; with the `loading`→`basegame` doc, a tap fires `complete` and the mounter
swaps `loading`→`basegame`. Assert the swap runs the loading `exit` then basegame `enter`
choreography in order.

**Deferred (owner):** real per-button `action` trigger — see Phase 8.

### Progress — Phase 1 DONE headlessly + build-shipped (2026-06-30)

Branch `flow/driven-game`. Engine-side only (`apps/lines` + `engine-flow` API already had the
mounter/`completeActiveScreen`/`onActiveScreenChange` surface from prior Flow phases — no
`engine-flow` change needed). No game submodule bump (that's Phase 5).

**What landed:**
- `apps/lines/src/components/Game.svelte` — the live seam. An `activeScreenId` `$state` rune
  (pushed via the interpreter's `onActiveScreenChange` + seeded at boot) replaces the
  non-reactive `flow.activeScreenId` read so the loading→basegame swap actually re-mounts.
  `flowOwnsLoading = flow?.mounter.has('loading')` gates the new path: when the FlowDoc
  authors `loading`, the splash shows while `activeScreenId === 'loading'` and dismisses via
  `flow.completeActiveScreen()` (the tap's `complete` edge → `basegame`); otherwise the coded
  `showLoadingScreen`/`onloaded` flag-flip runs **byte-identical** to `main`. `splashAuthoredScene`
  prefers the interpreter-resolved `loading` scene when owned (shared `stripLoadingAnchor`
  filter), else the coded `authoredLoadingScene`.
- `apps/lines/src/game/flowRuntime.svelte.ts` — `createLinesFlow` gained an optional
  `onActiveScreenChange` passthrough; a new `window.__IE_FLOW_LOADING__` dev hook (checked
  before `__IE_FLOW_LINES__`) sources the fixture. Default boot unchanged ⇒ inert.
- `apps/lines/src/game/flowDoc.ts` — `LINES_FLOW_LOADING_DOC` fixture (`loading` initial +
  `exit` beat → `complete` edge → `basegame` + `enter` beat, reusing `LINES_FLOW_DOC.events`),
  kept **separate** from `LINES_FLOW_DOC` so the default doc stays parity-inert.
- `tools/flow-spike/phase1Loading.ts` (+ `phase1` script) — the parity harness.

**Verified:** `pnpm --filter flow-spike run phase1` = 14/14 GREEN (no-doc + basegame-only-doc ⇒
`loading` NOT interpreter-owned, coded fall-through; loading-doc ⇒ starts on `loading`, tap
fires `complete` → swap to `basegame` running loading `exit` then basegame `enter` in order).
All existing harnesses GREEN (`parity`/`pins`/`roundtrip`/`phase4`/`phase5`/`phase6`/`phase7`/
`tap`/`vocab`). `engine-flow` tsc exit 0; `engine-layout` + `lines` builds exit 0; the
`__IE_FLOW_LOADING__`/`flowLoadingExit` literals confirmed in the minified client bundle
(shipment, not just compile).

**Parity invariant held by construction:** `flowOwnsLoading` is `false` whenever no FlowDoc
authors a `loading` screen — every normal boot, AND the full `LINES_FLOW_DOC` (basegame-only)
— so the coded loading path is untouched.

**Deferred to Phase 4 (as scoped):** the swap is a focused loading↔basegame version — the
above/below-reel z-order split stays `basegame`-specific; the fully-generic any-screen
exclusive swap is Phase 4.

### Update — coded loading path REMOVED, loading is now fully generic (2026-07-01)

The parity-gated dual path above is retired for `apps/lines`/bookof (preproduction — a coded
splash breakage is acceptable, boot must still work generically). **The coded
`<LoadingScreen>` is gone**; loading now mounts ONLY through the flow/scene interpreter:

- `apps/lines/src/components/Game.svelte` — deleted the `LoadingScreen` import, the
  `flowOwnsLoading`/`showLoading`/`flowLoadingMount`/`dismissLoading`/`splashAuthoredScene`/
  `stripLoadingAnchor`/`loadingTransform`/`loadingPos` deriveds, the `onMount`
  `showLoadingScreen = true`, and the whole `{#if showLoading} … <LoadingScreen> … {/if}`
  arm — the game body is now unconditional. The `loading` scene mounts through the GENERIC
  active-screen takeover (the `activeScreenId === loadingScreenId` exclusion was removed);
  `loading` stays in the reserved-scene set so it doesn't also mount as an overlay. `apps/lines/src/components/LoadingScreen.svelte` was DELETED (`TransitionAnimation` kept —
  `Transition.svelte` uses it; `PressToContinue` kept — `TapToContinue`/gates use it).
- `apps/lines/src/game/flowRuntime.svelte.ts` — `createLinesFlow` now SYNTHESIZES a default
  `loading → basegame` FlowDoc (`withDefaultLoadingLeg`) when no authored/baked doc includes
  the role-resolved loading screen, so an un-authored game STILL boots generically (interpreter
  always exists, starts on `loading`, advances on the loading bar's `completeOnLoaded` / a tap).
  An authored doc that already includes loading WINS; an authored doc that omits it gets the
  loading leg PREPENDED (its screens/transitions/events preserved). Synthetic `events: []` ⇒
  book events still fall through to `bookEventHandlerMap`.
- `packages/engine-layout/src/lib/referenceLayouts/{lines,bookof,engineSkeleton}.ts` — the
  `loading` scene's inert `bind: { component: 'LoadingScreen' }` anchor is replaced with a real
  `loadingBar` `componentInstance` (`LOADING_BAR_DEF.defaultInstanceParams` seeds
  `completeOnLoaded: true`). `packages/engine-layout/scenes/bookof.json` regenerated (no more
  `loading-screen`/`LoadingScreen`).
- `tools/flow-spike/phase1Loading.ts` — section A relaxed: it now exercises the engine-flow
  inert-interpreter primitive, noting the coded fall-through it once backed is gone (the game
  synthesizes a default doc). `phase1` harness GREEN; `engine-layout` + `lines` builds exit 0.

Other games (cluster/scatter/price/ways) + their `LoadingScreen.svelte` are UNTOUCHED; the
shared `stateLayout.showLoadingScreen` field stays in state-shared/utils-layout for them.

**Owner-verify live (the one thing headless can't prove — WebGPU bundle):** set
`window.__IE_FLOW_LOADING__ = true` before boot, confirm the splash shows then a tap swaps to
`basegame` (verify via the `app.stage` read / dynamic-import override, not `preview_screenshot`
— it times out on WebGPU). Default boot (no hook) must render byte-identical.

### Follow-up — screen identity by ROLE, not magic id (2026-07-01, branch `feat/flow-screen-identity`)

The original Phase-1/4 code keyed the loading splash and the persistent base scene on the literal
scene ids `'loading'`/`'basegame'` (`Game.svelte` `scenes.find(id==='loading')`,
`mounter.has('loading')`, the takeover exclusion, `RESERVED_SCENE_IDS`). That coupled behaviour to a
magic name — a template- or hand-authored loading scene with a different id (e.g. "Loading / logo")
was not recognized, so the coded splash still ran and the authored scene leaked in as an overlay
(double background, missing logo). **Fix:** an additive `Scene.role` (`'loading' | 'basegame'`,
`engine-layout/src/lib/types.ts`) is the id-independent identity, resolved by
`sceneByRole`/`loadingSceneId`/`basegameSceneId` (`engine-layout/src/lib/sceneRole.ts`) with a
`role → legacy id` fallback. `Game.svelte` resolves loading/basegame + the takeover exclusion +
`reservedSceneIds` through those helpers; a role-tagged custom-id scene is recognized as the splash
AND reserved (no double-mount). The Scene Editor has a per-scene **role** dropdown; `missingScreens`
matches by role-or-id; the lines/bookof reference layouts tag their loading/base scenes. A FlowDoc
still "drives" the screen by authoring that same scene id (`mounter.has(loadingScreenId)`); the flow's
`initial` node was deliberately NOT used as the loading id — the default lines flow's initial screen
is `basegame`, so conflating `initial` with `loading` would misfire. **Parity (§7):** no role + a scene
id'd `loading`/`basegame` ⇒ exactly today's selection (`?? id`), byte-identical. Harness:
`tools/flow-spike/sceneRole.ts` (`scenerole`). Ships to a game via an `engine` submodule bump +
tagging the game's loading scene's role.

---

## 2. Phase 2 — Author win-presentation transitions (the win-branch leg)

**Goal:** a win drives the macro graph, not just per-event choreography.

The mechanism is already live (`bookEvent` trigger + `$trigger.*` guards,
`presentation.ts:123`, `accessor.ts:36`); it is simply **unauthored** —
`LINES_FLOW_DOC.transitions` is `[]` (`apps/lines/src/game/flowDoc.ts:203`).

- **Decision per presentation:** which win moments become **exclusive screen nodes** (a real
  screen swap the flow drives) vs stay **feed-driven overlays** (`visibleSource`, the current
  `flowDoc.ts:189-197` model). Recommended split: keep small/idle win *readouts* as overlays;
  promote big-win / free-spin-intro celebrations that take over the screen to screen nodes.
- Author `bookEvent` transitions (`winInfo`/`setWin`/`freeSpinTrigger`) out of `basegame`,
  optionally guarded on the book-event payload (`$trigger.winLevel` works **today** without
  any engine-reader work) to branch small vs big win.
- Author the return edge (win screen → `basegame`) via `complete` (tap) for now.

**Parity harness:** for each authored win event, assert the transition fires on the matching
book event, the guard selects the right branch by `winLevel`, and the screen swap's
choreography order matches the coded presentation. Default (no transitions) stays inert.

### Progress — Phase 2 DONE headlessly + build-shipped (2026-06-30)

Branch `flow/driven-game`. `apps/lines` only — `engine-flow` already had the `bookEvent` /
`complete` triggers + `$trigger.*` guards from prior Flow phases (no engine change needed). No
game submodule bump (that's Phase 5).

**Per-presentation decisions (the §2 "exclusive screen node vs feed-driven overlay" split):**
- **`winInfo` — feed-driven overlay (NO transition).** It fires on every paying spin and never
  takes over the screen (it is the per-line readout / board symbol highlight), so promoting it
  would swap the screen on every win. It also carries **no `winLevel`** in its payload
  (`typesBookEvent.ts` — only `setWin`/`freeSpinEnd` do), so it could not be win-tier-branched
  anyway. Its event choreography runs in place.
- **`setWin` — split by win tier.** SMALL/MEDIUM wins (`winLevel < 6`, `type:'small'|'medium'`
  in `winLevelMap.ts`) are an idle readout ⇒ stay a **feed-driven overlay** (no swap). BIG wins
  (`winLevel >= 6`, `type:'big'` — BIG/SUPER/MEGA/EPIC/MAX) are a screen-takeover celebration ⇒
  promoted to the **`bigWin` exclusive screen node**, selected by a `$trigger.winLevel in [6..10]`
  guard that resolves **today** off the book-event payload (no engine reader — that is Phase 3).
- **`freeSpinTrigger` — exclusive screen node.** The free-spin intro is a full-screen takeover
  (`uiHide` → `transition` → `freeSpinIntroShow`) ⇒ promoted to the **`freeSpinIntro` exclusive
  screen node**.

**What landed:**
- `apps/lines/src/game/flowDoc.ts` — a SEPARATE `LINES_FLOW_WIN_DOC` fixture (NOT folded into
  `LINES_FLOW_DOC`, which keeps `transitions: []` so the default boot stays parity-inert, §7). It
  authors the `bigWin` + `freeSpinIntro` screen nodes (each `enter` = the coded `setWin` /
  `freeSpinTrigger` presentation **lifted verbatim**), a guarded `basegame→bigWin` `bookEvent`
  edge + an unguarded `basegame→freeSpinIntro` edge, and `complete` (tap) return edges. The crux
  is the **no-double-fire discipline** (§6.1 — dispatch + transition are orthogonal): both win
  events stay **authored** in `events[]` — `setWin` as a `winLevel`-branch (big ⇒ no-op, the
  screen presents; small ⇒ the overlay choreography) and `freeSpinTrigger` as an **authored
  no-op** (NOT dropped — a dropped event falls THROUGH to the coded `bookEventHandlerMap`
  handler, which together with the screen swap's `enter` would double-present).
- `apps/lines/src/game/flowRuntime.svelte.ts` — a `window.__IE_FLOW_WIN__` dev hook (checked
  after `__IE_FLOW_LOADING__`, before `__IE_FLOW_LINES__`) sources the fixture. Default boot
  unchanged ⇒ inert.
- `tools/flow-spike/phase2WinTransitions.ts` (+ `phase2` script) — the parity harness. It drives
  the REAL `createFlowInterpreter` over the REAL imported `LINES_FLOW_WIN_DOC` and reuses the
  Phase-5 recording rig (same effect surface) so the `bigWin`/`freeSpinIntro` enter op log is
  compared position-for-position to the coded `setWin`/`freeSpinTrigger` presentation. It wires
  **coded-handler spies** so the no-double-present invariant is proven (the coded handler must
  NOT fire when the event is authored).

**Verified:** `pnpm --filter flow-spike run phase2` = GREEN (turbo on/off): big-win swaps to
`bigWin` with the lifted presentation and the coded handler does NOT fire; small-win stays on
`basegame` with the overlay in place; `freeSpinTrigger` swaps to `freeSpinIntro` (coded handler
does NOT fire); taps return each screen → `basegame`; the `winLevel` tier boundary (5⇒small,
6⇒big, 10⇒big) selects correctly; default `LINES_FLOW_DOC` authors zero transitions; the win doc
`normalizeFlowDoc` round-trips idempotently. ALL existing harnesses GREEN (`parity`/`phase1`/
`phase4`/`phase5`/`phase6`/`phase7`/`pins`/`roundtrip`/`tap`/`vocab`). `engine-flow` tsc exit 0;
`lines` build exit 0; the `__IE_FLOW_WIN__` / `freeSpinIntro` / `basegame→bigWin` literals
confirmed in the minified client bundle (shipment, not just compile).

**Parity invariant held by construction:** the win-branch behaviour rides ONLY the
`LINES_FLOW_WIN_DOC` fixture (reached only via `__IE_FLOW_WIN__`); the default `LINES_FLOW_DOC`
keeps `transitions: []` and only the `basegame` screen — every normal boot is byte-identical to
current `main`.

**Owner-verify live (the one thing headless can't prove — WebGPU bundle):** set
`window.__IE_FLOW_WIN__ = true` before boot; on a big win the screen swaps to the `bigWin`
takeover and a tap returns to `basegame`, and a free-spin trigger swaps to `freeSpinIntro` (verify
via the `app.stage` read / dynamic-import override, not `preview_screenshot`). A small win must
NOT swap. Default boot (no hook) renders byte-identical. NB: `bigWin`/`freeSpinIntro` have no
authored backing Scene in the lines LayoutDoc yet, so the mounter falls through for the takeover
*scene* — the swap + lifted presentation choreography are what Phase 2 proves; authoring the real
takeover scenes is a Phase-4/5 editor step.

---

## 3. Phase 3 — Revive engine-state transitions (state-driven branching)

**Goal:** branch on live engine state (win level held in state, balance, free-spins
remaining), not only on the book-event payload — the `condition` trigger is currently dead.

- Inject an `engine` reader into `createLinesFlow` so `$engine.*` guards resolve instead of
  returning `undefined` (`flowRuntime.svelte.ts:83-104`, `interpreter.ts:87`). Source it from
  the same value/visibility registries the components read, so there is one source of truth.
- Drive `interpreter.evaluate()` on observed-value changes (subscribe to the relevant
  registry feeds / a per-spin lifecycle tick). Today **no app calls `evaluate()`** — the
  `condition` path can never fire (`interpreter.ts:111`, grep: zero callers).
- Keep guards bounded (the closed comparator set, no scripting VM — `invisible-flow.md`
  §11.4).

**Parity harness:** a `condition` edge guarded on `$engine.winLevel >= 3` fires when the
injected reader crosses the threshold and `evaluate()` is pinged; stays put otherwise. With
no reader injected (default), the path is inert (parity).

### Progress — Phase 3 DONE headlessly + build-shipped (2026-06-30)

Branch `flow/driven-game`. `apps/lines` + one new harness only — no `engine-flow` change needed
(the interpreter/presentation already threaded `engine` to the guard scope; the gap was purely
that no app injected a reader or called `evaluate()`).

**What landed:**
- `apps/lines/src/game/flowRuntime.svelte.ts` — `linesEngineReader`, a CLOSED `(key)→value`
  getter over live state (NOT an expression VM, §11.4): `balance`/`win`/`totalWin`/`bet` (the
  numeric value feeds), `gameType`, `isFreeGame`, `freeSpinsRemaining`/`freeSpinsTotal` — each
  sourced from the SAME state singletons the component registries read, so a guard sees exactly
  what a bound readout/gate sees. Injected via `engine: linesEngineReader` into
  `createFlowInterpreter`. Unknown keys ⇒ `undefined` (the bounded line). New `__IE_FLOW_COND__`
  dev hook → `LINES_FLOW_COND_DOC`.
- `apps/lines/src/components/Game.svelte` — an `$effect` that touches the reader's live values and
  calls `flow?.evaluate()` on any change, so a `condition` edge actually re-checks. Inert when
  `flow` is undefined (no-op `flow?.evaluate()`).
- `apps/lines/src/game/flowDoc.ts` — `LINES_FLOW_COND_DOC` with two `condition` edges guarded on
  `$engine.freeSpinsRemaining` (`gte 1` enter free game / `lt 1` end). The other fixtures unchanged.
- `tools/flow-spike/phase3Condition.ts` (+ `phase3` script).

**Verified:** `phase3` 36/36 GREEN turbo on/off (condition fires only after the reader crosses AND
`evaluate()` is pinged; NO reader ⇒ never fires — the pre-Phase-3 dead state; boundary correctness;
`evaluate()` no-op without a matching edge; bookEvent/complete unaffected; author-order precedence).
ALL existing harnesses GREEN; `engine-flow` tsc exit 0; `lines` build ships
(`__IE_FLOW_COND__`/`freeSpinsRemaining`/`flowFreeGameEnter` in the minified bundle).

**Parity (§7):** no FlowDoc ⇒ `flow` undefined ⇒ the `$effect` is a no-op + the reader is never
reached ⇒ byte-identical to `main`. Injecting the reader is harmless for the Phase-1/2/4 fixtures
(they author no `condition` edge ⇒ `evaluate()` finds nothing).

**Note:** branching on the win-event *payload* (`$trigger.winLevel`) already worked in Phase 2
without this; Phase 3 adds branching on LIVE engine *state* (the `condition` trigger), the
genuinely-new capability.

---

## 4. Phase 4 — Exclusive screen-swapping for any screen (every screen ships)

**Goal:** the Flow interpreter can make *any* author screen the active exclusive screen — not
just `basegame` — closing requirement 1 ("components exist on every screen").

**Already shipped (do not rebuild):** generic *overlay* mounting of author-created custom-id
screens (`genericMountScenes.ts` `extraMountScenes`, PR #67) — they mount as an always-on
layer gated by `visibleSource`, in doc order, no FlowDoc needed.

**Remaining work:**
- Generalize the Flow mounter's exclusive-screen swap (today the `basegame` z-order is
  special-cased: below-reel → board → above-reel, `invisible-flow.md` Phase-4 B.1) so a swap
  to e.g. `loading` or a `bigWin` screen reproduces the right stacking generically. The board
  MainContainer stays engine-owned.
- Preserve the §7 fall-through: a screen with no backing node falls through to the coded
  mount; the default boot is byte-identical.
- **Correct the stale signals**: remove/replace the Scene Editor "won't ship until wired in
  code" warning (`editor/+page.svelte:1122-1138`) and update the "author screens aren't
  mounted in-game" memory note — both predate PR #67.

**Parity harness:** a doc making a non-`basegame` screen active swaps to it with correct
z-order in a built bundle; a doc with only canonical screens is byte-identical to coded
mounting.

### Progress — Phase 4 DONE headlessly + build-shipped (2026-06-30)

Branch `flow/driven-game`. `apps/lines` + one new harness only — no `engine-flow`/`engine-layout`
change needed (the mounter `resolve`/`has`/`authoredScreenIds` surface already existed).

**What landed:**
- `apps/lines/src/components/Game.svelte` — a single GENERIC derived `activeScreenTakeover`
  (`:565`): resolves `flow?.mounter.resolve(activeScreenId)` and returns the scene ONLY when the
  decision is `authored` AND the active id is NEITHER `basegame` (the persistent base, reel-split
  mount) NOR `loading` (the Phase-1 splash). Template (`:1024`, in the `{:else}` game branch, just
  after the `extraScenes` overlay block and before the free-spin gates): `{#if
  activeScreenTakeover}<LayoutScene scene={activeScreenTakeover} />`. So a swap to any authored
  non-base/non-loading screen (`bigWin`/`freeSpinIntro`/future ids) mounts that scene as a
  TRANSIENT top-layer takeover OVER the persisting board (a celebration overlays the reels, not
  replaces them); it unmounts on the swap back. `<LayoutScene>` self-wraps by `space` + honours
  `visibleSource`. NOT per-id casing — one generic gate.
- `tools/flow-spike/phase4Mount.ts` (+ `phase4mount` script; the prior `phase4`/`phase4Runtime.ts`
  left untouched) — proves takeover mount+unmount on swap, base/loading excluded (no regression),
  fall-through for unbacked/non-authored/no-doc ids, and the reservation from `extraMountScenes`.

**Verified:** `phase4mount` GREEN + every existing harness (`parity`/`pins`/`roundtrip`/`phase1`/
`phase2`/`phase4`/`phase5`/`phase6`/`phase7`/`tap`/`vocab`) GREEN; `engine-flow` tsc exit 0;
`engine-layout` + `lines` builds exit 0; the minified gate `==="basegame"||…==="loading"` (the
distinctive `activeScreenTakeover` signature) confirmed in the client bundle (shipment).

**Parity (§7):** no FlowDoc ⇒ `flow` undefined ⇒ `resolve` undefined ⇒ nothing mounts. An
authored-but-unbacked id (apps/lines has no `bigWin`/`freeSpinIntro` backing scene yet) resolves
`fallThrough` ⇒ nothing mounts. Default boot byte-identical to `main`. The mechanism stays inert
until an author adds those scenes (Phase 5/editor).

**Stale-signal cleanup (the §4 "correct the stale signals" item):** updated the Scene Editor's
`addEmptyScreen`/`addHudScreen` comments (`editor/+page.svelte`) — author-created custom-id
screens DO ship now (generic overlay mounting, PR #67; exclusive Flow takeover, this phase), no
per-id code wiring needed; and refreshed the `gotcha_author_hud_screens_unmounted` memory note.

**Deferred:** authoring real lines `bigWin`/`freeSpinIntro` backing scenes (Phase 5 / editor).
**Owner-verify live:** `window.__IE_FLOW_WIN__ = true`, trigger a big win / free-spin → the
takeover scene mounts over the persisting board, a tap returns to `basegame` (verify via the
`app.stage` read, not `preview_screenshot`).

---

## 5. Phase 5 — Ship a real game on a FlowDoc (the end-to-end proof)

**Goal:** the acceptance scenario runs in a **baked, shipped** game. Nothing above is real
until this lands — **no shipped game runs a FlowDoc today** (Borut not authored/baked/bumped;
`invisible-flow.md` §0).

- Author the complete `loading → basegame → win-branch` FlowDoc in the editor for a real
  project (lines reference first, then Borut), bake it (`BakedBundle.flow`, the Phase-6
  pipeline that already exists), and verify the interpreter boots ACTIVE off the baked slot.
- Bump Borut's `engine` submodule once the engine pieces (Phases 1–4) land (owner's mirror
  step; memory: "bump the game's engine submodule yourself").
- Verify on the running WebGPU bundle via the `app.stage` scene-graph read / dynamic-import
  override (memory: `preview_screenshot` times out on WebGPU), not a screenshot.

**Gate:** default boot (no baked flow) byte-identical to `main`; the authored doc drives the
full scenario turbo on/off.

---

## 6. Phase 6 — Universal engine-signal/param exposure on instances

**Goal:** requirement 2 in full — bind value/action/gate/signal on **any** instance,
regardless of what its def declared.

- Generalize the `tapToContinue` pattern (`tapToContinue.ts:36-47` — a def-independent
  instance param surfaced for a whole category) into an **"Engine bindings" tray** on every
  `componentInstance`: an author can attach a value `source`, an `action`, a `visibleSource`
  gate, or a signal binding to any instance, even when the def has no such param. The runtime
  already reads these from resolved params unconditionally (`ComponentInstance.svelte:129,
  149,198`); the missing half is the def-independent *authoring surface* + carrying the
  binding on the instance node.
- **Make signals rebindable per instance** — today a spine `cue` hardcodes `signal:'win'` in
  the def (`types.ts:230`); add an instance-level signal binding so one placement can be
  driven by a different engine signal. `ComponentDef.signals` is currently unused at render
  time — give it a runtime consumer.
- Close the UI-vs-schema gaps the editor review found (all schema-present, no UI):
  `visibleFor` (per-layout visibility), `screenAnchor` (canvas-space edge anchoring),
  custom-param `options` (author-defined enums), `ComponentDef.slots`, and the
  `standard`/`background` component spaces.

**Harness:** an instance with a tray-attached `source` binds the live feed without the def
declaring it; a per-instance signal binding plays a different animation than the def default.

### Progress — Phase 6 slice 1 DONE (the universal `action`/`visibleSource` tray, 2026-06-30)

Branch `flow/driven-game`. The two GENUINELY-universal bindings (the runtime already gates/clicks
the WHOLE instance from these param keys regardless of def): an instance can be made **clickable**
(`action`) or **lifecycle-gated** (`visibleSource`) without its def declaring the param.

**What landed:**
- `packages/engine-layout/src/lib/engineBindings.ts` (NEW, mirrors `tapToContinue.ts`) —
  `ENGINE_BINDING_PARAMS` (shared instance params: `action` opts `ENGINE_ACTION_CATALOG`,
  `visibleSource` opts `VISIBILITY_SOURCE_KEYS`) + `actionBindingOf`/`visibleSourceBindingOf`
  readers. NOT added to any `ComponentDef.params` — they live only on the placed instance's
  `params`. Re-exported from `index.ts`.
- **No merge change needed:** `resolveComponentParams` already ends with `mergeDefined(out,
  instanceParams)` which iterates EVERY instance param key (not just def-declared) — the same
  passthrough `tapToContinue` relies on — and `ComponentInstance.svelte` reads
  `staticParams['action']`/`['visibleSource']` directly. Verified, not assumed.
- `apps/launcher-api/.../editor/EditorProperties.svelte` — an **"Engine bindings"** tray for a
  selected `componentInstance`: an Action dropdown + a "Shows during" dropdown (labels from
  `VISIBILITY_SOURCE_LABELS`, blank = always). **Suppressed** for any param the instance's def
  ALREADY declares (a `button` declares `action`, a `freeSpinCounter` declares `visibleSource`),
  so the universal control never double-surfaces. Writes through the existing `onSetInstanceParam`
  → `node.params` path.

**Verified:** `engine-layout` + `launcher-api` builds GREEN (the launcher build is the typecheck);
a Node fixture against the built `dist` (11/11) proves an undeclared `action`/`visibleSource` passes
through on a def declaring neither, an untouched instance carries no binding keys (parity), and a
def-declared param still wins. **Parity (§7):** an unset binding produces no key ⇒ the runtime reads
`undefined` ⇒ no hit surface / no visibility wrapper ⇒ byte-identical to today.

### Progress — Phase 6 slice 2 DONE (the UI-vs-schema gaps, 2026-06-30)

Branch `flow/driven-game`. THREE editor controls for schema fields that already existed AND were
runtime-honored — purely additive authoring UI, no runtime/resolve change.

- **`visibleFor`** — a "shows on layouts" row (desktop/tablet/landscape/portrait checkboxes) in the
  Transform section, for any node (`EditorProperties.svelte` `setVisibleFor`/`visibleForOn`). Writes
  the BASE node; all-ticked ⇒ `undefined` (sparse). Runtime gate already at `resolveTransform.ts:10`.
- **`screenAnchor`** — x/y inputs (0..1) + left/centre/right + top/centre/bottom presets, shown ONLY
  for a `space:'canvas'` scene (`setScreenAnchor`/`screenAnchorValue`; new `sceneSpace` prop fed by
  the page). Respects the per-layout override path; clears at `{0,0}` (sparse). Runtime applies it at
  `LayoutNodeView.svelte:65`.
- **Custom-param `options`** — a comma-separated "options" input in the Component Editor's "Your
  params" (`components/+page.svelte` `setParamOptions`) for `kind:'string'` author params; sets/clears
  `param.options`. `paramField` ALREADY dropdown-renders a param with `options` (confirmed, no change),
  so a placed instance gets a dropdown automatically.

**Verified:** `pnpm --filter launcher-api build` GREEN (the typecheck). **Parity:** every writer is
sparse — an untouched node/param never gains the key, so it serializes byte-identical and the
runtime stays inert. engine-layout untouched.

### Progress — Phase 6 slice 3 DONE (per-instance signal rebinding, 2026-06-30)

Branch `flow/driven-game`. Lets a placed `componentInstance` override WHICH engine signal drives a
spine cue — so two placements of one component can react to different signals (`win` vs `bigWin`).
Mirrors the existing per-instance spine-override precedent (`spineRestOverrides`/
`stateAnimationOverrides`, keyed by spine node id) exactly.

- **Type** — `ComponentInstanceNode.cueSignalOverrides?: Record<string, Record<string, string>>`
  (`types.ts:349`): outer key = spine node id in the resolved def `root`, inner = cue's original
  signal → replacement engine-signal key.
- **Runtime** — `ComponentInstance.svelte:229`: in the `signalToTargets` walk, each cue's signal is
  remapped through `node.cueSignalOverrides?.[n.id]?.[cue.signal] || cue.signal` BEFORE the
  subscription, so it listens on the override signal. No context plumbing needed (the cue
  subscription is built where the instance `node` is already in scope). Absent ⇒ def signal verbatim.
- **Editor** — `EditorProperties.svelte`: a per-cue "Driven by signal" dropdown (options
  `ENGINE_SIGNAL_CATALOG`, blank = inherit the def signal) in the existing "Spine (this placement)"
  panel; sparse writer in `editor/+page.svelte` (prunes empty maps → `undefined`).
- **Round-trip** — no normalize change needed: `editorStorage.ts` `normalizeNode` is pass-through
  (`return input as unknown as LayoutNode`), the same mechanism `spineRestOverrides` already rides.

**Verified:** `engine-layout` + `launcher-api` builds GREEN; a headless fixture (guarded against
drift from the shipped line) proves the override remaps only the listed cue, an un-overridden
instance keeps the def signal (parity), and the field survives the `normalizeNode` round-trip.
**Parity (§7):** absent override ⇒ `|| cue.signal` yields the def signal ⇒ subscriptions byte-identical.

**Remaining for Phase 6:** `value`/`signal` universal binding (needs a def node to consume them) and
the `def.slots` / component-`space` UI gaps.

---

## 7. Phase 7 — Behaviour layer + open catalog (the long tail)

**Goal:** the remaining "declare ≠ implement" debt — not needed for the acceptance scenario,
but needed before Flow can express *all* presentation without coded `effect` nodes.

- The Component Editor authors only the *declare* half today (params/signals as metadata);
  the **behaviour/timeline layer** (`ComponentDef.tracks`, reserved) — signal-triggered
  tweens, count-up bindings, particle bursts — is unbuilt (`component-editor.md` §"Known
  limitations"). This is the large v2 the editor design intentionally deferred.
- The engine catalog (`componentCatalog.ts`) is closed + code-owned: new value/action/gate/
  signal keys require editing the catalog *and* every game's `registerComponent…`. A
  data-driven catalog (export each game's vocabulary as data — the Phase-7 emitter-vocab work
  in `invisible-flow.md` is the precedent) would let authors add bindings without a code edit.

---

## 8. Functional action pins — Base game as the intent hub

Per the owner's 2026-06-30 decision this was deferred until the tap-driven flow worked; the
tap path (`signal` trigger) now ships, so this is the **next Flow slice** (design decided
2026-07-02, owner picks: intent pins live **on Base game**; ship **Spin only, end-to-end**
first). It closes the gap the owner named: *"my base game has no input/output — I'd expect a
`spin` input pin that my HUD spin button's output wires into, and so on for every action."*

### 8.1 The gap today

A bound button already derives an **`action` output pin** (`pins.ts` → `derivePinsFromNodes`,
from its `registerComponentActions` param), and it renders as a right-side handle
(`FlowScreenNode.svelte`). But it is **cosmetic**: the `FlowTrigger` union (`types.ts:230`) has
no `action` kind, and `/flow`'s `onConnect` (`+page.svelte`) mints a blank `bookEvent` edge from
it — the "this is a spin" meaning is lost, and nothing at runtime consumes it. Base game shows
only `Enter`/`Complete`/`Active` because its scene carries **no bound components** (the reel
board is engine-owned) — so today it derives no extra pins at all.

### 8.2 The model — intent *input* pins, symmetric to action *output* pins

Two pin categories, wired end to end:

- **Action output pin** (exists): a button instance's `action` param → an `out` pin on the
  screen that *owns the button* (e.g. the HUD screen's Spin button).
- **Intent input pin** (new): the game's registered action **vocabulary** → an `in` pin on the
  **intent-host screen** (Base game). One input pin per game intent: `Spin`, `Stop`,
  `BuyBonus`, `ChangeBet`, `Autoplay`, … derived from the same `registerComponentActions`
  registry the coded `spin` action already lives in (`Game.svelte`).

Authoring: drag **button `action` → base-game `Spin` input**. Runtime: when that wire fires,
the interpreter invokes the intent — which for `spin` is exactly today's coded path
(`context.eventEmitter.broadcast({ type: 'bet' })` → `EnableGameActor` → XState `BET` →
`requestBet`). So a wired Spin pin *is* the existing spin, just author-routed instead of
hard-coded in `ButtonBetProvider`.

This is the same shape as the shipped tap-to-continue path (`signal` trigger + `emitSignal` +
`completeActiveScreen` + `flowInterpreterHolder`), scoped to a button's `action` pin instead of
a screen-wide tap. It is the precedent to copy, not a new subsystem.

### 8.3 New `FlowPinRole` — `intent` (input)

Add `intent` to `FlowPinRole` (`types.ts:156`), direction `in`. Unlike the four component-derived
roles, an intent pin is **not** projected from a node in the scene — it is projected from the
**game's action vocabulary**, attached to the intent-host screen. Structural-style stable id
`${screenId}::intent:${actionKey}` so a wire survives relabels. Derivation lives next to the
structural pins in `deriveScreenPins` (`pins.ts:162`), gated on "is this the intent host"
(§8.6).

### 8.4 New `FlowTrigger` — `{ kind: 'action'; pin; intent }`

Extend the union (`types.ts:230`):

```ts
/** A flow-bound button's action pin fired. `pin` is the SOURCE action KEY (`'spin'`, not the
 *  instance-scoped pin id — `registerComponentActions` shares one action across every button
 *  instance); `intent` is the TARGET intent key on the host. Firing INVOKES the game intent on
 *  the host (`invokeIntent(to, intent)`) and moves NO screen state (§8.5). Mirrors how `signal`
 *  lets a click drive the flow, scoped to a button's action instead of a screen-wide tap. */
| { kind: 'action'; pin: string; intent: string };
```

### 8.5 Runtime — action edges INVOKE an intent (they don't move the active set)

An `action → intent` edge is a **new edge semantic**: firing it does NOT activate/deactivate a
screen (base game is already active) — it **invokes a game intent on the target host**. So it
routes through a dedicated path, not the `fire()`/active-set machinery.

- **Match by action KEY, not instance pin id.** `registerComponentActions` defines `spin` ONCE,
  shared across every button instance; the `onpress` knows its action key (`'spin'`), not which
  instance fired. So `FlowTrigger.action.pin` is the action **key** (`'spin'`), and the editor
  extracts the key from the instance-scoped source pin id when it mints the edge. `trigger.intent`
  is the target intent key.
- `packages/engine-flow/src/presentation.ts` — add `hasAction(pin): boolean` (a pure graph query:
  any active-screen outgoing edge with `trigger.kind==='action' && trigger.pin===pin`) and
  `onAction(pin): Promise<boolean>` (for each matching edge, call `host.invokeIntent(edge.to,
  edge.trigger.intent)`). Add `invokeIntent?: (screenId, intent) => void` to `PresentationHost`.
- `packages/engine-flow/src/interpreter.ts` — surface `hasAction(pin)` (sync) + `emitAction(pin)`
  (async) next to `emitSignal` (interpreter.ts:66); thread an `invokeIntent` param through to the
  machine host.
- `apps/lines/src/game/flowInterpreterHolder.ts` — expose `hasFlowAction(key)` + `emitFlowAction(key)`
  (mirror `emitFlowSignal`, holder:34).
- `apps/lines/src/components/Game.svelte` — (a) pass `invokeIntent: (screenId, intent) => { if
  (intent === 'spin') <the same idle?bet:stop broadcast> }` into `createFlowInterpreter`; (b) in the
  registered `spin` action's `onpress` (Game.svelte:892), **early-return through flow when wired**:
  `if (holder.hasFlowAction('spin')) { holder.emitFlowAction('spin'); return; }` BEFORE the coded
  broadcast. Unwired ⇒ `hasFlowAction` is false ⇒ the coded broadcast runs exactly as today. No
  double-fire (one path or the other), full parity.

### 8.6 The one open question — which screen hosts the intents (no hardcoding)

Intents are game-global, but the owner wants them **on Base game**, and the no-hardcoding rule
(`feedback_no_hardcoding_generic`) forbids `if (screen.id === 'basegame')` or any magic id. The
host must be identified **generically, from data.** Options, in preference order:

1. **Recommended — a scene-level opt-in flag `gameplayHost: true`** (authored once in the Scene
   Editor, stored on the `Scene`, surfaced through `FlowScreen`). Any scene can be the intent
   host; base game's scene sets it. Fully generic, explicit, survives multi-game flows (e.g. a
   free-spins host screen with its own intent set). Costs one editor toggle + one schema field.
2. **Zero-config default — the `initial` + persistent screen** (entry node with no outgoing
   `complete` edge). Uniquely identifies base game in every current flow with no new field, but
   is implicit and breaks if a flow has two persistent screens. Usable as the *fallback* when no
   scene sets `gameplayHost`.
3. Reject: deriving intents on **every** screen (noisy — a loading screen showing a Spin input).

**Decided (owner, 2026-07-02): (1) with a generic fallback.** `resolveIntentHostId` (in
`flowModel.client.ts`), in order: **(1)** an explicit `gameplayHost` flag (a toggle in the screen
inspector, single-host); else **(2)** the SOLE persistent screen if there's exactly one; else
**(3)** among multiple persistent screens, the one that *receives* intents — no `action` OUTPUT pin
(buttons live on HUD screens) AND reachable (has an incoming edge) — which is the base game; else
`undefined` (UI hints to set the flag). Node shows an "intents" badge on the resolved host. All
generic — no hardcoded ids.

> **Corrected 2026-07-02 (`ca044d0`):** the first shipped fallback was "`initial` AND persistent",
> which matched NOTHING in a real flow whose initial screen is a transient loading/progress screen
> (not persistent) and whose base game is persistent but not initial — so no intent pins appeared.
> Rule (3) above replaces it. Also fixed same commit: `/flow` edge delete now PERSISTS (SvelteFlow
> owns the Delete key with screens `deletable:false`; its deletions reconcile into the FlowDoc via
> `ondelete`, so a removed wire no longer reappears on move/reload).
>
> **Edge pin-handle rendering (`b2c8a77`):** `FlowTransition` gained authoring-only `fromPin`/`toPin`
> (the connected source/target pin handle ids; runtime-inert, `normalize`d). `onConnect` records
> them and `buildEdges` renders the xyflow edge from them, so an `action → intent` wire draws
> spin-out → spin-in (not Complete → Enter), and two edges between the same screens get DISTINCT
> handles — fixing xyflow blocking the second pin's connection (`increase`) as a duplicate. Legacy
> edges without `fromPin` infer handles from the trigger.

### 8.7 Editor — make the wire real

- `apps/launcher-api/.../flow/+page.svelte` `onConnect`: when the **source** handle is an
  `::action:<key>` pin AND the **target** is an `::intent:<key>` pin, mint `trigger: { kind:
  'action', pin: <sourceKey>, intent: <targetKey> }` — the **KEYS extracted** from the handle ids
  (`pinRoleKey`), NOT the full instance-scoped handle id (§8.5, match by key). An action source
  dropped onto a non-intent target is rejected (no blank edge). Shipped as-built.
- `flowModel.client.ts` `addTransition`: no change needed — it already forwards whatever
  `FlowTrigger` it's given verbatim; the key extraction happens in `onConnect`, not here.
- `FlowScreenNode.svelte`: `intent` pins are `direction: 'in'`, so they already flow into the
  left `inputs`/`target`-handle list; only a `roleColor` entry was added (a deeper amber, kin to
  the action hue). Cosmetic note: `edgeSemantics` still classifies an `action` edge as a "layer"
  edge (dashed-amber) since it's non-`complete`; harmless (the label reads `intent: <key>`), left
  for a future edge-class pass if a distinct look is wanted.

### 8.8 Parity (§7 discipline)

A FlowDoc with **no `action` edges** derives intent pins that nothing wires to, adds no
`action` triggers, and calls `emitFlowAction` never — byte-identical to today. The coded
`ButtonBetProvider`/`registerComponentActions` spin path stays live and authoritative until a
game opts a button's `action` pin into a wire. Ship **Spin** first (one intent, fully wired +
verified), then the rest follow the identical pattern (`Stop`, `BuyBonus`, `ChangeBet`,
`Autoplay`).

### 8.9 Touch list

Shipped 2026-07-02 (Spin slice, engine `main`; flow-spike `phase8ActionIntent` 21/21; parity held).

| File | Change |
|---|---|
| `packages/engine-flow/src/types.ts` | `FlowPinRole += 'intent'`; `FlowTrigger += {kind:'action',pin,intent}`; `FlowScreen.gameplayHost?` |
| `packages/engine-flow/src/pins.ts` | `deriveScreenPins(scene, resolve, options)` — intent input pins on the host from the vocabulary |
| `packages/engine-flow/src/presentation.ts` | `hasAction(pin)` + `onAction(pin)` (invoke `host.invokeIntent`, no active-set change) |
| `packages/engine-flow/src/interpreter.ts` | surface `hasAction`/`emitAction`; thread `invokeIntent` param |
| `packages/engine-flow/src/normalize.ts` | normalize the `action` trigger (`pin`+`intent`, drop partials) + preserve `gameplayHost` |
| `apps/lines/src/game/flowInterpreterHolder.ts` | expose `hasFlowAction` + `emitFlowAction` |
| `apps/lines/src/game/flowRuntime.svelte.ts` | thread `invokeIntent` into `createFlowInterpreter` |
| `apps/lines/src/components/Game.svelte` | shared `doSpinBetOrStop`; `spin.onpress` early-returns through flow when wired; `invokeIntent` wires `spin` |
| `apps/launcher-api/.../flow/+page.svelte` | `onConnect` mints an `action` edge (keys extracted) from `::action:*` into `::intent:*` |
| `apps/launcher-api/.../flow/flowModel.client.ts` | `intentHostId` + `intentVocabulary`; 2-pass derive attaching intent pins on the host |
| `apps/launcher-api/.../flow/FlowScreenNode.svelte` | `intent` role color |
| `tools/flow-spike/phase8ActionIntent.ts` | headless parity/behaviour fixture (21 assertions) |

---

## 9. Sequencing + critical path

```
Phase 1 (loading + tap) ─┐
Phase 2 (win-branch)     ─┼─→ Phase 5 (ship a real game)   ← the acceptance scenario
Phase 4 (generic mount)  ─┘
Phase 3 (engine-state)   → richer branching (parallel to 1–2)
Phase 6 (universal tray) → scales it to every component/screen
Phase 7 (behaviour/catalog) → long tail
Phase 8 (action trigger → intent pins) → SHIPPED (Spin, §8)
Phase 9 (value dataflow pins → value edges) → NEXT (§11; mirrors Phase 8's shape)
```

**Phases 1 → 2 → 4 → 5** is the critical path to the owner's exact flow running in a shipped
game. Phase 3 enriches branching and can run in parallel. Phases 6–7 generalize. Phase 8
made *action* dataflow explicit (button → intent); **Phase 9 (§11)** completes the picture by
making *value* dataflow explicit (engine signal → HUD display), the symmetric other half.

## 10. Rule-9 / docs debt to fold in

- **`docs/tools/editor.md` is missing** — the Scene Editor (the more complex tool) has no
  tool doc, only `component-editor.md` exists. Rule 9: write it (grounded in the real route
  UI) as part of this work, and refresh `component-editor.md` + `flow.md` as the authoring
  surface changes (the pending Flow Phase-3/7 `docs-keeper` audit).
- Record each phase in `docs/STATUS.md` as it lands (rule 6), and bump Borut's `engine`
  submodule when engine pieces must reach it (Phase 5).

---

## 11. Phase 9 — Explicit value-dataflow pins (engine signal → HUD display)

> Owner direction 2026-07-02. The symmetric other half of Phase 8: Phase 8 made *action*
> dataflow explicit (a button's `action` output pin wires into a base-game `intent` input);
> Phase 9 makes *value* dataflow explicit (an engine-owned value SOURCE becomes an output pin
> the HUD's display input pins wire into). PLANNING ONLY — no engine/editor code has been
> written for this phase; this section is the build plan.

### 11.1 Problem statement + the agreed model

Today a screen's value pins (e.g. a HUD-Balance node's `Balance·balance`, `Bet·bet`,
`Win·win`) are **implicit subscriptions**. A `componentInstance` carries a `source` param — a
global feed NAME (`'balance'`) — and `ComponentInstance.svelte` reads
`staticParams['source']`, calls `getComponentValueSource(source)` against the module-scoped
registry the game filled at boot (`registerComponentValues` in `apps/lines/src/components/
Game.svelte:311`), and subscribes. **Nothing on the canvas shows where the value comes from.**
`deriveScreenPins` (`pins.ts:118-121`) already projects a `value`-role INPUT pin
(`${instanceId}::value:${source}`) for exactly this binding, but that pin is cosmetic — no edge
can terminate at a value SOURCE because no value source is a pin, and the interpreter never
reads value pins (the same "pins are cosmetic" gap Phase 8 closed for actions, per §"The three
structural gaps" gap 1).

**The agreed model (locked with the owner):** complete the dataflow so it is *visible + routable*
on the graph. Value SOURCES become **OUTPUT pins** (hosted on the Base game node — the value
producer, §11.4); value SINKS (the HUD displays) stay the existing **INPUT pins**; you **wire
them with edges**. "The game changes bet/balance/win → the HUD reflects it" becomes an authored
wire, resolved dynamically by the interpreter instead of resolved implicitly by name inside
`ComponentInstance.svelte`. This mirrors Phase 8's action→intent shape exactly: a new pin role,
a new (non-active-set-moving) edge semantic, and an editor `onConnect` that mints the typed edge.

### 11.2 The three locked rules (do not re-litigate — build around these)

1. **A value edge = a REACTIVE SUBSCRIPTION to a single engine-owned signal, never an
   imperative copy.** The single source of truth stays in the engine (the `ValueSource` store the
   game registered); the edge only makes the *existing* subscription **visible + explicitly
   routable**. A "copy the value on change" design is explicitly REJECTED — it reintroduces
   two-sources-of-truth / desync. Concretely: a value edge resolves to "this display's `source`
   binds to producer signal `X`", and `ComponentInstance.svelte` subscribes to `X`'s store exactly
   as it does today; the edge never carries or caches a value.
2. **Producers come from a DECLARED engine-signal registry surfaced as output pins** — not
   hand-invented per node. This is the "generalize engine-signal exposure to every instance" item
   parked in §6/§7 and referenced in `invisible-flow.md`. The registry ALREADY EXISTS in two
   honest forms we build on, not a new invention: the DECLARE side is
   `ENGINE_PARAM_CATALOG` (`packages/engine-layout/src/lib/componentCatalog.ts:29`) — the
   code-owned list of engine-provided values (`bet`/`win`/`balance`/`totalWin`/`freeSpins`/…);
   the IMPLEMENT side is `registerComponentValues` (`registerComponentValues.ts:58`) plus the
   game's closed `linesEngineReader` (`apps/lines/src/game/flowRuntime.svelte.ts:84`) — the
   already-bounded `$engine.*` key→value getter over the same live state singletons. The producer
   output pins are a projection of `ENGINE_PARAM_CATALOG` (the same way intent pins are a
   projection of the action vocabulary, §8.3), keyed by feed name.
3. **Auto-bind by name, override by edge.** Dropping a value component still auto-wires to the
   same-named producer signal (zero-config default = today's implicit `source`-name binding,
   byte-parity §7). An author MAY draw an edge to OVERRIDE (point a display at a different signal,
   e.g. a readout labelled "Win" driven by `totalWin`) or leave it unwired intentionally. The edge
   is an *override*, never a *requirement* — an unwired display resolves its producer by its
   `source` name exactly as today.

### 11.3 The open decision to surface — Base-game node vs a "Engine / context" node

Where do the value OUTPUT pins hang? Two options; the owner leans (a), with the ontology caveat
below made honest.

- **(a) On the Base game node.** That is where player actions already land (Phase 8 put the
  `intent` inputs there), so the producer outputs sit symmetrically opposite the intent inputs on
  one recognizable hub. Fewest new concepts (reuses the resolved intent-host, §8.6). Risk: the
  base-game node accretes many pins (one per feed × produce/consume) and gets crowded.
- **(b) A dedicated "Engine / context" node.** A single non-screen node that hosts every engine
  value producer, keeping the base-game node about gameplay. Cleaner separation, room to grow;
  costs a new node concept in a "screens are the only nodes" model (`invisible-flow.md` §5) — it
  would be a *pseudo-node* (no backing `Scene`, never mounted), which the mounter + `Game.svelte`
  reserved-scene logic must learn to ignore, and validation/diff must special-case.

**Recommendation: start with (a) Base game, split to (b) later if crowded** — the same
"start on Base game, split later" the owner chose for intents (§8.6). The resolver
(`resolveIntentHostId`, `flowModel.client.ts:71`) already picks the host generically (no magic
ids); the value producers ride the SAME host id. If (b) is ever needed, the pin-role +
edge-semantic below are node-host-agnostic, so only the *derivation site* moves.

**Ontology caveat (call it honestly — do not pretend the three feeds are alike):**
- `bet` is a **continuous** player-controlled value (changes on increase/decrease, always
  meaningful) — a clean "always-live producer".
- `balance` really **originates from wallet/RGS**, not from gameplay — the base game merely
  *reflects* it. Hosting it on the Base game node is a UI convenience (that is where the player
  reads it), not an ontological claim that the base game *owns* balance. A future "Engine /
  context" node (option b) is the more honest home for it.
- `win` is **episodic** (per-round, transient — zero between rounds, set by `winInfo`/`setWin`),
  not continuous like `bet`. Its producer pin is "the latest round's win", which is legitimately
  empty/zero at idle. The value edge is still a subscription (the display shows whatever the
  `win` store currently holds); the episodic nature is a property of the store, not the wire.

This caveat does NOT block option (a) — all three are registered `ValueSource`s today and all
three already drive HUD readouts by name — but it is why the design keeps the producer-node
choice OPEN and the pin role node-host-agnostic.

### 11.4 Concrete engine changes (`packages/engine-flow`)

Mirror Phase 8 (§8.9) beat-for-beat — a new pin role, a new edge kind that does NOT move the
active set, and a resolver — but the runtime effect is a *binding resolution*, not an intent
invocation.

- **Engine-signal registry (where it lives / how a signal is declared).** No new registry —
  reuse `ENGINE_PARAM_CATALOG` (`componentCatalog.ts`) as the DECLARED producer list (the
  `declare` side) and `registerComponentValues` as the runtime store map (the `implement` side).
  A "value producer signal" is any `ENGINE_PARAM_CATALOG` entry (already keyed by feed name, with
  `kind`/`label`). The FlowDoc references it by key (`'balance'`), never by store — the store stays
  engine-owned. The launcher already loads this catalog; pass its keys into the flow model the same
  way the action vocabulary is passed (§8, `flowModel.client.ts` `intentVocabulary`).
- **Pin derivation — value OUTPUT pins (`pins.ts`).** Add a `producer` projection symmetric to
  the intent projection (`deriveScreenPins` `DeriveScreenPinsOptions`, `pins.ts:161`): when a
  screen is the value-producer host, derive one OUTPUT pin per `ENGINE_PARAM_CATALOG` feed key,
  stable id `${screenId}::produces:${feedKey}` (structural-style, key-stable so a wire survives
  relabels — the §8.3 intent-pin id pattern). Two sub-options for the role, decide in build:
  either reuse `value` with `direction:'out'` (the existing consumer pin is `value`/`in`; a
  producer is `value`/`out`), OR add a distinct `producer` role for a clearer canvas hue. Prefer a
  **new `producer` role** (`FlowPinRole += 'producer'`, `types.ts:162`) so the editor can colour
  producers distinctly from consumers and so `intentVocabulary`-style collection stays
  unambiguous. The consumer INPUT pin stays exactly as `derivePinsFromNodes` derives it today
  (`pins.ts:118`, `${instanceId}::value:${source}`) — unchanged, so existing docs' value pins
  render identically.
- **FlowDoc schema additions — value edges (`types.ts`).** Add a trigger variant, matching the
  §8.4 action shape:
  ```ts
  /** A VALUE BINDING edge (design doc flow-driven §11): a HUD display's value INPUT pin is bound
   *  to an engine-owned producer signal. `producer` is the producer feed KEY (`'balance'`); `sink`
   *  is the consumer's instance-scoped value-pin binding (the `{ instanceId, source }` the display
   *  reads). Firing this NEVER moves the active set and NEVER runs choreography — it is a static
   *  binding the interpreter resolves once (a subscription override), NOT an event. Mirrors the
   *  `action` edge's "does not move the active set" property, but is resolved at mount, not fired. */
  | { kind: 'value'; producer: string; sink: { instanceId: string; source: string } };
  ```
  Reuse the existing `FlowTransition` carrier (from/to/trigger + `fromPin`/`toPin` for editor
  rendering, §8.6 `b2c8a77`) — a value edge is a `FlowTransition` whose `trigger.kind === 'value'`,
  `from` = the producer host screen, `to` = the display's screen. `normalize.ts`
  `normalizeTrigger` (`normalize.ts:182`) gains a `case 'value'` that requires `producer` +
  `sink.instanceId` + `sink.source` (drop partials, parity §7), exactly as the `action` case
  requires `pin` + `intent`.
- **Interpreter — resolve a value edge to a subscription (NOT fire it).** This is the one place
  the value edge diverges from every other trigger: it is never "fired" by an event. It is a
  **binding table** the interpreter exposes and the game reads at mount:
  - `presentation.ts` — add `valueBindings(): Map<string, string>` (a pure graph query: for every
    active-or-any `value`-trigger edge, map `${sink.instanceId}::${sink.source}` → `producer`
    feed key). It reads the graph, mutates nothing, and — unlike `onAction`/`onBookEvent` — is NOT
    driven by any runtime event. (Consider computing over ALL transitions, not just active-screen
    outgoing, since a display binding is not scoped to an active screen; decide in build.)
  - `interpreter.ts` — surface `resolveValueSource(instanceId, source): string` returning the
    OVERRIDE producer key when an edge rebinds this display, else the display's own `source`
    (the auto-bind default, rule 3). Inert interpreter (no FlowDoc) ⇒ always returns `source`
    verbatim ⇒ byte-parity.
  - The game (`ComponentInstance.svelte`) then resolves its feed name THROUGH this override
    before calling `getComponentValueSource` — `const feed = flow?.resolveValueSource(node.id,
    source) ?? source;` — so a wired display subscribes to the override producer's store and an
    unwired one subscribes to its own `source` store exactly as today. **This is the whole runtime
    change: a name indirection at the existing subscription site, not a new data path.** Because the
    store is still the engine-owned `ValueSource` the game registered, single-source-of-truth and
    the reactive subscription are preserved (rule 1) — no copy, no cache.
- **Auto-bind-by-name / override-by-edge + byte-parity.** The resolution rule is exactly rule 3:
  `override edge ? producer : source`. With NO value edges authored, `resolveValueSource` returns
  `source` for every display ⇒ `ComponentInstance` subscribes by name ⇒ **byte-identical to
  today's implicit binding**. A wire only ever *redirects* one display's subscription; it can never
  introduce a value the store doesn't already hold. `deriveScreenPins` continues to emit the
  consumer `value` INPUT pin unconditionally, so the auto-bound (unwired) case still SHOWS its pin
  — it just has no incoming edge (the editor renders it as auto-wired, §11.5).

### 11.5 Editor changes (`/flow`)

- **Show value output (producer) pins.** `FlowScreenNode.svelte` already lists inputs left /
  outputs right by `direction` and colours by role (`roleColor`, `FlowScreenNode.svelte:48`). Add a
  `producer` colour (a value-blue kin to the consumer `value` hue `#3b82f6`, but distinct so
  producer-vs-consumer reads at a glance). The producer host screen (Base game) then shows one
  right-side `produces:<feed>` handle per `ENGINE_PARAM_CATALOG` feed, opposite its intent inputs.
- **Draw / delete value edges.** `+page.svelte` `onConnect` (`+page.svelte:223`) gains a branch
  mirroring the action→intent branch (§8.7): when the SOURCE handle is a `::produces:<feed>` pin
  AND the TARGET is a `::value:<source>` consumer pin, mint `trigger: { kind:'value', producer:
  <feedKey>, sink: { instanceId: <consumerInstanceId>, source: <consumerSourceKey> } }` — KEYS
  extracted from the handle ids via `pinRoleKey` (`+page.svelte:217`), recording `fromPin`/`toPin`
  so the wire renders from the real handles (§8.6). A producer dropped onto a NON-value target is
  rejected (no blank edge), same discipline as action→non-intent. Delete rides the existing
  `ondelete`/`onGraphDelete` edge-reconcile path (§8.6 `ca044d0`) unchanged.
- **Auto-wired vs explicit shown distinctly.** A consumer `value` INPUT pin with an incoming
  value edge is EXPLICIT (draw the edge, styled as a distinct "binding" edge class — a thin
  value-blue line, not the handoff-solid/layer-dashed of the active-set edges, since it moves no
  state). A consumer pin with NO incoming value edge is AUTO-WIRED by its `source` name — render a
  subtle affordance on the pin (e.g. a faint "auto" dot / tooltip "auto-bound to `<source>`") so an
  author can tell "this reads balance by default" from "this is explicitly rewired". `EdgeInspector`
  gains a read-only value-edge explainer (producer → display, "reactive subscription; overrides the
  display's default `source`"). `edgeSemantics` (`validate.ts`) classifies a `value` edge as its
  own class (not handoff/layer) so it never mis-reads as an active-set edge.

### 11.6 Migration (the parity invariant)

- Existing FlowDocs (Borut has none; the lines fixtures author no value edges) carry NO `value`
  triggers ⇒ `resolveValueSource` returns `source` for every display ⇒ **every display subscribes
  by name exactly as today, byte-identical**. The whole feature is default-inert (§7): the producer
  pins are derived-but-unwired, the runtime indirection is a no-op passthrough, and an absent
  FlowDoc means `ComponentInstance` never calls `resolveValueSource` at all (the coded subscription
  path is unchanged when the interpreter is inert).
- A partially-authored doc (some displays rewired, others not) is safe by construction: each
  display resolves independently (`override edge ? producer : source`), so wiring one readout never
  affects another.
- Orphan discipline (rule / §4): a value edge whose `sink.instanceId` was deleted, or whose
  `producer` is not a registered `ENGINE_PARAM_CATALOG` feed, ORPHANS → a `validate.ts` warning
  (never a silent drop). A `value` edge whose `sink` is intact but points at a feed the game did
  not `registerComponentValues` resolves to nothing (empty readout) — the SAME behaviour as an
  unbound `source` name today, so no new failure mode.

### 11.7 Deploy → bake → register chain (rule 8)

The FlowDoc already travels export → `deploy/flow.json` → bake (`BakedBundle.flow`) → register
(`bakedFlowDoc()`), and a `value` trigger is just new content inside the SAME doc. The ONLY chain
touch-points are the pure serializers, which MUST learn the new trigger or they will DROP value
edges on save/bake (silently reverting to auto-bind): `normalize.ts` `normalizeTrigger` (the TS
contract, §11.4) AND the hand-rolled copy in `scripts/bake-editor-doc.mjs` /
`apps/launcher-api/src/lib/server/flowExport.ts`'s `normalizeFlowDoc` usage — check whether the
bake script re-normalizes (it keeps a hand-rolled `isAuthoredFlow` copy per `normalize.ts:293`;
confirm it does not also re-shape triggers, else mirror the `value` case there). No new R2 asset
class, no `pull` step (a value edge references only feeds the engine already registers) — so the
chain is "just works once the serializer knows the trigger", with a round-trip spike as the gate.

### 11.8 Phased checklist (small, landable steps)

1. **Schema + normalize.** `FlowTrigger += { kind:'value', producer, sink }` (`types.ts`);
   `FlowPinRole += 'producer'` (`types.ts`); `normalizeTrigger` `case 'value'` (drop partials,
   `normalize.ts`). Round-trip spike (`tools/flow-spike/roundTrip.ts` extension): a value edge
   survives author → normalize → JSON → normalize idempotently; a partial value trigger is dropped
   without corrupting siblings. GATE: `pnpm --filter engine-flow typecheck` + the spike green.
2. **Producer pin derivation.** `deriveScreenPins` producer-host projection (one `producer`
   OUTPUT pin per `ENGINE_PARAM_CATALOG` feed on the host). New `tools/flow-spike/valueDataflow.ts`:
   producer pins appear only on the host, stable ids, deterministic order; consumer `value` INPUT
   pins unchanged.
3. **Interpreter resolution.** `presentation.ts` `valueBindings()` + `interpreter.ts`
   `resolveValueSource(instanceId, source)` (override-or-source). Spike: no edge ⇒ returns `source`
   (parity); one edge ⇒ returns `producer` for that display only; inert interpreter ⇒ always
   `source`.
4. **Game wiring (`apps/lines`).** `ComponentInstance.svelte` resolves the feed name through
   `flow?.resolveValueSource(node.id, source) ?? source` before `getComponentValueSource`; thread
   the interpreter to `ComponentInstance` (via context, mirroring how it reaches other flow hooks).
   Parity-first: default boot (no FlowDoc) unchanged. A dev-hook fixture (`__IE_FLOW_VALUE__`) that
   rebinds one readout to a different feed, verified via the `app.stage` read (WebGPU — not
   `preview_screenshot`) that the readout shows the OVERRIDE feed's number.
5. **Editor.** `onConnect` value-edge branch + reject; `FlowScreenNode` `producer` colour +
   host producer pins; auto-vs-explicit affordance; `EdgeInspector` value explainer; `validate.ts`
   value-edge semantics + orphan/`unresolved-producer` warning. `pnpm --filter launcher-api build`
   green; RULE 9: refresh `docs/tools/flow.md` (value pins + value edges) in the SAME change via
   `docs-keeper`.
6. **Ship (owner step).** Bake a project authoring a value override, confirm the shipped game
   resolves the override off the baked slot; bump Borut's `engine` submodule if the engine
   `ComponentInstance` indirection must reach it.

### 11.9 Rough size / lift estimate per area

- **`engine-flow` schema + normalize (step 1):** small — one trigger variant + one pin role +
  one normalize case + spike extension. ~half a day. Lowest risk (pure, headless-provable).
- **Pin derivation (step 2):** small — a projection symmetric to the shipped intent projection.
  ~half a day.
- **Interpreter resolution (step 3):** small-medium — a pure binding-table query + a
  passthrough resolver. The subtlety is deciding "all transitions vs active-screen-scoped" for
  `valueBindings` and confirming it's a static resolve, not an evented fire. ~1 day incl. spike.
- **Game wiring (step 4):** MEDIUM + the only real risk — threading the interpreter into
  `ComponentInstance.svelte` and inserting the name indirection at the subscription site without
  regressing the byte-parity default path or the reactive subscription (`$effect`). Needs the
  live WebGPU verify (the one thing headless can't prove). ~1–2 days.
- **Editor (step 5):** medium — mostly mirrors Phase 8's `onConnect`/node/inspector/validate
  changes; the new bit is the auto-wired-vs-explicit affordance + a distinct value-edge visual
  class. ~1–2 days incl. the RULE-9 doc.
- **Total:** roughly a Phase-8-sized slice (~4–6 focused days), with the same discipline: prove
  each step headless-green in `tools/flow-spike`, hold the default-inert parity invariant by
  construction, and gate the runtime indirection on a live WebGPU verify before shipping.
