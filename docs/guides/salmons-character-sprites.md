# Salmons: sprites for the bear and the fisherman, in eight directions

How to give Salmons' bear and fisherman their own animated sprites, facing eight ways, with the
tools in the launcher. No code and no file uploads to storage by hand. Everything happens in the
project **`salmons`** (client `invisible_wall`) at `app.invisiblewall.org`.

The short version: put the frames in a sheet, make one **clip** per animation and direction in
**Invisible Flipbook**, give each clip the name the game looks for, and **Publish**. The game
plays a clip the moment a published one has the right name.

> **Needs the eight-facings change to be live.** The game side is built
> ([status/salmons](../status/salmons.md), 2026-11-19). It reaches the published game once that
> change is merged, the runtime release is out and the launcher has deployed. Until then you can
> make and check clips (everything up to "See it in the game").

## What you can edit today, without any of this

- **The bear is one picture.** It is the region **`bear`** (256 × 138 px) of the sheet
  **`salmons_characters`**. It is drawn from above, facing left, and the game turns it to the way
  the bear walks. To change it: open the **Invisible Atlas Maker** (`/atlas`), press
  **↻ Refresh from R2**, pick `salmons_characters` in the atlas list, and on the `bear` card use
  the file picker under its picture (its tooltip: _Pick an image to use as the final atlas tile
  for this region_). Then **🧩 Create Atlas**, check the page with **🖼 View atlas**, and
  **Publish** `salmons` in Game Maker. Keep the region's name and size.
- **The fisherman has no picture.** The game draws him as a tan circle in code. There is nothing
  to edit until he has clips.

Neither can face a direction or animate. Clips are what add that.

## How the game picks an animation

The game finds a clip by its **name**: `<character>_<state>_<facing>`, for example
`bear_walk_e`. Lower case, with underscores, exactly as listed here.

### The eight facings

A facing is the way the character looks **on the screen**:

| Facing | On screen | Draw it? |
|---|---|---|
| `n` | straight up (walking away from you) | yes |
| `ne` | up and to the right, along a ground tile's edge | yes |
| `e` | straight to the right | yes |
| `se` | down and to the right, along a ground tile's edge | yes |
| `s` | straight down (walking towards you) | yes |
| `sw` | down and to the left | no: the game mirrors `se` |
| `w` | straight to the left | no: the game mirrors `e` |
| `nw` | up and to the left | no: the game mirrors `ne` |

So you **draw five and the game mirrors three**. The ground is isometric, so the four diagonal
facings follow the tiles' edges: they slope gently (two across for one down), not at 45°.

If you do make a `_w`, `_sw` or `_nw` clip, the game draws it as you made it instead of mirroring.

### You do not need all of them to start

A facing with no clip is drawn with the nearest one that exists, and a state with no clip falls
back to a near state (`walk` and `idle` stand in for each other, `swipe` falls back to `idle`,
`cast` to `reel` then `idle`). One `idle` or `walk` clip is enough to see the character in the
game. A good first pair of facings is `se` and `ne`; add `e`, `s` and `n` afterwards.

### The full list

**Bear** (15 clips):

| State | Plays | Loop | Clips |
|---|---|---|---|
| `idle` | standing | on | `bear_idle_n` `bear_idle_ne` `bear_idle_e` `bear_idle_se` `bear_idle_s` |
| `walk` | moving | on | `bear_walk_n` `bear_walk_ne` `bear_walk_e` `bear_walk_se` `bear_walk_s` |
| `swipe` | once, on its swipe | off | `bear_swipe_n` `bear_swipe_ne` `bear_swipe_e` `bear_swipe_se` `bear_swipe_s` |

**Fisherman** (20 clips):

| State | Plays | Loop | Clips |
|---|---|---|---|
| `idle` | standing | on | `fisherman_idle_n` `fisherman_idle_ne` `fisherman_idle_e` `fisherman_idle_se` `fisherman_idle_s` |
| `walk` | moving | on | `fisherman_walk_n` `fisherman_walk_ne` `fisherman_walk_e` `fisherman_walk_se` `fisherman_walk_s` |
| `cast` | once, when he casts | off | `fisherman_cast_n` `fisherman_cast_ne` `fisherman_cast_e` `fisherman_cast_se` `fisherman_cast_s` |
| `reel` | while a salmon is on his line | on | `fisherman_reel_n` `fisherman_reel_ne` `fisherman_reel_e` `fisherman_reel_se` `fisherman_reel_s` |

The salmon is not part of this: it keeps its four diagonal facings and its own look.

## Size, the Bounds box and the feet

How a clip sits in the game is set by its **⬚ Bounds** box in Invisible Flipbook, not by the
picture. The one rule that matters most:

> **One Bounds box per character, the same on every one of its clips.** Same width, same height,
> feet on the same line.

Why: the game scales each clip so that **its box's width** becomes the character's width on
screen (92 px for the bear, 56 px for the fisherman). A box fitted to each clip gives each clip
its own scale: a bear seen from the front is narrow and seen from the side is long, so with a
fitted box the front view is drawn larger than the side view, and the bear changes size as it
turns. With one box for all its clips, every view is drawn at the same scale.

So, for each character:

- **Draw every facing and every state on the same canvas size, at the same scale, with the feet
  on the same line** of the canvas. The narrow views simply leave more empty space at the sides.
- **Choose one box** wide enough for the character's widest view (for the bear, the side view),
  with its **bottom edge at the feet** and the body centred left to right. The character stands
  on the **middle of the box's bottom edge**.
- **Use that box on all of the character's clips**: the same **x / y / w / h** numbers on each.
  Do not press **⊙ Fit** on each clip.
- **Size.** The game draws the box **92 px wide for the bear** and **56 px wide for the
  fisherman**, whatever size the frames are, and keeps the box's proportions for the height.
  Draw about three times that, so the art stays sharp: a box about **280 px wide for the bear**
  and about **170 px wide for the fisherman**.

Art that reaches outside the box is fine and is not cut off: a swiping paw or a fishing rod can
overhang it.

Two more things for the fisherman:

- **Transparency.** The frames need a real transparent background.
- **His hand.** The fishing line starts at a fixed point of the box: three quarters of the way
  across and two fifths of the way down (on the other side when the game mirrors the clip). Draw
  the hand that holds the rod near there. Moving that point is a developer change today
  (`hand` in the character's clip settings); there is no control for it in a tool.

## Name the frames so Flipbook finds the animations

Each frame is one **region** of a sheet. Name the regions after the clip, with a number at the
end:

```
bear_walk_e_00  bear_walk_e_01  bear_walk_e_02  bear_walk_e_03  …
```

Flipbook then offers each run as one click under **Detected animations**, and names the new clip
for you (`bear_walk_e`). The rules it follows:

- the numbers run **in a row with no gap** (a gap splits the animation in two);
- a run needs **at least three frames**;
- no two frames share a number.

An animation of one or two frames is not detected. Click its regions by hand instead.

## Where the frames come from

There are three ways to get the frames into a sheet. Use whichever suits each animation; they can
be mixed, since the game only looks at the clips' names.

### A. Draw or edit them in the Atlas Maker

Use this to draw frames region by region, or to change frames you already have.

1. Open the **Invisible Atlas Maker** (`/atlas`) and press **＋ New atlas**. Name it after what it
   holds, for example `bear_walk`. An atlas is one page, so one atlas per character and state
   keeps each page small.
2. Open **🧩 Atlas settings** for that atlas:
   - **Layout** → **Grid of cells (your atlas + cell size are used as they are)**;
   - **Default cell width / height** → your frame size;
   - **Atlas width / height** → large enough for every frame;
   - **Frame trim** → **Keep the whole frame, transparent edges included**, so the character does
     not drift between frames.
3. Press **＋ Add region** once per frame and name each one as above (`bear_walk_e_00`, …).
4. Fill each region in one of two ways:
   - **a picture you already have:** use the file picker under the region's picture. The image is
     used exactly as it is, with no generation and no background removal. **✕** beside it removes
     it again;
   - **generate it in the tool:** write the region's prompt, give it a reference image, tick the
     region and press **▶ Render selected**. Open **▦ variants** and click the one you want.
5. Press **🧩 Create Atlas**, then **🖼 View atlas** to check the page.

To change a frame later, open the atlas, replace that one region the same way and press
**🧩 Create Atlas** again. The clips keep working, because they find their frames by name.

The tool's own guide: [Invisible Atlas Maker](../tools/atlas-maker.md).

### B. Import finished frames through the Sheet Maker

Use this when the frames already exist as PNG files, or as a packed sheet from another program.

**Loose PNG files:**

1. Save every frame on **the same canvas size**, with the character where it stands on that
   canvas. Do not crop each frame to its drawing.
2. Name the files as the regions should be named: `bear_walk_e_00.png`, `bear_walk_e_01.png`, ….
   A region takes its file's name.
3. Open the **Invisible Sheet Maker** (`/sheet`) and press **New sheet…**. Name it, for example
   `bear_walk`.
4. On the **Upload** tab, upload the files, then press **Auto-arrange unlocked ▦**. Leave
   **Region padding** at 0 and do not resize the cells: a cell larger than its picture centres the
   picture on its drawing, and the animation wobbles.
5. Check a few names in the **Selected sprite** panel on the right, then press **Save**.

**A sheet packed elsewhere:** on the **Import** tab, bring in its `.atlas`, TexturePacker JSON or
manifest and press **Save As (new copy)**; or, for a cocos2d `.plist` and its page, use
**Import .plist atlas**, which keeps the page exactly as it is and lists the sequences it found.
Rename any region that does not follow the naming above.

The tool's own guide: [Invisible Sheet Maker](../tools/sheet-maker.md).

### C. Generate them (not available yet)

> **This route does not exist yet.** Generating the eight directions needs a ComfyUI blueprint
> that has not been built. It is being designed separately, and it will come with its own steps.
> Do not use the old [S0 runbook](salmons-s0-runbook.md) for it.

Whatever that blueprint does, its results have to meet the same contract as the other two routes,
and nothing more:

- clips named `<character>_<state>_<facing>`, from the lists above;
- the five drawn facings `n`, `ne`, `e`, `se`, `s`;
- frames of one size and one scale for a character, on a transparent background, the feet on
  the same line in every frame;
- the same **⬚ Bounds** box (same width and height) on every clip of a character, with the feet
  at the middle of its bottom edge.

## Make the clips (Invisible Flipbook)

For each animation and facing:

1. Open **Invisible Flipbook** (`/flipbook`) in **Clips** mode and press **+ New** in the left
   column, so you start from an empty clip. In the right column pick your sheet under
   **Source sheet**. If you have just saved the sheet in another tab, press **↻ Refresh from R2**
   first.
2. Under **Detected animations**, click the run you want, for example
   `bear_walk_e · 8 frames`. Check the sheet name on the offer first. The frame list fills in and
   the new clip is named `bear_walk_e`. (A clip that was already saved keeps its own name.)
3. Set **fps**, and set **Loop** as the tables above say (off for `swipe` and `cast`).
4. Press **⬚ Bounds** and give the clip the character's box:
   - on the character's **first** clip (take its widest view), press **⊙ Fit** as a start, move
     the box so its bottom edge is at the feet and the body is centred, and **write down its
     x / y / w / h**;
   - on **every other clip** of that character, do not press **⊙ Fit**: type those same four
     numbers.

   Close **⬚ Bounds** to see the result.
5. Tick **Mirror X** to preview the west facing, then **untick it** before saving. The game does
   the mirroring itself.
6. Check the **Name** on the left, then press **Save**.

**The name is fixed at the first Save.** The clip's file takes its name then, and renaming it
later only changes the label. If a clip was saved under the wrong name, use **Save As…** with the
right name and **Delete** the wrong one.

The tool's own guide: [Invisible Flipbook](../tools/flipbook.md).

## See it in the game

1. Open **Invisible Game Maker** (`/game-maker`) and **Publish** `salmons`. A clip reaches the
   game only on a publish.
2. Open the published link. On the start menu choose **🎣 Catcher**, then **Bear** or
   **Fisherman**, and **🌊 Join River**.
3. Walk with the arrow keys: Right plays the `e` clip, Left the same clip mirrored, Up `n`, Down
   `s`, and two keys together the diagonals.

What to expect:

- **As soon as one of its clips is published, a character is drawn by its clips** in place of the
  bear picture or the circle. Facings and states you have not made yet use the nearest ones.
- The fisherman's line looks as before and starts at his hand on the clip; "you catch NAME!"
  still rises over him.
- **Nothing else needs uploading.** The game already knows these names for the `salmons` project.

To go back to the old look, **Delete** the character's clips in Flipbook and publish again.

## If it looks wrong

| What you see | Likely cause | Fix |
|---|---|---|
| The character still has its old look | The clip's name is not one of the names above, or the game was not published again | Check the name letter by letter; publish |
| The character floats, or sinks into the ground | The Bounds box's bottom edge is not at the feet | Move the box in **⬚ Bounds** |
| Too big or too small in every clip | The character's box is narrower or wider than its body | Widen the box to shrink the character, narrow it to enlarge, on all its clips |
| It changes size as it turns, or between animations | Its clips have different Bounds boxes (a box fitted to each clip) | Type the same **x / y / w / h** on each |
| It jumps up or down as it turns | The feet are not on the same line in every clip's box | Use the same box, and draw the feet at the same height on every canvas |
| It faces the wrong way going left | The clip was saved with **Mirror X** ticked | Untick it and save |
| The animation jumps or is short | A frame is missing, or the numbers have a gap | Fix the region names; apply the detected run again |
| The line starts beside the fisherman, not at his hand | The hand is not where the game expects it | Redraw towards the point above, or ask for the point to be moved |

## Related

- How far this is built, and what is left: [status/salmons](../status/salmons.md).
- The decision behind eight facings: [design/game-families](../design/game-families.md) §9 #28.
