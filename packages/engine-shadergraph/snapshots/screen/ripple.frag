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

// A shock ring `at` diagonals out and `width` element sizes wide, pushing outward by `amount`
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
}
uniform vec4 uFx;

void efxScreenBody(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    vec3 n0_l0 = efxRipple(efxFromUnit(uv), uFx.x, 0.12, 0.04);
    vec2 n0_uv = efxToUnit(n0_l0.xy);
    float n0_ring = n0_l0.z;
    vec4 n1_out = efxSample(efxFromUnit(n0_uv));
    vec4 n2_l0 = n1_out;
    vec3 n2_rgb = (n2_l0.rgb / max(n2_l0.a, 0.0001));
    float n2_alpha = n2_l0.a;
    float n3_out = (n0_ring * 0.45);
    vec3 n4_out = (n2_rgb + vec3(n3_out));
    float n5_l0 = n2_alpha;
    vec4 n5_out = vec4(n4_out * n5_l0, n5_l0);
    vec4 outColor = clamp(n5_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}

void main(void)
{
    efxScreenBody();
    finalColor += efxScreenFrom(efxPx()) * (1.0 - finalColor.a);
}
