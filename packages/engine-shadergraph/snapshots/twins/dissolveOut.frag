uniform vec4 uFx;
uniform float uSeed;
uniform vec3 uP0;
uniform float uP1;
uniform float uP2;

void main(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    vec4 pixel = efxSample(px);
    vec3 n0_out = uP0;
    vec3 n1_out = (n0_out * vec3(1.6, 1.6, 1.6));
    vec3 n2_out = min(n1_out, vec3(1.0, 1.0, 1.0));
    vec4 n3_l0 = pixel;
    vec3 n3_rgb = (n3_l0.rgb / max(n3_l0.a, 0.0001));
    float n3_alpha = n3_l0.a;
    vec2 n4_out = uvSquare;
    float n5_out = uP2;
    vec2 n6_out = (n4_out * vec2(n5_out));
    float n7_out = uSeed;
    vec2 n8_out = (n6_out + vec2(n7_out));
    float n9_out = efxNoise(n8_out * 1.0 + 0.0);
    float n10_out = (0.55 * n9_out);
    float n11_out = efxNoise(n8_out * 2.03 + 7.1);
    float n12_out = (0.3 * n11_out);
    float n13_out = (n10_out + n12_out);
    float n14_out = efxNoise(n8_out * 4.01 + 3.7);
    float n15_out = (0.15 * n14_out);
    float n16_out = (n13_out + n15_out);
    float n17_progress = uFx.x;
    float n18_out = uP1;
    float n19_out = (1.0 + n18_out);
    float n20_out = (n17_progress * n19_out);
    float n21_out = (n20_out - n18_out);
    float n22_out = (n16_out - n21_out);
    float n23_out = max(n18_out, 0.0001);
    float n24_out = (n22_out / n23_out);
    float n25_out = clamp(n24_out, 0.0, 1.0);
    vec3 n26_out = mix(n2_out, n3_rgb, n25_out);
    float n27_out = step(n21_out, n16_out);
    float n28_out = (n3_alpha * n27_out);
    float n29_l0 = n28_out;
    vec4 n29_out = vec4(n26_out * n29_l0, n29_l0);
    vec4 outColor = clamp(n29_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}
