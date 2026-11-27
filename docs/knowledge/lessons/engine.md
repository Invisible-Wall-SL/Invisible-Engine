# Engine runtime — lessons

What has bitten the shared runtime's rendering (`packages/pixi-svelte`) before, newest first.
Format and rules: [README](../README.md). Current state lives in
[status/engine.md](../../status/engine.md); this file only keeps the traps. The page shell and
`PerfHud`: [engine-shell.md](engine-shell.md). Traps that hit every game in play:
[current-games.md](current-games.md).

### One slow window in a climb kept the game at the effects level for the session

- **Symptom:** #1930's review fuzz: ~40% of random sessions stayed at L6 (no post FX, fewer
  particles) after a full recovery.
- **Cause:** `renderQuality.ts` added a step up that went slow to `upFailed`, a set never cleared,
  so a warm spell's one failed L6 → L5 try pinned the device below it for good.
- **Fix:** failed tries are counted per level and retried after `30 × 2^failures` good windows, at
  most twice. A lifetime cap then forced a trade (retries spent it and parked a slow device; an
  unjudged drop took a mild one's effects), so switches come from a refilling budget (12, +1 per
  150 windows with no switch), every step is judged, and 2 stay held for a trip to the effects
  level.
- **Guard:** `renderQuality.fixture.ts`: `mild`, `mali2`, a spent budget that refills, seeded and
  adversarial sessions that always keep a way to the effects level; mutants red.
- **PR:** #1960 (2026-11-27), branch `bug-20-ladder-review-fixes`

### A budget phone spun at 28 fps, and the first fix sent slightly slow phones to the floor

- **Symptom:** BUG-20: a lines game spun at 28.5 fps on a Mali-G57 MC2 phone (budget 50). #1930's
  review: a phone 13% slow (Nothing Phone (1)) would lose its post FX and particles within ~8 s.
- **Cause:** `renderQuality.ts` stopped at 1.5x, never lowered effects, and gave up after one step
  that did not help; #1930's second chance then jumped from any level straight to the effects
  level, which nearly always reads as helped, and its `waiting` never expired.
- **Fix:** steps to 1.25 and 1 and a last effects level (#1930); the second chance walks down from
  two levels below the failed one, keeps the first that helps, comes back `unused` after 15 windows
  under 1% slow, and holds the cap's last 2 switches so earlier spells cannot block it.
- **Guard:** `renderQuality.fixture.ts`: just over the line keeps its effects, slow at every
  resolution reaches them (also after spells spent 10 switches), the expiry, the effects wiring.
- **PR:** #1930 (2026-11-27) and its follow-up, branch `bug-20-ladder-review-fixes`
