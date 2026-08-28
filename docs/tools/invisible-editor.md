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
  `artist` and `pipelineTester` roles. The `animator` role does not get it. Like every tool it is
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

### Layer order and "Always on top"

A screen's position in the Screens list **is** its layer order in the game —
higher in the list draws further back, lower draws in front. Drag the grip to
re-stack it; there is no separate layer number to keep in sync.

The list orders screens **above the reels**. The reel board is engine-owned and is
not itself a screen, so dragging a screen above the **Base game** row does _not_
put it behind the reels — for that, tick **Behind the reels** in Properties. That
mounts the screen under the board and in front of the background; screens behind
the reels still order against each other by their list position.

Properties also carries an **Always on top** tick. Leave it off (the default) and
the screen layers by its list position — the readout under the tick tells you
which layer it currently is. Turn it on and the screen is **pinned above every
other screen**, so its list position stops mattering; rows pinned this way show a
`TOP` badge in the Screens list. Use it for something transient that must never
be buried — a loading splash, a big-win celebration — and leave it off for
anything persistent you want to stack normally (a progress bar, an overlay).
Round-blocking engine gates always draw above both. A screen ticked **Behind the
reels** shows an `UNDER` badge instead; the two ticks are mutually exclusive.

Bottom to top, the game draws: background screens → the coded background →
**Behind the reels** screens → the reel board → the Screens list → **Always on
top** screens → engine gates.

### Zoom with anticipation

A game-space screen's Properties also carries a **Zoom with anticipation** tick.
Leave it off (the default) and the screen is static. Turn it on and the screen
**zooms and pans in lockstep with the reels** during a reel-anticipation tease —
it scales toward the same reel centre as the board, one coherent camera move
rather than an independent zoom. Use it for a "base game top / bottom" layer you
want to travel with the reels as the anticipation escalates. It only applies to
game-space screens (they share the board's coordinate space), and it does nothing
until reel-anticipation is authored on and firing, so a ticked screen still
renders unchanged the rest of the time.

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
  badged "shared" — see [the shared spine library](#the-shared-spine-library)).
  There is an **Upload spines** action to sync a folder of
  Spine bundles into the project's storage.
- **Sheets** — sheet outputs; expand to drag individual regions.
- **Effects** — the project's authored **Invisible FX** particle effects; drag
  one in to place it at a position in the scene. The editor renders the effect's
  **live particles** right on the canvas (an overlay, the same way it shows spine
  rigs live), following pan/zoom — toggle it with the **▶/❚❚ FX** button in the
  toolbar. A ✨ placeholder chip still marks nodes that aren't rendering live yet
  (still loading, or a bone-attached effect). Change which effect a placed node
  references from the Properties panel. There you can also **attach the effect to
  a rig**: pick a placed Spine node from the "attach to rig" dropdown and the
  effect rides that rig — a _bone_-placed layer (set in Invisible FX) follows the
  rig's bone, and the rig's timeline events (authored in the Rigger) fire the
  effect on the beat. Left as **free**, the effect just plays at its placed
  position. The effect's particle atlas ships automatically (the export bakes it
  in) — no need to place the atlas separately.
- **Flipbooks** — the project's authored **Invisible Flipbook** clips (frame
  animations packed off an atlas sheet), each row showing its first frame and its
  frame count. Drag one in to place it. The canvas **plays it in place**, at its
  real position and size, so you can time it against the rest of the screen — no
  toggle and no overlay, because a clip is just atlas frames in order. A 🎞
  placeholder chip marks a clip that no longer exists (see below).
  In the Properties panel you can re-target the **clip**, set an explicit
  **width/height** (blank = the frames' native size), and override **fps**, **loop**,
  **direction** (forward / reverse / ping-pong) and **mirror X/Y** for _this placement
  only_ — leave them blank to play the clip exactly as authored in
  [Invisible Flipbook](flipbook.md). Re-authoring a clip there updates every placement;
  the layout only stores the clip's id and these overrides. One wave clip placed twice,
  mirrored and reversed on the second, beats two near-identical clips to keep in sync.
  The canvas previews the placement's own direction and mirroring, not just the clip's.
  The clip's sheet ships automatically — no need to place the atlas separately.

  On a `background` screen — or with **Fill → Cover / full-screen fill** ticked on a
  `canvas` screen — a clip fills the window edge-to-edge instead of drawing at its
  placed size, exactly like a background image does. It then stops being draggable
  and resizable: tune it with **cover scale** / **fit** in the Background section and
  **scale.x** / **scale.y** in Transform. The fill is measured from the clip's **bounds
  box** when it declares one, else from its **first frame**, so frames of different sizes
  don't make the backdrop breathe.

  > The canvas previews **every** clip looping, so you can always see the
  > animation. A _play once_ clip still stops on its last frame in the game.

  > If a clip is deleted or renamed in Invisible Flipbook after being placed, the
  > node keeps its position but the game renders **nothing** for it (deliberately —
  > there is no fallback art, because a wrong animation is worse than none). The
  > editor calls it out in two places: the node draws a 🎞 chip, and it is counted
  > in the header's **asset issues** pill.

### The shared spine library

Bundles badged **shared** come from `_shared/spines/` — a cross-project library any
project can place from without owning it, the spine twin of `_shared/sheets/`. It
resolves **project-first**: a project bundle of the same name shadows the shared one, so
the library can never override work a project owns. Shared bundles travel the export →
`deploy/` → bake → pull chain exactly like project ones.

It is seeded with the engine's own set — the animation `apps/lines` ships — so a new
project has something to place before it has commissioned anything:

| Bundle | Animations |
| --- | --- |
| `engine-loader` | `title_screen` |
| `engine-transition` | `animation` |
| `engine-bigwin` | `big_win` / `super_win` / `mega_win` / `epic_win` / `max_win`, each `_intro` `_idle` `_exit` |
| `engine-anticipation` | `anticipation[1-4]_intro` `_loop` `_out`, plus `payframe` (the win frame) |
| `engine-reelhouse-glow` | `reelhouse_glow_start` `_idle` `_exit` |
| `engine-foreground` · `engine-foreground-feature` | `idle`, `dust` |
| `engine-buy-button` | `buy_button_default` `_hover` `_click` `_disabled`, `_active_intro` `_idle` `_exit` |
| `engine-fs-screen` · `engine-fs-screen-number` · `engine-fs-total-number` | `intro`, `idle` |
| `engine-global-multiplier` | `static`, `increment`, `win`, `reset` |
| `engine-cluster-pay` | `win`, `multiwin` |
| `engine-tumble-win` · `engine-tumble-multiplier` | `explosion`, `idle` / `static`, `explosion_mobile` |
| `engine-win-meter-explosion` | `explosion` |
| `engine-symbol-h1`…`h5`, `engine-symbol-l1`…`l4` | `<id>`, `<id>_static` |
| `engine-symbol-m` | the multiplier set (`2x`…`10x` × `_land` `_static`, `low`/`mid`/`high_multiplier_*`) |
| `engine-symbol-s` | `scatter_static` `_spin` `_land` `_win` |
| `engine-symbol-w` | `wild_dynamite` `_static` `_land` `_exploded_static` |
| `engine-explosion` | `explosion` — the Symbols tool's Explosion default ([why](symbols-state-machine.md#the-shared-spine-library)) |

**One bundle per skeleton, by design.** Upstream packs several skeletons behind one
shared atlas (`symbols/` holds h1…l4). The editor addresses a bundle by FOLDER plus an
animation name — there is no skeleton selector, and the resolver takes the folder's first
`skeletons.json` entry — so a folder shipped whole would publish nine skeletons of which
only `h1` could ever resolve. They are split so every animation is actually placeable.
The cost is that a split family re-copies its atlas page per skeleton; the editor's export
dedups identical pages content-addressed, so placing several costs one page, but the
Symbols export does not (see the note in its guide).

The library is **read-only from the tools** — it is curated out-of-band by
`apps/launcher-api/scripts/seed-shared-engine-spines.mjs`, plus the admin panel's
"bring a spine into the shared library" promote for the engine boot mark. To make one your
own, place it, then re-author it in the [Rigger](/docs/rigger) under your project.

**Drag any library item onto the canvas** to spawn a node in the active screen.
The editor renders the real texture (and spine bundles preview as a live
skeleton), so what you see matches what the game will draw.

The **reel board** previews the real symbols too: each cell shows a symbol's
**Static** binding from the Invisible Symbols State Machine, cycled across the
grid so the board looks populated. Sprite and spine symbols both draw — a spine
symbol plays its Static animation, sized into the cell exactly as the game sizes
it. A cell falls back to an amber marker only while its art is still loading, or
when the binding names art this project can't resolve.

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

#### Art bounds — the box a sprite is sized by

Select a **sprite** node and the Properties panel shows an **Art bounds** section: a
small preview of the region with a draggable box over it. This is the sprite twin of the
Rigger's **Bounds** and of an Invisible Flipbook clip's box — it declares *the space this
piece of art occupies*, and everything that draws the region sizes, anchors and
cover-fits by that box instead of by whatever rectangle the packer produced.

- **⊙ Fit** boxes the region's art, **⌖ Centre** re-centres it, **✕ Clear** removes it.
  Drag the box or type exact **x / y / w / h** — `x`/`y` are the box's top-left relative
  to the region's **origin** (its centre), so a centred box has `x = -w/2`.
- **A box smaller than the art is deliberate.** The art is not cropped to it; it
  overflows. That is how you size a symbol by the part that reads and let a glow or a
  burst hang outside the reel cell — the sprite answer to a spine rig whose canvas
  covers invisible effects.

> **It edits the ART, not this placement.** The box is stored per
> `<assetKey>::<region>` and applies **everywhere that region is drawn** — other
> screens, other scenes, the reel, other tools. It is saved immediately (it is not part
> of the layout doc, so the page's Save doesn't cover it), and it reaches the game with
> the next **art export** — the exporter writes it into the sheet the game loads, so
> there is no extra publish step and nothing new to register.

#### Symbol size on the reel

When the **reel grid** node is selected, its Properties panel includes a **"Symbol
size (× cell)"** Width/Height control. This sets how big the symbol art renders
_inside_ each reel cell, as a fraction of one cell — `1` fills the cell, `0.9`
insets it slightly. It applies to **every** symbol on the board, and a **Reset**
button clears it so the game falls back to its built-in per-symbol sizes.

This is the one place symbol size is authored. (It used to live in the Invisible
Symbols State Machine, but size is a layout concern, so it moved here to the reel.)
It is stored as `reelGrid.symbolSizeRatios` on the layout doc and travels to the
game on the normal scene bake — no separate asset step. Resizing the reel cell
itself (`cellSize`) scales the grid _and_ the symbols together; this control
changes only the symbol's size _within_ its cell.

#### Perspective (advanced)

With the **reel grid** node selected, a **"Perspective (advanced)"** section sits
below "Anticipation (advanced)". It lays the board out on a converging ground
plane instead of a flat rectangle: cells further back draw smaller and sit closer
together, so ordinary upright artwork reads as standing on ground.

- **Far scale** — the back row's size relative to the front row. `0.6` draws the
  furthest row at 60%. Blank or `1` means a flat board, byte-identical to before,
  which is the off state. Values above `1` are legal and invert the depth.
- **Vanishing point x** — the board-local x the columns converge toward, in the
  game's board units. Blank means the lattice centre, which makes a symmetric
  board converge symmetrically; set it to match painted ground art whose
  vanishing point sits off-centre.
  This section is the board's **shape only**. Whether a round rolls or **swaps
  symbols in place**, which swap style it uses, and how long each column waits
  before it falls are set in **Game Config → Reel behaviour**, not here — they are
  one fact about the game, while a reel grid node is authored per aspect ratio, and
  a board that rolled in portrait but swapped in landscape is not a configuration
  anyone wants. The two remain independent of each other: a converging board may
  still roll, and a flat board may swap.

The preview mirrors the game exactly. Both the 2D canvas and the spine layer read
one shared geometry, so a sprite symbol and a spine symbol land on the same seat;
an offline fixture asserts the editor's seats equal the game's across every grid
shape. Every existing knob keeps working — reel/row padding, gaps, non-square
cells, per-cell alignment and per-ratio overrides all still mean what they mean,
and shrink with their row.

Nothing is written to the layout doc until you set a field, so an untouched board
is unchanged.

#### Ground tiles

The reel grid can also stamp a **tile** image once per cell, drawn from the same
lattice that seats the symbols — so the tiles and the symbols can never drift out
of alignment, and they re-fit per aspect ratio for free. Prefer this to ground art
with the grid painted into it, which has to be hand-matched to pixels and drifts
the moment a per-ratio override moves the board.

Tiles paint behind every symbol, scale with their row under perspective, and dim
with the win highlight — the paying cells' tiles stay bright while the rest darken,
in lockstep with the symbols above them.

### 5. Author across device layouts

The **layoutType** pills (`desktop · tablet · landscape · portrait`) switch which
device layout you are authoring. `desktop` is the base; switching to another
layout and editing writes a **per-layoutType override** on top of the base, so
each device can have its own placement without duplicating the whole layout.

#### Canvas size (the MAIN box)

The right-hand panel has a **Canvas Size** section with **Width** / **Height**
inputs for the currently selected layoutType. This is the game's **MAIN box** —
the box the running game scales to fill the window. Author your nodes against it
so what you place lines up with what ships. A new project seeds this box from its
game type's reference (e.g. a `bookOf` project starts at `1422×800` desktop), not
a generic default.

If the box drifts from the game type's reference (common for older projects
created before the seed), an amber **"Canvas W×H doesn't match the … game box
W×H"** warning appears with a **Match game box** button that snaps every
layoutType's box back to the reference in one click. Editing the box (or clicking
Match) goes through the normal autosave + undo path.

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

### Game Settings → Boot splash

The right panel's **Game Settings** section carries this game's own boot splash —
the second pre-game screen, shown after the engine mark (which is set once for
the whole pipeline in Admin → Settings and is not editable here). It replaced the
"Add Your Loader" placeholder.

Pick a **Spine** from the project's spine library (shared bundles are offered too,
marked `(shared)`), an **Animation**, a **Background**, and a **Size**.
`— none —` skips the game splash so boot goes straight from the engine mark into
the game.

**Size** multiplies the automatic fit rather than setting an absolute size —
`1.00×` is the mark scaled to sit inside a safe box, so the same value holds on
every screen the game runs on. Above about `1.6×` it can run past the viewport.

Set the animation explicitly unless the skeleton's _first_ clip is the right one:
a spine left on its resting/setup pose renders **empty**, which looks like a
broken splash rather than an unset one.

The splash ships through the project's `deploy/_boot/` tree, so it reaches the
game on the next **Publish** — the same trip as the rest of your art.

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
