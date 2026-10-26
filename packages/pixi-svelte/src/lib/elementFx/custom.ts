/**
 * A CUSTOM kind (`custom:<id>`, authored in Invisible Shader Graph) as the runtime plays it: the same
 * {@link KindImpl} a built-in has. Its graph is one `ElementFxFilter` pass, its built-in passes are
 * those kinds' own filters playing in step with it, and its motion is a curve per channel. A motion
 * program (its motion graph, compiled) runs each frame and drives the channels it names, each over
 * its curve, and the graph pass's padding. A break (its Break Output) is a built-in break the runtime
 * plays over a window of the play; while it plays, the passes and the motion are held where the
 * graph meets it.
 */

import {
	CUSTOM_ELEMENT_FX_MOTION_PADDING_MAX,
	ELEMENT_FX_LIMITS,
	ELEMENT_FX_MOTION_RANGES,
	ELEMENT_FX_PASS_KINDS,
	customElementFxBreakWindow,
	elementFxParamUniform,
	resolveElementFxParams,
	sampleElementFxCurve,
	type CustomElementFx,
	type CustomElementFxBreak,
	type CustomElementFxMotion,
	type CustomElementFxMotionProgram,
	type CustomElementFxPass,
	type CustomElementFxPassValue,
	type ElementFxMotionChannel,
	type ElementFxMotionOutput,
	type ElementFxParamValue,
} from 'constants-shared/elementFx';
import { runMotionProgram } from 'constants-shared/motionLibrary';
import type { Filter } from 'pixi.js';
import { DEG, clamp01, type FxFrame, type Motion } from './frame';
import {
	KINDS,
	filterImpl,
	type BreakStyle,
	type BreakWindow,
	type FilterImpl,
	type KindImpl,
} from './kinds';
import { ElementFxFilter } from './shaders';

const VECTOR_TYPES = { vec2: 2, vec3: 3, vec4: 4 } as const;

/**
 * The filter a compiled graph's pass draws with, its uniforms declared and zeroed. The runtime plays
 * a custom kind through it; `/shaders` draws its node thumbnails through it too.
 */
export const graphFilter = (name: string, shader: CustomElementFx['shader']): ElementFxFilter =>
	new ElementFxFilter(
		name.replace(/\W/g, '-'),
		shader.body,
		Object.fromEntries(
			shader.uniforms.map((u) => [
				u.name,
				u.type === 'float'
					? { value: 0, type: 'f32' }
					: { value: new Float32Array(VECTOR_TYPES[u.type]), type: `${u.type}<f32>` },
			]),
		),
	);

/** An element's seed, by its play's params (one object per play): drawn on first asking. */
type SeedOf = (params: FxFrame['params']) => number;

/** A motion program's driven values at a frame, worked out once a frame however often asked. */
type Driven = (frame: FxFrame) => Partial<Record<ElementFxMotionOutput, number>>;

const graphPass = (
	effect: CustomElementFx,
	seedOf: SeedOf,
	driven?: Driven,
): FilterImpl<Filter> => {
	const params = new Map(effect.spec.params.map((spec) => [spec.id, spec]));
	const { uniforms } = effect.shader;
	const seed = uniforms.find((u) => u.source.kind === 'seed');
	return filterImpl<ElementFxFilter>({
		create(frame) {
			const filter = graphFilter(effect.spec.kind, effect.shader);
			// Drawn once per element, as the built-ins draw theirs; an effect that reads none draws none.
			if (seed) filter.set(seed.name, seedOf(frame.params));
			return filter;
		},
		update(filter, frame) {
			for (const u of uniforms) {
				if (u.source.kind === 'time') {
					filter.set(u.name, frame.t, frame.seconds, frame.intensity, frame.looping ? 1 : 0);
					continue;
				}
				if (u.source.kind === 'seed') continue;
				const spec = params.get(u.source.id);
				if (spec) filter.set(u.name, ...elementFxParamUniform(spec, frame.params[spec.id]));
			}
		},
		padding:
			driven && effect.motion?.program?.outputs.padding !== undefined
				? (frame, view) => {
						const room = Math.min(
							CUSTOM_ELEMENT_FX_MOTION_PADDING_MAX,
							Math.max(0, driven(frame).padding ?? 0),
						);
						return room > 0
							? Math.ceil(room * Math.max(view.screenWidth, view.screenHeight)) + 2
							: 0;
					}
				: effect.padding > 0
					? (_frame, view) =>
							Math.ceil(effect.padding * Math.max(view.screenWidth, view.screenHeight)) + 2
					: undefined,
	});
};

/** A pass's or a break's values, its ties read from the effect's params (left out when unset). */
const tiedValues = (
	given: Readonly<Record<string, CustomElementFxPassValue>>,
	effectParams: FxFrame['params'],
): Record<string, ElementFxParamValue> => {
	const values: Record<string, ElementFxParamValue> = {};
	for (const [id, value] of Object.entries(given)) {
		const bound = typeof value === 'object' ? effectParams[value.param] : value;
		if (bound !== undefined) values[id] = bound;
	}
	return values;
};

/**
 * A built-in pass: its kind's filter, fed the effect's frame with its own params (resolved once
 * per play: the effect's params are fixed for one) and its strength, within the runtime's.
 */
const builtInPass = (pass: CustomElementFxPass): FilterImpl<Filter> | undefined => {
	const impl = (ELEMENT_FX_PASS_KINDS as readonly string[]).includes(pass.kind)
		? KINDS[pass.kind].filter
		: undefined;
	if (!impl) return undefined;
	const given = pass.params ?? {};
	const strength = pass.intensity ?? 1;
	const resolved = new WeakMap<object, Record<string, ElementFxParamValue>>();
	const paramsFor = (effectParams: FxFrame['params']): Record<string, ElementFxParamValue> => {
		let params = resolved.get(effectParams);
		if (!params) {
			params = resolveElementFxParams(pass.kind, tiedValues(given, effectParams));
			resolved.set(effectParams, params);
		}
		return params;
	};
	const frameOf = (frame: FxFrame): FxFrame => ({
		...frame,
		intensity: Math.min(ELEMENT_FX_LIMITS.intensity.max, frame.intensity * strength),
		params: paramsFor(frame.params),
	});
	const padding = impl.padding;
	return {
		create: (frame) => impl.create(frameOf(frame)),
		update: (filter, frame, view) => impl.update(filter, frameOf(frame), view),
		padding: padding ? (frame, view) => padding(frameOf(frame), view) : undefined,
	};
};

/**
 * The motion a custom effect's curves describe at `frame`. Alpha does not scale with intensity and
 * stays 0…1; a scale never reaches 0 or turns the element over, however strong the play.
 */
const curvedMotion =
	(motion: CustomElementFxMotion) =>
	(frame: FxFrame): Partial<Motion> => {
		const { channels } = motion;
		const at = (channel: keyof typeof channels, rest: number): number => {
			const curve = channels[channel];
			return curve ? sampleElementFxCurve(curve, frame.t) : rest;
		};
		const k = frame.intensity;
		const scale = at('scale', 1);
		return {
			x: k * at('x', 0) * frame.width,
			y: k * at('y', 0) * frame.height,
			scaleX: Math.max(1e-4, 1 + k * (scale * at('scaleX', 1) - 1)),
			scaleY: Math.max(1e-4, 1 + k * (scale * at('scaleY', 1) - 1)),
			rotation: k * at('rotation', 0) * DEG,
			alpha: clamp01(at('alpha', 1)),
			pivotX: motion.pivot?.x ?? 0.5,
			pivotY: motion.pivot?.y ?? 0.5,
		};
	};

/**
 * `program` run at a frame: each play's params as the uniforms hold them (worked out once a play),
 * the element's seed; the last frame's answer kept, as the motion and the padding both ask for it.
 */
const drivenBy = (
	effect: CustomElementFx,
	program: CustomElementFxMotionProgram,
	seedOf: SeedOf,
): Driven => {
	const specs = effect.spec.params.filter((spec) => spec.kind !== 'color');
	const numbers = new WeakMap<object, Record<string, number>>();
	const registers = new Float64Array(program.ops.length);
	let last: { frame: FxFrame; values: ReturnType<Driven> } | undefined;
	return (frame) => {
		if (last?.frame === frame) return last.values;
		let params = numbers.get(frame.params);
		if (!params) {
			params = Object.fromEntries(
				specs.map((spec) => [spec.id, elementFxParamUniform(spec, frame.params[spec.id])[0]]),
			);
			numbers.set(frame.params, params);
		}
		const values = runMotionProgram(
			program,
			{
				t: frame.t,
				seconds: frame.seconds,
				intensity: frame.intensity,
				looping: frame.looping,
				params,
				seed: seedOf(frame.params),
				width: frame.width,
				height: frame.height,
			},
			registers,
		);
		last = { frame, values };
		return values;
	};
};

const SCALES = ['scale', 'scaleX', 'scaleY'] as const;

/**
 * The motion of an effect with a motion program at `frame`: each channel the program drives at its
 * value, final and kept to the channel's range; the rest from their curves (scaled by intensity) or
 * at rest. Alpha stays 0…1 and a scale above 0.
 */
const programMotion =
	(motion: CustomElementFxMotion, driven: Driven) =>
	(frame: FxFrame): Partial<Motion> => {
		const values = driven(frame);
		const { channels } = motion;
		const k = frame.intensity;
		const curve = (channel: ElementFxMotionChannel, rest: number): number => {
			const keys = channels[channel];
			return keys ? sampleElementFxCurve(keys, frame.t) : rest;
		};
		const value = (channel: ElementFxMotionChannel): number | undefined => {
			const v = values[channel];
			if (v === undefined) return undefined;
			const range = ELEMENT_FX_MOTION_RANGES[channel];
			return Math.min(range.max, Math.max(range.min, v));
		};
		let scaleX: number;
		let scaleY: number;
		if (SCALES.some((channel) => values[channel] !== undefined)) {
			// A driven factor as it is, a curved one scaled by intensity on its own.
			const factor = (channel: ElementFxMotionChannel): number =>
				value(channel) ?? 1 + k * (curve(channel, 1) - 1);
			scaleX = factor('scale') * factor('scaleX');
			scaleY = factor('scale') * factor('scaleY');
		} else {
			const scale = curve('scale', 1);
			scaleX = 1 + k * (scale * curve('scaleX', 1) - 1);
			scaleY = 1 + k * (scale * curve('scaleY', 1) - 1);
		}
		return {
			x: (value('x') ?? k * curve('x', 0)) * frame.width,
			y: (value('y') ?? k * curve('y', 0)) * frame.height,
			scaleX: Math.max(1e-4, scaleX),
			scaleY: Math.max(1e-4, scaleY),
			rotation: (value('rotation') ?? k * curve('rotation', 0)) * DEG,
			alpha: clamp01(value('alpha') ?? curve('alpha', 1)),
			pivotX: motion.pivot?.x ?? 0.5,
			pivotY: motion.pivot?.y ?? 0.5,
		};
	};

/**
 * A custom effect's break as the runtime plays it: the built-in break kind's own, over its window,
 * its params resolved once a play from the effect's through its ties (as a built-in pass's are).
 */
const breakWindowOf = (brk: CustomElementFxBreak): BreakWindow => {
	const kind = KINDS[brk.kind];
	const resolved = new WeakMap<object, Record<string, ElementFxParamValue>>();
	return {
		...customElementFxBreakWindow(brk),
		kind: brk.kind,
		style: kind.breaks as BreakStyle,
		reversed: !!kind.reversed,
		live: !!kind.live,
		params(effectParams) {
			let params = resolved.get(effectParams);
			if (!params) {
				params = resolveElementFxParams(brk.kind, tiedValues(brk.params, effectParams));
				resolved.set(effectParams, params);
			}
			return params;
		},
	};
};

/**
 * The frame an effect with a break shows its passes and motion at: while the break plays, held where
 * its graph meets the break (a still is cut from it there; an assemble's pieces come together into
 * it), its seconds as they were or will be then. The same frame gives the same held one.
 */
const holdAt = (window: BreakWindow): ((frame: FxFrame) => FxFrame) => {
	let last: { frame: FxFrame; held: FxFrame } | undefined;
	return (frame) => {
		if (frame.t < window.from || frame.t > window.to || frame.t === window.edge) return frame;
		if (last?.frame !== frame) {
			const seconds = Math.max(0, frame.seconds + (window.edge - frame.t) * frame.playSeconds);
			last = { frame, held: { ...frame, t: window.edge, seconds } };
		}
		return last.held;
	};
};

/** `pass` seeing the frames `hold` gives it. */
const heldPass = (
	pass: FilterImpl<Filter>,
	hold: (frame: FxFrame) => FxFrame,
): FilterImpl<Filter> => {
	const padding = pass.padding;
	return {
		create: (frame) => pass.create(hold(frame)),
		update: (filter, frame, view) => pass.update(filter, hold(frame), view),
		padding: padding ? (frame, view) => padding(hold(frame), view) : undefined,
	};
};

const impls = new WeakMap<CustomElementFx, KindImpl>();

/** How `effect` plays: its graph, then its passes, plus its motion. Built once per registered effect. */
export function customKindImpl(effect: CustomElementFx): KindImpl {
	const cached = impls.get(effect);
	if (cached) return cached;
	// One seed per element (per play), shared by its graph's pass and its motion program.
	const seeds = new WeakMap<object, number>();
	const seedOf: SeedOf = (params) => {
		let seed = seeds.get(params);
		if (seed === undefined) {
			seed = Math.random() * 97;
			seeds.set(params, seed);
		}
		return seed;
	};
	const motion = effect.motion;
	const program = motion?.program;
	const driven = program ? drivenBy(effect, program, seedOf) : undefined;
	const drivesChannels =
		!!program && Object.keys(program.outputs).some((output) => output !== 'padding');
	const passes = effect.passes.map(builtInPass).filter((p): p is FilterImpl<Filter> => !!p);
	const filters = [graphPass(effect, seedOf, driven), ...passes];
	const moves =
		motion && driven && drivesChannels
			? programMotion(motion, driven)
			: motion && Object.keys(motion.channels).length
				? curvedMotion(motion)
				: undefined;
	const breakWindow = effect.break ? breakWindowOf(effect.break) : undefined;
	const hold = breakWindow && holdAt(breakWindow);
	const impl: KindImpl = hold
		? {
				filters: filters.map((pass) => heldPass(pass, hold)),
				motion: moves && ((frame) => moves(hold(frame))),
				breakWindow,
			}
		: { filters, motion: moves };
	impls.set(effect, impl);
	return impl;
}
