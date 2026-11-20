# 2.5D rigs — 3D in the Rigger, 2D at render

> Status: **P1 built** (2026-11-20): the bake is `apps/launcher-api/src/lib/rig2p5d.ts`, bundled for
> the Rigger page as `static/rigger/vendor/rigger-2p5d.js` (not loaded yet; P3 wires it). The proof is
> the gate `tools/rigger-spike/rig-2p5d.mjs` (114 checks, in `check:all`), run on that module. Owner tool: Invisible Rigger
> (`/rigger`, agent `invisible-rigger`). Builds on: [rig-templates](rig-templates.md) (motion import
> §5.3, depth §5.4), [invisible-rigger](invisible-rigger.md), [irig-format](irig-format.md). Current
> state: [status/rigger](../status/rigger.md) (open item 21).

## 1. The ask

Motion imported from video looks flat (owner, 2026-11-20). A 2D rig turns a bone only in the
picture plane, so of a limb's three rotations it keeps one; #1802's depth cues (foreshortening, draw
order, parallax, image swaps) are each a separate trick keyed from one reading, and they barely show.
A 3D runtime was rejected as overkill for 2D games. The owner's words: _"the rigger have the 3D axis,
but the final renderer is always 2D … I do not want to introduce 3D [runtime] for a 3D game, that is
an overkill!"_

**The idea.** Bones carry a full 3D orientation and a depth **in the Rigger only**. Every clip is
**baked** into ordinary 4.2-format bone timelines — rotate, scale (non-uniform), shear, translate —
plus draw-order keys from depth and attachment keys for drawings by angle. `engine-rig` and the irig
data it reads do not change; a game cannot tell a baked clip from a hand-keyed one.

**Recommendation: build it**, in the five phases of §10. The spike shows the bake is exact to well
under a pixel through the real runtime, including a parent seen exactly edge-on, and every step of the
method is needed (§5). The cost is keys, not runtime: about 4 key frames per bone per second for
everyday motion, 20 for violent 3D motion with hinged limbs, 40 when joints leave their limb's plane
(§6).

## 2. What a 2D rig can show of a 3D pose

Every bone of the 3D rig carries a **card**: its art lies in its local x-y plane. Projected
orthographically (the camera looks down −z, depth is z toward the viewer), a card stays a
parallelogram, which is exactly what a 4.2 bone's world transform `[a b; c d]` + `(worldX, worldY)`
can draw. So **any 3D pose of a tree of cards is one 2D pose**; nothing is approximated at a sampled
time. What a card cannot do is show what it does not have: its back (it shows its front mirrored),
its side (it shows a sliver) and its volume. Drawings by angle (§4.7) cover those.

For a card that only rotates, the projection has a useful shape: its larger singular value is 1, and
its smaller one is |n_z|, the cosine of the angle between the card's normal and the view. **The
determinant is n_z**: positive facing the viewer, negative showing its back, zero edge-on.

## 3. Data — where the 3D pose lives

**Not in the irig.** `readIrig` refuses any field it does not know (irig-format §4.1), every runtime
release records the schema revision it reads (`IRIG_SCHEMA_REVISION = 3`), and a rollback below
`main`'s revision is refused (`runtime-pointer.mjs`). A 3D field in the irig would therefore need a
runtime release, raise the rollback floor, and ship 3D keys to every player who never reads them.
None of that buys anything: the game only needs the bake.

**A sidecar beside the `.irig`: `rig3d.json`**, like `template.json` (rig-templates §2) and
`source.json` / `text.json` (irig-format §4.1). Authoring-only: no game, export or runtime reads it,
so it is not an asset class under hard rule 8. It rides every save, backup and restore of its rig
(the same conditional write, in the same request; `pipeline-concurrency` reviews that path), and a rig
without one is a 2D rig, unchanged.

```jsonc
{
  "rig3d": 1,
  "tolerance": 0.45,              // rig units a baked card corner may miss its 3D pose by
  "floor": 0.35,                  // rig units the edge-on floor may move a card's own corner
  "hysteresis": 6,                // depth (rig units) two cards must differ by to swap draw order
  "turnaround": "side",           // or "full": chosen before the rig is drawn or animated (§4.7)
  "bones": {                      // setup, per bone that differs from a flat 2D bone
    "forearm":    { "depth": 0 },                     // z offset in the parent's frame
    "hand_image": { "follow": "hand" }                // drawn on `hand` in 3D, hangs from its 2D parent
  },
  "views": {                      // drawings by angle, per slot
    "hand": { "turnAxis": "y", "margin": 0.03, "hold": 0.1,
              "drawings": [ { "attachment": "hand_front", "turn": 0 },
                            { "attachment": "hand_3q_r", "turn": 45 },
                            { "attachment": "hand_side_r", "turn": 90 } ] }
  },
  "clips": {
    "reach": {
      "bones": {                  // 4.2 key shape: { time, value, curve }
        "upper_arm": { "orient": [ { "time": 0, "value": [ 1, 0, 0, 0 ], "curve": [ … ] }, … ],
                       "depth": [ … ], "translate": [ … ], "scale": [ … ] },
        "forearm":   { "rotate": [ … ] }                // a hinge: a plain 2D turn in its parent's plane
      },
      "baked": { "hash": "…", "at": "2026-…", "unmet": 0 }  // what the irig's clip was baked from
    }
  }
}
```

- **The setup pose is flat**: every card faces the viewer (tilt and twist 0) and may sit at a depth.
  So a rig's setup is the 2D setup it already has, and every 2D clip on it plays unchanged.
- **Orientation as quaternions** (owner, §11). Each `orient` key stores the bone's turn from its
  setup as a unit quaternion `[w, x, y, z]`; to the next key it is slerped along the shorter arc,
  its progress shaped by the key's 4.2 curve (stepped, or a bezier over the progress 0 → 1, sampled at
  9 points as engine-rig samples a timeline; an overshoot goes on past the next key along the same
  arc). No gimbal lock in storage or interpolation. A turn of more than 180° between two keys needs a
  key between them.
- **Angles are a view of the quaternion.** People key and read `rotate` about the view axis, `tilt`
  about the bone's own y (its tip toward the viewer, +) and `twist` about its length; the
  orientation is `Rz(rotate) · Ry(−tilt) · Rx(twist)`. `orientOf` builds a key from the three, and
  `anglesOf` reads a key back as the reading nearest the previous key's (so a tilt past 90° or a roll
  past 180° stays continuous in the graph editor; at tilt ±90°, where rotate and twist turn about one
  axis, it keeps the previous twist). For a limb they read as reach, swing and roll; for a head bone
  pointing up, twist is the turn and tilt the nod.
- **The other channels** are 4.2 keys meaning what 4.2 means: `translate` and `depth` offsets from
  the setup, `scale` a multiple of it. A bone that only turns in its parent's plane (a hinge) may key
  a plain 2D `rotate` instead of `orient` (never both). Before a channel's first key it is the
  setup's; a stepped key, or a first key after 0 off the setup, is a jump in the 3D pose, which the
  bake keys as a step (§4.3).
- **Per rig:** `tolerance` (0.45 rig units by default, set for the rig's largest on-screen scale),
  `floor` and `hysteresis`; an option given to the bake overrides them (the gate's mutations).
- **Turnaround, per rig and per template** (owner, §11): `side` stops at the side views (front, ¾,
  side), `full` turns all the way round on back drawings (§4.7). It is chosen before the rig is
  drawn or animated, not switched afterwards: the art and every clip's drawing keys depend on it. A
  rig with drawings by angle and no turnaround is refused.
- **Who owns the baked timelines.** In a clip with 3D keys, the bake writes the rotate / translate /
  scale / shear timelines of every bone it bakes, the draw-order timeline and the attachment keys of
  view slots, and nothing else (slot colours, deform, events, sequences, other bones pass through).
  `baked.hash` is the hash of what it wrote; when the irig's clip no longer matches it (someone keyed
  a baked bone in 2D), the Rigger says so and offers **re-bake** (3D wins) or **detach** (the clip
  becomes a plain 2D clip and leaves `clips`).

## 4. The bake

Built as `apps/launcher-api/src/lib/rig2p5d.ts` (pure: no DOM, no runtime import, so the gate plays
its output through the real engine-rig and its model of the runtime is itself tested). It exports
`bake2p5d(rig, clip, options)` (the baked animation, the 2D setup it keyed against, the report with
every unmet run, the drawings chosen and the draw order), `rig2p5dProblems(rig, clip)` (what the bake
refuses, for the save path), `pose3d(rig, clip, t)` (each bone's 3D world frame, for the authoring
view) and `orientOf` / `anglesOf` (angles to quaternion and back, for the graph editor).

### 4.1 Which bones

Every bone keyed in 3D in the clip (`orient` keys, or a slot with drawings by angle), every bone under
one, and every follower (it hangs from one bone and is drawn on another, which only
the bake can key) with everything under it. The rest keep their own 2D keys, written as they were. A
clip with no 3D keys bakes to itself (it is not touched; gated).

### 4.2 Projection, then local = inverse(parent as played) × own

For each baked bone, parents first, at each key time:

1. its **world** 3D frame (parent's world × its local: translate `(x, y, depth)`, then rotate), projected:
   `A = ` the top-left 2×2 of the world linear part, position = the world origin's x, y;
2. the **edge-on floor** (§4.3) applied to `A`;
3. its 2D local = **inverse(the parent's 2D world as the runtime will play it) × its own target**.

Step 3 is why children never drift: at its key times a bone is exactly on its target whatever its
parent's keys left. It is also why the bake must model the runtime: the parent "as played" is its
**stored** keys (7 significant digits in the file, float32 in engine-rig's `Float32Array` frames),
linearly interpolated, composed exactly as `Bone.updateWorldTransformWith` does under
`Inherit.Normal`.

**Inherit.Normal, shearX = 0.** The local 2×2 `M` maps onto 4.2's channels as: `rotate = atan2(M.c, M.a)`,
`scaleX = |M col 1|`, `scaleY = |M col 2|`, `shearY = atan2(M.d, M.b) − rotate − 90°`. With
shearX left at 0 the two columns are any two vectors, so every 2×2 (mirrors included) is reachable.
Angles are unwrapped against the previous key, so a roll keeps counting past 360°. `Normal` (not
`OnlyTranslation`, which would avoid every inverse below) because it is the setup inherit of every
existing rig: an `inherit` timeline would revert to the setup inherit the moment a crossfade starts
(`InheritTimeline.apply` on mix-out), and a 2D track layered on an ancestor would no longer carry the
baked bones. Under `Normal` a crossfade blends locals continuously and a layered ancestor rotation
carries the whole arm.

Projecting each bone's **local** transform instead (the obvious shortcut) is wrong: projection does
not commute with composition once a parent leaves the picture plane. Measured: 97 units off.

### 4.3 A card seen edge-on

When a parent is edge-on its `A` is singular and step 3 has no inverse. **The floor:** the smaller
singular value is held at ≥ `f` × the larger, keeping the determinant's sign, with
`f = floor / the card's extent` (the farthest card corner from its origin). The change is along the
thin direction only, so the card's own corners move by at most `floor` rig units (0.35 by default),
its descendants stay exact (they are keyed against the floored parent), and the floored card draws as a
sliver at most a third of a pixel wide instead of vanishing.

**Turning through edge-on is a step.** The sign of the determinant flips, so the floored `A` jumps
from `+f` to `−f`, and so does every child's local. Each flip is found to 1 ns (bisection on the
determinant) and keyed as **two keys at one time**: engine-rig's `Timeline.search` takes the last key
at or before `t`, so the pair is a clean jump and the zero-length run between them is never
interpolated. A bone takes steps at its own flips, its drawing swaps (§4.7), every jump of a 3D
channel on it or on anything it is drawn from (§3), and every step of its parent's. Steps closer than
their two limits can be read apart (2 µs, or the file's float32 time resolution) are one step. Since
nothing is interpolated across a step, the run after it starts on the **angle branch nearest the
setup**: shearY, which a crossfade mixes linearly, then stays within a turn (§7).

**Children of a thin parent are expensive.** A child's local is `A_parent⁻¹ · A_child`, so near
edge-on its values grow like 1 / σ2 of the parent. Interpolating `1/σ` linearly between two keys
misses by `g (r − 1)² / 4r`, where `g` is how far the child reaches out of the parent's card plane
and `r` the ratio of σ at the two keys; within 0.45 units at `g` ≈ 100 needs `r` ≤ 1.13, so keys
come geometrically: about `2 ln(1/f) / ln r` ≈ 90 per child per edge-on moment. The spike measured
30–140. Two consequences:

- **A child coplanar with its parent costs nothing.** If a child's 3D local is only an in-plane
  rotation and translation, its projected local equals its 2D local outside the floor's few
  milliseconds, so it needs no keys for its parent's turns. This is why limbs should be **hinged**:
  the elbow and knee bend about the card normal, and the upper limb's twist sets the plane of the
  bend (which is also how a 2-bone arm is solved, §8). Measured: half the keys (§6).
- **An image bone hangs from a steady bone** (§4.7), not from the bone that turns.

### 4.4 Dense bake, then reduction

Interpolating 2D keys is not interpolating 3D, so the bake keys densely (120 Hz, plus each step's
two keys), then reduces: **Douglas–Peucker on the world error** of the card's four corners (the
largest distance between where the runtime will draw them and where the 3D pose projects them),
within `tolerance` (0.45), then refines wherever even the dense keys miss (a key at the worst point,
recursively, at most as many new keys as the dense bake had; past that, or where the file's float32
times cannot place a key between two, the run is **reported** as unmet, never silently kept). A run's
inner keys lie strictly between its two limit samples: P1 found a stepped key on the dense grid
otherwise filed a key read after the step before it. Three things the spike found the measuring
needs:

- **The check set inherits.** Between its own keys a child's error includes its parent's
  interpolation error, which peaks between the parent's keys, not the child's. Each bone's check
  points are the 480 Hz grid, its parent's check points, the parent's key times and the middle of
  each of the parent's key runs, plus quarter points of every run it keeps.
- **It adapts to thinness.** Wherever the card or its parent **as played** thins by more than 10 %
  between neighbouring check points, the interval is subdivided (to 1 µs): the 1/σ growth is
  invisible on a fixed grid. Thinness as played, because between its keys a parent is not floored.
- **A parent's run is refused if, as played, it thins below half its floor or turns to its other
  side** between keys: its children would need locals past any bound there.

Checks inside a step (between its time and the float32 time the file holds it at) are not counted:
there the runtime shows one side and the 3D pose the other, whatever the keys.

Per-bone key times, not one set shared by the chain: a shared set costs every bone every other
bone's edge-on moments (measured on an earlier iteration of the spike: 13,226 timeline keys against
4,635 per bone).

### 4.5 Draw order from depth

Each slot's depth is its card centre's z, taken from the bone the clip moves (before any drawing is
turned to face). On the dense grid, adjacent slots swap only when the one behind is nearer by more
than the **hysteresis** (6 rig units): bubble passes until none does. So any two slots are never out
of depth order by more than the hysteresis times how many places apart they are, and cards closer than
that (eyes on a face, a sleeve on an arm) keep the authored setup order. A change writes one
draw-order key with every moved slot's offset (well-formed: every slot once; the hazard of status
open item 20 cannot arise). Measured: an arm wobbling ±3 units across the torso's depth goes behind
and comes back once each way; without the hysteresis it swaps 29 times.

### 4.6 Weighted meshes and constraints

Linear-blend skinning commutes with an orthographic projection (both are linear), and each influence's
vertex lies in its bone's card plane (z = 0), so a weighted mesh across baked bones projects exactly as
its 3D skin would. Gated: a sleeve weighted across the elbow stays within 0.41 rig units of its 3D
skin on every clip (each influence's point inside its bone's card, so the cards' corner error bounds
it).

IK, transform, path and physics constraints write world transforms after the timelines and would
overwrite the bake: a bone a 3D clip bakes, and every bone it hangs from (whose played pose it was
keyed against), must carry no constraint at a non-zero mix during it — its setup mix, or any mix key
in the clip. `rig2p5dProblems` refuses it, and so does the bake (the templates already have no IK,
rig-templates §3.4).

### 4.7 Drawings by angle

A slot may list drawings, each made for one turn of its card (`turn` about the card's y: front 0°,
¾ 45°, side 90°, and the mirrored ones). The bake shows the drawing that **faces the viewer best**:
the one whose card, turned back by its own angle, has the largest n_z; it swaps only when another
beats the current by `margin` (0.03 in n_z) and the current has been held `hold` (0.1 s). The drawing
sits on an **image bone** whose 3D frame is the turning bone's turned back by the drawing's angle, so
at its own angle a drawing faces the viewer square (measured σ2/σ1 = 0.9987 at 45°; it would be 0.71
without the turn-back) and in between it turns with the bone. The swap is a step for the image bone.

The image bone **hangs from a steady bone in 2D** (the chest) and **follows** the turning bone in 3D:
it is placed on it, but keyed against the chest. Hung from the hand, every time the hand went
edge-on — exactly when a side drawing shows — its locals blew up (§4.3).

**The turnaround** decides what shows past the side view. On a **side** turnaround the drawings stop
at ±90° and a drawing may also face the viewer from behind: the score is |n_z| (its front preferred
on a tie), so a card turned past 90° shows a front-half drawing **mirrored**, as a card's back is —
at 135° the other side's ¾, at 180° the front — square to the viewer. On a **full** turnaround the
drawings include back ones (¾ back at ±135°, back at 180°) and the score is n_z itself, so the back
drawings show, unmirrored. The validator refuses a back drawing on a side turnaround and a full one
without back drawings. Gated both ways (`turn-side`, `turn-full`).

What a card still cannot show without art: its **volume** (a turning card narrows like paper; a ¾
drawing is what gives it depth).

## 5. The proof — `tools/rigger-spike/rig-2p5d.mjs`

The gate bundles `rig2p5d.ts` with esbuild and runs on it, so it proves the shipped module, not a
copy. A chest, an upper arm, a forearm, a hand and the hand's image bone (drawings by angle), with a
sleeve mesh weighted across the elbow, keyed in 3D with quaternion `orient` keys: the chest turns
±15°; the arm reaches toward the camera, is **held exactly edge-on** (its card's normal in the
picture plane, projected determinant ~1e-17), swings round through edge-on and behind the body with a
depth wobble across the torso, then rolls a full turn about its length (edge-on at 90° and 270°);
then the hand turns 45° (held), 90° and −50° on a still arm. Seven clips:

| Clip          | What                                                                                           | Edge-on crossings | Max error | Key frames / bone / s | Timeline keys | Clip JSON (gzip)       | Bake   |
| ------------- | ---------------------------------------------------------------------------------------------- | ----------------- | --------- | --------------------- | ------------- | ---------------------- | ------ |
| **crossed**   | elbow and wrist leave the upper arm's plane (stress case)                                      | 14                | 0.449     | 39.4                  | 3,591         | 142 KB (36 KB) /4.6 s  | 160 ms |
| **hinged**    | the same motion, the elbow a 2D `rotate` hinge in the arm's plane                              | 14                | 0.533     | 19.5                  | 1,763         | 69 KB (17 KB) /4.6 s   | 104 ms |
| **calm**      | a sway and a lift toward the camera, a small hand turn, nothing edge-on                        | 0                 | 0.434     | 3.6                   | 274           | 11 KB (2.7 KB) /4 s    | 46 ms  |
| **stretch**   | in-plane 3D scale (non-uniform), translate and depth keys under a walking 2D root; a 400° spin | 2                 | 0.445     | 10.1                  | 611           | 24 KB (6.1 KB) /3 s    | 48 ms  |
| **curves**    | eased and overshooting orientation keys, a stepped one, a late first key, bezier channels      | 10                | 0.466     | 35.0                  | 2,083         | 82 KB (21 KB) /3 s     | 96 ms  |
| **turn-side** | the hand turns to 135° and 180° on a side turnaround                                           | 2                 | 0.447     | 3.2                   | 115           | 4.1 KB (0.7 KB) /2.4 s | 11 ms  |
| **turn-full** | the same on a full turnaround                                                                  | 1                 | 0.447     | 3.2                   | 70            | 2.6 KB (0.5 KB) /2.4 s | 11 ms  |

Each baked rig is read by the strict irig reader, then loaded and played by the real engine-rig
(`SkeletonJson` → `Skeleton` → `AnimationState`, as `RigView` plays it). At every 1 ms, at ±10 µs to
±4 ms around every edge-on crossing and every stepped key, and at the clip's end, every card's four
corners are compared with the orthographic projection of the 3D pose, computed in the gate
independently of the bake: its own matrices and slerp, its own quaternions of the clips' angles, and
each key run's progress and every other channel sampled by engine-rig's own timelines (a skeleton
with one bone per channel). **The largest miss anywhere is 0.53 rig units** (1 px at scale 1), floor
included; the bound asserted is 1. The sleeve's skinned vertices stay within 0.41 of its projected 3D
skin. Also asserted: only 4.2 timelines are written; engine-rig draws the bake's draw order and it
follows depth past the hysteresis; the arm goes behind the torso and back once each way despite the
wobble; engine-rig shows the drawing the bake chose, ¾ at 45° (unsquashed), side at 90°, the other
¾ at −50°, no swap within 50 ms of another; past the side view a side turnaround shows the other
side's ¾ (135°) and the front (180°) mirrored, a full one its ¾-back and back drawings unmirrored, all
square to the viewer; every run met the tolerance; the key budget per clip; a rig tolerance of 0.15
bakes calm within 0.123 (6.2 key frames / bone / s) and an option overrides it; the non-uniform scale
and the root's 2D keys reach the file as written; `pose3d` matches the gate's sampling of the curves
clip within 0.001 units; the stepped orientation key is two keys at one time on the arm and
everything under it; every baked angle ends in (−180°, 180°]; `orientOf` is the design's
`Rz · Ry(−tilt) · Rx`, and `anglesOf` reads keys back nearest the previous one (tilt 105°, twist 270°
and 400°), keeps the twist at gimbal lock, and round-trips 200 random orientations; a clip with no 3D
keys bakes to itself; the validator refuses a constraint at a non-zero mix on a baked bone or a bone
one hangs from (not at mix 0, not keyed to 0, not on an unbaked bone), drawings by angle before the
turnaround is chosen, a back drawing on a side turnaround, a full one with no back drawings, a bone
keyed by both `orient` and `rotate`, and a tolerance of 0, and the bake refuses what it refuses; a
crossfade (AnimationState, 0.25 s) from the reach's end or its middle to the calm clip is continuous
(a step ten times finer moves a corner a tenth as far) and turns no card more than 2.6° beyond the
two poses' difference.

**Mutations**, each must fail and does:

| Mutation                                       | Result                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| no shear (rotate + scale only)                 | 575 units off                                                                                         |
| project each bone's local transform, not world | 97 units off                                                                                          |
| key only at the 3D keys (no dense bake)        | 6,973 units off                                                                                       |
| no key reduction                               | within tolerance, but 137 key frames / bone / s (budget 45)                                           |
| no floor                                       | 73,335 units off                                                                                      |
| no step at a flip                              | 5 × 10⁸ units off                                                                                     |
| no draw-order hysteresis                       | the arm swaps behind / in front 4 times instead of 2                                                  |
| no angle wrap (§4.3, §7)                       | crossfades spin 713° (from the end) and 363° (from the middle); the stretch clip's chest ends at 400° |

The first seven run on the crossed arm and reproduce the spike's own figures: quaternion keys
interpolate as the spike did. Earlier iterations measured two more choices (no longer switches in the
bake): keying a child against its parent's **exact** pose instead of the played one drifted 125 units
near edge-on; one shared key set for the chain cost 2.9× the timeline keys (§4.4).

**Not covered:** a rig read from a real irig and its sidecar (P2), and real footage (P4).

## 6. Cost

- **Runtime: nothing new.** The same timelines engine-rig plays today; no reader, schema or release
  change; `scripts/check-rig-runtime-free.mjs` and the rig parity gates are untouched. More keys cost
  only the key lookup: engine-rig's `Timeline.search` scans keys linearly, so a frame costs up to
  the key count per timeline; at the crossed clip's density (~4 timelines × 300 keys per bone) that
  is about 1,200 comparisons per bone per frame, microseconds. A binary search would be a runtime
  change and is not needed.
- **Keys.** Everyday 3D motion: ~4 key frames per bone per second (calm, 3.6; with scale, translate
  and a spin, 10.1; at a tolerance of 0.15, 6.2). Violent 3D motion, many edge-on moments, hinged
  limbs: ~20. Joints leaving their limb's plane: 35–40, almost all of it in the milliseconds around
  each edge-on moment (30–140 key frames per child per moment, §4.3). A key frame
  is up to four timeline keys (rotate, translate, scale, shear; a constant channel is dropped).
- **File size.** ~2.8 KB per second of clip (0.7 KB gzipped) for calm motion over five bones;
  ~15 KB/s (3.7 KB gzipped) for the hinged stress clip. A 5 s idle on a 20-bone character: ~55 KB
  JSON, ~14 KB gzipped. Bezier fitting (P6) is the lever if that matters.
- **Bake time.** 11–160 ms per clip in Node for the seven clips (single thread); live while keying
  in the Rigger, and again on save. The page bundle is about 21 KB (9 KB gzipped).
- **Limits.** No backface without art (§4.7); cards are flat (a card turning to edge-on is a
  sliver, which a drawing by angle should replace before it gets there); orthographic only (no
  perspective: the near hand is not drawn larger — the approach channel of rig-templates §5.4 stays
  a separate root scale); crossfades and layered tracks are 2D (§7).

## 7. Risks

- **Crossfades between two baked clips** blend 2D locals, not 3D poses: continuous, plausible for
  the usual 0.1–0.3 s, not exact. `shearY` mixes linearly (rotation takes the short way round), so
  two clips whose shear differs by ~360° would spin a card during the mix. Built in P1: every run
  between steps starts on the angle branch nearest the setup (free: nothing is interpolated across a
  step), and each clip ends with an invisible ±360° step (two keys at one time) that brings every
  angle back into (−180°, 180°]. Measured through AnimationState over 0.25 s: from the reach's end
  and from its middle, continuous and no card turns more than 2.6° beyond the two poses' difference;
  without the wrap, 713° and 363°. **Not continuous: a crossfade that starts within milliseconds of
  an edge-on step of the clip it leaves** — near the floor a child's locals are huge (§4.3) and the
  mix blends them: measured from 50 ms before the reach turns edge-on, a corner jumps 56 units and a
  card turns 198°. A drawing swap in the clip being left also jumps its image bone during the mix
  (2.8 units). The owner's answer (§11): the 2D blend stays the default, and a **baked transition
  clip** is an opt-in (P7) for a transition that must cross an edge-on moment.
- **A 2D track layered over a baked clip** acts in 2D: on an ancestor it carries the arm rigidly
  (fine for a lean or a breath), on a baked bone it offsets the projected pose.
- **The sidecar and the irig drift apart** if a 2D edit lands on a baked clip: the hash catches it
  (§3); the save path writes both or neither.
- **Tolerance is in rig units.** A rig shown at 2× in a game shows twice the error; the rig's
  `tolerance` is set for its largest on-screen scale.
- **Tracker noise in 3D** (P4): MediaPipe's world depth jitters (rig-templates §5.4 measured 0.4–2.6 cm
  on a wrist), and a jittering card near edge-on costs keys; smooth the 3D orientation before the
  bake (the One-Euro filter already used, on the bone directions).

## 8. Motion import in 3D (replaces #1802's depth tricks)

Today's solver (`src/lib/rigMotion.ts`) turns each bone to lie along its two points **in the
picture** and adds depth as separate tricks: `foreshorten` (scale along the limb), `depth` (draw
order), `turn` (torso swaps and width), head `yaw` / `pitch` (a slide inside the head). With a 3D rig,
the import instead solves **each bone's 3D orientation** and the bake does the rest:

- **Limbs, from Pose Landmarker's world points** (metres, hips origin; flip y and z into the rig's
  frame). The upper limb's direction is shoulder → elbow; its **twist** puts the elbow's bend in its
  card plane (the plane of shoulder, elbow and wrist, oriented toward the viewer, held from the last
  frame when the arm is straight); the forearm is then **one hinge angle** in that plane. Thighs and
  shins the same with hip, knee, ankle. The local orientation is inverse(parent world) × world,
  keyed as an `orient` quaternion (the forearm and shin as a 2D `rotate` hinge).
- **Hands, from Hand Landmarker's world points**: the hand's frame from wrist → middle knuckle and
  the palm's normal (index and pinky knuckles), so a hand turning toward or away from the camera is a
  3D turn that picks its drawing by angle (§4.7). Finger curl stays as it is (§5.3: already read in 3D).
- **Head, from Face Landmarker's transformation matrix**: the full rotation directly, as the head
  bone's `orient` quaternion. Face parts sit at depths inside the head (nose in front, back hair behind),
  so the slide of rig-templates §5.4 becomes ordinary parallax of cards at depth.
- **Torso**: the shoulder and hip lines give the chest's and hips' turn; the torso's ¾ and side
  drawings become its drawings by angle.

What becomes a special case of the bake: **foreshortening** is the projected length of a turned card
(`|A e1|`, exactly the T10 reading); **front / behind** is draw order from depth; **head turn and
nod** are the head's 3D orientation with parallax from depth; **body turn** is the torso's drawings by
angle. Only **nearer / further** (the root's scale) stays, because orthographic projection has no
perspective. The template's motion map shrinks to one `bone3d` entry per bone (which points span it,
and for a hinge which point sets its plane).

Smoothing moves to the 3D pose (the One-Euro filter on bone directions, before the bake); key
reduction moves to the bake (a pixel tolerance instead of the 2 % of a channel's range).

## 9. Authoring — what the Rigger shows

- **🧊 3D, per rig, off by default.** Turning it on asks for the rig's turnaround (side or full; a
  template's own), which is then fixed, and writes `rig3d.json`; the setup stays as it is (flat,
  every depth 0) and every existing clip stays a 2D clip. Turning it off keeps the baked clips as
  plain 2D clips. The rig's tolerance is a field beside it.
- **Per bone:** Tilt, Twist and Depth fields beside Rotate in the bone panel, keyable like Rotate;
  on the canvas, the rotate gizmo gains two rings (tilt and twist) and a depth handle seen in the side
  view.
- **Turn the view.** A view slider (−90° … 90° about the vertical) re-bakes the current pose for a
  turned camera and draws it through the same engine-rig: an authoring view to set depths, see
  edge-on cards and place drawings by angle. A side view for depth.
- **Dopesheet.** A 3D clip shows each bone's orientation keys as rotate / tilt / twist tracks read
  from the quaternions (`anglesOf`), and its depth track; editing an angle at a key rewrites that
  key's quaternion (`orientOf`), and the key's curve is the slerp's progress; the baked 2D tracks are hidden and locked, with **Detach** to
  turn the clip into a plain 2D clip. The bake runs on each edit (tens of milliseconds for a short
  clip) and on save; an unmet run is listed with its time and bone.
- **Drawings by angle**, per slot: the drawings, their turn, margin and hold; a missing drawing falls
  back toward the front one, as swap controls do today.
- **Clip conversion.** **3D from this clip** keeps a 2D clip's keys as they are (a 2D `rotate` is a 3D
  clip channel) — which bakes back to the same clip — and the author adds the out-of-plane turns: a
  bone's first one converts its `rotate` keys to `orient` keys, with a key added inside any run that
  turns more than 180°.
- **Transitions** (opt-in, P7): **Bake transition** from one 3D clip (at its end, or a time) to
  another over a duration, as a clip of its own.

## 10. Build plan

| Phase                                 | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Size             | Needs  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------ |
| **P1 — the bake** ✅ built 2026-11-20 | The spike ported to a pure TS module (`apps/launcher-api/src/lib/rig2p5d.ts`: `bake2p5d`, `rig2p5dProblems`, `pose3d`, `orientOf` / `anglesOf`), bundled for the page as `static/rigger/vendor/rigger-2p5d.js` (`check:vendored-bundles`). Quaternion `orient` keys, the per-rig tolerance / floor / hysteresis, the turnaround (side / full) in the drawing choice and the validator, the angle wrap and the constraint validator. The gate runs on the module (§5). | S–M (1 session)  | —      |
| **P2 — the sidecar**                  | `rig3d.json`: schema (`tolerance`, `floor`, `hysteresis`, `turnaround` — fixed once set — bones, views, clips with `orient` quaternion keys), read / write with the irig in the same conditional save, backups and restore, Director's rig ops, the hash and the 2D-edit detection, `rig2p5dProblems` on save, and writing the follower setup the bake derives. `check:rigger-writes` cases; `pipeline-concurrency` reviews.                                          | M (1 session)    | P1     |
| **P3 — authoring**                    | §9: the 3D switch with the turnaround choice (fixed after) and the tolerance field, fields and gizmo rings, 3D dopesheet tracks as angles derived from the quaternions (`anglesOf` / `orientOf`; the graph editor edits those), live bake, locked baked tracks and Detach, turn-the-view and side view, the clip conversion.                                                                                                                                          | L (2–3 sessions) | P2     |
| **P4 — motion import in 3D**          | §8: the solver's 3D orientations (pose world, hand world, face matrix) written as `orient` quaternions, hinged limbs as 2D `rotate`, the `bone3d` motion entry, new template versions (Full body v3, Half body v3, Bust with face v4) with cards, depths, hinges, parts at depth and their turnaround. Re-measured on the T10 footage; `motion-depth` / `motion-solve` move on.                                                                                       | L (2 sessions)   | P2     |
| **P5 — drawings by angle**            | The views panel, image bones with `follow`, honouring the rig's turnaround: template parts for ¾ / side drawings, plus ¾-back and back ones on a full turnaround, and the art blueprint (T6) asking for exactly those.                                                                                                                                                                                                                                                | M (1 session)    | P3, P4 |
| **P6 — size**                         | Bezier key fitting in the reduction. (The end-of-clip angle step moved into P1, the tolerance field into P3.)                                                                                                                                                                                                                                                                                                                                                         | S–M (1 session)  | P1     |
| **P7 — baked transitions**            | Opt-in (owner, §11): a transition clip from clip A (at its end, or a time) to clip B over a duration, each bone slerped from A's 3D pose to B's (other channels blended), baked like any clip and played between them; the 2D crossfade stays the default.                                                                                                                                                                                                            | S–M (1 session)  | P3     |

Order: P1 → P2, then **P4 before P3**, because the owner's complaint is imported motion and P4 shows
it on the same footage with the existing 🎥 Motion row (it needs only the bake and the sidecar, not
the editing UI); then P3, P5, P6, P7. P3 and P4 both touch `view.html`, so they run one after the other,
not in parallel. Each phase is a pipeline change on its own branch and touches no game: the runtime
does not change, and a rig without `rig3d.json` is untouched.

## 11. Decisions (owner, 2026-11-20)

1. **Tolerance:** 0.45 rig units by default, settable per rig (for its largest on-screen scale).
   Built in P1 (`Rig3d.tolerance`, with `floor` and `hysteresis`); the field is P3.
2. **Turnaround:** both — stopping at side (front / ¾ / side) or a full turnaround with back
   drawings — chosen per template / rig **before** the rig is built or animated, never switched
   afterwards. In the rig's 3D data and the template; the bake and the drawing swaps honour it
   (§4.7). Built in P1 as data the bake accepts; P2 stores and fixes it, P3 asks for it, P4 / P5 put
   it in the templates and their art.
3. **Crossfades:** optional. 2D blends of the baked keys by default; baked transition clips as an
   opt-in (P7).
4. **Rotation storage:** quaternions from the start; the graph editor edits angles derived from them
   (§3). Built in P1 (`orient` keys, `orientOf` / `anglesOf`); the editor is P3.
