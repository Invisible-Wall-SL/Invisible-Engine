uniform vec4 uFx;
uniform float uP0;
uniform float uP1;
uniform float uP2;

void main(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    float n0_out = uP1;
    float n1_progress = uFx.x;
    float n1_intensity = uFx.z;
    float n2_out = (n0_out * n1_intensity);
    float n3_out = (1.0 - n1_progress);
    float n4_out = (n2_out * n3_out);
    float n5_out = efxSinPi(2.0 * (1.5 * n1_progress + 0.0));
    float n6_out = (n4_out * n5_out);
    float n7_out = (n4_out * 0.7);
    float n8_out = efxSinPi(2.0 * (1.0 * n1_progress + 0.0954929658551372));
    float n9_out = (n7_out * n8_out);
    float n10_out = uP2;
    vec2 n11_l0 = efxBounce(n1_progress, n10_out);
    float n11_height = n11_l0.x;
    float n12_out = uP0;
    float n13_out = (n11_height * n12_out);
    float n14_out = (n13_out * n1_intensity);
    vec4 n15_l0 = efxPerspective(efxFromUnit(uv), vec3(radians(n6_out), radians(n9_out), n14_out), 3.47);
    vec2 n15_uv = efxToUnit(n15_l0.xy);
    float n15_facing = n15_l0.z;
    float n15_hit = n15_l0.w;
    vec4 n16_out = efxSample(efxFromUnit(n15_uv));
    float n17_out = mix(0.45, 1.0, n15_facing);
    vec4 n18_xyzw = vec4(n17_out, n17_out, n17_out, 1.0);
    vec4 n19_out = (n16_out * n18_xyzw);
    vec4 n20_out = (n19_out * clamp(n15_hit, 0.0, 1.0));
    vec4 outColor = clamp(n20_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}
