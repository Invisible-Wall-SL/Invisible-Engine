// The calibration projects of the particle-material phone check (Invisible Shader Graph step 8d.8,
// docs/playtest/particle-material.md): each `cal-*` project's Shader Graph docs and Invisible FX
// effect, from one source, so every phone and every run of `particle-material-play.mjs` (which
// imports `calibrationProjects`) compares the same things. The graphs are `engine-shadergraph`'s
// `CALIBRATION_GRAPHS`; the effects are coin bursts on one art key.
//
// Run directly, it writes each project's files as the launcher stores them, ready to upload into
// `<client>/<project>/` (Invisible FTP Browser, an admin's full view):
//   <out>/<project>/shaders/<graph>.json   a graph, as `/shaders` saves it
//   <out>/<project>/<effect>.fx.json       the effect, as `/fx` saves it
//
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
//     scripts/playtest/particle-calibration.mjs --out <dir> [--art coins]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { normalizeEffectDoc } from '../../packages/engine-fx/src/normalize.ts';
import {
	CALIBRATION_GRAPHS,
	normalizeShaderGraphDoc,
} from '../../packages/engine-shadergraph/index.ts';

/** A graph's id as the launcher stores it (`shaderSlug`), so its kind is `custom:<id>`. */
const graphId = (doc) => doc.id.toLowerCase();
const graph = (id) => {
	const doc = CALIBRATION_GRAPHS.find((d) => d.id === id);
	if (!doc) throw new Error(`no calibration graph ${id}`);
	return normalizeShaderGraphDoc({ ...doc, id: graphId(doc) }, graphId(doc));
};
const kindOf = (doc) => `custom:${doc.id}`;

/** A layer of coins: `rect` where they spawn, `maxParticles`, `frequency` (s), `lifetime` (s). */
export function coinLayer({ key, art, kind, color, maxParticles, frequency, rect, lifetime }) {
	return {
		key,
		config: {
			lifetime: lifetime ?? { min: 1.2, max: 2 },
			frequency,
			emitterLifetime: -1,
			maxParticles,
			pos: { x: 0, y: 0 },
			addAtBack: false,
			behaviors: [
				{ type: 'spawnShape', config: { type: 'rect', data: rect } },
				{
					type: 'scale',
					config: {
						scale: {
							list: [
								{ value: 0.8, time: 0 },
								{ value: 1.4, time: 1 },
							],
						},
						minMult: 0.6,
					},
				},
				{
					type: 'rotation',
					config: { minStart: 0, maxStart: 360, minSpeed: -90, maxSpeed: 90, accel: 0 },
				},
			],
		},
		art: { assetKey: art, frames: [] },
		placement: { space: 'free' },
		particleKind: 'sprite',
		trigger: { on: 'always' },
		material: { kind, intensity: 4, ...(color ? { params: { color } } : {}) },
	};
}

const FIELD = { x: -300, y: -160, w: 600, h: 320 };
/** The layers of the cap's effect: one more than a game draws. */
export const SWARM_LAYERS = 9;

/**
 * Each calibration project: its key, the graphs it ships and its one effect. `cal-plain`'s
 * material names a graph it does not ship, so its layer draws plain (`not registered`): the
 * baseline with the same particles.
 */
export function calibrationProjects({ art = 'coins' } = {}) {
	const light = graph('calLight');
	const budget = graph('calBudget');
	const seed = graph('calSeed');
	const parity = graph('calParity');
	const embers = (id, kind, extra = {}) => ({
		version: 1,
		id,
		name: id,
		layers: [
			coinLayer({
				key: 'main',
				art,
				kind,
				maxParticles: 120,
				frequency: 0.02,
				rect: FIELD,
				...extra,
			}),
		],
	});
	const swarm = {
		version: 1,
		id: 'swarm',
		name: 'swarm',
		layers: Array.from({ length: SWARM_LAYERS }, (_, i) =>
			coinLayer({
				key: `m${i + 1}`,
				art,
				kind: kindOf(light),
				color: ['#ff3366', '#33ccff'][i % 2],
				maxParticles: 24,
				frequency: 0.08,
				rect: { x: -450 + i * 100, y: -160, w: 100, h: 320 },
			}),
		),
	};
	const project = (key, graphs, effect) => ({
		key,
		graphs,
		effect: normalizeEffectDoc(effect, effect.id),
	});
	return [
		project('cal-plain', [], embers('embers', 'custom:calmissing', { color: '#ff3366' })),
		project('cal-light', [light], embers('embers', kindOf(light), { color: '#ff3366' })),
		project('cal-budget', [budget], embers('embers', kindOf(budget))),
		project(
			'cal-512',
			[light],
			embers('embers', kindOf(light), {
				color: '#ff3366',
				maxParticles: 512,
				frequency: 0.004,
				lifetime: { min: 2, max: 3 },
			}),
		),
		project('cal-swarm', [light], swarm),
		project('cal-seed', [seed], embers('embers', kindOf(seed))),
		project('cal-parity', [parity], embers('embers', kindOf(parity))),
	];
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const { values: opt } = parseArgs({
		options: { out: { type: 'string' }, art: { type: 'string', default: 'coins' } },
	});
	if (!opt.out) throw new Error('--out <dir> is required');
	for (const { key, graphs, effect } of calibrationProjects({ art: opt.art })) {
		const dir = resolve(opt.out, key);
		mkdirSync(join(dir, 'shaders'), { recursive: true });
		for (const doc of graphs)
			writeFileSync(join(dir, 'shaders', `${doc.id}.json`), JSON.stringify(doc, null, '\t'));
		writeFileSync(join(dir, `${effect.id}.fx.json`), JSON.stringify(effect, null, '\t'));
		console.log(
			`${key}: ${[...graphs.map((d) => `shaders/${d.id}.json`), `${effect.id}.fx.json`].join(', ')}`,
		);
	}
}
