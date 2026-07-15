# Flow-driven game — making components fully drivable from Invisible Flow

> **Not a separate tool.** This is an *initiative / build-program* that sits ON TOP of
> **Invisible Flow** (the `/flow-v2` editor + runtime interpreter). It's the plan for *using*
> Flow to drive a whole game; its current state is tracked in
> [docs/status/flow.md](../status/flow.md), not a status file of its own.
>
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
> being active (hidden during `loading`, revealed on its `complete`). For the engine-core change
> (the pin-driven active-SET model) see [docs/status/flow.md](../status/flow.md) + the archived
> log in [docs/history.md](../history.md). Where the text below says "exclusive screen"/"swap",
> read "layered overlay over the persisting base".

> Build status: see [docs/status/flow.md](../status/flow.md); detailed done-log in [docs/history.md](../history.md).

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

> Build status: see [docs/status/flow.md](../status/flow.md); detailed done-log in [docs/history.md](../history.md).

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

> Build status: see [docs/status/flow.md](../status/flow.md); detailed done-log in [docs/history.md](../history.md).

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

> Build status: see [docs/status/flow.md](../status/flow.md); detailed done-log in [docs/history.md](../history.md).

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

> Build status: see [docs/status/flow.md](../status/flow.md); detailed done-log in [docs/history.md](../history.md).

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

> Build status: see [docs/status/flow.md](../status/flow.md); detailed done-log in [docs/history.md](../history.md).

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

> Build status: see [docs/status/flow.md](../status/flow.md); detailed done-log in [docs/history.md](../history.md).

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
> the HUD's display input pins wire into). The build plan below is preserved as-authored.
>
> Build status: see [docs/status/flow.md](../status/flow.md); detailed done-log in [docs/history.md](../history.md).

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
