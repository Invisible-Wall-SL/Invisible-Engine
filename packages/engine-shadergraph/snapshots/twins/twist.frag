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
    float n1_looping = uFx.w;
    float n2_out = (n0_out * n1_intensity);
    float n3_out = efxSinPi(clamp(n1_progress, 0.0, 1.0));
    float n4_out = efxSinPi(2.0 * (1.0 * n1_progress + 0.0));
    float n5_out = mix(n3_out, n4_out, n1_looping);
    float n6_out = (n2_out * n5_out);
    float n7_out = uP1;
    vec2 n8_out = efxToUnit(efxTwist(efxFromUnit(uv), radians(n6_out), n7_out));
    vec4 n9_out = efxSample(efxFromUnit(n8_out));
    vec4 outColor = clamp(n9_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}
