/**
 * The page `shaderMotion.mjs` drives: every node the MOTION graph runs on the CPU, held to its own
 * GLSL drawn on WebGL1 or WebGL2 (`?gl=`). Invisible Shader Graph step 8a.
 *
 * For each motion node with a GLSL form, each output and each frame it reads:
 *  - the GPU side is a pixel graph: the node, its every input fed from a lattice of 64 × 32 samples
 *    worked out from the pixel's place, its output packed into the pixel's red, green and blue (24
 *    bits over the output's range), drawn through the real `ElementFxFilter`, read back;
 *  - the CPU side is a motion graph: the same node fed by params, compiled to a motion program
 *    (`compileShaderMotion`) and run (`runMotionProgram`) once per sample with the same inputs.
 * The lattice is built so every input is the same number on both sides: whole numbers times odd
 * multipliers, scaled by powers of two, so float32 holds them exactly. What differs is the node's own
 * arithmetic (float32 on the GPU, float64 here) and the GPU's sin, cos and pow, which the software
 * renderer gets about 1e-4 wrong: each node's tolerance says which it is.
 *
 * Three nodes hash through `efxHash1`, `fract(sin(n) × 43758.5)`, which turns any difference in sin
 * into a different number: no two GPUs agree on it either. For those the page compares what a hash
 * promises instead: every value within 0…1 on both sides, and the two spread alike (the script
 * bounds the gap between their means and between their shares below each tenth).
 */
import { Application, Container, Graphics, Rectangle, RenderTexture } from 'pixi.js';
import { elementFxParamUniform } from '@fxroot/packages/constants-shared/elementFx';
import {
	runMotionProgram,
	type MotionFrame,
} from '@fxroot/packages/constants-shared/motionLibrary';
import {
	DIMS,
	MOTION_NODES,
	compileShaderGraph,
	compileShaderMotion,
	graphBuilder,
	shaderNode,
	type GraphNode,
	type NodeDef,
	type ShaderGraphDoc,
} from '@fxroot/packages/engine-shadergraph/index';
import type { ElementFxParamSpec } from '@fxroot/packages/constants-shared/elementFx';
import { ElementFxFilter } from '@fxroot/packages/pixi-svelte/src/lib/elementFx/shaders';

const W = 64;
const H = 32;
const N = W * H;
/** Odd, so `s × m mod N` visits every sample once: each input walks its range in its own order. */
const MULTIPLIERS = [1, 1297, 541, 1931, 761, 1559, 383];

/** An input's range: `lo + span × u`, u = 0 … 1 − 1/2048, both powers of two or few bits wide. */
type Domain = readonly [lo: number, span: number];

const DOMAINS: Record<string, Record<string, Domain>> = {
	divide: { b: [0.25, 4] },
	pow: { x: [0.0625, 4], power: [-1, 4] },
	mix: { t: [-0.5, 2] },
	clamp: { min: [-2, 2], max: [0, 2] },
	smoothstep: { from: [-2, 2], to: [0.25, 2], x: [-3, 6] },
	remap: { x: [-3, 6], inMin: [-2, 2], inMax: [0.25, 2], outMin: [-2, 4], outMax: [-2, 4] },
	pick: { index: [-1, 8] },
	sin: { x: [-8, 16] },
	cos: { x: [-8, 16] },
	bell: { t: [-0.5, 2] },
	swell: { t: [-0.5, 2] },
	easeInOut: { t: [-0.5, 2] },
	easeOutBack: { t: [-0.5, 2], overshoot: [0, 4] },
	hold: { t: [0, 1], hold: [0, 0.9375] },
	pulse: { t: [-0.5, 2], rate: [0, 4] },
	flicker: { seconds: [0, 64], rate: [0, 64], chance: [0, 1] },
	loopEnvelope: { t: [-0.25, 1.5] },
	bounce: { t: [-0.25, 1.5], count: [0, 6] },
	oscillate: { t: [-1, 4], rate: [-4, 8], phase: [-1, 2] },
	hash1: { x: [-256, 512] },
	noise1: { x: [-64, 128], scale: [0, 16], seed: [0, 96] },
	band: { x: [-2, 4], at: [-2, 4], width: [0, 1] },
};
const DEFAULT_DOMAIN: Domain = [-4, 12];

/**
 * How far apart the two may be, beyond float32's rounding (the default): the nodes whose GPU form
 * calls GLSL's sin or cos (the software renderer's are about 1e-4 off), and Bounce, whose squash
 * climbs 8 times as fast as its input through the GPU's own pow and sqrt.
 */
const TOLERANCE: Record<string, number> = {
	sin: 4e-4,
	cos: 4e-4,
	bell: 4e-4,
	swell: 4e-4,
	pulse: 4e-4,
	bounce: 2e-5,
};
/** Nodes that hash through `efxHash1`: compared by what a hash promises, not value by value. */
const HASHED = new Set(['hash1', 'noise1', 'flicker']);

const PARAMS: ElementFxParamSpec[] = [
	{ id: 'n', label: 'N', kind: 'number', default: 0.375, min: -8, max: 8 },
	{ id: 'b', label: 'B', kind: 'bool', default: true },
	{ id: 'k', label: 'K', kind: 'choice', default: 'z', options: ['x', 'y', 'z'] },
];
/** What the play looks like: two frames, so a node reading time or looping is seen to follow it. */
const FRAMES = [
	{ t: 0.375, seconds: 1.75, intensity: 1.25, looping: false },
	{ t: 0.8125, seconds: 3.5, intensity: 0.5, looping: true },
];
const SEED = 41.5;
const TENTHS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

const lattice = (s: number, k: number, [lo, span]: Domain): number => {
	const x = (s * MULTIPLIERS[k]) / N;
	return lo + span * (x - Math.floor(x));
};

interface Case {
	label: string;
	def: NodeDef;
	port: string;
	/** Inputs fed from the lattice, in the node's order, with their ranges. */
	inputs: { id: string; domain: Domain }[];
	/** Inputs left unwired: each reads its default (or the value given). */
	unwired?: readonly string[];
	values?: GraphNode['values'];
	/** Where the first lattice input meets a degenerate range: 0 ÷ 0, left out of the comparison. */
	degenerate?: number;
	hashed: boolean;
	atol: number;
}

/**
 * More cases: inputs left unwired, so each reads its default in both graphs (Line noise's X reads the
 * play's progress in the motion graph, which the pixel graph is wired to match); Power below 0; and
 * the degenerate ranges, From = To and From min = From max, where both sides step. Their 0 ÷ 0 point
 * itself is left out and reported: GLSL leaves it undefined (the GPU's NaN reaches the packing), the
 * motion program reads 0 there.
 */
const EXTRA: {
	type: string;
	label: string;
	unwired?: readonly string[];
	domains?: Record<string, Domain>;
	values?: GraphNode['values'];
	degenerate?: number;
}[] = [
	{ type: 'bell', label: 'bell, t unwired', unwired: ['t'] },
	{ type: 'pulse', label: 'pulse, t unwired', unwired: ['t'] },
	{ type: 'hold', label: 'hold, Hold unwired', unwired: ['hold'] },
	{ type: 'oscillate', label: 'oscillate, rate and phase unwired', unwired: ['rate', 'phase'] },
	{
		type: 'remap',
		label: 'remap, ranges unwired',
		unwired: ['inMin', 'inMax', 'outMin', 'outMax'],
	},
	// With X or the seconds held, a wide seed or rate keeps enough hash cells for a hash's statistics.
	{ type: 'noise1', label: 'noise1, X unwired', unwired: ['x'], domains: { seed: [0, 4096] } },
	{
		type: 'flicker',
		label: 'flicker, seconds unwired',
		unwired: ['seconds'],
		domains: { rate: [0, 4096] },
	},
	{ type: 'pow', label: 'pow, X below 0', domains: { x: [-1, 4], power: [0.25, 4] } },
	{
		type: 'smoothstep',
		label: 'smoothstep, From = To',
		unwired: ['from', 'to'],
		values: { from: 0.5, to: 0.5 },
		domains: { x: [-2, 4] },
		degenerate: 0.5,
	},
	{
		type: 'remap',
		label: 'remap, From min = From max',
		unwired: ['inMin', 'inMax'],
		values: { inMin: 0.5, inMax: 0.5 },
		domains: { x: [-2, 4] },
		degenerate: 0.5,
	},
];

/** Every motion node that has GLSL, each output; a param node once for each kind it reads. */
const cases = (only: string[]): Case[] => [
	...MOTION_NODES.filter(
		(def) => shaderNode(def.type) && (!only.length || only.includes(def.type)),
	).flatMap((def) =>
		def.outputs.flatMap((output) => {
			const inputs = def.inputs.map((input) => ({
				id: input.id,
				domain: DOMAINS[def.type]?.[input.id] ?? DEFAULT_DOMAIN,
			}));
			const base = {
				def,
				port: output.id,
				inputs,
				hashed: HASHED.has(def.type),
				atol: TOLERANCE[def.type] ?? 2e-6,
			};
			if (def.type === 'param')
				return PARAMS.map((p) => ({ ...base, label: `param ${p.kind}`, values: { param: p.id } }));
			if (def.type === 'number') return [{ ...base, label: 'number', values: { value: 2.75 } }];
			return [{ ...base, label: `${def.type}.${output.id}` }];
		}),
	),
	...EXTRA.filter((x) => !only.length || only.includes(x.type)).map((x): Case => {
		const def = MOTION_NODES.find((d) => d.type === x.type) as NodeDef;
		return {
			label: x.label,
			def,
			port: def.outputs[0].id,
			inputs: def.inputs
				.filter((input) => !x.unwired?.includes(input.id))
				.map((input) => ({
					id: input.id,
					domain: x.domains?.[input.id] ?? DOMAINS[def.type]?.[input.id] ?? DEFAULT_DOMAIN,
				})),
			unwired: x.unwired ?? [],
			values: x.values,
			degenerate: x.degenerate,
			hashed: HASHED.has(def.type),
			atol: TOLERANCE[def.type] ?? 2e-6,
		};
	}),
];

/** The pixel graph: the lattice into the node, its output packed into red, green and blue. */
function gpuDoc(c: Case, lo: number, hi: number): ShaderGraphDoc {
	const g = graphBuilder({
		id: 'motion-gate',
		name: 'Motion gate',
		phase: 'loop',
		durationMs: 1000,
		params: PARAMS,
	});
	const op = (type: string, values?: GraphNode['values']) => g.node(type, values);
	const at = op('multiply');
	g.wire(op('uv'), 'out', at, 'a');
	g.wire(op('size'), 'out', at, 'b');
	const cell = op('floor');
	g.wire(at, 'out', cell, 'x');
	const split = op('split');
	g.wire(cell, 'out', split, 'v');
	const row = op('multiply', { b: W });
	g.wire(split, 'y', row, 'a');
	const sample = op('add');
	g.wire(split, 'x', sample, 'a');
	g.wire(row, 'out', sample, 'b');
	const node = op(c.def.type, c.values);
	// An unwired input whose motion default is the play's time, where the pixel graph's is not:
	// wired to the time here, so both read the same.
	for (const id of c.unwired ?? []) {
		const read = c.def.inputs.find((p) => p.id === id)?.defaultExpr;
		const pixel = shaderNode(c.def.type)?.inputs.find((p) => p.id === id)?.defaultExpr;
		if (
			(read === 'progress' || read === 'seconds') &&
			read !== pixel &&
			c.values?.[id] === undefined
		)
			g.wire(op('time'), read, node, id);
	}
	c.inputs.forEach(({ id, domain: [low, span] }, k) => {
		const times = op('multiply', { b: MULTIPLIERS[k] / N });
		g.wire(sample, 'out', times, 'a');
		const u = op('fract');
		g.wire(times, 'out', u, 'x');
		const scaled = op('multiply', { b: span });
		g.wire(u, 'out', scaled, 'a');
		const value = op('add', { b: low });
		g.wire(scaled, 'out', value, 'a');
		g.wire(value, 'out', node, id);
	});
	const n = op('remap', { inMin: lo, inMax: hi });
	g.wire(node, c.port, n, 'x');
	const e1 = op('multiply', { b: 255 });
	g.wire(n, 'out', e1, 'a');
	const r = op('floor');
	g.wire(e1, 'out', r, 'x');
	const f1 = op('fract');
	g.wire(e1, 'out', f1, 'x');
	const e2 = op('multiply', { b: 255 });
	g.wire(f1, 'out', e2, 'a');
	const gg = op('floor');
	g.wire(e2, 'out', gg, 'x');
	const b = op('fract');
	g.wire(e2, 'out', b, 'x');
	const red = op('divide', { b: 255 });
	g.wire(r, 'out', red, 'a');
	const green = op('divide', { b: 255 });
	g.wire(gg, 'out', green, 'a');
	const color = op('combine', { w: 1 });
	g.wire(red, 'out', color, 'x');
	g.wire(green, 'out', color, 'y');
	g.wire(b, 'out', color, 'z');
	g.wire(color, 'xyzw', op('output'), 'color');
	return g.doc();
}

/** The motion graph: the node fed by params (one per input), into the Motion Output's X. */
function cpuDoc(c: Case): ShaderGraphDoc {
	const inputs: ElementFxParamSpec[] = c.inputs.map(({ id }) => ({
		id: `in_${id}`,
		label: id,
		kind: 'number',
		default: 0,
		min: -1e9,
		max: 1e9,
	}));
	const doc: ShaderGraphDoc = {
		...graphBuilder({
			id: 'motion-gate',
			name: 'Motion gate',
			phase: 'loop',
			durationMs: 1000,
		}).doc(),
		params: [...PARAMS, ...inputs],
		motionGraph: {
			nodes: [
				{ id: 'node', type: c.def.type, x: 0, y: 0, ...(c.values ? { values: c.values } : {}) },
				{ id: 'out', type: 'motionOutput', x: 0, y: 0 },
				...c.inputs.map(({ id }) => ({
					id: `p_${id}`,
					type: 'param',
					x: 0,
					y: 0,
					values: { param: `in_${id}` },
				})),
			],
			wires: [
				{ from: { node: 'node', port: c.port }, to: { node: 'out', port: 'x' } },
				...c.inputs.map(({ id }) => ({
					from: { node: `p_${id}`, port: 'out' },
					to: { node: 'node', port: id },
				})),
			],
		},
	};
	return doc;
}

const paramValues = (): Record<string, number> =>
	Object.fromEntries(PARAMS.map((p) => [p.id, elementFxParamUniform(p, p.default)[0]]));

(async () => {
	const query = new URLSearchParams(location.search);
	const only = (query.get('nodes') ?? '').split(',').filter(Boolean);
	const app = new Application();
	await app.init({
		width: W,
		height: H,
		preference: 'webgl',
		preferWebGLVersion: query.get('gl') === '1' ? 1 : 2,
		antialias: false,
		autoStart: false,
		sharedTicker: false,
		resolution: 1,
	});
	const renderer = app.renderer;
	const gl = (renderer as unknown as { gl?: WebGLRenderingContext }).gl;
	gl?.disable(gl.DITHER);
	const card = new Container();
	card.addChild(new Graphics().rect(0, 0, W, H).fill(0x808080));
	card.filterArea = new Rectangle(0, 0, W, H);
	const target = RenderTexture.create({ width: W, height: H });
	const read = (): Uint8ClampedArray =>
		(
			renderer as unknown as {
				texture: { getPixels(t: RenderTexture): { pixels: Uint8ClampedArray } };
			}
		).texture.getPixels(target).pixels;
	/** `c` run here and drawn on the GPU at each frame: its values, and a reader of the GPU's. */
	const measure = (c: Case) => {
		const motion = compileShaderMotion(cpuDoc(c));
		if (!motion.ok || !motion.program)
			throw new Error(`${c.label}: ${motion.ok ? 'no program' : motion.issues[0]?.message}`);
		const program = motion.program;
		const frames = FRAMES.map((f) => {
			const js = new Float64Array(N);
			for (let s = 0; s < N; s++) {
				const params = paramValues();
				c.inputs.forEach(({ id, domain }, k) => (params[`in_${id}`] = lattice(s, k, domain)));
				const frame: MotionFrame = { ...f, params, seed: SEED, width: W, height: H };
				js[s] = runMotionProgram(program, frame).x as number;
			}
			return { frame: f, js };
		});
		let lo = Math.min(...frames.flatMap((f) => [...f.js]));
		let hi = Math.max(...frames.flatMap((f) => [...f.js]));
		const margin = Math.max(0.01 * (hi - lo), 1e-3);
		// As float32 holds them, so the GPU unpacks against the same ends the page does.
		[lo, hi] = [Math.fround(lo - margin), Math.fround(hi + margin)];
		const compiled = compileShaderGraph(gpuDoc(c, lo, hi));
		if (!compiled.ok) throw new Error(`${c.label}: ${compiled.issues[0]?.message}`);
		const { shader } = compiled;
		const filter = new ElementFxFilter(
			`motion-gate-${c.label.replace(/\W/g, '-')}`,
			shader.body,
			Object.fromEntries(
				shader.uniforms.map((u) => [
					u.name,
					u.type === 'float'
						? { value: 0, type: 'f32' }
						: { value: new Float32Array(DIMS[u.type]), type: `${u.type}<f32>` },
				]),
			),
		);
		card.filters = [filter];
		const drawn = frames.map(({ frame, js }) => {
			filter.set('uFx', frame.t, frame.seconds, frame.intensity, frame.looping ? 1 : 0);
			for (const u of shader.uniforms) {
				if (u.source.kind === 'seed') filter.set(u.name, SEED);
				if (u.source.kind !== 'param') continue;
				const id = u.source.id;
				const spec = PARAMS.find((p) => p.id === id);
				if (spec) filter.set(u.name, ...elementFxParamUniform(spec, spec.default));
			}
			renderer.render({ container: card, target, clear: true });
			const pixels = read();
			const gpuAt = (s: number, flip: boolean): number => {
				const col = s % W;
				const row = Math.floor(s / W);
				const i = 4 * ((flip ? H - 1 - row : row) * W + col);
				const n = (pixels[i] + (pixels[i + 1] + pixels[i + 2] / 255) / 255) / 255;
				return lo + n * (hi - lo);
			};
			return { frame, js, gpuAt };
		});
		filter.destroy();
		return { lo, hi, drawn };
	};

	// Which way up the texture reads back: the way the lattice's own sample numbers come out.
	const probe = measure({
		label: 'probe',
		def: MOTION_NODES.find((def) => def.type === 'add') as NodeDef,
		port: 'out',
		inputs: [{ id: 'a', domain: [0, N] }],
		hashed: false,
		atol: 0,
	}).drawn[0];
	const misread = (flip: boolean) =>
		Array.from({ length: N }, (_, s) => Math.abs(probe.gpuAt(s, flip) - s)).filter((d) => d > 0.01)
			.length;
	const flipped = misread(true) < misread(false);
	if (misread(flipped))
		throw new Error(`the lattice reads back wrong at ${misread(flipped)} samples`);

	const report = console.error.bind(console);
	const results = [];
	const began = performance.now();
	for (const c of cases(only)) {
		console.error = (...args: unknown[]) => report(`${c.label}:`, ...args);
		const { lo, hi, drawn } = measure(c);
		const outcomes = drawn.map(({ frame, js, gpuAt }) => {
			const gpu = Array.from({ length: N }, (_, s) => gpuAt(s, flipped));
			const tol = (v: number) => c.atol + 4e-7 * (hi - lo) + 4e-6 * Math.abs(v);
			let worst = { s: 0, off: 0, gpu: 0, js: 0 };
			let failures = 0;
			// The 0 ÷ 0 point of a degenerate range: what each side gives there, not compared.
			const atEdge = (s: number): boolean =>
				c.degenerate !== undefined && lattice(s, 0, c.inputs[0].domain) === c.degenerate;
			const edge = Array.from({ length: N }, (_, s) => s)
				.filter(atEdge)
				.map((s) => ({ gpu: gpu[s], js: js[s] }));
			for (let s = 0; s < N; s++) {
				if (atEdge(s)) continue;
				const off = Math.abs(gpu[s] - js[s]);
				if (off / tol(js[s]) > worst.off / tol(worst.js))
					worst = { s, off, gpu: gpu[s], js: js[s] };
				if (off > tol(js[s])) failures++;
			}
			const mean = (v: ArrayLike<number>) => Array.from(v).reduce((a, b) => a + b, 0) / N;
			const below = (v: ArrayLike<number>, q: number) =>
				Array.from(v).filter((x) => x < q).length / N;
			const inUnit = (v: ArrayLike<number>) =>
				Array.from(v).every((x) => x >= -1e-6 && x <= 1 + 1e-6);
			return {
				frame,
				worst: {
					...worst,
					tol: tol(worst.js),
					inputs: c.inputs.map(({ domain }, k) => lattice(worst.s, k, domain)),
				},
				failures,
				...(c.degenerate !== undefined ? { edge } : {}),
				hashed: c.hashed
					? {
							meanGpu: mean(gpu),
							meanJs: mean(js),
							inUnit: inUnit(gpu) && inUnit(js),
							spread: Math.max(...TENTHS.map((q) => Math.abs(below(gpu, q) - below(js, q)))),
						}
					: undefined,
			};
		});
		results.push({ label: c.label, hashed: c.hashed, range: [lo, hi], outcomes });
	}
	console.error = report;
	const page = window as unknown as { result: unknown; ready: boolean };
	page.result = {
		samples: N,
		flipped,
		ms: Math.round(performance.now() - began),
		nodes: MOTION_NODES.filter((def) => shaderNode(def.type)).map((def) => def.type),
		cases: results,
	};
	page.ready = true;
})().catch((error: unknown) => {
	console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
