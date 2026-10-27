# Playtest — arcade platformer sample (`arcade-ledges`)

The gravity, jumps and levels sample ([game-families](../design/game-families.md) §4.4, P10.13): a
**rules-decided** (free-play) side-view level on the shared runtime, twice the screen wide, with a
world camera (P10.12) following the hero. The level is one `tilemap` of 64 px tiles: solid ground
with two gaps, a two-tile wall and three one-way ledges. The hero runs on the arrow keys (or A / D)
and jumps on Space, ↑ or W — hold to jump higher, with coyote time and a jump buffer — or on a press
above it on the screen. Coins count; the pit under the gaps costs one of three lives and puts the
hero back at the start; the goal at the far end is worth ten coins. Status:
[status/game-families](../status/game-families.md) (P10.13).

It is not a Game Maker kind and not a published project; the playtest builds its own snapshot from:

- the scene set `engine-layout` `referenceLayouts/arcadeLedges.ts` (`arcadeLedgesReferenceLayout()`):
  the P10.8 screens; the play field's screen has a `world` of 2880 × 800, a `camera` following
  `player` (a 320 × 220 dead zone, 0.12 s smoothing), a sky and pit backdrop, the tilemap
  `ledgesLevel` (45 × 12 tiles; ground `solid`, ledges `oneWay`, both frames of the sample sheet
  `ARCADE_LEDGES_SHEET`) and the spawn layer `field`; a LIVES / COINS HUD;
- the config `packages/engine-mechanics/fixtures/arcade-ledges.rules.json`: the field is the world,
  a box hero (40 × 56, `player`) and round coins (`coin`), the pair `player + coin`, the zones `pit`
  (the bottom 24 px) and `goal`, and one character `hero`: `sideScroll` at 320 px/s with
  accel / decel, gravity 2600 px/s² falling, `maxFall` 1300 px/s, and a `gravity` jump of 170 px in
  0.42 s (a tap 48 px);
- the flow `engine-flow-v2` `reference/arcadeLedgesSeed.ts` (`ARCADE_LEDGES_SEED_DOC`): the key map
  `left / right / up / jump` (Space is `jump`), the round, `collide` counting a coin and despawning
  it, `enterZone` of `pit` (a life) or `goal` (ten coins) putting the hero back with the camera
  snapped, and the round-over screen at no lives;
- the tileset sheet, written by the script into the snapshot's `deploy/editor-art/` and listed in
  the bundle's `editorArt` under its manifest key — the path a published game's tiles take.

## Launch

```
pnpm --filter 'lines^...' build
PUBLIC_RGS_TRANSPORT=play4fun PUBLIC_DELIVERY_PROFILES='*' pnpm --filter lines build
node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
  scripts/playtest/arcade-platformer-play.mjs --runtime apps/lines/build --out .cache/arcade-platformer-play
```

`--seed` pins `ie_determinism`, `--arcade-seed` the loop's seed; `--chrome` names a browser.

## What it checks

1. The round starts with the hero standing on the painted ground (grounded, at the ground's top),
   all seven coins out, three lives.
2. A pixel of the ground row has the shipped sheet's ground colour: the tiles draw through the
   editor-art index.
3. ArrowRight runs the hero right; letting go brings it to a stop on the ground.
4. Space jumps it exactly the jump's height (170 px, within 0.5 px) and it lands where it left; a tap
   rises about the tap height.
5. A jump from under the first one-way ledge passes up through it and lands on it.
6. The camera follows the hero along the level, the hero on screen.
7. It jumps the first gap and the wall; the second gap's pit costs a life and puts it back at the
   start with the camera at 0; coins are counted.
8. A press on the screen above the hero jumps it.
9. Free play sends the RGS nothing; no page error; the same seeds and keys replay the same level.

Screenshots (`01-start` … `04-far-side`) show the tiles, a jump, the ledge and the far side.
