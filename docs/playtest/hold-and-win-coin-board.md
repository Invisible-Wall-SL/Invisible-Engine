# Playtest — Hold and Win coin board (no line game)

A `holdAndWin` project created in Game Maker with **Base game: Coin board only**
([plan](../design/hold-and-win-coin-board.md)): no reels and no line game. Every spin deals coins
and blanks onto the coin board's **paying cells** (the cells an active payline crosses), and enough
coins on them start the respins. The other cells are locked: blank, under the inactive overlay. The
**Line Overlay** marks the paying lines in their payline colours. It boots the shared runtime
(`runtime:lines`) and the test server's **`holdAndWin` mock** deals it
(`scripts/mock-rgs-server-holdandwin.mjs`; wire: [hold-and-win-wire.md](../reference/hold-and-win-wire.md)
"Coin board"). Status: [status/hold-and-win.md](../status/hold-and-win.md) (Phase 13).

The template is 5×3 with the 5 lines all fixed, **Coins on lines**, a trigger of 6 and jackpots
on. The pay rule (**Coins on lines**, **Line fill**, **Per line**) and who picks the lines
(**Designer** or **Player**) are Game Config's **Coin board** section; S5–S8 switch them.

## Create (once, owner)

In Game Maker, **Create a game** with key `hw-coinboard-sample`, game type **Hold and Win**, **Base
game: Coin board only**, then **Publish**. Its Game Config, screens, starter Flow and Symbols doc
are the coin board's own (scaffolded; no `/config` save needed). Confirm with
`GET https://games.invisiblewall.org/api/hw-coinboard-sample/authoring/healthz` →
`"protocol":"holdAndWin"`. Launch and forcing are as in [hw-3pots-sample.md](hw-3pots-sample.md#launch)
with the key swapped; the read token `k=` is a secret.

## Local boot (no launcher, no R2)

Three processes, then a Chromium page:

1. **The mock:** `PORT=7821 PRESET=coinBoard node --experimental-strip-types --import
./scripts/ts-loader.mjs scripts/mock-rgs-server-holdandwin.mjs` deals the template.
   `CONFIG=<a raw Game Config .json>` instead of `PRESET` deals any other coin board (a pay rule or
   a selection under test). `SEED=…` makes the deal repeatable.
2. **A `/api/editor/runtime` stub** on port 7820 answering `?project=<key>` with
   `{ assetBase: 'http://localhost:3001/assets/', name, doc, config, componentDefs: {}, effects: [],
flowV2, symbols: { map, index: { sheets: [], images: [], spines: [], collisions: [], missing: [] } } }`.
   Take `doc` (plus the Hold and Win set's `mainSizesMap`), `flowV2` and `symbols.map` from what
   `scaffoldProject(client, key, { holdAndWinJackpots: 'on', holdAndWinBase: 'coinBoard' })` writes
   (run it over an in-memory R2, as `apps/launcher-api/scripts/check-add-bonus-mode.ts` does), and
   `config` from the same Game Config the mock deals. Without `symbols.map` the coins draw as
   placeholder discs and the boot logs `BONUS, JACKPOT … no entry in the symbol map`: that is the
   stub, not the game.
3. **The runtime:** `PUBLIC_RGS_TRANSPORT=play4fun pnpm --filter lines dev` (port 3001).

Open `http://localhost:3001/?runtime=1&project=<key>&k=local&editorDocBase=http://localhost:7820&rgs_url=localhost:7821&sessionID=<fresh id>&lang=en&currency=USD&device=desktop`,
wait for the loading bar, then click the canvas. Container Chromium renders in software (4–6 fps):
allow about 5 s per base spin and 40 s for a feature.

**Forcing:** `GET http://localhost:7821/force?sid=<sessionID>&beat=<spec>` before a spin (held for
that session's next round): `trigger`, `jackpot:MINI|MINOR|MAJOR`, `fullBoard`, `dead`. **Mock
state:** `GET …/state?sid=<sessionID>` (balance, the open round and its `lineCount`).

## Scenarios

### S1 — Boot: the coin board, not the reels

- **Do:** boot and tap to start.
- **Expect:** no reels. The board shows the five lines (dashes between the cells in five colours,
  a numbered tab at each end), the jackpot bar on top (MINI $15 … GRAND $1,000 at a $1 bet), and
  no respin counter or Total Win bar. `[flow-v2] ACTIVE` in the console; no `pageerror` and no
  `no entry in the symbol map` (the scaffold bound `BONUS` and `JACKPOT`). human-eyes: the board
  reads as a coin board.

### S2 — A base spin deals the paying cells only

- **Do:** spin unforced (Space).
- **Expect:** only paying cells roll (with every line active, all 15). A coin prints its value ×
  the bet; a jackpot coin prints its tier. The bet echo's `paylines` / `paylineIds` list the
  round's lines; no `spinWin` comes, and Win stays $0.00 without a feature. Balance = start − stake.

### S3 — The feature (`trigger`)

- **Do:** force `trigger`, spin.
- **Expect:** the board stays (no screen swap) and keeps the dealt coins as held coins; the respin
  backdrop, **RESPINS** counter (left) and **TOTAL WIN** bar (right) appear; the counter starts at
  3 and resets on each landing. `holdAndWinTrigger`, `respinReveal` + `holdAndWinState` per respin,
  then `holdAndWinEnd`; the flow trace drives each (`[flow-v2] drove '…'`).

### S4 — The end: tally, clear, back to the base game

- **Expect:** the coins fly into the total; then the counter, the Total Win bar and the backdrop go,
  and the board clears to blanks (it never hides). Win = `holdAndWinEnd.total` in currency, final
  balance = start − stakes + `gameEnd.win` (= the mock's `/state` balance). The next spin plays on
  the same board.

### S5 — Middle line only (fixed `['1']`, minimum ≤ 5)

- **Config:** `coinBoard.lines = { selection: 'fixed', active: ['1'] }`, `triggerMin: { '1': 3 }`.
- **Expect:** the top and bottom rows sit under the dark overlay, never roll and stay blank; one
  line and its two tabs. The stake is 1 line × the bet. A forced trigger places coins on the middle
  row only. With minimum 5 a trigger is already a full board (GRAND at once): that is the config.

### S6 — Line fill (`payRule: 'lineFill'`, run length 3)

- **Do:** force `trigger`, play to the end.
- **Expect:** each run in `holdAndWinEnd.runs` lights its line in its payline colour, stamped with
  the run's total, while its coins fly. A coin in no run (`lines: 0`) dims and pays nothing. Σ
  `cells.amount` (+ `banked`) = `total` = Win.

### S7 — Per line (`payRule: 'perLine'`)

- **Expect:** every held coin shows a ×N mark (N = the cell's `lines`, the paying lines through it;
  the middle-row centre on 5 lines is the largest) and its label counts up to value × N before the
  volley. Win = Σ value × N.

### S8 — The player picks the lines (`selection: 'player'`, choices `[1, 3, 5]`, default 3)

- **Expect:** a **Lines** panel (− 3 +) at the HUD bar's **Lines selector** node (scaffolded right of
  Bet); Bet = 3 × the bet per line ($3.00 at $1), jackpots ×3. − to 1: one line, the other rows
  covered, Bet $1.00; + to 5: all five, Bet $5.00; each end greys its button. A spin at 3 lines
  sends `bet [3, <per line in API units>]` and the mock charges 3 × that. The panel greys mid-round
  and ignores a press. Move the **Lines selector** node in the Scene Editor (or the stub's `doc`):
  the panel follows; hide it in a layout: the panel goes back beside Bet. A fixed board shows no
  panel.

### S9 — A placed Line Overlay restyles the lines

- **Do:** set the **Line Overlay**'s params on the **Coin board** screen, e.g. `lineColor
#ff3df5`, `lineWidth 10`, `tabScale 1.5`, `tabTextFill #ffffff`.
- **Expect:** every line and tab in magenta, thicker, the tabs larger with white numbers, and no
  second (coded) set of lines. Delete the instance: the coded look returns. human-eyes.

## Known, not bugs

- The placeholder coin art is the `BONUS` scatter (its art says SCATTER); replace it in Symbols.
- `Failed to load resource: 404` once at boot locally (the stub has no favicon or Typekit font).
- A project switched to the coin board in Game Config (not created with it) keeps the plain
  template's screens: its board frame and tiles show only in the feature, and the S8 panel sits at
  its coded spot. Create the game with **Coin board only** for the coin board's own screens.
