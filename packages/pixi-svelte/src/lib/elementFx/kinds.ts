/**
 * How each Element FX kind plays: a MOTION (the element's own transform), a FILTER (a shader pass
 * over its pixels), a BREAK (a still of it, cut into pieces), or a motion and a filter together.
 * Typed `Record<ElementFxKind, …>`, so a kind added to `constants-shared/elementFx` fails the type
 * check here until it is implemented.
 *
 * Every sampler reads its params already resolved (authored over the kind's defaults, clamped) and
 * returns to rest at the end of a play (`t = 1`), except the `exit` kinds, which end hidden.
 */

import type { ElementFxKind } from 'constants-shared/elementFx';
import { efxSide } from 'constants-shared/glslLibrary';
import { BlurFilter, ColorMatrixFilter, type Filter } from 'pixi.js';
import {
	GlitchFilter,
	GlowFilter,
	OutlineFilter,
	PixelateFilter,
	RGBSplitFilter,
} from 'pixi-filters';
import {
	DEG,
	TAU,
	bell,
	clamp01,
	easeInBack,
	easeInOutCubic,
	easeInQuad,
	easeOutBack,
	easeOutQuad,
	flag,
	lerp,
	loopEnvelope,
	num,
	rgb,
	smoothstep,
	str,
	type FxFrame,
	type Motion,
} from './frame';
import {
	bulgeFilter,
	burnFilter,
	colorMixFilter,
	curlFilter,
	dissolveFilter,
	electrocuteFilter,
	freezeFilter,
	goldFilter,
	meltFilter,
	perspectiveFilter,
	petrifyFilter,
	poisonFilter,
	rippleFilter,
	shineFilter,
	sphericonFilter,
	twistFilter,
	waveFilter,
	type ElementFxFilter,
} from './shaders';

/** The element's size on screen, for the passes whose padding is in screen pixels. */
export interface FilterView {
	screenWidth: number;
	screenHeight: number;
}

export interface FilterImpl<F extends Filter> {
	create(frame: FxFrame): F;
	update(filter: F, frame: FxFrame, view: FilterView): void;
	/** Extra room the pass draws outside the element's box, in screen px. */
	padding?(frame: FxFrame, view: FilterView): number;
}

export type BreakStyle = 'crash' | 'crumble' | 'glass' | 'ice' | 'dust';

export interface KindImpl {
	motion?(frame: FxFrame): Partial<Motion>;
	filter?: FilterImpl<Filter>;
	breaks?: BreakStyle;
	/** The break plays backwards: the pieces fly in and become the element (an entrance). */
	reversed?: boolean;
}

const filterImpl = <F extends Filter>(impl: FilterImpl<F>): FilterImpl<Filter> =>
	impl as unknown as FilterImpl<Filter>;

/** Rest-to-rest strength curve with zero slope at both ends, so a repeat has no kink. */
const swell = (t: number): number => 0.5 - 0.5 * Math.cos(TAU * t);

/** Up to 1 over the first `rise` of the play, then eased back to 0. An impact's envelope. */
const punch = (t: number, rise: number): number =>
	t < rise ? t / rise : 1 - easeOutQuad((t - rise) / (1 - rise));

/** Turn progress: eased in and out for a single play, steady while it spins forever. */
const turnProgress = (frame: FxFrame): number =>
	frame.looping ? frame.t : easeInOutCubic(frame.t);

/** How far a sphericon swings side to side as it rolls, radians. */
const SPHERICON_SWING = Math.PI / 5;

const hash = (n: number): number => {
	const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
	return x - Math.floor(x);
};

/**
 * Bounce arcs: `count` hops, each lower than the last, over the first 85% of the play, landing at
 * the end. Returns the height (0…1 of the first hop) and how hard it is pressed into the ground
 * (0…1, peaking at each landing), from which the samplers draw a lift and a squash.
 */
const bounceArcs = (t: number, count: number): { lift: number; squash: number } => {
	const n = Math.max(1, Math.round(count));
	const heights = Array.from({ length: n }, (_, k) => Math.pow(0.45, k));
	const widths = heights.map(Math.sqrt);
	const total = widths.reduce((a, b) => a + b, 0);
	if (t >= 0.85) {
		return { lift: 0, squash: Math.sqrt(heights[n - 1]) * (1 - smoothstep(0.85, 1, t)) };
	}
	let at = (t / 0.85) * total;
	for (let k = 0; k < n; k++) {
		if (at <= widths[k] || k === n - 1) {
			const u = clamp01(at / widths[k]);
			const landing = u > 0.88 ? (u - 0.88) / 0.12 : 0;
			const takeoff = k > 0 && u < 0.12 ? 1 - u / 0.12 : 0;
			const squash =
				landing * Math.sqrt(heights[k]) + takeoff * Math.sqrt(heights[k - 1] ?? heights[k]);
			return { lift: heights[k] * 4 * u * (1 - u), squash };
		}
		at -= widths[k];
	}
	return { lift: 0, squash: 0 };
};

/** Focal length, in element sizes, for a `perspective` param of 0 (flat) … 1 (strong). */
const focal = (perspective: number): number => lerp(6, 1.4, clamp01(perspective));

/** Padding a perspective pass needs: the near edge grows as it turns and lifts toward the eye. */
const perspectivePadding = (lift: number) => (_frame: FxFrame, view: FilterView) =>
	Math.ceil(Math.max(view.screenWidth, view.screenHeight) * (0.3 + 0.8 * lift)) + 2;

const flipImpl = (axis: 'x' | 'y'): KindImpl => ({
	filter: filterImpl<ElementFxFilter>({
		create: perspectiveFilter,
		update(filter, frame) {
			const angle = TAU * num(frame, 'turns') * turnProgress(frame);
			const lift = 0.12 * frame.intensity * bell(frame.t);
			filter.set('uRot', axis === 'y' ? angle : 0, axis === 'x' ? angle : 0, lift);
			filter.set('uPersp', focal(num(frame, 'perspective')), flag(frame, 'shade') ? 1 : 0);
		},
		padding: perspectivePadding(0.25),
	}),
});

const waveImpl = (mode: 0 | 1 | 2): KindImpl => ({
	filter: filterImpl<ElementFxFilter>({
		create: waveFilter,
		update(filter, frame) {
			filter.set(
				'uWave',
				num(frame, 'amplitude') * frame.intensity * loopEnvelope(frame),
				num(frame, 'wavelength'),
				num(frame, 'speed') * frame.seconds,
				mode,
			);
		},
		padding: (frame, view) =>
			Math.ceil(
				num(frame, 'amplitude') *
					frame.intensity *
					(mode === 0 ? view.screenWidth : view.screenHeight),
			) + 2,
	}),
});

/** How far a melt has run at `t`: slow to start, then running freely. */
const meltProgress = (t: number): number => t ** 1.6;

/** Melt: the drips run as a shader pass, and the element fades over the last of the play. */
const meltImpl = (): KindImpl => {
	const seeds = new WeakMap<Filter, number>();
	return {
		motion: (frame) => ({ alpha: 1 - smoothstep(0.7, 1, frame.t) }),
		filter: filterImpl<ElementFxFilter>({
			create() {
				const filter = meltFilter();
				seeds.set(filter, Math.random() * 97);
				return filter;
			},
			update(filter, frame) {
				filter.set(
					'uMelt',
					meltProgress(frame.t),
					num(frame, 'length') * frame.intensity,
					num(frame, 'drips'),
					seeds.get(filter) ?? 0,
				);
				filter.set('uHeat', ...rgb(str(frame, 'color')), num(frame, 'heat'));
			},
			padding: (frame, view) =>
				Math.ceil(
					1.45 * num(frame, 'length') * frame.intensity * meltProgress(frame.t) * view.screenHeight,
				) + 2,
		}),
	};
};

/**
 * The share of a held play (freeze, petrify, gold) spent setting in, and as long again letting go;
 * between, it holds.
 */
const holdSpan = (frame: FxFrame): number => (1 - num(frame, 'hold')) / 2;

/** How far the ice, stone or gold has covered the element at `t`: in, held, and back out. */
const holdCoverage = (frame: FxFrame): number => {
	const span = holdSpan(frame);
	const t = frame.t;
	if (t < span) return easeOutQuad(t / span);
	if (t <= 1 - span) return 1;
	return 1 - easeInOutCubic((t - (1 - span)) / span);
};

/** Freeze: the frost runs as a shader pass; the element shivers as the ice locks in. */
const freezeImpl = (): KindImpl => {
	const seeds = new WeakMap<Filter, number>();
	return {
		motion(frame) {
			const k = (frame.t - holdSpan(frame)) / 0.06;
			if (k < 0 || k > 1) return {};
			const amp = 0.012 * Math.min(frame.width, frame.height) * frame.intensity * (1 - k);
			return { x: amp * Math.sin(frame.seconds * 95) };
		},
		filter: filterImpl<ElementFxFilter>({
			create() {
				const filter = freezeFilter();
				seeds.set(filter, Math.random() * 97);
				return filter;
			},
			update(filter, frame) {
				const span = holdSpan(frame);
				const held = 1 - 2 * span;
				filter.set(
					'uFreeze',
					holdCoverage(frame),
					num(frame, 'crystals'),
					seeds.get(filter) ?? 0,
					efxSide(str(frame, 'from'), 'edges'),
				);
				filter.set('uIce', ...rgb(str(frame, 'color')));
				const glint =
					held > 0 && frame.t >= span && frame.t <= 1 - span
						? -0.3 + 1.6 * ((frame.t - span) / held)
						: -10;
				filter.set('uGlint', Math.min(1, frame.intensity), glint);
			},
		}),
	};
};

/**
 * Petrify: the stone runs as a shader pass, flaking off at an even pace so each chip reads; the
 * element drops a little as it locks with a thud.
 */
const petrifyImpl = (): KindImpl => {
	const seeds = new WeakMap<Filter, number>();
	return {
		motion(frame) {
			const k = (frame.t - holdSpan(frame)) / 0.08;
			if (k < 0 || k > 1) return {};
			return { y: 0.014 * frame.height * frame.intensity * Math.sin(Math.PI * k) * (1 - k) };
		},
		filter: filterImpl<ElementFxFilter>({
			create() {
				const filter = petrifyFilter();
				seeds.set(filter, Math.random() * 97);
				return filter;
			},
			update(filter, frame) {
				const span = holdSpan(frame);
				const flaked = span > 0 ? Math.max(0, (frame.t - (1 - span)) / span) : 0;
				const coverage = flaked > 0 ? 1 - flaked : holdCoverage(frame);
				filter.set(
					'uStone',
					coverage,
					num(frame, 'grain'),
					seeds.get(filter) ?? 0,
					efxSide(str(frame, 'from'), 'bottom'),
				);
				filter.set('uRock', ...rgb(str(frame, 'color')), Math.min(1, frame.intensity));
				filter.set('uChip', flaked, flaked > 0 || coverage >= 1 ? 0 : 0.6);
			},
		}),
	};
};

/**
 * Turn to gold: the metal runs as a shader pass; the element rings with a small swell as the gold
 * sets, and a glint sweeps across while it holds.
 */
const goldImpl = (): KindImpl => {
	const seeds = new WeakMap<Filter, number>();
	return {
		motion(frame) {
			const k = (frame.t - holdSpan(frame)) / 0.1;
			if (k < 0 || k > 1) return {};
			const swell = 1 + 0.04 * frame.intensity * Math.sin(Math.PI * k) * (1 - k);
			return { scaleX: swell, scaleY: swell };
		},
		filter: filterImpl<ElementFxFilter>({
			create() {
				const filter = goldFilter();
				seeds.set(filter, Math.random() * 97);
				return filter;
			},
			update(filter, frame) {
				const span = holdSpan(frame);
				const held = 1 - 2 * span;
				filter.set(
					'uGold',
					holdCoverage(frame),
					seeds.get(filter) ?? 0,
					efxSide(str(frame, 'from'), 'center'),
					frame.seconds,
				);
				filter.set('uMetal', ...rgb(str(frame, 'color')), Math.min(1, frame.intensity));
				const glint =
					held > 0 && frame.t >= span && frame.t <= 1 - span
						? -0.3 + 1.6 * ((frame.t - span) / held)
						: -10;
				filter.set('uShine', glint, flag(frame, 'sparkles') ? 1 : 0, frame.t < span ? 1 : 0);
			},
		}),
	};
};

/** Where a burn's front is at `t`: just short of the element at the start, past every ash by the
 *  end (the farthest point is 1 away and its ash is gone 0.65 behind the front). */
const burnFront = (t: number): number => -0.1 + 1.8 * t;

/** Burn to ashes: the fire runs as a shader pass; the motion only makes sure it ends hidden. */
const burnImpl = (): KindImpl => {
	const seeds = new WeakMap<Filter, number>();
	return {
		motion: (frame) => ({ alpha: 1 - smoothstep(0.94, 1, frame.t) }),
		filter: filterImpl<ElementFxFilter>({
			create() {
				const filter = burnFilter();
				seeds.set(filter, Math.random() * 97);
				return filter;
			},
			update(filter, frame) {
				filter.set(
					'uBurn',
					burnFront(frame.t),
					num(frame, 'grain'),
					seeds.get(filter) ?? 0,
					efxSide(str(frame, 'from'), 'bottom'),
				);
				filter.set('uFlame', ...rgb(str(frame, 'color')), frame.seconds);
				filter.set('uAsh', ...rgb(str(frame, 'ash')), flag(frame, 'sparks') ? 1 : 0);
				filter.set('uGlow', Math.max(0.4, Math.min(1.6, frame.intensity)), 0);
			},
		}),
	};
};

/** Poison: the venom runs as a shader pass, and the element sways queasily while it plays. Both
 *  follow the loop envelope: steady while looping, seeping in and out of a counted play. */
const poisonImpl = (): KindImpl => {
	const seeds = new WeakMap<Filter, number>();
	return {
		motion(frame) {
			const k = loopEnvelope(frame) * frame.intensity;
			const a = TAU * frame.t;
			return {
				rotation: 0.035 * k * Math.sin(a),
				scaleX: 1 + 0.025 * k * Math.sin(2 * a),
				scaleY: 1 - 0.025 * k * Math.sin(2 * a),
			};
		},
		filter: filterImpl<ElementFxFilter>({
			create() {
				const filter = poisonFilter();
				seeds.set(filter, Math.random() * 97);
				return filter;
			},
			update(filter, frame) {
				filter.set(
					'uPoison',
					loopEnvelope(frame) * Math.min(1, frame.intensity),
					num(frame, 'veins'),
					seeds.get(filter) ?? 0,
					frame.seconds,
				);
				filter.set('uVenom', ...rgb(str(frame, 'color')), flag(frame, 'bubbles') ? 1 : 0);
			},
		}),
	};
};

/** How hard an electrocution bites at `frame`: struck at once, held, let go over its last fifth. */
const zapEnvelope = (frame: FxFrame): number =>
	frame.looping ? 1 : smoothstep(0, 0.06, frame.t) * (1 - smoothstep(0.8, 1, frame.t));

/** Electrocute: the arcs run as a shader pass; the element jitters violently while they bite. */
const electrocuteImpl = (): KindImpl => {
	const seeds = new WeakMap<Filter, number>();
	return {
		motion(frame) {
			const k = zapEnvelope(frame) * frame.intensity;
			if (k <= 0) return {};
			const amp = Math.min(12, Math.max(1.5, 0.02 * Math.min(frame.width, frame.height))) * k;
			const s = frame.seconds;
			return {
				x: amp * Math.sin(s * 157) * Math.sin(s * 23),
				y: amp * Math.sin(s * 131 + 1.3) * Math.sin(s * 17),
				rotation: 0.02 * k * Math.sin(s * 97),
			};
		},
		filter: filterImpl<ElementFxFilter>({
			create() {
				const filter = electrocuteFilter();
				seeds.set(filter, Math.random() * 97);
				return filter;
			},
			update(filter, frame) {
				filter.set(
					'uZap',
					zapEnvelope(frame) * Math.min(1, frame.intensity),
					Math.round(num(frame, 'arcs')),
					seeds.get(filter) ?? 0,
					frame.seconds,
				);
				filter.set('uArc', ...rgb(str(frame, 'color')), flag(frame, 'flicker') ? 1 : 0);
			},
			padding: (frame, view) =>
				zapEnvelope(frame) > 0
					? Math.ceil(0.15 * Math.max(view.screenWidth, view.screenHeight)) + 2
					: 0,
		}),
	};
};

const dissolveImpl = (direction: 'out' | 'in'): KindImpl => {
	const seeds = new WeakMap<Filter, number>();
	return {
		filter: filterImpl<ElementFxFilter>({
			create() {
				const filter = dissolveFilter();
				seeds.set(filter, Math.random() * 97);
				return filter;
			},
			update(filter, frame) {
				const progress = direction === 'out' ? frame.t : 1 - frame.t;
				filter.set(
					'uDissolve',
					progress,
					num(frame, 'edge'),
					num(frame, 'grain'),
					seeds.get(filter) ?? 0,
				);
				filter.set('uEdgeColor', ...rgb(str(frame, 'color')));
			},
		}),
	};
};

export const KINDS: Record<ElementFxKind, KindImpl> = {
	// --- motion ---
	shake: {
		motion(frame) {
			const amp =
				frame.intensity *
				Math.min(40, Math.max(3, 0.04 * Math.min(frame.width, frame.height))) *
				(1 - frame.t);
			const hz = num(frame, 'frequency');
			const axis = str(frame, 'axis');
			const s = frame.seconds;
			return {
				x: axis === 'y' ? 0 : amp * Math.sin(TAU * hz * s),
				y: axis === 'x' ? 0 : amp * Math.sin(TAU * hz * 1.37 * s + 1.1),
			};
		},
	},
	wobble: {
		motion: (frame) => ({
			rotation:
				num(frame, 'angle') *
				DEG *
				frame.intensity *
				Math.sin(TAU * Math.round(num(frame, 'cycles')) * frame.t) *
				Math.pow(1 - frame.t, 1.5),
		}),
	},
	pulse: {
		motion(frame) {
			const k = 1 + (num(frame, 'scale') - 1) * frame.intensity * swell(frame.t);
			return { scaleX: k, scaleY: k };
		},
	},
	heartbeat: {
		motion(frame) {
			const t = frame.t;
			const beat = (start: number, length: number): number =>
				t >= start && t <= start + length ? swell((t - start) / length) : 0;
			const k =
				1 + (num(frame, 'scale') - 1) * frame.intensity * (beat(0, 0.3) + 0.7 * beat(0.32, 0.3));
			return { scaleX: k, scaleY: k };
		},
	},
	jelly: {
		motion(frame) {
			const o =
				num(frame, 'squash') *
				frame.intensity *
				Math.sin(TAU * Math.round(num(frame, 'cycles')) * frame.t) *
				Math.pow(1 - frame.t, 2);
			return { scaleX: 1 + o, scaleY: 1 - o, pivotY: 1 };
		},
	},
	bounce: {
		motion(frame) {
			const { lift, squash } = bounceArcs(frame.t, num(frame, 'bounces'));
			const q = 0.22 * Math.min(1.5, frame.intensity) * squash;
			return {
				y: -lift * num(frame, 'height') * frame.intensity * frame.height,
				scaleX: 1 + q * 0.8,
				scaleY: 1 - q,
				pivotY: 1,
			};
		},
	},
	spin: {
		motion: (frame) => ({ rotation: TAU * num(frame, 'turns') * turnProgress(frame) }),
	},
	swing: {
		motion: (frame) => ({
			rotation:
				num(frame, 'angle') *
				DEG *
				frame.intensity *
				Math.sin(TAU * Math.round(num(frame, 'cycles')) * frame.t) *
				(1 - frame.t),
			pivotY: 0,
		}),
	},
	float: {
		motion(frame) {
			const k = frame.intensity * loopEnvelope(frame);
			return {
				y: -num(frame, 'distance') * frame.height * k * Math.sin(TAU * frame.t),
				rotation: num(frame, 'tilt') * DEG * k * Math.cos(TAU * frame.t),
			};
		},
	},
	popIn: {
		motion(frame) {
			const s = Math.max(
				1e-4,
				easeOutBack(frame.t, num(frame, 'overshoot') * 17 * frame.intensity),
			);
			return { scaleX: s, scaleY: s, alpha: clamp01(frame.t * 5) };
		},
	},
	popOut: {
		motion(frame) {
			const swellBy = num(frame, 'overshoot') * frame.intensity;
			const t = frame.t;
			const s =
				t < 0.25
					? 1 + swellBy * Math.sin((Math.PI / 2) * (t / 0.25))
					: (1 + swellBy) * (1 - easeInBack((t - 0.25) / 0.75, 1.2));
			const scale = Math.max(1e-4, s);
			return { scaleX: scale, scaleY: scale, alpha: 1 - smoothstep(0.7, 1, t) };
		},
	},
	slamIn: {
		motion(frame) {
			const t = frame.t;
			const impact = 0.45;
			if (t < impact) {
				const u = t / impact;
				return {
					y: -num(frame, 'height') * frame.intensity * frame.height * (1 - easeInQuad(u)),
					scaleX: 1 + 0.25 * frame.intensity * (1 - u),
					scaleY: 1 + 0.25 * frame.intensity * (1 - u),
					alpha: clamp01(u * 4),
					pivotY: 1,
				};
			}
			const u = (t - impact) / (1 - impact);
			// Decays to exactly nothing at the end, so the last frame does not snap.
			const settle = Math.exp(-5 * u) * (1 - u);
			const q = num(frame, 'squash') * frame.intensity * settle * Math.cos(TAU * 1.5 * u);
			const rattle = 0.03 * frame.width * frame.intensity * settle * Math.sin(TAU * 9 * u);
			return { x: rattle, scaleX: 1 + q * 0.8, scaleY: 1 - q, pivotY: 1 };
		},
	},
	fadeIn: { motion: (frame) => ({ alpha: easeOutQuad(frame.t) }) },
	fadeOut: { motion: (frame) => ({ alpha: 1 - easeInQuad(frame.t) }) },

	// --- 3D ---
	flipX: flipImpl('x'),
	flipY: flipImpl('y'),
	bounce3D: {
		motion(frame) {
			const { squash } = bounceArcs(frame.t, num(frame, 'bounces'));
			const q = 0.12 * Math.min(1.5, frame.intensity) * squash;
			return { scaleX: 1 + q, scaleY: 1 - q };
		},
		filter: filterImpl<ElementFxFilter>({
			create: perspectiveFilter,
			update(filter, frame) {
				const { lift } = bounceArcs(frame.t, num(frame, 'bounces'));
				const tilt = num(frame, 'tilt') * DEG * frame.intensity * (1 - frame.t);
				filter.set(
					'uRot',
					tilt * Math.sin(TAU * 1.5 * frame.t),
					0.7 * tilt * Math.sin(TAU * frame.t + 0.6),
					lift * num(frame, 'height') * frame.intensity,
				);
				filter.set('uPersp', focal(0.55), 1);
			},
			padding: (frame, view) =>
				perspectivePadding(num(frame, 'height') * frame.intensity)(frame, view),
		}),
	},
	sphericon: {
		filter: filterImpl<ElementFxFilter>({
			create: sphericonFilter,
			update(filter, frame) {
				const t = frame.t;
				const folded = smoothstep(0, 0.18, t) * (1 - smoothstep(0.82, 1, t));
				// Whole half-turns, so it unfolds upright: the solid shows the art upright both unturned
				// and rolled half a turn. It swings side to side as a rolling sphericon meanders.
				const turns = Math.max(0.5, Math.round(num(frame, 'turns') * 2) / 2);
				filter.set(
					'uSpin',
					TAU * turns * t,
					SPHERICON_SWING * Math.sin(TAU * turns * t),
					num(frame, 'tilt') * DEG * folded,
				);
				filter.set(
					'uSphericon',
					Math.min(1, folded * Math.max(0.25, frame.intensity)),
					0.55,
					flag(frame, 'shade') ? 1 : 0,
				);
			},
			padding: (_frame, view) =>
				Math.ceil(Math.max(view.screenWidth, view.screenHeight) * 0.25) + 2,
		}),
	},
	tilt3D: {
		filter: filterImpl<ElementFxFilter>({
			create: perspectiveFilter,
			update(filter, frame) {
				const a = num(frame, 'angle') * DEG * frame.intensity * loopEnvelope(frame);
				filter.set('uRot', 0.5 * a * Math.cos(TAU * frame.t), a * Math.sin(TAU * frame.t), 0);
				filter.set('uPersp', focal(0.6), 1);
			},
			padding: perspectivePadding(0),
		}),
	},

	// --- distort ---
	waveX: waveImpl(0),
	waveY: waveImpl(1),
	flag: waveImpl(2),
	twist: {
		filter: filterImpl<ElementFxFilter>({
			create: twistFilter,
			update(filter, frame) {
				const k = frame.looping ? Math.sin(TAU * frame.t) : bell(frame.t);
				filter.set('uTwist', num(frame, 'angle') * DEG * frame.intensity * k, num(frame, 'radius'));
			},
		}),
	},
	curl: {
		filter: filterImpl<ElementFxFilter>({
			create: curlFilter,
			update(filter, frame) {
				const t = frame.t;
				const peel = frame.looping
					? swell(t)
					: t < 0.45
						? easeOutQuad(t / 0.45)
						: t < 0.55
							? 1
							: 1 - easeInOutCubic((t - 0.55) / 0.45);
				const corner = str(frame, 'corner');
				const roll = num(frame, 'radius');
				filter.set(
					'uCurl',
					corner.endsWith('Right') ? 1 : 0,
					corner.startsWith('bottom') ? 1 : 0,
					peel * Math.min(1, num(frame, 'amount') * frame.intensity) * (1 + Math.PI * roll),
					roll,
				);
			},
		}),
	},
	ripple: {
		filter: filterImpl<ElementFxFilter>({
			create: rippleFilter,
			update(filter, frame) {
				const fade = 1 - frame.t;
				filter.set(
					'uRipple',
					frame.t * 0.6,
					num(frame, 'width'),
					num(frame, 'amplitude') * frame.intensity * fade,
					0.25 * Math.min(2, frame.intensity) * fade,
				);
			},
		}),
	},
	bulge: {
		filter: filterImpl<ElementFxFilter>({
			create: bulgeFilter,
			update(filter, frame) {
				const s = Math.max(-1, Math.min(1, num(frame, 'strength') * frame.intensity));
				filter.set('uBulge', s * swell(frame.t), num(frame, 'radius'));
			},
		}),
	},
	melt: meltImpl(),

	// --- light / colour ---
	glow: {
		filter: filterImpl<GlowFilter>({
			create: (frame) =>
				new GlowFilter({
					distance: Math.round(num(frame, 'distance')),
					outerStrength: 0,
					innerStrength: 0,
					color: str(frame, 'color'),
					quality: 0.15,
				}),
			update(filter, frame) {
				const k = frame.looping ? 0.6 + 0.4 * Math.sin(TAU * frame.t) : bell(frame.t);
				filter.outerStrength = num(frame, 'strength') * frame.intensity * k;
			},
		}),
	},
	outline: {
		filter: filterImpl<OutlineFilter>({
			create: (frame) =>
				new OutlineFilter({
					thickness: num(frame, 'thickness'),
					color: str(frame, 'color'),
					quality: 0.15,
					alpha: 0,
				}),
			update(filter, frame) {
				const k = frame.looping ? 0.6 + 0.4 * Math.sin(TAU * frame.t) : bell(frame.t);
				filter.alpha = Math.min(1, frame.intensity * k);
			},
		}),
	},
	shine: {
		filter: filterImpl<ElementFxFilter>({
			create: shineFilter,
			update(filter, frame) {
				filter.set(
					'uShine',
					lerp(-0.6, 1.6, frame.t),
					num(frame, 'width') / 2,
					num(frame, 'angle') * DEG,
					num(frame, 'strength') * frame.intensity,
				);
				filter.set('uShineColor', ...rgb(str(frame, 'color')));
			},
		}),
	},
	flash: {
		filter: filterImpl<ElementFxFilter>({
			create: colorMixFilter,
			update(filter, frame) {
				const amount = Math.min(1, num(frame, 'peak') * frame.intensity) * punch(frame.t, 0.15);
				filter.set('uMix', ...rgb(str(frame, 'color')), amount);
			},
		}),
	},
	hueCycle: {
		filter: filterImpl<ColorMatrixFilter>({
			create: () => new ColorMatrixFilter(),
			update(filter, frame) {
				filter.hue(360 * Math.round(num(frame, 'cycles')) * frame.t, false);
			},
		}),
	},
	chromatic: {
		filter: filterImpl<RGBSplitFilter>({
			create: () =>
				new RGBSplitFilter({ red: { x: 0, y: 0 }, green: { x: 0, y: 0 }, blue: { x: 0, y: 0 } }),
			update(filter, frame) {
				const wave = frame.looping
					? Math.sin(TAU * 2 * frame.t)
					: Math.sin(TAU * 3 * frame.t) * (1 - frame.t);
				const o = num(frame, 'offset') * frame.intensity * wave;
				filter.redX = o;
				filter.blueX = -o;
				filter.greenY = 0.35 * o;
			},
			padding: (frame) => Math.ceil(num(frame, 'offset') * frame.intensity) + 1,
		}),
	},
	glitch: {
		filter: filterImpl<GlitchFilter>({
			create: () =>
				new GlitchFilter({ slices: 8, offset: 0, fillMode: 0, seed: 0.5, average: false }),
			update(filter, frame, view) {
				const step = Math.floor(frame.seconds * 14);
				const r = hash(step);
				const envelope = frame.looping ? 1 : 1 - smoothstep(0.6, 1, frame.t);
				const on = r < 0.7;
				const amount = num(frame, 'amount') * frame.intensity * envelope;
				const offset = on ? amount * 0.15 * view.screenWidth : 0;
				if (filter.seed !== r) {
					filter.seed = r;
					filter.refresh();
				}
				filter.offset = offset;
				filter.red = { x: on ? offset * 0.25 : 0, y: 0 };
				filter.blue = { x: on ? -offset * 0.25 : 0, y: 0 };
			},
			padding: (frame, view) =>
				Math.ceil(num(frame, 'amount') * frame.intensity * 0.15 * view.screenWidth) + 1,
		}),
	},
	blur: {
		filter: filterImpl<BlurFilter>({
			create: () => new BlurFilter({ strength: 0, quality: 3 }),
			update(filter, frame) {
				filter.strength = num(frame, 'strength') * frame.intensity * bell(frame.t);
			},
		}),
	},
	pixelate: {
		filter: filterImpl<PixelateFilter>({
			create: () => new PixelateFilter(1),
			update(filter, frame) {
				filter.size = Math.max(1, Math.round(num(frame, 'size') * frame.intensity * bell(frame.t)));
			},
		}),
	},
	freeze: freezeImpl(),
	burn: burnImpl(),
	poison: poisonImpl(),
	electrocute: electrocuteImpl(),
	petrify: petrifyImpl(),
	turnToGold: goldImpl(),
	dissolveOut: dissolveImpl('out'),
	dissolveIn: dissolveImpl('in'),

	// --- break ---
	crash: { breaks: 'crash' },
	crumble: { breaks: 'crumble' },
	shatter: { breaks: 'glass' },
	crystallize: { breaks: 'ice' },
	disintegrate: { breaks: 'dust' },
	assemble: { breaks: 'dust', reversed: true },
};
