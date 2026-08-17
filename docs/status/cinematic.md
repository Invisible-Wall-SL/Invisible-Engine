# Invisible Cinematic — status

> Design: [docs/design/invisible-cinematic.md](../design/invisible-cinematic.md) · Guide: _none yet (unbuilt)_ · Agent: _none yet_

**One-line state:** **Phase 0 PASSED** (2026-08-17, headless) — the layered strip evaluator is
deterministic bit-for-bit on real rigs, two different-atlas rigs coexist, and the in-game
integration seam with `spine-pixi-v8` is proved. Phase 1 (set + cast) is next; one live check is
owed (below).

## Current state

No tool surface yet — `/rigger` still edits one skeleton / one clip / one playhead. What exists
on `main` is the **evaluator core + its gates**:

- **`tools/rigger-spike/cinematicEval.mjs`** — the layered strip evaluator: `clipLocalTime`
  (clipIn/clipOut trim · speed · once/count/fill/pingPong · extrapolation), `blendEnvelope`
  (blend-in/out ramps × alpha), `evaluateActor` (layer stack, additive, bone masks) and
  `cuesCrossed` (edge-triggered cues). Dependency-free and runtime-injected, so **one copy**
  serves the headless gate, the `/rigger` preview against the vendored minified runtime, and the
  engine against `spine-pixi-v8`. Graduates to `packages/engine-cinematic/` in Phase 3.
- **`tools/rigger-spike/cinematic.mjs`** — gates 1 + 2, **64/64**.
- **`tools/rigger-spike/cinematic-pixi.mjs`** — gate 3, **14/14**.

Fixtures are real shipped rigs: `mm_bigwin` (86 bones, intro/idle/exit clips) and
`anticipation` (73 bones) — deliberately from **different atlases**.

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

1. **⏳ Live check owed (gate 3 residual).** Headless proof cannot show that Pixi re-uploads the
   geometry and the frame visibly changes. Drive one spine object through the contract above in a
   real game frame before Phase 3 leans on it.
2. **⏳ Live check owed (gate 2, WebGL half).** Two rigs from different atlases in ONE `/rigger`
   stage: z-order and premultiplied-alpha correctness are inherently visual. Folds into Phase 1.
3. **Phase 1 — set + cast** (design §8): cinematic mode shell, pick a Scene as the set, its nodes
   as cast, multi-actor stage. Needs the `/rigger` change in design §5 — the module-level
   `skeleton` / `animState` / `curAnim` singletons become an actor array.
4. **Decide the Flow-v2 Phase 7 overlap explicitly** — Flow *plays* cinematics, or we ship two
   sequencers with two doc formats (design §7 risk 3). See [status/flow](flow.md) open item 7.
5. **Undo/redo in `/rigger`** — no command stack exists in `view.html` today; a **prerequisite of
   Phase 2** (dragging strips without undo is unusable).
6. Resolve design §9's open questions (doc scoping + template library, per-ratio, inline vs
   referenced set, flatten-to-`.irig` escape hatch).

## Blocked (owner / external)

- Nothing external.

## Recent changes

- 2026-08-17 — **Phase 0 gates passed** (`cinematic.mjs` 64/64, `cinematic-pixi.mjs` 14/14) and
  the evaluator core landed. Two gate assertions were wrong on first write and were corrected
  against the runtime's real behaviour, not the other way round: (a) a `count:N` freeze is
  unreachable when the strip length exactly equals `N ×` the clip, and (b) comparing a layered
  pose against "the clip evaluated alone" reports false deviations for properties whose timeline
  has not reached its first key. Both are recorded as findings above.
