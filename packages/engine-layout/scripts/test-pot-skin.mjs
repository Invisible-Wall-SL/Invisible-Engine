// @ts-nocheck — a Node script inside a browser package's `include: ["."]`; its tsconfig has no Node
// types or top-level await, so checking it only adds noise to the package's svelte-check.
// Verify the Pot Meter's skin (Hold and Win Phase 12c): an unskinned pot reads as exactly the coded
// pot (parity), each art param reads off the instance's params, the pot body follows the size
// stages, the fill reveal grows from the right edge, and a Pot Meter saved before 12c gains the
// skin params on load.
//
//   node scripts/test-pot-skin.mjs
//
// Same esbuild-bundle trick as test-win-text-hold-and-win.mjs: bundle the real modules and assert
// against them.
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));

const bundled = await esbuild.build({
	stdin: {
		contents: `export {
			POT_METER_DEF,
			POT_SKIN_PARAMS,
			POT_STAGE_GROWTH,
			POT_PULSE_SCALE,
			fontParamKeysOf,
			mergeBuiltinCodedParams,
			potBodyImage,
			potFillRect,
			potFillShare,
			potHasArt,
			readPotSkin,
			resolveComponentParams,
		} from '../src/lib/index.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-pot-skin.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `pot-skin-test-${process.pid}.mjs`);
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
const skinOf = (params) => mod.readPotSkin((key) => params[key]);

// --- parity: an unskinned pot is the coded pot ------------------------------
console.info('parity');
const coded = skinOf({});
assert(!mod.potHasArt(coded), 'no params ⇒ no art (the coded bar draws)');
assert(coded.showLevel && coded.showActivates, 'both coded labels show');
assert(coded.labelScale === 1 && coded.labelFill === undefined, 'coded label size and colour');
assert(coded.labelFontFamily === undefined, 'coded label font (Arial)');
assert(coded.stageGrowth === 0.1 && coded.pulseScale === 1.3, 'coded growth 0.1, pulse 1.3');
assert(
	mod.POT_STAGE_GROWTH === 0.1 && mod.POT_PULSE_SCALE === 1.3,
	'the shared motion constants are the coded pot’s',
);
const resolved = mod.resolveComponentParams(mod.POT_METER_DEF, { meter: 'red' });
const fromDefaults = skinOf(resolved);
assert(same(fromDefaults, coded), 'the def’s own defaults read as the coded pot');
assert(resolved.meter === 'red' && resolved.scale === 1, 'meter + scale unchanged');

// --- the art params read off the instance -----------------------------------
console.info('art params');
const dressed = skinOf({
	backgroundImage: 'pots::red_pot',
	fillImage: 'pots::red_liquid',
	fillDirection: 'up',
	frameImage: 'pots::red_frame',
	artWidth: 180,
	artHeight: 240,
	showLevel: false,
	labelFontFamily: 'gold-bitmap',
	labelFill: 0xffcc00,
	labelScale: 1.5,
	stageGrowth: 0,
	pulseScale: 1,
});
assert(mod.potHasArt(dressed), 'a background ⇒ art');
assert(dressed.fill === 'pots::red_liquid' && dressed.frame === 'pots::red_frame', 'fill + frame');
assert(dressed.fillDirection === 'up', 'fill direction');
assert(dressed.width === 180 && dressed.height === 240, 'art box');
assert(!dressed.showLevel && dressed.showActivates, 'labels toggle one by one');
assert(dressed.labelFontFamily === 'gold-bitmap' && dressed.labelFill === 0xffcc00, 'label style');
assert(dressed.labelScale === 1.5, 'label size');
assert(dressed.stageGrowth === 0 && dressed.pulseScale === 1, 'motion off');
assert(mod.potHasArt(skinOf({ frameImage: 'f' })), 'a frame alone ⇒ art');
assert(mod.potHasArt(skinOf({ stageImage2: 's2' })), 'a stage image alone ⇒ art');

console.info('cleared and bad values fall back');
const cleared = skinOf({
	backgroundImage: '',
	fillDirection: 'sideways',
	artWidth: 0,
	artHeight: -4,
	labelScale: 0,
	pulseScale: 'big',
	stageGrowth: -0.5,
});
assert(!mod.potHasArt(cleared), 'a cleared image is unset, not "draw nothing"');
assert(cleared.fillDirection === 'right', 'an unknown direction grows right');
assert(cleared.width === undefined && cleared.height === undefined, 'a non-positive box is blank');
assert(cleared.labelScale === 1 && cleared.pulseScale === 1.3, 'bad numbers keep the coded value');
assert(cleared.stageGrowth === 0, 'a negative growth is none, never a flipped pot');

// --- the pot body follows the size stages ------------------------------------
console.info('stage images');
const staged = skinOf({ backgroundImage: 'bg', stageImage1: 's1', stageImage3: 's3' });
assert(mod.potBodyImage(staged, 0) === 'bg', 'below the first stage: the background');
assert(mod.potBodyImage(staged, 1) === 's1', 'stage 1: its image');
assert(mod.potBodyImage(staged, 2) === 's1', 'stage 2 unset: the stage below it');
assert(mod.potBodyImage(staged, 3) === 's3', 'stage 3: its image');
assert(mod.potBodyImage(staged, 7) === 's3', 'past the last stage image: the last one');
assert(mod.potBodyImage(skinOf({ stageImage2: 's2' }), 1) === undefined, 'no body below stage 2');

// --- the fill reveal ----------------------------------------------------------
console.info('fill');
assert(mod.potFillShare(3, 12) === 0.25, 'share = level / max');
assert(mod.potFillShare(20, 12) === 1 && mod.potFillShare(-1, 12) === 0, 'share is clamped');
assert(mod.potFillShare(3, 0) === 0 && mod.potFillShare(NaN, 12) === 0, 'no max / NaN ⇒ 0');
assert(
	same(mod.potFillRect(100, 200, 0.25, 'right'), { x: -50, y: -100, width: 25, height: 200 }),
	'right: the left quarter',
);
assert(
	same(mod.potFillRect(100, 200, 0.25, 'left'), { x: 25, y: -100, width: 25, height: 200 }),
	'left: the right quarter',
);
assert(
	same(mod.potFillRect(100, 200, 0.25, 'up'), { x: -50, y: 50, width: 100, height: 50 }),
	'up: the bottom quarter (a pot rises)',
);
assert(
	same(mod.potFillRect(100, 200, 0.25, 'down'), { x: -50, y: -100, width: 100, height: 50 }),
	'down: the top quarter',
);
assert(
	same(mod.potFillRect(100, 200, 1.5, 'up'), { x: -50, y: -100, width: 100, height: 200 }),
	'a full pot shows the whole fill',
);

// --- the def and its upgrade path ---------------------------------------------
console.info('def');
const keys = (mod.POT_METER_DEF.params ?? []).map((p) => p.key);
assert(keys[0] === 'meter' && keys[1] === 'scale', 'meter + scale lead the params');
assert(
	mod.POT_SKIN_PARAMS.every((p) => keys.includes(p.key)),
	'every skin param is on the Pot Meter',
);
assert(new Set(keys).size === keys.length, 'no duplicate param keys');
assert(
	mod.fontParamKeysOf(mod.POT_METER_DEF).has('labelFontFamily'),
	'the label font is a font dropdown',
);
const preTwelveC = {
	...mod.POT_METER_DEF,
	params: [
		{ key: 'meter', kind: 'string', default: 'blue' },
		{ key: 'scale', kind: 'number', default: 2 },
	],
};
const merged = mod.mergeBuiltinCodedParams(preTwelveC);
const mergedKeys = merged.params.map((p) => p.key);
assert(
	mod.POT_SKIN_PARAMS.every((p) => mergedKeys.includes(p.key)),
	'a Pot Meter saved before 12c gains the skin params on load',
);
assert(
	merged.params[0].default === 'blue' && merged.params[1].default === 2,
	'its own values stay',
);

if (failures > 0) {
	console.error(`\n${failures} assertion(s) failed`);
	process.exit(1);
}
console.info('\nall pot-skin assertions passed');
