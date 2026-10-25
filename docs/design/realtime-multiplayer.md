# Realtime multiplayer: online arcade rooms (tier A4)

> Status: **APPROVED (owner, 2026-10-25): every §14 decision as recommended.** Written the same
> day. This is the design that [game-families.md](game-families.md) §4.5 asks for before tier A4
> (P10.14–P10.16) is built, and it settles that plan's decision §9 #18 (where an online game's rules
> run: on the server, as `engine-mechanics` data).
>
> Grounded against Invisible Engine `main` 854d24d and Salmons (`GuiltyForever/Salmon-`) `main`
> c16ba9e. "Today" means those trees; "new" means proposed here. Revised the same day with Salmons'
> measured costs (§2.1, from its `scripts/room-load.mjs`) and the Colyseus 0.18.10 packages read
> from the registry (`colyseus`, `@colyseus/schema` 5, `@colyseus/sdk` 0.18.6), which already ship
> most of §6's netcode.

## Contents

1. [Scope](#1-scope)
2. [What Salmons does today](#2-what-salmons-does-today)
3. [The shape](#3-the-shape)
4. [Where the rules run](#4-where-the-rules-run-9-18)
5. [The wire and its rates](#5-the-wire-and-its-rates)
6. [One simulation, two places](#6-one-simulation-two-places)
7. [Bots](#7-bots)
8. [Rooms and rounds](#8-rooms-and-rounds)
9. [The game server and where it runs](#9-the-game-server-and-where-it-runs)
10. [The runtime's online branch](#10-the-runtimes-online-branch)
11. [Security and fairness](#11-security-and-fairness)
12. [Testing](#12-testing)
13. [Phases](#13-phases)
14. [Decisions (owner)](#14-decisions-owner)

---

## 1. Scope

**In short:** up to 100 players in one game, each on their own device. The server owns the game;
a device sends what its player presses and draws what the server says. Salmons is the first game
on it, and the design is general enough that the next online arcade game is data, not a fork.

**In scope:**

- Rooms of up to 100 players in one world; join, leave, and rejoin within a grace period.
- The server owns every position, every rule, every score and the round.
- One simulation used in two places: the server steps it, and a device runs the same code to
  predict its own player. Everyone else is drawn smoothly between server updates.
- Bots that fill empty places.
- A game server in this repository (`services/game-server`), the runtime's online branch, the
  config that turns a game online, and the gates and load test that prove it.
- Moving Salmons onto it (P10.16).

**Not in A4:** accounts and logins, saved progress, server leaderboards, money of any kind
(rules-decided games never touch a wallet: game-families §9 #4), matchmaking beyond "join a room
with space", chat or voice, more than one region, and card-game PvP (later: game-families §9 #16).

---

## 2. What Salmons does today

**In short:** Salmons already has most of A4's shape. One Colyseus room holds up to 100 players,
and every rule runs on the server. Three things change: who decides positions, how often and how
much the server sends, and rules written as one function becoming data the next game can reuse.

| Part | Today (`server/index.js` unless named) |
|---|---|
| Room | One room type, `salmon_room`, joined or created; up to 100 players (`MAX_PLAYERS`, `shared/constants.js`) |
| Simulation | 60 Hz (`setSimulationInterval`, `:30`) |
| State to devices | Every change, 60 times a second (`setPatchRate(1000 / 60)`, `:31`) |
| Inputs | `move {vx, vy}` every 50 ms (client `game.js:1246`), `jump {targetX, targetY}`, `cast {targetX, targetY}`, `attack`, `respawn` |
| Rules | River current, whirlpool pull, rocks and one-way waterfalls that block, waterfall climbing by tapping, sandbanks that ground a salmon until it jumps, the bear's catch radius, the fisherman's hook, reel and landing, and the first salmon to reach the source wins and locks the room (`update`, `:370–671`) |
| Map | A seed. The server and every client generate the same river, obstacles and bridges from it (`generateMap`, `buildMeanderTable`) |
| Rejoin | 60 s grace (`allowReconnection`, `:309`) |
| Device | Dead reckoning: extrapolates each player from the server's velocity and eases towards the server's position (`game.js` `updatePlayerSprite`) |

What changes, and why:

1. **Positions become the server's alone.** `move` accepted a position if one was sent
   (`:98–100`), so a modified client could put itself anywhere; Salmon PR #6 (2026-10-25) closed
   that, capped a move's direction and checked the class against the faction. A client still
   chooses to be a golden salmon (`isGolden` from the join options, `:277`). A4 takes inputs only,
   and the server decides the rest.
2. **The rates.** Every change of every player goes to every device 60 times a second, as 8-byte
   numbers. §2.1 measures what that costs, and §5 says how A4 brings it down.
3. **Rules become reusable.** Today they are one `update` function written for Salmons. A4 moves
   them into `engine-mechanics`, driven by the game's config (§4), so a second online game does not
   start from a copy.
4. **The client is rebuilt on the shared runtime** (game-families §1). Its art is already in the
   pipeline and its characters already play clips by action and facing (the Salmon repository's
   `docs/art-pass.md`).

### 2.1 What a room costs today (measured)

**In short:** as built, the server could not hold 100 players. One core was full at about 50,
and the time went to the rules, not to the network. Indexing the river's obstacles fixed that, and
a full room's cost is now its bandwidth.

Salmons' `scripts/room-load.mjs` fills one room with bots that play like the real client (`move`
every 50 ms; salmon jump, bears swipe, fishermen cast) and reads the bytes on every socket and the
server's CPU. Measured 2026-10-25 on a 4-core cloud container, Node 22, Colyseus 0.15.57; the bots
used at most 1.5 cores, so the limit is the server's own:

| Players | Updates a second reached (of 60) | To each device | Leaving the server | Server CPU |
|---|---|---|---|---|
| 10 | 61 | 9.5 KB/s | 0.09 MB/s | 31% of a core |
| 25 | 61 | 23.9 KB/s | 0.58 MB/s | 54% |
| 50 | 54 | 39.5 KB/s | 1.93 MB/s | 92% |
| 100 | 27–34 | 41–51 KB/s | 4–5 MB/s | 89–99% |

- **The rules are the cost.** A CPU profile at 100 players puts 72% of the server's time in
  `update()`: every salmon, every tick, tests every one of the river's ~1,700 obstacles (1,507 of
  them sandbank tiles), reading each field through a schema getter. Encoding the patches is about
  5%.
- **Lowering the rate alone does not fix it.** With patches forced to 20 a second, 25 players cost
  7.8 KB/s per device instead of 23.9, but 100 players still get only 14 updates a second, because
  the simulation fills the core by itself.
- **The bandwidth it would need.** At 100 players an update is about 1.5 KB. At the 60 a second the
  server intends, that is about 90 KB/s (0.7 Mbit/s) to each device and 9 MB/s leaving the server.
  Railway bills outbound traffic, so this is money as well as bandwidth.
- **Joining** downloads about 44 KB of full state, mostly obstacles that every device already
  generates from the seed.
- **Each device sends** 0.7 KB/s.
- **Indexing the obstacles** (Salmon PR #5: plain copies, only the kinds each loop acts on, the
  sandbanks in a grid by tile; the same player state on every tick of a seeded comparison) takes
  `update()` from 20–24 ms to 1.5–1.9 ms a tick at 100 players. The room then holds 61 updates a
  second at 42% of a core, and each device receives 86 KB/s (0.7 Mbit/s), with 8.4 MB/s leaving the
  server. That is §6's grid requirement, measured, and the bandwidth §5 brings down.

A deployed server runs on different hardware; the same script measures one with `--url`.

---

## 3. The shape

**In short:** devices send inputs; the server steps the world and sends state and events back.

```
device (shared runtime, online branch)                  game server (services/game-server)
  read input ─► predict own player (engine-mechanics)  ── input {seq} ──►  room, fixed step (D3)
  draw others ~100 ms behind, smoothed                 ◄── state, 20 Hz ──  rules (engine-mechanics data)
  Flow: presentation only                              ◄── events ───────  hit, caught, round end
                                                                            bots (P10.11 brains)
```

- **The server owns** every body's position, every rule, every score, and the round.
- **A device owns** its inputs, its camera, and how everything looks and sounds.

---

## 4. Where the rules run (§9 #18)

**In short:** recommended: **on the server, as `engine-mechanics` data**, with Flow on the device
for presentation only. It is the split P10.5 already made for match-3, put across the network.

**The precedent.** P10.5's `createMatch3Driver({ session, state, signal, present })`
(`packages/engine-game/src/game/match3Driver.ts`) decides every move: input taken or refused, the
order of the board's signals, the score. The runtime supplies only `present` (seat, swap, cascade
step); the headless gate supplies none, "so both run this very code". A4 does the same with the
network in the middle: the room runs the rules with no presenter, and each device presents what
the room reports.

**What the rules are, as data** on the game's arcade config, most of it already planned for tiers
A2 and A3:

| Salmons today | As data (where it is planned) |
|---|---|
| Bodies, speeds, who can go on land or water | Character bodies and movement (§4.3, P10.11) |
| River current, whirlpool pull | Zone forces (§4.3, P10.11) |
| Rocks; waterfalls block from downstream only | Solids, and one-way solids (§4.4, P10.13) |
| Sandbank: stops a salmon until it jumps | A zone effect: `ground` until an input (new) |
| Bear swipe catches within 1.5 tiles | An ability with a hit zone and an `onHit` effect (§4.3, P10.11) |
| Fisherman cast, hook, reel, land | An ability that sends out a hit zone and brings it back (new: a "line" ability) |
| First salmon at the source wins | A goal zone: first to enter ends the round (new) |
| Waterfall climbing by tapping | A climb zone: each jump input adds height, height drains, the top releases (new) |

- **An `onHit` effect is picked from a closed list**, like a card effect (game-families §10):
  `catch` (the target is out until it respawns), `hook` (the target follows the line), `score +n`
  to the hitter, `stun ms`. Anything the data cannot say lives in a small named rules module in
  `engine-mechanics`, plain JS like `board.js`, that a game opts into (`rules: 'salmons'`). That is
  the honest escape hatch: the climb and the line are Salmons' own and may stay code.
- **Scores and lives are server-owned variables.** The server keeps them in the same store Flow uses
  on the device, `createFlowState` (`packages/engine-flow-v2/src/state.ts`), which is pure: no
  ticker, no Svelte, no timers of its own. Their values travel in the room state, and a device binds
  them like any `var:<id>` source, read-only.
- **Device Flow is presentation.** It gets online events (`onPlayerJoined`, `onPlayerLeft`,
  `onHit`, `onCaught`, `onRoundEnd`) and plays screens, cues and sounds. The validator refuses a
  device write to a server-owned variable (`variable-server-owned`, the online twin of
  `variable-shadows-money`).

**The alternative: Flow running headless on the server.** It is possible: the interpreter and the
store are pure modules and already run headless in `/flow-v2` Preview. It is not recommended for
A4. Every room would run an interpreter every step, presentation nodes mean nothing on a server, and
one game's rules would be split between two languages. It stays open for later, if authors need
online rules the data cannot say.

---

## 5. The wire and its rates

**In short:** one small input goes up per step, state comes down 20 times a second for the
players near you, and events arrive as they happen.

- **Input** (device → server): a flat input schema declared with Colyseus 0.18's `defineInput`:
  `{ seq, moveX, moveY, buttons, aimX, aimY }`. `buttons` is a bitfield (jump, ability 1, ability
  2); `aim` is a target point (a jump or a cast). The device sends one input per fixed step, and the
  SDK delta-encodes it, so an unchanged input is a few bytes. The server takes one per player per
  step (`this.inputs.get(id).next()`), drops a repeated `seq` (`seqField: 'seq'`), and acknowledges
  the newest it applied; §6 reconciles against that acknowledgement.
- **State** (server → device, Colyseus schema): per player `x`, `y`, `z` as 32-bit floats, `facing`
  and `state` as small integers (the character state a clip is picked by), `character` once, and
  the server-owned variables. Per room: the phase, the level (Salmons: its seed), the round clock.
  The level itself is never in the state (§2.1: today it is most of a join).
- **Events** (server → device messages): `hit`, `caught`, `roundEnd`, `joined`, `left`.

| | Today | A4 |
|---|---|---|
| Simulation | 60 Hz, variable step | 30 Hz fixed step, 2 physics sub-steps (D3) |
| State to each device | 60 Hz, every player, 8-byte numbers | 20 Hz, players near you, 32-bit floats |
| Device to server | `move` every 50 ms | one input per step, delta-encoded |

**Why a 30 Hz step.** Colyseus 0.18 ties one input to one step: its fixed-step loop
(`setFixedTimestep(step, tickRate, { subSteps })`) advertises `tickRate` to the devices, which send
an input per step. At 60 Hz, 100 devices would send 6,000 messages a second, three times today's
traffic in. Two sub-steps keep the physics at 60 Hz, and the devices integrate the same sub-steps.
Today's client sends 20 inputs a second, so 30 is no loss of feel.

**What a full room costs.** Today's is measured (§2.1). A4's, estimated from it: today a player's
share of an update averages about 15 bytes (1.5 KB for 100) with 8-byte floats, so 20 updates a
second of about 20 nearby players is about 6 KB/s to each device, less with 32-bit floats, and
under 1 MB/s leaving the server, against today's measured 41–51 KB/s and 4–5 MB/s. P10.16
confirms it by running the same script against the new server.

**Sending each device only the players near it** is a per-client view. Colyseus 0.15's `@filter`
encodes the state again for every client. Since 0.16 (schema 3) each client has a `StateView`
instead: a field marked `view` goes only to the clients whose view holds that instance
(`client.view.add(player)`, `remove`), and schema 5 (Colyseus 0.18) adds `StreamSchema`, which sends
a busy room's players to a joining device nearest-first, a few per tick (`maxPerTick`, a priority
callback). Each tick the server adds and removes neighbours from each view, found through the same
grid the step uses (§6).

---

## 6. One simulation, two places

**In short:** the server and the device run the same `engine-mechanics` step. The device runs it
early for its own player, so the controls answer at once, and corrects itself when the server's
answer arrives. Colyseus 0.18 does the bookkeeping; the engine supplies the step.

- **The same code.** `motion.js` (P10.8), `behaviours.js` (P10.11) and the rules modules are plain,
  dependency-free JS (game-families §4.0), so the server and the runtime import the same files.
- **What Colyseus 0.18 already does** (`@colyseus/core` and `@colyseus/sdk`, read 2026-10-25):
  - **The server's loop:** `setFixedTimestep` owns the accumulator, gives the step a fixed `dt`, and
    drops a backlog after a hitch instead of spiralling.
  - **The own player:** `predict.reconciler(me, { input, step })` applies each input at once, keeps
    the ones not yet acknowledged, rewinds to the server's state when it arrives and replays them,
    and eases a misprediction away over `smoothMs`. `step` is the `engine-mechanics` step for one
    body, the same function the server calls.
  - **Everyone else:** `predict.attachAll('players', { mode: 'lerp', delay: 100 })` draws them about
    100 ms in the past, between the two server states around that moment, so 20 updates a second
    move smoothly.
  - **Actions shown at once:** `predict.defineEvent` plays a swipe or a cast the moment the player
    presses, and the server confirms or rejects it.
  - **Hits that match the screen:** `allowRewindState` records where bodies were, so the server
    tests a bear's swipe or a hook against where the attacker saw the target (`lastSeenBy`, up to
    `maxRewindMs`). Without it, a swipe that visibly lands on a salmon drawn 100 ms behind would
    miss. Recommended for every hit zone, with a 250 ms window.
- **What the step must do to hold 100 players** (from §2.1's profile):
  - simulate plain objects, and write to the synced schema only what devices draw, once per patch
    (`onBeforePatch`), not once per step;
  - index the level's static shapes (solids, one-way solids, zones) once per level in the grid that
    `motion.js` already plans for its broad phase (game-families §4.2), so a body tests the few
    cells it touches, not every shape on the map;
  - keep the level out of the state (§5).

  The load test's gate is a step under 8 ms at the 99th percentile with 100 players (§12).
- **Same results.** A fixed step and the same code give the same numbers for the arithmetic
  a step uses. Trigonometry in the step can differ in the last bits between browsers, and
  reconciliation absorbs that. Only the server rolls dice; a device never predicts another player's
  random outcome.
- **Not predicted:** hits, catches, scores and the round. They arrive from the server about 100 ms
  later. The presentation hides the wait: a swipe plays at once (a predicted event), and whether it
  caught someone comes after.

---

## 7. Bots

**In short:** bots fill a room so five people still get a full river. They are the P10.11 brains,
run on the server.

- A bot is a body with a brain (`behaviours.js`, P10.11) instead of a stream of inputs. The server
  steps it like any player.
- `arcade.online.bots` says how full a room is kept (`fillTo`), which characters bots play, and
  whether a bot can win (D5).
- A joining player takes a bot's place, so the room never goes over its size.
- A bot is marked in the room state, so a device can label it or not.

---

## 8. Rooms and rounds

- **One room type per published game.** A device joins one with space or creates one. Room
  metadata carries the player count, which Salmons' start menu already lists ("N players in X
  River").
- **The round:** waiting, running, ended. Salmons locks the room when a salmon wins; D6 asks
  whether a room should instead start a new round after a pause.
- **Leaving and rejoining:** the 60 s grace stays. A dropped player's body stays where it was until
  it rejoins or the grace runs out, as today. Joining a running round stays allowed.

---

## 9. The game server and where it runs

- **`services/game-server`** (new): Node 22 and Colyseus 0.18 (`@colyseus/core` needs Node 22 or
  later; its peers are `@colyseus/schema` 5, `@colyseus/ws-transport` 0.18, Express 4 or 5, and Zod
  4 for validated messages). It imports `engine-mechanics` and `game-config` from the workspace. The
  runtime connects with `@colyseus/sdk` 0.18, the client package that replaced `colyseus.js` (whose
  last line is 0.16).
- **Which game a room plays** is the published game's config, read from the same published snapshot
  the runtime boots from, so a room and its devices always agree on the rules. A new publish
  reaches new rooms; a running room keeps the version it started with.
- **On Railway**, as a service of this repository, like the test server:
  - Dockerfile `services/game-server/Dockerfile` at the repository root;
  - watch paths `services/game-server/**`, `packages/engine-mechanics/**` and
    `packages/game-config/**`;
  - a public WebSocket domain, `rooms.invisiblewall.org` (D8), so it needs a Cloudflare DNS
    record;
  - `/healthz` reporting `commit`, and an entry in `scripts/deploy-drift.mjs` `SERVICES` and in
    `docs/INFRA.md`'s watch-path table, so a missed deploy is noticed.
- **One process, many rooms, one replica.** Running several processes needs Colyseus' shared
  presence and driver (Redis), which is out of A4 unless the load test says otherwise.
- **Salmons' current server** (its own Railway project) keeps running the current game until the
  rebuild replaces it in P10.16.

---

## 10. The runtime's online branch

- **A third mechanic** in `packages/engine-game/src/game/mechanic.ts`: `ARCADE_ONLINE_MECHANIC`,
  with no spin, no RGS session and no wallet, plus a new `room: true`. `mechanicFor` picks it when
  the config has `arcade.online`. The runtime reads every online branch off it, as P10.5's match-3
  branches read `MATCH3_RULES_MECHANIC`.
- **Boot.** The game server's address comes in with the boot parameters, written by the publish,
  as the RGS address comes from the launch today. The runtime joins a room with the player's name
  and chosen character. If the server cannot be reached, the existing boot-failure screen says so.
- **Drawing.** `<ArcadeStage />` (P10.8) draws bodies from the room state, with the player's own
  predicted and everyone else's smoothed, instead of from its own loop.
- **The HUD** binds the server-owned variables (score, lives) through `var:<id>` sources.
- **Publish** requires a game server address for an online game, and refuses an online game with a
  delivery profile that carries a real-money RGS, as rules games already are (game-families §2.3).

---

## 11. Security and fairness

- **Inputs only.** No position, hit, score or character perk ever comes from a device. A message
  that carries one changes nothing.
- **Every input is clamped:** `move` to length 1, `aim` to the character's reach. Inputs apply at
  the server's own clock, at most one per player per step, so sending more does not make a player
  faster. The input schema is flat and typed, so a field it does not declare cannot arrive.
- **Message limits**, all built into Colyseus 0.18: `maxMessagesPerSecond` disconnects a client
  that floods; every other message handler takes a validator (`onMessage(type, schema, handler)`,
  any Standard Schema such as Zod); the WebSocket transport's `maxPayload` caps a message's size.
- **Names** are trimmed and capped, as `onJoin` does today (`:274–275`). There is no chat in A4.
- **The character** is checked against the room's allowed characters and their counts (§7); a
  client no longer picks perks such as the golden salmon.
- **No money anywhere** (game-families §9 #4).

---

## 12. Testing

| Gate | Phase | Proves |
|---|---|---|
| `check:room-sim` | P10.14 | The room's step and the device's prediction produce identical bodies for the same inputs over 10 000 steps; inputs apply in `seq` order; dropped and repeated inputs; a message carrying a position changes nothing |
| `check:netcode` | P10.15 | With 50–250 ms latency, ±50 ms jitter and 2–5 % loss simulated: the player's own body converges within 200 ms of the last input, and nobody else jumps by more than one step |
| `check:online-rules` | P10.15 | Salmons' rules as data reproduce today's outcomes on recorded input traces: current, whirlpool, rocks, waterfall, climb, sandbank, swipe, hook and land, the win |
| `room-load` script (outside CI) | P10.16 | 100 headless clients (`@colyseus/sdk` in Node) sending an input per step over real latency: server step time (p99 under 8 ms), bytes per device per second, server egress, memory. Salmons' `scripts/room-load.mjs` is today's baseline (§2.1) |
| `docs/playtest/salmons.md` | P10.16 | Two browsers and a room of bots, played by the `game-playtester` agent |

---

## 13. Phases

The detail of game-families P10.14–P10.16. A4 needs P10.8 (the arcade loop and `motion.js`)
first. Salmons also needs P10.11 (characters, abilities and brains), P10.12 (the camera) and
P10.13 (the hop and diamond tiles) before it can be rebuilt.

| # | Delivers |
|---|---|
| **P10.14** (A4a) | `services/game-server`: a room per published game stepping `engine-mechanics` at its fixed step (D3); inputs-only messages; join, leave and rejoin; the state schema; `ARCADE_ONLINE_MECHANIC`, so the runtime joins a room and draws server positions (no smoothing yet); the Railway service, health and drift entry; `check:room-sim` |
| **P10.15** (A4b) | Colyseus' prediction wired to the `engine-mechanics` step (the reconciler for the own player, lerp for everyone else, predicted events) and lag compensation for hit zones; the rules as data, and the rules-module escape hatch; server-owned variables; online Flow events; `check:netcode`, `check:online-rules` |
| **P10.16** (A4c) | Bots; nearby-only state; rates tuned by the load test; Salmons rebuilt (its level, its characters from the S0 art, its rules as data) and played against the new server; its players moved over |

---

## 14. Decisions (owner)

All eight approved by the owner on 2026-10-25, as recommended.

1. **Colyseus version for the new server.**
   - *Approved:* **0.18**, the current line (0.18.0 in May 2026, 0.18.10 on 2026-10-22; 0.17 is
     now its legacy line, and 0.16's last release was October 2025). It brings the per-client views
     (§5) and most of §6: the fixed-step loop, typed inputs, prediction and reconciliation, lag
     compensation, and the message limits of §11. Salmons' current server stays on 0.15 until it is
     replaced.
2. **Where an online game's rules run** (game-families §9 #18).
   - *Approved:* **on the server, as `engine-mechanics` data**, with a named rules module for
     what the data cannot say; Flow on the device for presentation only (§4).
3. **Rates.**
   - *Approved:* **a 30 Hz fixed step with 2 physics sub-steps (physics at 60 Hz, one input per
     step), and state at 20 Hz** for the players near each device, smoothed on the device (§5, §6).
     Today's server sends 60 state updates a second, 86 KB/s to each device with 100 players once
     its obstacles are indexed (§2.1).
4. **Salmons' river: generated or authored?** Today every room gets a new river from a seed.
   - *Approved:* **keep it generated**: a seeded level generator in `engine-mechanics`, run by both
     the server and the device. The other option is fixed levels painted as tilemaps (P10.13).
5. **Bots:** how full a room is kept, which characters they play, and whether a bot can win.
   - *Approved:* fill to 20, bears and fishermen only, and bots cannot win.
6. **Rounds:** lock the room when a salmon wins (today), or start a new round in the same room after
   a pause.
   - *Approved:* **a new round after 15 s**, so a room keeps its players.
7. **Where the server runs.**
   - *Approved:* **a new service in this repository's Railway project**, so deploys, health and
     drift checks live in one place. The other option is Salmons' own Railway project.
8. **Its address.**
   - *Approved:* **`rooms.invisiblewall.org`**. The owner creates the DNS record.
