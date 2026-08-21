# Invisible Game Config

Author **what a game plays** — its symbol dictionary and payouts, paylines, grid,
bet modes, and identity/RTP. This is the frontend's **contract with the math**, not
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

- **Identity** — provider, game name, game ID, RTP. Shown on the info page and used
  in the RGS handshake.
- **Grid** — reel count and visible rows (per reel, so a stepped grid works). This
  is the board's size everywhere: the game renders this many reels and rows, the
  Scene Editor draws its preview at this size, and a dev game's mock RGS deals it.
  Changing the reel count re-shapes the row list but leaves paylines and strips
  alone — mismatches surface as errors rather than silently trimming your work.
- **Bet modes** — each entry in the bet selector / buy-bonus menu, edited as a
  per-mode card: the **math** (cost, feature, buy-bonus, RTP, max win) plus the
  **presentation** (kind, menu order, and the copy the card shows). See _Bet
  modes: math + presentation_ below.
- **Symbols** — the symbol **dictionary**: properties and paytable per symbol
  (`count:multiplier` pairs, e.g. `5:20, 4:10, 3:5`). Each row carries an
  **in play** / **unused** badge (see below).
- **How wins are decided** — the **win model**: whether this game pays by **lines**,
  **ways**, **cluster** or **scatter**, plus that model's own settings (ways: which
  direction and the fewest reels; cluster: fewest cells and how they connect;
  scatter: fewest symbols). This is what makes a project a ways game rather than a
  lines one. See _Making a ways game_ below. The same panel carries **Winners
  tumble** — see _Tumbling (cascade)_ below.
- **Reel behaviour** — how a round **arrives** on the board: whether the reels roll
  at all, and if not, how the new symbols get there. See _Reel behaviour_ below.
- **Paylines** — a visual grid, one cell per reel per line, showing the **live server
  (RGS) line set** the game actually deals at runtime — **auto-loaded** when the page
  opens (best-effort; falls back to the saved config if the RGS is unreachable).
  **Read-only** shape; the one thing you _do_ author is the per-line **colour** swatch
  (see _Server-defined paylines_ below).
- **Big win tiers** — the big-win celebrations the game plays, as an ordered list.
  See _Big win tiers_ below. Leave it empty to keep the game's built-in tiers.

## Reel behaviour

Most slots roll. This panel is where a project says it does something else — and it
lives here, rather than in the Scene Editor beside the board's shape, because it is
**one fact about the game**. A reel grid node is authored per aspect ratio, so
putting the switch there would have allowed a board that rolled in portrait and
swapped in landscape.

Everything in the panel is off by default. A project that never opens it stores
nothing, and its board behaves exactly as it always has.

**Swap symbols in place — no spinning reels.** The board stops rolling: the new
symbols arrive from above and settle into their seats. Because there is no roll
left to describe, the reel-shaped behaviours stand down while this is on — **reel
anticipation** (and its camera), **sequential reel stop** and **stacked pictures**.
None of them is lost; untick this and they come back. Everything below only applies
while this is on.

**Swap style** — how the new board gets there.

- **Drop in** — the whole board falls at once. This is the shipped behaviour and
  what you get if you never touch the field.
- **Column cascade — left to right** — the standing board drains out of the bottom
  column by column, and each column refills from the top as it empties. This is the
  "the symbols fall, and when a column is empty new ones drop in" reading.

**Column stagger (ms)** — only shown for a column cascade, and it is the one knob
for _"the columns fall at different times"_. It is the gap between one column
starting and the next starting:

- **blank** — the engine's default, 140 ms, which sits beside the reels' own
  per-reel stagger, so the sweep reads at a familiar speed. The columns overlap
  into a **wave**.
- **short** (under a whole column's worth) — more overlap, a faster wave.
- **long** (roughly 1000 ms or more on a 5-reel board) — column 2 does not start
  until column 1 has finished: strictly **sequential**.
- **0** — every column starts together, so the board drains and refills as one.

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

Either way the outgoing symbols play their **Explosion** state, authored per symbol in the Symbols
tool. A symbol with no Explosion state vanishes rather than popping.

So the two styles give you four pictures, not three: drop-in replace, drop-in clear-then-drop,
cascade drain-and-refill, cascade pop-and-refill.

Settings you switch off are **kept**, not deleted: tick the clear step, switch to a
column cascade to compare, and switching back restores it. The panel and the
warnings tell you when a saved setting is currently inert.

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
below) — so a save plus a reload is enough. No republish.

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

## Big win tiers

By default the game uses a built-in table of win levels (BIG / SUPER / MEGA / EPIC /
MAX and the smaller bands below them), and the win each spin lands on is computed
from a fixed threshold ladder. The **Big win tiers** panel lets a project replace the
CELEBRATIONS with its own — however many big tiers it wants, named, with its own
thresholds.

This panel owns tier **structure only** — how many big tiers there are, their names,
thresholds, order, and escalation. Each tier's **presentation** — the spine bundle,
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

The spine bundle, animation names, duration and sound are **not** on this panel — set
them on the Win Overlay component per tier (a spine picker + intro / idle / outro
dropdowns of that spine's animations + duration + SFX / BGM).

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
| **Card graphics** | Per-mode overrides of the card component's params, clustered by the group each param declares (Panel · Icon · Spine · Button).                  |

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
  tint, the card's main image, a spine accent, the button/ribbon frame, …). Blank
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

## Pasting in a config from the math team

A Invisible Engine config arrives as JSON. Click **raw JSON** (top of the page), paste
it, and **Apply** — the same validation a save runs checks it first. The snake_case
fields the export uses (`special_properties`, `max_win`) are kept verbatim.

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
step. On save it lands in the project's cloud storage; the next build (or live
runtime fetch) picks it up and the game resolves **your authored config → the baked
config → the compiled template**, in that order. An un-authored project falls all
the way through to the compiled template and is byte-identical to a stock build.

## Reaching the server

The half of this config that is **math** — the grid, paylines, which symbols are in
play, the win model, tumbling — has to be dealt by the RGS, not just drawn by the
client. On the Invisible Test Server it is: the mock re-reads this config directly
(within a few seconds of a save) and rebuilds the board it deals, so **save, reload
the game, done**. There is no republish step, and no way for the server to be
dealing a different board from the one you authored here.

Two cases where that doesn't hold, both of which the game says out loud in the
browser console as a `[game-config]` error naming both boards:

- **A game published before this existed** (or built through the desktop launcher).
  Its server entry has no pointer back to this config, so it keeps dealing whatever
  the last publish froze. **Publish it once** and it follows from then on.
- **A real RGS.** A production server owns its own certified math and does not
  follow the client — there, the config has to be set to the board the server deals.

See the design plan in `docs/design/invisible-game-config.md`.
