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

// A number hashed to 0…1.
float efxHash1(float n)
{
    return fract(sin(n * 12.9898 + 78.233) * 43758.5453);
}

// rgb turned `turns` round the colour wheel, keeping its brightness (in YIQ).
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
    float n1_out = uSeed;
    float n2_out = efxHash1(n1_out);
    vec3 n3_out = efxHueShift(n0_rgb, n2_out);
    float n4_l0 = n0_alpha;
    vec4 n4_out = vec4(n3_out * n4_l0, n4_l0);
    vec4 outColor = clamp(n4_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}

void main(void)
{
    efxParticleBody();
    finalColor *= efxParticleColor() * uColor * uWorldColorAlpha;
}
