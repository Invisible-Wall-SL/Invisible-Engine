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

// A number hashed to 0…1.
float efxHash1(float n)
{
    return fract(sin(n * 12.9898 + 78.233) * 43758.5453);
}

// How bright a colour reads.
float efxLuma(vec3 rgb)
{
    return dot(rgb, vec3(0.299, 0.587, 0.114));
}
in vec4 uFx;
in float uSeed;
uniform float uP0;
uniform float uP1;
uniform float uP2;
uniform float uP3;
uniform float uP4;
uniform float uP5;

void efxGlsl_0(vec2 uv, float seed, float secs, float thick, float spin, out vec3 origin, out vec3 dir, out vec2 span, out vec3 state, out vec3 point, out vec4 turn)
{
    origin = vec3(0.0, 0.0, 0.0);
    dir = vec3(0.0, 0.0, 0.0);
    span = vec2(0.0, 0.0);
    state = vec3(0.0, 0.0, 0.0);
    point = vec3(0.0, 0.0, 0.0);
    turn = vec4(0.0, 0.0, 0.0, 0.0);
    float h = thick * 0.5;
    float h1 = efxHash1(seed);
    float h2 = efxHash1(seed + 31.7);
    vec3 k = vec3(efxHash1(seed + 7.3), efxHash1(seed + 13.1), efxHash1(seed + 23.9)) * 2.0 - 1.0;
    k = normalize(vec3(k.xy, k.z * 0.4) + vec3(0.001, 0.0, 0.0));
    float a = 6.2832 * (h1 + secs * spin * (0.6 + 0.8 * h2));
    float ca = cos(a);
    float sa = sin(a);
    vec2 c = (uv - 0.5) * 2.0;
    float rr = 1.0 + h * h;
    float cc = dot(c, c);
    vec3 o = vec3(c, -2.0);
    vec3 d = vec3(0.0, 0.0, 1.0);
    origin = o * ca - cross(k, o) * sa + k * dot(k, o) * (1.0 - ca);
    dir = d * ca - cross(k, d) * sa + k * dot(k, d) * (1.0 - ca);
    float px = 2.0 / max(efxSize().x, 1.0);
    float reach = sqrt(rr) + px;
    bool outside = cc > reach * reach;
    float chord = sqrt(max(rr - cc, 0.0));
    origin += dir * (2.0 - chord);
    span = vec2(2.0 * chord, px);
    state = vec3(0.0, 9.0, outside ? -1.0 : 0.0);
    point = origin;
    turn = vec4(k, a);
}

void efxGlsl_1(vec3 origin, vec3 dir, vec2 span, inout vec3 state, inout vec3 point, float thick, float rim, float rimHeight, float bevel)
{
    float h = thick * 0.5;
    float b = clamp(bevel, 0.0, 1.0) * h;
    for (int i = 0; i < 12; i++) {
        if (state.z != 0.0 || state.x > span.x) break;
        vec3 q = origin + dir * state.x;
        float r = length(q.xy);
        vec2 w = vec2(r - 1.0 + b, abs(q.z) - h + b);
        float s = min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - b;
        s = max(s, -max(r - 1.0 + rim, h - rimHeight * h - abs(q.z)));
        if (s < state.y) {
            state.y = s;
            point = q;
        }
        state.z = s < 0.001 ? 1.0 : 0.0;
        state.x += max(s, 0.002);
    }
}

void efxGlsl_2(vec2 span, vec3 state, vec3 point, float thick, float rim, float rimHeight, float bevel, out vec3 normal, out float cover)
{
    normal = vec3(0.0, 0.0, 0.0);
    cover = 0.0;
    float h = thick * 0.5;
    float b = clamp(bevel, 0.0, 1.0) * h;
    normal = vec3(0.0, 0.0, 1e-5);
    for (int i = 0; i < 4; i++) {
        float j = float(i);
        float ez = mod(j, 2.0) * 2.0 - 1.0;
        float ey = step(1.5, j) * 2.0 - 1.0;
        vec3 e = vec3(ey * ez, ey, ez);
        vec3 q = point + e * 0.002;
        float r = length(q.xy);
        vec2 w = vec2(r - 1.0 + b, abs(q.z) - h + b);
        float s = min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - b;
        s = max(s, -max(r - 1.0 + rim, h - rimHeight * h - abs(q.z)));
        normal += e * s;
    }
    normal = normalize(normal);
    cover = state.z > 0.5 ? 1.0 : (state.z < -0.5 ? 0.0 : clamp(1.0 - state.y / span.y, 0.0, 1.0));
}

void efxGlsl_3(vec3 point, vec3 normal, float cover, vec4 turn, float thick, float rim, float relief, out vec4 color)
{
    color = vec4(0.0, 0.0, 0.0, 0.0);
    float h = max(thick * 0.5, 0.001);
    float r = length(point.xy);
    bool edge = abs(normal.z) < 0.6 && r > 1.0 - rim * 0.5;
    bool back = point.z > 0.0;
    vec2 f = point.xy * 0.5 + 0.5;
    f.x = back ? 1.0 - f.x : f.x;
    vec2 g = vec2(0.5 - atan(point.y, point.x) / 6.2832, clamp(point.z / h * 0.5 + 0.5, 0.0, 1.0));
    vec2 at = edge ? g : f;
    vec2 tile = edge ? vec2(0.0, 0.5) : vec2(back ? 0.5 : 0.0, 0.0);
    vec2 u = tile + (0.01 + clamp(at, 0.0, 1.0) * 0.98) * 0.5;
    vec4 art = efxSample(efxFromUnit(u));
    float e0 = efxLuma(art.rgb);
    float ex = efxLuma(efxSample(efxFromUnit(u + vec2(0.004, 0.0))).rgb);
    float ey = efxLuma(efxSample(efxFromUnit(u + vec2(0.0, 0.004))).rgb);
    vec3 t1 = edge ? vec3(point.y, -point.x, 0.0) / max(r, 0.001) : vec3(back ? -1.0 : 1.0, 0.0, 0.0);
    vec3 t2 = edge ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    vec3 n = normalize(normal + relief * ((e0 - ex) * t1 + (e0 - ey) * t2));
    vec3 k = turn.xyz;
    float ca = cos(turn.w);
    float sa = sin(turn.w);
    n = n * ca + cross(k, n) * sa + k * dot(k, n) * (1.0 - ca);
    vec2 m = vec2(0.5, 0.5) + (0.01 + clamp(n.xy * 0.5 + 0.5, 0.0, 1.0) * 0.98) * 0.5;
    vec3 lit = art.rgb * efxSample(efxFromUnit(m)).rgb * 2.0;
    color = vec4(lit * cover, cover);
}

void efxParticleBody(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    vec2 n0_out = uv;
    float n1_out = uSeed;
    float n2_seconds = uFx.y;
    float n3_out = uP0;
    float n4_out = uP4;
    vec3 n5_o0;
    vec3 n5_o1;
    vec2 n5_o2;
    vec3 n5_o3;
    vec3 n5_o4;
    vec4 n5_o5;
    efxGlsl_0(n0_out, n1_out, n2_seconds, n3_out, n4_out, n5_o0, n5_o1, n5_o2, n5_o3, n5_o4, n5_o5);
    float n6_out = uP1;
    float n7_out = uP2;
    float n8_out = uP3;
    vec3 n9_o0 = n5_o3;
    vec3 n9_o1 = n5_o4;
    efxGlsl_1(n5_o0, n5_o1, n5_o2, n9_o0, n9_o1, n3_out, n6_out, n7_out, n8_out);
    vec3 n10_o0 = n9_o0;
    vec3 n10_o1 = n9_o1;
    efxGlsl_1(n5_o0, n5_o1, n5_o2, n10_o0, n10_o1, n3_out, n6_out, n7_out, n8_out);
    vec3 n11_o0;
    float n11_o1;
    efxGlsl_2(n5_o2, n10_o0, n10_o1, n3_out, n6_out, n7_out, n8_out, n11_o0, n11_o1);
    float n12_out = uP5;
    vec4 n13_o0;
    efxGlsl_3(n10_o1, n11_o0, n11_o1, n5_o5, n3_out, n6_out, n12_out, n13_o0);
    vec4 outColor = clamp(n13_o0, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}

void main(void)
{
    efxParticleBody();
    finalColor *= efxParticleColor() * uColor * uWorldColorAlpha;
}
