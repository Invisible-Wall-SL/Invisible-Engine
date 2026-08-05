# Invisible Game Config

Author **what a game plays** — its symbol dictionary and payouts, paylines, grid,
bet modes, identity/RTP, and the reel strips that decide which symbols reach the
board. This is the frontend's **contract with the math**, not the math itself: the
server stays the authority on outcomes; this doc tells the client what to draw and
what to expect.

- **Where it runs:** Cloud (the launcher itself, Railway).
- **Access:** sign in at `app.invisiblewall.org`, then open `/config` (granted to
  `developer` and `artist` by default; `admin` always).
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
- **Paylines** — a visual grid, one cell per reel per line. **Read-only**: the game
  reads its active paylines from the **server (RGS)** at runtime, so the shape is a
  view here, not an editor. The one thing you _do_ author is the per-line **colour**
  swatch (see _Server-defined paylines & strips_ below).
- **Reel strips** — per game type, per reel, with a symbol-frequency readout.
  **Read-only / auto**: the in-play symbol set comes from the server at runtime and
  the cosmetic spin strips are generated from it, so there's nothing to author here.
- **Big win tiers** — the big-win celebrations the game plays, as an ordered list.
  See _Big win tiers_ below. Leave it empty to keep the game's built-in tiers.

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

## Server-defined paylines & strips

The **paylines** and **reel strips** panels are **read-only**: at runtime the game
takes both from the **server (RGS)** — the active paylines from the RGS's declared
`availablePayLines`, and the in-play symbol set from the RGS's `symbols` (the cosmetic
spin strips are then generated from that set). This keeps the client's line count,
per-line pay display, info page, in-play gate and reel-tease reach in lockstep with
what the server actually deals — a project can't drift from the RGS's declaration.

You still author **one** thing on the paylines panel: each line's **colour** swatch.
The game draws that line's win in this colour and broadcasts it so assets shown on the
win can pick it up (leave it unset to use the single default from the Symbols tool).
Colours are keyed by line **index**, so they line up with the server's lines in order.

When there is **no** server declaration (a stock dev build, or the real Stake RGS),
the game falls back to the authored/compiled paylines and strips exactly as before.

## The strips are the gate

The **dictionary** (Symbols panel) describes every symbol the game *can draw* — art,
properties, payouts. The **strips** describe what the game *actually deals*. A symbol
can legitimately sit in the dictionary and appear on no strip; when it does, the tool
marks it **unused** and warns that its paytable advertises a payout no one can win.
This is the one rule that keeps a game from advertising symbols it never deals. With
the strips now server-defined, the in-play set — and so the **in play** / **unused**
badges — reflect the server's declared symbols at runtime.

> The generated spin strips are **cosmetic** — the blur filler the reels cycle
> through. They are **not** the real weighted math strips (the math team owns those,
> and they never reach the client). A symbol's frequency in the read-out is only how
> often it flickers past during a spin, not a hit rate or an RTP contribution.

## Bet modes: math + presentation

Each bet mode is a card with two halves. The **math** — Cost × (a multiple of the
base bet), RTP, Max win ×, and the **Feature** / **Buy bonus** toggles — is the
Stake-export shape the math team ships. The **presentation** is ours: how the mode
looks in the player-facing menu.

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

Above the cards, a read-only **menu preview** shows the resolved, ordered menu as
chips — each chip shows the resolved **title** and **cost×**, coloured and
labelled (on hover) by its **kind** — so you can see the effect of your Kind and
Order choices as you edit, exactly as the game will build the menu.

The copy is authored here as **source text** only. It's translated in the
**Invisible Localization** tool, which auto-collects these strings into its "Bet
modes" section; a translation you write there lands in-game.

## Pasting in a config from the math team

A Stake-Engine config arrives as JSON. Click **raw JSON** (top of the page), paste
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

## How it reaches the game

Pure config, no assets, so it travels verbatim through the bake — no export/pull
step. On save it lands in the project's cloud storage; the next build (or live
runtime fetch) picks it up and the game resolves **your authored config → the baked
config → the compiled template**, in that order. An un-authored project falls all
the way through to the compiled template and is byte-identical to a stock build.

See the design plan in `docs/design/invisible-game-config.md`.
