# Invisible Shader Graph: particle materials (step 8d)

> **Decided 2026-10-25.** Design pass for step 8d of [invisible-shader-graph.md](invisible-shader-graph.md)
> §8, done with the `invisible-fx` agent. §16 is decided: the recommendations, under the owner's
> standing instruction to go with them. Being built as 8d.1–8d.8 (§15). Plan for the
> particles side: [invisible-fx.md](invisible-fx.md). Current state: [status/shader-graph](../status/shader-graph.md),
> [status/fx](../status/fx.md). Each step in §15 is its own PR, merged only when every gate passes.

## 1. The ask

A shader graph becomes the **material** an emitter layer's particles draw with. The author picks it
per layer in `/fx`, sets its params there, and sees it on the preview. The open questions from §8:
which per-particle inputs a graph can read (age, life, colour, index), and what a material costs on
a phone.

## 2. What a particle is today

**How it draws.** A particle is a Pixi `Sprite`. The library's `Particle extends Sprite`
(`@barvynkoa/particle-emitter` `lib/particle-emitter.es.js` line 1675), and the emitter adds each
one to its parent container with `addChild` / `addChildAt` (lines 2201–2204 and 2345–2348). The
parent is the layer's own container: `<ParticleEmitter>` builds `new Emitter(parentContext.parent, …)`
(`pixi-svelte/src/lib/components/ParticleEmitter.svelte` line 203), inside `<EffectLayer>`'s
`<Container>` (free, line 289) or `<RigBoneAttach>` (bone, line 273). So the sprites batch through
Pixi's default batcher like any other sprite. Pixi 8's `ParticleContainer` is not used by FX
(`pixi-svelte`'s `ParticleContainer.svelte` / `Particles.svelte` wrap it, for a Storybook story
only; `Particles.svelte` also never removes its ticker callback).

**Per-particle data.**

| Data | Where it lives | Written by |
|---|---|---|
| Age, life | `age`, `maxLife`, `oneOverLife`, in **emitter seconds** | `Emitter.update` (line ~2089) |
| Progress | `agePercent` = age ÷ life, through the emitter's `customEase` if set | `Emitter.update` (line 2111) |
| Position, rotation, scale | `x`, `y`, `rotation`, `scale` | the movement, rotation and scale behaviours; `fxForces`, `fxSpeed`, `fxScale` |
| Tint | `tint` | `color`, `colorStatic`, `fxColorOverlay` (`engine-fx/src/behaviors.ts` line 342) |
| Alpha | `alpha` | `alpha`, `fxAlpha` (`behaviors.ts` line 201) |
| Texture, flipbook frame | `texture` | `textureRandom` / `animatedSingle`, injected by `bindArt` (`engine-fx/src/bindArt.ts`) |
| Art pivot, rotation offset | `anchor`, `skew` | `fxSprite` (`engine-fx/src/sprite.ts` line 95) |
| Blend | `blendMode` | the `blendMode` behaviour, the same for the whole layer |
| Scratch | `config`, a bag per particle | behaviours (`fxAlpha`'s factors, `fxSpeedDir`, `config.velocity`) |
| Index, seed | **none** | — |
| Velocity | only in some movement behaviours' scratch, each in its own form | — |

Emitter seconds are not wall seconds. The runtime advances an emitter by `deltaMS × 0.00234`
(`engine-fx/src/playback.ts` `DEFAULT_EMIT_SPEED`, line 23), times `effect.timeScale` and the turbo
particle clock (`pixi-svelte/src/lib/particleClock.ts` `particleStepSeconds`). A particle's `age` is
therefore about 2.34× the wall seconds it has lived at 1×.

**Where a material can hook in.** Three places:
1. **The layer's container**, as a filter (option a).
2. **The draw of the particles themselves**: the sprites stay the library's logic objects, and
   something else draws them (option b).
3. **The art**, before it reaches the emitter (option c).

## 3. How a compiled graph plays today

- **The body.** `compileShaderGraph` (`engine-shadergraph/src/compile.ts`, lines 725–755) emits:
  - its uniforms: `uFx` (progress, seconds, intensity, looping), `uSeed` when a Seed node is used,
    and one `uP<n>` per param;
  - then a `main` that starts from `px = efxPx()`, `uv = efxToUnit(px)`, `uvSquare` and, when read,
    `pixel = efxSample(px)`;
  - and writes `finalColor`, premultiplied, with rgb clamped to alpha unless the Output blends Add.
- **The shell.** `ElementFxFilter` (`pixi-svelte/src/lib/elementFx/shaders.ts` line 82) puts
  `HEADER` (line 36) and `linkGlsl(body)` together. The header defines the nine helpers the body and
  the library may call: `EFX_HEADER_FUNCTIONS` (`constants-shared/glslLibrary.ts` line 625).
- **The runtime.** `graphFilter` and `graphPass` (`pixi-svelte/src/lib/elementFx/custom.ts`, lines
  37 and 57):
  - write `uFx` each frame from the element's play (line 75);
  - draw one seed per element;
  - write each `uP<n>` through `elementFxParamUniform`.
- **The fail-safe.** `readCustomElementFx` (`constants-shared/elementFx.ts` line 1592) drops an
  effect whose body calls an `efx…` function that is neither a library entry nor a header helper
  (`unknownEfxCalls`, `glslLibrary.ts` line 654).

**Finding: the body's whole contract with its shell is the nine header helpers, the uniforms it
declares itself, and `finalColor`.** A second shell that defines the same helpers with particle
meanings runs the same compiled body, with no second compiler target. This is what makes option (b)
cheap on the graph side.

## 4. The options

| | (a) Emitter-wide filter | (b) Per-particle shader | (c) Baked material |
|---|---|---|---|
| What it is | `graphFilter` on the layer's container | The layer's particles drawn as one mesh, through the compiled body in a particle shell | The graph rendered at author time into a flipbook strip the particles play as their art |
| Per-particle inputs | None: UV spans the emitter's bounds, progress is a play's | Progress = age ÷ life, Seed per particle, UV across the particle, Sample = its texture, its colour and index | Progress only, quantised to the strip's frames; one seed per strip |
| Live params, ⚡ drives | Yes | Yes (uniforms, set per layer) | No: fixed at bake time |
| Phone cost | One offscreen pass per emitter: an FBO switch, a texture the size of the bounds, the bounds recomputed each frame. Fill = the bounds' area × cost, whatever the particle count | One draw call per layer. Fill = the sum of the particle quads' area × cost, so overdraw counts. CPU: one buffer upload per frame (§6) | None beyond plain sprites. Texture memory: frames × tile size |
| Breaks | Additive layers: the children render into a transparent texture, which then composites normally, so an Add layer darkens what is behind it (believed, not yet measured). Particles leaving a fixed filter area are clipped | Batching across layers (a material layer is its own draw call). Tier-C rig particles (not quads). WebGPU (GL only; the game forces WebGL) | Resolution: a particle scaled up blurs. A graph edit does nothing until someone re-bakes, and only a browser can bake |
| Version skew | Same as an Element FX | A pre-8d runtime ignores the material and draws plain sprites (§11) | None: every runtime plays a flipbook |
| Effort | Small. Already exists for placed effects (below) | Large: about 8 PRs (§15) | Medium to large: a browser-side bake, an upload route, re-bake tracking |

**(a) already exists.** An Element FX (built-in or `custom:<id>`) can sit on a placed `effect` node
in the Scene Editor (design [element-fx.md](element-fx.md) §2), which is an emitter-wide filter.
Its limit is the box: the runtime measures it once, when the first effect starts (`runtime.ts`
`measure`, line 234, through `getLocalBounds`), plus a margin of at most 256 px (`areaFor`,
line 242). On a particle node that is wherever the particles happened to be at that moment. That is
an Element FX follow-up (a fixed room for effect nodes), not a material.

**Rejected:**
- **A filter per particle.** One render pass per particle.
- **Pixi 8 `ParticleContainer` with a custom shader.** It cannot carry the inputs:
  - its attributes come only from the fixed module table `particleData`
    (`pixi.js/lib/scene/particle-container/shared/ParticleContainer.mjs` lines 40–48), so age, seed
    and index have no attribute short of patching internals;
  - it takes `IParticle` objects, not the library's sprites, and needs one texture source;
  - it is marked experimental.
- **A custom batcher for sprites.** Every sprite is fixed to the `default` batcher
  (`BatchableSprite`'s `batcherName`), and routing particles elsewhere means Pixi internals.

## 5. Recommendation

**Build (b).** It is the only option that gives the graph per-particle meaning, and it reuses the
compiled body, the registry, the fail-safe reader and the ship chain unchanged.
- (a) needs no new work for 8d: it is already there for placed effects.
- (c) loses what makes a material worth having (seed, live params, colour, index) and adds a
  re-bake chore that only a browser can do. Keep it as a later escape hatch ("Bake to frames") if a
  phone proves a material too slow (§13).

## 6. How (b) works

**The material renderer** (`pixi-svelte/src/lib/particleMaterial/`, plain TS, no Svelte):
- **Hidden sprites.** The emitter gets a hidden child container (`visible = false`) as its particle
  parent, so Pixi skips those sprites. The library still owns their whole life.
- **One mesh.** A `Mesh` with its own geometry and a shader built from the effect sits beside the
  hidden container in the layer's container, at its depth.
- **The mirror.** After `emitter.update`, `sync()` walks the hidden children in order (so
  `addAtBack` holds) and writes four vertices per particle:
  - the corners, from the particle's own local transform (`updateLocalTransform()`: position,
    rotation, scale and the `fxSprite` skew), its anchor and its texture's orig and trim, exactly as
    Pixi builds a sprite's quad, grown by the effect's padding;
  - the atlas mapping for the current frame (rotated frames as Pixi rotates them), and the trim box
    in unit space;
  - tint × alpha, progress, seconds, strength, looping, the seed and the two indexes.
- **One draw call per layer.** The blend is the layer's.
- **The bounds** come from the corners the mirror already computed.

**Seed and index.** An init behaviour `fxMaterial` (registered by `registerFxBehaviors`) writes
both at spawn and clears them on recycle. The renderer injects it into the bound config, as
`bindArt` injects the art behaviour, so the stored config stays pure (FX contract 1). The library
calls init behaviours once per spawn wave, with the wave's first particle (lines ~2228–2250), so
the behaviour sees the wave's size.

**The particle shell** (`constants-shared/particleShell.ts`, dependency-free like `glslLibrary.ts`,
so the launcher and the headless gates can lint it without Pixi):
- **The header.** It defines the nine `EFX_HEADER_FUNCTIONS` with particle meanings:
  - `efxPx()` = the particle's unit position × its on-screen size;
  - `efxSize()` = that size, in device pixels;
  - `efxToUnit` / `efxFromUnit` divide and multiply by it;
  - `efxSample(px)` reads the particle's texture through the atlas mapping and answers 0 outside
    the trim box, as the filter's `uInputClamp` does;
  - `efxInside` tests the unit square.
- **The body.** `particleShellSource(effect)` drops the body's two declarations
  `uniform vec4 uFx;` and `uniform float uSeed;`, found by the names `shader.uniforms` gives for the
  `time` and `seed` sources, never by guessing. It declares them as varyings of the same names.
  `uP<n>` stay uniforms, one set per layer.
- **The finish.** It multiplies the colour by the particle's tint × alpha (the rule is in §7) and
  links the library as `ElementFxFilter` does.
- **Varying budget.** Seven vec4 rows: unit + size, `uFx`, the atlas mapping, the trim box, the
  colour, one row for the mapping's second half with the two indexes, and `uSeed`. WebGL1
  guarantees eight, which leaves one for a later input such as velocity.

**Fail closed, never invisible.** A material draws the layer as plain sprites (the hidden container
shown, no mesh) when any of these holds:
- its kind is not registered;
- the layer is Tier C;
- the layer's frames sit on more than one texture source;
- the layer is over a cap (§10);
- the program does not compile and link on the device: a one-time check per material, at first use,
  logged once.

## 7. Inputs

| Graph input | On an element (today) | On a particle |
|---|---|---|
| UV, UV (square) | 0…1 across the element's box | 0…1 across the particle's frame (its untrimmed box); padding reaches past it |
| Element size | The element on screen, px | The particle on screen, px (frame × scale × world scale × resolution) |
| Time → Progress | Through the play | **Life** mode: age ÷ life (`agePercent`). **Loop** mode: seconds ÷ the effect's length, wrapped |
| Time → Seconds | Since the play started | The particle's age in wall seconds at 1×: emitter age ÷ (emit speed × 1000). Turbo still speeds it, as it speeds an Element FX |
| Time → Strength | The entry's strength | The layer's material strength (0…4, default 1) |
| Time → Looping | 1 while the entry loops | 1 in Loop mode, 0 in Life mode |
| Param | The entry's value | The layer's value for that param |
| Seed | One per element, 0…97 | One per particle, 0…97, drawn at spawn |
| Sample element, Outline, Relief height | The element | The particle's own texture, at its current flipbook frame |
| **Particle → Colour** (new) | White, opaque | The particle's tint × alpha, premultiplied: what `color`, `fxColorOverlay`, `alpha` and `fxAlpha` set |
| **Particle → Wave index** (new) | 0 | Its place in its spawn wave ÷ (wave size − 1); 0 for a wave of one. A burst fan reads 0…1 across |
| **Particle → Spawn order** (new) | 0 | Its spawn number ÷ Max particles, wrapping: a continuous emitter reads a slow 0…1 ramp |

**New node, not new meanings only.** UV, size, Time, Seed and Sample keep their names and gain a
particle meaning: a graph built for elements works as a material, and the other way round. Colour
and the two indexes are new. They are one **Particle** input node whose GLSL calls new header
helpers (`efxParticleColor()`, `efxParticleWave()`, `efxParticleOrder()`), added to
`EFX_HEADER_FUNCTIONS` and to the element `HEADER` with the neutral values above. Two things follow:
- a particle graph placed on an element plays, as if on one white particle;
- a runtime older than 8d drops an effect that calls them, through the existing `unknownEfxCalls`.

**One Output.** No separate particle output. A doc setting **Made for: Elements | Particles**
(`madeFor`, absent = elements) never changes what plays. It orders the pickers, picks the preview
element in `/shaders` and switches the cost budget (§10).

**The colour rule.** A graph that reads Particle → Colour owns the particle's colour and alpha, and
the shell multiplies nothing. One that does not is tinted and faded after, as a sprite is, so every
existing colour and alpha curve keeps working. The shell tells which by the `efxParticleColor(` call
in the body. An Output alone therefore draws the particle exactly as the plain sprite would, which
is the parity gate in §15 step 2.

**What particles ignore.** They ignore three parts of an effect, and both editors say so:
- **its motion** (curves and the motion graph): a particle's own behaviours move it;
- **its passes** (glow, outline…): each is a filter;
- **the motion program's padding**: the doc's fixed padding is used.

The effect's phase is not used; its length sets the Loop mode's period.

**Left out of v1: velocity.** The library keeps it only in behaviour scratch, in different forms.
A finite difference of positions would work, but a pixel graph cannot stretch a quad along the
direction of travel, which is what velocity is mostly wanted for.

## 8. Data

**`EmitterLayer.material`** (`engine-fx/src/types.ts`, optional, sprite layers only):

```ts
interface EmitterMaterial {
	kind: `custom:${string}`;   // a compiled Shader Graph effect
	time?: 'life' | 'loop';     // absent = life
	intensity?: number;         // 0…4, absent = 1
	params?: Record<string, number | string | boolean>; // by param id; absent = its default
}
```

- **The normalizer.** `normalizeEffectDoc` keeps a well-formed material on a sprite layer, clamps
  it, and drops a malformed one. A layer without one is byte-identical.
- **Validation** names a material whose kind the project does not compile.
- **Exposed parameters.** They gain a layer-scoped path family: `material.intensity` and
  `material.param.<id>`, in `parseEffectParamPath` (`engine-fx/src/params.ts`).
  - The applier writes a uniform; there is no behaviour to rebuild.
  - `applyEffectParamDefaults` writes the default into `material.params`, so a renderer with no live
    values still draws the default look.
- **Per placement.** Each placement sets a material's params through the placement values that
  already exist (`EffectNode.params`). No new placement field.

**`ShaderGraphDoc.madeFor`** (`'particles'` or absent). It is compiled into the effect only when
`'particles'`, so every existing doc compiles byte-identically.

## 9. Authoring

**`/fx`** (sprite layers). A **Material** section below **Art**:
- **Material**: *None (plain sprites)*, then the project's compiled effects, "Made for particles"
  first. The list comes from `GET /api/shaders/effects`, which `fx` (and `rigger`, for the
  overlay below) may read through `shaderEffectsReadScope` (as built in 8d.4: the compiled set
  only, not the graph docs). The page registers the set with the existing
  `$lib/customElementFx.svelte.ts`.
- **Time**: *Over the particle's life* or *Loop at the effect's length*.
- **Strength**, and the material's params as rows (number, colour, switch, choice), each with **⚡**
  to expose it like any inspector row.
- **Load**: a bar for the layer against its budget, and a badge on the layer in the Layers list
  (§10).
- **Notes**, shown when they apply:
  - this effect's passes and motion do not play on particles;
  - over budget;
  - Max particles above the cap (the material is then off);
  - frames on two atlas pages;
  - the effect was deleted or does not compile (the particles draw plain).
- **Open in Shader Graph**: a full-page link to `/shaders?graph=<id>`, never an iframe.
- **The preview.** `FxStage` draws the material through the same renderer, so a param slider or a
  ⚡ preview slider changes it live, with no reset.

**`/shaders`.**
- **The Particles element.** The preview's element list gains **Particles**: a stock **Burst** (a
  ring of about 24, replayed every two seconds) or **Fountain**, on a soft dot or any atlas region
  from the existing picker, drawn through the same renderer. Each particle has its own age, so the
  `t` scrubber gives way to play / pause / restart. Strength drives the material's strength. Params
  play at their defaults, as the element preview does today.
- **Made for: Particles** switches the cost meter's budget and makes Particles the default preview.
  It also shows the "ignored on particles" notes against the effect's passes and motion.
- **Thumbnails** stay element-based.

**The other previews.** These draw the material through the same renderer, so the four renderers
`invisible-fx.md` keeps in step stay in step:
- the Scene Editor's `EditorEffectLayer`;
- the Rigger and Symbols `fxOverlay`. Its committed bundle `static/rigger/vendor/rigger-fx.js` is
  rebuilt (`build:rigger-fx`, held by `check:vendored-bundles`), and the Rigger's `view.html`
  fetches the compiled set.

## 10. Budget

A material's cost is its graph cost × the pixels its particles cover, overdraw included. The caps:

| Cap | Value (starting) | Kind | Where it shows |
|---|---|---|---|
| Graph cost / element reads, made for particles | 150 / 4 (elements: 400 / 16) | Warning | `/shaders` status bar and node chips; `/fx` Material section |
| Max particles on a material layer | 512 | Hard: above it the layer draws plain | `/fx` note on the row |
| Layer load (cost × covered pixels, in the layer's own pixels) | 32 M | Warning: amber from 75 %, red over | `/fx` Material bar and the layer's badge |
| Effect load (its layers summed) | 64 M | Warning | `/fx`, beside the effect's name |
| Material layers drawing at once in a game | 8 | Hard: a ninth draws plain, decided at mount and kept for its life (no pop) | `?fxdebug=1` |
| Tier-C (rig clip) layers | No material | Hard | `/fx` hides the section |

- **Scale of the budget.** One layer at its budget costs about what one Element FX at its budget
  costs on a symbol-sized element: cost 400 over a 200 × 200 element is 16 M.
- **The meter measures; it does not guess.** The mirror already computes every quad, so the renderer
  reports its peak load (Σ quad area × cost × padding) in layer pixels, and the stage zoom does not
  move it. Before the preview has run, `/fx` shows an estimate:
  `live ≈ min(Max particles, per wave × max life ÷ frequency)` × the largest frame × the largest
  scale² × (1 + 2 × padding)² × cost.
- **On a phone**, the game's existing `?fxdebug=1` prints each material layer's state (on, or plain
  and why) and its measured load. The owner reads real numbers there, which calibrates these
  starting values (step 8).
- **CPU.** About 370 bytes uploaded per particle per frame (four vertices of seven attributes).
  Pixi skips the hidden sprites' world transforms and batching, which offsets much of the mirror's
  work. Not measured yet.

## 11. Shipping (rule 8)

**No new asset class.** A layer names its material as the string `custom:<id>` inside the
`EffectDoc`. The material therefore rides two chains that already exist:
- **The effect.** It travels export → `deploy/effects/` → bake → pull → `bakedEffects()`, pruned to
  reachable effects (`runtimeBundle.ts` `pruneUnreachableEffects`).
- **The compiled shader.** Both bundle paths keep the shader effects a bundle names by walking every
  value outside `shaderEffects`: `namedShaderEffects` / `customKindsNamed` (`shaderExport.ts`
  line 97, called at `runtimeBundle.ts` line 532), and the bake's own walk (`bake-editor-doc.mjs`
  lines ~1368–1387). A material's kind inside `effects` is such a value, so its compiled effect
  ships.
- **The game** registers `shaderEffects` with `setCustomElementFx` before its first render, as
  today.
- **A material whose graph was deleted or does not compile** is named by Publish
  (`shaderEffectsMissing`, `unshippedCustomKinds`) and by the bake's log. Those particles draw plain.

Step 4 proves all of this in `check:shader-pipeline` rather than assuming it. Option (c) would have
needed its strips written as ordinary atlases (so the editor-art export ships them as a layer's
`art.assetKey`), or a new asset class through the whole chain.

## 12. Version skew

| Runtime | What a layer with a material does |
|---|---|
| Before 8d | `<EffectLayer>` reads named fields only, so `material` is ignored and the particles draw plain. The game never runs `normalizeEffectDoc` (only the export and storage do). The compiled effect still ships and registers as an Element FX that nothing names. `material.*` drives fail to parse, and the applier skips them (`params.ts` line 445) |
| 8d on, material from a newer launcher | A body calling a library entry or particle helper this runtime lacks is dropped by `readCustomElementFx`. The kind is unregistered, so the particles draw plain |
| 8d on, a device that will not compile the shell | The first-use check fails, the layer draws plain, and it is logged once |
| Rigger / Symbols overlay | Rebuilt in the same PR as any `engine-fx` or `$lib/fx` change (`check:vendored-bundles`) |

**A soft rollback floor:** the first release with step 3. Below it, every material draws plain;
nothing breaks or goes invisible. It is written in `docs/design/games-deploy.md` beside 8a's.

## 13. Risks

| Risk | Handling |
|---|---|
| Overdraw makes a material slow on a phone | The particle budget, the measured load meter, the hard caps, and the `?fxdebug=1` readout for an owner phone check. If a real effect cannot fit, (c) "Bake to frames" is the escape hatch |
| The shell drifts from the element shell | One header-function list (`EFX_HEADER_FUNCTIONS`) both shells must define; `check:element-fx` holds both to it. `shader-compile` builds every reference, twin and node body through the particle shell on WebGL1 and WebGL2 |
| The uniform-to-varying rewrite misses a body | It finds the two declarations by the names `shader.uniforms` gives, in the one form the compiler writes them. A fixture runs it over every compiled body the gates know. A body it cannot convert draws plain |
| Varyings are tight on WebGL1 (seven of the eight rows it guarantees) | The rows are counted in the shell's fixture; a later input must pack into the last row or replace one |
| Four renderers drift | One renderer class in `pixi-svelte`, used by the game and by the three launcher stages through `effectEmitter.client.ts` |
| The material looks different from the sprite it replaces | The Output-alone parity gate: static, rotated and trimmed frames, flipbook, `fxSprite` pivot and offset, tint, overlay, fade, additive |
| Per-frame upload with many live particles | Capacity capped at 512; only live particles are uploaded. Splitting static from dynamic attributes, as Pixi's `ParticleContainer` does, is a later optimisation |
| A stale `/fx` tab drops a layer's material on save | `/fx` has no doc history today. The material is one picker away; noted in the guide |
| Emitter seconds confuse an author | The Seconds output is converted to wall seconds (§7), so a noise speed authored in `/shaders` matches |

**Where I am unsure:**
- **Custom mesh shaders.** I believe a `Mesh` with a custom shader in Pixi 8.22 gets its transform
  and group colour uniforms bound as the usual custom-mesh pattern expects. Step 2's harness settles
  it first.
- **The link check.** Pixi does not expose a program's link status publicly. The first-use check may
  have to compile Pixi's processed sources on `renderer.gl` itself.
- **Additive layers under (a).** The claim that (a) darkens additive layers is reasoned from how a
  filter composites, not measured.
- **The budget numbers** are estimates with no device measurements behind them. The headless
  harness runs on SwiftShader, whose timings say nothing about a phone GPU.
- **Hidden sprites and bounds.** I have not checked whether a hidden particle container still counts
  in a node's `getLocalBounds` (Element FX on a material layer's node). The mesh's own bounds cover
  the particles either way.

## 14. Out of v1

- Velocity as an input, and anything that deforms a particle's quad (a stretch along travel).
- Motion and passes on particles.
- Materials on Tier-C rig particles.
- Materials on coded emitters (win coins, flight trails): `<ParticleEmitter material>` makes this
  a small later change.
- (c), baked materials.
- A runtime governor that switches layers to plain under load.
- WebGPU.
- A per-preview param value in `/shaders`.

## 15. Build plan

Each step is its own branch and PR, with its status entry, and merges only with `check:all` green,
svelte-check at baseline, and the current games building with no changed screen.

1. **The particle shell and the Particle node** (engine).
   - **Contents:**
     - `constants-shared/particleShell.ts`: the particle header, the vertex shader and
       `particleShellSource(effect)`;
     - three header helpers added to `EFX_HEADER_FUNCTIONS` and to `HEADER` with element meanings;
     - the **Particle** input node in `engine-shadergraph`.
   - **Gates:**
     - `compile.fixture.ts`: the node compiles at every output and means its neutral values on an
       element; every doc without it compiles byte-identically (dump against the base);
     - `check:element-fx`: the header list matches both shells' text, and the reader takes a body
       calling the new helpers;
     - `shader-parity`: the 50 built-ins are pixel-identical after `HEADER` grew;
     - `shader-compile` gains a `particles` sheet: every reference graph, twin and node body, built
       through the particle shell, compiles and links on WebGL1 and WebGL2.
   - **Exit:** those green; nothing plays differently.
   - **As built** (#1354):
     - **Layout.** 7 vertex attributes (`aPosition` = corner + unit, `aEfxFrame` = size + seed,
       `aEfxMap`, `aEfxMap2` + wave and order, `aEfxTrim`, `aEfxColor`, `aEfxTime`; 27 floats,
       108 B a vertex) and 7 varying rows, inside WebGL1's guaranteed 8 and 8.
     - **Group colour always last.** The mesh's own colour (`uColor` × `uWorldColorAlpha`, the tint
       and alpha it inherits) multiplies last even when the graph owns colour, so a layer's fade
       still fades it. This goes past §7, which leaves an owning graph alone.
     - **§13 "Custom mesh shaders" is settled** for the transforms and group colour: Pixi 8.22
       binds them on a custom `Mesh` by name. A group alpha or tint below 1 is 8d.2's to check.
     - **The conversion refuses** a preprocessor line or backslash, an unended comment, duplicate
       or misnamed uniform sources, anything but one `void main(void)`, and any shell name (or a
       name only the element pass declares, `vTextureCoord`, `uElement`…) in the body.
     - **Custom GLSL** (8c) now also refuses the particle shell's 38 names as a port, local or loop
       counter, so a stored body declaring one (`uColor`, `aEfx*`…) stops compiling.
     - The byte-identity gate was a dump of 2,210 docs against the base, 0 differing.
2. **The material renderer** (engine, `pixi-svelte`, no doc change).
   - **Contents:**
     - `particleMaterial/`: the hidden container, the mesh and the mirror;
     - the `fxMaterial` seed and index behaviour;
     - the blend, the bounds, the 512 capacity and the first-use link check;
     - `fxMaterial` lives in `engine-fx`, so `rigger-fx.js` is rebuilt in this PR
       (`check:vendored-bundles`).
   - **Gates:** `pnpm --filter fx-spike particle-material` (new; headless Chromium, WebGL1 and
     WebGL2), mutation-checked:
     - an Output-alone material matches the plain sprite path, within the twins' tolerance, over
       static, rotated and trimmed frames, flipbook, `fxSprite` pivot and offset, tint, overlay,
       fade and Add;
     - progress, seed and both indexes differ per particle as specified;
     - a program that fails to link, and a layer over the cap, both draw plain;
     - 20,000 frames reallocate nothing after warm-up;
     - the CPU time to sync 512 particles is logged.
   - **Exit:** parity and the per-particle inputs proven headless.
   - **As built** (#1366):
     - **API.** `new ParticleMaterial({ host, effect, maxParticles, textures, time, intensity,
       params, emitSpeed })` (`pixi-svelte/particleMaterial`); `particles` is the emitter's parent,
       `bindConfig` adds `fxMaterial`, `sync(renderer)` after `emitter.update`, `plain` says why a
       layer is plain.
     - **Capacity** is the layer's Max particles at mount, capped at 512, not always 512. A drive
       raising it later turns the layer plain (8d.3 to settle).
     - **Plain for good** once a layer fails while playing (live over capacity, another texture
       source, a link failure). "Not WebGL" is a fallback beyond §6.
     - **Tolerance.** Where the two quads match, the twins' rule. Where the material's quad is the
       padded frame and the sprite's the trimmed box, 0.6 % of pixels (SwiftShader snaps corners
       to 1/16 px), held honest by a negative control a quarter texel off that must fail.
     - **Settled from §13:** hidden sprites do not count in a node's bounds; group alpha and tint
       below 1 match the sprites.
     - **Upload.** WebGL2 uploads only the live part; WebGL1 the whole buffer (Pixi's 5-argument
       `bufferSubData`), sized to the layer.
3. **The material in the game** (engine).
   - **Contents:**
     - `EmitterLayer.material`: schema, normalizer and validation;
     - `<EffectLayer>` → `<ParticleEmitter material>`, with every fallback in §6;
     - the 8-layer game cap;
     - the `material.*` parameter paths;
     - `?fxdebug=1` lines;
     - `rigger-fx.js` rebuilt (an `engine-fx` change).
   - **Gates:**
     - `check:fx-params`: paths, mapping, defaults written into `material.params`, a uniform write
       with no rebuild;
     - fx-spike `roundtrip`: a material survives save → normalize → export unchanged, and a layer
       without one is byte-identical;
     - fx-spike `player`: the reduction picks material or plain correctly, fallbacks included;
     - `check:element-fx` unchanged.
   - **Exit:** a game build plays an `EffectDoc` material (shown headless in step 8). The soft
     floor starts here.
   - **As built** (#1378):
     - **Shown headless now**, not in step 8: `scripts/playtest/particle-material-play.mjs` (by hand)
       plays a real `apps/lines` build with a material layer (one mesh) and without the graph
       (plain, "not registered").
     - **No pop.** Capacity is sized to the highest Max particles a drive can write; a layer that
       could be driven over 512, or without a bound, is plain from mount rather than going plain
       mid-play. A layer with no frames when it mounted stays plain for its life.
     - **The cap is per app** (keyed by `context.stateApp`), so a launcher page with several stages
       gives each its own 8. A dormant event layer holds its slot from mount.
     - **Emit speed** follows the emitter (`setEmitSpeed`) rather than being read once.
     - **The soft floor** went into `games-deploy.md` here, not in step 4.
     - `validateEffectMaterials` exists but is first called by `/fx` (step 5).
4. **The ship chain, proven** (launcher).
   - **Contents:**
     - `shaderReadScope` gains `fx` and `rigger`;
     - `check:launcher-gates`;
     - the soft floor written in `docs/design/games-deploy.md`.
   - **Gates:** `check:shader-pipeline` gains:
     - a layer's material keeps its compiled effect in `shaderEffects` in both Publish and the bake;
     - a deleted or broken graph is named in `shaderEffectsMissing` and in the bake's log;
     - a pruned (unreachable) effect does not bring its material in.
   - **Mutation:** taking `effects` out of the walk fails it.
   - **Exit:** those green.
   - **As built** (#1384):
     - **Proof only for the chain:** both walks already carried `material.kind`.
     - **Narrower than planned:** `fx` and `rigger` read only `GET /api/shaders/effects`, through a
       new `shaderEffectsReadScope`; `shaderReadScope` (graph docs with their Custom GLSL source,
       the list, history) is unchanged. The tools only need the compiled set.
     - **Real code, not scans:** the proof runs the real `buildRuntimeBundle` and the real bake
       script against a local portal.
     - The soft floor was already written in step 3.
5. **`/fx` authoring** (launcher).
   - **Contents:**
     - the Material section (§9), the load meter and badges;
     - `FxStage` drawing through the renderer;
     - the page registering the compiled set;
     - `docs/tools/fx.md` (with `docs-keeper`).
   - **Gates:**
     - fx-spike `model`: set and clear a material, its params, the estimate, Apply preset keeping
       it;
     - the page played headless: pick a material, drag a param and see the pixels change, switch
       the time mode, see the cap note, save → reopen identical.
   - **Exit:** an author picks, tunes and saves a material in `/fx`.
   - **As built** (#1392):
     - **Cost through the effects route:** a compiled effect carries no cost, so
       `GET /api/shaders/effects` also answers `costs` per graph. 8d.7 may carry it in the effect.
     - **Picker by name** until `madeFor` (8d.7). **A choice param has no ⚡**: effect parameters
       are numbers, colours and switches.
     - **`?fxdebug=1`** prints covered px (on a growing peak, throttled, and at release), not load:
       the game has no cost until the effect carries it (8d.7).
     - **The page gate** mounts the real page headless (`fx-page`); the step's exit is played there.
     - **`/fx` for every effect:** editing a layer no longer restarts the others, and Pause / Play
       now stop and re-arm emission (they had no effect before).
6. **The other previews** (launcher).
   - **Contents:**
     - `EditorEffectLayer` and `fxOverlay`;
     - `build:rigger-fx` and the committed bundle;
     - `view.html` fetching the compiled set.
   - **Gates:**
     - `check:vendored-bundles`;
     - a harness drawing a material through `fxOverlay`'s plain-function path;
     - `node --check` on the touched inline scripts.
   - **Exit:** the Scene Editor, Rigger and Symbols show the material.
   - **As built** (#1407):
     - **One mount shared by every launcher stage** (`$lib/fx/layerMaterial.client.ts`), `FxStage`
       included, rather than each preview copying `FxStage`'s keys.
     - **The harness plays the real pieces:** the committed `rigger-fx.js`, `EditorEffectLayer`
       and `view.html`'s own `ensureFxBundle` (`fx-previews`), beyond the plain-function path.
     - **The set's fetch times out** (5 s) and every overlay band waits on the one load.
     - **Finished overlay one-shots end by themselves**, freeing their slots, as the game unmounts
       a binding's effect.
7. **`/shaders`: Made for particles and the Particles preview** (launcher and engine).
   - **Contents:**
     - `madeFor`;
     - the budget switch;
     - the Particles element;
     - the ignored-on-particles notes;
     - picker order;
     - `docs/tools/shader-graph.md`.
   - **Gates:**
     - `compile.fixture.ts`: byte-identical without `madeFor`;
     - `check:shader-editor`;
     - the preview harness on WebGL1 and WebGL2;
     - the page played headless.
   - **Exit:** an artist builds a material in `/shaders` and sees it on particles.
   - **As built** (#TBD):
     - **The cost rides in the effect only when made for particles** (`madeFor`, `cost`,
       `samples`), so element docs stay byte-identical; the effects route's `costs` stays `/fx`'s
       source, and the game's `?fxdebug=1` prints load when the effect carries one.
     - **The page gate** (`shader-page`) mounts the real `/shaders` headless, as `fx-page` does for
       `/fx`; it found that the page never registered the `fxMaterial` behaviour.
8. **Play-QA and calibration.**
   - **Contents:** `scripts/playtest/particle-material-play.mjs`, on a current-games stand-in with
     one material layer.
   - **The script passes when:**
     - the material's program is on the stage;
     - the pixels differ from the same snapshot without `shaderEffects` (plain);
     - the particles still draw (never invisible) when the effect is missing;
     - there are no errors or stalls.
   - **Owner pass:** a phone check reading `?fxdebug=1`, then the caps in §10 updated from it.
   - **Exit:** the play passes; the status and guides are current.

## 16. Decisions (owner, 2026-10-25)

Each is decided as recommended (the owner's standing "go with your recommendations"); the
alternatives are kept for the record.

1. **Which option.** *Recommended:* (b), a per-particle shader, for v1. (c) stays a later "Bake to
   frames" escape hatch, and (a) is not built for 8d: an Element FX on an effect node already is
   one.
2. **Which graphs can be materials.** *Recommended:* any compiled effect. **Made for: Particles**
   orders the pickers and sets the preview and budget, but never restricts. *Alternative:* only
   effects made for particles appear in `/fx`.
3. **Time default.** *Recommended:* over the particle's life (progress = age ÷ life). Loop at the
   effect's length is the other mode.
4. **Colour.** *Recommended:* tinted and faded after, as a sprite, unless the graph reads
   Particle → Colour, in which case the graph owns it. *Alternative:* always multiply after.
5. **New inputs in v1.** *Recommended:* one Particle node with Colour, Wave index and Spawn order.
   Velocity waits (§7).
6. **The caps.** *Recommended:* the starting values in §10 (512 particles a layer, 8 live material
   layers a game, 150 / 4 graph budget, 32 M / 64 M load), revised after step 8's phone check.
7. **Passes and motion.** *Recommended:* ignored on particles, with a note in both editors.
   *Alternative:* refuse such effects as materials.
8. **Where a material lives.** *Recommended:* per layer, so each emitter in an effect can differ.
   Params are set per placement through the existing placement values.
9. **Rollback.** *Recommended:* accept the soft floor (below step 3, materials draw plain).
10. **Who may pick one.** *Recommended:* anyone with `/fx`; no new capability. Writing graphs stays
    with `/shaders`.
