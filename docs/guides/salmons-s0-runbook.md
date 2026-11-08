# Salmons S0 — the owner's runbook for the character clips

Make Salmons' character animations in the launcher. Everything runs in the project
**`salmons`** (client `invisible_wall`) at `app.invisiblewall.org`. The tools save straight into
the project, so no files are downloaded and only two are uploaded, once (step A).

> **The game can't play these clips yet.** The game-side wiring is a separate change that is not
> merged yet. Until it is, you can make and check clips (steps A to C, except B4), but the published
> game still shows the placeholder shapes. B4 says when to look.

The plan, the decisions and how the game picks a clip are in
[status/salmons.md](../status/salmons.md) "S0 on the engine". This page is only the clicks. The
look: 2:1 isometric, painted cartoon with dark outlines, real transparency, the character standing
at the bottom centre.

## The names

The game finds a clip by its **name**, `<character>_<state>_<facing>`, for example
`salmon_pink_swim_se`. Type the names exactly as listed: lower case, with underscores.

- **Facings:** draw `se` (facing down-right, towards you) and `ne` (facing up-right, away from you).
  The game mirrors them for the two west facings, so don't make `sw` or `nw` clips.
- **The golden salmon:** make no `salmon_golden_*` clips. The game tints the pink ones gold.
- **A clip that isn't made yet** is stood in for by a near one (status, "S0 on the engine"). The
  game shows whatever clips you have, even before all 20 are made.

| # | Clip name (make `_se` and `_ne` of each) | Loop | Duration | Video prompt |
|---|---|---|---|---|
| 1 | `salmon_pink_swim` | on | 3 s | the salmon swims in place, tail sweeping side to side, body rippling, the camera and angle stay fixed |
| 2 | `salmon_pink_hop` | off | 2 s | the salmon leaps up out of the water in an arc and lands back in it, the camera and angle stay fixed |
| 3 | `salmon_pink_caught` | off | 2 s | the salmon thrashes, then goes limp, the camera and angle stay fixed |
| 4 | `bear_idle` | on | 3 s | the bear stands and breathes, head turning slightly, the camera and angle stay fixed |
| 5 | `bear_walk` | on | 3 s | the bear walks in place on all fours, the camera and angle stay fixed |
| 6 | `bear_swipe` | off | 2 s | the bear rears and swipes one paw forward, then returns to standing, the camera and angle stay fixed |
| 7 | `fisherman_idle` | on | 3 s | the fisherman stands holding his rod, shifting his weight, the camera and angle stay fixed |
| 8 | `fisherman_walk` | on | 3 s | the fisherman walks in place holding his rod, the camera and angle stay fixed |
| 9 | `fisherman_cast` | off | 2 s | the fisherman casts his rod forward over the water, the camera and angle stay fixed |
| 10 | `fisherman_reel` | on | 3 s | the fisherman reels in his line, the rod bending, the camera and angle stay fixed |

That is 10 names × 2 facings = **20 clips**.

## A. Once: the two style references

The current art is in the Salmon repository (`art/source/legacy/salmon_pink.png` and
`bear_sprite.png`), not in the project yet. You upload these two files once, in B1 and C.

`gpt_image` **redraws the reference image** in the pose and angle you ask for, so the character
stays recognisable. The fisherman has no drawing (the old game draws him in code), so his still is
your new bear still redrawn as a fisherman. It is picked from the project, with no upload.

## B. Do this first — one clip, end to end

Make **`salmon_pink_swim_se`** all the way through before the other 19. That proves the recipe
and the names.

### B1. The still (Invisible Atlas Maker, `/atlas`)

1. **＋ New atlas**, name `s0_characters`.
2. **🧩 Atlas settings — s0_characters → RMBG model: `BEN2`**, then save. This changes only this
   atlas. The default, RMBG-2.0, is non-commercial. See question 8.
3. **＋ Add region**, named **`salmon_pink_se`**. On its card, go to **⚙ advanced → Pipeline (this
   slot)** and choose **`gpt_image`**. The card then shows a **GPT** badge.
4. On the card, choose the file `salmon_pink.png` as its reference image (step A).
5. Open **📝 Extra prompts** and type this in **GPT instruction**:
   > Isometric 2:1 game sprite of a pink Pacific salmon swimming, seen from above at a
   > three-quarter angle, facing down-right, painted cartoon style with dark outlines, matching
   > the reference, whole body in frame, plain flat background, no shadow, no text
6. **▶ Render selected**. Open **▦ variants**, click the best one, then **🔒 lock this pick**.
7. **🧩 Create Atlas.** The Flipbook can only pick the still after this.

### B2. The animation (Invisible Flipbook, `/flipbook`, 🎬 Video)

1. **Blueprint:** `wan22_i2v_flipbook`.
2. **Source image:** **Pick… → 🧩 Atlas region** → atlas `s0_characters` → `salmon_pink_se`. If
   the atlas isn't listed, press **↻**.
3. **Prompt:** row 1 of the table. **Negative:** `camera movement, zoom, background, text`.
4. **Settings:**
   - **Duration (s)** 3;
   - **FPS** 16;
   - **Cut background to alpha (BiRefNet)** on;
   - **BiRefNet model** left at `BiRefNet_toonout` (question 8);
   - everything else as it is.
5. **Variations** `2`, then **▶ Generate**.
6. Pick the better variation and press **🎞 Make flipbook**:
   - **Clip name** `salmon_pink_swim_se`;
   - **From / To:** for a loop, pick a To frame that looks like the From frame;
   - **Every** `2`;
   - **Max px** `256` for the salmon, or `320` for the bear and the fisherman.

   Press **🎞 Pack N frames & create clip**. The sheet and the clip are saved in the project, and
   the clip opens in Clips mode.

### B3. Check it (Flipbook, Clips mode)

1. **▶ Play.** A new clip always starts with **Loop** on. Untick it for a one-shot (`hop`,
   `caught`, `swipe`, `cast`).
2. **⬚ Bounds → ⊙ Fit**, then close **⬚ Bounds**. The game stands the character on the middle of
   this box's bottom edge, so the art must neither float above that edge nor hang below it.
3. Tick **Mirror X** to see the west facing the game will draw, then untick it again. The game
   does the mirroring itself.
4. **⤓ Save.**

Look for these things:
- a loop doesn't jump where it restarts;
- no background is left;
- the outlines are dark;
- nothing changes size while it plays.

### B4. See it in the game (once the wiring is merged)

1. **Invisible Game Maker** (`/game-maker`) → **Publish** `salmons`.
2. Open the published link and play a salmon:
   - swim down and right (towards you): it plays the new clip;
   - swim down and left: it plays the clip mirrored;
   - swim up and right: it still plays `se`, because `ne` isn't made yet.

If that works, do the rest. If it doesn't, stop and report what you saw.

## C. The other 19

**Stills (Atlas Maker, atlas `s0_characters`).** Make one still per character and facing, as in B1:
a region with the `gpt_image` pipeline, a reference and a GPT instruction. Render it, lock it, then
press **🧩 Create Atlas** after each batch.

| Region | Reference image | GPT instruction: B1's text with the bracketed parts changed |
|---|---|---|
| `salmon_pink_ne` | `salmon_pink.png` | [a pink Pacific salmon swimming] … facing [up-right, away from the viewer] |
| `bear_se` | `bear_sprite.png` (the second upload) | [a brown bear standing on all fours] … facing [down-right] |
| `bear_ne` | `bear_sprite.png` | [a brown bear standing on all fours] … facing [up-right, away from the viewer] |
| `fisherman_se` | **⚙ advanced → Style ref → 📁 Pick from R2** → `batch/bear_se_…png` (the locked bear) | [a fisherman in waders and a hat holding a fishing rod, redrawn from the reference's style] … facing [down-right] |
| `fisherman_ne` | the same | the same, facing [up-right, away from the viewer] |

**Clips (Flipbook 🎬 Video).** Do B2 and B3 for each row of the table and each facing:
- take the source region `<character>_<facing>`;
- use that row's prompt, duration and loop;
- name the clip `<row name>_<facing>`. For example, `bear_swipe_ne` comes from the region `bear_ne`.

**Republish** (B4) when you want to see them in the game: after each character, or once at the
end. A clip reaches the game only on a publish.

## Time and cost

| Step | Time | Cost |
|---|---|---|
| A `gpt_image` still | about 40 s a variant, plus about 1 min for the first one of the day | comfy.org credits per image; the docs don't record the price |
| A `wan22_i2v_flipbook` variation | about 3–4 min at 640 px (fast mode), plus about 4 min to wake the GPU for the first one | serverless GPU (a 48 GB card); the docs record no price, so check the endpoint's Cost/hr on the ComfyUI page |
| 🎞 Make flipbook | under a minute | free |

All 20 clips at 2 variations each come to about 40 video renders, or roughly **2–3 hours of GPU
time**. These are estimates from the blueprint cards (`source: guess`), not measurements, so note
the real times from the smoke test.

The video jobs run one at a time. You can queue the next clip while one runs, and **■ Cancel** on
a queued one is free.

## Questions for the owner

[status/salmons.md](../status/salmons.md) "S0 on the engine" lists eight choices: the clip count,
the extra salmon states, the facing, the sizes, the loops, the fisherman, the durations and the
cutout models. This page assumes the default for each, so you can start before answering them.
