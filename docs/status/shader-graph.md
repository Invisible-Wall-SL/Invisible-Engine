# Invisible Shader Graph — status

> Design: [docs/design/invisible-shader-graph.md](../design/invisible-shader-graph.md) · Guide: [docs/tools/shader-graph.md](../tools/shader-graph.md) · Agent: `.claude/agents/invisible-shader-graph.md`

**One-line state:** plan approved 2026-10-23. Step 1 (one shared GLSL library under the 17
built-in shader passes, #1320) and step 2 (the `engine-shadergraph` package: nodes, validator,
compiler, #1322) and step 3 (the runtime: a compiled graph plays as `custom:<id>` wherever a built-in
Element FX does, #1328) and step 4 (the pipeline: a project's graphs are stored, compiled into
Publish and the bake, registered by the game at boot and listed by the Scene Editor, Symbols and
Flow pickers, #1329) and step 5 (the `/shaders` editor: library, canvas, properties and a live
Pixi preview, with a lease and history, #1330) and step 6 (the templates: graph twins of 30
built-ins, held to a parity gate in `check:all`, offered as "Start from a built-in", #1333) and
step 7 (editor v2: subgraphs, node thumbnails, cost chips, publishing to the studio library,
#1340) are merged. Step 8 (the plan's "Later") is split into 8a–8e; 8a, the motion graph, is
merged (#1342), and so are 8b, Break as an output node (#1347), and 8c, the admin-only Custom
GLSL node (#1349). 8d (particle materials) is decided
([design](../design/shader-graph-particles.md)) and being built as 8d.1–8d.8; 8d.1 (the particle
shell and the Particle node) is merged (#1354); 8d.2 (the material renderer) is merged
(#1366); 8d.3 (the material in the game) is merged (#1378); 8d.4 (the ship chain, proven) is
merged (#1384); 8d.5 (`/fx` authoring) is merged (#1392); 8d.6 (the other previews) is
merged (#1407); 8d.7 (`/shaders`: Made for particles and the Particles preview) is merged
(#1423); 8d.8 (play-QA and calibration) is next.

## Current state
- **Step 1, the shared GLSL library** (`constants-shared/glslLibrary.ts`). Merged (#1320,
  2026-10-23).
  - **The library.** It holds 16 building blocks: hash and value noise (2-D and 1-D), a 2-D hash,
    cellular noise, luminance, relief height, alpha outline, edge distance, "away from a side",
    band, glint, the two rotations and a transpose.
  - **The passes.** All 17 built-in passes call them, and `linkGlsl` links in only what each pass
    calls.
  - **The gate.** `check:element-fx` refuses a pass whose function copies a building block word
    for word, renamed or not. A copy written inline still gets through; reviews catch those.
  - **The parity harness.** `pnpm --filter fx-spike shader-parity shoot|diff`
    (`tools/fx-spike/shaderParity.mjs`) renders every kind at 8 moments, every starting side and
    every signed param at its minimum, on WebGL1 and WebGL2 with fixed seeds, and diffs two renders
    pixel by pixel. `--root` renders
    another checkout, such as a worktree of the base. **Never `pnpm install` in that worktree:** the
    bundle resolves packages through this checkout's `node_modules`, and a base with its own loads a
    second Pixi, so its render breaks (`uniform1iv` errors) and every cell reads as different.
- **Step 2, the graph package** (`packages/engine-shadergraph`, dependency-free apart from
  `constants-shared`). Merged (#1322, 2026-10-24).
  - **The doc** (`ShaderGraphDoc` v1): phase, duration, padding, exposed params (the catalog's
    number / colour / bool / choice specs), nodes and wires.
  - **The node library:** 76 nodes in 8 families (input, math, time, procedural, mask, UV, colour,
    output). Their GLSL calls the `glslLibrary` building blocks and declares no function of its
    own. Where a node was read off a built-in (the noises, cells, the side fronts, the warps, the
    relief normal, the metal ramp), the two call the same function. Math nodes are generic over
    floats and vectors.
  - **The compiler** (`compileShaderGraph`) validates, types and emits one pass body for
    `ElementFxFilter`, plus its uniform layout: `uFx` (progress, seconds, intensity, looping) and
    one `uP<n>` per param. Names are generated, so nothing an author types reaches the GLSL.
    - The element's colour at the pixel is read once, as `pixel`, however many inputs default to
      it.
    - The Output keeps the colour premultiplied: no channel above alpha.
  - **The validator** names each broken doc (14 kinds of error, the effect's passes and motion included) without throwing, even on a
    malformed one. A node that reaches nothing is checked like the rest, then left out with a
    warning. A graph over the phone budget (cost 400, 16 reads of the element) gets a warning and
    still compiles.
  - **Five reference graphs** (`REFERENCE_GRAPHS`): pulse tint, noise dissolve, ripple, frost and
    gilded relief. Frost and gilded relief are the freeze and gold looks rebuilt from nodes, close
    to the built-ins but not pixel twins (the twins are step 6).
  - **CI compiles every shader.** `pnpm --filter fx-spike shader-compile`
    (`tools/fx-spike/shaderCompile.mjs`, run by `check:all`) draws every built-in kind, the
    reference graphs and every node at every vector width through the real `ElementFxFilter` in
    headless Chromium, on WebGL1 and WebGL2. It fails on any shader the driver rejects and names
    the graph.
- **Step 3, the runtime.** Merged (#1328, 2026-10-24).
  - **Custom kinds.** A compiled graph plays as the Element FX kind `custom:<id>`. The registry is
    in `constants-shared/elementFx`: `setCustomElementFx(list)` replaces the set,
    `isPlayableElementFxKind` answers for built-ins and registered custom kinds alike.
  - **The registry checks what it is given.** Each effect goes through `readCustomElementFx`
    (spec and params, shader body and uniforms, padding, passes, motion) and is kept as a copy. A
    malformed one is left out, so an effect loaded from storage or a bundle cannot stop the game's
    ticker mid-play. A kind given twice plays as its last.
  - **The reader keeps them.** A well-formed custom entry is kept even before its effect is
    registered (its params as plain values), so the order a game reads its docs and registers its
    effects in cannot drop one. It plays once registered and is a no-op until then.
  - **The effect.** `compileShaderEffect(doc)` (`engine-shadergraph`) packs the graph's pass with
    the doc's passes and motion as one plain value that can ship as JSON.
    - **Passes:** up to 4 built-in single-pass kinds after the graph (glow, outline, shine, flash,
      hue cycle, chromatic, glitch, blur, pixelate). Each param is set by value or tied to one of
      the effect's own params of the same kind.
    - **Motion:** a curve per channel over the play (x, y as shares of the element, scale,
      rotation in degrees, alpha), keys eased linear / smooth / in / out / hold, about a pivot.
      Each channel has a range (alpha 0…1, scale 0…10, x / y ±10, rotation ±3600). Every channel
      but alpha scales with intensity; the runtime keeps alpha 0…1 and a scale above 0, so a strong
      play never flips the element over.
    - **Padding:** room the graph draws outside the element, 0…2 shares of its larger side.
  - **The runtime** (`pixi-svelte/src/lib/elementFx/custom.ts`) plays it as a built-in plays: its
    graph as one `ElementFxFilter`, its passes after it, its motion folded into the element's
    transform. An effect already playing keeps what it started with when the set is replaced.
  - **Where it plays.** Nodes, screens, the reels and symbol states play an entry naming one, and
    the Flow's `elementEffect` plays one too (the game checks `isPlayableElementFxKind`). The gate
    plays custom kinds through the reader and the runtime those all share. It does not mount a
    `Symbol.svelte`: symbol states reach the same reader through `symbolStateFx`.
  - **An unregistered custom entry still counts** where the engine counts entries: cue names,
    keyed channels, an `enter` beat a symbol state waits for. Playing it is a no-op whose `done` is
    already settled, so the wait ends at once.
- **Step 4, the pipeline.** Merged (#1329, 2026-10-24).
  - **Storage** (`apps/launcher-api/src/lib/server/shaderStorage.ts`). One file per graph: a
    project's at `<client>/<project>/shaders/<id>.json`, the studio-shared library's at
    `_shared/shaders/<id>.json`. A project's graph shadows a shared one of the same id; the project's
    **set** is its own graphs plus the shared ones it does not override. The id is `shaderSlug`
    (`r2Slug` without leading underscores), so it always makes a valid `custom:<id>`.
    `normalizeShaderGraphDoc` (`engine-shadergraph`) is the gatekeeper: a save keeps a graph that
    does not compile (it is being built) and drops what is not part of the doc. A save is guarded
    by `baseEtag` (a create on a taken id and a stale ETag are 409s), and a graph over 512 KB is
    refused (413). A setup duplicate copies `shaders/`.
  - **Routes** (`/api/shaders/list | doc | effects | save | delete`). The reads gate on the tools
    whose pickers list custom effects (Scene and Component Editors, Symbols, Flow) and `/shaders`;
    save and delete gate on `/shaders` (the Scene Editor until step 5). Every route refuses a tab on another
    project (`scopeMismatch`). `effects` answers the set compiled and the graphs left out. A shared
    graph is read with no ETag: saving it writes the project its own copy.
  - **The ship.** `shaderExport.ts` compiles the set into `deploy/editor-shaders/` (one compiled
    effect per file and an `_index.json`; no id starts with `_`), names a graph that does not
    compile, and prunes what an earlier export left. Publish (`runtimeBundle.ts`) and the bake
    (`/api/editor/export-shaders`, called by `bake-editor-doc.mjs`; a launcher without it answers 404
    and the bake goes on) embed the effects as `shaderEffects`. The pull mirrors `editor-shaders/`
    (`GENERATED_SUBTREES`). The game reads them with `bakedShaderEffects()` and registers them with
    `setCustomElementFx` before its first render.
  - **Nothing goes missing silently.** Publish logs, and returns as `shaderEffectsMissing`, every
    `custom:<id>` the game names (an entry, a Flow parameter) that it does not ship: its graph was
    deleted or does not compile, so it plays nothing (`unshippedCustomKinds`). The bake logs the
    same, and the graphs it left out with their errors. The Scene Editor tells such a row apart
    from an unknown kind. Publish judges the flow with the kinds it ships.
  - **The pickers.** The Scene Editor and Symbols load the compiled set and register it
    (`$lib/customElementFx.svelte.ts`, whose version signal refreshes the panel's kind groups and
    rows). The Element FX kind picker lists them under "Custom (Shader Graph)" (a new
    `ELEMENT_FX_CATEGORIES` entry) and takes a registered custom kind; ▶ plays it. The Flow's kind
    dropdown is widened with the project's custom kinds (`withCustomElementFxKinds`, enum
    `ELEMENT_FX_KIND_ENUM`); its validator already took any text.
  - **Proof.** `check:shader-pipeline` (75 checks: storage, the routes, the ship, the wiring of
    both bundle paths, the boot, the pull, the pickers, the Flow vocab and the missing-effect
    report). `scripts/playtest/shader-effect-play.mjs` plays a published game with two graphs on it
    and passes or fails (see "Recent changes").
- **Step 5, the editor (`/shaders`).** Merged (#1330, 2026-10-24).
  - **The tool.** `TOOLS.shaders` ("Invisible Shader Graph", Assets stage; admin, developer,
    artist, pipeline tester), its guide `docs/tools/shader-graph.md`, the icon on every tool bar.
    It takes the save gate over from the Scene Editor.
  - **Three panes.** Left: the project's graphs (its own, and the shared ones it does not
    override, tagged) with New and Delete, then the node library by family, searched, dragged onto
    the canvas or clicked in. Middle: the canvas. Right: the preview, the selected node's settings and
    unwired input values, and the effect's (name, description, phase, duration, padding, params, up
    to 4 passes, motion curves and pivot).
  - **The canvas** is `$lib/graph/GraphCanvas.svelte`, lifted out of /flow-v2 (Flow now wraps it).
    A node's header carries its family colour; each port is coloured by the type it resolved to;
    an unwired input shows the value the compiler reads. A wire is refused unless the compiler
    would take it (a float spreads, a shorter vector never widens, nothing feeds itself), and an
    input takes one wire.
  - **Errors on the nodes.** The page compiles the graph on every edit. A node's errors show on it
    (red border, the messages under its ports); errors that belong to no node, and the counts, show
    in the status bar with the cost and reads against the phone budget.
  - **Saving.** Autosave after a second, Ctrl+S, guarded by the graph's ETag (a conflict stops and
    says so). A per-graph lease (`LeaseState`, doc key the graph id): a second editor sees who holds
    it and saving waits. History per graph (`/api/shaders/backups`, stem `shader`): list and
    restore. A shared graph opens from the library; saving writes the project its own copy.
    Undo / redo (100 steps), and a guard on leaving with unsaved work.
  - **The live preview** (`ShaderPreview.svelte`, `shaderPreview.client.ts`). Its own Pixi
    application plays the compiled effect through the game's Element FX runtime, posed: a `t`
    scrubber, play / pause, loop, intensity 0–4 and a dark / light / checker backdrop. The element
    is a drawn sample card or any atlas region (symbol art included; rotated and trimmed frames as
    Pixi builds them). An edit that compiles to the same effect does not restart it; a graph that
    does not compile shows the element at rest and says so.
  - **Proof.** `check:shader-editor` (60 checks: every gesture, the wire rule, the canvas view,
    the client's slug against the server's); `check:shader-pipeline` grew to 88 (the `shaders` gate,
    history, a delete kept in History); the preview played headless on WebGL1 and WebGL2 (74
    checks); the whole page played headless (67 checks).
- **Step 6, the templates.** Merged (#1333, 2026-10-24).
  - **The twins** (`packages/engine-shadergraph/src/twins.ts`, `BUILTIN_TWINS`; `twins/passes.ts`,
    `distort.ts`, `material.ts`, built with `twins/graph.ts`). One graph per built-in kind it can
    rebuild, 30 of the 50: the 3D and distortion kinds (Flip sideways / over, Bounce 3D, Sphericon,
    Tilt 3D, Wave X / Y, Flag, Twist, Curl, Ripple, Bulge, Melt), the light kinds (Shine, Flash,
    Freeze, Burn to ashes, Poison, Electrocute, Petrify, Turn to gold, Dissolve out / in) and the
    pass kinds (Glow, Outline, Rainbow, Chromatic, Glitch, Blur, Pixelate: the Output alone, then
    that pass with every param tied). Each has its kind's catalog params exactly, its phase and
    length, and rebuilds the kind's JS timing from nodes. The 14 motion-only kinds and the 6 breaks
    have none (a motion-only kind is curves alone; a break is not a pixel effect).
  - **Motion gaps.** A twin whose motion a curve cannot follow says why (`motionGap`): the motion
    follows the seconds played, a param or looping (Bounce 3D, Freeze, Poison, Electrocute, Petrify,
    Turn to gold; Freeze's shiver also scales by the element's shorter side where the curve is in
    widths). Their pixels are held to parity like every other twin's, and their motion too at the
    defaults on a portrait element, except Poison and Electrocute (`motionGapAtDefaults`).
    **Closed in 8a:** each twin's motion graph rebuilds it exactly and the gap fields are gone.
  - **Padding gaps.** A graph's padding is one number. The waves and Bounce 3D take the room their
    largest param needs at strength 1. Melt takes its defaults' final room (1.16 heights; the
    built-in grows it with drip length × strength × progress), and names it (`paddingGap`).
    **Closed in 8a:** the motion graph's padding grows as the built-ins' does (Flag too).
  - **The parity gate** (`pnpm --filter fx-spike shader-twins`, `tools/fx-spike/shaderTwins.mjs`,
    run by `check:all`). Each built-in and its twin play through `playElementFx` with the same card,
    seed and params, on WebGL1 and WebGL2: 8 moments at the defaults and at every number param's
    minimum and maximum, plus every choice option, a switch flipped, another colour, strength 0.3
    and 2, a second loop, and the defaults again on a landscape card. A pixel differs at more than 2
    steps; a cell fails past 0.25% of its pixels (at least the element's area) or on any patch (a
    differing pixel with four differing neighbours). Motion is compared as numbers (corners within
    0.25 px, alpha within 0.5/255) except where the twin names a gap. The built-in must draw
    nothing past the twin's room unless the twin names a padding gap. About 75 s.
  - **New nodes** (76 → 91): Perspective plane, Sphericon, Flag (UV); Loop envelope, Bounce,
    Oscillate (time); Seed (input); Pick (math); Random number, Line noise, Arcs, Sparkles
    (procedural); Away from side N (mask); Relief slope, Page curl (colour); and a **Blend** setting
    on the Output (Normal, or Add: a colour brighter than its alpha, for glows and halos).
  - **Library calls fail safe.** The runtime links the library from its own copy, so an effect
    calling an entry it lacks (compiled by a newer launcher) would draw a broken shader.
    `readCustomElementFx` now drops such an effect (`unknownEfxCalls`, `EFX_HEADER_FUNCTIONS`), and
    one with two seeds, so it plays nothing. A graph saved before step 6 compiles byte-identical and
    calls nothing new; one using a step 6 node needs a runtime from step 6 on (the rollback floor
    in `docs/design/games-deploy.md`).
  - **A per-element seed.** The Seed node reads a `seed` uniform the custom runtime draws once per
    element (`custom.ts`), as the built-ins draw theirs, so two elements playing one effect differ.
    An effect that never reads it draws none and compiles as before.
  - **Built-ins moved onto the library.** Perspective, sphericon, flag, curl, electrocute, petrify
    and gold call the new library entries instead of private code, proven pixel-identical by
    `shader-parity` on WebGL1 and WebGL2.
  - **Start from a built-in** (`/shaders`). "+ New" is a menu: an empty effect, or a built-in's
    twin by family. The new effect keeps the twin's nodes, params, passes and motion under its own
    name and id; a twin with a motion gap says so.
- **Step 7, editor v2.** Merged (#1340, 2026-10-25).
  - **Subgraphs** (`packages/engine-shadergraph/src/subgraph.ts`). A doc may carry `subgraphs`
    (still version 1): each a body between one Input and one Output node, with typed ports (float
    to vec4, a default each), called by a `subgraph` node.
    - `flattenShaderGraph` inlines every call before the compiler sees the graph: inner ids become
      `<call>/<node>`, and each port becomes a typed pass-through, so a generic node inside keeps
      the port's width and a call computes what its body does alone. An unwired call input reads
      the call's value, else the port's default, else 0.
    - What it refuses, named on the call: a missing or duplicate subgraph, recursion (direct or
      through another), nesting past 4, a body without exactly one Input and Output (or holding the
      effect's Output), a malformed port (a prototype name included), a wire to a port the
      definition lacks, an input wired twice, more than 32 inputs or outputs on a subgraph, more
      than 64 subgraphs, and more than 4000 nodes, wires and ports inlined in all. A refusal is
      worked out once per subgraph and its message capped, so a hostile stored doc is refused in
      milliseconds with a bounded heap.
    - `compileShaderGraph`, `analyzeShaderGraph` and `validateShaderGraph` flatten first, then
      report each inner issue on its call ("Name › …"); cost and reads sum the inlined nodes.
      `analyzeShaderSubgraph` analyses a body alone for the editor.
    - A doc with no calls comes back as the same object, so every existing graph compiles,
      analyses and validates byte-identical. Nothing past the compiler knows subgraphs exist: no
      runtime change, and the rollback floor does not move.
    - The editor: Group (Ctrl+G; one input per outer output read inside; refused past 32 ports or
      64 subgraphs), Open (double-click, ✎ or the button) with a breadcrumb, Ungroup
      (Ctrl+Shift+G; the same GLSL back, and the subgraph goes with its last call; refused, naming
      the port, when a port was retyped away from what feeds it), ports edited on the Input /
      Output nodes (every call follows), a palette group with call counts, delete-while-called
      asks first. Every existing
      gesture works inside a body (`GraphScope`). `GraphCanvas` gained an optional node
      double-click (capture phase; xyflow 1.7 has none); /flow-v2 passes nothing.
  - **Node thumbnails** (`shaderThumbs.client.ts`, `thumbScheduler.client.ts`,
    `shaderThumbs.svelte.ts`; `probeDoc` in `shaderEditor.ts`).
    - A probe per node: the node and everything upstream, with a new Output showing its first
      wired-onward output through library nodes (a float grey, a vec2 as red–green, a vec3 opaque,
      a vec4 as is). It compiles with `compileShaderEffect` and goes through the runtime's reader;
      a broken node elsewhere never blanks it. Passes and motion are left out.
    - One offscreen Pixi renderer draws every probe through `graphFilter` (the filter the runtime
      plays a custom kind with, pulled out of `custom.ts` unchanged) and copies it into each node's
      2-D canvas, following the preview's `t`, strength, element and backdrop, params at their
      defaults and a fixed seed.
    - Cost control: a 250 ms debounce; a key per node over it and its upstream, so an edit
      recompiles only what it reaches (probes cached by key, programs by GLSL); while playing only
      time-reading thumbnails redraw, 5 times a second; only the 40 on-screen nodes nearest the
      selection stay live, about 8 ms of work per frame; the renderer is replaced after 320
      programs. A "Thumbnails" switch turns them off (frees the context), remembered per browser.
    - None for the Output, the one-value nodes (Number, Param, Colour, Seed, Time, Element size; a
      check keeps the list honest) and a body's Input. Inside a body, nodes draw with its inputs at
      their defaults.
  - **The cost meter on the canvas.** Each node reaching the Output carries a chip (cost, and reads
    when it has any), light / amber / red at 2.5% / 10% of the phone budget; the chips sum to the
    analysis total; a call's chip is its inlined body. The status bar keeps its text and gains two
    bars (work, reads; amber from 75%, red over).
  - **Publishing to the studio library.** A `shaderPublish` capability (admin by default,
    `roles.ts`) gates `/api/shaders/publish` and `/unpublish` (`shaderPublishScope`).
    - Publish copies the project's **saved** graph to `_shared/shaders/<id>.json`; one that does
      not compile is refused (400 `does-not-compile`, with its errors). A library id is never
      replaced without `replace: true` (409 `exists`), and every replace or removal keeps what it
      replaced under `_shared/shader-backups/<id>/` (`putDocWithBackup` / `deleteDocWithBackup`).
    - The listing tags a project graph that is in the library (`inLibrary`). The page offers
      **Publish to library** / **Update library copy** on a project graph and **Remove from
      library** on a shared one, only to a role that holds the capability.
  - **Ship only the effects a game names.** Every project's set takes in the whole library, so
    Publish (`runtimeBundle.ts`) and the bake now embed only the effects the bundle names
    (`namedShaderEffects`: an entry's kind, a Flow parameter, anywhere outside `shaderEffects`),
    absent when it names none. The bake walks the bundle's values the same way (never a key).
    `deploy/editor-shaders/` still holds the set, and the Publish snapshot copies it, so a game's
    asset base carries the library's compiled effects too; nothing reads them at runtime.
- **Step 8** (the plan's "Later", split into 8a–8e in design §8). 8e not started.
  - **8d, particle materials for Invisible FX.** Decided 2026-10-25
    (`docs/design/shader-graph-particles.md` §16: every recommendation, option (b), a per-particle
    shader). Built as 8d.1–8d.8, one PR each (its §15). A game plays a material from 8d.3; no
    tool authors one from 8d.5.
    - **8d.7, `/shaders`: Made for particles and the Particles preview.** Merged (#1423,
      2026-10-27).
      Guides: `docs/tools/shader-graph.md` (Made for, the Particles preview), `docs/tools/fx.md`
      (picker order).
      - **`ShaderGraphDoc.madeFor`** (`'particles'` or absent; `engine-shadergraph` types, doc,
        compile): normalized and validated; `shaderGraphBudget(doc)` gives 400 / 16 for elements
        and 150 / 4 for particles, and the meter, bars, node chips and warnings all use it. The
        compiled effect gains `madeFor`, `cost` and `samples` (last) only when made for particles,
        so every other doc compiles byte-identically (a 243-doc corpus dump matched the base).
      - **Cost in the effect:** `constants-shared`'s reader keeps the three fields and drops a
        malformed one, keeping the effect. The game's `?fxdebug=1` adds "load N" to a material's
        peak and release lines when its effect carries a cost. The effects route's `costs` stays
        `/fx`'s source for every effect (it also needs `shared`).
      - **`/shaders`:** Made for sits in the Effect settings. Particles switches the budget, makes
        Particles the default preview, and notes what particles ignore (passes, motion, the motion
        graph's padding, break). The preview's **Particles** element is a stock Burst (24 every
        2 s) or Fountain, on a soft dot or an atlas region, mounted through the game's
        `mountParticleMaterial` (`particlePreview.client.ts`); play / pause / restart replace the
        scrubber, Strength is a uniform write, thumbnails stay element-based. The page now
        registers the `fxMaterial` behaviour, which no other import gave it (found by the page
        gate).
      - **Picker order:** `/fx` lists effects made for particles first, under "Made for particles"
        and "Other effects".
      - **Gates:** `compile.fixture.ts` 213 (snapshots unchanged); `check:shader-editor` 263;
        `fx-previews` 78; `shader-page` (new, in `check:all`, 42) plays the real `/shaders`
        headless on WebGL1 and WebGL2 and walks the step's exit; `check:shader-pipeline` 149.
    - **8d.6, the other previews.** Merged (#1407, 2026-10-27). Guides:
      `docs/tools/invisible-editor.md`, `rigger.md`, `symbols-state-machine.md`.
      - **One mount for every launcher stage** (`$lib/fx/layerMaterial.client.ts`): the layer's
        material through the game's `mountParticleMaterial`, its remount key, its emitter and its
        uniform retune. `FxStage` now uses it; so do the Scene Editor's `EditorEffectLayer` and the
        Rigger / Symbols `fxOverlay`, each against its own cap of 8 (the editor page shares one).
        A placement's param values reach the material as uniforms; the editor remounts a placement
        whose material key changed (the set registering).
      - **The Rigger's `view.html`** registers the project's compiled set
        (`GET /api/shaders/effects`, through the bundle's new `RiggerFxLoadShaderEffects`) before
        its first overlay; every band waits on the one load; the fetch gives up after 5 s
        (`SHADER_EFFECTS_TIMEOUT_MS`). A failed fetch, an older bundle or an unknown kind leaves
        the layer plain. `rigger-fx.js` rebuilt.
      - **Slots are never leaked:** an editor unmount while art loads, an emitter config the
        library refuses, and a finished one-shot in the overlay (a built play whose emitters
        stopped with no particles left now ends by itself, as the game unmounts a binding's
        effect; it covers plain bursts too) all give their slot back.
      - **Gate:** `fx-previews` (in `check:all`, ~105 s, 52 checks) plays the committed
        `rigger-fx.js` and `EditorEffectLayer` headless on WebGL1 and WebGL2, and runs
        `view.html`'s real `ensureFxBundle` (race, hang) and `node --check` on its inline scripts.
      - **The Scene Editor's clock** ran about 2.3× slow for every effect (found in this step's
        review); fixed separately in #1401, and `fx-previews` now pins it to the game's.
    - **8d.5, `/fx` authoring.** Merged (#1392, 2026-10-27). Guide: `docs/tools/fx.md` (Material).
      - **The Material section** (sprite layers; `fxMaterial.client.ts`, pure): the picker (None,
        then the project's compiled effects by name; "made for particles" first waits for 8d.7's
        `madeFor`), Time, Strength, the material's params as rows (number, colour, switch with ⚡;
        a choice is a dropdown with no ⚡, since an effect parameter is a number, colour or
        switch). ⚡ reaches every param of the compiled spec, stored or not; exposing one writes
        its default. Every edit goes through `normalizeEmitterMaterial`; a new kind drops the old
        params; a rig-clip layer drops its material. Notes: passes, motion and break ignored on
        particles; over budget; over 512 or drivable past it; frames on two pages; no art; the
        graph gone or not compiling (`validateEffectMaterials`, the layer badged ◆ plain); an
        exposed parameter driving a param the selected material lacks (kept, flagged). **Open in
        Shader Graph** is a same-tab link for holders of the tool.
      - **The page registers the compiled set** from `GET /api/shaders/effects`, which now also
        answers `costs: [{ id, shared, cost, samples }]` (one guarded `analyzeShaderGraph` per
        graph; a throw drops only that cost).
      - **`FxStage` draws through the game's mount** (one cap of 8 per stage). It remounts a
        material on a change of kind, registration, time, Max particles, its drive peak or frames;
        Strength and params are uniform writes, no reset; paused ⚡ previews apply. A layer that
        did not change is no longer re-initialised on another layer's edit, and Pause / Play now
        stop and re-arm every layer (it had no dependency before), so Pause → Play replays a
        one-shot. Both change `/fx` for every effect, materials or not.
      - **Load:** the layer's measured peak (covered px, padding included, × the graph's cost),
        reset on re-init; before it draws, or while plain, the §10 estimate. A bar against 32 M
        (amber from 75 %), a badge in the Layers list, the effect's load against 64 M; graph cost
        against 150 / 4 reads. `FX_MATERIAL_PARTICLE_CAP` (512) now lives in `engine-fx`;
        `PARTICLE_COST_BUDGET` / `PARTICLE_SAMPLE_BUDGET` in `engine-shadergraph` for 8d.7.
      - **`?fxdebug=1`** adds a line when a layer's peak grows (at most every 2 s) and one at
        release, in covered px: load needs the cost inside the compiled effect (8d.7).
      - **Gate:** `fx-page` (in `check:all`) mounts the real `+page.svelte` headless with stubbed
        `$app/*` and in-memory endpoints, and plays the step's exit.
    - **8d.4, the ship chain, proven.** Merged (#1384, 2026-10-27).
      - **Proof only for the chain:** Publish (`runtimeBundle.ts` → `namedShaderEffects`, after
        `pruneUnreachableEffects`) and the bake (`bake-editor-doc.mjs`'s `nameKinds`, after its
        own prune) already carried a layer's `material.kind`; no code changed there.
      - **`check:shader-pipeline` §8** (146, 13 new) runs the real `buildRuntimeBundle` against an
        in-memory R2, and the real bake script in a child process against a local portal serving
        the real route handlers: a placed effect's material keeps its compiled effect in
        `shaderEffects` on both paths (the same effect); a broken and a deleted graph are named in
        `shaderEffectsMissing` and the bake's log; an unplaced effect is pruned and its material's
        graph is shipped nowhere and reported nowhere.
      - **Read access, narrower than the plan:** a new `shaderEffectsReadScope` (`/shaders`, the
        four picker tools, plus `fx` and `rigger`) guards only `GET /api/shaders/effects`, the
        compiled set. Graph docs (Custom GLSL source included), the list and history stay on
        `shaderReadScope`, unchanged; writes and publish unchanged. By default only the animator
        role gains anything. The project stays the session's, re-checked on every read.
        A compiled effect carries its generated GLSL, Custom GLSL nodes' code included (as every
        game bundle does), and `skipped[].errors` (validator messages quote at most a line number
        and one token); what the narrower scope withholds is the authored graph doc, its ports,
        the list and the history.
        `gate()` decides through `entitledByAny` (`accessRules.ts`), the same check as before.
        `check:launcher-gates` 481 (28 new) pins both sets, the animator and per-user cases, and
        each `api/shaders/*` handler's one scope.
    - **8d.3, the material in the game.** Merged (#1378, 2026-10-26).
      - **`EmitterLayer.material`** (`engine-fx/src/types.ts`): `{ kind: 'custom:<id>', time?,
        intensity?, params? }`, sprite layers only. `normalizeEmitterMaterial` keeps a well-formed
        one (the kind checked by `constants-shared`'s `isCustomElementFxKind`, so `engine-fx` now
        depends on `constants-shared`), clamps the strength to 0…4, drops a bad `time`, keeps
        number / string / boolean params, drops `__proto__` / `prototype` / `constructor` ids and
        writes canonical key order; a layer without one is byte-identical.
        `validateEffectMaterials(doc, isCompiled)` names a kind the project does not compile
        (`material-not-compiled`); nothing calls it yet (8d.5).
      - **Params** (`engine-fx/src/params.ts`): layer-scoped `material.intensity` and
        `material.param.<id>`. The applier writes uniforms through an `FxParamMaterial` sink (no
        rebuild, no re-init) and is inert without a renderer; `applyEffectParamDefaults` writes
        defaults into `material.params` (strength 1 is left absent); a param's leaf kind comes
        from its drive; lookups read own keys only.
      - **The game path.** `<EffectLayer>` passes `material` (and an `effectId` label) to
        `<ParticleEmitter material>`, which takes `{ kind, time, intensity, params,
        peakParticles, label }` (a coded emitter can pass `{ kind }`, §14).
        `mountParticleMaterial` decides once, at mount, in order: Tier C, an unregistered kind,
        the game cap, then the renderer's own refusals. A layer plain from mount is exactly a
        layer with no material (renderer destroyed, emitter parented to the host); one that turns
        plain while playing keeps its sprites for good. Every `init` goes through `bindConfig`;
        `sync` runs right after `emitter.update`; `setEmitSpeed` follows the emit speed.
      - **The cap:** 8 material layers per game (`createFxMaterialSlots(8)`, one count per app,
        keyed by `context.stateApp`). A layer claims a slot at mount and keeps it for its life
        (a dormant event layer too); it gives it back on destroy, on a refusal, on a throw during
        construction, or on turning plain while playing; a freed slot never turns a plain layer on.
      - **Capacity, no pop:** sized to the highest Max particles a drive can write
        (`fxMaterialPeakParticles`, ≤ 0 read as the library's 1000). A layer whose Max particles
        can be driven over 512, or with no bound, is plain from mount; so is one with no frames
        when it mounted.
      - **`?fxdebug=1`:** a line per material layer at mount and on turning plain, e.g.
        `material layer embers/main: on (custom:pulsetint; 1/8 drawing)`; coverage lines from 8d.5.
      - **The soft floor** is written in `docs/design/games-deploy.md` beside 8a's: below the first
        release with 8d.3, every material draws plain. `rigger-fx.js` rebuilt.
    - **8d.2, the material renderer.** Merged (#1366, 2026-10-26).
      - **`ParticleMaterial`** (`packages/pixi-svelte/src/lib/particleMaterial/`, plain TS, the
        `pixi-svelte/particleMaterial` subpath; the package root does not export it, so no game
        bundle changes). It owns a hidden container (`particles`) the emitter spawns into and one
        `Mesh` drawn through `particleShellSource(effect)`. `bindConfig(config)` adds `fxMaterial`
        to the bound config; `sync(renderer)` runs after `emitter.update` and mirrors the hidden
        children in order into one interleaved buffer (stride 27 floats off `PARTICLE_ATTRIBUTES`,
        `aPosition` at offset 0): corners from each particle's `updateLocalTransform()`, anchor,
        orig and trim, grown by the padding; the atlas mapping (rotated and trimmed frames as
        `Texture.updateUvs` builds them); tint × alpha premultiplied; progress (Life: `agePercent`;
        Loop: wall seconds ÷ the effect's length, wrapped), wall seconds (age ÷ emit speed),
        strength, seed and indexes. `setParams` / `setIntensity` / `setTime` write uniforms.
      - **Draws only the live quads** (`Geometry.indexCount` = live × 6; the mesh is hidden at 0,
        since an index count of 0 draws the whole buffer); bounds are the live quads'
        (a `Geometry` subclass), so the hidden sprites never count in `getLocalBounds()`;
        `eventMode = 'none'`; blend from the particles; no allocation after warm-up. WebGL2 uploads
        only the live part; WebGL1's `bufferSubData` uploads the whole buffer, sized to the layer.
      - **Capacity** is the layer's Max particles at mount, capped at 512, read as the library
        reads it (a fraction rounds up; not a positive number = 1000, so plain).
      - **Fails closed, never invisible** (the sprites shown, no mesh): not WebGL; no effect or a
        body the shell refuses; frames on several texture sources; over capacity at mount; and,
        for good once seen while playing, a live count over capacity, a frame on another source,
        or a program that does not link (the first-use check reuses `programLinks` from
        `elementFx/shaders.ts`, logged once per program). `destroy` destroys its `Shader`, whose
        bind group otherwise stays listening on the shared atlas source.
      - **`fxMaterial`** (`packages/engine-fx/src/material.ts`): an init behaviour, registered by
        `registerFxBehaviors` but not in the authored `FX_BEHAVIOR_TYPES`, injected by
        `bindFxMaterial` so the stored config stays pure. Once per spawn wave it writes each
        particle's `fxSeed` (a whole number 0…97, so the varying stays exact even at mediump),
        `fxWave` (place ÷ (size − 1)) and `fxOrder` (spawn number ÷ the live Max particles,
        wrapping); recycle resets them. `rigger-fx.js` rebuilt.
    - **8d.1, the particle shell and the Particle node.** Merged (#1354, 2026-10-26).
      - **The shell** (`packages/constants-shared/particleShell.ts`, dependency-free):
        `PARTICLE_VERTEX` for a Pixi 8.22 `Mesh` custom shader, `PARTICLE_HEADER` defining all 12
        header helpers with particle meanings, `PARTICLE_ATTRIBUTES` and `PARTICLE_SHELL_NAMES`
        read off the shader text, and `particleShellSource(effect)`, which turns a compiled body's
        `uniform vec4 uFx;` / `uniform float uSeed;` into varyings, renames its `main` and wraps it
        in one applying the colour rule (design §7). The mesh's group colour (`uColor` ×
        `uWorldColorAlpha`) multiplies last even when the graph owns colour, so a layer fade fades.
        A body it cannot convert surely is refused (undefined) and will draw plain.
      - **Layout:** 7 vertex attributes (27 floats, 108 B a vertex) and 7 varying rows, inside
        WebGL1's guaranteed 8 and 8.
      - **Three header helpers**, `efxParticleColor()`, `efxParticleWave()`,
        `efxParticleOrder()`, in `EFX_HEADER_FUNCTIONS` / `EFX_HEADER_SIGNATURES` and in the element
        `HEADER` (`pixi-svelte` `elementFx/shaders.ts`) as `vec4(1.0)`, `0.0`, `0.0`. A pre-8d
        runtime drops an effect calling them (`unknownEfxCalls`).
      - **The Particle node** (`particle`, Input): Colour, Wave index, Spawn order; cost 0; no CPU
        form, so the motion graph refuses it; in the `/shaders` palette, with no thumbnail
        (`FLAT_NODES`). On an element it reads white, 0 and 0.
      - **Custom GLSL** also refuses the particle shell's 38 names (`uColor`, `uResolution`,
        `uRound`, `aEfx*`, `vEfx*`…) as a port, local or loop counter. A stored body declaring
        one stops compiling; reads of them were already refused, the node is admin-only and a
        day old, and none of the samples does.
  - **8c, the Custom GLSL node.** Merged (#1349, 2026-10-25).
    - **The node** (`packages/engine-shadergraph/src/customGlsl.ts`). `customGlsl`, pixel graph and
      subgraph bodies: `glsl: { code, inputs, outputs }`, ports with the subgraph port rules
      (`src/ports.ts`), default a vec4 `color` passed through. `customGlslIssues` is a typed
      recursive-descent checker of a GLSL ES 1.00 subset (its ports, locals, built-ins, `efx*`
      library functions; constant-bounded `for` loops, 64 rounds, 256 nested; no `while`, `do`,
      `discard`, `#`, declarations, `texture2D` or foreign names; 4 KB / 600 tokens), errors as
      `'glsl'` with `line N:`. Codegen: one `efxGlsl_<n>` function per distinct definition before
      `main`. Integers (literals, folded constants, every value a loop counter takes) stay within
      ±1023, all a mediump integer is sure to hold. Cost estimated by type as the body is checked
      (a matrix product n³, a matrix by a vector n², a built-in by its widest argument), capped per
      node (1,024 / 256 reads) and per effect; the built-in passes as bodies come to up to 1,053
      (Electrocute; Petrify 870).
    - **The server gate.** `shaderCustomGlsl` (admin by default): a save or restore adding Custom
      GLSL, or changing one's code or ports, against the stored graph (or the shared one it would
      shadow) is a 403 `custom-glsl`; moving, wiring around or deleting one is not; publishing a
      graph holding one takes it too (`customGlslSignature`, `hasCustomGlsl`).
    - **The runtime fail-safe** (`shaders.ts` `programLinks`, `ElementFxFilter.apply`). Pixi 8.22
      logs a failed compile and then draws with the unlinked program every frame, so the element
      vanished. Now each program's link is asked once; one that did not link draws the element as
      it is, disables the filter and warns once. It covers every built-in pass and custom effect.
    - **The editor.** Advanced › Custom GLSL for holders; `GlslCodeEditor.svelte` (line numbers,
      gutter marks, one undo step per pause), `CustomGlslProperties.svelte` (errors, help, ports via
      the shared `PortListEditor.svelte`), read-only for others; a test-compile on offscreen WebGL1
      and WebGL2 (`glslCheck.client.ts`) whose rejection shows on the node and its lines, marks the
      save pill and blocks Publish to library.
    - **Review.** An independent review found three blocking items and four should-fix; all are
      fixed and each fix is mutation-checked:
      - a loop counter could pass a mediump integer's range, wrap and never end (now ±1023);
      - a lone carriage return ended a line for the driver but not the checker, so a `//` comment
        could hide code (now read as a line end, and the emitted body must re-read as the checked
        tokens);
      - the FTP Browser's scoped mode could upload or move a graph into `shaders/` or
        `shader-backups/`, skipping the gate (refused now; an admin's full view still can);
      - a copy of an approved node did not count as adding one (definitions are counted now, here
        and in the editor's holder rule);
      - a forced save by a non-holder is pinned to the version the gate read;
      - a 4×4 matrix product was costed as one step (the cost is typed now);
      - `programLinks` used Pixi's internal `_getProgramData` unguarded (a missing or throwing call,
        or a driver answering no boolean, now means "not known": the pass draws and nothing is kept).
      Also: names starting `GL_` are refused (driver macros); the browser test-compile reports a
      lost context as "not known yet" and re-runs, and leaves no programs in Pixi's cache.
  - **8b, Break as an output node.** Merged (#1347, 2026-10-25).
    - Left: a live cut (Assemble) that throws partway through `startBreak` can leave the element a
      render group (at most once now, with no retry).
    - **The node** (`packages/engine-shadergraph/src/break.ts`). `breakOutput`, pixel graph only,
      one per effect: settings `kind` (one of the six break kinds, default Shatter) and `at` (0…1,
      default 0); its ports are the kind's params (number → float, colour → vec3, switch → 0 / 1,
      choice → the option's index). A port takes a Param of the same kind (a tie; a choice needs
      the same option set), a Number (number, switch and choice ports) or a Colour (colour ports);
      anything else, a constant out of range, a bad kind or `at`, two of them, or a phase not the
      kind's is a `'break'` error. What feeds only the Break Output counts as used and costs 0.
    - **Compiled** as `CustomElementFx.break` (`{ kind, at, params: value | { param } }`); the
      reader drops a break it cannot play (a kind or param it lacks, a bad tie, the wrong phase) and
      keeps the effect. Docs without a Break Output compile byte-identically (712 docs dumped).
    - **The runtime.** The graph, passes and motion play until `at`, then are held there while the
      break runs over the rest of the play (progress and seconds over the window); the still is cut
      with the graph's filters on, at the held pose, antialiasing inherited (WebGL2 stills kept
      their smooth edges only with this). A forward break takes the passes off the hidden element
      once cut; Assemble flies its pieces in over [0, 1 − at], redrawn live with the graph's look,
      then the graph plays the last `at`. A built-in break plays exactly as before
      (`shader-parity` identical).
    - **Older runtimes.** An exit effect also carries a fade (from 0.15 into the window, smooth to
      0) in its compiled alpha curve, or its motion program when that drives alpha, so a pre-8b
      runtime fades it out instead of leaving it on screen; on 8b it never shows (exactly 1 before
      `at`, the motion held in the window). A doc's own alpha curve is kept up to the fade.
    - **Twins.** The six break kinds have twins (the Output alone plus a Break Output at 0 with
      every param tied), held to their built-ins by `shader-twins` with no pixel different on WebGL1
      or WebGL2: 36 twins now.
    - **The editor.** The palette's Output family (while there is none), `BreakProperties.svelte`
      (the break, Starts at, a control per setting, the tie line, the phase fix), the engine's own
      refusal shown while a wire hovers a port, a kind change dropping wires it cannot keep in one
      undo step, Group refusing it and what feeds it. The phase fix is also in the settings.
  - **8a, the motion graph.** Merged (#1342, 2026-10-25).
    - **The doc.** `motionGraph` (`{ nodes, wires }`, still version 1): float nodes into one
      **Motion Output** (x, y, scale, scale x / y, rotation, alpha, padding). 39 motion nodes: the
      pixel library's number nodes (time, param, number, seed, the math, the time shapes,
      oscillators, `hash1` / `noise1`, band; every port a float there) plus two motion-only ones,
      **Element shape** (width, height, aspect) and the Motion Output, which the pixel graph refuses.
    - **The compiler.** `analyzeShaderMotion` / `compileShaderMotion`, folded into
      `compileShaderEffect` (a broken motion graph means the effect does not compile;
      `validateShaderGraph` / `analyzeShaderGraph` stay pixel-only). It emits `motion.program`: a
      flat op list (frame reads, constants and params once each, unreached ops pruned), capped at
      256 ops, 256 nodes and 1024 wires; a hostile doc is refused in under 25 ms. No Motion Output,
      or nothing wired into it, is a warning and no program. A doc without a motion graph compiles
      byte-identically (624 docs dumped against the base).
    - **The runtime.** `runMotionProgram` (`constants-shared/motionLibrary.ts`, the CPU twin of
      `glslLibrary.ts`, with `efxSinPi`, `efxHold`, `efxBounce`… in JS) runs the program each
      frame; no code is evaluated. A driven channel overrides its curve, its value final and clamped
      to the channel's range; undriven channels keep their curves. Padding from the program is per
      frame and overrides the doc's fixed padding. One seed per element per play, shared by the
      pixel graph's `uSeed` and the program. Effects without a program take the old paths
      unchanged.
    - **Fail-safe reader.** A program the reader cannot run (an unknown op, a bad operand, past the
      cap, a bad outputs map, a colour or missing param) is dropped and the effect kept, playing its
      curves, as a pre-8a runtime does (the soft floor in `docs/design/games-deploy.md`). No curve
      fallback is generated: sampled keys would alias a 25 Hz jitter and cannot follow width,
      seconds, looping or params; an author can key a curve as the fallback.
    - **The editor.** A **Pixel | Motion** switch in the subgraph bar (`MOTION_SCOPE`, a third
      `GraphScope`, so every gesture works in Motion); the motion palette; the Motion Output brought
      by the first motion node (one undo step) and pinned while others exist; **Delete motion
      graph** (asks; undoable); value-over-the-play curves on motion nodes (`MotionCurve.svelte`,
      debounced and keyed like the thumbnails); "driven by the motion graph" on curve rows and
      padding; pixel + motion errors in one count; `ops N/256` in Motion. Subgraphs stay
      pixel-only. A probe for a pixel thumbnail drops the motion graph, so a broken one never blanks
      them.
    - **The twins match their built-ins exactly.** Freeze, Petrify, Turn to gold, Electrocute,
      Poison and Bounce 3D carry motion graphs for the motion curves could not follow (the seconds
      played up to 25 Hz, timing moved by Hold, looping vs counted, the Bounces param, the element's
      shorter side); Melt, Wave X / Y, Flag, Bounce 3D and Electrocute drive their padding per
      frame. `motionGap`, `motionGapAtDefaults`, `paddingGap` and every place that showed or
      exempted them are deleted. A twin carries no fallback curve for what its graph drives (on a
      pre-8a runtime it plays without that motion), but keeps its old fixed padding (Melt 1.16,
      Bounce 3D 1.1, Electrocute 0.15, the waves and Flag 0.25) as the room a pre-8a runtime gives
      it; on 8a the program's padding overrides it.
    - **Program padding** has its own cap, `CUSTOM_ELEMENT_FX_MOTION_PADDING_MAX` = 11.6, the most a
      built-in asks (Melt: 1.45 × its longest drip × the strongest play); a pass padded that far
      draws up to about 590× the element's area, as built-in Melt does. The doc's fixed padding
      stays capped at 2. The analysis warns when a program's padding passes the cap at the params'
      defaults.

## Open items / next
1. **Step 8d.8 (next): play-QA and calibration** (design §15 step 8).
   - **8d.7's limits:** the Particles preview always uses Time over each particle's life (no Loop)
     and plays params at their defaults; an edit that changes the compiled effect restarts the
     particles; `/fx` reads cost from the route, not `effect.cost`; the `?fxdebug=1` load figure
     exists only for effects made for particles.
   - **The phone check:** integer seeds through a hash; WebGL1's whole-buffer upload per
     frame, now sized to the drive's peak; the parity tolerance is SwiftShader's, not a phone's;
     whether a dormant event layer should hold a cap slot; spawn order restarting at 0 on every
     emit re-init.
   - A layer that mounts before its frames are loaded stays plain for its life ("no frames when it
     mounted"); a remount fixes it. Deferring the decision would mean re-parenting a live emitter.
   - `setTime` has no caller (a Time change remounts); `FxMaterialSlots.release` clamps at 0
     silently; nothing warns before a ninth material layer is placed; the estimate ignores burst
     counts, `emitterLifetime` and container scale; a peak that grows then plateaus inside the
     2 s throttle prints only at release.
2. **Step 8c follow-ups.**
   - The test-compile runs in the author's browser only (the server has no GPU), so a phone's
     driver may still refuse a body the author's took; the runtime then draws the element as it is
     and warns once.
   - Integers stay within ±1023 on WebGL2 too: the pass is GLSL ES 1.00 everywhere, so its ints
     are mediump.
   - The cost reads every branch and every round a loop may run, so a body often costs less than
     its chip says.
3. **Step 7 follow-ups.**
   - **Thumbnail compile cost.** A new probe's first draw compiles a shader: 100–1,500 ms each on
     SwiftShader, one per frame, so opening the 113-node Petrify twin takes about 7 s of drawing
     there (real GPUs compile far faster, not measured). `KHR_parallel_shader_compile` or a cap on
     probes per open would help; the switch turns them off meanwhile.
   - Pixi keeps every distinct shader source for the page's life (the preview's too), so memory
     grows slowly over a long session.
   - A subgraph belongs to one effect; there is no cross-effect subgraph library yet.
   - The studio library's history is kept but not in the page: restoring is by hand.
   - A call's per-node cost is computed in the editor from `flattenShaderGraph`; it would sit
     better in the analysis.
   - `deploy/editor-shaders/` holds the whole set (library included) while the bundle carries only
     the named effects; trimming the deploy tree too needs the export to know the bundle.
4. **Step 8a follow-ups.**
   - **Degenerate ranges.** Smoothstep with From = To, and Remap with From min = From max, at the
     single point x = the edge (0 ÷ 0) give 0 in a motion graph but 0 (smoothstep) and 0.5 (remap)
     on the GPU. `shader-motion` excludes that one point and prints both; either side of it the two
     agree. No GLSL was changed for it (that would move existing pixel graphs).
   - The cost meter does not count padding: a program may ask for up to 11.6 shares of room, a
     filter area up to about 590× the element's.
5. **Step 6 follow-ups.**
   - **Built-ins long term** (§9.5): they stay hand-written beside their twins until the gate has
     held for a while; then decide whether to generate them from the twins.
   - The gate takes about a minute of `check:all`, most of it SwiftShader drawing the widest glow.
6. **Step 5 follow-ups.**
   - The preview has no rig still yet (the plan's fourth source).
   - The preview plays the params' defaults; there is no per-preview value yet.
   - The preview uses WebGL2 where there is one (CI's `shader-compile` covers WebGL1), does not
     follow a change of screen pixel ratio, and clips a graph padded to the 2× maximum at its edge.
   - Delete has no lease check: the ✕ on a graph another author has open deletes it (its last
     version is in History), and their next save is then refused as a conflict.
7. **Step 4 follow-ups.**
   - The pickers read the set once per page load; a graph saved in another tab shows after a
     reload.
   - The stored-flow check before Publish's assemble composes the Flow vocab without the custom
     kinds (Publish's own check of the shipped flow has them). An enum value is judged as text, so
     the verdict is the same; an enum-membership check would need them there too.
8. **Nodes the design lists that v1 does not have yet:** rim (a library entry now, `efxRim`, with
   no node) and the pixel input. Add them when an artist needs one.

## Blocked (owner / external)
- None.

## Recent changes
- 2026-10-27 — **Step 8d.7: `/shaders` Made for particles and the Particles preview** (see
  "Current state"). Merged (#1423): CI green; Current games 8 pass, 0 fail, 0 changed screens
  (it touched the shared runtime's reader and debug line). Step 8d.6 merged (#1407).
  - **Proof.** `compile.fixture.ts` 213; `check:shader-editor` 263; `fx-previews` 78;
    `shader-page` 42 (new); `fx-page` 31; fx-spike `model` 116; `particle-material`;
    `material-behavior`; `check:element-fx`; `check:shader-pipeline` 149; `check:launcher-gates`
    662; `check:vendored-bundles` (`rigger-fx.js` rebuilt); svelte-check at baseline; launcher
    build; `check:all` 568/568. 20 mutations, each failing its gate.
  - **Review.** Nothing blocking, no slot or ticker leak. Fixed: "Loading art…" stuck after a slow
    region was overtaken; a failed region's note left on the sample card; a paused edit emptied the
    stage (a rebuild while paused now plays 500 ms); the element playhead and thumbnails kept moving
    on Particles; the wrong overlay on Particles; "Infinity M" in the debug load; opening a doc now
    selects its default element. `fx-page`'s first case now waits for the mount line (it read too
    early under load).
- 2026-10-27 — **Step 8d.6: the other previews** (see "Current state"). Merged (#1407): CI
  green, Current games "runtime untouched" (launcher, tools and docs only).
  - **Proof.** `fx-previews` (new, in `check:all`) 52/52, the editor clock case included;
    `fx-page` 31/31; `particle-material`; `check:vendored-bundles`; `check:symbol-fx` 39;
    `check:fx-node-params` 105; `check:rig-fx-overrides`; `check:element-fx-flow` 20;
    `check:screen-cue-fx`; `check:shader-pipeline` 148; `check:launcher-gates` 661; the editor
    parity and GL-context checks; svelte-check at baseline; launcher build; `check:all` 567/567.
    Each new harness case fails under its mutation (both editor unmount guards removed, a throw
    keeping its slot, the old `view.html` fast path, no timeout, no auto-dispose, the editor's old
    wall-clock step: on screen ~850 ms against a 640 ms limit).
  - **Review.** Fixed: an editor unmount while art loaded, or an emitter config that threw, held
    a slot for good; two Rigger bands could draw before the set registered; the set's fetch had no
    timeout; finished overlay one-shots held their slots until cleared; the overlay's material sync
    could throw out of the ticker. The Scene Editor's clock, 2.3× slow for every effect, was fixed
    in its own PR (#1401).
- 2026-10-27 — **Step 8d.5: `/fx` authoring** (see "Current state"). Step 8d.4 merged (#1384).
  - **Merged** (#1392): CI green; Current games 8 pass, 0 changed screens, the one failure `cloud`,
    which fails on `main`'s runtime too (merged past it with the owner's approval).
  - **Proof.** `fx-page` (new, in `check:all`) 31/31, three runs: the set read, the picker, "on",
    the estimate then the measured load and badges, a param drag and Strength changing pixels with
    no remount, a paused ⚡ preview, Time remounting, the cap note drawing plain, Apply preset,
    save → reopen identical, a deleted graph named and drawn plain, the same-tab link, and a doc
    opened at load with a slow set mounting once it registers. fx-spike `model` 115;
    `particle-material`; `check:fx-params` 130; `roundtrip` 43; `player` 63;
    `check:shader-pipeline` 148; `check:launcher-gates` 661; `check:vendored-bundles`;
    svelte-check at baseline; launcher build; `check:all` 557/557. 30 mutations, each failing
    its gate.
  - **Review.** Blocking, fixed: a material on an effect opened at page load stayed plain, with no
    note, until edited (the stage never noticed the set registering). Fixed: drives left on a
    previous material's params are flagged; the `?fxdebug=1` line only printed at release; one
    throwing graph could fail the whole effects route; constants and plain-reason types; an
    unhandled rejection; a 4×/s state write; the estimate's padding.
- 2026-10-27 — **Step 8d.4: the ship chain, proven** (see "Current state"). Merged (#1384): CI
  green, Current games "runtime untouched: no game can differ".
  - **Proof.** `check:shader-pipeline` 146 (13 new, §8: the real `buildRuntimeBundle` and the real
    bake script against a local portal; a placed material ships on both paths, broken and deleted
    graphs are named, an unplaced effect ships and reports nothing); `check:launcher-gates` 661
    (both read sets, the animator and per-user cases, each shader handler's one scope, a form check
    on every `api/**/+server.ts`); `check:shader-editor` 253; svelte-check at baseline; `check:all`
    green. 31 mutations, each failing its check.
  - **Review.** Nothing blocking; `gate()`'s refactor identical, no new cross-project reach.
    Fixed: the bake could hang the check about 20 min on a stuck route (now fails in seconds); the
    handler scan missed `export function` handlers; a check that proved nothing alone; the write
    tool taken from a list position. The read scope was narrowed before review: `fx` and `rigger`
    read only the compiled effects.
  - **Also carried:** `check-family-tools` fixed on main (#1373's `pipelineBugs` / `gameBugs`
    missing from #1377's `BEFORE_CHARACTERS` list; it had failed 141/177).
- 2026-10-26 — **Step 8d.3: the material in the game** (see "Current state"). Merged (#1378): CI
  green but for Current games, "8 pass · 1 fail · 0 changed screen(s)", merged on the owner's
  approval: its one failure (cloud, republished today) fails on main too, the `lines` script
  stalling at the same step on both sides.
  - **Proof.**
    - **A real game** (`scripts/playtest/particle-material-play.mjs`, by hand): an `apps/lines`
      build with an effect layer on `custom:pulsetint` draws one mesh, 76 sprites hidden, and logs
      "on"; without `shaderEffects` it draws 83 plain sprites and logs "plain, not registered";
      0 errors, 0 stalls.
    - `particle-material` gains the game's mount on WebGL1 and WebGL2: the cap, a refusal at mount
      leaving nothing behind and giving its slot back, over 512, peak sizing, a layer drivable past
      512 or with no bound plain from mount with its slot never taken, a link failure while
      playing, and a `material.param` drive changing every drawn pixel of its layer by a uniform
      write (same mesh, shader, children, particles) while another layer of the same kind, judged
      alone, changes 0. Five quiet runs green.
    - `check:fx-params` 130 (21 new); fx-spike `roundtrip` 43 (a material survives save →
      normalize → export; a doc without one normalizes byte for byte to itself); `player` 63 (the
      mount decision, the cap per app, capacity, every plain-at-mount reason, a throwing
      construction giving its slot back); `check:element-fx` 232 unchanged; `material-behavior`
      13; compile fixture 207; `shader-compile` 28 sheets; `check:vendored-bundles`; svelte-check
      at baseline (pixi-svelte 14, lines 156, launcher 45); `check:all` 548/548.
    - Mutation-checked: 31 mutations, each failing its gate.
  - **Review.** Nothing blocking. Fixed: a drive past 512 could turn a layer plain mid-play (§10
    forbids the pop; now plain from mount); the cap counted per page, so a launcher page's stages
    shared 8 (now per app); a slot leaked when construction threw; a layer mounting before its
    frames reported the wrong reason; `material.params` lookups read inherited keys
    (`toString`…). Two flaky assertions in `particle-material` root-caused and fixed (a layer's
    particles straying into the next cell; a count read as a particle died).
- 2026-10-26 — **Step 8d.2: the material renderer** (see "Current state"). Merged (#1366): CI
  green but for Current games, "12 pass · 2 fail · 0 changed screen(s)", merged on the owner's
  approval: its two failures (match3test, testarcade, published after #1352 / #1353) fail on main
  too, the harness's play scripts not reaching their swap / spin steps.
  - **Proof.** `particle-material` (new, `tools/fx-spike/particleMaterial.mjs`, headless Chromium,
    WebGL1 and WebGL2, in `check:all`):
    - An Output-alone material against the plain sprite path over static, rotated, trimmed,
      flipbook, `fxSprite` pivot and offset, tint, colour overlay, fade, Add, a group at alpha 0.55
      tinted, a trimmed frame under padding, Max particles 10.3 (11 drawn) and resolution 2. Held to
      the twins' rule (2 steps, 0.25 % of pixels, no patch) where the two quads are the same (peak
      0.024 %). Where the material's quad is the whole padded frame and the sprite's the trimmed
      box, SwiftShader's 1/16 px corner snapping puts one-pixel edge lines on different sides, so
      the share there is 0.6 % (peaks 0.39–0.48 %, 0 patches; forcing the material's quad to the
      trimmed box gives 0). A negative control (the trimmed box a quarter texel off) must fail
      the comparator, and does (2.3–3.4 %, 12–33 patches).
    - Each input read back at the particle: progress, seed, strength, loop off by 0 steps; wave,
      order, seconds by 1; padding 0 px.
    - 9 fallbacks draw plain with their sprites drawing, the failing program logged once; the atlas
      keeps no listener after the layers are destroyed (17 before the fix).
    - 20,000 frames at about 430 live: 0 `bufferData`, 0 `createBuffer`. Syncing 512 particles:
      0.13–0.16 ms on SwiftShader (says nothing about a phone).
    - Mutation-checked (24 mutations, each failing its claim).
  - `material-behavior` (new, offline) 13; compile fixture 207; `check:element-fx`;
    `shader-compile` 28 sheets; `check:vendored-bundles`; svelte-check at baseline (pixi-svelte
    14); `check:all` 544/544.
  - **Review.** Nothing blocking. Fixed: the mesh's `Shader` was never destroyed (`Mesh.destroy`
    only drops it), leaving a listener on the shared atlas per mount; a fractional Max particles
    threw and a NaN one drew nothing with the sprites hidden; the parity gate's edge share (1 %)
    let a quarter-texel trim error pass in many cells, now 0.6 % with the negative control; added
    the trimmed + padded, mid-play second texture and resolution 2 cases.
- 2026-10-25 — **Step 8d.1: the particle shell and the Particle node** (see "Current state").
  Merged (#1354, 2026-10-26): CI green, Current games 12 pass with no changed screen.
  - **Proof.** Compile fixture 207 (14 new: the shell's layout, every helper defined, the node at
    every output and its neutral values, every compiled body converted, 21 refusals, comments
    neither hiding nor faking a declaration, the colour rule; byte identity over 2,210 docs against
    the base, 0 differing); `check:element-fx` (both headers held to the list, a reader without the
    8d names dropping an effect that calls them); `shader-compile` 28 sheets on WebGL1 and WebGL2
    (a new `particles` sheet: every reference, twin and node body drawn as trimmed, padded, tinted
    quads through a real Pixi `Mesh`, each program's link status checked); `shader-parity` against
    the base identical; `shader-twins` 36; `shader-motion` 53; `check:shader-editor` 253;
    `check:shader-pipeline` 133; `check:all` 539/539; svelte-check at baseline (launcher 45,
    pixi-svelte 14). Each new check mutation-checked.
  - **Review.** Nothing blocking. Fixed: a body reading a name only the element pass declares
    (`vTextureCoord`, `uElement`…) was converted into a fragment that would not compile; now
    refused. Recorded: the Custom GLSL name list grew (above); seeds to be quantised in 8d.2.
- 2026-10-25 — **Step 8c: the Custom GLSL node** (see "Current state"). Merged (#1349): CI green,
  Current games 12 pass with no changed screen. Step 8b merged (#1347).
  - **Proof.** Compile fixture 193 (the checker's every refusal, hostile and fuzzed bodies, the
    integer range, a lone CR, typed cost, codegen, the gate's signature, storage);
    `check:element-fx` (the link fail-safe for built-in and custom passes, a Pixi without the
    internal call, a driver answering no boolean); `shader-compile` 26 sheets on WebGL1 and WebGL2
    (a new `glsl` sheet); `shader-parity` against the base differs only in the new sheet;
    `check:shader-editor` 251; `check:shader-pipeline` 133 (the gate on save, restore, publish, the
    copies, the forced-save pin and the FTP Browser); the page played headless as a holder 40/40, a
    non-holder 11/11 and read-only 7/7, and 8b's break drives still 46/46 and 10/10; `check:all` 538/538;
    svelte-check at baseline (launcher 45, pixi-svelte 14).
  - **Review.** Three blocking items and four should-fix, all fixed (listed under 8c above).
- 2026-10-25 — **Step 8b: Break as an output node** (see "Current state"). Step 8a merged (#1342).
  - **Proof.** Compile fixture 173 (the node, every error, ties, the compiled break, the fade,
    hostile docs and a fuzz; byte-identity without a Break Output over 712 docs);
    `check:element-fx` (the window, a still with the graph's look, ties, Assemble, the fade unseen
    on 8b, the reader, a held exit with no passes, a failed cut fading once, a zero-length window);
    `shader-twins` 36/36 (the six break twins: no pixel different on WebGL1 or WebGL2);
    `shader-parity` against the base identical; `check:shader-editor` 212; `check:shader-pipeline`
    115; the page played headless 46/46 (the element plays, then breaks; scrubbed back it returns)
    and read-only 10/10 on WebGL2 and WebGL1; `check:all` 538/538; svelte-check at baseline.
  - **Review.** Nothing blocking. Fixed: a held exit put its graph passes back on the hidden element
    (an alpha-0 pass every frame); a snapshot that threw was retried every frame (now it fades once,
    warned once, for built-ins too); a zero-length window still cut; a kind change reset values
    without saying so (its notice now names wires dropped, values reset and Numbers out of range).
- 2026-10-25 — **Step 8a: the motion graph** (see "Current state"). Merged (#1342): CI green,
  Current games 12 pass with no changed screen.
  - **Proof.**
    - `compile.fixture.ts` 149: the motion graph's compile, analysis and every error, the program
      and its caps, hostile docs refused in under 25 ms with a bounded heap, malformed params never
      throwing (and a 400-doc fuzz of malformed docs through the motion path), byte-identity without
      a motion graph (624 docs dumped against the base), every twin's program read by the registry,
      no twin id shared across the two graphs.
    - `shader-motion` (new, in `check:all`): 53 cases, every motion node's JS against its GLSL on
      WebGL1 and WebGL2 over 2048 samples, unwired inputs included; hashed nodes compared
      statistically. Mutation-checked.
    - `check:element-fx`: the runtime drives channels from a program, overrides curves, clamps,
      pads per frame and drops a program it cannot run; each twin's motion matches its built-in's
      own sampler to 8.9e-16 up to strength 4.
    - `shader-twins` 30/30: every twin's motion 0.000 px off at every case and its room 0 px apart
      (now compared as numbers); mutation-checked (Gold's ring, Melt's and Bounce 3D's padding).
    - `check:shader-editor` 183 (the Motion scope and every gesture in it, the Output pinning,
      float-only wires, delete-the-motion-graph, driven-channel notes, curves from one pass, ids
      unique across the graphs); `check:shader-pipeline` 115 (a doc the compiler throws on is that
      doc's error, never the set's).
    - The page played headless: 41/41 editable and 14/14 read-only (switch to Motion, add and wire,
      curves, the preview turning, an error counted in both views, undo, delete with a confirm).
    - `check:all` 538/538; svelte-check at baseline (launcher 45, pixi-svelte 14).
  - **Review.** An independent review found one blocking item: a doc with a malformed param and a
    motion graph driving padding made the compiler throw, and since the server compiled the set
    with no per-doc guard, one such doc failed the effects listing, the export, the bake and
    Publish for its whole project. Fixed at the source (the motion path only reads well-formed
    params) and on the server (`compileStored` turns a compile that throws into that doc's error).
    Also fixed: curves cached as unworkable stayed hatched after an unrelated fix; curves cost a
    full compile per node (a 250-node chain 923 ms → 30 ms, one pass); node ids could repeat across
    the two graphs; the gate never exercised unwired inputs or `pow` below 0; the twins had dropped
    their fixed padding, which older runtimes still use.
- 2026-10-25 — **Step 7: editor v2** (see "Current state"). Merged (#1340): CI green,
  Current games 12 pass with no changed screen.
  - **Proof.**
    - `compile.fixture.ts` 108 (44 new: single, repeated and nested calls, every refusal, how issues
      land on the call, port types, cost, a body alone, storage, a flat shipped effect, and eight
      hostile docs refused in under 500 ms with the heap and every message bounded;
      mutation-checked). A dump of 414 docs (references, twins, the node
      showcase, 150 broken variants) compiles, analyses and validates byte-identical before and
      after; `snapshots/` unchanged.
    - `check:shader-editor` 152 (section 9, subgraphs: 222 seeded group-then-ungroup round trips
      over every reference and twin, the same GLSL back, and 10 selections refused by the port cap
      with a reason; Ungroup refused after a retype; sections 7–8, thumbnails and chips: 872
      probes over every twin and reference compile, keys change only for an edited node and what
      reads it, the live cap, chips sum to the analysis; 1,051 body probes; mutation-checked).
    - `check:shader-pipeline` 114 (publish and remove behind `shaderPublish`, 409 `exists`, an
      explicit replace, a graph that does not compile refused, backups beside the library,
      `inLibrary`, the bundle trimmed to named effects in both the runtime bundle and the bake, a
      graph with a subgraph saved and shipped flat).
    - `shader-compile` 22 sheets on WebGL1 and WebGL2, a new `subgraphs` sheet (each reference
      graph called one and two deep) pixel-identical to its `graphs` row; `shader-twins` 30/30.
    - The page played headless: subgraphs 30/30 editable and 12/12 read-only (group, open, edit
      inside, an inner error on the call, rename a port, ungroup, undo, delete-while-called);
      thumbnails 29/29 on WebGL2, WebGL1 and WebGL2 at 2× (pixels per type, one extra context,
      only the edited node redraws, only time-reading ones while playing, the cap of 40, a call's
      thumbnail identical to its grouped nodes', the switch frees the context); the studio
      library's buttons 32/32 (publish, update as a replace, a 409 from a publish meanwhile asking
      again, an effect with errors refused before any request, remove, a shared effect's copy
      still tagged, no buttons without the capability). It found one bug, fixed: a save dropped
      the open graph's in-library tag, so **Update library copy** fell back to a plain publish and
      met a 409.
    - `check:all` 534/534 (two re-run after a stale local install), svelte-check at baseline
      (launcher 45, pixi-svelte 14, lines 156).
  - **Review.** An independent review found one blocking item: the flatten's budget counted only
    body nodes, so a 199 KB stored doc (one subgraph with 2000 ports, called 500 times) took 33 s
    and 1.1 GB to analyse and blocked the launcher on every effects listing and Publish. Fixed with
    the port, subgraph and inlined caps above (that doc now refuses in about 22 ms). Also fixed: Ungroup
    after a port retype changed the graph (now refused, naming the port); prototype-named port ids;
    chips in an opened body inlining one level more than the analysis; the bake counting an object
    key as naming an effect; `canPublishSharedShaders` re-implementing `userHasCapability`.
- 2026-10-24 — **Step 6: the templates** (see "Current state"). Merged (#1333): CI green,
  `check:all` 531/531, Current games 12 pass with all 186 compared screens byte-identical.
  - **Proof.** `shader-twins` passes all 30 twins on WebGL1 and WebGL2. On every twin but three the
    largest difference is 1 step (float rounding). Sphericon and the dissolves differ by more only
    on isolated pixels where a hard edge sits on a pixel (at most 0.12% of a cell, never a patch).
    Mutation-checked: 13 of 15 injected one-constant changes fail it, down to a 1% highlight weight;
    the two that passed (poison's pulse 0.35 → 0.36, melt's padding) moved no channel more than 2
    steps over a patch, and the room rule now catches the padding one. After the review, a motion
    constant at the defaults (petrify's thud), a strength-0.3 floor (burn's glow) and a dropped
    padding gap each fail it too. Heavy twins are named (`HEAVY`: petrify 435), so one growing
    heavier fails. The compile fixture checks every twin: compiles clean, its id and
    label, its params against the catalog, phase and length, one twin per kind, the pass twins'
    ties; the node twins' GLSL is snapshotted (`snapshots/twins/`). `check:element-fx` checks the
    seed: two elements get different seeds and keep them; an unseeded effect draws none.
  - **Precise curves.** The headless renderer's `sin` is off by up to ~2e-4 at large arguments,
    enough to fail Twist at ±1080°; the twins build their bells and swells on Oscillate (exact,
    `efxSinPi`) and Bell / Swell / Pulse stay as they were, so no saved graph changes.
  - **Review.** An independent review found one blocking item, version skew: an effect compiled by
    a newer launcher calls library entries an older runtime lacks (fixed: the reader drops it; the
    floor is documented; existing nodes emit what they did). Its should-fixes (motion held at the
    defaults, a landscape card and strength 0.3, Melt's padding) and nits are fixed. One is left by
    choice: the pass twins keep their identity graph pass (it clamps colour to alpha and gives the
    effect its filter and margin, so skipping it would change existing effects).
  - **Built-ins unchanged.** `shader-parity` against the base: all 50 kinds, the sides and signed
    sheets identical on WebGL1 and WebGL2; a deliberately changed library constant shows in its
    kinds' rows.
- 2026-10-24 — **Step 5: the `/shaders` editor** (see "Current state"). Step 4 merged (#1329).
  - **The canvas lift.** `$lib/graph/GraphCanvas.svelte` (the `@xyflow/svelte` shell: nodes,
    wires, the page's node types, its connection rule, a fit signal, a palette drop) and
    `$lib/graph/dnd.ts` (`writeDrag` / `readDrag`) came out of /flow-v2; `FlowCanvasV2.svelte` is a
    thin wrapper keeping Flow's styles. Two props were still on their 0.x names
    (`deleteKeyCode`, `multiSelectionKeyCode`), so Flow's Delete and multi-select keys never
    reached the canvas; they are `deleteKey` / `multiSelectionKey` now. `docs/ui-inventory.md` §20.
  - **The compiler's analysis** (`engine-shadergraph`): `analyzeShaderGraph(doc)` answers the
    issues, each port's resolved type, the cost and the reads, and `canFeed(from, to)` is the wire
    rule the canvas asks.
  - **Gates.** The shader routes read for `shaders` too, and write for `shaders` only;
    `check:launcher-gates` lists `shaders/backups`; `check:doc-backups` has the `shader` stem; a
    setup duplicate leaves graph history behind.
  - **svelte-check.** `apps/launcher-api` 46 → 45 (the Flow prop names).
  - **Play-QA of the whole page** (the real page and children, compiled and bundled, every API route
    answered from an in-memory store, driven in Chromium): boot, new / open / wire / refuse a wire,
    an error on its node and in the status bar, autosave and Ctrl+S under the ETag, a 409 and
    overwrite, undo / redo, a shared graph saved as the project's copy, delete. It found and fixed:
    a second save after Ctrl+S; a graph switch during an autosave that copied the shared graph into
    the project unedited (and cleared its tag, and re-leased the old graph); `?shared=1` left in the
    URL after the copy was saved; fields overflowing the settings pane.
  - **Review fixes.** An independent review: a delete now copies the graph into History first
    (`deleteDocWithBackup`; an autosave copies at most every 5 minutes, so up to 5 minutes of work
    was lost while the dialog promised History); a `?graph=` the project lacks opens nothing and
    says so (it had opened an Output-less doc nothing could repair); a create whose id a colleague
    took meanwhile says so instead of offering to overwrite theirs; the canvas refuses a wire the
    compiler would (a type its node takes elsewhere, a loop through other nodes); Ctrl+S on an
    unedited graph saves nothing (on a shared one it made the project's copy); a multi-selection
    survives a rebuild; a slower open no longer lands after a later one; renaming a param takes its
    Param nodes and pass ties with it. Also from the guide's read-through: an effect-level error no
    longer stops the port types and cost, the Output cannot be deleted, a read-only canvas changes
    nothing, Game Maker's publish note lists the shader effects a game will not play.
- 2026-10-24 — **Step 4: the pipeline** (storage, routes, ship, pickers). See "Current state" for
  what each part does.
  - **Proof.**
    - `check:shader-pipeline` (75 checks, run by `check:all`), over the real storage, export and
      routes with an in-memory R2. Mutation-checked: dropping the pull's `editor-shaders`, the
      shadowing, the game's registration, the slug's underscore strip, the export's prune or
      widening the read gate each fail it.
    - **Play-QA** (`scripts/playtest/shader-effect-play.mjs`). The current-games `cg-lines`
      stand-in snapshot with Pulse tint and Power-up compiled into `shaderEffects` (the export's own
      `compileShaderEffect`) and placed as Element FX (Pulse tint looping on the reel frame,
      Power-up on its caption), served as the launcher serves a published game, played on a build
      of this branch against the real test server. It passes: all three shader programs are on the
      stage (`element-fx-custom-pulsetint`, `element-fx-custom-powerup` and Power-up's glow pass),
      the frame takes the tint (30,660 pixels differ from the same snapshot without
      `shaderEffects`, whose entries play nothing and whose stage has no such program), the effects
      move over time (8,331 pixels between two moments, 81 without), and the boot reaches idle with
      no errors and no stalls. It proves the game half on the runtime-bundle path; storage, the
      export's writes and both bundle paths' wiring are `check:shader-pipeline`'s. The exit as
      worded, a graph authored on the deployed launcher and played in a game published there,
      follows the merge.
  - **Review.** An independent review found nothing blocking. Fixed before the PR:
    - Publish said nothing when a graph was left out or deleted: it now names every effect a game
      will not play, and so does the bake;
    - the play script never failed: it now passes or fails on the programs, the pixels, errors and
      stalls, and says what it does not prove;
    - a graph named "index" lost its deployed file to the index (now `_index.json`), and the
      deployed index carried compiler errors into every build;
    - a save had no size cap; a node value named `__proto__` set the prototype in memory; a shared
      graph's ETag would have made the editor's override save a 409; reads were one at a time;
    - the Scene Editor called a deleted custom effect an unknown kind; registration now runs in the
      browser only.
  - **Also:** `ELEMENT_FX_CATEGORIES` gains `custom`; `standardVocab.ts` exports
    `ELEMENT_FX_KIND_ENUM` (the `check:element-fx` pin follows it); the shader routes are on
    `check:launcher-gates`' stale-tab list; `check:project-duplicate` expects `shaders/` in a setup
    copy.
- 2026-10-24 — **Step 3: the runtime** (custom Element FX kinds).
  - **Catalog** (`constants-shared/elementFx`): `ElementFxKindId` (a built-in or `custom:<id>`),
    the registry, `ELEMENT_FX_PASS_KINDS`, the curve and motion types, `sampleElementFxCurve`, and
    `elementFxParamUniform`, moved here from `engine-shadergraph` so the runtime and the compiler
    share one. `findElementFxSpec` looks up any kind (`undefined` for an unregistered custom one);
    `elementFxSpec` stays the built-ins' lookup. The launcher's label and preview lookups of a stored
    entry use the first and take an `undefined`.
  - **Runtime:** an effect now holds a list of passes; a built-in filter kind has one, so built-ins
    play as before. `playElementFx` resolves a built-in or a registered custom kind, and plays
    nothing for any other.
  - **Compiler:** `compileShaderEffect`, and the doc's `description`, `passes` and `motion`, with
    their validation: 12 → 14 kinds of error (`pass`, `motion`). The doc id must be a slug, and the
    length within the runtime's 50 ms…20 s.
  - **A sixth reference graph, Power-up**, uses both: a warm swell, a hop and growth on motion
    curves about its base, and a glow pass tied to its colour param. Noise dissolve now masks its
    edge glow by the element's alpha: played through the runtime, whose pass area is the element
    plus a margin, it had painted the edge over the empty margin.
  - **Proof.**
    - `check:element-fx`: a new section, 24 checks (27 after the review). A custom effect read with every trigger and
      kept before it is registered; posed by a timeline; sped up by turbo; held as an exit and
      released by an enter; stopped back to rest. Its graph, its built-in pass with a tied colour,
      and its motion all play. Mutation-checked: dropping the param uniform write, and the reader
      dropping custom kinds, each fail it.
    - The fixture: 55 checks (the effect, every bad pass and curve).
    - `shader-parity` and `shader-compile` draw a new `custom` sheet: the six reference graphs
      registered and played through `playElementFx` on WebGL1 and WebGL2.
    - The 50 built-ins, every side and every signed param render identical to `main`.
  - **Review.** An independent review found nothing blocking; the runtime refactor held under its
    probes (stacking, removal, destroyed containers, poses back to rest). Fixed before merge:
    - a motion curve could push alpha past 1 (Pixi wraps it) or a strong shrink through 0 (the
      element flipped over);
    - a length given as text or a list compiled;
    - padding had no upper bound;
    - the registry trusted its input, so a malformed effect could throw on every tick: it now reads
      each one, and the gate holds four malformed effects to being left out;
    - a pass's strength could reach 16, any built-in filter kind could be a pass at runtime, and a
      pass resolved its params every frame;
    - an upper-case colour was refused in a pass;
    - `shader-parity shoot --root <a base older than step 3>` failed to bundle: such a base now
      shoots without graph sheets.

    The gate's custom section has 27 checks, each new one mutation-checked (dropping the scale
    clamp, or the registry's reader, fails it).
- 2026-10-23 — **Step 2: the `engine-shadergraph` package** (schema, node library, validator,
  compiler).
  - **The library grew by 13 building blocks** for the nodes to call (29 in all): FBM, the hold,
    ease-in-out and ease-out-back timings, the rotate / twist / bulge / ripple / wave warps, a YIQ
    hue shift, a relief normal, a metal ramp and a light model.
  - **Five built-ins moved onto them.** The twist, bulge, ripple and wave passes and turn-to-gold
    carried inline copies of the warps, the relief normal and the metal ramp (`goldRamp`). The warps
    are written in pixels as the built-ins had them, and the nodes convert from UV around them.
    - The parity harness gained a `signed` sheet: every number param that can go below 0, at its
      minimum (bulge's pinch, twist and the turns backwards).
    - All 50 kinds, every side and every signed row render identical to step 1 on WebGL1 and
      WebGL2.
  - **`ELEMENT_FX_PHASES`** (`constants-shared/elementFx.ts`) lists the four phases as a value, so
    the validator can check a doc's phase.
  - **The fixture** (`packages/engine-shadergraph/compile.fixture.ts`, run by `check:all`): 44
    checks.
    - Every node output compiles in a graph of its own: 173 graphs, the Param node once per param
      kind and every generic node again fed a vec2, a vec3 and a vec4. Its GLSL links and passes a
      lint: every function it calls is GLSL ES 1.00's own, a pass-header helper or a library entry,
      no reserved word as a name, no `--`.
    - Every input reads something unwired (a default or a default expression).
    - No graph reads the element more often than it reports.
    - The five reference graphs compile the same every time and match their committed GLSL
      (`snapshots/<id>.frag`; `--update` rewrites them after a deliberate codegen change).
    - An Output alone compiles to exactly the element as it is, read once.
    - Each validator error and warning fires on a doc built to trigger it, malformed params and
      stray nodes included.
    - Type conversion goes one way only.
    - Hostile ids and labels never reach the GLSL.
    - Param uniforms hold the right values.

    Mutation-checked:
    - a misspelt GLSL call (`clmp`) fails the fixture;
    - allowing a vec2 into a vec3 port fails it;
    - an unparenthesised negative literal fails it;
    - a type error only a driver sees (Power's exponent not widened to the vector) passes the
      fixture and fails `shader-compile`, naming `pow.out.vec2` on both WebGL versions.
  - **In a real browser.** `pnpm --filter fx-spike shader-parity shoot` also draws two graph
    sheets through the real `ElementFxFilter`, on WebGL1 and WebGL2: the five reference graphs at 8
    moments, and every node graph (`tools/fx-spike/shaderGraphs.entry.ts`). `shader-compile` draws
    the same sheets in CI (`check:all` gives it a browser slot, as it does the Rigger's browser
    spikes). `shader-parity diff` now counts a sheet missing on one side as a difference; only the
    graph sheets may be absent, from a checkout without the package.
  - **Review.** An independent review found nothing blocking. Its findings were fixed before the
    PR:
    - the validator threw on a malformed param list;
    - reads of the element defaulting into inputs went uncounted;
    - `diff` passed when a sheet went missing;
    - generic nodes were only ever compiled as floats, and the lint only checked `efx…` names;
    - the new warps, relief normal and metal ramp had inline twins in the built-ins.

    Also fixed from its nits:
    - the Output let a channel exceed alpha;
    - zero widths reached `smoothstep(e, e, x)`;
    - Pulse and Gradient did not do what their descriptions say;
    - stray nodes were half-checked;
    - choice params took non-word options;
    - two dead paths;
    - a duplicated param-type table;
    - two unclear messages.
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
