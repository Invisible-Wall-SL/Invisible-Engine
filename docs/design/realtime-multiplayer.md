# Realtime multiplayer: online arcade rooms (tier A4)

> Status: **PLAN, not approved.** Written 2026-10-25 for the owner's review. This is the design
> that [game-families.md](game-families.md) §4.5 asks for before tier A4 (P10.14–P10.16) is built,
> and it answers that plan's open decision §9 #18 (where an online game's rules run). Decisions
> for the owner are in §14.
>
> Grounded against Invisible Engine `main` 854d24d and Salmons (`GuiltyForever/Salmon-`) `main`
> c16ba9e. "Today" means those trees; "new" means proposed here.

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
| Inputs | `move {vx, vy}` every frame (client `game.js:1254`), `jump {targetX, targetY}`, `cast {targetX, targetY}`, `attack`, `respawn` |
| Rules | River current, whirlpool pull, rocks and one-way waterfalls that block, waterfall climbing by tapping, sandbanks that ground a salmon until it jumps, the bear's catch radius, the fisherman's hook, reel and landing, and the first salmon to reach the source wins and locks the room (`update`, `:370–671`) |
| Map | A seed. The server and every client generate the same river, obstacles and bridges from it (`generateMap`, `buildMeanderTable`) |
| Rejoin | 60 s grace (`allowReconnection`, `:309`) |
| Device | Dead reckoning: extrapolates each player from the server's velocity and eases towards the server's position (`game.js` `updatePlayerSprite`) |

What changes, and why:

1. **Positions become the server's alone.** `move` still accepts a position if one is sent
   (`:98–100`). The game's own client sends only a direction, so this is an open door rather than
   how the game works, but a modified client could put itself anywhere. Likewise a client chooses
   to be a golden salmon (`isGolden` from the join options, `:277`). A4 takes inputs only, and the
   server decides the rest.
2. **The rates.** Every change of every player goes to every device 60 times a second, as 8-byte
   numbers. §5 estimates what that costs in a full room and how A4 brings it down.
3. **Rules become reusable.** Today they are one `update` function written for Salmons. A4 moves
   them into `engine-mechanics`, driven by the game's config (§4), so a second online game does not
   start from a copy.
4. **The client is rebuilt on the shared runtime** (game-families §1). Its art is already in the
   pipeline and its characters already play clips by action and facing (the Salmon repository's
   `docs/art-pass.md`).

---

## 3. The shape

**In short:** devices send inputs; the server steps the world and sends state and events back.

```
device (shared runtime, online branch)                  game server (services/game-server)
  read input ─► predict own player (engine-mechanics)  ── input {seq} ──►  room, fixed 60 Hz step
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
A4. Every room would run an interpreter at 60 Hz, presentation nodes mean nothing on a server, and
one game's rules would be split between two languages. It stays open for later, if authors need
online rules the data cannot say.

---

## 5. The wire and its rates

**In short:** inputs go up only when they change, state comes down 20 times a second for the
players near you, and events arrive as they happen.

- **Input** (device → server): `input { seq, move: [x, y], buttons, aim? }`. `buttons` is a
  bitfield (jump, ability 1, ability 2); `aim` is a target point (a jump or a cast). Sent when it
  changes, and at least every 100 ms so a held key is not lost. The server applies inputs in `seq`
  order at its own fixed step and drops old or repeated ones.
- **State** (server → device, Colyseus schema): per player `x`, `y`, `z` as 32-bit floats, `facing`
  and `state` as small integers (the character state a clip is picked by), `character` once, the
  server-owned variables, and `lastInput`, the newest `seq` the server has applied (for §6). Per
  room: the phase, the level (Salmons: its seed), the round clock.
- **Events** (server → device messages): `hit`, `caught`, `roundEnd`, `joined`, `left`.

| | Today | A4 |
|---|---|---|
| Simulation | 60 Hz | 60 Hz fixed step |
| State to each device | 60 Hz, every player, 8-byte numbers | 20 Hz, players near you, 32-bit floats |
| Device to server | `move` every frame | `input` on change, at least every 100 ms |

**What a full room costs.** These are estimates, to be replaced by P10.16's load test:

- **Today:** a moving player changes about 20–25 bytes of state per patch. With 100 players at 60 Hz
  that is roughly 120–150 KB/s to every device (about 1 Mbit/s), and 12–15 MB/s leaving the server
  for 100 devices. Railway bills outbound traffic, so this is money as well as bandwidth, and 1
  Mbit/s is a lot for a phone.
- **A4:** at 20 Hz, with about 20 players near each device, roughly 6–10 KB/s per device and under
  1 MB/s from the server.

**Sending each device only the players near it** needs per-client state. Colyseus 0.15's
per-client `@filter` encodes state again for each client, which is expensive at 100; 0.16 replaced
it with per-client views (`StateView`). Verify that before relying on it in P10.16. Since
`services/game-server` is new, D1 recommends building it on 0.16. Salmons' current server stays on
0.15 until it is replaced.

---

## 6. One simulation, two places

**In short:** the server and the device run the same `engine-mechanics` step. The device runs it
early for its own player, so the controls answer at once, and corrects itself when the server's
answer arrives.

- **The same code.** `motion.js` (P10.8), `behaviours.js` (P10.11) and the rules modules are plain,
  dependency-free JS (game-families §4.0), so the server and the runtime import the same files.
- **Prediction.** The device applies its own input immediately and keeps the inputs the server has
  not yet applied. When state arrives, it puts its body where the server says it was after
  `lastInput`, then replays the inputs after it (reconciliation). A small correction is eased in
  over about 100 ms; a large one (respawn, caught) snaps.
- **Everyone else** is drawn about 100 ms in the past, between the two latest server states, so
  they move smoothly at 20 Hz.
- **Same results.** A fixed 60 Hz step and the same code give the same numbers for the arithmetic
  a step uses. Trigonometry in the step can differ in the last bits between browsers, and
  reconciliation absorbs that. Only the server rolls dice; a device never predicts another player's
  random outcome.
- **Not predicted:** hits, catches, scores and the round. They arrive from the server about 100 ms
  later. The presentation hides the wait: a swipe plays at once, and whether it caught someone
  comes after.

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

- **`services/game-server`** (new): Node 22 and Colyseus. It imports `engine-mechanics` and
  `game-config` from the workspace.
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
  faster.
- **Message limits:** a per-client rate limit and a size cap. Colyseus has none built in, so this is
  a small wrapper around the message handlers.
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
| `room-load` script (outside CI) | P10.16 | 100 headless clients (`colyseus.js` in Node) sending input at 60 Hz over real latency: server step time (p99 under 8 ms), bytes per device per second, server egress, memory |
| `docs/playtest/salmons.md` | P10.16 | Two browsers and a room of bots, played by the `game-playtester` agent |

---

## 13. Phases

The detail of game-families P10.14–P10.16. A4 needs P10.8 (the arcade loop and `motion.js`)
first. Salmons also needs P10.11 (characters, abilities and brains), P10.12 (the camera) and
P10.13 (the hop and diamond tiles) before it can be rebuilt.

| # | Delivers |
|---|---|
| **P10.14** (A4a) | `services/game-server`: a room per published game stepping `engine-mechanics` at 60 Hz; inputs-only messages; join, leave and rejoin; the state schema; `ARCADE_ONLINE_MECHANIC`, so the runtime joins a room and draws server positions (no smoothing yet); the Railway service, health and drift entry; `check:room-sim` |
| **P10.15** (A4b) | Prediction, reconciliation and smoothing; the rules as data, and the rules-module escape hatch; server-owned variables; online Flow events; `check:netcode`, `check:online-rules` |
| **P10.16** (A4c) | Bots; nearby-only state; rates tuned by the load test; Salmons rebuilt (its level, its characters from the S0 art, its rules as data) and played against the new server; its players moved over |

---

## 14. Decisions (owner)

1. **Colyseus version for the new server.**
   - *Recommend:* **0.16**, for per-client views (§5). Salmons' current server stays on 0.15
     until it is replaced.
2. **Where an online game's rules run** (game-families §9 #18).
   - *Recommend:* **on the server, as `engine-mechanics` data**, with a named rules module for
     what the data cannot say; Flow on the device for presentation only (§4).
3. **Rates.**
   - *Recommend:* **a 60 Hz simulation with state at 20 Hz**, and smoothing on the device (§5, §6),
     instead of today's 60 Hz state.
4. **Salmons' river: generated or authored?** Today every room gets a new river from a seed.
   - *Recommend:* **keep it generated**: a seeded level generator in `engine-mechanics`, run by both
     the server and the device. The other option is fixed levels painted as tilemaps (P10.13).
5. **Bots:** how full a room is kept, which characters they play, and whether a bot can win.
   - *Recommend:* fill to 20, bears and fishermen only, and bots cannot win.
6. **Rounds:** lock the room when a salmon wins (today), or start a new round in the same room after
   a pause.
   - *Recommend:* **a new round after 15 s**, so a room keeps its players.
7. **Where the server runs.**
   - *Recommend:* **a new service in this repository's Railway project**, so deploys, health and
     drift checks live in one place. The other option is Salmons' own Railway project.
8. **Its address.**
   - *Recommend:* **`rooms.invisiblewall.org`**. The owner creates the DNS record.
