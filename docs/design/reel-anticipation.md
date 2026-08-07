# Reel anticipation — a client-computed, escalating tease mode

> Status: SHIPPED (2026-08-05). All phases (0–5) merged to `main` in PR #229 and runtime-released
> to the shared `_runtime/lines` bundle (online `bookofborutremake`). Off by default → byte-parity
> when unauthored, the same discipline as
> [sequential reel stop](../../packages/utils-slots/src/createEnhanceBoardSpin.ts). Author it via the
> Flow `enableAnticipationMode` effect (`/flow-v2`) and tune the per-tier FX in `/symbols`.
> Follow-ups: the animated hold still wants a human eyeball in a foreground tab (rAF is frozen
> headless); the standalone `bookofborut` (own bundle) needs an engine-submodule bump to receive it.

## The ask

Add reel **anticipation** as a swappable **mode** (like sequential reel stop — enable/disable +
signal-driven), but a much richer one than Stake's built-in:

- **Client-computed from the final board**, not a server `anticipation[]` flag.
- **Per reel column.** As reels settle one by one, decide per reel whether a qualifying win is
  still reachable from the reels not yet stopped.
- **Self-arming:** activate the moment a possible win can still trigger.
- **Self-disarming:** deactivate the instant no more qualifying win can be triggered.
- **Stacking / escalating FX:** each new win-possibility adds a layer — more anticipation spines,
  screen FX, and a zoom-in on the reels for suspense.
- **Tier-gated:** only arm once the _reachable_ win reaches the smallest **big-win tier**; add
  more FX for mega / massive. Ties into the config-authored `winLevels` tiers.
- **Grey-out** the reels we are NOT anticipating on.
- **Authored from Flow** (via the presentation state machine) with the per-reel overlay + FX
  configured in the **Symbols SM editor**.

This is the classic reel-tease mechanic (Gates of Olympus slowing the last reels, Book-of games
teasing the 3rd book). Stake's SDK ships only a thin, server-driven, binary version of it.

## What exists today (and why it's not enough)

- The RGS book carries `revealEvent.anticipation: number[]` — one flag per reel
  (`apps/lines/src/game/typesBookEvent.ts`).
- `createEnhanceBoardSpin.ts` reads it: from the first anticipated reel onward it sets `noStop`,
  and as each reel lands (`onSpinFinishing`) it arms `reelState.anticipating = true` on the NEXT
  reel.
- `Anticipations.svelte` / `Anticipation.svelte` render **one fixed spine overlay + one looping
  SFX** per anticipating reel. No stacking, no tiers, no zoom, no grey-out, no client calculation.
- `sequentialReelStop` is the mode template to copy: `enable/disableSequentialReelStop` effects
  (`flowEffects.ts`), v2 vocab palette entries (`engine-flow-v2/src/reference/bookOf.ts`), and
  `stateGame` flags, all off by default.

The gap: everything above is **server-driven and binary**. The new mode is **client-computed,
graded, and escalating**.

### Decision — remove the server `anticipation[]` path entirely (one method, not two)

Two independent methods (a server flag AND a client calc) would be confusing, and the server one is
already effectively **dead**:

- The live facade hard-zeros it: `stakeFacade.ts` emits `anticipation: reels.map(() => 0)`. So the
  ACTUAL running game (Play4Fun / Borut through the facade) never receives a non-zero flag — server
  anticipation is inert in production today.
- The only non-zero data anywhere is the upstream Stake **Storybook sample books**
  (`anticipation: [0, 0, 1, 2, 3]`, always on bonus/free-spin books) — a dev-only surface. Its
  purpose was **scatter / feature-trigger tease** in free spins, with per-reel escalating intensity.
- Crucially, the server can NEVER supply a **near-miss** tease: a near-miss is just a losing spin, so
  the server has no reason to flag it. The suspenseful (`possible`) mode is client-only by
  construction — there is no server path to fall back to. Keeping the server field would only ever
  cover the honest/trigger case, i.e. a second, partial, confusing method.

So we **delete** the server-driven path — the `revealEvent.anticipation` read in
`createEnhanceBoardSpin`, the `Anticipation(s).svelte` server components, the facade emit, and the
`anticipation` field on the book type — and the client calculator becomes the single source. Because
the old field's real job was the scatter tease, the calculator must cover BOTH reach dimensions
below, or removal would drop the Book-of 3rd-book tease as an option.

## Core idea — a reachable-win calculator with two bounds

The final board is fully known at reveal time (`revealEvent.board`). As reels lock left-to-right,
the set of still-achievable wins narrows. We compute, after _k_ reels are locked, the win **bounds**
still achievable from the reels not yet stopped, expressed as a **total-bet multiplier** (the same
quantity `resolveWinLevel` thresholds against):

```
bounds(lockedReelCount) → { min: number, max: number }
```

- **`max`** = optimistic: assume every not-yet-stopped reel lands the best-paying continuation.
  Starts high, collapses toward the true final win as reels lock.
- **`min`** = guaranteed: assume every not-yet-stopped reel lands the worst continuation. Starts at
  0 (or the already-locked wins), rises to the true final win.

A single bound pair yields **both honesty modes** the owner asked for, as a config enum
`anticipationConfidence`:

| confidence   | arm while …                      | feel                                                                                       |
| ------------ | -------------------------------- | ------------------------------------------------------------------------------------------ |
| `possible`   | `max ≥ smallestBigTierThreshold` | Suspenseful. Teases near-misses; drops the instant a landed reel kills every big-win line. |
| `guaranteed` | `min ≥ smallestBigTierThreshold` | Honest. Only fires once the big win is locked in; never lies, never spoils early.          |

The **tier** shown at any moment = `resolveWinLevel(activeBound)` where `activeBound` is `max`
(possible) or `min` (guaranteed) — so the escalation naturally climbs big → mega → massive as the
reachable ceiling/floor crosses each threshold. The **stack level** = how many big-tier steps are
still reachable (drives how many FX layers stack).

### Lines reachable-win math (the first concrete implementation)

Reads paylines + paytable from the active game config (`config.ts` `paylines`, `paytable.ts`) —
**no hardcoded symbol ids**. For each payline (a row-index array per reel):

- Walk reels left→right. The line's win depends on the run length of a single symbol (wilds
  substitute) starting at reel 0. Paytable rows give pay at run-length 3/4/5 in **bet-per-line**
  units; divide by `numLines` for the total-bet multiplier.
- **`max` for a line** given reels `0..k` locked: for every candidate symbol still viable at reel 0
  (i.e. the locked cells `0..k` on that line are all that symbol or wild), assume the unlocked
  reels all continue it → take the best line pay. If the run already broke within `0..k`, the line
  is capped at its locked run.
- **`min` for a line** given reels `0..k` locked: the pay of the run that is GUARANTEED by the locked
  prefix alone — assume the unlocked reels break it immediately (`certRun = matched locked prefix`).
  So `min` rises with `k` as more matching reels lock, and only equals the line's true final pay at
  `k = numReels`. (`min` = the win already secured no matter what the unlocked reels do — this is what
  makes `guaranteed` mode "only fire once the big win is locked in".)
- Board `max`/`min` = sum over paylines (+ scatter row if the scatter can still reach its pay
  count). Scatter reachability also feeds the **feature-trigger** tease when the game wants it.

Ways / cluster / scatter games each get their own `AnticipationReach` implementation behind the
same interface, later. Lines first — that's the Book-of remake.

### Two reach dimensions — win-reach AND trigger-reach

One client method, two axes, both computed from the final board + config (this is what fully
replaces the deleted server `anticipation[]`, whose real job was the second axis):

- **Win-reach** — the reachable big-win AMOUNT (payline math above), gated on the `winLevels`
  tiers. Drives the tiered FX (big → mega → massive).
- **Trigger-reach** — the reachable count of a **special/scatter** symbol toward a feature trigger
  (e.g. 3 scatters → free spins). Same bound shape: `max` = optimistic (each not-yet-stopped reel
  could contribute the special), `min` = the count already guaranteed by the locked reels. Arm when
  the reachable count can still reach the trigger threshold; the escalating intensity (the old
  `[0,0,1,2,3]`) falls out of how many more specials are still needed vs. reachable.

A reel arms if EITHER axis says so; the FX layer/tier is the max across both. The trigger threshold
and special symbol come from config (the scatter's `special_properties` + its `occurs` count) — no
hardcoded ids.

### Refinement — "big wins only" (the arming gate that actually ships)

The feature's whole purpose is to signal a **big win is coming**, so the arming policy in
`anticipation.ts` gates **every** axis on a reachable big-win tier — it never fires on a small win:

- **Line-win axis** — arms only when the reachable win clears the smallest configured big tier
  (`smallestBig`). Unchanged in spirit from above.
- **Book-of expansion axis** — the "one book away" tease. The expansion **is** the feature's big-win
  moment (landing the Nth of the round's symbol expands it to fill reels and pays big — the whole
  mechanic), so reaching it IS reaching a big win: it arms on the COUNT alone, **N-1 books already on
  the board** (`triggerBounds.min`, which counts every book CELL, so two books stacked on one reel
  count as two) with the Nth still reachable (`.max`). Not gated by `minAnticipateReel`. Book-of +
  free-spins only (`bookReach` exists only when `specialSymbol` is set).
  - ⚠️ **Do NOT gate this on a predicted expansion win.** An earlier pass gated it on
    `linePay(special, numReels)` (the special as a single line), but a Book-of expansion pays far more
    than one line of the symbol — that gate zeroed out low-paytable specials and **suppressed real big
    book wins** (games.invisiblewall.org bug, 2026-08-06). The count gate is the correct big-win signal
    for the book.
- **Scatter feature-trigger axis — retired as an arm trigger.** Entering free spins is a *feature*,
  not a big *win*, so under "big wins only" it no longer arms the anticipation. (`triggerBounds` still
  exists on the calculator for other uses; the lines arming policy just doesn't read the scatter axis.)
  If a game ever wants a bonus-entry tease back, it'd be a separate, explicitly-authored toggle.

With **no** big tiers configured there is no "big win" to anticipate, so nothing arms at all.

## Where each piece lives

### 1. Calculator (pure, `packages/utils-slots/src/anticipationReach.ts`)

```ts
export interface AnticipationReach {
	// win-reach: reachable big-win amount, total-bet multiplier
	winBounds(lockedReelCount: number): { min: number; max: number };
	// trigger-reach: reachable count of the special/scatter toward its feature threshold
	triggerBounds(lockedReelCount: number): { min: number; max: number };
	readonly numReels: number;
}
```

Both axes share the same locked-prefix walk; `createLinesReach` takes the config-derived paytable,
paylines, wild predicate, and (for trigger-reach) the special-symbol predicate + trigger count.
Node-fixture tested BEFORE any UI (`anticipationReach.fixture.ts`). Dependency-free like the rest of
the package.

### 2. Per-reel state (`stateGame` + `reelState`)

- `reelState.anticipationLevel: number` (stack count, 0 = off)
- `reelState.anticipationTier: 'big' | 'mega' | 'massive' | null`
- `stateGame.anticipationMode: boolean` + `anticipationConfidence: 'possible' | 'guaranteed'` +
  tier gate + zoom/grey-out toggles, all set by the Flow effect.

Arms/disarms in `createEnhanceBoardSpin`, at the reel-settle hook where the deleted server flag used
to arm `anticipating`. An **arming policy** sits between the calculator and the state: arm reel `k`
(the next to settle) when either axis clears its gate AND `k >= minAnticipateReel` (default 2 — you
need a run/count of ≥3 before a big win or trigger is even meaningful, so the trivial "armed at
k=0/1" is suppressed). When `anticipationMode` is off the whole block is skipped (byte-parity).

### 3. Presentation (escalation)

Driven by an XState presentation machine reacting to level/tier changes ("using the help of the
state machine"):

- **Spine stack** — N overlays per reel, N = `anticipationLevel`.
- **Grey-out** — a `ColorMatrixFilter` desaturate + dim on reels NOT in the anticipating set.
- **Zoom** — a board-container scale/pan toward the anticipating reels (a `ZoomController`).
- **Screen FX + tier extras** — mega / massive add layers.

### 4. Authoring surfaces

- **Symbols SM editor** (`/symbols`) owns the per-reel overlay: which anticipation spine, and the
  FX-per-tier mapping — exactly as it already owns the win-frame highlight spine.
- **Flow** (`/flow-v2`) owns the mode: `enableAnticipationMode` / `disableAnticipationMode`
  effects (payload: confidence, tier gate, zoom, grey-out) + v2 vocab palette entries + live
  signals, modelled on `enableSequentialReelStop`.
- **Off by default → byte-parity** when unauthored.

#### SFX — authorable sounds + escalating volume ramp

The tease plays **two** sounds: a one-shot activation **sting** the instant a reel arms, and a
sustained **loop** that fades in while a reel is still anticipating (`Anticipations.svelte`). Both are
authorable from the `/symbols` **Reel anticipation** panel:

- **Names are global** (one sting + one loop for the whole mode): `anticipation.activationSound` /
  `anticipation.loopSound`. Unset ⇒ the coded `sfx_anticipation_start` / `sfx_anticipation`. The
  engine reads them through `resolveActivationSound()` / `resolveLoopSound()`
  (`game/anticipationPresentation.ts`), the sound-name choke points alongside the FX resolvers. A name
  absent from the game's audiosprite is declined silently by howler (inaudible), so a typo never
  errors. The picker offers the game's real `SOUND_EFFECT_NAMES` (the shared list Flow/Editor use).
- **Volume escalates per tier** for BOTH sounds: `tierFx.soundVolume` is the loop's fade-in target and
  `tierFx.stingVolume` is the sting's per-play volume. Both are on the coded `codedTierFx` ramp
  (0.7 → 1.0 across the big tiers) and merged per-field in `resolveTierFx()`. The sting volume rides a
  new **per-play volume** on the once-player (`soundOnce` broadcast gained an optional `volume`,
  threaded through `Sound.svelte` → `createPlayOnce`), applied _relative to_ the master SFX volume so
  the player's mixer setting still applies. A `soundOnce` without `volume` is byte-identical to before.

> Note: on the pre-authoring engine the activation sting was declared in the audiosprite
> (`sfx_anticipation_start`) but never broadcast — only the loop played. Wiring the sting here is the
> feature (an escalating arm cue), so an un-authored project now plays the coded sting at the coded
> `stingVolume` ramp; the **loop** remains byte-identical.

## Build plan (phases)

0. **Design doc** (this file). ✅
1. **Calculator** — `anticipationReach.ts` (lines impl), **both** win-reach and trigger-reach + Node
   fixture. Pure, no UI — prove the math first. (Win-reach ✅; trigger-reach = this pass.)
2. **Remove the server path + state wiring** — delete the `revealEvent.anticipation` read in
   `createEnhanceBoardSpin`, the `Anticipation(s).svelte` server components, the facade emit, and the
   book-type field. Add `anticipationLevel`/`anticipationTier` to `reelState`; the client arming
   policy + `possible`/`guaranteed` switch.
3. **Presentation** — spine stacking, grey-out filter, zoom controller, tier FX; XState escalation
   machine.
4. **Flow mode** — enable/disable effects, vocab palette, signals.
5. **Symbols SM authoring** — overlay spine + tier-FX config in the `/symbols` doc + bake/pull/register.
6. **Ship** — runtime release + refresh + submodule bump; update `docs/status/engine.md` +
   `docs/status/symbols.md`.
7. **Screens follow the camera** — let OTHER game-space screens zoom with the reels, not just the
   reel stack. ✅ (headless — builds green + fixture unaffected; owner live-check pending).
   - The zoom transform is published once as a shared reactive value in main-layout world space
     (`apps/lines/src/game/anticipationCamera.svelte.ts` — `anticipationCameraTransform()` +
     `updateAnticipationCameraTarget()`), so the reel camera and every opted-in screen apply the
     IDENTICAL scale + pan-about-focal toward the SAME reel centre (one coherent move, one copy of
     the math). `AnticipationCamera.svelte` is now a thin consumer; `Game.svelte` drives the tween.
   - Opt-in is a per-screen **"Zoom with anticipation"** tick (`Scene.zoomWithAnticipation`), authored
     in `/editor` Properties (game-space screens only). Carried through the bake (the doc rides the
     bundle verbatim; whitelisted in `editorStorage.normalizeScene`) and read by the generic scene
     mounter: engine-layout's `registerSceneCameraTransform` bridge lets `LayoutScene` wrap an
     opted-in screen's content INSIDE its `MainContainer` with the shared transform — the same
     coordinate space as the board camera, so the focal point lines up. Chosen over a
     `zoomScreens: string[]` Flow-effect param because the mounter side collapses to a single wrap
     point (every mount path routes through `LayoutScene`) and the opt-in stays authored on the
     screen it applies to, with no hardcoded ids in engine code.
   - Off by default → byte-parity: a screen without the tick adds NO wrapper; with anticipation off
     the shared transform is identity, so an opted-in screen renders unchanged until a tease fires.

## Non-goals / open questions

- Ways/cluster/scatter reachability math (interface is designed for it; implementations deferred).
- Zoom framing when anticipating reels are non-contiguous (e.g. reels 0 and 4) — likely zoom to the
  bounding span; revisit in Phase 3.
- Regulatory note: `possible`-mode near-miss teasing is manufactured entirely client-side (the server
  can't sanction it — a near-miss is a loss). Fine for Play4Fun/social; revisit if a real-money
  regulated deployment needs near-miss presentation to be auditable.
