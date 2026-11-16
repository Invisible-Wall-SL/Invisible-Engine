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
in vec4 uFx;
in float uSeed;
uniform float uP0;
uniform float uP1;
uniform float uP2;
uniform float uP3;
uniform float uP4;
uniform float uP5;

void efxGlsl_0(vec2 uv, float seed, float secs, float along, float curl, float amp, float speed, float flutter, float spin, out vec3 origin, out vec3 dir, out vec2 span, out vec4 bend, out vec4 wave, out vec4 hit, out vec4 turn)
{
    origin = vec3(0.0, 0.0, 0.0);
    dir = vec3(0.0, 0.0, 0.0);
    span = vec2(0.0, 0.0);
    bend = vec4(0.0, 0.0, 0.0, 0.0);
    wave = vec4(0.0, 0.0, 0.0, 0.0);
    hit = vec4(0.0, 0.0, 0.0, 0.0);
    turn = vec4(0.0, 0.0, 0.0, 0.0);
    float h1 = efxHash1(seed);
    float h2 = efxHash1(seed + 31.7);
    float h3 = efxHash1(seed + 47.3);
    float h4 = efxHash1(seed + 59.9);
    vec3 k = vec3(efxHash1(seed + 7.3), efxHash1(seed + 13.1), efxHash1(seed + 23.9)) * 2.0 - 1.0;
    k = normalize(k + vec3(0.001, 0.0, 0.0));
    float a = 6.2832 * (h1 + secs * spin * (0.6 + 0.8 * h2));
    float ca = cos(a);
    float sa = sin(a);
    vec2 c = (uv - 0.5) * 2.0;
    float rr = 1.5043;
    float cc = dot(c, c);
    vec3 o = vec3(c, -2.0);
    vec3 d = vec3(0.0, 0.0, 1.0);
    origin = o * ca - cross(k, o) * sa + k * dot(k, o) * (1.0 - ca);
    dir = d * ca - cross(k, d) * sa + k * dot(k, d) * (1.0 - ca);
    float chord = sqrt(max(rr - cc, 0.0));
    origin += dir * (2.0 - chord);
    span = vec2(cc > rr ? -1.0 : 2.0 * chord, 2.0 / max(efxSize().x, 1.0));
    float flap = 6.2832 * secs * flutter * (0.6 + 0.8 * h4);
    float breathe = 0.5 + 0.5 * sin(6.2832 * h3 + flap);
    float len = along > 0.5 ? 0.4375 : 1.0;
    bend = vec4(max(curl * 1.5708 * mix(0.3, 1.0, breathe) / len, 0.01), len, 0.0, along);
    float run = 6.2832 * secs * speed;
    wave = vec4(min(amp, 0.10), 6.2832 * h4 - run, 6.2832 * h2 - flap * 1.3, 0.0);
    hit = vec4(-1.0, 0.0, 0.0, 9.0);
    turn = vec4(k, a);
}

void efxGlsl_1(vec3 origin, vec3 dir, vec2 span, vec4 bend, out vec2 cands)
{
    cands = vec2(0.0, 0.0);
    float kap = bend.x;
    vec3 q = bend.w > 0.5 ? origin.yxz : origin;
    vec3 e = bend.w > 0.5 ? dir.yxz : dir;
    float qa = kap * dot(e.xz, e.xz);
    float qb = kap * dot(q.xz, e.xz) - e.z;
    float qc = kap * dot(q.xz, q.xz) - 2.0 * q.z;
    float disc = qb * qb - qa * qc;
    cands = vec2(-1.0);
    if (span.x > 0.0 && disc >= 0.0) {
        float r = -(qb + (qb < 0.0 ? -1.0 : 1.0) * sqrt(disc));
        float t1 = abs(qa) > 0.000001 ? r / qa : 99.0;
        float t2 = abs(r) > 0.000001 ? qc / r : 99.0;
        cands = vec2(min(t1, t2), max(t1, t2));
    }
}

void efxGlsl_2(vec3 origin, vec3 dir, vec2 span, vec4 bend, vec4 wave, vec2 cands, inout vec4 hit)
{
    float t0 = cands.x;
    if (hit.x < 0.0 && t0 >= 0.0 && t0 <= span.x) {
        float kap = bend.x;
        vec3 o3 = bend.w > 0.5 ? origin.yxz : origin;
        vec3 e3 = bend.w > 0.5 ? dir.yxz : dir;
        vec3 q0 = o3 + e3 * t0;
        float slope = abs(dot(e3.xz, vec2(kap * q0.x, kap * q0.z - 1.0)));
        float dl = wave.x * 1.4 / max(slope, 0.25);
        vec4 found = vec4(-1.0, 0.0, 0.0, 0.0);
        float ta = t0;
        float ga = 0.0;
        vec2 sa = vec2(0.0);
        for (int i = 0; i <= 8; i++) {
            float tb = t0 + dl * (float(i) * 0.2500 - 1.0);
            vec3 p = o3 + e3 * tb;
            float w = kap * dot(p.xz, p.xz) - 2.0 * p.z;
            float dist = w / (1.0 + sqrt(max(1.0 + kap * w, 0.0)));
            vec2 sb = vec2(atan(kap * p.x, 1.0 - kap * p.z) / kap, p.y);
            sb = bend.w > 0.5 ? sb.yx : sb;
            float gb = dist - wave.x * (sin(3.0 * sb.x + wave.y) + 0.35 * sin(5.0 * sb.y + 2.0 * sb.x + wave.z));
            if (i == 4) found = vec4(tb, sb, 0.0);
            if (i > 0 && ga * gb <= 0.0) {
                float f = abs(ga - gb) > 0.0000001 ? ga / (ga - gb) : 0.0;
                found = vec4(mix(ta, tb, f), mix(sa, sb, f), 0.0);
                break;
            }
            ta = tb;
            ga = gb;
            sa = sb;
        }
        float beyond = max(abs(found.y) - 1.0, abs(found.z) - 0.4375);
        if (found.x >= 0.0 && beyond < 0.5 * span.y) hit = vec4(found.xyz, beyond);
    }
}

void efxGlsl_3(vec3 origin, vec3 dir, vec2 span, vec4 bend, vec4 wave, vec2 cands, inout vec4 hit)
{
    float t0 = cands.y;
    if (hit.x < 0.0 && t0 >= 0.0 && t0 <= span.x) {
        float kap = bend.x;
        vec3 o3 = bend.w > 0.5 ? origin.yxz : origin;
        vec3 e3 = bend.w > 0.5 ? dir.yxz : dir;
        vec3 q0 = o3 + e3 * t0;
        float slope = abs(dot(e3.xz, vec2(kap * q0.x, kap * q0.z - 1.0)));
        float dl = wave.x * 1.4 / max(slope, 0.25);
        vec4 found = vec4(-1.0, 0.0, 0.0, 0.0);
        float ta = t0;
        float ga = 0.0;
        vec2 sa = vec2(0.0);
        for (int i = 0; i <= 8; i++) {
            float tb = t0 + dl * (float(i) * 0.2500 - 1.0);
            vec3 p = o3 + e3 * tb;
            float w = kap * dot(p.xz, p.xz) - 2.0 * p.z;
            float dist = w / (1.0 + sqrt(max(1.0 + kap * w, 0.0)));
            vec2 sb = vec2(atan(kap * p.x, 1.0 - kap * p.z) / kap, p.y);
            sb = bend.w > 0.5 ? sb.yx : sb;
            float gb = dist - wave.x * (sin(3.0 * sb.x + wave.y) + 0.35 * sin(5.0 * sb.y + 2.0 * sb.x + wave.z));
            if (i == 4) found = vec4(tb, sb, 0.0);
            if (i > 0 && ga * gb <= 0.0) {
                float f = abs(ga - gb) > 0.0000001 ? ga / (ga - gb) : 0.0;
                found = vec4(mix(ta, tb, f), mix(sa, sb, f), 0.0);
                break;
            }
            ta = tb;
            ga = gb;
            sa = sb;
        }
        float beyond = max(abs(found.y) - 1.0, abs(found.z) - 0.4375);
        if (found.x >= 0.0 && beyond < 0.5 * span.y) hit = vec4(found.xyz, beyond);
    }
}

void efxGlsl_4(vec3 dir, vec2 span, vec4 bend, vec4 wave, vec4 hit, vec4 turn, out vec4 color)
{
    color = vec4(0.0, 0.0, 0.0, 0.0);
    float th = bend.x * (bend.w > 0.5 ? hit.z : hit.y);
    float c2 = cos(5.0 * hit.z + 2.0 * hit.y + wave.z);
    vec2 dh = wave.x * vec2(3.0 * cos(3.0 * hit.y + wave.y) + 0.7 * c2, 1.75 * c2);
    dh = bend.w > 0.5 ? dh.yx : dh;
    vec3 n = vec3(sin(th), 0.0, -cos(th)) - dh.x * vec3(cos(th), 0.0, sin(th)) - vec3(0.0, dh.y, 0.0);
    n = normalize(bend.w > 0.5 ? n.yxz : n);
    bool back = dot(n, dir) > 0.0;
    n = back ? -n : n;
    vec2 f = vec2(hit.y * 0.5 + 0.5, hit.z * 1.1429 + 0.5);
    f.x = back ? 1.0 - f.x : f.x;
    vec2 u = vec2(0.002 + clamp(f.x, 0.0, 1.0) * 0.996, (back ? 0.4375 : 0.0) + (0.004 + clamp(f.y, 0.0, 1.0) * 0.992) * 0.4375);
    vec4 art = efxSample(efxFromUnit(u));
    vec3 k = turn.xyz;
    float ca = cos(turn.w);
    float sa = sin(turn.w);
    n = n * ca + cross(k, n) * sa + k * dot(k, n) * (1.0 - ca);
    vec2 m = vec2(0.0, 0.875) + (0.04 + clamp(n.xy * 0.5 + 0.5, 0.0, 1.0) * 0.92) * 0.125;
    vec3 lit = art.rgb * efxSample(efxFromUnit(m)).rgb * 2.0;
    float cover = hit.x < 0.0 ? 0.0 : clamp(0.5 - hit.w / span.y, 0.0, 1.0);
    color = vec4(lit * cover, art.a * cover);
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
    float n4_out = uP1;
    float n5_out = uP2;
    float n6_out = uP3;
    float n7_out = uP4;
    float n8_out = uP5;
    vec3 n9_o0;
    vec3 n9_o1;
    vec2 n9_o2;
    vec4 n9_o3;
    vec4 n9_o4;
    vec4 n9_o5;
    vec4 n9_o6;
    efxGlsl_0(n0_out, n1_out, n2_seconds, n3_out, n4_out, n5_out, n6_out, n7_out, n8_out, n9_o0, n9_o1, n9_o2, n9_o3, n9_o4, n9_o5, n9_o6);
    vec2 n10_o0;
    efxGlsl_1(n9_o0, n9_o1, n9_o2, n9_o3, n10_o0);
    vec4 n11_o0 = n9_o5;
    efxGlsl_2(n9_o0, n9_o1, n9_o2, n9_o3, n9_o4, n10_o0, n11_o0);
    vec4 n12_o0 = n11_o0;
    efxGlsl_3(n9_o0, n9_o1, n9_o2, n9_o3, n9_o4, n10_o0, n12_o0);
    vec4 n13_o0;
    efxGlsl_4(n9_o1, n9_o2, n9_o3, n9_o4, n12_o0, n9_o6, n13_o0);
    vec4 outColor = clamp(n13_o0, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}

void main(void)
{
    efxParticleBody();
    finalColor *= efxParticleColor() * uColor * uWorldColorAlpha;
}
