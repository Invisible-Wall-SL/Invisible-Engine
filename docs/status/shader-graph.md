# Invisible Shader Graph — status

> Design: [docs/design/invisible-shader-graph.md](../design/invisible-shader-graph.md) · Guide: none yet (step 5) · Agent: `.claude/agents/invisible-shader-graph.md`

**One-line state:** plan approved 2026-10-23. Step 1 (one shared GLSL library under the 17
built-in shader passes) is built and in review. No tool or route exists yet.

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
- **Not started:** steps 2–8 (the graph package, the runtime kinds, the pipeline, the `/shaders`
  editor).

## Open items / next
1. Merge step 1.
2. **Step 2: the `engine-shadergraph` package.**
   - Contents: schema, node library v1 (emitting `glslLibrary` functions), validator, codegen to
     GLSL ES 1.00.
   - Tests: headless codegen snapshot tests.
   - Proof: 5 reference graphs rendering in the WebGL1 / WebGL2 harness.

## Blocked (owner / external)
- None.

## Recent changes
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
