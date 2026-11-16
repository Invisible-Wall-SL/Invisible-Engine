# Salmons levels — the original generator, by seed, with an authored overlay

> Status: **planned 2026-11-16, blocked** on reading the original generator (§1) and on one owner
> choice (§3 b). State: [status/salmons](../status/salmons.md). Agent: `arcade-games`.

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

## 2. Plan

**(a) One pure generator.** Port `generateMap` and `buildMeanderTable` into `engine-mechanics`
(`salmonsMap.js`) as a pure function of `(seed, params)`: the existing `createRng` (no
`Math.random`), no I/O, plain ESM. It returns the tile grid (water, bank, sandbank, rock,
waterfall, whirlpool, bridge, source, sea) and the derived river; `salmonsGeometry` turns it into
zones as today. It replaces `salmonsRiver` behind the same generator id, so the server, every device
and the editor run one function. The old band generator stays as `salmonsBands` for the recorded
traces (`check:online-rules`, `check:room-bots`) until they are re-recorded. The art's riverbed and
trees take their seed from the same level seed.

**(b) Choosing a level at runtime.** The original's behaviour: a new random seed per room, the
river kept for the room's life. Kept as the default. A config field
`arcade.online.levels: { seeds?: (string | number)[] }` lets an owner pin a list instead; a room
then takes the next seed in the list. **Owner choice before build (§3 b).**

**(c) The Scene Editor.** A generated field node (`fieldGenerator: { id, seed }` on the play field's
world node) replaces the baked river in `scenes.json`. `/editor` draws it live from the generator
with the same drawing a room uses (original art), with a seed picker (text field, ⟳ random, ◀ ▶
through the pinned list). The generated part is read-only: selecting it shows the seed, not node
fields. A `SectionCard` with the help as its `info` tooltip (rule 10).

**(d) The authored overlay.** Stored apart from the base, in the project's
`editor/levels/<seed>.json` (and `editor/levels/_all.json` for additions every level gets):
`{ version: 1, seed, add: [{ cell: [col,row], kind, ...params }], remove: [[col,row]], set: [...] }`,
keyed by the generator's tile cell. Applied after generation by one pure function
`applyLevelOverlay(map, overlay)` in `engine-mechanics`, on the server and the device and in the
editor alike. A cell the overlay names that the new base no longer has is reported in the editor
(an "orphaned" list) and kept, never dropped. Changing the seed changes which overlay file is
shown; it never writes or clears one. Saves go through the launcher's conditional-write helpers
(`pipeline-concurrency`).

**(e) Shipping (rule 8).** Overlays are a new project asset class: export them to `deploy/`, bake
the index into the bundle, pull into `static/assets/`, and register them in the runtime (the
`fontExport.ts` pattern); the game server reads the same baked index with the config. The generator
is code and ships in the runtime.

**(f) The current single level.** `salmons-1` is kept: it becomes pinned level 0, and the current
baked river in the project's `scenes.json` is converted once into its overlay's `set` entries only
where an author changed it (none known today), so nothing authored is lost. Not deleted.

**Proof.** A gate `check:salmons-levels`: for fixed seeds the generator's output equals a recorded
fixture (the original's own output for those seeds, captured from the old client), the server's
`generatedOnlineGame` and the editor's preview produce byte-equal maps for the same seed, an overlay
survives a reseed (applied, orphans listed, file unchanged), and no `Math.random` in the module.
Current games: 0 changed screens for every non-Salmons game (only Salmons names the generator).

## 3. Open before building

- **a. The original source.** `generateMap`, `buildMeanderTable` and the constants they read, from
  `GuiltyForever/Salmon-`. This session could not attach that repository. A port without it would
  be a third guess, not the original.
- **b. Owner: how a room picks its level.** (1) a new random seed per room, as the original
  (overlays then only apply as `_all` additions, or when that seed is reused); (2) a fixed list of
  seeds, each with its overlay, cycled per room or per round; (3) both: random by default, a pinned
  list when the config names one. Recommended: 3.
