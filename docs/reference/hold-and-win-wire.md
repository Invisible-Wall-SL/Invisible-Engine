# The Hold and Win wire — OURS, a swap seam

> **⚠️ This is not the partner's format.** The partner has never shown us a Hold and Win round, so
> every Hold and Win event below is invented by us (design §3.2, owner decision 2026-09-30). It is
> what our mock (`scripts/mock-rgs-server-holdandwin.mjs`) speaks and what the facade maps into the
> engine's book events (design §4.3). **When the partner delivers their format (Phase 10), this
> document and the facade mapping are rewritten; nothing above the facade may depend on it.**
>
> Plan: [docs/design/hold-and-win.md](../design/hold-and-win.md) · State:
> [docs/status/hold-and-win.md](../status/hold-and-win.md) · Transport and the parts that ARE the
> partner's: [play4fun-protocol.md](play4fun-protocol.md).

## What is the partner's, and what is ours

**The partner's (kept exactly):** the transport, `seq` as a position, the stored-action replay, resume
through the boot `config` (`resume: true` + `actions`), the two-pass rule (`bet` and `playedSpin`
first), and the respin feature as their generic respin model — `spinTrigger` names the bonus
(`bonus: "respin"`), `enterBonus` opens it, each respin is its own **context-less `play`** at the next
position under the round's `gid`, `playedBonusSpin {played, left, bonusPlayed, spins}` counts it,
`playedBonusSpins` + `gameEnd` close it and the client `collect`s. So today's facade already drives
a Hold and Win round to its end and settles the right balance before it understands a single event
below; a reset surfaces as `left` going back up, which is the inference the design made about their
core.

**Ours:** every event in the tables below whose name is not in the partner vocabulary, the cell value
syntax, the `holdAndWin` fields on `config` and on the bonus snapshots, and the forcing syntax.

## Symbols and cells

Symbols travel under the project's **own** Game Config names (`H1`, `W`, `BONUS`, `BOOST`, …) — not
the lines facade's `PIC*` vocabulary, which cannot name a coin. The boot config's `holdAndWin.roles`
says which symbol plays which role (`coin`, `jackpot`, `collector`, `coinMultiplier`, `payer`,
`mystery`, `meterSpecial`, `blank`, `addRespins`, `upgrade`).

A board is `string[][]` (reel-major), as everywhere. A cell that carries a value carries it after a
colon — the precedent is the lines mock's `MULT:5`:

| Cell                       | Meaning                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `H1`                       | a plain symbol                                                                      |
| `BONUS:1.5`                | a cash coin worth 1.5 × the **base** total stake (decimals allowed)                 |
| `JACKPOT:MINI`             | a jackpot coin                                                                      |
| `JACKPOT:MINI*2`           | a jackpot coin a multiplier doubled (`factor`)                                      |
| `BOOST:4` / `MULTI:3`      | a payer (adds 4 × stake to every coin) / a multiplier (×3) — the role says which    |
| `COLLECT` / `COLLECT:12.5` | a collector before / after it has collected                                         |
| `ADD:2`                    | an add-respins worth 2 respins (whole respins, not × stake)                         |
| `UPG:0.5` / `UPG`          | an upgrade with a cash step of 0.5 × stake / one with no step (a tier-only upgrade) |
| `BLANK`                    | an empty respin cell (the `blank`-role symbol; literally `BLANK` if none is tagged) |

Every structured cell in an event is `{reel, row, symbol, value?, jackpot?, factor?}`; `reel` and
`row` are 0-based visible coordinates. **Values are × the base total stake** (a bought round's premium
never raises them); **`amount` is always credits** (cents), `Math.round(worth × baseTotal)`, where a
cell's worth is its value, or `jackpot multiplier × factor`.

## The boot `config`

`config.context` carries the lines fields (`symbols`, `window`, `availablePayLines`/`paylines`,
`wildSymbols`, `paytable`, `symbolsPay`, and `betOptions`/`betOptionsName`/`gameCost` when the game
sells a buy) plus:

```jsonc
"holdAndWin": {
  "wire": 1,                       // this document's version — refuse a wire you were not written for
  "bonus": "respin",
  "roles": { "BONUS": ["coin"], "BOOST": ["payer", "meterSpecial"], … },
  "blank": "BLANK",
  "jackpots": [{ "name": "MINI", "multiplier": 15 }, …,    // × total stake
               { "name": "GRAND", "multiplier": 2000, "progressive": true, "value": 2003.5 }],
  "respins": 3,
  "stickiness": "allCoins",        // | "collectorsOnly"
  "boardEnd": { "type": "fullBoardJackpot", "jackpot": "GRAND" },  // | columnLetters {letters, jackpot} | none
  "meters": [{ "id": "red", "symbol": "BOOST", "level": 4, "max": 12, "sizeStages": [5, 9], "activates": "payer" }],
  "luckySpin": true,
  "randomMetre": "Diamond Metre"   // when the game has one
}
```

**Meter levels are server state.** They are per player (per session on the mock), survive rounds,
arrive at boot here, change only by `meterUpdate`, and are restated after every `play` by
`meterLevels`. The client never computes one.

**Progressive pools are server state too** (design §7 11c). A tier the Game Config marks
`fixed: false` is flagged `progressive` and carries its pool as `value` (× total stake, like
`multiplier`, which stays its fallback). The pool is per player (per session on the mock): every
`bet` adds the tier's `contribution`, it stops at its `cap`, a win pays the pool and puts it back to
its `seed`. It arrives at boot here, is restated after the opening `bet` and every `play` by
`jackpotLevels` and on every
balance heartbeat (`[]`), and a `jackpotWin` of the tier pays it. A game with no progressive tier
sends exactly what it did before — no `progressive`, no `value`, no `jackpotLevels`.

## A base spin — `[bet, play]` at `seq=0`

In order (pass 1: `bet`, `playedSpin`; pass 2: the rest as listed):

| Event                                                                                                 | Context                                                                 | When                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bet`, `gameStart`, `spinStart`                                                                       | as the lines mock                                                       | always                                                                                                                                                                                                                                                                                         |
| `luckySpin`                                                                                           | `{}`                                                                    | this spin is a server-announced Lucky Spin: it triggers (own intro, all-reel anticipation, no skip)                                                                                                                                                                                            |
| `spinWin` × n                                                                                         | lines mock shape, `what` in config names                                | each line win                                                                                                                                                                                                                                                                                  |
| `playedSpin`                                                                                          | the board                                                               | always                                                                                                                                                                                                                                                                                         |
| `meterUpdate`                                                                                         | `{meter, level, max, full, from: [{reel,row,symbol}], forced?}`         | a meter's symbol landed. `forced: true` = a forced full meter (the level was set one short first)                                                                                                                                                                                              |
| `coinInstantCollect`                                                                                  | `{specials: [cell], multiplier, times, cells: [cell + amount], amount}` | no trigger, and a collector/multiplier that `instantCollectInBaseGame` sat beside coins. Multipliers multiply the coins first (jackpots too when `multipliesJackpots`); `amount = times × Σ cells.amount`, `times` = collectors × collector level (1 with no collector). Adds to the round win |
| `randomMetreTrigger`                                                                                  | `{name, cells: [cell]}`                                                 | the random metre fired; `cells` are the coins it ADDED to make the trigger                                                                                                                                                                                                                     |
| `spinTrigger`                                                                                         | partner shape + `cause`                                                 | the feature starts (see below)                                                                                                                                                                                                                                                                 |
| `holdAndWinTrigger`                                                                                   | `{cause, meters?, cells: [cell], respins, stickiness, activeModifiers}` | `cause`: `count` · `pattern` · `meter` (`meters` = the full meters it consumed, now 0) · `luckySpin` · `randomMetre` · `buy`. `cells` = what sticks at entry                                                                                                                                   |
| `holdAndWinWheel`                                                                                     | `{index, prize: {type, multiplier? \| count? \| jackpot?}}`             | the pre-feature wheel                                                                                                                                                                                                                                                                          |
| `coinBoost` `{source: "wheel", …}` · `jackpotWin` · `coinCollect` · `cellsCleared` · `columnComplete` | as in a respin                                                          | entry effects: a wheel boost/jackpot, a streak game's first collect, a column already full at entry                                                                                                                                                                                            |
| `enterBonus`                                                                                          | partner snapshot + `holdAndWin` state                                   | the round STAYS OPEN                                                                                                                                                                                                                                                                           |
| `gameEnd`, `gameRoundOver`                                                                            | `{win}`                                                                 | no feature: the lines mock's close rules (a losing spin closes itself; `play: null` with a win waits for `collect`)                                                                                                                                                                            |
| `meterLevels`                                                                                         | `{meters: [{id, level, max}]}`                                          | after every `play`, when the game has meters                                                                                                                                                                                                                                                   |
| `jackpotLevels`                                                                                       | `{jackpots: [{name, value}]}`                                           | after the opening `bet` (the pools it grew — the play is dealt at them), after every `play` and in the heartbeat's `events`, when the game has a progressive tier — each pool × total stake, after any this play won went back to its seed                                                                                                                         |

**What sticks at entry:** `allCoins` — every coin and jackpot coin (specials on the triggering board
do not stick; with `activeModifiers.fromTriggeringSpecials` they activate their kind instead).
`collectorsOnly` — the collectors, and the triggering coins go straight into them (a `coinCollect`,
then `cellsCleared`).

**Active modifiers** at entry: `atEntry` ∪ kinds on the triggering board (when
`fromTriggeringSpecials`) ∪ each consumed meter's `activates` ∪ a bought tier's guaranteed kinds ∪
`collector` after an `extraCollect` wheel prize. Only active specials land in the respins; a mystery
can add one (`mysteryReveal.activates`).

**The wheel:** `coinBoost` multiplies the held cash coins now (`coinBoost {source: "wheel"}`) and
every coin drawn for the rest of the feature; `extraCollect` raises the collector level (capped at
`maxLevel`, read back from the snapshot's `collectorLevel`); `jackpot` banks that jackpot now.

## A respin — `[play]` (context-less) at the next position, under the `gid`

| Event                                  | Context                                                                                                                    | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playedSpin`                           | the board **as it lands**: held cells with their values before this respin, new cells where they landed, `BLANK` elsewhere | pass 1                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `coinsLand`                            | `{cells: [cell]}`                                                                                                          | exactly the cells that landed this respin (coins, jackpots, specials; a mystery as `MYSTERY`)                                                                                                                                                                                                                                                                                                                                               |
| specials, in the authored `applyOrder` |                                                                                                                            | each kind applies to the specials that landed this respin (a streak's collectors collect every respin)                                                                                                                                                                                                                                                                                                                                      |
| · `mysteryReveal`                      | `{cells: [cell + becomes], activates: [kind]}`                                                                             | `becomes`: `coin` · `jackpot` · a special kind; a revealed special then applies at its own place in the order — only when that place is after `mystery`                                                                                                                                                                                                                                                                                     |
| · `coinPay`                            | `{payer: {reel,row,symbol}, value, cells: [{reel,row,from,to}]}`                                                           | every cash coin `to = from + value`                                                                                                                                                                                                                                                                                                                                                                                                         |
| · `coinBoost`                          | `{source: "special", booster, multiplier, cells: [{reel,row,from,to} \| {reel,row,jackpot,from,to}]}`                      | every cash coin `to = from × multiplier`; a jackpot coin's `factor` too when `multipliesJackpots`                                                                                                                                                                                                                                                                                                                                           |
| · `specialBecomesCoin`                 | `{reel, row, from, symbol, value}`                                                                                         | a multiplier with `leaveBehind: becomesCoin` turns into a coin after applying                                                                                                                                                                                                                                                                                                                                                               |
| · `respinsAdded`                       | `{cell, added, left, total}`                                                                                               | an add-respins applied: `added` = its cell's value, `left` = the counter AFTER adding, `total` = the counter's cap after (raised by `added` only when `raisesCap`). Not sticky ⇒ a `cellsCleared {reason: "applied"}` for its cell follows; sticky ⇒ it stays, worth nothing                                                                                                                                                                |
| · `coinUpgrade`                        | `{upgrader, target, step, cells: [{reel,row,from,to} \| {reel,row,jackpot,fromJackpot}]}`                                  | an upgrade applied under `target` (drawn per landing): `all` — every cash coin `to = from + step`; `adjacent` — the cash coins in the 8 cells around it; `jackpotTier` — ONE jackpot coin, the lowest tier below the top (ties: lowest reel, then row), `fromJackpot` → `jackpot` one tier up, factor kept, `step: 0`, `cells: []` when none qualifies. Jackpot coins never change under `all`/`adjacent`. The upgrade stays, worth nothing |
| · `coinCollect`                        | `{collector, level, cells: [cell + amount], value}`                                                                        | the collector's new `value = old + level × Σ worth(cells)`. Sticky coins: it takes the cash coins, once, when it lands (`collects: atEnd` — at the feature end). Streak: every collector takes every coin and jackpot coin each respin, then they clear. Sent only when there was something to take                                                                                                                                         |
| `jackpotWin`                           | `{tier, amount, source, banked, cell?}`                                                                                    | see "Money"                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `cellsCleared`                         | `{reason: "collected" \| "applied", cells: [{reel,row}]}`                                                                  | `collected` — a streak's non-collector cells leave the board; `applied` — a non-sticky add-respins leaves after applying                                                                                                                                                                                                                                                                                                                    |
| `respinUpdate`                         | `{left, played, start, reset}`                                                                                             | `reset` = `anyCoin`: a coin or jackpot landed, or a mystery revealed one · `anySpecial`: anything landed. `start` is the feature's current cap. `left = reset ? max(start, left) : left − 1`, with `left` already counting this respin's add-respins (a reset never throws them away) — except on the respin that ENDS the feature (full board, last letter, cap), which always says `left: 0, reset: false`, like its closing snapshot     |
| `columnComplete`                       | `{reel, letter, newlyLit, cleared, value, amount, cells}`                                                                  | column letters: a column with every row held. `cleared` ⇒ its cells' `amount`s are banked and it empties; not cleared ⇒ the letter lights, the cells stay (`amount: 0`). Every letter lit ⇒ `jackpotWin {source: "letters"}` and the feature ends                                                                                                                                                                                           |
| `playedBonusSpin`                      | partner snapshot + `holdAndWin` state                                                                                      | after every respin — the board as it now stands                                                                                                                                                                                                                                                                                                                                                                                             |
| `holdAndWinEnd`                        | `{cells: [cell + amount], banked, total}`                                                                                  | the feature is over (see below)                                                                                                                                                                                                                                                                                                                                                                                                             |
| `playedBonusSpins`, `gameEnd {win}`    |                                                                                                                            | the feature is over; the client `collect`s at the next position                                                                                                                                                                                                                                                                                                                                                                             |
| `meterLevels`                          |                                                                                                                            | as above                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**The feature ends** when `left` reaches 0, the board is full (a full board with `fullBoardJackpot`
whose roles fill it first pays `jackpotWin {source: "fullBoard"}`), every letter is lit, or
`respins.cap` respins have played (the mock also stops at 200, a runaway guard). `meterLevels`
follows `gameEnd`/`gameRoundOver` in the same answer. The config's `boardEnd` names the type and
jackpot only; whether letters clear and which roles fill a board are learned from the events.

**The bonus snapshot's `holdAndWin`** (on `enterBonus`, `playedBonusSpin`, `playedBonusSpins`):
`{cells, start, left, played, banked, activeModifiers, collectorLevel, coinBoost, lettersLit?}` —
everything held, so a resume can rebuild the board from the last one. `start` is the counter's cap
as it now stands: `respins.start`, plus whatever a `raisesCap` add-respins has added. `respins.cap`
(the most respins one feature plays) is never raised.

## Modes — `modeEnter` / `modeExit`

A Hold and Win feature IS a mode: `holdAndWinTrigger` opens it and `holdAndWinEnd` closes it (the
facade gives them the engine's mode shape, `{mode: "holdAndWin", cause, payload}` /
`{mode: "holdAndWin", total, payload}`). They are never sent as `modeEnter`/`modeExit` as well. The
pre-feature wheel belongs to the Hold and Win entry; it is not a mode.

ANOTHER mode in the same round is announced explicitly, with the generic pair, so the facade can pass
it through without knowing the mode:

| Event       | Context                            | When                                                                                                                                                                                                     |
| ----------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modeEnter` | `{mode, cause, policy?, payload?}` | a mode is entered. `policy`: `nest` (default — it plays now, over the current mode) or `queue` (it plays once the current modes have ended). `payload` is the mode's own state, passed through untouched |
| `modeExit`  | `{mode, total?}`                   | that mode is over. `total` is in **credits**, like every amount on this wire (the facade converts it to book units)                                                                                      |

No preset produces a second mode today, so the mock sends the pair only for the forced `queuedMode`
beat (below): a mode queued behind the feature, announced right after `holdAndWinTrigger`, and closed
(`total: 0`, nothing of its own to play) right after `holdAndWinEnd`, before `gameEnd`. It exists so
the facade has a fixture for the shape.

## Money

- `holdAndWinEnd.total = banked + Σ cells.amount`, and `cells` are every held cell with a worth
  (coins, jackpot coins, collectors with a value — inert payers/multipliers, upgrades and sticky
  add-respins are not listed).
- `banked` = every `jackpotWin` with `banked: true` (sources `wheel`, `letters`, `fullBoard`) + every
  cleared `columnComplete.amount`.
- A `jackpotWin` with `banked: false` (sources `coin`, `collect`, `column`, `instantCollect`) is
  **presentation only**: its amount is already inside a tally cell, a collector's value, a column or
  an instant collect. **No `jackpotWin` is ever added on top.**
- A progressive tier's `jackpotWin.amount` (and a jackpot coin's tally `amount`) is its pool as it
  stood when the play was dealt, × the round's stake; two wins of one tier in one play both pay that
  pool, and it resets once, after the play.
- `gameEnd.win = Σ spinWin.pay + coinInstantCollect.amount + holdAndWinEnd.total`, and the balance
  moves by `win − stake` once the round closes.

## Positions, rounds and refusals

As the partner's protocol (play4fun-protocol.md, "`seq` is a position"):

- A **batch is atomic**: a refusal anywhere in it — or a server error — stores nothing, charges
  nothing, settles nothing and consumes a held force. A resend is therefore always safe.
- `config` takes no position, inside a batch too.
- A fresh action must go to the **next free position** of its round (`bet` to 0); a gap is refused.
- Once a round has played, every later `play`/`collect` must carry its `gid`; one with no `gid` or
  another round's is refused. A position already stored replays what was dealt there; a different
  action at it is refused.
- A `bet` with no `gid` while a round is open opens a new round (the partner's behaviour); the open
  one is played out and credited first — inside the same atomic batch, so a refused bet leaves it
  open.

## Buying the feature

A game whose bet modes sell a buy declares `betOptions` (the lines mock's rule: option 0 is the line
count, option _i_ costs `lines × cost_i / cost_0`). `bet [i, M]` on a buy option charges that price;
its `play` enters with `cause: "buy"`, lands the tier's `guaranteed` specials one per respin from
respin 1, and with `boostedSpecials` lands specials twice as often. Wins are priced on the base stake.

## Forcing a beat (mock only)

A force spec is comma-separated tokens; any feature token implies `trigger`:

| Token                                                                                     | Beat                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trigger[:count\|pattern\|luckySpin\|randomMetre\|meter[:<id>]]` · `lucky` · `meter:<id>` | enter by that cause                                                                                                                                                                                                                   |
| `special:<collector\|multiplier\|payer\|mystery\|addRespins>`                             | that special lands in respin 1 (and is active)                                                                                                                                                                                        |
| `special:upgrade[:all\|adjacent\|jackpotTier]`                                            | an upgrade lands in respin 1 and applies that rule (one the upgrade has; none ⇒ drawn). `jackpotTier` also lands the lowest-tier jackpot coin; `all`/`adjacent` land it beside a held cash coin (landing one first when none is held) |
| `mystery:<coin\|jackpot:<TIER>\|collector\|multiplier\|payer\|addRespins\|upgrade>`       | a mystery lands in respin 1 and reveals it                                                                                                                                                                                            |
| `unlock:<collector\|multiplier\|payer\|addRespins\|upgrade>`                              | the mystery reveals a special that was NOT active at entry                                                                                                                                                                            |
| `jackpot:<TIER>`                                                                          | a jackpot coin lands in respin 1                                                                                                                                                                                                      |
| `letter` · `letters` · `fullBoard`                                                        | respin 1 fills the first unlit column / every empty cell                                                                                                                                                                              |
| `wheel:<index>` · `wheel:coinBoost` · `wheel:extraCollect[:n]` · `wheel:jackpot:<TIER>`   | that wheel prize                                                                                                                                                                                                                      |
| `chain`                                                                                   | the longest reset chain — one new coin every respin (until one cell is left; 10 respins on a board that clears)                                                                                                                       |
| `dead`                                                                                    | nothing lands                                                                                                                                                                                                                         |
| `queuedMode[:<id>]`                                                                       | a second mode (default `queuedFixture`) queued behind the feature — see "Modes"; `holdAndWin` is refused                                                                                                                              |
| `instant`                                                                                 | a base-game instant collect, no feature                                                                                                                                                                                               |

Three ways in: `play.context = "force:<spec>"`; `POST|GET /api/<key>/force?sid=<sid>&beat=<spec>`
on the test server (held for that session's next round — how a playtest reaches it from a real
client; `beat=` clears); `FORCE=<spec>` for every round (CLI / `opts.force`). **On the test
server forcing is an authoring tool:** a runtime game's player mock refuses both routes (403 /
error 101); its authoring mock (`/api/<key>/authoring/…`, what authoring links point at) and a
standalone build's single mock allow it. A token the game cannot
deal (`letter` on Pots, `wheel` without a wheel, an unknown tier, a typo) is **refused** with an error
envelope, never dealt as a normal round.

Every beat is exercised by `pnpm check:holdandwin` (`scripts/check-holdandwin-protocol.mjs`).

## Running it

```bash
node --experimental-strip-types --import ./scripts/ts-loader.mjs scripts/mock-rgs-server-holdandwin.mjs
```

`PRESET=pots|classic|collector` (default `pots`) or a test fixture from game-config's
`HOLD_AND_WIN_TEST_FIXTURES` — never a picker preset: `pots-progressive` (11c — 3 Pots with MINOR,
MAJOR and GRAND progressive) or `pots-extra` (11a — 3 Pots plus an `ADD` add-respins and an `UPG`
upgrade); `PORT=7799`, `SEED`, `START_BALANCE`, `FORCE`. On the
Invisible Test Server a `holdAndWin` project is dealt by it automatically from its (published or
authoring) Game Config; a project with no `holdAndWin` block is dealt its base game as lines, with a
warning in the log. The Game Maker scaffold seeds a new `holdAndWin` project with the kind's default
preset (Pots), so only a project scaffolded before 2026-10-01 can lack one, and Publish warns about it.

## Pacing is the mock's, not math

How OFTEN something lands (a base cell is a coin 15% of the time, a special 5% per kind, an empty
respin cell lands something 6% of the time, a Lucky Spin 1%, the random metre 0.5%) is this mock's
pacing, chosen so features come round in a playtest. WHICH value lands follows the config's weights.
None of it is RTP.

## Open questions for the partner (Phase 10)

How coin values, jackpot labels, held cells, the counter and its reset, collectors, persistent meters,
the Lucky Spin flag and the feature total really travel; whether fixed coin jackpots ever use
`platform.gameRound.jackpot`; how a game's own progressive tier reports its pool (ours:
`jackpotLevels` and the boot `value`) and whether it is per player or shared; whether a respin board is sent whole (as here) or as a delta.
