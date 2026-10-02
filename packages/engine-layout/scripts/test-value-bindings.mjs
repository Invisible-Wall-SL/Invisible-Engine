// @ts-nocheck — a Node script inside a browser package's `include: ["."]`; its tsconfig has no Node
// types or top-level await, so checking it only adds noise to the package's svelte-check.
// Verify the pure VALUE BINDING helpers (Hold and Win Phase 12b — numbers drive transform / fill /
// frame / animation / bone).
//
//   node scripts/test-value-bindings.mjs
//
// Same esbuild-bundle trick as test-signal-gates.mjs: bundle the pure helpers (no `.svelte`) into one
// ESM file Node can run, then assert the contract the runtime (`<LayoutNodeView>`) and the editor
// preview share:
//  (a) inputs: `{param}` placeholders expand from the instance's params, `param` wins over `source`,
//      `of` normalises (param first, else source), an unresolved placeholder leaves the binding inert;
//  (b) mapping: in range → out range along the ease, clamped unless opted out, per-target defaults;
//  (c) folding: offsets add, multipliers multiply, `visible` gates, an unbound node keeps identity;
//  (d) fill / frame / scrub / bone outputs, and the bone offset undoes itself exactly.
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));

const bundled = await esbuild.build({
	stdin: {
		contents: `export {
			bindingFrameIndex,
			bindingInput,
			bindingNumber,
			bindingTargetsForKind,
			boundBoneOffsets,
			boundFillShare,
			boundFrameOutput,
			boundScrubs,
			defaultBindingOutRange,
			easeValue,
			evaluateBinding,
			expandSourceTemplate,
			fillMaskRect,
			foldBoundTransform,
			isLiveBinding,
			resolveBindingInputs,
			smoothedValue,
		} from '../src/lib/valueBindings.ts';
		export { applySpineBoneOffset, isIdentityBoneOffset } from '../../pixi-svelte/src/lib/spineBoneOffset.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-value-bindings.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `value-bindings-test-${process.pid}.mjs`);
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
const near = (a, b) => Math.abs(a - b) < 1e-9;

// --- (a) inputs ---
const potParams = { meter: 'red', scale: 1 };
assert(
	mod.expandSourceTemplate('meter.{meter}.level', potParams) === 'meter.red.level',
	'a {param} placeholder expands from the instance params',
);
assert(
	mod.expandSourceTemplate('respinsLeft', {}) === 'respinsLeft',
	'a plain source name passes through',
);
assert(
	mod.expandSourceTemplate('meter.{meter}.level', {}) === undefined,
	'an unresolved placeholder leaves the source unresolved (inert, never a half name)',
);
assert(
	mod.expandSourceTemplate('meter.{meter}.level', { meter: '' }) === undefined,
	'an EMPTY param counts as unresolved',
);
assert(mod.expandSourceTemplate('row.{n}', { n: 3 }) === 'row.3', 'a numeric param expands too');

const levelBinding = { target: 'bone', source: 'meter.{meter}.level', of: 'meter.{meter}.max' };
const inputs = mod.resolveBindingInputs(levelBinding, potParams);
assert(
	inputs?.value.source === 'meter.red.level' && inputs?.of?.source === 'meter.red.max',
	'value and divisor both expand against the same instance',
);
assert(
	mod.resolveBindingInputs({ target: 'x', param: 'level', source: 'respinsLeft' }, {})?.value
		.param === 'level',
	'param wins over source',
);
assert(
	mod.resolveBindingInputs({ target: 'x', source: 'win', of: 'max' }, { max: 10 })?.of?.param ===
		'max',
	'`of` reads a param when the instance has one by that key',
);
assert(
	mod.resolveBindingInputs({ target: 'x' }, {}) === undefined,
	'a binding with no input does nothing',
);
assert(
	mod.resolveBindingInputs({ target: 'x', source: 'a', of: 'meter.{meter}.max' }, {}) === undefined,
	'an unresolved divisor makes the whole binding inert (never an un-normalised value)',
);

assert(mod.bindingNumber(3) === 3, 'numbers read as themselves');
assert(mod.bindingNumber(true) === 1 && mod.bindingNumber(false) === 0, 'booleans read 1 / 0');
assert(mod.bindingNumber('2.5') === 2.5, 'a numeric string reads as its number');
assert(mod.bindingNumber('GRAND') === undefined, 'a non-numeric string is no value');
assert(mod.bindingNumber(NaN) === undefined, 'NaN is no value');
assert(mod.bindingInput(3, 12, true) === 0.25, 'normalised: value / of');
assert(mod.bindingInput(3, 0, true) === 0, 'a zero divisor reads empty, never infinite');
assert(mod.bindingInput(3, undefined, true) === 0, 'a missing divisor reads empty');
assert(mod.bindingInput(3, 12, false) === 3, 'un-normalised: the raw value');
assert(mod.bindingInput(undefined) === undefined, 'no value yet ⇒ undefined (inert)');

// --- (b) mapping ---
assert(
	mod.evaluateBinding({ target: 'x', inMin: 0, inMax: 10, outMin: 0, outMax: 200 }, 5) === 100,
	'linear map: halfway in ⇒ halfway out',
);
assert(
	mod.evaluateBinding({ target: 'x', inMin: 0, inMax: 10, outMin: 0, outMax: 200 }, 20) === 200,
	'clamped by default past the input range',
);
assert(
	mod.evaluateBinding(
		{ target: 'x', inMin: 0, inMax: 10, outMin: 0, outMax: 200, clamp: false },
		20,
	) === 400,
	'clamp: false extrapolates',
);
assert(
	mod.evaluateBinding({ target: 'x', inMin: 10, inMax: 0, outMin: 0, outMax: 100 }, 2.5) === 75,
	'a reversed input range maps backwards',
);
assert(mod.evaluateBinding({ target: 'alpha' }, 0.4) === 0.4, 'defaults: in 0..1 → alpha 0..1');
assert(
	mod.evaluateBinding({ target: 'scale' }, 1) === 2 &&
		mod.evaluateBinding({ target: 'scale' }, 0) === 1,
	'default scale range is 1..2 (a multiplier: empty = as authored)',
);
assert(
	mod.evaluateBinding({ target: 'frame' }, 1, 8) === 7,
	'a frame binding with no outMax reaches the last frame',
);
assert(
	mod.evaluateBinding({ target: 'x', inMin: 3, inMax: 3, outMin: 0, outMax: 1 }, 3) === 1,
	'a zero-width input range is a step at that value',
);
assert(
	mod.evaluateBinding({ target: 'bone', boneProperty: 'rotation' }, 1) === 90,
	'bone rotation defaults to 0..90 degrees',
);
assert(
	JSON.stringify(mod.defaultBindingOutRange({ target: 'bone', boneProperty: 'y' })) === '[0,50]',
	'bone x/y default to 0..50 px',
);
assert(near(mod.easeValue('easeOut', 0.5), 0.875), 'easeOut is a cubic ease-out');
assert(near(mod.easeValue('easeIn', 0.5), 0.125), 'easeIn is a cubic ease-in');
assert(mod.easeValue('steps', 0.59) === 0.4, 'steps quantises to fifths');
assert(
	mod.easeValue('backOut', 1) === 1 && mod.easeValue('backOut', 0) === 0,
	'eases keep both ends',
);
assert(mod.easeValue('backOut', 0.8) > 1, 'backOut overshoots before settling');

// visible thresholds
assert(mod.evaluateBinding({ target: 'visible' }, 1) === 1, 'visible: a true / full source shows');
assert(
	mod.evaluateBinding({ target: 'visible' }, 0.99) === 0,
	'visible: below the default 1 hides',
);
assert(
	mod.evaluateBinding({ target: 'visible', threshold: 2 }, 2) === 1 &&
		mod.evaluateBinding({ target: 'visible', threshold: 2 }, 1) === 0,
	'visible: stage ≥ n',
);
assert(
	mod.evaluateBinding({ target: 'visible', threshold: 2, below: true }, 1) === 1,
	'visible: `below` inverts',
);

// smoothing
assert(mod.smoothedValue(0, 10, 0, 0.5) === 0, 'a glide starts where it was');
assert(mod.smoothedValue(0, 10, 0.5, 0.5) === 10, 'a glide ends on the target');
assert(mod.smoothedValue(0, 10, 0.25, 0.5) > 5, 'the glide eases out (past halfway at half time)');
assert(mod.smoothedValue(0, 10, 0.1, 0) === 10, 'no duration ⇒ snaps');

// --- (c) folding ---
const base = { x: 100, y: 50, scale: { x: 2, y: 2 }, rotation: 0.5, alpha: 0.8, visible: true };
assert(mod.foldBoundTransform(base, undefined, []) === base, 'no bindings ⇒ the same transform');
assert(
	mod.foldBoundTransform(base, [{ target: 'x' }], [undefined]) === base,
	'a binding with no value yet ⇒ the same transform (renders as authored)',
);
assert(
	mod.foldBoundTransform(base, [{ target: 'fill' }], [0.5]) === base,
	'a non-transform target never touches the transform',
);
const folded = mod.foldBoundTransform(
	base,
	[
		{ target: 'x' },
		{ target: 'y' },
		{ target: 'scale' },
		{ target: 'scaleY' },
		{ target: 'rotation' },
		{ target: 'alpha' },
	],
	[10, -20, 1.5, 2, 90, 0.5],
);
assert(folded.x === 110 && folded.y === 30, 'x / y add pixels to the authored position');
assert(folded.scale.x === 3 && folded.scale.y === 6, 'scale multiplies; scaleY stacks on scale');
assert(near(folded.rotation, 0.5 + Math.PI / 2), 'rotation adds degrees (as radians)');
assert(near(folded.alpha, 0.4), 'alpha multiplies');
assert(folded.visible === true, 'no visible binding ⇒ stays visible');
assert(
	mod.foldBoundTransform(base, [{ target: 'visible' }, { target: 'visible' }], [1, 0]).visible ===
		false,
	'every visible binding must pass',
);
assert(
	mod.foldBoundTransform({ ...base, visible: false }, [{ target: 'visible' }], [1]).visible ===
		false,
	'a binding cannot show a node its layout hides',
);
const unscaled = mod.foldBoundTransform({ x: 0, y: 0, visible: true }, [{ target: 'scaleX' }], [2]);
assert(unscaled.scale.x === 2 && unscaled.scale.y === 1, 'scaling an unscaled node starts from 1');

// --- (d) fill / frame / scrub / bone ---
assert(
	mod.boundFillShare([{ target: 'fill', direction: 'up' }], [1.4])?.share === 1,
	'a fill share is kept within 0..1',
);
assert(
	mod.boundFillShare([{ target: 'fill' }], [undefined]) === undefined,
	'no fill value ⇒ no mask (renders whole)',
);
const upRect = mod.fillMaskRect(100, 200, { x: 0.5, y: 0.5 }, 0.25, 'up');
assert(
	upRect.x === -50 && upRect.y === 50 && upRect.width === 100 && upRect.height === 50,
	'fill up: the bottom quarter of a centred 100×200 sprite',
);
const rightRect = mod.fillMaskRect(100, 40, undefined, 0.5, 'right');
assert(
	rightRect.x === 0 && rightRect.width === 50 && rightRect.height === 40,
	'fill right: the left half of a top-left-anchored bar',
);
const leftRect = mod.fillMaskRect(100, 40, undefined, 0.5, 'left');
assert(leftRect.x === 50 && leftRect.width === 50, 'fill left: grows from the right edge');
const downRect = mod.fillMaskRect(100, 40, undefined, 0.5, 'down');
assert(downRect.y === 0 && downRect.height === 20, 'fill down: grows from the top edge');

assert(mod.bindingFrameIndex(2.6, 8) === 3, 'a frame output rounds');
assert(
	mod.bindingFrameIndex(12, 8) === 7 && mod.bindingFrameIndex(-3, 8) === 0,
	'frame stays in the clip',
);
assert(mod.bindingFrameIndex(3, 0) === 0, 'an empty clip holds frame 0');
assert(
	mod.boundFrameOutput([{ target: 'frame' }, { target: 'x' }], [4, 10]) === 4,
	'the frame output is the frame binding’s',
);

const scrubs = mod.boundScrubs(
	[
		{ target: 'animTime', animation: 'fill' },
		{ target: 'animTime', animation: 'grow', track: 3 },
		{ target: 'animTime' },
		{ target: 'animTime', animation: 'x', track: 0 },
	],
	[0.5, 2, 0.5, 0.2],
);
assert(scrubs.length === 2, 'a scrub without an animation is dropped; one scrub per track');
const track1 = scrubs.find((s) => s.track === 1);
assert(
	track1?.animation === 'x' && track1.time === 0.2,
	'track 0 (the resting animation) is never scrubbed — moved to 1, where the later binding wins',
);
const track3 = scrubs.find((s) => s.track === 3);
assert(track3?.time === 1, 'a scrub keeps its track; time stays 0..1');

const bones = mod.boundBoneOffsets(
	[
		{ target: 'bone', bone: 'belly' },
		{ target: 'bone', bone: 'belly', boneProperty: 'rotation' },
		{ target: 'bone', bone: 'arm', boneProperty: 'y' },
		{ target: 'bone' },
	],
	[1.5, 10, 4, 3],
);
assert(bones.size === 2, 'a bone binding without a bone is dropped');
const belly = bones.get('belly');
assert(
	belly.scaleX === 1.5 && belly.scaleY === 1.5 && belly.rotation === 10,
	'two bindings on one bone combine',
);
assert(bones.get('arm').y === 4, 'a y offset carries');

const bone = { x: 5, y: 6, rotation: 30, scaleX: 2, scaleY: 1 };
const restore = mod.applySpineBoneOffset(bone, {
	x: 1,
	y: 2,
	rotation: 10,
	scaleX: 1.5,
	scaleY: 3,
});
assert(
	bone.x === 6 && bone.y === 4 && bone.rotation === 20 && bone.scaleX === 3 && bone.scaleY === 3,
	'a bone offset: x adds, y and rotation invert into spine space, scales multiply',
);
restore();
assert(
	bone.x === 5 && bone.y === 6 && bone.rotation === 30 && bone.scaleX === 2 && bone.scaleY === 1,
	'restore puts the pose back exactly (so an unkeyed channel never compounds)',
);
assert(mod.isIdentityBoneOffset({ scaleX: 1, x: 0 }), 'an identity offset is detected');
assert(!mod.isIdentityBoneOffset({ scaleX: 1.01 }), 'a real offset is not identity');

// --- liveness + per-kind targets ---
assert(!mod.isLiveBinding({ target: 'x' }), 'no input ⇒ not live');
assert(!mod.isLiveBinding({ target: 'animTime', source: 'a' }), 'a scrub needs an animation');
assert(!mod.isLiveBinding({ target: 'bone', source: 'a' }), 'a bone binding needs a bone');
assert(mod.isLiveBinding({ target: 'fill', param: 'level' }), 'a param input is live');
assert(mod.bindingTargetsForKind('spine').includes('bone'), 'a spine offers the bone target');
assert(!mod.bindingTargetsForKind('text').includes('fill'), 'a text node has no fill');
assert(
	mod.bindingTargetsForKind('flipbook').includes('frame'),
	'a flipbook offers the frame target',
);

if (failures) {
	console.error(`\n${failures} value-binding assertion(s) FAILED`);
	process.exit(1);
}
console.info('\nvalue bindings: all assertions passed');
