uniform vec4 uFx;
uniform float uP0;
uniform float uP1;

void main(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    float n0_out = uP0;
    float n1_progress = uFx.x;
    float n1_intensity = uFx.z;
    float n2_out = (n0_out * n1_intensity);
    float n3_out = clamp(n2_out, (-1.0), 1.0);
    float n4_out = efxSinPi(2.0 * (1.0 * n1_progress + 0.25));
    float n5_out = (0.5 * n4_out);
    float n6_out = (0.5 - n5_out);
    float n7_out = (n3_out * n6_out);
    float n8_out = uP1;
    vec2 n9_out = efxToUnit(efxBulge(efxFromUnit(uv), n7_out, n8_out));
    vec4 n10_out = efxSample(efxFromUnit(n9_out));
    vec4 outColor = clamp(n10_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}
