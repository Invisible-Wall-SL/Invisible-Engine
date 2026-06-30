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

**Owner-verify live (the one thing headless can't prove — WebGPU bundle):** set
`window.__IE_FLOW_LOADING__ = true` before boot, confirm the splash shows then a tap swaps to
`basegame` (verify via the `app.stage` read / dynamic-import override, not `preview_screenshot`
— it times out on WebGPU). Default boot (no hook) must render byte-identical.

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

**Remaining for Phase 6:** `value`/`signal` universal binding (need a def node to consume them),
per-instance signal rebinding, and the `visibleFor`/`screenAnchor`/custom-`options`/`def.slots` UI gaps.

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

## 8. Deferred — per-button `action` trigger (functional output pins)

Per the owner's 2026-06-30 decision, this is **deferred** until the tap-driven flow works.
When built, it makes the Flow pin graph functional for outputs:

- Add `FlowTrigger { kind: 'action', pin }` to the schema (`types.ts:209`).
- Bridge `registerComponentActions` `onpress` → the flow interpreter holder so a flow-bound
  button press fires its action trigger (today `onpress` goes only to the action registry,
  `Game.svelte:600`, never to Flow).
- Let edges originate from an action output pin in `/flow` (`addTransition` records a source
  pin, `flowModel.client.ts:148`), turning the cosmetic action pin into a real wire.

---

## 9. Sequencing + critical path

```
Phase 1 (loading + tap) ─┐
Phase 2 (win-branch)     ─┼─→ Phase 5 (ship a real game)   ← the acceptance scenario
Phase 4 (generic mount)  ─┘
Phase 3 (engine-state)   → richer branching (parallel to 1–2)
Phase 6 (universal tray) → scales it to every component/screen
Phase 7 (behaviour/catalog) → long tail
Phase 8 (action trigger) → deferred (owner)
```

**Phases 1 → 2 → 4 → 5** is the critical path to the owner's exact flow running in a shipped
game. Phase 3 enriches branching and can run in parallel. Phases 6–7 generalize.

## 10. Rule-9 / docs debt to fold in

- **`docs/tools/editor.md` is missing** — the Scene Editor (the more complex tool) has no
  tool doc, only `component-editor.md` exists. Rule 9: write it (grounded in the real route
  UI) as part of this work, and refresh `component-editor.md` + `flow.md` as the authoring
  surface changes (the pending Flow Phase-3/7 `docs-keeper` audit).
- Record each phase in `docs/STATUS.md` as it lands (rule 6), and bump Borut's `engine`
  submodule when engine pieces must reach it (Phase 5).
