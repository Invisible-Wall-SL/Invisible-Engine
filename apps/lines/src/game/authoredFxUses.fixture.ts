/**
 * Offline fixture for the scan that finds every effect the loader compiles ahead of play. Run:
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs apps/lines/src/game/authoredFxUses.fixture.ts
 *
 * The shapes are the ones `commonoverlayproject` ships (2026-10-27), where the effects compiled
 * mid-play were a symbol state's `electrocute`, a layout entry's `wobble` and a Flow v2 camera step's
 * `chromaticWobble`. FOUR claims:
 *
 *  1. EVERY SHAPE. A layout `elementFx` entry, a symbol state's entries, a Flow v1 step (colour as
 *     `color`) and a Flow v2 literal input are all found, with the params each plays with.
 *  2. DISTINCT BY PARAMS. The same kind with the same params is one use; other params are another.
 *  3. ONLY EFFECTS. A kind neither vocabulary knows (`sprite`, `delay`, an unregistered custom
 *     effect) is not a use.
 *  4. SAFE ON ANY DATA. Nothing, a cycle or a scalar gives no uses and does not throw.
 */

import { authoredFxUses } from './authoredFxUses.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`ok   ${label}`);
	} else {
		failures++;
		console.error(`FAIL ${label}\n     got      ${a}\n     expected ${e}`);
	}
};

const bundle = {
	doc: {
		scenes: [
			{ id: 'base', nodes: [{ id: 'logo', kind: 'sprite', assetKey: 'logo' }] },
			{ elementFx: [{ id: 'efx1', kind: 'wobble', trigger: 'cue', cue: 'introParticles' }] },
		],
	},
	symbols: {
		fx: {
			POT_BLUE: {
				coinIdle: [
					{
						id: 'efx1',
						kind: 'electrocute',
						trigger: 'always',
						params: { arcs: 1, flicker: false },
					},
				],
			},
			POT_GREEN: {
				coinIdle: [
					{
						id: 'efx1',
						kind: 'electrocute',
						trigger: 'always',
						params: { color: '#8fff9c', arcs: 1, flicker: false },
					},
				],
			},
			POT_RED: {
				coinIdle: [
					{
						id: 'efx1',
						kind: 'electrocute',
						trigger: 'always',
						params: { arcs: 1, flicker: false },
					},
				],
			},
		},
	},
	flow: { steps: [{ type: 'elementEffect', kind: 'glow', target: 'reels', color: '#ffcc00' }] },
	flowV2: {
		nodes: [
			{
				id: 'camera-1',
				kind: 'call',
				ref: 'cameraEffect',
				inputs: {
					kind: {
						kind: 'literal',
						type: { t: 'enum', name: 'CameraEffectKind' },
						value: 'chromaticWobble',
					},
				},
			},
			{ id: 'delay-1', kind: 'delay' },
		],
	},
};

const uses = authoredFxUses(bundle);
check('1. every Element FX shape, with its params', uses.elementFx, [
	{ kind: 'wobble' },
	{ kind: 'electrocute', params: { arcs: 1, flicker: false } },
	{ kind: 'electrocute', params: { color: '#8fff9c', arcs: 1, flicker: false } },
	{ kind: 'glow', params: { color: '#ffcc00' } },
]);
check('1. a Flow v2 literal camera step', uses.camera, ['chromaticWobble']);
check(
	'2. one use per kind and params',
	uses.elementFx.filter((use) => use.kind === 'electrocute').length,
	2,
);

check(
	'3. an unregistered custom kind is not a use',
	authoredFxUses({ fx: [{ kind: 'custom:ripples' }] }).elementFx,
	[],
);
check(
	'3. layout and flow kinds are not uses',
	authoredFxUses({ a: { kind: 'sprite' }, b: { kind: 'delay' }, c: { kind: 'literal', value: 3 } }),
	{ elementFx: [], camera: [] },
);

const cycle: Record<string, unknown> = { kind: 'shine' };
cycle.self = cycle;
check('4. a cycle is walked once', authoredFxUses(cycle).elementFx, [{ kind: 'shine' }]);
for (const empty of [undefined, null, 7, 'flash', []])
	check(`4. no uses in ${JSON.stringify(empty)}`, authoredFxUses(empty), {
		elementFx: [],
		camera: [],
	});

if (failures > 0) throw new Error(`authored FX use fixture failed: ${failures} check(s)`);
console.log('\nall authored-FX-use checks passed');
