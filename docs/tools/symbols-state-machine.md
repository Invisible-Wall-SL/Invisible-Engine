# Invisible Symbols State Machine

The editable twin of the in-game **Symbol Debug** grid: for each symbol, in each
animation state, rebind the cell to a sprite frame, a spine animation, or an Invisible
Flipbook clip that already lives in R2 — then ship those bindings to the game through the
standard deploy chain.

## What it is

A grid editor for a game's `symbol × state → asset` map. Every game hardcodes a
`SYMBOL_INFO_MAP` — a binding for each symbol (e.g. `H1…H5`, `L1…L5`, `W`, `S`) in each
of six animation **states** (`Static`, `Spin`, `Land`, `Win`, `Post-win`, `Explosion`).
This tool turns that map into an editable surface: each cell is a **sprite** (a sheet
frame), a **spine** (a bundle + animation name), or a **flipbook** (an Invisible Flipbook
clip — an ordered, timed run of atlas frames). Edits are stored as a **sparse override
doc** in R2 — only the cells you change are recorded; everything else falls through to the
game's coded default.

A `sprite` cell is ONE frozen frame, so Spine used to be the only way to animate a
Spin/Land/Win state. A flipbook clip is far cheaper than a skeleton, and is the fallback
for the Tier-C spine-particle perf ceiling tracked in `docs/status/fx.md`.

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

The published set is **filtered to the symbols the game actually uses** — the publish step
reads the game config (`src/game/config.ts` → its `symbols` map, the authoritative in-play
set) and drops any symbol present in `SYMBOL_INFO_MAP` but not in the config (e.g. an unused
`H5`), so the grid mirrors the built game rather than every symbol the engine *can* render.
A project that published before this filter existed keeps its old full set until it
**republishes** (any tokened build re-runs `publish:symbols`).

## How to use it

You always work in the context of the **active client/project** (shown top-left, with the
tool top bar). Switch projects from the launcher before opening the tool.

1. **Read the grid.** Rows are the game's symbols; the six columns are the states
   (`Static`, `Spin`, `Land`, `Win`, `Post-win`, `Explosion`). Each cell shows its
   **effective binding** — your override if you've made one, otherwise the game's coded
   default. Sprite cells render a frame thumbnail; spine cells render a live animation
   on the shared spine canvas (a chip labels the bundle + animation); flipbook cells render
   the clip's **first frame** as a still, captioned with the clip name + frame count. A cell
   with no binding shows `unset`.

   Flipbook cells are deliberately *not* animated in the grid: N per-cell tickers would cost
   far more than the one shared spine canvas, and the question the grid answers is "which
   clip is bound here", which the first frame plus the clip name answers. If a clip is
   deleted in `/flipbook` after being bound here, the cell's caption reads
   `<clipId> (missing)` rather than going quietly blank.
2. **Spot your edits.** A cell you've overridden gets a blue border and an **edited**
   badge. A small **↺** button in its corner **resets that cell to the coded default**
   (removing the override). The whole grid scrolls vertically; cells resize with the
   window.
3. **Open the cell editor.** Click any cell to open the side panel for that
   `symbol · state`. The panel loads a draft of the cell's current binding.
4. **Choose the type.** Toggle between **Sprite**, **Spine**, and **Flipbook**. Switching
   type clears the asset binding *and* every field that no longer applies (the animation
   name when you leave Spine, the clip when you leave Flipbook), since a frame name is not
   a spine bundle is not a clip.
   - **Sprite:** use the **Frame** picker (the same `RegionPicker` the editor uses) to
     choose a frame from any of the project's atlases/sheets.
   - **Spine:** pick a **Spine bundle** from the project's (and shared) bundles, then pick
     an **Animation**. Once the bundle loads, the animation list is populated from the
     skeleton; if it hasn't loaded yet you can type the animation name. Leaving it blank
     plays the skeleton's first animation. A live **Preview** plays the chosen animation.
   - **Flipbook:** pick a **Clip** from the project's Invisible Flipbook clips (each
     listed with its frame count). Picking a clip sets the cell's `clipId` *and* its
     `assetKey` to the clip's primary sheet, so the cell is never assetless. The panel
     shows the clip's **first frame** as a still — it is not a player; scrub playback
     lives in [Invisible Flipbook](/docs/flipbook), which owns the clip.
     If the project has **no clips yet**, the Flipbook button is disabled with a pointer
     at `/flipbook` rather than an empty dropdown.
5. **Apply.** **Apply** writes the draft into the working doc as an override (it requires
   an asset to be chosen). The cell updates immediately and is marked **edited**. The
   panel also has a **Reset to default** action for an overridden cell.
6. **Save.** The header **Save** button is enabled whenever the doc differs from what's
   on disk (dirty tracking). Saving `PUT`s the doc to R2 (`PUT /api/editor/symbols`),
   stamps it, and shows **Saved**. Save errors surface inline next to the button.
7. **Reload from R2.** The header **↻ Reload from R2** button re-fetches the spine bundles
   and their previews from R2. Use it after you re-export or replace a spine bundle (e.g.
   re-rigging in the Invisible Rigger) — otherwise the grid + pickers keep showing the
   *cached* skeleton, because spine art is loaded once per bundle and the skeleton/page
   files are HTTP-cached. Reloading drops those caches (previews refresh with the new art +
   animation names) and re-reads the project's bundle list (a brand-new bundle appears in
   the spine pickers). Your unsaved cell edits are preserved.

### Symbol size lives on the reel, not here

This tool no longer sets symbol size — size is a *layout* concern. To change how big the
symbol art renders inside each reel cell, open the **Invisible Scene Editor** (`/editor`),
select the reel, and use the **"Symbol size (× cell)"** Width/Height control on the reel's
properties (see [the Scene Editor guide](./invisible-editor.md#symbol-size-on-the-reel)).
That value (`reelGrid.symbolSizeRatios`, `1` = the art fills one cell) applies to every
symbol on the board; absent ⇒ the game's built-in per-symbol sizes.

A baked per-cell `sizeRatios` from before this change is still honoured by the engine (it
wins over the reel value), but the tool no longer authors size at any level.

### Highlight (win frame)

Above the grid is a dedicated **Highlight (win frame)** section. The highlight is a
single, **global** spine (not per-symbol, not per-state) that loops over the winning
symbols during a win — the win-frame animation. Every game ships a built-in default:
the local `payframe` animation (spine key `anticipation`), which lives in the game's own
repo, NOT in R2. The launcher vendors its own copy (`static/builtin/spines/`), so the
default still **previews live** and is labelled **Default (payframe)**. A project that
carries its own matching R2 bundle previews that one instead.

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

### Free-spin board glow

Below the highlight is the **Free-spin board glow** section. The board glow is the
single, **global** spine that lights up *behind the reels* for the duration of a
free-spin session — the pink "reelhouse" backdrop in a stock game. Like the highlight, the
built-in default (spine key `reelhouse`) lives in the game's own repo, NOT in R2 — and like
the highlight it **previews live** from the launcher's vendored copy
(`static/builtin/spines/`), labelled **Default (reelhouse)**. A project carrying its own
matching R2 bundle previews that one instead.

- **Change** opens an inline editor: pick a **Spine bundle** from the project's (and
  shared) R2 bundles — **including a rig exported from the Invisible Rigger**, which ships
  correctly here because the exporter renames a `.irig` skeleton to `.json` on the way out.
- The glow plays a three-step chain — **Start animation → Idle (loop) → Exit animation**.
  Each is optional: leave one blank and it keeps its coded `reelhouse_glow_*` name, so a rig
  that only renames its loop needs one field. The **Preview** plays the idle animation.
- **Apply board glow** records the override; **Reset to default** removes it.

The override is one optional top-level field:
`boardGlow: { type: 'spine', assetKey, animations?: { start?, idle?, exit? }, sizeRatios? }`.
Nothing is written unless you set it, so an untouched project is byte-identical. The chosen
bundle travels the same export/bake chain as a per-symbol spine cell.

**What this section does and doesn't control.** It owns the glow's **art** — the engine
still owns the *sequence* (start → idle → exit) and the *timing*. Timing is authored in
**Invisible Flow** (`/flow-v2`): the coded free-spin handlers fire the glow on
`freeSpinTrigger` / `freeSpinEnd`, and a flow that OWNS those events drives it with the
`boardFrameGlowShow` / `boardFrameGlowHide` **Fire Cue** nodes. If you want to replace the
glow *entirely* — your own layered art, not one spine — use the **Board glow (free spins)**
screen in the Scene Editor instead; real content there suppresses the coded glow (and with
it this section's override).

### Win lines

Below the board glow is the **Win lines** section: a single **global** on/off toggle plus
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

The win-line renderer lives in the **shared engine** (ported 2026-07-14), so every
`runtime:lines` game — including the `apps/lines` reference — draws it from this config via
`bakedWinLineConfig()`. (Historically the renderer was per-game in Book of Borut only; that
is no longer the case.)

### Winning symbols after the spin

A separate section with its own on/off toggle (**on by default**) plus a **Gap between
passes** slider. With it on, once the round's whole book has been presented the game keeps
the winning symbols animating on the resting board — re-playing their Win state over and
over — and stops the instant the next bet starts. Without it the symbols freeze on their
post-win frame the moment the round ends.

**Symbols only.** The win line and its stamped amount are *not* redrawn: that pair is the
round's own per-win narration ("this line paid this much"), and repeating it at rest just
re-tells a story the player has read. That is also why this is its own section rather than a
win-line setting — turning the line off has no effect on it, and vice versa.

A free-spin feature replays its **last** spin's wins, and every winning cell of that spin
lights together on each pass (several wins routinely share a symbol). The replay is skipped
while autoplay or space-hold is running, since the next spin is already on its way.

Stored sparsely as `winCycle: { enabled?, delay? }` (only the OFF flag and an authored delay
persist; `delay` is in seconds), passed straight through to `bundle.symbols.winCycle` at
export/bake and resolved by the engine's `bakedWinCycleConfig()` (defaults: on, 0.4s). The
replay itself is `apps/lines/src/game/winSymbolCycle.ts`, so every `runtime:lines` game has
it.

### Saving is not the last step — shipping a rebind

Save only persists the override doc to R2. For a rebind to actually reach the running
game it must travel the standard live-assets chain, exactly like editor art and fonts:

- **Export** — the bound assets are mirrored into the project's `deploy/editor-symbols/`
  subtree: sprite cells export the frame's sheet (TexturePacker JSON + page); spine cells
  copy the bundle's atlas + skeleton(s) + page(s) verbatim so the relative names still
  resolve. **Flipbook cells are skipped here on purpose** — a clip's art ships through the
  Invisible Flipbook export path, which owns the clip's full ordered frame list; this
  exporter only sees the cell's primary-sheet `assetKey`. An `index.json` records what was
  exported. Triggered by
  `POST /api/editor/export-symbols` (deploy-token gated), which `bake-editor-doc.mjs`
  calls alongside the other exports.
- **Bake** — the baked bundle gains a `symbols: { map, index }` field (the authored
  overrides + the asset index), plus the optional globals `symbols.highlight` and
  `symbols.winLine` (each omitted when unset — `winLine` is written only as
  `{ enabled: false }`). Symbol size is not in this doc; it travels on the layout doc as
  `reelGrid.symbolSizeRatios` (Scene Editor).
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
