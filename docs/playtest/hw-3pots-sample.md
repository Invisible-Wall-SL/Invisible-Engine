# Playtest — Hold and Win 3 Pots sample (`hw-3pots-sample`)

The first published `holdAndWin` project (Game Config = the **Pots** preset, design §1.2 "3 Pots of
Egypt"). It boots the shared runtime (`runtime:lines`) and is dealt by the test server's
**`holdAndWin` mock** (`scripts/mock-rgs-server-holdandwin.mjs`; wire:
[hold-and-win-wire.md](../reference/hold-and-win-wire.md)). It exists to verify each Phase 4 PR
live — see [status/hold-and-win.md](../status/hold-and-win.md). It has no art for its Hold and Win
symbols yet (Phase 7), so coins draw as their value label only.

## Launch

- **Player link:** the Game Maker card's **Play ↗** —
  `https://games.invisiblewall.org/hw-3pots-sample/?runtime=1&project=hw-3pots-sample&k=<READ_TOKEN>&editorDocBase=https%3A%2F%2Fapp.invisiblewall.org&rgs_url=games.invisiblewall.org/api/hw-3pots-sample&sessionID=<fresh id>&lang=en&currency=USD&device=desktop`.
  **The read token `k=` is a secret** (R2 `test_server/games.json` → `games["hw-3pots-sample"].readToken`);
  never print or commit it.
- **To FORCE beats, boot through the AUTHORING mock:** use
  `rgs_url=games.invisiblewall.org/api/hw-3pots-sample/authoring` (the player mock refuses forces).
- **Testing an unmerged engine branch:** run that branch's `apps/lines` vite dev with
  `PUBLIC_RGS_TRANSPORT=play4fun` and open the same query string on `localhost`.
- Real clock: the headless-shell + CDP pipe path in [borut-remake.md](borut-remake.md). Add
  `&flowlog=1` for `window.__IE_FLOW_V2_TRACE__`.

## Forcing a beat (authoring mock only)

Before a spin: `GET https://games.invisiblewall.org/api/hw-3pots-sample/authoring/force?sid=<sessionID>&beat=<spec>`
— held for that session's NEXT round. Specs (full table in the wire doc): `trigger`,
`trigger:luckySpin` / `lucky`, `meter:red|blue|green`, `special:payer|multiplier|collector|mystery`,
`mystery:coin|jackpot:MINI|payer…`, `unlock:payer|multiplier|collector`, `jackpot:MINI|MINOR|MAJOR`,
`fullBoard`, `chain`, `dead`, `instant`. Combine with commas: `trigger,special:payer`.
Confirm the mock: `GET …/api/hw-3pots-sample/authoring/healthz` → `"protocol":"holdAndWin"`.

## Scenarios

### S1 — Boot + base spin, coin labels
- **Do:** boot, tap to start, spin with no force until a `BONUS` lands (15%/cell).
- **Expect:** `__IE_RUNTIME_STALE__` falsy; the bet response's `playedSpin` coins (`BONUS:1.5`)
  arrive as `reveal` cells `{name:'BONUS', value:1.5}`; each coin prints its money value (1.5 × the
  total bet, two decimals, the session currency); a `JACKPOT:MINI` cell prints `MINI`. Balance and
  win match `gameEnd.win` / `platform.balance`. No `Missing bookEventHandler` and no `_`-prefixed
  book events in the round (`__IE_DEBUG__` book log).

### S2 — Feature round plays to the right total (`trigger`)
- **Force:** `trigger`.
- **Expect:** the book carries `holdAndWinTrigger {mode:'holdAndWin'}`, one `respinReveal` per
  respin, a `holdAndWinState` after entry and each respin, then `holdAndWinEnd`; NO
  `freeSpinTrigger`/`updateFreeSpin`/`freeSpinEnd`. Final balance = start − stake + `gameEnd.win`.
  From Phase 4c: the respin board replaces the reels, coins stick with their labels, the counter
  reads 3 and resets on a new coin, the reels return at the end.

### S3 — Specials (from Phase 4d): `trigger,special:payer` · `special:multiplier` · `special:collector`
- **Expect:** each beat visibly changes the coin labels to the `to` values in the event.

### S4 — Mystery / unlock (Phase 4e): `mystery:jackpot:MINI` · `unlock:payer`

### S5 — Pots (Phase 4f): `meter:red` — the red pot fills, the feature enters with `payer` active.

### S6 — Lucky Spin (Phase 4g): `lucky` — intro, all-reel anticipation, skip disabled.

### S7 — Full board GRAND + feature end (Phase 4h): `fullBoard`.

## Known state (2026-10-01)

- Until Phase 4c the respins show NOTHING moving: the base board stays on screen while the round
  plays out, then the total pays. Expected, not a bug.
- The project's Game Config was saved once from `/config` (Pots preset). It predates the Game
  Maker preset picker; a project created since starts with its preset saved as its own config.
