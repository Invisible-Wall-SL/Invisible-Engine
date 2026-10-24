/**
 * Offline fixture for the shader graph compiler (`docs/design/invisible-shader-graph.md` step 2).
 * Run with tsx: `node_modules/.bin/tsx packages/engine-shadergraph/compile.fixture.ts` (check:all
 * runs it). Claims:
 *
 *  1. THE LIBRARY IS WELL FORMED: unique node types, unique ports per node, every node described,
 *     every input readable unwired (a default, or a default expression of a type it takes).
 *  2. EVERY NODE COMPILES ON ITS OWN, each output wired to an Output, and at each vector width when
 *     it is generic; its GLSL links: every function it calls is GLSL ES 1.00's own, a pass-header
 *     helper or a `glslLibrary` entry, no reserved word as a name. (`pnpm --filter fx-spike
 *     shader-compile` compiles the same graphs on WebGL1 and WebGL2.)
 *  3. THE FIVE REFERENCE GRAPHS COMPILE the same way every time, link and lint clean, and match
 *     their committed GLSL in `snapshots/<id>.frag`, so a codegen change shows in review as a diff.
 *     After a deliberate one, `--update` rewrites them.
 *  4. THE SMALLEST GRAPH (an Output alone) compiles to exactly the element as it is, read once;
 *     however many inputs read the element's colour there, it is read once and counted once; the
 *     Output keeps the colour premultiplied (no channel above alpha).
 *  5. THE VALIDATOR names each broken doc: version, no or two Outputs, unknown node, two nodes one
 *     id, a wire to a missing port, an input wired twice, a loop, a vector into a longer port, a
 *     wrong-length value, a bad choice, a missing param, a bad param spec (a malformed one too,
 *     without throwing); a node that reaches nothing is checked the same, then left out with a
 *     warning; and it warns on a graph too heavy for a phone, which still compiles.
 *  6. TYPES CONVERT only one way: a float spreads, a longer vector feeds a shorter port by its
 *     leading parts.
 *  7. NOTHING AN AUTHOR TYPES REACHES THE GLSL: node ids, param ids and labels are not in it; a
 *     negative literal is parenthesised, so `- -1.0` never becomes `--`; a doc id is a slug.
 *  8. A PARAM'S UNIFORM HOLDS its number, colour, 0 / 1 or choice index.
 *  9. THE EFFECT: `compileShaderEffect` packs a doc as a custom Element FX (`custom:<id>`): its
 *     spec, its graph's body and uniforms, and plain copies of its passes and motion, which
 *     register and read as a playable kind. Each bad pass (a kind that is not a single pass, a
 *     param it lacks, a bad value, a tie to a missing param or one of another kind, too many, a
 *     strength out of range) and each bad curve (an unknown channel, keys out of order or past 1, a
 *     non-number, an unknown ease, too many keys, a pivot far off) is an error.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	customElementFx,
	elementFxParamUniform,
	findElementFxSpec,
	isPlayableElementFxKind,
	readElementFxEntry,
	setCustomElementFx,
} from 'constants-shared/elementFx';
import { EFX_GLSL, linkGlsl } from 'constants-shared/glslLibrary';
import {
	CURVE_KEY_LIMIT,
	PASS_LIMIT,
	compileShaderEffect,
	compileShaderGraph,
	glslFloat,
	validateShaderGraph,
	type CompileResult,
} from './src/compile.ts';
import { DIMS, SHADER_NODES, shaderNode, type NodeDef } from './src/nodes.ts';
import { REFERENCE_GRAPHS, graphBuilder, nodeShowcase } from './src/reference.ts';
import type { GraphIssueCode, ShaderGraphDoc } from './src/types.ts';

let failures = 0;
let passes = 0;
const assert = (ok: boolean, label: string): void => {
	if (ok) {
		passes++;
		console.log(`  ✓ ${label}`);
	} else {
		failures++;
		console.log(`  ✗ ${label}`);
	}
};

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const SNAPSHOTS = join(HERE, 'snapshots');
const UPDATE = process.argv.includes('--update');
const SHADERS = readFileSync(
	join(ROOT, 'packages/pixi-svelte/src/lib/elementFx/shaders.ts'),
	'utf8',
);
/** The pass header's own helpers, read from the header itself so the two cannot drift. */
const HEADER_HELPERS = [
	...(SHADERS.split('const HEADER')[1] ?? '')
		.split('`;')[0]
		.matchAll(/^(?:vec[234]|float|bool)\s+(efx\w+)\(/gm),
].map((m) => m[1]);
/** What GLSL ES 1.00 itself offers to call: its built-in functions and its constructors. */
const ES1_CALLS = new Set([
	...['radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'pow', 'exp', 'log'],
	...['exp2', 'log2', 'sqrt', 'inversesqrt', 'abs', 'sign', 'floor', 'ceil', 'fract', 'mod'],
	...['min', 'max', 'clamp', 'mix', 'step', 'smoothstep', 'length', 'distance', 'dot', 'cross'],
	...['normalize', 'faceforward', 'reflect', 'refract', 'matrixCompMult', 'lessThan'],
	...['lessThanEqual', 'greaterThan', 'greaterThanEqual', 'equal', 'notEqual', 'any', 'all'],
	...['not', 'texture2D', 'texture2DProj', 'textureCube', 'float', 'int', 'bool', 'vec2'],
	...['vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'bvec2', 'bvec3', 'bvec4', 'mat2', 'mat3', 'mat4'],
]);
const KEYWORDS = new Set(['if', 'for', 'while', 'return']);
const RESERVED = [
	'input',
	'output',
	'filter',
	'sample',
	'common',
	'active',
	'partition',
	'half',
	'fixed',
	'long',
	'short',
	'double',
	'interface',
	'cast',
	'namespace',
	'using',
	'flat',
	'smooth',
	'layout',
	'switch',
	'case',
	'default',
];

/** Why a linked fragment would not compile on WebGL1, or [] when it would. */
const lint = (body: string): string[] => {
	const fragment = linkGlsl(body);
	const code = fragment.replace(/\/\/[^\n]*/g, '');
	const defined = new Set([
		...HEADER_HELPERS,
		...[...code.matchAll(/^(?:void|float|vec[234]|mat[234])\s+(\w+)\s*\(/gm)].map((m) => m[1]),
	]);
	const problems: string[] = [];
	for (const [, call] of code.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
		if (!defined.has(call) && !ES1_CALLS.has(call) && !KEYWORDS.has(call))
			problems.push(`calls ${call}, which neither GLSL ES 1.00 nor the fragment defines`);
	}
	for (const word of RESERVED) {
		if (new RegExp(`\\b(?:float|vec[234]|mat[234]|int|bool)\\s+${word}\\b`).test(code))
			problems.push(`names something ${word}`);
	}
	if (/--/.test(code.replace(/\/\/[^\n]*/g, ''))) problems.push('has a --');
	return [...new Set(problems)];
};

const codes = (doc: ShaderGraphDoc): GraphIssueCode[] =>
	validateShaderGraph(doc).map((i) => i.code);
const body = (result: CompileResult): string => (result.ok ? result.shader.body : '');

// -------------------------------------------------------------------------------------------------
console.log('shader graph — the node library');
{
	const types = SHADER_NODES.map((n) => n.type);
	assert(
		new Set(types).size === types.length && types.length >= 60,
		`${types.length} node types, none twice`,
	);
	const badPorts = SHADER_NODES.filter((n) => {
		const ids = [...n.inputs, ...n.outputs].map((p) => p.id);
		return (
			new Set(n.inputs.map((p) => p.id)).size !== n.inputs.length ||
			new Set(n.outputs.map((p) => p.id)).size !== n.outputs.length ||
			ids.some((id) => !/^[a-z][a-zA-Z0-9]*$/.test(id))
		);
	});
	assert(
		!badPorts.length,
		`every node's ports are distinct plain names${badPorts.length ? `: ${badPorts.map((n) => n.type).join(', ')}` : ''}`,
	);
	assert(
		SHADER_NODES.every((n) => n.label && n.description && n.cost >= 0),
		'every node has a label, a description and a cost',
	);
	const bare = SHADER_NODES.flatMap((n) =>
		n.inputs
			.filter((p) => p.default === undefined && !p.defaultExpr)
			.map((p) => `${n.type}.${p.id}`),
	);
	assert(
		!bare.length,
		`every input reads something unwired: a default or a default expression${bare.length ? `: ${bare.join(', ')}` : ''}`,
	);
	assert(
		SHADER_NODES.filter((n) => n.type === 'output').length === 1 &&
			HEADER_HELPERS.includes('efxSample') &&
			HEADER_HELPERS.length >= 8,
		`one Output; the pass header's helpers read (${HEADER_HELPERS.length})`,
	);
}

// -------------------------------------------------------------------------------------------------
console.log('shader graph — every node compiles on its own');
{
	const failed: string[] = [];
	const showcase = nodeShowcase();
	for (const doc of showcase) {
		const r = compileShaderGraph(doc);
		const problems = r.ok ? lint(r.shader.body) : r.issues.map((i) => i.message);
		if (problems.length) failed.push(`${doc.id}: ${problems.join('; ')}`);
	}
	assert(
		!failed.length && showcase.length >= 150,
		`every output of every node compiles and links (${showcase.length - failed.length})${failed.length ? `: ${failed.join(' | ')}` : ''}`,
	);
	const generic = SHADER_NODES.filter((n: NodeDef) => n.inputs.some((p) => p.type === 'any'));
	const uncovered = generic.flatMap((n) =>
		n.outputs.flatMap((o) =>
			['vec2', 'vec3', 'vec4']
				.map((w) => `${n.type}-${o.id}-${w}`)
				.filter((id) => !showcase.some((d) => d.id === id)),
		),
	);
	assert(
		generic.length >= 20 && !uncovered.length,
		`every generic node (${generic.length}) also compiles fed a vec2, a vec3 and a vec4${uncovered.length ? `: missing ${uncovered.join(', ')}` : ''}`,
	);
	const undercounted = [...showcase, ...REFERENCE_GRAPHS].filter((doc) => {
		const r = compileShaderGraph(doc);
		return r.ok && r.shader.samples < (r.shader.body.match(/efxSample\(/g) ?? []).length;
	});
	assert(
		!undercounted.length,
		`no graph reads the element more often than it reports${undercounted.length ? `: ${undercounted.map((d) => d.id).join(', ')}` : ''}`,
	);
	const solo = graphBuilder({ id: 'solo', name: 'Solo', phase: 'emphasis', durationMs: 1000 });
	solo.node('output');
	const r = compileShaderGraph(solo.doc());
	assert(
		body(r) ===
			[
				'uniform vec4 uFx;',
				'',
				'void main(void)',
				'{',
				'    vec2 px = efxPx();',
				'    vec2 uv = efxToUnit(px);',
				'    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);',
				'    vec4 pixel = efxSample(px);',
				'    vec4 outColor = clamp(pixel, 0.0, 1.0);',
				'    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);',
				'}',
				'',
			].join('\n') &&
			r.ok &&
			r.shader.samples === 1,
		'an Output alone compiles to the element as it is, read once (exact)',
	);
	const chain = graphBuilder({ id: 'chain', name: 'Chain', phase: 'emphasis', durationMs: 1000 });
	let under = chain.node('over');
	for (let i = 0; i < 24; i++) {
		const next = chain.node('over');
		chain.wire(under, 'out', next, 'bottom');
		under = next;
	}
	chain.wire(under, 'out', chain.node('output'), 'color');
	const chained = compileShaderGraph(chain.doc());
	assert(
		chained.ok &&
			chained.shader.samples === 1 &&
			(chained.shader.body.match(/efxSample\(/g) ?? []).length === 1,
		'25 nodes reading the element’s colour there read it once, and count it once',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('shader graph — the reference graphs');
{
	for (const doc of REFERENCE_GRAPHS) {
		const r = compileShaderGraph(doc);
		const again = compileShaderGraph(JSON.parse(JSON.stringify(doc)) as ShaderGraphDoc);
		const problems = r.ok ? lint(r.shader.body) : r.issues.map((i) => i.message);
		const warnings = r.ok ? r.shader.warnings.map((w) => w.message) : [];
		assert(
			r.ok && body(r) === body(again) && !problems.length && !warnings.length,
			`${doc.name}: compiles, the same every time, links and lints clean${problems.length || warnings.length ? `: ${[...problems, ...warnings].join('; ')}` : ''}${r.ok ? ` (cost ${r.shader.cost}, ${r.shader.samples} reads)` : ''}`,
		);
		const file = join(SNAPSHOTS, `${doc.id}.frag`);
		if (UPDATE && r.ok) {
			mkdirSync(SNAPSHOTS, { recursive: true });
			writeFileSync(file, body(r));
		}
		let snapshot = '';
		try {
			snapshot = readFileSync(file, 'utf8');
		} catch {
			// no snapshot yet: the check below fails and says how to write one
		}
		assert(
			r.ok && body(r) === snapshot,
			`${doc.name}: the GLSL matches snapshots/${doc.id}.frag${UPDATE ? ' (rewritten)' : snapshot ? '' : ' (missing: run with --update)'}`,
		);
	}
	const frost = REFERENCE_GRAPHS.find((d) => d.id === 'frost') as ShaderGraphDoc;
	const frostBody = body(compileShaderGraph(frost));
	assert(
		['efxCells(', 'efxAway(', 'efxHold(', 'efxGlint(', 'efxEdge('].every((call) =>
			frostBody.includes(call),
		) &&
			/uniform vec3 uP0;/.test(frostBody) &&
			linkGlsl(frostBody).includes(EFX_GLSL.efxCells.trim()),
		'Frost uses the same building blocks as the freeze pass, and its colour param is a vec3 uniform',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('shader graph — the validator');
{
	const base = (): ReturnType<typeof graphBuilder> =>
		graphBuilder({ id: 'v', name: 'V', phase: 'emphasis', durationMs: 1000 });
	const empty = base();
	assert(codes(empty.doc()).includes('output'), 'no Output: an error');
	const two = base();
	two.node('output');
	two.node('output');
	assert(codes(two.doc()).includes('output'), 'two Outputs: an error');
	const unknown = base();
	unknown.node('output');
	unknown.node('teleport');
	assert(codes(unknown.doc()).includes('unknown-node'), 'an unknown node type: an error');
	const dup = base();
	dup.node('output');
	const dupDoc = dup.doc();
	dupDoc.nodes.push({ ...dupDoc.nodes[0] });
	assert(codes(dupDoc).includes('duplicate-node'), 'two nodes with one id: an error');
	const version = base();
	version.node('output');
	assert(
		codes({ ...version.doc(), version: 2 as 1 }).includes('version') &&
			validateShaderGraph({ ...version.doc(), version: '1' as unknown as 1 }).some(
				(i) => i.code === 'version' && i.message.includes('"1"'),
			),
		'another version: an error (a "1" in quotes says so)',
	);
	const missingPort = base();
	const a = missingPort.node('number');
	const o = missingPort.node('output');
	missingPort.wire(a, 'nope', o, 'color');
	assert(codes(missingPort.doc()).includes('wire'), 'a wire from a port the node lacks: an error');
	const twice = base();
	const n1 = twice.node('number');
	const n2 = twice.node('number');
	const o2 = twice.node('output');
	twice.wire(n1, 'out', o2, 'color');
	twice.wire(n2, 'out', o2, 'color');
	assert(codes(twice.doc()).includes('wired-twice'), 'one input wired twice: an error');
	const loop = base();
	const l1 = loop.node('add');
	const l2 = loop.node('add');
	const lo = loop.node('output');
	loop.wire(l1, 'out', l2, 'a');
	loop.wire(l2, 'out', l1, 'a');
	loop.wire(l2, 'out', lo, 'color');
	assert(codes(loop.doc()).includes('cycle'), 'a loop of wires: an error');
	const widen = base();
	const uv = widen.node('uv');
	const join = widen.node('premultiply');
	const wo = widen.node('output');
	widen.wire(uv, 'out', join, 'rgb');
	widen.wire(join, 'out', wo, 'color');
	assert(codes(widen.doc()).includes('type'), 'a vec2 into a vec3 port: an error (Combine it)');
	const value = base();
	const off = value.node('offset', { by: [1, 2, 3] });
	const vo = value.node('output');
	const len = value.node('length');
	value.wire(off, 'out', len, 'v');
	value.wire(len, 'out', vo, 'color');
	assert(codes(value.doc()).includes('value'), 'three numbers into a vec2 input: an error');
	const choice = base();
	const away = choice.node('away', { side: 'sideways' });
	const co = choice.node('output');
	choice.wire(away, 'out', co, 'color');
	assert(
		codes(choice.doc()).includes('setting'),
		'a choice that is not one of its options: an error',
	);
	const noParam = base();
	const p = noParam.node('param', { param: 'ghost' });
	const po = noParam.node('output');
	noParam.wire(p, 'out', po, 'color');
	assert(
		codes(noParam.doc()).includes('setting'),
		'a Param node naming a param the effect lacks: an error',
	);
	const badParam = graphBuilder({
		id: 'v',
		name: 'V',
		phase: 'emphasis',
		durationMs: 1000,
		params: [{ id: 'x', label: 'X', kind: 'number', default: 5, min: 0, max: 1 }],
	});
	badParam.node('output');
	assert(
		codes(badParam.doc()).includes('param'),
		'a param whose default is outside its range: an error',
	);
	const broken = (params: unknown): GraphIssueCode[] => {
		const g = base();
		g.node('output');
		try {
			return codes({ ...g.doc(), params: params as ShaderGraphDoc['params'] });
		} catch {
			return ['doc', 'doc'];
		}
	};
	assert(
		broken([null]).join() === 'param' &&
			broken([7, { id: 'x' }]).join() === 'param,param' &&
			broken([{ id: 'k', label: 'K', kind: 'choice', default: 1, options: [1, 2] }]).join() ===
				'param',
		'a malformed param list (a null, a number, a choice of numbers): errors, never a throw',
	);
	const strayType = base();
	strayType.node('output');
	strayType.wire(strayType.node('uv'), 'out', strayType.node('premultiply'), 'rgb');
	const strayLoop = base();
	strayLoop.node('output');
	const self = strayLoop.node('add');
	strayLoop.wire(self, 'out', self, 'a');
	assert(
		codes(strayType.doc()).includes('type') && codes(strayLoop.doc()).includes('cycle'),
		'a node that reaches nothing is still checked: its wrong wire and its loop are errors',
	);
	const stray = base();
	stray.node('output');
	stray.node('noise');
	const strayIssues = validateShaderGraph(stray.doc());
	assert(
		strayIssues.length === 1 &&
			strayIssues[0].level === 'warning' &&
			strayIssues[0].code === 'unreachable' &&
			compileShaderGraph(stray.doc()).ok,
		'a node that reaches nothing: a warning, and it compiles without it',
	);
	const heavy = base();
	let last = heavy.node('fbm');
	for (let i = 0; i < 5; i++) {
		const next = heavy.node('fbm');
		const sum = heavy.node('add');
		heavy.wire(last, 'out', sum, 'a');
		heavy.wire(next, 'out', sum, 'b');
		last = sum;
	}
	const ho = heavy.node('output');
	heavy.wire(last, 'out', ho, 'color');
	const heavyResult = compileShaderGraph(heavy.doc());
	assert(
		heavyResult.ok && heavyResult.shader.warnings.some((w) => w.code === 'cost'),
		'a graph too heavy for a phone: a warning, and it still compiles',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('shader graph — types and literals');
{
	const g = graphBuilder({ id: 't', name: 'T', phase: 'emphasis', durationMs: 1000 });
	const n = g.node('number', { value: -0.5 });
	const neg = g.node('negate');
	const tint = g.node('colorize');
	const sample = g.node('sample');
	const offset = g.node('offset');
	const join = g.node('premultiply');
	const out = g.node('output');
	g.wire(n, 'out', neg, 'x');
	g.wire(neg, 'out', tint, 'tint');
	g.wire(sample, 'out', offset, 'by');
	g.wire(tint, 'out', join, 'rgb');
	g.wire(join, 'out', out, 'color');
	const code = body(compileShaderGraph(g.doc()));
	assert(/vec3\(n\d+_out\)/.test(code), 'a float into a vec3 port spreads over it');
	const truncated = graphBuilder({ id: 't2', name: 'T2', phase: 'emphasis', durationMs: 1000 });
	const s2 = truncated.node('sample');
	const o2 = truncated.node('offset');
	const l2 = truncated.node('length');
	const out2 = truncated.node('output');
	truncated.wire(s2, 'out', o2, 'by');
	truncated.wire(o2, 'out', l2, 'v');
	truncated.wire(l2, 'out', out2, 'color');
	assert(
		/\(n\d+_out\)\.xy/.test(body(compileShaderGraph(truncated.doc()))),
		'a vec4 into a vec2 port gives its leading parts',
	);
	assert(
		code.includes('(-0.5)') &&
			!/--/.test(code) &&
			glslFloat(2) === '2.0' &&
			glslFloat(-3) === '(-3.0)' &&
			glslFloat(Number.NaN) === '0.0',
		'a negative literal is parenthesised; whole numbers get a point; NaN reads 0',
	);
	assert(
		DIMS.vec4 === 4 && shaderNode('add')?.outputs[0].type === 'any',
		'Add is generic over floats and vectors',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('shader graph — nothing typed reaches the GLSL');
{
	const evil = '"); discard; // gl_FragColor';
	const doc: ShaderGraphDoc = {
		version: 1,
		id: 'evil',
		name: evil,
		phase: 'emphasis',
		durationMs: 1000,
		params: [{ id: evil, label: evil, kind: 'number', default: 0.5, min: 0, max: 1 }],
		nodes: [
			{ id: evil, type: 'param', x: 0, y: 0, values: { param: evil } },
			{ id: `${evil}2`, type: 'output', x: 0, y: 0 },
		],
		wires: [{ from: { node: evil, port: 'out' }, to: { node: `${evil}2`, port: 'color' } }],
	};
	const r = compileShaderGraph(doc);
	assert(
		r.ok &&
			!body(r).includes('discard') &&
			!body(r).includes('gl_FragColor') &&
			body(r).includes('uniform float uP0;'),
		'ids and labels never reach the GLSL: names are made (uP0, n0_out)',
	);
	const badIds = [evil, 'a.b', '', '-lead', 'x'.repeat(65)].map((id) =>
		validateShaderGraph({ ...doc, id }).some((i) => i.code === 'doc' && i.message.includes('slug')),
	);
	assert(
		badIds.every(Boolean) && !compileShaderEffect({ ...doc, id: evil }).ok,
		'a doc id that is not a slug (it names the kind custom:<id>) is an error',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('shader graph — param uniforms');
{
	const near = (a: number[], b: number[]): boolean =>
		a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
	assert(
		near(
			elementFxParamUniform(
				{ id: 'n', label: 'N', kind: 'number', default: 1, min: 0, max: 2 },
				1.5,
			),
			[1.5],
		) &&
			near(
				elementFxParamUniform(
					{ id: 'c', label: 'C', kind: 'color', default: '#000000' },
					'#ff8000',
				),
				[1, 128 / 255, 0],
			) &&
			near(
				elementFxParamUniform({ id: 'b', label: 'B', kind: 'bool', default: false }, true),
				[1],
			) &&
			near(
				elementFxParamUniform(
					{ id: 'k', label: 'K', kind: 'choice', default: 'a', options: ['a', 'b', 'c'] },
					'c',
				),
				[2],
			) &&
			near(
				elementFxParamUniform(
					{ id: 'k', label: 'K', kind: 'choice', default: 'b', options: ['a', 'b'] },
					'zzz',
				),
				[1],
			),
		'a param uniform holds its number, colour, 0 / 1 or choice index (an unknown choice reads its default)',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('shader graph — the effect (a custom Element FX)');
{
	const powerUp = REFERENCE_GRAPHS.find((d) => d.id === 'powerUp') as ShaderGraphDoc;
	const r = compileShaderEffect(powerUp);
	const effect = r.ok ? r.effect : undefined;
	const graph = compileShaderGraph(powerUp);
	assert(
		!!effect &&
			effect.spec.kind === 'custom:powerUp' &&
			effect.spec.category === 'custom' &&
			effect.spec.label === 'Power-up' &&
			effect.spec.phase === 'emphasis' &&
			effect.spec.durationMs === 900 &&
			effect.spec.description.length > 0 &&
			graph.ok &&
			effect.shader.body === graph.shader.body &&
			JSON.stringify(effect.shader.uniforms) === JSON.stringify(graph.shader.uniforms),
		'Power-up packs as custom:powerUp: its spec, its graph’s body and uniforms',
	);
	assert(
		!!effect &&
			JSON.stringify(effect.passes) === JSON.stringify(powerUp.passes) &&
			effect.passes !== powerUp.passes &&
			JSON.stringify(effect.motion) === JSON.stringify(powerUp.motion) &&
			effect.motion !== powerUp.motion &&
			JSON.stringify(JSON.parse(JSON.stringify(effect))) === JSON.stringify(effect),
		'its passes and motion are plain copies, and the whole effect survives JSON (it ships as data)',
	);
	const all = REFERENCE_GRAPHS.map((doc) => compileShaderEffect(doc));
	setCustomElementFx(all.flatMap((x) => (x.ok ? [x.effect] : [])));
	assert(
		all.every((x) => x.ok) &&
			REFERENCE_GRAPHS.every(
				(doc) =>
					isPlayableElementFxKind(`custom:${doc.id}`) &&
					findElementFxSpec(`custom:${doc.id}`)?.phase === doc.phase &&
					customElementFx(`custom:${doc.id}`)?.spec.label === doc.name,
			),
		'every reference graph registers and reads as a playable kind with its own spec',
	);
	const read = readElementFxEntry({
		id: 'e',
		kind: 'custom:powerUp',
		trigger: 'cue',
		cue: 'go',
		params: { color: '#00ff00', stray: 3 },
	});
	assert(
		read?.kind === 'custom:powerUp' &&
			JSON.stringify(read.params) === JSON.stringify({ color: '#00ff00' }),
		'an entry naming it reads its params against its spec',
	);
	setCustomElementFx([]);

	const base = (extra: Partial<ShaderGraphDoc>): ShaderGraphDoc => ({ ...powerUp, ...extra });
	const passCode = (passes: unknown): boolean =>
		validateShaderGraph(base({ passes: passes as ShaderGraphDoc['passes'] })).some(
			(i) => i.code === 'pass',
		);
	assert(
		passCode([{ kind: 'crash' }]) &&
			passCode([{ kind: 'shake' }]) &&
			passCode([{ kind: 'glow', params: { nope: 1 } }]) &&
			passCode([{ kind: 'glow', params: { color: '#zzz' } }]) &&
			passCode([{ kind: 'glow', params: { color: { param: 'missing' } } }]) &&
			passCode([{ kind: 'blur', params: { amount: { param: 'color' } } }]) &&
			passCode(Array.from({ length: PASS_LIMIT + 1 }, () => ({ kind: 'glow' }))) &&
			passCode([{ kind: 'glow', intensity: 9 }]) &&
			passCode('glow') &&
			!passCode([{ kind: 'outline', params: { color: { param: 'color' } }, intensity: 0.5 }]),
		'each bad pass is an error: not a single-pass kind, a param it lacks, a bad value, a tie to a missing or mismatched param, too many, too strong',
	);
	const motionCode = (motion: unknown): boolean =>
		validateShaderGraph(base({ motion: motion as ShaderGraphDoc['motion'] })).some(
			(i) => i.code === 'motion',
		);
	const keys = (n: number) => Array.from({ length: n }, (_, i) => ({ t: i / n, v: 0 }));
	assert(
		motionCode({ channels: { z: [{ t: 0, v: 1 }] } }) &&
			motionCode({
				channels: {
					x: [
						{ t: 0.5, v: 0 },
						{ t: 0.2, v: 1 },
					],
				},
			}) &&
			motionCode({ channels: { x: [{ t: 1.5, v: 0 }] } }) &&
			motionCode({ channels: { x: [{ t: 0, v: Number.NaN }] } }) &&
			motionCode({ channels: { x: [{ t: 0, v: 0, ease: 'bounce' }] } }) &&
			motionCode({ channels: { x: keys(CURVE_KEY_LIMIT + 1) } }) &&
			motionCode({ channels: { x: [] } }) &&
			motionCode({ channels: {}, pivot: { x: 5, y: 0 } }) &&
			motionCode({}) &&
			!motionCode({ channels: { rotation: keys(CURVE_KEY_LIMIT) }, pivot: { x: 0, y: 1 } }),
		'each bad curve is an error: an unknown channel, keys out of order or past 1, not a number, an unknown ease, too many or none, a pivot far off',
	);
	const docCode = (extra: Partial<ShaderGraphDoc>): boolean =>
		validateShaderGraph(base(extra)).some((i) => i.code === 'doc');
	assert(
		docCode({ name: ' ' }) &&
			docCode({ durationMs: 10 }) &&
			docCode({ durationMs: 60_000 }) &&
			docCode({ description: 3 as unknown as string }) &&
			!docCode({}),
		'the effect needs a name, a length the runtime plays (50 ms…20 s) and text for a description',
	);
	assert(effect?.padding === 0, 'no padding unless the doc asks for room');
}

console.log(
	failures
		? `\nshader graph: ${failures} check(s) FAILED`
		: `\nshader graph: all ${passes} checks passed`,
);
if (failures) process.exit(1);
