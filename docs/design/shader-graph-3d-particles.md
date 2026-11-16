# Invisible Shader Graph: 3D particles (step 8f)

> **Proposed 2026-11-16, not decided, not scheduled.** Owner conversation of 2026-11-16 (Gaussian
> splatting → 3D meshes → a 3D coin). Builds on [shader-graph-particles.md](shader-graph-particles.md)
> (8d, the particle material). Parent plan: [invisible-shader-graph.md](invisible-shader-graph.md)
> §8. Current state: [status/shader-graph](../status/shader-graph.md). Owning agent:
> `invisible-shader-graph`, with `invisible-fx` for the emitter side.

## 1. The ask

Showers of solid things — coins, banknotes, gems — that tumble in 3D, each one different, without a
big frame atlas and without a 3D engine. A coin from an atlas spins on one baked axis under one baked
light; frame-skipping is the only speed control, and a hundred of them read as copies. A coin drawn
in 3D tumbles on any axis at any speed, with a highlight that moves as it turns, from two face
textures and a matcap.

## 2. What we ruled out

- **Gaussian splatting.** Good at captured, static, photoreal objects; wrong for stylised,
  dynamic slot FX. A live renderer needs a per-frame depth sort Pixi does not have, costs several MB
  an object and is heavy on mid-range phones. If ever used, it is an authoring source baked to
  frames (Flipbook / baked FX), never a runtime renderer. Not needed now.
- **three.js for particles.** A real mesh engine is for complex meshes (a wheel, dice, a chest, a
  character), and a separate later question (§8). Coins, notes and gems do not need it.

## 3. Three families of 3D particle

| Family | Examples | How it draws | New in the engine |
|---|---|---|---|
| **Analytic solids** | coin, gem, orb, bead | Ray-traced inside the particle's quad (§4) | Graph nodes only |
| **Flexible sheets** | banknote, card, confetti, petal, leaf | A subdivided quad bent in the vertex stage (§5) | A vertex stage in the particle shell |
| **Arbitrary meshes** | chest, crown, character | Pre-rendered, or a later three.js node (§8) | — |

## 4. Analytic solids on today's 8d seam

A particle material already draws each particle as a quad through a compiled graph, with per-particle
Seed, Progress, Seconds, Colour and Sample-at-UV (8d §7). A solid needs no new geometry:

- **Orientation.** A tumble axis from a hash of Seed, an angle from Seconds × a speed param; the
  particle's own 2D rotation still applies on top. No new input.
- **The shape.** The pixel shader casts a ray per pixel against the solid in the particle's local
  space and discards what misses.
  - **Coin:** a short cylinder with two caps. Thickness is a param (height ÷ radius), so edge-on is
    a solid band of metal. A raised rim on each face is traced as a sunken disc inside a ring. A
    bevelled edge ray-marches a rounded cylinder instead (a few more instructions a pixel).
  - **Gem:** a convex cut is a list of planes; a ray against a plane set is cheap. Brilliant,
    emerald, heart and cartoon cuts are different plane lists. Facets reflect and refract the
    matcap with a per-channel offset for fire; glints flash as facets line up with the light. One
    reflection and one refraction — stylised, not photoreal.
- **Shading.** The hit gives a normal, a face id and a UV on that face (the rim gets its own UV
  round and across the edge, for reeding or lettering). Lighting is a matcap lookup by normal.
- **Art in one region.** The Sample node takes a UV, so a solid's art packs into the particle's own
  atlas region: front, back, edge strip and matcap as four tiles. No new texture input is needed for
  v1; separate texture slots are a later convenience.
- **Room.** The quad must hold the solid's bounding sphere at every angle, not its face, or a
  tumbling coin clips. The effect's padding already grows the quad (8d §6); the solid nodes report
  the padding they need.
- **Relief inside a face** (a portrait, a "$") stays a normal map: lit correctly, flat at the
  silhouette. Parallax occlusion is the upgrade if a game ever needs it.

**Proof first:** a coin built today with the admin-only Custom GLSL node (8c) inside a particle
material, played on a phone through the 8d `particle-material` playbook. If it reads well and fits
the §10 budget, the trace becomes regular nodes (**Solid: coin**, **Solid: gem**, **Matcap**) with
graph templates, so artists build them without GLSL.

## 5. Flexible sheets need a vertex stage

A note is not thick; it **bends** — curl, flutter, fold. That moves vertices, which 8d leaves out of
v1 ("anything that deforms a particle's quad", §14). What it takes:

- **Subdivided quads.** The shell builds each particle as an N × M grid (8 × 4 is enough for a
  note) instead of 4 corners. The 512-particle capacity and the 108 B a vertex layout of 8d §15 grow
  by N × M; the budget is re-measured.
- **A vertex graph.** A second, small graph (like 8a's motion graph, but on the GPU per vertex)
  that offsets each grid point along z from Seed, Seconds and its grid UV — curl, travelling wave,
  noise — with a projection for depth. Normals come from the same bend, so the paper shades.
- **Two sides.** The pixel stage picks front or back by which way the bent normal faces.

The same material makes the existing Confetti preset far better, and covers cards, leaves and petals.

## 6. Where they play

- **`/fx` emitter layers** — as every material today.
- **Coded emitters** (the big-win coin shower, flight trails) are out of 8d v1, which calls
  `<ParticleEmitter material>` a small later change. The coin is the main reason to do it; it joins
  this step.
- **Rule 8.** Nothing new ships: the material, its graph and its atlas region travel the 8d chain
  (proven in 8d.4).

## 7. Steps (proposed)

1. **Coin spike** with Custom GLSL in a particle material; phone check; owner look.
2. **Solid nodes** (coin, gem) + Matcap node + templates in `/shaders`; padding reported by the node.
3. **Materials on coded emitters** (`<ParticleEmitter material>`), so the win coin shower can use it.
4. **Vertex stage**: subdivided particle quads + a vertex graph + two-sided shading; Banknote and
   Confetti templates.

Each is its own PR under the usual gates (Current games unchanged, svelte-check, the 8d parity gate).

## 8. Later, separate: real meshes

For an object whose result changes the picture (a 3D wheel landing on the book's result, dice):
three.js drawing into a render texture shown by a Pixi sprite in a shared WebGL context, as an
opt-in `model3d` node (off by default, byte-parity for every other game), glTF + meshopt + KTX2 as a
new asset class on the full rule-8 chain. Not part of 8f; only when a game design needs it. Until
then, complex 3D is rendered offline (Blender) to Flipbook frames.

## 9. Open questions

1. Is a ray-traced coin cheap enough on a mid-range phone at shower density (fill × cost, device
   pixels)? Step 1 answers it.
2. Does a tumbling solid need depth between particles (a coin passing behind another)? v1 says no:
   draw order is spawn order, as now.
3. Packed tiles vs. separate texture slots for face / back / edge / matcap.
