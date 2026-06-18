# Invisible Symbols State Machine

The editable twin of the in-game **Symbol Debug** grid: for each symbol, in each
animation state, rebind the cell to a sprite frame or a spine animation that already
lives in R2 — then ship those bindings to the game through the standard deploy chain.

## What it is

A grid editor for a game's `symbol × state → asset` map. Every game hardcodes a
`SYMBOL_INFO_MAP` — a binding for each symbol (e.g. `H1…H5`, `L1…L5`, `W`, `S`) in each
of six animation **states** (`Static`, `Spin`, `Land`, `Win`, `Post-win`, `Explosion`).
This tool turns that map into an editable surface: each cell is either a **sprite** (a
sheet frame) or a **spine** (a bundle + animation name) with width/height size ratios.
Edits are stored as a **sparse override doc** in R2 — only the cells you change are
recorded; everything else falls through to the game's coded default.

It mirrors the live in-game Symbol Debug overlay (`SymbolDebugOverlay.svelte`, gated on
`localStorage.IE_DEBUG=1` + the `d` hotkey), which renders this exact grid read-only.

- **Where it runs:** the launcher itself, at `/symbols` — a real full-page route inside
  `(app)`, behind the auth + role gate. It is not a redirect and never an iframe. The
  grid is client-rendered (the route sets `ssr = false`) because each cell draws a canvas
  thumbnail and the focused cell mounts a live WebGL spine preview.
- **Access:** the `symbols` tool (registry name "Invisible Symbols State Machine", bar
  name "Symbols SM"). Granted to `admin`, `developer`, and `artist` roles by default;
  overridable per role/user from the admin panel like any other tool.

The grid is scaffolded from the **active project's** symbol set. The launcher is cloud
and can't import a game's source, so each game publishes its coded `SYMBOL_INFO_MAP` to
R2 at build time and the tool reads it. A project that has built once with a deploy token
shows its own symbols; an un-published project (or `apps/lines` dev) falls back to the
committed `lines` set.

## How to use it

You always work in the context of the **active client/project** (shown top-left, with the
tool top bar). Switch projects from the launcher before opening the tool.

1. **Read the grid.** Rows are the game's symbols; the six columns are the states
   (`Static`, `Spin`, `Land`, `Win`, `Post-win`, `Explosion`). Each cell shows its
   **effective binding** — your override if you've made one, otherwise the game's coded
   default. Sprite cells render a frame thumbnail; spine cells render a live animation
   on the shared spine canvas (a chip labels the bundle + animation). A cell with no
   binding shows `unset`.
2. **Spot your edits.** A cell you've overridden gets a blue border and an **edited**
   badge. A small **↺** button in its corner **resets that cell to the coded default**
   (removing the override). The whole grid scrolls vertically; cells resize with the
   window.
3. **Open the cell editor.** Click any cell to open the side panel for that
   `symbol · state`. The panel loads a draft of the cell's current binding.
4. **Choose the type.** Toggle between **Sprite** and **Spine**. Switching type clears
   the asset binding, since a frame name is not a spine bundle.
   - **Sprite:** use the **Frame** picker (the same `RegionPicker` the editor uses) to
     choose a frame from any of the project's atlases/sheets.
   - **Spine:** pick a **Spine bundle** from the project's (and shared) bundles, then pick
     an **Animation**. Once the bundle loads, the animation list is populated from the
     skeleton; if it hasn't loaded yet you can type the animation name. Leaving it blank
     plays the skeleton's first animation. A live **Preview** plays the chosen animation.
5. **Set the size.** By default a cell **inherits the global symbol size** (see the
   **Symbol size** section below) — the panel shows an *"Inherits the global symbol size
   (W×H)"* hint with the value it will render at. To size this one cell differently, click
   **Set a custom size for this cell**: numeric **Width ratio** and **Height ratio** inputs
   appear (fine-grained, step `0.001`), seeded from the inherited value. A **↩ Use global
   size** link drops the per-cell size again so the cell goes back to inheriting the global.
   A **Size on the reel cell** gauge below the inputs previews the result live: a dashed
   square is one reel cell and the symbol is drawn at its effective size inside it (overflow
   is clipped at the cell edge), so you can judge the fit — and tune the global or the
   per-cell ratio — *before* publishing. It updates as you type.
6. **Apply.** **Apply** writes the draft into the working doc as an override (it requires
   an asset to be chosen). The cell updates immediately and is marked **edited**. The
   panel also has a **Reset to default** action for an overridden cell.
7. **Save.** The header **Save** button is enabled whenever the doc differs from what's
   on disk (dirty tracking). Saving `PUT`s the doc to R2 (`PUT /api/editor/symbols`),
   stamps it, and shows **Saved**. Save errors surface inline next to the button.
8. **Reload from R2.** The header **↻ Reload from R2** button re-fetches the spine bundles
   and their previews from R2. Use it after you re-export or replace a spine bundle (e.g.
   re-rigging in the Invisible Rigger) — otherwise the grid + pickers keep showing the
   *cached* skeleton, because spine art is loaded once per bundle and the skeleton/page
   files are HTTP-cached. Reloading drops those caches (previews refresh with the new art +
   animation names) and re-reads the project's bundle list (a brand-new bundle appears in
   the spine pickers). Your unsaved cell edits are preserved.

### Symbol size

At the very top of the page is the **Symbol size** panel — a single **global** size every
symbol inherits, expressed as a ratio of one reel cell (`1` = the symbol fills its cell).
It is the quick way to resize every symbol at once instead of editing each cell.

- Enter a **Width ratio** and a **Height ratio**. While the inputs are blank the global is
  **off** and each symbol keeps its own built-in size; as soon as you type a value an **on**
  badge appears and the global applies to **every** symbol.
- **Reset to default** clears the global, returning all symbols to their built-in sizes.
- The global applies to special symbols too (scatter / book / wild). To keep one of those at
  a bespoke size, leave the global on and give that symbol a **custom size on its cell**
  (step 5 above) — a per-cell size always wins over the global.

Resolution order, from strongest to weakest: a cell's own custom size → this global symbol
size → the game's built-in coded size. A project that never touches this panel ships no
global size and renders byte-identical to before.

### Highlight (win frame)

Above the grid is a dedicated **Highlight (win frame)** section. The highlight is a
single, **global** spine (not per-symbol, not per-state) that loops over the winning
symbols during a win — the win-frame animation. Every game ships a built-in default:
the local `payframe` animation (spine key `anticipation`), which lives in the game's own
repo, NOT in R2, so the tool can't preview it. It is shown as a clear **Default
(payframe)** placeholder with an explanatory note.

- **Change** opens an inline editor: pick a **Spine bundle** from the project's (and
  shared) R2 bundles — the same library the grid's spine cells use — then pick an
  **Animation** (or type the name; blank plays the bundle's first animation). A live
  **Preview** plays the chosen animation.
- **Apply highlight** records the override; the section then shows the override preview
  and an **overridden** badge.
- **Reset to default** removes the override, returning to the built-in `payframe`.

The override is a single optional top-level field on the doc:
`highlight: { type: 'spine', assetKey: <full R2 bundle prefix>, animationName }`. When no
override is set, nothing is written and the game keeps its built-in `payframe` — so a
project that never touches this section is byte-identical to before. On export/bake the
chosen spine bundle travels the same chain as a per-symbol spine cell (its bundle is
copied into `deploy/editor-symbols/` and registered), and the bundle records the
highlight pointer so the game loads the authored win frame by `assetKey`.

### Win lines

Below the highlight is the **Win lines** section: a single **global** on/off toggle plus
the style of the in-game winning-payline overlay — the line traced across each winning
payline, with the win amount stamped under its end. It is pure config (no asset, no
preview). The toggle is **On by default**; flip it off to hide the overlay for the whole
project. When it's on, two groups of controls appear:

- **Line** — **Colour**; **Thickness** (a fraction of the symbol size); **Glow** on/off
  and its **Glow colour**; **Animated draw** on/off (the line draws from the first paying
  tile to the last, *then* the amount appears) and its **Speed** (a draw-speed multiplier;
  disabled unless Animated is on).
- **Win amount text** — **Font** (chosen from the project's bitmap fonts — the engine
  builtins `gold`/`goldblur`/`silver`/`purple` plus any Font-Maker fonts); **Size** (a
  fraction of the symbol size); **Colour**. Because the amount is bitmap text, the colour
  *tints* it — clean on a light font, but tinting an already-coloured font (e.g. gold) just
  darkens it, so to recolour cleanly pick a differently-coloured font.

A **Reset win-line style** button clears the style back to the game's coded defaults while
leaving the on/off state alone.

Every field is optional and **sparse**: only the on/off (when off) and the fields you
actually change are written, under `winLine: { enabled?, line?, text? }` on the doc.
Colours are CSS hex strings; `width`/`size` are multiples of the symbol size; `speed`
scales the animated-draw duration. The game applies its coded defaults for every field the
bundle omits, so a project that never opens this section is byte-identical to before and
the overlay stays on with its default gold line. On export/bake the config is passed
straight through to `bundle.symbols.winLine` (omitted when untouched) — there is no asset
work; the chosen text font travels via the normal font pipeline.

The renderer is per-game: Book of Borut's `WinLine.svelte` consumes this config (via
`bakedWinLineConfig()`). The engine reference `apps/lines` uses a symbol-glow win model and
has no win line, so the config has no effect there.

### Saving is not the last step — shipping a rebind

Save only persists the override doc to R2. For a rebind to actually reach the running
game it must travel the standard live-assets chain, exactly like editor art and fonts:

- **Export** — the bound assets are mirrored into the project's `deploy/editor-symbols/`
  subtree: sprite cells export the frame's sheet (TexturePacker JSON + page); spine cells
  copy the bundle's atlas + skeleton(s) + page(s) verbatim so the relative names still
  resolve. An `index.json` records what was exported. Triggered by
  `POST /api/editor/export-symbols` (deploy-token gated), which `bake-editor-doc.mjs`
  calls alongside the other exports.
- **Bake** — the baked bundle gains a `symbols: { map, index }` field (the authored
  overrides + the asset index), plus the optional globals `symbols.highlight`,
  `symbols.winLine`, and `symbols.defaultSizeRatios` (each omitted when unset — `winLine` is
  written only as `{ enabled: false }`).
- **Pull** — `pull-project-assets.mjs` mirrors `deploy/editor-symbols/` into the game's
  `static/assets/` (build order: `bake:doc` runs **before** `pull:assets`).
- **Register** — the engine's `bakedSymbolMap()` merges your overrides over the coded
  `SYMBOL_INFO_MAP`, and `bakedSymbolAssets()` registers any new sprite sheet / image /
  spine bundle the overrides introduce. Un-baked repos render byte-identical to today.

So a complete rebind is: edit in the tool → **Save** → a tokened game build (export →
bake → pull → register) → republish.

## Known limitations / TODOs

- **S5 (prove end-to-end) is still pending.** S1–S4 (engine contract, doc schema +
  endpoints, the tool page, and the export/bake/pull chain) have landed, but the full
  round-trip has not yet been proven on Book of Borut. That requires (1) mirroring the S1
  engine contract (`symbolMap.ts` / `getSymbolInfo`) into Book of Borut's own `src/game/*`,
  (2) keeping its symbol frame names unique across bound sheets (the bake step warns on
  collisions), (3) verifying the shared-spine fallback, and (4) actually rebinding a symbol
  online, rebuilding, republishing, and confirming the new asset/animation appears in-game.
- **Preview endpoints are still `editor`-gated.** The sprite/spine preview endpoints
  (`/api/editor/regions`, `/api/editor/spine`) are gated on the `editor` tool, so a user
  who holds **only** the `symbols` tool will get a 403 on previews. The default roles
  (`admin`, `developer`, `artist`) hold both, so this only bites a narrowly-scoped role.
- **Default-art cells render as placeholder chips until project assets are seeded.** The
  tool previews **only** from R2 (sprites under the project's `sheets/`/`manifests/`,
  spines under `spines/`). A game's base symbol art lives in its repo, not those prefixes,
  so until the art is synced into R2 a sprite default shows a labelled placeholder instead
  of a thumbnail. Spine **default** cells also stay chips, because the coded map's short
  keys (e.g. `H1`) aren't real R2 bundle prefixes — only a **rebind** (which stores the
  full bundle prefix) gets a live spine preview.
- **Bindings only.** v1 edits asset bindings within the fixed symbol set and six states.
  Payline geometry, adding/removing symbols or states, and creating/editing spine
  animations are all out of scope (the tool only references existing animations).
- **Existing standalone games must build once to publish their symbols.** A game that
  predates this tool needs the S1 contract mirrored into its own source plus one tokened
  build (or a manual `publish:symbols` run) before the grid shows its real symbols;
  otherwise it falls back to the coded `lines` set. New games get this from the scaffolder
  automatically.
