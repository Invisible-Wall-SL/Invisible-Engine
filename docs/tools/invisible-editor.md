# Invisible Scene Editor

Place images, spine, and text onto a game's screens and export a layout the
engine renders — the layout step between the asset tools (Sheet Maker, Atlas
Maker, Spine) and the running game.

## What it is

An in-launcher, full-page WebGL/canvas layout editor. You pick a screen, drag
assets out of the project's library onto a canvas, position/scale/rotate them
per device layout, and the result is saved as a `scenes.json` layout document in
the project's cloud storage. The engine reads that document at game boot and
renders it; animation and book-event logic stay in code on top of this static
layout.

The editor is **project-centric** — it always works on the project you currently
have selected in the launcher. It loads that project's saved layout, its asset
library (atlases, spines, sheets), its components, and (if one exists) the
template for the project's game type.

- **Where it runs:** the launcher itself, at `/editor` — a real page inside the
  authed `(app)` area, behind the auth + role gate. It is **not a redirect and
  not an iframe**; the canvas and all panels render directly in the launcher.
  (SSR is disabled for this route — the `load` still runs server-side to fetch
  the doc/assets, only the canvas component is client-only.)
- **Access:** the `editor` tool, granted by default to the `admin`, `developer`,
  and `artist` roles. The `animator` role does not get it. Like every tool it is
  overridable per role/user in the admin panel.

## How to use it

The page is a three-pane layout under a top bar:

- **Top bar** — the shared `ToolTopBar` (emblem → launcher home, tool name,
  online-tool switcher), the active project (`client/project`), a
  **layoutType** pill group (`desktop · tablet · landscape · portrait`),
  undo/redo (↶ ↷), scene/asset counters, and the save status pill.
- **Left pane** — the **Screens** list on top, then a tabbed panel that switches
  between **Library**, **Outline**, and (in advanced modes) **Template** /
  **Components**.
- **Centre pane** — the **canvas**: the authoring frame for the active screen,
  with the placed nodes drawn at their real textures.
- **Right pane** — the **Properties** panel for the current selection.

The two side panes are resizable (drag the dividers; widths persist per
project).

### 1. Pick or create a screen

The **Screens** list (top-left) is the set of screens in the layout. Game
screens are listed first; HUD screens are grouped under a **HUD** subheading and
always draw on top. For each screen you can:

- **Click** a row to make it the active screen (what the canvas edits).
- **Double-click** the name to rename it inline (Enter commits, Esc cancels).
- **Drag** the grip (⠿) to reorder — this changes layer order. Reordering is
  constrained within a group (game↔game, HUD↔HUD).
- Toggle the **eye** to show/hide a screen in the canvas, **duplicate** it, or
  **delete** it (✕, with confirm).

Each screen has a coordinate **space** select: `game` (the main game box),
`standard` (the HUD box, with optional vertical/horizontal alignment), `canvas`
(positioned against the window edges), or `background` (cover-fit, full-bleed).

To start from something:

- **＋ Load scenes…** (the dropdown above the list) offers **New game from
  kind** (a fresh engine-piece scaffold per game kind — `lines`, `ways`,
  `cluster`, `scatter`, `bookOf`, plus any author-created custom kinds) and
  **Import composed reference** (open a reference game already laid out). Pick
  one and click **Load**. Loading a layout whose game type differs from the
  project's is flagged as a cross-type preview and will not autosave — you must
  Save (which converts the project) or Discard.
- **＋ New empty screen**, **＋ New background screen**, **＋ Add / Refresh HUD
  layer**, and **＋ New HUD screen** create screens directly.
- **＋ Add missing screens** appears when the game defines screens the current
  layout lacks.

### 2. Place assets from the Library

Open the **Library** tab. It is grouped into:

- **Elements** — drag in a **Text** node or a **Rect** fill, or click
  **Reel** to insert the board/reel-grid placeholder (one per game; the item
  highlights and re-selects the existing reel if you already have one).
- **Atlases** — composed atlas pages and atlas manifests. Manifest entries
  expand to their individual regions, which you drag in one at a time.
- **Spines** — the project's spine bundles (plus shared `_shared/` bundles,
  badged "shared"). There is an **Upload spines** action to sync a folder of
  Spine bundles into the project's storage.
- **Sheets** — sheet outputs; expand to drag individual regions.

**Drag any library item onto the canvas** to spawn a node in the active screen.
The editor renders the real texture (and spine bundles preview as a live
skeleton), so what you see matches what the game will draw.

### 3. Position, scale, rotate

Select a node by clicking it on the canvas (Shift-click toggles it into a
multi-selection; drag a member to move the whole group). With a single node
selected you get transform handles for **move / scale / rotate**, and dragging
snaps to other nodes' edges/centres (snap guides show as lines). The canvas
itself supports **zoom** (mouse wheel, cursor-anchored) and **pan**
(Shift / middle / right-drag), with a **Fit** action.

Other editing affordances:

- **Undo / redo** — `Ctrl/⌘+Z` / `Shift+Z` (or the ↶ ↷ buttons). Covers every
  edit, including screen-panel operations; rapid edits coalesce into one step.
- **Copy / cut / paste / duplicate** — `Ctrl/⌘+C / X / V / D`. Paste drops into
  the active screen, so it also moves nodes between screens. Clones get fresh
  ids and a small nudge.
- **Delete** removes the whole selection in one step.

### 4. Edit properties

The right-hand **Properties** panel edits the selected node — its transform
(`x/y`, anchor, scale, rotation, alpha, zIndex, tint), text content/style for
text nodes, spine animation/skin for spine nodes (driven by dropdowns when the
canvas can read the bundle's animations), background cover/fit for cover
sprites, and the slot the node fills (when a template is loaded). It also offers
node actions such as **Convert to reel grid**, **Convert to parametric button**,
and **Edit as component** (materialise a container into the Component Editor).

#### Symbol size on the reel

When the **reel grid** node is selected, its Properties panel includes a **"Symbol
size (× cell)"** Width/Height control. This sets how big the symbol art renders
*inside* each reel cell, as a fraction of one cell — `1` fills the cell, `0.9`
insets it slightly. It applies to **every** symbol on the board, and a **Reset**
button clears it so the game falls back to its built-in per-symbol sizes.

This is the one place symbol size is authored. (It used to live in the Invisible
Symbols State Machine, but size is a layout concern, so it moved here to the reel.)
It is stored as `reelGrid.symbolSizeRatios` on the layout doc and travels to the
game on the normal scene bake — no separate asset step. Resizing the reel cell
itself (`cellSize`) scales the grid *and* the symbols together; this control
changes only the symbol's size *within* its cell.

### 5. Author across device layouts

The **layoutType** pills (`desktop · tablet · landscape · portrait`) switch which
device layout you are authoring. `desktop` is the base; switching to another
layout and editing writes a **per-layoutType override** on top of the base, so
each device can have its own placement without duplicating the whole layout.

### 6. Save and reach the game

Editing autosaves on a short debounce — the status pill in the top bar shows
**Saving… / Saved Ns ago / Unsaved changes / Save failed** (with a manual
**Save** / **Retry** button). The layout is written to the project's cloud
storage at `editor/<client>/<project>/scenes.json`.

If a template is loaded for the project's game type, the editor also surfaces
**slot warnings** (required slots with no node filling them) and **asset
issues** (nodes referencing assets the game can't load — they'd render blank;
click an issue to jump to the offending node). Slot warnings never block a save.

**Reaching the running game** is a build-time chain, not an in-tool export
button. At game boot the engine fetches its saved doc from the launcher
(`GET /api/editor/doc?project=&k=`, gated by the launcher's `EDITOR_DOC_SECRET`),
falling back to the game's checked-in `editor-scenes.ts` fixture when the
endpoint isn't reachable or no doc exists. The engine renders the doc via
`<LayoutScene>`; existing coded/animated components (e.g. `Win`, `Transition`)
keep mounting at their layout positions through the engine's bound-component
registry. As with every R2 asset class, anything the layout references must also
travel the export → deploy → bake → pull chain to ship inside the game bundle.

### Advanced modes (optional)

- **Components** — the left **Components** tab lists reusable prefabs (overlays,
  UI groups, scenery), grouped by category. **Place** one to drop a component
  instance into the active screen; instances' params are editable in Properties.
  Authoring components themselves now lives in the separate **Invisible
  Component Editor** (`/components`), which the panel links out to.
- **Template editor** — a separate, advanced mode (top-bar toggle) for defining
  a game type's slot schema: tag nodes with a `slotId`, choose the game type,
  and **Save template** to write `editor/templates/<gameType>.json`. Not needed
  to lay out scenes; it defines the slots that scene authors then fill.
- **Save as new game kind…** — saves the current screens + engine pieces (minus
  artist art) as a new reusable kind that appears under "New game from kind".

## Known limitations / TODOs

- **New / reordered screens don't yet drive the shipped game.** The reference
  games mount scenes by hardcoded id in a fixed code order, so a brand-new
  empty/HUD screen, or a screen reorder, changes the **editor preview** but does
  not yet render in the built game — only `background`-space scenes render
  generically today. Wiring the runtime to render doc scenes generically by doc
  order is the next engine step.
- **Animated / book-event-driven content stays coded.** The editor owns static
  scenery, frames, labels, and intro/outro spine poses. Symbols, win-line draws,
  count-ups, and anything derived from runtime state mount via the engine's
  `mount`/`bind` escape hatch — the editor only places their anchor. (The design
  intent is to drive that hatch to zero over time, but it is the current
  boundary.)
- **No in-editor book-event playback or timeline.** Verify animated behaviour by
  running the live game, not in the editor.
- **`EDITOR_DOC_SECRET` must be set on the launcher** for the live-doc fetch to
  serve; when unset the endpoint refuses and games fall back to the checked-in
  `editor-scenes.ts` fixture.
- **Engine submodule bump required for shipped games.** Book of Borut and other
  shipped games vendor the engine as a git submodule, so editor/engine parity
  fixes only reach them after the submodule is bumped and the game rebuilt.
- **Some HUD parity gaps remain.** Rotation now ships for HUD elements, but the
  corner logo/game-name containers still ignore `scale` in-game, so scaling those
  two corner texts in the editor won't ship yet.
- **Interactive feel is partly unverified.** Several recent editor capabilities
  (undo/redo, copy/paste, multi-select) build clean and type-check, but the
  auth-gated canvas makes automated interaction testing hard — owner confirms
  live.
