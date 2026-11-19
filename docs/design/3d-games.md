# 3D games — plan

> Status: **PLAN, nothing built** (2026-11-17, against `main` ca9810945). Awaiting the owner's
> go and the decisions in §8. The detail behind every line is in four evaluations under
> [`3d/`](3d/): [assets](3d/assets-evaluation.md), [runtime](3d/runtime-evaluation.md),
> [animation](3d/animation-evaluation.md), [gameplay](3d/gameplay-evaluation.md). This file is the
> merged decision; where they disagreed, §7 says which way it went. Progress will live in a
> `docs/status/3d.md` once building starts.

## Goal

Make 3D games with the pipeline, starting with **BattleOTtheYear** (BOTY: a Unity 6 online
red-vs-blue arena brawler, `C:\Invisible Wall SL\Projects\BattleOTtheYear`) rebuilt as data, and
ship each 3D game both as a **web game** (phones and desktops) and as a **higher-resolution desktop
game**, with control over LODs and texture sizes and maps per target.

**Hard constraint (owner):** nothing that only 3D needs may reach the games we already produced.
The four runtimes we release today (`lines`, `match3`, `arcade`, `card`) must build to **the same
bytes, file for file**, and a 3D-only merge must release nothing to them. That is checked in CI
(§4), not promised.

## What BOTY really is (measured, it changes the scope)

- **No characters exist.** All 7 hero prefabs are Unity's built-in capsule; there is no Animator,
  no clip, no skinned mesh, and Cinemachine/Timeline are installed but unused. The heroes must be
  **modelled, rigged and animated from scratch**. This is the critical path, and it is art time.
- The tiles and props (442 MB) are raw image-to-3D output (1.5M-tri tiles, 4×4096² maps): usable
  as references only after decimation and retexturing. **Their generator and licence must be
  confirmed** before any ships (§8).
- The camera is **first person**; aim has pitch; there are tiers joined by ramps, jumps, double
  jumps and trampolines; maps are procedural (`MapGenerator`, unseeded).
- Netcode is **client-authoritative** (a client can teleport and hit anyone). Our server-owns-places
  model replaces it by construction.
- Toony Colors Pro has left nothing to port; Cartoon FX Remaster is Unity particle systems, so its
  behaviour cannot move whatever its licence says.

## 1. Architecture in one picture

A 3D game is an **arcade game with a 3D view**, not a new engine:

| Layer | Shared with 2D arcade (unchanged) | New, 3D-only |
|---|---|---|
| Boot, HUD, Flow, sound, localization, publish | `apps/lines`, Pixi HUD on top | — |
| Simulation | fixed step (`createFixedStep`), zones, abilities, rules modules, bots-as-players | `engine-mechanics` `motion3d.js` / `online3d.js` (new exports) |
| Online | `services/game-server` (Colyseus), inputs only, room = device prediction | `Input3D` / `Player3D` / `Entity` schema, lobby phase |
| Rendering | — | **three.js** in `packages/engine-3d`, its own canvas **under** Pixi's |
| Animation | the component state machine's model (layers, inputs, transitions) | glTF clip libraries, `AnimationMixer` + layering (2D blends, masks, additive) |
| Assets | the export → deploy → bake → pull → register chain, tier names, KTX2 encoder | a `models` asset class with derived quality tiers |
| Runtime release | the family-runtime machinery (Phase 11) | a **fifth runtime, `arcade3d`** |

## 2. Recommended stack

| Area | Decision | Rejected (why) |
|---|---|---|
| Renderer | **three.js** (MIT), WebGL2 first; 183 KB gz measured for the whole arena set, one lazy chunk | Babylon (3× bytes), PlayCanvas (owns the app loop), Unity WebGL export (a second engine, 10+ MB), pixi3d (dead) |
| Canvas | **Two stacked canvases**: three under, Pixi HUD on top; 3D resolution can drop while the HUD stays sharp | One shared WebGL context (changes `pixi-svelte` init for every game) |
| Sim | **Home-grown kinematic capsule** on a grid of boxes and ramps, IEEE-exact ops only in the predicted path | Rapier (2 MB wasm, world snapshot per frame; kept as a server-only escape hatch), cannon/ammo (not deterministic) |
| Bots | Grid nav graph + A* on the server only | recast-navigation-js until levels become free-form (then bake in the launcher, server-only) |
| Modelling | **Blender 5.2** with fixed conventions + `ie_validate.py` / `ie_export.py`, run by Claude through the Blender MCP | Authoring in Unity; unchecked exports |
| Textures | **Toon-first**: palette + ramp, base colour only where possible. AI: **Qwen-Image** (Apache-2.0, on our pods) for tileables and turnarounds; **StableGen** (Blender add-on → our RunPod ComfyUI) to project skins; **TRELLIS.2** (MIT, ComfyUI-native) for blockouts only; **ambientCG / Poly Haven** (CC0) | **Hunyuan3D** (licence excludes the EU), FLUX-dev / PuLID (non-commercial), SF3D (revenue cap) |
| Format | **GLB + meshopt + `KHR_mesh_quantization` + KTX2** (ETC1S colour, UASTC normals), optimised in Node with glTF-Transform | Draco (300 KB decoder), FBX/OBJ at runtime, a cloud Blender service |
| Animation | Clips authored in Blender on **one shared humanoid skeleton**, shipped as clip libraries; **in place, never root motion** (the server owns places) | One clip set per hero, runtime retargeting, a launcher dope sheet |
| Anim graph | The existing **component state machine** extended (2D blend spaces, phase sync, masked and additive layers) | A Unity Animator clone (a second graph format) |
| Camera | A small **virtual-camera director** (first person, follow, orbit, shoulder, fixed/rail) with blends, collision, seeded shake; authored moves animated in Blender | Extending the 2D `camera.js`; a launcher keyframe editor |
| Desktop build | The **same web runtime pinned to the `full` tier**; an Electron wrapper only for a store or offline install | Anything native; Tauri (three OS web views to test) |

## 3. Assets: from Blender to the game

1. **Author in Blender** to the conventions (metres, −Y front, applied transforms, `CH_`/`WP_`/
   `PR_`/`TL_` names, `_LOD<n>`, `_COL` collision, `SK_<name>` sockets, one shared humanoid skeleton
   with ≤ 64 deform bones and ≤ 4 influences). Claude validates, fixes (asking before anything
   destructive), exports and uploads through the MCP. It does cleanup and scaffolding, not hero art.
2. **Upload one master** (the full LOD chain, power-of-two textures at the `full` size) to the new
   **Invisible Model Viewer** (`/models`): validator report, three.js preview with clips, sockets
   and a tier switcher showing tris, bytes and VRAM per tier, plus per-model overrides.
3. **Export derives every tier** from the master (never made twice by hand): LOD window, resized
   maps, per-map keep/drop and encoding, mipmaps, meshopt → `deploy/models/<id>[@<tier>].glb` and
   `_tex/<hash>@<tier>.ktx2`, cached per derived texture. Then bake → pull → register as rule 8
   requires; a 2D project exports nothing, so its build is byte-identical.
4. **Clip libraries** (`anim/<skeleton>/<set>.glb`, armature only, clips named `<set>.<clip>`) and
   **camera moves** (`anim/cameras/<arena>.glb`) travel the same class, untiered.
5. **FBX migration** of BOTY's props and tiles: a local `fbx_to_glb.py` with headless Blender
   (3–5 s a file; decimating a 1.5M-tri tile takes 18 s).

## 4. Keeping today's games untouched (the size guarantee)

- **A separate runtime.** `arcade3d` is built from the same `apps/lines` with `PUBLIC_IE_3D=1`, which
  swaps the arcade seam for one whose stage dynamic-imports `engine-3d`. The other four runtimes
  never contain the module. Proven on a scratch build: `lines` and `arcade` came out identical file
  for file; `arcade3d` = arcade + 119 B, plus the 183 KB three chunk loaded only when the 3D play field mounts.
- **Reproducible builds + `check:runtime-bytes`.** Today two builds of one commit differ (build
  time, commit and the **lockfile hash** are compiled in), so merely adding `three` to the
  workspace would change every game's bytes. `IE_REPRODUCIBLE=1` pins those; a new gate compares
  every file of the four runtimes with a committed manifest and fails on any difference.
- **Skip-unchanged releases.** The release job compares the reproducible manifest with the live one
  and does not move a runtime's pointer when nothing changed. A 3D-only merge (or `three` entering
  the lockfile) then costs 2D players nothing, not even a re-download. Side win: it also stops
  docs-adjacent merges from forcing every player to re-fetch ~720 KB today.
- **Traps the gate must catch:** `RESOLUTION_TIERS` (do not add `quarter` there, §7), new fields in
  `game-config` (in every bundle), a graphics option in the shared HUD settings, and logic changes to
  the shared `stateMachine.ts`. 3D schema, tier tables, the graph extensions and the graphics setting
  live in `engine-3d` or the `arcade3d` seam.
- Found on the way: every runtime is already 2–2.5 % over its committed size budget, unnoticed,
  because the release check only warns. Worth its own small fix.

## 5. Quality tiers: web and desktop from one master

Tiers reuse the 2D **conventions** (one master, `@<tier>` copies, `full` unsuffixed as the
fallback, the `IE_ART_TIER` pin), but their id list is 3D-only (`MODEL_TIERS` in
`constants-shared/modelTiers.ts`, never the 2D `RESOLUTION_TIERS`, §7):

| | `ultra` — latest-gen desktop | `full` — desktop game | `half` — web desktop | `quarter` — web mobile |
|---|---|---|---|---|
| Hero LODs shipped (top tris) | authored `_LODU` (≤ 60k), LOD0–2 | LOD0–2 (20k) | LOD1–3 (10k) | LOD2–3 (5k) |
| Base colour / normal / ORM | 4096 / 4096 / 4096 (the master) | 2048 / 2048 / 2048 | 1024 / 1024 / 1024 | 512 / dropped / dropped (AO baked in) |
| Encoding | UASTC (→ BC7) | UASTC (→ BC7 on desktop) | ETC1S colour, UASTC normal | ETC1S |
| Toon ramp / palette | lossless PNG, every tier | same | same | same |
| Scene on screen | ≤ 3M tris, 500 draws, 3 GB VRAM | ≤ 1M tris, 300 draws, 1 GB | ≤ 300k, 150, 256 MB | ≤ 150k, 80, 64 MB (iOS ceiling) |
| 3D payload | packaged, ≈ 1.5 GB (proposed) | packaged, ≤ 500 MB | first load ≤ 40 MB | first load ≤ 15 MB |
| Shadows / AA / post | 4096² cascaded, MSAA + SMAA, outline + bloom + AO + depth of field | 2048² soft, MSAA 4×, outline + bloom | 1024², MSAA 4×, none | blob shadows, off, none |
| 3D canvas DPR cap | native 4K, dynamic resolution | device | 1.5 | 1.0 |

`ultra` is **opt-in per project and never picked automatically**: a build pin, or the player's
"Ultra" setting, which only appears on a desktop GPU with BC7/ASTC, large textures and frame-time
headroom (so an integrated-graphics laptop never loads ~3 GB of textures). Its extra passes (cascaded
shadows, AO, depth of field) are lazy chunks no other tier downloads. A tier copy identical to
`full` (a 2048² prop master with no `_LODU`) is not written, so `ultra` costs bytes only where the
master really is bigger. WebGPU gets a measured A/B on `ultra` only.

- **Controls, most specific wins:** code defaults (`constants-shared/modelTiers.ts`) → a Game Config
  `models` block per class → `model.json` overrides per model, edited in the Model Viewer. Which tiers
  publish is the existing per-project tier list.
- **Picking a tier:** a build pin wins (the desktop game pins `full`; the pull leaves other tiers out),
  then `?tier=`, then the player's **Graphics: Auto/Low/Medium/High** setting, then auto by device
  class, compressed-texture support and GPU limits. Auto never picks `full` on the web and never uses
  device memory.
- **LODs switch by screen size** (stored as data, converted to `THREE.LOD` distances when the FOV
  changes). Authored `_LOD<n>` meshes beat generated ones (meshoptimizer simplify at export). Every
  level binds one skeleton.
- **Dynamic resolution** on the 3D canvas only: DPR → post → shadows → LOD bias, stepping back up on
  headroom; the HUD stays sharp. Never changes the asset tier mid-game.
- For `full`, 2048² is enough (a hero covers ~400–550 px of a 2160 px screen); `ultra` exists for
  players who want the master's detail on hardware that holds it, and covers hero-select close-ups.

### Consoles

`ultra` gives a console port its **assets and quality bar**, not a **runtime**: our engine is a web
page. PlayStation and Switch accept only native titles built with their SDKs, so a release there is a
native port (a renderer reading the same glTF + KTX2 and game data, the sim ported or embedded):
its own project, behind developer access we do not have. Xbox *may* accept a wrapped web build;
unverified, to be checked with ID@Xbox. What we do now at no cost to the web path: standard asset
formats, a simulation free of browser APIs (it already is), and **gamepad input early**.

## 6. Build plan

Every step is its own pipeline-change PR that must keep `check:runtime-bytes` and every 2D replay
green. Sessions start on **Opus 5.5 extra-high** (design-heavy), **high** for scripts with a clear
spec; a cheaper model only for mechanical pieces. A new build agent, **`games-3d`**, should own the
3D view, `engine-3d` and the `arcade3d` seam (built on `arcade-games` and `engine-pixi-svelte`),
with `docs/knowledge/families/3d.md` and `docs/status/3d.md`.

| Phase | Steps (sources in brackets) | Size | Sessions (agent · effort) |
|---|---|---|---|
| **0 — Spikes** (parallel; each can stop the plan) | **0a** size isolation: `IE_REPRODUCIBLE`, `check:runtime-bytes` + baseline, `arcade3d` seam, a toon cube under the HUD, skip-unchanged releases [runtime 0, 0b] · **0b** determinism: the `motion3d` step 10k steps in Node, Chrome and **iOS Safari**, hashes equal [gameplay 0] · **0c** Blender toolchain: conventions, `ie_validate` / `ie_export`, `fbx_to_glb`, skeleton template + export preset, live MCP check [assets 1–2, anim A0] | S each | 0a `games-3d` · xhigh; 0b `arcade-games` · high; 0c `atlas-python-tools`-style session · high |
| **1 — Foundations** | Two-canvas integration + bodies → objects + tier chooser [runtime 1–2, T1] · `motion3d` + `online3d` + room [gameplay 1–2] · Node optimiser, `ktx2Encode` ETC1S / linear / mipmaps, the `models` class with tiers [assets 3, 4, 4b] | M each | `games-3d` · xhigh; `arcade-games` · xhigh; `launcher-studio` + `pipeline-concurrency` review · xhigh |
| **2 — Characters & camera** | glTF clips + mixer adapter, state-machine extensions, gameplay → inputs, screen-size LOD [anim A1–A3, runtime 3, T2] · camera director + authored moves [A4–A5] · toon material + outline from the `extras` contract [assets 6] · **touch input** (below) [review A N1] | M each | `games-3d` · xhigh |
| **3 — The game (vertical slice)** | Crash rules, combat (melee first), bots with grid nav, seeded CrashArena generator, lobby phase [gameplay 3–7] — **one melee hero, one generated arena, carry to the pit, bots filling 16 seats, online** | M each, L total | `arcade-games` · xhigh, then `game-playtester` |
| **4 — Tools** | Invisible Model Viewer `/models` + its doc (rule 9) [assets 5] · a **3D tab in Invisible Characters** (preview, graph, input scrubbers, cues, masks, camera rigs) [A6] · Blender tileset/level import + layered grid editor [gameplay 6] · dynamic resolution, graphics setting [T3–T4] | M–L | `launcher-studio` + `docs-keeper` · xhigh |
| **5 — Content & ship** | 7 heroes (owner's art), aim poses [A7], remaining BOTY (heroes' abilities, chests, pickups, destructibles, biomes), FX re-authored in Invisible FX / Flipbook, RunPod texture blueprints [assets 7, 9], desktop `full` build + `check:3d-tier-payload` [T5]; Electron only on the owner's go [T6]; `ultra` tier: `@ultra` export, the ultra gate, cascaded shadows / AO / depth of field chunks, WebGPU A/B [T7, M]; gamepad input [T8, S — can come forward to Phase 1] | L | per piece |

**Input (Phase 2).** The tier chooser serves phones, so a phone must play: the keys alone left it
standing (3D review A N1). Every device gives the same frame — a camera-relative stick, the input's
button bits, look travel in the mouse's units — and the stage adds them up (`engine-3d`
`mergeSticks3d`), so the keys, touch and a gamepad (T8) are one path into `Input3D` and the camera
director's look:

- **Touch** (first person, the owner's choice): a floating stick on the left half, run past the
  rim; a drag anywhere else on the right half looks (yaw and pitch); jump, attack and interact
  (carry / throw) buttons at the bottom right. Drawn in the Pixi HUD through the `arcade3d` seam,
  shown on a touch-first device or from the first touch, hidden while a press-to-continue overlay
  is up; a touch on an interactive HUD object stays the HUD's.
- **Gamepad** (T8): left stick and right stick into the same frame, face buttons to the same bits.

Order: Phase 0 first and in parallel; nothing in Phase 1 starts until 0a shows unchanged manifests
and 0b shows equal hashes on iOS. Phases 1's three tracks run in parallel. **Start one hero model as
soon as 0c lands**: the art is the longest pole, and it proves the asset chain end to end.

## 7. Where the evaluations disagreed

| Topic | Resolution |
|---|---|
| Add `quarter` to `RESOLUTION_TIERS` (assets) vs never (runtime) | **Never.** It is in every 2D runtime, and `chooseArtTier` would make a 4K 2D game fall back to full-size art on small windows. 3D tiers live in `constants-shared/modelTiers.ts`; the pull and `PINNABLE_TIERS` (build-time code) take the union. |
| A 4K asset tier: not worth it (assets, first pass) vs the owner's `ultra` for latest-gen / consoles | **`ultra` added** as an opt-in `@ultra` tier above `full`, packaged only; `full` stays the unsuffixed fallback, and the `closeup` exception is dropped in its favour. The pull's tier-drop rule must learn a four-tier list (build-time code only). |
| Sim: 2D on the ground plane with height as presentation (runtime) vs a real 3D body (gameplay) | **Real 3D body** in new `motion3d.js` exports; the 3D stage's `sync(bodies, view)` reads x/y/z directly. |
| State-machine extensions in `engine-layout` (animation) vs bytes | Type-only optional fields may go in the shared types; the **evaluator extensions** (2D blends, phase sync, masks) live in `engine-3d`. Phase sync for the existing 1D blend is 3D-only, so 2D component timing does not change. |
| Clip naming `<rig>@<clip>` (assets) vs `<set>.<clip>` in libraries (animation) | **`<set>.<clip>` clip libraries** on a shared skeleton (downloaded once per game). Sockets keep the asset report's `SK_<name>`. |
| Config switch / 3D settings in `game-config` | `game-config` is in every bundle: the 3D schema lives in `engine-3d`; whether `game-config` can carry an opaque block without a byte change is checked in spike 0a. |
| Two new tools? | One new tool (**Model Viewer**, assets), and a **tab** in Invisible Characters (animation and camera), both using `engine-3d`'s preview so the editor and the game cannot disagree. |

## 8. Owner decisions needed

1. ~~Go / no-go on Phase 0~~ — **go**, 2026-11-17; Phase 0 and Phase 1 are built (`docs/status/3d.md`).
2. ~~First or third person?~~ — **first person** (owner, 2026-11-18), as BOTY: the own player sees
   viewmodel arms + the held weapon (its own clip set, drawn so it never clips walls), everyone else
   sees full bodies; `firstPerson` is the default camera rig, the other rigs serve spectating, intros
   and round ends. Built in Phase 2 (characters: the viewmodel; camera: the default rig).
3. **Provenance of BOTY's FBX files and their PBR maps** (which generator, which terms; Hunyuan3D
   cannot ship from the EU), and licences for the stock JPGs in `Assets/_Project/Textures/`.
4. **Mixamo:** OK to prototype locomotion with it; shipping a Mixamo-derived clip needs a sign-off.
5. **Palette toon (recommended) or painted 1024² skins** for props.
6. **Bots carry pieces to the pit?** (an improvement on BOTY, whose bots only fight).
7. **Set `BLENDER_PATH`** (`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`) and run Blender
   with the MCP add-on during asset sessions.
8. Later: an Electron desktop wrapper (store / offline), and outside artists sending FBX (the only case
   that would justify a cloud Blender service).
9. **Consoles:** which ones, if any. PlayStation / Switch mean a native port and developer access;
   Xbox needs a check with ID@Xbox. `ultra` keeps the assets ready either way.
