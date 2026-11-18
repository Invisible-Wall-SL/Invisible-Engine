# Salmons (arcade reference project) — status

> Plan: [design/game-families.md](../design/game-families.md) §1 (Salmons and its art pass, S0), §4.3–§4.5, P10.16, §9 #28 · Online rooms: [design/realtime-multiplayer.md](../design/realtime-multiplayer.md) · The art pass's own guide: `docs/art-pass.md` in `GuiltyForever/Salmon-` · The sample it builds on: [playtest/arcade-sample.md](../playtest/arcade-sample.md) · Agents: `arcade-games` (art pass: `atlas-python-tools`, `invisible-flipbook`, `invisible-fx`, `invisible-components`)

**One-line state:** **Salmons is rebuilt as data on the engine (P10.16, built 2026-10-27; in
review)**, with its own rules since P11.3 (the climb, sandbanks, the line, the golden salmon;
in review) and drawn isometric since P11.4 (in review): its river, rules, characters, bots and layout run on the shared runtime and the game
server, with placeholder looks, and play in two browsers and a room of bots
([playtest/salmons.md](../playtest/salmons.md)). It plays live on `rooms.invisiblewall.org` from
the `salmons` project (2026-11-02); its players are not moved over yet (owner step 5). Since
2026-11-08 (in review) the golden salmon is drawn gold, the fishing line is drawn, and the rules'
events are Flow events; taking the new looks and flow live is an owner re-upload (below). The art pass (S0) was approved on
2026-10-26; its 20 character clips (owner, 2026-11-08) are still to be generated in the launcher's
tools. The game side that plays them is built (2026-11-08, in review): each character plays its
clips once they are in the project, and keeps its placeholder until then. **Since 2026-11-09 (in
review) Salmons draws the original game's own art, animated in code** (owner decision: no generated
clips; the S0 clip runbook is superseded). The art is built into the runtime, so it needs no
upload.

## Current state

- **Movement and terrain as the original's, on its levels (2026-11-18; in review; runtime
  change)**: on a `salmonsMap` level (what ships) a room plays the original's speeds (salmon 288,
  bear 216, fisherman 240 px/s), a bank that stops a salmon by its centre (no push), the
  whirlpool's `d·14·(1 − d/4)` cells/s pull, re-grounding on sand every time a salmon comes down
  within 0.8 cells of a sand cell, the lip crossed only while the salmon is as high as the fall
  (it keeps tapping at the top), bears in the water (stopped 1.5 cells from a waterfall, 12 cells
  past the water and 5 columns from the ends; fishermen too, out of the water but over bridges, on
  the deck's row and at its height), and spawns picked by the room from its seed (salmon across
  column 390, catchers at the original's places). P10.16's band river plays exactly as before
  (its speeds, bank push, spawns, the sandbank latch and the pass over a topped waterfall). Detail
  in Recent changes (2026-11-18, WS-A); proof `check:salmons-levels`. **Live only after the export
  is re-run and the config re-published** (Owner steps).
- **Bloodstains, as the original (2026-11-18; in review; runtime and game-server change)**: a
  salmon caught leaves a permanent stain where it died, as `GuiltyForever/Salmon-` PR #8 does: a
  bear's catch where it is, a line's landing where it was hooked; kept for the room's life (every
  round), at most 300, the oldest dropped. The rule is the `salmons` module's (`salmonsRules.js`
  `bloodstains`, `STAINS`), the room sends the list to every device (`schema.ts` `stains`, nearby
  rooms too, a late joiner included), and the device draws each stain at 0.35 over the swimming
  salmon and under everything above the water; a salmon swimming within 0.8 cells of one turns red
  for 3 s and sheds a red trail fading over 3 s (`engine-layout` `salmonsArt/blood.ts`). Proof:
  `check:online-rules` (3 checks), `check:salmons-art` (6), `salmons-play.mjs` pages K and Q. No config or upload: it arrives
  with the runtime release and the game server's deploy.
- **Mouse and touch, as the original (2026-11-17; in review;
  [design/arcade-pointer-controller](../design/arcade-pointer-controller.md))**: an online game's
  Game Config `arcade.online.pointer` (off unless named) lets a player steer with the mouse or a
  finger: the player heads for the point under it at full speed and stops within a dead zone; a tap
  (lifted within 12 px) or a click presses the character's tap button. Salmons ships it as the
  original's client did it (read from `GuiltyForever/Salmon-` `client/input.js` / `game.js`): the
  cursor steers with no button (hover-to-move), 72 px (1.5 tiles), a tap jumps a salmon, swipes a
  bear and casts a fisherman's line, the newest finger steers. The device turns it into the inputs
  the keys make, so the room is untouched. The jump leaps towards the tapped point since
  2026-11-18 (below). **Not matched:** the original aimed the cast at the tapped point too; no rule
  reads the cast's `aim` yet (owner call; it is on the wire).
  Authored in `/config` (Mouse and touch). Proof: `check:arcade-pointer`, `salmons-play.mjs` page
  P (both netcodes).
- **Salmons on the engine (P10.16)** — the authored config and layout are made from one seed,
  `SALMONS_SEED`; each room plays a river of its own (P11.2 e, below):
  - **the river and the config**: `engine-mechanics` `src/salmons.js` (`salmonsRiver`,
    `salmonsConfig`): a 1800 × 7200 river of 15 bands from the sea to the source; `salmon`,
    `bear` (≤ 30) and `fisherman` (≤ 20); bears and fishermen start on the banks; 100 players; bots
    fill each room to 20 as bears and fishermen and cannot win (§14 #5); a new round 15 s after one
    ends (§14 #6); each device is sent the players within 2400 × 1800 of its own;
  - **today's rules, as data** (realtime-multiplayer §4's table): the current and whirlpools are
    zone forces on salmon (rapids push harder); on the band river a bank pushes a salmon back into
    the water (on the original's levels it is a wall, above); the
    bear's swipe (110 px, out 3 s, +1) and the fisherman's cast (280 px, out 4 s, +2) are `catch`
    abilities on J; the first salmon at the source wins (+10);
  - **Salmons' own rules (P11.3, built 2026-10-29; in review)**: rocks are solids and waterfalls
    one-way solids that stop a salmon from below; the water, sea and source are solid to bears and
    fishermen, who stay on the banks (all predicted by the device); the rules module `salmons`
    (`engine-mechanics` `salmonsRules.js`, server only): a salmon climbs a waterfall by tapping
    Space at its foot, as high as the waterfall is (the original's climb since 2026-11-17), is grounded on a sandbank until it taps Space, can be hooked by a
    fisherman's cast, reeled in and landed (+2; five taps shake the hook), and one salmon per round
    is golden (worth 3× caught or at the source). The river places the rocks, sandbanks and
    waterfalls from its seed, on the server and on every device. Detail and the numbers in
    [status/game-families](game-families.md) P11.3;
  - **chosen here, owner may overturn** (Salmons' design leaves them open): a grounded salmon can be caught, a hooked one cannot; reel
    200 px/s, landed within 60 px, 5 taps to escape, one line per fisherman, the cast's score at
    the landing; the golden salmon picked by the server from the room's seed (not chosen by the
    player, as the old client did), 3×, re-picked when it leaves; obstacle chances and sizes;
    waterfalls across the whole river;
  - **a new river per room (P11.2 e, built 2026-10-29; in review)**: the config names the
    generator (`arcade.online.generator: 'salmonsRiver'`). Each room picks a seed and carries it in
    its state (`seed`); the server and every device run `engine-mechanics` `generatedOnlineGame`
    on it (the river's field, zones, currents, banks and spawns; characters, rules and bots stay as
    the config says), and the device draws that river (`engine-layout` `salmonsRiverNode`) in
    place of the authored one. A room replays from its seed (the bots' brains and the river). The
    river is the **original game's own level** since 2026-11-17 (in review; below);
  - **the original's levels, by seed (2026-11-17; in review;
    [design/salmons-levels](../design/salmons-levels.md))**: `engine-mechanics` `salmonsMap.js`
    ports `generateMap` / `buildMeanderTable` and `seedrandom.js` its PRNG, so a seed makes the
    original's level piece for piece (a meandering 400-column river, waterfalls every 40 columns,
    rocks, whirlpools, delta sand islands; bridges carried, not yet drawn or played). Salmons'
    config names the generator `salmonsMap`. No pinned seeds: a new random level per room, as the
    original; `arcade.online.levels.seeds` pins a list taken in turn. Authored overlays
    (`levels.overlays`, by seed or `'*'`) add, remove and re-height pieces by grid cell on top, in
    the room, on the device and in `/editor`; a reseed lists what it cannot place and never drops
    it. `/editor`'s **Generated level** card previews any seed (placeholder shapes) and saves the
    overlays into the Game Config. P10.16's band generator stays as `salmonsRiver` for the
    recorded traces. Proof: `check:salmons-levels`;
  - **the layout and looks**: `engine-layout` `referenceLayouts/salmons.ts` — the river as the
    play field's world, a camera following the device's own player, placeholder looks
    (`salmonsSalmon`, `salmonsBear`, `salmonsFisherman`) standing on their places (their bottom
    there, as the S0 art's bottom-centre anchor), the swipe, cast and splash centred on theirs;
  - **the golden salmon and the line (2026-11-08; in review)**, drawn by the runtime from the
    room's state, so no look carries them: a player the room marks (`mark`) is drawn gold (its
    brightness on a gold ramp) over a gold glow at its feet, on every device, as soon as the state
    says so, and again on the next one when it passes on; while a salmon is `hooked`, a white line
    runs from its fisherman's hand (¾ of his body's height) to its middle, at both ends' projected
    places, until it is landed (`caught`), escapes, either leaves or the round ends
    (`apps/lines` `online.ts`, `engine-mechanics` `onlineFlow.js` `createHookLines`,
    `engine-layout` `arcadeMarks.svelte.ts` and `<SpawnLayer>`);
  - **the rules' events in Flow (2026-11-08; in review)**: `climbed`, `grounded`, `jumped`,
    `hooked`, `escaped` and `golden` are online Flow events (`onlineFlow.js`
    `ONLINE_FLOW_EVENTS`, `engine-flow-v2` `ARCADE_ONLINE_EVENTS`, so `/flow-v2`'s arcade palette
    offers them), each with the player's drawn `x` / `y` and `me` (the line's with `by`, `target`,
    `mine`). Salmons' flow plays a splash (`salmonsSplash`, 400 ms) where a salmon climbed or was
    hooked, and a banner (`salmonsGolden`, "GOLDEN SALMON — WORTH 3×", 2 s) when the device's own
    salmon turns golden;
  - **the HUD and the round over (P11.2 a–b, built 2026-10-29; in review)**: Salmons' own flow
    (`engine-flow-v2` `reference/salmonsSeed.ts`) shows a HUD of the room's own values — SCORE,
    ROUND, TIME (`score`, `round`, `secondsLeft`, variables the room owns) — and a round-over
    screen at each `roundEnd`, counting down to the next round and gone at `roundStart`; the bear's
    swipe and the fisherman's cast are drawn on the press (placeholders `salmonsSwipe`,
    `salmonsCast`); a caught salmon is not drawn until it respawns;
  - **proof**: `check:room-bots` (a salmon swims the river to the source, climbing and jumping,
    and wins; a bear bot on its bank catches one near the shore; the config validates clean; a
    room plays its seed's river and replays it; live, two rooms of one game play two rivers, each
    the one its devices make), `check:online-rules` (Salmons' recorded traces: the climb, the
    sandbank, the line, the golden salmon; their events as Flow signals; the line drawn exactly
    while a salmon is hooked), `check:salmons-export` (the export's keys; each look sits on its
    place), `scripts/playtest/salmons-play.mjs` (52 / 52 in each netcode: the HUD, the swipe, a
    round over, two rooms with two rivers, a waterfall climbed and a sandbank jumped off, the
    golden salmon drawn gold on two devices and passed on, the line drawn while hooked and gone
    when landed or broken, the rules' events in Flow), and the 100-device load test
    ([status/game-families](game-families.md) P10.16, P11.3).
- **The Salmons that players reach today is not built from this repository.** It lives in
  `GuiltyForever/Salmon-` (a Colyseus 0.15 server and a PixiJS client) and deploys from there.
  Nothing merged here changes it until its players are moved over (owner steps below).
- **S0's groundwork, in the Salmon repository** (`main` 41811c2, read 2026-10-26; its
  `docs/art-pass.md` owns the detail):
  - the original images are kept untouched in `art/source/legacy/` (16 files);
    `scripts/build-sheets.py` packs them with the Atlas Maker's own packer into `terrain`,
    `props` and `characters` sheets (TexturePacker JSON) and a FlipbookDoc `clips.json`, so a
    sheet or clip exported from the pipeline drops in;
  - the look is fixed: 2:1 isometric, painted cartoon with dark outlines, sizes on screen, frames
    generated at about 4×, a bottom-centre anchor, real transparency;
  - facings: four diagonals, drawn south-east and north-east and mirrored for the west;
  - the client already plays clips named `<character>_<state>_<facing>` as soon as they exist
    (`client/rendering/characterLook.js`), falling back to the old drawings until then;
  - recipes: Atlas Maker `gpt_image` stills with the current art as the style reference and a
    BiRefNet cutout, then Flipbook 🎬 Video with `wan22_i2v_flipbook`, then download through the
    FTP Browser into `art/imported/` and rebuild;
  - `art/imported/` is empty: no clip has been generated.
- **The `salmons` portal project** (client `invisible_wall`) is an **arcade project** since
  2026-10-26: Game Config family `arcade` ("Salmon Run", free play), the arcade scene set, the four
  sample components, the arcade starter flow, published to the test server. It plays the P10.8
  dodger with placeholder shapes. Before that it held only a test background (`Background_Test_1`,
  still there) and an unused Book-of flow (kept under `editor/flow-v2-backups/`). None of the
  Salmon repository's sheets is in it: that repository builds them locally.
- **The two design docs' disagreement is settled:** realtime-multiplayer §2 item 4 is right that
  the art is in the pipeline's formats; game-families §1 now says what is left.

## Owner steps (P10.16) — not done by the build

**Re-export and re-publish after WS-A merges (2026-11-18)**: run `scripts/salmons/export.mjs` and
upload its `config/config.json` to the `salmons` project (as below), then publish. A room swaps
only the river's geometry into the published config (`generatedOnlineGame`), so with the old
config a live room plays the new banks, bridges, sandbank and lip rules, but the old speeds (240 /
190 / 140) and the old in-turn spawns (no `randomSpawn`).

Steps 1, 3 and 4 are **done (2026-11-02)**: Salmons plays live on `rooms.invisiblewall.org`.

**Bloodstains** (after the 2026-11-18 bloodstain branch merges): deploy the game server (INFRA
"Invisible Game Server") with its runtime release. Nothing to upload: an older game server sends no
stains and the runtime draws none; an older runtime ignores them.

**Turn on mouse and touch for the live project** (after the 2026-11-17 branch merges and its
runtime release is out): in `/config` for `salmons`, the **Mouse and touch** card, tick it, Mouse
**Follows the cursor (no button)**, Stop within **72**, and tap buttons salmon **Jump**, bear and
fisherman **Ability 1**; save and publish. (Or re-run the export and upload
`invisible_wall/salmons/config/config.json`, which now carries the block.) Until then the live game
reads the keyboard only.

**Re-upload for the 2026-11-08 visual fixes** (after the branch merges, so the launcher knows the
new Flow events and the runtime draws them). The gold and the line need no upload: they arrive
with the runtime release. The flow's reactions and the looks standing on their places do: run the
export as in step 1 and upload, at the same keys (back up first), the files that differ from the
current ones:

- `invisible_wall/salmons/editor/flow-v2.json` (the splash and golden-banner reactions);
- `invisible_wall/salmons/editor/scenes.json` (the `salmonsGolden` banner screen; `salmonsSplash`
  spawnable on the players' layer);
- `editor/salmons/components/salmonssalmon.json`, `salmonsbear.json`, `salmonsfisherman.json`,
  `salmonsswipe.json`, `salmonscast.json` (placed on their places, not up and left);
- `editor/salmons/components/salmonssplash.json` (new).

`invisible_wall/salmons/config/config.json` is unchanged. Then publish `salmons` again (step 3).
Once the S0 wiring merges too, the export writes `characterClips` into `salmonssalmon.json`,
`salmonsbear.json` and `salmonsfisherman.json`: upload those after that merge (one re-upload can
cover both), or the characters keep their placeholders whatever clips are made.
Until the looks are re-uploaded, the line's ends and the gold glow sit at the place while the old
looks still draw up and left of it.

1. **Put Salmons in the `salmons` project.** Run
   `node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs scripts/salmons/export.mjs --out <dir>`
   and upload what it writes, at the same keys, into R2 (the FTP Browser, admin full-bucket):
   `invisible_wall/salmons/config/config.json` (replaces the dodger's config),
   `invisible_wall/salmons/editor/scenes.json` (replaces its screens),
   `invisible_wall/salmons/editor/flow-v2.json` (Salmons' flow, replacing the offline arcade
   starter) and the five lowercase `editor/salmons/components/salmons*.json` (`salmonsbear.json`
   and so on: the launcher reads a component at its `r2Slug`-ed id; camelCase files are never
   found). Back up the current files first.
2. (No longer needed since P11.2: the export now writes Salmons' own flow over the starter.)
3. **Publish** `salmons` from Game Maker. Since P11.2 (c) the publish writes the game server's
   address into the launch URL as `rooms_url` (the launcher's `GAME_SERVER_URL`, by default
   `wss://rooms.invisiblewall.org`), so the published link plays as it is.
4. **The game server's config credential** (INFRA "Invisible Game Server" steps 5–7), so the live
   server can read the published config.
5. **Moving the players over** from the Salmon repository's own server: when the art (and,
   if wanted, the isometric view, P11.4) is in and you are happy with a playtest on the live server.

**The original art in the project.** Done 2026-11-17 for the first four sheets: imported by the
owner through the Sheet Maker's `.plist` import (no R2 key needed), from the pairs
`scripts/salmons/plist-export.py` writes, and checked in R2 the same day (`salmons_terrain`,
`salmons_props`, `salmons_characters`, `salmons_waterfall_face`: every region at its built-in name,
place and size, each page byte-identical to the built-in one, locked). **Still to import:
`salmons_cliff`**, added to the plan with the waterfall heights.

1. **To import (or redo) a sheet:** `python3 scripts/salmons/plist-export.py --out <dir>` writes a
   `.plist` + `.webp` pair per sheet; in the Sheet Maker's **Import** tab drop a `.plist` with its
   `.webp` (sheet name blank, lock on). For the cliff, only `salmons_cliff.plist` +
   `salmons_cliff.webp`. `scripts/salmons/upload-art.py` does the same straight to R2 for someone
   holding an R2 write key (dry run first; it skips what is already there and stops on anything
   that differs). Nobody needs the key locally: the **Salmons art upload** workflow
   (`.github/workflows/salmons-art-upload.yml`, dispatch on main) runs it with the release's R2 key;
   `sheets: salmons_cliff` limits it to one sheet, `apply` writes.
2. **See it in the tools:** the Sheet Maker's rail on `salmons` lists the sheets (🔒). In the Atlas
   Maker, **↻ Refresh from R2**, then pick one in the atlas list.
3. **Edit:** keep each region's name and size. A region can be edited in the Atlas Maker in place.
   To re-pack a sheet in the Sheet Maker, unlock it first (its frames may move; the game reads them
   by name, so that is safe).
4. **Republish** `salmons` from Game Maker. The art export ships every Salmons sheet the project
   holds, and the room draws them; one it lacks is drawn from the built-in copy.

## Open items / next (S0)

The isometric view is built ([Phase 11](../design/phase-11.md) P11.4: the river drawn 2:1, the
players upright in depth order; the S0 art should be drawn for it: diamond ground, upright
characters, their place at their feet); its HUD and round over, the published `rooms_url` and a river per room (P11.2) and its own rules (P11.3) are built.
Left from P11.3 (known limits):

- One tap of Space can do two things at once: a salmon that jumps off a sandbank at a waterfall's
  foot also gets a quarter of the climb from that tap (each rule reads the tap on its own).
- A climb and a reel move a body on the server only, so the own device sees them as a correction
  (a climb ~100 px, faded, not snapped). Follow-up: the device could predict a climb (it knows
  the waterfall and counts its own taps) or ease a reel; not small, since the rule decides on the
  server.
- Rocks are rectangles (`salmonsRiverNode`). Follow-up: a rounded, rock-like placeholder; it is
  drawn by the device from the river, so it needs no upload, but the river drawing's rects carry
  no corner radius today.
- A device that joins, or comes near, after a hook does not draw that line: it learns of a line
  only from the room's `hooked` (the state has no line). Follow-up if it matters: a `hookedBy`
  field in the player's state.
- The line's ends are raised by the bodies' heights (`online.ts` `drawMarks`: ¾ of the
  fisherman's body `h`, half the salmon's), and an isometric body's `h` is its depth on the
  ground, not its look's height. It matches today only because the placeholders are sized to their
  bodies. Follow-up when the S0 art lands: let the look declare its hand and middle (a rod-tip
  point on the component), or retune the two fractions to the art.
- The line, the gold and the splash are placeholders: no sound plays (there are no Salmons sounds
  yet; the Flow events are there for them).

S0 runs beside them. **Superseded (owner, 2026-11-09):** the owner rejected generating clips.
Salmons now draws the original game's images, animated in code ("Original art" below and Recent
changes). Items 1 and 2 are not needed. The #1535 clip wiring stays as an optional layer: a
published clip still wins over the code look. Item 3's bridges are moot (the engine's river has no
bridges); its riverbed, water and sea are drawn in code as the original does.

1. **Generate the character clips** in the project `salmons`: the owner's click-by-click steps
   are [guides/salmons-s0-runbook.md](../guides/salmons-s0-runbook.md) (do its one-clip smoke test
   first). `salmon_pink` (`swim`, `hop`, `caught`), `bear` (`idle`, `walk`, `swipe`), `fisherman`
   (`idle`, `walk`, `cast`, `reel`), each `_se` and `_ne`. The salmon (drawn side-on) and the
   bear (drawn from above) matter most; they are the off-angle ones. What changed from the
   approved plan, and the owner's choices, are in "S0 on the engine" below.
2. **The arcade sample's four sprites** (§9 #6), for a result in the shared runtime: the salmon,
   bear, hook and fish stills from item 1 and the props sheet, re-skinning `arcadeSalmon` /
   `arcadeBear` / `arcadeHook` / `arcadeFish` and sizing the config bodies to the art
   ([status/game-families](game-families.md) open item 11), in the `salmons` project.
3. **Lower priority, from the art pass's list:** the bridge pieces (generated placeholders today)
   and drawn tiles for the riverbed, water surface and sea (drawn in code today; the Salmon client
   needs a small change to use them).
4. **Optional, back into the Salmon repository:** only if the old game should show the new art
   before its players move over. Download each sheet and clip into `art/imported/` and re-run
   `build-sheets.py`. The engine's Salmons does not need this.

Shipping (rule 8): atlases, clips and effects already travel export → deploy → bake → pull →
register. Tiles and characters get their chains in P10.13 and P10.11. S0 adds no asset class.

### Original art (built 2026-11-09, in review; branch `arcade/salmons-original-art`)

The original game's art, built into the engine and animated in code the way the old client
(`GuiltyForever/Salmon-` 41811c2, `client/game.js`, `client/rendering/assets.js`) animates it.
Owner's choices (2026-11-09, all defaults): the bodies stay their engine sizes and the art is drawn
at the body's width; the bear is the original top-down sprite turned to its heading; the fisherman is
the original tan circle; waterfalls are drawn flat in place (the old river's height steps are not
ported); the golden salmon is the original golden painting, with #1528's glow; no idle bob.

- **The art:** `scripts/salmons/build-art.py` builds the 16 legacy images into WebP sheets committed
  under `engine-layout` `src/lib/salmonsArt/sheets/` (`terrain`, `props`, `characters`,
  `waterfall_face`; 792 KB together), with their provenance in `salmonsArt/README.md`. The bridges and
  the cliff are not built. Rule 8: the sheets are part of the runtime build, so they ship with the
  runtime release as hashed `_app/immutable/assets/` files (config-vite keeps them out of
  `assetsInlineLimit`). A room whose config names the `salmonsRiver` generator imports the lazy
  `engine-layout/salmons-art` chunk (8.8 KB gzip) and loads the sheets after the join. No other game
  fetches them, and a failed load keeps the placeholders. Guarded by `check:salmons-art`.
- **The river** (`salmonsArt/river.ts`, through a field mount in `IsoWorld`): grass-autotile banks
  and forest, a seeded procedural riverbed under a moving displacement filter and a blue tint, the sea,
  the painted rocks, sand-autotile sandbanks, the animated whirlpools, and the waterfalls' scrolling
  face, lip and splash. A 48 px world cell is drawn as a 96 × 48 diamond (the old sizes × 1.5).
- **The characters** (`salmonsArt/looks.ts`, a code look per instance in `SpawnLayer`; a published
  clip still wins, then the code look, then the placeholder):
  - the salmon is a 12-point rope through its painting, with facing flip, tilt, a breathing squash,
    the leap's lift, tilt, swell and curl from the room's `z` (2026-11-17, below), the nose-up pose and tap pulse at a waterfall's
    foot, and the spine glint in open water;
  - the bear turns to its heading and draws the claw streak on its swipe;
  - the fisherman is the tan circle.
- **The line** starts at the fisherman's hand, wiggles for 450 ms after the hook, and is drawn 2 px
  `0xddddaa` with a bobber dot. When it shows and hides is unchanged.
- **Known limits:** the swimming salmon is drawn under the water's tint by a colour matrix (since
  2026-11-18), without the riverbed's displacement wobble. The room has no
  climbing state, so a salmon nearly still just below a waterfall counts as climbing. Another
  player's climb pulses only on `climbed`, since there is no per-tap event. `rock_0` keeps a small pink
  speck from its source cell. In `salmons-play`'s authored-river rooms the page draws its seed's river
  while the server plays the authored one (true before; the art makes it visible).

### S0 on the engine (read 2026-11-08) — superseded 2026-11-09 by the original art above

The S0 recipe was written for the old client (`GuiltyForever/Salmon-` `docs/art-pass.md`).
Salmons now plays on the engine, so the art goes into the `salmons` project and ships on
**Publish**. No FTP download and no `build-sheets.py` are needed.

**The wiring (built 2026-11-08, in review; branch `s0-character-clips`).** It follows the old
client's `characterLook.js` rules. The three character components carry `characterClips`
(`referenceLayouts/salmons.ts`), resolved by `engine-layout` `characterClips.ts` and drawn by
`SpawnLayer` (detail in Recent changes):
- Each player plays `<character>_<state>_<facing>` once that clip is published, and keeps its
  placeholder while it has none. The character prefixes are `salmon_pink`, `bear` and
  `fisherman`. The golden salmon (the player's `mark`) plays `salmon_golden_*` if there is one,
  and otherwise the pink clip tinted gold.
- The states come from what the room sends:
  - salmon: `swim`, with `hop` once on `jumped` / `climbed`, and `caught` once on a catch before it
    is hidden (with no `caught` clip it hides as it does today);
  - bear: `walk` while `moving`, otherwise `idle`, and `swipe` once on its ability;
  - fisherman: `walk` / `idle`, `cast` once on its ability, and `reel` while its line holds a
    salmon.
  A one-shot plays to its end before a loop takes over.
- A missing clip is stood in for:
  1. first by a near facing: the mirror twin, then the vertical twin, then that twin's mirror;
  2. then by a near state: `hop` → `swim`, `swipe` → `idle`, `cast` → `reel` → `idle`,
     `walk` ↔ `idle`.
- The facing comes from the drawn world velocity, projected for the 2:1 view (screen
  `dx = vx − vy`, `dy = (vx + vy) / 2`). `se` and `ne` are drawn as made, and `sw` and `nw` are
  them mirrored. Standing still keeps the last facing.
- The clip's ⬚ Bounds box sits with its bottom centre at the body's feet.
- Two choices made in the build (owner may overturn): a state with no clip in any facing and no
  stand-in keeps the placeholder (the old client drew any clip of the character instead); a new
  facing must hold 150 ms before the character turns, so one pushed back and forth by a bank or
  corrected at a waterfall's foot does not flick between two facings every frame.

**Adjustments — Decided (owner, 2026-11-08: "defaults ok").** Each takes the default in brackets;
the runbook follows them.

1. **The clip count.** The plan says 22 clips, but its own table lists 13 states × 2 facings = 26.
   *(Default: 20. The golden salmon is the pink clips tinted gold by the game, so no
   `salmon_golden_*` clips are made; generated golden clips replace the tint if they exist. The
   tint is the visual fixes' gold, `SpawnLayer`'s colour matrix.)*
2. **States the engine has that the plan lacks** (P11.3). A salmon can be **grounded** on a
   sandbank (held still until it taps), **hooked** on a line (reeled in), and it **climbs** a
   waterfall by tapping. *(Default: climbing or jumping off a sandbank plays `hop` once; grounded and
   hooked play `swim`. Optional: add `salmon_pink_hooked`
   (loop, thrashing on a line) and `salmon_pink_grounded` (loop, flapping on sand), 4 more
   clips.)*
3. **Facing from velocity or from the stick.** The river's current is part of the velocity, so a
   salmon swimming upstream more slowly than the current is carried downstream and faces
   downstream. The room also sends each player's input direction (`facing`). *(Default: velocity,
   as briefed. Alternative: the input's direction while the player steers.)*
4. **Sizes.** The engine's bodies are bigger than the old client's sizes: salmon 90 × 44 (old: about
   50 long), bear 92 × 92 (old: 80 wide), fisherman 56 × 88. The clips are drawn at the body's
   width. The blueprint writes 320 × 320 frames, and Max px only shrinks, so 320 changes nothing.
   *(Default: keep the approved Max px 256 / 320, about 3× the drawn size. For sharper art, raise
   the blueprint's Output frame width / height towards its 512 maximum.)*
5. **Loops that end where they start.** `wan22_i2v_flipbook` doesn't loop, so a loop needs a
   hand-picked From / To. The library also holds `wanloopingvideo__3_`, which loops but took about
   17 min a render in its one measured run. *(Default: `wan22_i2v_flipbook` for every clip; try the
   looping blueprint on `swim` if the seams show.)*
6. **The fisherman has no source art** (the old client draws him in code), and `gpt_image` needs a
   reference image, which it *edits* rather than only borrowing its style. *(Default: the locked
   `bear_se` still is redrawn as the fisherman. Alternative: upload any drawing of a fisherman in
   the house style.)*
7. **Duration.** The blueprint's default is 5 s and the plan says 2–3 s. *(Default: 3 s for loops,
   2 s for one-shots.)*
8. **The cutout models.** The plan names a BiRefNet cutout for the stills. The `gpt_image` builder
   uses the `RMBG` node, whose clean choice is **BEN2**
   ([model-licences](../reference/model-licences.md) recommendation 1: first confirm the re-host is
   the MIT base). BiRefNet needs a builder change. The video's default matting, `BiRefNet_toonout`,
   has no recorded licence, against the owner's licence-clean-only rule. *(Default: BEN2 for the
   stills and `BiRefNet-general` (MIT) for the videos, to keep the licence-clean rule.
   Alternative: allow `BiRefNet_toonout`, the plan's choice, which may cut toon edges better, once
   its licence is confirmed.)*

## Decided (owner, 2026-10-26)

- **Models:** licence-clean only. The art pass's recipes already are: `gpt_image` (clear), a
  BiRefNet cutout instead of the default RMBG-2.0, and Wan 2.2 for video
  ([model-licences](../reference/model-licences.md)).
- **Project:** the `salmons` project is reused for the rebuild, replacing what is in it. The
  original game stays safe in its repository.
- **Facings:** a per-game option, 4 or 8 (game-families §9 #28). Salmons draws 4.

## Blocked (owner / external)

- **The generation runs in the launcher's tools** (ComfyUI on RunPod, through the Atlas Maker,
  Flipbook and FX). They are pages behind the launcher's sign-in, and a cloud session has no
  launcher account, no R2 write and no ComfyUI. Items 1–3 need a person at those tools.

### Original art as project art (plan 2026-11-17; branch `salmons-art-project`)

Owner request: the original art draws in the game but is invisible in the Sheet Maker and the Atlas
Maker, because it is built into the engine and not stored in the project. Plan:

- **(a) Convert, no renames.** Each built-in sheet becomes one project sheet in the format a
  verbatim `.plist` import writes (the Sheet Maker's byte-for-byte path, `_import_plist`):
  `salmons_terrain`, `salmons_props`, `salmons_characters` and `salmons_waterfall_face` (one region,
  `waterfall_face`, the whole page, so the TilingSprite still tiles). The WebP page is written
  byte-for-byte, a TexturePacker JSON beside it, and the manifest is built by the tools' own
  `atlas_writers.build_manifest`. Every region keeps its bare name (`grass_c`, `rock_0`, `bear`, …:
  `regions.ts`, `frames.ts`, `looks.ts`). The manifest is `locked`, `import.kind: "salmons-builtin"`.
- **(b) Upload: an explicit script, run once.** `scripts/salmons/upload-art.py` writes only
  `invisible_wall/salmons/sheets/salmons_*/…` and `…/manifests/atlas_manifest_salmons_*.json`,
  through `iw_common.storage`. It refuses any other key. The manifest is put `If-None-Match: *`
  first, then the page and JSON, the order an import uses. It is idempotent: an object already there
  with the same bytes is skipped. One with different bytes stops the run and is reported, never
  overwritten. A dry run (the default) lists what it would do; `--apply` writes.
- **(c) The runtime prefers project art.** The online runtime looks for the project sheets
  among the project's shipped editor art (by manifest key, never a bare name another sheet might
  pack). Each region the drawing code names comes from the project sheet when it ships there, and
  from the built-in copy otherwise. A built-in page is fetched only when a region still needs it.
  A snapshot published before this has no such sheets and draws exactly as today.
- **(d) The full chain.** The `art` exporter (`editorArtExport.ts`) seeds the project manifests when
  the Game Config's `arcade.online.generator` is `salmonsRiver` or `salmonsMap`, so they reach
  `deploy/editor-art/` + `_pages/`, the bake, the pull and `bakedEditorArtAssets()` with no new
  asset class. Seeds the project does not hold are skipped and never reported missing, since the
  built-in copy covers them.
- **(e) Gates.** `check:salmons-art` keeps its checks, and adds: the project-sheet plan names every
  region the drawing code draws, inside its page, with the built-in frame's size; the resolver takes
  a project region and falls back for a missing one, for every name; the exporter and the runtime
  are wired to the plan's sheet names (read off their source). `check:art-scope` case 11 runs the
  real exporter over them.
- **Cost after the republish.** A shipped sheet is preloaded at boot like all editor art, so once
  Salmons is republished its four sheets (about 0.8 MB of WebP, or their KTX2 twins) load behind
  the loading screen instead of after the room's join, and stay resident. Until the republish
  nothing changes.
- **(f) The built-in copy stays** as the fallback, for now: it is what every published snapshot
  draws until the owner republishes, and what a room falls back to if the project's art fails to
  load. Retire it once Salmons has been republished with the project art and played.

## Recent changes

- 2026-11-18 — **Movement and terrain rules, as the original's** (workstream WS-A of the
  original-vs-pipeline gap report, `docs/reference/salmons-original.md`; branch
  `claude/salmons-ws-a-movement`; in review; runtime change). Everything below is for
  `salmonsMap` levels only (`river.generator === 'salmonsMap'`); P10.16's band river plays exactly
  as on `main` (items 4 and 7 are gated by flags only the original level's rules carry):
  1. **Speeds** (`salmons.js` `ORIGINAL_SPEED`): salmon 6, bear 4.5, fisherman 5 cells/s (288 /
     216 / 240 px/s), also the bots' brains. The band river keeps 240 / 190 / 140 (its gates and
     traces are recorded on them).
  2. **Bank: a wall, not a push** (`salmons.js` `originalBounds`): per band, solid zones for
     `salmon` left and right of the water, inset by the salmon's half body (45 × 22 px) so they
     stop its CENTRE at the middle of the edge cells (the original's `isInWater`, `|gy − m| ≤ halfW`);
     the sea is solid to a salmon the same way. No `BANK_PUSH` on these levels. A salmon pressed
     diagonally into a bank slides along it (the engine's solids move x then y); the original's
     stops dead. One zone of each band overlaps the next by a pixel so no band line is open.
  3. **Whirlpool** (`abilities.js` `pullTowards`, opt-in `pull.unit`): `v = strength · (d / unit) ·
     (1 − d/radius)`, clamp kept; Salmons sets `unit: CELL` (`WHIRLPOOL_PULL`): 14 cells/s at 2
     cells, 6.1 at 3.5, as the original's unnormalised offset. Without `unit` the pull is as before.
  4. **Sandbanks** (`salmonsRules` `sandbanksOf`): on an original level the sandbank rule carries
     `cell: 48`, "on sand" is within 0.8 cells of a sand cell's centre (`SAND_REACH`), and inside
     the `salmons` module (which plays the leap off the sand) a free salmon at most 0.05 cells up
     is grounded every step it is there (not while its leap off the sand rises, nor in the step its
     tap let it go), so it hops across the islands as in the original. Anywhere else the `onSand`
     latch stays (once a visit): the band river, and the standalone `sandbanks` module, which has
     no leap and would otherwise hold a salmon on the sand for good.
  5. **Salmon spawn spread**: `salmonsMapRiver` gives `salmonSpawns`, 39 places a cell apart across
     column 390 (±0.4 · halfW(390)); the room picks one at every (re)spawn. Generic: a character's
     new `randomSpawn: true` (Game Config `ArcadeOnlineCharacter`, normalised) makes
     `services/game-server` `roomSim` draw from its `spawns` with an RNG seeded from the room's
     seed (`createRng`, never `Math.random`) instead of taking them in turn, for its bots too.
  6. **Bears in the water, waterfalls and bank limits**: the water is no longer solid to bears
     (still to fishermen). Per waterfall a zone solid to `bear` both ways stops its centre 1.5
     cells from the line across the water; per band, zones solid to `bear` and `fisherman` past
     `halfWidth + 12` cells (inset by each body's half width); rows ≤ 5 and ≥ 395 solid to both
     (inset by their half heights). The band river keeps its water, sea and source solids. The
     bear bot's `chase` follows a salmon into the water and catches it (simulated; `check:room-bots`
     still runs the band river).
  7. **The lip** (`salmonsRules` `waterfallClimbing`): an original level's waterfall rule carries
     `aloft: true`, and a salmon passes it only while `z ≥` its top; a tap at the top climbs it back
     there. Without the flag (the band river) `memo.over` passes it until back on the water, as
     before. The status' old "burst-input
     problem" was checked in a room sim (an input every step or at 20 Hz, delivered in bursts of
     1–6 steps, taps every 2–30 inputs, three levels, 150 runs): every tap rate of 2–15 inputs
     crossed; at one tap a second, 2 of 30 runs under 130–200 ms bursts had not within 20 s (the
     original asks for taps at the top too). It holds because one
     input while that high moves the body into the one-way solid, and from inside it no longer
     blocks. So the fallback (keep `over`, expire it after 2 steps) was not needed.
     `salmons-levels-play.mjs` keeps tapping at the top until over; `salmons-play.mjs` (band
     river) keeps its single top-out.
  8. **Catcher spawns**: `salmonsMapRiver` `botSpawns` are the original's `findCatcherSpawn` drawn
     from the seed (`${seed}_catchers`): each place the first of 30 tries of
     `gx = 30 + rand · 340`, `gy = meander ± (halfW + 3 + rand · 5)` at least 15 cells from the
     places before it, up to 32 (the original's fallback when none is found). Bears and fishermen
     take one at random per spawn (`randomSpawn`). Not the original: the 15 cells are kept from the
     other PLACES, not from the catchers in the room now.
  9. **Bridges for fishermen** (`salmonsRules` `bridges`, in `salmons`; zones `bridge<i>` of a new
     zone kind `bridge`, Game Config `ONLINE_ZONE_KINDS`): the fisherman's water solid has a hole
     at each bridge (its deck's cells and the 2-cell slopes, tall enough for the 88-px body to stand
     half a cell either side of the deck's row). A free fisherman within half a cell of the row,
     over the deck or a slope, is put on the row with `z` = 6 cells on the deck, ramped down the
     slopes, back to 0 off it (`fall` leaves it alone there). `z` already syncs (`Player.z`), so no
     schema change. Salmon and bears pass under. Left: the drawing (WS-C), and the own device
     predicts neither the row nor the height (a correction).
  - **Known gaps** (owner may overturn): a salmon slides along a bank where the original's stops
    dead; the bear and fisherman bank limit (`Beyond*` zones) is per band and not inset across a
    band line (at a width change a body is held to the stricter of the two rows), and measured
    from the rounded water edge (at most half a cell off the original's unrounded meander); the
    catchers' 15 cells are kept between places, not live catchers; the bridge snap also catches a
    fisherman walking along the river through a slope's row (as the original's); a waterfall
    authored onto or next to sand cannot be climbed with single taps (lessons/arcade.md). The
    bear's waterfall block is centred on the original's cells (half a cell below the salmon's
    fall line).
  - **Proof:** `check:salmons-levels` 18 (6 new: speeds, the bank wall, re-grounding, bears, the
    bridge, the spawns); `check:salmons-heights` 24 (the band river's lip as before, the `aloft`
    lip the original's); `check:salmons-jump` 34 (the whirlpool check the original's formula; new:
    a pull without `unit` as before, and where sand re-grounds). No trace or fixture re-recorded:
    `salmons-traces.json` (band river) replays unchanged. Playbooks on an arcade build:
    `salmons-play.mjs` 76/76 (band river, single top-out; engine and colyseus netcode),
    `salmons-levels-play.mjs` 18/18 (its height-8 cliff, added in the delta's sand, now also
    removes the sand from the cliff to the sea: a salmon grounded on sand at the foot each time it
    lands only climbs with a second tap in the air, which the page's slow taps never give; the
    original's own waterfalls never stand in sand; it also taps on at the top until over). On the
    first cut (before the band river's rules were gated back): `online-play.mjs` 19/19 (both
    netcodes), `arcade-play` 14, `arcade-characters-play` 14, `arcade-platformer-play` 15,
    `arcade-camera-play` 12.
  - **Bundle** (the runtime-bytes manifests, built at the CI path against `main` at the same
    path): arcade +1031 B gzip, arcade3d +927 B; slot +28, match3 +19, card +25 (Game Config's
    normaliser only: `randomSpawn` and the `bridge` zone kind; `check:family-runtimes` first visit:
    arcade +1015, arcade3d +925, slot +25, match3 +30, card +26). A first cut leaked about 80 B of
    `salmonsMap.js` into every runtime (a frozen constant reading `SALMONS_MAP.RIVER_LENGTH`, kept
    for its property read); the constant no longer reads one. `check:family-runtimes` fails on
    `main` already (all five runtimes over their budgets by about 23–33 KB) and fails the same five
    here. `scripts/runtime-bytes/{lines,match3,card,arcade,arcade3d}.json` re-recorded at the CI
    path on this branch's base and verified (`runtime bytes ok`).

- 2026-11-18 — **Bloodstains, as the original's** (branch `claude/task-t-bloodstain-engine`; in
  review; runtime and game-server change). Source: `GuiltyForever/Salmon-` PR #8 (merged; read
  through the GitHub API this session).
  - **The rule** (`salmonsRules.js` `bloodstains`, inside `salmons` only, before `fishingLine`): a
    salmon whose status turns `out` leaves one stain, at its place (a bear's catch), or at the
    place it was first seen `hooked` (a line's landing: it is reeled onto the bank first, as the
    original's `hookX/hookY`). Kept in the module for the room's life, through every round;
    `STAINS.max` 300, the oldest shifted off. Deterministic, server only.
  - **The wire**: the rules' new `stains` (`{ list, made }`; `onlineRules.js`, a module's new
    `stains()` hook, `NO_STAINS` without one) and a room field `stains: Stain[]` (`x`, `y` float32;
    `schema.ts`). `arcadeRoom.ts` `writeStains` pushes only the stains made since the last patch
    and shifts off the ones the cap let go. A room field, so a nearby room sends it to everyone.
  - **The drawing** (`engine-layout` `salmonsArt/blood.ts`, `BLOOD`): each stain the original's
    four-ellipse blob at alpha 0.35, turned ±0.2 rad and scaled 0.8–1.3 by a hash of its place (the
    same on every device), raised with the ground. The old client drew stains in its underwater
    layer, under the water's tint; here the tint is in the river art below the players, so the
    blob's colours are mixed with the tint under it (`(1 − 0.75)·c + 0.75·tint`, the same picture
    exactly, as the swimming salmon's own filter). A salmon free and under the water within 0.8
    cells of a stain is tinted 0xff3a3a for 3 s and sheds a 0.35-size puff every 70 ms at 0.5,
    fading over 3 s, under the swimming salmon. Under the 0.75 tint a stain reads as a dark
    shadow with a little red, as the old client's maths give it; brighter is an owner call
    (`BLOOD`), not a port.
  - **The layers** (`salmonsArt/blood.ts` `mount`, `sink`): the stains are drawn with the river
    art, over it, after the trail and a Pixi `RenderLayer` that each salmon its code look draws
    under the water is drawn in (sorted by its instance's depth). The players' layer is drawn after
    the river, so a swimming salmon is under the stains and below every character above the water
    (a bear on the bank, a leaping salmon), as the old client's two layers. All of it is in the
    Salmons art kit: `<SpawnLayer>` and `arcadeArt.svelte.ts` are unchanged, so the slot, match3 and
    card runtimes keep their bytes (`check:runtime-bytes`; only arcade and arcade3d re-recorded).
  - **Proof**: `check:online-rules` (38: a stain at each catch's place and at the hook's for a
    landing, none for an escape; outlasts the round, capped; live, both devices and a late joiner
    are sent it), `check:salmons-art` (22: the numbers, the tinted colour against `underTint`, each
    stain's place, lift, turn and size alike on two kits, the 0.8-cell contact, 3 s of red and a
    puff per 70 ms, the trail's fade, the layer order and the sinking), `salmons-play.mjs` pages K (bear) and Q (salmon) in
    `salmons-blood`: one stain where the salmon was held out, sent to and drawn on both pages. The
    red is not played in the browser: those pages draw the seed's river over the authored room.
- 2026-11-18 — **The whole leap, as the original's** (branch `arcade/salmons-full-jump`; in review;
  runtime change). Closes the leap's "Not yet ported" list (entry of 2026-11-17 below). Source: the
  original at 41811c2 (`server/index.js` jump and move handlers and `update`, `client/game.js`
  layers), relayed as excerpts; this session had no access to that repo.
  - **Direction** (`salmonsRules` `leapMove`, `LEAP_AIM`): a tap of jump leaps towards the tapped
    point (the input's `aimX/aimY` since #1722, world px) when it is more than 0.5 cells from the
    salmon, as a unit vector; otherwise along the last move longer than 0.01 of a full one (the
    original's `playerLastDir`), and before any move the original's `{vx: 0.7, vy: −0.7}`. Then
    ×1.0 along the river and ×0.9 across it, × the salmon's speed, quantised to the input's whole
    units (127 a full move). "No aim" is `aimX = aimY = 0`: what a key's input sends
    (`online.ts` `keyInput`); a bot aims at itself, inside the dead zone.
  - **Carried** (`online.js` `carriedInput`, the rules' new `steer` hook): above 0.05 cells a move
    of 0 does not stop a leaping salmon; it keeps the leap's move until it steers (a non-zero move,
    carried in turn) or is back on the water. As it goes up the room gives it as many inputs to
    carry for as the leap has steps above 0.05 cells (`air`, from the fall's own stepping,
    `stepsAloft`), spent one an input, and sends them with the move (`carryX`, `carryY`: three new
    `Player` fields, defaulted to 0). A salmon let go from a climb (at the top, or out of reach)
    carries the move it was last stepped or steered with, as the original keeps `vx/vy` through
    the climb. Caught, hooked, grounded, climbing or at a round's end it carries nothing.
  - **Predicted:** both device predictors fold the same input: the engine predictor
    (`netcode.js`) keeps the carry per `seq` beside the place and compares it at `ack`; the SDK
    reconciler mirrors `air`, `carryX`, `carryY` (`RECONCILED_FIELDS`) and steps
    `carriedInput`. The launch itself is the room's (the device does not predict `z`), so a leap
    costs one correction a round trip after the tap, at most the in-flight inputs' worth of
    carried move (240 px/s × the round trip), faded over 100 ms; after it the device matches the
    room step for step (pinned with 0 and 4 steps of lag, and through a stall and its catch-up).
  - **Over the low pieces** (`lowPieces`, the `level` hook #1734 added): at 0.5 cells or higher a
    salmon is stepped without the rocks' solids and without the whirlpools' pull or current (on
    both kinds of river: the band river's spinning current acts on the water only, and a leap
    clears it, as the original's whirlpool does not act on a leaping salmon). The device does
    not know `z` per input, so a leap over a rock or out of a whirlpool is a correction, as passing
    over a waterfall already was.
  - **Whirlpools** (`salmons.js` `WHIRLPOOL_PULL`), on the original's levels (`salmonsMap`) only:
    a pull towards the centre within 4 cells (radius² 16) of `14 · (1 − d/4)` cells/s, an opt-in
    `pull` on a zone rule (`abilities.js`, predicted by the device like any current), a velocity
    added for each motion step like the current's (not integrated), held so that a step never
    carries the salmon past the centre. It does not raise the snap distance (`strongestForce`
    counts pushes only: a pull moves a body at most to its centre). P10.16's band river keeps its
    spinning current on the water, so its recorded traces keep it. Game Config's normaliser does
    not carry `pull` (game-config is in every runtime), so only a generated level's whirlpools pull.
  - **The line** (`abilities.js` `useAbilities`): a `hook` offers its targets nearest first while
    the module answers `'pass'`, which Salmons' line does only for a salmon above 0.1 cells, so a
    cast passes over a salmon in the air for the next in reach; with none on the water it misses
    and the cooldown is spent. A fisherman who already has a line, or a nearest target already
    hooked, whiffs there as before (`false` ends the cast). The offline loop's hook answers nothing
    and keeps the nearest.
  - **Under the water** (`salmonsArt/leap.ts` `underwater`, `underTint`; `river.ts`
    `waterUnder`): a salmon on open water (not the sea, a sandbank or a rock), at most 0.1 cells up
    and not climbing is drawn under the water's tint, with its spine glint; in the air, climbing or
    on sand or a rock it breaks the surface, crisp, the glint hidden. The engine's players are a
    spawn layer above the river node, so the look cannot be reparented under the river's tint
    layer. The nearest faithful thing: a colour matrix on the salmon that is exactly a tint square
    of its cell's colour (water, rapids, source) at 0.75 laid over it, `(1 − 0.75)·c + 0.75·T`. Not
    matched: the riverbed's displacement wobble on the swimming salmon.
  - **Fixes on the way:** `arcadeRoom.ts` writes `z` (and the carry) only for a player that has
    them, not `z = 0` for every player of every arcade game; a reset to 0 is a set value, so it
    still reaches devices. A tap or a pointer on raised ground (past a waterfall) was read on the
    flat ground, off by the lift on both axes; `online.ts` `fieldPoint` now takes it on the own
    player's ground (this also fixes mouse and touch steering past a waterfall).
  - **Assumed beyond the excerpts** (owner may overturn):
    - the original's grid `vx` runs along its river and `vy` across (its waterfalls' `obs.x` is
      the column `gx`, `salmonsMap.js`), so ×1.0 is along (engine y) and ×0.9 across (engine x),
      and the default `{0.7, −0.7}` heads downstream and to the river's low side;
    - the carry lasts while the salmon is above 0.05 cells (the move handler's own test); on the
      water a move of 0 stops it, as every engine body;
    - a tap that leaves a sandbank does not make that input's move the last direction (the
      original's grounded move handler returns first);
    - the whirlpool's pull is towards its centre and in cells/s, a velocity added for the step
      like the current's, not integrated into the salmon's own velocity;
    - "a solid obstacle tile" for the look is a sandbank or a rock; the sea is open water but has
      no tint in the engine's drawing, so a salmon there keeps its glint and gets no tint;
    - the hook, which travels and tests every tick in the original, stays one-shot here and takes
      the nearest salmon on the water in reach.
  - **Deploy:** release the game server and the runtime together. An old runtime against the new
    server does not fold the carry, so most inputs of a leap are a correction; a new runtime
    against an old server simply never carries.
  - **Known limits:** a step with no input still moves nobody, so a stall pauses a leap's travel
    while its height keeps falling (the original's would fly on); counted by inputs, the carry
    then goes on after it lands for the stalled steps, so the leap still covers its ground. Found
    by the playbook, whose pages send their inputs in bursts: a carry cut by the height covered
    half the ground. The tap's aim is read on the own player's ground, so a tap on ground raised
    differently from it is off by the difference. The swimming salmon shows a quarter of its
    colour under the 0.75 tint (the golden one reads cyan-gold): the owner should look at it in
    play; the tint's strength is one constant (`river.ts` `TINT_ALPHA`, shared with the
    riverbed).
  - Proof: `check:salmons-jump` 32 (15 new: the direction to a tap, the dead zone, the last move,
    the default, the scaling, the carry until a steer or the water, the carry after a waterfall's
    let-go, `|v| > 0.01`, the statuses that end it, the room and both predictors folding it
    exactly with 0 and 4 steps of lag, a stall that pauses it with the device still exact, a tap
    mid-batch (two inputs a step) carried exactly the leap's inputs and no further, a rock
    cleared at 0.5 and not at 0.49 cells, the whirlpool's formula, its cut-off and its clamp at the
    centre, the line passing over a salmon in the air but whiffing on a fisherman's second line or
    a hooked nearest, the look's surface and tint). `salmons-traces.json` re-recorded: only
    the `line` trace's salmon `b` moves, after its escape, when its taps leap it upstream along its
    last move (it hovered upstream before it was hooked): steps 160–200 and its end place (6
    lines). `check:netcode` prints exactly what it printed before. Playbooks on an arcade build:
    `salmons-play.mjs` 76 / 76 with `--netcode colyseus` and 75 / 76 with `engine` (the "hooked
    again, the fisherman leaves" verdict, which also fails now and then on `main`, passed on the
    run before), with a new verdict: on page P a quick tap four cells across the river leaps the
    salmon there, carried 216–238 px with the finger lifted; the gold and isometric verdicts read a
    swimming salmon through the tint; page P's climb waits up to 1.5 s for the swim over, as page
    E's. `salmons-levels-play.mjs` 18 / 18. Bundle: `arcade` +568 B gzip in the main bundle and
    +297 B in the lazy Salmons art chunk; `lines`, `match3` and `card` build byte-identical to
    this branch's base.
- 2026-11-17 — **The original art imported into the project** through the Sheet Maker's `.plist`
  import, no R2 key: `scripts/salmons/plist-export.py` writes the four `.plist` + `.webp` pairs and
  reads each back through the tool's own `plist_import.parse_plist` / `validate`. Verified in R2:
  all regions match, pages byte-identical, locked. Next: the owner republishes `salmons`.

- 2026-11-17 — **Waterfall heights, the original's climb and the raised river** (branch
  `arcade/salmons-waterfall-heights`; in review; runtime change). Source: the original at 41811c2
  (`server/mapGenerator.js`, `server/index.js` jump handler and `update`, `client/game.js`,
  `assets.js` `createCliffFace`), relayed as excerpts; this session had no access to that repo.
  - **Heights:** already the original's per seed (`salmonsMap`, 1..8, higher towards the source;
    an overlay `set` re-heights a column). They now reach the room: each waterfall zone carries its
    `height` (cells; a river with none, P10.16's `salmonsRiver`, is 1, the original's lowest).
  - **Climb** (`salmonsRules` `waterfallClimb`, in `salmons`; replaces the engine's 4 taps, 0.6/s
    drain and the lift over the top): a tap of jump within 2 cells of a waterfall's obstacle cells,
    on its downstream side and below its height, lifts the salmon 2.4 cells (to the top at most)
    and climbs; the tap does not leap. While it climbs the room holds it still (a new module hook,
    `holds`) and it slides back 0.8 cells/s. At the top it is let go at that height (`climbed`),
    still on the downstream side, and falls under the leap's gravity; out of reach it is let go;
    at 0 it is back on the water. No teleport. Taps to the top, as fast as one can tap at 30 Hz:
    H 1–2 one, 3–4 two, 5–7 three, 8 four. The climb steps in the original's cells, so each step is
    the original's to the bit.
  - **Passing over:** a waterfall blocks a salmon only while it is lower than the fall: the room
    steps a salmon at least as high without that solid (a new module hook, `level`, used by
    `roomSim`). A low fall can be leapt over, as in the original. One engine adaptation: a salmon
    let go at a fall's top passes that fall until it is back on the water. The original's window is
    the step it is let go and the next; here a step with no input rests and a device's inputs come
    in bursts, so a browser salmon held at the foot missed it (found by the playbook below).
  - **Elevation** (`engine-layout` `referenceLayouts/salmonsElevation.ts`): every row upstream of a
    waterfall is raised by its step, `elevStepFor(H) = 32 + 16·H − 16` old px × K (24 + 24·H px),
    summed over the waterfalls below it (the original's `riverElev`). The art draws the whole world
    raised (`salmonsArt/river.ts`: river, banks, trees, rocks, whirlpools, lips; the splashes at the
    foot), a cliff of `cliff.png` under each lip (one texture `32 + 16·H` old px high, tiled across
    the world, sheared to the fall's line; the project sheet `salmons_cliff` wins, as #1718), and
    the falling water as a sheet over the river's width in front of it. `load.ts` now loads the
    cliff (before this, `pickSalmonsRegions` named `cliff` but nothing loaded it, so the art threw
    and a room kept its placeholders). Characters, their glow, lines and the rules' splashes are
    drawn raised with the ground under them (`online.ts` moves each drawn place back by its lift,
    which the projection makes straight up). Each player's lift eases towards the ground's (10/s,
    taken at once on a respawn), so crossing a line is not a 216 px pop; the camera takes the own
    player's.
  - **`/editor`:** the Generated level card draws each waterfall's step as a cliff strip that deep
    upstream of it (the stage is flat), from the same drawing a device uses; an overlay `set`
    re-steps it.
  - **Review fixes (same branch):**
    - A climb when a round ends no longer freezes the salmon through the break. The rules ask a
      module's `holds` and `level` only while a round runs, and a round's end clears every
      player's module notes with its `z`.
    - The room syncs `held` (a new `Player` boolean: free but held by a module). The engine
      predictor and the SDK reconciler (`RECONCILED_FIELDS` + `held`) step a climbing salmon with
      no input, as the room does. A leaping salmon is not held and keeps moving.
    - The climb's pose (nose up, a pulse a tap) now shows while the room holds the salmon. The old
      foot-distance guess is gone.
    - The reach across the river is measured from cell centres, as `salmonsMap` places pieces.
    - A climb keeps to the waterfall its tap climbed.
    - The river's band currents push a salmon by its centre (a new opt-in `centre` on a zone
      force, `abilities.js`), so on a band line one current carries it, not two. Two bands of
      rapids gave 280 px/s against its 240, so a topped salmon could not cross. Authored rivers
      keep the old rule: Game Config's normalising drops the flag.
  - Proof: `check:salmons-heights` (23 checks):
    - heights per seed against the original's formula;
    - the climb step for step against the original's at 30 and 60 Hz, three tap rates, H 1..8;
    - no teleport, held, let go, slid back, a tap mid-leap, two waterfalls in reach;
    - `level` by height and by the waterfall topped;
    - the reach across the river and into the banks;
    - a climb at a round's end;
    - every waterfall of four band rivers and three original levels climbed and passed;
    - the elevation per row for five seeds and an overlay `set`, and `/editor`'s strips.
    `salmons-traces.json` re-recorded: only the climb trace changes (the old lift over the top,
    now the climb from the foot and the swim over the first waterfall).
    `scripts/playtest/salmons-levels-play.mjs` gains a pinned level with a waterfall of height 8
    added by an overlay near the sea (`salmons-cliff`): a cliff per waterfall, the climb in place
    and over in the climb's pose, drawn raised by 216 px past it. `salmons-play.mjs`: its climb
    verdict waits 1.5 s for the swim over, and its pixel probes add the ground's lift (the
    probe's `drawn[].ground` and `camera.lift`).
  - **Assumed beyond the excerpts** (owner may overturn): the climb's reach is measured along from
    the fall's line (`y = (gx + 5)·CELL`) and across from the centre of its nearest obstacle cell; a
    climb keeps to the waterfall its tap climbed; while climbing the current does not move the
    salmon either; a tap that frees a salmon from a sandbank does not also climb; the room's one-way
    solid stands in for the original's collision radius (2.25 cells²), so a salmon passes as soon as
    any of it is past the line; the cliff spans the whole drawn width (the excerpt's `EXTEND_TILES`
    is not known); the falling-water sheet is as high as the cliff; a drawn lift eases at 10/s; the
    original's no-texture fallback is not drawn (the art never draws without its regions).
  - **Known limits:** a device predicts the climb's hold only from the room's `held`, a round
    trip late, and does not predict passing over: it sees that as a correction (a stop, then a
    jump forward). A salmon that taps on below the line climbs again (one `climbed` each), as the
    original's rules do.
    The runtime-bytes manifests for `arcade` and `arcade3d` need re-recording from CI's artifact
    (the builds here do not reproduce the committed manifests even before this change); `lines`,
    `match3` and `card` build byte-identical to this branch's base. Arcade bundle: +375 B gzip in
    the main bundle, +404 B in the lazy art chunk, and the 19 KB `cliff.webp` fetched only by a
    Salmons room.

- 2026-11-18 — **The cliff is drawn, so it is a drawn tile and a project sheet** (with the waterfall
  heights). #1733 keeps a built tile out of `SALMONS_DRAWN_TILES` until something draws it; the
  waterfall-heights work draws `cliff`, so it joins `SALMONS_DRAWN_TILES` and `cliff` →
  `salmons_cliff` joins `SALMONS_PROJECT_SHEETS` (a one-region sheet like the waterfall face;
  `upload-art.py` now writes 15 keys). Replaces the separate cliff-sheet PR (#1732).
- 2026-11-17 — **The salmon's leap and curl** (branch `arcade/salmons-jump-curl`; in review;
  runtime change). Owner: "I am also missing the jump of the salmon completely. It used to look like
  he jumped, and also curl when doing so." Cause: the leap was never ported. The room had no
  height, the only `jumped` came off a sandbank, and the look played a 600 ms tilt and wiggle on it
  with no lift. Source: the original at 41811c2 (`server/index.js` `onMessage('jump')` and
  `update`, `client/game.js` salmon pose), read by the waterfall-heights session and relayed as
  excerpts. This session had no access to that repo.
  - **Room** (`salmonsRules` `salmonJump`, inside the `salmons` module): a tap of jump
    by a free salmon with `z` 0 leaps at 11 cells/s under 20 cells/s². That is the old server's
    stepping exactly: about 1.1 s up, the top about 3 cells (145 px). There is no second leap in the
    air. A tap that climbs a waterfall does not leap. A tap off a sandbank does (one `jumped`). A
    catch or hook puts it back on the water. The height goes to devices as the player's `z`
    (world px, a new `float32` in the room state).
  - **Look** (`salmonsArt/leap.ts`, `looks.ts`): the old client's pose, driven by `z`. Jump factor
    `min(1.5, z/2)`, tilt `factor·0.4`, swell `1 + factor·0.12`. The curl eases to
    `min(1, factor)`; arch `−curl·sin(2π·2 Hz·t)·36` with the tail envelope `(1 − i/11)^2.5`. Lift
    16 old px a cell × K (24 px a cell, 72 px at the top). The drawn height follows the room's
    smoothly between steps. The excerpts name no shadow or splash, so none is drawn.
  - **In the air** (the original's answers): a leaping salmon is not grounded on a sandbank (above
    0.05 cells) nor hooked (above 0.1 cells); both are in this PR. A bear still catches it, as the
    old bear did.
  - **Not yet ported** at the time (all four, and the tap target, followed on
    `arcade/salmons-full-jump`, entry of 2026-11-18 above): the leap's direction, a rock cleared at
    0.5 cells, a whirlpool pulling only below 0.5 cells, and the salmon drawn under the water's tint
    while it swims.
  - **Known limits:**
    - Other salmon's height comes from the newest room state while their place is interpolated
      (the shared `Interpolator` carries x / y only), so their lift leads their drawn motion by the
      interpolation delay. The own leap starts a round trip after the press: the device does not
      predict `z`.
    - A round's end puts every leaping salmon back on the water at once.
  - Proof: `check:salmons-jump` (the height step for step against the old formula at 30 and 60 Hz,
    the one-leap, held, climb, sandbank and catch cases, and every pose number and curve).
    `salmons-traces.json` re-recorded: it only gains `jumped` events, and no position changes.
  - Waterfall heights, the height-aware climb and the raised river followed on
    `arcade/salmons-waterfall-heights` (entry above).
  - Next (second PR): waterfall heights, the height-aware climb (step 2.4, slide 0.8 cells/s, no
    teleport) and the river and banks raised by each waterfall, with `cliff.png`.
- 2026-11-17 — **Mouse and touch** (branch `arcade-pointer-controller`; in review;
  [design/arcade-pointer-controller](../design/arcade-pointer-controller.md)). Owner: the original
  was a touch-screen game and the rebuild had no mouse or touch movement. Read the original's input
  (hover-to-move, a held finger steers, a 12 px tap is the class's action, the newest finger
  steers, 1.5 tiles dead zone) and built it as a pipeline option: `engine-mechanics`
  `pointerControl.js`, `arcade.online.pointer` in Game Config with its `/config` card, the device's
  online input (`online.ts`), on for Salmons in `salmons.js`. Default off: a config without the
  block sends the same inputs as before. Proof: `check:arcade-pointer` (20),
  `check:game-config-family`, `check:room-sim`, `salmons-play.mjs` 73 / 73 in each netcode. Taking
  it live is the owner step above.

- 2026-11-17 — **The original art becomes project art** (branch `salmons-art-project`; in review;
  plan in "Original art as project art" above). Built: the conversion (`scripts/salmons/project-art.mjs`)
  and its upload (`scripts/salmons/upload-art.py`, dry run by default, create-only writes, stops on
  any key holding other content; not run: the owner imported the sheets through the Sheet Maker
  instead, owner step above); `game-config`
  `salmonsProjectArt.ts` (sheet names, generators, the manifest-key test); the `art` exporter's
  Salmons seed; the online runtime drawing each region from the shipped project sheet, else the
  built-in (`load.ts`, `regions.ts` `pickSalmonsRegions`; `editor-scenes.ts` `editorArtSheetsWhere`).
  Proof: `check:salmons-art` (4 new checks: the plan covers every drawn region at its built-in place
  and size, the project-first choice and its fallback for every name, the seed), `check:art-scope`
  case 11 (the real exporter ships the held sheets by manifest key, not a look-alike sheet or
  another project's, and none for another generator), `salmons-levels-play` (a snapshot shipping a
  magenta `salmons_terrain` draws magenta banks; without it, none). Current games: no published
  snapshot carries these sheets, so every game draws as before until Salmons is republished.

- 2026-11-17 — **The lobby** (branch `arcade/salmons-lobby`; in review;
  [design/salmons-levels](../design/salmons-levels.md) §4). Owner: the room is an authored screen
  people wait on before a session; it starts on 4 people or 60 s after the first, after a 10 s
  countdown; later rounds follow on as before. Built: `rules.lobby` in the room rules and Game
  Config (with `/config` fields), the `lobby` and `countdown` Flow events, Salmons' Lobby and Lobby
  countdown screens and their flow, the export's lobby. Proof: `check:room-lobby`, the playtest's
  lobby pages. Taking it live is the same owner re-upload as the levels.

- 2026-11-17 — **Salmons plays the original game's levels, by seed, with authored overlays**
  (#1699, branch `arcade/salmons-seeded-levels`; in review). The owner gave the original source and chose
  random-by-default plus a pinned list. Built: the line-for-line port and its PRNG (checked against
  seven seeds of the original), the `salmonsMap` generator and its conversion to the engine's river,
  `arcade.online.levels` in Game Config (normalised, a warning on another generator), the room's
  pinned-or-random seed, the locked `generated` river node and `/editor`'s Generated level card, the
  export on level 1, the gate `check:salmons-levels`. Left: bridges, waterfall heights in the climb,
  the art on the editor stage, clicking a cell, and the owner's authored lobby screen (its own PR; design §3). Taking it live is an owner re-upload of
  the export (owner steps).

- 2026-11-16 — **Seeded levels planned** ([design/salmons-levels](../design/salmons-levels.md); branch
  `arcade/salmons-seeded-levels`): why the editor's river differs from a room's (another
  generator than the original's, one baked seed, placeholder vs original art, generated zones
  replacing authored ones) and the plan: the original generator ported as one pure seeded function,
  a seed picker in `/editor`, a per-seed authored overlay that survives a reseed, shipped by the
  export → bake → pull → register chain. Nothing built yet (Blocked above).

- 2026-11-09 — **Salmons draws the original game's art, animated in code** (branch
  `arcade/salmons-original-art`; in review). Detail in "Original art" above. Engine seams, all
  inert without a mounted art: `engine-layout` `arcadeArt.svelte.ts` (a field mount per node, a code
  look per instance), `MountedArt.svelte`, `IsoWorld` (draws a mount in place of its node),
  `SpawnLayer` (clip → code look → placeholder; a styled line in its own pass),
  `arcadeMarks` `InstanceLink.style`; `apps/lines` `online.ts` loads the art under the generator,
  drives each look from the drawn place, status, mark and the room's events, styles the line and
  tears it all down on leave. Gates: `salmons-play.mjs` **69 / 69 in each netcode** (8 new: the
  river art against the seed's river, the golden rope, the bear and its streak, pink vs golden on
  two devices, the fisherman's circle and hand, the line's colour on screen, the bear's code look, the river destroyed when the room goes);
  `check:all` 626 / 626 (new `check:salmons-art`, 10); `check:svelte` at baseline; the arcade
  playbooks and `online-play` pass; the current-games harness 10 / 10 games, 0 of 128 screens
  changed. Sizes (gzip, vs main): arcade first visit and online boot +1,271 B (online boot 789,689
  under its 797,252 budget), slot / match3 / card +419 to +434 B (the shared `SpawnLayer`), the
  shell unchanged; the art chunk 8.8 KB and the sheets 792 KB load only in a Salmons room.
  Review fixes (same day): the river's art is destroyed on leave (its mount owns its lifecycle and
  destroys the containers it made); a room left while its seed loads gets no art; the field waits for
  the app; the culling is padded so nothing pops in at the view's edge.
  **Owner:** nothing to upload; the art arrives with the next runtime release after the merge.

- 2026-11-08 — **The golden salmon drawn gold, the line drawn, the rules' events in Flow, the looks
  on their places** (branch `arcade/salmons-visual-fixes`; in review). Engine and runtime (no
  upload): `online.ts` publishes, every frame, the marked players and the `hook` lines
  (`onlineFlow.js` `createHookLines`); `engine-layout` `arcadeMarks.svelte.ts` holds them and
  `<SpawnLayer>` draws a marked look through a gold colour matrix over a glow, and each line above
  every instance between the projected places, raised by the bodies' heights. `climbed`,
  `grounded`, `jumped`, `hooked`, `escaped`, `golden` join `ONLINE_FLOW_EVENTS` /
  `ARCADE_ONLINE_EVENTS`, with `x` / `y` where the player is drawn. Project data (re-upload above):
  the flow's splash and golden banner, the `salmonsGolden` screen, the `salmonsSplash` look, and
  every look placed on its place. **The offset** ("drawn up and left") was not the engine: a
  `rect` is drawn about its centre and the placeholders also shifted it by `-w/2, -h/2`
  (`referenceLayouts/salmons.ts`, and the P10.8 sample's `arcade.ts`, fixed too); guarded by
  `check:salmons-export` and `check:arcade-rules`. Gates: `check:online-rules` 35,
  `check:salmons-export` 24, `check:arcade-rules` 79, `check:flow-variables` 48, `check:all`
  611 / 611 (one timing flake in `fx-playback-page`, green on re-run), `check:svelte` at baseline;
  `salmons-play.mjs` **52 / 52 in each netcode** (15 new: gold on two devices and passed on, the
  line while hooked and gone when landed or broken, the events in Flow, the banner); the four
  arcade playbooks and `online-play` pass; the current-games harness on the stand-in fixtures
  (base `main` d68459f) 10 / 10 games pass, 0 of 128 screens changed (all byte-identical). Runtime
  sizes in [status/game-families](game-families.md).
  Review fixes (same day): the gold filter is destroyed with its layer; the online runtime turns
  marks on at its join, before anything is spawned (so no look is remounted to be wrapped), and
  clears them when the room is gone (no line left over the refuse screen); the glow stays on the
  ground during a hop; body sizes are read from a map made at the join.
  Chosen here, owner may overturn: gold by a brightness ramp (any look turns gold, not a second
  look), a white 3 px line from ¾ of the holder's height to the middle of the one on it, the
  splash at a climb and a hook, the banner only on the golden salmon's own device.

- 2026-11-08 — **S0 wiring: each player plays its Invisible Flipbook clips (in review).** In an
  online room a character whose component has `characterClips` plays `<prefix>_<state>_<facing>`
  as soon as the clip is registered, else its placeholder:
  - `engine-layout` `characterClips.ts` (pure): the facing from the drawn velocity projected 2:1
    (measured over 150 ms; a turn holds 150 ms), the near-facing then near-state stand-ins, the
    golden prefix before the base one, the loops (idle / walk / holding) and the one-shots on
    `jumped`, `climbed`, `ability` and `caught`;
  - `apps/lines` `game/online.ts` runs one animator per player and publishes the clips
    (`arcadeClips.svelte.ts`); the own ability starts on the press. A salmon the room puts out is
    kept drawn until its `caught` clip ends (the room's `caught` comes just after the state); with
    no `caught` clip it hides at once, as before;
  - `SpawnLayer` draws the clip over the hidden placeholder (the Flow handle stays mounted), its
    box's bottom centre at the feet, the body's width wide, gold for the golden salmon unless a
    `salmon_golden_*` clip played; until the clip's first frame is loaded the placeholder shows;
  - rule 8: `clipReachability` ships every project clip under a prefix a component names, so the
    clip export and the art export ship them; the save keeps `characterClips`
    (`normalizeComponent`, `componentFields`).

  Gates: root `check:character-clips` 10, launcher `check:character-clips` 18,
  `salmons-play.mjs` 61 / 61 in each netcode (9 new verdicts on two new pages: stub clips swim_se
  / swim_ne / hop_se; downstream plays swim_se mirrored, upstream swim_ne, the grounded clip
  stands on its feet 180 px tall and gold, the sandbank jump plays hop then swim, the bear
  without clips keeps its placeholder); the arcade, characters, platformer, camera, spawn and
  online playbooks pass; `check:svelte` at baseline. Runtime JS +5.8 KB (+2.4 KB gzip).
  **Owner:** after the merge and the next runtime release, re-upload the three character
  components ("Re-upload" above: the ones in R2 have no `characterClips`) and publish; the clips
  then play. A clip is found by its id, which the Flipbook tool makes from its name at the first
  save: renaming a clip later does not rename its id (save it as a new clip instead).
  Review fixes (same day): `pixi-svelte` `<Flipbook>` destroys the frames it restates for a
  clip's box (`destroy(false)`) once replaced and on unmount, so the clips' remounts no longer
  leak textures held by the page (every game's boxed clips gain this); reachability lists the
  project's clip keys only when a component names a prefix (one LIST, no clip reads); a player's
  clips restart when it respawns or a round starts, an event for a player no longer drawn plays
  nothing, and the catch hold ends with the `caught` clip.

- 2026-11-08 — **S0's owner runbook, and what no longer fits.** [guides/salmons-s0-runbook.md](../guides/salmons-s0-runbook.md)
  is the owner's click-by-click path, starting with a one-clip smoke test. The S0 recipe was
  checked against the engine's Salmons ("S0 on the engine" above), and eight adjustments wait
  for the owner. The clip wiring follows the Salmons visual-fixes merge.

- 2026-11-02 — **Salmons plays live.** Owner steps 1 (upload), 3 (publish) and 4 (the config
  credential) are done; a published link joins a room on `rooms.invisiblewall.org`. The three
  failures on the way are in INFRA "Invisible Game Server" → Troubleshooting.

- 2026-10-29 — **P11.4: Salmons is isometric.** Its river screen sets `projection: 'isometric'`:
  the river is drawn 2:1, the players upright, nearer in front; the room and the netcode are
  unchanged. `salmons-play.mjs` 37 / 37 in each netcode. Detail in
  [status/game-families](game-families.md) P11.4.

- 2026-10-29 — **P11.3: Salmons' rules.** Rocks and waterfalls are solids, the river is a wall to
  bears and fishermen; the rules module `salmons` climbs waterfalls by tapping, grounds a salmon
  on a sandbank until it jumps, plays the fisherman's line (hook, reel, land) and the golden
  salmon. `salmons-play.mjs` 36 / 36. Detail in [status/game-families](game-families.md) P11.3.

- 2026-10-29 — **P11.2 (c–e): a new river per room, and the publish writes `rooms_url`.** Each
  room makes its own river from the seed it carries, on the server and on every device
  (`onlineGenerators.js`); owner step 3 no longer needs a hand-added `rooms_url`.
  `salmons-play.mjs` 28 / 28. Detail in [status/game-families](game-families.md) P11.2 (c–e).

- 2026-10-27 — **P10.16: Salmons rebuilt as data on the engine.** The river generator and the
  online config (`engine-mechanics` `salmons.js`), its layout (`engine-layout`
  `referenceLayouts/salmons.ts`), the export for the project, `docs/playtest/salmons.md` and its
  playtest (14 / 14). Bots, nearby-only state and the load test are in
  [status/game-families](game-families.md) P10.16. Placeholder looks; owner steps above.

- 2026-10-26 — **`salmons` became an arcade project; the owner keeps it as the art test bed.**
  The owner switched its kind in `/admin` and re-scaffolded. The re-scaffold writes only missing
  files, so the old Book-of `editor/flow-v2.json` survived. Its first publish (08:21) was an arcade
  runtime driven by a slot flow, and the game was broken. The fix:
  1. delete `editor/flow-v2.json`;
  2. re-scaffold again;
  3. publish without editing the flow.

  An edit that deletes the starter's `complete:loading` chain leaves the loading screen up after
  the tap. The owner expected the real Salmons and got the generic dodger. The original game is
  untouched in its own repository, and Salmons on the engine is still P10.16.

- 2026-10-26 — **Step 0 done: read the Salmon repository and recorded the owner's three choices.**
  The S0 groundwork was already there (above), so the work list is now the 22 clips plus the
  lower-priority pieces. Facings became §9 #28. The R2 read of `salmons` stands.
- 2026-10-26 — **S0 approved by the owner; this file opened.** The owner asked why the
  coordinating session never raised S0. Nothing it reads said an owner go was pending: S0 was
  written as "not a build step", so it had no row in game-families §8 (the table the coordinator
  walks), and it was never listed under STATUS.md's owner blockers. S0 now has a row in §8 and an
  entry in STATUS.md's owner list.
