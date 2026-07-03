# Invisible Flow — design + build plan

> An online **node editor for a game's presentation flow**, built on the Scene
> Editor's screens. **Each screen is a node**; its pins are **derived from what's in
> the screen** (the components you drop in already carry engine bindings); you wire
> screens together with **transition edges** to rebuild the game flow, and
> **double-click a node** to author its enter/exit **choreography** (the per-state
> timeline of animations/sounds with delays + a speed scalar). The authored graph is
> executed at runtime by an **interpreter** — a presentation state machine that
> mounts the active screen and runs its choreography — riding on top of the unchanged
> XState platform FSM.
> Owner direction 2026-06-23. Related: `invisible-editor.md` (the Scene Editor +
> the four-registry `declare ≠ implement` contract this reuses wholesale),
> `live-assets.md` (the deploy→bake→register chain every authored doc must travel),
> `invisible-symbols-state-machine.md` (a prior authored-doc through the same chain).
> **See also `flow-driven-game.md`** (owner direction 2026-06-30) — the build plan to make
> the pin graph functional, drive the whole game from Flow (loading → tap → basegame →
> win-branch, shipped + baked), and generalize engine-signal exposure to every instance. The
> per-button `action` trigger deferred there is the functional-output-pin work this doc's pin
> model anticipates.

## 0. Status

**BUILT — Phases 0–8 + tap-to-continue are all merged to `main`** (PRs #63/#64; verified
2026-06-29; this §0 was previously a stale "not built" plan header). `packages/engine-flow`
(interpreter + schema + pin-derivation + normalize/validate/diff) and the full `/flow` route
(macro graph, choreography editor, inspectors, validation + diff panels, undo/redo) are
shipped; `/flow` is registered with a tool doc; the interpreter is wired into `apps/lines`
with the default-inert fall-through invariant. **Genuinely outstanding:** owner live-verify
of the authed `/flow` page + a running bundle, and **no shipped game runs an authored FlowDoc
yet** (the bake pipeline exists, but Book of Borut has no authored/baked FlowDoc and its
submodule isn't bumped). See `docs/STATUS.md` "Current state — reconciled" for the
authoritative summary; the per-phase progress log below is append-only and lags.

**Original owner decisions (2026-06-23), preserved:**
- **Screens are the nodes** — Invisible Flow is a *wiring layer over Scene Editor
  screens*, not a separate vocabulary. A node = a whole screen/scene.
- **Pins are dynamic** — a node's inputs/outputs grow as components are added to the
  screen; they are the union of the screen's component bindings (the four engine
  registries), not hand-declared.
- **Two tiers** — a macro screen graph (screens + transitions) with micro
  choreography (an enter/exit sequence) authored *inside* each node.
- **Full authoring from day one**; the graph is the source of truth at runtime.
- A dedicated subagent owns all work on this tool: `.claude/agents/invisible-flow.md`.

Nothing ships until it travels the full asset chain (§10). **Phase 0 (§9) is the
make-or-break gate**: the runtime interpreter must mount one real screen and run a
hand-authored choreography for one event (`winInfo` in `apps/lines`) with zero visual
regression and clean fall-through, before any editor UI is built.

### Feature — droppable "Transition (fade)" entrance transition (2026-07-02)

**What it is.** A droppable **"Transition (fade)"** the author drops onto a connection between two
screens to give that edge's TARGET screen a FADE-IN (with easing) when it activates. Owner decision
(locked): model it as EDGE-BACKED data (`FlowTransition.transition`), rendered as a chip ON the edge
in `/flow` — NOT a new runtime graph node (screens-are-the-nodes stays invariant; the runtime reads
`edge.transition`). Kind = FADE only for now: `transition?: { kind:'fade'; ms; easing?: 'linear' |
'easeOut' | 'easeInOut' }`. Semantics: an edge WITH a `transition` mounts its target HIDDEN (alpha 0)
and tweens alpha→1 over `ms` (scaled by `timeScale()` like `delayMs`/a `Delay`), with the chosen
easing; an edge WITHOUT one = today's HARD CUT (byte-identical parity §7).

**The interpreter↔host fade contract (the crux — no flash).** Mounting-then-fading would FLASH at
full alpha for a frame because the host's `<LayoutScene>`/`<UI>` mounts the instant `notify()` lands.
Fix: the interpreter (FRAMEWORK-FREE) SURFACES the entrance transition per activation instead of
tweening. `presentation.ts` `PresentationHost.onActiveScreensChange(screenIds, entrances)` now carries
`entrances: ScreenEntrance[] = { screenId, transition? }[]` — the screens NEWLY activated by this set
change, each with the firing edge's `transition`. `activate()` returns whether it GENUINELY added the
screen, so a re-activation (already-present target) or a transition-less edge surfaces `undefined` ⇒
NO fade replay on a repeat trigger / a re-entrant handoff. Both `performTransition` and
`performCompleteFanOut` collect entrances and pass them to `notify()`. A sibling
`entranceTransition(id)` getter serves the boot-seeded initial screen (no notify fires for it). The
HSM stays observe-don't-drive (the read is pure). The HOST owns the actual tween: a REUSABLE
`engine-layout/svelte` `FlowFade.svelte` wraps content in a `<Container>` whose alpha STARTS at 0 and
tweens to 1 via `svelte/motion` `Tween` (`svelte/easing` `linear`/`cubicOut`/`cubicInOut`, duration ÷
`timeScale()`) — so the first painted frame is transparent (no flash); `FlowScreenMount.svelte` pairs
it with `<LayoutScene>`. `Game.svelte` mirrors `entrances` into an `entranceById` rune (pruned when a
screen leaves the set) and drives the THREE generic mount paths a fade target can hit — the takeover
layer (loading/celebrations), the HUD `<UI>` gate (via `FlowFade`, since the HUD isn't a
`<LayoutScene>`), and the base-game below-reel mount — falling back to the un-faded `<FlowMount>`/
`<LayoutScene>` path when there's no entrance (parity). Serial `transitioning` gate,
`changesActiveSet` no-op-layer skip, exit-then-enter order, and inert-flow fall-through are all
preserved. (The brief's "GSAP is a dep" was inaccurate — GSAP is absent from the workspace; the
codebase-native alpha tween is `svelte/motion` `Tween`, as `FadeContainer` uses.)

**Editor.** A droppable "Transition (fade)" palette chip (HTML5 drag) drops onto an edge — hit-tested
via `elementsFromPoint` against the xyflow edge SVG — attaching a default 300ms ease-out fade and a
`◐ fade Nms` chip on the edge label; the handoff (solid) vs layer (dashed) edge visuals are intact.
`EdgeInspector.svelte` exposes attach/remove + duration (ms) + easing (linear/easeOut/easeInOut) with
a live explainer. `flowModel.client.ts` `editTransition` threads `transition` (`null` removes);
`DEFAULT_FADE_TRANSITION` is seeded on drop.

**Verified headlessly + build-shipped.** `pnpm --filter engine-flow typecheck` clean; new
`tools/flow-spike/phase8Transition.ts` (`pnpm --filter flow-spike run transition`) 12/12 GREEN against
the REAL `createPresentationMachine` + `normalizeFlowDoc` (fade edge surfaces the transition;
transition-less surfaces none; repeat-layer + re-entrant-handoff replay NO fade; `complete` fan-out
surfaces per-target; normalize clamps ms ≥ 0 / defaults easing / drops junk / idempotent). All prior
flow-spike harnesses still PASS (phase4's observe-don't-drive allow-list gained the pure
`entranceTransition` read). `apps/lines` prod build (`PUBLIC_RGS_TRANSPORT=play4fun`) + `launcher-api`
build clean; Prettier clean. **Still owed:** owner live-verify the actual fade PIXELS in a running
bundle (WebGL — the one thing headless can't prove), turbo on/off; then the ship chain
(`publish-runtime-bundle` → Borut submodule bump) is the owner's step. NOT committed/pushed/published.

### Progress — full-replace HUD adopts content-bearing `hudBar`/`hudCorners` (2026-07-03)

Fixes authored buttons rendering NOWHERE: the owner put real buttons on the DEFAULT `hudBar` scene (a
reserved coded-`<UI>` id, not `hud_*`). Once a `hud_*` screen flips full-replace on, the coded `<UI>`
(the only `hudBar` mount) is suppressed but the `hud_` prefix filter refuses to adopt `hudBar` → orphan.
`genericMountScenes.ts` gains `CODED_HUD_SCENE_IDS` + `fullReplaceHudScenes` (superset of
`authoredHudScenes` that also adopts content-bearing `hudBar`/`hudCorners`); `Game.svelte` render list =
`suppressCodedHud ? fullReplaceHudScenes(scenes) : []`. `suppressCodedHud` stays keyed on `hud_*` only
(parity: a normal coded-HUD game with `hudBar` content must not trip full-replace). Verified play4fun
`lines...` build GREEN; owner live-verifies the buttons appear on the bar. See `docs/STATUS.md`.

### Progress — authored-`hud_*` active-set gate + intent routing generalized beyond `spin` (2026-07-03)

**Context.** The 2026-07-02 pass (below) gated the CODED `<UI>` HUD (`hudBar`/`hudCorners`) on the
active set, but the §16 full-replace path renders author-created `hud_*` screens through a SEPARATE
`{#each authoredHud}` block that had NO gate — so on `bookofborutremake` the authored bottom bar +
balance infos still showed during the loading splash, and the authored buttons (bar `spin`) did
nothing. This pass closes both, holding §7 inert-flow parity, in the shared `apps/lines` runtime
(reaches Borut via `publish-runtime-bundle` — no submodule bump).

- **A. Gate `{#each authoredHud}` on the active set (`Game.svelte`).** Each `hud_*` scene now renders
  only when `!flow || !flow.mounter.authoredScreenIds().has(scene.id) || activeScreenIds.includes(
  scene.id)` — the same shape as the reel + coded-`<UI>` gates. A `hud_*` scene the flow does not
  author renders unconditionally (byte-identical to today).
- **B. Flow-action routing generalized (`Game.svelte`, §8.5).** Only `spin` consulted the flow; the
  other HUD actions' `button → intent` edges were inert and `invokeIntent` was `spin`-only. Extracted
  each coded press body to a shared helper, added `invokeHostIntent(intent)` (one dispatch table for
  BOTH the registered `onpress` and the interpreter bridge) + `routeActionThroughFlow(pin, coded)` (the
  shared flow-guard). All five HUD intents (`spin`/`increase`/`decrease`/`turbo`/`menu`) now route
  through a wired edge, else run the coded body; `spin` byte-identical. Beyond-HUD intents
  (`buyBonus`/`autoSpin`/…) remain unwired — one helper + one dispatch branch each to add.

Also same day (separate concern): symbol art now tracks the reel cell (`boardGeometry().cellW/HLocal`
feeding `SymbolSprite`/`SymbolSpineMain`) so a shrunk cell no longer clips — see `docs/STATUS.md`.
**Verified:** `PUBLIC_RGS_TRANSPORT=play4fun pnpm --filter "lines..." build` GREEN. NEEDS LIVE
OWNER-VERIFY (WebGL): bottom bar/balance hidden on the splash + revealed on the tap; increase/decrease/
turbo/menu buttons functional via their intent edges.

### Progress — complete FAN-OUT + HUD active gate + doc-order z (2026-07-02)

**Context.** The owner authored a real FlowDoc (`loading` initial, `basegame`, and a HUD screen
"HUD — bottom bar") and hit three gaps that this pass closes; all three hold the §7 inert-flow
fall-through invariant. Verified headlessly (flow-spike 14/14) + `apps/lines` prod build (play4fun).

**A. HUD `<UI>` gated on the flow active-set (`apps/lines/src/components/Game.svelte`).** The HUD
chrome mounted UNCONDITIONALLY, so it showed during the loading splash and the `loading→HUD` edge
did nothing. Now a `hudBar`/`hudCorners` id that is an authored FlowDoc screen makes the HUD
**flow-managed** (`isHudFlowManaged`, from `flow?.mounter.authoredScreenIds()`); the `<UI>` then
renders only while the HUD is in the active set (`isHudActive`), mirroring the base-game reel gate.
INERT-FLOW PARITY: no flow, or a flow that authors no HUD node ⇒ `<UI>` renders unconditionally
exactly as today. The HUD is rendered by `<UI>` (positioned from the hud scenes), so it is skipped
in `activeScreenTakeover` to avoid a double-mount when it is the topmost active screen.

**B. `complete` pin FAN-OUT (`packages/engine-flow/src/presentation.ts`).** `fire()` used
`outgoing().find(...)` — a single `onComplete()` fired only the FIRST matching complete edge, so the
owner's `loading --complete--> basegame` + `loading --complete--> HUD` lit up only ONE target. A new
`fireComplete()` + `performCompleteFanOut()` path collects EVERY guard-holding complete edge of the
completing source (the first active screen, top-of-stack, that owns one), deactivates the source
ONCE, activates each distinct target, `notify()`s the full new set ONCE, then runs each target's
`enter` in author order. Guarded branching is preserved (mutually-exclusive guards ⇒ one target); an
unguarded default is always a fan-out sibling. Only the `complete` trigger fans out —
`bookEvent`/`signal`/`condition` keep strict first-match-wins layer semantics via the unchanged
`fire()`. A re-entrant handoff back to an already-active base still re-runs its `enter` (parity with
the old single-edge `performTransition`). Harness: `tools/flow-spike/phase4Runtime.ts` gained B4
(one source, two unguarded complete edges → both targets active, source removed, one notify, ordered
enters) + B5 (guarded branching). `phase7Authoring.ts` updated for the already-removed `dead-end`
warning (terminal leaf = persistent, not a dead-end).

**C. Cross-screen z-order from the editor's screen-list order (`packages/engine-layout/src/lib/
layerOrder.ts` NEW + `Game.svelte` + `referenceLayouts/lines.ts`).** Only `extraScenes`/background
mounted in doc order; the HUD, `basegameOverlays`, the flow takeover, and `specialBook` were pinned
in fixed markup order, so reordering them in the editor had no effect. New `docLayerZIndex(scenes,
id)` maps a layerable scene's index in `scenes[]` into a band (`LAYER_BAND_BASE=100 + docIndex`)
ABOVE the base game and BELOW an engine-owned TOP band (`LAYER_BAND_TOP=10000`, where the
full-screen free-spin gates + their single `waitForResolve` subscriber, the counter, and the info
overlay now sit — so a reorder can never bury a round-blocking gate). Each layerable mount is wrapped
in a `<Container zIndex={...}>`; PixiJS sorts children by zIndex. The reel board (`<MainContainer>`)
is NOT layerable — it stays between the below/above-reel slices, unmoved. PARITY: `referenceLayouts/
lines.ts` now lists `...hudScenes` right after `basegame` (before `basegameOverlays`), so the
fallback doc's layerable order equals the old markup order (HUD → overlays → specialBook) and an
un-reordered / flow-less boot assigns z that reproduces today's stacking byte-for-byte. **Scoped
out (noted):** the free-spin intro/outro **visual** scenes + counter stay in the engine-owned TOP
band, NOT the doc-ordered band — a full generic reorder of the engine-owned gate visuals was
deferred as too risky in one pass; `specialBook` moved from above to below the free-spin gate band
(mutually-exclusive game phases, no visual overlap). NEEDS LIVE OWNER-VERIFY (WebGL pixels): the HUD
hidden during loading + appearing on the tap; both basegame + HUD lighting up on the tap; a scene
reordered in the editor re-stacking in-game.

### Progress — pin-driven active-SET model (engine core) DONE headlessly (2026-07-01)

**What landed.** The presentation model moved from a SINGLE `activeScreenId` (an exclusive
swap) to an ordered **active SET**, so a base-game screen persists while an overlay screen
layers on top. This fixes the Book-of-Borut bug where the reels board mounted UNCONDITIONALLY
in `Game.svelte` and was visible behind the loading splash. Pin semantics, generic (no magic
ids):
- a screen becomes active on its **Enter** pin (added to the set, on top);
- a screen turns **itself off** when it fires its **Complete** pin (removed from the set);
- a `complete` edge DEACTIVATES its source + ACTIVATES its target; a `bookEvent`/`signal`/
  `condition` edge ACTIVATES its target **layered on top** and LEAVES the source active.
- The base game never fires Complete (no `complete`-triggered outgoing edge), so it PERSISTS
  under celebrations; an overlay removes itself on its own Complete — the "celebration over a
  live board" behaviour now falls out of the set, not a special case.

Files: `packages/engine-flow/src/presentation.ts` (ordered `activeScreenIds` set + `activate`/
`deactivate`; `outgoing()` scans EVERY active screen top-first; `complete` edges deactivate the
source, others layer; getters `activeScreenIds`/`isActive(id)` + kept `activeScreenId` = topmost);
`packages/engine-flow/src/interpreter.ts` (exposes `activeScreenIds` + `isScreenActive`; renamed
host callback `onActiveScreenChange`→`onActiveScreensChange`); `apps/lines/src/game/flowRuntime.svelte.ts`
(callback rename + `withDefaultLoadingLeg` doc for the active-set loading→basegame leg);
`apps/lines/src/components/Game.svelte` (active-set rune `activeScreenIds` + derived
`isBasegameActive`; the reel board + basegame below/above-reel slices now gate on
`{#if !flow || isBasegameActive}` — the **inert-flow fall-through** renders unconditionally as
today when no FlowDoc drives the game; `basegameMount` resolves on `isBasegameActive`, not
topmost, so an overlay never drops the base's authored slices).

**How verified (headless + build).** A Node harness driving `createPresentationMachine` with a
fake runtime asserts the full active set across boot (only `loading` active → reels hidden) →
loading `complete` (loading removed, basegame added, exit-then-enter order) → `setWin` bookEvent
(`bigWin` layers over persisting `basegame`) → `bigWin` complete (removes itself, basegame stays
underneath in correct z-order), plus a multi-overlay stack/unwind proving the base never leaves —
**22/22 assertions pass**. `pnpm --filter engine-flow typecheck` clean; `apps/lines` production
build (`PUBLIC_RGS_TRANSPORT=play4fun`) clean.

**Still owed (owner will sequence).** The ship chain (bake FlowDoc → register →
`publish-runtime-bundle` → Borut submodule bump). Owner live-verify of the loading→basegame reveal
in a running bundle (headless-only so far). The dev-only `LINES_FLOW_COND_DOC` fixture was updated
for the active-set model: `basegame → freeGame` stays a `condition` LAYER (proving the condition
trigger), and the return `freeGame → basegame` is now a `complete` HANDOFF (an overlay leaves only
by its own Complete pin — a condition-return onto the still-active base would be a layer no-op).

**Review follow-up (2026-07-01, same day).** Code review found a runtime bug: a LAYER edge
(`bookEvent`/`condition`/`signal`) whose target is already active kept re-running the target's
`enter` + `notify()` on every repeat trigger — and `Game.svelte` pings `evaluate()` on every
observed engine-value change, so a live overlay replayed its entrance animation repeatedly. Fixed in
`presentation.ts`: `fire()` now skips a transition that would NOT change the active set (a layer onto
an already-active target — `changesActiveSet(edge)`), so it is a consumed no-op (no re-enter, no
re-notify); a `complete` handoff always changes state (it deactivates its source) so it is never
skipped, including a re-entrant handoff onto an already-active base. The interpreter active-set
harness gained repeated-layer + re-entrant-handoff cases (now 41/41). The committed flow-spike
regression harnesses (`phase1Loading`/`phase2WinTransitions`/`phase3Condition`/`phase4Runtime`/
`tapToContinue`) were updated to the `onActiveScreensChange` array callback + the new layer/handoff
semantics (bookEvent/condition/signal LAYER + keep the source; only `complete` runs source exit +
deactivates) and all pass.

### Progress — active-SET authoring UI (Phase A) DONE, build-verified (2026-07-01)

**What landed.** The `/flow` editor now authors the active-SET model (no schema change — it rides
the existing edge/pin/trigger representation). The **trigger IS the lever**: a `complete` edge is a
HANDOFF (source hides), any other trigger is a LAYER (target activates over the persistent source).
- **Trigger inference from the drawn pin** (`+page.svelte onConnect`): dragging FROM a screen's
  Complete pin (`${screenId}::complete`) mints a `complete` (handoff) edge; from any other pin, a
  `bookEvent` (layer) edge with a blank event. `addTransition` (`flowModel.client.ts`) now takes an
  optional trigger.
- **Legible canvas semantics** (`+page.svelte buildEdges` + `<style>`): handoff = solid slate,
  layer = dashed amber (+ animated for book events); edge labels lead with `⇥`/`⧉`; a sub-bar
  legend spells it out. The edge inspector (`EdgeInspector.svelte`) shows a live handoff/layer
  explainer under the trigger selector.
- **"persistent (base)" badge** (`FlowScreenNode.svelte` + `isPersistentScreen` in `validate.ts`):
  a computed, read-only teal badge on any screen with no outgoing `complete` edge — the base-game
  trait. Pure derivation over the transitions, no new field; the base is designated by the existing
  `initial` toggle + having no complete edge out.
- **`stuck-overlay` validation** (`validate.ts` + `ValidationPanel.svelte`): a layered screen
  (incoming non-`complete` edge) with no outgoing `complete` edge would never remove itself —
  warned (never blocks). The initial/base screen is exempt.
- **DRY:** the two active-SET semantics helpers (`edgeSemantics`, `isPersistentScreen`) live once in
  the shared `engine-flow/validate.ts` and are read by the page, node, and inspector; the existing
  ValidationPanel / EdgeInspector / FlowScreenNode / undo-redo were extended, not duplicated.

Files: `packages/engine-flow/src/validate.ts` (+`edgeSemantics`/`isPersistentScreen`/`stuck-overlay`
+`EdgeSemantics`), `apps/launcher-api/src/routes/(app)/flow/{+page.svelte,EdgeInspector.svelte,
FlowScreenNode.svelte,ValidationPanel.svelte,flowModel.client.ts}`.

**How verified.** A Node validator harness (esbuild-transpiled `validate.ts`) asserts
`edgeSemantics` (complete⇒handoff, others⇒layer), `isPersistentScreen` (base persists, completing
screens don't), and `stuck-overlay` (flags a layered overlay with no complete edge, exempts the
base/initial) — **12/12 pass**. `pnpm --filter engine-flow typecheck` clean; `pnpm --filter
launcher-api build` clean (the `/flow` route compiles; the only two `+page.svelte` warnings are
pre-existing, on the untouched `clipboard`/`history` lines). Not live-verified in the browser
(preview owed to the owner). `docs/tools/flow.md` refreshed (rule 9).

**Still owed before authorable end-to-end.** Owner live-verify in `/flow` (draw a loading→base
handoff + a base→overlay→base layer round-trip, confirm the badges/edge styles/validation read
right). Then the ship chain (bake → register → publish-runtime-bundle → Borut submodule bump).

### Progress — Phase 0 PASSED headlessly (2026-06-24)

Branch `flow/phase0-interpreter-spike`. No editor UI built; no game submodule bump.

**What landed**
- New `packages/engine-flow` workspace package (`workspace:*`, house style, `tsc
  --noEmit` clean) — the interpreter's Phase-0 slice:
  - `src/types.ts` — minimal **FlowDoc** (screen + transition stubs; per-screen
    enter/while/exit choreography sub-graph of **Sequence / Parallel / Broadcast /
    Delay / ForEach** nodes; `events[]` binds a choreography to a book-event type).
  - `src/executor.ts` — **choreography executor** tree-walking the sub-graph onto the
    EXISTING primitives: Sequence→serial `await`, Parallel→`Promise.all`, Broadcast→
    `emitter.broadcast` (sync) / `broadcastAsync` (awaited or fire-and-forget),
    Delay→`waitForTimeout(ms / timeScale())`, ForEach→serial `sequence()` or parallel
    `Promise.all`. The three broadcast shapes are kept distinct — the timing crux
    (§11.1).
  - `src/accessor.ts` — bounded `$trigger.*`/`$item.*` path reads + literals (no
    scripting VM, §11.4).
  - `src/runtime.ts` — injected runtime surface (emitter + `timeScale` +
    `waitForTimeout`); the interpreter NEVER imports the Svelte-rune state modules, so
    the game wires it to the same primitives the coded path uses at boot.
  - `src/mounter.ts` — **generic scene mounter** interface (contract only; the live
    PixiJS/`LayoutScene` mount with MainContainer scaling + overlays is Phase 4).
  - `src/dispatch.ts` — **dispatch-with-fall-through** (`createBookEventDispatcher`):
    "FlowDoc has this event? run the interpreter; else call the coded handler." This
    is the single boundary that holds the §7 parity invariant.

**How it was verified headlessly**
- `tools/flow-spike/winInfoParity.ts` (new `tools/flow-spike` workspace; run
  `pnpm --filter flow-spike run parity`), mirroring the Rigger Phase-0 spikes. It drives
  the **real** `createEventEmitter` (`utils-event-emitter`) + **real** `sequence()`
  (`utils-shared`), and runs BOTH the `winInfo` body lifted verbatim from
  `apps/lines/src/game/bookEventHandlerMap.ts` (lines 41–69) AND the interpreter running
  a hand-authored FlowDoc for the same event, against ONE shared recording
  emitter + ONE `boardWithAnimateSymbols` (awaited symbol-spine) subscriber.
- Asserts the ordered op log (broadcasts + args, awaited completions, scaled delays) is
  **identical turbo ON and OFF** (15 ops each); a synthetic executor-shape case covers
  the fire-and-forget `broadcastAsync` + `delay ÷ timeScale()` (600→300 under turbo) +
  parallel branches; **fall-through** proven (an un-authored `setTotalWin` still runs its
  coded handler; `winInfo` is interpreter-driven). **PHASE 0 GATE: PASSED.**

**Semantic-fidelity finding (§11.1 / §13 risk — surfaced, not papered over)**
- The executor's recursive `await` per Sequence child flushes an already-queued
  microtask one tick earlier than the flat coded handler. So a FIRE-AND-FORGET
  `broadcastAsync` subscriber's completion can log on a different side of the
  *synchronous* `delay` marker. This is **below the observability threshold**: with the
  real `setTimeout`-based `waitForTimeout`, an un-awaited subscriber resolves on a
  microtask well before any `setTimeout` callback, so nothing lands at a different
  wall-clock time. The harness treats this honestly — the deterministic INITIATION
  timeline is asserted position-for-position; a fire-and-forget completion is asserted
  as a multiset (proves it ran AND was not awaited). **Carry into Phase 4/5:** when the
  live mounter runs, keep fire-and-forget broadcasts un-awaited and verify against the
  real bundle, not just the harness.

**What's left**
- The live **generic scene mounter** (MainContainer scaling + overlays, retiring §20.1)
  — Phase 4, the next hard-reasoning item.
- Macro transition trigger/guard vocabulary + dynamic-pin projection — Phase 1/2.
- `/flow` editor UI — Phase 1+.
- Bake/pipeline wiring (`flow?` in `BakedBundle`) — Phase 6.

**Still needs owner-verify live:** nothing yet. The runtime swap into a real
`apps/lines`/Borut boot is Phase 4; this slice proves async/timing fidelity in isolation.

### Progress — Phase 1 DONE headlessly (2026-06-24)

Branch `flow/phase0-interpreter-spike` (continued). No game bump; `/flow` left
UNREGISTERED (behind the curtain) for this read-only spike — RULE 9 fires in Phase 2.

**Step 1 — Svelte Flow install spike (the §12 decision gate): xyflow WINS.**
- Installed `@xyflow/svelte@1.6.1` into `apps/launcher-api`; a trivial 2-node/1-edge
  graph builds + ships clean under Vite 6 / Turbo 2 / Svelte 5 (`pnpm --filter
  launcher-api build` GREEN — the `SvelteFlow` component + its CSS land in the client
  bundle). The ONLY friction is a peer-dep WARNING: xyflow wants `svelte@^5.25.0`, the
  workspace pins `5.20.5` uniformly across every app+package. It is NOT a build/runtime
  error — xyflow uses only stable Svelte-5 runes APIs present since 5.0, so 5.20.5 runs.
  A workspace-wide bump to ≥5.25 (touches every game) would clear the warning; deferred
  as not worth the blast radius for a warning. **Verdict: proceed with `@xyflow/svelte`**
  (SSR-guarded — it is client-only — via `export const ssr = false`). Hand-built fallback
  is NOT needed.

**Step 2 — FlowDoc schema (`packages/engine-flow/src/types.ts`, the real "one doc").**
- Promoted the Phase-0 stubs into the full model: screen-id nodes referencing LayoutDoc
  scenes (`FlowScreen` + canvas `position`/`initial`); typed `FlowTransition` edges
  (`from`/`to` + a `FlowTrigger` of `bookEvent`/`complete`/`condition` + optional
  `FlowGuard` + `delayMs` + author `order`); a bounded `FlowGuard`/`FlowPredicate` over a
  CLOSED comparator set (`eq|neq|gt|gte|lt|lte|in`) — explicitly not an expression
  language (§11.4); a `FlowPin` model (4 dynamic roles `value`/`signal`/`action`/`gate`
  + 3 structural `enter`/`complete`/`active`, stable composite ids); plus a new `engine`
  accessor kind (`$engine.<key>`) and a `branch` choreography node. Kept sparse +
  override-friendly (parity rule §7) and back-compatible: the Phase-0 `executor.ts` /
  `dispatch.ts` still compile (`accessor.ts` gained `evaluateGuard`, the executor a
  `branch` case). `pnpm --filter engine-flow run typecheck` GREEN.

**Step 3 — pin-derivation (`packages/engine-flow/src/pins.ts`, the core reusable logic).**
- `deriveScreenPins(scene, resolver)` projects a LayoutDoc screen into pins from the FOUR
  existing `engine-layout` registries — value←instance `source` param, action←`action`,
  gate←`visibleSource` + the scene-level `Scene.visibleSource`, signal←a spine cue's
  `signal` in the resolved ComponentDef tree — plus the 3 fixed structural pins. Pin id =
  the §12 composite `${instanceId}::${role}:${key}` (structural = `${screenId}::${role}`);
  a missing ComponentDef ORPHANS its param-driven pins (flagged, never silently dropped,
  §4). Pure + Svelte-free (reads the authored doc, no registry calls), so it runs
  headlessly AND in the launcher loader. Reuses the registry param conventions — does NOT
  invent a new vocabulary (§3).
- **Verified headlessly:** `tools/flow-spike/pinDerivation.ts` (`pnpm --filter flow-spike
  run pins`) — 21/21 assertions GREEN against a representative `apps/lines`-shaped fixture
  (a base-game screen: win readout, spin button, gated free-spin counter, win-celebration
  spine cue). Asserts each pin class is derived with the right role/direction, ids stay
  stable under RENAME (label-only change) + REORDER, scene-gate + def-default-driven pins
  appear, the orphan path flags (not drops), and id order is deterministic.

**Step 4 — id-discipline check (§12): PASSED, not a blocker.**
- Scene Editor (`apps/launcher-api/src/routes/(app)/editor/+page.svelte`) mints a FRESH
  `n_…` id on every node ADD (lines 480, 523) and on paste/duplicate via `reassignNodeIds`
  (line 150: `node.id = freshNodeId()`, also dropping `slotId`); no edit path reassigns
  `id`. So "no id regeneration on edit, fresh id on duplicate/paste" HOLDS — pin identity
  is safe to key off `BaseNode.id`.

**Step 5 — `/flow` read-only page + typed model + command stack.**
- New route `apps/launcher-api/src/routes/(app)/flow/`. `+page.server.ts` REUSES the
  launcher's existing R2/scenes loading (`loadDoc` — the same LayoutDoc the Scene Editor
  reads) + `listComponents` + `resolveToolScope` (no new shared surface; gated on the
  `editor` entitlement; `ssr=false`). `+page.svelte` builds the read-only model and
  renders screen nodes (custom `FlowScreenNode.svelte` — dynamic pins as typed Svelte Flow
  handles, inputs left / outputs right, `active` as a status chip) + transition edges,
  with an orphaned-pin warning band. A typed editable model + a generic snapshot-based
  undo/redo command stack (`flowModel.client.ts` `createFlowHistory<T>`, burst-coalescing,
  mirroring the Scene Editor's history §12) is stood up now though editing lands Phase 2.
  `pnpm --filter launcher-api build` GREEN with the route.

**Still needs owner-verify live:** the actual `/flow` VISUAL render (the Svelte Flow
canvas drawing a real project's screens + derived-pin handles) needs the deployed launcher
with auth + R2 — the headless build proves it compiles/ships, not the pixels.

### Progress — Phase 2 DONE headlessly (2026-06-24)

Branch `flow/phase0-interpreter-spike` (continued). No game bump. RULE 9 fired: the
tool is now REGISTERED + documented in the same change.

**Macro authoring (`/flow` is now an editor, not read-only).**
- `flowModel.client.ts` promoted from a read-only model to the authoring model + a set of
  PURE FlowDoc command helpers (each returns a NEW doc, never mutates, so the command
  stack snapshots a clean before/after): `addScreen` (place a LayoutDoc scene; the first
  placed becomes `initial`), `removeScreen` (drops the node AND every edge touching it,
  promotes a new initial if needed), `moveScreen`, `setInitialScreen` (exactly one),
  `addTransition`/`removeTransition`/`editTransition` (trigger/guard/delay/order), with
  `freshTransitionId`. `buildFlowModel(doc, layout, components)` now treats the FlowDoc's
  `screens[]` as the authoritative placed set and projects the UNPLACED LayoutDoc scenes
  into a palette; each placed screen still derives its pins + orphan warnings live via
  `deriveScreenPins` (Phase-1, unchanged) so orphan warnings track component edits.
- `+page.svelte` rebuilt as the authoring surface: a left **Screens** palette (click to
  place an unplaced scene), node drag → `moveScreen` on drag-stop, drag-to-connect →
  `addTransition`, node-select inspector (mark Initial / Remove screen), edge-select
  → `EdgeInspector.svelte` (a NEW component: trigger kind + bookEvent name + delay + order
  + a single-predicate bounded guard authored as `$engine.*`/`$trigger.*`/literal +
  comparator), Undo/Redo buttons + Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, and a Save button.
  Every mutation flows through the Phase-1 command stack (`createFlowHistory<FlowDoc>`),
  so undo/redo round-trips. xyflow owns `nodes`/`edges` for live drag/selection; the
  FlowDoc stays the single source of truth, rebuilt into the canvas arrays only on
  structural changes (add/remove/undo/redo), not per drag frame.

**Save→R2 + load (the pipeline-discipline gate for this phase).**
- `normalizeFlowDoc` (NEW `packages/engine-flow/src/normalize.ts`, exported) is the single
  serialize/deserialize contract — pure + dependency-free, so the SAME coercion runs in the
  launcher save endpoint AND headlessly. It drops unknown fields, skips invalid
  screens/transitions, and validates choreography by node `kind` (the executor stays the
  source of truth for per-kind leaves, mirroring `editorStorage.normalizeNode`).
- `POST /api/flow/save` (NEW) mirrors `/api/rigger/save` EXACTLY for auth + scope: the
  shared `toolScope.gate({ tool: 'flow' })` resolves the SESSION-bound `(client, project)`
  and 403s without entitlement — NO hand-rolled auth/scope/R2. `flowStorage.ts` (NEW,
  mirroring `editorStorage.ts`) does the R2 read/write via `normalizeFlowDoc` +
  `getObjectText`/`putObjectText` at `flowDocKey` = `<client>/<project>/editor/flow.json`
  (sibling of `scenes.json`, NEW path in `projectPaths.ts`). `+page.server.ts` now gates on
  the `flow` entitlement and loads the saved FlowDoc (`loadFlowDoc`; absent ⇒ empty doc ⇒
  starts from the LayoutDoc screens with no transitions — parity-safe §7). Bake/deploy/pull
  is NOT wired (that is Phase 6).

**Tool registration (RULE 9 — same change).**
- `roles.ts`: `TOOLS.flow` ("Invisible Flow", bar name "Flow", `/flow`, node-graph emblem
  icon), `ROLE_TOOLS` (admin via `Object.keys`, + developer + artist), `TOOL_BAR_ORDER`
  (after `editor`), `TOOL_DOC_SLUG.flow = 'flow'`. First-draft `docs/tools/flow.md` written
  from the REAL Phase-2 route UI (palette / wiring / inspectors / undo-redo / save; flags
  what is NOT built yet — choreography Phase 3, pipeline Phase 6) + a `docs/tools/README.md`
  row; the prebuild `copy-tool-docs` mirrors `flow.md` so `/docs/flow` resolves.
  **A `docs-keeper` audit pass is expected to finalize the doc.**

**How it was verified headlessly**
- `tools/flow-spike/roundTrip.ts` (NEW; `pnpm --filter flow-spike run roundtrip`) proves the
  save→reload contract: a hand-authored FlowDoc (every transition shape bookEvent/complete/
  condition + a guard + a delay + author order + a per-screen choreography sub-graph +
  per-event choreography) survives author → `JSON.stringify` (what the page POSTs) →
  `normalizeFlowDoc` (what the endpoint stores) → JSON round-trip (what R2 returns) →
  `normalizeFlowDoc` (what the loader returns) IDENTICAL; plus idempotence, junk-field
  rejection without corrupting valid data, and absent-doc ⇒ sparse fall-through. PASSED.
- `pnpm --filter engine-flow exec tsc --noEmit` GREEN; `pnpm --filter launcher-api build`
  GREEN (the flow page + `EdgeInspector` + `flowStorage` + `/api/flow/save` all compile +
  ship); the existing `flow-spike` `parity` (Phase-0 gate) + `pins` (Phase-1) still GREEN.

**Still needs owner-verify live:** the actual `/flow` authoring UX in the browser —
placing/moving nodes, drag-to-connect, the edge/screen inspectors, undo/redo, and a
real Save → reload — needs the deployed launcher with auth + R2. The headless checks
prove the doc round-trips + the build ships, not the pixels/interactions.

**What's left**
- Phase 3 — micro choreography (double-click a node → author enter/while/exit).
- Phase 4 — the live generic mounter; Phase 6 — bake/pipeline (`flow?` in `BakedBundle`).

### Progress — Phase 3 DONE headlessly (2026-06-24)

Branch `flow/phase3-choreography` (off the Phase-1/2 work). No game bump. Authoring +
deterministic preview only — the runtime mounter swap (Phase 4) and bake (Phase 6) stay out.

**A — the choreography sub-editor (double-click a node).**
- `ChoreographyEditor.svelte` opens on double-clicking a macro screen node (xyflow 1.6 has
  no node-double-click event, so the page detects two clicks <350ms apart; an explicit
  "Edit choreography…" button in the screen inspector is the discoverable equivalent). It
  hosts the screen's enter/while/exit timeline as a node graph over the SAME
  `@xyflow/svelte` lib (§12), with phase tabs, a Sequence/Parallel root toggle, a per-node
  inspector, the Speed dial + the deterministic preview.
- The author node kinds are EXACTLY the executor's `ChoreographyNode` kinds — **Broadcast /
  Sequence / Parallel / Delay / Branch / ForEach** — no new vocabulary (§9.A). Edits go
  through a PURE, path-addressed command layer (`choreographyModel.client.ts`: a sub-graph
  is addressed by a `ChoreoTarget` = screen+phase or event; a node by a `ChoreoPath` of
  child indices / `then`/`otherwise`/`body` slots), each returning a NEW FlowDoc, routed
  through the SAME `createFlowHistory` undo/redo stack as the macro graph and the existing
  `POST /api/flow/save`. `flattenChoreography` projects the tree onto xyflow nodes+edges
  (container→child links, branch/forEach slots labelled).

**B — the Broadcast palette = the game's REAL emitter vocabulary (sourced honestly).**
- A Broadcast node's event picker lists the game's actual emitter events, grouped by source
  component. **Honest sourcing finding:** that vocabulary lives in each game's
  `typesEmitterEvent.ts` as a COMPILE-TIME TypeScript discriminated union — it has no
  runtime/serialized form, and the launcher loads a project from R2, not from game source.
  So the catalog is **PASSED IN**, exactly the way the LayoutDoc + component defs already
  are (it is NOT something the launcher can reflect from R2 today). A new serializable
  `EmitterVocabulary` shape (`engine-flow/src/emitterVocabulary.ts`) defines that passed-in
  catalog; a bundled `DEFAULT_EMITTER_VOCABULARY` is transcribed verbatim from the real
  `apps/lines`/book-of emitter unions (Board/Win/Sound/FreeSpin*/Transition/SpecialBook +
  the shared UI cues the handlers broadcast) — the game's ACTUAL vocabulary, not invented.
  The authoring UI is agnostic to the source; Phase 6 can export the game's union as data
  alongside the FlowDoc and feed the SAME shape instead of the default.

**C — the Speed scalar.**
- A per-preview Speed dial (1× / 2× turbo) feeds the executor's injected `timeScale()`. The
  executor already divides every Delay by `timeScale()` (the coded `ms / timeScale()` call
  sites), so the authored speed flows straight into the runtime scalar the executor reads —
  no new plumbing, kept a bounded scalar (not a script). Proven: a 300ms delay becomes
  150ms at 2× in the preview timeline.

**D — live preview against a DETERMINISTIC feed (§11.6).**
- `engine-flow/src/previewExecutor.ts` + `ChoreoPreview.svelte` run the authored
  choreography through the REAL `runChoreography` against a recording runtime on a VIRTUAL
  clock (delays advance the clock, no real time passes), fed by a FIXED book payload
  (`FIXED_PREVIEW_TRIGGER`/`FIXED_PREVIEW_ENGINE`, mirroring the mock-RGS/test-server book
  shape — never a random outcome), producing the ordered broadcast+delay timeline with the
  speed scalar applied (the Phase-0 parity-harness shape). This is the DETERMINISTIC half of
  preview: the emitter-call ORDER + TIMING, reproducible run-to-run, so a delay tweak shows
  its millisecond shift immediately. **Scoped honestly:** a TRUE visual preview (the game
  actually animating) needs the running game + its real emitter + Pixi mounter — that is the
  live generic mounter (Phase 4) and is explicitly NOT done here; the UI flags it, it is not
  faked.

**How it was verified headlessly**
- `pnpm --filter engine-flow run typecheck` GREEN; `pnpm --filter launcher-api build` GREEN
  (the flow page + `ChoreographyEditor`/`ChoreoNode`/`ChoreoNodeInspector`/`ChoreoPreview` +
  `/api/flow/save` all compile + ship).
- `tools/flow-spike/roundTrip.ts` (`pnpm --filter flow-spike run roundtrip`) extended to
  author a non-trivial choreography exercising EVERY node kind (sequence/parallel/delay,
  broadcast in all three shapes, branch+else, forEach over `$trigger.wins` with an `$item`
  payload). It asserts the choreography round-trips canonical through save→reload, AND drives
  it through the REAL executor via the deterministic preview: 2 wins ⇒ 2 forEach broadcasts,
  the parallel branch fires both children, the branch takes the then-path at winLevel≥3, the
  timeline is identical run-to-run (determinism), and the 300ms delay halves to 150ms under
  2× (speed scalar). Phase-0 `parity` + Phase-1 `pins` spikes still GREEN.
- **Incidental fix:** added the missing `flowDocKey` export to `projectPaths.ts` — Phase-2's
  `flowStorage.ts` imported it but it was never added, so the launcher build was broken on
  the inherited branch.

**Still needs owner-verify live (deployed launcher + auth + R2):** the in-browser
choreography authoring — double-clicking a node, add/edit/remove nodes, the Broadcast event
picker, the dispatch-shape + payload + branch-guard + forEach editors, undo/redo, and a real
Save → reload — plus the preview panel pixels. The headless checks prove compile/ship/
round-trip/determinism, not the interactions or pixels.

**What's left**
- Phase 4 — the live generic mounter (mount authored screens + run choreography in a real
  game, retiring §20.1) + the all-three transition triggers wired to runtime.
- Phase 6 — bake/pipeline (`flow?` in `BakedBundle`); export the game's emitter union as
  data to replace `DEFAULT_EMITTER_VOCABULARY`.
- RULE 9: `docs/tools/flow.md` needs a `docs-keeper` audit pass to document the new
  choreography sub-editor (Phase 3 materially extends the tool UI).

### Progress — Phase 4 DONE headlessly + build-shipped (2026-06-24)

Branch `flow/phase4-runtime-mounter` (off the latest `main`). No game submodule bump —
Phase 4 proves the runtime in the dev game `apps/lines` only. The interpreter stops being a
headless library and runs inside a real game, replacing `Game.svelte`'s hard-coded mounting
and wiring live transitions, WITHOUT regressing the game (the §7 invariant is held by
construction + a fresh 27-assertion harness).

**A — the generic scene mounter (retires §20.1).**
- `mounter.ts` promoted from interface-only to the **decision layer** (`createSceneMounter`):
  `resolve(screenId)` returns `{ kind: 'authored', scene }` ONLY when the FlowDoc carries
  that screen AND a backing LayoutDoc `Scene` exists, else `{ kind: 'fallThrough' }` — the
  single §7 boundary. **Key finding:** the live Pixi mount is NOT a new path — the engine's
  existing `<LayoutScene>` ALREADY is a generic mounter (a `game`-space scene self-wraps in
  `<MainContainer>`, `standard` in `<MainContainer standard>`, `canvas`/`background` mount
  raw; it also applies the `Scene.visibleSource` gate). So the mounter owns only the
  DECISION (which scene, authored vs coded); `<LayoutScene>` owns the MainContainer scaling +
  overlays. A new `FlowMount.svelte` (in `engine-layout/svelte`) renders the resolved scene
  via `<LayoutScene>` or the coded `{@render fallback()}` with **no wrapping container**, so
  the fall-through is byte-identical. An authored-but-no-backing-scene screen falls through
  (never a blank mount).

**B — transitions, all three triggers (§6).**
- `presentation.ts` (`createPresentationMachine`) — the **presentation HSM**, pure +
  framework-free (imports no rune modules; the `$engine.*` reader + runtime are injected).
  Fires edges on: (1) `bookEvent` (`onBookEvent` — matches the arriving book event `type`),
  (2) `complete` (`onComplete` — the active screen's exit choreography signalled done, the
  genuinely-new self-driving output §6.2), (3) `condition` (`evaluate()` — re-checks guard-
  only edges when the game pings an observed value change). Each edge honours an optional
  bounded `guard` + `delayMs ÷ timeScale()`; outgoing edges are tried in author `order`
  (unguarded = default); a swap runs the old screen's `exit` then the new screen's `enter`
  choreography; concurrent triggers are serialized. **Observe-don't-drive (§12):** the HSM
  exposes ONLY `onBookEvent`/`onComplete`/`evaluate`/`start` + reads — no `send`/`transition`
  into the platform FSM (the harness asserts this surface). XState stays the single source of
  truth; Flow reacts.
- `interpreter.ts` (`createFlowInterpreter`) — the single boot object tying HSM + mounter +
  the Phase-0 book-event dispatcher together. INERT with no FlowDoc (active screen
  `undefined`, every mount + event falls through). `dispatchBookEvent` runs the event's
  presentation (authored choreography OR coded fall-through) AND lets the macro graph take a
  `bookEvent` transition — the two are orthogonal (§6.1).

**C — live wiring into `apps/lines` (PARITY-FIRST).**
- `game/flowRuntime.svelte.ts` builds the interpreter wired to the game's REAL primitives —
  the same `eventEmitter`, `stateBetDerived.timeScale`, `waitForTimeout` the coded path uses
  (§8) — and resolves screen ids against the live editor doc's scenes (the real scenes,
  untouched). `game/flowInterpreterHolder.ts` is the singleton the play path reads.
  `game/utils.ts`'s `playBookEvent`/`playBookEvents` route through the interpreter WHEN ACTIVE
  (the same serial `sequence()`) else defer to the coded `createPlayBookUtils` unchanged.
  `Game.svelte` wraps the basegame mount in `<FlowMount>` and builds the interpreter once
  `loadEditorScenes()` resolves, then `start()`s it.
- **The §7 invariant by construction:** the FlowDoc source is ABSENT by default (a
  `window.__IE_FLOW_DOC__` dev-override hook for Phase-4 live-verify; the baked `flow` slot is
  Phase 6), so `createLinesFlow` returns `undefined` ⇒ holder null ⇒ `basegameMount` undefined
  ⇒ `<FlowMount>` renders the original `<LayoutScene scene={basegameBelowReel} />` and the
  book-event path is the coded one. `apps/lines` is byte-identical to current `main`.

**How it was verified headlessly + build-shipped**
- `pnpm --filter engine-flow exec tsc --noEmit` GREEN. New `tools/flow-spike/phase4Runtime.ts`
  (`pnpm --filter flow-spike run phase4`) — 27/27 assertions GREEN against the REAL engine-flow
  HSM/mounter/interpreter: mounter authored-vs-fall-through (incl. authored-but-no-scene ⇒
  fall-through; overlay `visibleSource` carried through to `<LayoutScene>`); all 3 triggers
  drive transitions; author-order + guard precedence (a guarded `winLevel≥3` edge wins over a
  later default; guard fails ⇒ the default fires); `delayMs` 600→300 under turbo; the HSM
  drives no platform transition; the full interpreter is inert with no FlowDoc AND falls
  through per-event with one authored. Phase-0 `parity` + Phase-1 `pins` + Phase-2/3
  `roundtrip` spikes still GREEN.
- **Build-shipped:** `pnpm --filter lines build` GREEN; the `__IE_FLOW_DOC__` hook + the
  interpreter modules are confirmed present in the minified client bundle (shipment, not just
  compile); `pnpm --filter engine-layout build` GREEN with `FlowMount`.

**Semantic-fidelity risks found (surfaced, not papered over)**
- The mounter is a DECISION layer over `<LayoutScene>`, NOT a re-implementation of the Pixi
  mount — chosen specifically because `<LayoutScene>` already owns MainContainer scaling +
  the gate; reproducing that in engine-flow would have risked the §11.3 regression. The one
  consequence: an authored basegame screen replaces ONLY the basegame layers, not the board
  MainContainer (the reel is engine-owned, not a flow screen) — correct, but means the
  above-reel split is bypassed when an authored basegame is active (`{#if !basegameMount}`),
  which is the intended "the authored scene owns its own stacking" semantics. Phase 5
  per-screen parity must confirm an authored basegame reproduces the below/above-reel z-order.
- `createBonusSnapshot` (a resume-only coded handler) calls `playBookEvent`, which re-routes
  through the interpreter when active. With no FlowDoc (default) this is the coded path
  (parity); when a FlowDoc is authored the replayed events get the same authored treatment —
  the faithful behaviour, but Phase 5 should add a resume-path parity check.

**Still needs owner-verify live (the remaining gate):** the running WebGPU bundle —
`preview_screenshot` times out on it (project memory), so verify via the documented
`app.stage` scene-graph read / dynamic-import override, NOT a screenshot: (1) the DEFAULT
`apps/lines` boot renders byte-identical with the interpreter inert; (2) injecting
`window.__IE_FLOW_DOC__` for `basegame` + a `winInfo` choreography makes the interpreter mount
the authored scene and animate identically turbo on/off. The headless harness proves the
decision logic + async/timing; the live render is the one thing headless can't prove (the
structuredClone-class build≠runtime risk).

**What's left**
- Phase 5 — full migration: move the WHOLE `apps/lines` flow off coded mounting + handler map
  to an authored FlowDoc, per-screen + per-event parity-checked.
- Phase 6 — bake/pipeline (`flow?` in `BakedBundle`; export the game's emitter union as data
  to replace `DEFAULT_EMITTER_VOCABULARY` + the `__IE_FLOW_DOC__` dev hook).
- RULE 9: Phase 4 is engine/runtime only — no `/flow` tool UI changed, so `docs/tools/flow.md`
  needs no Phase-4 update (the Phase-3 choreography `docs-keeper` audit is still pending).

### Progress — Phase 5 DONE headlessly + build-shipped (2026-06-24)

Branch `flow/phase5-migration` (off the latest `main`). No game submodule bump — Phase 5 is
`apps/lines`-only (owner mirrors to Borut after this lands). No XState/math/pipeline touched.
The WHOLE `apps/lines` presentation flow is now authorable as a complete FlowDoc that, when
loaded, runs the game ENTIRELY through the interpreter with per-event parity proven turbo
on/off — while the default (no FlowDoc) boot stays byte-identical to current `main`.

**The reconciliation that made full migration possible (the §13 / §11.5 crux).**
- The choreography vocabulary is emitter-broadcast-only, but every coded `bookEventHandlerMap`
  handler also does NON-emitter work the bounded vocabulary deliberately can't express: state
  mutations (`stateGame.gameType = …`, `stateBet.winBookEventAmount = …`, the `stateUi.*`
  flags), board ops (`enhancedBoard.spin(…)`, the Book-of column morph), the win-level sound
  clusters (which read LIVE state, not the trigger payload), and the bonus record. Growing the
  vocabulary to cover these would be the scripting-VM line §11.4 forbids.
- **Resolution — one bounded primitive: the `effect` choreography node** (`engine-flow`). A
  named, game-registered side effect — the EXACT `declare ≠ implement` analogue of
  `registerComponentActions`. The FlowDoc *declares* `{ kind:'effect', name, payload }` (payload
  = whitelisted accessors); the game *implements* a CLOSED map at boot, injected on
  `FlowRuntime.effect`. Awaited like a Broadcast, so an effect mirroring an awaited coded
  operation blocks the sequence identically; an un-registered effect is a no-op (parity-safe).
  This is NOT a VM — a closed registry of named effects whose bodies live in game code, never
  authored in the doc. Also added a `$context.*` accessor (the dispatch context `{ bookEvents }`
  the coded handler's 2nd arg carries) so a reveal's multiple-reveal check + the resume snapshot
  resolve without leaving the bounded model. Both new kinds round-trip through `normalizeFlowDoc`
  (the bake-path contract) idempotently — verified.

**A — the COMPLETE apps/lines FlowDoc (`apps/lines/src/game/flowDoc.ts`, committed fixture).**
- `LINES_FLOW_DOC` authors the `basegame` screen node (`initial`) + a per-event choreography for
  EVERY migratable book event: `reveal`, `winInfo`, `setTotalWin`, `setExpandingSymbol`,
  `expandBookColumns`, `freeSpinTrigger`, `updateFreeSpin`, `freeSpinEnd`, `setWin` (9 events).
  Each choreography is read straight off `bookEventHandlerMap.ts`: a sync `broadcast` ⇒ Broadcast
  node; an awaited `broadcastAsync` ⇒ `{async:true,await:true}`; a fire-and-forget `broadcastAsync`
  ⇒ `{async:true,await:false}`; `waitForTimeout(ms)` ⇒ Delay; serial `sequence(list,…)` ⇒ ForEach
  `sequence`; every non-emitter leaf ⇒ an `effect` node.
- **The effect bodies (`apps/lines/src/game/flowEffects.ts`) are lifted VERBATIM** from the coded
  handler leaves — `bookEventHandlerMap.ts` now IMPORTS the three shared helpers (`winLevelSoundsPlay`,
  `winLevelSoundsStop`, `animateSymbols`) from there, so the coded path and the effects share ONE
  source of truth per leaf. An effect is therefore byte-identical to its coded counterpart by
  CONSTRUCTION (reproduced, never re-derived). The coded handler map is otherwise unchanged.
- `finalWin` (coded no-op) and `createBonusSnapshot` (resume-only) are DELIBERATELY left
  UN-authored ⇒ they fall through to their coded handlers, keeping the §7 fall-through exercised
  end-to-end during the migration. The free-spin intro/outro/counter/specialBook/win overlays are
  feed-driven (`visibleSource`), NOT exclusive screen swaps, so per §5 they are NOT screen nodes —
  they stay feed-driven exactly as coded. `apps/lines`' only exclusive screen is `basegame`.
- A committed dev hook (`window.__IE_FLOW_LINES__`) sources `LINES_FLOW_DOC` for live-verify,
  alongside the existing `window.__IE_FLOW_DOC__` ad-hoc hook. NEITHER is set on a normal boot ⇒
  `loadFlowDoc()` returns `undefined` ⇒ the interpreter is inert ⇒ byte-identical to `main`.
  (Phase 6 replaces the hook with the baked `flow` slot sourcing the SAME doc.)

**B — the two Phase-4 follow-ups resolved.**
- **B.1 Above-reel z-order.** Game.svelte now splits the AUTHORED basegame scene at its top-level
  `reelGrid` index exactly as the coded path splits `basegameScene`: `<FlowMount>` mounts the
  below-reel slice, the engine-owned board MainContainer mounts next, and the above-reel slice
  renders AFTER it — UNCONDITIONALLY (the old `!basegameMount` gate is gone). So an authored
  basegame reproduces the exact below-reel → board → above-reel stacking. No reelGrid in the
  authored scene ⇒ single below-reel pass (parity with a nested-reelGrid coded boot).
- **B.2 Resume path.** `createBonusSnapshot` stays coded (its `_.findLast` selection is exactly
  the bounded-VM line we don't cross); the events it replays (`freeSpinTrigger`/`updateFreeSpin`/
  `setTotalWin`) route through `playBookEvent` ⇒ the interpreter when active ⇒ get their AUTHORED
  choreography. The harness proves the resume replay SEQUENCE's interpreter op log equals the
  coded play of the same events in the same order (39 ops, turbo on/off) — the snapshot-then-resume
  is parity-correct because each replayed event is parity-proven and the order is preserved.

**C — per-event parity harness (the gate): `tools/flow-spike/phase5Migration.ts`.**
- `pnpm --filter flow-spike run phase5` — for EACH of the 9 events it runs the coded handler body
  (transcribed verbatim, driving a shared recording rig through the SAME effect leaves) AND the
  interpreter over the REAL `LINES_FLOW_DOC`, asserting the ordered op log (broadcasts with the
  3-way split + named effect invocations + resolved payloads + awaited completions + scaled
  delays) is IDENTICAL turbo ON and OFF. **18/18 per-event checks GREEN** (op counts:
  reveal 7, winInfo 5, setTotalWin 2, setExpandingSymbol 3, expandBookColumns 4, freeSpinTrigger 29,
  updateFreeSpin 8, freeSpinEnd 27, setWin 15). Plus coverage (all migratable events authored;
  finalWin + createBonusSnapshot deliberately fall through; basegame is the initial exclusive
  screen) + the B.2 resume-replay parity (39 ops, turbo on/off). **NO DIVERGENCE FOUND.**
- Subtleties caught + fixed during authoring (each would have visibly broken the game): the
  `freeSpinTrigger` interleave of `setFreeGameType` vs the `freeSpinIntroHide` broadcast vs the
  `freeSpinIntroShow=false` flag (split into separate effects to match the exact coded order); the
  `updateFreeSpin` `current = amount + 1` arithmetic (an effect, not an accessor — the bounded
  model has no arithmetic); and that `winLevelSoundsStop` branches on live `gameType`
  (`bgm_freespin` in freegame/`freeSpinEnd` vs `bgm_main` in basegame/`setWin`) — the harness
  models both branches per-event.

**How it was verified headlessly + build-shipped**
- `pnpm --filter engine-flow exec tsc --noEmit` GREEN (the `effect` node + `context` accessor +
  `FlowEffect`/`FlowRuntime.effect` additions). `pnpm --filter lines build` GREEN and the dev
  server boots clean; the `__IE_FLOW_LINES__` hook + the effect names (`revealBoard`,
  `winLevelSoundsPlay`, …) are confirmed present in the minified client bundle (shipment).
  `pnpm --filter engine-layout build` GREEN. The FlowDoc survives `normalizeFlowDoc` round-trip
  idempotently with all 9 events + every `effect` node preserved (bake-ready). The Phase-0
  `parity`, Phase-1 `pins`, Phase-2/3 `roundtrip`, and Phase-4 `phase4` spikes all still GREEN.
- **Default-inert invariant proven at the bundle level:** `loadFlowDoc` gates on the two globals
  only; with neither set the FlowDoc is never sourced ⇒ `createLinesFlow` ⇒ `undefined` ⇒ holder
  null ⇒ the coded mounting + coded `bookEventHandlerMap` run unchanged. `apps/lines` default boot
  is byte-identical to current `main`.

**Still needs owner-verify live (the one thing headless can't prove — the WebGPU bundle):**
`preview_screenshot` times out on WebGPU (project memory), so verify via the documented
`app.stage` scene-graph read / dynamic-import override, NOT a screenshot. Two checks:
  1. **Default boot** (no globals) renders + animates byte-identical to `main` (the interpreter is
     inert — confirmed at the bundle/build level here, needs a live eyeball for full confidence).
  2. **Full FlowDoc** — set `window.__IE_FLOW_LINES__ = true` before boot (or inject it via a
     dynamic-import override) and run a real spin INCLUDING free spins + a win + a resume: the
     interpreter mounts the authored basegame (with the below/above-reel z-order intact) and
     animates IDENTICALLY turbo on/off. The headless harness proves the mount decision + the
     emitter/effect call sequence + timing; the live render is the structuredClone-class
     build≠runtime risk only a real browser closes.

**What's left**
- Phase 6 — bake/pipeline (`flow?` in `BakedBundle`; the baked `flow` slot replaces the
  `__IE_FLOW_LINES__`/`__IE_FLOW_DOC__` hooks; export the game's emitter union + the effect-name
  catalog as data alongside the FlowDoc). When the engine `effect`-node work must reach Book of
  Borut, bump its `engine` submodule (owner mirrors after this lands).
- RULE 9: the Phase-3 choreography `docs-keeper` audit of `docs/tools/flow.md` is still pending;
  the editor UI could later surface the `effect`/`context` node kinds (authored-as-data today).

### Progress — Phase 6 DONE headlessly + build-shipped (2026-06-24)

Branch `flow/phase6-pipeline` (off the latest `main`). No game submodule bump yet — the
ship chain is proven in the launcher + `apps/lines`; bumping Borut's `engine` submodule is
the owner's mirror step once this lands. This closes RULE 8 for the FlowDoc: the authored
presentation graph now travels the SAME export→deploy→bake→register chain as the art / font /
symbol docs, so a game ships its flow instead of running only its coded path.

**A — the export step (the FlowDoc analogue of `editorArtExport.ts`).**
- `apps/launcher-api/src/lib/server/flowExport.ts` (`exportEditorFlow`) reads the authored
  `editor/flow.json`, re-normalizes it through `normalizeFlowDoc` (the SAME serialize contract
  `/api/flow/save` + the headless round-trip use, so the deployed doc is canonical), and writes
  `deploy/flow.json`. Unlike art/font/symbol exports the FlowDoc carries **no binary assets** —
  it only references scenes the Scene Editor already exported — so there is **no `pull` step**,
  just the embedded doc. An absent / invalid / EMPTY (no screens/transitions/events)
  `editor/flow.json` exports nothing and **prunes** any stale `deploy/flow.json`, so an
  un-authored project bakes no flow (parity). Idempotent.
- `apps/launcher-api/src/routes/api/editor/export-flow/+server.ts` — the build-time trigger,
  gated by the SAME shared `EDITOR_DOC_SECRET` (`?k=`) as `/api/editor/doc` (a build runner has
  the token, no launcher session).

**B — bake + the live-runtime bundle both embed the slot.**
- `bake-editor-doc.mjs` POSTs `/api/editor/export-flow` right alongside the art/font/symbol
  exports, then embeds the returned doc as `BakedBundle.flow` — but ONLY when it is non-empty
  (the `authored` gate: ≥1 screen/transition/event). An empty/absent doc leaves `flow`
  undefined so the bundle is **byte-identical** for every game with no flow work (§7). The
  bake log line gains a `flow={N screens/N transitions/N events}` note.
- `runtimeBundle.ts` (the `/api/editor/runtime-bundle` path the editor preview reads) runs
  `exportEditorFlow` in the same `Promise.all` as the other exporters and forwards a non-empty
  `flow` the same way, so the live editor runtime and the baked game resolve the identical slot.

**C — the game registers the baked slot (parity-first).**
- `apps/lines/src/editor-scenes.ts` adds `flow?: FlowDoc` to `BakedBundle` and a
  `bakedFlowDoc()` reader mirroring `bakedSymbolMap`'s **runtime-bundle → baked → undefined**
  precedence.
- `apps/lines/src/game/flowRuntime.svelte.ts#loadFlowDoc()` now resolves, in order: the
  `__IE_FLOW_DOC__` dev override → the `__IE_FLOW_LINES__` committed fixture → **`bakedFlowDoc()`
  (the real ship source)**. UNDEFINED on an un-baked / un-authored boot (the checked-in
  `baked-editor-bundle.json` placeholder has `doc:null` and no `flow` key) ⇒ the interpreter is
  inert ⇒ the coded mounting + `bookEventHandlerMap` run, byte-identical to current `main`.

**How it was verified headlessly + build-shipped**
- `tools/flow-spike/phase6Pipeline.ts` (`pnpm --filter flow-spike run phase6`) — 12/12 GREEN
  against the REAL `engine-flow` interpreter + the REAL `LINES_FLOW_DOC`, modelling the exact
  ship chain: (1) the authored doc survives `normalizeFlowDoc` (export/bake contract)
  idempotently with every screen/event intact; (2) baked PRESENT ⇒ `loadFlowDoc()` returns it ⇒
  interpreter `isActive`; (3) baked ABSENT ⇒ undefined ⇒ interpreter INERT (coded path, §7);
  (4) an authored-but-EMPTY doc is treated as absent by the `authored` gate (parity); (5) the
  dev-hook escape hatches still win over the baked slot. Phase-0 `parity` / Phase-1 `pins` /
  Phase-2-3 `roundtrip` / Phase-4 `phase4` / Phase-5 `phase5` spikes ALL still GREEN.
- `pnpm --filter engine-flow exec tsc --noEmit` GREEN; `pnpm --filter launcher-api build` GREEN
  (the export endpoint + `flowExport` + the bundle slot ship); `pnpm --filter lines build` GREEN
  with `bakedFlowDoc()` + the baked-source `loadFlowDoc()` confirmed in the minified client
  bundle (shipment, not just compile). The checked-in placeholder bundle has no `flow` key ⇒ the
  dev boot stays inert.

**Held for a Phase-6 follow-up (NOT blocking the ship gate):** exporting the game's **emitter
union + effect-name catalog as data** to replace the hardcoded `DEFAULT_EMITTER_VOCABULARY` in
the `/flow` choreography palette. This is an AUTHORING-fidelity improvement only — it changes
which Broadcast events the picker offers, NOT the runtime (the executor broadcasts whatever the
FlowDoc says). The default vocabulary is already transcribed verbatim from the lines/book-of
emitter unions, and Borut IS a book-of game, so the default already covers it; the codegen step
(read each game's compile-time `typesEmitterEvent.ts` → a serializable catalog → feed the editor)
is deferred to Phase 7 authoring-UX. **Owner-verify live (the one thing headless can't prove):**
bake a project that authored a flow (or point a build at one) and confirm the shipped game boots
with the interpreter ACTIVE off the baked slot — verify via the `app.stage` read / dynamic-import
override per the WebGPU `preview_screenshot` limitation, not a screenshot.

**What's left**
- Phase 7 — authoring UX (node/palette search, copy/paste subgraphs, validation) + the held
  emitter-union/effect-name export above; surfacing `effect`/`context` node kinds in the editor.
- The Phase-3 `docs-keeper` audit of `docs/tools/flow.md` (still pending from Phase 3).
- Mirror the `engine-flow` runtime to Book of Borut (bump its `engine` submodule) when its flow
  is authored + baked — the owner's step.

### Progress — Phase 7 (Authoring UX) IN PROGRESS, headless-verified (2026-06-24)

Branch `flow/phase7-authoring-ux` (off the latest `main`). EDITOR-ONLY — the runtime
interpreter, the games, XState/math and the bake pipeline are untouched, so there is no
game-parity risk; the FlowDoc still round-trips clean (the `roundtrip` spike stays green).
The first Phase-7 item (readable edge labels) landed earlier; this slice adds the rest of
§9 row 7 — validation, search, copy/paste, the authored-vs-coded diff, and pin tooltips.

**1 — Validation surfacing (`engine-flow/src/validate.ts`, `validateFlowDoc`).**
- A PURE pass over the macro graph (Svelte-free, dependency-free, runs headlessly + in the
  launcher) flagging, as WARNINGS (never blocks authoring, §7): **unreachable** screens (no
  transition path from `initial`), **dead-end** screens (a non-initial screen with no
  outgoing edge; a single-screen flow like `apps/lines` basegame is terminal-by-design and
  NOT flagged), **no-initial** / **multiple-initial**, and **orphaned-pins** (folded in from
  the per-screen orphan summary the model already derives via `deriveScreenPins`, §4). Each
  node-scoped issue carries a clickable `screenId`. Surfaced in a new
  `ValidationPanel.svelte` (click an issue to select/focus the node), an inline amber node
  border (`FlowScreenNode` `invalid` flag), and a `⚠ N issues` sub-bar badge.

**2 — Node/palette search.** A **Filter screens** box on the palette (filters unplaced
scenes by name/id) + a **Find on canvas** box (lists placed screens matching a query;
click → select + focus the node). Pure `$derived` filters; the validation + diff panels are
also click-to-focus through the same `focusScreen`.

**3 — Copy/paste subgraphs (`flowModel.client.ts` `copyScreens`/`pasteScreens`).** Copy the
selected screen(s) WITH choreography + the transitions wholly internal to the selection;
paste mints **fresh** transition ids and remaps endpoints (§12 — a paste is a new node, no
id recycling). Because a screen node id IS its backing scene id (and a scene is placed at
most once), paste maps each copied screen onto a target scene: re-pastes the same scene when
free (e.g. after a cut) else onto the next UNPLACED scene, carrying the choreography. Wired
through the command stack (undoable) + Ctrl+C/Ctrl+V (suppressed in text fields).

**4 — Flow-diff vs coded default (`engine-flow/src/diff.ts`, `diffFlowDoc`).** A PURE
summary of which screens/events the FlowDoc AUTHORS (interpreter-driven) vs falls through to
the CODED default (§7) — the same predicate the dispatch uses. Rendered by a new
`FlowDiffPanel.svelte`: a compact summary line ("N of M screens authored · N of M events
authored"), per-screen enter/while/exit phase indicators (click-to-focus), and per-event
authored/coded tags against `DEFAULT_CODED_EVENTS` (the `apps/lines`/Book-of handler-map
keys). It REPORTS the §7 boundary, never changes behaviour.

**5 — Visual polish.** Pin labels now carry a `title` tooltip (role + full binding, with an
orphaned note) so a truncated handle label is readable on hover; node title gets a `title`
too; handle row spacing nudged; the `invalid` node marker added. Consistent with the dark
theme (the edge-label chip palette).

**How it was verified headlessly**
- `tools/flow-spike/phase7Authoring.ts` (`pnpm --filter flow-spike run phase7`) — 30/30
  GREEN against the REAL `engine-flow` helpers: validation across every issue class
  (unreachable island, dead-end leaf, no/multiple-initial, single-screen-clean, orphan
  fold-in with count), the authored-vs-coded diff (per-screen phases + per-event tags +
  summary), and the copy/paste invariant (a pasted subgraph with fresh ids round-trips
  canonical + idempotent through `normalizeFlowDoc`, all ids unique). `pnpm --filter
  engine-flow exec tsc --noEmit` GREEN; `pnpm --filter launcher-api build` GREEN (the page +
  `ValidationPanel` + `FlowDiffPanel` ship). The Phase-0 `parity`, Phase-1 `pins`,
  Phase-2/3 `roundtrip`, Phase-4 `phase4`, Phase-5 `phase5` and Phase-6 `phase6` spikes ALL
  still GREEN (copy/paste yields round-trip-clean docs).

**Still needs owner-verify live (the authed page can't be driven headlessly):** the in-
browser Phase-7 interactions — palette/canvas search, Copy/Paste (incl. Ctrl+C/V), the
validation panel + inline node markers, the diff panel, and the pin tooltips — on the
deployed launcher with auth + R2. Headless proves the helpers + build/ship/round-trip, not
the pixels/interactions.

**What's left**
- A `docs-keeper` audit of `docs/tools/flow.md` (the Phase-3 audit is still pending AND the
  Phase-7 sections are a flagged first-draft; the choreography Broadcast/effect picker now
  sources the game's EXPORTED vocabulary + offers an effect-name picker — see the emitter-vocab
  item below — which the audit should document).
- Mirror the `engine-flow` runtime to Book of Borut (bump its `engine` submodule) when its
  flow is authored + baked — the owner's step.

### Progress — Phase 7 emitter-vocabulary export DONE headlessly (2026-06-24)

Branch `flow/phase7-emitter-vocab` (off the latest `main`). EDITOR/CODEGEN-ONLY — no runtime,
game, XState/math or pipeline code touched, and the new `flowVocabulary.ts` is imported by
NOTHING in the game runtime (only the spike). This is an **authoring-fidelity** improvement:
it changes which Broadcast events + effect names the `/flow` choreography palette OFFERS, never
the runtime (the executor broadcasts/invokes whatever the FlowDoc declares regardless). **Zero
game-parity risk; no submodule bump.** Resolves the held follow-up from Phase 3 (§B,
~lines 263-275) / Phase 6 (~lines 599-609).

**Mechanism chosen — build-time CODEGEN (not a pipeline export), and why.** The emitter union
(`typesEmitterEvent.ts` + the per-component `EmitterEvent*` unions + the shared
`EmitterEventUi`/`Modal`/`HotKey` unions a game composes) and the effect catalog
(`flowEffects.ts` keys) are properties of the GAME SOURCE — identical across every project built
on that game, NOT per-project authored data living in R2. Pushing a per-game constant through
export→deploy→bake→R2-per-project (the option-b path the FlowDoc itself travels) would invent
per-project storage for non-per-project data. So codegen is the honest fit: it parses each
game's source into a committed, serializable `EmitterVocabulary` fixture (mirroring the existing
committed game-source fixtures `flowDoc.ts`/`flowEffects.ts`) and surfaces it through the
launcher exactly the way the LayoutDoc + component defs are passed in (design doc §3/§11).

**What landed**
- `scripts/gen-flow-vocabulary.mjs` (run `pnpm gen:flow-vocab`, check `pnpm gen:flow-vocab:check`)
  — a deterministic parser of the simple `{ type: 'name'; field: Type }` union members + the
  `flowEffects` map keys. Emits TWO committed files (Prettier-formatted in-script so write +
  `--check` are idempotent): `apps/lines/src/game/flowVocabulary.ts` (`LINES_EMITTER_VOCABULARY`,
  35 events incl. the shared UI cues + `soundFade` the hand-written default missed, 20 effects)
  and `apps/launcher-api/src/lib/flowVocabularies.ts` (the launcher registry keyed by LayoutDoc
  `gameType` + `resolveFlowVocabulary(gameType)`, which falls back to `DEFAULT_EMITTER_VOCABULARY`
  for any unrecognized game — the §7 parity-safe default). `lines`+`bookOf` map to the lines
  vocab (the shared lines/book-of union covers Book of Borut); everything else ⇒ default.
- `engine-flow/src/emitterVocabulary.ts` gained `EmitterEffectDef` + `EmitterVocabulary.effects?`
  + `findEmitterEffect`; `DEFAULT_EMITTER_VOCABULARY` is UNCHANGED (still the fallback).
- The editor now PREFERS the exported vocabulary: `/flow` `+page.server.ts` resolves it from the
  LayoutDoc `gameType` via `resolveFlowVocabulary` and passes it as `data.vocabulary`; `+page.svelte`
  feeds that to `ChoreographyEditor` instead of the hardcoded `DEFAULT_EMITTER_VOCABULARY`.
- **Effect-name catalog surfaced (the doc's "emitter union + effect-name catalog" pairing).**
  `ChoreoNodeInspector` renders an effect-name picker (from `vocab.effects`) for an `effect`
  node, with a "not a registered effect" warning; `editChoreoNode`/`ChoreoNodeEdit` gained the
  `effect` `name` edit; `choreoNodeSummary` gained the previously-missing `effect` case so an
  effect node labels on the canvas. (Adding `effect` as a NEW addable node kind stays deferred —
  this surfaces the catalog for existing/authored effect nodes, not a full effect authoring UX.)

**How it was verified headlessly**
- `tools/flow-spike/vocabulary.ts` (`pnpm --filter flow-spike run vocab`) — 13/13 GREEN: (1) the
  codegen is IN SYNC with source (`--check` exits 0, so the fixture cannot silently drift from the
  union/effect map the way the hand-written default could); (2) every Broadcast event (26) + every
  effect (20) the REAL `LINES_FLOW_DOC` authors is present in the exported vocab; (3) the exported
  vocab is a SUPERSET of `DEFAULT_EMITTER_VOCABULARY` (real union, never a regression) and adds
  events the hand-transcribed default missed (e.g. `soundFade`); (4) the launcher registry maps
  `lines`/`bookOf` and `resolveFlowVocabulary` falls back to the default for unknown/absent
  gameType.
- `pnpm --filter engine-flow exec tsc --noEmit` GREEN; `pnpm --filter launcher-api build` GREEN
  (the page + registry + effect picker ship). The Phase-0 `parity`, Phase-1 `pins`, Phase-2/3
  `roundtrip`, Phase-4 `phase4`, Phase-5 `phase5`, Phase-6 `phase6` and Phase-7 `phase7` spikes
  ALL still GREEN. (`pnpm --filter lines build` fails in this worktree on the pre-existing
  stale-engine-dist gotcha — `pixi-svelte` entry unresolved — unrelated to this change; the new
  fixture compiles, proven by the spike's tsx import, and is imported by no game runtime module.)

**Still needs owner-verify live (the authed page can't be driven headlessly):** in the deployed
launcher, open a lines/book-of project's `/flow`, double-click a screen → the Broadcast picker
lists the game's real events (incl. `soundFade`/UI cues) and an `effect` node offers the
registered effect names. Headless proves the codegen fidelity + build/ship + resolver fallback,
not the picker pixels.

**What's left**
- The `docs-keeper` audit of `docs/tools/flow.md` (Phase-3 + Phase-7 first-draft, now ALSO the
  exported-vocabulary palette + effect-name picker).
- Mirror the `engine-flow` runtime to Book of Borut (bump its `engine` submodule) when its flow
  is authored + baked — the owner's step.

### Progress — Phase-8 `$context` accessor slice salvaged onto #63 (2026-06-24)

Branch `flow/phase8-context-salvage` (off the `#63` `main`). An abandoned parallel
`flow/phase8-effect-context` branch had built the effect node + name picker + payload editors
itself; `#63` (the emitter-vocabulary export above) SUPERSEDED that with build-time per-game
vocabulary codegen, so the effect-catalog / effect-node / drift-guard parts of Phase 8 were
DROPPED. The one non-redundant slice salvaged here is **`$context.*` accessor authoring** —
the surrounding dispatch context (`{ bookEvents }`) an effect's payload can read — plus its
preview + validation plumbing. EDITOR/ENGINE-AUTHORING ONLY — no runtime/game/XState/math or
pipeline code touched; the model layer already carried `kind:'context'`. **Zero game-parity
risk; no submodule bump.**

**What landed**
- `engine-flow/src/accessorText.ts` — shared pure `parseFlowAccessor` / `flowAccessorText`
  (literal / `$trigger.` / `$item.` / `$context.` / `$engine.`) + `FLOW_ACCESSOR_HINT`,
  exported from `index.ts`. This dedup is what lets `$context` land in BOTH inspectors
  identically: `ChoreoNodeInspector` (Broadcast/Effect payload + ForEach list + Branch guard)
  and `EdgeInspector` (transition guard) now call the shared helper instead of an inline copy.
- `previewExecutor.ts` — `FIXED_PREVIEW_CONTEXT` (`{ bookEvents }`) + `PreviewOptions.context`,
  wired into the `FlowScope`; `ChoreoPreview.svelte` passes it AND fixes the `effect` timeline
  label (it rendered `undefined [undefined]` because it read `event`/`mode` on an effect entry;
  now `name [effect]`).
- `validate.ts` — the `unresolved-accessor` warning class (a `$engine.`/`$context.` accessor
  whose key/root isn't known → non-blocking warn, §7) + `FlowValidateOptions`; `/flow`
  `+page.svelte` passes `ENGINE_PARAM_CATALOG` keys + `contextRoots: ['bookEvents']`, and
  `ValidationPanel.svelte` got the icon. The `unknown-effect` panel warning was deliberately
  NOT brought over — `#63` already warns inline on an unregistered effect name.

**How it was verified headlessly**
- `pnpm --filter engine-flow exec tsc --noEmit` GREEN; `pnpm --filter launcher-api build` GREEN.
- `tools/flow-spike/roundTrip.ts` GREEN, extended to author an `effect` node with a
  `$context.bookEvents` payload accessor through the model layer and assert it round-trips,
  runs through the REAL executor, and resolves against `FIXED_PREVIEW_CONTEXT` (the effect-catalog
  drift assertions from the abandoned branch were NOT included). `parity`/`phase5`/`phase6`/
  `phase7` still GREEN. (`vocab` reports a pre-existing `#63` line-ending drift on this Windows
  worktree — the committed generated files are CRLF but the codegen + `.gitattributes` are LF, so
  `gen:flow-vocab:check` flags them stale; regenerated content is byte-identical. Unrelated to
  this salvage — no vocabulary source/generated file is in the changeset.)
### Progress — tap-to-continue / signal-trigger addition DONE headlessly (2026-06-24)

Branch `flow/tap-to-continue` (off the latest flow stack). The RUNTIME/INTERPRETER HALF of a
"tap to continue" feature (owner decision: BOTH — a tap both completes the active screen AND
emits a named signal). The component that captures the tap is the NEXT agent's job; this slice
exposes the API it will call. No game submodule bump. No XState/math touched. Parity (§7) held:
no existing FlowDoc uses `signal` triggers or the new hooks, so every current doc/game is
byte-identical and the default/empty path is unchanged.

**A — "advance/complete the active screen" runtime hook.**
- `FlowInterpreter.completeActiveScreen()` (`engine-flow/src/interpreter.ts`) — runs the active
  screen's `exit` choreography then fires its `complete`/`exited` structural pin, so any
  `complete`-triggered edge from that screen advances the flow (the click analogue of the screen
  self-signalling done, §6.2). A SAFE no-op when the interpreter is inert (no FlowDoc ⇒ no machine
  ⇒ returns `false`). Maps to the HSM's existing `onComplete()` — the exit phase already runs inside
  the transition swap (`performTransition`), so the requested semantic is satisfied by construction;
  this is a clearly-named alias of the `complete()` boundary for the tap path.

**B — new `signal` transition trigger.**
- `FlowTrigger` gains `{ kind:'signal'; signal:string }` (`engine-flow/src/types.ts`). The HSM
  (`presentation.ts`) gains `onSignal(name)` — fires the first active-screen outgoing edge whose
  trigger is `{kind:'signal', signal:name}`, mirroring how a `bookEvent` trigger matches the
  arriving event `type`; a non-matching name / un-listened signal is a no-op. The interpreter
  surfaces `emitSignal(name)` (a no-op returning `false` when inert). `normalizeFlowDoc`
  (`normalize.ts`) round-trips the new trigger and DROPS an invalid one (missing/empty `signal`)
  without corrupting the doc (the bake/save contract). `diff.ts`/`validate.ts` need no change (they
  don't switch on trigger kind).

**C — game-side holder access (the next agent's call sites).**
- `apps/lines/src/game/flowInterpreterHolder.ts` exports `completeActiveScreen()` and
  `emitFlowSignal(signal)` — both read the interpreter singleton the same way `game/utils.ts`'s
  `playBookEvent` does (`getFlowInterpreter()`), and are SAFE no-ops returning `false` when no
  FlowDoc is active. The next agent's tap component imports these two functions and calls them on
  click — `completeActiveScreen()` for the `complete`-edge path, `emitFlowSignal('<name>')` for the
  `signal`-edge path. (Both, per the owner's "Both" decision.)

**D — /flow editor — `signal` trigger option.**
- `EdgeInspector.svelte` trigger picker gains a "Tap signal" option + a signal-name input
  (consistent with the bookEvent/complete/condition UI). The `+page.svelte` edge-label switch gains
  a `tap: <name>` case (kept the switch exhaustive for the new variant).

**How it was verified headlessly + build-shipped**
- `tools/flow-spike/tapToContinue.ts` (`pnpm --filter flow-spike run tap`) — 16/16 GREEN against the
  REAL interpreter/HSM/normalize: (A) `emitSignal` matched fires + advances winPresentation→basegame
  running exit-then-enter in order, non-matching name + un-listened signal are no-ops; (B)
  `completeActiveScreen()` runs exit(bonusIntro)→enter(bonus) via a `complete` edge, no-op with no
  edge; (C) inert (no FlowDoc) ⇒ both hooks return `false` (parity §7); (D) a `signal`-trigger doc
  round-trips canonical + idempotent through `normalizeFlowDoc`, an invalid signal trigger is dropped
  while the valid sibling survives.
- `pnpm --filter engine-flow exec tsc --noEmit` GREEN; `pnpm --filter launcher-api build` GREEN (the
  EdgeInspector + page ship); `pnpm --filter lines build` GREEN (after `pnpm --filter pixi-svelte
  build` to clear the stale-engine-dist gotcha) with `completeActiveScreen`/`emitSignal`/`onSignal`
  confirmed present in the minified client bundle (shipment). The Phase-0 `parity`, Phase-1 `pins`,
  Phase-2/3 `roundtrip`, Phase-4 `phase4` (allowlist extended with `onSignal` — still a pure
  observe/react surface, no platform-driving method), Phase-5 `phase5`, Phase-6 `phase6`, Phase-7
  `phase7` spikes ALL still GREEN. (`vocab` was already failing on the base — a codegen-staleness
  `--check`, unrelated to this change; no vocab files touched here.)

**Still needs owner-verify live:** nothing for the runtime half — the next change (the tap-capturing
component) is what makes a tap reach `completeActiveScreen()`/`emitFlowSignal()` in a real game; this
slice proves the API + signal matching + round-trip headlessly. When the engine `signal`-trigger work
must reach Book of Borut, bump its `engine` submodule (owner's mirror step) once a tap-enabled flow is
authored.

## 1. Why this tool exists (the goal)

A game's *presentation flow* — which screen is showing, what triggers the move to the
next one, and how each screen animates in/out — is today hand-written TypeScript split
across each game's `bookEventHandlerMap.ts` (the choreography) and `Game.svelte` (which
mounts scenes by **hard-coded id**). Reordering a win sequence, adding a beat of delay
before free spins, or wiring a newly-authored screen into the flow all mean editing
code and rebuilding. Game *speed* is a single boolean (`isTurbo` → `timeScale() = 2`)
threaded through dozens of `duration / timeScale()` call sites.

Owner direction: a **visual node editor** where screens authored in the Scene Editor
become nodes, you connect them to rebuild the flow, drop delays wherever you want, and
scrub a global speed dial — so presentation authoring becomes a tool surface like the
Scene Editor itself, not a code task. This is **core, recurring work** on every title.

## 2. The scoping boundary (what Flow does and does NOT touch)

There are two distinct "state machines." **Invisible Flow is a third, presentation
layer that rides on the first and never edits it.**

| | Layer 1 — Platform FSM | Flow — Presentation state machine | (excluded) Math |
|---|---|---|---|
| **What** | `rendering→idle→bet→{fetching→play→ending}`, autoBet/resumeBet | Which screen is active, transitions between screens, each screen's choreography | The book contents / payouts |
| **Where** | `packages/utils-xstate` | **NEW — this tool + its interpreter** | RGS |
| **Owns** | RGS protocol, balance, auto-spin, resume | The *show* | The result |
| **Edited here?** | **No** — read-only host band | **Yes — the whole tool** | **No** |

Flow **consumes** the lifecycle hooks + book events Layer 1 already emits and decides
what is on screen and how it animates. It never rewires the bet/balance/protocol
machine (that breaks the money contract) and never decides outcomes (RGS-determined).
Layer 1 appears in the editor only as a **read-only host band** for context ("this
sub-graph runs during the `play` state"). Notably the engine's visibility feeds are
*already* tied to XState state (e.g. `derived(... stateXstateDerived.isIdle())`), so
"screen X is active during platform-state Y" is already expressible — Flow makes it
visual.

## 3. Screens as nodes — the reuse story

The Scene Editor already lets you author **screens** (scenes), each a tree of nodes,
with **components** that carry engine bindings through four registries in
`packages/engine-layout`. Those registries ARE the pin vocabulary — Flow surfaces them,
it does not invent them:

| Pin on a screen node | Existing registry / catalog | File |
|---|---|---|
| **Value input** (e.g. a readout bound to `win`) | `registerComponentValues` (`ValueSource`) + `ENGINE_PARAM_CATALOG` (the editor's variable picker) | `registerComponentValues.ts`, `componentCatalog.ts` |
| **"Active when" gate** (show in this state) | `registerComponentVisibility` (`BoolSource`) | `registerComponentVisibility.ts` |
| **Signal / trigger input** (book event → react) | `registerComponentSignals` (`SignalSource`) | `registerComponentSignals.ts` |
| **Action output** (button does X: spin/menu/buyBonus) | `registerComponentActions` (`ActionSource`: `onpress` + disabled/active flags) | `registerComponentActions.ts` |

This is the **`declare ≠ implement`** bridge the Scene Editor already runs on: the
editor declares names, the game wires them once at boot. Flow reuses it intact — the
node's pins are a *projection* of its screen's component bindings, so the same single
boot-time wiring serves both tools.

## 4. The node — pins are dynamic, derived from the screen

**A node's interface is the union of its components' bindings**, recomputed as the
screen changes in the Scene Editor. Two **classes** of pin, kept visually distinct:

**A. Fixed structural pins** (every screen node has these, contents-independent — they
drive the macro flow):
- `enter` (in) — activate/mount this screen.
- `complete` / `exited` (out) — fired when the screen's exit choreography finishes.
- `active` (state) — the screen is currently the active one.

**B. Dynamic content pins** (derived from the screen's components — they carry
data/triggers):
- **Value inputs** — one per `ValueSource`-bound param (bet/win/balance/…).
- **Signal inputs** — one per `SignalSource` the screen's spine cues listen for.
- **Action outputs** — one per `ActionSource` (button) in the screen.
- **Gate** — the screen's `visibility` feed.

**Stable pin identity is non-negotiable.** A wire must survive renaming a component or
reordering the screen, so pins are keyed by a **stable binding id** (assigned in the
LayoutDoc), never by label or array position. Deleting the component a wire points to
**orphans** the pin → the node shows a **validation warning** (the editor's existing
unbound-pin discipline), never a silent drop. This is the chief risk the "dynamic"
model introduces and the reason for stable ids.

## 5. Two tiers — macro graph + micro choreography

A screen graph can't express a *timeline* (parallel-then-delay-then), and a pure
timeline graph makes the flow unreadable. So Flow is **both, nested**:

- **Macro (the graph you see):** screen nodes + **transition edges**. This is the game
  flow backbone — Loading → BaseGame → WinPresentation → FreeSpinsIntro → FreeSpins →
  FreeSpinsOutro → BaseGame.
- **Micro (double-click into a node):** the screen's **enter / while / exit
  choreography** — a small sequence graph of emitter broadcasts (animate symbols, show
  amounts, sounds, UI) arranged with **Sequence / Parallel / Delay / Branch / ForEach**
  nodes and a **Speed scalar**. (This is the reaction-graph from the original scope; it
  now lives *inside* a screen node instead of standing alone.)

**Exclusive screens vs overlays.** State/Screen nodes are **mutually exclusive** (the
active one drives which base scene is mounted) and have enter/exit + transitions.
Persistent **overlays** (HUD, win counter) are NOT nodes — they stay
`registerComponentVisibility`-driven, toggled by their feed regardless of the active
state. Node types therefore are: **Screen/State node** (in the flow) vs **feed-driven
overlay** (outside it).

## 6. Transitions — driven by all three (owner decision)

An edge from screen A → screen B fires on any authored combination of:
1. **A book event arrives** (e.g. `freeSpinTrigger` → go to FreeSpinsIntro).
2. **A screen output signal** (e.g. A's `complete` pin — "intro animation finished" →
   go to FreeSpins). *Screens don't emit completion today* (handlers sequence them
   imperatively); this output is genuinely new and is what lets the graph self-drive.
3. **An engine condition** (a Branch predicate over bound values, e.g.
   `winLevel >= big`).

Edges carry an optional guard (condition) and an optional delay. Multiple outgoing
edges are evaluated in author order; an unguarded edge is the default.

## 7. The contract — what an authored graph IS (FlowDoc)

A **FlowDoc**: a per-project JSON document, sibling to `scenes.json`, holding the
**transition graph** (screen-id nodes + edges) plus, per screen, its **choreography
sub-graph** (enter/while/exit). It is **declarative** — it names screens (by id, into
the LayoutDoc), transitions, and choreography steps; it never contains code. The engine
owns *how* (mounting, the emitter, the components, the real animations).

Like the LayoutDoc it is **sparse and override-friendly**: a screen with no authored
choreography, or an absent FlowDoc entirely, **falls through to today's coded
behaviour** (`Game.svelte` mounting + the coded `bookEventHandlerMap`), so an un-baked
or partially-authored game renders **byte-identical** to current `main`. This parity
rule is non-negotiable and is what lets us migrate one screen/event at a time.

## 8. The runtime interpreter (the crux)

The new engine piece (a shared package, working name `engine-flow` / `utils-flow`):

- **Generic scene mounter.** Today `Game.svelte` mounts scenes by hard-coded id — the
  reason an editor-authored screen isn't shown in-game (the deferred §20.1 "render
  scenes generically" limitation). The interpreter's mounter mounts **whatever screen
  the active state points at**, retiring that limitation as a side effect.
- **Presentation HSM.** Holds the active screen; on a transition trigger (book
  event / screen `complete` / condition) it runs the old screen's `exit` choreography,
  swaps the mounted scene, runs the new screen's `enter` choreography.
- **Choreography executor.** Walks a screen's sub-graph driving the **existing**
  primitives: Sequence → `sequence()` (await in order); Parallel → `Promise.all`;
  Broadcast → `eventEmitter.broadcast`/`broadcastAsync`; Delay → await `ms` (÷
  `timeScale()` when scaled); Branch/ForEach → evaluate against bound values.
- **Dispatch with fall-through.** "FlowDoc has this screen/event? run the interpreter;
  else fall through to coded mounting + the coded handler." That fall-through is the
  parity guarantee (§7).

**Why it's bounded:** a tree-walk over a closed node set, emitting into an emitter that
exists, using sequencing primitives that exist, mounting scenes through the layout
engine that exists. Not a general scripting VM. The risk is **semantic fidelity** —
reproducing the exact mount + await/parallel/timing behaviour — which Phase 0 proves.

## 9. Build plan (phased — each ships something usable)

| Phase | Delivers | Risk |
|---|---|---|
| **0 — Interpreter spike (gate)** | `engine-flow`: generic mount of one real screen + run a hand-authored `winInfo` choreography in `apps/lines`; pixel/sequence parity vs coded; fall-through proven for every un-authored screen/event | **make-or-break — do first** |
| **1 — FlowDoc model + canvas spike** | FlowDoc schema (transition graph + per-screen choreography); typed editable model + undo/redo command stack; `/flow` page renders an existing game's flow read-only; **pin-derivation** (screen → dynamic pins) + graph-lib decision (`@xyflow/svelte` vs hand-built) settled | medium |
| **2 — Macro authoring** | place screen nodes (from Scene Editor screens), dynamic pins with stable ids + orphan warnings, draw/edit transition edges, save→R2, load | medium |
| **3 — Micro choreography** ✅ | double-click a node → author enter/while/exit (Broadcast/Sequence/Parallel/Delay/Branch/ForEach); the Speed scalar bound to turbo; **deterministic** live preview with a speed dial against a fixed feed (full visual preview is Phase 4) | medium-high |
| **4 — Transitions (all 3) + generic mounter live** ✅ | book-event / screen-`complete` / condition triggers; the interpreter mounts authored screens in a real game (retires §20.1) | medium-high |
| **5 — Full migration** ✅ | move `apps/lines`' whole flow (mounting + handler map) to an authored FlowDoc with zero regression, per-screen + per-event parity-checked (the `effect` node bridges the non-emitter leaves; B.1 z-order + B.2 resume resolved) | high |
| **6 — Pipeline wiring** ✅ | export → `deploy/` → bake (`flow?` in `BakedBundle`) → register; a shipped game (Book of Borut) runs its flow from the baked FlowDoc | medium |
| **7 — Authoring UX** ✅ | node/palette search, copy/paste subgraphs, validation (orphaned pins, unreachable screens, no-exit states), flow-diff vs coded default | low-medium |

**Phase 0 is a gate, not a formality.** Before any UI, prove headlessly:
1. **Parity** — a hand-written FlowDoc (one screen + its `winInfo` choreography)
   produces the identical mount + emitter call sequence + timing as today's code
   (assert the broadcast/mount log + awaited timings match, turbo on and off).
2. **Fall-through** — with only that one screen authored, every other screen mounts
   and every other event runs its coded handler; the game is byte-identical to `main`.

## 10. Pipeline wiring (rule 8 — non-negotiable)

A FlowDoc is a new authored-document class, so it only ships when it travels the full
chain, mirroring `editorArtExport.ts` / `fontExport.ts` / `symbolExport.ts` (see
[[project_live_assets_pipeline]], [[feedback_r2_assets_must_ship]],
[[project_component_art_to_game]]):

**author online → export to `<client>/<project>/deploy/` → bake (embed the FlowDoc in
the bundle; add `flow?` to `BakedBundle`) → register (the game boots, the interpreter
reads the baked FlowDoc; absent → coded mounting + handlers).** The FlowDoc carries no
binary assets of its own (it references screens already exported by the Scene Editor),
but the `bake:doc`-before-`pull:assets` ordering and the build-env token trap still
apply ([[gotcha_game_build_stale_engine_dist]]). "Runs in `/flow`" ≠ "ships" — the
editor reads R2 directly.

## 11. The hard parts (named honestly)

1. **Interpreter semantic fidelity (§8).** Current handlers mix `await`, `Promise.all`,
   and fire-and-forget broadcasts subtly; the interpreter must reproduce them exactly.
   → De-risked in Phase 0.
2. **Dynamic-pin stability.** Wires must survive component renames/reorders → stable
   binding ids in the LayoutDoc; deletions orphan pins with a warning (§4). Needs the
   Scene Editor to assign + preserve those ids.
3. **Generic scene mounting.** Replacing `Game.svelte`'s hard-coded mounting without
   regressing any game — must honour MainContainer scaling + overlays. (Retires §20.1
   but inherits its subtleties.)
4. **Value binding without a VM.** `$trigger.*` / `$engine.*` whitelisted accessors +
   a tiny comparison set for Branch/guards. Resist growing a scripting language.
5. **Migration without regression (Phase 5).** Lean on the Phase-0 parity harness,
   per screen + per event.
6. **Live-preview determinism.** Feed a fixed book so speed/delay tuning is
   reproducible (reuse the mock-RGS/test-server feed, not random outcomes).

## 12. Decisions (resolved 2026-06-23) + spike checks

All six were settled with the owner; remaining items are spike confirmations, not
open design questions.

- **FlowDoc shape — one doc.** A single transition graph + per-screen choreography
  sub-graphs, sibling to `scenes.json`. (Splitting buys nothing and complicates bake.)
- **Stable pin ids — derive from the component-instance id (no new schema).** Every
  LayoutDoc node already carries a persisted `id: string` (a stored field, not a
  positional index — `types.ts` `BaseNode.id`), so it survives reorder (position
  changes, id doesn't) and rename (changes `label`, not `id`). A pin id is the
  **composite** `${instanceId}::${role}:${key}` (e.g. `n42::value:win`,
  `n42::action:spin`, `n42::gate`) — deterministic, the Scene Editor adds nothing. The
  one discipline: the editor must **never recycle an id** — a duplicated/pasted
  instance gets a **fresh** id (a copy is a new pin). *Phase-1 check:* confirm "no id
  regeneration on edit, fresh id on duplicate/paste."
- **Platform-aligned transitions — observe, don't model.** The interpreter OBSERVES
  XState platform state (idle↔play) and reacts; Layer 1 stays the single source of
  truth. Flow never drives a platform transition itself (no double-driving).
- **Graph library — `@xyflow/svelte` (Svelte Flow).** v1.0+ is Svelte-5 native (peer
  dep `svelte@5`, latest ~1.6.x), so it fits our stack with no compat tax. It provides
  pan/zoom/drag/ports/edge-routing/selection out of the box; our screen nodes are
  custom Svelte node components whose **dynamic pins render as custom handles** from
  the screen's binding list — its sweet spot — and the same lib renders the micro
  choreography graph. (It can't render a live Pixi screen *inside* a node; we don't
  need that — a name + thumbnail suffices.) Hand-built remains the fallback ONLY if a
  Phase-1 install spike fights our Vite/Turbo setup.
- **Undo/redo — command stack, reuse the Scene Editor's history** if it generalizes;
  in place before Phase 2.
- **Per-layoutType — no (for now).** Flow/timing is layout-independent; the FlowDoc
  stays single-variant. Revisit only if a real per-orientation flow difference appears.

## 13. Model note — use both, each where it exceeds (decided 2026-06-23)

Owner decision: no single model is locked for this tool — **Opus 4.8 and Fable 5 are
both in play, each on the work it's best at.** Split, don't blanket:

- **Opus 4.8 — the default, ~all of the build.** Well-specified, long-horizon Svelte
  5 / TS agentic work at half the token cost: the FlowDoc schema, **pin-derivation**
  (screen → dynamic pins), the `/flow` Svelte Flow canvas + custom screen-node /
  handle components, the transition + choreography authoring UI, undo/redo, the
  export→bake→register pipeline wiring, and the docs/tool registration.
- **Fable 5 — reserved for the genuinely hard reasoning, where its ceiling pays for
  itself:** the **interpreter semantic-parity** work (reproducing the exact
  await/`Promise.all`/fire-and-forget timing of the coded handlers — Phase 0/5), the
  **generic scene mounter** correctness (MainContainer scaling + overlays with no
  regression — Phase 0/4), and any gnarly **async-ordering reconciliation** during the
  Phase-5 migration.

Rule of thumb: if it's "build the well-understood thing," Opus 4.8; if it's "get the
subtle concurrency/timing exactly right or the game visibly breaks," Fable 5.
Blanket Fable-5 for the whole build would waste tokens; Opus-only through the parity
spikes risks missing a subtle timing mismatch — hence the split.

### Progress — tap-to-continue surface made transform-independent DONE (2026-07-02)

Fixes the known `STILL-OWED: transform-independent tapToContinue dim` gap: on a flow-driven
screen whose overlay `componentInstance` has `tapToContinue: true`, the full-CANVAS tap surface
(dim `CanvasSizeRectangle` + `OnPressFullScreen` hit rect + `PressToContinue` prompt) was broken
in PORTRAIT — the prompt was mis-sized and the full-screen tap area landed nowhere. Landscape was
fine. Reported on the shipped Book of Borut loading screen.

**Root cause.** `ComponentInstance.svelte` rendered `tapSurface` INSIDE its `rendered` snippet,
which `LayoutNodeView.svelte`'s componentInstance branch wraps in
`<Container x={posX} y={posY} scale={transform.scale} rotation …>`. So the "full-screen" tap
surface inherited the instance's PER-LAYOUTTYPE transform. In portrait the editor stores an
offset + downscale for that instance, so the `canvasSizes()`-sized rectangle was pushed off the
visible canvas (clicks miss) and the `MainContainer`-anchored prompt was double-scaled. The
free-spin gate (`FreeSpinIntroGate`) uses the SAME primitives correctly because it is mounted as
a scene-root canvas bind — never positioned.

**Fix (approach: hoist to a scene-root sibling, no matrix math).** `ComponentInstance` now
EXPOSES its `tapSurface` snippet UP via a new bindable `tap?: Snippet` prop (assigned once,
init-stable, to `tapComponent ? tapSurface : undefined`) and no longer renders it inside
`rendered`. `LayoutNodeView`'s componentInstance branch binds it (`bind:tap={instanceTap}`) and
renders it as a SIBLING of the transform wrapper `<Container>` — so the tap surface renders in the
scene-root/canvas frame, exactly like the engine-owned free-spin gate, independent of the
instance's authored placement/scale. Generic (no loading-screen/magic-id special-casing) — any
overlay instance on any flow screen benefits. Chosen over a transform-neutralizing wrapper because
it needs no matrix inversion and is correct even under a rotated/non-uniform instance transform.

**Parity (§7).** Inert when `tapToContinue` is OFF (the default): `tap`/`instanceTap` stay
`undefined`, the `{#if instanceTap}` renders nothing, and the non-tap `rendered` output is
unchanged — byte-identical for every instance that hasn't enabled the capability. Existing
`tapDimColor`/`tapDimAlpha`/`tapHidePrompt`/`tapSignal` behaviour is untouched (same props, same
coded `TapToContinue`/`PressToContinue`).

**Files.** `packages/engine-layout/src/lib/ComponentInstance.svelte` (Props gains `tap?: Snippet`;
`$bindable()` destructure; `$effect` hands the `tapSurface` snippet up; removed the in-transform
`{@render tapSurface()}`). `packages/engine-layout/src/lib/LayoutNodeView.svelte` (import `Snippet`;
`instanceTap` `$state`; `bind:tap` on `<ComponentInstance>`; `{#if instanceTap}{@render}` sibling
of the wrapper).

**Verified headlessly.** New CPU scene-graph harness
`packages/engine-layout/scripts/test-tap-transform-independence.mjs` builds BOTH candidate PIXI
trees (transform math is CPU-only, no GPU/DOM) and asserts world bounds of the full-canvas rect:
OLD (child of the instance transform) → portrait bounds `{x:240,y:620,w:669.6,h:1190.4}` do NOT
cover the canvas (bug reproduced); NEW (hoisted sibling) → covers the full canvas in BOTH landscape
`{0,0,1920,1080}` and portrait `{0,0,1080,1920}`, AND under a hostile rotated/non-uniform instance
transform. `pnpm --filter engine-layout build` GREEN; `pnpm --filter lines... build` GREEN
(confirms the bindable-snippet contract compiles across the package boundary). Prettier-clean.

**Runtime bundle.** engine-layout `dist` is `svelte-package` source-copy, already regenerated; the
online games run the SHARED runtime bundle, so this reaches Book of Borut ONLY via a runtime-bundle
republish (`publish-runtime-bundle.mjs`) — NOT a submodule bump. Owner will handle the release after
review. Not yet shipped.

**Still needs owner-verify live:** confirm in a running Book of Borut (or apps/lines with a
tap-enabled overlay authored on the loading screen) that in PORTRAIT the tap lands anywhere on the
canvas and the prompt is correctly sized, and that landscape is unchanged.

## 14. Free-Spins & Special-Mode flow (FS-1…FS-5) — build plan (owner direction 2026-07-03)

Owner direction: **drive the whole free-spin / special-mode lifecycle from the Flow graph** —
author the intro / counter / retrigger ("extra free spin") / outro screens and give each the
correct pins to **activate/deactivate** it, plus **freely-placeable transition overlays**. Owner
decisions on this pass: **build FS-1→FS-5 in one effort**, and represent retrigger as a
**dedicated `retrigger` book/emitter event** (not just a derived condition).

### Why this is an extension, not just wiring
Today the free-spin phases are **not** flow screens. They are engine-owned `visibleSource`
overlays hard-mounted in `Game.svelte`'s top z-band (`Game.svelte` ~L1343-1366), toggled by
`stateUi` booleans that `bookEventHandlerMap.ts` flips on `freeSpinTrigger` / `updateFreeSpin` /
`freeSpinEnd`. §5/Phase-5 deliberately left them feed-driven ("`apps/lines`' only exclusive screen
is `basegame`"). This plan **promotes** them to author-controlled Flow screens with real pins,
holding the §7 fall-through invariant throughout (inert / un-authored ⇒ coded path byte-identical).

### What already exists (do NOT rebuild)
- **Activation by book event** — a `bookEvent` layer edge already fires + layers a screen
  (`presentation.ts` `onBookEvent`); generic takeover mount renders any authored active screen
  (`Game.svelte` `activeScreenTakeover`). Missing only the **backing Scenes** + the wiring.
- **Counter VALUE pin** — `freeSpins` ("current of total") + `freeSpinsWon` are registered engine
  values (`componentCatalog.ts`), derived to a `value` input pin by `pins.ts`. No gap for the readout.
- **Condition triggers** already read `freeSpinsRemaining` / `isFreeGame` / `gameType`
  (`flowRuntime.svelte.ts` `linesEngineReader`) via the shipped `condition` machinery.
- **Tap `complete`** return (outro → basegame) works via `completeActiveScreen()`.

### Build order (dependency order — engine primitives first, then authoring, then transitions)

| Phase | Delivers | Where | Risk |
|---|---|---|---|
| **FS-2 — book-event trigger INPUT pins** | Project the book-event vocabulary (`typesBookEvent.ts` / `flowVocabulary.ts`) as **trigger input pins** on screen nodes so a `bookEvent` edge draws from a real `freeSpinTrigger`/`freeSpinEnd`/`retrigger` pin, not a typed string. Mirrors Phase-8 intent pins beat-for-beat. **Authoring-only — no interpreter behaviour change** (still matches on `trigger.event`). | `engine-flow` (`pins.ts`, `types.ts`), `/flow` (`EdgeInspector`, node coloring) | low |
| **FS-3 — free-spin signal catalog** | Add `freeSpinStart` / `freeSpinEnd` (+ `freeSpinRetrigger`, pending FS-4) to `ENGINE_SIGNAL_CATALOG` + `registerComponentSignals`, wired to the existing emitter events, so a spine cue on an intro/outro/retrigger screen plays on the lifecycle (derives `signal` pins via `pins.ts`). | `engine-layout` (`componentCatalog.ts`), `Game.svelte` (`registerComponentSignals`) | low (additive; ⇒ Borut runtime republish/submodule) |
| **FS-4 — dedicated `retrigger` event** | A first-class `retrigger` emitter/book event (owner decision), surfaced BOTH as an FS-2 trigger pin and an FS-3 signal. `bookEventHandlerMap` emits it when `updateFreeSpin` arrives with a grown `total`; a bounded `$engine.freeSpinsAdded` accessor also exposed for guards. Parity-safe: un-authored ⇒ existing `updateFreeSpin` coded path unchanged. | `typesBookEvent.ts`, emitter union, `bookEventHandlerMap.ts`, `flowRuntime.svelte.ts`, FS-2/FS-3 surfaces | medium (data-model touch — the "grown total" detection needs a stored previous-total, must not false-fire on the initial award) |
| **FS-1 — author free-spin screens + wire the graph** | Real backing Scenes for `freeSpinIntro` / `freeSpinCounter` / `freeSpinRetrigger` / `freeSpinOutro`; a `LINES_FLOW_FREESPIN_DOC` fixture wiring `basegame --freeSpinTrigger(layer)--> intro --complete--> freeGame`, `--retrigger--> retrigger overlay`, `freeSpinEnd --> outro --complete--> basegame`; counter binds `source:'freeSpins'`. Uses the FS-2 pins + FS-3 signals + FS-4 retrigger. Every authored free-spin event stays an **authored no-op in `events[]`** so the coded feed-driven overlay doesn't double-present (the §2 win-branch discipline). | authoring fixture first (`__IE_FLOW_*` hook), then `/flow`; headless parity spike in `tools/flow-spike/` | medium |
| **FS-5 — placeable transition overlays** | Surface the reusable full-screen wipe (`transition` emitter event + `Transition.svelte`) as a **droppable choreography Broadcast beat** (`broadcast {event:'transition', await:true}`) in the choreography palette, so an author drops a wipe into any screen's enter/exit timeline. Complements the existing edge-backed *fade* entrance (`FlowTransition.transition`, kind `fade`). Optionally also a transition-**overlay screen node** (a Scene with the wipe on a self-completing layer edge). | `/flow` choreography palette; engine-side = reuse (no new event) | low |

**FS-6 (deferred, high-risk, NOT this pass):** retire the coded `LAYER_BAND_TOP` free-spin gates /
counter (`Game.svelte` ~L1343-1366) so the flow owns the whole lifecycle end-to-end. Gated on
FS-1…5 proven live + owner confirming the game is post-preproduction. The round-blocking
`waitForResolve` (`FreeSpinIntroGate.svelte`) must keep exactly one subscriber or the round hangs.

### Verification + ship (per phase)
Each phase is proven headlessly in `tools/flow-spike/` (op-log / pin-derivation / round-trip
parity, turbo on/off) + `tsc --noEmit` + the affected `pnpm --filter … build` GREEN, before any
live-verify — the WebGPU bundle is the only thing headless can't prove (read `app.stage` / dynamic-
import override, not `preview_screenshot`). Engine changes (FS-3, FS-4) reach Book of Borut via a
runtime-bundle republish / `engine` submodule bump; the FlowDoc + `/flow` changes ride
export→`deploy/`→bake(`flow?`)→register (rule 8). Fall-through parity (§7) is the invariant on every
slice: no authored free-spin screen / no FlowDoc ⇒ the coded feed-driven path is byte-identical.
