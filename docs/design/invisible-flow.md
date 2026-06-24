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

## 0. Status

**Not built. This doc is the registered build plan.** Owner decisions (2026-06-23):
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

**What's left**
- Phase 2 — macro authoring (place screen nodes, draw/edit transition edges, save→R2),
  tool registration in `roles.ts` + `docs/tools/flow.md` (RULE 9), `POST /api/flow/save`.
- Phase 4 — the live generic mounter; Phase 6 — bake/pipeline (`flow?` in `BakedBundle`).

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
| **3 — Micro choreography** | double-click a node → author enter/while/exit (Broadcast/Sequence/Parallel/Delay/Branch/ForEach); the Speed scalar bound to turbo; **live preview** with a speed dial against the mock-RGS feed | medium-high |
| **4 — Transitions (all 3) + generic mounter live** | book-event / screen-`complete` / condition triggers; the interpreter mounts authored screens in a real game (retires §20.1) | medium-high |
| **5 — Full migration** | move `apps/lines`' whole flow (mounting + handler map) to an authored FlowDoc with zero regression, per-screen parity-checked | high |
| **6 — Pipeline wiring** | export → `deploy/` → bake (`flow?` in `BakedBundle`) → register; a shipped game (Book of Borut) runs its flow from the baked FlowDoc | medium |
| **7 — Authoring UX** | node/palette search, copy/paste subgraphs, validation (orphaned pins, unreachable screens, no-exit states), flow-diff vs coded default | low-medium |

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
