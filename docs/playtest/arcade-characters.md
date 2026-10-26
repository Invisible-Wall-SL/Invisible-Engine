# Playtest — arcade characters sample (`arcade-guard`)

The characters sample ([game-families](../design/game-families.md) §4.3, P10.11): a **rules-decided**
(free-play) yard on the shared runtime. A runner, played with the arrow keys (or a held touch),
crosses a yard a guard walks. The guard runs on its **brain**: it patrols a `path` node round the
middle wall, chases the runner once it is within 220 px and gives up beyond 320 px. Walls are solid:
both stop at them and slide along them. A catch costs one of three lives and puts the runner back at
the start; at no lives the round is over. Status: [status/game-families](../status/game-families.md)
(P10.11).

It is not a Game Maker kind and not a published project; the playtest builds its own snapshot from:

- the scene set `engine-layout` `referenceLayouts/arcadeGuard.ts` (`arcadeGuardReferenceLayout()`):
  the P10.8 screens with the spawn layer `field` listing the four sample components, a closed,
  smoothed `path` node `guardRoute`, and a LIVES / SPOTTED HUD;
- the config `packages/engine-mechanics/fixtures/arcade-guard.rules.json`: a fixed 1422 × 800 field,
  a body per component (the walls `solid`), the pair `player + guard`, and two characters: `runner`
  (a `topDown` controller at 280 px/s, a standing brain for when the round is over) and `guard`
  (`patrol` on `guardRoute` → `chase` within 220 px → back beyond 320 px, plus `rest`;
  `animInputs` `speed ← speed`, `chasing ← state:chase`);
- the flow `engine-flow-v2` `reference/arcadeGuardSeed.ts` (`ARCADE_GUARD_SEED_DOC`): the key map
  `left / right / up / down` (arrows and WASD), the round, `characterState` counting SPOTTED, and
  `collide` costing a life (`moveTo` the runner home, `setCharacterState` the guard to `patrol`);
  at no lives `setCharacterState` rests every guard and `setCharacterControl` hands the runner to
  its brain;
- the placeholder components `ARCADE_GUARD_COMPONENTS` and the guard's look timelines
  `ARCADE_GUARD_TIMELINES`: its state machine blends `guard_idle` into `guard_run` by its `speed`
  number input (a 1D blend state) and raises an alert flag on `chasing`.

## Launch

```
pnpm --filter 'lines^...' build
PUBLIC_RGS_TRANSPORT=play4fun PUBLIC_DELIVERY_PROFILES='*' pnpm --filter lines build
node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
  scripts/playtest/arcade-characters-play.mjs --runtime apps/lines/build --out .cache/arcade-characters-play
```

The script serves the snapshot as the launcher would and the runtime from the real Invisible Test
Server, boots it with `?ie_determinism=7` and `?arseed=sample`, and plays with real key and mouse
events. It writes `result.json` and a screenshot of the start, the patrol and the chase, and exits 1
when a verdict fails.

**The determinism probe** (`state().arcade`) lists every body with its `state` when it is a
character with a brain (`patrol`, `chase`, `rest`, `stand`). The flow's variables read as
`window.__IE_FLOW_V2__.state.read('lives')`.

## What to check

1. **Boot.** After the tap: three grey walls (one down the middle, one across each side), the
   runner (green square) bottom left at (120, 720), the guard (slate, legs below, a red flag
   hidden above) on its route; LIVES 3, SPOTTED 0.
2. **Patrol.** The guard walks a rounded loop round the middle wall at 110 px/s, its legs swinging
   (the run timeline mixed in by speed); standing still it only breathes (idle).
3. **Steering.** The arrows (or WASD) move the runner 8 ways at 280 px/s, a diagonal no faster;
   letting go stops it. Holding a touch (or the mouse button) on the field with no key held walks it
   there.
4. **Walls.** The runner and the guard stop at a wall and slide along it; nothing passes through.
5. **Spotted.** Within 220 px the guard turns to chase (the red flag pops up), SPOTTED goes up by
   one; beyond 320 px it gives up and walks back to its route.
6. **Caught.** Touching the guard costs a life; the runner is back at the start and the guard goes
   back to patrolling.
7. **Round over.** The third catch shows "CAUGHT! Tap to run again"; the guard stops (rests) and
   the runner does not move. The tap clears the yard and builds it again.
8. **Replay.** The same `?ie_determinism=` and `?arseed=` with the same keys at the same frames
   reach the same bodies.
9. **No RGS.** The page requests nothing but the runtime bundle and the snapshot.

## Known limits

- Placeholder art.
- The field is the config's fixed 1422 × 800: on a portrait layout the yard is cut off (the sample
  is for the desktop layout).
- A pointer is read in the spawn layer that can hold a character (the first one declared).
