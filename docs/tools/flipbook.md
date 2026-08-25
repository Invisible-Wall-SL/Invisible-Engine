# Invisible Flipbook

An online **frame-animation authoring tool**. You take the regions already packed into
one of your project's atlas sheets, put them in **order**, set a frame rate, watch the
result play, and save it as a named **clip**. The saved artifact is a `FlipbookClip`
stored in the project's cloud storage at `<client>/<project>/clips/<id>.clip.json`.

> **Status (as of 2026-08-20):** **Authoring + shipping.** You can create, order,
> preview, save, rename, copy and delete clips, and the tool warns you when a clip
> references a region its sheet no longer has. Clips now travel the full
> export → `deploy/` → bake → pull → `registerFlipbooks` chain, so a clip **does**
> reach a shipped game. All three consumers now read one: **Invisible FX** (a layer's
> particle art), the **Symbols State Machine** (a symbol×state cell) and the **Scene
> Editor** (a placed `flipbook` element — drag it from the Library's Flipbooks
> section). See "What it does not do yet" and `docs/design/invisible-flipbook.md`.

## What it is

Everywhere else in the pipeline, an atlas sheet is an unordered bag of independently
named cells — TexturePacker's frame table is a name→rectangle lookup with no sequence.
Invisible Flipbook adds the one concept that exists nowhere else: **an ordered, named,
timed group of frames**.

- **A clip is one animation.** It has a name, one **source sheet**, an **ordered** list
  of region names, an **fps**, and a **loop** flag.
- **The order is authored, not inherited.** It is not the packing order and not the
  order you happened to click. You drag frames up and down until the animation reads
  right.
- **A repeated frame is a hold.** Duplicating a frame is a first-class edit, not a
  mistake — repeating region `explode_04` three times holds that pose for three frames.
  Nothing de-duplicates your list.
- **One sheet per clip.** All of a clip's frames come from a single atlas sheet.
  Switching sheets clears the frame list (the tool asks first), because the old region
  names cannot be resolved against a different page.
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

Three columns under the shared tool bar. The bar's right-hand side always shows the
current frame count, the last save result, and a red **"N missing regions"** pill if the
clip references frames its sheet no longer has.

| Column | What it is |
|---|---|
| **Left — Clips** | Every clip saved in this project, with its frame count. Below it: the clip **Name** box and **Save**, **Save As…**, **Delete**. |
| **Centre — Preview + Frames** | The playback canvas with its transport (play/pause, scrubber, fps, loop) on top; the **ordered frame list** underneath. |
| **Right — Source sheet** | A dropdown of the project's atlas sheets, a filter box, and a clickable grid of that sheet's regions. |

## How to use it

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

The name of the frame currently on screen is shown under the transport.

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

## What it does not do yet

- **No onion-skinning, no per-frame timing.** Every frame in a clip lasts exactly
  `1 / fps` seconds; hold a pose by duplicating the frame.
- **No reverse/ping-pong playback**, and no in-tool trimming of the source art (that is
  the Sheet Maker's job — it owns pixels, this tool owns time).

## Related

- Design + build plan: [`../design/invisible-flipbook.md`](../design/invisible-flipbook.md)
- Current state: [`../status/flipbook.md`](../status/flipbook.md)
- The sheets it reads: [Invisible Sheet Maker](sheet-maker.md) ·
  [Invisible Atlas Maker](atlas-maker.md)
- The tools that consume clips: [Invisible FX](fx.md) ·
  [Invisible Symbols State Machine](symbols-state-machine.md) ·
  [Invisible Scene Editor](invisible-editor.md)
