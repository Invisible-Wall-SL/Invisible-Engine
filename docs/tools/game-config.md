# Invisible Game Config

Author **what a game plays** — its symbol dictionary and payouts, paylines, grid,
bet modes, win model and RTP. This is the frontend's **contract with the math**, not
the math itself: the server stays the authority on outcomes; this doc tells the
client what to draw and what to expect.

- **Where it runs:** Cloud (the launcher itself, Railway).
- **Access:** sign in at `app.invisiblewall.org`, then open `/config` (granted to
  `developer`, `artist` and `pipelineTester` by default; `admin` always).
- **Scope:** per **active project** (use the project selector on the launcher home).
  Each project has its own config.

## Why this exists

Every online project used to run one shared sample config — the same symbols, the
same 20 paylines, the same strips — because that config was compiled into the shared
engine bundle. Nothing a project authored could change it. That's what let a wild
symbol roll past the reels in a game whose math never deals one: the sample said the
game had a wild, and no project could say otherwise.

This tool is how a project says otherwise. Save a config here and the game runs
**yours** instead of the sample. Author nothing and the game is byte-identical to
before — an un-authored project still runs the compiled template.

## The panels

- **Return to player** — the declared RTP. The Game Maker card renders it as the
  game's `97% RTP` chip, and the in-game info page's rules add an **RTP — 97.00%**
  rule — but only where the operator allows RTP display (`showTheoreticalPayback`);
  everywhere else it is left out. The rules' **MAX WIN** heading also states the cap
  (**MAX WIN — 5,000× BET**), taken from the base bet mode's _Max win ×_ — so set the
  real cap there. (A _provider / game name / game ID_ trio used to
  sit here too, under an **Identity** heading. Nothing on this stack read them — the
  info page renders from `infoManifest`, the RGS handshake sends none of them, and
  the on-screen title comes from the launcher's **project name** — so they asked for
  values that changed nothing and were removed. They remain in the config document
  itself, for a future Stake-RGS path.)
- **Grid** — reel count and visible rows, **per reel**. This is the board's size
  everywhere: the game renders this many reels and rows, the Scene Editor draws its
  preview at this size, and a dev game's mock RGS deals it. Changing the reel count
  re-shapes the row list but leaves paylines alone — mismatches surface as errors
  rather than silently trimming your work.

  Give the reels **different row counts** for a **stepped board** — a `3/4/5/4/3`
  diamond, a `2/3/4/5/6` ramp. Each column then draws, and is dealt, at its own
  height. A **Short column sits** control appears once the heights differ:
  _Centred_ (the classic diamond — a 4-row reel beside a 5-row one sits half a cell
  down), _Top-aligned_, or _Bottom-aligned_ (a pyramid standing on a flat floor).
  Only the reels shorter than the tallest move.

  A stepped board composes with everything else the board can do — it can
  **cascade** (tumble), and it can carry a board **perspective** authored on its
  reel-grid node. See [stepped grids](../design/stepped-grid.md).

- **Bet modes** — each entry in the bet selector / buy-bonus menu, edited as a
  per-mode card: the **math** (cost, feature, buy-bonus, RTP, max win) plus the
  **presentation** (kind, menu order, and the copy the card shows). See _Bet
  modes: math + presentation_ below.
- **Coin overlay** — on every project, whatever its kind: an option the base game switches
  on. Its style, the pots and drops, what lands in the base game, and the **triggers** that
  start a bonus. See _Coin overlay_ below.
- **Bonus modes** — the games a bonus switches into: the reels modes (free spins…) with what
  starts each, and one card per **respin mode** (a Hold and Win game of its own) with its
  rules. See _Bonus modes_ below.
- **Symbols** — the symbol **dictionary**: properties and paytable per symbol
  (`count:multiplier` pairs, e.g. `5:20, 4:10, 3:5`). Each row carries an
  **in play** / **unused** badge (see _The strips are the gate_ below); a pots
  overlay's coins are listed apart, under **Coins**. A **scatter** symbol's
  paytable is its scatter pay — × the total bet, anywhere on the board, never a
  line. Left empty it
  pays the default `3:2 4:20 5:200`, which the row's paytable box shows as its
  placeholder. **Import paytable from server** fills the paytable from what the
  game's server actually pays — see _Importing the paytable from the server_ below.
  **Import from a pasted capture**, beside it, does the same from a partner's server
  the launcher can't reach — see _Importing from a pasted capture_. Once a capture is
  kept, a line under the buttons reads _Partner reference: captured from <source> on
  <date> — matches_ (or _N rows differ_) with a **Forget it** link.
- **Coins** — on a project whose coin overlay has pots: the overlay's coins (its pot tokens), in
  pot order, each with the pot(s) it fills and its special properties. No **in play** /
  **unused** badge: the overlay decides whether a coin is used (see _The strips are the
  gate_ below). A coin pays nothing, so a line paytable left on one shows **Drop line
  pays**.
- **How wins are decided** — the **win model**: whether this game pays by **lines**,
  **ways**, **cluster** or **scatter**, plus that model's own settings (ways: which
  direction and the fewest reels; cluster: fewest cells and how they connect;
  scatter: fewest symbols). This is what makes a project a ways game rather than a
  lines one. See _Making a ways game_ below. The same panel carries **Winners
  tumble** — see _Tumbling (cascade)_ below.
- **Free spins** — whether the game has free spins at all, what triggers them
  (which symbol, how many) and how many spins they award. Shown for every kind but
  Hold and Win (no free spins); a Book-of game always triggers on its book. See
  _Free spins_ below.
- **Reel behaviour** — how a round **arrives** on the board: whether the reels roll
  at all, and if not, how the new symbols get there. See _Reel behaviour_ below.
- **Game modes** — every mode's board and presentation (base game, free spins, respin
  modes, your own). See _Game modes_ below.
- **Sounds** — moved to [Invisible Sound](sound.md). The panel here is a pointer.
- **Paylines** — a visual grid, one cell per reel per line, showing the **live server
  (RGS) line set** the game actually deals at runtime — **auto-loaded** when the page
  opens (best-effort; falls back to the saved config if the RGS is unreachable).
  **Read-only** shape; the one thing you _do_ author is the per-line **colour** swatch
  (see _Server-defined paylines_ below).
- **Big win tiers** — the big-win celebrations the game plays, as an ordered list.
  See _Big win tiers_ below. Leave it empty to keep the game's built-in tiers.

## Coin overlay

The **Coin overlay** section sits after Bet modes, before Bonus modes, on every project. It is an
option the base game switches on: what lands in the base game — coins on the reels, tokens dropped
over them, pots that fill — and what **starts** a bonus. Every trigger, pot and meter names the mode
it starts; the bonus games themselves are edited in _Bonus modes_ below. Why the config is split
this way is in [the bonus games plan](../design/bonus-games.md); how the pots and drops work is in
[the pots overlay plan](../design/pots-overlay.md).

Adding a preset **merges** its parts into the config — it never resets the doc or replaces anything
already there. If a name it brings (a symbol, a pot id) is already used, it takes the first free
`_2`, `_3`… suffix everywhere the preset names it, and the section says which names changed.
Nothing is stored until you **Save**.

After saving an overlay change, **reload any open game tab**: a tab keeps the overlay it booted
with, and the test server goes on dealing it that game until it reloads. Adding one here puts its
symbols in the config only. Their art is seeded only by Game Maker's **＋ Coin overlay…** (or
**Coin overlay parts…**); otherwise bind it in Symbols. Until then a token, a coin or a Hold and
Win special draws a coded placeholder disc.

**Style** — once the project has an overlay, pick how it plays:

- **Classic** — coins land on the reels; enough start the bonus;
- **3 Pots** — tokens fill pots; a full pot starts its bonus;
- **Collector** — a collector beside coins starts the bonus.

The overlay has three panels: _Pots and drops_ (only when it drops something), _Base game_ and
_Triggers_.

### Adding one

With no overlay yet, the section offers two ways in:

- Pick a preset and how many **pots** it starts with (0–5; the preset's own count is picked for
  you), then press **＋ Coin overlay**. It adds the overlay with its pots and drops (below).
- **＋ Coin overlay without drops** — a Classic overlay with no pots and nothing dropped: coins
  land on the reels, and its triggers (below) start the bonus.

An overlay without drops keeps the preset row, its button now reading **＋ Pots and drops**, so you
can add them later. The presets:

- **3 Pots (each pot a Hold and Win with its special)** — three pots, each starting a Hold and Win
  respin mode with a different special active.
- **Pots to free spins** — one pot that starts free spins.
- **Coins only (6+ value coins start a classic Hold and Win)** — no pots. A tenth of spins drop 1
  to 8 value coins, and 6 or more start the Classic Hold and Win (about one spin in 27, mock math).

It adds the overlay and its **token** symbols. Tokens go in the Symbols dictionary only — a strip
never deals them. The 3 Pots and Coins only presets also add a Hold and Win respin mode (its rules,
the symbols its respin board deals and its respin strips) — unless the project already has one, in
which case the overlay uses that one. **Coins only is refused on a Hold and Win game**: its Hold and
Win is started by the coins landing on its reels, so dropped coins would start nothing (for the
same reason, a value-coin drop on such a game gets a warning).

### Pots and drops

Tokens drop over the symbols during a spin and fly to pots; a full pot starts its bonus. Value
coins can drop too: enough of them on one spin start Hold and Win with those coins held. Pots and
value coins are each optional, but the panel needs at least one of the two:

- **pots only** — tokens fill pots, and a full pot starts its bonus;
- **coins only** — no pots: value coins drop over the host's symbols. Enough on one spin (the coin
  count trigger, e.g. 6+) start Hold and Win with those coins held; fewer are shown, then cleared
  on the next spin;
- **both** — the 3 Pots shape.

**Pots** (the server keeps each player's level). **How many** sets the count, 0 to 5:

- Raising it adds pots at the end. Each takes the next free id of red, blue, green, gold, purple
  (the coded pots' colours), its own `POT_<ID>` token, the last pot's max level and size stages, a
  drop-table row at the last pot's weight, and the last pot's bonus. A Hold and Win pot takes the
  next special no other pot starts with (payer, collector, multiplier, then mystery…), or _no
  special_ once none is left.
- Lowering it removes pots from the end, with their drop-table rows and their tokens (a token you
  have given a payout or another role is kept).
- **0** leaves coins only (above). It is offered only when the Hold and Win is the overlay's bonus
  — not on a Hold and Win game, whose own respin mode counts only the coins landing on its reels.
  The overlay also needs a coin count trigger. A value-coin row is added if the table has none,
  and **Most per spin** is raised if it could not reach the trigger; the section says so, and it
  stays raised if you add pots back. Hover the picker when 0 is greyed out to see why.
- Lowering it, the section names the pots it removed. What you authored for them elsewhere (a Pot
  Meter, a Win Text name, a flight style) stays and comes back if a pot with that id returns.

One row per pot:

- **Id** — renaming a pot also renames it in the drop table.
- **Token** — the symbol that fills it. Untagged `meterSpecial` symbols, and symbols a strip
  deals, are marked in the list. **＋ new** makes a fresh token for the pot — `POT_<ID>`, tagged
  `meterSpecial`, on no strip.
- **Max level** — the level at which the pot is full.
- **Size stages** — the levels where the pot grows, as a comma list (e.g. `5, 9`).
- **Starts** — the bonus a full pot starts: any bonus mode, a respin mode or a reels mode such as
  free spins (see _Bonus modes_).
- **With** — for a respin mode, the special that starts active (or _no special_; a special that
  mode's rules haven't configured says so). For a reels mode such as free spins, the number of
  **spins** — mock only; the real count is the server's.

**+ pot** opens a draft row, up to 5 pots. Pick its token and its bonus, then press **Add pot** —
only then does it join the config, because a pot missing either would be dropped on save. **×**
discards a draft, or removes a pot along with its drop-table rows. The last pot's **×** works
exactly like setting **How many** to 0 (same rule, same coin row), and the last value-coin row can
go only while there is a pot (the **×** is greyed out otherwise; hover it for why) — to take out
both, use **Remove pots and drops**. With no pots the table says _No pots: value coins only_.
Changing **How many** discards open drafts first.

**Drops** — mock math; the real RGS decides what drops:

- **Chance per spin** (0–1) and **Most per spin**.
- The weighted **drop table** — each row drops _a token for a pot_ or _a value coin (Hold and
  Win)_, with a weight; its share is shown beside it. **+ drop** adds a row (a value coin when
  there are no pots). With value coins and a coin count trigger, a note under the table says how
  many coins on one spin start which mode. Keep **Most per spin** at or above that count, or the
  coins can never start it (a warning says so).
- **Reels a token can land on** — none ticked = every reel.
- **Modes that drop** — the base game by default; only modes on the reels are offered, since only
  they have a cell to drop on.

**Presentation → Tokens appear** — _after the last reel stops_ (the default) or _as each reel
stops_. It changes only how the game shows a drop; the server never sees it. A board that swaps in
place instead of rolling always shows its tokens together.

Problems show under the row or field they belong to, and that field gets a red border.

**Remove pots and drops** asks first, then takes out the pots, the drop table and their token
symbols. If the Hold and Win is the overlay's bonus, its respin mode goes too, with its respin
strips and symbols. Everything else in the config is kept.

### Base game

What lands in the base game. A coin landing in the base game shows a value from the coin table of
the respin mode it starts. The panel shows only when some respin mode configures a special:

- **Specials in the base game** — one row per special that some respin mode configures:
  **Lands in the base game**, and for the collector and the multiplier, **… + coin in the base game
  pays at once**.

### Triggers

What starts a respin mode — any one of these. Each has a **starts →** picker listing the project's
respin modes; with none, the panel is greyed out and asks you to add one in **Bonus modes** first.
(Free spins are started by their scatters, in _Free spins_.)

- **Coin count** — **At least** N symbols of the roles you tick, anywhere on the board.
- **Pattern** — **+ requirement** adds a row: a reel, **At least** N, and the roles; every
  requirement must hold on the same spin.
- **Buy tiers** — **+ buy tier** picks a buy-bonus bet mode (its price is that mode's cost, shown
  beside it — change it in Bet modes; with no buy-bonus mode the button is off). Tick **Specials
  land more often in this feature** if they do, and list what is **Guaranteed on entry** (a count
  and a role, **+ guaranteed**).
- **Random metre** — the server triggers it, dressed as a metre; give it a **Name**.
- **Lucky Spin** — a server-announced spin that guarantees the trigger.
- **Meters** — filled by a landing symbol; the server keeps each player's level. **+ meter** adds
  a row: **Id**, **Filled by** (a symbol; one not tagged `meterSpecial` says so), **Max level**,
  **Size stages**, the special it **Activates**, and the mode it **Starts**.

**Symbols get their role in the Symbols panel**, through their special properties: `coin`,
`jackpot`, `collector`, `coinMultiplier`, `payer`, `mystery`, `addRespins`, `upgrade`,
`meterSpecial`, `blank`, `unlock`. The role checkboxes above use those roles.

## Bonus modes

The **Bonus modes** section follows Coin overlay. It lists the games a bonus switches into:

- **On the reels** — a table of the reels bonus modes (free spins and your own) with what starts
  each (_nothing yet_ if nothing does). Free spins are set in _Free spins_, other reels modes in
  _Game modes_.
- One card per **respin mode** — a Hold and Win game of its own, with its own rules, respin strips
  and symbols. A project can have several.

What starts each one — a coin count, a pot, a buy, Lucky Spin — is set in _Coin overlay_.

**A respin mode's card:**

- **Id** — renaming it carries what starts it along. Re-tag its screens (the role _game mode_ in
  the [Scene Editor](invisible-editor.md), see "Game mode screens") and its tab in
  [Flow](flow.md#game-modes--one-graph-per-mode). The
  `holdAndWin` id is locked: its screens and its Flow tab know the mode by that name.
- Its **respin strips** (the game type they pad from, and how many reels) and what it is **started
  by** (or _nothing yet — route a trigger or a pot to it in Coin overlay_).
- **Show rules** / **Hide rules** folds its rules editor (below).
- **Remove** asks first, then takes out its rules, every trigger and meter that starts it, its
  respin strips and the Hold and Win symbols only they deal. A pot that started it is re-routed to
  free spins — or, with free spins off, removed with its drops; a note under the heading says which.
  The rest of the config is kept.

**The game plays every respin mode** (bonus-games Phase 4): a pot or trigger plays the mode it
starts, on that mode's own rules, respin strips and screens. One respin mode plays at a time.

A respin mode without rules says so, and **Start empty rules** gives it a default set to edit (one
cash coin). Without rules it is an error only when something starts it (nothing could play it);
otherwise a warning. A respin mode nothing starts never blocks a save: its issues are warnings, and
its card says to route a trigger or a pot to it in Coin overlay.

**Add a respin mode** — type an id (left blank it is `holdAndWin`, or `holdAndWin_2`, `_3`… when
that is taken), pick a preset or **Empty rules (no strips)**, and press **＋ Respin mode**. A preset
brings its rules, respin strips and symbols; then route something to it in Coin overlay. A bad or
taken id is refused beside the button.

- **Pots (3 Pots of Egypt)** — 5×3, 25 lines, decimal coin values, four specials, three pots,
  Lucky Spin, a full board pays GRAND.
- **Classic sticky (Grand)** — 5×3, 5 lines, a BOOST multiplier, G-R-A-N-D column letters, Buy and
  Super Buy.
- **Collector streak (Super Hotfire Diamonds)** — 3×3, coins on reels 1 and 3 only, a COLLECT on
  reel 2, only collectors stick, a pre-feature wheel.

To replace the whole config with one of these games, pick it in the banner's preset menu and press
**Reset to preset** (it asks first; a lines project's menu offers the **Book of Thermopylae**, see
_Free spins_). A new Hold and Win project already has its own config: Game Maker saves the preset
picked at **Create** (Pots unless you chose another), so the page opens on an authored doc, not the
template.

### The rules

Each respin mode's rules editor holds the tables for each symbol role, and each special's card
lists the symbols carrying its role (or asks you to tag one). A symbol with a Hold and Win role
shows its value table in the paytable instead of line pays — it never pays on a line. Problems are
reported under `modes.<id>.holdAndWin`.

- **Respins** — what sticks (every coin, or only collectors), the starting count, what resets it
  (a new coin, or any new coin or special), an optional cap, and **Play**:
  - **Automatic** (the default) — the respins follow each other on their own, and a tap speeds them
    up;
  - **Manual** — the player presses **SPIN** for each respin. Under autoplay or hold-to-spin the
    respins still run on their own.

  The intro and the outro advance on their own either way.
- **Board end** — none, a **full board** jackpot (and which roles count as filling), or **column
  letters** (one letter per reel; a full column lights its letter and, if you tick it, clears;
  every letter lit pays the jackpot).
- **Board expansion** — tick **Rows unlock during the feature** to grow the respin board below the
  base grid. **Starts at** must be the grid's rows (the base game plays them); **Grows to** is the
  most rows it reaches. **A row opens when**:
  - **the bottom open row is full** — every cell of it held;
  - **an unlock symbol lands** — a symbol tagged `unlock` (pick the reels it may land on); it opens
    one row and leaves;
  - **enough symbols are held** — one threshold per row that can open, rising, each reachable on
    the rows open before it.

  **An unlock resets the respins** (on by default). **Row jackpots** pay a jackpot once when that
  many rows are open (e.g. 6 rows → GRAND). With a full-board jackpot, a full board means every
  cell of **all** the rows it can grow to. The checker refuses column letters with expansion (a
  letter needs a fixed column height) and the full-row rule when only collectors stick (a row could
  never fill). No preset expands — the `pots-expansion-fullrow`, `pots-expansion-unlock` and
  `pots-expansion-count` mock fixtures exercise it.

- **Coin values** — cash coins (× total bet; 1.5 is fine) and jackpot coins, each with a weight
  (its share is shown) and the reels it may land on (none ticked = every reel).
- **Jackpot tiers** — name and × total bet. Renaming a tier renames every reference. Untick
  **Fixed** for a **progressive** tier: it gets a pool with a **seed** (where it starts, and goes
  back to when won), **+ per bet** (what every bet adds, × total bet) and an optional **cap**. The
  server keeps the pool per player and pays it when the tier is won; the jackpot bar shows it live.
  No preset has one — the `pots-progressive` mock fixture exercises it.
- **Specials** — collector, multiplier, payer, mystery, add respins, upgrade; each switched on
  separately with its own table. Then the **apply order** for specials landing on the same respin
  and which are **active when the feature starts**. A mystery can reveal any of the others.
  - **Add respins** — the respins it adds when it applies (whole numbers, weighted). **Also raises
    the count a reset fills back to** makes every later reset fill to the higher count too (the
    respin **cap** — most respins played — is never raised). **Sticky** keeps it on the board
    afterwards, holding its cell and worth nothing; off, its cell clears once it has added. Plus
    the reels it may land on.
  - **Upgrade** — the rules it may apply, each with a weight (one is drawn per landing): **every
    cash coin** by its step, **the cash coins in the 8 cells around it** by its step, or **the
    lowest jackpot coin, one tier up** (MINI → MINOR; never past the top tier — needs at least two
    jackpot tiers). The **step** table is × total bet, decimals allowed; the jackpot-tier rule
    ignores it. Jackpot coins are never raised by a step. Plus the reels it may land on.
- **Wheel** — prizes spun once as the feature starts: coin boost, extra collect, or a jackpot.

Whether a special also lands in the base game is set in _Coin overlay → Base game_; a landing there
only counts toward a trigger that counts its role.

The win model is locked to **lines** on a Hold and Win game — a Hold and Win base game pays by
lines (not when the Hold and Win is the overlay's bonus). The checker names impossible setups (a
pattern on a reel that doesn't exist, only collectors sticking with no sticky collector, a letters
word that doesn't match the reel count, a jackpot name no tier has…).

## Reel behaviour

Most slots roll. This panel is where a project says it does something else — and it
lives here, rather than in the Scene Editor beside the board's shape, because it is
**one fact about the game**. A reel grid node is authored per aspect ratio, so
putting the switch there would have allowed a board that rolled in portrait and
swapped in landscape.

Everything in the panel is off by default. A project that never opens it stores
nothing, and its board behaves exactly as it always has.

**Swap symbols in place — no spinning reels.** The board stops rolling. _How_ the
new symbols arrive is the swap style below. Because there is no roll left to
describe, the reel-shaped behaviours stand down while this is on — **reel
anticipation** (and its camera), **sequential reel stop** and **stacked pictures**.
None of them is lost; untick this and they come back. Everything below only applies
while this is on.

**Swap style** — how the new board gets there.

- **Drop in** — the whole board falls at once. This is the shipped behaviour and
  what you get if you never touch the field.
- **Column cascade — left to right** — the standing board drains out of the bottom
  column by column, and each column refills from the top as it empties. This is the
  "the symbols fall, and when a column is empty new ones drop in" reading.
- **Emerge — appear in place, no travel** — nothing falls, slides or drains. Each
  symbol appears on its own seat and plays its **Intro** animation right there.

**About Emerge.** The other two styles answer _"where does the board come from"_;
this one answers _"nowhere — it surfaces where it stands"_. It is the style for a
game whose symbols rise out of water, fade up, or grow into place, and you cannot
get there by shortening a fall: a fall that lands instantly is still a fall, and it
still plays its **Land** animation _after_ the movement rather than instead of it.

The animation is the whole arrival, so it is authored per symbol as the **Intro**
state in the Symbols tool — a column that only appears there once this style is on.
A symbol with no Intro binding falls back to its **Land** animation, so switching
the style on before any art is bound gives you a board that appears and plays its
ordinary landing, not an empty board.

Pair it with **Clear the board** below for the full picture: the old symbols play
their Explosion and leave, then the new ones surface.

**It governs a win as well as a spin.** On a cascading game the refills after a win
appear in place too, so the board never drops symbols in from the top — one behaviour,
not two. The symbols that did _not_ win still slide, because they are relocating rather
than arriving: the refills stack above them, so a surviving symbol genuinely changes cell
and has to be seen doing it.

**Column stagger (ms)** — shown for **Column cascade** and **Emerge**, the two
styles whose columns arrive on their own beat. It is the one knob for _"the columns
arrive at different times"_ — the gap between one column starting and the next:

- **blank** — the style's own default. For a **cascade** that is 140 ms, which sits
  beside the reels' own per-reel stagger so the sweep reads at a familiar speed. For
  an **emerge** it is **0**: "the board appears" is the style, and a sweep is a
  flourish on top of it rather than part of it.
- **short** (under a whole column's worth) — more overlap, a faster wave.
- **long** (roughly 1000 ms or more on a 5-reel board) — column 2 does not start
  until column 1 has finished: strictly **sequential**.
- **0** — every column starts together, so the whole board arrives as one.

The panel tells you what the last column pays: _"on 5 reels the last column starts
560 ms after the first"_. Past about a second in total you get a warning, because
every round is that much slower.

**Clear the board before the new symbols fall in** — available for **both** styles, and what it
does follows the style, because what is being replaced does:

- **Drop in** — the whole board clears at once, ahead of the fall.
- **Column cascade** — each column clears **on its own beat, instead of draining**. The column pops
  away rather than sliding out of the bottom of the window; the sweep, the stagger and the refill
  are otherwise identical. It is one or the other, never both — a column that popped _and_ slid out
  would play the beat twice.
- **Emerge** — each column clears **on its own beat, ahead of the symbols surfacing there**. This is
  the half that makes the old board _leave_ rather than blink out; without it, a column's old
  symbols are gone the instant its new ones appear.

However it is reached, the outgoing symbols play their **Explosion** state, authored per symbol in
the Symbols tool. A symbol with no Explosion state vanishes rather than popping.

So the three styles give you six pictures: drop-in replace, drop-in clear-then-drop, cascade
drain-and-refill, cascade pop-and-refill, emerge-in-place, and sink-then-surface.

Settings you switch off are **kept**, not deleted: tick the clear step, switch to a
column cascade to compare, and switching back restores it. The panel and the
warnings tell you when a saved setting is currently inert.

## Game modes

A mode is a different game a bonus switches into — its own board, screens, HUD and
music. The **Game modes** panel (below Reel behaviour) lists every mode the project
has, one row each:

- **Built-in** rows (chip `built-in`) are the modes every game has without authoring:
  `basegame` and `freeSpins` (game type `freegame`). Their values show greyed as
  placeholders; type into a field to override just that field, clear it to go back. An
  edited row shows `built-in · edited` and a **Reset** button.
- **Respin modes** (chip `Hold and Win · Bonus modes`) are listed here for their
  presentation fields only — label, HUD, music and the rest. They are added, renamed and
  removed in _Bonus modes_, so their **Board** is locked to the respin board and they
  have no **×**.
- **Your own modes:** type an id under the table and click **+ mode** (or Enter). The
  id must start with a letter and use only letters, digits, `_` and `-`, and must not
  already exist. **×** removes it.

The columns (in brackets, what a blank field means on your own mode):

- **Board** — what it plays on: reels, wheel, none — or the respin board, which only a
  respin mode plays on. Switching another mode's board never offers the respin board: add
  a respin mode in _Bonus modes_ instead.
- **Label** — the name the tools show (the id).
- **Game type** — the `gameType` the game runs while the mode is on; a reels mode
  pads from the padding strips of that key (the id).
- **HUD** — a Scene Editor `hud_*` screen id (the base HUD).
- **Music** — the cue played on entering (music unchanged).
- **Counter** — where the mode's counter reads from (no counter).
- **Values** — comma list of the values the mode exposes to the flow and HUD.

To show screens only while a mode plays, tag them in the Scene Editor with the role
**game mode** and this id. Only departures are saved: a field that restates a
built-in is dropped on save, so a project that never touches the panel stores no
`modes` at all. Issues appear under the panel with a `modes.<id>` path — the base
game must stay on the reels (error), and a reels mode whose game type has no padding
strips warns.

## Sounds

**Moved to [Invisible Sound](sound.md).** Which cue the game plays at each named moment
— the cascade pop, the reel-stop ladder, the landing cues, the per-symbol exceptions,
the win-tier stings — is chosen there, next to the library the cues come from and the
button that plays them.

It moved because splitting "which sound" from "the sounds" across three tools is what
let names sit bound to nothing for the whole life of the fork: the audiosprite shipped a
five-rung cascade ladder that no code path ever played, and 26 of its 53 regions had
never been heard at all.

A project set up before the move keeps playing exactly what it played. Its choices are
read out of this doc until someone saves in the sound tool, which moves them for good.

## Tumbling (cascade)

A **tumbling** (cascading) game removes the symbols that just paid, drops the ones
above them into the gap, refills from the top, and pays again on the new board — for
as long as the new board keeps paying.

The chain runs until a board pays nothing, and the round pays the **sum of every**
board in it. A spin that pays nothing to begin with does not tumble at all — the
board simply sits until the next spin.

**You normally do not set this.** It follows the win model, because for two of them
it is not a variant but the mechanic itself:

| Win model   | Winners tumble |
| ----------- | -------------- |
| **Lines**   | no             |
| **Ways**    | no             |
| **Cluster** | **yes**        |
| **Scatter** | **yes**        |

The **Winners tumble** dropdown is there for the cases that depart from that — a
cluster game you want to settle like a normal reel game, or a lines game you want to
give the tumble to. The hint under the panel tells you when the project is
overriding its type's default. Only a departure is saved, so a project that agrees
with its win model stores nothing.

**Authoring the explosion.** As a winning symbol leaves the board it plays its
**Explosion** state from the [Symbols tool](/docs/symbols) — an ordinary authorable
symbol state, like Land or Win. A project that has not authored one will see the
winners simply vanish, which reads as a bug and is not one.

**Reload the game after changing it.** The tumble is dealt by the server, and the
Invisible Test Server re-reads this config on its own (see _Reaching the server_
below) — so a save plus a reload of **Live ↗** is enough to try it. Players get it
when you **Publish**.

### Collecting multipliers

A **scatter** game that tumbles also collects. Multiplier symbols land in the
refills during a cascade; when the chain ends they play their **Win** state where
they sit, fly to the middle of the board, and their values add up into one board
multiplier that multiplies the round.

There is nothing to switch on. It happens when all of this is true:

- the win model is **Scatter**;
- **Winners tumble** is on (multipliers land _in_ a tumble — with no tumble there is
  nowhere for them to land);
- the project has a symbol whose **special properties** include `multiplier`, and that
  symbol appears on a reel strip.

That last one is the gate worth knowing about: a multiplier symbol sitting in the
dictionary but on no strip can never be dealt, so the game will tumble and never
collect. The stock **scatter** template already ships `M` as a multiplier symbol and
puts it on the strips, so a project seeded from it collects out of the box.

## Free spins

The **Free spins** section sits right under _How wins are decided_. It decides
whether the game has the free-spins feature at all, and what lands it.

- **Free spins** — _on_ (the default) or _off — no free spins; scatters only pay_.
- **Trigger symbol** (only while on) — _Scatter (default) — S_ follows whichever
  symbol is your in-play scatter; or pick any symbol on the reel strips. A symbol
  that is not on the strips is listed with _(not on the strips)_ and is an error:
  it is never dealt, so free spins could never trigger.
- **How many** (only while on) — the fewest trigger symbols, **anywhere on the
  board**, that award the feature. Default **3**, and **3 is the least** allowed:
  free spins retrigger on the same rule, and at one or two a retrigger would come so
  often that the feature never ended. More than the board has cells is an error too.
- **Random amount** (only while on) — _off — each row awards a fixed number_ (the
  default) or _on — a random number between two values_. It applies to both tables
  below.

Two small tables under the fields set **how many spins** are awarded:

- **Free spins awarded** — the spins for entering the feature, one row per trigger
  count. Default: one row, _3+ S → 10_.
- **Retrigger adds** — the spins added when the trigger lands again during free
  spins, the same way. Default: _3+ S → 5_ (a Book-of game: _3+ S → 10_).

A row may award at most **200** spins (its **To** too), and a table may have no
more rows than the board has cells — both errors past that. **200** is also the most
one free-spins round reaches on the Invisible Test Server: a retrigger that would
pass it awards nothing, so every round ends.

Each row is **Trigger symbols** (an editable count, shown as _3 + S_), **Spins** and,
with Random amount on, **To** — the top of the range, both ends included. A row
awards for its own count **and every count above it, up to the next row**: with rows
_3 → 1 to 3_ and _4 → 3 to 5_, three scatters award 1–3 spins and four or more award
3–5. **+ row** adds a row one count above the highest; **×** removes one (removing
the last row puts the default back). With nothing authored the table shows the
default row, so you edit from what the game does now; editing it back to the
default leaves nothing stored. A range is kept while Random amount is off — that row
then awards its **Spins** — so switching it back on restores the range.

Rows stay where you typed them while you edit; they are put in count order when you
**Save**. Two rows with the same count are an inline error under the table (and
Save stays off) rather than one of them being dropped. Also flagged: a table whose
first row starts above **How many** (that landing would award nothing — an error), a
row that is never used because a later row below the trigger count takes over (a
warning), a **To** below its **Spins** (an error), and Random amount on with no row
that has a range (a warning — the switch does nothing).

The line under the tables states the rule in force, e.g. _3 S award 1–3 free
spins, 4+ award 3–5; +5 when they land again during free spins_. The trigger is
counted on its own: a scatter keeps paying its **scatter pay** whatever triggers the
feature, and a trigger symbol that pays nothing is fine. The info page's rules state
the trigger but not the award.

**The expanding symbol (Book-of).** On a game that pays by lines, with free spins on, the section
ends with an **Expanding symbol** switch: _off — free spins play like the base game_ (the default)
or _on — one symbol is drawn to expand (Book-of)_. When free spins start, the server draws one
paying symbol; on each free spin, once it covers enough reels it fills them and pays on every line,
then the other symbols pay their lines. Switched on, a table lists every symbol that can be the
special — on the reel strips, with a line paytable, and no scatter, wild or Hold and Win symbol:

- **Weight** — its share of the draw; every symbol starts at **1**. **0** leaves it out.
- **Chance** — the weight as a percentage of the draw (_never_ at 0).
- **Expands from** — the fewest reels it must cover to expand and pay (default **3**; the Book of
  Thermopylae's top symbol expands from 2).

A line under the table states the rule in force, e.g. _H1 9.0% from 2 reels, H2 9.0% from 3
reels, …_. Its problems show under it: a weight on a symbol that cannot be the special, nothing left
to draw, **Expands from** above the reel count (errors); a threshold on a symbol that is never drawn,
or a symbol that would expand and pay nothing at that many reels (warnings). With free spins off the
switch is hidden and the block is kept; a warning says it does nothing. A project with the symbol
gets the book columns in Invisible Symbols and the expanded-win line in Win Text, and its rules page
explains the expanding symbol.

The usual trigger is the **book** — a symbol that is both **scatter** and **wild** (a game may have
only one): it lands anywhere to trigger free spins and substitutes on lines. To start a whole game
from the captured one, pick **Book of Thermopylae** in the banner's preset menu (a lines project)
and press **Reset to preset**: 5×3, ten lines, the book `S`, the captured paytable, weights and
thresholds, +10 on a retrigger and a 100× buy. Game Maker's **Create** offers the same as
_Lines → Book of Thermopylae_. On a **Book-of** kind project the switch is not offered: its server
(the book mock) deals the captured special whatever the config says, until the project is moved to
lines.

**On a Book-of game.** The section is the same, with two differences. The
**Trigger symbol** is shown, not picked — _the book — S_ — because a Book-of game
always triggers on its book; **How many** still sets how many books it takes. And
the retrigger default is **+10** (the captured Book of Thermopylae rule, which the Book of Borut
remake has always been dealt), so a
Book-of game you have not touched plays exactly as before; editing the table back
to _3+ S → 10_ leaves nothing stored. With free spins off, the buy also leaves the
bet menu, and books still land but pay nothing (a Book-of book pays no scatter
pay). The expanding special still starts every Book-of free spins round.

**Turning free spins off.** No spin enters the feature on the Invisible Test
Server — not a natural one, not a forced one. Scatters still land and still pay
their scatter pay; to remove them altogether, take the scatter symbol off the reel
strips. The trigger and award settings are kept, so switching back on restores
them. A **coin overlay** pot whose bonus is free spins is a blocking error while they are off
(route it to another bonus, or switch free spins back on). A
**buy** mode now has nothing to sell, so it becomes a **blocking error** —
_Free spins are off, so the "bonus" buy mode has nothing to buy. Remove it in Bet
modes._ — and the config cannot be saved until you remove it (the stock templates
ship a `bonus` buy). A project with a **Hold and Win** or **pots** bonus is exempt:
a buy can buy that instead. The Bet modes section repeats a one-line reminder while
free spins are off.

**What the player reads.** The info page's rules follow the setting. With free
spins off, the **SCATTER** rule drops "3 or more trigger the Free Spins feature". With the
**Expanding symbol** on, an **EXPANDING SYMBOL** rule follows the free-spins rules ("When Free Spins
start, one symbol is chosen at random to be the expanding symbol…"); its heading and body are
translated in [Localization](/docs/localization) like the other rules.
With a trigger other than 3 scatters, it drops that sentence too and a **FREE
SPINS** rule states the trigger (_FREE SPINS — 4+ SCATTER_, or _4+ H1_ for a symbol
with no scatter/wild role).

**A game played against a partner server** (Play4Fun) is not dealt by these
settings — the partner's own math decides its free spins. They change only the
rules page and the Invisible Test Server, so on such a game set them to match the
partner's rules. The section says so on every project: the launcher cannot tell
reliably which projects a partner deals.

**The Flow does not switch free spins off.** Removing the free-spin chain in the
Flow only stops the game _presenting_ the feature — the server still decides to
enter it. This section is the switch.

**Reaching the server.** The test server's mock reads this from the game's config
like the rest of the math (see _Reaching the server_ below): **save, reload Live
↗** to try it; players get it at the next **Publish**. A trigger symbol the test
server has no name for (outside the standard `H1`–`H5`, `L1`–`L5`, `W`, `M`, `S`)
cannot reach it: the server keeps its own 3-scatter rule and the launcher logs a
warning naming the project. A **partner server** (Play4Fun) decides its own
outcomes — a game played there must have the same rule in the partner's math.

## Big win tiers

By default the game uses a built-in table of win levels (BIG / SUPER / MEGA / EPIC /
MAX and the smaller bands below them), and the win each spin lands on is computed
from a fixed threshold ladder. The **Big win tiers** panel lets a project replace the
CELEBRATIONS with its own — however many big tiers it wants, named, with its own
thresholds.

This panel owns tier **structure only** — how many big tiers there are, their names,
thresholds, order, and escalation. Each tier's **presentation** — the rig bundle,
intro / idle / outro animations, duration, and SFX / BGM — is authored on the **Win
Overlay** component in the Scene Editor, which reads these tiers **by alias** and
renders one presentation group per tier, so the two stay in sync (see
[the component guide](./component-editor.md)).

The panel shows only the **big-win** tiers. The smaller win bands (the floor that
makes modest wins present as a plain count-up number) are engine plumbing, so they
are **managed automatically** from the game type's default and hidden here — a note
under the list reports how many are in effect. This keeps the ladder valid (a big
tier always sits above a low floor) without asking the author to tune plumbing.

Each big tier has:

- a **name** (the caption, e.g. "BIG WIN") and its **alias** (a stable id, set when
  you add the tier — the key the Win Overlay component's presentation group binds to);
- an amount **threshold** — the win as a multiple of the total bet at or above which
  the tier applies. Thresholds ascend down the list.

The rig bundle, animation names and duration are **not** on this panel — set them on
the Win Overlay component per tier (a rig picker + intro / idle / outro dropdowns of
that rig's animations + duration). A tier's **sounds** are in
[Invisible Sound](sound.md) → **Win tiers**.

Reorder tiers with the ↑ / ↓ arrows. **Load default big wins** (shown when empty)
seeds the game type's default ladder — managed floor plus its big tiers — so you can
rename, trim, or retune. Removing every big tier reverts to the built-in behaviour.
The read-out strip at the top previews the big tiers.

**Sequential escalation** (the checkbox): when on, a win that lands on tier N plays
each tier from the escalation start up to N in sequence — tier A's intro + idle,
then tier B's, … then the final tier's intro + idle + outro (the outro plays only on
the final tier), all over ONE continuous count-up to the final amount. **Start from**
picks where the chain begins (default: the first big tier). Off ⇒ a win plays only
its own tier, exactly as the built-in table does.

Leaving the whole panel empty keeps the built-in table and the built-in ladder —
byte-identical to a game that never touched it.

## Server-defined paylines

The **paylines** panel is **read-only** and reflects the **server (RGS)**: at runtime
the game takes its active lines from the RGS's declared `availablePayLines`, and the
in-play symbol set from the RGS's `symbols`. So the panel doesn't render the saved
config's lines — when the page opens it **auto-loads the game's real line set from its
mock RGS** (a best-effort, side-effect-free read of a fresh heartbeat) and shows those,
so the tool reflects what actually ships (e.g. Book of Borut deals 10 lines, not 20
authored). If the project has no mock RGS, or the RGS is unreachable, the panel falls
back to rendering the saved config's lines and says so. Either way the shape is a
view, not an editor. **Reel strips are no longer a panel** — the cosmetic spin strips
are server-defined / auto-generated from the in-play set at runtime, so there was
nothing left to author.

You still author **one** thing on the paylines panel: each line's **colour** swatch.
The game draws that line's win in this colour and broadcasts it so assets shown on the
win can pick it up (leave it unset to use the single default from the Symbols tool).
Colours are keyed by line **index**, so they line up with the server's lines in order
(a line past the end of the authored config keys its colour by its 1-based position).

When there is **no** server declaration (a stock dev build, or the real engine RGS),
the game falls back to the authored/compiled paylines and strips exactly as before.

## The strips are the gate

The **dictionary** (Symbols panel) describes every symbol the game _can draw_ — art,
properties, payouts. The **strips** describe what the game _actually deals_. A symbol
can legitimately sit in the dictionary and appear on no strip; when it does, the tool
marks it **unused** and warns that its paytable advertises a payout no one can win.
This is the one rule that keeps a game from advertising symbols it never deals. With
the strips now server-defined, the in-play set — and so the **in play** / **unused**
badges — reflect the server's declared symbols at runtime.

A coin overlay's pot token is the one symbol that reaches the board without a
strip: it drops **over** a cell and flies into its pot. So it is not in the Symbols table
but in a section of its own, **Coins**, with no badge: whether a coin is used, and which
pot it fills, is the overlay's call. Add or remove its pot under **Coin overlay**. (A coin
cannot go on the reels: it would land as a symbol, which the validator refuses.)

The badges also decide what [Invisible Symbols](symbols-state-machine.md) lists: every
symbol **in play** gets a row there to bind its art, and an **unused** one does not
appear at all. The overlay's coins get rows too, grouped under **Coins** after the
symbols. Save here, then reload that page. The same set fills every symbol dropdown in
[Invisible Flow](flow.md), in the same order.

They decide the game too: once saved, an **unused** symbol is never dealt by our test
server (any kind, its Book-of expanding special and Hold and Win coins, specials and
meters included, forced outcomes too), never flickers past on the spinning reels and
never shows in the book shuffle. A Hold and Win game needs its coins, so taking its
coin symbol off the reels is refused while its coin table pays cash coins. Until a
project saves its config the game plays the engine's built-in lines config, as the
banner at the top says (for lines, cluster, Book-of and custom kinds that is this
template). A partner's own server deals what its math says. Our test server deals a
lines game only the engine's own symbol names (`H1`–`H5`, `L1`–`L5`, `S`, `W`, `M`) and
a Book-of game only `H1`–`H4`, `L1`–`L5` and `S`: a symbol named otherwise is never
dealt, and a project with none of those in play is dealt its default set.

> The generated spin strips are **cosmetic** — the blur filler the reels cycle
> through. They are **not** the real weighted math strips (the math team owns those,
> and they never reach the client). A symbol's presence on a strip is only whether it
> flickers past during a spin, not a hit rate or an RTP contribution.

## Bet modes: math + presentation

Each bet mode is one card, read top to bottom as four labelled blocks:

| Block             | What it holds                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Math**          | Cost × (a multiple of the base bet), RTP, Max win ×, and the **Feature** / **Buy bonus** toggles — the engine config shape the math team ships. |
| **Menu**          | **Kind**, **Order**, and the **Card** component this mode renders.                                                                              |
| **Copy**          | **Title**, **Button**, **Bet label**, **Description**, **Dialog**.                                                                              |
| **Card graphics** | Per-mode overrides of the card component's params, clustered by the group each param declares (Panel · Icon · rig · Button).                  |

The card is **colour-coded by kind** — a blue rail for `base`, gold for `buy`, teal
for `ante` — matching the chip this mode gets in the menu preview above, so a card
and its chip are recognisably the same mode. The header repeats the kind and the
mode's cost as tags.

- **Kind** — `base`, a persistent `ante`, or a one-shot `buy`. Leave it on
  **auto → <derived>** and the tool derives it from the math (a Buy-bonus mode ⇒
  `buy`, otherwise `base`). `ante` — a stake toggle that stays on across spins —
  **must be set explicitly**; the math's two booleans can't express a persistent
  toggle, so nothing derives it for you.
- **Order** — the mode's position in the menu. Leave it blank (**auto**) and the
  card keeps its authoring order; set a number on one card to move just that one
  without renumbering the rest.
- **Copy** — the text the card shows: **Title**, **Button** (the call-to-action,
  e.g. PLAY / BUY / ACTIVATE), **Bet label** (the HUD "BET" caption), plus a
  **Description** and a **Dialog** (the buy-confirmation body). Blank fields fall
  back to a legible default — the mode's key as its title and a verb matched to
  its kind — so an un-authored mode still renders a working menu.
- **Card graphics** — override any param the mode's card declares (panel frame and
  tint, the card's main image, a rig accent, the button/ribbon frame, …). Blank
  inherits the card component's own authored default, so you only set what differs
  between modes.

> **If a word is painted into the artwork, no field here can change it.** A ribbon
> frame whose image already reads "BUY FEATURE" will keep saying that whatever you
> type in **Button** — and it can't be translated either. Point the frame at a blank
> ribbon and let the Button text draw on top, or ship per-language art.

Above the cards, a read-only **menu preview** shows the resolved, ordered menu as
chips — each chip shows the resolved **title** and **cost×**, coloured and
labelled (on hover) by its **kind** — so you can see the effect of your Kind and
Order choices as you edit, exactly as the game will build the menu.

The copy is authored here as **source text** only. It's translated in the
**Invisible Localization** tool, which auto-collects these strings into its "Bet
modes" section; a translation you write there lands in-game.

## Importing the paytable from the server

The info page shows the paytable authored **here**; the server pays its **own** math.
When they disagree the game warns in the browser console at boot, but it never fixes
it for you. **Import paytable from server** (Symbols panel, above the table) is how
you fix it on purpose:

1. Click **Import paytable from server**. The tool reads the paytable your published
   game's server declares (a read-only heartbeat — no bet, no round). If the project
   has several published games, pick which server in the dialog.
2. Review. Each dictionary symbol the server prices shows **Now** → **Server**, or
   **unchanged** when they already agree. The server's own name is shown next to
   yours (e.g. `H1 PIC1`). The server's **scatter** row is imported too: it lands on
   your scatter symbol's paytable and carries a small **scatter** tag in the table.
   Line rows pay × the line bet, scatter rows × the total bet. Below the table:
   - **Skipped** — symbols the server prices that this project's dictionary does not
     have (or a scatter row naming a symbol that isn't a scatter here). They are
     never added; add the symbol first if you want it.
   - **Left as authored** — symbols you price that the server declares no line row for.
     The import doesn't touch them.
3. **Apply N changes** writes the changed rows into the page (the page shows
   **Unsaved**). Nothing is stored until you **Save**, which runs the same
   conflict check as any other edit. **Cancel** changes nothing.

The button is disabled — with _Publish the game first_ — until the project has a
published game on the Invisible Test Server. Rows are imported as `count:multiplier`
pairs in ascending order, with zero pays dropped.

## Importing from a pasted capture

A partner's server can't be read from the launcher — it turns away requests that
don't come from a real browser. So for a partner game you bring its paytable in by
hand: **Import from a pasted capture** (Symbols panel, beside the server import).

1. On the partner's game, open the browser's developer tools → **Network**, reload,
   and copy the **response** of the first game request — the one carrying the
   `config` event. A `copy(eaSniffed)` dump from `scripts/console-sniffer.js` works
   too.
2. Click **Import from a pasted capture**, paste it into the box, and optionally fill
   **Captured from** (which partner game it came from). Click **Read the capture**.
3. The same review dialog as the server import opens. Its button reads **Apply N
   changes and keep as reference**, or **Keep as reference** when nothing differs.
   Either way the capture is kept as the project's **partner reference** (below).
   Nothing is saved until you **Save**.

If the paste isn't JSON, or has no `config` in it, the dialog says so and nothing
changes.

## The partner reference and the Publish check

Once a capture is kept, `/config` compares the paytable you've authored — line rows
and the scatter row — against it, live, including unsaved edits. When they disagree,
a **red box** at the top of the page lists every row that differs.

That disagreement also stops the game shipping, because the info page would quote
prices the partner's server doesn't pay:

- **Publish** in [Invisible Game Maker](game-maker.md) refuses the game. An admin
  can publish anyway after confirming.
- **Desktop publish / delivery builds** stop at the bake too, listing the rows, unless
  run with `--allow-paytable-drift`.

Fix the rows (or re-import the capture) and Save to clear it. **Forget it**, on the
Partner reference line, removes the reference altogether. A project that never kept
a capture is never blocked.

## Pasting in a config from the math team

A Invisible Engine config arrives as JSON. Click **raw JSON** (top of the page), paste
it, and **Apply** — the same validation a save runs checks it first. The snake_case
fields the export uses (`special_properties`, `max_win`) are kept verbatim.

A config with the older `holdAndWin` / `potsOverlay` blocks is fine to paste: the page turns
them into the **Coin overlay** and **Bonus modes** form (`coinOverlay`, and a respin mode's rules
on its `modes` entry), and that is what it saves. The server writes the older blocks back
alongside on every save, for what still reads them.

## Errors vs warnings

- **Errors block a save.** A payline pointing off the grid, a reel-count mismatch, a
  strip dealing a symbol with no dictionary entry — the game would visibly
  misbehave, so the config can't ship until they're fixed. They're listed at the top
  and against the panel that owns them.
- **Warnings don't block.** A config that renders but lies — a paytable row for a
  symbol no strip deals — saves, but the tool says so.

## Template default & reset

A project that has never authored a config opens on its **game-type template
default** (the banner says so). Save to make it the project's own. **Reset to
template default** restores that starting point at any time.

## Version history

**History…** in the top bar lists earlier saved versions of this project's config, newest
first. Each save keeps a copy of the version it replaces (at most one every five minutes; the
newest 20 are kept), and an **Overwrite** of someone else's save always keeps one. Pick a
version and **Restore**: it is saved like any other save — refused with a reload prompt if
someone else saved since you opened the page — and it keeps a copy of the version it replaces,
so a restore can be undone from the same list. The page reloads afterwards. Restoring is
disabled while another author holds the project.

## Making a ways game

Three steps, and step 3 is the one people miss.

1. **Set the project's game type to `ways`** (project settings). This decides which
   template the config opens on and which mock RGS the game is dealt by.
2. **Open this tool.** A project that hasn't authored a config yet opens on the
   `ways` template, which already has the win model set (pays left to right, from
   3 adjacent reels).
3. **Save.** ⚠️ **This is required, even if you change nothing.** The game only ever
   ships an **authored** config — a project that has never saved one ships no config
   at all and falls back to the compiled lines template. A game type set but never
   saved is exactly why a "ways" project still plays like lines.

Then reload the game. For a project that **already has a saved config** (so it won't
pick up the ways template), just set _How wins are decided_ → **Ways** and save.

**How to tell it worked**, in the running game:

- Wins cover **several cells on the same reel** — a payline can only ever light one
  row per reel, so this is the visible proof.
- The info page has **no payline diagram** (there are no lines to draw).
- The browser console carries a `[game-config]` note saying the config declares a
  ways win model.

## How it reaches the game

Pure config, no assets, so it travels verbatim through the bake — no export/pull
step. On save it lands in the project's cloud storage and the game resolves **your
authored config → the baked config → the compiled template**, in that order. An
un-authored project falls all the way through to the compiled template and is
byte-identical to a stock build.

Who sees a save when:

- **You, on the game's Live ↗ link** (and the launcher's Games cards) — within seconds.
- **Players** (the Game Maker's **Play ↗** / the published URL) — only after the next
  **Publish**, which freezes the config into a new published version. See
  [Game Maker](game-maker.md).
- **A desktop build** — on its next build.

## Reaching the server

The half of this config that is **math** — the grid, paylines, which symbols are in
play, the win model, tumbling, free spins — has to be dealt by the RGS, not just drawn by the
client. On the Invisible Test Server it is, and the server always deals **the same
version of this config the game you opened is drawing**:

- **Live ↗** (and the game cards on the launcher home) open an _authoring_ boot:
  the game draws the config as you last **saved** it, and the server's authoring mock
  re-reads the saved config within a few seconds. So to try a change: **save, reload
  Live ↗, done** — no publish needed.
- **Play**, and the URL you copy for players, open the **published** game: it draws
  the config as it was at the last **Publish**, and the server deals exactly that,
  however much you have edited since. Your change reaches players when you Publish
  (and a rollback in Game Maker takes the server back with it).

There is no way for either game to be dealt a different board from the one it draws.

Two cases where client and server disagree, both of which the game says out loud in
the browser console as a `[game-config]` error naming both boards:

- **A game published before this existed** (or built through the desktop launcher).
  Its server entry has no pointer back to this config, so it keeps dealing whatever
  the last publish froze. **Publish it once** and it follows from then on.
- **A real RGS.** A production server owns its own certified math and does not
  follow the client — there, the config has to be set to the board the server deals.

## Traps

- **You changed the math, reloaded with Play ↗, and nothing changed.** — Working as intended: a
  player's game (**Play ↗**, **Copy URL**) and the board the server deals it both stay on the
  last Publish. Test config changes with **Live ↗** in [Game Maker](game-maker.md), and
  **Publish** when players should get them.
- **A change to the board broke the round that was open in another tab.** — When the board a game
  is dealt changes (a save, for **Live ↗** tabs; a Publish or rollback, for **Play ↗** tabs), the
  test server drops rounds dealt on the old one (balances are kept). Reload those tabs.
- **You removed the free-spin chain in the Flow and free spins still happen.** — The Flow only
  presents the feature; the server decides to enter it. Turn free spins off in the **Free spins**
  section (see _Free spins_ above), save, and reload **Live ↗**.
- **A mode's Card graphics don't show in the Scene or Component Editor.** — Both editors draw each
  card with its component's own defaults; a mode's **Card graphics** are applied only when the
  running game builds its buy menu. Open the buy menu in the game (Game Maker's **Live ↗**) to
  check them.

See the design plan in `docs/design/invisible-game-config.md`.
