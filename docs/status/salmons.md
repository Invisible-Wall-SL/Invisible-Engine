# Salmons (arcade reference project) — status

> Plan: [design/game-families.md](../design/game-families.md) §1 (Salmons and its art pass, S0), §4.3–§4.5, P10.16 · Online rooms: [design/realtime-multiplayer.md](../design/realtime-multiplayer.md) · The sample it builds on: [playtest/arcade-sample.md](../playtest/arcade-sample.md) · Agents: `atlas-python-tools`, `invisible-flipbook`, `invisible-fx`, `invisible-components`, then per phase

**One-line state:** the owner approved the art pass (S0) on 2026-10-26. No S0 art exists yet: the
`salmons` project holds one test background. Step 0, reading what the Salmon repository already
did, waits on access to that repository.

## Current state

- **The Salmons that players reach today is not built from this repository.** It lives in
  `GuiltyForever/Salmon-` (a Colyseus 0.15 server and a PixiJS client) and deploys from there.
  Nothing merged here changes it until P10.16 rebuilds it on the shared runtime and moves its
  players over.
- **The `salmons` portal project** (client `invisible_wall`), read from R2 on 2026-10-26
  (read-only):
  - one test background from 2026-06-02: `sheet_src/Background_Test_1/backgroundTest1.png`, its
    sheet `sheets/Background_Test_1/` and `manifests/atlas_manifest_Background_Test_1.json`;
  - an empty scene list (`editor/scenes.json`) and no strings;
  - a Flow doc that is the **Book-of template's** (`templateId: bookOf`, 97 nodes), last saved
    2026-10-26 07:37 UTC. The project was made as a slot project, not with Game Maker's `arcade`
    kind, so it has none of the arcade scaffold (the spawn layer, the HUD, the starter flow, the
    four sample components);
  - no published game (the current-games report lists it as "no published pointer").
- **The two design docs disagree about Salmons' art, and our R2 cannot settle it.**
  game-families §1 (2026-10-22) says the art is a test set that is not ready for the pipeline,
  hence S0. realtime-multiplayer §2 item 4 (2026-10-25, read against Salmon `main` c16ba9e) says
  "its art is already in the pipeline and its characters already play clips by action and facing",
  citing the Salmon repository's `docs/art-pass.md`. None of that art is in the `salmons` project,
  so if a pass happened, it happened inside the Salmon repository. Step 0 settles it.

## Open items / next (S0)

The target is game-families §1's: one isometric angle, characters animated per facing,
transparent props, diamond tilesets, all in R2 under a Salmons project. Each item names the tool
that makes it and the build step that uses it.

0. **Reconcile with the Salmon repository.** Read its `docs/art-pass.md` and its asset folders.
   List what can be imported as it is (a sheet the Atlas Maker takes), what is a reference only
   (ComfyUI input, under the project's `input/refs/`), and what is missing. Then correct whichever
   design doc is wrong. Needs the repository (Blocked).
1. **Pick licence-clean models before generating anything that will ship.** Every built-in image
   default is blocked for commercial use, and every cutout uses RMBG-2.0, which is CC BY-NC
   ([model-licences](../reference/model-licences.md)). For S0: FLUX.2 klein 4B or Qwen-Image 2512
   for stills, Qwen-Image-Edit-2509 to keep a character the same across facings, BEN2 or BiRefNet
   for cutouts, and Wan 2.2 (Apache) for Flipbook video. Each variant's `provenance.json` then
   reads `clear`.
2. **The slice: four sprites for the arcade sample** (§9 #6; the soonest result a player can see).
   An isometric salmon, bear, hook and fish, each a transparent still in an Atlas Maker sheet.
   Re-skin `arcadeSalmon` / `arcadeBear` / `arcadeHook` / `arcadeFish` in an arcade project's
   Component Editor and size the config bodies to the art
   ([status/game-families](game-families.md) open item 11). Needs an arcade project (Blocked:
   which project).
3. **Characters per facing** (used by P10.11's Invisible Characters and its `animInputs`): the
   salmon (and its golden variant, `isGolden` in today's game), the bear and the fisherman. Per
   facing: a ComfyUI still, then a Flipbook 🎬 Video variation packed into a sheet and a
   `FlipbookClip` per action: idle, move (swim or walk), `hop` (salmon), swipe (bear), cast and
   reel (fisherman), hit or caught. The number of facings is an owner choice (Blocked).
4. **Props, transparent** (Atlas Maker, Remove background on): rocks, waterfall pieces, the
   whirlpool, sandbanks, bridges, the hook and its line, fish, the river's source.
5. **Diamond tilesets, 64 × 32** (used by P10.13's `tilemap`): grass and sand as 3 × 3 autotile
   sets (edges and corners), riverbed, shallow and deep water, sea. Atlas Maker sheets with one
   tile per region; they wait in R2 until the `tilemap` node exists.
6. **Effects** (Invisible FX): the hop's splash, the current's streaks, the whirlpool, the hook's
   splash.

Shipping (rule 8): atlases, clips and effects already travel export → deploy → bake → pull →
register. Tiles and characters get their chains in P10.13 and P10.11. S0 adds no asset class.

## Blocked (owner / external)

- **Access to `GuiltyForever/Salmon-`** for the sessions that do step 0. It is not in this
  environment's repository scope, and a session's request to add it was refused on 2026-10-26.
- **The generation runs in the launcher's tools** (ComfyUI on RunPod, through the Atlas Maker,
  Flipbook and FX). A cloud session has no R2 write and no ComfyUI, so items 2–6 need a person at
  those tools, or a session that has them.
- **Owner choices:**
  - **Models:** take item 1's licence-clean set (model-licences recommendations #1 and #4), or
    accept that S0's art is R&D-only until a licence is bought.
  - **Which project:** keep `salmons` as the art's home and create an arcade project for the
    slice (Game Maker → Arcade), or another arrangement. `salmons` itself was made as a Book-of
    project.
  - **Facings:** 4 (the isometric diagonals) or 8 per character. 8 matches P10.11's 8-way
    `topDown` controller; 4 halves the frames to make.

## Recent changes

- 2026-10-26 — **S0 approved by the owner; this file opened.** The owner asked why the
  coordinating session never raised S0. Nothing it reads said an owner go was pending: S0 was
  written as "not a build step", so it had no row in game-families §8 (the table the coordinator
  walks), and it was never listed under STATUS.md's owner blockers. S0 now has a row in §8 and an
  entry in STATUS.md's owner list. The `salmons` project was read from R2 (above), which found
  the two design docs' disagreement about the art.
