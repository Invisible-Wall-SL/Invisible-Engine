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

## Editor preview — the stand-in symbol rides the bone (Scene Editor)

The runtime rides the chosen symbol on the bone; the Scene Editor mirrors that live so an author
can pick a bone + tune offset/follow/scale and SEE a stand-in symbol track the bone WITHOUT running
the game. This is preview-only — the runtime is untouched, and a scene without this component (or an
instance with no `symbolBone`) renders byte-identically to before.

**Data-driven opt-in.** `boundComponentCatalog.ts` gains a `ridesBone` binding on
`FreeSpinIntroSymbolReveal` (a new `BoneRiderBinding`): it names the ENCLOSING instance's param keys
the editor reads (`introSpine`, `symbolBone`, `introAnimation`, `offsetX/Y`, `followRotation`,
`followScale`, `symbolScale`, and the editor-only `previewImage`). Any future bone-riding component
declares its own binding here — the editor never hardcodes a component id. Helper:
`boundComponentRidesBone(name)`.

**Where the bone transform is read + how it flows to the 2D canvas.**
`EditorSpineLayer.svelte` owns the skeleton↔screen mapping (it bakes the editor pan/zoom + an
X-mirror into each skeleton), so re-deriving a bone's screen position in the 2D canvas would get the
mirror wrong. Instead the spine layer resolves the bone where that mapping lives:

1. When collecting a placed reveal instance, `riderSpineTarget()` emits the rig as a spine target
   (resolving the bundle from the `introSpine` param, else the catalog default) that auto-plays the
   `introAnimation` **looped** so the bone keeps moving, and carries a `BoneRiderSpec`.
2. In the render loop, right before the pan/zoom bake, it captures the rig's WORLD transform
   (`riderSk0`, y-flip included). After the rig is posed + drawn it reads the bone in RAW skeleton
   space (identity skeleton placement, so the read is independent of the mirror bake) and maps it
   into world coords: `x = sk0.x + bone.worldX·sk0.scaleX + offsetX·|sk0.scaleX|`, `y` likewise;
   `rotation = -bone.getWorldRotationX()·DEG_TO_RAD` (when `followRotation`); `scaleX/Y =
   symbolScale · bone.getWorldScaleX()/Y()` (bone scale only when `followScale`) — the SAME math as
   the runtime `<SpineBoneAttach>`. `SpineBone` was extended with `getWorldRotationX/ScaleX/ScaleY`.
3. It publishes `{ x, y, rotation, scaleX, scaleY, region }` (editor WORLD coords) into a SHARED,
   non-reactive `Map<hostNodeId, BoneRiderTransform>` — no per-frame `$state` churn. An empty/
   unresolved bone publishes nothing (parity).

`EditorCanvas.svelte` passes that one Map to every per-scene spine layer and runs its OWN rAF
(`drawRiders`, active only while a bone-riding component is present) that reads the Map and draws
each stand-in symbol on a dedicated `.rider-layer` canvas (z-index 999 — above the scene groups so
the symbol rides ON TOP of its rig, below the HUD), in the same `setTransform(dpr)·pan·zoom` world
mapping as everything else. The stand-in is a symbol-sized labelled box (base = 150 main-px ×
`mainScale`, scaled by the published factors), OR the real atlas region when the optional
`previewImage` param is set + resolvable.

## How an author uses it (no code)

1. In the Scene Editor, open the `specialBook` scene and drop a **Free-spin symbol reveal**
   instance; position it.
2. Set `introSpine` to the intro rig bundle, pick the intro/idle animations, and pick the
   `symbolBone` from the dropdown (populated from that rig's bones). A stand-in symbol appears on
   the bone and rides the played intro animation LIVE — tune offset / follow / scale and watch it
   track. Optionally set `previewImage` to a real symbol atlas region to preview actual art.
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
