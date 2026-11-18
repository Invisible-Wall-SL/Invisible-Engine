# Arcade — lessons

What has bitten arcade work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/game-families.md](../../status/game-families.md) and
[status/salmons.md](../../status/salmons.md); this file only keeps the traps. Invariants and the
family's own failure modes are in [families/arcade.md](../families/arcade.md). A component field
the launcher's read dropped (`characterClips`): [components.md](components.md).

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
