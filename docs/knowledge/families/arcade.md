# Arcade — family knowledge

What is always true about arcade games, where their code lives, and what has gone wrong before.
Owner agent: `arcade-games`.

## What it is and must stay

An arcade game is a **real-time play field** on the shared runtime (`apps/lines`), not reels. Bodies
spawned on a spawn layer move on a fixed-step loop, collide by tag pair and raise Flow signals. Flow
keeps the score and lives. On top of that (Phase 10, `docs/design/game-families.md` §4.2–§4.5):

- **A1, P10.8:** `motion.js` and the fixed-step loop; the Game Maker `arcade` kind is a salmon
  dodger with placeholder shapes.
- **A2, P10.11:** characters (look, body, movement, controller, brain), authored in **Invisible
  Characters** (`/characters`).
- **A3, P10.12–P10.13:** a world bigger than the screen with a camera and parallax; gravity, jumps,
  one-way platforms and the `tilemap` node.
- **A4, P10.14–P10.16:** online rooms on `services/game-server` (Colyseus 0.18). P10.14 is built
  and not deployed. Netcode (P10.15) and bots, load test and Salmons (P10.16) are not built.

Arcade is **rules-decided (free play) only**. An RGS-decided arcade config is `unplayable`: it does
not boot and does not publish (P10.10 is optional and undecided). It never reaches a wallet, a
partner RGS or a delivery build.

**Salmons** (`docs/status/salmons.md`) is the target: a 100-player online game. The live Salmons is
in the separate `GuiltyForever/Salmon-` repo (Colyseus 0.15). Here it is rebuilt **as data** on the
shared runtime in P10.16, never ported in as a second engine. The `salmons` portal project plays
the P10.8 dodger today, as the S0 art test bed.

Must never change: slot and match-3 games render and step exactly as before. Every arcade path is
keyed on an arcade-only switch. A stored config without the new fields comes back byte for byte.
A seed and the same keys replay the same game.

## Invariants

- **One mechanic decides the branch.** `mechanicFor` returns `ARCADE_RULES_MECHANIC` (`playField`,
  `rgsSession: false`) or `ARCADE_ONLINE_MECHANIC` (also `room`). An RGS arcade config is
  `unplayable`. Enforced in `packages/engine-game/src/game/mechanic.ts`; pinned by
  `check:arcade-rules`.
- **Publishing follows playability, not family.** `apps/launcher-api/src/lib/server/familyGate.ts`
  refuses only `unplayable` configs. A rules game is dealt the refusing `freePlay` mock.
  `scripts/delivery-family-gate.mjs` refuses every arcade game for delivery.
- **Fixed step.** `createFixedStep` runs at most 5 steps a frame and drops a larger backlog. Same
  state at 30, 60 and 144 fps (`packages/engine-mechanics/src/motion.js`; `check:arcade-motion`).
- **Flow is never inside a step.** Signals (`collide`, `leaveBounds`, `enterZone`, `enterView`, …)
  are edges, queued and raised after the frame in order (`packages/engine-game/src/game/arcadeLoop.ts`).
- **Seeded randomness.** `?arseed=` seeds the loop; without it `Math.random`, which is seeded under
  `?ie_determinism=` (`apps/lines/src/game/arcade.ts`). The camera shake has its own stream
  (`<seed>:camera`), so `$engine.random` replays as before.
- **New mechanics are new exports.** P10.11 and P10.13 added functions to `motion.js`; old
  functions and committed replays (`packages/engine-mechanics/fixtures/arcade-*-replay.json`) do not
  change. A level with no tiles and no falling character still steps with `stepSolid`.
- **`engine-mechanics` is dependency-free plain ESM** with `.d.ts` beside it. The game server and
  the device import the same file (`packages/engine-mechanics/src/online.js`).
- **Online is inputs only.** A device sends `{seq, moveX, moveY, buttons, aimX, aimY}`. The server
  owns every place. The room's body equals the device's `stepPlayer` fold bit for bit
  (`services/game-server/src/roomSim.ts`; `check:room-sim`).
- **The Colyseus SDK is reached only through `packages/engine-rooms`**, imported dynamically from
  `apps/lines/src/game/online.ts`. `apps/lines` declares no new third-party package
  (`check:game-app-deps`).
- **Sparse config.** Every arcade field is optional and defaults are dropped
  (`packages/game-config/src/family.ts`, `arcadeCharacters.ts`, `arcadeOnline.ts`;
  `check:game-config-family`).
- **Rule 8.** A character's look and `shootAt` shots ship even when no scene places them; painted
  tileset regions ship through the art export (`apps/launcher-api/src/lib/server/runtimeBundle.ts`,
  `editorArtExport.ts`; `check:art-scope` cases 8 and 9).
- **Characters live in the game config.** `/characters` saves through `PUT /api/game-config` under
  Game Config's lease and needs the Game Config grant too.
- **Arcade-only tool.** `FAMILY_TOOLS` in `apps/launcher-api/src/lib/roles.ts` hides Characters
  from slot and match-3, and Symbols and Win Text from arcade (`check:family-tools`).

## Where the code lives

| Area                  | Paths                                                                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mechanics (plain ESM) | `packages/engine-mechanics/src/{motion,behaviours,camera,jumps,online}.js` + `.d.ts`; fixtures in `packages/engine-mechanics/fixtures/`                                                                                               |
| Loop                  | `packages/engine-game/src/game/arcadeLoop.ts`, `arcadeCharacters.ts`, `mechanic.ts`                                                                                                                                                   |
| Runtime               | `apps/lines/src/components/ArcadeStage.svelte`, `apps/lines/src/game/arcade.ts`, `online.ts`, `flowKeys.ts`, `flowBoardEffects.ts`                                                                                                    |
| Layout                | `packages/engine-layout/src/lib/SpawnLayer.svelte`, `worldCamera.ts`, `worldCameraView.svelte.ts`, `tilemapNodes.ts`, `Tilemap.svelte`, `pathNodes.ts`, `arcadeLifts.svelte.ts`, `templates/arcade.ts`, `referenceLayouts/arcade*.ts` |
| Flow                  | `packages/engine-flow-v2/src/reference/arcade.ts` (`ARCADE_VOCAB`), `arcadeSeed.ts` (starter) and the sample seeds                                                                                                                    |
| Config                | `packages/game-config/src/family.ts`, `familyValidate.ts`, `arcadeCharacters.ts`, `arcadeOnline.ts`; seed `apps/launcher-api/src/lib/data/gameConfig/arcade.rules.json`                                                               |
| Characters tool       | `apps/launcher-api/src/routes/(app)/characters/`, `apps/launcher-api/src/lib/characters/characterEdit.ts`                                                                                                                             |
| Editor                | `EditorWorldCamera.svelte`, `EditorParallax.svelte`, `EditorSpawnLayer.svelte`, `EditorTilemap.svelte`, `tilemapPaint.client.svelte.ts` in `apps/launcher-api/src/routes/(app)/editor/`                                               |
| Game server           | `services/game-server/src/` (`arcadeRoom.ts`, `roomSim.ts`, `socketGuard.ts`, `addresses.ts`, `configSource.ts`); `packages/engine-rooms`                                                                                             |

## Known failure modes

- **Symptom:** after switching `salmons` to arcade and re-scaffolding, the published game was an
  arcade runtime driven by a slot flow and was broken. **Cause:** re-scaffold only creates missing
  files, so the old Book-of `editor/flow-v2.json` survived
  (`apps/launcher-api/src/lib/server/projectScaffold.ts`). **Guard:** `replaceOtherKindDocs`, and
  the `flow-wrong-kind` publish refusal (`flowTemplateMismatch` in
  `packages/engine-flow-v2/src/reference/flowKind.ts`) (PR #1369).
- **Symptom:** the loading screen stays up after the tap. **Cause:** an edit deleted the starter's
  `complete:loading` chain, which starts the round (`arcadeSeed.ts`). **Guard:** none.
- **Symptom:** every standalone game repo's Publish failed with `Rollup failed to resolve import
"@colyseus/sdk"`, online or not. **Cause:** the SDK was declared in `apps/lines` only; game repos
  install from their own root and the desktop backfill adds only workspace packages. **Guard:**
  `check:game-app-deps`; the SDK lives in `packages/engine-rooms` (PR #1397).
- **Symptom:** the current-games check failed every PR on the arcade row. **Cause:** the harness
  played arcade games with the slot `lines` script. **Guard:** `scripts/current-games/screens/arcade.json`
  and `scriptFor` in `scripts/current-games/lib/plan.mjs`, pinned by `play.fixture.mjs` (PR #1374).
- **Symptom:** three bytes could stop every room. **Cause:** `@colyseus/schema` 5.0.42's decoder
  for unreliable inputs loops for ever on a negative slot length. **Guard:**
  `services/game-server/src/socketGuard.ts` allows only four frame types; `check:room-sim` live
  cases (PR #1375). Not yet reported upstream.
- **Symptom:** one bad request could end the game-server process. **Cause:** Colyseus' router
  (better-call) builds a `Request` unguarded; a bad `x-forwarded-proto`, `Host` or `TRACE` threw.
  **Guard:** the server refuses them before the router; `check:room-sim` (PR #1375).
- **Symptom:** a fast body passes through a thin wall. **Cause:** `stepSolid` moves in one step.
  **Guard:** falling and hopping characters use `stepPlatform` sub-steps (`MAX_SUB_STEPS` 64);
  `check:arcade-platformer` gates no tunnelling at 6000 px/s. A plain character can still tunnel.
- **Symptom:** an online game's camera stays at the origin; its characters, brains and Flow board
  effects do nothing. **Cause:** a `room` game never starts the local loop that owns them.
  **Guard:** `validateArcadeOnline` warns at `arcade.characters`; fixed only by P10.15.
- **Symptom:** a keyboard character does not move in the game. **Cause:** controllers read the Flow
  input map's `left` / `right` / `up` / `down` actions (`apps/lines/src/game/flowKeys.ts`).
  **Guard:** none (guide trap).
- **Symptom:** a Flow graph stops affecting a renamed character. **Cause:** renaming does not
  follow references. **Guard:** none.
- **Symptom:** bodies vanish or despawn early on a world screen. **Cause:** the loop expects the
  spawn layer at the world's origin; one placed off it is culled by its offset (`arcadeLoop.ts`).
  **Guard:** none.
- **Symptom:** the P10.8 placeholder shapes draw up and left of their bodies. **Cause:** a `rect`'s
  default anchor plus a `-w/2` offset. **Guard:** none (seen in P10.11, not fixed).
- **Symptom:** an edited layout, camera or tilemap does not change a running game. **Cause:** they
  are read once when the loop first sees them. **Guard:** none; reload.
- **Symptom:** `check:family-tools` was red on `main`. **Cause:** its tool baseline did not know
  tools merged beside P10.11. **Guard:** update the baseline in the same change as a new tool.
- **Symptom:** the owner was never asked to approve the Salmons art pass. **Cause:** S0 had no row
  in game-families §8, the table the coordinator walks. **Guard:** S0 now has a §8 row and a
  `docs/STATUS.md` owner entry.

## How to test

- **Root gates:** `pnpm check:arcade-motion`, `pnpm check:arcade-characters`,
  `pnpm check:arcade-platformer`, `pnpm check:room-sim` (starts a real Colyseus server, ~30 s),
  `pnpm check:game-app-deps`. Each mechanics gate compares a committed replay (`--update` rewrites
  it; only when the change is meant to move it).
- **Launcher gates** (`pnpm --filter launcher-api <name>`): `check:arcade-rules`,
  `check:arcade-camera`, `check:arcade-characters`, `check:arcade-platformer`,
  `check:characters-tool`, `check:editor-tilemap`, `check:editor-world-camera`,
  `check:layout-path`, `check:game-config-family`, `check:family-tools`, `check:art-scope`,
  `check:component-state-machine`.
- **Playbooks** (headless browser, branch runtime): `docs/playtest/arcade-sample.md`
  (`scripts/playtest/arcade-play.mjs`), `docs/playtest/arcade-characters.md`,
  `docs/playtest/arcade-platformer.md`, `docs/playtest/online-sample.md` (two pages, local game
  server). P10.12's river: `scripts/playtest/arcade-camera-play.mjs`. Run all of them after a loop
  change: each later step re-proves the earlier samples.
- **Current games:** `scripts/current-games/screens/arcade.json` plays the `cg-arcade` fixture
  (boot, falling, a held ← steer, round over, again). No fixture yet for the camera, characters,
  platformer or online samples (open item 9).
- **A reviewer looks at:** slot parity (every new path behind `playField`, `room`, characters, a
  world or a tilemap), byte-identical normalizing of old docs, unchanged replays, the bundle-size
  delta (every game downloads arcade code), and the rule-8 chain for any new asset.

## Read more

- `services/director-worker/families/arcade.md`: what Director's runtime agents read about this
  family (the whole pack). The pack is the one home of that text; edit it there.
- `docs/status/game-families.md`: P10.8, P10.11–P10.14 sections and open items 0, 9–14.
- `docs/status/salmons.md`: the S0 art pass and the `salmons` project.
- `docs/design/game-families.md` §1 (Salmons), §4.2–§4.5, §8; `docs/design/realtime-multiplayer.md`.
- `docs/tools/invisible-characters.md`, `docs/tools/invisible-editor.md`, `docs/tools/game-config.md`.
- `docs/INFRA.md` "Invisible Game Server" (env, local run, the owner's deploy steps).
