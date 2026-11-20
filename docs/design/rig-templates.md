# Rig templates — design + build plan

> Status: [status/rigger](../status/rigger.md) (open item 19) · Owner tool: Invisible Rigger
> (`/rigger`, agent `invisible-rigger`) · Builds on: [invisible-rigger](invisible-rigger.md),
> [irig-format](irig-format.md), the rig and animation libraries
> ([tools/rigger](../tools/rigger.md) §"Reuse a whole rig") · Next: [rig-2p5d](rig-2p5d.md)
> (3D in the Rigger, 2D at render)

## 1. Goal

Most characters we ship fall into a few shapes. A fixed skeleton per shape means a new character
is new art on a known rig, and every animation made for one character plays on all the others.
Three kinds of rig cover the work:

| Template                         | Use                                                             | Order                                        |
| -------------------------------- | --------------------------------------------------------------- | -------------------------------------------- |
| **Bust with face** (`bust-face`) | shoulder-cut character beside the reels, reacting and talking   | **first** (owner, 2026-11-16)                |
| **Full body** (`full-body`)      | standing / walking / celebrating character                      | second, reuses everything built for the bust |
| **Half body** (`half-body`)      | waist-up character beside the reels who gestures with its hands | third (owner, 2026-11-19), §3.5              |
| **Custom**                       | anything else (creatures, props, mascots)                       | today's free-form Rigger, unchanged          |

Target: the built-in templates cover ~80% of character work.

**Non-goals.** No runtime change and no new asset class: a template rig is an ordinary irig v1
with ordinary timelines, so it ships through the existing chain (rule 8) and cannot change how any
current game looks. No video-model animation of the art: the art is rigged, motion is keys.

## 2. What a template is

1. **The template** — versioned. Built-ins are in code
   (`apps/launcher-api/src/lib/server/rigTemplates.ts`), reviewed and gated like any other change;
   templates made in the Rigger are in R2 (§7). Either holds:
   - `bones[]` and `slots[]` (draw order) — the skeleton;
   - `parts[]` — every image the template expects, by name, with its slot and whether it is
     needed (§3.2);
   - `channels[]` — the face controls (§4) and the timelines each one writes (T2). A control may
     instead **set** other controls (`sets`: each keyed at value × per, so one slider curls every
     finger), and a swap control may **hide** slots (`hides`: emptied while it shows any image but
     its first step's, so a drawn hand pose hides the finger images it replaces);
   - `clips[]` — the starter animations (T3), as channel keys `[time, channel, value]`, written by
     the Face section's channel code, so one clip plays on every rig of the template. Data, not a
     library rig: a clip can't name a bone or image the template doesn't own, and the validator
     checks every key.
2. **The rig made from it** — ＋ New rig builds it over the art's regions: a part whose image
   exists attaches at its untrimmed size; a missing one is **left out and reported**, because the
   runtime's loader throws on an attachment its atlas lacks.
3. **A rig remembers its template** — `template.json` (`{ id, version }`) beside the `.irig` in its
   bundle, like `source.json`. Not an irig field: `readIrig` refuses any field it does not know, so
   every game booting a published runtime from before the field would refuse a template rig. The
   Rigger reads it to offer the Face panel and the template's checks.

**Why a contract and not just the rig.** Today, applying a library rig to new art leaves every
slot blank because region names don't match (`tools/rigger.md` "by-name / re-skin caveat"). The
contract fixes the names, so art produced to it attaches itself on create, and a missing part is
named instead of discovered.

## 3. The bust-with-face template

### 3.1 Skeleton

```
root
└─ chest                (breathing: scale Y, small)
   ├─ shoulder_l / shoulder_r
   └─ neck
      └─ head           (nod, tilt)
         ├─ face        (owns the face mesh; small turn left/right)
         │  ├─ brow_l / brow_r
         │  ├─ eye_l / eye_r      (lids swap)
         │  │  └─ pupil_l / pupil_r  (gaze: translate)
         │  ├─ nose
         │  └─ jaw      (mouth sits on it; opens down)
         └─ hair_front / hair_back  (physics constraints, added with T3's clips)
```

### 3.2 Parts and variants

Draw order back → front: `hair_back`, `body`, `neck`, `head`, `ear_l`, `ear_r`, `eye_white_l/r`,
`pupil_l/r`, `eyelid_l/r`, `brow_l/r`, `nose`, `mouth`, `hair_front`.

| Slot         | Variants (attachment names)                                                                                    | Required                             |
| ------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `mouth`      | `mouth_rest`, `mouth_A`, `mouth_E`, `mouth_O`, `mouth_U`, `mouth_MBP`, `mouth_FV`, `mouth_smile`, `mouth_wide` | `mouth_rest` + `mouth_A` + `mouth_O` |
| `eyelid_l/r` | `eyelid_l_half`, `eyelid_l_closed` (and `_r`); the slot starts empty = open                                    | `eyelid_l_closed`, `eyelid_r_closed` |
| `brow_l/r`   | `brow_l_neutral`, `brow_l_up`, `brow_l_angry` (and `_r`)                                                       | `brow_l_neutral`, `brow_r_neutral`   |
| others       | one image each                                                                                                 | `body`, `head`                       |

Left and right parts carry the side in their name: an atlas region name is unique, and a
character's two eyes are rarely drawn as mirror copies.

Mouth shapes are image swaps, not deforms: they read clearly at slot-game sizes and cost nothing
at runtime. The set is the common animation mouth chart, so audio lip-sync (§5.2) maps onto it
directly.

### 3.3 The face mesh

`head` becomes a mesh weighted to `head` and `face`. Turning `face` a few degrees with its children
moving further than the mesh edge gives a small head turn (parallax) without new drawings. Larger
turns are not a goal of this template. The mesh follows each character's own drawing, so the
template ships `head` as a region and the artist converts it per character with the existing
region→mesh and auto-weight tools; a one-click "face mesh" helper is not built (not in T2).

### 3.4 The full-body template (`full-body`)

Drawn facing the viewer or facing right (the game flips it for left). Forward kinematics only.

```
root                    (hop: translate Y)
└─ hip                  (pelvis)
   ├─ spine             (lean)
   │  └─ chest          (torso; breath)
   │     ├─ neck        (nod)
   │     │  └─ head     (tilt)
   │     └─ upper_arm_l / _r   (raise)
   │        └─ lower_arm_*      (elbow)
   │           └─ hand_*        (open / fist / point swap)
   └─ thigh_l / _r      (step)
      └─ shin_*         (knee)
         └─ foot_*
```

Draw order back → front: legs (`thigh`, `shin`, `foot`, left then right), `pelvis`, `torso`, `neck`,
`head`, then each arm (`upper_arm`, `lower_arm`, `hand`). Needed: `torso`, `head`, every limb
segment and `hand_l_open` / `hand_r_open`; optional: `pelvis`, `neck`, the fist and point hands.
The face is part of the `head` image; a talking full-body character is a later template.

Channels: `lean` (spine, chest half as much), `hop` (root Y), per side `arm_*` (raise; below 0
swings the other way), `elbow_*`, `hand_*` (swap), `step_*` (thigh swing), `knee_*` (shin fold),
then `head_tilt`, `head_nod`, `breath`. Starter clips: `idle`, `celebrate`, `win_small`,
`win_big`, `walk` (a 1 s loop whose 0, ½ and 1 s are the rest pose).

**No IK in the template** (yet: [rig-controls §6.1](rig-controls.md) plans IK arms and feet at
setup mix 0, which leaves every clip as it plays now). The irig format carries IK constraints, but a constraint at full mix
replaces the rotations the channels key, so the starter clips would stop moving the legs. That also
rules out a crouch that keeps the feet planted (hip down + knees out), which needs IK or a
non-linear drive; body tracking (T7b) keys the thigh and shin rotations a crouch shows, but cannot keep a foot planted.
**No two channels drive one bone property** (`rigTemplateProblem`): a channel keys its absolute
value, so a second channel on the same bone property would overwrite the first.

### 3.5 The half-body template (`half-body`)

Drawn facing the viewer, cut at the waist, arms hanging, hands with the **back of the hand toward
the viewer**. Forward kinematics only (as §3.4).

```
root                     (the waist cut)
└─ hip                   (pelvis stub)
   └─ spine              (lean)
      └─ chest           (twist, breath)
         ├─ neck         (nod)
         │  └─ head      (tilt, turn)
         │     ├─ hair_back, hair_front
         │     └─ face   (the shared face block, §4)
         └─ clavicle_l / _r        (shrug)
            └─ upper_arm_*         (raise; reach = scale toward the camera)
               └─ lower_arm_*      (elbow)
                  └─ hand_*        (wrist; palm or drawn pose)
                     └─ thumb_1_* → thumb_2_* → thumb_3_*
                     └─ index_1_* → _2 → _3, then middle, ring, pinky the same
```

Draw order back → front: `hair_back`, `pelvis`, `torso`, `neck`, `head`, `ear_*`, the face block's
slots, `hair_front`, then each arm in front of the body (`shoulder`, `upper_arm`, `lower_arm`,
`hand`, then the finger segments pinky → ring → middle → index → thumb, knuckle segment first), so a
hand raised in front of the face covers it. Needed: `torso`, `head`, both arms, both `hand_*`, and
the face's own needs (`brow_*_neutral`, `eyelid_*_closed`, `mouth_rest`, `mouth_A`, `mouth_O`).

**The hands: one image per finger segment, plus drawn poses as image swaps.** Chosen over a hand
mesh weighted to the finger bones because a segment image attaches by name on ＋ New rig and plays
at once on every rig of the template, where a mesh needs region→mesh and auto-weighting per
character, and weights bleed between fingers that touch. At slot-game size (a hand of 60–120 px)
a segment's seam at the joint does not show if the artist rounds and overlaps the ends. A curl is
**scale Y along the finger** (knuckle 0.3, middle 0.5, tip 0.6 at a full curl, compounding down the
finger) rather than a turn in the picture: a hand facing the viewer, or facing away, closes toward
or away from the camera, and foreshortening is how that reads in 2D; a turn would fold the fingers
sideways. Spread and the thumb are turns. A pose a segment rig cannot draw (a fist seen from the
front, a thumbs up) is a **drawn image** on the hand slot: `hand_*` (the palm, step 0 = the finger
rig), `_open`, `_fist`, `_point`, `_thumbs_up`; any but the first hides that hand's fifteen segment
slots (`hides`). A pose the art lacks falls back like any swap, to the finger rig, so the starter
clips key the pose **and** the finger curls: art with the drawing shows it, art with segments only
shows the fingers. Art with no segments works too: `hand_*` is then the whole hand.

Channels: `lean` (spine), `twist` (chest against the waist, in the picture), `breath`,
`head_nod`, the face block's (§4, with `head_tilt` and `head_turn`), then per side `shrug_*`
(clavicle), `arm_*` (raise; below 0 across the body), `reach_*` (upper arm scale Y: toward the
camera), `elbow_*`, `wrist_*` (degrees), `hand_*` (pose 0–4), `curl_*` (sets the four finger curls
and the thumb), `thumb_*` (1 across the palm, below 0 out), `curl_index_*` … `curl_pinky_*`,
`spread_*`. Starter clips: `idle`, `wave`, `point`, `thumbs_up`, `fist_pump`, `celebrate`,
`win_small`, `win_big`, each moving the face with the body (a smile, raised brows, a shout, blinks).

**The face is the shared block, whole.** `faceBlock('head')` on the same head as the bust's (a
260 × 300 image at neck + 40), so the face sits where it sits on the bust and every face clip,
lip-sync line and face import made for one plays on the other. The block brings `head_tilt` (±20)
and `head_turn`; `head_nod` and `breath` stay this template's. Head tilt is read from the face
(the eye line), not from the body's ears, so one performance never maps it twice.

## 4. Face channels

The artist animates **channels**, not bones. Each channel is a number (or a shape name) that the
Rigger turns into ordinary keys, per the contract:

| Channel                     | Range      | Writes                                                  |
| --------------------------- | ---------- | ------------------------------------------------------- |
| `mouth`                     | shape name | `mouth` attachment key; jaw, corners and lips per shape |
| `jaw`                       | 0–1        | `jaw` translate Y (the lower lip rides it)              |
| `jaw_side`                  | −1…1       | `jaw` translate X                                       |
| `smile_*` / `stretch_*`     | −1…1       | `mouth_corner_*` translate Y / X                        |
| `lip_upper` / `lip_lower`   | −1…1       | `lip_upper` / `lip_lower` translate Y                   |
| `sneer`                     | 0–1        | `nose` translate Y                                      |
| `cheek_*`, `puff`           | 0–1        | `cheek_*` translate Y, X                                |
| `blink_l` / `blink_r`       | −0.3…1     | `lid_upper_*` translate Y + `eyelid_*` attachment       |
| `squint_*`                  | 0–1        | `lid_lower_*` translate Y                               |
| `brow_l` / `brow_r`         | −1…1       | `brow_*` translate Y + attachment at the ends           |
| `brow_in_*` / `brow_out_*`  | −1…1       | `brow_in_*` / `brow_out_*` translate Y                  |
| `gaze`                      | x, y −1…1  | `pupil_*` translate (+ `lid_follow_*` on y)             |
| `head_tilt`, `head_nod`     | degrees    | `head` rotate / `neck` rotate                           |
| `head_turn`                 | −1…1       | `face` translate X + children parallax                  |
| `breath`                    | 0–1        | `chest` scale Y                                         |

Because the output is plain timelines, a channel-authored clip is editable in the dopesheet
afterwards, and nothing downstream needs to know channels exist.

**The face block (2026-11-19).** The face is one reusable block,
`faceBlock(head, depth)` in `src/lib/server/rigTemplateFace.ts`: its bones under the template's
head bone, its slots, images, controls (with `head_tilt`, `head_turn` and `head_pitch`) and motion
map. Bust with face is a bust plus this block; Half body takes the same block, so one face's clips
and imports play on the other. The first bust's bones keep their places, so the part cutter (§6) is
unchanged. Each control's travel is about twice the first bust's (jaw 24, brows 16, pupils 14 × 8,
turn 20, tilt ±20) because that one's read as nothing at game size (§5.3).

*Bones, not a face mesh with deform keys.* A control key is the control's absolute value, so two
controls can only share a bone if they move different properties — a deform timeline holds every
vertex of an attachment at once, so a smile and a pucker keyed as deforms would overwrite each
other, and each of the nine mouth images would need its own deforms. So the expressions are
bones, and the images that must bend (the brows, every mouth shape) are **weighted meshes** on
them (`RigTemplatePart.bend`: a grid, each vertex weighted to listed bones by inverse squared
distance to each one's place on the image), built at the art's size by `templateRig`. The weights
carry across every image the slot swaps to. 📐 Save as template turns them back into plain images
(it carries no meshes, §7).

**Versions.** A rig remembers `{ id, version }`. Only the latest version of each built-in is kept
(Bust with face 4, Full body 3, Half body 3 — the 2.5D versions of §5.7; the earlier ones were removed
on 2026-11-20 at the owner's word, nothing having shipped on them): a rig that names another version opens as a rig with
no template — no Controls section, but its keys are ordinary timelines, so it opens and plays. A
rig's keys are its controls' values × their travel, so changing a control's travel means a new
version (and the rigs on the old one lose their Controls); widening a range does not.

## 5. Where face motion comes from

### 5.1 By hand — the Controls panel

A Rigger panel (**Controls**), shown when the rig's `template.json` names a template with
channels: a slider/picker per channel that keys at the playhead, plus one-click helpers (blink at time t, idle blink pattern, "talk" loop of
random mouth shapes).

### 5.2 From audio — lip-sync

A voice clip → a timed list of mouth shapes → `mouth` + `jaw` keys, with Rhubarb Lip Sync 1.14.0
run as a CPU job on atlas-tool (`lipsync.py`). Licence checked 2026-11-17: Rhubarb is MIT; what it
bundles is BSD / MIT / Boost-style, including the CMU Sphinx acoustic model (Alpha Cephei, 2-clause
BSD variant) and the pronouncing dictionary and language models that come with PocketSphinx (CMU,
BSD-style). All allow commercial use; the BSD notices must travel with the binary, so the image keeps
its `LICENSE.md`. Nothing of it ships in a game.

Rhubarb answers its own letters (A closed, B clenched, C open, D wide, E rounded, F puckered, G
F/V, H L, X rest). Which template image each becomes is template data, `shapes.lipsync` on the mouth
channel, so the page holds no mapping: `bust-face` uses Rhubarb's own Preston Blair table, with B and
H taking `mouth_E`, the nearest in jaw opening. A letter whose image the art lacks falls back like any
other mouth key (`faceKeyShape`).

The voice line itself is **authoring-only**: uploaded to `<client>/<project>/voices/` (presigned PUT),
played beside the clip in the Rigger, and not exported. The keys are what ship, in the rig. A game
that plays the line adds the same audio to Invisible Sound, which has its own export chain, and cues
it with the clip from Flow.

### 5.3 From video or a flipbook — face and body tracking (T5 / T7b)

**The tracker is MediaPipe, in the browser.** DWPose was the plan and was dropped on 2026-11-17:
its code and weights say Apache-2.0, but `dw-ll_ucoco_384` is trained on UBody (the "u" in
`ucoco`), whose access terms are non-commercial research only; RTMW (the MMPose swap) trains on
UBody too, plus research-only face sets. MediaPipe's Face Landmarker (BlazeFace, Face Mesh V2,
Blendshape V2) and Pose Landmarker (BlazePose GHUM 3D) are Apache-2.0 on each model card, read
2026-11-17; the cards rule out surveillance and identification only. The npm runtime
(`@mediapipe/tasks-vision`, pinned 1.2.0) is Apache-2.0 too. Nothing of it ships in a game.

It runs in the Rigger page on the CPU (`vendor/rigger-motion.js`), so there is no upload, no
atlas-tool job and no GPU: a video is read from the file the author picked. The two `.task` models
are committed under `static/rigger/vendor/mediapipe/` (13 MB, not on npm); the 14 MB WASM runtime is
copied there from the pinned package at build (`scripts/copy-mediapipe-wasm.mjs`) rather than
committed. No third-party CDN at run time.

**The solve** (`src/lib/rigMotion.ts`, pure, gated by `tools/rigger-spike/motion-solve.mjs`) turns
the track into the channel keys a starter clip has, and the page writes them through the one keying
path (`faceKeyMotion`), as one undo step. Which point drives which channel is template data
(`motion` on the template), checked by `rigTemplateProblem`:

- **Face** (`bust-face`): MediaPipe's 52 blendshape scores drive the mouth (nearest of the
  template's shapes in a small feature space, held at least 80 ms so it does not flicker), the jaw
  (from the video, not from the shape, when both are imported), corners, lips, cheeks, lids,
  blinks, squints, brows and their ends, and gaze. Landmarks give the tilt (the outer eye corners)
  and the turn (the nose off the eye line). Names are from the performer's side, so the
  template's `_l` (the picture's left) reads the performer's right. MediaPipe scores `cheekPuff`,
  `cheekSquint` and `noseSneer` near zero on real faces, so the cheeks also read the squint and
  smile, and the sneer the upper lip.
- **Against the performer's neutral.** Every score (and the tilt and turn) is taken against its
  median over the neutral frames: the first second the face is seen, or ±0.25 s around a moment the
  author types (**Neutral at**). Before this, only the brows were, against the take's median, so a
  face whose open eyes or resting head already scored high read half-closed or tilted throughout.
- **Body** (`full-body`): 33 pose points (and their 3D world points, for depth: §5.4). Each mapped bone is turned to lie along its two points,
  less the turn its parents' channels already carry (parents first), through its channel's
  `per`; the hips' movement from the first frame, scaled by the torso length, moves and hops the
  root. A line shorter than `minSpan` of the torso is a gap (two ears overlapping side-on), and a
  point below 0.5 visibility is a gap; gaps hold the frame before.
- **Hands** (`half-body`): MediaPipe's **Hand Landmarker** (21 points per hand, up to two), in the
  same pass as the face and the body. Licence read 2026-11-19 from its model card ("Hand Tracking (Lite/Full)",
  Oct 2021, which covers the hand detector and the landmark model): "LICENSED UNDER Apache
  License, Version 2.0"; out of scope are surveillance and identity recognition. The bundle
  `hand_landmarker.task` (float16 v1, 7.8 MB) is committed beside the other two. A finger's curl
  is the sum of its joints' flexion, read in the hand's **own 3D points** (so a curl toward the
  camera counts in full), 0° → 0 and 240° → 1; the thumb is its two joints (30° → 0, 120° → 1,
  straighter sticks it out); the spread is the angle between the index's and the pinky's first
  segments (15° → 0, 55° → 1). Each hand goes to the side of the nearer body wrist (pose 16 is the
  picture's left); with no body in sight two hands go by picture order and one by its handedness,
  read as an unmirrored video. A hand not found, or a joint not placed, is a gap. The arms, wrist
  (pose wrist → knuckle points) and shrug are body entries (`src/lib/rigMotionHand.ts`, gated by
  `tools/rigger-spike/half-body.mjs` on fixed hand fixtures).
- Every value is held to its channel's range and the share past its far edge is reported (a jaw
  more closed than the neutral is rest, not lost motion); since T11, auto-range first scales a
  performer's spread into the range where its shape matters (§5.5); smoothing is a **One-Euro** filter run
  forward and backward (`smooth` is its time constant at rest, 50 ms face, 30 ms body; `follow`
  opens it with speed, 4 face, 20 body, per channel range per second), which irons out the
  tracker's jitter at rest and keeps a blink's peak (a fixed Gaussian flattens both alike); keys
  are reduced to what a linear run needs within 2% of the range, plus **every turning point** that
  rises or falls more than that (so a peak is a key, never cut), plus the frame of every image swap.
  Channels writing one bone timeline (both gaze axes, a corner's smile and stretch, hop and move) are
  keyed at the same times, because each key carries both axes.
- **Gain per group**: every face entry names a group (mouth, eyes, brows, gaze, head), and the
  import row sets a gain for each (½× to 3×), applied against the neutral. A drawn face scores its
  expressions weaker than a filmed one, so a cartoon wants about 2× on the eyes and mouth. (This
  replaced one strength multiplier on the raw scores, which also lifted the resting face.)

**How it copes, measured 2026-11-17** (real clips, not a gate): a filmed face (Tears of Steel, CC
BY) was found in 271 of 288 frames; a filmed walk on a bridge in 384 of 384, though walking toward
the camera reads as a drop and elbows bending the way the template's can't are held straight; a
stylised 3D cartoon (Sintel trailer, CC BY) in only 69 of 144 and 36 of 192 frames (huge eyes,
fast cuts). A 2D cartoon (Pepper, by David Revoy, CC BY) was found front-on, ¾ and as line art (25
of 25 each) and never in profile, and its tilt followed the truth within about 2–4°. MediaPipe fits a
human-proportioned mesh inside a cartoon face, so its eye and mouth points sit inside the drawn
ones: drawn closed eyes scored a blink of 0.37 and a drawn open mouth a jawOpen of 0.29, hence the
2× strength for drawn sources. Untested: a real cartoon flipbook with blinks and talking drawn in.

**Why movements were "barely caught", measured 2026-11-19** (stage by stage on real footage — a
NASA interview, public domain, and Tears of Steel, CC BY — through the real pipeline: MediaPipe in
the Rigger bundle, the solve, the page's keying, engine-rig; the gate is
`tools/rigger-spike/motion-amplitude.mjs` over `motion-amplitude.fixture.json`). The signal
survived the middle: smoothing and key reduction lost under 5% of each control's swing. It was lost
at both ends. In: a filmed talker's `jawOpen` rises only 0.05–0.15 above their neutral, × 1.4,
and no reading but the brows was taken against the performer's neutral, so on a Tears of Steel
shot the eyelids were half-closed or closed on every frame, the tilt was pinned at its 15° edge on
99% and gaze pinned down on all of them; the mouth shapes sat where shouting puts the scores, so
the mouth image stayed at rest on 72–100% of talking frames. Out: the first bust's travel (jaw 14,
brows 8, pupils 10 × 6) put the talking head's jaw at 3.1 rig units (p5–p95), brows at 6.8 and gaze
at 5.2 on a 300-unit head. After (the face block, the same 16 s): jaw 9.9 (peak 21), brows 21, gaze
9.5, mouth corners 7, lips 8, upper lids 34, the mouth image off rest on 36% of the frames, every
blink closed, the eyes open at rest.

**What it cannot take**, listed after every import from the template's `motion.cannot`: turns and
nods past the face slide on the bust, a full turnaround (§5.4), hand poses, breathing, a knee
bending forward and a planted-foot crouch (no IK).

### 5.4 Depth — foreshortening, draw order, parallax, turns (T10)

The owner's ask (2026-11-19): the imported animation looked flat, depth not used at all. A 2D rig
shows depth four ways — a limb shortening toward its joint, the draw order, parallax inside the
head, and image swaps (¾ and side views) — so those are what the import keys, all as ordinary keys
(no runtime change). Every built-in has them (they came as new versions — Bust with face 3, Full
body 2, Half body 2 — now the only ones kept, §4).

**What MediaPipe gives, measured 2026-11-19** through the shipped bundle (640 px, VIDEO mode) on a
NASA interview (public domain, 30 s at 24 fps), Tears of Steel's bridge scene (CC BY, 30 s at
12 fps, two people turning, a hand on the chest) and its walk (8 s at 24 fps, toward the camera).
Jitter is the frame-to-frame noise (from the second difference, robust to motion):

| Signal                                                        | Swing (p5–p95)           | Jitter          | Used for                       |
| ------------------------------------------------------------- | ------------------------ | --------------- | ------------------------------ |
| Face matrix: yaw                                              | 17–24°                   | 0.11–0.44°      | head turn                      |
| Face matrix: pitch                                            | 5–8°                     | 0.13–0.43°      | head up / down                 |
| Face matrix: roll (r = 0.99 with the eye line)                | 5–17°                    | 0.12–0.28°      | — (tilt stays on the eye line) |
| Face matrix: distance                                         | 4–35 cm of 44–85 cm      | 0.08–0.18 cm    | the bust's distance            |
| Pose world: a limb's picture-plane length over its 3D length  | 0.04–0.55                | 0.001–0.038     | foreshortening                 |
| Pose world: a wrist's depth against the shoulders             | 0.20–0.69 m              | 0.004–0.026 m   | front / behind                 |
| Pose world: the shoulder line's turn                          | 37–101°                  | 0.6–0.8°        | torso turn                     |
| Pose: picture pixels per metre of the shoulders (vs 1st s)    | 1.0–1.4 (a walk in)      | ~1%             | the body's distance            |
| Hand world: wrist → middle knuckle shortening                 | 0.56–0.67                | 0.09–0.11       | — too noisy (see below)        |

The nose's slide off the eye line, which read the head turn before, followed the 3D yaw at only
r = 0.51 on the talking head (0.96 on the bridge shot): a tilt moves it too. The hand model's own 3D
points shorten the hand at 5–7× their jitter; the pose's hand points (wrist → index and pinky) at
10–60×, so the hand's shortening reads those. A hand hidden behind the body still reads behind it
in the pose's 3D points, but at a median visibility of 0.22, under the body's 0.5 floor, so a depth
reading takes its point down to 0.1. Camera cuts read as jumps in distance and turn.

- **Foreshortening.** The rotation still comes from the limb's direction in the picture (the
  projected direction); its shortening is its picture-plane length over its 3D length (world
  points), keyed as the limb image's **scale along the limb**, down to a floor of 0.3, with the next
  joint brought in by the same amount. The image sits on a bone of its own at the joint
  (`<slot>_image`), so the shortening never squashes the bones below it (a scaled chain bone would
  shear a bent forearm and the hand). Upper arms, forearms, hands (on Half body the fingers shorten
  with the hand: they hang on its bone), thighs and shins; Half body's **Reach** sets the three arm
  shortenings at once. A finger curling toward the camera was already read in 3D (§5.3).
- **Front and behind.** A wrist deeper than the shoulders by 5 cm, below them, draws the whole arm
  just behind the torso; deeper than the ears by 5 cm, above the shoulders, just behind the head
  (still in front of the body). The template declares it: a control with `order`
  (`{ slots, steps: [{ at, behind }] }`) keys the **draw order**, so a hand passes behind the body
  without any duplicate art; a template with a front and a behind slot can map the same reading
  onto a swap control instead. Read with a hysteresis of 6 cm (two to six times the measured
  jitter) and held at least 0.15 s, so it never flickers. The animation has one draw-order timeline,
  so each key holds every arm's state; keyed by hand, an arm's depth holds to its next change across
  the other arm's keys.
- **Head turn and nod** from the face's 3D pose, against the performer's neutral: ±25° is a full
  **Head turn**, ±15° a full **Head up / down** (new, the vertical counterpart). Both slide the face
  inside the head, the nose 30% further, the back hair the other way (−12 and −8 units) and the
  fringe a little with the face: a round head's parallax. The head tilt stays on the eye line.
- **Torso turn.** The shoulder and hip lines' turn (world points) keys **Body turn**, a swap to
  `torso_3q_l/r` past 27° and `torso_side_l/r` past 67° (optional parts; art without them keeps the
  front torso, because a swap whose image is missing now falls back toward its rest step — which also
  fixes a missing angry brow keying an empty brow), and **Body side-on** (1 − cos of the turn, up
  to 0.6): the shoulders (and hips) come in by that much and the torso image narrows by half as much,
  because a body has depth of its own.
- **Distance.** The body's picture pixels per metre of its shoulders and torso against the first
  second keys **Nearer / further**, the root's scale (±15% at ±1); on the bust, the face's distance.
- **Per import**, the 🎥 Motion row has **Shorten**, **Behind**, **Turn** and **Nearer** next to the
  gains (off, ½×, 1×, 1½× / 2×; Behind on or off), each shown when the template maps it; off leaves
  that effect's controls as they are. The head's turn and nod answer the **Head** gain, as the tilt
  does. A limb past its floor, a turn past side-on and a distance past ±15% are reported under the
  import as what did not carry over.
- **The contract** (`rigTemplateProblem`, the save schema, the pose check and the 📐 editor all know
  it): drives take `scaleX` beside `scaleY`; a control may have `order` (validated: its slots exist
  and are moved by no other control, each step puts them behind a slot drawn before them, deeper
  steps further back, the rest is the setup order); the motion map takes `pose` face entries
  (`yaw`, `pitch`, `near`) and `foreshorten`, `depth`, `turn` and `approach` body entries. A template
  saved in the Rigger carries them, and its editor offers **＋ depth** (the slots that move and
  the slots they go behind) and scale X.

**What 2D still cannot show**, said after every import: a **full turnaround** — past side-on the
body needs drawings of its back and other side, and a head past about 25° a ¾ or profile drawing
(the face only slides so far); a hand crossing in front of the **other arm** (an arm goes in front
of or behind the body and the head only); a limb half in front and half behind; the near hand
drawn **larger** (shortening is the only perspective cue); a profile face (the tracker does not
find one).

**Since 2.5D P4 (§5.7)** the built-ins are 2.5D rigs and the import keys each bone's 3D turn; the
depth tricks above stay as the 2D import (the row's **2D** choice) and as controls for hand-keyed
clips.

**Next: a 2.5D rig** ([rig-2p5d](rig-2p5d.md), designed and proven 2026-11-20). Bones get a full 3D
orientation and a depth in the Rigger, and every clip is baked into ordinary 4.2 timelines (shear and
non-uniform scale included), so the motion import solves each bone's 3D turn and the four tricks
above become special cases of one projection. No runtime change.

### 5.5 Following the performance — the reference overlay, the elbow, auto-range (T11)

The owner's report after T10 (2026-11-20): "very little difference from before … still missing a
rotation axis … things are not following properly". Clamped (share of frames held at a control's
edge): **Bend left elbow 62%, right 90%**, **Head turn 38%**, Stretch 25%, Lower lip 12%, the
wrists 16–18%. Their list of what did not carry over was Half body **version 1**'s word for word:
the rig predated T10 and had none of its depth controls, which accounts for "very little
difference". At the owner's word the earlier versions are now removed (§4): such a rig opens with no
Controls, and a ＋ New rig has everything.

**The reference overlay.** In Animate mode the 🎥 Motion row has a **Reference** block for an
animation with an import: the source it came from — the video (kept in the browser, never
uploaded) or the Flipbook clip — drawn on a canvas under the rig (z 0: under the FX back band and
the rig) at the frame under the playhead, **From** + (playhead − the import's playhead), the very
frame the import tracked there. **👁** shows it, a slider sets its opacity, **⦿** draws the tracked
points (the body's lines, the hands, the face's points and its eye line), **✥** shows a move handle
(the middle) and a scale handle (the corner, scaling about the middle; both kept on the stage),
**⤢** lines it up again: sized by the motion map's own scale (its `scale` line is `rig` rig units,
as the solve reads it) and placed so the joints the map anchors (a bone whose parent's line ends
where its own begins: the shoulders, the elbows, the wrists) or, with only a face, the eyes land on
the rig's in its setup pose. The alignment is in rig units, so it holds when the stage zooms. One
reference per rig and animation (the latest import into it); the source, alignment and opacity
are kept for the session in `sessionStorage`, the tracked points in memory, and a video is picked
again after a reload. New with it: **From**, the seconds into a video an import starts at (an
import reads at most 30 s). Gated by `tools/rigger-spike/motion-overlay-browser.mjs`.

**Why the elbows sat at their edge, measured.** Tears of Steel (CC BY): a walk toward the camera
(8 s, 24 fps) and the bridge scene (30 s, 12 fps), MediaPipe through the shipped bundle, solved by
`main` and by this change, keyed through the page's keying path and posed by engine-rig. Ruled
out: a sign or axis flip (the outward bend keys the right way); a bend measured in the world (each
bone was already solved under its parents' turn); a mirrored video (the tracker names points by
the picture on a front-on performer, so `_l` stayed the picture's left; 5 of 360 bridge frames
were named the other way round, on a turned back); degrees against units; T10's depth (it scales
images, never an angle). **The cause:** the elbow is a hinge in 3D, but which way it bends in the
picture depends on how the upper arm is rolled — an axis a 2D bone does not have. The template
let it bend 140° one way (out and up: a raised arm's wave) and 42° the other. A hanging arm whose
hand comes in front of the body bends the other way in the picture on 58–100% of frames, by up to
about 165°, so the forearm sat at −0.3 and pointed 21° (median) and 51° (p90) away from the
video's. The elbow now reaches **±168°** both ways (Half body ±1.2 × 140°, Full body ±1.4 × 120°).
Its travel per unit is unchanged, so a key keeps its meaning. A turn is read as whichever of d, d ± 360° lies within one gap of the
control's reach: inside it that is d alone; folded back past both edges, the one nearer the frame
before (held at the edge it came from, never flipping, never winding up).

**Every child under its parent.** Body bones were already solved under the turn their parents
carry, and now against the value each parent is keyed at after auto-range. New: the face's **head
tilt** (the eye line in the picture) is taken under the body's twist and lean, against the neutral
frames; before, a head held level while the shoulders tilted 10° turned 10° with them. Readings
that are noise now read nothing: the **twist** with the shoulders under 0.6 of their usual spread
(side-on: 58 of the 97 bridge frames past ±12° were) and a **shrug** with its half-line under 0.3. A
**hand** farther than 0.6 shoulder widths from both of the performer's wrists is someone else's
(on the two-person bridge shot, 79% of the hands found were 1–6 widths away and keyed the rig's
fingers; on the walk, every hand sat within 0.07). An **image swap** (the ¾ torso) is held at least
0.15 s like the draw order: the walk's turn hovered at the ¾ threshold and swapped the torso for
single frames. Key reduction keeps a **turn** within 1° of its solved curve (2% of ±168° was 6.7°),
which about doubles an arm's keys (walk: 134 → 399 for 192 frames).

**Auto-range** replaces blind clamping where a reading's shape matters more than its size. Per
control, the performer's spread past the range (its p2 and p98) is brought to the edges, each side
of the rest on its own, so a brow raised further than the rig reaches keeps its rise and fall
instead of a plateau. It never stretches (a control that barely moved would turn tracker noise
into motion; the gains lift a weak performer), and leaves a side with no room past the rest (a jaw
shut) and a **saturating** top alone: a blink entry marked `saturate` (contract: the face blend
entry, the save schema) and a finger's curl — a blink past shut is shut, a finger past a fist is a
fist, and neither is reported as lost. The import row sets it per group (mouth, eyes, brows, gaze,
head, body, hands: off, ½, full). The **body is off by default**: its readings are directions in the
picture, and scaling a whole side to take in a few frames past the edge turns every frame on it
(bridge: the left hand's p90 error 13° → 26° with it on). What was scaled, from where and by how
much, is listed under the import.

**Before / after on real footage** (measured on Half body version 1, the owner's rig at the time;
auto-range at its defaults).
"Follow" is the angle between the posed rig's bone and the video's limb, median / p90:

| Clip                                | Control / bone       | `main`               | This change          |
| ----------------------------------- | -------------------- | -------------------- | -------------------- |
| Walk (8 s, 24 fps)                  | Bend left elbow      | 80% clamped          | 0%                   |
|                                     | left forearm follow  | 21.3° / 51.1°        | 0.4° / 1.2°          |
|                                     | upper arms, hands    | 0.8–1.4° / 2.4–3.4°  | 0.4–0.6° / 1.1–1.7°  |
| Bridge (30 s, 12 fps, two people)   | Bend right elbow     | 34% clamped          | 0%                   |
|                                     | Bend left elbow      | 13% clamped          | 2%                   |
|                                     | right forearm follow | 17.8° / 32.5°        | 0.4° / 1.2°          |
|                                     | left forearm follow  | 3.8° / 115.2°        | 1.1° / 4.5°          |
|                                     | left hand follow     | 4.7° / 79.9°         | 2.7° / 9.9°          |
|                                     | twist, wrists        | 6%, 9% clamped       | 2%, 3%               |
| NASA talking head (16 s), gains 2×  | brows L / R          | 29% / 22% clamped    | 4% / 4% (×0.62–0.75) |
|                                     | gaze x / y           | 8% / 30%             | 4% / 4%              |
|                                     | blinks L / R         | 17% / 21%            | 2% / 2% (shut kept)  |
|                                     | squint L, lips       | 20%, 10–15%          | 2%, 2–3%             |
|                                     | stretch L / R        | 7% / 8%              | 2% / 2%              |

At gain 1 the talking head clamped little on `main` (2–8%); the owner's head turn 38% and stretch
25% read like raised gains or wide turns, which auto-range now takes in.

**Depth (T10) on real footage, seen through the overlay:**

- **Foreshortening** shows: forearm images 16–30% shorter on the walk (p50), 50% on the bridge,
  at the floor on 6% of frames.
- **Front / behind** shows: 16 draw-order keys over 30 s on the bridge (a hand behind a turned
  back), none past the first and last on the walk, where the hands stay in front.
- **Torso turn** shows: the ¾ torso on the walk, ¾ and side on the bridge; it flickered at the
  threshold, now held.
- **Nearer / further** is subtle: about 5% through the walk toward the camera, 15% as the walker
  reaches it. A camera cut reads as a jump to ±15%: import one shot at a time (From).
- **Head turn and nod** barely show. ±25° slides the face ±20 units on a 260-unit head, so a
  talker's 10° of turn (p5–p95, the NASA interview) moves it 8 units (3% of the head). A round head's features move r·sin(yaw), about
  23 units at 10°, so the parallax is about 2.8× too small. The fix changes the control's travel,
  which means new versions of Bust with face and Half body (§4); not done here.

### 5.6 The missing axis — what a 2D rig fakes, and what needs a 3D character

A 2D bone turns only in the picture's plane. A shoulder has three turns (in the picture, toward or
away from the camera, and the roll about the arm's own length); a 2D rig shows the first and fakes
the other two, each from a different cue:

| What the performer does                            | How the rig shows it now                                       | How well                                                    |
| -------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| A limb pointing toward or away from the camera     | the image shortens toward its joint (§5.4)                     | good to about 70°; past that a stub; the near end not larger |
| The upper arm rolled (the elbow pointing back/out) | the elbow bends the other way in the picture (±168°)            | the forearm's direction is right; the drawing is the same    |
| The forearm twisted (palm up / down)               | nothing (the wrist turns in the picture only)                  | not shown                                                   |
| The torso turned                                   | ¾ and side images, narrowing (§5.4)                            | to side-on; the back needs drawings                         |
| The head turned or nodded                          | the face slides inside the head (parallax)                     | to about 25° / 15°, and too weakly (§5.5)                   |
| A hand in front of / behind the body or head       | the arm's draw order                                           | whole arm only; not against the other arm                   |
| A finger curling toward the camera                 | the segment shortens along the finger                          | reads at slot size                                          |
| The body nearer / further                          | the whole character scales (±15%)                              | subtle; a camera cut reads as a jump                        |

Without a 3D character (or a drawing per angle) a rig cannot show: a turn past its drawings (a
turnaround, a profile head), arms crossing each other with the right one in front, a limb half in
front of the body and half behind, perspective size (the near hand larger), a forearm's twist, or
the upper arm's roll changing the arm's silhouette. Whether to move to 3D characters is the owner's
decision; the arcade3d runtime (`engine-3d`) exists, and a 2.5D rig — 3D in the Rigger, baked to
ordinary 2D keys — is designed and proven ([rig-2p5d](rig-2p5d.md)): the import would solve each
bone's 3D turn, and the rows above become cases of one projection.

### 5.7 The 2.5D versions — motion import in 3D (2.5D P4)

Bust with face 4, Full body 3 and Half body 3 (2026-11-20) are 2.5D rigs
([rig-2p5d §8](rig-2p5d.md), where the solver, the measurements on the T10 / T11 footage and the
choices are). On the template:

- **`rig3d`**, the 3D setup a rig's first `rig3d.json` takes: a **side** turnaround; the parts at
  depth (the face 95 in front of the head's middle, the nose 25 more, cheeks −25, mouth corners −10,
  the fringe +100, the back hair −100; the elbow poles −80, Full body's knee poles +80); the torso's
  **drawings by angle** (`torso` 0°, `torso_3q_r` −45°, `torso_side_r` −90°, `torso_3q_l` 45°,
  `torso_side_l` 90°: those the art has, at least two); draw-order **layers** (the head's slots;
  Half body's each hand with its fingers). Validated (`rig3dProblem`).
- **`motion.bones3d`**: one `bone3d` entry per turned bone — the body's bones leaning with the spine
  line and facing the viewer (reach 60° at the hips or spine, 30° more at the chest), the torso image
  (and Full body's pelvis image) turned to the shoulder (hip) line, the clavicles, the limbs and the
  hands along their points and rolled to face the viewer, the head to the face's matrix (Full body:
  the ear line) with its outline and back hair square to the viewer; the controls a 3D import
  `replaces`; what it `cannot` take. Validated (`bones3dProblem`: one reading per bone, parents first,
  no kept control turning a 3D bone, draw-order and drawn-torso controls replaced).
- **The head's image on `head_image`**, a bone of its own at the head (so the outline can stay square
  while the head turns), on all three.
- **The control bones** of [rig-controls §6.1](rig-controls.md) (owner decision 4): per arm
  `hand_ik_<s>` (a child of the chest at the wrist), its space bones `hand_ik_<s>_chest` (chest) and
  `hand_ik_<s>_world` (root), and `elbow_pole_<s>` (chest, at the elbow, 80 behind it); Full body per
  leg `foot_ik_<s>` and `foot_ik_<s>_world` (root, at the ankle) and `knee_pole_<s>` (root, at the
  knee, 80 in front). No slot, weight, key or constraint.

A template saved in the Rigger (📐) keeps the 2D motion map only: its rigs have no 3D setup.

### 5.8 Following positions — the rig on the performer (📍 Follow positions)

The owner's report after the hands fix (#1837), the flat-bone bake (#1836) and 3D posing (P3),
2026-11-20, on their NellyAnimTest clip (130 frames) on Half body 3: "there is still a pretty big
offset … the capture looks fine, but the rig is offset … you can clearly see it in the facial rig".

**Measured first, in two parts.** (a) **The Rigger against the game**: every bone's pose in Animate
mode (view.html `poseAtTime`) against engine-rig's on the baked clip, every frame — within 0.37 rig
units on NellyAnimTest, with the same draw order and images; no preview bug there. A synthetic shrug
found one: the page solved a bezier key exactly, engine-rig samples it at nine points and runs
straight between them (Spine 4.2's runtime), up to 0.1° apart on a turn, 1.2 units at a fingertip.
The page now samples as the game. (b) **The import**: each joint of the posed rig against the
tracked point, placed through the reference overlay's line-up. The import copied angles and never
placed anything: the rig stood at its setup place while the performer moved in the frame (the
shoulders' middle 44 off, median; 88 at p90), the head stayed above the chest while the performer's
sat to one side (the eyes' middle 82; the rig's eyes 28 left of its shoulders' middle where the
performer's were 31 right), and limbs 0.7–0.8 of the performer's length (a direction right to 0.3°)
ended short (wrists 51–69). The face block's cluster beside the head in the owner's shots was the
head's place, not the face's.

**The fit** (`MotionOptions.follow`, `rigMotion3d.ts`, in 3D imports; a template opts in with
`motion.bones3d.positions`), placed through the reference overlay's line-up (the author's, else the
default one ⤢ makes), with the rig's depths:

- **The root** is translated so its anchors land on their points — Half body the shoulders; Full
  body the shoulders and the hips (a waist-up shot's hips are guessed off the frame, so a point off
  the picture is not an anchor); Bust with face the eyes and mouth corners. It replaces the root's 2D
  hop and move. Nearer / further (the root's scale) stays and the translate allows for it.
- **The head** (Half body): `neck` is translated in the chest's frame so the eyes' and mouth corners'
  middle lands on the face's, at most 90 rig units (a third of the shoulders) from its place; a frame
  past it is held there and said.
- **The limbs** reach their tracked end by two-bone IK in 3D: the arm the wrist of the hand found on
  it (Hand Landmarker's, where it is within 0.3 shoulder widths of Pose Landmarker's; else the
  pose's), Full body's legs the ankles. The bend goes toward the tracked elbow (or knee), else the
  template's pole (`elbow_pole_*`, `knee_pole_*`). The end's depth is free within the tracked side,
  kept at least half the tracked depth so a hand in front stays in front: it is chosen to bring the
  elbow nearest the tracked one in the picture. A shorter arm reaching the same wrist otherwise bends
  less than the performer's (NellyAnimTest: elbows 94–108 off with the tracked depth, 45–62 chosen).
  A wrist further than the arm reaches turns the arm as tracked (as Angles only) and is said.
- **Solved twice.** The body is solved as before, its turns reduced to keys; then the root and the
  head are placed and the limbs reach from the body **as its keys play it** — a 1° key tolerance on the
  chest is 4.5 units at a shoulder. The bones a limb reaches with are solved after the rest of the frame,
  so the root is placed on this frame's clavicles (on NellyAnimTest the shoulders 0.8 → 0.5).
- **Ordinary keys.** Translate keys on the root and the neck (2D: neither is a bone the bake owns),
  reduced within 0.5 rig units; the arms' turns are `orient` keys as before. Every other bone keys
  exactly what Angles only keys.

**Before (`main`) and after, median / p90 / max, rig units** (the shoulders are 280 apart), the clip
keyed as the page keys it and posed by engine-rig:

| Joint                               | NellyAnimTest (130 frames, 16 fps) `main` | Follow positions   | NASA interview (32 s, 12 fps) `main` | Follow positions  |
| ----------------------------------- | ----------------------------------------- | ------------------ | ------------------------------------ | ----------------- |
| Body (shoulders' middle)            | 43.9 / 87.7 / 97.4                        | 0.5 / 1.1 / 2.3    | 52.6 / 95.2 / 98.6                   | 0.3 / 0.6 / 1.3   |
| Head (eyes' middle)                 | 81.9 / 100.5 / 128.7                      | 5.8 / 8.2 / 10.8   | 56.4 / 78.0 / 83.8                   | 7.9 / 10.1 / 11.0 |
| Mouth (corners' middle)             | 71.8 / 90.4 / 116.9                       | 6.2 / 8.1 / 10.9   | 55.8 / 69.5 / 74.0                   | 7.9 / 10.1 / 11.9 |
| Nose                                | 85.5 / 107.8 / 129.8                      | 12.2 / 19.2 / 23.8 | 58.1 / 73.9 / 80.4                   | 4.1 / 6.0 / 8.0   |
| Each eye                            | 70.5–89.9 median                          | 9.9–15.3           | 47.5–71.8                            | 21.1–24.3         |
| Wrists (the hand found on them)     | 50.5–68.9 / 103.6–106.7                   | 1.4–1.6 / 3.1–3.5  | 84.0–96.5 / 137–144                  | 1.6–1.9 / 3.5–4.4 |
| Middle knuckles                     | 62.8–74.6                                 | 7.7–12.9           | 95.3–109.2                           | 20.8–23.1         |
| Elbows                              | 62.2–64.0 / 78.9–103.5                    | 45.4–62.4 / 77–83  | 90.2–97.5 / 144–170                  | 30.9–31.8 / 64–78 |
| Upper arms' direction (degrees)     | 0.3 / 0.7–0.9                             | 2.2–2.8 / 5.5–6.7  | 0.2 / 0.6                            | 4.4–5.3 / 8.2–8.8 |
| Forearms' direction (degrees)       | 0.6–0.7 / 2.0–2.4                         | 12.7–22.3 / 35–63  | 0.6–0.7 / 1.7–2.5                    | 10.2–17.7 / 27–36 |

What is left, and why:

- **Proportions.** The template's face is wider than a filmed face (its eyes 1.32× the performer's
  apart on NellyAnimTest, 1.84× on the interview's wide shot), so the eyes' and mouth's middle land
  and each eye sits off by the difference. The elbows: the rig's upper arm (190) is shorter than the
  performer's, so the elbow cannot reach the tracked one — the floor (the tracked shoulder-to-elbow
  distance less 190) is a median 31–51 on these clips; the fit is 12–21 over it with the wrist landed.
- **The trade-off.** Matching positions on a body built unlike the performer's bends its limbs
  differently: the forearms point 10–22° (median) off the performer's, where Angles only keeps them
  within 1°. Both are offered (📍 Follow positions, the default, or Angles only).
- **The fingertips** sit on the hand (its knuckles 8–23 off) but are shorter: a finger's curl is
  scale along the finger (§3.5), the curl toward the camera, so a side-on hand's bent fingers read as
  stubs (the rig's middle finger 0.29–0.85 of the performer's in the picture). A curl as a turn when
  the hand is side-on is a separate change.
- **Full body's legs** (260) are shorter against its body (190) than a person's: a standing
  performer's ankles are past their reach and the legs turn as tracked; a crouch reaches.
- A wrist the hand model places on the wrong hand (one frame of NellyAnimTest, 370 units away) is not
  on the pose's wrist, so the pose's wrist is used.

Gated by `tools/rigger-spike/motion-positions.mjs` (a synthetic performer moving across the frame,
bobbing, coming nearer, leaning, shrugging, its arms longer than the rig's and its face off its neck;
13 planted mutants all caught) and `motion-3d-browser.mjs` (the row, the line-up handed to the solve,
the page's pose on the reference).

## 6. Art for a template

From the [Qwen character blueprint](../guides/qwen-cartoon-character-blueprint.md):

1. Qwen-Image: the neutral bust, plain background, square 1024 (blueprint `qwen_bust_face`).
2. Qwen-Image-Edit-2509, the neutral as reference: one image per mouth shape, both eyes half /
   closed, both brows up / angry (blueprint `qwen_bust_face_variant`; twelve passes, one seed).
   A pair changes in one pass and is split per side when cut — the model is unreliable at "the
   left eye only".
3. Cut parts (`services/atlas-tool/rig_parts.py`): each variant differs from the neutral only
   around its feature, so the changed area is the part. All variants of a feature share one
   footprint, and a part is a **patch** (feature plus surrounding skin) that covers the head
   beneath. `head` / `body` split at the neck's narrowest row; ears, hair, nose, eye whites and
   pupils stay in the head.
4. Every part is named per the contract and written on a canvas centred on its bone (the template
   places an image centred on its bone with no offset), scaled so the eyes sit on the eye bones →
   upload the folder through ＋ New rig → Bust with face, or pack it in the Atlas Maker first.

Step 3 is the uncertain one; its synthetic checks pass, the real-output spike is owed
([status](../status/rigger.md) open item 19).

## 7. Templates made in the Rigger — 📐 Save as template (T8)

The owner's ask (2026-11-18): an artist turns any rig into a shared template with no code change,
and it then works like `bust-face` and `full-body` everywhere a template works (＋ New rig, the
Controls section, 🎬 starter animations, 🎤 lip-sync when it has a mouth-shapes control, 🎥 motion
import when it has a tracking map). Built-ins stay in code; a game never sees any of it (a template
only shapes what the Rigger writes into an ordinary irig).

### 7.1 Store

- **R2, one folder per template:** `_shared/rig-templates/<id>/v<n>.json` holds one published
  version (the whole `RigTemplate`), written **create-only** and never rewritten;
  `_shared/rig-templates/<id>/head.json` names the current version and who saved it
  (`{ id, version, label, savedAt, savedBy: { uid, name }, project }`).
- **No index blob.** The list is a prefix listing of `head.json` keys, so two saves of different
  templates touch different keys and cannot drop each other's rows — the race that moved the rig
  library's catalog to Postgres (`riggerLibrary.ts`) has no shared object here to happen on, and
  there is no migration. Templates are few; reading every head on a list is cheap.
- **A save is a new version.** The next number is one past the highest `v<n>.json` in the folder (not
  past the head), so a save that died after its version blob and before its head leaves an
  invisible orphan that the next save steps over, never a number that can no longer be written.
  The head moves under the caller's precondition: `baseEtag: null` creates (a taken name answers
  **409 `exists`** with the head's etag, who saved it, from which project, and its version), a
  string is `If-Match` on the head the author was shown (a stale one is **409 `conflict`**,
  nothing written). Same contract as the rig library (`putLibraryEntry`).
- **Ids.** `r2Slug(name)` — lower case, `_` for anything else — so a user id can never equal a
  built-in's (`bust-face` has a hyphen r2Slug never produces). `template.json` keeps naming
  `{ id, version }`.
- **Reading.** A built-in resolves by id (its version is code). A user template resolves by
  `{ id, version }` to that exact `v<n>.json`, so a rig made from v1 keeps v1's controls after v2 is
  saved; ＋ New rig takes the head's version. A template whose `head.json` is gone (deleted) is no
  template: the Controls section disappears and the rig's keys, ordinary timelines, keep playing.
- `GET /api/rigger/templates` and `/api/rigger/template` serve both through the one
  `RigTemplateSummary`, plus `{ origin: 'builtin' | 'user', savedBy?, savedAt?, etag? }`.

### 7.2 From a rig to a template

The page sends the open document and the author's choices; the **server derives** the template
(`rigTemplateFromRig`, pure), so what is stored is always what the rig really has:

- **Bones** in parent-first order with their setup `x`, `y`, `rotation`, `length`, `scaleX`,
  `scaleY` (the built-ins only use `x`/`y`; `templateRig` writes the rest when present).
- **Slots** in draw order, each with its bone, setup image, `blend` and `color`.
- **Parts** from the default skin: every attachment becomes a part of its slot (a slot with several
  is a swappable variant set) at its drawn size, with its offset from the bone (`at`: x, y,
  rotation, scaleX, scaleY), so new art lands where this art sits. A mesh becomes a region part
  (its weights belong to this art; re-run region→mesh on the new art); a clipping, path, point or
  bounding box attachment is left out. Everything left out is listed back to the author.
- **Needed / optional** is the author's tick per part; at least one part must be needed.
- **Not carried, and said so:** other skins, constraints (IK would override the rotation keys the
  controls write, §3.4), events.

### 7.3 Controls editor

In the 📐 modal, one foldable row per control (header tooltip = the control's tip; 🗑 removes):
**drive** (bone, x / y / rotate / scaleY, per unit, min / max / rest; a control may hold several
drives), **swaps** (slot, then value steps each showing a part or nothing), **mouth shapes**
(slot, rest shape, the jaw control, openness per shape, talk order, and a lip-sync map from the nine
Rhubarb letters). A rig made from a template starts the editor with that template's controls; a
slot with several images gets a suggested swaps control. Each control has a live preview slider
that poses the stage (bones from setup, the slot's image) without keying anything; closing the
editor puts the pose back.

**Motion tracking** is carried, not authored: when the rig was made from a template with a map, its
entries are kept for every control that still exists with the same id, and `rigTemplateProblem`
re-checks them against the new controls. Authoring a new map in the page is not built (a follow-up
if user templates need it; the built-in maps took measurement against real footage, §5.3).

### 7.4 Starter clips: the rig's own animations, stored as timelines

The author ticks animations of the rig; each is stored **as raw timelines** (`clip.animation`), not
as channel keys. Why:

- An animation can do things no control expresses (a bone no control drives, an eased curve, a
  draw-order change); turning it into channel keys would be lossy or impossible.
- What was authored is what plays: the clip is the author's work, unchanged, on every rig of the
  template, and stays editable in the dopesheet.
- Channel-key clips stay for the built-ins (written in code, where the channel keys are the source).

The validator checks a timeline clip names only the template's bones, slots and parts, and carries
only what a template rig can play: bone timelines, slot attachment / colour timelines and draw
order. Deform and sequence timelines name a mesh and an attachment's frames, which a template part
is not, and constraint, physics and event timelines name things the template does not carry: such a
clip is refused with the reason. Added by 🎬 Starter animations like any clip; an image key naming a
part the new art lacks becomes an empty key (the runtime only shows what the atlas has).

### 7.5 Validation — a broken template never reaches the store

Every save runs, server-side, before anything is written:

1. a strict parse of the posted choices (`zod`), so the stored JSON has exactly the template shape;
2. `rigTemplateProblem` (refused with the reason, 422);
3. **the pose check** (`rigTemplatePoseProblem`): a rig made from the template over placeholder art
   with every part loads under engine-rig with the same atlas loader the game uses, and so does one
   over only the needed parts; each control at its min, rest and max, and each starter clip at its
   start, middle and end, poses to finite world transforms.

A template that fails any of these is refused with the reason and nothing is written, because a
stored template would break every ＋ New rig made from it.

### 7.6 Who can do it

The `rigger` role saves and deletes (the same gate as the rig library). The page always asks before
a new version replaces a head, naming who saved it last; deleting asks too and is conditional on the
head's etag the author was shown. A delete removes the head first (the template leaves the list and
every rig's Controls section at once), then the version blobs.

## 8. Build plan

| Step                                                         | Delivers                                                                                                                                                                         | Proves                                                          |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **T1 — Contract + template rig + auto-attach** ✅ 2026-11-17 | the template type and validator; `bust-face` in ＋ New rig (atlas or uploaded images); parts attach by name, missing ones are left out and listed; `template.json` in the bundle | two different arts made into rigs from one template, same pose  |
| **T2 — Face panel** ✅ 2026-11-17                            | channels → keys at the playhead; blink / idle-blink / talk-loop helpers                                                                                                          | an idle with blinks and a talk loop authored in minutes         |
| **T3 — Starter animations** ✅ 2026-11-17                    | `idle`, `blink`, `talk`, `happy`, `surprised`, `win_small`, `win_big` on the template rig                                                                                        | one clip plays unchanged on two characters                      |
| **T4 — Lip-sync from audio** ✅ 2026-11-17                   | voice clip → `mouth` + `jaw` keys                                                                                                                                                | a line of speech in sync by eye                                 |
| **T5 — Face from video / flipbook** ✅ 2026-11-17            | MediaPipe face track in the browser → channels → keys (§5.3)                                                                                                                     | a filmed face drives the rig                                    |
| **T6 — Art blueprint** 🟡 tools 2026-11-17, real run owed    | Qwen variants → named part crops → atlas                                                                                                                                         | a new bust character with no hand cutting beyond the base split |
| **T7 — Full body** ✅ 2026-11-17 (template)                  | `full-body` template on the same contract (§3.4): skeleton, parts, body channels, starter clips                                                                                  | one walk / celebrate plays unchanged on two characters          |
| **T7b — Body from video** ✅ 2026-11-17                      | MediaPipe pose points → bone rotations → channel keys (the same import, body half)                                                                                               | a walk from a filmed actor on a cartoon rig                     |
| **T8 — 📐 Save as template** 🟡 2026-11-18                   | any rig → a shared, versioned template in R2 (§7): parts, controls editor, starter clips as timelines, server-side validation and pose check                                     | a New rig from a saved template keys and plays like a built-in  |
| **T9 — Half body** 🟡 2026-11-19                             | `half-body` (§3.5): torso, arms, every finger segment, drawn hand poses, the shared face block, 57 controls, eight starter clips; face, body and hands tracked in one pass (§5.3) | a wave and a point read on segment art and on posed art; a voice line lip-syncs |
| **T10 — Depth** 🟡 2026-11-19                                | foreshortening, front / behind (draw order), head turn and nod from the face's 3D pose, torso turn with ¾ / side images, distance (§5.4); Bust with face v3, Full body v2, Half body v2 | an arm reaching at the camera shortens; a hand behind the back goes behind the body |
| **T11 — Following** 🟡 2026-11-20                            | the Reference overlay and From (§5.5); the elbow both ways (±168°); head tilt under the body; sides by the picture; the hand guard; held image swaps; auto-range per group | the posed forearm follows filmed footage within about 1°; the source shows behind the rig |
| **2.5D P4 — 3D import** ✅ 2026-11-20                        | the 2.5D versions (§5.7): each bone's 3D turn from the track, baked; Bust with face v4, Full body v3, Half body v3 with the control bones ([rig-2p5d §8](rig-2p5d.md)) | limbs shorten, pass in front and behind, the head turns with parallax, the torso turns on its drawings, all from one projection |
| **T12 — Follow positions** 🟡 2026-11-20                     | 📍 Follow positions in 3D imports (§5.8): the root on the body, the head on the face, the arms (and Full body's legs) reaching the tracked ends by IK; the page samples bezier keys as the game | NellyAnimTest: the body 44 → 0.5, the head 82 → 6, the wrists 51–69 → 1.4–1.6 off the performer (median) |

T1–T3 need no GPU and no new dependency; they deliver the template on their own. Each step lands
with a `tools/rigger-spike/` check (headless, through the `engine-rig` loader) and the guide
section it adds.

## 9. Open questions

1. **Mouth set size** — nine shapes (above) or a minimal four (`rest`, `A`, `O`, `smile`) for
   faster art? The contract allows both; the starter clips need to pick.
2. **Head turn depth** — parallax (§5.4) now carries a turn to about 25° and a nod to about 15°,
   and too weakly: a round head's face moves about 2.8× as far (§5.5). Fixing the travel means new
   versions (§4). Past 25° a ¾ head drawing is needed; whether some
   projects want one swapped in is open (the torso's ¾ / side swap shows the pattern).
3. **Licences** — settled: Rhubarb for T4 (§5.2), MediaPipe for T5 / T7b (§5.3). DWPose was
   refused (trained on non-commercial UBody).
4. **Where the contract is edited** — settled: built-ins in code, user templates in the Rigger
   (📐 Save as template, §7).
