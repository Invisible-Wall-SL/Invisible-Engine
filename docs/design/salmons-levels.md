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

## 3. Left open

- **The room as an authored lobby screen** (owner, 2026-11-17: "each room should have a random
  level. the room should also be a screen we can author, so people can wait there before starting
  a session"): a Scene Editor screen players wait on in a room before its session starts, built
  with the existing screen and Flow patterns. Its own PR, after this one. Salmons pins no seed:
  every room is random, as the owner asked; the pinned list stays an option for other games.

- Bridges: generated, not drawn (no bridge art is built) and not in the rules (a bear blocked, a
  fisherman on the deck).
- Waterfall `height` is carried, but the climb still takes the engine's 4 taps.
- The editor stage shows placeholders, not the original art; picking a cell is by typed gx / gy,
  not by clicking the stage.
- The original's speeds and current (6 and 1.5 tiles/s) are not taken: the config keeps the
  engine's (240 px/s salmon, 72 px/s current from the generator).
