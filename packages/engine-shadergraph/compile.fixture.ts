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
 *     non-number, a value out of its channel's range, an unknown ease, too many keys, a pivot far
 *     off) is an error; so is a length that is not a number the runtime plays, or padding past 2.
 * 10. THE TWINS OF THE BUILT-INS (`BUILTIN_TWINS`, step 6): each compiles with no error, links and
 *     lints clean, within the phone's budget but for those named heavy (petrify, as heavy as its
 *     built-in), each no heavier than named; its id is its kind and it is named as the kind is; its
 *     params deep-equal the kind's catalog params; its phase and length are the kind's; no kind has
 *     two; every pass kind has one, and a pass twin is the element as it is, then that pass with
 *     each param tied by id.
 *     A node twin of a material built-in calls every library entry its built-in pass calls. The
 *     node twins' GLSL matches `snapshots/twins/<kind>.frag`. The per-element seed: a graph reading
 *     the Seed node gets `uSeed` (source `seed`), which the registry takes as a float only; a graph
 *     that does not, none. The Output's Blend Add keeps a colour above its alpha.
 *     (`pnpm --filter fx-spike shader-twins` holds each twin's pixels to its built-in's.)
 * 11. SUBGRAPHS (step 7) are inlined before anything is checked: a graph with part of it a subgraph
 *     compiles to the same shader (its port pass-throughs read through), once or called twice, nested
 *     too, its cost the inlined nodes'; an unwired call input reads the call's value, else the port's
 *     default, else 0. A graph without calls flattens to itself and compiles and analyses exactly as
 *     before (with the snapshots above unchanged, the backward-compatibility gate). Each broken call
 *     is an error named on the call: no such subgraph, none named, two of one id, one calling itself
 *     (directly or through another), nesting past 4, a body without its one Input and Output or with
 *     the effect's Output, a malformed port, a wire to a port it lacks, calls multiplying past the
 *     inlined-node cap. What is wrong inside a call is said about the call; a body analysed on its own
 *     says it about its own nodes. Storage keeps subgraphs; the shipped effect is flat.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	customElementFx,
	elementFxParamUniform,
	elementFxSpec,
	findElementFxSpec,
	isElementFxKind,
	isPlayableElementFxKind,
	readCustomElementFx,
	readElementFxEntry,
	setCustomElementFx,
	CUSTOM_ELEMENT_FX_PASS_LIMIT as PASS_LIMIT,
	ELEMENT_FX_CURVE_KEY_LIMIT as CURVE_KEY_LIMIT,
	ELEMENT_FX_PASS_KINDS,
} from 'constants-shared/elementFx';
import { EFX_GLSL, linkGlsl } from 'constants-shared/glslLibrary';
import {
	SAMPLE_BUDGET,
	analyzeShaderGraph,
	analyzeShaderSubgraph,
	compileShaderEffect,
	compileShaderGraph,
	glslFloat,
	validateShaderGraph,
	type CompileResult,
} from './src/compile.ts';
import { normalizeShaderGraphDoc } from './src/doc.ts';
import { DIMS, SHADER_NODES, shaderNode, type NodeDef } from './src/nodes.ts';
import { REFERENCE_GRAPHS, graphBuilder, nodeShowcase } from './src/reference.ts';
import { SUBGRAPH_FLAT_NODES_MAX, flattenShaderGraph } from './src/subgraph.ts';
import { BUILTIN_TWINS, builtinTwin } from './src/twins.ts';
import { MATERIAL_TWINS } from './src/twins/material.ts';
import type {
	GraphIssue,
	GraphIssueCode,
	GraphNode,
	GraphWire,
	PortType,
	ShaderGraphDoc,
	ShaderSubgraph,
	SubgraphPort,
} from './src/types.ts';

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
			broken([7, { id: 'x', label: 'X' }]).join() === 'param,param' &&
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
			!passCode([{ kind: 'outline', params: { color: { param: 'color' } }, intensity: 0.5 }]) &&
			!passCode([{ kind: 'glow', params: { color: '#FFD166' } }]),
		'each bad pass is an error: not a single-pass kind, a param it lacks, a bad value, a tie to a missing or mismatched param, too many, too strong (an upper-case colour is fine)',
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
			motionCode({ channels: { alpha: [{ t: 0, v: 1.6 }] } }) &&
			motionCode({ channels: { scale: [{ t: 0, v: -0.5 }] } }) &&
			motionCode({ channels: { rotation: [{ t: 0, v: 7200 }] } }) &&
			!motionCode({ channels: { rotation: keys(CURVE_KEY_LIMIT) }, pivot: { x: 0, y: 1 } }),
		'each bad curve is an error: an unknown channel, keys out of order or past 1, not a number, out of its channel’s range (alpha 0…1, scale ≥ 0), an unknown ease, too many or none, a pivot far off',
	);
	const docCode = (extra: Partial<ShaderGraphDoc>): boolean =>
		validateShaderGraph(base(extra)).some((i) => i.code === 'doc');
	assert(
		docCode({ name: ' ' }) &&
			docCode({ durationMs: 10 }) &&
			docCode({ durationMs: 60_000 }) &&
			docCode({ durationMs: '900' as unknown as number }) &&
			docCode({ durationMs: [900] as unknown as number }) &&
			docCode({ padding: 3 }) &&
			docCode({ padding: '1' as unknown as number }) &&
			!docCode({ padding: 0.5 }) &&
			docCode({ description: 3 as unknown as string }) &&
			!docCode({}),
		'the effect needs a name, a length the runtime plays (a number, 50 ms…20 s), padding of 0…2 and text for a description',
	);
	assert(effect?.padding === 0, 'no padding unless the doc asks for room');
}

// -------------------------------------------------------------------------------------------------
console.log('shader graph — the twins of the built-ins');
{
	// The twins over the phone budget, each as heavy as its built-in, and the most it may cost: a
	// twin that grows heavier, or another that crosses the budget, fails.
	const HEAVY: Record<string, number> = { petrify: 435 };
	const failedTwins: string[] = [];
	const lighter: string[] = [];
	for (const twin of BUILTIN_TWINS) {
		const r = compileShaderEffect(twin.doc);
		const graph = compileShaderGraph(twin.doc);
		const allowed = HEAVY[twin.kind];
		// Only the work is excused, never the reads of the element.
		const excused =
			graph.ok &&
			allowed !== undefined &&
			graph.shader.cost <= allowed &&
			graph.shader.samples <= SAMPLE_BUDGET;
		const problems = r.ok
			? [
					...lint(r.effect.shader.body),
					...r.warnings.filter((w) => w.code !== 'cost' || !excused).map((w) => w.message),
				]
			: r.issues.filter((i) => i.level === 'error').map((i) => i.message);
		if (problems.length) failedTwins.push(`${twin.kind}: ${problems.join('; ')}`);
		if (allowed !== undefined && r.ok && !r.warnings.some((w) => w.code === 'cost'))
			lighter.push(twin.kind);
	}
	const heavy = Object.entries(HEAVY)
		.map(([kind, cost]) => `${kind} (at most ${cost})`)
		.join(', ');
	assert(
		BUILTIN_TWINS.length > 0 && !failedTwins.length && !lighter.length,
		`every twin (${BUILTIN_TWINS.length}) compiles with no error, links and lints clean; only ${heavy} is over the phone's budget${failedTwins.length ? `: ${failedTwins.join(' | ')}` : ''}${lighter.length ? `; no longer heavy, take off HEAVY: ${lighter.join(', ')}` : ''}`,
	);
	const misnamed = BUILTIN_TWINS.filter(
		(t) =>
			!isElementFxKind(t.kind) ||
			t.doc.id !== t.kind ||
			t.doc.name !== elementFxSpec(t.kind).label ||
			!t.doc.description,
	);
	assert(
		!misnamed.length,
		`each twin's id is its kind, its name the kind's label, and it has a description${misnamed.length ? `: ${misnamed.map((t) => t.kind).join(', ')}` : ''}`,
	);
	const unlike = BUILTIN_TWINS.filter((t) => {
		const spec = elementFxSpec(t.kind);
		return (
			JSON.stringify(t.doc.params) !== JSON.stringify(spec.params) ||
			t.doc.phase !== spec.phase ||
			t.doc.durationMs !== spec.durationMs
		);
	});
	assert(
		!unlike.length,
		`each twin's params deep-equal its kind's catalog params (ids, kinds, defaults, ranges, options), its phase and length are the kind's${unlike.length ? `: ${unlike.map((t) => t.kind).join(', ')}` : ''}`,
	);
	const kinds = BUILTIN_TWINS.map((t) => t.kind);
	assert(
		new Set(kinds).size === kinds.length && kinds.every((k) => builtinTwin(k)?.kind === k),
		'no kind has two twins, and builtinTwin finds each',
	);
	const identity = compileShaderGraph(
		(() => {
			const solo = graphBuilder({ id: 'solo', name: 'Solo', phase: 'emphasis', durationMs: 1000 });
			solo.node('output');
			return solo.doc();
		})(),
	);
	const badPasses = ELEMENT_FX_PASS_KINDS.filter((kind) => {
		const twin = builtinTwin(kind);
		if (!twin) return true;
		if (twin.doc.nodes.length > 1) return false;
		const tied = Object.fromEntries(elementFxSpec(kind).params.map((p) => [p.id, { param: p.id }]));
		return (
			body(compileShaderGraph(twin.doc)) !== body(identity) ||
			JSON.stringify(twin.doc.passes) !== JSON.stringify([{ kind, params: tied }])
		);
	});
	assert(
		!badPasses.length,
		`every pass kind has a twin; a pass twin is the element as it is, then that pass with each param tied by id${badPasses.length ? `: ${badPasses.join(', ')}` : ''}`,
	);

	// A material twin calls every building block its built-in pass does (the point of steps 1–2).
	const PASS_OF: Record<string, string> = {
		shine: 'shineFilter',
		flash: 'colorMixFilter',
		dissolveOut: 'dissolveFilter',
		dissolveIn: 'dissolveFilter',
		melt: 'meltFilter',
		freeze: 'freezeFilter',
		burn: 'burnFilter',
		poison: 'poisonFilter',
		electrocute: 'electrocuteFilter',
		petrify: 'petrifyFilter',
		turnToGold: 'goldFilter',
	};
	const library = (glsl: string): string[] => {
		const linked = linkGlsl(glsl);
		return Object.keys(EFX_GLSL).filter((name) => new RegExp(`\\b${name}\\(`).test(linked));
	};
	const missing = MATERIAL_TWINS.flatMap((twin) => {
		const pass = PASS_OF[twin.kind];
		const source = pass && SHADERS.split(`export const ${pass} = `)[1]?.split('`')[1];
		if (!source) return [`${twin.kind}: no built-in pass found`];
		const ours = library(body(compileShaderGraph(twin.doc)));
		const lacks = library(source).filter((name) => !ours.includes(name));
		return lacks.length ? [`${twin.kind} lacks ${lacks.join(', ')}`] : [];
	});
	assert(
		MATERIAL_TWINS.length === Object.keys(PASS_OF).length && !missing.length,
		`each material twin (${MATERIAL_TWINS.length}) calls every library entry its built-in pass calls${missing.length ? `: ${missing.join('; ')}` : ''}`,
	);

	const stale: string[] = [];
	const nodeTwins = BUILTIN_TWINS.filter((t) => t.doc.nodes.length > 1);
	for (const twin of nodeTwins) {
		const glsl = body(compileShaderGraph(twin.doc));
		const file = join(SNAPSHOTS, 'twins', `${twin.kind}.frag`);
		if (UPDATE && glsl) {
			mkdirSync(join(SNAPSHOTS, 'twins'), { recursive: true });
			writeFileSync(file, glsl);
		}
		let snapshot = '';
		try {
			snapshot = readFileSync(file, 'utf8');
		} catch {
			// no snapshot yet: listed below, with how to write one
		}
		if (!glsl || glsl !== snapshot) stale.push(twin.kind);
	}
	assert(
		!stale.length,
		`each node twin's GLSL (${nodeTwins.length}) matches snapshots/twins/<kind>.frag${UPDATE ? ' (rewritten)' : ''}${stale.length ? `: ${stale.join(', ')} (run with --update after a deliberate change)` : ''}`,
	);

	const seeded = graphBuilder({
		id: 'seeded',
		name: 'Seeded',
		phase: 'emphasis',
		durationMs: 1000,
	});
	const noise = seeded.node('noise');
	seeded.wire(seeded.node('seed'), 'out', noise, 'seed');
	seeded.wire(noise, 'out', seeded.node('output'), 'color');
	const withSeed = compileShaderEffect(seeded.doc());
	const seedUniform = withSeed.ok
		? withSeed.effect.shader.uniforms.find((u) => u.source.kind === 'seed')
		: undefined;
	const asVec = withSeed.ok
		? {
				...withSeed.effect,
				shader: {
					...withSeed.effect.shader,
					uniforms: withSeed.effect.shader.uniforms.map((u) =>
						u.source.kind === 'seed' ? { ...u, type: 'vec2' as const } : u,
					),
				},
			}
		: undefined;
	assert(
		seedUniform?.name === 'uSeed' &&
			seedUniform.type === 'float' &&
			withSeed.ok &&
			/uniform float uSeed;/.test(withSeed.effect.shader.body) &&
			!!readCustomElementFx(withSeed.effect) &&
			!readCustomElementFx(asVec) &&
			!body(identity).includes('uSeed') &&
			BUILTIN_TWINS.filter((t) => t.doc.nodes.some((n) => n.type === 'seed')).length >= 9,
		'a graph reading the Seed node gets uSeed (source seed), read by the registry as a float only; a graph without it has none; the twins of the seeded built-ins read it',
	);
	const add = graphBuilder({ id: 'add', name: 'Add', phase: 'emphasis', durationMs: 1000 });
	add.node('output', { blend: 'add' });
	const added = body(compileShaderGraph(add.doc()));
	assert(
		added.includes('    finalColor = clamp(pixel, 0.0, 1.0);') &&
			!added.includes('min(outColor.rgb') &&
			body(identity).includes('min(outColor.rgb, vec3(outColor.a))'),
		'the Output’s Blend Add lets a colour outshine its alpha (clamped to 0…1 only); Normal keeps it within',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('shader graph — subgraphs');
{
	/** `a.port` → `b.port`. */
	const w = (from: string, to: string): GraphWire => {
		const [fn, fp] = from.split('.');
		const [tn, tp] = to.split('.');
		return { from: { node: fn, port: fp }, to: { node: tn, port: tp } };
	};
	const n = (id: string, type: string, values?: GraphNode['values']): GraphNode => ({
		id,
		type,
		x: 0,
		y: 0,
		...(values ? { values } : {}),
	});
	const port = (id: string, type: PortType, more: Partial<SubgraphPort> = {}): SubgraphPort => ({
		id,
		label: id,
		type,
		...more,
	});
	/** GLSL with its `T a = b;` aliases read through and every generated name renumbered in order. */
	const canonical = (glsl: string): string => {
		const alias = new Map<string, string>();
		const lines: string[] = [];
		for (const line of glsl.split('\n')) {
			const m = /^ {4}(?:float|vec[234]) (n\d+_\w+) = (n\d+_\w+);$/.exec(line);
			if (m) alias.set(m[1], alias.get(m[2]) ?? m[2]);
			else lines.push(line);
		}
		const names = new Map<string, string>();
		return lines.join('\n').replace(/\bn\d+_\w+\b/g, (name) => {
			const real = alias.get(name) ?? name;
			if (!names.has(real)) names.set(real, `v${names.size}`);
			return names.get(real) as string;
		});
	};
	const shaderNodeCost = (type: string): number => shaderNode(type)?.cost ?? NaN;
	const errorsOn = (doc: ShaderGraphDoc, node: string): GraphIssue[] =>
		validateShaderGraph(doc).filter((i) => i.level === 'error' && i.node === node);

	// Pulse tint, its tint (Param, Colorize, Mix) a subgraph called once.
	const pulse = REFERENCE_GRAPHS.find((d) => d.id === 'pulseTint') as ShaderGraphDoc;
	const pulseGlsl = body(compileShaderGraph(pulse));
	const tint: ShaderSubgraph = {
		id: 'tint',
		name: 'Tint',
		inputs: [port('rgb', 'vec3'), port('t', 'float')],
		outputs: [port('out', 'vec3')],
		nodes: [
			n('i', 'subgraphIn'),
			n('param5', 'param', { param: 'color' }),
			n('colorize6', 'colorize'),
			n('mix7', 'mix'),
			n('o', 'subgraphOut'),
		],
		wires: [
			w('i.rgb', 'colorize6.rgb'),
			w('param5.out', 'colorize6.tint'),
			w('i.rgb', 'mix7.a'),
			w('colorize6.out', 'mix7.b'),
			w('i.t', 'mix7.t'),
			w('mix7.out', 'o.out'),
		],
	};
	const outer = pulse.nodes.filter((x) => !['param5', 'colorize6', 'mix7'].includes(x.id));
	const grouped: ShaderGraphDoc = {
		...pulse,
		id: 'grouped',
		subgraphs: [tint],
		nodes: [...outer, n('call', 'subgraph', { subgraph: 'tint' })],
		wires: [
			w('time1.progress', 'bell2.t'),
			w('bell2.out', 'multiply3.a'),
			w('time1.intensity', 'multiply3.b'),
			w('unpremultiply4.rgb', 'call.rgb'),
			w('multiply3.out', 'call.t'),
			w('call.out', 'premultiply8.rgb'),
			w('unpremultiply4.alpha', 'premultiply8.alpha'),
			w('premultiply8.out', 'output9.color'),
		],
	};
	const once = compileShaderGraph(grouped);
	const flat = flattenShaderGraph(grouped);
	const reference = compileShaderGraph(pulse);
	assert(
		once.ok &&
			reference.ok &&
			canonical(body(once)) === canonical(pulseGlsl) &&
			body(once) !== pulseGlsl &&
			once.shader.cost === reference.shader.cost &&
			once.shader.samples === reference.shader.samples &&
			JSON.stringify(once.shader.uniforms) === JSON.stringify(reference.shader.uniforms) &&
			!lint(body(once)).length,
		'a call inlines: Pulse tint with its tint a subgraph compiles to the same shader (its port pass-throughs read through), cost, reads and uniforms; the Param inside reads the effect’s param',
	);
	assert(
		flat.nodes.some((x) => x.id === 'call/mix7') &&
			flat.nodes.some((x) => x.id === 'call/i.rgb') &&
			flat.nodes.some((x) => x.id === 'call/o.out') &&
			!flat.nodes.some((x) => x.type === 'subgraph' || x.type === 'subgraphIn') &&
			flat.origin.get('call/mix7')?.node === 'call' &&
			flat.origin.get('call/i.rgb')?.port === 'rgb',
		'inlined nodes are namespaced <call>/<node>, the Input and Output one pass-through per port, each traced to its call',
	);
	const plain = compileShaderGraph(pulse);
	const withEmpty = compileShaderGraph({ ...pulse, subgraphs: [] });
	const withUnused = compileShaderGraph({ ...pulse, subgraphs: [tint] });
	assert(
		flattenShaderGraph(pulse).nodes === pulse.nodes &&
			flattenShaderGraph(pulse).wires === pulse.wires &&
			JSON.stringify(withEmpty) === JSON.stringify(plain) &&
			JSON.stringify(withUnused) === JSON.stringify(plain) &&
			JSON.stringify(analyzeShaderGraph({ ...pulse, subgraphs: [tint] })) ===
				JSON.stringify(analyzeShaderGraph(pulse)),
		'a graph without calls is flattened to itself and compiles and analyses exactly as before, an unused subgraph or an empty list beside it',
	);

	// The same subgraph called twice, one input left unwired on each: its value, else the default.
	const dim: ShaderSubgraph = {
		id: 'dim',
		name: 'Dim',
		inputs: [port('color', 'vec4'), port('amount', 'float', { default: 0.5 })],
		outputs: [port('out', 'vec4')],
		nodes: [n('i', 'subgraphIn'), n('m', 'multiply'), n('o', 'subgraphOut')],
		wires: [w('i.color', 'm.a'), w('i.amount', 'm.b'), w('m.out', 'o.out')],
	};
	const twice: ShaderGraphDoc = {
		...graphBuilder({ id: 'twice', name: 'Twice', phase: 'loop', durationMs: 1000 }).doc(),
		subgraphs: [dim],
		nodes: [
			n('sample1', 'sample'),
			n('a', 'subgraph', { subgraph: 'dim' }),
			n('b', 'subgraph', { subgraph: 'dim', amount: 0.25 }),
			n('out', 'output'),
		],
		wires: [w('sample1.out', 'a.color'), w('a.out', 'b.color'), w('b.out', 'out.color')],
	};
	const two = compileShaderGraph(twice);
	assert(
		two.ok &&
			(body(two).match(/ \* vec4\(/g) ?? []).length === 2 &&
			body(two).includes('float n2_out = 0.5;') &&
			body(two).includes('float n6_out = 0.25;') &&
			two.shader.cost === 2 * shaderNodeCost('multiply') + shaderNodeCost('sample') + 1 &&
			!lint(body(two)).length,
		'a subgraph called twice is inlined twice; an unwired input reads the call’s value, else the port’s default; the cost sums both',
	);
	const zero = compileShaderGraph({
		...twice,
		subgraphs: [{ ...dim, inputs: [port('color', 'vec4'), port('amount', 'float')] }],
		nodes: twice.nodes.map((x) => (x.id === 'b' ? n('b', 'subgraph', { subgraph: 'dim' }) : x)),
	});
	assert(
		zero.ok && body(zero).includes('float n2_out = 0.0;'),
		'an unwired input with no value and no default reads 0',
	);

	// Nested: Tinted calls Tint, the effect calls Tinted, fed the element by a Sample; against Pulse
	// tint fed the same.
	const sampled: ShaderGraphDoc = {
		...pulse,
		nodes: [...pulse.nodes, n('px', 'sample')],
		wires: [...pulse.wires, w('px.out', 'unpremultiply4.color')],
	};
	const sampledGlsl = compileShaderGraph(sampled);
	const tinted: ShaderSubgraph = {
		id: 'tinted',
		name: 'Tinted',
		inputs: [port('color', 'vec4'), port('t', 'float')],
		outputs: [port('out', 'vec4')],
		nodes: [
			n('i', 'subgraphIn'),
			n('split', 'unpremultiply'),
			n('inner', 'subgraph', { subgraph: 'tint' }),
			n('join', 'premultiply'),
			n('o', 'subgraphOut'),
		],
		wires: [
			w('i.color', 'split.color'),
			w('split.rgb', 'inner.rgb'),
			w('i.t', 'inner.t'),
			w('inner.out', 'join.rgb'),
			w('split.alpha', 'join.alpha'),
			w('join.out', 'o.out'),
		],
	};
	const nested: ShaderGraphDoc = {
		...pulse,
		id: 'nested',
		subgraphs: [tint, tinted],
		nodes: [
			...pulse.nodes.filter((x) => ['time1', 'bell2', 'multiply3', 'output9'].includes(x.id)),
			n('px', 'sample'),
			n('outer', 'subgraph', { subgraph: 'tinted' }),
		],
		wires: [
			w('time1.progress', 'bell2.t'),
			w('bell2.out', 'multiply3.a'),
			w('time1.intensity', 'multiply3.b'),
			w('px.out', 'outer.color'),
			w('multiply3.out', 'outer.t'),
			w('outer.out', 'output9.color'),
		],
	};
	const deep = compileShaderGraph(nested);
	const nestedFlat = flattenShaderGraph(nested);
	assert(
		deep.ok &&
			sampledGlsl.ok &&
			canonical(body(deep)) === canonical(body(sampledGlsl)) &&
			deep.shader.cost === sampledGlsl.shader.cost &&
			deep.shader.samples === sampledGlsl.shader.samples &&
			nestedFlat.nodes.some((x) => x.id === 'outer/inner/colorize6') &&
			nestedFlat.origin.get('outer/inner/colorize6')?.node === 'outer' &&
			nestedFlat.origin.get('outer/inner/colorize6')?.path.join('>') === 'Tinted>Tint' &&
			!lint(body(deep)).length,
		'calls nest: a call in a body inlines as <call>/<call>/<node>, traced to the outer call through both names, and compiles to the shader of the same nodes unnested',
	);

	// Errors, each named on the call.
	const calling = (
		subgraphs: unknown,
		values: GraphNode['values'] = { subgraph: 'x' },
		wires: GraphWire[] = [w('c.out', 'out.color')],
	): ShaderGraphDoc => ({
		...graphBuilder({ id: 'e', name: 'E', phase: 'loop', durationMs: 1000 }).doc(),
		subgraphs: subgraphs as ShaderSubgraph[],
		nodes: [n('c', 'subgraph', values), n('out', 'output')],
		wires,
	});
	const pass = (id: string, more: Partial<ShaderSubgraph> = {}): ShaderSubgraph => ({
		id,
		name: id.toUpperCase(),
		inputs: [],
		outputs: [port('out', 'vec4')],
		nodes: [n('i', 'subgraphIn'), n('s', 'sample'), n('o', 'subgraphOut')],
		wires: [w('s.out', 'o.out')],
		...more,
	});
	const callsOf = (id: string, callee: string): ShaderSubgraph =>
		pass(id, {
			nodes: [
				n('i', 'subgraphIn'),
				n('k', 'subgraph', { subgraph: callee }),
				n('o', 'subgraphOut'),
			],
			wires: [w('k.out', 'o.out')],
		});
	const named = (doc: ShaderGraphDoc, pattern: RegExp): boolean =>
		errorsOn(doc, 'c').some((i) => i.code === 'subgraph' && pattern.test(i.message));
	const cases: [string, ShaderGraphDoc, RegExp][] = [
		['a call of a subgraph the effect lacks', calling([]), /no subgraph "x"/],
		['a call naming none', calling([pass('x')], {}), /names no subgraph/],
		['two subgraphs of one id', calling([pass('x'), pass('x')]), /two subgraphs are "x"/],
		['a subgraph calling itself', calling([callsOf('x', 'x')]), /X calls itself/],
		[
			'a subgraph calling itself through another',
			calling([callsOf('x', 'y'), callsOf('y', 'x')]),
			/X calls itself through Y/,
		],
		[
			'calls nested deeper than 4',
			calling([
				callsOf('x', 'a'),
				callsOf('a', 'b'),
				callsOf('b', 'c'),
				callsOf('c', 'd'),
				pass('d'),
			]),
			/nest deeper than 4/,
		],
		[
			'a body without its Input',
			calling([pass('x', { nodes: [n('s', 'sample'), n('o', 'subgraphOut')] })]),
			/no Input node/,
		],
		[
			'a body without its Output',
			calling([pass('x', { nodes: [n('i', 'subgraphIn'), n('s', 'sample')], wires: [] })]),
			/no Output node/,
		],
		[
			'a body with two Inputs',
			calling([
				pass('x', {
					nodes: [
						n('i', 'subgraphIn'),
						n('j', 'subgraphIn'),
						n('s', 'sample'),
						n('o', 'subgraphOut'),
					],
				}),
			]),
			/one Input node, this one has several/,
		],
		[
			'the effect’s Output in a body',
			calling([pass('x', { nodes: [...pass('x').nodes, n('fx', 'output')] })]),
			/does not belong in a subgraph/,
		],
		[
			'a port not named with a word',
			calling([pass('x', { inputs: [port('two words', 'float')] })]),
			/not named with a word/,
		],
		[
			'a port named "subgraph"',
			calling([pass('x', { inputs: [port('subgraph', 'float')] })]),
			/not named with a word/,
		],
		[
			'a port of no type',
			calling([pass('x', { inputs: [port('a', 'mat3' as PortType)] })]),
			/is a mat3/,
		],
		[
			'a default of the wrong width',
			calling([pass('x', { inputs: [port('a', 'vec3', { default: [1, 2] })] })]),
			/default is not 1 or 3 numbers/,
		],
		[
			'a wire to an output the subgraph lacks',
			calling([pass('x')], { subgraph: 'x' }, [w('c.nope', 'out.color')]),
			/has no output "nope"/,
		],
		[
			'a wire to an input the subgraph lacks',
			calling([pass('x')], { subgraph: 'x' }, [w('out.color', 'c.nope'), w('c.out', 'out.color')]),
			/has no input "nope"/,
		],
	];
	for (const [label, doc, pattern] of cases)
		assert(
			named(doc, pattern) && !compileShaderGraph(doc).ok,
			`${label}: an error named on the call, and nothing compiles`,
		);
	assert(
		validateShaderGraph(calling([pass('x')], { subgraph: 'x' }, [w('c.nope', 'out.color')])).some(
			(i) => i.node === 'c' && i.port === 'nope',
		),
		'a wire to a port the subgraph lacks names the port',
	);
	const twiceFed = validateShaderGraph(
		calling([pass('x', { inputs: [port('a', 'float', { label: 'Amount' })] })], { subgraph: 'x' }, [
			w('c.out', 'out.color'),
			w('t.progress', 'c.a'),
			w('t.seconds', 'c.a'),
		]),
	);
	assert(
		twiceFed.some(
			(i) => i.node === 'c' && i.port === 'a' && i.message === "X's Amount is wired twice",
		),
		'two wires into one input of a call: an error naming the call’s input',
	);
	const okDepth = compileShaderGraph(
		calling([callsOf('x', 'a'), callsOf('a', 'b'), callsOf('b', 'c'), pass('c')]),
	);
	assert(okDepth.ok, 'calls nested 4 deep compile');

	// What is wrong inside a call is said about the call; its ports carry their types.
	const broken = {
		...grouped,
		subgraphs: [
			{
				...tint,
				nodes: tint.nodes.map((x) =>
					x.id === 'param5' ? n('param5', 'param', { param: 'gone' }) : x,
				),
			},
		],
	};
	const inner = errorsOn(broken, 'call');
	assert(
		inner.length === 1 &&
			inner[0].code === 'setting' &&
			inner[0].message === 'Tint › "gone" is not one of the effect\'s params' &&
			!validateShaderGraph(broken).some((i) => i.node?.includes('/')),
		'an error inside a call is named on the call, led by the subgraph’s name; no inlined id leaks out',
	);
	const wrongWidth: ShaderGraphDoc = {
		...grouped,
		nodes: [...grouped.nodes, n('uv9', 'uv')],
		wires: grouped.wires.map((x) =>
			x.to.port === 'rgb' && x.to.node === 'call' ? w('uv9.out', 'call.rgb') : x,
		),
	};
	const portError = errorsOn(wrongWidth, 'call');
	assert(
		portError.length === 1 &&
			portError[0].code === 'type' &&
			portError[0].port === 'rgb' &&
			/^Tint's rgb takes a vec3, not a vec2/.test(portError[0].message),
		'a vec2 wired into a vec3 input of a call: a type error on the call’s port',
	);
	const analysis = analyzeShaderGraph(grouped);
	assert(
		JSON.stringify(analysis.inputs.call) === JSON.stringify({ rgb: 'vec3', t: 'float' }) &&
			JSON.stringify(analysis.outputs.call) === JSON.stringify({ out: 'vec3' }) &&
			Object.keys(analysis.inputs).every((id) => !id.includes('/')) &&
			analysis.cost === (reference.ok ? reference.shader.cost : -1),
		'a call’s ports have the subgraph’s types; the analysis names no inlined node; its cost is the inlined nodes’',
	);
	const unread: ShaderGraphDoc = {
		...twice,
		wires: [w('sample1.out', 'a.color'), w('sample1.out', 'out.color')],
	};
	const unreadIssues = validateShaderGraph(unread);
	assert(
		unreadIssues
			.filter((i) => i.code === 'unreachable')
			.map((i) => i.node)
			.join() === 'a,b' && validateShaderGraph(twice).every((i) => i.code !== 'unreachable'),
		'a call none of whose outputs is read is unreachable, once, on the call; nothing inside a read call is',
	);

	// A body on its own: its Input's and Output's types as declared, its own errors on its own nodes.
	const own = analyzeShaderSubgraph(grouped, 'tint');
	assert(
		!own.issues.length &&
			JSON.stringify(own.outputs.i) === JSON.stringify({ rgb: 'vec3', t: 'float' }) &&
			JSON.stringify(own.inputs.o) === JSON.stringify({ out: 'vec3' }) &&
			own.inputs.mix7?.a === 'vec3' &&
			own.cost === shaderNodeCost('colorize') + shaderNodeCost('mix'),
		'a body analysed on its own: its Input’s and Output’s ports as declared, its nodes typed, the cost of one call',
	);
	const ownBroken = analyzeShaderSubgraph(broken, 'tint');
	assert(
		ownBroken.issues.some(
			(i) => i.node === 'param5' && i.message === '"gone" is not one of the effect\'s params',
		),
		'a body’s own error is on its own node, unprefixed',
	);
	const noOut = analyzeShaderSubgraph(
		calling([pass('x', { nodes: [n('i', 'subgraphIn'), n('s', 'sample')], wires: [] })]),
		'x',
	);
	const ownNested = analyzeShaderSubgraph(calling([callsOf('x', 'x')]), 'x');
	assert(
		noOut.issues.filter((i) => i.message === 'the subgraph has no Output node').length === 1 &&
			ownNested.issues.some((i) => i.node === 'k' && /X calls itself/.test(i.message)) &&
			analyzeShaderSubgraph(calling([pass('x', { inputs: [port('a', 'float')] })]), 'x').issues
				.length === 0 &&
			analyzeShaderSubgraph(nested, 'tinted').issues.length === 0 &&
			JSON.stringify(analyzeShaderSubgraph(nested, 'tinted').outputs.inner) ===
				JSON.stringify({ out: 'vec3' }) &&
			analyzeShaderSubgraph(nested, 'ghost').issues[0]?.code === 'subgraph',
		'on its own a body says it lacks its Output once; a call in it of itself is named on that call; an input nothing reads is no fault; a call inside has its ports’ types; a subgraph the effect lacks says so',
	);

	// Hostile: calls multiplying past the cap are refused, fast.
	const fan = (id: string, callee: string | undefined): ShaderSubgraph => ({
		id,
		name: id,
		inputs: [],
		outputs: [port('out', 'float')],
		nodes: [
			n('i', 'subgraphIn'),
			n('o', 'subgraphOut'),
			...Array.from({ length: 60 }, (_, k) =>
				callee ? n(`k${k}`, 'subgraph', { subgraph: callee }) : n(`k${k}`, 'number'),
			),
		],
		wires: [w('k0.out', 'o.out')],
	});
	const started = Date.now();
	const hostile = validateShaderGraph(
		calling([fan('x', 'a'), fan('a', 'b'), fan('b', 'c'), fan('c', undefined)], { subgraph: 'x' }, [
			w('c.out', 'out.color'),
		]),
	);
	assert(
		hostile.some((i) => i.node === 'c' && /passes 2000 nodes/.test(i.message)) &&
			Date.now() - started < 2000,
		`calls multiplying past ${SUBGRAPH_FLAT_NODES_MAX} inlined nodes are refused on the call, quickly (${Date.now() - started} ms)`,
	);

	// Storage keeps subgraphs and drops what is not part of one.
	const stored = normalizeShaderGraphDoc(
		JSON.parse(
			JSON.stringify({
				...grouped,
				subgraphs: [
					...grouped.subgraphs!,
					'junk',
					{ name: 'no id' },
					{
						id: 'messy',
						inputs: [{ id: 'a', type: 'float', default: [1, 'x'] }, 'junk', { label: 'no id' }],
						outputs: 'nope',
						nodes: [{ id: 'q', type: 'number', values: { value: 2, bad: {} } }, 3],
						wires: [{ from: { node: 'q' } }],
						extra: true,
					},
				],
			}),
		),
		'grouped',
	);
	assert(
		JSON.stringify(stored.subgraphs?.[0]) === JSON.stringify(tint) &&
			stored.subgraphs?.length === 2 &&
			JSON.stringify(stored.subgraphs?.[1]) ===
				JSON.stringify({
					id: 'messy',
					name: 'messy',
					inputs: [{ id: 'a', label: 'a', type: 'float' }],
					outputs: [],
					nodes: [{ id: 'q', type: 'number', x: 0, y: 0, values: { value: 2 } }],
					wires: [],
				}) &&
			!('subgraphs' in normalizeShaderGraphDoc({ ...pulse, subgraphs: [] }, 'p')) &&
			body(compileShaderGraph(stored)) === body(once),
		'storage keeps subgraphs as written, drops what is not part of one, and an empty list',
	);

	// The effect ships flat: nothing of a subgraph reaches the runtime.
	const effect = compileShaderEffect(grouped);
	assert(
		effect.ok &&
			!JSON.stringify(effect.effect).includes('subgraph') &&
			!!readCustomElementFx(effect.effect),
		'the compiled effect is one flat pass, read by the registry as any other',
	);
}

console.log(
	failures
		? `\nshader graph: ${failures} check(s) FAILED`
		: `\nshader graph: all ${passes} checks passed`,
);
if (failures) process.exit(1);
