/**
 * THE GEM SPIKE (Invisible Shader Graph step 8f.1, `docs/design/shader-graph-3d-particles.md` §4
 * "Gem"): a particle material that traces a cut gem inside each particle's quad, built from
 * admin-only Custom GLSL nodes (8c) on the 8d particle seam, as the coin spike (`coinSpike.ts`) is.
 *
 * The particle's frame holds two tiles of art, read through Sample at a UV:
 *
 *     outside | inside
 *     --------+--------
 *     (spare) | (spare)
 *
 * `outside` is what the facets reflect and `inside` what they refract, each a sphere map of
 * directions (the centre faces the viewer). The bottom row is not read.
 *
 * The gem, in its own space: girdle radius 1 round the z axis, the table at z = Crown, the culet at
 * z = −Pavilion. It is a convex solid, so it is the space inside a set of planes, and a ray through
 * it enters at the last plane it crosses inward and leaves at the first it crosses outward. The
 * planes come in seven families, each a ring of eight round the axis (an index 8f + i names one;
 * 56 is the table):
 *
 *     0 bezel           at φ        crown, from the girdle to the table's edge
 *     1 star            at φ + π/8  crown, a shallow corner at the table
 *     2 upper girdle    at φ + π/8  crown, a steep corner at the girdle
 *     3 girdle          at φ        the band
 *     4 girdle          at φ + π/8  the band's other eight sides
 *     5 pavilion main   at φ        from the girdle to the culet
 *     6 lower girdle    at φ + π/8  pavilion, a steep corner at the girdle
 *
 * The Cartoon cut drops the φ + π/8 families: an octagon of 8 bezels and 8 pavilion facets under a
 * table, the slot-game gem. Brilliant keeps all 57.
 *
 * Eight nodes, because one node may do at most 1,024 units of work a pixel and 600 tokens
 * (`customGlsl.ts`):
 *  - **Ray**: the pixel's ray (orthographic, into the screen) turned into gem space, on an axis and
 *    at an angle from the particle's seed and seconds × Spin, as the coin's; a ray outside the
 *    bounding sphere is a miss at once.
 *  - **Enter ×2**: the φ ring (families 0, 3, 5 as one vec3 of planes), then the φ + π/8 ring
 *    (1, 2, 4, 6 as a vec4) and the table. A ring's planes share one projection of the ray a round,
 *    which is what brings 57 planes inside the caps. Out: the ray's entering and leaving distance
 *    and the plane it enters by, carried through an input and output of one name.
 *  - **Facet**: the entry facet's normal, the hit, the ray refracted in, the cover (1 inside,
 *    falling off over a pixel past the silhouette).
 *  - **Exit ×2**: the same planes, for the refracted ray: where it leaves and by which facet.
 *  - **Back**: the exit facet's normal, turned to the screen with the ray inside.
 *  - **Shade**: one reflection (the `outside` tile, by Fresnel), one refraction out of the exit
 *    facet with Fire splitting red, green and blue (each read off the `inside` tile; a ray held in
 *    by total internal reflection reflects once instead), the Tint deepening with the path inside,
 *    and a glint where a facet's reflection lines up with the light.
 *
 * `compile.fixture.ts` holds it to the Custom GLSL caps; `shader-compile` links it on WebGL1 and
 * WebGL2; `scripts/playtest/particle-material-play.mjs --gem` plays it in a game build.
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

/**
 * The gem's bounding radius in its own units: the Cartoon cut's octagon reaches 1 / cos(π/8) = 1.082
 * at the girdle. The frame's half side is this, so the gem's girdle is 0.92 of it.
 */
export const GEM_SPIKE_BOUND = 1.1;
/** The room past the frame for the pixel-wide soft edge, a share of its side. */
export const GEM_SPIKE_PADDING = 0.02;

const RAY = `// The pixel's ray into the screen, turned into gem space (girdle radius 1, table up z, facing
// the viewer at rest), started where it enters the bounding sphere.
float h1 = efxHash1(seed);
float h2 = efxHash1(seed + 31.7);
vec3 k = vec3(efxHash1(seed + 7.3), efxHash1(seed + 13.1), efxHash1(seed + 23.9)) * 2.0 - 1.0;
k = normalize(k + vec3(0.001, 0.0, 0.0));
float a = 6.2832 * (h1 + secs * spin * (0.6 + 0.8 * h2));
float ca = cos(a);
float sa = sin(a);
vec2 c = (uv - 0.5) * ${(2 * GEM_SPIKE_BOUND).toFixed(1)};
float rr = ${(GEM_SPIKE_BOUND * GEM_SPIKE_BOUND).toFixed(2)};
float cc = dot(c, c);
vec3 o = vec3(c.x, -c.y, 2.0);
vec3 d = vec3(0.0, 0.0, -1.0);
origin = o * ca - cross(k, o) * sa + k * dot(k, o) * (1.0 - ca);
dir = d * ca - cross(k, d) * sa + k * dot(k, d) * (1.0 - ca);
float px = ${(2 * GEM_SPIKE_BOUND).toFixed(1)} / max(efxSize().x, 1.0);
float chord = sqrt(max(rr - cc, 0.0));
origin += dir * (2.0 - chord);
span = vec2(cc > rr ? -1.0 : 1.0, px);
hit = vec3(-9.0, 9.0, -1.0);
turn = vec4(k, a);`;

/** π/8: where the second ring of each pair starts. */
const HALF = 0.3927;

/**
 * Each family's plane at angle 0 as (radial, axial, distance), in GLSL over the shape's locals
 * (`TRACE_LOCALS`), and the angle its ring starts at. The normals are not unit: a distance along a
 * ray is a ratio, so they need not be. `drop` (100 on the Cartoon cut) moves a plane out of reach.
 */
const FAMILIES: readonly { plane: [string, string, string]; at: number }[] = [
	{ plane: ['cg', 'tt', 'cg + tt * girdle'], at: 0 },
	{ plane: ['0.5 * cg', 'tt', '0.5 * cg * table + tt * crown + drop'], at: HALF },
	{ plane: ['1.15 * cg', 'tt', '1.15 * cg + tt * girdle + drop'], at: HALF },
	{ plane: ['1.0', '0.0', '1.0'], at: 0 },
	{ plane: ['1.0', '0.0', '1.0 + drop'], at: HALF },
	{ plane: ['pg', '-1.0', 'pavilion'], at: 0 },
	{ plane: ['1.04 * pg', '-1.0', '1.04 * pg + girdle + drop'], at: HALF },
];
/** The families traced together, by the angle their rings start at: one ring of projections each. */
const RINGS = [
	FAMILIES.flatMap((f, i) => (f.at ? [] : [i])),
	FAMILIES.flatMap((f, i) => (f.at ? [i] : [])),
];
/** The table's index, after the 7 × 8 ring planes. */
const TABLE = FAMILIES.length * 8;

const TRACE_LOCALS = `float cg = crown - girdle;
float pg = pavilion - girdle;
float tt = 1.0 - table;
float drop = cut * 100.0;`;

/** Ring `ring`'s families as vectors (`nx`, `nz`, `nd`) and their indexes ÷ 8 (`code`). */
const ringPlanes = (ring: number) => {
	const fs = RINGS[ring];
	const v = `vec${fs.length}`;
	const of = (c: number) => `${v}(${fs.map((f) => FAMILIES[f].plane[c]).join(', ')})`;
	const near = (op: string, x: string) =>
		fs.slice(1).reduce((acc, _, i) => `${op}(${acc}, ${x}.${'xyzw'[i + 1]})`, `${x}.x`);
	const at = FAMILIES[fs[0]].at;
	return {
		v,
		near,
		code: `${TRACE_LOCALS}
${v} nx = ${of(0)};
${v} nz = ${of(1)};
${v} nd = ${of(2)};
${v} code = ${v}(${fs.map((f) => (f * 8).toFixed(1)).join(', ')});
mat2 turn8 = mat2(0.7071, 0.7071, -0.7071, 0.7071);
vec2 az = vec2(${Math.cos(at).toFixed(4)}, ${Math.sin(at).toFixed(4)});`,
	};
};

/** Ring `ring`'s planes (and the table, on the second) against the ray from outside. */
const enter = (ring: number) => {
	const { v, near, code } = ringPlanes(ring);
	return `// Entering: the last plane the ray crosses inward (hit.x, its index hit.z); leaving: the
// first it crosses outward (hit.y).
${code}
for (int i = 0; i < 8; i++) {
	${v} dn = nx * dot(az, dir.xy) + nz * dir.z;
	dn += step(abs(dn), ${v}(0.00001)) * 0.00002;
	${v} t = (nd - nx * dot(az, origin.xy) - nz * origin.z) / dn;
	${v} ent = mix(${v}(-9.0), t, step(dn, ${v}(0.0)));
	${v} lv = mix(${v}(9.0), t, step(${v}(0.0), dn));
	float m = ${near('max', 'ent')};
	if (m > hit.x) hit = vec3(m, hit.y, dot(step(${v}(m), ent), code) + float(i));
	hit.y = min(hit.y, ${near('min', 'lv')});
	az = turn8 * az;
}${
		ring
			? `
float dz = abs(dir.z) < 0.00001 ? 0.00001 : dir.z;
float tz = (crown - origin.z) / dz;
if (dz < 0.0 && tz > hit.x) hit = vec3(tz, hit.y, ${TABLE.toFixed(1)});
if (dz > 0.0) hit.y = min(hit.y, tz);`
			: ''
	}`;
};

/** Ring `ring`'s planes (and the table, on the second) against the refracted ray, from inside. */
const exit = (ring: number) => {
	const { v, near, code } = ringPlanes(ring);
	return `// Leaving: the first plane the ray inside crosses outward (leave.x, its index leave.y).${ring ? '' : '\nleave = vec2(9.0, -1.0);'}
${code}
for (int i = 0; i < 8; i++) {
	${v} dn = nx * dot(az, inner.xy) + nz * inner.z;
	${v} t = (nd - nx * dot(az, point.xy) - nz * point.z) / max(dn, ${v}(0.00001));
	${v} lv = mix(${v}(9.0), t, step(${v}(0.00001), dn));
	float m = ${near('min', 'lv')};
	if (m < leave.x) leave = vec2(m, dot(step(lv, ${v}(m)), code) + float(i));
	az = turn8 * az;
}${
		ring
			? `
float tz = (crown - point.z) / max(inner.z, 0.00001);
if (inner.z > 0.00001 && tz < leave.x) leave = vec2(tz, ${TABLE.toFixed(1)});`
			: ''
	}`;
};

/** The normal of plane `kk` (8f + i, or the table), into `nrm`. */
const NORMAL_OF = `float fi = floor(kk / 8.0 + 0.01);
${TRACE_LOCALS}
vec3 fam = vec3(1.0, 0.0, 0.0);
${FAMILIES.map((f, i) => `${i ? 'else ' : ''}if (fi < ${i}.5) fam = vec3(${f.plane[0]}, ${f.plane[1]}, ${f.at.toFixed(4)});`).join('\n')}
float ang = fam.z + (kk - fi * 8.0) * 0.7854;
vec3 nrm = kk > ${TABLE - 0.5} ? vec3(0.0, 0.0, 1.0) : normalize(vec3(fam.x * cos(ang), fam.x * sin(ang), fam.y));`;

const FACET = `// The facet the ray enters by, the hit on it and the ray refracted in.
float kk = hit.z;
${NORMAL_OF}
normal = nrm;
point = origin + dir * hit.x;
inner = refract(dir, nrm, 1.0 / ior);
float gap = hit.y - hit.x;
cover = span.x < 0.0 ? 0.0 : clamp(0.5 + gap / (2.0 * span.y), 0.0, 1.0);`;

/** `v` in gem space, turned to the screen (into `w`): the turn back, then the flip of the Ray. */
const toScreen = (v: string, w: string) =>
	`vec3 ${w} = ${v} * ca + cross(k, ${v}) * sa + k * dot(k, ${v}) * (1.0 - ca);
${w} = vec3(${w}.x, -${w}.y, -${w}.z);`;

const BACK = `// The facet the ray inside leaves by; it, the entry normal and the ray inside, on the screen.
float kk = leave.y;
${NORMAL_OF}
vec3 k = turn.xyz;
float ca = cos(turn.w);
float sa = sin(turn.w);
${toScreen('nrm', 'e')}
${toScreen('normal', 'f')}
${toScreen('inner', 'g')}
exitNormal = e;
normal = f;
inner = g;`;

const SHADE = `// One reflection off the entry facet, one refraction out of the exit facet with fire, tinted.
vec3 r = reflect(vec3(0.0, 0.0, 1.0), normal);
float cosi = clamp(-normal.z, 0.0, 1.0);
float f0 = (ior - 1.0) * (ior - 1.0) / ((ior + 1.0) * (ior + 1.0));
float fres = f0 + (1.0 - f0) * pow(1.0 - cosi, 5.0);
vec3 refl = efxSample(efxFromUnit(vec2(0.25, 0.25) + r.xy * 0.24)).rgb;
vec3 lit = vec3(0.0);
for (int ch = 0; ch < 3; ch++) {
	float j = float(ch);
	vec3 e = refract(inner, -exitNormal, ior + (j - 1.0) * fire);
	e = dot(e, e) < 0.01 ? reflect(inner, exitNormal) : e;
	vec3 s = efxSample(efxFromUnit(vec2(0.75, 0.25) + normalize(e).xy * 0.24)).rgb;
	lit += s * vec3(step(j, 0.5), step(0.5, j) * step(j, 1.5), step(1.5, j));
}
vec3 body = lit * pow(max(tint, vec3(0.001)), vec3(0.6 + depth * leave.x));
float flash = pow(max(dot(r, vec3(-0.42, -0.5, -0.76)), 0.0), sharpness);
float twinkle = 0.6 + 0.4 * sin(secs * 9.0 + efxHash1(leave.y + seed) * 6.2832);
vec3 rgb = body * (1.0 - fres) + refl * fres * 1.6 + glint * flash * twinkle;
color = vec4(rgb * cover, cover);`;

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
		id: 'cut',
		label: 'Cut',
		kind: 'choice',
		default: 'brilliant',
		options: ['brilliant', 'cartoon'],
		note: 'Brilliant: 57 facets. Cartoon: an octagon of 17',
	},
	{ id: 'tint', label: 'Tint', kind: 'color', default: '#ff2050', note: 'White for a diamond' },
	num('table', 'Table', 0.55, 0.3, 0.75, 0.01, 'The top’s radius, a share of the girdle’s'),
	num('crown', 'Crown', 0.33, 0.12, 0.6, 0.01, 'The table’s height over the middle'),
	num('pavilion', 'Pavilion', 0.86, 0.4, 0.95, 0.01, 'The point’s depth under the middle'),
	num('girdle', 'Girdle', 0.03, 0.005, 0.1, 0.005, 'Half the band’s height'),
	num('ior', 'Refraction', 2.0, 1.3, 2.6, 0.05, 'Index: 1.5 glass, 1.77 ruby, 2.42 diamond'),
	num('fire', 'Fire', 0.08, 0, 0.3, 0.01, 'How far red and blue split from green'),
	num('depth', 'Depth', 1.5, 0, 6, 0.1, 'How much the tint deepens with the path inside'),
	num('glint', 'Glint', 1.5, 0, 4, 0.05, 'A facet’s flash as it lines up with the light'),
	num('sharpness', 'Glint size', 60, 4, 400, 1, 'Higher: a shorter, sharper flash'),
	num('spin', 'Spin', 0.35, 0, 4, 0.05, 'Turns a second, varied per gem'),
];

const port = (id: string, label: string, type: SubgraphPort['type']): SubgraphPort => ({
	id,
	label,
	type,
});
/** A port a param feeds, by the param's id. */
const paramPort = (id: string): SubgraphPort => {
	const spec = PARAMS.find((p) => p.id === id);
	if (!spec) throw new Error(`gem spike: no param ${id}`);
	if (spec.kind === 'color') return { id, label: spec.label, type: 'vec3' };
	return {
		id,
		label: spec.label,
		type: 'float',
		default: spec.kind === 'number' ? spec.default : 0,
	};
};
const SHAPE = ['cut', 'table', 'crown', 'pavilion', 'girdle'];
const SHAPE_PORTS = SHAPE.map(paramPort);
const RAY_PORTS = [port('origin', 'Origin', 'vec3'), port('dir', 'Direction', 'vec3')];
const HIT = port('hit', 'Hit', 'vec3');
const INSIDE_PORTS = [port('point', 'Point', 'vec3'), port('inner', 'Inside', 'vec3')];
const OUT = port('leave', 'Exit', 'vec2');

function gemSpike(): ShaderGraphDoc {
	const g = graphBuilder({
		id: 'calGem',
		name: 'Gem (3D spike)',
		description:
			'A cut gem traced in each particle, tumbling on its own axis: one reflection, one refraction with fire, glints. The art is two tiles in the frame’s top half: what it reflects, what it refracts.',
		phase: 'emphasis',
		durationMs: 2000,
		padding: GEM_SPIKE_PADDING,
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
		for (const id of ids) g.wire(params[id], 'out', to, id);
	};
	const ray = custom('ray', {
		code: RAY,
		inputs: [
			port('uv', 'UV', 'vec2'),
			port('seed', 'Seed', 'float'),
			port('secs', 'Seconds', 'float'),
			paramPort('spin'),
		],
		outputs: [...RAY_PORTS, port('span', 'Span', 'vec2'), HIT, port('turn', 'Turn', 'vec4')],
	});
	g.wire(uv, 'out', ray, 'uv');
	g.wire(seed, 'out', ray, 'seed');
	g.wire(time, 'seconds', ray, 'secs');
	wireParams(ray, ['spin']);

	let last = ray;
	for (const ring of [0, 1]) {
		const node = custom(`enter${ring + 1}`, {
			code: enter(ring),
			inputs: [...RAY_PORTS, HIT, ...SHAPE_PORTS],
			outputs: [HIT],
		});
		for (const p of RAY_PORTS) g.wire(ray, p.id, node, p.id);
		g.wire(last, 'hit', node, 'hit');
		wireParams(node, SHAPE);
		last = node;
	}

	const facet = custom('facet', {
		code: FACET,
		inputs: [...RAY_PORTS, port('span', 'Span', 'vec2'), HIT, paramPort('ior'), ...SHAPE_PORTS],
		outputs: [port('normal', 'Normal', 'vec3'), ...INSIDE_PORTS, port('cover', 'Cover', 'float')],
	});
	for (const p of RAY_PORTS) g.wire(ray, p.id, facet, p.id);
	g.wire(ray, 'span', facet, 'span');
	g.wire(last, 'hit', facet, 'hit');
	wireParams(facet, ['ior', ...SHAPE]);

	let exitLast: string | undefined;
	for (const ring of [0, 1]) {
		const node = custom(`exit${ring + 1}`, {
			code: exit(ring),
			inputs: [...INSIDE_PORTS, ...(exitLast ? [OUT] : []), ...SHAPE_PORTS],
			outputs: [OUT],
		});
		for (const p of INSIDE_PORTS) g.wire(facet, p.id, node, p.id);
		if (exitLast) g.wire(exitLast, 'leave', node, 'leave');
		wireParams(node, SHAPE);
		exitLast = node;
	}
	if (!exitLast) throw new Error('gem spike: no exit node');

	const back = custom('back', {
		code: BACK,
		inputs: [
			OUT,
			port('normal', 'Normal', 'vec3'),
			port('inner', 'Inside', 'vec3'),
			port('turn', 'Turn', 'vec4'),
			...SHAPE_PORTS,
		],
		outputs: [
			port('exitNormal', 'Exit normal', 'vec3'),
			port('normal', 'Normal', 'vec3'),
			port('inner', 'Inside', 'vec3'),
		],
	});
	g.wire(exitLast, 'leave', back, 'leave');
	g.wire(facet, 'normal', back, 'normal');
	g.wire(facet, 'inner', back, 'inner');
	g.wire(ray, 'turn', back, 'turn');
	wireParams(back, SHAPE);

	const shade = custom('shade', {
		code: SHADE,
		inputs: [
			port('normal', 'Normal', 'vec3'),
			port('inner', 'Inside', 'vec3'),
			port('exitNormal', 'Exit normal', 'vec3'),
			OUT,
			port('cover', 'Cover', 'float'),
			port('seed', 'Seed', 'float'),
			port('secs', 'Seconds', 'float'),
			...['tint', 'ior', 'fire', 'depth', 'glint', 'sharpness'].map(paramPort),
		],
		outputs: [port('color', 'Colour', 'vec4')],
	});
	for (const p of ['normal', 'inner', 'exitNormal']) g.wire(back, p, shade, p);
	g.wire(exitLast, 'leave', shade, 'leave');
	g.wire(facet, 'cover', shade, 'cover');
	g.wire(seed, 'out', shade, 'seed');
	g.wire(time, 'seconds', shade, 'secs');
	wireParams(shade, ['tint', 'ior', 'fire', 'depth', 'glint', 'sharpness']);
	const outNode = g.node('output');
	g.wire(shade, 'color', outNode, 'color');
	return { ...doc, madeFor: SHADER_MADE_FOR_PARTICLES };
}

/** The gem spike's graph, made for particles. */
export const GEM_SPIKE_GRAPH: ShaderGraphDoc = gemSpike();
