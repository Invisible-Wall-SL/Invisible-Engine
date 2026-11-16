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
uniform vec3 uP1;
uniform float uP2;
uniform float uP3;
uniform float uP4;
uniform float uP5;
uniform float uP6;
uniform float uP7;
uniform float uP8;
uniform float uP9;
uniform float uP10;
uniform float uP11;

void efxGlsl_0(vec2 uv, float seed, float secs, float spin, out vec3 origin, out vec3 dir, out vec2 span, out vec3 hit, out vec4 turn)
{
    origin = vec3(0.0, 0.0, 0.0);
    dir = vec3(0.0, 0.0, 0.0);
    span = vec2(0.0, 0.0);
    hit = vec3(0.0, 0.0, 0.0);
    turn = vec4(0.0, 0.0, 0.0, 0.0);
    float h1 = efxHash1(seed);
    float h2 = efxHash1(seed + 31.7);
    vec3 k = vec3(efxHash1(seed + 7.3), efxHash1(seed + 13.1), efxHash1(seed + 23.9)) * 2.0 - 1.0;
    k = normalize(k + vec3(0.001, 0.0, 0.0));
    float a = 6.2832 * (h1 + secs * spin * (0.6 + 0.8 * h2));
    float ca = cos(a);
    float sa = sin(a);
    vec2 c = (uv - 0.5) * 2.2;
    float rr = 1.21;
    float cc = dot(c, c);
    vec3 o = vec3(c.x, -c.y, 2.0);
    vec3 d = vec3(0.0, 0.0, -1.0);
    origin = o * ca - cross(k, o) * sa + k * dot(k, o) * (1.0 - ca);
    dir = d * ca - cross(k, d) * sa + k * dot(k, d) * (1.0 - ca);
    float px = 2.2 / max(efxSize().x, 1.0);
    float chord = sqrt(max(rr - cc, 0.0));
    origin += dir * (2.0 - chord);
    span = vec2(cc > rr ? -1.0 : 1.0, px);
    hit = vec3(-9.0, 9.0, -1.0);
    turn = vec4(k, a);
}

void efxGlsl_1(vec3 origin, vec3 dir, inout vec3 hit, float cut, float table, float crown, float pavilion, float girdle)
{
    float cg = crown - girdle;
    float pg = pavilion - girdle;
    float tt = 1.0 - table;
    float drop = cut * 100.0;
    vec3 nx = vec3(cg, 1.0, pg);
    vec3 nz = vec3(tt, 0.0, -1.0);
    vec3 nd = vec3(cg + tt * girdle, 1.0, pavilion);
    vec3 code = vec3(0.0, 24.0, 40.0);
    mat2 turn8 = mat2(0.7071, 0.7071, -0.7071, 0.7071);
    vec2 az = vec2(1.0000, 0.0000);
    for (int i = 0; i < 8; i++) {
        vec3 dn = nx * dot(az, dir.xy) + nz * dir.z;
        dn += step(abs(dn), vec3(0.00001)) * 0.00002;
        vec3 t = (nd - nx * dot(az, origin.xy) - nz * origin.z) / dn;
        vec3 ent = mix(vec3(-9.0), t, step(dn, vec3(0.0)));
        vec3 lv = mix(vec3(9.0), t, step(vec3(0.0), dn));
        float m = max(max(ent.x, ent.y), ent.z);
        if (m > hit.x) hit = vec3(m, hit.y, dot(step(vec3(m), ent), code) + float(i));
        hit.y = min(hit.y, min(min(lv.x, lv.y), lv.z));
        az = turn8 * az;
    }
}

void efxGlsl_2(vec3 origin, vec3 dir, inout vec3 hit, float cut, float table, float crown, float pavilion, float girdle)
{
    float cg = crown - girdle;
    float pg = pavilion - girdle;
    float tt = 1.0 - table;
    float drop = cut * 100.0;
    vec4 nx = vec4(0.5 * cg, 1.15 * cg, 1.0, 1.04 * pg);
    vec4 nz = vec4(tt, tt, 0.0, -1.0);
    vec4 nd = vec4(0.5 * cg * table + tt * crown + drop, 1.15 * cg + tt * girdle + drop, 1.0 + drop, 1.04 * pg + girdle + drop);
    vec4 code = vec4(8.0, 16.0, 32.0, 48.0);
    mat2 turn8 = mat2(0.7071, 0.7071, -0.7071, 0.7071);
    vec2 az = vec2(0.9239, 0.3827);
    for (int i = 0; i < 8; i++) {
        vec4 dn = nx * dot(az, dir.xy) + nz * dir.z;
        dn += step(abs(dn), vec4(0.00001)) * 0.00002;
        vec4 t = (nd - nx * dot(az, origin.xy) - nz * origin.z) / dn;
        vec4 ent = mix(vec4(-9.0), t, step(dn, vec4(0.0)));
        vec4 lv = mix(vec4(9.0), t, step(vec4(0.0), dn));
        float m = max(max(max(ent.x, ent.y), ent.z), ent.w);
        if (m > hit.x) hit = vec3(m, hit.y, dot(step(vec4(m), ent), code) + float(i));
        hit.y = min(hit.y, min(min(min(lv.x, lv.y), lv.z), lv.w));
        az = turn8 * az;
    }
    float dz = abs(dir.z) < 0.00001 ? 0.00001 : dir.z;
    float tz = (crown - origin.z) / dz;
    if (dz < 0.0 && tz > hit.x) hit = vec3(tz, hit.y, 56.0);
    if (dz > 0.0) hit.y = min(hit.y, tz);
}

void efxGlsl_3(vec3 origin, vec3 dir, vec2 span, vec3 hit, float ior, float cut, float table, float crown, float pavilion, float girdle, out vec3 normal, out vec3 point, out vec3 inner, out float cover)
{
    normal = vec3(0.0, 0.0, 0.0);
    point = vec3(0.0, 0.0, 0.0);
    inner = vec3(0.0, 0.0, 0.0);
    cover = 0.0;
    float kk = hit.z;
    float fi = floor(kk / 8.0 + 0.01);
    float cg = crown - girdle;
    float pg = pavilion - girdle;
    float tt = 1.0 - table;
    float drop = cut * 100.0;
    vec3 fam = vec3(1.0, 0.0, 0.0);
    if (fi < 0.5) fam = vec3(cg, tt, 0.0000);
    else if (fi < 1.5) fam = vec3(0.5 * cg, tt, 0.3927);
    else if (fi < 2.5) fam = vec3(1.15 * cg, tt, 0.3927);
    else if (fi < 3.5) fam = vec3(1.0, 0.0, 0.0000);
    else if (fi < 4.5) fam = vec3(1.0, 0.0, 0.3927);
    else if (fi < 5.5) fam = vec3(pg, -1.0, 0.0000);
    else if (fi < 6.5) fam = vec3(1.04 * pg, -1.0, 0.3927);
    float ang = fam.z + (kk - fi * 8.0) * 0.7854;
    vec3 nrm = kk > 55.5 ? vec3(0.0, 0.0, 1.0) : normalize(vec3(fam.x * cos(ang), fam.x * sin(ang), fam.y));
    normal = nrm;
    point = origin + dir * hit.x;
    inner = refract(dir, nrm, 1.0 / ior);
    float gap = hit.y - hit.x;
    cover = span.x < 0.0 ? 0.0 : clamp(0.5 + gap / (2.0 * span.y), 0.0, 1.0);
}

void efxGlsl_4(vec3 point, vec3 inner, float cut, float table, float crown, float pavilion, float girdle, out vec2 leave)
{
    leave = vec2(0.0, 0.0);
    leave = vec2(9.0, -1.0);
    float cg = crown - girdle;
    float pg = pavilion - girdle;
    float tt = 1.0 - table;
    float drop = cut * 100.0;
    vec3 nx = vec3(cg, 1.0, pg);
    vec3 nz = vec3(tt, 0.0, -1.0);
    vec3 nd = vec3(cg + tt * girdle, 1.0, pavilion);
    vec3 code = vec3(0.0, 24.0, 40.0);
    mat2 turn8 = mat2(0.7071, 0.7071, -0.7071, 0.7071);
    vec2 az = vec2(1.0000, 0.0000);
    for (int i = 0; i < 8; i++) {
        vec3 dn = nx * dot(az, inner.xy) + nz * inner.z;
        vec3 t = (nd - nx * dot(az, point.xy) - nz * point.z) / max(dn, vec3(0.00001));
        vec3 lv = mix(vec3(9.0), t, step(vec3(0.00001), dn));
        float m = min(min(lv.x, lv.y), lv.z);
        if (m < leave.x) leave = vec2(m, dot(step(lv, vec3(m)), code) + float(i));
        az = turn8 * az;
    }
}

void efxGlsl_5(vec3 point, vec3 inner, inout vec2 leave, float cut, float table, float crown, float pavilion, float girdle)
{
    float cg = crown - girdle;
    float pg = pavilion - girdle;
    float tt = 1.0 - table;
    float drop = cut * 100.0;
    vec4 nx = vec4(0.5 * cg, 1.15 * cg, 1.0, 1.04 * pg);
    vec4 nz = vec4(tt, tt, 0.0, -1.0);
    vec4 nd = vec4(0.5 * cg * table + tt * crown + drop, 1.15 * cg + tt * girdle + drop, 1.0 + drop, 1.04 * pg + girdle + drop);
    vec4 code = vec4(8.0, 16.0, 32.0, 48.0);
    mat2 turn8 = mat2(0.7071, 0.7071, -0.7071, 0.7071);
    vec2 az = vec2(0.9239, 0.3827);
    for (int i = 0; i < 8; i++) {
        vec4 dn = nx * dot(az, inner.xy) + nz * inner.z;
        vec4 t = (nd - nx * dot(az, point.xy) - nz * point.z) / max(dn, vec4(0.00001));
        vec4 lv = mix(vec4(9.0), t, step(vec4(0.00001), dn));
        float m = min(min(min(lv.x, lv.y), lv.z), lv.w);
        if (m < leave.x) leave = vec2(m, dot(step(lv, vec4(m)), code) + float(i));
        az = turn8 * az;
    }
    float tz = (crown - point.z) / max(inner.z, 0.00001);
    if (inner.z > 0.00001 && tz < leave.x) leave = vec2(tz, 56.0);
}

void efxGlsl_6(vec2 leave, inout vec3 normal, inout vec3 inner, vec4 turn, float cut, float table, float crown, float pavilion, float girdle, out vec3 exitNormal)
{
    exitNormal = vec3(0.0, 0.0, 0.0);
    float kk = leave.y;
    float fi = floor(kk / 8.0 + 0.01);
    float cg = crown - girdle;
    float pg = pavilion - girdle;
    float tt = 1.0 - table;
    float drop = cut * 100.0;
    vec3 fam = vec3(1.0, 0.0, 0.0);
    if (fi < 0.5) fam = vec3(cg, tt, 0.0000);
    else if (fi < 1.5) fam = vec3(0.5 * cg, tt, 0.3927);
    else if (fi < 2.5) fam = vec3(1.15 * cg, tt, 0.3927);
    else if (fi < 3.5) fam = vec3(1.0, 0.0, 0.0000);
    else if (fi < 4.5) fam = vec3(1.0, 0.0, 0.3927);
    else if (fi < 5.5) fam = vec3(pg, -1.0, 0.0000);
    else if (fi < 6.5) fam = vec3(1.04 * pg, -1.0, 0.3927);
    float ang = fam.z + (kk - fi * 8.0) * 0.7854;
    vec3 nrm = kk > 55.5 ? vec3(0.0, 0.0, 1.0) : normalize(vec3(fam.x * cos(ang), fam.x * sin(ang), fam.y));
    vec3 k = turn.xyz;
    float ca = cos(turn.w);
    float sa = sin(turn.w);
    vec3 e = nrm * ca + cross(k, nrm) * sa + k * dot(k, nrm) * (1.0 - ca);
    e = vec3(e.x, -e.y, -e.z);
    vec3 f = normal * ca + cross(k, normal) * sa + k * dot(k, normal) * (1.0 - ca);
    f = vec3(f.x, -f.y, -f.z);
    vec3 g = inner * ca + cross(k, inner) * sa + k * dot(k, inner) * (1.0 - ca);
    g = vec3(g.x, -g.y, -g.z);
    exitNormal = e;
    normal = f;
    inner = g;
}

void efxGlsl_7(vec3 normal, vec3 inner, vec3 exitNormal, vec2 leave, float cover, float seed, float secs, vec3 tint, float ior, float fire, float depth, float glint, float sharpness, out vec4 color)
{
    color = vec4(0.0, 0.0, 0.0, 0.0);
    vec3 r = reflect(vec3(0.0, 0.0, 1.0), normal);
    float cosi = clamp(-normal.z, 0.0, 1.0);
    float f0 = (ior - 1.0) * (ior - 1.0) / ((ior + 1.0) * (ior + 1.0));
    float fres = f0 + (1.0 - f0) * pow(1.0 - cosi, 5.0);
    vec3 refl = efxSample(efxFromUnit(vec2(0.25, 0.25) + r.xy * 0.24)).rgb;
    vec3 lit = vec3(0.0);
    for (int ch = 0; ch < 3; ch++) {
        float j = float(ch);
        vec3 e = refract(inner, -exitNormal, ior + (j - 1.0) * fire);
        e = dot(e, e) < 0.01 ? reflect(inner, exitNormal) : e;
        vec3 s = efxSample(efxFromUnit(vec2(0.75, 0.25) + normalize(e).xy * 0.24)).rgb;
        lit += s * vec3(step(j, 0.5), step(0.5, j) * step(j, 1.5), step(1.5, j));
    }
    vec3 body = lit * pow(max(tint, vec3(0.001)), vec3(0.6 + depth * leave.x));
    float flash = pow(max(dot(r, vec3(-0.42, -0.5, -0.76)), 0.0), sharpness);
    float twinkle = 0.6 + 0.4 * sin(secs * 9.0 + efxHash1(leave.y + seed) * 6.2832);
    vec3 rgb = body * (1.0 - fres) + refl * fres * 1.6 + glint * flash * twinkle;
    color = vec4(rgb * cover, cover);
}

void efxParticleBody(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    vec2 n0_out = uv;
    float n1_out = uSeed;
    float n2_seconds = uFx.y;
    float n3_out = uP11;
    vec3 n4_o0;
    vec3 n4_o1;
    vec2 n4_o2;
    vec3 n4_o3;
    vec4 n4_o4;
    efxGlsl_0(n0_out, n1_out, n2_seconds, n3_out, n4_o0, n4_o1, n4_o2, n4_o3, n4_o4);
    float n5_out = uP0;
    float n6_out = uP2;
    float n7_out = uP3;
    float n8_out = uP4;
    float n9_out = uP5;
    vec3 n10_o0 = n4_o3;
    efxGlsl_1(n4_o0, n4_o1, n10_o0, n5_out, n6_out, n7_out, n8_out, n9_out);
    vec3 n11_o0 = n10_o0;
    efxGlsl_2(n4_o0, n4_o1, n11_o0, n5_out, n6_out, n7_out, n8_out, n9_out);
    float n12_out = uP6;
    vec3 n13_o0;
    vec3 n13_o1;
    vec3 n13_o2;
    float n13_o3;
    efxGlsl_3(n4_o0, n4_o1, n4_o2, n11_o0, n12_out, n5_out, n6_out, n7_out, n8_out, n9_out, n13_o0, n13_o1, n13_o2, n13_o3);
    vec2 n14_o0;
    efxGlsl_4(n13_o1, n13_o2, n5_out, n6_out, n7_out, n8_out, n9_out, n14_o0);
    vec2 n15_o0 = n14_o0;
    efxGlsl_5(n13_o1, n13_o2, n15_o0, n5_out, n6_out, n7_out, n8_out, n9_out);
    vec3 n16_o1 = n13_o0;
    vec3 n16_o2 = n13_o2;
    vec3 n16_o0;
    efxGlsl_6(n15_o0, n16_o1, n16_o2, n4_o4, n5_out, n6_out, n7_out, n8_out, n9_out, n16_o0);
    vec3 n17_out = uP1;
    float n18_out = uP7;
    float n19_out = uP8;
    float n20_out = uP9;
    float n21_out = uP10;
    vec4 n22_o0;
    efxGlsl_7(n16_o1, n16_o2, n16_o0, n15_o0, n13_o3, n1_out, n2_seconds, n17_out, n12_out, n18_out, n19_out, n20_out, n21_out, n22_o0);
    vec4 outColor = clamp(n22_o0, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}

void main(void)
{
    efxParticleBody();
    finalColor *= efxParticleColor() * uColor * uWorldColorAlpha;
}
