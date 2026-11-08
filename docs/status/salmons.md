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

Steps 1, 3 and 4 are **done (2026-11-02)**: Salmons plays live on `rooms.invisiblewall.org`.

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

### S0 on the engine (read 2026-11-08)

The S0 recipe was written for the old client (`GuiltyForever/Salmon-` `docs/art-pass.md`).
Salmons now plays on the engine, so the art goes into the `salmons` project and ships on
**Publish**. No FTP download and no `build-sheets.py` are needed.

**The wiring (planned, after the Salmons visual-fixes PR merges; not built).** It follows the old
client's `characterLook.js` rules:
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

**Adjustments for the owner.** None of these is changed silently. The runbook assumes the default
in brackets.

1. **The clip count.** The plan says 22 clips, but its own table lists 13 states × 2 facings = 26.
   *(Default: 20. The golden salmon is the pink clips tinted gold by the game, so no
   `salmon_golden_*` clips are made; generated golden clips replace the tint if they exist.)*
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
   stills, and `BiRefNet_toonout` for the videos as the plan approved, pending your call.
   Alternative: `BiRefNet-general` or `BiRefNet-matting` (MIT), which may lose some edge quality
   on toon art.)*

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
