# Invisible Sheet Maker

Pack loose sprite PNGs into a single sheet, name the regions, add the AI fields,
and export the formats the rest of the pipeline consumes.

## What it is

A web tool that takes a folder of individual sprite PNGs, arranges them into one
packed sheet, lets you edit each region's name and per-region **AI fields**, then
exports any of:

- a **libGDX / Spine `.atlas`** (used by Spine + game runtimes),
- a **TexturePacker JSON** sheet descriptor,
- the **Invisible AI manifest** (`atlas_manifest_<name>.json`) that the
  [Invisible Atlas Maker](atlas-maker.md) consumes.

The authored manifest is also **handed off to the cloud Atlas Maker over R2** so
it shows up in that tool's manifest list. This is pure **Pillow/CPU work — no
ComfyUI** is involved.

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
4. **Edit** region names + the per-region AI fields in the UI.
5. **Export** (`/api/export`) — choose `.atlas`, TexturePacker JSON, and/or the
   AI manifest. The AI manifest is also pushed to the Atlas Maker's R2
   `manifests/` prefix.
6. In the Atlas Maker, **restart the service** (hydrate runs at boot) for the
   new manifest to appear, then generate art from it.

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
