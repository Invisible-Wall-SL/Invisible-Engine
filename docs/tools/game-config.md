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
- **Paylines** — a visual grid: each line is one clickable cell per reel; click to
  move the line through that reel's rows.
- **Reel strips** — per game type, per reel, edited as text (paste-friendly). Each
  reel shows a symbol-frequency readout.

## The strips are the gate

The **dictionary** (Symbols panel) describes every symbol the game *can draw* — art,
properties, payouts. The **strips** (Reel strips panel) describe what the game
*actually deals*. A symbol can legitimately sit in the dictionary and appear on no
strip; when it does, the tool marks it **unused** and warns that its paytable
advertises a payout no one can win. Put the symbol on a strip and it becomes **in
play** and its paytable row counts. This is the one rule that keeps a game from
advertising symbols it never deals.

> These are the **cosmetic** strips — the blur filler the reels cycle through, and
> the client's statement of which symbols reach the board. They are **not** the real
> weighted math strips (the math team owns those, and they never reach the client). A
> symbol's frequency here is only how often it flickers past during a spin, not a hit
> rate or an RTP contribution.

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
