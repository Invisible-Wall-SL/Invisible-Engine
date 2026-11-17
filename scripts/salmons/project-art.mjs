// Salmons' built-in art (packages/engine-layout/src/lib/salmonsArt/sheets) as the project sheets the
// Sheet Maker and the Atlas Maker show (`game-config` SALMONS_PROJECT_SHEETS; docs/status/salmons.md
// "Original art as project art"). Pure: the conversion plan `upload-art.py` writes to R2 and
// `check:salmons-art` holds to the drawing code. Each page is the built-in WebP, byte for byte, and
// each region keeps its built-in name, place and size.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/salmons/project-art.mjs            # prints the plan as JSON (upload-art.py reads it)

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SALMONS_PROJECT_SHEETS } from '../../packages/game-config/src/salmonsProjectArt.ts';
import {
	SALMONS_REGIONS,
	SALMONS_TILES,
} from '../../packages/engine-layout/src/lib/salmonsArt/regions.ts';
import { SALMONS_SHEETS } from '../../packages/engine-layout/src/lib/salmonsArt/sheets/frames.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SALMONS_SHEETS_DIR = join(ROOT, 'packages/engine-layout/src/lib/salmonsArt/sheets');

/** A WebP's width and height, from its first chunk (VP8X, VP8L or VP8). */
export function webpSize(bytes) {
	if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP')
		throw new Error('not a WebP');
	const chunk = bytes.toString('ascii', 12, 16);
	if (chunk === 'VP8X') return { w: bytes.readUIntLE(24, 3) + 1, h: bytes.readUIntLE(27, 3) + 1 };
	if (chunk === 'VP8L') {
		const bits = bytes.readUInt32LE(21);
		return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
	}
	if (chunk !== 'VP8 ') throw new Error(`unknown WebP chunk ${chunk}`);
	return { w: bytes.readUInt16LE(26) & 0x3fff, h: bytes.readUInt16LE(28) & 0x3fff };
}

/**
 * One entry per project sheet: `sheet` (its name in the project), `builtin` (the built-in page it
 * is), `page` (that page's path), `image` (the page's name in the project), its size and its
 * frames, in the built-in order. The tile becomes a one-region sheet spanning its page.
 */
export function salmonsProjectArtPlan() {
	const plan = Object.keys(SALMONS_REGIONS).map((builtin) => {
		const doc = SALMONS_SHEETS[builtin];
		const sheet = SALMONS_PROJECT_SHEETS[builtin];
		return {
			sheet,
			builtin,
			page: join(SALMONS_SHEETS_DIR, doc.meta.image),
			image: `${sheet}.webp`,
			width: doc.meta.size.w,
			height: doc.meta.size.h,
			frames: Object.entries(doc.frames).map(([name, f]) => ({ name, ...f.frame })),
		};
	});
	for (const tile of SALMONS_TILES) {
		const page = join(SALMONS_SHEETS_DIR, `${tile}.webp`);
		const { w, h } = webpSize(readFileSync(page));
		const sheet = SALMONS_PROJECT_SHEETS[tile];
		plan.push({
			sheet,
			builtin: tile,
			page,
			image: `${sheet}.webp`,
			width: w,
			height: h,
			frames: [{ name: tile, x: 0, y: 0, w, h }],
		});
	}
	return plan;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	process.stdout.write(`${JSON.stringify(salmonsProjectArtPlan(), null, '\t')}\n`);
