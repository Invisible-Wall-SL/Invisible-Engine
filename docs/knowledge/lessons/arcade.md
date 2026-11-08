# Arcade — lessons

What has bitten arcade work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/game-families.md](../../status/game-families.md) and
[status/salmons.md](../../status/salmons.md); this file only keeps the traps. Invariants and the
family's own failure modes are in [families/arcade.md](../families/arcade.md). A component field
the launcher's read dropped (`characterClips`): [components.md](components.md).

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
