# Salmons levels — the original generator, by seed, with an authored overlay

> Status: **planned 2026-11-16; built 2026-11-17 (in review)** after the owner gave the original
> source and chose §3 b option 3. State: [status/salmons](../status/salmons.md). Agent: `arcade-games`.

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
the overlay is never changed by a reseed. The card's **Save overlays** reads the config fresh and
writes only `levels`, conditional on its ETag.

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

- A device makes its level from the config baked in its bundle; the server from the published one.
  After a republish that changes `levels`, a device on the old bundle can draw a level the server
  does not play until it reloads (the same drift as any config field, but levels are meant to change
  often). A levels hash in the room state, refused or reloaded on a mismatch, would close it.
- Bridges: generated, not drawn (no bridge art is built) and not in the rules (a bear blocked, a
  fisherman on the deck).
- Waterfall `height` is carried, but the climb still takes the engine's 4 taps.
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
  (so `secondsLeft` counts it); round 1 starts when it ends. A lobby every person left starts over.
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
