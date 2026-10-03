# Playtest — Book of Borut + Pots overlay sample (`borut-pots-sample`)

> **NEVER touch the live `bookofborutremake`.** Do not open it in `/config`, `/editor`, `/symbols`
> or `/flow-v2`, do not save, publish or force against it, and never write under its R2 prefix. The
> sample is a DUPLICATE so the live remake is never touched (design §7 #7). The only thing this
> playbook does with the live game is play its player link read-only (S9).

The pots overlay sample (design [pots-overlay.md](../design/pots-overlay.md), hub
[status/pots-overlay.md](../status/pots-overlay.md)). It is Book of Borut with the **3 Pots** add-on
layered on top. The owner made it with Game Maker → Duplicate (`invisible_wall/bookofborutremake` →
`borut-pots-sample`, setup scope), then added **＋ Pots overlay** with the **3 Pots** preset,
re-routed the green pot in `/config` → Add-ons (green pot → bonus mode `freeSpins`, so one pot
starts Borut's own free spins), then published. If the Game Maker action is not live yet, the same add-on is in `/config` → Add-ons. The
base game is still the `book` kind, so the test server deals it with the book mock
(`scripts/mock-rgs-server-book.mjs`) wrapped by `withPotsOverlay`
(`scripts/mock-pots-overlay.mjs`). The wrapper is selected because the contract carries
`grid.potsOverlay` (`makeBookMock` in `services/test-server/server.mjs`). The wire is described in
[hold-and-win-wire.md § Pots overlay](../reference/hold-and-win-wire.md).

## What the 3 Pots preset adds (`packages/game-config/src/potsOverlayPresets.ts` → `threePots`)

| Pot | Token | Max | Size stages | Full pot starts |
|---|---|---|---|---|
| `red` | `POT_RED` | 12 | 5, 9 | Hold and Win, **payer** active |
| `blue` | `POT_BLUE` | 12 | 5, 9 | Hold and Win, **collector** active |
| `green` | `POT_GREEN` | 12 | 5, 9 | Hold and Win, **multiplier** active |

- **The preset routes all three pots to Hold and Win.** The sample's setup re-routes green to
  `freeSpins` in `/config` → Add-ons (the hub's Owner checklist), which is what makes the design's
  done-when line "a full green pot starts Borut's own free spins" testable. Read the boot `config` answer's
  `potsOverlay.pots[].bonus` (and `activates`) to see what this build routes, and test S5b only if
  green says `freeSpins`.
- **Drops:** `chance` 0.15, `maxPerSpin` 6, table red 2 / blue 2 / green 2 / value coin 3. Drops
  happen in the base game only, on every reel.
- **Hold and Win bonus** = the `pots` Hold and Win preset as an overlay bonus
  (`holdAndWinBonus('pots', host)`). It triggers on **6+ value coins**
  (`trigger.count.min: 6`), starts with 3 respins, any new coin resets them, and all coins stick. It
  has MINI 15× / MINOR 30× / MAJOR 100× / full-board GRAND 2000×. Lucky Spin, the meters and
  instant collect are stripped.
- Borut's board is 5×3 on the book mock, so 15 cells can take a drop.

## Launch

- **Published, with forcing:** take the Game Maker card's **Play ↗** link and boot it through the
  **authoring** mock:
  `https://games.invisiblewall.org/borut-pots-sample/?runtime=1&project=borut-pots-sample&k=<READ_TOKEN>&editorDocBase=https%3A%2F%2Fapp.invisiblewall.org&rgs_url=games.invisiblewall.org/api/borut-pots-sample/authoring&sessionID=<fresh id>&lang=en&currency=USD&device=desktop&ie_authoring=1&flowlog=1`.
  **`k=` is a secret** (R2 `test_server/games.json` → `games["borut-pots-sample"].readToken`), so
  never print or commit it. The player mock (`…/api/borut-pots-sample` without `/authoring`) refuses
  forces with 403.
- **First assertion:** do what [borut-remake.md](borut-remake.md) says first.
  `window.__IE_RUNTIME_STALE__` must be falsy and there must be no red stale banner. The `config`
  answer must carry `potsOverlay.wire === 1` and three pots. Without that block the test server
  fell back to the plain book game (it logs "has a pots overlay but … dealing its book game with no
  pots"). In that case STOP and report it.
- **Real clock:** use the headless-shell + CDP-pipe path in [borut-remake.md](borut-remake.md),
  which is the launch in `scripts/playtest/win-countup-repro.mjs`. On the cloud image the binary is
  `headless_shell` (`/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell`), not
  `chrome-headless-shell`, so pass `--chrome <that path>`. As root it also needs `--no-sandbox`,
  which the script does not add: patch a scratch copy. Software rendering runs at about 4 fps.
  That is enough for order and money checks but not for judging timing.
- **Not published yet (local):** this is how Phase 4a was verified (status, "Real-clock
  verification").
  1. Build a throwaway config: a 5-reel book host plus `addPotsOverlay(doc, 'threePots')` from
     `packages/game-config/src/addOns.ts`, then `normalizeGameConfigDoc`. The `insert(BOOK_HOST,
     'threePots')` in `scripts/check-pots-overlay-protocol.mjs` is a ready-made one.
  2. Serve the mock on a FREE port (never 7788). The book CLI has no overlay switch, so use a
     ~10-line Node driver:
     `withPotsOverlay(createMockRgs, potsOverlayMockInputs(doc))({ label: 'pots', allowForce: true })`
     behind `http.createServer((req, res) => mock.handle(req, res, new URL(req.url, 'http://x')))`.
     Run it with `node --experimental-strip-types --import ./scripts/ts-loader.mjs`.
  3. Serve a `/api/editor/runtime` stub that answers the bundle with `config: <that doc>`
     (`RuntimeBundle` in `apps/lines/src/editor-scenes.ts`; no layout, so the fallback layout
     applies).
  4. Run `PUBLIC_RGS_TRANSPORT=play4fun PUBLIC_RGS_GAME=book pnpm --filter lines dev` (port 3001).
     Open `http://localhost:3001/?runtime=1&project=<any>&editorDocBase=http://localhost:<stub>&rgs_url=localhost:<mock port>&sessionID=<id>&lang=en&currency=USD&device=desktop&flowlog=1`.
  - Local runs have **no token art**, so a token draws nothing and its beat ends on its cap. Check
    the events and state, not the picture.

## Forcing a beat (authoring or local mock only)

The real client sends a context-less `play`, so the way to force is the held force:
`GET <rgs>/force?sid=<sessionID>&beat=<spec>`. For example,
`https://games.invisiblewall.org/api/borut-pots-sample/authoring/force?sid=<sid>&beat=pot:red`. The
force is held for that session's NEXT base spin. `beat=` with no value clears it. The answer
`{ok: true, sid, force: {...}}` confirms the overlay mock parsed it. A bad spec answers 400 with
`errors`. The other route is `play.context = "force:<spec>"`, which only a scripted client can send.
Tokens are comma-separated (`parseForce` in `scripts/mock-pots-overlay.mjs`):

| Spec | Beat |
|---|---|
| `overlay:drop` | at least one drop (1–6 tokens or coins drawn from the table) |
| `overlay:coins:<n>` | `n` value coins drop (1 ≤ n ≤ 15) |
| `pot:<id>` | the pot is set to 11 and its token drops, so it is full on this spin |
| `pot:<id>:<level>` | the pot is set to `level` (0–11) before the spin. Nothing is guaranteed to drop |
| `feature` | Borut's own free spins trigger on the same spin |

You can combine them, for example `pot:red,feature`, `pot:blue,overlay:coins:3` or
`pot:green:8,overlay:drop`. The mock refuses an unknown pot, a level out of range, more than 15
drops, or a typo.

## Scenarios

Read every answer from the `rgs/engine` network log (the round's events). For every round, the
balance must equal the balance before, minus the stake, plus `gameEnd.win`. The rendered
Balance/Win must match `platform.balance` and `gameEnd.win`. The console must show 0 uncaught
exceptions and no `Missing bookEventHandler`. The round must end back at idle with spin armed. The
only expected console noise is environmental (Typekit, a `boot.json` 404).

### S1 — Base spin plays Borut, tokens over its symbols (`overlay:drop`)

- **Expect:** the answer reads `spinStart`, then `overlayDrop {cells: [{reel, row, symbol, pot?|value?|jackpot?}]}`,
  then Borut's own `spinWin`s / `playedSpin`, then one `meterUpdate` per pot that moved, then
  `gameEnd`, then `meterLevels` last.
- Tokens appear after the last reel stops (the only timing built). Each one sits on its cell's seat,
  ABOVE the symbol. The `stateOverlay` record lists them.
- The symbol under a token still pays: a line through a token cell pays as it would without the
  token (`spinWin`), and a book (`SCAT`) under a token still counts toward the trigger.
- **human-eyes:** token art, pop-in, and the token covering a win frame (see Known limits).

### S2 — Tokens fly to their pots; levels and size stages

- **Do:** `pot:red:4` (or `:8`), then spin with `overlay:drop` until a red token lands. The pick is
  weighted, so it may take several spins.
- **Expect:** every `meterUpdate.from` cell lifts its token as that pot's flight starts
  (`toMeter:red`). The pot's level steps once per token, to `level`. It reaches size stage 1 at
  level 5 and stage 2 at level 9 (`meter.red.stage`). After `meterLevels`, every pot equals the
  server's `{id, level, max}`. A value coin does not fly, and it is gone at the next spin press.

### S3 — A full pot starts its Hold and Win, drain first (`pot:red` · `pot:blue` · `pot:green`)

- **Expect:** `meterUpdate {meter, level: 12, full: true, forced: true}`, then
  `spinTrigger {bonus: 'respin', cause: 'meter', meters: [id]}`, then
  `holdAndWinTrigger {cause: 'meter', meters, activeModifiers: [<special>]}`, then `enterBonus`.
  `activeModifiers` must be `payer` for red, `collector` for blue and `multiplier` for green.
  The DRAIN plays first: the pot drains with its "Pot full" toast and banner. Then the respin board
  replaces the reels. With no value coins dropped, it starts EMPTY. Respins follow the Hold and Win
  wire (a context-less `play` each, under the `gid`) through `holdAndWinEnd`. The answer's
  `meterLevels` reads that pot at 0. The base board comes back with Borut's symbols, and the round
  `collect`s.
- After every respin, `stateHoldAndWin` equals the server's `holdAndWinState`.

### S4 — Value coins start Hold and Win with them held (`overlay:coins:6`, then `overlay:coins:5`)

- **Expect, 6 coins:** each coin shows its value label (× the base total stake, two decimals) or
  `MINI`/`MINOR`/`MAJOR`. Then `holdAndWinTrigger {cause: 'count'}` with no `meters`, and `cells`
  is exactly those 6 coins. The respin board opens with them held in the same cells. No pot drains.
- **Expect, 5 coins:** the coins show, no feature starts, and the round closes. The coins are
  cleared at the next spin press.
- **Combined (`pot:blue,overlay:coins:3`):** ONE feature starts, with `cause: 'meter'`, the
  collector active, and the 3 coins held.

### S5 — Borut's feature and a pot bonus in one round (`pot:red,feature`)

- **Expect:** the trigger answer is Borut's free-spin entry, and red shows `full: true` (no drain
  yet). Borut's free spins play out in full, with one outro. The last free spin's answer carries
  the pot's `spinTrigger` and Hold and Win entry instead of `gameEnd`. The drain plays, Hold and Win
  plays, then a single `gameEnd {win}` equals the whole round's win and the round goes back to
  idle. This is the Phase 4a run; reproduce it.
- **S5b (only if green routes to `freeSpins`):** use `pot:green`. Expect
  `spinTrigger {bonus: 'feature', occurs: 0, cause: 'meter', meters: ['green']}`, then
  `freeSpinTrigger` with `positions: []`. The drain plays before the intro, the coded intro reads
  "A full pot awards N Free Spins", and N = `bonus.spins` (10 by default).

### S6 — Pot levels persist across rounds

- **Do:** use `pot:blue:7` and finish the round. Spin a second round with no force. Then reload
  with the SAME `sessionID`.
- **Expect:** blue reads 7 (or more, if a blue token dropped) in each round's `meterLevels`, in the
  reloaded boot `config.potsOverlay.pots[].level`, and on the drawn pot. The client never computes
  a level. A fresh `sessionID` starts every pot at 0.

### S7 — Refusals

- `beat=pot:purple`, `beat=pot:red:12` and `beat=overlay:coins:16` each answer 400 with `errors`.
  The next spin is dealt as a normal round.

### S8 — Random play (no force)

- Play about 30 spins. Expect about 15% of spins to drop something, no exceptions, every round back
  to idle, and money exact.

### S9 — Parity: Book of Borut itself (no block), read-only

- Play the live `bookofborutremake` player link exactly as [borut-remake.md](borut-remake.md) says.
  No authoring link, no force, no tool opened.
- **Expect:** its boot `config` has NO `potsOverlay` key and NO `holdAndWin`. No answer carries
  `overlayDrop`, `meterUpdate` or `meterLevels`. No pots are drawn and the overlay layer is empty.
  Free spins look and pay as in borut-remake.md. Phase 4a measured this locally: `main` and the
  branch gave 13 byte-identical RGS answers and the same 262-line flow trace.
- **Compare against the sample:** the same Borut board, paylines, book and free spins. The only
  differences should be tokens, pots and the bonuses they start.

## Known limits — do NOT report as bugs (hub "Open items")

- **Timing:** tokens appear after the last reel stops, unless the config sets
  `potsOverlay.timing: 'perReel'` (`/config` → Add-ons → "Tokens appear"); then each reel's tokens
  come down as that reel stops. A board that swaps in place always shows them together.
- **Each token is its own flight's head** (4b). It waits in its cell until its flight leaves, then
  flies as the head in its `flyToMeter` state. The cell under it is not lit.
- **Resume between a drop and its fills shows no tokens.** Neither `overlayDrop` nor `reveal` is in
  the resume snapshot. The following `meterUpdate` still flies from the cell.
- **The coin draws over the win frame** (owner decision, design §7 #9). A token on a paying cell
  covers that cell's frame by design.
- **The drain plays after the mode has entered,** so the new mode's screens and music are already
  up. A flow that OWNS `freeSpinTrigger` or `modeEnter` still drains the pot: unless its chain plays
  `drainPots`, the game plays the drain first (4b). A flow that owns `holdAndWinTrigger` drains only
  through `showRespinBoard`.
- **A token with no `/symbols` art draws nothing.** The add-on seeds placeholder art, so this is a
  bug only on the published sample.
- **About 4 fps in the container** (software GL). Token pop-in, lift-off, the flights and the drain
  need **human eyes** at full frame rate with real art.
- **Expected, not bugs (seen on the first local run, 2026-10-03):** a 3 Pots feature's
  `activeModifiers` always include `mystery` beside the pot's special (the Pots Hold and Win preset);
  on a trigger spin the mock sends the `meterUpdate`s before `playedSpin` (the facade holds them until
  the board has paid); a forced `pot:<id>` reads its old level, then 12 (the forced 11 is never shown).
- Inherited from [borut-remake.md](borut-remake.md): there is no retrigger overlay, the hamburger
  menu does nothing, and the Buy Feature copy is off-theme.
