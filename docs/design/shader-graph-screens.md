# Invisible Shader Graph: screen transitions and post FX (step 8e)

> **Decided 2026-10-28.** The owner answered §16: every recommendation, except that anti-aliasing
> under a stage effect (§16.10) is an author's choice, off by default. Being built as 8e.1–8e.8
> (§15). Design pass for step 8e of
> [invisible-shader-graph.md](invisible-shader-graph.md) §8, written against the code maps of the
> `invisible-flow`, `engine-pixi-svelte` and `invisible-fx` agents. It follows the shape of the 8d
> design, [shader-graph-particles.md](shader-graph-particles.md). Current state:
> [status/shader-graph](../status/shader-graph.md). Each step in §15 would be its own PR, merged
> only when every gate passes.

## 1. The ask

From §8 of the plan: "A graph that reads two screens (from, to) over a transition, and one applied
to the whole stage. Needs its own design pass first: where transitions and post FX live in the
Scene Editor and the Flow, and their phone budget."

That is two features on one renderer:
- **A screen transition.** A compiled Shader Graph effect that plays while the game moves from one
  screen to the next, and can read both.
- **Post FX.** A compiled effect drawn over the whole stage: a colour grade, a vignette, a CRT
  look, a heat haze.

The questions this pass answers:
- how a graph reads *from* and *to*;
- what the graph side needs;
- where a whole-stage pass sits;
- where both live in the Scene Editor, the Flow and `/shaders`;
- what they cost on a phone;
- how a failure is never a black screen;
- how the current games are proven unchanged.

## 2. What exists today

### 2.1 The stage is flat

`<App>` (`pixi-svelte`, `InitialiseParent.svelte`) parents every child to `app.stage`. The game's
bands are flat, z-sorted siblings on it (`apps/lines/src/components/Game.svelte` lines 2510–3116):

| Band (z) | What draws there |
|---|---|
| `LAYER_BAND_BACKGROUND` −1000, `_CODED` −900, `_BEHIND` −500 | the backgrounds, screens ticked "Behind the reels" |
| (no z), `MainContainer` | the base game's below-reel slice, the reel stack (anchored `reels`, line 2690), the above-reel slice |
| the Screens-list z (`sceneLayerZIndex`) | the HUD (`<UI>` or `hud_*` screens), `basegameOverlays` (line 2921, the coded Transition wipe's scene), every Flow v2 container (`<FlowV2Mount>`, line 3067) |
| `LAYER_BAND_WIN_PRESENTATION` 8000, `FLIGHTS` 8500, `TAKEOVER` 9000, `TOP` 10000 | the win line, flights, takeovers, the info overlay |
| `LAYER_BAND_INPUT_MASK` 11000 | the press-to-continue hit mask (line 3113) |

The bands are defined in `engine-layout/src/lib/layerOrder.ts` lines 34–74. `cameraEffects.ts`
lines 4–8 states the consequence: "the stage is the only node that moves all of them together".
**No container holds "the game without the HUD":** the HUD interleaves with the other screens by
Screens-list z.

### 2.2 Transitions today

There is no transition that reads two screens. There are four nearby things.

**The `transition` cue and the wipe.**
- The coded part is `engine-game/src/components/Transition.svelte` with `TransitionAnimation.svelte`:
  - one rig, `transition`, clip `animation`, about 1.667 s;
  - height = canvas height × 1.7, centred;
  - it holds the awaited emitter event until the rig's `complete`.
- The authored twin is the built-in `transitionWipe` component (`builtinComponents.ts` line 1162),
  with its timeline `c_transitionwipe_wipe` (`builtinTimelines.ts` line 46).
  - It is behind the per-project flag `settings.authoredOverlays.transition` (Rive plan 8a,
    `docs/design/rive-style-editor.md` §13.2).
  - The game retires the coded part for that boot (`Game.svelte` line 2363).
  - It holds the cue through `cueHolds` (`flowV2Runtime.svelte.ts` lines 789–794).
- The starter choreography fires it, awaited, on free-spin entry and exit (`bookOfChoreo.ts` lines
  269 and 332). Every slot starter flow is projected from that choreography.
- **Nothing swaps under the wipe.** The free-spin entry chain is `uiHide` (awaited) → `transition`
  (awaited) → `setFreeSpinCounterTotal` → `freeSpinIntroShow` → … (lines 268–273). The screen
  changes **after** the wipe has finished. The wipe is a covering flourish, not a from → to.
- The `transition-parity` CI job holds the coded and authored wipes frame for frame:
  - `scripts/transition-parity/run.mjs`, workflow `.github/workflows/transition-parity.yml`;
  - it is advisory and path-filtered.
- The current-games harness captures the wipe as `fs-transition`, 60 frames after the cue
  (`scripts/current-games/screens/lines.json` line 421, `bookOf.json` line 462).

**Flow v1 entrance fades.**
- An edge's `transition: { kind: 'fade', ms, easing }` (`engine-flow/src/types.ts` line 258) fades
  the target screen in. `FlowFade.svelte` and `FlowScreenMount.svelte` do it, and `Game.svelte`
  wires it at lines 1446–1466.
- That is v1 only. `<FlowV2Mount>` says so: "No entrance fade here: v2 timing is authored explicitly
  with `delay` nodes, so a `show` is a hard cut" (`FlowV2Mount.svelte` line 47).

**A screen's own Element FX.** A screen's `elementFx` (`Scene.elementFx`, `engine-layout` `types.ts`
line 1613) with the trigger *When shown* and an `enter` kind already plays an entrance. It plays on
that screen's own content only (`design/element-fx.md` §5).

**Mode transitions are logical.** `runFlowModeTransition` (`engine-flow-v2/src/runtime.ts` line
1220) runs the Mode trigger entries. It draws nothing itself.

### 2.3 Effects on the whole stage today

**`cameraEffect`** (`pixi-svelte/src/lib/cameraEffects.ts`, the Flow action at `flowEffects.ts`
line 1201) has four kinds:
- shake and zoom punch write `app.stage`'s transform;
- flash is a white sprite at z 1,000,000 (line 71);
- chromatic wobble is **the only filter put on the stage today**. A search of `packages/`,
  `apps/lines` and the launcher finds no other write to `stage.filters`.
  - It is an `RGBSplitFilter`, `filterArea` = the viewport.
  - The area is recomputed each frame under the camera transform (lines 237–247).
  - It **replaces** the stage's list with its own (line 187) and restores the saved list on release
    (lines 192–198). So while it plays, any other stage filter is gone, and one added after it
    started is dropped at its end.
  - The code itself notes "Nothing else filters the stage today" (line 176).

**Element FX on `screen:<id>` and `reels`.**
- `LayoutScene.svelte` line 42 and `FlowV2Mount.svelte` line 61 register the screen's container. The
  Flow's `elementEffect` aims at it (`flowEffects.ts` line 1220).
- The runtime measures the target once (`runtime.ts` `measure`, line 236, through
  `getLocalBounds`). It bounds its filters to that box plus a margin of up to 256 px (`areaFor`,
  line 244), unless the container already has a `filterArea` (`priorArea`, lines 506–510).
- Its filters stack after foreign ones. It re-adds them when someone else rewrites the list
  (lines 484–529). Combined with the chroma wobble's restore, this would lose a frame.

**The Scene Editor's `coverStage`** (`elementFxPreview.client.svelte.ts` line 217) is editor-only. It
composites the editor's DOM canvases into a 2-D canvas.

### 2.4 The renderer

`InitialiseApplication.svelte` lines 60–101:
- WebGL forced (`preference: 'webgl'`);
- `antialias: true`;
- `backgroundAlpha: 0`;
- **`useBackBuffer: true`**: every frame already draws into one full-screen texture and blits it;
- resolution clamped to [1, 2], `resizeTo: window`.

### 2.5 What Pixi 8.22 offers for reading a screen

| API | What it does | Already used by |
|---|---|---|
| `renderer.render({ container, target, transform, clearColor })` | Draws a container into a texture. Turns the container into a render group as a side effect (`AbstractRenderer.mjs` line 103) | The live break's `redraw` (`breakApart.ts` line 707), with `holdGroup` to give the group back (line 729) |
| `renderer.generateTexture({ target, frame })` | The same, into a **new** `RenderTexture` each call (`GenerateTextureSystem.mjs` line 79) | The break still (`snapshot`, `breakApart.ts` line 677) |
| `RenderTexture.create(...)` | A texture to draw into again and again | The live break (`liveTexture`, capped at `MAX_LIVE_PX` 4096 a side, line 685) |
| A second texture on a filter | A resource beside the filter's uniforms | `DisplacementFilter` (`uMapTexture: textureSource`, `DisplacementFilter.mjs` line 55) |
| A filter on a container | The container is drawn into a pooled texture, then the pass draws it out. Pooled textures are the registered screen size, not the next power of two (`TexturePool.getOptimalSize`; `ViewSystem.mjs` line 101 registers the screen) | Every Element FX; the chroma wobble |
| Filter defaults | `antialias: 'off'`, `resolution: 1` (`Filter.mjs` lines 82–86). A stack draws at the **lowest** resolution of its filters and loses MSAA if any filter is `off` (`FilterSystem.mjs` lines 492–497) | — |

**What a full-screen texture costs** (RGBA8, 4 bytes a pixel, at the clamped resolution):

| Device | Device pixels | One full-screen texture |
|---|---|---|
| Reference phone, 390 × 844 CSS at DPR 2 (capped from 3) | 780 × 1688 = 1.32 M | 5.3 MB |
| iPad Pro 12.9", 1024 × 1366 at 2 | 2048 × 2732 = 5.6 M | 22.4 MB |
| The harness, 1280 × 720 at 1 | 0.92 M | 3.7 MB |
| Desktop 2560 × 1440 at 2 | 5120 × 2880, over 4096 a side | capped (§10) |

So **two live screens means two extra full-screen renders a frame** on top of the game's own.
**One frozen screen means one render, once**, and one texture held for the transition's length.

## 3. How a compiled graph plays today

**The body.** `compileShaderGraph` (`engine-shadergraph/src/compile.ts`) emits:
- its uniforms: `uFx` (progress, seconds, strength, looping), `uSeed` when read, one `uP<n>` per
  param;
- a `main` that starts from `px = efxPx()` and `uv = efxToUnit(px)`;
- `finalColor`, premultiplied.

**The element shell.** `ElementFxFilter` (`pixi-svelte/src/lib/elementFx/shaders.ts` line 159) puts
`HEADER` (line 54) in front of `linkGlsl(body)`.
- The header defines the 12 helpers in `EFX_HEADER_FUNCTIONS` (`constants-shared/glslLibrary.ts`
  line 627).
- On an element, `efxSample(px)` reads the filter's input: the element as drawn.

**The particle shell (8d.1).** `particleShellSource` (`constants-shared/particleShell.ts` line 223)
runs the same body with particle meanings. It:
- defines the same helpers;
- turns two uniforms into varyings;
- renames `main` and wraps it in the colour rule;
- refuses a body it cannot convert.

8d.1–8d.6 proved the claim in practice: **a body's whole contract with its shell is the header
helpers, its own uniforms and `finalColor`.**

**The runtime.**
- `graphFilter` / `graphPass` (`custom.ts` lines 49 and 69) write `uFx` each frame, draw one seed,
  and write each `uP<n>`.
- `playElementFx(container, play, host)` (`runtime.ts` line 887) plays any kind, built-in or
  `custom:<id>`, on **any** container. It folds motion into the container's transform, stacks the
  filters and runs breaks.

**The fail-safes.**
- `readCustomElementFx` drops an effect that calls an `efx…` function the runtime lacks
  (`unknownEfxCalls`, `glslLibrary.ts` line 682).
- `ElementFxFilter.apply` asks the driver whether the program linked (`programLinks`, `shaders.ts`
  line 136). When it did not, the element is drawn as it is and the filter is disabled (8c).

**Two findings shape this design:**
1. **A third shell is cheap.** A shell that defines the same helpers over the whole screen, plus a
   second texture for the old screen, runs every compiled body unchanged. There is no second
   compiler target.
2. **An exit effect on a still needs no shell at all.** Freeze the old screen into a texture, show
   it as one full-screen sprite above the game, and `playElementFx` on that sprite. Then every exit
   effect is a screen transition with nothing new on the graph side. That includes the built-in
   ones (dissolve, burn, melt, the five breaks, fade and pop out) and every custom exit graph, with
   its motion, passes and break. The live game below the sprite is the new screen.

## 4. The options

### 4.1 How a graph gets the two screens

| | (a) A still and an exit effect (Out) | (b) A stage filter in a screen shell (In) | (c) Both screens live | (d) Both frozen |
|---|---|---|---|---|
| What it is | The old screen frozen into a sprite on top. An exit effect plays on it through `playElementFx`. The live game below is the new screen | The old screen frozen into a texture. The live stage is the filter's input (the new screen). A compiled body in a screen shell reads both | The outgoing screens kept mounted and drawn into a texture each frame beside the incoming ones | The old screen frozen, then the new one frozen once it is ready |
| A graph reads both screens | No: it reads the still only | **Yes** | Yes | Yes |
| Effects it plays | Every exit kind, built-in or custom, with motion, passes and break | Compiled graphs only. Their motion, passes and break are ignored | Graphs | Graphs |
| The old screen animates | No (frozen) | No (frozen) | Yes | No |
| The new screen animates | Yes | Yes | Yes | No: its intro rig, count or particles would freeze, then jump |
| Cost while it plays | One still (5.3 MB on the phone), plus the effect's own passes over the screen | One still, plus one stage filter (a pooled screen texture and one full-screen pass) | Two extra full renders a frame. The persistent board cannot be in both. Every mount site (`FlowV2Mount`, the base-game split, takeovers, the HUD) needs a "leaving" state | Two stills; no live cost |
| New code on the graph side | None | A third shell, one input node, three header helpers | The same as (b) | The same as (b) |
| Fails safe as | A still that fades (no custom program at all) | The same fallback | — | — |

**Rejected:**
- **(c), both live.** Twice the draw cost every frame. It also needs a deferred unmount threaded
  through every mount in `Game.svelte`, which touches how every current game mounts its screens.
- **(d), both frozen.** What the player is about to watch, the new screen's entrance, would freeze.
- **A full-screen mesh sampling two render textures, with no filter.** It still needs both screens
  as textures each frame, which is (c)'s cost.
- **A transition graph naming an image (a luma wipe).** Graphs cannot read a texture other than the
  element today. A texture input node is its own feature (§14).

### 4.2 Where post FX sit

| | (p1) The stage | (p2) A layer under the HUD | (p3) One screen |
|---|---|---|---|
| What it is | A filter on `app.stage`, as the chroma wobble is | Every band below the HUD regrouped under one new container | A screen's own Element FX (*Always*) |
| Covers the HUD | Yes | No | Only that screen |
| Change to `Game.svelte` | None: the stage is already the root | Every band moves into a wrapper. The HUD's Screens-list z would then sort inside a different parent | None: it exists today |
| Parity risk | None at rest (no filter, no area, no callback) | Every game's stacking | None |

**Rejected for v1: (p2).** The HUD interleaves with other screens by Screens-list z (§2.1), so
there is no clean cut. Moving every band changes how every current game stacks. Pixi's
`RenderLayer` might regroup without moving them, but I have not checked that it takes filters
(§13). **(p3) is not new:** a screen's Element FX already is a per-screen post FX, bounded to that
screen's box.

## 5. Recommendation

**Build (a) and (b) as one runtime, `playScreenTransition`, and post FX as (p1).**
- **One capture, two routes:**
  - the old screen is frozen once, when the transition starts;
  - an **exit effect** that does not read the new Screens node takes the **Out route** (a);
  - **every other graph** takes the **In route** (b).
  - So "a graph built for elements works as a transition": an exit graph wipes the old screen away,
    an enter graph brings the new one in. A graph that reads the Screens node draws both itself,
    which is what the ask names.
- **The Out route is also the fail-safe.** When a transition cannot play (its effect missing, its
  program not linking), it plays the built-in **Fade out** on the still. That is plain sprite alpha
  with no custom program, so the fallback cannot itself fail to compile.
- **Post FX are Element FX on the stage**, through the runtime every element already uses. A new
  stage mode plays pixel passes only, over the viewport.
- **One owner for the stage's filters**, so the chroma wobble, post FX and a transition never
  overwrite each other. At rest the stage is exactly as today.
- **Where they live** (§9):
  - **the Flow** gets two actions (`screenTransition`, `waitForScreenTransition`) and a `stage`
    target for `elementEffect`;
  - **the Scene Editor** gets Game Settings → **Screen FX**: what the existing `transition` cue
    plays (one click for every project's free-spin entry and exit), and the post FX list;
  - **`/shaders`** gets *Made for: Transitions / Post FX* and a preview for each.

**Why not the shell alone.** It would drop every built-in exit, every break and all motion, and it
would leave no shader-free fallback. **Why not the still alone.** It cannot read both screens, which
is the ask.

## 6. How it works

### 6.1 One owner for the stage's filters

New: `pixi-svelte/src/lib/screenFx/stageFilters.ts`, plain TS.
- **It owns `app.stage.filters` and `app.stage.filterArea`.** Three slots, in a fixed order:
  1. the **transition** (the In route's shell filter);
  2. the **post FX** (the Element FX runtime's filters for the stage);
  3. the **camera** (the chroma wobble).
- **The order is deliberate.** A transition composites raw screens, the post FX grade the result
  once, and the lens wobble comes last.
- **The filter area** is the viewport under the stage's current transform. It moves here from
  `cameraEffects.ts` `applyCameraSample`, so a shake never drags an edge into view.
- **One ticker callback** while any slot is filled. At rest: `filters = null`, no `filterArea`, no
  callback. That is byte-identical to today.
- **The chroma wobble moves onto it.** `ensureChromaFilter` / `releaseChromaFilter` claim and free
  the camera slot instead of saving and restoring the whole list. No gate covers `cameraEffects.ts`
  today, so a new one is written and shot on the base first (§15 step 2).

### 6.2 A transition, step by step

`playScreenTransition(app, { kind, durationMs, intensity, params, reverse, zIndex, pose? }, host)`
returns `{ done, end() }`. `pose` is read every frame and holds the transition at a progress, as
`playElementFx`'s `pose` does; the `/shaders` scrubber uses it (§9.3).
1. **One at a time.** A transition already playing is ended at its end state (its still freed, its
   filter or sprite removed) before the new one starts.
2. **Capture on the next frame.** The call waits for the next frame's pre-render, so a Show or Hide
   just before it is on the stage. It then draws `app.stage` into a `RenderTexture`:
   - with the stage's filter slots off, so post FX are not baked in twice;
   - with the stage's resting transform (identity);
   - at the renderer's resolution, capped at 4096 px a side (`MAX_LIVE_PX`'s rule);
   - giving back the render group, as `snapshot` does.
3. **Return.** The action resolves after the capture (one frame), so the next Flow nodes change the
   screen under the still.
4. **Route and play** over `durationMs ÷ timeScale`. The clock is the game's turbo
   (`particleTimeScale`), as for an Element FX.
5. **End.** At progress 1 the sprite or filter goes and the still is destroyed: the stage is the live
   new screen. `done` resolves.

**What ends a transition early, at its end state:**
- a resize (the still no longer fits);
- `disposeScreenTransitions(app)` on teardown, called beside `disposeCameraEffects` in
  `InitialiseApplication.svelte`.

**Input is not blocked**, as it is not under today's wipe. The starter choreography hides the HUD
first (`uiHide`).

### 6.3 The Out route: an exit effect on a still

- **The sprite.** The still becomes a `Sprite` on `app.stage` at `zIndex` (the game passes the new
  band `LAYER_BAND_SCREEN_TRANSITION`, 10,500, between `TOP` and `INPUT_MASK`). It sits in
  stage-local space covering `app.screen`, as the camera flash does, with `eventMode = 'none'`.
- **Its `filterArea` is its own box.** The runtime keeps a container's own area (`priorArea`), so a
  full-screen effect pays no 256 px margin.
- **The effect.** `playElementFx(sprite, { kind, durationMs, intensity, params })`. Its motion,
  passes and break all play: a shattered screen is the built-in Shatter on the still.
- **The end.** An exit effect ends hidden, so the reveal is seamless; the sprite is then destroyed.

### 6.4 The In route: the screen shell

New: `constants-shared/screenShell.ts`, dependency-free like the particle shell.
- **`SCREEN_HEADER`** is the element header with screen meanings:
  - the unit square is the viewport, `uElement` = (0, 0, 1, 1), `uPad` = 0;
  - `efxSample(px)` and `efxScreenTo(px)` read the filter's input: the live stage, the **new**
    screen;
  - `efxScreenFrom(px)` reads the still (`uFromTexture`, at `px` ÷ the frame), 0 outside it;
  - `efxScreenReverse()` reads the shell's `uEfxReverse`.
- **`screenShellSource(effect)`** renames the body's `main` and wraps it:
  `finalColor = body + still × (1 − body.a)`. Premultiplied, the new screen drawn over the old.
  - At progress 0 an enter graph is clear, so the old screen shows: a seamless start.
  - An emphasis graph is opaque at rest, so it plays as a cut plus a flourish on the new screen.
  - The body's checks and the `main` rename are the particle shell's, moved into one shared helper
    (no private copy). A body the shell cannot convert is refused and takes the fallback.
- **Uniforms stay uniforms.** One transition is one element: `uFx`, `uSeed` and `uP<n>` are written
  as `graphPass` writes them.
- **The filter** is a `Filter` built from the shell's program, with the still as a texture resource
  (the `DisplacementFilter` pattern). `stageFilters` puts it in the transition slot. Its `apply`
  checks the link (`programLinks`) as `ElementFxFilter.apply` does.

### 6.5 Post FX: Element FX on the stage

- **The `stage` target.** `Game.svelte` mounts `<Anchor name="stage" />` at the `<App>` root (an
  anchor adds no child; `anchors.ts`). The Flow's `elementEffect { target: 'stage' }` then resolves
  to `app.stage` with no new action.
- **The game's post FX list.** `settings.postFx` (§8) mounts one `<ElementFxPlayer entries>` at the
  `<App>` root. It plays on its parent, `app.stage` (`ElementFxPlayer.svelte`), with the triggers it
  already knows: *Always*, *On cue*, a stop cue.
- **Stage mode.** The host carries `stage: app.stage`, and `playElementFx` enters stage mode when the
  target is that stage:
  - **no motion and no break** (the stage's transform belongs to `cameraEffects`);
  - **no `measure`**: the box is the viewport, so `getLocalBounds` never walks the whole game;
  - **its filters go through `stageFilters`' post FX slot**, never straight onto `stage.filters`;
  - **refused kinds play nothing**: exit and enter kinds (an exit ends hidden and stays hidden, an
    enter starts hidden, so either would hide the whole game), motion-only kinds and breaks.

### 6.6 Fail closed, never invisible

| What goes wrong | What the player sees |
|---|---|
| The transition's kind is not registered, or `readCustomElementFx` dropped it | The fallback: Fade out on the still, over the same duration |
| The shell refuses the body, or its program does not link on this GPU | The fallback, from that frame on (the still at alpha 1 − t). Logged once |
| No WebGL renderer, the still cannot be allocated, or the context is lost | A cut: `done` resolves at once, the new screen shows |
| A post FX kind is missing, or a stage-refused kind | Nothing plays (an unregistered custom entry is a settled no-op today) |
| A post FX program does not link | The stage drawn as it is: `ElementFxFilter.apply`'s pass-through (8c) |
| The `transition` cue's screen transition (§9.2) is not playable at boot | The row counts as off: the wipe plays, coded or authored |

Every path ends on the live stage with no filter: the new screen exactly.

## 7. Inputs

| Graph input | On an element (today) | In route (the shell) | Out route (a still) | Post FX (the stage) |
|---|---|---|---|---|
| UV, UV (square) | 0…1 across the element | 0…1 across the screen | 0…1 across the still (the screen) | 0…1 across the screen |
| Element size | The element, px | The screen, px | The screen, px | The screen, px |
| Time → Progress | Through the play | 0 → 1 over the transition | The same | Through the play; wraps while *Always* |
| Time → Seconds | Since the play started | Since the transition started | The same | Since the post FX started |
| Time → Strength | The entry's | The node's or row's strength | The same | The entry's |
| Time → Looping | 1 while it loops | 0 | 0 | 1 for *Always* |
| Param | The entry's value | Its default; `color` from the node | The same | The entry's value |
| Seed | One per element | One per transition | The same | One per play |
| Sample element, Outline, Relief height | The element | **The new screen**, live | **The old screen** (the still) | The stage as drawn |
| **Screens → From** (new) | The element | The old screen (the still) | — (a graph reading Screens takes the In route) | The stage |
| **Screens → To** (new) | The element | The new screen | — | The stage |
| **Screens → Reverse** (new) | 0 | 1 when the node plays it reversed | — | 0 |
| Particle → … | White, 0, 0 | White, 0, 0 | White, 0, 0 | White, 0, 0 |

**The new node.** One **Screens** input node: a UV input (unwired = this pixel), outputs **From**
and **To** (vec4, premultiplied) and **Reverse** (float, 0 or 1). It mirrors Sample element, cost 4
and 2 reads.
- **Three header helpers:** `efxScreenFrom(vec2)`, `efxScreenTo(vec2)`, `efxScreenReverse()`. They
  are added to `EFX_HEADER_FUNCTIONS` / `EFX_HEADER_SIGNATURES` and to all three headers:
  - in the element `HEADER` and the particle header they read `efxSample(px)` (both screens) and 0;
  - in the screen header they read as above.
- **No CPU form**, so the motion graph refuses the node, as it refuses Particle.
- **Two things follow:**
  - a transition graph placed on an element plays as if both screens were the element (a
    crossfade looks like nothing happening);
  - a runtime older than 8e drops an effect that calls the helpers (`unknownEfxCalls`).

**Direction.** Into free spins and back out often want mirrored wipes. Per-kind params are not
reachable from the Flow (today's `elementEffect` passes `color` only). So the node gets a `reverse`
switch, and the graph reads it as Screens → Reverse to mirror itself. On the Out route an exit
effect's direction is its own param (Burn's `from`, Shatter's `impact`).

**What each route ignores** (both editors say so, as `/fx` does for particles):
- the In route ignores the effect's motion, passes, break and padding;
- the Out route ignores nothing;
- post FX ignore motion and break.

**Custom GLSL** (8c) refuses the screen shell's names as a port, local or loop counter
(`uFromTexture`, `uEfxReverse`, the wrapper's names), as 8d.1 did for the particle shell's 38.

## 8. Data

**Flow v2 vocabulary** (`engine-flow-v2/src/reference/standardVocab.ts`, category `effect`, beside
`cameraEffect` at line 436):

```ts
screenTransition {
  kind: ScreenTransitionKind;   // built-in exit kinds; widened per project with custom kinds
  durationMs?: MS;              // unset ⇒ the effect's own length
  intensity?: FLOAT;            // 0…4, unset ⇒ 1
  color?: COLOR;                // the effect's `color` param, as elementEffect takes it
  reverse?: BOOL;               // Screens → Reverse reads 1
  blocking?: BOOL;              // unset ⇒ false: freeze, return, play on
}
waitForScreenTransition {}      // holds until no transition is playing; at once when none is
```

- **Enums.** A new `ScreenTransitionKind` holds the ten built-in exit kinds. The launcher widens it
  with the project's compiled kinds in `flowV2Vocab.ts` (line 52), beside `withCustomElementFxKinds`.
  `ElementFxTarget` gains `stage` (`ELEMENT_FX_STAGE_TARGET` beside `ELEMENT_FX_REELS_TARGET`,
  `constants-shared/elementFx.ts` line 1907; `collectElementFxTargets` lists it first).
- **The other vocabularies.** `match3.ts` and `arcade.ts` keep allow-lists over the standard
  vocabulary (`KEPT_ACTIONS`, `KEPT_ENUMS`). Both gain the two actions and the enum.
- **The game** implements both actions in `apps/lines` `flowEffects.ts`. A vocabulary action with no
  implementation is warned at boot (`flowV2Runtime.svelte.ts` line 170).

**`LayoutDoc.settings`** (`engine-layout` `GameSettings`, line 1659), both sparse:

```ts
interface GameSettings {
  …
  /** 8e: the `transition` cue plays this screen transition instead of the wipe. */
  transitionCue?: {
    kind: ElementFxKindId;      // a built-in exit kind or `custom:<id>`
    durationMs?: number;
    intensity?: number;
    params?: Record<string, number | string | boolean>;
  };
  /** 8e: Element FX on the whole stage. */
  postFx?: ElementFxEntry[];    // triggers 'always' | 'cue'; read by readElementFxEntries
  /** 8e (§16.10): stage filters keep the canvas's anti-aliasing. Absent = off. */
  stageFxAntialias?: true;
}
```

- **The server whitelist.** `normalizeGameSettings` (`editorStorage.ts` line 245) is a drop list, so
  both fields are threaded there, with the `check:doc-readers-unknown-fields` §settings case.
- **The editor.** `buildGameSettings()` (`editor/+page.svelte` line 2856) writes them only when set.
- **No new storage, export, bake or pull:** `settings` already rides inside `bundle.doc`.
- **`transitionCue` and the authored wipe** need one rule, in the pattern of
  `authoredTransitionStatus` (`authoredOverlays.ts` line 106). The game and the publish chip
  (`gameProfile.ts`) share it:
  - `off` — the wipe;
  - `screen` — this transition; the coded part is retired for the boot, and the authored swap is
    not made;
  - `unplayable` — the kind is not registered, so the wipe plays and the chip warns.

**`ShaderGraphDoc.madeFor`** gains `'transition'` and `'post'` beside 8d.7's `'particles'`. It is
compiled into the effect only when set, so every existing doc compiles byte-identically.

## 9. Authoring

### 9.1 The Flow (`/flow-v2`)

**`screenTransition`.** The inspector shows:
- **the kind:** "Built-in (exit)", then "Custom (Shader Graph)", with made-for-transitions first;
- duration, strength, colour, Reverse, Blocking;
- the effect's cost against the transition budget (§10);
- **Open in Shader Graph**, a same-tab link, as `/fx` has.

The hint under it: *"Freezes the screen and goes on at once. Put the screen change right after
this node, then Wait for transition."* A blocking transition is a flourish over an unchanged screen.

**`waitForScreenTransition`** holds the chain until the transition has played out.

**Validation.** A non-blocking `screenTransition` whose chain never reaches a
`waitForScreenTransition` is an **info**, not an error: a transition that plays under the next beat
is legitimate. A transition naming a graph that does not compile is already named by Publish
(`unshippedCustomKinds`).

**`elementEffect` / `stopElementEffect` on `stage`.** The kind list for the `stage` target shows
the pixel kinds (emphasis and loop) and warns on the rest, as the runtime refuses them.

**The Preview** lists both actions as effect operations with their lengths.

**What the Flow keeps.** The `transition` cue, the choreography and every shipped FlowDoc are
untouched. No starter flow uses the new actions in v1.

### 9.2 The Scene Editor: Game Settings → Screen FX

A block beside **Authored overlays**, with two rows.

**The `transition` cue plays:**
- *The wipe* (default), or a transition effect, with its duration and strength. The cue carries no
  payload, so the row plays the same way into free spins and out (§14).
- With an effect set, the game subscribes the awaited `transition` cue in place of the wipe. It
  starts the transition and resolves after the capture (one frame). So the nodes after the cue
  (`setFreeSpinCounterTotal`, `freeSpinIntroShow`, …) change the screen under it, and the
  transition reveals them.
- That is a real two-screen transition **in every slot project's existing flow, with no Flow edit.**
- The chip warns when the project's flow never fires `transition`, as Authored overlays warns
  `nothing-to-replace`.
- **The trade:** the flow goes on about 1.6 s sooner than after the wipe. That is the point of a
  transition, but it is a timing change, so it is opt-in (§13, §16.4).

**Post FX:**
- **the existing `EditorElementFx` section**, with triggers *Always* and *On cue* (with a stop cue),
  `keyable: false`, and a kind filter (new prop) that greys exit, enter, motion-only and break kinds
  with the reason;
- **a load line:** the effect's cost × the reference phone's pixels against the post FX budget, and
  "runs every frame over the whole game, HUD included";
- **▶** plays the entry on the stage as the editor shows it: the live still of the screen being
  edited, through the stage rules. `ElementFxPreviewTarget` gains `{ kind: 'stage' }`;
- **the cue palette** harvests the post FX cues (`collectSceneCueNames`, `sceneCues.ts` line 62).

**Anti-aliasing under stage effects** (§16.10): a switch, off by default. On, transitions, post FX
and the camera effects keep the canvas's anti-aliasing where it has any (WebGL2), at about four
times a stage pass's memory; the note beside it says so.

**No per-screen "Transition in / out" field.** v2 shows are hard cuts by design (§2.2), and a
screen's own Element FX *When shown* already plays an entrance on its content (§16.5).

### 9.3 `/shaders`

**Made for: Transitions | Post FX** switches four things:
- the cost meter's budget (§10);
- the default preview;
- the notes on what the route ignores;
- the order in the pickers.

It **never restricts** (8d's decision 2).

**The Two screens element** (*Made for: Transitions*):
- **the screens:** A is the current element on the dark backdrop; B is a second pick (a stock "B"
  card, or any atlas region) on the light one;
- **the play:** through the game's own `playScreenTransition`, which captures A, shows B and plays;
- **the controls:** the `t` scrubber poses it, play and loop replay it, and a **Reverse** switch;
- **the route:** shown ("In: draws the new screen over the old" / "Out: plays on a still of the old
  screen").

**The Stage element** (*Made for: Post FX*): the element on a full-frame backdrop, the effect
through the stage mode.

**Thumbnails stay element-based.** On an element the Screens node reads the element.

## 10. Budget

A full-screen pass costs its graph cost × every pixel of the screen. Two screens double the reads.

**The scale**, in device pixels (what the GPU fills):
- one element at the element budget on the phone: 400 × (200 × 200 × 2²) = **64 M**;
- the whole phone screen is 1.32 M px, 8.2 times that element;
- **a transition** plays when little else does and lasts a second or two, so it may take about four
  elements' worth: 200 × 1.32 M = 263 M;
- **a post FX** runs on top of everything, every frame, for the whole session, so about one: 60 ×
  1.32 M = 79 M.

| Cap | Starting value | Kind | Where it shows |
|---|---|---|---|
| Graph cost / reads, made for transitions | 200 / 8 (elements 400 / 16, particles 150 / 4) | Warning | `/shaders` status bar and chips, the Flow inspector, Game Settings |
| Graph cost / reads, made for post FX | 60 / 4 | Warning | The same |
| Built-in passes on full screen | Counted at a fixed cost per kind (blur's taps dominate). Today's graph cost leaves passes out | Meter | The same |
| Built-in kinds as transitions | Costed as their twin (`BUILTIN_TWINS`): Dissolve out 80 / 1, Melt 71 / 1, Burn 222 / 2 (over: a warning) | Meter | The Flow inspector |
| Transitions at once | 1: a new one ends the current at its end state first | Hard | `?fxdebug=1` |
| Transition length | 50 ms…5 s (Element FX allow up to 20 s) | Hard clamp | The inspector |
| The still | The renderer's resolution, at most 4096 px a side (desktop 2560 × 1440 at 2 is scaled to 0.8) | Hard | `?fxdebug=1` (its size and MB) |
| Post FX on the stage | 2 entries, 4 filters in all (a graph and its passes), decided when an entry starts | Hard: a third entry does not play | `?fxdebug=1`, Game Settings |
| Post FX kinds | Emphasis and loop with a pixel pass | Hard | Game Settings greys the rest; the runtime refuses them |
| Post FX resolution | 1 only. A filter stack draws at its lowest resolution, so ½ would draw the whole game at half resolution (`FilterSystem.mjs` line 492) | Fixed | — |

**Values checked against what exists:**
- transitions: the Dissolve out and Melt twins fit; Burn is just over (222);
- post FX: wave X 18, flag 23, ripple 27, shine 22 and flash 17 fit; Poison (186) and Freeze (211)
  do not;
- a colour grade or a vignette is around 10 to 20.

**Memory.**
- **A transition holds:**
  - its still: 5.3 MB on the phone, 22.4 MB on a 12.9" iPad;
  - In route: one pooled screen texture;
  - Out route: the effect's pool texture(s), and with a break a second still.
- **On the reference phone:** 10.5 MB to about 16 MB while it plays.
- **A post FX holds** one pooled screen texture for as long as it is on.
- **Believed:** the pool keeps one screen texture after the first transition. To be measured (§13).

**The meter measures; it does not guess.**
- The screen's pixels are known exactly (`app.screen` × resolution).
- In `/shaders` and the editors the load is shown on the reference phone.
- On a device, `?fxdebug=1` (already read by `Effects.svelte` and the material mount) prints the
  real numbers:

```
[fxdebug] transition custom:swirl (in): still 780×1688 (5.3 MB); 1.32 M px × cost 120 = 158 M; 1200 ms, 72 frames; frame p50 16.7 / p95 21.4 ms (the 2 s before: 16.7 / 17.1)
[fxdebug] transition shatter (out): still 780×1688 (5.3 MB) + break still; …
[fxdebug] transition custom:gone → fallback fade (not registered)
[fxdebug] post fx custom:grade on the stage: on (1/2 entries, 1/4 filters); 1.32 M px × cost 24 = 32 M
[fxdebug] post fx: frame p50 / p95 over the last 10 s 16.7 / 17.9 ms (before it started 16.7 / 17.0)
```

**Frame time is the readout.** Mobile browsers do not expose GPU timer queries, and SwiftShader
timings say nothing about a phone. The owner's phone check in step 8 calibrates the table.

**Not in v1:** a governor that turns post FX off under load (§14).

## 11. Shipping (rule 8)

**No new asset class.** A transition or a post FX is a compiled Shader Graph effect (`custom:<id>`)
or a built-in kind. It is named in documents that already ship:
- **in the FlowDoc**, as a `screenTransition` literal, inside `bundle.flowV2`;
- **in the layout doc**, as `settings.transitionCue.kind` and `settings.postFx[].kind`, inside
  `bundle.doc`.

Both bundle paths keep the compiled effects a bundle names by walking every section but
`shaderEffects`:
- Publish: `namedCustomKinds` / `namedShaderEffects` (`shaderExport.ts` lines 85–103), called at
  `runtimeBundle.ts` line 536;
- the bake: its own walk (`bake-editor-doc.mjs` lines 1384–1395).

So the compiled effects ship with no change to either path. The game registers `shaderEffects` with
`setCustomElementFx` before its first render (`Game.svelte` line 852), as today.

**A deleted or broken graph** is named by Publish (`shaderEffectsMissing`, `unshippedCustomKinds`)
and by the bake's log. In the game, its transition plays the fallback, its transition cue plays the
wipe, and its post FX plays nothing.

As in 8d.4, this is proven in `check:shader-pipeline` rather than assumed (§15 step 5).

## 12. Version skew

| Runtime | `screenTransition` | `settings.transitionCue` | `settings.postFx`, `elementEffect` on `stage` | An effect calling `efxScreen*` |
|---|---|---|---|---|
| Before 8e | An unknown action is a no-op (`engine-flow-v2/src/env.ts` lines 14–15, 95): the change cuts in. `waitForScreenTransition` returns at once | Ignored (the game reads named fields): **the wipe plays** | Ignored; `stage` resolves to no anchor: nothing plays | Dropped by `readCustomElementFx` (step 6 on): it plays nothing where an element names it |
| 8e on, effect missing or dropped | The fallback fade | Off: the wipe | The entry plays nothing | — |
| 8e on, a GPU that will not link it | The fallback fade from that frame | The same runtime: the fallback | The stage as drawn (8c pass-through) | — |
| Desktop builds | Get 8e at their next build | — | — | — |

**A soft rollback floor:** the first release with step 4 for transitions, and with step 3 for post
FX. Below them:
- transitions are cuts;
- the transition cue plays the wipe;
- post FX do not play.

Nothing goes black or invisible. It is written in `docs/design/games-deploy.md` beside 8a's and
8d.3's.

**A game published in the minutes between the launcher's deploy and the runtime release's promote**
is in the same state until the promote lands. It needs no re-publish.

## 13. Risks

| Risk | Handling |
|---|---|
| An always-on post FX makes a phone slow or hot | The post FX budget (60 / 4), the hard caps, `?fxdebug=1` frame times against the time before, the owner's phone check |
| A transition shows a black or missing frame | The capture is checked. The fallback is shader-free. Every path ends on the live stage. The `screen-fx` gate's "never darker than both screens" check (§15 step 2) |
| The three stage-filter writers fight | One owner, fixed slots, untouched at rest. The `camera-effects` gate, shot on the base before the chroma wobble moves |
| The screen shell drifts from the others | One header list (`EFX_HEADER_FUNCTIONS`) held over all three headers by `check:element-fx`. `shader-compile` gains a `screens` sheet: every reference graph, twin and node through the screen shell, WebGL1 and WebGL2 |
| Edges lose MSAA under a stage filter | Pixi's default for every filter is `antialias: 'off'`. Every Element FX pass and today's chroma wobble already draw without MSAA. Measured in step 3; §16.10 |
| Memory on a large tablet during a transition | The still is capped at 4096 a side. `?fxdebug=1` prints its MB. The step 2 gate checks that nothing is reallocated after warm-up |
| The transition cue's effect changes the free-spin timing (the flow goes on after one frame, not after the wipe) | Opt-in per project. The `transition-parity` script gains a variant that measures it. The owner's browser check |
| The slam rule changes meaning | Under the cue row the cue is held for one frame, so "unskippable" no longer covers a transition's length. Noted in the guide |
| Authors put the screen change before the freeze | The inspector's hint and the validator's info. The cue row covers the common case with no wiring |
| A post FX blurs or tints the HUD | The stage includes the HUD in v1, and the guide says so. A layer under the HUD is out of v1 |
| An exit or enter kind as a post FX hides the game | Refused on the stage, in the editor and in the runtime |
| A stale Scene Editor tab drops `settings.postFx` or `transitionCue` | `buildGameSettings` rebuilds `settings` from the panel (`+page.svelte` line 2856), as when Authored overlays landed. The lease keeps one editor; noted in the guide |
| A transition reveals a screen still loading its art | The new screen is live, so it fills in as it loads. The game preloads its bundles; checked in play-QA |

**Where I am unsure:**
- **The capture.**
  - I believe `renderer.render({ container: app.stage, target })` between the app's own renders is
    safe with `useBackBuffer: true` and the advanced blend modes. Inside a texture the backdrop is
    readable.
  - I have not checked what the pre-render runners do on a second render of the root in one frame,
    or whether giving back the stage's render group matters (it is always a group).
  - Step 2's harness settles both first.
- **Svelte's flush and the capture.** I believe waiting for the next frame's pre-render is enough
  for a Show or Hide just before the action to be on the stage. Not proven.
- **The still's mapping in the shell.** `px ÷ frame` under a fractional resolution and a pooled
  texture larger than the frame. The identity gates in step 2 decide it.
- **MSAA.** How much a stage filter's loss of MSAA shows on real art (believed little: most edges
  are alpha-blended texture edges). Measured in step 3.
- **The pool.** Whether `TexturePool` keeps a screen-sized texture after the first transition, and
  what that means for iOS memory on a 12.9" iPad.
- **The budget numbers** are estimates scaled from the element budget, with no device measurement
  behind them.
- **`RenderLayer`.** Whether Pixi 8.22's `RenderLayer` takes filters (it would make a layer under
  the HUD possible without moving bands). Not checked.
- **The frozen old screen.** Whether authors accept that the old screen stops moving during a
  transition (symbol animations, idle rigs).
- **The chroma wobble's move** has no existing gate; its new gate is only as good as the frames it
  shoots.

## 14. Out of v1

- Both screens live (the old one still animating).
- Post FX at a lower resolution: a filter stack draws the whole game at its lowest resolution.
- A post FX layer under the HUD.
- A per-screen *Transition in / out* field.
- Built-in kinds other than exits as transitions; their graph twins are one "Start from a built-in"
  away in `/shaders`.
- Per-kind params from the Flow beyond `color` (`elementEffect` has the same gap).
- Reverse on the transition cue's way back. The cue has no payload (`standardVocab.ts` line 905), so
  the row cannot tell free-spin entry from exit. A flow that wants the mirror uses
  `screenTransition { reverse }`.
- An image input node (luma wipes).
- Motion, passes and break on the In route; motion and break on the stage.
- Transitions previewed on the project's real screens in `/shaders` or the Flow Preview.
- A governor that turns post FX off under load.
- Skipping a transition with a tap.
- WebGPU.

## 15. Build plan

Each step is its own branch and PR, with its status entry. Each merges only with:
- `check:all` green and svelte-check at baseline;
- the current-games harness reporting no changed screen;
- `transition-parity` green wherever it runs.

The order respects one dependency: **8d.7** lands `madeFor` and puts the graph's cost in the
compiled effect, and steps 3 and 7 build on both.

1. **The screen shell and the Screens node** (engine).
   - **Contents:**
     - `constants-shared/screenShell.ts`: `SCREEN_HEADER` and `screenShellSource(effect)`;
     - the body conversion shared with the particle shell (moved, not copied);
     - three helpers in `EFX_HEADER_FUNCTIONS` and `EFX_HEADER_SIGNATURES`, and in the element and
       particle headers with neutral meanings;
     - the **Screens** node;
     - Custom GLSL refusing the shell's names;
     - `TRANSITION_*` and `POST_*` budgets beside `PARTICLE_*` (`compile.ts` line 115).
   - **Gates:**
     - `compile.fixture.ts`: the node at every output; neutral on an element; every doc without it
       byte-identical (a dump against the base);
     - `check:element-fx`: the header list matches all three shells' text, and the reader takes a
       body calling the helpers;
     - `shader-parity`: the 50 built-ins pixel-identical after `HEADER` grew;
     - `particle-material` unchanged;
     - `shader-compile` gains a `screens` sheet (every reference graph, twin and node body through
       the screen shell, WebGL1 and WebGL2).
   - **Exit:** those green; nothing plays differently.
   - **As built (8e.1).** The conversion lives in `constants-shared/shellBody.ts`. The screen shell
     declares no `uElement` / `uPad`: its unit square is the filter frame. `uTexture` is the live new
     screen, `uFromTexture` the still, `uEfxReverse` the direction; the composite after the body is
     `finalColor += efxScreenFrom(efxPx()) * (1.0 - finalColor.a)`. From and To are neutral as
     Sample element on an element or particle. The Screens node costs 4 and 2 reads. The
     `px ÷ frame` mapping does not depend on resolution or on Pixi's pooled texture sizes; it does
     need the still to be a dedicated texture whose UV 0…1 is the filter frame, and the filter's
     area to be the viewport (written on `SCREEN_FROM_TEXTURE`). 8e.2 proves the capture itself.
     The shell's own composite read of the still is fixed overhead, outside the budget.
2. **The stage filter owner and the transition runtime** (engine, `pixi-svelte`, no doc or
   vocabulary change).
   - **Contents:**
     - `pixi-svelte/src/lib/screenFx/` (`stageFilters.ts`, the still, `playScreenTransition`,
       `waitForScreenTransition`, dispose), exported as the `pixi-svelte/screenFx` subpath;
     - both routes, the routing rule, one at a time, resize, the fallback and the cut;
     - the chroma wobble moved onto the owner.
   - **Gates:**
     - new **`camera-effects`** (fx-spike, headless Chromium, WebGL1 and WebGL2): every camera kind
       at fixed moments, **shot on the base first**, pixel-identical after the move;
     - new **`screen-fx`**, mutation-checked:
       - In route: an Output-alone transition draws the new screen pixel-identically; a Screens →
         From graph draws the old screen pixel-identically; a crossfade at 0.5 is within the twins'
         tolerance of the mean;
       - Out route at t = 0 draws the old screen;
       - each built-in exit kind ends exactly on the new screen;
       - a forced link failure and a missing kind play the fallback;
       - no frame of a crossfade is darker than both screens at any pixel;
       - a second transition ends the first, and a resize ends one;
       - 2,000 transitions reallocate nothing after warm-up.
   - **Exit:** both routes and the fail-safes proven headless; no game calls them yet.
   - **As built (8e.2).** The post FX slot takes filters only, and `filterArea` is always the
     viewport (1/256 px inside it), so no slot can narrow the still's frame. The still is taken at
     LOW+1 on `app.ticker` with only the owner's slots off. A throw while starting cuts. The route
     rule for custom graphs is `screenTransitionRoute(effect)` in `constants-shared/screenShell.ts`
     (the editor's route note reads the same). The link is checked once before the first frame.
3. **Post FX on the stage** (engine).
   - **Contents:**
     - the Element FX runtime's stage mode;
     - the `stage` anchor in `Game.svelte`;
     - `GameSettings.postFx` (type, reader, the game's `<ElementFxPlayer>` at the root);
     - the caps;
     - `GameSettings.stageFxAntialias` (§16.10): the owner gives every stage filter
       `antialias: 'inherit'` when set, `'off'` otherwise;
     - `?fxdebug=1` lines with load from the compiled effect's cost.
   - **Gates:**
     - `check:element-fx`: no motion folded, no measure, filters and area restored exactly, the
       refused kinds;
     - `screen-fx`: an Output-alone post FX matches no post FX (the MSAA difference measured and
       reported, with the setting off and on); the setting reaches every stage filter; the slot
       order with a transition and the chroma wobble;
     - current-games: no changed screen.
   - **Exit:** a game build plays a doc's post FX headless. The post FX floor starts here.
   - **As built (8e.3).** Stage mode lives in `pixi-svelte` `elementFx/stage.ts`; the reader is
     `engine-layout` `readPostFx`, which, given the runtime as judge, also drops an unregistered
     custom kind. A stage pass pads by 1 px (`STAGE_FX_EDGE_PAD`) and a graph's `uPad` counts the
     whole stage list. The caps are checked twice: by the reader on the doc, and by the runtime as
     each entry starts (a Flow's `stage` entries count). `cost` is absent until 8e.7, so the
     `?fxdebug=1` load line and its baseline wait for it; reserving the `stage` and `reels` ids
     in the editor moves to 8e.6.
4. **Transitions in the game: the Flow actions and the transition cue** (engine-flow-v2,
   `apps/lines`).
   - **Contents:**
     - `screenTransition`, `waitForScreenTransition` and `ScreenTransitionKind` in the standard,
       match3 and arcade vocabularies;
     - `stage` in `ElementFxTarget`;
     - the `flowEffects` implementations;
     - `settings.transitionCue` and the one rule with Authored overlays (`authoredOverlays.ts`);
     - the cue subscriber, and `LAYER_BAND_SCREEN_TRANSITION`.
   - **Gates:**
     - `gen:flow-vocab:check`;
     - `check:flow-bonus-modes` (vocabulary hashes updated deliberately);
     - `check:flow-publish-gate` (every starter flow byte-identical);
     - a flow-spike harness running freeze → hide / show → wait through the real interpreter with a
       stub env;
     - `check:authored-transition` extended (the row off: the same objects; on: the coded part
       retired and no swap);
     - `transition-parity` gains a third variant, the cue row on:
       - the next cue fires within 2 frames of `transition`;
       - every captured frame differs from the reference;
       - none is darker than both screens;
       - with the row's graph left out of `shaderEffects`, the wipe frames are pixel-identical to
         as-published.
   - **Exit:** a flow and a doc drive a transition in a game build headless. The transition floor
     starts here.
   - **As built (8e.4).** The seam is `apps/lines/src/game/screenTransitions.ts`, bound by
     `screenTransitionsBinding.ts` in `Game.svelte`'s setup. `stage` sits after `reels` in
     `ElementFxTarget`, so a new node still defaults to the reels. The determinism clock now lets
     a render to a texture through on a `draw: 'last'` frame. The parity variant fits each frame
     to the From/To mix rather than only "differs". Owner, 2026-10-29: a slam cuts a playing
     transition to the new screen (through `roundSkip`); the free-spin exit stays as is (the
     screen changes before the cue fires).
5. **The ship chain, proven** (launcher).
   - **Contents:** `check:shader-pipeline` grows; the soft floors in `docs/design/games-deploy.md`.
   - **Gates:**
     - a `screenTransition` kind, a `transitionCue` kind and a `postFx` kind each keep their compiled
       effect in Publish (the real `buildRuntimeBundle`) and in the bake (the real script against a
       local portal);
     - a deleted or broken graph is named in `shaderEffectsMissing` and in the bake's log;
     - mutation: taking `doc` or `flowV2` out of the walk fails it.
   - **Exit:** those green.
6. **Authoring in the Scene Editor and the Flow** (launcher).
   - **Contents:**
     - Game Settings → Screen FX (both rows, and the **Anti-aliasing under stage effects** switch
       with its memory note, §16.10);
     - `normalizeGameSettings`, `buildGameSettings`;
     - the publish chip;
     - the cue harvest;
     - ▶ on the stage;
     - the `EditorElementFx` kind filter;
     - in `/flow-v2`: the kind list, the `stage` target, the inspector, the info and the Preview;
     - `docs/tools/invisible-editor.md` and `docs/tools/flow.md` (with `docs-keeper`).
   - **Gates:**
     - `check:doc-readers-unknown-fields` §settings;
     - `check:element-fx-flow` (the `stage` target);
     - the editor gates that cover Game Settings;
     - the pages played headless: set a post FX, preview, save, reopen identical; set the cue row;
       place a transition in a flow, save, publish.
   - **Exit:** an author sets both in the Scene Editor and places one in the Flow.
7. **`/shaders`: Made for transitions and post FX, the Two screens and Stage previews** (launcher
   and engine).
   - **Contents:**
     - the `madeFor` values;
     - the budget switch;
     - both preview elements through the game's runtime;
     - the route and ignored notes;
     - picker order in the Flow and Game Settings;
     - `docs/tools/shader-graph.md`.
   - **Gates:**
     - `compile.fixture.ts` byte-identical without `madeFor`;
     - `check:shader-editor`;
     - the preview harness on WebGL1 and WebGL2;
     - the page played headless.
   - **Exit:** an artist builds a transition and sees it between two screens.
8. **Play-QA and calibration.**
   - **Contents:** `scripts/playtest/screen-fx-play.mjs` on a current-games stand-in, with a
     transition cue graph, a Flow `screenTransition` and a post FX.
   - **The script passes when:**
     - the shell program and the post FX are on the stage;
     - the transition frames differ from the same snapshot without `shaderEffects`. That snapshot
       plays the wipe on the cue, the fallback fade for the Flow action and no post FX, and none of
       its frames is black;
     - there are no errors or stalls.
   - **Owner pass:** a phone check reading `?fxdebug=1`, then the caps in §10 updated from it.
   - **Exit:** the play passes; the status files and guides are current.

## 16. Decisions (owner, 2026-10-28)

The owner answered each one. All are as recommended except 10, where the owner chose "optional":
anti-aliasing under a stage effect is the author's choice, off by default. The alternatives are
kept for the record.

1. **Which option.**
   - *Recommended:* the old screen frozen once and the new one live, with two routes:
     - an exit effect plays on the still (Out, any built-in or custom exit);
     - every other graph plays on the live stage in a screen shell (In), and can read both screens
       through the Screens node.
   - *Alternatives:* the shell alone (no built-in exits, no breaks or motion, no shader-free
     fallback); the still alone (no graph reads both screens, which fails the ask).
2. **The old screen: frozen or live.**
   - *Recommended:* frozen when the transition starts.
   - *Alternative:* both live, at twice the draw cost and with a "leaving" state through every
     mount.
3. **How the Flow plays one.**
   - *Recommended:* two actions:
     - `screenTransition` freezes, returns and plays on; `blocking` holds for a flourish;
     - `waitForScreenTransition` holds until it ends.
   - *Alternatives:* a single node with `then` and `done` exec-outs (vocabulary actions have one
     exec-out today, so it is a schema change); a Show Container that transitions by itself (v2
     shows are hard cuts by design).
4. **Does the `transition` cue name a graph.**
   - *Recommended:* yes, opt-in per project, as Game Settings → Screen FX → "The `transition` cue
     plays". The cue then holds for one frame and the transition plays over what the flow does
     next. Off by default, so the wipe stays everywhere.
   - *Alternative:* no; transitions through the Flow actions only (every project edits its flow).
5. **A per-screen Transition in / out in the Scene Editor.**
   - *Recommended:* not in v1. A screen's Element FX *When shown* already plays an entrance on that
     screen.
   - *Alternative:* `Scene.transitionIn / Out`, played by the game on every Show and Hide of that
     screen.
6. **Where post FX sit.**
   - *Recommended:* the whole stage, HUD included; per-screen through a screen's own Element FX, as
     today.
   - *Alternative:* a layer under the HUD, which moves every band in `Game.svelte`.
7. **How post FX turn on.**
   - *Recommended:* both:
     - Game Settings → Post FX entries (*Always*, or *On cue* with a stop cue);
     - the Flow's `elementEffect` on `stage`.
   - *Alternatives:* either one alone.
8. **Which effects may be post FX.**
   - *Recommended:* emphasis and loop effects with a pixel pass.
   - *Alternative:* any, accepting that an exit or enter kind hides the whole game.
9. **The caps.**
   - *Recommended:* the starting values in §10 (transitions 200 / 8, post FX 60 / 4, one transition
     at a time, two post FX entries and four filters, the still at most 4096 a side, 50 ms to 5 s),
     revised after step 8's phone check.
10. **MSAA under a stage filter.**
    - *Recommended:* off, as every Element FX pass and today's chroma wobble, measured in step 3.
    - *Alternative:* `inherit` on WebGL2, about four times the pass's memory; WebGL1 cannot do it.
    - **Decided: optional.** A project setting, Game Settings → Screen FX → **Anti-aliasing under
      stage effects** (`settings.stageFxAntialias`), off by default. On, the stage filter owner
      gives every stage filter it runs (transition, post FX, camera) `antialias: 'inherit'`, so
      they keep the canvas's MSAA where the canvas has it (WebGL2); on WebGL1 it changes nothing.
      Step 3 measures both settings' cost and look; the editor's Screen FX block shows the memory
      note beside the switch.
11. **Who may.**
    - *Recommended:* no new capability. Flow authors place transitions; anyone who saves the
      Scene Editor sets Screen FX.
    - *Alternative:* the Screen FX rows behind the component-publish capability, as Authored
      overlays are (`authoredOverlayGuard.ts`).
12. **Input during a transition.**
    - *Recommended:* not blocked, as under today's wipe; the choreography hides the HUD first.
    - *Alternative:* the still swallows taps while it covers.
13. **Rollback.**
    - *Recommended:* accept the soft floors (below step 4 transitions cut and the cue plays the
      wipe; below step 3 post FX are off).
