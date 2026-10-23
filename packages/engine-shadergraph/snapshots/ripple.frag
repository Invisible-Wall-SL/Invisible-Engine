uniform vec4 uFx;

void main(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    vec3 n0_l0 = efxRippleUv(uv, uFx.x, 0.12, 0.04);
    vec2 n0_uv = n0_l0.xy;
    float n0_ring = n0_l0.z;
    vec4 n1_out = efxSample(efxFromUnit(n0_uv));
    vec4 n2_l0 = n1_out;
    vec3 n2_rgb = (n2_l0.rgb / max(n2_l0.a, 0.0001));
    float n2_alpha = n2_l0.a;
    float n3_out = (n0_ring * 0.45);
    vec3 n4_out = (n2_rgb + vec3(n3_out));
    float n5_l0 = n2_alpha;
    vec4 n5_out = vec4(n4_out * n5_l0, n5_l0);
    finalColor = clamp(n5_out, 0.0, 1.0);
}
