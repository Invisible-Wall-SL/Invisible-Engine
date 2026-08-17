# Invisible Cinematic — status

> Design: [docs/design/invisible-cinematic.md](../design/invisible-cinematic.md) · Guide: _none yet (unbuilt)_ · Agent: _none yet_

**One-line state:** **Phases 0–2 done and verified live** (2026-08-17) — `/rigger` has a 🎬
**Cinematic** mode: cast several rigs from different atlases onto one stage, place them, and
author their animation as **tracks of strips** you drag, trim, loop, layer and blend. Next is
Phase 3, the rule-8 ship chain (R2 persistence + the in-game player).

## Current state

- **`/rigger` cinematic mode (Phase 1).** A fourth mode next to Preview / Setup / Animate. Cast a
  rig from the project as an **actor** (the same rig can be cast twice — independent instances),
  place it (x / y / scale / rotation / flip), set its draw order, toggle its visibility, give it a
  clip, and scrub or play the whole stage. Reachable with **no rig open** (it boots the spine
  runtime + GL itself). Lives in `static/rigger/cinematic.js`; the rig editor's blast radius is
  four small hooks in `view.html` (mode button, `setMode` branch, `frame()` branch, lazy loader)
  plus an early-return in `mousedown` so no bone/mesh branch runs on a multi-actor stage.
  Doc autosaves to `localStorage` — **R2 persistence + the ship chain are Phase 3**.
- **`static/shared/cinematicEval.mjs`** — the layered strip evaluator: `clipLocalTime`
  (clipIn/clipOut trim · speed · once/count/fill/pingPong · extrapolation), `blendEnvelope`
  (blend-in/out ramps × alpha), `evaluateActor` (layer stack, additive, bone masks) and
  `cuesCrossed` (edge-triggered cues). **Exactly one copy**, under `static/` because that is the
  only place all consumers reach: the browser loads it as `/shared/cinematicEval.mjs` and the
  headless gates import it across the repo. Graduates to `packages/engine-cinematic/` in Phase 3.
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
| `tools/rigger-spike/cinematic.mjs` — gates 1 + 2 (headless) | **64/64** |
| `tools/rigger-spike/cinematic-pixi.mjs` — gate 3, the `spine-pixi-v8` seam | **14/14** |
| `static/rigger/cinematic-harness.html` — gate 2's WebGL half, in a real browser | **11/11** |
| `/rigger` cinematic mode, driven live in a browser | cast · draw · animate · scrub · place · z-order · visibility · clip-swap |
| Undo/redo, driven live in a browser | **22/22** — history semantics (10), keyboard scoping (7), stage re-pose + buttons (5) |
| Phase 2 sequencer, driven live in a browser | **35/35** — drag/trim/snap (11), inspector + layers (15), stage honours the authored strips (9) |

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

1. **Phase 3 — the rule-8 ship chain** (design §6): R2 persistence for the `.icin` (it is
   `localStorage`-only today, so a cinematic does not survive a different browser), then
   export → `deploy/` → bake → pull → register, the `<Cinematic>` engine component, and the
   Flow-v2 `playCinematic` node. **Nothing authored here reaches a game until this lands.**
2. **Phase 2 remainder** — the track kinds that are still animation-only: **property** tracks
   (actor x/y/scale/alpha over time — today placement is a static per-actor value), **camera**,
   **visibility** and **cue** tracks. The doc schema already names them (design §4.2); only the
   `animation` kind is implemented.
3. **⏳ Live check owed (gate 3 residual).** Headless proof cannot show that Pixi re-uploads the
   geometry and the frame visibly changes. Drive one spine object through the `<Cinematic>`
   contract in a real game frame before Phase 3 leans on it.
4. **⏳ Owner eyeball owed.** Every automated check above is a pixel/transform assertion — nobody
   has yet *looked* at two rigs staged together and judged that the art reads correctly (premultiply
   halos, relative scale between rigs authored at different atlas `scale:` factors). Open
   `/rigger` → 🎬 Cinematic, cast two rigs, and look.
5. **Pick the set.** Phase 1 casts rigs directly (`cast[].nodeId` is null). Design §4.1 has the
   cinematic binding tracks to an existing **Scene**'s nodes — the Scene picker, and art / text /
   FX / sound actors, land with it.
6. **Decide the Flow-v2 Phase 7 overlap explicitly** — Flow *plays* cinematics, or we ship two
   sequencers with two doc formats (design §7 risk 3). See [status/flow](flow.md) open item 7.
7. Resolve design §9's open questions (doc scoping + template library, per-ratio, inline vs
   referenced set, flatten-to-`.irig` escape hatch).

## Blocked (owner / external)

- Nothing external.

## Recent changes

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
