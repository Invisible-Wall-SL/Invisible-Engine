uniform vec4 uFx;
uniform vec3 uP0;
uniform float uP1;

void main(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    vec4 pixel = efxSample(px);
    vec3 n0_out = uP0;
    float n1_out = uP1;
    float n2_out = efxNoise(uvSquare * n1_out + 0.0);
    float n3_progress = uFx.x;
    float n4_out = efxBand(n2_out, n3_progress, max(0.06, 0.0001));
    vec4 n5_l0 = pixel;
    float n5_alpha = n5_l0.a;
    float n6_out = (n4_out * n5_alpha);
    float n7_l0 = n6_out;
    vec4 n7_out = vec4(n0_out * n7_l0, n7_l0);
    float n8_out = (n3_progress + 0.04);
    float n9_out = smoothstep(n3_progress, n8_out, n2_out);
    vec4 n10_out = (pixel * clamp(n9_out, 0.0, 1.0));
    vec4 n11_l0 = n7_out;
    vec4 n11_out = (n11_l0 + n10_out * (1.0 - n11_l0.a));
    vec4 outColor = clamp(n11_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}
