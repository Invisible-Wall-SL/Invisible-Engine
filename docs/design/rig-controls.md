# Rig controls — IK, constraints and control shapes

> Status: **designed 2026-11-20, the owner's decisions taken the same day (§10); K0, K1, C1, C2 and K2 built 2026-11-20, C3 2026-11-21.** The proof is `tools/rigger-spike/rig-controls.mjs`
> (45 checks, in `check:all`, §7); K1's is `rig-presets.mjs` (38) and `rig-constraints-browser.mjs` (25); C2's `rig-control-shapes.mjs` (100 since C3's import cases) and `rig-control-shapes-browser.mjs` (38); K2's `rig-limbs.mjs` (113, 39 of them planted mutants) and `rig-limbs-browser.mjs` (39); C3's `rig-mirror.mjs` (71, 39 planted mutants) and `rig-mirror-browser.mjs` (48). Owner tool: Invisible Rigger (`/rigger`, agent `invisible-rigger`).
> Builds on: [invisible-rigger](invisible-rigger.md), [rig-templates](rig-templates.md),
> [rig-2p5d](rig-2p5d.md), [irig-format](irig-format.md). Current state:
> [status/rigger](../status/rigger.md) (open item 22).

## 1. The ask

The owner, 2026-11-20: _"something else that we started but never really finished and that we need
to add to the rigger is IK and constraints, but also visual shapes to drive these more complex rigs,
like a professional rigging software would have."_

**Recommendation: build it in the ten phases of §8**, after fixing a bug the audit found (§2.3):
the Rigger's ＋ Add IK and ＋ Add transform can silently switch off another constraint. Everything
the animator gets is either a constraint the 4.2 format already has, solved by `engine-rig` in the
game, or ordinary keys the Rigger writes. `engine-rig` and the irig schema do not change, so no
runtime release is needed and no current game can look different. The control shapes live in an
authoring sidecar and never reach a game.

## 2. What exists — measured against the code

### 2.1 The Rigger (`apps/launcher-api/static/rigger/view.html`)

| Part           | IK                                                                                            | Transform                                    | Path                                        | Physics                 |
| -------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------- | ----------------------- |
| Add            | chain = parent + selected bone; target = first bone (in bone order) not in or under the chain | target = first bone not the bone or under it | first slot holding a path                   | rotate amount 1         |
| `order` on add | **`ik.length`** (wrong, §2.3)                                                                 | **`transform.length`** (wrong)               | count of all four kinds                     | count of all four kinds |
| Edit           | target, mix, softness, bend +, compress, stretch                                              | target, 6 mixes, 6 offsets, relative, local  | target, 3 modes, position, spacing, 3 mixes | every field             |
| ◆ Key          | mix from the **setup**; the other four at the format's defaults (#17)                         | 6 mixes from the setup                       | position / spacing / mix from the setup     | per channel, reset      |
| Dopesheet      | tracks: retime, duplicate, ease, delete                                                       | same                                         | same                                        | same                    |
| Graph editor   | —                                                                                             | —                                            | —                                           | —                       |
| Stage          | —                                                                                             | —                                            | —                                           | —                       |

Read from the code (`addIkConstraint`, `keyIk`, `renderIkEditor` and their siblings,
`poseAtTime`, `drawBonesOverlay`, the canvas `mousedown`):

- **Keying edits the setup.** Each ◆ Key button keys the value in the panel, and the panel edits the
  constraint's setup, in animate mode too. Keying an IK's mix from 0 to 1 therefore leaves the setup
  mix at 1, and every clip that does not key that IK now plays it at 1.
- **The stage knows nothing of constraints.** No line from a chain to its target, no mark on a
  constrained bone. Rotating a bone an IK at mix 1 owns writes rotation keys the solve then
  overrides, with no sign why the bone does not move.
- **The graph editor** shows bone channels only; constraint keys are eased by preset, never drawn.
- **`compress` is offered on two-bone IK**, where the runtime ignores it (`apply2` has no compress
  argument); `uniform` is never offered.
- **Not there at all:** a solve order you can see or change, FK/IK switching or matching, poles,
  chains of more than two bones, aim / orient presets, space switching, control shapes, hidden or
  locked bones, layers, selection sets, mirroring, reset to rest, a picker.

Gates: `tools/rigger-spike/{ik,transform,path,physics}.mjs` check the 4.2 data model against
`engine-rig` (run on `anticipation` in CI), `keydefaults.mjs` the key fill, `delete.mjs` the delete
cascade (`dropConstraints`, which re-packs `order`). None runs the add buttons.

### 2.2 The runtime (`packages/engine-rig/src/constraints.ts`, `skeleton.ts`)

- **IK** (`IkConstraint`): one bone (`apply1`: points the bone at the target; compress, stretch,
  uniform) or two (`apply2`: bend sign, softness, stretch, uniform). A list of three or more bones
  loads and does nothing. No pole target: in 2D a two-bone chain has two solutions and `bendPositive`
  picks one.
- **Transform**: world or local, absolute or relative, six mixes and six offsets; only the mixes are
  keyable.
- **Path**: position / spacing / rotate modes, `chain` and `chainScale` included (spline IK).
- **Physics**: one bone, the 4.2 simulation.
- **Order** (`Skeleton.updateCache`): for each `order` from 0 to the constraint count − 1 it takes
  **one** constraint — the first IK with that order, else the first transform, path, physics — and
  never one whose order is ≥ the count. A duplicate or out-of-range order silently drops a
  constraint. `irigDocProblem` does not refuse either.
- No rotation limits, no re-parenting over time.

In the repo: 153 rigs, 185 transform and 174 path constraints, **no IK and no physics**, no duplicate
or out-of-range order. Rigs on R2 are unmeasured.

### 2.3 The open items, explained

Every red of status open item 7, re-run 2026-11-20:

| Red                                                                                                                                           | Cause                                                                                                                                                                                     | Fault in    |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `ik` on `fs_total_number`, `buy_button` (the 1.0 one)                                                                                         | three bones: no bone is left to be a target ("no 2-bone chain found", exit 1). `buy_button` 2.0 passes.                                                                                   | the harness |
| `ik` on `S`                                                                                                                                   | the target picked, `text`, sits exactly on the chain's root (600, −600), so the chain cannot move toward it                                                                               | the harness |
| `ik` on `W`                                                                                                                                   | the harness's IK takes order 0, which `W`'s path constraint `shake` has, so `shake` stops running: "mix 0 is not FK" by 0.41 units. **The Rigger's own ＋ Add IK does the same** (below). | **both**    |
| `transform` 0.00° on 13 rigs (`l1`–`l4`, both `buy_button`s, `multiframe`, `reelhouse_glow`, three `fs_*`, `clusterpay`, `tumble_multiplier`) | no bone turned more than 5°, so the fallback pair follows a target at the same world rotation: nothing to see. The "rotation == target's" check passes on all.                            | the harness |
| `transform` "not found: particle_control2" on `mm_bg`, `mm_bg_feature`                                                                        | the harness replaces the rig's transform list with its own while the `dust` clip keys `particle_control2`, so the loader refuses the copy. The rig is fine.                               | the harness |

**The real bug.** `addIkConstraint` gives a new IK `order: ik.length` and `addTransformConstraint`
`order: transform.length`, not the next free order across the four kinds (path and physics already
use that). On `W` (path `shake` at 0, transform `wild_clock2` at 1), measured through engine-rig:

- ＋ Add IK gives it order 0, `shake` drops out of the update, and the rig's bones move by up to
  **15.7 units** with the new IK at **mix 0**;
- ＋ Add transform gives it order 1, and the **new** constraint never runs.

It hits whenever the count of the new constraint's kind is an order another constraint already holds
— any rig with a constraint of another kind ordered before it. Delete and the rig-library merge
re-pack orders (`repackConstraintOrders`), so a later delete hides it again.

**Open item 17** (◆ Key IK keys softness 0, bend +, no compress, no stretch) is part of the "keying
edits the setup" problem above; §4.1 is the fix the owner chose (§10, decision 1).

**Rig templates have no IK** ([rig-templates §3.4](rig-templates.md)) because a constraint at full
mix replaces the rotations the channels key. That holds for a setup mix of 1; at a setup mix of 0 the
clips play unchanged (proven, §7), which is what §6.1 uses. 📐 Save as template carries no
constraints today ([tools/rigger](../tools/rigger.md)).

**2.5D**: the bake refuses a constraint at a non-zero mix on a bone it bakes, or one that bone hangs
from ([rig-2p5d §4.6](rig-2p5d.md)), because the constraint would overwrite the bake. §6.2 is how IK
works there.

## 3. Principles

1. **The game plays 4.2.** No `engine-rig` change, no irig schema change, no runtime release.
2. **A relation reaches the game one of two ways.** _Live_: a native 4.2 constraint the runtime
   solves every frame (IK of one or two bones, transform, path, physics). _Keyed_: the Rigger solves
   it and writes ordinary keys (matching, mirroring, space switches, 3D IK). Live is preferred in a 2D
   rig: it stays right through crossfades and layered tracks, and costs a few bytes. Keyed is for what
   the format cannot express, and for every bone a 2.5D bake owns.
3. **A control is a bone.** It is in the irig because the runtime needs it as a target and its keys
   are the animation. What makes it a control — shape, colour, layer, locks, limits — is authoring
   data in a sidecar the runtime never reads (§5.7).
4. **The irig is the truth, the sidecar is a lens.** Deleting `controls.json` loses the shapes and
   the helpers' bookkeeping, never a pose.
5. **Off by default.** A rig without `controls.json` opens and saves as today; templates gain IK at
   setup mix 0, so every starter clip plays as before.

## 4. Finishing IK and constraints

### 4.1 Fixes

- **Order.** Every ＋ Add takes the next free order across the four kinds, then re-packs. A re-pack
  (after an add, a delete or a rig-library import) keeps what runs: it never switches on a constraint
  a clash leaves out, which is 🩹 Repair's (built in K0). The save
  refuses a rig that **gains** a duplicate or out-of-range order (a check beside `irigDocProblem`,
  which asks only whether a rig loads: a duplicate loads and silently drops a constraint). A rig
  already stored with one still saves, Director's rig ops included; the Rigger says which constraint
  never ran and offers **🩹 Repair** (re-pack). That changes how the rig plays once saved, so it is
  the author's click, not automatic (§10, decision 2).
- **Keying stops editing the setup.** In animate mode a constraint's panel shows and edits its value
  at the playhead; ◆ Key keys what the panel shows; the setup is edited in setup mode only. ◆ Key IK
  keys all five fields as shown, so a bend-negative IK keeps its bend (#17). Only newly made keys
  change; no existing key is rewritten (§10, decision 1).
- **The panel shows what the runtime reads.** Compress only on a one-bone IK, uniform where it acts.
- **The harnesses.** `ik.mjs` and `transform.mjs` pick targets by world distance from the chain and a
  bone they can turn, add their constraint at the next free order beside the rig's own instead of
  replacing the list, and skip with a reason (not fail) on a rig too small to have a pair. Then they
  run on `W` and `S` in CI too (`RIG_EXTRA` in `scripts/check-all.mjs`), and on all 153 rigs green.

### 4.2 IK chains

| Chain                             | How                                                                                                                                                                       | Reaches the game |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1 bone                            | native: points the bone at the target (aim); compress, stretch, uniform                                                                                                   | live             |
| 2 bones                           | native: bend sign, softness, stretch, mix                                                                                                                                 | live             |
| 3+ bones (tail, tentacle, spine)  | **spline IK**: a path constraint in `chain` rotate mode over a path whose vertices are weighted to 2–4 control bones, so the chain lies along the curve the controls bend | live             |
| 3-segment leg (a dog's, a bird's) | a two-bone IK on the upper two segments to a helper at the hock, then a one-bone aim of the third at the foot control                                                     | live             |
| any chain in a 3D rig             | solved in the Rigger, keyed (§6.2)                                                                                                                                        | keyed            |

**Pole.** In 2D the only freedom a two-bone chain has is which side of the shoulder → target line
the elbow sits on: the format's `bendPositive`. A pole control is a small diamond whose side of that
line the Rigger writes as stepped `bendPositive` keys; the solve stays live. In a 3D rig the pole is a
real 3D direction (§6.2).

**Softness, stretch, compress, mix** are the format's fields, all keyable (bend, compress and stretch
stepped). **Limits** (a knee that never bends backwards) are not in the format: a control's limits
clamp what a drag keys, and the dopesheet flags a key outside them; nothing limits at runtime.

### 4.3 FK / IK switch and matching

The switch is the IK's mix, native and keyable. A **limb** (in the sidecar) names its IK, its FK
bones, its hand or foot control and its pole. Two actions, both writing plain keys at the playhead:

- **⇄ To IK**: key the control on the FK wrist, the bend sign whose solved elbow is nearest the FK
  elbow, and the mix stepping 0 → 1. Proven no pop (0.008 units across the step, which is the arm's
  own motion over 0.2 ms); the other bend sign flips the elbow 70 units.
- **⇄ To FK**: key the FK rotations at the solved pose and the mix stepping 1 → 0. Proven (0.002);
  without the FK keys the arm jumps 54.5 units.

A blended switch (the mix eased over a range) is native too; the Rigger matches both ends. **Match
over a range** keys the other side at every key of the range, so a clip can be cleaned up in IK and
handed back as FK. Key times are float32: a step's keys share one time, and a probe at exactly that
time can still read before the step (the proof found its first version vacuous that way).

**As built (K2).** The **Limb** card (under an IK's panel, and under the Control card of the limb's
bones) makes a limb from a 1- or 2-bone IK (`limbForIk`: the chain is the FK side, the target the
control) and switches it at the playhead, or matched at every key up to a time (`limbMatchTimes`: the
keys of the FK bones, the control, its space bones, every bone above them, the IK's and the spaces'
mixes). `switchLimb` measures the other side first at every time, then keys. Two things the first
version missed, each now a check: **a switch never reaches back** — every channel it keys at t gets a
stepped key a millisecond before t holding what its old curve played there (`holdBeforeSwitch`), so
an earlier run (a space, an IK window, a mix blend) plays as it did — the key is put on the curve
(`insertKeyOnCurve`: the setup before a channel's first key, a point on a linear segment, a
de Casteljau split of an eased one), so the curve is unchanged, though the game samples each half of a
split cubic at ten points of its own (0.47 units on a 70° eased swing, against 0.5 unsplit; an eased
mix blend 3·10⁻³ against 0.10); and **it measures as the
game plays** — `poseClipAt` poses through engine-rig's AnimationState, because the stage's
`poseAtTime` evaluates an eased key exactly where the 4.2 format samples it at ten points (0.67
units apart on W's `wild_dynamite_land`), so a match taken from the stage would leave that much of a
jump in the game. ⇄ To FK keys a channel the IK changes besides the turn — a stretch, or the child
offset the 4.2 two-bone solve drops under stretch — at every matched key once it changes at any. A
limb whose IK was retargeted or re-chained is refused. Measured on W's wick, through engine-rig:
10⁻⁴ units at the switch, the key rounding.

### 4.4 Aim, orient and the presets

The format has no aim or orient constraint, but each is a configuration of one it has. ＋ Add
constraint becomes a list of presets, each writing a native constraint (the sidecar remembers the
preset's name for the panel):

| Preset        | Writes                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------- |
| Aim / look at | one-bone IK (proven within 3·10⁻⁶ ° of the target direction). An art angle goes on the attachment. |
| Look (eyes)   | transform, relative, `mixX` / `mixY` 0.1–0.2 of a look control: pupils follow a fraction of it     |
| Orient        | transform, `mixRotate` only                                                                        |
| Copy location | transform, `mixX` / `mixY`                                                                         |
| Copy scale    | transform, `mixScaleX` / `mixScaleY`                                                               |
| Child of      | transform, all mixes, offsets from the setup                                                       |
| Two-bone IK   | IK on the selected bone and its parent, target picked on the stage or **a new control at the tip** |
| Spline IK     | path in `chain` mode, a path drawn along the chain, its vertices weighted to new controls          |
| Jiggle        | physics, rotate                                                                                    |

### 4.5 Space switching

A hand control that follows the chest, then the world, then a prop it picks up, never popping. 4.2
cannot re-parent a bone over time, and a transform constraint's offsets are not keyable, so each
**space** is a hidden helper — a **space bone** — under the space's bone (chest, root, prop), and one
transform constraint (world, absolute, rotate + translate) from the control to it. Exactly one is at
mix 1 at a time.

**⇄ Space** at the playhead keys the new space bone, stepped, so its world equals the control's at
that moment, and steps the old mix to 0 and the new to 1. Proven: no pop (0.0085 units across the
step), and the control then rides the prop exactly (drift 7·10⁻¹⁵); without the space bone's key it
jumps 125 units. While a space is at mix 1 the control's own keys are overridden, so the gizmo on the
control keys the active space bone instead; the animator just sees the control move. World space is a
space bone under root. Cost per control: one bone and one constraint per space.

**As built (K2).** ＋ Space offers the chain's parent (the chest), the world, any prop outside the
limb, and a free bone the rig already carries named `<control>_<space>` (the templates' `hand_ik_l_chest`
and `_world`, §6.1), which it reuses (`freeSpaceBone`: nothing hangs on it, constrains it or aims
at it). A new space bone sits where the control is at setup; its transform is world, absolute, rotate
and translate, **at mix 0**, so no clip changes until one switches. ⇄ on a space or on **own keys**
(`switchLimbSpace`) keys the new carrier at the control's world place and turn and steps the mixes,
the new one to 1 and the one it left to 0. The space a control follows is the one at full rotate and
translate mix (`limbSpaceAt`; a half-mixed one is none), and the gizmo keys its space bone
(`limbCarrierBone`).

### 4.6 Solve order

- **One list** in the Constraints section, across the four kinds, in solve order, drag to reorder
  (writes contiguous orders). A constraint that cannot run says why.
- **The control layer orders itself:** spaces, then IK, then orient (the hand turning with its
  control), then aim, then path, then physics last. Proven: an IK solved before the space constraints
  leaves the wrist 7.8 units behind its control.
  K2 builds the first step (`orderLimbLayer`: ＋ Space moves each of a limb's spaces ahead of its IK,
  nothing else); the rest of the list waits for a limb that owns an orient or aim.

### 4.7 Live or keyed

| Feature                     | Live (native constraint) | Keyed by the Rigger  |
| --------------------------- | ------------------------ | -------------------- |
| IK, 1 or 2 bones            | ✓                        |                      |
| Chains of 3+                | spline IK or stacked     | in 3D only           |
| Pole                        | the solve                | stepped bend sign    |
| FK / IK switch              | the mix                  | the match            |
| Space switch                | one transform per space  | the space bone's key |
| Aim, orient, copy, child of | ✓                        |                      |
| Limits                      | —                        | clamped while posing |
| Mirror, reset to rest       | —                        | ✓                    |
| IK in a 3D rig              | —                        | ✓ (§6.2)             |

## 5. Control shapes — the control layer

### 5.1 What a control is

A bone with no slot and no weights, role `control` in the sidecar, parented where its default space
is (root for an IK hand, the chest for a chest-space control). **An FK control is the deform bone
itself** with a shape (a ring round the upper arm), costing nothing; IK, pole, space, aim and look
controls are bones of their own.

Per control, in the sidecar:

- **shape**: `circle`, `ring` (rotate only), `square`, `diamond`, `arrow` (1, 2 or 4 ways), `cross`,
  `box` (a face-board slider: 1D or 2D), or `polyline` (points in the bone's frame); **colour**,
  **size**, line width, filled or outline, offset and turn from the bone;
- **size in screen pixels** (like the bone handles) or in rig units;
- **display**: on the stage and in the picker (the default), on the stage only, or in the picker only
  (a switch with no place on the body);
- **channels** the gizmo may key (translate, rotate, scale); the rest locked;
- **limits** per channel, clamping what a drag keys.

Shapes draw above the art and are hit-tested before bones; clicking one selects its bone.

### 5.2 Deform bones and helpers

Every bone has a role: `deform` (art hangs on it), `control`, or `helper` (space bones, ankle
helpers). Any bone can be **hidden** or **locked** (not selectable on the stage). **Animator view**
shows controls only. Helpers are hidden by default.

### 5.3 Layers and selection sets

**Layers**: named groups (Body FK, Body IK, Face, Fingers, Helpers) with visible and locked switches.
**Selection sets**: named lists (both hands, all left fingers) the outline and the picker select in
one click.

### 5.4 Mirror

- **Pairs** from names (`_l` / `_r`, `_L` / `_R`, `left` / `right`, `l_` / `r_`), overridable.
- **Mirror pose** (copy left to right, right to left, or swap) at the playhead: each control's world
  pose reflected about the rig's mirror line (the root's x = 0, or a chosen bone), converted to the
  other side's local frame (the space switch's maths), keyed. Constraint mixes copy by pair.
- **Mirror rig side**: while building a rig, make the other side's bones, slots and constraints.

**As built (C3).** The Control layer's **Mirror** block. A pair comes from a side word (`l`, `r`,
`left`, `right`, any case, between `_ . -` or as a camel-case word, so `hand_ik_l_chest` pairs with
`hand_ik_r_chest`) swapped for the other side's, or from `mirror.pairs` (key left, value right; a
bone paired with itself is a centre bone), which wins. The line is `mirror.line`'s bone (else the
root) as posed: along its length, or for a bone with no length up its y axis — the root's x = 0. A
mirrored world is the reflection with the y axis turned back (`mirrorWorld`), so a mirrored bone is
never flipped and its images carry the flip.

- **Mirror pose** (`mirrorPose`, L→R, R→L, ⇄) keys each target so the game draws it at its source's
  reflection, kept as far from that as its own setup is from its source's exact mirror (a rest pose
  mirrors to the rest pose on a hand-made side). Ordinary bones are keyed from the **FK pose** — the
  clip with its constraints off — and a paired constraint (the one acting on the pairs of its bones,
  else the one named for the other side) takes its pair's mixes, so the solve mirrors too: keying an
  arm from its solved pose would apply a half-on IK twice. A limb's control is keyed where the game
  draws its pair, through its space bone while it follows a space; a two-bone IK at mix ≥ 0.5 takes
  the bend that puts its elbow on the mirrored side. Keys go in with K2's `insertKeyOnCurve` inside an
  eased segment, then are refitted, so each side of the new key is the old curve stretched to the new
  value. Channel locks hold (a ring keys only its turn); a bone a lock or a limit leaves off the mirror
  is keyed again under its parent as posed and named in the hint (a limit holds a mirror key as it holds a drag). **Swap** also flips the centre
  bones under the line. With the line on the root a turning chest needs its shoulders moved, which a
  ring control forbids: mirror a turning body across its spine or chest.
- **Mirror rig side** (`mirrorRigSide`, ⧉) makes every unpaired bone of the side at the exact mirror
  of its setup, appended (no weighted index moves), its turn in −180…180 (a bone hidden at setup by a
  zero scale is mirrored as if sized 1 and keeps its zero scale); a slot on one draws just above its
  source, its images mapped across (`rehomeAttachment` with the reflection; weighted vertices per
  influence, to the influence's pair), and every clip's draw-order key is rebuilt over the new slot
  list (a key's offsets name places, which a slot put in the middle would shift — a clip that draws an
  arm behind the body still does, its new pair beside it); constraints acting on the side are copied in
  solve order after the rig's own with an IK's bend flipped and a transform's `rotation`, `y`,
  `shearY` offsets and a path's `rotation` negated; the sidecar follows (controls without the
  source's colour, their shape's offset, turn and points flipped and their limits taken across; limbs,
  sets named for a side, presets, picker buttons at 1 − x). It runs on a copy first and touches the open
  rig only when that copy built and loads. It makes no clip keys.

### 5.5 Reset to rest

For the selection, a set or a layer: key the setup values at the playhead (or clear the keys there).
Plus **snap IK control to the chain's tip**.

### 5.6 The picker

A panel (a foldable section, hard rule 10) laying out the controls as buttons in their setup
positions, scaled to fit: click selects, shift adds, drag selects a box. It also holds the selection
sets, each limb's FK / IK switch and space menu, and the template's Controls sliders as a face board
(§6.1). Made automatically when a rig has none; the layout can be moved and is kept in the sidecar.

**As built (C3).** The **Picker** section, under the Control layer. With no `picker.items` the board
is made each time (`pickerAutoItems`): a button per control (a shape or role `control`) not shown on
the stage only, at its setup place fitted to the board's width with the rig's proportions, each limb's
switch under its control, the sets in a row at the foot, every button whole on the board and pushed
off the ones it overlaps. ✥ (a drag), ✕ or ＋ store the whole layout in `picker.items`; ⟲ drops it. A
click selects, shift adds, a drag across the board selects the bone buttons in the box; a limb's
button shows FK / IK / the blend at the playhead and calls K2's `switchLimbHere`, its ▾
`switchLimbSpaceHere`. A control's `display` reads: absent or `both` = stage and picker, `stage` =
stage only, `picker` = picker only. The face board is §6.1's.

### 5.7 Where it lives — `controls.json`

**Not in the irig.** `readIrig` refuses fields it does not know (irig-format §4.1). The 4.2 binary
reader has a bone `icon` and `visible`, but the irig schema does not; adding them is a schema
revision, so a runtime release and a raised rollback floor, for data no game reads. (A bone's editor
`color` is in the schema; controls keep their colour in the sidecar, one fact one home.)

**A sidecar beside the `.irig`**, like `template.json` and `rig3d.json` ([rig-2p5d §3](rig-2p5d.md)):
one per folder, naming its rig.

```jsonc
{
  "controls": 1,
  "rig": "hero",                         // the `.irig` stem it belongs to
  "irig": "…",                            // pair mark, written by the save (as rig3d.json's)
  "bones": {                              // per bone that is not a plain deform bone
    "hand_ik_l":  { "role": "control", "shape": "square", "colour": "#e8b04a", "size": 14,
                    "channels": ["translate", "rotate"], "layer": "Body IK" },
    "elbow_pole_l": { "role": "control", "shape": "diamond", "size": 8, "layer": "Body IK" },
    "upper_arm_l": { "shape": "ring", "size": 40, "layer": "Body FK",
                     "limits": { "rotate": [-170, 60] } },
    "space_chest_hand_l": { "role": "helper" }
  },
  "layers": [ { "name": "Body IK", "visible": true, "locked": false }, … ],
  "sets": { "hands": [ "hand_ik_l", "hand_ik_r" ] },
  "limbs": {                              // FK / IK switch and spaces (§4.3, §4.5)
    "arm_l": { "ik": "arm_ik_l", "fk": [ "upper_arm_l", "lower_arm_l" ], "control": "hand_ik_l",
               "pole": "elbow_pole_l",
               "spaces": { "chest": { "bone": "space_chest_hand_l", "constraint": "hand_l_in_chest" },
                           "world": { "bone": "space_world_hand_l", "constraint": "hand_l_in_world" } } }
  },
  "presets": { "head_aim": "aim" },       // constraint name → the preset that made it (§4.4)
  "mirror": { "line": "root", "pairs": { "wing_a": "wing_b" } },  // overrides of the name rule
  "picker": { "items": [ { "bone": "hand_ik_l", "at": [ 0.12, 0.55 ] }, … ] }
}
```

- **The fields, as built (C1, `src/lib/rigControls.ts`).** Per bone: `role`, `shape` with an
  arrow's `ways` (1, 2, 4), a box's `axes` (1, 2) and a polyline's `points`, `colour`, `size`,
  `sizeIn` (`screen`, the default, or `rig`), `lineWidth`, `filled`, `offset`, `turn`, `display`,
  `channels`, `limits` (`rotate`, `x`, `y`, `scaleX`, `scaleY`, each `[min, max]`), `hidden`,
  `locked`, `layer`; then `layers`, `sets`, `limbs`, `presets`, `mirror` and `picker.items` (a
  `bone`, `set` or `limb` button `at` a place in 0…1, with a `label`) as above. Every field of this
  section is declared and checked now, so the phases that fill them need no schema step.
- **Strict on write, lenient on read.** A client that edits controls sends the whole sidecar
  (`controls`, under `controlsBaseEtag`, required unless forced); it is bound to the rig (its `rig`;
  the pair mark is the save's) and refused (`422 controls-invalid`, naming each problem) unless it
  is well formed (`controlsDocProblems`: an unknown field or wrong type, `ways` / `axes` / `points`
  on another shape, a layer not listed, a bone in two mirror pairs, a picker button naming none or
  two things or a set or limb that does not exist, another version) and every bone and constraint it
  names is in the `.irig` saved with it (`controlsIrigProblems`; a preset names its constraint's
  kind). On read — `GET /api/rigger/save` answers `controls: { etag, doc, dropped? }`, or
  `{ etag, problems }`, and `torn` — and on every other save, an entry naming a bone or constraint the
  `.irig` no longer has is dropped with a notice (`dropped`, `controlsDropped`), as little as
  possible with it: a set member, not the set; a limb's pole or a space, not the limb, which goes
  only with its IK or an FK bone (and its picker button with it). One the launcher cannot read
  (unparseable, another version) is kept as it is (re-marked) and named by the GET; it never blocks
  a save, since it changes no playback.
- **Saved with the irig.** P2's paired write is generalised to the folder's authoring sidecars
  (`src/lib/rigSidecars.ts`: `rig3d.json`, then `controls.json`): one request, each sidecar under
  the ETag it was read at, then the `.irig`; when any of them loses its race, every sidecar the
  request stored is put back (only over its own version); a removal is checked first and done last.
  Each sidecar carries the pair mark, and a torn `controls.json` refuses every save
  (`409 controls-torn`) as `rig3d.json`'s does: keeping it would put a cut-off save's controls over
  an `.irig` that save never wrote. Backups keep it as `<id>.controls.json` (the history lists
  `controls: true`) and retention drops it; a restore puts back what the backup kept, or removes
  it, never over another rig's (`409 controls-other-rig`); deleting `<stem>.irig` deletes it first;
  the skeleton index never lists it. Reviewed by `pipeline-concurrency`.
- **Rename and delete.** Today's Rigger renames and deletes in the page and sends no sidecar, so the
  save follows the `.irig` (`renamesBetween` in `rigControls.ts`): a rename keeps a bone or
  constraint where it is in its list and changes nothing it hangs from or acts on, so between the
  names both versions share, a run of names that went is paired with an equally long run that came,
  each pair only when its parent (a bone) or what it acts on and its target (a constraint), renamed
  alike, are the same. The sidecar follows those and drops what names anything else that went. A
  rename that also re-parents the bone in the same save reads as a delete (the control goes, with a
  notice). The sidecar names no slot. C2's page, which holds the sidecar, renames it itself and
  sends it.
- **Who carries it**: the rig library — `rigs/save` takes `controls` (checked as a save checks them,
  bound to the entry's id) and `rigs/get` returns them; the page sends them and merges them on an
  import (C2, §5.8; limbs, mirror pairs and the picker with C3). A shared-library promotion leaves it with the authoring project, as
  `rig3d.json`; Director's rebind keeps it (renaming nothing). The animation library does not (a
  clip is keys). 📐 Save as template carries it in **T12a**, with the template's constraints: both
  need the template's own schema.
- **Never in a game.** Authoring-only, so not an asset class under hard rule 8; export, deploy, bake
  and pull copy the irig, atlas and manifests only. The guard (`check:rig-controls`): the real
  `exportRigBundle` writes the same keys and bytes for a bundle with `controls.json` as without,
  and engine-rig reads the shipped skeleton with the strict irig reader and poses every bone of
  every clip exactly as the rig alone; `check:rigger-writes` proves a save writes the same `.irig`
  bytes beside it (kept or sent) as without. The control **bones** do ship — they are what the
  constraints read — at the cost of a few bones and constraints solved per frame.

### 5.8 The stage and the gizmo (built in C2, ready for 2.5D P3)

**On the page.** `view.html` loads C1's module as `vendor/rigger-controls.js`
(`window.RiggerControls`, `check:vendored-bundles`) and runs its `renameControls` when a bone or
constraint is renamed, `fitControls` when one is deleted, and `controlsDocProblems` before a save.
The sidecar rides in every undo snapshot beside the irig, and a save sends it only when this tab
changed it (as `rig3d.json`). It cannot be edited (and is not sent) when the stored one is unreadable
or torn, or the bundle did not load; the server then keeps the stored one. A sidecar emptied on a rig
that had none is dropped, so the save sends none. 📦 Save rig to library sends it with the rig, and
an import merges the library rig's controls, layers, sets and presets under the import's prefix (and,
since C3, its limbs, mirror pairs and — into a layout the rig keeps — its picker buttons).

**What the stage picks**, in order: a gizmo part; a control's shape (the nearest outline within 7
screen pixels, else the smallest filled shape or screen-sized handle the point is inside — a ring
never from inside, which is the arm it circles); the nearest bone that can be picked. Hidden bones
(their own switch, their layer's, or a helper by default) are neither drawn nor picked unless 👁 Show
hidden; locked ones are drawn, not picked; animator view draws and picks controls only. Defaults: 12
screen pixels, a 2-pixel outline, the colour of the name's side (left blue, right red, else yellow).
Channel locks and limits act in Animate only; in Setup the rigger places bones freely.

**The gizmo is a list of parts.** `gizmoParts(i)` returns, in hit order, parts `{ id, kind, channel,
dir? }`: `disc` (free move), `axis` `x` and `y` (each with the world direction `dir` of that axis in the
chosen space), `ring` (rotate). `drawGizmo`, the hit test `gizmoPartAt` and the drag read only that
list: a part's `channel` is what it keys and what a control's lock removes; an axis drag is the world
delta projected on `dir` (`gizmoAxisProject`), then held to the control's limits. The space is
`gizmoSpace` (`GIZMO_SPACES`: `local`, the bone's own axes from `gizmoAxes`; `view`, the stage's),
switched by **Local | View** in the bar.

**What P3 adds, without reworking it** (the owner's P3 additions, [rig-2p5d §9](rig-2p5d.md)):

- **The depth axis.** A third `axis` part, `{ id: "z", channel: "depth" }`, whose `dir` is the
  bone's depth direction projected through the turned view — so it is drawn only when the view is
  turned (facing the camera, depth has no screen direction). Its drag writes the bone's depth key in
  `rig3d.json`, not `translate`; the drag dispatch already branches on `channel`.
- **Tilt and twist rings.** Two more `ring` parts, `channel: "orient"`, with the ring's plane: the
  2D ring is the plane facing the camera, and a tilted plane projects to an ellipse that
  `gizmoPartAt` tests and `drawGizmo` draws. Their drag writes `orient` quaternions (`orientOf`).
- **Spaces in 3D.** `gizmoAxes(bone, space)` returns 3D axes once the view turns: `local`, the
  bone's 3D frame from the bake; `view`, the camera's. The rings follow the space as the axes do.
- **Channels.** The 3D channels join C1's `CONTROL_CHANNELS` (a `controls.json` schema step, no
  runtime change), so a control can lock depth or the out-of-plane turns like any other channel.
- **Shapes in the turned view** (§6.2): `controlShapeFrame` places a shape from its bone's world
  transform, so the projected pose of the turned view feeds it as it is.

## 6. Fit with what is being built

### 6.1 Rig templates

- **Templates ship with controls (T12a) and IK (T12b).** Controls: rings on the FK bones, the face
  board, layers, sets and a picker layout. IK: in Half body each arm reaches a hand control (chest
  space by default, with world and prop spaces), with a pole for the elbow and the hand's turn following its
  control (orient); Full body adds feet reaching foot controls in world space, so a crouch keeps its
  feet planted (what rig-templates §3.4 could not do). Every IK is off until a clip turns it on
  (§10, decision 3).
- **A limb is one definition, solved where the rig needs it.** `controls.json` names the limb (its
  chain, control, pole, spaces, switch); the chain itself is a native IK constraint in a 2D rig, or a
  rig3d `ik` entry solved in the bake in a 3D rig (§6.2). After 2.5D P4 the built-in Full body and
  Half body are 3D rigs (cards, hinges, depths), whose arms and legs the bake owns, so **their IK is
  the 3D kind and T12b follows K4**. A 2D rig — a custom one, or a template made with 📐 Save as
  template — gets live IK **at setup mix 0**, so every clip, lip-sync line and motion import on it
  plays unchanged (proven on a synthetic arm, §7; T12b gates it on real rigs).
- **Controls sliders and shapes are two views of one key.** A slider is a channel: one number written
  as keys on its drives, the contract that makes a clip play on every rig of the template. A shape
  is direct manipulation of a bone. When a shape's bone property is a channel's drive, dragging the
  shape edits the channel (the slider reads value = key ÷ per, as it already reads keys back); when
  the channel drives several bones (`lean`: spine, chest half as much) the shape moves them all, so
  the channel's proportions hold. Shapes on bones no channel drives key the bone. The validator's rule
  (no two channels on one bone property) stays and gains: no shape keys a property its channel does
  not own.
- **Channels reach constraints.** A drive may target a constraint's mix (`arm_ik_l`): an `ik_arm_l`
  slider 0…1 is the FK / IK blend. The matched switch (§4.3) is a picker action, because matching
  writes keys a channel cannot.
- **A face board.** A channel may carry `ui` (a slider box or a 2D box at a place on the head), so
  gaze is a box the pupil dot is dragged in, and jaw or smile are sliders on the stage. They are also
  the picker's face section. **As built (C3):** a template channel's `ui` is `{ at?, axis?, box? }`
  (`rigTemplateSchema.ts`, checked by `rigTemplateProblem`): a slider `at` a place in 0…1 of the
  board, `axis: 'y'` standing it up, or one axis of the 2D `box` it shares with the other axis's
  channel, the box placed by whichever has `at`; a mouth-shape channel has no place. The Picker's
  **face board** (`faceBoardItems`) draws them, and a drag keys them at the playhead through the
  Controls section's own `faceKeyChannel`. While no channel of the template has a `ui` (the built-ins
  until T12a fills them), the board lays the number channels out itself, an `<id>_x` / `<id>_y` pair
  as one box.
- **📐 Save as template** carries constraints and the sidecar's controls.
- **Versions.** New bones mean a new template version, and only the latest version of a built-in
  exists (rig-templates §4): a rig on the old one loses its Controls panel. 2.5D P4 bumps Full body
  and Half body to v3 anyway, and **carries the control bones in that v3** (§10, decision 4) — `hand_ik_*`,
  `elbow_pole_*`, and on Full body `foot_ik_*`, `knee_pole_*`, plus their space bones — with no
  slot, no weight, no keys and no constraint. They change no pose and no clip, and T12a / T12b then
  need no further version. **Built** (2026-11-20, Bust with face 4, Full body 3, Half body 3; names
  and places in [rig-templates §5.7](rig-templates.md)): `hand_ik_<s>` a child of the chest at the
  wrist, with `hand_ik_<s>_chest` (chest) and `hand_ik_<s>_world` (root) as its space bones;
  `elbow_pole_<s>` on the chest at the elbow, set 80 behind it in the 3D setup; on Full body
  `foot_ik_<s>` and `foot_ik_<s>_world` on the root at the ankle and `knee_pole_<s>` on the root at
  the knee, 80 in front. A prop space bone is made when a prop is picked (K2).

### 6.2 The 2.5D rig

The bake refuses live constraints on the bones it bakes (rig-2p5d §4.6), so **in a 3D rig, IK is
solved in 3D in the Rigger, inside the bake**. It is the maths P4 builds for motion import (rig-2p5d
§8): the upper limb's direction, its twist putting the bend in the plane through shoulder, target and
**pole**, the forearm one hinge angle. P4 feeds it tracked shoulder, elbow and wrist points; IK feeds
it a target and a pole control. One function, `solveLimb3d`, in a module beside `rig2p5d.ts`, serves
both.

**P4 did not build `solveLimb3d`** (2026-11-20, [rig-2p5d §8](rig-2p5d.md)): on real footage the
bend-plane card turns edge-on several times a second, and every bone under an edge-on card pays in
keys (§4.3 there), so the import turns each limb along its own points and rolls it to face the viewer,
the forearm an `orient` like the upper arm. K4 builds the IK solve, and should key a solved limb the
same way: the frame maths it needs (`aimFrame`, `localTurn`) are in `src/lib/rig3dMath.ts`.

- `rig3d.json` gains `ik: [{ name, bones: [upper, lower], target, pole, mix }]` — authoring data, a
  rig3d schema step, no runtime change. The controls' keys (`translate` + `depth`) are sidecar keys
  like any other; at each check time the bake solves the limb from them and bakes the result like an
  `orient` + hinge pair. Moving a control re-bakes, so there is one owner of the limb's keys (the bake)
  and nothing to drift.
- The pole is a real 3D control (x, y, depth). The FK / IK switch blends the solved and the keyed
  orientations (slerp) before the bake; matching is the same two actions in 3D.
- Control shapes draw in the turned view and the side view, at their bone's projected place.
- Bones the bake does not own (the face, fingers kept 2D) keep live constraints.

### 6.3 Motion import

- **FK first, IK matched after** (recommended). The trackers measure bone directions, so 🎥 Motion
  keeps keying FK (through the channels in 2D, `rigMotion.ts`; as orientations in 3D, P4), and with
  every IK off until a clip turns it on, imports play as today. **Match IK to FK over the clip** then keys the hand and foot controls on the FK wrists and
  ankles, so the animator can switch a limb to IK to fix a contact or put a hand on a prop.
- **Foot plant** (Full body): frames where an ankle is still and lowest are contacts; during each,
  the foot control is held where it landed, at IK mix 1, with matched switches in and out. The output
  is control and mix keys.
- **Driving the controls directly** from tracked wrists and ankles is possible, but loses the elbow
  and knee the tracker saw; not planned (§10, decision 5). The import's **📍 Follow positions**
  ([rig-templates §5.8](rig-templates.md)) reaches the tracked wrists another way: a two-bone IK
  solved per frame inside the import, bent toward the tracked elbow and keyed as the arm's FK turns,
  with no IK control or constraint in the clip.
- **In 3D** the 3D IK controls (§6.2) are matched to P4's orientations the same way, and foot plant
  holds a 3D foot control.

## 7. The proof — `tools/rigger-spike/rig-controls.mjs`

Played through the real `engine-rig` (SkeletonJson → Skeleton → AnimationState), on the repo's `W`
and on a synthetic chest, two-bone arm, world-space hand control, moving prop, space bones and head.
45 checks, ~4 s, in `check:all`:

| Claim                                   | Measured                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One constraint per order value          | ＋ Add IK as shipped drops `W`'s `shake`: bones move 15.7 units at IK mix 0; ＋ Add transform's new constraint never runs; the next free order keeps both, no pose change                                                                                                                                                                                                             |
| An IK at setup mix 0 changes no FK clip | identical poses (0 units); a 0.2 s crossfade from an IK clip back to the FK clip ends on the FK pose                                                                                                                                                                                                                                                                                  |
| FK → IK match                           | 0.008 units across the step; the wrist then holds the control (10⁻⁶) as the chest moves                                                                                                                                                                                                                                                                                               |
| IK → FK match                           | 0.002 units                                                                                                                                                                                                                                                                                                                                                                           |
| Space switch through space bones        | 0.0085 units across the step; then the control rides the prop (7·10⁻¹⁵ units, 0°)                                                                                                                                                                                                                                                                                                     |
| Aim is a one-bone IK                    | within 3·10⁻⁶ ° of the target direction                                                                                                                                                                                                                                                                                                                                               |
| The shipped Rigger (K0)                 | its ＋ Add functions, clash reader, 🩹 Repair, delete, import and ◆ Keys, pulled out of `view.html`: every add runs beside W's constraints at no pose change; an add or delete on a rig with a clash switches nothing on; the Rigger's and the server's clash readers match engine-rig on 300 random orderings; ◆ Key keys what the panel shows, which is what engine-rig plays there |
| Mutations, each must fail               | the other bend sign (70 units), switching back without FK keys (54.5), no space-bone key (125), the IK ordered before the spaces (7.8)                                                                                                                                                                                                                                                |

K2's `rig-limbs.mjs` plays the shipped limb functions the same way (113 checks): To IK and To FK at a
key, over a range and between keys; linear and eased blends, spaces and FK runs before a switch
playing on; a stretch IK handed back; the four spaces with no jump in place or turn, under a
mirrored prop too; the pole's bend, before the IK's first key too; the dopesheet groups; a sidecar C1
accepts; the irig import dropping nothing. Each guard has a planted mutant (39; a mutant whose text
is gone fails the run). `rig-limbs-browser.mjs` does it on W's wick in the page (39), and plays the
saved file through engine-rig.

C3's `rig-mirror.mjs` plays the shipped mirror, picker, face-board and graph functions the same way
(71 checks, 39 planted mutants): the name rule and the overrides; Mirror rig side at the exact mirror
of every bone (a zero-scale one too), image (a turned region, a weighted mesh), draw-order key, limit
and constraint, the left side and every
weighted index untouched, a sidecar C1 accepts and round-trips; Mirror pose L→R, R→L and swap under a
turned, unevenly scaled chest and across it, the rest pose of a hand-made side kept, an eased segment
keeping its shape, a half-on IK, the bend, a space-carried control, a locked channel, a limit; the picker's
layout and box; the face board; and an IK's, a transform's and a physics constraint's curves as
engine-rig plays them. `rig-mirror-browser.mjs` (48) builds a side, mirrors a pose, drives the Picker
and the face board and drags a mix key in the page, on a body and on W, and plays the saved files
through engine-rig.

Not covered: spline IK (the path spike covers path constraints), limits (authoring maths), the 3D
solve (K4, on P4's solver).

## 8. Build plan

Every phase is a pipeline change on its own branch, touches no game (no runtime or irig schema
change) and keeps a rig without `controls.json` byte-identical on save. **🧱 = edits `view.html`**:
those phases run one at a time, also against the 2.5D phases that edit it (P3, P4, P5, P7).

| Phase                                  | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Size               | Needs                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------- |
| ✅ **K0 — constraint fixes** 🧱        | §4.1: the next free order on every add plus a re-pack; the save refuses a rig that gains a duplicate or out-of-range order; 🩹 Repair on open; keying stops editing the setup and ◆ Key IK keys what the panel shows (decision 1); compress / uniform where they act; the two harnesses fixed and run on `W` and `S`; `rig-controls.mjs` gains the shipped add path. Edits `riggerIrig.ts`, which P2 changed (#1817): build on its version.                                                                                                                                                                                                                                                                                                                                                                                                    | S (1 session)      | P2 merged                        |
| ✅ **K1 — constraints you can see** 🧱 | Chains, targets and constraint links drawn on the stage, constrained bones tinted, a hint when a gizmo edits a bone a constraint owns; the solve-order list with drag to reorder; the presets of §4.4 (two-bone IK from a selection, "a new control at the tip"). Constraint mix curves in the graph editor moved to K2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | M (1–2 sessions)   | K0                               |
| ✅ **C1 — `controls.json`**            | §5.7: schema (strict write, lenient read), saved through `saveRig` generalised to the folder's authoring sidecars, backups, restore, delete, index, promote, rename / delete rewriting it, the rig library carrying it, the byte-identical export guard; `check:rigger-writes` cases; `pipeline-concurrency` review. Server side only. Built as §5.7 (`src/lib/rigControls.ts`, `rigSidecars.ts`, `server/riggerControls.ts`); `check:rig-controls`. 📐 Save as template moves to T12a.                                                                                                                                                                                                                                                                                                                                                        | M (1 session)      | P2 merged                        |
| ✅ **C2 — control shapes** 🧱          | §5.1–5.3, §5.5, §5.8: roles, shapes drawn and hit-tested, colour and size, display, channel locks and limits, hidden / locked bones, animator view, layers, selection sets, reset to rest; loading and saving the sidecar. Built as the bone's **Control** card, the **Control layer** section, 🎛 Controls and Local / View in the bar, and a gizmo of parts (disc, x / y axes, ring) that P3 extends (§5.8); K1's presets make their new bones controls and record the preset; 📦 Save rig to library sends the sidecar and an import merges it under the import's prefix. Proof: `rig-control-shapes.mjs` (97 checks, 33 of them planted mutants) and `rig-control-shapes-browser.mjs` (38). Not built: a dopesheet mark on a key outside a limit (the bone's panel warns at the playhead); 📐 Save as template carrying the sidecar (T12a). | L (2 sessions)     | K1, C1                           |
| ✅ **K2 — switches and spaces** 🧱     | §4.3, §4.5, §4.6: limbs in the sidecar, ⇄ To IK / To FK and match over a range, the pole as a stepped bend sign, ＋ Space (space bones and their constraints), the gizmo keying the active space bone, the control layer's own solve order. Built as the **Limb** card, the dopesheet's ↳ rows under a control and the gizmo's carrier (§4.3, §4.5 as built); a pole drag (or a move of the control or a space bone) keys the bend the pole says. Proof: `rig-limbs.mjs` (113 checks, 39 planted mutants), `rig-limbs-browser.mjs` (39). Not built: constraint mix curves in the graph editor (moved to C3 — the graph editor was 2.5D P3's while K2 ran).                                                                                                                                                                                     | M–L (1–2 sessions) | C2                               |
| ✅ **C3 — mirror and picker** 🧱       | §5.4, §5.6: pairs, mirror pose, mirror rig side; the picker panel with its automatic layout, sets, switches, spaces and the face board; constraint mix curves in the graph editor (from K2: it reads bone channels only, and the blended switch is where a mix curve is shaped). Built as the Control layer's **Mirror** block and the **Picker** section (§5.4, §5.6 as built); the face board reads a template channel's new `ui` (§6.1), which T12a fills for the built-ins; the graph editor graphs a picked constraint's curves (its legend's menu lists the selected bone and the constraints on it). Proof: `rig-mirror.mjs` (71 checks, 39 planted mutants), `rig-mirror-browser.mjs` (48). Not built: a dopesheet mark on a key outside a limit (still C2's open item).                                                                                                                                                         | M (1–2 sessions)   | K2                               |
| **T12a — template controls** 🧱        | §6.1: the built-ins' FK rings, face board (a channel's `ui`), layers, sets and picker layout, written to `controls.json` by ＋ New rig; the shape / channel ownership rule in the validator; 📐 Save as template carrying constraints and controls; gate: every starter clip poses as before.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | M (1 session)      | C3; the control bones in P4's v3 |
| **T12b — template IK** 🧱              | §6.1: IK arms (hand controls, poles, spaces) and IK feet on the built-ins as 3D limbs; a channel drive on a constraint mix for 2D templates; matched switches in the picker; Match IK to FK over a clip; gates: every starter clip, face clip and motion import poses as before on real art.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | M–L (1–2 sessions) | K4, T12a                         |
| **K3 — foot plant** 🧱                 | §6.3: match IK to FK over a clip, contact detection and locked feet for Full body imports, measured on the T10 footage.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | M (1 session)      | T12b                             |
| **K4 — IK in 3D** 🧱                   | §6.2: `solveLimb3d` shared with P4's motion solver, rig3d `ik` entries solved in the bake, 3D pole and target controls, switches in 3D, shapes in the turned and side views.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | L (2 sessions)     | P3, P4, K2                       |

About 12–16 sessions in all.

**Order** (owner, §10 decision 6), one 🧱 phase at a time:

1. **P2** (merged, #1817).
2. **K0** — small, and it closes a live bug that silently switches constraints off on save.
3. **P4** (the owner's motion complaint, already next), carrying the control bones in its template
   versions (§6.1), with **C1** beside it (no `view.html`).
4. **K1 → C2 → K2** — constraints you can see, the control shapes, then switches and spaces,
   usable at once on every 2D rig; with K0 and C1 this is the 2D control layer the owner put before
   P3.
5. **P3** — the 3D posing UI, built on a stage that already has controls, so its gizmo rings and
   turned view draw shapes once rather than being reworked.
6. **C3**, then **T12a** (the templates' controls).
7. **P5**, **K4** (IK in 3D), then **T12b** (the templates' IK) and **K3** (foot plant), **P7**.

## 9. Risks

- **A repair that changes a rig.** Re-packing a rig whose constraint never ran makes it run; the
  author sees the change before saving (🩹 Repair is a click, decision 2).
- **Keying semantics.** After K0, ◆ Key no longer touches the setup. A rig whose author relied on the
  old behaviour keeps its keys; only new keys differ.
- **Space bones and matched keys are data the animator can break** (keying a space bone by hand,
  deleting a matched key). The dopesheet groups them under their control and the switch actions
  re-match; nothing is hidden from the irig.
- **Two sidecars per folder** double the paired-write states. Generalising P2's machinery (rather
  than a second, different one) keeps one model to review.
  Its review in C1 left four gaps the model has had since P2, now for both sidecars: a restore and
  the irig migration re-mark what they read without checking the mark, so one running beside a save
  caught between its writes can keep that save's sidecar; the mark is a hash of the `.irig` text, so
  a sidecar-only save between its writes reads as whole; a delete is not conditional; and a backup
  whose copy fails after another took the same id in the same millisecond drops that one's sidecar
  copies. Only the delete can lose a save that landed meanwhile (its `.irig` too, as it always
  could); each is its own follow-up.
- **Template version churn** strips Controls from rigs on the old version; the control bones
  riding P4's v3 avoid it (decision 4).
- **The stage is not the game for eased keys.** `poseAtTime` evaluates a bezier key exactly; the 4.2
  format (engine-rig) samples it at ten points. K2 measures through engine-rig so its matches are exact
  in the game; the stage still draws the curve exactly (0.67 units off on W's `wild_dynamite_land`).
- **Headless spikes, broken page** ([lessons](../knowledge/lessons/rigger.md)): every 🧱 phase is
  verified in the browser on a real rig, not only by its spike.

## 10. Decisions (owner, 2026-11-20)

The owner took every recommendation.

1. **Keying (status #17):** ◆ Key keys what the panel shows at the playhead — an IK's own softness
   and bend, not the format's defaults — and in animate mode the panel no longer edits the setup.
   Only newly made keys change. Built in K0 (§4.1).
2. **Order repair:** a rig in which a constraint never ran because of an order clash offers **🩹
   Repair**; the author sees the change and saves it. Never automatic. K0.
3. **Template IK:** both. Half body: IK hands with poles and chest / world / prop spaces, chest by
   default. Full body: also IK feet in world space. Every IK is off until a clip turns it on. T12b
   (§6.1).
4. **One template version:** the control bones (no slot, weight, key or constraint) ride in the v3
   that 2.5D P4 brings; there is no separate v4. P4 (§6.1).
5. **Motion import:** FK first and IK matched after, with foot plant; imports do not drive the IK
   controls directly. K3 (§6.3).
6. **Order against 2.5D:** the 2D control layer — K0, K1, C1, C2, K2 — runs before 2.5D P3 (§8).
