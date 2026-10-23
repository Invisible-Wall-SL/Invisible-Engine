/**
 * The Element FX GLSL LIBRARY: the building blocks the Element FX shader passes
 * (`pixi-svelte/src/lib/elementFx/shaders.ts`) share, one GLSL function each. A pass calls them by
 * name and `linkGlsl` puts in front of it exactly the entries it calls, and the entries those call,
 * each once and before its callers.
 *
 * Step 1 of the Invisible Shader Graph (`docs/design/invisible-shader-graph.md` §7): the
 * primitives the built-in effects each carried a private copy of — the 2-D and 1-D hashes and
 * value noises, the cellular noise, the relief height, the alpha outline, luminance, the "front
 * from a side" (with four numberings of the sides), the glint and band, and the rotations and
 * transpose the 3D passes wrote out. The graph's nodes emit these same functions, so a node and the
 * built-in it was read off are one implementation. Dependency-free, so the graph package and its
 * compile checks run without Pixi.
 *
 * Every entry is written for GLSL ES 1.00 (WebGL1) and may call the pass header's own helpers
 * (`efxSample`, `efxSize`, …), which precede it.
 */

/** Where something spreading over the element starts, in `efxAway`'s numbering. */
export const EFX_SIDES = ['bottom', 'top', 'edges', 'center', 'left', 'right'] as const;

export type EfxSide = (typeof EFX_SIDES)[number];

/** `name` as `efxAway`'s side number, or `fallback`'s when it names no side. */
export const efxSide = (name: string, fallback: EfxSide): number => {
	const at = (EFX_SIDES as readonly string[]).indexOf(name);
	return at < 0 ? EFX_SIDES.indexOf(fallback) : at;
};

export const EFX_GLSL: Readonly<Record<string, string>> = {
	efxHash: `
// A 2-D point hashed to 0…1, without sin (it holds up for large inputs).
float efxHash(vec2 p)
{
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}`,
	efxNoise: `
// Smooth value noise, 0…1, over efxHash.
float efxNoise(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 w = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(efxHash(i), efxHash(i + vec2(1.0, 0.0)), w.x),
        mix(efxHash(i + vec2(0.0, 1.0)), efxHash(i + vec2(1.0, 1.0)), w.x),
        w.y);
}`,
	efxHash1: `
// A number hashed to 0…1.
float efxHash1(float n)
{
    return fract(sin(n * 12.9898 + 78.233) * 43758.5453);
}`,
	efxNoise1: `
// Smooth value noise along a line, 0…1, over efxHash1.
float efxNoise1(float x)
{
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(efxHash1(i), efxHash1(i + 1.0), f);
}`,
	efxHash2: `
// A 2-D point hashed to a point in the unit square.
vec2 efxHash2(vec2 p)
{
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}`,
	efxCells: `
// Cellular noise: the distance to the nearest cell's centre, to the next nearest, and the nearest
// cell's own value, 0…1. \`seed\` moves the centres, \`idSeed\` the values.
vec3 efxCells(vec2 p, float seed, float idSeed)
{
    vec2 cell = floor(p);
    vec2 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    float id = 0.0;
    for (int j = -1; j <= 1; j++)
    {
        for (int i = -1; i <= 1; i++)
        {
            vec2 g = vec2(float(i), float(j));
            float d = length(g + efxHash2(cell + g + seed) - f);
            if (d < d1)
            {
                d2 = d1;
                d1 = d;
                id = efxHash(cell + g + idSeed);
            }
            else if (d < d2)
            {
                d2 = d;
            }
        }
    }
    return vec3(d1, d2, id);
}`,
	efxLuma: `
// How bright a colour reads.
float efxLuma(vec3 rgb)
{
    return dot(rgb, vec3(0.299, 0.587, 0.114));
}`,
	efxHeight: `
// The element's height at px, for a relief: its outline, raised where the art is light.
float efxHeight(vec2 px)
{
    vec4 s = efxSample(px);
    return 0.6 * s.a + 0.4 * efxLuma(s.rgb);
}`,
	efxEdge: `
// How much px is on the element's outline: its alpha above the lowest of its four neighbours r px
// away.
float efxEdge(vec2 px, float alpha, float r)
{
    return alpha - min(
        min(efxSample(px + vec2(r, 0.0)).a, efxSample(px - vec2(r, 0.0)).a),
        min(efxSample(px + vec2(0.0, r)).a, efxSample(px - vec2(0.0, r)).a));
}`,
	efxEdgeDistance: `
// 0 on the element's edge, 1 at its middle (u in its unit space).
float efxEdgeDistance(vec2 u)
{
    return 2.0 * min(min(u.x, 1.0 - u.x), min(u.y, 1.0 - u.y));
}`,
	efxAway: `
// How far something spreading over the element from \`side\` has come to reach u, 0…1: 0 from the
// bottom, 1 the top, 2 the edges, 3 the centre, 4 the left, 5 the right (EFX_SIDES).
float efxAway(vec2 u, float side)
{
    float away = side < 0.5 ? 1.0 - u.y
        : side < 1.5 ? u.y
        : side < 2.5 ? efxEdgeDistance(u)
        : side < 3.5 ? length(u - 0.5) * 1.4142
        : side < 4.5 ? u.x
        : 1.0 - u.x;
    return clamp(away, 0.0, 1.0);
}`,
	efxBand: `
// 1 at \`at\`, falling smoothly to 0 by \`width\` either side of it.
float efxBand(float x, float at, float width)
{
    return 1.0 - smoothstep(0.0, width, abs(x - at));
}`,
	efxGlint: `
// A glint sweeping diagonally across the element (u in its unit space), \`at\` 0…1 along its way.
float efxGlint(vec2 u, float at, float width)
{
    return efxBand(u.x + 0.6 * u.y, at * 1.6, width);
}`,
	efxRotX: `
// A turn of \`a\` radians about X.
mat3 efxRotX(float a)
{
    float c = cos(a);
    float s = sin(a);
    return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}`,
	efxRotY: `
// A turn of \`a\` radians about Y.
mat3 efxRotY(float a)
{
    float c = cos(a);
    float s = sin(a);
    return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}`,
	efxTranspose: `
// m transposed (the inverse of a rotation), written out: GLSL ES 1.00 has no transpose().
mat3 efxTranspose(mat3 m)
{
    return mat3(m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]);
}`,
	efxFbm: `
// Fractal value noise, 0…1: up to 5 octaves of efxNoise, each finer and half as strong.
float efxFbm(vec2 p, float octaves)
{
    float sum = 0.0;
    float weight = 0.5;
    float total = 0.0;
    for (int i = 0; i < 5; i++)
    {
        if (float(i) >= octaves) break;
        sum += weight * efxNoise(p);
        total += weight;
        p = p * 2.03 + 7.1;
        weight *= 0.5;
    }
    return sum / max(total, 0.0001);
}`,
	efxHold: `
// In, held, out over t (0…1): up to 1 over the first (1 − hold) / 2, held, then back to 0 over the
// last (1 − hold) / 2. The freeze, petrify and gold timing.
float efxHold(float t, float hold)
{
    float span = max((1.0 - hold) * 0.5, 0.0001);
    if (t < span)
    {
        float k = t / span;
        return 1.0 - (1.0 - k) * (1.0 - k);
    }
    if (t <= 1.0 - span) return 1.0;
    return 1.0 - efxEaseInOut((t - (1.0 - span)) / span);
}`,
	efxEaseInOut: `
// Eased in and out (cubic), 0…1.
float efxEaseInOut(float t)
{
    t = clamp(t, 0.0, 1.0);
    return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(2.0 - 2.0 * t, 3.0) / 2.0;
}`,
	efxEaseOutBack: `
// Eased out past 1 by about overshoot / 10, settling at 1.
float efxEaseOutBack(float t, float overshoot)
{
    float k = clamp(t, 0.0, 1.0) - 1.0;
    return 1.0 + (overshoot + 1.0) * k * k * k + overshoot * k * k;
}`,
	efxRotateUv: `
// The point a turn of \`a\` radians about the element's centre draws at u (u in its unit space).
vec2 efxRotateUv(vec2 u, float a)
{
    vec2 c = efxCenter();
    vec2 p = efxFromUnit(u) - c;
    float co = cos(a);
    float s = sin(a);
    return efxToUnit(c + vec2(p.x * co - p.y * s, p.x * s + p.y * co));
}`,
	efxTwistUv: `
// The point a swirl about the centre draws at u: turned \`angle\` radians at the centre, fading to
// none \`radius\` half-diagonals out.
vec2 efxTwistUv(vec2 u, float angle, float radius)
{
    vec2 c = efxCenter();
    vec2 p = efxFromUnit(u) - c;
    float d = length(p);
    float r = max(radius * 0.5 * length(efxSize()), 1.0);
    if (d < r)
    {
        float k = (r - d) / r;
        float a = -angle * k * k;
        float s = sin(a);
        float co = cos(a);
        p = vec2(p.x * co - p.y * s, p.x * s + p.y * co);
    }
    return efxToUnit(c + p);
}`,
	efxBulgeUv: `
// The point a lens about the centre draws at u: \`strength\` −1…1 (out, or pinched in), \`radius\` in
// half-diagonals.
vec2 efxBulgeUv(vec2 u, float strength, float radius)
{
    vec2 c = efxCenter();
    vec2 p = efxFromUnit(u) - c;
    float d = length(p);
    float r = max(radius * 0.5 * length(efxSize()), 1.0);
    if (d < r && d > 0.0)
    {
        float percent = d / r;
        if (strength > 0.0)
        {
            p *= mix(1.0, smoothstep(0.0, r / d, percent), strength * 0.75);
        }
        else if (strength < 0.0)
        {
            p *= mix(1.0, pow(percent, 1.0 + strength * 0.75) * r / d, 1.0 - percent);
        }
    }
    return efxToUnit(c + p);
}`,
	efxRippleUv: `
// A shock ring \`at\` diagonals out and \`width\` element sizes wide, pushing outward by \`amount\`
// element sizes: .xy the point it draws at u, .z how far u is on the ring, 0…1.
vec3 efxRippleUv(vec2 u, float at, float width, float amount)
{
    vec2 c = efxCenter();
    vec2 px = efxFromUnit(u);
    vec2 p = px - c;
    float d = length(p);
    vec2 size = efxSize();
    float m = max(size.x, size.y);
    float k = (d - at * length(size)) / max(width * m, 1.0);
    if (d < 0.001 || abs(k) >= 1.0) return vec3(u, 0.0);
    float push = sin(k * PI) * (1.0 - k * k) * amount * m;
    return vec3(efxToUnit(px - (p / d) * push), 1.0 - abs(k));
}`,
	efxWaveUv: `
// The point a travelling wave draws at u: rows shift sideways (axis < 0.5) or columns up and down,
// by \`amplitude\` element sizes, \`wavelength\` element sizes apart, \`phase\` in cycles.
vec2 efxWaveUv(vec2 u, float amplitude, float wavelength, float phase, float axis)
{
    float wl = max(wavelength, 0.001);
    return axis < 0.5
        ? vec2(u.x - amplitude * sin(2.0 * PI * (u.y / wl - phase)), u.y)
        : vec2(u.x, u.y - amplitude * sin(2.0 * PI * (u.x / wl - phase)));
}`,
	efxHueShift: `
// rgb turned \`turns\` round the colour wheel, keeping its brightness (in YIQ).
vec3 efxHueShift(vec3 rgb, float turns)
{
    mat3 toYiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
    mat3 toRgb = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
    vec3 yiq = toYiq * rgb;
    float a = turns * 2.0 * PI;
    float c = cos(a);
    float s = sin(a);
    yiq = vec3(yiq.x, yiq.y * c - yiq.z * s, yiq.y * s + yiq.z * c);
    return clamp(toRgb * yiq, 0.0, 1.0);
}`,
	efxReliefNormal: `
// The element's relief at px as a surface normal (+z towards the viewer): efxHeight's slope 1.5 px
// either side, steeper with \`strength\`.
vec3 efxReliefNormal(vec2 px, float strength)
{
    float e = 1.5;
    vec2 slope = vec2(
        efxHeight(px + vec2(e, 0.0)) - efxHeight(px - vec2(e, 0.0)),
        efxHeight(px + vec2(0.0, e)) - efxHeight(px - vec2(0.0, e)));
    return normalize(vec3(-strength * slope, 1.0));
}`,
	efxMetalRamp: `
// A metal's shade t, 0…1: a deep version of \`base\`, \`base\`, then near white.
vec3 efxMetalRamp(vec3 base, float t)
{
    vec3 deep = base * base * 0.35;
    vec3 pale = mix(base, vec3(1.0), 0.75);
    return t < 0.5 ? mix(deep, base, t * 2.0) : mix(base, pale, t * 2.0 - 1.0);
}`,
	efxLight: `
// How lit a surface facing \`normal\` is from \`light\` (+z towards the viewer): .x diffuse, .y a
// highlight as sharp as \`shininess\`.
vec2 efxLight(vec3 normal, vec3 light, float shininess)
{
    vec3 l = normalize(light);
    float diffuse = max(dot(normal, l), 0.0);
    float spec = pow(max(dot(reflect(-l, normal), vec3(0.0, 0.0, 1.0)), 0.0), max(shininess, 1.0));
    return vec2(diffuse, spec);
}`,
};

/** The library entries `code` calls (comments aside), in the order it first calls them. */
const calls = (code: string, self?: string): string[] => {
	const names: string[] = [];
	const live = code.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
	for (const [, name] of live.matchAll(/\b(efx[A-Za-z0-9]+)\s*\(/g)) {
		if (name !== self && name in EFX_GLSL && !names.includes(name)) names.push(name);
	}
	return names;
};

/**
 * `body` with the library entries it calls in front of it, theirs first: each entry once, only
 * those it reaches. Throws on entries that call each other, which GLSL could not compile anyway.
 */
export function linkGlsl(body: string): string {
	const ordered: string[] = [];
	const visiting: string[] = [];
	const visit = (name: string): void => {
		if (ordered.includes(name)) return;
		if (visiting.includes(name)) {
			throw new Error(`glslLibrary: ${[...visiting, name].join(' → ')} call each other`);
		}
		visiting.push(name);
		for (const dep of calls(EFX_GLSL[name], name)) visit(dep);
		visiting.pop();
		ordered.push(name);
	};
	for (const name of calls(body)) visit(name);
	return ordered.map((name) => EFX_GLSL[name]).join('\n') + '\n' + body;
}
