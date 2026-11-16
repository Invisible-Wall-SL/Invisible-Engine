/**
 * THE COIN SPIKE (Invisible Shader Graph step 8f.1, `docs/design/shader-graph-3d-particles.md` §4):
 * a particle material that ray-traces a solid coin inside each particle's quad, built from
 * admin-only Custom GLSL nodes (8c) on the 8d particle seam, to learn whether a traced solid reads
 * well and fits the particle budget before the trace becomes regular nodes (8f step 2).
 *
 * The particle's frame holds four tiles of art, read through Sample at a UV:
 *
 *     front  | back
 *     -------+-------
 *     edge   | matcap
 *
 * The coin, in its own space: radius 1 (the frame's half side), faces at ±thickness/2, an edge
 * rounded with radius bevel × half the thickness, each face sunk inside a raised rim. Its distance
 * is a rounded cylinder less two shallow discs. Five nodes, because one node may do at most 1,024
 * units of work a pixel and 600 tokens (`customGlsl.ts`):
 *  - **Ray**: the pixel's ray (orthographic, into the screen) turned into coin space. The coin turns
 *    about an axis drawn from the particle's seed, at an angle from its seconds × Spin; the
 *    particle's own 2D rotation applies on top, as the quad turns. The ray starts where it enters
 *    the coin's bounding sphere; one outside it is a miss at once.
 *  - **March ×2**: {@link COIN_SPIKE_STEPS} sphere-tracing rounds each, carrying the ray's state
 *    (distance along it, nearest approach, hit) through an input and output of one name.
 *  - **Normal**: four reads of the distance about the hit (a tetrahedron), and the cover: 1 on a
 *    hit, falling off over a pixel past the silhouette from the ray's nearest approach.
 *  - **Shade**: picks the tile (front, back, or the edge strip by its angle round and across),
 *    bends the normal by the tile's relief (two more reads), turns it to the screen and lights the
 *    art by the matcap tile at that normal.
 *
 * `compile.fixture.ts` holds it to the Custom GLSL caps; `shader-compile` links it on WebGL1 and
 * WebGL2; `scripts/playtest/particle-material-play.mjs --coin` plays it in a game build.
 */

import { CUSTOM_GLSL } from './customGlsl';
import { graphBuilder } from './reference';
import {
	SHADER_MADE_FOR_PARTICLES,
	type CustomGlslDefinition,
	type ShaderGraphDoc,
	type SubgraphPort,
} from './types';

/** The largest Thickness param. */
export const COIN_SPIKE_MAX_THICKNESS = 0.6;
/**
 * The room the quad needs past the frame, a share of its side: the bounding sphere at the largest
 * thickness reaches sqrt(1 + 0.3²) = 1.044 of the half side (0.022 of the side), plus the pixel-wide
 * soft edge, which fits in the rest for a coin of 56 device px across or more.
 */
export const COIN_SPIKE_PADDING = 0.04;
/** Sphere-tracing rounds in each of the two march nodes. */
export const COIN_SPIKE_STEPS = 12;

/** The coin's distance at `q`, into `s` (the march and normal nodes share it word for word). */
const DISTANCE = `float r = length(q.xy);
	vec2 w = vec2(r - 1.0 + b, abs(q.z) - h + b);
	float s = min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - b;
	s = max(s, -max(r - 1.0 + rim, h - rimHeight * h - abs(q.z)));`;

const SHAPE = `float h = thick * 0.5;
float b = clamp(bevel, 0.0, 1.0) * h;`;

const RAY = `// The pixel's ray into the screen, turned into coin space (radius 1, axis z), started where it
// enters the bounding sphere, so the march's distances stay small (precision on a phone).
float h = thick * 0.5;
float h1 = efxHash1(seed);
float h2 = efxHash1(seed + 31.7);
vec3 k = vec3(efxHash1(seed + 7.3), efxHash1(seed + 13.1), efxHash1(seed + 23.9)) * 2.0 - 1.0;
k = normalize(vec3(k.xy, k.z * 0.4) + vec3(0.001, 0.0, 0.0));
float a = 6.2832 * (h1 + secs * spin * (0.6 + 0.8 * h2));
float ca = cos(a);
float sa = sin(a);
vec2 c = (uv - 0.5) * 2.0;
float rr = 1.0 + h * h;
float cc = dot(c, c);
vec3 o = vec3(c, -2.0);
vec3 d = vec3(0.0, 0.0, 1.0);
origin = o * ca - cross(k, o) * sa + k * dot(k, o) * (1.0 - ca);
dir = d * ca - cross(k, d) * sa + k * dot(k, d) * (1.0 - ca);
float px = 2.0 / max(efxSize().x, 1.0);
float reach = sqrt(rr) + px;
bool outside = cc > reach * reach;
float chord = sqrt(max(rr - cc, 0.0));
origin += dir * (2.0 - chord);
span = vec2(2.0 * chord, px);
state = vec3(0.0, 9.0, outside ? -1.0 : 0.0);
point = origin;
turn = vec4(k, a);`;

const MARCH = `// Sphere-trace on from \`state\` (along, nearest, 1 hit / -1 missed).
${SHAPE}
for (int i = 0; i < ${COIN_SPIKE_STEPS}; i++) {
	if (state.z != 0.0 || state.x > span.x) break;
	vec3 q = origin + dir * state.x;
	${DISTANCE}
	if (s < state.y) {
		state.y = s;
		point = q;
	}
	state.z = s < 0.001 ? 1.0 : 0.0;
	state.x += max(s, 0.002);
}`;

const NORMAL = `// The distance read about the hit, at a tetrahedron's corners.
${SHAPE}
normal = vec3(0.0, 0.0, 1e-5);
for (int i = 0; i < 4; i++) {
	float j = float(i);
	float ez = mod(j, 2.0) * 2.0 - 1.0;
	float ey = step(1.5, j) * 2.0 - 1.0;
	vec3 e = vec3(ey * ez, ey, ez);
	vec3 q = point + e * 0.002;
	${DISTANCE}
	normal += e * s;
}
normal = normalize(normal);
cover = state.z > 0.5 ? 1.0 : (state.z < -0.5 ? 0.0 : clamp(1.0 - state.y / span.y, 0.0, 1.0));`;

const SHADE = `// Tiles in the frame: front | back over edge | matcap.
float h = max(thick * 0.5, 0.001);
float r = length(point.xy);
bool edge = abs(normal.z) < 0.6 && r > 1.0 - rim * 0.5;
bool back = point.z > 0.0;
vec2 f = point.xy * 0.5 + 0.5;
f.x = back ? 1.0 - f.x : f.x;
vec2 g = vec2(0.5 - atan(point.y, point.x) / 6.2832, clamp(point.z / h * 0.5 + 0.5, 0.0, 1.0));
vec2 at = edge ? g : f;
vec2 tile = edge ? vec2(0.0, 0.5) : vec2(back ? 0.5 : 0.0, 0.0);
vec2 u = tile + (0.01 + clamp(at, 0.0, 1.0) * 0.98) * 0.5;
vec4 art = efxSample(efxFromUnit(u));
float e0 = efxLuma(art.rgb);
float ex = efxLuma(efxSample(efxFromUnit(u + vec2(0.004, 0.0))).rgb);
float ey = efxLuma(efxSample(efxFromUnit(u + vec2(0.0, 0.004))).rgb);
vec3 t1 = edge ? vec3(point.y, -point.x, 0.0) / max(r, 0.001) : vec3(back ? -1.0 : 1.0, 0.0, 0.0);
vec3 t2 = edge ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
vec3 n = normalize(normal + relief * ((e0 - ex) * t1 + (e0 - ey) * t2));
vec3 k = turn.xyz;
float ca = cos(turn.w);
float sa = sin(turn.w);
n = n * ca + cross(k, n) * sa + k * dot(k, n) * (1.0 - ca);
vec2 m = vec2(0.5, 0.5) + (0.01 + clamp(n.xy * 0.5 + 0.5, 0.0, 1.0) * 0.98) * 0.5;
vec3 lit = art.rgb * efxSample(efxFromUnit(m)).rgb * 2.0;
color = vec4(lit * cover, cover);`;

const num = (
	id: string,
	label: string,
	value: number,
	min: number,
	max: number,
	step: number,
	note: string,
) => ({ id, label, kind: 'number' as const, default: value, min, max, step, note });

const PARAMS = [
	num('thickness', 'Thickness', 0.16, 0.04, COIN_SPIKE_MAX_THICKNESS, 0.01, 'Height ÷ radius'),
	num('rim', 'Rim width', 0.14, 0.02, 0.4, 0.01, 'Share of the radius'),
	num('rimHeight', 'Rim height', 0.3, 0, 0.8, 0.05, 'Share of half the thickness'),
	num('bevel', 'Bevel', 0.6, 0, 1, 0.05, 'Share of half the thickness'),
	num('spin', 'Spin', 0.6, 0, 4, 0.05, 'Turns a second, varied per coin'),
	num('relief', 'Relief', 2, 0, 8, 0.1, 'How much the tiles’ light and dark raise the face'),
];

const port = (id: string, label: string, type: SubgraphPort['type']): SubgraphPort => ({
	id,
	label,
	type,
});
/** A port a param feeds, by the param's id. */
const paramPort = (id: string): SubgraphPort => {
	const spec = PARAMS.find((p) => p.id === id);
	if (!spec) throw new Error(`coin spike: no param ${id}`);
	return {
		id: id === 'thickness' ? 'thick' : id,
		label: spec.label,
		type: 'float',
		default: spec.default,
	};
};
const SHAPE_PORTS = ['thickness', 'rim', 'rimHeight', 'bevel'].map(paramPort);
const RAY_PORTS = [
	port('origin', 'Origin', 'vec3'),
	port('dir', 'Direction', 'vec3'),
	port('span', 'Span', 'vec2'),
];
const STATE_PORTS = [port('state', 'State', 'vec3'), port('point', 'Point', 'vec3')];

function coinSpike(): ShaderGraphDoc {
	const g = graphBuilder({
		id: 'calCoin',
		name: 'Coin (3D spike)',
		description:
			'A solid coin traced in each particle, tumbling on its own axis. The art is four tiles in the frame: front, back (top), edge strip, matcap (bottom).',
		phase: 'emphasis',
		durationMs: 2000,
		padding: COIN_SPIKE_PADDING,
		params: PARAMS,
	});
	const params = Object.fromEntries(PARAMS.map((p) => [p.id, g.node('param', { param: p.id })]));
	const uv = g.node('uv');
	const seed = g.node('seed');
	const time = g.node('time');
	const doc = g.doc();
	const custom = (id: string, glsl: CustomGlslDefinition): string => {
		doc.nodes.push({ id, type: CUSTOM_GLSL, x: doc.nodes.length * 180, y: 0, glsl });
		return id;
	};
	const wireParams = (to: string, ids: string[]) => {
		for (const id of ids) g.wire(params[id], 'out', to, paramPort(id).id);
	};
	const ray = custom('ray', {
		code: RAY,
		inputs: [
			port('uv', 'UV', 'vec2'),
			port('seed', 'Seed', 'float'),
			port('secs', 'Seconds', 'float'),
			paramPort('thickness'),
			paramPort('spin'),
		],
		outputs: [...RAY_PORTS, ...STATE_PORTS, port('turn', 'Turn', 'vec4')],
	});
	g.wire(uv, 'out', ray, 'uv');
	g.wire(seed, 'out', ray, 'seed');
	g.wire(time, 'seconds', ray, 'secs');
	wireParams(ray, ['thickness', 'spin']);
	let last = ray;
	for (const id of ['march1', 'march2']) {
		const march = custom(id, {
			code: MARCH,
			inputs: [...RAY_PORTS, ...STATE_PORTS, ...SHAPE_PORTS],
			outputs: STATE_PORTS,
		});
		for (const p of RAY_PORTS) g.wire(ray, p.id, march, p.id);
		for (const p of STATE_PORTS) g.wire(last, p.id, march, p.id);
		wireParams(march, ['thickness', 'rim', 'rimHeight', 'bevel']);
		last = march;
	}
	const normal = custom('normal', {
		code: NORMAL,
		inputs: [port('span', 'Span', 'vec2'), ...STATE_PORTS, ...SHAPE_PORTS],
		outputs: [port('normal', 'Normal', 'vec3'), port('cover', 'Cover', 'float')],
	});
	g.wire(ray, 'span', normal, 'span');
	for (const p of STATE_PORTS) g.wire(last, p.id, normal, p.id);
	wireParams(normal, ['thickness', 'rim', 'rimHeight', 'bevel']);
	const shade = custom('shade', {
		code: SHADE,
		inputs: [
			port('point', 'Point', 'vec3'),
			port('normal', 'Normal', 'vec3'),
			port('cover', 'Cover', 'float'),
			port('turn', 'Turn', 'vec4'),
			...['thickness', 'rim', 'relief'].map(paramPort),
		],
		outputs: [port('color', 'Colour', 'vec4')],
	});
	g.wire(last, 'point', shade, 'point');
	g.wire(normal, 'normal', shade, 'normal');
	g.wire(normal, 'cover', shade, 'cover');
	g.wire(ray, 'turn', shade, 'turn');
	wireParams(shade, ['thickness', 'rim', 'relief']);
	const out = g.node('output');
	g.wire(shade, 'color', out, 'color');
	return { ...doc, madeFor: SHADER_MADE_FOR_PARTICLES };
}

/** The coin spike's graph, made for particles. */
export const COIN_SPIKE_GRAPH: ShaderGraphDoc = coinSpike();
