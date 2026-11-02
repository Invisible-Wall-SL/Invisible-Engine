/**
 * Invisible FX — the `/fx` PERFORMANCE COST readout (`fxCost.client.ts`), headless:
 *
 *   pnpm --filter fx-spike run fx-cost
 *
 * Proves: (1) the coverage geometry — a particle's on-screen box, rotated, scaled and clipped to the
 * viewport; (2) the settings read off a layer (spawn rate, demand, blend, scale) and the hints, on
 * the cases that cost `overlay-wishworld` its frame rate: the 1000/s pot beams capped at 200, a full
 * 1336×755 frame used as a particle, additive stacking; (3) the measure over a REAL library
 * `Emitter` the way `FxStage` takes it (live count, covered screens, zoom, off-screen), and that
 * measuring changes neither the config nor how the emitter plays; (4) the budget constant.
 */

import { Emitter, type EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import { bindArt, type EmitterLayer } from 'engine-fx';
import { Container, Matrix, Rectangle, Texture, TextureSource } from 'pixi.js';
import {
	FX_COST_BUDGET,
	clippedScreenArea,
	layerCostHints,
	layerCostSettings,
	measureEmitter,
	multiplyAffine,
	overBudget,
} from '../../apps/launcher-api/src/routes/(app)/fx/fxCost.client';
import { newLayer } from '../../apps/launcher-api/src/routes/(app)/fx/fxModel.client';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;

const box = (w: number, h: number) => ({ minX: -w / 2, minY: -h / 2, maxX: w / 2, maxY: h / 2 });
const at = (x: number, y: number, s = 1, r = 0) => ({
	a: s * Math.cos(r),
	b: s * Math.sin(r),
	c: -s * Math.sin(r),
	d: s * Math.cos(r),
	tx: x,
	ty: y,
});

console.log('fx cost — coverage geometry');
assert(clippedScreenArea(at(500, 250), box(90, 60), 1000, 500) === 5400, 'a 90×60 box inside');
assert(
	clippedScreenArea(at(0, 0), box(90, 60), 1000, 500) === 45 * 30,
	'a box on the corner keeps the quarter inside',
);
assert(clippedScreenArea(at(-200, 250), box(90, 60), 1000, 500) === 0, 'off screen covers 0');
assert(clippedScreenArea(at(500, 250, 2), box(90, 60), 1000, 500) === 4 * 5400, 'scale 2 → 4×');
assert(
	near(clippedScreenArea(at(500, 250, 1, Math.PI / 4), box(100, 100), 1000, 500), 2 * 10000, 1e-6),
	'a square turned 45° covers its bounding box (2×)',
);
assert(
	clippedScreenArea(at(500, 250), box(4000, 4000), 1000, 500) === 1000 * 500,
	'a particle bigger than the viewport covers exactly one screen',
);
const composed = multiplyAffine(at(100, 50, 2), at(10, 0));
assert(near(composed.tx, 120) && near(composed.a, 2), 'multiplyAffine applies the right one first');

console.log('');
console.log('fx cost — settings and hints');
const beamConfig = (): EmitterConfigV3 =>
	({
		lifetime: { min: 4.6, max: 5 },
		frequency: 0.001,
		emitterLifetime: -1,
		maxParticles: 200,
		particlesPerWave: 1,
		pos: { x: 0, y: 0 },
		addAtBack: false,
		behaviors: [{ type: 'blendMode', config: { blendMode: 'add' } }],
	}) as EmitterConfigV3;
const beam: EmitterLayer = { ...newLayer('VFX_0000_Beam_1'), config: beamConfig() };
const beamSettings = layerCostSettings(beam, { w: 90, h: 60 });
assert(near(beamSettings.spawnRate, 1000), 'the beam asks for 1000 particles/s');
assert(near(beamSettings.demand, 4800), 'and would keep 4800 alive with no cap');
assert(beamSettings.maxParticles === 200 && beamSettings.blend === 'add', 'max 200, additive');
const beamHints = layerCostHints(beamSettings, { live: 200, coverage: 7 });
assert(
	beamHints.some((h) => h.kind === 'cap' && /1000\/s/.test(h.text) && /41\.7\/s/.test(h.text)),
	'hint: the rate pins it at its cap, ~41.7/s fills it',
);
assert(
	beamHints.some((h) => h.kind === 'additive' && /7\.00 screens/.test(h.text)),
	'hint: additive stacking at 7 screens',
);
assert(
	!beamHints.some((h) => h.kind === 'count'),
	'the cap hint stands in for the plain count hint',
);
const calm = layerCostSettings(
	{ ...beam, config: { ...beamConfig(), frequency: 0.05 } },
	{
		w: 90,
		h: 60,
	},
);
assert(
	!layerCostHints(calm, { live: 96, coverage: 0.5 }).length,
	'a beam at 20/s on 0.5 screens: no hints',
);
const normal = layerCostSettings(
	{ ...beam, config: { ...beamConfig(), behaviors: [] } },
	{
		w: 90,
		h: 60,
	},
);
assert(
	normal.blend === 'normal' &&
		!layerCostHints(normal, { live: 200, coverage: 2 }).some((h) => h.kind === 'additive'),
	'normal blend: no additive hint',
);
const reelBg = layerCostSettings(
	{
		...beam,
		config: {
			...beamConfig(),
			frequency: 0.1,
			maxParticles: 60,
			behaviors: [{ type: 'scaleStatic', config: { min: 0.3, max: 0.4 } }],
		},
	},
	{ w: 1336, h: 755 },
);
assert(near(reelBg.scale, 0.4), 'scaleStatic: the largest scale is read');
const bgHints = layerCostHints(reelBg, { live: 60, coverage: 19 });
assert(
	bgHints.some((h) => h.kind === 'large' && /1336×755/.test(h.text) && /32%/.test(h.text)),
	'hint: a 1336×755 frame as a particle, each ~32% of the screen',
);
assert(
	!bgHints.some((h) => h.kind === 'coverage'),
	'the large-art hint stands in for the plain coverage hint',
);
const zeroFreq = layerCostSettings(
	{ ...beam, config: { ...beamConfig(), frequency: 0 } },
	{
		w: 0,
		h: 0,
	},
);
assert(zeroFreq.spawnRate === 0 && zeroFreq.demand === 0, 'frequency 0: no rate, no demand');

console.log('');
console.log('fx cost — budgets');
assert(
	FX_COST_BUDGET.layer.live === 300 &&
		FX_COST_BUDGET.layer.coverage === 1.5 &&
		FX_COST_BUDGET.total.live === 800 &&
		FX_COST_BUDGET.total.coverage === 4,
	'budgets: layer 300 / 1.5 screens, total 800 / 4 screens',
);
assert(!overBudget({ live: 300, coverage: 1.5 }, FX_COST_BUDGET.layer), 'at the budget is ok');
assert(overBudget({ live: 301, coverage: 0 }, FX_COST_BUDGET.layer), 'one particle over warns');
assert(overBudget({ live: 0, coverage: 4.01 }, FX_COST_BUDGET.total), 'coverage over warns');

console.log('');
console.log('fx cost — measured over a real Emitter');
const texture = new Texture({
	source: new TextureSource({ width: 90, height: 60 }),
	frame: new Rectangle(0, 0, 90, 60),
});
const W = 1000;
const H = 500;
const run = (config: EmitterConfigV3, seconds: number): Emitter => {
	const em = new Emitter(new Container(), bindArt(config, [texture], false));
	em.emit = true;
	em.update(0);
	for (let i = 0; i < Math.round(seconds * 60); i++) em.update(1 / 60);
	return em;
};
const stored = JSON.stringify(beam.config);
const em = run(beam.config, 3);
const centre = new Matrix(1, 0, 0, 1, W / 2, H / 2);
const m = measureEmitter(em, centre, W, H);
assert(m.live === 200 && em.particleCount === 200, 'the 1000/s beam sits at its 200 cap');
assert(near(m.area / (W * H), (200 * 5400) / (W * H)), '200 × 90×60 at the centre: 2.16 screens');
const zoomed = measureEmitter(em, new Matrix(2, 0, 0, 2, W / 2, H / 2), W, H);
assert(near(zoomed.area, 4 * m.area), 'zoom 2× → 4× the coverage');
const away = measureEmitter(em, new Matrix(1, 0, 0, 1, -5000, 0), W, H);
assert(away.live === 200 && away.area === 0, 'panned off screen: live, but covering nothing');
const twin = run(beam.config, 3);
measureEmitter(em, centre, W, H);
em.update(1 / 60);
twin.update(1 / 60);
assert(
	em.particleCount === twin.particleCount && JSON.stringify(beam.config) === stored,
	'measuring changes neither the config nor how the emitter plays',
);
const hidden = run({ ...beam.config, maxParticles: 3 }, 1);
for (
	let p = (hidden as unknown as { _activeParticlesFirst: { alpha: number; next: unknown } | null })
		._activeParticlesFirst;
	p;
	p = p.next as typeof p
)
	p.alpha = 0;
const transparent = measureEmitter(hidden, centre, W, H);
assert(
	transparent.live === 3 && transparent.area === 0,
	'transparent particles: live, cover nothing',
);

if (failures) {
	console.error(`fx cost: ${failures} FAILED`);
	process.exit(1);
}
console.log('fx cost: all green');
