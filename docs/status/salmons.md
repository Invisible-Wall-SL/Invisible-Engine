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

- **Performance review and plan (2026-11-27; owner: "understand why the salmon game is running
  slow … levels … draw calls … the net code"; plan:
  [design/salmons-performance](../design/salmons-performance.md)).** Eleven profiler readings and a
  code review: on a Mali-G57 a play frame is ~31 ms render + ~41 ms JS — the river is ~48k loose
  sprites culled by walking all of them every moved frame, one filter per salmon / bear, the quality
  ladder never measures arcade, and ~25 MB of slot textures + ~4.4 MB of slot downloads load for
  nothing. fps readings hide headroom (busy time is not reported; hidden tabs are kept). Six tracks
  T1–T6 (probe accuracy, Salmons lab run, arcade boot diet + ladder, river chunks, filters into
  shaders, net client once per frame), each its own session and PR; look-changing items wait for
  the owner (§5). Track status:
  - T1 probe accuracy — draft PR #1964 · T2 lab run — draft PR #1965 · T3 boot diet + ladder — started ·
    T6 net client — merged #1970 · T4 river chunks — merged #1972 (pixel-identical; lab: mount 39.7k → 6.4k
    objects, play JS 21 → 4.6 ms a frame; Recent changes 2026-11-27) · T5 filters → shaders — draft PR
    #1989 (no pass per body: lab filter passes 1.8 → 1, the bed's; owner accepted the sharper,
    MSAA-smoothed swimming salmon; Recent changes 2026-11-27) · T7 packed places + 15 states a
    second (owner, 2026-11-27) — PR #1975.

- **Zone art takes a rig: rocks and whirlpools can be drawn by one of the project's rigs
  (2026-11-26; owner: "add rig as a zone art source"; in review; branch
  `claude/wizardly-galileo-kjszii`; runtime and launcher change, no config change; Salmons draws
  exactly as before until someone picks a rig).** Plan and the trees decision:
  [design/zone-art](../design/zone-art.md) §1 "Rig", §3; the card:
  [status/game-config](game-config.md), [tools/game-config](../tools/game-config.md) "Zone art".
  - **What a person does.** In `/config` → Zone art, **Drawn with** → **Rig** on a family's row
    (rocks, whirlpools, or any other), then the rig and one of its animations, with **Loop**. The
    Trees row greys **Rig** out: trees are never a rig (below).
  - **In the river** (`salmonsArt/river.ts`): a rock or a whirlpool whose stamp is a rig draws one
    `RigView` in the built-in picture's place, depth and size times the scale, the rig's Bounds box
    standing for the picture's (mirrored and squashed as the built-in one is). Any other family's
    rig stands upright on its zone, fitted inside it. Each starts at the point of its animation the
    room's seed picks for its zone (`zoneArtPhaseFor`), so neighbours do not move in step, and is
    moved on by the river's ticker while it is in view. Every `random()` / `forestRandom()` call
    is made as before, so nothing else moves. Unset, a rig not loaded, or the drawing not loaded,
    the built-in piece draws.
  - **Loaded only when named.** `online.ts` `roomZoneArt` hands the art a loader for
    `engine-layout/zone-art-rig` (`zoneArtRig.ts`, a 930 B gzip chunk) only when zone art names a rig,
    and `loadSalmonsArt` loads it beside its textures; the Salmons chunk never imports it. A rig
    named only by zone art ships and is kept loaded at boot (`characterArt`), as a character
    sheet's rig is.
  - **Trees are never a rig (decision).** 430 rig trees on one screen measured +1.35 ms of JS a
    frame in the browser and 2.2–2.7 ms (moving on plus mesh rebuilds) in Node on a 2.1 GHz Xeon
    core with a modest 8-bone rig, ~75 ms to make them; a phone is 3–5 times slower. The river
    moves only the rigs in view, but a forest view holds many, and every scattered tree is made
    when the river mounts. So the normalizer drops a rig for `@trees`, the save warns, and the
    card refuses it with why. Rocks (~47) and whirlpools (~13) are cheap. A family drawn with a rig
    on more than 100 zones (the original's 318 sandbanks) is warned of on the card.
  - **Gates:** `check:salmons-art` 44 (was 39: the river mounted in Node with a stand-in rig
    drawing, on the band river and the original's map: with no drawing or a rig not loaded,
    exactly as today; every rock and whirlpool its rig at the built-in place, depth and size times
    the scale, a sandbank's upright and fitted, every other piece and region unchanged, each rig
    started at its zone's phase and destroyed with the river; moved on by its ticker only in
    view), `check:zone-art` 130, `check:room-levels` 15, `check:room-sim` 43,
    `check:salmons-export` 39, `check:character-sheet` 90, `check:flipbook-characters` 254,
    svelte-check at baseline.
  - **Bundles** (`check:runtime-bytes`, re-recorded on Linux; all five runtimes pass): lines,
    match-3 and card 0 B. arcade: its bundle +590 B gzip (the schema's rig, the stamp node, the
    bound component), the lazy Salmons art chunk +217 B, the lazy sheet-rig chunk −84 B (its rig
    box moved to a 328 B chunk the two rig drawings share), and the new lazy zone-art rig chunk
    930 B, fetched only by a game whose zone art names a rig. arcade3d: its bundle +588 B, the
    same chunks within 1 B.
  - **Played** on the branch's arcade runtime (headless shell): `salmons-play.mjs --zone-rig`
    (new, 4/4; [playtest/salmons](../playtest/salmons.md) "Zone art's rigs"): every rock and
    whirlpool of page ZR's river is drawn by a stub rig and none built in, the rest of the river as
    without it, and the rig is on screen and plays both of its drawings. `zone-art-play.mjs` 8/8
    (was 5: a plain game's rig stamps on two zones, drawn, animating, not in lockstep) and
    `--cost` 2/2 (430 rigs on one screen). `salmons-play.mjs --trees` 4/4, and with no zone art
    102/102.
  - **Owner steps:** none to keep Salmons as it is. To use it: put the rig in the project
    (Invisible Rigger), pick it in `/config`, save, publish. It reaches rooms with the runtime
    release of the merge.
- **The whole lobby clock, and the next game by itself (2026-11-26; owner: "have the all
  countdown showing up, and just blink in red with a pulse the last 10 seconds"; "yes, it should
  starts automatically"; in review; design [salmons-levels §4.2](../design/salmons-levels.md)).**
  - **The lobby shows the time to round 1 from its first person**, not only the last 10 s: with
    Salmons' lobby that starts near 70 (60 s wait + 10 s countdown) and ticks on the room's clock;
    a room that fills early drops to 10; a person who joins mid-wait sees the same number. The
    number is white and still, and red in its last 10 seconds, each new second growing it 45 % and
    easing back over 450 ms, faint for the end of each. The class picker is unchanged and usable to
    the end.
  - **Where the start time lives: the room's `endsAt`** (no new field). From the lobby's first
    person it is round 1's start at the latest (`onlineRules.js` `joined`: `lobbyEndsAt` + the
    countdown); the countdown makes it its own end as before; nobody in, or bots only, 0. No
    schema, config, layout or flow change; `check:online-rules` traces, `check:room-sim`,
    `check:room-bots`, `check:netcode` and the 3D room are unmoved (no trace has a lobby; the 3D
    room has its own rules).
  - **Drawn in code in place of `sm-countdown-seconds`** (`salmonsArt/screens.ts`
    `createLobbyClock`, `SALMONS_SCREEN_ART.clock`), the countdown screen's text node every
    published layout already has: no layout upload, and the plain number shows until the art is in.
    The flow is the seed's: its lobby check already shows the countdown screen whenever
    `secondsLeft` is above 0, so it now shows from the first person.
  - **Either order of deploys.** A new runtime on a game server not yet redeployed gets no `endsAt`
    before the countdown: the lobby looks as today. An old runtime (or a published flow made from
    the seed) on the new server shows the whole clock as plain text, no red. A published flow that
    shows the countdown screen only on `countdown` shows the clock from the countdown, as before.
  - **The next game by itself.** On the win screen (winner and losers alike) of a person who
    played the round, "Next game in N" counts 10 s (`NEXT_GAME_SECONDS`) over the button and then
    does what the button does (`switchRoom`; a failed switch reloads, `failSwitch`). The button
    stays and joins at once; joining, it reads "Joining…" and the count goes. **Played** = an input
    of the device that moved, pressed a button or asked for a respawn while the round ran
    (`online.ts` `Session.played`, cleared at `roundStart`): an idle device's screen counts nothing
    and waits for its press, so an idle tab does not hop rooms for ever. **Only for someone
    watching:** a page hidden when the screen comes, or hidden once while it counts, stops the
    count for good; shown again, it does not join by surprise. The screen taken away (a
    `roundStart` hiding it in a game of rounds) stops it too. In portrait and landscape the line
    sits 16 px over the button, clear of the title, the subtitle and the button; eggs fall behind
    it (outlined, it reads over them).
  - **Proof.** `check:room-lobby` 35 → 42 (the clock in the sim from the first join, mid-wait
    join, the cut, the wait run out, nobody in, bots only, no lobby; a live room's state; pins of
    both device halves). Playtests, both netcodes: `salmons-levels-play.mjs` 54 → 57 (the clock;
    "no countdown yet" rewritten), `salmons-rejoin-play.mjs` 43 → 58 (the count landscape and
    portrait, a click while it counts, the join at 0, an idle page, a hidden page and shown
    again, both buttons after) and `salmons-play.mjs` 102 → 103 (page W counts). Runs and
    screenshots: Recent changes.
  - **Bundle.** Arcade runtimes only: `arcade` +747 B gzip (2,127,836 → 2,128,583), `arcade3d`
    +814 B (2,636,665 → 2,637,479), both re-recorded; `lines`, `match3` and `card` the same bytes
    (`check:runtime-bytes --only lines,match3,card` ok, not re-recorded).
  - **Deploy.** The clock needs the game server redeployed (closes running rooms: Owner steps);
    the count is the runtime's, live with the arcade runtime release. No upload or publish.
- **Every generator setting and authored biomes, from the config (2026-11-26; owner: "I would like
  to have more control over the level generation, so I can control all of its parameters. also I
  would like a way to be able to control and author the change in biome that happen in the
  level"; then, through the coordinating session: biomes also set obstacle density, and the
  biome strip shows each biome's colours; in review; branch
  `claude/salmons-authored-generator-biomes`). Plan and schema:
  [design/salmons-levels §6](../design/salmons-levels.md#6-every-generator-setting-and-authored-biomes-built-2026-11-26).
  - **What an author has.** `arcade.online.levels.generator`: 58 settings, every number that
    shapes a level (river length and widths, delta, meander, sand, rocks and whirlpools,
    waterfalls' columns, bridges, the winding course, world rows and banks, spawns), each with
    its limit. `arcade.online.levels.biomes`: kinds (trees, lone-tree chance, grass and forest
    depth, grass tint, forest floor, riverbed sands; rocks, whirlpools and sand ×0–3, waterfalls
    kept 0–1, bridges yes / no) and a sequence of starts along the river by seed or `'*'`, else a
    cycle. A density the level has no room for is listed as an orphan in `/editor`.
  - **Nothing moves unless authored.** Every default is today's value: the recorded maps of seven
    seeds and the shipped winding river are unchanged with an empty or a full `generator` and with
    a looks-only `biomes`; with no `biomes` the art is drawn piece for piece as at `a404522` (four
    rivers fingerprinted in Node). `CURRENT_STRENGTH` is left out: it is a speed, not a place.
  - **One resolution everywhere.** `levelShape(levels, seed)` in `engine-mechanics`; the room says
    both blocks (`seedLevels`) and a device adopts them; the river carries its seed's biomes for
    the art. Game Config carries the blocks as it carries `river` / `waterfalls`.
  - **`/editor`**: below the Generated level card, River shape (with Winding river), Course,
    Waterfalls, Rocks and whirlpools, Bridges, Sea and delta, Spawns (a slider, a field, a help tip
    and a reset per setting; a reset per card) and Biomes (the strip in each biome's colours with
    draggable boundaries, the kinds list and the selected kind's editor). The stage redraws at
    each change and marks each stretch's floor down the river's edges. Save levels as before.
  - **After review (same day):** a density change now draws each column's pieces from its own
    stream, so tuning one stretch leaves the others' pieces alone; `generator-off` orphans (a
    density above 1 where the generator's settings place none) and one orphan per run of a kind;
    a generated rock is held to leave two cells beside it and the half widths are 2 at the least,
    with a save warning for a rock or a whirlpool as wide as the narrowest water less a cell.
  - **Gates:** `check:salmons-levels` 27, `check:room-levels` 16, `check:salmons-art` 37, launcher
    `check:editor-level-generator` 6 (new), `check:salmons-course` 21, `check:salmons-export` 39,
    `check:zone-art` 70. Runtime bytes: the arcade runtimes grow (below); the slot, match-3 and card
    runtimes shrink, because `salmonsMap.js` no longer reads `SALMONS_MAP` at module level, so a
    bundle that never makes a level drops it (manifests re-recorded).
  - **Live:** nothing until a Save levels (or a re-export) and a publish, and the game server and
    runtime of this merge: a room of an older game server ignores the blocks, and its devices play
    its levels (§3 of the design).
  - **With the trees' art (`@trees`, below).** On a level with authored biomes a tree whose
    biome picked variant `v` draws picture `v` of the `@trees` source and its variants (round
    again past the last); without biomes the seed and the cell pick, as #1922 built it.
    `check:salmons-art` 43.

- **Zone art draws the trees too: Scenery → Trees (2026-11-26; in review; branch
  `claude/wizardly-galileo-kjszii`; runtime and launcher change, no config change; Salmons draws
  exactly as before until someone sets the row).** Plan: [design/zone-art](../design/zone-art.md)
  §1 "Scenery keys"; the card: [status/game-config](game-config.md),
  [tools/game-config](../tools/game-config.md) "Zone art".
  - **What a person does.** In `/config` → Zone art, under **Scenery**, the **Trees** row (shown
    for `salmonsRiver` and `salmonsMap` only). Its Default reads "Built-in trees, 6 kinds", with
    `tree_0`–`tree_5` from `salmons_props` as thumbnails. A sheet frame or a Flipbook clip, with
    variants and a scale, as a zone family's.
  - **The key** is `@trees` in the same `arcade.zoneArt` map (`game-config` `ZONE_ART_SCENERY`).
    It is carried and cosmetic like every entry, so the slot, match-3 and card runtimes do not
    change. A room's levels, `levelHash` and adoption are the same with it
    (`check:zone-art` §5 now carries `@trees`). It is no zone's family: `@` is in no id the
    generators make, `/config` refuses one, and `zoneArtStamps` never stamps one.
  - **In the river** (`salmonsArt/river.ts`): `online.ts` `roomZoneArt` passes the entry
    (`game/zoneArt.ts` `zoneSceneryOf`) beside the stamps. With it, every scattered and forest
    tree draws a picture picked by the room's seed and its cell (`sceneryArtSourceFor`), in place
    of `tree_N`. It is drawn at `TREE_W` times the scale, at the same place and depth, anchored at
    its foot. A forest tree's cull box takes the picture's size. A clip plays on the river's
    ticker, neighbouring trees start on different frames, and a forest tree's clip out of the
    view is not ticked. Each tree still draws its `random()` / `forestRandom()` kind, so nothing
    else on the river moves. Unset, or a picture not loaded, it draws exactly as before. The
    probe counts the drawn trees as `regions()['zoneArt:@trees']`.
  - **Fixed on the way (never released):** the river's clip helpers (`animate`, `pictureOf`)
    were declared after the tree code, so a tree drawn with the art would have thrown. They now
    come first. `check:salmons-art` caught it by mounting the river in Node.
  - **Ships (rule 8)** through the existing generic roots, no new pipeline code: the frame's
    sheet, the clip and its sheets, and the frame in `characterArt` (`check:zone-art` §8, through
    the real exporter).
  - **Gates:** `check:zone-art` 96 (was 72), `check:salmons-art` 39 (was 34: the built-in table
    holds the six tree names; the river mounted in Node over a stand-in app, on the band river and
    the original's map, draws exactly as before with nothing set or nothing loaded, draws every
    tree with the frame at its place, depth, foot and size with every other piece unchanged, and
    draws variants and a clip by the seed), `check:game-config-family` 573 (the Trees row
    server-rendered), `check:salmons-export` 39, `check:room-levels` 15, `check:room-sim` 43,
    svelte-check at baseline for `apps/launcher-api`, `apps/lines` and `packages/engine-layout`.
  - **Bundles** (`check:runtime-bytes`, re-recorded on Linux): lines, match-3 and card 0 B.
    arcade +205 B gzip: its bundle +25 B, and the lazy Salmons art chunk +190 B. arcade3d
    +281 B: its bundle +86 B, and the chunk +189 B. The other chunks moved by a hash and ±4 B.
  - **Played** on the branch's arcade runtime (headless shell). `salmons-play.mjs --trees` (new,
    4/4; [playtest/salmons](../playtest/salmons.md) "Zone art's trees"): page T's 427 trees are
    drawn with a magenta stub frame and none with `tree_N`. The rest of the river is in the
    original images, and the frame is on screen. `salmons-play.mjs` with no zone art passes
    102/102. Also on that build: `zone-art-play.mjs` 5/5, `arcade-play.mjs` 14/14,
    `arcade-characters-play.mjs` 14/14, `arcade-platformer-play.mjs` 15/15, `online-play.mjs`
    20/20. A clip as the trees' picture was not played in a browser. It is proven in Node
    (`check:salmons-art`) and found by `resolveClipFrames`, as a whirlpool's clip is.
  - **Owner steps:** none to keep Salmons as it is. To use it: pick the trees' art in `/config`,
    save, publish. It reaches rooms with the runtime release of the merge.
- **Join New Game stays on the page (2026-11-25; owner: "when I finish a game and click join new
  room, the game restarts from the loading screen, I would expect to be in a room already"; in
  review; runtime change only: no game-server, config, layout or flow change; live with the arcade
  runtime release of its merge, nothing to deploy, upload or publish).**
  - **What a person sees.** On the win screen, "Join New Game" (a loser's "Start New Session"):
    the fish swims off and the next thing on screen is the new river's lobby, with who the person
    plays and the countdown. No boot screen, no loading screen, no tap to start, and the page is
    not loaded again. A winner is golden in the new river as before. Joined into a river already
    running (none waits), the river shows at once with no lobby.
  - **In the room first.** The press asks the join at once (the fish no longer has to swim off
    first: `salmonsArt/winAnimation.ts`). The device leaves the won room with consent and joins a
    new one as its player is now: name, class, the winner's pass (`online.ts` `switchRoom`,
    `engine-mechanics` `launchJoin`). The seed and the levels are the new room's, so the level is
    made after the join, by the same decision a boot makes (`roomLevelGame`), and its art is
    asked for then. The won room's picture stands meanwhile, frozen under the win screen:
    nothing is heard, sent or stepped for it.
  - **One task swaps the rooms, and only arcade code does it** (`online.ts` `enterRoom`,
    `closeSession`, `showRoom`). `Game.svelte`, `editor-scenes.ts` and the flow interpreter are
    not touched: they are in every runtime, and the slot, match-3 and card runtimes had to stay
    the same bytes. So the mounted game keeps the layout it loaded for the first room, and the
    swap is made around it. Once the new room is joined and its level made, with no frame
    between: everything held or drawn for the old room is let go (below); every screen the flow
    shows is taken down, the base game too, so the play field (the camera, the spawn layer, the
    pointer) mounts afresh for the new room and nothing mounted reads what the old one left; and
    the flow is started again (next point).
  - **The new field in the mounted layout.** The layout's `river` node is the first room's
    field, and the game cannot be handed another layout. A generated field is drawn by the
    room's art in that node's place (as it has been since the art exists: the node is only what
    shows until the art is in), so after a swap the node is never drawn again: nothing is drawn
    in its place until the new room's art is in (its textures are the page's, kept from the
    first room, so that is the frame of the swap or the next ones), then the new river. The
    world's size is the session's own (`useOnlineCamera`), and the camera is made again for the
    new room, snapped to the own player. The level's geometry (what is predicted and collided)
    never came from the layout: it is the session's, made from the new room's seed and levels.
    A game with a generator and no art cannot be swapped this way: its switch fails and the
    page is loaded again (no such game exists; Salmons' two generators have art).
  - **The flow is not changed and nothing is published.** The flow handle is the same one; it is
    brought back to its start with what it already has (`apps/lines` `game/roomFlow.ts`
    `restartFlow`, arcade code). In order: every container it shows is hidden through its own
    mount model (the win screen with them). Hiding a container releases a chain that was held on
    it (a win screen shown with `awaitComplete`), which then runs on: it is given its turns in
    the same task and what it showed is hidden too, again for a chain that held on another screen
    (up to 8 times). The game unmounts; the mode stack goes back
    to the base game (`stateModes.reset`); the variables are written back to their initial values
    and every timer the doc can start is stopped; the room's values (`phase`, `secondsLeft`,
    `status`) are written. Then it gets the event that ends its start-up screen at a boot. A boot
    completes the screen on top of what `load` showed, so that event is `complete:<container>`
    for the topmost container the `load` and `tapToStart` chains show themselves whose completion
    the flow handles (`startupCue`: a second `complete:` handler, for an intro a completion shows
    later, is not it); with none, `tapToStart`; with neither, `load`, completed as a boot's tap
    completes it (a splash `load` holds). In Salmons' flow that is `complete:loading`: it hides
    the loading screen (not shown: nothing happens), shows the river and checks the lobby, so
    the new room's lobby and countdown come up, or the bare river if that room already runs. The
    loading screen is never shown.
  - **What a published flow must keep:** one of those three (a top-level `complete:` handler
    for a container its `load` or `tapToStart` chain shows itself, a `tapToStart` chain, or a
    `load` chain that holds its start-up screen), with its whole start in that chain: with such
    a handler `load` is not run again, so what `load` does besides showing the start-up screen (a
    sound, a write, a timer) is not done for the new room. The restart is made in the base game:
    a mode's own start-up handler is never the one run. Every Salmons flow made from the seed
    has the first, and its `load` only shows the loading screen. **What cannot be undone**
    without the interpreter (`engine-flow-v2` `runtime.ts`, shared code in every runtime, so not
    changed here): a chain of the old game that is waiting on a Delay, a timer it awaits, an
    awaited cue or a mode's entry goes on when that ends, and what it does then lands on the new
    room (Salmons' flow has no such wait). `check:room-flow` (new, launcher) runs the restart on a flow that is not the seed:
    a win screen that holds, a mode with its own start-up answer, a second completion above the
    splash, a variable and a timer.
  - **What is let go.** At the press the device stops hearing the old room (its state and event
    listeners are taken off; its leave raises no "the room closed", because the session is marked
    as quit and its leave is ignored whatever its code). At the swap (`closeSession`): the
    predictor and the SDK's predict object, every player's spawned instance, the clip looks, code
    looks, rig and turn looks, the lines, marks, clips, lifts, the art with its river, stains,
    floats and wading, the screens (the win animation's ticker stopped, its eggs destroyed), the
    world camera, the pointer's and the touch control's held fingers, a pending tap, the
    on-screen button, the key latch, and an author's levels notice. The respawn ask, the pass,
    the events and the signals are the session's own and go with it; nothing made for a room
    keeps the room before it alive. The new room's state is read at once, so the first frame is
    drawn from its own player's place (the camera is made again when the play field remounts,
    and snaps there). Until its session is made, a room's leave is only the join's answer: it
    clears nothing of the picture that stands, and a boot's join says it once (it used to reach
    the error screen twice). A movement key held through the swap is forgotten with
    the latch: it steers again once pressed again.
  - **While it joins** the win screen's button reads "Joining…" (from the press until the new
    room shows).
  - **When the switch fails, the page is loaded again** (`failSwitch`), which is what the button
    did before: a join the server refuses, one that has not put the device in a room within
    12 s (`SWITCH_MS`), a room that closes as it is joined or refuses the device (a level it
    cannot make, no first state), anything thrown on the way (caught in `switchRoom`), a flow
    whose start fails, and art that does not load for the new room (a room joined in another's
    place has only its art to draw its field with, and no lobby note, death screen or win button
    without it). `failSwitch` leaves the room the page is in first, and a join that answers after
    the 12 s is left at once rather than shown over the reload. The join (name, class, pass) is written to session
    storage (`ie:rooms:next-join`) before the attempt, taken back the moment the device is in,
    and written again by a failure, so the boot that follows joins as that same player with no
    start menu; a pass the failed join already spent is not golden again. Why a reload and not
    the error screen: that screen is drawn only on a live-authoring boot (`?runtime=1`;
    `editor-scenes` `markRuntimeStale`, shared code that must not move the other runtimes), so
    on a standalone build a failed switch left the win screen up with nothing to press. A
    reload is right in every kind of boot, and if the boot's own join fails too it ends as a
    first launch's does. The reason is on the console (`[online] could not change rooms (…)`).
  - **Only Salmons' win screen asks for it** (`screenHost().rejoin`). A boot's join runs the same
    code in the same order as before (`joinOnlineRoom` now calls `enterRoom`); another online
    game, and the 3D room (`online3d.ts`), never call `switchRoom`. `check:runtime-bytes`: the
    `lines`, `match3` and `card` runtimes are the same bytes; `arcade` and `arcade3d` are
    re-recorded (`arcade` 2,125,988 → 2,127,539 B gzip, `arcade3d` 2,634,735 → 2,636,362; the
    review fixes are 810 and 964 B of that).
  - **Measured** (`scripts/playtest/salmons-rejoin-play.mjs`, a headless shell that draws the
    river in software at about 3 frames a second, so its seconds are long and its frames are what
    carries over; local game server):

    | From the click to    | this change                   | the reload (the tree before)                                       |
    | -------------------- | ----------------------------- | ------------------------------------------------------------------ |
    | documents loaded     | 0                             | 1                                                                  |
    | the join asked       | 0.6 to 0.7 s (2 frames)       | 5.5 to 6.2 s (the fish swam off first, then the page loaded)       |
    | the lobby on screen  | 2.2 to 3.5 s (7 to 10 frames) | 8.5 to 9.5 s, after 2.3 to 3.1 s of loading screen and a key press |
    | the river in its art | 2.5 to 3.9 s (9 to 12 frames) | 8.9 to 9.9 s                                                       |

    The waits here are frames of about 0.28 s: the click reaches the button in 2, the join's
    three answers (a seat, the socket, the first state) take 4 to 7 between them, the swap is
    the next task and the lobby the frame after, the art 2 frames later (`engine` netcode; the
    `colyseus` run, with other work on the machine, took 10 to 12 and 12 to 14 frames). At 60 frames a second
    that is about a fifth of a second plus the network. Making the level is not the cost: 26 to
    37 ms in Node for a river of about 1300 zones. The reload's cost on a real device is the
    0.8 s the fish swam for, a page boot, the loading screen and a tap.

  - **Three switches on one page** (the same script, after a collection each time; `engine`
    netcode). Before the first switch: 74.4 MB of JS heap, 39,676 display objects alive in the
    heap (39,650 of them on the stage), 42 GPU textures (92.5 MB as RGBA), 1 socket. After
    switches 1, 2 and 3: heap 77.9, 79.2 and 79.2 MB; display objects alive 39,602, 39,999 and
    39,827; textures 55, 56 and 56 (108.2, 110.2 and 110.2 MB); sockets alive 2, 2 and 2. The
    first switch adds what a second room needs once (the sheet pages the first level did not
    draw, pooled text textures, the closed socket of the room just left, still referenced
    until the next press); the next ones add nothing that grows. A first version kept every
    old session alive through a closure (sockets alive 2, 3, 4, about 1.2 MB a switch): the
    script counts the sockets so that shows again.
  - **Proof.** `salmons-rejoin-play.mjs` (new), 43 verdicts in each netcode, and 43 again with
    `--baked` (a runtime with the game baked in, pages with no `runtime=1`, as a standalone build
    boots): three games won and left on one document (a mark on the window kept, one document
    loaded, the old room left and another joined, another seed, the flow showing the river and
    the lobby and neither the win nor the loading screen, the first frame's camera on the own
    salmon where the new room has it, the lobby's note, the new room's zones, fingerprint and
    rocks, one river drawn, nothing of the old game held, round 1, golden, the swim predicted
    with the camera on it); four switches that fail (a refused join, a join that never answers
    with "Joining…" on the button meanwhile, a throw in the swap, art that does not load), each
    ending with the page loaded again and the person in a new room's lobby as they were; and the
    timings above. `salmons-play.mjs` (102 verdicts in each netcode): page W's verdict
    follows the same switch in a room without a lobby. `salmons-levels-play.mjs` 54 in each. Gates: `check:room-flow` 2 (new), `check:room-lobby` 35 (the button, the join it
    makes, the one place a failed switch loads the page again from, no error screen in
    `switchRoom`, a late join left, the early leave), `check:room-sim` 43, `check:room-levels` 15, `check:netcode` 28 (their pins of
    `online.ts` moved with the code), `check:online-rules` 40 (no trace moved),
    `check:salmons-art` 33, `check:salmons-levels` 18. Playbook:
    [playtest/salmons](../playtest/salmons.md) "Another room on the same page".
  - **Not verified, and known limits.** A real phone or GPU (the times above are a software
    renderer's). The published flow itself (the playtests boot the seed's flow, which the
    project's is made from). A join into a river already running (read off the flow: its lobby
    check shows nothing unless the room waits). `--baked` was played in the `engine` netcode
    only (a baked bundle carries one). A published flow other than the seed's on a real switch
    (`check:room-flow` runs the restart in Node on the package's interpreter). No frame was
    caught between the lobby and the art: the art is in the first frame of the new room on the
    stepped page, and two frames after the lobby on the real clock. A boot's own lost room
    still has no screen on a standalone build (as before this change). One `salmons-play.mjs`
    run (`engine`) failed page T's bear-colour sample once (a pixel of water under the bear's
    place; page T never switches rooms) and passed 102 of 102 when run again.
- **A class picked in the lobby (2026-11-25; owner: "I would like to add some UI to the waiting
  room so that a player can change the played character"; in review; branch
  `claude/upbeat-cray-fzmgxe`; runtime and game-server change; no config, layout or flow change;
  live once the runtime release AND the game-server deploy of the merge are both out: Owner
  steps).**
  - **What a person sees.** While a new room waits, under "You are NAME, a CLASS": "Play as" and
    a row of **Salmon / Fisherman / Bear**, the class the ROOM has the person as lit. A press asks
    the room at once (no second button); the person is that class a moment later, in the same
    room, at that class's start, and the line and the lit button follow. A class whose places are
    all people's shows "No place left for that one: pick another" (the death screen's words)
    under the row until the next press, or until the lobby ends. The row stays through the
    countdown and goes with the lobby when round 1 starts; round 1 starts with each person as
    what it picked.
  - **In place, through the room.** Nobody leaves and joins again (the lobby's first form did,
    until 2026-11-20). The room (`services/game-server` `roomSim.ts`) reads the `respawn` an
    input already carries: in a game with a lobby, until round 1 starts (`engine-mechanics`
    `onlineRules.js` `picking`: the wait and its countdown), a person's input that asks for a
    class other than its own changes it by the rule a caught person's Respawn follows. By shares:
    a place of that class a person has not taken; its newest bot leaves, and a bot is let back
    into the class left. By count: any place while the class is under its `max` (or has none),
    and at its `max` the place of its newest bot, which leaves (the room is then filled again as
    `bots` says). Then a new body, a new start, `respawned`. With no such place,
    `respawnRefused` and nothing changes. A pick of its own
    class does nothing (no move, no spawn turn burnt: a device sends its pick on several inputs).
    A refused pick does not spend the input: the person moves on it as on any other. Once round
    1 runs, `respawn` is read only for a caught person, as before. Bots never pick. A game with
    no lobby and a 3D room play exactly as before.
  - **No config field.** Every game with `rules.lobby` has the pick. `normalizeGameConfigDoc` is
    untouched; nothing is uploaded, exported or published.
  - **The room says so** (`schema.ts` `roomFields.picking`, so both `RoomState` and
    `NearbyRoomState`): one more field in the state, true while its people may pick, written
    only once it is true (a game with no lobby never sends it). The device offers the row only
    while the state says so. So the new runtime in a room of an older game server draws the lobby
    as it was, with no row: no button that does nothing.
  - **One answer for each run of inputs that ask for the same class** (`roomSim.ts` `picked`,
    `SimPlayer.refused`). A device sends what it asks on every input until it is answered, so
    the inputs after a refused one ask again with no new press. They are that same ask: the room
    does not tell the refusal again and does not test the place again, even if one has opened
    since, so nobody is let in behind a refusal its device already shows. An input that asks for
    nothing, or for another class, ends the run; the next ask is tested and answered afresh.
    **This replaced "once a catch" for a caught person** (`onlineRules.js` `refused` keeps no
    note).
  - **The device** (`engine-mechanics` `online.js` `createRespawnAsk`, one for both screens, wired
    in `apps/lines` `online.ts` `drawScreens` and `tickOnline`): a press (a class of the lobby's
    row, the death screen's Respawn) is sent as `respawn` on every input from the press until the
    room acknowledges one that carried it (the own player's `ack`). The room answers on the very
    input that asks, so the state that acknowledges it says the answer too. In the lobby: the
    class asked for (done), or another (refused). On the death screen, in a running round of a
    game whose respawn is manual: back (done), or still out (refused). A refusal is shown and
    nothing more is sent. The answer is read off the state alone: the device no longer reads
    `respawnRefused` at all, so nothing depends on the room's events or their order (they are
    sent after the patch), and nothing is asked for ever.
    - **Every press is a run of its own.** A press right after inputs that asked for the same
      class first sends one input that asks for nothing. So a Respawn or a class pressed again
      the moment its refusal shows is tested and answered again (before the review fix it rode
      on the refused run: the room told nothing, and the caught player's device asked for ever).
    - **What ends an ask.** Its answer; a newer press; the room no longer taking it (round 1
      started, the player is back). One press rides at most 2 × the delay + 2 inputs (measured
      in the gate at 0, 1, 4 and 9 steps each way, for a pick and for a Respawn).
  - **A press on a class is the screen's, not the game's.** People move and act in the lobby, and
    the mouse and the fingers are read on the same canvas. The `down` of a press that Pixi gives
    to a class is withheld from the pointer tracker and the touch control (`online.ts`
    `listenPointer`), so the press begins nothing there: its moves, its lift and a cancel still
    arrive and find no press to steer or end. So it steers nothing and is no tap, jump, swipe
    or cast, also in the step round 1 starts. What takes a press is asked of Pixi's own hit test
    (`screens.ts` `takes`: `rootBoundary.hitTest`), so a button's rim and round corners, and a
    row that is hidden or covered, are judged as the tap is. The death screen needed none of
    this: its player is out, and the room holds it.
  - **Events: none new.** `respawned` and `respawnRefused` are reused, and their Flow
    descriptions name the lobby (`engine-flow-v2` `reference/arcade.ts`). What `respawned` does
    on a device in a lobby: the Flow signal is raised (Salmons' flow has no node on it; a flow
    that plays something on `respawned` would play it for a lobby pick too); a class's sheet
    that names an action on `respawned` plays it, as after a catch; the camera follows the
    player to its new start. No float, no code-look event, no screen. The bot that leaves and
    the bot let back in raise `left` and `joined`, as for any respawn. `respawnRefused` raises
    its Flow signal and nothing else on the device: both screens read their answer off the state.
  - **The player is spawned again as its new class** (`online.ts` `draw`). A class change
    despawns the player's instance, and the same frame's spawn pass makes its new class's
    component; its looks, code look, rigs and lift are made afresh with it. A catch hides the
    player, so a respawn as another class always got a new instance; a lobby pick never hides
    it, and before the review fix the instance stayed the old class's component (invisible
    under Salmons' art, wrong for a game drawn by its component trees, and for the instance's
    Flow handle).
  - **On screen** (`engine-layout` `salmonsArt/screens.ts` `createLobbyNote`, in the published
    node `sm-lobby-menu`): fixed px from the canvas's middle, under the two lines the note had
    ("Play as" at +14, the row from +34, the refusal 20 px under the row), above the layout's
    countdown (+210). The row is about 312 px wide in the playtest browser's monospace (the pixel
    font is not shipped) and is drawn smaller on a canvas narrower than it plus 12 px a side, as
    is the refusal's line, so both fit a 390 px phone with the pixel font too. Its buttons are
    the death screen's (`choiceRow`, `pixelButton`), opaque, so they read over the river.
  - **Either side alone.** A new game server with the old runtime: the old runtime never asks
    and does not read `picking`; nothing changes on screen (not played here: the SDK decodes a
    state by the schema the server sends, as the levels' fields showed). The new runtime with
    the old game server: no row, the lobby as it was (played here with the room's `picking`
    forced off, which is what an older room does with a lobby: the lobby's and the start menu's
    own verdicts pass, the 7 that need the row fail, no page error). One thing an older runtime
    loses on the new game server until it is replaced: it stops asking only on `respawnRefused`,
    so a Respawn it presses again within one input of its refusal rides the refused run, which
    the room no longer tests again. That person stays out, even if a place opens, until it asks
    for another class. On the old game server that press was never answered either, but was let
    in once a place opened.
  - **Proof.** `pnpm check:room-lobby` 35 (was 16; 1 rewritten, 19 new): the pick changes the
    class in place with the bots swapped; its own class and a class the game does not have are
    no-ops against a room that never got the pick (events, places, spawn turns alike); a full
    class refuses once a run, the same class again, another full class, and a new ask is let in
    once a place opens; a place that opens during a refused run is not given to that run, in the
    lobby and for a caught person, and the next press gets it; a pick during the countdown, and
    round 1 as picked; after round 1 and in a game with no lobby a free person's `respawn`
    changes nothing against a room that never got it; the ask itself (a gap before a press of
    the same); the device's half played against the room 0, 1, 4 and 9 steps away, for a pick
    (each press answered once, three refusals in a row with no step between two of them and the
    room telling all three, a place opening behind a refusal, a change of mind, nothing sent
    after) and for a caught person's Respawn (three refusals the same way, nothing happening
    without a press, then back); a pick waiting at round 1 dropped; a live Colyseus room with an
    SDK client (the state says `picking`, a pick changes the class, a refusal with the places
    opened at once, round 1 ends it; a game with no lobby never sends the field); source pins
    on the note and on `online.ts`. Also `check:room-sim` 43, `check:room-levels` 15,
    `check:room-size` 20, `check:room-bots` 56, `check:online-rules` 40 (no committed trace
    moved), `check:netcode` 28, `check:salmons-art` 33, `check:salmons-levels` 18.
    `salmons-levels-play.mjs` 54 / 54 (was 41; 13 new verdicts, 3 reworded;
    [playtest/salmons](../playtest/salmons.md)): Fisherman pressed alone in a lobby and spawned
    as the fisherman's component, Bear during the countdown, round 1 as picked and spawned as
    picked, a click on a class not a tap on the river, and on a 390 × 844 phone the row inside
    the window, Bear refused twice and Fisherman let in. Its lobby and menu pages alone under
    `--netcode colyseus`: 27 / 27 (the SDK's prediction keeps the same `ack`). Earlier samples
    on the same build: `salmons-play.mjs` 101 / 101 (the death screen's Respawn among them) and
    `online-play.mjs` 20 / 20, engine netcode. Gate mutations, each failing `check:room-lobby`:
    no dedupe, a run that never ends, the own class respawning, a pick read after round 1, a
    refused pick spending the input, a refused run tested again, no gap before a press of the
    same. A runtime built without the despawn fails the three playtest verdicts that read
    `online.spawned`.
  - **Bytes** (`check:runtime-bytes`): `lines`, `match3` and `card` the same bytes. The two
    arcade runtimes grow by this code, re-recorded on the tree merged with `main` at `6afdd01`
    (zone art, #1910): `arcade` 2,125,255 → 2,125,988 B gzip (+733), `arcade3d` 2,633,975 →
    2,634,735 (+760); as first built, the bundle +302 and the lazy Salmons art chunk +345. `pnpm
    check:svelte`: `apps/lines` 145 (baseline 145), `packages/engine-layout` 290 (baseline 290).
  - **Not done.** A pressed button shows nothing until the room answers (a round trip; the death
    screen's row is local and answers at once). A person may change class as often as its inputs
    arrive while the lobby lasts, and each change swaps a bot: cheap, and bounded by the lobby's
    length and the room's message limit, but no limit of its own was added. Asking for two full
    classes in turn on successive inputs starts a new run each input, so a modified client can
    raise one `respawnRefused` per input while it is caught or in a lobby (it was one a catch):
    bounded by the same message limit, and not limited further. The death screen's refusal, now
    read off the state, is played in Node against the room (the gate) and not in a browser: no
    playtest has a refused Respawn. The countdown's "STARTING IN" is the layout's own text and
    is hard to read over trees, as before.
- **Zone art: each zone family's picture is chosen in Game Config (2026-11-25; owner: "nowhere to
  set their art"; in review; branch `claude/wizardly-galileo-kjszii`; runtime and launcher change,
  no config change; Salmons draws exactly as before until someone sets an entry).** Plan and
  phases: [design/zone-art](../design/zone-art.md). A general arcade feature (owner decision, same
  day). Salmons is the first game that uses it.
  - **What it is.** `arcade.zoneArt`, keyed by zone family (`rock#`, `whirlpool#`, …, the Zones
    chips' grouping, `game-config` `zoneFamilyOf`). Each entry has a picture (a frame of a project
    sheet, or a Flipbook clip), optional variants (one per zone, picked by the room's seed and the
    zone id), `placement: 'stamp'` and an optional scale. It is carried past the normalizer like
    the slide and touch schemes, so the slot, match-3 and card runtimes do not change by a byte.
    It is cosmetic: a room's levels and `levelHash` are the same with it or without it, and a
    device with zone art in a room without it adopts nothing and is not refused (`check:zone-art`
    §5, through the game server's own `configSource` and `createRoomSim`).
  - **In Salmons' river** (`salmonsArt/river.ts`, `zoneArt.ts`): a rock or whirlpool whose zone has
    a stamp is drawn with the stamp's picture in place of `rock_N` / `whirlpool_N`, at the built-in
    size times the scale. A clip plays on the river's ticker. Any other family's stamp stands
    upright on its zone. A rock still draws both of its seeded numbers, so no other tree, rock or
    bed moves. With no entry, `online.ts` passes no zone art (`roomZoneArt` answers `undefined`)
    and the river runs its old path. A picture that is not loaded draws the built-in piece.
  - **Any other arcade game:** its stamps are layout nodes under its play field's spawn layer
    (`engine-layout/zone-art`, `apps/lines` `game/zoneArt.ts`).
  - **Ships (rule 8):** the frame's sheet and the clip with its sheets, though no scene places
    them, and the frame listed in the index's `characterArt` so the boot keeps the sheet loaded.
  - **Edited in** `/config` → **Zone art** ([tools/game-config](../tools/game-config.md) "Zone
    art"). For a Salmons level, the rule-only families (`band#…`, `waterfall#Bear`, the bears' and
    fishermen's walls) are hidden behind **Show rule-only zones**.
  - **Gates:** `check:zone-art` (67), `check:salmons-art` (33; its pin of `salmonsArt` takes the
    new argument), `check:salmons-export` (39), `check:game-config-family` (569; knows the new
    heading), `check:art-scope`, `check:flipbook-characters` (254), `check:room-levels` (15),
    `check:room-sim` (43), `check:arcade-rules` (79), svelte-check at baseline for `apps/lines`,
    `apps/launcher-api` and `packages/engine-layout`.
  - **Played** on the branch's arcade runtime (headless Chrome). `zone-art-play.mjs` (new, 5/5;
    [playtest/arcade-sample](../playtest/arcade-sample.md) item 10) plays a plain game: a sheet
    frame and a clip stamped on their zones, and nothing drawn without zone art. `arcade-play.mjs`
    passes 14/14. `salmons-play.mjs` (no zone art) passes 101/101 on its second run: its river is
    in the original images, with as many `rock_` pieces as rocks and four `whirlpool_` frames per
    pool. The first run failed one verdict, "isometric: page A draws its salmon at its projected
    place". That verdict cannot tell the two places apart when the salmon is drawn at the camera's
    centre (projected (644, 347), flat (640, 349), under its 60 px), which depends on the room's
    random seed, not on this change.
    Salmons' river with zone art set was not played in a browser. It finds a frame by the same
    scoped key (`<sheet>::<frame>`) the plain game's sprite was found by, and a clip's frames
    through `resolveClipFrames`, as `<Flipbook>` does.
  - **Not done (next phases):** a rig source, `fill` / `edge` placements (sandbank ground, the sea,
    a waterfall's lip), a clip's random start frame, a `z`, and the zone map drawing the chosen
    art.
  - **Owner steps:** none to keep Salmons as it is. To use it: pick art in `/config` → Zone art,
    save, and publish. It reaches rooms with the runtime release of the merge.
- **A device plays its room's levels: the picture is the collisions (2026-11-25; owner: "changing
  the seed generates a new level, but does not update collisions"; in review; branch
  `claude/zealous-darwin-t8xiyc`; runtime and game-server change, no config change; NOT live
  until the runtime release and the game-server deploy of the merge: Owner steps).**
  - **What was wrong.** A game whose config names a generator makes its level twice from the
    room's seed, and nothing checked that both sides read the same `arcade.online.levels`. The
    game server reads the PUBLISHED config (`configSource.ts`, then `createRoomSim`). The device
    read the config it booted with (`online.ts` `joinOnlineRoom`), and every launcher link is an
    authoring boot (`ie_authoring=1`), which boots the project's LIVE config. So from a **Save
    levels** in `/editor` until the next Publish, the launcher's game drew the saved levels while
    its room collided against the published ones. On 2026-11-25 the live config had
    `levels.river { winding 0.75, sharpestTurn 140, sourceBias 0.6 }` and `levels.waterfalls
    { count 6, heightMin 5, heightMax 10 }` and the published snapshot had no `levels` (as read
    off the project when the bug was found; this build reached neither). With those two, for one
    seed, 395 to 400 of the river's 400 columns of water lie elsewhere (8 seeds measured).
    [design/salmons-levels §3](../design/salmons-levels.md) listed only a device on an old bundle.
  - **The owner's decision (2026-11-25): the device adopts the room's levels.** A game opened
    from the launcher after **Save levels** still plays, on the published level, and says so.
  - **As built.**
    - **What a room says.** Its state carries two more fields beside `seed`
      (`services/game-server` `schema.ts` `roomFields`, so both `RoomState` and
      `NearbyRoomState`): `levels`, the JSON of the levels its generator read for that seed, and
      `levelHash`, a fingerprint of the level it made. `arcadeRoom.ts` writes both once, when the
      room is made, from the game the sim plays and what its own generator made
      (`roomLevelState(sim.game, seed, sim.made)`; `RoomSim.made` is new). A game with no
      generator sets neither, and an unset field is not sent.
    - **The levels, in one form** (`engine-mechanics` `salmonsMap.js` `seedLevels`): the shape
      (`levelShape`) and, under `'*'`, the one overlay laid on that seed's level (`levelOverlay`);
      no pinned seeds, no empty part. It is itself a config's `levels`, read again it is itself
      and makes the same level. `salmonsRiver` reads no levels and says none. Longer than 16,384
      characters (`ROOM_LEVELS_MAX`: about 1,600 removed cells or 400 added pieces) it is not
      sent, and a device reads no more than that either.
    - **The fingerprint** (`onlineGenerators.js` `levelHash`): 16 hex digits over the generator's
      geometry (field, zones, zone rules, spawns) and nothing else in the config, so a config
      that differs outside its levels does not trip it. Whole-number arithmetic only
      (`Math.imul`); keys in name order; every number as whole thousandths.
    - **The device** (`onlineGenerators.js` `roomLevelGame`, the one decision `online.ts` wires and
      the gate runs in Node): it makes its level from the room's levels; `differs` names the parts
      of its own that are not the room's (`river`, `waterfalls`, `overlays`); with none it plays
      its own config. If the room said a fingerprint and the device's level has another, the
      answer is a refusal and no game.
    - **On screen.** An authoring boot that adopted shows a small strip over the top of the game,
      until its ✕ is pressed: "This room plays the level settings published when it opened, not
      the ones saved in the editor (different: river and waterfalls). Publish in Game Maker to
      play yours in new rooms." A player's boot shows nothing and needs no reload. A refusal
      leaves the room and stops on the error screen (`refuseOnlineBoot`, with Reload); its
      reason, shown to an authoring boot and logged: "the room plays a level this game cannot
      make from its seed (the game and the game server are of different versions): reload, or
      try again in a few minutes", or, when the device had none of the room's levels to read
      and the boot is an authoring one, "the room plays other level settings than the ones
      saved in the editor, and could not send its own (too long, or another generator's):
      publish in Game Maker to play yours". Both end with the two fingerprints, the device's
      and the room's. A refusal is reported with every other stopped boot (one group in the
      error tracker); the reason's words tell it apart. Only the ✕ of the strip takes a
      pointer: a touch on its words reaches the play field under it.
    - **The probe** (`online.level`): `adopted`, `differs`, `levelHash`, `roomLevelHash`.
  - **What the state carries for Salmons.** As published today (no `levels`): `levels` `{}` and
    the 16 digits, 22 bytes more in the first state a device is sent. Once the winding river is
    published: 116 characters of levels, 137 bytes more. The schema a device is sent when it
    joins grows by about 45 bytes. Both fields are written once and never patched. A game with
    no generator: no byte more in its state.
  - **`Math.sin` and the fingerprint.** `salmonsMap.js` takes numbers from the engine's own
    libm, whose last bit need not be the same in JavaScriptCore as in V8: `Math.sin` (the meander
    table, kept as float32), and in a winding course `Math.cos`, `Math.tan`, `**` and
    `Math.hypot` (`Math.atan2` and `Math.atan` only measure). Every one reaches the level
    through `Math.round`, `floor` or `ceil`: all 370,587 numbers of the original's geometry and
    749,845 of the shipped levels' over 60 seeds are whole px. So such a bit moves the
    fingerprint only where it moves a cell of the level, and then the levels do differ and a
    refusal is right. The thousandths are for a later generator whose geometry is not whole.
  - **Either side alone changes nothing.** A config with no generator: nothing read, made, said
    or checked. A new runtime in a room of an older game server: the fields are absent, and it
    plays its own config's level, unchecked, as today. An older runtime in a room of the new
    game server: it ignores the fields (the SDK decodes a state by the schema the server sends
    at the handshake, `SchemaSerializer.handshake` with no state class of its own, which is how
    `online.ts` joins; the gate's live half decodes them that way). Equal levels: nothing
    adopted, no notice.
  - **Proof.**
    - `pnpm check:room-levels` (15; new, run by Checks' `check-all` like its siblings). The room
      side is the game server's own code (`createConfigSource`, `createRoomSim`, and a live
      Colyseus room with an SDK client). Over 7 configs as the room's and as the device's and 4
      seeds, 196 decisions: 154 would have played another level than their room, all 154
      adopted the room's levels, each device's field, zones, zone rules and spawns are the room
      sim's own with the right parts named, none refused. The real pair both ways. A room made
      by a generator one pixel off is refused; levels too long to send leave the fingerprint to
      decide, and a device reads none past the limit; another generator on one side is refused,
      whichever side names it; a test room's levels are adopted as any room's; an older server
      and a game with no generator are untouched; the levels are in one form; two rooms of one
      seed have one fingerprint exactly when they play one level; levels that say something
      cross a live room's wire; source pins hold `arcadeRoom.ts` and `online.ts` to the
      decision, and the session, the drawing and the art to the decision's game.
    - **The gate bites.** Each of four breaks fails it and was put back: the decision generating
      from the device's own config ("refused (generator)"); that and no refusal, the bug as it
      was ("the device plays another level than its room, and was not refused: zones,
      zoneRules, spawn, spawns, botSpawns"); `online.ts` calling `generatedOnlineGame` itself
      (the source pin); `arcadeRoom.ts` not writing `levelHash` (the live room).
    - **In a browser** (`scripts/playtest/salmons-room-levels-play.mjs`,
      [playbook](../playtest/salmons.md), 29 of 29): a published room and a live page on an
      authoring boot (adopted, river and waterfalls, the room's fingerprint, the room's zones
      and art, the notice shown, kept and dismissed); the same as a player (no notice); equal
      configs (nothing adopted, no notice); the reverse; and a room of another generator
      release (the error screen with its reason, the room left).
    - Also green: `check:salmons-levels` 18, `check:salmons-course` 21, `check:room-sim` 43
      (its pin on the device's generator call now holds it to the decision), launcher
      `check:salmons-export` 39, `check:agents-knowledge`, `check:svelte --only apps/lines` (145,
      the baseline), the game server's `tsc`. `check:runtime-bytes`: `lines`, `match3` and
      `card` byte for byte; `arcade` +1,444 B and `arcade3d` +1,491 B gzip, re-recorded.
  - **Known limits.**
    - **A refusal is a hard stop, where a level that differed used to play wrongly in silence.**
      From now on a change to a generator or its geometry (`salmonsMap.js`, `salmons.js`) must
      be out on both sides, the runtime and the game server, before a device can join a room.
      In the minutes between the two releases, and after a rollback of one side across such a
      change, every join is refused with the reason above. A reload helps only when the device
      is the older side.
    - A room keeps the levels it opened with. After a Publish, a launcher link that lands in a
      room opened before it still plays that room's levels and still shows the notice, until
      the room closes (and the game server reads a new publish within about 90 s).
    - A room whose config names no generator says nothing, so a device whose own config names
      one, or the reverse, is not caught: the generator's id is not part of its levels. Two
      different generators, one on each side, are refused.
    - Levels too long to send: a device whose own levels differ is refused, not adopted, and
      after a Publish it stays refused for as long as it is matched into a room opened before.
    - No JavaScriptCore run: that the fingerprint is the same in Safari is the argument above
      and the gate's whole-px check, not a browser run.
    - A room creation and a join each pay one more pass over the level (about 5 to 8 ms here).
    - The notice and the refusals are English only, as the stale-data banner is.

- **The bear wades (2026-11-25; owner: "the bear can enter the water tiles, but right now it looks
  like it is walking on water. I would like to create an FX where it looks like half of the bear
  body is underwater, so it takes a 'water overlay' colour", then "a curved line would be nice, so
  it follows the round shape of the bear body"; in review; branch
  `claude/dazzling-dijkstra-66rrze`; the arcade runtime only: no game-server, config or project
  change, nothing to upload; live with the next arcade runtime release).**
  - **What a player sees.** A bear whose place is on open water that has a tint (the river, the
    rapids, the source; not a bank, a sandbank, a rock or the sea, which has none) is drawn with
    its lower half under that cell's tint, in the very colour the swimming salmon is drawn in
    (`leap.ts` `underTint` at `TINT_ALPHA` 0.75), below a waterline: the front arc of the ellipse
    a round body cuts in the water, lowest in the middle and rising to both sides, with a thin
    lighter rim along it and a slow bob. Stepping in, the line rises from under the look to its
    level in 250 ms, eased; stepping out it falls. The salmon (its own under-water drawing) and
    the fisherman (over water only on a bridge's deck) are untouched.
  - **Whatever draws the bear.** The wading is the player's, not its look's
    (`engine-layout` `salmonsArt/wade.ts`). `online.ts` `drawCodeLooks` hands every mount it
    publishes (a code look's, a sheet's rig's, a sheet's clip turned by `view.turn`) to the art's
    `wade`, which gives back the look's own mount for a character that does not wade and, for a
    bear, a mount of the player's own that mounts the look and puts one filter pass on the
    container `<MountedArt>` draws it into. That mount is the same from frame to frame (one a
    player and a look), so `<SpawnLayer>`'s `{#key}` never mounts the look again; a sheet that
    turns to another rig takes the wading over where it stands, with no stepping in again. On land
    the container has no filter and no `filterArea`, and a bear that never wades makes no filter.
    The filter goes with the player: when it is no longer drawn, when it respawns as another
    character, when the room goes. `<SpawnLayer>` is not touched.
  - **The pass** (`salmonsArt/wadeFilter.ts`; WebGL, in GLSL both WebGL 1 and 2 take, on the
    vertex stage and the driver check of the Element FX passes, which `pixi-svelte/elementFx` now
    exports as `FILTER_VERTEX` and `programLinks`). Below the line a premultiplied pixel is
    `(1 − a) · c + a · T`, alpha kept, its uniform filled from `underTint`'s own matrix; above it
    the pixel is as it was; the edge is smoothed over one pixel of the screen. The line is placed
    as the pass is drawn: Pixi says where on the screen it put the pass's frame
    (`calculateSpriteMatrix`) and the container's world transform says where the character's
    place is there and how large it is drawn, so it holds under the camera's zoom, the device's
    resolution, a look partly off the screen and a mirrored parent. The pass is drawn at the
    screen's resolution and with its smoothing (Pixi's defaults for a filter are 1 and none),
    so a look's edges are the same in the water as on land. The driver is asked for the program
    as the river mounts, so the first bear to step in costs no compile, and a GPU that refuses
    it is known before the pass is ever on a look, which is then drawn as on land.
  - **Its numbers, and why** (`wade.ts` `WADE`, one frozen object; tuned by looking, on the bear
    sprite and on an upright stand-in rig, at the game's zoom and close up):

    | Constant | Value | Why |
    | --- | --- | --- |
    | `depth` | 1.1 | The line's ends stand a little over the look's middle, so that with the dip about half the body is under (at 1 the middle of the belly was nearly dry). |
    | `reach` | 0.5 | The arc's half-width is half the width the look is drawn at: its ends, where the arc meets the level line at a corner, are at the picture's sides. At 0.42 the corners showed inside the bear sprite. |
    | `sag` | 0.4 | Of the half-width. 0.5 is the true arc of a circle on the 2 : 1 isometric ground; 0.3 read as nearly straight at the game's zoom, 0.5 as a bowl. |
    | `sagMax` | 0.35 | Of how high the line stands: the bear sprite is seen from above, 92 wide and 50 tall, and an uncapped dip left a thin crescent of it under. An upright look (the stand-in: 75 wide, 108 tall) is never capped. |
    | `rim` | 3 px each side, 0.35 white | A soft band over the bear's own pixels only: about 2 px of the screen at the game's zoom. Wider or whiter read as a stripe. |
    | `bob` | 1.2 px, 2.4 s | Enough to see the surface is alive; a walking bear hides it. |
    | `easeMs` | 250 | The owner's "about". At the bear's 216 px/s that is about a cell. |
    | `margin` | 0.25 (8 px least) | The room the pass is given round the look's box, as the Element FX runtime gives a rig. |

  - **Found on the way: Pixi skips a filter on a rig.** Pixi sizes a filter with a fast measure
    (`getFastGlobalBounds`) that leaves out anything not drawn or not measured, and
    `engine-rig`'s `RigView` is measured through a part that is not drawn (its slot meshes are
    not measured). A container that holds only a rig measures 0 × 0, and Pixi then skips the
    pass and draws the rig unfiltered, with no error. The first cut of the wading therefore drew
    on the bear sprite and not at all on a rig, which is what the owner's live bear is. The
    wading gives the container a `filterArea` (the look's own box each frame, from
    `getLocalBounds`, which does see a rig) and Pixi uses that. **A smooth turn's cross-fade
    has the same fault and is not fixed here** (Open items; only a sheet that sets **Blend
    (ms)** fades, and since #1902 the bear's sets none): measured on the stand-in rig, all 17
    `AlphaFilter` passes of a blended turn were skipped, so the two pictures are drawn at full
    strength, the old one showing behind the new until the blend ends.
  - **Limits.** A clip published as a clip (no rig, no smooth turn) is drawn by `<SpawnLayer>`'s
    own `<Flipbook>` and has no mount: a bear drawn that way does not wade (Open items; no bear
    clip exists today). The numbers were tuned on a stand-in, not on the owner's `R_Bear`, which
    is not in the repository. A rig whose bounds are a bounding-box attachment smaller than its
    art would be cut to that box and the margin while it wades (the Element FX passes have the
    same limit). The tint is the cell's under the bear's place, taken at once when it changes,
    as the salmon's is; the ground's tint squares are a cell wide, so a bear across two tints
    matches one. For the 250 ms it steps out, its legs are still under the tint on the bank.
    Without `highp` floats in a fragment shader Pixi lowers the pass to `mediump`, and the line
    may then sit a pixel off. A rig's slot that blends (add, screen) blends inside the pass
    while the bear wades, not with the river behind it. No phone was tried.
  - **Proof.** `pnpm check:salmons-art` 33 (22 before; the 11 new ones: the numbers; the arc; a
    body's line at a depth; the ease; who wades where on the original's level; land, water and
    land again on one look; the places and characters that do not; one mount a player and a
    look; what is let go, and a GPU that refuses the pass; the pass's colour and its place on
    the screen; the runtime's wiring). 30 hand mutations of `wade.ts`, `wadeFilter.ts`,
    `water.ts` and the wiring failed it at the first cut; a review then found four of the
    fragment's own that did not (the arc made a V, the rim dropped, the tint over the line, a
    wide edge), so the gate now pins each of the fragment's sums, holds them to `waterlineAt`,
    and maps the pass's frame with Pixi's own `calculateSpriteMatrix`: those four, the pass's
    smoothing and the sprite it is mapped to fail it too. In a browser, on throwaway pages built from the game's
    own modules (Chromium at device scales 1, 2 and 3, camera zooms 1/3 to 1.5): under the line
    the pass's pixels are the same bytes as Pixi's `ColorMatrixFilter` with `underTint`'s
    matrix, for opaque and for half see-through pixels; above it the same bytes as no filter;
    the drawn line is within 0.7 device px of `waterlineAt`. Played
    ([playtest/salmons](../playtest/salmons.md) check 19d and `--rig`): `salmons-play.mjs` 101
    verdicts (94 and 7: pages WB and WF, the bear walking into the original's water on its own
    keys) and `--rig` 19 (15 and 4: page W, a bear a rig draws), each on both netcodes, none
    failed. Looked at, at device scale 2: main's bear and the new one at the same places in the
    game, the bear stepping in, a phone-sized page, and the stand-in rig still, stepping in and
    out, mid smooth turn and partly off the screen. Unmoved: `check:room-bots` 56,
    `check:online-rules` 40, `check:character-turn` 113, `check:salmons-jump` 37;
    `check:svelte` at its baseline for `engine-layout`, `apps/lines` and `pixi-svelte`.
    `check:runtime-bytes`, on `main` with #1902 merged in: `lines`, `match3` and `card` are the
    same bytes; `arcade` +1,982 B gzip (2,119,778 → 2,121,760: the Salmons chunk +1,863, the
    bundle +118) and `arcade3d` +1,979 B (it is the arcade build with the 3D view, so it carries
    `online.ts` and the same chunk), both re-recorded.

- **The config no longer carries a level (2026-11-24; owner: "drop the snapshot from the
  Salmons config"; in review; branch `claude/affectionate-bell-mwyn5r`; the export only, no
  runtime or game-server change; not uploaded and not published: Owner steps)**.
  - **What.** `scripts/salmons/export.mjs` writes `config/config.json` with no `arcade.zones` and
    no `arcade.online.rules.zones`. The rest is as before: the field (`onlineGameOf` refuses a
    config without one), the room spawn, the classes' and the bots' spawns, characters, rules,
    bots, pointer and touch. The other five documents are byte for byte the same.
    `salmonsConfig()` is unchanged, so every check and playtest that calls it has the same input,
    and the playtest's rooms with no generator (`salmons-falls`, `salmons-line`) keep their zones.
    The export drops the two lists only from a config that names a generator.
  - **Why.** The config names `arcade.online.generator: 'salmonsMap'`, so every room makes its
    level from its seed: `generatedOnlineGame` replaces the field, the zones, the zone rules and
    the spawns, on the game server (`roomSim.ts` `createRoomSim`) and on the device (`online.ts`
    `joinOnlineRoom`, which refuses a generator game whose room names no seed). The zones were the
    scene's level (seed 1), which no room plays, and they were most of the file every device
    downloads, the game server caches and `/config` loads.
  - **Size** (the export as written, tab-indented, with the winding river of #1898): 655,474 →
    16,342 bytes (−97.5 %). The two lists are 2,917 zones and 2,903 zone rules for the scene's
    level (before #1898's river: 1,307 and 1,293, 296,615 → 15,791 bytes); the spawns that stay
    are about 4 KB.
  - **Proof.** `check:salmons-export` (39) runs the export and holds its config
    to `salmonsConfig`'s with the zones: the same doc less the two lists; no validator error, and
    no issue the old config lacks (the old one's only issue, "A room runs at most 256 zone rules",
    goes: it was about the snapshot, while a room plays its generator's 1,293 rules as made);
    `onlineGameOf` plays it; before a room makes its level the two games differ only in zones and
    zone rules; and `generatedOnlineGame` gives a deep-equal game from both for six seeds, at the
    room's size and at a test size of 10.
    - **Device** (`apps/lines/src/game/online.ts`): before the level is made, `joinOnlineRoom`
      reads only the config's `online` (generator, netcode, step and state rates, the classes'
      speeds; `listenOnline` the pointer). A generator game whose room names no seed is refused,
      else the level is generated (since 2026-11-25 through `roomLevelGame`, on the room's
      levels: the entry above), and every zone read is of its game.
      `ArcadeStage.svelte` starts no local loop for a room game, so `arcade.ts` `startArcade`, the
      other reader of a config's zones, never runs for Salmons.
    - **Game server:** it reads a config through `configSource.ts` `parse` (`onlineGameOf`, then
      the slide, the levels' shape and a hook's carry off the raw doc) and generates before any
      zone (`roomSim.ts` `createRoomSim`: `generatedOnlineGame`, then `onlineLevel` and the rules
      on the generated game). Checked first at `ceaeb16afbd9` (live on 2026-11-22) and again on
      `main` at `396d90d` (2026-11-25), so the smaller config can go live without a redeploy.
    - **Editor:** `/editor` draws the level from the generator and the scene node's seed
      (`generatedLevel.ts` `regenerate`: `ONLINE_GENERATORS`, `FIELD_DRAWINGS`, the config's
      `levels`) and saves only `arcade.online.levels`; the layout is `editor/scenes.json`. Neither
      reads the config's zones. `/config` and `/characters` show no zones for Salmons (the
      Characters tool's zone forces are `arcade.forces`, which Salmons has none of).

- **A winding river and tall waterfalls, from the config (built 2026-11-24; in review; branch
  `claude/salmons-river-turns`; [design/salmons-levels §5](../design/salmons-levels.md); NOT live
  until the re-export and a publish, Owner steps below).** Owner, 2026-11-24: waterfalls "not
  getting as tall as I expect"; "more turns, that can have the player go right to left sometimes
  … more 140 degree turns around the source".
  - **Why the waterfalls were short:** the ported original caps a waterfall by its place, 8 cells
    at the source down to 1 at the sea. Over 2,000 seeds 32 % of waterfalls were 1 cell (a 72 px
    cliff: a ripple line on the screen), the three nearest the sea, the first a salmon meets, were
    always 1 or 2, and 3 % reached 8. Nothing scaled a tall one down in the drawing. The range was
    not a setting.
  - **Now:** `arcade.online.levels.waterfalls` (`count` 0–12, `heightMin` / `heightMax` 1–16
    cells) and `levels.river` (`winding` 0–1, `sharpestTurn` 0–150°, `sourceBias` 0–1), edited in
    `/editor` → **Generated level** and previewed on the stage. Salmons ships `SALMONS_LEVELS`: 6
    waterfalls of 5 to 10 cells (168 to 288 px cliffs; every height 5–10 comes up) and a river of
    `winding` 0.75, `sharpestTurn` 140, `sourceBias` 0.6.
  - **The river over 48 seeds:** every level has reaches that run the other way across the screen
    (44 to 120 cells of a 480 to 540 cell swim on 64 seeds, about a sixth; the original's: none of
    410). The sharpest bend of each level turns 126° to 140° along the river's axis, always above
    column 120 (the banks, which round a corner, show 100° to 134°, median 124°); bends of 100° and
    more: 9 in 10 are above column 150. The river runs straight for 4 columns at the source, 3 to 6
    each side of a waterfall and below column 300 (the delta, its sand and the spawns as before).
  - **One run of water a column, still.** A reach is turned up to 70° from straight up the river
    but never back down its own columns, so a waterfall is still one line across the world and the
    raised river, the bears' waterfall block, sight and the bots' chart are unchanged. A hairpin
    that doubles back in the world is not made (design §5, Left open).
  - **A config from before keeps its river to the byte** (`check:salmons-course` holds
    `salmonsMapRiver` to hashes recorded on main for 307 seeds and an overlay). The two blocks are
    carried past the shared normalizer (`game-config` `levelsShape.ts`), so the slot, match-3 and
    card runtimes are byte for byte.
  - **Played** (headless rooms as shipped, `scripts/salmons/measure-room.mjs`, new levels against
    `--original`): a bot salmon won in 8 of 8 rooms of 10, 8 of 8 of 30 and 4 of 4 of 100 on both;
    bot salmon stalled 0.0 % of their time on both; the river full (5.0 of 5, 16.8 of 17, 57.6 of
    59). On main with the slide (#1896) and the fisherman's throw (#1899) merged: a game is
    longer, median 121–122 s (10), 119–123 against 99–102 (30), 134 against 117 (100); catches
    are close to the original's in the larger rooms: bears 1.14 against 1.40 a minute a room (30),
    11.91 against 13.19 (100); fishermen 2.51 / 2.59, 18.88 / 19.23; in a room of 10 (one bear,
    three fishermen) they are rare on both (0.00 and 0.06 here). In a
    browser (`scripts/playtest/salmons-river-tour.mjs`, seeds 1, 4, 7, 12 / 12): the page draws the
    seed's level in the art, a cliff under every waterfall, and a 10-cell waterfall is climbed by
    tapping Space with Up + Left held and swum over.
  - **Known limits, as seen:** on a slanted reach the grass strip and the forest wall are measured
    along the column, so across the flow they are about a third as deep: trees stand close to the
    water there and hide the near bank, and the world's dark edge shows nearer the outside of a
    sharp bend. The current still pushes straight down the columns on a slanted reach. In the wide
    lower river a waterfall can sit within a few columns of a bend; with `sourceBias` 0 or a
    `sharpestTurn` of 150 its face can be much wider than the river (up to 2.5 widths; as shipped
    at most 1.1). Bears catch a little less (above). A device on a bundle from before this drew
    the original's river while the room played the new one, until it reloaded: closed
    2026-11-25 (the first entry here), once that change is live.
  - Proof: `check:salmons-course` 21 (each of 11 mutations of the generator fails it; it also
    makes a level at every corner of the limits and reads the config through the game server's
    own reader),
    `check:salmons-levels` 18, `check:salmons-heights` 24, `check:salmons-jump` 37,
    `check:salmons-art` 22, `check:salmons-throw` 21, `check:online-rules` 40, `check:room-bots` 56,
    `check:salmon-bots` 13,
    `check:room-lobby` 16, `check:room-sim` 43, `check:room-size` 20, `check:arcade-touch` 55,
    launcher `check:salmons-export` 18, `check:game-config-family` 509. `check:runtime-bytes`:
    `lines`, `match3`, `card` unchanged; `arcade` +1860 B and `arcade3d` +1860 B gzip in the
    bundle, re-recorded.

- **Slide: a player pressed against a bank or a prop is carried round it (2026-11-24; owner: "add
  slide to the collision, so a player is not getting stuck"; branch `claude/salmons-collision-slide`,
  in review; runtime, game server and config change).** On an original level a bank is a stair of
  solid zones a cell or two a step and a rock a 72 px box, and `stepSolid` slides along one flat
  face only, so a player stopped under every step and under a rock. On the isometric screen a single
  Up or Left key is a diagonal in the world (straight upstream is Up + Left), so a player holding
  one key is always pressed into a bank. Now `engine-mechanics` `motion.js` `stepSlide`, the same
  step on the room and on the predicting device: a player stopped by a solid that ends within
  `arcade.online.slide.corner` px is carried round that end at the speed of the move that was
  stopped; a flat wall keeps `stepSolid`'s slide (nothing for a straight push). Salmons sets 168 px
  (3.5 cells, `SALMONS_SLIDE`) on the original's levels; the band river has none. Editable in
  `/config` → Online room → **Slide round corners (px)**; empty = off, as every other online game
  plays. The shared normalizer drops the block, as it drops the touch schemes (it ships in the
  slot runtimes, which must not move): `game-config` `onlineSlide.ts` reads it off the raw doc,
  the launcher and the export carry it on a save (`withSlide`), and the room and the device put
  it on the game they play (`withOnlineSlide`; a harness asks `playedOnlineGame(raw)`). Known and kept: a push straight at a stair walks the player along it (a bear at the bank
  limit, a salmon at a bank); a fisherman pushed at the water within 3.5 cells of a bridge is
  carried onto it; a diagonal push into a bank that faces it (flatter than 45°, in the delta) still
  holds; a bank glide runs at about 40 % of open-water speed. Detail in Recent changes.
- **Live check (2026-11-22)**: the rebuild is live end to end, checked from a cloud session
  against the live services. Game server `rooms.invisiblewall.org` on `ceaeb16afbd9` (`/healthz`;
  every Salmons merge through #1866, #1832 included); arcade runtime pointer on `ceaeb16afbd9`
  (`games.invisiblewall.org/healthz`). The project's documents were written by the **Salmons
  project upload** workflow on 2026-11-21 (run 44962028296, `apply`, from `ceaeb16`): only
  `config/config.json` changed (+13 lines, `nearby.max` 6400 × 6400), backed up to
  `_backups/salmons-project/20261121T232954Z/`; the other five were already current. A dry run on
  2026-11-22 (run 45062773205, `9228524`) finds all six documents the same as the export. Live:
  `GET /rooms?game=salmons` lists a new room; a salmon, a bear and a fisherman join it by id; in
  one room a device declaring a 6400 × 6400 window was sent 65 players in every sample against
  62 → 23 for one declaring none, so the published config carries `max`. **In a browser
  (2026-11-26)**, headless Chromium on the published link (game server on `72a1b92`, arcade runtime on
  `a404522`): the start menu comes first with its river list ("1 players in Boiling Pot River");
  three pages joined one room as Salmon, Catcher → Bear and Catcher → Fisherman, each past the
  boot screen's tap; the room's events showed bots catching and hooking (`caught` with `byName`,
  `hooked`, `held`, `thrown`); a salmon held on Up swims up-river through the lobby and the round.
  In four rooms a bot salmon won (`roundEnd`, `gameWon`, "King Chinook won!!!" over the river,
  Start New Session); the room went to `ended` and left `GET /rooms?game=salmons` at once. No page
  error (only the blocked Typekit font in that session). **Not seen live:** a person caught and
  respawned; no catcher reached the test salmon before a bot won (each round about 2 min). That
  path is covered by `salmons-play.mjs`.

- **The fisherman holds his catch, then throws it; blood on top of the water (2026-11-24; owner
  request; in review; branch `claude/salmons-fisherman-throw`; engine-mechanics, game server,
  game-config, `/config` and the runtime)**. This replaces the bullets below where they say a
  landed salmon is out at the landing, its stain is where it was hooked, or a stain is drawn
  under anything.
  - **Held.** A salmon the line lands is not out and leaves no blood. It is alive in the
    fisherman's hands (status `held`, its `heldBy` his id): drawn on his place, and nobody else
    can hook or claw it. He walks at his normal speed and casts no line while he holds.
  - **Thrown.** His next click or tap anywhere throws it (not in the first 350 ms after the
    catch), at most 8 cells (384 px) away: a click further off lands at 8 cells in that
    direction, held to the field, on water or land. A press with no aim (a key) throws it the
    full reach along his last move. It flies for 600 ms in an arc (status `thrown`), lands, and
    is out THERE: `caught` (effect `hook`), +1 to the fisherman, the death screen, and the pool
    of blood at the landing place.
  - **Dropped.** Not thrown within 4 s, it is dropped at his feet and dies there. The same at
    once when he leaves, drops his connection or is caught; it is scored to him if he is still
    in the room. A round that ends lets a held or thrown salmon go alive.
  - **A bot fisherman** throws after 600–1600 ms: at the nearest salmon he knows of within the
    throw, else onto water 3 cells from him, else 1.5 cells beside him (`BOT_THROW`).
  - **General, not Salmons'.** Any `hook` ability with a `carry` block, in a game whose rules
    module runs the line (`fishingLine` or `salmons`), does this
    (`arcade.online.rules.abilities[].carry`: `holdMs`, `throwPx`, `flightMs`, `walk`; `{}`
    turns it on). Salmons turns it on (`salmons.js`) and draws it (`salmonsArt/looks.ts`
    `CARRIED`). A config with no `carry` plays as before: out when landed, the stain where it
    was hooked.
  - **On the device.** The held salmon is drawn in its holder's hands (his sheet's hand point,
    else 3/4 up his body) and tumbles in the air. It reads "<holder> has you!", he reads "tap to
    throw it!". On touch, with a catch in hand any tap is a target, so a scheme that acts on
    a target throws anywhere; a held finger still walks. The camera follows the own salmon through the throw.
  - **Events and statuses.** `held`, `thrown`, `landed` (with `dropped`), then `caught`, reach
    Flow and the sheets. A sheet's `status` triggers: `carrying` (the holder), `held`, `thrown`
    (the salmon).
  - **Blood.** Pools and the trail are drawn on top of the water, 70 % transparent
    (`arcade.online.rules.stains`: `opacity` 0.3, `trailOpacity` 0.3; the device reads it, the
    room does not). Bottom to top: a salmon swimming under the surface, the trail, the pools;
    all over the water's tint and under what stands on the water. The colours are their own and
    brighter (0xd01018 over 0x8a0f12); the water's tint is no longer mixed in.
  - **Tuned in** Game Config, Online rules ([tools/game-config](../tools/game-config.md)).
  - **No art yet.** The fisherman is still the placeholder circle: there is no hold or throw
    animation, and no sound (Owner steps).
  - **Not live until** the merge AND a re-export and re-publish of Salmons (Owner steps).
  - Proof: `check:salmons-throw` 21, `check:salmons-art` 22, `check:online-rules` 40 (the `line`
    trace re-recorded), `scripts/playtest/salmons-throw-play.mjs`
    ([playtest/salmons](../playtest/salmons.md)).

- **A room of 100 filled by shares, and a test size (2026-11-21; in review; branch
  `claude/salmons-room-size-bots`; game server, config, `/config`, and the runtime's `room_size`
  parameter; not uploaded and not published: Owner steps)**. Owner, 2026-11-20: "it should be
  60% salmons, 25% fisherman 15% bear, when the room is empty"; "I want to have a setting to be
  able to decide a room size in the pipeline, I would like this game to have a max of 100
  Players per room, but I want to be able to quickly test that (so the amount of bot also
  scale)".
  - **The mix.** The reference config (`salmons.js` `salmonsConfig`, so the export) names its
    bots by share: `arcade.online.bots.characters` salmon 60 (brain `salmonBot`), fisherman 25,
    bear 15. The room size is one number, `arcade.online.maxPlayers` (100). A class's places are
    its share of that size (`game-config` `botShareCounts`): 60 / 25 / 15 at 100. The old
    `bear.max` 30 and `fisherman.max` 20 are gone from the config, and no `fillTo` is read.
  - **The room is kept exactly full while a person is in it** (`roomSim.ts` "BOTS BY SHARES").
    Each class has its places less its people as bots. A person takes the place of the newest
    bot of its class. A class whose places are all people's refuses the join (`no place left for
    <class>`). A join that names no class gets the first class, in the config's order, with a
    place a person has not taken. Every place a person's: `the room is full`. A leave, or a
    manual respawn as another class, lets a bot of the class left back in. A dropped person's
    held place counts as a person's. Nobody in the room: no bots. **It had 20 bodies; it now has
    100 as soon as one person joins** (the game server's limit: Open items).
  - **Other sizes, for a test.** Add `&room_size=10` (or 30, 100) to the game's address. The
    page joins a test room of that size (room type `arcade-test`), matched by game and size: it
    is never a public room and the room list (`GET /rooms`) never shows it. The bots scale with
    it: salmon / fisherman / bear 1 / 1 / 1 at 3, 2 / 1 / 1 at 4, 3 / 1 / 1 at 5, 6 / 3 / 1 at
    10, 12 / 5 / 3 at 20, 18 / 8 / 4 at 30, 30 / 13 / 7 at 50. The size is a whole number from 3
    (one place a class) to the config's room size, else the room is refused with the reason,
    never clamped. A process holds at most `GAME_SERVER_TEST_ROOMS` test rooms (4 by default,
    `0` turns them off), each counted in `GAME_SERVER_MAX_ROOMS` too. No republish for a test
    size: it is the published config played at another size.
  - **A bot salmon starts in the water.** A bot starts at a place of its class: on the
    original's levels a salmon's own spawns, on the band river the river's one spawn (it was a
    bank for every bot).
  - **Measured** (tables in Recent changes, 2026-11-21). A person's salmon that steers is at the
    source in 22 of 24 rooms of 10, 17 of 30 and 6 of 100 (11 in the room before). One room of
    100 steps in 2.5 to 5.2 ms at p95 of a 33.3 ms budget.
  - Proof: `check:room-size` 15 (new), `check:salmon-bots` 13, `check:room-bots` 56,
    `check:game-config-family` (the Online section, by server render). **Not verified:** the
    live game server, the live game, the launcher against R2. Bots by shares in a 3D room are
    not built (`roomSim3d.ts` takes its bots in turn up to the room size).
- **Bot salmon (2026-11-20; owner: "we also need to have Fish bots!"; in review; the same
  branch; game-server change)**. A bot can play a salmon; 60 % of an empty room are bot salmon
  (the bullet above).
  - **How it plays.** Through a person's inputs only: a move and the jump button, clamped like
    any input. It swims up the river in a lane of its own, round rocks, whirlpools and sand,
    leaping what it cannot pass; against a waterfall it taps jump (the climb) and swims on over
    the top; grounded on sand it jumps off; it steers round the bears and away from the
    fishermen near it, turning back or aside when one is on its way; it leaps a line whose bobber
    or way home is on it; and now and then it rests on the current (its brain: about once in
    15 s for 1.2 s, not with a bear near).
  - **A person's limits** (`salmonsRules.js` `BOT_SWIM`, beside `BOT_AIM` and `BOT_SWIPE`; each
    says what it does to play). It minds a bear, a fisherman or a line only after 0.3 to 0.7 s
    (drawn for each as it comes within 12 cells, again if it goes and comes back), and only one
    its device would be sent and the rules say it sees (the fisherman bots' `nearby` and `sees`).
    It picks its way anew every 0.25 to 0.45 s and keeps its heading between, up to 12° off
    what it picked. It taps 4 to 8 times a second. It lies on sand 0.3 to 0.7 s before it jumps.
    Seeded from streams of its own: a room replays, and the other bots draw what they drew.
  - **Never stuck for long.** A 2D bot is told of no wall, so it knows it is stuck as a person
    does: less than a cell of way in 0.6 to 1.0 s, and it leaps aside towards the open water for
    0.9 s. Bots only. In rooms of bot salmon alone the longest stall measured is 1.4 s.
  - **Where the code is.** A brain's behaviours know nothing of a river, so the rules module
    plays it: `salmons`' new hook `botPlay` (`swim`), which `botInput` asks on every input
    (`play`) with only the players a person there could know of. The brain says when it swims
    and rests. `onlineBots.js` stays generic: no Salmons number in it.
  - **A bot salmon at the source wins the game (owner, 2026-11-21: "of course a salmon bot
    can win"; branch `claude/salmons-bot-wins`; replaces PR #1850's "a bot at the source never
    ends a people's game").** Salmons' config says `bots.canWin: true`, so the room's one goal
    rule decides for a bot as for a person: the round ends and the game is won (`roundEnd`,
    `gameWon` with the bot's id and name, "Bot N"), and the room locks and closes as after any
    win. Every device shows the win screen as for another player's win: "Bot N won!!!", the pink
    fish, no eggs, its button to a new river; no device says "You Won!" (`won` compares the
    device's own id with the winner's). **The winner's pass:** none is minted for a bot's win:
    no device played it, so the room sends no `winnerPass` to anyone (`arcadeRoom.ts` `won`,
    checked by `check:room-size`), and no golden salmon comes of it in the next game. The
    `botGoal` hook, its `home` event and `BOT_SWIM.homeMs` are gone (no other game used them);
    a game whose bots may not win (the default) still ignores a bot in its goal. How long a game
    lasts now: Recent changes, 2026-11-21 (about 100 s at every size).
  - **Bots have made-up names that fit their class (owner, 2026-11-21: "instead of calling them
    bot, can they have made up fun names, that have to do with the character?"; same branch).**
    A bots entry may list its class's names (`arcade.online.bots.characters[].names`; at most
    500, each a person's name length, 24, at most). The room draws each class's order from its
    seed (`engine-mechanics` `botNames.js`), and a new bot takes the first name no player in the
    room holds (letter case aside). Once all are held it takes the first free one with a number
    after it (" 2", " 3", …), cut to fit 24, so names stay unique at any size. A person keeps
    the name it typed: a bot that holds it takes another of its class's (`roomSim.ts` join),
    and every device's state follows (`arcadeRoom.ts` `syncPlayers`). The name shows wherever a
    player's does: the win screen, "by NAME" on the death screen, "you catch NAME!", the lobby
    note. A game with no list keeps "Bot N", and the state's `bot` flag is unchanged.
    Salmons' lists (`salmons.js` `SALMONS_BOT_NAMES`, in the config and so the export): 90
    salmon names, 40 fishermen's and 34 bears', each longer than its class's places at 100
    (60 / 25 / 15), so no name there takes a number. None has "bot" in it, none is in two lists,
    and none is a real person's or a brand's. `/config` keeps a list it does not show; editing
    them there is not built.
  - **A bear bot swipes at a bot salmon.** A bot does not press an ability that hits its own
    class for another bot (bear bots would churn); now it does for a bot its brain chases (the
    bear's `chase` tag, `salmon`). Without it bear bots walked with bot salmon and never
    swiped. Rooms with no bot salmon are untouched.
  - **Measured** (`scripts/salmons/measure-room.mjs`; tables in Recent changes, 2026-11-21).
    Before a bot could win (PR #1850): bot salmon reached the source 1.8, 4.3 and 3.9 times a
    minute in rooms of 10, 30 and 100, and the river stayed full (57 of 59 on it at a time at 100). None stalled by the harness's measure (under half a cell in a second) at any size. In a
    browser room of 100 (2026-11-21) the bot salmon jam on some levels: on level 1959509236, 20
    to 25 of 59 were within 1500 px of the sea at every 5 s sample for a minute, below a sand
    island, 4 to 15 of them moving under 60 px in 5 s; on level 1555286916, 4 to 10. Open.
    Seen in the same plays, open too: the 60 salmon start in one overlapping shoal (44 of 60
    within 40 px of another); the bots swim during the lobby and are put back when round 1
    starts; a refused `room_size` shows the general "This game could not load" screen, its
    reason only in the console or with `ie_authoring=1`.
  - Proof: `check:salmon-bots` 13 (new; each fails under a mutation of its subject),
    `check:room-bots` 56, the committed traces untouched (`check:online-rules` 39). A room with
    bears and fishermen by count and no bot salmon plays step for step as before (Recent
    changes, 2026-11-20).
- **Owner's report from the live game (2026-11-20, after #1808; in review; branch
  `claude/salmons-playable-bots`; game-server change, no runtime byte, config or upload of its
  own)**: "the fisherman cast is too precise, and they cast too fast … the bear have a bug … they
  should be able to go into the water … remove the circle when attacking".
  - **A bot fisherman casts at what he saw a moment ago, and rests between casts** (bots only; a
    person's cast, the room's cooldown, reach and sight untouched). His cast lands to the side of
    the salmon by as far as it moved in 0.5 to 0.7 s (`BOT_AIM.lagMs`, drawn per cast), across his
    line to it, on the side it came from: a salmon that keeps still (or rests on the current, 1.5
    cells/s) is still hit, one swimming up (about 4.5 cells/s) is missed by 2 to 3 cells. Across,
    not along: short of a salmon coming at him it would be swum into, beyond it reeled through it.
    After a cast (one the room refused too) he rests 2.5 to 4 s from the cast (`BOT_AIM.restMs`)
    before he watches again, then his reaction time as before. The lag is no longer than his least
    reaction time, so he never looks back further than he has watched (held by `check:room-bots`). Seeded from his aim stream. Measured (Recent changes): with the
    fishermen alone, the straight swimmer reaches the source in 21 of 24 rooms (8 before) and the
    weaving one in 22 (7); his casts at one salmon are at least 3.4 s apart (1.4 before); a salmon
    held still 4 or 8 cells from him is hooked after a median 1.2 s, the last after 1.5 s, as
    before. **In the room of then (10 bear and 9 fisherman bots) the bear bots took nearly every salmon** (Open items).
  - **The bear: no bug found in the code.** On the exported config (the original's levels) a
    person's bear and bear bots walk into the water, along it, under a bridge and across a
    sandbank, stop 1.5 cells below a waterfall as the original, are drawn right in it, and the
    swipe lands where its claw is drawn (8 of 8 directions), in both netcodes, against an
    in-process server and against `c98c63c`, which the live game server and the live runtime run.
    A live room swaps only the river's geometry into the PUBLISHED config, so its generator
    decides: a config from before the original's levels (`salmonsRiver`, the band river) keeps
    bears on the banks. The re-export and re-publish after WS-A is still listed as pending (Owner
    steps), so that is the likely cause; not confirmed (the published snapshot needs its link's
    token). Now gated: `check:room-bots` "as exported, a bear walks into the water".
  - **The circle** was the old flow's placeholder: it spawned `salmonsSwipe` (220 px) or
    `salmonsCast` (560 px) at the user for 300 ms on every `ability`, a person's and a bot's,
    standing in for the swipe and the cast before the art drew them. The committed flow
    (`salmonsSeed.ts`) has had none since WS-D/E; it leaves the live game with the same re-upload
    (`flow-v2.json`). The claw streak, the line and the float text stay. Now gated:
    `check:salmons-art` "a press draws no circle". The dark round mark at a catch is the
    original's bloodstain, kept.
  - Proof: `check:room-bots` 56 (4 new, each failing under a mutation of its subject),
    `check:salmons-art` 23 (1 new); the committed traces untouched (`check:online-rules` 39: their
    rooms have no bots); all five runtimes byte-identical (`check:runtime-bytes`).
- **A device is sent the box, and what its own window shows past it (2026-11-20; owner decision:
  "the device's view drives the box"; merged as #1823, and reworked the same day after a
  review: the rework, #1832, is merged too; game server, every runtime, config and
  `/config`)**. A device says, on every input, how much of the world its window
  shows about its own player, and a room whose box names a most (`arcade.online.nearby.max`;
  Salmons: 6400 × 6400, beside the unchanged 3300 × 3300 box) sends it the players in that view
  as well as those in the box. So a 2560 × 1440 window, a 3840 × 2160 one at 100 % and a
  1280 × 800 tablet are sent every player they show. **The view only adds.** No device is sent
  less than the box, whatever it says: the box is what the rules count on (a fisherman's sight
  is inside it, so whoever can hook a salmon is in that salmon's state). A phone is sent what
  it was before: the box. **#1823 as merged sent a device with a view that view instead of the
  box, so less than the box on a phone; #1832 closes that. `max` must not be published before
  the game server runs #1832 or later (Owner steps).**
  - **What a device says** (`apps/lines` `online.ts` `follow`; `engine-mechanics` `shown.js`
    `shownOf`): the window over the camera's zoom (the world is drawn over the whole window, past
    the layout's box: measured), the largest body's full size on every side (the bear's 92 px: a
    look stands on its feet), and twice how far the window's centre is from its own player,
    because the room centres the region on the player and the window is centred on the camera:
    the camera trails a swimmer by its 0.1 s smoothing, slides for half a second after a respawn
    or a resize, and the drawing is moved by the player's own leap. Each size is rounded up to
    32 px, so a resting camera says a constant. For Salmons it is the isometric screen's across
    and down extents in world-projected px: 3072 × 1824 on 1920 × 1080, 4032 × 2368 on
    2560 × 1440, 5952 × 3424 on 3840 × 2160, 5344 × 2368 on 3440 × 1440, 1376 × 2720 on a
    390 × 844 phone, 4032 × 2592 on a 1280 × 800 tablet. Three fields on the input (`shownW`,
    `shownH`, `shownIso`); the step and the rules never read them.
  - **What the room does** (`arcadeRoom.ts` `nearby()`, `holdViews()`; `shown.js` `boxRegion`,
    `viewRegion`, `nearbyHolds`, `holdView`): a player comes in when it is in the box or in the
    turned rectangle the device declared, as far as the `max` box, and is kept until 25 % past
    both. So `max` bounds who comes into a view, not who stays: a player already sent is kept to
    a quarter past it, as with the box. A device that says nothing (a runtime from before this),
    a bot (a bot fisherman's aim is still held to the box, #1792) and every device of a config
    with no `max` have the box alone, exactly as before. What a device says is sanitized as it is
    decoded (a shape that is not 0 or 1, or a size of 0, is nothing said).
  - **A view is held a second** (`VIEW_HOLD_SECONDS`): the room reads a device's newest input
    once a patch and sends by the widest view it read in the last one to two seconds, so a view
    grows the patch it is read and shrinks at most once a second. A player that comes into a
    view is sent in full, and without the hold a device saying a small view and a large one in
    turn was sent everyone again each time (measured: Recent changes). After a reconnect the
    room has nothing from the device until its first input; the held view covers a gap shorter
    than the hold.
  - **Cost**: what the box alone costs, or more; never less. The table is in Recent changes
    (2026-11-20): the guessed mix of devices and a room of 2560 × 1440 windows are inside the
    budget, a room in which every device declares the whole `max` is over it.
  - **Known limits.**
    - A window that shows more than `max` (past 3840 × 2160 at 100 %, or a browser zoomed out
      on a smaller one): players come in at the `max` box's edge, inside the screen.
    - **Waterfall terraces, only on an ultrawide window** (2560 × 1080, 3440 × 1440: no 16:9 or
      16:10 window, no phone or tablet). A player on another terrace is drawn higher or lower
      than its place by the difference in the two terraces' lift (`online.ts` `easeLift`,
      `raisedPlace`; 48 to 144 px a waterfall on the shipped level), and the room tests places.
      On a narrower window that only moves it further off the screen. The window has to be wider
      than twice its height plus 184 window px at the desktop zoom (276 px of projected world)
      for the edge of such a player's look to show, and plus 245 window px (368 projected) for
      its place to be on the screen. Then a player who stands far across the river (more than
      the window's height over the zoom plus 184 projected px: 37.6 cells on 2560 × 1080, 48.8
      on 3440 × 1440) and within a cell or two of a waterfall's line, on its other side, can be
      on the screen unsent: the lower of the two sees the higher one at its bottom edge. Worked
      out from the code; two 3440 × 1440 pages set up for it did not show it (Recent changes).
      No code for it: a call made in the build; the owner's to overrule.
    - **A player can show at the very edge for a patch or two before it is sent, on a window the
      box does not cover.** The room centres the region on where it has the device's player; the
      device draws its own player ahead of that. The lead that matters is a round trip, a tick
      and a patch, about 200 ms: 58 world px for a salmon, up to 81 projected px across the
      screen. With half a look (45 px) that passes the 92 px margin in the worst transient. A
      flow `cameraEffect` shake (up to 24 screen px) is not in what a device says either. On a
      window the box covers, the box's own slack takes both, as before the view. Reasoned from
      the numbers, not measured.
  - **To turn it off**: clear **Nearby max width** and **height** in `/config` → Online room and
    publish. Rooms made after that send every device the box alone.
  - **Goes live** in three steps, the last an owner step (Owner steps): the game server, the
    runtime release, then the re-export and re-publish that turn it on.
  - Proof: `check:room-bots` 52 (15 on the view, each shown failing under a mutation of its
    subject), `check:game-config-family` 346, `salmons-levels-play.mjs` 38 / 38 in each
    netcode, `salmons-play.mjs` 94 / 94 in each; `check:online-rules` 39 with the committed
    traces untouched.
- **A bot fisherman aims as a person, not as a machine (2026-11-20; owner: "soften the bot
  fishermen's aim"; in review; branch `claude/eloquent-planck-00ayqg`; game-server change, no
  runtime, config or upload)**. Inside his sight (the bullet "A line reaches as far as its
  fisherman sees", below) a bot was still a perfect shot: every input at the salmon's exact
  place, the bobber there at once. Now, for bots only (a person's cast and the room's rule for a
  cast are untouched; the bear bots' own limit is the next bullet):
  - **A reaction time.** He casts at a salmon only once it has been in his sight for 0.7 to 1.5 s
    (drawn for each salmon as it comes into his sight), casts nothing while his line is out, and
    waits 0.7 to 1.5 s again once it is home (also after a cast the room refused: a bank).
  - **A long cast falls short.** A cast of up to 4 cells lands on the salmon. Past that the bobber
    lands up to half of the rest of the cast's length nearer him than the salmon, and up to half
    of that to either side (anywhere in that circle). With the hook's reach of 1.5 cells a salmon
    that keeps still is hooked for sure from 6 cells, by about 3 casts in 10 from 10 cells, 1 in 8
    from 14, 1 in 20 from 20 and 1 in 50 from 30.
  - **Short, never beyond, because of the line's own rule**: the bobber is reeled home at 8
    cells/s and hooks whatever it passes within 1.5 cells, so a cast that lands beyond the salmon
    is not a miss. Measured with an error to every side (Recent changes): the swimming salmon was
    still hooked in 43 of 48 rooms, 32 of them by the bobber reeled through it a moment after it
    landed (mostly within 0.6 s), which no person dodges.
  - **Seeded.** Each bot's aim has a stream of its own (`<its seed>:aim`), apart from its
    brain's: a room replays its bots' casts from its seed, and the bots walk as they did.
  - **Where the numbers are**: `salmonsRules.js` `BOT_AIM` (`reactMs`, `sureCells`, `spread`),
    each with what it does to play: constants of the rules module, as `SIGHT` is, so not a Game
    Config field. The line's module hands them to the room (`botAim.aimed` → `OnlineRules.botAim`
    → `botInput`'s `aim`); a game whose rules module names none has bots that cast as before.
  - **Measured** (24 room seeds, the shipped level, a room of 10 bear and 9 fisherman bots; the
    table is in Recent changes). Against the fishermen alone (the bears taken out) a salmon that
    swims up the middle and never dodges reaches the source in 10 of 24 rooms (none before) and is
    first hooked after a median 54 s (24 s before), from 3.5 to 23 cells (20 to 31 before). A
    salmon that keeps still within 8 cells of a bot fisherman is hooked after a median 1.2 s, the
    last of 24 after 1.5 s (before: the step he saw it); 12 cells off after a median 6.6 s.
  - **Not reached** (Open items, "Bots after the softer aim"): in the room of then (10 bears, 9 fishermen) the
    **bear bots** now take that salmon first (swiped in 15 of 24 rooms, hooked in 8, at the
    source in 1; with fishermen that never cast at all it reaches the source in 3 of 24), and
    their reaction time (the next bullet) does not change that; and a salmon that **jumps when a
    bobber lands near it** does no better than one that does not (10 of 24 either way against the
    fishermen alone), because a cast has no flight time: every hook is made in the step the
    bobber lands.
  - Proof: `check:room-bots` (6 checks: no cast before the reaction time, the wait after a cast,
    the error's place and growth, a game with no numbers, a person's cast, a room's casts replayed
    from its seed); the committed traces unchanged (their rooms have no bots).
- **A bear bot swipes after a reaction time (2026-11-20; owner: "give the bear bots a reaction
  time too"; in review; branch `claude/eloquent-planck-00ayqg`; game-server change, no runtime,
  config or upload)**. A bear bot swiped in the step a player came within his reach. Now, for
  bots only (a person's swipe, the room's rule for a swipe, its reach and its 100 ms cooldown are
  untouched):
  - **What his reaction is.** He swipes at a player only once it has been within his reach (2.5
    cells: the swipe's 1.5 around the cell ahead of him) for 0.5 to 1.0 s, drawn for each player
    as it comes within reach; a player that leaves his reach and comes back is waited for anew;
    and after each swipe he waits 0.5 to 1.0 s again before the next, hit or miss. All three
    because a person does all three; in the measured rooms only the first decides anything (every
    swipe a bear made at the salmon caught it).
  - **0.5 to 1.0 s is the slow end of what a person does**, chosen because the owner asked for
    softer and nothing shorter measures differently (0.15 to 0.9 s leave the room's table as it
    was; 0.5 to 1.5 s move one room of 24 from swiped to hooked).
  - **Where the number is**: `salmonsRules.js` `BOT_SWIPE.reactMs`, beside `BOT_AIM`. The
    `salmons` module hands it to the room with the fishermen's (`botAim.inReach` beside
    `botAim.aimed` → `OnlineRules.botAim` → `botInput`'s `aim`); `botInput` reads `inReach` for
    every ability that is not aimed, and a game that names none has bots that press at once.
    Seeded from the bot's own aim stream, so a room replays its bears' swipes and the bears walk
    as they did.
  - **Measured** (the table is in Recent changes). A salmon keeping still within a bear bot's
    reach is swiped after a median 0.70 s, the last of 24 after 1.00 s, by his first swipe
    (before: the step he had it in reach). The fishermen alone give exactly Part 1's numbers.
  - **It does not get the straight swimmer past the bears**: in the room of then that salmon
    is at the source in 1 of 24 rooms as before (hooked in 9, swiped in 14; on 96 seeds 5, 32 and
    59, from 4, 27 and 65); bears alone, 4 of 24 (3 before). The reason is measured: with bears
    that never swipe, that salmon stays within a bear's reach for a median 3.0 s each time it
    comes into it (9 times in 10 under 6.4 s), because the bear walks with it (4.5 cells/s; the
    swimmer makes about 3.9 up the river over a whole run). Only a wait of 4 to 6 s lets it
    through in a quarter of rooms (7 of 24), and that is no reaction time. Open items has what
    else was measured.
  - Proof: `check:room-bots` 37 (5 new: no swipe before the reaction time, out of reach not
    counted and leaving it starting again; the wait after each swipe; each kind of ability limited
    only when named; in a Salmons room the first swipe after his reaction time, each next one no
    sooner, replayed from the seed; a person's swipe landing on the press).
- **A new room's lobby asks nothing (2026-11-20; owner: "continue with the rest", the second
  form #1792 left; in review; branch `claude/eloquent-planck-00ayqg`; runtime change only;
  superseded in part on 2026-11-25: the lobby offers the class again, in place, the first bullet.
  Still true: no name field, no Join River, no leaving for another choice)**:
  who a person joins as is asked once, on the start menu before the join (the bullet "The start
  menu comes before the join", below). While a new room waits its lobby shows, under the layout's own
  "Salmons!!!", tagline and "WAITING FOR PLAYERS": the room's river with the people in it ("2
  players in Sleepy Salmon River") and who the device plays ("You are Leo, a Salmon"); then the
  flow's countdown ("STARTING IN 16") and round 1, as before.
  - **Gone from the lobby**: the name field, Salmon / Catcher, Fisherman / Bear, Join River (it
    left the room and joined again as the new choice), the other rivers' rows and the splash.
  - **Kept**: the room's own line of the river list, read as the start menu reads it (the
    server's listing, asked every 3 s while the lobby shows; the count pops when it rises; a
    server that does not list the room shows the river's name alone and is asked again every 15
    s). "1 players" is the list's wording. The other rooms' rows are not shown: nothing can be
    done about them from a lobby.
  - **Accepted (owner):** a launch that carried its character (`?rooms_character=`, the win
    screen's "Join New Game") never saw the start menu and gets no menu in the lobby either: it
    plays what it carried (since 2026-11-25 it can change class on the lobby's row). The death
    screen still lets a caught player pick a class on Respawn.
  - **Nothing uploaded**: the note is drawn in the node the published layout already has for the
    menu (`sm-lobby-menu`), so layout, flow and config are as published (the export from this
    branch is byte for byte `main`'s) and an older game server serves it the same. Live with the
    runtime release.
  - **Chosen here**: the two lines are outlined, since the lobby is drawn over the live river
    (white on pale sand or blossom could not be read), and set on whole px; they sit in the old
    form's band, at fixed px above the canvas's middle, so on a very small screen they can meet
    the layout's scaled title, as the form did.
  - Proof: `check:room-lobby` 16 (1 new), `check:salmons-art` 22, `salmons-levels-play.mjs` 30 /
    30 (2 new verdicts, 2 changed), `salmons-play.mjs` 94 / 94 in each netcode, `online-play.mjs`
    19 / 19 in each.
- **A device is sent every player its screen shows (2026-11-19; merged, #1798)**:
  `arcade.online.nearby` is 3300 × 3300 (was 2400 × 1800). On
  a window up to 1920 × 1080, and on a phone up to 390 × 844, no player appears or vanishes inside
  the screen any more; `check:room-bots` holds the box to what `SALMONS_CAMERA` shows on those two windows. A
  bigger window or a tablet sees past the box, and since 2026-11-20 is also sent what its own
  window shows (the first bullet); the box is what every device is sent at least, and what a bot
  goes by. It costs
  bandwidth and goes live with the pending re-export and config re-publish (Owner steps). **It
  also lets a bot fisherman cast further**: his aim is held to his sight and to this box (the next
  bullet), and the box now covers his whole sight, so a salmon swimming up the middle of the river
  was hooked after a median 24 s where the old box gave 29 s. Detail and numbers in Recent changes
  (2026-11-19).
- **A line reaches as far as its fisherman sees (2026-11-19; owner decision, superseding the
  2026-11-18 "any range"; in review; game-server change, no runtime or config change)**: one rule
  in the room, for people and bots. The room cannot see a device's window and a bot has none, so
  every fisherman has the same standard screen: 1920 × 1080 px with him at its centre, a cell drawn
  64 × 32 px (the camera's desktop zoom, 2/3). In cells from him that is `|dx − dy| ≤ 30` and
  `|dx + dy| ≤ 33.75`, the same box mirrored or not (`salmonsRules.js` `SIGHT`, `inSight`,
  `pullIntoSight`). Not the original's, whose server had no range limit.
  - **An aim past it is pulled in, not refused**: the bobber lands where the line from him to the
    aim leaves that screen, when that is water (a bank there refuses the cast, as any bank does:
    measured over water aims up to a third past the sight from every fisherman spawn, 3.4 % on the
    original's level, 4.5 % on the band river). A window larger than 1920 × 1080, a tablet or a
    phone held upright (zoom 1/3) shows more than the line reaches: a tap out there casts towards
    it, as far as the line goes.
  - **A bot fisherman** aims only at a salmon in that sight and inside the room's `nearby` box
    about him (what a device standing there is sent), the nearest of them (since 2026-11-20: of
    those he has watched for his reaction time). Salmons' box is 3300 ×
    3300 px since 2026-11-19 and covers his whole sight, so there the sight alone holds him; the
    2400 × 1800 box before it cut his aim to 25 cells across the river and 18.75 along. The
    rules module tells the room what a player sees (its `sees` hook → `OnlineRules.sees` →
    `botInput`'s `sees` and `nearby`); a game whose module has none sees everything. The brains,
    the cooldown and the hook radius are as they were.
  - **Not a Game Config field**: a constant of the rules module, as `LINE`, `CLIMB` and `JUMP`
    are, for both generators. So it needs no upload: see Owner steps.
  - **Decided 2026-11-20 (was the open owner call here):** inside his sight a bot fisherman no
    longer aims at a salmon's exact place the moment he sees it: the first bullet of Current
    state. His cooldown, the hook's reach and the reel are as they were.
  - Proof: `check:salmons-jump` (the box, the pull-in, and `SIGHT` held to
    `SALMONS_CAMERA.zoom`), `check:room-bots` (a bot casts in sight, never out of it, nor outside
    the box), `check:online-rules` (the committed traces unchanged: none cast past the sight).
- **Drawn as the original, mirrored, with its forest walls, beaches, bridges and camera
  (2026-11-18; in review; branch `claude/salmons-ws-c-world-camera`; gap report §9.1–§9.3, §9.6,
  §12, §4.2)**: the river screen is `mirrored` (`Scene.mirrored`: the source top-left, the sea
  bottom-right, waterfalls running up-right as the original's grid); the art keeps every texture's
  own orientation and reads each autotile side by the projector. On the original's levels
  (`salmonsMap`): grass only within 5 cells of the water per row, a forest wall of a tree on every
  cell 6 to 17 cells out following the meander (drawn among the players in depth, so a character
  in it is behind the trees in front of it), the forest floor beyond, 12 rows of forest past the
  source and the sea, sandy beaches in the last 80 columns (the original's `isBankAt`), 35-row
  biomes; rocks 119.5 × K wide; lips 64K × 24K, three hashed splashes a cell (two more past the
  up-river end), the face at the texture's size × K; bridges drawn from the level's `bridges` in
  placeholder shapes (reflections that shimmer, pillars at the ends and every third tile, decks
  among the players, slopes; no bridge art ships, and fishermen do not walk them yet). The camera:
  no dead zone, smoothing 0.1 s, not held in the world, a cell drawn 64 × 32 window px (zoom 2/3 in
  window px, 1/3 on a phone or tablet by the original's test), following the own player's leap as
  well as the waterfalls' lift (owner decision 6). P10.16's band river keeps its grass world.
  **Owner step:** re-run `scripts/salmons/export.mjs` and upload the layout (it carries
  `mirrored` and the camera) once this merges; until then the live project draws unmirrored.
  The bloodstains (#1747, below) are drawn by the same projector: each stain and trail puff at
  its mirrored place, raised straight up by the waterfalls' lift as the river's ground, and drawn
  under the water's surface (over the tinted ground, under the bridges' reflections, the rocks,
  lips and every upright piece; the forest and decks stand in the players' layer above). #1747's
  own choices are kept: no displacement wobble on the stains, a hashed turn and size.
  The screen-relative keys (#1758) turn through the same projector (`online.ts` `keysOf` →
  `screenToWorldDirection`): Up is up the screen, up-river and left; Up + Left straight up-river.
  Catchers (WS-A #1762) spawn `halfW + 3..8` cells out and walk to `halfW + 12`, so about half
  their places (75 of 145 over five seeds) stand in the forest wall's first rows, drawn behind
  the trees in front of them as the original's `+1001` over `+1000` draws them; whether to keep
  them out of the trees is an owner call (the original did not). Proof: `check:arcade-platformer` (mirror), `check:arcade-camera` (zoom),
  `check:arcade-pointer`, `salmons-play.mjs` 81 / 81 in each netcode, `salmons-levels-play.mjs`
  19 / 19.
- **The bear and the fisherman take sprites in eight directions (2026-11-19; in review; branch
  `claude/salmons-eight-facings`, PR #1797; game-families §9 #28)**: the game side only. No sprites
  exist yet: where the frames come from is the owner's choice, and the steps are
  [guides/salmons-character-sprites](../guides/salmons-character-sprites.md). The clips are made
  and checked as a set in Invisible Flipbook's **Characters** mode (2026-11-19, its own branch;
  [status/flipbook](flipbook.md)): the 35 names, what stands in for a missing one, misnamed
  clips, one Bounds box on all of a character's clips, and the character in its eight
  directions. Not yet run on the `salmons` project.
  - **Today, before any clip:** the bear is the one region `bear` (256 × 138) of
    `salmons_characters`, turned to its heading in code; the fisherman is a tan circle drawn in
    code, with no image.
  - **Eight facings, per character** (`characterClips.facings: 8`; absent or 4 is exactly as
    before): `n ne e se s sw w nw`, the nearest of eight, 45° apart **on the ground** (the 2:1
    screen's flattening is taken out first, through the screen's projector, mirrored or not: `se`
    runs down a cell's edge, `e` straight right, so the eight directions the screen's keys walk are
    the eight facings' middles); a direction within 7.5° of a sector's edge keeps the facing it
    has; the 150 ms turn delay as before. Clip names stay `<prefix>_<state>_<facing>`. Salmons'
    bear and fisherman take 8, the salmon stays 4 (`SALMONS_CHARACTER_CLIPS`, now
    `referenceLayouts/salmonsClips.ts`).
  - **Stand-ins:** the clip as made; its mirror twin drawn mirrored (`e↔w`, `ne↔nw`, `se↔sw`; `n`
    and `s` have none); then the facings 45°, 90°, 135° and 180° away, each as made before its own
    mirror twin; only then a near state. Of two as near: the one last seen, else the one towards
    the viewer, else the eastern. So five drawn facings cover all eight, a character drawn only in
    the diagonals still plays, and a straight direction between two diagonals does not flick.
  - **What the game draws for a catcher is no longer its code look's.** The line starts at the
    hand of whatever draws the fisherman and keeps Salmons' style (`online.ts` `standOf`): a
    clip's hand is `characterClips.hand` (0–1 across and down the clip's box, mirrored with the
    clip; absent: 0.75 across, 0.4 down). "you catch NAME!" is drawn by the art over any player
    (`salmonsArt/floats.ts`, in the players' layer), not by the code look.
  - **No upload to switch it on**, whatever the project's components hold today (nobody could
    confirm it). In a room of a Salmons generator (`game-config` `SALMONS_ART_GENERATORS`):
    a character whose published component carries no `characterClips` plays the built-in
    `SALMONS_CHARACTER_CLIPS`; one whose block names no `facings` (as the export wrote it before
    this change) takes the built-in's for that character, so the bear and the fisherman get eight
    either way; a block that names its `facings` is played as written (`facings: 4` pins four).
    The launcher ships the clips under those prefixes for such a config (`clipReachability.ts`
    `builtinClipPrefixes`; one more small config read in every project's clip walk).
  - **A clip counts as drawn once its first frame is loaded**; until then the code look is shown,
    not the placeholder.
  - **Chosen here, owner may overturn:** sectors on the ground rather than on the screen (on the
    screen the keys' diagonals would sit 4° from an edge); the 7.5° deadband; the tie order; one
    hand point for every facing; the catch text rises from the clip's middle as from a code
    look's, so on a tall sprite it starts over the head's top; a stored block with no `facings`
    taking Salmons' eight (the brief had "a component that carries the block wins": it does,
    field by field, but an old block cannot say four on purpose).
  - Proof: `check:character-clips` 25 (root, 14 new) and 34 (launcher, 16 new);
    `check:art-scope` 77 (case 12, 3 new: the real exporter ships such a project's clip sheet);
    `salmons-play.mjs` 94 / 94 in each netcode (13 new: pages X, Y and V).
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
- **Catchers, scoring and round flow as the original (WS-B, 2026-11-18; in review; branch
  `claude/salmons-ws-b-catchers`)**: from the gap report
  [reference/salmons-original.md](../reference/salmons-original.md) §5.1, §5.3, §6.3, §7, §9.7 and
  its owner decisions 1–4 (§9.7's bloodstains are #1747's). This replaces the bullets below where they say otherwise (110 px swipe,
  280 px auto-hook, +2, escape taps, 300 s rounds, random 3× golden salmon, auto-respawn).
  - **Bear**: the swipe is tested 1.5 tiles (72 px) around the point 1 tile ahead of the bear's
    last move (ability `ahead: 48`), once a press (`onPress`; the cooldown is the 100 ms floor),
    and catches any live player, salmon, fisherman or bear. +1.
  - **Fisherman**: the line is cast at the aimed point (the input's `aimX/aimY`), only into the
    river's water, as far as he sees (the line's reach, above; since 2026-11-19, no longer any
    range) and no nearer him than 0.3 tiles (since 2026-11-21), one line at a time, 250 ms
    between casts. The bobber is reeled home at 8 tiles/s after the fisherman moved; until it
    hooks one, the first salmon in player order on the water within 1.5 tiles of it, where the
    salmon is now (no rewind: decided 2026-11-21, Open items), is hooked and dragged with it; at
    0.3 tiles from the fisherman it is landed (+1). No escape. The line is synced
    (`Player.lineX/lineY/lineActive`).
    Since 2026-11-24 a landed salmon is held and then thrown, and the +1 is at its death (the
    hold-and-throw bullet, above).
    A key-only press aims at 0, 0, so it casts nothing (the original's Space did not cast either).
  - **Caught**: out until Respawn (`rules.respawn: 'manual'`). The input's `respawn` is `1 +` the
    index in `arcade.online.characters` of the class picked (salmon 1, bear 2, fisherman 3); the
    room respawns the player as it, at its spawn, if the caps allow (taking a bot's place if only
    bots fill it), else `respawnRefused`. A bot is back after 3 s.
  - **One game a room** (`round.endsGame`): the first salmon to the source wins; the room locks;
    `gameWon` `{ winner, winnerName }` goes to every device (and the state's `winner`,
    `winnerName`); no next round. The winner's device alone gets a `winnerPass` event; joining a
    NEW room with `{ pass }` makes it the last game's winner (`wonLast`), and a salmon with it is
    golden (`mark`, cosmetic only: no 3×). The lobby is the new room's. The device's win screen,
    death screen, rejoin button and line drawing are WS-D's.
  - **Bloodstains** are #1747's (`rules.stains`, `state.stains`, below). With the travelling
    line, the line notes the hook point as it hooks (`memo.hookAt/hookX/hookY`), so a landed
    salmon's stain is exactly where it was hooked; a catcher a bear catches leaves none.
    Since 2026-11-24 a carried salmon's stain is where it lands or is dropped, not at the hook.
  - A bot fisherman casts at the nearest salmon he sees and a device in his place would be sent
    (the line's reach, above; since 2026-11-19, no longer at any distance), through the same aimed
    cast as a person; the line-out rule and the cooldown hold it back, and since 2026-11-20 his
    own reaction time and aim (the first bullet of Current state).
  - A bot never presses an ability that hits its own class for another bot (no bear-bot churn now
    that bears catch bears); abilities that only hit other classes are as before. A `caught` event
    carries `byName` (the death screen's "by NAME"; a far catcher is not in a nearby view).
  - **Chosen here, not the original's:** the line's reach (its bullet above); 1 s grace
    after a respawn (bear and hook); a dropped player cannot be hooked or swiped; a caught or
    dropped fisherman's line breaks (`escaped`); the cast's water test is the `band<n>Water` zones,
    not the original's exact `isInWater`; a cast nearer than 0.3 tiles, where the line is home, is
    refused (the original's took one from 0.1 tiles, spent its cooldown and landed it in the same
    tick, never tested for a hook; 2026-11-21); the bear's 100 ms cooldown (the Game Config floor);
    a won room stays open 10 min, then closes.
  - **Order to take it live (owner):** the game server runs the rules, but the live config is the
    R2 doc, and the device does not yet send `respawn` or handle `gameWon` / `winnerPass` (WS-D) or
    aim a key-only cast (WS-E). So: merge only with (or after) WS-D and WS-E, then deploy the
    runtime, then re-upload the config. Until then the live game's old config would run the new
    cast (aimed) with its old numbers.
  - Proof: `check:online-rules` (re-recorded `line`/`golden` traces), `check:salmons-jump`,
    `check:room-bots`, `check:room-lobby`, `check:room-sim`.
- **The original's screens, line and keys (WS-D / WS-E, 2026-11-18; in review; branch
  `claude/salmons-ws-de`, merged over WS-B's `claude/salmons-ws-b-catchers`)**, the device half of
  the gap report's §3.4, §7, §8, §9.4, §9.5, §10 and owner decisions 1–4. No HUD: the SCORE /
  ROUND / TIME readouts, the round-over screen, the golden banner and the swipe / cast / splash
  circles are gone. Drawn in code by the built-in art (`engine-layout/salmons-art` `screens.ts`,
  `winAnimation.ts`) in place of an empty node on a layout screen the flow shows
  (`referenceLayouts/salmonsScreens.ts`):
  - the **death screen** on the own `caught` ("You have been caught / by NAME" from `byName`, a
    pick of salmon, fisherman or bear, Respawn: the input's `respawn` = 1 + the index in
    `arcade.online.characters`, sent each input while out); `respawnRefused` keeps it up, saying
    the class is full; it goes once the room's `status` is no longer `out`. A respawn as another
    character rebuilds the own predictor, abilities and looks;
  - the **win animation** on `gameWon` (overlay, the big golden or pink fish, "You Won!" /
    "NAME won!!!", eggs on the winner's device, "Join New Game" / "Start New Session"): the button
    leaves the locked room for a new one as the player is (name, character, and the winner's
    `winnerPass` `pass`), so the winner comes in golden. On the same page since 2026-11-25 (the
    bullet "Join New Game stays on the page", above); until then it loaded the page again, that
    join carried in session storage (`online.ts` `takeNextJoin`);
  - the **start menu** in the lobby (name, Salmon / Catcher, Fisherman / Bear, Join River, the
    live river list named by the original's `riverNameFor`, its splash; before the join since
    2026-11-19 and no longer in the lobby since 2026-11-20: the bullets above and below), the
    **loading phrases**, and over the own catcher **"you catch NAME!"**;
  - the **fishing line** from the rod hand to the synced bobber (`lineX`, `lineY` while
    `lineActive`), hooked or not;
  - **keys**, behind the config switch `arcade.online.keys: 'screen'` (Game Config; only Salmons
    sets it): on an isometric screen the screen's, as the original's (each key a world unit
    vector through the players' layer's unproject, summed, normalised; Up straight up, Up + Right
    straight up the river until WS-C mirrors the world); **Space** swipes a bear and does nothing
    for a fisherman; **J** casts a fisherman's line 4 cells ahead along his last move, pulled 24 px
    inside the nearest `…Water` zone, and before he has moved at the nearest salmon he is sent,
    free or grounded, else the nearest water; a tap or click aims at the tapped point. The device
    sends the aim as it is; the room pulls one past his sight in (the line's reach, above; since
    2026-11-19, no longer any range);
  - a hooked salmon's line ends at the salmon as drawn (it is dragged with the bobber; the bobber
    alone would lead it by the interpolation delay);
  - the line: a holder whose `lineActive` is 0 (any other game's `hook`) still gets the old
    holder → hooked line;
  - the next join in session storage (`ie:rooms:next-join`) carries the server and the game, is
    cleared at every boot and is honoured only by a launch of both (since 2026-11-25 it is kept
    only while a leave for a new room is under way, for the Reload after one that failed);
  - a new salmon faces −1 (upstream once WS-C mirrors the world; downstream until then).
  - Flow events `gameWon`, `respawned`, `respawnRefused` (`onlineFlow.js`, the arcade vocabulary).
- **The start menu comes before the join (2026-11-19; in review; branch
  `claude/eloquent-planck-00ayqg`, PR #1792; runtime change only)**: owner bug, "I am not able to play as
  a fisherman or a bear anymore! the starting menu is now gone!". The menu was the lobby's alone
  (the bullet above), and a room has a lobby only before its first round. A page that opened the
  game into a room already running was put in play at once as a salmon, with no menu: any second
  person, and a lone tester's own reload (the room holds a dropped seat for `rejoinSeconds`, 60 s,
  so it outlives the reload and the new page joins it again). Reproduced on `main` with the
  export's own config: after the lobby, a new page, that page reloaded, and a page opened once
  everyone had left were each a salmon in the same running room, no menu.
  - Now a launch that carries no character shows the menu first and joins only with its answer:
    name, Salmon / Catcher, Fisherman / Bear, Join River, the live river list, as the original
    (its Join River is what joins a room). It is drawn in the page, over the boot screen
    (`engine-layout` `salmonsArt/startMenu.ts`, in the lazy art chunk): nothing of the game is
    mounted before the join. While it is up the device is in no room: nothing there can catch it,
    score off it or aim at it, it holds no place and no bot leaves for it.
  - A launch that carries its choice joins at once, as before: the join the last page carried (the
    win screen's "Join New Game"; `ie:rooms:next-join`) and
    `?rooms_character=` (every playtest's launch). The decision is one function, `engine-mechanics`
    `launchJoin`. A reload carries nothing, so it asks again (the name is kept on the device).
  - Unchanged: a new room's lobby screen ("WAITING FOR PLAYERS", the countdown, round 1; its
    second menu was taken out on 2026-11-20, the bullet "A new room's lobby asks nothing"); the
    death screen's class pick and Respawn; the game server (a join's `name` and `character` are
    the options it always read).
  - Which game has one: a config naming a Salmons generator (`online.ts` `START_MENU`, beside
    `FIELD_ART`). Any other online game joins at once and the room picks, as before. The menu
    reads neither the published flow, the layout nor `rules.lobby`, so **nothing is uploaded**: it
    is live with the runtime release.
  - Left as it is (owner may want otherwise): a join the room refuses (no place left for the
    class picked) still ends on the error screen, and a reload asks again; a menu left open for
    more than 4 minutes outlives the
    boot screen under it, so the page is black for the moment between Join River and the river.
  - Proof: `check:room-lobby` 15 (3 new: the launch's decision; a running room joined as a
    fisherman, and as a bear, in no room while the menu is up), `salmons-levels-play.mjs` 28 / 28
    (9 new: the menu over a running room, the room's people unchanged while it is up, Fisherman
    and Bear joined and walking, a reload asking again, a carried join playing at once, and
    through the menu into a new room's lobby); on `main`'s runtime the same script fails 3.
    `salmons-play.mjs` (untouched: every page carries `rooms_character`) 81 / 81 in each netcode.
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
  Since 2026-11-24: a thrown or dropped salmon's stain is where it came down, and the stains and
  the trail are drawn on top of the water at the config's opacity, 0.3 (the hold-and-throw
  bullet, above).
- **Mouse and touch, as the original (2026-11-17; in review;
  [design/arcade-pointer-controller](../design/arcade-pointer-controller.md))**: an online game's
  Game Config `arcade.online.pointer` (off unless named) lets a player steer with the mouse or a
  finger: the player heads for the point under it at full speed and stops within a dead zone; a tap
  (lifted within 12 px) or a click presses the character's tap button. Salmons ships it as the
  original's client did it (read from `GuiltyForever/Salmon-` `client/input.js` / `game.js`): the
  cursor steers with no button (hover-to-move), 72 px (1.5 tiles), a tap jumps a salmon, swipes a
  bear and casts a fisherman's line, the newest finger steers. The device turns it into the inputs
  the keys make, so the room is untouched. The jump leaps towards the tapped point since
  2026-11-18 (below), and the cast is aimed there too (`salmonsRules.js` `fishingLine`: a `hook`
  ability casts at the input's `aim`).
  Authored in `/config` (Mouse and touch). Proof: `check:arcade-pointer`, `salmons-play.mjs` page
  P (both netcodes).
- **A held finger keeps steering on a phone, and touch schemes per class (2026-11-21; in review;
  branch `claude/touch-controls`;
  [design/arcade-touch-controls](../design/arcade-touch-controls.md); runtime, config and
  `/config`; no game-server change; not uploaded and not published: Owner steps)**. Owner,
  2026-11-21, first play on a phone: "The hold should make the player always go in that direction.
  Right now it seems to stop."
  - **Cause.** The game's canvas had `touch-action: auto`, so the browser took a moving finger
    for its own pan and ended it with `pointercancel`, which the pointer control reads as the
    press ending. A real finger never holds still, so every hold stopped. Reproduced with
    `scripts/playtest/salmons-touch-play.mjs --repro` on a runtime built before the change.
  - **Fix (every online game with the pointer block).** The canvas is `touch-action: none` while
    the pointer control listens. A key pressed and lifted inside one device step is no longer lost
    (`touchControl.js` `createPressLatch`).
  - **Salmons' schemes** (`salmons.js`, carried by the export). `swim` for the salmon: a hold
    steers, a tap leaps towards the point and keeps heading there. `walk`, shared by the bear and
    the fisherman: a hold steers, a tap acts (the bear swipes, the fisherman casts where tapped).
    Where this differs from the original on purpose (a hold never stops at the point, a press
    over 300 ms is not a tap, the salmon's tap also heads): the design doc, §6.
  - **Proof.** `check:arcade-touch` 50; `salmons-touch-play.mjs` 25 / 25 in each netcode
    ([playtest/salmons](../playtest/salmons.md)). The rest: Recent changes.
  - **Not verified.** No real phone was used: the run is Chromium's touch emulation. The live
    game was not played. The mouse is not read by a scheme.
- **Salmons on the engine (P10.16)** — the authored config and layout are made from one seed,
  `SALMONS_SEED`; each room plays a river of its own (P11.2 e, below):
  - **the river and the config**: `engine-mechanics` `src/salmons.js` (`salmonsRiver`,
    `salmonsConfig`): a 1800 × 7200 river of 15 bands from the sea to the source; `salmon`,
    `bear` and `fisherman`; bears and fishermen start on the banks; 100 players; bots keep the
    room full by shares since 2026-11-21 (top of this list; to 20 as bears and fishermen before);
    a bot salmon wins at the source as a person does since 2026-11-21 (until then bots could not
    win, §14 #5); a new round 15 s after one
    ends (§14 #6); each device is sent the players within 3300 × 3300 of its own (2400 × 1800
    until 2026-11-19);
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
    there, as the S0 art's bottom-centre anchor), and the screens above (2026-11-18);
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
    `mine`). Since 2026-11-18 Salmons' flow draws nothing on them (the splash and the golden banner
    are gone: the original has neither);
  - **the flow (P11.2 a–b, 2026-10-29; reshaped 2026-11-18)**: Salmons' own flow (`engine-flow-v2`
    `reference/salmonsSeed.ts`) shows the lobby and its countdown, the death screen on the own
    player's `caught` until the room's `status` (a variable the room owns) is no longer `out`, and
    the win screen at `roundEnd` until `roundStart`; a caught salmon is not drawn until it
    respawns;
  - **proof**: `check:room-bots` (a salmon swims the river to the source, climbing and jumping,
    and wins; a bear bot on its bank catches one near the shore; the config validates clean; a
    room plays its seed's river and replays it; live, two rooms of one game play two rivers, each
    the one its devices make), `check:online-rules` (Salmons' recorded traces: the climb, the
    sandbank, the line, the golden salmon; their events as Flow signals; the line drawn exactly
    while a salmon is hooked), `check:salmons-export` (the export's keys; each look sits on its
    place), `scripts/playtest/salmons-play.mjs` (52 / 52 in each netcode before 2026-11-18: no HUD,
    the swipe on Space, a round's win screen, two rooms with two rivers, a waterfall climbed and a sandbank jumped off, the
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

**The whole lobby clock and the next game by itself (2026-11-26; on this branch, once it merges).
Nothing to upload, export or publish: no config, layout or flow changed.**

1. **The merge does both halves, and one of them closes rooms**: it releases the arcade runtime
   and deploys the game server (`packages/engine-mechanics` and `services/game-server` are
   touched), and **the game-server deploy closes every running room**. Merge when the rooms are
   quiet.
2. **Either order is safe.** New game server, old runtime: the lobby shows the whole clock as the
   plain number, no red, and the win screen does not count. New runtime, old game server: the
   lobby looks as today (no clock until the countdown, then red at the end), and the win screen
   counts. Both out: compare `rooms.invisiblewall.org/healthz`'s commit and the runtime's release
   with `main`.
3. **To check it by hand:** open the published link when no river runs and join. The lobby shows
   "STARTING IN" near 70 under the class row, white, counting down; with a second person in, it
   drops to 10 and turns red, pulsing each second. Play the round (move once), win or lose: "Next
   game in 10" counts over the button and the next river's lobby comes by itself. Do it again
   without touching the game: nothing counts and the button waits. Switch tabs while it counts and
   come back: it waits for the press.

**A class picked in the lobby (2026-11-25; once `claude/upbeat-cray-fzmgxe` merges). Nothing to
upload, export or publish: no config, layout or flow changed.**

1. **The merge does both halves, and one of them closes rooms**, as the next block says of its
   own merge: it releases the arcade runtime and deploys the game server (this change touches
   `services/game-server` and `packages/engine-mechanics`), and **the game-server deploy closes
   every running room**. Merge when the rooms are quiet.
2. **Either order is safe.** A new game server with the old runtime: nothing changes on screen
   (one narrow case for a caught player who presses Respawn twice at once: Current state,
   "Either side alone"). The new runtime with the old game server: the lobby looks as it did,
   with no row of classes, because the room does not yet say its people may pick. The row is
   live once both are out:
   compare `rooms.invisiblewall.org/healthz`'s commit and the runtime's release with `main`.
3. **To check it by hand:** open the published link when no river is running (the start menu
   lists none), pick Salmon and Join River. The lobby shows "Play as" and Salmon / Fisherman /
   Bear under "You are NAME, a Salmon", Salmon lit. Press Fisherman: the line reads "a
   Fisherman", Fisherman is lit and the view moves to a bank. Wait for the countdown: round 1
   starts with you as a fisherman. No row: the game server is still the old one (its `healthz`
   commit), or the page still runs the old runtime (reload once).
4. **"No place left" is rare in a real room.** A room of 100 has 60 salmon's, 25 fishermen's and
   15 bears' places, and bots hold what people do not. It shows only when every place of a class
   is a person's. To see it: a test room of 5 (`&room_size=5`, one bear's place) with two pages,
   the first joined as a bear.

**A device plays its room's levels (2026-11-25; once `claude/zealous-darwin-t8xiyc` merges).
Nothing to upload, export or publish for the change itself.**

1. **The merge does both halves, and one of them closes rooms.** It releases the arcade runtime
   (the runtime release) and deploys the game server (Railway, by its watch paths: this change
   touches `services/game-server` and `packages/engine-mechanics`). **The game-server deploy
   closes every running room**: rooms live in that one process's memory, and each device in one
   stops on "the room closed". Merge when the rooms are quiet.
2. **Either order is safe, and so is the time between the two.** A new game server with the old
   runtime: the device ignores the two new fields. The new runtime with the old game server: the
   fields are absent and the device plays its own config's level, unchecked, as today. The fix
   is live once both are out: compare `rooms.invisiblewall.org/healthz`'s commit and the
   runtime's release with `main`.
3. **What you will see first.** The live Salmons config has the winding river and the tall
   waterfalls; the published one does not (the publish in the next block is still pending). So
   once this is live, Salmons opened from the launcher plays the PUBLISHED river, the
   original's, with the notice naming river and waterfalls, where it drew the winding one over
   the original's collisions before. To play the winding river: **Invisible Game Maker →
   Publish**, then open the game again once the old room has closed.
4. **To check it by hand:** `/editor` → the river screen → **Generated level** → change
   **Waterfalls** → **Save levels**, no publish. Open the game from its card: the notice names
   "waterfalls", and the banks and waterfalls stop the salmon where they are drawn. Press ✕: it
   goes, and stays gone until the next boot.

**The config without its level (2026-11-24; once `claude/affectionate-bell-mwyn5r` merges;
nothing uploaded or published). No deploy is needed: the game server and the runtime already make
every room's zones (Current state). Do not run the Salmons project upload whole for this:**
without fields it replaces the config and deletes what was authored in the tools (the bear's
sheet with rig `R_Bear` and its `sheet: "bearBot"` link).

1. **Upload only the two lists.** A listed field the export does not have is taken OUT of the live
   config (`merge_fields.py` `with_fields`), and everything else in it stays.
   - **From CI, once #1901 is on main** (the workflow then writes only the config fields in
     `scripts/salmons/upload-fields.txt`): add `arcade.zones` and `arcade.online.rules.zones` to
     that list (whichever of #1901 and this PR merges second adds them), then run the **Salmons
     project upload** workflow as a dry run. Its diff should show the config losing exactly those
     two lists, plus whatever else the list names, and keep the sheets. Then run it with
     **apply**; it backs the old config up to `_backups/salmons-project/<UTC>/` first.
   - **Or by hand, now** (R2 access): `scripts/salmons/upload-project.py --fields
     arcade.zones,arcade.online.rules.zones`, dry run first, then `--apply`.
2. **Publish** `salmons` from Game Maker. A device boots, and the game server plays, the
   published snapshot's config (`/api/game-server/config`), not the project's, so until then
   nothing changes for a player. Rooms made after the publish read the small config; a room
   already running keeps its own, and both play the same game.
3. **To go back:** put the backed-up `config/config.json` back into the project and publish.

**The winding river and the tall waterfalls reach the live game (2026-11-24; once
`claude/salmons-river-turns` merges and the launcher, the game server and the arcade runtime are
out).** The published config has no `levels.river` or `levels.waterfalls`, so live rooms keep the
river they have until one of these is done and the game is published. **Do not run the Salmons
project upload whole for this:** without `fields` it replaces the config and deletes what was
authored in the tools (the bear's sheet with rig `R_Bear` and its `sheet: "bearBot"` link).
- **By hand, in the tools (nothing else is touched):**
  1. Studio launcher, Salmons project active → **Scene Editor** (`/editor`) → the river screen →
     the **Generated level** card (under World and camera).
  2. Tick **Winding river**. Leave **Winding**, **Sharpest turn (°)** and **Towards the source**
     empty for Salmons' values (0.75, 140, 0.6), or type them.
  3. **Waterfalls** 6, **Lowest (cells)** 5, **Highest (cells)** 10.
  4. **Save levels** (it writes only `arcade.online.levels` into the Game Config; the stage shows
     the river as you set it).
  5. **Invisible Game Maker** → **Publish**. Rooms made after it play the new river; a room
     already open keeps the river it has. A page opened before it must reload (not once
     2026-11-25's change is live, the first block here: a page then plays its room's levels).
- **Or from CI, fields only:** the **Salmons project upload** workflow now writes ONLY the config
  fields listed in `scripts/salmons/upload-fields.txt` (`arcade.online.slide`,
  `arcade.online.levels.river`, `arcade.online.levels.waterfalls`, and the stored level snapshot
  `arcade.zones`, `arcade.online.rules.zones`, which leaves the live config once the export stops
  shipping it); everything else in the live
  config, the owner's character sheets included, is left as it is (`merge_fields.py`;
  `test_merge_fields.py` 29, on a stand-in store: the sheet link, the rig and a tuned number are
  kept, the old config is backed up first). The workflow passes no `--fields` (a PR that edits a
  workflow fails the `current-games` status by design), so the script reads the list itself. To
  send another field, add its path to that file in a PR; an empty list is a whole replace, which
  deletes what was authored in the tools.

To change the shape later: `/editor` → the river screen → **Generated level** → tick **Winding
river** and set **Winding**, **Sharpest turn (°)**, **Towards the source**, **Waterfalls**,
**Lowest (cells)**, **Highest (cells)** (each has a tip) → **Save levels** → publish. To go back to
the original's river: untick **Winding river**, clear the three waterfall fields, save, publish.

**After the slide merges (2026-11-24; `claude/salmons-collision-slide`).** The game server deploys
and the arcade runtime is released from `main` on merge, and both then know the slide; a room
plays it only once the project's config carries `arcade.online.slide`. So, in this order:
1. Wait for the game server deploy and the arcade runtime release of the merge.
2. Run the **Salmons project upload** workflow (dry run, then `apply`): `config/config.json` gains
   `slide: { corner: 168 }`. Before step 1 is done a device on the old runtime would predict
   without the slide and be corrected at every bank.
3. To tune it: `/config` → Online room → **Slide round corners (px)** (empty = off; 96 follows a
   one-or-two-cell stair but not a rock from under its middle), save, publish.

**The fisherman's hold and throw (2026-11-24; once `claude/salmons-fisherman-throw` merges).**
The game server deploys itself on the merge and the drawing arrives with the runtime release.
The hold itself is in the config (`carry: {}` on the fisherman's hook), which the game server
reads per room. So until step 1 the live game keeps the old catch, with the new blood drawing.
1. **Re-export and re-publish Salmons**, so the published config carries `carry`.
2. **Tune it** in Game Config → **Online rules** ([tools/game-config](../tools/game-config.md)):
   **Held for (ms)**, **Throw up to (px)**, **Flight (ms)**, **Walks while holding**, and under
   **Marks on the field** the **Mark opacity** and **Trail opacity**. Then publish again.
3. **Author the hold and throw animations** in Invisible Characters
   ([tools/invisible-characters](../tools/invisible-characters.md)); there are none, and the
   fisherman is a placeholder circle:
   - the fisherman's sheet: an action on status `carrying` (the holding pose), and one on event
     `thrown` as its user (the throw);
   - the salmon's sheet: actions on status `held` and `thrown`, and on event `landed` as its
     target.
4. **Give the fisherman's sheet or look a hand point** (`draw.points`, or a rig bone:
   [design/character-pipeline](../design/character-pipeline.md)), so the fish sits in his hand.
   Without one it is drawn 3/4 up his body.
5. **Sounds** in Invisible Flow on the events `held`, `thrown` and `landed`
   ([tools/flow](../tools/flow.md)).

**The bear's smooth turn (2026-11-25; once `claude/character-turn-tilt` merges and the arcade
runtime is released). Nothing to edit.** The bear (`bearBot`, `view.turn: {}`) is drawn as the
samples page's style B the owner picked: it turns through the facings in between, each picture
tilted up to 8° towards where it heads about its middle, the next picture taking over in one
frame at the halfway point, tilted back. No fade, the walk carried on.

1. Wait for the runtime release that follows the merge, then **reload the game**. No republish is
   needed for the bear: its sheet did not change.
2. Only to tune it: Studio launcher → **Invisible Characters** (`/characters`) with the Salmons
   project active → **Edit** → the bear → **View** card. **Turn speed (°/s)** is how fast it turns
   round (empty = 360; the samples page swept at 70); **Most lean (°)** the tilt at the switch
   (empty = 8); **Blend (ms)** stays empty (0: no fade). Check it on the turn preview at the
   foot of the card (**Turn about**), **Save**, then publish in Game Maker as usual.
3. For another character (the salmon, the fisherman): the same card, tick **Smooth turn**. It
   needs a sheet first ([status/game-families](game-families.md) open item 16, C3).

Not seen on the real bear: `R_Bear` is in the published project, not in the repo. It was judged
on a stand-in of the same shape (one rig, one animation a facing, each its own parts;
`scripts/playtest/character-turn-strip.mjs`). If the real one looks off, the strip is where to
reproduce it. What the option is: [tools/invisible-characters](../tools/invisible-characters.md),
_View_.

**The desktop build's card joins a room (2026-11-24; once `claude/desktop-publish-rooms-url`
merges and the launcher deploys).** The `salmonsbuild` card (☁ Publish from the desktop launcher)
had no `rooms_url`, so it stopped on a boot screen. Nothing to do but **reload the launcher home**:
the card's link now carries `rooms_url` (the launcher's `GAME_SERVER_URL`) and `rooms_game=salmons`,
so it joins a `salmons` room, which the game server plays with salmons' **published** config (the
one from the last Game Maker publish), not the build's own baked copy. If the two differ, publish
salmons in Game Maker. If the card shows a red line instead of opening, it names what is missing
(no game server address on the launcher, or no published online config).

**A bot salmon can win, and bots have names (2026-11-21; once `claude/salmons-bot-wins`
merges; nothing uploaded or published).** The merge releases all five runtimes (the names'
normalizer is in each; Recent changes) and deploys the game server. The game server plays the
published config, and both
live in it (`bots.canWin: true`, the classes' `names`). The export carries both: upload and
publish it with the room of 100 below (step 4, the export; one upload carries all three). The
by-hand way can tick **Bots can win** but cannot add the name lists. Until then a player sees
what the published config says: bots called "Bot N", and no bot salmon (they come with the
export). Do not publish a config with bot salmon and **Bots can win** unticked on this server:
it has no `botGoal` any more, so a bot salmon at the source would be ignored there and bot
salmon would gather at the source.

**The room of 100 by shares, and the test size (2026-11-21; once the branch
`claude/salmons-room-size-bots` merges). The build uploaded and published nothing. In this
order:**

1. **Merge.** The game server and the runtime both go out from `main` (INFRA "Invisible Game
   Server"; the runtime release). Until step 4 a player sees no change: the published config
   still lists its bots by count, and such a config is played as before.
2. **Confirm the game server runs the merge** (`https://rooms.invisiblewall.org/healthz` reports
   its commit) **before publishing.** An older game server does not know shares: it would play
   the new config by count, in turn, to 20.
3. **Set `GAME_SERVER_MAX_ROOMS` to about 4 on the `game-server` service** (Railway → Variables,
   then Apply changes / Deploy). It defaults to 50, which no longer fits: a Salmons room now has
   100 bodies as soon as one person is in it, and the process is one thread (Recent changes,
   2026-11-21, Load). Or keep the published room size lower until the service runs more than
   one process, which needs Redis presence (INFRA).
4. **Publish the new config**, one of two ways:
   - **The export** (it carries the bot salmon's character, `salmonBot`, and its brain): run
     `node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs scripts/salmons/export.mjs --out <dir>`,
     upload `config/config.json` to the `salmons` project (the **Salmons project upload**
     workflow, dry run first, as step 1 of the numbered list below), then **Publish** `salmons`
     from Game Maker. One upload also covers the re-exports still pending below.
   - **By hand**, only if the project's config already has the `salmonBot` character with its
     brain (a config from before this branch has not; the export is what adds it): Game Config
     for `salmons` → **Online room**, **Room size** 100; **Bots**, tick **By shares**, one row
     each for salmon (brain `salmonBot`) 60, fisherman 25 and bear 15; save, publish.
   Rooms made after the publish play it; a room already running keeps its config.
5. **Test small.** Add `&room_size=10` to the published link: a room of 10 with 6 / 3 / 1 salmon,
   fisherman and bear places, you in one of them. Then 30, then no parameter for the real room.
   A size under 3 or over the room size is refused, and so is a fifth test room at once.

**To go back:** Game Config → Bots, untick **By shares** (it writes each class's places back as
its **Most** and fills the room to its size), set **Fill room to** 20, remove the salmon row,
and clear the salmon's **Most** under Online room → Characters (else only 60 people can be
salmon); save, publish. No deploy. The room is then about as before: bears and fishermen in
turn to 20, their **Most** 15 and 25 where it was 30 and 20.

**The device's view (2026-11-20; #1823 and its rework #1832 are both merged): two things go out
by themselves, the third turns it on once the game server runs #1832.**

**#1823's merge released all five runtimes, not only `arcade`.** `max` is a stored config field
(`arcade.online.nearby.max`), and every stored field has to pass the config normalizer
(`game-config` `normalizeGameConfigDoc`) and is checked by the config validator, and every
runtime carries both: the lines that keep `max` and the two warnings about it add a little to
`lines`, `match3` and `card` (the figures for all five: Recent changes, Runtime bytes). Their
bytes change, so the release on merge releases them too (it skips only a runtime whose bytes are
the same). Their games play as before: those lines run only for an online arcade config; each of
the three bundles is main's token for token but for those two pieces (compared with the
minifier's own variable names set aside: Recent changes); and `check:rgs` passes and `check:all`
fails nothing main does not. `arcade` and `arcade3d` carry the device's side as well. #1750,
#1758 and #1762 moved all five the same way. Nothing to do but expect five releases from #1823's
merge, and two more from the rework's (`arcade` and `arcade3d`, a few bytes smaller; the other
three are byte for byte #1823's and are skipped), which also deploys the game server.

1. **The game server** deploys on the merge (INFRA "Invisible Game Server": its Watch Paths take
   `packages/engine-mechanics`, `packages/game-config` and `services/game-server`; `/healthz`
   reports the commit). Until the next two steps a player sees no change: a runtime from before
   this says nothing of its screen, and the published config has no `max`, so every device has
   the published box alone (`check:room-bots`, live: a device that never names the fields plays
   as before beside one that does).
2. **The runtime release** on the merge. Devices now say what their windows show.
   - With the new game server and the published config (no `max`): the room hears it and sends
     the box alone. No change for a player.
   - If the release lands before the game server deploys: no change either. The device learns
     the input's fields from the server it joins, an old server names none of the three, and what
     the device writes for them is never sent (played in a browser on main's server, in both
     netcodes: the salmon swims, players are sent as the box says, no page error). So the two can
     go out in either order.
3. **Turn it on: re-export and re-publish.** `scripts/salmons/export.mjs` now writes
   `nearby: { w: 3300, h: 3300, max: { w: 6400, h: 6400 } }`; upload `config/config.json` and
   publish, as the re-export below (one upload covers both). Or type it: `/config` → Online room →
   **Nearby max width** 6400, **Nearby max height** 6400, save, publish. Rooms made after the
   publish also send each device what its own window shows; a room already running keeps the
   config it started with. **Not before the game server runs #1832** (`/healthz` reports
   `c98c63c80a32` or a later commit): #1823's game server alone, given a config with `max`,
   sends a phone less than the box, and a salmon there is hooked by a fisherman its device was
   never sent. A game server from before #1823 plays such a config by its box alone (played in
   a browser: that server, this config), and a launcher from before #1823 drops `max` when the
   config is saved in `/config` (from the code, not played).
   - A device still on a cached older runtime in such a room says nothing and has the
     3300 × 3300 box alone, as #1798 left it.

**To turn it off:** `/config` → Online room, clear **Nearby max width** and **Nearby max
height**, save, publish. Rooms made after that send every device the box alone. No deploy.

**The bigger nearby box (2026-11-19) rides the re-export below, and costs bandwidth.** Nothing
extra to do: the export now writes `arcade.online.nearby` 3300 × 3300, and a room takes it when it
is next created after the publish (no deploy, no runtime release). Before publishing, know the
cost. In a full room of 100, measured locally, the server sends about 0.77 MB/s where the old box
sent 0.55 (+39 %) with each salmon in the air about 40 % of the time: inside the 1 MB/s budget.
With each in the air about three quarters of the time, near the most a salmon can leap, it sends
1.12 MB/s, over the budget (the old box: 0.80, and already over the per-device most). How people really play is not known; both are guesses (Recent
changes, 2026-11-19). It also changes play: a bot fisherman's aim is held to this box, so with it
he casts to the edge of his sight (30 cells across the screen) and a swimming salmon is hooked a
little sooner (a median 24 s against 29 s in the same test; that was his aim before 2026-11-20,
and with the softer aim the box matters less: a cast that long hooks about 1 time in 50). To keep
the old box instead, set
**Nearby width** 2400 and **Nearby height** 1800 in `/config` → Online after the upload and before
publishing; players then appear inside the screen as before.

**Re-export, upload and publish — what the owner's 2026-11-20 report points at (bears kept out of
the water, a circle on every attack)**: if the live river is not the original's level, or a
circle shows on a swipe or a cast, the project still holds documents from before WS-A / WS-D/E.
Run `scripts/salmons/export.mjs`, upload `config/config.json`, `editor/flow-v2.json` and
`editor/scenes.json` to `salmons` (the upload workflow's dry run first: its diff on `flow-v2.json`
should drop the spawn on `ability`), then publish. The fishermen's new aim needs only the game
server deploy (below).

**Re-export and re-publish after WS-A merges (2026-11-18)**: run `scripts/salmons/export.mjs` and
upload its `config/config.json` to the `salmons` project (as below), then publish. A room swaps
only the river's geometry into the published config (`generatedOnlineGame`), so with the old
config a live room plays the new banks, bridges, sandbank and lip rules, but the old speeds (240 /
190 / 140) and the old in-turn spawns (no `randomSpawn`).

Steps 1, 3 and 4 are **done (2026-11-02)**: Salmons plays live on `rooms.invisiblewall.org`.

**Sprites for the bear and the fisherman, in eight directions** (after the 2026-11-19 branch
merges, its runtime release is out and the launcher has deployed): nothing to upload or re-export.
Make the clips and publish, as
[guides/salmons-character-sprites](../guides/salmons-character-sprites.md) says: frames in a sheet
(Atlas Maker or Sheet Maker), one Flipbook clip per state and facing named
`bear_<state>_<facing>` / `fisherman_<state>_<facing>` (five facings drawn: `n ne e se s`), made
together in Flipbook's **Characters** mode once its branch is merged and deployed, then
**Publish** `salmons`. Still open, for the owner: where the frames come from (a ComfyUI blueprint
for generated frames is being designed separately), and no starter art exists. The game server is
not involved.

**The line's reach** (2026-11-19, once its branch merges): it is live when the game server runs
the merge (INFRA "Invisible Game Server": its Watch Paths take `packages/engine-mechanics` and
`services/game-server`; `/healthz` reports the commit). Nothing to upload or export, no publish and
no runtime release: the limit is in the rules module, not in the config, and the device is
unchanged.

**The bot fishermen's softer aim and the bear bots' reaction time** (2026-11-20, once their
branch merges): the same as the line's reach above. They are live when the game server runs the
merge (`/healthz` reports the commit). Nothing to upload, export or publish, and no runtime
release: the numbers are constants of the rules module (`salmonsRules.js` `BOT_AIM`,
`BOT_SWIPE`), and a room takes them when it is next created. To make the fishermen softer or
harder afterwards, change `BOT_AIM` (one number, `spread`, is the dial: Open items) and deploy
the game server again; the bears' `BOT_SWIPE.reactMs` moves little within what a person does.

**Bloodstains** (after the 2026-11-18 bloodstain branch merges): deploy the game server (INFRA
"Invisible Game Server") with its runtime release. Nothing to upload: an older game server sends no
stains and the runtime draws none; an older runtime ignores them.

**The start menu before the join** (after the 2026-11-19 branch merges): nothing to upload, to
publish or to deploy by hand; it is live once the runtime release is out. To check it: open the
published link while a river is already running (the menu's own list says so, or
`https://rooms.invisiblewall.org/rooms?game=salmons`): the menu is the first thing on the page.
If it is not, the page still runs the old runtime (reload once), or its link carries
`rooms_character` (a playtest's link, which skips the menu on purpose).

**The lobby without its second form** (2026-11-20, once its branch merges): nothing to upload, to
publish or to deploy by hand; it is live once the runtime release is out. To check it: open the
published link when no river is running (the start menu lists none), pick a class and Join River:
the lobby shows "1 players in … River" and "You are NAME, a CLASS" under "WAITING FOR PLAYERS",
and no name field or Join River (since 2026-11-25 a row of classes under it: the first block of
these steps). If the form is still there the page runs the old runtime (reload once).

**Turn on mouse and touch for the live project** (after the 2026-11-17 branch merges and its
runtime release is out): in `/config` for `salmons`, the **Mouse and touch** card, tick it, Mouse
**Follows the cursor (no button)**, Stop within **72**, and tap buttons salmon **Jump**, bear and
fisherman **Ability 1**; save and publish. (Or re-run the export and upload
`invisible_wall/salmons/config/config.json`, which now carries the block.) Until then the live game
reads the keyboard only.

**Give the live project its touch schemes** (2026-11-21; once `claude/touch-controls` merges and
its runtime release is out). The merge alone brings the engine part to the live game: a held
finger is no longer cancelled, and a short key tap is kept. The schemes come only when the
`salmons` config is uploaded again, either way:

- Re-run the export and upload `invisible_wall/salmons/config/config.json` (step 1 below, or the
  **Salmons project upload** workflow), then publish. The export now carries
  `arcade.online.touch`, and one upload also covers the re-exports still pending above.
- Or by hand: `/config` for `salmons` → Online → **Mouse and touch** (ticked, as above). **＋ Add
  scheme ▾** → **Hold or tap to head**, set its **Name** to `swim`, and pick `swim` as the salmon's
  **Touch scheme** in the table. **＋ Add scheme ▾** → **Hold to steer**, name it `walk`, and pick
  it for bear and fisherman. Save and publish.

Until then a finger on the live game plays as the Mouse and touch settings alone say (no tap to
head).

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
cover both), or the characters keep their placeholders whatever clips are made. (Not needed for
the clips since 2026-11-19: a Salmons room plays the built-in names for a component without the
block.)
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
   found). Back up the current files first. Or let CI do all of this: the **Salmons project
   upload** workflow (`.github/workflows/salmons-project-upload.yml`, main only, runs
   `scripts/salmons/upload-project.py`) does a dry run by default with a diff per changed
   document as an artifact; `apply` copies each changed document to
   `_backups/salmons-project/<UTC>/` and then writes, conditionally, so a save made meanwhile
   stops it.
2. (No longer needed since P11.2: the export now writes Salmons' own flow over the starter.)
3. **Publish** `salmons` from Game Maker. Since P11.2 (c) the publish writes the game server's
   address into the launch URL as `rooms_url` (the launcher's `GAME_SERVER_URL`, by default
   `wss://rooms.invisiblewall.org`), so the published link plays as it is.
4. **The game server's config credential** (INFRA "Invisible Game Server" steps 5–7), so the live
   server can read the published config.
5. **Moving the players over** from the Salmon repository's own server: when the art (and,
   if wanted, the isometric view, P11.4) is in and you are happy with a playtest on the live server.

**The original art in the project.** Done: all five sheets are in the `salmons` project
(`salmons_terrain`, `salmons_props`, `salmons_characters`, `salmons_waterfall_face`,
`salmons_cliff`), every region at its built-in name, place and size, each page byte-identical to
the built-in one, locked. The first four were imported 2026-11-17 through the Sheet Maker's
`.plist` import; `salmons_cliff` was written 2026-11-18 by the **Salmons art upload** workflow
(run on main: 3 objects written, nothing else touched).

1. **To redo or add a sheet:** dispatch the **Salmons art upload** workflow
   (`.github/workflows/salmons-art-upload.yml`, main only). It runs `scripts/salmons/upload-art.py`
   with the release's R2 key, so nobody needs a key or a manual import. A dry run is the default,
   `sheets: <name>` limits it to named sheets, and `apply` writes. It skips what is already there
   and stops, writing nothing, on any key that holds other content. The keyless alternative is
   still there: `python3 scripts/salmons/plist-export.py --out <dir>` writes `.plist` + `.webp`
   pairs for the Sheet Maker's **Import** tab (sheet name blank, lock on).
2. **See it in the tools:** the Sheet Maker's rail on `salmons` lists the sheets (🔒). In the Atlas
   Maker, **↻ Refresh from R2**, then pick one in the atlas list.
3. **Edit:** keep each region's name and size. A region can be edited in the Atlas Maker in place.
   To re-pack a sheet in the Sheet Maker, unlock it first (its frames may move; the game reads them
   by name, so that is safe).
4. **Republish** `salmons` from Game Maker. The art export ships every Salmons sheet the project
   holds, and the room draws them; one it lacks is drawn from the built-in copy.

## Open items / next (S0)

### Open after the wading (2026-11-25)

- **A bear drawn by a plain published clip does not wade.** `<SpawnLayer>` draws that clip
  itself and it has no mount; `<SpawnLayer>` is in every runtime's bundle and was not to be
  changed. The way from `online.ts` is to draw a wading character's clip through
  `engine-layout/sheet-clip` at no lean, as a smooth turn's is, which changes how every bear
  clip is drawn on land too (or, switched at the water's edge, starts the clip again there). Not
  taken: no bear clip exists. Take it with the first bear clips, or give `<SpawnLayer>` a way to
  put a filter on a clip.
- **Owner: look at the live bear.** The waterline's numbers were judged on the bear sprite and a
  stand-in rig. If `R_Bear`'s body is much narrower than its box the curve will read flatter
  than here; `WADE.reach` and `WADE.sag` are the two to move.
- **A fisherman on a bridge is drawn at the water's level**, behind the deck: his code look does
  not take the room's height (`z`). Seen while standing one there; as before this change
  ([playtest/salmons](../playtest/salmons.md), Known gaps).

### Open after the room of 100 by shares (2026-11-21)

- **Owner decision: how hard a big room is.** The river is the same length at every size, so
  60 / 25 / 15 puts 4 hunters on it in a room of 10 and 40 in a room of 100. A salmon that
  steers has a real chance at 10 and 30 (at the source in 22 and 17 of 24 rooms) and little at
  100 (6 of 24; hooked in 16). No bot number was moved: softer fishermen or bears would make
  the small rooms easier still. Levers, none taken: the hunters' share by room size, a longer
  river for a bigger room, the line's take-the-first rule (next item).
- **A cast at another salmon hooks the person beside it.** A bot casts at his nearest salmon,
  but the line takes the first player in joining order within its reach, and in a room the
  person joined first. A rule of the line, people's casts too; not touched.
- **Owner step before publishing: the game server's rooms.** A Salmons room has 100 bodies as
  soon as one person is in it (it had 20), and the process is one thread. About 7 mostly-bot
  rooms of 100 saturate it, about 4 with 40 % headroom, about 2 full of people.
  `GAME_SERVER_MAX_ROOMS` defaults to 50: set it to about 4 (Owner steps), or publish a smaller
  room size until the service runs more processes (Redis presence, INFRA).
- **Sizes 30 and 50 were not load-tested**, only 100. The live game server, the live game and
  the launcher against R2 were not tried.
- **Bots by shares in a 3D room are not built** (`roomSim3d.ts` takes its bots in turn up to the
  room size), and a test size is refused for a 3D game.

### Decided 2026-11-21: the line's short cast and its hook test

Two edges of `salmonsRules.js` `fishingLine`, decided in the build (the owner may overturn
either; Recent changes has the change):

- **A cast nearer the fisherman than the line is home is refused (fixed).** The line is home
  within 0.3 tiles of him (`LINE.landCells`); a cast was taken from 0.1 tiles, as in the original
  ([reference](../reference/salmons-original.md) §5.3: `dist < 0.1` refuses, `ldist < 0.3` lands,
  the cooldown set on the cast). A cast in between was taken, so the room sent `ability` to every
  device and spent the 250 ms cooldown, and the same step's reel found it home: never tested for a
  hook, never in a patch (`lineActive` set and cleared inside one step). It could catch nothing,
  so refusing it costs nobody a catch. It happens only on a bridge: elsewhere the water is solid
  to a fisherman's 56 px box, so his centre is at least 0.58 tiles from it. On level 1's second
  bridge a tap 0.2 tiles off, at a salmon under him, was `ability`, the cooldown and no hook; 0.35
  tiles off hooked it. Refused now as a cast onto the bank is: no `ability`, no cooldown.
  - **Devices:** the own device still plays its predicted press (`createAbilityPredictor` knows no
    cast rule, as for a cast onto the bank) and drops it when the room's state comes without its
    echo. No device code tests the distance; the shipped fisherman look plays nothing on
    `ability` anyway.
  - **Bots:** a bot fisherman's rest starts at his press whether the room takes it or not
    (`onlineBots.js` `botInput`), so his inputs are the same; the rest (2.5 to 4 s) outlasts the
    cooldown.
  - **Left:** a fisherman's own later inputs in the same step (a catch-up after a stall) can
    still walk him onto a bobber just past 0.3 tiles, which is then home untested.
- **The hook is tested where the salmon is now, with no rewind (decided; unchanged).** A swipe is
  tested where the bear's device drew the target (`onlineRules.js` `placeAt` at the input's
  `view`, up to 250 ms back). Design/realtime-multiplayer §6 recommended the same for "a hook"
  when the hook was an instant ability, before WS-B made the line travel; it now says otherwise.
  - **The rewind fits a hit that the user's device plays on the press, from his predicted place:**
    the bear's claw is drawn at once beside the salmon as his device draws it, which by the time
    the room takes the press is 100 ms plus his round trip back. No device predicts the bobber.
    The fisherman's draws it at the room's newest state (`online.ts` `drawMarks`,
    `lineX`/`lineY`), 0 to 50 ms behind the clock everyone else is drawn 100 ms behind. So on his
    screen the bobber and the salmon it passes are 50 to 100 ms apart, whatever his round trip.
    The caster's `stamp − seen` is his round trip plus those 100 ms and a step
    (status/game-families), so a rewind by it would test the bobber against places of the salmon
    he never saw beside it.
  - **It would cost the salmon what it saw:** its own fish is drawn ahead of the room, the bobber
    behind. At 6 tiles/s with the current's 1.5, the 7-step window is 1.75 tiles, more than the
    1.5-tile reach, so a salmon clear of the bobber on every screen could be hooked. The ring of
    past places keeps no height, so a leap over the line (`CLEAR.hook`) would be judged at its
    height now and a place it left. It works against the open "Nobody can dodge a cast".
  - **The original** tested present places (`server/index.js` 578–642), and its clients drew
    players dead-reckoned towards the present (reference §13).
  - **The gates cannot tell:** a throwaway prototype (the caster's lag noted at the cast, each
    reel's test that many steps back) passed `check:online-rules` 40, every trace exact (their
    inputs' `view` is the room's last step: a one-step rewind), and `check:room-bots` 56. A probe
    with an 8-step-old view did differ: a salmon that came under the bobber in the cast's step was
    not hooked. Not kept.
  - **Open (device, not built):** the 50 to 100 ms between the bobber and the salmon on a
    fisherman's screen, up to 0.75 tiles for a salmon at full speed with the current, of the
    1.5-tile reach. Drawing the bobber at the step everyone else is drawn at would close it with
    no rule change (a runtime change).

### Open owner decisions: bots after the softer aim (2026-11-20)

"The room as it ships" in this section is the room before the shares (2026-11-21): 10 bear and
9 fisherman bots, no bot salmon.

- **The bear bots now take almost every salmon in the room as it ships (2026-11-20, later).**
  With the fishermen softened again a straight swimmer is swiped in 19 of 24 rooms and a weaving
  one in 23 (Recent changes). Not retuned here. Seen in the harness: a bear bot walks right onto a
  still salmon (0 to 2 px) before he swipes; bear bots spend 43 % of their time in the water. And
  2D bots stall: pressed against a bank limit, a waterfall's bear block or a rock corner for up to
  4 to 6.7 s (bears 3.1 % of the time, fishermen 10.9 %), because a 2D bot's brain is never told
  it hit a solid (`onlineBots.js` `createBrainWorld` gets no `hitSolid`; the 3D bots pass one), so
  `wander` turns only on its timer. For the owner: whether the bears hunt less (follow less far,
  wade after a salmon less), and whether a stalled bot turns away.
- **Closed 2026-11-21: a key tap shorter than a device step (33 ms) was lost.** The button keys
  go through a latch now (`touchControl.js` `createPressLatch`; `check:arcade-touch`; in review):
  a key pressed and lifted between two steps is that step's press.

The bot fishermen were softened, and then the bear bots (Current state). What that showed and is
not these changes' to decide. The numbers are the 2026-11-20 measurements (Recent changes): the
shipped level, a room of 10 bear and 9 fisherman bots, a salmon that swims up the middle of the
water and never avoids anything.

- **Closed 2026-11-20: the bear bots have a reaction time** (owner: "give the bear bots a
  reaction time too"; Current state). It was the open call here: a bear bot swiped in the step a
  salmon came within reach.
- **The bear bots still take a salmon that swims straight at them, and a reaction time cannot
  change that.** In the room as it ships that salmon is at the source in 1 of 24 rooms with or
  without it; a wait of 4 to 6 s would be needed for a quarter of rooms. A bear bot wades in (the
  original's rule for a bear), walks at 4.5 cells/s to a salmon within 320 px and stays with it:
  the salmon is within his reach for a median 3.0 s at a time. What was tried in the harness
  only, with the reaction time on (nothing of it shipped; room as it ships, then bears alone, of
  24): a bear chasing at 0.75 or 0.6 of his speed, 2 and 7 at the source; a bear that spots a
  salmon within 160 px, not 320, and gives up past 240, not 480: 4 and 10. So neither a slower
  nor a shorter-sighted bear reaches a quarter of rooms either. Two readings, for the owner: the
  bears are right and the measure is wrong (a person steers round a bear and leaps; the test's
  salmon swims into him, and no test salmon that steers exists yet), or the bear bots hunt too
  well for a room of bots (then it is their brain: how far they follow, whether they wade after a
  salmon at all). The first is cheaper to find out: a swimmer that steers round bears, then the
  same table. **Found out 2026-11-20, later: the first.** A salmon that steers is at the source
  in 11 of 24 of the same rooms (swiped in 8, hooked in 5).
- **Nobody can dodge a cast.** A cast has no flight time: the bobber lands and hooks in the same
  step, so a salmon that taps jump when a bobber lands within 3 cells of it reaches the source no
  more often than one that never does (10 of 24 each against the fishermen alone). What would
  make watching the water worth it is a rule of the line, for people's casts too: the bobber
  travels out and can hook only once it is down.
- **How soft.** `BOT_AIM.spread` is the dial. Against the fishermen alone, of 48 rooms the
  salmon reached the source in 20 at 0.5 (shipped), 26 at 0.65, 27 at 0.8 and 28 at 1.0; with
  `sureCells` 6 instead of 4, in 13. A longer reaction time changes that little (18 to 20 of 48
  between 0.7–1.5 s and 2–4 s) and mostly means fewer casts (593 down to 333). The gain
  flattens past 0.65.

### Decided 2026-11-20: the device's view drives the box (windows bigger than the nearby box)

The box (3300 × 3300) covers a 1920 × 1080 window and a phone up to 390 × 844; a 2560 × 1440
window, a 3840 × 2160 one and a tablet saw past it. Of the three ways to close that, the owner
chose the first, and it is built (Current state, first bullet):

- **The device's view drives the box: built.** Each device says how much it shows, and the room
  sends it that as well as the box, as far as an authored most.
- **Cap what the camera shows: not built.** Past the view the box covers, the world would be
  drawn bigger instead of more of it. It changes the approved look (a cell 64 × 32 px whatever
  the window).
- **A box shaped like the view: not built as a config.** One fixed turned rectangle for every
  device. The room now tests exactly that shape, but per device, from what the device says.

Still open, for the owner:

- ~~**The most, 6400 × 6400.**~~ **Decided 2026-11-20: the owner accepts 6400 × 6400**, knowing
  a room in which every device declares all of it is over the budget (1.14–1.16 MB/s) and, since
  #1832 made the view only add to the box, the guessed mix at `--jump 0.1` is over too
  (1.08–1.16 MB/s). Publishing it is still step 3 above. The note as it was: it covers a 3840 × 2160 window at 100 % exactly (its view needs
  6400). A room in which every device lies and declares all of it is over the 1 MB/s budget; no
  honest mix measured comes near (the cost table, Recent changes). A lower most bounds the liars
  and cuts honest large windows: 4600 × 4600 would cut 3840 × 2160 and, by 8 px, a 1280 × 800
  tablet (4608 on the 32 px grid; `check:room-bots` fails on it). It bounds who comes into a
  view: a player already sent is kept until a quarter past it (8000 × 8000), as with the box.
- **Send a phone less than the box: not on.** A phone's screen is a turned rectangle a third of
  the box, and the first build sent a device its view instead of the box. Measured on that
  build with the guessed mix of devices: 0.55 MB/s out where the box alone sent 0.75–0.87 (a
  device 5.6 KB/s on average against 7.7–8.9).
  **Why it is not on:** a fisherman sees and casts 30 cells across the screen, a phone shows 14,
  so a salmon on a phone was hooked by a fisherman its device was never sent (found in review,
  played on a local room; `check:room-bots` now plays it). **What it needs first:** a reciprocal
  rule, `sees(other, me)`: a device is also sent every player who can act on its own (for
  Salmons, a fisherman whose sight holds it), which the rules module would have to give the
  room. A phone would then be sent the union of its view and that sight, about 6.2 M px² of
  world against the box's 10.9 M (worked out from the two shapes, not measured), so it would
  save less than that measurement shows.
- **The most a device receives at the highest leap rate** is over its budget with or without
  this (the cost table's last two rows): it is the 1920 × 1080 devices in a shoal, which the box
  already sent as much.
- **Waterfall terraces on an ultrawide window** (Current state, Known limits): left as a limit,
  a call made in the build; the owner's to overrule. Closing it means the device adding the
  tallest step to what it says, at a cost in bytes.

**The load test no longer plays today's game by default** (`scripts/room-load.mjs`; agent work,
then an owner call on the budget). Its devices tap no jump, press no Respawn and say nothing of
their screens unless told to (`--jump`, `--respawn`, 2026-11-19; `--shown`, 2026-11-20, whose mix
of windows is itself a guess), so on the original's levels every salmon sits on the delta's
sand (1.0 KB/s a device, 0.1 MB/s) and on the band river a caught player stays out. P10.16's
table ([status/game-families](game-families.md): 8.4 / 11.0 KB/s, 0.82 MB/s, the band river) was
not re-measured. One run of the band river with `--jump 0.02 --respawn` at its old box read 12.8
/ 18.3 KB/s and 1.25 MB/s, over the budget. Next: make the playing devices and the exported level
the default, re-measure the table, and have the owner confirm or move the budget.

The isometric view is built ([Phase 11](../design/phase-11.md) P11.4: the river drawn 2:1, the
players upright in depth order; the S0 art should be drawn for it: diamond ground, upright
characters, their place at their feet); the published `rooms_url` and a river per room (P11.2) and its own rules (P11.3) are built.
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
  bodies. Since 2026-11-19 a clip-drawn holder's end is its clip's hand (`characterClips.hand`);
  the end on a clip-drawn salmon is still half its body's `h`.
- The line and the gold are placeholders: no sound plays in game (the original has none either;
  the Flow events are there for one).
- **The river list** reads WS-B's `GET <rooms_url over http(s)>/rooms?game=<key>` (`[{ roomId,
  players }]`: joinable rooms, people, most first, at most 50) every 3 s while the menu shows; a
  failed or empty answer retries every 15 s. `salmons-play.mjs` checks the route answers a page.
  The lobby's note reads the same route for its own room's count (2026-11-20): a room past the
  listing's 50 shows its river's name with no count.
- The win screen's name is `gameWon`'s `winnerName`; the floating text's caught name is read from
  the state (the catcher is near its catch).
- The start menu is before the join (2026-11-19) and nowhere else (2026-11-20; it sat in the
  lobby by owner decision 1, where Join River with another name or class left and joined again):
  a launch with `?rooms_character=` or a carried join skips it. The original's Ko-fi link and version tag are not drawn (owner call),
  nor is its loading screen's background and swimming fish (the arcade loading bar keeps its look;
  only the phrases are added, and they show once the art's chunk has loaded). The death title's
  `death-pulse` keyframes were not in the report: it pulses its alpha over 2 s.
- **Press Start 2P is not shipped**: the screens and the floating text name it and fall back to
  the device's monospace. Shipping it is a font through the fonts pipeline (rule 8). The win
  animation's big fish uses the 256 px character art (the original had an HD texture; not built).

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
  `waterfall_face`, `cliff`; 805 KB together), with their provenance in `salmonsArt/README.md`. The
  bridges are not built. Rule 8: the sheets are part of the runtime build, so they ship with the
  runtime release as hashed `_app/immutable/assets/` files (config-vite keeps them out of
  `assetsInlineLimit`). A room whose config names the `salmonsRiver` generator imports the lazy
  `engine-layout/salmons-art` chunk (8.8 KB gzip) and loads the sheets after the join. No other game
  fetches them, and a failed load keeps the placeholders. Guarded by `check:salmons-art`.
- **The river** (`salmonsArt/river.ts`, through a field mount in `IsoWorld`; walls, beaches and
  bridges since 2026-11-18, above): grass-autotile banks
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
   _(Default: 20. The golden salmon is the pink clips tinted gold by the game, so no
   `salmon_golden_*` clips are made; generated golden clips replace the tint if they exist. The
   tint is the visual fixes' gold, `SpawnLayer`'s colour matrix.)_
2. **States the engine has that the plan lacks** (P11.3). A salmon can be **grounded** on a
   sandbank (held still until it taps), **hooked** on a line (reeled in), and it **climbs** a
   waterfall by tapping. _(Default: climbing or jumping off a sandbank plays `hop` once; grounded and
   hooked play `swim`. Optional: add `salmon_pink_hooked`
   (loop, thrashing on a line) and `salmon_pink_grounded` (loop, flapping on sand), 4 more
   clips.)_
3. **Facing from velocity or from the stick.** The river's current is part of the velocity, so a
   salmon swimming upstream more slowly than the current is carried downstream and faces
   downstream. The room also sends each player's input direction (`facing`). _(Default: velocity,
   as briefed. Alternative: the input's direction while the player steers.)_
4. **Sizes.** The engine's bodies are bigger than the old client's sizes: salmon 90 × 44 (old: about
   50 long), bear 92 × 92 (old: 80 wide), fisherman 56 × 88. The clips are drawn at the body's
   width. The blueprint writes 320 × 320 frames, and Max px only shrinks, so 320 changes nothing.
   _(Default: keep the approved Max px 256 / 320, about 3× the drawn size. For sharper art, raise
   the blueprint's Output frame width / height towards its 512 maximum.)_
5. **Loops that end where they start.** `wan22_i2v_flipbook` doesn't loop, so a loop needs a
   hand-picked From / To. The library also holds `wanloopingvideo__3_`, which loops but took about
   17 min a render in its one measured run. _(Default: `wan22_i2v_flipbook` for every clip; try the
   looping blueprint on `swim` if the seams show.)_
6. **The fisherman has no source art** (the old client draws him in code), and `gpt_image` needs a
   reference image, which it _edits_ rather than only borrowing its style. _(Default: the locked
   `bear_se` still is redrawn as the fisherman. Alternative: upload any drawing of a fisherman in
   the house style.)_
7. **Duration.** The blueprint's default is 5 s and the plan says 2–3 s. _(Default: 3 s for loops,
   2 s for one-shots.)_
8. **The cutout models.** The plan names a BiRefNet cutout for the stills. The `gpt_image` builder
   uses the `RMBG` node, whose clean choice is **BEN2**
   ([model-licences](../reference/model-licences.md) recommendation 1: first confirm the re-host is
   the MIT base). BiRefNet needs a builder change. The video's default matting, `BiRefNet_toonout`,
   has no recorded licence, against the owner's licence-clean-only rule. _(Default: BEN2 for the
   stills and `BiRefNet-general` (MIT) for the videos, to keep the licence-clean rule.
   Alternative: allow `BiRefNet_toonout`, the plan's choice, which may cut toon edges better, once
   its licence is confirmed.)_

## Decided (owner, 2026-10-26)

- **Models:** licence-clean only. The art pass's recipes already are: `gpt_image` (clear), a
  BiRefNet cutout instead of the default RMBG-2.0, and Wan 2.2 for video
  ([model-licences](../reference/model-licences.md)).
- **Project:** the `salmons` project is reused for the rebuild, replacing what is in it. The
  original game stays safe in its repository.
- **Facings:** a per-game option, 4 or 8 (game-families §9 #28). Since 2026-11-19 the bear and the
  fisherman take 8 and the salmon 4 (owner request).

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

- 2026-11-27 — **Performance T7: everyone else's place in 16 bits, Salmons at 15 states a second**
  (owner: "go ahead with 16-bit positions and patchHz 15"; plan
  [design/salmons-performance](../design/salmons-performance.md) §5; branch
  `claude/salmons-perf-t7-wire`, on T6; in review). Wire:
  [design/realtime-multiplayer](../design/realtime-multiplayer.md) §5 "Packed places".
  - **What changed.** A device joins with `positions: 'u16'` and a nearby room sends it everyone
    else's place as uint16 `px` / `py` in steps of the room's `posScale` (`engine-mechanics`
    `positionScale`: ⅛ px on a generated river, ½ px on the original's 6768 × 19728 map, which the
    live project plays), its own float32 as before. View tags on the nearby state (`schema.ts`
    `VIEW_TAG.exact` / `packed`), fields only appended: a runtime that does not ask is sent float32
    for everyone, a runtime on a server that does not pack reads `x` / `y` (`placeOnWire`), and
    both kinds share a room. A room with no nearby box, and the 3D wire, are unchanged. Salmons'
    config in code sends 15 states a second; everyone else is drawn two states' time behind
    (`online.js` `interpolationDelayFor`: 133 ms; 100 ms at 20 and faster), and the room's lag
    compensation reaches as much further back (`onlineRules.js` `rewindMsFor`: 283 ms, 8 steps, at
    15; 250 ms at 20 and faster), so a phone's round trip is compensated as before (code review).
    A game at 20 a second or faster draws and compensates as before; one configured slower (none in
    the repo) is drawn two states behind instead of 100 ms.
  - **Measured, before → after, on this container.** `room-load.mjs --devices 20 --seconds 40
    --jump 0.02 --respawn` (Salmons, the generated river; main's checkout vs this branch): a device
    receives 14.39 → 8.82 KB/s on average (−39 %; max 17.49 → 11.27), 20 → 15.1 states a second,
    the server sends 0.281 → 0.172 MB/s, CPU 16 → 17 %, RSS 206 → 200 MB; the budget the script
    holds (10 KB/s average, 16 max) was missed on main and is met. The same at 15 Hz with float32
    (`--positions float`): 10.9 KB/s, so the rate is −24 % and packing a further −19 %.
    `salmons-lab.mjs --runs 3` (T2's lab, the original map, a room of 21; main + the T6 runtime vs
    this branch): in 20.9 → 16.1 msg/s, 1353 → 836 B/s (−38 %), 65.8 → 52.5 B a patch, 14.2 → 11.7 B
    a patch per player sent; out unchanged (15.5 / 15.4 msg/s: one input a step, at the lab's ~5
    fps 3 steps a frame); jsMs 21.3 → 20.5 and the handler time a patch below the probe's 0.1 ms
    resolution in both. `check:room-wire`, one live room of 61 players: 709 B a patch to a device
    sent float32, 484 B to one sent packed (−32 %).
  - **Gates:** `check:room-wire` 10 (new: the scale, the packing, the fallback, Salmons' 15 Hz; a
    live room with a device of each kind), `check:netcode` 33 (adds 15 Hz packed rows: the own player
    still exact, no snap), `check:room-sim` 43, `check:room-bots` 56, `check:online-rules` 40,
    `check:room-lobby` 42, `check:room-levels` 16 (its schema regex takes the multi-line state),
    `check:svelte --only apps/lines` 145 (baseline 145). Playtests on this runtime:
    `salmons-wire-play.mjs` 18/18 (new: both deploy orders, against main's server, with the T6
    build as the old runtime), `online-play.mjs` 20/20 and `--netcode colyseus` 20/20,
    `salmons-rejoin-play.mjs` 58/58, `salmons-play.mjs` 103/103. `check:runtime-bytes`: only
    `arcade` (+126 B gzip) and `arcade3d` (+178 B) move, re-recorded; the rest byte-identical.
  - **Owner steps.** (1) The game server must be redeployed with this (Railway `game-server`
    rebuilds on a merge that touches `services/game-server`): a deploy restarts the process and
    closes every running room, as any game-server deploy does; devices see the room lost and load
    again. Deploy order does not matter: old runtimes keep working on the new server and new
    runtimes on the old one. (2) Merging does not change the live rate: the room reads the
    published snapshot's config, whose `arcade.online` has no `patchHz`, so the Game Config default
    (20) fills it; `salmons.js` is only the export / playtest config. In `/config` → **Online room**
    → **States per second** type **15**, then **Publish**.
    Rooms made after that (≤ 90 s: the launcher's and the server's config caches) send 15.
- 2026-11-27 — **Performance T6: the net client applies the room's state once a frame**
  ([design/salmons-performance](../design/salmons-performance.md) §4 T6; branch
  `claude/salmons-perf-t6-net`; in review; runtime only, no wire, schema, server or config
  change). Each state used to run a whole pass as it landed (Flow's server values, a `Set` of the
  players, a push per player, the own player's reconcile); after a stall up to 82 land between two
  frames (Mali reading `914870b5`: `netMs` max 91.9 ms on the frame with 82 patches), each pass
  replaced by the next. Now `online.ts` `recordState` (the room's `onStateChange`) keeps only what
  interpolation and Flow need from each state (its arrival for the render clock, everyone else's
  place at its step, the server variables) and `applyState`, first in `tickOnline`, does the rest
  once from the newest. An old
  server and a new runtime, or the reverse, see no difference on the wire.
  - **Measured** (`salmons-play.mjs --stall`, headless shell, a room of 20, a 2 s block, three
    trials, main + the same probe counters vs this branch): passes on the catch-up 43 → 1 (`applied`
    43 before the frame → 0, then 1 in it); room-message handler time 0.8–1.1 ms → 0.3–0.5 ms for
    the ~44 held messages (−55 %; what is left is the SDK's decode); the catch-up frame 5.9–8.5 ms vs
    5.3–7.7 ms, the same as the frame after it within noise; 0 corrections either way. On a desktop
    CPU the pass is cheap; on the Mali, at ~1.1 ms a held message, the same share is ~50 ms of the
    92 ms spike (an estimate, to confirm with a T2 lab reading).
  - **`check:netcode`** applies the own state once a frame as the runtime does (the reliable and
    datagram rows are unchanged within noise: e.g. datagram 150 ms, 549 → 538 corrections, every rest
    converged) and adds a 2 s stall per state (34 queued → 34 passes) and per frame (40 → 1), the
    prediction exact in both, and a stall over a lossy datagram link (1 pass, no snap).
  - **Input is sent once per FIXED step, not per render frame** (the two reviews disagreed).
    `tickOnline` sends inside `createFixedStep`'s callback, and the readings agree: Mali `914870b5`
    sent 3879 messages over 146 s while its loop ran 3942 steps (1483 menu frames × 1.2 + 1201 play
    frames × 1.8) in 2685 frames; Samsung `793da528` 4065 messages for 4062 steps. 26.5 msg/s is
    below 30 because a long frame's time is dropped (Pixi caps `deltaMS` at 100 ms, the loop runs
    at most 5 steps a frame: `simDroppedMs`) and the socket's seconds include the time before the
    loop runs. Dropped time sends no input and moves nothing, on the device and in the room alike
    (the room rests the player and banks credit), so the server's credit stays right: no bug.
  - **Wire ideas for the owner (not built; §5):** (1) other players' places as uint16 at ¼ px (the
    river is 1800 × 7200, under 16384) in a versioned room, own player float: ≈ −4 of ≈ 14 B per
    moving body, ≈ −30 % of patch bytes (≈ 8.5 → 6 KB/s in on the Mali reading); an old runtime
    joins only the old room version. (2) Game Config `nearby.max` 6400 × 6400 → about two screens
    (≈ 3300): most of a 20-player room falls outside it on the long river, so in-bytes and the
    server's per-client encode shrink with it; `patchHz` 20 → 15 with a 133 ms interpolation delay:
    −25 % of messages and bytes, others drawn 33 ms later. (3) WebSocket permessage-deflate: float32
    deltas compress poorly, guess 15–30 % of bytes for a zlib pass per client per patch on the
    server; measure with `scripts/room-load.mjs` before deciding.
  - **Gates:** `check:netcode` 31, `check:room-sim` 43, `check:room-bots` 56, `check:online-rules`
    40, `check:room-lobby` 42, `check:agents-knowledge` ok, `check:svelte --only apps/lines` 145
    (baseline 145). Playtests: `online-play.mjs` 20/20 (engine) and 20/20 (`--netcode colyseus`),
    `salmons-rejoin-play.mjs` 58/58, `salmons-play.mjs` 103/103, `--stall` 4/4.
    `check:runtime-bytes`: only `arcade` (+110 B gzip) and `arcade3d` (+88 B) move, re-recorded;
    the slot, match-3 and card runtimes are byte-identical.
  - **Code review (`code-reviewer`, 2026-11-27).** The Flow's server variables are written as each
    state lands again, not once a frame: the play field ticks only from the basegame screen, and
    Salmons' seed flow checks `var:phase` / `var:secondsLeft` on the start screen's tap, so a cold
    boot into a lobby read `''` and the lobby never showed. A room event about the own player (or a
    round start, which clears its cooldowns) applies the newest state first, since a step's events
    follow its patch. `check:netcode`'s per-frame model keeps the newest state by step (a datagram
    can overtake). The `--stall` playtest reads its two counters in one call.
  - **Guard:** the invariant in [families/arcade](../knowledge/families/arcade.md) "Online, device
    Flow is presentation" (record each state, apply the newest once a frame), `check:netcode`'s
    stall rows and source checks, `salmons-play.mjs --stall` ([playtest](../playtest/salmons.md)
    "A stall").

- 2026-11-27 — **The river's GPU work: no ripple pass, no wading pass** (owner's option A: only
  the art code changes; quality ladder, resolution and MSAA untouched). Not committed (fix run).
  - **The riverbed's ripple** (`salmonsArt/bedRipple.ts`, new; `river.ts`): no
    `DisplacementFilter` over the bed. Every riverbed picture is painted onto one atlas, and a
    chunk of the bed is one mesh of its tiles' quads (the same corners, order and pictures as the
    sprites were, checked tile for tile against main 7f05b92). The mesh is drawn by the ripple's
    own program, which reads the same 256 px displacement map at each pixel's place in the
    river's container (moved on 0.35 / 0.18 px a frame, as before) and reads the tile's picture
    up to ±3 / ±2 screen px off, as the filter did. Looks different in one way: the filter read
    the whole bed, so the seams between two sand colours wobbled too. Now each tile reads only
    its own diamond (a push past 0.9 of the way to its rim reads the pixel unpushed, and a pixel
    outside the diamond is never pushed in), so seams stay still and the pebbles ripple. Not
    WebGL, or a GPU that refuses the program (warned once): the bed is drawn plain (no ripple)
    and batched with the ground, never through a filter.
    `rippleBy` and the `getFastGlobalBounds` override are gone.
  - **Wading** (`wade.ts`, `index.ts`): the game gives the wading no pass (`createWading(waterAt, TINT_ALPHA)`;
    `wadeFilter.ts` is no longer loaded). A code look still draws itself half under in its own
    programs. **A rig or a turned clip (the owner's live bear is a rig), or a code
    look whose GPU refuses its programs, now wades drawn as on land**: depth and line are still
    worked out, `drawnUnder` and `pass` are false. `wadeFilter.ts` stays as the pass the code
    look's step was drawn to (`bodies-pixels.mjs`, checks).
  - **Gates:** `check:salmons-art` 53 → 56 (no filter anywhere in the river with the ripple or
    without; bed meshes drawn by the ripple's program; the ripple WebGL-only, refused once and
    wrapping its map; the game's wading puts no pass on a look that has no water of its own).
    The river fingerprints are re-recorded (the bed is now meshes); with the bed left out all
    four hash the same as main's. `salmons-play.mjs --rig` now expects the rig drawn dry in the
    water. Not run here: the pixel harnesses (`river-pixels.mjs` now hands a checkout its ripple)
    and the playtests, because the headless browser cannot start in this sandbox.
  - **Bundle:** the Salmons art chunk, built alone with esbuild: −3,381 B minified, −423 B gzip.

- 2026-11-27 — **Performance T5: the water a body is drawn under, in its own shaders**
  ([design/salmons-performance](../design/salmons-performance.md) §3 cause 2, §4 T5; branch
  `claude/salmons-perf-t5-shaders`, PR #1989; in review). No config, layout or flow change.
  - **What changed.** `salmonsArt/bodyShaders.ts` (new): each body's own program, Pixi's mesh (or
    graphics) program with a step doing what its pass did to its pixel — rounded to 8 bits as the
    pass's target kept it, then `ColorMatrixFilter`'s fragment line for line (the salmon) or the
    wading pass's waterline about the look's place (the bear). `looks.ts`: the salmon's rope is
    drawn by it; the glint is no longer an additive mesh but found per pixel from its own 7-point
    rope strip and added before the matrix, as it was inside the pass (so no blend change splits
    the batch). Going under or out of the water sets a uniform; nothing sets `filters`. The bear's
    picture is a quad mesh in place of its `Sprite` (Pixi's own quad bounds) and its claw a
    `Graphics` with `customShader`, both told the line by `wade.ts` (`OwnWater`): a code look
    takes no pass. A rig or a turned clip still wades through `wadeFilter.ts`, and so does a code
    look whose GPU refuses the programs (asked of the driver at mount; a salmon is then drawn
    crisp). `SpawnLayer.svelte`: the gold filter is no longer set on the container a clip or a
    code look hides (Salmons' golden salmon is its own texture: no gold pass in Salmons).
    The probe's `wading` reads `drawnUnder` and `pass` in place of `filtered`.
  - **Not done, and why.** The bed's full-screen displacement stays (one pass; resolution / MSAA
    are owner decisions, §5). The gold filter on a marked *clip* stays (other games' clips; none in
    Salmons). Root draw-list rebuilds are not lowered measurably: a body under or out of the water
    was a small share of them; the rest are the sources T4 listed (`MountedArt` re-mounts, the
    blood trail's puffs, depth reorders).
  - **Pixels** (`scripts/salmons/bodies-pixels.mjs --base <T4 worktree>`, new: ten salmon and four
    bears — under both tints, surfacing, leaping, in the sea, on a bank, red, gold, wading in and
    half under — over a seeded noise backdrop, 14 stops × 5 cases, through the back buffer as the
    game draws, each differing pixel put to the body that drew it). A salmon out of the water: 0.
    At resolution 1 without MSAA ≈ 0.07 % of pixels differ, 97 % of them by one level (8-bit
    rounding in a different order), the rest ≤ 3 on the waterline's edge, one glint cluster ≤ 11.
    Bears: ≤ 5. Two differences are the passes' own side effects; **the owner accepted both
    (2026-11-27: "Sharper is fine", "Smoother is fine")**. Side by side (before, after, the
    differences): `docs/playtest/salmons-t5/res1-swimming-salmon.png`, `res2-swimming-salmon.png`.
    1. `ColorMatrixFilter` runs at Pixi's default filter resolution, 1 (`Filter.defaultOptions`;
       the wading pass is `'inherit'`): on a resolution-2 phone every swimming salmon was drawn at
       half resolution and scaled up. Drawn by its own program it is as sharp as it is out of the
       water (≈ 2.3k px per salmon differ at resolution 2, by up to ~140).
    2. It also runs with `antialias: 'off'`: a swimming salmon's outline was not smoothed by MSAA.
       Now it is, as out of the water (10–60 px on each salmon's outline, by up to ~100).
  - **Measured** (T2's lab, `salmons-lab.mjs --runs 3`, seed 31337, 20 bots; T4's build vs this
    one; headless desktop, ~4 bodies in view): filter passes 1.8 → **1.0** (the bed's), passes
    5.7 → 4.0, target switches 7.8 → 6.0, draws 18.0 → 14.7, GL calls 126 → 133 (spread 15 %:
    each body's uniforms). The bodies harness: 8.05 → 0 filter passes a frame, root rebuilds
    0.07 → 0.05. Root rebuilds in the lab's play (a renderer hook, 2 runs each): 0.57 → 0.58.
  - **`[BindGroup] textureSource destroyed while still bound`** (seen by T3 when the ladder
    changes quality): not T5's. Fixed in #1973 (T3): `pixi-svelte` `renderQuality.ts`
    `backBufferMsaa().set` destroyed the back buffer's texture while Pixi's present shader still
    held it; it now destroys it a tick later.
  - **Gates:** `check:salmons-art` 50 → 53 (a look drawing its own water never takes the pass,
    and a refused one is drawn through it; the salmon's step carries `ColorMatrixFilter`'s
    fragment lines and the glint's alpha is packed as Pixi packs it; the bear's quad is where a
    `Sprite` puts it, trimmed or not), `check:zone-art` 132, `check:salmons-levels` 27,
    `check:room-levels` 16, svelte-check `engine-layout` at baseline (290).
  - **Played** on the branch's arcade build, alone on the machine: `salmons-play.mjs` 103/103 (the
    code-look bear wades with no pass, the rig through it), `--trees`, `salmons-river-tour.mjs`
    seeds 1 and 4, `salmons-levels-play.mjs`: all pass.
  - **Bundles** (`check:runtime-bytes`, re-recorded on Linux): all five move — `SpawnLayer` ships
    in every runtime, the Salmons art chunk in arcade and arcade3d. Against main f4f8484 (T4 merged), in gzip: `lines` 0 B (its hashes move), `match3` +8 B,
    `card` +12 B (the gold line), `arcade` +3,244 B and `arcade3d` +3,260 B, almost all in the
    lazy Salmons art chunk (the programs' GLSL).
  - **Reviewed** (`code-reviewer`): fixed a trimmed bear texture's UVs (`quadOf`: Pixi's
    `textureMatrix` takes UVs over the untrimmed rect), the bear's quad geometry never destroyed,
    the glint's alpha without its ancestors', two glint point counts, the three programs linked
    together; the playtest doc reads the probe's `drawnUnder` / `pass`.

- 2026-11-27 — **Performance T4: the river in chunks** ([design/salmons-performance](../design/salmons-performance.md)
  §4 T4; branch `claude/salmons-perf-t4-river`; in review). Pixel-identical; no config, layout or
  flow change.
  - **What changed.** `salmonsArt/river.ts`: the ground's ~38k–47k tiles are laid in chunks of
    8 × 8 cells, made the first time they near the view (a ring ahead is made 1,500 tiles a frame)
    and shown or hidden whole when one meets the view's ground box or stops meeting it (8 against
    4: 4 drew 15 % fewer vertices for ~15 % more JS and twice the rebuilds); tiles that overlap in
    area keep the order they were laid in (`chunkFor`), every `random()` / `forestRandom()` draw is
    made as before. The ground is one render group, so a camera move is one transform; the
    riverbed's ripple is on a container of its own whose area is measured over the bed's tiles in
    view as when each was culled on its own, through the same chain of transforms to the same
    floats (`rippled.getFastGlobalBounds`, `rippleBy`). The
    displacement map is not drawn (`renderable = false`: the filter reads only its transform). The
    upright pieces cull by a box rounded to 256 px, and what animates in them moves only while the
    view holds it, as before. The pieces among the players join and leave the spawn layer exactly
    when they did (their ties keep their order), looked up on a 256 px grid instead of all ~10k
    every moved frame. `depthOrder.ts` + `ProjectedInstance.svelte`: a projected spawn layer sorts
    only when a body's depth changes the order (each sort is given every depth first, so ties
    resolve as before).
  - **Not done, and why.** No render group for the upright pieces, the cliffs or the reflections:
    drawn relative to a group a world wide, their see-through layers (the waterfalls' splashes)
    rounded up to 5 levels differently on the GPU; they are ~1.2k pieces, moved cheaply.
    No river kept across rooms: every room plays a new seed (Salmons' levels pin none), rounds are
    new rooms, and nothing re-keys the river inside one, so its inputs always change; the lazy
    chunks cut what a switch makes and destroys instead. No baking (owner decision §5).
  - **Measured** with T2's lab (`salmons-lab.mjs --runs 2 --compare` its baseline of main 665b407;
    seed 31337, 20 bots, the original level; counters compare, headless timings only roughly): the
    mount frame makes 6,369 objects (main 39,681); per play frame JS 4.6 ms (21), render 2.5 ms
    (15.7), tick 4.0 ms (20.1); the mount's JS 182 ms (381); frames in the minute 300 (168). Higher:
    vertices 36.1k (26.3k: whole chunks past the view's edge, off screen), draws 19.1 (14.4), GL
    calls 130 (110), objects made a frame 19.7 (0.5: chunks made ahead as the camera moves).
    `invalidations` stays 1: it counts `invalidateFramebuffer` (the back buffer's), not draw-list
    rebuilds. Draw lists, traced in a scratch harness on seed 7 of `SALMONS_LEVELS` (the
    camera 4 px a frame): the ground's is rebuilt only when a chunk comes or goes (0.075 a frame);
    the root's is still rebuilt about once a frame, by other parts: a code look's `MountedArt`
    re-mounting, a salmon look's `filters` set on and off (T5), the blood trail's puffs, real
    depth reorders.
  - **Proof of pixels.** `scripts/salmons/river-pixels.mjs --base <main worktree>` (new): the river
    of this checkout and of main drawn by WebGL with the built-in art, the camera walked along it a
    frame at a time, compared at 9 stops × 6 cases (seeds 1, 7, 42, 123; original, levels,
    waterfalls 5–10, authored biomes; mirrored and plain; MSAA on and off; resolution 1 and 2;
    zoom 0.75–2; one with the camera on whole pixels): 0 pixels differ in 54 shots. The art fingerprint (`salmons/art-fingerprint.mjs`)
    now hashes what is drawn and in which order (pieces that overlap keep theirs), not the
    containers; its four hashes are recorded of main 665b407's river and are this one's.
  - **Gates:** `check:salmons-art` 49 → 50 (the depth order played against a zIndex set every
    frame: the same order every frame, every zIndex its depth whenever a draw list is built, a
    sort on 625 frames of 3,000 instead of 2,948),
    `check:zone-art` 130, `check:salmons-levels` 27, `check:room-levels` 16,
    `check:agents-knowledge`, svelte-check `engine-layout` at baseline (290).
  - **Played** on the branch's arcade build, alone on the machine: `salmons-play.mjs` 103/103 (main
    103/103; a first run beside five runtime builds failed one colour read, not again),
    `--trees` 4/4, `--zone-rig` 4/4, `salmons-river-tour.mjs` seeds 1 and 4 (seed 4's climb also
    alone, 4/4 on branch and main), `salmons-levels-play.mjs` 57/57.
  - **Bundles** (`check:runtime-bytes`, re-recorded on Linux, all five, against main 88e4409):
    `lines` +299 B, `match3` +316 B, `card` +268 B gzip (`SpawnLayer` ships in every runtime; its
    projected branch runs only on an iso world screen), `arcade` +2,184 B and `arcade3d` +2,185 B
    (the same plus the lazy Salmons art chunk).
  - **Reviewed** (`code-reviewer`): fixed a stale zIndex the underwater layer (`blood.ts` `sunk`)
    could sort by when the players' layer was already due a sort, and a one-pixel rounding of the
    ripple's edge with the camera on whole pixels (now measured exactly as before).

- 2026-11-27 — **Salmons lab run (performance T2; in review; branch `claude/salmons-perf-t2-lab`;
  scripts and docs only, no game code)**: `scripts/playtest/salmons-lab.mjs` plays Salmons' room on
  the real frame clock with `?perf=1` — a local game server, the export's config on the original
  level pinned to one seed, a test room of 21 (20 bots), a salmon that joins, waits for `running`
  and the level mount, presses Reset, plays a scripted 60 s input loop and takes the reading
  (`lab-sequence.mjs` `playArcadeLabSequence`, with `LAB_WS_HOOK` for socket bytes by protocol
  code). `--runs n` reports the spread, `--compare` marks counters outside the committed baseline
  (`scripts/playtest/fixtures/salmons-lab-baseline.json`: five runs on `main` at `665b407`); the
  **Profiler lab run** workflow runs it on demand (`salmons`). Noise floor, five runs, play per frame:
  draws 14.0–14.6, passes 5.1–5.6, filter passes 1.6–1.8, `invalidations` 1 (every frame), GL calls
  108–114, vertices 25.4k–26.8k; the mount frame creates 39 660 objects (39 448 sprites, 150
  graphics, 52 meshes) every run; socket in 21 msg/s and 0.7–0.8 KB/s, out 8 msg/s and 67 B/s in a
  room of 21. Headless is ~3 fps (SwiftShader): counters compare, timings do not. Table and
  commands: [playtest/salmons](../playtest/salmons.md) "The lab run". Found on the way: the river is
  not drawn until a tap passes the start screen (a lab that only waits for `running` plays an empty
  field), and `lab-run.mjs` cannot play it (its published-game URL joins the live game server).
  **Not verified:** the workflow job on GitHub's runner (it was never run there); the numbers on a
  device.

- 2026-11-27 — **Performance, T1: the Invisible Profiler can now say why an arcade game is slow**
  (branch `claude/salmons-perf-t1-probe`, in review; plan `docs/design/salmons-performance.md` §2 and
  track T1; the detail is in [status/profiler](profiler.md) "P10"). Reports `perf: 10`: busy time per
  phase against the display's frame (judged instead of fps for an arcade game), hidden / throttled
  time (a throttled reading is marked, not comparable), `lobby` / `loading` / `play` / `spectate`
  with the room's phase as the spike state, a p95 per counter, a scene sample (nodes, drawn, culled,
  draws / passes per render-group layer), GPU time where offered, and the room's bytes by kind with
  sends per step. Probe and launcher only: no game looks or plays differently, no Game Config
  value changed. The next Salmons readings should use the capture protocol of the plan §6 and be
  read as busy ms against 16.7, not fps.

- 2026-11-26 — **The players line pops on a phone too**: #1937's fit capped the river line at the
  room it has, so on a canvas too narrow for it (the phones it was for) the "players rose" pop was
  gone. The line now rests at `room / 1.15` there (including canvases that only just fit it), so the whole pop fits inside the margins
  (`riverLineScale`, `MENU.popGrow`; the start menu's pop reads the same value). Guard:
  `check:salmons-art` "the lobby's players line pops inside the margins on a narrow canvas".

- 2026-11-26 — **The lobby's lines fit a phone, and "1 player"**: on an iPhone 16 Pro Max
  (BrowserStack Live) "1 players in Drunken Bear River" ran off both sides in the pixel font (the
  playtests measured the fallback monospace). The river line and the "You are …" line now shrink
  to the canvas like the class row (`createLobbyNote`), and `riverRows` says "player" for one, in
  the lobby and the start menu. Playtest patterns follow. The same report fixed the page sliding
  under iOS Safari's toolbar (profiler status). Not yet seen on the real phone.

- 2026-11-26 — **The whole lobby clock, and the next game by itself** (owner: "have the all
  countdown showing up, and just blink in red with a pulse the last 10 seconds"; "yes, it should
  starts automatically"; branch `claude/upbeat-cray-fzmgxe`; in review). `onlineRules.js`
  (`endsAt` from the lobby's first person), `schema.ts` (the field's comment only),
  `salmonsArt/screens.ts` (`createLobbyClock` in place of `sm-countdown-seconds`),
  `salmonsScreens.ts` (`SALMONS_SCREEN_ART.clock`, `SALMONS_CLOCK_URGENT`),
  `salmonsArt/winAnimation.ts` (the count, `NEXT_GAME_SECONDS`, the page's visibility, the probe's
  `next` / `count` / `boxes`), `online.ts` (`Session.played`, the clock fed from the state, the
  probe's `played`). No config, layout, flow or `normalizeGameConfigDoc` change. Gates:
  `check:room-lobby` 35 → 42; unmoved: `check:room-sim` 43, `check:room-bots` 56,
  `check:room-size` 20, `check:online-rules` 40, `check:room-levels` 15, `check:netcode` 28,
  `check:salmons-art` 34, `check:salmons-levels` 18, `check:room-sim-3d` 23, launcher
  `check:room-flow` 2. Playtests on one arcade build, both netcodes: `salmons-rejoin-play.mjs` 58 / 58,
  `salmons-levels-play.mjs` 57 / 57, `salmons-play.mjs` 103 / 103 (`engine` and `colyseus` each;
  the first `colyseus` run of `salmons-play.mjs` failed "…the room's `golden` reached page G's
  flow", which this change does not touch, and passed on the re-run). Looked at:
  `win-count-landscape.png`, `win-count-portrait.png`, `win-idle.png`, `lobby-waiting.png`
  (white "136"), `lobby-clock-red.png` (red "4"). Two playtest traps found on the way: from the
  win screen's press the probe has no session, so what the screen shows then is read off the
  stage (with the join sent 1.5 s late); and a page stepped faster than the clock sends inputs
  faster than the room's message limit (twice the tick rate) and is disconnected (`4002`), so
  long waits are stepped no faster than the clock.
- 2026-11-26 — **Every generator setting and authored biomes** (owner; in review; branch
  `claude/salmons-authored-generator-biomes`). `engine-mechanics`: `salmonsMap.js`
  `SALMONS_GENERATOR` / `_LIMITS` / `_WHOLE` / `_PAIRS`, `generatorParams`, `biomeOrphans`, every
  generator function reading `shape.generator`; new `salmonsBiomes.js` (`resolveBiomes`,
  `biomeAt`, `biomeStretches`, the built-in six); `salmons.js` takes the river's length off the
  river. `game-config` `levelsShape.ts`: `generator` and `biomes` carried, normalized and
  validated. `engine-layout`: `salmonsArt/river.ts` draws by biome (new `engine-mechanics`
  dependency), `salmonsRiver.ts` marks stretches. `/editor`: `EditorLevelGenerator.svelte`,
  `EditorLevelBiomes.svelte`, `LevelParamField.svelte`; `IconButton` gains `up` / `down`. Gates
  as in Current state; `scripts/salmons/art-fingerprint.mjs` new.
- 2026-11-26 — **Browser check of the published link** (cloud deploy session): start menu, joins
  as all three classes, bot catches, the win and the room's lock all seen live; a person's own
  catch and respawn not reached before a bot won (Current state, "Live check").

- 2026-11-25 — **Join New Game stays on the page** (owner: "I would expect to be in a room
  already"; in review). The win screen's button no longer loads the page again: the device joins
  the new room first, and one task swaps the old room for it in the mounted game, the flow
  brought back to its start, with the art coming under the new room's lobby. Arcade code only:
  `online.ts` (`joinOnlineRoom` split into the launch and `enterRoom`; `switchRoom`,
  `closeSession`, `showRoom`, `keepNextJoin` / `dropNextJoin`; a session's `quit`, `closed`,
  `unlisten`; the camera's world from the session) and `salmonsArt/winAnimation.ts` (the button
  asks at once). `Game.svelte`, `editor-scenes.ts` and the flow interpreter are untouched, so
  the slot, match-3 and card runtimes are the same bytes. New playtest `salmons-rejoin-play.mjs` (38 verdicts a netcode, with the
  timings and what the page holds after each switch); `salmons-play.mjs` page W's verdict
  rewritten; the source pins of `check:room-lobby`, `check:netcode` and `check:room-levels`
  moved with the code. No game-server, config, layout or flow change; `normalizeGameConfigDoc`
  untouched. Detail, numbers and what was not verified in Current state.
  - **After a code review, the same day.** The unhappy paths left the page frozen on the win
    screen: a join that never answered had no timeout, a throw in the swap was an unhandled
    rejection, the error screen a failed switch ended on is drawn only on a `?runtime=1` boot,
    and art that failed for the new room left a room with no screens. Every failure of a switch
    now goes through one place that keeps the join and loads the page again (`failSwitch`),
    with a 12 s limit on getting into the new room, and the win screen's button reads
    "Joining…" meanwhile. The flow's restart moved to `game/roomFlow.ts` and is right for a
    flow other than the seed (a chain released by its screen's hide is outlived, the mode stack
    is reset, the start-up event is picked as a boot picks it), held by the new launcher gate
    `check:room-flow`. Smaller: the first frame of the new room is drawn from its own place;
    the kept join is dropped the moment the device is in; a first boot's camera world is the
    layout's again; a room lost while it is joined in another's place no longer clears the old
    picture's marks, and a boot's join no longer reaches the error screen twice for one lost
    room; a held movement key is still forgotten at the swap (pressed again, it steers).
    `salmons-rejoin-play.mjs` 38 → 43 (four failing switches in place of one, the first frame's
    camera), and `--baked` plays it on a boot with no `runtime=1`.
- 2026-11-25 — **A class picked in the lobby** (owner: "add some UI to the waiting room so that a
  player can change the played character"; branch `claude/upbeat-cray-fzmgxe`; in review). Under
  the lobby's note, Salmon / Fisherman / Bear: a press changes the class in place, through the
  room, by the Respawn's rule. `roomSim.ts` (`picked`, `respawnAs` answers, `SimPlayer.refused`),
  `onlineRules.js` (`picking`; `refused` keeps no note), `schema.ts` and `arcadeRoom.ts` (the
  state's `picking`), `online.js` (`createRespawnAsk`), `online.ts` (the ask, its answer off the
  state, the press's `down` kept from the pointer, the instance spawned again on a class change;
  the probe's `ask` and `buttons`), `salmonsArt/screens.ts` (the row, the refusal, `takes`), the
  Flow descriptions of `respawned` and `respawnRefused`. Detail and proof in Current state; the
  merge's deploy closes running rooms: Owner steps.
  - **After a code review, the same day.** (1) A lobby pick left the device's spawned instance
    as the old class's component: a class change now despawns it and the frame spawns the new
    one (two playtest verdicts on `online.spawned`, a third reads it on the phone; a build
    without the despawn fails all three). (2) and (3) One answer a press: the room no longer
    tests a refused run's place again (an input still on its way was let in behind a refusal
    the device showed), every press is a run of its own (one input asking for nothing first when
    the last asked the same), and the death screen's Respawn reads its answer off the state as
    the lobby's pick does, so a Respawn pressed again as its refusal arrived is answered and
    nothing is asked for ever. (4) `takes` asks Pixi's own hit test (a press on a button's
    4 px rim picked and was a tap too). (5) Wordings here, in the design and in the playbook.
    `check:room-lobby` 16 → 35; `salmons-levels-play.mjs` 41 → 54.
- 2026-11-25 — **A smooth turn's cross-fade fades on a rig** (bug found with the wading; branch
  `claude/laughing-ritchie-jj9vuc`, #1905; in review). `sheetRigLook.ts`
  flattened a fading `RigView` with an `AlphaFilter` that Pixi sized by its fast measure, which
  finds nothing in a rig, so every pass was skipped and both pictures were drawn at full
  strength until the blend ended (since #1895). The fading view now carries a `filterArea`:
  its local bounds each frame, 25 % of the longer side as a margin (8 px at least), the rig's
  box if it measures empty; cleared when it is opaque again. `check:character-turn` 113 → 115:
  every fading view's pass, read as Pixi reads it, must have a size and hold the pose drawn (red
  on the unfixed look: "a pass of no size is skipped"), an opaque one has none, and two
  mutations (no `filterArea`; a pass that cuts the pose). Looked at with
  `character-turn-strip.mjs`: only `iso-rig-blend` changes, from a cut with both pictures solid
  to a fade of two whole pictures; the eleven other strips, the bear as saved among them, are
  the same bytes. Only a sheet that sets **Blend (ms)** draws differently; the bear sets none.

- 2026-11-25 — **A device plays its room's levels** (owner: "changing the seed generates a new
  level, but does not update collisions"; branch `claude/zealous-darwin-t8xiyc`; in review). The
  room's state says the levels its generator read and a fingerprint of its level; the device
  makes its level from them, an authoring boot is told what differs, and a level it cannot make
  is refused (`check:room-levels` 15, `salmons-room-levels-play.mjs` 29). Detail and proof in
  Current state; the merge's deploy closes running rooms: Owner steps.

- 2026-11-25 — **The bear wades** (owner request; branch `claude/dazzling-dijkstra-66rrze`; in
  review; what it is, its numbers and its proof in Current state). New in
  `engine-layout` `salmonsArt/`: `wade.ts` (who wades, the waterline, the eased depth, one mount
  a player and a look), `wadeFilter.ts` (the pass), `water.ts` (`waterUnder`, `TINT_ALPHA` and
  the tints, moved out of `river.ts` unchanged so the gate asks the river the question the
  runtime asks). The kit gains `wade`, `wadersDrawn` and the probe's `wading`; `online.ts`
  `drawCodeLooks` wraps the two mounts it publishes and lets go of players no longer drawn;
  `pixi-svelte/elementFx` exports `FILTER_VERTEX` and `programLinks`. `check:salmons-art` 22 →
  33; `salmons-play.mjs` gains pages WB and WF on the original's level (94 → 101 verdicts) and,
  under `--rig`, page W, a bear a rig draws (15 → 19). Two things found on the way: Pixi skips
  a filter on a rig (the wading sets a `filterArea`; a blended turn's fade is still skipped,
  Open items), and Pixi compiles a filter's fragment for WebGL 1 where there is no WebGL 2, so
  the first cut's `fwidth` did not compile in the playtest's browser and the bear was drawn dry
  (the driver check caught it; the pass now uses nothing WebGL 1 lacks). After a code review,
  the same day: the pass takes the screen's smoothing, its program is asked for as the river
  mounts, the gate pins the fragment's own sums (four mutations of them had passed it), page
  WB's under-water pixels are compared with the same water before the bear stood in it (the
  riverbed's sand had passed for fur), and the sprite guide says a bear of plain clips does not
  wade. Merged with `main` after #1902: `lines`, `match3` and `card` the same bytes, the two
  arcade manifests re-recorded, the playtests replayed (101 and 19, both netcodes).

- 2026-11-24 — **The exported config drops its level** (owner decision; branch
  `claude/affectionate-bell-mwyn5r`): no `arcade.zones` and no `arcade.online.rules.zones`,
  655,474 → 16,342 bytes, every room's game unchanged (`check:salmons-export`). Detail and proof in
  Current state; the upload and publish are Owner steps.

- 2026-11-24 — **A winding river and tall waterfalls, from the config** (owner, 2026-11-24; branch
  `claude/salmons-river-turns`; in review; detail in Current state and
  [design/salmons-levels §5](../design/salmons-levels.md)). `engine-mechanics` `salmonsMap.js`
  (`riverCourse`, `levelShape`, `courseFacts`), `salmons.js` `SALMONS_LEVELS`; `game-config`
  `levelsShape.ts` (carried, not normalized); game server `configSource.ts` and the device's
  `online.ts` read the shape off the raw config; `/editor` Generated level card; the export ships
  it. New: `check:salmons-course`, `scripts/salmons/river-overview.mjs`,
  `scripts/playtest/salmons-river-tour.mjs`; `measure-room.mjs` measures the shipped levels
  (`--original` for the old). Two bugs found on the way: the first attempt changed the shared
  normalizer and moved the slot, match-3 and card runtimes (+308 to +383 B gzip; caught by
  `check:runtime-bytes`, moved to a carried module), and a bank spawn could land in the water on a
  slanted reach (caught by the new gate). Not in CI: the root Salmons gates are run by hand, as
  before.
  After #1896 (the slide) merged: a held move sticks no more often on the winding river than on
  the original's with the slide on (four seeds, 132 places from mid-water, held 4 s, stuck = under
  half a cell in two of the last three seconds: straight upstream 21 against 38, the screen's Up
  31 against 37, its Left 26 against 29; with the slide off 72, 39 and 42). The project upload
  gained `fields` (only named paths of the config), since the whole upload deletes tool-authored
  sheets.

- 2026-11-24 — **Slide** (branch `claude/salmons-collision-slide`; in review; Current state has
  what it is).
  - **Where players stuck, before** (a simulated room of the shipped level, four seeds, a held
    move, stuck = under half a cell in a second): a salmon up or diagonally along a bank in 185 to
    187 of 284 places; under a rock 94 of 94; a bear or a fisherman diagonally at the bank limit
    about 157 of 328; a fisherman along the water's edge 167 of 328; a bear at the end of a
    waterfall's block 24 of 24. **After:** 1 and 11 of 284 (the 11 are diagonal pushes into the
    delta's bank, which faces them), at most 3 of 94 under a rock, 3 of 328, 8 of 328, 0 of 24.
    What still stops a salmon is meant to: a waterfall's foot, sand, a whirlpool.
  - **Played in a browser** (`scripts/playtest/salmons-slide-play.mjs`, a real local game server,
    level 31337, both netcodes): off, 12 of 14 bank and rock cases stick; on, none (a salmon on a
    bank 257 to 355 px in 3 s where it made 50 to 72; under a rock 566 to 636 where it made 70; a
    bear at the limit 318 where it made 3). The own player's predictor: 0 corrections and 0 snaps
    over every hold, drawn 0 px off the room's path. Nobody passed a waterfall's line, the water
    (fisherman), the bank limit or the field. Not played: a bad network, a phone, the band river.
  - **Bots** (rooms of 10 / 30 / 100, 24 rooms each): share of time stalled, fishermen 12.7 / 13.0 /
    14.9 % → 4.3 / 4.8 / 5.2 % (longest 56 s → 11 s at 100), bears 6.3 / 4.7 / 4.6 % → 2.6 / 2.4 /
    2.4 %, bot salmon unchanged (about 1 %). Wins, game length and bot salmon on the river did
    not move.
  - **How it picks a way** (`motion.js` `roundCorner`): a push straight in rounds the nearer end;
    a push that leans towards an open end slides there; one that leans into a dead end follows
    the longer free way from the solid's end, y on a tie, so a body never rounds one corner both
    ways in turn. Lengths, not speeds: a current must not turn a body back down a bank. A drift
    under 0.35 of the push (`SLIDE_LEAN`) neither picks the way nor is itself carried round.
    One-way solids are filtered by the caller as before, a way round that leaves the field is
    refused, and a step longer than half the body is taken in parts.
  - **Gates:** `check:arcade-slide` 17 (off = `stepSolid`'s digest on `main`; a flat wall; a wall
    ahead; stairs 48/48 to 48/144; corner distance; a round prop; a drift; a post in the way;
    large steps; seeded scenes, also for a body turning back and forth; Salmons' levels off
    against on; nothing passed; a predictor follows the room to the bit; the config's carry).
    24 of 25 mutations fail it (the other removes an early return that changes no outcome). No
    trace fixture re-recorded (the band river plays without it). `check:salmons-levels` 18, two
    checks rewritten: a bear pushed straight at the bank limit rests on the tightest limit of the
    bands it stands in (it may end a step along the limit); the fisherman's "the water stops
    him" starts 7 cells from the bridge, and 3 cells off he is checked every step never to be in
    the water. Launcher: `check:game-config-family` 518, `check:salmons-export` 20 (the exported
    config carries the slide).
  - **Review** (`code-reviewer`): a diagonal push along a long face stopped short of a wall ahead
    and trod back and forth (the dead end was measured from the body, so the answer changed as
    it moved); now measured from the solid's end. A step is taken in at most 64 parts.
  - **Runtimes:** `lines`, `match3` and `card` byte for byte; `arcade` and `arcade3d` re-recorded.

- 2026-11-24 — **The fisherman holds his catch, then throws it; blood on top of the water**
  (owner request, 2026-11-24; branch `claude/salmons-fisherman-throw`; in review;
  engine-mechanics, game server, game-config, `/config` and the runtime; nothing uploaded or
  published: Owner steps).
  - **Before.** A salmon the line landed was out at the landing, and its stain was where it was
    hooked. The blood looked as if it were under the water.
  - **The rule** (`salmonsRules.js` `fishingLine`, "CARRY"; statuses `held: 5`, `thrown: 6` in
    `abilities.js`; the synced `heldBy`, the last of `schema.ts` `playerFields`). A landed
    salmon is held in the fisherman's hands, alive, on his place; nobody else can hook or hit
    it. His next press throws it to the aim; it flies in an arc, lands, and only there is it
    out, scored and stained. A round's end frees a held or thrown player (`onlineRules.js`). A
    bot's rules play may carry an aim (`onlineBots.js`), so a bot fisherman throws (`BOT_THROW`:
    after 600–1600 ms, at the nearest known salmon within the throw, else water 3 cells away,
    else 1.5 cells beside him).
  - **Carried, not normalized.** `carry` and `rules.stains` live in `game-config`
    `onlineCarry.ts`, as the touch schemes do: `normalizeGameConfigDoc` drops them (the slot,
    match-3 and card runtimes keep the normalizer and stay the same bytes), the launcher's load
    and save and Salmons' export put them back (`withOnlineCarry`), and the game server reads the
    carry off the published doc (`configSource.ts`, `onlineGameWithCarry`). A first cut put them
    in the normalizer and moved `lines`, `match3` and `card` by about 470 B gzip each;
    `check:runtime-bytes` caught it.
  - **General.** The capability is any `hook` ability's `carry` under a line module
    (`fishingLine` or `salmons`). Salmons only turns it on (`salmons.js`, `carry: {}`) and draws
    it (`salmonsArt/looks.ts` `CARRIED`, `LookFrame.carried`).
  - **Config** (`game-config` `family.ts`, `familyValidate.ts`):
    `arcade.online.rules.abilities[].carry` `{ holdMs?, throwPx?, flightMs?, walk? }`, defaults
    4000 / 384 / 600 / true; a room holds them to 500–60000 ms, 1–2000 px and 100–5000 ms. No
    `carry`: the old behaviour, so a config published before this plays as before.
    `arcade.online.rules.stains` `{ opacity?, trailOpacity? }`, 0.3 / 0.3, each 0–1; the device
    reads it, the room does not. Edited in Game Config's Online rules (`OnlineSection.svelte`,
    `onlineDoc.ts`).
  - **Decisions.** The furthest throw is 8 cells (384 px); a click beyond lands at 8 cells in
    that direction, held to the field. Held 4 s, then dropped at his feet. The holder walks at
    normal speed (the config can pin him). No cast while holding. A press in the first 350 ms
    after the catch throws nothing (`CARRY.gripMs`). With no aim (a key) it is thrown the full
    reach along his last move. The holder leaves, drops his connection or is caught: it is
    dropped and dies, scored to him if he is still in the room. Round end: let go alive.
  - **Events** (`onlineFlow.js`, `engine-flow-v2` `reference/arcade.ts`): `held` (`x`, `y` the
    holder's), `thrown` (`x`, `y` where it will land), `landed` (`x`, `y`, `dropped`), then the
    existing `caught` (effect `hook`) at the death. Sheet `event` triggers hear them as user
    (`by`) or target; sheet `status` triggers get `carrying`, `held`, `thrown` (`online.ts`
    `statusesOf`; suggested in `/characters`).
  - **The device** (`apps/lines` `online.ts`). A held player is drawn at its holder's place, in
    his hands (`carriedPlace`, `handsOf`: his hand point from `standOf`, else 3/4 up his body; a
    clip, a sheet or the placeholder is raised whole, a code look places itself). The held
    player reads "<holder> has you!", the holder "tap to throw it!". Touch: with a catch in hand
    any tap is a target (`onTouchTarget`, `carries`); a held finger still walks. The camera
    follows the own player through the throw (no change: it follows the own place).
  - **Why the blood looked under the water** (`salmonsArt/blood.ts`). Nothing was layered under
    the water. The kit copied the old client's underwater layer on purpose: it mixed the
    water's tint into the stain's colour (`underTintColour`, removed) and drew the trail beneath
    the swimming salmon. **Now**: own colours (0xd01018 over 0x8a0f12), mounted bottom to top
    `sunk` (a salmon under the surface), `wake` (the trail), `surface` (the pools), all after
    the water's tint and before what stands on the water (`index.ts` `aboveWater`), at the
    opacity of `rules.stains` (`bloodOpacity`).
  - **Proof.** New `pnpm check:salmons-throw` (`scripts/check-salmons-throw.mjs`) 21;
    `check:salmons-art` 22 (its blood checks updated); `check:online-rules` 40, the `line` trace
    re-recorded (`fixtures/salmons-traces.json`; only `line` moved). New play script
    `scripts/playtest/salmons-throw-play.mjs`: five rooms (`throw-water`, `throw-land`,
    `throw-drop`, `throw-leave`, `throw-phone`), screenshots at 2×.
  - **Seen playing** (2026-11-24, headless Chromium, two pages a room). The held salmon is drawn
    over the fisherman's circle on both pages. It tumbles in the air. The salmon's page shows
    "You have been caught by Hal", as before. One pool at the landing place, none at the catch.
  - **What still looks off.** On blue water a 0.3 pool reads as a dim violet-red patch
    (overlapping trail puffs read redder); on grass it reads brownish. A pool dropped at his
    feet is hidden under him until he walks off. The fisherman is still the placeholder tan
    circle: there is no hold or throw art.
  - **Live game.** The game server deploys on the merge and the drawing arrives with the runtime
    release; the hold needs Salmons re-exported and re-published. Before that the live game
    keeps the old catch and gets the new blood drawing (Owner steps).
  - **Not verified.** No real phone (Chromium's touch emulation only). The live game was not
    played.

- 2026-11-24 — **A desktop build's card joins its room** (`docs/status/launcher.md`): the launcher
  adds `rooms_url` and `rooms_game` to an online project's card when it hands the link out, and
  the runtime's screen for a launch with no `rooms_url` says it has no game server address
  (arcade and arcade3d runtimes move: +368 B and +191 B gzip in the bundle; the slot, match-3 and
  card runtimes are byte for byte).

- 2026-11-22 — **Live check after the rebuild's deploy** (cloud deploy session): game server and
  arcade runtime on `ceaeb16`, the project's documents current (dry run, run 45062773205), the view
  cap on in a new room; Default environment now allows `rooms.invisiblewall.org` for these checks.
  Browser checks of the published link still to do (Current state).

- 2026-11-21 — **A held finger keeps steering on a phone; touch schemes per online class**
  (owner, 2026-11-21, first play on a phone: "The tap movement is different than the original.
  The hold should make the player always go in that direction. Right now it seems to stop.";
  branch `claude/touch-controls`; in review;
  [design/arcade-touch-controls](../design/arcade-touch-controls.md); runtime, engine-mechanics,
  game-config, `/config` and `/characters`; no game-server change; nothing uploaded or
  published: Owner steps).
  - **Cause.** The canvas's `touch-action: auto` (`pixi-svelte` `InitialiseApplication.svelte`,
    there so a slot's page scrolls under a finger) let the browser cancel a moving finger with
    `pointercancel`, so a hold stopped. A finger held perfectly still steered, so a headless
    test that holds a finger still never sees it. Reproduced on a 390 × 844 phone window with
    `scripts/playtest/salmons-touch-play.mjs --repro` on a runtime built before the change.
  - **Fix.** `online.ts` `listenPointer` sets the canvas to `touch-action: none` while it
    listens and puts it back when it stops; a slot's canvas is untouched. The button keys go
    through a latch (`touchControl.js` `createPressLatch`), which closes the lost 33 ms key tap
    (Open items).
  - **Schemes.** `arcade.online.touch` in Game Config: named schemes, one named per online class,
    played on the device by `engine-mechanics` `touchControl.js`; the room never reads it.
    Salmons: `swim` (salmon: a hold steers; a tap leaps towards the point and keeps heading
    there) and `walk` (bear and fisherman: a hold steers, a tap acts). What differs from the
    original on purpose: design doc §6. Edited in `/config` (Mouse and touch); picked per class
    there and on `/characters`' Online class card.
  - **Proof.** `check:arcade-touch` 50, `check:arcade-pointer` 22, `check:netcode` 28,
    `check:room-sim` 43, `check:online-rules` 40 (no committed trace moved),
    `check:salmons-jump` 37, `check:salmons-art` 23, `check:character-sheet` 90; launcher
    `check:game-config-family` 501, `check:characters-tool` 1244,
    `check:config-character-sheets` 301, `check:salmons-export` 18. `salmons-touch-play.mjs`
    25 / 25 in each netcode.
  - **Not verified.** No real phone was used (Chromium's touch emulation only). The live game
    was not played. What is left: design doc §8.

- 2026-11-21 — **A bot salmon at the source wins the game** (owner, 2026-11-21: "of course a
  salmon bot can win", overruling PR #1850's "a bot at the source never ends a people's game";
  branch `claude/salmons-bot-wins`; game server and engine-mechanics; nothing uploaded or
  published: Owner steps). Salmons' config: `bots.canWin: true`. The `botGoal` hook, its `home`
  event and `BOT_SWIM.homeMs` are removed (Salmons was their only user). A bot's win is a
  person's: `roundEnd` and `gameWon` with the bot's id and name, the room locks and closes; every
  device shows "Bot N won!!!" (pink fish, no eggs), none "You Won!". No winner's pass is minted
  for it (`arcadeRoom.ts` `won`: a bot is no device's, and the guard is now explicit), so no
  golden salmon comes of it. People's rules are untouched; every other game's bots still cannot
  win by default.
  - **Bots' names** (owner, the same day, built in the same branch: Current state). In a room of
    100 drawn from seed 7, the first 20 of each class: salmon "Brook Bailey, Finnegan Leap, Jack
    Jumper, Sockeye Sally, Spray Daisy, Professor Gills, Rapid Rita, Redd Riley, Eddy Swirl,
    Ripple Rosie, Hopscotch Hal, Upriver Ula, Pinksalmon Pam, Spawnie Shawn, Leapin' Lena,
    Bubbles McFin, Upstream Ulysses, Tailwind Tina, Nimble Nell, Gravel Gus"; fishermen "Reel
    Ray, Trolling Trudy, Wader Wade, Bucket Bill, Patient Pat, Drift Della, Rod Rodney, Spinner
    Sid, Tackle Ted, Nibble Nora, Hook Line Harry, Old Salty, Net Nancy, Marshall Mudboots,
    Sinker Sam, Hooky Hank, Waiting Walter, Snag Sinclair, Feather Fay, Lure Laura"; bears (15
    in the room, the list's next 5 after them) "Grumbles, Sir Snoozes, Teddy Swipe, Rumbletum,
    Papa Bruin, Claw-dia, Pawsome Pete, Grizzly Gus, Hibernia, Clawdette, Bruin Bruno, Fluffy
    Fernando, Snoutsworth, Berry Bear, Bramble, Honey Paws, Kodiak Kat, Big Paw Paula,
    Snuffles, Napsalot". New gate `check:bot-names` (7), each check failed by a mutation: the
    normalizer keeps a list (trimmed, none empty, too long or twice; 500 at most); Salmons'
    lists are longer than their places, fit, have no "bot" and are carried by the config; a room
    of 100 (12 seeds, the person as each class) has one name each and every bot's from its
    class's list; a room's names replay from its seed and another seed draws others; a person
    keeps the name it typed and the bot that held it is renamed; past a list's end names take a
    number and still fit 24; a game with no list keeps "Bot N". `check:room-size` gains a live
    check that a device sees the bot renamed when a person joins with its name (it fails when
    `syncPlayers` does not follow a rename).
  - **Runtime bytes: all five move** (`check:runtime-bytes`, manifests re-recorded on Linux).
    The names are a field the config normalizer keeps, and every runtime carries the normalizer
    (`game-config`), so each bundle grows a little: lines +95 B, card +95 B, arcade +122 B,
    match3 +131 B, arcade3d +171 B (gzip); a few shared chunks are re-hashed by a byte or two.
    Their games play as before: a device never reads a bot's list (names reach it in the room's
    state). The merge therefore releases all five runtimes. The bot's win alone moved none.
  - **How long a game lasts** (`scripts/salmons/measure-room.mjs`, extended: one game a room
    played to the first salmon at the source, bot or person; the person presses Respawn 3 s
    after a catch; 24 seeded rooms, seeds 1–24, the original's levels):

    | Room | Person's salmon | Person wins | A bot wins | Median | Shortest | Longest |
    | --- | --- | --- | --- | --- | --- | --- |
    | 10 | straight | 2 | 22 | 104 s | 98 s | 110 s |
    | 10 | weaving | 0 | 24 | 104 s | 98 s | 112 s |
    | 10 | steering | 18 | 6 | 98 s | 93 s | 115 s |
    | 30 | straight | 0 | 24 | 103 s | 96 s | 123 s |
    | 30 | weaving | 0 | 24 | 103 s | 96 s | 116 s |
    | 30 | steering | 11 | 13 | 100 s | 95 s | 125 s |
    | 100 | straight | 0 | 24 | 103 s | 95 s | 207 s |
    | 100 | weaving | 0 | 24 | 101 s | 95 s | 226 s |
    | 100 | steering | 4 | 20 | 104 s | 97 s | 240 s |

    A game lasts about one swim up the river (95–110 s) at every size: some bot salmon swims it
    unhindered. With the person resting, a bot salmon won all 24 rooms within 300 s at every
    size. A person who swims straight or weaves almost never wins; one that steers round the
    hunters as a bot does wins 18 of 24 at 10, 11 at 30, 4 at 100.
  - **Levers, none taken (owner call):** how fast a bot salmon swims (its class speed is a
    person's; a bot-only slowdown or a lazier `BOT_SWIM` would lengthen every game); how well it
    swims (longer reaction, more wobble, more rests); a head start for people (bots start later
    or further down); a minimum game length (the source not a goal for the first N s, or for
    bots only); fewer salmon bots (the 60 / 25 / 15 shares).
  - Proof: `check:salmon-bots` 13 (the source check rewritten: a bot and a person at the source
    end the game the same way; the reach-and-stall check now six bot salmon until the first
    wins), `check:room-size` 19 (new live check: a public room a bot salmon wins names it and
    gives no device a pass), `check:room-bots` 56, `check:room-sim` 43, `check:online-rules` 39
    (no committed trace moved: none has a bot salmon reach the source), `check:room-lobby` 16,
    `check:salmons-art` 23, `check:netcode` 28, `check:character-sheet` 90,
    `check:agents-knowledge`, `check:runtime-bytes` (all five runtimes unchanged: the rule and
    the pass are server-side). Mutations: bots that may not win fail `check:salmon-bots` and
    `check:room-bots`; a pass sent for a bot's win fails `check:room-size`. The stall guard
    reads 0.0 s on the shipped level, so it guards little; a bot that never knows it is stuck
    fails the wall check instead. Browser, on an arcade runtime built from the branch:
    `salmons-levels-play.mjs` 41 / 41 on both netcodes, with a new bear's page in a room of 10
    (`room_size=10`, the export as it ships) that sees a bot salmon win after about 100 s and its
    win screen say its name, no eggs (before the names "Bot 9 won!!!" after 102 s; with them
    "Current Kim won!!!" after 95 s; playtest doc); `salmons-play.mjs` 94 / 94 on both netcodes;
    `online-play.mjs` 19 / 19.

- 2026-11-21 — **The line: a cast nearer than its home is refused; its hook stays unrewound**
  (branch `claude/salmons-line-edges`; game-server change: Rollup over the 81 names the runtimes
  import from `engine-mechanics` keeps none of `salmonsRules.js`; no config or upload). Why each,
  and what is left: Open items, "Decided 2026-11-21".
  - **Code.** `salmonsRules.js` `fishingLine` `cast` refuses a landing nearer the fisherman than
    `LINE.landCells` (0.3 tiles), as it refuses one on the bank: no `ability`, no cooldown. The
    original's `minCastCells` (0.1) is gone from `LINE`, so the two cannot part again. The module's
    doc comment says the hook is tested where the target is now. `design/realtime-multiplayer.md`
    §6 now recommends the rewind for instant hits only.
  - **Proof.** `check:online-rules` 40 (one new: on level 1's second bridge a tap 0.25 tiles off
    casts nothing and spends no cooldown, the next press 0.35 tiles off is `ability` and
    `hooked`; with the old 0.1 back it fails on `['ability']`). The committed traces are
    untouched and replay exactly: none casts within 0.3 tiles. `check:salmons-jump` 37,
    `check:room-bots` 56, `check:room-sim` 43.
- 2026-11-21 — **`check:room-bots`' phone-and-fisherman check no longer flakes** (branch
  `claude/silly-swirles-b61d76`). "a salmon whose device says a phone's view holds the fisherman
  (a person) …" failed on CI (PR #1844, `check-all` 2/3) with `offScreenAtCast` `undefined`, and
  5 runs in 20 here. Nothing in the room was wrong: a person's cast lands on the salmon, so
  `fishingLine` hooks it in the very step of the cast, the device hears `hooked` at the next patch
  and `until` cleared the 30 Hz timer that sampled the line before it ever ticked with the line
  out. The read at the hook came after the device heard it, a reel step (8 cells/s) or a stall
  later, and could fail the same way on a slow runner. Both are now read at the room's own step
  that returns the `ability` and the `hooked` event (`sim.step` wrapped for the scenario); the
  assertion is unchanged, and a mutant that stands him on the phone's screen still fails it
  (`[false, false]`). The bot twin had the same fault in its setup: the salmon swims to his
  bobber only once the test's own ticks pass the join's grace, and those fall behind the room's
  steps on a busy machine (step 90 at tick 56), so his first cast was often wasted; since #1848
  each costs his rest between casts (3 casts and 16.5 s of the 30 s limit seen). The grace is
  now counted in the room's steps (`sim.steps >= me.safeUntil`): every probed run hooks on his
  first cast (60 of 60 at ten in parallel, at most 3.0 s). After the fix neither case failed
  (300+ runs, many beside a local `check:all`). A run that spans this laptop's Modern Standby
  times out at wake (`until` reads the wall clock): three did, each matched in the power log.
- 2026-11-21 — **Rooms filled by the bots' shares, test rooms of a size, Salmons at 60 / 25 /
  15 of 100** (branch `claude/salmons-room-size-bots`). What it does is the first bullet of
  Current state; what the owner does is the first block of Owner steps.
  - **Code.** `game-config` `family.ts`: `share` on a bots entry, `botsByShares`,
    `botShareClasses`, `botShareCounts` (the rounding: its doc comment), `onlineTestSizeRange`,
    and `resolveArcadeOnline(doc, field, { size })`; `familyValidate.ts` `validateBotShares`. A
    config by count is stored byte for byte and played as before. `services/game-server`:
    `roomSim.ts` (the fill by shares), `server.ts` (`ROOM_NAME_TEST` `arcade-test`,
    `maxTestRooms`), `arcadeRoom.ts` (a test room's size, its refusals), `configSource.ts`
    (`loadGame(game, size)`, `SizeRefusal`), `main.ts` (`GAME_SERVER_TEST_ROOMS`). `apps/lines`
    `online.ts`: `?room_size=`. `salmons.js`: the shares, no `max` on bear and fisherman, a
    salmon spawn on the band river. `/config`: [status/game-config](game-config.md).
  - **What the validator says of shares.** Errors: some bots with a share and some without; two
    share entries playing one class; a room size under the number of share classes. Warnings: a
    class no bot has a share for (nobody can play it); `fillTo` set (not read); a share class's
    authored `max` (not read); a share outside 0.01–1000; share bots that would all start on
    the room's one spawn.
  - **A person's salmon, by room size** (`measure-room.mjs --size <n>`: the room's own fill, the
    person joining as a salmon; 24 rooms, seeds 1 to 24, each its own level; 600 s at most;
    first fate; the swimmers as in the 2026-11-20 entry, whose "before" rows are repeated):

    | Room                                         | Salmon   | At the source | Hooked | Swiped |
    | -------------------------------------------- | -------- | ------------- | ------ | ------ |
    | Before: 10 bears, 9 fishermen, no bot salmon | straight | 3             | 2      | 19     |
    | Before                                       | weaving  | 2             | 3      | 19     |
    | Before                                       | steering | 11            | 5      | 8      |
    | Of 10: 5 / 3 / 1                             | straight | 18            | 2      | 4      |
    | Of 10                                        | weaving  | 17            | 2      | 5      |
    | Of 10                                        | steering | 22            | 2      | 0      |
    | Of 30: 17 / 8 / 4                            | straight | 7             | 2      | 15     |
    | Of 30                                        | weaving  | 4             | 5      | 15     |
    | Of 30                                        | steering | 17            | 4      | 3      |
    | Of 100: 59 / 25 / 15                         | straight | 0             | 4      | 20     |
    | Of 100                                       | weaving  | 0             | 0      | 24     |
    | Of 100                                       | steering | 6             | 16     | 2      |

    The three numbers after "Of n" are the salmon, fisherman and bear bots beside the person.
    The bots, 300 s a room, the person resting where it joined:

    | Room   | Bot salmon at the source, a minute | A bot salmon's life, median | On the river at a time | Stalled | Bears' catches, a minute | Fishermen's |
    | ------ | ---------------------------------- | --------------------------- | ---------------------- | ------- | ------------------------ | ----------- |
    | Of 10  | 1.77                               | 107 s                       | 4.9 of 5               | 0.0 %   | 0.12                     | 0.24        |
    | Of 30  | 4.33                               | 103 s                       | 16.6 of 17             | 0.0 %   | 1.45                     | 2.70        |
    | Of 100 | 3.89                               | 70 s                        | 57.1 of 59             | 0.0 %   | 13.37                    | 22.43       |

    With nobody else in the room the steering salmon reaches the source in 24 of 24. What the
    tables say and the levers nobody pulled: Open items.

  - **Load** (`scripts/room-load.mjs`, with the new `--warmup`; this build container: 4 cores,
    Xeon 2.1 GHz; the server in its own process; the exported config; a 60 ± 20 ms link; 60 s
    measured after a 25 s warm-up, past the lobby's countdown; a step's budget is 33.3 ms at
    30 Hz). A step is median / p95 / worst; a device's KB/s is median / worst; what a device
    holds is the players it is sent, median / most. "The `max` view": every device declaring the
    largest view the config sends (`nearby.max`), the extreme case.

    | Room of 100                        | Step, ms           | Device, KB/s | A device holds |
    | ---------------------------------- | ------------------ | ------------ | -------------- |
    | 100 devices                        | 1.64 / 2.53 / 18.1 | 8.0 / 13.7   | 30 / 65        |
    | 100 devices, the `max` view        | 1.63 / 2.48 / 9.3  | 16.6 / 18.8  | 65 / 81        |
    | 5 devices, 95 bots                 | 2.99 / 4.76 / 18.0 | 6.2 / 11.2   | 17 / 68        |
    | 5 devices, 95 bots, the `max` view | 3.23 / 5.18 / 10.3 | 7.9 / 10.0   | 23 / 75        |

    100 devices: the nearby pass takes 1.30 / 2.04 / 4.4 ms, the server sends 0.81 MB/s and uses
    24 % of a core and 234 MB. With the `max` view it sends 1.40 MB/s: over the load script's
    budget (10 KB/s a device at the median, 16 at the worst, 1 MB/s out). 5 devices and 95 bots:
    step p99 6.15 ms, 14 % of a core, 188 MB (15 % with the `max` view). **One room of 100 holds
    with a wide margin.** The new limit is rooms per process: Open items. Sizes 30 and 50 were
    not load-tested.
  - **Gates.** `check:room-size` 15, new, discovered by `check:all`: the fill at every size from
    3 to 100; Salmons at 100 and at every test size; who a person's join sends away; a join
    naming no class; a leave; a dropped person's place; a respawn as another class; never over
    its size; a bot's start; the classes spread through the room's order; a room by count as
    before; and, on a real Colyseus server, a test room played at its size, a size outside the
    range refused, public and test joins never matching each other's rooms, and the cap.
    `check:salmon-bots` 13, `check:room-bots` 56, `check:game-config-family` (the shares, the
    conversions, the Online section's server render).
  - **Not verified**: the live game server, the live game, the launcher against R2. The Online
    section was checked by server render in its gate.

- 2026-11-20 — **Bot salmon, a bot at the source, and the room harness** (branch
  `claude/salmons-room-size-bots`). What it does is the first bullet of Current state.
  - **Code.** `onlineBots.js`: `botInput` takes `play` (the rules' `botPlay`) and hands it the
    bot's player, the players of the brain's world that are in the `nearby` box and that it
    `sees`, and `{ seq, dt, state, notes, stream }`; its answer's move and buttons go through
    `sanitizeInput` like the brain's. `createBot`: `notes`, `stream(name)` (a seeded stream a
    name, `<seed>:play:<name>`) and `hunts` (its brain's `chase` tags). `onlineRules.js`:
    `OnlineRules.botPlay`, and in the goal test a bot that may not win is handed to the module's
    `botGoal` if it has one (else skipped, as before). `salmonsRules.js`: `BOT_SWIM`,
    `SWIM_WEIGH` (how it weighs a way), `swimChart`, `swim`, the part `botSalmon` in `salmons`
    only. `salmons.js`: the brain `salmonBot`. `roomSim.ts`: one line, `play: rules.botPlay`.
    `apps/lines` untouched.
  - **Method** (`scripts/salmons/measure-room.mjs`; its header has the arguments).
    `createRoomSim` on `salmonsConfig(salmonsMapRiver(SALMONS_MAP_SEED))`, no lobby, room seeds 1
    to 24, 600 s at most, first fate. **A room's seed makes its level too** (the export pins
    none), so these are 24 levels, as the earlier tables' rooms were. _Straight_ and _weaving_
    are the earlier throwaway harness's swimmers written again (theirs was not kept): in the
    room before they read 3 / 2 / 19 and 2 / 3 / 19 where the last table read 3 / 3 / 18 and
    1 / 1 / 22. _Steering_ is the bot's own `swim` at a person's salmon's controls, with the
    bot's limits and no rest; to the room a person (bears swipe at it, it wins at the source).
    Fate: at the source (it won), landed by a line (`caught`, effect `hook`), swiped (`caught`,
    effect `catch`). The room before the bot salmon (`--bots bear=10,fisherman=9`):

    | Room                               | Salmon   | At the source | Hooked | Swiped | At the source after, median |
    | ---------------------------------- | -------- | ------------- | ------ | ------ | --------------------------- |
    | Before: 10 bears, 9 fishermen      | straight | 3             | 2      | 19     | 110 s                       |
    | Before                             | weaving  | 2             | 3      | 19     | 145 s                       |
    | Before                             | steering | 11            | 5      | 8      | 99 s                        |

    The rooms with bot salmon were first measured with bots given by count; the 2026-11-21
    entry's tables, measured on the room's own fill, replace them. With nobody else in the room
    the steering salmon is at the source 91 to 121 s after its start (24 of 24 rooms; the river
    is 390 cells at 4.5 a second).

  - **Tuning.** The first cut weighed a rock or a whirlpool as a wall: where the river is 7 to
    10 cells wide a whirlpool (4 cells of pull each way) shut it, and 1 room of 24 never got
    through. They are now leapt (as a person leaps them); 24 of 24. No number of a person's, of
    the room's or of the bears' and fishermen's limits moved.
  - **A room with its bots by count is unchanged.** The same script ran on this branch and on
    its base in a worktree: rooms of 10 bear and 9 fisherman bots with a salmon and a bear or a
    fisherman of people's, 6 seeds, 120 s each, on the original's levels, the band river and
    with the lobby; every event and every player's place, status, score and line hashed. The
    three hashes are the same.
  - **Gates.** `check:salmon-bots` 13, new, discovered by `check:all` (which runs every
    `scripts/check-*.mjs`). Each check, and what made it fail when the code was changed so:
    the config and the rules (`salmons` without `botSalmon`); a room replays from its seed (an
    unseeded heading); what the rules play is clamped, and only for a bot they play (no brain
    move when the rules play nothing); the other bots' draws (the aim's or the brain's stream
    handed to the rules; one stream for every name); a move and the jump button (a press of
    `ability1`; a tap every input; no tap at a waterfall); a bear only after its reaction time
    (none); never one it is not sent or does not see (told of every player; `nearby` ignored;
    `sees` ignored); a line leapt after its reaction time (no leap for a line); a bot at the
    source (a bot that wins there; one left there; a stain for it); a game whose rules say
    nothing (every game sending a bot home); bot salmon reach the source (the rules playing no
    bot's salmon; rocks and whirlpools weighed as walls: 3 of 6 in one room); stopped by what
    it is told nothing of (stuck never noticed); a bear bot swipes at a bot salmon (pressing
    for no bot; for every bot). `check:room-bots` 56 (the mix names `salmonBot` since
    2026-11-21, so its config check expects no warning).
    Also `check:room-sim` 43, `check:online-rules` 39, `check:room-lobby` 16, `check:netcode`
    28, `check:salmons-jump` 37, `check:salmons-levels` 18, `check:salmons-heights` 24,
    `check:agents-knowledge`; typecheck and eslint (`engine-mechanics`, `game-server`).
  - **Runtime bytes.** The arcade runtime built with and without the four changed mechanics
    files is the same files, name for name (`check:runtime-bytes --only arcade`, twice). Both
    differ from the committed manifest by the base commit's config change (`da9fcc6`: the
    bundle +1030 B gzip), which is not this change's to re-record. The other four runtimes
    were not built.
  - **Not verified**: a browser (no playbook was played: no runtime source changed); the live
    game server; what a device shows as a bot salmon reaches the source (read off the code).

- 2026-11-20 — **The owner's report after #1808: fishermen less precise and slower, bears in the
  water, no circle** (branch `claude/salmons-playable-bots`). What it does is the first bullet of
  Current state.
  - **Code.** `onlineBots.js`: for an aimed ability with `lagMs` a bot keeps where it saw each
    target on its last inputs (`watched` → `trail`) and adds `lagError` (as far as the target moved
    in the drawn lag, across the bot's line to it, on the side it came from); with `restMs` it sets
    `bot.rest` at each cast and watches nothing before it. `salmonsRules.js` `BOT_AIM.lagMs` 500–700,
    `restMs` 2500–4000, carried as `botAim.aimed` (`lagMs.max` ≤ `reactMs.min`: the trail starts with
    each watch). Swipe draws unchanged (`steps` draws as before),
    so the bears do as they did given the same room. No code for the bear or the circle.
  - **Method.** A throwaway harness (scratch, not kept): `createRoomSim` on
    `salmonsConfig(salmonsMapRiver(SALMONS_MAP_SEED))` (no lobby), room seeds 1–24, 10 bear and 9
    fisherman bots, one scripted salmon, 600 s at most. _Straight_: steers for the middle of the
    water two cells ahead, taps jump when it makes no way. _Weaving_: the same, swinging ±3 cells
    over 4 s. _Sitting_: on open water (a cell of water on every side) 4, 8 or 12 cells from a bot
    fisherman in his sight, the other bots out, put there 2 s after he was held (so the time
    counts from when he sees it); _held_ still, or _resting_ on the current (no input). "Before"
    is `main` (dc4f41f) in a worktree. 4 cells: 19 rooms had such a spot.

    | Salmon, room              |        | At the source | Hooked | Swiped | First hook, median | Casts | One bot's casts apart: least / median |
    | ------------------------- | ------ | ------------- | ------ | ------ | ------------------ | ----- | ------------------------------------- |
    | Straight, as shipped      | before | 0             | 9      | 15     | 52.7 s             | 180   | 1.7 / 3.0 s                           |
    | Straight, as shipped      | after  | 3             | 3      | 18     | 17.2 s             | 176   | 3.5 / 4.4 s                           |
    | Weaving, as shipped       | before | 0             | 10     | 14     | 56.9 s             | 174   | 1.4 / 3.0 s                           |
    | Weaving, as shipped       | after  | 1             | 1      | 22     | 32.2 s             | 167   | 3.4 / 4.3 s                           |
    | Straight, fishermen alone | before | 8             | 16     | –      | 57.1 s             | 270   | 1.6 / 3.0 s                           |
    | Straight, fishermen alone | after  | 21            | 3      | –      | 17.2 s             | 286   | 3.4 / 4.3 s                           |
    | Weaving, fishermen alone  | before | 7             | 17     | –      | 85.2 s             | 318   | 1.4 / 3.0 s                           |
    | Weaving, fishermen alone  | after  | 22            | 2      | –      | 32.2 s             | 374   | 3.4 / 4.3 s                           |

    | Sitting, cells from him | Held: before (hooked, median, last) | Held: after                | Resting: before            | Resting: after             |
    | ----------------------- | ----------------------------------- | -------------------------- | -------------------------- | -------------------------- |
    | 4                       | 19 of 19, 1.2 s, 1.5 s              | 19 of 19, 1.2 s, 1.5 s     | 19 of 19, 1.2 s, 1.5 s     | 19 of 19, 1.2 s, 1.5 s     |
    | 8                       | 24 of 24, 1.2 s, 1.5 s              | 24 of 24, 1.2 s, 1.5 s     | 24 of 24, 1.2 s, 1.5 s     | 24 of 24, 1.2 s, 1.5 s     |
    | 12                      | 23 of 24, 4.1 s, over 60 s          | 20 of 24, 6.3 s, over 60 s | 14 of 24, 3.3 s, over 60 s | 11 of 24, 9.8 s, over 60 s |

    Against the targets: straight swimmer at the source in two thirds of rooms with fishermen
    alone (21 of 24) and the weaving one in more (22): met; casts at one salmon at least about
    3 s apart (3.4 s): met; a sitting salmon within 8 cells hooked within a few seconds in every
    room (1.5 s): met. "First hook" after is over the few rooms with one, so it is not comparable.
    A first cut with a lag of 0.5–0.8 s was narrowed after review: a lag past the least reaction
    time was cut short to what he had watched.
  - **Tried and dropped.** Aiming at where the salmon was (the lag along its way): 13 of 24 at the
    source; the hooks were all made on landing, by a salmon swimming at the fisherman into a bobber
    short of it, or one the long cast's short fall pulled back onto it.
  - **Harness trap.** A held salmon at a corner where the river narrows sat 15 px off the line's
    water (`fishingLine` `waterOf`), so no cast could land on it, a person's included; sitting
    spots now need a cell of water around them. Not changed in the rules.
  - **Bears and the circle** were played in headless Chromium against an in-process server on the
    exported config, both netcodes (playbook "Bears in the water, and no circle on an attack").
    The live server's `/healthz` and the live page's `x-runtime-release` both read `c98c63c`.
  - **Gates.** `check:room-bots` 56 (52 before): a cast to the side of a moving target and on a
    still one, and no further back than the bot watched; a rest after a cast; on the shipped level a still salmon 4 or 8 cells off hooked in
    3 s (at least 12 of 16 rooms tested; `lagMs.max` ≤ `reactMs.min`); as exported a person's bear and bear bots go into the water. Mutations, each
    failing its check: no lag error, the lag along the way, the wrong side, a still target missed
    by 3 cells (the unit check and the shipped-level check), no rest, the water solid to bears on
    the original's levels. `check:salmons-art` 23 (one new, "a press draws no circle", failing on
    a spawn wired to `ability` or a `salmonsSwipe` spawnable). `check:online-rules` 39,
    `check:room-sim` 43, `check:room-lobby` 16, `check:salmons-jump` 37, `check:salmons-levels` 18,
    `check:salmons-heights` 24, `check:netcode` 28, `check:agents-knowledge`; typecheck and eslint
    (`engine-mechanics`, `game-server`). `check:runtime-bytes`: all five runtimes match their
    manifests (no runtime byte moved). Playbook on a runtime built from the branch:
    `salmons-play.mjs` 94 / 94 in each netcode, `salmons-levels-play.mjs` 38 / 38 in each (one
    colyseus run failed "a snapshot shipping the project's salmons_terrain draws the banks from
    it", untouched by this change, and passed on its rerun), `online-play.mjs` 19 / 19 in each.
  - **Not verified**: the live game server and the live game with this change; the published
    project's documents.

- 2026-11-20 — **The device's view drives the nearby box** (#1823 and its rework #1832, both
  merged the same day; owner decision of the same day on the
  three ways the 2026-11-19 entry left open). What it does, its limits and how it goes live are
  in Current state and Owner steps; here is what was built, measured and proved. Reworked after
  a review the same day (the last item): the view adds to the box instead of replacing it, and
  is held a second.
  - **Built.**
    - `game-config` `family.ts`, `familyValidate.ts`: `arcade.online.nearby.max` (`{ w, h }`,
      optional, stored only beside a box; resolved inside the nearby limits and never below the
      box; a warning when out of range or smaller than the box). A config without it normalizes
      and resolves as before.
    - `engine-mechanics` `shown.js` (new): `shownOf` (what a device says), `boxRegion` and
      `viewRegion` (the box, and the declared view inside `max`), `pastRegion` (25 % further
      out: who is kept), `nearbyHolds` (in the box or in the view: the one place the two are
      put together), `holdView` and `widestRegion` (the hold) and `regionHolds` (four
      comparisons a pair). `online.js` `sanitizeInput` / `clampInput` carry `shownW`, `shownH`,
      `shownIso` only when an input has them, as `respawn`.
    - `services/game-server` `schema.ts` (`Input`: two uint16 and a uint8), `arcadeRoom.ts`:
      each patch `holdViews()` takes each client's newest decoded input
      (`this.inputs.get(id).latest`, which is ahead of what the step has taken and gone with
      the client) into its held view, kept beside `seen` and dropped with it, and `nearby()`
      sends by the box or that view.
    - `apps/lines` `online.ts` (`follow` works the declaration out each frame from the camera
      view it has just published; every input carries it, zeros with no world camera),
      `ArcadeStage.svelte` (hands it the canvas size: `view()` gave only the layout's box).
      Online only; the offline loop is untouched. The drawing's shift is counted from the
      ground's own lift under the player, the lift its whole terrace is drawn with: a leap and
      a lift still easing count, a terrace's height (up to 576 px on the shipped level) does not,
      or a device high up the river would say twice that more for nothing.
    - `salmons.js`: `nearby: { w: 3300, h: 3300, max: { w: 6400, h: 6400 } }`.
    - `/config` → Online room: **Nearby max width / height** beside the box, explained in a tip
      (`OnlineSection.svelte`, `onlineDoc.ts` `setNearbyMax`; guide updated). Both fields of a
      pair are read on a change (383ea71): typing a width and then a height from empty showed
      both and saved neither, for the box and for the max. `check:game-config-family` cannot
      exercise the DOM, so that was checked in a browser on a minimal page. **Spawn x / y** has
      the same older fault; it is raised separately and left.
    - `scripts/room-load.mjs`: `--shown <mix>` (devices that say their views, each with a camera
      that eases to its own player and its own leap, as the runtime), `--nearby-max`, and the
      time of each patch's nearby pass, which the step time never held (`nearbyMs`).
  - **The wire, checked before building.** The device builds its input from the schema the
    server sends at the join, so an old runtime on the new server never names the fields (the
    room holds 0, 0, 0) and the new runtime on an old server writes values that are never
    encoded. Saying a view costs 8 bytes on the first input and 0 after; a changed size costs 3.
    Swimming and leaping (a tap twice a second) a page sent 370–373 B/s where the same page on
    main's server, which is never sent the fields, sent 338: about 33 B/s more, and nothing more
    at rest (329 B/s both).
  - **What a window shows, measured from the Pixi display tree** (a bear's instance found by its
    local place, its canvas place read): a world-projected px is drawn at the camera's zoom in
    window px whatever the layout's box (0.6667 on 2560 × 1440 and 2560 × 1080, 0.3333 on a
    390 × 844 phone), the own player at the window's centre once the camera rests, and bears
    beside the box are drawn (a 2560 × 1080 window's box is 1920 px wide; bears at ±1088 and
    ±1216 px). A camera whose zoom counts design px draws at the box's scale times the zoom, a
    flat screen at the box's scale: `shownOf` takes all three.
  - **Cost**, 100 devices in one room, 60 ± 20 ms, 30 s after a 3 s warm-up, a 4-core container,
    the exported config (a level of the room's own each run, which is most of the spread),
    three runs a row, on the reworked tree. Budget: a device 10 KB/s on average and 16 at most,
    1 MB/s out, a step 8 ms at p99.

    | Devices                                  | Each salmon             | KB/s a device: mean / most  | Out            | Step p99   | Nearby pass p99 | Budget                         |
    | ---------------------------------------- | ----------------------- | --------------------------- | -------------- | ---------- | --------------- | ------------------------------ |
    | say nothing: the box alone, as before    | `--jump 0.02 --respawn` | 8.15–8.42 / 13.24–13.96     | 0.80–0.82 MB/s | 4.2–4.5 ms | 3.3–4.3 ms      | within                         |
    | a guessed mix of windows                 | the same                | 7.63–8.43 / 12.25–14.11     | 0.75–0.82      | 3.8–4.1    | 3.3–3.8         | within                         |
    | every device a 2560 × 1440 window        | the same                | 8.51–9.10 / 14.07–14.72     | 0.83–0.89      | 3.7–4.3    | 3.5–3.8         | within                         |
    | every device declares the whole `max`    | the same                | 11.62–11.87 / 15.45–16.91   | 1.14–1.16      | 4.1–4.3    | 3.5–4.8         | over (the mean and out; the most in 1 run of 3) |
    | say nothing: the box alone               | `--jump 0.1 --respawn`  | 10.57–11.27 / 18.50–19.58   | 1.03–1.10      | 3.9–4.1    | 4.0–4.1         | over (all three)               |
    | the guessed mix                          | the same                | 11.06–11.91 / 18.98–19.69   | 1.08–1.16      | 3.9–5.1    | 3.4–4.5         | over (all three)               |

    The mix is an assumption, not measured play: 45 % a 390 × 844 phone held upright, 5 % the
    same on its side, 25 % 1920 × 1080, 15 % 1536 × 864, 5 % 2560 × 1440, 5 % a 1280 × 800
    tablet. It costs what the box alone costs, within the spread between runs: the view only
    adds, 90 % of those devices show no more than the box, and the other 10 % add little. A
    room of 2560 × 1440 windows sends a little more than the box alone (about 6 % between the
    two rows' middles). The first build's mix
    read 0.55 MB/s because it sent a phone less than the box; that saving is gone with the
    defect (Open items: "Send a phone less than the box"). The most stays 6400 × 6400: no
    honest mix needs less, and 4600 × 4600 would cut a 3840 × 2160 window and, by 8 px, a
    tablet.
    To repeat it: `scripts/salmons/export.mjs --out <dir>`, then `scripts/room-load.mjs --jump
    0.02 --respawn --config <dir>/invisible_wall/salmons/config/config.json` with `--nearby-max
    none` (the box alone), `--shown 45:390x844m,5:844x390m,25:1920x1080,15:1536x864,5:2560x1440,
    5:1280x800m`, `--shown 100:2560x1440` or `--shown 100:max`.
  - **The pass over the pairs** (ten thousand tests a patch at 100 players, twenty patches a
    second) took 1.5–1.6 ms at the median with this loop and 1.3–1.7 ms with main's inline box
    test put back, run turn about on the same load (the box alone): no difference beyond the
    spread between runs. With views to hold and test as well (the mix) its median was
    1.7–1.9 ms. It is not part of a step, so the step time never showed it; the load test now
    does.
  - **In the browser** (headless Chromium, device scale factor 1, a real local game server;
    still bears stood at offsets from the page's own, in cells; the same in both netcodes; what
    each window says is in Current state). The 1920 × 1080, resize and phone rows are what
    `salmons-levels-play.mjs` checks on the final runtime. The others were read with a probe on
    the first build, and the rework changes none of them: it adds only players inside the box.

    | Window                                         | Bear, cells from the own player                             | Sent and drawn                        | On the canvas, px from its centre                                     |
    | ---------------------------------------------- | ----------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
    | 2560 × 1440                                    | 30, 36, 40 up-river                                         | yes                                   | (−960, −480), (−1152, −576), (−1280, −640): the last on its left edge |
    |                                                | towards its corners: (−2, −41), (−35, −7), (41, 2), (2, 41) | yes                                   | (−1248, −688), (881, −679), (−1248, 688), (1248, 688)                 |
    |                                                | 43 up-river, just past the edge                             | no                                    | would be (−1376, −688), off it                                        |
    | 1920 × 1080                                    | 30 up-river                                                 | yes                                   | (−960, −480): on its left edge                                        |
    |                                                | 36 up-river and every other of the eight                    | no                                    | off it                                                                |
    | the same page resized to 2560 × 1440           | 36, 40 up-river and the corners                             | yes, with no reload                   | as the first rows                                                     |
    | 390 × 844 phone                                | 12 up-river, 26 down the screen, 5 across                   | yes                                   | (−192, −96), (0, 416), (160, 0)                                       |
    |                                                | 25 up-river: off its screen, inside the box                 | yes: the box sends it, as before      | would be (−400, −200), off it                                         |
    |                                                | 36 up-river: past the box                                   | no                                    | off it                                                                |
    | 3440 × 1440 (observed, not a gate)             | six at its edges and corners                                | yes, none on it unsent                | to (±1664, 0) and (−1408, −704)                                       |
    | 2560 × 1440 on main's game server (never sent what it says) | 25, 30 up-river (inside the 3300 box)          | yes                                   | (−800, −400), (−960, −480)                                            |
    |                                                | 36 up-river: on its screen, past the box                    | no, as today                          | would be (−1152, −576)                                                |

    The far bank's own corner (−41, −2) is past where a bear may stand there: the level moved the
    bear placed on it, so the nearest place it stays stands in for that corner. A bear already
    standing 43 cells up-river while the page is resized is sent too: the camera slides to the
    new window's centre for half a second, the device says the larger view it sweeps, the room
    holds that a second or two, and a player 2.4 % past the edge is then kept (25 %). A page
    opened at 2560 × 1440 is not sent it. For the terraces limit two more 3440 × 1440 pages
    stood bears on the far bank either side of a waterfall; the level moved them (a bear is held
    off a waterfall) and none ended on the screen and unsent, so that limit stays worked out,
    not seen.
  - **Bots unchanged.** A swimming salmon against the room's bots, 24 seeds, the box with and
    without `max`, on the reworked tree: the same outcome in every seed to the step and the
    place (11 hooked, median 52.9 s; 13 swiped by a bear: #1808's softer bots). `check:room-bots` proves a
    `max` on a smaller box does not lengthen a bot fisherman's aim.
  - **Runtime bytes** (gzip, every file of the manifest; the gate's own reproducible builds).
    Against main before #1823: `lines` +144 B, `match3` +138 B, `card` +157 B, `arcade`
    +684 B, `arcade3d` +769 B. The rework itself, against #1823 as merged: `lines`, `match3`
    and `card` are byte for byte the same (the release on its merge skips them), `arcade`
    −11 B and `arcade3d` −1 B (the canvas guard; the room's functions in `shown.js` are in no
    runtime). In the three that play no arcade game
    the whole of #1823's change is config code every runtime carries: built on main before it
    and on its branch, tokenized, with the minifier's variable names set aside, each bundle
    gains the same 200 tokens in the same two places and is otherwise main's
    (`normalizeArcadeOnline` keeping `max`, 63 tokens; the validator's two
    `arcade.online.nearby.max` warnings, 137), and every other file is the same but for hashed
    names. (`lines` and `card` also have two of the minifier's mangled method names trading
    places, `W` and `z`, in seven spots.) The device's side (`shownOf`, `online.ts`) is in
    `arcade` and `arcade3d` only.
  - **Proof**, on the reworked tree. `check:room-bots` 52 (37 before #1823; the 15 on the view
    each fail under one mutation of their subject, 18 mutations in all, and pass again). A
    second review of the rework found the first live view check passing with the keep test by
    the view alone put back: it now has a still player in the box's keep margin, 450 px away,
    whom a smaller view must not take away (shown failing under that mutation). The same
    review: the fisherman check also tries his sight's four corners a hook's reach further
    out, which a box 100 px smaller misses and random places do not find; and the live hold
    checks count the room's own patches, not milliseconds, so a loaded runner slows them and
    does not fail them (run under six busy loops on four cores).
    `check:game-config-family` 346, `family.fixture.ts` 5 cases, `check:online-rules` 39 (the
    committed traces untouched), `check:room-sim` 43, `check:netcode` 28, `check:room-lobby` 16,
    `check:salmons-jump` 37, `check:salmons-levels` 18, `check:arcade-pointer` 22; launcher
    `check:arcade-camera` 87, `check:salmons-export` 18; `check:runtime-bytes` (all five built
    from the final tree match their manifests); `check:rgs`. `salmons-levels-play.mjs` 38 / 38
    and `salmons-play.mjs` 94 / 94, each in each netcode, each run alone on the final runtime.
    (`check:all` was 720 of 722 on the first build: the two that fail,
    `tools/fx-spike:baked-runtime` and `tools/fx-spike:nine-slice-parity`, fail the same way
    on a clean main in the same container; not re-run for the rework.)
  - **Review, and the rework** (the same day; an independent review of #1823's head, which
    merged before the rework did).
    - **A device was sent less than the box (blocking).** #1823 sends a device with a view by
      that view instead of the box. A phone's view is 14 cells wide across the screen and a
      fisherman sees and casts 30, so a salmon on a phone is hooked by a fisherman its device
      was never sent: no fisherman, no line, no cast heard. Played by the reviewer on a local
      room: the fisherman 9.9 and 18.0 cells from the salmon, the salmon hooked, its device
      holding him: false, hearing `roundStart, joined, hooked`. It bites only a room whose
      config has `max`, and none is published. Now the view only adds to the box
      (`nearbyHolds`): the same script on the reworked tree reads holding him: true, hearing
      `roundStart, joined, ability, hooked`, as a room with no `max` does. `check:room-bots`
      plays that scene live with a person and with a bot, holds a fisherman's whole sight
      inside what any device is sent, and holds every device to at least what a room with no
      `max` sends.
    - **A device flipping its view was sent everyone again each time.** A player that comes
      into a view is sent in full. One device among 99 others, saying nothing, then the whole
      `max`, then the `max` and 32 px in turn (6 s each; the reviewer's script, before and
      after): KB/s to the device, the players it held (fewest..most), the pass's median.

      | The device                        | 99 still, #1823       | 99 still, reworked    | 99 moving, #1823       | 99 moving, reworked     |
      | --------------------------------- | --------------------- | --------------------- | ---------------------- | ----------------------- |
      | says nothing (the box)            | 0.40, 1..1, 0.96 ms   | 0.41, 1..1, 1.04 ms   | 1.73, 1..9, 1.16 ms    | 1.73, 1..9, 1.28 ms     |
      | holds the whole `max`             | 0.40, 100..100, 0.99  | 0.41, 100..100, 1.01  | 23.89, 100..100, 1.22  | 23.29, 100..100, 1.22   |
      | flips every patch (50 ms)         | 85.03, 1..100, 1.31   | 1.84, 1..100, 1.20    | 79.41, 1..100, 1.43    | 23.89, 100..100, 1.30   |
      | flips every other patch (100 ms)  | 43.42, 1..100, 1.35   | 0.40, 100..100, 1.09  | 55.16, 1..100, 1.31    | 23.89, 100..100, 1.54   |
      | flips every input (33 ms)         | 43.39, 1..100, 1.22   | 0.40, 100..100, 1.09  | 54.97, 1..100, 1.19    | 23.31, 100..100, 1.27   |

      Now a view is held a second (`holdView`), so flipping costs what holding the larger view
      costs. The one row that still lets go (flips every 50 ms, still, 1.84 KB/s): the room
      reads a device's newest input once a patch, the device sends 30 a second, and a 50 ms
      flip can fall so that no patch sees the larger view for a while. The view is then let
      go and everyone is sent again when a patch next sees it. A view shrinks only where a
      window turns, so the most a device can make of it is one such re-send a hold window: a
      second review reached that with two views of different shape said in alternate windows
      and nothing said at each window's first patch (in its model of the room's pass, one
      re-send of each player a second, against none for holding the `max`; not run live).
    - **`max` read as a hard cap.** It bounds who comes into a view; a player already sent is
      kept a quarter past it, as with the box. No code change: reworded here, in the design
      doc, the guide, the tooltip and the config's type.
    - Also from the review: the online camera's canvas size is required, not guarded
      (`online.ts` `ScreenSize`); the limits above on the edge transient, a flow's camera
      shake and the terraces are worded as limits; comment lines inside 100 columns.
- 2026-11-20 — **A new room's lobby asks nothing** (owner: "continue with the rest": the second
  form #1792 left in a new room's lobby; branch `claude/eloquent-planck-00ayqg`; in review;
  runtime change, no game-server, flow, layout or config change). See Current state.
  - **Code.** `engine-layout` `salmonsArt/screens.ts`: `createStartMenu` (the form drawn in the
    canvas, its `<input>` over it, the river list, the splash) is replaced by `createLobbyNote`
    (two outlined lines; it polls the listing only for its own room); `SalmonsScreens.lobby`
    takes `LobbyShown` (`roomId`, `name`, `character`; was `MenuShown`); `SalmonsScreenHost.rejoin`
    takes no choice; `choiceRow` lost the font size only the form's class row used. The splash
    and the name kept on the device (`createSplash`, `storedName`, `joinName`) moved to
    `startMenu.ts`, their only user; `MENU` and `riverRows` stay shared. `SALMONS_SCREEN_ART.menu`
    is `.lobby` (the same node id, `sm-lobby-menu`; the reference layout's node keeps its
    published label, "Start menu (drawn in code)", so the export does not move). `apps/lines`
    `online.ts`: `drawScreens` hands the note the room's id and the own player while `phase` is
    `waiting`; `screenHost.rejoin` no longer merges a choice. The probe's `online.screens.menu`
    is gone; `online.screens.lobby` is `{ shown, river, you, players }`.
  - **Not touched:** the start menu before the join, `launchJoin`, the next join in session
    storage (the win screen's), the death screen, the layout, the flow, the config, the game
    server. `scripts/salmons/export.mjs` writes the same six documents, byte for byte, on this
    branch and on `main`.
  - **Found on the way:** a line of text an odd number of px wide, centred by its anchor, is
    drawn half a px off and blurred (measured: the fill's white at 227 of 255 on one page and 255
    on another, by the river's name alone). The note sets its lines on whole px; the other
    screens' texts, centred by their anchors, were left as they are.
  - **Bundle** (`check:runtime-bytes` at the CI path against `main`'s manifests): `lines`,
    `match3` and `card` are the same bytes; arcade is 292 B gzip smaller (2 098 906 → 2 098 614),
    of which the lazy `salmons-art` chunk only a Salmons room fetches is 303 B smaller (21 152 →
    20 849) and the bundle 3 B larger; arcade3d is 310 B smaller (2 607 804 → 2 607 494: the same
    chunk, its bundle 7 B smaller). The softer aim (the entry below) moves no runtime byte.
    `scripts/runtime-bytes/{arcade,arcade3d}.json` re-recorded there; a build in another folder
    gives the same bytes (since #1728).
  - **Proof.** `check:room-lobby` 16 (1 new: the lobby's part is a note with no button, field or
    rejoin; nothing drawn in a room makes a text field or keeps a name; the runtime shows it only
    while the room waits; the layout's lobby node is as published), `check:salmons-art` 22;
    svelte-check at its baseline for `engine-layout` (290) and `apps/lines` (145). Playtests, one
    at a time on an idle machine, on a runtime built from the final code: `salmons-levels-play.mjs`
    30 / 30 in 2 runs (and in the 3 runs before the note's look was final): 2 new verdicts (the
    first person's lobby shows the river with one person and who the page plays, with no form in
    the canvas, no text field on the page and no start menu; with two people both lobbies count
    2), 2 changed (round 1 also takes the note away; through the start menu into a new room the
    lobby says what was picked and does not ask again, where it used to read the lobby menu's
    chosen class); the 8 other start-menu verdicts unchanged. `salmons-play.mjs` 94 / 94 with `engine`
    and with `colyseus`, 2 runs each; `online-play.mjs` 19 / 19 in each netcode, 2 runs each.
- 2026-11-20 — **A bot fisherman aims as a person** (owner: "soften the bot fishermen's aim";
  branch `claude/eloquent-planck-00ayqg`; in review; game-server change, no config, flow or
  layout, and no runtime bytes: all five runtimes build to their committed manifests with it).
  What it does is the first bullet of Current state; this is what moved, how it was measured and
  what was tried.
  - **Code.** `engine-mechanics` `onlineBots.js`: `createBot` gives a bot its aim's own stream
    (`<seed>:aim`) and the targets it is watching; `botInput` takes `aim` (`BotAim`: `reactMs`,
    `surePx`, `spread`) and, for a `hook` ability only, casts at a target once it has been in
    sight for its reaction time, not while `self.lineActive`, every target anew after a press,
    and aims the press short by the cast's error. `salmonsRules.js`: `BOT_AIM`, carried by the
    line's module as `botAim` (`together` forwards it); `onlineRules.js`: `OnlineRules.botAim`
    (none without a module that has one); `services/game-server` `roomSim.ts` passes it to its
    bots. No `aim`, no change: a bot of any other game presses and aims as before. Nothing reads
    `player.bot` in the rules: a person's input never goes through `botInput`. (Since the
    bears' part, below, those three numbers sit under `aim.aimed`.)
  - **Method.** Headless, `salmonsConfig(salmonsMapRiver(1))` (the shipped level, no lobby), one
    room per seed 1 to 24 filled by 10 bear and 9 fisherman bots, one salmon, 600 s at most.
    _Plain_: it steers for the middle of the water two cells ahead and taps jump only when it
    makes no way (the 2026-11-19 probe's swimmer). _Dodger_: the same, and it taps jump in the
    step after a bobber lands within 3 cells of it. _Sitting_: held still on open water a given
    distance from one bot fisherman who plays as he does, the other bots out, put there 2 s
    before he is let in (so the second a new player cannot be hooked for is over, and the time
    counts from when he first sees it). "Before" is the same code with the room told of no
    limits to a bot's aim; "bears out" takes the bear bots out once the room is filled. A
    throwaway harness, not kept. Baseline on `main` (f679ec2) with the 2026-11-19 probe itself:
    hooked in 24 of 24 after 8.9 to 46.8 s, median 24.2 s, 83 cells swum, 35 casts.

    | Salmon | Room       |        | At the source | Hooked | Swiped by a bear | First hook: median (range) | Cells swum, median | Casts | Hooks |
    | ------ | ---------- | ------ | ------------- | ------ | ---------------- | -------------------------- | ------------------ | ----- | ----- |
    | Plain  | as shipped | before | 0             | 24     | 0                | 24.2 s (8.9–46.8)          | 83                 | 35    | 24    |
    | Plain  | as shipped | after  | 1             | 8      | 15               | 37.7 s (29.5–82.9)         | 190                | 168   | 8     |
    | Dodger | as shipped | before | 0             | 24     | 0                | 24.2 s (8.9–46.8)          | 83                 | 35    | 24    |
    | Dodger | as shipped | after  | 2             | 8      | 14               | 37.7 s (29.5–83.5)         | 190                | 169   | 8     |
    | Plain  | bears out  | before | 0             | 24     | –                | 24.2 s (8.9–46.8)          | 83                 | 35    | 24    |
    | Plain  | bears out  | after  | 10            | 14     | –                | 54.4 s (29.5–97.0)         | 330                | 276   | 14    |
    | Dodger | bears out  | before | 0             | 24     | –                | 24.2 s (8.9–46.8)          | 83                 | 35    | 24    |
    | Dodger | bears out  | after  | 10            | 14     | –                | 54.4 s (29.5–96.8)         | 331                | 276   | 14    |

    | Sitting, cells from him | Before: hooked, when          | After: hooked | After: median | 9 in 10 by | The last  | Casts (24 rooms) |
    | ----------------------- | ----------------------------- | ------------- | ------------- | ---------- | --------- | ---------------- |
    | 3.5                     | 24 of 24, the step he sees it | 24 of 24      | 1.2 s         | 1.5 s      | 1.5 s     | 24               |
    | 5                       | the same                      | 24 of 24      | 1.1 s         | 1.4 s      | 1.5 s     | 24               |
    | 8                       | the same                      | 24 of 24      | 1.2 s         | 1.5 s      | 1.5 s     | 24               |
    | 12                      | the same                      | 23 of 24      | 6.6 s         | 32.2 s     | over 60 s | 101              |
    | 20                      | the same                      | 13 of 24      | 45.9 s        | over 60 s  | over 60 s | 175              |

    At 8 cells he hooks it with his first cast because his brain walks him towards a salmon within
    420 px while he waits. On 96 seeds: as shipped 4 at the source, 27 hooked, 65 swiped (before:
    0, 93, 3); bears out 42 of 96 at the source, first hook after a median 70 s (before 0 of 96,
    23 s).

  - **Against the targets set for it.** The plain swimmer at the source in a quarter to a half
    of rooms and at least twice the time to its first hook: met against the fishermen alone (10
    of 24; 54 s against 24 s), not in the room as it ships, where the bears take it (15 of 24)
    and no softening of a fisherman can change that (with fishermen that never cast: 3 of 24 at
    the source, 21 swiped). A sitting salmon within a few cells still caught soon: met (1.1 to
    1.2 s, the last after 1.5 s). The dodger at the source in two thirds of rooms: not met, and
    not reachable by aim: it does exactly as the plain swimmer, since every hook is now made as
    the bobber lands. All three are Open items ("Bots after the softer aim").
  - **Tried and dropped.** An error to every side (a circle about the salmon, its radius half of
    the cast's length past 4 cells; 48 rooms, bears out): 5 at the source, 43 hooked, only 11 of
    them as the bobber landed; the other 32 were taken by the bobber on its way home (on the
    first 24 seeds: 0.03 to 0.6 s after a landing 1 to 7 cells off, one after 1.3 s). A wider
    one (1.2 of the cast's length past 3 cells) with a 2.5 to 5 s reaction time still left 15 of
    24 hooked. So the miss had to be a miss: short. With an error partly beyond the salmon, a
    dodger that is 0.1 or 0.2 s late (a person) gained 1 room of 48 over the plain swimmer where
    a dodger with no delay gained 4, so nothing was shaped for it. A swimmer that leaps whenever
    a bot fisherman is within 8 cells did no better either (11 of 24 against 10, bears out).
  - **Gates.** `check:room-bots` 32 (26 before). Six new: a bot with a reaction time does not
    cast before it, per target, and starts again after a look away; it waits again after a cast
    (line out, home, or refused); its long cast falls short, inside the circle, by more the
    longer it is, the mean pinned to the circle's; a game whose rules name no limits has none,
    and a bot's brain draws what it drew; a person's cast goes out at once and lands where it is
    aimed; a room replays its bot fishermen's casts from its seed. Each fails on a named
    mutation (the room passing no numbers, no reaction, no error, an unseeded stream, the
    brain's stream shared, an error to every side, no wait after a cast, a clock that survives
    a look away). Two of #1792's three sight checks read "the bobber landed at the salmon" (less
    than a cell off); that is no longer true of a 17- or a 23-cell cast, so they now ask that
    it landed no further from it than a cast that long may fall short (the first also that it
    went out within his reaction time and not on the salmon); what they are for is unchanged: he
    casts at a salmon in his sight and in the box, in 2 s, and never at one outside either. The
    third (never out of his sight, in 20 s) is untouched. Also `check:salmons-jump` 37,
    `check:online-rules` 39 (the committed traces byte-identical: their rooms have no bots),
    `check:salmons-levels` 18, `check:salmons-heights` 24, `check:room-sim` 42,
    `check:room-lobby` 15, `check:arcade-pointer` 22, `check:netcode` 28.
  - **The bear bots' reaction time, the same day** (owner: "give the bear bots a reaction time
    too"; the same branch; game-server change, no runtime bytes: all five runtimes build to
    their manifests with it). What it does is the Current state bullet "A bear bot swipes after
    a reaction time".
    - **Code.** `BotAim` is two optional parts, one per kind of ability: `aimed` (the three
      numbers above) and `inReach` (`reactMs`). `botInput` reads `aimed` for a `hook` and
      `inReach` for anything else: a target within reach (`reach` + `ahead`) is watched as a
      seen one is, on the same clock code (`reacted`, now keyed by the ability's button and the
      target), out of reach for an input and it starts again, and a press clears every clock.
      `salmonsRules.js`: `BOT_SWIPE`; a part of `salmons` only (`bearSwipe`) carries it, and
      `together` merges its parts' `botAim`, so the line's module alone still names only the
      line's. `roomSim.ts` is untouched (it already passes `rules.botAim`).
    - **Measured** (the harness of the table above, extended: "bears alone" is fishermen that
      never cast; the sitting salmon is put 1, 2 or 2.4 cells from a bear bot):

      | Salmon | Room            |                | At the source | Hooked | Swiped by a bear | First hook: median (range) | Cells swum, median | Casts | Hooks |
      | ------ | --------------- | -------------- | ------------- | ------ | ---------------- | -------------------------- | ------------------ | ----- | ----- |
      | Plain  | as shipped      | before both    | 0             | 24     | 0                | 24.2 s (8.9–46.8)          | 83                 | 35    | 24    |
      | Plain  | as shipped      | fishermen's    | 1             | 8      | 15               | 37.7 s (29.5–82.9)         | 190                | 168   | 8     |
      | Plain  | as shipped      | and the bears' | 1             | 9      | 14               | 49.8 s (29.5–84.8)         | 247                | 194   | 9     |
      | Dodger | as shipped      | fishermen's    | 2             | 8      | 14               | 37.7 s (29.5–83.5)         | 190                | 169   | 8     |
      | Dodger | as shipped      | and the bears' | 2             | 9      | 13               | 49.8 s (29.5–84.8)         | 247                | 194   | 9     |
      | Plain  | fishermen alone | fishermen's    | 10            | 14     | –                | 54.4 s (29.5–97.0)         | 330                | 276   | 14    |
      | Plain  | fishermen alone | and the bears' | 10            | 14     | –                | 54.4 s (29.5–97.0)         | 330                | 276   | 14    |
      | Plain  | bears alone     | fishermen's    | 3             | –      | 21               | –                          | 260                | 0     | 0     |
      | Plain  | bears alone     | and the bears' | 4             | –      | 20               | –                          | 282                | 0     | 0     |

      Sitting within a bear bot's reach: before, swiped in 24 of 24 rooms in the step he had it
      in reach; after, in 24 of 24, median 0.70 s, 9 in 10 by 0.93 s, the last after 1.00 s, one
      swipe each. On 96 seeds, as shipped: 5 at the source, 32 hooked, 59 swiped (the fishermen's
      alone: 4, 27, 65); bears alone 16 of 96 at the source (13).

    - **The reaction time, swept** (24 seeds; at the source / hooked / swiped as shipped, then
      at the source / swiped with bears alone): none 1 / 8 / 15 and 3 / 21; 0.15–0.35 s,
      0.2–0.5, 0.3–0.7 and 0.4–0.9 the same; 0.5–1.0 (shipped), 0.7–1.2 and 1.0–1.5: 1 / 9 / 14
      and 4 / 20; 1.5–2.5: 1 / 10 / 13 and 6 / 18; 2.5–3.5: 2 / 10 / 12 and 8 / 16; 4–6: 7 / 11
      / 6 and 16 / 8; 7–9: 10 / 13 / 1 and 23 / 1.
    - **Why it changes so little.** With bears that never swipe and fishermen that never cast,
      the swimmer comes within a bear's reach 47 times in 24 rooms and stays a median 3.0 s (9
      in 10 under 6.4 s). The longest stay in a room is under 1.5 s in 3 rooms of 24 (the three
      where no bear gets near it), under 3 s in 7, under 5 s in 14, under 8 s in 23.
    - **Against the targets set for it.** The straight swimmer at the source in a quarter to a
      half of rooms as shipped: not met (1 of 24), and not reachable by a reaction time a person
      has. A sitting salmon still swiped soon: met (0.70 s, the last after 1.00 s). Fishermen
      alone unchanged: met, to the number. What else was measured, and the two ways to read it,
      are in Open items.
    - **Gates.** `check:room-bots` 37 (32 before). Five new, each failing on a named mutation
      (no reaction time for a swipe; the clock running out of reach; a clock that survives
      leaving reach; no wait after a swipe; an unseeded reaction; a swipe limited by the line's
      numbers; Salmons naming none for its bears, or naming it on the line's module; the room
      dropping it). Changed in the earlier checks: the test's own limits moved under `aimed`
      (the shape, not what is asked), and the check that reads a room's `botAim` now expects
      `{ aimed }` of the line's module and `{ aimed, inReach }` of `salmons`, with one line
      added for the brain's stream under a swipe's limit. The two older bear checks (a bear bot
      catches a salmon by the shore, and one grounded on a sandbank) pass untouched.
      `check:salmons-jump` 37, `check:online-rules` 39 (the traces byte-identical),
      `check:room-sim` 42, `check:room-lobby` 16, `check:salmons-levels` 18,
      `check:salmons-heights` 24, `check:arcade-pointer` 22, `check:netcode` 28.
- 2026-11-19 — **The nearby box covers the screen** (#1798, merged 2026-11-19; a config number,
  a gate and load-test flags: no runtime bytes, the built runtime is the same size and differs
  from main's only in its build stamp and chunk names).
  - **The mismatch, measured** (headless Chromium at 1920 × 1080, the exported level, both
    netcodes): the room sent a player within 900 px up the river (18.75 cells) and 1200 px across;
    the screen showed 1440 px (30 cells) either way. Bears standing 20, 24 and 28 cells up the
    river from the page's own were on screen, 640 to 896 px left of its centre, and not in its
    state. Walked towards, each appeared 890–900 px away, about (−613, −307) px from the screen's
    centre, and vanished again at 23.8–24.3 cells (the room's 25 % margin), about (−750, −375). A
    390 × 844 phone had it along its long axis: on screen to 26 cells down the screen, sent to
    18.75.
  - **Cause**: P10.16 sized the box for a flat view the size of the design box. P11.4 turned the
    view (a screen shows a rectangle of the world turned 45°, its corners pointing along and
    across the river) and WS-C's `zoomIn: 'window'` made it grow with the window. The box is in
    the config, the camera in the layout; each was changed without the other.
  - **Fix**: `salmons.js` `nearby` is 3300 × 3300: what a 1920 × 1080 window (3198) and a 390 ×
    844 phone (3256) show.
  - **Guard**: `check:room-bots` "the nearby box covers what its camera shows on the windows
    above". From the exported config and layout it works out what each of the two windows shows,
    through `sceneCameraZoom`, `cameraZoom`, `zoomedView` and `isoViewRect` (the view's bounding
    box in the world, which is exactly what the room's axis-aligned test must cover), plus the
    largest body's half-size on every side (the bear's 46 px: the room tests where a player
    stands, the screen shows its look; a look stands on its feet, so at the phone's two lower
    corners a bear's head can still show about 16 × 8 px of screen unsent). It fails on 2400 ×
    1800 and on 3200 × 3200, naming the files to change, and fails if the screen stops being
    isometric, if the camera stops zooming in window px (what a window shows would then depend on
    the layout's box) or if it stops keeping its own player at the centre (a dead zone, a
    look-ahead, an auto-scroll, or being held inside the world): the check works none of those
    out.
  - **Verified at 3300 × 3300** (the same probe): at 1920 × 1080 the bears 15 to 28 cells up the
    river are sent and drawn (both netcodes), and so are bears at the screen's corners (31 cells
    along the river, 30 across); a player now appears 34.1–34.2 cells away and vanishes at 43.4,
    both off the screen. On the phone the bears 15 to 24 cells down the screen and at both lower
    corners are sent and drawn.
  - **Cost**, 100 devices in one room, 60 ± 20 ms, 30 s after a 3 s warm-up, a 4-core container,
    the exported config as it ships (its lobby, a level of the room's own). Budget: a device 10
    KB/s on average and 16 at most, 1 MB/s out.

    | Each salmon                                                 | Box         | KB/s a device: mean / most    | Out                  | Budget                 |
    | ----------------------------------------------------------- | ----------- | ----------------------------- | -------------------- | ---------------------- |
    | in the air about 40 % of the time (`--jump 0.02 --respawn`) | 2400 × 1800 | 5.75 / 11.58 and 5.57 / 11.00 | 0.561 and 0.544 MB/s | within                 |
    | the same                                                    | 3300 × 3300 | 7.88 / 13.14 and 7.86 / 12.80 | 0.770 and 0.767 MB/s | within                 |
    | in the air about 75 % of the time (`--jump 0.1 --respawn`)  | 2400 × 1800 | 8.15 / 16.75                  | 0.796 MB/s           | over (a device's most) |
    | the same                                                    | 3300 × 3300 | 11.42 / 19.21                 | 1.116 MB/s           | over (all three)       |

    `--jump` is the chance of a tap a step (30 a second); a tap in the air does nothing and a leap
    lasts 1.1 s. So 0.02 is a tap about every 1.7 s in the water, a leap every 2.8 s; 0.1 is three
    taps a second, about 0.7 leaps a second, near the most a salmon can leap.
    So +39 % out at the lower rate and +40 % at the higher. The rates are guesses at how people
    play, not measured play: a leap costs bytes (its height and the move it carries are synced
    while it lasts), nobody knows how often a room of people leaps, and at the higher rate the
    old box already missed the per-device most. A pinned level with no lobby read +47 %
    (0.82–0.83 against 0.56 MB/s). Steps held (29.9 of 30) and took at most 3.1 ms at p99 in
    every run. To repeat it: `scripts/salmons/export.mjs --out <dir>`, then
    `scripts/room-load.mjs --jump 0.02 --respawn --config` with the
    `invisible_wall/salmons/config/config.json` it wrote; add `--nearby 2400x1800` for the old
    box.

  - **Bot fishermen cast further** (after merging #1792, the entry below, which holds a bot's aim
    to his sight and to this box). The old box cut into his sight (25 cells across the river,
    18.75 along); this one covers it (the sight's corners are 31.9 cells out, the box 34.4), so in
    Salmons the sight alone limits him, as it limits a person on a 1920 × 1080 screen.
    `check:room-bots` now proves the box part of the rule on a copy of the game with the old box,
    and that with Salmons' own a bot casts at a salmon 21 cells along the river. Measured with a
    throwaway harness (not kept; the level config without its lobby, one salmon swimming up the
    middle of the water and jumping only when stopped, the room's bots, 24 room seeds):

    | Box         | Hooked   | Time to hook                 | Cells swum (median) | Hooked from   |
    | ----------- | -------- | ---------------------------- | ------------------- | ------------- |
    | 2400 × 1800 | 24 of 24 | 14.3–51.6 s, median 28.9 s   | 106                 | 20–26 cells   |
    | 3300 × 3300 | 24 of 24 | 9.0–49.6 s, median 24.2 s    | 82                  | 20–31 cells   |

    The old-box row agrees with #1792's own reading (14–47 s, median 27.6 s). So a swimming salmon
    is hooked about a sixth sooner. Whether bots should be softer is the owner call #1792 left
    open; holding a bot to less than this box would be a rule of its own.
  - **`scripts/room-load.mjs`**: `--jump <chance>` (each salmon's device taps jump with that
    chance a step), `--respawn` (a caught device presses Respawn as its own character) and
    `--nearby <w>x<h>` (the box to play the config with). Without them its devices send what
    they sent before, but the bare command plays `salmonsConfig()`, so it now measures the band
    river with the new box (one run: 7.2 / 9.83 KB/s, 0.70 MB/s, within budget); `--nearby
    2400x1800` plays the old one.
  - **Proof**, on the branch as merged (main's #1792 and #1797 in it): `check:room-bots` 26 (one
    new, one of #1792's reworked for the box; 23 before those merges), `check:online-rules` 39,
    `check:salmons-jump` 37; `salmons-play.mjs` 94 / 94 in each netcode (81 / 81 before #1797
    added its verdicts) and `salmons-levels-play.mjs` 28 / 28 on a runtime built from it. After
    merging #1792 only: `check:room-sim` 42, `check:room-lobby` 15, `check:salmons-levels` 18.
    Before the merges: `check:arcade-pointer` 22, `check:netcode` 28; launcher
    `check:salmons-export` 18, `check:game-config-family` 262, `check:arcade-camera` 87.
- 2026-11-19 — **A line reaches as far as its fisherman sees** (branch
  `claude/eloquent-planck-00ayqg`; in review; owner decision, superseding the 2026-11-18 "any
  range" and "a bot casts at any distance"; game-server change). The owner's report: "the fisherman
  is now able to cast very far away in the level, and the game is impossible to play cause you get
  caught right away as a fish […] a fisherman can only cast as far as he can see (screen size)".
  Two causes: `onlineBots.js` gave a `hook` ability an infinite reach, so every bot fisherman cast
  at its nearest salmon anywhere on the 400-column level, at its exact place; and
  `salmonsRules.js` `fishingLine.cast` landed the bobber on any water. The rule is the first bullet
  of Current state. Engine: `salmonsRules.js` (`SIGHT`, `inSight`, `pullIntoSight`; `fishingLine`
  pulls the aim in and answers `sees`, which `together` forwards), `onlineRules.js`
  (`OnlineRules.sees`, true when the module has none), `onlineBots.js` (`botInput`'s `sees` and
  `nearby`: a `hook` is aimed only at a target seen and inside the box; every other ability as
  before), `roomSim.ts` (passes both). No Game Config field, no validator or `/config` change, no
  device change: the device draws the line from the synced `lineX` / `lineY`, so a pulled-in cast
  is drawn where it landed, and all five runtimes build to the same bytes with and without the
  change (the manifests `check:runtime-bytes --out` writes are identical). The committed traces
  are unchanged (none cast past the sight). Live with the game server's deploy alone (Owner
  steps).
  Measured headless on the shipped config (`salmonsConfig(salmonsMapRiver(1))`, a room of bots per
  seed). A salmon that joins and holds up-river (it stays by the sea): before, hooked in 12 of 12
  rooms after 3.6–14.3 s by a bot 24–99 cells away (bot casts landed 24–361 cells out, median
  169); after, in 1 of 12 within 60 s (26.4 s, 20.9 cells; one cast in all), and 9 of 12 are
  alive after 300 s (two caught by bears). A salmon that swims up the middle of the water, tapping
  jump only when stopped: before, hooked in 24 of 24 rooms after 4.6–21.7 s (median 8.4 s, 27
  cells swum) from 30–100 cells; after, still in 24 of 24, after 14–47 s (median 27.6 s, 94 of the
  ~385 cells swum) from 10–26 cells, by the first bot fisherman whose sight it enters. That last
  part is the open owner call in Current state. Proof: `check:salmons-jump` 37, `check:room-bots`
  25, `check:online-rules` 39, `check:salmons-levels` 18, `check:salmons-heights` 24,
  `check:room-sim` 42, `check:room-lobby` 12, `check:arcade-pointer` 22; `salmons-play.mjs` 81 /
  81 in each netcode, `salmons-levels-play.mjs` 19 / 19, `online-play.mjs` 19 / 19.
- 2026-11-19 — **WS-C after WS-B and WS-D/E merged** (branch `claude/salmons-ws-c-world-camera`):
  #1758's screen-relative keys now turn through the camera's projector with
  `screenToWorldDirection` (each held axis once, normalised), not the layer's un-projection or an
  `isoUnproject` fallback; `check:arcade-pointer` pins mirrored Salmons' keys against the original's
  `input.js`. The fishing line (through `<SpawnLayer>`'s projector), the floating catch text and the
  win animation (screen space) needed nothing. `salmons-play.mjs`: the scripts' up-river keys are
  Up + Left on the mirrored screen; `stageOf` (a click) projects mirrored; the "swimming upstream"
  verdict's flake traced: page S, on the generator's snapshot, predicted its seed's river while the
  room played the authored one, so corrections swung its facing (and the 1500 ms down swim reached
  the whirlpool below the sandbank) — S now boots a snapshot with the room's own config, swims down
  only to above the pool, and the verdict takes the first held `swim_ne` mirrored; the golden
  salmon's colour is read as the brightest of a 7 × 7 px patch (one pixel hit a dark stroke at the
  camera's zoom). 81 / 81 in engine (×3) and colyseus (×4) runs.
- 2026-11-19 — **Eight facings for the bear and the fisherman; a clip-drawn catcher keeps its line
  and its catch text** (branch `claude/salmons-eight-facings`, PR #1797; in review; runtime and launcher
  change: arcade +1.3 KB gzip, of which +0.16 KB is the lazy `salmons-art` chunk; arcade3d
  +1.3 KB; lines, match3 and card byte-identical). Owner request: "edit the sprites for the bear and the fisherman … setup the 8 direction
  animations". The engine half only: no art, no starter frames, no seeder (where the frames come
  from is the owner's call; the guide covers the three routes). What it does is in Current state;
  here is what moved.
  - `engine-layout` `characterClips.ts`: `ClipFacing` is the eight (`ClipDiagonal` the four);
    new `clipFacing8Of`, `screenFlattening`, `clipMirrorOf`, `CLIP_FACING8_DEADBAND`, `CLIP_HAND`,
    `clipBox`, `clipPoints`, `characterClipsIn` (a component's block over the game's own);
    `resolveCharacterClip` takes the facing last seen (a tie); the
    normalizer keeps `facings` (4 or 8) and `hand` (two numbers) and drops anything else. A look
    with no `facings` turns and resolves exactly as before: the 11 old root checks and 18 old
    launcher checks are untouched and pass.
  - `SALMONS_CHARACTER_CLIPS` moved to `referenceLayouts/salmonsClips.ts` (plain literals;
    `salmons.ts` re-exports it, and the package entry exports it for the launcher).
  - `salmonsArt`: `floats.ts` is the rising text, taken out of `looks.ts` (`withFloats` is gone:
    a code look no longer carries `float`), standing in the players' layer over every player;
    `index.ts` adds `float`, `floats`, `floating`. The code looks draw as they did.
  - `apps/lines` `online.ts`: `gameClipsOf` and `clipLookOf` (Salmons' own clips for a component
    with none, its facings for a block that names none; it does not wait for the art, so a room
    whose art failed to load still plays clips), `clipBoxOf` and `PlayerLook.box` (a clip is drawn once its
    first frame is loaded; a code look made meanwhile is destroyed when the clip takes over),
    `standOf` (the hand and middle of whatever draws a player), `drawFloats`. The probe: `clips`
    lists drawn clips only; `art.hands` (each line's holder) and `art.floats` (by player) are new,
    and `art.looks[id].floats` is gone.
  - Launcher: `clipReachability.ts` `builtinClipPrefixes` and a seventh source in the clip walk
    (the game config; a failed read ships every clip, as any other source's).
  - **Not touched:** `SpawnLayer.svelte` and `arcadeClips.svelte.ts` (they are in every runtime's
    bundle; the clip box test is restated in `characterClips.ts` for that reason), the room, the
    rules, the bots, the salmon's look.
  - `salmons-play.mjs`: pages X, Y and V (playbook check 20b). X's facing is read on page Y,
    which draws him from the room's states: X, on the generator's snapshot (it needs the art),
    predicts its own player on a river of the room's seed while the room plays the authored one,
    and on some seeds that river blocks him (the trap page S met on 2026-11-19). The three pages
    run after page D: placed before it they brought what this machine's one address holds on the
    server (open pages plus the seats held 60 s for closed ones) to the default cap of 16, so D's
    socket was refused ("did not let it in ()"), and they moved D to the moment an emptied room
    is disposed, which its room count reads as a leak. The playtest's server now takes 32 an
    address, and D's verdict carries `heldBefore`.
  - **Known limits:** one hand point serves every facing (a per-facing hand is a small addition
    if the art needs it); nothing in a tool edits `characterClips` (the hand, the widths, the
    facings are code or a component upload); the line's Salmons style and the catch text are the
    art's, so a room whose art failed to load draws a plain line and no text, as before; a tall
    sprite's catch text starts over the top of its head.
  - **Measured:** bundles, base and this branch each built at one path with
    `check:runtime-bytes --out` (a build's bytes follow its checkout's path, so two paths differ
    by a few bytes a file): arcade 2 096 354 → 2 097 658 B gzip (+1 304: the main bundle +1 139,
    the lazy art chunk +162), arcade3d +1 267 (+1 106 and +160), lines, match3 and card
    byte-identical file for file. The committed `scripts/runtime-bytes/arcade.json` and
    `arcade3d.json` are CI's bytes and must be re-recorded from the PR's `runtime-bytes`
    artifact (a build here does not reproduce them, at `main` either). Playbooks on that build:
    `salmons-play.mjs` 94 / 94 with `--netcode colyseus` (2 runs) and with `engine` in 2 of 3
    runs; `salmons-levels-play.mjs` 19 / 19; `online-play.mjs` 19 / 19 in each netcode. The
    third engine run failed two older verdicts, each reading one screenshot pixel: page A's
    isometric place (a swimming salmon read back through the water's tint) and page T's bear fur
    (T predicts its own bear on a river of the room's seed, so its probe's place can part from
    the frame on screen). An earlier engine run failed page P's hover (89 px swum of the 100 it
    asks within 1.5 s of wall clock). None was seen in three runs at `main` (81 / 81 each).
    Those runs shared the machine with other playtests. Run again on an idle machine on a build
    of the final code: page T's failed in 1 of 3, the others in none. Page T's cause was the
    script: it read the bear one fixed second after its start, and the code look is made once the
    art has loaded in real time and turns to its heading as it is made, so the shot caught it
    mid-turn and the one pixel fell on the water beside it (the page reported the bear's sprite
    and no clip). The script now steps the page until the look is there; 94 / 94 in 5 of 5 engine
    runs since. Page A's and page P's were not seen again and have no cause found.
- 2026-11-19 — **The start menu before the join** (owner bug "the starting menu is now gone";
  branch `claude/eloquent-planck-00ayqg`, PR #1792; in review; runtime change, no game-server, flow,
  layout or config change). See Current state. `engine-mechanics` `online.js` `launchJoin` (new
  export); `engine-layout` `salmonsArt/startMenu.ts` (new; `chooseSalmonsStart`, exported from
  `engine-layout/salmons-art`), `screens.ts` (the lobby menu's name, river rows and splash shared
  with it), `winAnimation.ts` (`BUTTON` exported); `apps/lines` `online.ts` (`START_MENU`,
  `joinOnlineRoom` asks before it joins). Rejected: holding a person who joined with no choice out
  of play until they pick (a game-server change, a seat held by someone not playing, and the
  lobby screen, which the published flow shows only while the room waits, would have needed a new
  flow upload or a false `phase`). `salmons-levels-play.mjs`'s lobby room has no bots now (a bear
  bot standing on the catcher place a person is given would swipe them). `check:salmons-art` now
  reads a type import that spans lines and pins `START_MENU` to the Salmons generators. Bundle
  (`check:runtime-bytes` at the CI path against `main`'s manifests): `lines`, `match3` and `card`
  are the same bytes; arcade +1203 B gzip, of which +1056 B is the lazy `salmons-art` chunk only a
  Salmons room fetches and +144 B the bundle; arcade3d +1212 B (the same chunk, bundle +158 B: it
  carries the 2D online client). `scripts/runtime-bytes/{arcade,arcade3d}.json` re-recorded there.
- 2026-11-18 — **World drawing and camera as the original's** (WS-C of the gap report; branch
  `claude/salmons-ws-c-world-camera`; in review; runtime change: arcade +3.5 KB gzip, of which
  +2.1 KB is the lazy `salmons-art` chunk; arcade3d +3.5 KB (against main of 2026-11-19, after WS-A); lines, match3 and card unchanged).
  - **Mirror** (`engine-layout` `projection.ts`): `Scene.mirrored` beside `projection:
    'isometric'`; `ISO_PROJECTOR` / `ISO_PROJECTOR_MIRRORED` (`project`, `unproject`, `mirrored`,
    the ground turn), `sceneProjector(scene)`, `isoProjectMirrored` / `isoUnprojectMirrored`,
    `screenToWorldDirection(projector, dx, dy)` (the original's key vectors, pinned). The arcade
    runtime sets the projector (`worldDrawing.svelte.ts`) as it takes the camera; `IsoWorld`,
    `IsoTilemap`, the pointer (`SpawnLayer`'s un-projection, unchanged), the river art, the code
    looks' facings and the clips' facings draw by it. The lip and splash flips are gone.
  - **Camera** (`camera.js` `cameraZoom`, `zoomedView`, `mobileDevice`; `worldCamera.ts`
    `sceneCameraZoom`): `SALMONS_CAMERA` is `{deadZone 0, smoothing 0.1, clampToWorld false,
    zoom 2/3, mobileZoom 1/3, zoomIn 'window'}`, so a cell is 64 × 32 CSS px whatever the window
    (the layout's box scale is divided out; measured 0.74 design px a world px on a 1280 × 720
    page). `follow` adds the own code look's drawn leap lift to the shake, beside the ground lift.
    The probe's `camera` carries `zoom` and `leap`; its `view` is the world view.
  - **Bloodstains aligned** (after merging #1747): `blood.ts` `createBlood` takes the screen's
    projector (`worldDrawing().projector`; isometric by default), so stains and the trail sit at
    their mirrored places; `river.ts` `aboveWater()` lifts the reflections and upright art over the
    stains, the trail and the sunk salmon. Pinned in `check:salmons-art`.
  - **River** (`river.ts`): per row from the bands (`spanOf`), the grass band, forest walls, caps
    and beaches above; trees and decks stand in the spawn layer's container (`spawnLayerIn`, z by
    `isoDepthOrder` plus the original's offset), made when first in view; the rest of the upright
    art sorted by the original's z offsets. Fewer ground sprites: the levels page's heap 133 →
    ~80 MB.
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

- 2026-11-18 — **WS-B: catchers, scoring and round flow, as the original** (branch
  `claude/salmons-ws-b-catchers`; in review). See the first bullet of Current state. Engine:
  `abilities.js` (`ahead`, `onPress`, a `hook` cast through the caller's `cast`), `onlineRules.js`
  (`respawn: 'manual'`, `round.endsGame`, `gameWon`, the module hook `cast`, api `out`),
  `salmonsRules.js` (`fishingLine` rewritten, `goldenSalmon` from `wonLast`; `GOLDEN_WORTH` and
  the escape gone), `onlineBots.js`; Game Config `ahead`, `onPress`, `round.endsGame`,
  `rules.respawn`; game server schema fields `Input.respawn`, `Player.lineX/lineY/lineActive`,
  room `winnerName`, the room lock and the winner's pass (bloodstains: #1747). Not yet: the device's screens and drawing (WS-C, WS-D), the cast's aim from a
  key (WS-E).
- 2026-11-18 — **No glow under the golden salmon's art; page T's flake traced** (branch
  `claude/salmons-ws-de`; in review; runtime change). The original draws the golden salmon only
  with its `salmon_golden` texture (report §6.3, §9.4), no glow; since #1747 sinks a swimming
  salmon below the players' layer, the glow `<SpawnLayer>` draws for a marked player covered the
  fish. `online.ts` `drawMarks` now marks (glow and gold filter) only a player no code look draws:
  placeholders and clips keep theirs, the art's salmon its texture alone. The probe's
  `online.glowed` lists the glowing ones; `salmons-play.mjs` checks the golden salmons (A, G) are
  marked, golden-textured and not glowing, and the gold-colour checks are back to their old
  thresholds. Page T's intermittent failure ("stuck on loading", the camera off the bear) was
  the playtest's: T's frames run only when the script steps it, and it was stepped ~400 ms after
  its start, so its screenshot held the loading screen half faded over the river and the camera
  still easing; the faint overlay dimmed or missed the bear under the colour sample. Flow, probe
  and room were right throughout (`loading` hidden, `loaded`, T in the room and drawn). T is now
  stepped before its screenshot. Separately, the in-process server's 16 sockets-and-held-seats
  per address can refuse a late page (closed pages' seats are held 60 s): that page shows the
  standard "could not load" boot screen, not an endless loading screen.
- 2026-11-18 — **WS-D / WS-E against WS-B's d23983f** (branch `claude/salmons-ws-de`; in review).
  WS-B's tip merged (runtime-bytes conflicts taken as ours, re-recorded). The river list matches
  WS-B's `GET /rooms` (the URL, `[{ roomId, players }]`). A key-only cast before any move aims at
  the nearest free or grounded salmon. A hooked line ends at the salmon as drawn. The death and
  win screens report their buttons' places to the probe, a code look its floating texts.
  `salmons-play.mjs` against WS-B's rules: golden pages come in with a winner's pass
  (`issuePass`, seeded as the next join), bear bots may catch page B (it respawns as a bear through
  its death screen), H's first cast is J (aimed at the salmon), later ones a click on it; new
  verdicts for the river list route, G's death screen ("by Hal", Respawn as a salmon), H's
  floating "you catch Gil!", and page W winning at the source (`gameWon`, "You Won!", eggs, a
  pass; Join New Game lands in a new river, golden); G2 stays pink when the golden salmon leaves
  (no golden passed on).
- 2026-11-18 — **The original's screens, line and keys (WS-D / WS-E)** (branch
  `claude/salmons-ws-de`, WS-B merged in; in review; runtime change). See the first bullet of
  Current state. Engine: a canvas screen's top-level node can be drawn by an online room's art
  (`<LayoutScene>` reads `arcadeArt.svelte.ts` `fieldArtOf`, as `<IsoWorld>` does; nothing else
  publishes one); `InstanceLink.to` may be a world place (the bobber); code looks can float a text
  (`looks.ts` `withFloats`); `online.ts` `keysOf` / `screenMove` (behind Game Config
  `arcade.online.keys: 'screen'`, which only Salmons sets; every other game's keys as they were), `aimKeyCast`, `screenEvents`, `drawScreens`,
  `screenHost`, `takeNextJoin`, the own predictor rebuilt on a character change; Flow events
  `gameWon`, `respawned`, `respawnRefused`. Salmons' flow (`salmonsSeed.ts`): the lobby, the death
  screen (`caught` me → shown, `status` ≠ `out` → hidden), the win screen on `gameWon`; variables
  `secondsLeft`, `phase`, `status` (the room's). Removed: the HUD, the round over, the golden
  banner, the swipe / cast / splash placeholders and their flow. Playtests: `salmons-play.mjs`
  and `salmons-levels-play.mjs` press Up + Right for "up the river" (the keys are the screen's
  now); the HUD, swipe (now Space), round-over (now: no win screen without `gameWon`), splash and
  banner verdicts rewritten.
- 2026-11-18 — **`salmons_cliff` is in the project; the art upload runs from CI.** #1757 added
  the **Salmons art upload** workflow (`upload-art.py` with the release's R2 key, main only, dry run
  by default) and a repeatable `--sheet` filter on the script, so a sheet imported through the
  Sheet Maker cannot block another. A dry run listed exactly the cliff's three keys, then the
  `apply` run wrote them (`atlas_manifest_salmons_cliff.json`, `salmons_cliff.webp`,
  `salmons_cliff.json`). All five Salmons sheets are now project art.
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
