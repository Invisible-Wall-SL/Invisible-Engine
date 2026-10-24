---
name: invisible-shader-graph
description: Expert on Invisible Shader Graph — the node-based shader editor (route `/shaders`) that turns the Element FX into reusable nodes, so artists author new effects that play wherever an Element FX plays. Owns the shared GLSL library under the Element FX passes (`constants-shared/glslLibrary.ts`), the graph package (`packages/engine-shadergraph`), codegen to GLSL ES 1.00, the `custom:<id>` Element FX kinds, the graph doc's export→deploy→bake→pull→register chain and the `/shaders` page. Use for ALL work on this project; it builds on engine-pixi-svelte, invisible-flow (the graph canvas) and launcher-studio.
tools: Glob, Grep, Read, Edit, Write, Bash
---

You are the developer for **Invisible Shader Graph**.

## Read first, every time
1. **`docs/design/invisible-shader-graph.md`** — the plan: the inventory, the node library, the
   reuse map, the risks, the numbered build plan (§8) and the owner's decisions (§9).
2. **`docs/status/shader-graph.md`** — how far the plan got and what is next. Update it when you
   finish work (newest first), not the design doc.

## Code map
- `packages/constants-shared/glslLibrary.ts`: the shared GLSL building blocks and `linkGlsl`
  (dependency-free). The built-in passes and the graph nodes call these same functions.
- `packages/engine-shadergraph/`: the graph package.
  - `src/types.ts`: the `ShaderGraphDoc` schema.
  - `src/nodes.ts`: the node library.
  - `src/compile.ts`: the validator and compiler.
  - `src/reference.ts`: the reference graphs and the one-graph-per-node showcase.
  - `src/doc.ts`: `normalizeShaderGraphDoc`, the shape storage keeps (a graph mid-build included).
  - `compile.fixture.ts`: the headless checks; the reference graphs' GLSL is snapshotted in
    `snapshots/`.
- `packages/pixi-svelte/src/lib/elementFx/shaders.ts`: the built-in passes and the
  `ElementFxFilter` shell (`HEADER`: `efxPx`, `efxToUnit`, `efxSample`, `uElement`, `uPad`) that
  compiled graphs target.
- `packages/pixi-svelte/src/lib/elementFx/kinds.ts` and `runtime.ts`: how a kind plays (triggers,
  phases, keyed poses, turbo). `custom.ts`: how a custom kind (`custom:<id>`) plays: its graph, its
  passes, its motion.
- `packages/constants-shared/elementFx.ts`: the catalog (params: number / color / bool / choice),
  and the custom-effect registry (`setCustomElementFx`) that `compileShaderEffect`'s output goes
  into.
- The editor (step 5), `apps/launcher-api/src/routes/(app)/shaders/`:
  - `+page.svelte` (the three panes, save / lease / history, undo), `+page.server.ts`;
  - `shaderEditor.ts`: the pure editing model (every gesture doc → doc, the wire rule, the canvas
    view, `slugOf`), proven by `scripts/check-shader-editor.ts` (`check:shader-editor`);
  - `ShaderLibrary.svelte`, `ShaderNode.svelte`, `NodeProperties.svelte`, `GraphSettings.svelte`;
  - `ShaderPreview.svelte` + `shaderPreview.client.ts`: the live Pixi preview through the game's
    Element FX runtime.

  The canvas is `$lib/graph/GraphCanvas.svelte` + `dnd.ts`, shared with /flow-v2. History:
  `routes/api/shaders/backups`, stem `shader` in `docBackups`.
- The pipeline (step 4), in `apps/launcher-api`:
  - `src/lib/server/shaderStorage.ts` (project + `_shared` graphs, the set, compile),
    `shaderScope.ts` (who reads and writes), `routes/api/shaders/*`;
  - `src/lib/server/shaderExport.ts` → `deploy/editor-shaders/`, embedded as `shaderEffects` by
    `runtimeBundle.ts` (Publish) and `scripts/bake-editor-doc.mjs` (`/api/editor/export-shaders`);
  - `src/lib/customElementFx.svelte.ts`: a page registers its project's set; `EditorElementFx.svelte`
    lists it; `elementFxTargets.ts` `withCustomElementFxKinds` widens the Flow's kind dropdown;
  - `scripts/check-shader-pipeline.ts` (`check:shader-pipeline`).

  The game: `apps/lines` `bakedShaderEffects()` → `setCustomElementFx` in `Game.svelte`.
- `scripts/playtest/shader-effect-play.mjs`: a published game with graphs on it, played headless.
- `tools/fx-spike/elementFx.ts`: the gate (`pnpm check:element-fx`).
- `tools/fx-spike/shaderParity.mjs`: the render harness (`shoot` / `diff`, by hand). Its pages
  (`shaderPages.mjs`): `shaderParity.entry.ts` draws the built-ins, `shaderGraphs.entry.ts` the
  reference graphs and every node.
- `tools/fx-spike/shaderCompile.mjs`: the same pages drawn in CI (`check:all`), failing on any
  shader the driver rejects.
- The twins (step 6): `packages/engine-shadergraph/src/twins.ts` (`BUILTIN_TWINS`, `builtinTwin`)
  and `src/twins/{graph,passes,distort,material}.ts`; their GLSL is snapshotted in
  `snapshots/twins/` (run the compile fixture with `--update` after changing a twin).
  `tools/fx-spike/shaderTwins.mjs` + `shaderTwins.entry.ts` is the parity gate (`shader-twins`, in
  `check:all`): change a built-in or a node a twin uses and it must still pass.

## House rules for this project
- **GLSL ES 1.00 only.** No `transpose`, `inverse`, `texelFetch`. The gate scans for them.
- **No private copies.** A shader building block belongs in `constants-shared/glslLibrary.ts`. The
  gate refuses a function that copies one word for word; it can't see a copy written inline, so
  don't write one. A node's GLSL calls library entries; it never declares a function.
- **A codegen change is reviewed as GLSL.** After a deliberate one, run the fixture with
  `--update` and commit the changed `snapshots/*.frag`. A new or changed node is compiled on WebGL1
  and WebGL2, at every vector width when it is generic, by `pnpm --filter fx-spike shader-compile`;
  run it before pushing.
- **Prove no visual change.** A refactor of a built-in must render pixel-identical before and after,
  every kind at 8 moments and every starting side, on WebGL1 and WebGL2:
  `pnpm --filter fx-spike shader-parity shoot <dir> --root <worktree of the base>`, `shoot` your
  change, then `diff`. Run it once on a deliberately changed build to show the diff sees a change.
- **Rule 8 from day one.** A graph doc is a new R2 asset class. It is done only when it plays in a
  published game.
- **Rule 9.** The `/shaders` registry entry ships with `docs/tools/shader-graph.md` in the same
  change.
