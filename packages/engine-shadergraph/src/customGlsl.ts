/**
 * THE CUSTOM GLSL NODE (step 8c; admin only, design §9.3): a pixel-graph node whose body an author
 * types, with declared typed inputs and outputs. It compiles to one GLSL function placed before the
 * pass's `main` (`compile.ts`), called where the node sits, so it runs in the effect's own pass like
 * any other node.
 *
 * Everything here is built so a mistake cannot blank or hang a game: the body is read by a small
 * tokenizer and a typed recursive-descent check of a GLSL ES 1.00 subset, and anything outside that
 * subset is refused, its line named.
 *
 * The subset (the body of `void f(<ports>)`):
 *  - statements: blocks, local declarations (float, int, bool, vec2–4, mat2–4; each given a value),
 *    expression statements, `if` / `else`, `for` with an int counter, literal bounds and a literal
 *    step (at most {@link CUSTOM_GLSL_LOOP_MAX} rounds each, {@link CUSTOM_GLSL_NESTED_MAX} nested in
 *    all), `break`, `continue`, `return;`;
 *  - expressions: the GLSL ES 1.00 operators but `%`, the bitwise ones and `,` (all reserved or left
 *    out), swizzles, constructors, the ES 1.00 built-in functions bar the texture ones, and the
 *    `efx…` library functions (`glslLibrary`'s entries and the pass header's), typed by their own
 *    declarations, so a new library entry is callable at once;
 *  - names: its ports, its locals and loop counters (none hiding another), the functions above,
 *    GLSL's keywords and types. Every name the effect's shader makes (`uFx`, `uP0`, the header's
 *    uniforms, other nodes' variables) is out of reach, and so are `gl_` names and samplers: the
 *    element is read through `efxSample`, so the padding and margin rules hold.
 *  - refused besides: `while`, `do`, `discard`, `#`, declarations of functions, structs, uniforms,
 *    attributes, varyings or precision, qualifiers, arrays and indexing, integer division by a
 *    constant 0, an integer literal or constant, or a value a loop counter takes, past
 *    ±{@link CUSTOM_GLSL_INT_MAX} (the pass's integers are mediump), a body over
 *    {@link CUSTOM_GLSL_BYTES_MAX} bytes or
 *    {@link CUSTOM_GLSL_TOKENS_MAX} tokens, nesting past {@link CUSTOM_GLSL_DEPTH_MAX}. An output never
 *    written is an error, one written on some paths only a warning (it starts at its default, else 0).
 *
 * THE COST is estimated as the body is checked, by type, in the node library's units
 * (`NodeDef.cost`): an arithmetic operator a step per component of its result, but a matrix product
 * n³ and a matrix by a vector n²; a comparison or a logical operator 1 (a vector equality its width);
 * a built-in call 1, 2 (length, normalize, smoothstep, sqrt and the like) or 4 (the trigonometric,
 * exponential and power functions) times its widest argument's components; a library call its own
 * body's estimate (operators and calls counted, loops by their rounds: they are fixed code); a
 * pass-header helper 2; each statement times the rounds of the loops around it, each loop 2 a round
 * for its test and step. Reads of the element are each `efxSample` call (inside the library's
 * functions too) times its loops' rounds. Never 0. It counts both sides of every branch and every
 * round a loop may run, so it reads 2–6× the hand-set cost of a library node doing the same work:
 * on the safe side. By it the hand-written built-in passes, as bodies, do up to 1,053 units
 * (Electrocute; Petrify 870, Sphericon 575). A node past {@link CUSTOM_GLSL_COST_MAX} units or
 * {@link CUSTOM_GLSL_SAMPLES_MAX} reads is refused, and so is an effect whose Custom GLSL nodes pass
 * {@link CUSTOM_GLSL_EFFECT_COST_MAX} / {@link CUSTOM_GLSL_EFFECT_SAMPLES_MAX} together.
 */

import {
	EFX_GLSL,
	EFX_HEADER_FUNCTIONS,
	EFX_HEADER_SIGNATURES,
} from 'constants-shared/glslLibrary';
import { PARTICLE_SHELL_NAMES } from 'constants-shared/particleShell';
import type { NodeDef } from './nodes';
import { isRecord, portDef, portSideIssues, portsOf, quoted } from './ports';
import type {
	CustomGlslDefinition,
	GraphIssue,
	GraphIssueLevel,
	GraphNode,
	ShaderGraphDoc,
	SubgraphPort,
} from './types';

export const CUSTOM_GLSL = 'customGlsl';

/** A new Custom GLSL node's definition: the colour in, passed through as it is. */
export const CUSTOM_GLSL_DEFAULT: CustomGlslDefinition = {
	code: [
		'// `color` comes in and goes out (an input and an output of one name are one value).',
		'// Change it here, e.g. color.rgb *= vec3(1.0, 0.85, 0.6);',
		'color = color;',
	].join('\n'),
	inputs: [{ id: 'color', label: 'Colour', type: 'vec4' }],
	outputs: [{ id: 'color', label: 'Colour', type: 'vec4' }],
};

/** A body is at most this many bytes (UTF-8, comments included) and this many tokens. */
export const CUSTOM_GLSL_BYTES_MAX = 4096;
export const CUSTOM_GLSL_TOKENS_MAX = 600;
/** A loop runs at most this many rounds, and loops nested in loops this many in all. */
export const CUSTOM_GLSL_LOOP_MAX = 64;
export const CUSTOM_GLSL_NESTED_MAX = 256;
/** Blocks, branches, loops, brackets and operators nest at most this deep. */
export const CUSTOM_GLSL_DEPTH_MAX = 48;
/** A statement's expression, as a tree, with the blocks around it, is at most this deep. */
export const CUSTOM_GLSL_TREE_MAX = 64;
/**
 * An integer literal, a constant folded from them and every value a loop counter takes (the one that
 * ends the loop included) stay within ±this. The pass is GLSL ES 1.00 on WebGL1 and WebGL2 alike, so
 * its integers are mediump, sure to hold only (−2^10, 2^10); past that a counter may wrap and its
 * loop never end, which no fail-safe can catch.
 */
export const CUSTOM_GLSL_INT_MAX = 1023;
/** A float literal is at most this: past it, a GPU's float overflows. */
export const CUSTOM_GLSL_FLOAT_MAX = 1e30;
/**
 * One node's work a pixel, and its reads of the element. By this estimate the hand-written built-in
 * passes do up to 1,053 units (Electrocute; Petrify 870, Sphericon 575): a node may do Petrify's work
 * but not Electrocute's. 256 reads is 64 rounds of a 4-read edge (`efxEdge`).
 */
export const CUSTOM_GLSL_COST_MAX = 1024;
export const CUSTOM_GLSL_SAMPLES_MAX = 256;
/**
 * What every Custom GLSL node of one effect may spend together, a pixel: under the built-in Glow at
 * its widest reach (40 px: 38 angles × 40 steps, 1,521 reads and about 21,700 units a pixel by this
 * estimate, 14 a step).
 */
export const CUSTOM_GLSL_EFFECT_COST_MAX = 4096;
export const CUSTOM_GLSL_EFFECT_SAMPLES_MAX = 1024;
/** At most this many issues are said about one node's definition. */
const ISSUES_MAX = 8;

// -------------------------------------------------------------------------------------------------
// NAMES
// -------------------------------------------------------------------------------------------------

const words = (text: string): Set<string> => new Set(text.split(/\s+/).filter(Boolean));

/** GLSL ES 1.00's and 3.00's keywords and reserved words, and the ES 3.00 keywords 1.00 lacks. */
const KEYWORDS = words(`
	attribute const uniform varying break continue do for while if else in out inout float int void
	bool true false lowp mediump highp precision invariant discard return mat2 mat3 mat4 vec2 vec3
	vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 sampler2D samplerCube struct
	asm class union enum typedef template this packed goto switch default inline noinline volatile
	public static extern external interface flat long short double half fixed unsigned superp input
	output hvec2 hvec3 hvec4 dvec2 dvec3 dvec4 fvec2 fvec3 fvec4 sampler1D sampler3D sampler1DShadow
	sampler2DShadow sampler2DRect sampler3DRect sampler2DRectShadow sizeof cast namespace using
	centroid smooth layout uint uvec2 uvec3 uvec4 case mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4
	mat4x2 mat4x3 mat4x4 samplerCubeShadow sampler2DArray sampler2DArrayShadow isampler2D isampler3D
	isamplerCube isampler2DArray usampler2D usampler3D usamplerCube usampler2DArray coherent restrict
	readonly writeonly resource atomic_uint noperspective patch sample subroutine common partition
	active filter image1D image2D image3D imageCube iimage1D iimage2D iimage3D iimageCube uimage1D
	uimage2D uimage3D uimageCube image1DArray image2DArray iimage1DArray iimage2DArray uimage1DArray
	uimage2DArray imageBuffer iimageBuffer uimageBuffer sampler1DArray sampler1DArrayShadow
	isampler1D isampler1DArray usampler1D usampler1DArray isampler2DRect usampler2DRect samplerBuffer
	isamplerBuffer usamplerBuffer sampler2DMS isampler2DMS usampler2DMS sampler2DMSArray
	isampler2DMSArray usampler2DMSArray samplerExternalOES
`);

/** GLSL's built-in functions in ES 1.00 and 3.00 (the callable ones are `BUILTINS`). */
const BUILTIN_NAMES = words(`
	radians degrees sin cos tan asin acos atan pow exp log exp2 log2 sqrt inversesqrt abs sign floor
	ceil fract mod min max clamp mix step smoothstep length distance dot cross normalize faceforward
	reflect refract matrixCompMult lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual
	any all not texture2D texture2DProj texture2DLod texture2DProjLod textureCube textureCubeLod
	texture2DLodEXT texture2DProjLodEXT textureCubeLodEXT texture2DGradEXT texture2DProjGradEXT
	textureCubeGradEXT dFdx dFdy fwidth sinh cosh tanh asinh acosh atanh trunc round roundEven modf
	isnan isinf floatBitsToInt floatBitsToUint intBitsToFloat uintBitsToFloat packSnorm2x16
	unpackSnorm2x16 packUnorm2x16 unpackUnorm2x16 packHalf2x16 unpackHalf2x16 outerProduct transpose
	determinant inverse textureSize texture textureProj textureLod textureOffset texelFetch
	texelFetchOffset textureProjOffset textureLodOffset textureProjLod textureProjLodOffset
	textureGrad textureGradOffset textureProjGrad textureProjGradOffset
`);

/** What reads a texture: a body reads the element through `efxSample` instead. */
const TEXTURE_READS = /^(texture|texel|textureCube|texture2D)/;

/**
 * The effect's shader's own global names (the pass header's, its macros, the compiler's uniforms and
 * `main`, and every name the particle shell declares in either stage): no port or local takes one,
 * and no body reads one.
 */
const SHELL_NAMES = new Set([
	...words(`
		main vTextureCoord finalColor uTexture uInputSize uInputClamp uOutputFrame uElement uPad PI uFx
		uSeed SHADER_NAME GL_ES GL_FRAGMENT_PRECISION_HIGH aPosition uOutputTexture
	`),
	...PARTICLE_SHELL_NAMES,
]);
const isShellName = (name: string): boolean => SHELL_NAMES.has(name) || /^uP\d+$/.test(name);

/** Why `name` cannot name a port, a local or a loop counter, or undefined when it can. */
export function customGlslNameIssue(name: string): string | undefined {
	if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(name))
		return 'is not a word of up to 32 letters, digits and _, starting with a letter';
	if (name.includes('__')) return 'has two _ in a row, which GLSL keeps for itself';
	if (name.startsWith('gl_') || name.startsWith('webgl')) return 'starts as GLSL’s own names do';
	if (name.startsWith('GL_')) return 'starts as the macros a driver defines (its extensions) do';
	if (name.startsWith('efx')) return 'starts with efx, which the library’s functions do';
	if (KEYWORDS.has(name)) return 'is a GLSL word';
	if (BUILTIN_NAMES.has(name)) return 'is a GLSL function';
	if (isShellName(name)) return 'is a name the effect’s shader uses';
	if (name in Object.prototype) return 'is a name every object has';
	return undefined;
}

// -------------------------------------------------------------------------------------------------
// TYPES
// -------------------------------------------------------------------------------------------------

type GType =
	| 'float'
	| 'int'
	| 'bool'
	| 'vec2'
	| 'vec3'
	| 'vec4'
	| 'bvec2'
	| 'bvec3'
	| 'bvec4'
	| 'mat2'
	| 'mat3'
	| 'mat4'
	| 'error';

/** What a local may be declared as. */
const DECLARABLE: ReadonlySet<string> = words('float int bool vec2 vec3 vec4 mat2 mat3 mat4');
/** What may be constructed. */
const CONSTRUCTIBLE: ReadonlySet<string> = words(
	'float int bool vec2 vec3 vec4 bvec2 bvec3 bvec4 mat2 mat3 mat4',
);

const isScalar = (t: GType): boolean => t === 'float' || t === 'int' || t === 'bool';
const isVec = (t: GType): boolean => t === 'vec2' || t === 'vec3' || t === 'vec4';
const isBvec = (t: GType): boolean => t === 'bvec2' || t === 'bvec3' || t === 'bvec4';
const isMat = (t: GType): boolean => t === 'mat2' || t === 'mat3' || t === 'mat4';
const isGen = (t: GType): boolean => t === 'float' || isVec(t);
const isFloaty = (t: GType): boolean => t === 'float' || isVec(t) || isMat(t);
const isNumeric = (t: GType): boolean => t === 'int' || isFloaty(t);
const width = (t: GType): number => (isScalar(t) ? 1 : Number(t.slice(-1)));
const components = (t: GType): number => (isMat(t) ? width(t) ** 2 : width(t));
const bvecOf = (t: GType): GType => `bvec${width(t)}` as GType;

/** `a op b` for + − × ÷: GLSL ES 1.00 converts nothing (an int never meets a float). */
function arithmetic(op: string, a: GType, b: GType): GType | undefined {
	if (a === 'int' && b === 'int') return 'int';
	if (!isFloaty(a) || !isFloaty(b)) return undefined;
	if (a === 'float') return b;
	if (b === 'float') return a;
	if (a === b) return a;
	if (op === '*' && isMat(a) && isVec(b) && width(a) === width(b)) return b;
	if (op === '*' && isVec(a) && isMat(b) && width(a) === width(b)) return a;
	return undefined;
}

/**
 * The work of `a op b` (+ − × ÷) in the cost estimate: a matrix product n³, a matrix and a vector n²,
 * else a step per component of the result.
 */
const arithmeticWork = (op: string, a: GType, b: GType, result: GType): number => {
	if (op === '*' && isMat(a) && isMat(b)) return width(a) ** 3;
	if (op === '*' && (isMat(a) || isMat(b)) && (isVec(a) || isVec(b))) return width(a) ** 2;
	return components(result);
};

type Resolve = (args: readonly GType[]) => GType | undefined;

const unaryGen: Resolve = (a) => (a.length === 1 && isGen(a[0]) ? a[0] : undefined);
const sameGen =
	(n: number): Resolve =>
	(a) =>
		a.length === n && isGen(a[0]) && a.every((t) => t === a[0]) ? a[0] : undefined;
const genOrFloat: Resolve = (a) =>
	a.length === 2 && isGen(a[0]) && (a[1] === a[0] || a[1] === 'float') ? a[0] : undefined;
const relational: Resolve = (a) =>
	a.length === 2 && isVec(a[0]) && a[1] === a[0] ? bvecOf(a[0]) : undefined;

/** The GLSL ES 1.00 built-in functions a body may call (no texture reads), each typed. */
const BUILTINS: Readonly<Record<string, Resolve>> = {
	...Object.fromEntries(
		[
			'radians',
			'degrees',
			'sin',
			'cos',
			'tan',
			'asin',
			'acos',
			'exp',
			'log',
			'exp2',
			'log2',
			'sqrt',
			'inversesqrt',
			'abs',
			'sign',
			'floor',
			'ceil',
			'fract',
			'normalize',
		].map((name) => [name, unaryGen]),
	),
	atan: (a) => (a.length === 1 ? unaryGen(a) : sameGen(2)(a)),
	pow: sameGen(2),
	mod: genOrFloat,
	min: genOrFloat,
	max: genOrFloat,
	clamp: (a) =>
		a.length === 3 &&
		isGen(a[0]) &&
		((a[1] === a[0] && a[2] === a[0]) || (a[1] === 'float' && a[2] === 'float'))
			? a[0]
			: undefined,
	mix: (a) =>
		a.length === 3 && isGen(a[0]) && a[1] === a[0] && (a[2] === a[0] || a[2] === 'float')
			? a[0]
			: undefined,
	step: (a) =>
		a.length === 2 && isGen(a[1]) && (a[0] === a[1] || a[0] === 'float') ? a[1] : undefined,
	smoothstep: (a) =>
		a.length === 3 &&
		isGen(a[2]) &&
		((a[0] === a[2] && a[1] === a[2]) || (a[0] === 'float' && a[1] === 'float'))
			? a[2]
			: undefined,
	length: (a) => (a.length === 1 && isGen(a[0]) ? 'float' : undefined),
	distance: (a) => (sameGen(2)(a) ? 'float' : undefined),
	dot: (a) => (sameGen(2)(a) ? 'float' : undefined),
	cross: (a) => (a.length === 2 && a[0] === 'vec3' && a[1] === 'vec3' ? 'vec3' : undefined),
	faceforward: sameGen(3),
	reflect: sameGen(2),
	refract: (a) =>
		a.length === 3 && isGen(a[0]) && a[1] === a[0] && a[2] === 'float' ? a[0] : undefined,
	matrixCompMult: (a) => (a.length === 2 && isMat(a[0]) && a[1] === a[0] ? a[0] : undefined),
	lessThan: relational,
	lessThanEqual: relational,
	greaterThan: relational,
	greaterThanEqual: relational,
	equal: (a) =>
		a.length === 2 && (isVec(a[0]) || isBvec(a[0])) && a[1] === a[0] ? bvecOf(a[0]) : undefined,
	notEqual: (a) =>
		a.length === 2 && (isVec(a[0]) || isBvec(a[0])) && a[1] === a[0] ? bvecOf(a[0]) : undefined,
	any: (a) => (a.length === 1 && isBvec(a[0]) ? 'bool' : undefined),
	all: (a) => (a.length === 1 && isBvec(a[0]) ? 'bool' : undefined),
	not: (a) => (a.length === 1 && isBvec(a[0]) ? a[0] : undefined),
};

/** Built-in function `name`'s typing, if a body may call it. */
const builtin = (name: string): Resolve | undefined =>
	Object.hasOwn(BUILTINS, name) ? BUILTINS[name] : undefined;

/** Work a built-in call counts in the cost estimate. */
const BUILTIN_COST: Readonly<Record<string, number>> = {
	...Object.fromEntries(Object.keys(BUILTINS).map((name) => [name, 1])),
	...Object.fromEntries(
		[
			'length',
			'distance',
			'normalize',
			'smoothstep',
			'sqrt',
			'inversesqrt',
			'reflect',
			'faceforward',
			'refract',
		].map((name) => [name, 2]),
	),
	...Object.fromEntries(
		['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'pow', 'exp', 'log', 'exp2', 'log2'].map(
			(name) => [name, 4],
		),
	),
};

// -------------------------------------------------------------------------------------------------
// TOKENS
// -------------------------------------------------------------------------------------------------

interface Token {
	kind: 'id' | 'int' | 'float' | 'op';
	text: string;
	line: number;
	value?: number;
}

/** A refusal that stops the check: the code cannot be read past it. */
class Stop {
	readonly message: string;
	readonly line?: number;

	constructor(message: string, line?: number) {
		this.message = message;
		this.line = line;
	}
}

const OPS = [
	'<<=',
	'>>=',
	'<=',
	'>=',
	'==',
	'!=',
	'&&',
	'||',
	'^^',
	'+=',
	'-=',
	'*=',
	'/=',
	'++',
	'--',
	'<<',
	'>>',
	'%=',
	'&=',
	'|=',
	'^=',
	...'(){}.,;?:+-*/<>!=%&|^~[]',
];

const REFUSED_OPS: Readonly<Record<string, string>> = {
	'%': '% is reserved in GLSL ES 1.00: use mod()',
	'%=': '%= is reserved in GLSL ES 1.00: use mod()',
	'[': 'arrays and indexing are not allowed: use a swizzle (.x, .xy)',
	']': 'arrays and indexing are not allowed: use a swizzle (.x, .xy)',
	',': 'the comma operator is not allowed: write one statement each',
	...Object.fromEntries(
		['<<', '>>', '<<=', '>>=', '&', '|', '^', '&=', '|=', '^=', '~'].map((op) => [
			op,
			`${op} is reserved in GLSL ES 1.00 (no bitwise operators)`,
		]),
	),
};

const NUMBER = /(\d+\.\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+|\d+)/y;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;

interface Lexed {
	tokens: Token[];
	/** The code with its comments blanked out, line for line: what the function's body is. */
	stripped: string;
}

/**
 * `code` as tokens. A line ends at a line feed, a carriage return or both, as GLSL's lines do: each is
 * read as one line feed, which the stripped code keeps, so no two tokens ever run together once the
 * comments are out. `lenient` (the library's own functions, for their cost) takes brackets and
 * anything in a comment and counts nothing; else a refused character, operator or number, an
 * unclosed comment, or too many tokens stops it.
 */
function lex(source: string, lenient = false): Lexed {
	const code = source.replace(/\r\n?/g, '\n');
	const tokens: Token[] = [];
	let stripped = '';
	let line = 1;
	let i = 0;
	const blank = (from: number, to: number): void => {
		stripped += code.slice(from, to).replace(/[^\n]/g, ' ');
	};
	while (i < code.length) {
		const c = code[i];
		if (c === '\n') {
			line++;
			stripped += c;
			i++;
			continue;
		}
		if (c === ' ' || c === '\t') {
			stripped += c;
			i++;
			continue;
		}
		if (c === '/' && code[i + 1] === '/') {
			const end = code.indexOf('\n', i);
			const to = end < 0 ? code.length : end;
			blank(i, to);
			i = to;
			continue;
		}
		if (c === '/' && code[i + 1] === '*') {
			const end = code.indexOf('*/', i + 2);
			if (end < 0) throw new Stop('a /* comment is never closed', line);
			blank(i, end + 2);
			for (let k = i; k < end; k++) if (code[k] === '\n') line++;
			i = end + 2;
			continue;
		}
		if (!lenient && tokens.length >= CUSTOM_GLSL_TOKENS_MAX)
			throw new Stop(`the code is longer than ${CUSTOM_GLSL_TOKENS_MAX} tokens`, line);
		if (c === '#') throw new Stop('# (the preprocessor) is not allowed', line);
		NUMBER.lastIndex = i;
		const number = /[0-9.]/.test(c) ? NUMBER.exec(code) : null;
		if (number) {
			const text = number[0];
			const after = code[i + text.length];
			if (after !== undefined && /[A-Za-z0-9_.]/.test(after))
				throw new Stop(`${quoted(text + after)}… is not a number GLSL ES 1.00 reads`, line);
			const isInt = /^\d+$/.test(text);
			const value = Number(text);
			if (isInt && text.length > 1 && text[0] === '0')
				throw new Stop(`${text} would read as octal: write it without the leading 0`, line);
			if (isInt && value > CUSTOM_GLSL_INT_MAX && !lenient)
				throw new Stop(
					`${text} is past ±${CUSTOM_GLSL_INT_MAX}, all a fragment shader’s integer is sure to hold (mediump): write ${text}.0 for a float`,
					line,
				);
			if (!isInt && !(value <= CUSTOM_GLSL_FLOAT_MAX))
				throw new Stop(`${text} is past the largest number a body takes, 1e30`, line);
			tokens.push({ kind: isInt ? 'int' : 'float', text, line, value });
			stripped += text;
			i += text.length;
			continue;
		}
		NAME.lastIndex = i;
		const name = NAME.exec(code);
		if (name) {
			const text = name[0];
			if (!lenient && text.length > 64)
				throw new Stop(`${quoted(text)} is longer than 64 characters`, line);
			tokens.push({ kind: 'id', text, line });
			stripped += text;
			i += text.length;
			continue;
		}
		const op = OPS.find((o) => code.startsWith(o, i));
		if (!op) {
			if (lenient) {
				stripped += c;
				i++;
				continue;
			}
			throw new Stop(`${quoted(c)} is not part of GLSL`, line);
		}
		if (!lenient && REFUSED_OPS[op] && op !== ',') throw new Stop(REFUSED_OPS[op], line);
		tokens.push({ kind: 'op', text: op, line });
		stripped += op;
		i += op.length;
	}
	return { tokens, stripped };
}

// -------------------------------------------------------------------------------------------------
// THE LIBRARY: what each `efx…` function takes and gives, and costs
// -------------------------------------------------------------------------------------------------

interface Signature {
	returns: GType;
	params: GType[];
}

const isLibraryName = (name: string): boolean =>
	Object.hasOwn(EFX_GLSL, name) || (EFX_HEADER_FUNCTIONS as readonly string[]).includes(name);

const sourceOf = (name: string): string =>
	Object.hasOwn(EFX_GLSL, name)
		? EFX_GLSL[name]
		: (EFX_HEADER_SIGNATURES as Readonly<Record<string, string>>)[name];

const signatures = new Map<string, Signature | undefined>();

/**
 * How library function `name` is called, read off its own declaration; undefined for one a body
 * cannot call (an `out` parameter, an array, a type the checker does not type).
 */
function librarySignature(name: string): Signature | undefined {
	const source = sourceOf(name);
	const key = `${name}\u0000${source}`;
	if (signatures.has(key)) return signatures.get(key);
	let signature: Signature | undefined;
	const declared = new RegExp(
		`\\b(float|int|bool|vec[234]|mat[234])\\s+${name}\\s*\\(([^)]*)\\)`,
	).exec(source.replace(/\/\/[^\n]*/g, ''));
	if (declared) {
		const list = declared[2].trim();
		const params = list === '' || list === 'void' ? [] : list.split(',').map((p) => p.trim());
		const types = params.map(
			(p) => /^(?:in\s+)?(float|int|bool|vec[234]|mat[234])\s+\w+$/.exec(p)?.[1] as GType,
		);
		if (types.every(Boolean)) signature = { returns: declared[1] as GType, params: types };
	}
	signatures.set(key, signature);
	return signature;
}

interface Cost {
	ops: number;
	reads: number;
}

/** The test and the step of a loop, each round. */
const LOOP_ROUND_COST = 2;
const COUNTED_OPS: ReadonlySet<string> = words(
	'+ - * / < > <= >= == != && || ^^ ! ? += -= *= /= ++ --',
);
const libraryCosts = new Map<string, Cost>();

/** Library function `name`'s work and reads by the estimate (the header's helpers, a fixed 2). */
function libraryCost(name: string, visiting: Set<string> = new Set()): Cost {
	if (!Object.hasOwn(EFX_GLSL, name)) return { ops: 2, reads: name === 'efxSample' ? 1 : 0 };
	const source = EFX_GLSL[name];
	const key = `${name}\u0000${source}`;
	const known = libraryCosts.get(key);
	if (known) return known;
	if (visiting.has(name)) return { ops: 0, reads: 0 };
	visiting.add(name);
	let cost: Cost = { ops: 0, reads: 0 };
	try {
		const { tokens } = lex(source, true);
		const open = tokens.findIndex((t) => t.text === '{');
		if (open >= 0)
			cost = estimate(tokens, open + 1, closing(tokens, open, tokens.length), visiting);
	} catch {
		cost = { ops: 0, reads: 0 };
	}
	visiting.delete(name);
	libraryCosts.set(key, cost);
	return cost;
}

/** The index of the bracket closing the one at `at` (`(` or `{`), or `to`. */
function closing(tokens: readonly Token[], at: number, to: number): number {
	const open = tokens[at].text;
	const close = open === '(' ? ')' : '}';
	let depth = 0;
	for (let i = at; i < to; i++) {
		if (tokens[i].text === open) depth++;
		else if (tokens[i].text === close && --depth === 0) return i;
	}
	return to;
}

/** Where the statement starting at `at` ends (the index after it), up to `to`. */
function statementEnd(tokens: readonly Token[], at: number, to: number): number {
	const first = tokens[at];
	if (!first) return to;
	if (first.text === '{') return Math.min(to, closing(tokens, at, to) + 1);
	if ((first.text === 'if' || first.text === 'for' || first.text === 'while') && tokens[at + 1]) {
		let end = statementEnd(tokens, closing(tokens, at + 1, to) + 1, to);
		if (first.text === 'if' && tokens[end]?.text === 'else')
			end = statementEnd(tokens, end + 1, to);
		return end;
	}
	let depth = 0;
	for (let i = at; i < to; i++) {
		const text = tokens[i].text;
		if (text === '(') depth++;
		else if (text === ')') depth--;
		else if (text === ';' && depth <= 0) return i + 1;
	}
	return to;
}

/** A literal integer at `at` (a sign allowed): its value and the index after it. */
function literalInt(tokens: readonly Token[], at: number): [number, number] | undefined {
	let sign = 1;
	let i = at;
	if (tokens[i]?.text === '-' || tokens[i]?.text === '+') {
		sign = tokens[i].text === '-' ? -1 : 1;
		i++;
	}
	const t = tokens[i];
	return t?.kind === 'int' ? [sign * (t.value as number), i + 1] : undefined;
}

/**
 * How many rounds `start`, `test` against `bound` and `step` make (undefined past `cap`: more, or
 * never ending), and the value furthest from 0 the counter takes, the one that ends the loop included.
 */
function rounds(
	start: number,
	test: string,
	bound: number,
	step: number,
	cap: number,
): { rounds?: number; furthest: number } {
	const holds = (x: number): boolean =>
		test === '<' ? x < bound : test === '<=' ? x <= bound : test === '>' ? x > bound : x >= bound;
	let n = 0;
	let furthest = start;
	for (let i = start; holds(i); i += step) {
		if (++n > cap) return { furthest };
		if (Math.abs(i + step) > Math.abs(furthest)) furthest = i + step;
	}
	return { rounds: n, furthest };
}

/**
 * A loop header's rounds (`tokens` between its brackets): `[int] i = A; i <op> B; <step>` with
 * literals, as the checker requires. Undefined when it does not read so.
 */
function headerRounds(tokens: readonly Token[], cap: number): number | undefined {
	let i = DECLARABLE.has(tokens[0]?.text) ? 1 : 0;
	const name = tokens[i]?.text;
	if (tokens[i]?.kind !== 'id' || tokens[i + 1]?.text !== '=') return undefined;
	const start = literalInt(tokens, i + 2);
	if (!start || tokens[start[1]]?.text !== ';' || tokens[start[1] + 1]?.text !== name)
		return undefined;
	i = start[1] + 2;
	const test = tokens[i]?.text;
	if (!['<', '<=', '>', '>='].includes(test)) return undefined;
	const bound = literalInt(tokens, i + 1);
	if (!bound || tokens[bound[1]]?.text !== ';') return undefined;
	const step = stepOf(tokens.slice(bound[1] + 1), name);
	return step === undefined ? undefined : rounds(start[0], test, bound[0], step, cap).rounds;
}

/** A loop's step (`i++`, `--i`, `i += 2`…) as a number, or undefined. */
function stepOf(tokens: readonly Token[], name: string): number | undefined {
	const [a, b, c] = tokens;
	if (tokens.length === 2 && a?.text === name && (b?.text === '++' || b?.text === '--'))
		return b.text === '++' ? 1 : -1;
	if (tokens.length === 2 && b?.text === name && (a?.text === '++' || a?.text === '--'))
		return a.text === '++' ? 1 : -1;
	if (a?.text === name && (b?.text === '+=' || b?.text === '-=') && c) {
		const n = literalInt(tokens, 2);
		if (n && n[1] === tokens.length) return b.text === '+=' ? n[0] : -n[0];
	}
	return undefined;
}

/**
 * The work and reads of `tokens[from…to)`, its loops times their rounds, untyped: a library
 * function's (fixed code), each operator and call counted once.
 */
function estimate(
	tokens: readonly Token[],
	from: number,
	to: number,
	visiting: Set<string> = new Set(),
): Cost {
	let ops = 0;
	let reads = 0;
	let i = from;
	while (i < to) {
		const t = tokens[i];
		if (t.text === 'for' && tokens[i + 1]?.text === '(') {
			const close = closing(tokens, i + 1, to);
			const n =
				headerRounds(tokens.slice(i + 2, close), CUSTOM_GLSL_LOOP_MAX) ?? CUSTOM_GLSL_LOOP_MAX;
			const end = statementEnd(tokens, close + 1, to);
			const body = estimate(tokens, close + 1, end, visiting);
			ops += n * (body.ops + LOOP_ROUND_COST);
			reads += n * body.reads;
			i = end;
			continue;
		}
		if (t.kind === 'op' && COUNTED_OPS.has(t.text)) ops += 1;
		else if (t.kind === 'id' && tokens[i + 1]?.text === '(') {
			if (Object.hasOwn(BUILTIN_COST, t.text)) ops += BUILTIN_COST[t.text];
			else if (isLibraryName(t.text)) {
				const cost = libraryCost(t.text, visiting);
				ops += cost.ops;
				reads += cost.reads;
			}
		}
		i++;
	}
	return { ops, reads };
}

// -------------------------------------------------------------------------------------------------
// THE CHECK
// -------------------------------------------------------------------------------------------------

interface Variable {
	type: GType;
	kind: 'input' | 'output' | 'inout' | 'local' | 'counter';
}

interface Lvalue {
	name: string;
	variable: Variable;
	/** A swizzle naming a component twice: it reads, but cannot be written. */
	repeats: boolean;
}

/** An expression checked: its type, where it can be written, its integer value when constant, its
 *  depth as a tree. */
interface Info {
	type: GType;
	lv?: Lvalue;
	int?: number;
	height: number;
}

const ERROR: Info = { type: 'error', height: 1 };

const SWIZZLES = ['xyzw', 'rgba', 'stpq'];
const ASSIGNMENTS: ReadonlySet<string> = words('= += -= *= /=');
const LEVELS: readonly (readonly string[])[] = [
	['||'],
	['^^'],
	['&&'],
	['==', '!='],
	['<', '>', '<=', '>='],
	['+', '-'],
	['*', '/'],
];

const article = (type: GType): string => (/^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`);

interface Note {
	level: GraphIssueLevel;
	message: string;
	line?: number;
}

/** One body checked against its ports. */
class Checker {
	private at = 0;
	readonly notes: Note[] = [];
	private readonly scopes: Map<string, Variable>[] = [];
	private nest = 0;
	private loops = 0;
	private rounds = 1;
	/** The outputs some statement writes, and those written on every path so far. */
	private readonly written = new Set<string>();
	private definite = new Set<string>();
	private dead = false;
	/** Outputs some way out of the code leaves unwritten. */
	private readonly partial = new Set<string>();
	/** The work and the reads of the element so far, each times the rounds of the loops around it. */
	work = 0;
	reads = 0;

	private readonly tokens: readonly Token[];
	private readonly outputs: readonly string[];

	constructor(
		tokens: readonly Token[],
		ports: ReadonlyMap<string, Variable>,
		outputs: readonly string[],
	) {
		this.tokens = tokens;
		this.outputs = outputs;
		this.scopes.push(new Map(ports));
	}

	run(): void {
		this.scopes.push(new Map());
		while (this.at < this.tokens.length) {
			if (this.peek()?.text === '}')
				throw new Stop('this } closes nothing: the braces must balance', this.peek()?.line);
			this.statement();
		}
		this.leave();
		this.exit();
		for (const name of this.outputs) {
			if (!this.written.has(name))
				this.note('error', `output ${quoted(name)} is never written`, undefined);
			else if (this.partial.has(name))
				this.note(
					'warning',
					`output ${quoted(name)} is written on some paths only: elsewhere it gives its default (else 0)`,
					undefined,
				);
		}
	}

	// --- reading tokens ---

	private peek(ahead = 0): Token | undefined {
		return this.tokens[this.at + ahead];
	}

	private next(): Token {
		const t = this.tokens[this.at];
		if (!t) {
			const last = this.tokens[this.tokens.length - 1];
			throw new Stop('the code ends too soon: a ; or } is missing', last?.line);
		}
		this.at++;
		return t;
	}

	private is(text: string, ahead = 0): boolean {
		return this.tokens[this.at + ahead]?.text === text;
	}

	private expect(text: string, what = `a ${text}`): Token {
		const t = this.peek();
		if (t?.text !== text)
			throw new Stop(
				t ? `${what} is missing before ${quoted(t.text)}` : `${what} is missing at the end`,
				t?.line ?? this.tokens[this.tokens.length - 1]?.line,
			);
		return this.next();
	}

	private note(level: GraphIssueLevel, message: string, line: number | undefined): void {
		if (this.notes.length < ISSUES_MAX) this.notes.push({ level, message, line });
	}

	private error(message: string, line: number | undefined): Info {
		this.note('error', message, line);
		return ERROR;
	}

	private enter(line: number | undefined): void {
		if (++this.nest > CUSTOM_GLSL_DEPTH_MAX)
			throw new Stop(`the code nests deeper than ${CUSTOM_GLSL_DEPTH_MAX}: split it up`, line);
	}

	private leave(): void {
		this.scopes.pop();
	}

	private spend(work: number, reads = 0): void {
		this.work += work * this.rounds;
		this.reads += reads * this.rounds;
	}

	// --- names ---

	private lookup(name: string): Variable | undefined {
		for (let i = this.scopes.length - 1; i >= 0; i--) {
			const found = this.scopes[i].get(name);
			if (found) return found;
		}
		return undefined;
	}

	private define(name: string, variable: Variable, line: number): void {
		const issue = customGlslNameIssue(name);
		if (issue) {
			this.note('error', `${quoted(name)} ${issue}`, line);
			return;
		}
		if (this.lookup(name)) {
			this.note('error', `${quoted(name)} is already declared: give this one another name`, line);
			return;
		}
		this.scopes[this.scopes.length - 1].set(name, variable);
	}

	/** Why a name that is no variable here cannot be read. */
	private unknown(name: string, line: number): Info {
		if (name.startsWith('gl_')) return this.error(`${name}: gl_ names are not allowed`, line);
		if (TEXTURE_READS.test(name) && BUILTIN_NAMES.has(name))
			return this.error(
				`${name} reads a texture: read the element with efxSample(px), which keeps the padding and margins`,
				line,
			);
		if (/^[iu]?sampler/.test(name))
			return this.error(`samplers are not allowed: read the element with efxSample`, line);
		if (isShellName(name))
			return this.error(
				`${name} belongs to the effect’s shader, not to this node: wire what it needs into an input`,
				line,
			);
		if (builtin(name) || isLibraryName(name))
			return this.error(`${name} is a function: call it, ${name}(…)`, line);
		if (BUILTIN_NAMES.has(name)) return this.error(`${name} is not a GLSL ES 1.00 function`, line);
		if (name.startsWith('efx'))
			return this.error(`${quoted(name)} is not one of the library’s functions`, line);
		if (KEYWORDS.has(name)) return this.error(`${name} cannot be used here`, line);
		return this.error(`${quoted(name)} is not declared`, line);
	}

	// --- statements ---

	private statement(): void {
		const t = this.peek();
		if (!t) throw new Stop('the code ends too soon', this.tokens[this.tokens.length - 1]?.line);
		if (t.text === '{') return this.block();
		if (t.text === ';') {
			this.next();
			return;
		}
		if (t.kind === 'id') {
			switch (t.text) {
				case 'if':
					return this.ifStatement();
				case 'for':
					return this.forStatement();
				case 'while':
				case 'do':
					throw new Stop(
						`${t.text} loops are not allowed: use for, with literal bounds (at most ${CUSTOM_GLSL_LOOP_MAX} rounds)`,
						t.line,
					);
				case 'discard':
					throw new Stop('discard is not allowed: write a transparent colour instead', t.line);
				case 'return':
					this.next();
					if (!this.is(';'))
						throw new Stop('return takes no value here: write the outputs, then return;', t.line);
					this.next();
					this.exit();
					this.dead = true;
					return;
				case 'break':
				case 'continue':
					this.next();
					if (!this.loops) this.note('error', `${t.text} belongs inside a loop`, t.line);
					this.expect(';');
					this.dead = true;
					return;
				case 'else':
					throw new Stop('this else has no if', t.line);
				case 'uniform':
				case 'attribute':
				case 'varying':
				case 'struct':
				case 'precision':
					throw new Stop(`${t.text} declarations are not allowed: wire values into inputs`, t.line);
				case 'void':
					throw new Stop('functions cannot be declared: the code is one function’s body', t.line);
				case 'const':
				case 'in':
				case 'out':
				case 'inout':
				case 'invariant':
				case 'lowp':
				case 'mediump':
				case 'highp':
					throw new Stop(`${t.text}: a local is declared plainly (float x = 1.0;)`, t.line);
			}
			if (DECLARABLE.has(t.text) && this.peek(1)?.kind === 'id') return this.declaration();
			if (/^[iu]?sampler/.test(t.text) && KEYWORDS.has(t.text))
				throw new Stop('samplers are not allowed: read the element with efxSample', t.line);
			if (/^[iu]vec[234]$/.test(t.text))
				throw new Stop(`${t.text} is not supported here: use vec2, vec3 or vec4`, t.line);
			if (/^bvec[234]$/.test(t.text) && this.peek(1)?.kind === 'id')
				throw new Stop(
					`${t.text} locals are not supported: test the vector at once, as any(lessThan(a, b))`,
					t.line,
				);
		}
		this.full(this.expression());
		if (this.is(',')) throw new Stop(REFUSED_OPS[','], this.peek()?.line);
		this.expect(';', 'a ;');
	}

	private block(): void {
		const open = this.next();
		this.enter(open.line);
		this.scopes.push(new Map());
		while (!this.is('}')) {
			if (!this.peek()) throw new Stop('this { is never closed', open.line);
			this.statement();
		}
		this.next();
		this.leave();
		this.nest--;
	}

	/** A branch or a loop's body: a statement in a scope of its own. */
	private scoped(line: number): void {
		this.enter(line);
		this.scopes.push(new Map());
		this.statement();
		this.leave();
		this.nest--;
	}

	private ifStatement(): void {
		const t = this.next();
		this.expect('(', 'a (');
		const test = this.expression();
		this.expect(')', 'a )');
		this.full(test);
		if (test.type !== 'error' && test.type !== 'bool')
			this.note('error', `if tests a bool, not ${article(test.type)}`, t.line);
		const before = this.definite;
		const wasDead = this.dead;
		this.definite = new Set(before);
		this.scoped(t.line);
		const then = { definite: this.definite, dead: this.dead };
		this.definite = new Set(before);
		this.dead = wasDead;
		if (this.is('else')) {
			this.next();
			this.scoped(t.line);
		}
		const otherwise = { definite: this.definite, dead: this.dead };
		this.dead = then.dead && otherwise.dead;
		this.definite = then.dead
			? otherwise.definite
			: otherwise.dead
				? then.definite
				: new Set([...then.definite].filter((name) => otherwise.definite.has(name)));
	}

	private forStatement(): void {
		const t = this.next();
		const how = `for (int i = 0; i < ${Math.min(8, CUSTOM_GLSL_LOOP_MAX)}; i++)`;
		this.expect('(', 'a (');
		if (!this.is('int')) throw new Stop(`a loop counts with an int: ${how}`, t.line);
		this.next();
		const nameToken = this.next();
		if (nameToken.kind !== 'id') throw new Stop(`a loop counts with an int: ${how}`, t.line);
		const name = nameToken.text;
		this.expect('=', 'a =');
		const start = this.literal(how, t.line);
		this.expect(';', 'a ;');
		if (this.peek()?.text !== name)
			throw new Stop(`a loop’s test reads its counter first: ${how}`, t.line);
		this.next();
		const test = this.next();
		if (!['<', '<=', '>', '>='].includes(test.text))
			throw new Stop(`a loop tests its counter with <, <=, > or >=: ${how}`, t.line);
		const bound = this.literal(how, t.line);
		this.expect(';', 'a ;');
		const stepFrom = this.at;
		while (this.peek() && !this.is(')')) this.next();
		const step = stepOf(this.tokens.slice(stepFrom, this.at), name);
		if (step === undefined)
			throw new Stop(`a loop steps its counter by a literal (i++, i--, i += 2): ${how}`, t.line);
		this.expect(')', 'a )');
		const run = rounds(start, test.text, bound, step, CUSTOM_GLSL_LOOP_MAX);
		const n = run.rounds;
		if (n === undefined)
			throw new Stop(
				`a loop runs at most ${CUSTOM_GLSL_LOOP_MAX} rounds; this one runs more, or never ends`,
				t.line,
			);
		if (Math.abs(run.furthest) > CUSTOM_GLSL_INT_MAX)
			throw new Stop(
				`the counter reaches ${run.furthest}, past ±${CUSTOM_GLSL_INT_MAX}, all a fragment shader’s integer is sure to hold (mediump): it may wrap and never end`,
				t.line,
			);
		if (this.rounds * n > CUSTOM_GLSL_NESTED_MAX)
			throw new Stop(
				`loops in loops run ${this.rounds * n} rounds here, more than ${CUSTOM_GLSL_NESTED_MAX}`,
				t.line,
			);
		this.spend(LOOP_ROUND_COST * n);
		this.scopes.push(new Map());
		this.define(name, { type: 'int', kind: 'counter' }, nameToken.line);
		const before = this.definite;
		const wasDead = this.dead;
		const outer = this.rounds;
		this.loops++;
		this.rounds = outer * Math.max(1, n);
		this.definite = new Set(before);
		this.scoped(t.line);
		this.loops--;
		this.rounds = outer;
		// The body may not run at all, and what follows runs after it however it left.
		this.definite = before;
		this.dead = wasDead;
		this.leave();
	}

	/** A literal integer, a sign allowed. */
	private literal(how: string, line: number): number {
		const read = literalInt(this.tokens, this.at);
		if (!read) throw new Stop(`a loop’s bounds are literal integers: ${how}`, line);
		this.at = read[1];
		return read[0];
	}

	private declaration(): void {
		const typeToken = this.next();
		const type = typeToken.text as GType;
		for (;;) {
			const nameToken = this.next();
			if (nameToken.kind !== 'id') throw new Stop('a declaration names a local', nameToken.line);
			if (this.is('('))
				throw new Stop(
					'functions cannot be declared: the code is one function’s body',
					nameToken.line,
				);
			if (!this.is('='))
				throw new Stop(
					`give ${quoted(nameToken.text)} a value where it is declared (${type} ${nameToken.text} = …;)`,
					nameToken.line,
				);
			this.next();
			const value = this.expression();
			this.full(value);
			if (value.type !== 'error' && value.type !== type)
				this.note(
					'error',
					`${quoted(nameToken.text)} is ${article(type)}, given ${article(value.type)}${hint(type, value.type)}`,
					nameToken.line,
				);
			this.define(nameToken.text, { type, kind: 'local' }, nameToken.line);
			if (this.is(',')) {
				this.next();
				continue;
			}
			this.expect(';', 'a ;');
			return;
		}
	}

	/** A way out of the code: the outputs not yet written on this path are written on some only. */
	private exit(): void {
		if (this.dead) return;
		for (const name of this.outputs) if (!this.definite.has(name)) this.partial.add(name);
	}

	/** A whole expression: deep trees are refused (a GPU's compiler limits them). */
	private full(info: Info): void {
		if (info.height + this.nest > CUSTOM_GLSL_TREE_MAX)
			this.note(
				'error',
				`an expression ${info.height} deep: split it into locals (at most ${CUSTOM_GLSL_TREE_MAX})`,
				this.peek(-1)?.line,
			);
	}

	// --- expressions ---

	private expression(): Info {
		const left = this.conditional();
		const op = this.peek();
		if (op?.kind !== 'op' || !ASSIGNMENTS.has(op.text)) return left;
		this.next();
		this.enter(op.line);
		const right = this.expression();
		this.nest--;
		return this.assign(left, op.text, right, op.line);
	}

	private assign(left: Info, op: string, right: Info, line: number): Info {
		const height = 1 + Math.max(left.height, right.height);
		if (!this.writable(left, line)) return { ...ERROR, height };
		if (right.type === 'error') return { type: left.type, height };
		if (op === '=') {
			if (right.type !== left.type)
				this.note(
					'error',
					`${article(left.type)} is given ${article(right.type)}${hint(left.type, right.type)}`,
					line,
				);
		} else {
			const arith = op.slice(0, 1);
			if (arithmetic(arith, left.type, right.type) !== left.type)
				this.note(
					'error',
					`${op} cannot take ${article(left.type)} and ${article(right.type)}${hint(left.type, right.type)}`,
					line,
				);
			else if (arith === '/' && left.type === 'int' && right.int === 0)
				this.note('error', 'an integer is divided by 0', line);
			else this.spend(arithmeticWork(arith, left.type, right.type, left.type));
		}
		return { type: left.type, height };
	}

	/** Whether `target` can be written; says why not. Marks an output written. */
	private writable(target: Info, line: number): boolean {
		if (target.type === 'error') return false;
		const lv = target.lv;
		if (!lv) {
			this.note('error', 'only a local, an output or a part of one can be written', line);
			return false;
		}
		if (lv.variable.kind === 'input') {
			this.note('error', `${quoted(lv.name)} is an input: copy it into a local to change it`, line);
			return false;
		}
		if (lv.variable.kind === 'counter') {
			this.note('error', `${quoted(lv.name)} counts the loop: it cannot change inside it`, line);
			return false;
		}
		if (lv.repeats) {
			this.note('error', 'a swizzle written to names each component once', line);
			return false;
		}
		if (lv.variable.kind === 'output' || lv.variable.kind === 'inout') {
			this.written.add(lv.name);
			this.definite.add(lv.name);
		}
		return true;
	}

	private conditional(): Info {
		const test = this.binary(0);
		if (!this.is('?')) return test;
		const q = this.next();
		this.enter(q.line);
		const then = this.expression();
		this.expect(':', 'a :');
		const otherwise = this.expression();
		this.nest--;
		const height = 1 + Math.max(test.height, then.height, otherwise.height);
		if ([test.type, then.type, otherwise.type].includes('error')) return { ...ERROR, height };
		if (test.type !== 'bool')
			return { ...this.error(`? tests a bool, not ${article(test.type)}`, q.line), height };
		if (then.type !== otherwise.type)
			return {
				...this.error(
					`? gives one type either way, not ${article(then.type)} and ${article(otherwise.type)}`,
					q.line,
				),
				height,
			};
		this.spend(1);
		return { type: then.type, height };
	}

	private binary(level: number): Info {
		if (level === LEVELS.length) return this.unary();
		let left = this.binary(level + 1);
		while (this.peek()?.kind === 'op' && LEVELS[level].includes(this.peek()?.text as string)) {
			const op = this.next();
			const right = this.binary(level + 1);
			left = this.operate(op.text, left, right, op.line);
		}
		return left;
	}

	private operate(op: string, a: Info, b: Info, line: number): Info {
		const height = 1 + Math.max(a.height, b.height);
		if (a.type === 'error' || b.type === 'error') return { ...ERROR, height };
		const fail = (message: string): Info => ({ ...this.error(message, line), height });
		if (op === '+' || op === '-' || op === '*' || op === '/') {
			const type = arithmetic(op, a.type, b.type);
			if (!type)
				return fail(
					`${op} cannot take ${article(a.type)} and ${article(b.type)}${hint(a.type, b.type)}`,
				);
			if (type === 'int' && op === '/' && b.int === 0) return fail('an integer is divided by 0');
			if (a.int !== undefined && b.int !== undefined) {
				const value =
					op === '+'
						? a.int + b.int
						: op === '-'
							? a.int - b.int
							: op === '*'
								? a.int * b.int
								: Math.trunc(a.int / b.int);
				if (Math.abs(value) > CUSTOM_GLSL_INT_MAX)
					return fail(
						`this integer comes to ${value}, past ±${CUSTOM_GLSL_INT_MAX}, all a fragment shader’s integer is sure to hold (mediump)`,
					);
				return { type, height, int: value };
			}
			this.spend(arithmeticWork(op, a.type, b.type, type));
			return { type, height };
		}
		if (op === '<' || op === '>' || op === '<=' || op === '>=') {
			if ((a.type === 'int' || a.type === 'float') && b.type === a.type) {
				this.spend(1);
				return { type: 'bool', height };
			}
			return fail(
				isVec(a.type)
					? `${op} compares numbers: compare vectors with lessThan() and the like`
					: `${op} cannot compare ${article(a.type)} and ${article(b.type)}${hint(a.type, b.type)}`,
			);
		}
		if (op === '==' || op === '!=') {
			if (a.type !== b.type)
				return fail(`${op} cannot compare ${article(a.type)} and ${article(b.type)}`);
			this.spend(components(a.type));
			return { type: 'bool', height };
		}
		if (a.type === 'bool' && b.type === 'bool') {
			this.spend(1);
			return { type: 'bool', height };
		}
		return fail(`${op} takes bools, not ${article(a.type)} and ${article(b.type)}`);
	}

	private unary(): Info {
		const t = this.peek();
		if (t?.kind === 'op' && ['-', '+', '!', '++', '--'].includes(t.text)) {
			this.next();
			this.enter(t.line);
			const operand = this.unary();
			this.nest--;
			const height = operand.height + 1;
			if (operand.type === 'error') return { ...ERROR, height };
			if (t.text === '!') {
				if (operand.type !== 'bool')
					return { ...this.error(`! takes a bool, not ${article(operand.type)}`, t.line), height };
				this.spend(1);
				return { type: 'bool', height };
			}
			if (!isNumeric(operand.type))
				return {
					...this.error(`${t.text} takes a number, not ${article(operand.type)}`, t.line),
					height,
				};
			if (t.text === '++' || t.text === '--') {
				if (!this.writable(operand, t.line)) return { ...ERROR, height };
				this.spend(components(operand.type));
				return { type: operand.type, height };
			}
			if (t.text === '-' && operand.int === undefined) this.spend(components(operand.type));
			const int =
				operand.int === undefined ? undefined : t.text === '-' ? -operand.int : operand.int;
			return { type: operand.type, height, ...(int === undefined ? {} : { int }) };
		}
		return this.postfix();
	}

	private postfix(): Info {
		let info = this.primary();
		for (;;) {
			const t = this.peek();
			if (t?.text === '.') {
				this.next();
				const field = this.next();
				if (field.kind !== 'id') throw new Stop('a . is followed by components (.x, .rgb)', t.line);
				if (this.is('(')) throw new Stop(`.${field.text}(): methods are not GLSL ES 1.00`, t.line);
				info = this.swizzle(info, field.text, field.line);
				continue;
			}
			if (t?.text === '++' || t?.text === '--') {
				this.next();
				const height = info.height + 1;
				if (info.type === 'error') {
					info = { ...ERROR, height };
					continue;
				}
				if (!isNumeric(info.type)) {
					info = {
						...this.error(`${t.text} takes a number, not ${article(info.type)}`, t.line),
						height,
					};
					continue;
				}
				if (this.writable(info, t.line)) {
					this.spend(components(info.type));
					info = { type: info.type, height };
				} else info = { ...ERROR, height };
				continue;
			}
			return info;
		}
	}

	private swizzle(base: Info, field: string, line: number): Info {
		const height = base.height + 1;
		if (base.type === 'error') return { ...ERROR, height };
		if (!isVec(base.type) && !isBvec(base.type))
			return {
				...this.error(
					`.${field}: ${article(base.type)} has no components (only a vector has)`,
					line,
				),
				height,
			};
		const set = SWIZZLES.find((s) => s.includes(field[0]));
		const n = width(base.type);
		if (field.length > 4 || !set || ![...field].every((c) => set.includes(c) && set.indexOf(c) < n))
			return {
				...this.error(
					`.${field} is not ${article(base.type)}’s: up to 4 of ${SWIZZLES.map((s) => s.slice(0, n)).join(', ')}, from one set`,
					line,
				),
				height,
			};
		const type = (
			field.length === 1
				? isBvec(base.type)
					? 'bool'
					: 'float'
				: `${isBvec(base.type) ? 'bvec' : 'vec'}${field.length}`
		) as GType;
		const lv = base.lv
			? {
					name: base.lv.name,
					variable: base.lv.variable,
					repeats: base.lv.repeats || new Set(field).size !== field.length,
				}
			: undefined;
		return { type, height, ...(lv ? { lv } : {}) };
	}

	private primary(): Info {
		const t = this.next();
		if (t.kind === 'int') return { type: 'int', height: 1, int: t.value };
		if (t.kind === 'float') return { type: 'float', height: 1 };
		if (t.text === '(') {
			this.enter(t.line);
			const inner = this.expression();
			this.expect(')', 'a )');
			this.nest--;
			return {
				type: inner.type,
				height: inner.height,
				...(inner.int === undefined ? {} : { int: inner.int }),
			};
		}
		if (t.kind !== 'id') throw new Stop(`${quoted(t.text)} cannot start a value here`, t.line);
		if (t.text === 'true' || t.text === 'false') return { type: 'bool', height: 1 };
		if (this.is('(')) return this.call(t);
		const variable = this.lookup(t.text);
		if (variable)
			return { type: variable.type, height: 1, lv: { name: t.text, variable, repeats: false } };
		return this.unknown(t.text, t.line);
	}

	private call(name: Token): Info {
		const open = this.next();
		this.enter(open.line);
		const args: Info[] = [];
		if (!this.is(')')) {
			for (;;) {
				const arg = this.expression();
				args.push(arg);
				if (this.is(',')) {
					this.next();
					continue;
				}
				break;
			}
		}
		this.expect(')', 'a )');
		this.nest--;
		const height = 1 + Math.max(0, ...args.map((a) => a.height));
		const types = args.map((a) => a.type);
		const fn = name.text;
		const resolve = builtin(fn);
		const known = CONSTRUCTIBLE.has(fn) || resolve || isLibraryName(fn);
		if (!known) return { ...this.unknownCall(fn, name.line), height };
		if (types.includes('error')) return { ...ERROR, height };
		const shown = types.join(', ');
		if (CONSTRUCTIBLE.has(fn)) {
			const why = construction(fn as GType, types);
			return why
				? { ...this.error(`${fn}(${shown}): ${why}`, name.line), height }
				: { type: fn as GType, height };
		}
		if (resolve) {
			const type = resolve(types);
			if (!type) return { ...this.error(`${fn} does not take (${shown})`, name.line), height };
			this.spend(BUILTIN_COST[fn] * Math.max(...types.map(components)));
			return { type, height };
		}
		const signature = librarySignature(fn);
		if (!signature) return { ...this.error(`${fn} cannot be called from here`, name.line), height };
		if (signature.params.length !== types.length || signature.params.some((p, i) => p !== types[i]))
			return {
				...this.error(`${fn} takes (${signature.params.join(', ')}), not (${shown})`, name.line),
				height,
			};
		const cost = libraryCost(fn);
		this.spend(cost.ops, cost.reads);
		return { type: signature.returns, height };
	}

	private unknownCall(name: string, line: number): Info {
		if (KEYWORDS.has(name) && /^[iu]?vec|^[iu]?sampler|^mat\dx/.test(name))
			return this.error(`${name} is not supported here: use float, vec2–4 or mat2–4`, line);
		if (KEYWORDS.has(name)) return this.error(`${name} cannot be used here`, line);
		const variable = this.lookup(name);
		if (variable)
			return this.error(`${quoted(name)} is ${article(variable.type)}, not a function`, line);
		return this.unknown(name, line);
	}
}

/** A hint for a mismatch GLSL ES 1.00 is strict about: an int never becomes a float. */
const hint = (a: GType, b: GType): string =>
	(a === 'int' && isFloaty(b)) || (b === 'int' && isFloaty(a))
		? ' (GLSL ES 1.00 never turns an int into a float: write 2.0, or float(i))'
		: '';

/** Why `type(args…)` cannot be built, or undefined when it can. */
function construction(type: GType, args: readonly GType[]): string | undefined {
	if (!args.length) return 'it takes at least one value';
	if (isScalar(type))
		return args.length === 1 && !isMat(args[0]) ? undefined : 'it takes one number, bool or vector';
	if (args.length === 1 && isScalar(args[0])) return undefined;
	if (args.some(isMat)) return 'a matrix cannot build it here: build it from numbers or vectors';
	const need = components(type);
	const total = args.reduce((sum, t) => sum + components(t), 0);
	const before = total - components(args[args.length - 1]);
	if (total < need) return `it takes ${need} components, given ${total}`;
	if (before >= need) return `it takes ${need} components: a value is left over`;
	return undefined;
}

// -------------------------------------------------------------------------------------------------
// A NODE'S DEFINITION
// -------------------------------------------------------------------------------------------------

/** One parameter of the function a definition compiles to. */
export interface CustomGlslParam {
	port: SubgraphPort;
	/** `in` an input; `out` an output; `inout` an input and an output of one id, one value. */
	mode: 'in' | 'out' | 'inout';
}

interface Checked {
	issues: Note[];
	cost: number;
	samples: number;
	params: CustomGlslParam[];
	/** The body's lines, comments blanked and trimmed: what the function holds. */
	lines: string[];
	def?: NodeDef;
}

/** `node`'s definition as far as it reads: its code as text, its port lists as lists. */
const definitionOf = (node: GraphNode): { code: unknown; inputs: unknown; outputs: unknown } =>
	isRecord(node) && isRecord(node.glsl)
		? { code: node.glsl.code, inputs: node.glsl.inputs, outputs: node.glsl.outputs }
		: { code: undefined, inputs: undefined, outputs: undefined };

/** The parameters of a definition's function, its ports read as `portsOf` reads them. */
function paramsOf(inputs: unknown, outputs: unknown): CustomGlslParam[] {
	const ins = portsOf(inputs);
	const outs = portsOf(outputs);
	const shared = new Set(outs.map((p) => p.id));
	const own = new Set(ins.map((p) => p.id));
	return [
		...ins.map((port): CustomGlslParam => ({ port, mode: shared.has(port.id) ? 'inout' : 'in' })),
		...outs.filter((p) => !own.has(p.id)).map((port): CustomGlslParam => ({ port, mode: 'out' })),
	];
}

/** What is wrong with a definition's ports, as messages. */
function portIssues(inputs: unknown, outputs: unknown): string[] {
	const issues = [...portSideIssues('input', inputs), ...portSideIssues('output', outputs)];
	const ins = portsOf(inputs);
	const outs = portsOf(outputs);
	for (const [side, ports] of [
		['input', ins],
		['output', outs],
	] as const) {
		for (const port of ports) {
			const issue = customGlslNameIssue(port.id);
			if (issue) issues.push(`${side} ${quoted(port.id)} ${issue}`);
		}
	}
	if (Array.isArray(outputs) && !outs.length) issues.push('it needs at least one output');
	for (const out of outs) {
		const input = ins.find((p) => p.id === out.id);
		if (input && input.type !== out.type)
			issues.push(
				`input and output ${quoted(out.id)} share a name, so they are one value passed through: give them one type`,
			);
	}
	return issues;
}

/** What an issue says when the checker itself failed: a fault to fix here, never a verdict. */
export const CHECKER_FAILED = 'the checker could not read this code';

/** How many more bytes than characters `code` takes as UTF-8. */
const UTF8_EXTRA = (code: string): number => {
	let extra = 0;
	for (let i = 0; i < code.length; i++) {
		const c = code.charCodeAt(i);
		if (c >= 0xd800 && c <= 0xdbff) {
			extra += 2;
			i++;
		} else if (c >= 0x800) extra += 2;
		else if (c >= 0x80) extra += 1;
	}
	return extra;
};

/** A definition checked: never throws. */
function check(code: unknown, inputs: unknown, outputs: unknown): Checked {
	const issues: Note[] = [];
	const params = paramsOf(inputs, outputs);
	const checked: Checked = { issues, cost: 1, samples: 0, params, lines: [] };
	if (code === undefined && inputs === undefined && outputs === undefined) {
		issues.push({ level: 'error', message: 'the node has no definition: its code and ports' });
		return checked;
	}
	for (const message of portIssues(inputs, outputs)) issues.push({ level: 'error', message });
	if (typeof code !== 'string') {
		issues.push({ level: 'error', message: 'its code is not text' });
		return checked;
	}
	if (
		code.length > CUSTOM_GLSL_BYTES_MAX ||
		code.length + UTF8_EXTRA(code) > CUSTOM_GLSL_BYTES_MAX
	) {
		issues.push({
			level: 'error',
			message: `the code is longer than ${CUSTOM_GLSL_BYTES_MAX} bytes`,
		});
		return checked;
	}
	try {
		const { tokens, stripped } = lex(code);
		checked.lines = stripped
			.split('\n')
			.map((line) => line.replace(/\t/g, '    ').trimEnd())
			.filter((line) => line.trim());
		// What the GPU is given must read as the tokens checked here, one for one.
		const emitted = lex(checked.lines.join('\n')).tokens;
		if (emitted.length !== tokens.length || emitted.some((t, i) => t.text !== tokens[i].text))
			throw new Error('the emitted body does not read as the code checked');
		const ports = new Map<string, Variable>();
		for (const { port, mode } of params)
			ports.set(port.id, {
				type: port.type,
				kind: mode === 'in' ? 'input' : mode === 'out' ? 'output' : 'inout',
			});
		const checker = new Checker(
			tokens,
			ports,
			params.filter((p) => p.mode === 'out').map((p) => p.port.id),
		);
		try {
			checker.run();
		} finally {
			issues.push(...checker.notes);
			checked.cost = Math.max(1, Math.ceil(checker.work));
			checked.samples = checker.reads;
		}
	} catch (error) {
		issues.push(
			error instanceof Stop
				? { level: 'error', message: error.message, line: error.line }
				: { level: 'error', message: CHECKER_FAILED },
		);
	}
	if (checked.cost > CUSTOM_GLSL_COST_MAX)
		issues.push({
			level: 'error',
			message: `the code does about ${checked.cost} units of work a pixel, more than the ${CUSTOM_GLSL_COST_MAX} a node may`,
		});
	if (checked.samples > CUSTOM_GLSL_SAMPLES_MAX)
		issues.push({
			level: 'error',
			message: `the code reads the element ${checked.samples} times a pixel, more than the ${CUSTOM_GLSL_SAMPLES_MAX} a node may`,
		});
	if (issues.length > ISSUES_MAX)
		issues.splice(ISSUES_MAX - 1, Infinity, issues[issues.length - 1]);
	return checked;
}

const CHECKED_MAX = 512;
const checkedDefs = new Map<string, Checked>();

/** `node`'s definition checked, worked out once per definition (a stored doc's may be any size). */
function checkedOf(node: GraphNode): Checked {
	const { code, inputs, outputs } = definitionOf(node);
	if (typeof code === 'string' && code.length > CUSTOM_GLSL_BYTES_MAX)
		return check(code, inputs, outputs);
	let key: string;
	try {
		key = JSON.stringify([code ?? null, inputs ?? null, outputs ?? null]);
	} catch {
		return check(code, inputs, outputs);
	}
	let checked = checkedDefs.get(key);
	if (!checked) {
		checked = check(code, inputs, outputs);
		if (checkedDefs.size >= CHECKED_MAX) checkedDefs.clear();
		checkedDefs.set(key, checked);
	}
	return checked;
}

/**
 * What is wrong with Custom GLSL node `node`'s definition (its code and ports), each issue on the node
 * with code `glsl`, `line` and a `line N:` lead where it has a line. Pure, fast and never throws.
 */
export function customGlslIssues(node: GraphNode): GraphIssue[] {
	const id = isRecord(node) && typeof node.id === 'string' && node.id ? node.id : undefined;
	return checkedOf(node).issues.map((note) => ({
		level: note.level,
		code: 'glsl',
		message: note.line ? `line ${note.line}: ${note.message}` : note.message,
		...(id ? { node: id } : {}),
		...(note.line ? { line: note.line } : {}),
	}));
}

/** Custom GLSL node `node`'s def: its declared ports, and its cost and reads by the estimate. */
export function customGlslDef(node: GraphNode): NodeDef {
	const checked = checkedOf(node);
	if (!checked.def) {
		const { inputs, outputs } = definitionOf(node);
		checked.def = {
			type: CUSTOM_GLSL,
			label: 'Custom GLSL',
			category: 'code',
			description:
				'GLSL ES 1.00 you write: the body of a function that reads its inputs and writes its outputs by name. It may call GLSL’s functions and the efx… library (efxSample reads the element). Loops count with an int, with literal bounds.',
			inputs: portsOf(inputs).map((p) => portDef(p, true)),
			outputs: portsOf(outputs).map((p) => portDef(p, false)),
			cost: checked.cost,
			samples: checked.samples,
			emit: () => ({}),
		};
	}
	return checked.def;
}

/**
 * What node `node` compiles to, once its definition checks clean: the function's parameters in order
 * (each input, `inout` when an output shares its id, then each output of its own) and its body's
 * lines (comments out, each as written).
 */
export function customGlslFunction(node: GraphNode): {
	params: CustomGlslParam[];
	lines: string[];
} {
	const { params, lines } = checkedOf(node);
	return { params, lines };
}

/**
 * The tokens the checker reads in `code`, as text (undefined where it cannot read it): what the GPU is
 * given of a body it takes reads as these, one for one.
 */
export function customGlslTokens(code: string): string[] | undefined {
	try {
		return lex(code).tokens.map((t) => t.text);
	} catch {
		return undefined;
	}
}

/** Every node of `doc` (its graph, its subgraphs' bodies and its motion graph) of type `type`. */
function nodesOfType(doc: ShaderGraphDoc, type: string): GraphNode[] {
	if (!isRecord(doc)) return [];
	const lists: unknown[] = [doc.nodes];
	if (Array.isArray(doc.subgraphs))
		for (const sub of doc.subgraphs) if (isRecord(sub)) lists.push(sub.nodes);
	if (isRecord(doc.motionGraph)) lists.push(doc.motionGraph.nodes);
	return lists.flatMap((list) =>
		Array.isArray(list) ? list.filter((n): n is GraphNode => isRecord(n) && n.type === type) : [],
	);
}

/** Whether `doc` holds a Custom GLSL node anywhere: its graph, a subgraph's body, its motion graph. */
export function hasCustomGlsl(doc: ShaderGraphDoc): boolean {
	return nodesOfType(doc, CUSTOM_GLSL).length > 0;
}

/** A port as the signature reads it: its fields in one order, a missing one as null. */
const portKey = (port: unknown): unknown =>
	isRecord(port)
		? [port.id ?? null, port.label ?? null, port.type ?? null, port.default ?? null]
		: null;

/**
 * Every Custom GLSL definition in `doc` (its graph, its subgraphs' bodies, and any left in its motion
 * graph), each as one canonical string of its code and ports, sorted: two docs have the same list
 * exactly when they hold the same definitions as many times, wherever their nodes sit or are named.
 * The server compares a stored doc's list with an incoming one's to tell whether a save changes any
 * Custom GLSL (code, a port's id, label, type or default; a node added or removed).
 */
export function customGlslSignature(doc: ShaderGraphDoc): string[] {
	return nodesOfType(doc, CUSTOM_GLSL)
		.map((node) => {
			const { code, inputs, outputs } = definitionOf(node);
			return JSON.stringify([
				typeof code === 'string' ? code : null,
				Array.isArray(inputs) ? inputs.map(portKey) : null,
				Array.isArray(outputs) ? outputs.map(portKey) : null,
			]);
		})
		.sort();
}

/** Library functions a body may call, for an editor's help: each as GLSL declares it. */
export function customGlslLibrary(): string[] {
	return [...EFX_HEADER_FUNCTIONS, ...Object.keys(EFX_GLSL)].flatMap((name) => {
		const s = librarySignature(name);
		return s ? [`${s.returns} ${name}(${s.params.join(', ')})`] : [];
	});
}

/** The GLSL built-in functions a body may call. */
export const CUSTOM_GLSL_BUILTINS: readonly string[] = Object.keys(BUILTINS);
