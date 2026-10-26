uniform vec4 uFx;
uniform vec3 uP0;

void main(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    vec4 pixel = efxSample(px);
    vec4 n0_l0 = pixel;
    vec3 n0_rgb = (n0_l0.rgb / max(n0_l0.a, 0.0001));
    float n0_alpha = n0_l0.a;
    float n1_out = efxLuma(n0_rgb);
    float n2_out = (n1_out * 0.32);
    float n3_out = (n2_out + 0.06);
    vec3 n4_out = efxReliefNormal(efxFromUnit(uv), 2.5);
    vec2 n5_l0 = efxLight(n4_out, vec3((-0.5), (-0.6), 0.65), 18.0);
    float n5_diffuse = n5_l0.x;
    float n5_specular = n5_l0.y;
    float n6_out = (n5_diffuse * 0.62);
    float n7_out = (n3_out + n6_out);
    vec3 n8_out = uP0;
    vec3 n9_out = efxMetalRamp(n8_out, clamp(n7_out, 0.0, 1.0));
    float n10_out = (n5_specular * 0.9);
    vec3 n11_out = (n9_out + vec3(n10_out));
    float n12_progress = uFx.x;
    float n13_out = efxHold(n12_progress, 0.4);
    float n14_out = efxGlint(uv, n13_out, max(0.07, 0.0001));
    float n15_out = (n14_out * 0.55);
    vec3 n16_out = (n11_out + vec3(n15_out));
    float n17_out = efxAway(uv, 3.0);
    float n18_out = (n13_out * 1.22);
    float n19_out = (1.0 - smoothstep(n18_out - max(0.04, 0.0001), n18_out, n17_out));
    vec3 n20_out = mix(n0_rgb, n16_out, n19_out);
    float n21_l0 = n0_alpha;
    vec4 n21_out = vec4(n20_out * n21_l0, n21_l0);
    vec4 outColor = clamp(n21_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}
