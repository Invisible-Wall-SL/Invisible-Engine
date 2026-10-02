import type { SpineBoneOffset } from 'pixi-svelte/spineBoneOffset';

import type {
	LayoutNode,
	Point2D,
	ResolvedTransform,
	ValueBinding,
	ValueBindingEase,
	ValueBindingTarget,
} from './types';

/**
 * Value bindings (Hold and Win Phase 12b, `docs/design/hold-and-win.md` §8) — the pure half: where a
 * binding's number comes from, how it maps, and how the mapped outputs fold onto a node. The
 * runtime (`<LayoutNodeView>` via `boundValues.svelte.ts`) and the editor preview both go through
 * these, so a scrubbed test value in the Component Editor and a live pot level in the game land on
 * the same pose. Svelte-free; covered by `scripts/test-value-bindings.mjs`.
 */

/** The targets that fold into the node's {@link ResolvedTransform}. */
const TRANSFORM_TARGETS: ReadonlySet<ValueBindingTarget> = new Set([
	'x',
	'y',
	'scale',
	'scaleX',
	'scaleY',
	'rotation',
	'alpha',
	'visible',
]);

export function isTransformBindingTarget(target: ValueBindingTarget): boolean {
	return TRANSFORM_TARGETS.has(target);
}

/** Which node kinds a target applies to — what the editor offers, and what the runtime honours. */
export function bindingTargetsForKind(kind: LayoutNode['kind']): ValueBindingTarget[] {
	const transform: ValueBindingTarget[] = [
		'x',
		'y',
		'scale',
		'scaleX',
		'scaleY',
		'rotation',
		'alpha',
		'visible',
	];
	if (kind === 'sprite' || kind === 'rect') return [...transform, 'fill'];
	if (kind === 'flipbook') return [...transform, 'fill', 'frame'];
	if (kind === 'spine') return [...transform, 'animTime', 'bone'];
	return transform;
}

/**
 * The output range a target maps to when the binding does not author one — the range an author
 * most often wants, and what the editor seeds a new binding with. `frame` has no fixed top (the
 * clip decides), so its `outMax` is `undefined` ⇒ the last frame ({@link bindingFrameIndex}).
 */
export function defaultBindingOutRange(
	binding: Pick<ValueBinding, 'target' | 'boneProperty'>,
): [number, number | undefined] {
	switch (binding.target) {
		case 'x':
		case 'y':
			return [0, 100];
		case 'rotation':
			return [0, 360];
		case 'scale':
		case 'scaleX':
		case 'scaleY':
			return [1, 2];
		case 'frame':
			return [0, undefined];
		case 'bone': {
			const prop = binding.boneProperty ?? 'scale';
			if (prop === 'x' || prop === 'y') return [0, 50];
			if (prop === 'rotation') return [0, 90];
			return [1, 2];
		}
		default:
			return [0, 1];
	}
}

/**
 * Expand `{key}` placeholders in a source name from the owning instance's params — the Pot def's
 * `meter.{meter}.level` reads `meter.red.level` on the red pot. A placeholder whose param is
 * missing, empty or not a string/number yields `undefined`: the binding is inert rather than
 * subscribing to a half-built name. A name without placeholders is returned as is.
 */
export function expandSourceTemplate(
	template: string,
	params: Record<string, unknown>,
): string | undefined {
	let unresolved = false;
	const out = template.replace(/\{([^{}]+)\}/g, (_, raw: string) => {
		const value = params[raw.trim()];
		if (
			(typeof value === 'string' && value) ||
			(typeof value === 'number' && Number.isFinite(value))
		)
			return String(value);
		unresolved = true;
		return '';
	});
	return unresolved || !out ? undefined : out;
}

/** One input of a binding: read a component param, or subscribe an engine source. */
export type BindingInputRef = { param: string } | { source: string };

/** Where a binding's value (and its `of` divisor) come from, after placeholder expansion. */
export type BindingInputs = { value: BindingInputRef; of?: BindingInputRef };

/**
 * Resolve a binding's inputs against the owning instance's params. `param` wins over `source`; `of`
 * reads a param when the instance has one by that key, else it is a source. `undefined` when the
 * binding names no input or a placeholder does not resolve — the binding then does nothing.
 */
export function resolveBindingInputs(
	binding: ValueBinding,
	params: Record<string, unknown>,
): BindingInputs | undefined {
	let value: BindingInputRef | undefined;
	if (binding.param) value = { param: binding.param };
	else if (binding.source) {
		const source = expandSourceTemplate(binding.source, params);
		if (source) value = { source };
	}
	if (!value) return undefined;
	if (!binding.of) return { value };
	if (binding.of in params) return { value, of: { param: binding.of } };
	const of = expandSourceTemplate(binding.of, params);
	return of ? { value, of: { source: of } } : undefined;
}

/** Read a source or param value as a number: finite numbers, booleans (1/0), numeric strings. */
export function bindingNumber(value: unknown): number | undefined {
	if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (typeof value === 'string' && value.trim()) {
		const n = Number(value);
		return Number.isFinite(n) ? n : undefined;
	}
	return undefined;
}

/**
 * The binding's input number: the value, divided by `of` when the binding normalises. A missing
 * value ⇒ `undefined` (inert). A zero or missing divisor reads 0 — an empty pot with no maximum yet
 * is empty, never infinitely full.
 */
export function bindingInput(value: unknown, of?: unknown, normalises = false): number | undefined {
	const v = bindingNumber(value);
	if (v === undefined) return undefined;
	if (!normalises) return v;
	const d = bindingNumber(of);
	return d && d !== 0 ? v / d : 0;
}

/** The mapping curve, over `t` in 0..1 (a value past either end is passed through linearly). */
export function easeValue(ease: ValueBindingEase | undefined, t: number): number {
	if (t <= 0 || t >= 1) return t;
	switch (ease) {
		case 'easeIn':
			return t * t * t;
		case 'easeOut':
			return 1 - (1 - t) ** 3;
		case 'easeInOut':
			return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
		case 'backOut': {
			const c1 = 1.70158;
			const c3 = c1 + 1;
			return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
		}
		case 'steps':
			// Five even steps, for a level that should read as a stage rather than a slide.
			return Math.floor(t * 5) / 5;
		default:
			return t;
	}
}

/** The input range's progress for `input`, clamped unless the binding opts out. */
function progress(binding: ValueBinding, input: number): number {
	const inMin = binding.inMin ?? 0;
	const inMax = binding.inMax ?? 1;
	const t = inMax === inMin ? (input >= inMax ? 1 : 0) : (input - inMin) / (inMax - inMin);
	return binding.clamp === false ? t : Math.min(1, Math.max(0, t));
}

/**
 * A binding's output for an input number. Numeric targets map `inMin..inMax → outMin..outMax` along
 * the ease. `visible` returns 1 (shown) or 0 against its threshold — no mapping, no ease.
 * `frameCount` supplies a `frame` binding's default top (the last frame).
 */
export function evaluateBinding(binding: ValueBinding, input: number, frameCount?: number): number {
	if (binding.target === 'visible') {
		const above = input >= (binding.threshold ?? 1);
		return (binding.below ? !above : above) ? 1 : 0;
	}
	const [defMin, defMax] = defaultBindingOutRange(binding);
	const outMin = binding.outMin ?? defMin;
	const outMax =
		binding.outMax ?? defMax ?? (frameCount && frameCount > 0 ? frameCount - 1 : outMin);
	return outMin + (outMax - outMin) * easeValue(binding.ease, progress(binding, input));
}

/**
 * Where a smoothed output is after `elapsed` of a `duration`-second glide from `from` to `to` — an
 * ease-out, so a pot level arrives quickly and settles. `duration` ≤ 0 ⇒ already there.
 */
export function smoothedValue(from: number, to: number, elapsed: number, duration: number): number {
	if (!(duration > 0) || elapsed >= duration) return to;
	const t = Math.max(0, elapsed) / duration;
	return from + (to - from) * (1 - (1 - t) ** 3);
}

/**
 * Fold the transform-target outputs onto a resolved transform. `outputs[i]` belongs to
 * `bindings[i]`; `undefined` (no value yet) leaves that binding out, so a node waiting for its
 * source renders as authored. Several bindings on one target compose (offsets add, multipliers
 * multiply, every `visible` must pass). Returns `t` itself when nothing applies, so an unbound node
 * keeps its identity downstream.
 */
export function foldBoundTransform(
	t: ResolvedTransform,
	bindings: readonly ValueBinding[] | undefined,
	outputs: readonly (number | undefined)[],
): ResolvedTransform {
	if (!bindings?.length) return t;
	let dx = 0;
	let dy = 0;
	let sx = 1;
	let sy = 1;
	let rot = 0;
	let alpha = 1;
	let visible = true;
	let touched = false;
	bindings.forEach((binding, i) => {
		const out = outputs[i];
		if (out === undefined || !isTransformBindingTarget(binding.target)) return;
		touched = true;
		switch (binding.target) {
			case 'x':
				dx += out;
				break;
			case 'y':
				dy += out;
				break;
			case 'scale':
				sx *= out;
				sy *= out;
				break;
			case 'scaleX':
				sx *= out;
				break;
			case 'scaleY':
				sy *= out;
				break;
			case 'rotation':
				rot += (out * Math.PI) / 180;
				break;
			case 'alpha':
				alpha *= out;
				break;
			case 'visible':
				if (out < 0.5) visible = false;
				break;
		}
	});
	if (!touched) return t;
	const scale: Point2D | undefined =
		sx === 1 && sy === 1 ? t.scale : { x: (t.scale?.x ?? 1) * sx, y: (t.scale?.y ?? 1) * sy };
	return {
		...t,
		x: t.x + dx,
		y: t.y + dy,
		scale,
		rotation: rot === 0 ? t.rotation : (t.rotation ?? 0) + rot,
		alpha: alpha === 1 ? t.alpha : (t.alpha ?? 1) * alpha,
		visible: t.visible && visible,
	};
}

/**
 * The share a `fill` binding reveals (0..1), from its output — the last `fill` binding with a value
 * wins. `undefined` when the node carries no live fill (it then renders whole, unmasked).
 */
export function boundFillShare(
	bindings: readonly ValueBinding[] | undefined,
	outputs: readonly (number | undefined)[],
): { share: number; direction: NonNullable<ValueBinding['direction']> } | undefined {
	let found: { share: number; direction: NonNullable<ValueBinding['direction']> } | undefined;
	bindings?.forEach((binding, i) => {
		const out = outputs[i];
		if (binding.target !== 'fill' || out === undefined) return;
		found = { share: Math.min(1, Math.max(0, out)), direction: binding.direction ?? 'right' };
	});
	return found;
}

/**
 * The visible rect of a `fill` reveal, in the node's local (pre-rotation) space where the drawn art
 * spans `-anchor·size .. (1-anchor)·size`. `right` grows from the left edge, `left` from the right,
 * `up` from the bottom, `down` from the top.
 */
export function fillMaskRect(
	width: number,
	height: number,
	anchor: Point2D | undefined,
	share: number,
	direction: NonNullable<ValueBinding['direction']>,
): { x: number; y: number; width: number; height: number } {
	const left = -(anchor?.x ?? 0) * width;
	const top = -(anchor?.y ?? 0) * height;
	const s = Math.min(1, Math.max(0, share));
	switch (direction) {
		case 'left':
			return { x: left + width * (1 - s), y: top, width: width * s, height };
		case 'up':
			return { x: left, y: top + height * (1 - s), width, height: height * s };
		case 'down':
			return { x: left, y: top, width, height: height * s };
		default:
			return { x: left, y: top, width: width * s, height };
	}
}

/** The frame a `frame` binding holds: its output rounded and kept inside the clip. */
export function bindingFrameIndex(output: number, frameCount: number): number {
	if (!(frameCount > 0)) return 0;
	return Math.min(frameCount - 1, Math.max(0, Math.round(output)));
}

/** The last `frame` binding's output, or `undefined` when none has a value (the clip plays). */
export function boundFrameOutput(
	bindings: readonly ValueBinding[] | undefined,
	outputs: readonly (number | undefined)[],
): number | undefined {
	let found: number | undefined;
	bindings?.forEach((binding, i) => {
		if (binding.target === 'frame' && outputs[i] !== undefined) found = outputs[i];
	});
	return found;
}

/** A live `animTime` scrub: which animation, on which track, at what share of its length. */
export type BoundScrub = { animation: string; track: number; time: number };

/** Every `animTime` binding with an animation and a value, one per track (a later binding on the
 * same track wins — one track holds one animation). Track 0 is the resting animation's, so a binding
 * asking for it (or for none) scrubs on track 1. */
export function boundScrubs(
	bindings: readonly ValueBinding[] | undefined,
	outputs: readonly (number | undefined)[],
): BoundScrub[] {
	const byTrack = new Map<number, BoundScrub>();
	bindings?.forEach((binding, i) => {
		const time = outputs[i];
		if (binding.target !== 'animTime' || !binding.animation || time === undefined) return;
		const track = binding.track && binding.track > 0 ? Math.round(binding.track) : 1;
		byTrack.set(track, {
			animation: binding.animation,
			track,
			time: Math.min(1, Math.max(0, time)),
		});
	});
	return [...byTrack.values()];
}

/**
 * Every `bone` binding's output, combined per bone into one {@link SpineBoneOffset} — so two
 * bindings on one bone (its scale from the level, its rotation from the stage) pose it together.
 */
export function boundBoneOffsets(
	bindings: readonly ValueBinding[] | undefined,
	outputs: readonly (number | undefined)[],
): Map<string, SpineBoneOffset> {
	const map = new Map<string, SpineBoneOffset>();
	bindings?.forEach((binding, i) => {
		const out = outputs[i];
		if (binding.target !== 'bone' || !binding.bone || out === undefined) return;
		const offset = map.get(binding.bone) ?? {};
		switch (binding.boneProperty ?? 'scale') {
			case 'x':
				offset.x = (offset.x ?? 0) + out;
				break;
			case 'y':
				offset.y = (offset.y ?? 0) + out;
				break;
			case 'rotation':
				offset.rotation = (offset.rotation ?? 0) + out;
				break;
			case 'scale':
				offset.scaleX = (offset.scaleX ?? 1) * out;
				offset.scaleY = (offset.scaleY ?? 1) * out;
				break;
			case 'scaleX':
				offset.scaleX = (offset.scaleX ?? 1) * out;
				break;
			case 'scaleY':
				offset.scaleY = (offset.scaleY ?? 1) * out;
				break;
		}
		map.set(binding.bone, offset);
	});
	return map;
}

/** The bindings worth keeping: a known target and an input. The editor's save path and the runtime
 * both skip a half-authored one (no `param`/`source` yet, an `animTime` without an animation). */
export function isLiveBinding(binding: ValueBinding): boolean {
	if (!binding.param && !binding.source) return false;
	if (binding.target === 'animTime' && !binding.animation) return false;
	if (binding.target === 'bone' && !binding.bone) return false;
	return true;
}
