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

// How bright a colour reads.
float efxLuma(vec3 rgb)
{
    return dot(rgb, vec3(0.299, 0.587, 0.114));
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
    vec3 n1_out = uP0;
    vec3 n2_out = (vec3(efxLuma(n0_rgb)) * n1_out);
    float n3_progress = uFx.x;
    float n3_intensity = uFx.z;
    float n4_out = (0.5 - 0.5 * cos(2.0 * PI * n3_progress));
    float n5_out = (n4_out * n3_intensity);
    vec3 n6_out = mix(n0_rgb, n2_out, n5_out);
    float n7_l0 = n0_alpha;
    vec4 n7_out = vec4(n6_out * n7_l0, n7_l0);
    vec4 outColor = clamp(n7_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}

void main(void)
{
    efxScreenBody();
    finalColor += efxScreenFrom(efxPx()) * (1.0 - finalColor.a);
}
