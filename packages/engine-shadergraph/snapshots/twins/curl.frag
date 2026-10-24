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
    float n1_out = (n0_out * 0.5);
    float n2_out = fract(n1_out);
    float n3_out = (n2_out * 2.0);
    float n4_out = (1.0 - n3_out);
    float n5_out = step(1.5, n0_out);
    float n6_out = (1.0 - n5_out);
    vec2 n7_xy = vec2(n4_out, n6_out);
    float n8_progress = uFx.x;
    float n8_intensity = uFx.z;
    float n8_looping = uFx.w;
    float n9_out = efxHold(n8_progress, 0.1);
    float n10_out = efxSinPi(2.0 * (1.0 * n8_progress + 0.25));
    float n11_out = (0.5 * n10_out);
    float n12_out = (0.5 - n11_out);
    float n13_out = mix(n9_out, n12_out, n8_looping);
    float n14_out = uP1;
    float n15_out = (n14_out * n8_intensity);
    float n16_out = min(n15_out, 1.0);
    float n17_out = (n13_out * n16_out);
    float n18_out = uP2;
    float n19_out = (n18_out * 3.141592653589793);
    float n20_out = (n19_out + 1.0);
    float n21_out = (n17_out * n20_out);
    vec4 n22_out = efxCurl(px, n7_xy, n21_out, n18_out);
    vec4 outColor = clamp(n22_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}
