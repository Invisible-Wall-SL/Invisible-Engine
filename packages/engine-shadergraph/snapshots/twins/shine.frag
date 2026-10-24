uniform vec4 uFx;
uniform vec3 uP0;
uniform float uP1;
uniform float uP2;
uniform float uP3;

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
    vec2 n2_out = uv;
    vec2 n3_out = (n2_out - vec2(0.5, 0.5));
    float n4_out = uP2;
    float n5_out = (n4_out * 0.017453292519943295);
    float n6_out = cos(n5_out);
    float n7_out = sin(n5_out);
    vec2 n8_xy = vec2(n6_out, n7_out);
    float n9_out = dot(n3_out, n8_xy);
    float n10_out = (n9_out + 0.5);
    float n11_progress = uFx.x;
    float n11_intensity = uFx.z;
    float n12_out = (n11_progress * 2.2);
    float n13_out = (n12_out + (-0.6));
    float n14_out = uP1;
    float n15_out = (n14_out * 0.5);
    float n16_out = efxBand(n10_out, n13_out, max(n15_out, 0.0001));
    float n17_out = (n16_out * n16_out);
    float n18_out = uP3;
    float n19_out = (n17_out * n18_out);
    float n20_out = (n19_out * n11_intensity);
    vec3 n21_out = (n1_out * vec3(n20_out));
    vec3 n22_out = (n0_rgb + n21_out);
    float n23_l0 = n0_alpha;
    vec4 n23_out = vec4(n22_out * n23_l0, n23_l0);
    vec4 outColor = clamp(n23_out, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}
