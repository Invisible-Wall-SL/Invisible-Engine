# Playtest — Hold and Win Classic sample (`hw-classic-sample`)

The Classic sticky sample: a `holdAndWin` project on the **Classic sticky (Grand)** preset (design
§1.2 "Grand"). 5×3, 5 lines. Every coin sticks, and a BOOST multiplier lands. Filling a column
lights one letter of G-R-A-N-D and clears it, and five letters pay GRAND. It boots the shared
runtime (`runtime:lines`). The test server's **`holdAndWin` mock** deals it
(`scripts/mock-rgs-server-holdandwin.mjs`, `PRESET=classic`; wire:
[hold-and-win-wire.md](../reference/hold-and-win-wire.md)). Status:
[status/hold-and-win.md](../status/hold-and-win.md).

## Create (once, owner)

In Game Maker, **Create a game** with key `hw-classic-sample`, client Invisible_Wall, game type
**Hold and Win**, preset **Classic sticky (Grand)**, then **Publish**. The preset is saved as the
project's Game Config, so no `/config` save is needed. Confirm with `GET
https://games.invisiblewall.org/api/hw-classic-sample/authoring/healthz`, which should report
`"protocol":"holdAndWin"`.

## Launch

Same as [hw-3pots-sample.md](hw-3pots-sample.md#launch) with the key swapped. The read token `k=`
is a secret. To force beats, boot through `rgs_url=games.invisiblewall.org/api/hw-classic-sample/authoring`.

## Forcing a beat (authoring mock only)

`GET https://games.invisiblewall.org/api/hw-classic-sample/authoring/force?sid=<sessionID>&beat=<spec>`
before a spin. Classic-relevant specs are `trigger`, `trigger:randomMetre`, `special:multiplier`,
`jackpot:MINI|MINOR|MAJOR`, `letter`, `letters`, `instant`, `chain` and `dead`. The mock refuses
tokens the preset cannot deal (`meter:*`, `lucky`, `wheel:*`) with an error envelope. That refusal
is a pass, not a bug.

## Scenarios

### S1 — Boot + base spin, coin labels

- **Do:** boot, tap to start, spin unforced until a `BONUS` lands.
- **Expect:** `__IE_RUNTIME_STALE__` falsy. Cells arrive as `{name:'BONUS', value}` and print the
  value × total bet in the session currency. A `JACKPOT:MINI` cell prints `MINI`. Balance and win
  match `gameEnd.win` / `platform.balance`.

### S2 — Feature plays to the right total (`trigger`)

- **Expect:** `holdAndWinTrigger {mode:'holdAndWin'}`, one `respinReveal` per respin and a
  `holdAndWinState` after each, then `holdAndWinEnd`. There are no free-spin events. The counter
  starts at 3 and resets whenever anything lands, a lone BOOST included (`reset: 'anySpecial'`). The end volley flies coins into the Total Win bar, and
  the final balance = start − stake + `gameEnd.win`.

### S3 — BOOST (`trigger,special:multiplier`)

- **Expect:** `coinBoost {source:'special'}`. Every held cash coin's label rises to its `to`
  (= `from` × multiplier). Held jackpot coins' `factor` rises too (`multipliesJackpots`; cells
  `{reel,row,jackpot,from,to}`). No `specialBecomesCoin` follows (`leaveBehind: none`), and the
  BOOST cell stays inert.

### S3b — Base-game instant collect (`instant`)

- **Expect:** no feature. A BOOST that lands beside coins gives `coinInstantCollect` with
  `multiplier` = the BOOST value. Coins and jackpot factors are multiplied first, and `gameEnd.win`
  = line pays + `coinInstantCollect.amount`.

### S4 — One column letter (`letter`)

- **Expect:** `columnComplete {letter:'G', cleared:true}`. The first letter lights, that column's
  cells bank their `amount`s and empty, and the counter keeps running.

### S5 — All letters → GRAND (`letters`)

- **Expect:** five `columnComplete`s, then `jackpotWin {tier:'GRAND', source:'letters'}`, and the
  feature ends. GRAND = 1000 × total bet. It is `banked: true`, so it is counted once in
  `holdAndWinEnd.total` together with the cleared columns' amounts (wire "Money").

### S6 — Jackpot coin (`jackpot:MAJOR`)

- **Expect:** a `MAJOR` coin in respin 1, labelled `MAJOR`. Its 100 × total bet sits in its tally
  cell (`jackpotWin` with `banked: false` is presentation only), so it is paid once, in
  `holdAndWinEnd.total`.

### S7 — Long chain (`chain`) and dead feature (`dead`)

- **Expect (`chain`):** the counter resets every respin with no frame stall over ~150 ms between
  respins. **Expect (`dead`):** three empty respins, then the end with the trigger coins only.

### S8 — Random metre and buys

- **Force:** `trigger:randomMetre`. **Expect:** `randomMetreTrigger`, then the feature enters with
  the board's coins held.
- **Do:** buy **BUY BONUS** (70 × bet) and **SUPER BUY** (300 × bet). **Expect:** the feature
  enters, and the balance falls by the buy cost. Super Buy's first board carries 2 BOOSTs.

## Known state (2026-10-01)

- Not yet created or played live. Grand's letters and sweeps were verified only in Storybook,
  from facade-recorded books (status Open items, "Phase 4 follow-ups").
- No art for the Hold and Win symbols yet, so coins draw as their value label only.
