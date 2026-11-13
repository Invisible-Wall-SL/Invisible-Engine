# What the partner sends for a collector respin game (captured 2026-11-09)

> **The first real partner respin rounds we have.** Recorded from the partner's own demo of
> **Fortune Vault Force 5** (EAGaming / Play4Fun), `www.eu-cluster.com/rgs/engine`, in a real browser
> tab (the edge is behind a Cloudflare challenge). It is evidence for Phase 10, not a contract: one
> game, play money, about 40 requests. No session id, round id or token is recorded here.
>
> Mapped by the facade since Phase 14a (`rgs-translator-eagaming/src/collectorRespin.ts`, gate
> `collectorRespin.fixture.ts`): see "The partner's collector respin game" in
> [hold-and-win-wire.md](hold-and-win-wire.md). Transport:
> [play4fun-protocol.md](play4fun-protocol.md). The game's rules and our plan:
> [design/hold-and-win-enhancements.md](../design/hold-and-win-enhancements.md).

## What was played

| Round                  | Request                              | What happened                                                                                            |
| ---------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Buy the bonus          | `[{bet,[3,4]},{play,""}]` at `seq=0` | A collect in the buying spin, then the bonus with Multiply + Respin, 12 respins, a `collect` at `seq=14` |
| Ante ("Power Roll") ×4 | `[{bet,[1,4]},{play,""}]` at `seq=0` | Only coins and blanks dealt; each round closed in its own batch (`gameEnd`)                              |
| Buy "Center Coin"      | `[{bet,[2,4]},{play,""}]` at `seq=0` | A collector on reel 3 with coins on reels 4–5 triggered the bonus (Respin only)                          |

**Second session (2026-11-09):** 16 more bought bonuses, played by posting the same requests from
the game page at the same session (the demo client was too slow to animate in a background
window). About 140 respins, enhancement sets `10000`, `11000`, `01000`, `01001`, `00010`, `00011`,
`00001`.

**Third session (2026-11-09):** the boot `config` read directly, then 3 bought rounds. One bonus
had Expand + Boost + Multiply (`11010`); in its 7 respins Boost and Multiply never both hit. (The
partner has since confirmed they can hit the same coin, Boost first, then Multiply: see "Real
rounds".) The session then refused every bet option but
the base bet (see Transport).

Not seen in any session: a line win, a natural (unbought) trigger, Force 5, and a respin where Boost
and Multiply both hit.

## Transport: what this confirms

- **`seq` is a position.** `[bet, play]` moved it from 0 to 2; each respin `[play]` moved it by one;
  the closing `[{"action":"collect"}]` went at the next position (14 after 12 respins). Requests from
  the buy on carried `&gid=`. The empty-body heartbeat `[]` was interleaved and moved nothing.
  Matches [play4fun-protocol.md](play4fun-protocol.md).
- **A respin is a context-less `[{"action":"play"}]`**, as our wire already assumes.
- **A round with no feature closes in its own batch** (`gameEnd`, `gameRoundOver`); a feature round
  ends with the client's `collect`, answered by `gameRoundOver {win}` and `platform.gameRound`.
- **A base-game collect also needs the client's `collect`.** A Center Coin round whose collector
  paid ended with `gameEnd` but no `gameRoundOver`; it closed only after `[{"action":"collect"}]`
  at `seq=2`. A `bet` sent while it was open was refused.
- **A new session must send `config` before its first `bet`**; until then every `bet` is refused
  with `errorCode: 110`.
- **The server can refuse bet options.** In a later session (launched from a signed link) every
  option but `Base` was refused with `errorCode: 110`, "unexpected args for action bet". The game's
  web page calls the ante "operator dependent", so the operator may switch buys and the ante off; it
  may also have been a limit on that demo after scripted buys. The error looks the same as a
  malformed bet.

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

## The boot `config`

`[{"action":"config"}]` answers `jackpots` and `config {symbols, symbolsPay, wildSymbols,
lineAlign, lineCoinciding, gameCost, betOptions, betOptionNames, maxWinMp, window,
availablePayLines, paytable}`. `window` is `{reels: 5, rows: 3}`; `availablePayLines` are the five
lines in `bet`. **No reel strips, symbol weights, coin or enhancement odds, or RTP** are sent; they
stay on the server.

The paytable pays per line, in multiples of the bet per line (`{"on":{"occurs":[3,4,5],"of":"PIC1",
"mode":"line"},"pay":[400,600,1000]}`):

| Symbol     | ×3  | ×4  | ×5   |
| ---------- | --- | --- | ---- |
| PIC1       | 400 | 600 | 1000 |
| PIC2       | 300 | 400 | 800  |
| PIC3       | 200 | 300 | 400  |
| PIC4, PIC5 | 100 | 150 | 200  |
| PIC6–PIC8  | 30  | 50  | 80   |
| PIC9       | 10  | 20  | 30   |

These are the partner's numbers, recorded to read their wire. Our game's math is our own.

## Symbols and the board

- `spinStart.symbols`: `PIC1…PIC9`, `COIN`, `COLLECT`, `BLANK`; `symbolsPay.line` lists only the
  PICs; no wild.
- A board (`playWindow`, `collectWindow`, `playedSpin`) is **reels × rows**, reel-major, sent
  **whole** each spin. A coin is `COIN_<n>`; a collector carries its running total as
  `COLLECT_<cents>` once it has collected (bare `COLLECT` before).

## Confirmed by the partner (2026-11-13)

Their developer walked through a base-game collect (`COLLECT` on reel 3, `COIN_4` and `COIN_1` on
reel 5, at 0.40) and showed their server's bonus table:

- **`playWindow`** is the board before anything happens in the spin; **`playedSpin`** is the board
  after all of it. With nothing happening the two are equal; their ordinary games send only
  `playedSpin`. A client must read `playWindow` too.
- **`collectWindow`** is the board right after the `collect`. The collected coins **stay** on it
  beside the collector's total (`COIN_4`, `COIN_1`, `COLLECT_200`), and with nothing after it
  `playedSpin` equals it. So the end board must never be summed: it would pay 4.00 for a 2.00
  collect. The round pays `bonusWin.pay` and `gameEnd.win` (200).
- **`cellPayAmount`** says where each coin is and what it is worth: `value` × the base total,
  `pay` in cents, `original` the standard value, which a Boost or Multiply can change in the bonus
  before the collect. **`collect.pay`** is what the collector is worth after it (160 + 40).
- **`bonusWin.bonus`** is `"winWithoutTrigger"` for a collect in a spin that triggers nothing, and
  `"initialspin"` for one in the spin that triggers the bonus.
- **The bonus table** lists 16 ids: the 15 mixes of expand, boost, multiply and respin, and Force 5
  alone as `00100` (the `powerFive` bit is never mixed with the others). `freespins` is commented
  out: the game has none.

## Real rounds (2026-11-13)

Their developer sent **three full rounds from their server log** for Getting Hot, each at a base
bet (betPerLine 1, base total 10 cents). `collectorRespin.fixture.ts` replays each one event for
event (data: `packages/rgs-translator-eagaming/collectorRespinRealRound.ts`). The few contexts their
log abbreviated are filled in like their full neighbours.

- **Surprise trigger into Expand** (`10000`): 13 respins, two collectors, a MINI, `gameEnd 1060`.
- **Natural trigger into Expand + Boost + Multiply** (`11010`): 6 respins, one collector,
  `gameEnd 330`.
- **Force 5** (`00100`) through a surprise trigger: 5×5, 11 respins, one collector, a MINOR,
  `gameEnd 890`. Its head (bet, gameStart, the base `spinStart`) was not in their paste.

What they show, and what the partner confirmed alongside them:

- **The surprise trigger.** `surpriseTrigger {state}` follows a `playWindow` that would not
  trigger (nothing on it in the Expand round; two coins and no collector in the Force 5 one). The
  server then adds coins and a collector. Each added coin gets a `bonusSymbol` after
  `surpriseTrigger`; the added collector shows only through its `collect`. `cellPayAmount` then
  covers every coin, `collectWindow` and `playedSpin` show the topped-up board, and the trigger runs
  as usual (`bonusWin {bonus: "initialspin"}`, `boostsAwarded`, `spinTrigger`, `enterBonus`).
- **`state` is the bonus the surprise awards**, its five flags read as one binary number (expand 16,
  boost 8, powerFive 4, multiply 2, respin 1): 16 = `0b10000` Expand, 4 = `0b00100` Force 5, each
  matching that spin's `boostsAwarded`. The partner's table of the values it can take:
  `0b00000`, `00001`, `00010`, `00011`, `00100`, `01000`, `01001`, `01010`, `01011`, `10000`,
  `10001`, `10010`, `10011`, `11000`, `11001`, `11010`, `11011`. Force 5 reaches the bonus through a
  surprise trigger. The facade passes `state` through and reads nothing more into it.
- **A natural trigger** sends the same events as a bought one, with no `surpriseTrigger`; its coins'
  `bonusSymbol` events come before `playWindow`.
- **`spinTrigger.trigger.from` is `""`** in all three rounds. Force 5's `spinTrigger` has `spins: 5,
  occurs: 5`, and its `enterBonus` / `playedBonusSpin` `trigger.occurs` is `[5]`.
- **`collect.pay` is the collector's NEW total** (80, then 80 + 40 = 120), the same number as its
  `COLLECT_<cents>` on `collectWindow`. `bonusWin.pay` is what the spin paid (coins × collectors).
  Only the collectors carry into the bonus, with what they took from the coins of the trigger spin.
- **A respin's collected coins stay on its `collectWindow` and `playedSpin`** and are gone from the
  next respin's `playWindow`.
- **A respin where nothing lands** sends only `playWindow`, `playedSpin` and `playedBonusSpin`, plus
  the Boost and Multiply misses (`boost {"boost": "X"}`, `multiplier {"multiplier": "X"}`) when the
  bonus rolls them: no `collectWindow`, no `bonusWin`, no `retrigger`.
- **Boost and Multiply.** They hit two different coins in one respin of the natural round. They can
  also hit the same coin (the partner): Boost first, then Multiply. `cellPayAmount` comes before
  the `boost` / `multiplier` events and already carries the modified value (`original` "2", `value`
  4 after +20; `value` 8 after ×4), and `collectWindow` shows the modified coins (`COIN_4`,
  `COIN_8`). Force 5 rolls both every respin while `boostsEnabled` stays `{powerFive: 1}`; its Boost
  hits were +50 (5× base).
- **A collector that lands has no `bonusSymbol`** (bare `COLLECT` on `playWindow`, then its own
  `collect`).
- **`enterBonus` / `playedBonusSpin` shapes:** `prob`, `additionalPrice`, `triggers`, `played`,
  `left`, `multiplier: {}`, `bonusTriggers: {"<bits>": 1}` (an object), `bonusPlayed: {"<bits>":
  {count, base: {count, multiplierCount}, states: {}}}`, `spins: [{spins, bonus, trigger: {occurs,
  from}, state: "main"}]` (`spins` = what is left; empty after the last), `playing`, `state:
  "main"`, `trigger`; `enterBonus` also has a `triggering` OBJECT `{bonus, trigger}`.
- **`spinStart.reels`** in the bonus are FILTERED display strips: all `BLANK` but one `COIN` (a
  `COLLECT` on reel 3), `ranges` [15, 15, 30, 15, 15]. In the base game they are long strips,
  `ranges` [118, 124, 5, 115, 109].
- **`retrigger {games}`** is the number of respins added back (Force 5: 3 when `left` was 2).
- **Jackpot coins** pay their tier × the base: MINI 250, MINOR 500.
- **The rows.** Rows count top-down, row 0 the top row (the partner; their own client draws the
  base collect's `COLLECT` at row 2 on the bottom row). Expand's row and both of Force 5's go on TOP
  (the partner and the owner): the board grows upward and nothing on it moves on screen, but every
  base row's index moves down by the rows opened. The trigger's collector at row 0 is at row 1 of
  Expand's 4-row board and at row 2 of Force 5's 5-row one. Our reader keeps the base rows' index
  and numbers the opened rows after them, outward from the base rows; Game Config `addRowsAt:
  'above'` draws them on top.

## Event shapes seen

Base spin of the buy round, in order:

```text
bet {total, betPerLine, paylines[5]}         gameStart {totalBet, betPerLine}
jackpots {MINI, MINOR, MAJOR, GRAND}         spinStart {symbols, betOptions, …}
bonusSymbol {reel, row, symbol, win} × coins playWindow [[…]]
cellPayAmount {reel, row, original, value, pay} × coins
collect {reel, row, pay}                     bonusWin {bonus: "initialspin" | "winWithoutTrigger", pay, isSpinWin: false}
collectWindow [[…]]                          boostsAwarded {expand, boost, powerFive, multiply, respin}
spinTrigger {spins: [{prob, spins}], occurs, bonus, trigger: {occurs: [3,4,5], from}}
playedSpin [[…]]                             enterBonus {left, triggers, bonusTriggers, spins, triggering, …}
```

Each respin:

```text
jackpots, spinStart, boostsEnabled {expand, boost, powerFive, multiply, respin}
bonusSymbol … / playWindow / cellPayAmount …
boost {boost: "X"}                                             (a miss)
boost [{reel, row, startingPay, boost}]                        (a hit; `boost` in cents is added)
multiplier {multiplier: "X"}                                   (a miss)
multiplier [{reel, row, startingPay, multiplier}]              (a hit; the cell's value is multiplied)
collect {reel, row, pay} (one per collector)   bonusWin {bonus, pay, isSpinWin: false}
collectWindow [[…]]   retrigger {games}   playedSpin [[…]]   playedBonusSpin {played, left, …}
```

The last respin adds `playedBonusSpins` and `gameEnd`; the client then posts `collect`.

A base spin with a line win, a coin and no collector (Getting Hot, 2026-11-13, `[bet [0, 10], play]`):

```text
bet {total: 100, betPerLine: 10, paylines[5]}   gameStart {totalBet, betPerLine}   jackpots
spinStart {…, wildSymbols: [], lineAlign: "any", lineCoinciding: false}
bonusSymbol {reel: 0, row: 0, symbol: "COIN_5", win: 500}   playWindow [[…]]
spinWin {what: "PIC5", occurs: 3, mode: "line", pay: 1000, mpInfo: {mp: 1, replacements: 0},
         mpBonusInfo: null, context: {paylineId: 2, payline: [2,2,2,2,2], direction: "any"}}
playedSpin [[…]]   gameEnd {win: 1000}
```

The board's bottom line was PIC2, PIC5, PIC5, PIC5, PIC6: an `any` line pays a run wherever it sits.

## What it tells us about the game

- **The bonus id is the enhancement set.** `boostsAwarded` is five 0/1 flags in the order expand,
  boost, powerFive, multiply, respin, and `spinTrigger.bonus` / `enterBonus.bonusTriggers` use the
  same bits as a string: `"00011"` = Multiply + Respin, `"00001"` = Respin only. Force 5 is the
  `powerFive` bit. `boostsEnabled` repeats the set on every respin.
- **Coins do not stick in the bonus; collectors do.** The bonus board opens with only the
  collector(s), carrying the value they gathered in the trigger spin (the trigger spin's own
  `collect` pays into it). Each respin, new coins are paid into the collectors in view and vanish.
  This is our `stickiness: 'collectorsOnly'` with `collects: 'perRespin'`.
- **Two collectors each take the full value of every coin.** With `COLLECT_400` and
  `COLLECT_1200` in view, an 800 coin made them 1200 and 2000; the next 600 coin made them 1800
  and 2600. The coin is not split, so with two collectors it pays twice.
- **Collectors land only on reel 3 in the bonus too** (every `collect` was at `reel: 2`), and each
  keeps its own total. The feature pays the sum of the collectors (`gameRoundOver.win` = 960 +
  2440).
- **The counter:** `enterBonus.left` was 4 (Respin on). `retrigger {games}` brings `left` back to the
  start when a symbol lands; `games` is the number of respins added back.
- **Boost and Multiply hit only a coin that landed this respin**, before the collect (7 of 7 boost
  hits and 5 of 5 multiply hits were on a fresh coin). With no coin landing they show X. Since
  coins do not stick, "a cash value in view" means a coin landing now. Multiply: `startingPay` 200
  ×2 → `cellPayAmount.value` 10 (`original` 5). Boost adds 1–5× the base bet (40–200 cents seen)
  and raises the coin's value the same way: a 200 coin boosted by 40 → `original` 5, `value` 6,
  `pay` 240.
  Order in the events: `cellPayAmount`, `boost`, then `collect`.
- **Neither hits a jackpot coin.** In 4 respins where a jackpot coin landed with Boost or Multiply
  on, none was hit. Jackpot coins travel as `COIN_MINI` (also `COIN_MAJOR` seen), with
  `bonusSymbol.win` and `cellPayAmount.value` = the tier name and `pay` = the tier × base bet
  (MINI = 1000 at 0.40).
- **Expand opens the extra row at entry.** Every respin of a bonus with the expand bit has 4-row
  boards from the first respin on.
- **The trigger is any run of 3+ adjacent reels**, not only from reel 1: a collector on reel 3 and
  coins on reels 4 and 5 triggered (`trigger.occurs: [3,4,5]`).
- **"Center Coin" (50×)** deals the ante's coin-only reels with a collector guaranteed on reel 3.
- **The ante** deals coins, collectors and blanks only, at 5× the stake.
- **The base total is `gameCost × betPerLine`**, not `betPerLine ×` the 5 lines: `gameCost` is 10.
  The facade prices every coin and win on it.
- **The option names travel as `betOptionNames`** (our mocks say `betOptionsName`); the facade
  reads both.
