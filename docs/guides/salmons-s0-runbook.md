# Salmons S0 — the owner's runbook for the character clips

Make Salmons' character animations in the launcher. Everything runs in the project
**`salmons`** (client `invisible_wall`) at `app.invisiblewall.org`. The tools save straight into
the project, so no files are downloaded and only two are uploaded, once (step A).

> The plan and the decisions are in [status/salmons.md](../status/salmons.md). This page is only
> the clicks. The look: 2:1 isometric, painted cartoon with dark outlines, real transparency, the
> character standing at the bottom centre.

## How the game finds a clip

The game plays a clip by its **name**, `<character>_<state>_<facing>`, for example
`salmon_pink_swim_se`. It plays one as soon as it is published. Until then, the game keeps today's
placeholder shape. Type the name exactly as listed: lower case, with underscores.

- **Facings:** draw `se` (facing down-right, towards you) and `ne` (facing up-right, away from you).
  The game mirrors them for the two west facings. Don't make `sw` or `nw` clips.
- **The golden salmon:** don't make `salmon_golden_*` clips. The game draws the pink clips tinted
  gold. If you want a hand-drawn golden salmon later, make the same clips with `salmon_golden` in
  the names. They then replace the tint.

### The clips

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

That makes 20 clips, 10 names × 2 facings. The approved plan counts 22; see "Questions for the
owner" at the end.

**If a clip is missing**, the game stands in for it: `hop` → `swim`, `swipe` → `idle`,
`cast` → `reel` → `idle`, `walk` ↔ `idle`. A missing `ne` uses the `se` clip. A salmon with no
`caught` clip just disappears when caught, as today. So any clips you have will show, even before
all 20 are made.

## A. Once: the style references (two uploads)

The current art is the style reference. It is in the Salmon repository
(`art/source/legacy/salmon_pink.png` and `bear_sprite.png`), not yet in the project, so upload
these two files once. The fisherman has no drawing (the old game draws him in code), so he uses
your new bear still as his reference. That one is picked from the project, with no upload.

## B. Do this first — one clip, end to end

Make **`salmon_pink_swim_se`** all the way through before the other 19. That proves the recipe,
the names and the game together.

### B1. The still (Invisible Atlas Maker, `/atlas`)

1. **＋ New atlas**, name `s0_characters`.
2. **⚙ Global settings → RMBG model:** pick a **BiRefNet** model, not RMBG-2.0 (RMBG-2.0 is
   non-commercial). Save.
3. **＋ Add region** named **`salmon_pink_se`**. On its card, **✎** → pipeline **`gpt_image`**
   (the card shows a **GPT** badge). Set it on the region, not in Global settings, so that other
   atlases are left alone.
4. Its reference image: **⬆ upload** `salmon_pink.png` (step A).
5. **GPT instruction:**
   > Isometric 2:1 game sprite of a pink Pacific salmon swimming, seen from above at a
   > three-quarter angle, facing down-right, painted cartoon style with dark outlines, matching
   > the reference, whole body in frame, plain flat background, no shadow, no text
6. **Render selected.** Open **▦ variants**, click the best one, then **🔒 lock this pick**.

### B2. The animation (Invisible Flipbook, `/flipbook`, 🎬 Video)

1. **Blueprint:** `wan22_i2v_flipbook`.
2. **Source image:** **Pick… → 🧩 Atlas region** → atlas `s0_characters` → `salmon_pink_se`.
3. **Prompt:** row 1 of the table. **Negative:** `camera movement, zoom, background, text`.
4. **Settings:** duration **3**, fps **16**, `remove_background` **on**, `birefnet_model` left
   at `BiRefNet_toonout`. Leave everything else as it is.
5. **Variations** `2`. Press **Generate**.
6. Pick the better one. Press **🎞 Make flipbook** and set:
   - **Clip name** `salmon_pink_swim_se`;
   - **From / To:** for a loop, pick a To frame that looks like the From frame;
   - **Every** `2`;
   - **Max px** `256` (salmon) or `320` (bear and fisherman).

   Then press **🎞 Pack N frames & create clip**. The sheet and the clip are saved in the project,
   and the clip opens in Clips mode.

### B3. Check it (Flipbook, Clips mode)

1. **▶ Play.** Set **Loop** to match the table (on for `swim`).
2. **⬚ Bounds → ⊙ Fit**, then close **⬚ Bounds**. The game stands the character on the bottom
   middle of this box, so the art must not float above its bottom edge or hang below it.
3. Tick **Mirror X** to see the west facing the game will draw. Then untick it, because the game
   mirrors on its own.
4. **Save.**

Things to look for: the motion loops without a jump (loops only), no background is left, and the
outline is dark. Nothing should change size while it plays.

### B4. See it in the game

1. **Invisible Game Maker** (`/game-maker`) → **Publish** `salmons`.
2. Open the published link and play a salmon. Swim down and right (towards you) and it plays the
   new clip. Swim up and left and it plays the clip mirrored. Swim up and right and it still plays
   `se`, because `ne` isn't made yet.

If that works, do the rest. If it doesn't, stop and report what you saw.

## C. The other 19

**Stills (Atlas Maker, atlas `s0_characters`):** one per character and facing. Each is a region
with a GPT instruction and a reference, rendered and then 🔒 locked:

| Region | Reference | GPT instruction: change the bracketed parts of B1's text |
|---|---|---|
| `salmon_pink_ne` | `salmon_pink.png` (already uploaded) | [a pink Pacific salmon swimming] … facing [up-right, away from the viewer] |
| `bear_se` | ⬆ upload `bear_sprite.png` | [a brown bear standing on all fours] … facing [down-right] |
| `bear_ne` | `bear_sprite.png` | [a brown bear standing on all fours] … facing [up-right, away from the viewer] |
| `fisherman_se` | 📁 pick your locked `bear_se` from the project | [a fisherman in waders and a hat holding a fishing rod] … facing [down-right] |
| `fisherman_ne` | the same | [a fisherman in waders and a hat holding a fishing rod] … facing [up-right, away from the viewer] |

**Clips (Flipbook 🎬 Video):** for each row of the table and each facing, take the source region
`<character>_<facing>` and do B2 to B3. Use that row's prompt, duration and loop, and name the clip
`<row name>_<facing>`. For example, `bear_swipe_ne` comes from the region `bear_ne`.

**Republish** (B4) when you want to see them in the game: after each character is done, or once at
the end. A clip shows in the game only after a publish.

## Time and cost

| Step | Time | Cost |
|---|---|---|
| A `gpt_image` still | about 40 s per variant, plus about 1 min for the first of the day | comfy.org credits per image (the docs don't record the price) |
| A `wan22_i2v_flipbook` variation | about 3–4 min at 640 px (fast mode), plus about 4 min to wake the GPU for the first one | serverless GPU, 48 GB card. The docs record no price; see the endpoint's Cost/hr in the ComfyUI page |
| 🎞 Make flipbook | under a minute | free |

All 20 clips at 2 variations each make about 40 video renders, roughly **2–3 hours of GPU time**
in all. These figures are estimates from the blueprint cards (`source: guess`), not measurements.
Write down the real times from the smoke test, so the next estimate is right.

The video jobs run one at a time. You can queue the next clip's session while one runs, and
**■ Cancel** on a queued session is free.

## Questions for the owner

Seven choices are listed in [status/salmons.md](../status/salmons.md) under "S0 on the engine":
the clip count, the extra salmon states, the facing, the sizes, the loops, the fisherman's
reference and the durations. This page assumes the default for each, so you can start before
you answer them.
