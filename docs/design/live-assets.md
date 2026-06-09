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
