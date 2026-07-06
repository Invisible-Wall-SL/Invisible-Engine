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
  `ui.html`, packing in `packer.py`, export in `atlas_writers.py`).
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

- The launcher `/sheet` route exists; the **Railway service still needs to be
  created** from `services/sheet-tool/` and `SHEET_TOOL_URL` set on the launcher.
  Until then `/sheet` shows a "not configured" page.
- Not yet run live against R2 / smoke-tested in the browser.
- The handoff to the Atlas Maker requires an Atlas Maker **restart** to pick up
  a newly authored manifest, because that tool hydrates from R2 only at boot.
