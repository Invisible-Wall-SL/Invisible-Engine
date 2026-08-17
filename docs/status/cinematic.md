# Invisible Cinematic — status

> Design: [docs/design/invisible-cinematic.md](../design/invisible-cinematic.md) · Guide: _none yet (unbuilt)_ · Agent: _none yet_

**One-line state:** **Phases 0–3 done bar the Flow node** (2026-08-17) — `/rigger`'s 🎬
**Cinematic** mode stages several rigs, authors them as tracks of strips + property/camera keys,
saves to R2 per project, travels the ship chain with the rigs it casts, and has an in-game
**`<Cinematic>` player** driven by the same evaluator. The one piece left is the Flow-v2
**`playCinematic` node** — until it lands, a game can play a cinematic from code but not from an
authored flow. **⏳ None of the engine side has run in a real game yet** (see Open items).

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
  contract per rig — `autoUpdate = false`, `state.clearTracks()` (mandatory for EVENT reasons: a
  leftover track keeps firing that clip's spine events every frame), pose in
  `beforeUpdateWorldTransforms` (the `after` hook renders the PREVIOUS pose), `spine.update(dt)` —
  and restores the rig on destroy. Driven by the Pixi ticker, not its own rAF, so a paused game
  pauses the cinematic.
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
| `tools/rigger-spike/cinematic.mjs` — gates 1 + 2 + channel sampling + evaluator-drift (headless) | **87/87** |
| `tools/rigger-spike/cinematic-pixi.mjs` — gate 3, the `spine-pixi-v8` seam | **14/14** |
| `static/rigger/cinematic-harness.html` — gate 2's WebGL half, in a real browser | **11/11** |
| `/rigger` cinematic mode, driven live in a browser | cast · draw · animate · scrub · place · z-order · visibility · clip-swap |
| Undo/redo, driven live in a browser | **22/22** — history semantics (10), keyboard scoping (7), stage re-pose + buttons (5) |
| Phase 2 sequencer, driven live in a browser | **35/35** — drag/trim/snap (11), inspector + layers (15), stage honours the authored strips (9) |
| Property + camera tracks, driven live in a browser | **36/36** — keying + channel rows (9), stage honours the channels (8), camera track + live toggle (12), key retime/ease/delete (7) |
| `tools/rigger-spike/cinematic-storage.mjs` — storage guards + the export/prune chain (headless) | **28/28** |
| R2 persistence client flow, driven live against a fake R2 with real etag semantics | **19/19** — create/update CAS, conflict prompt, force, new/open/rename/delete, draft |

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

1. **The Flow-v2 `playCinematic` node** — the last authored-pipeline piece: a node with a `play`
   exec in and a `complete` exec out (wired to `<Cinematic>`'s `oncomplete`, which already exists
   for it), so a screen can play a cinematic and await it. Needs the `engine-flow-v2` vocabulary
   entry, the interpreter case, and the palette/inspector. Until then a game can mount
   `<Cinematic>` from code but a flow cannot drive one.
2. **⏳ THE ENGINE SIDE HAS NEVER RUN.** `<Cinematic>` + `CinematicActor` are Svelte-compiler
   clean and `engine-layout` type-checks clean, but this repo has **no `svelte-check`**, `.svelte`
   files are invisible to `tsc`, and `apps/lines` cannot be type-checked here at all (`tsc` OOMs
   even at 8 GB). So the player is verified by construction — gate 3 measured the runtime contract
   it implements — and NOT by execution. Mount it in a game and watch a cinematic play before
   relying on it; treat the first run as debugging, not confirmation.
3. **⏳ Live-verify the server chain against real R2 + Postgres.** Everything server-side is
   covered headlessly (28 assertions over the real modules against an in-memory R2), but
   `/api/cinematics/*` and `/api/editor/export-cinematics` have not run against the authed
   launcher. Save a cinematic, reload, open it, then publish and confirm `deploy/cinematics/`
   fills and the bundle carries `cinematics`.
4. **Remember `node scripts/sync-cinematic-eval.mjs`** after ANY evaluator change — the gate fails
   if the browser copy drifts, but nothing regenerates it automatically yet. Wiring it into a
   pre-build step would close that.
5. **Phase 2 remainder** — **visibility** and **cue** tracks (named in the schema, design §4.2;
   `animation`, `property` and `camera` are implemented). Visibility is a static per-actor toggle
   today; cues are the `fx:` / `sfx:` / `signal:` surface and are best built alongside the Flow
   wiring in Phase 3.
6. **⏳ Live check owed (gate 3 residual).** Headless proof cannot show that Pixi re-uploads the
   geometry and the frame visibly changes. Drive one spine object through the `<Cinematic>`
   contract in a real game frame before Phase 3 leans on it.
7. **⏳ Owner eyeball owed.** Every automated check above is a pixel/transform assertion — nobody
   has yet *looked* at two rigs staged together and judged that the art reads correctly (premultiply
   halos, relative scale between rigs authored at different atlas `scale:` factors). Open
   `/rigger` → 🎬 Cinematic, cast two rigs, and look.
8. **Pick the set.** Phase 1 casts rigs directly (`cast[].nodeId` is null). Design §4.1 has the
   cinematic binding tracks to an existing **Scene**'s nodes — the Scene picker, and art / text /
   FX / sound actors, land with it.
9. **Decide the Flow-v2 Phase 7 overlap explicitly** — Flow *plays* cinematics, or we ship two
   sequencers with two doc formats (design §7 risk 3). See [status/flow](flow.md) open item 7.
10. Resolve design §9's open questions (doc scoping + template library, per-ratio, inline vs
   referenced set, flatten-to-`.irig` escape hatch).

## Blocked (owner / external)

- Nothing external.

## Recent changes

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
