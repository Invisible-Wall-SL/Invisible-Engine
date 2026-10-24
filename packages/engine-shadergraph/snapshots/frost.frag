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
    vec3 n1_out = uP0;
    float n2_out = efxLuma(n0_rgb);
    float n3_out = mix(0.35, 1.25, clamp((n2_out - 0.0) / (1.0 - 0.0), 0.0, 1.0));
    vec3 n4_out = (n1_out * vec3(n3_out));
    vec3 n5_l0 = efxCells(uvSquare * 12.0, 0.0, 0.0 * 3.1);
    float n5_nearest = n5_l0.x;
    float n5_crack = (n5_l0.y - n5_l0.x);
    float n6_out = smoothstep(0.0, 0.05, n5_crack);
    float n7_out = (1.0 - n6_out);
    float n8_out = (n7_out * 0.3);
    float n9_progress = uFx.x;
    float n10_out = efxHold(n9_progress, 0.4);
    float n11_out = efxGlint(uv, n10_out, max(0.08, 0.0001));
    float n12_out = (n11_out * 0.5);
    float n13_out = (n8_out + n12_out);
    float n14_out = clamp(efxEdge(px, efxSample(px).a, 1.5), 0.0, 1.0);
    float n15_out = (n14_out * 0.6);
    float n16_out = (n13_out + n15_out);
    vec3 n17_out = (n4_out + vec3(n16_out));
    float n18_out = efxAway(uv, 2.0);
    float n19_out = (n18_out * 0.8);
    float n20_out = (n5_nearest * 0.2);
    float n21_out = (n19_out + n20_out);
    float n22_out = (n10_out * 1.25);
    float n23_out = (1.0 - smoothstep(n22_out - max(0.06, 0.0001), n22_out, n21_out));
    vec3 n24_out = mix(n0_rgb, n17_out, n23_out);
    float n25_l0 = n0_alpha;
    vec4 n25_out = vec4(n24_out * n25_l0, n25_l0);
    vec4 outColor = clamp(n25_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}
