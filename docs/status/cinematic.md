# Invisible Cinematic — status

> Design: [docs/design/invisible-cinematic.md](../design/invisible-cinematic.md) · Guide: [docs/tools/rigger.md §Cinematic mode](../tools/rigger.md#cinematic-mode) (it is a mode of `/rigger`, so it shares the Rigger's guide) · Agent: [`.claude/agents/invisible-rigger.md`](../../.claude/agents/invisible-rigger.md)

**One-line state:** Phases 0–3 + Tweak Mode, strip masks and inline posing are built — `/rigger`'s
🎬 Cinematic mode stages several rigs as tracks of strips + property/camera/visibility/cue keys,
saves per project, ships with the rigs it casts, and plays in game through `<Cinematic>` from a
Flow `playCinematic` node. ⏳ The editor is live-verified. The in-game player plays at authored
speed on a real clock (2026-10-01, a probe cinematic injected into the remake), but no project has
yet shipped an authored cinematic through a `playCinematic` node. **Rive plan Phase 1** (node
actors + screen/component hosts, 2026-10-13) is in the format, evaluator and player, verified
headless only. **Phase 3** (2026-10-13) authors screen timelines in `/editor`'s Animate mode and
lists them in Flow's picker; proven headless end to end, not yet browser-verified. **Phase 4b**
(2026-10-13) authors **component** timelines on `/editor`'s Components side and plays
them per placed instance (`componentTimelines.ts`); headless-proven, not yet browser-verified.
**Phase 5a** (2026-10-13, in review) adds the component **state machine** runtime: a pure
interpreter per placed instance (`stateMachine.ts`) that places each layer on a component timeline
through the same player; headless-proven, no editor yet (5b).

## Current state

- **Shared timeline library + cue / text / visibility rows (Rive plan Phase 9d, 2026-10-20, in
  review — headless-proven, ⏳ not browser-verified).** The editor side is in
  [editor status](editor.md) 2026-10-20 (9d); the format and ship chain are here.
  - **Storage.** `_shared/cinematics/<id>.json` is a shared timeline's LATEST version (a portable
    doc: no host, no trigger, a `version`), `<id>.v<N>.json` each version (`sharedCinematics.ts`).
    Promote (`POST /api/cinematics/shared/promote`, `componentPublish`-gated like shared components)
    is POINTER-FIRST: the pointer's `If-Match` write is the only race and its loser writes
    nothing; a snapshot only ever copies the pointer's bytes for its version (a stray one is
    repaired from the pointer before the pointer moves on); an unreadable pointer is refused; a
    deleted pointer continues after the highest snapshot. Built-in **starters**
    (`STARTER_TIMELINES` in `$lib/timeline/sharedTimelines.ts`: Fade in / out, Pop in, Slide up
    in, Pulse; one node actor "Target") answer for `starter_*` at v1; a promote id never takes
    that prefix. No index blob: the list is a prefix listing.
  - **Format (additive, authoring-only).** `CinematicDoc.shared?: { id, version, targets? }` makes
    a project timeline a LINK: its stored doc is a content-less stub (`linkStub`: id, name, host,
    `playOn`, `playOnComponents`, `holdsCue`, the link); `/api/cinematics/save` strips any content
    a client sends with one and refuses a non-link save over a stored link unless it says
    `detach: true` (423 `linked`, so `/rigger` can't silently fork one; it shows the message as an
    error). `/api/cinematics/get` returns it resolved (`resolveLinked`: the pinned version's
    content under the placement, each actor retargeted through `targets`) plus `link` (`latest`,
    `missing`). `/flow-v2` validates a link as what it plays and flags one whose version is gone.
    Absent ⇒ unchanged.
  - **Ship chain (rule 8).** `loadAuthoredCinematics` resolves every link against its pinned
    version, so `deploy/cinematics/<id>.json` and the bundle's `cinematics` hold a NORMAL timeline
    (no `shared` field) that the game registers and plays like any other; the art seed sees its
    rigs. A link whose version is gone ships nothing; a version that can't be READ (an R2 error)
    ships the last exported copy, and when even that can't be read the load is PARTIAL and the
    export prunes nothing from `deploy/`. Gate: `check:shared-timeline-ship`.
  - **Rows.** No format change: `cue`, `visibility` and `text` tracks already existed and the game
    already plays them on node actors. The Timeline module gained `options.textRows` (a node
    actor's text track as a row) and `addCue(cue)`; `/rigger` sets neither (golden unchanged).
    Gate: `check:timeline-rows`.

- **Per-key cubic ease, loop type, default interpolation (Rive plan Phase 9b, 2026-10-20, in review
  — headless-proven, ⏳ not browser-verified).** All additive; a doc without them evaluates
  byte-identically (gate below).
  - **Format.** A key's `ease` may be a cubic `[x1, y1, x2, y2]` (CSS cubic-bezier through (0,0)
    and (1,1); x clamped to [0, 1], y may overshoot) besides `'linear' | 'ease' | 'hold'`; anything
    else still reads as linear. `doc.loop`: `'loop' | 'pingPong'` (absent or `'oneShot'` = plays
    once and holds, as before; `loopFrom` wins where set). `doc.defaultEase`: the ease a NEW key gets
    in the editor, authoring-only (every key carries its own `ease`, no player reads it).
  - **Evaluator** (`engine-cinematic`, synced to `static/shared/cinematicEval.mjs`, so `/rigger`
    reads cubic keys too): `isCubicEase`, `easeShape` (Newton then bisection on x(s), as a browser
    does), used by `sampleChannel`, `sampleTint` and countUp text; `playbackTime(loop, elapsed,
    duration)` and `loopsForever`. String eases take the exact code path they always did.
  - **Players.** `ComponentTimelinePlayer`: `loop` wraps to 0 like a `loopFrom: 0`, `pingPong`
    samples its there-and-back lap reflected; neither ends or holds a cue (`holdsOn` skips them).
    Cues fire on the way out only, through `pingPongCuesCrossed` (every out leg a step overlaps,
    so a step over the turnaround still fires a cue at or near the end). `<Cinematic>`:
    `doc.loop === 'loop'` loops like its `loop` prop; `pingPong` plays there and back either way.
    The game's Flow runtime treats a doc's Loop / Ping-pong like the node's own `loop`, so an
    awaited `playCinematic` of one resolves at once instead of hanging the round (the validator
    sees only the node, so this is runtime-only).
  - **The Timeline module** (`$lib/timeline/timeline.js`): multi-key selection (Shift/Ctrl-click,
    box drag over empty channel lanes, `selectKeys`), a drag moves every selected key (the grabbed
    one lands exactly on the snapped time), Ctrl+C / Ctrl+V to the playhead, Delete on the
    selection, `,` / `.` frame steps (Shift ×10) and Space through `host.togglePlay` (left alone on
    a focused button). These keys are live in `/rigger` too (its own keys never used them).
    Opt-in for `/editor` only: `boxSelect` (a drag over an empty channel lane box-selects; a click
    there clears), `interpolation` (the Interpolation panel: Linear / Cubic with an SVG two-handle
    curve and the typed `x1, y1, x2, y2` / Hold, *Set as default*, and the doc default with nothing
    selected) and `summaryRows` (a foldable row per animated actor, with *Show only selected*
    through `host.selectedActor`). `/rigger` sets neither: its golden changed in one step only,
    "drag the key", because the old key drag looked its key up by its ORIGINAL time and so lost
    it on the first move that crossed a frame (the golden had recorded a half-length drag). The
    golden was re-recorded for that step; the other 103 are identical.
  - **Gates.** `check:cinematic-ease`: 41 timelines (every built-in plus a doc using each legacy
    ease and junk) sample byte-identically to a golden captured BEFORE the change; seven cubics match
    an independent dense-table cubic-bezier within 1e-4 (worst 9e-9) on number, tint and countUp
    channels; malformed arrays read linear; the loop types through `playbackTime` and the component
    player. `check:timeline-keying`: default ease, the panel write, copy / paste / delete, frame
    keys and Space (never while typing), and the editor helpers below. Both run in `check:all`.

- **Node actors + hosts (Rive plan Phase 1, 2026-10-13, format + evaluator + player — not
  browser-verified).** A timeline can now drive layout NODES, not only rigs
  ([rive-style-editor.md](../design/rive-style-editor.md) §3.1–3.2):
  - **Format (additive).** `cast[].kind: 'node'` + `target` (the node's NAME — its `label`, falling
    back to its id); `doc.host`: `{kind:'cast'}` (absent = today) · `{kind:'screen', sceneId}` ·
    `{kind:'component', componentId}`. A new `text` track kind. `TextNode.switchKeys` declares the
    other strings a timeline may switch a text node to. Absent `kind` / `host` = byte-identical
    behaviour: old players skip node actors (no `rigFolder`), and the evaluator never sees them.
  - **Channels.** Node `property` channels are RELATIVE to the node's authored pose so one timeline
    plays on any host with that node name: `x`/`y` add, `scale`/`scaleX`/`scaleY` and `alpha`
    multiply, `rotation` adds degrees, `tint` replaces (eased per RGB channel), `frame` holds a
    flipbook frame, `fill` reveals 0..1 (sprite / rect / flipbook). Visibility tracks work too.
    `text` has exactly two modes (§8): **countUp** (eased number, formatted by a named engine value
    source's formatter — `format: 'win'` — or a grouped integer; `to: '<source>'` makes the keys
    shares of that source's live value) and **switchKey** (stepped, names one of the node's own
    strings; an undeclared key is ignored). No free text.
  - **Evaluator** (`engine-cinematic`, synced to `static/shared/cinematicEval.mjs`): `isNodeActor`,
    `cinematicHost`, `sampleNodeActor`, `sampleTint`, `sampleText`, `NODE_CHANNELS`. Rig paths
    untouched.
  - **Binding** (`engine-layout/cinematicNodes.ts`): `resolveNodeActors`, `findNodeByName`,
    `cinematicSetSceneId` (a screen host IS the set), `validateNodeActors` (no-target /
    node-missing / target-duplicate / text-track-duplicate / channel-unsupported /
    switch-key-undeclared), `collectTimelineSwitchKeys`. Two actors on one node: the first wins.
    Two text tracks on one actor: the last one plays, in the evaluator and the player alike.
  - **Player.** `<Cinematic>` provides a driver (`cinematicNodeContext.ts`) to the set it mounts;
    each `<LayoutNodeView>` at the driver's component nest depth (depth 0 for a screen, so never a
    node inside a placed component — Phase 4b scoped the driver by depth) asks it
    once whether an actor drives it, and feeds the sampled channels into its existing value-binding
    fold (`foldBoundTransform` / fill / frame), so a keyed number does to a node exactly what a value
    binding would. Its own outputs are padded to one per binding first (`withNodeActorOutputs`): a
    smoothed binding's outputs start empty, and the timeline's would otherwise slide onto them. `FlowV2Cinematics` resolves the set through `cinematicSetSceneId`.
  - **Not in Phase 1:** playing a **component** host (now plays — Phase 4b, below); `animation` strips on a rig NODE; any `/rigger` UI for node actors (the sequencer is
    now the shared Timeline module — Phase 2, below; node-actor rows are one `ROW_KINDS` entry); `validateNodeActors` is
    not yet called by a publish gate or an editor.
  - **Ship chain (rule 8):** nothing new to seed. A node actor's art, clip, font and text node all
    belong to its host scene, which the editor-art export already ships; `cinematicRigNames` skips
    node actors (they have no `rigFolder`), and `check:art-scope` covers the unchanged paths.

- **Screen timelines in the Scene Editor (Rive plan Phase 3, 2026-10-13 — headless-proven, ⏳ not
  browser-verified).** `/editor` → **Animate** mounts the shared Timeline module in
  `EditorTimelinePanel.svelte` for the active screen. UI and keys: [the guide](../tools/invisible-editor.md#animate-mode--the-timeline).
  - **Storage, unchanged.** A timeline is a cinematic with `host: {kind:'screen', sceneId}` (and
    `stage.sceneId: null` — the host is the set), saved through `/api/cinematics/*` with the same
    `baseEtag` / 409 / scope guard. `CinematicSummary` gains an optional `host`.
  - **Access (`cinematicAccess.ts`).** `rigger` ⇒ `full`, as before. `editor` without `rigger` ⇒
    `hosted` (named `screen` until Phase 4b, which widened it to component hosts too —
    `isEditorHosted`): the list is filtered to screen and component timelines; `get` refuses (403)
    anything else, including a malformed doc; `save` requires the body AND the stored doc to be
    editor-hosted and
    writes under the etag it just checked (a forced save overwrites only that version, so a rig
    cinematic written under the same id mid-request is a 409, never clobbered); `delete` reads first.
    Known window: that delete is unconditional (`deleteObject` takes no If-Match), so a Rigger
    cinematic written under the same id between the read and the delete would be deleted.
  - **Authoring (`$lib/timeline/screenTimeline.ts`).** `nodeActorTarget` (name only; refuses
    unnamed or shared names with a message), `ensureNodeActor` (identity `place`), `nodeChannelValue`,
    `SCREEN_CHANNELS` (the module's channels + `tint`, a colour input). The module gained an
    optional `channels` (default `PROP_CHANNELS`, so `/rigger` is byte-identical — the 104-action
    golden still passes) and a colour key field for a `color` channel.
  - **Preview = game.** `timelineDrives` feeds `resolveNodeActors` → `keyedNodeChannels` →
    `nodeActorBindings` + `sampleNodeActor` into the editor's value-binding preview, which folds
    them with `withNodeActorOutputs` + `foldBoundTransform` — the calls `LayoutNodeView` makes.
  - **Flow.** `/flow-v2`'s `playCinematic` inspector is a picker (`cinematicPickerOptions`):
    "Timeline · <screen> · <name>" first, then "Cinematic · <name>"; a ref not in the project stays
    selectable. `validateNodeActors` runs server-side per screen timeline and its messages show
    under the picker.
  - **Not in Phase 3:** `text` tracks (count-up / switch-key — the format and player have them;
    the panel does not expose them yet), visibility keys and cues in the panel, keying by dragging
    on the canvas, component hosts (Phase 4b, below).
  - **In game (2026-10-16).** A screen timeline moves the screen the flow SHOWS: `<FlowV2Cinematics>`
    hands the playing `<Cinematic>`'s node driver to the flow handle (`driveScreen`), and
    `<FlowV2Mount>` remounts that screen with it (`LayoutScene.nodeDriver`, keyed per play); the
    screen holds the last frame until it hides. Only a timeline whose screen is NOT up still draws
    its own copy inside `<MainContainer>` (Phase 1), mis-framed for a canvas screen (open item 9).
    **The Pots screen the game mounts itself counts as up (2026-10-21):** under a driven flow that
    never shows `pots`, `<EngineScreenMount>` reports it up while the board is
    (`engineScreenUp`) and remounts it with the timeline's driver, so the timeline moves the pots
    the player sees and holds the last frame until the board goes down. While the board is down a
    timeline on it draws nothing (`onStage` counts the game's own screens up or down), and the
    board coming back picks it up where it is. The bookkeeping (flow-shown + engine-mounted
    screens, drives and their lifetime) is `apps/lines/src/game/screenDrives.svelte.ts`. The banner
    screens the game mounts itself (`engineBannerScreens`) are not counted yet.

- **Per-ratio keys (2026-10-21, headless-proven, ⏳ not browser-verified).** A screen lays its
  nodes out per ratio, so a node actor's `property` track may carry `layout` (a layout type): the
  keys for that ratio alone. A ratio with any such track plays its own keys and none of the default
  ones, the whole timeline at once; every other ratio plays the default keys (tracks without
  `layout`). Evaluator: `trackLayout`, `keysLayout(tracks, layoutType)`, and
  `sampleNodeActor(tracks, t, layout)`, which skips every other ratio's property tracks (absent
  `layout` ⇒ the default keys only, so a caller that names no ratio, such as
  `componentTimelines.ts`, never plays a ratio's keys everywhere). `keyedNodeChannels` stays the
  union, so turning the device never remounts a node. `<Cinematic layoutType>` takes a READER
  (`stateLayoutDerived.layoutType`, from `<FlowV2Cinematics>`) and asks it on every sample: a held
  last frame outlives the player, and a `$derived` or prop value there goes stale once it unmounts.
  Component timelines play the default keys in every ratio. Editor side: [editor status](editor.md)
  2026-10-21. Ship chain: nothing new (a doc ships verbatim).
    A `playCinematic` naming a timeline the bundle lacks is skipped with a console warning rather
    than awaited forever. Until this date no Flow `playCinematic` ever reached a game:
    `createFlowV2Env` dropped `playCinematic` / `stopCinematic` (see Recent changes).

- **Component timelines (Rive plan Phase 4b, 2026-10-13 — in review, headless-proven, ⏳ not
  browser-verified).** Authored on `/editor`'s Components side (Animate; UI in [the
  guide](../tools/invisible-editor.md#animate-a-component), authoring state in
  [component-editor status](component-editor.md)).
  - **Format (additive, `engine-layout/types.ts`).** `host: {kind:'component', componentId}`; new
    optional `CinematicDoc.playOn` (the instance signal that starts it — `enter`, a declared signal,
    a Flow `fireCue` name or a rig cue's `completeSignal`; absent ⇒ never played) and
    `playOnComponents` (other components whose instances also play it). Both ignored on screen and
    cast timelines. Ids: `c_<component>_<name>`; storage unchanged
    (`<client>/<project>/cinematics/<id>.json`).
  - **Binding (`cinematicNodes.ts`).** A component-hosted timeline binds BY NAME on whatever node
    list it is handed (its def's root, a reused-on component's) — by NAME only, never by node id
    (`findActorNode`; a screen timeline keeps `findNodeByName`'s id fallback) — and a screen
    timeline still binds only on its own screen. Names are checked across the whole def, also while
    editing inside a skinnable part. The panel runs `validateNodeActors` on the def and on each
    `playOnComponents` entry.
  - **Runtime (`componentTimelines.ts` + `ComponentInstance.svelte`).** `registerComponentTimelines(
    bakedCinematics())` runs at boot inside `registerBakedComponents()` (`apps/lines/src/
    editor-scenes.ts`), indexing every component-hosted doc with a `playOn` under its host and its
    `playOnComponents`. Each placed instance with ≥1 timeline owns a `ComponentTimelinePlayer`:
    the `playOn` signal heard on the instance's own bus (a game signal / Flow `fireCue` through the
    def's `signalScope`, a rig `completeSignal`, or `enter`) (re)starts it from 0; it advances on the
    Pixi ticker; the last frame HOLDS; two timelines on one node ⇒ the most recently started wins.
    Cues crossed: `signal:x` fires on the instance's own bus (so `hiddenUntilSignal`, a tap gate or
    another timeline can follow) and restarts the other timelines on `x`, never the one that
    crossed it (no self-restart loop); `sfx:` / `music:` are dropped (never broadcast — a sound's
    bare name could collide with a real game event); any other cue (`fx:` …) is broadcast by bare
    name. Instances play
    independently. The node driver is scoped to the instance's nest depth + 1, so a component's
    timeline never reaches into a nested component. No timeline ⇒ no player, no subscription, no
    ticker work (parity). `cues`, `stateAnimations`, `valueBindings` untouched.
  - **State machine (Rive plan Phase 5a, 2026-10-13 — in review, headless-proven, ⏳ not
    browser-verified).** A def's `stateMachine` (format: [component-editor status](component-editor.md), semantics:
    [the plan §5](../design/rive-style-editor.md#5-component-state-machine-additive-to-componentdef)) runs
    per placed instance in `ComponentInstance.svelte`: `ComponentStateMachineRunner`
    (`engine-layout/stateMachine.ts`, pure — `dt` + inputs in, `LayerPlay`s out) is built with the
    def's inputs (`componentInputs`, signals folded in) and the durations of the timelines its states
    name (`stateMachineTimelines`, from the registry, which now keeps EVERY component-hosted doc by
    id, not only the `playOn` ones). Its trigger inputs are fed by the
    instance's own fired-signal bus (so a game signal through the def's `signalScope`, a Flow
    `fireCue`, a rig `completeSignal`, a timeline's `signal:` cue and `enter` all fire a trigger of
    that name, scoped as signals are); a number input with a `source` follows that registered value
    source. On the ticker, `advance(dt)` then `plays()` → `player.drive(layer, index, play)` per
    layer (`release` on `exit`), so the 4b player is the one node-driving path: the slot's cues are
    routed like a `playOn` timeline's (`signal:` to the bus, `fx:` broadcast, sounds dropped), a
    cue at 0 fires on entry and a loop wrap fires the end then the start. `sample(nodeId)`: a `playOn`
    timeline still playing and started after the layers driving the node wins it; once it ends, or
    the machine changes state, the layers take the node back; among layers, each property goes to
    the later layer, each mixed from the pose it left while its blend runs (`blendNodeSamples`). A
    missing timeline holds and warns once (per def). The machine starts on the instance's first
    visible frame (the rule `enter` follows) and its clock runs from then on; the cues a leaving
    state crossed on the frame of a transition still fire; an interrupted blend leaves from the
    pose on screen; a state timeline reused from another component binds here without its
    `playOn` (`instanceTimelineDocs`); a trigger is held only while a transition waits on its
    exit time alone, and dropped on any state change. No `stateMachine` ⇒ no runner, no
    subscription, no ticker (parity; `check:component-timelines` still 39 green). Ship
    chain (rule 8): a state's timeline needs no `playOn` and no Flow node to ship — every authored
    component timeline is exported and embedded, and the gate asserts it. Gate:
    `pnpm --filter launcher-api check:component-state-machine` (89 checks: the fold, the
    semantics above, two instances, scoping, coexistence, validation, parity, what saves, the
    ship chain).
  - **Editor (Phase 5b).** The State Machine panel previews the machine with the same runner,
    and the game's own timeline player, placed and sampled through `previewPlayer` / `placeLayers` / `playerDrives`
    (`$lib/timeline/stateMachinePreview.ts` — the layers' side of `sample(nodeId)` above); authoring
    state in [component-editor status](component-editor.md).
  - **Flow.** Component timelines are left out of `/flow-v2`'s playCinematic picker
    (`cinematicPickerOptions`): instances play them.
  - **Ship chain (rule 8): no new asset class.** `cinematicExport.ts` already exports every
    cinematic with ≥1 actor to `deploy/cinematics/` whether or not a Flow node names it, so a
    component timeline ships with the game; node actors seed no rig bundle (the nodes' art ships
    with the component). Timelines are project-scoped: a shared component's timeline authored in
    project A does not ship for project B (shared timeline library = Phase 9).
  - **Not in Phase 4b:** `sfx:` / `music:` cues are not played from a component timeline (they
    are dropped); the panel keys no text tracks, visibility or cues (as on
    screens).

- **`/rigger` cinematic mode (Phase 1).** A fourth mode beside Preview / Setup / Animate. Cast a
  rig from the project as an **actor** (the same rig twice = independent instances), place it
  (x / y / scale / rotation / flip), set draw order and visibility, give it a clip, scrub or play
  the stage. Works with **no rig open** (it boots the rig runtime + GL itself). Code:
  `static/rigger/cinematic.js`, plus four hooks in `view.html`. The mode hides the rig-only chrome
  (rig save/export, rig management, anim/skin pickers), so only one Save is on screen. A **Frame**
  picker draws the game canvas box per layout, resolved through `resolveLayoutProfile` (project →
  admin → coded), the same answer the Scene Editor uses.
- **R2 persistence (Phase 3, part 1).** Open / Save / ＋ New / 🗑 over
  `<client>/<project>/cinematics/<id>.json` (Ctrl+S), endpoints under `/api/cinematics/*`, gated by
  the **`rigger`** entitlement. No index blob (the list is a prefix listing); every save carries its
  `baseEtag` (create = `baseEtag: null`), a stale one answers 409 and the author is asked; the save
  posts its `projectKey` and a mismatch is refused even with `force`. `localStorage` is only a
  crash/reload draft. Failures surface in the red error bar with the status and body.
- **The ship chain (Phase 3, part 2).** `cinematicExport.ts` mirrors each cinematic into
  `<client>/<project>/deploy/cinematics/<id>.json` (pruning deleted ones), the runtime bundle and
  the offline bake embed them as `cinematics`, and the game reads `bakedCinematics()` /
  `bakedCinematic(id)` (`[]` when un-authored ⇒ parity). A cast rig may appear in no scene, so
  `exportEditorArt` takes an `extraRigNames` seed from `cinematicRigNames()`. **Rig identity is
  the FOLDER** (the bundle name), never `SkeletonIndexEntry.id`, which is an array position
  reassigned on every scan.
- **`packages/engine-cinematic`** — the layered strip evaluator (`clipLocalTime`, `blendEnvelope`,
  `evaluateActor` with layer stack / additive / bone masks, `cuesCrossed`, channel sampling,
  `cineTimeForLocal`). Plain ESM JS + hand-written `.d.ts`, because `/rigger`'s static page fetches
  it over HTTP: `static/shared/cinematicEval.mjs` is a **generated verbatim copy**
  (`node scripts/sync-cinematic-eval.mjs`) and the gate fails if the two differ.
- **`<Cinematic>` (`engine-layout/svelte`)** — the in-game player: one `<RigProvider>` per cast
  member keyed by rig folder, all driven from ONE clock through the shared evaluator on the Pixi
  ticker (a paused game pauses it). Props: `doc` · `playing` · `startTime` · `loop` · `speed` ·
  `oncomplete`. `CinematicActor.svelte` keeps `autoUpdate` ON (off froze every rig on first mount),
  `clearTracks()`, and poses in `beforeUpdateWorldTransforms`.
- **Flow-v2 `playCinematic` node** — pick a cinematic, set `speed`, choose `loop` or
  `awaitComplete`; exec-in play / stop, one exec-out. `loop` + `awaitComplete` is refused at three
  layers (inspector, `cinematic-await-loop` validation **error**, runtime), because it would hang a
  round silently; `stopCinematic` settles a pending await. `<FlowV2Cinematics>` renders the
  interpreter's `playingCinematics`.
- **The sequencer (Phase 2).** Shares `#timeline` with the dopesheet. Ruler scrub, one row per
  track, **layers** per actor (⧉), **strips**: drag, trim either edge (a left-trim moves `start` and
  `clipIn` together), Alt ignores the fps grid, Ctrl+wheel zoom, Del, Ctrl+D. Blend ramps drawn in
  the strip, additive strips tinted. The strip inspector exposes every evaluator field (clip, start,
  length, clipIn, speed, once / fill / count N / ping-pong, blend in/out, alpha, replace vs
  additive). One drag = one undo step.
- **Property + camera tracks** — ◆ keys actor x / y / scale / rotation / alpha at the playhead
  (linear / ease / hold); the camera track keys the current stage view, with a **🎥 live** toggle.
  A keyed channel owns its property for the whole cinematic (holds first/last value), so typing in
  its field keys rather than edits the static value.
- **Visibility tracks** — stepped keys (filled = shown from here, hollow = hidden); a keyed track
  holds its first key backwards so a hidden-then-shown actor never flashes at frame 0.
- **Cue tracks** — ⚡ named moments (`fx:` / `sfx:` / `music:` / `signal:`), picked from a real
  `<select>` (a datalist filters itself to the current value) or typed. Firing is `cuesCrossed`: a
  half-open `(prev, now]` window, and **a seek fires nothing**. Game-side, sounds go through the
  player (guarded by `hasSound`), everything else is broadcast on the event bus under its bare name.
- **Set + depth** — a cinematic can bind a Scene (`stage.sceneId`, mounted through `LayoutScene`).
  The set / `fx:` layer sits on the cast's z line at `stage.setZ` (absent ⇒ behind everything,
  parity), shown as a **⚡ fx** row (**🎬 set** once a Scene is bound) moved with ▲▼. The preview can
  only show bands (all rigs share one WebGL canvas); the game honours the real depth.
- **Overrides — authoring motion inside the cinematic.**
  - **Inline posing** (✎ on a cast row): bones draw on the stage and the animate toolbar appears
    with timeline, cast and playhead unchanged; the first key builds a layer + strip + clip
    (`ensureOverrideClip`) with blend ramps by default — without a blend-out a strip holds its last
    frame (`holdForward`) for the rest of the cinematic.
  - **Tweak Mode** (double-click a strip / ✎ Tweak clip): the existing animator on that strip's
    clip, the rest of the stage posed around it, ONE clock (`syncPlayhead` via the shared
    `cineTimeForLocal`; only the part of the clip the strip shows is reachable). Keying a rotated
    actor's root subtracts the stage rotation. **＋ New clip** creates an empty animation on the rig
    and enters Tweak Mode. Both edit the **rig** — 💾 Save rig, not the cinematic save.
  - **Underlay** — while tweaking, the actor's strictly lower layers are evaluated underneath
    (clips resolved from the rig editor's own `SkeletonData`), additive previews as base + offset.
  - **Strip bone masks** — mask editor on the strip inspector and in the tweak bar (◑ ＋ bone,
    ◑ keyed), live count via the evaluator's `expandBoneMask`, masked bones tinted on stage, ◑ on
    the strip. A sparse hand-authored clip needs no mask (`MixBlend.replace` passes un-keyed bones
    through); masks are for using part of an existing full-body clip. An empty mask is deleted.
- **Undo / redo** — snapshot-based, coalescing edits within 600 ms, only in cinematic mode and never
  while a field has focus; cinematic-document only (rig editing still has no undo).
- **The sequencer is the shared Timeline module (Rive plan Phase 2, PR #1171).** Everything above from "The sequencer" down — ruler + scrub, track rows, strips,
  property / camera / visibility / cue keys, the strip / key / cue inspector, the camera + cue panel
  sections and undo / redo — lives in `apps/launcher-api/src/lib/timeline/timeline.js`, mounted
  with `mount(el, { doc, ev, inspector, host, extensions })`. `/rigger` loads a **generated verbatim
  copy**, `static/shared/timeline.mjs` (`node scripts/sync-timeline.mjs`;
  `--check` fails on drift, run by `check:all`). The module has no imports and touches no global
  until `mount`, so Svelte code imports it from `$lib` (Phase 3). The evaluator is injected (`ev`).
  `static/rigger/cinematic.js` is now the **rig host**: the cast panel, rig loading, posing and
  drawing the stage, R2 save/open, and the rig **extensions** the module takes — Tweak Mode,
  inline posing, the underlay and bone masks (`rigExtension`: `timelineSuspended`, `stripBadge`,
  `onStripActivate`, `stripInspector`, `stripActions`, `wireInspector`, `keydown`). Track rows are
  data: `orderedRows()` lists them and `ROW_KINDS` draws and wires each kind, so a node-actor row
  (Phase 1) is one more entry.

### Gates + verification

| Proof | Result |
|---|---|
| `tools/rigger-spike/cinematic.mjs` — gates 1 + 2, channel sampling, cues, visibility, tweak-mode time inverse, evaluator-drift (headless) | **118/118** |
| `tools/rigger-spike/cinematic-pixi.mjs` — gate 3, the reference Pixi runtime pose contract (not rendering — see its header) | **15/15** |
| `static/rigger/cinematic-harness.html` — gate 2's WebGL half, in a real browser | **11/11** |
| `tools/rigger-spike/cinematic-storage.mjs` — storage guards + the export/prune chain (headless) | **41/41** |
| `tools/rigger-spike/cinematic-nodes.mjs` — node actors, hosts (a component host binds by name on the list it is handed, since Phase 4b), the text channel modes, the binding fold, rig-only parity (headless) | **69/69** |
| `apps/launcher-api/localizationHarvest.fixture.ts` — timeline switch-key harvest + the `timeline` origin | **all pass** |
| `tools/rigger-spike/cinematic-timeline.mjs` — the REAL `/rigger` page in headless Chrome, 104 author actions through the page's own handlers (strips, inspector, layers, masks, keys, cues, set row, undo/redo + coalescing, Tweak Mode, ＋ New clip, inline posing, save/open/new/delete); document, history and the three panels' HTML compared to a golden recorded on the pre-extraction code | **104/104** |
| `apps/launcher-api/timeline.fixture.ts` — the module imports through `$lib` with no browser globals and keeps the undo contract headless | **16/16** |
| `tools/rigger-spike/cinematic-flow.mjs` — `playCinematic` against the REAL interpreter + validator | **19/19** |
| `tools/rigger-spike/cinematic-screen-timeline.mjs` — Phase 3 end to end: author (headless Timeline + name targeting) → save (in-memory R2) → picker labels → `validateNodeActors` → `exportCinematics` / bundle → `playCinematic` on the REAL interpreter → game fold vs the editor's compiled preview module at six times; parity with no preview | **41/41** |
| `apps/launcher-api/scripts/check-cinematic-access.ts` — the REAL `/api/cinematics/*` handlers per entitlement (rigger / editor / both / neither), incl. the same-id hijack, force, the mid-request race, and a component-host section (Phase 4b) | **36/36** |
| `apps/launcher-api/scripts/check-shared-timeline-ship.ts` (`check:shared-timeline-ship`, Phase 9d) — the REAL promote / list / get / save / desktop-bake handlers on an in-memory R2: the capability gate, versions and snapshots, a stale `baseEtag`, a link in another project storing only its placement, `get` resolving and retargeting it with the update, the bake writing the resolved timeline (no link field) that the game's own `ComponentTimelinePlayer` plays (alpha + its Report event cue), Update / Detach / a missing version / a starter, a `/rigger`-style save refused, a shared read failing at publish (the last exported copy ships; a partial load prunes nothing), and the promote race (two promoters, a stray snapshot, a corrupt or deleted pointer) | **42/42** |
| `apps/launcher-api/scripts/check-timeline-rows.ts` (`check:timeline-rows`, Phase 9d) — Report event (`signal:` cue, one undo step, fired once by the game), visibility keys (game + preview), text count-up / switch keys (game sample, editor preview, mode switch, a modeless track, prune), and a doc mounted with `textRows` staying byte-identical | **27/27** |
| `apps/launcher-api/scripts/check-component-timelines.ts` (`pnpm --filter launcher-api check:component-timelines`) — Phase 4b: the registry, the per-instance player (start, hold, cues, latest-wins), two instances independent under signal scopes, reuse by name only (never an id) + validation, no self-restart from a timeline's own cue, export of a component timeline no Flow node names | **39/39** |
| `scripts/check-cinematic-ticker.mjs` (`pnpm check:cinematic-ticker`) — the REAL `<Cinematic>` compiled and mounted through Svelte's client runtime on a hand-stepped ticker: a one-shot plays to `oncomplete` with its playhead rising every frame and lands on its last frame; `loop` / `pingPong` docs and the `loop` prop never complete and keep advancing; a new `doc.id` (one-shot and mid ping-pong back leg) or `startTime` re-arms it and a new `speed` or `playing` does not (each changed alone; see open item 10); loops run on frames that do not divide the doc, so a wrap's overshoot is carried; each cue fires once (once a lap, out legs only for a ping-pong); unmount leaves the ticker | **37/37** |
| Live browser runs of the editor | undo/redo 22, sequencer 35, property/camera 36, R2 client flow 19, masks 31, New clip + tweak-bar masks 35, Tweak Mode ~55, inline posing / underlay / fx row 59 |

### What the gates established

- **Determinism (gate 1).** `scrub(t) === play-to(t)` bit-for-bit over 427 samples × 86 bones
  across a crossfade, a `fill` loop and an additive `pingPong` layer.
- **The MixBlend rule.** First non-additive strip → `setup`, later ones → `replace`, additive →
  `add`; an alpha-0.5 layer lands exactly on `lerp(base, top, 0.5)`. A layer passes through the
  base until its own first keyframe.
- **Looping is resolved into local clip time**, never the runtime's `loop` flag (which would wrap
  the untrimmed duration and ignore `clipIn`).
- **Bone masks are snapshot-and-restore** of the bones outside the mask; bone transforms only.
- **The in-game seam (gate 3)** — `state.clearTracks()` (a leftover track keeps firing its clip's
  events), pose in `beforeUpdateWorldTransforms` (the `after` hook renders the previous pose). The
  gate's `autoUpdate = false` was wrong for rendering: Pixi then never re-uploads the geometry, so
  the player keeps it ON — an emptied `AnimationState` makes that safe.

## Open items / next

0. **The ONE timeline system** ([rive-style-editor.md](../design/rive-style-editor.md) §3). Phase 1
   (node actors + hosts) is built, headless-verified only. ⏳ Browser-verify a screen-hosted
   timeline in a game (no authoring UI exists until Phase 2/3, so a probe doc has to be injected);
   wire `validateNodeActors` into a gate once an editor writes node actors; `animation` strips on
   rig nodes are still open. Component hosts play since Phase 4b (in review); its browser-verify
   list is in [component-editor status](component-editor.md) Blocked.
   Phase 2 (the shared Timeline panel, PR #1171) is built. Owner, please run these in a logged-in
   `/rigger` (the headless gate drives the same handlers with dispatched events,
   so these are the flows NOT browser-verified by a person on this change): undo/redo by buttons and
   keys, the sequencer (drag / trim / Alt / Ctrl+wheel zoom / Ctrl+D / Delete), property + camera
   keys (🎥 live), visibility keys, cues + the fx row, bone masks, Tweak Mode (double-click, ✎ Tweak
   clip, Esc, the dopesheet seek mapping back), ＋ New clip, inline posing + the underlay, and R2
   save / open / new / delete.
   **Phase 3 (Animate a screen) is built; owner, please browser-verify in a logged-in `/editor`:**
   (a) the Design | Animate toggle, and that Design behaves as before after leaving Animate (drag,
   handles, drop, Delete, Ctrl+Z/C/V/D); (b) ＋ New / open / Rename / 🗑 a timeline, and the
   screen switch closing it; (c) select a named node, type values and ◆ at two times, scrub the
   ruler and ▶ — the canvas moves, fades, scales, rotates and tints the node (sprite, text, rig,
   flipbook, a node inside a container); (d) an unnamed and a duplicate-named node show the
   refusal; (e) keys in Animate: Ctrl+Z/Shift+Z undo the timeline only, Delete removes a selected
   key and never a node, Ctrl+S saves the timeline; (f) Save, reload, reopen; the conflict prompt
   with two tabs; (g) a user with `editor` but not `rigger` sees only screen timelines;
   (h) `/flow-v2` → playCinematic lists "Timeline · <screen> · <name>" and shows a ⚠ for a renamed
   node; (i) publish and watch the intro play in game (Live ↗), with **Wait for it to finish**.
1. **⏳ Watch a full AUTHORED cinematic in a game.** The player itself is proved (2026-10-01 below),
   but only with a probe doc injected into the runtime bundle and started from the flow handle. A
   `playCinematic` node reaches the player only since 2026-10-16 (the env factory dropped it), proven
   headless with a screen timeline (Recent changes); no browser has watched one yet. The remake's one
   doc (`suca_cine`) has no cast and is not exported.
2. **⏳ Live-verify the server chain against real R2 + Postgres** — save, reload, open, publish,
   and confirm `deploy/cinematics/` fills and the bundle carries `cinematics`.
3. **⏳ Owner eyeball** — two rigs staged together (premultiply halos, relative scale between rigs
   authored at different atlas `scale:` factors); and whether Tweak Mode / inline posing *feel*
   like the ask (owner asked to keep both routes until the shape settles).
4. **`sync-cinematic-eval.mjs` is manual** — the gate catches drift, but nothing regenerates the
   browser copy; wire it into a pre-build step.
5. **Non-rig content (design §12)** — `＋ Text` / `＋ FX` quick-add into the bound set (§12.3), and
   placed/persistent FX slots (§12.4a). Rig-level localized text is done as §12.4a in the Rigger.
6. Resolve design §9's open questions (doc scoping + template library, per-ratio, inline vs
   referenced set, flatten-to-`.irig` escape hatch).
7. **A frame hitch when a cinematic mounts.** On the live remake (2026-10-01) the probe cinematic's
   ×1 run took 8.2 s of wall time for 6 s of game time (323 frames), and ×2 took 4.4 s for 3 s.
   The game clock paused for 1–2 s, and so did the cinematic, which follows the game clock by
   design. Locally it ran 6.000 / 3.006 s, with one 8.4 s outlier. It is likely first-use texture
   upload of the cast rigs' large atlases. Measure the longest frame at mount; preloading the cast's
   textures when the flow arms a `playCinematic` would hide it.

8. **Two old sequencer bugs, carried over unchanged by the Phase 2 extraction (left as-is so it changes
   no behaviour):** opening or starting a cinematic keeps the selected cue's time, so a cue at that
   same time in the new doc opens pre-selected; and leaving 🎬 before the mode's first load finishes
   writes a `{doc:null}` draft over the saved local draft.

9. **A screen timeline played while its screen is not shown** draws its own copy inside
   `<MainContainer>` (Phase 1): a `game` or `canvas` screen comes out framed by the game box twice
   (misplaced and resized), with no tap dim and the HUD live. The guide says to Show the screen
   first; decide whether such a play should instead show nothing, or mount the screen at its own
   band. The Pots screen the game mounts itself no longer hits this (2026-10-21); the banner
   screens the game mounts itself (`engineBannerScreens`) still do.

10. **A playing `<Cinematic>` restarts whenever the flow's playing set changes** (found by the
    ticker gate's review, 2026-10-20; older than Phase 9b). The re-arm `$effect` reads
    `props.doc.id`, which tracks the `doc` prop's getter, and `FlowV2Cinematics` hands every prop off
    an entry object it rebuilds when any cinematic starts or ends, or a host screen's `setMounted`
    flips. So a second cinematic starting (or one completing) sends every other playing one back to
    its start and fires its cues again. Tracking only the id is not enough: a replay of a
    still-playing id relies on the same rebuild to restart it, so the fix needs a play generation
    from the flow runtime (a key, or a prop the effect reads).

11. **A looping `<Cinematic>` skips a cue inside a wrap's overshoot** (same review; older than
    Phase 9b, on the `loop` prop path). `cuesCrossed` sees only the stretch before the wrap, so a
    cue key closer to 0 than the frame's overshoot never fires on later laps (at 17 ms frames, a
    cue at 0.005 s fired 2 times in 3.5 s instead of 4). A ping-pong, which keeps an unwrapped lap
    clock, is unaffected.

12. **Each play remounts its screen** (`{#key drive.key}` in `<FlowV2Mount>` and
    `<EngineScreenMount>`, because a node reads its driver once). On the Pots screen, which lasts
    the whole session, a meter's fill glide or a full pot's rig animation running at that moment
    restarts. Check on a pots game in the browser; a node that took its driver live would remove it.

## Blocked (owner / external)

- Nothing external.

## Recent changes

- 2026-10-21 — **The Pots screen's timeline moves the pots the player sees, and keys per screen
  ratio** (branch `claude/quirky-clarke-jmc9b3`). Reported on a live Pots overlay project
  (`commonoverlayproject`): a timeline keyed on the Pots screen drew a second, misplaced and
  resized set of pots that animated and vanished, while the pots on screen never moved. The flow
  never showed `pots`, so the game mounted it itself (`enginePotsScreen`), and only a flow-shown
  screen counted as up, so `<Cinematic>` drew its own copy. Now `<EngineScreenMount>` reports the
  game's Pots mount up while it is mounted and takes the timeline's driver; the screen bookkeeping
  moved out of `flowV2Runtime.svelte.ts` into `screenDrives.svelte.ts`. The owner then found the
  moves did not fit the other ratios (one `y` offset, a Portrait layout with smaller pots placed
  apart): per-ratio keys, above. Gates: `pnpm check:screen-timeline-mounts` (the real
  `FlowV2Cinematics`, `Cinematic` and `EngineScreenMount` on a ticking clock: first the duplicate
  as `main` drew it, then one set of pots that moves, holds, and lets go when the board goes down;
  nothing drawn while the board is down mid-play; a flow-shown screen as before; each ratio's
  keys, live when the device turns, mid-play and on a held last frame, through a mounted node's own
  `$derived`; and source checks that `Game.svelte` and the runtime wire it so) and
  `pnpm --filter launcher-api check:timeline-ratio-keys` (format, the module and its paste, the
  Animate helpers, editor preview = game sample). Owner browser check pending.

- 2026-10-20 — **Fix: the playhead drifts off the cursor once the timeline is scrolled** (branch
  `claude/nifty-curie-0eqlx3`). Reported on `/editor`: zoomed in, scrolled right, then scrubbing,
  the bar sat to the left of the cursor. `positionPlayhead` subtracted `el.scrollLeft`, but the
  playhead lives inside the scrolling container (`position: relative` on both hosts), so it already
  scrolls with the lanes — the offset was exactly the scroll distance. It now takes the content
  coordinate, is sized to the full scroll height (it stopped at the visible box before, so lower rows
  had none once scrolled down), and hides while its time is scrolled under the sticky name gutter.
  Same shape as the Rigger dopesheet's own `positionPlayhead`. Verified in Chromium against both
  versions of the module with the editor's CSS: scrolled 1500 px, the old bar sat 1500 px left of
  the cursor while dragging on the ruler, the new one 0 px. The `/rigger` golden
  (`tools/rigger-spike/cinematic-timeline.mjs`) is re-recorded: the playhead's new `height` is the
  only change to the existing steps, and a new step scrubs with the lanes scrolled (it fails on the
  old `- scrollLeft`), then puts the time and scroll back so the later steps run as before.

- 2026-10-20 — **Phase 9d: the shared timeline library and the cue / text / visibility rows**
  (branch `claude/rive-p9d-shared-library`, in review). Storage, link format and ship chain in
  Current state above; the editor side in [editor status](editor.md) 2026-10-20 (9d).
- 2026-10-20 — **Gate: `<Cinematic>` plays on a ticking clock** (`check:cinematic-ticker`, run by
  `check:all`). The hotfix below was invisible to CI because nothing mounted the player on a clock.
  The gate compiles the REAL `Cinematic.svelte`, mounts it with a fake app context whose ticker it
  steps frame by frame, and asserts what the Gates table lists. On the pre-fix `lap = time` it
  fails 21 of 37 (the playhead never leaves 0); with the fix all pass. It also catches a re-arm
  that keeps `done` or the ping-pong lap, a loop or ping-pong that drops a wrap's overshoot, and a
  ticker left subscribed after unmount. Its review found two older playback bugs, open items 10
  and 11. The DOM shim it shares with `verify-pot-meter-mount.mjs` moved to
  `scripts/lib/svelte-dom-shim.mjs`. Not covered: `ComponentInstance.svelte`'s ticker wiring of
  the component timeline player; the player itself is stepped by `check:component-timelines` and
  `check:cinematic-ease`, but nothing mounts the instance on a clock.
- 2026-10-20 — **Hotfix: in-game timelines stuck on frame 0 since Phase 9b** (branch
  `claude/fix-cinematic-rearm`). Reported on `commonoverlayproject`: the bonus's pot and curtain
  timelines never played, and the awaited Flow chain after them never ran. 9b's re-arm `$effect` in
  `<Cinematic>` gained `lap = time`, a READ of `time`, so every ticker write re-ran the effect and
  reset the playhead to the start; a Flow `playCinematic` never completed. The effect now reads only
  `doc.id` and `startTime`. Verified on the live project's data (forced `pot:red`): both timelines
  finish and the feature intro holds for its tap. No gate mounts `<Cinematic>` on a ticker, which is
  why CI stayed green.

- 2026-10-20 — **Phase 9b: cubic ease, loop type, default interpolation, multi-key editing**
  (branch `claude/rive-p9b-keying`, in review). Format + evaluator + players + the module's keying
  surfaces, detailed in Current state above; the editor side is in
  [editor status](editor.md) 2026-10-20.

- 2026-10-16 — **Flow's `playCinematic` plays in game; a screen timeline moves the shown screen**
  (branch `claude/amazing-archimedes-rzuz77`). Reported on a live game: a Feature intro keyed in
  Animate mode never moved. Two causes. (1) `createFlowV2Env` (`engine-flow-v2/src/env.ts`) never
  forwarded `playCinematic` / `stopCinematic` (nor `containerAnimationMs`), so every play was a
  no-op and an awaited one continued at once; `svelte-check-baseline.json` had absorbed the
  excess-property errors that said so (baseline lowered by 7). (2) The in-game player drew its own
  copy of the host screen, never the one the Show node put up. Now the playing `<Cinematic>` hands
  its node driver to the flow (`driveScreen`), `<FlowV2Mount>` remounts the shown screen with it
  (`screenDrive`, `LayoutScene.nodeDriver`), and `setMounted` stops the copy; a drive lasts while
  the timeline plays or its screen is up. A timeline the bundle lacks is skipped with a warning
  (`[flow-v2] playCinematic: … did not ship`). Gate: `packages/engine-flow-v2/envFactory.fixture.ts`
  (every `env.*` the interpreter calls exists on the factory's env; each optional capability
  reaches the game; an awaited play holds; `durationMs` feeds a Delay), run by `check:all`; it fails
  on the old `env.ts`, naming the three. Headless (local Pots → Hold and Win game, real time and
  determinism): Show → playCinematic → held Show animates the shown intro, holds, and the bonus
  follows the tap; play → held Show and a missing timeline in the chain both still hold and settle;
  a flow with no timeline is unchanged. Owner browser check passed 2026-10-17.

- 2026-10-15 — **`fx:<id>` node channels** (Invisible FX Step 2): `sampleNodeActor` samples a
  property track's `fx:` channels under their own names (absolute: an effect node's exposed
  parameter), `blendNodeSamples` mixes them on an effect node, and the shared Timeline module gained
  `host.actorChannels` and a `keyProperty` ease (both synced to `static/shared/`). Detail in
  [FX status](fx.md), 2026-10-15 "Step 2".
- 2026-10-14 — **Generated timelines and a per-component play rate (Rive plan Phase 8b, branch
  `claude/rive-p8b-win-design`).** `registerGameTimelines(baked, generated)` takes timelines the
  game GENERATES at boot (the authored win's per-tier walk / loop / outro docs, `winTierTimelines`,
  lower-case ids a baked project timeline shadows); `ComponentTimelinePlayer.playRate` advances
  every running `playOn` timeline by `dt × playRate` (`componentPlayRate.ts`, set by the game);
  a `text` track in `switchKey` mode drives the caption. No Animate UI for any of it in this
  change. Detail: [engine status](engine.md), 2026-10-14; launcher gate `check:authored-win`.

- 2026-10-14 — **`animation` strips on rig NODE actors + `holdsCue` (Rive plan Phase 8a, branch
  `claude/rive-p8a-transition-overlay`).** The §3.1 open item: a node actor's `animation` track now
  plays — `sampleNodeActor` (synced copy too) samples the strip active at `t` as `animTime:
  { animation, time }` in clip-local SECONDS (`clipLocalTime` with the strip's new `clipLength`, else
  once-and-hold), `keyedNodeChannels` keys `animTime`, `nodeActorChannelsForKind('spine')` takes it
  (`validateNodeActors`: `channel-unsupported` on any other kind), and the player hands it to
  `<LayoutNodeView>` → `<RigPose>` (`unit: 'seconds'`). A component timeline may carry `holdsCue`
  (Animate → **Holds the cue**, cleared with Plays on). Not built: the `/rigger` and `/editor`
  sequencer rows for a rig-node strip (the first built-in timeline is code); loop modes on a node
  strip need `clipLength`. Gates: `check:component-timelines` (53), `cinematic-nodes.mjs` 69/69,
  `cinematic.mjs` 118/118. The runtime seam, the registry rule and the built-in timeline:
  [engine status](engine.md), 2026-10-14.

- 2026-10-13 — **Component state machine runtime (Rive plan Phase 5a, branch
  `claude/rive-p5a-state-machine-runtime`).** `stateMachine.ts` (interpreter, `blendNodeSamples`,
  `validateStateMachine`), `componentInterface.ts` (the signal → trigger fold, `componentInterface`
  values), the registry keeping every component timeline by id, `ComponentTimelinePlayer.drive`/
  `release`/per-property layer merge, the per-instance wiring in `ComponentInstance.svelte` — as
  described under Current state. Gate `check:component-state-machine` (89). Plan §5 updated with
  the as-built shapes and semantics.
- 2026-10-13 — **Component timelines (Rive plan Phase 4b, branch
  `claude/rive-p4b-component-timelines`, stacked on 4a).** A component-hosted timeline now plays:
  `playOn` / `playOnComponents` in the format, `ComponentTimelinePlayer` per placed instance, the
  node driver scoped by nest depth, the access level `screen` → `hosted` (component hosts too, rig
  cinematics still Rigger-only), component timelines out of the Flow picker — as described under
  Current state. New gate `check:component-timelines` 39/39; `check:cinematic-access` 36/36; the
  Phase 1 spike's component-host assertion now expects binding by name (69/69).
- 2026-10-13 — **Screen timelines in the Scene Editor (Rive plan Phase 3).** Animate mode in
  `/editor`, editor-gated access to screen timelines, the Flow picker, and the editor preview
  through the game's fold — as described under Current state. Verified headless: all nine cinematic
  gates via `check:all --only cinematic` (incl. the new 41/41 end-to-end proof and 28/28 access
  check, and the `/rigger` golden 104/104), `check:launcher-gates` (366),
  `check:doc-readers-unknown-fields` (247), `check:save-keeps-unknown-blocks` (58), svelte-check at
  baseline, lint clean. **Not browser-verified** (the canvas is auth-gated) — see item 0.

- 2026-10-13 — **The sequencer is the shared Timeline module** (Rive plan Phase 2, PR #1171). The timeline panel moved out of
  `static/rigger/cinematic.js` (2,743 → ~1,590 lines) into `$lib/timeline/timeline.js`, shipped to
  the static page as a generated copy like the evaluator. Rig-only authoring plugs in as
  extensions. **No behaviour change, and proven, not promised:** a new browser gate recorded the
  document, history and DOM after 104 author actions on the OLD code, and the extracted module
  reproduces all 104 exactly; planted mutants (no coalescing, a smaller trim zone, the timeline not
  yielding to Tweak Mode, the mask badge dropped) each fail it. No format, evaluator, storage or
  endpoint change.

- 2026-10-13 — **Node actors + hosts (Rive plan Phase 1).** Format, evaluator, binding and
  `<Cinematic>` player as described under Current state; localization harvests switch-key strings
  as `origin: 'timeline'`. Verified headless: the four existing cinematic gates (118/118, 15/15,
  19/19, 41/41) plus the new `cinematic-nodes.mjs` (69/69) and the harvest fixture;
  `check:art-scope`, `check:doc-readers-unknown-fields` (247), `check:save-keeps-unknown-blocks`
  (58), `check:renderable-fonts`, `check:scene-cues`, `check:director-adapters` (442), svelte-check
  at baseline, lint clean. **Not browser-verified** — nothing renders a node-actor timeline yet.
  `cinematic-storage.mjs` had been red on `main` since #1112 (its esbuild bundles did not know
  SvelteKit's `$lib` alias); it now passes the alias.
- 2026-10-01 — **`<Cinematic>` threw on every in-game mount, and now plays.** It read
  `appContext.app.ticker`, but pixi-svelte's app context is `{ stateApp }` (the application is
  `stateApp.pixiApplication`), so mounting it threw "Cannot read properties of undefined (reading
  'ticker')" and nothing played. svelte-check had reported it from day one (5 × `ts:2339`, with the
  undeclared `oncue` prop), but the errors sat in the ratchet baseline. Both are fixed and the
  baseline is lowered. Found while proving the reference Pixi runtime 4.2.120 bump (#929).
  - **autoUpdate verdict:** 4.2.120 made the `autoUpdate` setter idempotent and moved it onto a
    configurable `ticker` (default `Ticker.shared`). A default `RigView` still registers once, and
    `false` still detaches. 4.2.74 used to add a second listener on a repeated `true`, which would
    double-update a rig. `<CinematicActor>` never touches `autoUpdate`, so its contract is unchanged.
    `tools/rigger-spike/cinematic-pixi.mjs` part C now asserts this against the real runtime.
  - **Real-clock proof:** a local `apps/lines` build (the bump + this fix) on the headless shell at
    60 fps booted the remake's live data. A two-rig probe doc (`R_Cinematic1` Intro → Idle,
    `R_Cinematic2` Tier1_Intro, 6 s) was injected into `/api/editor/runtime` over CDP and started via
    `__IE_FLOW_V2__.playingCinematics`. `oncomplete` fired at 6.012 s for ×1 and 3.032 s for ×2,
    both rigs re-posed every sample, and it unmounted on completion. Across about 200k rig
    updates, none ran twice on a tick with dt > 0; the only repeats were `RigTrack`'s `update(0)`.

- 2026-08-19 — **Inline posing** (✎ on a cast row) — the owner's third iteration on "edit my bones
  straight into cinematic"; Tweak Mode had answered with a surface swap onto an empty clip.
  Reuses Tweak Mode's state with `inline: true`. Caught live: override blend-outs are
  load-bearing, and `renderTimeline`'s tweak guard had hidden the cinematic timeline.
- 2026-08-19 — **Tweak underlay** — an override is authored over the layers below it, not over a
  T-pose. `beginTweak` now asserts cinematic mode is on (a late `restoreRiggerState` had left
  `cineMode` false with every tweak flag set: frozen stage, UI claiming to tweak).
- 2026-08-19 — **The fx depth row exists without a bound Scene** (it had been gated on
  `stage.sceneId`, leaving the common case with no control), and says when the preview can only
  approximate the depth.
- 2026-08-18 — **＋ New clip, tweak-bar masks, masked bones on stage** — a mask filters a clip; the
  clip it filters could not be created from the cinematic.
- 2026-08-18 — **Strip bone masks** — the evaluator had supported them since Phase 0 with no UI.
- 2026-08-18 — **Tweak Mode** (design §4.4). Three pre-existing crashes fixed on the way:
  `stripById` walked keys-only tracks; imported rig JSON omits `time` at 0 (`normalizeKeyTimes`
  on load); `getAttachment(null)` throws.
- 2026-08-18 — **The set is a layer** (`stage.setZ`), so an `fx:` cue can play in front of a rig;
  **a cue can be changed** after it is set (real `<select>`, not a datalist).
- 2026-08-17 — **Every game app's build was broken** — `engine-layout` imported
  the reference runtime without declaring it; `vite dev` and the launcher (which
  declares it) stayed green. Declared at the same pin as `pixi-svelte` so there is ONE rig
  runtime. A package that imports a module must declare it; a green dev server is not evidence the
  games build.
- 2026-08-17 — **First real game mount: rigs appeared but never moved** — `autoUpdate = false`
  stops Pixi's update+render pass; it stays ON now (see "What the gates established").
- 2026-08-17 — Frame guide + Frame picker via the canonical layout resolver; set picker (with
  pickers that re-render when their async lists land, and a 🗑 that says why it declined);
  cinematic mode hides the rig-only chrome; save/open failures surface with status + body.
- 2026-08-17 — **Phases 0–3 built in one day**: gates 1–3, the Phase 1 mode (an rAF-polled asset
  wait hangs in a non-painting tab — poll with `setTimeout`; expose `RIG` as a getter), undo,
  the sequencer, property/camera/visibility/cue tracks, R2 persistence (the save had posted no
  `projectKey`, making the scope guard dead code), the export chain (the `rigId` → folder identity
  fix), `<Cinematic>`, and `playCinematic`.
