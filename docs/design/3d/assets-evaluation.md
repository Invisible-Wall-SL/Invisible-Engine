# 3D assets — evaluation (creation → R2 → game)

Evaluation only, nothing built. One of four inputs to `docs/design/3d-games.md` (the others cover
the runtime and bundle-size isolation, animation and camera, and gameplay and online). Date: 2026-11-17.

## TL;DR

| Topic | Recommendation | Rejected |
|---|---|---|
| Authoring | Blender 5.2 (installed) + fixed conventions + two scripts (`ie_validate.py`, `ie_export.py`) that Claude runs through the Blender MCP | Authoring in Unity; free-form exports with no checks |
| Textures | **Toon-first**: base colour + a shared palette or ramp, with no PBR stack. AI help: Qwen-Image (Apache-2.0, already on our pods) for tileables and concepts, **StableGen** in Blender projecting from our RunPod ComfyUI, and **TRELLIS.2** (MIT, ComfyUI-native) only as a blockout source | **Hunyuan3D-2.x** (its licence does not cover the EU), FLUX-dev/PuLID (non-commercial), the nvdiffrast-based TRELLIS reference pipeline |
| Format | **GLB + `EXT_meshopt_compression` + `KHR_mesh_quantization` + KTX2 (`KHR_texture_basisu`)**: ETC1S for colour, UASTC for normals | Draco (≈300 KB decoder, compresses geometry only), FBX at runtime, OBJ, USDZ |
| Optimiser | Pure Node in the launcher: glTF-Transform + `meshoptimizer` (wasm) + our own `ktx2Encode.ts` | gltfpack binary on Railway; a Blender service for every export |
| FBX migration | A one-off headless-Blender script run locally (verified at 3–5 s per file) | A cloud Blender service; FBX2glTF (unmaintained) |
| R2 class | A new `models` exporter through the existing registry: upload → `deploy/models/` → bake → pull → register. An empty project adds 0 bytes | Loading models straight from their R2 source prefix (breaks hard rule 8) |
| Quality tiers | **One master upload, four tiers** using the 2D naming and pin conventions: `ultra` (opt-in, packaged only, master-resolution maps), `full` (desktop native, unsuffixed fallback), `half` (web desktop), `quarter` (web mobile). A tier = a window on the LOD chain and a mip level of the master textures, plus a per-map keep/drop/encoding profile. The tier list lives in `modelTiers.ts`, **not** in the 2D `RESOLUTION_TIERS` (§5) | Adding tiers to `RESOLUTION_TIERS` (that would change every 2D runtime's tier choice); hand-made per-tier assets |
| Unity third-party | Port nothing. Write our own toon shader and outline, and re-author the FX in our own tools | Shipping Cartoon FX Remaster textures or meshes without written publisher consent |

## What BattleOTtheYear actually has (measured 2026-11-17)

The "442 MB of models" is mostly unoptimised AI-generator output. **No character models exist.**

| Asset | Measured (Blender 5.2.2 headless import) | Verdict |
|---|---|---|
| 7 heroes (`Prefabs/Heroes/*.prefab`) | Every `m_Mesh` is Unity's **built-in Capsule** (`fileID 10208`); the skins are 4 PBR PNG sets per hero | **Model and rig from scratch**: the largest art cost of the project |
| `Tiles/Tile01.fbx`, `Tile03.fbx` | 131 MB each, **1,494,929 tris**, one mesh `node_0`, rotated +90° X (Z-up/Y-up mismatch), 4 × 4096² PBR maps | Decimated to 6k tris in 18 s → 328 KB GLB (87 KB with Draco, without textures). Then rebake and retexture |
| `Props/sword.fbx` | 50,000 tris, `node_0`, 1.2 m long, 4 × 4096² maps | Decimate to about 1k tris and retexture |
| `Props/monolith.fbx` (34 MB), `well_walls`, `Wall_Torch` | Same generator signature | Same treatment |
| `Textures/istockphoto-1133064827-1024x1024.jpg` and other stock JPGs | Stock imagery | **Do not ship** unless the licence is on file |
| Toony Colors Pro | Only a stale `ToonyColorsPro.Demo.Editor.csproj`; no TCP2 shader or material is left in `Assets/` | Nothing to port |
| Cartoon FX Remaster | `Assets/JMO Assets/` (38 MB): Shuriken particle prefabs, CFXR shaders, FBX meshes | See §6 |

The file naming (`node_0`, `texture_pbr_20250901*`) is the signature of an image-to-3D service. **The owner must confirm which generator made these files, and under which terms**, before any of them ship. If it was Hunyuan3D, its licence does not cover use in the EU (see §2).

## 1. Modelling in Blender

### Conventions (fix these before the first asset)

| Area | Rule |
|---|---|
| Units | Metric, 1 BU = 1 m, unit scale 1.0. Hero ≈ 1.8 m; a floor tile is a fixed grid size (proposed 2 m, set by the gameplay session) |
| Axes | Blender is Z-up; the glTF exporter's default "+Y Up" converts. **Characters face Blender −Y** (front view), which lands on glTF +Z. Apply all transforms (scale 1, rotation 0) before export. The validator fails on anything else, which would have caught Tile01's 90° |
| Origin | Characters and props: bottom centre (between the feet). Tiles: the grid corner or centre, fixed project-wide |
| Object names | `CH_<hero>`, `WP_<weapon>`, `PR_<prop>`, `TL_<tile>`, `FX_<mesh>`; LODs `…_LOD0/1/2`; collision `…_COL` (not exported, read into the gameplay data); sockets are Empties `SK_<name>` (`SK_hand_r`, `SK_muzzle`, `SK_head_top`) |
| Skeleton | **One shared humanoid skeleton for all 7 heroes**, so one animation library retargets to all of them (the animation session decides the library). Names follow the UE-mannequin style: `root, pelvis, spine_01-03, neck_01, head, clavicle_l/r, upperarm_l/r, lowerarm_l/r, hand_l/r, thigh_l/r, calf_l/r, foot_l/r, ball_l/r`, plus optional `weapon_r`. ≤ 64 deform bones, ≤ 4 influences per vertex, normalised weights, no scale keys on bones |
| Actions | `<rig>@<clip>` (for example `hero@run`), pushed to NLA, 30 fps, root motion on `root` only. glTF exports every action as an animation |
| Materials | One material per mesh where possible (≤ 2 for heroes). The toon parameters travel as **custom properties → glTF `extras`** (`toon.ramp`, `toon.outline`, `toon.rim`) and the runtime maps them onto its toon material. No Blender node trees are expected to survive: glTF only carries Principled BSDF inputs |
| UVs | UV0 only, non-overlapping where it gets baked, 4 px padding at 1024 |

### Budgets

What the artist authors is the **master**: the full LOD chain plus power-of-two textures at the
largest size any published tier needs (`ultra` where the project publishes it, otherwise `full`).
Every shipped tier is derived from it. The per-tier budgets are in **§5**.

| Class | Master LOD chain (tris) | Master texture (max, per map) | Notes |
|---|---|---|---|
| Hero (skinned) | optional LODU ≤ 60k · LOD0 20k · LOD1 10k · LOD2 5k · LOD3 2.5k | 4096² (2048² if the project skips `ultra`) | One material; LOD1–3 may be generated, LODU is always authored (§5.4) |
| Weapon | 3k · 1.5k · 0.5k | 1024² or palette | |
| Prop | optional LODU ≤ 15k · 6k · 3k · 1k · 0.3k | Shared 2048² trim or palette | |
| Tile | 2k · 0.5k | Shared tileable 1024² | Instanced; cheap at every tier |
| FX mesh | < 500 (one level) | Flipbook sheets go through the existing Flipbook class | Not tiered as a model |

Normal maps are optional under a toon look. Dropping them is the biggest single saving, and the
mobile tier always drops them.

### How Claude helps through the Blender MCP

**Tools available** (loaded and inspected): `execute_blender_code`; scene and object summaries (`get_objects_summary`, `get_object_detail_summary`); `.blend` audits (`get_blendfile_summary_datablocks` / `_missing_files` / `_linked_libraries` / `_usage_guess`); `get_screenshot_of_window_as_image` / `_of_area_as_image`; `render_thumbnail_to_path` / `render_viewport_to_path`; navigation (`jump_to_*`); and docs search (`search_api_docs`, `search_manual_docs`, `get_python_api_docs`). Each tool has a **`_for_cli` twin that opens a `.blend` in `blender --background`**, so the same scripts run headless.

**What I could and could not verify:**
- Blender was not running, so the interactive tools failed with "Cannot connect to Blender at localhost:9876". Live-scene work, screenshots and viewport renders are therefore **unverified**.
- The `_for_cli` tools failed with "Blender executable not found at 'blender'". **Fix: set `BLENDER_PATH=C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`** (4.3 is also installed).
- I ran that same `blender.exe -b` directly, and FBX import, decimate and GLB export (plain and Draco) all work in Blender 5.2.2 LTS. Results are in the table above.

**What Claude does with these tools (two scripts, committed under `tools/blender/`):**

| Script | Does | Run by |
|---|---|---|
| `ie_validate.py` | Fails or warns per the conventions: unapplied transforms, wrong axis or origin, names, tri and texture budgets, bone count, influences > 4, non-normalised weights, missing UVs, n-gons, loose geometry, texture sizes that are not powers of two or not ÷4 (KTX2 alignment, see the black-page gotcha), action names. Output is JSON | Claude over the MCP (live) or `_for_cli` (CI or locally) |
| `ie_export.py` | Applies transforms, generates LODs (Decimate collapse with a ratio per class), packs and bakes (Cycles high→low for AO and normal, when wanted), exports the GLB with `extras`. Only the launcher compresses (§3), so the GLB stays a clean source | Same |

Claude's interactive role: inspect a scene, run the validator, propose fixes, **ask before any destructive change** (the MCP's own rule), apply them, re-validate, screenshot the result, export, and upload. Rejected: Claude modelling heroes from scratch over the MCP. It is good at cleanup and scaffolding (blockouts, LOD, rig naming, weight checks), not at character art.

## 2. Textures

### Licence screen (commercial use from Spain is the hard filter)

| Tool | Licence | Use it? |
|---|---|---|
| **Qwen-Image / Qwen-Image-Edit** (already on our pods) | Apache-2.0 | ✅ tileables, concept and turnaround sheets, FX flipbook frames |
| **TRELLIS.2** (Microsoft) | MIT for code and weights. The reference pipeline needs **nvdiffrast** (NVIDIA licence, non-commercial); ComfyUI's native integration drops it | ✅ **only through ComfyUI-native nodes**, as an image→mesh *blockout* that is always retopologised or decimated in Blender |
| **StableGen** (Blender add-on that drives ComfyUI: multi-view depth/ControlNet projection onto your mesh) | GPL-3 add-on (outputs are not covered by the GPL); the output licence follows the checkpoint you choose | ✅ with Qwen-Image or SDXL (OpenRAIL++-M) checkpoints. ❌ with FLUX-dev |
| **Hunyuan3D-2 / 2.1 (shape + Paint)** | Tencent Hunyuan 3D Community Licence: **the territory excludes the EU, UK and South Korea**; HF gating disallows the EU; > 1M MAU needs a separate licence | ❌ **Rejected**: Invisible Wall SL is in Spain |
| FLUX.1-dev, PuLID | Non-commercial | ❌ (already rejected, `docs/status/comfyui.md`) |
| SF3D / SPAR3D (Stability) | Stability Community Licence (commercial only under $1M revenue) | ⚠️ Not needed while TRELLIS.2 covers this |
| ambientCG / Poly Haven materials | CC0 | ✅ source library for tileables and trims |
| DeepBump / "normal from height" | GPL add-on; or our own deterministic Sobel step | ✅ local, no model licence involved |

### Recommended stack

1. **Default (no AI): palette texturing.** Props, weapons and tiles UV-map onto swatches of one shared 256–512² palette and gradient-ramp texture per game. This is the cheapest, most consistent toon look, uses a single material, and lets many props be drawn together. Authored in Blender; the existing **Sheet Maker** can pack the palette and ramp strips.
2. **Tileables (RunPod):** an Atlas Maker blueprint, "Texture (tileable)" (Qwen-Image, seamless prompt + offset check), next to the existing blueprints. That keeps it inside the Atlas Maker → `deploy/` path we already trust. Masks and normals are derived deterministically (no second model).
3. **Hero skins (local Blender + RunPod ComfyUI):** the owner hand-paints, or uses StableGen projecting from a Qwen-Image turnaround sheet. StableGen runs in the owner's Blender and talks to an R&D pod URL from `/comfyui` (or the local tunnel). Then a Cycles bake to a single 1024² base colour, plus manual cleanup.
4. **Blockouts (RunPod):** TRELLIS.2 ComfyUI nodes added to the R&D image (`nodes.json`). Their output is reference geometry only, and goes through `ie_validate.py` before anything else.
5. **Compression:** the launcher's existing `ktx2Encode.ts` (see §3).

| Runs on RunPod (GPU) | Runs locally | Runs on the launcher (CPU) |
|---|---|---|
| Qwen-Image tileables and turnarounds (serverless via the Atlas Maker, or an R&D pod); TRELLIS.2 (R&D pod first; it reaches serverless only once node/model parity is met, comfyui open item 9) | Blender, StableGen, Cycles bakes, `ie_validate` / `ie_export`, the FBX migration | glTF optimisation, KTX2 encode, LODs if they are not authored |

Not used for 3D: the Atlas Maker's sprite-atlas packing (meshes carry their own UVs), apart from the blueprint host above.

## 3. Format and compression

**GLB, glTF 2.0** is the single interchange and runtime format.

| Choice | Why | Rejected |
|---|---|---|
| **Meshopt** (`EXT_meshopt_compression`) + `KHR_mesh_quantization` | ~20 KB JS/wasm decoder; decodes at near-memcpy speed; compresses **animation and morph-target data too** (skinned heroes are mostly animation bytes); stacks with HTTP brotli | **Draco**: the smallest raw geometry (measured 328 → 87 KB on the 6k-tri tile) but a ≈300 KB wasm decoder, slower decode, geometry only, and a second wasm in the 3D chunk |
| **KTX2** (`KHR_texture_basisu`): **ETC1S** for base colour, palette and ramp; **UASTC** for normal maps | We already encode KTX2 in Node (`ktx2Encode.ts`, the `ktx2-encoder` wasm) and know its traps (÷4 dimensions, memory peak, `KTX2_ENCODE` gate) | WebP/PNG in VRAM (the iOS memory ceiling); a separate toolchain such as `toktx` |
| Optimiser = **glTF-Transform** (MIT) + `meshoptimizer` npm (MIT, wasm) in `apps/launcher-api` | Pure Node, no native binary on Railway; dedup, prune, weld, resample animations, quantise, meshopt; texture slots swapped for our own KTX2 output | gltfpack CLI (a native binary per platform); compressing in Blender (Draco only) |

**Runtime note for the runtime session:** three.js's `KTX2Loader` uses the Basis `basis_transcoder.{js,wasm}`, not the `libktx` Pixi uses. It has to be **vendored into the 3D-only chunk** (same self-hosting rule as `pixi-svelte/src/lib/transcoders/ktx/`; no CDN), together with `meshopt_decoder`. Neither may land in the 2D bundle.

**FBX conversion (BattleOTtheYear and any future FBX):** a local, one-off script `tools/blender/fbx_to_glb.py`, run with `blender -b -P` or through the MCP `_for_cli` tool. Steps: import FBX → apply rotation/scale (fixes the 90°) → decimate to the class budget → rename to the conventions → rebake to 1024² → `ie_validate` → export GLB → upload through the models tool. It takes 3–5 s per file before decimation; decimating 1.5M tris adds about 18 s. Because only 6 FBX files exist and the heroes are capsules, **a cloud Blender service is not worth it** (a ≈400 MB image on Railway for a few files). Revisit only if FBX uploads from outside artists become routine.

## 4. The `models` R2 asset class (hard rule 8)

It follows "Adding an asset class — one registry entry" in `live-assets.md`.

```
source  <C>/<P>/models/<id>/source.glb        ← upload (presigned PUT; the launcher body cap is 512 KB)
        <C>/<P>/models/<id>/model.json        ← class, per-tier overrides, LOD thresholds, validator report
deploy  <C>/<P>/deploy/models/<id>.glb        ← the full tier: meshopt + quantised, texture URIs → _tex/
        <C>/<P>/deploy/models/<id>@half.glb   ← one GLB per published tier (§5.3)
        <C>/<P>/deploy/models/_tex/<hash>[@<tier>].ktx2 ← content-addressed, shared across models
index   ModelExportIndex { prefix: 'models', models: [{ id, clips[], sockets[], lodScreenSize[], tiers: {…} }] }
```

| Step | File(s) | Change |
|---|---|---|
| Upload and source | **new** `apps/launcher-api/src/routes/(app)/models/…` (the tool page plus a presign route), **new** `src/lib/server/modelStorage.ts` | Presigned upload to `models/<id>/source.glb`; the server runs a JS port of the validator rules (budgets, extensions) on the GLB with glTF-Transform |
| Export | **new** `apps/launcher-api/src/lib/server/modelExport.ts` | Through a `DeployMirror`: only models the game reaches (the 3D scene, characters and props docs, from `referencedModelIds`) → glTF-Transform pipeline (§3), once per published tier (§5.3) → `deploy/models/` → `commit` prunes the rest. Textures go through `ktx2Encode.ts`, padded to ÷4 |
| Registry | `apps/launcher-api/src/lib/server/exporters.ts` | `{ id: 'models', label: 'models', run: exportModels, emptyResult: { prefix: 'models', models: [] } }` |
| Online bundle | `apps/launcher-api/src/lib/server/runtimeBundle.ts` | `RuntimeBundle.models?`, set only when non-empty |
| Bake | `apps/launcher-api/scripts/lib/bakeExports.mjs` (`{ asset: 'models', label: 'model export', policy: 'additive' }`) + a reader in `scripts/bake-editor-doc.mjs` | Embeds nothing for an empty answer |
| Pull | `scripts/pull-project-assets.mjs`, `scripts/lib/assetReachability.mjs` | **No change**: `models/` is an export-generated subtree and is already mirrored |
| Shared type | **new** `packages/constants-shared/src/models.ts` | `ModelExportIndex` (types only, so no runtime bytes) |
| Register | `apps/lines/src/editor-scenes.ts` | Stores the index on the bundle only. The **3D view mode dynamically imports** three.js and its loaders the first time an arcade game with `view: '3d'` resolves a model, so 2D games never fetch them |
| Gates | `check:exporter-registry` (passes once the two lists agree) + **new** `check:model-export` | (a) an empty project gives a byte-identical bundle; (b) a fixture GLB comes out meshopt + KTX2, under budget, with ÷4 textures; (c) no `three` import is reachable from the 2D entry (or the bundle-size check the runtime session proposes) |
| Tool registry (rule 9) | `src/lib/roles.ts` (`TOOLS`, `ROLE_TOOLS`, `TOOL_BAR_ORDER`, `TOOL_DOC_SLUG`), `docs/tools/models.md`, `docs/tools/README.md` | **Invisible Model Viewer** (`/models`): upload, validator report, a three.js preview (clips, sockets, LOD toggle), and before/after bytes |

Parity: a 2D project never authors a model, so `emptyResult` → no bundle section → byte-identical builds. That is the same proof every other additive class uses.

## 5. Quality tiers (web and desktop from one master)

**Owner requirement:** a 3D game ships both as a web game and as a higher-resolution desktop game, with explicit control over LODs and texture sizes and maps per target. Picking the tier at boot and packaging the desktop build belong to the runtime session. This section covers authoring, export and the asset chain.

### 5.1 The tiers: the 2D conventions, with a 3D-only tier list

From `arcade-4k-builds.md` we reuse the **conventions**, not its tier list:
- one master, with the other tiers derived from it at publish (`PageStore.ensureTier`);
- tier files named by inserting `@<tier>`, with `full` unsuffixed;
- a missing tier copy falls back to the full file;
- `IE_ART_TIER` pins a build, and the pull leaves the other tiers out.

**The 3D tier list does NOT go into engine-layout's `RESOLUTION_TIERS`** (revised 2026-11-17 with the runtime session).
- That object is compiled into every 2D runtime, and `chooseArtTier` picks the smallest tier on it that still covers the screen. It never checks which tiers the project actually published.
- So adding `quarter` there would make a 4K 2D game that publishes only `half` pick `quarter` in a small window (a 900×500 window at DPR 1, or a portrait phone with no portrait box: scale 0.20–0.23), find no copy, and fall back to the **full 4K art**. That is 4× today's bytes, and on a phone it breaks "phones must never load the full tier".
- It would also change every 2D runtime's bytes.

So the 3D list lives in **new `packages/constants-shared/src/modelTiers.ts`** (`MODEL_TIERS`), which engine-3d, `modelExport.ts` and the pull read. If 2D ever wants `quarter`, `chooseArtTier` must first learn to choose among the published tiers: that is its own 2D PR with a current-games pass.

| Tier id | Target | Textures vs master | Geometry | How it is chosen (runtime session) |
|---|---|---|---|---|
| `ultra` (`@ultra`) | Latest-gen desktop GPUs, possibly consoles | **The master's own resolution** (hero maps up to 4096) | The master's top level (an optional authored `_LODU`, 5.2) | Pin only (`IE_ART_TIER=ultra`) or the player's "Ultra" setting on a desktop that passes capability checks. **Packaged only, never picked automatically on the web** |
| `full` (no suffix) | **Desktop native** (packaged) and the fallback for everything | One mip below the master where the master exceeds full's caps (5.2), otherwise the master | LOD0–2 | Default desktop pin; what every missing copy falls back to |
| `half` (`@half`) | **Web desktop** | Two mips below a 4096 master (full ÷ 2) | Drops the top level | Runtime choice |
| `quarter` (`@quarter`) | **Web mobile** | full ÷ 4 | Drops two levels, plus the normal and ORM maps | Runtime choice |

- `full` stays the unsuffixed file, so the 2D convention and every fallback are unchanged.
- Each project opts into its tiers through the existing `LayoutDoc.resolutionTiers`, as 2D does. For a 3D project that list may name `ultra` and `quarter` too. The doc readers need to accept those ids for 3D projects; `check:doc-readers-unknown-fields` currently drops an unknown tier id.
- **`ultra` reverses my earlier "no 4K asset tier" call, for this one tier.** For `full`, the reasoning stands: in an arena camera a hero covers about 400–550 px of a 2160 px screen, so 2048² is enough. `ultra` is for players who want the master's detail on hardware that can hold it. With it, the earlier `closeup` exception is dropped: character-select close-ups use `ultra`.
- **`?quality=high` does not apply to models.** In 2D it swaps KTX2 for the WebP originals; for 3D those would be 16–18 MB PNG masters. The tier carries the encoding (5.2).

### 5.2 Per tier and per class

A tier is **a window on the master LOD chain and a mip level of the master textures**, plus a per-map profile. Nothing is hand-made twice.

**Geometry (LOD levels shipped; tris of the tier's top level):**

An optional **`_LODU`** mesh in the master is the ultra-only top level (hero ≤ 60k, prop ≤ 15k). It is authored, never generated, since simplifying cannot add detail. Without one, `ultra` ships full's geometry and differs only in its textures.

| Class | `ultra` | `full` (desktop) | `half` (web desktop) | `quarter` (web mobile) |
|---|---|---|---|---|
| Hero | LODU, LOD0–2 (≤ 60k; else 20k) | LOD0–2 (20k) | LOD1–3 (10k) | LOD2–3 (5k) |
| Weapon | LOD0–1 (3k) | LOD0–1 (3k) | LOD1–2 (1.5k) | LOD2 (0.5k) |
| Prop | LODU, LOD0–2 (≤ 15k; else 6k) | LOD0–2 (6k) | LOD1–3 (3k) | LOD2–3 (1k) |
| Tile | LOD0–1 (2k) | LOD0–1 (2k) | LOD0–1 (2k) | LOD1 (0.5k) |
| FX mesh | 1 level | 1 level | 1 level | 1 level |
| **Scene on screen** | ≤ 3M tris, ≤ 500 draws, ≤ 3 GB GPU textures | ≤ 1M tris, ≤ 300 draws, ≤ 1 GB | ≤ 300k tris, ≤ 150 draws, ≤ 256 MB | **≤ 150k tris, ≤ 80 draws, ≤ 64 MB** (iOS ceiling) |
| **3D payload** | Packaged; ultra copies only | Packaged (keep it ≤ 500 MB) | First load ≤ 40 MB | First load ≤ 15 MB |

**Textures (max size per map type, for a hero master at 4096²; a prop or weapon master at 2048² gives the ultra and full columns the same size, so no `@ultra` copy is written; smaller masters scale down the same way):**

| Map | `ultra` | `full` | `half` | `quarter` | Encoding (ultra / full / half / quarter) | Colour space |
|---|---|---|---|---|---|---|
| Base colour | 4096 | 2048 | 1024 | 512 (hero 1024 via override) | UASTC / UASTC / ETC1S / ETC1S | sRGB |
| Normal | 4096 | 2048 | 1024 | **dropped** | UASTC (normal-map mode) on all three | linear |
| ORM (AO·rough·metal) | 4096 | 2048 | 1024 | **dropped**: AO is multiplied into base colour at export; roughness and metal become material constants | UASTC / UASTC / ETC1S / — | linear |
| Emissive | 2048 | 1024 | 512 | 256 | UASTC / UASTC / ETC1S / ETC1S | sRGB |
| Toon ramp / palette | 256×N, every tier unchanged | same | same | same | **PNG, lossless**: never block-compressed, no mipmaps, nearest filter (compression smears the ramp's hard steps) | sRGB |

A tier whose derived map would be identical to `full`'s (because the master is no larger) writes **no copy**, so `ultra` adds bytes only where the master really is bigger.

Rules:
- Every tier texture **carries mipmaps.** 3D minification shimmers without them, while 2D pages ship none. `encodePageToKtx2` already has the `mipmaps` option (off for 2D).
- `ktx2Encode.ts` is UASTC-only today. It needs an **ETC1S mode** and a **linear (non-sRGB) / normal-map mode**; those are the only encoder changes.
- Uncompressed PNG/WebP on desktop is **rejected as a default**: it costs 4× the VRAM, decode stalls the first frame, and it gives no quality win over UASTC (which transcodes to BC7 on desktop GPUs). A per-model override allows `png` on `full` only, for a decal that must stay pixel-exact.

### 5.3 Where the controls live, and how one upload becomes one asset set per tier

| Level | Where | Holds |
|---|---|---|
| Code defaults | **new** `packages/constants-shared/src/modelTiers.ts` | The two tables above, per class (`hero / weapon / prop / tile / fx`) |
| Tier ids | **new** `MODEL_TIERS` in `modelTiers.ts` (`ultra`, `full`, `half`, `quarter`). **Not** engine-layout `RESOLUTION_TIERS` (5.1) | What can exist for models |
| Per-project tier list | The **existing** `LayoutDoc.resolutionTiers` (Scene Editor, Canvas Size panel), accepting the 3D ids on a 3D project | Which tiers publish. One list for 2D art and models, so they cannot disagree |
| Per-project class profiles | **Game Config**, a new `models` block (`profiles[class][tier] = { lods: [from, to], maps: { baseColor, normal, orm, emissive: size \| 'drop' }, encoding: { map: 'uastc' \| 'etc1s' \| 'png' } }`, plus `lodScreenSize[class]`) | Overrides the code defaults for the whole game |
| Per model | `models/<id>/model.json` → `{ class, overrides: { [tier]: {…same shape…} }, lodScreenSize?, lodSource: 'authored' \| 'generated' }`, edited in the **Invisible Model Viewer** (a tier switcher shows tris, bytes and VRAM per tier, with side-by-side previews) | The final say |

Precedence: **model.json → Game Config → code default.** The validator also checks the master against its class: textures must be at least the `full` size and power-of-two (the ultra size where the project publishes `ultra`), and the LOD chain must be complete or set to `generated`.

**Chain (one master in, one set per tier out):**
1. **Export** (`modelExport.ts`): for each reached model and each published tier, resolve the profile, then:
   - take the tier's LOD window (generating missing levels, 5.4);
   - resize each kept map from the master with sharp; on `quarter`, drop the normal and ORM maps and multiply AO into base colour;
   - encode with the tier's encoding and mipmaps, then meshopt the geometry;
   - write `deploy/models/<id>@<tier>.glb` (the full tier unsuffixed), with textures at `_tex/<hash>@<tier>.ktx2`. A tier whose GLB would match `full` byte-for-byte (for example `ultra` over a 2048² master with no `_LODU`) is not written, and the index omits it.
   
   Encoding is the expensive step, so it is cached per derived texture by a sidecar keyed on the master hash, tier, encoder revision and profile (the same pattern as `TierMeta` in `pageStore.ts`). A profile change re-derives only what it touches. A model with no copy for a tier (an FX mesh) ships only its full file and falls back to it, as 2D pages do.
2. **Deploy:** written through the `DeployMirror`; `commit` prunes tiers that are no longer published.
3. **Bake:** embeds the whole index, every tier included (as 2D does: the index is not a pulled file).
4. **Pull:** the name rule (`@<tier>` inserted into the full file's name) carries over, with **three small changes** in `apps/launcher-api/scripts/lib/artTierPin.mjs` and `packages/config-vite/artTierPin.js`:
   - **Tier list.** `PINNABLE_TIERS` becomes the union of the 2D tiers and `MODEL_TIERS` (`full, half, quarter, ultra`). Its `TIER_MARK` regex derives from that list, so it recognises the new suffixes. `check-art-tier-pin.mjs` checks the list against both sources.
   - **More than two tiers.** `artTierDrop` was written for exactly two. Today a pin to X only drops full files that have an X copy, which would leave `@quarter`/`@ultra` files in a `half` build. New rule: a pin to X drops **every copy of a tier other than X**, plus each full file that has an X copy. `full` keeps today's behaviour (it drops every copy). The 2D outcome is unchanged with `full`/`half`.
   - **GLBs as descriptors.** `isDescriptor` counts `.glb`, and its `textOf` reads the GLB's JSON chunk. A kept GLB that names a texture keeps it, the same safety net a rig atlas has today.
   
   Textures are tier-suffixed (`_tex/<hash>@<tier>.ktx2`), so the pairs line up by name. The cost is a few duplicate bytes in R2, never in a build. A pinned `ultra` build keeps `full` files that have no `@ultra` copy, which is the intended fallback.
5. **Register:** the runtime chooses a tier, then reads `tiers[chosen] ?? tiers.full`.

**What the index records per model and tier** (so the runtime and the pull agree, and the Model Viewer can show it):

```
tiers: { ultra | full | half | quarter: {      // a tier with no copy is absent → full
  glb, bytes, vramBytes,
  lods: [{ level, tris }],                    // the master levels this tier ships
  maps: { baseColor|normal|orm|emissive|ramp: { file, w, h, enc, mips } | 'dropped' },
} }
lodScreenSize: [0.25, 0.10, 0.04, 0.015], cullBelow: 0.005   // per MASTER level (5.4)
```

The pull and the `IE_ART_TIER` pin record what they left out in `pull.json` (`artTier.notPulled`), as they do for 2D.

### 5.4 LODs: authored vs generated, and thresholds as data

| | Recommendation | Rejected |
|---|---|---|
| Default | **Generated at export** with glTF-Transform `weld` + `simplify` (meshoptimizer: attribute-aware; keeps skin joints and weights; `lockBorder` on tiles so neighbours stay watertight). `simplifySloppy` for a prop's last level. Per class, an error target and a ratio per level | Generating in Blender on the server: it would need Blender on Railway, while the launcher must derive tiers from one GLB on its own |
| Authored | Any `_LOD<n>` mesh present in the master **replaces** the generated level n. Expect it for hero LOD0–1 (face and silhouette) and anything whose generated level looks wrong in the Model Viewer. `ie_export.py` can author levels locally with Blender Decimate when the artist wants to see them first | Requiring hand-made LODs for everything: four meshes per prop is art time with little visible gain |
| Skinned LODs | Every level binds the **same skeleton** (one skin, several meshes), so the animation runs once per character. The animation session must keep this | One skeleton per level |
| Thresholds | **Screen size** (the projected bounding-sphere height ÷ viewport height) per master level, with ~10% hysteresis. Stored as data: code default per class → Game Config `lodScreenSize[class]` → `model.json`. A tier that drops the top levels shows its first level at every larger size | Distances in metres (they change with FOV and resolution); `MSFT_lod` (three.js does not read it). Levels ship as `_LOD<n>` nodes, and the runtime builds a `THREE.LOD` |

`check:model-export` gains four fixtures:
- one 4096² master gives four tier GLBs whose tris, map set and sizes match the profile;
- a 2048² master writes no `@ultra` copy;
- an authored `_LOD1` beats the generated one, and `_LODU` appears only in `@ultra`;
- a `quarter` pull has no `normal`/`orm` texture, no full-tier file with a quarter copy, and no `@half`/`@ultra` file.

`check-art-tier-pin.mjs` also gains a 2D parity case: a `full`/`half` project pulls exactly what it does today.

## 6. Third-party Unity assets

- **Unity Asset Store EULA:** Unity says Asset Store assets *may* be used in other engines while you comply with the EULA. That allows use only as embedded components of a game, forbids redistributing them as raw assets, and requires that end users cannot extract the raw files. A web game serves its files to the browser, so the "not extractable" condition is weak at best. Some publishers also add their own terms, and editor extensions are licensed per seat.
- **Toony Colors Pro 2:** a Unity shader generator (ShaderLab/HLSL), with nothing left in the project anyway. **Nothing can or should move.** Replacement: our own toon material in three.js (ramp lookup, rim, specular step, inverted-hull or post-process outline), driven by the glTF `extras` in §1. Size S–M; it belongs to the runtime and rendering session, and the asset side only fixes the `extras` contract.
- **Cartoon FX Remaster (JMO):** its effects are Shuriken particle systems and CFXR shaders, so **the behaviour does not port** whatever the licence says. Its textures and meshes *might* be usable under the EULA, but we will not ship them without **written confirmation from the publisher** for web distribution. Replacement: re-author the effects in **Invisible FX / Invisible Flipbook**, extended to 3D billboards, with flipbook frames generated by Qwen-Image (Apache-2.0) through the existing Flipbook class. Size M–L, owned by the FX side.

## 7. Size and build order

| # | Piece | Size | Notes |
|---|---|---|---|
| 1 | Conventions (master LOD chain, POT masters at `full` size) + `ie_validate.py` / `ie_export.py` + `BLENDER_PATH` + a live MCP check | S | Unblocks everything; the owner opens Blender with the MCP add-on running |
| 2 | `fbx_to_glb.py` + triage of the BattleOTtheYear props and tiles (plus their provenance and licences) | S | Locally |
| 3 | Node optimiser (glTF-Transform + meshopt + generated LODs + KTX2) as a CLI over a fixture; `ktx2Encode.ts` gains ETC1S, a linear/normal-map mode and mipmaps for 3D | M | Becomes the core of `modelExport.ts` |
| 4 | The `models` class: upload, exporter, registry, bake, index, gates (full tier only) | M | Rule 8 complete; parity proven |
| 4b | Quality tiers: `MODEL_TIERS` + defaults in `modelTiers.ts` (never `RESOLUTION_TIERS`), a per-tier derive + cache in `modelExport.ts` (`ultra`/`full`/`half`/`quarter`, skipping identical copies), the Game Config `models` block, `model.json` overrides, the 3D tier ids accepted in `resolutionTiers`, and the pull and pin changes (tier union, the multi-tier drop rule, GLB as descriptor) | M | `check-art-tier-pin.mjs` (with 2D parity) + `check:model-export` fixtures. The pull/pin change touches the 2D build path, so it gets a current-games pass |
| 5 | Invisible Model Viewer `/models` + docs (rule 9), with a tier switcher (tris, bytes, VRAM, preview per tier) and an override editor | M | Gives artists a feedback loop |
| 6 | Palette and ramp texturing + the toon `extras` contract | S | The runtime material is built in the runtime session |
| 7 | RunPod: Qwen tileable blueprint; TRELLIS.2 + StableGen against an R&D pod | M | Respect node/model parity before anything reaches serverless |
| 8 | 7 heroes: model, shared skeleton, 2048² skin, authored LOD0–1 (LOD2–3 generated) | **L** | Owner's art time; the critical path. Start one hero after step 1 to prove the chain end to end |
| 9 | FX re-authoring (replacing CFXR) | M–L | With the Invisible FX owners |

## Open questions for the owner

1. Which tool generated the BattleOTtheYear FBX files and their PBR maps, and under what terms? If it was Hunyuan3D, they cannot ship from the EU.
2. Do we hold licences for the stock JPGs in `Textures/` (iStock and the others)?
3. Palette toon (recommended) or painted 1024² skins for the props?
4. Will we ever accept FBX from outside artists? That is the only case where a cloud Blender service would pay off.

Sources: [Hunyuan3D-2.1 licence (mirror)](https://gitserver.onethingai.com/ai-models/Hunyuan3D-2.1/raw/branch/main/LICENSE) · [Hunyuan3D-2 licence (HF)](https://huggingface.co/tencent/Hunyuan3D-2/blob/main/LICENSE) · [TRELLIS.2-4B model card](https://huggingface.co/microsoft/trellis.2-4b) · [ComfyUI: TRELLIS.2 native](https://blog.comfy.org/p/trellis2-and-pixal3d-are-now-native) · [Unity: Asset Store assets in other engines](https://support.unity.com/hc/en-us/articles/34387186019988-Can-I-use-assets-from-the-Asset-Store-with-other-engines) · [Unity Asset Store EULA](https://unity.com/legal/as-terms)
