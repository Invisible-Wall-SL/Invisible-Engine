# Invisible Sheet Maker

Pack loose sprite PNGs into a single sheet, name the regions, add the AI fields,
and export the formats the rest of the pipeline consumes.

## What it is

A web tool that takes a folder of individual sprite PNGs, arranges them into one
packed sheet, lets you edit each region's name and per-region **AI fields**, then
exports any of:

> **Naming matters:** a symbol region's name encodes its pay-class (`H1` = high,
> `S` = scatter, …). Follow [the symbol naming convention](../conventions/symbol-naming.md)
> when naming regions — the engine keys behaviour off these names.


- a **libGDX / Spine `.atlas`** (used by Spine + game runtimes),
- a **TexturePacker JSON** sheet descriptor,
- the **Invisible AI manifest** (`atlas_manifest_<name>.json`) that the
  [Invisible Atlas Maker](atlas-maker.md) consumes.

The authored manifest is also **handed off to the cloud Atlas Maker over R2** so
it shows up in that tool's manifest list. This is pure **Pillow/CPU work — no
ComfyUI** is involved.

## Layout

A single top bar (the shared tool bar — emblem, tool switcher, project picker,
build pill, Atlas-Maker-link status), then three columns:

- **Left — Sheets rail:** the project's saved sheets as a clickable list, with
  **Load sheet**, **↻ Refresh** (re-pull from R2), **↺ Reset** (re-download from
  R2, dropping local-only files), and **Rename…**. Click to select; double-click
  to load.
- **Centre — canvas:** the packed sheet you're editing (zoom / fit / auto-arrange).
- **Right — properties (resizable):** sheet name + Upload/Import, canvas size, the
  **Selected sprite** inspector, and Save. Drag the divider on its left edge to
  resize; the width is remembered per browser.

- **Source:** `services/sheet-tool/` (stdlib `http.server` + Pillow; UI in
  `ui.html`, packing in `packer.py`, export in `atlas_writers.py`, verbatim
  `.plist` import in `plist_import.py`).
- **Where it runs:** cloud, on Railway — a port that mirrors the Atlas Maker
  (R2-backed staging + write-through). Opened full-page from the launcher at
  `/sheet` (no iframe), behind the auth + role gate, like `/atlas`.

## How to access it

Sign in to the launcher (`app.invisiblewall.org`) and open **Invisible Sheet
Maker** → it full-page-redirects to the tool at `SHEET_TOOL_URL` with the
active **project** forwarded (`?project=<key>`, project-centric like the Atlas
Maker). The launcher must have `SHEET_TOOL_URL` set (and optional
`SHEET_TOOL_SECRET`). To run it standalone for dev: `python sheet_server.py`
binds `0.0.0.0:$PORT` (default **8766**).

## Typical workflow

1. **Set a project** (`/api/set-project`).
2. **Upload** your loose sprite PNGs (`/api/upload`).
3. **Arrange** them into a packed sheet (`/api/arrange`).
4. **Edit** region names, sizes, and the per-region AI fields in the UI.
   - Each region has a resizable **Region** box (the packed/exported cell — what
     the `.atlas`/JSON/manifest frame uses) shown in the **Selected sprite**
     inspector. The artwork keeps its **original size** and is **centred** inside
     the region — only scaled *down* (aspect-preserved) when the region is
     smaller than the art, never stretched or upscaled. So a larger region just
     adds transparent margin around the original image — handy for giving
     differently-sized icons a uniform cell. Centring uses the art's opaque
     bounding box, so source PNGs with asymmetric transparent padding still land
     centred. Resize the region with the corner drag handle or the on-canvas /
     inspector **Region** W×H inputs; the **Image** size is shown read-only.
5. **Export** (`/api/export`) — choose `.atlas`, TexturePacker JSON, and/or the
   AI manifest. The AI manifest is also pushed to the Atlas Maker's R2
   `manifests/` prefix.

### FX layers (auto-spawned sibling regions)

The **Selected sprite** inspector has an **FX layers** picker — checkboxes for
`shine`, `glow`, `shadow`, `blur`, `zoom`, `colour`. Ticking one spawns a
**same-size sibling cell** named for the Invisible Atlas Maker's FX-naming
convention (`<name>_glow`, `<name>_shadow`, …) and packs it alongside the sprite.
Each cell is a server-made copy of the base art (`/api/fx-sync`) acting as a
placeholder; the [Invisible Atlas Maker](atlas-maker.md) later **derives the
real effect** from the base region (the manifest carries each cell's `mode`, so
it opens in the matching local-FX mode ready to build — see `shine.py`
`FX_SUFFIX_MODE`). FX cells are **slaved to their base**: they mirror its size
and follow its name, so renaming/resizing the base updates them and deleting the
base removes them (and their copies). They're drawn with a dashed purple outline
and a mode badge on the canvas, and untick to remove. Because the names follow
the convention, the effect travels the pipeline without any manual re-naming.
6. In the Atlas Maker, **restart the service** (hydrate runs at boot) for the
   new manifest to appear, then generate art from it.

### Adding sprites to an existing sheet

Pick a sheet in the **Sheets rail** (left) and click **Load sheet**. Loading one
pulls its source sprites back from `sheet_src/<sheet>/` (falling back to
re-slicing the packed PNG if a source is missing) together with the region names
and AI fields from its manifest. Loaded regions arrive **locked in place**, so
newly uploaded PNGs pack around the existing layout. Upload the new sprites
(Upload tab), arrange, and **Save** under the same name — the exports and the
Atlas Maker manifest are updated in place. Uploading a file named like an
existing sprite replaces its pixels.

The right panel's **Import** tab is for bringing in a packed sheet or coords file
from elsewhere (`.atlas` / TexturePacker JSON / manifest) — **Save As** keeps it
as a project sheet.

### Importing a pre-packed cocos2d atlas (`.plist`) — verbatim

The **Import** tab's lower half takes an existing packed atlas: pick the
`.plist` and its `.png`/`.webp` page, optionally set a sheet name (default: the
plist's file name), and click **Import .plist atlas** (`/api/import-plist`).

The atlas is reused **as is** — every rect is *converted*, never re-packed, so a
game already bound to those coordinates keeps rendering.

One thing does change in the pixels: **cocos2d rotates packed frames the opposite
way round from this pipeline**, so each rotated frame's block is flipped 180° in
place on import. Without it every rotated frame renders upside down. A 180°
rotation preserves the bounding box exactly, so no rect moves and no neighbouring
frame is touched, and the re-encode is lossless to the same format. A sheet with
**no** rotated frames is written byte-for-byte, untouched. The result line reports
how many frames were reoriented.

The import writes
`sheets/<sheet>/<sheet>.png`, a TexturePacker JSON, and
`manifests/atlas_manifest_<sheet>.json`, all mirrored to R2.

Only TexturePacker's **cocos2d format 3** is supported; formats 0–2 store rects
under different keys and are refused with a message telling you to re-export.
The import also **refuses** when the rects don't check out against their own
page (out-of-bounds, or any overlap — a packer never emits overlapping rects, so
an overlap means the geometry decoded wrong). Refusing beats importing an atlas
that renders as sliced-up garbage and reads as bad *art* rather than a bad
import.

After a successful import the panel reports the frame count, how many frames are
rotated, and every **detected sequence** (`anim-sym-pic1: 49 frames` — a
consecutively-numbered run). Sequences are recorded in the manifest's
`sequences` key as the hint the Flipbook tool reads to offer "create clip from
sequence".

**Read-only (recommended)** — checked by default — sets `"locked": true` on the
manifest. The rail marks locked sheets 🔒 and the server **refuses**
auto-arrange, Save and FX layers on them, because each of those re-packs the
page and rewrites coordinates. **Save As** under a new name is still allowed
(it copies rather than overwriting). If you really mean to re-author it in
place, select it in the rail and use **🔓 Unlock…** (`/api/unlock-sheet`) — the
lock is a guard, not a one-way door, but the original coordinates do not survive
the next Save.

**Import as editable (loses trim offsets)** re-slices the frames into ordinary
loose sprites and opens them on the canvas, and does *not* lock the sheet. This
is lossy on purpose: the region model centres art inside its cell and cannot
represent an off-centre **trim offset**, and in a real animated sheet those
per-frame offsets *are* the animation (art that scales frame-to-frame stays
anchored only because each frame carries its own offset). Use it only when you
intend to re-author the sheet, never to "open and check" a shipped atlas.

### Renaming a sheet

Select a sheet in the rail and click **Rename…** (`/api/rename-sheet`). A sheet's
name is baked into several places — `sheets/<name>/<name>.{png,atlas,json}`,
`sheet_src/<name>/`, `manifests/atlas_manifest_<name>.json`, and the manifest's
own internal back-references (the page/`.atlas`/JSON keys and every region's
`shape_ref`) — so the rename moves **all** of them on R2 and rewrites the manifest
refs, then deletes the old keys. This keeps original-sprite recovery working (it
relies on those `shape_ref`s) and keeps the Atlas Maker pointing at the renamed
manifest. Renaming refuses to overwrite an existing sheet of the target name.

## Config / env (names only)

`R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`SHEET_PROJECT` (default `cloud`), `SHEET_STAGING` (default `/data/sheet-tool`),
`PORT` (default `8766`), `SHEET_TOOL_SECRET` (optional access gate; unset =
open), `IW_PROJECT_NAME` (optional pinned project, set by the launcher).

State lives in the R2-backed staging tree (`sheet_config.json`, uploads,
exports) so it survives container restarts; writes mirror to R2.

## Prerequisites

- R2 credentials (the shared `invisibleassets` bucket).
- Sprite PNGs to pack.
- No GPU / ComfyUI needed — runs on CPU.

## Known limitations / TODOs

- The `sheet-tool` Railway service is **deployed and auto-deploys from `main`**; `/sheet`
  routes to it. (If `SHEET_TOOL_URL` is unset on the launcher, `/sheet` falls back to a
  "not configured" page.)
- Some flows still owe a live browser smoke-test against R2 — see
  [status/sheet-maker](../status/sheet-maker.md).
- The handoff to the Atlas Maker requires an Atlas Maker **restart** to pick up
  a newly authored manifest, because that tool hydrates from R2 only at boot.
