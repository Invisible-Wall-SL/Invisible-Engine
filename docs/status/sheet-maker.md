# Invisible Sheet Maker — status

> Design: [docs/design/atlas-per-user-session.md](../design/atlas-per-user-session.md) · Guide: [docs/tools/sheet-maker.md](../tools/sheet-maker.md) · Agent: `.claude/agents/atlas-python-tools.md`

**One-line state:** Live on Railway (`sheet-tool`, R2-backed, CPU-only). Project-file workflow + FX picker + atlas round-trip shipped; some flows still owner-live-verify owed.

## Current state
Works today on `main` / live:
- Pack loose sprite PNGs into one packed sheet, name each region, edit per-region **AI fields**, and export **libGDX/Spine `.atlas`**, **TexturePacker JSON**, and the **Invisible AI manifest** — the manifest is handed to the Atlas Maker over R2 (needs an Atlas Maker restart to appear). Pure Pillow/CPU; no ComfyUI.
- **Project-file workflow (B19)** — Sheets rail with Load / Refresh / Reset, plus **Save / Save As** and blank/duplicate-name guards.
- **Region + sheet rename** — renaming a sheet moves **all** its R2 objects (`sheets/`, `sheet_src/`, `manifests/`) and rewrites the manifest's internal back-refs + every region `shape_ref`, then deletes the old keys; refuses to overwrite an existing target.
- **Delete-verifies-R2** — delete re-lists R2 and fails loud rather than trusting local staging.
- **FX-layer picker** — per-sprite checkboxes (`shine`/`glow`/`shadow`/`blur`/`zoom`/`colour`) spawn same-size sibling cells named for the Atlas Maker's FX convention, slaved to the base (cascade rename/resize/delete); export propagates each cell's `mode` so the Atlas Maker opens it in the matching local-FX mode.
- **Verbatim `.plist` import** — `POST /api/import-plist` (Import tab) takes a cocos2d
  format-3 `.plist` + its page and reuses the atlas **as is**: the page is written
  byte-for-byte and every rect converted, never re-packed, so a shipped game bound to those
  coordinates can't break. Writes the page, a TexturePacker JSON and the AI manifest (all
  mirrored to R2); the manifest gains `locked` / `import` / `sequences`. Refuses format 0–2
  and any atlas whose rects fail `plist_import.validate` (out-of-bounds / overlap = misread
  geometry). Detected numeric runs are recorded in `sequences` as the hint the /flipbook tool
  reads. `editable=1` is the opt-in lossy path (re-slices to loose sprites, **drops per-frame
  trim offsets**, doesn't lock).
- **Sheet lock** — a `"locked": true` manifest makes `api_arrange`, `api_export` and
  `api_fx_sync` refuse (each re-packs the page); `POST /api/unlock-sheet` clears it. `Save As`
  under a new name is still allowed. The rail marks locked sheets 🔒 (`api_state.locked_sheets`,
  `api_load_sheet.locked`) and offers Unlock.
- **Atlas round-trip hardened** — `relinkFx` enforces one child per `(base, mode)` (a second claimant is demoted, not dropped) and collapses duplicates, fixing the "duplicate region names" / wrong-`_glow` art after a bounce through the Atlas Maker; `_serve_sprite` cache set to `max-age=0` for the stale-recolour fix.

## Open items / next
1. **Browser live-verify owed** — the project-file workflow (B19: rename / Save / Save As + name guards), the FX-layer picker and now the `.plist` import + lock UI landed with local/headless verification; a full live browser pass on Railway is still owed. For the import specifically: a REAL shipped `.plist` (not the synthetic fixture) and confirmation that the imported page/JSON/manifest land in R2.
2. **Per-user session parity (Phase 4) — planned, unbuilt** (design `atlas-per-user-session.md`): thread the launcher `user` id and scope any server-remembered view state / canvas defaults per user. Minimal — the tool is largely stateless server-side (compose is synchronous, geometry rides in the request).

## Blocked (owner / external)
- None outstanding. (The service is deployed and auto-deploys from `main`; the guide's "Railway service still needs creating" note is stale.)

## Recent changes
- 2026-07-20 — verbatim cocos2d `.plist` import wired into the UI + API (`/api/import-plist`,
  `/api/unlock-sheet`, Import-tab controls, 🔒 rail marker). Engine = `plist_import.py`
  (covered by `test_plist_import.py`, 22 checks). Verified offline against a synthetic
  6-frame/1-rotated atlas: byte-identical page, manifest shape, sequence detection, every
  refusal path, lock→unlock round-trip and the editable path. **Not yet verified live:** the
  R2 mirror of the imported objects and a real shipped `.plist` in the browser.
- 2026-07-20 — uploaded sprites now order **naturally** (`explosion_2` before `explosion_10`), on the saved batch, the accumulated pile, and loose-sprite recovery. Step 3 of [invisible-flipbook](../design/invisible-flipbook.md) — upload order drives region order drives manifest order, which the clip editor reads (`d7107f4`).
- 2026-07-08 — fixed duplicate FX-child names + stale glow/shine after an Atlas-Maker round-trip (`d13a7c7`) ([detail in history](../history.md)).
- 2026-07-06 — per-sprite FX-layer picker (auto-spawns same-size FX sibling cells) ([detail in history](../history.md)).
