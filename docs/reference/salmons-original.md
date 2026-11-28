<!-- Read-only comparison of the original Salmons (GuiltyForever/salmon- @ fb907fb) with the pipeline rebuild (main @ 8d61bc9cf), 2026-11-18. The original is the ground truth for the Salmons rebuild. -->

# OWNER DECISIONS (2026-11-18) — these override the report where they differ
1. Round flow: LIKE THE ORIGINAL. The first salmon to reach the source wins; the room locks; `game_won` goes out (win animation); players move on to a new room with a NEW river/seed. No timer, no score goal. The authorable lobby room is where players wait before a session.
2. Bear swipe: LIKE THE ORIGINAL — catches any live player (salmon, fishermen and other bears).
3. Golden salmon: the previous game's winner rejoins golden; cosmetic only (no 3x, no banner).
4. Death: the original's "You have been caught / by NAME" screen with a Respawn button (manual respawn) — PLUS the player picks what to respawn as on that screen: salmon, fisherman or bear. Remove the SCORE/ROUND/TIME HUD (the original has none).
5. Keep the bots that fill rooms and the bear/fisherman caps as they are.
6. Camera: do NOT copy the original's ignoring of the waterfall lift (looks like a bug) — keep the camera following the lifted salmon.
7. (2026-11-19) Fisherman cast: do NOT copy the original's "no range limit" (§5.3 and its FIX). A line reaches only as far as the fisherman sees — the room's standard 1920 × 1080 screen about him at the desktop tile; a farther aim is pulled in to its edge; bots are held to the same sight. Current rule: `docs/status/salmons.md`.

# Salmons: original vs pipeline gap report

- **Original (ground truth):** `GuiltyForever/salmon-` @ `fb907fb` ("Add permanent salmon bloodstains (#8)"),
  read in full: `server/index.js`, `server/mapGenerator.js`, `server/obstacleIndex.js`,
  `server/shared/*`, `client/game.js`, `client/input.js`, `client/main.js`, `client/rendering/*`,
  `client/src/**/*.svelte`, `client/style.css`, `docs/art-pass.md`, `art/sheets.json`.
- **Pipeline:** `Invisible-Engine` `origin/main` @ `8d61bc9cf`.
- Units: the original works in **grid cells** ("tiles"): `gx` runs down the river (0 = source,
  400 = sea), `gy` runs across it. The pipeline uses world px with `CELL = 48` px per cell, the
  original's `gx` as world **y** and `gy` as world **x** (`salmonsMap.js` `xOf`/`yOf`). Original
  speeds in cells/s × 48 = pipeline px/s.
- The original server runs at **60 Hz** (`MAX_TICK_RATE: 60`, `setPatchRate(1000/60)`); `dt` is in
  seconds. Grid → screen in the original: `x = (gx − gy)·32`, `y = (gx + gy)·16 − z·16` (64 × 32 tile,
  `HEIGHT_UNIT` 16). The pipeline draws a cell as a 96 × 48 diamond (`K = 1.5`).

Severity: **G** = gameplay-breaking / changes how the game plays; **V** = clearly visible;
**m** = minor. "LACKS" = the pipeline has nothing for it.

---

## 0. Quick ranking (top differences by impact)

| # | Area | Sev | One line |
|---|------|-----|----------|
| 1 | Round flow / win | G | Original: one game per room, the first salmon to the source wins, the room locks, everyone sees the win screen and joins a NEW room (new river). Pipeline: 300 s rounds, score race, +10 goal, auto next round on the same river after 15 s, lobby. |
| 2 | Fisherman cast | G | Original: aimed skill-shot — the bobber lands at the clicked water point (any range), reels back at 8 cells/s hooking the first swimming salmon it passes within 1.5 cells, drags it, +1 on landing, 250 ms cooldown, no escape. Pipeline: auto-hooks the nearest salmon within 280 px, reels at 200 px/s, +2, 3.5 s cooldown, 5 taps escape. |
| 3 | Bear attack | G | Original: swipe at a point 1 cell ahead along the last move, radius 1.5 cells, instant, no cooldown, catches ANY live player (incl. other catchers). Pipeline: 110 px around the bear's centre, salmon only, 1.2 s cooldown. |
| 4 | Bears in the water | G | Original bears walk in the river (only waterfalls and a bank limit stop them). Pipeline makes the water solid to bears. |
| 5 | Death / respawn | G/V | Original: caught → hidden, "You have been caught / by NAME" overlay + Respawn button, manual respawn. Pipeline: out 3–4 s then auto-respawn, no overlay. |
| 6 | Speeds | G | Salmon 6 / bear 4.5 / fisherman 5 cells/s = 288 / 216 / 240 px/s. Pipeline 240 / 190 / 140. |
| 7 | World mirrored | V | Pipeline's projection puts the source top-RIGHT and the sea bottom-LEFT; the original has the source top-LEFT, the sea bottom-RIGHT. Every diagonal (waterfalls, banks) runs the other way. |
| 8 | Sandbanks | G | Original re-grounds a salmon every time it lands on sand (you hop across islands). Pipeline grounds once per visit and then lets it swim off. The sand maze is the first 110 columns after spawn. |
| 9 | Bloodstains (#8) | V | LACKS: permanent stains where a salmon died, the red-tint + trail on a salmon that swims through one. |
| 10 | Golden salmon | G/V | Original: the previous game's winner re-joins golden (cosmetic only). Pipeline: random per round, scores ×3, banner "GOLDEN SALMON — WORTH 3×". |
| 11 | Win animation, menu, loading | V | LACKS: WinAnimation (eggs, big fish), Start menu (name, faction, class, live river list with names), loading phrases, splash sound; pipeline shows a SCORE/ROUND/TIME HUD the original does not have. |
| 12 | Forest walls & banks | V | Original: grass only 5 cells either side of the water, then 12 rows of dense forest following the river; sandy beaches in the last 80 columns. Pipeline: one big grass rectangle (14 cells past the WIDEST water), 7 % trees, forest only 4 cells past the world edge, no beaches. |
| 13 | Keyboard | G | Original keys are screen-relative (Up = straight up the screen) and normalised. Pipeline keys are world-axis (Up = up-right on screen) and diagonals are √2 faster; Space does not swipe for a bear. |
| 14 | Bank collision | G | Original rejects any move that would leave the water (salmon stops dead). Pipeline pushes it back with a 420 px/s force (slides along the bank, can overlap). |
| 15 | Whirlpool pull | G | Original pull is `d·14·(1−d/4)` cells/s (peaks 14 cells/s at 2 cells, still 6 at 3.5 → almost inescapable without jumping). Pipeline normalises: `14·(1−d/4)` (peak at the centre, 3.5 cells/s at 3 cells). |
| 16 | Camera / zoom | V | Original: no dead zone, lerp 0.15 per frame, follows the leap height, 1:1 tiles, mobile zoom 0.5. Pipeline: 320×200 dead zone, τ 0.1 s, ignores leap height, tiles ×1.5, no mobile zoom-out (so the view shows much less river). |
| 17 | Spawns | G/m | Original salmon spawn spread ±0.4·halfWidth (≈ ±19 cells) across gx 390; catchers random along gx 30–370, 3–8 cells off the bank, ≥15 cells apart. Pipeline: every salmon on one point; catchers on 16 fixed bank places. |
| 18 | Fishing line drawing | V | Original draws rod→bobber the whole time the line is out (cast wiggle, bobber dot), whether or not a salmon is on. Pipeline draws only while hooked, rod→salmon. Pipeline also draws placeholder circles (220 px swipe, 560 px cast, 150×70 splash) the original never had. |
| 19 | Floating catch text | V | LACKS: "you catch NAME!" over the catcher. |
| 20 | Bridges | V/G | LACKS (carried, not drawn/played): up to 3 plank bridges, fishermen walk on them and fish from them. |
| 21 | Bots / caps | owner | Pipeline fills rooms to 20 with bear/fisherman bots and caps bears 30 / fishermen 20. Original has no bots and no per-class caps. (Owner decisions §14 #5 — keep unless the owner reverses.) |

---

## 1. Map generation

### Already matches (ported line for line)
`packages/engine-mechanics/src/salmonsMap.js:22-195` ports `buildMeanderTable`, `getRiverHalfWidth`,
`getMeanderAt`, `generateMap` (waterfalls every 40 columns from gx 40 to < 280, heights 1..8 in a
5-tile rolling window, bridges, rocks/whirlpools 30 %/20 %, sand CA 28 %/4 iterations/3-4 rule) on
the same `seedrandom` PRNG (`seedrandom.js`), pinned by `check:salmons-levels`. River length 400,
width 3 → 28 (+ delta `progress²·30` past 0.85), sea 80, meander amp 10 / freq 0.025 all match.

### 1.1 Seed per room — m (matches in spirit)
- ORIGINAL `server/index.js:39`: `const seed = Math.random().toString(36).substring(2, 10);` a new
  base-36 string per room; a room plays ONE game.
- PIPELINE: `services/game-server/src/arcadeRoom.ts:116` `roomLevelSeed(...)`, a uint32 per room,
  decimal string into `generateSalmonsMap`. Same generator, different seed space (fine). The
  difference that matters is that pipeline rounds repeat on the SAME river (see §7).

### 1.2 Bank width / world shape — V
- ORIGINAL `client/game.js:354-365`: each column draws only
  `gyCenter − halfWidth − bankMargin .. gyCenter + halfWidth + bankMargin` with `bankMargin = isSea ? 2 : 5`,
  then `FOREST_DEPTH = 12` rows of trees beyond that on each side (`game.js:492-511`), following
  the meander. Catchers are bounded to `halfWidth + 12` (`server/index.js:365-373`):
  ```js
  isCatcherInBounds(x, y) {
    if (x >= GAME_CONSTANTS.RIVER_LENGTH - 5) return false;
    if (x <= 5) return false;
    const BANK_LIMIT = 12;
    const meander = getMeanderAt(this.meanderTable, Math.max(0, x));
    const halfWidth = getRiverHalfWidth(x);
    if (Math.abs(y - meander) > halfWidth + BANK_LIMIT) return false;
    return true;
  }
  ```
- PIPELINE `salmonsMap.js:279,307-314`: `BANK_CELLS = 14` past the **widest** water of the whole
  river (`gyMin = min(lo) − 14`, `gyMax = max(hi) + 14`), so the world is one rectangle ~145 cells
  wide; near the source (halfWidth 3) there are ~70 cells of open bank each side. Bears/fishermen
  can walk anywhere in it (`salmons.js:288-292` only makes water/sea/source solid).
- FIX: (a) add per-row bank zones that are solid to `bear`/`fisherman` beyond `halfWidth + 12`
  cells of the meander (or clip with a per-band "outer" zone), and solid for `gx ≤ 5` and
  `gx ≥ 395`; (b) draw grass only within `halfWidth + 5` cells, trees on every cell from
  `halfWidth + 6` to `halfWidth + 17` (§9.2).

### 1.3 Waterfall solid extent — m
- ORIGINAL: a waterfall is `2·halfW + 1` obstacle CELLS across the water only
  (`mapGenerator.js:182-184`), each tested with radius 1.5 cells (`distSq < 2.25`).
- PIPELINE `salmonsMap.js:355-357`: one zone `{x: 0, w: world.w, h: 40}` across the whole world,
  one-way solid for salmon only. Since salmon cannot leave the water this mostly matches; the stop
  distance differs (pipeline stops the 44-px-tall body ~42 px = 0.9 cells from the line; original
  ~1.41–1.5 cells). Minor.

### 1.4 Bridges — LACKS (V, and G for fishermen)
- ORIGINAL `mapGenerator.js:193-225` (ported), `server/index.js:540-577` (fisherman on bridge),
  `client/game.js:693-842` (drawing). See §5.4 and §9.6 for the code.
- PIPELINE: `salmonsMap.js:388-394` carries `bridges`, nothing draws or plays them.

---

## 2. Constants

| Constant | Original (`server/shared/constants.js`) | Pipeline | Sev |
|---|---|---|---|
| `SALMON_SPEED` | `6.0` cells/s = **288 px/s** | `salmons.js:226` `salmon: 240` | G |
| `BEAR_SPEED` | `4.5` = **216 px/s** | `bear: 190` | G |
| `CATCHER_SPEED` (fisherman) | `5.0` = **240 px/s** | `fisherman: 140` | G |
| `CURRENT_STRENGTH` | `1.5` cells/s = 72 px/s | `salmonsMap.js:315` `round(1.5·48)` = 72 | ✓ |
| Gravity / launch | `vz = 11`, `vz -= 20·dt` | `salmonsRules.js:62` `JUMP {launch 11, gravity 20}` | ✓ |
| Climb | `STEP 2.4`, `SLIDE 0.8`, `RADIUS_SQ 4.0` | `salmonsRules.js:58` | ✓ |
| Tick / patch | 60 Hz / 60 Hz | `game-config family.ts:364,366` 30 Hz / 20 Hz | m (rules are written to be rate-independent; leave) |
| Reel speed | `reelSpeed: 8` cells/s = **384 px/s** | `salmonsRules.js:155` `reelPxPerSecond: 200` | G |
| Hook radius | `HOOK_RADIUS_SQ 2.25` (1.5 cells = 72 px) around the travelling bobber | reach 280 px around the fisherman | G |
| Land distance | `ldist < 0.3` cells (14 px) bobber→fisherman | `landPx: 60` | m |
| Bear swipe | radius 1.5 cells (72 px) around `player + 1·lastDir` | `reach: 110` around the bear | G |
| Cooldowns | bear none; cast 250 ms (`CAST_COOLDOWN_MS`) | bear 1200 ms, fisherman 3500 ms | G |
| Catch score | `player.score++` (+1, either catcher) | bear +1, fisherman +2, golden ×3 | G |
| Rock block | radius 1.5 cells (`collisionRadiusSq = 2.25`), height 0.5 | box 1.5 cells (`salmonsMap.js:341-345`) vs body box 90×44 | m |
| Whirlpool | `pullRadiusSq 16`, `14·(1 − d/4)` × **unnormalised** `dx` | normalised (`abilities.js:179-189`) | G |
| Sandbank touch | within 0.8 cells of a sand cell (`< 0.64`) | body centre inside the sand rect | m |
| Max players | 100 | 100 | ✓ |

FIX (speeds): `packages/engine-mechanics/src/salmons.js:226` →
`const SPEED = { salmon: 6 * CELL, bear: 4.5 * CELL, fisherman: 5 * CELL };` (288 / 216 / 240).
This also lengthens the leap's ground (the leap's move is × the salmon's speed), which is then the
original's: along `6` cells/s, across `5.4` cells/s while airborne. Re-record traces as needed.

---

## 3. Player movement & input

### 3.1 Server-side salmon step (what to match) — reference
ORIGINAL `server/index.js:396-533,646-683` (salmon path, per tick):
```js
const speed = /* bear 4.5 | salmon 6 | catcher 5 */;
let moveX = (player.vx || 0) * speed * dt;   // vx/vy is the client's unit vector
let moveY = (player.vy || 0) * speed * dt;
// ... climbing branch (§4) ...
if (!climbing && ((player.z || 0) > 0 || (player.vz || 0) !== 0)) {
  player.z = (player.z || 0) + (player.vz || 0) * dt;
  player.vz = (player.vz || 0) - 20 * dt;
  if (player.z <= 0) { player.z = 0; player.vz = 0; }
}
if (player.faction === 'salmon' && !climbing) {
  moveX += (GAME_CONSTANTS.CURRENT_STRENGTH || 1) * dt;      // current always, even airborne
  this.obstacleIndex.hazards.forEach(obs => {                  // rocks, waterfalls, whirlpools in map order
    const dx = (player.x + moveX) - obs.x;
    const dy = (player.y + moveY) - obs.y;
    const distSq = dx*dx + dy*dy;
    if (obs.type === 'rock' || obs.type === 'waterfall') {
      const collisionRadiusSq = 2.25;
      const obstacleHeight = obs.type === 'rock' ? 0.5 : (obs.height || 1);
      const directionalBlock = obs.type !== 'waterfall'
        || (player.x > obs.x && moveX <= 0);
      if (!isNaN(distSq) && distSq < collisionRadiusSq && !climbing && directionalBlock) {
        if (player.z < obstacleHeight) { moveX = 0; moveY = 0; }   // the WHOLE move stops
      }
    } else if (obs.type === 'whirlpool') {
      const pullRadiusSq = 16.0;
      if (!isNaN(distSq) && distSq < pullRadiusSq && player.z < 0.5) {
        const pullStrength = 14.0 * (1 - Math.sqrt(distSq) / 4);
        moveX -= dx * pullStrength * dt;       // dx NOT normalised
        moveY -= dy * pullStrength * dt;
      }
    }
  });
  if (player.x <= 0) { /* win, §7 */ }
  if (player.z <= 0.05 && this.obstacleIndex.onSandbank(player.x, player.y)) {
    this.sandbankGrounded.set(sessionId, true);
    moveX = 0; moveY = 0; player.vx = 0; player.vy = 0;
  }
}
// ...
const nx = player.x + moveX, ny = player.y + moveY;
if (this.isInWater(nx, ny)) { player.x = nx; player.y = ny; }   // else: no move at all
if (player.x >= GAME_CONSTANTS.RIVER_LENGTH) player.x = GAME_CONSTANTS.RIVER_LENGTH - 0.01;
```
`isInWater` (`index.js:375-379`):
```js
const meander = Math.round(getMeanderAt(this.meanderTable, Math.max(0, x)));
const halfWidth = getRiverHalfWidth(x);
return Math.abs(y - meander) <= halfWidth;
```

### 3.2 Bank: block, not push — G
- ORIGINAL: above — a move that ends out of the water is dropped entirely (current included), so a
  salmon pressed into a bank stops dead; it never overlaps land.
- PIPELINE `salmons.js:55,248-257`: `BANK_PUSH = 420` px/s force zones left/right of each band; the
  salmon's box can enter the bank and slides along it.
- FIX: make the band's bank zones `solid: true` for `salmon` (as the water is solid to land
  characters) instead of a force, and test the salmon by its centre point (a point/ small body, or
  a zone inset by half the body width) so the water edge is where the original's is. Remove
  `BANK_PUSH` rules for `salmonsMap` rivers (keep for the P10.16 band river traces if needed).

### 3.3 Whirlpool formula — G
- ORIGINAL (above): velocity `−(dx, dy)·14·(1 − d/4)` cells/s with `(dx, dy)` the unnormalised
  offset from the whirlpool to the salmon's NEXT position, inside `d < 4`, only `z < 0.5`.
  Speed by distance: d=0.5 → 6.1, 1 → 10.5, 2 → **14**, 3 → 10.5, 3.5 → 6.1 cells/s (a 6 cells/s
  salmon cannot swim out from inside ~3.5 cells; it must jump).
- PIPELINE `abilities.js:176-189` `pullTowards`: `v = strength·(1 − d/radius)` along the unit
  vector, clamped to `d/dt`: d=0.5 → 12.25, 2 → 7, 3 → 3.5 cells/s.
- FIX: in `pullTowards` add an opt-in `scaled: true` on the pull (set by `salmons.js:263-265`) that
  uses `v = strength · (d / CELL) · (1 − d/radius)` px/s (i.e. `dx·pull` in cells), keep the clamp
  so it never overshoots. Keep the existing formula for other games. Old replays unchanged (opt-in).

### 3.4 Keyboard mapping — G
- ORIGINAL `client/input.js:124-140` (screen-relative, normalised):
  ```js
  if (this.keys['ArrowLeft']  || this.keys['KeyA']) { vx -= 1; vy += 1; }
  if (this.keys['ArrowRight'] || this.keys['KeyD']) { vx += 1; vy -= 1; }
  if (this.keys['ArrowUp']    || this.keys['KeyW']) { vx -= 1; vy -= 1; }
  if (this.keys['ArrowDown']  || this.keys['KeyS']) { vx += 1; vy += 1; }
  vx += this._touchVelocity.vx; vy += this._touchVelocity.vy;
  const len = Math.sqrt(vx * vx + vy * vy);
  if (len > 0) { vx /= len; vy /= len; }
  ```
  (`vx` = gx = along/downstream, `vy` = gy = across.) Up = straight up the screen.
- PIPELINE `apps/lines/src/game/online.ts:308-357`: `ArrowUp: [0, -1]` etc. on WORLD axes, and
  `moveX: Math.sign(x) * MOVE_SCALE, moveY: Math.sign(y) * MOVE_SCALE` — not normalised, so a
  diagonal is ×√2 speed, and in the iso view Up moves up-right.
- FIX: for a game drawn isometric, turn the key vector from screen into world with the scene's
  unproject (screen up = world `(−1, −1)/√2` for the current projection; after the mirror fix in
  §9.1, use that projection's inverse), then normalise to `MOVE_SCALE`. Do it for every isometric
  game or behind `arcade.online.pointer`/a `keys: 'screen'` option so other games keep theirs.

### 3.5 Mouse / touch — mostly matches
ORIGINAL `client/game.js:1348-1359,1671-1688` and `input.js`:
- `usingMouse` becomes true at the first `mousemove` and from then on the mouse position ALWAYS
  steers (hover), overriding the keyboard; touch steers while a finger is down (`_touchDown`), with
  the same follow-the-point velocity; dead zone `dist < 1.5` cells → stop.
- Moves are sent at most every 50 ms (20/s).
- A tap = touch lifted without moving > 12 px (`TOUCH_DEADZONE = 12`): sets `mouse.clicked`,
  `keys.Space` and `_tapJumpPos`. A mouse `mousedown` (button 0) sets `mouse.clicked`.
- Actions (`game.js:1369-1439`):
  - salmon: Space → `jump` with no target (keyboard) or with the tap's grid point; mouse click →
    `jump {targetX, targetY}` at the clicked grid point;
  - bear: Space / tap / mouse click → `attack` (no target; uses last move direction);
  - fisherman: tap or click → `cast {targetX, targetY}` only if `isInWater(target)` (Space alone
    does nothing for a fisherman).
- PIPELINE (`salmons.js:374-378`, `pointerControl.js`, `online.ts:776-807`): hover, 72 px dead zone
  (= 1.5 cells ✓), tap ≤ 12 px ✓, jump aimed ✓. Gaps:
  - keyboard keys vs mouse priority is reversed: pipeline lets held keys override the pointer;
    original lets the mouse override the keys once it has moved (m, leave);
  - bear on keyboard: original Space attacks; pipeline needs `J` (`BUTTON_KEYS`). FIX: in Salmons'
    config map the bear's (and fisherman's) Space to `ability1`, or add `KeyJ` alias (m);
  - fisherman cast: original aims at the tapped water point; pipeline sends `aimX/aimY` but no rule
    reads it (see §5.3). G.

---

## 4. Jump, curl, waterfall climb

### Already matches
- Leap: `vz = 11`, gravity 20, one leap from `z ≤ 0`, direction to the tap if > 0.5 cells else last
  move (default `{vx: 0.7, vy: −0.7}`), `×1.0` along / `×0.9` across, carry while `z > 0.05`
  (`salmonsRules.js:60-124,365-459`). Pose (tilt 0.4·factor, swell 0.12, curl 2 Hz arch 36, envelope
  `(1−t)^2.5`) — `salmonsArt/leap.ts`, `looks.ts:251-271`. Climb: 2.4 / 0.8 / radius² 4, only from
  downstream, `climbing` pose and 180 ms pulse. Rocks passed at `z ≥ 0.5`, whirlpool off at `z ≥ 0.5`.
- Jump while grounded on sand: original `index.js:164-170` leaps (`vz = 11`, direction) and clears
  grounding ✓.

### 4.1 Crossing the lip after topping out — G (pipeline easier)
- ORIGINAL: after `z ≥ height` the climb releases (`index.js:431-438`) and gravity runs the same
  tick. The waterfall block (`directionalBlock = player.x > obs.x && moveX <= 0`, `player.z < height`,
  radius 1.5 cells to each waterfall CELL) re-engages as soon as `z` drops below `height` (one
  tick later). A salmon that climbed from the block's edge (~1.4–1.5 cells downstream) can move
  only ~2 ticks per tap at the top, so the player keeps TAPPING at the top (each tap re-caps
  `z = height` via the jump handler's climb branch) while steering upstream, until `player.x ≤ obs.x`,
  where the one-way block stops applying. Comment in the original: "To clear the wall, the player
  must steer upstream while still aloft."
- PIPELINE `salmonsRules.js:246-248,281-286,296-323`: "a salmon let go at a fall's top passes that
  fall until it is back on the water" — one top-out is enough to cross.
- FIX (owner call; status doc lists it as an "engine adaptation"): replace `memo.over` with the
  original rule: pass the fall only while `z ≥ fall.top` (already in `level` via `heights`) — and
  rely on taps at the top re-capping `z`. If the burst-input problem the status doc names remains,
  keep `over` but expire it after `2` room steps instead of "back on the water".

### 4.2 Camera rises with the leap — m
- ORIGINAL `game.js:1447`: `const camSY = (lx + ly) * TH / 2 - (lz * HU);` (follows `z`).
- PIPELINE `online.ts:1124-1131` targets the place only. FIX: add the own player's drawn leap lift
  (`liftOf(cells)`) to the camera's `shakeY` like the ground lift.

---

## 5. Catchers: bear and fisherman

### 5.1 Bear swipe — G
ORIGINAL `server/index.js:215-245`:
```js
this.onMessage('attack', (client) => {
  const player = this.state.players.get(client.sessionId);
  if (!player || player.status !== 'alive' || player.playerClass !== 'bear') return;
  const dir = this.playerLastDir.get(client.sessionId) || { vx: 1, vy: -1 };
  const len = Math.sqrt(dir.vx * dir.vx + dir.vy * dir.vy) || 1;
  const targetX = player.x + dir.vx / len;          // 1 cell ahead
  const targetY = player.y + dir.vy / len;
  const ATTACK_RADIUS_SQ = 2.25;                    // 1.5 cells
  this.state.players.forEach((target, targetId) => {
    if (targetId === client.sessionId) return;
    if (target.status !== 'alive') return;           // any faction! (fishermen, other bears too)
    const dx = target.x - targetX, dy = target.y - targetY;
    if (dx * dx + dy * dy < ATTACK_RADIUS_SQ) {
      target.status = 'caught';
      this.addBloodstain(target);                    // salmon only (checked inside)
      player.score++;
      this.broadcast('player_caught', { catcherId, catcherName: player.name, caughtId: targetId, caughtName: target.name });
    }
  });
});
```
`playerLastDir` is the last move message with `|vx| > 0.01 || |vy| > 0.01` (`index.js:106-108`).
No cooldown (the client sends one per click/Space/tap). Catches airborne salmon too (no z test),
not hooked ones (`status !== 'alive'`), and grounded ones (grounded is a separate map; status stays
`alive`).
PIPELINE `salmons.js:381-391`: `{ reach: 110, targets: ['salmon'], effect: 'catch', ms: 3000, score: 1, cooldownMs: 1200 }`; reach measured from the bear's centre (`abilities.js:64-74`).
FIX: add an ability option `ahead: CELL` (offset the test centre by `ahead` along the user's last
non-zero move, default `{x: −1, y: 1}/√2` in pipeline axes for the original's `{vx 1, vy −1}`),
`reach: 1.5 * CELL` (72), `cooldownMs: 0` (or one step), `score: 1`. Whether bears catch
fishermen/bears too is an **owner call** (the original does it; probably unintended) — if yes,
`targets: ['salmon', 'bear', 'fisherman']` with the catch putting a catcher out too.

### 5.2 Bears may enter the water — G
- ORIGINAL `index.js:654-675`: bear moves anywhere `isCatcherInBounds` allows (water included);
  blocked only within 1.5 cells of a waterfall cell (`dx*dx + dy*dy < 2.25`), both directions,
  any height; not blocked by bridges.
- PIPELINE `salmons.js:65-66,258`: `rules.push({ zone: \`${id}Water\`, solid: true, characters: LAND })`
  with `LAND = ['bear', 'fisherman']`.
- FIX: `LAND` for the water rule → `['fisherman']` only; add waterfall zones solid (both ways) to
  `bear` (a zone `{x: band.left, y: line − 1.5·CELL, w: band.right − band.left, h: 3·CELL}` per
  waterfall), keep sea/source solid to bears (original `x ≥ 395` and `x ≤ 5` out of bounds), plus
  the bank limit of §1.2. The bear bot brain may then chase into the water (check `brainChase`).

### 5.3 Fisherman cast and line — G
ORIGINAL `server/index.js:185-213` (cast) and `578-642` (line, every tick, inside the fisherman
branch, AFTER the fisherman moved):
```js
this.onMessage('cast', (client, data) => {
  // ... alive, catcher, fisherman, !player.lineActive
  const CAST_COOLDOWN_MS = 250;
  if (now - last < CAST_COOLDOWN_MS) return;
  const tx = Number(data?.targetX), ty = Number(data?.targetY);
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
  if (!this.isInWater(tx, ty)) return;               // only into water; NO range limit
  if (dist(tx,ty, player) < 0.1) return;
  player.lineX = tx; player.lineY = ty; player.lineActive = 1;
  this.lineData.set(client.sessionId, { reelSpeed: 8 });   // cells/s
  this.lastCastAt.set(client.sessionId, now);
});
// per tick:
const ldx = player.x - player.lineX, ldy = player.y - player.lineY;
const ldist = Math.sqrt(ldx * ldx + ldy * ldy);
if (ldist < 0.3) {                                   // line home → land the fish
  if (ld.hookedSalmonId) {
    const salmon = this.state.players.get(ld.hookedSalmonId);
    if (salmon && salmon.status === 'hooked') {
      salmon.status = 'caught';
      this.addBloodstain(salmon, ld.hookX, ld.hookY);     // stain where it was HOOKED
      player.score++;
      this.broadcast('player_caught', { ... });
    }
  }
  player.lineActive = 0; this.lineData.delete(sessionId);
} else {
  const step = Math.min(ldist, ld.reelSpeed * dt);
  player.lineX += (ldx / ldist) * step;  player.lineY += (ldy / ldist) * step;
  if (!ld.hookedSalmonId) {
    const HOOK_RADIUS_SQ = 2.25;
    this.state.players.forEach((other, otherId) => {
      if (ld.hookedSalmonId) return;
      if (other.faction === 'salmon' && other.status === 'alive' && other.z <= 0.1) {
        const hx = other.x - player.lineX, hy = other.y - player.lineY;
        if (hx * hx + hy * hy < HOOK_RADIUS_SQ) {
          other.status = 'hooked'; ld.hookX = other.x; ld.hookY = other.y; ld.hookedSalmonId = otherId;
        }
      }
    });
  }
  if (ld.hookedSalmonId) {                            // dragged WITH the bobber
    const hooked = this.state.players.get(ld.hookedSalmonId);
    if (hooked && hooked.status === 'hooked') { hooked.x = player.lineX; hooked.y = player.lineY; }
  }
}
```
A hooked salmon cannot act at all (every handler returns on `status !== 'alive'`): **no escape**.
The salmon is moved onto the bank with the bobber.
PIPELINE `salmons.js:392-401` + `salmonsRules.js:534-605`: `reach 280`, nearest target, instant
hook, reel the FISH at 200 px/s towards the fisherman, land within 60 px, `score 2`, `cooldownMs 3500`,
`escapeTaps 5`, out `ms 4000`.
FIX (new rules part, server-only, replaces `fishingLine` for Salmons):
- the cast is an ability of the fisherman with `aim` (the input's `aimX/aimY`, already on the wire
  via the pointer tap): reject unless the aim is in the river's water; no reach limit;
- per fisherman store `line = {x, y, hooked?, hookX, hookY}` and sync it (new `Player` fields
  `lineX`, `lineY` float32 and `lineActive` uint8, as the original schema) so devices draw it;
- each step: move the line towards the fisherman by `8·CELL·dt`; while unhooked, hook the first
  salmon (player order) with `status free|grounded`, `z ≤ 0.1·CELL`, within `1.5·CELL` of the line;
  set its place to the line each step; at `< 0.3·CELL` land it (+1, `caught`, bloodstain at the
  hook point), clear the line;
- cooldown 250 ms after a cast; one line at a time; no escape taps (set `escapeTaps` off).
  The fisherman keeps walking while reeling (line follows him).

### 5.4 Fisherman on bridges — LACKS (G for fishermen)
ORIGINAL `server/index.js:540-577`:
```js
let bridgeZ = -1, snapBr = null;
for (const br of this.state.bridges) {
  if (Math.abs(nx - br.gx) > 0.5) continue;
  const onDeck      = ny >= br.gyStart && ny <= br.gyEnd;
  const onNearSlope = ny < br.gyStart && ny >= br.gyStart - slopeLen;   // slopeLen = 2
  const onFarSlope  = ny > br.gyEnd   && ny <= br.gyEnd + slopeLen;
  if (onDeck) bridgeZ = br.height;                                      // 6
  else if (onNearSlope) bridgeZ = br.height * (1 - (br.gyStart - ny) / slopeLen);
  else if (onFarSlope)  bridgeZ = br.height * (1 - (ny - br.gyEnd)   / slopeLen);
  if (bridgeZ >= 0) { snapBr = br; break; }
}
const onBridge = snapBr !== null, onLand = !this.isInWater(nx, ny);
if ((onBridge || onLand) && this.isCatcherInBounds(nx, ny)) {
  player.x = onBridge ? snapBr.gx : nx;   // snapped onto the one-tile plank
  player.y = ny;
  player.z = onBridge ? bridgeZ : 0;
}
```
Salmon and bears pass under bridges. FIX: a later workstream; needs bridge drawing (§9.6) and a
`z` for the fisherman. PIPELINE: done (`salmonsRules` `bridges`, 2026-11-18); drawn on the deck
since 2026-11-26 (§9.6).

### 5.5 Catcher spawn — m
ORIGINAL `index.js:329-363`: 30 tries of `gx = 30 + rand·(400 − 60)`, `y = meander + side·(halfW + 3 + rand·5)`,
rejecting within 15 cells of another catcher; fallback `(200, meander + halfW + 5)`.
PIPELINE `salmonsMap.js:361-369`: 16 fixed places at `col.lo − 6` / `col.hi + 6`.
FIX: server-side random spawn (room RNG from the seed) with the same rule, or more fixed places
spread with the original's distribution.

---

## 6. Salmon-specific rules

### 6.1 Sandbank re-grounding — G
- ORIGINAL (`index.js:523-532`, `89-94`, `164-170`): every tick with `z ≤ 0.05` on sand → grounded,
  velocity zeroed, `move` messages rejected; only a `jump` frees it (leap). Landing on sand grounds
  it again. `onSandbank` = within 0.8 cells of any sand cell (`obstacleIndex.js:328-343`).
- PIPELINE `salmonsRules.js:340-353`: `if (... p.memo.onSand || ...) continue; p.memo.onSand = 1;`
  — after one release it is not grounded again until its centre leaves the sand.
- FIX: drop the `onSand` latch: ground a free salmon whenever `z ≤ 0.05·CELL` and its centre is
  within 0.8 cells of a sand cell, except during the input that released it (the leap is already
  airborne the next step, so the natural order handles it). Keep the sandbank test as "within
  0.8·CELL of a sand cell centre" (cells are known on the `salmonsMap` grid) rather than the rect.

### 6.2 Salmon spawn spread — m/G (pile-up at one point)
ORIGINAL `index.js:290-296` and respawn `251-256`:
```js
const gx = GAME_CONSTANTS.RIVER_LENGTH - 10;   // 390
player.x = gx;
player.y = meander + (Math.random() - 0.5) * halfW * 0.8;   // halfW(390) = 48 → ±19 cells
```
PIPELINE: `salmonsMap.js:386` one point; `roomSim.ts:132-135` `home ?? online.spawn`.
FIX: give salmon a spawn LINE (or N spawns across `±0.4·halfW(390)` at `y = yOf(390)`), picked by
the room RNG per (re)spawn.

### 6.3 Golden salmon — G/V
- ORIGINAL: purely cosmetic and earned. `main.js:311-326`: on `game_won` the winner's
  `joinOptions.isGolden = true` (everyone else false); the next join sends it and the server copies
  `player.isGolden = options.isGolden ? 1 : 0` (`index.js:288`). Drawn with `salmon_golden`. No
  scoring effect. Win screen uses the golden HD fish for the winner.
- PIPELINE `salmonsRules.js:157-158,607-631`: random salmon per round from the seed, ×3 catches and
  goal; banner `salmons.ts:234-249` "GOLDEN SALMON — WORTH 3×".
- FIX (owner call, pipeline choice is listed as "owner may overturn"): to match, mark the previous
  round's winner (the room knows `winner`) golden for the next round, `GOLDEN_WORTH = 1`, remove
  the banner. Never trust the client.

---

## 7. Scoring, win / lose, round flow, lobby, room lifecycle — G

ORIGINAL:
- `onJoin` (`index.js:302-307`): the first join flips `state.status` `'waiting' → 'running'`; no lobby.
- Win (`index.js:512-521`):
  ```js
  if (player.x <= 0) {
    player.status = 'finished';
    if (!this.gameWon) {
      this.gameWon = true;
      this.state.status = 'ended';
      this.broadcast('game_won', { winnerId: sessionId, winnerName: player.name || 'Unknown Salmon' });
      this.lock();
    }
  }
  ```
  `update` returns while `status !== 'running'`, so the room freezes. No timer, no score goal, no
  next round. Clients (`main.js:311-327`) start the WinAnimation; its button calls `doRejoin()`,
  which leaves and `joinOrCreate`s a NEW room (new seed, new river), with the winner now golden.
- Score: catches only (+1). Salmon has no score. Not shown in any HUD (`GameHUD.svelte` is empty).
- Caught (`main.js:340-347`, `App.svelte:52-60`): the caught player gets `setDeath(catcherName)`:
  ```html
  <div id="death-screen"><div id="death-title">You have been caught</div>
  <div id="death-catcher">by <span id="death-catcher-name">{catcherName}</span></div>
  <button id="btn-respawn" class="action-btn" onclick={onRespawn}>Respawn</button></div>
  ```
  Respawn is manual (`room.send('respawn')`, `index.js:247-270`): salmon to gx 390 with the spread,
  catchers to a new catcher spawn; status `alive`, `z = vx = vy = vz = 0`, `climbing = 0`.
  CSS: `#death-screen { background: rgba(0,0,0,0.45) }`, `#death-title { top:44%; font-size:40px;
  color:#ff3333; text-shadow:4px 4px 0 #000, 0 0 40px #ff0000; animation: death-pulse 2s infinite }`,
  `#death-catcher { top:56%; font-size:22px; color:#ffaaaa }`, font "Press Start 2P".
- Reconnect: `allowReconnection(client, 60)`; client stores `salmon_room_id`/`salmon_session_id` in
  localStorage and reconnects on `visibilitychange`/`focus` and on a non-1000 leave.

PIPELINE:
- `salmons.js:403` `round: { seconds: 300, goalScore: 10 }`, `nextRoundSeconds` default 15
  (`family.ts:405`), lobby 4 players / 60 s / 10 s (`salmons.js:304-308`, owner request 2026-11-17).
- `onlineRules.js:205-228,316-343`: goal = +10 (×3 golden) and round end; clock end → highest score
  wins; next round respawns everyone on the same river; scores reset.
- `catch` → `STATUS.out` for `ms` then `endStatuses` → auto-respawn (`abilities.js:111-118`).
- HUD SCORE / ROUND / TIME (`salmons.ts:127-147`), "ROUND OVER / NEXT ROUND IN" (`salmons.ts:150-185`).
- `rejoinSeconds: 60` ✓.

FIX (the biggest owner-facing difference; owner should confirm which to keep, the lobby is theirs):
1. `round.seconds: 0` (no clock), `goalScore` irrelevant to the win: the round ends only at the
   source; the winner is the salmon that reached it.
2. After a win: show the win screen to everyone (§10.2), and start the next round on a NEW seed
   (the room re-generates the level: `generatedOnlineGame` with a fresh seed and push `seed` in
   state) — or close the room and let devices join a new one (closer to the original, but the
   lobby would then run again). The original's "Join New Game" button is the player's choice: the
   round over screen should wait for the tap rather than auto-start, if matching exactly.
3. Caught → hold the player out until it presses Respawn (a `respawn` button input), with a death
   screen. Implement as `ms: 0` meaning "until respawn pressed" + a flow screen bound to a new
   `caught` event for `me` with `by` name.
4. Remove the HUD (or keep SCORE only for catchers — the original shows none).

---

## 8. Lobby, matchmaking, menu — V

ORIGINAL `client/src/components/StartMenu.svelte` (whole file is UI; key behaviour):
- Title `Salmons!!!`, subtitle `A massively multiplayer river survival game`, version tag.
- Name input (default `localStorage['salmon:playerName'] || 'Guest'`, maxlength 40; server keeps
  20 chars, default `'Unknown Salmon'`).
- Faction buttons `🐟 Salmon` / `🎣 Catcher`; Catcher shows class `Fisherman` (default) / `Bear`.
- `🌊 Join River` → `joinOrCreate('salmon_room', { name, faction, playerClass })`.
- Live room list polled every 3 s (`client.getAvailableRooms`), sorted by clients desc, each row
  `"{clients} players in {name} River"` with a name hashed from the room id:
  ```js
  const RIVER_NAMES = ['DownTown','Sucker Punch','Your Mom','Salty Tears','Lazy Trout','Wet Sock',
   'Soggy Bottom','Murky Depths','Old Sneaker','Crusty Bait','Slippery Eel','Last Cast',
   'Drunken Bear','Foggy Bottom','Boiling Pot','Mossy Rock','Rusty Hook','Fishstick','Burnt Toast',
   'Sleepy Salmon','Tipsy Trout',"Grandpa's Beard",'Backyard Pond','Forgotten Sock','Whiskey Falls',
   'Mystery Sauce','Leaky Bucket',"Goblin's Gulch",'Cold Coffee','Wonky Tonk'];
  function riverNameFor(roomId) { let h = 0;
    for (let i = 0; i < roomId.length; i++) h = ((h * 31) + roomId.charCodeAt(i)) >>> 0;
    return RIVER_NAMES[h % RIVER_NAMES.length]; }
  ```
  When the total count rises: a splash sound (white noise 0.2 s, lowpass 1000 → 300 Hz exponential,
  gain 0.1 → 0.001) and a 0.4 s pop animation on the counts.
- Ko-fi link "☕ Support the dev — Buy me a coffee" (https://ko-fi.com/modulon).
- Loading screen (`LoadingScreen.svelte`): "Loading..." with a swimming 🐟 and a random phrase
  changing every 1.6 s (fade 0.25 s) from 28 phrases ('Placing rocks...', 'Warming up the
  water...', 'Brushing the sand...', 'Polishing salmon scales...', 'Teaching bears to fish...',
  'Stocking the river...', 'Tying fishing lines...', 'Spawning whirlpools...', 'Painting
  riverbeds...', 'Greasing the waterfall...', 'Counting the salmons...', 'Sharpening hooks...',
  'Combing the seaweed...', 'Convincing fish to swim upstream...', 'Skipping stones...',
  'Untangling nets...', 'Negotiating with otters...', 'Hatching tiny eggs...', 'Filling buckets of
  bait...', 'Dusting off the bridge...', 'Briefing the fishermen...', 'Letting the river run...',
  'Translating fish gossip...', 'Carving fresh pebbles...', 'Setting the current...', 'Polishing
  golden scales...', 'Tuning the splash sounds...', 'Telling the bears to behave...'), background
  `rgba(26,28,44,0.96)`, phrase colour `#9ad8ff`.
- Matchmaking: `joinOrCreate` into any unlocked room with space; rooms lock on a win.

PIPELINE: character from `?rooms_character=` and name from `?rooms_name=` URL params
(`online.ts:380-384`), else "the first character with a place" (`roomSim.ts:161-183`), i.e. a
normal player cannot choose to be a bear or fisherman; the arcade starter's loading + tap-to-start;
lobby screen "WAITING FOR PLAYERS" (owner's). LACKS the menu, the room list, the river names, the
loading phrases and the splash sound.
FIX: an authored Salmons start screen (Flow + layout) before the join: name field, faction/class
buttons, room list (needs a listing endpoint — the game server already writes a listing with
`players`, `arcadeRoom.ts:217-224`), passing `name`/`character` to `joinOnlineRoom`.

---

## 9. Rendering

### 9.1 The world is mirrored — V
- ORIGINAL: screen `x = (gx − gy)·32`, `y = (gx + gy)·16` — source (gx 0) top-LEFT, sea bottom-RIGHT;
  waterfalls (fixed gx, varying gy) run NE–SW (`SKEW_Y = −atan(1/2)`, `game.js:568`).
- PIPELINE: world `x = gy·48`, `y = gx·48` (`salmonsMap.js:309-310`), projected
  `isoProject(x, y) = { x: x − y, y: (x + y)/2 }` (`engine-layout projection.ts:29`; `river.ts:73`
  has its own copy) → screen `x = (gy − gx)·48`: the exact horizontal mirror. Source top-RIGHT, sea
  bottom-LEFT, waterfalls NW–SE; the lip/splash were flipped with `scale(−K, K)` (`river.ts:516,522`)
  to compensate.
- FIX options: (a) cleanest: a scene option `projection: 'isometric'` with `mirror: true` (or a new
  `'isometric-x'`) giving `project(x, y) = { x: y − x, y: (x + y)/2 }`, `unproject` accordingly,
  used by `IsoWorld.svelte`, `projection.ts`, `river.ts` (`project`, and the ground `turn`
  `flat.rotation = −π/4` instead of `π/4`, the cliff shear `Matrix(1, −0.5, …)`), the keyboard map
  (§3.4) and `fieldPoint`; then drop the `−K` flips on lips/splashes. (b) cheap: `scale.x = −1` on
  the IsoWorld root container for Salmons — mirrors the art bitmaps (trees, rocks light from the
  other side) but keeps everything consistent including pointer mapping through `toLocal`. Only
  Salmons sets it, so other isometric games are untouched.

### 9.2 Layers, banks, forest — V
ORIGINAL draw order (`game.js:104-115`): `bgLayer` (0x28591e rect) → `underwaterContainer`
[`riverbedLayer`, `bloodTrailLayer`, `underwaterEntityLayer` (swimming salmon + glint),
`bloodstainLayer`] with the DisplacementFilter (scale 6,4; noise sprite moves +0.35, +0.18 px per
frame) → `waterTintLayer` (0x0ea5e9 diamonds, alpha 0.75) → `mapLayer` (grass/sand/sea tiles,
bridge reflections) → `entityLayer` (rocks, whirlpools, trees, cliffs, waterfalls, bridges,
above-water players, lines; z-sorted).
Z offsets in the entity layer (screen-y baseline `sy = (gx+gy)·16`): whirlpool `sy − 50`, rock
`sy + 300`, sandbank obstacle `sy + 100`, scattered tree `sy + 500`, forest tree `sy + 1001`
(occludes characters), player `serverSY + 1000` (on a bridge `sortSY + 10000`), pillar `sy + 400`,
deck `sy + 1100`, slopes `sy + 500`, cliff `endSY − 1`, face `endSY`, lip `sy + 50`, splash
`sy + 100 + p`, floating text 2 000 000.
- Grass only within `halfWidth + 5` cells (`bankMargin`), grass tiles autotiled against water, a
  riverbed+tint under any grass tile that touches water.
- Trees: on grass tiles with `rng() < 0.07` (rng = `seedrandom(seed)` in tile order); forest:
  EVERY cell from `halfWidth + 6` to `halfWidth + 17` on both sides of every column (FOREST_DEPTH 12),
  plus end caps of 12 columns before gx −5 and after the sea (`game.js:487-550`). Biomes change every
  `BIOME_LENGTH = 35` columns; pairs `[[0,1],[2,3],[4,5],[0,3],[1,4],[2,5]]`; tree width 96 px,
  anchor (0.5, 1).
- Sandy beaches near the delta (`game.js:273-274,337-343`):
  ```js
  const sandPeakU = riverLength - 4;  const sandFadeLen = 80;
  const isBankAt = (gx, halfWidth, localGy) => {
    if (gx >= riverLength) return false;
    if (Math.abs(localGy) <= halfWidth) return false;
    const sandT = Math.max(0, Math.min(1, (gx - (sandPeakU - sandFadeLen)) / sandFadeLen));
    const sandDepth = Math.round(Math.sqrt(sandT) * 5);
    return sandDepth >= 2 && Math.abs(localGy) <= halfWidth + sandDepth;
  };
  ```
  Beach cells draw riverbed + tint under a sand autotile (`sand_*`) whose mask treats parallel
  neighbours that are beach one row out as sand (`sandParallel`).
PIPELINE `river.ts:57-60,366-405`: grass on every non-wet cell of the world rectangle; 7 % trees;
`BIOME_ROWS = 24`; `FOREST_DEPTH = 4` cells beyond the world edge only. LACKS beaches and the
meander-following forest wall.
FIX (`river.ts`): per row, grass only within `halfWidth + 5` cells of the meander (use
`river.grid` + the column bounds; pass `lo/hi` per row in `SalmonsRiverDrawing`), trees on every
cell from `+6` to `+17`, forest floor (0x28591e) beyond; beaches per the code above (rows with
`gx ≥ 316`); `BIOME_ROWS = 35`; tree draw order: forest trees in front of characters at the same
depth.

### 9.3 Rocks, whirlpools, waterfalls — V/m
- Rock (`assets.js:441-460`): `rock_<random 0..8>` (unseeded `Math.random`), anchor 0.5,
  `scale = 119.5 / tex.width`, random x-flip. At K: **179 px** wide. PIPELINE `river.ts:539-547`:
  `((w + h)·0.9)/tex.width` = 129.6 px (≈ 72 %). FIX: `scale = 119.5 * K / texture.width`. (V)
- Whirlpool: 230.4 px wide × K, y scale 0.5, 4-frame clip at 9 fps ✓ (`river.ts:528-537`).
- Waterfall (`game.js:579-691`): cliff height `32 + H·16`; the CLIFF (`cliff.png`, `tileScale = cliffH/tex.h`)
  spans the face plus 17 tiles each side; the FACE spans `(N + 1)·16√5` (one tile past each end)
  with two layers: primary alpha 0.9 scrolling `0.8·dt`, overlay `tileScale.x = −1`, alpha 0.45,
  `tilePosition.x = tex.width/2`, scrolling `0.45·dt` — texture NOT rescaled; lip per tile scaled
  to exactly 64 × 24, anchor (0.5, 1), at `sy − CLIFF − wallElev − 16` (VISUAL_LIFT 16), frame phase
  `((x − y) % 4 + 4) % 4`; SPLASH: 3 per tile (+2 on a virtual NE end cap), scaled to exactly
  64 × 32, anchor 0.5, offsets hashed:
  ```js
  const h = ((obs.x * 73856093) ^ (obs.y * 19349663) ^ (p * 83492791)) >>> 0;
  const rx = ((h & 0xff) / 255 - 0.5) * 36;        // ±18 px
  const ry = (((h >> 8) & 0xff) / 255 - 0.5) * 16;  // ±8 px
  splash._animTimer = (phase + p * 1.3) % 4;
  ```
  PIPELINE `river.ts:485-526`: 1 splash per cell at `scale(−K, K)` of the native texture, lip
  `scale(−K, K)` anchor 0.5, face `tileScale(±0.5, cliff/face.height)`. FIX: 3 splashes per cell
  with the hash offsets × K, scale lip/splash to `64K × 24K` / `64K × 32K`, face tileScale 1·K. (m)

### 9.4 Characters — V/m
- Sizes (original at 64 × 32 tiles; × K for the pipeline): salmon 50 px long → 75; bear 80 px wide →
  120; fisherman circle r 12 → r 18. PIPELINE draws at body width: salmon 90, bear 92, fisherman 56
  (`salmons.js:335-337`, `looks.ts`). Owner chose engine sizes (2026-11-09) — flag only.
- Salmon default facing: original `sprite.scale.set(−1, 1)` "face upstream by default"
  (`game.js:1206`); pipeline `facing = 1` (`looks.ts:184`). FIX: start at −1 (after the mirror fix,
  upstream is screen-left). (m)
- Salmon facing/tilt uses the SERVER velocity vector (input), not drawn motion; same squash (400 ms
  ±0.02 moving / 1500 ms ±0.008 idle) ✓; glint ✓; climbing pose ✓.
- Bear: rotation `lastFacingAngle + π` from the input velocity (`game.js:1125-1135`); claw ellipse
  `(−18, 0, 22, 4)` 0x664422 at radius 50 sweeping `side·(−π/8 + t·π/4)` over 300 ms, side flips each
  swipe ✓ (`looks.ts:301-341`).
- Fisherman: tan circle 0xe8c170 ✓; rod hand `(+8, −10)` ✓.
- Caught: hidden ✓ (`onlineFlow.js:173`).

### 9.5 Fishing line — V
ORIGINAL `game.js:1477-1556`: for every fisherman with `lineActive` (from the cast until the line is
home, hooked or not): from `sprite + (8, −10)` to the bobber `((lineX − lineY)·32, (lineX + lineY)·16 − elev(lineX) − bobberZ·16)`
with `bobberZ = player.z·clamp(1 − dist/3, 0, 1)`; for the first 450 ms a sine wiggle
(`amp = (1 − k)·14`, 24 segments, 3 waves, phase `now·0.018`, envelope `sin(u·π)`), then straight;
`stroke({ width: 2, color: 0xddddaa, alpha: 0.9 })`; bobber `circle(r 4)` fill 0xffee88; z just
above the highest casting fisherman.
PIPELINE: drawn only while a salmon is hooked, hand → salmon middle (`online.ts` `drawMarks`,
`onlineFlow.js createHookLines`), wiggle 450 ms ✓, colour ✓, bobber dot ✓ at the salmon.
FIX: draw from the synced `lineX/lineY/lineActive` of §5.3. Remove the flow's 560 px `salmonsCast`
circle and 220 px `salmonsSwipe` circle and the 150 × 70 `salmonsSplash` on climb/hook
(`engine-flow-v2 reference/salmonsSeed.ts:158-211`) — the original has none of them (the claw
streak is the bear's only swipe visual).

### 9.6 Bridges — LACKS (V)
ORIGINAL `game.js:693-842` + `assets.js:237-439`: per bridge (`gx`, `gyStart..gyEnd`, height 6):
reflection diamonds per deck tile on the water (`mapLayer`, alpha 0.5, shimmer
`x = base + sin(t)·1.5 + sin(1.7t)·0.6`, `scale.x·(1 + sin·0.04)`, `t = timer·0.04 + phase`);
pillars at both ends and every 3rd tile (`TILE_W·0.45` wide, anchor (0.5,1), z `sy + 400`) with a
pillar reflection; deck per tile (`bridge_deck_near|middle|far`, scale `64/tex.w`, anchor
`(0.5, 1 − 16/tex.h)`, `y = sy − wallElev − 6·16`, z `sy + 1100`); two slope sprites (near anchor
(1,1) `W = 3·32 + 32`, `H = 96 − 3·16 + 16`, at `gyStart − 3` with `+16 + 8` y; far anchor (0,1)
`W = 2·32 + 32`, `H = 96 + 2·16 + 16` at `gyEnd + 2`). Art is placeholder
(`scripts/generate_bridge_placeholders.mjs`). Pipeline: art pass said bridges are moot because the
engine river had none — it now has them in data.
PIPELINE (2026-11-26): drawn from the level's `bridges` (`salmonsArt/river.ts`); a fisherman on one
is drawn raised by his `z` and sorted over the deck (`salmonsArt/bridge.ts`). DEVIATION: both slopes
are drawn `BRIDGE.slope` = 2 cells, the server's `slopeLen`, not the art's near 3 (`gyStart − 3`),
so the drawn slope is where he climbs.

### 9.7 Bloodstains (newest commit #8) — LACKS (V)
Server (`index.js:24-25,381-390`, schema `Bloodstain {x float32, y float32}`, `GameState.bloodstains`):
```js
const MAX_BLOODSTAINS = 300;
addBloodstain(salmon, x = salmon.x, y = salmon.y) {
  if (salmon.faction !== 'salmon') return;
  const stain = new Bloodstain(); stain.x = x; stain.y = y;
  this.state.bloodstains.push(stain);
  if (this.state.bloodstains.length > MAX_BLOODSTAINS) this.state.bloodstains.shift();
}
```
called on a bear kill (at the salmon) and a landed hook (at `hookX, hookY`, where it was hooked).
Client (`game.js:16-18,1251-1328`):
```js
const BLOOD_RADIUS_SQ = 0.8 * 0.8;  const BLOOD_RED_MS = 3000;
_bloodTexture() {                               // generated once
  g.ellipse(0, 0, 30, 15).fill(0x8a0f12);  g.ellipse(-12, 3, 14, 7).fill(0x8a0f12);
  g.ellipse(14, -4, 12, 6).fill(0x8a0f12); g.ellipse(2, 0, 16, 8).fill(0x5e0a0d);
}
addBloodstain(stain) {
  sprite.anchor.set(0.5); sprite.alpha = 0.35;
  sprite.rotation = (Math.random() - 0.5) * 0.4;  sprite.scale.set(0.8 + Math.random() * 0.5);
  pos = { x: (x - y) * 32, y: (x + y) * 16 - riverElev(floor(x)) };   // in bloodstainLayer
}
_updateBloodContact(sprite, player, swimming) {   // swimming = on open water, alive
  if (swimming) for (stain) if (dx*dx + dy*dy < BLOOD_RADIUS_SQ) { sprite._redUntil = now + 3000; break; }
  if (sprite._redUntil > now) {
    sprite.tint = 0xff3a3a;
    if (swimming && !(now - (sprite._lastTrail || 0) < 70)) {      // a puff every 70 ms
      puff: same texture, anchor 0.5, scale 0.35, alpha 0.5, at the salmon, in bloodTrailLayer
    }
  } else if (sprite._redUntil) { sprite._redUntil = 0; sprite.tint = 0xffffff; }
}
_updateBloodTrail() { /* each puff: alpha = 0.5 * (1 - t), t = age / 3000, destroyed at t >= 1 */ }
```
Layers: `bloodTrailLayer` under the swimming fish, `bloodstainLayer` OVER them, both inside the
displacement-filtered underwater container (they wobble), all under the water tint.
FIX: server: a `bloodstains` ArraySchema (float32 x, y; cap 300, drop oldest) on the room state,
pushed by the catch and landing rules (salmon only); device: a stain layer in `river.ts`'s `bed`
container above the riverbed (so the displacement applies and the tint covers it), sizes × K, the
contact test against the own and every drawn salmon (`0.8·CELL`), the 0xff3a3a tint (combine with
the under-water colour matrix) and the trail puffs. Must survive `nearby` filtering (send all
stains to every device; they are few).

### 9.8 Water/under-water — m
Pipeline draws the swimming salmon under a colour-matrix tint, not under the displacement
(`leap.ts:446-457`; known limit in the status doc). Original reparents the sprite into the filtered
container. Leave unless the owner asks.

---

## 10. HUD / UI text

### 10.1 Floating catch text — LACKS (V)
ORIGINAL `game.js:1643-1664` (on `player_caught` where `catcherId` is me):
```js
const style = new PIXI.TextStyle({ fontFamily: "'Press Start 2P', monospace", fontSize: 11,
  fill: 0xffdd57, stroke: 0x000000, strokeThickness: 3, align: 'center' });
const text = new PIXI.Text(`you catch ${caughtName}!`, style);
text.anchor.set(0.5, 1); text.x = sprite.x; text.y = sprite.y - 30;
// 1800 ms: y = startY - t * 50; alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3
```
FIX: a Flow reaction on `caught` with `by === me` spawning a text component over the own player
(sizes × K), needing the caught player's name in the event payload.

### 10.2 Win animation — LACKS (V)
ORIGINAL `client/rendering/WinAnimation.js` (on `game_won`, 50 ms later, on top of the stage):
- full-screen black overlay alpha 0.60;
- big fish: winner → golden HD texture, others → pink HD; width `50·fishScale` where
  `fishScale = portrait ? max(4, W·0.77/50) : 14`, `scale.x` negative (head right), centred at
  `(W/2, H/2 + (portrait ? 20 : 40))`;
- title `You Won!` (#ffdd57) or `${winnerName} won!!!` (#ff7777), Press Start 2P,
  size `portrait ? max(20, floor(W/14)) : 48`, drop shadow 4 px, anchor (0.5, 1) at
  `H/2 + (portrait ? −min(120, H·0.15) : −200)`, word-wrap `W·0.85`;
- loser subtitle `Praise the Salmon!!!` (#ffaaaa, `portrait ? max(12, floor(W/28)) : 20`) at
  `title.y + 14`;
- button bottom-left `(40, H − 80)` (centred in portrait), `Join New Game` (winner) /
  `Start New Session` (others), bg 0x5d275d round 8, stroke 4 0xb13e53, padding 20, hover ×1.05;
  click → exit (fish swims right at 1200 px/s for 800 ms) → rejoin;
- WINNER ONLY (`winAnimRunning = isWinner`): the fish bobs (`y += sin(t·8)·0.5`) and lays eggs: every
  200 ms 1–3 eggs (max 1000), radius 7–12, at the fish + `(−16·fishScale, 4·fishScale)` ± 6,
  `vx = (−150 − rand·80)·speedScale`, `vy = 30 + rand·60`, gravity 800, floor bounce 0.22,
  friction 0.82, rest when `|vy| < 8`, egg–egg collision on a 25 px grid with 0.4 restitution;
  egg textures: circles r 15 — shadow, base at 0.85r, highlight (0.65r, 0.55r, 0.35r), dot
  (0.55r, 0.45r, 0.12r) white; colours `(0xffb3c6, 0xff6090, 0xfff0f5)` and
  `(0xffd6e0, 0xff80a0, 0xfff5f8)`; `speedScale = portrait ? min(1, W/900) : 1`.
PIPELINE: "ROUND OVER / NEXT ROUND IN n" text only.
FIX: an engine-layout code effect (like `salmonsArt/looks.ts`) mounted by a Flow screen on
`roundEnd` with `winner`/`me`; the button sends the "next" action of §7.

### 10.3 HUD — V
Original has no in-game HUD (`GameHUD.svelte` body is an empty div). Pipeline shows SCORE / ROUND /
TIME top-left (`salmons.ts:127-147`). FIX: remove from the Salmons layout (or owner keeps it).

### 10.4 Reconnecting indicator — m
Original shows "Reconnecting..." with a spinner while `client.reconnect` runs. Check what the
pipeline shows on a drop (not verified here).

---

## 11. Sound
ORIGINAL: only the start-menu splash (§8). No in-game sound at all. PIPELINE: none. Matches except
the menu sound (comes with the menu).

---

## 12. Camera
ORIGINAL `game.js:1441-1469`:
```js
const camSX = (lx - ly) * TW / 2;
const camSY = (lx + ly) * TH / 2 - (lz * HU);          // follows z, NOT riverElev
const targetX = hw - camSX * scale, targetY = hh - camSY * scale;
if (!this.cameraInitialized) { snap } else if (localPlayer.status !== 'finished') {
  this.worldContainer.x += (targetX - this.worldContainer.x) * 0.15;   // per frame, no dt
  this.worldContainer.y += (targetY - this.worldContainer.y) * 0.15;
}
```
Mobile (`/Android|iPhone|iPad|iPod|Mobile/` or `maxTouchPoints > 1 && innerWidth < 1024`):
`worldContainer.scale.set(0.5)`. Renderer `resizeTo: window`, resolution `min(dpr, 1.5)`,
background 0x1a1c2c. No world clamp, no dead zone. Stops following once the own salmon `finished`.
Quirk: the camera ignores the waterfall elevation, so upstream of several falls the own salmon is
drawn above centre by the summed lift (~500+ px near the source) — likely an original bug; the
pipeline's camera includes the lift (`online.ts:1131`). Recommend NOT copying (owner call).
PIPELINE `salmons.ts:27` `{ deadZone: { w: 320, h: 200 }, smoothing: 0.1 }`, `clampToWorld` default
true (`camera.js:38`), tiles drawn ×1.5 with no zoom-out on mobile.
FIX: `deadZone: {w: 0, h: 0}`, `smoothing` ≈ 0.11 s (0.15 per frame at 60 fps ≈ τ = −1/(60·ln 0.85)
= 0.103 s → 0.1 is fine), `clampToWorld: false`; add a view zoom so a cell is 64 × 32 screen px at
desktop (a world scale of 1/K = 0.667) and half that on mobile — needs a camera `zoom` field in the
arcade camera (engine change). Verify how `mainLayout()` maps design px to the window first.

---

## 13. Network / sync
- Original: client sends `move {vx, vy}` (unit vector) at 20 Hz, `jump {targetX?, targetY?}`,
  `cast {targetX, targetY}`, `attack`, `respawn`; the server trusts `faction`, `playerClass`,
  `isGolden` and `name` from join options. State: all players to all clients (no interest), float32
  for moving fields, patch 60 Hz. Client: dead reckoning `pred += vel·speed·dt` and corrects
  `1 − 0.88^delta` towards the server, then renders `1 − 0.5^delta` towards the prediction.
- Pipeline: inputs only, prediction + reconciliation + interpolation, 30 Hz tick, 20 Hz patch,
  `nearby` 2400 × 1800 interest boxes. Better; keep. Only additions needed are new synced fields
  (`lineX/lineY/lineActive`, `bloodstains`, a respawn input, a golden-from-winner mark).

---

## 14. What already matches (brief)
- The level generator and PRNG (rivers, waterfalls and heights, rocks, whirlpools, sand islands,
  bridges' placement) — per seed.
- Waterfall elevation `elevStepFor(H) = 16 + 16H` old px summed upstream; cliff `32 + 16H`.
- Leap physics, leap direction, carry, curl/tilt/swell pose; climb (2.4 / 0.8 / r² 4), climbing pose
  and tap pulse; rocks and whirlpools cleared at `z ≥ 0.5`; hook skips airborne salmon (> 0.1).
- Current 1.5 cells/s; sea wall; goal at the source; max 100 players; 60 s reconnection grace.
- Pointer hover-to-move, 1.5-cell dead zone, 12 px tap, tap-to-jump towards the point.
- Riverbed (9 procedural variants, same hash), water tint 0x0ea5e9 α 0.75, displacement map and
  its drift (6/4, +0.35/+0.18), sea tile, grass/sand compass autotiles, whirlpool clip, waterfall
  face scroll speeds (0.8 / 0.45), tree chance 7 % and biome pairs, salmon rope (12 pts) and glint
  (7 pts, flash 120–380 ms every 350–2150 ms), squash, bear claw streak, fisherman circle, line
  colour/width/bobber/wiggle, golden texture.
- Caught players hidden.

---

## 15. Proposed fix workstreams (independent file areas)

1. **WS-A — Movement & terrain rules** (`packages/engine-mechanics/src/salmons.js`
   `salmonsGeometry`/`SPEED`, `salmonsMap.js` `salmonsMapRiver`, `abilities.js` (opt-in scaled
   pull), `salmonsRules.js` `sandbanks`/`waterfallClimbing.level`; gates `check:salmons-*`,
   `check:room-bots`, traces). Items: speeds (§2), bank block (§3.2), whirlpool formula (§3.3),
   sandbank re-grounding (§6.1), salmon spawn spread (§6.2), bear in water + waterfall block +
   bank limit for catchers (§1.2, §5.2), lip-crossing rule (§4.1, owner call), catcher random
   spawns (§5.5).
2. **WS-B — Catchers, scoring, round flow** (`salmonsRules.js` `fishingLine`/`goldenSalmon`, the
   abilities' `ahead` option in `abilities.js` — coordinate with WS-A on that file, or WS-B owns
   `abilities.js` and WS-A only adds `pull.scaled` first — `onlineRules.js` round/respawn,
   `services/game-server/src/schema.ts` + `arcadeRoom.ts` (new fields: line, bloodstains,
   respawn), `salmons.js` `salmonsConfig` abilities/round). Items: bear swipe (§5.1), aimed cast and
   travelling line (§5.3), +1 scoring, manual respawn (§7), win ends the round + new seed (§7),
   golden = last winner (§6.3), bloodstain state (§9.7 server half).
3. **WS-C — World drawing & camera** (`packages/engine-layout/src/lib/salmonsArt/river.ts`,
   `projection.ts`/`IsoWorld.svelte` mirror option, `referenceLayouts/salmons.ts` camera,
   `salmonsRiver.ts` drawing type, `camera.js` zoom). Items: mirror (§9.1), grass band + forest
   walls + beaches + biome length (§9.2), rock size, splashes/lips/face scale (§9.3), bloodstain
   layer + red contact + trail (§9.7 device half, after WS-B's schema), camera dead zone/clamp/zoom
   /leap height (§12, §4.2), bridges' drawing later (§9.6).
4. **WS-D — Characters, effects and screens** (`salmonsArt/looks.ts`, `apps/lines/src/game/online.ts`
   drawing parts (`drawMarks`, line from `lineX/Y`), `engine-flow-v2/src/reference/salmonsSeed.ts`,
   `referenceLayouts/salmons.ts` screens, a new `salmonsArt/winAnimation.ts`). Items: line drawing
   from the synced line (§9.5), remove the swipe/cast/splash placeholders, salmon default facing,
   floating catch text (§10.1), death screen + Respawn (§7), WinAnimation (§10.2), HUD removal
   (§10.3), start menu + room list + loading phrases + splash sound (§8).
5. **WS-E — Input** (`apps/lines/src/game/online.ts` `MOVE_KEYS`/`keyInput`/`BUTTON_KEYS` only, and
   Salmons' `pointer.taps` in `salmons.js`): screen-relative, normalised keys for isometric scenes
   (§3.4), Space as the bear's swipe, cast aimed at the tap (shares the aim with WS-B). Small; can
   fold into WS-D if the same session owns `online.ts` (WS-D must then keep its `online.ts` edits
   to the drawing functions).

Ordering: WS-A, WS-C and WS-E can start at once. WS-B first lands the schema fields; WS-C's
bloodstain drawing and WS-D's line/death/win screens follow it. The mirror fix (WS-C) changes the
keyboard map's screen→world turn (WS-E): agree the projection API first.

Owner decisions to confirm before WS-B: bears catching fishermen/bears; golden = last winner and
no ×3; rounds vs one game per room (and how that sits with the owner's lobby); auto vs manual
respawn; HUD removal; bots fill; character caps 30/20.
