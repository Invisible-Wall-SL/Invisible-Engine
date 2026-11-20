# 2.5D rigs — 3D in the Rigger, 2D at render

> Status: **P1, P2 and P6 built** (2026-11-20). P1 / P6: the bake is
> `apps/launcher-api/src/lib/rig2p5d.ts`, its reduction fitting 4.2 bezier runs per timeline (P6),
> bundled for the Rigger page as `static/rigger/vendor/rigger-2p5d.js` (not loaded yet; P3 wires
> it); the proof is the gate `tools/rigger-spike/rig-2p5d.mjs` (127 checks, in `check:all`), run on
> that module. P2: the sidecar `rig3d.json` (`src/lib/rig3d.ts`), saved with the irig by every save
> (`src/lib/server/rigger3d.ts`, §3.1); gated by `check:rig3d` and `check:rigger-writes`. Owner tool: Invisible Rigger
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
method is needed (§5). The cost is keys, not runtime: with bezier runs (P6) about 2 key frames per
bone per second for everyday motion, 8 for violent 3D motion with hinged limbs, 13–16 when joints
leave their limb's plane (§6).

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
  "rig": "hero",                  // the stem of the `.irig` in this folder it belongs to
  "irig": "…",                    // written by the save: the hash of the `.irig` text it pairs with
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
      "duration": 4.6,            // optional: at least this long, else as long as its last key
      "bones": {                  // 4.2 key shape: { time, value, curve }
        "upper_arm": { "orient": [ { "time": 0, "value": [ 1, 0, 0, 0 ], "curve": [ … ] }, … ],
                       "depth": [ … ], "translate": [ … ], "scale": [ … ] },
        "forearm":   { "rotate": [ … ] }                // a hinge: a plain 2D turn in its parent's plane
      },
      "baked": {                  // written by the save, never by a client (§3.1)
        "hash": "…", "earlier": [ "…" ],                // what it wrote into the irig's clip, and before
        "input": "…",                                    // the rig and clip it baked, hashed
        "at": "2026-…", "unmet": 0,
        "bones": [ "chest", "upper_arm", … ], "slots": [ "hand" ]   // what of the clip it owns
      }
    }
  }
}
```

The schema is strict, as `readIrig` is: an unknown field or a wrong type refuses the file
(`rig3dDocProblems`), and every name it uses must exist in the irig beside it (`rig3dIrigProblems`).
One sidecar per folder: a 2D save of another rig in the folder leaves it alone, and a 3D save of one
it does not name is refused.

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
- **Who owns the baked timelines.** In a clip with 3D keys, the bake writes every timeline of every
  bone it bakes and of every bone the sidecar keys, the draw-order timeline and the attachment keys
  of view slots, and each follower's 2D setup; nothing else (slot colours, deform, events, sequences,
  other bones pass through). Its input is the sidecar's keys plus the irig's own 2D keys on the bones
  the baked ones hang from — never the irig's keys on a bone the bake owns, which are its last output.
  `baked.hash` is the hash of what it wrote; when the irig's clip no longer matches it (someone keyed
  a baked bone in 2D), the save refuses and the client offers **re-bake** (3D wins) or **detach** (the
  clip becomes a plain 2D clip and leaves `clips`) — §3.1.

### 3.1 Saved with the irig (P2)

Every write of a rig's `.irig` goes through `saveRig` (`src/lib/server/rigger3d.ts`): the Rigger's
save, Director's rebind, and — through the same `writeIrig` — a restore. A rig whose folder holds no
`rig3d.json` naming it saves exactly as before.

- **One request, two conditional writes.** The sidecar first (under the ETag it was read at), then
  the `.irig` (under the client's `baseEtag`). If the `.irig` loses its race, the sidecar is put back
  as it was read (or removed, if this save created it), only over the version this save wrote — and
  not at all when R2 named no version to check. Removing a sidecar (a restore from before the rig had
  one, a left-over one) is checked first and done only after the `.irig` lands, and not over one
  written since: R2 has no conditional delete, so a delete put back after a lost race could land
  over someone else's. A stale `.irig` or sidecar ETag is refused before anything is written or
  baked. A write whose answer was lost but whose bytes are there (the SDK's retry then meets its own
  write as a 412) counts as written, never undone.
- **The pair is marked.** Every sidecar a write stores carries `irig`, a hash of the `.irig` text
  written with it, so the sidecar is rewritten with every `.irig` write that changes the text (it is
  the pair's lock) and a torn pair is read, not guessed: a sidecar whose mark is of another `.irig`
  (a save landing right now, or one cut off between its two writes) refuses every save
  (`409 rig3d-torn`) until that save lands or a version is restored from 🕘 History, which writes a
  marked pair.
- **Bakes what is stale.** A 3D clip is baked when its input (the bake's rig and clip, hashed) or its
  owned parts no longer match `baked`; otherwise its stored bake stands (a save that changed nothing
  3D bakes nothing). The bake's refusals (`rig2p5dProblems`, the sidecar not fitting the irig, a bone
  the baked ones hang from keying `shear` / `inherit` / split channels in 2D) refuse the save.
- **A 2D edit of a baked part is refused** (`409 baked-edited`, naming the clip and what changed: bones,
  `draw order`, slots, a follower's setup, or the whole clip when it was deleted or renamed), because
  the next bake would silently undo it. The save says per clip what to do instead, in `resolve`:
  `rebake` or `detach`. Parts matching an **earlier** bake (`baked.earlier`, the last 8) are not an
  edit: they are a tab still holding the bake from before its own save re-baked the clip (it changed
  a setup the bake reads), and the save re-bakes over them.
- **Today's 2D Rigger** sends neither `rig3d` nor `resolve`: it keeps the stored sidecar, so it can
  edit anything the bake does not own (2D clips, slot colours, events, setups the bake re-keys) and is
  refused, with what changed, when it edits a 3D clip's baked parts or deletes or renames one — until
  P3 hides and locks those tracks.
- **The turnaround is fixed** once set (`422 turnaround-fixed`).
- **Backups and restore.** A backup keeps the rig's sidecar as the save read it, under the same id
  (`<id>.rig3d.json`, written before the `.irig` copy, which is taken only while it is the version
  checked), listed as `rig3d: true`; retention drops both. A restore puts back the pair as it was
  then: a backup from before the rig had 3D data removes the current sidecar (which the restore's own
  backup keeps); it never writes its 3D data over another rig's.
- **Delete** of `<stem>.irig` deletes the sidecar naming it first; deleting the artist's source `.json`
  or another rig in the folder leaves it. The skeleton index and the bundle purge never take it for a
  skeleton (`isBundleSidecar`), and promoting a bundle to the shared library leaves it with the
  authoring project (the snapshot plays the baked `.irig`).
- **The contract a 3D client (P3, P4) uses.** `GET /api/rigger/save` answers `rig3d: { etag, doc }`
  (or `{ etag, problems }`, and `torn: true` for a torn pair) beside the `.irig`'s `etag`. `POST` takes `rig3d` (the whole sidecar; its
  `rig` is set to the stem and its `baked` records are ignored) with `rig3dBaseEtag`, and `resolve`;
  it answers `rig3dEtag`, `rebaked`, `detached` and `unmet` (runs past the tolerance, per clip and
  bone). A clip the client leaves out of `rig3d` is detached; a 3D client that re-keys a clip it
  has in 2D sends `resolve: rebake` for it.

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

### 4.4 Reduction: bezier runs, each timeline its own keys

Interpolating 2D keys is not interpolating 3D, so the bake knows the target densely — at every check
point below, the local that puts the bone on its target under its parent as played — and keys as few
of those points as hold the **world error** of the card's four corners (the largest distance between
where the runtime will draw them and where the 3D pose projects them) within `tolerance` (0.45):

1. **The longest bezier runs** (P6). Between two steps, from each key the next is the furthest point
   whose run to it holds the tolerance (galloping out from the last run's length, then bisecting
   back). A run is a 4.2 bezier per channel, time handles at thirds, value handles fitted by least
   squares to the points between **as engine-rig plays a bezier**: nine float32 samples from the
   handles as the file stores them (7 significant digits), linear between, so the fit is linear in
   the two value handles and the bake's model of a run is the runtime's own. A timeline whose straight
   run holds as well drops its curve (a smaller file). Keys sit on the points' float32 times, strictly
   between a run's two limit samples: P1 found a stepped key on the dense grid otherwise filed a key
   read after the step before it.
2. **Refinement** (P1's). Where a run still misses at fresh points — its quarters, and its curve's
   samples, where the played curve kinks — the worst point is keyed and both halves fitted again, at
   most as many new keys as a 120 Hz dense bake would have; past that, or where the file's float32
   times cannot place a key between two, the run is **reported** as unmet, never silently kept.
3. **Each timeline its own keys** (P6). Rotate, translate, scale and shearY are separate 4.2
   timelines; one by one, from each key the next is the furthest key whose run, fitted again for
   that timeline alone, holds the tolerance with the others as they are. Steps stay on every timeline.

The error is measured against **the 3D pose itself**, not the floored target the keys are put on, so
the floor and the reduction together miss it by at most the tolerance; only where the floor alone
moves a card further than that (a rig whose tolerance is below its floor) against the floored target,
the best any key can do. Four things the measuring needs:

- **The check set inherits.** Between its own keys a child's error includes its parent's
  interpolation error, which peaks between the parent's keys, not the child's. Each bone's check
  points are the 480 Hz grid, its parent's check points, the parent's key times, the middle of each
  of the parent's key runs and its curves' samples.
- **It adapts to thinness.** Wherever the card or its parent **as played** thins by more than 10 %
  between neighbouring check points, the interval is subdivided (to 1 µs): the 1/σ growth is
  invisible on a fixed grid. Thinness as played, because between its keys a parent is not floored.
- **Where it is thin, the error between checks is bisected.** That check set is as fine as the target
  needs, not as fine as the error of one timeline's long run beside another's short ones, which
  peaked between two checks (0.62 units, measured) until each such gap is bisected wherever its
  error bulges.
- **A parent's run is refused if, as played, it thins below half its floor or turns to its other
  side** between keys: its children would need locals past any bound there.

Checks inside a step (between its time and the float32 time the file holds it at) are not counted:
there the runtime shows one side and the 3D pose the other, whatever the keys.

Measured and not taken: time handles crowding a run's start or end (for a value that changes fastest
there) saved no keys, and on a parent near edge-on they made its played pose turn faster than its
target — its child, whose locals grow like 1 / σ, then could not be followed within the file's
float32 time resolution (2.7 units off). Handles stored with 5 significant digits instead of 7 made
the gzipped clip 10–15 % smaller but left one run unmet and a 0.57 miss.

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
| **crossed**   | elbow and wrist leave the upper arm's plane (stress case)                                      | 14                | 0.471     | 12.5                  | 842           | 70 KB (22 KB) /4.6 s   | 216 ms |
| **hinged**    | the same motion, the elbow a 2D `rotate` hinge in the arm's plane                              | 14                | 0.450     | 7.7                   | 566           | 44 KB (13 KB) /4.6 s   | 164 ms |
| **calm**      | a sway and a lift toward the camera, a small hand turn, nothing edge-on                        | 0                 | 0.450     | 1.6                   | 103           | 8.4 KB (2.4 KB) /4 s   | 89 ms  |
| **stretch**   | in-plane 3D scale (non-uniform), translate and depth keys under a walking 2D root; a 400° spin | 2                 | 0.448     | 3.3                   | 165           | 13 KB (3.9 KB) /3 s    | 84 ms  |
| **curves**    | eased and overshooting orientation keys, a stepped one, a late first key, bezier channels      | 10                | 0.467     | 16.2                  | 654           | 52 KB (16 KB) /3 s     | 157 ms |
| **turn-side** | the hand turns to 135° and 180° on a side turnaround                                           | 2                 | 0.449     | 1.6                   | 48            | 2.4 KB (0.6 KB) /2.4 s | 22 ms  |
| **turn-full** | the same on a full turnaround                                                                  | 1                 | 0.449     | 1.6                   | 27            | 1.7 KB (0.5 KB) /2.4 s | 22 ms  |

Each baked rig is read by the strict irig reader, then loaded and played by the real engine-rig
(`SkeletonJson` → `Skeleton` → `AnimationState`, as `RigView` plays it). At every 1 ms, at ±10 µs to
±4 ms around every edge-on crossing and every stepped key, and at the clip's end, every card's four
corners are compared with the orthographic projection of the 3D pose, computed in the gate
independently of the bake: its own matrices and slerp, its own quaternions of the clips' angles, and
each key run's progress and every other channel sampled by engine-rig's own timelines (a skeleton
with one bone per channel). **The largest miss anywhere is 0.47 rig units** (1 px at scale 1), floor
included (P1's linear reduction: 0.53); the bound asserted is 1. The sleeve's skinned vertices stay
within 0.44 of its projected 3D skin. Also asserted: only 4.2 timelines are written; engine-rig draws the bake's draw order and it
follows depth past the hysteresis; the arm goes behind the torso and back once each way despite the
wobble; engine-rig shows the drawing the bake chose, ¾ at 45° (unsquashed), side at 90°, the other
¾ at −50°, no swap within 50 ms of another; past the side view a side turnaround shows the other
side's ¾ (135°) and the front (180°) mirrored, a full one its ¾-back and back drawings unmirrored, all
square to the viewer; every run met the tolerance; the key-frame and timeline-key budgets per clip;
every curve a 4.2 bezier (four numbers per value, its time handles inside its run); a rig tolerance
of 0.15 bakes calm within 0.150 (2.0 key frames / bone / s) and an option overrides it; the calm clip
with the chest drawn at ×3 stays within the tolerance; the non-uniform scale
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

| Mutation                                                        | Result                                                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| no shear (rotate + scale only)                                  | 867 units off                                                                                         |
| project each bone's local transform, not world                  | 98 units off                                                                                          |
| key only at the 3D keys (no dense bake)                         | 6,973 units off                                                                                       |
| no key reduction                                                | within tolerance, but 137 key frames / bone / s (budget 16)                                           |
| straight runs only (no bezier)                                  | within tolerance, but 36.3 key frames / bone / s (budget 16)                                          |
| no floor                                                        | 49 units off                                                                                          |
| no step at a flip                                               | 32 units off                                                                                          |
| no draw-order hysteresis                                        | the arm swaps behind / in front 4 times instead of 2                                                  |
| bezier handles written as progress 0 → 1 (as `orient` keys are) | 125,170 units off                                                                                     |
| a run's error measured in its bone's local space, not the world | 1.19 units off; on the calm clip with the chest drawn at ×3, 1.33 (measured in the world: 0.450)      |
| a step written as one key, not two at one time                  | 18,368 units off                                                                                      |
| no angle wrap (§4.3, §7)                                        | crossfades spin 713° (from the end) and 363° (from the middle); the stretch clip's chest ends at 400° |

All but the last and the ×3 chest run on the crossed arm. Earlier iterations measured two more
choices (no longer switches in the bake): keying a child against its parent's **exact** pose instead
of the played one drifted 125 units near edge-on; one shared key set for the chain cost 2.9× the
timeline keys (§4.4). A planted mutant writing a curve's handles out of order fails the gate's
4.2-format check on its own.

**A rig read from a real irig and its sidecar** (P2, `check:rig3d`): an arm on a chest with a hand
drawn by angle and a sleeve weighted across the elbow, its cards read from its regions and mesh
weights, baked by the save's own path (`rigOf` → `clipOf` → `bake2p5d` → `withBake`); the `.irig`
alone passes the strict reader and engine-rig plays it within 0.45 rig units of the 3D pose, showing
the drawing the bake chose. **Not covered:** real footage (P4).

## 6. Cost

- **Runtime: nothing new.** The same timelines engine-rig plays today; no reader, schema or release
  change; `scripts/check-rig-runtime-free.mjs` and the rig parity gates are untouched. More keys cost
  only the key lookup: engine-rig's `Timeline.search` scans keys linearly, so a frame costs up to
  the key count per timeline; at the crossed clip's density (~170 timeline keys per bone) that is a
  few hundred comparisons per bone per frame, microseconds. A binary search would be a runtime
  change and is not needed.
- **Keys** (P6). Everyday 3D motion: ~2 key frames per bone per second (calm, 1.6; with scale,
  translate and a spin, 3.3; at a tolerance of 0.15, 2.0). Violent 3D motion, many edge-on moments,
  hinged limbs: ~8 (7.7). Joints leaving their limb's plane: 13–16, most of it in the milliseconds
  around each edge-on moment (§4.3). Each timeline keeps its own keys (rotate, translate, scale,
  shear; a constant one is dropped): 5.2 timeline keys per bone per second calm, 37 crossed. P1's
  linear reduction needed 2.0–3.2× the key frames and 2.4–4.3× the timeline keys at the same error.
- **What the curves buy, and where not.** Against straight runs under the same reduction (the gate's
  `curves: false`), bezier runs need 1.6–2.9× fewer key frames on every clip. In gzipped bytes they
  roughly break even: a curved key writes three times the numbers of a straight one, so the gzipped
  clip is smaller for calm (−21 %), stretch (−28 %) and crossed (−8 %) and larger for hinged (+6 %),
  curves (+14 %) and the turns (+23–24 %). The size win over P1 is mostly the new reduction (the
  longest runs, each timeline its own keys); the curves win keys.
- **File size.** ~2.1 KB per second of clip (0.6 KB gzipped) for calm motion over five bones;
  ~9.5 KB/s (2.8 KB gzipped) for the hinged stress clip. A 5 s idle on a 20-bone character: ~42 KB
  JSON, ~12 KB gzipped (P1: ~55 KB, ~14 KB).
- **Bake time.** 22–216 ms per clip in Node for the seven clips (single thread, warm), 2.1–2.3×
  P1's: the fitting and the per-timeline pass cost more than a Douglas–Peucker over dense keys. Live
  while keying in the Rigger, and again on save. The page bundle is about 27 KB (12 KB gzipped).
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

| Phase                                    | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Size             | Needs  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------ |
| **P1 — the bake** ✅ built 2026-11-20    | The spike ported to a pure TS module (`apps/launcher-api/src/lib/rig2p5d.ts`: `bake2p5d`, `rig2p5dProblems`, `pose3d`, `orientOf` / `anglesOf`), bundled for the page as `static/rigger/vendor/rigger-2p5d.js` (`check:vendored-bundles`). Quaternion `orient` keys, the per-rig tolerance / floor / hysteresis, the turnaround (side / full) in the drawing choice and the validator, the angle wrap and the constraint validator. The gate runs on the module (§5).                                                                                                                    | S–M (1 session)  | —      |
| **P2 — the sidecar** ✅ built 2026-11-20 | `rig3d.json`: schema (`tolerance`, `floor`, `hysteresis`, `turnaround` — fixed once set — bones, views, clips with `orient` quaternion keys), read / write with the irig in the same conditional save, backups and restore, Director's rig ops, the hash and the 2D-edit detection, `rig2p5dProblems` on save, and writing the follower setup the bake derives. `check:rigger-writes` cases; `pipeline-concurrency` reviews. Built as §3.1 (`src/lib/rig3d.ts`, `src/lib/server/rigger3d.ts`); `check:rig3d` (schema, conversion, engine-rig parity) and 50 `check:rigger-writes` cases. | M (1 session)    | P1     |
| **P3 — authoring**                       | §9: the 3D switch with the turnaround choice (fixed after) and the tolerance field, fields and gizmo rings, 3D dopesheet tracks as angles derived from the quaternions (`anglesOf` / `orientOf`; the graph editor edits those), live bake, locked baked tracks and Detach, turn-the-view and side view, the clip conversion.                                                                                                                                                                                                                                                             | L (2–3 sessions) | P2     |
| **P4 — motion import in 3D**             | §8: the solver's 3D orientations (pose world, hand world, face matrix) written as `orient` quaternions, hinged limbs as 2D `rotate`, the `bone3d` motion entry, new template versions (Full body v3, Half body v3, Bust with face v4) with cards, depths, hinges, parts at depth and their turnaround. Re-measured on the T10 footage; `motion-depth` / `motion-solve` move on.                                                                                                                                                                                                          | L (2 sessions)   | P2     |
| **P5 — drawings by angle**               | The views panel, image bones with `follow`, honouring the rig's turnaround: template parts for ¾ / side drawings, plus ¾-back and back ones on a full turnaround, and the art blueprint (T6) asking for exactly those.                                                                                                                                                                                                                                                                                                                                                                   | M (1 session)    | P3, P4 |
| **P6 — size** ✅ built 2026-11-20        | Bezier key fitting in the reduction (§4.4): each run the longest 4.2 bezier, fitted as engine-rig plays it, within the tolerance of the 3D pose itself; then each timeline its own keys. 2.0–3.2× fewer key frames and 2.4–4.3× fewer timeline keys than P1 at P1's accuracy; clip JSON 27–52 % smaller, 3–42 % gzipped (§6). (The end-of-clip angle step moved into P1, the tolerance field into P3.)                                                                                                                                                                                   | S–M (1 session)  | P1     |
| **P7 — baked transitions**               | Opt-in (owner, §11): a transition clip from clip A (at its end, or a time) to clip B over a duration, each bone slerped from A's 3D pose to B's (other channels blended), baked like any clip and played between them; the 2D crossfade stays the default.                                                                                                                                                                                                                                                                                                                               | S–M (1 session)  | P3     |

Order: P1 → P2, then **P4 before P3**, because the owner's complaint is imported motion and P4 shows
it on the same footage with the existing 🎥 Motion row (it needs only the bake and the sidecar, not
the editing UI); then P3, P5, P6, P7. P3 and P4 both touch `view.html`, so they run one after the other,
not in parallel. Each phase is a pipeline change on its own branch and touches no game: the runtime
does not change, and a rig without `rig3d.json` is untouched.

### Hand-over to P2

P2 turns an `.irig` plus its `rig3d.json` into the module's input, bakes, and writes the result back.
The types are exported from `apps/launcher-api/src/lib/rig2p5d.ts`; the gate's rigs
(`tools/rigger-spike/rig-2p5d.mjs`, `rigWith`) are worked examples.

Built as `rigOf` / `clipOf` / `withBake` in `src/lib/rig3d.ts` (§3.1), with three choices this
hand-over left open: a follower's irig setup is not read (the bake derives it; reading back its own
output would change the input every save); a clip's duration is the sidecar's `duration` or its
latest key, the sidecar's or the 2D keys it reads, never the length of the last bake; and the 2D keys
read are only those of the bones the baked ones hang from (`bakedBonesOf`, exported by the module),
so a 2D key the bake cannot read refuses the save only where it matters.

**`Rig3d`** — from the irig's skeleton, plus the sidecar's fields:

- `bones`: `name`, `parent`, `x`, `y`, `rotate`, `scaleX` / `scaleY`, `length` from the irig;
  `depth` and `follow` from the sidecar; `card` `{ x0, x1, h }` from the bone's art (its attachments'
  extent in bone space; without one the bake uses a card along `length`). Listed parents and followed
  bones first. `inherit`, `shearX` / `shearY` are passed only so the validator can refuse a baked
  chain that is not Inherit.Normal or has setup shear. The setup carries no tilt or twist (flat by
  contract).
- `slots`: `name`, `bone`, `attachment` from the irig; `drawings` `[{ attachment, turn }]`, `margin`
  and `hold` from the sidecar's `views`. Turns lie in (−180°, 180°]; on a `side` turnaround |turn|
  ≤ 90°, and a `full` one must list back drawings (|turn| > 90°).
- `constraints`: every IK, transform, path and physics constraint as `{ name, bones, mix }`, where
  `bones` are the bones it **writes** (not its target) and `mix` the largest of its mixes.
- `tolerance`, `floor`, `hysteresis`, `turnaround` from the sidecar. `turnaround` is required once
  any slot has drawings, and P2 must refuse changing it once set (§11).

**`Clip3d`** — `name`, `duration` (the irig clip's), and per bone:

- from the sidecar's clip: `orient` `[{ time, value: [w, x, y, z], curve }]`, the turn **from the
  setup**, `curve` `'stepped'` or `[cx1, cy1, cx2, cy2]` with `cy` in progress (0 at this key, 1 at
  the next); `depth`; and `translate` / `scale` / `rotate` for bones the sidecar keys;
- from the irig's clip, for every other bone: its `rotate`, `translate` and `scale` timelines as they
  are. They pass through unchanged unless the bone is under a 3D one, and an ancestor's keys are the
  parent the bake keys against. A bone with irig `shear`, `inherit` or split `translatex` / `scalex`
  timelines needs converting or refusing first: the module does not read them.
- `constraints`: the irig clip's mix keys per constraint (the largest of its mixes per key).

Never `orient` and `rotate` on one bone; a turn of more than 180° between two `orient` keys needs a
key between them.

**What comes back, and what P2 writes:**

- `animation`: the bones' rotate / translate / scale / sheary timelines, `drawOrder`, and the
  attachment keys of drawing slots. These replace those parts of the irig clip (§3, "Who owns the
  baked timelines"); slot colours, deform, events and sequences stay.
- `setup`: each bone's 2D setup. For an ordinary bone it is the irig's; **a follower's is derived**
  (where its 3D setup projects, hung from its 2D parent), and the baked offsets are relative to it.
  P2 must write the follower setups into the irig with the clip, or every baked follower key is off
  by the difference.
- `report.unmet`: runs the bake could not bring within the tolerance (bone, from, to, error), for
  the Rigger to list (§9).
- `rig2p5dProblems(rig, clip)`: run it on save; `bake2p5d` throws on the same problems.

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
