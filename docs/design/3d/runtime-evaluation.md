# 3D games — runtime evaluation (renderer, integration, size isolation)

> Status: **EVALUATION, nothing built.** 2026-11-17, against `main` ca9810945. One of four parallel
> reports merged into `docs/design/3d-games.md`; this one covers the 3D **runtime** and how it is
> kept out of the games we already ship. Every size here was measured, not quoted: the runtimes
> with the repo's own gate (`node scripts/check-family-runtime.mjs --measure`, release env, gzip -6)
> on a clean export of ca9810945, the renderers with esbuild (minified, tree-shaken, gzip -6) over
> the imports an arena brawler needs (§1.2). Scratch inputs are not committed.

**The owner's constraint, restated as a test:** after 3D lands, the four runtimes we release today
(`lines`, `match3`, `arcade`, `card`) build to the **same bytes, chunk for chunk** (with the build
stamp pinned, §3.5), and a 3D-only change releases **nothing** to them — not "about the same size". §3 shows the repo already has most
of the machinery, so it is a property we can prove in CI, not a promise.

## Recommendation in one paragraph

Render 3D with **three.js** (MIT; 183 KB gz measured in our build for the whole arena set —
renderer, toon, shadows, skinned glTF, KTX2, meshopt — the smallest credible option by 2–3×) in
**its own canvas under the Pixi canvas**, which stays on top for the HUD. Ship it in a **fifth runtime, `arcade3d`**, built from the same `apps/lines` with a new family seam:
in that build `families/arcade` resolves to `families/arcade3d.ts`, which re-exports the arcade
seam and swaps `ArcadeStage` for a 3D stage that dynamic-imports `packages/engine-3d`. The four
existing runtimes never see the new module — **zero changed bytes**, proven on a scratch
build (§3.6). Two things the code split does not cover must ship with it: the build stamp
compiles the commit and the **lockfile hash** into every bundle, so (a) a reproducible-build
switch plus a byte-manifest gate, `check:runtime-bytes`, and (b) **skip-unchanged releases**, so a 3D-only merge does not make every 2D player re-download the
~720 KB bundle. First step: a one-week spike that lands the seam, the gate and a toon cube (§6).

**Quality tiers (§5):** the assets report's `full` / `half` / `quarter`. A build pin (`IE_ART_TIER`)
wins; on the web the tier is chosen at boot from device class and GPU capability, never from memory,
with a player setting and `?tier=`. LOD switches by screen size through `THREE.LOD`, and the
3D canvas scales its resolution dynamically while the HUD stays sharp. The desktop high-res game is
the same web runtime pinned to `full`, with an optional Electron wrapper; nothing native renders.
An `ultra` tier sits above `full` for latest-gen GPUs: offered, never auto-picked, and it gives a
console port its assets but not its runtime (§5.5). The 2D runtimes stay byte-identical, which
rules out adding `quarter` to `RESOLUTION_TIERS`.

---

## 1. Renderer

### 1.1 The options

| | three.js r181 | Babylon.js 8.56 | PlayCanvas engine 2.24 |
|---|---|---|---|
| Licence | MIT | Apache-2.0 | MIT |
| Arena set, gzip -6 (§1.2) | **187 KB** (157 KB w/o KTX2+meshopt) | 556 KB | 337 KB |
| Same, brotli | 153 KB | 395 KB | 260 KB |
| Skinned glTF + blending | `AnimationMixer`: cross-fade, additive, per-bone masks by clip filtering, `SkeletonUtils.clone` for many instances | `AnimationGroup` weights + blending, mature | anim state graph (layers, blend trees, masks) — the most Unity-like |
| Toon shading | `MeshToonMaterial` + gradient ramp, built in; outline via inverted hull or `OutlineEffect` | no toon material in core (Node Material / custom shader) | custom shader chunks |
| KTX2 / meshopt | `KTX2Loader` (Basis transcoder 248 KB gz wasm, lazy) / `MeshoptDecoder` | both | both |
| WebGPU | `three/webgpu` + TSL, opt-in (199 KB gz for the core set) | mature WebGPU engine | WebGPU beta |
| Tree-shaking | good — the core set is 131 KB gz, everything else pay-as-you-go | poor: side-effect imports, scene components | poor: `AppBase` + component systems still pull most of the engine |
| Svelte 5 fit | plain imperative objects; `@threlte/core` 8 exists for Svelte 5 if we ever want declarative | imperative; no Svelte binding | imperative + entity/component; no Svelte binding |

Also considered and rejected: **Pixi 3D (`pixi3d`)** — unmaintained since Pixi 7, no Pixi 8 port;
**Unity WebGL export** of BattleOTtheYear — 10+ MB runtime, its own canvas and loop, no Flow, no
Pixi HUD, and it would be a second engine rather than a view mode; **raw WebGL / OGL** — OGL is
small (tens of KB, not measured) but has no skinned-glTF animation blending; we would be writing three.js again.

### 1.2 How the sizes were measured

One entry per renderer that does what an arena needs: a WebGL2 renderer, scene, perspective camera,
hemisphere + directional light with soft shadows, fog, a toon ground, load a skinned `.glb` (KTX2
textures, meshopt geometry), clone it, play a run clip and cross-fade into a hit clip, frame loop.
PlayCanvas is the minimal `AppBase` with render, camera, light and anim systems and the container
and texture handlers, which is its documented tree-shaken setup. Breakdown for three.js:

| three.js slice | gzip -6 |
|---|---|
| core: `WebGLRenderer`, scene, camera, light, toon material | 131.0 KB |
| + `GLTFLoader` + `AnimationMixer` | 157.1 KB |
| + `KTX2Loader` + `MeshoptDecoder` (the full arena set) | 187.4 KB |
| `three/webgpu` core with `MeshToonNodeMaterial` (instead of the first row) | 198.6 KB |
| Basis transcoder (wasm + js), fetched on the first `.ktx2` only | 248 + 15 KB |

### 1.3 Decision: three.js, WebGL2 first

three.js wins on every axis that matters here: smallest by 2–3× once tree-shaken, MIT, toon
material in core, the most-used glTF/animation stack on the web (the asset-creation report's
glTF pipeline lands on it unchanged), and the largest pool of examples. Babylon's better WebGPU and
inspector do not pay for 3× the bytes. PlayCanvas's anim graph is closest to Unity's Animator, but
its engine is built to be the whole app (its own loop, input, resize), which fights our Svelte +
Pixi shell.

**WebGL2, not WebGPU, at first** — the same reason `InitialiseApplication.svelte` forces Pixi to
`preference: 'webgl'`: on the phones we already met, mobile WebGPU initialises and then paints
nothing. `three/webgpu` falls back to WebGL2 itself, so we can switch later behind a switch,
but it costs +12 KB gz and the TSL material path for nothing today.

Mobile cost is set by content, not by the library: a 6–10 character arena is ~10–40 draw calls
with skinned meshes at 2–5 k triangles, which a mid phone should hold at 60 fps on WebGL2 (an estimate, not measured here). The levers are
the ones Pixi already uses here — DPR clamped to [1, 2] (`canvasResolution`), `renderQuality.ts`
lowering it under load — plus one 1024² shadow map and `InstancedMesh` for props. The animation +
camera report owns the per-frame numbers; nothing here needs WebGPU.

---

## 2. Integration with Pixi and pixi-svelte

### 2.1 Two stacked canvases (recommended) vs one shared WebGL context

**Two canvases.** The three canvas goes into the same `wrap` element as Pixi's, **under** it;
Pixi's canvas stays transparent (`backgroundAlpha: 0`) and on top, so the HUD, the win text, the
cinematic and every 2D screen render as today. Pointer events land on the Pixi canvas first (HUD
buttons keep working); what the HUD does not take is forwarded to the 3D view's picking.

| Concern | Two canvases | One shared context |
|---|---|---|
| HUD | Pixi unchanged | Pixi must `resetState()` after three every frame, and vice versa |
| Pixi's back buffer (`useBackBuffer`, on for every game) | unaffected | Pixi renders into an offscreen target and **blits over the canvas** — three's frame is overwritten unless both are re-plumbed |
| MSAA / opaque canvas / `trimBackBufferPasses` | unaffected | each must learn about the other renderer |
| Resize, DPR | each renderer `resizeTo: window`; 3D may run a lower DPR than the HUD (a big phone win) | one DPR for both |
| Cost | one extra compositor layer, one extra GPU surface (~8 MB at 1080p × DPR 2) | none |
| Bytes in 2D runtimes | **0** | changes `pixi-svelte`'s init for every game |

The shared context is what Pixi's own "mixing with three.js" guide shows, and it is the right call
for a 3D object inside a 2D scene. Here it is the wrong one: it changes `InitialiseApplication.svelte`
for every runtime, and our Pixi path (back buffer, auto-opaque canvas, trimmed passes) is exactly
what makes sharing fragile. **Rejected.** One guard on the stacked path: the auto-opaque canvas
(`AUTO_OPAQUE` + `measurePageBackdrop`) must not turn opaque over a 3D view; the 3D stage sets the
page backdrop it measures (a CSS background on `wrap`) so the existing rule already answers
"transparent". To be proven in the spike, not assumed.

### 2.2 How a 3D view plugs into the arcade loop, the camera and Flow

The arcade family is already shaped for this — **presentation is separate from simulation**:

- **The loop is unchanged.** `engine-mechanics` steps bodies in flat world px at a fixed step and
  the room owns places online. A 3D game is still a 2D simulation on the ground plane (x, y → x, z),
  with height as presentation (jumps already exist in `jumps.js`). That keeps `check:arcade-motion`,
  `check:room-sim` and the replays meaningful, and the 3D gameplay report can add a real `y`
  later as a new export, per the family invariant "new mechanics are new exports".
- **Drawing.** Today `ArcadeStage.svelte` "draws nothing of its own" — bodies are spawned instances
  drawn by a spawn layer. The 3D stage reads the same bodies each frame and moves one three.js
  object per body (a character rig by its character id). The layout simply has no 2D art on the
  play-field screen. This is the same contract as the isometric projection (P11.4): "the loop, the
  room and the netcode keep every place in flat world px; the stage projects at draw time, and a
  pointer is un-projected back."
- **Camera.** `engine-mechanics` `camera.js` keeps following, dead zone, smoothing, look-ahead and
  shake in world px; the 3D stage maps that view to a camera rig (a target point on the ground plus
  pitch, yaw, distance from the screen's 3D settings). One camera model, two renderings; the
  animation + camera report owns the rig.
- **Input.** `useArcadeInput` maps a pointer to a world point through the 2D camera; the 3D stage
  passes a ray-cast onto the ground plane instead. Keys and the online input packet
  `{seq, moveX, moveY, buttons, aimX, aimY}` are unchanged.
- **Flow.** Nothing new is needed to start: signals (`collide`, `enterZone`, …) are raised by the
  loop after the frame, not by the renderer. 3D-only presentation actions (play a clip on a
  character, camera shot) come later as a vocabulary the 3D seam adds to `flowVocabularies` —
  which the arcade seam already exports per family, so the 3D seam extends it without touching
  `engine-flow-v2`'s shared code.

---

## 3. Size isolation — the key deliverable

### 3.1 What we ship today (measured)

`check:family-runtimes --measure` on ca9810945 (release env, gzip -6, bytes):

| Runtime (`PUBLIC_IE_FAMILIES`) | First visit | of which shell | Online boot | Committed budget |
|---|---|---|---|---|
| `lines` (slot) | **728,124** | 3,972 | — | 710,219 (**over, +2.5 %**) |
| `match3` | 736,229 | 3,974 | — | 718,561 (over) |
| `arcade` | 759,607 | 3,974 | **816,805** | 797,252 (over) |
| `card` | 740,765 | 3,974 | — | 722,599 (over) |

Per chunk, `lines` (one build, no DSN; `arcade` in brackets where it differs):

| File | gzip -6 | When it loads |
|---|---|---|
| `index.html` shell | 4.0 KB | every visit (`no-store`) |
| `_app/immutable/bundle.<hash>.js` | 720.1 KB [arcade 751.7] | first visit, then cached (immutable) |
| `assets/bundle.<hash>.css` | 2.6 KB | first visit |
| 4 lazy chunks (PerfHud, canvas fallback, …) | 17.4 KB | some boots |
| arcade online chunks (`@colyseus/sdk` + room code) | [57.2 KB] | online arcade boots |
| `libktx.wasm` + `libktx.js` (KTX2 transcoder) | 321.0 + 48.5 KB | first `.ktx2` texture only |
| Sentry SDK (release builds with a DSN) | ~31 KB | when reporting starts |

Three findings on the way, all of which shape §3.5:

1. Every runtime is already **2–2.5 % over its committed budget**, unnoticed, because the release
   job only warns (`check-family-runtime.mjs`: "a warning here, never a failure").
2. **Two builds of one commit are not the same bytes** (same sizes, different hashes). Two
   sources, both found by diffing kept builds: SvelteKit's `kit.version.name` defaults to
   `Date.now()` and is compiled in (`_app/version.json` = `{"version":"1794900719219"}`), and
   `__IE_BUILD__` (`config-vite` `buildStamp` → `provenance.js`) compiles in `builtAt`, the commit,
   `engineSha`, `gameSha` — and **`lockfileSha256`, the hash of `pnpm-lock.yaml`**. With all of
   them pinned, two builds are identical file for file (`diff -r` clean).
3. Consequence of 2: **every release already re-hashes `bundle.<hash>.js`**, because the commit
   is in it. A merge that only touches `packages/engine-3d/**` would still release `lines`,
   `match3`, `arcade` and `card` (the workflow's path filter is `packages/**`), and every player
   of every game would re-download the ~720 KB gz bundle for code they never run. And merely
   **adding `three` to the workspace changes the lockfile hash, so every runtime's bytes**. The
   constraint is therefore not met by code isolation alone — §3.5 closes both.

### 3.2 What already keeps families apart

The repo solved the same problem for families in Phase 11, and 3D should reuse it rather than
invent a flag:

1. **One build, several runtimes.** `apps/lines` is built once per runtime id with
   `PUBLIC_IE_FAMILIES` (`packages/constants-shared/runtimes.ts` → `runtime-release.yml`'s matrix),
   and each id is released to its own `_runtime/<id>@<version>/` with its own pointer.
2. **Seams resolved at build time.** Shared code reaches a family only through
   `apps/lines/src/families/<family>.ts`; `config-vite` `familySeams()` resolves a left-out
   family's seam to `families/off/<family>.ts`, so **the bundler never sees the family's code** —
   not a dead branch, an absent module.
3. **Lazy chunks.** `config-vite` `lazyChunks()` turns SvelteKit's `inlineDynamicImports` off for
   the client build, so an `import()` becomes its own content-hashed chunk under
   `_app/immutable/chunks/` (arcade's online code is already one: `@colyseus/sdk`, ~58 KB gz, only
   online boots fetch it).
4. **A family gate.** `check-family-runtime.mjs` runs in every release job: markers prove a
   left-out family is absent from every file, and `family-runtime-budget.json` holds each runtime's
   first-visit bytes (+2 %).

### 3.3 The three ways to load 3D only for a 3D game

| Option | Existing runtimes' bytes | Verdict |
|---|---|---|
| **A. `import()` in the arcade runtime**, keyed on a config switch (`arcade.view: '3d'`) | `arcade`: the import site + the switch (~120 B gz, measured as `arcade3d`'s delta, §3.6) — a new bundle hash for every arcade game. Others: 0 | Rejected — violates the constraint for arcade games, and every later 3D change to the switch's code re-hashes them again |
| **B. A new runtime id `arcade3d`** built with a 3D seam; 3D code only reachable through it | **0 in all four** (the seam module is never in their graph) | **Recommended** |
| **C. A separate app / runtime entry** (`apps/arena3d`) | 0 | Rejected — forks the boot, the Flow interpreter, the HUD, the RGS facade, the editor bake; every engine fix would have to land twice. The family seams exist precisely so we never do this |

### 3.4 The plan (option B), proven against how the runtime is built and released

1. **A family-level feature, not a new family.** A 3D game is `family: 'arcade'` with a 3D view
   switch on the config (name owned by the gameplay report, e.g. `arcade.view: '3d'`). The
   runtime list gets a fifth row:
   `{ id: 'arcade3d', family: 'arcade', families: 'arcade', view: '3d' }`, and
   `runtimeIdOfFamily(family)` becomes `runtimeIdOf(config)` (arcade + 3D view → `arcade3d`). That
   function runs in the launcher's publish, not in a game bundle — 0 runtime bytes. 3D is **not**
   added to `PUBLIC_IE_FAMILIES`: `__IE_FAMILIES__` is compiled into every bundle and checked at
   boot, and a 3D game is an arcade game, so `arcade3d` keeps `["slot","arcade"]`.
2. **The seam.** One build switch, `PUBLIC_IE_3D=1` (the workflow passes it from the row's
   `view`). When it is on, `config-vite` `familySeams()` resolves `families/arcade` to
   `families/arcade3d.ts` (a resolve rule in the plugin, like today's `off/` rule). That module
   re-exports everything from `./arcade` and overrides `ArcadeStage` with
   `ArcadeStage3D.svelte`, which renders the stock `<ArcadeStage>` (the loop, input, camera,
   online — untouched) and mounts the 3D view beside it via `await import('engine-3d')`.
   **No file the four runtimes compile changes.** `Game.svelte` keeps
   `import { ArcadeStage } from '../families/arcade'`.
3. **Two chunks in `arcade3d`.** Its bundle = the arcade bundle + the small stage component; the
   three.js renderer + glTF loader + engine-3d code is one lazy chunk fetched when the play field
   mounts. **Measured on a scratch build of exactly this seam** (§3.6): bundle 751,793 B gz vs
   arcade's 751,674 (**+119 B**), plus one new lazy chunk of **182,660 B gz** (three.js with
   `GLTFLoader`, `KTX2Loader`, `MeshoptDecoder`, `SkeletonUtils`, toon material, shadows) —
   fetched in parallel with the character `.glb`s, behind the loading screen. The Basis
   transcoder (263 KB gz) is fetched on the first `.ktx2` only, like Pixi's `libktx` today; a
   game that uses KTX2 in both its HUD and its world fetches both transcoders (~630 KB gz), so
   decoding three's KTX2 through our `libktx` is a later saving worth a look. Budget: `arcade3d`'s
   first visit = `arcade`'s + 119 B; its "3D boot" (like arcade's "online boot") adds the three
   chunk and is what its budget holds.
4. **Release.** `runtime-release.yml` reads its matrix from `RUNTIME_IDS`, and
   `check:runtime-choice` already fails if the workflow's choices drift from that list — so the
   fifth runtime is one row in `runtimes.ts`, one `options:` entry, one `PUBLIC_IE_3D` env line in
   the build step, one `RUNTIMES` row in `check-family-runtime.mjs` with 3D markers (e.g.
   `'KHR_materials_'`, `'MeshToonMaterial'`) — present in `arcade3d`, absent from the other four. The test server
   serves `_runtime/arcade3d/` like the others; nothing in `publish-runtime-bundle.mjs` is
   family-specific.
5. **Dependency rule.** `three` is declared by `packages/engine-3d` only, never by `apps/lines`
   (`check:game-app-deps`, "a new third-party package goes in a workspace package").
6. **Desktop / delivery builds.** `buildFamilies()` infers families from the baked config when
   `PUBLIC_IE_FAMILIES` is unset: the same inference must turn `PUBLIC_IE_3D` on when the baked
   config has the 3D view, and `scripts/delivery-family-gate.mjs` already refuses every arcade
   game for delivery, so a 3D game cannot reach a partner by accident.

What still changes in shared code: `families.js`, `config-vite`'s stamp, `runtimes.ts`,
`check-family-runtime.mjs` and the release workflow are **build-time / CI / launcher** code; none of
them is compiled into a game bundle (proven in §3.6).

### 3.5 Keeping the bytes: a reproducible build, a byte gate, and skip-unchanged releases

Code isolation (§3.4) keeps 3D *code* out of the four runtimes. §3.1's findings 2–3 show that is not
enough for "same bytes": the build stamp changes them on every commit and on any lockfile change. Three
pieces close it.

**a. `IE_REPRODUCIBLE=1` (config-vite, build-time).** Pins everything volatile that is compiled in:
`kit.version.name` (config-svelte), and in `__IE_BUILD__` `builtAt`, `sha`, `engineSha`, `gameSha`
and `lockfileSha256`. Unset = today's build, unchanged. Proven on scratch: with these pinned, two
builds of one commit are identical (`diff -r` over the whole `build/`).

**b. `check:runtime-bytes` (new, `scripts/check-runtime-bytes.mjs`).** Builds each of the four
existing runtimes with the release env + `IE_REPRODUCIBLE=1` (no Sentry DSN, no source maps: debug
IDs are per build), writes a manifest per runtime (every file under `_app/immutable/` → sha256 +
gzip -6 size, plus `index.html`), and compares it with a committed
`scripts/runtime-bytes/<id>.json`. Any difference fails, naming the file and the delta.

- A PR that *means* to change the 2D path (any ordinary engine PR) re-records with `--update`, and
  the manifest diff is in review — the ratchet model of `svelte-check-baseline.json`.
- A **required** PR check on `packages/engine-3d/**`, `apps/lines/src/families/**`,
  `apps/lines/src/components/ArcadeStage3D.svelte`, `packages/config-vite/**`,
  `packages/config-svelte/**` and `pnpm-lock.yaml`: those paths cannot legitimately touch 2D bytes,
  so a failure there is always a 3D leak. ~6 min (4 builds ≈ 1.5 min each, measured locally).
- `check:family-runtimes` stays as it is (markers + budgets); this gate is the strict one.

**c. Skip-unchanged releases (`runtime-release.yml` publish job).** Before uploading, each id is
also built with `IE_REPRODUCIBLE=1` and its manifest hash compared with the one the live release
recorded (`releases.json` gains `reproducible: <sha256>`). Equal ⇒ the job ends green as
"unchanged" and the pointer is not moved, so players keep the bundle they have cached. This is what
makes a `packages/engine-3d/**`-only merge — or adding `three` to the lockfile — cost the 2D games
**nothing**, not even a re-download. (Side benefit today: docs- or launcher-adjacent merges under
`packages/**` stop forcing every player to re-fetch ~720 KB.) Cost: one extra build per id per
release, ~1.5 min, in parallel jobs.

**Baseline** = the four manifests built with (a) from the commit the spike branches from. Their
totals today (gzip -6, ca9810945, pinned, no DSN):

| Runtime | `bundle.*.js` | CSS | lazy JS (all) | first visit (release env, §3.1) |
|---|---|---|---|---|
| `lines` | 720,135 | 3,075 | 17,411 | 728,124 |
| `arcade` | 751,674 | — | 97,441 (incl. 57.2 KB online) | 759,607 / online 816,805 |
| `match3`, `card` | (recorded by the spike) | | | 736,229 / 740,765 |

### 3.6 What was proven on a scratch build (not committed)

On an export of ca9810945 in a scratch folder: the §3.4 seam (`families.js` resolve rule,
`families/arcade3d.ts`, `ArcadeStage3D.svelte` with `await import('engine-3d')`, a
`packages/engine-3d` declaring `three@0.181.0`), with the stamps pinned:

| Build | Result |
|---|---|
| `lines`, seam present vs seam removed | **identical** (`diff -r` over `build/`) |
| `arcade`, seam present (switch off) vs seam removed | **identical** (sha256 of every file) |
| `arcade` with `PUBLIC_IE_3D=1` (= `arcade3d`) vs `arcade` | bundle **+119 B** gz; one new lazy chunk **182,660 B** gz; nothing else changed in size |
| `lines` before vs after `three` entered the lockfile | **different** (`lockfileSha256` in `__IE_BUILD__`) — hence §3.5 a + c |

---

## 4. Where the code lives

| Piece | Where | Notes |
|---|---|---|
| Renderer, scene, character rigs, camera rig, picking, glTF/KTX2 loading | **new `packages/engine-3d`** (declares `three`) | entry points: `engine-3d` (`mountWorld3d(canvasHost, opts) → { sync(bodies, view), resize(), destroy() }`) and `engine-3d/pure` (Svelte-free math: ground-plane mapping, ray → world point) for Node gates and the editor |
| The 3D seam | `apps/lines/src/families/arcade3d.ts` + `components/ArcadeStage3D.svelte` | only `arcade3d` compiles them |
| Seam resolution (`PUBLIC_IE_3D`) + `IE_REPRODUCIBLE` stamp pins | `packages/config-vite/families.js`, `index.js`, `provenance.js`; `config-svelte` (kit version) | build-time only |
| Runtime row + publish choice | `packages/constants-shared/runtimes.ts`, launcher publish | not in a game bundle |
| Gates + release | `scripts/check-family-runtime.mjs` (+ 3D markers), new `scripts/check-runtime-bytes.mjs` + `scripts/runtime-bytes/*.json`, skip-unchanged in `runtime-release.yml` / `publish-runtime-bundle.mjs` | CI only |
| Config switch + 3D settings | `packages/game-config` (gameplay report) | **watch:** `game-config` is in every bundle; new optional fields change its bytes for everyone. Keep the 3D schema in `engine-3d` and let `game-config` carry it as an opaque optional block, or add it in the same PR as the byte-manifest re-record and say so |
| Editor / launcher tools for 3D | `apps/launcher-api` | not in any game bundle |

Nothing in `pixi-svelte`, `engine-layout`, `engine-mechanics`, `engine-flow-v2` or `Game.svelte`
has to change for the first 3D game. `engine-layout`'s `LayoutScene` draws the HUD screens as
today; the play-field screen simply has no 2D world art.

---

## 5. Quality tiers at runtime

> Added 2026-11-17 for the owner's requirement: a 3D game ships as a **web** game and as a
> higher-resolution **desktop** game, with control over LODs, texture sizes and maps. The export side
> (one master, derived tiers, what each tier carries) is the assets report's §5
> (`docs/design/3d/assets-evaluation.md`); this section covers what the runtime does with them.
> Tier ids are the assets report's: **`full`** (desktop native), **`half`** (web desktop),
> **`quarter`** (web mobile), plus **`ultra`** (latest-gen desktop GPUs, and the asset set a console
> port would start from; owner request, 2026-11-17, sent to the assets session to add on the export
> side as `@ultra` copies of the master, with `full` staying the unsuffixed file).

### 5.1 How a build or a boot picks its tier

A tier is two things that change at different speeds:
- **the asset tier** (which `.glb` / `.ktx2` files load), decided **once at boot**, because
  changing it means downloading another set (tens of MB);
- **the render caps** (DPR, shadows, post-processing, LOD bias), which start at the tier's values
  and **adapt live** (§5.3).

Order of precedence, the same as 2D's `chooseArtTier` today:

| # | Source | Where it comes from | Notes |
|---|---|---|---|
| 1 | **Build pin** | `IE_ART_TIER=ultra\|full\|half\|quarter`, compiled in as `__IE_ART_TIER__` (`config-vite` `artTierPin.js`); set by the desktop launcher's **Build for** picker for ☁ Publish, and by `build-delivery.mjs --art-tier` | Wins over everything: a pinned build's pull left the other tiers out, so nothing else can load. Already built for 2D; `PINNABLE_TIERS` gains `quarter` and `ultra` (build-time code) |
| 2 | **Debug override** | `?tier=` (exists for 2D), plus `?render3d=low\|medium\|high` for the render caps alone | Ignored by a pinned build, as `?tier=` is today |
| 3 | **Player setting** | **Graphics: Auto / Low / Medium / High / Ultra** (= auto / `quarter` / `half` / `full` / `ultra`) in the game's settings, kept in `localStorage` | An asset-tier change applies on the next load (say so in the UI); a caps-only change applies at once. `High` is offered only when the device class is `desktop` and the served build has `full` files; `Ultra` only when it also has `ultra` files and passes the ultra gate below |
| 4 | **Auto** | Device capability at boot, below | |

**Auto, on the web (the unpinned `arcade3d` runtime, which serves every published tier):**

1. **Device class** (`pixi-svelte` `classifyDevice`, already used for 2D): `phone` ⇒ `quarter`;
   `desktop` ⇒ `half`. Auto never picks `full` on the web: its first load is not capped (assets
   report: ≤ 500 MB, a packaged size), so `full` is a choice the player makes or a build pins.
2. **Compressed-texture support** (read once from the WebGL2 context: ASTC, BC7/S3TC, ETC2): with
   none, Basis transcodes to RGBA32 at **4× the VRAM**, so the tier drops one step.
3. **GPU limits** (`MAX_TEXTURE_SIZE` < 2048 ⇒ `quarter`) and a software-renderer check
   (`WEBGL_debug_renderer_info` naming SwiftShader / llvmpipe / Microsoft Basic Render ⇒ `quarter`).
   The GPU name is a **blocklist only**, never an allowlist: GPU-tier databases go stale and a
   phone's name says little about its thermals.
4. **Not memory.** `renderTier.ts` already records why: browsers hide or alter
   `navigator.deviceMemory` (Brave reported a 16 GB Pixel 9 Pro as `reduced`), so it may not decide
   what a player sees. Frame time decides instead (§5.3).
5. **Screen pixels** cap downward only: a `half` desktop at 1080p stays `half`; a 1440p+ window does
   not raise auto to `full` (rule 1).
6. **Ultra gate** (for the setting; auto never picks `ultra`): device class `desktop`, BC7 or ASTC
   support, `MAX_TEXTURE_SIZE` ≥ 8192, not on the software-renderer blocklist, and a 10-second
   frame-time probe at `full` caps with headroom. Failing it hides the option rather than letting a
   laptop iGPU load ~3 GB of textures.

The 3D chooser lives in **`engine-3d`**, not in `apps/lines/src/game/artTier.ts`, so the four 2D
runtimes do not change (§3). It reads the same pin and `?tier=`; the 3D game's 2D art (HUD, FX
sheets) keeps `chooseArtTier`'s screen-coverage rule, so on the web the HUD and the models may sit
on different tiers. A pin moves both together.

> ⚠ **For the assets report: do not add `quarter` to `engine-layout` `RESOLUTION_TIERS`.** That object
> is compiled into every runtime, and `chooseArtTier` picks the smallest *covering* tier without
> checking which tiers the project published (`artTier.ts`: the tiers come from
> `RESOLUTION_TIERS`, not from `LayoutDoc.resolutionTiers`). A 2D 4K game that publishes only `half`,
> in any window where its art shows at ≤ 0.25 — a 900×500 desktop window at DPR 1 (0.23), or a
> portrait phone on a layout with no portrait box (390 CSS px ÷ 3840 × DPR 2 = 0.20) — would choose
> `quarter`, find no copy, and **fall back to the full 4K files**: 4× the pixels of the `half` copies it
> loads today, and on that phone exactly what `arcade-4k-builds.md` forbids ("Phones must never load the
> `full` tier"). Keep the 3D tier list in
> `constants-shared/modelTiers.ts` (read by `engine-3d`, the export and the pull); the pull and
> `PINNABLE_TIERS` take the union. If 2D ever wants `quarter`, `chooseArtTier` must first learn to
> choose among the *published* tiers — a 2D change, its own PR, re-recorded byte manifests and a
> current-games pass.

### 5.2 LODs and textures at runtime

**LOD switching: screen size, not distance.** `THREE.LOD` switches by camera distance
(`addLevel(object, distance, hysteresis)`). The assets report stores thresholds as **screen size**
(projected bounding-sphere height ÷ viewport height) per master level, with ~10 % hysteresis,
because a distance means different things at different FOVs. The runtime keeps `THREE.LOD` (its
`update()`, `autoUpdate` and hysteresis are what we want) and **converts** each level's screen size
to a distance: `d = r / (s · tan(fov / 2))` for a sphere of radius `r`. It recomputes the distances
only when the FOV changes (a camera shot, a zoom), never per frame; the viewport's pixel size does
not enter, so a resize or a DPR change needs nothing. Details:
- The model's `_LOD<n>` nodes become the `LOD` levels. A tier that ships levels *k…n* shows level
  *k* at every size above *k*'s threshold. `cullBelow` sets `visible = false`.
- Every level binds **one skeleton** (assets report): the animation mixer runs once per character;
  only the visible level's mesh is skinned on the GPU.
- **LOD bias** per tier and per live step (§5.3) multiplies every threshold (0.8 / 1.0 / 1.25 / 1.5
  for `ultra` / `full` / `half` / `quarter`; below 1 keeps the top level on screen longer), so a struggling device switches down earlier without new files.
- Shadow casters use the same level as the visible mesh (no separate shadow LOD to start).

**Textures.** The tier's files are already sized and encoded at export (assets §5.2: base colour
2048 / 1024 / 512; normal and ORM dropped on `quarter`, AO baked into base colour; toon ramp a
lossless PNG at every tier). The runtime adds only:
- a clamp to `renderer.capabilities.maxTextureSize` (skip mips on load, never resample);
- **anisotropy** per tier: 16 / 8 / 4 / 1 (`ultra` … `quarter`);
- **material fallback** when a map is `'dropped'`: roughness / metal from the material constants
  the export wrote; no normal-map shader variant compiled (fewer shader programs on phones);
- one KTX2 transcoder per page (three's Basis, not Pixi's libktx), started in a worker at boot so
  the first texture does not stall.

### 5.3 Render caps per tier, and dynamic resolution

| Cap | `ultra` (latest-gen desktop) | `full` (desktop native) | `half` (web desktop) | `quarter` (web mobile) |
|---|---|---|---|---|
| 3D canvas DPR cap | device DPR, render up to native 4K (dynamic resolution holds it) | device DPR (4K at DPR 1 = native) | 1.5 | 1.0 (1.25 on headroom) |
| Antialiasing | MSAA 4× + SMAA | MSAA 4× on the 3D canvas, or SMAA under post | MSAA 4× | off |
| Shadows | 4096², cascaded (three's `CSM` addon, lazy), heroes + props + tiles cast | 2048² PCF soft, heroes + props cast | 1024² PCF, heroes cast | **blob shadows** (a decal under each character), no shadow map |
| Post-processing | `full`'s + ambient occlusion (`GTAOPass`) and depth of field for camera shots | outline + bloom + SMAA (`EffectComposer`) — a **separate lazy chunk, 45.7 KB gz** measured, loaded only when the tier enables it | none (toon outline by inverted hull, in the material) | none; inverted-hull outline on heroes only |
| LOD bias | 0.8 | 1.0 | 1.25 | 1.5 |
| Fog / draw distance | full level | full level | ×0.85 | ×0.7 |
| Scene budget | ≤ 3M tris, ≤ 500 draws, ≤ 3 GB textures (proposed to the assets session) | ≤ 1M tris, ≤ 300 draws, ≤ 1 GB textures | ≤ 300k, ≤ 150, ≤ 256 MB | ≤ 150k, ≤ 80, ≤ 64 MB |

**WebGPU is a candidate for `ultra` only.** Pixi is forced to WebGL (§1.3) because mobile WebGPU
paints nothing; `ultra` is desktop-only by its gate. `three/webgpu` costs +12 KB gz over the WebGL
core (§1.2) and moves the toon material to TSL, so it earns a measured A/B on a reference scene
(frame time, draw-call ceiling) before it is adopted, behind `?gpu=webgpu`. The ultra post passes and
`CSM` load as lazy chunks, like `full`'s post chunk.

**Dynamic resolution.** The two canvases (§2.1) pay off here: the **3D canvas's DPR drops first and
the Pixi HUD stays sharp**. A controller in `engine-3d` measures frame time the way
`pixi-svelte` `renderQuality.ts` already does for 2D (a window of frames, a `slow` / `headroom`
decision with hysteresis, a trial that is undone when it brings `no gain`), and walks one ladder:

1. 3D DPR × 0.85, × 0.7 (floor: 0.5 of the tier's cap; the canvas is CSS-scaled up);
2. post-processing off, AO first (`ultra`, `full`);
3. shadow map halved, then blob shadows;
4. LOD bias + 0.25 per step (two steps max).

It steps back up on sustained headroom, one rung at a time. It never changes the asset tier (§5.1).
Reported on `__IE_DEBUG__` and the PerfHud like the 2D controller, and pinned by `?render3d=`.
`engine-3d` may import the 2D controller's pure functions (`qualityLadder` …) from `pixi-svelte`:
that import lives only in `arcade3d`'s graph, so the four 2D runtimes stay byte-identical.

### 5.4 The desktop high-res game: the same web runtime, packaged

**Today a "desktop build" is not native.** The desktop launcher's ☁ Publish / 📦 Deliver compile the
engine submodule's `apps/lines` into the game's **own** web bundle (`games-deploy.md`); it runs in a
browser. A 3D desktop game is the same: `apps/lines` built with `PUBLIC_IE_3D=1` (inferred from the
baked config, §3.4 point 6) and `IE_ART_TIER=full`, so the pull ships only the `full` files and the
3D chooser is pinned.

**Nothing native is needed to render it.** WebGL2 on a desktop GPU draws `full` at 4K;
`powerPreference: 'high-performance'` already asks for the discrete GPU. What a browser cannot give
is **delivery** of a `full` tier, whose first load the assets report allows up to ~500 MB. Two ways,
an owner decision:

| | Pinned web build in the browser | Packaged app (Electron) |
|---|---|---|
| Code | none new | a thin shell around the **same** build: window, fullscreen, file:// or local server, auto-update |
| First load | the whole `full` set over HTTP, cached by the browser (evictable) | installed once, on disk |
| Rendering | the player's browser | **Chromium we pin** — the same WebGL2 we test, on every OS |
| Store / offline | no | yes (Steam, itch, offline) |

**Recommendation:** ship the pinned web build first (zero new code; it proves `full`), and wrap it
in **Electron** when a store or an offline install is wanted. Electron rather than Tauri: Tauri
renders with the OS web view (WebView2 on Windows, WKWebView on macOS), so its WebGL is a second and
third target to test. The wrapper is packaging around an unchanged build — no engine code — and
needs its own small design (signing, updates).

### 5.5 Consoles: what `ultra` does and does not buy

`ultra` gives a console port **its assets and its quality bar**: master-resolution textures, the
top LOD, console-grade shadows and post. It does **not** give a console **runtime**. Our engine is a
web page (SvelteKit + Pixi + three.js on WebGL), and:

- **PlayStation and Nintendo Switch** ship native titles built with their own SDKs; there is no
  supported path for a WebGL game on them. A release there means a native port: a renderer that
  reads the same glTF + KTX2 files and the same game data, plus the `engine-mechanics` simulation
  ported or run in an embedded JS engine. That is a project of its own, behind platform-holder
  developer access we do not have.
- **Xbox** has a browser and has historically accepted web-technology apps (UWP / WebView2), so
  the "same build, wrapped" route of §5.4 *may* exist there. Not verified: the certification rules
  for web-tech games must be checked with ID@Xbox before anyone counts on it.

What keeps a console port possible now, at no cost to the web path: keep every asset standard
(glTF 2.0, KTX2/Basis, toon parameters in material `extras`); keep the simulation free of browser
APIs (it already is: `engine-mechanics` is dependency-free ESM shared with the Node game server);
keep input the abstract packet `{moveX, moveY, buttons, aimX, aimY}` (it already is); and add
**gamepad input** to the 3D stage early (the browser Gamepad API), so the controls are designed for
a pad from the start. Which consoles, and native port or wrapper, is the owner's decision and needs
its own evaluation.

### 5.6 What tiers change in the size gate

- **The four 2D runtimes: nothing.** `check:runtime-bytes` (§3.5) keeps comparing them with their
  manifests. The traps it now has to catch, all of them shared code: `RESOLUTION_TIERS` (§5.1 ⚠), a
  graphics option added to the shared HUD settings component (the setting must come from the 3D
  seam: a control the `arcade3d` seam registers, or a Flow/HUD screen in the 3D game's layout), and
  `game-config` fields (§4).
- **`arcade3d` code: one budget, not per tier.** A tier is a set of files, not code: every tier
  runs the same bundle (+119 B) and 3D chunk (182.7 KB gz). The post-processing chunk (45.7 KB gz) is
  counted as a `full`/`ultra`-only lazy chunk, reported like the Sentry SDK; so are `ultra`'s AO,
  depth-of-field and `CSM` chunks.
- **Assets: per-tier budgets** (new, `check:3d-tier-payload`). Built from a **reference 3D project**
  (BattleOTtheYear as data, once it exists) with the pull run per pin; it reads `pull.json` and the
  model index (`tiers[t].bytes`, `vramBytes`) and holds the assets report's numbers: first-load 3D
  payload `quarter` ≤ 15 MB, `half` ≤ 40 MB, `full` ≤ 500 MB; on-screen VRAM 64 MB / 256 MB / 1 GB;
  `ultra` once the assets session sets it (proposed: packaged ≤ ~1.5 GB, VRAM ≤ 3 GB).
  It runs on export changes (`modelExport.ts`, `ktx2Encode.ts`, `modelTiers.ts`), not on engine PRs.
- **The 3D chooser** gets a Node fixture (`engine-3d/pure`), like `artTier.fixture.ts`: device
  signals → tier, pin beats `?tier=` beats setting beats auto, auto never returns `full` or `ultra`, and the
  ultra gate hides `Ultra` on a phone, an iGPU without BC7/ASTC, or a software renderer.

---

## 6. Sizing and build order

| # | Step | Size | Proves |
|---|---|---|---|
| 0 | **Spike — size isolation.** `check-runtime-bytes.mjs` + baseline manifests; `IE_REPRODUCIBLE` pins + `PUBLIC_IE_3D` + `arcade3d` seam + an `engine-3d` that draws one spinning toon cube under the Pixi HUD; `arcade3d` row in the release list (dispatch-only at first) | **S** (3–5 days; the size half is already shown on scratch, §3.6) | the four manifests are unchanged; `arcade3d` boots with the HUD on top; the 3D chunk is lazy |
| 0b | Skip-unchanged releases (§3.5 c) — before the first merge that adds `three` to the lockfile | S | an `engine-3d`-only merge leaves all four pointers where they were |
| 1 | Two-canvas integration: resize, DPR clamp, auto-opaque guard, pointer forwarding, `renderQuality` hook, pause on hidden tab | S | a HUD button and a world click both work on a phone |
| 2 | Bodies → objects: `sync(bodies, view)`, ground-plane mapping, camera rig from `camera.js`'s view, ray-cast input | M | an existing offline arcade level plays in 3D with cubes |
| 3 | Characters: glTF + KTX2 + meshopt load, `SkeletonUtils` instancing, clip state from body velocity / signals, cross-fades | M | with the animation + camera report |
| 4 | Online: room state → same `sync`; prediction and corrections unchanged | S | with the gameplay/online report |
| 5 | Flow 3D vocabulary (play clip, camera shot), editor preview, asset chain export → deploy → bake → pull → register (hard rule 8) | L | |
| 6 | BattleOTtheYear as data | L | owned by the coordinator's plan |
| T1 | **Tier chooser + caps** in `engine-3d`: pin / `?tier=` / setting / auto (device class, compressed formats, GPU limits), per-tier caps table, `IE_ART_TIER` + `PINNABLE_TIERS` gain `quarter`; the chooser fixture. Lands with step 2 | S | a phone boots `quarter`, a desktop `half`, a pinned build only its tier; four 2D manifests unchanged |
| T2 | **Screen-size LOD** (`THREE.LOD` with distances from screen size + FOV), dropped-map material fallback, anisotropy, transcoder worker. Lands with step 3 | S–M | LOD switches at the authored screen sizes at two FOVs |
| T3 | **Dynamic resolution** on the 3D canvas (DPR → post → shadows → LOD bias), PerfHud readout, `?render3d=`; blob shadows; post-processing as a `full`-only lazy chunk | M | a throttled phone holds frame time with the HUD still sharp |
| T4 | **Graphics setting** contributed by the 3D seam (not the shared HUD) | S | the 2D settings component is byte-identical |
| T5 | **Desktop `full`**: pinned web build (no new code), `check:3d-tier-payload` on the reference project | S | the full pull ≤ 500 MB, half ≤ 40 MB, quarter ≤ 15 MB |
| T6 | **Electron wrapper** for a store / offline desktop game — only on the owner's go (§5.4) | M | the same build in pinned Chromium, installed |
| T7 | **`ultra`**: the ultra gate, its caps column, `CSM` + AO + depth-of-field lazy chunks, LOD bias 0.8; the WebGPU A/B on the reference scene. Needs the assets session's `@ultra` export | M | a latest-gen desktop holds 60 fps at native 4K on the reference scene; the gate hides `Ultra` on an iGPU |
| T8 | **Gamepad input** in the 3D stage (Gamepad API → the existing input packet) | S | the arena is fully playable on a pad |
| — | **Consoles**: a separate evaluation (§5.5), not sized here | — | owner decision first |

Tier steps T1–T4 ride along with steps 2–3 rather than after them: the tier decides what a
character loads, so building characters without it would be redone. T5 needs the reference project;
T6 is a separate owner decision.

The spike is the gate for everything after it: if step 0 cannot show unchanged manifests, the
design changes before any 3D feature is built.
