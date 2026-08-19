# Invisible Cinematic — status

> Design: [docs/design/invisible-cinematic.md](../design/invisible-cinematic.md) · Guide: [docs/tools/rigger.md §Cinematic mode](../tools/rigger.md#cinematic-mode) (it is a mode of `/rigger`, so it shares the Rigger's guide) · Agent: `.claude/agents/invisible-rigger.md`

**One-line state:** **Phases 0–3 COMPLETE + Tweak Mode (§4.4) + strip masks** (2026-08-18) — `/rigger`'s 🎬
**Cinematic** mode stages several rigs, authors them as tracks of strips + property/camera keys,
saves to R2 per project, travels the ship chain with the rigs it casts, plays in-game through a
**`<Cinematic>`** component driven by the same evaluator, and is triggered from an authored flow
by the **`playCinematic`** node. The pipeline is closed end to end. **⏳ None of the engine side
has run in a real game yet** — everything past the editor is verified by construction and by
headless contract tests, never by execution (see Open items).

## Current state

- **`/rigger` cinematic mode (Phase 1).** A fourth mode next to Preview / Setup / Animate. Cast a
  rig from the project as an **actor** (the same rig can be cast twice — independent instances),
  place it (x / y / scale / rotation / flip), set its draw order, toggle its visibility, give it a
  clip, and scrub or play the whole stage. Reachable with **no rig open** (it boots the spine
  runtime + GL itself). Lives in `static/rigger/cinematic.js`; the rig editor's blast radius is
  four small hooks in `view.html` (mode button, `setMode` branch, `frame()` branch, lazy loader)
  plus an early-return in `mousedown` so no bone/mesh branch runs on a multi-actor stage.
- **R2 persistence (Phase 3, part 1).** Open / Save / ＋ New / 🗑 over
  `<client>/<project>/cinematics/<id>.json`, with Ctrl+S. Endpoints under `/api/cinematics/*`,
  gated by the **`rigger`** entitlement (Cinematic mode lives inside `/rigger`, so it carries the
  Rigger's, not a second one). Three deliberate choices:
  - **No index blob.** The list is an R2 prefix listing, so adding or deleting a cinematic never
    read-modify-writes a shared object — the exact race that silently dropped rows from the
    Rigger's `_shared/{rigs,animations}/index.json` and surfaced as "my rig vanished".
  - **Conditional writes.** Every save carries the `baseEtag` it loaded; a stale one answers 409
    and the author is *asked* before overwriting, never clobbered silently. A create sends
    `baseEtag: null` (not an absent field — `writeBaseEtagJson` 400s on absent, by design).
  - **A scope guard the client actually feeds.** The save posts its `projectKey`, so switching
    project in another tab is refused rather than writing into the wrong project — and `force`
    does not bypass it (overwriting *your* doc is a choice, someone else's project never is).
  `localStorage` is now only a crash/reload **draft**, not the source of truth.
- **The ship chain, data half (Phase 3, part 2).** `cinematicExport.ts` mirrors each authored
  cinematic into `<client>/<project>/deploy/cinematics/<id>.json` (pruning any deleted since the
  last export), `ensureDeployExports` embeds them in the runtime bundle as `cinematics`, the
  offline bake fetches `/api/editor/export-cinematics` and embeds the same, and the game reads
  them via **`bakedCinematics()` / `bakedCinematic(id)`** (`[]` when un-authored ⇒ parity).
  `CinematicDoc` lives in `engine-layout` so the bundle contract and the future player share
  one type.
  **The rule-8 trap this closes:** a cinematic casts rigs that may appear in NO scene, so the
  editor-art export's static walk cannot see them — the doc would ship while its rigs did not.
  `exportEditorArt` now takes an `extraSpineNames` seed (same shape as its existing
  `cardComponentIds` / FX-atlas seeds) fed from `cinematicRigNames()`, so every cast rig travels
  with the cinematic.
  **Rig identity is the FOLDER, never the index `id`** — `SkeletonIndexEntry.id` is a contiguous
  array position reassigned on every skeleton scan, so a stored id would silently re-point a saved
  cinematic at a different rig the moment anyone adds one. The folder is stable AND is the spine
  bundle name the game registers, which is what makes the seed above work.
- **`packages/engine-cinematic`** — the layered strip evaluator: `clipLocalTime` (clipIn/clipOut
  trim · speed · once/count/fill/pingPong · extrapolation), `blendEnvelope` (blend-in/out ramps ×
  alpha), `evaluateActor` (layer stack, additive, bone masks), `cuesCrossed` (edge-triggered cues)
  and the channel sampling (`sampleChannel` / `sampleTrack` / `resolvePlace` / `putKey`).
  Dependency-free plain ESM JS with a hand-written `.d.ts`, because its two consumers cannot share
  a module path: the **engine** imports the package, while `/rigger`'s static `view.html` fetches
  it over HTTP and cannot reach into `packages/`. The launcher's
  `static/shared/cinematicEval.mjs` is therefore a **generated verbatim copy**
  (`scripts/sync-cinematic-eval.mjs`), and the gate asserts they are identical — so the editor
  preview and the shipped game can never evaluate differently. Verified negatively: appending one
  line to the copy fails both the gate and `--check`.
- **`<Cinematic>` (`engine-layout/svelte`)** — the in-game player. Mounts one `<SpineProvider>`
  per cast member, keyed by the rig FOLDER (the bundle name the export seeds into the shipped
  art), and drives them all from ONE clock through the shared evaluator, so what an author
  scrubbed is what the game plays. Props: `doc` · `playing` · `startTime` · `loop` · `speed` ·
  `oncomplete` (the Flow `complete` seam). `CinematicActor.svelte` applies gate 3's measured
  contract per rig — **`autoUpdate` stays ON** (see Recent changes: turning it off froze every rig
  leftover track keeps firing that clip's spine events every frame), pose in
  `beforeUpdateWorldTransforms` (the `after` hook renders the PREVIOUS pose), `spine.update(dt)` —
  and restores the rig on destroy. Driven by the Pixi ticker, not its own rAF, so a paused game
  pauses the cinematic.
- **Flow-v2 `playCinematic` node.** A presentation leaf in the Flow palette: pick a cinematic by
  id, set `speed`, and choose `loop` or `awaitComplete`. Pins are exec-in **play** / exec-in
  **stop** / one exec-out — no data pins, because everything about the cinematic's content was
  authored in `/rigger`. With `awaitComplete` the exec chain holds until the cinematic reaches its
  end (`<Cinematic>`'s `oncomplete` settles the promise the interpreter is waiting on).
  **`loop` + `awaitComplete` is refused at three layers**, because it is the one combination that
  hangs a round forever with no error — the `showContainer{awaitComplete}`-with-no-release trap:
  the inspector clears one when you set the other, `validate` raises `cinematic-await-loop` as an
  **error** (not a warning), and the runtime refuses to await a looping play even if a hand-edited
  doc carries both. `stopCinematic` also settles a pending await, so a mid-play stop cannot strand
  an awaiting chain. Game-side, `<FlowV2Cinematics>` renders whatever the interpreter's reactive
  `playingCinematics` map holds.
- **Visibility tracks.** ◆ beside an actor's eye keys its on-screen state at the playhead; keys
  draw as their own timeline row where the **shape carries the state** — filled = on screen from
  here, hollow = hidden from here — so the row reads with no legend. Drag to retime, double-click
  to delete. **Stepped by nature**: a boolean does not interpolate, so the value is the last key
  at or before the playhead. Once visibility is animated the ● / ○ toggle KEYS the flipped state
  rather than editing the static flag (same rule as the numeric fields — editing a value the
  track overrides would look like it did nothing). Honoured on the `/rigger` stage AND by the
  in-game player, both through the shared `resolveVisible`.
- **Cue tracks.** A global ⚡ cues row: **＋ Cue at playhead**, then edit its name and time (drag
  the marker to retime). A cue is a NAMED MOMENT the game reacts to — the cinematic never
  implements the effect, it only says when. Namespaces: `fx:` (an Invisible FX effect) · `sfx:` /
  `music:` (a game sound cue) · `signal:` (broadcast on the game event bus). Markers are coloured
  by namespace. The inspector pairs a **pick** dropdown — every FX effect in the project, plus
  the other three kinds — with a free TEXT field, because the ids a cue names live in three
  different systems and only `fx:` is listable from here. The dropdown is a real `<select>`, NOT
  a datalist: a datalist filters itself against the field's current value, which made a cue
  unchangeable once it was set.
  **Firing is owned by `cuesCrossed`** (shared, and gate-tested to 10 assertions), so the editor
  preview and the game agree on "fired": a half-open `(prev, now]` window, and **nothing fires on
  a seek** — a backward step or a jump bigger than a frame is silent, which is what makes
  scrubbing across a cinematic usable instead of a machine-gun of effects. Editor-side an `fx:`
  cue drives the stage FX overlay the Rigger already vendors; the other namespaces name things
  that only exist in a game, so they surface in the status line rather than silently doing
  nothing. **Depth belongs to the LAYER, not the cue**: `stage.setZ` — the **⚡ fx** row in the
  timeline, which becomes **🎬 set** once a Scene is bound — is what puts a cue's effect in front
  of a rig. The row appears as soon as ONE `fx:` cue exists, with or without a set (see Recent
  changes: gating it on a bound Scene left the common case with no control at all). At an
  in-between depth the row says the preview can only show bands — see Recent changes for why. Game-side `<FlowV2Cinematics>` routes them: sounds through the player (guarded by
  `hasSound`, since howler declines an unknown sprite key silently), everything else broadcast on
  the event bus under its bare name — the SAME seam a rig's timeline events use, so a cinematic
  cue and a rig event are indistinguishable downstream.
- **The sequencer (Phase 2).** The cinematic timeline shares `#timeline` with the dopesheet (only
  one is ever built, so they never fight). A ruler you drag to scrub, one row per **track**,
  **layers** per actor (⧉ adds one; layers blend bottom-up), and **strips** you can:
  drag to move · drag either edge to trim · **hold Alt** to ignore the fps grid · Ctrl+wheel to
  zoom · Del to delete · Ctrl+D to duplicate. A **left-trim moves `start` and `clipIn` together**
  so the art under the cursor stays put instead of sliding — the standard NLE behaviour. Blend
  ramps are drawn inside the strip and additive strips are tinted differently, so the layer stack
  is readable at a glance. A **strip inspector** exposes every field the evaluator reads: clip,
  start, length, clipIn, speed, loop mode (once / fill / count N / ping-pong), blend in/out,
  alpha, and replace-vs-additive. One drag = **one** undo step (the doc updates live so the stage
  follows the gesture, but history is recorded on pointerup).
- **Inline posing — author an override ON the cinematic stage (owner's ask, third iteration).**
  *"I would like to edit my bones straight into cinematic, and not in a new window animate … create
  an override on top of it while I can see it playing."* Tweak Mode answered the wrong half: it gave
  the animator, but as a surface swap (dopesheet replaces the strip timeline, rig outline replaces
  the cast panel), which reads as leaving the cinematic — and it opened an EMPTY clip, so there was
  nothing to look at.
  **✎ on an actor's cast row** now turns on posing in place: bones draw on the stage, the animate
  toolbar appears, and **nothing else moves** — timeline, cast panel and playhead all stay. The
  actor is posed by its own layers, so you pose on top of the walk while it plays.
  **The first key builds the override.** There is no clip to pick and no strip to add: `keyBone` →
  `ensureCurAnim` → `ensureOverrideClip()` creates a layer above everything the actor has, a strip
  at the playhead (2s, clamped to the cinematic), and a clip on the rig — then keys into it. Hooking
  `ensureCurAnim` means EVERY keying path (bone drag, ◆ Key, ◆ Key all, the numeric fields) creates
  it the same way. The strip appears on the timeline selected, ready to trim.
  **Auto-created overrides get blend ramps, and they are load-bearing.** A strip extrapolates
  `holdForward`, so an override with no blend-out holds its last frame for the rest of the
  cinematic — the misstep sticks and the character limps forever. A blend-out takes alpha to 0 at
  the strip end, which both eases the move and ENDS it. Caught by the live test, not by reading.
  Implemented as the SAME state as Tweak Mode with `inline: true` (it needs the same three things:
  a rig open, the lower layers posed underneath, the animator's keying paths) — only
  `applyInlineChrome` differs, and the renderTimeline / syncPlayhead / tweakAfter branches that
  assume a dopesheet are skipped. Tweak Mode itself is untouched and still reachable; the owner
  asked to keep both until the shape settles.
- **The tweak underlay — an override is authored ON TOP of the layers below it.** Tweak Mode used
  to start each frame at `setToSetupPose()`, so authoring a strip on layer 1 posed the actor from
  that clip ALONE: the base animation it overrides was not under it. The classic case makes the
  problem obvious — a walk looping for 15s with a 2s misstep at 8s — you were keying the stumble
  onto a T-pose and had to imagine the stride (owner: *"I would like to create a track on top of an
  animation so I can modify that animation in the cinematic"*).
  `tweakPose` now takes an **underlay**: the cinematic evaluates this actor's tracks on layers
  STRICTLY BELOW the tweaked strip (through the shared `evaluateActor`, at the cinematic playhead)
  onto the editor's skeleton, and the tweaked clip lands on top exactly as the sequencer will land
  it. Scrub and the character keeps walking under your hands. Nothing underneath ⇒ null underlay ⇒
  the setup pose, byte-identical to before.
  **The clips come from the RIG EDITOR's `SkeletonData`, not the actor's** — a spine timeline
  addresses bones by index, and these are applied to the editor's skeleton, so both must come out of
  the same parse or an edited rig would pose the wrong bones.
  **`poseAtTime` learned the additive form** (`MixBlend.add`: rotate/translate/shear add their
  offset, scale adds its delta from setup), so an additive override previews as walk + offset
  instead of replacing the walk. Measured live: replace and additive land on genuinely different
  values, and additive equals walk + the keyed offset to 0.01.
- **＋ New clip — authoring an override without leaving the cinematic.** An override has to live
  in a clip, and nothing in the cinematic could make one: the only route was to leave for ◆ Animate,
  create an animation, come back and find it in the strip's dropdown. Three mode switches to express
  "I want to animate something here", which is why the mask editor read as a dead end (owner: *"what
  am I supposed to do once I add a bone? I can't edit any bone anywhere, and I can't keyframe it"*).
  **＋ New clip** on a strip creates an empty animation on that actor's rig (`uniqueAnimName`, so it
  never overwrites), points the strip at it, and enters Tweak Mode in one gesture. The recipe is now
  ⧉ layer → ＋ strip → ＋ New clip → pose + key → 💾 Save rig.
  The clip lands on the **RIG**, so the rig is what must be saved — the tweak bar already says so.
  A strip whose clip the ACTOR does not know yet (freshly created, or renamed on the rig) now shows
  as `name (new — save the rig)` in the clip dropdown instead of silently falling back to the first
  option, which read as "the tool changed my clip".
  **Masks are for the OTHER case, and the UI now says so.** Measured while verifying: a sparse
  hand-authored clip needs no mask at all — spine's `MixBlend.replace` passes un-keyed properties
  through, so a clip only affects the bones it keys (removing the mask from a 2-bone override
  changed 0 of the other 71 bones). Masks earn their keep when an EXISTING full-body clip should
  drive only part of the rig; the empty-mask hint says exactly that now.
- **Mask controls in the tweak bar, and masked bones drawn on the stage.** The strip inspector is
  hidden while tweaking, and tweaking is the only place bones are visible and clickable — so
  picking mask bones from a 73-entry dropdown for something you cannot see was the whole problem.
  The tweak bar carries **◑ ＋ \<selected bone\>**, **◑ keyed** (mask to exactly what this clip
  keys — `includeChildren` OFF, because the keyed set is already the literal answer and expanding
  it would silently claim bones the author left to the layer below), a live count, and **✕**.
  `drawBonesOverlay` tints the masked bones in the accent colour and dims the rest, because a mask
  is otherwise invisible whenever the masked bones happen to be still.
- **Strip bone masks — a strip can now override PART of a skeleton (Phase 6, first slice).** The
  evaluator has masked `Animation.apply` since Phase 0 (snapshot-and-restore of the bones outside
  the mask, gate-tested); what was missing was any way to author one, so the capability was
  unreachable. The strip inspector now has a **mask** editor: a hierarchy-indented bone picker,
  the chosen roots as removable chips, **include children** (default ON — naming one bone and
  getting only that bone is never the intent), a **clear**, and a live count of what the mask
  really covers. The count calls the evaluator's own **`expandBoneMask`**, so the number shown and
  the bones actually posed cannot disagree. A masked strip is marked **◑** on the timeline, because
  a mask is otherwise invisible whenever the masked bones happen to be still.
  Two rules the editor states rather than leaves to be discovered: a mask on an actor's ONLY layer
  leaves the un-masked bones in their SETUP pose (nothing underneath to show through — the note
  points at ⧉ instead), and masks cover **bone transforms only**.
  **An empty mask is deleted, never stored as `{bones: []}`** — the evaluator reads that as "no
  mask", so keeping it would put a doc on disk that says something it does not mean. `types.ts`
  gained the `includeChildren` field it had always been missing (the evaluator read it; the type
  never declared it).
- **Tweak Mode (design §4.4) — the feature the tool was asked for.** Double-click a strip (or
  **✎ Tweak clip** in the strip inspector) and the EXISTING animator opens on that strip's clip:
  dopesheet, graph editor, ◆ Key, curves, bone outline, gizmo — while every other actor stays posed
  around it and the tweaked rig is posed AT ITS STAGE PLACEMENT. `Esc` / **✔ Done** leaves, and the
  rig is re-parsed on the way out so the strips immediately play the edit.
  **The shape that keeps it small:** cinematic mode STAYS ON (`cineMode` true, `animMode` turned on
  beside it), so every existing keying/posing path works unchanged and the sequencer keeps owning
  the frame. The cinematic drives four explicit bridge hooks per frame — `tweakPose` → `tweakDraw`
  (at the actor's place in the z order) → `tweakOverlays` → `tweakAfter` — rather than either side
  re-implementing the other. Total blast radius in `view.html`: the hook block, four one-line
  guards (`cineMode && !tweakMode`), and the two fixes below.
  **ONE CLOCK, and it is the cinematic's.** The animator's playhead is clip-local, the sequencer's
  is cinematic; every user seek in the animator funnels through `syncPlayhead`, which maps it back.
  The inverse mapping is **`cineTimeForLocal`, in the SHARED evaluator** next to `clipLocalTime` —
  deriving the trim/speed/loop maths locally in `cinematic.js` is exactly the drift the shared
  module exists to prevent. It resolves inside the loop repeat the playhead is already in (else a
  nudge on a `fill` strip teleports the shot back to cycle 0) and clamps to the strip window, so
  **only the part of the clip the strip shows is reachable while tweaking** — a named limit, not a
  bug. Mapping uses the clip's WORKING length, so a new last key is reachable.
  **The one subtle correctness rule: the root bone.** The stage rotation is applied ON TOP of the
  animated root rotation (that is what `applyPlace` means), so `keyBone` subtracts it for the root
  of a tweaked actor — without that, keying the root of a rotated actor bakes the actor's stage
  rotation into the clip, permanently and invisibly. `applyTweakPlace` therefore also runs BEFORE
  the `posingBone` override, or an in-progress root drag double-counts it.
  A tweak edits the **RIG**, not the cinematic — hence 💾 Save rig in the bar and the `unsaved`
  flag; saving the cinematic does not save it.
- **Property + camera tracks.** Actor **x / y / scale / rotation / alpha** are animatable: press ◆
  next to a field to key it at the playhead. Keys draw as colour-coded diamonds on their own
  timeline rows (drag to retime, Del to delete), and a key inspector exposes time, value and
  **outgoing interpolation** (linear / ease in-out / hold-stepped, drawn as a square like the
  dopesheet's stepped keys). The **camera** track is keyed from wherever the stage camera IS —
  frame the shot by panning and zooming, then press ◆ — with a **🎥 live toggle** so the track
  stops seizing the view while you navigate.
  Two rules worth knowing: (a) a channel with keys **owns** that property for the whole cinematic,
  holding its first/last value outside the keyed range, so the actor never jumps at the first key;
  (b) consequently, once a channel is animated, typing in its numeric field **keys at the
  playhead** instead of editing the static placement — otherwise the field would appear dead,
  since the channel overrides the static value on the very next frame. Fields track the playhead
  while scrubbing.
- **Undo / redo — `/rigger`'s first, and Phase 2's prerequisite.** ↶/↷ buttons + Ctrl+Z /
  Ctrl+Shift+Z / Ctrl+Y, with the action's name on the button. **Snapshot-based, not
  command-based**: a cinematic doc is a few KB of JSON, so storing whole states is correct by
  construction — there is no per-operation undo routine for a later phase to forget or get subtly
  wrong. (A command stack only pays off when the doc is too big to copy; that is the one seam to
  change if very long cinematics ever make it so.) Rapid edits to the same field **coalesce** into
  one step within 600 ms, so typing — and, in Phase 2, dragging a strip — undoes as one action;
  discrete actions (cast / remove / reorder) never coalesce. Scoped three ways so it cannot leak:
  only while the mode is active, never while focus is in a field (the browser's own text undo wins
  there), and `preventDefault` only when actually handled. It is deliberately cinematic-only — it
  cannot half-undo a rig edit — but nothing in it knows what a cinematic is beyond
  `serialize`/`applySnapshot`, so it is liftable to the rig editor.

### Gates + verification

| Proof | Result |
|---|---|
| `tools/rigger-spike/cinematic.mjs` — gates 1 + 2, channel sampling, cues, visibility, tweak-mode time inverse, evaluator-drift (headless) | **118/118** |
| `tools/rigger-spike/cinematic-pixi.mjs` — gate 3, the `spine-pixi-v8` seam | **14/14** |
| `static/rigger/cinematic-harness.html` — gate 2's WebGL half, in a real browser | **11/11** |
| `/rigger` cinematic mode, driven live in a browser | cast · draw · animate · scrub · place · z-order · visibility · clip-swap |
| Undo/redo, driven live in a browser | **22/22** — history semantics (10), keyboard scoping (7), stage re-pose + buttons (5) |
| Phase 2 sequencer, driven live in a browser | **35/35** — drag/trim/snap (11), inspector + layers (15), stage honours the authored strips (9) |
| Property + camera tracks, driven live in a browser | **36/36** — keying + channel rows (9), stage honours the channels (8), camera track + live toggle (12), key retime/ease/delete (7) |
| `tools/rigger-spike/cinematic-storage.mjs` — storage guards + the export/prune chain (headless) | **28/28** |
| `tools/rigger-spike/cinematic-flow.mjs` — the `playCinematic` node against the REAL interpreter + validator (headless) | **19/19** |
| R2 persistence client flow, driven live against a fake R2 with real etag semantics | **19/19** — create/update CAS, conflict prompt, force, new/open/rename/delete, draft |
| ＋ New clip + tweak-bar masks + overlay tint, driven live | **35/35** — the recipe end to end (8), the tweak-bar mask segment and its enable/disable states (8), ◑ keyed + ◑ ＋ bone (5), the overlay tint proved by readPixels (5), the exit round trip (5), and the authored doc through the real evaluator (4) |
| Strip masks, driven live in a browser against a real 73-bone rig | **31/31** — the editor (10), chips/roots/clear (7), undo + the two notes (6), authoring a two-layer stack (3), and the payoff: the authored doc through the real evaluator (5) |
| Tweak mode, driven live in a browser against a real 73-bone rig | **~55/55** — entry (11), the two-way clock (7), keying into the strip's clip (4), the exit re-parse (7), the root-rotation rule (5), Esc + ✎ Tweak clip + mode-switch exit (7), what is actually on the canvas (6), the three crashes below (8) |

Headless fixtures are real shipped rigs (`mm_bigwin` 86 bones, `anticipation` 73 bones); the
browser harness stages `anticipation` + `reelhouse_glow` — deliberately **different atlases**.

### What the gates established

- **Determinism (gate 1, the make-or-break).** `scrub(t) === play-to(t)` **bit-for-bit** over 427
  samples × 86 bones, across a two-layer stack with a crossfade, a `fill` loop and an additive
  `pingPong` layer. Re-evaluating the same `t` is idempotent and the pose is independent of the
  path taken to it. Scrubbing a cinematic is therefore honest, not an approximation.
- **The MixBlend rule, measured rather than assumed.** First non-additive strip → `setup`, later
  ones → `replace`, additive → `add` (and additive never consumes the "first" slot). Mutation
  testing showed the rule is **only load-bearing for the second strip onward** — for the first
  strip `setup` and `replace` are equivalent because the evaluator opens with `setToSetupPose()`.
  The decisive property: an alpha-0.5 layer lands exactly on `lerp(base, top, 0.5)` in local bone
  space (forcing every strip to `setup` misses it by ~570 units).
- **A layer passes through the base until its own first keyframe** (a `MixBlend.replace`
  property of spine-core, not something we implement). Partial-body layers therefore leave
  un-keyed properties alone instead of punching a setup-pose hole in the stack.
- **Looping is resolved into local clip time**, never handed to the runtime's own `loop` flag —
  which would wrap over the UNtrimmed duration and silently ignore `clipIn`.
- **Bone masks are snapshot-and-restore** of the bones outside the mask; `Animation.apply` has no
  mask parameter. v1 masks bone transforms only — slot colour / attachment / deform are not
  masked (a documented limit).
- **Two different-atlas rigs coexist (gate 2, data half)** — independent `SkeletonData`, no
  cross-talk, evaluation order irrelevant.
- **The in-game seam (gate 3)** — the `<Cinematic>` component's contract is:
  `autoUpdate = false` · `state.clearTracks()` · pose in **`beforeUpdateWorldTransforms`** ·
  `spine.update(dt)` per frame. Posing in the `after` hook renders the PREVIOUS pose (proved). An
  empty `AnimationState` is fully inert, so bypassing it needs no patched runtime. A leftover
  track cannot corrupt the pose (our `setToSetupPose()` discards it) but **does keep firing that
  clip's spine events every frame** — so `clearTracks()` is mandatory for *event* reasons, not
  pose reasons.

## Open items / next

1. **⏳ Tweak mode wants an owner eyeball on the WORKFLOW, not the mechanics.** Built and
   live-verified 2026-08-18 (see Recent changes), which settles that it works; what no assertion can
   judge is whether editing a clip with the rest of the shot playing around you actually *feels*
   like the ask. Two named limits to react to: only the part of a clip its strip shows is reachable
   from inside a tweak, and tweaking OPENS that rig in the editor (replacing whichever was open).

2. **⏳ KEEP RUNNING IT.** The first mount happened and immediately found a real bug (see Recent changes), which is the point. The whole engine half (`<Cinematic>`,
   `CinematicActor`, `<FlowV2Cinematics>`, the `playCinematic` interpreter case) has **never
   executed in a game**. It is verified by construction — gate 3 measured the `spine-pixi-v8`
   contract it implements — and by headless contract tests over the real modules, which is a
   different thing from working. The verification tooling simply is not there: this repo has **no
   `svelte-check`**, `.svelte` is invisible to `tsc`, and `apps/lines` cannot be type-checked here
   at all (`tsc` OOMs even at 8 GB). Author a cinematic, drop a **Play Cinematic** node on a
   screen, and watch it. Treat the first run as debugging, not confirmation.
3. **⏳ Live-verify the server chain against real R2 + Postgres.** Everything server-side is
   covered headlessly (28 assertions over the real modules against an in-memory R2), but
   `/api/cinematics/*` and `/api/editor/export-cinematics` have not run against the authed
   launcher. Save a cinematic, reload, open it, then publish and confirm `deploy/cinematics/`
   fills and the bundle carries `cinematics`.
4. **Remember `node scripts/sync-cinematic-eval.mjs`** after ANY evaluator change — the gate fails
   if the browser copy drifts, but nothing regenerates it automatically yet. Wiring it into a
   pre-build step would close that.
5. **⏳ Owner eyeball owed.** Every automated check above is a pixel/transform assertion — nobody
   has yet *looked* at two rigs staged together and judged that the art reads correctly (premultiply
   halos, relative scale between rigs authored at different atlas `scale:` factors). Open
   `/rigger` → 🎬 Cinematic, cast two rigs, and look.
6. **Non-rig content — FX / SFX / TEXT (design §12, owner-decided 2026-08-17).** (a) The **set
   picker** binding a cinematic to a Scene is DONE (see Recent changes). (c) **Rig-level text is
   DONE** — but as design **§12.4a** (localized ART: a key rasterised to atlas regions, then an
   ordinary region attachment), which SUPERSEDES the §12.4 point-attachment + sidecar plan listed
   here before. It lives in `/rigger`, so a cinematic casts it as part of any rig with no
   cinematic-side work; see [status/rigger](rigger.md) for its state and its owed live-verify.
   Still open: (b) `＋ Text` / `＋ FX` quick-add writing into the bound set (design §12.3, whose
   write-safety rules are recorded there), and **placed/persistent FX slots** (§12.4a's last
   paragraph). Note FX on a rig animation ALREADY works (event key → `fx.effectId` + bone); if
   authors cannot find it, that is discoverability, not a build.
7. Resolve design §9's open questions (doc scoping + template library, per-ratio, inline vs
   referenced set, flatten-to-`.irig` escape hatch).

## Blocked (owner / external)

- Nothing external.

## Recent changes

- 2026-08-19 — **"Edit my bones straight into cinematic, and not in a new window animate" (owner,
  third iteration on the same ask — and the first two answered the wrong half).** Tweak Mode gave the
  animator but as a SURFACE SWAP, which reads as leaving the cinematic, and it opened an EMPTY clip
  so there was nothing to pose against. **Inline posing**: ✎ on an actor's cast row draws its bones
  on the stage and turns on the animate toolbar, with the timeline, cast panel and playhead all
  staying put — you pose on top of the walk while it plays.
  **The first key builds the override.** No clip to pick, no strip to add: `keyBone` →
  `ensureCurAnim` → `ensureOverrideClip()` creates the layer, the strip at the playhead and the clip,
  then keys into it. Hooking `ensureCurAnim` is what makes every keying path (bone drag, ◆ Key,
  ◆ Key all, numeric fields) build it identically.
  **Auto-created overrides get blend ramps by default, and they are load-bearing** — a strip
  extrapolates `holdForward`, so an override with no blend-out holds its last frame for the rest of
  the cinematic and the character limps forever. The live test caught it; reading the code would not
  have. A blend-out takes alpha to 0 at the strip end, which both eases the move and ends it.
  Built as the SAME state as Tweak Mode with `inline: true` — it needs the same three things (a rig
  open, the lower layers posed underneath, the animator's keying paths); only the chrome differs,
  plus skipping the renderTimeline / syncPlayhead / tweakAfter branches that assume a dopesheet. One
  bug from that reuse, caught live: `renderTimeline`'s tweak guard also blocked the CINEMATIC
  timeline, so an auto-created strip did not appear until something else refreshed it.
  Tweak Mode, ✎ Tweak clip and ＋ New clip are all untouched — the owner asked to keep both routes
  until the shape settles, so nothing was removed yet.
  Verified live on the walk/misstep scenario (18 assertions): ✎ keeps the timeline and cast panel,
  no clip is open, the actor is posed by its own walk; one drag creates layer+strip+clip+key and the
  strip appears selected; un-posed bones keep walking and keep moving as you scrub; and after ✎ off
  the sequencer plays pure walk → override → pure walk, easing at both ends.

- 2026-08-19 — **You could stack an override but not SEE what you were overriding (owner: "I would
  like to create a track on top of an animation so I can modify that animation in the cinematic … a
  walk … at the 8th second I want to make my character legs misstep").** The structure already
  played that correctly — base loop on layer 0, a 2s strip on layer 1, blend in/out — but AUTHORING
  it was blind: `tweakPose` opened each frame with `setToSetupPose()`, so the stumble was keyed onto
  a T-pose instead of onto the stride it interrupts.
  **The tweak underlay** fixes it: the cinematic evaluates this actor's STRICTLY LOWER layers
  through the shared `evaluateActor` onto the editor's skeleton, and the tweaked clip lands on top
  exactly as the sequencer lands it. Clips resolve from the RIG EDITOR's `SkeletonData` (timelines
  address bones by index, and they are applied to the editor's skeleton — same parse or nothing).
  `poseAtTime` also learned the ADDITIVE form, so an additive override previews as base + offset.
  **And a real bug in tweak entry, found by the same test:** `beginTweak` did not assert that
  cinematic mode was still on. The guard lived in `openRigForTweak`, so it only fired on the path
  that OPENED a rig — anything else that knocked the mode out (a late `restoreRiggerState`
  re-selecting the rig after the author switched to 🎬 Cinematic) left `cineMode` false with every
  tweak flag true: `frame()` never delegates to the sequencer in that state, so the stage froze, the
  clocks stopped and the underlay never ran, while the UI insisted it was tweaking. The invariant is
  now asserted where tweaking turns ON, which is the only place that can guarantee it.
  Verified live on the owner's own scenario (24 assertions): a looping walk on layer 0, a 2s strip
  at 3s with 0.3s ramps on layer 1, ＋ New clip → key a leg. The walk poses under the override and
  keeps moving as you scrub; every un-keyed bone stays on the walk; additive vs replace land on
  different values and additive equals walk + offset to 0.01; and after ✔ Done the sequencer plays
  pure walk before the strip, the full stumble mid-strip, a partial value inside the ramp, and pure
  walk after it.

- 2026-08-19 — **Yesterday's cue-depth fix only worked if a Scene was bound (owner: "I can only move
  FX up and down on the cue and not in the timeline").** The depth row was gated on
  `doc.stage.sceneId`, but an `fx:` cue draws at that depth with or without a set — so the common
  case (fire an effect, no Scene bound) rendered NO row, no `▲▼`, and the effect stayed nailed behind
  every rig, while the cue inspector cheerfully said "move its 🎬 row in the timeline" about a row that
  was never emitted. Measured before the fix: `setRowInTimeline: 0`, `depthButtons: 0`.
  The row is the DEPTH BAND, so it is now emitted whenever anything draws in it — a bound Scene
  **or** any `fx:` cue — and it names what it actually is: **⚡ fx** with only cues, **🎬 set** once a
  Scene is bound (calling it "set" with no set names something the author never created).
  Also: at an in-between depth the row now states that **the preview can only show bands** (every rig
  is in one WebGL canvas, FX in another, so the overlay can sit above or below the whole cast but
  never between two rigs — the game honours the real depth). Without that line a correctly authored
  depth looks like a broken control, which is half of what this report was.
  Verified live with no Scene bound: the row appears with the first `fx:` cue, ▼ raises the overlay
  (`fxInFront` true, `setZ` 0), ▲ lowers it, undo restores it, and with two rigs the in-between
  position shows the preview caveat and drops it again at the top of the stack (17 assertions).

- 2026-08-18 — **The mask editor was a dead end on its own (owner: "what am I supposed to do once I
  add a bone? I do not see any bone in the canvas, I can't edit any bone anywhere, and I can't
  keyframe it").** Fair: a mask is a FILTER on a clip, not a place to author one, and the thing it
  filters — a clip holding the override — could not be created from inside the cinematic at all.
  Built the missing three:
  - **＋ New clip** on a strip — empty animation on the actor's rig, strip pointed at it, straight
    into Tweak Mode. The recipe is now one chain: ⧉ layer → ＋ strip → ＋ New clip → pose + key.
  - **Mask controls in the tweak bar** — ◑ ＋ \<selected bone\>, ◑ keyed (mask to exactly what this
    clip keys), a live count and ✕ — because tweaking is the only place bones are visible and
    clickable, and the strip inspector is hidden there.
  - **Masked bones drawn on the stage** — accent-tinted in the bone overlay, everything else dimmed.
  **And the honest finding that came out of verifying it:** a hand-authored override needs NO mask.
  Spine's `MixBlend.replace` passes un-keyed properties through, so a clip only affects the bones it
  keys — removing the mask from a 2-bone override changed 0 of the other 71 bones. Masks are for
  using only PART of an existing full-body clip, and the empty-mask hint now says so instead of
  implying every override needs one.
  Verified live end to end against a real 73-bone rig (35 assertions), including the overlay tint
  proved by `readPixels` and the authored doc run back through the real evaluator.

- 2026-08-18 — **A strip could only override the WHOLE skeleton (owner: "do I need to work more on
  this to have an animation override?").** Layers + `replace`/`additive` already gave a whole-rig
  override, and Tweak Mode gave editing-in-context, but the third reading — override just the upper
  body over a walk — had no UI at all, even though the evaluator has masked `Animation.apply` since
  Phase 0. Built the missing half: a **mask editor on the strip inspector** (hierarchy-indented bone
  picker → chips → `include children` → clear), a live count via the evaluator's own
  `expandBoneMask` so the number and the pose cannot disagree, and a **◑** marker on masked strips.
  See Current state for the two rules it states out loud (a mask on the only layer drops the rest to
  the setup pose; bone transforms only) and for why an empty mask is deleted rather than stored.
  Verified live end to end: authored a two-layer stack in the UI, masked the upper strip, then ran
  **the authored doc through the real evaluator** — 9 of 73 bones follow the upper clip while the
  other 64 stay byte-identical to the base, and the no-mask control confirms they would otherwise be
  overwritten. Gates unchanged (118/118): the mask SEMANTICS were already covered headless, which is
  exactly why this was UI-only work.

- 2026-08-18 — **Tweak Mode: "I am not sure how am I supposed to overwrite an animation" (owner).**
  Design §4.4, skipped when the build went Phase 1 → 2 → 3, and the closest thing to the original
  ask. Double-click a strip (or **✎ Tweak clip**) and the existing animator opens on that clip with
  the rest of the stage posed around it; `Esc` / ✔ Done re-parses the rig so the strips play the
  edit at once. See Current state for the shape, the one-clock rule and the root-bone rule.
  **Three PRE-EXISTING crashes fell out of building it** — each one a thing the sequencer or the
  animator could already do to itself, none of them introduced here:
  - **`stripById` walked keys-only tracks.** Only ANIMATION tracks carry `strips`; property /
    visibility / camera / cue tracks carry `keys`. Three loops dereferenced `.strips` for every
    track and it never bit, because they find what they want among the animation tracks *first* —
    they are created first, per actor. Cast an actor AFTER any actor was given a property or
    visibility track and a keys-only track sits ahead of the new strips: selecting or dragging that
    strip threw, and so did changing the cinematic's LENGTH (`setDuration` had the same loop).
  - **`sampleChannel` could not read a Spine-JSON default.** Spine JSON OMITS `time` on a keyframe
    at 0. Every reader here treats `k.time` as a number, and a channel whose ONLY key is written
    that way made the sampler walk off the end of the array — thrown from the animate frame loop,
    which kills ◆ Animate on that rig outright. Rigs SAVED by this tool always write the time,
    which is why it hid; the `anticipation` builtin has 37 such channels. Fixed once at load
    (`normalizeKeyTimes`), so the sampler, the dopesheet, key drag and `animDuration` all benefit.
  - **One empty slot took down `buildInspector`.** `slotsWithPath` passed a slot's setup
    `attachmentName` to `getAttachment`, which THROWS on null rather than returning nothing — so a
    rig with a slot that has no setup attachment (the `anticipation` builtin has two) broke every
    `setMode` on it, including leaving tweak mode.
  Verified live against a real 73-bone rig on two staged actors: entry by double-click and by
  button, the two-way clock through a `fill` loop, ◆ Key landing in the strip's clip at clip-local
  time, the exit re-parse (the sequencer's actor picks up the longer edited clip), the root-rotation
  rule (keying a rotated actor's root stores 25, not 55), Esc ordering against a key selection,
  mode-switch exit, and the canvas itself — the other actor's pixels are on screen while you tweak.

- 2026-08-18 — **The set is a LAYER, so an `fx:` cue can play in front of a rig (owner: "I can't
  change the layer of where the cue plays… it's always at the bottom").** A cue draws nothing
  itself — it broadcasts a name, and what answers is an effect node living in the bound **set**,
  which `FlowV2Cinematics` mounted *before* `<Cinematic>` with the comment "BEHIND the cast so the
  rigs play in front of their backdrop". That pinned every cue's effect under every rig, with no z
  anywhere to change. The set now carries **`stage.setZ`** on the SAME z line as the cast (it
  draws above every actor whose z ≤ setZ), the player mounts it spliced into the cast's draw order
  rather than beside it, and the timeline shows it as a 🎬 **set** row you move with ▲▼ — the same
  ▲ = "move behind" wording the cast list already uses. Absent `setZ` ⇒ `-1` ⇒ behind everything,
  so every existing cinematic renders byte-identically.
  **The preview can only show BANDS.** Every rig is drawn into one raw-WebGL canvas while FX is
  Pixi in a second one, so the overlay can sit above that canvas or below it — never sandwiched
  between two rigs inside it. `setFxDepth` flips it for the two cases it can represent (`#cv` at
  `z-index:1`, the overlay at 0 or 2, `#stage` isolated so those indices stay local); the game
  honours the real per-actor z. A finer preview needs one canvas per gap, which the ~16 WebGL
  context cap rules out — or a Pixi rewrite of the stage.
  Verified live on the real panel: the row lands at its z, ▲▼ clamp at both ends, the note reads
  "behind every rig" / "in front of 1 of 2 rigs" / "in front of every rig", the overlay canvas
  flips 0↔2, and undo/redo restores the depth. Caught in the act: the set row has no `track`, and
  the shared row preamble did `row.dataset.track = track.id` — cinematic mode failed to load
  entirely until that was guarded. Gates still pass (107/107, 39/39, 19/19).
- 2026-08-18 — **A cue could not be changed once it was set (owner).** The cue field was an
  `<input list=…>`, and a datalist FILTERS its options against what the field already holds — so
  the moment a cue read `fx:f_bottle` its dropdown collapsed to that single entry and the effect
  looked locked in. The inspector now carries a real **pick** `<select>` (every FX effect the
  project has, grouped, plus the `sfx:`/`music:`/`signal:` kinds) above the text field, and the
  select never filters: it lists everything whatever the cue currently is, with the current
  effect selected, or `✎ <cue> (typed)` at its head when the cue is a hand-typed name. Picking a
  KIND seeds its prefix into the text field and focuses it rather than committing a bare `sfx:`,
  which would only make an unfirable cue. Verified live over the real panel: full 7-option list
  after setting `fx:f_bottle`, switch to `fx:coin_burst` commits, `sfx:` seeds + focuses, and a
  typed `sfx:coin_drop` still shows the whole list so it can be switched back to an FX.
- 2026-08-17 — **Every game app's build was broken; only the launcher's stayed green.**
  `CinematicActor.svelte` imports `@esotericsoftware/spine-pixi-v8`, but `engine-layout` never
  declared it — so under pnpm's strict layout the module was simply not resolvable from that
  package, and `pnpm --filter <game> build` died on `Rollup failed to resolve import`. It hid for
  two reasons worth remembering: **`vite dev` still worked** (dev resolution walks up to the
  workspace root, the production bundler does not), and the one app that *did* build — the
  launcher — declares the dep itself, so the surface everyone was live-verifying on stayed green
  while all six of `lines`/`cluster`/`scatter`/`ways`/`number-picker`/`price` were dead. Fixed by
  declaring the dep on `engine-layout` at `4.2.74`, the same pin `pixi-svelte` carries, so both
  symlink to ONE `.pnpm` entry — a second copy would be a second Spine runtime and would quietly
  break every `instanceof SPINE.X` check in the engine. Rule this earns: **a package that imports
  a module must declare it**, and a green `dev` (or a green launcher) is not evidence the games
  build.
- 2026-08-17 — **The Frame picker showed the WRONG sizes** (owner: "the frames are not the same
  that I have set in the admin"). It read `doc.mainSizesMap` straight off the editor doc, which
  skips the admin layer entirely — so the Rigger drew the coded defaults while the Scene Editor
  drew the sizes the admin had configured. Two tools, two answers, from one question. It now goes
  through **`resolveLayoutProfile`**, the canonical resolver (project override → admin global →
  coded default) + `bucketBoxMap`, exactly like every other consumer. The picker also reports
  WHICH layer its sizes came from in its tooltip, so the next mismatch of this kind is legible
  instead of mysterious. Lesson worth keeping: when a value has a documented resolver, reading
  the underlying store is not a shortcut — it is a different answer.
- 2026-08-17 — **FIRST REAL GAME MOUNT: "the rigs are there but nothing moves" (owner).** The
  player's first run in a game found the bug the headless gate structurally could not.
  `<CinematicActor>` set `spine.autoUpdate = false` — the obvious reading of "we drive the pose
  ourselves" — which stops Pixi running its own update+render pass for that Spine. The bones were
  posed every frame and the geometry was never re-uploaded, so the rigs mounted, held their setup
  pose, and never changed. **`autoUpdate` now stays ON**, which is safe for exactly the reason
  gate 3 established: an emptied `AnimationState` is fully inert, so Pixi's own per-frame
  `update(dt)` runs two no-ops, then our `beforeUpdateWorldTransforms` hook, then
  `updateWorldTransform` — the pose we want, through the dirty path that actually re-renders. The
  manual `spine.update(0)` effect is gone with it (Pixi ticks every frame, and the hook reads
  `time` live, so a scrubbed or paused cinematic still re-poses).
  **This closes the "gate 3 residual" live check** that had been open since Phase 0 — and it
  landed exactly where that item predicted: "headless proof cannot show that Pixi re-uploads the
  geometry and the frame visibly changes." The limitation is now written at the top of
  `cinematic-pixi.mjs` so the next person does not trust it beyond the pose contract.
- 2026-08-17 — **Screen-frame guide (owner: "cinematics will mostly be based on the screen
  ratio").** A **Frame** picker draws the game canvas box on the stage — the project's authored
  `mainSizesMap` per layout, the same box the Scene Editor composes in, so what you frame is what
  the player sees. Origin = screen centre, which is also where a freshly cast actor lands, and a
  faint centre cross marks it. Served by the existing `/api/editor/scenes` (it already loads the
  doc, so no new endpoint), stored on `stage.ratio`, undoable. It draws on an EMPTY stage too —
  the actor-count bail was removed, since framing a shot is exactly what you do before casting.
  11 live checks, including that the drawn aspect MATCHES the authored box in both layouts.
  A caught-in-testing note: a lit-pixel COUNT cannot distinguish 1280×720 from 720×1280 (equal
  perimeters), so the assertion measures the lit bounding box — the same class of invariant-metric
  mistake as the earlier translation-blind centroid.
- 2026-08-17 — **Set picker (design §12.3 step 1) + two silent-failure fixes.** A cinematic can
  now BIND to a Scene: the picker lists the project's scenes (`/api/editor/scenes`, gated like
  `/api/editor/effects`), stores `stage.sceneId`, and the in-game `<FlowV2Cinematics>` mounts
  that scene via `LayoutScene` BEHIND the cast — so set content renders through the game's one
  renderer, resolved by the flow runtime's own `resolveScene` (no second scene registry). A set
  the project no longer has is flagged, not silently dropped. Two bugs found while verifying:
  1. **Both pickers stayed empty.** The scene and effect lists are fetched WITHOUT awaiting (so a
     slow list never delays the tool opening), but nothing re-rendered when they landed — so they
     filled in only if some unrelated edit happened to rebuild the panel.
  2. **🗑 Delete did nothing, silently** (owner-reported). It bailed early when the doc was not in
     the cached list, with no message. It now says why it declined, no longer treats a stale
     cache as a reason to refuse, and surfaces a failed delete.
  9 live checks over the real panel cover both, end to end through save → delete.
- 2026-08-17 — **Cinematic mode hides the RIG-only controls (owner: "why do we have 2 saves?").**
  The mode swapped the left panel and the right column but left the rig editor's own chrome on
  screen, so THREE Save buttons were visible at once — 💾 Save (the rig), 📦 Save rig to library,
  and the cinematic's. Worse than duplication: pressing the wrong one saves a different document.
  Cinematic mode now hides the rig save/export group, the rig-management row (New rig / Load
  spine / Save rig to library / Re-sync atlas), and the Anim/Skin pickers + bone/mesh/bounds
  toggles (the per-actor clip lives in the cast list, and those overlays are not drawn by the
  cinematic frame path anyway). Play/loop/speed/Reset view and the project selector stay. 7 live
  checks, including that exactly one Save is on screen in the mode and everything comes back on
  leaving it.
- 2026-08-17 — **Chasing the save failure: the storage layer is EXONERATED, the endpoint now
  reports why.** 11 new assertions (39/39) drive the real `cinematicStorage` against a fake R2
  implementing R2's actual conditional-write rules, using the exact document the tool emitted in
  the failing session (cast + animation strip + cue track + camera track). The create path
  (`baseEtag: null` ⇒ `ifNoneMatch:*`), the CAS update, both refusal cases, the listing and the
  round trip all pass — so the bug is NOT in the storage layer, the key builder, or the shape
  guard. Two hypotheses were checked and dropped: R2 not supporting `If-None-Match` (it does, and
  the editor/config tools already use the create path), and the doc failing `isCinematicDoc`.
  What remains is the endpoint wrapper (gate / scope guard) or the environment — so the save
  endpoint no longer lets an unexpected throw become SvelteKit's opaque HTML 500: it returns the
  real message as JSON, which the tool shows in its error bar. **The cause is still unknown**;
  the next failing click will name it.
- 2026-08-17 — **First live-verify feedback (owner) — usability fixes.** Three of the four
  reports were real:
  1. **A failed save looked like nothing happened.** The failure only ever reached a thin status
     line, so an author clicked Save, saw the doc still marked ● unsaved, and had no way to tell
     a permission error from a validation one. Save AND open failures now go to the tool's red
     error bar with the HTTP status and the response body (including the raw text when the
     response was an HTML error page — exactly the case where the friendly message is missing),
     and log to the console. **This is diagnosis, not a fix**: the underlying save failure the
     owner hit is still unexplained, and the next attempt will now say why.
  2. **Cues could not be picked, only remembered.** The datalist offered namespace PREFIXES but
     no actual values, so an author had to know effect ids by heart. It now lists the project's
     authored FX effects (`/api/editor/effects`, already `rigger`-gated) while still accepting
     free text — `sfx:`/`signal:` names resolve in systems this tool cannot enumerate.
  3. **The right-hand Properties column was dead.** It read "select a bone or slot" over an empty
     column while every cinematic inspector was crammed into the 280px left panel. The selected
     strip / key / cue now renders there.
  10 live checks over the real panel confirm each. The fourth report — "how do I overwrite an
  animation" — is **Tweak Mode, which is genuinely unbuilt** (design §4.4); see Open items.
- 2026-08-17 — **Visibility tracks — Phase 2 is complete.** Every track kind the schema names
  (`animation`, `property`, `camera`, `cue`, `visibility`) is now implemented. 10 new assertions
  (107/107) pin the semantics, the load-bearing one being that a keyed track holds its FIRST key
  backwards in time rather than falling back to the static toggle — otherwise an actor keyed
  hidden-then-shown would flash on for frame 0, which is exactly what someone keying visibility
  is trying to prevent.
- 2026-08-17 — **Cue tracks — the last Phase 2 surface.** Authorable ⚡ cues, fired through the
  shared `cuesCrossed` (which existed and was gate-tested since Phase 0 but had no caller until
  now), routed game-side to FX / sound / the event bus. 10 new assertions (97/97) pin the
  semantics that matter: the half-open window, same-beat cues both firing, and — the one that
  makes scrubbing usable — **a seek fires nothing**, neither backwards nor on a jump bigger than a
  frame. One of my own assertions was wrong first: I asserted three cues firing across a 0.65 s
  window, which `cuesCrossed` correctly treats as a SEEK. Simultaneous cues sit milliseconds
  apart in practice, so the test now says that instead.
- 2026-08-17 — **Flow-v2 `playCinematic` — the pipeline closes.** A cinematic can now be played
  from an authored flow (details in Current state). 19 headless assertions drive the node through
  the REAL interpreter + validator with an env whose completion promise the test controls, so
  "did the chain actually wait?" is observed rather than assumed: `awaitComplete` holds the chain
  and releases in the order play → completed → cue; without it the chain continues immediately;
  a looping play never hangs even when a doc carries the invalid `loop`+`await` pair; and `stop`
  settles a pending await instead of stranding it. This also SETTLES the long-open Flow Phase 7
  overlap by construction: Flow *plays* cinematics, it does not grow its own timeline.
- 2026-08-17 — **The player + the evaluator's graduation.** `packages/engine-cinematic` is now the
  single source of the blend/sampling maths; the launcher's `static/shared/cinematicEval.mjs` is a
  GENERATED verbatim copy and a new gate assertion (87/87) fails if the two drift — verified
  negatively by appending a line and watching both the gate and `--check` fail, then recover.
  `<Cinematic>` + `CinematicActor` (in `engine-layout/svelte`) play a cinematic in-game off the
  Pixi ticker, implementing gate 3's measured `spine-pixi-v8` contract. **Verified by construction,
  not by execution:** the components compile under the Svelte compiler and `engine-layout`
  type-checks clean, but there is no `svelte-check` in this repo, `.svelte` is invisible to `tsc`,
  and `apps/lines` cannot be type-checked here at all. The first real mount should be treated as
  debugging.
- 2026-08-17 — **Phase 3 part 2: the ship chain's data half** (details in Current state). 12 new
  headless assertions (28/28) driving the REAL export module against an in-memory R2 — deploy
  mirroring, pruning a cinematic deleted since the last export, un-authored ⇒ nothing embedded, and
  project isolation. **The important find was a latent data-integrity bug in what Phase 1 shipped:**
  the cast stored `rigId`, which is `SkeletonIndexEntry.id` — a contiguous array position
  reassigned on every skeleton scan. Adding or renaming any rig would have silently re-pointed
  every saved cinematic at a different rig. Identity is now the rig FOLDER (stable, and the spine
  bundle name), with a best-effort migration for docs saved before the fix.
- 2026-08-17 — **Phase 3 part 1: R2 persistence** (details in Current state). A cinematic now
  survives the browser. 16 headless assertions on the storage module's pure logic (path-guarding
  a user-supplied id, and a shape guard that rejects junk without rejecting documents a NEWER
  client wrote) plus 19 live client checks driven against a fake R2 with **real etag semantics** —
  create-vs-update preconditions, the 409 conflict prompt, force-overwrite, and new/open/rename/
  delete. Two real bugs found by running it: the save posted no `projectKey`, which made the
  server's scope-mismatch guard dead code (the bridge now exposes it), and `＋ New` never wrote
  the local draft, so a reload right after would resurrect the previous cinematic. A third was
  caught by **type-checking** rather than at runtime — `putObjectText` returns the etag directly,
  not an object, and this repo's `build` is famously not a type-check.
- 2026-08-17 — **Property + camera tracks** (details in Current state). The sampling lives in the
  SHARED evaluator (`sampleChannel` / `sampleTrack` / `resolvePlace` / `putKey`), not in the
  editor, so the in-game player will interpolate identically — same rule as the blend maths.
  21 new headless assertions (85/85) plus 36 live checks, including that the stage genuinely
  honours the channels: a linear x channel lands the actor on the exact linear midpoint, a `hold`
  key makes the segment stepped **on the rendered stage**, alpha fades continuously rather than
  binary, and the camera track drives the view while the 🎥 live toggle hands it back. Two of my
  own assertions were wrong first: the default `*_intro` clip renders NOTHING at t=0, so an empty
  frame poisoned two baselines — the probe now reports an empty frame as `null` rather than a
  `cx` of 0, which is what let it pass unnoticed.
- 2026-08-17 — **Phase 2: the track/strip sequencer** (details in Current state). 35/35 live
  checks, including that the stage genuinely honours the authored strips — a strip starting at
  2 s leaves the actor at its setup pose before then, holds its last frame after the end
  (`holdForward`), and an additive layer at alpha 0.6 renders differently from the same layer at
  alpha 0, which in turn is **bit-identical** to having no layer at all. One bug found only by
  running it: on the FIRST entry to cinematic mode the timeline drew empty, because `setMode`
  calls `renderTimeline()` synchronously while `cinematic.js` is still lazy-loading — earlier
  tests missed it because they cast actors *after* entering the mode. `init()`/`activate()` now
  render it themselves. Also made `setPointerCapture` non-fatal: it throws for a pointer id the
  browser does not know, and capture is an optimisation, never a requirement for the gesture.
- 2026-08-17 — **Undo/redo — the first command history anywhere in `/rigger`.** Snapshot-based,
  coalescing, mode-scoped (details in Current state). 22/22 live checks, including the two that
  matter for a keyboard shortcut: Ctrl+Z inside a text field is left to the browser, and the keys
  are fully disarmed outside cinematic mode. Verified that undo re-poses the **stage** (rendered
  centroid returns), not just the document. Casting an actor is deliberately ONE step even though
  it writes both a cast entry and a default clip.
- 2026-08-17 — **Phase 1 shipped: `/rigger` 🎬 Cinematic mode**, verified live in a browser
  (not just built). Three real bugs surfaced only by running it, none of which a syntax or type
  check could reach:
  1. **An rAF-polled asset wait hangs forever when the tab is not painting.** `requestAnimationFrame`
     is suspended in a background/offscreen context, so the load never completes and never fails.
     The new `loadRigData` polls with `setTimeout` instead (the pre-existing `waitAssets` still
     uses rAF — fine in a visible tab, and left alone).
  2. **Cinematic mode entered from a cold `/rigger` had no runtime at all.** `SPINE` and `gl` are
     created lazily by `selectSkeleton`, so casting a rig with no rig open threw "Cannot read
     properties of null (reading 'AssetManager')". Fixed by `ensureStageRuntime()` — and the
     bridge now exposes `SPINE` as a **getter**, since a value captured at init time freezes at
     null forever.
  3. **`resolveClip` received an actor with no `skeletonData`** because `evaluate()` built a fresh
     `{skeleton, tracks}` object per frame. Now each actor caches an `evalTarget` carrying
     `skeletonData` (also removing a per-frame allocation). The browser harness could not have
     caught this — its actor objects already carried the field.
- 2026-08-17 — **Gate 2's WebGL half CLOSED** via `static/rigger/cinematic-harness.html` (11/11):
  two rigs on two distinct GL textures composite in one stage, each atlas contributes its own
  pixels (`readPixels`-verified, not a screenshot), and the shared evaluator is deterministic
  **in-browser against the vendored minified runtime** — the exact gap that has produced
  browser-only Rigger bugs before.
- 2026-08-17 — **Phase 0 gates passed** (`cinematic.mjs` 64/64, `cinematic-pixi.mjs` 14/14) and
  the evaluator core landed. Two gate assertions were wrong on first write and were corrected
  against the runtime's real behaviour, not the other way round: (a) a `count:N` freeze is
  unreachable when the strip length exactly equals `N ×` the clip, and (b) comparing a layered
  pose against "the clip evaluated alone" reports false deviations for properties whose timeline
  has not reached its first key. Both are recorded as findings above.
