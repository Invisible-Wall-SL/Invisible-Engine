# Free-spin symbol reveal — the chosen book symbol merged into an intro Spine rig

> Status: built on `feat/free-spin-intro-symbol-reveal` (2026-07-13). Reusable across
> every Book-of game. Verified: engine builds clean (`lines` + `launcher-api`). Pending:
> author a `specialBook` scene with a real intro rig + bone, then live-verify.

## The ask

During a Book-of free-spins entry the game plays a Spine animation that flips through
random symbols. We want that animation to **land on the actual chosen book symbol** — the
special symbol the RGS book selected — by riding it on a **bone** of the intro rig (a
flipping page, a rising glow), rather than just cross-fading standalone symbol art. And we
want it **reusable** so any Book-of title can drop it in and configure it in the editor with
no per-game code.

## Why a bone, and why this hook

- The chosen symbol only exists once the book event `setExpandingSymbol` has fired
  (`stateGame.specialSymbol`). A random-cycle animation can only "land on your symbol" at
  that moment — **not** during the earlier spin-count `freeSpinTrigger` intro. So the reveal
  binds to the existing `setExpandingSymbol` step, exactly like the coded `SpecialBook`
  shuffle it replaces.
- Placing the chosen symbol on a **bone** (vs a slot) fits a rig authored with a bone but no
  dedicated symbol slot. The symbol rides the bone's world transform so it banks/scales with
  the animation.

## Architecture — reuse, not new plumbing

Invisible Flow v2 has no "feature nodes"; the extension surfaces are vocabulary, containers,
and functions. The book reveal is already modelled as **one overlay step** (`bookOwnership.ts`):
screen `specialBook` + event `setExpandingSymbol` + an awaited `specialBookReveal` cue, with a
generic ownership gate — *any authored node in the `specialBook` scene that isn't the coded
`SpecialBook` bind anchor* flips ownership, suppressing the coded shuffle and running the
authored reveal instead.

So the feature is a **new authored component that subscribes to the existing
`specialBookReveal` cue** — no new cue, no choreography change, no new emitter type.

```
setExpandingSymbol (book event)
  └─ effect setSpecialSymbol   → stateGame.specialSymbol = symbol
  └─ cue specialBookReveal (awaited, symbol payload)
        │  (coded SpecialBook is suppressed because the scene has authored content)
        ▼
  FreeSpinIntroSymbolReveal.svelte   (coded bind part, placed in the specialBook scene)
     • <SpineProvider key={introSpine}>
         <SpineTrack {introAnimation} then/idle, listener.complete → settle+idle>
         <SpineBoneAttach boneName={symbolBone} offset followRotation followScale>
            <Symbol rawSymbol={{ name: specialSymbol }} state="bookIdle">
     • returns the completion promise → the awaited cue blocks the round until the rig
       intro animation finishes
```

## Pieces (all on this branch)

1. **`packages/pixi-svelte` · `SpineBoneAttach.svelte`** — added opt-in `followRotation` /
   `followScale`. Position path unchanged (existing Invisible FX Tier-B callers unaffected);
   with the flags on, the ridden child also takes the bone's world rotation/scale. Skeleton
   space is CCW / y-up, Pixi CW / y-down → world rotation is negated (same inversion
   `<SpineBone>` applies to y).

2. **`packages/engine-layout` · `builtinComponents.ts`** — new
   `FREE_SPIN_INTRO_SYMBOL_REVEAL_DEF` (`id: freeSpinIntroSymbolReveal`, `game`-space
   `overlay`), cloning `FREE_SPIN_INTRO_VISUAL_DEF`. Params: `introSpine` (bundle),
   `introAnimation` / `idleAnimation` (`spineAnimation`), `symbolBone` (**new `spineBone`
   kind**), `offsetX/Y`, `followRotation` / `followScale`, `symbolScale`, `symbolState`.
   Registered in `BUILTIN_COMPONENTS` + a `boundComponentCatalog.ts` preview entry.

3. **`apps/lines` · `FreeSpinIntroSymbolReveal.svelte`** — the coded bind part (above).
   Registered in `Game.svelte` (bind map + def map). Reads its params via
   `getComponentParams()`; reads the chosen symbol from the `specialBookReveal` payload.

4. **`packages/engine-layout` · `types.ts`** — new `ComponentParam` kind **`spineBone`**
   (a bundle-scoped bone-name dropdown, mirroring `spineSlot`).

5. **`apps/launcher-api` (editor)** — the bone picker: `EditorSpineMeta` / `SpineMeta` /
   `SpineSkeletonData` now carry `bones`; parsed from the skeleton JSON (`data.bones`) in
   `spine.ts`, published from the live skeleton in `EditorSpineLayer.svelte`, and surfaced as
   a dropdown in `EditorProperties.svelte` (the `spineBone` arm reads `meta.bones`).

## How an author uses it (no code)

1. In the Scene Editor, open the `specialBook` scene and drop a **Free-spin symbol reveal**
   instance; position it.
2. Set `introSpine` to the intro rig bundle, pick the intro/idle animations, and pick the
   `symbolBone` from the dropdown (populated from that rig's bones). Tune offset / follow /
   scale.
3. In Flow, wire the `setExpandingSymbol` edge to the `specialBook` screen. Ownership flips →
   the coded shuffle is suppressed and this reveal plays, blocking the round until the rig's
   intro animation completes.

## Fall-through / parity

A doc that doesn't place this component is byte-identical to before: ownership stays OFF, the
`setExpandingSymbol` event falls through to the coded `SpecialBook` shuffle. Additive.

## Shipping

Engine capability reaches online/shipped games only via the runtime-bundle republish
(`publish-runtime-bundle.mjs`) + the game's engine submodule bump (Book of Borut). The
FlowDoc/scene the author builds travels the R2 export→bake chain as usual.
