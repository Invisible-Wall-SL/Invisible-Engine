// @ts-nocheck — a Node script inside a browser package's `include: ["."]`; its tsconfig has no Node
// types, so checking it only adds noise to the package's svelte-check.
/**
 * Offline fixture for `stableTransform` (`src/lib/resolveTransform.ts`), the one `<LayoutNodeView>`
 * runs its derived transform through:
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
 *     packages/engine-layout/stableTransform.fixture.mjs
 *
 * Why it exists: a node a timeline plays derives its transform again every frame (the sample
 * moves), and a new object with the same values re-ran every prop sync that reads it. On
 * `overlay-buffaloduel` at rest that was 57 rigs' `BaseRigProvider` prop sync every frame, half of
 * the frame's Svelte work in WebKit. Pins:
 *   - the previous object comes back only when every field reads the same: a primitive by
 *     `Object.is`, a point (`anchor`, `scale`, `screenAnchor`) by its own fields;
 *   - any one field that differs (each field of a full transform, in turn), a point that differs in
 *     one coordinate, a field added or dropped, `0` against `-0`: the new object comes back;
 *   - in Svelte itself (the client runtime, a `$derived` shaped like `<LayoutNodeView>`'s): an effect
 *     reading the transform runs once while the sample moves and nothing it says changes, runs again
 *     when a value changes, and always reads the latest values.
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { stableTransform } from './src/lib/resolveTransform.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
	if (ok) console.log(`  ok    ${label}`);
	else {
		failures += 1;
		console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
	}
};

const full = () => ({
	x: 10,
	y: 20,
	anchor: { x: 0.5, y: 0.5 },
	scale: { x: 1, y: 2 },
	rotation: 0.25,
	alpha: 0.75,
	zIndex: 3,
	width: 100,
	height: 50,
	tint: 0xff00ff,
	blendMode: 'add',
	visible: true,
	screenAnchor: { x: 1, y: 0 },
});

console.log('the previous object, when nothing reads differently');
{
	const a = full();
	check('no previous: the new one', stableTransform(undefined, a) === a);
	check('the same object: itself', stableTransform(a, a) === a);
	check('a fresh object with the same values: the previous', stableTransform(a, full()) === a);
	const shared = full();
	check(
		'the same points by reference: the previous',
		stableTransform(shared, { ...shared }) === shared,
	);
	const nan = { ...full(), rotation: Number.NaN };
	check('NaN against NaN reads the same', stableTransform(nan, { ...nan }) === nan);
	const sparse = { x: 0, y: 0, visible: true, anchor: undefined };
	check(
		'an undefined field against an undefined field',
		stableTransform(sparse, { x: 0, y: 0, visible: true, anchor: undefined }) === sparse,
	);
}

console.log('the new object, when anything reads differently');
{
	const prev = full();
	const changed = {
		x: 11,
		y: 21,
		anchor: { x: 0.5, y: 0.6 },
		scale: { x: 2, y: 2 },
		rotation: 0.5,
		alpha: 0.5,
		zIndex: 4,
		width: 101,
		height: 51,
		tint: 0x00ff00,
		blendMode: 'multiply',
		visible: false,
		screenAnchor: { x: 1, y: 1 },
	};
	for (const key of Object.keys(prev)) {
		const next = { ...full(), [key]: changed[key] };
		check(`${key} changed`, stableTransform(prev, next) === next);
		const dropped = { ...full() };
		delete dropped[key];
		check(`${key} dropped`, stableTransform(prev, dropped) === dropped);
	}
	const plain = { x: 0, y: 0, visible: true };
	const tinted = { ...plain, tint: 0xffffff };
	check('a field added (a timeline tint)', stableTransform(plain, tinted) === tinted);
	const undefinedKey = { ...plain, tint: undefined };
	check(
		'an undefined field where there was none',
		stableTransform(plain, undefinedKey) === undefinedKey,
	);
	check(
		'no field where there was an undefined one',
		stableTransform(undefinedKey, plain) === plain,
	);
	const zero = { ...plain, rotation: 0 };
	const negZero = { ...plain, rotation: -0 };
	check('0 against -0', stableTransform(zero, negZero) === negZero);
	const pointZero = { ...plain, scale: { x: 0, y: 1 } };
	const pointNegZero = { ...plain, scale: { x: -0, y: 1 } };
	check('a point at 0 against -0', stableTransform(pointZero, pointNegZero) === pointNegZero);
	const pointNaN = { ...plain, scale: { x: Number.NaN, y: 1 } };
	check(
		'a point at NaN against NaN reads the same',
		stableTransform(pointNaN, { ...plain, scale: { x: Number.NaN, y: 1 } }) === pointNaN,
	);
	const pointMore = { ...plain, anchor: { x: 0, y: 0 } };
	const pointExtra = { ...plain, anchor: { x: 0, y: 0, z: 0 } };
	check('a point with another coordinate', stableTransform(pointMore, pointExtra) === pointExtra);
	const pointGone = { ...plain, anchor: { x: 0 } };
	const pointOther = { ...plain, anchor: { x: 0, z: 0 } };
	check(
		'a point with a different coordinate',
		stableTransform(pointGone, pointOther) === pointOther,
	);
	const point = { ...plain, anchor: { x: 0, y: 0 } };
	const noPoint = { ...plain, anchor: undefined };
	check('a point against none', stableTransform(point, noPoint) === noPoint);
	check('none against a point', stableTransform(noPoint, point) === point);
}

console.log('in Svelte: what reads the transform runs only when it changes');
{
	const require = createRequire(import.meta.url);
	const { compileModule } = require('svelte/compiler');
	const svelteRoot = require.resolve('svelte/package.json').replace(/package\.json$/, '');
	const client = (path) => pathToFileURL(`${svelteRoot}${path}`).href;
	// The shape of `<LayoutNodeView>`'s derived: a sample that moves every frame folded into a new
	// object, kept through `stable` (or not, for the control).
	const source = `
		export function probe(stable) {
			let frame = $state(0);
			let alpha = $state(1);
			let runs = 0;
			let read;
			let last;
			const transform = $derived.by(() => {
				frame;
				const next = { x: 0, y: 0, anchor: { x: 0.5, y: 0.5 }, alpha, visible: true };
				last = stable ? stable(last, next) : next;
				return last;
			});
			const stop = $effect.root(() => {
				$effect(() => {
					read = transform.alpha;
					runs += 1;
				});
			});
			return {
				frame() { frame += 1; },
				setAlpha(value) { alpha = value; },
				runs: () => runs,
				read: () => read,
				stop,
			};
		}`;
	const { js } = compileModule(source, { filename: 'stableTransformProbe.svelte.js' });
	// Svelte's CLIENT runtime (Node's own resolution picks the server one).
	const code = js.code.replace(
		/(from |import )'svelte\/internal\/([^']+)'/g,
		(_m, lead, rest) =>
			`${lead}'${client(`src/internal/${rest === 'client' ? 'client/index.js' : `${rest}.js`}`)}'`,
	);
	const { probe } = await import(`data:text/javascript,${encodeURIComponent(code)}`);
	const { flushSync } = await import(client('src/index-client.js'));
	const play = (stable) => {
		const p = probe(stable);
		flushSync();
		for (let i = 0; i < 10; i++) {
			p.frame();
			flushSync();
		}
		const still = p.runs();
		p.setAlpha(0.5);
		flushSync();
		const afterChange = p.runs();
		const read = p.read();
		for (let i = 0; i < 10; i++) {
			p.frame();
			flushSync();
		}
		const end = p.runs();
		p.stop();
		return { still, afterChange, read, end };
	};
	const control = play();
	check(
		'control (a new object each frame): the effect runs every frame',
		control.still === 11 && control.end === 22,
		JSON.stringify(control),
	);
	const kept = play(stableTransform);
	check(
		'kept: one run over ten frames that change nothing',
		kept.still === 1,
		JSON.stringify(kept),
	);
	check('kept: a value that changes runs it again', kept.afterChange === 2, JSON.stringify(kept));
	check('kept: it reads the new value', kept.read === 0.5, JSON.stringify(kept));
	check('kept: and then rests again', kept.end === 2, JSON.stringify(kept));
}

if (failures) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nall checks passed');
