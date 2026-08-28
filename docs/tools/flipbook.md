# Invisible Flipbook

An online **frame-animation authoring tool**, in two modes.

- **Clips** — take the regions already packed into your project's atlas sheets, put them
  in **order**, set a frame rate, watch the result play, and save it as a named **clip**.
- **🎬 Video** — *generate* the animation instead: run a ComfyUI blueprint, get several
  video variations side by side, pick the one you like, and turn its frames into a clip.

Either way the saved artifact is a `FlipbookClip` in the project's cloud storage at
`<client>/<project>/clips/<id>.clip.json`.

> **Status (as of 2026-08-26):** **Clips: authoring + shipping.** You can create, order,
> preview, save, rename, copy and delete clips, and the tool warns you when a clip
> references a region its sheet no longer has. Clips now travel the full
> export → `deploy/` → bake → pull → `registerFlipbooks` chain, so a clip **does**
> reach a shipped game. All three consumers now read one: **Invisible FX** (a layer's
> particle art), the **Symbols State Machine** (a symbol×state cell) and the **Scene
> Editor** (a placed `flipbook` element — drag it from the Library's Flipbooks
> section). See "What it does not do yet" and `docs/design/invisible-flipbook.md`.
>
> **🎬 Video mode: built, but not yet proven on a real generation.** Every step exists and
> is covered by offline tests, but no video has been generated through it end to end yet —
> the blueprint still has to be published to the shared library and one job run for real.
> Treat the first run as a shakedown. See
> [`../design/invisible-flipbook-video.md`](../design/invisible-flipbook-video.md).

## What it is

Everywhere else in the pipeline, an atlas sheet is an unordered bag of independently
named cells — TexturePacker's frame table is a name→rectangle lookup with no sequence.
Invisible Flipbook adds the one concept that exists nowhere else: **an ordered, named,
timed group of frames**.

- **A clip is one animation.** It has a name, a **primary source sheet**, an **ordered**
  list of region names, an **fps**, and a **loop** flag.
- **The order is authored, not inherited.** It is not the packing order and not the
  order you happened to click. You drag frames up and down until the animation reads
  right.
- **A repeated frame is a hold.** Duplicating a frame is a first-class edit, not a
  mistake — repeating region `explode_04` three times holds that pose for three frames.
  Nothing de-duplicates your list.
- **A clip may span several sheets.** Each frame is either a bare region name (resolved
  against the clip's primary sheet) or a sheet-scoped reference, so one animation can pull
  frames from more than one page. That is not a nicety: a multipacked export routinely
  interleaves one animation across pages, and the 🎬 Video mode produces multi-page clips
  as a matter of course when an animation is long. **Switching the source sheet does not
  clear your frame list** — it is the normal way to add frames from another page, and rows
  carry a sheet chip once a clip spans more than one.
- **The join to the sheet is by region NAME.** That is what lets you re-pack, resize or
  add to a sheet in the Sheet Maker without breaking a clip — but it also means
  **renaming or deleting a region breaks any clip that used it** (see "Broken frames").

- **Where it runs:** the launcher itself, at `/flipbook` — a real full-page tool inside
  the authed `(app)` area, **never an iframe**. The route gates on auth + the `flipbook`
  tool entitlement and resolves the active project, then renders client-side.
- **Access:** the `admin`, `developer`, `artist` and `pipelineTester` roles get it by
  default (`ROLE_TOOLS` in `apps/launcher-api/src/lib/roles.ts`); the `animator` role does not.
  Like any tool it is overridable per role/user in the admin panel. The save and delete
  endpoints (`POST /api/flipbook/save`, `POST /api/flipbook/delete`) are `flipbook`-gated
  and scoped to your session's active project.

## The screen

The tool bar carries a **Clips / 🎬 Video** switch — the two modes share nothing but the
active project, so switching is instant and loses no work.

### Clips mode

Three columns under the shared tool bar. The bar's right-hand side always shows the
current frame count, the last save result, and a red **"N missing regions"** pill if the
clip references frames its sheet no longer has.

| Column | What it is |
|---|---|
| **Left — Clips** | Every clip saved in this project, with its frame count. Below it: the clip **Name** box and **Save**, **Save As…**, **Delete**. |
| **Centre — Preview + Frames** | The playback canvas with its transport (play/pause, scrubber, fps, loop) on top; the **ordered frame list** underneath. |
| **Right — Source sheet** | A dropdown of the project's atlas sheets, a filter box, and a clickable grid of that sheet's regions. |

### 🎬 Video mode

A generation form on the left and a grid of results on the right — described in full under
[🎬 Video mode](#-video-mode--generate-the-animation) below.

## How to use it — Clips

Assembling a clip from frames that already exist. To generate the animation instead, skip
to [🎬 Video mode](#-video-mode--generate-the-animation).

### 1. Open it and pick a project

Sign in to the launcher (`app.invisiblewall.org`) and open **Invisible Flipbook** (the
top-bar switcher lists it as **Flipbook**). Clips and the atlas list are per **project** —
the bar shows the active `client / project`, and everything you do targets it. Switch
projects with the launcher's project selector, or deep-link with `?project=<key>`.

### 2. Pick the source sheet

In the right column, choose an atlas from **Source sheet**. These are the same manifests
the Scene Editor, Rigger and FX read (the project's `manifests/*.json`); a sheet with no
regions or no page image is not listed. The grid fills with a thumbnail per region — use
the filter box to narrow a big sheet by name.

### 3. Build the frame order

- **Click a region** in the right-hand grid to **append** it to the end of the frame
  list. Click a run of regions in order and you have your animation.
- **Drag a frame** in the centre list to move it. Frames are numbered **1…N** so the
  order is never ambiguous.
- **⧉** duplicates a frame in place — this is how you **hold** a pose.
- **✕** removes a frame.
- **Click a frame's name** to jump the preview to it (this pauses playback).

### 4. Set the timing and preview it

Above the list:

- **▶ Play / ❚❚ Pause** runs the clip on a real clock at the clip's fps.
- The **scrubber** steps through the frames by hand (dragging it pauses playback).
- **fps** is the playback rate. The default is **24**; a clip saved without one plays
  at 24 wherever it is used.
- **Loop** on (the default) restarts at frame 1; off plays the clip once and stops on
  the last frame.
- **play** is the DIRECTION the frames are walked — **forward** (the default),
  **reverse**, or **ping-pong**. Reverse plays the same art backwards without you
  duplicating anything. Ping-pong runs to the end and back down through the middle
  frames, so a loop returns to frame 1 exactly once per cycle (the two turnaround
  frames are not repeated — that would read as a stutter).
- **Mirror X / Mirror Y** flip the drawn frames. No second set of art, and the whole
  clip flips together.

The scrubber and the **N / N** counter show the position in the WALK, so a ping-ponged
8-frame clip is 14 steps long. The name under the transport, and the highlighted row in
the frame list, always name the AUTHORED frame that step landed on.

> A ping-pong cycle lasts nearly **twice** what the frame count suggests. That matters
> wherever a clip's length is used as a beat — a symbol's win animation, or a screen's
> duration in Invisible Flow — and the engine measures the walk, not the list, so those
> beats already wait for the whole bounce.

### The bounds box — declaring the size a clip is drawn at

Press **⬚ Bounds**. This is the flipbook twin of the Rigger's **Bounds**: a box you draw
over the art that says *this is the space this clip occupies*. Every consumer — a reel
symbol, a placed clip in the Scene Editor, a full-screen background — sizes and anchors
by that box instead of by whatever rectangle the packer happened to produce.

Two things it fixes, neither of which had any fix before except re-cropping and
re-exporting the art:

- **The animation changes size as it plays.** Frames of one animation rarely pack to the
  same rectangle, and without a box each frame is fitted on its own — so the art pulses.
  One box for the clip means one scale for every frame.
- **The clip draws too small (or too big) next to everything around it.** Art padded with
  empty margin reads small; art with a wide flourish reads huge. Box the part that
  actually reads and the rest follows.

The controls, once the box is open:

- **⊙ Fit** draws the box around every frame's art — the usual starting point.
- **⌖ Centre** re-centres the box on the clip's origin, keeping its size.
- **✕ Clear** removes it: back to each frame on its own rectangle.
- **Drag** the box body to move it, or its handles to resize. The **x / y / w / h**
  boxes take exact numbers. `x`/`y` are the box's top-left **relative to the clip's
  origin**, so a centred box has `x = -w/2`.

**A box smaller than the art is deliberate, not a mistake.** The art is not cropped to
it — it overflows. That is exactly how you size a symbol by its core and let a glow or a
burst hang outside the reel cell.

While the box is open the preview holds a fixed frame so the art doesn't rescale under
the cursor as you drag. Close **⬚ Bounds** and the preview shows the boxed result — what
the game will draw.

### 5. Name and save

Type a name in the left column and press **Save**.

- A **new** clip's file name is derived from the name you give it, so two clips with
  different names never collide. Once saved, renaming just relabels the same file.
- **Save As…** writes a **copy** under a new name and leaves the original untouched.
- **Delete** removes the open clip. There is no undo and no version history.
- If someone else saved the same clip while you had it open, the save is **refused**
  and you are told so. You can reload to take their version, rename yours, or confirm
  an overwrite — which permanently replaces their clip with no way to recover it.
- Saving without a source sheet is refused: a clip needs one to resolve its frames.

### Broken frames

A clip stores region **names**. When you open a clip, the tool re-reads its sheet's live
region list and compares:

- Re-packing a sheet — adding sprites, resizing the canvas, toggling rotation — **is
  safe**. The packer's identity is the source filename, not the display name, so all the
  geometry drift is absorbed and your clips are untouched.
- **Renaming or deleting a region in the Sheet Maker breaks every clip that used it.**
  There is no rename hook, so no tool can repair it for you.

A broken frame shows **struck through in red** with a `?` instead of a thumbnail, and the
tool bar shows a **"N missing regions"** pill (hover it for the names). Fix it by
removing the frame and clicking the correct region, or by restoring the name in the
Sheet Maker. Do not leave it: a silently shortened animation looks plausible, which is
exactly why the tool shouts about it here rather than letting it surface later.

## 🎬 Video mode — generate the animation

Instead of assembling frames someone already drew, you describe the motion and a model
generates it. The mode runs a **blueprint** (a saved ComfyUI network from the shared
library the Atlas Maker uses), gives you several variations to choose between, and turns
the one you pick into a normal clip.

> **This costs GPU time.** Every variation is a separate job on a paid serverless
> endpoint. Four variations is four renders. The tool runs them one at a time and lets you
> cancel, but nothing here is free — decide the variation count deliberately.

### It animates a picture

The reference blueprint is **image-to-video**: it takes a still and moves it. So the
useful move is to point it at art you already have — a symbol's source sprite — and let
the model animate *that*, rather than inventing a subject from a prompt alone.

### 1. Set up the generation

The left rail, top to bottom:

| Field | What it does |
|---|---|
| **Blueprint** | Which ComfyUI network to run. **Only video blueprints are listed.** **＋ Blueprint** (next to *Generate*, if you hold the publish permission) uploads a new one: pick a ComfyUI **API-format** export, point each role at a node, and it publishes as a video blueprint. It offers no `width`/`height` roles on purpose — binding those makes the runner push the Atlas Maker's still-image size (1024) through an 80-frame batch. Expose generation size as a setting instead. Blueprints declare which tool they belong to, and the Atlas Maker's image networks are deliberately not offered here — they would generate a still, not an animation. Its description appears underneath. |
| **Prompt** / **Negative** | What should happen in the animation, and what to avoid. |
| **Source image** | The still to animate. **Pick…** opens a picker with **three** sources — see below. An image-to-video blueprint refuses to start without one. |
| **Variations** | How many to generate (1–12). Each is a separate render with its own seed. |
| **Settings groups** | Every knob the blueprint's author exposed, grouped as they named them — duration, fps, generation size, sampler settings, output size, background cutout. Each starts at the blueprint's own default; you only override what you touch. |

Press **▶ Generate N**.

#### Picking the source image

**Pick…** opens one modal with three tabs. They differ only in where the still comes from —
whichever you use, the blueprint receives the same thing:

- **📁 Project files** — browse what the project already has in R2: the packed sheets, the
  loose sprite sources and the reference-image folders. Nothing is copied; the file is used
  where it lies.
- **🧩 Atlas region** — pick one **region** out of one of the project's atlases. Choose the
  atlas, filter by name, click a thumbnail. The region is cropped **at its own size**, keeping
  its untrimmed frame and its transparency, so the still the model animates is exactly the art
  the game draws — not a thumbnail of it, and not padded to a square. This is the shortest path
  from a symbol you already packed to an animation of it.
- **⬆ From my computer** — drop an image on the panel or choose a file. PNG, JPEG or WEBP, up
  to 24 MB.

The last two **copy the image into the project's asset store** (under
`input/refs/flipbook/`), so the same still is available to the next run — and to the FTP
Browser — without picking it off your disk again. The stored name includes a hash of the
image's contents, so re-picking the same region while you iterate on a prompt reuses the one
object instead of piling up near-duplicates.

### 2. Watch the grid fill

Tiles appear immediately and fill in one at a time as each render finishes. A tile shows
`queued`, then the live job state, then the animation itself — **playing and looping on
its own**, on a **checkerboard**.

The checkerboard is there to be read: it is how you see whether the background cutout
actually produced **transparency**. If a tile's art sits on a solid rectangle, the cutout
was off or produced nothing, and those frames are not usable as symbol art.

Per tile: the **seed** button copies that render's seed (it reproduces that exact result),
and **🎞 Make flipbook** starts the conversion.

**■ Cancel** stops a running session — no further variations start, and the in-flight job
is cancelled on the endpoint so it stops costing money.

Sessions are listed in the dropdown above the grid and persist: close the tab, come back,
and a session still running reattaches. **Nothing prunes them**, so use 🗑 on sessions you
are done with.

### 3. Turn a variation into a clip

**🎞 Make flipbook** opens a panel that first reads the animation and tells you what is
there — frame count, size, frame rate — and **warns you if the frames have no
transparency** before you spend anything on packing them.

| Field | What it does |
|---|---|
| **Clip name** | The clip's name, and the name of the sheet its frames get packed into. |
| **From** / **To** | The slice of the animation to keep. Generations usually have a dead run at one end. |
| **Every** | Take every Nth frame. `2` halves the frame count *and* halves the clip's fps, so the motion still plays at the right speed. |
| **Max px** | Downscale each frame before packing. The single biggest lever on how much atlas space the clip costs. |

The panel shows exactly how many frames the current settings will pack, and at what fps,
before you commit.

Press **🎞 Pack N frames & create clip**. The tool then:

1. extracts the frames, downscales them, and **alpha-trims** each one — a frame is packed
   at the size of its actual ink, with its position inside the original canvas recorded, so
   nothing drifts or pulses when it plays;
2. packs them into one or more atlas pages (capped at 2048×2048 — a long animation spans
   several pages, which is normal and costs nothing);
3. writes the page image, its TexturePacker descriptor and a manifest into your project, so
   the new sheet behaves like any other sheet everywhere else in the pipeline;
4. creates the clip with the frames already in order and the fps already set, and **opens it
   in Clips mode** — where you trim, reorder, hold frames and set the loop mode as usual.

The clip's frame rate comes from the generated animation itself, divided by your **Every**
setting — so what you saw in the grid is what the clip plays.

### Things worth knowing

- **Transparency is the blueprint's job, not this tool's.** The cutout happens inside the
  ComfyUI network, before the video is ever saved. If a blueprint's cutout is switched off
  in its settings, you get opaque frames and no amount of packing will fix them.
- **A generated sheet is a derived artifact.** Re-running the session and packing again
  writes a new sheet; the old one stays until you remove it.
- **The generated videos are authoring artifacts.** They live under
  `<client>/<project>/video/<session>/` and never ship — a game gets the packed sheet and
  the clip, never a video file.

## What it does not do yet

- **No onion-skinning, no per-frame timing.** Every frame in a clip lasts exactly
  `1 / fps` seconds; hold a pose by duplicating the frame.
- **No in-tool trimming of the source art** — that is the Sheet Maker's job (it owns pixels,
  this tool owns time). The 🎬 Video mode's **Max px** is the one exception, and only because a
  generated frame has no sheet to go back to. The **bounds box** is not trimming: it declares
  the size the clip is drawn at without touching a pixel.
- **🎬 Video: no re-roll of a single tile.** To try again, generate another session.
- **🎬 Video: one session at a time**, per deliberate choice — a session is several paid
  GPU jobs, so they are not allowed to stack up.

## Related

- Design + build plan: [`../design/invisible-flipbook.md`](../design/invisible-flipbook.md)
- 🎬 Video mode design: [`../design/invisible-flipbook-video.md`](../design/invisible-flipbook-video.md)
- Where blueprints come from: [Invisible Atlas Maker](atlas-maker.md) ·
  [`../design/invisible-blueprints.md`](../design/invisible-blueprints.md)
- Current state: [`../status/flipbook.md`](../status/flipbook.md)
- The sheets it reads: [Invisible Sheet Maker](sheet-maker.md) ·
  [Invisible Atlas Maker](atlas-maker.md)
- The tools that consume clips: [Invisible FX](fx.md) ·
  [Invisible Symbols State Machine](symbols-state-machine.md) ·
  [Invisible Scene Editor](invisible-editor.md)
