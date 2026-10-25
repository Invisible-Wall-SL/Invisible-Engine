# The match-3 wire — OURS, a swap seam

> **⚠️ This is not the partner's format.** No provider has shown us a match-3 round, so every
> match-3 action, event and field below is invented by us (`docs/design/game-families.md` §2.2,
> P10.6), exactly as the cascade's `tumbleStep` and the Hold and Win wire are. It is what our mock
> (`scripts/mock-rgs-server-match3.mjs`) speaks and what the facade
> (`packages/rgs-translator-eagaming/src/match3.ts`) maps into the engine's book events. **When a
> real provider delivers its format, this document and the facade mapping are rewritten; nothing
> above the facade may depend on it.** Live real money waits on that (§9 #2).
>
> Plan: [game-families.md](../design/game-families.md) §2.2 · State:
> [status/game-families.md](../status/game-families.md) · Transport and the parts that ARE the
> partner's: [play4fun-protocol.md](play4fun-protocol.md).

## What is the partner's, and what is ours

**The partner's (kept exactly):** the transport, `seq` as a position, the stored-action replay at an
occupied position, resume through the boot `config` (`resume: true` + `actions` + the round named on
`platform.gameRound`), `bet [x, betPoint]` + `play` to open a round, `gameEnd {win}` and an explicit
`collect` that closes it with `gameRoundOver`.

**Ours:** the `move` action, the `match3Board` / `match3Move` / `match3End` events and the
`config.match3` block. `move` has the shape of the partner's own player-choice actions
(`pickRandomly`, `gamble`): a STORED action carrying the player's choice, posted under the round's
`gid`, so it advances `seq` by one like any stored action.

`MATCH3_WIRE = 1` is this document's version; the boot block carries it.

## Board, cells and symbols

- A board is `string[][]`, **column-major** (`board[reel][row]`), row 0 the top, exactly the visible
  grid (no padding rows). Symbols travel under the project's **own** Game Config names (`H1`, `L2`,
  …), so the facade maps them by identity.
- A cell on the wire is `[reel, row]` in a request and `{ reel, row }` in an answer, visible rows.

## Boot `config`

The ordinary fields (`symbols` — the gems the strips deal, `window {reels, rows}`, `paylines: []`,
`wildSymbols: []`, `paytable`) plus:

```ts
match3: { wire: 1, minRun: number, moves: number }
```

`paytable` is the partner shape (`{ H1: { occurs: [3, 4, 5], pay: [...] } }`): a group of `occurs`
gems of a symbol pays `pay × the whole stake` (the `match3` win model, divisor 1). With no paylines
the facade's legacy encoding sends `bet [1, stakeCents]`.

## A round

```
seq 0  [bet [1, stake], play]  → bet, gameStart, match3Board        (opens the round, binds gid)
seq 2  [move {from, to}]       → match3Move                          (+ match3End, gameEnd at the end)
seq 3  [move {from, to}]       → match3Move
…      one move per request, each STORED (seq + 1)
seq n  [collect]               → gameRoundOver                       (closes it, credits the win)
```

| Event | Context | Notes |
| --- | --- | --- |
| `match3Board` | `{ board: string[][], movesLeft: number }` | The round's first board: no match on it, at least one move. |
| `match3Move` | `{ from, to, accepted, steps: Step[], movesLeft, roundWin, board }` | One per `move`. `board` is the settled board after the move (the server's; the client mirrors it). A refused move (`accepted: false`): no steps, the moves and board unchanged. |
| `match3End` | `{ totalWin, reason: 'movesUsed' \| 'noMoves', settle }` | The round is over. Rides the answer to the move that ended it, followed by `gameEnd {win: totalWin}`. `settle` is the part of `totalWin` the steps did not pay (below). |

`Step = { exploding: {reel,row}[], newSymbols: string[][], win, roundWin }`: the cells that matched,
the gems dropped into each column (top first, exactly filling that column's holes after gravity),
this step's pay and the round's running pay after it. All amounts are cents.

**Refusals.** A `move` that names a cell off the board, two cells that are not neighbours, or a swap
that makes no match is answered `match3Move { accepted: false }` and changes nothing but `seq` (it is
stored). A `move` with no open round, or after `match3End`, is an error envelope (`errorCode` 102),
as is any action other than `move` / `collect` while a round is open (a second `bet` included —
unlike the slot mocks, an open match-3 round is never settled over). A `collect` before `match3End`
is `errorCode` 110 (`unexpected action`); a `move` whose context is not two integer cells is 101 and
is not stored. The total is drawn at the `play` of the opening request (where a `force:` rides).

**Never auto-collected.** A match-3 round stays open after `match3End` until the client posts
`collect`, whatever the win (zero included): the balance changes only there.

## The mock's math: fixed at the bet

The mock implements §2.2's recommended model, so RTP does not depend on skill:

1. At the `bet` it draws the round's **total** from a fixed table of multiples of the stake
   (`MATCH3_TOTAL_TABLE`, mean 0.96 of the stake).
2. Each step pays the paytable's price of its groups, **capped** at what is left of that total.
   The swap's own match is a fact of the visible board; the server is free only in the refills.
3. The server **steers the refills**: per step it reads candidate refills from the columns' strips
   and picks one whose next match fits what is left (or one that makes no match when nothing is
   left), keeping a legal move on the settled board.
4. At the end (moves used up, or a board with no move) `match3End.settle` pays whatever is left, so
   `totalWin` is always exactly the total drawn at the bet.

A real provider's model is its own; only the client contract above is shared.

## Resume

A round left open (a reload mid-round) is named in the boot `config` (`resume: true`, `actions`).
The facade replays its stored requests (`[bet, play]`, then each `[move]`, at their positions under
the `gid`), and hands the engine ONE board: `boardInit` with the last `board` and `movesLeft`, the
running win, and — when the round had already ended — its end. The player goes on from there.

## Engine book events (what the facade hands the runtime)

| Book event | From | Fields |
| --- | --- | --- |
| `boardInit` | `match3Board`, or a resume | `board: RawSymbol[][]` (visible), `movesLeft` |
| `swap` | `match3Move` | `from`, `to` (`Position`, visible rows), `accepted` |
| `tumbleBoard` (exists) | each `Step` | `explodingSymbols` (PADDED rows, +1), `newSymbols` |
| `updateTumbleWin` (exists) | each `Step` | `amount`: the running round win (book units) |
| `movesLeft` | `match3Move` | `count`, `board` (the server's settled board, visible) |
| `roundEnd` | `match3End` | `totalWin` (book units), `reason` |

`gameEnd` then translates as for every round (`setWin` for a big win, `setTotalWin`).

## Forcing (mock only)

`play.context = "force:<multiple>"` (e.g. `force:5`) draws that total instead of the table, for a
playtest. Refused (`errorCode` 101) for a game whose players are not allowed forcing (the runtime's
player channel), as on the other mocks.
