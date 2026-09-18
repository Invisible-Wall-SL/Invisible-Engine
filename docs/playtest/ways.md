# Playtest — ways (every-way-pays)

The `ways` win model on the `apps/lines` dev client. Ways is the cheapest of the newer models to
stand up (cluster additionally needs a config default, a paytable-compatible `minCluster`, and the
collect gate widened past `winModel === 'scatter'`), so it is the one that closes "prove a
non-lines win model with a person playing it".

Read `docs/playtest/lines.md` first — the handles, the launch shape and the automation limits are
the same. This file only covers what ways does DIFFERENTLY.

---

## ⚠️ Read this before you launch: there are TWO different things you can boot

The mock and the client decide the win model **independently**, and only one of them is cheap to
point at ways.

- The **SERVER** side is now a single env var (`WIN_MODEL=ways`) — see Route A.
- The **CLIENT** side reads `winModel` off the project's Invisible Game Config, resolved
  `runtime → baked → compiled template` (`packages/engine-game/src/game/gameConfig.ts`). In this
  repo `apps/lines/src/baked-editor-bundle.json` carries **no `config`** and
  `apps/lines/src/game/config.ts` declares **no `winModel`**, so a plain local boot is a **LINES
  client**. The `/api/editor/doc` dev path fetches the LAYOUT DOC ONLY — it never carries a config —
  so no amount of launcher-doc fetching changes this. The only path that puts a ways config in the
  client is the **runtime bundle** (`?runtime=1&project=…&k=…` → `GET /api/editor/runtime`).

So pick your route deliberately:

| | Route A — local only | Route B — real ways client |
|---|---|---|
| Server deals ways | ✅ | ✅ |
| Board / reveal / win cells | ✅ | ✅ |
| Money math (book → wallet) | ✅ | ✅ |
| `payoutDivisor()` = ways count | ❌ (divides by line count) | ✅ |
| Info-page paytable pricing | ❌ wrong denomination | ✅ |
| Payline diagrams suppressed | ❌ draws phantom lines | ✅ |
| Payline win-line colour suppressed | ❌ | ✅ |
| Anticipation uses `createWaysReach` | ❌ uses the line walker | ✅ |
| Needs the launcher + a real project | no | **yes** |

**Route A is still worth playing** — it proves the ways evaluator, the wire shape, the win-cell
lighting and the wallet math, which is most of the round contract. It is just not the full
presentation. Do NOT report a Route A info-page/anticipation discrepancy as an engine bug; it is
this table.

---

## Route A — launch (local, no launcher)

1. **Start the mock RGS** (Bash, `run_in_background: true`) — port 7788, `ways` scoring:

   ```
   WIN_MODEL=ways PORT=7788 START_BALANCE=500000 node scripts/mock-rgs-server.mjs
   ```

   Confirm the banner says so before you spin anything:

   ```
   [mock] win model: ways
   ```

   `WIN_MODEL` is validated and **fatal on a typo** (`WIN_MODEL=way` exits 1 and prints the legal
   list) — a mock that quietly dealt lines while you thought you asked for ways is exactly the
   failure this gate exists to prevent. Other levers worth knowing:

   - `REELS=5 ROWS=3` — the dealt grid. `ROWS=3,4,4,4,4` deals a **stepped** board (that is the
     shape the live `test6` client draws). Leave both unset for `apps/lines`' own 5×3.
   - `FORCE_TRIGGER=1` — every base play enters the free-spin feature.
   - `SEED=<anything>` — repeatable deals. Round **ids** are not seeded; everything else is.
   - `MIN_CLUSTER` / `ADJACENCY` / `MIN_COUNT` / `MULTIPLIER` exist for the other models and do
     nothing here.

2. **Start the client.** Either `preview_start { name: 'ways-dev' }` (port 3031) or, equivalently,
   by hand:

   ```
   pnpm --dir apps/lines exec cross-env PUBLIC_RGS_TRANSPORT=play4fun vite dev --port 3031
   ```

   `.claude/launch.json` is **gitignored**, so the `ways-dev` entry is local to whoever added it —
   a fresh clone has to use the command above or re-add the entry. Note there is **no**
   `PUBLIC_RGS_GAME`: the facade then uses the default `linesMapping` (`PIC1…PIC7 → H1…L5`), which
   is the mapping that matches `apps/lines`' own symbol dictionary.

3. **`navigate`** to the game WITH the params (a bare preview boots a $0 / RGS-404 game):

   ```
   http://localhost:3031/?sessionID=dev&rgs_url=localhost:7788&lang=en&currency=USD&device=desktop
   ```

   → auth POST 200, Balance **$5,000.00**, reels populated.

Add `&anticipation=possible` (or `guaranteed`) to arm reel anticipation — the pre-Flow test path in
`Game.svelte`. Anticipation is **OFF by default** and otherwise owned by the Flow
`enableAnticipationMode` effect, and this repo's fallback scenes author no such graph, so without
that param there is nothing to observe.

## Route B — launch (the real ways client)

Same mock, same dev server. The difference is the game URL: add the runtime-bundle params so the
client fetches `test6`'s authored config (game key `waysofwavesbuild`, "Ways on Waves" — a stepped
5×[3,4,4,4,4] `ways` board).

```
http://localhost:3031/?sessionID=dev&rgs_url=localhost:7788&lang=en&currency=USD&device=desktop
  &runtime=1&project=test6&k=<read token>
```

- `editorDocBase` defaults to `https://app.invisiblewall.org`, so you do **not** need a local
  launcher — but you do need a live `?k=` read token, which you get by opening the game once from
  the launcher and copying it out of that URL. A wrong/expired token 401s and the game silently
  falls back to the LINES compiled template (it says so in the console — watch for
  `[runtime] LIVE DATA FETCH FAILED`).
- Match the server grid to the project or the board will be short-dealt:
  `WIN_MODEL=ways ROWS=3,4,4,4,4 REELS=5 PORT=7788 node scripts/mock-rgs-server.mjs`. If they
  disagree, `warnOnServerGridMismatch` prints a `[game-config] error:` line naming both sizes — treat
  that line as a hard FAIL of the launch, not a warning.

---

## Driving the game

Identical to `lines.md` — use those handles, not canvas clicks:

- **Pixi app:** `window.__PIXI_APP__`. pixi-svelte nodes are unlabelled; find the board/HUD by
  structure + `Text.text`.
- **Spin:** `(await import('/src/game/actor.ts')).gameActor.send({ type: 'BET' })`.
- **Read the truth from the bet POST response body** (the book), not from the canvas.

### Automation limits — do not auto-FAIL these

**Animation completion and return-to-idle are NOT observable under automation.** The Browser pane
backgrounds the tab (`document.hidden`), which freezes Svelte's rAF loop, so reel-stop tweens never
finish and the machine parks in `bet`. Pumping `app.ticker.update()` advances Pixi's ticker but not
Svelte's rAF clock. Everything below marked **human-eyes** is for a person's eyes only — report it,
never pass/fail it. This applies to every ways-specific visual too: the multi-cell win highlight,
the anticipation ramp, the count-up.

---

## What a CORRECT ways result looks like

This is the section that matters, because a ways board **looks like** a lines board and pays
nothing like one.

**1. Every completed run pays, and the wins SUM.** A payline pays its single best interpretation —
one win per line, the highest-value reading, and `dedupeCoincidingWins` collapses a shorter run
subsumed by a longer one. Ways has no lines and no competition between symbols: **every** symbol
whose run reaches a paying length emits its own `spinWin`, and `gameEnd.win` is their total. Two or
three `spinWin` events on one spin is CORRECT here and would be suspicious on lines.

**2. A win covers every matching cell on every contributing reel.** Not one row per reel — all of
them. That is the shape a payline literally cannot express, and it is why the positions go out as a
**bare array of `{reel,row}`** rather than a payline id. If positions ever arrive wrapped in an
object the win still pays and **lights up nothing** (`engineFacade`'s `winPositions` reads
`Array.isArray(ctx)`), which reads as an art bug and is not one.

**3. The run is left-anchored and contiguous.** It starts at reel 0 and ends at the first reel
holding none of the symbol (a wild substitutes). `occurs` is the number of contributing REELS, and
the positions must span exactly those reels.

**4. `ways` = the PRODUCT of the per-reel match counts**, not a count of cells. It rides along on
the win context so you can read WHY the pay is a multiple of the paytable.

**5. The config event declares `paylines: []`.** A ways game has no paylines and the honest wire
says so. (Historically an empty list was read as "absent", the stock 5×3 set was substituted, it
failed `coversAllRows` on a taller board and got regenerated into 13 phantom lines — which the
client then used as a stake divisor. If you ever see a non-empty `availablePayLines` on a ways
config event, that regression is back.)

### Sanity-checking the per-way pricing

```
betPerWay = totalBet / waysCount            waysCount = ∏ (visible rows per reel)
pay       = paytable[symbol][occurs] × ways × betPerWay      (rounded to whole cents, floor 1)
```

`waysCount` is the product of each reel's VISIBLE rows — **per reel**, so a stepped grid counts
correctly (5×3 = 3⁵ = 243; 5×[3,4,4,4,4] = 768). Never `rows ** reels` on a stepped board.

A real spin from `WIN_MODEL=ways SEED=waysdemo`, total bet 20 cents, 5×3 ⇒ `waysCount` 243 ⇒
`betPerWay` = 20/243 = 0.08230:

```
board:   PIC1/PIC6/PIC7 | PIC1/PIC6/PIC2 | PIC1/PIC1/PIC6 | PIC5/PIC4/PIC7 | PIC3/PIC6/PIC2

spinWin  what PIC1  occurs 3  mode ways  pay 33
         context [{0,0} {1,0} {2,0} {2,1}]            ← FOUR cells across THREE reels
spinWin  what PIC6  occurs 3  mode ways  pay 1
         context [{0,1} {1,1} {2,2}]
gameEnd  win 34
```

Walk it:

- PIC1 sits on reel 0 (1 cell), reel 1 (1), reel 2 (**2**), and reel 3 has none → `occurs` 3,
  `ways` = 1 × 1 × 2 = **2**. Paytable `PIC1[3]` = 200 → 200 × 2 × 0.08230 = 32.9 → **33**.
  Note reel 2 contributes rows 0 AND 1 to the same win — check (2) above, visible on the wire.
- PIC6 runs reels 0–2 one cell each → `ways` 1 → 10 × 1 × 0.08230 = 0.82. Rounding alone would pay
  **zero** for a win the player can see on the board, so the mock floors a positive win at one
  cent → **1**.
- `gameEnd.win` = 33 + 1 = **34** — the SUM across symbols, check (1).

**The denominator has to agree on both sides.** The mock's `payoutBaseFor` (`round.total /
waysCount`) must mirror the client's `payoutDivisor()` (`activeWaysCount()` for ways, the line count
for lines), or the info page prices a win differently from the wallet that credits it.
`pnpm check:stake` is the gate on that agreement — and note this is precisely what **Route A gets
wrong**, by design, because its client is still on the lines config.

### Reel anticipation on a ways board

`createWaysReach` (`packages/utils-slots/src/anticipationReach.ts`) is a genuinely different
calculation from `createLinesReach`, not line math with the paylines swapped out:

- **No row to walk.** A reel either contains the symbol or it does not; what matters is HOW MANY of
  its cells do, because the pay multiplies by the product of those counts. The locked prefix carries
  a running **product**, not a run of single cells.
- **Symbols do not compete.** The reach **sums across symbols**, exactly as `evaluateWays` does,
  where the line walker takes a max across candidate symbols per line.
- **The optimistic bound has to choose a length.** A longer run is not automatically worth more —
  `mult(r)` may be absent at some `r` while the ways product keeps growing — so `max` maximises
  `mult(r) × ways(r)` over every reachable length instead of assuming full width.
- `waysCount` is read **off the dealt board**, so a stepped or resized grid divides correctly.
- **The TRIGGER axis is identical to lines.** A scatter triggers on a COUNT ANYWHERE — never a line
  calculation in the first place — so "tease the 3rd scatter" behaves exactly as on lines.

Expected behaviour as reels lock (`k = 0…numReels`): `max` is **non-increasing** and `min` is
**non-decreasing** in `k`, and at `k = numReels` both equal the true final value. A `max` that goes
UP as a reel locks, or a `min` that goes DOWN, is a real bug.

⚠️ Route A arms the **line** walker (the selection follows `activeWinModel()`, the CLIENT's config).
Only Route B exercises `createWaysReach` in the running game. For the math alone, the offline
fixture needs no browser at all: `node packages/utils-slots/anticipationWaysReach.fixture.ts`.

---

## Scenarios

### S1 — Boot clean
- **Do:** run the Route A launch sequence; wait for idle.
- **Expect:** `[mock] win model: ways` in the mock banner; auth POST to `localhost:7788/rgs/engine`
  200; **Balance $5,000.00**; the `config` event carries **`paylines: []`**; no `error` console
  lines (a `/favicon.ico` 404 and a `<svelte:self>` deprecation warning are benign).

### S2 — A ways win pays, and pays by WAYS
- **Do:** `gameActor.send({ type: 'BET' })` until a spin returns at least one `spinWin`; capture the
  bet POST response body.
- **Expect:** every win has `mode: 'ways'`; `context` is a **bare array** of integer `{reel,row}`;
  the cells span exactly `occurs` reels starting at reel 0; and
  `pay === round(paytable[what][occurs] × ways × totalBet / waysCount)` with a floor of 1.
  `gameEnd.win` equals the sum of the wins. Rendered Balance / Win / Bet match the book exactly.
- **human-eyes:** the count-up and the return to idle.

### S3 — Several cells on ONE reel (the payline-impossible shape)
- **Force:** keep spinning (`SEED` for repeatability) until a win's `context` holds two cells with
  the same `reel`. `STACKED=1` makes this common.
- **Expect:** `positions.length > occurs`, and `ways` equals the product of the per-reel counts —
  e.g. 2 cells on reel 2 with 1 each on reels 0–1 ⇒ `ways` 2 and a pay twice the paytable base.
- **human-eyes:** **every** one of those cells is highlighted on the board, including both cells of
  the doubled reel. A win that pays but lights up only one row per reel is the `winPositions` shape
  bug described above.

### S4 — Two symbols pay on the same spin
- **Do:** spin until one response carries two or more `spinWin` events.
- **Expect:** both are kept — **no dedupe, no best-only**. `gameEnd.win` is their SUM. (On lines
  this would be wrong; here it is the mechanic.)

### S5 — A gap ends the run
- **Do:** read any board where a symbol appears on reels 0, 1 and 3 but not 2.
- **Expect:** either a 2-reel pay (if the paytable prices `occurs: 2` — `PIC7` does) or **no win at
  all**, and never a win crediting reel 3. The run stops at the first reel holding none of the
  symbol; it does not skip.

### S6 — Scatter / free spins still work
- **Force:** restart the mock with `WIN_MODEL=ways FORCE_TRIGGER=1`.
- **Expect:** the trigger response stays OPEN (no `gameRoundOver`); the free-spin counter appears
  with the correct count; the SCAT win carries one position per scatter; free spins pay the **ways**
  model's own wins, not zero; `collect` closes the round and credits the accumulated win. The whole
  round lifecycle is shared with lines — a difference here is a lifecycle bug, not a ways bug.

### S7 — Anticipation (Route B only)
- **Do:** launch Route B with `&anticipation=possible`, then again with `&anticipation=guaranteed`.
- **Expect:** as reels lock left to right, the `possible` (max) bound only ever falls and the
  `guaranteed` (min) bound only ever rises, both converging on the true final win; the scatter tease
  behaves exactly as it does on lines.
- **human-eyes:** the ramp itself — grey-out, zoom, the per-tier FX.
- **Note:** on Route A this arms the LINE walker and proves nothing about ways. Do not FAIL it there.

### S8 — Stepped grid (optional, Route B)
- **Force:** `WIN_MODEL=ways REELS=5 ROWS=3,4,4,4,4` against `test6`.
- **Expect:** the board deals ragged (reel 0 is 3 tall, the rest 4); `waysCount` = 768, **not**
  4⁵ = 1024 and not 3⁵; no `[game-config] error:` grid-mismatch line. `node
  scripts/verify-stepped-grid.mjs` is the offline gate on the same property.

---

## Gates that back this playbook

```
pnpm check:ways        # evaluator unit checks + the over-HTTP protocol/wire-shape check
pnpm check:rgs         # ways + cluster + scatter + free spins + stake consistency
node scripts/verify-stepped-grid.mjs
node packages/utils-slots/anticipationWaysReach.fixture.ts
```

A green gate proves the mechanism works. It does **not** prove the mechanism is reached by the
running game — that is what this playbook is for.
