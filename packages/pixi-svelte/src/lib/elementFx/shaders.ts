/**
 * The Element FX shader passes: one Pixi `Filter` per family, written for the WebGL renderer the
 * game forces (`InitialiseApplication`: `preference: 'webgl'`). A filter with no GPU program is
 * marked WebGL-only by Pixi and simply skipped on a WebGPU renderer, so the element draws plain
 * there rather than failing.
 *
 * WHERE THE ELEMENT IS INSIDE THE PASS. A filter sees the element rendered into a frame: the
 * element's `filterArea` (its box plus a margin, set by the runtime) mapped to the screen, with the
 * filters' total padding around it. `uElement` is the element's box as a share of that area and
 * `uPad` the padding, both written by the runtime, so every shader below can work in the element's
 * own coordinates (`efxToUnit` / `efxFromUnit`) in any pass of the stack and whatever the frame's
 * size. The mapping assumes the element is not rotated on screen; a rotated element still plays,
 * about its axis-aligned box.
 */

import { Filter, GlProgram } from 'pixi.js';

const VERTEX = `in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`;

const HEADER = `precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;
uniform vec4 uElement;
uniform float uPad;

const float PI = 3.14159265358979;

vec2 efxPx() { return vTextureCoord * uInputSize.xy; }
vec2 efxArea() { return max(uOutputFrame.zw - 2.0 * uPad, vec2(1.0)); }
vec2 efxSize() { return max(uElement.zw * efxArea(), vec2(1.0)); }
vec2 efxOrigin() { return uElement.xy * efxArea() + uPad; }
vec2 efxCenter() { return efxOrigin() + 0.5 * efxSize(); }
vec2 efxToUnit(vec2 px) { return (px - efxOrigin()) / efxSize(); }
vec2 efxFromUnit(vec2 u) { return efxOrigin() + u * efxSize(); }

vec4 efxSample(vec2 px)
{
    vec2 uv = px * uInputSize.zw;
    if (uv.x < uInputClamp.x || uv.y < uInputClamp.y || uv.x > uInputClamp.z || uv.y > uInputClamp.w)
    {
        return vec4(0.0);
    }
    return texture(uTexture, uv);
}

bool efxInside(vec2 px)
{
    vec2 u = efxToUnit(px);
    return u.x >= 0.0 && u.y >= 0.0 && u.x <= 1.0 && u.y <= 1.0;
}
`;

type UniformValue = number | Float32Array;
type UniformSpec = { value: UniformValue; type: string };

/** One shader pass. `efx` is its uniform block: `uElement` and `uPad` plus the family's own. */
export class ElementFxFilter extends Filter {
	readonly efx: Record<string, UniformValue>;

	constructor(name: string, body: string, uniforms: Record<string, UniformSpec>) {
		const glProgram = GlProgram.from({
			vertex: VERTEX,
			fragment: HEADER + body,
			name: `element-fx-${name}`,
		});
		super({
			glProgram,
			resources: {
				efxUniforms: {
					uElement: { value: new Float32Array([0, 0, 1, 1]), type: 'vec4<f32>' },
					uPad: { value: 0, type: 'f32' },
					...uniforms,
				},
			},
			// The runtime bounds every pass to the element's own `filterArea`; a viewport clip would
			// shift the frame off the box the shaders assume.
			clipToViewport: false,
		});
		this.efx = (this.resources.efxUniforms as { uniforms: Record<string, UniformValue> }).uniforms;
	}

	/** Write a vector uniform in place (Pixi uploads the same array object). */
	set(name: string, ...values: number[]): void {
		const target = this.efx[name];
		if (target instanceof Float32Array) {
			for (let i = 0; i < values.length; i++) target[i] = values[i];
		} else {
			this.efx[name] = values[0];
		}
	}
}

const vec = (n: number): UniformSpec => ({
	value: new Float32Array(n),
	type: n === 2 ? 'vec2<f32>' : n === 3 ? 'vec3<f32>' : 'vec4<f32>',
});

/**
 * A plane turned in 3D and seen in perspective: `uRot` = (rotation about X, rotation about Y,
 * lift toward the viewer as a share of the element's size); `uPersp` = (focal length in element
 * sizes, shade on/off). Each output pixel casts a ray from the eye to the plane and samples where
 * it lands, so the far side shows the element mirrored, as a coin's would.
 */
export const perspectiveFilter = (): ElementFxFilter =>
	new ElementFxFilter(
		'perspective',
		`
uniform vec3 uRot;
uniform vec2 uPersp;

void main(void)
{
    vec2 size = efxSize();
    float m = max(size.x, size.y);
    vec2 p = efxPx() - efxCenter();
    float f = uPersp.x * m;
    float cx = cos(uRot.x);
    float sx = sin(uRot.x);
    float cy = cos(uRot.y);
    float sy = sin(uRot.y);
    mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
    mat3 ry = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
    mat3 r = ry * rx;
    vec3 n = r * vec3(0.0, 0.0, 1.0);
    vec3 eye = vec3(0.0, 0.0, -f);
    vec3 dir = vec3(p, f);
    vec3 p0 = vec3(0.0, 0.0, -uRot.z * m);
    float denom = dot(n, dir);
    if (abs(denom) < 1e-4)
    {
        finalColor = vec4(0.0);
        return;
    }
    float lambda = dot(n, p0 - eye) / denom;
    if (lambda <= 0.0)
    {
        finalColor = vec4(0.0);
        return;
    }
    // The inverse of a rotation is its transpose, written out: GLSL ES 1.00 (WebGL1) has no
    // transpose().
    mat3 rt = mat3(r[0][0], r[1][0], r[2][0], r[0][1], r[1][1], r[2][1], r[0][2], r[1][2], r[2][2]);
    vec3 local = rt * (eye + lambda * dir - p0);
    vec4 color = efxSample(efxCenter() + local.xy);
    if (uPersp.y > 0.5)
    {
        color.rgb *= mix(0.45, 1.0, abs(n.z));
    }
    finalColor = color;
}
`,
		{ uRot: vec(3), uPersp: vec(2) },
	);

/**
 * A SPHERICON wrapped in the element's art: a double cone (axis X) whose lower half is turned a
 * quarter about Z, so the halves meet on an S-shaped seam. Each pixel casts an orthographic ray
 * into the solid and finds the nearest of the four half-cone faces; a face shows the whole element
 * wrapped around its axis, upright both unturned and rolled half a turn, lit when `uSphericon.z` is
 * on. `uSpin` = (roll about X, swing about Y, tilt towards the viewer), applied in that order.
 * `uSphericon.x` blends from the flat element (0) to the solid (1); `uSphericon.y` is the solid's
 * half-length as a share of the element's smaller side.
 */
export const sphericonFilter = (): ElementFxFilter =>
	new ElementFxFilter(
		'sphericon',
		`
uniform vec3 uSpin;
uniform vec3 uSphericon;

mat3 rotX(float a)
{
    float c = cos(a);
    float s = sin(a);
    return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}

mat3 rotY(float a)
{
    float c = cos(a);
    float s = sin(a);
    return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}

mat3 flip(mat3 m)
{
    return mat3(m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]);
}

// t when o + t d lies on the face around axis a (0 <= p.a <= h) inside the half where
// side * p.z >= 0, else -1.
float onFace(vec3 o, vec3 d, vec3 a, float side, float h, float t)
{
    vec3 p = o + t * d;
    float s = dot(p, a);
    return t > 0.0 && s >= 0.0 && s <= h && side * p.z >= 0.0 ? t : -1.0;
}

// The nearer hit of the ray o + t d on that face, or -1.
float face(vec3 o, vec3 d, vec3 a, float side, float h)
{
    float so = dot(o, a);
    float sd = dot(d, a);
    float qa = dot(d, d) - 2.0 * sd * sd;
    float qb = 2.0 * dot(o, d) - 4.0 * so * sd + 2.0 * h * sd;
    float qc = dot(o, o) - 2.0 * so * so + 2.0 * h * so - h * h;
    // A ray along the cone's slope meets it once.
    if (abs(qa) < 1e-6) return abs(qb) < 1e-6 ? -1.0 : onFace(o, d, a, side, h, -qc / qb);
    float disc = qb * qb - 4.0 * qa * qc;
    if (disc < 0.0) return -1.0;
    float root = sqrt(disc);
    float t0 = (-qb - root) / (2.0 * qa);
    float t1 = (-qb + root) / (2.0 * qa);
    float first = onFace(o, d, a, side, h, min(t0, t1));
    return first > 0.0 ? first : onFace(o, d, a, side, h, max(t0, t1));
}

void main(void)
{
    vec2 px = efxPx();
    vec4 plain = efxSample(px);
    float k = clamp(uSphericon.x, 0.0, 1.0);
    if (k <= 0.0)
    {
        finalColor = plain;
        return;
    }
    vec2 size = efxSize();
    float h = max(uSphericon.y * min(size.x, size.y), 1.0);
    mat3 r = rotX(uSpin.z) * rotY(uSpin.y) * rotX(uSpin.x);
    mat3 inv = flip(r);
    vec3 o = inv * vec3(px - efxCenter(), -4.0 * h);
    vec3 d = inv * vec3(0.0, 0.0, 1.0);

    float best = -1.0;
    vec3 axis = vec3(1.0, 0.0, 0.0);
    float top = 1.0;
    vec3 axes[4];
    axes[0] = vec3(1.0, 0.0, 0.0);
    axes[1] = vec3(-1.0, 0.0, 0.0);
    axes[2] = vec3(0.0, 1.0, 0.0);
    axes[3] = vec3(0.0, -1.0, 0.0);
    for (int i = 0; i < 4; i++)
    {
        float side = i < 2 ? 1.0 : -1.0;
        float hit = face(o, d, axes[i], side, h);
        if (hit > 0.0 && (best < 0.0 || hit < best))
        {
            best = hit;
            axis = axes[i];
            top = side;
        }
    }

    vec4 solid = vec4(0.0);
    if (best > 0.0)
    {
        vec3 p = o + best * d;
        vec2 uv = top > 0.0
            ? vec2(p.x / h * 0.5 + 0.5, atan(p.z, p.y) / PI)
            : vec2(atan(-p.z, -p.x) / PI, p.y / h * 0.5 + 0.5);
        solid = efxSample(efxFromUnit(clamp(uv, 0.0, 1.0)));
        if (uSphericon.z > 0.5)
        {
            float s = dot(p, axis);
            vec3 n = normalize(r * (p - (2.0 * s - h) * axis));
            vec3 light = normalize(vec3(-0.45, -0.6, -1.0));
            float diffuse = max(dot(n, light), 0.0);
            float spec = pow(max(dot(reflect(-light, n), vec3(0.0, 0.0, -1.0)), 0.0), 18.0);
            solid.rgb = min(solid.rgb * (0.35 + 0.75 * diffuse) + spec * 0.35 * solid.a, vec3(solid.a));
        }
    }
    finalColor = mix(plain, solid, k);
}
`,
		{ uSpin: vec(3), uSphericon: vec(3) },
	);

/**
 * Travelling waves. `uWave` = (amplitude as a share of the size, wavelength as a share of the
 * size, phase in cycles, mode): mode 0 shifts rows sideways (X), 1 shifts columns up and down (Y),
 * 2 is a flag pinned at its left edge with light on the folds.
 */
export const waveFilter = (): ElementFxFilter =>
	new ElementFxFilter(
		'wave',
		`
uniform vec4 uWave;

void main(void)
{
    vec2 px = efxPx();
    vec2 size = efxSize();
    vec2 u = efxToUnit(px);
    vec2 offset = vec2(0.0);
    float light = 1.0;
    float wavelength = max(uWave.y, 0.001);
    if (uWave.w < 0.5)
    {
        offset.x = uWave.x * size.x * sin(2.0 * PI * (u.y / wavelength - uWave.z));
    }
    else if (uWave.w < 1.5)
    {
        offset.y = uWave.x * size.y * sin(2.0 * PI * (u.x / wavelength - uWave.z));
    }
    else
    {
        float pin = clamp(u.x, 0.0, 1.0);
        float arg = 2.0 * PI * (u.x / wavelength - uWave.z);
        offset.y = uWave.x * size.y * pin * sin(arg);
        light = 1.0 + 0.3 * pin * cos(arg) * clamp(uWave.x * 12.0, 0.0, 1.0);
    }
    vec4 color = efxSample(px - offset);
    color.rgb = min(color.rgb * light, vec3(color.a));
    finalColor = color;
}
`,
		{ uWave: vec(4) },
	);

/** A swirl about the centre: `uTwist` = (angle in radians at the centre, radius in half-diagonals). */
export const twistFilter = (): ElementFxFilter =>
	new ElementFxFilter(
		'twist',
		`
uniform vec2 uTwist;

void main(void)
{
    vec2 c = efxCenter();
    vec2 p = efxPx() - c;
    float d = length(p);
    float radius = max(uTwist.y * 0.5 * length(efxSize()), 1.0);
    if (d < radius)
    {
        float k = (radius - d) / radius;
        float a = -uTwist.x * k * k;
        float s = sin(a);
        float co = cos(a);
        p = vec2(p.x * co - p.y * s, p.x * s + p.y * co);
    }
    finalColor = efxSample(c + p);
}
`,
		{ uTwist: vec(2) },
	);

/**
 * A page curl: the corner at `uCurl.xy` (0 or 1 in each axis) peels back along the diagonal, rolling
 * over a cylinder of radius `uCurl.w` whose axis has travelled `uCurl.z` in from the corner (both in
 * diagonals).
 * The flap's back shows the element mirrored and dimmed, and the page darkens under the roll.
 */
export const curlFilter = (): ElementFxFilter =>
	new ElementFxFilter(
		'curl',
		`
uniform vec4 uCurl;

vec4 back(vec4 color)
{
    float grey = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(color.rgb, vec3(grey), 0.45) * 0.72 + 0.12 * color.a;
    return color;
}

void main(void)
{
    vec2 px = efxPx();
    vec4 page = efxSample(px);
    float diagonal = length(efxSize());
    float reach = uCurl.z * diagonal;
    if (reach <= 0.0)
    {
        finalColor = page;
        return;
    }
    vec2 corner = efxFromUnit(uCurl.xy);
    vec2 d = normalize(efxCenter() - corner);
    float r = max(uCurl.w * diagonal, 0.5);
    float x = reach - dot(px - corner, d);
    vec4 result = vec4(0.0);
    if (x > r)
    {
        result = vec4(0.0);
    }
    else if (x >= 0.0)
    {
        float a = asin(clamp(x / r, -1.0, 1.0));
        vec2 qBack = px + d * (x - r * (PI - a));
        vec4 flapBack = efxInside(qBack) ? efxSample(qBack) : vec4(0.0);
        if (flapBack.a > 0.004)
        {
            result = back(flapBack);
        }
        else
        {
            vec2 qFront = px + d * (x - r * a);
            vec4 front = efxInside(qFront) ? efxSample(qFront) : vec4(0.0);
            front.rgb *= mix(1.0, 0.6, x / r);
            result = front;
        }
    }
    else
    {
        vec2 q = px + d * (2.0 * x - PI * r);
        vec4 flap = efxInside(q) ? back(efxSample(q)) : vec4(0.0);
        float shadow = 1.0 - 0.4 * smoothstep(-1.5 * r, 0.0, x);
        vec4 under = vec4(page.rgb * shadow, page.a);
        result = flap + under * (1.0 - flap.a);
    }
    finalColor = result;
}
`,
		{ uCurl: vec(4) },
	);

/**
 * A shock ring: `uRipple` = (ring radius in diagonals, ring width and amplitude in element sizes,
 * brightness). Pixels on the ring are pushed outward and lit a little.
 */
export const rippleFilter = (): ElementFxFilter =>
	new ElementFxFilter(
		'ripple',
		`
uniform vec4 uRipple;

void main(void)
{
    vec2 c = efxCenter();
    vec2 px = efxPx();
    vec2 p = px - c;
    float d = length(p);
    vec2 size = efxSize();
    float m = max(size.x, size.y);
    float width = max(uRipple.y * m, 1.0);
    float k = (d - uRipple.x * length(size)) / width;
    if (d < 0.001 || abs(k) >= 1.0)
    {
        finalColor = efxSample(px);
        return;
    }
    float push = sin(k * PI) * (1.0 - k * k) * uRipple.z * m;
    vec4 color = efxSample(px - (p / d) * push);
    color.rgb = min(color.rgb + color.a * uRipple.w * (1.0 - abs(k)), vec3(color.a));
    finalColor = color;
}
`,
		{ uRipple: vec(4) },
	);

/** A lens: `uBulge` = (strength −1…1, radius in half-diagonals). Positive puffs out, negative pinches in. */
export const bulgeFilter = (): ElementFxFilter =>
	new ElementFxFilter(
		'bulge',
		`
uniform vec2 uBulge;

void main(void)
{
    vec2 c = efxCenter();
    vec2 p = efxPx() - c;
    float d = length(p);
    float radius = max(uBulge.y * 0.5 * length(efxSize()), 1.0);
    float s = uBulge.x;
    if (d < radius && d > 0.0)
    {
        float percent = d / radius;
        if (s > 0.0)
        {
            p *= mix(1.0, smoothstep(0.0, radius / d, percent), s * 0.75);
        }
        else if (s < 0.0)
        {
            p *= mix(1.0, pow(percent, 1.0 + s * 0.75) * radius / d, 1.0 - percent);
        }
    }
    finalColor = efxSample(c + p);
}
`,
		{ uBulge: vec(2) },
	);

/**
 * A band of light: `uShine` = (band centre along the sweep, 0…1 across the element; half width;
 * sweep angle in radians; strength), `uShineColor` its colour. Light lands only where the element
 * is, scaled by its alpha.
 */
export const shineFilter = (): ElementFxFilter =>
	new ElementFxFilter(
		'shine',
		`
uniform vec4 uShine;
uniform vec3 uShineColor;

void main(void)
{
    vec2 px = efxPx();
    vec4 color = efxSample(px);
    vec2 u = efxToUnit(px) - 0.5;
    vec2 axis = vec2(cos(uShine.z), sin(uShine.z));
    float along = dot(u, axis) + 0.5;
    float band = 1.0 - smoothstep(0.0, max(uShine.y, 0.001), abs(along - uShine.x));
    color.rgb = min(color.rgb + uShineColor * color.a * band * band * uShine.w, vec3(color.a));
    finalColor = color;
}
`,
		{ uShine: vec(4), uShineColor: vec(3) },
	);

/** Mix toward a colour, keeping the element's alpha: `uMix` = (r, g, b, amount). */
export const colorMixFilter = (): ElementFxFilter =>
	new ElementFxFilter(
		'color-mix',
		`
uniform vec4 uMix;

void main(void)
{
    vec4 color = efxSample(efxPx());
    color.rgb = mix(color.rgb, uMix.rgb * color.a, uMix.a);
    finalColor = color;
}
`,
		{ uMix: vec(4) },
	);

/**
 * A noise dissolve: `uDissolve` = (progress 0 = whole … 1 = gone, edge width, grain, seed);
 * `uEdgeColor` lights the burning edge.
 */
export const dissolveFilter = (): ElementFxFilter =>
	new ElementFxFilter(
		'dissolve',
		`
uniform vec4 uDissolve;
uniform vec3 uEdgeColor;

float hash(vec2 p)
{
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 w = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

void main(void)
{
    vec2 px = efxPx();
    vec4 color = efxSample(px);
    vec2 size = efxSize();
    vec2 u = efxToUnit(px) * vec2(size.x / max(size.x, size.y), size.y / max(size.x, size.y));
    vec2 q = u * uDissolve.z + uDissolve.w;
    float n = 0.55 * noise(q) + 0.3 * noise(q * 2.03 + 7.1) + 0.15 * noise(q * 4.01 + 3.7);
    float edge = uDissolve.y;
    float threshold = uDissolve.x * (1.0 + edge);
    if (n < threshold - edge)
    {
        finalColor = vec4(0.0);
        return;
    }
    if (edge > 0.0 && n < threshold)
    {
        float k = (n - (threshold - edge)) / edge;
        color.rgb = mix(min(uEdgeColor * 1.6, vec3(1.0)) * color.a, color.rgb, k);
    }
    finalColor = color;
}
`,
		{ uDissolve: vec(4), uEdgeColor: vec(3) },
	);

/**
 * Melting, like wax: each column runs down by its own amount (a slow swell, finer streaks and a
 * few long drips, from noise across the element), and a row runs the further the lower it sits,
 * so the top sinks while the bottom drips furthest. `uMelt` = (progress 0…1, how far a column runs
 * at most in element heights, drips across, seed); `uHeat` = (colour, how much the running part
 * glows with it).
 */
export const meltFilter = (): ElementFxFilter =>
	new ElementFxFilter(
		'melt',
		`
uniform vec4 uMelt;
uniform vec4 uHeat;

float meltHash(float n)
{
    return fract(sin(n * 12.9898 + 78.233) * 43758.5453);
}

float meltNoise(float x)
{
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(meltHash(i), meltHash(i + 1.0), f);
}

void main(void)
{
    vec2 px = efxPx();
    float m = uMelt.x;
    if (m <= 0.0)
    {
        finalColor = efxSample(px);
        return;
    }
    vec2 u = efxToUnit(px);
    float drips = uMelt.z;
    float seed = uMelt.w;
    float run = 0.3 + 0.35 * meltNoise(u.x * drips + seed)
        + 0.2 * meltNoise(u.x * drips * 2.7 + seed * 1.7)
        + 0.6 * pow(meltNoise(u.x * drips * 4.3 + seed * 2.3), 4.0);
    float d = m * uMelt.y * run;
    // Row v of the element moves down by d * (0.3 + 0.7 v); this pixel shows the row that lands here.
    float v = (u.y - 0.3 * d) / (1.0 + 0.7 * d);
    if (v < 0.0 || v > 1.0)
    {
        finalColor = vec4(0.0);
        return;
    }
    float waver = 0.006 * m * sin(u.y * 23.0 + seed);
    vec4 color = efxSample(efxFromUnit(vec2(u.x + waver, v)));
    float runny = clamp(d * v * 2.5, 0.0, 1.0);
    color.rgb = mix(color.rgb, min(uHeat.rgb * 1.4, vec3(1.0)) * color.a, uHeat.a * runny);
    finalColor = color;
}
`,
		{ uMelt: vec(4), uHeat: vec(4) },
	);

/**
 * Freezing into ice: frost creeps over the element's own pixels from where `uFreeze.w` says (0 the
 * edges, 1 the centre, 2 the top, 3 the bottom), its front following the crystals, and what it
 * covers turns to ice — `uIce` shaded by the art's brightness with a hint of its own colour, so
 * it reads underneath; crystal boundaries and facets (cellular noise) lit, the frost thicker where it
 * started, the element's own edge frosted white, a bright line on the creeping front. `uFreeze` =
 * (coverage 0…1, crystals across, seed, from); `uGlint` = (how icy, 0…1; where a glint sweeping
 * across is, off below 0).
 */
export const freezeFilter = (): ElementFxFilter =>
	new ElementFxFilter(
		'freeze',
		`
uniform vec4 uFreeze;
uniform vec3 uIce;
uniform vec2 uGlint;

vec2 iceHash(vec2 p)
{
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

// The distance to the nearest crystal's centre and to the next nearest.
vec2 iceCells(vec2 p)
{
    vec2 cell = floor(p);
    vec2 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    for (int j = -1; j <= 1; j++)
    {
        for (int i = -1; i <= 1; i++)
        {
            vec2 g = vec2(float(i), float(j));
            float d = length(g + iceHash(cell + g + uFreeze.z) - f);
            if (d < d1)
            {
                d2 = d1;
                d1 = d;
            }
            else if (d < d2)
            {
                d2 = d;
            }
        }
    }
    return vec2(d1, d2);
}

void main(void)
{
    vec2 px = efxPx();
    vec4 color = efxSample(px);
    float amount = uGlint.x;
    if (uFreeze.x <= 0.0 || amount <= 0.0 || color.a <= 0.0)
    {
        finalColor = color;
        return;
    }
    vec2 size = efxSize();
    vec2 u = efxToUnit(px);
    vec2 cells = iceCells(u * size / max(size.x, size.y) * uFreeze.y);
    float from = uFreeze.w;
    float away = from < 0.5
        ? 2.0 * min(min(u.x, 1.0 - u.x), min(u.y, 1.0 - u.y))
        : from < 1.5 ? length(u - 0.5) * 1.4142 : from < 2.5 ? u.y : 1.0 - u.y;
    float reach = 0.8 * clamp(away, 0.0, 1.0) + 0.2 * cells.x;
    float front = uFreeze.x * 1.25;
    float frozen = 1.0 - smoothstep(front - 0.06, front, reach);
    if (frozen <= 0.0)
    {
        finalColor = color;
        return;
    }
    vec3 rgb = color.rgb / color.a;
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    vec3 ice = mix(uIce * (0.35 + 0.9 * lum), rgb, 0.18);
    ice += 0.3 * (1.0 - smoothstep(0.0, 0.05, cells.y - cells.x));
    ice += 0.08 * cells.x;
    ice += 0.2 * (1.0 - smoothstep(0.0, 0.4, reach));
    float sweep = u.x + 0.6 * u.y;
    ice += 0.5 * (1.0 - smoothstep(0.0, 0.08, abs(sweep - uGlint.y * 1.6)));
    float edge = color.a - min(
        min(efxSample(px + vec2(1.5, 0.0)).a, efxSample(px - vec2(1.5, 0.0)).a),
        min(efxSample(px + vec2(0.0, 1.5)).a, efxSample(px - vec2(0.0, 1.5)).a));
    ice += 0.6 * clamp(edge, 0.0, 1.0);
    float rim = 1.0 - smoothstep(0.0, 0.05, abs(reach - (front - 0.03)));
    ice += 0.35 * rim * step(uFreeze.x, 0.999);
    finalColor = vec4(mix(rgb, min(ice, vec3(1.0)), frozen * amount) * color.a, color.a);
}
`,
		{ uFreeze: vec(4), uIce: vec(3), uGlint: vec(2) },
	);

/**
 * Burning to ashes: a fire front sweeps across from `uBurn.w` (0 bottom, 1 top, 2 the edges, 3 the
 * centre, 4 left, 5 right), ragged with noise. Ahead of it the element scorches brown; on it the
 * element's own shape burns in flickering flame; behind it lies grey ash in the element's shape,
 * embers cooling in it, lifting a little and crumbling away. Sparks rise from the flames.
 * `uBurn` = (front, raggedness, seed, from); `uFlame` = (flame colour, seconds for the flicker
 * and the sparks); `uAsh` = (ash colour, sparks on); `uGlow` = (how hot the flame burns).
 */
export const burnFilter = (): ElementFxFilter =>
	new ElementFxFilter(
		'burn',
		`
uniform vec4 uBurn;
uniform vec4 uFlame;
uniform vec4 uAsh;
uniform vec2 uGlow;

float burnHash(vec2 p)
{
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float burnNoise(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 w = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(burnHash(i), burnHash(i + vec2(1.0, 0.0)), w.x),
        mix(burnHash(i + vec2(0.0, 1.0)), burnHash(i + vec2(1.0, 1.0)), w.x),
        w.y);
}

// How far the fire travels to reach unit point u, 0…1, roughened by the noise n.
float burnReach(vec2 u, float n)
{
    float from = uBurn.w;
    float away = from < 0.5 ? 1.0 - u.y
        : from < 1.5 ? u.y
        : from < 2.5 ? 2.0 * min(min(u.x, 1.0 - u.x), min(u.y, 1.0 - u.y))
        : from < 3.5 ? length(u - 0.5) * 1.4142
        : from < 4.5 ? u.x
        : 1.0 - u.x;
    return 0.75 * clamp(away, 0.0, 1.0) + 0.25 * n;
}

void main(void)
{
    vec2 px = efxPx();
    vec4 color = efxSample(px);
    vec2 size = efxSize();
    vec2 u = efxToUnit(px);
    vec2 aspect = size / max(size.x, size.y);
    vec2 q = u * aspect * uBurn.y + uBurn.z;
    float n = 0.6 * burnNoise(q) + 0.3 * burnNoise(q * 2.1 + 3.7) + 0.1 * burnNoise(q * 4.3 + 9.1);
    float s = uBurn.x - burnReach(clamp(u, 0.0, 1.0), n);
    float time = uFlame.w;
    vec4 burnt = vec4(0.0);
    if (s < 0.0)
    {
        float scorch = smoothstep(-0.16, 0.0, s);
        burnt = vec4(mix(color.rgb, vec3(0.22, 0.1, 0.04) * color.a, 0.75 * scorch), color.a);
    }
    else if (s < 0.05)
    {
        float flicker = 0.75 + 0.25 * burnNoise(q * 3.0 + vec2(0.0, time * 9.0));
        vec3 flame = mix(vec3(1.0, 0.95, 0.65), uFlame.rgb, s / 0.05) * flicker * uGlow.x;
        burnt = vec4(min(flame * 1.3, vec3(1.0)) * color.a, color.a);
    }
    else
    {
        float lift = (s - 0.05) * 0.12 * size.y;
        float a = efxSample(px + vec2(0.0, lift)).a;
        float fine = burnNoise(q * 6.0 + 1.3);
        a *= 1.0 - smoothstep(0.08, 0.5, s + 0.25 * (fine - 0.5) + 0.2 * (n - 0.5));
        float ember = step(0.86, fine) * (1.0 - smoothstep(0.05, 0.25, s));
        vec3 ash = mix(uAsh.rgb * (0.65 + 0.5 * fine), uFlame.rgb * 1.2 * uGlow.x, ember);
        burnt = vec4(min(ash, vec3(1.0)) * a, a);
    }
    if (uAsh.a > 0.5 && u.x >= 0.0 && u.x <= 1.0 && u.y >= -0.25 && u.y <= 1.0)
    {
        vec2 sq = vec2(u.x * aspect.x, u.y * aspect.y + time * 0.35) * 14.0;
        vec2 cell = floor(sq);
        vec2 at = vec2(burnHash(cell + uBurn.z), burnHash(cell + uBurn.z + 17.0));
        float live = step(0.6, burnHash(cell + 5.3));
        float band = smoothstep(-0.25, -0.05, s) * (1.0 - smoothstep(0.05, 0.2, s));
        float spark = (1.0 - smoothstep(0.0, 0.12, length(fract(sq) - at))) * live * band;
        burnt += vec4(min(uFlame.rgb * 1.3, vec3(1.0)) * spark, spark);
    }
    finalColor = min(burnt, vec4(1.0));
}
`,
		{ uBurn: vec(4), uFlame: vec(4), uAsh: vec(4), uGlow: vec(2) },
	);

/**
 * Poisoned: the art drains to a sickly version of itself turned towards the venom colour, dark
 * veins (ridged noise) creep in from the edges as the dose rises and pulse inward, and bubbles
 * rise through it. `uPoison` = (dose 0…1, vein scale, seed, seconds); `uVenom` = (venom colour,
 * bubbles on).
 */
export const poisonFilter = (): ElementFxFilter =>
	new ElementFxFilter(
		'poison',
		`
uniform vec4 uPoison;
uniform vec4 uVenom;

float poisonHash(vec2 p)
{
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float poisonNoise(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 w = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(poisonHash(i), poisonHash(i + vec2(1.0, 0.0)), w.x),
        mix(poisonHash(i + vec2(0.0, 1.0)), poisonHash(i + vec2(1.0, 1.0)), w.x),
        w.y);
}

void main(void)
{
    vec2 px = efxPx();
    vec4 color = efxSample(px);
    float dose = uPoison.x;
    if (dose <= 0.0 || color.a <= 0.0)
    {
        finalColor = color;
        return;
    }
    vec2 size = efxSize();
    vec2 u = efxToUnit(px);
    vec2 aspect = size / max(size.x, size.y);
    float time = uPoison.w;
    vec3 rgb = color.rgb / color.a;
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    vec3 sick = mix(rgb, vec3(lum) * (0.35 + 0.85 * uVenom.rgb), 0.8) + 0.15 * uVenom.rgb;

    vec2 q = u * aspect * uPoison.y + uPoison.z;
    float ridge = 1.0 - abs(2.0 * poisonNoise(q) - 1.0);
    float twig = 1.0 - abs(2.0 * poisonNoise(q * 2.3 + 5.1) - 1.0);
    float vein = smoothstep(0.9, 0.98, ridge) + 0.6 * smoothstep(0.93, 0.99, twig);
    float edge = 1.0 - 2.0 * min(min(u.x, 1.0 - u.x), min(u.y, 1.0 - u.y));
    float creep = 1.0 - dose * 1.2;
    float reach = smoothstep(creep - 0.2, creep, edge + 0.2 * poisonNoise(q * 0.5));
    float pulse = 0.65 + 0.35 * sin(time * 4.0 - edge * 6.0);
    vec3 veinColor = mix(vec3(0.12, 0.02, 0.16), uVenom.rgb, 0.1 + 0.4 * pulse * pulse);
    sick = mix(sick, veinColor, clamp(vein * reach, 0.0, 1.0) * 0.85);

    if (uVenom.a > 0.5)
    {
        vec2 bq = vec2(u.x * aspect.x, u.y * aspect.y + time * 0.12) * 9.0;
        vec2 cell = floor(bq);
        vec2 at = vec2(0.2 + 0.6 * poisonHash(cell + uPoison.z), 0.2 + 0.6 * poisonHash(cell + uPoison.z + 9.0));
        float r = 0.12 + 0.18 * poisonHash(cell + 3.3);
        float live = step(0.55, poisonHash(cell + 7.7));
        vec2 off = fract(bq) - at;
        float ring = (1.0 - smoothstep(0.0, 0.05, abs(length(off) - r))) * live;
        float shine = (1.0 - smoothstep(0.0, r * 0.35, length(off + vec2(r * 0.35)))) * live;
        sick = mix(sick, min(uVenom.rgb * 1.3 + 0.2, vec3(1.0)), clamp(0.8 * ring + 0.6 * shine, 0.0, 1.0));
    }
    finalColor = vec4(mix(rgb, sick, dose) * color.a, color.a);
}
`,
		{ uPoison: vec(4), uVenom: vec(4) },
	);

/**
 * Electrocuted: up to six jagged arcs crackle across the element between points on its edge,
 * re-struck 14 times a second, a white-hot core in a halo of `uArc`; the element's own outline
 * glows, and it flickers now and then to a scorched negative. `uZap` = (how hard 0…1, arcs, seed,
 * seconds); `uArc` = (arc colour, flicker on).
 */
export const electrocuteFilter = (): ElementFxFilter =>
	new ElementFxFilter(
		'electrocute',
		`
uniform vec4 uZap;
uniform vec4 uArc;

float zapHash(float n)
{
    return fract(sin(n * 12.9898 + 78.233) * 43758.5453);
}

float zapNoise(float x)
{
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(zapHash(i), zapHash(i + 1.0), f);
}

// A point on the element's edge, 0…4 once round it, in unit coordinates.
vec2 zapRim(float a)
{
    a = mod(a, 4.0);
    return a < 1.0 ? vec2(a, 0.0)
        : a < 2.0 ? vec2(1.0, a - 1.0)
        : a < 3.0 ? vec2(3.0 - a, 1.0)
        : vec2(0.0, 4.0 - a);
}

void main(void)
{
    vec2 px = efxPx();
    vec4 color = efxSample(px);
    float amount = uZap.x;
    if (amount <= 0.0)
    {
        finalColor = color;
        return;
    }
    vec2 size = efxSize();
    float big = max(size.x, size.y);
    vec2 p = efxToUnit(px) * size;
    float tick = floor(uZap.w * 14.0);
    float core = 0.0;
    float halo = 0.0;
    for (int i = 0; i < 6; i++)
    {
        if (float(i) >= uZap.y) break;
        float seed = uZap.z + float(i) * 17.31 + tick * 3.7;
        vec2 a = zapRim(zapHash(seed) * 4.0) * size;
        vec2 b = zapRim(zapHash(seed + 1.7) * 2.0 + zapHash(seed) * 4.0 + 1.0) * size;
        vec2 ab = b - a;
        float len = max(length(ab), 1.0);
        vec2 dir = ab / len;
        float along = dot(p - a, dir);
        if (along < 0.0 || along > len) continue;
        float s = along / len;
        float jag = (zapNoise(s * 9.0 + seed) - 0.5) * 0.9 + (zapNoise(s * 23.0 + seed * 2.0) - 0.5) * 0.35;
        float d = abs(dot(p - a, vec2(-dir.y, dir.x)) - jag * 0.22 * big * sin(PI * s));
        core += exp(-d / max(1.0, 0.006 * big));
        halo += exp(-d / (0.03 * big));
    }
    vec3 arc = uArc.rgb;
    vec4 zapped = color;
    if (color.a > 0.0)
    {
        vec3 rgb = color.rgb / color.a;
        float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
        float flick = uArc.a * step(0.72, zapHash(tick + uZap.z));
        rgb = mix(rgb, mix(rgb, vec3(1.0 - lum) * (0.4 + 0.8 * arc), 0.85), flick * amount);
        float edge = color.a - min(
            min(efxSample(px + vec2(2.0, 0.0)).a, efxSample(px - vec2(2.0, 0.0)).a),
            min(efxSample(px + vec2(0.0, 2.0)).a, efxSample(px - vec2(0.0, 2.0)).a));
        rgb += arc * clamp(edge, 0.0, 1.0) * 0.8 * amount;
        zapped = vec4(min(rgb, vec3(1.0)) * color.a, color.a);
    }
    float c = clamp(core, 0.0, 1.0) * amount;
    float g = clamp(halo * 0.35, 0.0, 1.0) * amount;
    zapped.rgb = min(zapped.rgb + vec3(c) + arc * g, vec3(1.0));
    zapped.a = min(1.0, zapped.a + max(c, 0.8 * g) * (1.0 - zapped.a));
    finalColor = zapped;
}
`,
		{ uZap: vec(4), uArc: vec(4) },
	);

/**
 * Turning to stone: granite creeps over the element's own pixels from where `uStone.w` says (0 the
 * bottom, 1 the top, 2 the edges, 3 the centre), a pale dusty line on its front. What it covers is
 * `uRock` shaded by the art's brightness and a fractal grain, speckled, split by slab cracks
 * (cellular noise), and carved in relief — the art's outline and its light and dark lit as height
 * from the top left; only some of the cracks show. Flaking off, every crack opens and the front
 * follows the slabs, so it lets go a chip at a time. `uStone` = (coverage 0…1, grain across, seed,
 * from); `uRock` = (stone colour, how stony 0…1); `uChip` = (how far it has flaked off, 0…1; how
 * dusty the creeping front is).
 */
export const petrifyFilter = (): ElementFxFilter =>
	new ElementFxFilter(
		'petrify',
		`
uniform vec4 uStone;
uniform vec4 uRock;
uniform vec2 uChip;

float stoneHash(vec2 p)
{
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

vec2 stoneHash2(vec2 p)
{
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float stoneNoise(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 w = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(stoneHash(i), stoneHash(i + vec2(1.0, 0.0)), w.x),
        mix(stoneHash(i + vec2(0.0, 1.0)), stoneHash(i + vec2(1.0, 1.0)), w.x),
        w.y);
}

float stoneGrain(vec2 q)
{
    return 0.55 * stoneNoise(q) + 0.3 * stoneNoise(q * 2.3 + 3.1) + 0.15 * stoneNoise(q * 5.1 + 7.7);
}

// The distance to the nearest slab's centre and to the next nearest, and the nearest slab's own
// random value.
vec3 stoneSlabs(vec2 p)
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
            float d = length(g + stoneHash2(cell + g + uStone.z) - f);
            if (d < d1)
            {
                d2 = d1;
                d1 = d;
                id = stoneHash(cell + g + uStone.z * 3.1);
            }
            else if (d < d2)
            {
                d2 = d;
            }
        }
    }
    return vec3(d1, d2, id);
}

// The element's height at px for the relief: its outline, raised where the art is light.
float stoneHeight(vec2 px)
{
    vec4 s = efxSample(px);
    return 0.6 * s.a + 0.4 * dot(s.rgb, vec3(0.299, 0.587, 0.114));
}

void main(void)
{
    vec2 px = efxPx();
    vec4 color = efxSample(px);
    float amount = uRock.a;
    if (uStone.x <= 0.0 || amount <= 0.0 || color.a <= 0.0)
    {
        finalColor = color;
        return;
    }
    vec2 size = efxSize();
    vec2 u = efxToUnit(px);
    vec2 q = u * size / max(size.x, size.y) * uStone.y + uStone.z;
    float grain = stoneGrain(q);
    vec3 slabs = stoneSlabs(q * 0.45);
    float from = uStone.w;
    float away = from < 0.5 ? 1.0 - u.y
        : from < 1.5 ? u.y
        : from < 2.5 ? 2.0 * min(min(u.x, 1.0 - u.x), min(u.y, 1.0 - u.y))
        : length(u - 0.5) * 1.4142;
    away = clamp(away, 0.0, 1.0);
    float flaking = step(0.0001, uChip.x);
    float reach = mix(0.8 * away + 0.2 * grain, 0.3 * away + 0.7 * slabs.z, flaking);
    float front = uStone.x * mix(1.25, 1.03, flaking);
    float stone = 1.0 - smoothstep(front - mix(0.05, 0.03, flaking), front, reach);
    if (stone <= 0.0)
    {
        finalColor = color;
        return;
    }
    vec3 rgb = color.rgb / color.a;
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    vec3 rock = uRock.rgb * (0.45 + 0.75 * lum) * (0.75 + 0.5 * grain);
    rock *= 0.9 + 0.22 * step(0.74, stoneNoise(q * 11.0 + 5.0));
    rock *= 1.0 - 0.3 * step(0.8, stoneNoise(q * 14.0 + 1.7));
    float cracked = max(smoothstep(0.45, 0.65, stoneNoise(q * 0.6 + 11.0)), smoothstep(0.0, 0.3, uChip.x));
    rock *= 1.0 - 0.6 * cracked * (1.0 - smoothstep(0.0, 0.03, slabs.y - slabs.x));
    float e = 1.5;
    float relief = (stoneHeight(px + vec2(e, 0.0)) - stoneHeight(px - vec2(e, 0.0)))
        + (stoneHeight(px + vec2(0.0, e)) - stoneHeight(px - vec2(0.0, e)));
    float bump = (stoneNoise(q * 2.3 + vec2(3.2, 3.1)) - stoneNoise(q * 2.3 + vec2(3.0, 3.1)))
        + (stoneNoise(q * 2.3 + vec2(3.1, 3.2)) - stoneNoise(q * 2.3 + vec2(3.1, 3.0)));
    rock *= 1.0 + 0.45 * clamp(1.2 * relief + 1.5 * bump, -1.0, 1.0);
    float rim = 1.0 - smoothstep(0.0, 0.05, abs(reach - (front - 0.03)));
    rock = mix(rock, vec3(0.85, 0.82, 0.76), uChip.y * rim);
    rock += 0.14 * flaking * (1.0 - smoothstep(0.0, 0.05, front - reach));
    finalColor = vec4(mix(rgb, clamp(rock, 0.0, 1.0), stone * amount) * color.a, color.a);
}
`,
		{ uStone: vec(4), uRock: vec(4), uChip: vec(2) },
	);

/**
 * Turning to gold: polished metal spreads over the element's own pixels from where `uGold.z` says
 * (0 the centre, 1 the bottom, 2 the top, 3 the edges) behind a molten white-gold front. The art's
 * outline and its light and dark become an embossed relief whose normal bends a studio reflection
 * (bright above, a dark band, warm below) and catches a highlight from the top left; the colour runs
 * from a deep version of `uMetal` through it to near white. A glint sweeps across and sparkles
 * twinkle on it. `uGold` = (coverage 0…1, seed, from, seconds); `uMetal` = (gold colour, how golden
 * 0…1); `uShine` = (where the glint is, off below 0; sparkles on; how bright the front glows).
 */
export const goldFilter = (): ElementFxFilter =>
	new ElementFxFilter(
		'gold',
		`
uniform vec4 uGold;
uniform vec4 uMetal;
uniform vec3 uShine;

float goldHash(vec2 p)
{
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float goldNoise(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 w = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(goldHash(i), goldHash(i + vec2(1.0, 0.0)), w.x),
        mix(goldHash(i + vec2(0.0, 1.0)), goldHash(i + vec2(1.0, 1.0)), w.x),
        w.y);
}

// The element's height at px for the relief: its outline, raised where the art is light.
float goldHeight(vec2 px)
{
    vec4 s = efxSample(px);
    return 0.6 * s.a + 0.4 * dot(s.rgb, vec3(0.299, 0.587, 0.114));
}

// The metal at shade t, 0…1: a deep version of the colour, the colour, then near white.
vec3 goldRamp(float t)
{
    vec3 base = uMetal.rgb;
    vec3 deep = base * base * 0.35;
    vec3 pale = mix(base, vec3(1.0), 0.75);
    return t < 0.5 ? mix(deep, base, t * 2.0) : mix(base, pale, t * 2.0 - 1.0);
}

void main(void)
{
    vec2 px = efxPx();
    vec4 color = efxSample(px);
    float amount = uMetal.a;
    if (uGold.x <= 0.0 || amount <= 0.0 || color.a <= 0.0)
    {
        finalColor = color;
        return;
    }
    vec2 size = efxSize();
    vec2 u = efxToUnit(px);
    vec2 q = u * size / max(size.x, size.y);
    float n = 0.65 * goldNoise(q * 5.0 + uGold.y) + 0.35 * goldNoise(q * 11.0 + uGold.y);
    float from = uGold.z;
    float away = from < 0.5 ? length(u - 0.5) * 1.4142
        : from < 1.5 ? 1.0 - u.y
        : from < 2.5 ? u.y
        : 2.0 * min(min(u.x, 1.0 - u.x), min(u.y, 1.0 - u.y));
    float reach = 0.82 * clamp(away, 0.0, 1.0) + 0.18 * n;
    float front = uGold.x * 1.22;
    float gilt = 1.0 - smoothstep(front - 0.04, front, reach);
    float rim = (1.0 - smoothstep(0.0, 0.05, abs(reach - (front - 0.02)))) * uShine.z;
    if (gilt <= 0.0 && rim <= 0.0)
    {
        finalColor = color;
        return;
    }
    vec3 rgb = color.rgb / color.a;
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    float e = 1.5;
    vec2 slope = vec2(
        goldHeight(px + vec2(e, 0.0)) - goldHeight(px - vec2(e, 0.0)),
        goldHeight(px + vec2(0.0, e)) - goldHeight(px - vec2(0.0, e)));
    vec3 normal = normalize(vec3(-2.5 * slope, 1.0));
    float look = u.y + 0.9 * normal.y - 0.25 * normal.x;
    float env = 0.55 + 0.45 * cos(look * 5.0 + 0.6);
    vec3 metal = goldRamp(clamp(0.06 + 0.32 * lum + 0.62 * env, 0.0, 1.0));
    float spec = pow(max(dot(normal, normalize(vec3(-0.5, -0.6, 0.65))), 0.0), 18.0);
    metal += vec3(1.0, 0.97, 0.88) * 0.9 * spec;
    float sweep = u.x + 0.6 * u.y;
    metal += vec3(1.0, 0.95, 0.8) * 0.55 * (1.0 - smoothstep(0.0, 0.07, abs(sweep - uShine.x * 1.6)));
    if (uShine.y > 0.5)
    {
        vec2 sq = q * 6.0;
        vec2 cell = floor(sq);
        vec2 at = 0.35 + 0.3 * vec2(goldHash(cell + uGold.y), goldHash(cell + uGold.y + 7.0));
        float beat = max(0.0, sin((uGold.w * 1.3 + goldHash(cell + 3.3)) * 6.2832));
        float tw = pow(beat, 6.0) * step(0.55, goldHash(cell + 9.1));
        vec2 d = abs(fract(sq) - at);
        float arm = 0.34 * tw + 0.001;
        float star = (1.0 - smoothstep(0.0, 0.025, d.x)) * (1.0 - smoothstep(0.0, arm, d.y))
            + (1.0 - smoothstep(0.0, 0.025, d.y)) * (1.0 - smoothstep(0.0, arm, d.x))
            + (1.0 - smoothstep(0.0, 0.07, length(d))) * tw;
        metal += vec3(1.0, 0.98, 0.9) * star * tw * gilt;
    }
    vec3 gilded = mix(rgb, clamp(metal, 0.0, 1.0), gilt * amount);
    gilded = mix(gilded, vec3(1.0, 0.93, 0.7), clamp(rim, 0.0, 1.0) * 0.75 * amount);
    finalColor = vec4(gilded * color.a, color.a);
}
`,
		{ uGold: vec(4), uMetal: vec(4), uShine: vec(3) },
	);
