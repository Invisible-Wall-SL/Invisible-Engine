# Invisible Shader Graph — design

> **Approved 2026-10-23** (the owner took every recommendation in §9). Current state:
> [status/shader-graph](../status/shader-graph.md). Agent: `invisible-shader-graph`.
> Each step is its own PR, merged only when every gate passes.

## 1. The idea

Turn the 50 Element FX into a tool. Reverse-engineer them into a library of reusable nodes, then let
artists wire those nodes into new effects in a node-based editor. The result plays wherever an
Element FX plays: a node, a screen, the reels, a symbol's state, or the Flow's `elementEffect`.

## 2. What the 50 effects are made of (inventory, 2026-10-23)

| Kind of implementation | Count | Where | A shader graph covers it? |
|---|---|---|---|
| Hand-written GLSL pass (`ElementFxFilter`) | 17 | `pixi-svelte/src/lib/elementFx/shaders.ts` | **Yes.** This is the core. |
| `pixi-filters` pass (glow, outline, blur, pixelate, glitch, RGB split, colour matrix) | 7 | `kinds.ts` | As **pass nodes**, stacked after the graph |
| Motion only (transform over time: shake, bounce, spin…) | 14 (15 kinds use a motion) | `kinds.ts` | As **curve nodes** writing transform channels, evaluated in JS |
| Break (a still cut into pieces, simulated on the CPU) | 6 | `breakApart.ts` | No. They stay coded and become one **Break output** node with their params |

What the reverse engineering will find is already visible. Each of the 17 passes carries **its own
copy** of the same few building blocks:
- **hash / value noise:** `burnHash`, `stoneHash`, `goldHash`, `meltHash`, `poisonHash`, `zapHash`, `iceHash`, `hash`…;
- **cellular cells:** freeze, petrify;
- **a front creeping in from a side:** freeze, burn, petrify, gold;
- **an edge taken from alpha:** freeze, electrocute, gold;
- **luminance as relief, lit:** petrify, gold;
- **a glint sweep:** freeze, gold;
- **the held in / hold / out timing:** freeze, petrify, gold.

That repetition *is* the node library.

## 3. Shape of the solution

```
ShaderEffectDoc (R2)                     what an artist authors in /shaders
 ├─ settings     phase, duration, padding    (same meanings as an Element FX kind)
 ├─ params       exposed inputs              → number / color / bool / choice rows, as for a built-in
 ├─ pixel graph  nodes + wires               → codegen → ONE GLSL fragment body + uniform layout
 ├─ passes       optional built-in passes    (glow, outline, blur…) after the graph
 └─ motion       optional curve channels     → x, y, scale, rotation, alpha over t
```

Step 2 builds the settings, params and pixel graph as `ShaderGraphDoc` v1
(`packages/engine-shadergraph`); the passes and motion join it in step 3.

- **No graph runs in the game.** On export the graph is compiled to GLSL. The game builds an
  `ElementFxFilter(name, body, uniforms)` from it, which is the same shell (`HEADER`: `efxPx`,
  `efxToUnit`, `efxSample`, `uElement`, `uPad`) the built-ins already use.
- **It plays as a kind.** `custom:<id>`, through the existing Element FX runtime, so it gets every
  existing feature without new code:
  - the triggers (always, when shown, on cue, keyed);
  - keyed ✦ rows on the timeline and state machine;
  - symbol states;
  - turbo;
  - stacking with other effects;
  - the Flow's `elementEffect`.
- **The pickers list them under the 50 built-ins.** Custom effects appear in the Scene Editor, in
  /symbols and in the Flow's kind dropdown.

## 4. The node library v1 (about 45 nodes, all from §2)

- **Inputs:** UV (element unit space), pixel, element size, progress `t`, seconds, intensity,
  looping, an exposed param, *Sample* (the element at a UV), *Edge* (outline from alpha).
- **Math:** add, subtract, multiply, divide, mix, clamp, smoothstep, step, pow, abs, fract,
  sin / cos, remap, one-minus, min / max, length, dot, rotate 2D, split / combine.
- **Time shaping:** bell, swell, ease in / out / back, *Hold in-out* (the freeze / petrify / gold
  timing), loop envelope, pulse.
- **Procedural:** hash, value noise, FBM (octaves capped), cellular (d1, d2, cell id), gradient
  (linear / radial), stripes, star / sparkle shape.
- **Masks:** *Front from side* (edges / centre / top / bottom / left / right, with raggedness),
  inside-element, rim.
- **UV distort:** wave, twist, bulge / pinch, ripple ring, offset, scale about a pivot, polar,
  *Perspective plane* (the 3D flip's ray cast as one node).
- **Colour and light:** luminance, desaturate, tint, hue shift, contrast, *Relief normal* (from
  luminance and alpha), light from a normal, metal ramp, glint sweep.
- **Output:** final colour (premultiplied) and padding (room drawn outside the box).
- **Later:** a *Custom GLSL* node, admin-only. A bad shader can lose the WebGL context and blank a
  game, so it stays gated.

Types: float, vec2, vec3, colour (vec4). A float splats implicitly to a vector. Every node also
declares a **cost** (ALU work and texture samples); the editor sums the costs and warns past a
mobile budget.

## 5. Reuse — what is already built

- **Graph canvas.** `@xyflow/svelte` already powers /flow-v2: typed pins, the add-node palette, the
  drag-off-pin spawn menu, graph ops and the validation panel. Today these are local to the
  `flow-v2` route. Step 4 lifts them into `$lib/graph/` rather than growing a third bespoke canvas.
- **Pure package beside the editor.** `engine-flow-v2` is the precedent for a dependency-free
  schema, validator and runtime package.
- **The `ElementFxFilter` shell.** It, its `HEADER` and the WebGL1 rule (the gate already bans
  GLSL ES 3.00-only built-ins) are the codegen target.
- **The Element FX catalog param kinds** (number / color / bool / choice) are the exposed-input
  types, so the existing param rows render custom effects unchanged.
- **The ship chain.** `effectExport.ts` (Invisible FX) is the pattern to mirror (rule 8).
- **The visual test harness.** The headless WebGL1 / WebGL2 render harness used for every new
  effect becomes the pixel-diff gate.

## 6. Risks and how each is handled

| Risk | Handling |
|---|---|
| It shows in the editor but never ships | Treated as a new R2 asset class from day one. It travels export → `deploy/editor-shaders/` → bake (the compiled GLSL is embedded in the bundle) → pull → `registerShaderEffects()` (rule 8). |
| A shader that works in Chrome fails on a phone or on WebGL1 | Codegen emits GLSL ES 1.00-compatible code only. The preview compiles on a WebGL1 context too. A CI job compiles every saved graph in headless WebGL1 / WebGL2. |
| Mobile GPU cost | Per-node cost, a budget meter, and octave and loop caps fixed in the node definitions. Nothing unbounded can be wired. |
| A graph saved at one engine version, played on another | The doc carries a library version. A node removed or changed keeps a migration, as the flow docs do. |
| Two authors editing one graph | Leases and conditional writes, like every other doc (pipeline-concurrency agent). |
| Scope creep into a full Unreal material editor | v1 is effects **on an element** only. Particles, transitions and post FX are later steps (§8 step 8). |

## 7. Reverse-engineering track (the core of the idea)

1. **Inventory.** Every helper and pattern across the 17 passes, mapped to library nodes.
2. **Shared GLSL library.** Rewrite `shaders.ts` so the built-ins are composed from one library:
   the same functions the nodes emit.
   - Proof: **zero pixel change.** Each built-in is rendered at 8 progress points on WebGL1 and
     WebGL2, before and after, and diffed.
   - This pays off even if the editor never ships: one noise instead of seven, and a smaller bundle.
3. **Graph twins.** Each built-in pixel effect is rebuilt as a graph doc.
   - Proof: the graph-compiled pass matches the hand-written one within a tolerance, in the same
     harness.
   - An effect that cannot be rebuilt names the node the library is missing.
   - The twins become the editor's **"Start from a built-in"** templates.
4. **Single source?** Should built-ins be *generated* from graphs later, or stay hand-written beside
   their twins? That decision waits until the twins' parity gate (step 6) has held for a while.

## 8. Build plan

Each step has its own branch, gates and status entry.

1. **Shared GLSL library + refactor of the built-ins** (engine).
   - `constants-shared/glslLibrary.ts` (dependency-free, so the graph package and the launcher's
     compile checks need no Pixi): one GLSL function per building block, and a linker (`linkGlsl`)
     that puts in front of a pass exactly the entries it calls. The library is the seed of the node
     library: step 2's codegen emits the same functions.
   - The sides a spreading effect can start from are numbered once (`EFX_SIDES`, read by
     `efxAway`).
   - `check:element-fx` refuses a pass that carries a function copying a building block word for
     word (renamed or not); it cannot see a copy written inline.
   - `pnpm --filter fx-spike shader-parity` renders every kind and every starting side before and
     after and diffs them pixel by pixel; steps 3 and 6 reuse it for graph twins.
   - Exit: every kind renders pixel-identical before and after, at 8 moments, on WebGL1 and WebGL2,
     and `check:element-fx` is green.
2. **`engine-shadergraph` package** (engine).
   - Contents: schema, node library v1, validator (types, cycles, required inputs, cost), codegen to
     GLSL ES 1.00 plus the uniform layout and the exposed params.
   - Each node emits an expression per output that calls `glslLibrary` entries. It never declares a
     function of its own, so a node and the built-in it was read from stay one implementation. The
     building blocks the nodes need are added to the library, and a built-in carrying its own copy
     of one moves onto it, proven pixel-identical by the parity harness.
   - The uniform layout is `uFx` (progress, seconds, intensity, looping) plus one `uP<n>` per
     param. The compiler makes every name, so nothing an author types reaches the GLSL.
   - Exit: headless codegen snapshot tests, a GLSL 1.00 lint, and compiled output for 5 reference
     graphs rendering in the harness. Every node is also compiled on its own, at every vector width,
     on WebGL1 and WebGL2, in CI (`shader-compile`), which fails on any shader the driver rejects.
3. **Runtime** (engine).
   - Contents: `custom:<id>` kinds from a registry, the filter built from compiled GLSL, pass nodes,
     and motion curve channels.
   - A custom kind is `custom:<id>`, the doc id a slug. `ElementFxKind` stays the 50 built-ins, so
     the runtime's `Record<ElementFxKind, …>` stays exhaustive. Entries and plays take either.
   - The registry lives in `constants-shared/elementFx` (dependency-free): `setCustomElementFx(list)`
     replaces the set (the game at boot, the editor per project), reading each effect and leaving out
     one that cannot play. The reader keeps a well-formed custom entry even before its effect is
     registered, so load order cannot drop one; it plays once registered.
   - `compileShaderEffect(doc)` packs the graph's pass with the doc's **passes** and **motion** as
     one plain, shippable value. The plan's "pass nodes" became a list on the doc, because no
     per-pixel node can run another filter. A pass is one of the built-in single-pass kinds (glow,
     outline, blur…), its params set by value or tied to the effect's own params. Motion is a curve
     per channel (x, y, scale, rotation, alpha over the play).
   - Exit: a custom effect behaves like a built-in in the gate (triggers, keyed, symbol state,
     turbo, stop).
4. **Pipeline** (launcher + engine).
   - Contents:
     - storage: `<client>/<project>/shaders/` plus the studio-shared `_shared/shaders/`;
     - leases;
     - export, deploy, bake, pull and register, included in Publish;
     - the Scene Editor, /symbols and Flow pickers listing custom effects.
   - **Storage.** One file per graph, `shaders/<id>.json`; a project's graph shadows a shared one
     of the same id, and the project's **set** is its own graphs plus the shared ones it does not
     override. The id is `r2Slug` without leading underscores, so it always makes a valid
     `custom:<id>`. A save keeps a graph that does not compile (it is being built) and is guarded by
     `baseEtag`; the lease key is the editor's to take in step 5. Shared graphs are read only here;
     publishing to the library is step 7.
   - **Who.** The tools whose pickers list custom effects, and `/shaders`, read the set; `/shaders`
     writes it. Until step 5 Scene Editor users wrote graphs: a graph is presentation, compiled from
     generated names only.
   - **The ship.** The export compiles the set into `deploy/editor-shaders/` (one compiled effect
     per file and an index) and names a graph that does not compile, which plays nothing rather
     than failing the build. Publish (`runtimeBundle.ts`) and the bake (`export-shaders`) embed the
     effects as `shaderEffects`; the pull mirrors `editor-shaders/`; the game registers them with
     `setCustomElementFx` before its first render.
   - **The pickers.** The Scene Editor and Symbols register the project's set, and their kind picker
     lists it as "Custom (Shader Graph)"; the Flow's kind dropdown lists the project's custom kinds.
   - Exit: a graph authored on main plays in a published game (play-QA with the `game-playtester`
     agent).
5. **Editor v1, `/shaders`** (launcher).
   - Layout: three panes (library / canvas / properties + preview).
   - The canvas comes from `$lib/graph/`, lifted out of /flow-v2.
   - Live preview runs in Pixi, on a sample card, any atlas region or symbol art, or a rig still,
     with a `t` scrubber and play / loop.
   - Compile errors show on the nodes; saving uses a lease and keeps history.
   - Registry entry, `docs/tools/shader-graph.md` and onboarding link, all in the same change
     (rule 9).
   - As built: the editing model is pure (`shaderEditor.ts`, every gesture doc → doc) and the
     canvas asks the compiler's own wire rule (`canFeed`), so a wire the canvas takes is one the
     compiler takes. The lease and the history are per graph (doc key and backup target the graph
     id). The preview poses the effect through the game's runtime rather than a copy of it; the rig
     still is left for later.
   - Exit: an artist builds, previews and saves a graph on `/shaders`, and it is listed by the
     pickers and ships with Publish (step 4's chain).
6. **Templates.** The graph twins of the built-ins, with the parity gate, as "Start from a built-in".
   - As built: 30 of the 50 kinds have a twin (`BUILTIN_TWINS`; 36 since 8b added the six breaks): every kind drawn by a pixel pass,
     hand-written or `pixi-filters`. The 14 motion-only kinds are curves alone and the 6 breaks are
     not pixel effects, so they have none.
   - The gate (`shader-twins`, in `check:all`) plays each built-in and its twin through the runtime
     on WebGL1 and WebGL2, over moments and every param extreme. A cell fails past 0.25% of pixels
     more than 2 steps off, or on any patch; motion is compared as numbers.
   - What a twin could not rebuild was named, not hidden: motion that follows the seconds played, a
     param or looping (`motionGap`), and padding that grows with a param. Both were v1 doc limits,
     closed in 8a by the motion graph (the gap fields are gone).
   - The twins needed a per-element **seed** (the built-ins draw one per element) and an Output
     **Blend** (Add, for glows brighter than their alpha), and 15 more nodes.
7. **Editor v2.** Per-node live thumbnails, the cost meter, subgraphs (reusable groups, like the
   flow's functions), and publishing to the studio-shared library.
   - As built, **subgraphs** are part of the doc (`subgraphs`, still version 1): a body between an
     Input and an Output node with typed ports, called by a `subgraph` node. `flattenShaderGraph`
     inlines every call (a typed pass-through per port, so a body computes what it does alone)
     before the compiler sees the graph, so the runtime, the ship chain and the rollback floor are
     untouched; issues are reported on the call. Nesting stops at 4, recursion is an error, and
     ports (32 a side), subgraphs (64) and the inlined total (4000) are capped, since the server
     compiles stored docs. A doc with no calls compiles byte-identical. Group / Open / Ungroup are editor gestures, and
     ungroup gives back the graph it grouped.
   - **Thumbnails** draw a probe per node (the node and what feeds it, shown through library nodes)
     in one offscreen renderer through the runtime's own filter, keyed by the node and its
     upstream, so an edit redraws only what it reaches; only the nodes on screen, 40 at most, stay
     live. **The cost meter** is a chip per node (its part of the phone budget) and bars in the
     status bar.
   - **Publishing** needs the `shaderPublish` capability (admin by default). It copies the saved
     graph, which must compile, never replaces a library id without saying so, and keeps what a
     replace or removal replaced. Since every project's set now takes in a real library, Publish
     and the bake embed only the effects a bundle names (step 4's open item).
8. **Later**, split (2026-10-25) into five sub-steps, each its own branch and PR, in this order:
   - **8a. The motion graph.** A second graph in the doc, evaluated on the CPU each frame: float
     nodes (time, params, seed, the element's aspect, math, the time shapes, oscillators, 1-D
     noise) into a **Motion Output** (x, y, scale, scale x / y, rotation, alpha and padding).
     - It compiles to a bounded JSON program the runtime interprets: no code is evaluated, and the
       op count is capped. Each motion node's JS is held to its GLSL by a gate, so a node means the
       same thing in both graphs.
     - A channel the graph drives overrides its curve; curves stay for simple keyframed motion.
       Padding becomes a value per frame, so room can grow with a param × strength × progress.
     - It closes every gap the twins name (motion following the seconds played, a param or
       looping; padding growing with a param), so the parity gate holds their motion and room too.
     - Editor: a Pixel | Motion switch over the canvas; motion nodes show their value over the
       play as a curve.
     - Version skew: an effect with a motion program needs a runtime from 8a on; an older one plays
       it without that motion (the curves it also carries). The floor goes in `games-deploy.md`.
     - As built: 39 motion nodes (the pixel library's number nodes, every port a float, plus
       Element shape and the Motion Output); the program is a flat op list run by
       `constants-shared/motionLibrary.ts`, capped at 256 ops; a driven channel's value is final and
       clamped; one seed per element shared with the pixel graph; a program the reader cannot run
       is dropped (the effect plays its curves), and no curve fallback is generated. The
       `shader-motion` gate holds each node's JS to its GLSL on WebGL1 and WebGL2. The twins carry
       motion graphs, so every twin's motion and room match its built-in and `shader-twins`
       compares them at every case; program padding is capped at 11.6 (the most a built-in asks),
       the doc's fixed padding at 2.
   - **8b. Break as an output node.** An effect may end in a **Break Output** naming one of the
     six break styles and its params (tied to the effect's params like a pass), played by the
     existing `breakApart.ts` after the graph. Breaks stay coded (§2): the node only chooses and
     sets one.
     - Shape (2026-10-25): the node's settings are the break kind and **starts at** (a share of the
       play); its input ports are that kind's params (number → float, colour → vec3, switch →
       0 / 1, choice → the option's index). A port takes only a Param node (a tie, as a pass's
       params are tied) or a constant: a break is set once per play, not per pixel.
     - The graph plays on the element until "starts at"; then the element breaks, its pieces cut
       from it as drawn at that instant (the graph's look in the still). Assemble mirrors it: the
       pieces fly in first, then the graph plays. The effect's phase must be the kind's.
     - An older runtime ignores the break; an exit effect must still leave there, so the compiled
       effect also carries a fade that reads as nothing on a runtime that breaks.
     - As built: `at` 0 means the whole play is the break; Assemble's pieces fly in over
       [0, 1 − at] and the graph has the last `at`. While the break plays, the effect's passes and
       motion are held at the edge; the still is cut with the graph's filters on, at the effect's
       held pose (antialiasing inherited, so WebGL2 keeps its smooth edges). The fade for older
       runtimes starts 0.15 into the window; it keeps a doc's own alpha curve (or motion program)
       up to that point. A break the reader cannot play is dropped and the effect kept. The six
       break kinds have twins (an identity graph plus a Break Output with every param tied), held
       to their built-ins by `shader-twins` with no pixel different.
   - **8c. The Custom GLSL node** (admin only, §9.3). A node whose body an author types, with
     declared typed ports. A `shaderCustomGlsl` capability gates saving or publishing a doc that
     holds one, checked on the server; the body is checked as the compiler checks generated code
     (GLSL ES 1.00 only, no loops past a cap, names kept inside the node) and compiled headless on
     WebGL1 and WebGL2 before it can ship.
     - As built: a typed recursive-descent checker over a tokenized body (caps 4 KB, 600 tokens,
       nesting 48, loops 64 rounds each and 256 nested, locals initialised, no shadowing, constant
       integer division by 0 and overflow refused); each node compiles to `efxGlsl_<n>` before
       `main` (no `in` qualifier: Pixi defines `in` as `varying` in our fragments; one id in and
       out is `inout`); cost estimated from the body, capped at 1,024 units and 256 reads a node and
       4,096 / 1,024 an effect. The server gate is the `shaderCustomGlsl` capability on save,
       restore and publish, judged against the stored graph's definitions. The test-compile runs in
       the author's browser on WebGL1 and WebGL2 (the server has no GPU), and the runtime asks the
       driver whether each Element FX program linked, drawing the element unchanged when not: that
       fail-safe covers every built-in pass too.
   - **8d. Particle materials for Invisible FX.** A graph as the material an emitter's particles
     draw with, picked in `/fx`. Needs its own design pass with the `invisible-fx` agent first:
     per-particle inputs (age, life, colour, index) and the cost of a filter per emitter.
   - **8e. Screen transitions and post FX.** A graph that reads two screens (from, to) over a
     transition, and one applied to the whole stage. Needs its own design pass first: where
     transitions and post FX live in the Scene Editor and the Flow, and their phone budget.

Rough size: steps 1–3 are engine work, roughly one PR each. Steps 4 and 5 are the large ones (the
editor UI and the ship chain). Steps 6–7 build on top of them.

## 9. Decisions (owner, 2026-10-23)

1. **Name and home:** a tool of its own, **Invisible Shader Graph**, at `/shaders`.
2. **v1 scope:** pixel effects plus simple motion curves. Breaks come later, as an output node.
3. **Raw GLSL:** nobody in v1. Later, admins only, through the Custom GLSL node.
4. **Library scope:** both per project and studio-shared, as editor components already work.
5. **Built-ins long term:** open until step 6. They stay hand-written beside their graph twins until
   parity has held.
