# Invisible Font Maker

Create, view, and save the bitmap (and web) fonts your games use. Import an
existing BMFont, bake a fresh one from a TTF/OTF in the browser, or register a
web font — all writing into the project's R2 font catalog that the engine reads.

## What it is

A launcher-native authoring UI for the project font catalog (`fonts.json` in the
shared `invisibleassets` R2 bucket). It has three tabs:

- **View** — lists the project's fonts (with a `_shared` library fallback) and
  live-renders each one with PIXI so you can read it before you commit to it.
- **Import** — upload an existing **BMFont** descriptor + page image(s), or a
  **web font** (`.woff2`/`.woff`/`.ttf`/`.otf`), preview it, and save.
- **Generate** — upload a **TTF/OTF**, pick a character set + size + effects, and
  bake a BMFont (XML descriptor + page PNG) entirely in the browser, then save.

The output is byte-compatible with what the games already load: a BMFont `.xml`
descriptor + page PNG, where the catalog `name` equals the descriptor's
`<info face>` so a game resolves `<BitmapText fontFamily={name}>` by it.

- **Where it runs:** the launcher itself, at `/fonts` — a real full-page route
  inside `(app)`, behind the auth + role gate. It is **never an iframe** and
  never a redirect; the page is client-only (`ssr = false`) because it renders
  fonts live with PIXI, but its `load` still runs server-side to resolve the
  active client/project and your publish entitlement.
- **Access:** the `fontMaker` tool, granted by default to `admin`, `developer`,
  `artist` and `pipelineTester` roles (overridable per role/user in the admin panel like any
  tool). Every authenticated Font Maker user can **read** the shared `_shared/fonts/`
  library, but **publishing** to it (save/overwrite/delete a shared font) needs
  the separate `fontPublish` capability — default-ON for `admin` only. The
  Save-target selector (Project vs Shared library) only appears for holders of
  that capability; `includeSharedFonts` alone widens the read allow-list and is
  **not** a write gate, so the font endpoints check `fontPublish` explicitly.

## How to use it

The page header shows the active **client / project** — every save, delete, and
the View catalog are scoped to that project (set it from the launcher project
selector before you start). Two shared controls at the top — **Sample text** and
a **Size** slider — drive every live preview across the View and Generate tabs.

### View — see what the project already has

1. The View tab loads the project's catalog on open. Each font is a card with its
   `name`, a `bitmap`/`web` badge (and a `shared` badge if it came from the
   `_shared` fallback), its catalog `id`, a page-image thumbnail (bitmap), and a
   live PIXI render of your Sample text at the current Size.
2. **Edit** (bitmap fonts baked here only) reopens that font's saved bake recipe
   in the Generate tab so you can tweak params and re-bake.
3. **Delete** removes the entry and its R2 files after a confirm step. Delete is
   hidden for `_shared` fonts unless you hold `fontPublish`.

### Import — bring in an existing font

1. Open the **Import** tab and drop (or choose) files. Two sub-modes are detected
   automatically:
   - **Bitmap**: a BMFont descriptor (`.xml`/`.fnt`/`.json`) **plus** every page
     image it references (`.png`/`.webp`/`.jpg`). The panel lists the detected
     face name, glyph count, and each declared page, flagging any page you
     haven't supplied — you must supply **every** declared page before saving.
   - **Web**: any `.woff2`/`.woff`/`.ttf`/`.otf` file switches the panel to web
     mode. Enter the **family name** the game will reference and set each file's
     weight/style. (Note: on the Import tab a TTF/OTF is treated as a *web* font;
     to bake it to a bitmap instead, use the Generate tab.)
2. Preview it live (bitmap → PIXI `BitmapText`; web → a real `FontFace` rendered
   in a DOM span).
3. Set the **Folder / id** (1–64 chars: letters, digits, `-`/`_`, starting with a
   letter or digit). It defaults to a slug of the face/family name.
4. Pick the **Save target** (Project, or Shared library if you can publish) and
   **Save**.

### Generate — bake a bitmap font from a TTF/OTF

1. Open the **Generate** tab and drop/choose a TTF or OTF. `opentype.js` reads the
   real glyph outlines, metrics, and kerning.
2. Set the **Family name** (becomes both the catalog `name` and the descriptor's
   `<info face>`) and the **Folder / id** (tracks the family name until you edit
   it by hand).
3. Pick a **character set** preset:
   - **Digits (0-9)**
   - **Currency** — digits plus `. , $ € £ ¥ ¢ + -` and space. ⚠ This preset
     bakes **no letters** (see Known limitations).
   - **Alphanumeric** — digits + A–Z + a–z.
   - **ASCII printable** — `0x20`–`0x7E`.
   - **Custom** — type the exact characters in the textarea.
4. Set **glyph size**, **page max width/height**, toggle **kerning**, and
   configure **effects** (fill — **Solid** or **Gradient**; outline width/color;
   drop shadow offset/blur/color), then **Bake**.
   - **Gradient** opens a Photoshop-style ramp editor. The bar runs **glyph top →
     glyph bottom** (each glyph's own ink box, so the whole ramp fits inside every
     letter). **Click the rail under the bar to add a colour stop** — it starts as
     the colour the ramp already shows there — **drag** it to move, and **drag it
     off the rail** (or select it and press Delete) to remove it; arrow keys nudge
     the selected stop, Shift for bigger steps. The selected stop's **Color**,
     **Opacity** and **Location** sit under the bar, with **Delete** and
     **Reverse**. The small **diamond** between two stops is their midpoint — drag
     it to shift where the 50/50 blend lands, exactly like Photoshop. A stop's
     opacity bakes into the PNG's alpha, so a ramp can fade a glyph out.
5. The preview renders through the **same** load path a game uses (`BitmapText`
   built from the baked descriptor + page blob), so it doubles as a metrics
   self-check. The panel reports page size, page count, glyph count, kerning
   count, and any characters the font lacked (skipped).
6. Pick the **Save target** and **Save**. Generated fonts also persist an
   authoring-only re-bake recipe (the source font + bake params) so they can be
   reopened via **Edit** later; the recipe is never shipped to a game.

### Saving (how it lands in R2)

Save is a three-step sequence shared by Import and Generate: the browser mints
presigned PUT URLs (`/api/fonts/upload-urls`), PUTs each file straight to R2
(BMFont PNGs exceed the adapter-node body limit, so direct-to-R2 is required),
then calls `/api/fonts/save`, which is **authoritative** — for a bitmap font it
re-reads the uploaded descriptor from R2, re-derives the `name`/pages itself
(never trusting the client), verifies every page landed, and upserts the
`fonts.json` entry keyed by `id === folder`.

## Known limitations / TODOs

- **The `currency` preset bakes digits + symbols but NO letters.** If a game's
  HUD then renders a character outside the baked set (e.g. a letter), PIXI's
  `BitmapText` reads an `undefined` glyph's `xAdvance` and the render loop dies —
  which **black-screens the game on spin**. If a font feeds a HUD that can show
  letters, bake with **Alphanumeric/ASCII** or add the needed characters via
  **Custom**. An engine-side guard that skips/substitutes a missing glyph instead
  of crashing is still **TODO** — until then the safe set is your responsibility.
- **id collisions are guarded, not silent.** A font's catalog `id` is its
  `folder`. Saving a new font whose id already exists requires an explicit
  **Overwrite** opt-in in the UI; server-side, `/api/fonts/save` rejects a
  colliding id with a **409** unless `overwrite: true` is set (the uploaded bytes
  have already landed by then, so the catalog upsert is the last guard). A past
  bug let a same-id font silently replace another; this opt-in is the fix.
- **Saving alone does not ship a font to a game.** The Font Maker writes into the
  project's R2 catalog and the editor reads it directly, but a published game
  only registers fonts that travelled the full **export → `deploy/editor-fonts/`
  → bake → pull → register** chain (`fontExport.ts`, mirroring `editorArtExport.ts`).
  A shipped game must also have `EDITOR_DOC_SECRET` in its build env (the "token
  trap") or the export is skipped and stale/built-in fonts ship instead.
- **Generate baker scope:** kerning and multi-page atlases are supported; **rename**
  (moving a font's R2 objects under a new id) is deferred — change the id by
  deleting + re-saving for now.
- **Browser-verification pending.** The Import/Generate/delete/web-import/shared
  flows landed code-only (2026-06-12) and have not all been smoke-tested live in
  the browser.
