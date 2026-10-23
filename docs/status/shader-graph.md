# Invisible Shader Graph — status

> Design: [docs/design/invisible-shader-graph.md](../design/invisible-shader-graph.md) · Guide: none yet (step 5) · Agent: `.claude/agents/invisible-shader-graph.md`

**One-line state:** plan approved 2026-10-23. Step 1 (one shared GLSL library under the 17
built-in shader passes) and step 2 (the `engine-shadergraph` package: nodes, validator, compiler)
are built and in review. Nothing plays a graph yet, and no tool or route exists.

## Current state
- **Step 1, the shared GLSL library** (`constants-shared/glslLibrary.ts`). Built and
  in review.
  - **The library.** It holds 16 building blocks: hash and value noise (2-D and 1-D), a 2-D hash,
    cellular noise, luminance, relief height, alpha outline, edge distance, "away from a side",
    band, glint, the two rotations and a transpose.
  - **The passes.** All 17 built-in passes call them, and `linkGlsl` links in only what each pass
    calls.
  - **The gate.** `check:element-fx` refuses a pass whose function copies a building block word
    for word, renamed or not. A copy written inline still gets through; reviews catch those.
  - **The parity harness.** `pnpm --filter fx-spike shader-parity shoot|diff`
    (`tools/fx-spike/shaderParity.mjs`) renders every kind at 8 moments and every starting side, on
    WebGL1 and WebGL2 with fixed seeds, and diffs two renders pixel by pixel. `--root` renders
    another checkout, such as a worktree of the base.
- **Step 2, the graph package** (`packages/engine-shadergraph`, dependency-free apart from
  `constants-shared`). Built and in review.
  - **The doc** (`ShaderGraphDoc` v1): phase, duration, padding, exposed params (the catalog's
    number / colour / bool / choice specs), nodes and wires.
  - **The node library:** 76 nodes in 8 families (input, math, time, procedural, mask, UV, colour,
    output). Each emits GLSL that calls the `glslLibrary` building blocks, so a node and the
    built-in it was read from share one implementation. Math nodes are generic over floats and
    vectors.
  - **The compiler** (`compileShaderGraph`) validates, types and emits one pass body for
    `ElementFxFilter`, plus its uniform layout: `uFx` (progress, seconds, intensity, looping) and
    one `uP<n>` per param. Names are generated, so nothing an author types reaches the GLSL.
  - **The validator** names each broken doc (13 kinds of error) and warns on unreachable nodes and on
    a graph over the phone budget (cost 400, 16 texture reads), which still compiles.
  - **Five reference graphs** (`REFERENCE_GRAPHS`): pulse tint, noise dissolve, ripple, frost and
    gilded relief. Frost and gilded relief are the freeze and gold looks rebuilt from nodes, close
    to the built-ins but not pixel twins (the twins are step 6).
- **Not started:** steps 3–8 (the runtime kinds, the pipeline, the `/shaders` editor, templates).

## Open items / next
1. Merge step 1, then step 2.
2. **Step 3: the runtime.**
   - Contents: `custom:<id>` kinds from a registry, the filter built from a compiled graph
     (`ElementFxFilter(name, body, uniforms)`, `uFx` and the `uP<n>` written each frame), pass nodes
     and motion curve channels.
   - Exit: a custom effect behaves like a built-in in `check:element-fx` (triggers, keyed, symbol
     state, turbo, stop).

## Blocked (owner / external)
- None.

## Recent changes
- 2026-10-23 — **Step 2: the `engine-shadergraph` package** (schema, node library, validator,
  compiler).
  - **The library grew by 13 building blocks** for the nodes to call (29 in all): FBM, the hold,
    ease-in-out and ease-out-back timings, the rotate / twist / bulge / ripple / wave UV warps, a
    YIQ hue shift, a relief normal, a metal ramp and a light model. The built-ins call none of them,
    so `linkGlsl` links none into a built-in. The parity harness proves it: all 50 kinds and every
    side render identical to step 1.
  - **`ELEMENT_FX_PHASES`** (`constants-shared/elementFx.ts`) lists the four phases as a value, so
    the validator can check a doc's phase.
  - **The fixture** (`packages/engine-shadergraph/compile.fixture.ts`, run by `check:all`): 38
    checks.
    - Every node output compiles in a graph of its own (92 graphs: the Param node once per param
      kind), and its GLSL links and
      passes a WebGL1 lint: every `efx…` called is defined, nothing GLSL ES 3.00-only, no reserved
      word as a name, no `--`.
    - The five reference graphs compile the same every time and match their committed GLSL
      (`snapshots/<id>.frag`; `--update` rewrites them after a deliberate codegen change).
    - An Output alone compiles to exactly the element as it is.
    - Each validator error and warning fires on a doc built to trigger it.
    - Type conversion goes one way only.
    - Hostile ids and labels never reach the GLSL.
    - Param uniforms hold the right values.

    Mutation-checked: a typo in a node's GLSL template, allowing a vec2 into a vec3 port, and an
    unparenthesised negative literal each fail it.
  - **In a real browser.** `pnpm --filter fx-spike shader-parity shoot` now also draws two graph
    sheets through the real `ElementFxFilter`, on WebGL1 and WebGL2: the five reference graphs at 8
    moments, and every node output in a cell of its own (`tools/fx-spike/shaderGraphs.entry.ts`).
    A shader the driver rejects fails the shoot. A planted unknown function in one node's GLSL
    failed it with the driver's message on both WebGL versions.
- 2026-10-23 — **Step 1: one shared GLSL library under the built-in shaders.**
  - **What the inventory found.** The 17 hand-written passes were carrying private copies of the
    same building blocks:
    - one 2-D hash in five passes (dissolve, burn, poison, petrify, gold) and its value noise in
      four;
    - a 1-D hash and noise in two (melt, electrocute);
    - a 2-D sin hash and cellular noise in two (freeze, petrify);
    - a relief height in two (petrify, gold);
    - an alpha outline in two (freeze, electrocute);
    - a "front from a side" in four (freeze, burn, petrify, gold), each with its own numbering of
      the sides.
  - **The library and the refactor.** They now live once in `constants-shared/glslLibrary.ts`,
    dependency-free so the graph package and the launcher can use them without Pixi. The passes call
    them by name and `linkGlsl` links in exactly what a pass reaches, each entry once and before its
    callers. `shaders.ts` lost 350 lines.
  - **Side numbering.** The sides are numbered once (`EFX_SIDES`: bottom, top, edges, centre,
    left, right), so freeze, petrify, gold and crystallize's frozen still now pass that number
    (`efxSide`).
  - **Proof of no visual change.** Every one of the 50 kinds was rendered at 8 moments on WebGL1
    and WebGL2 with fixed seeds, before and after: pixel-identical. Every starting side of freeze,
    petrify, gold, burn and crystallize was rendered before and after: identical too.
  - **Proof the diff can see a change.** A one-digit change to the luminance weights (0.587 →
    0.588) showed up in exactly the effects that use luminance, at one colour level.
  - **The gate.** `check:element-fx` gained 9 checks:
    - the linker emits exactly what a pass calls, in order;
    - header helpers aren't linked;
    - all 17 passes link with no function defined twice;
    - every `efx…` a pass calls is defined in it (a misspelt building block fails here, not in the
      browser);
    - the linker ignores comments and names entries that call each other;
    - no pass has a function copying a building block word for word;
    - a planted renamed copy of `efxHash` is caught;
    - `efxAway`'s six arms read the sides in `EFX_SIDES` order;
    - freeze, petrify, gold and burn send each of their sides as `efxAway` reads it, and an unknown
      one as their catalog default.

    Mutation-checked:
    - swapping two sides in `EFX_SIDES` fails the side checks;
    - a wrong fallback fails them too;
    - a planted renamed copy of `efxHash` fails the copy check.

    Run on the old `shaders.ts`, the copy check flags the function copies of the hashes, noises and
    relief, plus the 3D passes' rotations. It does not flag the inline copies (outlines, side
    fronts, luminance) or copies whose local names differ. The WebGL1 scan now covers the library.
  - **Review.** An independent review confirmed every replaced expression and the side remapping
    are identical. Its findings were fixed before the PR:
    - the gate checks were too shallow (the sides, unresolved calls);
    - the linker read comments and had no cycle guard;
    - the docs overstated the copy check;
    - the harness was not committed.
