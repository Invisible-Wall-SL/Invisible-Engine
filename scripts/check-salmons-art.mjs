// Salmons' original art, built in (packages/engine-layout/src/lib/salmonsArt; docs/status/salmons.md):
// - every region the drawing code names (`regions.ts`) is a frame of its committed sheet
//   (`sheets/frames.ts`, made by scripts/salmons/build-art.py), inside its page, and each page and
//   tile is a WebP of the size its frames say;
// - the pages ship as files of their own: config-vite never inlines them (`SALMONS_ART_RE`);
// - only a Salmons room reaches them: `engine-layout/salmons-art` is imported in one place, lazily
//   (`apps/lines` `game/online.ts` `FIELD_ART`, under the `salmonsRiver` generator), and neither
//   engine-layout entry exports it.
//
// Run: pnpm check:salmons-art

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	SALMONS_REGIONS,
	SALMONS_TILES,
} from '../packages/engine-layout/src/lib/salmonsArt/regions.ts';
import { SALMONS_SHEETS } from '../packages/engine-layout/src/lib/salmonsArt/sheets/frames.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ART = join(ROOT, 'packages/engine-layout/src/lib/salmonsArt');
const SHEETS = join(ART, 'sheets');

let passed = 0;
const check = (name, fn) => {
	try {
		fn();
		passed += 1;
	} catch (error) {
		console.error(`✗ ${name}\n${error.message}`);
		process.exitCode = 1;
	}
};

/** A WebP's width and height, from its first chunk (VP8X, VP8L or VP8). */
function webpSize(file) {
	const b = readFileSync(file);
	assert.equal(b.toString('ascii', 0, 4), 'RIFF', `${file} is not a RIFF file`);
	assert.equal(b.toString('ascii', 8, 12), 'WEBP', `${file} is not a WebP`);
	const chunk = b.toString('ascii', 12, 16);
	if (chunk === 'VP8X') return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
	if (chunk === 'VP8L') {
		const bits = b.readUInt32LE(21);
		return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
	}
	assert.equal(chunk, 'VP8 ', `${file}: unknown WebP chunk ${chunk}`);
	return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
}

for (const [sheet, names] of Object.entries(SALMONS_REGIONS)) {
	const doc = SALMONS_SHEETS[sheet];
	check(`${sheet}: its page is a WebP of the size its frames say`, () => {
		assert.ok(doc, `no sheet "${sheet}" in frames.ts`);
		assert.equal(doc.meta.image, `${sheet}.webp`);
		assert.deepEqual(webpSize(join(SHEETS, doc.meta.image)), doc.meta.size);
	});
	check(`${sheet}: every region drawn is a frame inside its page`, () => {
		for (const name of names) {
			const frame = doc?.frames[name]?.frame;
			assert.ok(frame, `"${name}" is not a frame of ${sheet}`);
			assert.ok(
				frame.x >= 0 &&
					frame.y >= 0 &&
					frame.x + frame.w <= doc.meta.size.w &&
					frame.y + frame.h <= doc.meta.size.h,
				`"${name}" lies outside its page`,
			);
		}
	});
}
check('the tiles are WebPs beside the sheets', () => {
	for (const tile of SALMONS_TILES) assert.ok(webpSize(join(SHEETS, `${tile}.webp`)).w > 0);
});
check('nothing in sheets/ but the pages, the tiles and frames.ts', () => {
	const expected = new Set([
		'frames.ts',
		...Object.keys(SALMONS_REGIONS).map((s) => `${s}.webp`),
		...SALMONS_TILES.map((t) => `${t}.webp`),
	]);
	assert.deepEqual(new Set(readdirSync(SHEETS)), expected);
});

check('config-vite never inlines a page or a tile', () => {
	const vite = readFileSync(join(ROOT, 'packages/config-vite/index.js'), 'utf8');
	const source = /const SALMONS_ART_RE = (\/.+\/);/.exec(vite)?.[1];
	assert.ok(source, 'config-vite has no SALMONS_ART_RE');
	assert.match(vite, /assetsInlineLimit: \(file\) =>[^\n]*!SALMONS_ART_RE\.test\(file\)/);
	const re = new Function(`return ${source}`)();
	for (const file of readdirSync(SHEETS).filter((f) => f.endsWith('.webp')))
		assert.ok(re.test(join(SHEETS, file)), `${file} would be inlined`);
});

/** Every source file under `dir` (no node_modules, builds or caches). */
function sources(dir, out = []) {
	for (const entry of readdirSync(dir)) {
		if (['node_modules', 'build', '.svelte-kit', 'dist', '.cache', '.turbo'].includes(entry))
			continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) sources(path, out);
		else if (/\.(ts|js|mjs|svelte)$/.test(entry)) out.push(path);
	}
	return out;
}

check('only a Salmons room reaches the art: one lazy import, under its generator', () => {
	const reached = [];
	for (const top of ['apps', 'packages', 'services'])
		for (const file of sources(join(ROOT, top))) {
			if (file.startsWith(ART)) continue;
			const code = readFileSync(file, 'utf8');
			if (/(?:\bfrom|\bimport\s*\()\s*['"][^'"]*(?:salmons-art|salmonsArt\/)/.test(code))
				reached.push(relative(ROOT, file));
		}
	assert.deepEqual(reached, ['apps/lines/src/game/online.ts']);
	const online = readFileSync(join(ROOT, 'apps/lines/src/game/online.ts'), 'utf8');
	const imports = [...online.matchAll(/^.*salmons-art.*$/gm)].map((m) => m[0].trim());
	assert.ok(
		imports.every(
			(line) =>
				line.startsWith('import type ') ||
				/await import\('engine-layout\/salmons-art'\)/.test(line),
		),
		`a value import of the art: ${imports.join(' | ')}`,
	);
	assert.match(
		online,
		/salmonsRiver: async \(made, seed\) =>\s*\(await import\('engine-layout\/salmons-art'\)\)/,
	);
	for (const entry of ['index.ts', 'svelte.ts']) {
		const code = readFileSync(join(ROOT, 'packages/engine-layout/src/lib', entry), 'utf8');
		assert.doesNotMatch(code, /salmonsArt/, `engine-layout ${entry} exports the art`);
	}
});

console.log(`check:salmons-art: ${passed} passed`);
