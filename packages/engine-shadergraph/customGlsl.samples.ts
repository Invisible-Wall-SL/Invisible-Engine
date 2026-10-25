/**
 * Custom GLSL bodies for the checks (`compile.fixture.ts`) and the GPU sheets
 * (`tools/fx-spike/shaderGraphs.entry.ts`, `?glsl=1`): example nodes, bodies the checker must take,
 * bodies it must refuse (each with what it says and on which line), and a generator of random bodies
 * the checker must take, which the GPU must then compile. Not part of the package's API.
 */

import {
	CUSTOM_GLSL,
	CUSTOM_GLSL_COST_MAX,
	CUSTOM_GLSL_DEFAULT,
	CUSTOM_GLSL_SAMPLES_MAX,
	customGlslDef,
} from './src/customGlsl';
import { SHADER_GRAPH_VERSION } from './src/types';
import type {
	CustomGlslDefinition,
	GraphNode,
	GraphWire,
	ShaderGraphDoc,
	SubgraphPort,
} from './src/types';

const port = (id: string, type: SubgraphPort['type'], value?: number | number[]): SubgraphPort => ({
	id,
	label: id,
	type,
	...(value === undefined ? {} : { default: value }),
});

/** The colour in and out (one value), the pixel's UV, a 0…1 time and an amount. */
const IO: Pick<CustomGlslDefinition, 'inputs' | 'outputs'> = {
	inputs: [
		port('color', 'vec4'),
		port('uv', 'vec2'),
		port('t', 'float', 0.5),
		port('k', 'float', 1),
	],
	outputs: [port('color', 'vec4')],
};

export interface GlslSample extends CustomGlslDefinition {
	name: string;
}

const sample = (name: string, code: string, ports = IO): GlslSample => ({
	name,
	code,
	inputs: ports.inputs,
	outputs: ports.outputs,
});

/** Three nodes as an author would write them: a tint, a ripple (a loop) and a blur (reads in loops). */
export const CUSTOM_GLSL_EXAMPLES: readonly GlslSample[] = [
	sample(
		'tint',
		`// Warm the colour, keeping it premultiplied.
color.rgb *= tint;
color.rgb = min(color.rgb, vec3(color.a));`,
		{
			inputs: [port('color', 'vec4'), port('tint', 'vec3', [1, 0.8, 0.55])],
			outputs: [port('color', 'vec4')],
		},
	),
	sample(
		'ripple',
		`// Rings pushed out from the centre, four echoes a loop.
vec2 c = uv - 0.5;
float d = length(c);
float ring = 0.0;
for (int i = 0; i < 4; i++) {
    float at = fract(t + float(i) * 0.25);
    ring += (1.0 - smoothstep(0.0, 0.04, abs(d - at * 0.7))) * (1.0 - at);
}
vec2 pushed = uv + normalize(c + 0.0001) * ring * 0.02 * k;
color = efxSample(efxFromUnit(pushed));
color.rgb += vec3(0.6, 0.8, 1.0) * ring * 0.25 * color.a;`,
	),
	sample(
		'blur',
		`/* A 5 × 5 box blur: 25 reads of the element, in two loops. */
vec4 sum = vec4(0.0);
for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
        sum += efxSample(efxPx() + vec2(float(x), float(y)) * radius);
    }
}
color = sum / 25.0;`,
		{
			inputs: [port('color', 'vec4'), port('radius', 'float', 1.5)],
			outputs: [port('color', 'vec4')],
		},
	),
];

/** Bodies the checker takes with no error (a warning only where `warns`). */
export const VALID_GLSL: readonly (GlslSample & { warns?: boolean })[] = [
	...CUSTOM_GLSL_EXAMPLES,
	{ name: 'default', ...CUSTOM_GLSL_DEFAULT },
	sample('empty', ''),
	sample('comments only', '// nothing\n/* at all — “quoted”, ünïcode */\n'),
	sample(
		'desaturate',
		'float grey = efxLuma(color.rgb);\ncolor.rgb = mix(color.rgb, vec3(grey), clamp(k, 0.0, 1.0));',
	),
	sample(
		'branches',
		`if (color.a < 0.01) {
    return;
} else if (t > 0.5 && !(k < 0.0)) {
    color.rgb = vec3(1.0) - color.rgb;
} else {
    color.rgb = t > 0.25 ^^ k > 0.5 ? color.bgr : color.gbr;
}`,
	),
	sample(
		'matrices',
		`float a = t * 6.2831853;
mat2 turn = mat2(cos(a), sin(a), -sin(a), cos(a));
vec2 p = turn * (uv - 0.5) + 0.5;
mat3 m = efxRotX(a) * efxRotY(a * 0.5);
color = efxSample(efxFromUnit(p));
color.rgb = clamp(m * color.rgb, 0.0, 1.0);
color.rgb *= mat3(1.0);
vec3 back = color.rgb * matrixCompMult(mat3(0.5), mat3(2.0));
color.rgb = min(back, vec3(color.a));`,
	),
	sample(
		'integers',
		`int n = 3;
int m = n * 2 - 1;
m += 1;
m /= 2;
n++;
--n;
float f = float(m) / float(n + 1);
color.rgb *= f;`,
	),
	sample(
		'counting down',
		`float s = 0.0;
for (int i = 8; i > 0; i -= 2) {
    s += float(i) * 0.01;
}
for (int j = 0; j >= -3; --j) {
    s -= 0.001;
}
color.a *= clamp(s, 0.0, 1.0);`,
	),
	sample(
		'break and continue',
		`float hit = 0.0;
for (int i = 0; i < 16; i++) {
    if (i == 2) continue;
    hit += efxHash(uv * 31.0 + float(i));
    if (hit > 3.0) break;
}
color.rgb *= hit / 16.0;`,
	),
	sample(
		'swizzles',
		`vec4 c = color;
c.xy = c.yx;
c.rgb *= 0.5;
c.a++;
c.w--;
c.stp = c.pts;
vec3 v = c.zzz + vec3(c.x, c.yz);
color = vec4(v * c.a, c.a);
color.rgb = min(color.rgb, vec3(color.a));`,
	),
	sample(
		'library',
		`float n = efxNoise(uv * 8.0);
float f = efxFbm(uv * 4.0, 3.0);
vec3 cells = efxCells(uv * 6.0, 1.0, 2.0);
float e = efxEdge(efxPx(), color.a, 1.5);
float g = efxGlint(uv, t, 0.1);
float h = efxHold(t, 0.4);
vec2 r = efxRotateUv(uv, t);
bool inside = efxInside(efxFromUnit(r));
color.rgb = efxHueShift(color.rgb, n * 0.2) * (0.5 + 0.5 * f) * (1.0 - cells.x * 0.3);
color.rgb += vec3(g + e) * h * color.a * (inside ? 1.0 : 0.0);
color.rgb = min(color.rgb, vec3(color.a));`,
	),
	sample(
		'vector tests',
		`if (any(lessThan(color.rgb, vec3(0.1))) || all(greaterThanEqual(uv, vec2(0.0)))) {
    color.rgb = vec3(equal(lessThan(uv, vec2(0.5)), bvec2(true, false)).xyx) * color.a;
}
bool same = color == color && notEqual(uv, uv) == bvec2(false);
color.a *= same ? 1.0 : 0.5;`,
	),
	sample(
		'constructors',
		`vec3 a = vec3(uv, t);
vec4 b = vec4(a.xy, vec2(k));
vec2 c = vec2(b);
vec3 d = vec3(vec4(1.0));
float e = float(true) + float(int(2.7)) + float(c.x > 0.5);
int i = int(e);
bool f = bool(i);
mat2 m = mat2(vec3(1.0), 0.0);
color.rgb *= clamp(d * e * (f ? 0.5 : 0.25), 0.0, 1.0) * (m * c).x;`,
	),
	sample(
		'blocks and calls',
		`{
    {
        float x = atan(uv.y - 0.5, uv.x - 0.5) / 6.2831853 + 0.5;
        color.rgb *= step(0.5, fract(x * 8.0 + t));
    }
}
float y = pow(abs(sin(t * 3.0)), 2.0) + exp2(-k) + log2(2.0) + inversesqrt(4.0);
color.rgb *= smoothstep(0.0, 1.0, vec3(y, y * 0.5, mod(y, 0.3)));
color.rgb = clamp(reflect(color.rgb, vec3(0.0, 0.0, 1.0)), 0.0, 1.0);
color.rgb = min(color.rgb, vec3(color.a));`,
	),
	sample(
		'assignments in expressions',
		`float a = 0.0;
float b = 0.0;
a = b = 0.5;
float c = (a += 0.25) * b++;
color.rgb *= c;`,
	),
	sample(
		'outputs',
		`mask = smoothstep(0.2, 0.8, color.a);
glow = color.rgb * mask;
if (mask < 0.5) return;
glow *= 2.0;`,
		{
			inputs: [port('color', 'vec4')],
			outputs: [port('mask', 'float'), port('glow', 'vec3', [0, 0, 0])],
		},
	),
	{
		...sample('written on some paths', 'if (color.a > 0.5) glow = color.rgb;', {
			inputs: [port('color', 'vec4')],
			outputs: [port('glow', 'vec3', [1, 0, 1])],
		}),
		warns: true,
	},
];

/** A body the checker refuses: what it says (`expect`, matched against the message) and where. */
export interface InvalidGlsl extends GlslSample {
	expect: RegExp;
	/** The line the issue names; absent for an issue about the definition as a whole. */
	line?: number;
	/** A warning, not an error. */
	warning?: boolean;
}

const invalid = (
	name: string,
	code: string,
	expect: RegExp,
	line?: number,
	ports = IO,
	warning = false,
): InvalidGlsl => ({
	...sample(name, code, ports),
	expect,
	...(line === undefined ? {} : { line }),
	...(warning ? { warning } : {}),
});

const longCode = (lines: number): string =>
	Array.from({ length: lines }, (_, i) => `color.r += ${(i % 9) + 1}.0 * 0.0001;`).join('\n');

/** Bodies (and ports) the checker refuses, covering every refusal it makes. */
export const INVALID_GLSL: readonly InvalidGlsl[] = [
	invalid(
		'while',
		'float x = 0.0;\nwhile (x < 1.0) { x += 0.1; }',
		/while loops are not allowed/,
		2,
	),
	invalid('do', 'do { color.r = 1.0; } while (false);', /do loops are not allowed/, 1),
	invalid('discard', 'color.r = 1.0;\n\ndiscard;', /discard is not allowed/, 3),
	invalid('preprocessor', '#define X 1.0\ncolor.r = X;', /# \(the preprocessor\)/, 1),
	invalid('#version', 'color.r = 1.0;\n#version 300 es', /# \(the preprocessor\)/, 2),
	invalid(
		'function',
		'float twice(float x) { return x * 2.0; }',
		/functions cannot be declared/,
		1,
	),
	invalid('void function', 'void f() {}', /functions cannot be declared/, 1),
	invalid('struct', 'struct S { float a; };', /struct declarations are not allowed/, 1),
	invalid('uniform', 'uniform float uMine;', /uniform declarations are not allowed/, 1),
	invalid('attribute', 'attribute vec2 aPos;', /attribute declarations are not allowed/, 1),
	invalid('varying', 'varying vec2 vUv;', /varying declarations are not allowed/, 1),
	invalid('precision', 'precision lowp float;', /precision declarations are not allowed/, 1),
	invalid('const', 'const float k2 = 2.0;', /a local is declared plainly/, 1),
	invalid('precision qualifier', 'highp float x = 1.0;', /a local is declared plainly/, 1),
	invalid('a uniform of the effect', 'color.r = uFx.x;', /uFx belongs to the effect’s shader/, 1),
	invalid('a param uniform', 'color.r = uP0;', /uP0 belongs to the effect’s shader/, 1),
	invalid('the header', 'color.xy = uElement.xy;', /uElement belongs to the effect’s shader/, 1),
	invalid('PI', 'color.r = PI;', /PI belongs to the effect’s shader/, 1),
	invalid('another node', 'color.r = n0_out;', /"n0_out" is not declared/, 1),
	invalid('main’s locals', 'color = pixel;', /"pixel" is not declared/, 1),
	invalid('gl_', 'color.r = gl_FragCoord.x;', /gl_ names are not allowed/, 1),
	invalid('gl_ local', 'float gl_x = 1.0;', /starts as GLSL’s own names do/, 1),
	invalid('texture2D', 'color = texture2D(uTexture, uv);', /reads a texture/, 1),
	invalid('texture', 'color = texture(uTexture, uv);', /reads a texture/, 1),
	invalid('sampler', 'sampler2D s = uTexture;', /samplers are not allowed/, 1),
	invalid('finalColor', 'finalColor = color;', /finalColor belongs to the effect’s shader/, 1),
	invalid('int ÷ 0', 'int a = 4 / 0;', /divided by 0/, 1),
	invalid('int ÷ constant 0', 'int a = 7;\nint b = a / (3 - 3);', /divided by 0/, 2),
	invalid('int ÷= 0', 'int a = 7;\na /= 0;', /divided by 0/, 2),
	invalid('int overflow', 'int a = 65536 * 65536;', /overflows 32 bits/, 1),
	invalid('int literal', 'int a = 3000000000;', /past the largest integer/, 1),
	invalid('float literal', 'float a = 1e31;', /past the largest number/, 1),
	invalid('bytes', `${'// padding\n'.repeat(400)}color.r = 1.0;`, /longer than 4096 bytes/),
	invalid('bytes (UTF-8)', `// ${'é'.repeat(2100)}\ncolor.r = 1.0;`, /longer than 4096 bytes/),
	invalid('tokens', longCode(100), /longer than 600 tokens/, 76),
	invalid('never written', 'mask = 1.0;', /output "glow" is never written/, undefined, {
		inputs: [port('color', 'vec4')],
		outputs: [port('mask', 'float'), port('glow', 'vec3')],
	}),
	invalid(
		'written on some paths',
		'glow = vec3(1.0);\nif (color.a < 0.5) return;\nmask = 1.0;',
		/output "mask" is written on some paths only/,
		undefined,
		{ inputs: [port('color', 'vec4')], outputs: [port('mask', 'float'), port('glow', 'vec3')] },
		true,
	),
	invalid(
		'written in a loop only',
		'for (int i = 0; i < 2; i++) { glow = vec3(1.0); }',
		/output "glow" is written on some paths only/,
		undefined,
		{ inputs: [port('color', 'vec4')], outputs: [port('glow', 'vec3')] },
		true,
	),
	invalid(
		'65 rounds',
		'for (int i = 0; i < 65; i++) { color.r += 0.001; }',
		/at most 64 rounds/,
		1,
	),
	invalid('never ends', 'for (int i = 0; i < 4; i--) { color.r += 0.001; }', /never ends/, 1),
	invalid('a zero step', 'for (int i = 0; i < 4; i += 0) { color.r += 0.001; }', /never ends/, 1),
	invalid(
		'257 nested',
		'for (int i = 0; i < 64; i++) {\n  for (int j = 0; j < 5; j++) { color.r += 0.0001; }\n}',
		/run 320 rounds here, more than 256/,
		2,
	),
	invalid('a float counter', 'for (float f = 0.0; f < 4.0; f += 1.0) { }', /counts with an int/, 1),
	invalid(
		'a bound that is not literal',
		'int n = 4;\nfor (int i = 0; i < n; i++) { }',
		/bounds are literal integers/,
		2,
	),
	invalid(
		'a test that is not the counter’s',
		'for (int i = 0; 4 > i; i++) { }',
		/reads its counter first/,
		1,
	),
	invalid('==', 'for (int i = 0; i == 0; i++) { }', /with <, <=, > or >=/, 1),
	invalid(
		'a step that is not literal',
		'int s = 1;\nfor (int i = 0; i < 4; i += s) { }',
		/steps its counter by a literal/,
		2,
	),
	invalid(
		'the counter written',
		'for (int i = 0; i < 4; i++) {\n  i = 3;\n}',
		/counts the loop: it cannot change/,
		2,
	),
	invalid('the counter stepped', 'for (int i = 0; i < 4; i++) { i++; }', /counts the loop/, 1),
	invalid(
		'the counter declared again',
		'for (int i = 0; i < 4; i++) { int i = 2; }',
		/"i" is already declared/,
		1,
	),
	invalid('%', 'float a = 5.0 % 2.0;', /% is reserved/, 1),
	invalid('bitwise', 'int a = 5 & 3;', /no bitwise operators/, 1),
	invalid('~', 'int a = ~5;', /no bitwise operators/, 1),
	invalid('shift', 'int a = 1 << 2;', /no bitwise operators/, 1),
	invalid('[', 'float a[2];', /arrays and indexing are not allowed/, 1),
	invalid('indexing', 'color[0] = 1.0;', /arrays and indexing are not allowed/, 1),
	invalid(
		'the comma operator',
		'color.r = 1.0, color.g = 1.0;',
		/comma operator is not allowed/,
		1,
	),
	invalid('a returned value', 'return color;', /return takes no value here/, 1),
	invalid('break outside a loop', 'break;', /break belongs inside a loop/, 1),
	invalid('continue outside a loop', 'continue;', /continue belongs inside a loop/, 1),
	invalid(
		'an int into a float',
		'float a = 1;',
		/"a" is a float, given an int.*never turns an int into a float/,
		1,
	),
	invalid('int and float', 'float a = 2.0 * 2;', /\* cannot take a float and an int/, 1),
	invalid('a vec2 into a float', 'float a = uv;', /"a" is a float, given a vec2/, 1),
	invalid(
		'a float given a vec2',
		'float a = 1.0;\na *= uv;',
		/\*= cannot take a float and a vec2/,
		2,
	),
	invalid(
		'a bool in arithmetic',
		'bool b = true;\nfloat a = b + 1.0;',
		/\+ cannot take a bool and a float/,
		2,
	),
	invalid('if on a float', 'if (t) { }', /if tests a bool, not a float/, 1),
	invalid('?: on a float', 'color.r = t ? 1.0 : 0.0;', /\? tests a bool/, 1),
	invalid('?: of two types', 'color.r = t > 0.5 ? 1.0 : uv;', /\? gives one type either way/, 1),
	invalid('vector <', 'bool b = uv < vec2(0.5);', /compare vectors with lessThan/, 1),
	invalid('! on a float', 'bool b = !t;', /! takes a bool/, 1),
	invalid('&& on floats', 'bool b = t && k;', /&& takes bools/, 1),
	invalid('min(float, vec)', 'color = min(0.5, color);', /min does not take \(float, vec4\)/, 1),
	invalid('step(vec, float)', 'color = step(color, 0.5);', /step does not take \(vec4, float\)/, 1),
	invalid(
		'a library call mistyped',
		'float n = efxNoise(t);',
		/efxNoise takes \(vec2\), not \(float\)/,
		1,
	),
	invalid(
		'an unknown library function',
		'float n = efxFuture(uv);',
		/"efxFuture" is not one of the library’s functions/,
		1,
	),
	invalid(
		'a GLSL ES 3.00 function',
		'float r = round(t);',
		/round is not a GLSL ES 1.00 function/,
		1,
	),
	invalid('a derivative', 'float d = dFdx(t);', /dFdx is not a GLSL ES 1.00 function/, 1),
	invalid('a function named and not called', 'float s = sin;', /sin is a function/, 1),
	invalid('a variable called', 'float s = t(1.0);', /"t" is a float, not a function/, 1),
	invalid('an unknown name', 'color.r = nowhere;', /"nowhere" is not declared/, 1),
	invalid('a prototype name', 'color.r = toString;', /"toString" is not declared/, 1),
	invalid('a prototype call', 'color.r = constructor(1.0);', /"constructor" is not declared/, 1),
	invalid('a constructor too long', 'vec2 v = vec2(1.0, 2.0, 3.0);', /a value is left over/, 1),
	invalid('a constructor too short', 'vec3 v = vec3(1.0, 2.0);', /takes 3 components, given 2/, 1),
	invalid('a constructor empty', 'vec3 v = vec3();', /at least one value/, 1),
	invalid(
		'a matrix into a vector',
		'vec4 v = vec4(mat2(1.0));',
		/a matrix cannot build it here/,
		1,
	),
	invalid('a float from a matrix', 'float f = float(mat2(1.0));', /one number, bool or vector/, 1),
	invalid('a swizzle of a float', 'float a = t.x;', /a float has no components/, 1),
	invalid('a swizzle past the vector', 'float a = uv.z;', /\.z is not a vec2’s/, 1),
	invalid('a swizzle of two sets', 'vec2 a = color.rx;', /from one set/, 1),
	invalid('a swizzle written twice', 'color.xx = vec2(1.0);', /names each component once/, 1),
	invalid('a method', 'float n = uv.length();', /methods are not GLSL ES 1.00/, 1),
	invalid('an input written', 't = 1.0;', /"t" is an input: copy it into a local/, 1),
	invalid(
		'a value written',
		'1.0 = t;',
		/only a local, an output or a part of one can be written/,
		1,
	),
	invalid('a declaration without a value', 'float a;', /give "a" a value where it is declared/, 1),
	invalid('a reserved word', 'float input = 1.0;', /"input" is a GLSL word/, 1),
	invalid('a GLSL ES 3.00 word', 'float sample = 1.0;', /"sample" is a GLSL word/, 1),
	invalid('a GLSL function as a name', 'float sin = 1.0;', /"sin" is a GLSL function/, 1),
	invalid('two underscores', 'float a__b = 1.0;', /two _ in a row/, 1),
	invalid('an efx name', 'float efxMine = 1.0;', /starts with efx/, 1),
	invalid('a shell name', 'float uElement = 1.0;', /a name the effect’s shader uses/, 1),
	invalid('webgl', 'float webgl_x = 1.0;', /starts as GLSL’s own names do/, 1),
	invalid('a port declared again', 'vec4 color = vec4(1.0);', /"color" is already declared/, 1),
	invalid(
		'a local declared again',
		'float a = 1.0;\n{\n  float a = 2.0;\n}',
		/"a" is already declared/,
		3,
	),
	invalid('ivec', 'ivec2 i = ivec2(1, 2);', /ivec2 is not supported here/, 1),
	invalid('bvec local', 'bvec2 b = lessThan(uv, vec2(0.5));', /bvec2 locals are not supported/, 1),
	invalid(
		'a closing brace too many',
		'color.r = 1.0;\n}\nuniform float uEvil;\nvoid efxEvil() {',
		/this } closes nothing/,
		2,
	),
	invalid(
		'an opening brace never closed',
		'if (t > 0.5) {\n  color.r = 1.0;',
		/this \{ is never closed/,
		1,
	),
	invalid('a missing ;', 'color.r = 1.0\ncolor.g = 1.0;', /a ; is missing before "color"/, 2),
	invalid('an else alone', 'else { }', /this else has no if/, 1),
	invalid('a comment never closed', 'color.r = 1.0;\n/* and then', /comment is never closed/, 2),
	invalid('a character outside GLSL', 'color.r = 1.0; @', /"@" is not part of GLSL/, 1),
	invalid('non-ASCII', 'float é = 1.0;', /"é" is not part of GLSL/, 1),
	invalid('a line continuation', 'color.r = \\\n1.0;', /"\\\\" is not part of GLSL/, 1),
	invalid('a string', 'color.r = "1";', /is not part of GLSL/, 1),
	invalid('1.0f', 'float a = 1.0f;', /"1.0f"… is not a number/, 1),
	invalid('hex', 'int a = 0x10;', /"0x"… is not a number/, 1),
	invalid('octal', 'int a = 010;', /would read as octal/, 1),
	invalid('a name too long', `float ${'a'.repeat(70)} = 1.0;`, /longer than 64 characters/, 1),
	invalid(
		'nested too deep',
		`color.r = ${'('.repeat(60)}1.0${')'.repeat(60)};`,
		/nests deeper than 48/,
		1,
	),
	invalid('blocks too deep', `${'{'.repeat(60)}${'}'.repeat(60)}`, /nests deeper than 48/, 1),
	invalid(
		'an expression too deep',
		`color.r = 0.0${' + 0.001'.repeat(70)};`,
		/an expression 72 deep: split it into locals/,
		1,
	),
	invalid(
		'too much work',
		'float s = 0.0;\nfor (int i = 0; i < 64; i++) {\n  s += efxFbm(uv * float(i), 5.0);\n}\ncolor.r = s;',
		/units of work a pixel, more than the 1024 a node may/,
	),
	invalid(
		'too many reads',
		'vec4 s = vec4(0.0);\nfor (int i = 0; i < 64; i++) {\n  for (int j = 0; j < 4; j++) {\n    s += efxSample(efxPx() + vec2(float(i), float(j))) + efxSample(efxPx());\n  }\n}\ncolor = s;',
		/reads the element 512 times a pixel, more than the 256 a node may/,
	),
	{ ...invalid('the code is not text', '', /its code is not text/), code: 42 as unknown as string },
	invalid('no outputs', 'color.r = 1.0;', /it needs at least one output/, undefined, {
		inputs: [port('color', 'vec4')],
		outputs: [],
	}),
	invalid(
		'a port named with a keyword',
		'color.r = 1.0;',
		/input "float" is a GLSL word/,
		undefined,
		{
			inputs: [port('color', 'vec4'), port('float', 'float')],
			outputs: [port('color', 'vec4')],
		},
	),
	invalid(
		'a port named uFx',
		'color.r = 1.0;',
		/input "uFx" is a name the effect’s shader uses/,
		undefined,
		{
			inputs: [port('color', 'vec4'), port('uFx', 'vec4')],
			outputs: [port('color', 'vec4')],
		},
	),
	invalid(
		'a port named gl_x',
		'color.r = 1.0;',
		/output "gl_x" starts as GLSL’s own names do/,
		undefined,
		{
			inputs: [port('color', 'vec4')],
			outputs: [port('color', 'vec4'), port('gl_x', 'float')],
		},
	),
	invalid(
		'a port named constructor',
		'color.r = 1.0;',
		/an input is not named with a word/,
		undefined,
		{
			inputs: [port('color', 'vec4'), port('constructor', 'float')],
			outputs: [port('color', 'vec4')],
		},
	),
	invalid('two inputs of one name', 'color.r = 1.0;', /two inputs are "color"/, undefined, {
		inputs: [port('color', 'vec4'), port('color', 'vec4')],
		outputs: [port('color', 'vec4')],
	}),
	invalid(
		'an input and an output of one name and two types',
		'color = vec4(1.0);',
		/share a name, so they are one value passed through/,
		undefined,
		{
			inputs: [port('color', 'vec3')],
			outputs: [port('color', 'vec4')],
		},
	),
	invalid('a port of no type', 'color.r = 1.0;', /input "x" is a "mat3"/, undefined, {
		inputs: [port('color', 'vec4'), { id: 'x', label: 'x', type: 'mat3' as never }],
		outputs: [port('color', 'vec4')],
	}),
	invalid(
		'a default that does not fit',
		'color.r = 1.0;',
		/input "x"'s default is not 1 or 2 numbers/,
		undefined,
		{
			inputs: [port('color', 'vec4'), port('x', 'vec2', [1, 2, 3])],
			outputs: [port('color', 'vec4')],
		},
	),
	invalid('33 inputs', 'color.r = 1.0;', /it has 33 inputs, more than 32/, undefined, {
		inputs: [
			port('color', 'vec4'),
			...Array.from({ length: 32 }, (_, i) => port(`p${i}`, 'float')),
		],
		outputs: [port('color', 'vec4')],
	}),
];

// -------------------------------------------------------------------------------------------------
// Docs the GPU draws
// -------------------------------------------------------------------------------------------------

/**
 * A doc drawing `defs` in a chain: the element sampled, through each Custom GLSL node in turn (wired
 * to its first vec4 input, read from its first vec4 output), into the Output; an input named `uv` (a
 * vec2) reads the pixel's UV and one named `t` (a float) the play's progress. Its other outputs reach
 * the Output too, each as a Mix towards nothing by its length, so every body is compiled.
 */
export function customGlslChain(id: string, defs: readonly CustomGlslDefinition[]): ShaderGraphDoc {
	const nodes: GraphNode[] = [
		{ id: 'in', type: 'sample', x: 0, y: 0 },
		{ id: 'uv', type: 'uv', x: 0, y: 120 },
		{ id: 'time', type: 'time', x: 0, y: 240 },
	];
	const wires: GraphWire[] = [];
	let from = { node: 'in', port: 'out' };
	defs.forEach((def, i) => {
		const id = `g${i}`;
		nodes.push({
			id,
			type: CUSTOM_GLSL,
			x: (i + 1) * 200,
			y: 0,
			glsl: JSON.parse(JSON.stringify(def)),
		});
		const input = def.inputs.find((p) => p.type === 'vec4');
		if (input) wires.push({ from, to: { node: id, port: input.id } });
		if (def.inputs.some((p) => p.id === 'uv' && p.type === 'vec2'))
			wires.push({ from: { node: 'uv', port: 'out' }, to: { node: id, port: 'uv' } });
		if (def.inputs.some((p) => p.id === 't' && p.type === 'float'))
			wires.push({ from: { node: 'time', port: 'progress' }, to: { node: id, port: 't' } });
		const outputs = def.outputs.filter((p) => p.type !== 'vec4');
		const output = def.outputs.find((p) => p.type === 'vec4');
		if (output && !outputs.length) {
			from = { node: id, port: output.id };
			return;
		}
		let sum = output ? { node: id, port: output.id } : from;
		for (const [k, out] of outputs.entries()) {
			const length = `l${i}_${k}`;
			const mix = `m${i}_${k}`;
			nodes.push(
				{ id: length, type: 'length', x: (i + 1) * 200, y: (k + 1) * 120 },
				{ id: mix, type: 'mix', x: (i + 1) * 200, y: (k + 1) * 120 + 60, values: { b: 0 } },
			);
			wires.push(
				{ from: { node: id, port: out.id }, to: { node: length, port: 'v' } },
				{ from: sum, to: { node: mix, port: 'a' } },
				{ from: { node: length, port: 'out' }, to: { node: mix, port: 't' } },
			);
			sum = { node: mix, port: 'out' };
		}
		from = sum;
	});
	nodes.push({ id: 'out', type: 'output', x: (defs.length + 1) * 200, y: 0 });
	wires.push({ from, to: { node: 'out', port: 'color' } });
	return {
		version: SHADER_GRAPH_VERSION,
		id,
		name: id,
		phase: 'loop',
		durationMs: 1000,
		params: [],
		nodes,
		wires,
	};
}

// -------------------------------------------------------------------------------------------------
// The generator: random bodies from a small grammar, every one the checker must take
// -------------------------------------------------------------------------------------------------

/** A seeded random source (mulberry32). */
export function seeded(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type T = 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4' | 'mat2' | 'mat3';
const VECS = ['vec2', 'vec3', 'vec4'] as const;
const GEN_PORTS: Pick<CustomGlslDefinition, 'inputs' | 'outputs'> = {
	inputs: [
		port('color', 'vec4'),
		port('a', 'float', 0.5),
		port('b', 'vec2', [0.25, 0.75]),
		port('c', 'vec3'),
	],
	outputs: [port('color', 'vec4'), port('extra', 'float')],
};

interface Var {
	name: string;
	type: T;
	writable: boolean;
}

/** Writes one random body, typed as it goes, so the checker must take it. */
class BodyWriter {
	private readonly rand: () => number;
	private readonly scopes: Var[][] = [[]];
	private readonly lines: string[] = [];
	private names = 0;
	private rounds = 1;
	private loops = 0;

	constructor(rand: () => number) {
		this.rand = rand;
		this.scopes[0].push(
			{ name: 'color', type: 'vec4', writable: true },
			{ name: 'a', type: 'float', writable: false },
			{ name: 'b', type: 'vec2', writable: false },
			{ name: 'c', type: 'vec3', writable: false },
			{ name: 'extra', type: 'float', writable: true },
		);
	}

	private pick<V>(list: readonly V[]): V {
		return list[Math.floor(this.rand() * list.length)];
	}

	private chance(p: number): boolean {
		return this.rand() < p;
	}

	private vars(type: T, writable = false): Var[] {
		return this.scopes.flat().filter((v) => v.type === type && (!writable || v.writable));
	}

	private float(): string {
		return (Math.round(this.rand() * 400) / 100).toFixed(2);
	}

	private int(): string {
		return String(Math.floor(this.rand() * 9) - 2);
	}

	expr(type: T, depth: number): string {
		const leaf = depth <= 0 || this.chance(0.3);
		const have = this.vars(type);
		if (leaf || this.chance(0.15)) {
			if (have.length && this.chance(0.7)) return this.pick(have).name;
			return this.literal(type, depth);
		}
		const d = depth - 1;
		switch (type) {
			case 'float':
				return this.pick([
					() => `(${this.expr('float', d)} ${this.pick(['+', '-', '*'])} ${this.expr('float', d)})`,
					() => `(${this.expr('float', d)} / (abs(${this.expr('float', d)}) + 1.0))`,
					() =>
						`${this.pick(['sin', 'cos', 'abs', 'fract', 'floor', 'ceil', 'sign', 'exp2'])}(${this.expr('float', d)})`,
					() => `sqrt(abs(${this.expr('float', d)}))`,
					() => `pow(abs(${this.expr('float', d)}), ${this.float()})`,
					() => `${this.pick(['length', 'efxLuma'])}(${this.expr(this.pick(['vec3', 'vec3']), d)})`,
					() => {
						const v = this.pick(VECS);
						return `dot(${this.expr(v, d)}, ${this.expr(v, d)})`;
					},
					() => `${this.expr(this.pick(VECS), d)}.${this.pick(['x', 'y', 'r', 's'])}`,
					() => `float(${this.expr('int', d)})`,
					() => `(${this.expr('bool', d)} ? ${this.expr('float', d)} : ${this.expr('float', d)})`,
					() => `clamp(${this.expr('float', d)}, 0.0, 1.0)`,
					() => `mix(${this.expr('float', d)}, ${this.expr('float', d)}, ${this.expr('float', d)})`,
					() => `smoothstep(0.0, 1.0, ${this.expr('float', d)})`,
					() =>
						`${this.pick(['min', 'max', 'mod', 'step', 'atan'])}(${this.expr('float', d)}, ${this.float()})`,
					() => `efxNoise(${this.expr('vec2', d)})`,
					() => `efxHash(${this.expr('vec2', d)})`,
					() => `efxEaseInOut(${this.expr('float', d)})`,
					() => `efxSample(${this.expr('vec2', d)}).a`,
					() => `-(${this.expr('float', d)})`,
				])();
			case 'int':
				return this.pick([
					() => `(${this.expr('int', d)} ${this.pick(['+', '-', '*'])} ${this.expr('int', d)})`,
					() => `int(${this.expr('float', d)})`,
					() => `(${this.expr('bool', d)} ? ${this.expr('int', d)} : ${this.int()})`,
					() => `(${this.expr('int', d)} / ${1 + Math.floor(this.rand() * 4)})`,
				])();
			case 'bool':
				return this.pick([
					() =>
						`(${this.expr('float', d)} ${this.pick(['<', '>', '<=', '>='])} ${this.expr('float', d)})`,
					() => `(${this.expr('int', d)} ${this.pick(['==', '!=', '<'])} ${this.expr('int', d)})`,
					() => `!${this.expr('bool', d)}`,
					() =>
						`(${this.expr('bool', d)} ${this.pick(['&&', '||', '^^'])} ${this.expr('bool', d)})`,
					() => {
						const v = this.pick(VECS);
						return `${this.pick(['any', 'all'])}(${this.pick(['lessThan', 'greaterThanEqual', 'equal'])}(${this.expr(v, d)}, ${this.expr(v, d)}))`;
					},
					() => `efxInside(${this.expr('vec2', d)})`,
					() => `(${this.expr('vec3', d)} == ${this.expr('vec3', d)})`,
				])();
			case 'mat2':
			case 'mat3':
				return this.pick([
					() => `${type}(${this.expr('float', d)})`,
					() => `(${this.expr(type, d)} * ${this.expr(type, d)})`,
					() => `matrixCompMult(${this.expr(type, d)}, ${this.expr(type, d)})`,
					() =>
						type === 'mat3' ? `efxRotX(${this.expr('float', d)})` : `mat2(${this.expr('vec4', d)})`,
				])();
			default: {
				const n = Number(type.slice(-1));
				return this.pick([
					() => `(${this.expr(type, d)} ${this.pick(['+', '-', '*'])} ${this.expr(type, d)})`,
					() => `(${this.expr(type, d)} * ${this.expr('float', d)})`,
					() => `(${this.expr('float', d)} ${this.pick(['+', '*'])} ${this.expr(type, d)})`,
					() => `${type}(${this.expr('float', d)})`,
					() =>
						n === 2
							? `vec2(${this.expr('float', d)}, ${this.expr('float', d)})`
							: n === 3
								? `vec3(${this.expr('vec2', d)}, ${this.expr('float', d)})`
								: `vec4(${this.expr('vec3', d)}, ${this.expr('float', d)})`,
					() => `${this.expr('vec4', d)}.${['xy', 'rgb', 'xyzw'][n - 2]}`,
					() =>
						`${this.pick(['sin', 'abs', 'fract', 'floor', 'normalize'])}(${this.expr(type, d)})`,
					() => `clamp(${this.expr(type, d)}, 0.0, 1.0)`,
					() => `mix(${this.expr(type, d)}, ${this.expr(type, d)}, ${this.expr('float', d)})`,
					() => `max(${this.expr(type, d)}, ${this.expr('float', d)})`,
					() => `step(${this.expr('float', d)}, ${this.expr(type, d)})`,
					() => `(${this.expr('bool', d)} ? ${this.expr(type, d)} : ${this.expr(type, d)})`,
					() =>
						n === 4
							? `efxSample(efxFromUnit(${this.expr('vec2', d)}))`
							: n === 3
								? `efxHueShift(${this.expr('vec3', d)}, ${this.expr('float', d)})`
								: `efxToUnit(efxPx() + ${this.expr('vec2', d)})`,
					() =>
						n === 2
							? `(mat2(${this.expr('float', d)}) * ${this.expr('vec2', d)})`
							: n === 3
								? `(${this.expr('vec3', d)} * mat3(${this.expr('float', d)}))`
								: `vec4(${this.expr('vec2', d)}, ${this.expr('vec2', d)})`,
				])();
			}
		}
	}

	private literal(type: T, depth: number): string {
		switch (type) {
			case 'float':
				return this.float();
			case 'int':
				return this.int();
			case 'bool':
				return this.pick(['true', 'false']);
			case 'mat2':
			case 'mat3':
				return `${type}(${this.float()})`;
			default:
				return depth > 0 && this.chance(0.3)
					? `${type}(${this.expr('float', depth - 1)})`
					: `${type}(${this.float()})`;
		}
	}

	private fresh(): string {
		return `v${this.names++}`;
	}

	private line(text: string): void {
		this.lines.push(`${'    '.repeat(this.scopes.length - 1)}${text}`);
	}

	statement(budget: number): void {
		const kinds = ['declare', 'declare', 'assign', 'assign', 'swizzle', 'step', 'if'];
		if (this.rounds < 64 && this.scopes.length < 4) kinds.push('for');
		if (this.loops) kinds.push('jump');
		const kind = this.pick(kinds);
		const types: T[] = ['float', 'float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3'];
		switch (kind) {
			case 'declare': {
				const type = this.pick(types);
				const value = this.expr(type, 3);
				const name = this.fresh();
				this.line(`${type} ${name} = ${value};`);
				this.scopes[this.scopes.length - 1].push({ name, type, writable: true });
				return;
			}
			case 'assign': {
				const targets = this.scopes.flat().filter((v) => v.writable);
				const target = this.pick(targets);
				const op =
					target.type === 'bool'
						? '='
						: this.pick(['=', '+=', '-=', '*=', target.type === 'int' ? '=' : '/=']);
				const value =
					op === '/='
						? `(abs(${this.expr('float', 1)}) + 1.0)`
						: op === '*=' && target.type !== 'int' && this.chance(0.5)
							? this.expr('float', 2)
							: this.expr(target.type, 2);
				this.line(`${target.name} ${op} ${value};`);
				return;
			}
			case 'swizzle': {
				const vectors = this.scopes.flat().filter((v) => v.writable && v.type.startsWith('vec'));
				const target = this.pick(vectors);
				const n = Number(target.type.slice(-1));
				const field = this.pick(
					['x', 'y', 'xy', 'yx', 'rgb', 'bgr', 'xyz', 'w', 'a', 'st'].filter((f) => {
						const set = ['xyzw', 'rgba', 'stpq'].find((s) => s.includes(f[0])) as string;
						return [...f].every((ch) => set.indexOf(ch) >= 0 && set.indexOf(ch) < n);
					}),
				);
				const type = (field.length === 1 ? 'float' : `vec${field.length}`) as T;
				this.line(`${target.name}.${field} ${this.pick(['=', '+=', '*='])} ${this.expr(type, 2)};`);
				return;
			}
			case 'step': {
				const numbers = this.scopes
					.flat()
					.filter((v) => v.writable && (v.type === 'float' || v.type === 'int'));
				const target = this.pick(numbers);
				this.line(
					this.pick([
						`${target.name}++;`,
						`${target.name}--;`,
						`++${target.name};`,
						`--${target.name};`,
					]),
				);
				return;
			}
			case 'if': {
				this.line(`if (${this.expr('bool', 2)}) {`);
				this.block(budget - 1);
				if (this.chance(0.5)) {
					this.line('} else {');
					this.block(budget - 1);
				}
				this.line('}');
				return;
			}
			case 'for': {
				const name = this.fresh();
				const most = Math.max(1, Math.min(8, Math.floor(64 / this.rounds)));
				const n = 1 + Math.floor(this.rand() * most);
				const start = Math.floor(this.rand() * 5) - 2;
				const header = this.chance(0.5)
					? `for (int ${name} = ${start}; ${name} < ${start + n}; ${name}++)`
					: `for (int ${name} = ${start + n}; ${name} > ${start}; ${name}--)`;
				this.line(`${header} {`);
				this.scopes.push([{ name, type: 'int', writable: false }]);
				const outer = this.rounds;
				this.rounds *= n;
				this.loops++;
				this.blockBody(budget - 1);
				this.loops--;
				this.rounds = outer;
				this.scopes.pop();
				this.line('}');
				return;
			}
			case 'jump':
				this.line(`if (${this.expr('bool', 1)}) ${this.pick(['break', 'continue'])};`);
				return;
		}
	}

	private block(budget: number): void {
		this.scopes.push([]);
		this.blockBody(budget);
		this.scopes.pop();
	}

	private blockBody(budget: number): void {
		const count = budget > 0 ? 1 + Math.floor(this.rand() * 3) : 1;
		for (let i = 0; i < count; i++) {
			if (budget <= 0) {
				const target = this.pick(
					this.scopes.flat().filter((v) => v.writable && v.type === 'float'),
				);
				this.line(`${target.name} += ${this.expr('float', 1)};`);
			} else this.statement(budget);
		}
	}

	/**
	 * A body: `extra` written, then statements while the body stays well inside a node's caps (a
	 * statement that would take it past is left out), then the colour kept in range.
	 */
	body(): string {
		this.line(`extra = ${this.expr('float', 2)};`);
		const close = 'color = clamp(color, 0.0, 1.0);';
		const count = 2 + Math.floor(this.rand() * 6);
		for (let i = 0; i < count; i++) {
			const kept = this.lines.length;
			const names = this.names;
			const declared = this.scopes[0].length;
			this.statement(2);
			const def = customGlslDef({
				id: 'probe',
				type: CUSTOM_GLSL,
				x: 0,
				y: 0,
				glsl: { code: [...this.lines, close].join('\n'), ...GEN_PORTS },
			});
			if (
				def.cost > CUSTOM_GLSL_COST_MAX * 0.8 ||
				(def.samples ?? 0) > CUSTOM_GLSL_SAMPLES_MAX * 0.8 ||
				(this.lines.join('\n').match(/[A-Za-z_]\w*|\d+(?:\.\d*)?|[^\s\w]/g) ?? []).length > 480
			) {
				this.lines.length = kept;
				this.names = names;
				this.scopes[0].length = declared;
				break;
			}
		}
		this.line(close);
		return this.lines.join('\n');
	}
}

/** Random body `n` (from seed `seed`): the colour in and out, plus a float, a vec2 and a vec3 in. */
export function generatedGlsl(seed: number, n: number): GlslSample {
	const rand = seeded(seed * 1_000_003 + n);
	return { name: `generated ${seed}/${n}`, code: new BodyWriter(rand).body(), ...GEN_PORTS };
}

// -------------------------------------------------------------------------------------------------
// The fuzz: token soups and valid bodies broken at random
// -------------------------------------------------------------------------------------------------

const SOUP = [
	...'float int bool vec2 vec3 vec4 mat2 mat3 mat4 bvec2 ivec2 void if else for while do return'.split(
		' ',
	),
	...'break continue discard uniform const struct precision highp in out inout true false'.split(
		' ',
	),
	...'color uv t k x i sin pow efxSample efxNoise efxPx texture2D gl_FragColor uFx PI main'.split(
		' ',
	),
	...'0 1 2 64 65 1.0 0.5 .5 1e3 1e40 010 0x1 2147483648'.split(' '),
	...'( ) { } [ ] ; , . = += -= *= /= + - * / % < > <= >= == != && || ^^ ! ? : ++ -- & | ~ <<'.split(
		' ',
	),
	'#',
	'//',
	'/*',
	'*/',
	'\n',
	'é',
	'"',
	'\\',
	'.xyz',
	'.rgba',
	'.x',
	'constructor',
	'__proto__',
];

/** Random token soup `n` (from seed `seed`), on the default ports. */
export function soupGlsl(seed: number, n: number): GlslSample {
	const rand = seeded(seed * 104_729 + n);
	const count = Math.floor(rand() * 60);
	const parts: string[] = [];
	for (let i = 0; i < count; i++) {
		parts.push(SOUP[Math.floor(rand() * SOUP.length)]);
		parts.push(rand() < 0.15 ? '\n' : rand() < 0.8 ? ' ' : '');
	}
	return { name: `soup ${seed}/${n}`, code: parts.join(''), ...IO };
}

const TYPES = ['float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3'];
const FUNCTIONS = [
	'sin',
	'abs',
	'length',
	'dot',
	'min',
	'step',
	'mix',
	'clamp',
	'efxNoise',
	'efxSample',
	'float',
	'vec3',
];
const OPERATORS = ['+', '-', '*', '/', '<', '==', '=', '+=', '&&', '?'];

/** `code` with one match of `pattern` (picked by `rand`) replaced by `by(match)`. */
function replaceOne(
	code: string,
	pattern: RegExp,
	rand: () => number,
	by: (match: string) => string,
): string {
	const matches = [...code.matchAll(pattern)];
	if (!matches.length) return code;
	const m = matches[Math.floor(rand() * matches.length)];
	const at = m.index ?? 0;
	return code.slice(0, at) + by(m[0]) + code.slice(at + m[0].length);
}

/**
 * A valid body (a sample, or a random one) broken at random, `n` from seed `seed`: characters cut,
 * inserted, turned or copied, or one word changed as a slip would change it (a float literal left an
 * integer, a type, a swizzle, an operator, a function or a name swapped for another).
 */
export function mutatedGlsl(seed: number, n: number): GlslSample {
	const rand = seeded(seed * 7_919 + n);
	const base =
		rand() < 0.5 ? VALID_GLSL[Math.floor(rand() * VALID_GLSL.length)] : generatedGlsl(seed, n);
	const pick = <V>(list: readonly V[]): V => list[Math.floor(rand() * list.length)];
	let code = base.code;
	const edits = 1 + Math.floor(rand() * 3);
	for (let e = 0; e < edits; e++) {
		const at = Math.floor(rand() * (code.length + 1));
		const span = Math.floor(rand() * 6);
		switch (Math.floor(rand() * 11)) {
			case 0:
				code = code.slice(0, at) + code.slice(at + span);
				break;
			case 1:
				code = code.slice(0, at) + pick(SOUP) + code.slice(at);
				break;
			case 2:
				code =
					code.slice(0, at) +
					[...code.slice(at, at + span)].reverse().join('') +
					code.slice(at + span);
				break;
			case 3: {
				const from = Math.floor(rand() * code.length);
				code = code.slice(0, at) + code.slice(from, from + span) + code.slice(at);
				break;
			}
			case 4:
				code = code.slice(0, at);
				break;
			case 5:
				code = replaceOne(code, /\b\d+\.\d+\b/g, rand, (m) => m.split('.')[0]);
				break;
			case 6:
				code = replaceOne(code, /\b(float|int|bool|vec[234]|mat[23])\b/g, rand, () => pick(TYPES));
				break;
			case 7:
				code = replaceOne(code, /\.[xyzwrgbastpq]{1,4}\b/g, rand, (m) => {
					if (rand() < 0.5)
						return pick(['.x', '.xy', '.xyz', '.xyzw', '.rgb', '.a', '.yx', '.zw', '.st', '.xx']);
					// One component for another of its set: the same length, maybe past the vector.
					const set = ['xyzw', 'rgba', 'stpq'].find((s) => s.includes(m[1])) as string;
					const k = 1 + Math.floor(rand() * (m.length - 1));
					return m.slice(0, k) + pick([...set]) + m.slice(k + 1);
				});
				break;
			case 8:
				code = replaceOne(code, /[+\-*/<]=?|==|&&|\?/g, rand, () => pick(OPERATORS));
				break;
			case 9:
				code = replaceOne(
					code,
					/\b(sin|cos|abs|fract|length|dot|min|max|step|mix|clamp|smoothstep|efx\w+|float|vec[234])(?=\()/g,
					rand,
					() => pick(FUNCTIONS),
				);
				break;
			default: {
				const names = [...new Set(code.match(/\b[a-z]\w*\b/g) ?? [])];
				if (names.length > 1) code = replaceOne(code, /\b[a-z]\w*\b/g, rand, () => pick(names));
			}
		}
	}
	return { ...base, name: `mutated ${seed}/${n} (${base.name})`, code };
}

/**
 * Bodies one slip away from a valid one (a sample, or a random one): each swizzle with one component
 * swapped for another of its set, each float literal left an integer, each type swapped for another,
 * each operator for another. Every one the checker takes must compile; with the checker blind to a
 * rule, the GPU refuses some, and the GPU sheet names them. Every `step`-th of them, `limit` at most.
 */
export function nearMissGlsl(step = 4, limit = 900): GlslSample[] {
	const bases = [...VALID_GLSL, ...Array.from({ length: 40 }, (_, n) => generatedGlsl(17, n))];
	const variants: GlslSample[] = [];
	for (const base of bases) {
		const code = base.code;
		const swap = (at: number, length: number, by: string, how: string): void =>
			void variants.push({
				...base,
				name: `near ${base.name}: ${how}`,
				code: code.slice(0, at) + by + code.slice(at + length),
			});
		for (const m of code.matchAll(/\.[xyzwrgbastpq]{1,4}\b/g)) {
			const set = ['xyzw', 'rgba', 'stpq'].find((s) => s.includes(m[0][1])) as string;
			for (let k = 1; k < m[0].length; k++)
				for (const c of set)
					if (c !== m[0][k])
						swap(
							m.index ?? 0,
							m[0].length,
							m[0].slice(0, k) + c + m[0].slice(k + 1),
							`${m[0]} as ${m[0].slice(0, k) + c + m[0].slice(k + 1)}`,
						);
		}
		for (const m of code.matchAll(/\b\d+\.\d+\b/g))
			swap(m.index ?? 0, m[0].length, m[0].split('.')[0], `${m[0]} as an integer`);
		for (const m of code.matchAll(/\b(float|int|bool|vec[234]|mat[23])\b/g))
			for (const type of TYPES)
				if (type !== m[0]) swap(m.index ?? 0, m[0].length, type, `${m[0]} as ${type}`);
		for (const m of code.matchAll(/ ([+\-*/<]) /g))
			for (const op of ['+', '-', '*', '/', '<', '=='])
				if (op !== m[1]) swap((m.index ?? 0) + 1, 1, op, `${m[1]} as ${op}`);
	}
	return variants.filter((_, i) => i % step === 0).slice(0, limit);
}
