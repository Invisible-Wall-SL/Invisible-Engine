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
    float n5_l0 = n4_out;
    vec4 n5_out = vec4(n0_out * n5_l0, n5_l0);
    float n6_out = (n3_progress + 0.04);
    float n7_out = smoothstep(n3_progress, n6_out, n2_out);
    vec4 n8_out = (pixel * clamp(n7_out, 0.0, 1.0));
    vec4 n9_l0 = n5_out;
    vec4 n9_out = (n9_l0 + n8_out * (1.0 - n9_l0.a));
    vec4 outColor = clamp(n9_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}
