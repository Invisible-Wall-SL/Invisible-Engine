# Salmons' original art (built in)

The images under `sheets/` are Salmons' own original art, owned by Invisible Wall, built into the
engine so the Salmons room draws its river and characters as the old game did. Nothing here is
uploaded or read from a project: it ships with the runtime, as separate hashed files that only a
room whose config names the `salmonsRiver` generator ever fetches (`index.ts`).

**Source.** `GuiltyForever/Salmon-` at `41811c2`, `art/source/legacy/` (the untouched originals):
`grass.png`, `sand.png`, `rocks.jpg`, `whirlpool.jpg`, `trees.png`, `waterfall_splash.png`,
`waterfall_lip.png`, `waterfall_face.png`, `salmon_pink.png`, `salmon_golden.png`,
`bear_sprite.png`. Cut and keyed as that repository's `scripts/build-sheets.py` and
`art/sheets.json` do (the same grids, region names, background keys and the salmon's flip).

**Not built:** the bridge pieces (`bridge_*.png`, generated placeholders in the old game; the
engine's river has no bridges) and `cliff.png` (the engine draws the waterfalls flat, with no
elevation).

**Rebuild:** `python3 scripts/salmons/build-art.py --src <Salmon->/art/source/legacy` (Pillow with
WebP, numpy). Sizes are about three times the drawn size: a 48 world-px cell is a 96 × 48 diamond,
so the terrain tiles are 192 px, the trees 288 px wide, the rocks 224 px, the characters 256 px.
`pnpm check:salmons-art` holds every frame the drawing code names to the committed sheets.
