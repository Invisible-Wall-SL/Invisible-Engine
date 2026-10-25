uniform vec4 uFx;

void efxGlsl_0(inout vec4 color, vec3 tint)
{
    color.rgb *= tint;
    color.rgb = min(color.rgb, vec3(color.a));
}

void efxGlsl_1(inout vec4 color, vec2 uv, float t, float k)
{
    vec2 c = uv - 0.5;
    float d = length(c);
    float ring = 0.0;
    for (int i = 0; i < 4; i++) {
        float at = fract(t + float(i) * 0.25);
        ring += (1.0 - smoothstep(0.0, 0.04, abs(d - at * 0.7))) * (1.0 - at);
    }
    vec2 pushed = uv + normalize(c + 0.0001) * ring * 0.02 * k;
    color = efxSample(efxFromUnit(pushed));
    color.rgb += vec3(0.6, 0.8, 1.0) * ring * 0.25 * color.a;
}

void efxGlsl_2(inout vec4 color, float radius)
{
    vec4 sum = vec4(0.0);
    for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
            sum += efxSample(efxPx() + vec2(float(x), float(y)) * radius);
        }
    }
    color = sum / 25.0;
}

void main(void)
{
    vec2 px = efxPx();
    vec2 uv = efxToUnit(px);
    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);
    vec4 n0_out = efxSample(efxFromUnit(uv));
    vec4 n1_o0 = n0_out;
    efxGlsl_0(n1_o0, vec3(1.0, 0.8, 0.55));
    vec2 n2_out = uv;
    float n3_progress = uFx.x;
    vec4 n4_o0 = n1_o0;
    efxGlsl_1(n4_o0, n2_out, n3_progress, 1.0);
    vec4 n5_o0 = n4_o0;
    efxGlsl_2(n5_o0, 1.5);
    vec4 outColor = clamp(n5_o0, 0.0, 1.0);
    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);
}
