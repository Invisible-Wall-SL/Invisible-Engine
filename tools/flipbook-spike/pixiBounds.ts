/**
 * Invisible Flipbook — the PIXI contract the bounds box rests on, checked against the real
 * pixi.js in `node_modules` rather than against a reading of its source:
 *
 *   pnpm --filter flipbook-spike run pixi-bounds
 *
 * A declared box ships as a texture's `orig` and the art's place inside it as `trim` — for a clip
 * by re-stating the frames in `<Flipbook>`, for a sprite region by writing `sourceSize` /
 * `spriteSourceSize` into the sheet JSON the export produces. The whole feature needs no other
 * runtime code BECAUSE of two PIXI behaviours, and if either ever changed the box would silently
 * stop meaning what the editors show:
 *
 *  1. `texture.width/height` reports `orig` — the BOX — so `contain`-fitting, `width`/`height`
 *     sizing and cover-fit all measure the box and not the art.
 *  2. `updateQuadBounds` positions the drawn quad from `trim` and takes only the ANCHOR from
 *     `orig`, with no clamping. That is what makes a box SMALLER than its art legal: the art
 *     overflows the box instead of being cropped to it — how a symbol is sized by the part that
 *     reads while a wide invisible flourish hangs outside the cell.
 *
 * Imported through `packages/pixi-svelte/node_modules` (the package that actually depends on pixi)
 * by a version-independent path — this spike deliberately gains no pixi dependency of its own.
 */

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const pixiDir = resolve(process.cwd(), '../../packages/pixi-svelte/node_modules/pixi.js');

const { Rectangle, Texture, TextureSource } = (await import(
	pathToFileURL(resolve(pixiDir, 'lib/index.mjs')).href
)) as typeof import('pixi.js');
const { updateQuadBounds } = (await import(
	pathToFileURL(resolve(pixiDir, 'lib/utils/data/updateQuadBounds.mjs')).href
)) as {
	updateQuadBounds: (
		bounds: { minX: number; maxX: number; minY: number; maxY: number },
		anchor: { _x: number; _y: number },
		texture: unknown,
	) => void;
};

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};

const source = new TextureSource({ width: 2048, height: 2048, resolution: 1 });

/** A frame packed at 1000×1000, declared into a 200×200 box centred on it (the box is SMALLER
 * than the art — the invisible-flourish case). */
const tight = new Texture({
	source,
	frame: new Rectangle(10, 20, 1000, 1000),
	orig: new Rectangle(0, 0, 200, 200),
	trim: new Rectangle(-400, -400, 1000, 1000),
});

console.log('pixi bounds — the declared box is what everything measures');
assert(
	tight.width === 200 && tight.height === 200,
	'texture.width/height reports `orig` (the box)',
);

console.log('pixi bounds — the art is drawn from `trim`, uncropped');
const b = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
updateQuadBounds(b, { _x: 0.5, _y: 0.5 }, tight);
assert(
	b.maxX - b.minX === 1000 && b.maxY - b.minY === 1000,
	'the quad keeps the ART’s size, not the box’s — a smaller box does NOT crop',
);
assert(
	b.minX === -500 && b.minY === -500,
	'and stays centred on the anchor, hanging 400px outside the box on every side',
);

console.log('pixi bounds — a box LARGER than the art pads it, exactly like packer trim');
const padded = new Texture({
	source,
	frame: new Rectangle(0, 0, 487, 487),
	orig: new Rectangle(0, 0, 684, 684),
	trim: new Rectangle(105, 99, 487, 487),
});
const p = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
updateQuadBounds(p, { _x: 0.5, _y: 0.5 }, padded);
assert(padded.width === 684, 'the padded box is the measured size');
assert(
	p.minX === 105 - 342 && p.maxX - p.minX === 487,
	'the art sits at its trim offset inside the box — the ordinary trimmed-atlas case',
);

console.log('pixi bounds — an untouched frame is unchanged');
const plain = new Texture({ source, frame: new Rectangle(0, 0, 120, 80) });
const q = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
updateQuadBounds(q, { _x: 0.5, _y: 0.5 }, plain);
assert(plain.width === 120 && plain.height === 80, 'no orig ⇒ the frame itself is the box');
assert(q.minX === -60 && q.maxX === 60, 'no trim ⇒ centred on the anchor (parity)');

console.log('');
if (failures > 0) {
	console.error(`PIXI BOUNDS: ${failures} FAILURE(S)`);
	process.exit(1);
}
console.log('PIXI BOUNDS: PASSED');
