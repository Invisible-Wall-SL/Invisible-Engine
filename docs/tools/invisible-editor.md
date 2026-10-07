# Invisible Scene Editor

Place images, rig, and text onto a game's screens and export a layout the
engine renders — the layout step between the asset tools (Sheet Maker, Atlas
Maker, rig) and the running game.

## What it is

An in-launcher, full-page WebGL/canvas layout editor. You pick a screen, drag
assets out of the project's library onto a canvas, position/scale/rotate them
per device layout, and the result is saved as a `scenes.json` layout document in
the project's cloud storage. The engine reads that document at game boot and
renders it; animation and book-event logic stay in code on top of this static
layout.

The editor is **project-centric** — it always works on the project you currently
have selected in the launcher. It loads that project's saved layout, its asset
library (atlases, rigs, sheets), its components, and (if one exists) the
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
  online-tool switcher) with the scene/asset counters, and below it an action row
  with the save status pill, **Save**, **History…**, slot/asset warnings and the
  Template-editor toggle.
- **Left pane** — the **Screens** list. The active screen expands in place to its
  outline (the node tree, plus template slots when a template is loaded).
- **Centre pane** — the **canvas**: the authoring frame for the active screen,
  with the placed nodes drawn at their real textures. Its top row carries the
  device-layout pills (`desktop · tablet · landscape · portrait` by default),
  undo/redo (↶ ↷) and the canvas actions.
- **Right pane** — tabbed **Properties | Library** (plus **Template** in the
  Template editor). Properties edits the current selection, the screen, the Canvas
  Size and Game Settings; Library holds the elements, the art/rig/sheet library
  and the Components section.

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

**🎮 In-game view** (canvas toolbar, on by default) makes the canvas draw what the idle game
shows: the background, the base game, the HUD and any always-on screen (a Hold and Win
project's Jackpot bar and Pots), plus the screen you are editing. Menus, takeovers (buy
feature, buy confirm, bet menu, auto spin), the loading screen, free-spin and Hold and Win
feature screens, and screens gated by a visibility source stay off the canvas until you
click them in the list. Their names show in italics. Selecting a feature screen also draws
the rest of that feature, without its intro, outro, wheel or jackpot popups. In-game view
also hides the labelled boxes for component parts that have no art picked (a Feature
Card's empty panel or rig slot), because the game draws nothing there either. Turn it
off to draw every screen at once with those boxes. The eye toggles still apply on top.

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
The engine's own top band (the info overlay) always draws above both. A screen ticked **Behind the
reels** shows an `UNDER` badge instead; the two ticks are mutually exclusive.

Bottom to top, the game draws: background screens → the coded background →
**Behind the reels** screens → the reel board → the Screens list → **Always on
top** screens → the engine's top band.

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
  `cluster`, `scatter`, `bookOf`, `holdAndWin`, plus any author-created custom kinds) and
  **Import composed reference** (open a reference game already laid out). Pick
  one and click **Load**. Loading a layout whose game type differs from the
  project's is flagged as a cross-type preview and will not autosave — you must
  Save (which converts the project) or Discard.
- **＋ New empty screen**, **＋ New background screen**, **＋ Add / Refresh HUD
  layer**, and **＋ New HUD screen** create screens directly.
- **＋ New bet menu screen** and **＋ New auto spin screen** seed the two player
  menus — see [the section below](#the-bet-menu-and-the-auto-spin-screens).
- **＋ Add missing screens** appears when the game defines screens the current
  layout lacks. Each added screen goes in at its place in the game's own screen order,
  not at the end of the list. A project created before its kind's template existed (for
  example a Hold and Win project scaffolded before the Jackpot bar and Pots screens) gets
  them here. The screens and the Components list follow the project's game kind (set when
  the project was created, or in Admin), even when its layout was first loaded from another
  kind's reference. They also follow the project's **add-ons** (its Game Config's **Pots overlay**
  and **Hold and Win** blocks): a Book of project with the pots overlay gets the Pot Meter in the
  Components list, the pot signals in the pickers, and a **Pots** screen in its screen set; one
  with a Hold and Win bonus also gets the respin parts, the Hold and Win signals and symbol
  states, and the feature's screens.
- **＋ Add overlay screens (n)** appears on a project of another kind whose add-on screens are
  missing. It adds only those: the **Pots** screen (one Pot Meter per pot in the Game Config),
  plus, with a Hold and Win bonus, the **Jackpot bar** and the feature's screens (not Lucky
  Spin). Each goes in after the screen it follows; existing screens are never replaced or edited.
  Hover it to see which screens it will add.

**Hold and Win screens.** A Hold and Win project starts with one screen set for all three
presets (Grand, Super Hotfire Diamonds, 3 Pots of Egypt): the **Jackpot bar** and **Pots** show in
the base game and the feature; the feature's screens (**Respin background**, **Respin board**,
**Respin counter**, **Total win bar**, **Letters**, **Wheel**, **Feature intro**, **Jackpot win**,
**Feature outro**) carry the role _game mode_ `holdAndWin`, so they show only while the feature
runs; **Lucky Spin intro** is a base-game banner. A piece your preset does not use draws nothing in
the game (a pot whose meter the Game Config lacks, letters without a column-letters board end, a
wheel without prizes), so leave it or delete its screen. The base game's **Messages** info bar is
where the game's toasts ("UNLOCKED: PAYER", jackpot amounts) appear — keep one. There are no
free-spin screens; the Free-Spin Counter and free-spin intro/outro components stay in the
Components list, so a hybrid game places them on screens of its own. Each pot is a **Pot
Meter** component on the **Pots** screen, with its `meter` param naming the Game Config meter; the
screen gets one per meter the config declares, so a preset without meters gets no Pots screen.
Move and scale it here. Its **Pot art**, **Label** and **Motion** groups skin that one pot, and
nodes you put inside its part in the Component Editor replace the coded drawing. See
[Skin a coded part](component-editor.md#skin-a-coded-part). While no Pot Meter for a
meter is on screen, the game draws its built-in pot for that meter. A screen
reaches the game only when the flow shows it. The Hold and Win starter flow shows **Jackpot bar**
and **Pots** from the start. A project whose flow is older (scaffolded on the Book-of starter)
also needs a **Show container** for each at load in `/flow-v2`.

### The bet menu and the auto spin screens

The two menus the player opens from the HUD — tapping the **bet** readout to change the
stake, and the **auto spin** button to set autoplay up — used to be coded dialogs with no
authoring surface at all. Both are now ordinary screens you build here, and
[Invisible Flow](flow.md) decides **when** each one opens.

**Seed one.** Under the Screens list, **＋ New bet menu screen** creates _Bet Menu_ and
**＋ New auto spin screen** creates _Auto Spin_. Each lands in `canvas` space (positioned
against the window edges, so it stays centred on any device) and is tagged with the
matching role. Pressing the button again once the screen exists just selects it, so you
cannot end up with two. What you get is deliberately plain — a starting point to restyle,
not a fixture:

- **Bet Menu** — a dim full-window backdrop, a **SELECT YOUR BET** title, a **Bet amounts**
  repeater laying the stake ladder out as a three-column grid, and a **CANCEL** button.
- **Auto Spin** — the same backdrop, a **NUMBER OF ROUNDS** title over the round-count
  grid, then **LOSS LIMIT** and **SINGLE WIN LIMIT** grids, a **START AUTOPLAY** button and
  a **CANCEL** button. The coded dialog folds the two limits away behind an **advanced**
  toggle; here they sit in the open, so delete those four nodes — two titles, two grids —
  if your game doesn't offer limits. A run then uses the standing limits, which default
  to `∞`.

Both screens are full-canvas takeovers, which is why each carries a **CANCEL** — it is the
player's way back out, and the flow has to wire it (see the caveat at the end of this
section).

The seeded copy is not English typed into a text box: every title, **START AUTOPLAY** and
**CANCEL** is the _same_ string the coded dialog uses, so a game that already ships in
other languages has them translated before you start. The `MAX` tile label goes the same
way, which matters because the repeater feeds it and you can't reach it here at all.
Reword a title and you simply get a new string — still collected by
[Invisible Localization](localization.md) (it harvests the text you place on screens), but
needing a translation of its own.

Move, restyle, re-art and re-lay-out these like any other screen. Properties → Screen
carries the **role** dropdown, which gained **bet menu** and **auto spin** beside loading
(splash) / base game / buy feature / buy confirm. The role is how the engine finds the
screen, so you can rename it or give it any id you like — just keep exactly one screen per
role.

**Game mode screens.** The role **game mode** is the exception to "one screen per role": pick it
and a **mode** field appears (suggestions: `freeSpins`, `holdAndWin`, or a mode the project declares
in Game Config → Game modes). The game shows such a screen only while that mode is playing and
removes it when the mode ends; tag as many as a mode needs (its board frame, counter, background).
In a game driven by a Flow that mounts its own screens, show it from that mode's **Mode trigger**
in `/flow-v2` instead. A mode screen whose id starts with `hud_` is that mode's HUD; name it as the
mode's **HUD** in Game Config to make it replace the base HUD while the mode is on top.

**The option grids are Repeaters.** A **Repeater** (click one in the Library's
**Elements**) stamps one copy of a component per item of a live list the game supplies.
Select it and Properties gives you:

- **data source** — which list to stamp, now a dropdown rather than a free-text box:
  _buy-feature cards (one per bet mode)_, _bet amounts (the bet menu ladder)_, _auto spin
  counts (10 … ∞)_, _auto spin loss limits (5× … ∞)_ and _auto spin single-win limits
  (5× … ∞)_. A custom source already saved in the document is kept in the list so it is
  never rewritten under you. The game registers the actual arrays at runtime; a source the
  game doesn't register simply stamps nothing.
- **component** — which component each item becomes. It defaults to the new built-in
  **Option Tile**.
- **direction** (`row` / `grid`), **gap**, and **columns** when it is a grid.

The canvas cannot run a live list, so it draws a **sample grid of the right length and
shape** — enough to size and place the grid you are laying out. The real bet ladder comes
from the RGS while the game runs, so the amounts you see here are stand-ins; the autoplay
ladders are fixed (`10 … 1000, ∞` and `5× … 100×, ∞`) and do match.

**Option Tile** is the built-in each option becomes: a plate, a label, and a press. Its
params are a frame **tint**, **fontSize**, **font**, and the usual **State images** group
(normal / hover / pressed / **selected** / …) — point those at your own frames and the
tile takes your art. The label and which tile is currently picked are fed by the engine,
not typed here. The picked one is shown two ways at once: it takes the **selected** state
image, _and_ its label turns gold — so the current stake reads correctly even before any
art is authored. Restyle the tile in the [Invisible Component Editor](component-editor.md),
or point the repeater's **component** dropdown at a component of your own.

**Making a button on the screen do something.** Properties → **Engine bindings** →
**Action** (and a button instance's own `action` param) gained three keys:

| Action                     | What it does                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **bet menu (open)**        | Opens the bet menu. The seeded HUD bet readout already carries it.                                         |
| **auto spin — start**      | Starts an autoplay run from the currently picked options. The seeded **START AUTOPLAY** button carries it. |
| **close (dismiss screen)** | A generic dismiss. Both seeded menus carry a **CANCEL** button bound to it; use it for a ✕ of your own.    |

A readout can also show the standing choice: the **source** dropdown on a HUD Readout,
text box or message bar gained `autoSpins`, `autoSpinsLossLimit` and `autoSpinsWinLimit`
(the picked option as text, `∞` included) plus `autoSpinsRemaining` (rounds still to play,
`0` when autoplay isn't running). The option tiles offer the operator's own ladder when their
page declares one, and the defaults otherwise.

**Operator chrome — clock, session time, home, history.** These show only when the operator's
page declares them (`clock`, `elapsedTime`, `home`, `externalHistoryUrl`). With no authoring, every
game draws them in a thin strip at the top edge. To place them in your own HUD instead:

| Put this   | Bind it to                                                                                                          | Gate it with (**Shows during**)                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| a text box | **source** **Clock (operator)** (e.g. `14:05`) or **Session Time (operator)** (e.g. `0:12:34` — add your own label) | **Operator shows a clock** / **Operator shows session time**           |
| a button   | **action** **home (operator lobby)** or **history (operator page, new tab)**                                        | **Operator has a HOME (lobby) link** / **Operator has a HISTORY link** |

Once your HUD shows one of them, the strip stops drawing that item. Ungated, a clock text box is
empty and a home/history button is disabled on a launch that declares nothing. The editor preview
shows these text boxes empty, like a balance readout. What each operator field means:
[the protocol reference](../reference/play4fun-protocol.md#host-settings--gamesettingsconfig-2026-09-30).

> **Nothing changes in the game until the flow wires it up.** These screens show
> themselves for nobody: a screen only mounts when Invisible Flow's `Show` runs, and the
> HUD presses only reach the flow once you wire their pins. Until then the old coded
> dialogs open exactly as they always did and your authored screens never appear — which
> is why an existing game is untouched by seeding them. The wiring is a handful of nodes,
> written up in
> [the Flow guide](flow.md#the-bet-menu-and-the-auto-spin-menu--a-worked-example).

### 2. Place assets from the Library

Open the **Library** tab. It is grouped into:

- **Elements** — drag in a **Text** node or a **Rect** fill, click
  **Reel** to insert the board/reel-grid placeholder (one per game; the item
  highlights and re-selects the existing reel if you already have one), or click
  **Repeater** to insert a data-driven list that stamps one component per item of a
  live source (the option grids on the
  [bet menu / auto spin screens](#the-bet-menu-and-the-auto-spin-screens), the
  buy-feature cards). A layout may carry as many repeaters as you like.
- **Atlases** — composed atlas pages and atlas manifests. Manifest entries
  expand to their individual regions, which you drag in one at a time.
- **Rigs** — the project's rig bundles (plus shared `_shared/` bundles,
  badged "shared" — see [the shared rig library](#the-shared-rig-library)).
  There is an **Upload rigs** action to sync a folder of
  Rig bundles into the project's storage.
- **Sheets** — sheet outputs; expand to drag individual regions.
- **Effects** — the project's authored **Invisible FX** particle effects; drag
  one in to place it at a position in the scene. The editor renders the effect's
  **live particles** right on the canvas (an overlay, the same way it shows rig
  rigs live), following pan/zoom — toggle it with the **▶/❚❚ FX** button in the
  toolbar. A ✨ placeholder chip still marks nodes that aren't rendering live yet
  (still loading, or a bone-attached effect). Change which effect a placed node
  references from the Properties panel. There you can also **attach the effect to
  a rig**: pick a placed rig node from the "attach to rig" dropdown and the
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
  A placed clip can also **swap to another clip when the game or a flow cues it** — see
  [Plays on signal](#plays-on-signal--a-rig-or-flipbook-that-changes-what-it-plays).

  On a `background` screen — or with **Fill → Cover / full-screen fill** ticked on a
  `canvas` screen — a clip fills the window edge-to-edge instead of drawing at its
  placed size, exactly like a background image does. It then stops being draggable
  and resizable: tune it with **fit** / **cover scale** / **align x** / **align y** in the
  Background section and **scale.x** / **scale.y** in Transform. The fill is measured from the clip's **bounds
  box** when it declares one, else from its **first frame**, so frames of different sizes
  don't make the backdrop breathe.

  > The canvas previews **every** clip looping, so you can always see the
  > animation. A _play once_ clip still stops on its last frame in the game.

  > If a clip is deleted or renamed in Invisible Flipbook after being placed, the
  > node keeps its position but the game renders **nothing** for it (deliberately —
  > there is no fallback art, because a wrong animation is worse than none). The
  > editor calls it out in two places: the node draws a 🎞 chip, and it is counted
  > in the header's **asset issues** pill.

### The shared rig library

Bundles badged **shared** come from `_shared/spines/` — a cross-project library any
project can place from without owning it, the rig twin of `_shared/sheets/`. It
resolves **project-first**: a project bundle of the same name shadows the shared one, so
the library can never override work a project owns. Shared bundles travel the export →
`deploy/` → bake → pull chain exactly like project ones.

It is seeded with the engine's own set — the animation `apps/lines` ships — so a new
project has something to place before it has commissioned anything:

| Bundle                                                                    | Animations                                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `engine-loader`                                                           | `title_screen`                                                                                                |
| `engine-transition`                                                       | `animation`                                                                                                   |
| `engine-bigwin`                                                           | `big_win` / `super_win` / `mega_win` / `epic_win` / `max_win`, each `_intro` `_idle` `_exit`                  |
| `engine-anticipation`                                                     | `anticipation[1-4]_intro` `_loop` `_out`, plus `payframe` (the win frame)                                     |
| `engine-reelhouse-glow`                                                   | `reelhouse_glow_start` `_idle` `_exit`                                                                        |
| `engine-foreground` · `engine-foreground-feature`                         | `idle`, `dust`                                                                                                |
| `engine-buy-button`                                                       | `buy_button_default` `_hover` `_click` `_disabled`, `_active_intro` `_idle` `_exit`                           |
| `engine-fs-screen` · `engine-fs-screen-number` · `engine-fs-total-number` | `intro`, `idle`                                                                                               |
| `engine-global-multiplier`                                                | `static`, `increment`, `win`, `reset`                                                                         |
| `engine-cluster-pay`                                                      | `win`, `multiwin`                                                                                             |
| `engine-tumble-win` · `engine-tumble-multiplier`                          | `explosion`, `idle` / `static`, `explosion_mobile`                                                            |
| `engine-win-meter-explosion`                                              | `explosion`                                                                                                   |
| `engine-symbol-h1`…`h5`, `engine-symbol-l1`…`l4`                          | `<id>`, `<id>_static`                                                                                         |
| `engine-symbol-m`                                                         | the multiplier set (`2x`…`10x` × `_land` `_static`, `low`/`mid`/`high_multiplier_*`)                          |
| `engine-symbol-s`                                                         | `scatter_static` `_spin` `_land` `_win`                                                                       |
| `engine-symbol-w`                                                         | `wild_dynamite` `_static` `_land` `_exploded_static`                                                          |
| `engine-explosion`                                                        | `explosion` — the Symbols tool's Explosion default ([why](symbols-state-machine.md#the-shared-rig-library)) |

**One bundle per skeleton, by design.** Upstream packs several skeletons behind one
shared atlas (`symbols/` holds h1…l4). The editor addresses a bundle by FOLDER plus an
animation name — there is no skeleton selector, and the resolver takes the folder's first
`skeletons.json` entry — so a folder shipped whole would publish nine skeletons of which
only `h1` could ever resolve. They are split so every animation is actually placeable.
The cost is that a split family re-copies its atlas page per skeleton; the editor's export
dedups identical pages content-addressed, so placing several costs one page, but the
Symbols export does not (see the note in its guide).

The library is **read-only from the tools** — it is curated out-of-band by
`apps/launcher-api/scripts/seed-shared-engine-rigs.mjs`, plus the admin panel's
"bring a rig into the shared library" promote for the engine boot mark. To make one your
own, place it, then re-author it in the [Rigger](/docs/rigger) under your project.

**Drag any library item onto the canvas** to spawn a node in the active screen.
The editor renders the real texture (and rig bundles preview as a live
skeleton), so what you see matches what the game will draw.

The **reel board** previews the real symbols too: each cell shows a symbol's
**Static** binding from the Invisible Symbols State Machine, cycled across the
grid so the board looks populated. Sprite and rig symbols both draw — a rig
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
(`x/y`, anchor, scale, rotation, alpha, zIndex, tint, blend), text content/style for
text nodes, rig animation/skin for rig nodes (driven by dropdowns when the
canvas can read the bundle's animations), background cover (fit / zoom /
alignment) for cover nodes, and the slot the node fills (when a template is loaded). It also offers
node actions such as **Convert to reel grid**, **Convert to parametric button**,
and **Edit as component** (materialise a container into the Component Editor).

#### Blend — how an item mixes with the art behind it

Select a **sprite, flipbook clip or FX effect** and Transform shows a **blend**
dropdown. It is the Photoshop control: instead of simply covering what is behind it, the
item's pixels are combined with them.

- **Normal** — the default, and what every item has until you change it. Covers the art
  behind it.
- **Add (Linear Dodge)** — sums the two. The reach-for-it mode for **glows, light shafts,
  sparks, flares** and most additive FX: black pixels in the art disappear entirely and
  bright ones lift the backdrop. An emitter set to Add reads as one glow, not a crowd of
  particle sprites.
- **Multiply** — multiplies the two, so the result is always darker. Use it for
  **shadows, dirt passes, vignettes and colour washes**; white pixels vanish.
- **Screen** — the inverse of Multiply, always lighter. A softer lift than Add, which is
  usually what you want over an already-bright backdrop where Add would blow out to white.
- **Lighten** — keeps whichever is brighter, channel by channel. Like Screen in that dark
  areas of your art disappear, but it **keeps your art's own colour** instead of pushing it
  toward white — warm light shafts stay warm over blue water, where Screen would wash them
  pale. Reach for it when Screen is right in principle but is bleaching the colour out.
- **Overlay** — Multiply where the backdrop is dark, Screen where it is light, so it
  _boosts contrast_ instead of pushing one direction. The mode for a texture or colour pass
  that should sit **into** the art rather than on top of it: grime over a panel, a light wash
  across a backdrop, a gradient that tints the shadows and the highlights differently. It
  keys off what is behind it, so the same layer reads differently over a dark screen than a
  bright one — place it, then look.

The canvas shows the real result, not an approximation: a blended item composites against
everything drawn beneath it — **including the art on the screens below it in the list**,
so a glow placed on the base-game screen visibly lifts the Background screen's art. That
is the same thing the game does, so the preview and the shipped game agree.

Blend is **per device layout** like the rest of Transform: switch the layoutType pill to
`portrait` and pick a different mode there to override just that ratio (a dot + × marks
the override and clears it). Useful, because an additive glow tuned over a wide desktop
backdrop often has to fall back to Normal over a portrait crop.

> Text, rects and containers deliberately have no blend control — the editor draws them on
> surfaces its blend model does not cover, so the preview could not keep the promise.
>
> **Neither do rigs, and that one is worth knowing.** A blend can't reach skeleton geometry
> at all — the rig runtime batches every slot carrying that _slot's_ own blend and never
> consults the engine's blend setting, so a blend on a rig node would preview in the editor
> and do nothing in the game. Rig art blends **per slot, in the Rigger**: give each layer its
> own slot, set the draw order, and pick its blend there. The rig format offers
> normal / additive / multiply / screen only — no Overlay or Lighten.

#### Plays on signal — a rig or flipbook that changes what it plays

Select a **rig** node and its **rig** section ends with a **Plays on signal** block;
select a **flipbook** node and its **Flipbook** section ends with the same block. This is how
something you placed on a screen changes what it plays while the game runs: each row pairs a
**signal** name with what to play, and when Invisible Flow broadcasts a cue of that name, this
node plays it. A rig swaps **animation**; a flipbook swaps **clip** — which is how a
character drawn as frame animation, rather than rigged in rig, reacts to the game at all.

The fields above the block stay the node's _resting_ state — what it plays when no signal has
fired: a rig's **default animation**, **skin** and **loop**; a flipbook's **clip** and the
playback overrides beside it.

Each row is:

- **signal** — the cue name, typed as **free text** (e.g. `characterSpin`). You invent the
  name here, and Invisible Flow offers it back to you in its **Cues** palette. The field also
  suggests the signals the game fires from its own beats for this project's kind (Win, Big
  Win, and with the Hold and Win feature the pot, coin, jackpot, wheel and feature signals; with
  the pots overlay add-on the pot signals). Those
  need no Flow at all, which is why the **Cues** palette does not offer them. The match is
  exact: a name spelled differently on the two sides never fires.
- **animation** (rig) — the clip to play. A dropdown of the rig's animations when the editor
  can read the bundle, a text field when it can't.
- **clip** (flipbook) — the clip to swap to, picked from the project's clips (each listed with
  its frame count). A clip since deleted or renamed in Invisible Flipbook is listed as
  _(missing)_, and the node simply keeps playing its resting clip.
- **loop** — hold what the cue started, or let it finish (below).
- **×** removes the row; **+ add cue** adds another. A node can carry as many rows as you
  need.

**Looping holds what the cue started** — it runs until another cue on the same node replaces
it, which is what a "for as long as the reels spin" mode needs. The control itself differs
between the two kinds, because they have different things to fall back on.

On a **rig** it is a tick box. Ticked, the animation holds. Left unticked, it plays **once**
and the rig settles back into its **default animation** — the intro-then-idle shape.

On a **flipbook** it is a three-way choice, matching the node's own loop control above it:
**clip default** keeps whatever the clip was authored to do (the menu names which, so you are
never guessing), **loop** holds it, and **play once** runs it a single time. There is no
settling back to the resting clip — a flipbook has no equivalent of a rig's default animation
— so a one-shot clip stays on its last frame until another cue replaces it.

**A cue is never cleared.** There is no stop signal: going back to idle means firing a
_second_ cue that names the idle animation, or the resting clip. A character that idles,
spins, then idles again is two rows, not one.

**A cue only reaches a node that is on screen.** Nothing is queued and nothing is
replayed: if the cue fires while the screen holding the character is hidden, that
character misses it and stays as it was.

**Firing the cue that is already running does the sensible thing for what it is.** A looping
cue keeps going rather than snapping back to its first frame — which matters, because in free
spins a "spinning" cue fires once per spin while the "idle" one fires only at the end of the
round, and a rewind on every spin would read as a stutter. A one-shot cue, on the other hand,
plays again — firing a burst twice is asking to see it twice.

> The same block appears in the **Invisible Component Editor**, also as free text. There are
> three differences:
>
> - The field suggests the component's own declared signals first.
> - A one-shot **rig** cue can also **fire a signal on complete** to sequence a sibling. A
>   flipbook cue has no complete signal in either editor: a clip reports no finish, it just
>   stops on its last frame.
> - A component can be **scoped by** a param (Phase 12a). Its cues then play only on the
>   signals of the part a placement stands for, such as the red pot's **Pot — activate** and
>   not the blue pot's. See the Component Editor guide.

**One component, two placements, different signals.** When you select a placed **component
instance** — the instance itself, not a node inside it — its properties carry a
**(this placement)** panel for each cued rig and flipbook the component contains, listing
that node's cues under **Driven by signal**. Type or pick a different signal in a row (any
engine signal or Flow cue name) and only _this_ copy follows it. Leave the row blank and it
keeps the component's own. That is how one character component can idle on the base game and
react to something else entirely on the free-spin screen, without forking the component. A
cue name typed here, or on a node inside a placed component, is offered in Invisible Flow's
**Cues** palette like a screen's own.

> **Firing the cues is the Flow's job.** The end-to-end recipe — name them here, then wire
> them to the spin and to the end of the round, and the two traps that bite — is in the
> Invisible Flow guide under
> [Scene cues](flow.md#scene-cues--animate-a-placed-character).

#### Bind to value — a number that moves, fills or poses an item

**Bind to value**, at the bottom of Properties, makes an item follow a live game number. It can
move, scale, rotate, fade or show the item, fill a sprite / flipbook / rect from one edge, hold
a flipbook frame, scrub a rig animation, or offset a rig bone. On a screen the number is an
engine value: respins left (÷ the cap), cells held, rows open, collector level, letters lit, the
jackpots, bet, win and the rest. Drag the binding's **test value** to preview it on the canvas;
it is never saved. Selection handles and dragging keep the authored position.

The same section in the Component Editor can also read the component's own params and the pot
of the instance it sits in. The full reference is in the Component Editor guide under
[Bind to value](component-editor.md#3b-drive-a-node-from-a-number-bind-to-value).

#### Background — how a full-bleed cover is fitted, zoomed and aligned

Select a node that covers the window — anything on a `background` screen, or a
sprite / rig / clip with **Fill → Cover / full-screen fill** ticked on a `canvas`
screen — and the Properties panel shows a **Background** section. The node stops being
draggable (its transform is computed, not authored); these controls are how you shape it:

- **fit** — how the art is matched to the window:
  - **cover (fill, may crop)** — the default: fill both axes, cropping the overflow.
  - **contain (fit inside)** — fit fully inside, letterboxing the short axis.
  - **fit width — X** — the art is exactly as wide as the window, whatever that does
    vertically (crop or gap).
  - **fit height — Y** — the art is exactly as tall as the window.

  `cover` / `contain` _choose_ the axis from the aspect ratio, so which axis they pin
  flips as the window ratio crosses the art's. The two per-axis fits **pin** it, which is
  what you want when a backdrop must always span the window horizontally (say) and you
  have decided what happens on the other axis.

- **cover scale** — a uniform zoom on the fit. `1` = exactly the fit; `1.1` over-covers
  by 10%.

- **align x / align y** — where the fitted art sits in the window: `0.5` (default) is
  centred, `0` hugs the left / top edge, `1` the right / bottom. On a cropping cover this
  chooses **which part of the image you keep**; on a `contain` fit (or an under-zoomed
  cover) it chooses which edge the art hugs. This is the same field as the Transform
  **anchor** — a cover is always drawn from its own centre, so its anchor aligns instead
  of pivoting.

- **scale.x / scale.y** (in Transform) — free non-uniform stretch on top of the fit
  (e.g. `1.0 × 1.2` = 20% taller). Independent of cover scale, which stays uniform.

All four — fit, cover scale, alignment and stretch — are **per device layout**: switch
the layoutType pill to `portrait` (or any non-base bucket) and set them there to override
just that ratio, leaving desktop alone. A dot + × next to the control marks an override
and clears it. That is the usual reason to reach for the per-axis fits: a backdrop that
should span the WIDTH on desktop often has to span the HEIGHT in portrait.

#### Art bounds — the box a sprite is sized by

Select a **sprite** node and the Properties panel shows an **Art bounds** section: a
small preview of the region with a draggable box over it. This is the sprite twin of the
Rigger's **Bounds** and of an Invisible Flipbook clip's box — it declares _the space this
piece of art occupies_, and everything that draws the region sizes, anchors and
cover-fits by that box instead of by whatever rectangle the packer produced.

- **⊙ Fit** boxes the region's art, **⌖ Centre** re-centres it, **✕ Clear** removes it.
  Drag the box or type exact **x / y / w / h** — `x`/`y` are the box's top-left relative
  to the region's **origin** (its centre), so a centred box has `x = -w/2`.
- **A box smaller than the art is deliberate.** The art is not cropped to it; it
  overflows. That is how you size a symbol by the part that reads and let a glow or a
  burst hang outside the reel cell — the sprite answer to a rig whose canvas
  covers invisible effects.

> **It edits the ART, not this placement.** The box is stored per
> `<assetKey>::<region>` and applies **everywhere that region is drawn** — other
> screens, other scenes, the reel, other tools. It is saved immediately (it is not part
> of the layout doc, so the page's Save doesn't cover it), and it reaches the game with
> the next **art export** — the exporter writes it into the sheet the game loads, so
> there is no extra publish step and nothing new to register.

#### Symbol size on the reel

**Symbol size comes from the art.** There is no symbol-size control: every symbol is fitted
inside its reel cell by its own art, centred, with its aspect ratio kept — a sprite by its
picture (or its **Art bounds**, above), a flipbook by its clip's bounds box, a rig by the
rig's Bounds frame (or the skeleton size rig exported) — so the same picture reads the same
on every board. To change how one symbol fills its cell, change its art: crop it, set its
**Art bounds**, or set the rig's **Bounds** in Invisible Rigger. Resizing the reel cell itself
(`cellSize`) scales the grid _and_ the symbols together. (An earlier "Symbol size (× cell)"
control and `reelGrid.symbolSizeRatios` were removed.)

#### Symbol overflow — room for art that spills past the reel

The board is **clipped to its reel window**, which is what stops a spinning strip from
being seen above and below the reels. The cost is that a symbol drawn bigger than its
cell — a creature with tentacles, a character standing on a rock — gets **cut off at the
board edge**. With the **reel grid** node selected, **overflow X** and **overflow Y**
(px, blank = 0) buy that art extra room outside the window.

- It grows the **clip only**. No cell moves, no symbol moves, the board keeps its size —
  the window it is drawn through just reaches further out.
- **In game it applies whenever nothing is travelling.** A rolling strip still ends at the
  board edge, so you never see the reel continue into the padding; the extra room appears
  the moment the last reel lands and is gone again on the next spin. That is why the reels
  stagger-stop first and the art "opens up" at the settle rather than per reel.
- **Animated states get it too, as long as they animate in place.** A symbol's **Land**,
  **Win**, **Explosion** and **Intro** art can spill, because those play with the symbol
  sitting on its seat. On a swap-in-place board that includes the whole **emerge** arrival
  and the outgoing **explosion** — the two the padding is usually bought for. What stays
  clipped is genuine travel: the spin itself, and a cascade's fall and drain, where a
  symbol crosses the board edge on its way in and the window is the only thing hiding it.
- On the canvas the extra room is drawn as a **dashed outline** outside the board box,
  and symbol art is previewed clipped to it — the preview is the settled board, which is
  the generous moment, so check a spin in the live game if you dial a large value.
- **X is the smaller knob.** The board already tolerates about a full cell of horizontal
  spill on each side, so side art usually has room without it; the cut people actually
  hit is top and bottom, which is **overflow Y**.
- Blank / `0` is the old behaviour exactly, and a negative is ignored (it would shrink
  the window rather than grow it). Resizing the board scales the overflow with it.

> Reach for **Art bounds** first when a symbol looks wrong _inside_ its cell — that
> declares the box the art is sized by. Overflow is for art that is sized right and is
> _meant_ to hang outside the reel.

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

The preview mirrors the game exactly. Both the 2D canvas and the rig layer read
one shared geometry, so a sprite symbol and a rig symbol land on the same seat;
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

**History…** in the top bar lists earlier saved versions of this project's layout,
newest first. Each save keeps a copy of the version it replaces (at most one every five
minutes while you work, the newest 20 kept); loading a reference/scaffold layout, an
**Overwrite with mine** and a restore always keep one. Pick a version and **Restore**:
it is saved like any other save — refused with a reload prompt if someone else saved
since you opened the project — it keeps a copy of the version it replaces, so a restore
can be undone from the same list, and the page reloads onto the restored layout.
Restoring is disabled while another author holds the project, and the list warns when
you have unsaved changes (including an unsaved reference preview).

**Reaching the running game** is a publish step, not an in-tool export button. For an
online game, **Publish** in Invisible Game Maker freezes the saved layout (with its art,
flow and config) into a published version, and that is what players boot — a save made
after it reaches them only on the next Publish. Game Maker's **Live ↗** plays your current
saved data, so check there first. See [Publish and deliver](../guides/publish-and-deliver.md).

A desktop build (☁ Publish / 📦 Deliver) bakes the saved layout into its bundle, so it
picks up edits on its next build. An un-baked dev game (e.g. `apps/lines` run locally)
instead fetches the saved doc at boot (`GET /api/editor/doc?project=&k=`, gated by the
launcher's `EDITOR_DOC_SECRET`), falling back to the game's checked-in `editor-scenes.ts`
fixture when the endpoint isn't reachable or no doc exists. Either way the engine renders
the doc via `<LayoutScene>`; existing coded/animated components (e.g. `Win`, `Transition`)
keep mounting at their layout positions through the engine's bound-component
registry. As with every R2 asset class, anything the layout references must also
travel the export → deploy → bake → pull chain to ship inside the game bundle.

### Game Settings → Boot splash

The right panel's **Game Settings** section carries this game's own boot splash —
the second pre-game screen, shown after the engine mark (which is set once for
the whole pipeline in Admin → Settings and is not editable here). It replaced the
"Add Your Loader" placeholder.

Pick a **rig** from the project's rig library (shared bundles are offered too,
marked `(shared)`), an **Animation**, a **Background**, and a **Size**.
`— none —` skips the game splash so boot goes straight from the engine mark into
the game.

**Size** multiplies the automatic fit rather than setting an absolute size —
`1.00×` is the mark scaled to sit inside a safe box, so the same value holds on
every screen the game runs on. Above about `1.6×` it can run past the viewport.

Set the animation explicitly unless the skeleton's _first_ clip is the right one:
a rig left on its resting/setup pose renders **empty**, which looks like a
broken splash rather than an unset one.

The splash ships through the project's `deploy/_boot/` tree, so it reaches the
game on the next **Publish** — the same trip as the rest of your art.

### Advanced modes (optional)

- **Components** — the **Components** section of the Library tab lists reusable prefabs (overlays,
  UI groups, scenery), grouped by category. **Place** one to drop a component
  instance into the active screen; instances' params are editable in Properties. An instance's
  **component** select switches the component it draws (say, a Pot Meter to your own Pot copy),
  keeping its position and params.
  The list shows only what your project's game kind and add-ons use: the Hold and Win pieces
  (Respin Counter, Jackpot Bar, Jackpot Tile, Total Win Bar, Pot Meter, Letters Strip, Letter Tile,
  Wheel, Respin Cell Tiles, Locked Row) appear only in a Hold and Win project or one whose Game Config
  has a Hold and Win bonus; the Pot Meter also with the pots overlay. A screen that already holds
  one keeps drawing it.
  A **Jackpot Tile** reads `jackpot.<tier>`: the tier's prize at the current bet — for a
  progressive tier, the server's live pool, which moves with every round and balance refresh.
  The **Platform Jackpot Bar** is offered to every kind. It holds four Jackpot Tiles fed
  `platformJackpot.<tier>`, the casino platform's own jackpot in money, live. It is gated by
  `platformJackpotShow`, so it stays hidden where the operator runs none. A Jackpot Tile's
  **source** and **visibleSource** lists offer the same platform values.
  A **Total Win Bar** draws the feature total. Turn on its **catchesCoins** and the feature end's
  coins fly into it instead of the win meter; **landPulseScale** pulses it on each one. Both are
  off by default.
  A **Wheel**'s **Wheel art** group swaps its face (it turns), rim and pointer for your art. Its
  **Labels** group restyles or hides the prize labels and the landed outline.
  A **Letters Strip** draws Grand's letters. Its **tile** picks a component, usually your Letter
  Tile copy, for every letter to draw as. Blank keeps the game's own letters. A param that names a
  component is a list of your project's components that fit it: the **tile** lists those with a
  `reel` and a `letter`, which are the Letter Tiles.
  **Respin Cell Tiles** sets the tile drawn under every respin cell (**tileImage**, **tileTint**) and
  a **gap** between cells (a share of a cell, 0–0.45, which also insets each cell's rolling
  window). Where you drop it doesn't matter: the tiles draw at the respin board's own cells. The
  Hold and Win template puts one on the **Respin board** screen; without a tile image or a gap it
  changes nothing. **Select it** to preview: the reel grid then shows every cell as an empty respin
  cell on your tile, at the gap — the respin board itself only appears in the game, during a
  feature (**Live ↗**). Its **tile** picks a component, usually your Cell Tile copy, for every
  cell to draw on instead of the **tileImage**. It lists the components with a `reel`, a `row` and
  a `held`. The preview still shows the **tileImage**.
  **Locked Row** is what an **expanding** respin board (Game Config → Board expansion) draws over
  every cell of a row that has not opened yet (**lockedImage**, **lockedTint**). Without an image the
  game draws its own dark panel marked LOCKED. Like the tiles, where you drop it doesn't matter; the
  template puts one on the **Respin board** screen. **Select it** to preview one locked row under the
  reel grid. The extra rows grow **below** the base grid, so an expanding game needs room there. A
  project whose Game Config already expands when its layout is created (or re-scaffolded, or tops up
  with **Add missing screens**) gets the template that makes room: the reel grid's cells shrink and
  the whole board lifts (its **board nudge**), so the grown board sits where the base board was, and the pieces
  above and below are pushed clear. A project that turns expansion on **later** shows a
  **⇕ Reserve rows for board expansion (N)** button in the screen list: it applies the same cell size
  and board nudge to the reel grid without moving it (undoable). Move any piece that still sits under the
  grown board yourself.
  Authoring components themselves now lives in the separate **Invisible
  Component Editor** (`/components`), which the panel links out to.
- **Template editor** — a separate, advanced mode (top-bar toggle) for defining
  a game type's slot schema: tag nodes with a `slotId`, choose the game type,
  and **Save template** to write `editor/templates/<gameType>.json`. Not needed
  to lay out scenes; it defines the slots that scene authors then fill.
- **Save as new game kind…** — saves the current screens + engine pieces (minus
  artist art) as a new reusable kind that appears under "New game from kind".

## Traps

- **Your saved changes aren't in the game players open.** Players boot the last published
  version, not your latest save. Check on **Live ↗**, then Publish — see
  [Save and reach the game](#6-save-and-reach-the-game).
- **Art you changed in another tool still shows the old version, or a new region draws blank.**
  The canvas keeps atlas pages, region lists, flipbook clips and art bounds for the session.
  Click **↻ Reload art** in the canvas toolbar; no page reload needed.
- **Undo can't bring back your layout after ＋ Load scenes.** A load replaces every screen and
  starts a fresh undo history, and your next edit saves it over the project. Open **History…**
  and restore the version from just before the load — a load always keeps one.
- **A Text you placed never shows the live balance or win.** A plain **Text** element only ever
  shows the words you typed. Place the built-in **Text Box** from the Library tab's
  **Components** section and pick its **live value source** instead. The canvas can't run the
  game, so the real number appears only in the game.
- **An image shows another atlas's art in the game.** When two atlases have a region of the same
  name, an image picked before picks were tied to their atlas stores only the bare name, and the
  game can resolve it to the other atlas. Re-pick the frame; a new pick remembers its atlas.
- **The buy-feature cards all look the same here.** Per-mode **Card graphics** from
  [Game Config](game-config.md) are applied only when the game builds its buy menu; the editor
  draws each card with the component's own defaults. Check per-mode art in the game.

## Known limitations / TODOs

- **Animated / book-event-driven content stays coded.** The editor owns static
  scenery, frames, labels, and intro/outro rig poses. Symbols, win-line draws,
  count-ups, and anything derived from runtime state mount via the engine's
  `mount`/`bind` escape hatch — the editor only places their anchor. (The design
  intent is to drive that hatch to zero over time, but it is the current
  boundary.)
- **No in-editor book-event playback or timeline.** Verify animated behaviour by
  running the live game, not in the editor.
- **Some HUD parity gaps remain.** Rotation now ships for HUD elements, but the
  corner logo/game-name containers still ignore `scale` in-game, so scaling those
  two corner texts in the editor won't ship yet.
- **A repeater's canvas preview is a stand-in, not the live list.** The editor
  can't run a game's registered sources, so the bet ladder it draws is a
  representative set of amounts of the right length — the real one arrives from
  the RGS at runtime. Size the grid here; check the amounts in the running game.
- **Interactive feel is partly unverified.** Several recent editor capabilities
  (undo/redo, copy/paste, multi-select, and the two new menu-screen buttons)
  build clean and type-check, but the auth-gated canvas makes automated
  interaction testing hard — owner confirms live.
