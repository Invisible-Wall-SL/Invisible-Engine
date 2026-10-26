# Invisible Scene Editor

Place images, rig, and text onto a game's screens and export a layout the
engine renders — the layout step between the asset tools (Sheet Maker, Atlas
Maker, rig) and the running game. Reusable components are authored here too, on the
editor's [Components side](#the-components-side).

## What it is

An in-launcher, full-page WebGL/canvas layout editor. You pick a screen, drag
assets out of the project's library onto a canvas, position/scale/rotate them
per device layout, and the result is saved as a `scenes.json` layout document in
the project's cloud storage. The engine reads that document at game boot and
renders it; book-event logic stays in code on top of this layout. A screen's own
motion (an intro, say) can be keyed in [Animate mode](#animate-mode--the-timeline).

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
  outline (the node tree, plus template slots when a template is loaded). Under it, the
  **Components** list opens the [Components side](#the-components-side).
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
click them in the list. Their names show in italics.

When the project has game-mode screens (a Hold and Win feature), a **mode menu** sits next
to the toggle: **Base game** or the mode (e.g. **Hold and Win**). Pick the mode and the
canvas draws what the game shows while that mode plays: the base game's screens plus the
mode's board, counter, total and letters. They stay on the canvas whichever screen you
click, the same as the base game's screens. The mode's intro, outro, wheel and jackpot
popups still draw only while you edit them. A spins mode shows its own free-spin counter the
same way (its intro and outro draw only while you edit them), and the reel grid is drawn at that
mode's own grid size. Clicking a mode screen in the list switches the menu to its mode; pick
**Base game** to go back. The choice is kept per project.

In-game view also hides the labelled boxes for component parts that have no art picked (a
Feature Card's empty panel or rig slot), because the game draws nothing there either.
Turn it off to draw every screen at once with those boxes. The eye toggles still apply on top.

Each screen has a coordinate **space** select: `game` (the main game box),
`standard` (the HUD box, with optional vertical/horizontal alignment), `canvas`
(positioned against the window edges), or `background` (cover-fit, full-bleed). On a
`background` screen an image, rig, clip, component or **Rect** fills the window edge to edge
in the game, whatever its size; a text node or a bare group is placed at window pixels instead.
A Rect inside a group keeps its placed box — that is how to put a band or panel on a background
screen.

A `canvas` screen is drawn in window pixels: the canvas here shows it at the
layout's design box (1920×1080 for desktop), and on a bigger or smaller window the
game keeps every node, its offset from the window edge and its timeline's moves the
same number of pixels while the game around it scales. Tick **Scale with the
window** in its Properties to draw it as it looks here on any window the shape of
this frame: the whole screen grows or shrinks as much as the frame must to fit the
window, each node stays pinned to its window edge, and a tap dim still covers the
window. On a window wider or narrower than the frame the edges stay pinned, so
something keyed to just meet in the middle (two curtains) needs a little extra to
close there too. A new Hold and Win game starts with it ticked on **Feature intro**
and **Feature outro**; a game made before that keeps its screens as they were.

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
  `cluster`, `scatter`, `bookOf`, `holdAndWin`, `match3`, `arcade`, plus any author-created custom
  kinds; `match3` is the board that never spins, the **Score and moves** HUD and the **Round won** /
  **Round lost** screens, listed under [Game Maker](game-maker.md)'s **Match-3**; `arcade` is the
  **Play field** spawn layer, the **Score and lives** HUD and the **Round over** screen, listed
  under its **Arcade**) and
  **Import composed reference** (open a reference game already laid out). Pick
  one and click **Load**. Loading a layout whose game type differs from the
  project's is flagged as a cross-type preview and will not autosave — you must
  Save (which converts the project) or Discard. The **Book of** set is a reference for a
  **lines** project too: loaded there (scaffold or import) it is the project's own lines layout,
  not a cross-type one — a Book-of game is lines plus the expanding symbol.
- **＋ Add screen ▾** (under the screen list) opens a menu of everything that adds a screen;
  **⋯** beside it holds the rest. Both open on click, Enter, Space or ↓; the arrow keys move through
  them, → or Enter opens a submenu, and Esc or a click elsewhere closes them. A small number on
  **＋ Add screen ▾** counts the screens this game has that the layout is missing (the **Add
  missing screens** and **Add overlay screens** entries below).
  - **New:** **Empty screen**, **Background screen**, **HUD layer** (only while the layout has
    no HUD — it adds the game HUD without replacing anything), **HUD screen**, and **Bet menu
    screen** / **Auto spin screen**, which seed the two player menus — see
    [the section below](#the-bet-menu-and-the-auto-spin-screens).
  - **From template:** **Add missing screens**, **Add overlay screens** and **Banner screen ▸**,
    each listed only when it has something to add, with the count on the right.
  - **⋯:** **↻ Reset HUD to default** (once the layout has a HUD; it asks before it replaces
    the HUD), **⇕ Reserve rows for board expansion** (when it applies, below) and
    **⧉ Save as new game kind…**.
- **Add missing screens** appears when the game defines screens the current
  layout lacks. Each added screen goes in at its place in the game's own screen order,
  not at the end of the list. A project created before its kind's template existed (for
  example a Hold and Win project scaffolded before the Jackpot bar and Pots screens) gets
  them here. The screens and the Components list follow the project's game kind (set when
  the project was created, or in Admin), even when its layout was first loaded from another
  kind's reference. They also follow the project's **add-ons** (its Game Config's **Pots overlay**
  and **Hold and Win** blocks): a Book of project with the pots overlay gets the Pot Meter in the
  Components list, the pot signals in the pickers, and a **Pots** screen in its screen set; one
  with a Hold and Win bonus also gets the respin parts, the Hold and Win signals and symbol
  states, and the feature's screens. A Hold and Win bonus here means any Game Config mode that
  plays on the respin board with Hold and Win rules, not only the mode `holdAndWin`; one declared
  without rules yet lights nothing.
- **Add overlay screens** appears on a project of another kind whose add-on screens are
  missing. It adds only those: the **Pots** screen (one Pot Meter per pot in the Game Config),
  plus, with a Hold and Win bonus, the **Jackpot bar** and the feature's screens (not Lucky
  Spin). Each goes in after the screen it follows; existing screens are never replaced or edited.
  Hover it to see which screens it will add.
- **One screen set per respin mode.** Both buttons add the feature's screens once for every respin
  mode with rules the Game Config declares, each tagged with that mode. The `holdAndWin` mode keeps the plain
  screens; another mode's screens (and the nodes on them) get `-<mode id>` on their ids and the mode's
  name after theirs, e.g. **Respin board (Gold)**. Each set is laid out for its own mode's
  expanding board, and the base reel grid makes room for the tallest. A Hold and Win
  project already has the `holdAndWin` set, so there only the other respin modes' screens are
  added (and **Add overlay screens** appears for them too).
- **Free-spin screens per spins mode.** A spins mode (a Game Config bonus that plays N spins of its
  own lines/ways/cluster/scatter game) gets its own copies of the free-spin intro, counter and
  outro: ids `freeSpinIntro-<mode id>` etc., each named after its screen with the mode's name in
  brackets, role _game mode_ tagged with that mode. Both buttons offer them, each right after the
  screen it copies.

**Hold and Win screens.** A Hold and Win project starts with one screen set for all three
presets (Grand, Super Hotfire Diamonds, 3 Pots of Egypt): the **Jackpot bar** and **Pots** show in
the base game and the feature; the feature's screens (**Respin background**, **Respin board**,
**Respin counter**, **Total win bar**, **Letters**, **Wheel**, **Feature intro**, **Jackpot win**,
**Feature outro**) carry the role _game mode_ `holdAndWin`, so they show only while the feature
runs; **Lucky Spin intro** is a base-game banner. Its other popups get a screen only when you add
one ([Banner screens](#banner-screens) below). A piece your preset does not use
draws nothing in the game (a pot whose meter the Game Config lacks, letters without a
column-letters board end, a wheel without prizes), so leave it or delete its screen. The base
game's **Messages** info bar is where the game's toasts ("UNLOCKED: PAYER", jackpot amounts)
appear — keep one. There are no
free-spin screens; the Free-Spin Counter and free-spin intro/outro components stay in the
Components list, so a hybrid game places them on screens of its own. Each pot is a **Pot
Meter** component on the **Pots** screen, with its `meter` param naming the Game Config meter; the
screen gets one per meter the config declares, so a preset without meters gets no Pots screen.
Move and scale it here. Its **Pot art**, **Label** and **Motion** groups skin that one pot, and
nodes you put inside its part on the Components side replace the coded drawing. See
[Skin a coded part](component-editor.md#skin-a-coded-part). While no Pot Meter for a
meter is on screen, the game draws its built-in pot for that meter. A screen
reaches the game only when the flow shows it. The Hold and Win starter flow shows **Jackpot bar**
and **Pots** from the start. A project whose flow is older (scaffolded on the Book-of starter)
also needs a **Show container** for each at load in `/flow-v2`.

**Coin board screens.** A Hold and Win project created in Game Maker with **Base game: Coin board
only** has no line game ([plan](../design/hold-and-win-coin-board.md)), and its screens say so. The
board is the base game: its screen, **Coin board** (id `respinBoard`), is a base screen up from the
start, holding the **Respin Cell Tiles** and a **Line Overlay**. **Base game (coin board)** keeps
the reel grid, which only places and sizes the board (no reels ever draw), and the **Messages** info
bar. The **Jackpot bar** is always up. The **Respin counter**, **Total win bar**, **Respin
background**, **Letters** and the feature banners stay feature screens. There is no **Pots** screen
and no **Locked Row** (a coin board neither has pots nor grows). The **HUD — bottom bar** gets a
**Lines selector (when the player picks the lines)** node, an empty box: move and scale it per
layout to place the player's **Lines** panel (Game Config → Coin board → Who picks the lines:
Player). It starts where the game drew the panel before (right of **Bet**, or above it where there
is no room); hidden in a layout, the panel falls back to that spot. A project switched to the coin
board later in Game Config keeps the screens it has: the game still plays, with the board's frame
and tiles only during the feature, and the panel at its default spot.

#### Author the respin counter text (count, RESPINS RESET, LAST RESPIN, modifiers)

With no Respin Counter on screen, the game draws its built-in counter in white Arial with a black
outline. It shows:

- "RESPINS 3" over the board;
- "3 RESPINS" as the feature opens;
- "RESPINS RESET" when a coin puts the count back;
- "LAST RESPIN" on the last respin;
- a small gold modifiers line under it ("PAYER · MULTIPLIER").

To replace all of it with your own look:

1. **Open the Respin counter screen.** If your project has none, use **＋ Add missing screens**. A
   project from the Hold and Win starter already has a **Respin counter** instance and an **Active
   modifiers** Text Box on that screen. Otherwise, place a **Respin Counter** from the Components
   list (under **UI**). While any Respin Counter is on screen, the built-in counter and its
   modifiers line do not draw.
2. **Pick what it says** with its **source**:
   - **`respinCounterText`** shows exactly the built-in counter's words, every beat included. Then
     empty its **label** so no "RESPINS" caption sits over it. An untouched label field only *looks*
     empty: the grey text is its default, which still draws. Type a character, then delete it.
     The **×** button puts the default back.
   - **`respinsLeft`** (the default) shows the number only. Draw your own reset look and play it on
     the **Respin counter — reset** signal, and on **Respin counter — award** as the feature opens.
     Use a "Plays on signal" cue or a State Machine.
3. **Style it.** Font, size, fill and frame image are the counter's own params. **pulse on a reset
   or "+N"** makes it pop (1 = still).
4. **The modifiers line** is never part of a Respin Counter.
   - On a starter screen it is the **Active modifiers** Text Box (source `activeModifiers`). Style
     it, or delete it to show no modifiers.
   - Without one, place a **Jackpot Tile**, set its source to `activeModifiers`, empty its label as
     above, and set its font size and fill: its default is the large gold jackpot figure.
   - A Jackpot Tile used this way never pulses, and never hears jackpot signals.

The words are set in [Invisible Win Text](win-text.md), under **Respins** (the special names are
under **Hold and Win feature**), and translated from there. The `respinCounterNote` source is
`award`, `reset` or empty, for a look that changes with the beat.

On the Components side, a Respin Counter whose **Counter** part you emptied draws the built-in
look again. Keep at least one node inside the part.

#### Banner screens

Every popup the Hold and Win feature announces over the board ("MINI" and its amount, "BONUS WIN",
"PAYER ACTIVATED", …) can have a screen of its own. Until you add one, the game draws its built-in
banner for that popup, a dark rounded plate with a gold border. A game starts with none, so every
popup looks exactly as the built-in banner draws it. Once a popup's screen is in your layout, that
screen draws the popup, so its art is yours. The words are not authored here: they are the
project's [Win Text](win-text.md) templates, filled in by the game.

**Add one:** in the Screens panel, open **＋ Add screen ▾ → Banner screen ▸** and pick the popup.
It adds that one screen, and only that popup changes. **Add missing screens** never adds banner
screens.

| Screen                      | It shows when                                      | Its lines                    |
| --------------------------- | -------------------------------------------------- | ---------------------------- |
| **Coin jackpot banner**     | the feature's end counts a jackpot coin            | the tier · the amount        |
| **Jackpot upgrade banner**  | an upgrade steps a jackpot coin up a tier          | "MINOR UPGRADE"              |
| **Wheel prize banner**      | the wheel lands on a prize that is not a jackpot   | the prize · what it does     |
| **Row unlocked banner**     | an expanding board opens a row                     | "ROW UNLOCKED" · the rows    |
| **Feature total banner**    | the feature's total, once the coins have landed    | "BONUS WIN $20.00"           |
| **Instant win banner**      | a base-game instant collect                        | "INSTANT WIN" · the amount   |
| **Random metre banner**     | a random metre fires                               | the metre's name             |
| **Pot full banner**         | a pot fills (only where the game has pots)         | "PAYER ACTIVATED"            |
| **Platform jackpot banner** | the casino platform's own jackpot hits             | "GRAND JACKPOT" · the amount |
| **Jackpot win**             | a banked jackpot: full board, letters or the wheel | "GRAND JACKPOT" · the amount |
| **Lucky Spin intro**        | a Lucky Spin starts                                | "LUCKY SPIN"                 |

The first five are feature screens, the next four base-game screens.

**Author one:**

1. Open the screen you added. It starts as a copy of the built-in banner: a **Plate** (the dark
   rounded rectangle) under two text boxes, **Title** and **Detail** (title only where the popup has
   one line). The text boxes read the popup's own lines (live sources `holdAndWinBanner` and
   `holdAndWinBannerDetail`); the text you see in the editor is only a sample. The copy is close
   but not exact: its font is the text box's, not the built-in banner's, and it has no pop-in until
   you give it one (step 3).
2. Drop your art onto the screen, move it under the text boxes in the outline, and delete the
   **Plate** (or recolour it). Restyle the text boxes (font, size, fill) or move them.
3. For an entrance (a pop, a glow), make your banner a component, give it a timeline that **Plays
   on: enter** ([Animate a component](#animate-a-component)), and place it here. It plays each time
   the screen appears. A popup that replaces one of its own kind still up (two jackpot upgrades
   back to back) changes the lines without a new entrance.

The game keeps the screen hidden except while its popup is up, and it is ticked **Always on top**,
so coins flying to the total pass under it as they pass under the built-in banner. You do not need
to wire anything in `/flow-v2`: the game shows these screens itself. If you do show one from a
flow, the flow owns it from then on.

Delete a popup's screen to bring the built-in banner back for it. A new game, or a game kind saved
from a project, starts without banner screens, whatever the project had.

**Jackpot win** and **Lucky Spin intro** are older: they appear only when the flow shows them
around their beat. The Hold and Win starter flow does. A flow scaffolded on the Book-of starter
needs a **Show container** before the beat and a **Hide container** after it. The platform
jackpot uses its own banner screen when it has one, else the **Jackpot win** screen while the flow
shows it.

### The bet menu and the auto spin screens

The two menus the player opens from the HUD — tapping the **bet** readout to change the
stake, and the **auto spin** button to set autoplay up — used to be coded dialogs with no
authoring surface at all. Both are now ordinary screens you build here, and
[Invisible Flow](flow.md) decides **when** each one opens.

**Seed one.** Under the Screens list, **＋ Add screen ▾ → Bet menu screen** creates _Bet Menu_
and **＋ Add screen ▾ → Auto spin screen** creates _Auto Spin_. Each lands in `canvas` space (positioned
against the window edges, so it stays centred on any device) and is tagged with the
matching role. Choosing it again once the screen exists just selects it, so you
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

Open the **Library** tab. At its top, **Search the library…** narrows every section to the
items whose name has all the words you type (an atlas or sheet whose regions are open also matches
by region name, and shows only the matching regions), and the type picker shows one section only.
It is grouped into:

- **Elements** — drag in a **Text** node or a **Rect** fill, click
  **Reel** to insert the board/reel-grid placeholder (one per game; the item
  highlights and re-selects the existing reel if you already have one), or click
  **Repeater** to insert a data-driven list that stamps one component per item of a
  live source (the option grids on the
  [bet menu / auto spin screens](#the-bet-menu-and-the-auto-spin-screens), the
  buy-feature cards). A layout may carry as many repeaters as you like. On the Components side,
  **Repeat (count)** draws one component N times instead — a
  [segmented counter](#segmented-counters--repeat-count) of free spins or respins.
  On a screen (not in the Component Editor), click **Spawn layer** to insert a field that
  [Invisible Flow](./flow.md) fills with components while the game runs — see
  [Spawn layer](#spawn-layer--a-field-flow-fills-while-the-game-runs).
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
  Under the effect picker, **Parameters** lists what the effect exposes (⚡ in
  Invisible FX): a slider and number box for a number, a tick box for an on/off,
  a swatch for a colour. A value you set is this placement's own, and the canvas
  shows it live; **×** puts it back on the effect's default. Inside a component,
  each row also has the **⇡** picker, which hands the value to every placement
  of that component (the Component Editor guide, _Expose a placed effect's
  parameters_ under [Animate it](component-editor.md#7-animate-it-timelines)). A
  **Bind to value** binding or an Animate key on the same parameter wins over the
  value set here.
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

**Fonts** and **Audio** close the list, **read-only**: they show what the project has, but you
don't place them from here. Pick a font in a text node's Properties; sounds are bound in Invisible
Sound, and a timeline cue plays one by name (`sfx:<name>`). Both ship through their own exports.
Audio needs access to Invisible Sound; without it the section says so.

### The shared rig library

Bundles badged **shared** come from `_shared/spines/` — a cross-project library any
project can place from without owning it, the rig twin of `_shared/sheets/`. It
resolves **project-first**: a project bundle of the same name shadows the shared one, so
the library can never override work a project owns. Shared bundles travel the export →
`deploy/` → bake → pull chain exactly like project ones.

It is seeded with the engine's own set — the animation `apps/lines` ships — so a new
project has something to place before it has commissioned anything:

| Bundle                                                                    | Animations                                                                                                  |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `engine-loader`                                                           | `title_screen`                                                                                              |
| `engine-transition`                                                       | `animation`                                                                                                 |
| `engine-bigwin`                                                           | `big_win` / `super_win` / `mega_win` / `epic_win` / `max_win`, each `_intro` `_idle` `_exit`                |
| `engine-anticipation`                                                     | `anticipation[1-4]_intro` `_loop` `_out`, plus `payframe` (the win frame)                                   |
| `engine-reelhouse-glow`                                                   | `reelhouse_glow_start` `_idle` `_exit`                                                                      |
| `engine-foreground` · `engine-foreground-feature`                         | `idle`, `dust`                                                                                              |
| `engine-buy-button`                                                       | `buy_button_default` `_hover` `_click` `_disabled`, `_active_intro` `_idle` `_exit`                         |
| `engine-fs-screen` · `engine-fs-screen-number` · `engine-fs-total-number` | `intro`, `idle`                                                                                             |
| `engine-global-multiplier`                                                | `static`, `increment`, `win`, `reset`                                                                       |
| `engine-cluster-pay`                                                      | `win`, `multiwin`                                                                                           |
| `engine-tumble-win` · `engine-tumble-multiplier`                          | `explosion`, `idle` / `static`, `explosion_mobile`                                                          |
| `engine-win-meter-explosion`                                              | `explosion`                                                                                                 |
| `engine-symbol-h1`…`h5`, `engine-symbol-l1`…`l4`                          | `<id>`, `<id>_static`                                                                                       |
| `engine-symbol-m`                                                         | the multiplier set (`2x`…`10x` × `_land` `_static`, `low`/`mid`/`high_multiplier_*`)                        |
| `engine-symbol-s`                                                         | `scatter_static` `_spin` `_land` `_win`                                                                     |
| `engine-symbol-w`                                                         | `wild_dynamite` `_static` `_land` `_exploded_static`                                                        |
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

**A placed rig sits by its origin.** The node's position is the rig's skeleton
origin, the point it was built around in the [Rigger](/docs/rigger), and the
game rotates and scales the rig about it (the canvas preview does not draw a
rig's rotation; only its box turns). Selecting a rig draws that point as a **⊕**
and frames the box around the rig's **Bounds** wherever it sits relative to the
origin. A rig built far from its origin therefore selects with the ⊕ well away
from the art, or outside the box. Resizing it on the canvas keeps the box's centre
still and moves the origin. To centre the origin for good, open the rig in the
Rigger, press **⊕ Centre origin** and save; copies already placed then draw
centred on their position. A placed rig has no anchor field or anchor presets,
since it is positioned by its origin (a background cover sets its alignment in
the cover section instead).

**A rig that is not playing shows its resting pose**: the animation the game rests it on, held on
its first frame (on its last for a clip that is not looped, which the game plays once and holds).
That animation is the placement's own pick when it has one, then the component param it is bound
to, then the rig node's **Animation**. A rig with no resting animation shows its setup pose, as in
the game. So four placements of one rig, each on its own animation (say a jackpot frame per tier),
look as different here as they do in the game.

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

A click normally selects on the active screen only; the other screens on the canvas are just
backdrop. Turn on **⌖ Any screen** (canvas toolbar) to select anything the canvas draws: a
click takes the topmost item under the pointer, whichever screen it belongs to, and an item on
another screen makes that screen the active one with the item selected, ready to drag. Hovering
such an item outlines it in purple, tagged `Screen › item`. The stacking is the canvas's own:
HUD screens over game screens, and a screen lower in its list over the ones above it. Shift-click
still adds to the selection on the active screen only. When a big item on another screen
covers the one you want, pick it in the outline or hide that screen with its eye. The toggle is
off in Animate and on the Components side, and is kept per project.

#### Rulers and guides

**📏 Rulers** (canvas toolbar) shows rulers on the canvas's top and left edges, labelled in
world (window-frame) pixels at the current zoom and pan. While the rulers are on:

- **Add a guide.** Drag down from the top ruler for a horizontal guide, or right from the left
  ruler for a vertical one. Each guide shows a marker on its ruler.
- **Move a guide.** Drag it on the canvas (the cursor changes over it). Shift-click passes
  through to the object underneath.
- **Remove a guide.** Drop it back on a ruler. It turns red when releasing will remove it.
- **⌗ Snap to guides** makes a moved object's edges and centre snap to the guides, on top of the
  usual snapping to the frame and other objects. Turn it off to keep the guides only as lines.

**📏 Rulers** is off until you turn it on, **⌗ Snap to guides** is on; both are remembered per
browser. Esc cancels a guide drag. Guides are saved with the screen (on
the Components side, with the component) and kept per device layout, so each layout tab has its
own. Adding, moving or removing a guide is an edit: on a screen undo covers it and it autosaves; on
the Components side it marks the component unsaved, like any other change there. Guides can't
be edited in Animate, or on a skinnable part's stage inside a component. They are editor-only and
never reach the game.

Other editing affordances:

- **Undo / redo** — `Ctrl/⌘+Z` / `Shift+Z` (or the ↶ ↷ buttons). Covers every
  edit, including screen-panel operations; rapid edits coalesce into one step.
- **Copy / cut / paste / duplicate** — `Ctrl/⌘+C / X / V / D`. Paste drops into
  the active screen, so it also moves nodes between screens. Clones get fresh
  ids and a small nudge.
- **Delete** removes the whole selection in one step.

### The Outline: lock, isolate, hide, drag, menu

Each row in the Outline (under the active screen in the Screens list, and the **Outline** tab on the
Components side) has hover controls on its right:

- **🔒 Lock.** The stage clicks straight through a locked node to whatever is under it, and it can't
  be dragged (on the stage or in the Outline), nudged or deleted, and nothing can be dropped into
  a locked container. You can still select it from its row (to unlock it, or edit it in
  Properties). Lock applies to children: rows under a locked container show a faint lock. Lock is
  saved with the screen, as the floating toolbar's lock always was. The game ignores it.
- **◎ Isolate.** Shows only this node (its children, and the containers it sits in) on the stage.
  On a screen, the other screens hide too. A banner above the tree has **Exit**, or click ◎ again.
- **👁 Hide.** Hides the node and its children on the stage.

Isolate and Hide are **editor-only**. They are never saved, never exported, and never change what
the game draws. To hide something in the game, use Properties (`visible`, or per-layout
visibility). They reset when you reload the page.

Click **▸ / ▾** to fold a container. **Drag a row** to change the layer order: drop on the top or
bottom edge of a row to land before or after it, or on the middle of a container to move into it
(it becomes the container's last child, drawn on top). A node keeps its own x/y when it changes
container, so it moves with its new container. You can't drop a container into itself, and a node
that fills a template slot or binds an engine component reorders at the top level only (that is
where the editor and the game look it up). Dragging is off in Animate.

**↑ vN** on a placed component's row means the placement is pinned to an older version of its
component, shared or the project's own. The canvas draws the version it pins, which is the one the
game draws, so a component you have edited since keeps its old look on that screen until you select
the placement and use **Update to latest** in Properties.

**Right-click a row** for: Copy, Paste, Delete (on the selection when the row is in it), Lock,
Hide, Isolate, **◇ Create component** (containers; the same as Properties' *Edit as component*) and
**↗ Show in Flow** (named component instances). The Components side offers Delete, Lock, Hide
and Isolate. Animate leaves out the editing items.

### Keyboard shortcuts

Press **Shift+/** (or **?** in the canvas bar) for this sheet over the stage. No stage key fires
while you type in a field. **Enter** and **Tab** belong to the stage only when nothing else has
focus (click the stage first); on a focused button, tile or tab they press it or move focus on.

| Keys | Does |
|---|---|
| `Esc` | Select the parent; on a top-level node, deselect |
| `Enter` | Select the first child |
| `X` | Reveal the selection in the Outline (opens its containers, scrolls to the row) |
| `F` | Fit the frame |
| `Ctrl/⌘+0` | Zoom to 100% |
| `+` / `-` | Zoom in / out (the canvas bar also has − / % / + and **Fit**; click the % for 100%) |
| Arrows | Nudge the selected top-level nodes 1 px; `Shift` = 10 px (Design only) |
| `Tab` | Toggle Design / Animate |
| `Shift+/` | The shortcut sheet |
| `Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z` | Undo, redo (Screens, Design) |
| `Ctrl/⌘+C / X / V / D` | Copy, cut, paste, duplicate (Screens, Design) |
| `Delete` | Delete the selection (locked nodes stay) |

The stage is tinted blue with a blue edge in **Animate**, so the two modes never look alike.

### 4. Edit properties

The right-hand **Properties** panel edits the selected node — its transform
(`x/y`, anchor (not on a rig), scale, rotation, alpha, zIndex, tint, blend), text content/style for
text nodes, rig animation/skin for rig nodes (driven by dropdowns when the
canvas can read the bundle's animations), background cover (fit / zoom /
alignment) for cover nodes, and the slot the node fills (when a template is loaded). It also offers
node actions such as **Convert to reel grid**, **Convert to parametric button**,
and **Edit as component** (save a container as a new component and open it on the
[Components side](#the-components-side)). A placed component instance gets **◇ Edit component in
place** instead.

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

**Bind to value**, near the bottom of Properties (above **Element FX**), makes an item follow a
live game number. It can
move, scale, rotate, fade or show the item, fill a sprite / flipbook / rect from one edge, hold
a flipbook frame, scrub a rig animation, offset a rig bone, or set one of a placed effect's
**exposed parameters** (**⚡ intensity** in **drives** — see below). On a screen the number is an
engine value: respins left (÷ the cap), cells held, rows open, collector level, letters lit, the
feature's worth (`featureWorth`), the jackpots, bet, win and the rest. Drag the binding's **test value** to preview it on the canvas;
it is never saved. Selection handles and dragging keep the authored position.

On an **effect**, **drives** lists the effect's number and on/off parameters (the ones made with
⚡ in [Invisible FX](fx.md#exposed-parameters)) as **⚡ <name>**. A number parameter's **out**
range is left blank, so it follows the parameter's own min and max (shown greyed), even after
they change in /fx; type ends to map elsewhere. An on/off one is on while the number passes a
**threshold**, like **Show / hide**. Dragging the test value moves the live particles on the
stage, with no restart. A colour parameter cannot be bound yet. A binding naming a parameter the
effect no longer has says *Does nothing* and is ignored in the game.

The same section in the Component Editor can also read the component's own params and the pot
of the instance it sits in. The full reference is in the Component Editor guide under
[Bind to value](component-editor.md#3b-drive-a-node-from-a-number-bind-to-value).

#### Element FX — effects that play on an element

An **Element FX** plays on the element itself: it moves, bends, lights or breaks the element's own
pixels (a shake, a 3D flip, a wave, a glow, a crumble). An [Invisible FX](fx.md) particle effect is
something else, a node of its own placed beside the element that adds particles, and the Flow's
`cameraEffect` moves the whole game. A placed particle effect node can carry Element FX like any
other node.

**Where it is.** Every selected node has an **Element FX** section at the bottom of Properties,
whatever its kind (image, rig, flipbook, effect, text, rect, group, component placement), on a
screen and inside a component. On the **reel grid** node the effects play on the real reels in the
game. The **Screen** block at the top of Properties has its own **Element FX** section, under the
screen's ticks; those play on everything the screen draws. A node's effects play in every device
layout; they are never a per-layout override. While you Inspect an old version of a component the
section is read-only, and ▶ still plays.

**Add one.** With none yet, the section shows a one-line hint and the **+ Add effect…** picker,
which lists the 50 effects grouped by family (the table below), then the project's own under
**Custom (Shader Graph)** (`custom:<id>`, authored in [Invisible Shader Graph](shader-graph.md)).
A row whose custom effect was deleted or no longer compiles says so. Picking one adds a row, opens it,
and gives it the trigger that suits it: a loop effect starts as _Always_, an entrance as _When
shown_, anything else as _On cue_.

**Each row** shows, left to right:

- a **tick box**: untick it to switch the effect off without deleting it. It never plays, and the
  row dims.
- the effect's **name** and family, with when it plays under it (`always, looping`, `when shown`,
  `on cue bigWin`, `on cue (none yet)`, `keyed on a timeline`, plus `×3` or `until stopped`).
  Click it to open or fold the row.
- **▶** previews it on the stage (see _Preview on the stage_ below).
- **▲ / ▼** reorder the rows (higher plays earlier), and **✕** removes it.

A row reading `⚠ <name>` is an effect this build cannot read or play (one saved by a newer build,
say). It is kept as saved; you can only move or remove it.

An open row has, top to bottom:

- **Kind**: switch to another effect. Parameters the new one also has keep their values; the rest
  go. Under it, the effect's one-line description.
- **Trigger**: when it plays (the table below).
- **Cue** (_On cue_ only): the cue that plays it, typed as free text. It suggests the component's
  signals and the game's own, like the
  [Plays on signal](#plays-on-signal--a-rig-or-flipbook-that-changes-what-it-plays) field. Until
  it has one, the row says it does nothing yet.
- **Stop cue**: optional, on any trigger. A cue that stops the effect and puts the element back at
  rest. It stays stopped until it would start again: its cue fires again, or the element is shown
  again.
- **Duration ms**: one play. Blank plays the effect's own length, shown greyed in the box.
- **Delay ms** (not on _Keyed_): a wait before it starts. An entrance effect keeps the element
  hidden while it waits.
- **Intensity**: a slider and a box from 0 to 4; 1 is the effect's reference strength. **×** puts
  it back to 1.
- **Plays (0 = until stopped)** (_When shown_ and _On cue_ only): how many times it plays. Blank
  plays it once.
- **Parameters**: the effect's own knobs. A number is a slider and a box (with its unit, or a note
  on what it is measured in, such as _In element heights_), a colour is a swatch, an on/off a tick
  box, a choice a dropdown. **×** puts one back on its default.

**The four triggers**, and what each does in the game:

| Trigger                        | In the game                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Always (loops while shown)** | Loops for as long as the element is on screen. Built for the _loop_ effects below.                                                              |
| **When shown**                 | Plays when the element appears, each time it is shown (a screen the Flow shows again, a node made visible again).                               |
| **On cue**                     | Plays each time its **Cue** fires: a Flow `fireCue`, a game or component signal, a cue its component's own timeline or state machine raises, or a `signal:` cue on a timeline of its screen ([below](#report-events-visibility-and-text)). |
| **Keyed on a timeline**        | Never plays on its own. A timeline poses it, so a state-machine state can too ([below](#keyed-element-fx-on-the-timeline)). Nodes only.        |

An _On cue_ effect fired again restarts. Its cue (and any stop cue) shows in Invisible Flow's
**Cues** palette, ready to drag out.

Several effects on one element play together. A loop effect given a play count (_When shown_ or
_On cue_) fades in and out. An **exit** effect ends with the element hidden and keeps it hidden
until its stop cue fires or an entrance effect plays on it; its row says so. **Crash**,
**Crumble**, **Shatter (glass)**, **Crystallize (ice shards)** and **Dissolve to particles** work
on a still of the element taken as they start, so an animating rig holds still while they play.
**Assemble from particles** plays on the live element: its specks are drawn from the element every
frame and fly in to wherever it is and however big it is now, so a timeline that moves or zooms it
keeps playing under them. If there is nothing to draw yet when the cue fires (no size, as in a zoom
from nothing, or hidden), the specks wait, the element hidden, until there is.

> **The reels of the base game:** an effect on the base game's **Screen** block plays on the base
> game's art in front of and behind the reels, not on the reels. To play one on the reels (say, the
> reels assembling as an intro zooms them in), put it on the **Reel grid** node.

To fire a one-off effect on any element from a flow, with nothing authored here, use the Flow's
`elementEffect`: see [Element FX in the Flow guide](flow.md#element-fx-effects-on-one-element).

**Preview on the stage (▶).** The canvas does not play Element FX by itself (an _Always_ loop does
not run on the stage), so ▶ is how you see one. It plays that one effect, with the game's own code,
on a copy of the element: the canvas shows the element alone for a moment (the stage holds its
picture meanwhile, so nothing blinks), copies it (with a margin, so a glow it draws past its box
comes along), hides the real element and plays the effect on the copy. A screen's ▶ copies the
whole frame, and keeps copying it every frame while the effect plays, so a timeline playing on the
screen keeps moving under the effect. One preview plays at a time, a second ▶ replaces it, and
nothing is saved.

- _Always_ loops twice. _When shown_ and _On cue_ play their **Plays** count, three times at most
  (_until stopped_ plays three). _Keyed_ plays once from rest to its end, with no delay. The last
  frame holds for a moment, so an exit effect's hidden end shows.
- A **node's** copy is taken once. It moves, scales and turns with the node while a timeline plays,
  but what the node shows holds still: an animating rig or clip freezes for the preview. A **HUD
  screen's** copy is taken once too. In the game the effect plays on the live element.
- **Esc**, a press on the stage, the mouse wheel, a pan, a zoom or a switch of device layout stops
  it. Esc only stops the preview: the selection stays.
- Only what the visible stage shows is copied. When there is nothing to play on (the element's
  screen is hidden, the element or a container above it is hidden, or it is off the visible stage),
  the row says _Nothing on the stage to play it on: show the element and its screen first._

**The 50 effects.** _loop_ = built to repeat, the natural pick for _Always_; _entrance_ = starts
hidden and ends at rest; _exit_ = ends hidden. The rest play once and return to rest.

| Family         | Effect                     | What it does                                                                     |
| -------------- | -------------------------- | -------------------------------------------------------------------------------- |
| Motion         | **Shake**                  | A decaying rattle.                                                               |
|                | **Wobble**                 | Rocks left and right around its centre, settling.                                |
|                | **Pulse**                  | Swells and shrinks back once.                                                    |
|                | **Heartbeat**              | Two quick beats, the second softer.                                              |
|                | **Jelly**                  | Squashes and stretches on its base like jelly.                                   |
|                | **Bounce**                 | Hops up and lands with a squash, each bounce lower.                              |
|                | **Spin**                   | Turns on itself in the screen plane.                                             |
|                | **Swing**                  | Swings like a sign hanging from its top edge.                                    |
|                | **Float** (loop)           | Hovers gently up and down.                                                       |
|                | **Pop in** (entrance)      | Grows from nothing with an overshoot.                                            |
|                | **Pop out** (exit)         | Swells, then shrinks away to nothing.                                            |
|                | **Slam in** (entrance)     | Drops in from above and lands hard: squash and a rattle.                         |
|                | **Fade in** (entrance)     | Fades up from invisible.                                                         |
|                | **Fade out** (exit)        | Fades away and stays hidden.                                                     |
| 3D             | **Flip (3D, sideways)**    | Flips on itself around its vertical axis, like a coin.                           |
|                | **Flip (3D, over)**        | Flips on itself around its horizontal axis, top over bottom.                     |
|                | **Bounce 3D**              | Jumps out of the screen at you, tilting, and settles back with a bounce.         |
|                | **Sphericon**              | Folds into a spinning sphericon wrapped in its own art, rolls, and unfolds back. |
|                | **Tilt 3D** (loop)         | Sways in perspective, as if held up and turned in the light.                     |
| Distort        | **Wave (X)** (loop)        | Rows slide left and right in a travelling wave.                                  |
|                | **Wave (Y)** (loop)        | Columns slide up and down in a travelling wave.                                  |
|                | **Flag** (loop)            | Ripples like a flag pinned at its left edge, with light on the folds.            |
|                | **Twist**                  | Swirls around its centre and unwinds.                                            |
|                | **Curl**                   | A corner curls up like a page and lays back down.                                |
|                | **Ripple**                 | A shock ring spreads out from the centre.                                        |
|                | **Bulge**                  | Puffs out from the centre like a lens, then flattens (negative pinches in).      |
|                | **Melt** (exit)            | Melts like wax: the top sinks and the rest runs down in uneven **Drips**, as far as **Drip length** (in element heights), then it fades away. **Heat** makes the running part glow in the **Heat colour**. |
| Light & colour | **Glow** (loop)            | A coloured glow around the edges that breathes in and out.                       |
|                | **Outline** (loop)         | A coloured outline that pulses.                                                  |
|                | **Shine**                  | A bright band sweeps across, only where the element is.                          |
|                | **Flash**                  | Lights up in a colour and fades back.                                            |
|                | **Rainbow** (loop)         | Cycles its colours round the rainbow.                                            |
|                | **Chromatic**              | Splits into red, green and blue that wobble back together.                       |
|                | **Glitch**                 | Slices jump sideways and the colours tear.                                       |
|                | **Blur**                   | Blurs out of focus and back.                                                     |
|                | **Pixelate**               | Breaks into big pixels and resolves back.                                        |
|                | **Freeze (ice)**           | Freezes into ice: frost creeps over it along the **Crystals** from the **Frost from** side, it turns to ice in the **Ice colour** (the art still reads underneath), holds frozen for **Hold** of the play with a glint sweeping across, then thaws back. To keep it frozen, key it (_Keyed_) and hold its progress at the middle. |
|                | **Burn to ashes** (exit)   | Catches fire: a ragged front of flame (**Flame colour**, how ragged: **Ragged**) sweeps across from the **Burns from** side, scorching the element brown ahead of it and leaving grey ash (**Ash colour**) with cooling embers that lifts and crumbles away, **Sparks** rising. |
|                | **Poison** (loop)          | Poisoned: it drains to a sickly green in the **Venom colour**, dark **Veins** creep in from its edges and pulse, **Bubbles** rise through it, and it sways queasily. Loops while _Always_ (or while a symbol is in its state); a counted play seeps in and recovers. |
|                | **Electrocute**            | Electrocuted: jagged **Arcs** in the **Arc colour** crackle across it (re-striking many times a second), its outline glows, it **Flicker**s to a scorched negative and jitters, then lets go. |
|                | **Petrify (stone)**        | Turns to stone: grey granite (**Stone colour**, how fine: **Grain**) creeps over it from the **Stone from** side behind a pale dusty front, cracked and carved in relief (the art's outline and its light and dark read as a carving), it locks with a thud, holds as stone for **Hold** of the play, then every crack opens and it flakes off a chip at a time. To keep it stone, key it (_Keyed_) and hold its progress at the middle. |
|                | **Turn to gold**           | Turns to gold: polished gold in the **Gold colour** spreads from the **Gold from** side (the centre by default, as if touched) behind a molten front, its own detail embossed and mirror-lit, it swells a little as it rings, holds gold for **Hold** of the play with a glint sweeping across and **Sparkles** twinkling, then draws back. To keep it gold, key it (_Keyed_) and hold its progress at the middle. |
|                | **Dissolve out** (exit)    | Burns away in a noisy dissolve with a glowing edge.                              |
|                | **Dissolve in** (entrance) | Burns into view in a noisy dissolve with a glowing edge.                         |
| Break          | **Crash** (exit)           | Takes a hit, then smashes into shards that fly apart and fall.                   |
|                | **Crumble** (exit)         | Falls apart into chunks that drop away, bottom first.                            |
|                | **Shatter (glass)** (exit) | Breaks like a pane of glass: cracks race out from the **Impact** point over the first part of the play (**Cracking**), then it falls apart in spiderweb **Shards** that tumble and drop, those by the impact first. |
|                | **Crystallize (ice shards)** (exit) | Crystallizes into ice: crystal facets in the **Ice colour** ice over one by one from the **Ice from** side (the centre by default), each flashing white as it snaps in; it holds as ice with its seams traced and points twinkling, creaks, and at **Crystallizing** of the play bursts into its **Shards**, which fly out, tumble, glint as they turn and fall (**Gravity**). |
|                | **Dissolve to particles** (exit) | Turns to dust: specks peel away in a ragged front, starting on the side the **Wind** blows to, and blow off on it, swaying (**Turbulence**) and shrinking to nothing. **Particles** sets how many. |
|                | **Assemble from particles** (entrance) | Dissolve to particles backwards: specks blow in from the **From** side, swaying and growing as they arrive, and settle into the element, the far side first. |

#### Background — how a full-bleed cover is fitted, zoomed and aligned

Select a node that covers the window — an image, rig, clip, component or Rect on a
`background` screen, or a sprite / rig / clip with **Fill → Cover / full-screen fill** ticked
on a `canvas` screen — and the Properties panel shows a **Background** section. A Rect covers
by its own **width × height**: any size fills the window on `cover`, and its shape only matters
for `contain` or a per-axis fit. A Rect inside a group is not a cover: it stays draggable at
its placed box. The node stops being
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

#### Spawn layer — a field Flow fills while the game runs

A **Spawn layer** holds component instances that a flow creates and removes during play: enemies,
coins, falling stars. Insert one from **Library → Elements → Spawn layer**; it lands at the centre
of the active screen. Position it with **Transform** like any node. The editor runs no flow, so the
canvas draws the field, not the instances: a grid layer draws its cells with a dot on each spawn
point, a free layer a dashed box. The label reads `⊕ <name> · N spawnable · cap N`.

Its Properties block:

- **spawnable** — the components Flow may spawn here. Pick one in **add component**; reorder with
  **↑** / **↓**, remove with **×**. A component that is no longer in the project reads
  **(missing)**. These are the components shipped with the game, even when no screen places one,
  so list every component the flow spawns: one it spawns but this list leaves out does not ship.
- **placement** — **free** (a spawn names a point x / y in the layer's space) or **grid** (a spawn
  names a cell col / row, or a point). Grid shows **cols**, **rows** and **pitch** (px between
  cells, starting at 6 × 4 at 120). Cell (0, 0) sits at the layer's origin. Until cols and rows are
  whole and pitch is above 0, the layer places freely.
- **cap** — the most instances alive at once, 1 to 256; blank means 32. A spawn over the cap is
  dropped.

In an arcade game the game moves the instances: the play field is the layer's space from its
origin (0, 0 is the top-left corner), and an instance's position is its centre.

How Flow spawns into the layer: [Spawning](./flow.md#spawning--create-and-remove-components-in-play).
The engine design is in [game families §3.3](../design/game-families.md).

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

### Game Settings → Authored overlays (pilot)

Above the boot splash, **Authored overlays (pilot)** has four rows, **Transition**, **Win**,
**Free spins** and **Buttons**. All are pilots: off — the default, and the state of every live game — nothing
changes. Only a holder of the component-publish capability (admin by default) can switch one;
others see a row
read-only while it is on, and a save that flips one from anyone else is refused (a stale tab still
gets the ordinary "someone else saved" conflict first). Every row is **off by default**: switch
one on for a test project first, then live games one at a time. The Game Maker card names each when on.

- **Transition** — the game renders the free-spin transition wipe from the built-in **Transition
  wipe** component and its timeline (the same rig, the same timing; the flow continues when the
  wipe ends) instead of the coded Transition mount it replaces. The card says _Authored Transition
  (pilot)_, and warns when it is on but no scene binds the coded Transition it would replace (the
  reference overlays scene has that node).
- **Win** — the game renders the big-win presentation (the tier rig and its per-tier clips, the
  count riding the rig's count slot, the caption, the plain small/medium number, the fade) from
  the built-in **Win presentation** component and per-tier timelines generated at boot from the
  game's active big tiers, instead of the coded `WinVisual`; the coded gate keeps the count-up,
  the round hold, the presses and the dim. Nothing to place: a doc that binds the coded Win
  overlay gets the presentation at the board centre; a doc that places the hybrid **Win overlay**
  instance keeps its position, overrides and params. The card says _Authored Win (pilot)_, and the
  game keeps the coded path (the card warns) when no scene binds a coded Win or places a win
  instance, when a big-win tier's caption in Invisible Win Text (in the base game or any spins
  mode) uses a token such as `{amount}`,
  or when the tiers resolve to more than one rig or count slot.
- **Free spins** — the game renders the free-spin intro and outro visuals (the frame, the count rig and number, the localized captions, the fade)
  from the built-in **Free-spin intro / outro presentation** components and their timelines,
  instead of the coded intro and outro visuals. What holds the round does not change: the outro's
  count-up, its tap to skip, the screens' "press anywhere to continue" and the flow's holds stay
  as they are. Nothing to place: each screen's coded visual is swapped where it sits. The card says
  _Authored free spins (pilot)_, and the game keeps the coded visuals for both screens (the card
  warns) when no screen binds a coded free-spin visual, when one sits in a screen that is not
  canvas space, when a screen places a free-spin visual instance, or when a visual names a rig,
  clip or slot other than the default.
- **Buttons** — every parametric HUD button (a placed **Button** component) draws its
  look per state — the tile, its greyed downstate and selected border, or its state images — turns
  its spin image while a spin rolls, and plays its press sound from the built-in **Button
  presentation** component and its state machine, instead of the coded button frame. What a press
  does, and when a button is disabled, selected or spinning, does not change. The buttons still
  fade with the rest of the HUD when the game hides it. Nothing to place: each Button is swapped
  where it sits, with its own settings. The card says _Authored buttons (pilot)_, and the game
  keeps the coded buttons (the card warns) when no screen places a Button component (the coded
  buttons of the default HUD are not affected) or when the project's own Button component draws
  something else.

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

### Animate mode — the Timeline

The **Design | Animate** toggle in the editor bar switches what the editor is for. **Design** is
everything above. **Animate** opens the **Timeline** panel under the canvas, for the screen that is
active in the Screens list. It animates that screen's nodes, for example a screen intro, and Flow
plays the result in the game. A component has its own Animate mode on the Components side: see
[Animate a component](#animate-a-component).

1. **Open or create a timeline.** In Animate the left column shows an **Animations** list with
   this screen's timelines (each with its length); click one to open it. The Timeline panel's
   header does the same: its picker opens a timeline and **＋ New** creates one (with **Rename** and
   **🗑** for the open one). **＋** asks for a name and saves an empty one. Hover a row for **⧉ Duplicate**
   (a copy named "<name> copy", saved and opened), **✎ Rename** and **🗑 Delete**. Rename and
   Delete open that timeline first, and every one of the three asks about unsaved changes on the
   open timeline first. Switching to
   another screen saves it and closes it, because a timeline belongs to one screen. Switching back
   to Design keeps it open with any unsaved changes, and closing the tab with unsaved timeline
   changes asks first.
2. **Select a node on the canvas.** Dropping from the Library, Delete and the item toolbar are
   off in Animate, so you can't change the layout by accident. Dragging, the corner handles and
   the rotate circle **key** instead (step 3).
3. **Key it.** In Animate, **Properties** shows an **Animate** section above Transform with what
   the node can take: **x**, **y**, **scale ×**, **rotation**, **alpha**, plus **tint** on sprites
   and flipbooks, on an **effect** one **⚡ <name>** field per number or on/off parameter it
   exposes, and on any node two **✦** fields per _Keyed_ Element FX entry
   ([below](#keyed-element-fx-on-the-timeline)). Each field has a **key button** (◆), as in Rive:
   - **grey outline**: not animated;
   - **blue outline**: animated, no key at the playhead;
   - **blue**: a key at the playhead.

   Click it to key the current value at the playhead, or type a value to key it. The fields show
   the **animated** value (the Design pose with the timeline on top), and a typed value is turned
   back into the relative key for you. Transform underneath still edits the Design pose.
   **On the stage**, dragging a node keys its x/y at the playhead, a corner keys its scale and the
   circle keys its rotation, each on top of what the timeline already does there; the handles sit
   on the animated pose, and snapping is off. A scale drag is always uniform in Animate (one
   **scale ×** key), even from an edge handle or with Shift. A text box resizes its box in Design
   only, so in Animate its corners and edges do nothing (it still moves and turns). The first key on a node adds it to the timeline.
4. **Preview.** Drag the ruler, or press **▶**. The canvas draws each frame through the game's own
   maths, so what you see is what plays. The number next to the time readout is the timeline's
   length in seconds.
5. **Save** (or Ctrl+S). Timelines save to the project like the Rigger's cinematics. If someone
   else saved the same timeline first you get **Reload theirs / Overwrite with mine**, the same as
   the layout.
6. **Play it in the game.** In `/flow-v2`, add a **playCinematic** node. Its picker lists this
   screen's timelines as **Timeline · <screen> · <name>**, ahead of the Rigger's cinematics. Turn on
   **Wait for it to finish** to hold the flow until the intro ends. If the timeline names a node the
   screen no longer has, the node shows a ⚠ warning under the picker. Publish as usual: timelines
   ship with the game like cinematics.
   - **Show the screen first, then play its timeline**: Show `<screen>` → playCinematic. The
     timeline then moves the screen the Show put up, which holds the last frame until it is hidden.
     For an intro that waits for a tap, follow it with a Show of the same screen with **Hold until
     this screen completes (tap)** ticked. The add-on's **Pots** screen counts as shown without a
     Show node: when the flow never shows it, the game puts it up with the board, and a timeline on
     it moves those pots and holds its last frame while the board is up (while the board is
     hidden, the timeline draws nothing). A timeline played while
     its screen is not shown draws its own copy of the screen instead, and that copy is not framed
     like the screen. Starting the
     timeline re-opens the shown screen, so set a component's inputs on it after the play, not
     between the Show and the play.
   - **The base game** works the same way: Show it, then play its timeline. Keys on the **reel
     grid** move the reels themselves: x/y, scale ×, rotation, alpha and visibility, about the
     grid's position, as the canvas previews them (tint does not apply to the reels). Where the
     timeline leaves the grid is where the reels stay: once it ends, the game lays the board out
     there, so the win line, symbol flights, the bonus board and anything else placed from the
     board follow the reels, until the base game is hidden or the timeline plays again. That
     takes an even, positive scale: an end pose scaled differently in x and y, to nothing or
     flipped stays on the reels' drawing only, and the win line keeps the grid's Design pose. A
     turn always stays on the drawing: the win line follows the move and scale, not the turn. A
     node hidden by a visibility key stays hidden while the base game is up, because the screen
     holds the last frame; key it visible again at the end if it should come back.
   - **A timeline reaches the game only once it keys a node and is saved.** One that never did
     (or was deleted) is skipped: the flow carries on, and the browser console says which.

How keys behave:

- **Keys are relative to the Design pose.** x/y add to the node's position, scale and alpha
  multiply, rotation adds degrees, and tint replaces the colour. A key of 0 on y means "where you
  laid it out". End an intro on the unchanged pose (x/y 0, scale 1, alpha 1, white tint), so that
  when the timeline ends the screen sits exactly as designed.
- **An effect parameter key is the value itself**, not an offset: ⚡ intensity 0.8 means the
  parameter is 0.8. A number interpolates between keys; an on/off key is stepped (**hold**), so it
  switches on its key. Where nothing keys a parameter it keeps its default, or what a **Bind to
  value** on the node sets. When both set it, the timeline wins while it has a value. A colour
  parameter has no row yet. Keys on a parameter the effect no longer has (renamed or removed in
  /fx) stay on the timeline as a grey **⚠ fx:<name>** row, so you can select and delete them; the
  ⚠ issues pill of a component timeline lists them too.
- **A timeline finds a node by its name.** That is what lets the same timeline play on another
  screen that has a node with the same name. So a node needs a **Name** (Properties) that no other
  node on the screen shares before you can key it. The panel says so when it doesn't, and never
  falls back to the hidden id.
- **Properties' Transform still edits the Design pose.** Only the **Animate** section above it
  keys.

**Keys per screen ratio.** Each screen ratio lays the nodes out on its own (see
[Author across device layouts](#5-author-across-device-layouts)), so a move that fits Desktop can
overshoot on Portrait. On a ratio other than the base one, the panel header says which keys you
are editing:
- **Default keys**: this ratio plays the same keys as every ratio without keys of its own, and
  an edit here changes all of them. **Key <ratio> separately** copies those keys to this ratio, so
  from then on an edit here changes this ratio alone. It needs something keyed first.
- **<ratio> keys**: this ratio plays its own keys, and only those: a node keyed in the default
  keys but not here does not move in this ratio. **Use default keys** deletes this ratio's keys
  (after asking), and it plays the default keys again. So does deleting this ratio's last key: the
  header then says **Default keys** again, and the next edit changes every ratio without keys of
  its own.

The base ratio's keys are the default keys. The game picks the keys of the ratio on screen, and
switches if the player turns the device, also while a finished timeline holds its last frame.
Only the field keys (x, y, scale, rotation, alpha, tint, ⚡ parameters and ✦ Element FX) are per
ratio:
visibility, text and cue keys and rig strips are shared by every ratio. Component timelines play
their keys in every ratio.

**The timeline.** Each keyed node has a **summary row** (its name) with a grey diamond at every
time any of its fields is keyed, and **▾ / ▸** folds its field rows away. Drag a summary diamond
to move every key of that node at that time; drag the summary row's empty lane to move all of
that node's keys. **Only selected** in the panel header shows just the node selected on the
canvas.

**Several keys at once.** Shift- or Ctrl-click diamonds to add them to the selection, or drag a
box over an empty part of the field rows (Shift adds to what is selected; a click there clears
it). A selected key's drag moves all of them by the same amount. **Ctrl+C** copies the selected
keys and **Ctrl+V** pastes them onto the same fields with the earliest at the playhead (a key
already at a pasted time is replaced). **Delete** removes them all. ⌘ works as Ctrl on a Mac.

**The same animation on another node.** Select the keys of one node (drag a box over its field rows,
or Shift-click its diamonds), press **Ctrl+C**, click the other node on the stage, put the
playhead where the animation should start, and press **Ctrl+V**. The keys land on the other node's
same fields (y on y, scale on scale), timed from the playhead, and the node gets its rows if it had
none. A field that node cannot key is skipped (a reel grid has no tint). The keys go into the ratio
you are editing, like any key. With the copied node itself still selected, or nothing selected,
Ctrl+V pastes back onto the copied fields as before. Keys copied from two nodes at once always
paste back onto their own fields.

Another way to move several nodes together: put them in one group and key the group. This does
not work for the **reel grid**: the game reads the reel grid only as a top-level node of its
screen, so keep it out of groups and paste its keys onto the other nodes instead.

**Interpolation.** With keys selected, the right of the panel is the **Interpolation** panel: how
the value travels from each selected key to the next one.
- **Linear**: a straight line.
- **Cubic**: a curve. Drag its two handles, or type the four numbers `x1, y1, x2, y2` (a CSS
  cubic-bezier: x stays between 0 and 1; y may go past to overshoot).
- **Hold**: the value holds until the next key (stepped).
- **Elastic**: shoots past the next key by about a third and springs back onto it, like a pop.
- **Bounce**: lands on the next key and bounces a few times, never going past it, like a gem
  dropping into place.

**Set as default** makes the selected key's interpolation the one every new key in this timeline
gets; with nothing selected the panel shows and edits that default. An older timeline's *ease in-out*
keys show as Cubic `0.333, 0, 0.667, 1`, which is the same curve.

**Loop type and fps.** Next to the length in the header: **One-shot** (plays once and holds its last
frame, the default), **Loop** (back to the start) or **Ping-pong** (to the end and back). ▶ plays it
the same way; Loop and Ping-pong play until you pause. In the game, a looping timeline never ends,
so it never holds a cue, a Flow **playCinematic** that waits for it carries on at once (as it does
for the node's own loop), and a ping-pong fires its cues on the way out only. **fps** is the grid
keys snap to and `,` / `.` step by.

**Onion skin.** Tick **Onion** in the header and the stage outlines each keyed node a few frames
before (red) and after (green) the playhead, with a dot at its pivot, fading with distance. The
number next to it is how many frames on each side (1 to 10). Editor-only, never saved; it outlines
the screen's top-level nodes.

Keyboard in Animate mode: the Timeline owns **Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y** (undo and redo the
timeline), **Ctrl+S** (save the timeline), **Ctrl+D** (duplicate the selected strip), **Ctrl+C /
Ctrl+V** (the selected keys), **Delete / Backspace** (delete the selected keys), **, / .** (a frame
back / forward; with Shift, ten) and **Space** (play / pause). The layout's own undo,
copy/cut/paste/duplicate and delete are off until you switch back to Design. Esc still clears the
selection, and typing in a field is never intercepted.

Who can do this: anyone with the Scene Editor can open, save and delete **screen** and
**component** timelines. The Rigger's cinematics stay with the Rigger.

#### Report events, visibility and text

Three more kinds of row sit in the timeline's track area, under the keyed node's field rows:

- **⚡ Report event.** The button above the tracks drops a **cue** at the playhead, named
  `signal:…`, and selects it so you can type the rest of the name in the inspector on the right
  (or pick an effect there for an `fx:` cue, or type `sfx:` / `music:` for a sound). In the game a
  cue fires when the playhead passes it: on a component, a `signal:` cue is a signal its instance
  hears (another of its timelines can play on it); Flow can react to it too. Scrubbing never fires
  cues. All cues share one **⚡ cues** row; drag a marker to move it.
  - **Cues and Element FX.** On a **screen** timeline, a `signal:NAME` cue plays every
    [Element FX](#element-fx--effects-that-play-on-an-element) whose trigger is _On cue_ with the
    cue `NAME`, as a Flow `fireCue` named `NAME` would: the screen's own entries, its nodes', and
    any others on screen. Write the cue with `signal:` and the Element FX's **Cue** without it
    (`signal:FX_Intro` ↔ `FX_Intro`). A cue without a prefix, or an `fx:` / `sfx:` / `music:`
    one, does not reach Element FX. The cue inspector lists the screen's _On cue_ Element FX under
    **Element FX (On cue)** in its picker, and its note names them; pick one to set the cue.
  - **▶ in Animate** plays those Element FX when the playhead passes the cue, the way **▶** on an
    Element FX row does: on the live screen for the screen's own, and on a copy of the node that
    follows the timeline for a node's. Scrubbing plays nothing, as in the game. The
    preview plays one effect at a time, so when a cue reaches several (the screen's and a node's)
    you see the last one; the game plays them all. Element FX inside a placed component's own parts
    hear the cue in the game but are not previewed here, and a stop cue is not previewed.
- **Visible.** With a node selected, the left column has **👁 Show** and **Hide**: each keys the
  node shown or hidden from the playhead (stepped, no fade). The keys draw on a **↳ visible** row:
  a filled marker means shown from there, a hollow one hidden. Click one to select it (it outlines
  in yellow) and press **Delete** to remove it, as with a key diamond; drag to move, or
  double-click to delete.
- **Text.** On a text node, pick **Count up** (a number, eased between keys) or **Switch** (one of
  the node's own strings: its text and its *switch keys*), then key a value at the playhead. The
  keys draw on a **↳ text** row with what they show; drag to move, double-click to delete. The
  canvas shows the text the game would. Switching between Count up and Switch removes the other
  kind's keys (it asks first).

#### Keyed Element FX on the timeline

An [Element FX](#element-fx--effects-that-play-on-an-element) entry set to **Keyed on a timeline**
has no clock of its own: the timeline says how far through the effect it is at every moment, so
scrubbing the timeline scrubs the effect.

- **Two ✦ rows per entry.** Each enabled _Keyed_ entry on the selected node adds two fields, each
  with its ◆, to Properties' **Animate** section, and two green rows under the node in the
  Timeline. A key is the value itself, not an offset, and a typed value outside the range is
  clamped. As for any key, the node needs a **Name** no other node on the screen shares.
  - `✦ <effect> (<entry id>)`, e.g. `✦ Shake (efx1)`: how far through the effect, from 0 (at
    rest) to 1 (its end). With no keys it rests at 0.
  - `✦ <effect> strength`: a multiplier of the entry's **Intensity**, from 0 to 4 (1 = as set).
    With no keys it rests at 1. When two keyed entries share an effect, this row names its entry
    too.
- **Stale rows.** Keys on an entry that is no longer _Keyed_ (removed, switched off or given
  another trigger) stay on the timeline as a grey `⚠ efx:<id>` (or `⚠ efx:<id>:intensity`) row,
  so you can select and delete them. The ⚠ issues pill of a component timeline lists them too.
- **On the stage.** While a timeline is open in Animate (scrubbed or playing), and while the State
  machine tab's **▶ Run** previews a state, the stage poses each keyed effect. The first time the
  timeline takes a node past rest, the canvas cuts a still of it (as ▶ does, the stage holding its
  picture for that moment) and draws the effect on it at the keyed pose, following the node as the
  timeline moves, scales or turns it. The real node hides only while an effect is past rest, and
  stays selectable: a click, a drag and the selection frame land where it draws.
  - Editing the entry (its settings, strength or params) re-poses it on the same still at once.
  - Changing the node's art, panning a still that was cut at the stage's edge, or zooming in past
    the still's sharpness cuts a new still once you stop for a moment; the old one shows meanwhile.
- **In a state machine.** A state plays its timeline, so it poses the node's keyed effects, and a
  transition's **Blend** mixes them from the state being left. A state whose timeline does not key
  an entry counts as at rest (progress 0, strength 1).

#### Shared timelines and starters

**📚 Shared** above the tracks lists the **shared timeline library**: timelines any project can
use, plus built-in **starters** (✦ Fade in, Fade out, Pop in, Slide up in, Pulse). **Place** puts
one on this screen or component as a **link**: it asks which node each of its parts animates
(a starter animates one node, "Target"; type the name of yours), then opens it.

- A **link** is the shared timeline as it is. It shows **🔗 name vN** in the bar and can't be
  keyed here (an edit is put back, with a message). Its name, **Plays on** and **Also on** are
  this project's own, so you set them as usual.
- **Update available (vN)** appears when someone promoted a newer version. **Update** moves the
  link to it. Until you do, the link keeps playing the version it was placed with.
- **Detach** copies what the link plays into this project as an ordinary timeline you can edit. It
  no longer follows the shared one.
- **Promote to shared** (with the *publish to shared* permission, the same one that promotes
  components) saves the open timeline to the library under a name. A name already in the library
  adds a new version of it, and every project that placed it is offered the update, so the panel
  asks first. The timeline you promoted stays this project's own.

A link ships like any other timeline: the bake writes the version it plays into the game, so the
game never depends on the shared library at run time. A link whose shared version was deleted
shows **⚠ shared version missing** and ships nothing until you place it again.

### The Components side

Components (reusable overlays, UI groups and scenery) are authored on the same stage as the
screens. The editor has two sides: **Screens** (everything above) and **Components**. Your screens
stay open and keep autosaving while you are on the Components side.

**Get there** in any of these ways:

- The **Components** section in the left pane, under Screens. Click a row to edit that component.
  **＋** on a row places an instance of it on the active screen. **＋ New component…** opens the
  components home, where you create one or pick from the full list. The list shows only the
  components your game kind and add-ons use.
- **Double-click a placed component** on a screen's canvas to edit it in place. Double-click is off
  in Animate mode.
- Select a placed instance and click **◇ Edit component in place** in Properties.
- **Right-click a placed component** on the stage for the same **◇ Edit component in place** and
  **↗ Show in Flow** (a right-_drag_ still pans; any key or a click elsewhere closes the menu).
- Select a container and click **◇ Edit as component** in Properties. It is saved as a new
  component and opened in place.
- **◇ Open components** in the Library tab's Components panel.
- The **Invisible Component Editor** card on the launcher home. It opens `/editor?view=components`.

**↗ Show in Flow** (Properties → _Component instance_, or the right-click menu) opens [Invisible
Flow](./flow.md) on the node that names this placement — or, when no node does yet, with the
placement lit in Flow's **Components** palette, ready to drag out. It only leaves from a clean,
saved layout: while a save is still running, your edits are not saved yet, or the save pill wants a
decision (Reload theirs / Overwrite, Retry, Take over), a message says so and you stay — settle
the pill, then try again.
It needs the placement to have a **name**: Flow lists named placements only. The link keeps this
tab's project pinned. Flow's own **◇ Edit component** (or a double-click on its node, after a
confirmation) comes back here, on that component, in place. A Flow Preview run with **Drive the
editor stage** ticked plays its fired triggers and set bool / number inputs on this editor's State
Machine panel when it is open on that component (Animate → State machine → ▶ Run), each at its
preview time.

The address bar follows what is open: `/editor?view=components` is the components home and
`/editor?component=<id>` is one component, so a reload or a shared link lands in the same place.
Old `/components` links redirect here.

**The breadcrumb** at the left of the editor bar shows where you are, for example
`← Screens › Components › Win banner`, or `← Base game › Win banner › Coin` when you came in from a
screen and opened a component nested inside another. Click any crumb to go back to it. The first
one, drawn as a **←** button, takes you straight back to the screen you came from (or to the
screens).

**Esc goes up one level:** out of a coded part you are editing inside, then out of a nested
component, then back to the components home, or back to the screen you came from. If something is
selected, the first Esc clears the selection. Esc does nothing while you are typing in a field.

**Nested components.** Inside an open component, double-click a component placed in it to edit
that one in place. The breadcrumb grows by one crumb. Nesting stops where the game stops drawing:
the game draws components three levels deep, so a component deeper than that is not opened, and a
message says so. Open it from the list instead. The stage draws the open component one level down,
where the game draws it once placed, so what it shows nested is what the Scene Editor and the game
show.

**State machines on the stage.** Outside Animate, a rig inside a component with a state machine
shows the art its machine rests on: the state it settles in from its inputs' defaults (the entry
state when nothing moves it). The game layers that state's animation over the rig's own resting
animation, so a frame resting on `Grand` whose machine enters `mini` shows `mini` on the stage, as
it does in the game. A number input fed by an engine value starts at its default here; set the
default to preview another state.

**The left tabs** while a component is open are **Library** (elements and art to drag in),
**Outline** (the component's node tree), **Browse** (the screens and every component, to jump
to another) and **Data**. Clicking a screen in Browse takes you back to that screen.

**Data** is read-only: the component's whole interface in one place. **Inputs** (with the signals
it declares, which fire as triggers), **Events**, **Params**, and **Bound values** (every node field
bound to a param or an engine value, nested nodes included). Click a bound value's name to select
its node. Edit them where they live: inputs, events and params in Properties, a binding in its
node's Properties.

**Unsaved work.** A component and its game defaults are saved by hand, not autosaved. Leaving a
component with unsaved changes (a crumb, Esc, Browse, a screen) asks first.

#### Duplicate a component

**⧉** on a row of the component list (the components home, and the **Browse** tab while a
component is open) makes a copy of that component as a new component of this project and opens
it. It works on any component in the list: your own, a shared one, or a built-in such as **Counter
Segment** — the copy starts from what this project shows for it (your project's copy if you made
one, else the shared one, else the built-in), at its latest version.

- The copy is named **"‹name› copy"** (**"‹name› copy 2"**, … when that name is taken). Rename it
  with **✎** ([Rename a component](#rename-a-component)).
- It gets its own id and fresh node ids, and keeps the whole component: nodes, params, inputs,
  events, the state machine, category and Space.
- **Its timelines are copied too.** Each timeline of the component (a built-in's included) becomes
  a timeline of the copy, and the copy's state machine plays those, so editing the copy's _Lit_
  never changes the original's. A state that plays a timeline the component only reuses from
  another component keeps playing that one.
- **This game's defaults become the copy's own defaults**: the copy looks the same in this game as
  the original did, and its look lives in one place, the component itself.
- The copy is saved straight away, like any new component (it never overwrites anything), and it
  ships with the game the same way.
- With unsaved changes to the open component, ⧉ asks first, as leaving does.

#### Rename a component

**✎** on a row of the component list (beside ⧉, on the components home and the **Browse** tab)
renames one of **your project's own components**. On a shared or built-in row it is greyed out:
its tooltip says _Duplicate it first to rename your copy_. Shared and built-in components are not
renamed in place, so rename your ⧉ copy instead.

- It asks for the new name, pre-filled with the current one. The name is trimmed, and it cannot
  be empty or match another component in the list (capital letters don't count as a difference).
  The dialog says why and lets you try again.
- **Only the name changes.** The component keeps its id, so every screen placement, component
  nested in another, repeater first / middle / last variant, timeline and published game keeps
  finding it. It also keeps its version: a rename is not a new version, so placements pinned to
  it get no **↑ vN** badge. (Inspecting that version later shows the name it was saved under.)
- It is saved straight away, on top of the component as it is stored now, so any change saved by
  someone else is kept. Only a save landing in the instant between its read and its write refuses
  it (nothing changes; try again). If someone else has the component open, their next save asks
  them to reload, as after any save of yours; their **Save on top** would put the old name back.
- **Placed copies keep their labels.** A placement's label is set from the component's name when
  you place it, and screen and component timelines find their nodes by that label. Renaming the
  component does not relabel its placements, so those timelines keep working. Relabel a placement
  in its Properties if you want it to match.
- If the renamed component is the one open, its breadcrumb and title show the new name. Unsaved
  edits to it stay as they were, and are still unsaved.

Everything else you do with an open component — create types, params and signals, value
bindings, skinning coded parts, the canvas Space, saving, versions, promoting to shared and this
game's defaults — is described in the [Component Editor guide](component-editor.md).

#### Animate a component

An open component has the same **Design | Animate** toggle in the editor bar. **Animate** opens the
same Timeline panel as on a screen, but its timelines belong to the component: every placed
instance of the component plays them in the game, each on its own. Use it for a banner that pops
in, a button that pulses when a signal fires, a coin that spins in when it lands.

1. **Open the component and click Animate.** The panel's host label shows `◇ <component name>`.
   Animate is off while you are **Inspecting** an old version; go back to latest first.
2. **＋** in the left column's **Animations** list asks for a name (it suggests "Pop in") and saves
   an empty timeline. The list shows the component's timelines and, last, the **State machine**
   row, which opens the State machine tab; a timeline row opens the Timeline tab on it.
3. **Pick what plays it: Plays on.** This is the signal, heard on each placed instance, that starts
   the timeline from the beginning. The list offers:
   - **enter** — the instance appears. A new timeline starts on this.
   - the **signals** the component declares (see the
     [Component Editor guide](component-editor.md#3-bind-the-engine-variables)),
   - the **complete signals** of its rigs' cues.

   **✎** next to it lets you type any other name, for example a Flow **fireCue** name. Choose
   **(nothing — not played)** and nothing in the game starts it.

   **Holds the cue** (shown once a signal is picked): tick it and an *awaited* fire of that signal
   — a Flow **fireCue** with "wait" ticked — continues only when this timeline has ended on every
   instance it started on, the way the engine's coded overlays held their cue until their rig
   finished. Off (the default), the fire returns at once, as it always did; clearing **Plays on**
   clears it too.

4. **Select a node and key it**, exactly as on a screen (steps 2 to 5 of
   [Animate mode](#animate-mode--the-timeline)).
   A **rig** node also gets an **animation** row: pick one of the rig's animations and it plays from
   the playhead, as a strip on the rig's row (drag, trim or loop it like any strip; its inspector
   swaps the animation). The timeline grows to fit it, and the canvas shows the rig at the
   playhead's frame. A component's state machine uses this to play a different animation per state.
   Effects and flipbook clips the Rigger bound to that animation's events play when the strip
   crosses them, as they do when the rig plays the animation itself. A **continuous** effect a strip started
   stops emitting once no strip plays its animation any more (the state that played it was left)
   and starts again the next time one does; its particles live out their lifetime. Game logic listening for rig
   events does not hear a strip. A strip plays its animation once and holds the last frame; for a
   state that should keep moving, tick **loop** on the state and make the strip as long as the
   timeline. In Animate a drag on the canvas keys (as on a screen) rather than moving the part:
   no Delete, and double-click does not open a nested component. The **State machine** tab's
   stage does not key. Keys find nodes by **name**, so
   each node you key needs a name no other node in the component shares.
5. **Save** (or Ctrl+S). Publish as usual: the timeline ships with the game. You don't add a Flow
   node; component timelines are not in `/flow-v2`'s playCinematic picker, because the instances
   play them.

**Also on** lists your other components. Tick one and its instances play this timeline too, on
the same **Plays on** signal. It moves the nodes in that component that have the same names, so
reuse works when the components name their parts alike (say, `Panel` and `Label`).

**The ⚠ issues pill** appears when something would silently do nothing in the game: a keyed name
the component (or a component in **Also on**) doesn't have, a channel that node can't take, or no
**Plays on** signal. Hover it for the list.

How it plays in the game:

- Each placed instance has its own playhead. With **enter**, each instance starts when it appears.
  A component **scoped by** a param (a pot, say) hears a scoped signal only on the matching
  instance, so only that one plays.
- When the timeline ends, the last frame **holds**, so a pop-in stays popped in. The signal firing
  again restarts it from the beginning.
- If two timelines key the same node, the one that started most recently wins.
- A screen's timeline never moves the nodes inside a placed component, and a component's timeline
  never moves the nodes inside a component nested in it. Animate the nested one on its own.
- Switching back to Design keeps the open timeline with any unsaved changes. Opening another
  component saves it and closes it, the same as switching screens.

#### The State Machine

Animate on a component has two tabs under the stage: **Timeline** (above) and **State machine**.
The state machine says _which timeline plays when_, Rive-style: states that each play one of the
component's timelines, transitions between them, and the **inputs** the game fires or sets that
move it along. It saves with the component (Save in the editor bar, the usual version and History),
so it needs no Flow node and no extra publish step; it is read-only while you are Inspecting an old
version, like the rest of Animate.

**Inputs** are declared in the Properties panel under **Component variables → Inputs** (the block
that used to be _Signals_), or — bools and numbers — in the **Inputs** list docked left of the
graph in the State machine tab: type a name, pick **bool / number** and **＋** (a trigger is added
with Properties' **+ Add trigger**); **✎** and **×** there do what they do in Properties. The docked list is also where you **drive the preview**: click a trigger to fire
it, tick a bool, type a number. Three kinds:

- a **trigger** ⚡ — a signal: **+ Add trigger** picks an engine moment (`win`, `bigWin`…), a
  Flow **Fire Cue** name, or any name. Every signal the component already declared shows here as
  a trigger; nothing changed for them. A trigger plays the component's **Plays on** timelines
  exactly as before, and the state machine hears it too.
- a **bool** ◐ and a **number** # — typed in the row at the top of the block (name, kind, **Add**).
  Each has a default; a number can also follow an engine value (**from**: `winAmount`, `balance`…,
  the same names _Bind to value_ offers). Flow sets them in game from Phase 7 on.

**A Hold and Win feature's value: `featureWorth` or `featureTotal`.** Both count in hundredths of
the total bet (100 = 1× bet, 1000 = 10×), so a threshold is typed the same way for either.

- `featureWorth` — what the feature is worth so far: banked jackpots plus every held coin, the
  same value Flow's `featureWorth` reads. It reads 0 before a feature opens, moves after each
  respin as coins land, holds the final worth once the feature ends, and goes back to 0 when the
  next spin starts, so a widget still on screen after the outro drops to its lowest tier on that
  press. Pick it for anything that follows the feature while it plays, such as a
  TOTAL WIN widget whose tier is set by its state machine. Example: a number input `worth`
  **from** `featureWorth`, with transitions `worth >= 1000` → Medium (10× bet), `worth >= 2500`
  → Big, `worth >= 5000` → Huge, and `worth < 1000` → Mini.
- `featureTotal` / `totalWin` — the HUD win meter. It resets each spin and only climbs during the
  end-of-feature tally, coin by coin. Pick it for a readout that should count up with the meter.

Rename an input with **✎** — every transition condition that reads it follows. The name is what
the game and Flow fire it as, so a rename is a delete + add: the dialog says what fires the old
name (a declared signal, timelines that **Play on** it), and fields a newer build added to that
input are not kept. **×** removes it, and warns first when a transition reads it: that condition stays, the
transition never fires until you fix it, and the ⚠ list says so. Inputs are read-only while you
are Inspecting an old version.

**Building the graph** (the **State machine** tab):

1. **＋ State** picks one of the component's timelines and adds a card named after it — or drag a
   timeline row from the **Animations** list onto the graph and the card lands where you drop it.
   The first state of a layer is its **entry** (the ● dot); **Set as entry** in the inspector
   moves it, or drag a wire from **Entry** onto another card.
2. **Transitions** are arrows: drag from a card's right handle onto another card. Drag from
   **Any** for a transition that fires from every state; drop onto **Exit** to end the layer (its
   nodes go back to how they are drawn until the machine resets). Click an arrow to open its
   inspector:
   - **Conditions** — all must hold: a trigger **fired**, a bool `==` / `!=`, a number `==` /
     `!=` / `<` / `>` a value. With none, the transition fires as soon as its exit time does.
   - **Exit time** — how far through the leaving state's timeline (0–1) before it may fire; on a
     looping state, the point is checked each lap. Leave it empty for "at once".
   - **Blend (ms)** — mixes the new timeline in from the pose being left. An effect's **⚡**
     parameters mix too. If only one of the two states keys a parameter, it mixes from (or
     towards) the parameter's default. [Keyed Element FX](#keyed-element-fx-on-the-timeline) mix
     the same way. With a blend set, three more options show:
     - **Interpolation** — **Linear** (an even mix) or **Cubic**: the same curve editor as the
       Timeline's Interpolation panel, two handles plus the typed `x1, y1, x2, y2`.
     - **Pause source when exiting** (on by default) — the state being left freezes where it was.
       Untick it and that state keeps playing underneath while the new one mixes in (its cues do
       not fire while it plays out).
     - **Allow exit during transition** (on by default) — another transition may leave the new
       state before the blend has finished. Untick it and none can until the blend ends; a trigger
       fired meanwhile waits for the end, as one waits for an exit time.
     The curve cannot overshoot a blend: a handle past 0..1 holds the mix at its end.
   - **Disable** — the transition never fires (in the preview or in game). It stays on the graph,
     dashed and greyed, with "off" on its label, so you can switch it back on.
3. Click a card for its inspector: **Name**, **Timeline**, **Speed**, **Loop**, **On enter** and
   **On exit** (each **＋ raise event** row raises one of the component's events; On exit fires
   each time a transition leaves the state, before the next state's On enter), **Open timeline**
   (double-clicking the card does the same: it opens the Timeline tab on that timeline) and
   **Delete**. Delete / Backspace removes the selected card or arrow. **Start offset** and
   **Random start** put each placed instance at its own point of the state's timeline on entry:
   the offset is read, in seconds, from a number param of the placement (wrapped on a looping
   state), and Random start adds a random point each time the state is entered. Use them when
   several instances enter a state together and should not move in step.
4. **Layers** are the tab strip in the panel bar: **＋ Layer** adds one; each runs on its own, and
   where two key the same property of a node, the later layer wins. Next to **Rename**: **⧉**
   duplicates the layer (states, arrows and positions, named "<name> copy"), **◀ / ▶** move it
   earlier or later (which changes who wins a shared property), and **⏻ Disable** switches it off:
   a disabled layer does not run, in the preview or in game, and its tab is struck through.

**Preview**: **▶ Run** plays the machine on the stage — the live state is shown on each layer's
tab and the active card lights up; a transition that fires flashes its arrow. The docked **Inputs**
list fires the triggers and sets the bools and numbers, so you can walk the graph by hand.
**↺ Reset** returns every layer to its entry. The preview uses the same interpreter the game runs.

**The Console** is the strip under the graph. Its **Console** tab logs, newest first, each state a
layer enters (the entry states when ▶ Run starts), each transition taken and each event raised
(with where it came from and its payload), and shows each layer's current state; **Clear** empties
it. Its **Problems** tab lists what would not work in game: a state whose timeline is missing (the
state holds in game), a layer with no entry, an arrow to or from a state that no longer exists, a
condition on an input that is not declared or with an operator its kind cannot take, an event
raise that does not fit its event, and — as warnings — states or an Exit nothing reaches. Click a
problem to jump to it: its layer's tab opens and its card or arrow is selected, or its input is
outlined in the Inputs list. The **⚠** count in the panel bar opens the Problems tab.

How it plays in the game: each placed instance runs its own machine from the entry state, hears
its triggers through the same per-instance signal bus as **Plays on** (so a component **scoped by**
a param hears only its own part's fires), and a trigger a transition is waiting on (an exit time)
is held until that transition fires. A **Plays on** timeline that is still playing wins a node over
the machine; once it ends, the machine's layers take the node back — a pop-in, then idle, needs no
transition.

#### Segmented counters — Repeat (count)

A **segmented counter** draws one segment per spin of a count the game feeds and lights the
segments as it changes: 5 free spins ⇒ 5 segments; on a Hold and Win respin bar of 3, all three
are lit with 3 respins left and only the first with 1 left. It is built from two components and
needs no code per game: a **segment** (its looks and a state machine that lights it) and a **bar**
holding a **Repeat (count)** element that repeats the segment.

**The built-in starter.** The component list carries **Segmented Counter** (`segmentedCounter`)
and its **Counter Segment** (`segmentedCounterSegment`). Place the counter on a screen and it
counts respins; set its **countSource** param to `freeSpinsTotal` and **valueSource** to
`freeSpinsLeft` for free spins. Re-skin it without touching the machine: the segment's
**litImage** / **unlitImage** (art over the fills), **litColor** / **unlitColor**, **labelColor**,
and the counter's **backgroundImage**. To change more, copy it: **⧉** on its row in the component
list ([Duplicate a component](#duplicate-a-component)) makes a project copy with its own state
machine and timelines, and you edit the copy as below. End caps work the same way: duplicate
**Counter Segment** twice, give the copies their extra border art, and pick them as the bar's
**first** / **last**. A copy keeps the segment's `index` / `value` contract, so the bar feeds it
directly (wrapping a Counter Segment inside a new component does not: the inner segment never
gets the bar's `index` / `value`, and it nests one level deeper than the game draws).

**Worked example — a respin / free-spin segmented counter.**

1. **Build the segment.** Create a component (say _Respin segment_) and give it two looks, one
   over the other: a container named **Lit** (the orange art) and one named **Unlit** (the dark
   red art). Add a text for the segment's number.
   - Under **Component variables → + Add variable**, add a custom number param **`index`**
     (default 1). The bar sets it on every copy: 1 for the first, 2 for the second… Add `count`
     too if a segment needs to know how many there are.
   - Select the text and, under **Bind to param**, set **Text ← param** to `index`: the copies read
     1, 2, 3.
   - Declare a **number** input **`value`** (the Inputs list in the State machine tab, or
     **Component variables → Inputs**).
2. **Light it with its state machine.** In **Animate**, make two timelines: _Lit_ (keys the
   **Unlit** look's opacity to 0) and _Unlit_ (keys the **Lit** look's opacity to 0). In the
   **State machine** tab add a state for each — Unlit as the entry — and two arrows:
   **Unlit → Lit** with the condition `value` **>=** `{index}` and **Lit → Unlit** with `value`
   **<** `{index}` (the third box of a number condition offers each number param as `{index}`).
   Each copy compares the value with its own position. Save.
3. **Build the bar.** Create a second component (say _Respin bar_). In **Library → Elements**,
   drag **Repeat (count)** onto the stage. It repeats the first component that declares `index`;
   select it, and in Properties (**Repeat (count)**):
   - **segment** — the component each copy is (_Respin segment_).
   - **first** / **middle** / **last** — optional end caps with their own art; left on **same as
     middle**, the end ones draw the middle one (and **middle** on **same as segment**). A single
     segment is the first.
   - **Count**: **count from** — the game value that says how many segments: **Respins cap**
     (`respinsStart`) or **Free spins awarded** (`freeSpinsTotal`). Left on **— fixed: the preview
     count —**, the bar always draws the **preview count**. The editor always draws the preview
     count. **max** caps it (20 when empty, never more than 50).
   - **Layout**: **direction** **row** / **column** / **grid** (with **columns**) and the **gap**
     between segments. A row or column steps by each segment's own size, so wider end caps fit.
     A segment's size is measured from the rects and sized sprites it draws. **A segment drawn only
     from rigs or text has no size the bar can measure, so set its box, or the segments stack on
     top of each other:** open the segment (and each end cap) and fill **Size** (W × H) in the
     editor bar, beside **Space** (both sides; one alone is ignored). The box is not drawn on the
     stage: it runs from the component's origin (0, 0) right and down, so keep the art between
     (0, 0) and (W, H) — art centred on the origin keeps its spacing but shifts the whole row half
     a segment left and up. A **grid** steps by the segment's box too. Leave **Size** empty to keep
     measuring.
   - **Pass to each segment**: one row per number input of the segment. `index` and `count` show
     as _given by the repeater_. For **`value`**, set **from value** to **Respins left**
     (`respinsLeft`) or **Free spins left** (`freeSpinsLeft`) — every copy's `value` follows it in
     game. Drag its **test value** slider: the stage relights the segments at once, each at the
     pose its state machine settles on (test value 1 of 3 ⇒ only the first lit).
   A name that is not in the lists (a `{param}` template such as `{countSource}`, filled from the
   bar's own params) goes in **Custom source…**.
4. **Place it and publish.** Save the bar, place it on the free-spins or Hold and Win screen like
   any component, and publish as usual — the bar, its segment and the variants travel with the
   game. A player link shows the LAST publish: an end cap made since then is not in it yet, so the
   game draws the middle segment in its place (and says so in the browser console) until you
   publish again.

The canvas draws each segment from the segment's saved timelines (and the built-in ones), read
again when you open another component — so after editing the segment, come back to the bar to see
the change. Looks drawn from rigs show their rig art, in the pose the segment's state machine
lights.

#### Listeners and events

A component can react to the pointer and tell the game what happened — the Rive idea of
**listeners**, plus **events** for Flow.

**Events** are declared in the Properties panel under **Component variables → Events**, below
Inputs. Type a name (`pressed`, `revealDone`) and **Add**. Click an event's name to open its
**payload**: fields Flow will receive with it, each a **number** (`int`, `number` or `ms`), a
**bool** or a **text key**. A text key is a localization key — the text as it is written in the
game; it is collected into Localization like any other text, so nothing in a payload skips
translation. Tick **optional** when a raise may leave a field empty. An event name has no spaces
and no `:` (a timeline cue names it as `event:<name>`).

- **✎** renames an event. Its name is what Flow will hear it by, so a rename is a replace: the
  dialog lists what raises it (listeners, states, timeline cues). The listeners and states follow
  the rename; a timeline's `event:` cue is not rewritten — change it in the Timeline tab.
- A name that listeners or On enter rows of an event you removed earlier still raise can't be
  added or renamed to (taking it would quietly reconnect them) — repoint those rows first. A name
  only a timeline cue uses is free: declaring it is how you fix a cue's typo.
- **×** removes it, asking first when something raises it. Those raises stay and do nothing in
  game until you fix them: a listener shows ⚠ under **Listeners**, a state's On enter or On exit in
  its inspector, and every one of them in the State machine tab's **Problems** list.
- The **last** event cannot be removed while any of this project's timelines for the component
  (as last saved) has an `event:` cue: a component with no events plays such a cue the old way, as
  a message to the whole screen. Remove or change those cues first. A **shared** component always
  keeps its last event — other projects' timelines may raise it.
- Adding the **first** event to a component whose timelines already have `event:` cues asks first
  (a shared component always asks: other projects' timelines may have some): from then on those
  cues raise the component's events instead of messaging the whole screen.
- Renaming onto a name only a timeline cue uses asks first, naming the cues that will now raise it.
- Renaming an **input** also repoints the listeners and payload fields that read it; removing one
  lists them in its warning, and they stay, flagged ⚠.

**Listeners** are per node: select a node of the component and use **Listeners → + Listener**
(under the node's name in Properties). Each row reads **On [event] → [action]**:

- **On**: `down`, `up`, `hover in`, `hover out`, `click`, `pointer move`, `drag start`, `drag`,
  `drag end`, `swipe`. `up` counts only when the pointer is released over the node; a click is a
  down and an up on the same node. `pointer move` is the pointer moving over the node. A press
  becomes a drag once it has travelled 4 px (in the component), so a tap's jitter is not one:
  `drag start` then `drag` on each move, `drag end` on release. A drag keeps tracking after the
  pointer leaves the node, and still ends when it is released elsewhere.
- A **swipe** is judged on release, by how far the pointer got from where the press began. Its row
  gets a direction picker — **any direction**, `left`, `right`, `up`, `down` (the longer axis of
  the travel decides; a tie reads as left/right) — and a threshold in **px** in the component's
  space, 40 when left blank.
- The action: **fire trigger** (one of the trigger inputs), **set input** (a bool to true/false or
  a number to a value), **toggle bool**, **raise event**, or **align target** — then fill the
  event's payload fields: a value, an input's current value, or a text key (it needs at least one
  letter — it is the text as the game shows it). An `int` or `ms` value is rounded to a whole
  number.
- A number payload field on a listener's raise can also read the pointer: **pointer x** / **pointer
  y** (where it is, in the component's space) or **pointer dx** / **pointer dy** (how far it is from
  where the press began; 0 with no press). An `int` or `ms` field gets the reading rounded. A
  state's On enter / On exit has no pointer, so it can't use them — validation flags one that does.
- **align target** moves a node of the component onto the pointer, in that node's parent's space.
  Pick the node (any node but the component's root — an instance is placed by its node). Tick
  **keep offset** to keep the distance the node had from the pointer when the press began (else
  the node's position becomes the pointer), and choose **x and y**, **x only** or **y only**. Put
  it on `drag` for a slider knob or a draggable piece.

**Save** refuses while a listener or an On enter / On exit row would be lost by it — no trigger, input or
event picked, say — and names the rows to fix.

A node with listeners becomes clickable in game (only such nodes do — nothing else changes). It
still works as before if it also presses a button or a dialog action: both fire. A listener acts
on its own placed instance only. A new listener starts **On click**, firing the first trigger (or
raising the first event, or setting the first input); on a component with no inputs or events it
starts as an **align target** moving its own node (on the root, the first node under it).
**+ Listener** is off only when the component has none of these — no input, no event and no node
but the root.

**On enter** and **On exit**: in the **State machine** tab, a state's inspector has **On enter →
＋ raise event**: the event is raised every time that state is entered (and when the machine
starts, for an entry state). **On exit → ＋ raise event** is raised each time a transition leaves
the state, before the next state's On enter (not when the instance goes away or the machine is
reset). A timeline can raise one too with a cue named `event:<name>`.

**Preview**: in the **State machine** tab, the stage answers the pointer — hover, press and click
the component's nodes and their listeners run, on the same preview as **▶ Run**. The **Console**
under the graph logs every raised event with its time, what raised it (`listener`, `state`,
`cue`) and its payload, between the states and transitions; **Clear** empties it, **↺ Reset**
starts it over. In the preview a
**fire trigger** listener moves the state machine; it does not start **Plays on** timelines (the
game does). The preview plays only `down`, `up`, `hover in` / `hover out` and `click`:
`pointer move`, the drag events, `swipe` and **align target** do not preview there yet — they run
in the game.

Raised events reach Flow once Phase 7 adds the component's event pins; until then they are
previewed here and do nothing in game. Everything is read-only while Inspecting an old version.

### Advanced modes (optional)

- **Components** — the **Components** section of the Library tab lists reusable prefabs (overlays,
  UI groups, scenery), grouped by category. **＋ place** one to drop a component
  instance into the active screen; instances' params are editable in Properties. An instance's
  **component** select switches the component it draws (say, a Pot Meter to your own Pot copy),
  keeping its position and params.
  The list shows only what your project's game kind and add-ons use: the Hold and Win pieces
  (Respin Counter, Jackpot Bar, Jackpot Tile, Total Win Bar, Pot Meter, Letters Strip, Letter Tile,
  Wheel, Respin Cell Tiles, Locked Row, Line Overlay) appear only in a Hold and Win project or one whose Game Config
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
  **⇕ Reserve rows for board expansion (N)** entry in the Screens panel's **⋯** menu: it applies the same cell size
  and board nudge to the reel grid without moving it (undoable). Move any piece that still sits under the
  grown board yourself.
  **Line Overlay** marks a coin board's paying lines: each active line as a path between its cells,
  in its Game Config payline colour, with a numbered tab at each end of the board. Like the tiles,
  where you drop it doesn't matter: the lines draw on the board's own cells, and only in a coin
  board game (elsewhere it draws nothing). Its params restyle them: **lineWidth** (px),
  **lineAlpha**, **lineColor** (one colour for every line; blank keeps the payline colours),
  **showTabs**, **tabScale** and **tabTextFill**. Without one placed, the game draws the same lines
  at those defaults; while one is placed, that one's look wins. The colour over the cells no line
  crosses is Game Config's **Inactive overlay**, not this component. The coin board template puts one
  on the **Coin board** screen. The lines show in the game only (**Live ↗**).
  Click a row (or **◇ Open components**) to author components on the
  [Components side](#the-components-side).
- **Template editor** — a separate, advanced mode (top-bar toggle) for defining
  a game type's slot schema: tag nodes with a `slotId`, choose the game type,
  and **Save template** to write `editor/templates/<gameType>.json`. Not needed
  to lay out scenes; it defines the slots that scene authors then fill.
- **Save as new game kind…** (the Screens panel's **⋯** menu) — saves the current screens + engine pieces (minus
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
- **An element vanished after its Element FX and never came back.** It has an exit effect (Pop
  out, Fade out, Dissolve out, Burn to ashes, Melt, Crash, Crumble, Shatter, Crystallize, Dissolve
  to particles), which ends hidden and keeps the element hidden
  until its **Stop cue** fires or an entrance effect plays on it. Give it a stop cue, or an entrance
  on a later cue.
- **An _On cue_ Element FX did not play.** A cue reaches an element only while it is on screen.
  Nothing is queued, so a cue fired while the element or its screen is hidden is missed. The name
  must also match exactly on both sides. A cue on a screen timeline needs the `signal:` prefix
  (`signal:FX_Intro` plays the Element FX whose cue is `FX_Intro`); one without it does not reach
  Element FX. Check the entry's **Trigger** too: _When shown_ plays when the screen appears, not on
  a cue.

## Known limitations / TODOs

- **Animated / book-event-driven content stays coded.** The editor owns static
  scenery, frames, labels, and intro/outro rig poses. Symbols, win-line draws,
  count-ups, and anything derived from runtime state mount via the engine's
  `mount`/`bind` escape hatch — the editor only places their anchor. (The design
  intent is to drive that hatch to zero over time, but it is the current
  boundary.)
- **No in-editor book-event playback.** A screen's own motion can be keyed and previewed in
  [Animate mode](#animate-mode--the-timeline); anything a book event drives must still be checked
  in the live game.
- **Component timelines belong to the project.** A shared component's timeline authored in one
  project does not ship with another project's game. A shared timeline library is a later phase
  (`docs/design/rive-style-editor.md` §10).
- **Some HUD parity gaps remain.** Rotation now ships for HUD elements, but the
  corner logo/game-name containers still ignore `scale` in-game, so scaling those
  two corner texts in the editor won't ship yet.
- **A repeater's canvas preview is a stand-in, not the live list.** The editor
  can't run a game's registered sources, so the bet ladder it draws is a
  representative set of amounts of the right length — the real one arrives from
  the RGS at runtime. Size the grid here; check the amounts in the running game.
- **A segmented counter's segments preview their state machine's settled pose only.** The stage
  shows each segment at the end of the state its machine settles in for the test value — not the
  blend into it — and the 2D canvas folds in position, scale, rotation, opacity, show / hide and
  tint, not a fill reveal or a clip frame. Rigs and effects inside a segment are not drawn on the
  stage. Check the motion in the running game.
- **The listener preview plays clicks and hovers only.** The State machine tab's stage runs
  `down`, `up`, `hover in` / `hover out` and `click` listeners; `pointer move`, `drag start` /
  `drag` / `drag end`, `swipe`, **align target** and pointer payload readings do not preview yet.
  Check them in the running game.
- **Interactive feel is partly unverified.** Several recent editor capabilities
  (undo/redo, copy/paste, multi-select, and the two new menu-screen buttons)
  build clean and type-check, but the auth-gated canvas makes automated
  interaction testing hard — owner confirms live.
- **Element FX are not verified in a live browser yet.** Every effect renders in a headless
  WebGL harness and the section, ▶ and the timeline posing were tried in standalone harnesses,
  but nobody has clicked them in `/editor` or watched them in a published game. Owner confirms
  live ([FX status](../status/fx.md)).
- **A node's Element FX preview is a still.** ▶, a timeline cue and the timeline's posing play a
  node's effect on a copy of it that follows the node's moves, so an animating rig or clip holds
  still, and only what the visible stage shows is copied. A screen's ▶ is live (a HUD screen's is a
  still). Check an effect on an animating rig in the game.
- **A rotated element plays its Element FX about its axis-aligned box.** The passes that bend or
  light an element assume it is not rotated ([design §9](../design/element-fx.md#9-open--next)).
- **_Keyed on a timeline_ is for nodes only.** A timeline keys nodes, and in the game nothing
  poses a whole screen or the reel stack, so the Screen block and the reel grid do not offer it.
  Use _On cue_ there. A _Keyed_ entry already saved on one (written by hand) shows a hint and stays
  at rest.
- **Element FX on the HUD bar's placed components and built-in pieces do not play in the game
  yet.** The game draws them (readouts, buttons, logo, game name) outside the view that plays
  Element FX ([design §9](../design/element-fx.md#9-open--next)). Other art you place on the HUD
  plays them.
