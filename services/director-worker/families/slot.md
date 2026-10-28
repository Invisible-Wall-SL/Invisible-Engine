---
family: slot
---
# Slot family pack

This run works on a slot game: reels that spin, a math contract the RGS decides, and the
presentation the engine plays from its books. What follows is what the slot family adds to your
definition. Where it is more specific than your definition, it wins.

## Kinds

The template's kind is in the run record (`gamemaker.get_template`, its GAME chips). Every kind
boots the same shared runtime; a kind changes how the game pays and presents, never which agent
does what.

### lines (and the Book of Thermopylae preset)
- Pays runs of one symbol left to right along fixed paylines; scatters pay anywhere and can start
  free spins; a wild substitutes on lines.
- The Book of Thermopylae preset (and an older project still marked `bookOf`) is a lines game
  whose book symbol is both scatter and wild, with an expanding special symbol in free spins. The
  book reveal and the column morph are presentation you may re-skin; the expanding rule is math.

### ways
- Pays a symbol on adjacent reels from the leftmost one, on any row (243 ways on 5×3). The board
  may be stepped (rows per reel differ). The win model and the ways count are math.

### cluster
- Pays a connected group of one symbol; winners explode and the board tumbles until it pays
  nothing. The minimum group, the adjacency and the cascade switch are math.

### scatter
- Pays every symbol on its count anywhere on the board, tumbles like cluster, and may end a chain
  with a multiplier collect. The minimum count and the multiplier rules are math.

### holdAndWin (and the coin board)
- Enough coins start a respin board: coins stick, a counter resets on each new coin, then every
  held value is paid. Presets add jackpots, pots, column letters, a wheel or a collector streak.
- The coin board is a Hold and Win with no line game: its base game deals coins on the paying
  cells only.
- Coins, jackpot plaques, pots and the counter are art you re-skin; their values, the counter,
  the jackpots and the trigger are math.

### Add-ons: the pots overlay and bonus modes
- Any slot kind may carry the pots overlay (tokens drop over the symbols into pots that start a
  bonus) and bonus modes (a Hold and Win respin mode or a spins mode played inside the game).
- Pots, tokens and each mode's screens are art and layout; the drop table, the pot thresholds and
  which trigger starts which mode are math.

## Locked items

The template's run record lists its locked items by id; the worker's rules judge on these ids,
never on the wording:
- `math` — the math contract: RTP and the grid (reels × rows).
- `paytable` — every paying symbol's pays.
- `bet_modes` — the bet modes, including any that buy a bonus.
- `paylines` — the paylines.
- `feature_rules` — cascade, Hold and Win, the pots overlay and every mode.

The template's math contract, paytable, bet modes and feature rules are locked. The cosmetic reel
strips and the win model live in Game Config too and are locked with it.

A mockup element that depends on a locked item is Left out, naming the item: for example a Buy
bonus button when the math has no buy feature clashes with `bet_modes`.

## Mockup screen tags

The owner tags each mockup with the screen it shows:
- **Base game**: the reels at rest or spinning, with the frame, logo, background and controls.
- **Hold and Win bonus**: the respin board, its coins, counter, jackpot plaques and pots.
- **Bonus**: a bonus mode or the pots overlay's bonus that is not a Hold and Win board.
- **Free spins**: the free-spins board, its counter and its intro or outro.
- **Big win**: the big-win banners and their count-up.
- **Paytable**: the paytable and rules pages.
- **Intro**: the splash or intro screen before play.

## Region batch order

Plan region batches in the template's group order: Symbols, Coins & jackpots, Backgrounds, Reel
frame & logo, UI kit, Win banners, unless the owner reorders. A template without coins or
jackpots skips that batch.

Judge readability at the size the game shows it: symbols at reel size, coins at the size the brief
states.

Each symbol's states in the Symbols State Machine are Static, Spin, Land, Win, Post-win, Explosion.
Bind every state the template has.

## QA books and screens

Play the draft with the template's fixed books: base spin, Hold and Win trigger, big win. Report
the screens below that the template's kind reaches (the current-games screen scripts,
`scripts/current-games/screens/<kind>.json`, capture the same ones):
- Every kind: loaded, idle, spin, settled, line-win, and the big wins x10, x20, x40, x70, x120.
- lines, ways, cluster, scatter: free spins — fs-trigger, fs-board, fs-spin, fs-settled. lines also
  shows the free-spins transition and the big-win intro.
- holdAndWin: hw-trigger, hw-respins, hw-respins-late, hw-total; a jackpot (hw-jackpot,
  hw-jackpot-total); hw-multiplier where the template has one.
- A template with the pots overlay: pot-full, pot-bonus.
- The Book of Thermopylae preset: fs-trigger, fs-spin, fs-settled, with the book reveal.

## Never

- Edit a math contract: Game Config, paytable, bet modes, feature rules, reel strips.
- Touch anything the math reads (paylines, bet levels, feature triggers), even if it appears in a
  layout. The reel grid, a bet or buy control, a readout of the bet and the bet and buy screens
  are refused by the platform and listed, never changed.
- Change a win model, the cascade, a Hold and Win counter or jackpot value, a pot threshold or
  which trigger starts which mode.
