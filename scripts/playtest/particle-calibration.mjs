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
//   <out>/cal-coin/coin3d.png              the coin spike's page, to make into an atlas
//
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
//     scripts/playtest/particle-calibration.mjs --out <dir> [--art coins] [--coin-art <manifest>]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { PNG } from 'pngjs';

import { normalizeEffectDoc } from '../../packages/engine-fx/src/normalize.ts';
import { COIN_SPIKE_FRAME, COIN_SPIKE_SIZE, coinSpikePixels } from './coin-spike-art.mjs';
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

/**
 * A layer of coins: `rect` where they spawn, `maxParticles`, `frequency` (s), `lifetime` (s);
 * `frames` the art's frames (absent: the whole sheet), `scale` its start and end.
 */
export function coinLayer({
	key,
	art,
	frames = [],
	kind,
	color,
	maxParticles,
	frequency,
	rect,
	lifetime,
	scale = [0.8, 1.4],
}) {
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
								{ value: scale[0], time: 0 },
								{ value: scale[1], time: 1 },
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
		art: { assetKey: art, frames },
		placement: { space: 'free' },
		particleKind: 'sprite',
		trigger: { on: 'always' },
		material: { kind, intensity: 4, ...(color ? { params: { color } } : {}) },
	};
}

const FIELD = { x: -300, y: -160, w: 600, h: 320 };
/**
 * The coin spike's atlas (`coin-spike-art.mjs`): a manifest key, as an Atlas Maker atlas is named,
 * and its one frame. A project that names another atlas passes `coinArt`.
 */
export const COIN_SPIKE_ART = 'calibration/cal-coin/manifests/atlas_manifest_coin3d.json';
/** The layers of the cap's effect: one more than a game draws. */
export const SWARM_LAYERS = 9;

/** The coin spike's page (`coin-spike-art.mjs`) as a PNG. */
export function coinSpikePng(size = COIN_SPIKE_SIZE) {
	const png = new PNG({ width: size, height: size });
	png.data = Buffer.from(coinSpikePixels(size));
	return PNG.sync.write(png);
}

/**
 * Each calibration project: its key, the graphs it ships and its one effect. `cal-plain`'s
 * material names a graph it does not ship, so its layer draws plain (`not registered`): the
 * baseline with the same particles.
 */
export function calibrationProjects({ art = 'coins', coinArt = COIN_SPIKE_ART } = {}) {
	const light = graph('calLight');
	const coin = graph('calCoin');
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
		// The step-8f coin spike: a solid coin traced in each particle, about 160 px across.
		project(
			'cal-coin',
			[coin],
			embers('embers', kindOf(coin), {
				art: coinArt,
				frames: [COIN_SPIKE_FRAME],
				scale: [0.28, 0.34],
			}),
		),
	];
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const { values: opt } = parseArgs({
		options: {
			out: { type: 'string' },
			art: { type: 'string', default: 'coins' },
			'coin-art': { type: 'string', default: COIN_SPIKE_ART },
		},
	});
	if (!opt.out) throw new Error('--out <dir> is required');
	for (const { key, graphs, effect } of calibrationProjects({
		art: opt.art,
		coinArt: opt['coin-art'],
	})) {
		const dir = resolve(opt.out, key);
		mkdirSync(join(dir, 'shaders'), { recursive: true });
		for (const doc of graphs)
			writeFileSync(join(dir, 'shaders', `${doc.id}.json`), JSON.stringify(doc, null, '\t'));
		writeFileSync(join(dir, `${effect.id}.fx.json`), JSON.stringify(effect, null, '\t'));
		const art = key === 'cal-coin' ? [`${COIN_SPIKE_FRAME}.png`] : [];
		for (const file of art) writeFileSync(join(dir, file), coinSpikePng());
		console.log(
			`${key}: ${[...graphs.map((d) => `shaders/${d.id}.json`), `${effect.id}.fx.json`, ...art].join(', ')}`,
		);
	}
}
