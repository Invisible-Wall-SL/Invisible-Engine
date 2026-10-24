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
    float n10_l0 = efxSinPi(n8_progress);
    float n10_out = (n10_l0 * n10_l0);
    float n11_out = mix(n9_out, n10_out, n8_looping);
    float n12_out = uP1;
    float n13_out = (n12_out * n8_intensity);
    float n14_out = min(n13_out, 1.0);
    float n15_out = (n11_out * n14_out);
    float n16_out = uP2;
    float n17_out = (n16_out * 3.141592653589793);
    float n18_out = (n17_out + 1.0);
    float n19_out = (n15_out * n18_out);
    vec4 n20_out = efxCurl(px, n7_xy, n19_out, n16_out);
    vec4 outColor = clamp(n20_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}
