/**
 * The Element FX MOTION LIBRARY: the CPU twin of `glslLibrary.ts`. A shader graph's MOTION graph
 * (`docs/design/invisible-shader-graph.md` §8, step 8a) is compiled to a {@link MotionProgram}, a
 * flat list of the ops below, which the runtime interprets once a frame to move the element. No code
 * is ever evaluated: an op is a name looked up here, its operands registers or a literal.
 *
 * Each op computes, for floats, what its node's GLSL computes, in the same order and through the
 * same building blocks (the functions named `efx…` here are their `glslLibrary` namesakes), so a
 * node means the same thing in both graphs. `pnpm --filter fx-spike shader-motion` holds the two
 * together: it draws every motion node's GLSL headless and compares it with these. Dependency-free,
 * so the game's runtime, the launcher and the headless checks all run it.
 */

/** What a program reads of the frame: the play's time, the element's seed and size. */
export const MOTION_INPUTS = [
	'progress',
	'seconds',
	'intensity',
	'looping',
	'seed',
	'width',
	'height',
] as const;
export type MotionInput = (typeof MOTION_INPUTS)[number];

/** One frame of a play, as a program reads it. */
export interface MotionFrame {
	/** Progress through the current play, 0…1. */
	t: number;
	/** Seconds since the effect started playing (it keeps counting across repeats). */
	seconds: number;
	intensity: number;
	/** It repeats until stopped. */
	looping: boolean;
	/** Each param's value as its uniform holds it: a number, 0 / 1, a choice's index. */
	params: Readonly<Record<string, number>>;
	/** The random number, 0…97, drawn for the element (the pixel graph's Seed, when it reads one). */
	seed: number;
	/** The element's size in its own units. */
	width: number;
	height: number;
}

/**
 * One step of a program; its result is the register at its own index.
 * - `[input]` reads the frame ({@link MOTION_INPUTS});
 * - `['const', value]` is a number;
 * - `['param', id]` is one of the effect's params (a number, a switch, a choice);
 * - `[op, ...registers]` is a {@link MOTION_OPS} op on earlier registers.
 */
export type MotionOp =
	| readonly [MotionInput]
	| readonly ['const', number]
	| readonly ['param', string]
	| readonly [MotionOpName, ...number[]];

/** A compiled motion graph: its ops, and the register each driven output reads. */
export interface MotionProgram<Output extends string = string> {
	ops: readonly MotionOp[];
	outputs: Partial<Readonly<Record<Output, number>>>;
}

const PI = Math.PI;

const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);
const mix = (a: number, b: number, t: number): number => a * (1 - t) + b * t;
const smoothstep = (e0: number, e1: number, x: number): number => {
	const t = clamp((x - e0) / (e1 - e0), 0, 1);
	return t * t * (3 - 2 * t);
};
const step = (edge: number, x: number): number => (x < edge ? 0 : 1);
const fract = (x: number): number => x - Math.floor(x);

/** `glslLibrary`'s efxSinPi: sin(π x) to about 1e-7, by the same range reduction and series. */
export const efxSinPi = (x: number): number => {
	let r = x - 2 * Math.floor(0.5 * x + 0.5);
	r = r > 0.5 ? 1 - r : r < -0.5 ? -1 - r : r;
	const a = PI * r;
	const a2 = a * a;
	return (
		a * (1 + a2 * (-1 / 6 + a2 * (1 / 120 + a2 * (-1 / 5040 + a2 * (1 / 362880 - a2 / 39916800)))))
	);
};

/** `glslLibrary`'s efxHash1: a number hashed to 0…1. */
export const efxHash1 = (n: number): number => fract(Math.sin(n * 12.9898 + 78.233) * 43758.5453);

/** `glslLibrary`'s efxNoise1: smooth value noise along a line, 0…1. */
export const efxNoise1 = (x: number): number => {
	const i = Math.floor(x);
	let f = fract(x);
	f = f * f * (3 - 2 * f);
	return mix(efxHash1(i), efxHash1(i + 1), f);
};

/** `glslLibrary`'s efxEaseInOut: eased in and out (cubic), 0…1. */
export const efxEaseInOut = (x: number): number => {
	const t = clamp(x, 0, 1);
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(2 - 2 * t, 3) / 2;
};

/** `glslLibrary`'s efxEaseOutBack: past 1 by about overshoot / 10, settling at 1. */
export const efxEaseOutBack = (t: number, overshoot: number): number => {
	const k = clamp(t, 0, 1) - 1;
	return 1 + (overshoot + 1) * k * k * k + overshoot * k * k;
};

/** `glslLibrary`'s efxHold: in, held, out over t (the freeze, petrify and gold timing). */
export const efxHold = (t: number, hold: number): number => {
	const span = Math.max((1 - hold) * 0.5, 0.0001);
	if (t < span) {
		const k = t / span;
		return 1 - (1 - k) * (1 - k);
	}
	if (t <= 1 - span) return 1;
	return 1 - efxEaseInOut((t - (1 - span)) / span);
};

/** `glslLibrary`'s efxBand: 1 at `at`, falling smoothly to 0 by `width` either side. */
export const efxBand = (x: number, at: number, width: number): number =>
	1 - smoothstep(0, width, Math.abs(x - at));

/**
 * `glslLibrary`'s efxBounce: `count` hops (1…5), each 0.45 the height of the last, over the first
 * 85% of the play. [height (0…1 of the first hop's), how hard it is pressed into the ground].
 */
export const efxBounce = (t: number, count: number): [number, number] => {
	const n = clamp(Math.floor(count + 0.5), 1, 5);
	if (t >= 0.85) return [0, Math.sqrt(Math.pow(0.45, n - 1)) * (1 - smoothstep(0.85, 1, t))];
	let total = 0;
	for (let k = 0; k < n; k++) total += Math.sqrt(Math.pow(0.45, k));
	let at = (t / 0.85) * total;
	let last = 1;
	for (let k = 0; k < 5; k++) {
		const height = Math.pow(0.45, k);
		const width = Math.sqrt(height);
		if (at <= width || k >= n - 1) {
			const u = clamp(at / width, 0, 1);
			const landing = u > 0.88 ? (u - 0.88) / 0.12 : 0;
			const takeoff = k > 0 && u < 0.12 ? 1 - u / 0.12 : 0;
			return [height * 4 * u * (1 - u), landing * width + takeoff * Math.sqrt(last)];
		}
		at -= width;
		last = height;
	}
	return [0, 0];
};

type Fn = (...args: number[]) => number;

/**
 * The ops a program may call, each with its operand count. A node's name where it is one op (`add`
 * is the Add node); a node with two outputs is two (`bounceHeight`, `bounceSquash`).
 */
export const MOTION_OPS = {
	add: { arity: 2, fn: (a, b) => a + b },
	subtract: { arity: 2, fn: (a, b) => a - b },
	multiply: { arity: 2, fn: (a, b) => a * b },
	divide: { arity: 2, fn: (a, b) => a / b },
	min: { arity: 2, fn: (a, b) => Math.min(a, b) },
	max: { arity: 2, fn: (a, b) => Math.max(a, b) },
	mix: { arity: 3, fn: mix },
	clamp: { arity: 3, fn: clamp },
	smoothstep: { arity: 3, fn: smoothstep },
	step: { arity: 2, fn: step },
	pow: { arity: 2, fn: (x, p) => Math.pow(Math.max(x, 0), p) },
	abs: { arity: 1, fn: Math.abs },
	fract: { arity: 1, fn: fract },
	floor: { arity: 1, fn: Math.floor },
	sin: { arity: 1, fn: Math.sin },
	cos: { arity: 1, fn: Math.cos },
	oneMinus: { arity: 1, fn: (x) => 1 - x },
	negate: { arity: 1, fn: (x) => -x },
	remap: {
		arity: 5,
		fn: (x, inMin, inMax, outMin, outMax) =>
			mix(outMin, outMax, clamp((x - inMin) / (inMax - inMin), 0, 1)),
	},
	pick: {
		arity: 7,
		fn: (i, a, b, c, d, e, f) =>
			i < 0.5 ? a : i < 1.5 ? b : i < 2.5 ? c : i < 3.5 ? d : i < 4.5 ? e : f,
	},
	bell: { arity: 1, fn: (t) => Math.sin(PI * clamp(t, 0, 1)) },
	swell: { arity: 1, fn: (t) => 0.5 - 0.5 * Math.cos(2 * PI * t) },
	easeInOut: { arity: 1, fn: efxEaseInOut },
	easeOutBack: { arity: 2, fn: efxEaseOutBack },
	hold: { arity: 2, fn: efxHold },
	pulse: { arity: 2, fn: (t, rate) => 0.5 - 0.5 * Math.cos(2 * PI * rate * t) },
	flicker: {
		arity: 3,
		fn: (seconds, rate, chance) => step(1 - chance, efxHash1(Math.floor(seconds * rate))),
	},
	loopEnvelope: {
		arity: 2,
		fn: (t, looping) => (looping > 0.5 ? 1 : smoothstep(0, 0.15, t) * (1 - smoothstep(0.85, 1, t))),
	},
	bounceHeight: { arity: 2, fn: (t, count) => efxBounce(t, count)[0] },
	bounceSquash: { arity: 2, fn: (t, count) => efxBounce(t, count)[1] },
	oscillate: { arity: 3, fn: (t, rate, phase) => efxSinPi(2 * (rate * t + phase)) },
	hash1: { arity: 1, fn: efxHash1 },
	noise1: { arity: 3, fn: (x, scale, seed) => efxNoise1(x * scale + seed) },
	band: { arity: 3, fn: (x, at, width) => efxBand(x, at, Math.max(width, 0.0001)) },
} as const satisfies Readonly<Record<string, { arity: number; fn: Fn }>>;
export type MotionOpName = keyof typeof MOTION_OPS;

export const isMotionOpName = (name: unknown): name is MotionOpName =>
	typeof name === 'string' && Object.hasOwn(MOTION_OPS, name);

const readInput = (frame: MotionFrame, input: MotionInput): number => {
	switch (input) {
		case 'progress':
			return frame.t;
		case 'seconds':
			return frame.seconds;
		case 'intensity':
			return frame.intensity;
		case 'looping':
			return frame.looping ? 1 : 0;
		case 'seed':
			return frame.seed;
		case 'width':
			return frame.width;
		case 'height':
			return frame.height;
	}
};

/**
 * `program` at `frame`: each driven output's value, as the graph computes it (the runtime clamps it
 * to its channel). Pure, and cheap enough to run every frame or to plot a node over a play: one pass
 * over the ops. A result that is not a finite number (a division by 0) is 0, so nothing downstream
 * ever reads a NaN. `registers`, when given (at least one per op), is filled with every op's
 * result. Run only a program the registry has read (`readCustomElementFx`) or the compiler made.
 */
export function runMotionProgram<Output extends string>(
	program: MotionProgram<Output>,
	frame: MotionFrame,
	registers: Float64Array = new Float64Array(program.ops.length),
): Partial<Record<Output, number>> {
	const { ops } = program;
	for (let i = 0; i < ops.length; i++) {
		const op = ops[i];
		const name = op[0];
		let value: number;
		if (name === 'const') value = op[1] as number;
		else if (name === 'param') {
			const id = op[1] as string;
			const read = Object.hasOwn(frame.params, id) ? frame.params[id] : 0;
			value = typeof read === 'number' ? read : 0;
		} else if (op.length === 1) value = readInput(frame, name as MotionInput);
		else {
			const fn: Fn = MOTION_OPS[name as MotionOpName].fn;
			const a = op as readonly number[];
			// Every op has a fixed arity and none reads past it, so the unused operands are ignored.
			value = fn(
				registers[a[1]],
				registers[a[2]],
				registers[a[3]],
				registers[a[4]],
				registers[a[5]],
				registers[a[6]],
				registers[a[7]],
			);
		}
		registers[i] = Number.isFinite(value) ? value : 0;
	}
	const out: Partial<Record<Output, number>> = {};
	for (const key of Object.keys(program.outputs) as Output[]) {
		out[key] = registers[program.outputs[key] as number];
	}
	return out;
}
