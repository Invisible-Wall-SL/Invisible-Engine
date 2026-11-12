# Playtest — Getting Hot (the partner's collector bonus, partner game 8)

Getting Hot is our reskin of the partner's Fortune Vault Force 5: a 5×3 lines game. Coins land on
reels 1, 2, 4 and 5 and collectors on reel 3. The collector bonus has four enhancements (Expand,
Boost, Multiply, Respin) and a super bonus (Force 5). The partner's server owns every outcome; we
build the client. Plan: [hold-and-win-enhancements.md](../design/hold-and-win-enhancements.md)
(Phase 14). Status: [status/hold-and-win.md](../status/hold-and-win.md).

This playbook covers the beats Phase 14b presents. 14e extends it with the real project, its art
and the first launch against the partner's server.

## Launch (local, no production data)

Three processes, each on its own free port:

1. **The partner-wire mock** (14d): `PORT=<rgs> SEED=7 node scripts/mock-rgs-server-holdandwin-partner.mjs`.
   On the Invisible Test Server the same mock deals any project whose Game Config marks the
   partner's collector game (`holdAndWin.enhancements`, which **Lines game: collector +
   enhancements** sets) — no env var.
2. **A `/api/editor/runtime` stub** answering `{doc, config, assetBase, name}` with CORS `*`.
   Easiest: serve what Game Maker's **Lines game: collector + enhancements** scaffolds — run
   `scaffoldProject(client, key, {holdAndWinJackpots: 'on', holdAndWinBase: 'enhancements'})`
   (`apps/launcher-api/src/lib/server/projectScaffold.ts`) over an in-memory R2, as
   `check:add-bonus-mode` does, and serve its layout as `doc`, its Game Config as `config`, its
   flow as `flowV2` and its symbols doc's `symbols` as `symbols.map`. That is the game a new
   project plays: the dials on the Enhancements screen (shown by the starter Flow), the HUD's ANTE
   switch, and the coin and collector on placeholder art. Or by hand:
   - `config`: a 5×3 Hold and Win Game Config. COIN (`coin` + `jackpot`) goes on reels 0, 1, 3
     and 4, COLLECT (`collector`, `instantCollectInBaseGame`) on reel 2, plus BLANK.
     `stickiness: 'collectorsOnly'` and `expansion {startRows: 3, maxRows: 5}`. Line symbols are
     the facade's names for PIC1–PIC9 (`H1`–`H5`, `L1`–`L3`, `L5`).
   - `doc`: `holdAndWinReferenceLayout(HOLD_AND_WIN_BOARD, { maxRows: 5, potIds: [], enhancements: true })`.
     The option adds the Enhancements screen (four Enhancement Dials, the collectors' total) and
     the two banner screens. Leave it out to see the coded dials.
3. **`apps/lines`** on Vite with `PUBLIC_RGS_TRANSPORT=play4fun`.

Then open
`http://localhost:<vite>/?runtime=1&project=gettinghot&k=x&editorDocBase=http://localhost:<stub>&rgs_url=localhost:<rgs>&sessionID=<sid>&ie_authoring=1`.
Add `&ie_determinism=7` to step frames from a harness (the `__IE_DETERMINISM__` API that
`scripts/playtest/sample-play.mjs` drives).

## Forcing a beat

`POST http://localhost:<rgs>/force?sid=<sid>&beat=<tokens>` before the spin, or
`play.context = "force:<tokens>"`. The tokens are 14d's:

- `enhancements:<bits>`: five bits in this order: expand, boost, powerFive, multiply, respin.
- `boostHit` and `multiplyHit`: each needs its bit. They hit on the first respin.
- `superBonus`: Force 5, which is `enhancements:11111`.
- `twoCollectors`, `trigger`, `baseCollect`; `baseCollect,twoCollectors` is a base collect into two collectors.
- `jackpot:<TIER>` (MINI, MINOR, MAJOR, GRAND): a jackpot coin of that tier in the trigger run, e.g.
  `trigger,jackpot:GRAND`.

## Scenarios

### S1 — Base collect (`baseCollect`)

- **Expect:** each coin flies into the collector on reel 3, whose label counts up from $0.00 to
  the total the server gave it (`collectWindow`'s `COLLECT_<cents>`) and keeps it until the next spin.
  Then an "INSTANT WIN" banner with the amount. The HUD win equals the round's `gameEnd` win. No
  bonus.

### S1b — Base collect into two collectors (`baseCollect,twoCollectors`)

- **Expect:** each coin flies into BOTH collectors at once (one head each), and each collector's
  label climbs by the coin's full value and ends on its own server total. The banner reads
  "×2" and the sum.

### S2 — Trigger, Boost + Multiply hits (`enhancements:01010,boostHit,multiplyHit`)

- **Expect, at entry:**
  - The bonus board opens with the collector(s) on reel 3. The trigger spin's coins **stay on
    their seats**.
  - The Boost and Multiply dials light one after the other. Expand and Respin stay dim.
  - "BOOST · MULTIPLY ACTIVE" holds.
  - The entry collect flies the trigger coins into the collector, whose label climbs, and the
    coins clear.
- **Expect, on the first respin:**
  - The Boost dial flashes "+$n.nn" and a beam flies from it to the landing coin. The coin plays
    Coin enhance, its label shows "+$n.nn" for half a second (it pops), then counts up.
  - The same follows for Multiply: "×n" on the dial and on the coin, then the count.
  - Then the collect takes the coin's new value.
- **Expect, later respins:** a miss shows the dial's red X for a beat.
- **Expect, throughout:** the board stays **3 rows**, with no locked rows drawn.

### S3 — Expand (`enhancements:10000`)

- **Expect:** "EXPAND ACTIVE", then "ROW UNLOCKED · 4 ROWS" while the 4th row's locked cells fade
  open. Respins land in 4 rows. The 5th row is never drawn.

### S4 — Force 5 (`enhancements:11111,superBonus`)

- **Expect:**
  - "SUPER BONUS" (large), then all four dials light.
  - "ROW UNLOCKED · 5 ROWS": the board opens 5×5.
  - The counter starts at 5.
  - Expect a long feature: up to five collectors, each collecting every coin.

### S5 — Two collectors (`trigger,twoCollectors`)

- **Expect:** both collectors take every coin at entry and on each respin: each coin flies into the
  first collector, then into the second. Each label climbs on its own. The collectors' total readout climbs as each coin lands.

### S6 — Respin (`enhancements:00001`)

- **Expect:** "RESPIN ACTIVE", and the counter starts (and resets) at 4.

### S7 — A jackpot coin (any trigger; one turns up within a few rounds)

- **Expect:** when a collector gathers a jackpot coin, the coin lights with a small banner naming
  its tier and amount. It is presentation only: the collector's value already holds it.

### S8 — A buy over the ante (needs the HUD's ante switch and the three bet modes of 14c)

- Ante on → buy either option → play the whole round. **Expect:** the switch stays lit through it,
  and afterwards the stake reads 5× and the next spin posts `bet [1, …]`.
- Ante off → buy → next spin `bet [0, …]`.
- Mock with `DISABLED_OPTIONS=3`, ante on → Bonus Buy. **Expect:** the toast, the board kept, the
  switch still lit, the next spin `bet [1, …]`.

## Every round

- 0 console errors other than the stub config's known "no entry in the symbol map" for COIN and
  COLLECT (no Symbols doc). No "Missing handler" error.
- Balance after = before − stake + `gameEnd` win.

## Played (2026-11-09, Phase 14b, branch `hold-and-win/14b-collector-respin-presentation`)

S1–S7 were played frame-stepped in the GPU headless shell against the partner-wire mock, seed 7.
S1–S6 settled with 0 errors. S4 played all 56 respin requests; with five collectors each respin
takes about 5.5 s (Open items: pacing). The jackpot-coin beat showed as a MAJOR coin in a Force 5
entry collect.

## Played (2026-11-10, collect and hit visuals, branch `claude/hw-collect-visuals-03a848`)

Frame-stepped in the GPU headless shell against the partner-wire mock, seed 7: S1, S1b, S5
(`trigger,twoCollectors,enhancements:00001`), Multiply (`enhancements:00010,multiplyHit`) and
Boost (`enhancements:01000,boostHit`). Every round: balance after = before − stake + win; both
collectors ended on the server's totals (base $4.00 each, bonus $58.00 each). Screenshots: the
session notes folder, `hw-collect-visuals-screens/`.
