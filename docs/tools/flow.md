# Invisible Flow

An online node editor for a game's **presentation flow**, built as a Blueprint-style
graph. You wire **event → logic → presentation** the way Unreal wires Blueprints: nodes
carry **exec pins** (control flow — "do this, then that") and typed **data pins** (values),
and the game runs the graph you author at runtime. The document you build (a **FlowDoc**)
auto-saves to the project's cloud storage and drives the real game.

## What it is

A single wiring graph over one game. The game dispatches **events** into the flow — book
events from the RGS (`reveal`, `winInfo`, `freeSpinTrigger`, …), lifecycle signals
(`load`, `tapToStart`, `idle`), and player **intents** (`spin`, `stop`, `buyBonus`). Each
event node is an **entry point**: you run an exec chain off it that fires the game's real
**actions** (state effects and mechanic commands), broadcasts **cues** (presentation
signals that components — and spines placed on a screen — listen for), waits with
**delays**, forks on **branches**, loops with **forEach**, and **shows / hides containers**
(screens, stacked by an author-assigned z-order).

- **Nodes store a reference, pins are derived.** An event / action / cue / function node
  stores only a *name*; its pins are **derived** from the template's vocabulary (the
  contract of what the game can react to and fire). You never hand-declare a pin, so a
  node can't render pins that disagree with the effect it calls. Rename or retype the
  underlying event and the node's pins follow.
- **Exec pins vs data pins.** **Exec** pins are the white/square control handles that
  sequence what happens; **data** pins are the colored round handles that carry typed
  values (`int`, `float`, `bool`, `string`, `ms`, template `enum`s like `SymbolName`,
  `struct`s like `Win`, and `list<T>`). A wire's color reads the same as the dot it leaves,
  so a value's type is legible from the wire alone. Wires are **type-checked at connect
  time** — an incompatible wire simply won't drop.
- **It validates against a template vocabulary.** The flow is written against the game
  template's declared **events / actions / cues / collections** (today only the
  `book-of` template exists). The palette offers exactly those names, and a live
  **Validation** panel flags anything unresolved or mis-wired.
- **Deterministic preview.** Pick one of your event nodes and run its handler headlessly
  against a fixed sample; the panel lists the resulting ordered timeline (each effect /
  cue / delay / show / hide with its virtual millisecond stamp). It proves the **order and
  timing** of your graph — it is not a live visual of the game animating.

- **Where it runs:** the launcher itself, at `/flow-v2` — a real full-page tool inside the
  authed `(app)` area, **never an iframe**. The route gates on auth + the `flow` tool
  entitlement and resolves the active project, then renders the graph client-side (SSR is
  off because the canvas touches `window`).
- **Access:** the `admin`, `developer`, `artist` and `pipelineTester` roles get it by
  default (`ROLE_TOOLS` in `src/lib/roles.ts`); the `animator` role does not. Like any tool it is overridable
  per role/user in the admin panel. The save endpoint (`POST /api/flow-v2/save`) is
  `flow`-gated and scoped to your session's active project.

## How to use it

### Open it and pick a project

Sign in to the launcher (`app.invisiblewall.org`) and open **Invisible Flow** (the top-bar
switcher lists it as **Flow**). The FlowDoc is scoped to the project selected in the top
bar — the sub-bar shows the active `client / project`. Switching projects loads that
project's saved flow. If a project has no saved flow yet the editor opens on a built-in
**sample** graph so you always have something to work from; a sample that isn't bound to a
real project is marked **"sample · not saved"** and is never persisted.

### Read the sub-bar

Across the top the sub-bar shows the active **client / project** scope, an **exec / data**
legend, a live **node / exec / data** count, and a validation pill (**✓ valid** or **⚠ N
issues**). The **save pill** on the right reports the auto-save state — **Saving…**,
**Unsaved changes**, **Saved**, or **Save failed — retry** (click to retry).

### Add nodes (the palette)

When no node is selected, the left panel is the **Add node** palette. Its sections are
projected live from the template's vocabulary plus the flow's own containers and the shared
function library:

- **Events** — one entry per template event the game can dispatch (book events, lifecycle
  signals, intents). Adds an **event** entry-point node.
- **Sources** — a single **Game Signals** node: one exec-out per book and lifecycle moment
  the game emits. A flow has one, so the section disappears once you have added it. Wiring
  one of its pins hands that moment to the flow — read the trap below before you do.
- **Actions** — the game's real effects and mechanic commands (`revealBoard`, `winShow`,
  `stopReel`, `startSpin`, `setBetAmount`, `startAutoSpins`, …), each tagged with its
  category.
- **Cues** — presentation signals to broadcast (`boardShow`, `specialBookReveal`,
  `freeSpinIntroShow`, `soundMusic`, …). Adds a **fireCue** node. The list is the engine's
  own cues **plus every signal name authored on a spine or a flipbook in this project's
  screens**, so a cue you invented in the Scene Editor is waiting here to be dragged out
  (see below). The two sound cues — `soundMusic` and `soundOnce` — also take an optional
  **volume** (`0`–`1`) for that one firing; leave it unfed and the sound plays at the level
  set on its row in [Invisible Sound](./sound.md), which is where a track's mix belongs. It
  multiplies with that row's level, so it can only ever make a sound quieter.
- **Functions** — reusable sub-graphs from the shared library (see *Collapse to Function*).
  Each row also has **✎** (edit its body) and **✕** (delete it, blocked while it is in use).
- **Containers** — a **show** and a **hide** button per container the flow declares
  (`show basegame`, `hide loading`, …). Adds a **showContainer** / **hideContainer** node.
- **Presentation** — a **Text Message** node: one line of on-screen text you author right on
  the node (see below).
- **Control** — the flow-control kinds: **Delay**, **Branch**, **ForEach**, **Sequence**,
  **Parallel**, **Compute**.

#### Scene cues — animate a placed character

A character placed in the **Invisible Scene Editor** carries its own **Plays on signal** rows —
each pairing a signal name with what that node plays. It does **not** have to be a Spine rig: a
spine cue names an animation, and a placed **Invisible Flipbook** clip takes the same rows,
naming another clip to swap to. Every name used on this project's screens, on either kind, is
collected into the **Cues** section here, so a name an author invented becomes a node you can
drag onto the canvas — and one validation accepts as a real reference. Nothing else connects
the two tools: the names match, or nothing fires.

The whole recipe, for a character that idles, plays a spin loop while the reels turn, then
returns to idle:

1. **In the Scene Editor**, select the character — its spine, or its placed flipbook clip — and
   give it a resting state: a spine's **default animation** set to the idle animation with
   **loop** ticked; a flipbook's **clip** set to the idle clip.
2. In the same panel's **Plays on signal** block, **+ add cue** twice: one row
   `characterSpin` naming the spin animation (or spin clip), one row `characterIdle` naming
   the idle one. Set both to loop — a tick box on a spine, the **loop** option on a flipbook.
   (A looping cue holds until another cue replaces it, and a fired cue is never cleared —
   which is why returning to idle is a second cue, not an "off".)
3. **Here in the Flow**, open the palette's **Cues** section: `characterSpin` and
   `characterIdle` are now in it. Drag both onto the canvas.
4. Splice `characterSpin` into the exec chain that already runs when the spin starts, and
   `characterIdle` into the chain that already runs at the end of the round — **in series**,
   between two nodes that are already wired to each other.

**Trap 1 — insert in series; never wire a fresh Game Signals pin.** The **Game Signals** node
exposes an exec-out for *every* book and lifecycle moment, but wiring one **hands that moment
to the flow and switches the game's own coded handling of it off**. Connect a pin the flow does
not otherwise drive — `reveal`, say — and the board stops revealing, because the flow now owns
it and the flow does nothing else with it. So take a chain the flow already drives and splice
the cue node *into* it: delete an existing exec wire, run it into the cue's exec-in, and run
the cue's exec-out on to the node that used to follow. You would have to anyway — **an exec-out
only ever runs the first wire you drew from it**, so exec never fans out, and nothing warns you
about the second wire.

**Trap 2 — the character's screen has to be showing.** A cue fired while its screen is not
mounted is **lost**, not queued: there is no replay when the screen later appears. If the
character lives on a screen the flow shows, fire its cue *after* the **show**, never before.

**Waiting for one.** Tick **Wait for this cue to finish** in the inspector and the chain holds
until the animation the cue starts is done, so the next node does not land on top of it — the
answer to "why does my second cue fire immediately?". A scene cue has no listener that can
report back (nothing is subscribed to an invented name but the artwork itself), so the wait is
**measured**: the longest clip any cued spine or flipbook plays for that signal, on a screen
this flow is currently showing.

Things that follow from *measured*, each deliberate:

- A **looping** cue waits **one cycle**. A loop has no end, but you ticked the box on that
  node, so one pass is the only finite answer — and it is the one the idle → spin → idle recipe
  above wants.
- If **nothing showing** names the cue, there is **no wait at all** — the same "the screen has
  to be showing" rule as Trap 2, so a cue that reached nobody cannot stall the round.
- The wait scales with **turbo** and a **slam** collapses it, exactly like a **Delay**. An
  authored wait never outlives a round the player chose to skip.
- A clip that has **not loaded yet** measures nothing, and so does not wait. Fire the cue after
  the screen is up and its assets are in.
- A node **hidden in the current orientation** (its *Visible for* gate) is not measured — it
  would never draw, so its animation never plays.

**Two limits worth knowing before you rely on it.**

**"Shown" means shown by this flow.** The wait is measured over the screens *this* flow
mounted with **Show**. If the character lives on a screen the game puts up by itself, and no
**Show** for it appears anywhere in this flow, nothing is measured and the wait is zero. The cue
still fires and the character still animates; only the *waiting* is unavailable — pair it with a
**Delay** there.

**An engine cue is not affected by any of this.** A cue the engine already owns
(`specialBookReveal`, `winShow`, the sounds) waits for its real listeners, exactly as it always
has, even if one of your screens happens to name the same signal on a spine. The two never
stack.

The Scene-Editor half — the block's fields, and exactly what **loop** does on each kind — is in
[the Scene Editor guide](invisible-editor.md#plays-on-signal--a-spine-or-flipbook-that-changes-what-it-plays).

#### Text Message — in-game prompts

A **Text Message** node shows a single line of text during play. Unlike a container, it
carries its *own* text — type it into the node's **Message text** in the inspector; that text is
both the default and the string that auto-appears in **Invisible Localization** (a read-only *Flow
messages* section) for translation.

Choose **where** it appears with **Placement**:

- **Info bar** (default) — routes the text through the game's shared **message line**, the exact
  place win messages and other toasts already appear. It looks and sits like every other message.
  This is a single slot, so a state-gated info-bar message (e.g. a "press spin" prompt set to
  **Visible while: Idle**) acts as the bar's **resting text**: it shows only when the bar is
  otherwise empty and yields automatically to win presentation — so a standing prompt appears only
  when the game is completely idle, never on top of a win message. *(Requires the game's HUD to have
  a message/info-bar component — the same one win messages use.)*
- **Fixed position** — draws the text as its own overlay at the **Anchor X/Y** (0–1 fractions of
  the screen). Use it for a persistent, specifically-placed prompt that shouldn't share the single
  slot — e.g. a standing *"Click spin button to start"* centered above the buttons. Pick a **Font**
  (the project's fonts — the same list the Scene Editor offers; **Game default** matches the rest of
  the game's text) plus optional **Text size** and **Color**.

Decide *when* it shows in one of two ways (a message shows when **either** is true):

- **Visible while** — a state gate: **Idle** (reels not spinning), **Spinning**, **Free spins**, or
  **Always**. Use this for a persistent prompt — e.g. *"Click spin button to start"* set to
  **Idle** appears whenever the game is waiting and disappears the moment a spin starts. No wiring
  needed.
- **Show / Hide** exec inlets — drive it from the graph like anything else. Wire an exec into
  **Show** to reveal it and set **Auto-hide after (ms)** so it clears itself — e.g. a *"Good luck"*
  flash wired from the spin/`reveal` signal with auto-hide `1200`. Leave **Visible while** on
  **None** for a purely flow-driven message.

A **Filter…** box narrows every section as you type. **Drag** a palette entry onto the
canvas to drop the node at the cursor, or **click** it to add near the centre of the graph.

### Wire the graph

Drag from a pin on one node to a pin on another. Two wire classes:

- **Exec wires** (white, arrow-headed) sequence control: an exec-out → an exec-in. An
  exec-in accepts at most one incoming exec edge.
- **Data wires** (thin, dashed, colored by type) carry a value: a data-out → a data-in. A
  data-in accepts at most one incoming data edge; a data-out can fan out to many.

Wiring is **strict** — a wire only drops if it is legal: exec must meet exec and data must
meet data, directions must be right, the data types must be assignable, and the target
in-pin must be free. An illegal wire is simply refused (nothing stray is created).

To **delete** an edge, click it (it highlights) and press **Delete** / **Backspace**; the
same keys delete selected nodes (and their incident edges).

### Edit a node (the inspector)

Click a node to open its **Inspector** in the left panel (the **✕** returns you to the
palette). It shows the node's derived pins and a kind-specific editor:

- **Reference** — for event / action / cue / functionCall / show/hideContainer nodes, a
  dropdown of the valid names from the vocabulary (or the library / declared containers).
- **Data-in Inputs** — for each unwired data-in, a source editor: **literal** (a typed
  value — number, text, checkbox, or an enum dropdown), or **accessor** (a read-only read
  of `$item` / `$index` / `$engine.<key>` / `$input`). A data-in that is **fed by a wire**
  shows a **wired** tag instead (the wire supplies it).
- **Fire Cue** — a **Wait for this cue to finish** tick. Off, the cue is broadcast and the
  chain runs straight on; on, the chain pauses until the cue finishes. Turn it on when a later
  node undoes what the cue starts (a hide that would erase a win line before its symbols finish
  animating). What "finishes" means depends on the cue: an **engine** cue waits for its
  listeners, while a **scene cue you named** waits for the animation it starts — see
  [Scene cues](#scene-cues--animate-a-placed-character).
- **ForEach** — a **Mode** toggle (**sequence** = one item at a time, **parallel** = all
  at once).
- **Sequence / Parallel** — a **Count** (how many ordered / concurrent exec-outs to
  expose).
- **Compute** — an **Op** (`add` / `sub` / `mul` / `div`, or `member` to read a struct
  field) plus its operands. Compute is the *only* place arithmetic and member-reads live
  (accessors only read, they never compute).
- **Branch** — a **Guard** as an *all-of* list of comparisons; add rows with **+ add**,
  each a left source, an operator (`eq` / `ne` / `lt` / `lte` / `gt` / `gte`), and a right
  source. With no comparisons the branch always takes **then**. Either side can be an
  **accessor** reading live game state, which is what makes a branch worth having — see
  below.

#### Reading live game state (`$engine`)

Set a guard operand — or any data-in — to **accessor** → **$engine** and the dropdown
lists what the game answers at runtime. The **values** come first:

| Value | Type | What it reads |
|---|---|---|
| `balance` | number | The player's wallet. |
| `bet` | number | The current total stake (bet × cost multiplier). |
| `win`, `totalWin` | number | The win the book event carried. Two names, one read. |
| `gameType` | `basegame` / `freegame` | |
| `isFreeGame` | true/false | The free-spin feature is running. |
| `freeSpinsRemaining`, `freeSpinsTotal` | number | Spins left, and spins awarded. |
| `autoSpinsRemaining` | number | Autoplay rounds left; `0` when no run is live. |
| `isAutoSpinning` | true/false | An autoplay run is live. |

Then the **collections** (`reels`) — the iterables a **ForEach** walks, rather than things
to compare. You pick a name from the list instead of typing it, so there is nothing to
mis-spell, and each value carries its type, so where an `$engine` read feeds a node's
**data-in** Validation flags a mismatch.

**Comparing in a guard.** Set one side and the other follows its type. Pick
`$engine.isAutoSpinning` and the opposite operand turns into an **on / off** select; pick
`$engine.gameType` and it turns into a `basegame` / `freegame` dropdown; leave both sides
numeric and it stays a number box. So `isFreeGame eq on`, `gameType eq freegame`,
`balance lt 100` and `autoSpinsRemaining ne 0` are all one row. (Only a *literal* is
re-typed like that — an accessor on the other side is left alone, because that is a choice
you made.)

Two runtime rules decide which operator you want:

- **`eq` / `ne` are exact; `lt` / `lte` / `gt` / `gte` read both sides as numbers.** The
  exactness is why the typing above matters: a true/false value compared against a number
  is never equal to it, and nothing warns you.
- **An unbounded value is not a finite number.** Autoplay set to `∞` makes
  `autoSpinsRemaining` infinite, which no `gt` / `lt` test matches — `ne 0` catches it,
  `gt 0` silently doesn't.

### Containers (screens as z-ordered layers)

A **container** is a Scene-Editor scene given an author-assigned **z** (a fully orderable
stack position, not a fixed band). **showContainer** mounts a container at its z;
**hideContainer** unmounts it. Because z is explicit, a celebration screen layers *over* a
live board simply by having a higher z. The set of containers a flow can show/hide is part
of the FlowDoc; the palette and the show/hide reference dropdowns are built from it. Every
Scene-Editor screen is a container — a **background-space** screen too: its space only sets
the coordinate frame (cover-fit to the window). When the flow drives the screens, nothing
is on screen until you **show** it, so a background screen needs its own **show** (usually
off `load`), and a splash on a background-space screen hides exactly when you **hide** it.

#### A Show node also carries its screen's presses

A **showContainer** node's pins are not just exec-in / exec-out. Everything interactive on
the backing screen fuses onto that same node as an extra **exec-out**, captioned
`on<Action>`: a spin button becomes `onSpin`, a confirm dialog becomes `onConfirm` and
`onCancel`, and a whole **Repeater** of tiles becomes a single `onSelect`. Some bring
**data-outs** with them — a repeater's `onSelect` publishes which item was pressed. Three
things follow:

- **Wiring a pin takes that press over.** The button's coded behaviour is *suppressed* and
  your chain runs instead, so the two never both fire. Leave the pin unwired and the game
  behaves exactly as it always has. Ownership is decided by the wire existing — not by
  when, or whether, that Show node runs.
- **Pins are captioned by action, not by node.** A screen with three repeaters shows three
  exec-outs all reading `onSelect` (and three copies of each data-out caption). They are
  listed **in the order those nodes appear on the screen**, so check the Scene Editor's
  outline before you wire.
- **A screen only surfaces what is configured.** A decorative sprite contributes no pin; a
  button contributes one only once it has been given an **Action** in the Scene Editor.

### The bet menu and the auto spin menu — a worked example

The player's two HUD menus — tapping the **bet** readout to change the stake, pressing
**auto spin** to set autoplay up — used to be coded dialogs with no authoring surface.
They are now screens someone builds in the
[Invisible Scene Editor](invisible-editor.md#the-bet-menu-and-the-auto-spin-screens)
(**＋ New bet menu screen** / **＋ New auto spin screen**), and this flow decides *when*
each one opens. Every Scene-Editor screen is a container, so both appear in the palette's
**Containers** section by themselves, as **show Bet Menu** / **show Auto Spin**.

> **Until you wire the two HUD pins, nothing changes in the game** — the coded dialogs keep
> opening and the authored screens never mount. Seeding the screens is safe on a live game;
> this graph is what switches it over.

The actions involved, all in the palette's **Actions** section:

| Action | Takes | What it does |
|---|---|---|
| `setBetAmount` | `amount` (number) | Stakes that amount. |
| `setAutoSpins` | `option` (text) | Picks the round count, without starting a run. |
| `setAutoSpinLossLimit` | `option` (text) | Picks the loss limit. |
| `setAutoSpinWinLimit` | `option` (text) | Picks the single-win limit. |
| `startAutoSpins` | — | Starts a run from whatever is currently picked. |
| `stopAutoSpins` | — | Ends a running autoplay. |
| `openBetMenu` | — | Opens the **coded** bet dialog — for moving that press elsewhere without authoring a screen at all. |

**The bet menu, in four wires.** Drop a **show HUD — bottom bar** node (you will usually
already have one) and a **show Bet Menu** node, then:

1. The HUD node's **`onBetMenu`** exec-out — the bet readout's press — into **show Bet
   Menu**'s exec-in.
2. **show Bet Menu**'s own **`onSelect`** exec-out into a `setBetAmount` action, and its
   **`selectedValue`** data-out into that action's **`amount`** data-in.
3. `setBetAmount`'s exec-out into **hide Bet Menu**.
4. **show Bet Menu**'s **`onClose`** exec-out — the CANCEL button — into a **second hide
   Bet Menu** node. It has to be its own node: an exec-in takes one predecessor, so the
   two chains cannot share a hide.

```
exec   show HUD ▸onBetMenu       ──▶  show Bet Menu
exec   show Bet Menu ▸onSelect   ──▶  setBetAmount  ──▶  hide Bet Menu
exec   show Bet Menu ▸onClose    ──▶  hide Bet Menu   (a second one)
data   show Bet Menu ▸selectedValue  ──▶  setBetAmount ▸amount
```

**The auto spin menu** is the same shape, except the screen collects three picks before it
starts anything:

1. **show HUD — bottom bar**'s **`onAutoSpin`** exec-out (the auto-spin button) into **show
   Auto Spin**.
2. The **show Auto Spin** node carries three `onSelect` pins — one per grid, in screen
   order: round counts, then loss limits, then single-win limits. Wire them into
   `setAutoSpins`, `setAutoSpinLossLimit` and `setAutoSpinWinLimit`, feeding each action's
   **`option`** data-in from that pin's **`selectedKey`** data-out.
3. The START button projects **`onAutoSpinStart`**. Run it into `startAutoSpins`, then
   **hide Auto Spin**.
4. The CANCEL button projects **`onClose`**. Run it into a **hide Auto Spin** of its own.

**`selectedKey` or `selectedValue`?** A repeater's `onSelect` offers both, plus
`betModeKey`. `selectedKey` is the text on the tile that was pressed; `selectedValue` is
the same choice as a number. Take the **number** for a bet amount, because `setBetAmount`
wants one. Take the **text** for the three autoplay ladders: their `∞` option is a
perfectly good `Infinity`, but it reads far better as a string, and the three pickers take
text and quietly ignore anything they don't recognise. (`betModeKey` carries the same
string as `selectedKey` under its original buy-feature name — old graphs wire it, new ones
needn't.)

**Stopping a run.** The HUD auto-spin button is *dual*: pressed while autoplay is running
it stops the run, pressed when idle it opens the menu. Wiring `onAutoSpin` straight to a
**show**, as in step 1, takes that press over wholesale and loses the stop half — so put a
**Branch** in between and let it ask whether a run is live:

```
exec    show HUD ▸onAutoSpin  ──▶  Branch
exec    Branch ▸then  ──▶  stopAutoSpins
exec    Branch ▸else  ──▶  show Auto Spin
guard   $engine.isAutoSpinning   eq   on
```

That reproduces the coded button exactly. (`autoSpinsRemaining ne 0` reads the same state
as a number if you prefer it — but not `gt 0`, which an `∞` run fails; see
[Reading live game state](#reading-live-game-state-engine).)

**Don't skip the CANCEL wires.** Both seeds carry that button because these screens are
full-canvas takeovers: leave `onClose` unwired and the only way off the screen is
committing to a choice. Put `stopAutoSpins` in front of the auto-spin one if you want
cancel to end a running autoplay as well.

### Reusable functions (Collapse to Function)

Select two or more nodes (marquee-drag or shift-click) and the sub-bar's **⤵ Collapse**
button appears. Name the new function and it is extracted into a **functionCall** node in
its place, with its logic moved into a reusable **function body**. Functions live in a
**shared library** (global across every project, not project-scoped), so a function you
collapse in one project is available everywhere.

- **Edit a function's body** by double-clicking its call node, clicking **✎** in the
  palette's Functions section, or using the crumb. The sub-bar breadcrumb reads
  **Flow ↳ &lt;FunctionName&gt;** while you edit a body; **← Back to flow** returns you. A
  body has fixed **Entry** and **Result** nodes (the function's signature) that you wire
  between; those two can't be deleted.
- **Rename** the open function inline in the breadcrumb (its id stays stable, so existing
  call sites keep resolving). **Delete** a function from the palette's **✕** — blocked with
  a message while any call site still references it.

### Validation

The left **Validation** panel lists every issue from the live type-checker (unresolved
reference, unfilled data-in, type mismatch, fan-in violation, unresolved accessor,
function-vocabulary requirement, …) as a code + message. Node- and pin-located issues are
**click-to-focus** — clicking one selects and highlights the offending node on the canvas.
The sub-bar's **⚠ N issues** / **✓ valid** pill mirrors the count. Validation never blocks
authoring; it is a running honesty check.

Two of them read your **screens**, not just the graph. A Show Container with **Wait for this
screen** on holds the round until that screen completes, and there is no timeout by design — so
`hold-without-release` (red) means nothing can ever complete it: its screen has no *Tap to
continue* (or *On loaded*) component, no Hide Container for it can run while the chain is
waiting — one further down the SAME chain cannot, it never gets there — and there is no
`complete:<screen>` event. `tap-without-hold` is the blue **hint** for the mirror: the screen
has a tap surface but nothing waits for it, so the tap advances nothing (it still fires its
tap signal). Both stay silent for a screen the editor could not resolve, so a brand-new project
is never reddened by them.

### Preview (deterministic timeline)

The left **Preview** panel runs a chosen **event** node's handler headlessly through the
real interpreter on a virtual clock. Pick an event, pick a **speed** (**1×** or **2×**),
and click **Run**: the panel lists the ordered side-effect timeline — each **effect / cue /
delay / show / hide** with its resolved payload and virtual **at** stamp, plus the total
step count and duration. Changing the graph clears a stale run. This proves the **order and
timing** of your flow; it is **not** a live visual of the game — that is the running game's
job.

### Auto-save

There is **no Save button** — the editor **auto-saves**. Every edit marks the doc dirty and
(re)starts a short (~0.8s) debounce; when it settles the editor POSTs the current FlowDoc to
`/api/flow-v2/save`, which gates on the `flow` tool + your session's active project and
writes the project's `editor/flow-v2.json`. A burst of edits coalesces into one save. The
save pill in the sub-bar reflects the state (**Saving… / Unsaved changes / Saved / Save
failed — retry**). The shared **function library** auto-saves the same way to its global
key, shown as a separate **Library …** pill. The standalone dev sample (no real project) is
never persisted.

The game reads the saved `editor/flow-v2.json` at runtime through the bake → bundle chain,
so authoring here is what the shipped game actually runs.

## What it does not do yet

- **It does not edit the platform state machine or the math.** The XState platform FSM
  (bet / balance / auto-spin / RGS protocol) and the RGS-determined outcomes are off-limits
  — Flow rides on top of them, reacting to the lifecycle and book events they emit. It can
  *drive* them through the actions they expose (`setBetAmount`, `startAutoSpins` fire the
  same commands the coded buttons do); it cannot change how they behave.
- **No live visual preview.** The Preview panel is a *deterministic timeline* of the
  effects, cues and delays you authored — useful for verifying order and timing, but it
  does not show the game actually animating.

## Known limitations / TODOs

- **Containers and the template are data-only.** The set of containers (scene id + z) and
  the flow's `templateId` are part of the FlowDoc but are not yet editable in the UI — the
  palette shows/hides whatever containers the document already declares. Only the `book-of`
  template vocabulary exists today; an unknown template id falls back to it.
- **Cues inside a component instance aren't offered.** The **Cues** section collects signal
  names from spines and flipbooks placed **directly on a screen**; a character that lives
  inside a reusable component instance keeps its cue names in the component's own
  definition, so they never reach this palette. Such a name is only firable from here if it
  is also one of the engine's cues or is used by a node placed directly on a screen —
  otherwise place the character on the screen itself.
- **A guard operand can't be wired.** Each side of a **Branch** comparison is a literal or
  an accessor chosen in the inspector, so you can't compare against something a **Compute**
  node worked out. Compute what you need into a data-in instead, or restate the test
  against a value `$engine` already exposes.
- **Function inputs/outputs are fixed once created.** A function body's **Entry** / **Result**
  signature (its inputs/outputs) can't be edited yet; adding or removing a function's
  parameters is a later feature.
- The `/flow-v2` editor is the successor to the v1 `/flow` graph and is still on the
  cutover track — the runtime dispatch, book-event ownership and full bake→ship chain are
  landing incrementally (see `docs/STATUS.md`), so verify a project's authored flow against
  the live game before relying on it.

## For developers

- **Design + schema:** [`../design/invisible-flow-v2.md`](../design/invisible-flow-v2.md)
  and `invisible-flow-v2-schema.md` are the source of truth (the Blueprint model, the three
  artifacts, the pin/type taxonomy, the phased plan). Current state + the cutover track are
  in [`../STATUS.md`](../STATUS.md).
- **The tool page:** `apps/launcher-api/src/routes/(app)/flow-v2/` — `+page.server.ts`
  gates on the `flow` entitlement, resolves the active project (`resolveToolScope`) and
  loads the project's FlowDoc (`loadFlowV2Doc`, R2 `flowV2DocKey`) plus the global function
  library (`loadFlowV2Library`, `_shared/flow-v2/functions.json`); `+page.svelte` is the
  authoring canvas (Svelte Flow / `@xyflow/svelte`), owns the doc `$state`, the debounced
  auto-save, and function-view navigation. `FlowCanvasV2.svelte` hosts the flow render +
  drop-at-cursor; `FlowV2Node.svelte` renders a generic node with derived pins;
  `AddNodePalette.svelte` is the palette; `NodeInspector.svelte` is the per-node editor;
  `ValidationPanelV2.svelte` and `PreviewPanelV2.svelte` are the two panels; `graphOps.ts`
  holds the pure graph mutations; `dnd.ts` is the palette→canvas drag contract; `palette.ts`
  is the type → color/label map.
- **Save endpoints:** `POST /api/flow-v2/save` (FlowDoc → project `editor/flow-v2.json`)
  and `POST /api/flow-v2/library/save` (the shared library → `_shared/flow-v2/functions.json`),
  both `flow`-gated.
- **The shared package:** `packages/engine-flow-v2` — the schema (`types.ts`), pin
  derivation (`pins.ts`), connect-time type checking (`assignable`), validation
  (`validateFlowDoc` / `validateFunctionDef`), the `collapseToFunction` op, the deterministic
  `previewFlowEvent`, and the runtime interpreter the game backs. The reference `book-of`
  vocabulary — the events, actions, cues and collections an author works with — is in
  `src/reference/bookOf.ts` (`BOOK_OF_VOCAB`), transcribed verbatim from the `apps/lines`
  game so the contract is honest.
