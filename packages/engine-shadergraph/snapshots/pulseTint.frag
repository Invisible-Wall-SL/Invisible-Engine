uniform vec4 uFx;
uniform vec3 uP0;

void main(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    vec4 pixel = efxSample(px);
    vec4 n0_l0 = pixel;
    vec3 n0_rgb = (n0_l0.rgb / max(n0_l0.a, 0.0001));
    float n0_alpha = n0_l0.a;
    vec3 n1_out = uP0;
    vec3 n2_out = (vec3(efxLuma(n0_rgb)) * n1_out);
    float n3_progress = uFx.x;
    float n3_intensity = uFx.z;
    float n4_out = efxSinPi(clamp(n3_progress, 0.0, 1.0));
    float n5_out = (n4_out * n3_intensity);
    vec3 n6_out = mix(n0_rgb, n2_out, n5_out);
    float n7_l0 = n0_alpha;
    vec4 n7_out = vec4(n6_out * n7_l0, n7_l0);
    vec4 outColor = clamp(n7_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}
