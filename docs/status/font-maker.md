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
- 2026-08-04 — **`fonts.json` save/delete are now race-safe (multi-user-concurrency Phase 0).** The catalog was read-modify-written unguarded; the existing 409 id-collision guard is only a *within-request* check, so two users adding fonts at once — or one adding while another deletes — silently dropped an entry. Worst on the SHARED-scope `_shared/fonts/fonts.json`, a global key no lease can cover. `/api/fonts/save` and `/api/fonts/delete` now read the catalog with its etag, mutate, and PUT under `If-Match` (`If-None-Match: '*'` when absent), with a bounded CAS retry. The id-collision guard re-runs against a FRESH read on every retry, so a cross-user same-id race surfaces as the descriptive collision 409 instead of a clobber; a genuine lost CAS returns `{ error: 'conflict' }` (never `error()`). A present-but-corrupt catalog is overwritten deliberately via `ifMatch`, not wedged behind the create precondition. **Kept as an R2 blob, not moved to Postgres** — the catalog is read on the export→deploy asset-shipping path (`fontExport.ts`), by `resolveEditorFonts`/`runtimeBundle.ts`, and by `r2-sync-fonts.mjs`, so a table would carry asset-shipping blast radius (the same reasoning that keeps `skeletons.json` in R2). Verified offline with a CAS port-test over the real `precondition`/`ConflictError` semantics (create, sibling-preserving concurrent add, same-id race → 409 winner preserved, overwrite, delete-with-concurrent-sibling, delete-unknown → 404).
- 2026-07-28 — **fonts now resolve by unique `id`, not the shared BMFont `<info face>`.** Two fonts that share a family face (e.g. gradient variants of one typeface) used to collide everywhere — the Scene Editor dropdown showed identical labels + stored an identical `fontFamily` (picking a variant was a no-op), the editor preview + the game both keyed the PIXI cache on the face so only the last-loaded survived. Now: `findFont`/`fontFamilyForRef` (engine-layout `fontCatalog.ts`) resolve `id`-first with a `name` fallback (legacy docs); `mergeBakedFontCatalog` keys by `id`; `bakedFontAssets` carries `family: id` and pixi-svelte's `AssetsLoader`/`getProcessed` register the loaded `BitmapFont` under `${id}-bitmap`; `CatalogText` rewrites a node's font ref to the registered family (bitmap→id, web→name); the editor builds/loads its preview font under `${id}-bitmap`; the Scene Editor font dropdowns are `value={id}` + labelled `name · id [kind]`. Verified by an offline contract fixture over the real modules; full browser live-verify pending.
- 2026-07-03 — coded HUD/label text now honours authored bitmap fonts via shared `CatalogText` (`fbf2f6f`) ([detail in history](../history.md)).
- 2026-06-12 — Phases 1–4 landed code-only: View, Import + Save, Generate baker (kerning + multi-page), delete + web-font import + shared target ([detail in history](../history.md)).
