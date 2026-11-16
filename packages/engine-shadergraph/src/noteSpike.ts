/**
 * THE BANKNOTE SPIKE (Invisible Shader Graph step 8f, `docs/design/shader-graph-3d-particles.md` §5
 * "Flexible sheets", interim): a particle material that traces a bent paper sheet inside each
 * particle's quad, built from admin-only Custom GLSL nodes (8c) on the 8d particle seam, as the coin
 * (`coinSpike.ts`) and the gem (`gemSpike.ts`) are. §5's real answer is a vertex stage (a subdivided
 * quad bent per vertex); this traces the bend per pixel instead, so it needs no engine change and
 * cannot fold sharply or crumple.
 *
 * The particle's frame holds three tiles of art, read through Sample at a UV:
 *
 *     front            rows 0–223 of a 512 page (16 : 7, the note's own aspect)
 *     back             rows 224–447, drawn as seen when the note is turned over end to end
 *     matcap | (spare) rows 448–511: a 64 px matcap at the left
 *
 * The note, in its own space: x along its length (−1…1, the frame's half side), y across it
 * (±{@link NOTE_SPIKE_HALF_WIDTH}), flat at z = 0 facing the viewer. Two bends, mixed by the params:
 *  - **Curl**: the sheet rolled onto part of a cylinder, round its short axis (Curl along: Length)
 *    or its long one (Width), the curvature breathing per note at Flutter. The cylinder touches the
 *    note's middle, so the roll keeps lengths: the arc from the middle is the art's coordinate.
 *  - **Wave**: a gentle height h(x, y, t) along the bent sheet's normal, a wave running down the
 *    length at Wave speed and a ripple across it at Flutter.
 *
 * Five nodes, because one node may do at most 1,024 units of work a pixel and 600 tokens
 * (`customGlsl.ts`):
 *  - **Ray**: the pixel's ray (orthographic, into the screen) turned into note space, on an axis and
 *    at an angle from the particle's seed and seconds × Spin, as the coin's; started where it
 *    enters the bounding sphere. Also each note's curvature and wave phases at this moment.
 *  - **Curl**: the ray against the cylinder, exactly: both crossings, written so a curvature near
 *    zero is a plane rather than a huge radius (`k|p|² − 2z`, never `R²`).
 *  - **Sheet ×2**: one crossing each, nearer first. With a wave, the surface is where the distance
 *    to the cylinder equals h; a few steps across the window the wave can move the crossing
 *    bracket it, and the step that changes sign is cut where it crosses. A crossing outside the
 *    note's edges (past half a pixel) is no hit, so the second node sees the sheet behind.
 *  - **Shade**: the bent normal (the cylinder's, tilted by the wave's slope), the side that faces
 *    the viewer picks the front or back tile, and the matcap lights the art at that normal. The
 *    art's alpha cuts the outline (a rounded corner, a torn edge).
 *
 * `compile.fixture.ts` holds it to the Custom GLSL caps; `shader-compile` links it on WebGL1 and
 * WebGL2; `scripts/playtest/particle-material-play.mjs --note` plays it in a game build.
 */

import type { ElementFxParamSpec } from 'constants-shared/elementFx';

import { CUSTOM_GLSL } from './customGlsl';
import { graphBuilder } from './reference';
import {
	SHADER_MADE_FOR_PARTICLES,
	type CustomGlslDefinition,
	type ShaderGraphDoc,
	type SubgraphPort,
} from './types';

/** The note's half width, its half length being 1: the front tile's 512 × 224, 16 : 7 ≈ 2.29 : 1. */
export const NOTE_SPIKE_HALF_WIDTH = 0.4375;
/** The largest Wave amplitude, a share of the half length. */
export const NOTE_SPIKE_MAX_WAVE = 0.1;
/**
 * The bounding sphere's radius: a curl keeps lengths, so no point of the sheet is farther from its
 * middle than a flat corner (√(1 + 0.4375²) = 1.0915); the wave moves it at most 1.35 × its
 * amplitude along the normal.
 */
export const NOTE_SPIKE_BOUND = Math.hypot(1, NOTE_SPIKE_HALF_WIDTH) + 1.35 * NOTE_SPIKE_MAX_WAVE;
/** The room past the frame, a share of its side: the sphere past the half side, and a pixel. */
export const NOTE_SPIKE_PADDING = 0.13;
/** Steps across the window the wave can move a crossing, in each Sheet node. */
export const NOTE_SPIKE_STEPS = 8;

const W = NOTE_SPIKE_HALF_WIDTH.toFixed(4);

const RAY = `// The pixel's ray into the screen, turned into note space (x along it, y across, z = 0 flat),
// started where it enters the bounding sphere; this note's curvature and wave phases now.
float h1 = efxHash1(seed);
float h2 = efxHash1(seed + 31.7);
float h3 = efxHash1(seed + 47.3);
float h4 = efxHash1(seed + 59.9);
vec3 k = vec3(efxHash1(seed + 7.3), efxHash1(seed + 13.1), efxHash1(seed + 23.9)) * 2.0 - 1.0;
k = normalize(k + vec3(0.001, 0.0, 0.0));
float a = 6.2832 * (h1 + secs * spin * (0.6 + 0.8 * h2));
float ca = cos(a);
float sa = sin(a);
vec2 c = (uv - 0.5) * 2.0;
float rr = ${(NOTE_SPIKE_BOUND * NOTE_SPIKE_BOUND).toFixed(4)};
float cc = dot(c, c);
vec3 o = vec3(c, -2.0);
vec3 d = vec3(0.0, 0.0, 1.0);
origin = o * ca - cross(k, o) * sa + k * dot(k, o) * (1.0 - ca);
dir = d * ca - cross(k, d) * sa + k * dot(k, d) * (1.0 - ca);
float chord = sqrt(max(rr - cc, 0.0));
origin += dir * (2.0 - chord);
span = vec2(cc > rr ? -1.0 : 2.0 * chord, 2.0 / max(efxSize().x, 1.0));
float flap = 6.2832 * secs * flutter * (0.6 + 0.8 * h4);
float breathe = 0.5 + 0.5 * sin(6.2832 * h3 + flap);
float len = along > 0.5 ? ${W} : 1.0;
bend = vec4(max(curl * 1.5708 * mix(0.3, 1.0, breathe) / len, 0.01), len, 0.0, along);
float run = 6.2832 * secs * speed;
wave = vec4(min(amp, ${NOTE_SPIKE_MAX_WAVE.toFixed(2)}), 6.2832 * h4 - run, 6.2832 * h2 - flap * 1.3, 0.0);
hit = vec4(-1.0, 0.0, 0.0, 9.0);
turn = vec4(k, a);`;

const CURL = `// Both crossings of the ray and the cylinder the note is rolled on (axis across the bend,
// through (0, 0, 1/k)): k t²|d|² + 2t(k o·d − d.z) + k|o|² − 2 o.z = 0, a plane as k goes to 0.
float kap = bend.x;
vec3 q = bend.w > 0.5 ? origin.yxz : origin;
vec3 e = bend.w > 0.5 ? dir.yxz : dir;
float qa = kap * dot(e.xz, e.xz);
float qb = kap * dot(q.xz, e.xz) - e.z;
float qc = kap * dot(q.xz, q.xz) - 2.0 * q.z;
float disc = qb * qb - qa * qc;
cands = vec2(-1.0);
if (span.x > 0.0 && disc >= 0.0) {
	float r = -(qb + (qb < 0.0 ? -1.0 : 1.0) * sqrt(disc));
	float t1 = abs(qa) > 0.000001 ? r / qa : 99.0;
	float t2 = abs(r) > 0.000001 ? qc / r : 99.0;
	cands = vec2(min(t1, t2), max(t1, t2));
}`;

/** One crossing (`cands.x` or `.y`), bent by the wave, kept if inside the note's edges. */
const sheet = (
	which: 'x' | 'y',
) => `// The crossing at cands.${which}, moved by the wave: the steps across the window it can move
// in bracket where the distance to the cylinder meets h; cut there. Kept inside the edges.
float t0 = cands.${which};
if (hit.x < 0.0 && t0 >= 0.0 && t0 <= span.x) {
	float kap = bend.x;
	vec3 o3 = bend.w > 0.5 ? origin.yxz : origin;
	vec3 e3 = bend.w > 0.5 ? dir.yxz : dir;
	vec3 q0 = o3 + e3 * t0;
	float slope = abs(dot(e3.xz, vec2(kap * q0.x, kap * q0.z - 1.0)));
	float dl = wave.x * 1.4 / max(slope, 0.25);
	vec4 found = vec4(-1.0, 0.0, 0.0, 0.0);
	float ta = t0;
	float ga = 0.0;
	vec2 sa = vec2(0.0);
	for (int i = 0; i <= ${NOTE_SPIKE_STEPS}; i++) {
		float tb = t0 + dl * (float(i) * ${(2 / NOTE_SPIKE_STEPS).toFixed(4)} - 1.0);
		vec3 p = o3 + e3 * tb;
		float w = kap * dot(p.xz, p.xz) - 2.0 * p.z;
		float dist = w / (1.0 + sqrt(max(1.0 + kap * w, 0.0)));
		vec2 sb = vec2(atan(kap * p.x, 1.0 - kap * p.z) / kap, p.y);
		sb = bend.w > 0.5 ? sb.yx : sb;
		float gb = dist - wave.x * (sin(3.0 * sb.x + wave.y) + 0.35 * sin(5.0 * sb.y + 2.0 * sb.x + wave.z));
		if (i == ${NOTE_SPIKE_STEPS / 2}) found = vec4(tb, sb, 0.0);
		if (i > 0 && ga * gb <= 0.0) {
			float f = abs(ga - gb) > 0.0000001 ? ga / (ga - gb) : 0.0;
			found = vec4(mix(ta, tb, f), mix(sa, sb, f), 0.0);
			break;
		}
		ta = tb;
		ga = gb;
		sa = sb;
	}
	float beyond = max(abs(found.y) - 1.0, abs(found.z) - ${W});
	if (found.x >= 0.0 && beyond < 0.5 * span.y) hit = vec4(found.xyz, beyond);
}`;

const SHADE = `// The bent normal; the side facing the viewer picks the tile; lit by the matcap at the normal.
float th = bend.x * (bend.w > 0.5 ? hit.z : hit.y);
float c2 = cos(5.0 * hit.z + 2.0 * hit.y + wave.z);
vec2 dh = wave.x * vec2(3.0 * cos(3.0 * hit.y + wave.y) + 0.7 * c2, 1.75 * c2);
dh = bend.w > 0.5 ? dh.yx : dh;
vec3 n = vec3(sin(th), 0.0, -cos(th)) - dh.x * vec3(cos(th), 0.0, sin(th)) - vec3(0.0, dh.y, 0.0);
n = normalize(bend.w > 0.5 ? n.yxz : n);
bool back = dot(n, dir) > 0.0;
n = back ? -n : n;
vec2 f = vec2(hit.y * 0.5 + 0.5, hit.z * ${(0.5 / NOTE_SPIKE_HALF_WIDTH).toFixed(4)} + 0.5);
f.x = back ? 1.0 - f.x : f.x;
vec2 u = vec2(0.002 + clamp(f.x, 0.0, 1.0) * 0.996, (back ? 0.4375 : 0.0) + (0.004 + clamp(f.y, 0.0, 1.0) * 0.992) * 0.4375);
vec4 art = efxSample(efxFromUnit(u));
vec3 k = turn.xyz;
float ca = cos(turn.w);
float sa = sin(turn.w);
n = n * ca + cross(k, n) * sa + k * dot(k, n) * (1.0 - ca);
vec2 m = vec2(0.0, 0.875) + (0.04 + clamp(n.xy * 0.5 + 0.5, 0.0, 1.0) * 0.92) * 0.125;
vec3 lit = art.rgb * efxSample(efxFromUnit(m)).rgb * 2.0;
float cover = hit.x < 0.0 ? 0.0 : clamp(0.5 - hit.w / span.y, 0.0, 1.0);
color = vec4(lit * cover, art.a * cover);`;

const num = (
	id: string,
	label: string,
	value: number,
	min: number,
	max: number,
	step: number,
	note: string,
): ElementFxParamSpec => ({ id, label, kind: 'number', default: value, min, max, step, note });

const PARAMS: ElementFxParamSpec[] = [
	{
		id: 'along',
		label: 'Curl along',
		kind: 'choice',
		default: 'length',
		options: ['length', 'width'],
		note: 'Length: the note rolls end to end. Width: side to side, a gutter',
	},
	num('curl', 'Curl', 0.6, 0, 1.8, 0.05, '1 turns each end a quarter turn; varied per note'),
	num('amp', 'Wave amplitude', 0.05, 0, NOTE_SPIKE_MAX_WAVE, 0.005, 'Share of the half length'),
	num('speed', 'Wave speed', 0.8, 0, 4, 0.05, 'Waves a second running down the note'),
	num('flutter', 'Flutter', 1, 0, 4, 0.05, 'How fast the curl breathes and the ripple runs'),
	num('spin', 'Spin', 0.4, 0, 4, 0.05, 'Turns a second, varied per note'),
];

const port = (id: string, label: string, type: SubgraphPort['type']): SubgraphPort => ({
	id,
	label,
	type,
});
/** A port a param feeds, by the param's id. */
const paramPort = (id: string): SubgraphPort => {
	const spec = PARAMS.find((p) => p.id === id);
	if (!spec) throw new Error(`note spike: no param ${id}`);
	return {
		id,
		label: spec.label,
		type: 'float',
		default: spec.kind === 'number' ? spec.default : 0,
	};
};
const RAY_PORTS = [
	port('origin', 'Origin', 'vec3'),
	port('dir', 'Direction', 'vec3'),
	port('span', 'Span', 'vec2'),
	port('bend', 'Bend', 'vec4'),
	port('wave', 'Wave', 'vec4'),
];
const CANDS = port('cands', 'Crossings', 'vec2');
const HIT = port('hit', 'Hit', 'vec4');

function noteSpike(): ShaderGraphDoc {
	const g = graphBuilder({
		id: 'calNote',
		name: 'Banknote (3D spike)',
		description:
			'A paper banknote traced in each particle, curling, waving and tumbling. The art is three tiles in the frame: front, back (each 512 × 224), and a 64 px matcap at the bottom left.',
		phase: 'emphasis',
		durationMs: 2000,
		padding: NOTE_SPIKE_PADDING,
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
	const ray = custom('ray', {
		code: RAY,
		inputs: [
			port('uv', 'UV', 'vec2'),
			port('seed', 'Seed', 'float'),
			port('secs', 'Seconds', 'float'),
			...PARAMS.map((p) => paramPort(p.id)),
		],
		outputs: [...RAY_PORTS, HIT, port('turn', 'Turn', 'vec4')],
	});
	g.wire(uv, 'out', ray, 'uv');
	g.wire(seed, 'out', ray, 'seed');
	g.wire(time, 'seconds', ray, 'secs');
	for (const p of PARAMS) g.wire(params[p.id], 'out', ray, p.id);

	const curl = custom('curl', {
		code: CURL,
		inputs: [RAY_PORTS[0], RAY_PORTS[1], RAY_PORTS[2], RAY_PORTS[3]],
		outputs: [CANDS],
	});
	for (const p of RAY_PORTS.slice(0, 4)) g.wire(ray, p.id, curl, p.id);

	let last = ray;
	for (const which of ['x', 'y'] as const) {
		const node = custom(`sheet${which === 'x' ? 1 : 2}`, {
			code: sheet(which),
			inputs: [...RAY_PORTS, CANDS, HIT],
			outputs: [HIT],
		});
		for (const p of RAY_PORTS) g.wire(ray, p.id, node, p.id);
		g.wire(curl, 'cands', node, 'cands');
		g.wire(last, 'hit', node, 'hit');
		last = node;
	}

	const shade = custom('shade', {
		code: SHADE,
		inputs: [
			RAY_PORTS[1],
			RAY_PORTS[2],
			RAY_PORTS[3],
			RAY_PORTS[4],
			HIT,
			port('turn', 'Turn', 'vec4'),
		],
		outputs: [port('color', 'Colour', 'vec4')],
	});
	for (const p of RAY_PORTS.slice(1)) g.wire(ray, p.id, shade, p.id);
	g.wire(last, 'hit', shade, 'hit');
	g.wire(ray, 'turn', shade, 'turn');
	const out = g.node('output');
	g.wire(shade, 'color', out, 'color');
	return { ...doc, madeFor: SHADER_MADE_FOR_PARTICLES };
}

/** The banknote spike's graph, made for particles. */
export const NOTE_SPIKE_GRAPH: ShaderGraphDoc = noteSpike();
