# Invisible Font Maker — design + build plan

> A launcher tool to **create, view, and save bitmap fonts** per client / per project
> into R2, so any game in the pipeline can consume them by font-family name.
> Owner direction 2026-06-12. Related: `invisible-editor.md` §9 (the font *consume*
> side — already built).

## 1. Why this tool exists (the gap)

The whole **consume** side of fonts already ships:

- **Catalog contract** — `packages/engine-layout/src/lib/fontCatalog.ts`
  (`FontEntry` / `FontCatalog`, `findFont` / `isBitmapFont`).
- **R2 layout** — `<client>/<project>/fonts/fonts.json` + each font in its own
  subfolder; a `_shared/fonts/` library fallback. Path helpers in
  `apps/launcher-api/src/lib/server/projectPaths.ts` (`SUB.fonts`,
  `fontCatalogKey`, `fontBundlePath`, `sharedFontsPrefix`).
- **Read endpoints** — `GET /api/editor/fonts` + `lib/server/fonts.ts`
  `resolveEditorFonts`; bytes stream through `/api/editor/asset?...&font=1`
  (which rewrites a BMFont descriptor's relative `<page file>` refs to absolute
  gated URLs).
- **Editor render + in-game** — the editor renders the real fonts (`EditorTextLayer`);
  the engine `<BitmapText>` path (`LayoutNodeView`) is the remaining engine
  consume step.

The **only** way a font gets *into* that contract today is the PowerShell script
`apps/launcher-api/scripts/r2-sync-fonts.mjs`, which reads *pre-existing* BMFont
files off disk. There is **no authoring UI**. This tool is that UI.

## 2. The format question (settled)

The engine/game loads **BMFont XML** — a `.xml` descriptor + a page image —
via pixi's `Assets.load` (`type: 'font'`, passthrough in
`packages/pixi-svelte/src/lib/assetLoad.ts`). Proven by `apps/lines/src/game/assets.ts`
(`gold`/`silver`/`purple`/`goldblur` all load the `.xml`) and the canonical
`apps/lines/static/assets/fonts/goldFont/mm_gold.xml`
(`<info face>`, `<common>`, `<pages>`, `<chars>`; unicode `char id`s; no
`<kernings>` block in the shipped fonts).

**So the tool emits BMFont `.xml` + page PNG** — byte-compatible with what ships.
`name` (the entry's family) **MUST equal** the descriptor's `<info face>` — pixi
registers the `BitmapFont` under that face and games resolve
`<BitmapText fontFamily={name}>` by it.

## 3. Architecture (decided 2026-06-12)

- **Host: a launcher-native Svelte page at `/fonts`** (owner choice) — reuses
  launcher auth, the client→project selector, scope gating, and R2 writes. No new
  Railway/Python service.
- **Baking: browser-side, `opentype.js` + Canvas 2D.**
  - `opentype.js` loads the TTF/OTF → exact glyph outlines, metrics, and kerning
    (so we read metrics from the font, not lossy `measureText`).
  - Canvas 2D does the **effects natively** — gradient fills, `strokeText`
    outlines, `shadowBlur` drop-shadow. Effects in v1 (owner requirement).
  - JS shelf-packer lays glyph tiles onto a page; `canvas.toBlob` → page PNG;
    emit the BMFont XML string.
- **Writes: a `fontMaker`-gated launcher endpoint** (`POST /api/fonts/save`) using
  the existing `r2.ts` writers (`putObjectBytes` pages + descriptor under
  `fontBundlePath`, `putObjectText` the merged `fontCatalogKey`). `assertAllowed`
  every key against the gate's `prefixes`.
- **No `engine-layout` change, no new R2 client, no new path helpers** — the
  contract + writers already exist.

### Expectation boundary (important)
The generator bakes **clean parametric** fonts (TTF + gradient/outline/shadow
params). It does **not** pixel-recreate the existing hand-authored `mm_gold` /
`mm_silver` faces — those are designer layer-stacks. To bring those in, use
**Import** (§4). This is exactly why the tool supports both.

## 4. Scope — three modes

| Mode | Behaviour |
|---|---|
| **View** | List the project's + `_shared` fonts from the catalog; live `<BitmapText>` preview with an editable sample-text field. |
| **Import** | Upload an existing BMFont (`.xml`/`.fnt` + page PNG) [web fonts later] → preview → save into `fonts/<folder>/` + merge `fonts.json`. Replaces the sync script for the common case. |
| **Generate** | Upload TTF/OTF → charset preset (digits / currency / ASCII / custom) + size + **effects** (solid/gradient fill, outline, drop-shadow/blur) → live preview → bake BMFont XML+PNG → save. |
| **Save target** | Per-project (default) or shared library (`_shared/fonts/`). |

## 5. Build order (phased)

0. **Phase 0 — register + skeleton.** This doc; `roles.ts` (`fontMaker` in
   `TOOLS` / `ROLE_TOOLS` / `TOOL_ICONS` / `TOOL_DOC_SLUG`); route
   `(app)/fonts/+page.server.ts` (`ssr=false`, gate `fontMaker`, return scope +
   catalog); `+page.svelte` shell branded with `Emblem.svelte`.
1. **Phase 1 — View.** A `fontMaker`-gated read (`GET /api/fonts/catalog`) +
   self-contained byte streamer (`GET /api/fonts/asset`) so the tool does NOT
   depend on the `editor` grant; live PIXI `<BitmapText>` / `<Text>` preview.
   Factor `resolveEditorFonts` to take an `assetUrl` builder so both the editor
   and this tool reuse one resolver.
2. **Phase 2 — Import + Save. ✅ LANDED 2026-06-12 (code-only, not browser-verified).**
   Upload a BMFont (`.xml`/`.fnt`/`.json` + page image[s]) → client parses + live-previews
   → save. Uploads use **presigned PUT** (BMFont page PNGs exceed adapter-node's 512 KB
   `BODY_SIZE_LIMIT`): `POST /api/fonts/upload-urls` mints `presignPut` URLs for the
   descriptor + each page (keys via `fontBundlePath`, `assertAllowed`); the browser PUTs
   each file straight to R2; then `POST /api/fonts/save` is **authoritative** — re-reads
   the uploaded descriptor from R2, re-derives `name` (`<info face>`) + `pageFiles` via
   `lib/server/bmfont.ts` `parseBmfontDescriptor` (never trusts the client), verifies each
   page `objectExists`, and upserts the `fonts.json` entry by `id===folder`. Client:
   `FontImport.svelte` + `fonts.client.ts` `parseDescriptorClient`/`loadLocalBitmapFont`
   (builds a `BitmapFont` from object-URL pages for the pre-save preview — a blob
   descriptor can't go through pixi's `loadBitmapFont` because it mangles relative page
   refs). Per-project writes only (shared = Phase 4). `pnpm --filter launcher-api build` GREEN.
3. **Phase 3 — Generate. ✅ LANDED 2026-06-12 (code-only, not browser-verified).**
   `FontGenerate.svelte` + `fontBake.client.ts`: upload a TTF/OTF (`opentype.js`),
   pick a charset (`charsets.client.ts`: digits/currency/alphanumeric/ASCII/custom) +
   size + page width + **effects** (solid/gradient fill, outline, drop-shadow, each
   toggleable), bake a glyph atlas + BMFont XML **in the browser** (opentype for
   metrics/geometry → Canvas 2D `Path2D` fill/stroke/shadow → shelf packer → single
   page PNG), live-preview via `loadLocalBitmapFont` + PIXI `BitmapText` (the same
   game-load path = the metrics self-check), and save via the SAME Phase-2 flow. The
   client upload→save sequence was extracted to `fonts.client.ts` `saveBitmapFont(...)`
   and is now shared by Import + Generate. Metrics: `scale=fontSize/unitsPerEm`,
   `base=round(ascent)`, `lineHeight=round(ascent+descent)`, per-glyph tile = ink box
   (`Path.getBoundingBox()`) + effect-bleed `pad`, `xoffset/yoffset` relative to pen/
   line-top, `xadvance=round(advanceWidth*scale)`. Deps: `opentype.js` + `@types`.
   Deferred to Phase 4: kerning (`<kernings>`), multi-page atlases, shared-library save.
   `pnpm --filter launcher-api build` GREEN.
4. **Phase 4 — polish** (incremental).
   - **Round 1 ✅ LANDED 2026-06-12 (code-only): Generate baker — kerning + multi-page.**
     `fontBake.client.ts`: emits a `<kernings>` block from `font.getKerningValue` (toggle,
     default on; capped at 256 chars); multi-page shelf packer (new **page max height**
     control, default 2048) producing one PNG per page (`<base>.png` single, `<base>_i.png`
     multi), `<common pages="N">` + per-`<char page>`; `BakeResult.pages: {file,blob,canvas}[]`.
     Preview + `saveBitmapFont` already multi-page-capable (no server change; `loadLocalBitmapFont`
     iterates `<page>`s). `pnpm --filter launcher-api build` GREEN.
   - **Round 2 ✅ LANDED 2026-06-12 (code-only): delete + web-font import + shared target.**
     (a) **Delete** — `POST /api/fonts/delete` removes the entry + its R2 files; View cards
     get a confirm-Delete button (hidden for shared fonts unless the user can publish);
     `/api/fonts/catalog` now returns `source: 'project'|'shared'`. (b) **Web-font import** —
     `FontImport.svelte` accepts woff2/woff/ttf/otf → `kind:'web'` (user-supplied family
     name + per-file weight/style, format from ext); `/api/fonts/save` gained a `web` branch
     (no descriptor parse; validates each file exists + format token); `saveWebFont` client
     helper. (c) **Shared library** — new admin-gated capability `fontPublish` (`roles.ts`,
     default admin-only); a `target: 'project'|'shared'` on `upload-urls`/`save`/`delete`
     routed through one `resolveFontTarget` helper (`lib/server/fonts.ts`) that enforces the
     capability for shared — **the real write gate**, since `includeSharedFonts` only widens
     the `assertAllowed` READ allow-list; the Save-target selector shows only to publishers
     (`+page.server.ts` `canPublishShared`). `pnpm --filter launcher-api build` GREEN.
     **Deferred: rename** (means moving R2 objects — its own task).

## 6. Touch-points (Phase 0–2)

- `apps/launcher-api/src/lib/roles.ts` — registry entry + icon + doc slug.
- `apps/launcher-api/src/routes/(app)/fonts/+page.server.ts` + `+page.svelte`
  (+ helper components).
- `apps/launcher-api/src/routes/api/fonts/catalog/+server.ts` (read),
  `.../fonts/asset/+server.ts` (gated streamer), `.../fonts/save/+server.ts` (write).
- `apps/launcher-api/src/lib/server/fonts.ts` — parametrize `assetUrl`.
- `docs/tools/font-maker.md` — user doc (later).

Reuses (do **not** re-create): `r2.ts` writers, `projectPaths.ts` font helpers,
`toolScope.ts` `gate`/`assertAllowed`/`includeSharedFonts`, `fontCatalog.ts`,
`auth.ts` `getActiveScope`.
