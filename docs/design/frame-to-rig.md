# Frame to rig — one animation frame to a rigged, skinned template character

> Status: designed + proof of the hard steps (2026-11-21); **F1 (frame + cut) built** (§12); **F2a
> (the fitted `templateRig`) and F4 (bending parts) built**, as-built notes in §4.6 / §4.7; **F2b
> (parts, sheet, 🦴 Create rig) built** (§12, 2026-11-22); F3 (the GPU fill) waits on RunPod; the
> other phases in §10.
> Owner tool: Invisible Rigger (`/rigger`, agent `invisible-rigger`), with the Atlas Maker
> (`services/atlas-tool`, agent `atlas-python-tools`) and the RunPod worker. Builds on:
> [rig-templates](rig-templates.md) (the templates, §5.3 MediaPipe, §6 the T6 art blueprint),
> [rig-2p5d](rig-2p5d.md) §4.7 (drawings by angle), [runpod-comfyui-backend](runpod-comfyui-backend.md).
> Proof scripts: `tools/frame-to-rig/` (not gates: they read the owner's frame, which is not in
> the repo). Pictures: `docs/design/frame-to-rig/`.

## 1. The ask

The owner, 2026-11-21: "take the first frame of the animation flipbook, so we have a split we can
animate, a sheet produced with the correctly named regions, and the regions already skinned to the
rig for animation." Art for templates is the slow part (T6's generated busts wait on a RunPod
top-up); a character that already exists as a Flipbook clip should become a template rig without
anyone cutting it by hand.

## 2. Verdict

**Build it, in the order of §10, and default to the best frame, not the first.** On the owner's
real frame (NellyAnimTest frame 0, Half body 3) the hard steps hold up:

- **Joints → cut → rig is exact and automatic.** MediaPipe's joints prompt SAM 2.1 (2–3 s on CPU
  for the whole character); the parts, placed on a skeleton fitted from the same joints and posed by
  engine-rig, redraw the frame at alpha IoU **0.998**, mean colour error **2.65 / 255**, every limb
  joint **0.0 px** from MediaPipe's (§8).
- **Filling what parts hide is the real work, and it is GPU work.** A quarter of the character
  (**61,408 px, 24.2%**, with the props cut out) is under another body part; 73% of that lies deeper
  than 8 px, past what a CPU fill can paint. Another 26,523 px are under the props, made only for a
  prop that swings or comes off. A masked inpaint **redraws the occluder** — given an arm-shaped hole, the model
  paints an arm back (measured twice, §8.4). Limbs fill well one part at a time; the torso behind
  the arms is the open case. Its model is Qwen-Image-Edit-2509 on RunPod; the account is unfunded,
  so this step waits for the owner (as T6 does), and the rig works meanwhile with CPU-filled seams.
- **Two routes for the art, one rig.** _Cut the frame_ keeps the frame's pixels. _Redraw, then cut_
  first has the edit model draw the character in the template's rest pose (arms down, facing the
  viewer), and cuts that: no foreshortening (forearms 0.93 against 0.27), no hand over the body,
  holes down to 17.9% and simple in shape — but the art is a redraw (klein kept the glasses, chain,
  watch and tattoo, and lost the painterly finish and the framing, §8.5). Either way the rig is posed
  like the frame by the frame's joints. Offer both; which one leads is decided by Qwen's run (§11).
- **The first frame is a median frame.** Frame 0 draws the right forearm at **0.27** of its length
  (pointing at the camera) and ranks 66th of 130; frames 111–114 have every limb in the picture
  plane and no hand over the body. A frame picker that scores the clip is cheap and is step 1.
- **Props are parts of their own.** The chain, the glasses, the watch, the bracelet, a ring and an
  earring are found (MediaPipe's segmenter has an "accessories" class), refined by SAM and cut out
  of the part under them, each on its own slot on the bone it rides (§4.3a): a pendant can swing,
  glasses can come off or be swapped, a re-skin changes the jewellery alone. All six were found on
  frame 0, the pendant only once SAM grew the chain; the hair was flagged as a possible hat for the
  author to confirm.
- **The face needs T6.** The template's face block needs closed eyes, brows and mouth shapes that
  one frame cannot have; NellyAnimTest also wears sunglasses, now a prop of its own, so what is
  under them (the eyes) is the face edits' to draw. The head ships as one image until then.

## 3. Licences (read 2026-11-21 from the model cards, LICENSE files and dataset pages)

| Use                | Model                                                      | Code · weights          | Catch                                                                                                                                          |
| ------------------ | ---------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Joints             | MediaPipe Pose / Hand / Face Landmarker                    | Apache-2.0 · Apache-2.0 | already shipped in the Rigger (§5.3 of rig-templates)                                                                                          |
| Cut                | **SAM 2.1** hiera tiny / small (`facebook/sam2.1-hiera-*`) | Apache-2.0 · Apache-2.0 | none; in `transformers` ≥ 4.56. **Not SAM 3**: its custom "SAM License" lets Meta change the terms, with continued use as acceptance           |
| Props              | MediaPipe multiclass selfie segmenter                      | Apache-2.0 · Apache-2.0 | classes hair / body-skin / face-skin / clothes / accessories; trained on photos, so a painted hair-do may read as a hat                        |
| Fill               | **Qwen-Image-Edit-2509** (and 2511)                        | Apache-2.0 · Apache-2.0 | none; the T6 blueprint's model (20.4 GB fp8)                                                                                                   |
| Fill (local / alt) | FLUX.2 [klein] base 4B, klein 4B                           | Apache-2.0 · Apache-2.0 | the card allows commercial outputs; **the 9B kleins are non-commercial**; no BFL mask inpaint (ComfyUI's latent noise mask works on any model) |
| Fill (option)      | InstantX Qwen-Image-ControlNet-Inpainting                  | Apache-2.0 · Apache-2.0 | not tried                                                                                                                                      |
| Layers (R&D)       | Qwen-Image-Layered                                         | Apache-2.0 · Apache-2.0 | RGBA layers, count not semantic; the card does not say it completes what a layer hides                                                         |
| CPU seam fill      | OpenCV Telea inpaint                                       | Apache-2.0 (OpenCV)     | no model                                                                                                                                       |
| ✗ Refused          | LaMa big-lama                                              | Apache-2.0 · not stated | trained on Places2, offered "for academic research and education purposes"                                                                     |
| ✗ Refused          | FLUX.1-dev / Fill, PuLID, InsightFace, DWPose              | —                       | non-commercial (as before)                                                                                                                     |
| Runner             | ComfyUI                                                    | GPL-3.0                 | run as a service, never distributed; its outputs are not GPL                                                                                   |

The models' licences say nothing about the **input art**: the frame must be ours or the client's,
as for mockups (Director ground rule 6), and a recognisable real person needs their rights cleared.
The pipeline does not check either.

## 4. The pipeline

| #   | Step                                 | Automatic?                                                | Runs                                        |
| --- | ------------------------------------ | --------------------------------------------------------- | ------------------------------------------- |
| 1   | Pick a frame                         | yes — best score preselected; the author can pick another | browser (the track 🎥 Motion already makes) |
| 2   | Joints                               | yes; a missed or wrong joint is dragged                   | browser (MediaPipe, as 🎥 Motion)           |
| 3   | Cut into the template's parts        | yes; touch-up brush for a mislabelled patch               | atlas-tool, CPU                             |
| 3a  | Cut the props out, each its own part | yes; the author confirms one on top of the head (hat?)    | atlas-tool, CPU                             |
| 4   | Fill what each part hides            | yes, per part, with a retry per part; review by eye       | RunPod (GPU); CPU seam fill without it      |
| 5   | Pack a sheet, regions named by part  | yes                                                       | atlas-tool (Atlas Maker manifest)           |
| 6   | ＋ New rig from the template, fitted | yes                                                       | launcher (`templateRig` + a fit)            |
| 7   | Mesh and weight the bending parts    | yes, from the known joints                                | launcher (template `bend`)                  |

### 4.1 Pick a frame

Every frame of the clip is already tracked when 🎥 Motion reads it (`RiggerMotion.track`, face +
body + hands in one pass). Score each frame (`proof.py pick`):

- **Foreshortening** — each arm segment's drawn length over its length in MediaPipe's 3D world
  points, scaled by the shoulders (1 = in the picture plane). A part cut short stays short: the rig
  stretches it only by distorting the art.
- **Hands over the body or the face** — the share of the torso box and (×2) the face box the hand
  boxes cover: what is under a hand must be made (§4.4).
- **Found** — face, body, both hands; visibility of the six arm joints.

`score = mean(foreshortening) − ½ · cover − 0.5 (a joint under 0.8 visibility) − 0.2 · (3 − found)`.
On NellyAnimTest: frame 0 scores 0.69 (right forearm 0.27, cover 0.08), the clip's median; frame 114
scores 0.99 (every segment ≥ 0.94, no cover). 69% of its frames draw some segment under 0.6 of its
length, 52% have a hand over the body. The strip shows each frame with its score and the reason.

### 4.2 Joints

MediaPipe as the Rigger already runs it (pose 33 points with world points, hands 21, face 478). The
template's `_l` is the picture's left (the performer's right, pose 12 / 14 / 16); a hand goes to the
side of the nearer pose wrist (as `rigMotionHand.ts`). On a stylised character MediaPipe can miss
(rig-templates §5.3: Sintel 69 of 144 frames); the cut screen shows the joints and lets the author
drag one, so a miss costs a drag, not the character.

### 4.3 Cut

**SAM 2.1, prompted from the joints, one prompt per part**, then one partition (`proof.py segment`):

- Prompts: positive points along the part's bone (30 / 55 / 80% shoulder → elbow, three along the
  forearm, the hand's knuckles and finger joints, the face's nose / brow / forehead / chin and a
  point above the hairline), negative points on the neighbours (the next segment, the hand, the
  torso's middle, the face), and a box around the part's joints.
- Partition: a pixel inside the character's alpha goes to the **front-most** part (template draw
  order: hands, forearms, upper arms, `_r` over `_l`, head, torso) whose mask claims it; an unclaimed
  pixel goes to the part whose **capsule** (joints only) claims it most; a stray island joins the
  neighbour it touches most. Every pixel ends in exactly one part.
- **The neck is not prompted**: on a frame it is a sliver under the chin, often under a collar or
  a chain (NellyAnimTest: the neck prompt took the chain). It is cut by geometry instead, the head's
  and the torso's skin below the jaw and above the shoulders, so it turns on its own bone (§12 F2c).
- Hands are one image each: finger segments at 60–120 px are not cut reliably, and the template
  takes a whole hand on `hand_*` (rig-templates §3.5, "art with no segments works too"), made a
  mesh over the finger bones placed on the frame's fingers (§12 F2c).

### 4.3a Props — the chain, the glasses, the jewellery

A prop is worn, not grown: it moves with one bone but is not that bone's drawing. Cut into the head
or the torso, the glasses turn with the face but can never come off, and the chain nods with the
head. So each one is its own part (`proof.py props`):

1. **Find**: MediaPipe's multiclass selfie segmenter (CPU, 1.2 s here; class "others
   (accessories)") — each connected piece over 60 px is a candidate.
2. **Name it by where it sits on the joints**: over the eyes → `prop_glasses` on `face`, drawn
   before `hair_front`; by an ear → `prop_earring_*` on `head`; between the chin and the chest →
   `prop_chain` on `chest`, drawn before `neck` (the chin covers it when the head nods); at a wrist →
   `prop_wrist_*` on the forearm, drawn after that arm's last finger (a watch hides the wrist's seam);
   on a finger → `prop_ring_*` on the hand. One on top of the head is **not taken**: hair or a hat,
   the author says (here, the cornrows). Anything else is listed for the author to place.
3. **Refine with SAM 2.1**: a box around the piece (a chain's reaches down for its pendant) and
   points deep inside it; the prop is SAM's mask in the box plus the piece.
4. **Cut it out** of every part (props are drawn in front of what they sit on), and give it a slot
   of its own at create (§4.6): template rigs gain slots, never lose any, so every control and clip
   still plays.

**What a prop covers is made only if it is going to move.** A prop that rides its bone (glasses,
a watch) needs nothing under it; one that swings (a pendant, with a physics constraint) needs the
skin or cloth behind it; one that comes off or is swapped needs the whole of it (eyes behind
glasses). The fill step (§4.4) takes the author's choice per prop; the area is counted apart (§8.2).

### 4.4 Fill what each part hides

For each part, its **whole** shape: the visible cut plus what it continues into — a limb's capsule
(the visible half-width, round ends: the overlap a joint needs to bend without a gap), the torso's
hull through the shoulders and hips, the hand plus its wrist's round end — inside the character's
outline. Of the hidden pixels:

- **under a part drawn in front** — _occluded_, revealed when that part moves: **must be made**;
- **over a part drawn behind** — a joint's round end or pixels the cut gave the neighbour: the part
  is drawn on top there, so **the frame's own pixels** are right, and nothing is made.

What makes the occluded pixels (§8.4 measured why):

1. **One pass per part, the part alone** on a blank background, its occluded area grey and
   noise-masked, the visible pixels composited back afterwards so nothing visible changes. With the
   frame around the hole the model continues the occluder: it drew the arms back into the torso.
2. **Limbs** take it well: the hidden elbow end of an upper arm came back as arm.
3. **The torso does not**: its holes are arm- and hand-shaped, and a hole shaped like an arm is
   filled with an arm (klein drew sleeves and a hand). Two things to try with Qwen-Image-Edit, whose
   instruction following T6 already relies on: the torso alone with "the arms removed" as an
   unmasked edit, its result taken only inside the torso's occluded area; and the **redraw** route
   (§2), which leaves the torso only the strips behind the hanging arms. A re-pose edit used as a
   patch for the frame's torso does not work: the redraw is neither aligned with the frame nor
   painted like it (§8.5).
4. **Without the GPU** the occluded pixels are filled from the part's own by OpenCV Telea: right for
   the seam band (≤ 8 px, 27% of the area here), a smear across the rest. The rig is usable at once
   and the smears show only where a part moves off its place; the GPU pass replaces them later.

**The redraw route** runs the same steps 2–7 on the edit model's rest-pose drawing of the
character (one unmasked pass, `inpaint.py repose`). Its joints come from MediaPipe on the drawing;
the frame's joints still give the `frame` clip, so the rig ends in the frame's pose. It is the
remedy for a clip with no good frame (§4.1) and for a limb the frame foreshortens (§7).

### 4.5 Pack

Each part is written on a canvas **centred on its bone** and **turned back into the template's rest
pose** (the template's convention: an image centred on its bone, no offset, image-up = the bone's up
at setup), 1 px = 1 rig unit, at the template's scale (the frame's shoulder width → 280). The
canvases go to the Atlas Maker as one sheet named by part (`torso`, `head`, `upper_arm_l`, …), so
it is an ordinary project sheet (trimmed, optimised, versioned) and ＋ New rig attaches it by name.

### 4.6 ＋ New rig from the template, fitted to the frame

`templateRig(template, regions)` gains a **fit**:

- **Lengths, not directions.** Each chain bone keeps the template's direction and takes the frame's
  length (upper arm, forearm, the chest's height, the neck → head), scaled by the shoulders. Every
  template control and starter clip keys rotations against the same rest pose, so all of them keep
  working; the character's own proportions are kept (NellyAnimTest's arms are 1.17–1.24× the
  template's).
- **The frame is a clip, not the setup.** The frame's pose is keyed at t = 0 of a `frame` animation
  (one rotation per bone: the spine to the hips → shoulders line, the chest to the shoulder line, the
  neck and head to the eyes, each arm segment to its joints). A setup pose equal to the frame would
  make every clip and control play from a raised arm.
- **What carries a length must be refitted with it**: the `shorten` controls move the next joint by
  the template's own length (`per: -n.y`), and the control bones, poles and depths sit at template
  places. The fit rewrites them (phase F2).
- The face block keeps its own layout: NellyAnimTest's eyes are 80 apart, the block's 90, so each
  eye lands 5 px off (the eyes' middle exactly).
- **Props are extra slots**: `{name, bone, before | after}` per prop, its image centred on that
  bone like any part. Not a template part (a template stays the contract every rig of it shares); 📐
  Save as template keeps them as optional parts if the author wants them on every character.

**As built (F2a, 2026-11-21).** `templateRig(t, regions, fit?)` (`rigTemplates.ts`), the fit in
`rigTemplateFit.ts`: `fit = { bones: {name: {x, y}}, frame?: {bone: {rotate, scaleY?}}, props?:
[{name, bone, before | after}], bends?: {part: {bones, ramp, grid?, covers?}} }`.

- **What follows a fitted bone** (by its fitted / template length): every translate drive on it (a
  limb's shortening brings the next joint in by its fitted length; Body side-on's joints) and the
  translate keys of a template's own timeline clips, bezier values included; each control bone (the
  rig-controls names, spaces `hand_ik_l_<space>` included) keeps its place on what it marks; a pole's
  depth scales with the limb above its joint (NellyAnimTest-like arms: the elbow poles −80 → −99.4 /
  −93.4). Image bones sit on their joint at (0, 0) and follow untouched.
- **Refused, with the reason** (a 400 from `/api/rigger/new` and `/upload`, which read the fit
  strictly): an unknown bone, slot, part or field, a value that is not a finite number, a bone turned
  or reversed (0.01° of slack for float noise), one that sits on its parent (no length), one longer
  than 100,000 (its world sums would overflow), a control bone, a scale of 0, a bend the bend
  contract refuses.
- **Props** are slots and optional parts of the fitted template, and join every depth control and 3D
  layer their neighbour is in: the watch and the ring go behind the body with the left arm, the
  glasses and the earring move in depth with the head. A prop without art is listed missing, never
  needed, and its slot starts empty.
- **Nothing new ships** (rule 8): the rig is an ordinary `.irig`. The fit is kept in the bundle's
  `template.json` (`{id, version, fit}`) and `/api/rigger/template` answers the fitted template
  (`sidecarTemplate`), so the Controls, the motion import's solve and a 3D import's first `rig3d.json`
  use the fitted lengths. A kept fit that no longer applies leaves the template as it is (logged).
- **The control layer and 3D IK** (T12a, K4): ＋ New rig's `controls.json` and the template's
  constraints come from the fitted template, so they bind to the fitted bones and the prop slots.
  The layer itself is the template's own. The rings are sized to their joint, and a fit lengthens
  limbs without thickening them. The picker's places are fractions of its board. Its IK squares and
  poles are the control bones above, which keep their place on what they mark. No built-in carries
  translate limits or constraints. A 3D IK (`rig3d.json` `ik`) is made on the rig after it exists,
  and reads the irig's fitted bones and the fitted pole depths. On a fitted arm, K4's own solve
  keeps the hand on the fitted wrist with the IK on, and reaches a moved control with the fitted
  lengths (the gate's `ik3d`).
- **Not yet**: the motion map's shoulder scale (`rig: 280`) assumes the fit keeps the shoulder
  line, as the proof's does (F2b's does: §12); a template's own draw-order keys are not re-indexed
  around props (no built-in has any). The frame-pose alpha IoU of the F2 gate is F2b's (§12).
- **Gate** `tools/rigger-spike/frame-fit.mjs` (headless, engine-rig): a synthetic performer with
  NellyAnimTest's proportions (lengths 0.33–1.3×, every chain joint turned) → its joints → a fit →
  the `frame` clip poses every joint **0.0000** rig units off (Half body 14 joints, Full body 18, Bust
  7); every control at min / rest / max and every starter clip pose finite on the three fitted
  templates (814, 255 and 457 poses, plus the store's pose check); a shortening's next joint lands
  within 0.005 of 0.3 × its fitted length; the 8 / 14 control bones sit 0.0000 from what they mark;
  NellyAnimTest's six props draw where §8.1a puts them; 21 bad fits refused; T12a's control layer
  binds to all three fitted rigs; K4's 3D IK reaches with the fitted arm (10⁻¹² off its length);
  a mutant planted per guard (27), each turning its check red.

### 4.6a ⤢ Fit an existing rig to a capture

A rig made from a template keeps the template's limb lengths; a performer's arms are longer, so 📍
Follow positions (rig-templates §5.8) reaches the tracked wrists with the elbows in the wrong places.
**⤢ Fit rig to the capture** in the 🎥 Motion row refits the open rig to the capture picked there
(`rigCaptureFit.ts`):

- **What is measured.** The lengths following positions reaches with: per limb of the template's
  positions map, the upper bone's (its lower bone's offset) and the lower bone's (its end's offset).
  Per frame where both ends are seen (visibility ≥ 0.5): the length in the picture on the Reference's
  line-up with the tracker's depth between the ends at the frame's pixels per metre — the very point
  the follow aims each joint at. The median over the clip, both sides pooled (one length for both
  arms). Not the tracker's 3D points alone: against their own shoulders they put the arms 20–35%
  shorter than the picture does (NellyAnimTest and the NASA clip), and a rig fitted to them still
  missed NellyAnimTest's elbows by 42.7 (median), against 11.5 this way. Not the picture alone: a
  limb pointing at the camera draws short. The lengths are the overlay's, so a Reference scaled by
  hand fits limbs to the picture where it is drawn.
- **What follows a length** — the rules of `fitLengths` (§4.6), on the rig's own data: the limb
  bones' offsets along their own directions; every animation's translate keys on them, bezier
  values too, except the tracks a 3D clip's bake owns (baked again in the page, and by the save);
  the control bones, each kept on what it marks; in `rig3d.json` the poles' depths and the 3D clips'
  authored translate and depth keys.
- **The art stretches** (owner's choice, 2026-11-21; at most ×1.5 either way since 2026-11-22, §12
  F2c): the limb's image bone takes the ratio on its
  setup scale along the limb, so every point of the art keeps its place along and across it and no
  gap opens at a joint; foreshortening keys stay factors of it, and the 3D bake keeps it. Art drawn
  in the limb bone's own frame (a rig without image bones) is stretched there: a region's place and
  size, a vertex attachment's vertices, the vertices any mesh weights to the bone, their deform keys.
  A bend on the image bones (§4.7) stretches with them, its weights unchanged.
- **One undo step** in the page. The template the page drives the rig with follows the rig's limb
  lengths from then on (an undo too: `templateOnRig`). **Nothing else is written**: the save writes
  the `.irig` as any save does, and `GET /api/rigger/template?dir=…&stem=…` answers the template on
  the limb lengths of the **saved** `.irig`, derived on every read (`sidecarOnRig`). A second stored
  copy of the lengths could only drift: a stale tab's "overwrite with mine", a 🕘 restore, a tab
  closed after its save each rewrite the `.irig` alone. The rest of a frame-made rig's fit (its pose,
  props, bends) is kept from its `template.json`; a rig that does not read, or whose limbs do not fit
  the template, reads the template as stored.
- **Measured** on NellyAnimTest (`invisible_wall/rocketreskintest1`, read-only; Half body, 📍 Follow
  positions, 130 frames): upper arms 190 → 243.9, forearms 170 → 224.9; elbows **54.8 → 11.5** rig
  units (median; p90 80.8 → 29.0), wrists 11.3 → 11.3, shoulders 7.1 → 7.2. The NASA interview (384
  frames): elbows 31.2 → 19.1 (p90 70.0 → 45.4). What is left is the tracker's: its depth spreads a
  length 18–31% over a real clip.
- **Gates** `tools/rigger-spike/capture-fit.mjs` (headless, engine-rig: a synthetic performer with
  arms of known lengths, its forearm toward the camera most of the clip → lengths within 0.5, the
  Follow-positions elbows 43.1 → 1.5 off, as near as the wrists; art, controls, keys, a flat rig, the
  3D bake; 25 mutants) and `capture-fit-browser.mjs` (the shipped page: the button, a fit after an
  import without tracking again, undo and redo, the rig opened again on its saved lengths);
  `check-rigger-writes.ts` for the route (read on the saved lengths, a kept fit, a rig back on the
  template's, one that does not read; nothing written).

### 4.7 Mesh and weight

Half body's segments are rigid regions with round ends (the cut makes the ends), which is the
template's model. What bends: the torso (spine and chest: lean, twist, breath) and, as an option,
an arm as one piece (sleeves, where a round end shows). Both use the template's existing `bend`
(a grid weighted to bones by their place on the image) with the anchors taken **from the frame's
joints**, which the cut knows exactly per character, and a weight that ramps along the limb's axis
across the joint (its width = the limb's width there). That is a one-dimensional blend with known
joints, not the general skinning problem of open item 3 (the proximity skinner), which stays open.

**As built (F4, 2026-11-21).** A bend with `ramp` (`RigTemplateBend.ramp`, set by the fit's `bends`)
weights its grid along the chain of its bones: past each joint the next bone takes over, its share
ramping **linearly** across the limb's width there, so away from a joint a vertex rides one bone
exactly. Linear, not eased: a blend of two turns folds the inside of a bend once the share's slope ×
the limb's half width × sin(bend) passes cos²(bend / 2) — at 90° for a linear ramp as wide as the
limb, at about 67° for an eased one (measured: eased folded from 75°, linear not before 90°). The
grid gains rows across each ramp (its ends, quarters and middle) so the mesh bends where the weights
do: without them the 35° elbow cracked 3 px. Bend grids may now be up to 32 (a fitted bend defaults
to 3 × 32). `covers` names the parts a one piece stands in for: the one-piece arm's forearm is listed
missing, not needed.

- **Torso** on hip, spine and the chest's image bone, joints at the waist and the chest: the lean
  bends it at the waist with the hem on the hips (spine + chest alone would swing the hem with the
  lean), twist and breath bend it at the chest, and Body side-on and a 3D turn still narrow it there.
- **Arm as one piece** (a sleeve) on the upper arm's and forearm's image bones, so a shortening still
  shortens each half.

![The fitted Half body leaning and with the left arm bent 35° and 90°: the ramp mesh, the same mesh weighted by the proximity skinner, and rigid parts cut at the joint; red: what the bent arm should show and nothing covers](frame-to-rig/bend.webp)

Measured by the gate (Half body fitted as above, the left arm 35 units wide; "cracks" is §8.3's 9 px
closing kept inside the bent limb's outline, "gap" every pixel of that outline nothing covers,
"drift" how far the part strays from the bone it should ride):

| Pose                        | Ramp mesh                                        | Proximity skinner, same mesh         | Rigid parts cut at the joint |
| --------------------------- | ------------------------------------------------ | ------------------------------------ | ---------------------------- |
| Lean 20°, twist 12°, breath | 0 cracks, 0 folds; torso top drift 5.9, hem 21.2 | top 49.0, hem 43.5                   | top 0, hem 126.8             |
| Elbow 35° (the proof's)     | **0 cracks**, gap 112 px, 0 folds, ends 0.00     | 0 cracks, gap 2,308, ends drift 11.2 | 36 cracks, gap 354           |
| Elbow 60°                   | 4 cracks, gap 299, 0 folds                       | 0 cracks, gap 4,323, ends 18.7       | 21 cracks, gap 605           |
| Elbow 75°                   | 29 cracks, gap 418, 0 folds                      | 4 cracks, gap 5,380, ends 22.7       | 11 cracks, gap 744           |
| Elbow 90°                   | 7 cracks, gap 519, 2 folds                       | 1 crack, gap 6,143, ends 26.4        | 7 cracks, gap 912            |
| Elbow 120°                  | 0 cracks, gap 1,130, 2 folds                     | 7 cracks, gap 6,818, ends 32.4       | 2 cracks, gap 1,213          |

The one-piece arm bends without a crack through the proof's bent pose, pinches the inside of the
elbow a little past 60° and folds past 75° (any blend of two turns does), and loses a third to a half
of what rigid parts cut at the joint lose, to 90°. The proximity skinner bleeds weight along the whole limb:
its far ends drift 11–32 units off their bones. Past about 90° a sleeve wants a drawn bent pose (an
image swap, F5's kind of edit); rigid parts with round ends (the filled ones) cover any bend.

## 5. Where it runs, and the data

```
Flipbook clip  <c>/<p>/clips/<id>.clip.json → frame region in its sheet (manifests/…)
   │  browser: 🎥 Motion's track (all frames) → scores → chosen frame + joints (+ author's drags)
   ▼
atlas-tool job  rig-from-frame (CPU)                       <c>/<p>/rig-from-frame/<job>/
   frame.png · joints.json · cut (SAM 2.1, onnxruntime) · props (MediaPipe segmenter, 16 MB)
   · masks · whole/occluded · report.json
   │  fill (queued, RunPod serverless; ONE job per character: every part's pass, or the redraw)
   ▼
parts/<part>.png + prop_<name>.png (canvas on its bone) → Atlas Maker sheet + manifest (named)
   │  manifests/atlas_manifest_<Name>_parts.json · sheets/<Name>_parts/…
   ▼
launcher  POST /api/rigger/new { manifestKey, templateId, fit }   spines/<name>/ .irig + template.json
```

- **atlas-tool, not the browser, cuts**: the job also writes the parts and the sheet, and SAM 2.1
  small is ~180 MB of weights a page would load per session. atlas-tool today is Pillow only; it
  gains `numpy`, `opencv-python-headless` and `onnxruntime` (no torch), with the SAM 2.1 export
  checked against the torch reference measured here (phase F1).
- **The GPU only fills**, so a cut can be made and reviewed with the RunPod account empty.
- **Rule 8: nothing new ships.** The parts are an ordinary sheet and the rig an ordinary irig bundle,
  exported by the chain rigs already travel. `rig-from-frame/<job>/` is authoring scratch (the
  T6 cutter's output is the same kind) and is never baked.

## 6. UI

In the Rigger, **＋ New rig** → template → art: **From a Flipbook frame** (beside a sheet and
uploaded images):

1. Pick the clip (the picker 🎥 Motion uses). The track runs once; a strip of frames shows each
   score and why (a short limb, a hand over the body); the best is selected.
2. **✂ Cut** (seconds): the parts over the frame in their colours, the joints draggable, a brush to
   move a patch to another part, the template parts it cannot make listed (face shapes, hand poses).
   Each prop is listed with its name and bone, ✓ / ✗, and whether it rides, swings or comes off.
3. **🎨 Fill** (queued GPU job, status like a generation): each part whole, its made pixels
   outlined; ↻ per part (new seed). With the GPU down the CPU fill is used and marked.
4. **Create rig**: the sheet is written, the rig made fitted, the `frame` clip added; the report
   lists what is missing, as a template create does today.

The Flipbook gets **🦴 Rig from this frame**, which opens the Rigger with the clip and frame chosen
(a full-page navigation, not an iframe).

## 7. Failure modes

| Case                                   | What happens                                                                                                                                  | Answer                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| A limb toward the camera               | it is cut short (frame 0's right forearm 0.27); its joints nearly meet, so the prompts cannot split it (SAM gave half of it to the upper arm) | the picker avoids it; else the redraw route (§4.4)                                                   |
| A hand over the body or the face       | a large occluded area (the torso's 39k px here)                                                                                               | the fill; over the face, the face block's parts cannot be cut — pick another frame                   |
| Props on the body                      | the segmenter missed the pendant (read as clothes) and the ring on the right hand; SAM's glasses box took a few hairline specks               | SAM grows a found piece (the pendant came with the chain); the brush adds or removes a prop's pixels |
| Hair read as a hat                     | the segmenter calls a painted hair-do an accessory                                                                                            | never taken automatically: the author confirms a prop on top of the head                             |
| Sunglasses, a mask, a hat over eyes    | cut out as a prop (§4.3a); behind it there are no eyes to cut                                                                                 | the prop rides the face and the eyes stay hidden, or T6 edits draw eyes if it comes off (§11)        |
| Loose clothing, long hair, a tail      | one image spans several bones; hair behind the shoulders is not split                                                                         | a `bend` mesh on the bones it spans; `hair_back` / `hair_front` by hand for now                      |
| A ¾ or side frame                      | the template is drawn facing the viewer; one angle only                                                                                       | the frame is the drawing for its angle; others from Qwen turn passes (rig-2p5d §4.7, T6)             |
| Fingers                                | segments too small to cut                                                                                                                     | whole hands; drawn poses (open, fist, point, thumbs up) as edit passes, optional                     |
| MediaPipe misses or swaps a joint      | the cut follows it                                                                                                                            | drag the joint; the cut reruns in seconds                                                            |
| Masked inpaint                         | the model redraws the occluder into a hole shaped like it                                                                                     | part-alone passes; the torso is the open case (§4.4)                                                 |
| A filled part drawn over its neighbour | in the frame pose the filled parts differ from the frame by 4.4 / 255 on average                                                              | only the occluded pixels are made; the frame's own pixels elsewhere                                  |

## 8. The proof (NellyAnimTest frame 0, `invisible_wall/rocketreskintest1`, read-only)

720 × 720, the character 253,279 px (the clip's frames carry alpha). Track: the 🎥 Motion capture of
the whole clip made for §5.8 of rig-templates (the Rigger's own bundle in Chrome). Template: Half
body 3 built by `templateRig` and posed by engine-rig (`tools/frame-to-rig/rig-pose.mjs`). Run:

```
python tools/frame-to-rig/proof.py pick    --track cap.json --out out
node   tools/frame-to-rig/rig-pose.mjs --geometry geometry.json
python tools/frame-to-rig/proof.py segment --frame frame0.png --track t0.json --out out --models tiny,small
python tools/frame-to-rig/proof.py props   --out out --geometry geometry.json --segmenter selfie_multiclass_256x256.tflite
python tools/frame-to-rig/proof.py holes   --out out --geometry geometry.json
python tools/frame-to-rig/proof.py parts   --out out --geometry geometry.json
node   tools/frame-to-rig/rig-pose.mjs --fit out/fit.json out/posed.json
python tools/frame-to-rig/proof.py compose --out out --posed out/posed.json
python tools/frame-to-rig/inpaint.py inputs|graph|run|merge|repose --out out --model qwen|klein
python tools/frame-to-rig/track.py --image still.png --out track.json [--bg 255]   # a still the page never tracked
```

Python: numpy, opencv-python-headless, pillow, torch (CPU) + torchvision, transformers ≥ 4.56,
mediapipe (the segmenter from MediaPipe's model storage, `selfie_multiclass_256x256`, float32).

### 8.1 Cut — steps 2–3 on CPU

![The cut: joints only (left) against SAM 2.1 small prompted by the joints (right)](frame-to-rig/cut.webp)

SAM 2.1 through `transformers` 5.24 on torch 2.15 CPU (a 22-thread laptop): **tiny 1.9–3.0 s, small
2.0–3.1 s** for the image and all eight prompts. Left to the capsule fallback: tiny 19%, small 15%
of the character (mostly edges between parts). IoU per part:

| Part                    | SAM tiny vs small | small vs joints only | Note                                                              |
| ----------------------- | ----------------- | -------------------- | ----------------------------------------------------------------- |
| torso                   | 0.925             | 0.845                | the chain and pendant stay on it                                  |
| head                    | 0.940             | 0.932                | hair, ear, the neck's visible skin                                |
| upper arms              | 0.928 / 0.920     | 0.80 / 0.76          | joints-only cuts the shoulder on a circle, SAM on the outline     |
| forearm `_l`            | 0.960             | 0.817                | splits at the bracelet                                            |
| hand `_l`               | 0.978             | 0.871                | fingers whole                                                     |
| hand `_r`, forearm `_r` | 0.73 / 0.73       | 0.47 / 0.49          | the foreshortened arm: SAM gave half the forearm to the upper arm |

Recommendation: **small** (same cost, steadier on the hands), with the joints-only capsules as the
fallback the partition already uses. Neither needs a GPU.

### 8.1a Props

![Props found and cut (white); the props alone; the rig with its props hidden, showing what they cover](frame-to-rig/props.webp)

| Prop             | Segmenter px | With SAM | Rides         | Drawn                           | Taken from                  |
| ---------------- | ------------ | -------- | ------------- | ------------------------------- | --------------------------- |
| `prop_chain`     | 6,871        | 9,978    | `chest`       | before `neck`                   | torso 8,398, head (neck)    |
| `prop_glasses`   | 5,323        | 6,103    | `face`        | before `hair_front`             | head                        |
| `prop_wrist_l`   | 2,758        | 3,230    | `lower_arm_l` | after the left arm's last slot  | forearm 2,650, hand         |
| `prop_wrist_r`   | 2,184        | 2,784    | `lower_arm_r` | after the right arm's last slot | hand 1,778, forearm 1,006   |
| `prop_ring_l`    | 169          | 367      | `hand_l`      | after the left arm's last slot  | hand                        |
| `prop_earring_l` | 165          | 299      | `head`        | before `hair_front`             | head                        |
| not taken        | 7,371        | —        | —             | —                               | the cornrows, read as a hat |

The segmenter took 1.2 s on CPU. It scored the pendant as clothing; SAM, prompted from the chain
with its box reaching down, brought the pendant in. It missed the ring on the right hand (pink in the
overlay) and SAM's glasses box took a few specks of the hairline: the brush's work. Props drawn
over their hosts leave the frame unchanged (alpha IoU 0.998, colour error 2.89).

### 8.2 Holes — what step 4 must cover

![Each part's visible pixels and, in magenta, what must be made](frame-to-rig/holes.webp)

With the props cut out (the numbers without props: 64,816 px, 25.6%, all under body parts):

| Part           | Visible                   | Under body parts — **must be made** | Under props — if the prop moves | Seam band ≤ 8 px | Deeper | Deepest | Under                              |
| -------------- | ------------------------- | ----------------------------------- | ------------------------------- | ---------------- | ------ | ------- | ---------------------------------- |
| torso          | 96,872                    | **39,142** (27% of the whole torso) | 9,586 (the chain)               | 17,643           | 31,085 | 72 px   | upper arms 24.8k, right hand 13.6k |
| upper arm `_l` | 21,686                    | **10,620** (30%)                    | 6                               | 2,171            | 8,455  | 83 px   | its forearm 9.0k, hand 1.6k        |
| upper arm `_r` | 26,525                    | **5,576** (16%)                     | 1,696 (the watch)               | 2,101            | 5,171  | 41 px   | its forearm 6.3k                   |
| forearm `_l`   | 14,195                    | **3,356** (16%)                     | 3,230 (the bracelet)            | 1,195            | 5,391  | 53 px   | its hand                           |
| forearm `_r`   | 6,049                     | **2,714** (22%)                     | 2,383 (the watch)               | 1,002            | 4,095  | 51 px   | its hand                           |
| head           | 35,096                    | 0                                   | 6,064 (glasses, earring)        | 3,652            | 2,412  | 25 px   | —                                  |
| hands          | 30,095                    | 0                                   | 3,558 (watch, bracelet, ring)   | 2,068            | 1,490  | 19 px   | —                                  |
| **All**        | 230,518 + 22,761 in props | **61,408 (24.2%)**                  | **26,523**                      | 29,832           | 58,099 |         |                                    |

Besides these, 11,160 px of joint ends lie over the part behind and take the frame's own pixels.

### 8.3 Rig — step 6, posed through engine-rig

![The frame; engine-rig's joints (magenta) on MediaPipe's (yellow); the rig in the frame pose, bent, at rest and with its props hidden — with visible-only parts and with CPU-filled parts](frame-to-rig/rig.webp)

The sheet, every region named as the template and the props name it (each canvas centred on its
bone and turned to the rest pose; the Atlas Maker trims the empty margins when it packs):

![The parts and props on one sheet, named](frame-to-rig/sheet.webp)

With the six props on their own slots (14 attachments). Fit: 0.942 rig units per px (shoulders 298 px → 280). Fitted against the template: upper arms 236 /
222 (template 190), left forearm 203 (170), right forearm 56 (foreshortened, 3D says 0.27 of it),
chest 185 (150), neck → head 52 (40).

| Check (engine-rig quads drawn over the frame)                 | Visible parts only | CPU-filled parts |
| ------------------------------------------------------------- | ------------------ | ---------------- |
| Shoulders, elbows, wrists, the eyes' middle vs MediaPipe      | 0.0 px             | 0.0 px           |
| Each eye (the face block's 90 against the frame's 80)         | 5.15 px            | 5.15 px          |
| The frame pose: alpha IoU / mean colour error                 | 0.998 / 2.89       | 0.991 / 4.39     |
| A bent pose (every arm joint 25–35°, head 12°): cracks ≤ 9 px | 1,582 px           | 408 px           |

At rest (arms hanging) the visible-only parts show the torso's holes under the shoulders and the
forearm stub; the CPU fill closes the cracks but smears every interior — hence §4.4's GPU pass. The
seven required parts the rig reports missing are all the face block's (closed eyelids, neutral brows,
mouth rest / A / O): T6's edits, not this pipeline.

### 8.4 Fill — step 4

RunPod is unfunded, so the Qwen-Image-Edit-2509 graphs are prepared, not run (`inpaint.py graph
--model qwen` writes one API graph per part; ComfyUI core nodes only: `TextEncodeQwenImageEditPlus`,
`SetLatentNoiseMask`, `ImageCompositeMasked`, the T6 blueprint's sampler settings). As a stand-in,
**FLUX.2 [klein] base 4B** (Apache-2.0) ran on the owner's local ComfyUI (RTX 4070 Laptop, 8 GB,
shared with other apps):

![klein base 4B: torso with the frame around the hole; torso alone; upper arm alone](frame-to-rig/fill.webp)

| Pass                             | Result                                                          | Time                                                      |
| -------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------- |
| Torso, the frame around the hole | **drew both arms and the hand back** into the hole              | 146 s (cold)                                              |
| Torso, the part alone            | **drew sleeves and a hand** — the holes are arm-shaped          | 69 s (warm)                                               |
| Upper arm `_l`, the part alone   | the hidden elbow end came back as arm (with an invented tattoo) | 4,050 s (VRAM shared with other apps; not representative) |
| Re-pose (arms down, whole frame) | a clean rest-pose drawing, §8.5                                 | 111 s (warm)                                              |

Both torso passes said "Do not draw arms, hands or fingers"; klein 4B ignored it. Hence part-alone
passes for limbs, the open torso case (§4.4) and Qwen-Image-Edit as the default model.

### 8.5 Redraw, then cut

![klein's rest-pose redraw of frame 0; the same cut on it; what it leaves to make](frame-to-rig/repose.webp)

One unmasked klein base 4B pass ("the same character standing with both arms hanging straight down
… same character, face, glasses, jewellery, clothing, tattoos, colours, art style, size and
framing", 111 s). It kept the glasses, the chain and pendant, the bracelet, the watch and the arm
tattoo; it **did not keep** the framing (it zoomed out to mid-thigh) or the finish (flatter, cleaner
line work than the frame's painting). MediaPipe in Python with the Rigger's own models found the
face, body and both hands on it (on frame 0 the same script agrees with the page's track within
1–7 px, the right elbow 23). The same cut, holes, fit and engine-rig check:

| On the redraw (1024², character 368,918 px)    | Redraw                                      | Frame 0 (§8.2–8.3)                 |
| ---------------------------------------------- | ------------------------------------------- | ---------------------------------- |
| Arm segments' drawn / 3D length                | 0.93–1.23                                   | 0.27–1.05                          |
| Must be made                                   | 65,988 (17.9%)                              | 64,816 (25.6%)                     |
| … of it in the arms                            | 15,808 (joint ends)                         | 25,674 (behind forearms and hands) |
| … of it the torso                              | 50,180 (the strips behind the hanging arms) | 39,142                             |
| Seam band / deeper                             | 22% / 78%                                   | 27% / 73%                          |
| Joints vs MediaPipe; each eye                  | 0.0 px; 10.0 px                             | 0.0 px; 5.15 px                    |
| Its own pose redrawn: alpha IoU / colour error | 1.000 / 3.96                                | 0.998 / 2.65                       |
| Bent pose cracks, visible / CPU-filled         | 1,443 / 660 px                              | 1,927 / 443 px                     |

SAM left 36% of the redraw to the capsules: the jeans below the waist, which no Half body prompt
names (the template's `pelvis` is optional). The torso's sides behind the arms must be made in any
pose (they show whenever an arm lifts): the redraw shrinks the arms' holes, not the torso's.

### 8.6 Run the GPU half when RunPod is funded

The same model as T6, so one transfer serves both:

1. Top up RunPod; `/comfyui` → What's installed → transfer
   `qwen_image_edit_2509_fp8_e4m3fn.safetensors` (the URL is in
   `services/atlas-tool/blueprints_src/qwen_bust_face_variant/blueprint.json` → `models`) and check
   `qwen_2.5_vl_7b_fp8_scaled` and `qwen_image_vae` are on the volume.
2. Start an R&D pod; set `COMFY=https://<pod>-8188.proxy.runpod.net`.
3. `python tools/frame-to-rig/inpaint.py inputs --out out`, then `graph --model qwen`, then
   `run --model qwen --comfy $COMFY`, then `repose --model qwen --run --comfy $COMFY`.
4. `inpaint.py merge --out out --model qwen`, `proof.py parts`, `rig-pose.mjs --fit`,
   `proof.py compose`: the `made-qwen` row joins the table in §8.3 and the pictures.
5. Stop the pod.

## 9. Cost per character

- **CPU (atlas-tool):** the cut 2–3 s here, perhaps 5–15 s on a shared Railway vCPU; holes, parts
  and packing under a second each.
- **GPU (RunPod serverless, Qwen-Image-Edit-2509 fp8, ~1 MP, 20 steps):** about five passes (the
  torso, two upper arms, two forearms; the redraw route adds one). The fleet measured Qwen-Image at ~15 s warm and 130–200 s
  cold on the network volume (status/comfyui §16); an edit reads the reference too, so ~20–40 s a
  pass. One job per character loads the model once: **~3–6 GPU-minutes, ≈ $0.04–0.10** at
  $0.70–1.00/h; three retries per part stay under $0.30.
- **Optional:** the face block from T6's twelve edits (+~5 min), four hand poses per hand (+~4 min),
  two to four turn drawings for 2.5D (+~2 min).

## 10. Build plan

| Phase                             | Size | Delivers                                                                                                                                                                                                                                                                                                          | Gate                                                                                                                                 |
| --------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **F1 — Frame + cut**              | M    | the scored frame strip from 🎥 Motion's track; atlas-tool `rig-from-frame` cut job (SAM 2.1 small via onnxruntime, prompts, partition, capsule fallback) and its props step (the multiclass segmenter, naming by joints, SAM growth); the cut screen (parts and props, draggable joints, a brush, ✓ / ✗ per prop) | the ONNX cut against this proof's torch cut on a committed CC-BY frame (IoU per part); the score on fixed tracks                     |
| **F2 — Parts, sheet, fitted rig** | M    | whole / occluded / overlap, canvases on bones turned to rest, CPU seam fill, Atlas Maker manifest; `templateRig` with a fit (lengths, the drives and control bones that carry lengths), the `frame` clip                                                                                                          | this proof's engine-rig check as a spike: joints ≤ 0.5 px, frame-pose alpha IoU ≥ 0.99, every template control and clip poses finite |
| **F3 — Fill on the GPU**          | M    | a `qwen_part_fill` blueprint (part-alone masked pass; the rest-pose redraw), one serverless job per character, the review screen with ↻ per part, the redraw route as a choice; CPU fill as the fallback                                                                                                          | blocked on RunPod funding: §8.6 on NellyAnimTest, judged by eye; a fixed fake ComfyUI for the job's plumbing                         |
| **F4 — Bending parts**            | S    | torso `bend` mesh on spine + chest, optional one-piece arm, anchors and axis-ramp weights from the joints                                                                                                                                                                                                         | a lean and a bent elbow with no crack, through engine-rig                                                                            |
| **F5 — Face, hands, angles**      | M–L  | T6's face edits on the cut head (mouth shapes, closed eyes, brows), hand poses, turn drawings (rig-2p5d §4.7); props over the eyes per §11                                                                                                                                                                        | a talk loop and a blink on a frame-made rig                                                                                          |
| **F6 — Entry points + docs**      | S    | 🦴 Rig from this frame in the Flipbook; `docs/tools/rigger.md` section                                                                                                                                                                                                                                            | docs-keeper audit                                                                                                                    |

F1 and F2 need no GPU and deliver a usable rig (CPU-filled seams). F3 waits on the RunPod top-up,
like T6; F5 needs F3's GPU path.

## 11. Open questions for the owner

1. **Default frame** — the best-scoring frame (recommended), or always the first?
2. **Which art route leads** — cut the frame (its own pixels; holes behind hands and forearms) or
   redraw in the rest pose, then cut (whole limbs; the art is the model's redraw)? Recommended:
   decide on Qwen-Image-Edit's run of both (§8.6), on NellyAnimTest and one more clip; offer both.
3. **Fill model** — Qwen-Image-Edit-2509 on RunPod (recommended; ~$0.10 a character; needs the
   top-up and the 20 GB model on the volume, which T6 needs too), or FLUX.2 klein base 4B (runs on
   an 8 GB card, but did not follow "no arms" in §8.4)?
4. **Proportions** — the character's own limb lengths on the template's skeleton (recommended), or
   the template's lengths with the art squeezed to fit?
5. **Props** — which ones swing (a pendant on a physics constraint, so what it covers is made) and
   which can come off (glasses: the eyes behind them are drawn, which changes the look)? Default
   proposed: everything rides its bone and nothing under it is made until the author ticks it.
6. **A foreshortened limb** — take the redraw route for that character, or require a frame without one?
7. **The face** — run T6's twelve face edits on every frame-made rig (+~5 GPU-min), or leave the
   face still until asked?

## 12. As built

### F1 — Frame + cut (2026-11-21)

**Where it runs.**

- **Browser.** `$lib/rigFrameScore.ts` (in `vendor/rigger-motion.js` as `RiggerMotion.scoreFrames`)
  scores the track 🎥 Motion's tracker makes (§4.1). The Rigger's ＋ New rig → **🎞 From a
  Flipbook frame** screen (`static/rigger/view.html`) shows the strip, the draggable joints, the cut
  over the frame, the brush and the props list; the tool guide is `docs/tools/rigger.md`.
- **Launcher.** `POST /api/rigger/from-frame` resolves the clip frame to its sheet page, its region
  and the clip's canvas — the largest untrimmed frame, as `clipFrames` draws every frame, so the
  track's normalised points land on the cut's pixels — and the template to its slots
  (`$lib/server/rigFromFrame.ts`), then calls atlas-tool with an `api` launch token.
  `POST /api/rigger/from-frame/edits` keeps the brushed label map (refused unless it is the frame's
  size, keeps the character's outline and names only the cut's parts; stored as 8-bit grey) and the
  props' ✓ / ✗ and motion, compare-and-swap on `cut.json`.
- **atlas-tool.** `POST /rig-from-frame` → `rig_from_frame.py`, inline like `/lipsync`, one cut at a
  time per process; the frame's SAM features are kept, so a re-cut after a joint drag runs the
  prompts alone.

**What a cut writes** to `<client>/<project>/rig-from-frame/<job>/` (authoring scratch, never
baked): `frame.png` (the frame at full size, with alpha), `track.json` (the joints as cut, drags
included), `labels.png` (8-bit: each pixel the index of its part or prop in `cut.json`'s `names`,
255 outside the character — the masks per part as one image, so a pixel is in exactly one part and
the brush edits one thing), `overlay.png` and `cut.json` (`names`; `parts` with their pixels; `props`
`{name, bone, before | after, host, px, from, take, motion}`; the `rejected` pieces and why; `stats`,
`timings`, `source`, `size`, `template`, `neck: false`). A prop left ✗ keeps its pixels and is drawn
into its `host`, so the choice is reversible; F2b reads `take` and `motion`.

**The models are on R2, not in the image**: `_shared/models/rig-from-frame/<sha12>/<file>`, pinned
by SHA-256 and size in `rig_from_frame.MODELS`, fetched once into the staging disk and refused when
the hash differs (`RIG_FROM_FRAME_MODELS` names a local folder instead, for development and the
parity gate). `tools/frame-to-rig/export_models.py sam | segmenter | push` makes and uploads them.
Both exports are byte-deterministic — SAM through `torch.onnx.export` (transformers 5.24, torch
2.15), the segmenter through tf2onnx 1.17 once the constants it names with run-to-run counters are
renamed by first use — so a re-export reproduces the pins.

| File                              | What                                                                         | Size     |
| --------------------------------- | ---------------------------------------------------------------------------- | -------- |
| `sam2.1-hiera-small.encoder.onnx` | `facebook/sam2.1-hiera-small`'s image encoder, the no-memory embedding added | 138.0 MB |
| `sam2.1-hiera-small.decoder.onnx` | its prompt encoder and mask decoder: one mask, SAM 2.1's stability fallback  | 20.7 MB  |
| `selfie-multiclass-256.onnx`      | MediaPipe's `selfie_multiclass_256x256` float32, class logits                | 16.4 MB  |

**Matching the references.** SAM: a Pillow bilinear resize to 1024² and ImageNet normalisation is
exactly what `Sam2Processor` does (2e-7); prompts are scaled by 1024 / w and 1024 / h; the 256²
logits come back with a bilinear resize (as `post_process_masks`). MediaPipe's ImageSegmenter samples
the picture onto 256² with an affine warp — no half-pixel shift, edges replicated — scales it to
[-1, 1], soft-maxes the class logits and only then resizes up; any other recipe (a Pillow or area
resize, [0, 1], resizing before the softmax) is off by 0.008–0.015 on average and finds a different
accessory mask (IoU 0.60–0.77).

**Measured.**

- **Parity, ONNX against torch.** On frame 0 (the eight part prompts): logits within 2.2e-4, no
  pixel different, IoU 1.000 for every part. On the committed fixture (eight parts and three prop
  prompts): IoU 1.000, logits within 1.8e-4, the partition IoU 1.000. The segmenter: within 3e-7 of
  MediaPipe's confidence on the fixture; the accessory mask on frame 0 at IoU 0.998.
- **Props** on frame 0 through the job: the proof's six (glasses, earring, both wrist pieces, the
  chain with its pendant, a ring); the cornrows not taken.
- **Time**, the job in a requirements-only venv on the owner's laptop CPU held to one or two threads
  (a stand-in for Railway's vCPU, likely slower per thread): models loaded in 2.1–2.9 s once fetched;
  a cut of the 720² frame 7.8 s on one thread (SAM's encoder 4.8 s of it), 4.8 s on two (2.5 s); a
  re-cut of the same frame after a drag 2.3–2.8 s.
- **Memory**: 0.87 GB at a cut's peak, 0.3 GB after, with onnxruntime's arena off (with it, 1.8 GB,
  and it keeps it).
- **The image grows by 296 MB installed** (103 MB of wheels, linux x86-64, Python 3.12):
  opencv-python-headless 5.1 172 MB, onnxruntime 1.32 72 MB, numpy 2.5 50 MB, and onnxruntime's
  protobuf, flatbuffers and packaging. opencv 4.12 would save 28 MB but holds numpy below 2.3. The
  175 MB of models stay out.

**Gates.** `services/atlas-tool/test_rig_from_frame.py` (CI): the fixture — a half-body character
drawn by `tools/frame-to-rig/make_fixture.py` (no licence question), its joints fixed, torch's mask
recorded for every prompt — cut end to end with SAM answering the recorded masks: the prompts, the
partition (front to back, the capsule fallback, islands), the neck off, the props named and the hair
cap not taken, a frame packed turned, the refusals, the pinned models, SAM's and the segmenter's
plumbing, the five files; 16 mutants caught. `test_rig_from_frame_parity.py` (needs transformers and
mediapipe, so CI lists it as skipped; run it where the export runs): ONNX against torch live and
against the committed reference, the segmenter against MediaPipe; a cv2 resize, points half a pixel
off and a Pillow-resized segmenter input are each caught. `check:rig-frame-score`: the scorer on
made-up tracks (9 mutants caught); it reproduced the proof's 130 rows on NellyAnimTest exactly.
`check:rig-from-frame`: the launcher half (6 mutants caught; it found sharp writing the grey label
map as RGB).

**Departures from §4–§6.**

- The page uploads no frame: the launcher names the sheet page and region and atlas-tool reads it
  from R2, at full size with alpha (the tracker's copy is at most 640 px, on grey).
- The template drives the cut: its draw order is the partition's front to back, its slots the props'
  before / after. A template without the Half body parts (Bust with face, Full body) is refused.
- One label map rather than a mask per part.
- A frame with its background painted in (98% opaque or more) is refused rather than cut.

**Owed.**

- The three model files must be on R2 before the cut works live: `export_models.py push --out
<folder>` with the R2 env, the folder holding the pinned files and their `models.json`.
- Not verified on the authed page: verified end to end in a local harness (the static Rigger page,
  faked reads, the real job and models): track, score, drag a joint, cut, brush, ✓ / ✗, keep.
- The non-SAM part of a cut (~1.5–2 s: finger capsules drawn over the whole frame, PNG
  optimisation) is a re-cut's floor; trimming it waits for a reason.

### F2b — Parts, sheet, 🦴 Create rig (2026-11-22)

The owner, 2026-11-22: "I managed to cut the image, but there is no way to save it or create it!"
The dialog now ends in **🦴 Create rig** (§6 steps 3–4, the GPU 🎨 Fill aside).

**Where it runs.**

- **Launcher.** `POST /api/rigger/from-frame/sheet` (`{job, etag, name}`) reads the cut's
  `cut.json` (409 unless it is the one the page shows) and `track.json`, fits the template to the
  joints and places every part in the frame's pose (`$lib/server/rigFrameFit.ts`
  `framePartsRequest`), and asks atlas-tool for the sheet `<name>_parts`. The page then creates the
  rig through `/api/rigger/new` with `{manifestKey, templateId, fit}`, as any template create:
  claim, `.atlas`, `template.json` with the fit, `controls.json`, reindex, the missing-parts report.
  A taken rig name is refused before anything is made. `GET /api/rigger/from-frame?clipId=` lists the
  clip's kept cuts (the newest per frame): the dialog opens the newest at once, before the track, and
  a frame with one opens it, so a kept cut goes straight to Create rig. A cut now names its clip and
  frame (`cut.json` `clip`); one made before is matched by the page and region it was cut from.
- **The fit** (§4.6, as `proof.py fit()`): the scale is the template's shoulder width over the
  frame's, the origin the hips' middle; the chest sits on the shoulder line, the head on the eyes'
  line (each eye's centre, not its corner), each limb aims at its next joint and takes its length
  (chest, neck → head, forearms, hands), each hand turns to its middle finger's knuckle along the
  template's own direction to it. The placements are read off engine-rig posing the fitted rig by its
  `frame` clip (each attachment's corners), so a template's part placement is honoured.
- **atlas-tool.** `POST /rig-from-frame/parts` → `rig_frame_parts.py`: whole / occluded / overlap
  (§4.4: the proof's shapes, plus the pixels of each taken prop on its host, and a ✗ prop drawn into
  its host), the outline's soft edge (alpha 1–127) given to the part beside it, each canvas warped
  through the inverse of its attachment's matrix (premultiplied; a frame drawn at under 0.75 rig
  units per pixel is averaged down first), the occluded pixels filled by Telea, and one sheet written
  with `video_to_clip.write_page` (page, TexturePacker JSON, manifest stamped `rig_from_frame.job`):
  the same cut may write it again, any other sheet of that name is never overwritten. `parts.json`
  keeps the report beside the cut. `fill` takes `cpu` only; `gpu` is F3's.

**Departures.**

- **Untrimmed canvases.** A template image is centred on its bone, so a limb's canvas is half empty
  (the image bone is at the joint); the page is still ~1.1k² for a 720² frame. Trimmed, the manifest's
  top-down `offY` would reach the rig `.atlas` as a bottom-up offset.
- **The fill reads the part three canvas pixels in from its edge**, then the part's own pixels go
  back over it: the part's edge against what covers it is often that part's drawn outline, which
  otherwise streaked dark lines across the fill.
- **No bends.** A bending torso (§4.7) posed by the frame clip moves its hem off the canvas it was
  cut on; parts stay rigid with round ends until the canvas is un-skinned. (Superseded by F2f:
  every part is skinned, bound in the frame's pose, so nothing needs un-skinning.)
- **The picker**: an arm segment with a joint past the frame's edge costs 0.5 and says so. Frame 113
  of NellyAnimTest scored 1.00 with its right forearm outside the picture (the tracker places the
  wrist and elbow at x = 740 and 837 of 720, visibility 1.0).

**Measured.**

- **The fixture** (the F1 gate's drawn character, cut with its props): every shoulder, elbow, wrist
  and the eyes' middle **0.0000 px** from the cut's joints, the eyes' line 0.0000° (also on the frame
  turned 14° at 0.8 its size); the rig drawn from the sheet by engine-rig in the `frame` pose covers
  the frame at **alpha IoU 1.0000**, colour 1.99 / 255; the fitted template with its props passes the
  store's pose check (69 controls, 8 clips); 7 parts needed and not made, all the face block's.
- **NellyAnimTest frame 113** (the owner's kept cut, read-only, run locally): the parts in 1.3 s on
  the laptop CPU; drawn back, IoU 0.9991, colour 1.61; filled on the CPU 32,733 px of torso (21,200
  deeper than 8 px), 16,790 of the left upper arm; the right forearm cut off by the frame (1.0, its
  670 px are the wrist strip at the edge) and the right upper arm half (0.52). The hand_r / lower_arm_r
  split there is the frame's, not the cut's: 11,196 of hand_r's 11,398 px lie beyond the wrist.

**Gates.** `tools/rigger-spike/frame-rig.mjs` (the F2 gate: the request the launcher sends is the one
the committed sheet was made from; joints; redraw IoU ≥ 0.99; finite; 14 mutants);
`services/atlas-tool/test_rig_frame_parts.py` (the cut fixture is F1's, the sheet is this job's;
partition with a soft edge; occluded / overlap by draw order; the CPU fill painted from the part and
marked; canvases turned to rest; drawn back IoU ≥ 0.99; ✗ props; cut off; the project sheet, its
stamp and refusals; 10 mutants); `tools/rigger-spike/frame-rig-browser.mjs` (the shipped page: a kept
cut opens with no track, a ✗ prop kept first, the sheet on its ETag, the rig created with the fit
and opened with its `frame` clip, the report, a taken name); `check:rig-from-frame` (kept cuts by
clip and by pixels); `check:rig-frame-score` (a segment out of the picture). The fixture chain is
remade by `py test_rig_frame_parts.py --write-cut`, `node frame-rig.mjs --write`, `py
test_rig_frame_parts.py --write`.

**Owed.**

- Not verified on the authed page against R2 and the live atlas-tool: verified in Chromium on the
  shipped page with the API faked by the shipped fit and the committed sheet, and the job run locally
  on the owner's frame.
- A limb's round end over the part behind keeps the frame's pixels (§4.4), so at rest a sleeve
  carries a wedge of shirt at the shoulder. Making those pixels from the limb instead would change
  the frame pose there: the owner's call.
- F3: the GPU fill (`FILLS` and the `fill` field are its seam).

### F2c — The owner's first run, fixed (2026-11-22)

The owner ran 🦴 Create rig on `invisible_wall/rocketreskintest1`, NellyAnimTest, Half body, and
reported five problems. This is the fix for four of them and for the prop bones and the stretch
bound of the fifth; per-part frames and the prop editor are a second change.

**What was wrong**, reproduced locally on the owner's kept cut of frame 113 (read-only), the
shipped fit and parts job, and 🎥 Motion's import of the NellyAnimTest capture run headless:

- **The head and the neck.** The cut had no neck (`neck: false`), so the neck's skin was in the head
  image, which turns on the head bone; and the glasses rode `face`, whose bones the face block's
  parallax moves under a 3D head turn while the eyes are painted on the head image: under the
  capture the glasses left the eyes (2–6 s of the clip). The head image itself stayed on its bone.
- **The stretch.** Not reproduced: the rig made from the kept cut and that capture draw the raised
  arm in proportion. A part is never stretched at create (its canvas is the frame turned to rest at
  the fit's scale); what can stretch it is ⤢ Fit rig to the capture, which scaled the art by the
  capture's length over the rig's with no bound, and a limb the frame draws pointing at the camera
  takes a short bone. So the bound below, and the report.
- **The fingers.** The hand was a region on `hand_*`, its finger bones where the template puts them,
  not on the drawn fingers: a curl moved bones beside the art.
- **The fill.** A limb's hidden part was a capsule of one width (the 90th percentile of the visible
  half width) filled by Telea: upper_arm_l made 16,790 px of a blob past its drawn edge.
- **Prop bones.** A prop's slot rode its host's bone; it had no bone to pivot, swing or key.

**As built.**

- **Neck** (`rig_from_frame.split_neck`): not prompted; the head's and the torso's pixels below the
  jaw (outside the face mesh's hull), down to the shoulder line, within the neck's half width of
  its axis (the jaw's middle → the shoulders' middle; 0.42 × the jaw corners apart, at least 0.2 ×
  the shoulders, as a turned head draws its jaw short), the biggest piece, none under 40 px. Its
  slot is the template's `neck` on the neck bone; the chain is drawn **after** the neck (over it,
  under the chin). A kept cut from before has none: the dialog and the report say ✂ Re-cut.
- **Props on bones of their own** (`RigFitProp.at`): each taken prop is a bone of its name, a child
  of the bone its host part is drawn on when the cut named that bone or the one it hangs from
  (`head_image` for the glasses and earrings, `torso_image` for the chain, the forearm's image for a
  watch), at its pivot — the middle of its pixels' box on the label map, the top middle of one that
  swings (`propPivots`); a ring on the hand hangs from the finger segment nearest it once the
  fingers are placed. Its slot rides that bone and its image is centred there. A fit without `at` (a
  rig made before) keeps the prop's slot on its host bone. ⤢ Fit counts an image bone carrying prop
  bones as an image bone (it stretched none before: an image bone had no children).
- **Fingers** (`RigFit.fingers`, a bend's `chains`): each finger bone's setup offset is the frame's
  joint turned back to the hand's rest, in any direction (the one exception to a fit's lengths,
  never directions); the hand is one mesh (24 × 56) weighted along the finger it lies nearest, from
  the first joint on, shared with a finger within half a finger's width, each ramp ending at its
  joint (centred, a squeeze under ⅓ folds the skin past the knuckle: the curl's 0.3). The bend's
  anchors are its bones' own places (no `at`). Placement still reads a region (the bend is left out
  of `framePlacements`), as the frame clip keys no finger.
- **Fill** (`rig_frame_parts.profile`): a limb's or the neck's outline is measured every 3 px along
  its axis, each edge known where the background is beyond it; a hidden edge is drawn on from the
  known ones on both sides of it, else from the other edge (the axis as a mirror for the neck, the
  part's own width for a limb, its twin limb's at the same share of its length when that shows),
  else held from the nearest, never past 1.6 × its half width, with round ends at its joints. The
  torso's hull is held to the mirror of the side that shows. Nothing is made outside the outline or
  outside the character, and the part's own pixels are composited back. The drawn edge is carried
  along the made outline 4 px deep (the colour at the same place across the part, `extrude`); the
  inside is Telea's, carried all the way it streaked. The made rim is half-covered, as a drawn one
  is anti-aliased. Each part reports its `outline` (`profile`, `capsule`, `mirror`, `hull`, `prop`).
- **Stretch**: ⤢ Fit stretches a limb's art at most ×1.5 either way (`MAX_ART_STRETCH`) and says
  which limb it held (`RigRefit.held`; the bone takes the whole length, so a gap may show). 🦴 Create
  rig reports each arm segment the frame draws under 0.8 of its length (`foreshortened`, the 3D
  points scaled by the shoulders, as the picker), kept that short.

**Measured.**

- **The owner's frame 113** (the kept cut re-labelled as the new cut would, run locally): neck
  7,312 px; made pixels upper_arm_l 16,790 → 7,175 px, torso 32,733 → 27,721, neck 5,767; drawn back
  in the frame pose unchanged; the glasses on `head_image`, the ring on `ring_1_l`; no segment under
  0.8 (the right forearm is out of the picture, not drawn short).
- **Fixture** (the F2 gate): finger bones 0.0001 px off their joints; a fist, a half fist, a spread
  and the thumb in and out pose finite; no gap opens in a curl or a thumb folded in; at most 2.16%
  of the drawn hand folds over itself (the thumb in, over the palm: one mesh draws an overlap as a
  fold), a fist 0.84–0.92%; a fist brings each fingertip to 0.20–0.29 of its reach. Props 0.0000
  px off their pivots. ⤢ ×3 forearm: bone ×3, art ×1.5, held; ×1.2: art ×1.2.
- **A drawn limb hidden across its middle** (`test_rig_frame_parts.py`, made up): the made outline
  at IoU 0.948 with the true one where hidden (a capsule 0.751), 0 px made outside it, its edge
  28.6/255 off the drawn outline's colour (Telea 113).

**Gates.** `frame-rig.mjs` gains `fingers`, `props` and `stretch` (8 mutants: a rigid hand, a
finger placed the hand's way, every vertex on the first branch, a prop on the cut's bone, a prop
bone at its parent, ⤢ taking a prop-carrying image bone for a joint, an unbounded stretch, no
foreshortening reported); `test_rig_frame_parts.py` gains `silhouette` (3 mutants: a capsule, the
outline let out, the edge not carried); `test_rig_from_frame.py` checks the neck (from the head and
the torso only, below the jaw and above the shoulders, none when none shows; split_neck emptied,
widened and never cut each turn it red). The fixture chain was remade (`--write-cut`, `--write`,
`--write`).

**Owed.**

- Not verified on the authed page against R2 and the live atlas-tool.
- The thumb folded in overlaps the palm as a fold in one mesh (2% of the hand); a thumb drawn as
  its own image would not.
- A frame that draws a limb short leaves it short until that part is cut from another frame (F2d).

### F2d — Per-part frames and the prop editor (2026-11-22)

The owner, on the first run: "it would be nice to select different frames for different body part
cuts", and "an easy way to add and remove props separately from the cuts".

**Per-part frames.** In the cut screen a part is clicked in the Parts list, then a frame in the
strip: that part is taken from that frame's kept cut (one is cut for it when the frame has none),
the rest from the cut's own. The cut keeps it as `sources: { part: job }`; the list says "from frame
N" (✕ takes it back) and the strip marks the frame ◧.

- **Fit** (`framePartsRequest(…, sources)`): the part is placed by that frame's own fit (its canvas
  is read off that frame, at its scale and origin); an arm segment takes that frame's length
  (`lower_arm_*` for an upper arm, `hand_*` for a forearm), and the `frame` clip brings its next
  joint in to where this frame draws it — a translate along the parent and the image squeezed along
  the limb, as the template's shortening does (`RigFit.frame` entries gain `x`, `y`). So the rig
  still poses as this frame and every other part comes back exactly; the foreshortened report leaves
  out a part taken from elsewhere.
- **Parts job** (`rig_frame_parts.from_other_cut`): each sourced part is made from its cut's frame,
  labels and joints, made whole among that cut's own parts (its props drawn into their hosts: the
  rig's props are the cut's), and reported with `from: {job, frame}`. A part taken from the cut's
  own job is refused.
- The sheet route reads each source's `cut.json` and `track.json` (gone, or another template: a
  422 / 404 saying to pick it again) and answers `frames` for the report.

**The prop editor**, apart from the part cut (nothing is cut again):

- **＋** names a prop (`prop_` and up to 40 lowercase letters, digits, `_`); the brush or the new
  **◌ lasso** paints it, each moved pixel counted to the part it came from — the most is its host,
  which it is drawn just over (after the arm's last finger on an arm) and whose drawing bone it
  hangs from.
- **🗑** removes a prop: each of its pixels goes to the part it lies nearest (grown out from the
  parts' own pixels), the indices above it move down.
- A **bone** list per prop picks the bone it hangs from (a template bone, not a control); kept as the
  author's (`boneSet`), so the fit does not move it to the host's drawing bone.
- 💾 sends it in one edit: `names` (the parts unchanged, then the props), `props`, the label map and
  `sources`. `applyCutEdits` (`rigCutEdits.ts`, no I/O) checks and applies it: the parts stay first
  and in order, a removed or reordered prop needs its label map, a new prop needs a host part, a
  source is a part (not a prop) from another kept cut of the clip. The route recounts every size
  off the stored map.

**Gates.** `frame-rig.mjs` `sources` (this frame drawing the upper arm at 0.6 of its length, another
— the fixture turned 14° at 0.8 — drawing it whole: the length is that frame's, the part placed by
that frame's fit, this frame's joints 0.0000 px off, every other part where this frame's own cut puts
it; 3 mutants: this frame's length kept, the joint not brought in, the part placed by this frame's
fit); `test_rig_frame_parts.py` `sources` (another cut, the fixture shifted and its colours
inverted: the part made from it, placed there, reported with its frame; 2 mutants);
`check:rig-from-frame` §6 (`applyCutEdits` and `labelCounts`; 4 mutants run by hand: a removal
without its map, the bone not kept as the author's, a hand prop drawn after the hand, a source of
the cut's own); `frame-rig-browser.mjs` (＋ and the lasso, a bone picked, 🗑, a part from frame 2,
one 💾 whose body is checked and whose label map is decoded, the rig made with the part from there;
3 page mutants run by hand: sources not sent, a removed prop's pixels kept, the host not counted).

**Owed.**

- Not verified on the authed page against R2 and the live atlas-tool.
- The strip needs the clip tracked: on a kept cut opened before the tracking ends, a part's frame
  can be picked once it has.
- A part taken from another frame keeps its own fill (that frame's outline and seams); a hand from
  another frame keeps this frame's finger bones, so its mesh bends where this frame's fingers are.

### F2e — The head on its neck (2026-11-23)

The owner, after F2c / F2d, on `rocketreskintest1` (kept cut of NellyAnimTest frame 6, Half body,
🎥 Motion in 3D with 📍 Follow positions): "the head is attached to the wrong bone". Reproduced
headless on that cut (read-only), the shipped fit, parts job and import, posed by engine-rig: at 5.65 s
the head is turned about 47° and swung about 80 units off the neck, as in the screenshot.

**What was wrong.** Two faults, each harmless alone:

- **The fit.** The head joint was the eyes' middle less the template's face height (110 units), so
  on a face shorter than the template's it sat 24–41 px from the drawn neck's top (NellyAnimTest's
  jaw is 0.68 of the template's height below the eyes), off to the side under a tilted head. The
  neck was aimed at it, so the `frame` clip keyed the neck −46.7° and the head +38.5° back
  (frame 6; ±42–45° on frame 113).
- **The import.** The owner imported onto the rig's own `frame` clip. A 3D import replaces the
  head's turn with the face's 3D pose (`head` `face: 'matrix'`) but Half body's import never cleared
  the neck (its `head_nod`), so the frame's −46.7° neck stayed under a head no longer turned back:
  the head tilted by the whole neck turn and swung on the neck's length.

**As built.**

- **The head joint** (`rigFrameFit.frameFit`) is the jaw's middle — the mean of the face mesh's jaw
  corners and chin (172, 397, 152), the top of F2c's neck axis — taken along the face's own up
  through the face bone, so the head still turns exactly to the eyes' line. The face bone's height
  above the head is the frame's (`face` joins the fitted lengths), so the face block's eyes still
  land on the drawn eyes. A jaw drawn less than a quarter of the template's face height below the
  face keeps the template's. The neck is aimed at it: its `frame` key is the drawn neck's own lean
  (−31° on frame 6, where the head is drawn leaning).
- **Half body's 3D import replaces `head_nod`**: the neck's 2D turn under an import is cleared, as
  the head tilt already was. No motion entry keys `head_nod`, so only the clearing changes.
- **The fixture's jaw.** The F1 fixture's face mesh only placed the points the cut read, and 172 /
  397 lay on its oval rings (one above the eyes), which F2c's neck split already read. They are on
  the drawn jaw now (`make_fixture.py`, `track.json`); the chain was remade (`--write-cut`,
  `--write`, `--write`): the neck 1,799 → 1,827 px.

**Measured** (the owner's cuts, read-only, run locally): the head joint 34.2 → 12.0 px from the
drawn neck's top on frame 6, 24.3 → 5.2 on frame 113 (what is left is the jaw's middle beside the
face's axis on a turned head). The fixture is drawn in the template's proportions, where both land
within 2 px, so the gate also draws its head leaning with a shorter face. Imported onto `frame`, the neck holds 0°
and the head stays on it through the clip; with the neck part a re-cut gives (`neck: false` cuts
predate F2c), no gap opens under the chin.

**Gates.** `frame-rig.mjs` `head`, on the fixture upright, leaning 20° and leaning with a face at 0.7:
the head bone within ¼ of the eyes-to-jaw drop of the drawn jaw; each part's drawn joint (the jaw
on the head, the shoulder and elbow on the arm segments) carried on its image stays on the bone it
turns on at setup, in the frame pose and through a 3D head and body turn imported onto `frame`
(0.0 px); that import draws the torso, neck, head and its props the same onto `frame` as onto a new
clip (0.00 px). Mutants: the head placed at the template's face height (the owner's), and
`head_nod` not replaced, each turn it red; the mutant loader reads sources with LF line ends.

**Owed.**

- Not verified on the authed page against R2.
- The owner's kept cut has no neck part: the dialog's ✂ Re-cut gives it one.
- An import onto `frame` still keeps the frame's translate keys of an arm joint taken from another
  frame (F2d's `x`, `y`): no import owns a joint's translate.

### F2f — Every part skinned (2026-11-23)

The owner: "every body part should have its mesh deformation, just like the hands have it now, with
the correct bones skinned on it. So for instance when I move the shoulder the body deforms as well."

**Why it was rigid.** F2b left bends out: a mesh bound in the setup pose, posed by the `frame` clip,
bends away from the canvas it was cut on (the torso's hem rides the spine, which the frame keys
against the chest), and un-skinning the canvas would have put the weights in atlas-tool.

**As built.**

- **Bound in the frame's pose** (`bendMesh`, a bend with `skin`): each vertex is placed where its image
  is in the frame's pose (`frameWorld`: the fitted bones with the `frame` keys, as engine-rig poses
  them) and written in each of its bones' frames there. The 4.2 format stores a weighted vertex per
  bone, so the bind pose need not be the setup: the `frame` clip draws every part exactly as cut
  (0.0001 px), and the parts job and its canvases are unchanged.
- **Joints** (`RigFitBend.skin`, `RigSkinJoint`, `skinShares`): a joint hands its share to the bone
  beside it, ramping linearly across `width` along `dir` (the bisector of the two segments meeting
  there, from this part's side), within `reach` of the joint (fading out by twice it). Joints are
  taken in order, each from what the ones before left, so an armpit listed first keeps its blend
  where the clavicle's overlaps it. `then` splits a handed share as the part beyond splits it. The rest
  stays on the part's own weighting (its bone alone; a hand's fingers' branches).
- **Which joints** (`skinBends`, read off engine-rig posing the frame): the torso to each upper arm's
  image (its armpit, at the shoulder), each clavicle (its shoulder line, from the clavicle's root to
  the shoulder), the neck (its collar) and the spine (its waist, at the chest's root); the neck to the
  torso and the head's image; the head to the neck; each upper arm to the torso (split on to its
  clavicle as the torso splits it) and its forearm; each forearm to its upper arm and hand; each hand
  to its forearm. Both parts at a joint take the same joint from their own sides, so a pixel they
  share weighs alike in both. Widths: a share of the segment (0.38 at the shoulder, 0.34 at the
  elbow, 0.28 at the wrist), the neck F2c's width; grids up to 32 × 32.
- A fit's `bends` gain `skin` (strict, one nested `then`); a skinned bend may have no ramp or chains
  and unplaced bones; a ramp and a skin together are refused.
- **What the 3D bake sees.** A weighted vertex counts toward each of its bones' cards (`cardsOf`), so
  the neck and the image bones now have art of their own there: an import onto the owner's rig
  splits the head's turn between `head` and `head_image` differently (the face bone lands on the
  same world point, 15, 524 at 5.33 s).

**Measured** (the F2 gate's fixture, through engine-rig): a shrug carries the torso's shoulder 99% of
the shoulder's move, a raised arm (45°) pulls its armpit 102% of the arm's there; under a shrug, a
dropped shoulder, both elbows bent and the head tilted and nodded both ways, the pixels two parts
share at a joint come at most 1.60 px apart (the mesh grid's interpolation; rigid parts 33.9 px), and
every vertex is finite. On the owner's frame 6 (re-labelled with a neck): the 3D import onto
`frame` bends the shoulders and the torso with the arms, the head on the neck, no gap at a joint.

**Gates.** `frame-rig.mjs` `skin`: every cut part a weighted mesh skinned across its joints; each
vertex's bones by index its own and its joints', weights summing to 1; in the frame's pose every
vertex where the cut image is (≤ 0.01 px); the poses above finite; shared pixels ≤ 2 px apart; the
shoulder line ≥ 75% and the armpit ≥ 50% pulled. Six mutants: bound in the setup's pose, a bone
index off by one, a joint taken from one side only, no clavicle joint, no armpit joint, the upper
arm's shoulder not split as the torso splits it. `head` now carries joints on meshes too.

**Owed.**

- Not verified on the authed page against R2.
- Widths are shares of the segment, not measured on the cut; a sleeve or a broad arm wants its own.
- A part taken from another frame (F2d) is skinned across this frame's joints.
- A joint drawn folded past about 120° (a forearm laid on the upper arm) bends its blend band as LBS
  does: the skin there pinches.

### F2g — Each part from its best frame (2026-11-23)

The owner: "I am still not sure how I can have the best cut of the image for the best frame for the
best body part in that frame fit." F2d let a part be taken from another frame by hand; nothing said
which frame, or why.

**As built.**

- **Scored per part** (`rigFrameScore.scoreParts`, on 🎥 Motion's track in the browser): an arm segment
  by its drawn share of its 3D length, less 0.8 × the share of it under a hand (the other one; its
  own too for an upper arm; a forearm's last 15% is its own hand's wrist) and 0.5 × the share the
  other arm crosses within 0.12 shoulders, 0.5 for a joint under 0.8 visibility, 1 out of the picture;
  a hand by its palm's spread (index to pinky knuckle over wrist to middle knuckle, 0.45 open = 1),
  0.4 + 0.6 × that, less the other hand's cover; the head by how square the face is to the camera
  (the face matrix's forward axis, else the nose between the eyes' corners), less 1.5 × a hand's
  cover; the neck as the head; the torso by its shoulders' drawn share, less the hands' and 0.3 × a
  forearm's cover. Each with its reasons in words.
- **Picked** (`bestPartFrames`): a part keeps the main frame unless that scores it under 0.9 and
  another beats it by 0.15 (`PICK_GOOD`, `PICK_MARGIN`): mixing frames costs seams, so only a clear
  gain moves a part. Ties go to the frame nearest the main one (its drawing likeliest to match). The
  neck goes with the head; a hand never moves (its finger bones are the main frame's, F2d).
- **The page.** The Parts list is the table — part · frame (◧ another) · score · the first reason
  (every reason on hover) — before the cut (the plan) and after (the cut's sources). ✂ Cut cuts the
  main frame, then takes each moved part from its frame through F2d's path (its kept cut, or one cut
  now), and the note names them; 🦴 Create rig keeps them with the cut first. A part clicked, then a
  frame in the strip, overrides the plan before the cut, or the source after. The dialog's tooltip
  opens with the quick way: pick the clip, ✂ Cut, 🦴 Create rig. `vendor/rigger-motion.js` exports
  `scoreParts` and `bestPartFrames` (rebuilt).

**Measured** on the NellyAnimTest capture (the owner's, read-only): with frame 6 as the main frame,
the right forearm (0.20 there, at 0.23 of its length) is planned from frame 70, the left forearm
from 102 (0.76 → 1.00), the upper arms from frames 0 and 1 (0.81, 0.77 → 1.00); the head, neck,
torso and hands stay on frame 6. With the best frame (106) as main, two parts move (left upper arm,
right forearm).

**Gates.** `check:rig-frame-score` §8: each part 1 on a whole frame with nothing to say; a forearm
toward the camera scored its drawn share and named; a hand over an upper arm, a palm edge-on, a face
turned away each cost and say so; the picks — a part clearly better elsewhere moved (the nearest of
equal frames), the neck with the head, a hand kept, a part shown well kept, a gain under 0.15 kept,
no body no picks. Eight mutants run by hand (scratchpad, not committed): no margin, a hand moved, the
neck apart from the head, foreshortening ignored, an upper arm's own hand ignored, the face turn
ignored, the earliest frame on a tie, a palm edge-on ignored — each red. `frame-rig-browser.mjs`: the
shipped scorer injected as the tracker's bundle, a track whose cut frame draws the right forearm
short: the table plans it from frame 2 before the cut, says why on the cut, ✂ Cut cuts the frame and
takes the forearm from frame 2's kept cut (only it), the note says so, the tooltip leads with the
quick way. Four page mutants by hand: ✂ Cut not taking the plan, every part taken, the list
ignoring the sources, no plan — each red.

**Owed.**

- Not verified on the authed page against R2 and the live atlas-tool, nor on a real track in the
  page (the gate injects the scorer).
- A part from another frame still keeps that frame's fill and seams, and is skinned across this
  frame's joints (F2f).
- The neck and the head move together; a hand never moves.
