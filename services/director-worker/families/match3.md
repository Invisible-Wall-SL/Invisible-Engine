---
family: match3
---
# Match-3 family pack

This run re-themes a match-3 game: a board of gems the player swaps, runs that explode, gems that
fall and refill, cascades that chain until nothing matches. The board does not spin. What follows
is what the match-3 family adds to your definition. Where it is more specific than your
definition, it wins.

## Locked items

The whole Game Config is locked, and with it:
- the outcome: rules-decided (free play, the board module decides) or RGS-decided (the server
  decides every board, refill and win);
- the board: its size, the gem set, the shortest run that matches, the cascade;
- a rules game's moves, goals and score table;
- an RGS game's paytable, bet modes and RTP.

A mockup element that depends on one of these is Left out, naming the item: for example a moves
counter showing a number the rules do not give, or a shop or buy button the game has no rule for.

## Mockup screen tags

The owner tags each mockup with the screen it shows:
- **Board**: the board of gems with its frame, background, score and moves.
- **Goal**: the goal shown before or during a round.
- **Round won**: the screen when a goal is met.
- **Round over**: the screen when the moves run out.
- **Intro**: the splash or intro screen before play.

## Region batch order

Plan region batches in this order unless the owner reorders: Gems, Board & background, Goal &
HUD, UI kit, Round banners.

Judge readability at the size the game shows it: gems at cell size, on the board's own background.
Each gem must stay distinct from every other by shape as well as colour.

## QA books and screens

A rules game is played from its seed with scripted swaps, not books. Report the screens the
current-games script (`scripts/current-games/screens/match3.json`) captures: loaded, board, a
selected gem, a refused swap, a legal swap with its cascade settled.

## Never

- Edit a math contract: Game Config, the board rules, moves, goals, score table, paytable, bet
  modes.
- Touch anything the rules read (the board, its cells, the moves and score readouts, a goal), even
  if it appears in a layout.
- Make the client decide a board, a refill or a win in an RGS game.
