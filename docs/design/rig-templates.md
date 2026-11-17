# Rig templates — design + build plan

> Status: [status/rigger](../status/rigger.md) (open item 19) · Owner tool: Invisible Rigger
> (`/rigger`, agent `invisible-rigger`) · Builds on: [invisible-rigger](invisible-rigger.md),
> [irig-format](irig-format.md), the rig and animation libraries
> ([tools/rigger](../tools/rigger.md) §"Reuse a whole rig")

## 1. Goal

Most characters we ship fall into a few shapes. A fixed skeleton per shape means a new character
is new art on a known rig, and every animation made for one character plays on all the others.
Three kinds of rig cover the work:

| Template                         | Use                                                           | Order                                        |
| -------------------------------- | ------------------------------------------------------------- | -------------------------------------------- |
| **Bust with face** (`bust-face`) | shoulder-cut character beside the reels, reacting and talking | **first** (owner, 2026-11-16)                |
| **Full body** (`full-body`)      | standing / walking / celebrating character                    | second, reuses everything built for the bust |
| **Custom**                       | anything else (creatures, props, mascots)                     | today's free-form Rigger, unchanged          |

Target: the two templates cover ~80% of character work.

**Non-goals.** No runtime change and no new asset class: a template rig is an ordinary irig v1
with ordinary timelines, so it ships through the existing chain (rule 8) and cannot change how any
current game looks. No video-model animation of the art: the art is rigged, motion is keys.

## 2. What a template is

1. **The template** — versioned, in code (`apps/launcher-api/src/lib/server/rigTemplates.ts`), so
   a change is reviewed and gated like any other:
   - `bones[]` and `slots[]` (draw order) — the skeleton;
   - `parts[]` — every image the template expects, by name, with its slot and whether it is
     needed (§3.2);
   - `channels[]` — the face controls (§4) and the timelines each one writes (T2);
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

### 5.1 By hand — the Face panel

A Rigger panel, shown when the rig's `template.json` names `bust-face`: a slider/picker per channel that
keys at the playhead, plus one-click helpers (blink at time t, idle blink pattern, "talk" loop of
random mouth shapes).

### 5.2 From audio — lip-sync

A voice clip → a timed list of mouth shapes → `mouth` + `jaw` keys. Candidate: Rhubarb Lip Sync
(MIT — confirm), run as a CPU job on atlas-tool. Slot games rarely carry dialogue, so this ranks
after the panel and the starter set.

### 5.3 From video or a flipbook — face tracking

DWPose (in `comfyui_controlnet_aux`, already on the pods) gives 68 face points per frame. From them:
eye openness → blinks, mouth height/width → `jaw` + nearest shape, brow-to-eye distance → brows,
eye line angle → tilt, nose offset → turn. A queued pod job (Director ground rule 8), the solve in
TypeScript in the Rigger. Body points from the same pass feed the full-body template later. Licence
check owed on the node pack and the DWPose weights before shipping anything made with it.

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

## 7. Build plan

| Step                                                         | Delivers                                                                                                                                                                         | Proves                                                          |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **T1 — Contract + template rig + auto-attach** ✅ 2026-11-17 | the template type and validator; `bust-face` in ＋ New rig (atlas or uploaded images); parts attach by name, missing ones are left out and listed; `template.json` in the bundle | two different arts made into rigs from one template, same pose  |
| **T2 — Face panel** ✅ 2026-11-17                            | channels → keys at the playhead; blink / idle-blink / talk-loop helpers                                                                                                          | an idle with blinks and a talk loop authored in minutes         |
| **T3 — Starter animations** ✅ 2026-11-17                    | `idle`, `blink`, `talk`, `happy`, `surprised`, `win_small`, `win_big` on the template rig                                                                                        | one clip plays unchanged on two characters                      |
| **T4 — Lip-sync from audio**                                 | voice clip → `mouth` + `jaw` keys                                                                                                                                                | a line of speech in sync by eye                                 |
| **T5 — Face from video / flipbook**                          | DWPose pod job → channels → keys                                                                                                                                                 | a filmed face drives the rig                                    |
| **T6 — Art blueprint** 🟡 tools 2026-11-17, real run owed    | Qwen variants → named part crops → atlas                                                                                                                                         | a new bust character with no hand cutting beyond the base split |
| **T7 — Full body**                                           | `full-body` template on the same contract; body points → bone rotations                                                                                                          | a walk from a filmed actor on a cartoon rig                     |

T1–T3 need no GPU and no new dependency; they deliver the template on their own. Each step lands
with a `tools/rigger-spike/` check (headless, through the `engine-rig` loader) and the guide
section it adds.

## 8. Open questions

1. **Mouth set size** — nine shapes (above) or a minimal four (`rest`, `A`, `O`, `smile`) for
   faster art? The contract allows both; the starter clips need to pick.
2. **Head turn depth** — is parallax on one mesh enough, or do some projects need a ¾ head
   drawing swapped in?
3. **Licences** — DWPose node pack + weights, Rhubarb: confirm before T4/T5 ship anything.
4. **Where the contract is edited** — JSON by an admin at first; a Rigger UI only if templates
   multiply.
