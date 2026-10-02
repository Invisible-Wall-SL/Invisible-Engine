// @ts-nocheck — a Node script inside a browser package's `include: ["."]`; its tsconfig has no Node
// types or top-level await, so checking it only adds noise to the package's svelte-check.
// Verify the Wheel's skin (Hold and Win Phase 12c): the def carries the art params beside an
// unchanged `radius`; unset, they read as the coded wheel (no art, labels and the landed outline on,
// plain size); a cleared or nonsense value falls back instead of hiding the coded drawing; the def
// stands for its part and counts in under one name; the editor previews the face and rim at the
// wheel's size; and a wheel saved before all this gets the params and the stand-in back by id.
//
//   node scripts/test-wheel-skin.mjs
//
// Same esbuild-bundle trick as test-pot-skin.mjs: bundle the real modules and assert against them.
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));

const bundled = await esbuild.build({
	stdin: {
		contents: `export {
			WHEEL_DEF,
			WHEEL_MOUNT,
			WHEEL_SKIN_PARAMS,
			boundComponentSkin,
			mergeBuiltinCodedParams,
			partStandIn,
			readWheelSkin,
			resolveComponentParams,
		} from '../src/lib/index.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-wheel-skin.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `wheel-skin-test-${process.pid}.mjs`);
await writeFile(tmp, bundled.outputFiles[0].text, 'utf8');
let mod;
try {
	mod = await import(pathToFileURL(tmp).href);
} finally {
	await rm(tmp, { force: true });
}

let failures = 0;
const assert = (cond, msg) => {
	if (cond) {
		console.info(`  ✓ ${msg}`);
	} else {
		console.error(`  ✗ ${msg}`);
		failures += 1;
	}
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const def = mod.WHEEL_DEF;
const SKIN_KEYS = mod.WHEEL_SKIN_PARAMS.map((p) => p.key);

console.info('the def');
assert(
	same(
		def.params.map((p) => p.key),
		['radius', ...SKIN_KEYS],
	),
	'radius, then the skin params',
);
const params = mod.resolveComponentParams(def, {});
assert(params.radius === 220, 'the radius default is unchanged');
assert(
	same(
		def.root.children.map((n) => n.bind?.component),
		['HoldAndWinWheelPart'],
	),
	'still the one coded part',
);
assert(def.standsFor === 'HoldAndWinWheelPart', 'it stands for its part');
assert(mod.partStandIn(def) === undefined, 'the built-in binds it: no stand-in');
assert(mod.WHEEL_MOUNT === def.id, 'the part counts in under the built-in id');
assert(
	['faceImage', 'rimImage', 'pointerImage'].every(
		(key) => def.params.find((p) => p.key === key)?.kind === 'image',
	),
	'face, rim and pointer are image params (they ride the image-param art export)',
);
assert(
	def.params.find((p) => p.key === 'labelFontFamily')?.label === 'font',
	'the label font gets the font picker',
);

console.info('reading the skin');
const coded = mod.readWheelSkin((key) => params[key]);
assert(
	same(coded, {
		face: undefined,
		rim: undefined,
		pointer: undefined,
		artSize: undefined,
		showLabels: true,
		labelFontFamily: undefined,
		labelFill: undefined,
		labelScale: 1,
		showLanded: true,
	}),
	'unset: the coded wheel (parity)',
);
const read = (values) => mod.readWheelSkin((key) => values[key]);
assert(read({ faceImage: '' }).face === undefined, 'a cleared image reads as unset');
assert(
	read({ labelScale: 0 }).labelScale === 1 && read({ labelScale: -2 }).labelScale === 1,
	'a non-positive label scale falls back to 1',
);
assert(read({ artSize: 0 }).artSize === undefined, 'a zero art size means the wheel’s own');
assert(
	read({ showLabels: false, showLanded: false }).showLabels === false &&
		read({ showLabels: false, showLanded: false }).showLanded === false,
	'labels and the landed outline switch off',
);
assert(read({ labelFill: 0 }).labelFill === 0, 'black is a colour');
const skinned = read({
	faceImage: 'a::face',
	rimImage: 'a::rim',
	pointerImage: 'a::ptr',
	artSize: 500,
});
assert(
	skinned.face === 'a::face' &&
		skinned.rim === 'a::rim' &&
		skinned.pointer === 'a::ptr' &&
		skinned.artSize === 500,
	'the art and its size',
);

console.info('the editor');
const skin = mod.boundComponentSkin('HoldAndWinWheelPart');
assert(
	same(
		skin?.layers.map((l) => l.imageParam),
		['faceImage', 'rimImage'],
	),
	'previews the face under the rim',
);
assert(
	skin?.widthParam === 'artSize' &&
		skin?.heightParam === 'artSize' &&
		skin?.radiusParam === 'radius',
	'at artSize, else twice the radius — the box the game draws them in',
);

console.info('a wheel saved before the skin');
const saved = { ...def, params: [{ key: 'radius', kind: 'number', default: 220 }] };
delete saved.standsFor;
const merged = mod.mergeBuiltinCodedParams(saved);
assert(
	SKIN_KEYS.every((key) => merged.params.some((p) => p.key === key)),
	'gets every skin param back by id',
);
assert(merged.standsFor === 'HoldAndWinWheelPart', 'gets standsFor back by id');
const flat = { ...merged, root: { ...merged.root, children: [] } };
assert(
	mod.partStandIn(flat) === 'HoldAndWinWheelPart',
	'with its part deleted, the part stands in',
);

if (failures > 0) {
	console.error(`\n${failures} assertion(s) failed`);
	process.exit(1);
}
console.info('\nall wheel-skin assertions passed');
