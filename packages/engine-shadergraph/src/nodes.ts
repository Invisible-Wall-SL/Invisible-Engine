/**
 * The NODE LIBRARY: what an artist can wire, read off the built-in Element FX passes. Each node's
 * GLSL calls the shared building blocks of `constants-shared/glslLibrary`, so a node and the
 * built-in it was read from are one implementation.
 *
 * A node emits one GLSL expression per output from its inputs' expressions; the compiler names
 * them, orders them and links the building blocks. Nothing an author types reaches the GLSL: inputs
 * left unwired become numeric literals, a choice becomes its index, a param its uniform.
 */

import { EFX_SIDES } from 'constants-shared/glslLibrary';
import type { ElementFxParamSpec } from 'constants-shared/elementFx';
import type { MotionInput, MotionOpName } from 'constants-shared/motionLibrary';
import type { PortType } from './types';

/** `any` follows the node's widest wired input, so `add` adds floats or vectors alike. */
export type PortTypeSpec = PortType | 'any';

/** What an unwired input reads when the author gave it no value. */
export type DefaultExpr = 'uv' | 'uvSquare' | 'progress' | 'seconds' | 'sample';

export interface PortDef {
	id: string;
	label: string;
	type: PortTypeSpec;
	default?: number | readonly number[];
	defaultExpr?: DefaultExpr;
}

export type SettingDef =
	| { id: string; label: string; kind: 'choice'; options: readonly string[]; default: string }
	| { id: string; label: string; kind: 'param' }
	| { id: string; label: string; kind: 'number'; default: number }
	| { id: string; label: string; kind: 'color'; default: string };

/**
 * `subgraph`: a call to one of the effect's subgraphs, and a body's Input and Output (`subgraph.ts`).
 * `code`: a Custom GLSL node (`customGlsl.ts`).
 */
export type NodeCategory =
	| 'input'
	| 'math'
	| 'time'
	| 'procedural'
	| 'mask'
	| 'uv'
	| 'color'
	| 'output'
	| 'subgraph'
	| 'code';

export interface EmitContext {
	/** Each input as a GLSL expression of its port's type. */
	in: Record<string, string>;
	/** The node's resolved type for its `any` ports. */
	type: PortType;
	/** `expr` as the node's type: a float spread over a vector, as `vec3(x)`. */
	splat(expr: string): string;
	/** A setting as GLSL: a choice's index, a param's uniform, a number or a colour literal. */
	setting(id: string): string;
	/** Declare `expr` as a local of `type` and return its name, for an output read twice. */
	local(type: PortType, expr: string): string;
}

/**
 * What a node appends to a motion program (`constants-shared/motionLibrary`), each step returning
 * the register that holds its result.
 */
export interface MotionEmitContext {
	/** Each input as a register. */
	in: Record<string, number>;
	/** The inputs as registers, in the node's order. */
	args: number[];
	/** A setting as a register: a number setting's value, a param's. */
	setting(id: string): number;
	op(name: MotionOpName, ...args: number[]): number;
	read(input: MotionInput): number;
}

/** How a node runs in the motion graph, on the CPU each frame: a register per output. */
export interface NodeMotion {
	emit(ctx: MotionEmitContext): Record<string, number>;
	/** What an input left unwired reads there, where the pixel graph's default is per pixel. */
	defaults?: Readonly<Record<string, 'progress' | 'seconds'>>;
}

export interface NodeDef {
	type: string;
	label: string;
	category: NodeCategory;
	description: string;
	inputs: readonly PortDef[];
	outputs: readonly PortDef[];
	settings?: readonly SettingDef[];
	/** Rough arithmetic per pixel; the editor sums it against a mobile budget. */
	cost: number;
	/** Reads of the element per pixel. */
	samples?: number;
	/** Output types that depend on the doc (a param node's kind). */
	outputTypes?(param: ElementFxParamSpec | undefined): Record<string, PortType>;
	emit(ctx: EmitContext): Record<string, string>;
	/**
	 * The node in the motion graph: the library ops computing, for floats, what `emit`'s GLSL does.
	 * Absent: it works per pixel only.
	 */
	motion?: NodeMotion;
}

const port = (
	id: string,
	label: string,
	type: PortTypeSpec,
	more: Partial<Pick<PortDef, 'default' | 'defaultExpr'>> = {},
): PortDef => ({ id, label, type, ...more });
const f = (id: string, label: string, value?: number): PortDef =>
	port(id, label, 'float', value === undefined ? {} : { default: value });
const any = (id: string, label: string, value: number): PortDef =>
	port(id, label, 'any', { default: value });
const uvIn = (id = 'uv', label = 'UV'): PortDef => port(id, label, 'vec2', { defaultExpr: 'uv' });
const progressIn = (id = 't', label = 'Progress'): PortDef =>
	port(id, label, 'float', { defaultExpr: 'progress' });
const sampleIn = (id = 'color', label = 'Colour'): PortDef =>
	port(id, label, 'vec4', { defaultExpr: 'sample' });

/** A node with one output, `out`, of the given type. */
const one = (
	type: string,
	label: string,
	category: NodeCategory,
	description: string,
	inputs: readonly PortDef[],
	outType: PortTypeSpec,
	cost: number,
	emit: (ctx: EmitContext) => string,
	more: Partial<NodeDef> = {},
): NodeDef => ({
	type,
	label,
	category,
	description,
	inputs,
	outputs: [port('out', 'Out', outType)],
	cost,
	emit: (ctx) => ({ out: emit(ctx) }),
	...more,
});

/** In the motion graph, `out` is library op `name` on the node's inputs in order. */
const cpu = (name: MotionOpName): NodeMotion => ({
	emit: (c) => ({ out: c.op(name, ...c.args) }),
});

/** A node `out = fn(in…)` on any type; in the motion graph, the op of its name. */
const unary = (
	type: MotionOpName,
	label: string,
	description: string,
	glsl: (x: string) => string,
) =>
	one(type, label, 'math', description, [any('x', 'X', 0)], 'any', 1, (c) => glsl(c.in.x), {
		motion: cpu(type),
	});
const binary = (
	type: MotionOpName,
	label: string,
	description: string,
	glsl: (a: string, b: string) => string,
	b = 0,
) =>
	one(
		type,
		label,
		'math',
		description,
		[any('a', 'A', 0), any('b', 'B', b)],
		'any',
		1,
		(c) => glsl(c.in.a, c.in.b),
		{ motion: cpu(type) },
	);

/** The uniform type a param of each kind is read through. */
export const PARAM_TYPE: Record<ElementFxParamSpec['kind'], PortType> = {
	number: 'float',
	color: 'vec3',
	bool: 'float',
	choice: 'float',
};

export const SHADER_NODES: readonly NodeDef[] = [
	// --- input: where the pixel is, when it is, and what the element looks like there ---
	one(
		'uv',
		'UV',
		'input',
		'Where this pixel is on the element: 0…1 across and down.',
		[],
		'vec2',
		0,
		() => 'uv',
	),
	one(
		'uvSquare',
		'UV (square)',
		'input',
		'UV scaled so a unit is the same length both ways: noise and cells stay round on a tall element.',
		[],
		'vec2',
		2,
		() => 'uvSquare',
	),
	one(
		'size',
		'Element size',
		'input',
		'The element’s size on screen, in pixels.',
		[],
		'vec2',
		0,
		() => 'efxSize()',
	),
	{
		type: 'time',
		label: 'Time',
		category: 'input',
		description:
			'Progress through the play (0…1), seconds since it started, the entry’s strength, and 1 while it loops.',
		inputs: [],
		outputs: [
			port('progress', 'Progress', 'float'),
			port('seconds', 'Seconds', 'float'),
			port('intensity', 'Strength', 'float'),
			port('looping', 'Looping', 'float'),
		],
		cost: 0,
		emit: () => ({ progress: 'uFx.x', seconds: 'uFx.y', intensity: 'uFx.z', looping: 'uFx.w' }),
		motion: {
			emit: (c) => ({
				progress: c.read('progress'),
				seconds: c.read('seconds'),
				intensity: c.read('intensity'),
				looping: c.read('looping'),
			}),
		},
	},
	{
		type: 'param',
		label: 'Param',
		category: 'input',
		description:
			'One of the effect’s params: a number, a colour, a switch (0 or 1) or a choice (its index).',
		inputs: [],
		outputs: [port('out', 'Value', 'float')],
		settings: [{ id: 'param', label: 'Param', kind: 'param' }],
		cost: 0,
		outputTypes: (param) => ({ out: param ? PARAM_TYPE[param.kind] : 'float' }),
		emit: (c) => ({ out: c.setting('param') }),
		motion: { emit: (c) => ({ out: c.setting('param') }) },
	},
	{
		type: 'number',
		label: 'Number',
		category: 'input',
		description: 'A fixed number.',
		inputs: [],
		outputs: [port('out', 'Value', 'float')],
		settings: [{ id: 'value', label: 'Value', kind: 'number', default: 1 }],
		cost: 0,
		emit: (c) => ({ out: c.setting('value') }),
		motion: { emit: (c) => ({ out: c.setting('value') }) },
	},
	{
		type: 'color',
		label: 'Colour',
		category: 'input',
		description: 'A fixed colour.',
		inputs: [],
		outputs: [port('out', 'Colour', 'vec3')],
		settings: [{ id: 'value', label: 'Colour', kind: 'color', default: '#ffffff' }],
		cost: 0,
		emit: (c) => ({ out: c.setting('value') }),
	},
	one(
		'sample',
		'Sample element',
		'input',
		'The element’s colour (premultiplied) at a UV. Unwired, at this pixel.',
		[uvIn()],
		'vec4',
		2,
		(c) => `efxSample(efxFromUnit(${c.in.uv}))`,
		{ samples: 1 },
	),
	one(
		'outline',
		'Outline',
		'input',
		'How much this pixel is on the element’s outline (0…1), the edge read this many pixels wide.',
		[f('width', 'Width (px)', 1.5)],
		'float',
		6,
		(c) => `clamp(efxEdge(px, efxSample(px).a, ${c.in.width}), 0.0, 1.0)`,
		{ samples: 5 },
	),
	one(
		'height',
		'Relief height',
		'input',
		'The element as a relief at a UV: its outline, raised where the art is light.',
		[uvIn()],
		'float',
		3,
		(c) => `efxHeight(efxFromUnit(${c.in.uv}))`,
		{ samples: 1 },
	),
	one(
		'seed',
		'Seed',
		'input',
		'A random number, 0…97, drawn for each element the effect plays on: feed it to noise or cells so two elements playing the effect at once differ (the built-ins seed theirs so).',
		[],
		'float',
		0,
		() => 'uSeed',
		{ motion: { emit: (c) => ({ out: c.read('seed') }) } },
	),
	{
		type: 'particle',
		label: 'Particle',
		category: 'input',
		description:
			'The particle drawing the effect as its material: its colour (its tint × alpha, premultiplied), its place in its spawn wave (0…1 across a burst) and its spawn order (0…1, wrapping at Max particles). Read its colour and the graph owns it: the particle is not tinted or faded after. On an element: white, 0 and 0.',
		inputs: [],
		outputs: [
			port('color', 'Colour', 'vec4'),
			port('wave', 'Wave index', 'float'),
			port('order', 'Spawn order', 'float'),
		],
		cost: 0,
		emit: () => ({
			color: 'efxParticleColor()',
			wave: 'efxParticleWave()',
			order: 'efxParticleOrder()',
		}),
	},
	{
		type: 'screens',
		label: 'Screens',
		category: 'input',
		description:
			'The two screens of a screen transition at a UV (unwired, at this pixel): From is the old screen, frozen when the transition started, and To the new one, live (both premultiplied). Reverse is 1 when the transition plays reversed, else 0, so a graph can mirror itself. A graph reading it draws both screens itself. On an element both screens are the element, on a particle the particle, and Reverse is 0.',
		inputs: [uvIn()],
		outputs: [
			port('from', 'From', 'vec4'),
			port('to', 'To', 'vec4'),
			port('reverse', 'Reverse', 'float'),
		],
		cost: 4,
		samples: 2,
		emit: (c) => ({
			from: `efxScreenFrom(efxFromUnit(${c.in.uv}))`,
			to: `efxScreenTo(efxFromUnit(${c.in.uv}))`,
			reverse: 'efxScreenReverse()',
		}),
	},

	// --- math: on numbers or vectors alike ---
	binary('add', 'Add', 'A + B.', (a, b) => `(${a} + ${b})`),
	binary('subtract', 'Subtract', 'A − B.', (a, b) => `(${a} - ${b})`),
	binary('multiply', 'Multiply', 'A × B.', (a, b) => `(${a} * ${b})`, 1),
	binary('divide', 'Divide', 'A ÷ B.', (a, b) => `(${a} / ${b})`, 1),
	binary('min', 'Min', 'The smaller of A and B.', (a, b) => `min(${a}, ${b})`),
	binary('max', 'Max', 'The larger of A and B.', (a, b) => `max(${a}, ${b})`),
	one(
		'mix',
		'Mix',
		'math',
		'From A to B as T goes from 0 to 1.',
		[any('a', 'A', 0), any('b', 'B', 1), f('t', 'T', 0.5)],
		'any',
		2,
		(c) => `mix(${c.in.a}, ${c.in.b}, ${c.in.t})`,
		{ motion: cpu('mix') },
	),
	one(
		'clamp',
		'Clamp',
		'math',
		'X kept between Min and Max.',
		[any('x', 'X', 0), f('min', 'Min', 0), f('max', 'Max', 1)],
		'any',
		1,
		(c) => `clamp(${c.in.x}, ${c.in.min}, ${c.in.max})`,
		{ motion: cpu('clamp') },
	),
	one(
		'smoothstep',
		'Smooth step',
		'math',
		'0 below From, 1 above To, a smooth S between.',
		[f('from', 'From', 0), f('to', 'To', 1), any('x', 'X', 0.5)],
		'any',
		3,
		(c) => `smoothstep(${c.in.from}, ${c.in.to}, ${c.in.x})`,
		{ motion: cpu('smoothstep') },
	),
	one(
		'step',
		'Step',
		'math',
		'0 below Edge, 1 from it on.',
		[f('edge', 'Edge', 0.5), any('x', 'X', 0)],
		'any',
		1,
		(c) => `step(${c.in.edge}, ${c.in.x})`,
		{ motion: cpu('step') },
	),
	one(
		'pow',
		'Power',
		'math',
		'X to the power (negative X read as 0).',
		[any('x', 'X', 0), f('power', 'Power', 2)],
		'any',
		3,
		(c) => `pow(max(${c.in.x}, 0.0), ${c.splat(c.in.power)})`,
		{ motion: cpu('pow') },
	),
	unary('abs', 'Absolute', 'X without its sign.', (x) => `abs(${x})`),
	unary('fract', 'Fraction', 'The part of X after the point.', (x) => `fract(${x})`),
	unary('floor', 'Floor', 'X rounded down.', (x) => `floor(${x})`),
	unary('sin', 'Sine', 'sin(X), X in radians.', (x) => `sin(${x})`),
	unary('cos', 'Cosine', 'cos(X), X in radians.', (x) => `cos(${x})`),
	unary('oneMinus', 'One minus', '1 − X.', (x) => `(1.0 - ${x})`),
	unary('negate', 'Negate', '−X.', (x) => `(-${x})`),
	one(
		'remap',
		'Remap',
		'math',
		'X from one range to another, clamped.',
		[
			any('x', 'X', 0),
			f('inMin', 'From min', 0),
			f('inMax', 'From max', 1),
			f('outMin', 'To min', 0),
			f('outMax', 'To max', 1),
		],
		'any',
		4,
		(c) =>
			`mix(${c.splat(c.in.outMin)}, ${c.splat(c.in.outMax)}, clamp((${c.in.x} - ${c.in.inMin}) / (${c.in.inMax} - ${c.in.inMin}), 0.0, 1.0))`,
		{ motion: cpu('remap') },
	),
	one(
		'length',
		'Length',
		'math',
		'How long a vector is.',
		[any('v', 'V', 0)],
		'float',
		2,
		(c) => `length(${c.in.v})`,
	),
	one(
		'distance',
		'Distance',
		'math',
		'How far apart A and B are.',
		[any('a', 'A', 0), any('b', 'B', 0)],
		'float',
		2,
		(c) => `distance(${c.in.a}, ${c.in.b})`,
	),
	one(
		'dot',
		'Dot',
		'math',
		'A · B.',
		[any('a', 'A', 0), any('b', 'B', 0)],
		'float',
		2,
		(c) => `dot(${c.in.a}, ${c.in.b})`,
	),
	one(
		'normalize',
		'Normalize',
		'math',
		'V made 1 long.',
		[any('v', 'V', 1)],
		'any',
		2,
		(c) => `normalize(${c.in.v})`,
	),
	{
		type: 'split',
		label: 'Split',
		category: 'math',
		description: 'A vector’s parts (a part it does not have reads 0).',
		inputs: [any('v', 'V', 0)],
		outputs: ['x', 'y', 'z', 'w'].map((id) => port(id, id.toUpperCase(), 'float')),
		cost: 0,
		emit: (c) => {
			const dims = DIMS[c.type];
			const v = dims > 1 ? c.local(c.type, c.in.v) : c.in.v;
			const part = (i: number, name: string): string =>
				i >= dims ? '0.0' : dims === 1 ? v : `${v}.${name}`;
			return { x: part(0, 'x'), y: part(1, 'y'), z: part(2, 'z'), w: part(3, 'w') };
		},
	},
	{
		type: 'combine',
		label: 'Combine',
		category: 'math',
		description: 'Numbers into a vector.',
		inputs: [f('x', 'X', 0), f('y', 'Y', 0), f('z', 'Z', 0), f('w', 'W', 1)],
		outputs: [port('xy', 'XY', 'vec2'), port('xyz', 'XYZ', 'vec3'), port('xyzw', 'XYZW', 'vec4')],
		cost: 0,
		emit: ({ in: i }) => ({
			xy: `vec2(${i.x}, ${i.y})`,
			xyz: `vec3(${i.x}, ${i.y}, ${i.z})`,
			xyzw: `vec4(${i.x}, ${i.y}, ${i.z}, ${i.w})`,
		}),
	},
	one(
		'pick',
		'Pick',
		'math',
		'One of six values by Index, rounded (0 picks A, 5 or more F): turns a choice param, which reads as its option’s place in the list, into the numbers each option means.',
		[
			f('index', 'Index', 0),
			any('a', 'A', 0),
			any('b', 'B', 1),
			any('c', 'C', 2),
			any('d', 'D', 3),
			any('e', 'E', 4),
			any('f', 'F', 5),
		],
		'any',
		3,
		(c) => {
			const i = c.local('float', c.in.index);
			const { a, b, d, e } = c.in;
			return `(${i} < 0.5 ? ${a} : ${i} < 1.5 ? ${b} : ${i} < 2.5 ? ${c.in.c} : ${i} < 3.5 ? ${d} : ${i} < 4.5 ? ${e} : ${c.in.f})`;
		},
		{ motion: cpu('pick') },
	),

	// --- time: shaping the play's progress ---
	one(
		'bell',
		'Bell',
		'time',
		'0 at both ends, 1 in the middle.',
		[progressIn()],
		'float',
		2,
		(c) => `sin(PI * clamp(${c.in.t}, 0.0, 1.0))`,
		{ motion: cpu('bell') },
	),
	one(
		'swell',
		'Swell',
		'time',
		'Up and back with no kink at the ends, so it repeats smoothly.',
		[progressIn()],
		'float',
		2,
		(c) => `(0.5 - 0.5 * cos(2.0 * PI * ${c.in.t}))`,
		{ motion: cpu('swell') },
	),
	one(
		'easeInOut',
		'Ease in-out',
		'time',
		'Slow, fast, slow.',
		[progressIn()],
		'float',
		3,
		(c) => `efxEaseInOut(${c.in.t})`,
		{ motion: cpu('easeInOut') },
	),
	one(
		'easeOutBack',
		'Overshoot',
		'time',
		'Past 1 and back: a snap that settles.',
		[progressIn(), f('overshoot', 'Overshoot', 1.7)],
		'float',
		3,
		(c) => `efxEaseOutBack(${c.in.t}, ${c.in.overshoot})`,
		{ motion: cpu('easeOutBack') },
	),
	one(
		'hold',
		'In, hold, out',
		'time',
		'Up to 1, held for Hold of the play, then back to 0 (freeze, petrify and gold use it).',
		[progressIn(), f('hold', 'Hold', 0.4)],
		'float',
		5,
		(c) => `efxHold(${c.in.t}, ${c.in.hold})`,
		{ motion: cpu('hold') },
	),
	one(
		'pulse',
		'Pulse',
		'time',
		'A wave from 0 to 1 and back, Rate times over the play.',
		[progressIn(), f('rate', 'Rate', 1)],
		'float',
		2,
		(c) => `(0.5 - 0.5 * cos(2.0 * PI * ${c.in.rate} * ${c.in.t}))`,
		{ motion: cpu('pulse') },
	),
	one(
		'flicker',
		'Flicker',
		'time',
		'On or off at random, Rate times a second.',
		[
			port('seconds', 'Seconds', 'float', { defaultExpr: 'seconds' }),
			f('rate', 'Rate', 14),
			f('chance', 'On share', 0.5),
		],
		'float',
		4,
		(c) => `step(1.0 - ${c.in.chance}, efxHash1(floor(${c.in.seconds} * ${c.in.rate})))`,
		{ motion: cpu('flicker') },
	),
	one(
		'loopEnvelope',
		'Loop envelope',
		'time',
		'A looping effect’s strength: 1 while it repeats forever; played a set number of times, in over the first 15% and out over the last 15%, so it starts and ends at rest (the waves and Tilt 3D).',
		[progressIn()],
		'float',
		6,
		(c) =>
			`(uFx.w > 0.5 ? 1.0 : smoothstep(0.0, 0.15, ${c.in.t}) * (1.0 - smoothstep(0.85, 1.0, ${c.in.t})))`,
		{ motion: { emit: (c) => ({ out: c.op('loopEnvelope', c.in.t, c.read('looping')) }) } },
	),
	{
		type: 'bounce',
		label: 'Bounce',
		category: 'time',
		description:
			'Hops (1…5), each lower than the last, over the first 85% of the play, landing at the end (Bounce 3D): Height is 0…1 of the first hop’s, Squash how hard it is pressed into the ground at each landing.',
		inputs: [progressIn(), f('count', 'Hops', 2)],
		outputs: [port('height', 'Height', 'float'), port('squash', 'Squash', 'float')],
		cost: 40,
		emit: (c) => {
			const arcs = c.local('vec2', `efxBounce(${c.in.t}, ${c.in.count})`);
			return { height: `${arcs}.x`, squash: `${arcs}.y` };
		},
		motion: {
			emit: (c) => ({
				height: c.op('bounceHeight', ...c.args),
				squash: c.op('bounceSquash', ...c.args),
			}),
		},
	},
	one(
		'oscillate',
		'Oscillate',
		'time',
		'A sine over the play, −1…1: Rate times round, starting Phase of a turn in (0.25 starts at the top, as a cosine). Exact to the last digits, so a sway or a spin built on it lands where a built-in’s does.',
		[progressIn(), f('rate', 'Rate', 1), f('phase', 'Phase', 0)],
		'float',
		8,
		(c) => `efxSinPi(2.0 * (${c.in.rate} * ${c.in.t} + ${c.in.phase}))`,
		{ motion: cpu('oscillate') },
	),

	// --- procedural: noise and patterns ---
	one(
		'hash',
		'Random',
		'procedural',
		'A random number per point, 0…1.',
		[uvIn('p', 'Point')],
		'float',
		4,
		(c) => `efxHash(${c.in.p})`,
	),
	one(
		'noise',
		'Noise',
		'procedural',
		'Smooth value noise, 0…1.',
		[
			port('p', 'Point', 'vec2', { defaultExpr: 'uvSquare' }),
			f('scale', 'Scale', 8),
			f('seed', 'Seed', 0),
		],
		'float',
		18,
		(c) => `efxNoise(${c.in.p} * ${c.in.scale} + ${c.in.seed})`,
	),
	one(
		'fbm',
		'Fractal noise',
		'procedural',
		'Noise layered finer and fainter, up to 5 octaves.',
		[
			port('p', 'Point', 'vec2', { defaultExpr: 'uvSquare' }),
			f('scale', 'Scale', 6),
			f('octaves', 'Octaves', 3),
			f('seed', 'Seed', 0),
		],
		'float',
		90,
		(c) => `efxFbm(${c.in.p} * ${c.in.scale} + ${c.in.seed}, ${c.in.octaves})`,
	),
	{
		type: 'cells',
		label: 'Cells',
		category: 'procedural',
		description:
			'Cellular noise: distance to the nearest cell centre, to the next nearest, the cell’s own random value, and the crack between cells.',
		inputs: [
			port('p', 'Point', 'vec2', { defaultExpr: 'uvSquare' }),
			f('scale', 'Scale', 6),
			f('seed', 'Seed', 0),
		],
		outputs: [
			port('nearest', 'Nearest', 'float'),
			port('next', 'Next', 'float'),
			port('id', 'Cell value', 'float'),
			port('crack', 'Crack', 'float'),
		],
		cost: 120,
		emit: (c) => {
			const cells = c.local(
				'vec3',
				`efxCells(${c.in.p} * ${c.in.scale}, ${c.in.seed}, ${c.in.seed} * 3.1)`,
			);
			return {
				nearest: `${cells}.x`,
				next: `${cells}.y`,
				id: `${cells}.z`,
				crack: `(${cells}.y - ${cells}.x)`,
			};
		},
	},
	one(
		'gradient',
		'Gradient',
		'procedural',
		'0…1 across the element, corner to corner, at an angle (degrees, 0 = left to right).',
		[uvIn(), f('angle', 'Angle', 0)],
		'float',
		5,
		(c) => {
			const d = c.local('vec2', `vec2(cos(radians(${c.in.angle})), sin(radians(${c.in.angle})))`);
			return `(dot(${c.in.uv} - 0.5, ${d}) / (abs(${d}.x) + abs(${d}.y)) + 0.5)`;
		},
	),
	one(
		'radial',
		'Radial',
		'procedural',
		'0 at the centre to 1 at the corners.',
		[uvIn(), port('center', 'Centre', 'vec2', { default: [0.5, 0.5] })],
		'float',
		3,
		(c) => `(length(${c.in.uv} - ${c.in.center}) * 1.4142)`,
	),
	one(
		'stripes',
		'Stripes',
		'procedural',
		'Soft stripes, Count across 0…1 of X.',
		[f('x', 'X', 0), f('count', 'Count', 8)],
		'float',
		3,
		(c) => `(0.5 + 0.5 * sin(2.0 * PI * ${c.in.x} * ${c.in.count}))`,
	),
	one(
		'hash1',
		'Random number',
		'procedural',
		'A random number, 0…1, for each X: the same X, the same answer (Floor X to hold it a while).',
		[f('x', 'X', 0)],
		'float',
		3,
		(c) => `efxHash1(${c.in.x})`,
		{ motion: cpu('hash1') },
	),
	one(
		'noise1',
		'Line noise',
		'procedural',
		'Smooth noise along a line, 0…1: unwired, across the element (melt runs its drips on it).',
		[port('x', 'X', 'float', { defaultExpr: 'uv' }), f('scale', 'Scale', 8), f('seed', 'Seed', 0)],
		'float',
		8,
		(c) => `efxNoise1(${c.in.x} * ${c.in.scale} + ${c.in.seed})`,
		{ motion: { ...cpu('noise1'), defaults: { x: 'progress' } } },
	),
	{
		type: 'arcs',
		label: 'Arcs',
		category: 'procedural',
		description:
			'Jagged arcs crackling across the element between points on its edge (the electrocute look): Count of them (up to 6), picked by Seed and struck anew Rate times a second. Core is their white-hot middle, Halo the glow round them; both add up where arcs cross.',
		inputs: [
			uvIn(),
			f('count', 'Count', 3),
			f('seed', 'Seed', 0),
			port('seconds', 'Seconds', 'float', { defaultExpr: 'seconds' }),
			f('rate', 'Rate', 14),
		],
		outputs: [port('core', 'Core', 'float'), port('halo', 'Halo', 'float')],
		cost: 160,
		emit: (c) => {
			const arcs = c.local(
				'vec2',
				`efxArcs(${c.in.uv} * efxSize(), efxSize(), ${c.in.count}, ${c.in.seed}, floor(${c.in.seconds} * ${c.in.rate}))`,
			);
			return { core: `${arcs}.x`, halo: `${arcs}.y` };
		},
	},
	one(
		'sparkle',
		'Sparkles',
		'procedural',
		'Four-pointed stars twinkling on a grid Scale cells across, about half the cells lit, each on its own beat (the gold look’s sparkles): 0 where none shows.',
		[
			port('p', 'Point', 'vec2', { defaultExpr: 'uvSquare' }),
			f('scale', 'Scale', 6),
			f('seed', 'Seed', 0),
			port('seconds', 'Seconds', 'float', { defaultExpr: 'seconds' }),
		],
		'float',
		40,
		(c) => {
			const s = c.local(
				'vec2',
				`efxSparkle(${c.in.p} * ${c.in.scale}, ${c.in.seed}, ${c.in.seconds})`,
			);
			return `(${s}.x * ${s}.y)`;
		},
	),

	// --- mask: where, and how far something has come ---
	{
		type: 'away',
		label: 'Away from a side',
		category: 'mask',
		description:
			'How far something spreading from a side has to come to reach this pixel, 0…1 (freeze, burn, petrify and gold spread this way).',
		inputs: [uvIn()],
		outputs: [port('out', 'Distance', 'float')],
		settings: [
			{ id: 'side', label: 'From', kind: 'choice', options: EFX_SIDES, default: 'bottom' },
		],
		cost: 4,
		emit: (c) => ({ out: `efxAway(${c.in.uv}, ${c.setting('side')})` }),
	},
	one(
		'front',
		'Front',
		'mask',
		'1 where a front has passed: Reach below Front, softened over Softness.',
		[f('reach', 'Reach', 0.5), progressIn('front', 'Front'), f('softness', 'Softness', 0.05)],
		'float',
		3,
		(c) =>
			`(1.0 - smoothstep(${c.in.front} - max(${c.in.softness}, 0.0001), ${c.in.front}, ${c.in.reach}))`,
	),
	one(
		'band',
		'Band',
		'mask',
		'1 at At, falling to 0 by Width either side.',
		[f('x', 'X', 0), f('at', 'At', 0.5), f('width', 'Width', 0.05)],
		'float',
		3,
		(c) => `efxBand(${c.in.x}, ${c.in.at}, max(${c.in.width}, 0.0001))`,
		{ motion: cpu('band') },
	),
	one(
		'glint',
		'Glint',
		'mask',
		'A glint sweeping diagonally across, At 0…1 along its way.',
		[uvIn(), progressIn('at', 'At'), f('width', 'Width', 0.08)],
		'float',
		4,
		(c) => `efxGlint(${c.in.uv}, ${c.in.at}, max(${c.in.width}, 0.0001))`,
	),
	one(
		'edgeDistance',
		'Edge distance',
		'mask',
		'0 at the element’s box edge, 1 at its middle.',
		[uvIn()],
		'float',
		3,
		(c) => `efxEdgeDistance(${c.in.uv})`,
	),
	one(
		'inside',
		'Inside',
		'mask',
		'1 inside the element’s box, 0 outside it.',
		[uvIn()],
		'float',
		3,
		(c) => {
			const uv = c.local('vec2', c.in.uv);
			return `(step(0.0, ${uv}.x) * step(${uv}.x, 1.0) * step(0.0, ${uv}.y) * step(${uv}.y, 1.0))`;
		},
	),
	one(
		'awaySide',
		'Away from side N',
		'mask',
		'Away from a side, the side a number: 0 bottom, 1 top, 2 edges, 3 centre, 4 left, 5 right. Wire a choice param through a Pick, so whoever places the effect picks where it starts.',
		[uvIn(), f('side', 'Side', 0)],
		'float',
		4,
		(c) => `efxAway(${c.in.uv}, ${c.in.side})`,
	),

	// --- uv: move where the element is read from ---
	one(
		'offset',
		'Offset',
		'uv',
		'UV moved by By.',
		[uvIn(), port('by', 'By', 'vec2', { default: [0, 0] })],
		'vec2',
		1,
		(c) => `(${c.in.uv} + ${c.in.by})`,
	),
	one(
		'scaleUv',
		'Scale',
		'uv',
		'UV scaled about a pivot (above 1 shows the element larger).',
		[
			uvIn(),
			port('scale', 'Scale', 'vec2', { default: [1, 1] }),
			port('pivot', 'Pivot', 'vec2', { default: [0.5, 0.5] }),
		],
		'vec2',
		2,
		(c) => `((${c.in.uv} - ${c.in.pivot}) / ${c.in.scale} + ${c.in.pivot})`,
	),
	one(
		'rotateUv',
		'Rotate',
		'uv',
		'UV turned about the centre (degrees).',
		[uvIn(), f('angle', 'Angle', 0)],
		'vec2',
		8,
		(c) => `efxRotateUv(${c.in.uv}, radians(${c.in.angle}))`,
	),
	one(
		'twist',
		'Twist',
		'uv',
		'A swirl about the centre (degrees at the centre; radius in half-diagonals).',
		[uvIn(), f('angle', 'Angle', 90), f('radius', 'Radius', 1)],
		'vec2',
		12,
		(c) => `efxToUnit(efxTwist(efxFromUnit(${c.in.uv}), radians(${c.in.angle}), ${c.in.radius}))`,
	),
	one(
		'bulge',
		'Bulge',
		'uv',
		'A lens: Strength above 0 puffs out, below 0 pinches in.',
		[uvIn(), f('strength', 'Strength', 0.5), f('radius', 'Radius', 1)],
		'vec2',
		12,
		(c) => `efxToUnit(efxBulge(efxFromUnit(${c.in.uv}), ${c.in.strength}, ${c.in.radius}))`,
	),
	{
		type: 'ripple',
		label: 'Ripple',
		category: 'uv',
		description:
			'A shock ring from the centre, At element diagonals out (0 → 1 sweeps it past the corners), pushing the element outward; Ring is 1 at its middle.',
		inputs: [uvIn(), progressIn('at', 'At'), f('width', 'Width', 0.1), f('amount', 'Amount', 0.05)],
		outputs: [port('uv', 'UV', 'vec2'), port('ring', 'Ring', 'float')],
		cost: 14,
		emit: (c) => {
			const r = c.local(
				'vec3',
				`efxRipple(efxFromUnit(${c.in.uv}), ${c.in.at}, ${c.in.width}, ${c.in.amount})`,
			);
			return { uv: `efxToUnit(${r}.xy)`, ring: `${r}.z` };
		},
	},
	{
		type: 'wave',
		label: 'Wave',
		category: 'uv',
		description: 'A travelling wave: rows shift sideways (X) or columns up and down (Y).',
		inputs: [
			uvIn(),
			f('amplitude', 'Amplitude', 0.03),
			f('wavelength', 'Wavelength', 0.5),
			progressIn('phase', 'Phase'),
		],
		outputs: [port('out', 'UV', 'vec2')],
		settings: [{ id: 'axis', label: 'Axis', kind: 'choice', options: ['x', 'y'], default: 'x' }],
		cost: 6,
		emit: (c) => ({
			out: `efxToUnit(efxWave(efxFromUnit(${c.in.uv}), ${c.in.amplitude}, ${c.in.wavelength}, ${c.in.phase}, ${c.setting('axis')}))`,
		}),
	},
	one(
		'polar',
		'Polar',
		'uv',
		'UV as (angle round the centre 0…1, distance from it 0…1 at the edge).',
		[uvIn()],
		'vec2',
		6,
		(c) => {
			const p = c.local('vec2', `${c.in.uv} - 0.5`);
			return `vec2(atan(${p}.y, ${p}.x) / (2.0 * PI) + 0.5, length(${p}) * 2.0)`;
		},
	),
	{
		type: 'flag',
		label: 'Flag',
		category: 'uv',
		description:
			'A flag pinned at the element’s left edge: columns rise and fall in a wave that grows to the right (Amplitude in element heights, Wavelength in widths, Phase in cycles). Light is the shading on its folds (1 none), to multiply the colour by.',
		inputs: [
			uvIn(),
			f('amplitude', 'Amplitude', 0.05),
			f('wavelength', 'Wavelength', 0.6),
			progressIn('phase', 'Phase'),
		],
		outputs: [port('uv', 'UV', 'vec2'), port('light', 'Light', 'float')],
		cost: 10,
		emit: (c) => {
			const flag = c.local(
				'vec3',
				`efxFlag(efxFromUnit(${c.in.uv}), ${c.in.amplitude}, ${c.in.wavelength}, ${c.in.phase})`,
			);
			return { uv: `efxToUnit(${flag}.xy)`, light: `${flag}.z` };
		},
	},
	{
		type: 'perspective',
		label: 'Perspective plane',
		category: 'uv',
		description:
			'The element as a card turned in 3D and seen in perspective (the flips, Bounce 3D and Tilt 3D): turned about X, then about Y (degrees), lifted toward the eye (element sizes) and seen from Focal element sizes away. UV is where the card is read (its back shows the element mirrored), Facing 1 face on and 0 edge on, Hit 0 where the eye misses the card.',
		inputs: [
			uvIn(),
			f('turnX', 'Turn X (°)', 0),
			f('turnY', 'Turn Y (°)', 30),
			f('lift', 'Lift', 0),
			f('focal', 'Focal length', 3.5),
		],
		outputs: [
			port('uv', 'UV', 'vec2'),
			port('facing', 'Facing', 'float'),
			port('hit', 'Hit', 'float'),
		],
		cost: 40,
		emit: (c) => {
			const plane = c.local(
				'vec4',
				`efxPerspective(efxFromUnit(${c.in.uv}), vec3(radians(${c.in.turnX}), radians(${c.in.turnY}), ${c.in.lift}), ${c.in.focal})`,
			);
			return { uv: `efxToUnit(${plane}.xy)`, facing: `${plane}.z`, hit: `${plane}.w` };
		},
	},
	{
		type: 'sphericon',
		label: 'Sphericon',
		category: 'uv',
		description:
			'The element wrapped round a sphericon, two half double-cones joined with a quarter turn (the Sphericon effect): rolled about its axis, swung and tilted toward the viewer (degrees), Length its half-length as a share of the element’s smaller side. UV is where it is read, Hit 0 off the solid, Normal its surface direction (for Light).',
		inputs: [
			uvIn(),
			f('roll', 'Roll (°)', 0),
			f('swing', 'Swing (°)', 0),
			f('tilt', 'Tilt (°)', 25),
			f('length', 'Length', 0.55),
		],
		outputs: [
			port('uv', 'UV', 'vec2'),
			port('hit', 'Hit', 'float'),
			port('normal', 'Normal', 'vec3'),
		],
		cost: 200,
		emit: (c) => {
			const spin = c.local(
				'vec3',
				`vec3(radians(${c.in.roll}), radians(${c.in.swing}), radians(${c.in.tilt}))`,
			);
			const hit = c.local(
				'vec4',
				`efxSphericonHit(efxFromUnit(${c.in.uv}), ${spin}, ${c.in.length})`,
			);
			return {
				uv: `efxSphericonUv(${hit}, ${c.in.length})`,
				hit: `step(0.5, ${hit}.w)`,
				normal: `efxSphericonNormal(${hit}, ${spin}, ${c.in.length})`,
			};
		},
	},

	// --- colour and light ---
	{
		type: 'unpremultiply',
		label: 'Split colour',
		category: 'color',
		description: 'A premultiplied colour (as Sample gives it) as its colour and its alpha.',
		inputs: [sampleIn()],
		outputs: [port('rgb', 'Colour', 'vec3'), port('alpha', 'Alpha', 'float')],
		cost: 2,
		emit: (c) => {
			const color = c.local('vec4', c.in.color);
			return { rgb: `(${color}.rgb / max(${color}.a, 0.0001))`, alpha: `${color}.a` };
		},
	},
	one(
		'premultiply',
		'Join colour',
		'color',
		'A colour and an alpha as a premultiplied colour (as the output takes it).',
		[port('rgb', 'Colour', 'vec3', { default: [1, 1, 1] }), f('alpha', 'Alpha', 1)],
		'vec4',
		1,
		(c) => {
			const alpha = c.local('float', c.in.alpha);
			return `vec4(${c.in.rgb} * ${alpha}, ${alpha})`;
		},
	),
	one(
		'luma',
		'Brightness',
		'color',
		'How bright a colour reads.',
		[port('rgb', 'Colour', 'vec3', { default: [1, 1, 1] })],
		'float',
		2,
		(c) => `efxLuma(${c.in.rgb})`,
	),
	one(
		'desaturate',
		'Desaturate',
		'color',
		'The colour toward grey by Amount.',
		[port('rgb', 'Colour', 'vec3', { default: [1, 1, 1] }), f('amount', 'Amount', 1)],
		'vec3',
		3,
		(c) => {
			const rgb = c.local('vec3', c.in.rgb);
			return `mix(${rgb}, vec3(efxLuma(${rgb})), ${c.in.amount})`;
		},
	),
	one(
		'colorize',
		'Colourize',
		'color',
		'The colour’s brightness in Tint.',
		[
			port('rgb', 'Colour', 'vec3', { default: [1, 1, 1] }),
			port('tint', 'Tint', 'vec3', { default: [1, 0.8, 0.3] }),
		],
		'vec3',
		3,
		(c) => `(vec3(efxLuma(${c.in.rgb})) * ${c.in.tint})`,
	),
	one(
		'hueShift',
		'Hue shift',
		'color',
		'The colour turned round the colour wheel (1 = once round), its brightness kept.',
		[port('rgb', 'Colour', 'vec3', { default: [1, 1, 1] }), f('turns', 'Turns', 0.1)],
		'vec3',
		14,
		(c) => `efxHueShift(${c.in.rgb}, ${c.in.turns})`,
	),
	one(
		'contrast',
		'Contrast',
		'color',
		'Light and dark pushed apart (above 1) or together.',
		[port('rgb', 'Colour', 'vec3', { default: [1, 1, 1] }), f('amount', 'Amount', 1.2)],
		'vec3',
		2,
		(c) => `clamp((${c.in.rgb} - 0.5) * ${c.in.amount} + 0.5, 0.0, 1.0)`,
	),
	one(
		'reliefNormal',
		'Relief normal',
		'color',
		'The element’s relief as a surface direction, for lighting (petrify and gold carve this way).',
		[uvIn(), f('strength', 'Strength', 2.5)],
		'vec3',
		16,
		(c) => `efxReliefNormal(efxFromUnit(${c.in.uv}), ${c.in.strength})`,
		{ samples: 4 },
	),
	{
		type: 'light',
		label: 'Light',
		category: 'color',
		description:
			'How lit a surface is from a light (+Z towards the viewer): diffuse and a highlight.',
		inputs: [
			port('normal', 'Normal', 'vec3', { default: [0, 0, 1] }),
			port('light', 'Light from', 'vec3', { default: [-0.5, -0.6, 0.65] }),
			f('shininess', 'Shininess', 18),
		],
		outputs: [port('diffuse', 'Diffuse', 'float'), port('specular', 'Highlight', 'float')],
		cost: 10,
		emit: (c) => {
			const lit = c.local('vec2', `efxLight(${c.in.normal}, ${c.in.light}, ${c.in.shininess})`);
			return { diffuse: `${lit}.x`, specular: `${lit}.y` };
		},
	},
	one(
		'metalRamp',
		'Metal',
		'color',
		'A metal’s shade, 0…1: deep, the colour, near white (the gold effect’s ramp).',
		[f('shade', 'Shade', 0.5), port('base', 'Colour', 'vec3', { default: [1, 0.78, 0.24] })],
		'vec3',
		6,
		(c) => `efxMetalRamp(${c.in.base}, clamp(${c.in.shade}, 0.0, 1.0))`,
	),
	one(
		'over',
		'Over',
		'color',
		'Top laid over Bottom (both premultiplied).',
		[port('top', 'Top', 'vec4', { default: [0, 0, 0, 0] }), sampleIn('bottom', 'Bottom')],
		'vec4',
		2,
		(c) => {
			const top = c.local('vec4', c.in.top);
			return `(${top} + ${c.in.bottom} * (1.0 - ${top}.a))`;
		},
	),
	one(
		'fade',
		'Fade',
		'color',
		'A premultiplied colour faded by Amount (0 gone, 1 as it is).',
		[sampleIn(), f('amount', 'Amount', 1)],
		'vec4',
		1,
		(c) => `(${c.in.color} * clamp(${c.in.amount}, 0.0, 1.0))`,
	),
	one(
		'reliefSlope',
		'Relief slope',
		'color',
		'How steeply the element’s relief climbs at a UV, rightward and downward (petrify carves with it; Relief normal turns it into a direction).',
		[uvIn()],
		'vec2',
		14,
		(c) => `efxReliefSlope(efxFromUnit(${c.in.uv}))`,
		{ samples: 4 },
	),
	one(
		'curl',
		'Page curl',
		'color',
		'The element with a corner peeled back like a page (Corner 0 or 1 each way: 1, 1 is the bottom right), rolling over a cylinder Roll diagonals across whose axis has come Peel diagonals in from the corner. The flap’s back shows the element dimmed and the page darkens under the roll. A colour: it reads the element at this pixel itself, so a UV node before it does not move it.',
		[
			port('corner', 'Corner', 'vec2', { default: [1, 1] }),
			f('reach', 'Peel', 0.3),
			f('radius', 'Roll', 0.1),
		],
		'vec4',
		40,
		(c) => `efxCurl(px, ${c.in.corner}, ${c.in.reach}, ${c.in.radius})`,
		{ samples: 3 },
	),

	// --- output ---
	{
		type: 'output',
		label: 'Output',
		category: 'output',
		description:
			'What the element draws: a premultiplied colour. Unwired, the element as it is. Blend Normal keeps each colour channel within its alpha; Add lets a colour brighter than its alpha add light over what is behind (an arc’s glow past the element’s edge).',
		inputs: [sampleIn()],
		outputs: [],
		settings: [
			{
				id: 'blend',
				label: 'Blend',
				kind: 'choice',
				options: ['normal', 'add'],
				default: 'normal',
			},
		],
		cost: 1,
		emit: () => ({}),
	},
];

export const DIMS: Record<PortType, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4 };

const BY_TYPE = new Map(SHADER_NODES.map((def) => [def.type, def]));

export const shaderNode = (type: string): NodeDef | undefined => BY_TYPE.get(type);

/** The Motion Output's inputs: the channels a motion graph may drive, and the effect's padding. */
const MOTION_OUTPUT_PORTS: readonly PortDef[] = [
	port('x', 'X (widths)', 'float'),
	port('y', 'Y (heights)', 'float'),
	port('scale', 'Scale', 'float'),
	port('scaleX', 'Scale X', 'float'),
	port('scaleY', 'Scale Y', 'float'),
	port('rotation', 'Rotation (°)', 'float'),
	port('alpha', 'Alpha', 'float'),
	port('padding', 'Padding', 'float'),
];

/**
 * The nodes only the MOTION graph has: the element's shape, and the Motion Output. They have no
 * GLSL and the pixel graph refuses them.
 */
const MOTION_ONLY_NODES: readonly NodeDef[] = [
	{
		type: 'shape',
		label: 'Element shape',
		category: 'input',
		description:
			'The element’s width and height in its own units, and its aspect (width ÷ height). X and Y move in shares of the element’s width and height: divide a move in its units by them.',
		inputs: [],
		outputs: [
			port('width', 'Width', 'float'),
			port('height', 'Height', 'float'),
			port('aspect', 'Aspect', 'float'),
		],
		cost: 1,
		emit: () => ({}),
		motion: {
			emit: (c) => {
				const width = c.read('width');
				const height = c.read('height');
				return { width, height, aspect: c.op('divide', width, height) };
			},
		},
	},
	{
		type: 'motionOutput',
		label: 'Motion Output',
		category: 'output',
		description:
			'What the motion graph drives each frame: the element’s move (X in its widths, Y in its heights), its scale, its turn (degrees), its alpha (0…1) and the room drawn around it (Padding, in shares of its larger side). The values are final: read Strength to scale them. An input left unwired leaves its channel to its curve, or at rest.',
		inputs: MOTION_OUTPUT_PORTS,
		outputs: [],
		cost: 0,
		emit: () => ({}),
		motion: { emit: () => ({}) },
	},
];

/** `def` as the motion graph sees it: every port a float, a per-pixel default read off the play. */
const motionView = (def: NodeDef): NodeDef => {
	const float = (p: PortDef): PortDef => {
		const typed: PortDef = p.type === 'any' ? { ...p, type: 'float' } : p;
		const read = def.motion?.defaults?.[p.id];
		return read ? { ...typed, defaultExpr: read } : typed;
	};
	return { ...def, inputs: def.inputs.map(float), outputs: def.outputs.map(float) };
};

/**
 * The MOTION graph's nodes, as it sees them: the library's float nodes that have a CPU form (the
 * same ids, so a node means the same in both graphs), the element's shape and the Motion Output.
 */
export const MOTION_NODES: readonly NodeDef[] = [
	...SHADER_NODES.filter((def) => def.motion),
	...MOTION_ONLY_NODES,
].map(motionView);

export const MOTION_NODE_TYPES: readonly string[] = MOTION_NODES.map((def) => def.type);

const MOTION_BY_TYPE = new Map(MOTION_NODES.map((def) => [def.type, def]));

/** A node the motion graph has, as it sees it (every port a float). */
export const motionNode = (type: string): NodeDef | undefined => MOTION_BY_TYPE.get(type);

export const isMotionNode = (type: string): boolean => MOTION_BY_TYPE.has(type);

/** A node only the motion graph has (the pixel graph refuses it). */
export const isMotionOnlyNode = (type: string): boolean =>
	MOTION_ONLY_NODES.some((def) => def.type === type);
