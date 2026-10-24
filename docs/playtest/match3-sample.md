# Playtest — match-3 sample (`match3-sample`)

The first non-slot game ([game-families](../design/game-families.md) P10.5): a **rules-decided**
(free-play) match-3 game on the shared runtime. It is exactly what Game Maker scaffolds for a new
`match3` project — the match-3 scene set (`engine-layout` `referenceLayouts/match3.ts`), the seed
config (`apps/launcher-api/src/lib/data/gameConfig/match3.rules.json`: 7 × 7, six gems, 20 moves, a
1500-point goal, a 50 / 120 / 250 score table) and the starter flow (`engine-flow-v2`
`match3Seed.ts`). It has no RGS: the runtime deals and resolves the board itself and sends no
request. Status: [status/game-families](../status/game-families.md) (P10.5).

It is not a published project: publishing a game that is not a slot is still switched off
(`familyGate.ts`), so the sample is the harness's local `cg-match3` snapshot, built from those
same three seeds.

## Launch

```
pnpm --filter 'lines^...' build
PUBLIC_RGS_TRANSPORT=play4fun PUBLIC_DELIVERY_PROFILES='*' pnpm --filter lines build
node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
  scripts/current-games/fixtures.mjs          # writes .cache/current-games/fixtures/…/cg-match3
node scripts/playtest/match3-play.mjs --runtime apps/lines/build --out .cache/match3-play
```

`match3-play.mjs` serves the snapshot as the launcher would and the runtime from the real
Invisible Test Server, boots it with `?ie_determinism=7` (the clock) and `?m3seed=sample-8` (the
board), and plays one round with real pointer swipes: a refused swap, then the first legal swap on
the board until the round ends, then the tap that deals the next round. It writes
`result.json` (per move: the pair, the board before and after; the page's requests; the verdicts)
and a screenshot per moment, and exits 1 when a verdict fails. `--board-seed <s>` deals another
board; with the seed config, `sample-8` is won in 13 moves by that player, and some other seeds are
lost (also a pass: the round still ends on its screen).

**In a browser by hand:** the same snapshot boots in any runtime build at
`/<key>/?runtime=1&project=cg-match3&k=x&editorDocBase=<snapshot server>`; drag a gem onto a
neighbour, or tap one and then a neighbour. `?m3seed=` pins the board.

**The determinism probe** (`window.__IE_DETERMINISM__`, `?ie_determinism=`) reports the board as
`state().board` (`busy`, `moves`, `seed`, `cells` column-major) and answers `cellPoint(reel, row)`
with a cell's centre on the page, row 0 the top visible row.

## Scenarios

### S1 — Boot

- **Do:** boot, tap the loading screen.
- **Expect:** the 7 × 7 board seated on the authored grid; SCORE 0, MOVES 20, TARGET 1,500 (the
  `boardReady` chain sets them); no spin button, bet or balance anywhere; `errors: 0`.
- **Signal:** `01-board.png`; `state().board.busy === false`; the page's requests are only the
  runtime bundle (`result.json` `wire`).

### S2 — A refused swap

- **Do:** swipe a gem onto a neighbour that makes no match.
- **Expect:** the two gems fly across and back; MOVES and SCORE unchanged; the board unchanged.
- **Signal:** `02-refused.png`; the board's `cells` equal before and after.

### S3 — A legal swap and its cascade

- **Do:** swipe the first legal swap.
- **Expect:** the gems trade places on the flight layer, the matched gems explode in the authored
  pattern, the survivors fall and the refills drop in; each cascade step adds its points (score
  table by gem count); MOVES drops by exactly 1.
- **Signal:** `03-first-swap.png` (SCORE > 0, MOVES 19).

### S4 — Select and hint

- **Do:** tap a gem, then the same gem; tap a gem, then a neighbour.
- **Expect:** the first tap draws the gem in its `select` state (unauthored: its Win art); the
  second tap on it drops the selection; a tap on a neighbour swaps the two. A flow's **Hint**
  action lights a legal pair in `hint` (unauthored: Land art).
- **Signal:** the harness's `select` scenario (`selected` screen).

### S5 — The round ends

- **Do:** keep making legal swaps.
- **Expect:** the move that reaches the goal shows **GOAL REACHED! Tap to play again**; the move
  that spends the last move without it shows **OUT OF MOVES. Tap to try again**. Either screen
  locks the board (`state().board.busy` stays true while it holds).
- **Signal:** `04-roundWon.png` (with `--board-seed sample-8`).

### S6 — A new round

- **Do:** tap the round screen.
- **Expect:** a fresh board; SCORE 0, MOVES 20; the board takes input again.
- **Signal:** `05-new-round.png`.

### S7 — No moves left

- **Expect:** when no swap can match, the starter flow's `noMoves` chain shuffles the board into
  one with a move and no match. Hard to reach by hand on a 7 × 7 board with six gems:
  `check:match3-rules` §4 covers it headless.

### S8 — Not a real-money game

- **Expect:** the runtime sends the RGS nothing (S1's signal). Under any delivery profile
  (`?rgs_profile=…`) the boot stops on the error modal "This game is free play and pays no money…".

## The current-games screens

`scripts/current-games/screens/match3.json` plays the harness's scripted-input steps (`tap`,
`swap` with `legal: true|false`) on any live match-3 game: `loaded`, `board`, `selected`,
`refused`, `cascaded`. No live game is a match-3 game yet (publishing is off), so CI renders none;
the local fixture run is
`node scripts/current-games/run.mjs --games-file .cache/current-games/fixtures/games.json --only cg-match3 --base-build <dir> --head-build <dir> --no-gates`.

## Known limits

- Unauthored gems draw the stock slot symbols (H1–H4, L1, L2); the swap flight has no trail
  (an author can give the `swap` flight kind a look in Invisible Symbols → Flights only once that
  kind is listed there; see the status file).
- The round screens' text is a Text Box over the dim; a project restyles it in the Scene Editor.
