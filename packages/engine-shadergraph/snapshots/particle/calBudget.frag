precision highp float;
in vec4 vEfxUnit;
in vec4 vEfxMap;
in vec4 vEfxMap2;
in vec4 vEfxTrim;
in vec4 vEfxColor;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uColor;
uniform vec4 uWorldColorAlpha;

const float PI = 3.14159265358979;

vec2 efxSize() { return max(vEfxUnit.zw, vec2(1.0)); }
vec2 efxArea() { return efxSize(); }
vec2 efxOrigin() { return vec2(0.0); }
vec2 efxPx() { return vEfxUnit.xy * efxSize(); }
vec2 efxCenter() { return 0.5 * efxSize(); }
vec2 efxToUnit(vec2 px) { return px / efxSize(); }
vec2 efxFromUnit(vec2 u) { return u * efxSize(); }

vec4 efxSample(vec2 px)
{
    vec2 u = efxToUnit(px);
    if (u.x < vEfxTrim.x || u.y < vEfxTrim.y || u.x > vEfxTrim.z || u.y > vEfxTrim.w)
    {
        return vec4(0.0);
    }
    return texture(uTexture, vEfxMap.xy + u.x * vEfxMap.zw + u.y * vEfxMap2.xy);
}

bool efxInside(vec2 px)
{
    vec2 u = efxToUnit(px);
    return u.x >= 0.0 && u.y >= 0.0 && u.x <= 1.0 && u.y <= 1.0;
}

vec4 efxParticleColor() { return vEfxColor; }
float efxParticleWave() { return vEfxMap2.z; }
float efxParticleOrder() { return vEfxMap2.w; }

vec4 efxScreenFrom(vec2 px) { return efxSample(px); }
vec4 efxScreenTo(vec2 px) { return efxSample(px); }
float efxScreenReverse() { return 0.0; }

// The point a turn of `a` radians about the element's centre draws at u (u in its unit space).
vec2 efxRotateUv(vec2 u, float a)
{
    vec2 c = efxCenter();
    vec2 p = efxFromUnit(u) - c;
    float co = cos(a);
    float s = sin(a);
    return efxToUnit(c + vec2(p.x * co - p.y * s, p.x * s + p.y * co));
}

// Where a travelling wave reads the pixel at px: rows shift sideways (axis < 0.5) or columns up and
// down, by `amplitude` element sizes, `wavelength` element sizes apart, `phase` in cycles.
vec2 efxWave(vec2 px, float amplitude, float wavelength, float phase, float axis)
{
    vec2 size = efxSize();
    vec2 u = efxToUnit(px);
    float wl = max(wavelength, 0.001);
    if (axis < 0.5) return px - vec2(amplitude * size.x * sin(2.0 * PI * (u.y / wl - phase)), 0.0);
    return px - vec2(0.0, amplitude * size.y * sin(2.0 * PI * (u.x / wl - phase)));
}

// A 2-D point hashed to 0…1, without sin (it holds up for large inputs).
float efxHash(vec2 p)
{
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

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
}

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
}
in vec4 uFx;
in float uSeed;

void efxParticleBody(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    vec4 pixel = efxSample(px);
    vec4 n0_l0 = pixel;
    vec3 n0_rgb = (n0_l0.rgb / max(n0_l0.a, 0.0001));
    float n0_alpha = n0_l0.a;
    vec2 n1_out = efxRotateUv(uv, radians(0.4));
    vec4 n2_out = efxSample(efxFromUnit(n1_out));
    float n3_progress = uFx.x;
    float n4_out = sin(PI * clamp(n3_progress, 0.0, 1.0));
    vec2 n5_out = efxToUnit(efxWave(efxFromUnit(uv), 0.03, 0.3, n4_out, 0.0));
    vec4 n6_out = efxSample(efxFromUnit(n5_out));
    vec4 n7_out = (n2_out + n6_out);
    vec2 n8_out = ((uv - vec2(0.5, 0.5)) / vec2(1.0, 1.0) + vec2(0.5, 0.5));
    vec4 n9_out = efxSample(efxFromUnit(n8_out));
    vec4 n10_out = (n7_out + n9_out);
    vec4 n11_out = (n10_out * vec4(0.333, 0.333, 0.333, 0.333));
    vec4 n12_l0 = n11_out;
    vec3 n12_rgb = (n12_l0.rgb / max(n12_l0.a, 0.0001));
    float n13_out = uSeed;
    float n14_out = efxFbm(uvSquare * 6.0 + n13_out, 4.0);
    float n15_out = efxNoise(uvSquare * 3.0 + n13_out);
    float n16_out = (n14_out * n15_out);
    vec3 n17_out = mix(n0_rgb, n12_rgb, n16_out);
    float n18_l0 = n0_alpha;
    vec4 n18_out = vec4(n17_out * n18_l0, n18_l0);
    vec4 outColor = clamp(n18_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}

void main(void)
{
    efxParticleBody();
    finalColor *= efxParticleColor() * uColor * uWorldColorAlpha;
}
