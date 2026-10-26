# Playtest — arcade sample (`arcade-sample`)

The first arcade game ([game-families](../design/game-families.md) P10.8, §9 #6): a **rules-decided**
(free-play) catcher / dodger on the shared runtime. A salmon swims along the bottom of the river;
bears and hooks fall towards it and fish drift down. A fish scores 10; a bear or a hook costs one of
three lives; at no lives the round is over. Status: [status/game-families](../status/game-families.md)
(P10.8).

It is exactly what Game Maker scaffolds for a new `arcade` project: the arcade scene set
(`engine-layout` `referenceLayouts/arcade.ts`: a spawn layer `field` on `basegame`, the SCORE / LIVES
HUD, the round-over screen), the seed config (`apps/launcher-api/src/lib/data/gameConfig/arcade.rules.json`:
no field size, so the field is the layout's design size; a body per component, the pairs `player + hazard` and `player + pickup`), the
starter flow (`engine-flow-v2` `arcadeSeed.ts`) and the four placeholder components
(`ARCADE_SAMPLE_COMPONENTS`: flat shapes, not the Salmons art). It has no RGS: the runtime runs the
arcade loop itself and sends no request.

It is not a published project: the playtest builds its own snapshot. A free-play arcade game
publishes to the test server since the publishing switch-on, and the current-games harness plays it
with `scripts/current-games/screens/arcade.json` (`loaded`, `start`, `falling`, `steered`,
`round-over`, `again`); its local stand-in is the `cg-arcade` fixture, built from the same seeds and
sample components.

## Launch

```
pnpm --filter 'lines^...' build
PUBLIC_RGS_TRANSPORT=play4fun PUBLIC_DELIVERY_PROFILES='*' pnpm --filter lines build
node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
  scripts/playtest/arcade-play.mjs --runtime apps/lines/build --out .cache/arcade-play
```

`arcade-play.mjs` bakes the snapshot from the three seeds and the sample components, serves it as the
launcher would and the runtime from the real Invisible Test Server, boots it with
`?ie_determinism=7` (the clock) and `?arseed=sample` (`$engine.random`, so the spawns), and plays
with real key events. It writes `result.json` (the verdicts) and a screenshot per moment, and exits 1
when a verdict fails. `--arcade-seed <s>` spawns elsewhere.

**In a browser by hand:** the same snapshot boots in any runtime build at
`/<key>/?runtime=1&project=<key>&k=x&editorDocBase=<snapshot server>`; steer with ← / → (or A / D).

**The determinism probe** (`window.__IE_DETERMINISM__`, `?ie_determinism=`) reports the play field as
`state().arcade`: `steps` (fixed steps run) and `bodies` (id, x / y — the body's centre in field px —
vx / vy, tags), in spawn order. `?flowlog=1` traces every spawn, despawn and arcade action.

## What to check

1. **Boot.** After the tap, the field and the HUD are up (SCORE 0, LIVES 3, top left) with one
   salmon at the bottom centre: (711, 720) on the desktop field. No console error.
2. **Spawning.** Within a couple of seconds bears (brown discs), hooks (grey bars) and fish (gold
   discs) fall from above the field at seeded places; each body falls straight down (`vx` 0).
3. **Steering.** Holding ← moves the salmon left at 520 px/s; letting go stops it. Holding → runs it
   to the right edge, where it stops with its edge on the field's (x = 1377).
4. **Touches.** A bear or a hook that reaches the salmon disappears and LIVES drops by one; a fish
   disappears and SCORE rises by 10. One touch counts once.
5. **Falling off.** Whatever reaches the bottom unhit disappears; the field never fills up.
6. **Round over.** The third hazard ends the round: "CAUGHT! Tap to swim again" over a dim; nothing
   new spawns and the salmon does not steer while it holds.
7. **Again.** The tap clears the field and starts a new round: one salmon back at the start,
   SCORE 0, LIVES 3.
8. **Replay.** The same `?ie_determinism=` and `?arseed=` with the same keys at the same frames
   reach the same bodies.
9. **No RGS.** The page requests nothing but the runtime bundle and the snapshot.

## Known limits

- The art is placeholder; swapping in the Salmons art (S0) is an owner follow-up.
- Keyboard only: touch steering is the `pointer` controller of tier A2 (P10.11).
- The field is the current layout's design size (desktop 1422 × 800, portrait 800 × 1422, …), read
  every step: turning the device moves the edges at once, and bodies already falling keep their
  places. The playtest plays the desktop layout and boots the portrait one.
