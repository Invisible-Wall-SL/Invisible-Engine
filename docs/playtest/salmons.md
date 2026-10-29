# Playtest — Salmons (`salmons`)

The arcade reference project, rebuilt on the shared runtime as data
([game-families](../design/game-families.md) P10.16,
[realtime-multiplayer](../design/realtime-multiplayer.md)). Up to 100 players in one room on the
game server (`services/game-server`): salmon swim up a river from the sea to the source, bears and
fishermen hunt them from the banks, and bots fill each room to 20 as bears and fishermen. Status:
[status/salmons](../status/salmons.md); the engine pieces are in
[status/game-families](../status/game-families.md) (P10.16).

What it is made of, all generated from one seed (`SALMONS_SEED`):

- **The river and the config** — `engine-mechanics` `src/salmons.js`: `salmonsRiver(seed)` (15
  bands from the sea at the bottom to the source at the top, each with banks, a current running
  down — some are rapids — a few whirlpools, and since P11.3 rocks, sandbanks and waterfalls) and
  `salmonsConfig(river)`: a 1800 × 7200 field;
  three characters (`salmon` 240 px/s, `bear` 190 px/s at most 30, `fisherman` 140 px/s at most
  20; bears and fishermen start on the banks); the currents, whirlpools and banks as zone forces
  on salmon; rocks solid, waterfalls solid to a salmon coming from below, and the water, sea and
  source solid to bears and fishermen; the bear's swipe (110 px, out 3 s, +1) a `catch` and the
  fisherman's cast (280 px, out 4 s once landed, +2) a `hook`, both on J; the source as the goal
  (+10), 300 s rounds and 15 s between them; bots fill to 20 as bears and fishermen with the
  `bearBot` / `fishermanBot` brains and cannot win; each device is sent only the players within
  2400 × 1800 of its own.
- **Its rules module** (P11.3) — `engine-mechanics` `src/salmonsRules.js`, `rules.module:
  'salmons'`, on the server only: tap Space at the foot of a waterfall to climb it; a sandbank
  grounds a salmon until it taps Space; the fisherman's line hooks the nearest salmon, reels it in
  and lands it (5 taps of Space shake the hook); one salmon per round is golden and worth 3×.
- **The layout** — `engine-layout` `referenceLayouts/salmons.ts`: the loading and background
  screens, and the river as the play field's world (banks, water, rapids, whirlpools, the sea, the
  source), with a camera that follows the device's own player and the players' spawn layer.
- **The looks** — `SALMONS_CHARACTER_COMPONENTS`: three placeholder shapes (salmon pink, bear
  brown disc, fisherman yellow). The S0 clips are not generated yet
  ([status/salmons](../status/salmons.md) open item 1); they replace these components.

It is not a published project: the playtest builds its own snapshot and config and starts its own
game server in-process. `scripts/salmons/export.mjs` writes the same documents for the `salmons`
project (owner steps in [status/salmons](../status/salmons.md)).

## Launch

```
pnpm --filter lines build
node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
  scripts/playtest/salmons-play.mjs --runtime apps/lines/build --out .cache/salmons-play
```

Add `--netcode colyseus` to play it with the Colyseus SDK's own prediction
(`arcade.online.netcode`, default `engine`): the only playtest of that netcode in a nearby room with
the world camera. Each page must report the mode it ran. Run both.

Each page boots `?runtime=1&ie_determinism=7&rooms_url=ws://127.0.0.1:<port>&project=salmons`,
page A with `rooms_character=salmon`, page B with `rooms_character=bear`. The page's frames are
stepped by the determinism probe while real time passes, so the room's patches arrive between steps.

**By hand:** the same snapshot boots in any runtime build; arrows / WASD swim or walk, J swipes or
casts, Space climbs, jumps off a sandbank or shakes a hook. Open a second tab with
`rooms_character=bear` (or `fisherman`) to hunt.

## Checks (`result.json` verdicts)

1. One room on the server; both pages are in it and see themselves.
2. The bots fill the room: page A (a salmon at the sea) is sent the bots near the sea.
3. Nearby-only: the bear on its bank far upstream is not sent to the salmon at the sea, nor the
   salmon to the bear.
4. Page A's salmon starts at the sea, and page A's camera frames it.
5. ArrowUp held on page A swims its salmon upstream (against the current), and the camera follows.
6. Resting in the water, page A's salmon drifts downstream with the current, and page A draws
   it within 20 px of the room's place (its prediction of the drift, a little ahead).
7. Page A shows the HUD (SCORE, ROUND, TIME) over the river, with the room's round and its own
   score (variables the room owns).
8. Page B's J draws the bear's swipe on the press, before the room tells of it; the room then
   tells, the swipe is not drawn twice, and it is gone after 300 ms.
9. A river per room (P11.2 e): pages A and B (one room) report the room's seed and make the same
   river from it, the very zones `generatedOnlineGame` makes from that seed in Node, and draw it
   (`online.fieldDrawn`: the loaded doc held the `river` node it replaced); page A's salmon started at that river's sea, where the server put it;
   it is not the authored river; page C (another room) plays another river, its own room's.
10. Page C joins `salmons-short` (the same game with 5 s rounds, no bots): the round ends, the
    round-over screen comes up counting down, and round 2 hides it again.
11. Page D boots the same game with a layout that lost its `river` node: it stops on the failure
    screen before the game mounts, saying to keep a node with id `river` or remove
    `arcade.online.generator`, and leaves the room (the server's room count is back where it was).
12. Page E joins `salmons-falls` (the authored river, no generator, no bots, its salmon starting
    just below the river's first waterfall): ArrowUp held, the salmon stops at the waterfall's
    foot; tapping Space climbs it (the room's `climbed` event) and it is above the waterfall.
13. Page F joins `salmons-sand` (its salmon starting just below the first sandbank): swimming up,
    it is grounded on the sand (`grounded`) and stays put with ArrowUp held; Space jumps it off
    (`jumped`) and it swims on upstream.
14. No page sends the RGS anything; no page error.

The bots are bears with a brain that stands still: each room places them on its own river's
banks, so the hunt (`check:room-bots`') stays out of this test. 36 verdicts.

Screens: `01-salmon-at-the-sea.png`, `02-bear-on-its-bank.png`, `03-salmon-upstream.png`,
`04-bear-swipes.png`, `05-another-river.png`, `06-round-over.png`, `07-at-the-waterfall.png`,
`08-over-the-waterfall.png`, `09-grounded.png`.

## What the gates already prove (not replayed here)

`pnpm check:room-bots`: the river is the seed's and the config validates clean; a salmon that
steers for the water's middle reaches the source and wins the round; the current carries a salmon
down and a bank pushes it back; a bear bot on its bank catches a salmon near the shore and never
steps into the water; bots fill to `fillTo`, give their place to a person and cannot win; a seeded
room replays exactly; nearby-only state over a real server. `pnpm check:online-rules` replays
Salmons' recorded traces exactly (`packages/engine-mechanics/fixtures/salmons-traces.json`: the
climb, the sandbank, the line with a landing and an escape, the golden salmon) and holds a device's
prediction against a rock and the river to the room's. `scripts/room-load.mjs` fills a Salmons
room with 100 devices (status P10.16 and P11.3 have the numbers).

## Known gaps

- Placeholder looks (the swipe and cast too; a swipe is drawn over its bear); the golden salmon is
  not drawn gold yet (the room sends it as the player's `mark`), and the line is not drawn.
- The line, the climb, the sandbank and the golden salmon raise room events (`hooked`, `escaped`,
  `climbed`, `grounded`, `jumped`, `golden`) that Flow does not hear yet: no sound or cue.
- Salmon are kept off the banks by a push, not a wall.
- The line and the golden salmon are played by the gates only, not in a browser here.
