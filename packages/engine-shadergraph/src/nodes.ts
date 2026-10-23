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

export type NodeCategory =
	'input' | 'math' | 'time' | 'procedural' | 'mask' | 'uv' | 'color' | 'output';

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
}

const port = (
	id: string,
	label: string,
	type: PortTypeSpec,
	more: Partial<Pick<PortDef, 'default' | 'defaultExpr'>> = {},
): PortDef => ({ id, label, type, ...more });
const f = (id: string, label: string, value?: number): PortDef =>
	port(id, label, 'float', value === undefined ? {} : { default: value });
const any = (id: string, label: string, value?: number): PortDef =>
	port(id, label, 'any', value === undefined ? {} : { default: value });
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

/** A node `out = fn(in…)` on any type. */
const unary = (type: string, label: string, description: string, glsl: (x: string) => string) =>
	one(type, label, 'math', description, [any('x', 'X', 0)], 'any', 1, (c) => glsl(c.in.x));
const binary = (
	type: string,
	label: string,
	description: string,
	glsl: (a: string, b: string) => string,
	b = 0,
) =>
	one(type, label, 'math', description, [any('a', 'A', 0), any('b', 'B', b)], 'any', 1, (c) =>
		glsl(c.in.a, c.in.b),
	);

const PARAM_TYPE: Record<ElementFxParamSpec['kind'], PortType> = {
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
	),
	one(
		'pulse',
		'Pulse',
		'time',
		'A wave from 0 to 1 and back, Rate times over the play.',
		[progressIn(), f('rate', 'Rate', 1)],
		'float',
		2,
		(c) => `(0.5 + 0.5 * sin(2.0 * PI * ${c.in.rate} * ${c.in.t}))`,
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
		'0…1 across the element at an angle (degrees, 0 = left to right).',
		[uvIn(), f('angle', 'Angle', 0)],
		'float',
		4,
		(c) =>
			`(dot(${c.in.uv} - 0.5, vec2(cos(radians(${c.in.angle})), sin(radians(${c.in.angle})))) + 0.5)`,
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
		(c) => `(1.0 - smoothstep(${c.in.front} - ${c.in.softness}, ${c.in.front}, ${c.in.reach}))`,
	),
	one(
		'band',
		'Band',
		'mask',
		'1 at At, falling to 0 by Width either side.',
		[f('x', 'X', 0), f('at', 'At', 0.5), f('width', 'Width', 0.05)],
		'float',
		3,
		(c) => `efxBand(${c.in.x}, ${c.in.at}, ${c.in.width})`,
	),
	one(
		'glint',
		'Glint',
		'mask',
		'A glint sweeping diagonally across, At 0…1 along its way.',
		[uvIn(), progressIn('at', 'At'), f('width', 'Width', 0.08)],
		'float',
		4,
		(c) => `efxGlint(${c.in.uv}, ${c.in.at}, ${c.in.width})`,
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
		(c) => `efxTwistUv(${c.in.uv}, radians(${c.in.angle}), ${c.in.radius})`,
	),
	one(
		'bulge',
		'Bulge',
		'uv',
		'A lens: Strength above 0 puffs out, below 0 pinches in.',
		[uvIn(), f('strength', 'Strength', 0.5), f('radius', 'Radius', 1)],
		'vec2',
		12,
		(c) => `efxBulgeUv(${c.in.uv}, ${c.in.strength}, ${c.in.radius})`,
	),
	{
		type: 'ripple',
		label: 'Ripple',
		category: 'uv',
		description: 'A shock ring At diagonals out pushing the element outward; Ring is 1 on it.',
		inputs: [uvIn(), progressIn('at', 'At'), f('width', 'Width', 0.1), f('amount', 'Amount', 0.05)],
		outputs: [port('uv', 'UV', 'vec2'), port('ring', 'Ring', 'float')],
		cost: 14,
		emit: (c) => {
			const r = c.local(
				'vec3',
				`efxRippleUv(${c.in.uv}, ${c.in.at}, ${c.in.width}, ${c.in.amount})`,
			);
			return { uv: `${r}.xy`, ring: `${r}.z` };
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
			out: `efxWaveUv(${c.in.uv}, ${c.in.amplitude}, ${c.in.wavelength}, ${c.in.phase}, ${c.setting('axis')})`,
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
		'Colorize',
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

	// --- output ---
	{
		type: 'output',
		label: 'Output',
		category: 'output',
		description: 'What the element draws: a premultiplied colour. Unwired, the element as it is.',
		inputs: [sampleIn()],
		outputs: [],
		cost: 1,
		emit: () => ({}),
	},
];

export const DIMS: Record<PortType, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4 };

const BY_TYPE = new Map(SHADER_NODES.map((def) => [def.type, def]));

export const shaderNode = (type: string): NodeDef | undefined => BY_TYPE.get(type);
