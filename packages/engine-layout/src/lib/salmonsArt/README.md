# Salmons' original art (built in)

The images under `sheets/` are Salmons' own original art, owned by Invisible Wall, built into the
engine so the Salmons room draws its river and characters as the old game did. It ships with the
runtime, as separate hashed files that only a room whose config names a Salmons generator
(`salmonsRiver`, `salmonsMap`) ever fetches (`index.ts`).

**Project art first, this copy as the fallback.** The same sheets are also stored in the Salmons
project as ordinary sheets (`salmons_terrain`, `salmons_props`, `salmons_characters`,
`salmons_waterfall_face`, `salmons_cliff`; `game-config` `SALMONS_PROJECT_SHEETS`), so the Sheet Maker and the Atlas
Maker show and edit them. A publish ships them as editor art (`editorArtExport.ts` seeds them for a
Salmons generator), and the room draws each region from the project's sheet when the published
snapshot ships it, from this copy otherwise (`load.ts`, `regions.ts` `pickSalmonsRegions`). A
built-in page is fetched only when a region still needs it. Region names never change: the drawing
code (`looks.ts`, `river.ts`, `regions.ts`) looks them up by name. Keep an edited region the size it
is here: the drawing code sizes some art from its texture (the waterfall face's tile scale). The
project sheets were put there once by `scripts/salmons/upload-art.py` (from
`scripts/salmons/project-art.mjs`); re-running it after a rebuild here does not overwrite an edited
project sheet, it stops and reports it.

**Source.** `GuiltyForever/Salmon-` at `41811c2`, `art/source/legacy/` (the untouched originals):
`grass.png`, `sand.png`, `rocks.jpg`, `whirlpool.jpg`, `trees.png`, `waterfall_splash.png`,
`waterfall_lip.png`, `waterfall_face.png`, `salmon_pink.png`, `salmon_golden.png`,
`bear_sprite.png`, `cliff.png`. Cut and keyed as that repository's `scripts/build-sheets.py` and
`art/sheets.json` do (the same grids, region names, background keys and the salmon's flip).

**Not built:** the bridge pieces (`bridge_*.png`, generated placeholders in the old game; the
engine's river has no bridges).

`sheets/cliff.webp` is built (a tile, like `waterfall_face.webp`) and is the project sheet
`salmons_cliff`: `river.ts` draws it under each waterfall's lip as the old client's
`createCliffFace` did, one texture high (the cliff's `32 + 16·H` old px), tiled across the world
and sheared to the waterfall's line, with the river upstream raised by the waterfall's step
(`referenceLayouts/salmonsElevation.ts`). An edited cliff keeps its look at any size: it is scaled
to the cliff's height.

**Rebuild:** `python3 scripts/salmons/build-art.py --src <Salmon->/art/source/legacy` (Pillow with
WebP, numpy). Sizes are about three times the drawn size: a 48 world-px cell is a 96 × 48 diamond,
so the terrain tiles are 192 px, the trees 288 px wide, the rocks 224 px, the characters 256 px.
`pnpm check:salmons-art` holds every frame the drawing code names to the committed sheets, to the
project sheets' plan, and to the project-first, built-in-fallback choice.
