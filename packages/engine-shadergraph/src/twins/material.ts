/**
 * The graph twins of the light and material built-ins (`shaders.ts`: shine, colour mix, dissolve,
 * melt, freeze, burn, poison, electrocute, petrify, gold). Each is the pass rebuilt from nodes,
 * expression for expression, and the JS each kind runs to turn its progress, params, strength and
 * looping into uniforms (`kinds.ts`) is rebuilt from nodes too, so a param means the same on either
 * and the gate (`pnpm --filter fx-spike shader-twins`) holds the two to the same pixels.
 */

import {
	ELEMENT_FX_CURVE_KEY_LIMIT,
	elementFxSpec,
	type ElementFxCurve,
	type ElementFxKind,
} from 'constants-shared/elementFx';
import { EFX_SIDES } from 'constants-shared/glslLibrary';
import type { BuiltinTwin } from '../twins';
import { twinGraph, type In, type Ref } from './graph';

type Graph = ReturnType<typeof twinGraph>;

/** The element's colour here, unpremultiplied: `rgb` and `alpha`. */
const pixel = (g: Graph) => g.node('unpremultiply');

const join = (g: Graph, rgb: In, alpha: In): Ref => g.node('premultiply', { rgb, alpha }).out;

const luma = (g: Graph, rgb: In): Ref => g.node('luma', { rgb }).out;

/**
 * A choice param naming the side something spreads from, as `efxAway`'s side number: the param
 * itself where its options are in `EFX_SIDES` order, else picked option by option.
 */
const side = (g: Graph, kind: ElementFxKind, id: string): Ref => {
	const spec = elementFxSpec(kind).params.find((p) => p.id === id);
	if (spec?.kind !== 'choice') throw new Error(`twin ${kind}: ${id} is not a choice`);
	const numbers = spec.options.map((o) => (EFX_SIDES as readonly string[]).indexOf(o));
	if (numbers.some((n) => n < 0)) throw new Error(`twin ${kind}: ${id} names no side`);
	if (numbers.every((n, i) => n === i)) return g.param(id);
	const values = Object.fromEntries(numbers.map((n, i) => ['abcdef'[i], n]));
	return g.node('pick', { index: g.param(id), ...values }).out;
};

/**
 * The held timing of freeze, petrify and gold (`holdSpan`): the share of the play spent setting in
 * (and as long letting go) for `hold`, and where the glint that sweeps across while it holds is
 * (−10, off, outside the hold).
 */
const heldTiming = (g: Graph, hold: Ref) => {
	const t = g.time().progress;
	const span = g.mul(g.oneMinus(hold), 0.5);
	const held = g.sub(1, g.mul(2, span));
	const holding = g.mul(g.mul(g.step(span, t), g.step(t, g.sub(1, span))), g.above(held, 0));
	const along = g.add(-0.3, g.mul(1.6, g.div(g.sub(t, span), g.max(held, 0.0001))));
	return { span, glint: g.mix(-10, along, holding) };
};

/**
 * A built-in's motion `f` over `[from, to]` of the play (`k` 0…1 across it, back at `rest` by its
 * end) as a curve of evenly spaced linear keys, held at `rest` until it starts.
 */
const keyed = (
	from: number,
	to: number,
	f: (k: number) => number,
	rest: number,
): ElementFxCurve => {
	const inner = ELEMENT_FX_CURVE_KEY_LIMIT - 3;
	const keys: { t: number; v: number; ease?: 'hold' }[] = [{ t: 0, v: rest, ease: 'hold' }];
	for (let i = 0; i <= inner; i++) {
		const k = i / inner;
		keys.push({ t: from + (to - from) * k, v: Math.round(f(k) * 1e5) / 1e5 });
	}
	keys.push({ t: 1, v: rest });
	return keys;
};

/** The held kinds move just after setting in: at the default hold, `(1 − 0.4) / 2` of the play. */
const DEFAULT_SPAN = 0.3;

const shine = (): BuiltinTwin => {
	const g = twinGraph('shine', {});
	const time = g.time();
	const at = g.add(g.mul(time.progress, 2.2), -0.6);
	const angle = g.mul(g.param('angle'), Math.PI / 180);
	const axis = g.combine(g.cos(angle), g.sin(angle)).xy;
	const along = g.add(g.dot(g.sub(g.uv(), 0.5), axis), 0.5);
	const band = g.node('band', { x: along, at, width: g.mul(g.param('width'), 0.5) }).out;
	const light = g.mul(g.mul(g.mul(band, band), g.param('strength')), time.intensity);
	const here = pixel(g);
	g.output(join(g, g.add(here.rgb, g.mul(g.param('color'), light)), here.alpha));
	return { kind: 'shine', doc: g.doc() };
};

const flash = (): BuiltinTwin => {
	const g = twinGraph('flash', {});
	const time = g.time();
	const t = time.progress;
	// Up over the first 15% of the play, then eased back down.
	const fall = g.oneMinus(g.div(g.sub(t, 0.15), 0.85));
	const punch = g.mix(g.div(t, 0.15), g.mul(fall, fall), g.step(0.15, t));
	const amount = g.mul(g.min(g.mul(g.param('peak'), time.intensity), 1), punch);
	const here = pixel(g);
	g.output(join(g, g.mix(here.rgb, g.param('color'), amount), here.alpha));
	return { kind: 'flash', doc: g.doc() };
};

const dissolve = (kind: 'dissolveOut' | 'dissolveIn'): BuiltinTwin => {
	const g = twinGraph(kind, {});
	const t = g.time().progress;
	const q = g.add(g.mul(g.uvSquare(), g.param('grain')), g.seed());
	const n = g.add(
		g.add(g.mul(0.55, g.noise(q)), g.mul(0.3, g.noise(q, 2.03, 7.1))),
		g.mul(0.15, g.noise(q, 4.01, 3.7)),
	);
	const edge = g.param('edge');
	const progress = kind === 'dissolveOut' ? t : g.oneMinus(t);
	const gone = g.sub(g.mul(progress, g.add(1, edge)), edge);
	const glowing = g.clamp(g.div(g.sub(n, gone), g.max(edge, 0.0001)), 0, 1);
	const here = pixel(g);
	const rgb = g.mix(g.min(g.mul(g.param('color'), 1.6), 1), here.rgb, glowing);
	g.output(join(g, rgb, g.mul(here.alpha, g.step(gone, n))));
	return { kind, doc: g.doc() };
};

const melt = (): BuiltinTwin => {
	const g = twinGraph('melt', {
		// The built-in's room grows with the drips (length × strength × how far it has run); a doc's
		// is fixed, so the twin takes the most a doc may: room for the longest drips at strength 1.
		padding: 2,
		motion: {
			channels: {
				alpha: [
					{ t: 0, v: 1 },
					{ t: 0.7, v: 1, ease: 'smooth' },
					{ t: 1, v: 0 },
				],
			},
		},
	});
	const time = g.time();
	const seed = g.seed();
	const m = g.pow(time.progress, 1.6);
	const u = g.split(g.uv());
	const drips = g.param('drips');
	const across = g.mul(u.x, drips);
	const line = (x: In, scale: In, at: In) => g.node('noise1', { x, scale, seed: at }).out;
	// How far each column runs: a slow swell, finer streaks and a few long drips.
	const run = g.add(
		g.add(
			g.add(0.3, g.mul(0.35, line(u.x, drips, seed))),
			g.mul(0.2, line(across, 2.7, g.mul(seed, 1.7))),
		),
		g.mul(0.6, g.pow(line(across, 4.3, g.mul(seed, 2.3)), 4)),
	);
	const d = g.mul(g.mul(m, g.mul(g.param('length'), time.intensity)), run);
	// Row v moves down by d (0.3 + 0.7 v): this pixel shows the row that lands here.
	const v = g.div(g.sub(u.y, g.mul(0.3, d)), g.add(1, g.mul(0.7, d)));
	const waver = g.mul(g.mul(0.006, m), g.sin(g.add(g.mul(u.y, 23), seed)));
	const ran = g.node('unpremultiply', {
		color: g.node('sample', { uv: g.combine(g.add(u.x, waver), v).xy }).out,
	});
	const runny = g.clamp(g.mul(g.mul(d, v), 2.5), 0, 1);
	const heat = g.min(g.mul(g.param('color'), 1.4), 1);
	const rgb = g.mix(ran.rgb, heat, g.mul(g.param('heat'), runny));
	g.output(join(g, rgb, g.mul(ran.alpha, g.mul(g.step(0, v), g.step(v, 1)))));
	return { kind: 'melt', doc: g.doc() };
};

const freeze = (): BuiltinTwin => {
	const window = 0.06;
	const seconds = elementFxSpec('freeze').durationMs / 1000;
	const g = twinGraph('freeze', {
		motion: {
			channels: {
				x: keyed(
					DEFAULT_SPAN,
					DEFAULT_SPAN + window,
					(k) => 0.012 * (1 - k) * Math.sin(95 * seconds * (DEFAULT_SPAN + window * k)),
					0,
				),
			},
		},
	});
	const time = g.time();
	const hold = g.param('hold');
	const coverage = g.node('hold', { t: time.progress, hold }).out;
	const { glint } = heldTiming(g, hold);
	// Frost creeps in from the side, its front following the crystals.
	const away = g.node('awaySide', { uv: g.uv(), side: side(g, 'freeze', 'from') }).out;
	const cells = g.node('cells', { p: g.uvSquare(), scale: g.param('crystals'), seed: g.seed() });
	const reach = g.add(g.mul(0.8, away), g.mul(0.2, cells.nearest));
	const front = g.mul(coverage, 1.25);
	const frozen = g.node('front', { reach, front, softness: 0.06 }).out;
	const here = pixel(g);
	const lum = luma(g, here.rgb);
	let ice = g.mix(g.mul(g.param('color'), g.add(0.35, g.mul(0.9, lum))), here.rgb, 0.18);
	ice = g.add(ice, g.mul(0.3, g.oneMinus(g.smooth(0, 0.05, cells.crack))));
	ice = g.add(ice, g.mul(0.08, cells.nearest));
	ice = g.add(ice, g.mul(0.2, g.oneMinus(g.smooth(0, 0.4, reach))));
	ice = g.add(ice, g.mul(0.5, g.node('glint', { uv: g.uv(), at: glint, width: 0.08 }).out));
	ice = g.add(ice, g.mul(0.6, g.node('outline', { width: 1.5 }).out));
	const line = g.node('band', { x: reach, at: g.sub(front, 0.03), width: 0.05 }).out;
	ice = g.add(ice, g.mul(g.mul(0.35, line), g.step(coverage, 0.999)));
	const amount = g.min(time.intensity, 1);
	g.output(join(g, g.mix(here.rgb, g.min(ice, 1), g.mul(frozen, amount)), here.alpha));
	return {
		kind: 'freeze',
		doc: g.doc(),
		motionGap:
			'The shiver as the ice locks in follows the seconds played and comes when the Hold param says; the x curve is that shiver at the default hold and length.',
	};
};

const burn = (): BuiltinTwin => {
	const g = twinGraph('burn', {
		motion: {
			channels: {
				alpha: [
					{ t: 0, v: 1 },
					{ t: 0.94, v: 1, ease: 'smooth' },
					{ t: 1, v: 0 },
				],
			},
		},
	});
	const time = g.time();
	const seed = g.seed();
	const flameColor = g.param('color');
	const glow = g.clamp(time.intensity, 0.4, 1.6);
	const u = g.split(g.uv());
	const from = side(g, 'burn', 'from');
	const away = g.node('awaySide', { uv: g.clamp(g.uv(), 0, 1), side: from }).out;
	const q = g.add(g.mul(g.uvSquare(), g.param('grain')), seed);
	const n = g.add(
		g.add(g.mul(0.6, g.noise(q)), g.mul(0.3, g.noise(q, 2.1, 3.7))),
		g.mul(0.1, g.noise(q, 4.3, 9.1)),
	);
	// How far the fire has come past this pixel, the front roughened by the noise.
	const front = g.add(-0.1, g.mul(1.8, time.progress));
	const s = g.sub(front, g.add(g.mul(0.75, away), g.mul(0.25, n)));
	const here = pixel(g);
	// Ahead of the front it scorches; on it, flame; behind it, ash lifting and crumbling away.
	const scorched = g.mix(here.rgb, [0.22, 0.1, 0.04], g.mul(0.75, g.smooth(-0.16, 0, s)));
	const flickerAt = g.add(g.mul(q, 3), g.combine(0, g.mul(time.seconds, 9)).xy);
	const flicker = g.add(0.75, g.mul(0.25, g.noise(flickerAt)));
	const flame = g.mul(g.mul(g.mix([1, 0.95, 0.65], flameColor, g.div(s, 0.05)), flicker), glow);
	const burning = g.min(g.mul(flame, 1.3), 1);
	const lifted = g.node('sample', {
		uv: g.combine(u.x, g.add(u.y, g.mul(g.sub(s, 0.05), 0.12))).xy,
	}).out;
	const fine = g.noise(q, 6, 1.3);
	const crumble = g.add(g.add(s, g.mul(0.25, g.sub(fine, 0.5))), g.mul(0.2, g.sub(n, 0.5)));
	const ashAlpha = g.mul(g.split(lifted).w, g.oneMinus(g.smooth(0.08, 0.5, crumble)));
	const ember = g.mul(g.step(0.86, fine), g.oneMinus(g.smooth(0.05, 0.25, s)));
	const ash = g.mix(
		g.mul(g.param('ash'), g.add(0.65, g.mul(0.5, fine))),
		g.mul(g.mul(flameColor, 1.2), glow),
		ember,
	);
	const past = g.step(0.05, s);
	const rgb = g.mix(g.mix(scorched, burning, g.step(0, s)), g.min(ash, 1), past);
	const burnt = join(g, rgb, g.mix(here.alpha, ashAlpha, past));
	// Sparks rise from the flames: one in some cells of a grid drifting up.
	const square = g.split(g.uvSquare());
	const sq = g.mul(g.combine(square.x, g.add(square.y, g.mul(time.seconds, 0.35))).xy, 14);
	const cell = g.floor(sq);
	const seeded = g.add(cell, seed);
	const at = g.combine(g.hash(seeded), g.hash(g.add(seeded, 17))).xy;
	const live = g.step(0.6, g.hash(g.add(cell, 5.3)));
	const band = g.mul(g.smooth(-0.25, -0.05, s), g.oneMinus(g.smooth(0.05, 0.2, s)));
	const dot = g.oneMinus(g.smooth(0, 0.12, g.length(g.sub(g.fract(sq), at))));
	const spark = g.mul(g.mul(dot, live), band);
	const near = g.mul(
		g.mul(g.mul(g.step(0, u.x), g.step(u.x, 1)), g.step(-0.25, u.y)),
		g.step(u.y, 1),
	);
	const sparkColor = g.min(g.mul(flameColor, 1.3), 1);
	const sparks = join(g, sparkColor, g.mul(spark, g.mul(g.param('sparks'), near)));
	g.output(g.add(burnt, sparks));
	return { kind: 'burn', doc: g.doc() };
};

/** One looping turn of poison's queasy sway (`poisonImpl`'s motion at full strength) as keys. */
const sway = (f: (a: number) => number): ElementFxCurve => {
	const last = ELEMENT_FX_CURVE_KEY_LIMIT - 1;
	return Array.from({ length: last + 1 }, (_, i) => ({
		t: i / last,
		v: Math.round(f((2 * Math.PI * i) / last) * 1e5) / 1e5,
	}));
};

const poison = (): BuiltinTwin => {
	const g = twinGraph('poison', {
		motion: {
			channels: {
				rotation: sway((a) => (0.035 * Math.sin(a) * 180) / Math.PI),
				scaleX: sway((a) => 1 + 0.025 * Math.sin(2 * a)),
				scaleY: sway((a) => 1 - 0.025 * Math.sin(2 * a)),
			},
		},
	});
	const time = g.time();
	const seed = g.seed();
	const venom = g.param('color');
	const dose = g.mul(g.node('loopEnvelope', { t: time.progress }).out, g.min(time.intensity, 1));
	const here = pixel(g);
	const lum = luma(g, here.rgb);
	let sick = g.add(
		g.mix(here.rgb, g.mul(lum, g.add(0.35, g.mul(0.85, venom))), 0.8),
		g.mul(0.15, venom),
	);
	// Dark veins creep in from the edges as the dose rises, and pulse inward.
	const q = g.add(g.mul(g.uvSquare(), g.param('veins')), seed);
	const ridge = g.oneMinus(g.abs(g.sub(g.mul(2, g.noise(q)), 1)));
	const twig = g.oneMinus(g.abs(g.sub(g.mul(2, g.noise(q, 2.3, 5.1)), 1)));
	const vein = g.add(g.smooth(0.9, 0.98, ridge), g.mul(0.6, g.smooth(0.93, 0.99, twig)));
	const edge = g.oneMinus(g.node('edgeDistance', { uv: g.uv() }).out);
	const creep = g.sub(1, g.mul(dose, 1.2));
	const reach = g.smooth(g.sub(creep, 0.2), creep, g.add(edge, g.mul(0.2, g.noise(q, 0.5))));
	const pulse = g.add(0.65, g.mul(0.35, g.sin(g.sub(g.mul(time.seconds, 4), g.mul(edge, 6)))));
	const veinColor = g.mix([0.12, 0.02, 0.16], venom, g.add(0.1, g.mul(g.mul(0.4, pulse), pulse)));
	sick = g.mix(sick, veinColor, g.mul(g.clamp(g.mul(vein, reach), 0, 1), 0.85));
	// Bubbles rise through it: a ring and a glint in some cells of a grid drifting up.
	const square = g.split(g.uvSquare());
	const bq = g.mul(g.combine(square.x, g.add(square.y, g.mul(time.seconds, 0.12))).xy, 9);
	const cell = g.floor(bq);
	const seeded = g.add(cell, seed);
	const at = g.combine(
		g.add(0.2, g.mul(0.6, g.hash(seeded))),
		g.add(0.2, g.mul(0.6, g.hash(g.add(seeded, 9)))),
	).xy;
	const r = g.add(0.12, g.mul(0.18, g.hash(g.add(cell, 3.3))));
	const live = g.step(0.55, g.hash(g.add(cell, 7.7)));
	const off = g.sub(g.fract(bq), at);
	const ring = g.mul(g.oneMinus(g.smooth(0, 0.05, g.abs(g.sub(g.length(off), r)))), live);
	const glintAt = g.mul(r, 0.35);
	const glint = g.mul(g.oneMinus(g.smooth(0, glintAt, g.length(g.add(off, glintAt)))), live);
	const bubble = g.mul(
		g.clamp(g.add(g.mul(0.8, ring), g.mul(0.6, glint)), 0, 1),
		g.param('bubbles'),
	);
	sick = g.mix(sick, g.min(g.add(g.mul(venom, 1.3), 0.2), 1), bubble);
	// The sick colour may outshine the element's alpha, as the built-in's does.
	g.output(join(g, g.mix(here.rgb, sick, dose), here.alpha), 'add');
	return {
		kind: 'poison',
		doc: g.doc(),
		motionGap:
			'The sway eases in and out with the loop envelope when the effect plays a set number of times; a curve cannot tell a looping play from a counted one, so the twin always sways at full strength, as the built-in does while it loops.',
	};
};

const electrocute = (): BuiltinTwin => {
	const g = twinGraph('electrocute', { padding: 0.15 });
	const time = g.time();
	const t = time.progress;
	const seed = g.seed();
	const arc = g.param('color');
	// Struck at once, held, let go over the last fifth; full while it loops.
	const struck = g.mul(g.smooth(0, 0.06, t), g.oneMinus(g.smooth(0.8, 1, t)));
	const amount = g.mul(g.mix(struck, 1, time.looping), g.min(time.intensity, 1));
	const arcs = g.node('arcs', {
		uv: g.uv(),
		count: g.floor(g.add(g.param('arcs'), 0.5)),
		seed,
		seconds: time.seconds,
		rate: 14,
	});
	const strike = g.floor(g.mul(time.seconds, 14));
	const here = pixel(g);
	const lum = luma(g, here.rgb);
	// Now and then it flickers to a scorched negative; its own outline glows.
	const chance = g.node('hash1', { x: g.add(strike, seed) }).out;
	const flick = g.mul(g.param('flicker'), g.step(0.72, chance));
	const negative = g.mix(here.rgb, g.mul(g.oneMinus(lum), g.add(0.4, g.mul(0.8, arc))), 0.85);
	let rgb = g.mix(here.rgb, negative, g.mul(flick, amount));
	rgb = g.add(rgb, g.mul(g.mul(g.mul(arc, g.node('outline', { width: 2 }).out), 0.8), amount));
	const zapped = g.mul(g.min(rgb, 1), here.alpha);
	const core = g.mul(g.clamp(arcs.core, 0, 1), amount);
	const halo = g.mul(g.clamp(g.mul(arcs.halo, 0.35), 0, 1), amount);
	const lit = g.split(g.min(g.add(g.add(zapped, core), g.mul(arc, halo)), 1));
	const cover = g.mul(g.max(core, g.mul(0.8, halo)), g.sub(1, here.alpha));
	// The arcs' light adds over what is behind, brighter than their alpha.
	g.output(g.combine(lit.x, lit.y, lit.z, g.min(1, g.add(here.alpha, cover))).xyzw, 'add');
	return {
		kind: 'electrocute',
		doc: g.doc(),
		motionGap:
			'The element jitters by sines of the seconds played, up to 25 times a second: far past what 32 curve keys can follow, so the twin does not jitter.',
	};
};

const petrify = (): BuiltinTwin => {
	const window = 0.08;
	const g = twinGraph('petrify', {
		motion: {
			channels: {
				y: keyed(
					DEFAULT_SPAN,
					DEFAULT_SPAN + window,
					(k) => 0.014 * Math.sin(Math.PI * k) * (1 - k),
					0,
				),
			},
		},
	});
	const time = g.time();
	const t = time.progress;
	const seed = g.seed();
	const hold = g.param('hold');
	// In and held as the others; then it flakes off at an even pace, so each chip reads.
	const span = g.mul(g.oneMinus(hold), 0.5);
	const flaked = g.max(0, g.div(g.sub(t, g.sub(1, span)), span));
	const flaking = g.above(flaked, 0);
	const coverage = g.mix(g.node('hold', { t, hold }).out, g.oneMinus(flaked), flaking);
	const dusty = g.mul(0.6, g.oneMinus(g.max(flaking, g.step(1, coverage))));
	const away = g.node('awaySide', { uv: g.uv(), side: side(g, 'petrify', 'from') }).out;
	const q = g.add(g.mul(g.uvSquare(), g.param('grain')), seed);
	const grain = g.add(
		g.add(g.mul(0.55, g.noise(q)), g.mul(0.3, g.noise(q, 2.3, 3.1))),
		g.mul(0.15, g.noise(q, 5.1, 7.7)),
	);
	const slabs = g.node('cells', { p: q, scale: 0.45, seed });
	// Flaking off, every crack opens and the front follows the slabs: a chip at a time.
	const chipping = g.step(0.0001, flaked);
	const reach = g.mix(
		g.add(g.mul(0.8, away), g.mul(0.2, grain)),
		g.add(g.mul(0.3, away), g.mul(0.7, slabs.id)),
		chipping,
	);
	const front = g.mul(coverage, g.mix(1.25, 1.03, chipping));
	const stone = g.node('front', { reach, front, softness: g.mix(0.05, 0.03, chipping) }).out;
	const here = pixel(g);
	const lum = luma(g, here.rgb);
	const shaded = g.mul(g.param('color'), g.add(0.45, g.mul(0.75, lum)));
	let rock = g.mul(shaded, g.add(0.75, g.mul(0.5, grain)));
	rock = g.mul(rock, g.add(0.9, g.mul(0.22, g.step(0.74, g.noise(q, 11, 5)))));
	rock = g.mul(rock, g.sub(1, g.mul(0.3, g.step(0.8, g.noise(q, 14, 1.7)))));
	const cracked = g.max(g.smooth(0.45, 0.65, g.noise(q, 0.6, 11)), g.smooth(0, 0.3, flaked));
	const crack = g.oneMinus(g.smooth(0, 0.03, slabs.crack));
	rock = g.mul(rock, g.sub(1, g.mul(g.mul(0.6, cracked), crack)));
	// Carved: the art's own relief, and the grain's.
	const slope = g.split(g.node('reliefSlope', { uv: g.uv() }).out);
	const relief = g.add(slope.x, slope.y);
	const bumpAt = g.mul(q, 2.3);
	const bumpNoise = (dx: number, dy: number) => g.noise(g.add(bumpAt, [dx, dy]));
	const bump = g.add(
		g.sub(bumpNoise(3.2, 3.1), bumpNoise(3.0, 3.1)),
		g.sub(bumpNoise(3.1, 3.2), bumpNoise(3.1, 3.0)),
	);
	const carve = g.clamp(g.add(g.mul(1.2, relief), g.mul(1.5, bump)), -1, 1);
	rock = g.mul(rock, g.add(1, g.mul(0.45, carve)));
	const line = g.node('band', { x: reach, at: g.sub(front, 0.03), width: 0.05 }).out;
	rock = g.mix(rock, [0.85, 0.82, 0.76], g.mul(dusty, line));
	rock = g.add(
		rock,
		g.mul(g.mul(0.14, chipping), g.oneMinus(g.smooth(0, 0.05, g.sub(front, reach)))),
	);
	const amount = g.min(time.intensity, 1);
	g.output(join(g, g.mix(here.rgb, g.clamp(rock, 0, 1), g.mul(stone, amount)), here.alpha));
	return {
		kind: 'petrify',
		doc: g.doc(),
		motionGap:
			'The thud as the stone locks in comes when it has set in, which the Hold param moves; the y curve is that thud at the default hold.',
	};
};

const turnToGold = (): BuiltinTwin => {
	const window = 0.1;
	const g = twinGraph('turnToGold', {
		motion: {
			channels: {
				scale: keyed(
					DEFAULT_SPAN,
					DEFAULT_SPAN + window,
					(k) => 1 + 0.04 * Math.sin(Math.PI * k) * (1 - k),
					1,
				),
			},
		},
	});
	const time = g.time();
	const t = time.progress;
	const seed = g.seed();
	const hold = g.param('hold');
	const coverage = g.node('hold', { t, hold }).out;
	const { span, glint } = heldTiming(g, hold);
	const away = g.node('awaySide', { uv: g.uv(), side: side(g, 'turnToGold', 'from') }).out;
	const square = g.uvSquare();
	const n = g.add(g.mul(0.65, g.noise(square, 5, seed)), g.mul(0.35, g.noise(square, 11, seed)));
	const reach = g.add(g.mul(0.82, away), g.mul(0.18, n));
	const front = g.mul(coverage, 1.22);
	const gilt = g.node('front', { reach, front, softness: 0.04 }).out;
	// A molten white-gold front glows while it spreads.
	const spreading = g.mul(g.oneMinus(g.step(span, t)), g.above(coverage, 0));
	const band = g.node('band', { x: reach, at: g.sub(front, 0.02), width: 0.05 }).out;
	const rim = g.mul(band, spreading);
	const here = pixel(g);
	const lum = luma(g, here.rgb);
	// The art's relief bends a studio reflection and catches a highlight from the top left.
	const normal = g.node('reliefNormal', { uv: g.uv(), strength: 2.5 }).out;
	const facing = g.split(normal);
	const look = g.sub(g.add(g.split(g.uv()).y, g.mul(0.9, facing.y)), g.mul(0.25, facing.x));
	const env = g.add(0.55, g.mul(0.45, g.cos(g.add(g.mul(look, 5), 0.6))));
	const shade = g.clamp(g.add(g.add(0.06, g.mul(0.32, lum)), g.mul(0.62, env)), 0, 1);
	let metal = g.node('metalRamp', { shade, base: g.param('color') }).out;
	const light = g.node('normalize', { v: [-0.5, -0.6, 0.65] }).out;
	metal = g.add(metal, g.mul(g.mul([1, 0.97, 0.88], 0.9), g.pow(g.dot(normal, light), 18)));
	const sweep = g.node('glint', { uv: g.uv(), at: glint, width: 0.07 }).out;
	metal = g.add(metal, g.mul(g.mul([1, 0.95, 0.8], 0.55), sweep));
	const sparkle = g.node('sparkle', { p: square, scale: 6, seed, seconds: time.seconds }).out;
	metal = g.add(metal, g.mul(g.mul(g.mul([1, 0.98, 0.9], sparkle), gilt), g.param('sparkles')));
	const amount = g.min(time.intensity, 1);
	let gilded = g.mix(here.rgb, g.clamp(metal, 0, 1), g.mul(gilt, amount));
	gilded = g.mix(gilded, [1, 0.93, 0.7], g.mul(g.mul(g.clamp(rim, 0, 1), 0.75), amount));
	g.output(join(g, gilded, here.alpha));
	return {
		kind: 'turnToGold',
		doc: g.doc(),
		motionGap:
			'The ring as the gold sets comes when it has set in, which the Hold param moves; the scale curve is that ring at the default hold.',
	};
};

export const MATERIAL_TWINS: readonly BuiltinTwin[] = [
	shine(),
	flash(),
	melt(),
	freeze(),
	burn(),
	poison(),
	electrocute(),
	petrify(),
	turnToGold(),
	dissolve('dissolveOut'),
	dissolve('dissolveIn'),
];
