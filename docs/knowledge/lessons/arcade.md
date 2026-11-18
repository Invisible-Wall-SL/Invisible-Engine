# Arcade — lessons

What has bitten arcade work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/game-families.md](../../status/game-families.md) and
[status/salmons.md](../../status/salmons.md); this file only keeps the traps. Invariants and the
family's own failure modes are in [families/arcade.md](../families/arcade.md). A component field
the launcher's read dropped (`characterClips`): [components.md](components.md).

### A 3D level from a config could freeze the game server, and an idle player hung mid-air

- **Symptom:** #1717 merged with its review blocking: a large `arcade.world3d` level (or a tiny
  `cellSize`) made `createLevel3d` bucket unbounded cells; a negative trampoline height gave NaN;
  a player whose device stopped sending, or dropped, froze in mid-air for everyone.
- **Cause:** config numbers went into loops and `Math.sqrt` unchecked, and the fold rule
  ("no input = no step") had no exit for a device that never sends again.
- **Fix:** every config number bounded (coordinates ≤ 1e6 m — past 2^53 a `cx++` loop never
  ends — `MOTION3D_LIMITS`, cells counted before bucketing, 64 colliders a cell, 256 zones, a
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

### A character's clip flicked between two facings every frame

- **Symptom:** in `salmons-play.mjs` the clip log alternated `swim_ne` / `swim_se` every patch.
- **Cause:** a body pushed to and fro (a bank's push, a prediction corrected at a waterfall's
  foot) reverses its drawn velocity each patch, and the facing followed it frame by frame.
- **Fix:** velocity over 150 ms, a dead band off each axis, and a turn must hold `CLIP_TURN_MS`.
- **Guard:** root `check:character-clips`; `salmons-play.mjs` (the clip log, both netcodes).
- **PR:** not recorded (2026-11-08, branch `s0-character-clips`) · source: `docs/status/salmons.md`

### The owner was never asked to approve the Salmons art pass

- **Symptom:** S0 waited on an owner go that no session ever raised.
- **Cause:** S0 was written as "not a build step", so it had no row in game-families §8 (the
  table the coordinator walks) and no entry in STATUS.md's owner list.
- **Fix:** S0 got a §8 row and a `docs/STATUS.md` owner entry.
- **Guard:** none; an owner step needs a §8 row or an owner-list entry to be seen.
- **PR:** not recorded (2026-10-26) · source: `docs/status/salmons.md`
