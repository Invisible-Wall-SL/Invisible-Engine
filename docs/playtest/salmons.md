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
  3300 × 3300 of its own (`check:room-bots` holds the box to what the camera shows); mouse and touch on as the original (`arcade.online.pointer`: the cursor
  or a held finger steers, stopping within 72 px; a tap or click jumps a salmon and swipes or casts
  with a bear or a fisherman).
- **On the original's levels** (`salmonsMapRiver`, what the export ships; since 2026-11-18; the
  band river plays as before): the original's speeds (`salmon` 288, `bear` 216, `fisherman` 240 px/s); a bank is a wall that stops
  a salmon's centre at the middle of the edge cells (no push); the whirlpool pulls
  `d·14·(1 − d/4)` cells/s; a salmon is grounded each time it comes down on sand, and passes a
  topped waterfall only while it is as high (it taps on at the top); bears walk in the water, stopped 1.5 cells from a waterfall either
  way, 12 cells past the water's edge and 5 columns from the source and the sea (fishermen too);
  fishermen keep out of the water but walk across a bridge, put on its deck's row and as high as
  it (`z`), ramped up its 2-cell slopes; salmon start at one of 39 places across column 390
  (±0.4 of its half width) and bears and fishermen at the original's catcher places, each picked
  by the room from its seed at every spawn (`randomSpawn`).
- **Its rules module** (P11.3) — `engine-mechanics` `src/salmonsRules.js`, `rules.module:
'salmons'`, on the server only: tap Space at the foot of a waterfall to climb it; a sandbank
  grounds a salmon until it taps Space; the fisherman's line hooks the nearest salmon, reels it in
  and lands it (5 taps of Space shake the hook); one salmon per round is golden and worth 3×.
- **The layout** — `engine-layout` `referenceLayouts/salmons.ts`: the loading and background
  screens, and the river as the play field's world (banks, water, rapids, whirlpools, the sea, the
  source), with a camera that follows the device's own player and the players' spawn layer.
- **The looks** — `SALMONS_CHARACTER_COMPONENTS`: three placeholder shapes (salmon pink, bear
  brown disc, fisherman yellow), each standing on its place (its bottom there). The three
  characters carry `characterClips`: each plays its
  S0 Invisible Flipbook clips (`salmon_pink_*`, `bear_*`, `fisherman_*`) once they are in the
  project, drawn over the hidden placeholder (the bear's and the fisherman's in eight facings,
  the salmon's in four); none is made yet
  ([guides/salmons-character-sprites](../guides/salmons-character-sprites.md)). The
  runtime draws the golden salmon (the room's `mark`) gold over a glow, and a fisherman's line to
  the salmon he has hooked, from the room's state: no component carries them.
- **The original art** (built in, `engine-layout/salmons-art`, loaded lazily only for a config
  naming the `salmonsRiver` generator): the river drawn in the old game's images (grass and sand
  autotiles, the riverbed under a moving water tint, trees by biome, rocks, whirlpools, waterfalls
  with their lips and splashes) and each character as a code look animated as the old client
  did: the salmon a rope through its pink or golden texture, the bear's sprite turning to its
  heading with a claw streak on its swipe, the fisherman the old tan circle, the line 0xddddaa
  from his hand, wiggling after the cast. A published clip still wins over a code look.
- **The screens** (2026-11-18, the original's; no HUD) — drawn in code by the same art in place
  of an empty node on each screen the flow shows: the death screen on the own player's catch
  ("You have been caught / by NAME", Salmon / Fisherman / Bear, Respawn), the win animation at a
  game won (`gameWon`: the big fish, "You Won!" or "NAME won!!!", eggs on the winner's device, a
  button that leaves for a new room, the winner with its pass), the lobby's note while a new room
  waits (the room's river with the people in it, "You are NAME, a CLASS"; no form since
  2026-11-20) and the loading phrases; over the own catcher, "you catch NAME!". The start menu
  (name, Salmon / Catcher, Fisherman / Bear, Join River, the river list once the server lists
  rooms) comes first of all, before the join (2026-11-19), for a launch that carries no
  character: drawn in the page, and the device is in no room until Join River. It is the only
  place that asks. With `arcade.online.keys: 'screen'` (Salmons' config), on the
  isometric screen the keys are the screen's (Up straight up,
  diagonals no faster; up the river is Up + Right until the world is mirrored); Space swipes a bear
  and does nothing for a fisherman; J casts four cells ahead into the water.

It is not a published project: the playtest builds its own snapshot and config and starts its own
game server in-process. `scripts/salmons/export.mjs` writes the same documents for the `salmons`
project (owner steps in [status/salmons](../status/salmons.md)).

**What it looks like (2026-11-18):** the original's orientation, the source top-left and the sea
bottom-right, waterfalls running up-right; a cell 64 × 32 CSS px (32 × 16 on a phone). On the
original's levels a narrow band of grass, then a dense forest wall on both banks that follows the
river (a character inside it is hidden behind the trees in front of it), dark forest floor beyond;
sandy beaches near the sea; wooden placeholder bridges with pillars and reflections. The band
river (`salmons-play.mjs`) keeps its grass world.

## Launch

```
PUBLIC_IE_FAMILIES=arcade pnpm --filter lines build
node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
  scripts/playtest/salmons-play.mjs --runtime apps/lines/build --out .cache/salmons-play
```

`--sheet` plays one room whose salmon class names a character sheet of frame clips, and `--rig`
one whose salmon's sheet names a rig and whose bear's is still images (character pipeline C2a,
C6a); `--hold` one whose salmon's catch holds its last frame ([below](#a-held-catch---hold)).

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
the top and tapped on there (since 2026-11-18), it swims over, drawn nose up in the climb's pose while held
(`online.art.looks[me].climbing`); past the line it is drawn raised by the step, 24 + 24 × 8 px
(the probe's `drawn[].ground`); `cliff.png` at the foot and `over-the-cliff.png` after. It prints
how long the art took, the JS heap and the fps (2026-11-17, container, software rendering: art in
about 4 s, 133 MB, 24 fps).

**The lobby asks nothing** (2026-11-20, the same run): a page joins `salmons-lobby` (no bots, a
lobby that needs two people) and waits on the lobby screen with no countdown; under the layout's
title its note reads "1 players in … River" and "You are Lia, a Salmon", and there is no form:
nothing drawn in the canvas to fill in or press (the probe's `online.screens` has a `lobby` note
and no `menu`), no text field on the page and no start menu over it (`lobby-waiting.png`). A
second page starts the countdown; both notes then count 2 people in the one river
(`lobby-countdown.png`). When it ends round 1 starts and both pages drop the lobby and its note.
On a runtime that still draws the form in the lobby the note's two verdicts fail.

**The start menu before the join** (2026-11-19, the same run): those two pages have started
`salmons-lobby` and its lobby is over. A page then opens the game as the published link does, with no
`rooms_character`: the menu is up (`start-menu.png`: name `Guest`, Salmon chosen, no class row,
its river list reading "2 players in … River"), and after four seconds the server still lists that
one room with its two people. Catcher (Fisherman is chosen, Bear offered), the name typed, Join
River: the page is in that running room as a fisherman by that name, drawn as one, walks on its
keys and shows no lobby (`joined-as-fisherman.png`). Another page picks Bear and plays a bear
(`joined-as-bear.png`). The fisherman's page loaded again shows the menu again with its name kept,
and the room gains nobody meanwhile. A page whose last page carried its join (`ie:rooms:next-join`
with a name and `bear`) plays at once with no menu. Last, a page comes through the menu (Bear)
into `salmons-lobby-new`, a room nobody is in: it waits on the lobby screen, whose note says what
was picked ("You are NAME, a Bear") and which does not ask again (`menu-then-lobby.png`). On a
runtime without the menu the first two verdicts fail and a third says its choices could not be
played.

**The device's view** (2026-11-20, the same run; `docs/design/realtime-multiplayer.md` §5): two
rooms on the shipped level pinned, each with one page (a bear stood in a rock-free lane of the
water) and still bear bots the script stands at known offsets, once the page's camera rests and
the room sends the page by that view alone (a camera easing to a new place sweeps a larger view,
which the room holds a second or two, and a player once sent is kept 25 % past the edge). A
1920 × 1080 page says what the engine's own `shownOf` makes of the exported layout's camera there
(the sizes: [status/salmons.md](../status/salmons.md), Current state), the room holding the same,
and is sent and draws only the bear 30 cells up-river, at its edge, not the one at 36
(`view-1920.png`). Resized to 2560 × 1440 with no reload it says the larger view and is sent the
bears at 36 and 40 cells and towards its four corners; one stood 43 cells up-river after the
resize, just past the edge, is not sent (`view-2560.png`). A 390 × 844 phone (a phone's user
agent and touch) says its own view and is sent what the box sends: the bears on its screen (12
cells up-river, 26 down the screen, 5 across) and the one 25 cells up-river, off its screen and
inside the box, as before the view; not the one 36 cells up-river, past the box
(`view-phone.png`). On a runtime from before the fields the pages say nothing and the first of
these fail. 38 verdicts in all.

Add `--netcode colyseus` to this run too (2026-11-20): its pages then play the Colyseus SDK's own
prediction, and the view's pages must report it.

Add `--netcode colyseus` to play it with the Colyseus SDK's own prediction
(`arcade.online.netcode`, default `engine`): the only playtest of that netcode in a nearby room with
the world camera. Each page must report the mode it ran. Run both.

The scripts' `ArrowUp` / `ArrowDown` mean up and down the river: they press Up + Left / Down +
Right, since the keys are the screen's on the mirrored isometric river (the source top-left).

Bear bots catch any live player (WS-B): page B, a human bear, may be caught; it comes back as a
bear through its death screen before each of its checks. Page A comes in with a winner's pass, so
its salmon is golden. The river list route (`GET /rooms?game=salmons`) is read from page A's
origin and lists its room with two people.

Each page boots `?runtime=1&ie_determinism=7&rooms_url=ws://127.0.0.1:<port>&project=salmons`,
page A with `rooms_character=salmon`, page B with `rooms_character=bear`. The page's frames are
stepped by the determinism probe while real time passes, so the room's patches arrive between steps.
Every page is on this machine's one address, so the playtest's game server takes 32 sockets an
address (`perAddress`): the open pages and the seats held for closed ones come to the default 16,
and the next page's socket is refused (page D's verdict's `heldBefore` says how many were held).
Pages X, Y and V (check 20b) run last, after page D, whose room count must not meet another
room's disposal.

Every page of both scripts carries `rooms_character`, which joins at once; only the start menu's
own pages (above) take it away.

**By hand:** the same snapshot boots in any runtime build; arrows / WASD swim or walk (Up is
straight up the screen, Up + Right up the river), Space leaps (in open water), climbs, jumps off a sandbank or shakes a hook
for a salmon and swipes for a bear; J swipes or casts; a click casts at the water. Open a second
tab with `rooms_character=bear` (or `fisherman`) to hunt. Caught, the death screen comes up with
the catcher's name. Opened with no `rooms_character` (as the published link is), the start menu
comes first whatever the room is doing: a name, Salmon or Catcher (Fisherman or Bear), Join River;
a reload asks again. In a new room the lobby then shows the river, the people in it and who you
are while the room waits, and asks nothing more (2026-11-20).

## Checks (`result.json` verdicts)

1. One room on the server; both pages are in it and see themselves.
2. The bots fill the room: page A (a salmon at the sea) is sent the bots near the sea.
3. Nearby-only: the bear on its bank far upstream is not sent to the salmon at the sea, nor the
   salmon to the bear.
4. Page A's salmon starts at the sea, and page A's camera frames it.
5. ArrowUp held on page A swims its salmon upstream (against the current), and the camera follows
   (no dead zone since 2026-11-18: centred on it within 24 px, its easing and the netcode's lag).
6. Resting in the water, page A's salmon drifts downstream with the current, and page A draws
   it within 20 px of the room's place (its prediction of the drift, a little ahead). The river
   screen is isometric (P11.4) and mirrored as the original (2026-11-18): in
   `03-salmon-upstream.png` the salmon's colour is at its projected place (y − x, (x + y) / 2
   from the camera's centre) and not at its flat one.
7. Page A shows the river with no HUD, no win screen and no death screen, its flow reading the
   room's `status` (`free`, a variable the room owns).
8. Page B's Space swipes the bear on the press (its claw streak), before the room tells of it; the
   room then tells, the swipe is not raised twice, and the claw is gone after 300 ms.
9. A river per room (P11.2 e): pages A and B (one room) report the room's seed and make the same
   river from it, the very zones `generatedOnlineGame` makes from that seed in Node, and draw it
   (`online.fieldDrawn`: the loaded doc held the `river` node it replaced); page A's salmon started at that river's sea, where the server put it;
   it is not the authored river; page C (another room) plays another river, its own room's.
10. Page C joins `salmons-short` (the same game with 5 s rounds, no bots): the round ends on its
    clock (`roundEnd`), no game is won (no `gameWon`, no win screen), and round 2 starts.
11. Page D boots the same game with a layout that lost its `river` node: it stops on the failure
    screen before the game mounts, saying to keep a node with id `river` or remove
    `arcade.online.generator`, and leaves the room (the server's room count is back where it was).
12. Page E joins `salmons-falls` (the authored river, no generator, no bots, its salmon starting
    just below the river's first waterfall): ArrowUp held, the salmon stops at the waterfall's
    foot; tapping Space climbs it (the room's `climbed` event: the band river's waterfalls have no
    height, so they are the original's lowest and one tap tops them) and, let go at the top, it
    swims on over the waterfall (no lift over it since 2026-11-17). The band river keeps the pass
    over a topped waterfall until the salmon is back on the water; the original's levels pass it
    only while the salmon is as high (2026-11-18), which `salmons-levels-play.mjs` plays.
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
    salmon starts on a sandbank, held there, and the fisherman on the far bank, so the reel home is
    long enough to see and to break). G comes in
    with a winner's pass (`issuePass('salmons-line')`, seeded as its next join in session
    storage), so its salmon is golden: both pages list it as marked and draw it gold (read off
    `10-golden-salmon.png` and `11-golden-seen-by-fisherman.png` at its look's middle); G's flow
    heard `golden`.
17. H, who has not moved, presses J: the key-only cast aims at the nearest salmon and hooks it.
    Both pages draw the line (H's `12-the-line.png` has the line's 0xddddaa along the way from his
    hand to the salmon's middle, projected; H and G are stepped in turn, as the reel lands it in
    under a second), G's flow heard `hooked` (`me`, not `mine`); reeled in and landed (`caught`),
    the line is gone on both pages. H's fisherman shows "you catch Gil!" over him.
18. G's death screen: the flow shows `salmonsCaught`, the art's screen says "by Hal"; G clicks
    Salmon and Respawn (the probe's `screens.caught.buttons`), is back (`respawned`) and the screen
    goes. Page G2 (no pass) joins and draws its own salmon pink and G's golden. A click on G hooks
    it again, H leaves at once: the line breaks (`escaped`, heard on G) and is gone.
19. G leaves: G2's salmon stays pink (golden is the last game's winner, never passed on; no
    banner).
19b. Page W joins `salmons-win` (its salmon just below the source) and swims into it: `gameWon`
    for W (`winnerName` "Wyn"), the flow shows `salmonsWon`, the screen says "You Won!" and lays
    eggs (`14b-you-won.png`), and the room sends W a `winnerPass`. Its "Join New Game" leaves and
    reloads into a new room (another seed), where W's salmon is golden.
19c. Bloodstains (`GuiltyForever/Salmon-` PR #8): pages K (a bear on the bank) and Q (a salmon
    in open water just upstream, carried past him by the current) join `salmons-blood` (the
    authored river). K steps towards the water (its swipe lands a tile ahead of its last move) and taps J until it catches Q's salmon: both pages are sent one stain (the probe's `online.stains`) within 1 px of
    where the salmon was held out, and draw it (`online.art.blood.stains` 1; `14b-bloodstain.png`:
    at its place on the mirrored screen, under rocks, lips and bridges, since 2026-11-18).
    The red salmon and its trail are pinned by `check:salmons-art`, not here: these pages draw a
    river of the room's seed while the room plays the authored one.
20. S0 clips: pages S (a salmon) and T (a bear) join `salmons-clips` (as `salmons-sand`) from a
    snapshot that registers three stub clips (S's with the room's own config, no generator, so it
    predicts the river the room plays; S swims down only to above the whirlpool below the sand) (`salmon_pink_swim_se`, `salmon_pink_swim_ne`,
    `salmon_pink_hop_se`, green 32 × 64 frames with their box, on a sheet in `editorArt`). The probe's
    `online.clips` (room id → `{ clipId, flipX }`) and `online.clipLog` (each change) say what is
    played (the mirrored screen, 2026-11-18): swimming downstream (screen south-east) is `swim_se`
    as drawn; swimming upstream (screen north-west) is `swim_ne` mirrored; grounded on the sand, `15-salmon-clip.png` has the clip standing on its feet, gold
    (the room's only salmon is golden) from the feet to 180 px up and not above (90 wide, the
    body's width); Space jumps it off: `hop_se` (the vertical twin, no `hop_ne`) once, then
    `swim_ne`. T's bear has no clips: no clip in its probe, and its code look (the bear sprite,
    brown fur at its middle) in `16-bear-code-look.png`.
20b. Eight facings and a clip-drawn catcher (2026-11-19; game-families §9 #28): pages X (a
    fisherman) and Y (a salmon on the sandbank across the water) join `salmons-catcher` (as
    `salmons-line`). Both boot a snapshot with two stub clips, `fisherman_walk_e` and
    `fisherman_walk_se`, and components as a project never re-uploaded may hold them: the
    fisherman's `characterClips` as exported before facings (it names none), the bear's taken out.
    Standing, the fisherman is drawn by one of his clips and not by his code look (the probe's
    `online.clips`). X walks straight right on the screen and page Y draws him by
    `fisherman_walk_e` as made, not the south-east clip (his block names no facings, so he takes
    the game's eight), straight left by the same clip mirrored; the way from the water is walked
    first, then part of the way back, so he never reaches the bank. The facing is read on Y, which
    draws him from the room's states: X predicts its own player on a river of the room's seed, not
    the authored one the room plays. X clicks on the salmon: the line's start is the hand on his
    clip's box (the probe's `online.art.hands[me]`: 14 px across, mirrored with the clip, and
    67.2 px up, the default hand on a 32 × 64 box drawn 56 wide), X has no code look, and
    `17-line-from-a-clip.png` has the line's 0xddddaa from that hand to the salmon. Landed, "you
    catch Yan!" rises over him (the probe's `online.art.floats[me]`;
    `18-catch-text-over-a-clip.png`). Page V (a bear, the same snapshot): its component names no
    clips, so the game's own names do (`bear_idle_se` in the probe's `clipLog`); that clip's frames
    no sheet packs, so its first frame never loads and the bear keeps its code look (the sprite;
    `19-bear-clip-not-loaded.png`), no clip counting as played.
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
(the probe's `underwater`), since only a quarter of its gold shows. 94 verdicts.

Every page boots the snapshot's config, which names the generator, so every page draws the art,
and the pages of the authored-river rooms (E, F, G, H, K, P, Q, S, T, V, X, Y) draw a river of the
room's seed while the server plays the authored one: their verdicts read the room's state, not the
drawn river.

Screens: `01-salmon-at-the-sea.png`, `02-bear-on-its-bank.png`, `03-salmon-upstream.png`,
`04-bear-swipes.png`, `05-another-river.png`, `06-round-over.png`, `07-at-the-waterfall.png`,
`08-over-the-waterfall.png`, `08b-touch-over-the-waterfall.png`, `09-grounded.png`, `10-golden-salmon.png`,
`11-golden-seen-by-fisherman.png`, `12-the-line.png`, `13-landed.png`, `14-golden-passes-on.png`,
`14b-bloodstain.png`, `15-salmon-clip.png`, `16-bear-code-look.png`, `17-line-from-a-clip.png`,
`18-catch-text-over-a-clip.png`, `19-bear-clip-not-loaded.png`.

## A character sheet made in the tool (`--sheet`)

```
node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
  scripts/playtest/salmons-play.mjs --runtime apps/lines/build --out .cache/salmons-sheet --sheet \
  [--netcode colyseus]
```

One room (page Z), instead of all the above, on the same runtime build. Its `salmon` class names a
character sheet, and the sheet is not written here: it is
`scripts/playtest/fixtures/salmons-tool-sheet.json`, the entry Invisible Characters' own edits
make of a Salmons config and the launcher's save stores (*Make this a sheet* on the class, the
prefix `salmon_sheet`, an added action `flop` on the room's `grounded`, its north-east clip named
in its cell as `sandbank_flop`). `pnpm --filter launcher-api check:art-scope` §14 makes that entry
with the tool, fails when the file differs (`-- --record-tool-sheet` re-records it), and publishes,
bakes and pulls the same project. The page boots the config with the sheet; the server is given
it normalized, which has none.

Seven verdicts: only the sheet's clips draw the salmon (`salmon_sheet_swim_*`; the game's own
`salmon_pink_*` are registered too); swimming upstream it plays `swim_ne` mirrored; grounded on
the sandbank heading upstream it plays `sandbank_flop`, the clip the cell names; Space hops it off
(`hop` once, then `swim`); swimming back down onto the sandbank it plays `salmon_sheet_flop_se`,
the clip found by name; nothing to the RGS; no page error. The stub art is one flat colour, so
which clip shows rests on the probe's clip log (`arcade.online.clipLog`), not on the screenshot
(`sheet-salmon-flop.png`).

## A held catch (`--hold`)

```
node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
  scripts/playtest/salmons-play.mjs --runtime apps/lines/build --out .cache/salmons-hold --hold \
  [--netcode colyseus]
```

One room of two pages, instead of all the above, on the same runtime build: the bloodstain's room
(page K's bear spawns beside page Q's salmon), with `rejoinSeconds: 0` so a page that closes
leaves at once (a dropped player otherwise keeps its seat, and its hold, for up to 60 s). The salmon class names a sheet that is Salmons' own
block made a sheet (`sheetOfCharacterClips`) with its `caught` set to `play: 'hold'` (the plan's
§12.5). The catch clips (`salmon_pink_caught_se`/`_ne`, and the golden salmon's own, so it is drawn
as made) end on the one magenta frame of the run.

Five verdicts: K's bear catches Q's salmon (screen left and down at once, raw, so its swipe faces
the water, then J tapped); for 4.5 s after, with Q put out, K draws Q on the catch clip, magenta on
screen at 1.5, 3 and 4.5 s, and the clip log has no clip after the catch (`hold-caught.png`); once
Q's page closes, Q leaves the room and K draws it no more, with no magenta left (`hold-gone.png`);
no page error on K or Q. This room has no generator, so no art and no death screen: the respawn
ending (the room brings the player back) is held by `check:character-sheet` §9, not here. With
no hold (every other run here) a caught salmon that has a catch clip is hidden when the clip ends.

## What the gates already prove (not replayed here)

`pnpm check:room-bots`: the river is the seed's and the config validates clean; a salmon that
steers for the water's middle reaches the source and wins the round; the current carries a salmon
down and a bank pushes it back; a bear bot on its bank catches a salmon near the shore and never
steps into the water; a bot fisherman casts only at a salmon in his sight that a device there would
be sent, after his reaction time and short of it on a long cast (2026-11-20), where a person's
cast goes out at once and lands where it is aimed, and a room replays its bots' casts from its
seed; bots fill to `fillTo`, give their place to a person and cannot win; a seeded
room replays exactly; nearby-only state over a real server. `pnpm check:online-rules` replays
Salmons' recorded traces exactly (`packages/engine-mechanics/fixtures/salmons-traces.json`: the
climb, the sandbank, the line with a landing and an escape, the golden salmon), places each
bloodstain (a catch's, a landing's at the hook), keeps them through a round and to their cap, sends
them to every device and a late joiner over a real server, and holds a device's prediction against
a rock and the river to the room's. `scripts/room-load.mjs` fills a Salmons
room with 100 devices (status P10.16 and P11.3 have the numbers). `pnpm check:salmons-levels`
plays the original's rules on its levels in a room: the speeds, the bank that stops a salmon's
centre at the water's edge, the re-grounding on sand (within 0.8 cells of a sand cell, every time
it comes down), bears in the water stopped by a waterfall, the bank limit and the ends, a
fisherman across a bridge (its row, its height, its slopes) and kept out of the water elsewhere,
and the spawns (the room's picks replay from its seed).

## Known gaps

- No verdict yet for the 2026-11-18 screens' contents (the death screen's name and Respawn, the win
  animation's eggs and button, the floating catch text, the line to the bobber):
  the probe reports them (`online.screens`, `online.art.looks`); the respawn, the bobber and the
  river list need WS-B's server. Next verdicts: page G caught by H shows `salmonsCaught` with
  `screens.caught.by` H's name; `online.art.floats` has H's "you catch G!"; page C's
  `screens.won.title`.
- The swimming salmon is
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
- On the band river (P10.16) salmon are kept off the banks by a push, not a wall. On the original's
  levels a bank is a wall, but a salmon pressed into it slides along it where the original's stops
  dead (the engine's solids move x then y).
- A fisherman's bridge (its row and its height) is the server's: its own device sees it as a
  correction. Nothing draws the bridges yet, nor a fisherman's height on one.
