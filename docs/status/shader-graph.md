# Invisible Shader Graph — status

> Design: [docs/design/invisible-shader-graph.md](../design/invisible-shader-graph.md) · Guide: none yet (step 5) · Agent: `.claude/agents/invisible-shader-graph.md`

**One-line state:** plan approved 2026-10-23. Step 1 (one shared GLSL library under the 17
built-in shader passes, #1320) and step 2 (the `engine-shadergraph` package: nodes, validator,
compiler, #1322) are merged. Step 3, the runtime (a compiled graph plays as `custom:<id>` wherever a
built-in Element FX does), is in review (#1328). Step 4, the pipeline, is built on top of it: a
project's graphs are stored, compiled into Publish and the bake, registered by the game at boot and
listed by the Scene Editor, Symbols and Flow pickers. No `/shaders` tool exists yet (step 5): a
graph is saved through `/api/shaders/save`.

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
    another checkout, such as a worktree of the base.
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
- **Step 3, the runtime.** Built and in review.
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
- **Step 4, the pipeline.** Built and in review, on top of step 3.
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
    whose pickers list custom effects (Scene and Component Editors, Symbols, Flow); save and delete
    gate on the Scene Editor until `/shaders` is a tool (step 5). Every route refuses a tab on another
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
- **Not started:** steps 5–8 (the `/shaders` editor, templates, editor v2, later).

## Open items / next
1. Merge step 3 (#1328), then step 4.
2. **Step 5: the `/shaders` editor.** It takes the save gate over from the Scene Editor (a `shaders`
   tool in `roles.ts`, with its doc, rule 9), acquires the lease (`/api/lease`, doc key the graph
   id) and keeps history (`docBackups`, a target per graph).
3. **Step 4 follow-ups.**
   - What ships is the project's whole set. Once the shared library has entries (step 7), ship only
     the graphs a doc names (`custom:<id>` in the scenes, components, symbols and flow).
   - The pickers read the set once per page load; a graph saved in another tab shows after a
     reload.
   - The stored-flow check before Publish's assemble composes the Flow vocab without the custom
     kinds (Publish's own check of the shipped flow has them). An enum value is judged as text, so
     the verdict is the same; an enum-membership check would need them there too.
4. **Nodes the design lists that v1 does not have yet:** Perspective plane (the 3D flip's ray cast
   as one node), star / sparkle, rim, loop envelope and the pixel input. Add them when a template
   (step 6) or an artist needs one.

## Blocked (owner / external)
- None.

## Recent changes
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
