# Arcade — lessons

What has bitten arcade work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/game-families.md](../../status/game-families.md) and
[status/salmons.md](../../status/salmons.md); this file only keeps the traps. Invariants and the
family's own failure modes are in [families/arcade.md](../families/arcade.md). A component field
the launcher's read dropped (`characterClips`): [components.md](components.md).

### A player pressed against a river bank or a rock stopped dead

- **Symptom:** owner, 2026-11-24: players stick on the river's borders and on props.
- **Cause:** a bank is a stair of box zones and a rock a box; `stepSolid` slides along one flat
  face, so each step's underside and each corner stops a body. Screen keys push diagonally at it.
- **Fix:** `motion.js` `stepSlide` (`arcade.online.slide.corner`): round an end within the distance;
  lengths, not speeds, pick the way (a current must not turn a body back and forth).
- **Guard:** `check:arcade-slide`; `salmons-slide-play.mjs`. A new `onlineLevel` caller passes `online.slide`.
- **PR:** branch `claude/salmons-collision-slide` (2026-11-24)

### On a phone a held finger steered for a moment, then the player stopped for good

- **Symptom:** owner, 2026-11-21, on a phone: a held finger steers for a moment, then the player
  stops and stays stopped. A tap worked.
- **Cause:** the canvas's `touch-action: auto` (`pixi-svelte` `InitialiseApplication.svelte`, set
  for slots): the browser pans with a moving finger and fires `pointercancel`, which ends the
  press. A headless test that only holds a finger STILL never sees it.
- **Fix:** `touch-action: none` on the canvas while the pointer control listens (`online.ts`).
- **Guard:** `check:arcade-touch` (source pin); `salmons-touch-play.mjs` drags the held finger
  through the browser's real touch pipeline and asserts no `pointercancel`.
- **PR:** branch `claude/touch-controls` (2026-11-21)

### A playtest page's tap acted late, or aimed at the wrong place

- **Symptom:** building `salmons-touch-play.mjs` (2026-11-21): a tap acted late; a tap aimed wrongly.
- **Cause:** a page stepped faster than real time queues its inputs at the room; and a page whose
  config generates a different river than its room plays maps a tap to another place.
- **Fix:** pace the page's steps to real time; boot the page on the room's own game.
- **Guard:** none in a gate; a playbook rule.
- **PR:** branch `claude/touch-controls` (2026-11-21)

### A cast at the fisherman's feet played and spent its cooldown, but never hooked

- **Symptom:** on a bridge, a tap 0.1–0.3 cells off "cast" (`ability`, 250 ms cooldown), but no
  line showed and the salmon under the bobber was never hooked (found reading the rules, 2026-11-21).
- **Cause:** `salmonsRules.js` `fishingLine.cast` took a cast from 0.1 cells (the original's), but
  the same step's reel lands a line within `LINE.landCells` (0.3) before its hook test.
- **Fix:** `cast` refuses a landing nearer than `LINE.landCells`; `minCastCells` is gone.
- **Guard:** `check:online-rules` "a cast nearer its fisherman than the line is home is refused …".
- **PR:** branch `claude/salmons-line-edges` (2026-11-21)

### A fixed share of hunters on a river of one length makes a big room hard

- **Symptom:** a salmon that steers reaches the source in 22 of 24 rooms of 10 and 6 of 24 rooms
  of 100, on one mix (60 / 25 / 15) and with no bot number changed (2026-11-21).
- **Cause:** the level is as long at every size, so a share is a density: 4 hunters at 10, 40 at 100.
- **Fix:** none; an owner decision (status/salmons Open items: share by size, river length, the line).
- **Guard:** none gates difficulty. Measure every size a game ships or tests, never one:
  `scripts/salmons/measure-room.mjs --size <n>`.
- **PR:** branch `claude/salmons-room-size-bots` (2026-11-21)

### A join that leaves out a `filterBy` key matches any room of that type

- **Symptom:** none seen by a player; found building test rooms (`arcade-test`, matched by `game`
  and `size`): a join carrying no `size` could be seated in a test room of any size.
- **Cause:** Colyseus' `filterBy` drops a key the join does not carry instead of failing the match.
- **Fix:** the room checks it: `arcadeRoom.ts` `onJoin` refuses a join whose `game` or `size` is not
  the room's own; `onCreate` refuses a `size` that is not a whole number, never clamps one.
- **Guard:** `check:room-size` "live: a test room is its size … it never meets a public join".
- **PR:** branch `claude/salmons-room-size-bots` (2026-11-21)

### Bear bots walked beside bot salmon and never swiped

- **Symptom:** in the first rooms with bot salmon, bear bots followed them and caught none.
- **Cause:** `onlineBots.js` never presses an ability that hits the bot's own class for another
  bot (a bear's swipe hits bears, so bear bots would churn), and that skipped every bot target.
- **Fix:** it presses for a bot its brain chases (`createBot` `hunts`, the `chase` states' tags).
- **Guard:** `check:salmon-bots` "a bear bot swipes at a bot salmon it chases, and still at no
  other bot". A new bot class needs its hunters' brains to chase its tag.
- **PR:** branch `claude/salmons-room-size-bots` (2026-11-20)

### A bear that would not wade was the published project, not the code

- **Symptom:** owner, 2026-11-20, from the live game: "the bear have a bug, and by design, they
  should be able to go into the water"; and a circle on every swipe and cast.
- **Cause:** none in the code. The live game server and arcade runtime (`c98c63c`, read off
  `/healthz` and `x-runtime-release`) let a person's and a bot's bear wade on the original's levels
  and draw no circle. A live room swaps only the river's geometry into the PUBLISHED config
  (`generatedOnlineGame`), so its generator decides: one naming `salmonsRiver` (the band river)
  keeps bears on the banks. The re-export and re-publish after WS-A (Owner steps) was still
  listed as pending, and the old flow-v2.json spawned the `salmonsSwipe` / `salmonsCast` circles on
  `ability`. Not confirmed: reading the published snapshot needs its link's token.
- **Fix:** the owner step (re-export, upload `config.json`, `flow-v2.json`, `scenes.json`, publish);
  no code changed for either.
- **Guard:** `check:room-bots` "as exported, a bear walks into the water, a person's and a bot's"
  (fails if the export stops naming `salmonsMap` or the water is solid to bears);
  `check:salmons-art` "a press draws no circle". For a report from the live game, first compare
  `/healthz` and the runtime release with `main`, and the published documents with the export.
- **PR:** branch `claude/salmons-playable-bots` (2026-11-20)

### A playtest exited and left its test server running

- **Symptom:** three stray `services/test-server` processes after `salmons-play.mjs` (both netcodes)
  and `salmons-levels-play.mjs` (2026-11-19); one skewed a `scripts/room-load.mjs` reading.
- **Cause:** the wrong name behind `?.` of the entry below (`await server.close?.()` on a handle
  that has `stop()`). These two were missed then: their `process.exit` hid the hang, and it does
  not kill the child.
- **Fix:** `server.stop()` in both (#1799), then in the nine other playtests that called
  `server.close?.()`; each playtest `finally` now stops the test server first, so a throw in a
  later cleanup (`rooms.close()`, a snapshot) cannot leak it, and `sample-play` gained one.
- **Guard:** `pnpm check:playtest-teardown` (in `check:all`) fails a `scripts/playtest/*.mjs`
  that calls `.close` on a `startTestServer` result, does a bare `server.close?.()`, or never calls
  `stop()` on a server it starts. Stop-first order is not gated.
- **PR:** #1799 (2026-11-19, branch `claude/nice-clarke-4tagqa`); #1805 (2026-11-20, branch
  `scripts/playtest-stop-test-server`)

### Players appeared and vanished well inside the screen in Salmons

- **Symptom:** on a 1920 × 1080 window another player popped in two thirds of the way from the
  centre to the edge and out again: sent within 18.75 cells up the river, on screen to 30.
- **Cause:** `arcade.online.nearby` (config) was sized for a flat design-box view and never
  revisited when the camera (layout) turned isometric and then, with `zoomIn: 'window'`, grew
  with the window. Two documents, each right alone; nothing held one to the other.
- **Fix:** the box is 3300 × 3300 (`salmons.js`), measured first: a bigger box costs bandwidth.
- **Guard:** `check:room-bots` works out what `SALMONS_CAMERA` shows on a 1920 × 1080 window and
  a 390 × 844 phone and fails a box that does not cover it. A bigger window is also sent the
  view its own device declares (`shown.js`), and the same gate holds `nearby.max` to three of them.
- **PR:** #1798 · source: `docs/status/salmons.md`

### Bot fishermen hooked a salmon from across the whole river

- **Symptom:** the owner: "the fisherman is now able to cast very far away in the level, and the
  game is impossible to play cause you get caught right away as a fish".
- **Cause:** WS-B took the original's cast, which has no range limit, and gave it to bots:
  `botInput` gave a `hook` ability an infinite reach (`onlineBots.js`) and `fishingLine.cast` landed
  the bobber on any water (`salmonsRules.js`). The original has no bots; a person's only limit there
  is their screen, which a bot does not have.
- **Fix:** the limit is the room's rule: a line reaches a standard screen about its fisherman
  (`SIGHT`), a farther aim is pulled in to its edge, and a bot aims only at what the rules say it
  sees (`sees`) inside the `nearby` box a device there is sent.
- **Guard:** `check:room-bots` (never cast at out of sight, nor outside the box) and
  `check:salmons-jump` (the box, the pull-in, `SIGHT` held to the camera's zoom). A limit a person
  has only through their screen is written as a rule before a bot gets the ability.
- **PR:** #1792 (2026-11-19, branch `claude/eloquent-planck-00ayqg`) · source:
  `docs/status/salmons.md`

### The start menu was gone once a room was running

- **Symptom:** owner, 2026-11-19: "I am not able to play as a fisherman or a bear anymore! the
  starting menu is now gone!" Every open of Salmons played a salmon at once, with no menu.
- **Cause:** the menu was a screen of the room's lobby (`online.ts` `drawScreens`, shown by the flow
  while `phase` is `waiting`), and a room waits only before its first round. `joinOrCreate` puts a
  new page into the running room, which a reload's held seat (`rejoinSeconds`) keeps alive.
- **Fix:** the runtime shows the menu before the join (`engine-layout` `salmonsArt/startMenu.ts`,
  `engine-mechanics` `launchJoin`): a launch with no character joins only with what is picked.
- **Guard:** `check:room-lobby` (the launch's decision; a running room joined as a fisherman, as a
  bear) and `salmons-levels-play.mjs` (the menu over a running room, nobody added while it is up).
  A choice a person must make goes before the join, never on a screen one room phase shows.
- **PR:** #1792 (2026-11-19, branch `claude/eloquent-planck-00ayqg`) · source:
  `docs/status/salmons.md`

### A playtest printed every verdict and never exited

- **Symptom:** `arena3d-play.mjs` and `arcade3d-camera.mjs` printed all their PASS lines and then
  hung until killed; `arcade3d-play.mjs --online` too.
- **Cause:** the teardown called `await server.close?.()` on `startTestServer`'s handle, which has
  `stop()`, and `rooms.gracefullyShutdown?.()` on the game server, which has `close()`. The `?.` made
  each wrong name a silent no-op, so the child server kept the process alive.
- **Fix:** `server.stop()`, `rooms.close()`.
- **Guard:** none in a gate (playtests are not in `check:all`); a teardown calls its methods without
  `?.`, so a wrong name throws.
- **PR:** the 3D integration (branch `claude/3d-integration`, 2026-11-19)

### Every generated 3D room would have refused its devices as "another version"

- **Symptom:** found when merging the CrashArena generator (#1769) with the world fingerprint
  (#1779): a device in a `generator` room would compare unequal and stop on the error screen.
- **Cause:** the room put `worldHash3d(loaded.world3d)` (the authored config) in its state, while
  the device fingerprints the world it plays — the one `generatedWorld3d` makes from the room's seed.
- **Fix:** the room hashes `sim.world`, the world it steps (`arcadeRoom3d.ts`).
- **Guard:** `check:arena-3d`'s room case and the 3D room gates; a fingerprint hashes what both
  sides step, never what one of them was configured with.
- **PR:** the 3D integration (branch `claude/3d-integration`, 2026-11-19)

### A salmon at a waterfall's foot on sand could not climb it

- **Symptom:** `salmons-levels-play.mjs`'s height-8 cliff (an overlay waterfall in the delta) was
  never climbed: each tap leapt the salmon off the sand and it landed back on it.
- **Cause:** on an original level a salmon is grounded each time it comes down on sand (the
  original's rule, since 2026-11-18), and a tap that frees it leaps rather than climbs; only a
  second tap in the air climbs. The original's waterfalls never stand in sand (they end at gx 240,
  sand starts at 280), so only an authored overlay can put one there.
- **Fix:** none in the rules (they are the original's). Do not author a waterfall onto or next to
  sand in `levels.overlays`; the playbook's overlay removes the sand from its cliff to the sea.
- **Guard:** none in Game Config's validation (it would need the level per pinned seed);
  `salmons-levels-play.mjs` (the cliff climbed and crossed).
- **PR:** not recorded (2026-11-18, branch `claude/salmons-ws-a-movement`) · source:
  `docs/status/salmons.md`

### An event-loop stall left every online room's inputs waiting for good

- **Symptom:** after a server hiccup, online players' inputs took effect later and later, for the
  rest of the round (a 500 ms stall: ~420 ms of latency ten minutes later), in every room.
- **Cause:** Colyseus 0.18's `setFixedTimestep` runs at most five steps a timer tick and then
  throws the rest of the elapsed time away; devices kept sending at real time, and the room drains
  a backlog only against credit, which a backlog never earns.
- **Fix:** the timer only paces the room; `stepLedger.ts` runs the steps the wall clock owes, up to
  `CREDIT_SECONDS` at once. A framework's catch-up cap is a policy, not a fact about time.
- **Guard:** `check:room-sim` "an event-loop stall loses the room no time" (fails on one step a
  call); the 3D room's own in `check:room-sim-3d`.
- **PR:** 2026-11-18, branch `claude/rooms-wall-clock` · source: `docs/status/game-families.md`

### A corrected 3D player sank into a ramp and corrected forever

- **Symptom:** after any correction (a reconnect, a dropped input) a player standing on a ramp sank
  to the floor below on its own device and every later state corrected again (20/20 in review B's
  repro); a spawn on a 0.7 m box fell to the floor.
- **Cause:** the room simulates in float64 but sent the place as float32. Half the time the rounded
  place is a hair UNDER a sloped or non-float32 top, the landing test (`top <= y`) fails, and the
  body snaps down. The device had only the place, so velocities never reconciled either.
- **Fix:** the own device is sent the whole body exactly (float64, own-only view fields) and takes
  it in one correction; spawns keep their authored height. A rounding fix in the sim (frounding
  tops and places) could not hold a sloped top, whose height at a rounded `x` is not a float32.
- **Guard:** `check:room-sim-3d` "corrected while standing on a ramp" and "a spawn on a platform".
- **PR:** 3D review B findings 1, 2, 7 (2026-11-18, branch `claude/3d-sim-review-fixes`) · source:
  `docs/status/3d.md`

### A 3D player hovered by sending one input per gap

- **Symptom:** after the fix below, a hand-made client sending one input every `CREDIT_SECONDS`
  kept its body mid-air over a gap for as long as it liked (10 s at 60 Hz in the review's repro).
- **Cause:** the rest rule counted a SILENCE in a row, which any single input reset; the body's
  real lag behind the room's clock grew without bound while `credit` sat at its cap.
- **Fix:** rest whenever the body is `CREDIT_SECONDS` behind the room (`credit` at its bound): an
  exact lag, never reset by one input — a rule on what a client sends must survive a client
  that sends just enough.
- **Guard:** `check:room-sim-3d` "cannot hover" (fails on the silence counter).
- **PR:** 3D review B finding 4 (2026-11-18, carried in #1779; #1776 closed) · source:
  `docs/status/3d.md`

### A 3D level from a config could freeze the game server, and an idle player hung mid-air

- **Symptom:** #1717 merged with its review blocking: a large `arcade.world3d` level (or a tiny
  `cellSize`) made `createLevel3d` bucket unbounded cells; a negative trampoline height gave NaN;
  a player whose device stopped sending, or dropped, froze in mid-air for everyone.
- **Cause:** config numbers went into loops and `Math.sqrt` unchecked, and the fold rule
  ("no input = no step") had no exit for a device that never sends again.
- **Fix:** every config number bounded (coordinates ≤ 16 384 m — past 2^53 a `cx++` loop never
  ends; past it on the plane a body has fallen — `MOTION3D_LIMITS`, cells counted before bucketing, 64 colliders a cell, 256 zones, a
  body's sweep ≤ 2 cells), one collider query a step, trampoline height > 0 (clamped in `createLevel3d`), the level built once per world
  (`levelOf3d`), and a resting step after `CREDIT_SECONDS` of silence or while dropped, found by
  `createPredictor3d` on resume.
- **Guard:** root `check:arcade-3d` (caps, clamp, worst-level step time) and `check:room-sim-3d` (refusals under 100 ms,
  shared level, silent / dropped players, 0 corrections on resume).
- **PR:** fix for #1717 (2026-11-18, branch `fix/1717-game-server-freeze`) · source:
  `docs/status/3d.md`

### The rebuilt Salmons played a river the original game never made

- **Symptom:** the owner found the Scene Editor's level unlike the original's, only one of it, and
  thought the original generator had been removed.
- **Cause:** P10.16 wrote a new band generator instead of porting `generateMap` (its source was in
  another repository), and the export baked one seed of it into the scene; the generator also
  replaced any authored zones.
- **Fix:** the original ported line for line on its own PRNG (`salmonsMap.js`, `seedrandom.js`),
  `/editor` regenerating any seed, authored overlays in the Game Config.
- **Guard:** root `check:salmons-levels` (the original's recorded output for seven seeds; room,
  device and editor alike; an overlay survives a reseed).
- **PR:** #1699 (2026-11-17) · source: `docs/status/salmons.md`

### The owner was never asked to approve the Salmons art pass

- **Symptom:** S0 waited on an owner go that no session ever raised.
- **Cause:** S0 was written as "not a build step", so it had no row in game-families §8 (the
  table the coordinator walks) and no entry in STATUS.md's owner list.
- **Fix:** S0 got a §8 row and a `docs/STATUS.md` owner entry.
- **Guard:** none; an owner step needs a §8 row or an owner-list entry to be seen.
- **PR:** not recorded (2026-10-26) · source: `docs/status/salmons.md`

### A rig named only by a character sheet shipped, and the game never loaded it

- **Symptom:** in `salmons-play.mjs --rig` the sheet's rig was in the published art index and
  was never requested: the character stayed a placeholder, with no error.
- **Cause:** at boot the runtime leaves project art nothing names unloaded (`apps/lines`
  `stockAssets.ts` `editorArtUnused`), and it reads the game config after the normalizer, which
  drops a sheet. Export, deploy, bake and pull were right; "runtime register" was not.
- **Fix:** the art export lists a sheet's rigs and still images (`characterArt`) and both bakes
  carry the list as a bundle section, which the boot reads for names. No runtime code changed.
- **Guard:** `check:art-scope` case 15 (the index lists them); `stockAssets.fixture.ts` (a
  `characterArt` section keeps a rig and a sheet); `salmons-play.mjs --rig` (the fixture's sheet
  carries its frame names, so an unnamed one would be skipped).
- **PR:** character pipeline C6a (2026-11-20) · source: `docs/status/game-families.md`

### The smooth turn passed 53 checks and tipped the owner's bear over

- **Symptom:** `view.turn` leaned an isometric rig 23° about its feet, then snapped to the next
  facing with its walk restarted. The owner: "totally broken, snappy".
- **Cause:** a lean turns a subject seen from above; it tips an upright one. And #1891 was judged
  by gates on one-colour boxes, where all of that is numbers in range.
- **Fix:** the turn is a blend of the two pictures, phase kept; no lean on an isometric view.
- **Guard:** LOOK at `scripts/playtest/character-turn-strip.mjs` before and after; `check:character-turn`.
- **PR:** #1895 (2026-11-24) · source: `docs/design/character-pipeline.md` §13
