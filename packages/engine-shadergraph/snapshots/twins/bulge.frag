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
    float n4_l0 = efxSinPi(n1_progress);
    float n4_out = (n4_l0 * n4_l0);
    float n5_out = (n3_out * n4_out);
    float n6_out = uP1;
    vec2 n7_out = efxToUnit(efxBulge(efxFromUnit(uv), n5_out, n6_out));
    vec4 n8_out = efxSample(efxFromUnit(n7_out));
    vec4 outColor = clamp(n8_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}
