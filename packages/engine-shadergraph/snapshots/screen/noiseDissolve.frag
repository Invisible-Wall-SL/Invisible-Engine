precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;
uniform sampler2D uFromTexture;
uniform float uEfxReverse;

const float PI = 3.14159265358979;

vec2 efxPx() { return vTextureCoord * uInputSize.xy; }
vec2 efxArea() { return max(uOutputFrame.zw, vec2(1.0)); }
vec2 efxSize() { return efxArea(); }
vec2 efxOrigin() { return vec2(0.0); }
vec2 efxCenter() { return 0.5 * efxSize(); }
vec2 efxToUnit(vec2 px) { return px / efxSize(); }
vec2 efxFromUnit(vec2 u) { return u * efxSize(); }

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
    vec2 u = px / efxArea();
    if (u.x < 0.0 || u.y < 0.0 || u.x > 1.0 || u.y > 1.0)
    {
        return vec4(0.0);
    }
    return texture(uFromTexture, u);
}

vec4 efxScreenTo(vec2 px) { return efxSample(px); }
float efxScreenReverse() { return uEfxReverse; }

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

// 1 at `at`, falling smoothly to 0 by `width` either side of it.
float efxBand(float x, float at, float width)
{
    return 1.0 - smoothstep(0.0, width, abs(x - at));
}
uniform vec4 uFx;
uniform vec3 uP0;
uniform float uP1;

void efxScreenBody(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    vec4 pixel = efxSample(px);
    vec3 n0_out = uP0;
    float n1_out = uP1;
    float n2_out = efxNoise(uvSquare * n1_out + 0.0);
    float n3_progress = uFx.x;
    float n4_out = efxBand(n2_out, n3_progress, max(0.06, 0.0001));
    vec4 n5_l0 = pixel;
    float n5_alpha = n5_l0.a;
    float n6_out = (n4_out * n5_alpha);
    float n7_l0 = n6_out;
    vec4 n7_out = vec4(n0_out * n7_l0, n7_l0);
    float n8_out = (n3_progress + 0.04);
    float n9_out = smoothstep(n3_progress, n8_out, n2_out);
    vec4 n10_out = (pixel * clamp(n9_out, 0.0, 1.0));
    vec4 n11_l0 = n7_out;
    vec4 n11_out = (n11_l0 + n10_out * (1.0 - n11_l0.a));
    vec4 outColor = clamp(n11_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}

void main(void)
{
    efxScreenBody();
    finalColor += efxScreenFrom(efxPx()) * (1.0 - finalColor.a);
}
