precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;
uniform sampler2D uFromTexture;
uniform float uEfxReverse;
uniform float uScreenPad;

const float PI = 3.14159265358979;

vec2 efxPx() { return vTextureCoord * uInputSize.xy; }
vec2 efxArea() { return max(uOutputFrame.zw - 2.0 * uScreenPad, vec2(1.0)); }
vec2 efxSize() { return efxArea(); }
vec2 efxOrigin() { return vec2(uScreenPad); }
vec2 efxCenter() { return efxOrigin() + 0.5 * efxSize(); }
vec2 efxToUnit(vec2 px) { return (px - efxOrigin()) / efxSize(); }
vec2 efxFromUnit(vec2 u) { return efxOrigin() + u * efxSize(); }

vec4 efxSample(vec2 px)
{
    vec2 uv = px * uInputSize.zw;
    vec2 edge = uOutputFrame.zw * uInputSize.zw;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > edge.x || uv.y > edge.y)
    {
        return vec4(0.0);
    }
    return texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw));
}

bool efxInside(vec2 px)
{
    vec2 u = efxToUnit(px);
    return u.x >= 0.0 && u.y >= 0.0 && u.x <= 1.0 && u.y <= 1.0;
}

vec4 efxParticleColor() { return vec4(1.0); }
float efxParticleWave() { return 0.0; }
float efxParticleOrder() { return 0.0; }

vec4 efxScreenFrom(vec2 px)
{
    vec2 u = efxToUnit(px);
    if (u.x < 0.0 || u.y < 0.0 || u.x > 1.0 || u.y > 1.0)
    {
        return vec4(0.0);
    }
    return texture(uFromTexture, u);
}

vec4 efxScreenTo(vec2 px) { return efxSample(px); }
float efxScreenReverse() { return uEfxReverse; }

// How bright a colour reads.
float efxLuma(vec3 rgb)
{
    return dot(rgb, vec3(0.299, 0.587, 0.114));
}

// The element's height at px, for a relief: its outline, raised where the art is light.
float efxHeight(vec2 px)
{
    vec4 s = efxSample(px);
    return 0.6 * s.a + 0.4 * efxLuma(s.rgb);
}

// How steeply the element's relief (efxHeight) climbs at px, read 1.5 px either side: .x rightward,
// .y downward. Petrify carves with it; efxReliefNormal turns it into a surface direction.
vec2 efxReliefSlope(vec2 px)
{
    float e = 1.5;
    return vec2(
        efxHeight(px + vec2(e, 0.0)) - efxHeight(px - vec2(e, 0.0)),
        efxHeight(px + vec2(0.0, e)) - efxHeight(px - vec2(0.0, e)));
}

// The element's relief at px as a surface normal (+z towards the viewer): efxHeight's slope 1.5 px
// either side, steeper with `strength`.
vec3 efxReliefNormal(vec2 px, float strength)
{
    return normalize(vec3(-strength * efxReliefSlope(px), 1.0));
}

// How lit a surface facing `normal` is from `light` (+z towards the viewer): .x diffuse, .y a
// highlight as sharp as `shininess`.
vec2 efxLight(vec3 normal, vec3 light, float shininess)
{
    vec3 l = normalize(light);
    float diffuse = max(dot(normal, l), 0.0);
    float spec = pow(max(dot(reflect(-l, normal), vec3(0.0, 0.0, 1.0)), 0.0), max(shininess, 1.0));
    return vec2(diffuse, spec);
}

// A metal's shade t, 0…1: a deep version of `base`, `base`, then near white.
vec3 efxMetalRamp(vec3 base, float t)
{
    vec3 deep = base * base * 0.35;
    vec3 pale = mix(base, vec3(1.0), 0.75);
    return t < 0.5 ? mix(deep, base, t * 2.0) : mix(base, pale, t * 2.0 - 1.0);
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
uniform vec4 uFx;
uniform vec3 uP0;

void efxScreenBody(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    vec4 pixel = efxSample(px);
    vec4 n0_l0 = pixel;
    vec3 n0_rgb = (n0_l0.rgb / max(n0_l0.a, 0.0001));
    float n0_alpha = n0_l0.a;
    float n1_out = efxLuma(n0_rgb);
    float n2_out = (n1_out * 0.32);
    float n3_out = (n2_out + 0.06);
    vec3 n4_out = efxReliefNormal(efxFromUnit(uv), 2.5);
    vec2 n5_l0 = efxLight(n4_out, vec3((-0.5), (-0.6), 0.65), 18.0);
    float n5_diffuse = n5_l0.x;
    float n5_specular = n5_l0.y;
    float n6_out = (n5_diffuse * 0.62);
    float n7_out = (n3_out + n6_out);
    vec3 n8_out = uP0;
    vec3 n9_out = efxMetalRamp(n8_out, clamp(n7_out, 0.0, 1.0));
    float n10_out = (n5_specular * 0.9);
    vec3 n11_out = (n9_out + vec3(n10_out));
    float n12_progress = uFx.x;
    float n13_out = efxHold(n12_progress, 0.4);
    float n14_out = efxGlint(uv, n13_out, max(0.07, 0.0001));
    float n15_out = (n14_out * 0.55);
    vec3 n16_out = (n11_out + vec3(n15_out));
    float n17_out = efxAway(uv, 3.0);
    float n18_out = (n13_out * 1.22);
    float n19_out = (1.0 - smoothstep(n18_out - max(0.04, 0.0001), n18_out, n17_out));
    vec3 n20_out = mix(n0_rgb, n16_out, n19_out);
    float n21_l0 = n0_alpha;
    vec4 n21_out = vec4(n20_out * n21_l0, n21_l0);
    vec4 outColor = clamp(n21_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}

void main(void)
{
    efxScreenBody();
    finalColor += efxScreenFrom(efxPx()) * (1.0 - finalColor.a);
}
