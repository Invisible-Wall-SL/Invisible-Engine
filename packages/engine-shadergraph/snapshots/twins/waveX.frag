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
    float n1_progress = uFx.x;
    float n1_seconds = uFx.y;
    float n1_intensity = uFx.z;
    float n2_out = (n0_out * n1_intensity);
    float n3_out = (uFx.w > 0.5 ? 1.0 : smoothstep(0.0, 0.15, n1_progress) * (1.0 - smoothstep(0.85, 1.0, n1_progress)));
    float n4_out = (n2_out * n3_out);
    float n5_out = uP1;
    float n6_out = uP2;
    float n7_out = (n6_out * n1_seconds);
    vec2 n8_out = efxToUnit(efxWave(efxFromUnit(uv), n4_out, n5_out, n7_out, 0.0));
    vec4 n9_out = efxSample(efxFromUnit(n8_out));
    vec4 outColor = clamp(n9_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}
