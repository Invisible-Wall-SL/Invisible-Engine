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
   their twins? That decision waits until step 3's parity has held for a while.

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
   - Exit: headless codegen snapshot tests, a GLSL 1.00 lint, and compiled output for 5 reference
     graphs rendering in the harness.
3. **Runtime** (engine).
   - Contents: `custom:<id>` kinds from a registry, the filter built from compiled GLSL, pass nodes,
     and motion curve channels.
   - Exit: a custom effect behaves like a built-in in the gate (triggers, keyed, symbol state,
     turbo, stop).
4. **Pipeline** (launcher + engine).
   - Contents:
     - storage: `<client>/<project>/shaders/` plus the studio-shared `_shared/shaders/`;
     - leases;
     - export, deploy, bake, pull and register, included in Publish;
     - the Scene Editor, /symbols and Flow pickers listing custom effects.
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
6. **Templates.** The graph twins of the built-ins, with the parity gate, as "Start from a built-in".
7. **Editor v2.** Per-node live thumbnails, the cost meter, subgraphs (reusable groups, like the
   flow's functions), and publishing to the studio-shared library.
8. **Later.**
   - Break as an output node.
   - A richer motion graph.
   - Particle materials for Invisible FX.
   - Screen transitions and post FX.
   - The admin-only Custom GLSL node.

Rough size: steps 1–3 are engine work, roughly one PR each. Steps 4 and 5 are the large ones (the
editor UI and the ship chain). Steps 6–7 build on top of them.

## 9. Decisions (owner, 2026-10-23)

1. **Name and home:** a tool of its own, **Invisible Shader Graph**, at `/shaders`.
2. **v1 scope:** pixel effects plus simple motion curves. Breaks come later, as an output node.
3. **Raw GLSL:** nobody in v1. Later, admins only, through the Custom GLSL node.
4. **Library scope:** both per project and studio-shared, as editor components already work.
5. **Built-ins long term:** open until step 6. They stay hand-written beside their graph twins until
   parity has held.
