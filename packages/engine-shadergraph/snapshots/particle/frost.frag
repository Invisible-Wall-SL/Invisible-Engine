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

// How bright a colour reads.
float efxLuma(vec3 rgb)
{
    return dot(rgb, vec3(0.299, 0.587, 0.114));
}

// A 2-D point hashed to a point in the unit square.
vec2 efxHash2(vec2 p)
{
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

// A 2-D point hashed to 0…1, without sin (it holds up for large inputs).
float efxHash(vec2 p)
{
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

// Cellular noise: the distance to the nearest cell's centre, to the next nearest, and the nearest
// cell's own value, 0…1. `seed` moves the centres, `idSeed` the values.
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
}

// Eased in and out (cubic), 0…1.
float efxEaseInOut(float t)
{
    t = clamp(t, 0.0, 1.0);
    return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(2.0 - 2.0 * t, 3.0) / 2.0;
}

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
}

// 1 at `at`, falling smoothly to 0 by `width` either side of it.
float efxBand(float x, float at, float width)
{
    return 1.0 - smoothstep(0.0, width, abs(x - at));
}

// A glint sweeping diagonally across the element (u in its unit space), `at` 0…1 along its way.
float efxGlint(vec2 u, float at, float width)
{
    return efxBand(u.x + 0.6 * u.y, at * 1.6, width);
}

// How much px is on the element's outline: its alpha above the lowest of its four neighbours r px
// away.
float efxEdge(vec2 px, float alpha, float r)
{
    return alpha - min(
        min(efxSample(px + vec2(r, 0.0)).a, efxSample(px - vec2(r, 0.0)).a),
        min(efxSample(px + vec2(0.0, r)).a, efxSample(px - vec2(0.0, r)).a));
}

// 0 on the element's edge, 1 at its middle (u in its unit space).
float efxEdgeDistance(vec2 u)
{
    return 2.0 * min(min(u.x, 1.0 - u.x), min(u.y, 1.0 - u.y));
}

// How far something spreading over the element from `side` has come to reach u, 0…1: 0 from the
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
}
in vec4 uFx;
uniform vec3 uP0;

void efxParticleBody(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    vec4 pixel = efxSample(px);
    vec4 n0_l0 = pixel;
    vec3 n0_rgb = (n0_l0.rgb / max(n0_l0.a, 0.0001));
    float n0_alpha = n0_l0.a;
    vec3 n1_out = uP0;
    float n2_out = efxLuma(n0_rgb);
    float n3_out = mix(0.35, 1.25, clamp((n2_out - 0.0) / (1.0 - 0.0), 0.0, 1.0));
    vec3 n4_out = (n1_out * vec3(n3_out));
    vec3 n5_l0 = efxCells(uvSquare * 12.0, 0.0, 0.0 * 3.1);
    float n5_nearest = n5_l0.x;
    float n5_crack = (n5_l0.y - n5_l0.x);
    float n6_out = smoothstep(0.0, 0.05, n5_crack);
    float n7_out = (1.0 - n6_out);
    float n8_out = (n7_out * 0.3);
    float n9_progress = uFx.x;
    float n10_out = efxHold(n9_progress, 0.4);
    float n11_out = efxGlint(uv, n10_out, max(0.08, 0.0001));
    float n12_out = (n11_out * 0.5);
    float n13_out = (n8_out + n12_out);
    float n14_out = clamp(efxEdge(px, efxSample(px).a, 1.5), 0.0, 1.0);
    float n15_out = (n14_out * 0.6);
    float n16_out = (n13_out + n15_out);
    vec3 n17_out = (n4_out + vec3(n16_out));
    float n18_out = efxAway(uv, 2.0);
    float n19_out = (n18_out * 0.8);
    float n20_out = (n5_nearest * 0.2);
    float n21_out = (n19_out + n20_out);
    float n22_out = (n10_out * 1.25);
    float n23_out = (1.0 - smoothstep(n22_out - max(0.06, 0.0001), n22_out, n21_out));
    vec3 n24_out = mix(n0_rgb, n17_out, n23_out);
    float n25_l0 = n0_alpha;
    vec4 n25_out = vec4(n24_out * n25_l0, n25_l0);
    vec4 outColor = clamp(n25_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}

void main(void)
{
    efxParticleBody();
    finalColor *= efxParticleColor() * uColor * uWorldColorAlpha;
}
