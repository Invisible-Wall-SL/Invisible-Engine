# Invisible Shader Graph: 3D particles (step 8f)

> **Proposed 2026-11-16. Step 1 (the coin spike, then the gem spike) built the same day, and a
> traced banknote as the interim for §5; steps 2–4 wait for the owner's look at them on a phone
> (§9).** Owner conversation of 2026-11-16 (Gaussian
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

**Interim, built 2026-11-16: a traced banknote** (§9 "the banknote"). Until the vertex stage, a
pixel-traced sheet on today's seam gives artists a bending note: a curl (an exact ray against a
cylinder) and a gentle wave (a height bracketed along the ray), front and back by the facing side.
It cannot fold sharply or crumple, and its quad grows to hold the bent sheet's bounding sphere, so
the vertex stage stays the path for folds, crumples and dense confetti.

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
   pixels)? Step 1 answers it. **Desktop half answered (below); the phone half waits for the
   owner's check** (`docs/playtest/particle-material.md` items 7, 8 and 9: the coin, the gem and
   the banknote).
2. Does a tumbling solid need depth between particles (a coin passing behind another)? v1 says no:
   draw order is spawn order, as now.
3. Packed tiles vs. separate texture slots for face / back / edge / matcap.

### Step 1 results (2026-11-16)

**What was built.** `calCoin` (`engine-shadergraph/src/coinSpike.ts`), a graph made for particles
from five Custom GLSL nodes (Ray, March ×2, Normal, Shade), joined to the phone check's
`CALIBRATION_GRAPHS` as the `cal-coin` project. Its art is one 512 px frame of four tiles drawn by
`scripts/playtest/coin-spike-art.mjs`. Params: Thickness (height ÷ radius, 0.04–0.6), Rim width,
Rim height, Bevel, Spin (turns a second, varied ±40 % per coin) and Relief.

**How it traces.** Not the analytic cylinder of §4: a sphere trace of one distance, a rounded
cylinder less two shallow discs. That gives the bevel's real silhouette, the raised rim and the
sunk face from one formula, and the normal from four more reads of it. The ray starts where it
enters the bounding sphere; a pixel outside it is out at once, a hit ends the march, and a miss
keeps its nearest approach for a soft silhouette a pixel wide. Orthographic, no depth between
coins (§9.2). The padding is fixed at 0.04 of the side, enough for the bounding sphere at the
largest Thickness.

**The caps shaped it.** One node may hold 600 tokens and 1,024 units; one march of 24 rounds cost
1,846. So the trace is two nodes of 12 rounds sharing their state through an input and output of
one name. The effect totals **1,586 units, 4 reads**: inside Custom GLSL's 4,096 / 1,024, and 10.5×
the 150 / 4 a particle material is warned at. Reads: the art, two for the relief, the matcap.

**Where it played.**
- `/fx`: the real page (fx-spike `fx-page`, step 10, in CI) mounts the material on the coin atlas,
  its six params as sliders; the coins draw and tumble.
- A release `apps/lines` build (`particle-material-play.mjs --coin`), WebGL2 and WebGL1: on at every
  sample, load = covered px × 1,586, no errors, stalls or plain-while-playing.
- `shader-compile` links it through the particle shell on WebGL1 and WebGL2.

**What it cost** (Intel Arc iGPU through ANGLE / D3D11, 1280 × 720 at 1×, 76 coins about 160 px):

| | WebGL2 frame | WebGL1 frame |
|---|---|---|
| Same particles, flat (`coin-plain`) | 2.5 ms median (3.4 in an earlier run) | 2.4 ms (2.8) |
| The coin | 5.1 ms (3.9) | 3.8 ms (4.0) |

About 0.5–2.6 ms a frame for the shower on a desktop iGPU (two runs; the iGPU's timings move by
about a millisecond run to run). The `?fxdebug=1` load reads 2,747 M, 86× the 32 M layer budget: the meter multiplies the Custom GLSL estimate, which counts every round
and every branch, by the covered pixels, while most pixels leave the march early. **For a traced
solid the load figure is no guide; the frame times are.** Step 2's nodes need a hand-set cost
measured from frames, as the library's nodes have.

**How it looks.** Read off the real GPU (the game build and `/fx` in a GPU browser): a thick coin,
a solid band of metal edge-on, the reeded edge, a rounded bevel at the silhouette, a raised rim and
a sunk field with the motif in relief; every coin on its own axis and speed. The matcap is a
single grey sphere, so the gold is the art's and the highlight is modest; a warmer, higher-contrast
matcap is an art choice. **SwiftShader** (the `/fx` gate, CI) draws screen-aligned patches of a
different shading over the coins, with the stage paused too; no real GPU here drew them. It is not
used to judge the look, and a phone may still differ: the owner's check is the answer.

**Found in review, for step 2.** The trace runs in the quad's frame and the shell has no particle
angle, so a particle's 2D spin turns the matcap's light with it; a solid needs the angle as an
attribute. The coin's distance is written out three times (Custom GLSL declares no functions); it
becomes a library function. Early art drew both faces mirrored (hidden by symmetric test art),
fixed before the numbers above were read.

**In the studio library.** The same graph, renamed `coin3d` ("3D coin") and otherwise unchanged,
is published to the studio-shared Shader Graph library (2026-11-16), so every project's `/fx`
Material list offers `custom:coin3d` with no per-project step. Artists can use and tune it, not edit
it (it holds Custom GLSL); updating it needs `shaderPublish` + `shaderCustomGlsl` and a publish with
`replace: true`. Step 2's nodes replace it with a node-built template, and `coin3d` is then
unpublished. Not yet verified: that a published game bakes and plays a library material named by a
layer.

**Not done in step 1** (as agreed): no Solid or Matcap node, no templates, nothing on coded
emitters, no parallax. Step 2 waits for the owner's look.

### Step 1 results: the gem (2026-11-16)

**What was built.** `calGem` (`engine-shadergraph/src/gemSpike.ts`), the gem half of §4 by the
same route as the coin: a graph made for particles from Custom GLSL nodes, joined to
`CALIBRATION_GRAPHS` as the `cal-gem` project, interim until step 2's Solid: gem node. Its art is
one 512 px frame drawn by `scripts/playtest/gem-spike-art.mjs`: two tiles in the top half, what the
facets reflect (a studio, its soft box where the glint light is) and what they refract (bright and
dark wedges and rings, for sparkle), each a sphere map of directions; the bottom row is spare.
Params: Cut (Brilliant, Cartoon), Tint, Table, Crown, Pavilion, Girdle, Refraction (index), Fire,
Depth, Glint, Glint size, Spin.

**How it traces.** As §4 said: a convex cut is the space inside a set of planes, so a ray enters
by the last plane it crosses inward and leaves by the first it crosses outward. No march. The
brilliant is 57 planes: the table and seven rings of eight round the axis (bezel, star, upper
girdle, the girdle's 16 sides, pavilion main, lower girdle), each placed from the shape params
through the girdle edge, the table edge or the culet. The **Cartoon** cut moves the four rings
offset by π/8 out of reach: an octagon of 8 bezels and 8 pavilion facets under a table, the
slot-game gem, from the same graph. Shading is one reflection (the outside tile by the entry
facet, by Schlick's Fresnel), one refraction (in at the entry facet, a second trace of the planes
from inside to the exit facet, out with the index split per channel by Fire, each channel read off
the inside tile; a ray held in by total internal reflection reflects once instead), the Tint
raised to a power that grows with the path inside (Depth), and a glint where the entry facet's
reflection meets the light, twinkling per facet. Orientation, tumble and the soft edge are the
coin's.

**The caps shaped it.** The first build traced each plane alone: 4,162 units, over the 4,096 an
effect's Custom GLSL may do. Planes on one ring share their angle, so each ring is now traced as a
vector of planes (the φ ring a vec3, the φ + π/8 ring a vec4) against one projection of the ray a
round: **2,943 units, 4 reads** in eight nodes (Ray 151, Enter 584 + 768, Facet 61, Exit 433 + 564,
Back 130, Shade 251), each under 1,024 and 600 tokens. Arrays and functions are refused, so a facet
is named by an index (8 × ring family + step) and its normal rebuilt from it where needed.

**Where it played.** fx-spike `fx-page` step 11 (the real `/fx` page mounts it on its own page:
on, measured, the gems draw and tumble); `particle-material-play.mjs --gem` on WebGL2 and WebGL1
against a release `apps/lines` build (`gem` on at every sample, `gem-plain` plain); `shader-compile`
links it through the particle shell on both.

**What it cost** (the coin's GPU and setup, 76 gems about 160 px, two runs):

| | WebGL2 frame | WebGL1 frame |
|---|---|---|
| Same particles, flat (`gem-plain`) | 3.6 ms median (3.9) | 3.1 ms (4.1) |
| The gem | 8.8 ms (7.7) | 7.4 ms (5.2) |
| The coin, same run as the second figures | (5.1, flat 3.8) | (4.0, flat 2.8) |

About 1.1–5.2 ms a frame for the shower on a desktop iGPU: in the run that timed both, from about
the coin's price (WebGL1, +1.1 against +1.2 ms) to three times it (WebGL2, +3.8 against +1.3). The meter reads 4,727 M, 148× the layer budget, and is no guide for the same reason as
the coin's.

**How it looks** (real GPU, the `/fx` page): the brilliant reads as a cut stone, crown, table and
pavilion facets each lit differently and changing as it turns; a white Tint with Refraction 2.42
and Fire 0.12 is a diamond, white and grey facets with coloured fire where the inside tile's
bright and dark meet; the Cartoon cut in green is a slot emerald, its facets flat and bold, a white
glint flashing as a facet lines up with the light. With the default ruby the darkest facets go
nearly black; lifting the art's floor (both tiles) lifted most of
them, and the rest is an art choice.

**In the studio library.** Published as `gem3d` ("3D gem") the same day, the way `coin3d`
was, so every project's `/fx` Material list offers `custom:gem3d`; step 2's Solid: gem replaces it.

**Found, for step 2.** The light turns with the particle's 2D spin, as on the coin. A glint is a
whole facet (flat facets have one normal); a star-shaped flare would need a sprite beside the gem,
not more shader. The rings are fixed at eight steps: a heart or emerald cut needs another plane
list, which in step 2 is a node setting rather than more Custom GLSL. Depth between overlapping
gems is still spawn order (§9.2).

### The banknote, traced: §5's interim (2026-11-16)

**What was built.** `calNote` (`engine-shadergraph/src/noteSpike.ts`), a graph made for particles
from five Custom GLSL nodes (Ray, Curl, Sheet ×2, Shade), joined to `CALIBRATION_GRAPHS` as the
`cal-note` project, by the coin's route and with no engine change. It stands in for §5's vertex
stage until that is built. Its art is one 512 px frame drawn by `scripts/playtest/note-spike-art.mjs`:
the front in rows 0–223 and the back in rows 224–447 (each 512 × 224, the note's 16 : 7 ≈ 2.29 : 1),
a 64 px matcap at the bottom left; a placeholder note of our own (violet on cream, a rosette, a
"100" made of a bar and two rings), no real currency. The art's alpha cuts the outline (rounded
corners). Params: Curl along (Length, Width), Curl, Wave amplitude, Wave speed, Flutter, Spin.

**How it traces.** The note is x along its length (−1…1), y across, flat at z = 0.
- **Curl:** the sheet rolled onto part of a cylinder that touches its middle, round the short axis
  (Length) or the long one (Width). A roll keeps lengths, so the arc from the middle is the art's
  coordinate and the edges clip there exactly. The ray meets the cylinder in closed form, written
  as k t²|d|² + 2t(k o·d − d.z) + k|o|² − 2o.z = 0 with k the curvature, so a flat note is a
  plane rather than a huge radius (no R², nothing lost on a phone's floats). The curvature breathes
  per note at Flutter between 0.3 and 1 of Curl.
- **Wave:** a height h(x, y, t) along the bent sheet's normal, a wave running down the length at
  Wave speed plus a ripple across it at Flutter. It is not marched from the sphere: near each of
  the cylinder's two crossings, eight steps across the window the wave can move it in bracket where
  the distance to the cylinder meets h, and the step that changes sign is cut by its two ends.
- Two crossings in order, each kept only inside the note's edges (to half a pixel, the soft edge),
  so a ray past a curled edge finds the sheet behind it. The normal is the cylinder's tilted by
  the wave's slope; the side facing the viewer picks the front or back tile, the back mirrored as
  a note turned over end to end; the matcap lights it, so a curl's inside darkens and the print
  shades with the wave. Orientation and tumble are the coin's.
- **Padding** 0.13 of the side: the bounding sphere is the flat corner, √(1 + 0.4375²) = 1.09 of
  the half length (a roll only brings points closer), plus 1.35 × the largest Wave amplitude (0.1).

**The caps.** **1,646 units, 2 reads** in five nodes, each under 1,024 units and 600 tokens; the
two Sheet nodes are the coin's split, one crossing each. Reads: the tile and the matcap.

**Where it played.** fx-spike `fx-page` step 12 (the real `/fx` page mounts it on its own page:
on, measured, the notes draw and move; 34/34); `particle-material-play.mjs --note` on WebGL2 and
WebGL1 against a release `apps/lines` build (`note` on at every sample, `note-plain` plain);
`shader-compile` links it through the particle shell on both.

**What it cost** (the coin's GPU and setup, 76 notes about 160 px long, `--coin` in the same run):

| | WebGL2 frame | WebGL1 frame |
|---|---|---|
| Same particles, flat (`note-plain`) | 2.9 ms median | 3.1 ms |
| The banknote | 4.6 ms | 4.1 ms |
| The coin, same run (flat) | 4.4 ms (2.9) | 4.1 ms (2.5) |

About 1.0–1.7 ms a frame for the shower, the coin's price (1.5–1.6 ms in the same run), though it
covers more pixels (2.36 M against 1.73 M): two reads against four, and a closed-form crossing plus
a short bracket against 24 march rounds. The meter reads 3,881 M, 121× the layer budget, no guide.

**How it looks** (real GPU, `/fx` and the game build): paper rolled along its length, curling and
uncurling, the inside of a curl darker than the outside, a wave running down it; Curl along Width
makes a gutter, Curl 0 with a full wave an S-bending sheet; front and back as it turns.
SwiftShader (the `/fx` gate) draws white shards over the notes, as it draws patches over the coins;
the real GPU does not.

**Limits, against §5's vertex stage.**
- **No sharp fold, crease or crumple:** one cylinder and a smooth wave is all one trace holds.
  Folds are a piecewise surface; crumple is a noise height too steep to bracket.
- **Grazing views:** where the wave meets the ray at a glancing angle the bracket can miss and the
  plain curl is drawn; a curl turned edge-on shows as a thin pale sliver, the paper having no
  thickness.
- **Dense confetti:** each particle pays for its whole padded quad (1.26² of the frame) and two
  crossings; hundreds of small sheets are cheaper as bent geometry. The vertex stage (§5, step 4)
  stays the path for folds, crumples and confetti; this spike is retired when it lands.
- As the coin and gem: the light turns with the particle's 2D spin, and overlapping notes have no
  depth between them (§9.2).
