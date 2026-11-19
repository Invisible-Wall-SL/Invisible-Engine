# Rig templates — design + build plan

> Status: [status/rigger](../status/rigger.md) (open item 19) · Owner tool: Invisible Rigger
> (`/rigger`, agent `invisible-rigger`) · Builds on: [invisible-rigger](invisible-rigger.md),
> [irig-format](irig-format.md), the rig and animation libraries
> ([tools/rigger](../tools/rigger.md) §"Reuse a whole rig")

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

**No IK in the template.** The irig format carries IK constraints, but a constraint at full mix
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
         │  └─ head      (tilt; the face block joins here)
         └─ clavicle_l / _r        (shrug)
            └─ upper_arm_*         (raise; reach = scale toward the camera)
               └─ lower_arm_*      (elbow)
                  └─ hand_*        (wrist; palm or drawn pose)
                     └─ thumb_1_* → thumb_2_* → thumb_3_*
                     └─ index_1_* → _2 → _3, then middle, ring, pinky the same
```

Draw order back → front: `pelvis`, `torso`, `neck`, `head`, then each arm in front of the body
(`shoulder`, `upper_arm`, `lower_arm`, `hand`, then the finger segments pinky → ring → middle →
index → thumb, knuckle segment first). Needed: `torso`, `head`, both arms and both `hand_*`.

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
`head_tilt`, `head_nod`, then per side `shrug_*` (clavicle), `arm_*` (raise; below 0 across the
body), `reach_*` (upper arm scale Y: toward the camera), `elbow_*`, `wrist_*` (degrees), `hand_*`
(pose 0–4), `curl_*` (sets the four finger curls and the thumb), `thumb_*` (1 across the palm,
below 0 out), `curl_index_*` … `curl_pinky_*`, `spread_*`. Starter clips: `idle`, `wave`, `point`,
`thumbs_up`, `fist_pump`, `celebrate`, `win_small`, `win_big`.

**The face seam.** The head is one image until the shared face block (bust-face's, reworked in
parallel) settles: its bones parent to `head`, its slots follow `head` in draw order, and
`head_tilt` / `head_nod` / `breath` stay the body's. The face-less template is complete and gated
on its own.

## 4. Face channels

The artist animates **channels**, not bones. Each channel is a number (or a shape name) that the
Rigger turns into ordinary keys, per the contract:

| Channel                 | Range      | Writes                                        |
| ----------------------- | ---------- | --------------------------------------------- |
| `mouth`                 | shape name | `mouth` attachment key                        |
| `jaw`                   | 0–1        | `jaw` translate Y                             |
| `blink_l` / `blink_r`   | 0–1        | `eyelid_*` attachment (open / half / closed)  |
| `brow_l` / `brow_r`     | −1…1       | `brow_*` translate Y + attachment at the ends |
| `gaze`                  | x, y −1…1  | `pupil_*` translate                           |
| `head_tilt`, `head_nod` | degrees    | `head` rotate / `neck` rotate                 |
| `head_turn`             | −1…1       | `face` translate X + children parallax        |
| `breath`                | 0–1        | `chest` scale Y                               |

Because the output is plain timelines, a channel-authored clip is editable in the dopesheet
afterwards, and nothing downstream needs to know channels exist.

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
  (from the video, not from the shape, when both are imported), blinks, brows (against the
  performer's median, so resting brows read neutral) and gaze. Landmarks give the tilt (the outer
  eye corners) and the turn (the nose off the eye line). Names are from the performer's side, so
  the template's `_l` (the picture's left) reads the performer's right.
- **Body** (`full-body`): 33 pose points. Each mapped bone is turned to lie along its two points,
  less the turn its parents' channels already carry (parents first), through its channel's
  `per`; the hips' movement from the first frame, scaled by the torso length, moves and hops the
  root. A line shorter than `minSpan` of the torso is a gap (two ears overlapping side-on), and a
  point below 0.5 visibility is a gap; gaps hold the frame before.
- **Hands** (`half-body`): MediaPipe's **Hand Landmarker** (21 points per hand, up to two), in the
  same pass as the body. Licence read 2026-11-19 from its model card ("Hand Tracking (Lite/Full)",
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
- Every value is clamped to its channel's range and the share past it is reported; smoothing is
  Gaussian (30 ms face, 50 ms body); keys are reduced to what a linear run needs within 2% of the
  range, plus the frame of every image swap. Channels writing one bone timeline (both gaze axes,
  hop and move) are keyed at the same times, because each key carries both axes.
- **Strength**: a drawn face scores its expressions weaker than a filmed one, so the face solve
  takes a multiplier on the blendshape scores (2× for a cartoon).

**How it copes, measured 2026-11-17** (real clips, not a gate): a filmed face (Tears of Steel, CC
BY) was found in 271 of 288 frames; a filmed walk on a bridge in 384 of 384, though walking toward
the camera reads as a drop and elbows bending the way the template's can't are held straight; a
stylised 3D cartoon (Sintel trailer, CC BY) in only 69 of 144 and 36 of 192 frames (huge eyes,
fast cuts). A 2D cartoon (Pepper, by David Revoy, CC BY) was found front-on, ¾ and as line art (25
of 25 each) and never in profile, and its tilt followed the truth within about 2–4°. MediaPipe fits a
human-proportioned mesh inside a cartoon face, so its eye and mouth points sit inside the drawn
ones: drawn closed eyes scored a blink of 0.37 and a drawn open mouth a jawOpen of 0.29, hence the
2× strength for drawn sources. Untested: a real cartoon flipbook with blinks and talking drawn in.

**What it cannot take**, listed after every import from the template's `motion.cannot`: depth
(everything is read flat), nods and turns past the face slide on the bust, hand poses, breathing,
a knee bending forward and a planted-foot crouch (no IK).

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
| **T9 — Half body** 🟡 2026-11-19 (face owed)                 | `half-body` (§3.5): torso, arms, every finger segment, drawn hand poses, 31 controls, eight starter clips, hands tracked by Hand Landmarker (§5.3)                               | a wave and a point read on segment art and on posed art         |

T1–T3 need no GPU and no new dependency; they deliver the template on their own. Each step lands
with a `tools/rigger-spike/` check (headless, through the `engine-rig` loader) and the guide
section it adds.

## 9. Open questions

1. **Mouth set size** — nine shapes (above) or a minimal four (`rest`, `A`, `O`, `smile`) for
   faster art? The contract allows both; the starter clips need to pick.
2. **Head turn depth** — is parallax on one mesh enough, or do some projects need a ¾ head
   drawing swapped in?
3. **Licences** — settled: Rhubarb for T4 (§5.2), MediaPipe for T5 / T7b (§5.3). DWPose was
   refused (trained on non-commercial UBody).
4. **Where the contract is edited** — settled: built-ins in code, user templates in the Rigger
   (📐 Save as template, §7).
