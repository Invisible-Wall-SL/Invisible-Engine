# Live Assets — R2 `deploy/` as the game asset contract (design)

The missing link in the pipeline: a game edited in the tools (Atlas Maker / editor)
must **build with the latest edits**, not with stale assets baked into the game repo.

## The problem (as observed)

You change a static-symbol atlas online, republish Book of Borut, and still see the
old graphic. Cause: the game never reads R2. Its atlas is a TexturePacker spritesheet
(`symbolsStatic.json` + page image) committed in the game repo's `static/assets/` and
baked into `build/` by `vite build`. The editor writes your edits to a *different* R2
location (`<C>/<P>/atlas` / `deploy/`) in a *different* format (libGDX `.atlas`).
`publish-game-bundle.mjs` only re-uploads the already-built `build/`. Nothing bridges
the two, so a republish re-ships the old baked file.

This was registered-but-parked work: `unified-project-repo.md` already documents
`<C>/<P>/deploy/` as "deploy-ready final assets (game pulls from here)". This finishes it.

## The contract

**`<C>/<P>/deploy/` is the single game-loadable asset directory.** It mirrors the
game's `static/assets/` subtree and holds assets in **exactly** the shape the engine
loads (TexturePacker `frames`+`meta` spritesheet JSON + sibling page image; libGDX
`.atlas`+skeleton+page for spines). Every game sources its art from here.

### Naming convention (owner decision 2026-06-04)

No per-game mapping file. The R2 `deploy/` path **mirrors** the local
`static/assets/` path, so the basename is the asset's folder/stem:

```
R2:    <C>/<P>/deploy/sprites/symbolsStatic/symbolsStatic.{json,webp,png}
local: static/assets/sprites/symbolsStatic/symbolsStatic.{json,webp,png}
R2:    <C>/<P>/deploy/spines/symbols/symbols.{atlas,webp}  + <symbol>.json
local: static/assets/spines/symbols/symbols.{atlas,webp}   + <symbol>.json
```

The puller mirrors `deploy/<rel>` → `static/assets/<rel>` verbatim. Renaming an asset
folder means renaming on both sides — convention over config, no silent indirection.

## Two gaps to close

### 1. Producer — deploy must emit game-ready spritesheets

Atlas Maker's deploy (`services/atlas-tool/ui_server.py::_deployatlas`) currently writes
`<basename>.{png,webp,atlas}` where `.atlas` is a Spine/libGDX region map — NOT the
`frames`+`meta` JSON the game loads. Fix: deploy ALSO writes `<basename>.json` in
TexturePacker json-hash format, reusing the proven writer
`services/sheet-tool/atlas_writers.py::write_texturepacker_json` (Sheet Maker already
emits exactly the game's format). Deploy writes under the mirrored subpath
(`deploy/sprites/<name>/…`), not flat, so the convention holds.

Watch-outs: game `frames` keys carry extensions (`h1.webp`, `explodedW.png`); `meta.image`
must equal the deployed page filename; reconcile the writer's auto-`.png` suffix with the
game's mixed `.webp`/`.png` frame keys.

### 2. Transport — build-time pull + runtime override (owner decision 2026-06-04: BOTH)

- **Build-time (default).** `apps/launcher-api/scripts/pull-project-assets.mjs` (sibling to
  `publish-game-bundle.mjs`): given a project key, mirror its R2 `deploy/` into the game
  repo's `static/assets/` before `vite build`. Wire as a `prebuild`/`predeploy` hook so
  **every build grabs latest**. This is the default path — assets still served fast from
  the bundle.
- **Runtime override.** A flag (`PUBLIC_LIVE_ASSETS=1` / `?liveAssets=1`) makes the engine
  asset loader resolve each `assetKey` to its R2 `deploy/` URL instead of the baked local
  file — for fast iteration/preview without a rebuild. Off by default in shipped builds.
  Engine touch point: `packages/pixi-svelte/.../AssetsLoader.svelte` + the game's
  `assets.ts` src resolution (swap base URL when the flag is set).

### 3. Cache-bust

`symbolsStatic.png` has a stable name and can serve stale from browser/Cloudflare even
after a correct republish. On publish, content-hash the pulled filenames OR purge the
Cloudflare path for the game's `assets/` prefix.

## Build order

1. **Producer:** `_deployatlas` emits TexturePacker JSON into the mirrored `deploy/` subpath
   (share `write_texturepacker_json`). Verify `deploy/` now holds a game-loadable spritesheet.
2. **Puller:** `pull-project-assets.mjs` — list+mirror `deploy/` → `static/assets/`. Manual run first.
3. **Wire prebuild** hook in the game (Book of Borut first), so `pnpm build` pulls then builds.
4. **Cache-bust** on publish.
5. **Runtime override** in the engine loader (last — biggest engine surface).
6. Prove on Book of Borut: edit atlas online → `pnpm build` → republish → new graphic shows.

## Open decisions

- **Project key source for the puller** — env var in the game repo (`PUBLIC_PROJECT_KEY` =
  `borut/bookofborut`) vs a field in the game's `package.json`. Recommend env, mirrors the
  editor-scenes fetch which already keys by project.
- **Spines/audio/fonts** — same convention applies; v1 can start with sprites/atlas and extend.

## Layout-doc bake (build-time freeze) — added 2026-06-09

The puller above freezes **assets**. This freezes the **layout doc + custom component defs**,
closing the same class of "authored online but not in the shipped bundle" gap for the editor doc.

**Why.** A running game fetches `/api/editor/doc` at boot (bundled fallback on failure) — a
runtime latency + a hard dependency on the launcher. Worse, at game runtime only the *built-in*
ComponentDefs are registered (`registerComponents({...})` in `Game.svelte`); a component
**customized in the Component Editor** (extra nodes, author params) is saved only to R2
(`_shared/editor-components/<id>.json` / `editor/<project>/components/<id>.json`) and seen only by
the editor — so a built game renders the coded built-in and the per-instance override never shows.

**How.** A build-time bake mirrors the live fetch into the bundle:

1. **Endpoint** — `GET /api/editor/doc?...&components=1` (the existing `EDITOR_DOC_SECRET`-gated,
   token-only endpoint a build runner can call) additionally returns `componentDefs`: the
   transitive closure of referenced defs (`collectComponentIds` in `engine-layout`, resolved via
   `loadComponent` through built-in → shared → project precedence — so an edited `button` shadows
   the coded one). Omitted unless `&components=1`, so the runtime boot fetch stays lean.
2. **Bake script** — `apps/launcher-api/scripts/bake-editor-doc.mjs` (sibling to
   `pull-project-assets.mjs`, fetch-only, `--optional`/`--dry-run`) writes
   `{ doc, componentDefaults, componentDefs }` to the game's `src/baked-editor-bundle.json`.
3. **Game boot** — `editor-scenes.ts` imports that JSON. A non-null `doc` flips the game to the
   **baked path**: `registerBakedComponents()` (called after the built-in `registerComponents`, so
   baked defs shadow built-ins) + `loadEditorScenes()` returns the baked doc, **skipping the live
   fetch**. The checked-in placeholder has `doc: null` → un-baked repos (incl. `apps/lines` dev)
   keep fetching live, byte-identical. Self-describing — no env flag.

**Wire it (per game, e.g. Book of Borut — its own repo):** add a `bake:doc` script
(`bake-editor-doc.mjs --project <client>/<project> --dest ./src/baked-editor-bundle.json
--optional`) and chain it into `build` after `build:engine`. `new-game.mjs` scaffolds the script
entry. Authoring stays dynamic (editor); production ships static + self-contained.

## Editor-art export — doc-referenced art reaches the build automatically (added 2026-06-10)

The bake above freezes the doc, but the ART the doc references was still manual: a sprite
placed from the editor Library keeps `assetKey = <R2 manifest key>` + `region`, which the
editor renders straight from R2 — while the game resolves textures ONLY from spritesheets
declared in `assets.ts`. Nothing exported those atlases to `deploy/`, so editor-placed
sprites (and image-param art on component instances) rendered as `Texture.EMPTY` in a
shipped game.

**How it works now (no manual steps):**

1. **Export (server)** — `$lib/server/editorArtExport.ts` walks the doc + its referenced
   ComponentDefs and collects: sprite-node manifest keys, region names set via image-kind
   params (located among the project's atlases), and standalone image keys (dropped atlas
   pages). For each referenced atlas it writes a TexturePacker json-hash sheet (frames keyed
   by the editor REGION NAMES — the engine's exact lookup keys) + a copy of the page under
   `deploy/editor-art/<stem>/`, plus an `index.json`. Stale objects from a previous export
   are pruned; the export is idempotent.
2. **Trigger** — `POST /api/editor/export-art?project=<key>&k=<token>` (same
   `EDITOR_DOC_SECRET` gate as the doc endpoint). `bake-editor-doc.mjs` calls it right
   before writing the bundle and embeds the returned index as `bundle.editorArt`.
3. **Transport** — unchanged: `pull-project-assets.mjs` mirrors `deploy/` →
   `static/assets/`, now including `editor-art/`. ⚠ Build-order: `bake:doc` must run
   BEFORE `pull:assets` so the freshly exported art is mirrored in the same build.
4. **Game** — `editor-scenes.ts#bakedEditorArtAssets()` turns `bundle.editorArt` into
   asset entries (`type:'sprites'` per sheet; `type:'sprite'` keyed by the node's full
   `assetKey` for standalone images); `stateApp.ts` spreads them into `createApp({assets})`.
   Un-baked repos get `{}` — dev parity.

## Font export — Font Maker fonts reach the build automatically (added 2026-06-12)

Same gap as editor-art, for fonts. A font made in the **Invisible Font Maker** is written to
R2 `<client>/<project>/fonts/<folder>/` + a `fonts.json` catalog. The **editor** renders it
by streaming straight from R2 (`/api/editor/fonts`), so it "works in the editor" — but the
**game** loads fonts only from files in its own `static/assets/`, and nothing exported the
font tree to `deploy/`. So a Font Maker font showed in the editor and was MISSING from the
shipped game. This mirrors the editor-art transport exactly:

1. **Export (server)** — `$lib/server/fontExport.ts#exportEditorFonts` reads the project's
   `fonts.json` (per-project, with the `_shared/fonts/` fallback) and copies each font's
   descriptor + page images (bitmap) or web-font files into `deploy/editor-fonts/<folder>/`,
   preserving file names so a bitmap descriptor's relative page refs resolve. Writes an
   `index.json` (the exported `FontCatalog`); prunes stale objects; idempotent.
2. **Trigger** — `POST /api/editor/export-fonts?project=<key>&k=<token>` (same
   `EDITOR_DOC_SECRET` gate). `bake-editor-doc.mjs` calls it right after the art export and
   embeds the returned catalog as `bundle.fonts.catalog`.
3. **Transport** — `pull-project-assets.mjs` mirrors `deploy/` → `static/assets/`, now
   including `editor-fonts/` (the prune step covers it too). ⚠ Same build-order rule:
   `bake:doc` BEFORE `pull:assets`.
4. **Game** — `editor-scenes.ts#bakedFontAssets()` turns each **bitmap** font into a
   `{type:'font'}` asset (preloaded by `AssetsLoader` before first paint; pixi installs the
   `BitmapFont` under its `<info face>`), spread into `createApp({assets})` via `stateApp.ts`.
   `bakedFontCatalog()` is merged into the boot `registerFontCatalog` (a baked family
   overrides a built-in of the same name) so the engine routes that `fontFamily` to
   `<BitmapText>`. **Web** fonts load via `registerBakedWebFonts()` (FontFace API). Un-baked
   repos keep only the game's hardcoded built-in fonts — dev parity.

## Asset cache-busting + dangling-binding guard — added 2026-07-03 (closes gap #3)

Symptom (observed on `bookofborutremake`): re-author an atlas (change the source
image, re-pack the sheet), and the running game keeps loading the OLD frame set —
`Sprite: key "T_Icon_Hat.png" is not found in the loadedAssets`. Re-saving the
Symbols State Machine appeared to fix it, but that's a red herring: saving the doc
has no server side-effect (`PUT /api/editor/symbols` only writes `symbols.json`),
and both the tool preview and the exporter resolve a frame the SAME way — a live
by-name scan of the current atlases. What actually healed it was the fresh page
load that came with re-saving. The real cause is the unclosed gap #3 above:

- **Stable URL + mutable content.** The editor-art / symbol exporters wrote each
  sheet to a STABLE deploy URL (`editor-art/<stem>/<stem>.json` + page). Re-packing
  overwrote the same URL, so any browser / Cloudflare copy served stale
  (`deployServe.ts` sets `cache-control: public, max-age=60`, and the edge can
  stretch that). The runtime re-exports every boot, but a cache at a stable URL
  never re-fetches.

**Fix — content-versioned filenames.** `sheetVersion()` (`assetVersion.ts`) stamps a
short content hash into every exported sheet's filenames
(`<stem>.<hash>.json` / `<stem>.<hash>.<ext>`, with `meta.image` pointing at the
versioned page). The hash covers the region set (names + rects + page dims — a
re-pack that changes geometry) AND the source page's R2 ETag (a pixel-only
re-export). One `headObject` HEAD per sheet — no page bytes stream through the
process, so the memory-flat `copyObject` path is preserved. A changed atlas ships
at a NEW URL the cache has never seen; the exporter's existing prune drops the old
version. Runtime + bake share the exporters, so both paths version identically.
(Spine bundles + Font Maker pages still use stable names — same class, deferred.)

**Fix — dangling-binding guard.** The exporters already knew both the bound names
and the shipped names but never compared them. They now emit `missing: string[]` —
every placed region (`editorArt.missing`) / bound symbol frame
(`symbols.index.missing`) that NO shipped atlas packs (so it would render blank).
Surfaced loudly at both ends: `bake-editor-doc.mjs` warns per publish, and the game
warns once at boot (`warnMissingAssets` in `editor-scenes.ts`) — turning a silent
runtime lookup-miss into an explicit "re-pack the atlas or re-pick the frame".

## Standalone-build optimization (opt-in) — added 2026-07-27

The pull mirrors `deploy/` **verbatim** on purpose — the ONLINE runtime must stay faithful to
what the editor shows, so it ships assets uncompressed/redundant (both `.png` + `.webp` twins,
audiosprites in every format Howler can fall back to). A shipped **standalone** build doesn't
need that redundancy, so an **opt-in** pass trims the provably-dead bytes without touching the
online path.

- **`apps/launcher-api/scripts/optimize-build-assets.mjs`** — runs over a mirrored
  `static/assets/` in place. Two safe, idempotent transforms, plus a report:
  1. **Dead image twins.** When `<name>.png` and `<name>.webp` sit together and only ONE is
     referenced by any atlas / sprite descriptor / loader `import`, delete the other. Both (or
     neither) referenced → leave alone. Reference detection is a generic basename scan over
     `.atlas`/`.json`/`.ts`/`.js`/`.svelte`, so no per-game hardcoding.
  2. **Redundant audio formats.** Keep only the requested formats (default `mp3,ogg`; `mp3`
     alone for max savings), delete the rest, and rewrite the audiosprite manifest `src` so the
     loader never chases a removed file.
  3. **Reports** (never deletes) images referenced by no descriptor — genuinely-unused art that
     may still be loaded dynamically by name, so a human decides.
- **`pull-project-assets.mjs --optimize [--audio-formats mp3,ogg]`** runs the same pass right
  after the mirror, so a lean build is one command. **Never in the default path** — online
  publishes and the runtime override are untouched.
- Measured on Book of Borut (2026-07-27): 61 MB → ~26 MB static/assets (28 dead PNG twins +
  2 audio formats = 34.8 MB), with the `mmBG.*` authoring duplicate surfaced for review.

## The shared build/deploy token (admin-managed)

All of the build-time endpoints above (`/api/deploy`, `/api/editor/doc`,
`/api/editor/export-art`, `/api/editor/export-fonts`, `/api/localization/strings`) and the
runtime layout fetch share ONE token (`?k=` / `secret`). The desktop launcher fetches it from
`GET /api/launcher/deploy-token` and injects it into game builds so `bake:doc` / `pull:assets`
/ the exports run authenticated on any machine.

**Source of truth (since 2026-06-12):** the token is resolved by
`$lib/server/appSettings.ts#getDeployToken()` — the admin-managed DB value
(`app_settings.deployToken`) if set, else the `EDITOR_DOC_SECRET` env var as the bootstrap
default/fallback. Every call-site reads `getDeployToken()`, so behaviour is identical to the
old env-only setup when no DB row exists. Manage it in **`/admin` → Settings → Deploy token**
(view masked, reveal once, set a typed value, or rotate to a strong random value). Only admins
can view/set/rotate; the secret is never logged and reveals are one-shot (re-mask on reload).

**`GET /api/launcher/deploy-token` is capability-gated:** it now requires the `gamePublish`
("Build & publish games") capability (managed in `/admin` → Roles, default-ON for `admin`).
This is an intentional behaviour change — previously every signed-in user could fetch the
token. Admins keep working; other publishers need the grant.

**Rotation:** rotating requires game rebuilds to pick up the new token. Already-deployed
(baked) games are unaffected — the baked bundle embeds its assets and does not call these
endpoints at runtime. (The runtime layout fetch on the launcher home rides `&k=` from the
freshly resolved token, so it tracks rotations automatically.)
