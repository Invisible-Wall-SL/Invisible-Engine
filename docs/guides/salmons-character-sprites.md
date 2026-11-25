# Salmons: sprites for the bear and the fisherman, in eight directions

How to give Salmons' bear and fisherman their own animated sprites, facing eight ways, with the
tools in the launcher. No code and no file uploads to storage by hand. Everything happens in the
project **`salmons`** (client `invisible_wall`) at `app.invisiblewall.org`.

The short version: put the frames in a sheet, named after the clips. Open **Invisible Flipbook**,
switch to **Characters**, pick the character and press **＋ Make N clips**: one **clip** per
animation and direction, each with the name the game looks for. Give them all one box, look at
the character in every direction, and **Publish**. The game plays a clip the moment a published
one has the right name.

> **Needs the eight-facings change to be live.** The game side is built
> ([status/salmons](../status/salmons.md), 2026-11-19). It reaches the published game once that
> change is merged, the runtime release is out and the launcher has deployed. Until then you can
> make and check clips (everything up to "See it in the game").
>
> Flipbook's **Characters** mode, which the steps below use, is its own change (2026-11-19): it
> is in the launcher once that change is merged and the launcher has deployed. It was checked
> with made-up art on a local copy of the launcher, not yet on the `salmons` project.

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

Flipbook's **Characters** mode shows this for you: a grid of every clip, with the ones that are
made, and for each missing one the clip the game would draw in its place.

### The full list

**Bear** (15 clips):

| State | Plays | Loop | Clips |
|---|---|---|---|
| `idle` | standing | on | `bear_idle_n` `bear_idle_ne` `bear_idle_e` `bear_idle_se` `bear_idle_s` |
| `walk` | moving | on | `bear_walk_n` `bear_walk_ne` `bear_walk_e` `bear_walk_se` `bear_walk_s` |
| `swipe` | once, on its swipe | off | `bear_swipe_n` `bear_swipe_ne` `bear_swipe_e` `bear_swipe_se` `bear_swipe_s` |

A bear made of these plain clips does **not wade** yet: in the water it is drawn whole, as on land.
The bear wades (its lower half under the water's tint) when a character sheet draws it with a rig
or with **Smooth turn** on, and when it has no art at all
([status/salmons](../status/salmons.md), "Open after the wading").

**Fisherman** (20 clips):

| State | Plays | Loop | Clips |
|---|---|---|---|
| `idle` | standing | on | `fisherman_idle_n` `fisherman_idle_ne` `fisherman_idle_e` `fisherman_idle_se` `fisherman_idle_s` |
| `walk` | moving | on | `fisherman_walk_n` `fisherman_walk_ne` `fisherman_walk_e` `fisherman_walk_se` `fisherman_walk_s` |
| `cast` | once, when he casts | off | `fisherman_cast_n` `fisherman_cast_ne` `fisherman_cast_e` `fisherman_cast_se` `fisherman_cast_s` |
| `reel` | while a salmon is on his line | on | `fisherman_reel_n` `fisherman_reel_ne` `fisherman_reel_e` `fisherman_reel_se` `fisherman_reel_s` |

The salmon is not part of this: it keeps its four diagonal facings and its own look. (The
**Facings** setting under the character list in Characters mode can give a character eight
facings, or four. The bear and the fisherman already have eight; leave the salmon as it is
unless you mean to draw it in eight.)

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
  **One Bounds box** in Characters mode puts it on all of them at once (see "Make the clips").
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

Flipbook's **Characters** mode then finds each run and makes its clip, named for you
(`bear_walk_e`). The rules it follows:

- the numbers run **in a row with no gap** (a gap splits the animation in two, and only the
  longer half is made);
- no two frames share a number;
- a run can be **any length**: one or two frames count;
- a single picture needs no number: a region named `bear_idle_n` is the one-frame clip
  `bear_idle_n`;
- a single region named after the character and a facing only, such as `bear_se`, is that
  facing's still. It can become the one-frame `idle` clip (`bear_idle_se`), which is enough to
  see the character in every direction before any animation exists. It is offered unticked:
  tick the stills you want.

A name that is nearly right (`bear_walk_east`, `bear_wlak_e`) is offered with the name it
probably means, unticked too, so you decide. A name with a state the character does not have
is listed and left alone.

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

Clips made that way show in Flipbook's Characters mode like any others, so its grid, its
**One Bounds box** and its **Directions** card check them too.

## Make the clips (Invisible Flipbook, Characters mode)

All of a character's clips at once.

1. Open **Invisible Flipbook** (`/flipbook`) and switch to **Characters** in the tool bar. Pick
   **Bear** or **Fisherman** in the left column. If you have just saved a sheet in another tab,
   press **↻ Refresh** first.
2. Look at the **Clips** grid: the animations down, the facings across. **✓** is a clip that is
   made; **⇋** is a facing the game mirrors; **≈** shows the clip the game would use in place of
   a missing one; **—** means nothing would play.
3. In **Make clips from a sheet**, set each animation's **fps**, and leave **Loop** as it comes
   (on for `idle`, `walk` and `reel`, off for `swipe` and `cast`).
4. Read the plan under it: one row per run of frames, with the clip it will make. A clip that
   already exists says **there already, left alone** and is never replaced. Rows marked
   **misspelt** or **still** come unticked: tick a misspelt one only if the name offered is the
   one you meant, and a still if you want that picture as the standing clip.
5. Press **＋ Make N clips**. The result lists what was made and anything that was not.
6. In **One Bounds box**, give the character its box:
   - if none of its clips has a good box yet, open the widest view in Clips mode (click its
     **✓** cell), press **⬚ Bounds**, then **⊙ Fit**, move the box so its bottom edge is at the
     feet and the body is centred, and **Save**. Come back to Characters;
   - under **Take it from**, pick that clip's box (or type **x / y / w / h**);
   - tick **Show it on the directions** to see every clip with that box before saving;
   - press **Apply to N clips**.
7. Check the **Directions** card on the right: the character in all eight facings at the size
   the game draws it. Tick **Box and feet**. Every box should be the same size and the feet
   should sit on the yellow line in every tile. Switch between the animations at the top.

You never tick **Mirror X**: the Directions card already shows the west facings mirrored, the
way the game does it.

**If a clip has the wrong name**, it is listed under **Misnamed and broken** with the name it
probably should have. Press **⧉ Save a copy** to save it under the right name. A clip's name is
fixed at its first save, so the old one stays: open it in Clips mode (click its name) and
**Delete** it.

To change one clip afterwards (its frame order, a held frame, its speed), click its cell in
the grid: it opens in Clips mode.

The tool's own guide: [Invisible Flipbook](../tools/flipbook.md), "Characters mode".

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

Look in Flipbook's **Characters** mode first. **Misnamed and broken** lists the wrong names,
the clips with no box or a different box, and the clips saved with Mirror X. The **Directions**
card shows the character as the game draws it.

| What you see | Likely cause | Fix |
|---|---|---|
| The character still has its old look | The clip's name is not one of the names above, or the game was not published again | **Misnamed and broken** lists it with the right name: **⧉ Save a copy**, then publish |
| The character floats, or sinks into the ground | The Bounds box's bottom edge is not at the feet | Change **y** or **h** in **One Bounds box** and apply it to all clips |
| Too big or too small in every clip | The character's box is narrower or wider than its body | Widen the box to shrink the character, narrow it to enlarge, in **One Bounds box** |
| It changes size as it turns, or between animations | Its clips have different Bounds boxes (a box fitted to each clip) | **One Bounds box** → **Apply to N clips** |
| It jumps up or down as it turns | The feet are not on the same line in every clip's box | Use the same box, and draw the feet at the same height on every canvas |
| It faces the wrong way going left | The clip was saved with **Mirror X** ticked | Open it in Clips mode, untick it and save |
| The animation jumps or is short | A frame is missing, or the numbers have a gap | Fix the region names in the sheet; delete the short clip in Clips mode and make it again |
| The line starts beside the fisherman, not at his hand | The hand is not where the game expects it | Redraw towards the point above, or ask for the point to be moved |

## Related

- How far this is built, and what is left: [status/salmons](../status/salmons.md).
- The decision behind eight facings: [design/game-families](../design/game-families.md) §9 #28.
