# salmons — game brief

The `salmons` portal project: today the arcade sample dodger, kept as the test bed for the Salmons
art pass. Owner agent: `arcade-games` ([family](../families/arcade.md)).

## What it must be

- **Target:** Salmons, a 100-player real-time online game
  ([realtime-multiplayer](../../design/realtime-multiplayer.md),
  [game-families](../../design/game-families.md) §1, P10.16), rebuilt here **as data** on the shared
  runtime, never ported in as a second engine.
- **Today:** the P10.8 placeholder dodger (a salmon, falling bears and hooks, fish to catch),
  Game Config family `arcade`, "Salmon Run", free play. It is **not** Salmons yet; the owner
  once expected the real game and got the generic dodger.
- The Salmons players reach today lives in the separate `GuiltyForever/Salmon-` repo (Colyseus 0.15,
  PixiJS) and deploys from there. Nothing merged here changes it until P10.16.
- Client: `invisible_wall`.

## Kind and add-ons

- Kind `arcade`, rules-decided (free play) only: no RGS, no wallet, no delivery build. An
  RGS-decided arcade config does not boot or publish. No add-ons.
- Owner decisions (2026-10-26): licence-clean models only; this project is reused for the rebuild;
  4 facings (per-game option, game-families §9 #28).

## Where it lives

- Content: `invisible_wall/salmons/` in R2; snapshots under `…/published/` (`docs/INFRA.md`).
  Leftovers: a test background (`Background_Test_1`) and the old Book-of flow under
  `editor/flow-v2-backups/`.
- **Art:** the original art is built into the engine (`engine-layout` `salmonsArt/`) and, once
  `scripts/salmons/upload-art.py --apply` has run, also the project's sheets `salmons_terrain`,
  `salmons_props`, `salmons_characters`, `salmons_waterfall_face` (locked, region names unchanged).
  A published project sheet wins region by region; the built-in copy is the fallback. Never rename
  a region: the drawing code names them.
- Online: published to the test server 2026-10-26. Online rooms (`services/game-server`, P10.14)
  are built but not deployed and not used by this project.

## How it is tested

- Playbook: [arcade-sample.md](../../playtest/arcade-sample.md) (the same scaffold it plays).
  Online rooms: [online-sample.md](../../playtest/online-sample.md) (local, not this project).
- Current games: [`arcade.json`](../../../scripts/current-games/screens/arcade.json) (base, steer,
  round-over; held arrow keys, the starter flow's `roundOver` screen). Before its 2026-10-26
  publish the harness listed it "no published pointer".
- A free-play stall that main shares is a note, not a fail (PR #1374).

## State and quirks

- **Levels are the original game's, by seed** (`salmonsMap`, since 2026-11-17): never write a new
  generator for Salmons; change `salmonsMap.js` only against the recorded original
  (`check:salmons-levels`). Authored additions go in Game Config `arcade.online.levels.overlays`,
  never in the scene's river node, which `/editor` regenerates.
- **The salmon's leap is the original's** (`salmonsRules` `salmonJump` + `salmonsArt/leap.ts`, since
  2026-11-17): its heights and pose are the old game's numbers, pinned by `check:salmons-jump`.
  Change them only against the original (`GuiltyForever/Salmon-` 41811c2), never by feel.
- **Waterfalls are as high as the original's, and so is the climb** (since 2026-11-17): the
  climb (`salmonsRules` `waterfallClimb`: 2.4 cells a tap, 0.8 cells/s back, no teleport) and the
  raised river (`engine-layout` `referenceLayouts/salmonsElevation.ts`, `salmonsArt/river.ts`,
  `cliff.png`) are pinned by `check:salmons-heights`. Change them only against the original.

- **S0 art pass approved 2026-10-26** ([salmons status](../../status/salmons.md)). Next: generate
  the 22 character clips in the launcher's tools (Atlas Maker, Flipbook, FX on ComfyUI); none yet.
  Needs a person at the tools: a cloud session has no launcher account or R2 write.
- After its kind switch, re-scaffold kept the old Book-of flow and the first publish was broken.
  Fix used: delete `editor/flow-v2.json`, re-scaffold, publish. Guarded now by
  `replaceOtherKindDocs` and the `flow-wrong-kind` publish refusal (PR #1369).
- Deleting the starter's `complete:loading` chain leaves the loading screen up after the tap.
- Placeholder shapes draw up and left of their bodies (known, not fixed; family file).
