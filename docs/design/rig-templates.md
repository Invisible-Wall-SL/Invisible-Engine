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

Two things the Rigger already half has, plus one new file:

1. **The template rig** — a rig-library entry (`_shared/rigs/`) holding the bones, slots, draw
   order, constraints, the face mesh and the starter animations. Already supported: **Use in new
   rig** creates a character from it.
2. **The template contract** (new) — `_shared/rig-templates/<id>.json`, versioned:
   - `parts[]` — every image the template expects, by name, with its slot, whether it is
     required, and its variant set (§3.2);
   - `channels[]` — the face controls (§4) and the timelines each one writes;
   - `animations[]` — the starter set's names (the clips themselves live on the template rig).
3. **A rig remembers its template** — `template: { id, version }` as a typed irig v1 field
   (irig-format goal 2, one place for what a rig means to us). The runtime ignores it; the Rigger
   uses it to offer the Face panel and the contract's checks.

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
         └─ hair_front / hair_back  (physics constraints)
```

### 3.2 Parts and variants

Draw order back → front: `hair_back`, `body`, `neck`, `head`, `ear_l`, `ear_r`, `eye_white_l/r`,
`pupil_l/r`, `eyelid_l/r`, `brow_l/r`, `nose`, `mouth`, `hair_front`.

| Slot         | Variants (attachment names)                                                                                    | Required                             |
| ------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `mouth`      | `mouth_rest`, `mouth_A`, `mouth_E`, `mouth_O`, `mouth_U`, `mouth_MBP`, `mouth_FV`, `mouth_smile`, `mouth_wide` | `mouth_rest` + `mouth_A` + `mouth_O` |
| `eyelid_l/r` | `eyelid_open` (empty), `eyelid_half`, `eyelid_closed`                                                          | `eyelid_closed`                      |
| `brow_l/r`   | `brow_neutral`, `brow_up`, `brow_angry`                                                                        | `brow_neutral`                       |
| others       | one image each                                                                                                 | `body`, `head`                       |

Mouth shapes are image swaps, not deforms: they read clearly at slot-game sizes and cost nothing
at runtime. The set is the common animation mouth chart, so audio lip-sync (§5.2) maps onto it
directly.

### 3.3 The face mesh

`head` is a mesh weighted to `head` and `face`. Turning `face` a few degrees with its children
moving further than the mesh edge gives a small head turn (parallax) without new drawings. Larger
turns are not a goal of this template.

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

A Rigger panel, shown when the rig's `template` is `bust-face`: a slider/picker per channel that
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

1. Qwen-Image: the neutral bust, plain background.
2. Qwen-Image-Edit, same character: one image per mouth shape, eyes closed / half, brows up /
   angry.
3. Cut parts: each variant differs from the neutral only around its feature, so the changed area
   is the part's crop; the rest (body, head, hair) is split once, by hand or a segmentation pass.
4. Name every crop per the contract → Atlas Maker sheet → **Use in new rig** attaches it.

Step 3 is the uncertain one and gets its own spike (T6).

## 7. Build plan

| Step                                           | Delivers                                                                                                                                                                                                   | Proves                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **T1 — Contract + template rig + auto-attach** | `rig-templates` contract type and validator; the `bust-face` template rig in the library; `template` field in irig v1; **Use in new rig** attaches parts by contract name and lists missing required parts | two different arts made into rigs from one template, same pose  |
| **T2 — Face panel**                            | channels → keys at the playhead; blink / idle-blink / talk-loop helpers                                                                                                                                    | an idle with blinks and a talk loop authored in minutes         |
| **T3 — Starter animations**                    | `idle`, `blink`, `talk`, `happy`, `surprised`, `win_small`, `win_big` on the template rig                                                                                                                  | one clip plays unchanged on two characters                      |
| **T4 — Lip-sync from audio**                   | voice clip → `mouth` + `jaw` keys                                                                                                                                                                          | a line of speech in sync by eye                                 |
| **T5 — Face from video / flipbook**            | DWPose pod job → channels → keys                                                                                                                                                                           | a filmed face drives the rig                                    |
| **T6 — Art blueprint**                         | Qwen variants → named part crops → atlas                                                                                                                                                                   | a new bust character with no hand cutting beyond the base split |
| **T7 — Full body**                             | `full-body` template on the same contract; body points → bone rotations                                                                                                                                    | a walk from a filmed actor on a cartoon rig                     |

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
