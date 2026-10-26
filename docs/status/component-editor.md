# Invisible Component Editor — status

> Design: [docs/design/invisible-editor.md](../design/invisible-editor.md) (§8) · Guide: [docs/tools/component-editor.md](../tools/component-editor.md) · Agent: [`.claude/agents/invisible-components.md`](../../.claude/agents/invisible-components.md)
>
> Companion tool: [Scene Editor status](./editor.md) — since Rive plan Phase 4a (2026-10-13) this tool **is** the Scene Editor's Components side: `/editor` places instances on screens and authors the `ComponentDef`s on the same stage. This file keeps the component-authoring story; navigation between the two sides is in the editor status.

**One-line state:** Built, now the **Components side of `/editor`** (`/editor?view=components`; `/components` redirects) — authoring (instances/params/signals), per-project "This game's defaults" with version history, and pin-by-default multi-version defs are on `main`. **Component timelines** (Animate mode on the Components side, Rive plan Phase 4b) are on `main`. The per-component **state machine** (Phase 5) is built: **5a** (2026-10-13, in review) adds `inputs` + `stateMachine` to the `ComponentDef`, folds `signals` into trigger inputs, and runs one interpreter per placed instance; **5b** (2026-10-13, in review, stacked on 5a) is the State Machine panel in Animate, the Inputs block and the stage preview — ⏳ not browser-verified.

## Current state
Authoring for **components** (prefabs), mounted inside `/editor` as its Components side (`routes/(app)/editor/ComponentWorkspace.svelte`) — launcher-native, full-page, SSR off, gated on the **`editor`** tool (the `componentEditor` registry entry is kept: its card opens `/editor?view=components`, doc slug `component-editor`, lease key `componentEditor`). `/editor?component=<id>` opens one component; the old `/components` route is a 307 redirect (`routes/(app)/components/+server.ts` via `$lib/componentLinks.ts`) that keeps every other query param. Storage, versioning and format are unchanged (`componentStorage.ts`). Components load for the active client/project (project shadows shared shadows built-in); **Save** always writes a project-scoped component: a shared or built-in draft saves as the project's copy under the same id (`componentSave.client.ts`); only **Promote to shared** writes `_shared/`.

Shipped capabilities on `main`:
- **✎ Rename** (2026-10-23, in review) — the project's own components rename from the list; the
  id and version stay, so no reference breaks and no pin is flagged. Detail under Recent changes.
- **⧉ Duplicate** (2026-10-23, in review) — any component in the list (project, shared, built-in)
  copies into a new project component with its own node ids, timelines and state machine, and
  this game's defaults baked in. Detail under Recent changes, 2026-10-23.
- **Author a component** — create Blank (`UI`/`Overlay`/`Scenery`) or a pre-wired **Button** (pre-declares the `action` param); build the `root` element tree on the shared editor canvas (Text/Rect/atlas/rig/sheet regions), outline + properties reused from the Scene Editor. Opened from a screen in place: double-click a placed instance, **◇ Edit component in place**, **◇ Edit as component** on a container, or the left-pane Components list. A breadcrumb tracks nested defs edited in place (Esc goes up one level; nesting stops at `MAX_COMPONENT_DEPTH` via `canEnterNested` in `editor/componentWorkspace.ts`).
- **Declare the engine contract** (the "Component variables" block) — **Engine params** (curated catalog: bet/win/balance/…), **Your params** (custom author inputs: string/image/number/color/boolean, with per-param defaults, bound to a node's image/tint/text/font/size/colour), and **Signals** (the kind's engine signals, grouped by family, or any Flow cue name; declare-only, since cue fields are free text). **scoped by** names the param a placement's signal scope comes from (Phase 12a). Text nodes have an **Expose as params** shortcut.
- **Per-instance engine bindings** (Flow-driven-game Phase 6, 2026-06-30) — any placed instance can be made clickable (`action`) or lifecycle-gated (`visibleSource`) without the def declaring the param (shared `engineBindings.ts` + an "Engine bindings" tray in `EditorProperties`); UI for `visibleFor` / `screenAnchor` / custom-param `options`; and **per-instance signal rebinding** (`cueSignalOverrides` — override which engine signal drives a rig cue, e.g. `win` vs `bigWin`).
- **Button-state-driven rig animations** (2026-06-25) — `RigNode.stateAnimations` (hover/pressed/selected/disabled/spinning cascade), authored via "Plays on button state"; blank-default rig = a state-only overlay over a resting button image.
- **Versioning** — pin-by-default with a **true multi-version store** (v2): a changed save bumps `version` AND retains every historical `<id>.v<N>.json` snapshot, so an instance resolves the EXACT def it pinned (editor preview, bake, and shipped game); a missing pin renders latest + a `versionMismatch` warning, never a silent upgrade. Outdated instances are **flagged** in the Scene Editor and updated per instance (never bulk). A **version browser** (top-bar `Version` dropdown + **Inspect** read-only + **Back to latest**) browses retained snapshots non-destructively.
- **Promote to shared** (2026-06-24) — holders of the `componentPublish` capability (admin by default) get a top-bar button writing a `_shared/editor-components/<id>.json` snapshot; enforced server-side. The kept draft stays project-scoped and still shadows the shared copy.
- **Skinnable coded parts** (2026-10-02, Hold and Win 12c, #1006). A coded part whose catalog entry
  declares a `skin` takes the author's own nodes inside it: the Pot, the Respin Counter, the Jackpot
  Tile, the Total Win Bar, the Letter Tile, the Wheel and the Cell Tile. Those nodes draw in place
  of the coded drawing, and the part keeps its behaviour. The Pot and the Wheel also take art params. The bar's
  **Edit inside ‹part› ›** edits the part's children, and the canvas previews the art and the
  children. A **(Hold and Win)** create type per part makes a project copy.
  Contract: [hold-and-win](hold-and-win.md) Decisions.
- **Expose a nested component's params on its parent** (2026-10-15, branch
  `claude/gifted-hawking-uv5utk`, in review, ⏳ not browser-verified). Inside a component, a
  nested instance's param can come from the open component: **⇡ Expose on ‹parent›** declares a
  copy on the parent, or the same picker takes it from an existing parent param of the same kind
  (`paramBindings['params.<key>']`). Each placement of the parent then sets it like any other param.
  Contract: design §13.2 item 4. Detail under Recent changes, 2026-10-15. The same **⇡** sits on a
  placed effect's exposed parameters (2026-10-16): see [status/fx](fx.md).
- **Segmented counters — Repeat (count)** (2026-10-20, branch `claude/component-repeat-segments`,
  in review, ⏳ not browser-verified). A repeater in count mode repeats a segment component N times,
  N bound to a game value (`respinsStart`, `freeSpinsTotal`); each segment gets `index` / `count` and
  the values the bar passes down, and its own state machine lights it. Built-in starter **Segmented
  Counter**. Detail under Recent changes, 2026-10-20; guide
  [§ Segmented counters](../tools/invisible-editor.md#segmented-counters--repeat-count).
- **Bind to value** (2026-10-02, Hold and Win Phase 12b) — a node's `valueBindings`: a number (a component param, an engine source, or the instance's own pot via `meter.{meter}.*`) mapped in → out onto a transform offset, a show/hide threshold, a fill reveal (sprite / flipbook / rect), a held clip frame, a rig animation scrub or a rig bone. Authored in the shared Properties section (`EditorValueBindings.svelte`) with a test-value scrub previewed on the canvas and overlays (`valuePreview.client.svelte.ts`). Guide §3b; contract in [hold-and-win](hold-and-win.md).
- **Listeners + events in the editor** (Rive plan Phase 6b, 2026-10-13, in review, ⏳ not browser-verified). Properties → **Listeners** for a selected node of the component (`EditorListeners.svelte`: rows "On [down/up/hover in/hover out/click] → [fire trigger | set input | toggle bool | raise event]", pickers fed by the def's inputs and events, ⚠ per node from `validateComponentEvents`), **Component variables → Events** below Inputs (`EditorEvents.svelte`: add; ✎ rename-as-replace — the page's dialog lists the listeners, states and timeline `event:` cues that raise it, the listeners and states follow, a cue does not; × remove — asks when something raises it, the raises stay and are flagged; payload fields typed int / number / ms / bool / text key, optional), the shared payload editor (`EditorRaisePayload.svelte`: a value, an input's current value, or a localization key), and in the **State machine** inspector **On enter → ＋ raise event**. The stage preview answers the pointer while the State machine tab is shown: `EditorCanvas` reports moves / presses / releases with the DEEPEST node under the pointer (a hit-test into containers) through `onStagePointer`, `$lib/timeline/listenerPreview.ts` (`StagePointer`, `listeningChain`) turns them into enter / leave / down / up / click deepest-first, and the game's own `ComponentEventDispatcher` runs them against the preview runner; `placeLayers` routes a timeline's `event:` cue to it while running; the inspector's **Events** log lists every raise (time, event, origin, payload). Pure edits in `$lib/timeline/listenerEdit.ts`: listener and on-enter ids are MINTED (`l_` / `e_` + 6 random chars) against the draft's and the last-saved def's ids, so a row this build cannot read (kept by the save, never seen by the client) is never shadowed; event ids are author names. Everything is the draft — the existing component save (`check:component-links` still 71) — and read-only while Inspecting. Gate: `pnpm --filter launcher-api check:component-listeners-events-editor` (64). UI: [guide](../tools/invisible-editor.md#listeners-and-events).
- **Listeners + events in the format and the runtime** (Rive plan Phase 6a, 2026-10-13, on `main` as #1186). `ComponentDef.events` (`{id, payload?: ParamDecl[], note?}` — Flow's own `ParamDecl`), a node's `on: NodeListener[]` (`{id, event: down|up|enter|leave|click, action: fire|set|toggle|raise}`) and a state's `onEnter: SmEnterAction[]` (a raise with an `id`). Per placed instance, `ComponentEventDispatcher` (`engine-layout/componentEvents.ts`, pure): a listening node is wrapped in a hit surface (`LayoutNodeView`, only when it has listeners), its listeners fire the instance's triggers on its own bus and set its runner's inputs; an event raised by a listener, a state being entered or an `event:<id>` timeline cue leaves on the Flow press road (`getFlowPress()(instanceNodeId, eventId, payload, 'event')`), so Phase 7 only adds the pins; the game plays no press sound for it. A press target with listeners keeps its press (both fire). Raises go through one ordered queue per instance, drained after the current work (never mid-mount, nothing after destroy); a raised event has its own namespace on the road (it never runs a press or `action` pin of the same name — event pins are Phase 7's). Payload `{ key }`s are localization keys (source-as-key) and the harvest collects them. An older build's save keeps newer listener / `onEnter` / payload rows (#1185's rule). The interface (`componentInterface`) lists `events`; `validateComponentEvents` gives the editor its issues; the normalizer keeps the three blocks and drops malformed listeners whole. No listener and no event ⇒ no dispatcher, no context, no wrapper (parity). Format, semantics and the event-id/input-id decision: plan §5 and §6.1. Gate: `pnpm --filter launcher-api check:component-listeners-events` (100 checks, incl. real headless Pixi hit-testing, the raise queue's order and destroy guard, and the game's real resolver keeping events apart from presses); `check:save-keeps-unknown-blocks` has a 6a section; `check:doc-readers-unknown-fields` §13 covers the new blocks.
- **The State Machine panel** (Rive plan Phase 5b, 2026-10-13, in review, ⏳ not browser-verified). Animate on a component now has two tabs under the stage, **Timeline** and **State machine** (`ComponentWorkspace.svelte` `animateTab`; both panels stay mounted, hidden, so an unsaved timeline survives the switch). `EditorStateMachinePanel.svelte`: a layers tab strip (＋ Layer, Rename, 🗑), ＋ State (a picker over the component's timelines — `componentTimelinesOf` of `/api/cinematics/list`), the layer's graph on `@xyflow/svelte` (`SmGraphNode.svelte`: Entry / Any / Exit pills and state cards named after their timeline — `layerGraph` in `$lib/timeline/stateMachineEdit.ts`), wires → transitions (`connect`: from Entry sets the entry), an inspector for the selected transition (conditions with per-kind ops, exit time, blend) or state (name, timeline, speed, loop, Open timeline, Set as entry), a ⚠ pill over `validateStateMachine`, and **Preview inputs** (trigger buttons, bool switches, number fields) driving the game's `ComponentStateMachineRunner` on a rAF clock; its layers are placed on the game's own `ComponentTimelinePlayer` (`$lib/timeline/stateMachinePreview.ts`) whose samples go to the stage through the Timeline panel's preview seam (`setTimelinePreview`, under the panel's own owner), the active state lights its card and tab, a fired transition flashes its arrow. Double-clicking a card (or **Open timeline**) opens the Timeline tab on that timeline (`EditorTimelinePanel` `openRequest`). The machine lives on the draft (`def.stateMachine`, `def.inputs`): it saves with the component through the existing save (ETag, project pin, `scopeMismatch`, versions, History — `check:component-links` still 71, no new write), and Animate stays disabled while Inspecting. Card and pseudo-node positions save as `SmState.pos` / `SmLayer.pseudoPos` (runtime-ignored; the normalizer keeps them). **Component variables → Inputs** (`EditorProperties.svelte`, was *Signals*): the trigger rows are the declared signals (**+ Add trigger** is the old catalog picker, untouched), bool / number rows are added from a name + kind row, each with a default (a number also a **from** engine value source); ✎ renames an input everywhere it is read (the dialog says what fires the old name — rename is delete + add of the wire contract), × removes it, asking first when a transition reads it: the conditions stay, fail closed in game and show ⚠ `condition-input-unknown` until fixed (never widened); inputs are read-only while Inspecting (`stateMachineEdit.ts`: `addInput` / `removeInput` / `renameInput` / `setInputDefault` / `setInputSource`). The stage preview runs the game's own `ComponentStateMachineRunner` AND `ComponentTimelinePlayer` (`stateMachinePreview.ts`: `previewPlayer`, `placeLayers` — a `signal:` cue a state timeline crosses fires the runner's trigger — `playerDrives`), `enter` fires on ▶ Run and ↺ Reset, the rAF loop sleeps at rest and never resumes after stop/unmount; the graph answers Delete only while its tab is shown, drops its selection when hidden and resets (selection, layer tab, preview inputs) when another component opens; a new layer/state/transition never reuses an id the saved def had (`stateMachineIds`), for the keep-unknown-fields save. Gate: `pnpm --filter launcher-api check:component-state-machine-editor` (42 checks: the edits, the inputs list, reserved ids, the graph, the preview on the real player — blend, `signal:` cue routing, a missing timeline — positions saved, the panel's delete/selection/reset guards). UI: [guide](../tools/invisible-editor.md#the-state-machine).
- **Inputs + state machine in the format** (Rive plan Phase 5a, 2026-10-13, in review — the normalizer and runtime). `ComponentDef.inputs` (`{id, kind: bool|number|trigger, default?, source?, note?}`, kinds in the exported `COMPONENT_INPUT_KINDS`) and `ComponentDef.stateMachine` (`layers[] → {id, entry, states[{id, timeline, speed?, loop?}], transitions[{id, from, to, conditions?, exitTime?, blend?}]}`; `any`/`exit` reserved) are additive and versioned with the def. **Signals fold into trigger inputs** (plan §12 #4): `componentInputs(def)` / `componentTriggers(def)` in `engine-layout/componentInterface.ts` is the one reader — the Signals block, the Animate **Plays on** picker (`componentTimelineSignals`), Flow's projection of declared signals (`flowV2Projection.ts`) and the runtime all read through it; a def with only `signals` yields the same triggers, and nothing is migrated (`signals` stays readable; Phase 8 migrates). Saving keeps both blocks and drops malformed rows (`normalizeComponent`: an input of an unknown kind; a transition with a condition this build cannot read is dropped whole, never widened; `check:doc-readers-unknown-fields` §13 proves unknown extras are ignored). Toggling a signal off in the Signals block also removes a trigger input of that id. Runtime, semantics and gate: [cinematic status](cinematic.md) and the plan's §5.
- **Component timelines — Animate mode** (Rive plan Phase 4b, 2026-10-13, ⏳ not browser-verified). A **Design | Animate** toggle in the editor bar (`ComponentWorkspace.svelte`); Animate mounts the screens' `EditorTimelinePanel.svelte` with a `component` host. A timeline is a cinematic with `host: {kind:'component', componentId}` (id `c_<component>_<name>`), saved through `/api/cinematics/*`. The panel adds **Plays on** (`playOn`: `enter`, the def's declared signals, rig cues' `completeSignal`s, ✎ any name — `componentTimelineSignals` in `$lib/timeline/screenTimeline.ts`), **Also on** (`playOnComponents`) and a ⚠ issues pill (`validateNodeActors` on the def and every reused-on component, plus "no Plays on"). The canvas only selects in Animate; Animate is disabled while Inspecting a version; the panel stays mounted (hidden) and saves an unsaved timeline when the host changes. Runtime, format and access: [cinematic status](cinematic.md). UI: [guide](../tools/invisible-editor.md#animate-a-component).
- **"This game's defaults"** (2026-09-17, design Phase B3) — a second panel under *Component variables* setting the open def's params for the ACTIVE PROJECT only, stored in the §13.3 sidecar (`editor/<project>/component-defaults/<id>.json`) so a SHARED def can look different per game without being forked. Lists every `!engineProvided` param with the instance panel's widgets; empty = inherit (the key stays absent, `×` restores it); its own `SaveState` + **Save for this game** + conflict badge, separate from the def's versioned save. Each save backs up the version it replaces (newest 20 per component, under `component-defaults-backups/`); **History…** beside it opens the shared version-history modal (#857). Both editor canvases resolve it (see [editor status](./editor.md)).

## Open items / next
1. **Behaviour layer — per [rive-style-editor.md](../design/rive-style-editor.md)** (approved 2026-10-13; it supersedes the `BehaviorTrack`/`TweenStep` design in invisible-editor §8.5–8.7). Phase 4a (components in place) and Phase 4b (component timelines) are on `main`; Phase 5a (the state-machine format + runtime) and 5b (the State Machine panel) are on `main`; Phase 6a (listeners + events: format, runtime, validation, normalizer) is on `main`; 6b (the editor: Listeners, Events, On enter, the pointer preview and Events log) is in review; **next is Phase 7** (Flow instance nodes: the event pins — with their own pin id form, not the press pins' `containerEventDeclId`, plan §6.2). Open from 5b: the preview samples a state's timeline as last saved (an unsaved Timeline-tab edit shows after Save); conditions pick inputs by id (no picker for engine value sources yet — the **from** field is typed). Open from 4b: a component's own timelines are still project-scoped; since Phase 9d a timeline can be promoted to the shared library and placed on any component as a link, and the panel keys text, visibility and cues (see [editor status](editor.md) 2026-10-20, 9d). Anything needing branching/RGS math/stateful logic stays a coded `mount`.
2. **Nesting depth capped at 3** (`MAX_COMPONENT_DEPTH`, cycle-guarded; 2 until 2026-10-23, when a counter inside a component needed 3) — widen only when a game needs it; the bake walks only top-level scene pins, not the transitive nested-pin closure: a nested pin draws the latest in the editor and the game alike (`commonoverlayproject`'s `potMeter` pins `c_xoq2r4ee` v4/v7 and `c_0jd2016q` v2 that way). Honouring them needs both the bake and the editor's pin loader to walk defs, and changes how such a game looks — an owner call.
3. **Authoring gaps** — no autosave (unsaved drafts are in-memory only, discarded on close with a warning; "This game's defaults" is a second, separate manual save); authoring a SHARED component as its only copy, and a promote-from-Library-row affordance, are not built.
4. **A per-project default only reaches a built game on its next publish/bake** — the bundle carries the map, so changing a default in the tool does not retroactively change an already-published game.

## Blocked (owner / external)
- **⏳ Browser-verify `featureWorth`** (auth-gated, owner): in a Hold and Win project, give the
  TOTAL WIN component a number input **from** `featureWorth` with tier transitions (≥ 1000 → medium
  …). Play a feature: the tier steps up during the respins, not only at the end tally. Check that
  **Bind to value → Hold and Win** lists *Feature worth*.
- **⏳ Browser-verify segmented counters** (auth-gated, owner): (a) Components side → Library →
  create from **Segmented Counter**: the stage shows three segments 1 2 3; Properties → **Repeat
  (count)** → **Pass to each segment** → `value` test slider at 1 lights only segment 1, at 3 all
  three; **preview count** 5 draws five. (b) Open **Counter Segment** → Animate → State machine: ▶ Run,
  set `value` under the inputs: Lit / Unlit follow `value >= {index}`. (c) Re-skin: set `litImage` /
  `unlitImage` (or the colours) on your copy; set first / last variants to end-cap segments; the stage
  follows. (d) Place the bar on the Hold and Win screen (respins) and a copy with `countSource =
  freeSpinsTotal`, `valueSource = freeSpinsLeft` on the free-spin screen; publish and play: the
  segment count follows the award (a retrigger adds segments), and segments go dark as spins are
  used. (e) Every other screen and game looks and plays as before.
- **⏳ Browser-verify param forwarding** (auth-gated, owner): (a) open your Pot Meter copy →
  **Edit inside Pot ›**, select a firecracker: Properties → Component instance → Params shows a
  **⇡** picker beside each param. Pick **Expose on ‹Pot›** for `lightAt`: the row now reads
  `⇡ from ‹Pot› · lightAt`, and Component variables lists `lightAt` with the piece's value as its
  default. Do it on a second piece: it gets `lightAt_2`. (b) **🔥 Light order**: the exposed
  params' defaults are renumbered under Component variables, and the pieces' own values stay as
  they were. (c) On a third piece pick an existing param under **Take from
  ‹Pot›'s** (`pieceArt` shared by several pieces, say), then × it: the row gets its own value
  back and the parent param stays. (d) Expose an image or rig param: the canvas, and the rig
  layer, show the parent's default. (e) **Save**, then on the Pots screen select a pot: its
  Params list `lightAt`, `lightAt_2`, …; change one and the canvas and the game follow, while the
  other pots stay as they were. (f) **Inspect** an older version: the **⇡** pickers and × are
  disabled. (g) Publish and play: each pot lights its pieces at its own thresholds, and a
  project with no forwards looks and plays as before.
- **⏳ Browser-verify Phase 6b** (auth-gated, owner): (a) open a component with a trigger input
  (say `win`) → Properties → **Component variables → Events**: add `pressed`, open it, add a payload
  field `amount` (int); ✎ rename it to `tapped` and back (the dialog lists what raises it). (b)
  select a node (a button sprite) → **Listeners → + Listener**: set **On click → raise event →
  pressed**, fill `amount` = 5; add **On hover in → set input** on a bool. (c) **Animate → State
  machine**: on a state's inspector, **On enter → ＋ raise event** `pressed`. (d) hover and click
  the button on the stage: the **Events** log lists `listener pressed amount=5`; **▶ Run** logs the
  entry state's raise; an **On click → fire trigger win** listener moves the machine. Switch to
  the Timeline tab and back: the stage no longer reacts while hidden; Delete / Backspace in the
  Timeline tab deletes nothing in the graph. (e) × the event: the dialog warns, the listener row
  shows ⚠, nothing is dropped. (f) **Save**, reload: listeners, events and On enter are back;
  **Inspect** an older version: every new control is disabled. (g) Place the component on a screen,
  publish, play: the button reacts (hover / click) and nothing else on screen changed.
- **⏳ Browser-verify Phase 4a** (auth-gated, owner): the home card and an old `/components?id=X&project=P` bookmark land on the right component; double-click a placed instance on a screen opens it with `‹screen› › ‹name›` crumbs and Esc returns to that screen; a nested instance opens one level in and a third level is refused with the message; Esc clears a selection before leaving; leaving a dirty draft or dirty game defaults asks; Save / Save on top / Promote / version Inspect / This game's defaults + History still work; the screens' unsaved edits survive a round trip; reload on `/editor?component=<id>` reopens it.
- **⏳ Browser-verify Phase 5b** (auth-gated, owner): (a) open a component → **Animate** → the **State machine** tab; with two saved timelines (say *Idle* and *Win*), **＋ State** each: the first card shows the ● entry dot; drag a wire Idle → Win, click the arrow: add a condition on a trigger (declare `win` first under Properties → Inputs → **+ Add trigger**), set exit time 1 on a Win → Idle arrow; **▶ Run**, press **▸ win** under Preview inputs: the stage plays Win, the arrow flashes, the tab shows the state, Idle resumes when Win ends. (b) **＋ Layer**, a second layer keying another node: both run. (c) Double-click a card: the Timeline tab opens on that timeline; switch back: the graph is as left. (d) Properties → Inputs: add a bool and a number, set defaults; ✎ rename the trigger a condition reads: the condition follows; × on it warns. (e) **Save** (the editor bar), reload, reopen: the graph, positions and inputs are back; Inspect an older version: the tab is disabled with the rest of Animate. (f) Place the component on a screen, publish, play: the machine runs per instance; a `playOn: enter` pop-in on the same node shows first, then idle takes over.
- **⏳ Browser-verify Phase 4b** (auth-gated, owner): (a) open a component → **Animate** → ＋ New; **Plays on** defaults to `enter`; select a named node, key it at two times, ▶ previews; an unnamed / duplicate-named node shows the refusal; Save, reload, reopen. (b) Place two instances of it on one screen, publish and play the game: both play when they appear and hold the last frame. (c) A component **scoped by** a param with a timeline on a scoped signal: firing it for one scope plays only that instance. (d) **Also on** another component with the same node names: its instances play it too; a missing name shows in the ⚠ pill. (e) Animate is disabled while Inspecting a version; double-click/drag/Delete do nothing in Animate; Design behaves as before afterwards. (f) A user with `editor` but not `rigger` can list/open/save component timelines but never sees a rig cinematic; component timelines are absent from `/flow-v2`'s playCinematic picker.
- **Live-verify** — component render paths (state animations, version resolution, instance rebinding) build clean and type-check but are largely not browser-verified on the auth-gated canvas; owner confirms live.

## Recent changes
- 2026-10-25 — **A pinned version ships the components only it names; a pin warns once** (branch
  `claude/charming-cannon-rjv7ba`, in review). `commonoverlayproject` places `segmentedCounter`
  pinned at v4, whose first segment is `c_55h9isri`; v7 (latest) switched to `c_8m57uq5p`. The
  closure walked latest defs only, so `c_55h9isri` never shipped and the game drew the default
  segment where the editor, which draws variants from the project's whole store, drew it. New
  `resolveComponentClosureWithPins` (`engine-layout`) runs the closure, loads the pinned older
  versions (only an exact snapshot: `loadComponent` answers an unmatched built-in pin with the
  coded def, which the game never draws for it), then follows those versions' trees and the
  components their own `component`-kind params name, reusing every def already loaded; the doc bake,
  the runtime bundle and the art export all call it instead of each looping over the pins, so
  the three cannot drift. Nothing changes for a game with no non-latest pin. Separately, the
  "pins version … not registered" warning fired per instance render, hundreds of times a session
  for a def nested in a repeated part; it is now once per `id@version` (`warnPinNotHonoured`).
  Gate: `packages/engine-layout/scripts/test-component-closure.mjs` (twelve new assertions).
  The current-games harness (`scripts/current-games/lib/republish.mjs`) moved onto the same
  closure in a PR of its own (its verdict refuses a PR that edits the harness judging it), so its
  republished variants follow both rules too.
- 2026-10-23 — **Segmented counters: a segment's box (Size)** (branch `feat/segment-root-box`, in
  review, ⏳ not browser-verified). A segment drawn only from rigs and text (the owner's
  R_RespinTile looks) measures 0 × 0 — a rig or a text cannot be sized without loading it — so a
  row of them stacked 6 px apart, in game and on the canvas. Opt-in fix: `repeaterSegmentSize`
  (`engine-layout/repeaterCount.ts`) lays a segment out by its ROOT box when the def declares both
  `root.width` and `root.height`, from its origin right and down, else measures as before
  (`componentDesignSize`); `Repeater.svelte` and the canvas (`repeaterPreviewLayout`) both use it.
  The Component Editor bar gets **Size** W × H beside **Space** (`setComponentSize` in
  `ComponentWorkspace.svelte`; empty or ≤ 0 clears it); the normalizer already kept a root box.
  Only a count-mode repeater reads it (background cover-fit and the source-list repeater still
  measure), and a def without both sides lays out exactly as before. Gates:
  `check:component-repeat-segments` (71: the measure, the normalizer, rig-only segments mounted for
  real stacking without a box and stepping 166 px with a 160 × 120 one) and
  `check:component-repeat-segments-editor` (36: the canvas layout, the field). Guide:
  [§ Segmented counters](../tools/invisible-editor.md#segmented-counters--repeat-count).
- 2026-10-23 — **Segmented counters: a missing end cap draws the middle segment; rig looks draw in
  the editor** (branch `fix/segment-variant-fallback`, in review, ⏳ not browser-verified). Owner
  report (commonoverlayproject, *Respin counter*): after making the end caps with ⧉ Duplicate, the
  game drew only the middle segment. Root cause: the game was the player snapshot published at
  16:12, before the copies existed (16:15 / 16:17), so its registry had no def for either variant
  and `ComponentInstance` drew nothing for them; the middle draws because `segmentedCounterSegment`
  is a built-in id. The duplicate, the editor and the engine were correct (the owner's exact stored
  defs mount and light 1 / 2 / 3 in the check below); the 16:35 publish carries the copies. Changes:
  `repeaterSegmentComponent` / `repeaterCountOffsets` take a `has` (the registry; the editor's def
  map), so a variant naming no def draws and is sized as the middle segment, and `Repeater.svelte`
  warns once naming the repeater, the slot and the id (`missingRepeaterVariants`);
  `resolveComponentClosure` reports an id with no def through `onMissing`, which the runtime bundle
  logs (live boots and Publish). Editor: the rig layer now walks count-mode repeaters
  (`collectSegmentRigs` in `EditorRigLayer.svelte`, over the canvas's own `repeaterCountBoxes` and
  settled poses, leaving out a look faded to alpha 0 since the layer draws no alpha) and the canvas
  mounts it for a rig inside a segment (`nodesHaveRig`), so a segment drawn from rigs (the owner's
  R_RespinTile looks) shows its art there; before, only a "rig:" placeholder or nothing. Gates:
  `check:component-repeat-segments` (71: the fallback, `onMissing`, and the owner's counter mounted
  for real, with and without its first end cap registered) and
  `check:component-repeat-segments-editor` (39: rig-look end caps made by the real duplicate, the
  fallback, the rig-layer wiring). Still open: a segment drawn only from rigs and text measures
  0 × 0, so such segments stack (next PR: an opt-in root box); the rig layer keeps ONE skeleton
  per rig file, so segments resting on different animations of one rig draw right while still, but
  ▶ playing one of them (or an `enter` cue on only one look) makes them reset each other every frame
  — the rig freezes on its first frame until play stops.
- 2026-10-23 — **`featureWorth` as a component source** (branch `claude/feature-worth-source`, owner
  ask). A Hold and Win TOTAL WIN widget can tier off the feature's running value during the respins
  instead of `featureTotal` (the win meter, which only climbs in the end tally). One reader:
  `featureWorthOf(state)` in `engine-game/holdAndWin.ts` (`stateHoldAndWin.total`, finite-guarded),
  wrapped as `featureWorth()` in `apps/lines/stateHoldAndWin.svelte.ts`. Flow's
  `$engine.featureWorth` and the new component source both call it. Unit: book-event units, 100 = 1×
  total bet, the same as `featureTotal` / `totalWin`, so there is no conversion. It reads 0 before
  any feature. It moves with each respin's `holdAndWinState` snapshot, recorded at the play seam
  before the event is presented, and holds the end's total after `holdAndWinEnd`. A new spin clears
  it: `startHoldAndWinRound()` in `onNewGameStart`, via `atRoundStart` (only `total` is written, and
  an open feature keeps it). Before this change Flow's value held the last feature's worth until the
  next trigger. Registered in `Game.svelte` with the win meter's formatter, so a text binding shows
  currency. Catalog: `VALUE_BINDING_SOURCE_CATALOG` (group *Hold and Win*, the note states the unit)
  and `HOLD_AND_WIN_PARAM_CATALOG`. That puts it in Bind to value, the number-input / repeater
  count / `passInputs` picker (`engineSourceGroups`) and a Hold and Win part's or Text Box's `source`
  options. Nothing to bake: it is a runtime registry entry like `featureTotal`. Gate: `pnpm
  check:feature-worth` (95 checks, including real facade + mock rounds folded through the reducer).
  Mutation-checked with 15 mutants, every one caught (incl. the round-reset body, a commented-out
  call, a Flow read that bypasses the reader, and a stray `.total` read anywhere in the game). Guide: [invisible-editor
  § The State Machine](../tools/invisible-editor.md#the-state-machine) (choosing `featureWorth` or
  `featureTotal`).
- 2026-10-23 — **A counter inside a component draws in every renderer, and all three cut nesting at
  the same level** (branch `claude/component-nesting-parity`, ⏳ not browser-verified). Owner report:
  the Hold and Win TOTAL WIN widget's Segmented Counter showed in the Component Editor and was
  missing in the Scene Editor. Cause: the counter spends two levels (counter → segment), so
  screen → widget → counter → segment needs three and the cap was 2; the game skipped the segments
  too (proven by mounting the real `ComponentInstance`). The Component Editor drew them only because
  its stage put the open def's nodes at a screen's level 0, where the game draws them one level down
  inside the placed instance. Fix: `MAX_COMPONENT_DEPTH` 2 → 3 (no built-in nests deeper than one
  level of its own, so every built-in now draws whole inside an author's component), and the canvas
  takes a `componentNest` (`editorCanvas.helpers.ts`: `SCREEN_NEST` for a screen,
  `componentEditorNest(trail, id)` for the open def — one level down plus one per breadcrumb def,
  all on the cycle stack) that the 2D draw, the depth split and the rig / text / effect layers start
  from. `canEnterNested` is unchanged and now agrees with it by construction. Localization harvest
  and cue measurement follow the constant. Gates: new `check:component-nesting-parity` (29: built-ins
  whole inside a component, the editor's nest, the same expanded nodes as a screen at every
  breadcrumb depth, the source wiring, the breadcrumb rule); `check:component-repeat-segments` mounts
  the widget shape (fails on a cap of 2); `test-cue-duration` and `check:component-param-forwarding`
  move their "one past the cap" cases a level down. **Game change:** any authored component nested
  three levels deep, which the game skipped, now draws. The selection box (`nodeBox`) takes the nest
  too, so it stops expanding where the draw does.
- 2026-10-23 — **The stage shows the art a component's state machine rests on** (same branch, ⏳ not
  browser-verified). Owner report: the TOTAL WIN widget's R_Widget frame was gold in both editors
  and a teal plate in the game. Cause: the widget's machine enters `mini`, whose timeline keys the
  frame's `mini` tier; the game layers that strip over the rig's own `Grand` (`withTimelineScrub`),
  the editors drew `Grand` and ran no machine outside Animate. And the State machine panel's stage
  never showed a tier either: `playerDrives` dropped a node whose only keyed channel is an animation
  strip. Fix: `playerDrives` keeps an `animTime` sample; `segmentPreview.ts` gains `settledDrives`
  (the memoised settle, shared with the segment preview) and `restingStateStrip`; the rig layer poses
  every rig, top-level and nested, with the strip its def's machine settles on at its inputs'
  defaults (a previewed timeline still wins). The open draft rides on `ComponentNest.def`, so the
  Component Editor rests on the unsaved machine; while a timeline or the machine previews, the preview alone poses the rig, and only a def with a machine fetches its timelines. Gate: `check:component-resting-state` (12). Owner
  side, not a bug: the widget's `Content` input reads `featureTotal`, the HUD win meter, which is 0
  on Feature intro and through the respins (it climbs only in the end-of-feature tally) and counts
  hundredths of the bet (100 = 1× bet), so `Content > 5` never fires there and means 0.05× bet once
  it does.
- 2026-10-23 — **✎ Rename a component** (branch `claude/component-rename`, in review, ⏳ not
  browser-verified). A ✎ beside ⧉ on each row of the Components list (home and Browse) renames one
  of the project's OWN components (`scope: 'project'`). On a shared or built-in row it is greyed
  out with the tooltip "Duplicate it first to rename your copy" (owner decision: no in-place
  rename of shared or built-in components). *How*: `componentRename.client.ts` (pure:
  `componentRenameProblem`, which trims and rejects empty or a name another listed component uses,
  case-blind; `writeComponentRename`) and `renameComponentDef` in `ComponentWorkspace.svelte`.
  The project's stored def is read fresh with its ETag (`GET /api/editor/component?stored=project`
  → `loadStoredProjectComponent`: the stored bytes without the coded-twin merge, so a built-in's
  project copy does not gain the twin's newer params and bump) and saved back with only `name`
  changed, as a CAS on that ETag through the existing route. A save landing in between
  refuses the rename (409), and nothing is written. The draft save is held while the rename runs.
  **Versioning:** `reconcileVersion` (`componentStorage.ts`) now ignores `name` when deciding a
  bump. The name labels the def in the lists, and no placement, bake or game reads it, so a rename
  keeps the version: the latest pointer is rewritten at the same version, no new snapshot is
  written, and pinned placements get no "↑ vN". That version's immutable snapshot keeps the name
  it was saved under. The next content change bumps as before, and its snapshot carries the new
  name. `check:save-keeps-unknown-blocks` had used a name-only edit expecting a bump; it now
  expects the kept version. **Open draft:** if the renamed component is open, the draft and its
  saved baseline take the new name in place, so unsaved edits stay unsaved and nothing is
  discarded, which is why no "discard?" ask is needed. It adopts the new ETag only when it was
  based on the object the rename read; otherwise its next save conflicts as it would have. The
  breadcrumb reads names from the list, so it follows. **Not done — placement labels:** a
  placement's `label` (seeded from the def's name on placement) is left alone, on screens and
  inside other components. Screen and component timelines bind node actors BY LABEL
  (`findNodeByName` / `findActorNode`), so relabelling would silently detach animations. The write
  would also span scenes.json plus every nesting def, each its own CAS object (non-atomic), and
  bump every nesting def's version. The id reference is what keeps everything working. **Known
  edges:** the lease covers only the open component, so a component another author has open can be
  renamed; their next save conflicts, and their **Save on top** restores the old name. **◇ Edit as
  component** reuses a project def whose name equals the container's label, so after a rename it
  matches the new name, not the old. Gate: `pnpm --filter launcher-api check:component-rename` (38
  checks; the real route over an in-memory R2, including a built-in's project copy).
- 2026-10-23 — **⧉ Duplicate a component** (branch `claude/component-duplicate`, in review, ⏳ not
  browser-verified). A ⧉ on each row of the Components list (home and the Browse tab) copies ANY
  listed component — project, shared or built-in — into a new project component and opens it.
  Why: the owner's segmented-counter end caps were a Counter Segment wrapped in a new component,
  which nests 3 deep (past `MAX_COMPONENT_DEPTH` 2) and never receives the repeater's `index` /
  `value`; a real copy fixes both. *How* (`duplicateComponentDef` in `ComponentWorkspace.svelte`,
  pure part `editor/componentDuplicate.client.ts`): asks first when the open draft or its defaults
  are dirty; reads the def as the project resolves it (`GET /api/editor/component?id&project`:
  project ▸ shared ▸ built-in, latest); new id `c_xxxxxxxx` (`genComponentId`, as ＋ New), every
  node re-id'd, `version: 1`, `scope: 'project'`, `internal` dropped; name "‹name› copy" / " copy
  N". Its timelines — `/api/cinematics/list` rows hosted on it, merged over `BUILTIN_TIMELINES` by
  id (`componentOwnTimelines`, as the canvas's segment preview does) — are copied under
  `componentTimelineId(copy, name)` ids clear of every listed and built-in id, re-hosted on the
  copy, `playOnComponents` dropped (the source's reuse stays the source's); node actors keep their
  targets (a component timeline finds its node by label only — `findActorNode` — and the copy keeps
  every label); the built-in-only flags (`buttonStates`, `settles`, …) are kept, since the runtime
  reads them off the def, so a copy of a presentation plays as it does; the copy's states are re-keyed
  onto them, a state playing a timeline reused from another component keeps it. *Defaults:* this
  game's sidecar values are BAKED into the copy's param defaults (and override a matching
  `defaultInstanceParams` key, which resolution layers above defaults) — the copy is already this
  project's fork, so one source of truth (the def) beats a second sidecar file written
  non-atomically beside it; engine-provided and undeclared keys are skipped. *Writes*
  (`writeComponentDuplicate`, pure over injected writes): the timelines first, each create-only
  (`baseEtag: null`), then the def through the draft `saveState.save()` (`componentSaveRequest`,
  `baseEtag: null` ⇒ `If-None-Match: *`; deliberately not `saveComponent`, whose conflict answer
  stacks on top). The def counts as saved when the save recorded the server's ETag (even if the tab
  moved on), as refused only when a re-read then answers 404 — then the copy closes (only if it is
  still the open one), the timelines it created are deleted (awaited; any left over are named), and
  the reason shows; with no answer at all nothing is deleted and the author is told to reload (and
  which timelines to delete if the copy is not there). The list rows, ＋ New, close, delete and
  Back to screens are held while it runs; it asks again if the open draft changed during the reads,
  refuses (and rolls back) if it changed while the timelines were written, and the copy opens at
  the top of the breadcrumb. Fresh timeline ids clear every listed project timeline; a listed one
  that reads back empty stops the copy. Accepted residue: a def POST that fails at the network
  level while the server is still committing, followed by a 404 re-read, would delete the
  timelines under a def that lands after — a far-fetched race. Same validation and export→bake→pull
  chain as any project component. Gate: `pnpm --filter launcher-api check:component-duplicate`
  (53: naming, fresh/unique node + timeline ids across two copies, state re-keying, actor targets,
  defaults baking, the real route's create then 409 on a second create, every write/rollback
  branch, the workspace wiring). Not run end to end: the timeline creates through the real
  `/api/cinematics/save` (its gate needs the session/DB).
  UI: [guide](../tools/invisible-editor.md#duplicate-a-component).
- 2026-10-23 — **Editing a built-in no longer fails to save; the error says why; no empty-key asset
  request** (branch `fix/component-save-400`). Owner report: the re-skinned **Counter Segment**
  (`segmentedCounterSegment`, both looks swapped to the project's `R_RespinTile` rig) answered a
  bare "Save failed", the console showing a 400 on every save and one on `/api/editor/asset?key=`.
  *Cause:* a built-in opens as `scope:'shared'`, and Save posted it to the shared library; a shared
  def may not place one project's rig, so `healForeignRigRefs` refused it (400, naming the rig).
  The reason was in the pill's tooltip only. It is not specific to the segmented counters (#1276): any built-in or shared
  def edited with project art hit it, and a new (project) component with a rig always saved.
  *Fix:* `componentSaveRequest` (`editor/componentSave.client.ts`) sends a shared or built-in draft
  opened in a project as that project's copy under the same id, creating it (`baseEtag: null`); it
  shadows the shared def in this game only, and the pill says so. It keeps the shared `version`,
  so an instance pinned to it (the bar's segments) resolves to the copy. An untouched shared def
  makes no copy (a copy stops following the shared one; deleting it goes back). With no project open, a shared
  draft still saves to the shared library; **Promote to shared** is the shared write. The error
  pill shows the server's message (`componentSaveError`). The canvas builds full-image URLs
  through `canvasImageUrl`, which returns `null` for an empty key, so an unbound art slot fetches
  nothing. Gate: `check:component-save-copy` reproduces the 400 through the real route, then saves
  the segment, the Segmented Counter bar and a new component with a rig. Owner data: no repair is
  needed, since every refused save wrote nothing.
- 2026-10-20 — **Segmented counters, engine side** (branch `claude/component-repeat-segments`,
  ⏳ not browser-verified; design [rive plan §6.4](../design/rive-style-editor.md#64-count-mode-repeater-segmented-counters)).
  `RepeaterNode` gains optional `count` (`{source?, preview, max?}`), `variants`
  (`first`/`middle`/`last`), `passInputs` and editor-only `previewInputs`, and `layout.direction`
  gains `column`. `<Repeater>` in count mode repeats its component N times: N follows the engine
  value `count.source` (`{param}`-templated against the enclosing instance), clamped to `max`
  (default 20, never above 50); each instance gets params `index` (1-based) / `count`, and the same as
  constant number inputs when its def declares them; `passInputs` feeds each instance's number inputs
  from engine values (`ComponentInstance` props `inputSources` / `inputValues`). Pure geometry in
  `engine-layout/repeaterCount.ts`, shared with the editor. The ship chain: `collectComponentIds`
  collects the variants (bake, runtime bundle, art export), `stockAssets` too; the normalizer
  (`normalizeRepeaterCountFields`) keeps the fields and drops malformed ones. Free-spin number feeds
  `freeSpinsLeft` / `freeSpinsPlayed` / `freeSpinsTotal` (from `freeSpinCounterValues.ts`) beside
  `respinsLeft` / `respinsStart`, in the Bind-to-value catalog under *Free spins*. Built-in starter
  **Segmented Counter** (`segmentedCounter`, params `countSource` / `valueSource`, `backgroundImage`)
  repeating **Counter Segment** (`segmentedCounterSegment`: `unlit` / `lit` looks with colour + image
  params, an `index` label, input `value`, SM `Unlit ⇄ Lit` on `value >= {index}`; timelines
  `c_segmentedcountersegment_lit` / `_unlit`). Absent fields ⇒ today's repeater byte for byte; no
  current game places the new built-ins. Gate: `check:component-repeat-segments` (62, incl. a mount on
  the real Svelte runtime + pixi ticker). Known: a timeline keying `alpha` back to 1 on a node with no
  authored `alpha` leaves the old value on screen (the starter's looks carry `alpha: 1`); a counter
  nested inside another component hit `MAX_COMPONENT_DEPTH` and its segments didn't render (fixed
  2026-10-23, below).
- 2026-10-20 — **Segmented counters, editor side: Repeat (count)** (branch
  `claude/component-repeat-segments`, ⏳ not browser-verified; guide
  [§ Segmented counters](../tools/invisible-editor.md#segmented-counters--repeat-count)).
  Library → Elements on the Components side offers **Repeat (count)** (`newCountRepeater`: a
  count-mode repeater, `source: ''`, preview 3, a row 8 px apart, of the first component declaring
  `index`). Properties' `EditorRepeaterCount.svelte`: segment + first / middle / last variants, preview
  count, **count from** (the Bind-to-value source picker, now shared as `EditorValueSourcePicker` /
  `valueSourceOptions.ts`), max, row / column / grid layout, and **Pass to each segment** (a source
  per number input — `index` / `count` read-only — with a test value written to `previewInputs`).
  The canvas, text overlay and selection box share `repeaterCountBoxes` / `repeaterPreviewLayout`
  (`editorCanvas.helpers.ts`, over engine-layout's `repeaterCount` / `repeaterCountOffsets` /
  `repeaterSegmentComponent` and `componentDesignSize`, so they frame what the game lays out), and
  each segment draws at its state machine's settled pose (`$lib/timeline/segmentPreview.ts`: the
  game's runner + player, sampled at the settled state's end frame and folded into a copy of the
  def's nodes), from the built-in + project component timelines (`segmentTimelines.client.svelte.ts`,
  re-read when another component opens). A source-list repeater draws exactly as before. Gate:
  `check:component-repeat-segments-editor`.
- 2026-10-20 — **Rive plan Phase 9c: the state machine's options, Inputs dock and Console** (branch
  `claude/rive-p9c-animations-sm`, in review, ⏳ not browser-verified; checklist in
  [editor status](editor.md) Open item 0c, which also has the Animations list).
  - **Format and runtime** (`engine-layout`, all additive and optional; semantics in the plan's §5):
    `SmState.onExit`; on `SmTransition`, `disabled`, and with a blend `ease` (cubic),
    `pauseSource: false` and `allowExit: false`; `SmLayer.disabled`. `ComponentStateMachineRunner`
    skips a disabled transition (and holds no trigger for it), shapes the blend's progress with
    `easeShape`, keeps the left state playing under the blend (`LayerPlay.from.playing`), and
    blocks every transition while a locked blend runs (a trigger one reads is held until it ends,
    as for an exit time). A disabled layer sits in `exit`.
    `ComponentTimelinePlayer` samples a playing source live (`Mix.live`). The
    `ComponentEventDispatcher` raises the left state's `onExit` before the target's `onEnter`; the
    localization harvest and `validateComponentEvents` read `onExit`. Validation's reachability
    ignores a disabled transition. The normalizer keeps the new fields (the blend's three only
    with a blend, and only their non-default values); `componentFields.ts` knows them; the
    keep-unknown save grafts `onExit` rows like `onEnter` rows.
  - **Parity:** a doc without the fields (or with them at their defaults) runs and saves
    byte-identically. The gate proves defaults-vs-absent on scripted runs and the byte-identical
    save; separately, a one-off local differential (not in the gate) over 400 random machines
    matched `main`'s runner exactly.
  - **The panel** (`EditorStateMachinePanel.svelte`): the **Inputs** list docks left of the graph
    with its preview controls (Preview inputs left the inspector), plus add (bool / number: a
    trigger is a declared signal, added in Properties), ✎ and ×, through `ComponentWorkspace`'s
    own handlers, the ones Properties uses. The transition
    inspector gains **Interpolation** (`EaseCurveEditor.svelte`: Linear / Cubic, 9b's curve and
    typed field; value helpers in `$lib/timeline/easeCurve.ts`), *Pause source when exiting*,
    *Allow exit during transition* and **Disable** (dashed arrow, "off ·" label). States gain
    **On exit** (`addExitAction` / `removeExitAction`, `x_` ids; an issue on one reads "On exit
    of state …"). A duplicated layer's action rows get fresh ids. Layers gain ⧉ duplicate, ◀ ▶
    reorder (the runtime defines the winner by order) and ⏻ disable. The **Console** strip under
    the graph logs entered states, taken transitions and raised events (the Events log moved here).
    Its **Problems** tab gathers `validateStateMachine` and `validateComponentEvents`, and a click
    jumps to the layer, card, arrow or input (`problemTarget`). Pure edits in `stateMachineEdit.ts`:
    `duplicateLayer`, `moveLayer`, `setLayerDisabled`, `setBlend` (clearing the blend clears its
    options), `setBlendEase`, `setBlendFlag`, `setTransitionDisabled`, `problemTarget`.
  - Gates: `check:component-state-machine` §10 (184) and `check:component-state-machine-editor` §6
    (79).
- 2026-10-17 — Owner browser check passed for the Rive plan's component work (Phases 4–8); the
  authored free-spin and button pilots are unlocked ([engine status](engine.md) 2026-10-17).
- 2026-10-16 — **A tile named only in "This game's defaults" ships again** (branch
  `claude/gallant-rubin-6f066u`). `componentDefaultsFor` looked a def up by `r2Slug(id)` only, but
  `listComponentDefaults` keys every sidecar saved since the id stamp by its REAL id
  (`lettersStrip`), so a camelCase def's project defaults were missed. `resolveComponentClosure`
  reads a `component`-kind param's project default through it (runtime bundle, doc bake, art
  export), so a Letters Strip or Respin Cell Tiles `tile` set only in the project's defaults left
  that tile def out of the published bundle and the baked doc. It now tries the real id, then the
  slug (a sidecar from before the stamp). Gate: `pnpm --filter launcher-api
  check:component-defaults-lookup` (7: a stamped camelCase sidecar by its id, a legacy one by its
  slug, and the real closure shipping both tiles; it failed 2 before the fix).
- 2026-10-16 — **Save component also saves this game's defaults, and the Screens side sees them
  at once** (branch `claude/exciting-gates-phk1e6`). Owner report: the Pot Meter's new **pulse on
  every coin collected too** tick in *This game's defaults* "is not getting saved, it turns off
  every time". Reproduced headlessly by mounting the real `ComponentWorkspace` over a faked
  sidecar API. The panel and its own save were fine. Two traps made a ticked value look lost:
  - **Save component didn't write the defaults.** The bar's button showed *Component saved* while
    the sidecar stayed untouched. The only sign was the small *Unsaved* badge at the top of the
    defaults block, far above the Motion group. Closing the component then offered to discard it.
    Now `saveComponent` also runs `defaultsSave.save()` when `defaultsDirty`, alongside the def save
    (separate `SaveState`s, so a conflict in one never blocks the other). The pill reads
    *Component and this game's defaults saved*, or reports the defaults failure while their badge
    offers *Reload theirs / Overwrite with mine*. *Save for this game* still writes the defaults
    alone. With only the defaults dirty, the bar's Save writes just them (no def write, so a stale
    ETag can't offer to stack an untouched draft on someone else's version). A defaults save already
    in flight is left to its own badge rather than reported as done.
  - **The Screens side kept the page-load defaults.** The editor page passed `data.componentDefaults`
    to the canvas and the instance panel and never refreshed it, so a default saved on the
    Components side still read as off on the placed pot until a reload. The page now keeps its own
    `componentDefaults` state. `ComponentWorkspace` reports every sidecar save, read and restore
    through `onDefaultsChange` (`rememberDefaults`, which also keeps the paint-only seed).
  - Verified in headless Chromium over the real components: tick → *Save component* writes
    `{ pulseOnCollect: true }` and reports both saved; close and reopen shows it ticked; a
    conflicting sidecar keeps the tick on screen and shows the conflict. `check:component-links`
    75, `check:svelte` at baseline (46), `check:undefined-names`, ESLint and the launcher build are
    green. ⏳ Not clicked through on the live auth-gated `/editor`.
- 2026-10-15 — **A nested component's params can be exposed on its parent** (branch
  `claude/gifted-hawking-uv5utk`). Owner report: a component placed inside another (the
  firecrackers inside the Pot Meter's `Pot`) showed its params only inside the parent's editor,
  fixed into the parent def, so nothing about a piece could be set per placement of the pot. Now:
  - **Format**: a nested instance's `paramBindings['params.<key>'] = '<parentKey>'` gives its
    `<key>` the enclosing instance's `<parentKey>`, a param the parent declares (design §13.2 item
    4). No new field: the normalizer keeps `paramBindings` and `pruneOrphanParamBindings` drops a
    forward whose parent param was deleted, inside a part too.
  - **Engine** (`componentParams.ts`): `forwardedParams`, `forwardInstanceParams` (the same map
    back when nothing is forwarded; the forward wins over the instance's own base or per-ratio
    value; an `undefined` parent value is skipped; chains compose) and `defineForwardedParams`.
    `<ComponentInstance>` applies the forward before it resolves its static params, so `source`,
    `action`, the signal scope and the state machine's `{param}`s see it, and adds a getter per
    forwarded key after the per-ratio getters and before the live feeds. A parent's per-ratio
    value therefore reaches the child, and a live feed still wins.
  - **Editor preview**: every walker that expands a nested instance forwards from the enclosing
    params: `drawComponentInstance` and `nodesHaveRig` (`EditorCanvas`), the content box
    (`editorCanvas.helpers.ts`), the rig layer (top level, through a new `componentParams` prop,
    and nested), the text layer. On the Components side the enclosing params are the open
    component's preview params. The effect layer and the value preview read no component params.
  - **Editor UI** (`EditorProperties.svelte`, component mode, a nested instance selected): a **⇡**
    picker beside each author param: **Expose on ‹parent› (new param ‹key›)**, or **Take from
    ‹parent›'s** an existing param of the same kind. A forwarded row shows `⇡ from ‹parent› ·
    ‹key›` in place of its value, with × to stop forwarding (the parent param stays). The edits
    are in `editor/instanceParamForwarding.ts`. An exposed param copies the kind, label, group
    (kept together per placement, made unique across placements), options and `fedParams`; its
    default is the value the piece shows now; its key is the child's, else `_2`, `_3`…, never an
    engine-catalog or behaviour key (`source`, `action`, `text`, `label`, …). A rig-name param's
    `spineParam` follows the parent's copy of that rig param. Disabled while Inspecting.
    **🔥 Light order** writes a forwarded piece's threshold into the parent param's default.
  - **Ship**: a forwarded value lives in the parent's instance params under a param of the same
    kind, so the art export, the atlas-ref repair and the component closure ship it unchanged.
    The localization harvest now also walks nested instances, as deep as the game draws (two
    levels), with their forwards resolved. Before this, text inside a nested component was never
    harvested.
  - Gate: `check:component-param-forwarding` (106 checks: the helper, the runtime getters, the
    state machine reading a forwarded `{lightAt}`, the expose / link / unlink edits, pruning, the
    save, the unused-param filter, `nodeBox`, the harvest and the real `exportEditorArt`). The
    Svelte wiring is source-scanned, not mounted.
- 2026-10-15 — **The fourth authored overlay: `buttonPresentation` (Rive plan Phase 8d, branch
  `claude/rive-p8d-buttons`).** A new `internal` built-in def beside `button` (unchanged, same
  params plus `fadeWithUi`): six frame nodes (four rounded tiles, the state frame and its grey) under
  a tinted `frame`, the coded `ButtonLabel` as a bound child, and the engine's first seeded state
  machine on a built-in (look / spin / fade / press sound). Rect nodes gain `borderRadius` /
  `borderWidth` / `borderColor` (the launcher's component field list keeps them). No palette entry
  during the pilot; nothing changes in the Components side itself. The flag, the runtime and the
  gates: [engine status](engine.md), 2026-10-15.
- 2026-10-14 — **A flipped rig previews on the right axis.** A rig inside a group or a placed
  component that was flipped with `scale.x = -1` showed upside down on the stage instead of
  mirrored left-right. The rig preview draws without rotation, and it worked the flip out from the
  determinant alone, so every single-axis flip landed on Y; flipping both axes showed no flip at
  all. `unrotatedScale` (`editor/editorCanvas.helpers.ts`) now keeps X's sign from the matrix and
  lets the determinant decide Y, and the three nested rig paths in `EditorRigLayer.svelte` use it.
  Editor preview only: the game already drew these correctly, and top-level rigs were right. The
  Scene Editor stage shares the rig layer, so it is fixed there too. A half turn on a parent now
  previews upside down, as the game shows it, where it used to show upright.
- 2026-10-14 — **The second authored overlay: `winPresentation` (Rive plan Phase 8b, branch
  `claude/rive-p8b-win-design`).** A new `internal` built-in def beside the hybrid `win` twin
  (unchanged, same params): one rig node `tier` with `boardFit`, the caption and count text nodes
  riding the rig's count slot through the new `rigSlot` node field (both fields live on the
  built-in def only — the launcher's node normalizer does not know them and need not), the coins
  as a bound child; no palette entry during the pilot. Its timelines are generated per tier at
  boot, not authored. Nothing changes in the Components side itself. The flag, the runtime and the
  gates: [engine status](engine.md), 2026-10-14; the launcher row and chips: [editor status](editor.md).
- 2026-10-14 — **Per-placement thresholds in the state machine.** A number condition can compare
  against the instance's own param (`{lightAt}`), ops `<=` / `>=` are added, and an input's `source`
  `{key}` resolves through the enclosing instance. Built for the firecracker pot; detail in
  [pots overlay status](pots-overlay.md), 2026-10-14.
- 2026-10-14 — **The first authored overlay: `transitionWipe` (Rive plan Phase 8a, branch
  `claude/rive-p8a-transition-overlay`).** A new `internal` built-in def beside the hybrid
  `transition` twin (unchanged): one rig node `wipe`, no text, no params, no palette entry during the
  pilot; its timeline is the engine's first built-in timeline. Animate → **Plays on** gains a
  **Holds the cue** tick (`CinematicDoc.holdsCue`, saved through the existing cinematic save, cleared
  with Plays on). Phase 8 continues with Win (8b), the free-spin intro/outro (8c) and the buttons'
  `stateAnimations` → a seeded state machine (8d), per the plan's §13 inventory. The flag, the
  runtime and the gates: [engine status](engine.md), 2026-10-14.
- 2026-10-13 — **Flow instance nodes (Rive plan Phase 7a, branch
  `claude/rive-p7a-flow-instance-nodes-runtime`)** — the component side: input kind **`text`**
  (`COMPONENT_INPUT_KINDS`; a default is a localization key; the state machine never conditions on
  it — `condition-input-text`; the normalizer keeps it, so a row an older build kept unreadable now
  reads), `flowInstanceInterface(def)` (the interface as a Flow node sees it), and every TOP-LEVEL
  placement registers a live handle (`flowInstances.ts`, built by `flowInstanceHandle.ts`: a Flow set
  is read as the input's kind the way the runner reads one) Flow fires, sets, reads and waits on. An
  event id or a payload field name carrying `:` (Flow's pin separator) is refused (`event-pin-id`) and
  a number input with an engine `source` gets no Flow pin. The Flow side is in [flow.md](flow.md). The Inputs block does not offer `text` yet (7b / the 6b UI).
- 2026-10-13 — **Listeners + events in the editor (Rive plan Phase 6b, branch
  `claude/rive-p6b-listeners-events-editor`).** `EditorListeners.svelte`, `EditorEvents.svelte`,
  `EditorRaisePayload.svelte`; On enter + an Events log in `EditorStateMachinePanel.svelte`; the
  stage's pointer through `EditorCanvas` `onStagePointer`; pure edits in
  `$lib/timeline/listenerEdit.ts`, the pointer in `$lib/timeline/listenerPreview.ts`; `placeLayers`
  routes `event:` cues. Gate `check:component-listeners-events-editor`. Browser-verify list under
  Blocked. Review round: a shared def keeps its last event; a project def's last event can't be removed while one of its timelines has an
  `event:` cue (with none declared a cue is a screen-wide broadcast); Save and Promote refuse a row
  the server reader would drop (`unsavableRows`, the readers moved to `$lib/componentEventRows.ts`
  so client and server share them); a text key needs a letter at the field; `int`/`ms` round; a
  rename onto a name stale rows still raise is refused; the first ▶ Run re-crosses the entry cue
  (`startLayers`); the stage hit-test is the pure `deepHit`; an input rename follows listeners and
  payloads.
- 2026-10-13 — **Listeners + events, format and runtime (Rive plan Phase 6a, branch
  `claude/rive-p6a-listeners-events-runtime`).** New `ComponentDef.events`, node `on`, state
  `onEnter`; `componentEvents.ts` (dispatcher, raise road, `event:` cues, validation) and
  `componentListenerContext.ts`; `LayoutNodeView` wraps a listening node only; `ComponentInstance`
  builds a dispatcher only for a def with listeners or events; `FlowPressResolver` gains an optional
  `kind` (`'event'`) and `apps/lines` skips the press sound for it; `engine-layout` now depends on
  `engine-flow-v2` for the `ParamDecl` type. Gate `check:component-listeners-events`. The new fields
  are in #1185's known-fields sets (`componentFields.ts`), so a cleared value is never grafted back.
- 2026-10-13 — **Component saves keep the fields they do not know** (owner decision; branch
  `claude/component-save-keeps-unknown-fields`, #1185). An older launcher no longer erases a newer
  one's fields from R2. `saveComponent` (also on a forced "Save on top") keeps the stored def's
  unknown top-level fields and, matched by id, the unknown fields of every node (root included),
  param, signal, slot and input the author kept (a param / slot / input only while its `kind` is
  the same), and of each state-machine layer and its states and transitions (`stateMachine` itself
  is a fixed namespace). A deleted entity is never resurrected. An input of a kind this build does
  not know (the gate stands one in as `vec2`; `text` is known since Phase 7) is kept in place. An existing `<id>.v<N>.json` snapshot is never
  rewritten. Promote to shared carries the promoted project def's fields (`promotedFrom` +
  `sourceEtag`) and answers 409 `source-conflict` when that def changed since the draft loaded.
  "This game's defaults" and its restore keep theirs (a restore, the backup's). Known fields:
  `apps/launcher-api/src/lib/server/componentFields.ts`. Rules and reasoning:
  [doc-readers](../conventions/doc-readers.md) "Round-tripping". Gate:
  `check:save-keeps-unknown-blocks` gains a components section (141 checks in all).
- 2026-10-13 — **The State Machine panel (Rive plan Phase 5b, branch
  `claude/rive-p5b-state-machine-editor`, stacked on 5a).** Timeline | State machine tabs in
  Animate; `EditorStateMachinePanel.svelte` + `SmGraphNode.svelte` on `@xyflow/svelte`; pure edits
  in `$lib/timeline/stateMachineEdit.ts`, the stage preview in `stateMachinePreview.ts`;
  Properties' Signals block → **Inputs**; `SmState.pos` / `SmLayer.pseudoPos` in the format. Gate
  `check:component-state-machine-editor` (37). Browser-verify list under Blocked.
- 2026-10-13 — **State machine format + runtime (Rive plan Phase 5a, branch
  `claude/rive-p5a-state-machine-runtime`).** `inputs` + `stateMachine` on the `ComponentDef`
  (normalized on save, unknown extras kept out, nothing migrated); `signals` fold into trigger
  inputs through `componentInputs()`, which every reader now uses; one pure interpreter per
  placed instance (`engine-layout/stateMachine.ts`) driving the 4b player's slots; new gate
  `pnpm --filter launcher-api check:component-state-machine` (89 checks). Plan §5 records the
  as-built shapes and semantics; §12 #4 is decided (fold). No editor UI yet — that is 5b.
- 2026-10-13 — **Component timelines (Rive plan Phase 4b, branch `claude/rive-p4b-component-timelines`
  stacked on 4a).** Design | Animate on an open component; the shared Timeline panel with a
  component host, **Plays on** (`playOn`), **Also on** (`playOnComponents`) and a validation pill.
  Each placed instance plays its def's timelines on its own signal bus (engine detail, access and
  ship chain in [cinematic status](cinematic.md)). New gate `pnpm --filter launcher-api
  check:component-timelines` (39 checks); `check:cinematic-access` 36. Browser-verify list under
  Blocked.
- 2026-10-13 — **Folded into `/editor` (Rive plan Phase 4a).** `components/+page.svelte` moved to
  `editor/ComponentWorkspace.svelte` and mounts as the editor's Components side; every capability
  is kept (create types, params/signals/scoped-by, value bindings, skinnable parts, Space, version
  Inspect, ETag save + Save on top, Promote to shared, This game's defaults + History, edit lease,
  unsaved warnings). New: a breadcrumb (`Screens › Components › X`, or `‹screen› › X › Y` from a
  screen), Esc up one level, double-click a placed instance to edit its def in place (capped at the
  game's nesting depth), a **Browse** left tab. `/components` is a 307 redirect; the registry card
  URL is `/editor?view=components`. Storage unchanged. Gate: `pnpm --filter launcher-api
  check:component-links` (68 checks). Editor-side detail: [editor status](./editor.md).
- 2026-10-13 — **Owner decisions for the Rive-style editor (Phase 0, docs only).** The 2026-06 route-A
  deferral is lifted for component state machines only (screens get none), and `/components` will
  merge into `/editor` (Phase 4; component storage unchanged). Plan: [rive-style-editor](../design/rive-style-editor.md) §12.
- 2026-10-03 — **The respin cell tiles are skinnable** (Hold and Win 12c, #1006). New **Cell Tile**
  built-in: the tile and a held overlay sit inside a `Cell` part (**Edit inside Cell ›**). The
  Respin Cell Tiles' new **tile** (a `component` param) picks it for every cell. New **Respin Cell
  Tiles** and **Cell Tile (Hold and Win)** create types. Detail: [hold-and-win](hold-and-win.md).
- 2026-10-02 — **The Wheel is skinnable** (Hold and Win 12c, #1006). Art params turn its face and
  swap its rim and pointer. Nodes inside its `Wheel` part (**Edit inside Wheel ›**) turn with the
  face. There is a new **Wheel (Hold and Win)** create type. Detail: [hold-and-win](hold-and-win.md).
- 2026-10-02 — **The Letters Strip is skinnable** (Hold and Win 12c, #1006).
  - New **Letter Tile** built-in: its art and letter for each state sit inside a `Letter` part
    (**Edit inside Letter ›**).
  - The strip's new `tile` param, a `component`-kind param, draws every letter as that tile.
  - **Letters Strip** and **Letter Tile (Hold and Win)** create types.

  Detail: [hold-and-win](hold-and-win.md).
- 2026-10-02 — **The Total Win Bar is skinnable** (Hold and Win 12c, #1006). Its panel nodes sit
  inside a `Bar` part (**Edit inside Bar ›**), with a new **Total Win Bar (Hold and Win)** create
  type. Detail: [hold-and-win](hold-and-win.md).
- 2026-10-02 — **Jackpot Tile skinnable; a component swap on instances** (Hold and Win 12c, #1006).
  - The tile's panel sits inside a `Tile` part (**Edit inside Tile ›**).
  - New **Jackpot Tile** and **Jackpot Bar (Hold and Win)** create types.
  - Properties shows a **component** select on any instance, so a bar copy's tiles can use the
    game's tile copy.

  Detail: [hold-and-win](hold-and-win.md).
- 2026-10-02 — **The Respin Counter is skinnable** (Hold and Win 12c, #1006). Its panel nodes sit
  inside a `Counter` part (**Edit inside Counter ›**), with a new **Respin Counter (Hold and Win)**
  create type. Detail: [hold-and-win](hold-and-win.md).
- 2026-10-02 — **Skinnable coded parts, Pot first** (Hold and Win 12c part 1, #1006).
  - `/components` gains **Edit inside ‹part› ›** / **↩ Back**: an `insidePartId` re-points the
    synthetic scene, spawns and deletes at the part's children.
  - New create type **Pot Meter (Hold and Win)**.
  - `EditorCanvas` draws a skinned part's art layers and children instead of its chip
    (`boundComponentSkin`).
  - Not browser-verified (auth-gated launcher); it type-checks and builds. Detail:
    [hold-and-win](hold-and-win.md).

- 2026-10-02 — **Bind to value** (Hold and Win Phase 12b): numbers drive a node's transform, visibility, fill, clip frame, rig scrub and rig bones — engine, sources, the Properties section with a test-value preview, guide §3b. Live check in the tool owed (the auth-gated canvas). Detail: [hold-and-win](hold-and-win.md).
- 2026-10-02 — **Scoped signals (Hold and Win Phase 12a, #1003).**
  - The signal picker is grouped by family and filtered by the project's kind, and takes any Flow
    cue name.
  - Cue signals, **hidden until signal** and per-placement overrides are free text.
  - **scoped by … as a …** (`ComponentDef.signalScope` + `signalScopeKind`) makes a placement hear
    only its own pot / tier / reel among the fires of that kind. Nested instances and effects
    inherit it. `componentStorage` keeps both while the param exists.

  Detail: [hold-and-win](hold-and-win.md).
- 2026-10-02 — **`respinCells` built-in** ("Respin Cell Tiles", Hold and Win, kind-gated): a coded part that hands `tileImage` / `tileTint` / `gap` to the respin board rather than drawing at its own spot. Detail: [hold-and-win](hold-and-win.md).

- 2026-10-01 — **Kind-gated built-ins** (#951): `ComponentDef.capability` (a `KindCapabilities` flag) gates where the Scene Editor offers a def; seven new Hold and Win built-ins carry `capability: 'holdAndWin'` (respinCounter, jackpotTile, jackpotBar — four nested tiles, totalWinBar, potMeter, lettersStrip, wheel). `componentStorage` does not persist `capability`, so a saved fork falls back to the built-in's gate by id; a copy saved under a NEW id is offered to every kind. New `engine-layout` mount registry (`isComponentMounted`, counted by `<ComponentInstance>` and `<LayoutScene>`) lets a coded default step aside for a mounted authored twin.
- 2026-09-29 — **Guide refreshed to match the UI** ([tools/component-editor.md](../tools/component-editor.md)): HUD Readout and Free-Spin Counter types, the Space selector, the version browser, save conflict / read-only states.
- 2026-09-29 — **Version history for this game's component defaults.** `saveComponentDefaults` now
  writes through `docBackups.putDocWithBackup` (the helper Scenes/Flow/Symbols/Config use — see
  [launcher.md](launcher.md) 2026-09-29): the version each save replaces is kept (newest 20 per
  component, one per 5 min; an overwrite or restore always keeps one; none when the save's ETag is
  already stale). Backups live at `editor/<project>/component-defaults-backups/<slug(id)>/` — a
  SIBLING of `component-defaults/`, so `listComponentDefaults` never reads one as a phantom
  component, and project duplicate skips them. `GET/POST
  /api/editor/component-defaults/backups?project=&component=` lists/restores (editor gate +
  `requireOptionalProjectKey`, now shared as `lib/server/editorAccess.ts`); the restore writes the
  backup's `params` through the same guarded save. **History…** beside *Save for this game* opens
  `$lib/DocHistoryModal.svelte`; a restore adopts the POST's own `{ params, etag }` (no page
  reload), so an unsaved component draft survives it, and a restore that 409s with nothing unsaved
  loads their version in place so the author can pick again. Covered by `check:doc-backups` (184 checks, incl. the listing never
  surfacing a backup — verified to fail when the folder is moved inside `component-defaults/`).
  **Live (#857, `016a94c9`):** `GET /api/editor/component-defaults/backups?project=test2&component=hudReadout`
  went 404 → 200 (no `component` → 400); on `/components?project=test2` → HUD Readout, **History…**
  sits beside *Save for this game* and opens the modal on that component's URL (empty — `test2` has no
  defaults saved). ⏳ A restore not clicked live (it would have to create a sidecar on a real project;
  the fixture covers the round trip).
- 2026-09-28 (security) — **The component APIs refuse a project the caller cannot access.**
  `/api/editor/component` (GET/POST/DELETE), `/api/editor/component-defaults` (GET/POST) and
  `/api/editor/components` resolved any `?project=` or body `project` on the `editor` grant alone, so
  anyone with the editor could read, overwrite or delete another client's project components and
  defaults. They now go through `requireOptionalProjectKey` (`toolScope.ts`): no project still means
  the shared library, a named one must pass `canAccessProject` or it is a 403. The shared-library
  writes keep their `componentPublish` gate. The page always sends its own project, so authors see no
  change. Details: [launcher.md](launcher.md) Recent changes, 2026-09-28.

- 2026-09-18 — **The shared component library was pinned to ONE project's art, and every other game shipped that art as nothing.** Found from a live `waysofwavesbuild` console error (`Rig: key "invisible_wall/bookofborutremake/spines/R_Cage_Freespin/" is not found in loadedAssets`) and then swept across all of R2: **six** `_shared/editor-components/` defs named a bundle under `invisible_wall/bookofborutremake/` (one under the older `borut/bookofborut/`). A shared def is resolved by EVERY project, but the export only resolves a bundle in the reading project's own `spines/` root or `_shared/spines/` — so for everyone except the project that authored it the art ships as nothing and the game throws at the lookup. **Seven projects place `freeSpinCounter`; six of them were getting the broken cage.** No scene doc was affected — this was purely the shared library.
  - **Why only one of them was reported.** A rig node whose `assetKey` is bound to a `spine`-kind param never uses its static key: `Button_Square`'s `rspinbuttonnewRig` is set by all six placements, so its identical foreign key is inert residue. `freeSpinCounter`'s node had no binding, so the foreign key WAS the lookup. Same pin, two outcomes — which is why "the spin button works" said nothing about the cage. `featureCard`, `freeSpinIntroVisual`, `freeSpinOutroVisual` and `transition` carried the same live pin, unreported only because no project had placed them yet.
  - **The guard REWRITES first and only refuses as a last resort** (`healForeignRigRefs`). A bare refusal was the obvious design and it is unshippable: **there is no "re-point this rig node" control.** The only writers of a rig node's `assetKey` are the canvas drop that created it and `unexposeRigParam`, so a refusal would name a remedy the author cannot perform, and delete-and-re-drop mints a new node id — discarding the `spineRestOverrides`, `stateAnimations` and `paramBindings` all keyed by it. So, per node: (1) the bundle already exists in `_shared/spines/` ⇒ **re-point at the shared copy**, which makes "promote in /admin → rigs, then save again" a complete self-healing path; (2) the `assetKey` is PARAM-BOUND ⇒ **clear it**, since a foreign fallback can never resolve and is the dead residue `exposeRigParam` leaves by not clearing the key it supersedes; (3) otherwise ⇒ refuse, naming the bundle and the promote path, which IS a real control. Rewrites are logged, because they edit the author's own data and can trigger a version bump that is otherwise unexplained.
  - **Promote-to-shared is gated by this too, on purpose.** It posts `{ ...draft, scope: 'shared' }` with no project, so a def that statically places one of the project's OWN rigs is foreign at the shared scope — correctly, because after promotion every project resolves it. The message is written for that scope ("never exported into ANY game that places this shared component") rather than the project one, and the remedy is the same promote path.
  - Both segments of `<client>/<project>` are compared, not just the project: `SUB.spines` roots at both, so matching the project alone would wave through `otherclient/<sameproject>/spines/…`, which `bundleFromAssetKey` still cannot resolve.
  - **The repair, two moves.** `freeSpinCounter`'s shared v4 *is* Borut's counter (built-in frame sprite deleted, texts moved down, cage added), so it FORKS to `editor/bookofborutremake/components/` — where the same `assetKey` is a local reference — and the shared entry returns to the engine's built-in, which the other six projects already expect. The rest PARAM-ise instead: the hardcoded node's `assetKey` binds to a new `spine` param defaulting to the bare bundle NAME, which the export reconstructs against the READING project's root, so Borut resolves exactly what it does today while the shared def stops naming any project. That is the pattern the library already uses, and it avoids reverting customisations other projects may rely on.
  - The transport half (why the miss was silent at all) is in [launcher status](./launcher.md) (2026-09-18).
- 2026-09-17 — **"This game's defaults" — the §13.3 sidecar finally has an authoring surface (design-doc Phase B3).** The store, the CAS-guarded `/api/editor/component-defaults` API and the runtime `registerComponentDefaults` hook had all shipped in 2026-08 as "future-proofed (no UI writes it yet)", so **no sidecar existed in R2 anywhere** — measured on live R2 while scoping this: one shared `_shared/editor-components/hudreadout.json` (`scope: shared`, v8), resolved by BOTH `invisible_wall/test6` and `invisible_wall/bookofborutremake` (neither has a project copy), so its background sprite — `assetKey: invisible_wall/test6/manifests/atlas_manifest_S_UI.json` — renders in both games. That is exactly the case the sidecar exists to fix: vary a SHARED def per game without forking it.
  - **The panel** (`EditorProperties.svelte`, component mode only, under *Component variables*): every `!engineProvided` param of the open def, grouped by `p.group`, with the same widgets the Scene Editor's instance panel uses (`RegionPicker scoped` / `ColorField` / font `<select>` / `p.options` dropdown / live `action` catalog / checkbox / number / text). Deliberately NOT built off `variableRows` — that list is engine-catalog subscriptions + `author: true` params only, which on the live HUD Readout is **1 of its 20** settable params. Empty = **inherit**: the control reads `(inherit default: x)` or placeholders the def's own default, the key is ABSENT from the saved map, and a `×` (shown only when this game stores a value) puts it back. Hidden with no active project, and while inspecting a historical version.
  - **Its own save.** A second `SaveState` + `SaveStatusBadge` + **Save for this game**, NOT folded into the draft's `saveState`: different R2 key, different ETag, and the ordinary shared conflict badge (Reload theirs / Overwrite with mine) rather than the draft's bespoke versioned `confirm()` — same reasoning that already keeps promote-to-shared separate. Not lease-gated (the component lease covers the def object; this key's `If-Match` is its own floor). `openComponent` seeds from the page load for a flash-free paint then GETs for the ETag, adopting the fetched values only if the author hasn't typed meanwhile. The unsaved-work guard now covers both stores — including a **`beforeNavigate`** guard the page never had, so clicking a tool-bar link (a client-side navigation `beforeunload` never sees) no longer discards the draft silently.
  - **The preview is WYSIWYG both ways.** The Component Editor canvas resolves `resolveComponentParams(draft, undefined, projectDefaults)` and repaints as you type; the Scene Editor canvas was threaded in the same change (see [editor status](./editor.md)).
  - **The landmine that would have shipped a no-op:** `listComponentDefaults` keys its map by the R2 **basename**, which is `r2Slug(componentId)` — so a `hudReadout` sidecar lists as `hudreadout`, while every consumer looks it up by the real `ComponentDef.id`. Nothing would have matched for ANY camelCase id, in the editors or the game, and it would have looked like the feature simply did nothing. Fixed with a new `keyComponentDefaultsById(defaults, ids)` (additive — the basename keys are kept, so an orphan sidecar is never dropped), applied at all four consumers: both page loads, `/api/editor/doc` (aliased by the doc's referenced ids ∪ the resolved def closure, so it covers the lean boot fetch AND `&components=1`), and `runtimeBundle.ts` (aliased by `Object.keys(componentDefs)`, the transitive closure). `bake-editor-doc.mjs` reads the doc endpoint's output, so it inherits the fix. Author-created components (`c_xxxxxxxx`) were never affected. **Rule 8 applies here** — "it shows in the editor" would not have meant it ships.
  - Files: `EditorProperties.svelte` (panel + props), `components/+page.svelte` (state, CAS save, guards), `components/+page.server.ts`, `editor/+page.server.ts` + `editor/+page.svelte` + `EditorCanvas.svelte` + `EditorTextLayer.svelte` + `EditorRigLayer.svelte` + `editorCanvas.helpers.ts` (the Scene Editor preview), `componentDefaultsStorage.ts`, `api/editor/doc/+server.ts` + `runtimeBundle.ts` (delivery). Guide updated (`docs/tools/component-editor.md` §4). Launcher build + `pnpm lint` green; svelte-check adds no new error (66 pre-existing, unchanged). ⏳ Not browser-verified, and no sidecar has been written to R2 yet.
- 2026-09-17 — **Review follow-up: a lost update that defeated the sidecar's own CAS, plus the slug mismatch fixed at its source.** Shipped in #722 and corrected immediately after (#723); exposure was nil because no sidecar existed in R2 yet.
  - **The lost update.** `loadProjectDefaults` adopted the server's ETag and then, if the author had typed during the round-trip, KEPT the local values. A save replaces the map wholesale, so that write passed `If-Match` under someone else's version marker and deleted every key it had never seen — silently, with no 409 and no banner. Two authors on one component was enough; no staleness required. The etag is now adopted only on the branch that also adopts the values, so a raced save holds `null`, asserts create, 412s, and surfaces a real conflict. (`adoptEtag` also resets the status machine to `idle`, so the old placement could clear an already-raised conflict too.)
  - **The stale seed.** The page-load map was used as the open-seed AND was never invalidated, so after the first save in a tab every re-open seeded pre-save values; with a failed GET, "Overwrite with mine" would then force-write them over the author's own work. It is now an explicitly paint-only `seededDefaults`, refreshed by every successful load and save. A failed GET no longer returns silently — it reports, so "reload theirs" can't read as a no-op while the sticky conflict pill stays up.
  - **The slug mismatch, fixed at source.** `saveComponentDefaults` now STAMPS the real `ComponentDef.id` in the sidecar (`{ id, params }`) and `listComponentDefaults` keys off it, so the lossy `r2Slug` filename stops mattering everywhere at once. `keyComponentDefaultsById` stays as the fallback for sidecars written before the stamp. This also closes the gap where `/api/editor/doc`'s lean boot path aliased only TOP-LEVEL scene ids, so a component nested inside another def's root never resolved its defaults. The sidecar reads also went concurrent (`Promise.all`) — that loop is now on the Scene Editor's page-load path.
  - **The panel no longer contradicts its own canvas.** `instanceParamEffective` skipped the project layer, so an unset control in the Scene Editor's instance panel read the def's default while the canvas drew the project's — a boolean defaulted `true` by the project drew ticked and read unticked, and ticking it wrote a redundant explicit override. It now mirrors `resolveComponentParams` exactly.
  - **Guards:** switching components in the sidebar (the most common way to leave one, and the only exit with no guard) now asks before discarding dirty defaults; entering an inspect resets them after its warning, instead of stranding them behind a hidden panel whose Save button had gone with it.
- 2026-09-01 — **"Expose image as param" for sprite nodes — the one-click text and rig already had, and the reason a forked component's art was stuck.** Owner-reported against the HUD Readout: "I can see a variable exposed in the scene editor now, but when I pick a new image, the art does not change in the canvas … the changes are also not showing up in game." Diagnosed off the LIVE def (read via `/api/editor/components` in the owner's session, no writes): their shared `hudReadout` is **v6**, a fork that DELETED the coded `HudTicker` background part and replaced it with its own `kind:'sprite'` node (`UI_0005_WidgetBig`, 297×103, from `atlas_manifest_S_UI.json`) — `anyHudTicker: false`. So the engine-side `background*` params shipped that morning surfaced on their def through `mergeBuiltinCodedParams` (the picker appeared, correctly) while **nothing in that def read them**, on either surface. That is the general trap: a saved copy of a built-in always LISTS the coded params, but a fork that replaced the coded part has no node bound to them, so the control is dead and says nothing about it. The wiring a plain sprite needs is `paramBindings: { region: <param> }`, which `LayoutNodeView` and the editor canvas have honoured for ages — it just had no one-click, only the **Bind to param** dropdown, while **text** (`exposeTextParams`) and **rig** (`exposeRigParam`) each had one. Added the missing twin: `exposeImageParam`/`unexposeImageParam` (`/components`) create an `image`-kind author param keyed off the node label, bind the node's `region` to it, and default it to the node's current SCOPED frame ref (`<assetKey>::<region>` when the frame comes from an R2 manifest, so the atlas is pinned; a bare name otherwise) — so an un-overridden instance renders exactly what the def shows. Surfaced as an **Image** section on any selected sprite in component mode, mirroring the rig block, with the same ownership guard (a binding shared with a duplicated sprite is never stolen) and an inverse that restores the static frame. Binding is loss-free either way: an unset bound `region` falls back to the node's own, so existing instances are untouched. Guide updated (`docs/tools/component-editor.md`) with the three one-clicks AND the "if an instance control does nothing, the node is not bound" note. Launcher builds clean. ⏳ Not browser-verified.
- 2026-08-04 — **Concurrency Phase 2a — Component Editor migrated onto `SaveState`.** `draftEtag`/`saveBusy` are gone: the open draft's CAS now runs through a `SaveState` instance (`componentEtags[id]` seeds it on open via `adoptEtag`, re-adopted from each save response), and `saveComponent` drives the bespoke versioned `confirm()` ("save as a NEW version on top of theirs") off `saveState.status === 'conflict'` — NOT the shared badge, preserving the non-destructive versioned UX exactly. Promote-to-shared writes a DIFFERENT (global `_shared/`) key, so it deliberately does NOT flow through the draft's `SaveState` (that would clobber the draft etag); it keeps its own GET-shared-etag → CAS → confirm flow behind a `promoting` flag, unioned with the draft-save spinner into `busy`. The `saveStatus` {kind,message} header pill is kept as-is, fed by the outcome. Verified via the shared helper's offline fixture (36 assertions) + launcher build green; live two-profile verify owner-owed.
- 2026-08-04 — **Concurrency Phase 2a — shared `SaveState` helper built; components' migration staged.** New `$lib/saveState.svelte.ts` + `$lib/SaveStatusBadge.svelte` consolidate the hand-rolled save/dirty/etag/conflict logic (see launcher status for the full note). The Component Editor is the one tool whose conflict UX must NOT flatten into the shared pill: its versioned `confirm()` ("Save yours as a NEW version on top of theirs?") + promote-to-shared (GET the shared key's etag first, then CAS the global key) are deliberately different from a banner. The migration plan drives that bespoke UX off the shared `SaveState` (`state.status==='conflict'` → the versioned confirm; `draftEtag`→`state.etag` with `adoptEtag` on open/save; the signature-derived dirty pushed via `setDirty`) **without** forcing it into the badge — preserving today's behavior exactly. Not landed yet: held for an owner API-shape confirm + a two-profile live test (design doc Phase 2a has the parity checklist). Helper verified offline (31 assertions over the real compiled module); launcher build green.
- 2026-08-04 — **Concurrency Phase 1 finished for components (residuals b + c).** The ETag now travels load→editor→save: `componentStorage.listComponentsWithEtags`/`loadComponentWithEtag` carry the object's etag, the page load returns a `componentEtags` id→etag map, `components/+page.svelte` stamps `draftEtag` on open (and re-adopts the server's new etag after each save, so successive saves keep CASing), and the POST is CAS-guarded per scope key — closing the A-opens/B-opens-later window that was previously only last-writer-wins-on-pointer (worst for `scope:'shared'`, a global key no lease covers). The GET `?id=` (no version) now returns `{ def, etag }`; versioned/`list=versions` reads are unchanged. **Promote to shared** first GETs the shared key's etag so it CASes the global key instead of writing blind. The Scene Editor's "convert to component" sends `baseEtag: null` (create). **Per-project component DEFAULTS** are guarded too: `componentDefaultsStorage.loadComponentDefaultsWithEtag` (reports `existed`) + `saveComponentDefaults(…, baseEtag)`; the `/api/editor/component-defaults` POST is CAS-guarded and 409s on conflict (no UI writes it yet — future-proofed). **Fixed a latent bug the offline harness caught:** `componentStorage.ts` used `ConflictError` at two sites but never imported it, so a real component conflict threw a `ReferenceError` → 502 instead of 409; now it 409s. Verified offline via an esbuild bundle of the REAL storage/`writeGuard`/`r2` modules against a faithful in-memory S3 ETag-CAS fake (34 assertions incl. the snapshot-orphan landmine: a stale save conflicts in-process before any `.v<N>` write, latest pointer == snapshot). Launcher build green. Live two-profile verify owner-owed.
- 2026-08-03 — **Win Overlay per-tier SFX / BGM dropdowns.** The `<alias>Sfx` / `<alias>Bgm` params became dropdowns of the game's real sounds (BGM = `bgm_*` beds, SFX = the non-bgm cues) instead of free text. `winTierPresentationParams(tiers, soundOptions?)` (`WinSoundOptions`) takes an editor-only `{bgm,sfx}` list; the `/editor` client supplies it from the ONE generated sound enum (`engine-flow-v2` `MUSIC_NAMES` / `SOUND_EFFECT_NAMES`, re-exported from the package index). Rendered via the existing `p.options` dropdown branch. Runtime `WIN_DEF` passes no options ⇒ still `kind:'string'` ⇒ byte-identical (options are an editor hint; empty ⇒ config/coded sound). Caveat: shipped `apps/lines` sound set only. Files: `engine-flow-v2/index.ts`, `engine-layout/builtinComponents.ts`, `editor/+page.svelte`. Builds green; ⏳ live-verify.
- 2026-08-03 — **Win Overlay per-tier presentation (config structure / component presentation split).** The `win` component's per-tier animation params (was a hardcoded big/super/mega/epic/max set) are now GENERATED from the active game config's big tiers, keyed by ALIAS: per tier a **rig bundle** picker + **intro/idle/outro** dropdowns of that rig's animations + **duration** + **sfx/bgm**. `engine-layout` `winComponentDef(tiers)`/`winTierPresentationParams(tiers)`/`DEFAULT_WIN_TIERS`; the `/editor` client (`withConfigWinTiers`) rebuilds the def from `data.winTiers` (server `resolveWinLevels` big tiers). `EditorProperties.effectiveRigBundle` falls back to the base `winSpine` bundle so the per-tier animation dropdowns populate when a tier rig is unset. The `/config` panel dropped the rig/anim/duration/sfx/bgm fields (now structure-only). Runtime: `WinVisual` resolves per-tier from live params (alias-keyed, single-tier `spineKey` gap closed); duration/sound bridge via `bakedWinPresentationParams()`→`publishWinPresentation()`→`gameConfig.withWinPresentation`. Un-authored ⇒ byte-identical. Build + `game-config` typecheck/spike + `svelte-check apps/lines` green; launcher render + live spin owner-verify-owed. Needs a Runtime release to reach online games.
- 2026-08-03 — **Focused-param rig preview (canvas WYSIWYG).** Focusing a rig / spineAnimation param on the selected instance drives the Scene Editor's live rig preview to that bundle + animation — a `spine` param previews its bundle's first/idle, a `spineAnimation` param previews its sibling bundle playing THAT animation. Generic across any rig+spineAnimation component (win / free-spin visuals / book reveal). `EditorProperties.onPreviewRig` (focus/change handlers on the rig + spineAnimation controls; `rigParamPreview`/`primaryRigBundle` helpers) → `+page.svelte` `rigPreview`/`rigPreviewNodeId` (reset on selection change) → `EditorCanvas` → `EditorRigLayer` (bind-rig bundle + `defaultAnimation` override for the previewed instance only). PREVIEW-ONLY — never written to the doc; unfocused ⇒ base bundle (parity). Files: `EditorProperties.svelte`, `+page.svelte`, `EditorCanvas.svelte`, `EditorRigLayer.svelte`. Builds green; ⏳ live-verify on the auth-gated canvas.
- 2026-07-31 — **Expose a rig's SOURCE bundle as a per-instance param** (the rig analogue of the sprite `assetKey`/image exposure). A rig node's inspector now has a one-click **✨ Expose rig as param** (component mode) that creates a `spine`-kind author param and binds `paramBindings['assetKey']` to it (default = the node's current bundle name); each placed instance then swaps the rig from the existing `spine`-kind bundle picker. Runtime resolves it in `LayoutNodeView` (`RigProvider key = boundRigAssetKey ?? node.assetKey`; the bound value is the bundle NAME, which `RigProvider` resolves like a key); the Scene Editor preview (`EditorRigLayer.nestedRigTarget`) maps the bound name→key via `assets.spines` so the override shows while authoring. Unbound / outside-instance / unset ⇒ static `assetKey` (parity). Files: `LayoutNodeView.svelte`, `EditorProperties.svelte` (+`onExposeRigParam`/`onUnexposeRigParam`), `components/+page.svelte`, `EditorRigLayer.svelte`. Follow-up: the instance-side **rig (this placement)** dropdowns (resting / skin / Plays-on-button-state) now list the animations of the rig THIS placement actually plays — `EditorProperties` resolves each instance rig's EFFECTIVE assetKey (`instanceRigAssetKey` → the exposed-source override, else the def default) for both `rigMetaFor` and the manifest prefetch, instead of always the def's `sp.assetKey`. ⏳ live-verify on the auth-gated canvas.
- 2026-07-17 — Tap-to-continue fixes: (a) the full-screen dim/hit surface now renders in true CANVAS space via a scene-scoped portal (`tapPortalContext` → `LayoutScene` renders it OUTSIDE `MainContainer`), so an overlay authored on a `game`/`standard`-space screen dims the whole window instead of a scaled band over the logo; (b) the engine "press anywhere" prompt is default-SHOWN again (`tapShowPrompt` reverted from the 2026-07-14 opt-in — a shipped loading gate lost its text), an author turns it OFF to draw their own ([detail in history](../history.md)).
- 2026-07-14 — Tap-to-continue engine "press anywhere" prompt was made opt-IN per instance (`tapShowPrompt`, default hidden) — SUPERSEDED by the 2026-07-17 revert above.
- 2026-06-30 — Flow-driven-game Phase 6: universal `action`/`visibleSource` tray, `visibleFor`/`screenAnchor`/custom-`options` UI, and per-instance rig-cue signal rebinding (`cueSignalOverrides`) ([detail in history](../history.md)).
- 2026-06-25 — Button-state-driven rig animations (`RigNode.stateAnimations`) + blank-default state-overlay pattern ([detail in history](../history.md)).
- 2026-06-24 — Multi-version store + version browser (Inspect / Back to latest); Promote-to-shared button gated on `componentPublish` ([detail in history](../history.md)).
