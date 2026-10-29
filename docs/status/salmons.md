# Salmons (arcade reference project) — status

> Plan: [design/game-families.md](../design/game-families.md) §1 (Salmons and its art pass, S0), §4.3–§4.5, P10.16, §9 #28 · Online rooms: [design/realtime-multiplayer.md](../design/realtime-multiplayer.md) · The art pass's own guide: `docs/art-pass.md` in `GuiltyForever/Salmon-` · The sample it builds on: [playtest/arcade-sample.md](../playtest/arcade-sample.md) · Agents: `arcade-games` (art pass: `atlas-python-tools`, `invisible-flipbook`, `invisible-fx`, `invisible-components`)

**One-line state:** **Salmons is rebuilt as data on the engine (P10.16, built 2026-10-27; in
review)**, with its own rules since P11.3 (the climb, sandbanks, the line, the golden salmon;
in review) and drawn isometric since P11.4 (in review): its river, rules, characters, bots and layout run on the shared runtime and the game
server, with placeholder looks, and play in two browsers and a room of bots
([playtest/salmons.md](../playtest/salmons.md)). It is not in the `salmons` portal project yet, and
its players are not moved over: both are owner steps (below). The art pass (S0) was approved on
2026-10-26; its 22 character clips are still to be generated in the launcher's tools, and replace
the placeholders when they are.

## Current state

- **Salmons on the engine (P10.16)** — the authored config and layout are made from one seed,
  `SALMONS_SEED`; each room plays a river of its own (P11.2 e, below):
  - **the river and the config**: `engine-mechanics` `src/salmons.js` (`salmonsRiver`,
    `salmonsConfig`): a 1800 × 7200 river of 15 bands from the sea to the source; `salmon`,
    `bear` (≤ 30) and `fisherman` (≤ 20); bears and fishermen start on the banks; 100 players; bots
    fill each room to 20 as bears and fishermen and cannot win (§14 #5); a new round 15 s after one
    ends (§14 #6); each device is sent the players within 2400 × 1800 of its own;
  - **today's rules, as data** (realtime-multiplayer §4's table): the current and whirlpools are
    zone forces on salmon (rapids push harder); a bank pushes a salmon back into the water; the
    bear's swipe (110 px, out 3 s, +1) and the fisherman's cast (280 px, out 4 s, +2) are `catch`
    abilities on J; the first salmon at the source wins (+10);
  - **Salmons' own rules (P11.3, built 2026-10-29; in review)**: rocks are solids and waterfalls
    one-way solids that stop a salmon from below; the water, sea and source are solid to bears and
    fishermen, who stay on the banks (all predicted by the device); the rules module `salmons`
    (`engine-mechanics` `salmonsRules.js`, server only): a salmon climbs a waterfall by tapping
    Space at its foot, is grounded on a sandbank until it taps Space, can be hooked by a
    fisherman's cast, reeled in and landed (+2; five taps shake the hook), and one salmon per round
    is golden (worth 3× caught or at the source). The river places the rocks, sandbanks and
    waterfalls from its seed, on the server and on every device. Detail and the numbers in
    [status/game-families](game-families.md) P11.3;
  - **chosen here, owner may overturn** (Salmons' design leaves them open): 4 taps to climb, the
    height draining 0.6 a second; a grounded salmon can be caught, a hooked one cannot; reel
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
    authored `salmons-1` river is what `/editor` and `/config` show;
  - **the layout and looks**: `engine-layout` `referenceLayouts/salmons.ts` — the river as the
    play field's world, a camera following the device's own player, placeholder looks
    (`salmonsSalmon`, `salmonsBear`, `salmonsFisherman`);
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
    sandbank, the line, the golden salmon), `scripts/playtest/salmons-play.mjs` (36 / 36 in each
    netcode: the HUD, the swipe, a round over, two rooms with two rivers, a waterfall climbed and
    a sandbank jumped off), and the 100-device load test ([status/game-families](game-families.md)
    P10.16, P11.3).
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

1. **Put Salmons in the `salmons` project.** Run
   `node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs scripts/salmons/export.mjs --out <dir>`
   and upload what it writes, at the same keys, into R2 (the FTP Browser, admin full-bucket):
   `invisible_wall/salmons/config/config.json` (replaces the dodger's config),
   `invisible_wall/salmons/editor/scenes.json` (replaces its screens),
   `invisible_wall/salmons/editor/flow-v2.json` (Salmons' flow, replacing the offline arcade
   starter) and the five `editor/salmons/components/salmons*.json`. Back up the current files first.
2. (No longer needed since P11.2: the export now writes Salmons' own flow over the starter.)
3. **Publish** `salmons` from Game Maker. Since P11.2 (c) the publish writes the game server's
   address into the launch URL as `rooms_url` (the launcher's `GAME_SERVER_URL`, by default
   `wss://rooms.invisiblewall.org`), so the published link plays as it is.
4. **The game server's config credential** (INFRA "Invisible Game Server" steps 5–7), so the live
   server can read the published config; until then it plays no game.
5. **Moving the players over** from the Salmon repository's own server: when the art (and,
   if wanted, the isometric view, P11.4) is in and you are happy with a playtest on the live server.

## Open items / next (S0)

The isometric view is built ([Phase 11](../design/phase-11.md) P11.4: the river drawn 2:1, the
players upright in depth order; the S0 art should be drawn for it: diamond ground, upright
characters, their place at their feet); its HUD and round over, the published `rooms_url` and a river per room (P11.2) and its own rules (P11.3) are built.
Left from P11.3 (known limits):

- The rules' room events `climbed`, `grounded`, `jumped`, `hooked`, `escaped` and `golden` reach the
  device's probe but are not in `onlineFlow.js` `ONLINE_FLOW_EVENTS` (nor `engine-flow-v2`
  `ARCADE_ONLINE_EVENTS`), so Flow cannot play a cue or sound on them yet. A landing is `caught`
  (effect `hook`), which Flow does hear.
- The golden salmon is not drawn gold and the line is not drawn.
- One tap of Space can do two things at once: a salmon that jumps off a sandbank at a waterfall's
  foot also gets a quarter of the climb from that tap (each rule reads the tap on its own). S0 runs beside them.

1. **Generate the 22 character clips** in the project `salmons`, following the Salmon repository's
   `docs/art-pass.md` recipes: `salmon_pink` and `salmon_golden` (`swim`, `hop`, `caught`), `bear`
   (`idle`, `walk`, `swipe`), `fisherman` (`idle`, `walk`, `cast`, `reel`), each `_se` and `_ne`.
   The salmon (drawn side-on) and the bear (drawn from above) matter most; they are the off-angle
   ones. The golden salmon may be the pink one recoloured with a `_colour` FX layer.
2. **The arcade sample's four sprites** (§9 #6), for a result in the shared runtime: the salmon,
   bear, hook and fish stills from item 1 and the props sheet, re-skinning `arcadeSalmon` /
   `arcadeBear` / `arcadeHook` / `arcadeFish` and sizing the config bodies to the art
   ([status/game-families](game-families.md) open item 11), in the `salmons` project.
3. **Lower priority, from the art pass's list:** the bridge pieces (generated placeholders today)
   and drawn tiles for the riverbed, water surface and sea (drawn in code today; the Salmon client
   needs a small change to use them).
4. **Back into the Salmon repository:** each generated sheet and clip is downloaded into
   `art/imported/` and `build-sheets.py` re-run, so today's game shows the new art before the
   rebuild.

Shipping (rule 8): atlases, clips and effects already travel export → deploy → bake → pull →
register. Tiles and characters get their chains in P10.13 and P10.11. S0 adds no asset class.

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

## Recent changes

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
