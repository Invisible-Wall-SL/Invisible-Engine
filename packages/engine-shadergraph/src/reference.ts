/**
 * REFERENCE GRAPHS: six effects built from the node library alone, each leaning on a different
 * family of nodes; Power-up adds motion curves and a built-in pass. The headless checks compile them;
 * the render harness (`pnpm --filter fx-spike shader-parity`) draws them on WebGL1 and WebGL2, as
 * filters and played as custom Element FX kinds. Frost and Gilded relief build the freeze and gold
 * looks from nodes: close to the built-ins, not pixel twins of them (the twins are step 6 of the
 * design).
 */

import type { ElementFxParamSpec } from 'constants-shared/elementFx';
import { PARAM_TYPE, SHADER_NODES, type NodeDef, type PortDef } from './nodes';
import { SHADER_GRAPH_VERSION, type GraphNode, type PortType, type ShaderGraphDoc } from './types';

type Values = GraphNode['values'];

/** A small builder: `node` adds one and returns its id, `wire` joins an output to an input. */
export function graphBuilder(
	meta: Pick<ShaderGraphDoc, 'id' | 'name' | 'phase' | 'durationMs'> &
		Partial<Pick<ShaderGraphDoc, 'description' | 'padding' | 'passes' | 'motion'>> & {
			params?: ElementFxParamSpec[];
		},
) {
	const doc: ShaderGraphDoc = {
		version: SHADER_GRAPH_VERSION,
		...meta,
		params: meta.params ?? [],
		nodes: [],
		wires: [],
	};
	return {
		node(type: string, values?: Values): string {
			const id = `${type}${doc.nodes.length + 1}`;
			doc.nodes.push({ id, type, x: doc.nodes.length * 180, y: 0, ...(values ? { values } : {}) });
			return id;
		},
		wire(from: string, fromPort: string, to: string, toPort: string): void {
			doc.wires.push({ from: { node: from, port: fromPort }, to: { node: to, port: toPort } });
		},
		doc: (): ShaderGraphDoc => doc,
	};
}

/** Brightness tinted toward a colour, in and out once over the play. */
function pulseTint(): ShaderGraphDoc {
	const g = graphBuilder({
		id: 'pulseTint',
		name: 'Pulse tint',
		phase: 'emphasis',
		durationMs: 1200,
		params: [{ id: 'color', label: 'Tint', kind: 'color', default: '#66ccff' }],
	});
	const time = g.node('time');
	const bell = g.node('bell');
	const strength = g.node('multiply');
	const split = g.node('unpremultiply');
	const tint = g.node('param', { param: 'color' });
	const colorize = g.node('colorize');
	const mix = g.node('mix');
	const join = g.node('premultiply');
	const out = g.node('output');
	g.wire(time, 'progress', bell, 't');
	g.wire(bell, 'out', strength, 'a');
	g.wire(time, 'intensity', strength, 'b');
	g.wire(split, 'rgb', colorize, 'rgb');
	g.wire(tint, 'out', colorize, 'tint');
	g.wire(split, 'rgb', mix, 'a');
	g.wire(colorize, 'out', mix, 'b');
	g.wire(strength, 'out', mix, 't');
	g.wire(mix, 'out', join, 'rgb');
	g.wire(split, 'alpha', join, 'alpha');
	g.wire(join, 'out', out, 'color');
	return g.doc();
}

/** Gone in a noisy dissolve as the play runs, a glowing band on its edge. */
function noiseDissolve(): ShaderGraphDoc {
	const g = graphBuilder({
		id: 'noiseDissolve',
		name: 'Noise dissolve',
		phase: 'exit',
		durationMs: 1200,
		params: [
			{ id: 'edge', label: 'Edge colour', kind: 'color', default: '#ffb347' },
			{ id: 'grain', label: 'Grain', kind: 'number', default: 8, min: 1, max: 40, step: 0.5 },
		],
	});
	const time = g.node('time');
	const grain = g.node('param', { param: 'grain' });
	const noise = g.node('noise');
	const ahead = g.node('add', { b: 0.04 });
	const alive = g.node('smoothstep');
	const glow = g.node('band', { width: 0.06 });
	const shape = g.node('unpremultiply');
	const onShape = g.node('multiply');
	const edgeColor = g.node('param', { param: 'edge' });
	const join = g.node('premultiply');
	const body = g.node('fade');
	const over = g.node('over');
	const out = g.node('output');
	g.wire(grain, 'out', noise, 'scale');
	g.wire(time, 'progress', ahead, 'a');
	g.wire(time, 'progress', alive, 'from');
	g.wire(ahead, 'out', alive, 'to');
	g.wire(noise, 'out', alive, 'x');
	g.wire(noise, 'out', glow, 'x');
	g.wire(time, 'progress', glow, 'at');
	g.wire(edgeColor, 'out', join, 'rgb');
	// The edge glows only where the element is: its band, times the element's own alpha.
	g.wire(glow, 'out', onShape, 'a');
	g.wire(shape, 'alpha', onShape, 'b');
	g.wire(onShape, 'out', join, 'alpha');
	g.wire(alive, 'out', body, 'amount');
	g.wire(join, 'out', over, 'top');
	g.wire(body, 'out', over, 'bottom');
	g.wire(over, 'out', out, 'color');
	return g.doc();
}

/** A shock ring running out from the centre, lighting the element where it passes. */
function ripple(): ShaderGraphDoc {
	const g = graphBuilder({ id: 'ripple', name: 'Ripple', phase: 'emphasis', durationMs: 900 });
	const ring = g.node('ripple', { width: 0.12, amount: 0.04 });
	const sample = g.node('sample');
	const split = g.node('unpremultiply');
	const light = g.node('multiply', { b: 0.45 });
	const lit = g.node('add');
	const join = g.node('premultiply');
	const out = g.node('output');
	g.wire(ring, 'uv', sample, 'uv');
	g.wire(sample, 'out', split, 'color');
	g.wire(ring, 'ring', light, 'a');
	g.wire(split, 'rgb', lit, 'a');
	g.wire(light, 'out', lit, 'b');
	g.wire(lit, 'out', join, 'rgb');
	g.wire(split, 'alpha', join, 'alpha');
	g.wire(join, 'out', out, 'color');
	return g.doc();
}

/** The freeze look from nodes: frost creeps in along cells, holds with a glint, thaws. */
function frost(): ShaderGraphDoc {
	const g = graphBuilder({
		id: 'frost',
		name: 'Frost',
		phase: 'emphasis',
		durationMs: 2600,
		params: [{ id: 'ice', label: 'Ice colour', kind: 'color', default: '#9fdcff' }],
	});
	const time = g.node('time');
	const hold = g.node('hold');
	const frontAt = g.node('multiply', { b: 1.25 });
	const away = g.node('away', { side: 'edges' });
	const cells = g.node('cells', { scale: 12 });
	const awayPart = g.node('multiply', { b: 0.8 });
	const cellPart = g.node('multiply', { b: 0.2 });
	const reach = g.node('add');
	const frozen = g.node('front', { softness: 0.06 });
	const split = g.node('unpremultiply');
	const luma = g.node('luma');
	const shade = g.node('remap', { outMin: 0.35, outMax: 1.25 });
	const ice = g.node('param', { param: 'ice' });
	const iceShade = g.node('multiply');
	const crack = g.node('smoothstep', { from: 0, to: 0.05 });
	const crackLight = g.node('oneMinus');
	const crackBright = g.node('multiply', { b: 0.3 });
	const glint = g.node('glint', { width: 0.08 });
	const glintBright = g.node('multiply', { b: 0.5 });
	const outline = g.node('outline');
	const outlineBright = g.node('multiply', { b: 0.6 });
	const light1 = g.node('add');
	const light2 = g.node('add');
	const light3 = g.node('add');
	const mixed = g.node('mix');
	const join = g.node('premultiply');
	const out = g.node('output');
	g.wire(time, 'progress', hold, 't');
	g.wire(hold, 'out', frontAt, 'a');
	g.wire(away, 'out', awayPart, 'a');
	g.wire(cells, 'nearest', cellPart, 'a');
	g.wire(awayPart, 'out', reach, 'a');
	g.wire(cellPart, 'out', reach, 'b');
	g.wire(reach, 'out', frozen, 'reach');
	g.wire(frontAt, 'out', frozen, 'front');
	g.wire(split, 'rgb', luma, 'rgb');
	g.wire(luma, 'out', shade, 'x');
	g.wire(ice, 'out', iceShade, 'a');
	g.wire(shade, 'out', iceShade, 'b');
	g.wire(cells, 'crack', crack, 'x');
	g.wire(crack, 'out', crackLight, 'x');
	g.wire(crackLight, 'out', crackBright, 'a');
	g.wire(hold, 'out', glint, 'at');
	g.wire(glint, 'out', glintBright, 'a');
	g.wire(outline, 'out', outlineBright, 'a');
	g.wire(crackBright, 'out', light1, 'a');
	g.wire(glintBright, 'out', light1, 'b');
	g.wire(light1, 'out', light2, 'a');
	g.wire(outlineBright, 'out', light2, 'b');
	g.wire(iceShade, 'out', light3, 'a');
	g.wire(light2, 'out', light3, 'b');
	g.wire(split, 'rgb', mixed, 'a');
	g.wire(light3, 'out', mixed, 'b');
	g.wire(frozen, 'out', mixed, 't');
	g.wire(mixed, 'out', join, 'rgb');
	g.wire(split, 'alpha', join, 'alpha');
	g.wire(join, 'out', out, 'color');
	return g.doc();
}

/** The gold look from nodes: polished metal spreads from the centre, lit as a relief. */
function gildedRelief(): ShaderGraphDoc {
	const g = graphBuilder({
		id: 'gildedRelief',
		name: 'Gilded relief',
		phase: 'emphasis',
		durationMs: 2600,
		params: [{ id: 'gold', label: 'Gold colour', kind: 'color', default: '#ffc83d' }],
	});
	const time = g.node('time');
	const hold = g.node('hold');
	const frontAt = g.node('multiply', { b: 1.22 });
	const away = g.node('away', { side: 'center' });
	const gilt = g.node('front', { softness: 0.04 });
	const split = g.node('unpremultiply');
	const luma = g.node('luma');
	const normal = g.node('reliefNormal');
	const light = g.node('light');
	const lumaPart = g.node('multiply', { b: 0.32 });
	const litPart = g.node('multiply', { b: 0.62 });
	const shade1 = g.node('add', { b: 0.06 });
	const shade = g.node('add');
	const gold = g.node('param', { param: 'gold' });
	const metal = g.node('metalRamp');
	const highlight = g.node('multiply', { b: 0.9 });
	const shiny = g.node('add');
	const glint = g.node('glint', { width: 0.07 });
	const glintPart = g.node('multiply', { b: 0.55 });
	const polished = g.node('add');
	const mixed = g.node('mix');
	const join = g.node('premultiply');
	const out = g.node('output');
	g.wire(time, 'progress', hold, 't');
	g.wire(hold, 'out', frontAt, 'a');
	g.wire(away, 'out', gilt, 'reach');
	g.wire(frontAt, 'out', gilt, 'front');
	g.wire(split, 'rgb', luma, 'rgb');
	g.wire(normal, 'out', light, 'normal');
	g.wire(luma, 'out', lumaPart, 'a');
	g.wire(light, 'diffuse', litPart, 'a');
	g.wire(lumaPart, 'out', shade1, 'a');
	g.wire(shade1, 'out', shade, 'a');
	g.wire(litPart, 'out', shade, 'b');
	g.wire(shade, 'out', metal, 'shade');
	g.wire(gold, 'out', metal, 'base');
	g.wire(light, 'specular', highlight, 'a');
	g.wire(metal, 'out', shiny, 'a');
	g.wire(highlight, 'out', shiny, 'b');
	g.wire(hold, 'out', glint, 'at');
	g.wire(glint, 'out', glintPart, 'a');
	g.wire(shiny, 'out', polished, 'a');
	g.wire(glintPart, 'out', polished, 'b');
	g.wire(split, 'rgb', mixed, 'a');
	g.wire(polished, 'out', mixed, 'b');
	g.wire(gilt, 'out', mixed, 't');
	g.wire(mixed, 'out', join, 'rgb');
	g.wire(split, 'alpha', join, 'alpha');
	g.wire(join, 'out', out, 'color');
	return g.doc();
}

/**
 * A power-up: a warm tint swells over the element while it jumps and grows (motion curves), and a
 * glow in the effect's own colour (a built-in pass tied to its param) breathes around it.
 */
function powerUp(): ShaderGraphDoc {
	const g = graphBuilder({
		id: 'powerUp',
		name: 'Power-up',
		description: 'A warm swell, a hop and a glow in one.',
		phase: 'emphasis',
		durationMs: 900,
		params: [{ id: 'color', label: 'Colour', kind: 'color', default: '#ffd166' }],
		passes: [{ kind: 'glow', params: { color: { param: 'color' } } }],
		motion: {
			channels: {
				y: [
					{ t: 0, v: 0, ease: 'out' },
					{ t: 0.35, v: -0.12, ease: 'in' },
					{ t: 0.7, v: 0, ease: 'out' },
					{ t: 0.85, v: -0.02, ease: 'in' },
					{ t: 1, v: 0 },
				],
				scale: [
					{ t: 0, v: 1, ease: 'out' },
					{ t: 0.35, v: 1.12, ease: 'smooth' },
					{ t: 1, v: 1 },
				],
			},
			pivot: { x: 0.5, y: 1 },
		},
	});
	const time = g.node('time');
	const swell = g.node('swell');
	const strength = g.node('multiply');
	const split = g.node('unpremultiply');
	const tint = g.node('param', { param: 'color' });
	const colorize = g.node('colorize');
	const mix = g.node('mix');
	const join = g.node('premultiply');
	const out = g.node('output');
	g.wire(time, 'progress', swell, 't');
	g.wire(swell, 'out', strength, 'a');
	g.wire(time, 'intensity', strength, 'b');
	g.wire(split, 'rgb', colorize, 'rgb');
	g.wire(tint, 'out', colorize, 'tint');
	g.wire(split, 'rgb', mix, 'a');
	g.wire(colorize, 'out', mix, 'b');
	g.wire(strength, 'out', mix, 't');
	g.wire(mix, 'out', join, 'rgb');
	g.wire(split, 'alpha', join, 'alpha');
	g.wire(join, 'out', out, 'color');
	return g.doc();
}

export const REFERENCE_GRAPHS: readonly ShaderGraphDoc[] = [
	pulseTint(),
	noiseDissolve(),
	ripple(),
	frost(),
	gildedRelief(),
	powerUp(),
];

/** What a generic node is fed in the showcase at each vector width: a node with that output. */
const WIDTH_SOURCES: readonly (readonly [PortType, string])[] = [
	['vec2', 'uv'],
	['vec3', 'color'],
	['vec4', 'sample'],
];

/**
 * Every output of every node in a graph of its own, wired to an Output (a vec2 or vec3 through its
 * length, which the Output can take). A node with generic inputs comes again at each vector width,
 * all its generic inputs fed a vec2, a vec3 and a vec4, since its GLSL must hold at every width.
 * The headless checks link and lint each; the render harness and `shader-compile` compile each on
 * WebGL1 and WebGL2.
 */
export function nodeShowcase(): ShaderGraphDoc[] {
	const params: ElementFxParamSpec[] = [
		{ id: 'n', label: 'N', kind: 'number', default: 1, min: 0, max: 2 },
		{ id: 'c', label: 'C', kind: 'color', default: '#336699' },
		{ id: 'b', label: 'B', kind: 'bool', default: true },
		{ id: 'k', label: 'K', kind: 'choice', default: 'b', options: ['a', 'b'] },
	];
	const docs: ShaderGraphDoc[] = [];
	const add = (
		def: NodeDef,
		output: PortDef,
		type: PortType,
		id: string,
		values?: GraphNode['values'],
		feed?: readonly [PortType, string],
	): void => {
		const g = graphBuilder({ id, name: def.label, phase: 'emphasis', durationMs: 1000, params });
		const node = g.node(def.type, values);
		if (feed) {
			const source = g.node(feed[1]);
			for (const input of def.inputs)
				if (input.type === 'any') g.wire(source, 'out', node, input.id);
		}
		const out = g.node('output');
		if (type === 'vec2' || type === 'vec3') {
			const length = g.node('length');
			g.wire(node, output.id, length, 'v');
			g.wire(length, 'out', out, 'color');
		} else {
			g.wire(node, output.id, out, 'color');
		}
		docs.push(g.doc());
	};
	for (const def of SHADER_NODES) {
		if (def.type === 'output') continue;
		for (const output of def.outputs) {
			if (def.type === 'param') {
				for (const param of params)
					add(def, output, PARAM_TYPE[param.kind], `param-${output.id}-${param.id}`, {
						param: param.id,
					});
				continue;
			}
			add(def, output, output.type === 'any' ? 'float' : output.type, `${def.type}-${output.id}`);
			if (!def.inputs.some((input) => input.type === 'any')) continue;
			for (const feed of WIDTH_SOURCES) {
				const type = output.type === 'any' ? feed[0] : output.type;
				add(def, output, type, `${def.type}-${output.id}-${feed[0]}`, undefined, feed);
			}
		}
	}
	return docs;
}
