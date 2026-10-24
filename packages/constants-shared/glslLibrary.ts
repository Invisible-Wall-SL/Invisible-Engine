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
	efxPerspective: `
// Where the element, as a plane turned in 3D and seen in perspective, is read at px: turned rot.x
// radians about X, then rot.y about Y, lifted rot.z element sizes toward the eye, which is \`focal\`
// element sizes away (sizes of its larger side). .xy where the ray from the eye through px lands on
// it (the far side shows the element mirrored, as a coin's would), .z how squarely the plane faces
// the eye (1 face on, 0 edge on), .w 1 where the ray meets it and 0 where it misses.
vec4 efxPerspective(vec2 px, vec3 rot, float focal)
{
    vec2 size = efxSize();
    float m = max(size.x, size.y);
    vec2 p = px - efxCenter();
    float f = focal * m;
    mat3 r = efxRotY(rot.y) * efxRotX(rot.x);
    vec3 n = r * vec3(0.0, 0.0, 1.0);
    vec3 eye = vec3(0.0, 0.0, -f);
    vec3 dir = vec3(p, f);
    vec3 p0 = vec3(0.0, 0.0, -rot.z * m);
    float denom = dot(n, dir);
    if (abs(denom) < 1e-4) return vec4(px, 0.0, 0.0);
    float lambda = dot(n, p0 - eye) / denom;
    if (lambda <= 0.0) return vec4(px, 0.0, 0.0);
    vec3 local = efxTranspose(r) * (eye + lambda * dir - p0);
    return vec4(efxCenter() + local.xy, abs(n.z), 1.0);
}`,
	efxSphericonOnFace: `
// t when o + t d lies on the sphericon's half-cone face round axis a (0 <= p.a <= h) inside the half
// where side * p.z >= 0, else -1.
float efxSphericonOnFace(vec3 o, vec3 d, vec3 a, float side, float h, float t)
{
    vec3 p = o + t * d;
    float s = dot(p, a);
    return t > 0.0 && s >= 0.0 && s <= h && side * p.z >= 0.0 ? t : -1.0;
}`,
	efxSphericonFace: `
// The nearer hit of the ray o + t d on that face, or -1.
float efxSphericonFace(vec3 o, vec3 d, vec3 a, float side, float h)
{
    float so = dot(o, a);
    float sd = dot(d, a);
    float qa = dot(d, d) - 2.0 * sd * sd;
    float qb = 2.0 * dot(o, d) - 4.0 * so * sd + 2.0 * h * sd;
    float qc = dot(o, o) - 2.0 * so * so + 2.0 * h * so - h * h;
    // A ray along the cone's slope meets it once.
    if (abs(qa) < 1e-6) return abs(qb) < 1e-6 ? -1.0 : efxSphericonOnFace(o, d, a, side, h, -qc / qb);
    float disc = qb * qb - 4.0 * qa * qc;
    if (disc < 0.0) return -1.0;
    float root = sqrt(disc);
    float t0 = (-qb - root) / (2.0 * qa);
    float t1 = (-qb + root) / (2.0 * qa);
    float first = efxSphericonOnFace(o, d, a, side, h, min(t0, t1));
    return first > 0.0 ? first : efxSphericonOnFace(o, d, a, side, h, max(t0, t1));
}`,
	efxSphericonHit: `
// A SPHERICON: a double cone (axis X, half-length \`len\` of the element's smaller side) whose lower
// half is turned a quarter about Z, so the halves meet on an S-shaped seam; rolled spin.x radians
// about X, swung spin.y about Y, then tilted spin.z towards the viewer. Where the straight-on ray
// through px first meets it: .xyz the point in the solid's own frame, .w the face it is on (1 / 2
// the upper half's, round +X / −X; 3 / 4 the lower half's, round +Y / −Y; 0 none).
vec4 efxSphericonHit(vec2 px, vec3 spin, float len)
{
    vec2 size = efxSize();
    float h = max(len * min(size.x, size.y), 1.0);
    mat3 r = efxRotX(spin.z) * efxRotY(spin.y) * efxRotX(spin.x);
    mat3 inv = efxTranspose(r);
    vec3 o = inv * vec3(px - efxCenter(), -4.0 * h);
    vec3 d = inv * vec3(0.0, 0.0, 1.0);
    float best = -1.0;
    float face = 0.0;
    vec3 axes[4];
    axes[0] = vec3(1.0, 0.0, 0.0);
    axes[1] = vec3(-1.0, 0.0, 0.0);
    axes[2] = vec3(0.0, 1.0, 0.0);
    axes[3] = vec3(0.0, -1.0, 0.0);
    for (int i = 0; i < 4; i++)
    {
        float side = i < 2 ? 1.0 : -1.0;
        float hit = efxSphericonFace(o, d, axes[i], side, h);
        if (hit > 0.0 && (best < 0.0 || hit < best))
        {
            best = hit;
            face = float(i + 1);
        }
    }
    return best > 0.0 ? vec4(o + best * d, face) : vec4(0.0);
}`,
	efxSphericonUv: `
// Where a point on the sphericon (efxSphericonHit) shows the element, in its unit space: each face
// wraps the whole element round its axis, upright both unturned and rolled half a turn.
vec2 efxSphericonUv(vec4 hit, float len)
{
    if (hit.w < 0.5) return vec2(0.0);
    vec2 size = efxSize();
    float h = max(len * min(size.x, size.y), 1.0);
    vec3 p = hit.xyz;
    vec2 uv = hit.w < 2.5
        ? vec2(p.x / h * 0.5 + 0.5, atan(p.z, p.y) / PI)
        : vec2(atan(-p.z, -p.x) / PI, p.y / h * 0.5 + 0.5);
    return clamp(uv, 0.0, 1.0);
}`,
	efxSphericonNormal: `
// The sphericon's surface direction at a point on it (efxSphericonHit), turned as the solid is (+z
// towards the viewer), for lighting.
vec3 efxSphericonNormal(vec4 hit, vec3 spin, float len)
{
    vec2 size = efxSize();
    float h = max(len * min(size.x, size.y), 1.0);
    vec3 axis = hit.w < 1.5 ? vec3(1.0, 0.0, 0.0)
        : hit.w < 2.5 ? vec3(-1.0, 0.0, 0.0)
        : hit.w < 3.5 ? vec3(0.0, 1.0, 0.0)
        : vec3(0.0, -1.0, 0.0);
    mat3 r = efxRotX(spin.z) * efxRotY(spin.y) * efxRotX(spin.x);
    float s = dot(hit.xyz, axis);
    vec3 n = normalize(r * (hit.xyz - (2.0 * s - h) * axis));
    return vec3(n.xy, -n.z);
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
	efxSinPi: `
// sin(π x) to about 1e-7, for timing worked out per pixel: a GPU's own sin can be 1e-4 off (the
// software renderer's is), which an angle of a few turns built on it shows.
float efxSinPi(float x)
{
    float r = x - 2.0 * floor(0.5 * x + 0.5);
    r = r > 0.5 ? 1.0 - r : r < -0.5 ? -1.0 - r : r;
    float a = PI * r;
    float a2 = a * a;
    return a * (1.0 + a2 * (-1.0 / 6.0 + a2 * (1.0 / 120.0 + a2 * (-1.0 / 5040.0
        + a2 * (1.0 / 362880.0 - a2 / 39916800.0)))));
}`,
	efxBounce: `
// Bounce arcs over t (0…1): \`count\` hops (1…5), each 0.45 the height of the last, over the first
// 85% of the play, landing at the end. .x the height (0…1 of the first hop's), .y how hard it is
// pressed into the ground (0…1, peaking at each landing). The Bounce 3D timing.
vec2 efxBounce(float t, float count)
{
    float n = clamp(floor(count + 0.5), 1.0, 5.0);
    if (t >= 0.85) return vec2(0.0, sqrt(pow(0.45, n - 1.0)) * (1.0 - smoothstep(0.85, 1.0, t)));
    float total = 0.0;
    for (int k = 0; k < 5; k++)
    {
        if (float(k) >= n) break;
        total += sqrt(pow(0.45, float(k)));
    }
    float at = t / 0.85 * total;
    float last = 1.0;
    for (int k = 0; k < 5; k++)
    {
        float height = pow(0.45, float(k));
        float width = sqrt(height);
        if (at <= width || float(k) >= n - 1.0)
        {
            float u = clamp(at / width, 0.0, 1.0);
            float landing = u > 0.88 ? (u - 0.88) / 0.12 : 0.0;
            float takeoff = k > 0 && u < 0.12 ? 1.0 - u / 0.12 : 0.0;
            return vec2(height * 4.0 * u * (1.0 - u), landing * width + takeoff * sqrt(last));
        }
        at -= width;
        last = height;
    }
    return vec2(0.0);
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
	efxTwist: `
// Where a swirl about the centre reads the pixel at px: turned \`angle\` radians at the centre,
// fading to none \`radius\` half-diagonals out.
vec2 efxTwist(vec2 px, float angle, float radius)
{
    vec2 c = efxCenter();
    vec2 p = px - c;
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
    return c + p;
}`,
	efxBulge: `
// Where a lens about the centre reads the pixel at px: \`strength\` −1…1 (out, or pinched in),
// \`radius\` in half-diagonals.
vec2 efxBulge(vec2 px, float strength, float radius)
{
    vec2 c = efxCenter();
    vec2 p = px - c;
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
    return c + p;
}`,
	efxRipple: `
// A shock ring \`at\` diagonals out and \`width\` element sizes wide, pushing outward by \`amount\`
// element sizes: .xy where it reads the pixel at px, .z how far px is on the ring (0 off it, 1 at
// its middle).
vec3 efxRipple(vec2 px, float at, float width, float amount)
{
    vec2 c = efxCenter();
    vec2 p = px - c;
    float d = length(p);
    vec2 size = efxSize();
    float m = max(size.x, size.y);
    float k = (d - at * length(size)) / max(width * m, 1.0);
    if (d < 0.001 || abs(k) >= 1.0) return vec3(px, 0.0);
    float push = sin(k * PI) * (1.0 - k * k) * amount * m;
    return vec3(px - (p / d) * push, 1.0 - abs(k));
}`,
	efxWave: `
// Where a travelling wave reads the pixel at px: rows shift sideways (axis < 0.5) or columns up and
// down, by \`amplitude\` element sizes, \`wavelength\` element sizes apart, \`phase\` in cycles.
vec2 efxWave(vec2 px, float amplitude, float wavelength, float phase, float axis)
{
    vec2 size = efxSize();
    vec2 u = efxToUnit(px);
    float wl = max(wavelength, 0.001);
    if (axis < 0.5) return px - vec2(amplitude * size.x * sin(2.0 * PI * (u.y / wl - phase)), 0.0);
    return px - vec2(0.0, amplitude * size.y * sin(2.0 * PI * (u.x / wl - phase)));
}`,
	efxFlag: `
// Where a flag pinned at the element's left edge reads the pixel at px: columns rise and fall in a
// wave that grows to the right, by \`amplitude\` element heights, \`wavelength\` element widths apart,
// \`phase\` in cycles. .z the light on its folds (1 none).
vec3 efxFlag(vec2 px, float amplitude, float wavelength, float phase)
{
    float u = efxToUnit(px).x;
    float pin = clamp(u, 0.0, 1.0);
    float arg = 2.0 * PI * (u / max(wavelength, 0.001) - phase);
    vec2 at = px - vec2(0.0, amplitude * efxSize().y * pin * sin(arg));
    return vec3(at, 1.0 + 0.3 * pin * cos(arg) * clamp(amplitude * 12.0, 0.0, 1.0));
}`,
	efxPageBack: `
// The back of a page (premultiplied): the colour greyed and dimmed.
vec4 efxPageBack(vec4 color)
{
    float grey = efxLuma(color.rgb);
    color.rgb = mix(color.rgb, vec3(grey), 0.45) * 0.72 + 0.12 * color.a;
    return color;
}`,
	efxCurl: `
// The element at px with a corner (\`corner\` 0 or 1 each way, in its unit space) peeled back along
// the diagonal, rolling over a cylinder \`radius\` diagonals across whose axis has come \`reach\`
// diagonals in from the corner. The flap's back shows the element mirrored and dimmed, and the page
// darkens under the roll.
vec4 efxCurl(vec2 px, vec2 corner, float reach, float radius)
{
    vec4 page = efxSample(px);
    float diagonal = length(efxSize());
    float travelled = reach * diagonal;
    if (travelled <= 0.0) return page;
    vec2 at = efxFromUnit(corner);
    vec2 d = normalize(efxCenter() - at);
    float r = max(radius * diagonal, 0.5);
    float x = travelled - dot(px - at, d);
    if (x > r) return vec4(0.0);
    if (x >= 0.0)
    {
        float a = asin(clamp(x / r, -1.0, 1.0));
        vec2 qBack = px + d * (x - r * (PI - a));
        vec4 flapBack = efxInside(qBack) ? efxSample(qBack) : vec4(0.0);
        if (flapBack.a > 0.004) return efxPageBack(flapBack);
        vec2 qFront = px + d * (x - r * a);
        vec4 front = efxInside(qFront) ? efxSample(qFront) : vec4(0.0);
        front.rgb *= mix(1.0, 0.6, x / r);
        return front;
    }
    vec2 q = px + d * (2.0 * x - PI * r);
    vec4 flap = efxInside(q) ? efxPageBack(efxSample(q)) : vec4(0.0);
    float shadow = 1.0 - 0.4 * smoothstep(-1.5 * r, 0.0, x);
    vec4 under = vec4(page.rgb * shadow, page.a);
    return flap + under * (1.0 - flap.a);
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
    return normalize(vec3(-strength * efxReliefSlope(px), 1.0));
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
	efxReliefSlope: `
// How steeply the element's relief (efxHeight) climbs at px, read 1.5 px either side: .x rightward,
// .y downward. Petrify carves with it; efxReliefNormal turns it into a surface direction.
vec2 efxReliefSlope(vec2 px)
{
    float e = 1.5;
    return vec2(
        efxHeight(px + vec2(e, 0.0)) - efxHeight(px - vec2(e, 0.0)),
        efxHeight(px + vec2(0.0, e)) - efxHeight(px - vec2(0.0, e)));
}`,
	efxRim: `
// A point on the element's edge, \`a\` 0…4 once round it from the top left, in its unit space.
vec2 efxRim(float a)
{
    a = mod(a, 4.0);
    return a < 1.0 ? vec2(a, 0.0)
        : a < 2.0 ? vec2(1.0, a - 1.0)
        : a < 3.0 ? vec2(3.0 - a, 1.0)
        : vec2(0.0, 4.0 - a);
}`,
	efxArcs: `
// Up to six jagged arcs crackling across the element between points on its edge (the electrocute
// look), \`count\` of them, picked by \`seed\` and struck anew each time \`strike\` (a whole number)
// changes. At p (pixels from the element's top left, \`size\` its size in pixels): .x their white-hot
// cores, .y their halos, each summed over the arcs.
vec2 efxArcs(vec2 p, vec2 size, float count, float seed, float strike)
{
    float big = max(size.x, size.y);
    float core = 0.0;
    float halo = 0.0;
    for (int i = 0; i < 6; i++)
    {
        if (float(i) >= count) break;
        float s = seed + float(i) * 17.31 + strike * 3.7;
        vec2 a = efxRim(efxHash1(s) * 4.0) * size;
        vec2 b = efxRim(efxHash1(s + 1.7) * 2.0 + efxHash1(s) * 4.0 + 1.0) * size;
        vec2 ab = b - a;
        float len = max(length(ab), 1.0);
        vec2 dir = ab / len;
        float along = dot(p - a, dir);
        if (along < 0.0 || along > len) continue;
        float k = along / len;
        float jag = (efxNoise1(k * 9.0 + s) - 0.5) * 0.9 + (efxNoise1(k * 23.0 + s * 2.0) - 0.5) * 0.35;
        float d = abs(dot(p - a, vec2(-dir.y, dir.x)) - jag * 0.22 * big * sin(PI * k));
        core += exp(-d / max(1.0, 0.006 * big));
        halo += exp(-d / (0.03 * big));
    }
    return vec2(core, halo);
}`,
	efxSparkle: `
// A four-pointed star twinkling in some cells of a grid (q in cells, about half of them), each on
// its own beat \`time\` seconds in, placed by \`seed\`: .x the star's shape, .y how brightly it
// twinkles now (0…1). Their product is the sparkle (the gold look's).
vec2 efxSparkle(vec2 q, float seed, float time)
{
    vec2 cell = floor(q);
    vec2 at = 0.35 + 0.3 * vec2(efxHash(cell + seed), efxHash(cell + seed + 7.0));
    float beat = max(0.0, sin((time * 1.3 + efxHash(cell + 3.3)) * 6.2832));
    float tw = pow(beat, 6.0) * step(0.55, efxHash(cell + 9.1));
    vec2 d = abs(fract(q) - at);
    float arm = 0.34 * tw + 0.001;
    float star = (1.0 - smoothstep(0.0, 0.025, d.x)) * (1.0 - smoothstep(0.0, arm, d.y))
        + (1.0 - smoothstep(0.0, 0.025, d.y)) * (1.0 - smoothstep(0.0, arm, d.x))
        + (1.0 - smoothstep(0.0, 0.07, length(d))) * tw;
    return vec2(star, tw);
}`,
};

/**
 * The functions the pass header (`HEADER` in pixi-svelte's `elementFx/shaders.ts`) declares in front
 * of every pass, which a pass calls beside the library's entries. `check:element-fx` holds this list
 * to what the header declares.
 */
export const EFX_HEADER_FUNCTIONS = [
	'efxPx',
	'efxArea',
	'efxSize',
	'efxOrigin',
	'efxCenter',
	'efxToUnit',
	'efxFromUnit',
	'efxSample',
	'efxInside',
] as const;

const live = (code: string): string =>
	code.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** The library entries `code` calls (comments aside), in the order it first calls them. */
const calls = (code: string, self?: string): string[] => {
	const names: string[] = [];
	for (const [, name] of live(code).matchAll(/\b(efx[A-Za-z0-9]+)\s*\(/g)) {
		if (name !== self && name in EFX_GLSL && !names.includes(name)) names.push(name);
	}
	return names;
};

/**
 * The `efx…` functions `code` calls that neither this library nor the pass header has: what this
 * version cannot link. A pass compiled by a newer Shader Graph, calling an entry added since, shows
 * here, and the custom-effect registry leaves it out rather than hand the GPU a shader that fails.
 */
export function unknownEfxCalls(code: string): string[] {
	const header: readonly string[] = EFX_HEADER_FUNCTIONS;
	const names = [...live(code).matchAll(/\b(efx[A-Z]\w*)\s*\(/g)].map(([, name]) => name);
	return [...new Set(names)].filter(
		(name) => !Object.hasOwn(EFX_GLSL, name) && !header.includes(name),
	);
}

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
