# Game families (Phase 10) — status

> Design: [docs/design/game-families.md](../design/game-families.md) · Guide: [docs/tools/game-config.md](../tools/game-config.md) (_Game family_) · Agents: `invisible-game-config`, `invisible-game-maker`, then per phase

**One-line state:** the owner started Phase 10 on 2026-10-23. **P10.1–P10.8, P10.11, P10.12 and
P10.14 are merged; P10.13 (gravity, jumps and levels) is built** and in review. P10.13: an arcade character can fall, jump (a side-view jump set by height and time, with
hold, coyote time and a buffer), hop over ground obstacles or flap, and stand on a level painted from
tiles in the Scene Editor. P10.14: an arcade config with
`arcade.online` is played in a room on the new `services/game-server` (Colyseus 0.18), where devices
send inputs only and draw where the server puts every player; the service is written but **not
deployed** (owner steps in [INFRA.md](../INFRA.md) "Invisible Game Server"). P10.11: arcade
characters that patrol, chase and are played by keyboard or touch, authored in the new Invisible
Characters tool. P10.12: a play-field screen can be a world bigger than the screen, framed by a
following, scrolling, shaking camera with parallax layers. P10.8: an arcade project can be made in
Game Maker and plays as free play in the shared runtime — a catcher / dodger sample whose spawned
bodies move on a fixed-step loop, collide by tag and keep score in Flow. A match-3 project can be
made in Game Maker as free play (P10.5) or real money (P10.6): in the second the bet deals the
server's board, every swap is a `move` request, the server ends the round and it is collected once.
It plays against the test
server's `match3` mock on our own wire. **Publishing is on for every family the runtime plays**
(owner, 2026-10-25): a match-3 game, and with P10.8 a free-play arcade game, publishes to our test
server; delivery stays slot-only, and live real money waits on the partner (§9 #2).

## Current state

**Card C2 — the AI (built 2026-10-27; in review).** [card-games.md](../design/card-games.md) §12's
C2 row (§4), in one PR. No caller yet: the family, runtime and sample game are C3.

- **The AI** (`engine-mechanics` `cardAi.js` + `.d.ts`, plain ESM beside `cards.js`):
  `createAi` / `chooseAction` / `evaluate` / `aiSettings` / `replayMatch`. It takes a certain
  one-action win at once; `normal` and `hard` search `combat` for a win through any `guard` first;
  otherwise it tries each legal action on a copy with the rules' own `apply` and keeps the best by
  §4.1's weighted sum, doing nothing included (it wins ties). `hard` beam-searches sequences of
  plays in `main` (width 4, depth 3). The three presets of §4.2, with a deck's weight overrides.
- **Its own stream,** `${seed}:ai:${side}`, a number in the AI's value: one roll per decision for
  a mistake. The look-ahead runs every trial on one of four fixed sample streams, never the match's,
  and scores an action that draws (a `randomEnemy`) by the mean over the four. A plan plays only
  the cards in hand when the decision began, so it never reads the deck's hidden order.
- **The budget:** `MAX_PLAN_APPLIES` (600) caps every `apply` a decision makes. Real counts, pinned:
  200 on a full board with 36 listed actions (the design's case); a hand of ten targeted spells (95
  actions) would take 704 and stops at 600 (11–14 ms on the build machine).
- What C2 settled where §4 was silent, and its two readings of §4.1's table, are in the design's
  new §4.4.
- **Gate:** `check:card-ai` (20 checks; replay trace `fixtures/cards-ai-replay.json`): lethal past a
  preferred trade, through a guard and past a first attacker whose attack draws, none claimed out
  of reach or on a random hit; a win in `main`; `hard`'s plan beating one step; no illegal action
  in 90 AI-vs-AI matches; a decision changes neither input and moves only the AI's stream (one
  roll, two on a mistake); the same decision on 64 different match streams and on four orders of
  the deck; each difficulty replaying AI vs AI and from a player's record; the budget; `normal`
  beats `easy` 61–39 on seeds 1…100 with the sample decks (every sample card twice). Runs under
  `check:all`.
- **The design points C1 raised are fixed:** §12.1's C1 row now says the reader drops unknown card
  fields, and §2.2 states the `endOfTurn` expiry rule.

**Card C1 — the rules engine (merged 2026-10-27, #1391).** [card-games.md](../design/card-games.md)
§12's C1 row (§2, §3), in one PR. No caller yet: the AI is C2, and the family, runtime and sample
game are C3.

- **The rules** (`engine-mechanics` `cards.js` + `.d.ts`, plain ESM like `board.js`): `createMatch`,
  `legalActions`, `apply`, `isOver`; the four zones, the strict phases (start → draw → main → combat
  → end), the resource, every §2.4 legality rule (`IllegalAction` with a code), the FIFO effect
  queue with a death check after each effect, the `loop` guard (`MAX_QUEUE_STEPS` 500), fatigue,
  the hand and board limits and the turn limit. `apply` copies the match and never changes its
  input. Malformed rules (not a whole number at or above its minimum) throw.
- **Trigger order:** the `onDamaged` and `onDeath` triggers one effect raises share one order,
  active player first, then board order (read before the dead leave), and a unit's `onDamaged`
  stays ahead of its own `onDeath`. A death summon takes the dead unit's place: it goes before the
  nearest unit to its right that survived.
- **Effects as data:** the closed lists of §3 (seven verbs, four targets, five triggers, three
  keywords) exported as constants; `validateLibrary` (the §3.6 errors and warnings, as issues with a
  code); `cardText` (one generated English sentence per effect); `readLibrary`, the doc-readers
  reader: it drops unknown fields, an unknown verb / trigger / target / side / include / `until`
  drops its effect, an unknown keyword the keyword, an unknown card type the card, and it names
  every drop. Only a string is unknown; a value of the wrong type is kept and the validator refuses
  it.
- **The random stream is a number in the match** (`rngState`), stepped with `rngNext`, new in
  `board.js` beside `createRng` (and `rngSeed`); `createRng` now runs on the same step, and
  `board-replay.json` is unchanged.
- **Departures from the design's sketch,** each small, kept so `apply(match, action)` is the whole
  input or for a rule §2 left open:
  - the match also carries `rules` (defaults applied) and `library` (by id, shared between copies);
  - `createMatch` returns `{ match, events, dropped }`: the opening draws reach the presentation,
    and the reader's drops reach the caller for its one warning (C3's config reader owns that);
  - `legalActions` lists plays without a `slot` (any slot from 0 to the board's length is legal),
    so the AI's branching stays small;
  - `first` is `0 | 1 | 'random'`; C3 maps the config's `'player' | 'ai'` onto sides;
  - **an expiring `endOfTurn` health buff never kills**: the unit is left at 1 health at least,
    its damage cut to fit (the genre's rule). §2 did not say; a permanent negative buff still kills.
- **Gates:** `check:card-rules` (43 checks, among them every verb on every target it allows, and
  the replay trace `fixtures/cards-replay.json`) and `check:card-library` (43 checks); the sample
  library the gates play is `fixtures/cards-sample.library.json`, invented. Both run under
  `check:all`.
- **For C3's config validator:** rules that are each valid but clash (`resource.start` above
  `max` is clamped; an `openingHand` larger than the deck ends the match in fatigue at once), and
  `cardText` expects a validated card (C4's live preview must validate first).

**P10.13 — Arcade A3b: gravity, jumps and levels (built 2026-10-27; in review).** §8's P10.13 row
(§4.4, §5.1, §6.3), in one PR, on top of P10.11 and P10.12. No live game uses any of it yet; the
sample is a fixture.

- **Gravity and levels** (`engine-mechanics` `motion.js`, new exports only; P10.8's and P10.11's
  functions and replays are unchanged): `stepPlatform(body, dt, {solids, tiles, field, gravity,
  maxFall})` integrates the pull exactly (so a jump's apex lands where its settings put it), caps
  the fall at `maxFall`, and cuts the move into sub-steps no longer than half the thinnest thing it
  can meet (the body, a tile, a solid or platform; at most `MAX_SUB_STEPS` 64), each resolved x then
  y as `stepSolid` does. **One-way** bodies and tiles stop a body only from above, while it falls,
  and only when its bottom was at or above the top before that sub-step. Under `clamp` the field's
  floor and ceiling stop it like a solid. Returns `grounded` (a fall stopped from below this step)
  and `onWall`. Tile grids are `{x, y, tileW, tileH, cols, rows, cells}` with one code per tile
  (`TILE_NONE` / `TILE_SOLID` / `TILE_ONE_WAY`); `tilesIn` gives the tiles a box touches as box
  bodies.
- **Jumps** (`engine-mechanics` `jumps.js` + `.d.ts`, new): a jump is its **height** and its
  **time to the apex**; `jumpProfile` turns them into a launch speed `2h/t` and a pull `2h/t²`.
  `stepJump` (the `gravity` jump: launches on a buffered press while grounded or within coyote
  time, cuts the climb on an early release when `minHeight` is set, and returns the pull: the
  jump's own while rising, `movement.gravity` while falling, so a fall can be snappier than the
  rise); `stepHop` (the `hop`: a height `z` above the ground plane with the same buffer and cut);
  `stepFlap` (a press kicks `vy` to `-kick`). Coyote time and the buffer default to 100 ms.
- **Config** (`game-config`, sparse, every new field optional): `movement.gravity` / `maxFall`;
  `controller.jump {kind, height, time, minHeight?, coyoteMs?, bufferMs?, airControl?}` on a
  `sideScroll` (a `gravity` jump) or a `topDown` (a `hop`) controller — a jump with no height or
  time
  is dropped, defaults are not stored; a new `flap` controller `{kick, speed?}`; body flags `ground`
  (a hop in the air passes over it) and `oneWay` (dropped on a `solid` body); `ARCADE_JUMP_ACTION`;
  anim sources `grounded`, `onWall`, `airborne`, `height`. The validator errors on a hop on a side
  view or a gravity jump on a top-down character, and warns on a flap with no gravity and a tap
  height
  above the jump.
- **The loop** (`engine-game` `arcadeCharacters.ts`; `arcadeLoop.ts` gains one guarded hook in the
  overlap pass, the `lifts()` read and the probe's contact fields): a character with
  `movement.gravity`, a `gravity` jump or a flap **falls**: only its `vx` is steered (`air control`
  scales it while airborne), its `vy` belongs to the pull, the jump or the flap. A `topDown` hop
  steers on both axes and lifts off the plane; while it is up it is not stopped by, and does not
  `collide` with, a `ground` body (a wall without the flag still stops it). Falling and hopping
  characters, and every character once the level has tiles, move with `stepPlatform`; the rest keep
  P10.11's `stepSolid`, so a level with neither steps exactly as before. A jump reads the `jump`
  action, `up` for a side view and a flap, or a pointer pressed above the body (a flap: any press).
  New optional loop option `tiles()`.
- **The `tilemap` node** (`engine-layout` `types.ts`, `tilemapNodes.ts`, `Tilemap.svelte`, a
  `LayoutNodeView` branch): `tileWidth`, `tileHeight`, `cols`, `rows`, `tiles` (row by row, an index
  into the tileset or -1) and `tileset` (`{region, collide?}`: an atlas region — scoped
  `<assetKey>::<region>` or bare — and `solid` / `oneWay`, absent = none). The game draws one sprite
  per painted tile from the node's x / y (scale applies; rotation and anchor do not). The save
  normalizes it (`normalizeTilemapNode`: tiles made exactly `cols × rows`, an index the tileset
  lacks
  becomes empty, a node with no usable size or more than 262,144 tiles dropped). `sceneTilemaps`
  gives the loop a screen's top-level tilemaps that have a colliding tile; the runtime (`apps/lines`
  `arcade.ts`) reads them from every screen that holds a spawn layer.
- **The hop's look**: after each frame the runtime publishes every hopping character's height
  (`engine-layout` `arcadeLifts.svelte.ts`); `<SpawnLayer>` then draws such an instance raised by it
  over an ellipse shadow the width of its body. Only a config with a hopping character turns this
  on;
  every other spawn layer renders its old markup.
- **`/editor` paint mode** (`EditorTilemap.svelte`, `tilemapPaint.client.svelte.ts`, helpers in
  `$lib/editor/tilemapEdit.ts`, `EditorCanvas.svelte`): a **Tilemap** row in the Library
  (scene-only,
  16 × 8 tiles of 64 px at main centre); the stage draws each painted tile's region art, a dashed
  outline, and while selected the grid, solid tiles in red and a blue top line on one-way tiles.
  Tools
  **Move** (V), **Brush** (B), **Erase** (E), **Fill** (G), **Pick** (I) on a lone top-level
  tilemap;
  with a paint tool on, a press on the grid paints instead of moving the node, a fast drag fills the
  cells it skips, and one stroke is one undo step. Properties: tile size, columns / rows (clamped,
  applied on change), the tileset (region picker, thumbnail = make it the brush, collide none /
  solid /
  one-way, tiles placed, remove with the indices remapped), Add a tile. Rotation is hidden (the game
  ignores it). Guide: [tools/invisible-editor](../tools/invisible-editor.md).
- **Invisible Characters** and `/config`: Movement gains Gravity and Max fall; the Controller
  section
  offers `flap` (kick, speed) and a Jump sub-form for top-down / side-scroll (its kind follows the
  controller), with the jump's launch speed and pull shown read-only; Body gains Ground and One-way
  (also as columns in `/config`'s Arcade bodies table). The sandbox already runs the loop's own
  stage, so falls, jumps, flaps and hops behave as in the game; Space jumps, a hop is drawn lifted
  over a shadow, and the starting walls follow the character (a one-way platform and a ledge for a
  faller, a low ground wall for a hopper). Guides:
  [tools/invisible-characters](../tools/invisible-characters.md),
  [tools/game-config](../tools/game-config.md).
- **Shipping (rule 8):** the tilemap is part of the layout doc, so it ships with it; its tileset
  regions are collected by the art export's node walk (`editorArtExport.ts`, `tilemapRegions` →
  `addImageRef`, the reel grid tile's rule), so each painted region's sheet travels export →
  `deploy/editor-art/` → the bundle's `editorArt` index → pull → the game's editor-art registration,
  and is in the editor's art scope. Only regions a painted tile uses ship.
- **The sample** (a fixture, not the Game Maker default, as P10.11's guard and P10.12's river are):
  `engine-mechanics/fixtures/arcade-ledges.rules.json`, `referenceLayouts/arcadeLedges.ts`,
  `reference/arcadeLedgesSeed.ts`. A level 2880 × 800 with a camera following the hero, painted as
  one
  tilemap of 64 px tiles: ground with two gaps, a two-tile wall and three one-way ledges. The hero
  (`sideScroll` 320 px/s, gravity 2600 falling, a `gravity` jump of 170 px in 0.42 s, a tap 48 px)
  collects coins; a pit zone under the gaps costs a life and puts it back at the start with the
  camera snapped; the goal is worth ten coins. Its tileset names one sample sheet
  (`ARCADE_LEDGES_SHEET`), which the playtest writes into its snapshot's `deploy/editor-art/`.
- **Gates:** root `check:arcade-platformer` (43: the jump's height and time to the apex at 30 / 60 /
  120 / 144 Hz, landing where it left in twice the time; a tap reaching about `minHeight`, a part
  hold between; the fall pull; coyote time and the buffer each just inside and outside the default
  window and a set one; one press, one jump; one-way tiles and bodies from below and above, walking
  through them, no snap from inside; **no tunnelling at maxFall 6000 px/s** through a 64 px tile, an
  8 px tile row, a 4 px one-way body and a 2 px solid, for a 32 px and a 6 px body; the cap; tile
  solidity none / solid / one-way, a wall (onWall), a ceiling; grounded; the field floor; **the
  platform step equal to `stepSolid`** with no gravity; the hop's height and time, its buffer, cut
  and fresh press; the flap; a body spawned inside a block of solid tiles moved out and kept out; a
  600-step scripted run replayed against
  `fixtures/arcade-platformer-replay.json`). Launcher `check:arcade-platformer` (50: a top-down
  character on no tiles keeps the solid step, no contact or lift appears; the P10.8 / P10.11 /
  P10.12
  sample configs normalize stably with no new key; the config round trips and the validator's
  issues; in the loop a jumper lands on tiles, jumps to its height on `jump`, `up` and a pointer
  above it, lands on a one-way ledge from below, stops at a wall tile, writes `grounded` / `onWall`
  /
  `airborne` only on change; a falling brain character; a flap; a hop over a `ground` rock without a
  `collide`, stopped by a tall wall, publishing its lift and `height`; a gravity jumper with no
  `movement.gravity` handed to nobody still falls; a touch above a top-down hopper steers it and
  never hops it; a character that never falls reads `grounded` and not `airborne`; the tilemap
  readers and the
  save; the sample played headless on the real interpreter — standing, the first gap jumped, coins,
  the pit, the camera snapped, seed replay). `check:art-scope` case 9 (a painted tile's sheet is in
  scope and ships; the one-way ledge's too; an entry no tile uses does not; nothing dangling).
  `check:characters-tool` (154), `check:game-config-family` (156), `check:editor-tilemap` (76);
  `check:arcade-camera`'s `<SpawnLayer>` source scan accepts the culling branch as an `{:else if}`
  behind the lift branch (76).
  `check:arcade-motion` (18) and `check:arcade-characters` (53 root, 89 launcher) unchanged.
- **Verified by playing:** `scripts/playtest/arcade-platformer-play.mjs`
  ([playtest/arcade-platformer.md](../playtest/arcade-platformer.md)) on the branch runtime, 15 /
  15:
  the hero starts standing on the painted ground; a pixel of the ground row is the shipped sheet's
  ground colour (the tiles draw through the editor-art index); ArrowRight runs it and release stops
  it; Space jumps it exactly 170 px and it lands where it left; a tap rises 48–68 px; a jump from
  under a one-way ledge lands on it; the camera follows it past half way; the first gap and the wall
  are jumped; the second gap's pit costs a life and puts it back with the camera at 0; coins count;
  a
  press above it on the screen jumps it; no RGS request; no page error; the same seeds and keys
  replay. On the same build P10.8's `arcade-play.mjs` 14 / 14, P10.12's `arcade-camera-play.mjs`
  12 / 12 and P10.11's `arcade-characters-play.mjs` 14 / 14.
- **Bundle size** (the release build's `index.html`; `main` at 3dc8b3d vs this branch): 3,754,717 B
  / 1,284,098 B gz → 3,768,148 B / 1,288,964 B gz: **+13.1 KB raw, +4.8 KB gz (+0.38 %)**,
  downloaded
  by every game, run only by an arcade game with a falling or hopping character or a tilemap (the
  tilemap renderer by any screen with one). The sample is not in it.
- **Slot / match-3 / P10.8 / P10.11 / P10.12 parity:** every runtime path is keyed on a character
  that falls or hops, or a tilemap: `stepSolid` still moves every other character on a level without
  tiles; no lift is published, so `<SpawnLayer>` renders its old branches; `LayoutNodeView` gains a
  branch for a node kind no shipped layout has. Edited shared modules: `arcadeCharacters.ts`,
  `arcadeLoop.ts` (one guarded `passesOver` in the overlap pass, `lifts()`, probe fields),
  `SpawnLayer.svelte`, `LayoutNodeView.svelte`, `types.ts` (a kind and its fields),
  `behaviours.js` (a `flap` case), `motion.js` / `motion.d.ts` (new exports, `Movement` fields),
  `arcade.ts` (`apps/lines`), `determinism.ts` (a type), `editorStorage.ts` (the tilemap
  normalizer),
  `componentFields.ts`, `editorArtExport.ts` (the tilemap branch), `game-config` normalizers (a
  stored
  doc without the new fields comes back byte for byte). The current-games harness is not edited.
- **Also fixed here:** `check:family-tools` (run by CI's `check:all`) was red on `main` (141 / 177):
  its pre-P10.11 tool baseline did not know the two Bug Reports tools that #1373 merged beside
  P10.11.
  They are family-agnostic, so they join the baseline (177 / 177).
- **Chosen in P10.13, owner may overturn:**
  - **one PR**; the sample is a fixture, not Game Maker's arcade default;
  - gravity is a character's (`movement`), not a plain body's: falling crates and rolling logs wait
    for a body-level pull; only characters collide with tiles;
  - a `gravity` jump's own pull governs the rise; `movement.gravity`, when set, the fall (a jump
    with neither falls by its own pull);
  - hold to jump higher is a cut on release to the speed that rises `minHeight` more; no
    `minHeight`, no cut;
  - the buffer counts from the press to the move that lands (one step of slack, as the landing is
    seen a step later); coyote time from the last grounded move;
  - the jump reads a new `jump` action, and `up` too for a side view and a flap; touch is a press
    above the body (a flap: any press); a hop has no touch gesture;
  - per-tile solidity lives on the tileset entry (each tile of one entry collides alike);
  - tiles are read from top-level tilemaps of the screens with a spawn layer, placed by x / y and
    scale, never rotated; a tilemap with no colliding tile is drawing only;
  - only painted entries' regions ship; an unused tileset entry's art does not;
  - `ground` is one flag for "a hop passes over it": both the stop and `collide` are skipped while
    airborne;
  - a body found inside solids it did not move into (a spawn or `moveTo` into painted ground) is
    stepped out the shortest way past every solid in its path (a block of tiles crossed whole), ties
    preferring up, then left, right, down; P10.11's `stepSolid` keeps its own one-solid settle;
  - a character that never falls reads `grounded` true and `airborne` false; the hop's shadow sits
    at the body's feet.
- **Not done here:** **diamond (2:1) tiles and autotiling** (§4.4): the collision runs on the flat
  ground plane already, but the isometric projection P10.12 left out is what draws bodies and
  diamonds
  in step, so they come with it (Salmons' next arcade piece, §9 #19); slopes, moving platforms and
  ladders (§4.4, later); a drop-through on one-way platforms; the paint mode was checked by its gate
  and the build, not driven in a browser (no Postgres / R2 here); Flow signals for a jump or a
  landing
  (the look's `grounded` / `airborne` inputs cover the animation); the sandbox drawing a tilemap;
  `/flow-v2` Preview running the loop; a current-games fixture for the sample (it would edit the
  harness).
- **Known limits:**
  - `MAX_SUB_STEPS` bounds the work a step does: a body thinner than 2 px moving faster than
    64 × its own half-thickness a step could still tunnel (`maxFall` 6000 px/s at 60 Hz is gated);
  - a tilemap's tiles are read when the screens load; a level changed live needs a reload, as every
    baked layout does;
  - the hop's shadow is the body's width, an ellipse a third as tall, and does not shrink with
    height;
  - a tilemap is never drawn mirrored (a negative scale draws and collides as its size); the editor
    stage still draws one with the signed scale.

**P10.14 — Arcade A4a: the game server (merged 2026-10-27, #1375).** §8's P10.14 row, per the
approved A4 design ([realtime-multiplayer.md](../design/realtime-multiplayer.md) §4–§14), in **one
PR**. Netcode (prediction, reconciliation, interpolation), the rules as data and online Flow events
are P10.15; bots, nearby-only state and the 100-player load test are P10.16.

- **`services/game-server`** (new pnpm workspace member; Node 22, type-stripped TS, no build step):
  `@colyseus/core` 0.18.23 + `@colyseus/ws-transport` 0.18.4 + `@colyseus/schema` 5.0.42, pinned.
  One room type, `arcade`, matched by the join option `game` (`filterBy`). `roomSim.ts` is the room
  without the network — who is in it, each player's character, one fixed step of everyone — and
  `arcadeRoom.ts` runs it inside Colyseus: `setFixedTimestep(step, tickHz, { subSteps })`,
  `defineInput(Input, { seqField: 'seq', bufferMaxSize: 60, sanitize })`, each player's next inputs
  per step (`inputsThisStep`: one, or two while more than one waits — but the extra only against
  the player's **credit**, the steps it stood still for want of an input, banked for at most half a
  second at the room's rate — each its own
  `stepPlayer` call: a stall's burst drains in a few steps instead of staying as lag, and a device
  that sends two a step is not faster, since a player never applies more inputs than steps have
  passed, and a saved-up dash is at most twice the speed for half a second), the schema written
  once per patch (`onBeforePatch`), `setPatchRate(1000 /
  patchHz)`. `configSource.ts` reads a game's config by key (a directory or a `{game}` URL, cached
  60 s, good or bad). `server.ts` adds `GET /healthz` (`commit`, `rooms`). Dockerfile at the repo
  root's context, mirroring `director-worker` (npm install, the two packages linked in, the
  `ts-loader` hook). [INFRA.md](../INFRA.md) "Invisible Game Server" has the env, local run, limits
  and the owner's Railway / DNS steps; **nothing was deployed**.
- **The one-player step, shared** (`engine-mechanics` `online.js`, plain ESM + `.d.ts`):
  `sanitizeInput` / `clampInput` (moves are whole steps of −127..127 no longer than 127, so the clamp
  is exact and idempotent; buttons masked to jump / ability 1 / ability 2; aim onto the field; seq a
  uint32; anything non-finite reads 0), `stepContext` (`subDt` computed as Colyseus computes it),
  `applyInput` / `stepPlayer` (velocity from the input, then `subSteps` × `motion.js` `stepBody`),
  `facingOf` (eight ways, integer comparisons only), `cleanName`, `characterBody`. The server steps
  every player with `stepPlayer`; the runtime clamps its inputs with the same `clampInput`; P10.15's
  predictor steps its own player with the same `stepPlayer`.
- **Inputs only** (§11). A device sends `Input { seq, moveX, moveY, buttons, aimX, aimY }` — a flat
  typed schema, so a field it does not declare cannot arrive — and joins with `name` and
  `character`. Every other message is counted against the flood limit and ignored. The character is
  checked against the room's list and its `max`; the name is cleaned and capped at 24.
- **Join, leave, rejoin.** Join puts a player at `arcade.online.spawn` (else the field's centre);
  no character ⇒ the first with a place; full, unknown or no place left ⇒ refused. A drop holds the
  place for `rejoinSeconds` (`allowReconnection`; the body stands still, inputs are not taken); the
  SDK's reconnect, or `client.reconnect(token)`, resumes as the same session; a consented leave, or
  the grace running out, removes the player; an empty room disposes.
- **Resource limits per room** (§11): `maxPlayers` ≤ 100, each character's `max`,
  `maxMessagesPerSecond = 2 × tickHz + 10` (a flooder is closed with `WITH_ERROR` and gets **no**
  held seat), WebSocket `maxPayload` 1 KB, 60 inputs buffered per player (overflow drops the
  oldest), at most 16 characters, a seat held 5 s for a device that has not connected yet. Per
  process: `GAME_SERVER_MAX_ROOMS` (default 50); 6 000 sockets; a request's headers and body within
  10 s; a request whose URL Colyseus' router (better-call) could not build — a bad
  `x-forwarded-proto`, an absolute-form target, a bad `Host` — is refused (400, or the upgrade
  dropped) before the router builds it, because the router does it unguarded and the throw would
  end the process; a method the server does not serve (only GET, HEAD, OPTIONS, POST) is
  refused 405 for the same reason (`TRACE` made `new Request` throw); a room's WebSocket may carry
  only the four frames the runtime sends — JOIN_ROOM, LEAVE_ROOM, PING, reliable inputs — and any
  other closes it undecoded and holds it no seat (`socketGuard.ts`): `@colyseus/schema` 5.0.42's
  decoder for UNRELIABLE inputs loops for ever on a negative slot length (three bytes would stop
  every room; to report upstream), and ROOM_REQUEST answers queue without limit on a socket that
  never acknowledges its join; a socket that has not acknowledged its join within 5 s, sends more
  than 150 frames a second (messages and the WebSocket's own ping / pong control frames alike; the
  transport answers no client ping), or lets more than 256 KB of unsent data pile up (a reader that
  stops reading) is terminated; every close is followed by a terminate within 1 s and its frames are
  dropped (a graceful close otherwise goes on parsing for 30 s); a WebSocket is served only for a
  room seat (`/<process>/<room>?sessionId=…`; Colyseus' latency utility, which answers every
  frame, is not); one address holds at most 16 WebSockets and seats held for its dropped players
  to rejoin, counted together (`addresses.ts`) — the one socket that reclaims a seat held for that
  address (its token, its address and its session) may pass the cap by one, so a full address can still rejoin its
  own dropped player, and any other token gets nothing — and opens at most 60
  a window, refused attempts included; an online room holds at least 2 players;
  an IPv6 /64 counts as one address; the entry point logs an unhandled rejection instead of exiting; Colyseus'
  `create` is **not exposed** (only
  `joinOrCreate`, `join`, `joinById`, `reconnect`), so a device cannot make rooms nobody joins; a
  `game` that is not a string is refused (it would never match `filterBy`); before Colyseus' router
  reads anything, a request that would carry a body with no `content-length` (chunked) is answered
  411 and one declaring over 4 KB 413 (the router reads a body whole, with no limit of its own); one
  address may make 30 requests that can carry a body (every matchmaking call) per 10 s — counted by
  method, so no spelling of the path escapes it — 429 past it (behind Railway the address is the
  proxy's `x-forwarded-for` entry: on by default when `RAILWAY_ENVIRONMENT` is set); a refusal is
  answered before the socket closes; a config ≤ 2 MB (bytes) fetched within 5 s, at most 4 reads
  in flight, answers cached 60 s per key, and a game that has loaded once keeps its last good config
  through a full reader or a failed read (a timeout, a 5xx), but not once the source says it is gone
  (a missing file, 404, 410) or refuses its new config (made-up keys can neither evict nor starve a
  real game); game keys `^[a-z0-9][a-z0-9_-]{0,63}$`. A refused room tells the device only
  "this game is not available"; the reason goes to the server log. Every rate is clamped by
  `resolveArcadeOnline`, whatever the doc says.
- **State** (`schema.ts`): per player `name`, `character`, `x`, `y` (float32), `facing` (uint8),
  `moving`, `connected`, `ack` (the seq of the newest input applied); per room `phase` (`waiting` →
  `running`) and `step`. The level is not in the state.
- **Config** (`game-config` `family.ts`): `GameConfigDoc.arcade.online` = `{ characters: [{ id,
  body, speed, max? }], maxPlayers?, tickHz?, subSteps?, patchHz?, rejoinSeconds?, spawn?, layer?
  }`, sparse (defaults 16 / 30 / 2 / 20 / 60 / field centre / `field` are dropped);
  `ARCADE_ONLINE_DEFAULTS`, `ARCADE_ONLINE_LIMITS`, `resolveArcadeOnline`. A character's `body` is a
  key of `arcade.bodies` (its shape, tags and edges; the component it is drawn as). The validator
  refuses an online game with no `arcade.field` (the server has no screen), no character, or a
  character whose body no arcade body names, and warns on out-of-range numbers, a state rate above
  the step rate and a spawn off the field. `onlineGameOf(doc)` (new `arcadeOnline.ts`) is the one
  derivation the server and the device both make. No `/config` UI for the block yet (open item).
- **The mechanic:** `ARCADE_ONLINE_MECHANIC` (`ARCADE_RULES_MECHANIC` + a new `GameMechanic.room`,
  false for every other mechanic). `mechanicFor` returns it for a rules arcade config with
  `arcade.online`; an RGS arcade config stays `unplayable`.
- **The runtime's online branch** (`apps/lines` `game/online.ts`): `+layout.ts` joins a room before
  the game mounts, only when `gameMechanic().room` — `?rooms_url=` the server, `?rooms_game=` (else
  `?project=`) the game, optional `?rooms_name=` / `?rooms_character=`; a config that cannot be
  played online, a missing parameter or a refused / unreachable server stops on the existing
  boot-failure screen (`refuseOnlineBoot`, the `haltBoot` path). `@colyseus/sdk` 0.18.6 is imported
  dynamically there and nowhere else, through the `engine-rooms` workspace package (a game repo
  cannot install a third-party package `apps/lines` declares: `check:game-app-deps`).
  `<ArcadeStage />` does not start the local loop for an online game: it ticks `tickOnline` — one
  input per fixed step from the keyboard (arrows / WASD, Space = jump), clamped, sent — and draws
  every room player as a spawned instance of its character's component in `online.layer`, at the
  server's last place (no prediction or smoothing: P10.15). The arcade probe reads the room. Free
  play, as every arcade game (`rgsSession: false`).
- **Gates:** `check:room-sim` (root, 36 checks, ~30 s; discovered by `check:all`).
  - *Headless, over the room's own code:* 10 000 steps of six players at 30 Hz × 2, 60 × 1 and
    20 × 4 with hostile, repeated, stale, gapped and missing inputs and network stalls that release
    in bursts — the room's body equals the device's `stepPlayer` fold **bit for bit** on every step,
    and the backlog stays bounded (under one input waiting on average); replay; the clamp exact and
    idempotent over 20 000 inputs; an input claiming a place, score or character changes nothing;
    seq order; a stall's burst drains in ≤ 6 steps; a device sending three a step for 600 steps
    applies exactly 600; over 5 000 random steps no player applies more inputs than steps, at most
    two in one step and at most 45 in any 30; join limits, names (control, zero-width and bidi
    characters dropped), drop / rejoin; refused configs; the config source's last-good fallback and
    its forgetting a gone or refused game; IPv6 addresses key by /64; the mechanic (only an online
    config sets `room`); source scans (the SDK reached only from `game/online.ts`, lazily; the
    layout and stage branch on `room`).
  - *Live, a real Colyseus server on localhost with real SDK clients:* `/healthz`; bad / missing /
    non-online / non-string game keys make no room and name no reason; `create`, a 10 KB body and a
    chunked body (411) are refused; a bad `x-forwarded-proto`, an absolute-form target, a bad
    `Host`, `TRACE`, `PROPFIND` and a bad upgrade are refused and the server still answers; one
    address's 121st matchmaking request in a window gets 429 (dot-segment spellings too) and another
    address's does not; join state; 90 live inputs stepped exactly as the device steps them (and
    drawn at their float32); after a 0.7 s stall a burst of 20 inputs is applied within 550 ms; an
    off-scale move clamped; ROOM_DATA (a `move` carrying a place, a numeric type), ROOM_REQUEST, a
    raw request frame and DATA_BYTES each end their socket, hold no seat and move nothing; three
    unreliable-input frames each end their socket while the rooms step on; a socket that never
    acknowledges its join is ended after 5 s; the latency utility and a seat path with no session
    are not served; 16 seats' sockets from one address open, the 17th is dropped, another address's
    opens, a closed one frees its place; once an address's 60 upgrades in a window are spent every
    attempt is refused; 16 joined-then-dropped seats leave their address no room for a 17th; a
    flood of WebSocket ping frames, and one of pong frames, ends its socket; an address at its 16
    still reconnects its own dropped player while a new join, and a fresh seat claimed with a bogus
    reconnection token or with the held seat's own token, are refused; 200 PINGs from a joined device end its socket; room size and character max;
    a drop keeps the place and `reconnect(token)` resumes it; the grace expiring; a flood of inputs
    past the message limit disconnects; `maxRooms`. `family.fixture.ts` §4c covers the config block.
- **Verified by playing:** `scripts/playtest/online-play.mjs` on the branch runtime, two headless
  shells against a local game server ([playtest/online-sample.md](../playtest/online-sample.md)):
  13 / 13 — both pages joined one room and drew both players (one a salmon, one the bear its
  `?rooms_character=` asked for); ArrowRight on page A moved one player right on both pages to the
  same place and letting go stopped it; the pages agreed on every place; no RGS request and no page
  error on either; closing page B let its player go after the 2 s grace; a launch with no
  `?rooms_url=` stopped on the boot-failure screen.
- **Bundle size** (the release build's `index.html`; base 5a44e2b vs this branch): 3,678,290 B /
  1,260,736 B gz → 3,867,967 B / 1,319,851 B gz: **+189.7 KB raw, +59.1 KB gz (+4.7 %)**, downloaded
  by every game, run by none but an online one. Almost all of it is `@colyseus/sdk` itself (its
  `Client` alone bundles to 169 KB / 53 KB gz; importing only `Client` and the serializer saves
  nothing). The runtime builds with SvelteKit's inline strategy, so the dynamic `import()` keeps the
  SDK from being *run* by offline games, not from being *downloaded*. **Owner decision (below).**
- **Slot / match-3 / offline-arcade parity:** every new runtime path is keyed on
  `mechanic.room`, which only a config with `arcade.online` sets: `+layout.ts` skips the join,
  `<ArcadeStage />` starts the local loop exactly as before, and nothing else reads the SDK.
  Edited shared modules: `+layout.ts`, `ArcadeStage.svelte`, `editor-scenes.ts` (a new exported
  `refuseOnlineBoot` beside `refuseUnplayableBoot`), `mechanic.ts`, `engine-mechanics` `index.ts`,
  `game-config` `family.ts` / `familyValidate.ts` / `index.ts`. `familyGate` and the real-money
  gates are not edited; the current-games harness is not edited.
- **Chosen in P10.14, owner may overturn** (neither plan fixes them):
  - **one PR**, not split;
  - the server is a **workspace member** (so CI installs Colyseus and the gate runs a real server);
    the image installs with npm, as `director-worker`'s does;
  - **a step with no input moves its player by nothing** (it stands still), and a step with a
    backlog applies up to four inputs, each a step of its own, extras only against the credit of
    starved steps, so a body is exactly the fold of
    `stepPlayer` over the inputs the server applied — the device can always replay it;
  - positions travel as **float32** (the design's §5), while the simulation is float64: the fold is
    exact on both sides, but a reconciler that rewinds to the *synced* place (P10.15) starts from
    `Math.fround(x)` and will make sub-pixel corrections — P10.15 rewinds to its own fold, or moves
    `x` / `y` to float64 if that costs too much;
  - moves are **integers −127..127** on the wire (int8), aim float32 on the field;
  - `ack` is **in the room state** (as well as Colyseus' own reconciliation ack), so a device and the
    gate read which input a place came from;
  - the room's config comes from **`GAME_SERVER_CONFIG_URL` / `_DIR`**, read once per room, cached
    60 s per key; until the publish writes a published online config (open item), the interim
    source is the launcher's token-gated `/api/game-config/doc` (the authored config);
  - the address and game come in as **`?rooms_url=` / `?rooms_game=`** (else `?project=`), not yet
    written by the publish (open item);
  - the defaults: 16 players, 30 Hz × 2, 20 Hz state, 60 s rejoin, the field's centre, layer
    `field`; keyboard only (arrows / WASD, Space), aim always 0;
  - a flooder gets **no** held seat; `deploy-drift.mjs` gets its entry **after** the service exists.
- **Known limits** (none reachable by a slot game):
  - **an online game has no world camera** (P10.12): the server moves the bodies, so the local loop
    that owns the camera never starts, and a `world` / `camera` on an online game's play-field screen
    is inert (the view stays at the origin, nothing is culled) until P10.15 drives it from the room;
  - **an online game's characters (P10.11) do not run** either: brains, controllers and paths belong
    to the same local loop, so `arcade.characters` on an online game is inert; the room moves only
    its players' bodies (`arcade.online.characters`) until P10.15 brings the rules online
    (`validateArcadeOnline` warns at `arcade.characters`); for the same reason the loop's Flow
    board effects and values are not registered online, so Flow that targets them does nothing;
  - keys typed into a text field are not inputs (P10.11's `typingInto` rule);
  - **no prediction or smoothing** (P10.15): a device draws a player where the last 20 Hz patch put
    it, so motion is visibly steppy and the own player answers a round trip late;
  - players do not collide, score or end a round — the rules as data are P10.15; `phase` never
    leaves `running`;
  - a dropped device's in-flight inputs are discarded on rejoin (Colyseus freezes the buffer), and a
    burst beyond 60 waiting inputs drops the oldest, so a device's own replay can then differ until it
    reconciles (P10.15);
  - the boot-failure screen's wording ("could not reach the server holding its artwork and
    settings") is the runtime bundle's; the precise reason is in `__IE_RUNTIME_STALE__` and the console;
  - aim is clamped to the **field**, not yet to the character's reach (§11): there are no
    abilities until P10.15;
  - the per-address matchmaking limit is per process and per fixed window; a player can bank half a
    second of credit by standing still and spend it later at two steps a tick, which moves it no
    further than it could have gone in that time; a stall longer than half a second leaves the rest
    as lag until the device next misses a step (P10.15's reconciler can drop stale inputs);
  - the image installs with npm and no lockfile (as `director-worker`'s): the direct dependencies
    are pinned exactly, the transitive ones (`ws`, better-call) are not;
  - many devices behind one address (a school's NAT) share the 30-per-10 s matchmaking allowance
    and the 16 sockets;
  - the slow-reader cut-off (256 KB unsent) is **not covered by any gate or repro**: on loopback the
    kernel's buffers absorb a minute of patches before `bufferedAmount` rises; it is verified by
    reading ws (`bufferedAmount` = the socket's queued bytes + the sender's) only;
  - a reconnect that reaches the server before it has seen the old socket close (a network switch)
    finds no held seat yet, so an address at its cap is refused until the drop is noticed; the
    SDK's retry backoff then gets in;
  - per-address limits stop one address, not many: one address holds at most 16 seats, so with
    2-player rooms about 4 addresses (or IPv6 /64s) can fill a 50-room process. Size
    `GAME_SERVER_MAX_ROOMS` to the hardware (P10.16's load test) and put a proxy limit in front if
    abuse shows up;
  - a device whose first input carries `seq` 2³²−1 freezes its own later inputs (each is then
    "older"); it harms only itself;
  - `x-forwarded-proto` must be exactly `http` or `https`: an edge that appended to a client's
    header (`https, http`) would have every request refused — smoke-test once deployed;
  - every refused join or room prints Colyseus' own stack trace, so a hostile client can make the
    log noisy;
  - a room that closes for good (disposed, kicked, its reconnect run out) stops the page on the
    boot-failure screen; the session is page-wide and is not left on unmount;
  - the playtest's no-flow layout shows every scene at once (the sample's round-over text over the
    field): an online game's own flow is the author's, and the arcade starter flow is an offline one.
- **Owner / infra steps:** stand up the Railway service and the `rooms.invisiblewall.org` record —
  the exact settings are in [INFRA.md](../INFRA.md) "Invisible Game Server" (steps 1–8).


**P10.11 — Arcade A2: characters (merged 2026-10-26, #1377).** §8's P10.11 row (§4.3, §5.1, §5.2,
§6.3, §6.5), in one PR. No live game uses any of it yet; the sample is a fixture.

- **The brain** (`engine-mechanics` `behaviours.js` + `.d.ts`, plain ESM like `motion.js`): a small
  state machine whose states are behaviours and whose transitions are world conditions.
  `createBrain`, `createBrainWorld`, `stepBrain` (`*` transitions first, then the current state's, in
  authored order; at most one a step), `brainVelocity`, `setBrainState`, `controllerVelocity`. The
  nine presets `idle`, `wander`, `patrol` (a path, or between the spawn point and `dx` / `dy`),
  `followPath`, `chase`, `flee`, `keepDistance`, `hover`, `shootAt`; the seven conditions
  `targetWithin`, `targetBeyond`, `touching`, `hitSolid`, `timer`, `variable`, `random` (rolled on a
  beat of `every` ms). A behaviour returns a desired velocity and never moves a body. Every draw
  comes from the brain's own seeded stream, so a replay is exact.
- **Movement** (`motion.js`, new exports only; P10.8's functions and replay are unchanged):
  `steer` (accel / decel / maxSpeed / turnRate), `stepSolid` (the solid response: move x and push out,
  then y; a body moving diagonally into a wall keeps its along-wall speed; returns `hitX` / `hitY`),
  and paths (`samplePath` with Catmull-Rom smoothing, `pointAt`, `nearestDistance`).
- **Config** (`game-config` `arcadeCharacters.ts`, §9 #14): `GameConfigDoc.arcade.characters`, each
  with an id, a look `component`, `movement`, a `controller` (`topDown`, `sideScroll`, `pointer`), a
  `brain` and `animInputs`. Sparse and optional: a config without characters normalizes byte for
  byte as before. Validation errors (duplicate ids, a missing look, two characters on one component,
  a brain starting or a transition pointing at no state) and warnings (a played character with no
  body, a chase / flee tag no body carries, a `shootAt` with no layer, an anim input following a
  brain state that does not exist). `characterComponentIds` lists the looks and the `shootAt`
  projectiles.
- **Shipping (rule 8):** those ids seed the component walk beside `betModeCardIds` in
  `runtimeBundle.ts` and `editorArtExport.ts` (and the current-games fixture bake, which mirrors
  publish), so a look placed nowhere and spawnable nowhere still ships with its art.
- **The loop** (`engine-game` `arcadeCharacters.ts`, wired into `arcadeLoop.ts` in three guarded
  places): read input → controllers and brains → `steer` → `stepSolid` for character bodies against
  the bodies whose config body is `solid` → write positions and the looks' inputs → `overlaps` → Flow
  events. Built only when the config has characters; every other body steps exactly as in P10.8. New
  optional loop options: `input`, `paths`, `variable`, `setInstanceInput`, `spawn`.
- **Controllers** follow the Flow input map's `left` / `right` / `up` / `down` actions (the same key
  matching as `onInput`, now shared in `apps/lines` `flowKeys.ts`). `pointer` follows a pressed
  pointer or touch in the play field's space, and a keyboard controller with no key held follows a
  pressed pointer too, so the sample plays on a phone.
- **`animInputs`** set the look's state-machine inputs after each frame, only when a value changed:
  `speed`, `vx`, `vy`, `facing`, `moving` and `state:<id>`.
- **1D blend states** (`engine-layout` `stateMachine.ts`, `componentTimelines.ts`; §5.2's Rive item):
  a state can blend two or more timelines by a number input (`SmState.blend`). The two points around
  the input's value are mixed with `blendNodeSamples`; cues fire from the lower one. The Component
  Editor's State machine tab makes a state a blend state, edits its points, shows them on the card and
  previews them with a slider.
- **The `path` node** (`engine-layout` `pathNodes.ts`, the Scene Editor): points, closed, smoothing.
  It draws nothing in the game. The editor draws it dashed, with draggable point handles, click to
  insert, Alt+click to delete, and a Properties panel. `scenePaths(scene)` gives a screen's top-level
  paths to the loop.
- **Flow** (`ARCADE_VOCAB`): the actions `setCharacterState` and `setCharacterControl`
  (`controller` / `brain`, so a playable character can run as a bot), and the signal
  `characterState {instance, character, from, to}` on each of the brain's own transitions.
- **Invisible Characters** (`/characters`, new tool, arcade only through `FAMILY_TOOLS`; slot and
  match-3 projects see exactly the tools they saw before): the character list; per character the look,
  body, movement, controller, the brain on the Component Editor's state-machine canvas, anim inputs
  and the validator's issues; a sandbox play field (placeholder shapes, arrow keys / WASD dummy
  player, draggable walls, a drawn path, a seed) running `engine-mechanics` in the loop's own step
  order. It saves through Game Config's endpoints and holds Game Config's lease, so the two tools
  exclude each other (§9 #14). Guide: [tools/invisible-characters](../tools/invisible-characters.md).
  `/config`'s Arcade section links to it with the character count.
- **With the camera (P10.12):** characters live in the world's px, so they work on a world screen
  unchanged. `follow: 'player'` follows the player character (the first body tagged `player`).
  The pointer maps through the spawn layer's own transform, which includes the camera's world
  container and its shake. `despawnOutsideView` never takes the followed body; a character it does
  take is forgotten whole (`forget` drops its brain and looks). Culling only stops the drawing: a
  culled character still steps, runs its brain and gets its looks.
- **The sample** (a fixture, not the Game Maker default, as P10.12's river is):
  `engine-mechanics/fixtures/arcade-guard.rules.json`, `referenceLayouts/arcadeGuard.ts`,
  `reference/arcadeGuardSeed.ts`. A yard twice the screen wide (2844 × 800) with a camera following
  the runner (dead zone 300 × 200, 0.15 s smoothing). A runner (`topDown`, 280 px/s) among five
  walls; a guard that patrols the `guardRoute` loop through the yard, chases within 220 px, gives up
  beyond 320 px and stops at walls. A catch costs a life and sends the runner home. The guard's look
  blends idle → run by `speed` and raises an alert flag from `state:chase`. Placeholder art; no R2
  read.
- **Gates:** root `check:arcade-characters` (50: every preset and condition, a 900-step seeded
  replay against `fixtures/arcade-characters-replay.json`, steer, stop-and-slide, no tunnelling,
  paths, controllers); launcher `check:arcade-characters` (89: no-characters parity with P10.8, the
  stage order, controllers and touch, solids and `hitSolid` in the loop, the Flow actions and signal,
  `animInputs` only on change, `shootAt` spawning and shipping, the sample played headless on the real
  interpreter with a seed replay; characters + camera: follow across the world, a canvas point mapped
  through a scrolled, shaking camera, the followed character never despawned, a culled character still
  stepping, the sample's camera replaying); `check:characters-tool` (97); `check:layout-path` (45);
  `check:component-state-machine` (220, +36) and `-editor` (91, +12); `check:art-scope` (case 8: a
  character's look and projectile ship); `check:family-tools` (177: slot / match-3 / no-kind /
  custom / cloud manifests equal the pre-P10.11 list, arcade has Characters);
  `check:game-config-family` (145).
- **Verified by playing:** `scripts/playtest/arcade-characters-play.mjs`
  ([playtest/arcade-characters.md](../playtest/arcade-characters.md)) on the branch runtime (with
  P10.12 merged), 14 / 14: the guard walks its route; ArrowRight moves the runner at 280 px/s and
  release stops it; a wall stops it; the camera follows it across the yard; a held touch in the
  scrolled view walks it to the point under the finger; walking up to the guard turns it from patrol
  to chase; a catch costs a life and resets both; no RGS request; no page error; the same seeds and
  keys replay. On the same build P10.8's `arcade-play.mjs` 14 / 14 and P10.12's
  `arcade-camera-play.mjs` 12 / 12.
- **Bundle size** (the release build's `index.html`; `main` at 894746e, with P10.12, vs this branch): 3,714,155
  B / 1,271,536 B gz → 3,738,757 B / 1,280,876 B gz: **+24.0 KB raw, +9.1 KB gz (+0.73 %)**, downloaded
  by every game, run only by an arcade game with characters. Static, as before; the per-family runtime
  build is the later fix.
- **Slot parity:** every runtime path is keyed on the config having characters. Edited shared modules:
  `arcadeLoop.ts` (three guarded hooks), `SpawnLayer.svelte` / `spawnLayers.ts` (a layer registers its
  space; read only by characters), `flowV2Runtime.svelte.ts` (key matching moved to `flowKeys.ts`,
  same behaviour), `Game.svelte` (`<ArcadeStage scenes>`), `ArcadeStage.svelte`, `stateMachine.ts` /
  `componentTimelines.ts` (no `blend` ⇒ the old path), `LayoutNodeView.svelte` (a `path` draws
  nothing), `editorStorage.ts` / `componentStorage.ts` normalizers (unchanged for every stored doc),
  `runtimeBundle.ts` / `editorArtExport.ts` (no seed without characters), `roles.ts`.
  The current-games harness: only `fixtures.mjs`'s bake seeds `characterComponentIds` (a no-op for
  every current fixture).
- **Chosen in P10.11, owner may overturn:**
  - **one PR**; the sample is a fixture, not Game Maker's arcade default;
  - only CHARACTER bodies get acceleration and the solid response; other bodies step as in P10.8,
    so `solid` changes nothing in a game without characters;
  - a component is one character (validated); a spawned instance of it is that character;
  - a circle is pushed out of a solid as its box; a step faster than body + wall can still pass
    through (sub-steps are P10.13's);
  - a controller drives unless Flow switched the character to its brain; `characterState` is raised
    for the brain's own transitions, not for `setCharacterState`;
  - keyboard controllers read the fixed actions `left` / `right` / `up` / `down`;
  - path nodes are read at a screen's top level (scale, rotation and the per-layout override applied;
    nested ones are skipped); the first path of an id wins across screens;
  - unknown behaviours and conditions are dropped by the normalizer (a transition with one is
    dropped whole, so it never fires more widely than authored);
  - the blend state's cues follow the lower point; exit time reads the first point.
- **Not done here:** abilities (hit zones, cooldowns, `onHit`) and zone forces (§4.3; not in §8's
  row); `grounded` and the jump (P10.13); a character's own `edges` beyond its body's; renaming a
  character does not update Flow references to it; `/flow-v2` Preview running characters; a
  current-games fixture for the sample (it would edit the harness); the Characters page was checked
  rendered on the server, not driven in a browser (no Postgres / R2 here).
- **Known limits:** the sandbox is a stand-in (one dummy player, drawn walls and one path stand for the
  game's); P10.8's placeholder components draw half their size up and left of their bodies (a `rect`'s
  default anchor plus a `-w/2` offset; seen while building, not fixed here); a timeline's `alpha`
  multiplies the node's own, so a node stored at alpha 0 cannot be faded in by a timeline.
**P10.12 — Arcade A3a: world and camera (merged 2026-10-26, #1372).** §8's P10.12 row (§4.4,
§3.4, §5.1), in one PR. Built before P10.11, as §8 orders it for Salmons (its river is bigger than
the screen). No current game declares a world, so none of it runs in one.

- **The camera** (`engine-mechanics` `camera.js` + `camera.d.ts`, plain ESM beside `motion.js`): a
  view rectangle in world px (`x` / `y` its top-left, the view the screen's design size).
  `createCamera`, `stepCamera` (each fixed step: auto-scroll → aim → clamp → shake),
  `followWith`, `moveCameraTo`, `shakeCamera`, `viewRect`, `parallaxOffset`. Aiming: the followed
  body (by tag: the first carrying it in spawn order; or one instance) plus `lookAhead` seconds of
  its velocity, kept inside a `deadZone` centred on the view, eased by `smoothing` (a time
  constant, `1 − e^(−dt/τ)` a step; 0 snaps); or the point `moveTo` named. A snap (the first sight
  of a target, or one asked for) centres the target at once. `clampToWorld` (default on) holds the
  view in the world; a world narrower than the view is centred. `autoScroll {x, y}` px/s moves its
  axis, which then does not aim. The shake is a seeded, decaying offset that is drawn only: the view
  the signals and the despawn test never shakes.
- **The data** (`engine-layout` `types.ts`, read by `worldCamera.ts`): `Scene.world {w, h}` and
  `Scene.camera {follow, deadZone, smoothing, lookAhead, clampToWorld, autoScroll}` on a `game`
  screen; `BaseNode.parallax {x, y}`; `SpawnLayerNode.despawnOutsideView {margin}` (carried into the
  live set's `SpawnLayerSpec`). `sceneWorld` / `sceneCamera` keep only whole fields and drop
  defaults; `worldCameraScene` is the first screen with either; the save (`editorStorage.ts`) keeps
  both through those readers.
- **The loop** (`engine-game` `arcadeLoop.ts`): an optional `camera {spec, world, view()}`, or
  `attachCamera` later (the layout loads after the play field first mounts). After the zones, each
  step moves the camera, raises `enterView` / `leaveView` as a body's box starts or stops meeting
  the view (edges; one spawned in view fires on its first step) and despawns a body of a
  `despawnOutsideView` layer once it has been within the margin and is wholly beyond it — never the
  body the camera follows. After the frame it computes the **culled** set: bodies more than
  `ARCADE_CULL_MARGIN` (256 px) outside the view. Actions `cameraFollow {instance | tagged, snap}`,
  `cameraMoveTo {x, y, snap}`, `cameraShake {strength, duration}`, `cameraSetAutoScroll {x, y}`;
  values `cameraX`, `cameraY`, `viewWidth`, `viewHeight`. The shake has its own seeded stream
  (`<seed>:camera`), so `$engine.random` replays as in P10.8.
- **Drawing** (`apps/lines` `arcade.ts`, `<ArcadeStage scenes>`; `engine-layout`
  `worldCameraView.svelte.ts`, `LayoutScene.svelte`, `SpawnLayer.svelte`): with a world screen the
  play field is the world (unless the config names `arcade.field`); after every frame the runtime
  publishes the camera and the culled set. `<LayoutScene>` of a world screen draws its nodes in one
  container at `shake − camera`; a top-level node with `parallax` is shifted by
  `camera × (1 − factor)`; `<SpawnLayer>` under it hides a culled instance (`visible`, kept
  mounted, so its state machine runs on). The determinism probe's `state().arcade` gains `camera`.
- **Flow** (`ARCADE_VOCAB`): the two events, the four actions and the four values above, with
  their descriptions. `check:arcade-rules` pins the values to the loop's as before.
- **`/editor`** (`EditorWorldCamera.svelte`, `EditorParallax.svelte`, `EditorSpawnLayer.svelte`,
  `EditorCanvas.svelte` `drawWorldCamera`, helpers in `$lib/editor/worldCameraEdit.ts`): a game
  screen's Properties gain **World and camera** (a tick that seeds a world at 2× the layout type's
  design size; width / height; follow tag, dead zone, smoothing, look-ahead, auto-scroll, clamp to
  world; sparse writes; leaving `game` space drops them); the stage draws the world (dashed orange)
  and the camera's first frame (dotted blue) as a guide; a top-level node of a world screen gets
  **parallax x / y**; a spawn layer gets **Despawn outside view** + margin. Guide:
  [tools/invisible-editor.md](../tools/invisible-editor.md#world-and-camera-arcade-play-field).
- **The scrolling sample** (not a Game Maker kind; off every package entry): `engine-layout`
  `referenceLayouts/arcadeRiver.ts` (the P10.8 scene set with `basegame` a river 1422 × 3200, a
  camera following `player` with a 360 × 220 dead zone, 0.12 s smoothing, 0.2 s look-ahead, a
  backdrop of banks and ripples at parallax y ½, and the field despawning outside the view with a
  240 px margin), `engine-flow-v2` `reference/arcadeRiverSeed.ts` (the salmon swims up from the
  mouth with four-way keys; bears and fish spawn 120 px above the view from `cameraY` and drift down;
  a bear takes a life and shakes the camera 14 px / 350 ms; the `spawningGround` zone scores a lap
  of 100 and moves the salmon back to the mouth with the camera snapped; three lives) and the config
  `engine-mechanics/fixtures/arcade-river.rules.json`.
- **Gates:** `check:arcade-camera` (launcher, 76: the camera's dead zone, snap, smoothing,
  look-ahead, clamp at both ends and a narrow world, clamp off, auto-scroll per axis and at the
  world's end, `moveTo`, the shake's bound / decay / seed / precedence, parallax offsets equal to the
  editor's; the loop's view signals as edges, despawn with and without a margin, spawned-ahead kept,
  the culled set, the camera actions and values, **the same framing at 30 / 60 / 144 fps and on
  replay**, another seed shaking differently; no camera ⇒ no value, no-op actions, no view signal,
  the same bodies; the river sample played headless on the real interpreter — start at the mouth,
  scroll with the salmon on screen, spawns ahead, despawn behind, the bear's shake, the lap and
  snap, seed replay, a clean validation; the data readers and the save; source scans that the world
  container, culling and publishing exist only under a world camera and the river stays off the
  entries). `check:editor-world-camera` (launcher, 32: the editor's helpers). `check:arcade-rules`
  re-pinned for `<ArcadeStage scenes=…>`.
- **Verified by playing:** `scripts/playtest/arcade-camera-play.mjs` on the branch runtime (the
  river baked into a snapshot, 12 / 12): the round started with the salmon at the river's mouth and
  the camera on it at the bottom of the world; ArrowUp swam it up with the camera scrolling and the
  salmon on screen at every sample; nothing the camera left behind was still alive; spawns drifted
  in from above; on a portrait screen the 800-wide view was centred on the salmon and ArrowLeft
  panned it left; the same seeds and keys on a second page reached the same framing and bodies; no
  request but the runtime and the snapshot; no page error. The screenshots show the backdrop's banks
  and ripples moving at half the bodies' speed.
- **Bundle size** (the release build's `index.html`; `main` at 8f172c6 vs this branch): 3,677,695 B
  / 1,260,478 B gz → 3,686,596 B / 1,263,515 B gz: **+8.9 KB raw, +3.0 KB gz (+0.24 %)**,
  downloaded by every game, run by none without a world screen. The river sample is not in it.
- **Slot / match-3 / P10.8 parity:** every new path needs a `game` screen with a `world` or
  `camera`, which no shipped layout has: `<LayoutScene>` adds no container, `<SpawnLayer>` renders
  its old branch, the runtime never attaches a camera or publishes a view, and the loop runs its
  P10.8 step (the camera stage is skipped; the camera values answer nothing and the camera actions
  are no-ops). `spawnLayerSpec` adds a field only when the node has a margin. Edited shared modules:
  `LayoutScene.svelte`, `SpawnLayer.svelte`, `spawnLayerFields.ts`, `types.ts` (`BASE_NODE_FIELDS`
  gains `parallax`), `spawn.ts` (a type), `arcadeLoop.ts`, `ArcadeStage.svelte`, `arcade.ts`,
  `Game.svelte` (one prop on `<ArcadeStage>`), `determinism.ts` (a type), `editorStorage.ts`.
  `familyGate` is unchanged. The current-games harness is not edited.
- **Chosen in P10.12, owner may overturn** (the plan does not fix them):
  - **one PR**, not split;
  - world and camera live on the **screen** (the layout), as §5.1 lists them for `/editor`, not in
    `GameConfigDoc.arcade`; the play field's screen is the first `game` screen with either;
  - the camera's `x` / `y` is the view's **top-left**; the view is the layout type's design size, so
    a wider window shows world beyond it (nothing is masked);
  - `shake` is an **action only** (no authored standing shake), drawn only, a weaker shake ignored
    while a stronger one runs;
  - an axis that auto-scrolls does not follow; a snap centres the target, ignoring the dead zone;
  - the action and value names are camelCase (`cameraFollow`, not `camera.follow`), as every other
    vocabulary name; `viewWidth` / `viewHeight` were added beside the plan's two camera keys so Flow
    can spawn ahead on any side;
  - `despawnOutsideView` needs the body to have been within the margin first (so a spawn ahead is
    kept) and spares the followed body; it raises no signal of its own (`leaveView` came first);
  - culling is the loop's (by body box + 256 px), not Pixi's `cullable`: the culler plugin is not
    installed and a body box is deterministic; only spawned instances are culled;
  - parallax is read on a world screen's **top-level** nodes only; the editor stage draws them at
    the camera's start, where every factor gives the same place;
  - the scrolling sample is a gate / playtest sample, not a Game Maker choice.
- **Not done here:** the isometric projection and depth order §9 #19 places in P10.12 (the §8 row
  and this step's brief leave it out; it is the next arcade piece for Salmons, with P10.13's `hop`
  and diamond tiles); `playCinematic` holding the camera for a cutscene (§4.4); culling static
  (non-spawned) world nodes; a mask at the view's edge; interpolating places between fixed steps
  (P10.8's limit, now also the camera's); `/flow-v2` Preview running the loop; a current-games
  fixture for the river (it would edit the harness).
- **Known limits** (none reachable by a game with no world screen):
  - the camera block and the world are read once, when the loop first sees them; an edited layout
    needs a reload, as every baked layout does;
  - a node's per-layout `zIndex` override is not carried to its parallax wrapper (the base `zIndex`
    is);
  - the despawn and the view signals use the body's box, so art much larger than its body is judged
    by the body; the cull margin covers 256 px of overhang;
  - a followed body that is despawned leaves the camera where it was until Flow follows again.
  - the loop judges bodies in the play field's space against the view in world px, so a spawn
    layer is expected at the world's origin; a spawn layer takes no parallax (the editor hides it
    and the runtime ignores it), but one placed off the origin is culled / despawned off by its
    offset;
  - `<LayoutScene>` decides on the world container when the screen mounts; adding or removing a
    world on a live screen needs a remount (no live preview path does this).

**P10.8 — Arcade, rules-decided (built 2026-10-25; in review).** §8's P10.8 row (§4.2, §3.4, §9 #6),
in one PR.

- **§6.4 re-checked first, as the plan asks: the shared `apps/lines` runtime stays.** Arcade shares
  less with slots than match-3 does, but everything it needs beyond `motion.js` already lives in
  that runtime: the Flow interpreter with variables, timers and keys (P10.3), spawn layers and their
  ship chain (P10.7), components, the free-play boot branch (`<Authenticate freePlay>`, P10.5), the
  boot-failure screen, determinism and live assets. A second app would first have to extract or copy
  them (the drift §6.4 warns about). The size cost is the owner's already-accepted static cost
  (below), with the per-family runtime build as the later fix — still one app. The A4 design also
  keeps one runtime. So the recommendation held and the step went ahead.
- **`motion.js`** (`engine-mechanics`, plain ESM + `motion.d.ts`, beside `board.js`):
  `createFixedStep` (an accumulator at the config's `fixedHz`, at most 5 steps a frame, a backlog
  dropped), `stepBody` / `step` (position += velocity · dt; per body `clamp` / `wrap` / `pass` at the
  field's edges), `outsideEdge`, `touching` (box, circle, point), `overlaps(bodies, pairs)` by tag
  pair (a uniform-grid broad phase above 64 bodies), `inZone`, and the static index
  (`createStaticIndex` / `queryStatic` / `zonesOf`: a level's static shapes indexed once in a grid;
  `scanStatic` is the full scan it must agree with). `stepBody` is the one-body step the A4 server
  and a predicting device will share.
- **The loop** (`engine-game` `arcadeLoop.ts`, `createArcadeLoop`): every spawned instance of the
  game's spawn layers is a body (its component's shape, tags and edges from
  `GameConfigDoc.arcade.bodies`, else a point that moves and touches nothing). A frame runs the
  fixed steps its time holds — `step` → edges → `overlaps` → zones — then writes the bodies' new
  places to the live set and raises the queued Flow signals in order; Flow is never inside a step.
  Signals are edges: `collide {a, b, tagA, tagB}` when a configured pair starts touching,
  `leaveBounds {instance, edge}` when a `pass` body that was on the field is wholly off it,
  `enterZone` / `leaveZone {instance, zone}`. Actions `setVelocity`, `moveTo`, `setTag`, each aimed at
  an `instance` or at every body carrying `tagged`; values `$engine.random` and `randomX`
  (seeded), `fieldWidth`, `fieldHeight`. Its layers and its field are getters, read each frame and
  each step: a layer declared after the loop started is watched from then on, and the field follows
  the layout. A disposed loop runs no frame and no action revives it. The same loop runs in the game and in
  the headless gate.
- **The live set moves** (`engine-flow-v2` `spawn.ts`): `move(moves)` replaces each moved handle with
  one at its new place (so `$live` and `get` read where it is now) and tells `subscribePlaces`
  listeners once per layer; the set listeners are not told. `layers()` lists the declared layers.
  `<SpawnLayer>` keeps a `$state` place per moved instance, so a frame of motion re-draws only what
  moved.
- **Tags** (§5.2's Rive item): a body's tags come from its component's config body and change at run
  time with `setTag`; collision filters are tag pairs (`GameConfigDoc.arcade.pairs`); `tagged`
  aims an action at every carrier (the "spawnable group").
- **Config** (`game-config` `family.ts`, all optional, defaults dropped): a body's `edges`
  (absent ⇒ `clamp`), `arcade.pairs` (`[tagA, tagB][]`, one pair either way round) and
  `arcade.zones` (`{id, x, y, w, h}`, top-left, unique ids). `/config`'s Arcade section gains an
  Edges column, a Collisions field (`player + hazard, …`) and a Zones table (`familyDoc.ts`
  setters); the validator warns on a pair whose tag no body carries and a zone wholly off the field.
- **The mechanic:** `ARCADE_RULES_MECHANIC` (`id: 'arcade'`; no spin, bet, RGS session, wallet or board
  input) and a new `GameMechanic.playField` (false for every other mechanic). `mechanicFor` returns it
  for an arcade rules config; an RGS-decided arcade config stays `unplayable` (P10.10).
- **The runtime branch** (`apps/lines`): `Game.svelte` mounts `<ArcadeStage />` (in its own
  `MainContainer`) in place of the reel stack when `mechanic.playField`, and the reel stack exactly as
  before otherwise. `<ArcadeStage />` starts the loop once per page (`game/arcade.ts` `startArcade`:
  the baked config's arcade rules, the field — the config's, else the screen's design size — the
  declared spawn layers, `?arseed=` else `Math.random`), ticks it on the Pixi ticker and registers the
  determinism probe's `state().arcade`. The loop's actions and values reach the Flow runtime through
  the family registry (`flowBoardEffects.ts`: `registerBoardEffects`, new `registerBoardValues` /
  `boardValue`; the env's `engineRead` is `linesEngineReader(key) ?? boardValue(key)`), so the Flow
  runtime never imports the arcade module. Free play is P10.5's branch (`rgsSession: false`).
- **The vocabulary** (`engine-flow-v2` `reference/arcade.ts`, `ARCADE_VOCAB`, registered): the standard
  palette's load / tap / settings surfaces, sounds, camera and element FX; the four loop signals, the
  three loop actions (`ARCADE_LOOP_ACTIONS`), the enum `ArcadeEdge`, the three values. `onTick`,
  `onTimer`, `onInput`, the timers and spawning are P10.3 / P10.7 node kinds every vocabulary has.
- **The starter flow = the sample** (`reference/arcadeSeed.ts`, `DRIVEN_SEEDS.arcade`): a salmon
  dodger. The tap (and the loading screen's completion) start one round through the `startRound`
  timer; a round sets SCORE 0, LIVES 3, spawns the salmon and starts three repeating spawners (bears
  every 900 ms at 240 px/s, hooks 1400 ms at 380, fish 1700 ms at 200, at `$engine.randomX`
  above the field); the salmon starts at the middle of the field's bottom (from `fieldWidth` /
  `fieldHeight`), so the sample follows the field's size; ← / → (A / D) set the salmon's speed while
  held; `collide` with a `hazard` despawns it and takes a life, with a `pickup` despawns it and
  scores 10; `leaveBounds` despawns; when `lives` crosses 0 (`onVariable`, so two hazards in one
  frame end the round once) the spawners stop, `roundOver` holds until the tap, the field is swept
  (`forEach` over `$live.field`) and a new round starts.
- **Game Maker** offers `arcade` ("Arcade"): `engine-layout` has its full scene set
  (`referenceLayouts/arcade.ts`: loading, background, `basegame` = the spawn layer `field` at the
  origin, cap 48, `arcadeHud` = SCORE / LIVES Text Boxes fed `var:score` / `var:lives` at the top
  left, `roundOver`)
  and template (`templates/arcade.ts`). A new project is seeded with `arcade.rules.json` (bodies and pairs;
  no field size, so the field is the layout's design size), the scene set, the starter flow and the four placeholder components (`ARCADE_SAMPLE_COMPONENTS`, saved as the
  project's own, create-only, in `projectScaffold.ts`). No outcome question: arcade is free play only.
- **Publish:** `familyGate.ts` is not edited here. Since the publishing switch-on (below) it refuses
  a config only while `mechanicFor(…).unplayable`, so a free-play arcade config publishes (dealt the
  `freePlay` protocol) and an RGS-decided one is refused; `partnerRgsRefusal` and the delivery gate
  refuse any arcade game for a partner or a delivery, and the runtime refuses to boot a free-play
  game under any delivery profile (`<Authenticate freePlay>`, P10.5; `rgsSession: false`).
  `check:arcade-rules` pins all four.
- **Gates:** `check:arcade-motion` (root, 18 checks: the fixed step, the same state at 30 / 60 / 144
  fps and an uneven frame feed, the committed replay `fixtures/arcade-replay.json` (`--update`),
  clamp / wrap / pass and `outsideEdge`, touching by shape, overlap by tag pair (order, a = the tagA
  body, same-tag pairs once), the grid broad phase equal to the full test at 65 / 200 / 600 bodies and
  any cell size, zones, and the static index equal to a full scan over 1,700 shapes);
  `check:arcade-rules` (launcher, 75: the starter played headless on the real interpreter and loop —
  one round per tap, the spawners, steering and the edge, hazards, pickups, one signal per touch,
  falling off, the round over and again, two hazards in one frame ending it once, a layer declared
  after the loop started, a disposed loop, the field following a layout change, seed replay; the loop's pairs, `tagged`, `setTag`, zones,
  signal order, the live set's places; the mechanic; source scans that slots never mount or import
  it; the sample's pieces agree; the publish refusal). `family.fixture.ts` covers the new config
  fields. Re-pinned for arcade: `check:match3-rules` §8 (an RGS arcade config refuses to boot, a rules
  one boots), `check:flow-publish-gate` (arcade in the scaffold loops, with its sample components),
  `check:flow-spawn` and `check:flow-time-events` (the arcade starter is the one seed that spawns /
  the second that keeps state), `check:authored-freespins` (`drivenSeed.ts`'s pin: one import and
  one `DRIVEN_SEEDS` entry), `expandingSymbol.fixture.ts` (the arcade seed is a family seed),
  `check:flow-symbols-follow-config` (an arcade vocabulary has no symbol-typed surface; it keeps the
  empty `SymbolName` enum every vocabulary carries), the flow spike's `v2holdandwin` (the arcade
  actions and values are backed: `ARCADE_LOOP_ACTIONS` / `ARCADE_LOOP_VALUES`) and
  `check-stock-asset-coverage` (`transition` in `arcade.ts` is not an asset).
- **Verified by playing:** `scripts/playtest/arcade-play.mjs` on the branch runtime
  ([playtest/arcade-sample.md](../playtest/arcade-sample.md)): one salmon at the start; bears, hooks
  and fish falling; ← moved it 260 px in half a second and stopped on release; → held it at x = 1377;
  three hazards ended the round on `roundOver` (SCORE 10 from a fish on the way); nothing spawned while
  it held; its tap cleared the field and started again; the same seeds and keys on a second page
  reached the same bodies; on a portrait screen the salmon started at the portrait field's bottom
  centre (400, 1342); no request but the runtime and the snapshot; no page error.
- **Bundle size** (the release build's `index.html`; `main` at 5915171 vs this branch): 3,707,559 B /
  1,271,056 B gz → 3,726,583 B / 1,277,681 B gz: **+19.0 KB raw, +6.6 KB gz (+0.51 %)**, downloaded by
  every game, run by none but an arcade one. Static, by the owner's decision (P10.5); the per-family
  runtime build is the later fix.
- **Slot parity:** every new path is keyed on `mechanic.playField`, which only an arcade config
  sets; a slot's `Game.svelte` renders the reel stack exactly as before (the block moved into an
  `{:else}`), its engine reads answer as before (the family registry answers nothing until an arcade
  loop registers), and no slot layout has a spawn layer for `<SpawnLayer>`'s new place tracking.
  Edited shared modules: `Game.svelte`, `flowV2Runtime.svelte.ts` (the `engineRead` line),
  `flowBoardEffects.ts`, `determinism.ts` (the arcade probe), `spawn.ts` (`move`, `subscribePlaces`,
  `layers`), `SpawnLayer.svelte`, `mechanic.ts`, `game-config` `family.ts` / `familyValidate.ts`.
  The current-games harness is not edited.
- **Chosen in P10.8, owner may overturn** (the plan does not fix them):
  - **one PR**, not split;
  - the loop is `arcadeLoop.ts` (plain TS, no runes) rather than the plan's `arcadeLoop.svelte.ts`, so
    the headless gate runs the very file; the game's ticker and probe are `<ArcadeStage />`'s;
  - a body's `x` / `y` is its **centre**; a zone is a **top-left** rectangle; the field is the play
    field spawn layer's own space from its origin; the sample's components are drawn centred;
  - **every spawned instance is a body**; one whose component has no config body is a point that moves
    and never touches;
  - edges are a per-body **`clamp` (default) / `wrap` / `pass`**; a clamped body keeps its velocity at
    the edge; `leaveBounds` is only for `pass` bodies, and only once one that was on the field is
    wholly off it (spawning above the field to fall in is not leaving);
  - collision is opt-in by **tag pairs in the config** (`arcade.pairs`), not every tag against every
    tag; signals are **edges** (once per touch / entry / exit), raised **after** the frame, not
    awaited, in the order they happened;
  - actions aim at an **`instance`, else every body `tagged`**; `setTag`'s `on` defaults to true;
  - randomness is **`$engine.random`** and **`randomX`** (a spot across the field, because an
    `$engine` value inside a compute types as an int, which a spawn's float x refuses), seeded by `?arseed=` (else `Math.random`, itself seeded under
    `?ie_determinism=`); the runtime's engine read falls through to the family registry for a key the
    lines reader does not answer;
  - places are written **once per frame** (the last step's), not interpolated between steps;
  - the loop **outlives the play field's mount** (a screen change keeps the bodies) and stops
    stepping while the field is off screen;
  - the sample: placeholder shapes, keyboard steering, three lives, 10 points a fish, the spawner
    rates above, the round started through a 50 ms `startRound` timer (two entries ask; a timer
    restarted is one round);
  - the validation messages and the config's UI wording.
- **Not done here:** the Salmons art (owner follow-up: swap it in when S0 lands; this build read no
  R2); touch / pointer steering (the `pointer` controller, P10.11); `/flow-v2` Preview running the loop; solid response, behaviours
  and the camera (P10.11–P10.13).
- **Known limits** (none reachable by a slot game):
  - with no `arcade.field` (the seed names none) the field is the current layout's design size,
    read every step, so a rotated device moves the edges at once; bodies already placed keep
    their places (a clamped one is pulled inside the new edge, and a `pass` one now wholly beyond a
    narrower field has left it: it raises `leaveBounds` and the sample despawns it); the playtest
    plays desktop and boots portrait;
  - the place a body is drawn at is the last fixed step's, so motion can judder slightly when the
    display rate is not a multiple of the step rate;
  - a steering key held across the round's end does not steer the new round until it is pressed
    again (the round-over chain stops the salmon, and key repeats are not new presses);
  - an `onTick` / timer chain that spawns many bodies per frame is bounded by the layer's cap only.

**Publishing playable non-slot games (built 2026-10-25; in review).** The owner switched §9 #26
on. In one launcher-side PR:

- **The gate is on playability, not family.** `familyGate.ts` refuses a config only while
  `mechanicFor(config).unplayable` (`engine-game`) is set, the same answer that stops the runtime's
  boot. Match-3, rules or RGS, publishes now; arcade publishes once P10.8 declares its mechanic
  playable, with no change in the launcher. Same gate in the online publish and in the desktop
  bake's config export (`/api/game-config/doc`).
- **`freePlay`, a protocol for every rules game** (§6.3). The contract (`deriveMockContract`) deals
  a rules-decided config `freePlay`, whatever its kind, with no grid, so the publish's manifest
  entry and the test server's live re-read agree. The test server's `freePlay` mock refuses every
  request (`403 ERR_FREE_PLAY`; a CORS preflight still answers) and opens no session. It is in
  every protocol list: `MOCK_PROTOCOLS` in `testServerManifest.ts`, the test server's
  `MOCK_PROTOCOLS` / `protocolOf`, both publish scripts and `MAPPINGS` (`PUBLIC_RGS_GAME`). The
  project card's protocol-drift chip expects `freePlay` for a rules config. An RGS match-3 game
  keeps `match3`.
- **Delivery stays slot-only.** `scripts/delivery-family-gate.mjs` (used by `build-delivery.mjs`
  after the build or `--skip-build`, on the config the bake wrote; no override) passes only a slot.
  It refuses a rules game for any delivery profile, an RGS match-3 game until the partner wire
  exists (§9 #2), and every other family (it fails closed). The runtime's P10.5 refusal of a
  free-play game under a delivery profile is the second wall.
- **An RGS match-3 game never talks to a partner RGS.** Published, it has a stable URL, and the
  shared runtime's `?rgs_profile=` could point it at a partner. `<Authenticate mockOnly>` (passed
  `gameMechanic().interactiveRound` by `apps/lines`' layout) refuses it under any delivery profile
  before authenticate or replay, as the free-play branch does. Slots never set it. It refuses
  any partner **profile**; it is not "our test server only": the default profile still takes the
  launch URL's `?rgs_url=`, so a hand-built URL carrying a partner host and a partner session
  token would reach that host (CORS and the partner's own session rules stand in the way, not our
  code). Every partner launch we mint goes through `?rgs_profile=` and is refused.
- **No partner session is minted for a non-slot game.** `/api/partner-session` refuses (409) a
  card whose project config is not a slot (`partnerRgsRefusal` in `familyGate.ts`), or when R2
  fails the read, before it asks the partner's admin endpoint. No stored config reads as a slot,
  as the runtime plays it; a card with no project is not checked.
- **Can a rules game reach a real-money session?** Four walls: it never authenticates (P10.5,
  `rgsSession: false`); its runtime refuses a delivery profile at boot; the delivery build refuses
  it; and on our test server its mock refuses every request (the platform-jackpot wrapper is
  skipped for it too).
- **Not done:** §2.3 guarantee 1 also names "an operator session id" as a boot refusal for a rules
  game. The runtime checks only the delivery profile, so a default-profile URL carrying
  `?sessionID=` still free-plays. It never reaches an RGS, so no money moves; owner to decide
  whether to add the refusal or amend the wording. Predates this change.
- **Gates:** `check:game-config-family` (§4: match-3 publishes, the gate follows `mechanicFor()`),
  `check:mock-contract` (a rules config is dealt `freePlay`, an RGS match-3 keeps `match3`),
  `check:match3-wire` (every list knows `freePlay`, the mock refuses, the delivery gate's cases
  and that `build-delivery.mjs` calls it before packaging), `check:match3-rules` (the `mockOnly`
  wall).
- **Left as is:** the desktop profile (`derivePublishBlock`) still stamps `protocolFor(kind)`
  (`match3`), because it has no config; the test server's live re-read of the contract replaces it
  with `freePlay` for a rules game pinned to its project. The current-games harness is not edited:
  its `cg-match3` fixture keeps its own `lines` entry and drops the live link.

**P10.7 — Spawning (built 2026-10-25; merged, #1345).** §8's P10.7 row (§3.3), in one PR. No game uses
any of it yet.

- **The layout node** (`engine-layout` `types.ts`): `spawnLayer { spawnable: componentId[],
  placement: 'free'|'grid', grid?: {cols, rows, pitch}, cap? }`, in `LAYOUT_NODE_KINDS` (the save
  keeps it; `componentFields.ts` knows its four fields). Its fields are read defensively in
  `spawnLayerFields.ts` (`spawnableComponentIds`, `spawnLayerGrid`, `spawnLayerSpec`,
  `sceneSpawnLayers`); the caps live in `constants-shared/spawn.ts` (default 32, hard 256).
  `<SpawnLayer>` (from `LayoutNodeView`, under the node's transform) draws one `ComponentInstance`
  per live instance at its spawned place, keyed by its handle id.
- **The live set** (`engine-flow-v2` `spawn.ts`, `createSpawnStore`): pure, shared by the game, the
  `/flow-v2` preview and the gate. A spawn needs a declared layer that lists the component, room
  under its cap and, for a cell, a grid that holds it; anything else is refused, reported and
  dropped. `live(layer)` is a fresh array on every read. The game's one store is
  `engine-layout/svelte`'s `spawnStore()` (off the bare entry, which Node scripts load).
- **Flow** (`engine-flow-v2`): nodes `spawn {layer, componentId, at?: 'xy'|'cell'}` (data-ins x / y or
  col / row; data-outs `instance`, `spawned`), `despawn` (data-in `instance`), `instanceRef
  {componentId}` (the component's interface pins, plus data-in `instance` and data-out `handle`),
  a spawned `waitForState` (`componentId` set, handle on `instance`); the type `instance<component>`;
  the accessor `$live.<layer>` (`list<instance<…>>`); `$item.id / layer / componentId / x / y / col /
  row` over it. Pins and lookups in `spawnNodes.ts`; env hooks `spawn`, `despawn`,
  `liveInstances`, `spawnedRef` (`env.ts` passes them through). A spawned instance's raised event
  runs the `event:<e>` chain of the Instance ref of its component (`runFlowSpawnedEvent`,
  `flowOwnsSpawnedEvent`), with the raiser in `$trigger.instance`.
- **Validation** (`spawnValidate.ts`, judged only with the projection): `spawn-layer-unknown`
  (also a `$live` read), `spawn-not-spawnable`, `spawn-cell-free`, `spawn-handle-unfed` (a warning),
  `instance-missing` for a spawnable whose def is gone, and the instance checks for an Instance ref
  and a spawned wait (`instance-pin-missing`, `instance-state-unknown`, `instance-text-key`,
  `instance-event-duplicate`).
- **The game** (`apps/lines` `flowV2Runtime.svelte.ts`): only a doc that spawns
  (`flowUsesSpawn`) gets the live set — cleared, then every layer of the screens declared, so a
  spawn into one not on screen is kept. A handle is reached as a placement on its layer's screen
  (the shown container first), so the Phase 7 waits apply (a fire right after a spawn waits for the
  mount). A despawn forgets what was stashed for that instance (`dropFlowInstanceStash`). The
  boot's stock-asset prune (`stockAssets.ts`) walks every spawnable def.
- **Rule 8:** `collectComponentIds` collects every `spawnable`, so the doc bake, the runtime bundle,
  the art export and the harness's republish all ship them and what they nest. Invisible
  Localization harvests a spawnable's text (`harvestSceneText`) and the keys an Instance ref feeds
  it (`instanceTextKeys` over `placedInstanceTextSources` and `spawnedInstanceTextSources`), and a
  scaffold keeps a reference layout's spawn layer (`engineOwnedOnly`).
- **Launcher:** `projectSpawnLayers` (`flowV2Projection.ts`) feeds the `/flow-v2` loader, its
  validation and the publish gate. The Scene Editor inserts a Spawn layer on a screen (not in the
  Component Editor), draws it as a placeholder (its grid lattice or a dashed box, `⊕ name · N
  spawnable · cap C`) and edits its list, placement, grid and cap (`EditorSpawnLayer.svelte`).
  `/flow-v2` has a Spawning palette section, inspector fields, `$live` in the accessor picker and
  spawn / refused / despawn rows in Preview. Guides: [tools/invisible-editor.md](../tools/invisible-editor.md#spawn-layer--a-field-flow-fills-while-the-game-runs),
  [tools/flow.md](../tools/flow.md#spawning--create-and-remove-components-in-play).
- **Gates:** `check:flow-spawn` (launcher, 91: the live set and its cap, the cap through the
  interpreter, despawn inside `forEach` over `$live` with a fresh or a shared array, Instance ref
  sets / fires / events / wrong-component and empty handles, pins, `instance<…>` typing, every
  code, the preview, the ship walk, the localization harvest, the scaffold and the projection,
  parity scans); `check:art-scope` §7 (a component only a
  spawn layer lists has its art in scope and shipped, with a def it nests); `stockAssets.fixture.ts`
  (a stock frame a spawnable draws is kept). Two source-scan gates re-pinned to moved lines
  (`check:flow-instance-nodes`, `check:flow-instance-nodes-editor`).
- **Verified by playing:** `scripts/playtest/spawn-play.mjs` on the branch runtime (the match-3 rules
  sample plus a Spawn layer of cap 4 and four chains): coins spawned on a 300 ms tick, each one's
  `pop` reached the mounted instance, its `popped` event ran the Instance-ref chain that despawned
  it; rocks filled the layer and the cap refused the rest, never more than 4 live; the sweep
  (`forEach` over `$live`, Despawn) emptied it; no page error.
- **Bundle size** (the release build's `index.html`; `main` at 45164ec vs this branch merged with
  it): 3,694,259 B / 1,264,128 B gz → 3,701,791 B / 1,266,582 B gz: **+7.5 KB raw, +2.5 KB gz
  (+0.20 %)**, downloaded by every game, run by none that does not spawn.
- **Slot parity:** a doc with no spawn node and a layout with no `spawnLayer` behave as before: the
  game builds no live set and wires no spawn hook; `ownsInstanceEvent` / `dispatchInstanceEvent`
  take the old path; the `componentInstance` node's body moved into `applyInstance` unchanged; the
  instance-event edge lookup is generalised with the same result for a placed instance. Edited
  shared modules: `runtime.ts`, `pins.ts`, `validate.ts`, `triggers.ts`, `types-check.ts`,
  `env.ts`, `preview.ts`, `LayoutNodeView.svelte`, `collectComponentIds.ts`, `flowInstances.ts` (one
  added function), `flowV2Runtime.svelte.ts`, `stockAssets.ts`, `componentFields.ts`, the editor's
  canvas / outline / properties. The current-games harness is not edited.
- **Chosen in P10.7, owner may overturn** (the plan does not fix them):
  - **one PR**, not split;
  - a handle is a frozen snapshot `{ id, layer, componentId, x, y, col?, row? }`, its id
    `<layer>#<n>`, never reused; it does not move (motion is P10.8);
  - `instance` with no component is any instance and is assignable both ways, so a mixed live set
    feeds an Instance ref; at runtime an Instance ref or spawned wait skips a handle of another
    component;
  - cap default 32, hard 256; a refused spawn is dropped, warned once per layer / component /
    reason and traced; Spawn's `spawned` reads false;
  - grid cell (col, row) sits at (col × pitch, row × pitch), one square pitch; occupancy is not
    checked; x / y is allowed on a grid layer; an incomplete lattice places freely;
  - the live set is the session's, not the screen's: a spawn into a layer not on screen is kept;
    it is not reset per round; a new flow handle starts it empty;
  - an Instance ref's `instance` pin is optional (blank on its component's event chain = the
    raiser; a fed pin that resolves nothing, a refused Spawn's, addresses nothing); the first wire of a spawned component's event wins (`instance-event-duplicate`);
  - a spawnable's interface is its latest def's (a spawned instance pins no version);
  - a spawn layer belongs on a screen; one inside a component def is drawn but Flow cannot name it;
  - the validation codes' names; `spawn-handle-unfed` is a warning;
  - the editor UI: the Spawning palette section, `$live` and the pin-drop entries show only when a
    screen has a spawn layer, never in a function body; one Spawn entry per layer and component;
    a new Spawn's x / y start unset; grid cells drawn as squares centred on their spawn points; the
    free placeholder a nominal 320 × 200; no anchor on a spawn layer; switching to grid seeds 6 × 4
    at 120; no art preview of the spawnables; double-clicking an Instance ref opens nothing.
- **Not done here:** motion, tags and the arcade game (P10.8); `despawnOutsideView` (P10.12); the
  State machine tab / `/flow-v2` previews do not run a spawned instance's state machine, so a
  spawned instance's events never fire in Preview; no current-games fixture spawns.
- **Known limits** (none reachable by a current game):
  - a spawned instance remounted (its screen hidden and shown) restarts its state machine;
  - a component event payload field named `instance` is shadowed by the handle on its chain;
  - in a `parallel` `forEach`, a Spawn's outputs are the node's last run (as a function call's);
  - spawned instances stack in spawn order; there is no z per instance.

**P10.6 — Match-3, RGS-decided (built 2026-10-25; merged #1337).** §8's P10.6 row, in one PR.

- **The wire — ours, labelled** ([reference/match3-wire.md](../reference/match3-wire.md)): `bet`+
  `play` → `match3Board`; one stored `move {from, to}` per swap under the `gid` → `match3Move` (its
  steps, moves left, the settled board), with `match3End` + `gameEnd` on the move that ends the
  round; `collect` → `gameRoundOver`. Boot `config.match3 {wire: 1, minRun, moves}`. The protocol
  reference records it ("Ours, not theirs: the match-3 `move`").
- **The mock** (`scripts/mock-rgs-server-match3.mjs`): deals from the project's config
  (`game-config` `match3MockInputs` → the mock contract's `grid.match3`), board rules imported from
  `engine-mechanics/src/board.js`; fixed-at-bet math (`MATCH3_TOTAL_TABLE`, mean 0.96 of the stake;
  each step's pay capped at what is left; the refills steered from the strips; `match3End.settle`
  pays the remainder, so a round always pays exactly the total drawn); replay at an occupied `seq`;
  resume mid-round through the boot `config`; `force:<multiple>` for authoring channels only. The
  test-server Dockerfile copies it, `board.js` and `engine-mechanics/package.json`.
- **`match3` in every protocol list:** the test server's `MOCK_PROTOCOLS` and `makeMock` /
  `validGrid`; the launcher's `MOCK_PROTOCOLS`, `protocolFor('match3')`, the mock contract; both
  publish scripts; `MAPPINGS.match3` (identity) for `PUBLIC_RGS_GAME`.
- **The facade** (`rgs-translator-eagaming` `src/match3.ts`, `engineFacade.ts`): `requestMove`
  (`buildMoveAction`; the fetcher advances `seq` by one, no hand-written advance); the match-3 events
  → `boardInit`, `swap`, `tumbleBoard` + `updateTumbleWin` per step, `movesLeft`,
  `match3RoundEnd`; the round's stake kept per session for the moves' amounts; the bet's round
  returned open (no play-out, no auto-collect); a resumed round condensed to ONE `boardInit` (the
  last board, its moves, the running win, its end if it had one). Slot sessions take the old path
  untouched (only a boot config with `match3.wire === 1` switches any of it on).
- **Both transports export `requestMove`:** the stock `rgs-requests` answers `ERR_UNSUPPORTED` with
  no request, so the non-play4fun build compiles.
- **The interactive round** (`utils-xstate` `createPrimaryMachines`): two optional options,
  `checkIsInteractiveRound` / `onInteractiveRound`; such a round's bet type is `interactive`, whose
  end round always collects and updates the balance. `apps/lines` `actor.ts` marks a book with
  `boardInit` interactive and waits on `awaitMatch3Round()`. A slot passes neither (defaults: never
  interactive), so its machine runs exactly as before.
- **The mechanic:** `GameMechanic` gains `bets` and `interactiveRound`; `MATCH3_RGS_MECHANIC` is
  playable (`spins: false, bets: true, interactiveRound: true`). `runsIntent` reads `bets` (as it
  read `spins`) and refuses `autoSpin` / `buyBonus` (`CONTINUOUS_INTENTS`) for an interactive round;
  `EnableGameActor` starts a `BET` for any mechanic that bets and never an `AUTO_BET` for an
  interactive one; `Game.svelte`'s coded HUD and Space hotkey gate on `bets`, hold-to-spin on
  `bets && !interactiveRound`; the pre-spin roll stands down for a board that never spins. Every
  gate reads as before for `REELS_MECHANIC` (`spins` = `bets` = true).
- **The runtime** (`apps/lines` `match3.svelte.ts`): `boardInit` → a fresh `createMatch3RgsSession`
  (`engine-game`: a mirror built with `rng: null`; its deal, shuffle and resolve throw; the pre-check
  refuses a non-matching swap with no request; each move replayed locally with the server's refills,
  a difference logged as a wire bug and the server's board kept) under the same driver as free play,
  so the board's Flow signals are the same (`boardReady {moves, target: 0}`, `swap`, `match` /
  `cascadeStep` with 0 points, `settled`, `roundEnd {totalWin, reason}` in currency; never
  `noMoves`). The driver now awaits `trySwap` and plays an RGS move's `tail` (moves left, the round's
  end, the win) after `settled`. Input is taken only while a round is open.
- **Flow** (`engine-flow-v2`): `withOutcome(vocab, 'rgs')` drops `MATCH3_RULES_ONLY_ACTIONS`
  (identity otherwise, so every slot vocabulary resolves as before); a doc that still calls one gets
  `rules-only-in-rgs` (an error, so Publish refuses it); `composeFlowV2Vocab`, `/flow-v2`, the
  publish checks and the runtime compose with the config's outcome. The RGS starter
  (`match3RgsSeed.ts`): load → board, MOVES and the slot HUD; `boardReady` sets `movesLeft` and opens
  input; an accepted swap spends one; `roundEnd` locks the board.
- **Game Maker** asks "Who decides the result?" for `match3` (Real money (RGS) / Free play (rules),
  free play preselected); RGS seeds `match3.rgs.json` (one base bet mode, 3 / 4 / 5+ pays priced on
  the whole stake, 10 moves, RTP 0.96), the RGS scene set (`match3RgsReferenceLayout`: a 76 px board
  raised above the HUD, MOVES, `hudBar` / `hudCorners`) and the RGS starter flow. A caller that
  sends no outcome (the API, Director) gets the rules game as before. `familyGate.ts` still refuses
  every non-slot config, with its own message for an RGS match-3.
- **Gates:** `check:match3-wire` (root, in `check:rgs`: the real facade against the real mock —
  bet at seq 0, each move one stored action at the next seq under the gid, a server refusal changes
  nothing, the round takes its moves and is collected once, the heartbeat stands down, a re-post at
  an occupied seq replays and charges nothing, 25 rounds each settle exactly the drawn total; every
  protocol list knows `match3`; the table pays 0.96 — plus `match3.fixture.ts`, 55 translation
  checks over a scripted server: resends, resume, the stock transport); `check:match3-outcome-guard`
  (launcher, 79: `withOutcome`, `rules-only-in-rgs`, the RGS starter played headless, money
  variables, the mechanic, the mirror's no-RNG guard and wire-mismatch log, the driver over an RGS
  board, the round machine's wiring). `check:match3-rules` re-pinned to the new mechanic fields.
- **Verified by playing:** `scripts/playtest/match3-rgs-play.mjs` on the branch runtime against the
  real test server's mock (seed 7): Spin posted `[bet, play]` and the balance dropped by the stake;
  the server's board landed with MOVES 10; a non-matching swap posted nothing; 10 moves at seq 2–11
  under the gid; a reload after the third move resumed on the same board and moves; the server ended
  the round, one `collect`, the balance moved by exactly the round's total ($100 → $99 → $99.50); no
  page error. Playbook: [playtest/match3-sample.md](../playtest/match3-sample.md) R1–R5.
- **Bundle size** (the release build's `index.html`, which inlines the runtime; `main` at 82a484b vs
  this branch): 3,677,798 B / 1,261,162 B gz → 3,687,431 B / 1,264,207 B gz: **+9.6 KB raw, +3.0 KB
  gz (+0.26 %)**, downloaded by every game, run only by an RGS match-3 one. Static, by the owner's
  decision (P10.5 below); the per-family runtime build is the later fix.
- **Slot parity:** every new path is keyed on a match-3 config, a `match3` boot block or a
  `boardInit` book event, none of which a slot has. Edited shared runtime modules:
  `createPrimaryMachines.ts`, `actor.ts`, `EnableGameActor.svelte`, `Game.svelte`,
  `bookEventHandlerMap.ts` / `typesBookEvent.ts` (four new arms), `flowV2Runtime.svelte.ts`,
  `determinism.ts` (two probe fields), `engineFacade.ts`.
- **Chosen in P10.6, owner may overturn** (the plan does not fix them):
  - **one PR**, not split;
  - the book event that ends a round is **`match3RoundEnd`**, not the plan's `roundEnd`: a book
    event a v2 flow has a chain for is driven by the flow alone (event ownership), and every
    match-3 flow has a `roundEnd` chain, so the round never closed. The runtime raises the
    `roundEnd` signal itself, with the win in currency;
  - each move carries the server's **settled board** (`match3Move.board` → `movesLeft.board`), so
    the client mirrors it rather than trusting its own replay;
  - the mirror plays by the **server's `minRun`** (`boardInit.minRun`, from its boot `config`);
    a board that cannot be mirrored keeps the round open behind the error modal (a reload resumes
    it) rather than collecting a round nobody played, and a refused match-3 collect is an error;
  - the client **pre-checks** a swap on the server's board and sends nothing for one that cannot
    match (UX only; the server refuses it too, and a refused move is still stored);
  - the mock draws the total at the **`play`** of the opening request (where `force:` rides), reads
    the config's `match3.moves` as its own setting (10 when absent), refuses a second `bet` while a
    round is open (102), a `collect` before `match3End` (110) and a malformed `move` (101);
  - an RGS round has no score goal: `boardReady.target` is 0 and `match` / `settled` carry 0 points
    (money comes only from books);
  - the RGS scene set uses the **slot HUD** (`hudScenes()`): its Spin places the bet; its board is
    76 px cells raised 70 px so the bottom bar does not cover it;
  - Game Maker preselects **Free play**, and an absent outcome means rules (back-compat);
  - `movesLeft` reaches the HUD through the starter flow's variable (spent on each accepted swap,
    reset from `boardReady`), not a new engine value source.
- **Not done here:** switching publish on for a non-slot game (owner's call), live real money (the
  partner's match-3 wire, §9 #2), a current-games fixture for the RGS sample (it would edit the
  harness; the playtest script builds its own snapshot instead), `/flow-v2` Preview running an RGS
  board, a `ValidationPanelV2` icon for `rules-only-in-rgs` (falls back to ⚠).
- **Known limits** (none reachable by a slot game):
  - while a round is open the HUD Spin button reads STOP; pressing it slams the presentation;
  - a bonus buy is refused, not hidden (the RGS seed sells none); autoplay and hold-to-spin are
    switched off for an interactive round (`setUiFeatures`), so the HUD drops AUTO SPIN;
  - the scaffolded scene set's board is sized for the desktop layout; tablet / portrait keep the
    centred placement of the rules set;
  - the current-games harness's own `protocolFor` copy (`scripts/current-games/lib/plan.mjs`) still
    maps `match3` to `lines` (not edited: the harness is the owner's to change). No live game is a
    match-3 game, so nothing renders through it yet;
  - a match-3 game published before this shows the launcher's protocol-drift chip ("re-publish"):
    its entry says `lines`, the kind now maps to `match3`. None is published (publishing is off).

**P10.5 — Match-3, rules-decided, end to end (built 2026-10-24; merged #1332).** §8's P10.5 row, in
one PR (the vocabulary, the scene set, Game Maker and the gates move together: registering the
kind is what every scaffold gate loops over).

- **The mechanic, declared once** (game-type-templates Phase B): `engine-game` `mechanic.ts`,
  `mechanicFor(config)` → `GameMechanic` (`id`, `outcome`, `spins`, `rgsSession`, `wallet`,
  `boardInput`, `bookEvents`, `unplayable`). `REELS_MECHANIC` for every slot (and no config);
  `MATCH3_RULES_MECHANIC` (no spin, no RGS session, no wallet, board input);
  `MATCH3_RGS_MECHANIC` and an arcade config are `unplayable` until P10.6 / P10.8. The runtime
  asks only this (`apps/lines` `game/mechanic.ts` `gameMechanic()`).
- **The rules** (`engine-game`): `createMatch3Session(config, seed)` over P10.2's board module
  (deal from the config's strips, `trySwap`, `resolveNow`, `shuffle`, `hint`, the score) and
  `createMatch3Driver({ session, state, signal, present })`, which decides every move: input taken
  or refused, the order of the board's Flow signals, a queue for board work, and the flow's board
  actions. The runtime supplies only `present` (seat, swap, cascade step, mark); the headless gate
  supplies none, so both run the same code.
- **The runtime branch** (`apps/lines`):
  - `+layout.ts` stops an `unplayable` mechanic on the boot-failure screen
    (`refuseUnplayableBoot`); `+layout.svelte` passes `freePlay={!gameMechanic().rgsSession}` to
    `<Authenticate>` (`components-shared`), which then opens no RGS session — no authenticate, no
    balance poll — and refuses to run under any delivery profile (an operator's real-money embed).
  - `Game.svelte`: `mechanic.spins` gates the replacement Space spin hotkey, hold-to-spin and the
    coded HUD; `<Board/>`, `<TumbleBoard/>` and the flight layer stay mounted; `mechanic.boardInput`
    mounts `<Match3Input />` in the reel stack.
  - `<Match3Input />` (`components/Match3Input.svelte`): an invisible surface over the board in the
    board's own space; P10.4's `PointerGesture` feeds it; `getCellAt` picks the cell. A drag that
    travels 0.35 of a cell along an axis swaps with that neighbour (mid-drag); a release that never
    did is a tap: select, then a neighbour swaps. Mounting it starts the session.
  - `game/match3.svelte.ts`: the presenter — the swap on the flight layer (flight kind `swap`, the
    gem as the head in its `static` state, no trail: `flyTo`'s new `symbolState` / `trailless`
    options); each cascade step through `playBookEvents([tumbleBoard])` (the coded handler, with the
    step's cells one row down for the reel's top pad); a deal or shuffle seated with
    `boardSettle`; `select` / `hint` as symbol states. The board's signals go to the v2 flow.
  - `game/flowBoardEffects.ts`: the board actions reach the Flow runtime through a registry the
    session fills, so `flowV2Runtime` never imports the match-3 module.
- **The vocabulary** (`engine-flow-v2` `reference/match3.ts`, registered): the standard palette's
  load / tap-to-start / settings surfaces, sounds, camera and element FX, plus the board's signals
  `boardReady {moves, target}`, `swap {from, to, accepted}`, `match {groups, points, step}`,
  `cascadeStep {step, groups}`, `settled {steps, points}`, `noMoves`, `roundEnd` (RGS, P10.6), the
  actions `boardSelect`, `boardHint`, `boardSwap`, `boardSetInput`, `boardResolve`, `boardRefill`,
  `boardShuffle` (`MATCH3_RULES_ONLY_ACTIONS` names the last three for P10.6's
  `withOutcome('rgs')`), the seven tumble cues, the structs `Position` / `MatchGroup` and the enums
  `MatchShape` / `RoundEndReason`. No reel, spin, bet or payline surface.
- **The starter flow** (`reference/match3Seed.ts`, `DRIVEN_SEEDS.match3`): load → board + HUD;
  `boardReady` sets `score` / `movesLeft` / `target` and opens input; an accepted `swap` spends a
  move; `match` adds its points; `settled` checks the goal, then the moves left — a won or lost
  round locks the board, holds on `roundWon` / `roundLost` until the tap, then `boardRefill` deals
  the next round; `noMoves` shuffles.
- **Game Maker** offers `match3` ("Match-3"): `engine-layout` has its full scene set
  (`referenceLayouts/match3.ts`: loading, background, basegame = a 7 × 7 `reelGrid`, `match3Hud` =
  Text Boxes fed `var:score` / `var:movesLeft` / `var:target`, `roundWon` / `roundLost` = a dimmed
  tap-to-continue and its line) and template (`templates/match3.ts`). A new project is seeded with
  `match3.rules.json` (free play; 7 × 7, six gems, 20 moves, a 1500 goal, 50 / 120 / 250 for runs
  of 3 / 4 / 5), the scene set and the starter flow.
- **`/symbols`**: the `select` and `hint` columns, for a project whose `kindCapabilities()`
  `boardInput` (new; false for every slot) is on. `/win-text`: a rules-decided game gets "This
  game pays no money…" above its editor.
- **Publish** keeps refusing every non-slot config (`familyGate.ts`, owner's rule for this step);
  the message now says a free-play match-3 plays in the authoring preview but publishing a non-slot
  game is not switched on. Publish and `/flow-v2` validation now pass the config's outcome to the
  validator (P10.3's open item).
- **The harness and the sample:** the determinism probe reports `state().board` (`busy`, `moves`,
  `seed`, `cells`) and `cellPoint(reel, row)`; `play.mjs` gains `tap` and `swap` (`from` / `to`,
  or `legal: true|false` picked by `engine-mechanics`' own rules, `orUntil`), real mouse events at
  those pixels; `screens/match3.json` has 5 screens (`loaded`, `board`, `selected`, `refused`,
  `cascaded`). The fixtures write `cg-match3` from the three Game Maker seeds;
  `scripts/playtest/match3-play.mjs` plays a whole round on it and is the sample's launcher
  ([playtest/match3-sample.md](../playtest/match3-sample.md)).
- **Fixed on the way (P10.3):** `Game.svelte`'s Flow-state ticker effect read the Pixi ticker
  before Pixi's async init had made it and, the ticker not being reactive, never re-ran, so a flow
  built from a runtime bundle never flushed its variables. It is keyed on `stateApp.loaded` too.
  No live game declares a variable.
- **Gates:** `check:match3-rules` (42 checks: the starter game won and lost headless on the real
  interpreter, refused swaps, no moves, select / hint / input, seed replay, score, the mechanic,
  the free-play branch source-scanned, the vocabulary); `check:flow-publish-gate` moves `match3`
  into its scaffold loops (the starter flow passes against its scene set as a rules game) and
  limits add-on combos to slot kinds; `check:symbols-kind-gating` pins slot pickers and columns
  without `select` / `hint` and match-3's with them; `check:game-config-family` covers both
  publish refusals and `boardInput`.
- **Verified by playing:** `match3-play.mjs` on the branch runtime (board seed `sample-8`): a
  refused swap left the board as it was; 13 legal swipes reached the goal; the round-won screen
  held and locked the board; the tap dealt a fresh round (SCORE 0, MOVES 20); the page made no
  request but the runtime bundle; no page error. The harness's 5 `match3` screens rendered on the
  local fixture (both sides the branch runtime: no match-3 game is live).
- **Bundle size** (the release build, `index.html`, which inlines the runtime): main 3,644,234 B /
  1,247,187 B gzipped → branch 3,667,004 B / 1,255,211 B: **+22.8 KB raw, +8.0 KB gzipped
  (+0.6 %)**, downloaded by every game, run by none but a match-3 one. `bundle-modules.mjs` could
  not list the modules: the inline bundle strategy references a `.js.map` it never writes.
- **Slot parity:** for a slot (`REELS_MECHANIC`) every new gate reads as before — the spin hotkey,
  hold-to-spin and coded HUD conditions gain `mechanic.spins` (true); `<Authenticate>` gets
  `freePlay={false}`; `<Match3Input />` is never mounted; no board effect is registered; `select` /
  `hint` are in `SYMBOL_STATES` but never offered to a slot or set by one; the flight options are
  opt-in. Edited shared runtime modules: `Game.svelte`, `+layout.ts`, `+layout.svelte`,
  `Authenticate.svelte`, `editor-scenes.ts` (one added export), `flights.svelte.ts`,
  `FlightLayer.svelte`, `flowV2Runtime.svelte.ts`, `determinism.ts`, `stateGame.svelte.ts` (one
  export), `symbolStates.ts`, `symbolCell.ts`, `kindCapabilities.ts`.
- **Chosen in P10.5, owner may overturn** (the plan does not fix them):
  - **one PR**, not split;
  - the swap rides the **flight layer** (§4.1's first slice): the respin board's per-cell reels
    have no cascade, which is most of the value. The `swap` flight kind is not listed in
    `/symbols` → Flights yet, so its look is the coded default without a trail;
  - names: signals `boardReady`, `swap`, `match`, `cascadeStep`, `settled`, `noMoves`, `roundEnd`
    (the plan's `on…` are their pins' labels); actions camel-cased `boardSelect` … `boardShuffle`
    (the plan writes `board.select`); `boardSetInput` is new (a round's end must lock the board);
    `boardRefill` deals a whole new board (a new round), and `boardResolve` resolves what matches
    on the board now;
  - `match` fires per cascade step **before** its explosion with the step's points;
    `cascadeStep` **after** its refill landed;
  - **points** are the runtime's, from the config's score table: each group priced by its gem
    count (the longest run in the table at or under it; an L or T counts all its gems); no table
    pays 10 a gem. The starter flow only adds them;
  - `boardReady`'s `target` is the config's first **score** goal (0 for none); a collect goal is
    the author's to count from `match.groups`;
  - the starter's variables are `game`-scoped and reset by its `boardReady` chain (a match-3 round
    starts at a deal, not a spin press);
  - the board seed is `?m3seed=`, else `Math.random` (seeded under `?ie_determinism=`); a game is
    not saved or resumed in v1 (§P10.2: seed + moves would replay it);
  - flow board actions **queue** behind the move playing and are not awaited by the chain that
    called them (the `settled` and `noMoves` chains call them from inside the move);
    `boardSetInput` alone applies at once (a flag: the round-over chain locks the board while its
    screen holds, inside the move); `noMoves` is not raised when a new deal is already queued;
  - a config with **no Moves** has no limit: `boardReady` sends 0, the starter's `moveLimit` stays
    0 and its out-of-moves branch never fires, so only the goal ends a round. The starter HUD's
    MOVES readout then reads 0; such a project removes it in the Scene Editor;
  - a **shuffle** that no arrangement of the gems can make playable deals the board afresh
    (no `boardReady`: the round goes on); a deal that fails shows the error modal;
  - the **session outlives the board's mount**: a screen change that remounts the board re-seats
    the board the session has, never re-deals;
  - the **wager intents** (`spin`, `autoSpin`, `buyBonus`, `increase`, `decrease`) are no-ops for a
    mechanic that never spins (`engine-game` `runsIntent`), whatever reaches them: an authored HUD
    button, a flow intent such as `startSpin`, the Space key, and `EnableGameActor` starts no round
    (`BET` / `AUTO_BET`) for one, so a flow effect that sends `bet` (`commitBuyBonus`,
    `startAutoSpins`, not in `MATCH3_VOCAB`) cannot either;
  - a swipe swaps once it travels **0.35 of a cell** along one axis, mid-drag; a tap selects; the
    same cell again drops the selection;
  - unauthored, `select` draws the gem's **Win** art and `hint` its **Land** art; a new
    `kindCapabilities()` flag `boardInput` gates them (P10.1's `board` is true for slots);
  - free play refuses **any** delivery profile (`getDeliveryProfileSource() !== 'default'`): the
    game never mounts and `<Authenticate>` itself says why (the error modal lives inside the game);
  - Game Maker seeds only the **rules** outcome and asks nothing: RGS match-3 gets its seed with
    its mock (P10.6). `/config`'s Reel behaviour stays hidden for match-3 (P10.1): no switch reaches
    a board that never spins;
  - Win Text keeps its editor under the notice (hiding it would re-indent the whole slot page);
  - a custom kind stored as `match3` before it was built in is **hidden** behind the built-in, with
    a server-log warning, and never overwritten (every scaffold write is create-only). Nobody read
    R2 to check whether one exists (open item);
  - the `cg-match3` fixture's manifest entry names the `lines` protocol: the test server only
    serves the runtime, and the free-play branch never asks its mock.
- **Not done here:** `/flow-v2`'s Preview does not run the board module (§5.1: it still previews a
  match-3 flow's chains with no board); Game Maker's outcome question and the RGS seed (P10.6);
  listing the `swap` flight kind in `/symbols`; specials (P10.5b). `<Match3Input />` and the board
  module are imported statically, so every slot bundle carries them (+22.8 KB raw / +8.0 KB gz,
  +0.6 %) although none runs them. **Owner's decision (2026-10-25): accept the static cost now**
  (about 14.4 KB raw / 5.6 KB gz per slot bundle as measured then). A dynamic import cannot split it
  out: the release build inlines every dynamic import (`bundleStrategy: 'inline'` →
  `inlineDynamicImports`). **Later: a per-family runtime build** — `_runtime/match3` built with the
  match-3 branch, slots built without it through a build-time define and dead-code elimination
  (open item).
- **Known limits** (none reachable by a slot game):
  - the board under a swap shows the two gaps while the gems fly, and a refused swap's gems fly
    back the same way;
  - the stock symbols draw unauthored gems; the round screens' line is one Text Box at 64 px;
  - `noMoves` is hard to reach on the seed board (six gems, 7 × 7): the gate covers it headless;
  - the probe's `idle` stays true on a match-3 board (its round machine never runs); scripts wait
    on `boardBusy`;
  - a Text Box fed a number prints it with the integer fallback's grouping (1,500).

**P10.4 — Pointer move / drag / swipe + Align Target (built 2026-10-24; merged #1327).** §3.2's pointer
and board-cell bullets. No game uses any of it yet.

- **Format** (`packages/engine-layout/src/lib/types.ts`): `NODE_LISTENER_EVENTS` gains `move`,
  `dragStart`, `drag`, `dragEnd` and `swipe` (after the old five); a `swipe` listener may carry
  `swipe: { direction?: left|right|up|down, threshold? }` (`SWIPE_DIRECTIONS`,
  `DEFAULT_SWIPE_THRESHOLD` = 40). `LISTENER_ACTION_KINDS` gains `align`: Align Target,
  `{ kind: 'align', target, preserveOffset?: true, axis?: 'x'|'y' }`. `EventPayloadValue` gains
  `{ pointer: 'x'|'y'|'dx'|'dy' }` (`POINTER_PAYLOAD_FIELDS`).
- **The gesture** (`componentPointer.ts`, pure): `PointerGesture` turns one listening node's Pixi
  events into listener events, each with a reading (`PointerAt`: x / y in the instance's space,
  dx / dy from the press, the stage point). A press is `down`; once it moves `DRAG_SLOP` (4 instance
  px) it sends `dragStart`, then `drag` on every move of that pointer, anywhere; its release sends
  `dragEnd` (if it dragged) and offers `swipe`; a release over the node is `up`, as it always was.
  `move` is a move over the node. `swipeMatches` decides a swipe listener: the press-to-release
  distance reaches the threshold and the longer axis points the asked way (a tie is horizontal).
- **Wiring** (`LayoutNodeView.svelte`): the listener wrapper feeds the gesture from its five
  handlers, mapping `e.global` through the instance's space (`ComponentListen.local`, the placing
  node's container, from `ComponentInstance`). Only a node listening for `move` also gets
  `onpointermove`; only one listening for a drag or a swipe gets `onglobalpointermove` and
  `onpointerupoutside`, so a drag that leaves the node keeps tracking and ends off it (a `move`
  listener or a pointer payload also takes `onpointerupoutside`, so a press released off the node
  ends and later readings are back to dx / dy = 0). A new `down` on a node whose press is still on
  (a second finger, or a touch the browser cancelled: Pixi forwards no `pointercancel`) ends that
  press's drag where it was last heard, then takes over, so no drag is left open. Pixi hands
  `globalpointermove` twice to a container that is both hit and an ancestor of the hit, so the
  gesture drops a move to where it already was.
- **The dispatcher** (`componentEvents.ts`): `pointer(node, event, at?)` runs the event's listeners
  with the reading; a raise's `{ pointer }` value resolves from it (rounded into an `int` / `ms`
  field) and is empty where no pointer runs the raise (a state's On enter / exit, a cue). Align
  Target asks the host for its node (`alignTarget(id)` → `AlignSpace`) and places it on the pointer
  in the node's parent space; `preserveOffset` keeps the offset the node had when the action first
  runs in a press (`PointerAt.press`, a serial unique across nodes); `axis` moves one axis. A
  target node that unmounts detaches itself; where the pointer put it is kept, so a remounted
  target comes back there. `ComponentInstance` keeps the
  placements (`$state`), and a target node's `LayoutNodeView` reads its placement into its position
  (`setComponentAlign` / `getComponentAlign`, provided only when the def aligns something, or to hide
  an outer instance's from a nested def).
- **Validation:** `raise-payload-pointer` (not a reading, or on a raise no pointer runs),
  `listener-align-target` (a node outside the def, or its root), `listener-swipe` (a bad direction
  or threshold).
- **Launcher:** the reader (`componentEventRows.ts`) reads the new events, `align`, `{ pointer }`
  and a swipe listener's filter, and drops a malformed row whole, which the keep-unknown save puts
  back (`componentFields.ts` knows `swipe`). The editor (`EditorListeners.svelte`,
  `EditorRaisePayload.svelte`, `listenerEdit.ts`): the five new events, the swipe row (direction,
  threshold), the _align target_ action (node, keep offset, axis), and pointer x / y / dx / dy for a
  number field on a listener's raise.
- **Board cell input** (`packages/engine-game/src/game/gameState.svelte.ts`): `getCellAt(x, y)`
  (board-local) → `{ reel, row }` or `undefined`, the inverse of `getSymbolSeat`: the cell whose
  pitch box (its seat with the art alignment taken out, a column pitch by a row pitch, at the row's
  scale) holds the point. The box follows the seat, not the mask's window, so a perspective board
  with a row lead other than 0.5 can leave a sliver between rows that is no cell. Exported from `createGameState`; no caller until `<Match3Input />` (P10.5).
- **Gate `check:component-pointer-drag`** (`apps/launcher-api/scripts/`, run by `check:all`), 76
  checks: the gesture, the swipe filter, the dispatcher and Align Target, real Pixi (`EventBoundary`,
  a drag leaving the node), validation, the reader and the editor edits, the cell hit-test sliced
  from the real `gameState` over flat, gapped, non-square, led, aligned, stepped and perspective
  lattices, and parity scans. `check:component-listeners-events`' wiring scan now reads the gesture
  handlers; `check:component-listeners-events-editor`'s empty-def default is now Align Target;
  `check:save-keeps-unknown-blocks`' unknown pointer event is `pinch` (it was `swipe`).
- **Slot parity:** a def with no new event, `align` or `{ pointer }` behaves as before: the old five
  events still fire on the same Pixi events, in the same order (the reading they now carry is read
  by nothing); a wrapper gets no new handler; no node reads an Align placement; no built-in uses any
  of it. `getCellAt` has no caller. Edited shared modules: `LayoutNodeView.svelte`,
  `ComponentInstance.svelte`, `componentEvents.ts`, `componentListenerContext.ts`,
  `gameState.svelte.ts` (one added function). Reviewed by `code-reviewer`: no parity blocker; its
  findings in the new features (a stale `preserveOffset` across presses, a press left open by a
  second finger, a cancelled touch or a release off a `move`-only node, a detached target still
  reachable) are fixed and gated.
- **Chosen in P10.4, owner may overturn** (the plan does not fix them):
  - x / y are in the **instance's space** (its root's), dx / dy from the **press point** (0 with no
    press); a pointer reading into an `int` / `ms` field is **rounded**;
  - a drag starts after a **4 px slop** (instance px), `dragStart` carrying the reading at that
    move, and the same move also sends the first `drag`;
  - the swipe's direction and threshold live **on the listener** (`swipe`), the threshold in
    instance px, **default 40**; a swipe is offered on **every release** of a press (dragged or
    not), with no time limit; the longer axis decides and a tie is horizontal;
  - `move` is a move **over the node** (`pointermove`), not anywhere; a tap still ends in a click,
    and so does a drag released over the node (Pixi's tap);
  - Align Target takes **`axis`** (x / y) beside Rive's `preserveOffset`, for sliders and paddles;
    its placement **replaces** the node's x / y (a value binding or timeline on that axis no longer
    moves it) and lasts until the instance remounts; the offset is taken at the action's **first run
    in each press**; the **root** cannot be a target;
  - a **new press** on a node whose press is still on takes over, ending the open drag first;
  - a new listener on a def with no input and no event **aligns its own node** (it used to start as
    an empty _fire_);
  - the hit-test's cell is the **pitch box** (a gap belongs to the nearer cell), visible cells only;
  - the validation codes' names.
- **Not done here:** the State machine tab's stage preview (`listenerPreview.ts` / `EditorCanvas`
  `onStagePointer`) plays only the old five: drag, move, swipe and Align Target run in the game
  only; `/flow-v2`'s preview scripts no pointer (open, with its key scripting); the match-3 swap from
  a drag (P10.5).
- **Known limits** (none reachable by a current game):
  - one press per node at a time: a second finger on a node ends the first finger's drag and drags
    in its place;
  - a touch the browser cancels mid-drag gets its `dragEnd` only at the node's next `down` (Pixi 8
    forwards no `pointercancel`; a native listener on the canvas would close it);
  - Align Target has no bounds; a slider's clamp is Flow's (from the drag's x) until it has one;
  - an Align Target maps through its parent's transform at the moment of the event, so a parent
    that moves during a drag moves the node with it until the next move.

**P10.3 — Flow variables, timers, tick (built 2026-10-24; merged #1326).** §3.1 + §3.2 (tick,
timers, keys).

- **Format** (`packages/engine-flow-v2/src/types.ts`): `FlowDoc.variables` (`game` / `round`),
  `FlowModeScope.variables` (`mode`), `FlowDoc.inputs` (the key map), the accessor `$var.<id>`,
  and nine node kinds: `setVariable`, `changeVariable` (`add` / `sub` / `toggle`, `min` / `max`),
  `onVariable` (`changed` / `crosses` a threshold, up / down / either), `onTick { every? }`,
  `startTimer { timer, repeat }` (data-in `ms`), `stopTimer`, `pauseTimer` (exec-ins `pause` /
  `resume`), `onTimer`, `onInput { action, phase }`. Pins in `pins.ts`.
- **The store** (`src/state.ts`, `createFlowState`): one per session, outside the interpreter,
  reached as `FlowV2Env.state`. A write applies at the node; a wrong kind is dropped; `round`
  variables reset on `resetRound`, a mode's on `enterMode(id)`; a reset is a write. Writes are
  delivered once per frame (`flush`): each `var:<id>` subscriber hears its variable once, and the
  batch runs the `onVariable` entries (`variableEntries`: `changed` once with the latest value,
  `crosses` per crossing write). Timers and ticks advance only through `advance(dtMs)`. One frame
  is `stepFlowState`, which the game's ticker and the preview both run: first the writes since the
  last frame go out, then the timers and ticks due run, all at the frame's moment. A write any of
  those chains makes goes out with the next frame.
- **Entries** (`runFlowStateEntry`): timer, tick and key entries run on the active mode's graph
  when it has one, else the global graph (the signal rule); a variables batch is split per variable
  by the same rule. A chain that throws is reported once per session.
- **Game side** (`apps/lines`): `createLinesFlowV2` builds a store only when `flowUsesState(doc)`;
  it registers each variable as the value source `var:<id>` (a bool as 1 / 0), listens for mapped
  keys (not while typing in a field, no key-repeat), and resets a mode's variables on its `enter`
  transition. `tickFlowV2State` (holder) runs from one ticker callback that `Game.svelte` adds only
  when the handle has a store, so timers stop when the game stops ticking. `resetFlowV2Round` runs
  in `actor.ts` `onNewGameStart`.
- **`source` widened to bool / text:** `<ComponentInstance>` subscribes a bool (to the state
  machine, from on / off or 1 / 0) and a text input (to the Flow handle's text input) with a
  `source`, as it did a number; the launcher normalizer (`componentStorage.ts`) and
  `setInputSource` keep it on all three. The Component Editor's input row shows its "from" field on
  bool and text rows too and suggests the project's flow variables (`/editor` loads them).
- **Preview** (`src/preview.ts`): a doc that uses state runs on a virtual-time event queue (60 fps
  frames running `stepFlowState`, Delays as queue waits, scripted keys; the clock never runs back; a
  horizon, default 5000 ms, held to 60 s). A doc with none keeps the single-chain clock unchanged.
  The `/flow-v2` panel scripts no keys yet, so On input chains do not run there.
- **Validator** (`src/variableValidate.ts`): `variable-unknown`, `variable-type`, `variable-scope`,
  `variable-duplicate`, `variable-shadows-money`, `tick-async`, `tick-fast`, `input-unknown`.
  `validateFlowDoc` takes an optional `outcome` (absent ⇒ RGS).
- **`/flow-v2`:** the Variables panel (`VariablesPanelV2.svelte`, with the key map on the Global
  tab), the _Variables & time_ palette group, inspector fields, `$var` in the accessor picker, the
  new codes in Validation, and the preview's horizon and _No event_ run.
- **Gates:** `check:flow-variables` (42 checks) and `check:flow-time-events` (35 checks), both run
  by `check:all`; `envFactory.fixture.ts` learns the `state` capability.
- **Slot parity:** a doc with no variable, key map or state node gets no store, no value source, no
  key listener and no ticker callback, previews on the old clock, and gets no new issue (no
  committed seed does). Edited shared modules: `Game.svelte` (the gated ticker effect), `actor.ts`
  (the round reset, a no-op without a store), `flowV2Runtime.svelte.ts`, `flowV2InterpreterHolder.ts`,
  `ComponentInstance.svelte`, and the `engine-flow-v2` interpreter.
- **Chosen in P10.3, owner may overturn** (the coordinator accepted them for now, 2026-10-24):
  - `variable-shadows-money` flags a variable named `balance` / `win` / `totalWin` / `bet`, and a
    variable fed (directly or through a compute) to `amount` on `setWinBookEventAmount`,
    `setBetAmount`, `winUpdate`, `freeSpinOutroCountUp` or `showMessage`, in an RGS game;
  - Pause Timer has `pause` and `resume` inlets; starting a running timer restarts it;
  - an `enum` variable is `{ type: 'enum', values }`, a string on the wire;
  - the input-row picker is a suggestion list on the free-text field;
  - a round starts at `onNewGameStart` (the spin press);
  - `onVariable` fires once per frame, not inside the writing chain; `tick-fast` also warns on an
    every-frame tick; `variable-duplicate` and `input-unknown` are codes the plan did not name.
- **Not done here:** the Data tab (9d); per-frame work belongs to the mechanic (P10.8).
- **Known limits** (none reachable by a current game):
  - an `onVariable` chain that keeps changing its own variable re-runs once a frame, for good;
    nothing flags it yet;
  - a text input on a component nested inside another component does not follow a `var:` source
    (only a top-level placement has the Flow handle that keeps text); nothing draws a text input yet;
  - a timer started mid-frame counts from the next frame (up to 16.7 ms late); a mode's `onTick`
    with `every` keeps counting while its mode is off screen, so its first fire on entry can be early;
  - renaming a variable rewrites this doc's nodes, not a component's `var:<id>` source or a shared
    library function;
  - Publish validates without an `outcome`, so a future rules-decided game would get
    `variable-shadows-money`: pass the config's outcome to `validateFlowDoc` in P10.5.

**P10.2 — the board module (built 2026-10-23; merged #1323).** A new dependency-free package,
`packages/engine-mechanics` (§4.0): `src/board.js`, plain ESM with no imports, and its hand-written
`src/board.d.ts`, re-exported by `index.ts` as `engine-cinematic` does. **No caller yet**, so no
game, bundle or screen changes.

- **The rule set (§4.1):** `createBoard`, `canSwap`, `swap`, `findMatches` (row and column runs of
  `minRun`+, merged into `L` / `T`; a lone run is `line2`–`line5`, `line5` meaning five or more),
  `clear`, `gravity` (with the falls), `refill`, `resolve` (the cascade loop), `findMoves` /
  `hasMoves`, `shuffle`, and `createRng` (mulberry32; a string seed is hashed).
- **The grid is the slot board's:** column-major `cells[reel][row]`, row 0 at the top, gems shaped
  as `RawSymbol`. Each `resolve` step carries a `tumbleBoard` event (no `index`) whose
  `newSymbols[reel]` are the gems dropped into that column top first, exactly as the mock RGS's
  cascade sends them, beside its match groups and falls.
- **Refill sources:** `'pool'` reads the column's strip (`paddingReels`) from a seeded stop, as a
  reel strip is read, wrapping; or a book's `newSymbols`, which must fit the holes exactly.
  `resolve` takes either, one book refill per step, so an RGS board can mirror the server's chain.
- **The RGS guard (§2.2 #1):** a board built with `rng: null` (the default) throws on any deal,
  pool refill or shuffle, even one handed an rng; it takes gems only from given cells and the book.
  A book whose refills outnumber or fall short of the local chain throws too: that is the
  client/server mismatch §2.2 #4 logs.
- **Replay is seed + moves.** The rng is one closure shared by every board derived from the first,
  and its state cannot be saved, so a rules game resumes by replaying from its seed. P10.5 decides
  whether a saved game needs more.
- **Choices this build made** (the plan does not fix them; easy to change before P10.5 calls it):
  - a **dealt board** has no match and at least one move (up to 200 seeded deals, then it throws:
    the strips cannot make a playable board); `shuffle` keeps the same promise;
  - `canSwap` needs the match to **take in one of the two swapped gems**, so a swap beside a run
    that is already on the board is not a move;
  - `resolve` stops after 100 steps and throws (a runaway chain is a strips problem); `refill`
    throws when a hole sits below a gem (gravity has not run);
  - `findMoves` (every legal swap, each pair once) is exported because `board.hint()` needs one.
- **Gate `check:board-mechanic`** (`scripts/check-board-mechanic.mjs`, run by `check:all`): 32
  checks over drawn grids: runs, line shapes, `L` / `T`, `minRun`; legal and illegal swaps;
  gravity's falls; book and pool refills; a chain fed by refills and one made by falls alone; the
  RGS mirror (a pool chain replayed on an `rng: null` board from its own `newSymbols` gives the
  same steps and board); `hasMoves`; shuffle; the deal; malformed input. Three scripted sessions
  (two 7 × 6, one 5 × 5 that dead-ends and shuffles) replay identically and match the committed
  trace, `packages/engine-mechanics/fixtures/board-replay.json` (`--update` rewrites it).
- **Not done here, by plan:** the mock's import and the test-server Dockerfile lines (P10.6), the
  `MATCH3_VOCAB` nodes and any runtime caller (P10.5), specials (P10.5b).

**P10.1b — tools per family (built 2026-10-23; merged in #1324).** §6.5.

- **The list:** `FAMILY_TOOLS` beside `TOOLS` in `apps/launcher-api/src/lib/roles.ts` names the
  tools a family does **not** use: slot and match-3 nothing, arcade Symbols and Win Text. A
  project's family is `projectFamily(key, gameType)` (`lib/server/projects.ts`): `familyOfKind()`
  of its recorded kind, and always a slot for the shared `cloud` scope.
- **Home and tool bar:** `(app)/+layout.server.ts` drops the hidden tools from `tools` (which feeds
  the home grid and `ToolTopBar`) and returns `family`. It reads the family of the page's
  `?project=` when the user may reach it, else of the session's project, because the page syncs
  `?project=` into the session only after the layout has run. The read is tracked, so a
  client-side hop to another project's `?project=` re-runs the layout (and only that param does).
  Onboarding keeps the role's whole manifest: it describes what a role may use.
- **The notice:** `(app)/+layout.svelte` renders "<tool> is not used by arcade games", names the
  project, and links home, in place of the page when the URL is a hidden tool's (`familyHiddenToolAt`). The tool's own
  load still runs; nothing renders from it.
- **Director:** `ADAPTER_TOOL_IDS` (`director/adapter.ts`) maps each adapter tool to its launcher
  tool, and `buildRegistry` refuses an op whose tool maps to none. The gate refuses an op on a tool
  the project's family hides with 403 `not_for_family`, after the scope check.
- **Slot parity:** for every role, a slot, legacy (no kind), custom-kind and `cloud` project gets
  exactly `manifestForRole`, and a slot page renders exactly its children.
- **Verified:** `check:family-tools` (151 checks: the list, the real layout load per role and
  family, onboarding, the real layout server-rendered, the real gate), and `check:director-adapters` with its
  fixture op moved onto a mapped tool.
- **Not built here:** Win Text's own "this game pays no money" message for a rules-decided match-3
  game (§6.5's outcome bullet) is not in §8's P10.1b row; it waits for a match-3 project to exist
  (P10.5, which added it).

**P10.1 — family and outcome in Game Config (built 2026-10-23; merged #1310).**

- **Schema** (`packages/game-config`): four optional fields on `GameConfigDoc`: `family`
  (`match3` / `arcade`; absent ⇒ a slot), `outcome` (`rules`; absent ⇒ `rgs`), and the
  `match3` / `arcade` blocks (`src/family.ts`). The win model gains a fifth arm,
  `{ type: 'match3', minRun }`, which is never stored: `resolveWinModel()` builds it from
  `match3.minRun` for any match-3 doc (§9 #20).
- **Resolvers:** `resolveFamily`, `resolveOutcome` (a slot is always `rgs`), `resolveMatch3`,
  `resolveArcade`. No code reads the raw fields.
- **The normalizer** learns the fields and drops every default: `family: 'slot'`, `outcome: 'rgs'`,
  `minRun: 3`, `fixedHz: 60`, empty blocks, `outcome` on a slot, a block beside the wrong family,
  and a match-3 doc's `winModel` and `cascade`. An arcade doc normalizes with no symbols or strips.
- **Validation follows the family** through one table, `configSectionsFor(family, outcome)`
  (`src/familySections.ts`): each existing check runs only where its `/config` section shows, so
  a slot is checked exactly as before. New checks (`src/familyValidate.ts`):
  - match-3: a rectangular board, and a min run that fits it;
  - match-3 rules: no moves warns, an unreachable goal is refused, a score row below the min run
    warns; an empty `betModes` is allowed;
  - arcade: an RGS-decided arcade game is refused (§9 #21), and a rate outside 30–240 Hz warns.
- **`/config`** reads the same table: a slot project's page is unchanged and has no picker. A
  project whose kind or config is a non-slot family gets **Game family** (family + outcome) and
  the **Match-3** or **Arcade** section (`FamilySection.svelte`, setters in `familyDoc.ts`).
- **`GAME_KINDS`** gains `match3` and `arcade`, with `SLOT_GAME_KINDS`, `GAME_FAMILIES` and
  `familyOfKind()` beside it (pulled forward from P10.1b, §9 #27). The slot-only consumers derive
  from `SLOT_GAME_KINDS`: the Scene Editor's template-type picker, the flow-vocabulary generator and
  game-spec's schema. Game Maker still offers neither kind: it needs a full scene set (P10.5).
- **`kindCapabilities`** takes `family` / `outcome` and gains `wallet`, `betControls` and `board`
  (all `true` for a slot). A match-3 or arcade project is offered none of a slot's sections.
  `projectAddOns()` passes a non-slot config's family and outcome to it, so the tools follow the
  config as `/config` does; a slot config adds neither.
- **The family gate:** the online publish and the desktop bake's config export
  (`/api/game-config/doc`) refuse a non-slot config, with no override, until its runtime exists
  (§9 #26). Since 2026-10-25 it refuses only an unplayable one (above).

**Verified (2026-10-23):**

- `family.fixture.ts`, `check:family-defaults-identity` (every shipped config; 26 normalize, the
  cluster sample's is refused as before), `check:game-config-family`
  (setters vs normalizer; the page server-rendered per family), plus the existing
  `check:symbols-kind-gating` and `check:flow-publish-gate`, moved to the slot kinds.
- Against `main`, by hand:
  - `main`'s own normalizer and validator over 28 shipped configs (the same corpus plus the
    number-picker and price apps): 0 differences.
  - `/config` server-rendered on both sides for seven slot seeds: the same text and markup.
  - The diff runs Prettier over `+page.svelte`. With whitespace ignored, it adds only the `{#if}`
    gates and the family markup.

## Open items / next

0. **P10.14 follow-ups:** (a) the **bundle cost** (+59 KB gz for every game; owner): accept it as
   static until the per-family runtime build (item 9), or ship the SDK as a separate file only an
   online game fetches; (b) the **publish** writes `rooms_url` into an online game's launch URL and
   a **published** online config where the game server reads it (§9 "read from the same published
   snapshot"), and refuses an online game with no server address (§10); (c) a `/config` section for
   `arcade.online`; (d) the Railway service and DNS (owner, INFRA steps), then the `deploy-drift`
   entry; (e) a **read-only config token** for the game server — the interim source puts the
   launcher's deploy token in its env, which can do more than read configs.
1. **Live real-money match-3** waits on a real provider's match-3 wire (§9 #2); our wire
   (`docs/reference/match3-wire.md`) and its facade mapping are rewritten when one arrives.
2. **Delivering a non-slot game** stays off: a rules game never (no wallet), an RGS match-3 game
   once the partner wire exists (§9 #2). Publishing to our test server is on (2026-10-25).
3. `/flow-v2` Preview running the board module on its virtual clock with a seed (§5.1).
4. The `swap` flight kind in `/symbols` → Flights, so its look is authorable.
5. The State machine tab's stage preview and the `/flow-v2` preview do not yet drive drag, move,
   swipe or Align Target (P10.4's "Not done here").
6. **Confirm no custom kind is named `match3` or `arcade`** in R2 (`_shared/editor-kinds/`). Either
   is now hidden behind its built-in (and warned about in the launcher log, never overwritten).
   Needs R2 access, which neither build had.
7. The runtime still prices and draws the `match3` arm as the lines default (`payoutDivisor`,
   `winLineShapeFor`). An RGS match-3 game never reads either (its wins are the server's amounts,
   presented by the cascade, with no win lines), so P10.6 left them; honour the arm (divisor 1) if
   anything starts reading it.
8. **A per-family runtime build** (owner, 2026-10-25, later): `_runtime/match3` built with the
   match-3 branch, slot runtimes built without it (a build-time define + dead-code elimination), so
   slot bundles stop carrying the match-3 code (P10.5 + P10.6: about +24 KB raw / +8.6 KB gz) and the
   arcade code (P10.8: +19.0 KB raw / +6.6 KB gz; P10.12: +8.9 KB raw / +3.0 KB gz).
9. Add the RGS sample as a current-games fixture (`cg-match3-rgs`) and the harness's `protocolFor`
    copy, in a harness change the owner reviews; likewise an arcade fixture (`cg-arcade`), which
    needs a key-press step in the screen-script format.
10. **Swap the Salmons art into the arcade sample** (owner): the sample draws placeholder shapes. When
    the Salmons art pass (S0) lands, re-skin `arcadeSalmon` / `arcadeBear` / `arcadeHook` /
    `arcadeFish` (or a Salmons project's own components) in the Component Editor and size the config
    bodies to the art.
11. Touch steering for the P10.8 sample: the controllers exist (P10.11); the sample keeps its Flow
    steering until it is given a character.
12. **The isometric projection and ground-depth order** (§9 #19 places it in P10.12; the §8 row
    and the P10.12 brief did not): the next arcade piece Salmons needs, before or with P10.13.
13. `playCinematic` holding the arcade camera for a cutscene and handing it back (§4.4).
14. Abilities (hit zones, cooldowns, `onHit`) and zone forces (§4.3), left out of P10.11.

## Blocked (owner / external)

- The A4 design, [realtime-multiplayer.md](../design/realtime-multiplayer.md), is approved
  (2026-10-25), which settles §9 #18. **P10.14 is built; the owner stands up the `game-server`
  Railway service and the `rooms.invisiblewall.org` DNS record** (its §14 #8) — the settings are in
  [INFRA.md](../INFRA.md) "Invisible Game Server".

## Recent changes

- 2026-10-27 — **Card C2 built: the AI** (`engine-mechanics` `cardAi.js`, `check:card-ai`), and the
  two design points C1 raised fixed in card-games.md. No caller, no game changes. Detail above.
- 2026-10-27 — **Card C1 built: the rules engine** (`engine-mechanics` `cards.js`, `rngNext` in
  `board.js`, `check:card-rules`, `check:card-library`). No caller, no game changes. Detail above.
- 2026-10-27 — **Game repo builds fixed after P10.14.** #1375 declared `@colyseus/sdk` in
  `apps/lines` only. A standalone game repo installs from its own root `package.json` (copied at
  scaffold), and the desktop launcher backfills engine workspace packages but never a third-party
  one, so every game repo's ☁ Publish failed with `Rollup failed to resolve import
  "@colyseus/sdk"`, online game or not. The SDK now lives in the new `packages/engine-rooms`
  workspace package (`online.ts` imports it, still dynamically), which the backfill declares and
  the workspace installs. New Lint gate `check:game-app-deps`: `apps/lines` may declare only the
  third-party packages game repos already carry. Proved on a scaffold from the pre-#1375 engine:
  on `main` the build fails with the reported error; on the fix, after the launcher's backfill,
  `vite build` exits 0. `check:room-sim` now pins the import through `engine-rooms`.
- 2026-10-27 — **Card family design written and approved** (owner, the same day: all seven §13
  decisions as recommended): [card-games.md](../design/card-games.md). The rules engine
  (`cards.js`), effects as data from closed lists, a seeded on-device AI, the card frame, card data
  in Game Config, Invisible Card Library (`/cards`), the ship chain, the `card` family, build steps
  C1–C5 with gates. Docs only.
- 2026-10-26 — **P10.14 built: the game server (A4a).** `services/game-server` on Colyseus 0.18,
  rooms with join / leave / rejoin, inputs only, `GameConfigDoc.arcade.online`,
  `ARCADE_ONLINE_MECHANIC` and the runtime's online branch, `check:room-sim`, an online playtest.
  Not deployed. Detail above.
- 2026-10-26 — **P10.11 built: arcade characters.** Brains (`behaviours.js`), controllers, solid
  response, paths, `animInputs`, 1D blend states, the `path` node, and the new **Invisible
  Characters** tool (arcade only); a guard sample as a fixture. Detail above.
- 2026-10-26 — **P10.12 built: the arcade world and camera.** `camera.js`, `Scene.world` /
  `Scene.camera`, parallax, `despawnOutsideView`, culling, the camera Flow nodes and keys, the
  `/editor` fields, a scrolling river sample, `check:arcade-camera`. Detail above.
- 2026-10-26 — **P10.9b built: rulers and guides** (in review, #1368). Detail in
  [editor status](editor.md) 2026-10-26.
- 2026-10-26 — **P10.9a built: 9-slice** (merged, #1365). A sprite's 9-slice (stretch or
  tile) with the insets on the art region, shipped as the frame's `borders`; editor and game draw
  it from one layout and a pixel-parity gate holds them together. Detail in
  [editor status](editor.md) 2026-10-26.
- 2026-10-26 — **P10.9c built: the Graph Editor** (merged, #1371). Detail in
  [cinematic status](cinematic.md) 2026-10-26.
- 2026-10-25 — **P10.8 built: arcade, rules-decided.** `motion.js`, the fixed-step loop, tags,
  `ARCADE_VOCAB` and its starter (a salmon dodger), `<ArcadeStage />`, the arcade scene set in Game
  Maker, `check:arcade-motion` / `check:arcade-rules`. §6.4 re-checked: the shared runtime stays.
  Detail above.
- 2026-10-25 — **Publishing switched on for playable non-slot games** (owner, §9 #26): the gate
  follows `mechanicFor().unplayable`; a rules game is dealt the refusing `freePlay` mock; delivery
  stays slot-only. Detail above.
- 2026-10-25 — **P10.7 built: spawning.** The `spawnLayer` node, the Spawn / Despawn / Instance ref
  nodes, `$live` sets, the cap, and spawnables on the ship chain. Detail above.
- 2026-10-25 — **The A4 design is approved** (owner): all eight decisions in
  [realtime-multiplayer.md](../design/realtime-multiplayer.md) §14 as recommended (Colyseus 0.18;
  rules on the server as `engine-mechanics` data, which settles §9 #18; a 30 Hz step with two physics
  sub-steps and state at 20 Hz; Salmons' river stays generated; bots fill to 20 as bears and
  fishermen and cannot win; a new round 15 s after a win; a service in this repository's Railway
  project; `rooms.invisiblewall.org`).
- 2026-10-25 — **P10.9's Elastic / Bounce eases built** (ahead of the rest of P10.9, which the
  plan allowed): two named `CinematicEase` presets in `engine-cinematic` and the Timeline's
  Interpolation panel. Detail in [cinematic status](cinematic.md) 2026-10-25. N-slice, rulers and
  guides and the Graph Editor are still P10.9's.
- 2026-10-25 — **P10.6 built: match-3, RGS-decided.** The bet deals the server's board, each swap
  is a `move`, the round is collected once; our own wire on the test server's `match3` mock; live
  real money waits on the partner. Detail above.
- 2026-10-25 — **A4 design written (plan, not approved):**
  [realtime-multiplayer.md](../design/realtime-multiplayer.md), grounded in Salmons' server. It
  answers §9 #18 with a recommendation and lists eight decisions for the owner. The families plan
  now says Salmons sends state at 60 Hz (it said 20 Hz) and runs its rules in one `update()`.
  Revised the same day: Salmons' costs measured with bots (its server fills one core at about 50
  players; at 100 it reaches 27–34 of its 60 updates a second, and the time is its rules' pass over
  every obstacle), and Colyseus 0.18, which already ships the per-client views, typed inputs,
  prediction, reconciliation and lag compensation, is now the recommended version. Indexing the
  obstacles (Salmon PR #5) then let today's server hold 100 players at the full 60 updates a
  second, at 86 KB/s to each device: bandwidth, not CPU, is now a full room's cost.
- 2026-10-24 — **P10.5 built: match-3, rules-decided, end to end.** A match-3 project is made in
  Game Maker and plays as free play in the shared runtime; publishing it stays off. Detail above.
- 2026-10-24 — **P10.4 built: pointer move / drag / swipe + Align Target**, and the board cell
  hit-test. Detail above.
- 2026-10-24 — **P10.3 built: Flow variables, timers, tick.** Detail above.

- 2026-10-23 — **P10.2 built: the board module** (`packages/engine-mechanics`, `check:board-mechanic`).
  Detail above.
- 2026-10-23 — **P10.1b built: tools per family.** Arcade projects are not offered Symbols or Win
  Text; a direct link shows a notice; Director's gate refuses those ops. Slot projects unchanged.
  Detail above.

- 2026-10-23 — **P10.1 built: family and outcome in Game Config.** The owner gave the go-ahead
  for Phase 10, and accepted the five P10.1 recommendations and three notes the build raised
  (§9 #20–#27). Detail above.
