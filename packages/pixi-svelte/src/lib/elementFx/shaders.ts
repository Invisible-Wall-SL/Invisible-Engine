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
