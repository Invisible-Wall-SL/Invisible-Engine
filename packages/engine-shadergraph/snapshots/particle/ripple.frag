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
in vec4 uFx;

void efxParticleBody(void)
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
    efxParticleBody();
    finalColor *= efxParticleColor() * uColor * uWorldColorAlpha;
}
