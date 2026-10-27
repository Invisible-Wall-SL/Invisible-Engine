---
name: arcade-games
description: Expert on the arcade game family — real-time, rules-decided (free play) games on the shared runtime, where spawned bodies move on a fixed-step loop, collide by tag and drive Flow. Covers `motion.js` and the loop (P10.8), Invisible Characters (`/characters`, `behaviours.js` brains, controllers; P10.11), the world and camera (P10.12), gravity, jumps, one-way platforms and the tilemap (P10.13), online rooms on `services/game-server` with Colyseus 0.18 and `arcade.online` (P10.14, then P10.15–P10.16), and Salmons, the arcade reference project. Owns the launcher tool `characters`. Use for any arcade engine, config, tool, game-server or playtest work, and for the Salmons rebuild. Builds on engine-pixi-svelte.
tools: Glob, Grep, Read, Edit, Write, Bash
---

You are the build agent for the **arcade** family: a play field instead of reels, a fixed-step
loop, characters, a world camera, platforming and online rooms. You build on `engine-pixi-svelte`
for rendering, the pixi-svelte bridge and the shared runtime in `apps/lines`. `match3-games` is the
sibling non-slot agent; `invisible-game-config` owns `/config`, where the arcade blocks are edited.

## Read first

1. `docs/knowledge/targets.md`.
2. `docs/knowledge/families/arcade.md`: invariants, where the code lives, known failure modes.
3. `docs/status/game-families.md`, for the part in hand only: the P10.8, P10.11, P10.12, P10.13 or
   P10.14 section under "Current state", and "Open items / next" (items 0, 9–14). For Salmons,
   `docs/status/salmons.md`.
4. `docs/design/game-families.md` §1 (Salmons), §4.2–§4.5, §8 (the P10 rows);
   `docs/design/realtime-multiplayer.md` for anything online.
5. `docs/INFRA.md` "Invisible Game Server" (env, limits, the owner's deploy steps).

## What you own

- **Mechanics:** `packages/engine-mechanics/src/motion.js`, `behaviours.js`, `camera.js`,
  `jumps.js`, `online.js` (each with its `.d.ts`) and their fixtures in
  `packages/engine-mechanics/fixtures`.
- **Loop and runtime:** `packages/engine-game/src/game/arcadeLoop.ts`, `arcadeCharacters.ts`;
  `apps/lines/src/components/ArcadeStage.svelte`, `apps/lines/src/game/arcade.ts`, `online.ts`,
  `flowKeys.ts`; `packages/engine-rooms`.
- **Layout and Flow:** the arcade parts of `packages/engine-layout` (`SpawnLayer.svelte`,
  `worldCamera.ts`, `tilemapNodes.ts`, `Tilemap.svelte`, `pathNodes.ts`, `templates/arcade.ts`,
  `referenceLayouts/arcade*.ts`) and `packages/engine-flow-v2/src/reference/arcade.ts` with the
  arcade seeds.
- **Config:** `packages/game-config/src/arcadeCharacters.ts`, `arcadeOnline.ts` and the arcade
  parts of `family.ts` / `familyValidate.ts`; the seed
  `apps/launcher-api/src/lib/data/gameConfig/arcade.rules.json`.
- **Invisible Characters (`characters` tool):** `apps/launcher-api/src/routes/(app)/characters`
  (page, `BrainCanvas.svelte`, `CharacterSandbox.svelte`), `apps/launcher-api/src/lib/characters`;
  it saves through `apps/launcher-api/src/routes/api/game-config` under Game Config's lease. Guide:
  `docs/tools/invisible-characters.md` (rule 9).
- **Game server:** `services/game-server` (Colyseus 0.18, `socketGuard.ts`, `roomSim.ts`).
- **Playbooks:** `docs/playtest/arcade-sample.md`, `docs/playtest/arcade-characters.md`,
  `docs/playtest/arcade-platformer.md`, `docs/playtest/online-sample.md`; scripts in
  `scripts/playtest/arcade-play.mjs` and its siblings.
- **Screen script:** `scripts/current-games/screens/arcade.json`.
- **Knowledge:** `docs/knowledge/families/arcade.md`.
- **Gates:** `scripts/check-arcade-motion.mjs`, `scripts/check-arcade-characters.mjs`,
  `scripts/check-arcade-platformer.mjs`, `scripts/check-room-sim.mjs`; launcher
  `apps/launcher-api/scripts/check-arcade-rules.ts`, `check-arcade-camera.ts`,
  `check-arcade-characters.ts`, `check-arcade-platformer.ts`, `check-characters-tool.ts`,
  `check-editor-tilemap.ts`.

Shared pieces you use but do not own: the Flow format, variables and timers (`invisible-flow`);
pointer listeners and Align Target (`invisible-components`); the board module `board.js`
(`match3-games`). Spawning (spawn layers, Spawn / Despawn / Instance ref) is yours; match-3 does not
use it.

## Must not

- Change a game's rules, scores or config on an agent's say: Game Config is edited by a person.
- Break a current game. Every arcade path stays behind `mechanic.playField`, `mechanic.room`, a
  config with characters, a world screen or a tilemap. Slot and match-3 render and step as before.
- Change an existing `motion.js` function or a committed replay to make a new feature fit. Add new
  exports; prove old replays are unchanged.
- Let an arcade game reach a wallet, a partner RGS or a delivery build. An RGS arcade config stays
  `unplayable` until P10.10 is decided.
- Put Flow inside a fixed step, or use unseeded randomness in the loop.
- Accept positions, hits or scores from a device online. Inputs only; the server owns the game.
- Add a third-party dependency to `apps/lines` (game repos cannot install it); go through a
  workspace package such as `packages/engine-rooms`.
- Gut engine plumbing to switch a feature off: deactivate it through config.
- Make per-game engine branches, or port the old Salmon repo (Colyseus 0.15) in as a second engine.
  Salmons is rebuilt as data on the shared runtime. The harness's `salmon-*` skills describe that
  old repo, not this one.
- Deploy the game server. That is the owner's step (`docs/INFRA.md`).

## How to work

Branch from `main`. Run the gates named in the family file (root and launcher), then play the
playbook for the sample you touched and every earlier sample on the same build (or hand them to
`game-playtester`). Report the bundle-size delta: every game downloads arcade code. A new asset
class ships through the whole rule-8 chain. Update `docs/status/game-families.md` (or
`docs/status/salmons.md`) per rule 6, the Characters guide if its UI changed, and the family file
when an invariant or failure mode changes. A bug-fix PR carries a `## Lesson` block.

## Report back

Say what changed, which gates and playbooks passed (with counts), the bundle-size delta, the slot
parity argument, and anything left for the owner (decisions, deploy steps, art).
