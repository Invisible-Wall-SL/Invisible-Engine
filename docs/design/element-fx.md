# Element FX — effects that play ON an element

> Owner ask (2026-10-21): FX today are particles placed in a scene and full-screen camera effects
> fired from the Flow (`cameraEffect`: shake, flash, zoom punch, chromatic wobble). Make FX
> placeable on assets (a rig, an `.irig`, a flipbook, a particle effect) and on elements (a screen,
> the reels), and add new ones: wave on X or Y, flip on itself, twist, curl, glow, shine, crash,
> crumble, bounce 3D, "and anything else". Follow-ups the same day: put them in the component state
> machine and animate them on the stage (§3 `keyed`, §7), and a Sphericon 3D effect. Progress lives in [status/fx](../status/fx.md) (the
> "Element FX" part); the authoring UI is in the Scene Editor guide
> ([tools/invisible-editor](../tools/invisible-editor.md)) and the Flow action in
> [tools/flow](../tools/flow.md).

## 1. What it is

An **Element FX** is an effect that plays ON one element: it moves, bends, lights or breaks the
element's own pixels, where an Invisible FX particle effect ([invisible-fx.md](invisible-fx.md))
adds particles beside it and a camera effect moves the whole game. The two meet only in name: a
particle effect node can carry Element FX like any other node (a glowing, wobbling beam).

Three ways to get one onto an element, all playing through ONE runtime:

| Where | How it plays |
|---|---|
| **A node** (any kind: image, rig/`.irig`, flipbook, particle effect, text, rect, group, component placement) | Its `elementFx` list in the Scene Editor: *Always* (loops while shown), *When shown*, *On cue* (a Flow `fireCue`, a component signal, a cue its component's timeline or state raises), or *Keyed* (a timeline poses it, so a state-machine state does too), with an optional stop cue |
| **A whole screen** | The screen's own `elementFx` list (Screen panel) |
| **The reels** | The reel grid node's `elementFx` list, played on the real reel stack |
| **Anything anchored, from the Flow** | `elementEffect { target, kind, … }` / `stopElementEffect { target }` |

## 2. The catalog (`constants-shared/elementFx`)

One dependency-free list, read by the editor (kind picker, param rows), the flow vocabulary (the
`ElementFxKind` dropdown) and the runtime. 39 kinds in five families:

- **Motion** (the element's own transform; no GPU pass): shake, wobble, pulse, heartbeat, jelly,
  bounce, spin, swing, float, pop in, pop out, slam in, fade in, fade out.
- **3D** (a perspective pass): flip sideways / over (a coin flip "on itself"), bounce 3D (jumps out
  of the screen at you and settles), tilt 3D (sways in perspective), and sphericon (the element
  folds into a lit, spinning sphericon wrapped in its own art — two half double-cones joined with a
  quarter turn, ray-cast per pixel — rolls, and unfolds back).
- **Distort**: wave X, wave Y, flag (pinned at its left edge, lit folds), twist, curl (a page
  corner peels and lays back), ripple (a shock ring), bulge (lens / pinch).
- **Light & colour**: glow, outline, shine (a band of light, only where the element is), flash,
  rainbow (hue cycle), chromatic, glitch, blur, pixelate, dissolve out / in (noise burn with a
  glowing edge).
- **Break** (a still of the element cut into pieces): crash (takes a hit, smashes into shards that
  fly and fall), crumble (chunks let go bottom row first and drop).

Each kind has a **phase**: `emphasis` (plays and returns to rest), `loop` (built to repeat
seamlessly; fades in and out when played a set number of times), `enter` (starts hidden, ends at
rest; hidden through its delay) or `exit` (ends hidden and STAYS hidden until it is stopped or an
`enter` kind plays on the element). And its own params (`number` with a range, `color`, `bool`,
`choice`), with defaults.

Adding a kind: one entry in the catalog + its implementation in
`pixi-svelte/src/lib/elementFx/kinds.ts`, whose table is `Record<ElementFxKind, …>`, so the type
check fails until it exists; `check:element-fx` fails too.

## 3. Data model (all optional, additive)

```ts
interface ElementFxEntry {
	id: string;                       // unique in its list: efx1, efx2…
	kind: ElementFxKind;
	trigger: 'always' | 'enter' | 'cue' | 'keyed';
	cue?: string;                     // trigger 'cue'
	stopCue?: string;                 // any trigger: stops it and puts the element back at rest
	durationMs?: number;              // one play; unset ⇒ the kind's
	delayMs?: number;                 // before it starts
	intensity?: number;               // 0…4, 1 = the kind's reference strength
	repeat?: number;                  // plays; 0 = until stopped; unset ⇒ once (forever for 'always')
	params?: Record<string, number | string | boolean>;
	disabled?: boolean;
}
BaseNode.elementFx?: ElementFxEntry[]   // every node kind
Scene.elementFx?: ElementFxEntry[]      // the whole screen
```

**`keyed`: the state machine and the timeline.** A `keyed` entry never plays on its own clock. A
timeline keys two channels per entry on its node — `efx:<entry id>`, how far through the effect it
is (0 = at rest … 1 = its end), and `efx:<entry id>:intensity`, a multiplier of its strength — and
the effect sits exactly there, so scrubbing the timeline scrubs the effect. Because a component's
state-machine states play timelines, a state poses its Element FX and a transition's blend mixes
them (a side that does not key one counts as at rest: progress 0, strength ×1). The evaluator
(`engine-cinematic`) samples `efx:` channels beside `fx:` ones, `blendNodeSamples` mixes them, and
`validateNodeActors` accepts a node's keyed channels and reports any other `efx:` channel.

`readElementFxEntries` is the one reader: an unknown kind or trigger, a repeat id or a malformed
entry is dropped; numbers are clamped; a malformed param falls back to its default. Nodes are stored
verbatim (as every node field is); `normalizeScene` keeps `Scene.elementFx` verbatim too, so an
entry a newer build wrote survives an older save. `componentFields.ts` lists the field so a
component save does not graft a cleared list back.

**Ship chain (rule 8): no new asset class.** The entries ride inside the layout and component docs,
which already ship (export → bake → pull). A crash/crumble snapshot is taken at runtime.

## 4. Runtime (`pixi-svelte/src/lib/elementFx`)

`playElementFx(container, { kind, durationMs, delayMs, intensity, repeat, params, pose? }, host)`
returns a handle (`done`, `stop()`, `active`). With `pose` (a getter read every frame) the effect is
POSED instead of played: it sits at the given progress and strength and never ends on its own
(progress 0 or nothing ⇒ at rest); this is how a `keyed` entry follows its timeline. One runtime per container composes everything playing on it,
the way `cameraEffects` composes the stage:

- **Motion** folds every effect's offset / scale / rotation / skew / alpha, each about its own pivot
  (the centre, the base, the top), into ONE change of the container's own transform. The container
  stays owned by whoever placed it: each frame the runtime compares the container's values with the
  ones it wrote, and any the owner changed (a binding, a timeline, a resize) become the new rest. At
  the end every value is put back exactly.
- **Filters** stack after the container's own filters, bounded to the element by a `filterArea` (its
  box plus a margin, so an animating rig is not clipped). The custom passes (perspective, wave,
  twist, curl, ripple, bulge, shine, colour mix, dissolve, sphericon) are GLSL written to compile on
  WebGL1 (GLSL ES 1.00: no `transpose()`, no reserved words such as `flat` as names) and WebGL2; they work in the element's own coordinates through `uElement` /
  `uPad`. Glow, outline, chromatic, glitch, pixelate (`pixi-filters`), blur and hue (`pixi.js`)
  reuse the library. A GL-only pass is skipped on a WebGPU renderer (the game forces WebGL).
- **Break** renders the element once (`renderer.generateTexture`), hides it, and flies the still in
  pieces: a few small `MeshSimple`s the batcher draws together, placed beside the element at its
  depth and rest transform. With no renderer it fades instead.
- **Time** follows the game's turbo through the particle clock (`particleTimeScale`).
- **Zero cost at rest**: no runtime, no ticker callback, no filter on a container with nothing
  playing; nothing is filtered before the element has a size (art still loading).

## 5. Engine wiring

- **Node**: `<LayoutNodeView>` renders a node that carries Element FX inside ONE extra container
  (with the node's `zIndex`, so it sorts as the node did), anchored under the node id, and mounts
  `<ElementFxPlayer>` in it while the node is shown. A node without Element FX renders exactly as
  before (parity). The reel grid node is skipped there. A `keyed` entry reads its pose off the
  timeline sample driving the node (`createNodeFold`'s `timelineSample`).
- **Screen**: `<LayoutScene>` does the same around everything a screen with `elementFx` draws,
  anchored `screen:<id>`. A mount that gives a screen a container of its own (`FlowV2Mount`,
  `EngineScreenMount`) passes `parentTarget`, and the scene registers that container as
  `screen:<id>` too (no child added), so the Flow can aim at any shown screen. The
  base-game screen is drawn in two parts around the reels; each plays the screen's FX on its own.
- **Reels**: the reel stack's own container (`Game.svelte`'s `MainContainer`) is anchored `reels`
  and plays the reel grid node's `elementFx`. No container is added (parity).
- **Cues** come off the component-signal bus (`getComponentSignal`), scoped like every other cue,
  so a Flow `fireCue`, a game signal and a component signal all reach them. Inside a component they
  also come off the instance's own fired signals (`getComponentFiredSignals`), which is where its
  timelines and state machine raise their cues.

## 6. Flow

`elementEffect { target, kind, durationMs?, intensity?, repeat?, color?, blocking? }` and
`stopElementEffect { target }` (`standardVocab.ts`; implemented in `apps/lines` `flowEffects.ts`).
The target resolves through the named anchors: `reels`, `screen:<id>`, or a node id (a group, a
component placement, a coded mount, or any node carrying Element FX). The `ElementFxTarget` enum is
`reels` in the kind's vocabulary; the launcher widens it per project (`collectElementFxTargets`)
for the editor and the publish gate alike. Element FX cue names are harvested into the cue palette
(`collectSceneCueNames`), so an *On cue* entry is a `fireCue` the author drags out.

## 7. Authoring (Scene / Component Editor)

An **Element FX** section on every node's Properties and on the Screen panel: add an effect from a
grouped kind picker, set its trigger, cue, timing, strength and the kind's own params, reorder,
disable, remove. **▶** previews it ON the stage: the editor captures the element alone (everything
else hidden for a frame), hides it, and plays the real runtime on that still in a Pixi overlay — so
the preview is the game's effect, on a still (a playing rig freezes for the preview).

A `keyed` entry adds two rows to the node's **Animate** timeline (progress and strength). Keying
them and scrubbing or playing the timeline — or previewing a state of the component's state
machine — poses the effect on the stage through the same capture overlay.

## 8. Gates

- `pnpm check:element-fx` (`tools/fx-spike/elementFx.ts`): the catalog, the reader, every motion
  sampler (finite; rest at the end; exits hidden; enters start hidden), the runtime on real Pixi
  containers (exact restore, owner writes kept, exit holds and their release, the break fallback,
  filter stacking and restore, no pass before a size, teardown, turbo), `keyed` posing (rest, hold,
  scrub, strength, the channel names, the evaluator, the state blend, validation), the WebGL1 GLSL
  scan, and the wiring.
- `pnpm --filter launcher-api check:element-fx-flow`: cue harvest, the target list and the vocab
  composition.
- `check:flow-bonus-modes` pins the Element FX actions and enums and hashes the rest of every
  vocabulary as before.

## 9. Open / next

- Owner pixel pass in a published game and in the editor (§ status).
- Element FX on HUD instances (`LayoutEditable` renders them outside `<LayoutNodeView>`).
- A rotated element plays about its axis-aligned box (the shader mapping assumes no rotation).
- Driving a `keyed` entry from a **Bind to value** binding (a component param, an engine value) as
  well as a timeline; keying an entry's own params.
