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

Steps 1, 3 and 4 are **done (2026-11-02)**: Salmons plays live on `rooms.invisiblewall.org`.

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
    the hop's tilt, swell and tail flick on `jumped`, the nose-up pose and tap pulse at a waterfall's
    foot, and the spine glint in open water;
  - the bear turns to its heading and draws the claw streak on its swipe;
  - the fisherman is the tan circle.
- **The line** starts at the fisherman's hand, wiggles for 450 ms after the hook, and is drawn 2 px
  `0xddddaa` with a bobber dot. When it shows and hides is unchanged.
- **Known limits:** the salmon is drawn above the water's tint, not under it (e). The room has no
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

## Recent changes

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
