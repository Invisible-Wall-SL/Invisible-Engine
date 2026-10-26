uniform vec4 uFx;
uniform vec3 uP0;
uniform float uP1;

void main(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    vec4 pixel = efxSample(px);
    vec4 n0_l0 = pixel;
    vec3 n0_rgb = (n0_l0.rgb / max(n0_l0.a, 0.0001));
    float n0_alpha = n0_l0.a;
    vec3 n1_out = uP0;
    float n2_out = uP1;
    float n3_progress = uFx.x;
    float n3_intensity = uFx.z;
    float n4_out = (n2_out * n3_intensity);
    float n5_out = min(n4_out, 1.0);
    float n6_out = (n3_progress / 0.15);
    float n7_out = (n3_progress - 0.15);
    float n8_out = (n7_out / 0.85);
    float n9_out = (1.0 - n8_out);
    float n10_out = (n9_out * n9_out);
    float n11_out = step(0.15, n3_progress);
    float n12_out = mix(n6_out, n10_out, n11_out);
    float n13_out = (n5_out * n12_out);
    vec3 n14_out = mix(n0_rgb, n1_out, n13_out);
    float n15_l0 = n0_alpha;
    vec4 n15_out = vec4(n14_out * n15_l0, n15_l0);
    vec4 outColor = clamp(n15_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}
