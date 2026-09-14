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
> reach a shipped game. Four consumers read one: **Invisible FX** (a layer's particle
> art), the **Symbols State Machine** (a symbol×state cell), the **Scene Editor** (a
> placed `flipbook` element — drag it from the Library's Flipbooks section) and the
> **Rigger** (an animation event key's **Play flipbook**, so a clip plays on a rig's own
> beat, on a bone, at a slot's depth). See "What it does not do yet" and
> `docs/design/invisible-flipbook.md`.
>
> **🎬 Video mode: generating for real** _(2026-09-01)_. It has been run on the GPU and
> produces videos — the long "built but never proven on a real generation" caveat is gone.
> Per-tile **⧉ duplicate with new settings** is live too. It is still young — the first real
> runs are from the day this was written — so treat anything surprising as worth reporting
> rather than as how it works.
> See [`../design/invisible-flipbook-video.md`](../design/invisible-flipbook-video.md).

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

**The preview is a pan/zoom canvas**, and it behaves like one:

- **Scroll to zoom**, centred on the pointer — whatever is under the cursor stays under it.
- **Drag to pan.** Dragging a bounds-box handle moves the box, not the view.
- **− / + / ⬚ Fit** sit in the corner; **Fit** puts the whole clip back in view at 100%.
- **Drag the striped grip below the viewport** to make it taller or shorter. It remembers
  the height you chose.

Worth zooming in before drawing a bounds box — the box is placed at the scale you see it
at, and a small preview is not much to aim with.

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
| **Blueprint** | Which ComfyUI network to run. **Only video blueprints are listed.** **＋ Blueprint** (next to *Generate*, if you hold the publish permission) uploads a new one — see [Publishing a blueprint](#publishing-a-blueprint). Blueprints declare which tool they belong to, and the Atlas Maker's image networks are deliberately not offered here — they would generate a still, not an animation. Its description appears underneath. |
| **Prompt** / **Negative** | What should happen in the animation, and what to avoid. |
| **Source image** | The still to animate. **Pick…** opens a picker with **three** sources — see below. An image-to-video blueprint refuses to start without one. |
| **Variations** | How many to generate. There is no ceiling — each is a separate render with its own seed, and each one is paid GPU time. |
| **Settings groups** | Every knob the blueprint's author exposed, grouped as they named them — duration, fps, generation size, sampler settings, output size, background cutout. Each starts at the blueprint's own default; you only override what you touch. A numeric knob with a declared range is a **slider + number box**, and a typed number is clamped into the range — ComfyUI rejects a whole render over one out-of-range value (a `sensitivity` of 50 on a 0..1 input), so the panel never lets one out. A **dropdown's list is re-read from ComfyUI every time the panel opens**: install a model on the pod, reopen the blueprint, it is in the list — no re-import. A saved choice the live list no longer has stays selected, marked *(not installed)*. When ComfyUI is asleep the list the blueprint was published with is shown instead. |

Press **▶ Generate N**.

#### Publishing a blueprint

**＋ Blueprint** takes a ComfyUI **API-format** export (Settings → “Save (API Format)” — the
editor's own `workflow.json` is the wrong file; it stores canvas positions instead of a node
dict) and publishes it to the shared library as a **video** blueprint.

You then point each **role** at a node input. A role is what the tool fills in at render time:
the `prompt` box, the `negative` box, the per-variation `seed`, the source still
(`style_ref` / `shape_ref`), and `output` (the save node the frames come back from).

**Only `output` is required.** A processing graph has no sampler and no text encoder, so it
has nothing to bind `seed` or `positive` to; requiring them made that class of blueprint
unpublishable. An unbound role is not written at render time, so the graph keeps its baked
value — and if the graph HAS a seed you left unbound, the modal warns that every variation
will come out identical rather than refusing the publish.

- **Suggested is a ranking, not a shortlist.** Every input in the graph is listed under **All
  node inputs** beneath it, so a role is never cornered by a heuristic that did not anticipate
  your network. Wired inputs are listed too, marked `(wired)`.
- **Knobs pulled out into `Primitive` nodes are followed through the wire.** Most reusable
  graphs convert their widgets to inputs, so `CLIPTextEncode.text` is a wire and the actual
  prompt lives on a `PrimitiveString` upstream. The prompt suggestion points at that primitive
  — which is what you want, because writing over the wire would cut every other consumer of
  that value off from it.
- **Unambiguous roles are filled in for you.** Anything with a single best candidate is
  pre-selected. A genuine choice is not guessed at: a graph with a first-half and a second-half
  prompt leaves `positive` empty for you to pick, and the other half belongs in a setting.
- There are deliberately no `width`/`height` roles — binding those makes the runner push the
  Atlas Maker's still-image size (1024) through an 80-frame batch, which is a VRAM and
  wall-clock blowup. Expose generation size as a **setting** instead.

**Exposed settings** are the knobs the generate panel then shows. Pick the node input first:
the key and the default are read off the graph's own baked value, and the **type, range and
option list off the node's own contract** — what ComfyUI declares that input to be. A `FLOAT`
declared 0..1 arrives as a float with **min · max · step** filled in (and becomes a slider in the
panel); a COMBO — a model name, an `Alpha`/`Color` mode — arrives as a `select` with the node's
real list, not as a text box. The row's boxes are **key · label · default · group** plus those
range boxes: the key is the setting's id, the **label is what the Generate panel shows**, and it
follows the key until you type a label of your own — so renaming the key to `bck model` is
enough. Four things to know:

- **The default is what runs.** A render only sends the settings you actually changed, so
  everything else runs at the published default. A blank default publishes as `0`.
- **If ComfyUI is asleep when you pick the file, the modal says so** — the settings then fall
  back to being typed from the baked value alone, with no range and no list, and will not be
  range-checked. Wake the pod and pick the file again, or fill the range boxes yourself. A
  `Primitive*` node's own range is wide open either way; that setting stays unbounded.
- **A node input can be driven by a role or by a setting, never both.** An input a role already
  holds is greyed out in the settings picker.
- **`group` decides where a setting appears** — settings are shown bucketed under the group
  names you give them, in the order you first use them.

##### A network with more than one prompt

Only one prompt can be the `positive` role, because that role is what the panel's **Prompt** box
writes to. A two-part network — a first-half and a second-half prompt, say — binds one of them to
`positive` and exposes the **other as a text setting**. Both are then editable on every run.

A text setting whose value is prose gets **prompt-sized box** ticked automatically (a long or
multi-word default gives it away), and it renders as a full-width, multi-line box instead of the
narrow inline field the numeric knobs share — a `#222222` or a `ComfyUI` stays narrow. You can
tick or untick it yourself. Give it a group such as `Prompts` and it will sit in its own section
directly under the Prompt and Negative boxes, **open by default** — any group holding a
prompt-sized setting starts expanded, so a second prompt is never hidden behind a disclosure
triangle.

One asymmetry to know: **↻ re-roll** changes only the prompt and the seed, so a second prompt is
changed with **⧉ Duplicate with new settings**, which carries every setting.

#### Lining up a second idea

You do **not** have to wait, and you must never cancel a run just to start another. While a
session is generating, the button reads **＋ Queue N**: write the next prompt, press it, and
that session waits its turn and starts the moment the GPU is free. The run in progress is
not disturbed. The session bar shows where a waiting session stands (`queued · #2 in line`).

Up to four sessions may wait behind the running one. A session that has not started yet has
spent nothing, so **■ Cancel** on a waiting session is free and instant — it simply leaves
the line, and whatever was behind it moves up.

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

**Click the animation itself** to open that render at **full resolution in its own browser
window** — the tile is a heavy downscale, and a cutout's fringe or one smeared frame does not
survive it. The window opens sized to the render (1:1) where the screen allows, and fitted to
the window where it does not; the header button switches between the two, **F** does the same
from the keyboard and **Esc** closes it. It is a separate window rather than an overlay so you
can keep it beside the grid, or open a second variation next to the first and compare. Clicking
the same tile again reuses that variation's window instead of stacking another copy.

Per tile: the **seed** button copies that render's seed (it reproduces that exact result),
**🎞 Make flipbook** starts the conversion, **⤓** downloads it, **↻** re-rolls just that one,
**⧉** duplicates it with new settings, and **🗑** deletes it.

**⤓ downloads one render to your computer**, in either of two forms — the panel names the
shape of what you are taking first (`frames · W×H · fps`, and whether it has transparency):

- **Animated WEBP** — the file exactly as it was generated: one looping animation, alpha
  intact. It is a plain link, so it saves instantly.
- **PNG frame sequence (.zip)** — every frame as its own full-resolution PNG,
  `frame_0000.png`, `frame_0001.png`, …, **untrimmed and unscaled**. This is the interchange
  export, for taking the animation into After Effects or another sprite tool; it is *not* what
  🎞 Make flipbook packs, which crops each frame to its ink to save atlas space. The zip is
  built when you ask for it, so a long render takes a moment.

The zip also carries an **`info.json`** with the frame count, the size and the **frame rate**.
Take it seriously: nothing inside a folder of PNGs says how fast to play them, and the rate is
the whole reason this animation is a clip rather than a pile of pictures.

Very long renders are refused rather than truncated — a short zip looks exactly like a
complete one once it is on your disk. If you hit that, take the WEBP, or use 🎞 Make
flipbook, which can stride and trim the range before it packs.

Only a finished render can be downloaded; the button is greyed out on a queued, running,
failed or cancelled tile.

**↻ re-rolls one tile in place** — same session, same slot number, a new render replacing the
old one. It opens with that tile's prompt and seed already filled in, and the two are
independent knobs:

- **Hold the seed, change the prompt** — the same roll of the dice, asked for differently.
  This is how you find out what one word actually does.
- **Hold the prompt, take a new seed** (clear the box, or press 🎲 New) — another roll of the
  same idea.

A changed prompt is recorded on **that tile**, not on the session: the session keeps the
prompt that still describes the rest of the grid, and a re-rolled tile shows its own prompt
under it. Costs one GPU job, and the render that was there is deleted.

**⧉ duplicates one tile with new settings** — and it is the opposite of ↻ in both directions,
which is the point of having both. ↻ *replaces* a tile and moves two knobs; ⧉ *adds* a tile and
moves **all** of them:

- **Prompt, negative, source image, and every one of the blueprint's settings** — the same panel
  you get when generating from scratch, opened on **what that tile actually ran**.
- **The seed is held**, because holding it is what makes the two renders comparable: any difference
  you then see is the setting you changed and not another roll of the dice. Clear the seed (or
  press 🎲 New) only when you want a different roll as well.
- **The original is not touched.** The new render appears as its own tile in the same grid, beside
  the one it came from.

This is the way to answer *"what does this setting actually do to this render?"* — the common case
being one version **with the background removed and one without**, side by side on the same seed.

The **blueprint is not one of the knobs**: it is what every tile in the grid is described by, and
its settings are the ones the panel shows. A different blueprint is a different session — use
**▶ Generate**.

A duplicated tile says so under it: **⧉** followed by the names of what it changed, with the actual
values on hover. Only real differences from the session's recipe are recorded, so a tile that
changed nothing but its prompt shows only the ↻ line.

**🗑 deletes one variation** and its render, for good. The grid stops showing it. The slot
number is *not* reused — `003.webp` may already have been packed into a clip, so renumbering
would rename someone's art underneath them.

**＋ Add** (next to the session selector) appends more rolls of the same recipe to *this*
session, rather than starting a new one — one idea stays in one grid, which is the
comparison you are actually making. A session can hold as many variations as you add to it.

A tile still rendering can be neither re-rolled nor deleted — cancel the session first.

**■ Cancel** stops a session — no further variations start, and the in-flight job is
cancelled on the endpoint so it stops costing money. Cancelled variations read `cancelled`,
not `failed`: a red FAILED tile always means the render itself went wrong, never that you
stopped it.

Sessions are listed in the picker above the grid and persist: close the tab, come back, and a
session still running reattaches. Each row shows **a thumbnail of that run's first render** and
**the prompt it was asked for** — that is what tells one run from another, since the recipe name,
the count and the age are the same on nearly all of them. A green dot marks a session still
working, a red one a session that was stopped. **Nothing prunes them**, so use 🗑 on sessions
you are done with.

The session **🗑 asks first** — it names the session and how many renders go with it, because
this is the whole grid and not one tile. Saying yes removes every render in it from cloud
storage as well as the service's own disk, for good; **sheets you already packed out of it are
kept** (they live with the project's other sheets, not with the session). If the delete is
refused — a token without delete permission, say — the session stays in the list and tells you
what is left over, rather than disappearing while its files remain. A session that is still
running cannot be deleted: cancel it first.

The name is derived from the prompt, not stored, so it costs nothing and every session you
already have has one. If two runs read alike, it is because their prompts start alike — the
thumbnail is the tie-breaker.

#### What a session was asked for, and asking again

A session keeps its whole recipe, not just its results. The line under the session bar is the
prompt; **click it** to unfold the rest — blueprint, full prompt and negative, source image,
variation count, and every setting that was **changed** from the blueprint's defaults.

Only *changed* settings are recorded. Everything else ran at whatever the blueprint's own
default was **at the time**, and since a blueprint can be updated after a run, the panel will
not guess that value back for you. Per-render seeds live on the tiles — the seed button copies
the one that reproduces that exact result.

**↻ Use these settings** loads the whole recipe back into the left rail: blueprint, prompt,
negative, source image, variation count and the changed settings. From there you either press
**▶ Generate** straight away for a fresh set of variations on the same idea, or edit the
prompt first and generate that — the caret is already in the prompt box. **Seeds are not
reused**, so re-running an unchanged recipe gives you new results, not the same ones back. (To
reproduce one render exactly, you want its seed, not this button.)

Two things it will tell you rather than paper over:

- A setting the blueprint **no longer has** is listed in the recipe as such, and is not
  restored — it cannot be sent to a network that does not accept it.
- If the **blueprint itself** is gone from the library, the recipe says so on the Blueprint
  row, and only the prompt and source image are restored. The settings belong to that network;
  applying them to whichever blueprint happens to be selected would quietly run a different
  recipe under the same name.

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
- **🎬 Video: one session RUNS at a time**, per deliberate choice — a session is several
  paid GPU jobs, and running two at once would also lose the warm-model reuse that makes a
  session fast. Further sessions QUEUE (up to four waiting); they never run in parallel.

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
  [Invisible Scene Editor](invisible-editor.md) · [Invisible Rigger](rigger.md)
