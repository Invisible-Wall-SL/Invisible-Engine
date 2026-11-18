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
  2400 × 1800 of its own; mouse and touch on as the original (`arcade.online.pointer`: the cursor
  or a held finger steers, stopping within 72 px; a tap or click jumps a salmon and swipes or casts
  with a bear or a fisherman).
- **Its rules module** (P11.3) — `engine-mechanics` `src/salmonsRules.js`, `rules.module:
'salmons'`, on the server only: tap Space at the foot of a waterfall to climb it; a sandbank
  grounds a salmon until it taps Space; the fisherman's line hooks the nearest salmon, reels it in
  and lands it (5 taps of Space shake the hook); one salmon per round is golden and worth 3×.
- **The layout** — `engine-layout` `referenceLayouts/salmons.ts`: the loading and background
  screens, and the river as the play field's world (banks, water, rapids, whirlpools, the sea, the
  source), with a camera that follows the device's own player and the players' spawn layer.
- **The looks** — `SALMONS_CHARACTER_COMPONENTS`: three placeholder shapes (salmon pink, bear
  brown disc, fisherman yellow), each standing on its place (its bottom there), and the swipe,
  cast and splash centred on theirs. The three characters carry `characterClips`: each plays its
  S0 Invisible Flipbook clips (`salmon_pink_*`, `bear_*`, `fisherman_*`) once they are in the
  project, drawn over the hidden placeholder; the clips are not generated yet
  ([status/salmons](../status/salmons.md) open item 1). The
  runtime draws the golden salmon (the room's `mark`) gold over a glow, and a fisherman's line to
  the salmon he has hooked, from the room's state: no component carries them.
- **The original art** (built in, `engine-layout/salmons-art`, loaded lazily only for a config
  naming the `salmonsRiver` generator): the river drawn in the old game's images (grass and sand
  autotiles, the riverbed under a moving water tint, trees by biome, rocks, whirlpools, waterfalls
  with their lips and splashes) and each character as a code look animated as the old client
  did: the salmon a rope through its pink or golden texture, the bear's sprite turning to its
  heading with a claw streak on its swipe, the fisherman the old tan circle, the line 0xddddaa
  from his hand, wiggling after the cast. A published clip still wins over a code look.

It is not a published project: the playtest builds its own snapshot and config and starts its own
game server in-process. `scripts/salmons/export.mjs` writes the same documents for the `salmons`
project (owner steps in [status/salmons](../status/salmons.md)).

## Launch

```
PUBLIC_IE_FAMILIES=arcade pnpm --filter lines build
node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
  scripts/playtest/salmons-play.mjs --runtime apps/lines/build --out .cache/salmons-play
```

A runtime built without the arcade family boots no arcade game ("this runtime does not play arcade
games"). `salmons-play.mjs` plays P10.16's band river (`salmonsRiver`), whose recorded spots its
pages start at. **The original game's levels** (`salmonsMap`, what the project plays since
2026-11-17) have their own run, `scripts/playtest/salmons-levels-play.mjs` (same arguments): one
page in a random-level room makes the room's seed's level as the server does, draws it in the
original art, swims upstream with no page error, and a config pinning one seed plays it. A
page booted from a snapshot whose editor art ships the project sheet `salmons_terrain` (every
ground tile magenta) draws its banks from that sheet (`project-art.png`, over 5 % magenta), while
page A, with no such sheet, draws the built-in tiles (no magenta): the project-art path and its
fallback. A pinned level with a waterfall of height 8 added by an overlay four cells above where
salmon start (`salmons-cliff`): one `cliff` per waterfall in the art's regions, ArrowUp held with
Space tapped climbs it in place (the salmon never above the line before `climbed`) and, let go at
the top, it swims over, drawn nose up in the climb's pose while held
(`online.art.looks[me].climbing`); past the line it is drawn raised by the step, 24 + 24 × 8 px
(the probe's `drawn[].ground`); `cliff.png` at the foot and `over-the-cliff.png` after. It prints
how long the art took, the JS heap and the fps (2026-11-17, container, software rendering: art in
about 4 s, 133 MB, 24 fps).

Add `--netcode colyseus` to play it with the Colyseus SDK's own prediction
(`arcade.online.netcode`, default `engine`): the only playtest of that netcode in a nearby room with
the world camera. Each page must report the mode it ran. Run both.

Each page boots `?runtime=1&ie_determinism=7&rooms_url=ws://127.0.0.1:<port>&project=salmons`,
page A with `rooms_character=salmon`, page B with `rooms_character=bear`. The page's frames are
stepped by the determinism probe while real time passes, so the room's patches arrive between steps.

**By hand:** the same snapshot boots in any runtime build; arrows / WASD swim or walk, J swipes or
casts, Space leaps (in open water), climbs, jumps off a sandbank or shakes a hook. Open a second
tab with `rooms_character=bear` (or `fisherman`) to hunt.

## Checks (`result.json` verdicts)

1. One room on the server; both pages are in it and see themselves.
2. The bots fill the room: page A (a salmon at the sea) is sent the bots near the sea.
3. Nearby-only: the bear on its bank far upstream is not sent to the salmon at the sea, nor the
   salmon to the bear.
4. Page A's salmon starts at the sea, and page A's camera frames it.
5. ArrowUp held on page A swims its salmon upstream (against the current), and the camera follows.
6. Resting in the water, page A's salmon drifts downstream with the current, and page A draws
   it within 20 px of the room's place (its prediction of the drift, a little ahead). The river
   screen is isometric (P11.4): in `03-salmon-upstream.png` the salmon's colour is at its
   projected place (x − y, (x + y) / 2 from the camera's centre) and not at its flat one.
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
    foot; tapping Space climbs it (the room's `climbed` event: the band river's waterfalls have no
    height, so they are the original's lowest and one tap tops them) and, let go at the top, it
    swims on over the waterfall (no lift over it since 2026-11-17).
13. Mouse and touch ([design](../design/arcade-pointer-controller.md)): page P joins
    `salmons-falls` with touch emulation on. A finger held on the screen upstream of its salmon
    swims it to the waterfall's foot; dragged, then lifted, it stops steering (the current carries
    it down, and the lift is no tap); with ArrowUp held, taps on the screen are the salmon's jump and
    climb the waterfall (`climbed`; `08b-touch-over-the-waterfall.png`); with touch off, a mouse
    moved upstream of it, no button pressed, swims it there (the original's hover-to-move). Before
    the hover, a quick tap four cells across the river from the salmon (no key, the finger lifted
    at once) leaps it towards the tap: it carries the leap across, more than 120 px, where without
    the carry it would only drift down (2026-11-18).
14. Page F joins `salmons-sand` (its salmon starting just below the first sandbank): swimming up,
    it is grounded on the sand (`grounded`) and stays put with ArrowUp held; Space jumps it off
    (`jumped`) and it swims on upstream.
15. The rules' events are Flow events: page E's flow heard its `climbed`, page F's its `grounded`
    and `jumped` (each with `me`).

> **Since WS-B (2026-11-18)** the rooms play the original's catchers and one game a room (see
> [status/salmons](../status/salmons.md)): steps 16–19 below describe the old auto-hook, escape taps
> and random golden salmon and are re-recorded with WS-D's device changes. What to check instead:
> a fisherman's tap on the water (not J alone) casts the line there and the bobber (`lineX/lineY`)
> travels home, hooking the first salmon it passes and dragging it in (no escape); a caught player
> stays out until it presses Respawn and comes back as the class it picked; a bear's swipe catches
> a fisherman or a bear too; a salmon reaching the source ends the game for everyone (`gameWon`
> with the winner's name), the room takes no one new, and the winner rejoining a new room with its
> pass is golden there (cosmetic only).

16. Pages H (a fisherman) and G (a salmon) join `salmons-line` (the authored river, no bots; the
    salmon starts on a sandbank, held there, and the fisherman on the bank nearest it, within his
    cast's reach). G's salmon, the room's only one, is golden: both pages list it as marked and
    draw it gold (read off `10-golden-salmon.png` and `11-golden-seen-by-fisherman.png` at its
    look's middle); G's flow heard `golden`.
17. H's J hooks it: both pages draw the line (H's `12-the-line.png` has the line's 0xddddaa
    along the way from his hand to the salmon's middle, projected; G is stepped while H's screen
    is taken, as the reel lands it within about a second), G's flow heard `hooked` (`me`, not
    `mine`) and the flow drew the splash; reeled in and landed (`caught`), the line is gone on both
    pages (in the art its colour is the sandbank's, so the probe's `art.lines` says so rather than
    `13-landed.png`).
18. Back on the sand, it is hooked again and H leaves: the line breaks (`escaped`, heard on G) and
    is gone.
19. Page G2 (another salmon) joins and G leaves: the golden salmon passes to G2, which draws it
    gold (`14-golden-passes-on.png`) and shows the golden banner, gone again after 2 s.
20. S0 clips: pages S (a salmon) and T (a bear) join `salmons-clips` (as `salmons-sand`) from a
    snapshot that registers three stub clips (`salmon_pink_swim_se`, `salmon_pink_swim_ne`,
    `salmon_pink_hop_se`, green 32 × 64 frames with their box, on a sheet in `editorArt`). The probe's
    `online.clips` (room id → `{ clipId, flipX }`) and `online.clipLog` (each change) say what is
    played: swimming downstream (screen south-west) is `swim_se` mirrored; swimming upstream is
    `swim_ne`; grounded on the sand, `15-salmon-clip.png` has the clip standing on its feet, gold
    (the room's only salmon is golden) from the feet to 180 px up and not above (90 wide, the
    body's width); Space jumps it off: `hop_se` (the vertical twin, no `hop_ne`) once, then
    `swim_ne`. T's bear has no clips: no clip in its probe, and its code look (the bear sprite,
    brown fur at its middle) in `16-bear-code-look.png`.
21. No page sends the RGS anything; no page error.
22. The original art (the probe's `online.art`): page A draws its room's river in the old images
    (grass `> 100` centre tiles and edge tiles, `> 50` trees, one rock sprite per rock of the river
    its seed makes in Node, four whirlpool frames per pool, two face layers per waterfall, sand on
    the sandbanks), and its salmon (golden) as a rope through `salmon_golden`; page B its bear as
    the `bear` sprite, its claw streak showing on the press; page H its fisherman as the circle
    with a hand, and the line's colour 0xddddaa; page G2 its own salmon `salmon_pink` and G's
    `salmon_golden`. Last, the server shuts down: page A's river art is torn down (the probe's
    `fieldArt`: none drawn, and every container it made destroyed).
23. The leap (the original's, checked on page A right after its art): Space in open water lifts
    its salmon off the river and it curls (the probe's `online.art.looks[me]`: `lift` above 30 px,
    `curl` above 0.3; the top of a leap is 72 px), then it lands again (`lift` 0). The heights and
    the pose are pinned against the old game's numbers by `pnpm check:salmons-jump`.

The bots are bears with a brain that stands still: each room places them on its own river's
banks, so the hunt (`check:room-bots`') stays out of this test. Page A is its room's only salmon,
so it is golden and check 6 takes its colour as pink or gold. A salmon swimming in open water is
drawn under the water's tint (2026-11-18): check 6 reads its colour back through each of the
river's tints, and the golden checks (16, 19) take a swimming salmon's look as the golden texture
(the probe's `underwater`), since only a quarter of its gold shows. 76 verdicts.

Every page boots the snapshot's config, which names the generator, so every page draws the art,
and the pages of the authored-river rooms (E, F, G, H, P, S, T) draw a river of the room's seed while
the server plays the authored one: their verdicts read the room's state, not the drawn river.

Screens: `01-salmon-at-the-sea.png`, `02-bear-on-its-bank.png`, `03-salmon-upstream.png`,
`04-bear-swipes.png`, `05-another-river.png`, `06-round-over.png`, `07-at-the-waterfall.png`,
`08-over-the-waterfall.png`, `08b-touch-over-the-waterfall.png`, `09-grounded.png`, `10-golden-salmon.png`,
`11-golden-seen-by-fisherman.png`, `12-the-line.png`, `13-landed.png`, `14-golden-passes-on.png`,
`15-salmon-clip.png`, `16-bear-code-look.png`.

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

- The swipe, cast and splash are placeholder looks (drawn over their user). The swimming salmon is
  drawn under the water's tint by a colour matrix, without the old client's displacement wobble
  (no verdict reads it; `check:salmons-jump` pins the threshold and the tint). The clip path is
  played with stub clips only: the bear's and fisherman's one-shots,
  the reel and the `caught` hold are pinned by `pnpm check:character-clips`, not in a browser.
- A device that joins, or comes near, after a hook does not draw that line (it knows of a line
  only from the room's `hooked`).
- A climb and a reel move a body on the server only: the own device sees them as a correction.
  So does passing over a waterfall once the salmon is as high as it, over a rock at half a cell, or
  out of a whirlpool's pull, and a leap's launch (its carried move is predicted after it).
- `salmons-play.mjs` checks only the band river's one-tap waterfalls; the height-8 climb and its
  pose are in `salmons-levels-play.mjs`. Next verdict idea: at a waterfall of height 3 or more,
  `online.art.looks[me].lift` steps up by 2.4 × 24 px a tap.
- A device that closed stays in the room for its reconnection window and is still drawn there
  (seen in `14-golden-passes-on.png`).
- Salmon are kept off the banks by a push, not a wall.
