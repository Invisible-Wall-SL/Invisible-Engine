# What the partner sends for a collector respin game (captured 2026-11-09)

> **The first real partner respin rounds we have.** Recorded from the partner's own demo of
> **Fortune Vault Force 5** (EAGaming / Play4Fun), `www.eu-cluster.com/rgs/engine`, in a real browser
> tab (the edge is behind a Cloudflare challenge). It is evidence for Phase 10, not a contract: one
> game, play money, about 40 requests. No session id, round id or token is recorded here.
>
> Our own wire, which the facade maps today: [hold-and-win-wire.md](hold-and-win-wire.md). Transport:
> [play4fun-protocol.md](play4fun-protocol.md). The game's rules and our plan:
> [design/hold-and-win-enhancements.md](../design/hold-and-win-enhancements.md).

## What was played

| Round                  | Request                              | What happened                                                                                            |
| ---------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Buy the bonus          | `[{bet,[3,4]},{play,""}]` at `seq=0` | A collect in the buying spin, then the bonus with Multiply + Respin, 12 respins, a `collect` at `seq=14` |
| Ante ("Power Roll") ×4 | `[{bet,[1,4]},{play,""}]` at `seq=0` | Only coins and blanks dealt; each round closed in its own batch (`gameEnd`)                              |
| Buy "Center Coin"      | `[{bet,[2,4]},{play,""}]` at `seq=0` | A collector on reel 3 with coins on reels 4–5 triggered the bonus (Respin only)                          |

Not seen: a line win, a natural (unbought) trigger, a Boost hit, Expand, Force 5, a jackpot coin.

## Transport: what this confirms

- **`seq` is a position.** `[bet, play]` moved it from 0 to 2; each respin `[play]` moved it by one;
  the closing `[{"action":"collect"}]` went at the next position (14 after 12 respins). Requests from
  the buy on carried `&gid=`. The empty-body heartbeat `[]` was interleaved and moved nothing.
  Matches [play4fun-protocol.md](play4fun-protocol.md).
- **A respin is a context-less `[{"action":"play"}]`**, as our wire already assumes.
- **A round with no feature closes in its own batch** (`gameEnd`, `gameRoundOver`); a feature round
  ends with the client's `collect`, answered by `gameRoundOver {win}` and `platform.gameRound`.

## The bet: `betOptions`, not a multiplier

`bet` context is `[optionIndex, betPerLine]`. `spinStart` names the options:

```json
"gameCost": 10,
"betOptions": [10, 50, 500, 1000],
"betOptionNames": ["Base", "Powerup", "BuyCenterCoin", "goldStrike"],
"maxWinMp": [5000, 5000]
```

The stake is `betOptions[i] × betPerLine` in cents: 40 (0.40), 200 (2.00, the ante at 5×), 2000
(20.00, 50×), 4000 (40.00, 100×). **The ante and both buys are bet options**, the shape our facade
already reads for a `betOptions` game. The ante is not a separate flag.

## Money units

Cents. `COIN_n` pays `n × gameCost × betPerLine`, i.e. **n × the base total bet, whatever option was
bought** (an ante coin `COIN_1` showed 0.40 at a 2.00 stake). `jackpots` sends the tiers as
multiples of the base bet: `{"MINI":25,"MINOR":50,"MAJOR":150,"GRAND":1000}`.

## Symbols and the board

- `spinStart.symbols`: `PIC1…PIC9`, `COIN`, `COLLECT`, `BLANK`; `symbolsPay.line` lists only the
  PICs; no wild.
- A board (`playWindow`, `collectWindow`, `playedSpin`) is **reels × rows**, reel-major, sent
  **whole** each spin. A coin is `COIN_<n>`; a collector carries its running total as
  `COLLECT_<cents>` once it has collected (bare `COLLECT` before).

## Event shapes seen

Base spin of the buy round, in order:

```text
bet {total, betPerLine, paylines[5]}         gameStart {totalBet, betPerLine}
jackpots {MINI, MINOR, MAJOR, GRAND}         spinStart {symbols, betOptions, …}
bonusSymbol {reel, row, symbol, win} × coins playWindow [[…]]
cellPayAmount {reel, row, original, value, pay} × coins
collect {reel, row, pay}                     bonusWin {bonus: "initialspin", pay, isSpinWin: false}
collectWindow [[…]]                          boostsAwarded {expand, boost, powerFive, multiply, respin}
spinTrigger {spins: [{prob, spins}], occurs, bonus, trigger: {occurs: [3,4,5], from}}
playedSpin [[…]]                             enterBonus {left, triggers, bonusTriggers, spins, triggering, …}
```

Each respin:

```text
jackpots, spinStart, boostsEnabled {expand, boost, powerFive, multiply, respin}
bonusSymbol … / playWindow / cellPayAmount …
multiplier {multiplier: "X"}                                   (a miss)
multiplier [{reel, row, startingPay, multiplier}]              (a hit; the cell's value is multiplied)
collect {reel, row, pay} (one per collector)   bonusWin {bonus, pay, isSpinWin: false}
collectWindow [[…]]   retrigger {games}   playedSpin [[…]]   playedBonusSpin {played, left, …}
```

The last respin adds `playedBonusSpins` and `gameEnd`; the client then posts `collect`.

## What it tells us about the game

- **The bonus id is the enhancement set.** `boostsAwarded` is five 0/1 flags in the order expand,
  boost, powerFive, multiply, respin, and `spinTrigger.bonus` / `enterBonus.bonusTriggers` use the
  same bits as a string: `"00011"` = Multiply + Respin, `"00001"` = Respin only. Force 5 is the
  `powerFive` bit. `boostsEnabled` repeats the set on every respin.
- **Coins do not stick in the bonus; collectors do.** The bonus board opens with only the
  collector(s), carrying the value they gathered in the trigger spin (the trigger spin's own
  `collect` pays into it). Each respin, new coins are paid into the collectors in view and vanish.
  With two collectors their totals rose by different amounts; how a coin is split between them is
  not clear from one round. This is our `stickiness: 'collectorsOnly'` with
  `collects: 'perRespin'`.
- **Collectors land only on reel 3 in the bonus too** (every `collect` was at `reel: 2`), and each
  keeps its own total. The feature pays the sum of the collectors (`gameRoundOver.win` = 960 +
  2440).
- **The counter:** `enterBonus.left` was 4 (Respin on). `retrigger {games}` brings `left` back to the
  start when a symbol lands; `games` is the number of respins added back.
- **Multiply hits a cash coin as it lands**, before the collect: `startingPay` 200 ×2 →
  `cellPayAmount.value` 10 (`original` 5). Jackpot targets were not seen.
- **The trigger is any run of 3+ adjacent reels**, not only from reel 1: a collector on reel 3 and
  coins on reels 4 and 5 triggered (`trigger.occurs: [3,4,5]`).
- **"Center Coin" (50×)** deals the ante's coin-only reels with a collector guaranteed on reel 3.
- **The ante** deals coins, collectors and blanks only, at 5× the stake.
