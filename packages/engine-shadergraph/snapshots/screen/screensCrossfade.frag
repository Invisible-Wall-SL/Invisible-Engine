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

uniform vec4 uFx;

void efxScreenBody(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    vec4 n0_from = efxScreenFrom(efxFromUnit(uv));
    vec4 n0_to = efxScreenTo(efxFromUnit(uv));
    float n1_progress = uFx.x;
    vec4 n2_out = mix(n0_from, n0_to, n1_progress);
    vec4 outColor = clamp(n2_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}

void main(void)
{
    efxScreenBody();
    finalColor += efxScreenFrom(efxPx()) * (1.0 - finalColor.a);
}
