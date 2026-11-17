# 3D gameplay and online — evaluation

Evaluation only (2026-11-17), no code built. Target: rebuild **BattleOTtheYear** (BOTY, Unity 6 URP,
`C:\Invisible Wall SL\Projects\BattleOTtheYear`, scripts in `Assets/_Project/Scripts`) as data on the
arcade family's online stack. Rendering, assets, animation and camera are the sibling evaluations';
this file covers the sim, combat, bots, rooms and levels. The coordinator merges it into
`docs/design/3d-games.md`.

## Verdict

- **Simulation:** a new, dependency-free `engine-mechanics` module (`motion3d.js`, `online3d.js`)
  for a kinematic capsule on the x/z plane with y up, stepped against a **grid level of boxes and
  ramps**. Do not take a physics engine. New exports only, so committed 2D replays cannot move.
- **Authority:** keep ours. Devices send inputs only, the room owns every place, and the room's
  step equals the device's prediction bit for bit. BOTY is **client-authoritative** (see §1), and
  we invert that.
- **Bots:** a nav graph over the level's grid cells (ramps, drops and trampoline links), run on the
  server only. recast-navigation-js comes later, and only for free-form levels.
- **Rooms:** Colyseus replaces Unity Lobby and Relay. The lobby is a phase of the room, bots fill
  seats, and Flow stays presentation.
- **Levels:** a 3D tilemap (cells × tileset with collision kinds) plus typed markers. The first
  version comes from a seeded port of BOTY's `MapGenerator`, and later versions from Blender
  imports.

## 1. What BOTY does, mapped onto arcade

How BOTY works today. These facts shape the rebuild:

- **Client authority.** `ClientNetworkTransform` overrides `OnIsServerAuthoritative() → false`.
  `Trampoline` bounces only `pc.IsOwner`. Weapons raycast on the shooter and send
  `FireServerRpc(targetId, …)`, which the server trusts, and `Health.TakeDamageServerRpc` is
  `RequireOwnership = false`. A modified client can teleport and hit anyone. Our inputs-only room
  removes all of that by construction.
- **Variable step.** Movement uses `CharacterController.Move(… * Time.deltaTime)`, so it is not
  deterministic. Its numbers carry over as data: gravity −9.81, jump height 1.5 (v₀ = √(2·9.81·1.5)
  ≈ 5.42 m/s), a double jump allowed only near the apex (|vy| < 5), sprint, and `HeroConfig.MoveSpeed`.
- **The camera is first person** with mouse yaw/pitch and head bob (`HandleLook`). Aim includes
  **pitch**: you shoot up and down between tiers. The sim does not care which camera is used. The
  camera choice belongs to the animation/camera evaluation.
- **Crash mode** (`CrashMatchController`): red vs blue, a 180 s timer, one round. Carriable pieces
  (`CarriablePiece`) go into **The Pit** (`ThePit`), which scores for the last carrier's team and
  raises the pit's fluid level. A killed player becomes a **ragdoll that is itself a carriable
  piece**: scoring a corpse respawns that player after 3 s. Destructible props drop pieces, and
  chests and pickups drop health or weapons. Void zones and the death plane kill instantly.
- **Bots** (`AIController`): a NavMesh agent that finds a target, chases it, fires within range when
  it has line of sight, and otherwise wanders. Off-mesh links handle trampolines. Bots **never carry
  pieces**. The server fills **16 seats** and balances teams.
- **Combat** (`WeaponConfig`): three weapon types, Hitscan, Projectile (a networked object) and
  Melee. Melee falls back from a raycast to a sphere-cast to an overlap sphere. Hits carry a
  `hitForce` knockback.
- **Heroes:** 7 assets (Archer, Barbarian, Cleric, Gunmen, Necromancer, Warrior, Wizard) with
  health, mana, shields, speed and starting weapons.
- **Maps** (`MapGenerator`, 1298 lines): **procedural and unseeded** (`UnityEngine.Random`). It
  builds a 3D grid (10-unit cells, floor heights from −10 to 30) of floors, **ramps** (4 facings),
  walls, trampolines, the pit, team spawns, props and chests. The biomes are CrashArena, Arena,
  VoidVertical and DungeonWalker. The NavMesh is baked at runtime.

| BOTY feature | Arcade today | Verdict | Genuinely 3D? |
| --- | --- | --- | --- |
| Move, sprint, face | `stepPlayer`, `facingOf`, character speeds | **Extend:** x/z plane, yaw | No (a plane) |
| Gravity, jump, double jump | `jumps.js` (`stepJump`, coyote, buffer), `stepPlatform` gravity + sub-steps | **Extend:** vertical axis on a 3D body; apex-window double jump = data | **Yes** |
| Floors at several heights, ramps | `tilemap` (none/solid/oneWay), `moveAgainstSolids` | **New:** 3D grid cells, ramp wedges, step-up | **Yes** |
| Trampoline | zone forces (`addZoneForces`) | **Extend:** a zone that sets vy on landing (predicted, like currents) | **Yes** |
| Void zone, death plane, pit | `enterZone` signals, rules modules | **Have:** zones become 3D boxes; rules decide | Height-bounded box only |
| Carry/throw piece | Salmons `hook` (rules-moved bodies) | **New rules:** carried-by link, ballistic throw | Arc only |
| Pit scoring, team score | rules module + `server` Flow variables | **Have** (Crash rules module) | No |
| Melee arc, knockback | `abilities.js` (reach, cooldown, stun) + rewind | **Extend:** sector + height band, impulse | Height band only |
| Hitscan, projectiles | — | **New:** ray vs capsule + grid occlusion; server-stepped bodies | **Yes** (pitch, tiers) |
| Health, death, respawn, corpse | `STATUS` (free/stunned/out), grace | **Extend:** hp/shield, `dead` status, corpse entity | No |
| Pickups, chests, destructibles | collide-by-tag, spawn layer | **New entities** in the room state | No |
| 7 heroes, stats, weapons | Characters (`/characters`), abilities | **Extend:** characters gain hp/weapons | No |
| NavMesh bots | `onlineBots.js` (`botInput` from a brain) | **Have** the seat model; **new** grid nav + Crash brain | Nav is layered |
| Lobby, hero/team pick, bots toggle | `arcadeRoom` + `filterBy(['game'])` | **Extend:** a lobby phase in the room | No |
| Procedural maps | `onlineGenerators.js` (`generatedOnlineGame(game, seed)`) | **Have** the seam; **new** seeded arena generator | Grid with heights |

**Honest split.** Movement intent, teams, scoring, pickups, interaction ranges, bot decisions and
round flow all work on a plane. The genuinely 3D part is the **vertical** part: tiers joined by
ramps, jumps and double jumps, trampoline launches, falling into the void or pit, throwing in arcs,
aiming with pitch, and line of sight across tiers. Because levels are grid-built, this is **a plane
with height and layered floors**, not free 3D physics. That is what makes a small home-grown sim
viable.

## 2. Simulation

**Recommendation: extend `engine-mechanics` with new 3D modules.**

- **Body:** `{x, y, z, vx, vy, vz, yaw, grounded, …}`, in metres, with **y up** (three.js), so the
  view maps it without conversion. The plane is x/z. Each module defines its own body and does not
  reuse the 2D body, whose `y` is the plane's second axis.
- **Step:** a fixed step from `createFixedStep`. The input sets plane velocity, then gravity, the
  jump (reuse `jumps.js` `jumpProfile`/`stepJump` logic through a 3D wrapper), and trampoline vy.
  Sub-steps move axis by axis against the level's boxes, as `stepSolid`/`stepPlatform` do, plus
  ramp wedges (y follows the ramp plane) and a step-up height. Sub-stepping uses the same
  `MAX_SUB_STEPS` guard against tunnelling.
- **Level query:** a static grid index (as `createStaticIndex`, with 3D cells). Every collider is
  an axis-aligned box or one of four ramp wedges, so each test is a handful of comparisons.
- **Determinism rule for the predicted path:** use only IEEE-exact operations (`+ − × ÷`,
  `Math.sqrt`, comparisons). Use **no `Math.sin/cos/atan2/hypot` inside the step**. Those are not
  guaranteed equal between V8 (Node, Chrome) and JavaScriptCore (iOS Safari). The device turns its
  camera yaw into a **world-space** move direction **before** quantising it to `int8`, so the sim
  never computes trig. Yaw travels as a quantised `uint16` and is only copied, never computed.
  Server-only rules may use trig, because the device never re-simulates them.
- **Thrown pieces, projectiles and corpses** are server-stepped ballistic bodies (gravity, bounce
  with restitution off box faces, and friction on rest). Devices interpolate them and do not
  predict them, except your own fresh throw or shot, which is drawn ahead and then reconciled.
  Tumble and ragdoll are **presentation only**, from the animation evaluation.
- **Replays stay byte for byte by construction.** No existing export changes. The 3D code lives in
  new files and is reached only from a 3D-only switch (`arcade.view: '3d'` or similar), as every
  arcade path is keyed today. Add `fixtures/arcade-3d-replay.json` plus a gate,
  `check:arcade-3d`, and a 3D case in `check:room-sim` (the room equals the device's fold). The
  existing `arcade-*-replay.json` gates run unchanged in CI and prove it.
- **Size:** about 1–2k lines of plain ESM, a few KB gzipped, and only dynamically imported on the
  3D path. The runtime evaluation owns bundle isolation.

**Rejected:**

- **Rapier (`@dimforge/rapier3d-deterministic`) on the server and the device.** Its determinism is
  real, and that was never the problem. The problems:
  1. A WASM payload of roughly 1.5–2 MB (larger as the compat build with base64 inlined), with
     async init in both the room and the game.
  2. Prediction means re-simulating from `ack` every frame. That needs either snapshot/restore of
     the whole Rapier world per frame or a split where only its kinematic character controller is
     predicted, and that split leaves Rapier doing box queries we can do in a few lines.
  3. It forks the physics model away from the shared 2D modules (`abilities.js`, zones, rules,
     `botInput`), which would then need adapters.
  4. BOTY's level has no rigid-body play that matters beyond a thrown arc.

  Keep it as an **escape hatch**: if a later game needs real stacking or rigid-body piles, run
  Rapier **server-only** for those props (not predicted, interpolated on the device).
- **cannon-es or ammo.js.** They are not deterministic across platforms, so they break "room equals
  device".
- **Generalising the existing `motion.js`/`online.js` functions with an optional z.** It touches
  hot 2D code and risks the replays for no gain.
- **Porting Unity's CharacterController behaviour line by line.** Its variable step and
  client-authoritative model are exactly what we are replacing.

## 3. Bots, combat, lag compensation, wire

### Bots

A bot stays **a player whose input comes from a brain** (`onlineBots.js`): the room steps it like a
device's player. Only navigation is new.

- **Recommendation: grid nav graph.** Derive it from the level cells at load: the walkable top of
  each cell, edges to neighbours, ramp edges, one-way drop edges, and **trampoline jump links**
  (BOTY's `ConnectTrampolines` and off-mesh links). Path with A* using seeded tie-breaks, then
  follow the path with the `steer` logic. It runs **on the server only** (bots exist only there),
  so it costs the device nothing, and it is dependency-free.
- **Brain** (a new `behaviours` entry for Crash): fight (target, chase, attack in range with line
  of sight), plus what BOTY lacks: **carry a piece or corpse to the pit** and **escort or
  intercept a carrier**. Weights are data per hero. Line of sight uses the same grid ray as
  hitscan.
- **Rejected for now: recast-navigation-js.** It is WASM, needs a navmesh bake, and is overkill
  for grid levels. **Adopt it when levels become free-form Blender geometry.** Bake at authoring in
  the launcher (Node) and ship the navmesh as level data that only the game server loads. That way
  the device never downloads it, which removes the size argument. Unity-style runtime baking is
  rejected outright: bake once, in data.

### Combat

The **server decides every hit**. The device draws its own swing or shot immediately (presentation)
and the room's event confirms it. The existing **rewind** carries over: `onlineRules.js` keeps a
per-player history ring and judges the attacker's hit against where its device was drawing targets
(`input.view`, held to `REWIND_MS` = 250 ms). It extends to x, y, z.

- **Melee:** a sector test. Plane distance ≤ reach, |Δy| ≤ height band, and the dot product of the
  facing with the direction to the target ≥ cos(half-arc), with the cosine precomputed per weapon.
  It extends `abilityTargets` as a new export. Knockback is an impulse on the victim's velocity.
- **Hitscan:** a ray (yaw and pitch from the input) against target capsules, modelled as vertical
  cylinders, at the rewound positions, occluded by a grid DDA ray against level boxes.
- **Projectiles:** server-stepped bodies spawned at the shooter's rewound view. They hit capsules
  and boxes, and splash damage is a sphere.
- **Health:** hp, shield and mana per hero. `dead` joins `STATUS`. A corpse becomes a carriable
  entity, and respawn follows a timer or the corpse being scored.
- **Knockback, launches and other forced moves on your own player** reach the device as
  corrections, the same way rules-moved bodies do today. The impulse is also an event the
  predictor applies at its stamp, so the correction is small.

### What the room sends

New schema classes (`Input3D`, `Player3D`, `Entity`). A 2D room keeps its current classes, as
`check:room-bots` already pins.

- **`Input3D`:** `seq`, `moveX`/`moveZ` (int8, world space), `buttons` (jump, attack, alt-attack,
  interact/pick/throw, sprint, ability), `yaw` (uint16), `pitch` (int16), `view`.
- **`Player3D`:**
  - Position: `x y z` (float32) and `yaw` (uint16).
  - Rules state: `status`, `hp`, `shield`, `team` (uint8), `hero`, `weapon`, `carrying` (entity
    id), `ack` (own player only, as `NearbyPlayer` does).
  - Animation-driving state: `anim` (uint8 bits: grounded, sprinting, carrying, aiming,
    double-jumped).

  Locomotion blend comes from the interpolated velocity on the device. One-shots (swing, fire, hit
  react, death, land, bounce) arrive as **events**, not state.
- **`Entity` map:** pieces, corpses, projectiles, pickups, chests and props, as `kind`, `x y z`,
  `carriedBy` and `state`.
- **Room fields:** `scores` (red and blue), `pitLevel`, `phase`, `endsAt`, `round`, `seed`, `map`.
- **Bandwidth:** 16 players at the room's patch rate is far below Salmons' 100-player case.
  `nearby` is not needed, and the load test (`scripts/room-load.mjs`) gets a 3D mode.

## 4. Rooms, lobby, matchmaking

**Recommendation: a lobby phase inside the Colyseus room.** Unity Lobby (discovery, codes, player
properties) and Relay (NAT traversal for a player host) are both replaced by our **dedicated game
server**. With no player host there is nothing to relay and no host migration.

- **Matchmaking:** `filterBy(['game'])` gains a `mode` and a `map`. **Quick play** joins the
  fullest open room. A **private room** is a `private` Colyseus room with a short join code in its
  metadata (looked up through the existing exposed matchmaker methods). Both are config, not code
  per game.
- **Room phases:** `lobby → countdown → running → ended → lobby`.
  - In `lobby`: pick a hero and a team (the preference is honoured unless it unbalances the teams;
    otherwise BOTY's `redCount <= blueCount` rule assigns), plus ready and a bots toggle.
  - Without a host, the countdown starts when enough players are ready or after a timeout.
  - `running` is Crash's 180 s timer. `ended` carries the winner team and the scoreboard.
- **Bots fill seats** up to `seats` (BOTY: 16) and balance teams. When a human joins mid-round, a
  bot on the human's team gives up its seat. When a human leaves, a bot takes the seat after grace.
- **Flow:** stays presentation, as online Flow is today. Crash's room events reach Flow through
  `flowSignalsOf` (`pieceScored`, `kill`, `respawn`, `pitRise`, `roundEnd`). Scores and the timer
  are `server` variables. Lobby UI (hero cards, team lists) is a Flow screen over room state.
- **Map loading:** a generated map is made from the room's `seed` on both sides
  (`generatedOnlineGame`). An authored map is named by id and ships with the game.

## 5. Levels as data

**Recommendation: a 3D tilemap plus markers, reusing the tilemap and world concepts.**

- **Cells:** keyed `(x, y, z)` on a uniform grid (BOTY: 10 Unity units; ours in metres) → a tileset
  id. A tileset entry pairs a **mesh** (a GLB from the asset pipeline) with a **collision kind**:
  `none`, `solid` (box), `floor` (slab), `ramp-n/e/s/w`, `oneWay`. That last one is the 2D
  tilemap's solidity generalised. Rotations are restricted to 90°.
- **Markers:** typed placements that work like the spawn layer and zones: team spawns, the pit, a
  trampoline (with force), void/death boxes, chest, prop (hp, drops), pickup spawner, piece
  spawner. Zones raise the same `enterZone` family of signals.
- **Derived at load, never stored:** the collision index, the nav graph and the death plane.
- **Authoring, in order:**
  1. A **seeded generator**: a port of `MapGenerator`'s CrashArena (pit at the centre, branches,
     ramps, trampolines on landings, far spawns), registered in `ONLINE_GENERATORS`. It is the same
     seam Salmons uses, and BOTY's maps are procedural already.
  2. **Blender import:** a tileset blend whose objects carry custom properties (`ie.collision`,
     `ie.marker`), and a level blend of instanced tiles, exported to glTF. The importer snaps to the
     grid, emits cells and markers, and **refuses** an untagged mesh as a collider.
  3. **Editing** in the launcher, as a layered top-down grid paint (one floor at a time) on top of
     the existing tilemap painting (`tilemapPaint.client.svelte.ts`) with a 3D preview. A full 3D
     level editor is a later L.
- **Rule 8:** tileset GLBs and level JSON travel export → deploy → bake → pull → register like
  every other asset class. The asset evaluation owns the GLB side.
- **Rejected:**
  - **Free-form mesh colliders** (a triangle soup from Blender) for the first version. They need
    capsule-vs-triangle collision and recast, and they bring floating-point edge cases into the
    predicted path. Revisit together with recast.
  - **Reusing the 2D tilemap node as is.** The concepts carry over, but its data is 2D. A separate
    `tilemap3d` keeps 2D configs byte for byte.

## 6. Sizing and build order

| # | Step | Size |
| --- | --- | --- |
| 0 | **Determinism spike:** `motion3d` step run 10k steps in Node, Chrome and iOS Safari, comparing state hashes | S |
| 1 | `motion3d.js`: body, grid collision, ramps, gravity, jump plus double jump, trampoline, death plane; replay fixture plus `check:arcade-3d` | M |
| 2 | `online3d.js` plus the room: `Input3D`/`Player3D`, the 3D room sim, a predictor, reconciler and interpolator for x/y/z/yaw; a 3D case in `check:room-sim` | M |
| 3 | Crash rules module: teams, pieces, carry and throw (ballistic), pit scoring and level, timer, respawn, corpse as a piece | M |
| 4 | Combat: health, one melee weapon, knockback, 3D rewind; then hitscan (S) and projectiles (S) | M |
| 5 | Bots: grid nav graph, A*, the Crash brain (fight plus carry to the pit), seat filling | M |
| 6 | Levels: seeded CrashArena generator (M); Blender tileset/level import (M); layered grid editor (M); full 3D editor (L, later) | M–L |
| 7 | Lobby phase: hero and team pick, ready, bots toggle, quick play, private code | S–M |
| 8 | Rest of BOTY: 7 heroes, mana and abilities, chests, pickups, destructibles, other biomes and modes | L |

**First playable vertical slice:** steps 0–5, the generator part of 6, and a minimal 7. That gives
one hero (a melee one, e.g. Warrior), one generated Crash arena, carry to the pit, bots filling 16
seats, and online play through the real game server with the sibling evaluations' three.js view.
**Size: L overall** (a chain of M steps, each a separate pipeline-change PR that keeps every 2D
replay untouched).

**Risks to watch:**

- **iOS JavaScriptCore float parity.** Step 0 settles it before anything else is built.
- **Knockback and launch corrections** on your own player feeling rubbery. Tune them with the
  predictor's impulse events.
- **Free-form levels pulling in recast and triangle collision** earlier than planned. Hold the
  first version to grid levels.
- **Owner decisions:** first person (as BOTY) or third person, which changes the input's pitch use
  and the hit-feel tuning, not the sim; and whether bots should carry, an improvement on BOTY.

## Step 0 result (2026-11-17)

Phase 0b of `docs/design/3d-games.md`: does the 3D step give the same bits in Node, Chrome and iOS
Safari?

**What was built.** The step landed as a real export, because Phase 1 builds on it:
`packages/engine-mechanics/src/motion3d.js` with its `.d.ts` (`createLevel3d`, `stepBody3d`,
`createBody3d`, `hashBodies3d`). It is a new file, not re-exported from the package's `index.ts`,
so no 2D bundle gains a byte. The 3D path imports `engine-mechanics/src/motion3d.js` directly, and
Phase 1 decides whether that import is dynamic. The step covers:

- a body `{x, y, z, vx, vy, vz, yaw, grounded}` plus its jump clocks, in metres with y up;
- a level of boxes and four-facing ramp wedges bucketed into 4 m columns;
- int8 move axes (a diagonal clamped to the unit circle), a uint16 yaw that is only copied, and
  button bits;
- ground and air acceleration, gravity, jump with a 6-step coyote time and a 6-step buffer, and a
  double jump only while |vy| < 5;
- trampoline zones, and sub-steps of at most 0.1 m (64 at most) moved x, then z, then y;
- 0.35 m step-up (the way a ramp is climbed) and 0.35 m snap-down (the way it is walked down);
- ceilings and the death plane.

The body is its upright bounding box against the level. A capsule's rounded edges add nothing on a
grid level. The step uses only `+ − × ÷`, `Math.sqrt`, comparisons and
`floor/ceil/min/max/abs`. `check:arcade-3d` greps the file for the implementation-defined `Math`
functions and fails if it finds one.

**The test.** `scripts/arcade-3d-scenario.mjs` runs six bodies for 12 000 steps (200 s at 60 Hz) on
a level with a 3 m tier, four ramps, an overhead slab, a stair, pillars, a pit and three
trampolines. A seeded integer PRNG drives walk-to-target (quantised with `Math.round`), wander,
idle, sprint, jump and near-apex double jump. It hashes every body's exact float bits (FNV-1a over
little-endian float64) every 500 steps, and the 24 checkpoint hashes fold into one code. The run
covered 425 jumps, 360 double jumps, 21 trampoline bounces, 2 758 ramp steps, 42 step-ups,
7 866 wall-blocked steps, 21 ceiling hits and 13 falls into the pit.

`scripts/arcade-3d-page.mjs` builds one self-contained page that inlines the same two files and the
committed replay. The page runs the scenario three times (so the later runs execute JIT-optimised
code), shows every checkpoint, and says MATCH or DIFFERS. It is committed at
`apps/launcher-api/static/spikes/arcade-3d.html` and served without sign-in at
**https://app.invisiblewall.org/spikes/arcade-3d.html**. `check:arcade-3d` fails if that page is
stale.

| Platform                          | Engine         | Code                                     | Checkpoints 500 / 1000 / … / 12 000                            |
| --------------------------------- | -------------- | ---------------------------------------- | -------------------------------------------------------------- |
| Node 24.13.0 (Windows x64)        | V8 13.6        | `d3eac484`                               | `62af8943 bad45794 7ab95cb7 …  080e9717 d6f465b9`, the fixture |
| Chrome 148 headless (Windows x64) | V8             | `d3eac484`                               | all 24 equal, in all 3 runs                                    |
| WebKit 27.2 (Playwright, Windows x64) | JavaScriptCore | `d3eac484`                               | all 24 equal, in all 3 runs (MATCH)                            |
| iOS Safari (iPhone, arm64)        | JavaScriptCore | _pending: no iPhone yet; pre-launch_     |                                                                |

**Result so far:** Node, Chrome and WebKit (Safari's engine, JavaScriptCore, run 2026-11-17 through
Playwright on Windows) are bit-identical, so nothing diverged and nothing needed fixing. That clears
the engine question for Phase 1; a real iPhone (arm64 hardware) stays a pre-launch check, since the
owner has none yet. The coordinator records the owner's read-back (MATCH or DIFFERS, and
the code) in `docs/status/3d.md`. If iOS says DIFFERS, the first wrong checkpoint bounds the step
range in which to bisect.

**Committed:** the replay `packages/engine-mechanics/fixtures/arcade-3d-replay.json` and the gate
`pnpm check:arcade-3d` (17 checks: the cross-engine rule, jumps, apex window, buffer, trampoline,
ramps up and down, ramp side as a wall, step-up and block, wall slide, ceiling, no tunnelling at
`maxFall`, diagonal speed, the death plane, hash sensitivity, the replay and the page's freshness).
The 2D replays (`arcade-replay.json`, `arcade-characters-replay.json`,
`arcade-platformer-replay.json`) are byte-unchanged, and their gates pass.
