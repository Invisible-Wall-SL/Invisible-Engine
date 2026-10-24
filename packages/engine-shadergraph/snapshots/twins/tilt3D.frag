uniform vec4 uFx;
uniform float uP0;

void main(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    float n0_out = uP0;
    float n1_progress = uFx.x;
    float n1_intensity = uFx.z;
    float n2_out = (n0_out * n1_intensity);
    float n3_out = (uFx.w > 0.5 ? 1.0 : smoothstep(0.0, 0.15, n1_progress) * (1.0 - smoothstep(0.85, 1.0, n1_progress)));
    float n4_out = (n2_out * n3_out);
    float n5_out = (n4_out * 0.5);
    float n6_out = efxSinPi(2.0 * (1.0 * n1_progress + 0.25));
    float n7_out = (n5_out * n6_out);
    float n8_out = efxSinPi(2.0 * (1.0 * n1_progress + 0.0));
    float n9_out = (n4_out * n8_out);
    vec4 n10_l0 = efxPerspective(efxFromUnit(uv), vec3(radians(n7_out), radians(n9_out), 0.0), 3.24);
    vec2 n10_uv = efxToUnit(n10_l0.xy);
    float n10_facing = n10_l0.z;
    float n10_hit = n10_l0.w;
    vec4 n11_out = efxSample(efxFromUnit(n10_uv));
    float n12_out = mix(0.45, 1.0, n10_facing);
    vec4 n13_xyzw = vec4(n12_out, n12_out, n12_out, 1.0);
    vec4 n14_out = (n11_out * n13_xyzw);
    vec4 n15_out = (n14_out * clamp(n10_hit, 0.0, 1.0));
    vec4 outColor = clamp(n15_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}
