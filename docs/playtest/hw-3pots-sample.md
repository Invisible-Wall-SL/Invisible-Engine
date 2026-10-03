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

### S8 — Add-respins + upgrade (Phase 11a) — LOCAL `pots-extra` fixture only

This sample does not configure either special, so its mock refuses the forces. Play them on a
local runtime stub serving `normalizeGameConfigDoc(HOLD_AND_WIN_TEST_FIXTURES['pots-extra'])`
(recipe: the "Testing an unmerged engine branch" line above + a `/api/editor/runtime` stub) against
`PRESET=pots-extra … scripts/mock-rgs-server-holdandwin.mjs` on a FREE port (never 7788).

- **Force:** `special:addRespins` · `special:upgrade:all` · `special:upgrade:adjacent` ·
  `special:upgrade:jackpotTier` · `mystery:addRespins` · `mystery:upgrade`.
- **Expect:** add-respins plays `respinsAdd`, its "+N" flies into the respin counter (the
  `respinCounter` anchor, not the board's bottom), and the counter steps to `left` on arrival; a
  non-sticky one then clears (`cellsCleared` reason `applied`); later resets fill to
  `max(cap, left)`. Upgrade plays `coinUpgrade`, a beam lands on each coin, then each label counts to
  the event's `to` (cash coins only) or a MINI label turns MINOR under "MINOR UPGRADE". After every
  respin `stateHoldAndWin` equals the server's `holdAndWinState`; balance = before − stake + win.
- **Resume:** a plain reload cannot land mid-feature (the facade pre-fetches the round). Fail the
  third respin request (CDP `Fetch.failRequest` on `seq=4`), then reload: the board, counter and cap
  rebuild from the snapshot with no intro.

### S9 — Board expansion (Phase 11b) — LOCAL `pots-expansion-*` fixtures only

This sample's board never grows, so its mock refuses the forces (`unlock:<n>`, `expandFull`). Play
them on a local runtime stub serving one of `HOLD_AND_WIN_TEST_FIXTURES['pots-expansion-unlock' |
'pots-expansion-fullrow' | 'pots-expansion-count']` and, as its layout, the Hold and Win template
built for the grown board (`holdAndWinReferenceLayout(HOLD_AND_WIN_BOARD, { maxRows: 6 })`), against
`PRESET=<the same fixture> … scripts/mock-rgs-server-holdandwin.mjs` on a FREE port (never 7788).

- **Force:** `unlock:1` · `unlock:2` · `unlock:3` (one row per respin, by the fixture's rule) ·
  `expandFull` (every row, then the whole 6-row board).
- **Expect:** the respin board opens 6 rows tall with the bottom 3 LOCKED (dark panels, or the
  authored Locked Row art) and spins only the open rows. On an unlock an unlock symbol plays
  `rowUnlock`, flies into its row, the row's locked cells fade under "ROW UNLOCKED · 4 ROWS", and the
  symbol leaves (`cellsCleared` reason `applied`); a full row or a coin count opens the row with no
  flight. Coins land in the new rows from the next respin. `fullrow` reaching 5 rows pays MAJOR
  (banked); `expandFull` pays the full-board GRAND only once all 6 rows are open and full; `count`
  does not reset the counter on an unlock. In portrait and desktop the grown board and every piece
  around it stay on screen. After every respin `stateRespinBoard.rows` equals the server's snapshot
  `rows`; balance = before − stake + win.
- **End state (by design):** the base board plays `startRows`, so when the feature ends and the
  reel board comes back, the coins that sat in the unlocked rows leave with the feature — the reel
  board shows only the held coins of its own rows. They are paid (they are in the tally); do not
  report them missing.
- **Resume:** as S8 (a plain reload cannot land mid-feature): fail a later respin request, reload —
  the board reopens at the server's open rows, the rest locked, with no intro.

### S10 — The 12c done-when: a skinned Pot on all three pots (Phase 12c)

The design's done-when (§8): the author skins the Pot with their own bitmap fill and frame, and puts
a frog spine inside it that plays "celebrate" plus an FX on **Pot — activate** for that pot only,
its belly bone growing with the pot's level. All three pots, no Flow branch.

- **Author** (needs #1006 on the runtime, and the project's Pots screen — hub Owner checklist 5):
  1. `/components` → **Create** → **Pot Meter (Hold and Win)**, then **Edit inside Pot ›**.
  2. Inside the part, drop the frog spine. Give it a cue on **Pot — activate** playing its
     celebrate animation. Add a **Bind to value**: drives **Spine bone** (its belly bone), from
     **Pot (this instance's meter)** → level, **divide by** its maximum, out 1 → 2.5.
  3. Inside the part, drop the effect. In `/fx`, its layer triggers on the `potsConsume` event,
     with **Scope** left blank (it takes the pot's).
  4. Save. On the **Pots** screen, select each pot, switch its **component** to the copy, and pick
     **fillImage** and **frameImage** (and **backgroundImage**) in its **Pot art** group. Publish.
- **Force:** `meter:red`, then `meter:blue`, then `meter:green`, one round each. Wait for each
  feature to finish before the next: the client fetches the round up front, so the server is done
  long before the screen is.
- **Expect:** only the forced pot's frog plays celebrate and only its FX bursts, at the feature's
  entry. Its belly grows as the pot fills and shrinks as the feature takes the pot. The other frogs
  rest at their own pots' levels. No burst anywhere else (an FX inside a component used to burst at
  the top-left corner as well).
- **Local rehearsal** (no project data; how it was first verified, 2026-10-03):
  1. A `/api/editor/runtime` stub on a free port answering
     `{ assetBase, doc, config, componentDefs, effects }`. The doc is
     `holdAndWinReferenceLayout()` with each `potMeter` instance switched to the copy and given the
     art params; the config is `normalizeGameConfigDoc(HOLD_AND_WIN_PRESETS.pots)`; no `flowV2`.
     Stand-ins from the game's own assets: the H1 rig (`h1` as celebrate, its `beard` bone as the
     belly) and the `progressBar` sprites (`progressBar.png` / `progressBarFrame.png` /
     `progressBarBackground.png`).
  2. `PORT=<free> PRESET=pots node --experimental-strip-types --import ./scripts/ts-loader.mjs
     scripts/mock-rgs-server-holdandwin.mjs`.
  3. `PUBLIC_RGS_TRANSPORT=play4fun pnpm --filter lines dev`, opened with `?runtime=1&k=local`,
     `editorDocBase` = the stub and `rgs_url` = the mock. Force with `GET <mock>/force?sid=…`, press
     Space until the mock logs the round's `bet`.
  4. Read the scene off `globalThis.__PIXI_APP__`: a spine's animation is
     `rig.state.getCurrent(0)`. Read a bound bone with `bone.getWorldScaleX()`: the local
     `scaleX` reads 1, because `SpinePose` undoes its offsets after each world transform.

## Known state (2026-10-01)

- Until Phase 4c the respins show NOTHING moving: the base board stays on screen while the round
  plays out, then the total pays. Expected, not a bug.
- The project's Game Config was saved once from `/config` (Pots preset). It predates the Game
  Maker preset picker; a project created since starts with its preset saved as its own config.
