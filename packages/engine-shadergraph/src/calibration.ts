/**
 * CALIBRATION GRAPHS: the particle materials the step-8 phone check measures (Invisible Shader
 * Graph step 8d.8, `docs/playtest/particle-material.md`), each made for particles, so the same
 * graphs are compared on every phone and in every run of `particle-material-play.mjs`:
 *
 *  - `calLight`: Pulse tint, cost 12, one read: the price of the pixels alone;
 *  - `calBudget`: a graph at the particle budget (cost close under 150, 4 reads): fbm and noise
 *    over three offset reads of the particle's art, blended into it;
 *  - `calSeed`: each particle's art turned round the colour wheel by a hash of its seed, so the
 *    seeds can be seen (many hues, or few and banded);
 *  - `calParity`: the Output alone, which must look like the plain sprites.
 *
 * `compile.fixture.ts` holds each to its cost and reads.
 */

import { REFERENCE_GRAPHS, graphBuilder } from './reference';
import { SHADER_MADE_FOR_PARTICLES, type ShaderGraphDoc } from './types';

const PARTICLES = { madeFor: SHADER_MADE_FOR_PARTICLES } as const;

function calLight(): ShaderGraphDoc {
	const pulse = REFERENCE_GRAPHS.find((d) => d.id === 'pulseTint');
	if (!pulse) throw new Error('calibration: no Pulse tint reference graph');
	return { ...structuredClone(pulse), id: 'calLight', name: 'Calibration: light', ...PARTICLES };
}

function calBudget(): ShaderGraphDoc {
	const g = graphBuilder({
		id: 'calBudget',
		name: 'Calibration: at the budget',
		phase: 'emphasis',
		durationMs: 1200,
	});
	const seed = g.node('seed');
	const time = g.node('time');
	const fbm = g.node('fbm', { scale: 6, octaves: 4 });
	const noise = g.node('noise', { scale: 3 });
	const turned = g.node('rotateUv', { angle: 0.4 });
	const waved = g.node('wave', { amplitude: 0.03, wavelength: 0.3 });
	const scaled = g.node('scaleUv');
	const a = g.node('sample');
	const b = g.node('sample');
	const c = g.node('sample');
	const ab = g.node('add');
	const abc = g.node('add');
	const third = g.node('multiply', { b: 0.333 });
	const amount = g.node('multiply');
	const envelope = g.node('bell');
	const blend = g.node('mix');
	const pixel = g.node('unpremultiply');
	const join = g.node('premultiply');
	const rgbOf = g.node('unpremultiply');
	const out = g.node('output');
	g.wire(seed, 'out', fbm, 'seed');
	g.wire(seed, 'out', noise, 'seed');
	g.wire(turned, 'out', a, 'uv');
	g.wire(waved, 'out', b, 'uv');
	g.wire(scaled, 'out', c, 'uv');
	g.wire(a, 'out', ab, 'a');
	g.wire(b, 'out', ab, 'b');
	g.wire(ab, 'out', abc, 'a');
	g.wire(c, 'out', abc, 'b');
	g.wire(abc, 'out', third, 'a');
	g.wire(third, 'out', rgbOf, 'color');
	g.wire(time, 'progress', envelope, 't');
	g.wire(fbm, 'out', amount, 'a');
	g.wire(noise, 'out', amount, 'b');
	g.wire(pixel, 'rgb', blend, 'a');
	g.wire(rgbOf, 'rgb', blend, 'b');
	g.wire(amount, 'out', blend, 't');
	g.wire(blend, 'out', join, 'rgb');
	g.wire(pixel, 'alpha', join, 'alpha');
	g.wire(join, 'out', out, 'color');
	g.wire(envelope, 'out', waved, 'phase');
	return { ...g.doc(), ...PARTICLES };
}

function calSeed(): ShaderGraphDoc {
	const g = graphBuilder({
		id: 'calSeed',
		name: 'Calibration: seeds',
		phase: 'emphasis',
		durationMs: 1200,
	});
	const seed = g.node('seed');
	const hash = g.node('hash1');
	const pixel = g.node('unpremultiply');
	const turn = g.node('hueShift');
	const join = g.node('premultiply');
	const out = g.node('output');
	g.wire(seed, 'out', hash, 'x');
	g.wire(pixel, 'rgb', turn, 'rgb');
	g.wire(hash, 'out', turn, 'turns');
	g.wire(turn, 'out', join, 'rgb');
	g.wire(pixel, 'alpha', join, 'alpha');
	g.wire(join, 'out', out, 'color');
	return { ...g.doc(), ...PARTICLES };
}

function calParity(): ShaderGraphDoc {
	const g = graphBuilder({
		id: 'calParity',
		name: 'Calibration: Output alone',
		phase: 'emphasis',
		durationMs: 1200,
	});
	g.node('output');
	return { ...g.doc(), ...PARTICLES };
}

export const CALIBRATION_GRAPHS: readonly ShaderGraphDoc[] = [
	calLight(),
	calBudget(),
	calSeed(),
	calParity(),
];
