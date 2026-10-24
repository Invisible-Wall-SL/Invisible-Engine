/**
 * A CUSTOM kind (`custom:<id>`, authored in Invisible Shader Graph) as the runtime plays it: the same
 * {@link KindImpl} a built-in has. Its graph is one `ElementFxFilter` pass, its built-in passes are
 * those kinds' own filters playing in step with it, and its motion is a curve per channel.
 */

import {
	ELEMENT_FX_LIMITS,
	ELEMENT_FX_PASS_KINDS,
	elementFxParamUniform,
	resolveElementFxParams,
	sampleElementFxCurve,
	type CustomElementFx,
	type CustomElementFxMotion,
	type CustomElementFxPass,
	type ElementFxParamValue,
} from 'constants-shared/elementFx';
import type { Filter } from 'pixi.js';
import { DEG, clamp01, type FxFrame, type Motion } from './frame';
import { KINDS, filterImpl, type FilterImpl, type KindImpl } from './kinds';
import { ElementFxFilter } from './shaders';

const VECTOR_TYPES = { vec2: 2, vec3: 3, vec4: 4 } as const;

const graphPass = (effect: CustomElementFx): FilterImpl<Filter> => {
	const params = new Map(effect.spec.params.map((spec) => [spec.id, spec]));
	const { body, uniforms } = effect.shader;
	const seed = uniforms.find((u) => u.source.kind === 'seed');
	return filterImpl<ElementFxFilter>({
		create() {
			const filter = new ElementFxFilter(
				effect.spec.kind.replace(/\W/g, '-'),
				body,
				Object.fromEntries(
					uniforms.map((u) => [
						u.name,
						u.type === 'float'
							? { value: 0, type: 'f32' }
							: { value: new Float32Array(VECTOR_TYPES[u.type]), type: `${u.type}<f32>` },
					]),
				),
			);
			// Drawn once per element, as the built-ins draw theirs; an effect that reads none draws none.
			if (seed) filter.set(seed.name, Math.random() * 97);
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
			effect.padding > 0
				? (_frame, view) =>
						Math.ceil(effect.padding * Math.max(view.screenWidth, view.screenHeight)) + 2
				: undefined,
	});
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
			const values: Record<string, ElementFxParamValue> = {};
			for (const [id, value] of Object.entries(given)) {
				const bound = typeof value === 'object' ? effectParams[value.param] : value;
				if (bound !== undefined) values[id] = bound;
			}
			params = resolveElementFxParams(pass.kind, values);
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

const impls = new WeakMap<CustomElementFx, KindImpl>();

/** How `effect` plays: its graph, then its passes, plus its motion. Built once per registered effect. */
export function customKindImpl(effect: CustomElementFx): KindImpl {
	const cached = impls.get(effect);
	if (cached) return cached;
	const passes = effect.passes.map(builtInPass).filter((p): p is FilterImpl<Filter> => !!p);
	const impl: KindImpl = {
		filters: [graphPass(effect), ...passes],
		motion:
			effect.motion && Object.keys(effect.motion.channels).length
				? curvedMotion(effect.motion)
				: undefined,
	};
	impls.set(effect, impl);
	return impl;
}
