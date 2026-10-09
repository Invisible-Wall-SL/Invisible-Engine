# Playtest — Hold and Win Collector sample (`hw-collector-sample`)

The Collector streak sample: a `holdAndWin` project on the **Collector streak (Super Hotfire
Diamonds)** preset (design §1.2 "Hotfire"). 3×3. Coins land on reels 1 and 3 only, and a COLLECT
lands on reel 2. Only collectors stick, and each one collects every respin. A pre-feature wheel
spins on entry, and a COLLECT in the base game can instant-collect. It boots the shared runtime
(`runtime:lines`). The test server's **`holdAndWin` mock** deals it (`PRESET=collector`; wire:
[hold-and-win-wire.md](../reference/hold-and-win-wire.md)). Status:
[status/hold-and-win.md](../status/hold-and-win.md).

## Create (once, owner)

In Game Maker, **Create a game** with key `hw-collector-sample`, client Invisible_Wall, game type
**Hold and Win**, preset **Collector streak (Super Hotfire Diamonds)**, then **Publish**. Confirm
with `GET …/api/hw-collector-sample/authoring/healthz`, which should report
`"protocol":"holdAndWin"`.

## Launch

Same as [hw-3pots-sample.md](hw-3pots-sample.md#launch) with the key swapped. The read token `k=`
is a secret. To force beats, boot through `rgs_url=games.invisiblewall.org/api/hw-collector-sample/authoring`.

## Forcing a beat (authoring mock only)

`GET https://games.invisiblewall.org/api/hw-collector-sample/authoring/force?sid=<sessionID>&beat=<spec>`
before a spin. Collector-relevant specs are `trigger`, `trigger:pattern`, `trigger:randomMetre`,
`instant`, `wheel:coinBoost`, `wheel:extraCollect[:n]`, `wheel:jackpot:<TIER>`,
`jackpot:<TIER>`, `chain` and `dead`. The mock refuses tokens the preset cannot deal (`letter`,
`meter:*`, `lucky`) with an error envelope. That refusal is a pass, not a bug.

## Scenarios

### S1 — Base spin + instant collect (`instant`)

- **Expect:** a base-game COLLECT on reel 2 collects the coins on reels 1 and 3, and its label
  rises to the sum. No feature is entered, and `gameEnd.win` = line pays +
  `coinInstantCollect.amount`.

### S2 — Pattern trigger + wheel (`trigger:pattern,wheel:extraCollect:2`)

- **Expect:** `holdAndWinWheel` spins before the first respin and lands on the forced prize. The
  collector level rises by 2, capped at 3 (the snapshot's `collectorLevel`). Then the respins run.

### S3 — Streak flights (`trigger`)

- **Expect:** each respin, every held COLLECT pulls the new coins to it with a `toCollector` flight,
  and the coins leave the board (`stickiness: collectorsOnly`). The counter starts at 3 and resets
  whenever anything lands, a lone COLLECT included (`reset: 'anySpecial'`). The feature-end volley flies the collector totals into the Total Win bar, and the
  final balance = start − stake + `gameEnd.win`.

### S4 — Wheel prizes: `wheel:coinBoost` · `wheel:jackpot:MINOR`

- **Expect (`coinBoost`):** `coinBoost {source:'wheel'}`. The held cash coins double now, and every
  coin drawn later in the feature is doubled too. **Expect (`jackpot:MINOR`):** a `jackpotWin`
  with `tier:'MINOR'`, `source:'wheel'` and `banked:true` = 50 × total bet, counted once in
  `holdAndWinEnd.total`.

### S5 — GRAND coin (`jackpot:GRAND`)

- **Expect:** a GRAND coin on reel 1 or 3 is collected into a collector. Its `jackpotWin` has
  `source:'collect'` and `banked:false`, so it is presentation only. Its 1000 × total bet is inside the
  collector's value, never added on top.

### S6 — `dead,wheel:extraCollect:1`

- **Expect:** three empty respins, then the end with the collector's entry total only. The wheel
  still spins under `dead`, so pin its prize: a random `coinBoost` or jackpot would change the
  total.

## Known state (2026-10-01; superseded by "Played live" below)

- Not yet created or played live. The streak flights, wheel and instant collect were verified only
  in Storybook, from facade-recorded books (status Open items, "Phase 4 follow-ups").
- No art for the Hold and Win symbols yet, so coins draw as their value label only.

## Played live (2026-10-09, Phase 7c)

Every scenario above that the published sample configures passed in Chromium against main 0cc277d
(its pre-7b bundle and manifest, read from R2): money and the HUD win exact, 0 errors or stalls, and
the unconfigured forces refused as described. Its stored Game Config is still legacy-shaped; a save
in `/config` writes the split form and deals byte-identically. Report:
[bonus-games-7c.md](bonus-games-7c.md).
