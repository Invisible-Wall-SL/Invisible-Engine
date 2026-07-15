# Invisible Font Maker — status

> Design: [docs/design/invisible-font-maker.md](../design/invisible-font-maker.md) · Guide: [docs/tools/font-maker.md](../tools/font-maker.md) · Agent: `.claude/agents/launcher-studio.md`

**One-line state:** Built (all phases landed code-only 2026-06-12) as the launcher-native `/fonts` route; full browser live-verify still pending.

## Current state
Works today on `main` (code complete, most flows not yet browser-verified):
- **Launcher-native `/fonts`** — a real full-page `(app)` route (never an iframe/redirect), `ssr=false`, behind the `fontMaker` gate (admin/developer/artist by default). Writes into the project R2 font catalog (`fonts.json`) that the engine already consumes; no new Railway/Python service.
- **View** — lists the project's fonts + a `_shared` library fallback, live-rendered with PIXI `<BitmapText>` at an editable sample-text/size.
- **Import** — a BMFont descriptor (`.xml`/`.fnt`/`.json`) + its page image(s), **or** a web font (`.woff2`/`.woff`/`.ttf`/`.otf`); preview → save.
- **Generate** — upload a TTF/OTF (`opentype.js`) → charset preset (digits / currency / alphanumeric / ASCII / custom) + size + **effects** (solid/gradient fill, outline, drop-shadow) → bake a BMFont XML + page PNG **in the browser** (Canvas 2D + shelf packer), live-preview through the real game load path. Supports **kerning + multi-page** atlases; persists an authoring-only re-bake recipe for **Edit**.
- **Save** — presigned-PUT direct-to-R2 (BMFont PNGs exceed adapter-node's body limit) then an **authoritative** `/api/fonts/save` that re-reads the uploaded descriptor, re-derives `name`/pages server-side, and upserts by `id === folder`.
- **Delete** + **shared library** — delete removes entry + R2 files (confirm); saving/deleting a `_shared` font needs the separate admin-default `fontPublish` capability (`includeSharedFonts` only widens the READ allow-list).
- **id-collision guard** — a new font whose `id`/`folder` already exists is rejected **409** unless `overwrite: true` (explicit UI opt-in); this is the fix for the past bug where a same-id font silently replaced another.
- The consume side ships: coded HUD/label text honours authored bitmap fonts via the shared `CatalogText` (fixed 2026-07-03).

## Open items / next
1. **Browser live-verify** — Import / Generate / delete / web-import / shared-library all landed **code-only (2026-06-12)** and have not all been smoke-tested live.
2. **Rename deferred** — changing a font's `id` means moving its R2 objects; for now delete + re-save. Its own task.
3. **Full ship-chain wiring** — saving writes the R2 catalog (editor reads it directly) but a published game only registers fonts that travel `export → deploy/editor-fonts/ → bake → pull → register` (`fontExport.ts`); a shipped game also needs `EDITOR_DOC_SECRET` in its build env or the export is skipped.

## Blocked (owner / external)
- None. (The `currency`-preset missing-glyph black-screen is a documented usage hazard; the engine-side skip/substitute guard is a TODO, not a blocker.)

## Recent changes
- 2026-07-03 — coded HUD/label text now honours authored bitmap fonts via shared `CatalogText` (`fbf2f6f`) ([detail in history](../history.md)).
- 2026-06-12 — Phases 1–4 landed code-only: View, Import + Save, Generate baker (kerning + multi-page), delete + web-font import + shared target ([detail in history](../history.md)).
