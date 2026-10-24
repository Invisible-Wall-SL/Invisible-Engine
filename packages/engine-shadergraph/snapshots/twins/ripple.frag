uniform vec4 uFx;
uniform float uP0;
uniform float uP1;

void main(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    float n0_progress = uFx.x;
    float n0_intensity = uFx.z;
    float n1_out = (n0_progress * 0.6);
    float n2_out = uP1;
    float n3_out = uP0;
    float n4_out = (n3_out * n0_intensity);
    float n5_out = (1.0 - n0_progress);
    float n6_out = (n4_out * n5_out);
    vec3 n7_l0 = efxRipple(efxFromUnit(uv), n1_out, n2_out, n6_out);
    vec2 n7_uv = efxToUnit(n7_l0.xy);
    float n7_ring = n7_l0.z;
    vec4 n8_out = efxSample(efxFromUnit(n7_uv));
    vec4 n9_l0 = n8_out;
    float n9_w = n9_l0.w;
    float n10_out = min(n0_intensity, 2.0);
    float n11_out = (n10_out * 0.25);
    float n12_out = (n11_out * n5_out);
    float n13_out = (n9_w * n12_out);
    float n14_out = (n13_out * n7_ring);
    vec4 n15_xyzw = vec4(n14_out, n14_out, n14_out, 0.0);
    vec4 n16_out = (n8_out + n15_xyzw);
    vec4 outColor = clamp(n16_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}
