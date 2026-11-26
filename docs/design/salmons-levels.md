# Salmons levels — the original generator, by seed, with an authored overlay

> Status: **planned 2026-11-16; built 2026-11-17 (in review)** after the owner gave the original
> source and chose §3 b option 3; **§5 built 2026-11-24 (in review)**; **§3's device and room on
> one level built 2026-11-25 (in review)**. State: [status/salmons](../status/salmons.md). Agent:
> `arcade-games`.

**Owner report (2026-11-16):** the original game generated each level from an algorithm; the
Scene Editor shows something else, only one level, and the original function seems gone. The
editor should show the level a seed generates, and authors should be able to add things on top.

## 1. Why the editor and the game differ (investigated 2026-11-16)

1. **The generator is not the original's.** The original makes its map from a seed with
   `generateMap` and `buildMeanderTable` (`GuiltyForever/Salmon-`, server and client;
   [realtime-multiplayer §2](realtime-multiplayer.md#2-what-salmons-does-today)): a meandering
   river on a tile grid, about 1,700 obstacles (1,507 sandbank tiles), bridges. P10.16 (#1422)
   wrote a new generator instead, `engine-mechanics` `salmonsRiver`: 15 straight bands of 450 px,
   one rock and one sandbank per band at most, waterfalls across the whole river, no bridges. Its
   numbers are listed as "chosen here, owner may overturn" in the status file. The original was
   never ported, and its source is not in this repository.
2. **The editor shows one baked river.** `scripts/salmons/export.mjs` runs `salmonsRiver('salmons-1')`
   once and writes the result into `editor/scenes.json` as plain nodes. A room picks a random
   numeric seed (`services/game-server` `arcadeRoom.ts`), so no room ever plays `salmons-1`.
3. **The editor draws it differently.** The editor shows the placeholder rectangles
   (`salmonsRiverNode`); a room draws its river in the original art (`salmonsArt/river.ts`), whose
   trees and riverbed come from a second seeded random.
4. **Additions are dropped.** `generatedOnlineGame` replaces the authored zones and zone rules with
   the generated ones, so anything added to the authored river in `/editor` or `/config` never
   reaches a room.

So the game does generate a river per room; what is missing is the original algorithm, an editor
that shows a seed's level, and a way to keep additions.

## 2. Plan (as built)

**(a) One pure generator.** `engine-mechanics` `salmonsMap.js` ports `generateMap`,
`buildMeanderTable` and the constants they read line for line; `seedrandom.js` ports `seedrandom`
3.0.5's ARC4 stream, so a seed makes the original's level exactly (a number seed is its decimal
string). No `Math.random`, no I/O. `salmonsMapRiver(seed, overlay)` turns the map into the engine's
river (one grid cell = 48 world px, the source at the top): a band per run of equal-width columns, a
band starting at every waterfall, rocks 1.5 cells, a sandbank rect per run of sand across a column,
whirlpools at their cells. `salmonsGeometry`, both drawings and the rules read it unchanged. It is
the generator `salmonsMap`; the server, every device and `/editor` call it. P10.16's band generator
stays as `salmonsRiver` (its recorded traces still use it). Bridges are generated and carried, not
yet drawn or played.

**(b) Choosing a level** (owner, 2026-11-17: both). With no pinned seeds a room takes a new random
seed, as the original did; `arcade.online.levels.seeds` pins a list, each new room taking the next
(`onlineGenerators.js` `roomLevelSeed`, `services/game-server` `arcadeRoom.ts`).

**(c) The Scene Editor.** The river node carries `generated: { generator, seed }` and is locked.
`/editor`'s **Generated level** card (`EditorGeneratedLevel.svelte`, `$lib/editor/generatedLevel.ts`)
picks a seed (field, ⟳, ◀ ▶ through the pinned list) and redraws the node with the room's own
generator and drawing (`generatedLevelCore.ts`), with the config's overlays on. The editor stage
draws it as placeholder shapes; the original art draws only in a room (the stage is not `IsoWorld`).

**(d) The authored overlay.** In the Game Config, `arcade.online.levels.overlays`, by seed or `'*'`
(every level): `{ add: [{ cell: [gx, gy], kind, height? }], remove: [[gx, gy]], set: [{ cell, height }] }`,
in the original's grid. `applySalmonsOverlay` lays it on the base (remove, then set, then add); an
entry the level has no place for is returned in `orphans` and listed in amber, never dropped, and
the overlay is never changed by a reseed. The card's **Save levels** (**Save overlays** until
§5) reads the config fresh and writes only `levels`, conditional on its ETag.

**(e) Shipping (rule 8).** The overlay is part of the Game Config, which already travels export →
deploy → bake → pull → register and is what the game server loads, so it adds no asset class.

**(f) The current single level.** Kept: the export now writes the original generator's level 1
(`SALMONS_MAP_SEED`) as the scene's river; the old `salmons-1` band river is still what
`salmonsRiver('salmons-1')` makes, and that generator still plays it.

**Proof.** `pnpm check:salmons-levels`: the PRNG and seven seeds' maps and meanders match streams
and hashes recorded from the original repository with the real `seedrandom`; the generator holds no
`Math.random`; the exported config names `salmonsMap` and validates; the river's water is the
original's water; a room, a device and `/editor` make the same level for a seed; an overlay adds,
removes and re-heights; a reseed reports orphans and leaves the overlay unchanged; pinned seeds
cycle; Game Config keeps only valid level entries; a salmon swims a whole original level and wins.
`scripts/playtest/salmons-levels-play.mjs` plays it in a browser. Cost (2026-11-17, container): a
level is about 730 zones (P10.16's river: 71); a room step with 80 players takes 0.37 ms (0.04), about
1% of a core at 30 Hz; a device's art loads in about 4 s at about 135 MB of JS heap.

## 3. Left open

- Salmons pins no seed: every room is random, as the owner asked; the pinned list stays an option
  for other games.

- **A device and its room on one level: closed 2026-11-25** (in review; owner: "changing the seed
  generates a new level, but does not update collisions").
  - **What was open.** A device made its level from the config it booted with, the game server
    from the published one, and nothing compared the two. This list named one case: after a
    republish that changes `levels`, a device on the old bundle draws a level the server does not
    play until it reloads. It did not name the common one. Every launcher link is an authoring
    boot (`ie_authoring=1`), which boots the project's LIVE config, not the published one. So
    from a **Save levels** in `/editor` until the next Publish, the launcher's game drew the saved
    `levels` while its room collided against the published ones: one seed, two rivers, about 397
    of 400 columns of water apart.
  - **How it is closed** (the owner's decision: the device adopts the room's levels, so the picture
    is always the collisions). A room's state carries, beside its seed, the levels its generator
    read for that seed (`levels`: the JSON of `salmonsMap.js` `seedLevels`, which is the shape and
    the one overlay laid on that seed's level, with no pinned seeds) and a fingerprint of the
    level it made (`levelHash`: of the generator's geometry, the field, zones, zone rules and
    spawns, and of nothing else in the config). The device makes its level from the ROOM's levels
    (`onlineGenerators.js` `roomLevelGame`, the one decision `online.ts` wires). When its own
    differ, an authoring boot shows a notice naming what differs (river, waterfalls, overlays) and
    a player's boot shows nothing. A device whose level still has another fingerprint (its
    generator is another release than the game server's) leaves the room and stops on the error
    screen, which says to reload.
  - **Edges.** Levels longer than 16,384 characters are not sent or read, and the fingerprint
    alone then decides. A refusal is a hard stop: a later change to a generator must be out on
    both the runtime and the game server before a device can join. A room of a game server older than the two fields says neither, and the device plays
    its own config's level as before; a runtime older than them ignores them. A game with no
    generator reads, makes and checks nothing.
  - **Still open.** A room whose config names no generator says nothing, so a device whose own
    config names one (or the reverse) is not caught: that is the generator's id drifting, not its
    levels, the same drift as any other config field.
  - Proof and what is live: [status/salmons](../status/salmons.md); `pnpm check:room-levels`.
- Bridges: generated, not drawn (no bridge art is built) and not in the rules (a bear blocked, a
  fisherman on the deck).
- Waterfall `height`: closed 2026-11-17 (the original's climb and the raised river;
  [status/salmons](../status/salmons.md)).
- The editor stage shows placeholders, not the original art; picking a cell is by typed gx / gy,
  not by clicking the stage.
- The original's speeds and current (6 and 1.5 tiles/s) are not taken: the config keeps the
  engine's (240 px/s salmon, 72 px/s current from the generator).

## 4. The lobby (built 2026-11-17, its own PR)

Owner (2026-11-17): "the room should also be a screen we can author, so people can wait there
before starting a session"; the start rule chosen: **players or timer**, with a countdown; between
rounds, **straight to the next round** (the lobby is only before the first).

- **Rules** (`engine-mechanics` `onlineRules.js`): with `arcade.online.rules.lobby`
  (`minPlayers`, `maxWaitSeconds`, `countdownSeconds`; defaults 4 / 60 / 10) a room stays
  `waiting` after joins. Each person who joins raises `lobby`; once `minPlayers` people (never
  bots) are in, or `maxWaitSeconds` after the first, `countdown` raises and `endsAt` is its end
  (so `secondsLeft` counts it); round 1 starts when it ends. Since 2026-11-26 `endsAt` runs from
  the first person (§4.2). A lobby every person left starts over.
  No `lobby`: the first join starts round 1, as before, so no other game changes.
- **Game Config**: the block, normalised, resolved with its defaults, held to its limits (1–100
  people, 0–600 s, 0–60 s; a warning outside, and when it waits for more people than a room holds);
  `/config`'s Online rules has a Lobby tick and its three numbers.
- **Screens and flow**: Salmons' layout carries two authored canvas screens, **Lobby** and **Lobby
  countdown** (`salmonsLobby`, `salmonsCountdown`), edited in `/editor` like any screen. Salmons'
  flow shows the lobby when the room's `phase` is `waiting` as the game shows (a signal raised while
  a device still loads reaches no flow) and on the device's own `lobby`, the countdown when the
  clock runs or on `countdown`, and hides both at `roundStart`. The export ships Salmons' lobby
  (`SALMONS_LOBBY`, 4 people / 60 s / 10 s).
- **Proof**: `pnpm check:room-lobby` (10 checks) and the lobby pages of
  `scripts/playtest/salmons-levels-play.mjs` (two browsers: the lobby screen, then its countdown on
  both, then round 1 with both gone).

### 4.1 A class picked in the lobby (built 2026-11-25)

Owner (2026-11-25): "add some UI to the waiting room so that a player can change the played
character". The lobby's first form (2026-11-17 to 2026-11-20) left the room and joined again as
the new choice. This one changes the class **in place, through the room**: nobody leaves.

- **The room** (`services/game-server` `roomSim.ts`, `engine-mechanics` `onlineRules.js`
  `picking`): in a game with a lobby, until round 1 starts (the countdown included), a person's
  input that carries `respawn` for a class other than its own changes its class by the rule a
  caught person's Respawn already follows. By shares: a place of that class a person has not
  taken; its newest bot leaves, and a bot is let back into the class left. By count: any place
  while the class is under its `max` (or has none), and at its `max` the place of its newest
  bot, which leaves. Then a new body and a new start, `respawned`; or, with no such place,
  `respawnRefused` and nothing changes. A pick of its own class does nothing (no move, no spawn
  turn), so a device may send its pick on several inputs. A refused pick does not spend the input:
  the person moves on it. Once round 1 runs, `respawn` is read only for a caught person, as before.
  Bots never pick. A game with no lobby, and a 3D room, are untouched.
- **No config field.** Every game with `rules.lobby` has it. Nothing is added to the Game Config,
  the layout or the flow; the note is drawn in the node the published layout already has.
- **The room says so** (`schema.ts` `roomFields.picking`): the state carries one more field, true
  while its people may pick, written only by a game with a lobby. A device offers the classes only
  while the state says so, so on a game server older than the pick the lobby looks as it did, and
  no button does nothing.
- **One answer for each run of inputs that ask for the same class.** A device sends what it asks
  on every input until it is answered, so the inputs after a refused one ask again with no new
  press. They are that same ask: the room neither tells the refusal again nor tests the place
  again, even if one has opened, so nobody is let in behind a refusal its device already shows.
  An input that asks for nothing, or for another class, ends the run. This replaced "once a
  catch" for a caught person too.
- **The device** (`engine-mechanics` `createRespawnAsk`, one for the lobby's row and the death
  screen's Respawn, wired in `apps/lines` `online.ts`): a press is sent as `respawn` on every
  input until the room acknowledges one that carried it (`ack`). The room answers on the very
  input that asks, so the state that acknowledges it says the answer: in the lobby the class
  asked for, or another (no place left); on the death screen back, or still out (no place left).
  The device reads the answer off the state alone, whatever events arrive and in whatever order,
  shows a refusal, and sends nothing after the answer. A press right after inputs that asked for
  the same class first sends one input that asks for nothing, so every press is a run of its own
  and is answered. An ask ends with its answer, a newer press, or the room no longer taking it
  (round 1 started; the player is back).
- **Spawned again as its new class** (`online.ts` `draw`): a class change despawns the player's
  instance and the same frame spawns its new class's component, on every device that draws it.
  A lobby pick never hides the player, so nothing else would replace it.
- **On screen** (`engine-layout` `salmonsArt/screens.ts` `createLobbyNote`): under "You are NAME, a
  CLASS", "Play as" and a row of Salmon, Fisherman, Bear, the one the ROOM has the device as lit. A
  press asks at once; there is no second button. A refused pick shows the death screen's "No place
  left for that one: pick another" under the row, until the next press or the lobby's end. The
  row is drawn smaller on a canvas narrower than it. It stays through the countdown, which the
  flow shows over the same lobby screen.
- **A press on a class is the screen's.** Its `down` is withheld from the pointer and the touch
  control (`online.ts` `listenPointer`), so the press begins nothing there; its moves and its lift
  still arrive and find no press. So it steers nothing and is no tap, jump, swipe or cast, also
  in the step round 1 starts. Whether a press is a class's is Pixi's own hit test's answer
  (`screens.ts` `takes`), the one that gives the button its tap.
- **Events.** No new event: `respawned` and `respawnRefused`, whose Flow descriptions now name
  the lobby. Salmons' flow has no node on either.
- **Proof**: `pnpm check:room-lobby` (35 checks: the room's rule, the device's half played against
  the room 0, 1, 4 and 9 steps away for a pick and for a Respawn, a live Colyseus room with an
  SDK client) and the lobby pages of `salmons-levels-play.mjs` (a class pressed alone, during the
  countdown, round 1 as picked, each spawned as its class's component, a refusal on a 390 × 844
  phone).

### 4.2 The whole clock, and the next game by itself (built 2026-11-26)

Owner (2026-11-26): "have the all countdown showing up, and just blink in red with a pulse the last
10 seconds"; and, asked whether the next room should start after the win screen with no press,
"yes, it should starts automatically".

- **Where the start time lives: the room's `endsAt`, no new field.** It already meant "the step
  the phase ends at" and the device already turns it into `secondsLeft`. From the lobby's first
  person it is now round 1's start at the latest, `maxWaitSeconds` + `countdownSeconds` after that
  join; a person joining mid-wait does not move it; when enough people come early the countdown
  sets it to its own end (it drops to `countdownSeconds`); when the wait runs out the countdown
  ends where the clock already pointed; a lobby everyone left has none (0), as has a lobby with
  bots only. Nothing else read `endsAt` while a room waits. No schema, config, layout or flow
  change.
- **Old and new, in either order.** A new runtime on a game server that is not redeployed gets no
  `endsAt` until the countdown, so it shows what it shows today. An old runtime on a new server
  computes the whole `secondsLeft`, and its flow (the published one is the seed's) already shows
  the countdown screen whenever `secondsLeft` is above 0 as the lobby is checked: it shows the
  whole clock as plain text, no red. A published flow made from the seed needs nothing. One that
  shows the countdown screen only on the `countdown` event shows the clock from the countdown, as
  before.
- **On screen** (`salmonsArt/screens.ts` `createLobbyClock`): drawn in place of the countdown
  screen's seconds node `sm-countdown-seconds` (`SALMONS_SCREEN_ART.clock`), a text node every
  published layout has, so a published layout gets it with no upload and shows the plain number
  until the art is in. White and still; in the last `SALMONS_CLOCK_URGENT` (10) seconds red, each
  new second growing it by 45 % and easing back over 450 ms, faint for the last third of each.
  The class picker is untouched and stays usable to the end.
- **The next game by itself** (`salmonsArt/winAnimation.ts`, `online.ts`): on the win screen of
  a person who played the round (an input of theirs that moved, pressed or asked for a respawn
  while it ran: `Session.played`, cleared at `roundStart`), "Next game in N" counts
  `NEXT_GAME_SECONDS` (10) over the button and at 0 does what the button does. The button stays
  and joins at once; once joining it reads "Joining…" and the count goes. Winner and losers
  alike. It counts only for someone watching: a page hidden when the screen comes, or hidden once
  while it counts, stops it for good, and shown again it does not join by surprise; the button
  then waits, as before. The screen taken away (a `roundStart` of a game of rounds) stops it too.
  An idle tab therefore never hops rooms on its own. Its failures are the button's
  (`failSwitch`).
- **Proof**: `pnpm check:room-lobby` (42: the clock's rule in the sim and on a live room, the
  pins of the device's halves), `salmons-levels-play.mjs` (the clock from the first person, ticking,
  cut when the room fills, red and pulsing at the end) and `salmons-rejoin-play.mjs` (the count,
  a click while it counts, the join at 0, an idle page and a hidden one), both netcodes.

## 5. The river's shape and waterfalls, from the config (built 2026-11-24)

Owner (2026-11-24): the waterfalls are "not getting as tall as I expect", and the river needs
"more turns, that can have the player go right to left sometimes instead of always left to right…
more 140 degree turns around the source".

**Why the waterfalls were short.** The ported original caps a waterfall's height by its place: 8
at the source falling to 1 at the sea, each waterfall up to 4 under its cap. Over 2,000 seeds 32 %
of waterfalls were 1 cell high (a 72 px cliff, barely a ripple line on screen), the three nearest
the sea, the first a salmon meets, were always 1 or 2, and 3 % reached 8. Nothing was clamped in
the drawing: a cliff is (32 + 16 × height) × 1.5 px and is drawn at full size. The height range
was not a setting anywhere.

**The plan, as built.** `arcade.online.levels` gained two optional blocks, read by `salmonsMap.js`
(`levelShape`, `riverCourse`; `generateSalmonsMap`, `applySalmonsOverlay` and `salmonsMapRiver`
take the shape). With neither, a level is the original's to the byte.

- **`river: { winding, sharpestTurn, sourceBias }`.** Present, even empty, the river winds:
  straight reaches from the source down, each a few river-widths long and turned to the other side
  of the last by up to half `sharpestTurn` (0–150°, default 140), so a bend turns the river by up
  to all of it. `winding` (0–1, default 0.75) is the share of reaches that bend; the others run
  nearly straight, and the first two below the source always bend. `sourceBias` (0–1, default 0.6)
  keeps the sharpness for the source. The river runs straight at the source (4 columns), each side
  of a waterfall (3 to 6 columns, by its width) and through the delta (below 75 % of the river).
  The water is every cell whose centre is within the original's half width of that line, so a
  reach is as wide across its flow as the original's river there.
- **`waterfalls: { count, heightMin, heightMax }`.** `count` (0–12) waterfalls are spread evenly
  above the delta; 6 are the original's columns 40, 80 … 240. `count` alone keeps the original's
  heights. A height given (cells, 1–16) makes every waterfall a whole number of cells uniformly
  between the two; the end left out takes the original's limit (1 or 8), and two given the wrong
  way round are swapped.
- **One run of water a column.** A column (`gx`) still holds one run of water: the river never
  turns back up its own columns. That is what keeps a waterfall one line across the world, and the
  elevation (`salmonsElevation.ts`), the bears' waterfall block, sight and the bots' row chart
  unchanged.
- **Right to left.** A reach turned more than 45° from straight up the river runs the other way
  across the isometric screen. On Salmons' mirrored screen straight upstream is right to left; a
  reach turned past 45° towards −x runs left to right. On an unmirrored screen it is the +x side
  that reverses.
- **Game Config** (`levelsShape.ts`): `LevelsRiver`, `LevelsWaterfalls`, their defaults and limits.
  The two blocks are **carried, not normalized**, as the touch schemes are: `normalizeGameConfigDoc`
  is in every runtime's bundle, and a change to it moved the slot, match-3 and card runtimes
  (`check:runtime-bytes` caught +308 to +383 B), so it still drops them. The game server
  (`configSource.ts`) and the device (`online.ts`) read them off the raw config
  (`shapedOnlineGame`); the launcher's load, save and Raw JSON put them back (`withLevelsShape`),
  and so does the export. A value out of range is left out, with a warning at save
  (`validateLevelsShape`), as is a lowest waterfall above the highest.
- **Salmons** ships `SALMONS_LEVELS` (`salmons.js`): the default river and 6 waterfalls of 5 to 10
  cells (168 to 288 px cliffs). `scripts/salmons/export.mjs` writes it as the config's `levels`
  and draws the scene's level with it.
- **`/editor`**: the Generated level card's **Winding river** tick and its three numbers, and
  **Waterfalls**, **Lowest (cells)**, **Highest (cells)**, shown on the stage at each change
  ([guide](../tools/invisible-editor.md#generated-level-an-online-arcade-field-made-from-a-seed)).

**Shipping (rule 8).** The shape is part of the Game Config, as the overlays are (§2 e): no new
asset class. A published game changes only after a re-export and a publish. A device whose config
has other `levels` than its room (an old bundle, a launcher link before the publish) plays the
room's (§3, closed 2026-11-25).

**Proof.** `pnpm check:salmons-course` (21 checks over 48 seeds): a config from before keeps its
river to the byte (hashes recorded from main `36b42be`); one run of water a column; a reach at
least 0.8 of the original's width across its flow, and no merged reaches; every seed has reaches
running the other way across the screen; bends reach about 140° and are sharpest and densest round
the source; the settings are respected; waterfalls are as many and as high as the config says and
reach the tall end, each square across a straight run; the climb, the bears' block and the
elevation hold for a tall waterfall, and one of 16 cells is climbed; spawns, obstacles and
overlays lie where they must and all the water is reachable; Game Config keeps a valid shape; a
room, a device and `/editor` make the same level; bot salmon swim it and one wins. Two scripts are
for a person to look: `scripts/salmons/river-overview.mjs` draws a whole river as a PNG and prints
`courseFacts` per seed (`--shipped`, `--levels <json>`, `--unmirrored`), and
`scripts/playtest/salmons-river-tour.mjs` ([playbook](../playtest/salmons.md)) screenshots a
browser's salmon at each waterfall, across-reach and sharp bend. `scripts/salmons/measure-room.mjs`
measures Salmons' shipped levels by default and the original's with `--original`.

The gate also caught a second bug while this was built: on a slanted reach a bear's or a
fisherman's spawn place took the water's edge of the column above its drawn row and could land in
the water. The course's `edge` now takes the outermost of the column's and its neighbours'.

**Left open.**

- No true doubling back in world space. A hairpin would need more than one run of water a column,
  and waterfalls as lines, the elevation by row, the bots' chart and the bank walls all assume one.
- On a slanted reach the current still pushes straight down the world's columns, not along the
  reach (the movement step was out of scope).
- In the wide lower river a waterfall meets a bend within a few columns of its straight run.
  At the limits' corners (`sourceBias` 0, `sharpestTurn` 150) its face is up to 2.5 river widths
  across; as shipped at most 1.1. A straight run that grows with the angle would fix it.
- On a slanted reach the art's grass strip and forest wall (`salmonsArt/river.ts`) are measured
  along the column, so across the flow they are about a third as deep: trees stand close to the
  water and hide the near bank.
- `count`'s columns are evenly spread, not authored; an overlay can still add or remove a
  waterfall.
