uniform vec4 uFx;
uniform float uP0;
uniform float uP1;
uniform float uP2;

void main(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    float n0_out = uP0;
    float n1_out = (n0_out * 360.0);
    float n2_progress = uFx.x;
    float n2_intensity = uFx.z;
    float n2_looping = uFx.w;
    float n3_out = efxEaseInOut(n2_progress);
    float n4_out = mix(n3_out, n2_progress, n2_looping);
    float n5_out = (n1_out * n4_out);
    float n6_out = (n2_intensity * 0.12);
    float n7_out = efxSinPi(clamp(n2_progress, 0.0, 1.0));
    float n8_out = (n6_out * n7_out);
    float n9_out = uP1;
    float n10_out = mix(6.0, 1.4, clamp((n9_out - 0.0) / (1.0 - 0.0), 0.0, 1.0));
    vec4 n11_l0 = efxPerspective(efxFromUnit(uv), vec3(radians(n5_out), radians(0.0), n8_out), n10_out);
    vec2 n11_uv = efxToUnit(n11_l0.xy);
    float n11_facing = n11_l0.z;
    float n11_hit = n11_l0.w;
    vec4 n12_out = efxSample(efxFromUnit(n11_uv));
    float n13_out = mix(0.45, 1.0, n11_facing);
    float n14_out = uP2;
    float n15_out = mix(1.0, n13_out, n14_out);
    vec4 n16_xyzw = vec4(n15_out, n15_out, n15_out, 1.0);
    vec4 n17_out = (n12_out * n16_xyzw);
    vec4 n18_out = (n17_out * clamp(n11_hit, 0.0, 1.0));
    vec4 outColor = clamp(n18_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}
