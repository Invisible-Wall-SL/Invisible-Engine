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
 * 12. THE MOTION GRAPH (step 8a): its nodes are the library's float nodes with a CPU form (the same
 *     ids), the element's shape and one Motion Output, every port a float, every op the library has
 *     emitted by some node. Each compiles alone to a program the registry reads; a graph compiles to
 *     the exact program expected (constants once, what drives nothing left out, an unwired output
 *     driving nothing), which runs to the values the nodes mean, a NaN never. Each broken graph is an
 *     error on its node, tagged as the motion graph's, and stops the effect compiling while the
 *     pixel analysis is untouched: an unknown, pixel-only or pixel-output node, a call, two Motion
 *     Outputs, a loop, a colour or missing param, a bad wire, a vector value, too many steps, nodes
 *     or wires. No Motion Output, or nothing wired into it, is no program. The effect carries the
 *     doc's curves and the program; the registry drops a program it cannot run (an unknown op, a
 *     forward operand, too many ops, a bad output or param) and keeps the effect. Storage keeps the
 *     motion graph clean; a doc without one (or an empty one) compiles, analyses and validates
 *     byte-identically; hostile graphs are refused in milliseconds with a bounded heap and
 *     messages; `motionGraphSeries` plots every node over a play in one pass. Nothing in the motion
 *     path throws on what storage keeps: malformed params, values and node shapes are refused.
 * 13. THE BREAK OUTPUT (step 8b): its ports are its kind's params (Shatter's unset; none for a kind
 *     that is no break, nor in a subgraph); it reaches no GLSL (the shader, cost and types are the
 *     same beside it, across the corpus) and compiles to the effect's break, which the registry
 *     reads: ties, constants (a choice by index, rounded and kept in range; a number held to its
 *     range) and its own values (a colour lower-cased, a choice by option or index), else defaults.
 *     Each broken one is one `break` error naming its port: two, a kind that is no break, a start
 *     past 0…1, the effect's phase not the kind's (saying which to set), a per-pixel wire, a
 *     constant or tie of the wrong kind (a choice: other options), a value it cannot read; an
 *     unpicked Param is its own error alone; one in a subgraph or the motion graph is refused there.
 *     What feeds only it is used and costs nothing. An exit's break adds the fade an older runtime
 *     plays (curves kept exactly before it, a driven alpha × it in steps after the graph's), an
 *     assemble none; a curve too full to take it is an error. Each break twin is the identity and
 *     its kind tied by id. Hostile ones are refused fast and bounded, and a fuzz never throws.
 * 14. THE CUSTOM GLSL NODE (step 8c): a new one passes the colour through, clean. Every sample body
 *     (`customGlsl.samples.ts`) the checker takes compiles, links and lints; every one it refuses says
 *     so on the line it names (each refusal of the subset: loops, preprocessor, declarations, names
 *     out of reach, samplers, integer ÷ 0, an integer or a loop counter past ±1023 (mediump), size,
 *     outputs unwritten, the caps), and so does every malformed port. A fuzz of token soups and
 *     broken bodies never throws, never trips the checker itself, stays fast, and compiles exactly
 *     what it takes; random bodies from a grammar are all taken; every body taken is given to the GPU
 *     as the very tokens checked (a lone carriage return ends a line). The GLSL: one function per definition before `main` (one shared by identical ones, none
 *     for a node that reaches nothing), its inputs passed in, an input and output of one id `inout`,
 *     each output starting at its default; matches `snapshots/customGlsl.frag`. Ports type wires as
 *     any node's do; in a subgraph it compiles flat and its issues land on the call with their line;
 *     the motion graph refuses it. Cost is never 0, counts reads and weighs work by type (a matrix
 *     product n³); every hand-written built-in pass, as a body, checks clean but for the caps, and
 *     the node cap sits between Petrify's work and Electrocute's; an effect's Custom GLSL nodes are
 *     capped together. The registry keeps such an effect (its own functions are no unknown
 *     calls) and drops one calling a library entry it lacks; a runtime from before 8c drops it.
 *     The signature is order- and placement-free and moves with any code or port change. Storage
 *     keeps the definition clean. (`pnpm --filter fx-spike shader-compile` compiles the same bodies
 *     and random ones on WebGL1 and WebGL2.)
 * 15. THE PARTICLE SHELL AND THE PARTICLE NODE (step 8d): the node is an input of three outputs, each
 *     its header helper (white, 0 and 0 on an element), costed as the Seed; each compiles alone, and
 *     in a subgraph body as in the graph; the motion graph refuses it. The corpus compiles the same
 *     with one beside it. The shell's vertex shader takes at most 8 attributes and hands on at most 8
 *     varying rows (WebGL1's guarantees), and writes every varying the fragment reads; its header
 *     defines every header helper; every global name it declares is out of a Custom GLSL port's or
 *     local's reach. `particleShellSource` converts every compiled body the gates know (the time and
 *     seed made varyings, the params kept, the body's main wrapped, the colour rule by the body's own
 *     call, the library linked) and refuses each body it cannot convert surely; comments fool
 *     neither way. A Custom GLSL body calls the three helpers, typed. (`pnpm --filter fx-spike
 *     shader-compile` builds the same bodies through the shell on WebGL1 and WebGL2.)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	customElementFx,
	customElementFxMotionProgramIssues,
	elementFxParamUniform,
	elementFxSpec,
	findElementFxSpec,
	isElementFxKind,
	isPlayableElementFxKind,
	readCustomElementFx,
	readElementFxEntry,
	sampleElementFxCurve,
	setCustomElementFx,
	CUSTOM_ELEMENT_FX_MOTION_OP_LIMIT as OP_LIMIT,
	CUSTOM_ELEMENT_FX_MOTION_PADDING_MAX as MOTION_PADDING_MAX,
	CUSTOM_ELEMENT_FX_PASS_LIMIT as PASS_LIMIT,
	ELEMENT_FX_CURVE_KEY_LIMIT as CURVE_KEY_LIMIT,
	ELEMENT_FX_BREAK_KINDS,
	ELEMENT_FX_LIMITS,
	ELEMENT_FX_MOTION_OUTPUTS,
	ELEMENT_FX_PASS_KINDS,
	type CustomElementFx,
	type ElementFxMotionOutput,
	type ElementFxParamSpec,
} from 'constants-shared/elementFx';
import {
	EFX_GLSL,
	EFX_HEADER_FUNCTIONS,
	linkGlsl,
	unknownEfxCalls,
} from 'constants-shared/glslLibrary';
import {
	PARTICLE_ATTRIBUTES,
	PARTICLE_HEADER,
	PARTICLE_SHELL_NAMES,
	PARTICLE_VERTEX,
	particleShellSource,
} from 'constants-shared/particleShell';
import {
	MOTION_INPUTS,
	MOTION_OPS,
	runMotionProgram,
	type MotionFrame,
} from 'constants-shared/motionLibrary';
import {
	MOTION_GRAPH_NODE_LIMIT,
	MOTION_GRAPH_WIRE_LIMIT,
	SAMPLE_BUDGET,
	analyzeShaderGraph,
	analyzeShaderMotion,
	analyzeShaderSubgraph,
	compileShaderEffect,
	compileShaderGraph,
	compileShaderMotion,
	glslFloat,
	motionGraphSeries,
	validateShaderGraph,
	type CompileResult,
} from './src/compile.ts';
import {
	BREAK_AT_DEFAULT,
	BREAK_FADE_FROM,
	BREAK_KINDS,
	BREAK_KIND_DEFAULT,
	BREAK_OUTPUT,
	isBreakKind,
	readBreakValue,
} from './src/break.ts';
import {
	CHECKER_FAILED,
	CUSTOM_GLSL,
	CUSTOM_GLSL_DEFAULT,
	CUSTOM_GLSL_EFFECT_COST_MAX,
	CUSTOM_GLSL_EFFECT_SAMPLES_MAX,
	CUSTOM_GLSL_COST_MAX,
	customGlslDef,
	customGlslFunction,
	customGlslIssues,
	customGlslNameIssue,
	customGlslSignature,
	customGlslTokens,
	hasCustomGlsl,
} from './src/customGlsl.ts';
import {
	CUSTOM_GLSL_EXAMPLES,
	INVALID_GLSL,
	PARTICLE_GLSL,
	VALID_GLSL,
	customGlslChain,
	generatedGlsl,
	mutatedGlsl,
	nearMissGlsl,
	soupGlsl,
} from './customGlsl.samples.ts';
import { normalizeShaderGraphDoc } from './src/doc.ts';
import {
	DIMS,
	MOTION_NODES,
	MOTION_NODE_TYPES,
	PARAM_TYPE,
	SHADER_NODES,
	isMotionNode,
	motionNode,
	shaderNode,
	type NodeDef,
} from './src/nodes.ts';
import { REFERENCE_GRAPHS, graphBuilder, nodeShowcase } from './src/reference.ts';
import {
	SUBGRAPH_COUNT_MAX,
	SUBGRAPH_INLINED_MAX,
	SUBGRAPH_PORTS_MAX,
	flattenShaderGraph,
	graphNodeDef,
} from './src/subgraph.ts';
import { BUILTIN_TWINS, builtinTwin, isBreakTwin } from './src/twins.ts';
import { MATERIAL_TWINS } from './src/twins/material.ts';
import type {
	CustomGlslDefinition,
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
/** `glsl` with a subgraph's port pass-throughs read through and its locals renumbered in order. */
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
	// A break's twin draws the element as it is (its own check, under "the Break Output").
	const nodeTwins = BUILTIN_TWINS.filter((t) => t.doc.nodes.length > 1 && !isBreakTwin(t));
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
			/is a "mat3"/,
		],
		[
			'a port named as every object’s own (constructor)',
			calling([pass('x', { inputs: [port('constructor', 'float')] })]),
			/not named with a word/,
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

	// Hostile docs, as storage keeps them, are refused on their calls fast and in little memory: a
	// /shaders writer can save one, and the effects route, every editor page and Publish compile it.
	const MS = 500;
	const MB = 64;
	const refusedFast = (
		label: string,
		raw: unknown,
		named: (issues: GraphIssue[]) => boolean,
	): void => {
		const doc = normalizeShaderGraphDoc(raw, 'h');
		const bytes = JSON.stringify(doc).length;
		const heap = process.memoryUsage().heapUsed;
		const t0 = performance.now();
		const analysis = analyzeShaderGraph(doc);
		const compiled = compileShaderGraph(doc);
		const ms = performance.now() - t0;
		const grew = (process.memoryUsage().heapUsed - heap) / 1e6;
		const longest = Math.max(0, ...analysis.issues.map((i) => i.message.length));
		assert(
			!compiled.ok && named(analysis.issues) && ms < MS && grew < MB && longest < 400,
			`${label} (${Math.round(bytes / 1000)} KB stored): refused on its calls in ${ms.toFixed(1)} ms (under ${MS}), the heap ${grew.toFixed(1)} MB larger (under ${MB}), no message over 400 characters (${longest})`,
		);
	};
	const hostileDoc = (subgraphs: unknown[], calls: number, callee = 's'): unknown => ({
		...graphBuilder({ id: 'h', name: 'H', phase: 'loop', durationMs: 1000 }).doc(),
		subgraphs,
		nodes: [
			n('out', 'output'),
			...Array.from({ length: calls }, (_, i) => n(`c${i}`, 'subgraph', { subgraph: callee })),
		],
		wires: [w('c0.out', 'out.color')],
	});
	const onCalls = (pattern: RegExp, calls: number) => (issues: GraphIssue[]) =>
		issues.filter((i) => i.node?.startsWith('c') && pattern.test(i.message)).length >= calls;
	refusedFast(
		'2000 inputs called 500 times (the review’s 1M pass-throughs)',
		hostileDoc(
			[
				{
					...pass('s'),
					inputs: Array.from({ length: 2000 }, (_, i) => port(`a${i}`, 'float')),
					outputs: [],
					wires: [],
				},
			],
			500,
		),
		onCalls(new RegExp(`it has 2000 inputs, more than ${SUBGRAPH_PORTS_MAX}`), 500),
	);
	refusedFast(
		'1500 malformed ports called 1500 times (the review’s 285 MB of messages)',
		hostileDoc(
			[
				{
					id: 's',
					name: 's',
					inputs: Array.from({ length: 1500 }, (_, i) => port(`a${i}`, 'mat4' as PortType)),
					outputs: [],
					nodes: [],
					wires: [],
				},
			],
			1500,
		),
		onCalls(/more than 32/, 1500),
	);
	refusedFast(
		'32 inputs and 32 outputs, a malformed port each, called 1500 times: three faults shown, the rest counted',
		hostileDoc(
			[
				pass('s', {
					inputs: Array.from({ length: 32 }, (_, i) => port(`a${i}`, 'mat4' as PortType)),
					outputs: Array.from({ length: 32 }, (_, i) => port(`b${i}`, 'mat4' as PortType)),
				}),
			],
			1500,
		),
		onCalls(/; and 61 more$/, 1500),
	);
	refusedFast(
		'32 inputs and 32 outputs, well formed, called 1000 times: the first calls inline, the rest pass the budget',
		hostileDoc(
			[
				pass('s', {
					inputs: Array.from({ length: 32 }, (_, i) => port(`a${i}`, 'float')),
					outputs: [
						port('out', 'vec4'),
						...Array.from({ length: 31 }, (_, i) => port(`b${i}`, 'vec4')),
					],
				}),
			],
			1000,
		),
		onCalls(new RegExp(`passes ${SUBGRAPH_INLINED_MAX} nodes, wires and ports`), 900),
	);
	refusedFast(
		'a body of 3000 wires called 2000 times: its wires count against the budget',
		hostileDoc(
			[
				pass('s', {
					wires: [
						w('s.out', 'o.out'),
						...Array.from({ length: 3000 }, (_, i) => w('s.out', `q${i}.x`)),
					],
				}),
			],
			2000,
		),
		onCalls(/passes 4000/, 1999),
	);
	refusedFast(
		`${SUBGRAPH_COUNT_MAX + 36} subgraphs, one called 2000 times`,
		hostileDoc(
			Array.from({ length: SUBGRAPH_COUNT_MAX + 36 }, (_, i) => pass(i ? `s${i}` : 's')),
			2000,
		),
		onCalls(
			new RegExp(`has ${SUBGRAPH_COUNT_MAX + 36} subgraphs, more than ${SUBGRAPH_COUNT_MAX}`),
			2000,
		),
	);
	refusedFast(
		'20 calls naming a 10 000-letter subgraph id: the message quotes 40',
		hostileDoc([pass('s')], 20, 'z'.repeat(10_000)),
		onCalls(/no subgraph "z{40}…"$/, 20),
	);
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
	refusedFast(
		'60 calls in a body, nested 4 deep (60⁴ calls unrolled)',
		calling([fan('x', 'a'), fan('a', 'b'), fan('b', 'c'), fan('c', undefined)], { subgraph: 'x' }, [
			w('c.out', 'out.color'),
		]),
		(issues) => issues.some((i) => i.node === 'c' && /passes 4000/.test(i.message)),
	);
	const protoDoc = calling([pass('x', { inputs: [port('valueOf', 'float')] })]);
	const unwiredProto = compileShaderGraph(protoDoc);
	assert(
		!unwiredProto.ok &&
			unwiredProto.issues.some((i) => i.node === 'c' && /not named with a word/.test(i.message)) &&
			!Object.hasOwn(analyzeShaderGraph(protoDoc).inputs.c ?? {}, 'valueOf') &&
			!flattenShaderGraph(protoDoc).nodes.some((x) => typeof x.values?.in === 'function'),
		'a port named valueOf is refused, and no call reads Object’s function as its value',
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

// -------------------------------------------------------------------------------------------------
console.log('shader graph — the motion graph');
{
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
	const PARAMS: ElementFxParamSpec[] = [
		{ id: 'amp', label: 'Amp', kind: 'number', default: 0.5, min: 0, max: 2 },
		{ id: 'on', label: 'On', kind: 'bool', default: true },
		{ id: 'pick', label: 'Pick', kind: 'choice', default: 'c', options: ['a', 'b', 'c'] },
		{ id: 'tint', label: 'Tint', kind: 'color', default: '#ff0000' },
	];
	const base = graphBuilder({ id: 'moving', name: 'Moving', phase: 'emphasis', durationMs: 1000 });
	base.wire(base.node('sample'), 'out', base.node('output'), 'color');
	const pixel = base.doc();
	const moving = (nodes: GraphNode[], wires: GraphWire[], more: Partial<ShaderGraphDoc> = {}) =>
		({ ...pixel, params: PARAMS, motionGraph: { nodes, wires }, ...more }) as ShaderGraphDoc;
	const frame = (more: Partial<MotionFrame> = {}): MotionFrame => ({
		t: 0.5,
		seconds: 0.5,
		intensity: 1,
		looping: false,
		params: { amp: 0.5, on: 1, pick: 2 },
		seed: 41,
		width: 120,
		height: 60,
		...more,
	});
	const issuesOf = (doc: ShaderGraphDoc) => analyzeShaderMotion(doc).issues;

	// The library.
	const views = MOTION_NODES;
	assert(
		new Set(MOTION_NODE_TYPES).size === MOTION_NODE_TYPES.length &&
			views.every((d) => [...d.inputs, ...d.outputs].every((p) => p.type === 'float')) &&
			views.every((d) =>
				d.inputs.every((p) => !p.defaultExpr || ['progress', 'seconds'].includes(p.defaultExpr)),
			),
		`${views.length} motion nodes, none twice, every port a float, no input reading per pixel`,
	);
	const pixelOnes = views.filter((d) => !['shape', 'motionOutput'].includes(d.type));
	assert(
		pixelOnes.every(
			(d) =>
				shaderNode(d.type)?.motion &&
				shaderNode(d.type)
					?.inputs.map((p) => p.id)
					.join() === d.inputs.map((p) => p.id).join(),
		) &&
			!shaderNode('shape') &&
			!shaderNode('motionOutput') &&
			SHADER_NODES.filter((d) => d.motion).length === pixelOnes.length,
		'every motion node but the shape and the Motion Output is the pixel node of its id, its ports the same',
	);
	const named = ['time', 'param', 'number', 'seed', 'add', 'multiply', 'mix', 'clamp'];
	named.push('smoothstep', 'remap', 'bell', 'swell', 'pulse', 'oscillate', 'bounce');
	named.push('loopEnvelope', 'hash1', 'noise1', 'pick', 'hold', 'shape', 'motionOutput');
	assert(
		named.every(isMotionNode) &&
			!['uv', 'sample', 'noise', 'away', 'output', 'color', 'size', 'split'].some(isMotionNode) &&
			!isMotionNode('__proto__') &&
			!isMotionNode('toString'),
		'the time, param, number, seed, math, time-shape, oscillator and 1-D noise nodes are motion nodes; per-pixel, colour and vector ones are not',
	);
	assert(
		JSON.stringify(motionNode('motionOutput')?.inputs.map((p) => p.id)) ===
			JSON.stringify(ELEMENT_FX_MOTION_OUTPUTS) &&
			motionNode('motionOutput')?.outputs.length === 0 &&
			!!motionNode('motionOutput')?.inputs.every((p) => p.default === undefined && !p.defaultExpr),
		'the Motion Output takes x, y, scale, scale x / y, rotation, alpha and padding, none read unwired',
	);

	// Every node compiles alone into a program the registry reads; every op is some node's.
	const used = new Set<string>();
	const alone: string[] = [];
	for (const def of views) {
		if (def.type === 'motionOutput') continue;
		for (const output of def.outputs) {
			const values = def.type === 'param' ? { param: 'amp' } : undefined;
			const doc = moving(
				[n('node', def.type, values), n('out', 'motionOutput')],
				[w(`node.${output.id}`, 'out.x')],
			);
			const result = compileShaderMotion(doc);
			const program = result.ok ? result.program : undefined;
			const read = program
				? customElementFxMotionProgramIssues(program, new Map(PARAMS.map((p) => [p.id, p])))
				: ['none'];
			const value = program ? runMotionProgram(program, frame()).x : NaN;
			if (!program || read.length || !Number.isFinite(value))
				alone.push(`${def.type}.${output.id}`);
			for (const op of program?.ops ?? []) used.add(op[0]);
		}
	}
	assert(
		!alone.length,
		`every motion node output compiles alone to a program the registry reads${alone.length ? `: ${alone.join(', ')}` : ''}`,
	);
	const unused = Object.keys(MOTION_OPS).filter((op) => !used.has(op));
	assert(
		!unused.length && MOTION_INPUTS.every((input) => used.has(input)),
		`every library op and frame read is some node's${unused.length ? ` (none emits ${unused.join(', ')})` : ''}`,
	);

	// A graph compiles to the exact program: constants once, dead nodes out, unwired outputs undriven.
	const doc = moving(
		[
			n('time', 'time'),
			n('bell', 'bell'),
			n('amp', 'param', { param: 'amp' }),
			n('mul', 'multiply'),
			n('lift', 'add', { b: 0.5 }),
			n('again', 'add', { b: 0.5 }),
			n('dead', 'sin'),
			n('out', 'motionOutput', { alpha: 0.2 }),
		],
		[
			w('time.progress', 'bell.t'),
			w('bell.out', 'mul.a'),
			w('amp.out', 'mul.b'),
			w('mul.out', 'lift.a'),
			w('lift.out', 'out.y'),
			w('mul.out', 'again.a'),
			w('again.out', 'out.padding'),
			w('time.seconds', 'dead.x'),
		],
	);
	const compiled = compileShaderMotion(doc);
	const expected = {
		ops: [
			['progress'],
			['bell', 0],
			['param', 'amp'],
			['multiply', 1, 2],
			['const', 0.5],
			['add', 3, 4],
			['add', 3, 4],
		],
		outputs: { y: 5, padding: 6 },
	};
	assert(
		compiled.ok &&
			JSON.stringify(compiled.program) === JSON.stringify(expected) &&
			compiled.warnings.length === 1 &&
			compiled.warnings[0].node === 'dead' &&
			compiled.warnings[0].graph === 'motion',
		'a graph compiles to the exact program: one constant for two 0.5s, the node reaching nothing left out (and warned of), a value on an unwired Motion Output input driving nothing',
	);
	const program = compiled.ok ? compiled.program : undefined;
	const registers = new Float64Array(7);
	const ran = program ? runMotionProgram(program, frame({ t: 0.5 }), registers) : {};
	assert(
		JSON.stringify(Object.keys(ran)) === '["y","padding"]' &&
			Math.abs((ran.y ?? 0) - 1) < 1e-12 &&
			registers[3] === 0.5,
		'it runs to what the nodes mean (Bell at the middle × Amp 0.5, + 0.5), its registers filled',
	);
	const bits = (ops: unknown[], frameMore: Partial<MotionFrame> = {}) =>
		runMotionProgram({ ops: ops as never, outputs: { x: ops.length - 1 } }, frame(frameMore)).x;
	assert(
		bits([
			['const', 1],
			['const', 0],
			['divide', 0, 1],
		]) === 0 &&
			bits([['param', 'missing']]) === 0 &&
			bits([['param', 'toString']]) === 0 &&
			bits([['param', '__proto__']]) === 0 &&
			bits([['looping']], { looping: true }) === 1 &&
			bits([['width'], ['height'], ['divide', 0, 1]]) === 2 &&
			bits([
				['const', 4],
				['const', 9],
				['const', 1],
				['const', 2],
				['const', 3],
				['const', 5],
				['const', 6],
				['pick', 0, 1, 2, 3, 4, 5, 6],
			]) === 5 &&
			bits([
				['const', -1],
				['const', 2],
				['pow', 0, 1],
			]) === 0,
		'a division by 0 runs to 0, an unknown param (a prototype name too) to 0; looping, the shape, Pick and a negative Power read as their nodes do',
	);

	// Each broken graph is an error on its node, tagged, and stops the effect, not the pixel graph.
	const broken = (
		label: string,
		graph: ShaderGraphDoc,
		code: GraphIssueCode,
		node: string | undefined,
		message: RegExp,
	): void => {
		const issues = issuesOf(graph);
		const hit = issues.find(
			(i) => i.level === 'error' && i.code === code && i.message.match(message),
		);
		const effect = compileShaderEffect(graph);
		const plain = { ...graph };
		delete plain.motionGraph;
		assert(
			!!hit &&
				(node === undefined || hit.node === node) &&
				issues.every((i) => i.graph === 'motion') &&
				!effect.ok &&
				effect.issues.some((i) => i.graph === 'motion' && i.code === code) &&
				JSON.stringify(analyzeShaderGraph(graph)) === JSON.stringify(analyzeShaderGraph(plain)) &&
				compileShaderGraph(graph).ok,
			`${label}: "${hit?.message ?? '?'}" on ${hit?.node ?? 'the graph'}; the effect does not compile, the pixel graph is untouched`,
		);
	};
	const out = n('out', 'motionOutput');
	broken(
		'an unknown node',
		moving([n('q', 'nope'), out], []),
		'unknown-node',
		'q',
		/"nope" is not a node/,
	);
	broken(
		'a pixel-only node',
		moving([n('q', 'sample'), out], []),
		'unknown-node',
		'q',
		/works per pixel/,
	);
	broken(
		'the pixel Output',
		moving([n('q', 'output'), out], []),
		'unknown-node',
		'q',
		/belongs in the pixel graph/,
	);
	broken(
		'a subgraph call',
		moving([n('q', 'subgraph', { subgraph: 's' }), out], []),
		'unknown-node',
		'q',
		/cannot be called/,
	);
	broken(
		'two Motion Outputs',
		moving([out, n('out2', 'motionOutput')], []),
		'output',
		undefined,
		/one Motion Output/,
	);
	broken(
		'a loop',
		moving(
			[n('a', 'add'), n('b', 'add'), out],
			[w('a.out', 'b.a'), w('b.out', 'a.a'), w('b.out', 'out.x')],
		),
		'cycle',
		undefined,
		/loop/,
	);
	broken(
		'a colour param',
		moving([n('p', 'param', { param: 'tint' }), out], [w('p.out', 'out.x')]),
		'setting',
		'p',
		/is a colour/,
	);
	broken(
		'a missing param',
		moving([n('p', 'param', { param: 'gone' }), out], [w('p.out', 'out.x')]),
		'setting',
		'p',
		/not one of the effect's params/,
	);
	broken(
		'a wire to a port it lacks',
		moving([n('a', 'abs'), out], [w('a.out', 'out.z')]),
		'wire',
		'out',
		/no input "z"/,
	);
	broken(
		'an input wired twice',
		moving([n('a', 'abs'), n('b', 'abs'), out], [w('a.out', 'out.x'), w('b.out', 'out.x')]),
		'wired-twice',
		'out',
		/wired twice/,
	);
	broken(
		'a vector value',
		moving([n('a', 'abs', { x: [1, 2] }), out], [w('a.out', 'out.x')]),
		'value',
		'a',
		/takes a number/,
	);
	const many = Array.from({ length: 120 }, (_, i) =>
		n(`r${i}`, 'remap', { inMin: i + 0.1, inMax: i + 0.2, outMin: i + 0.3, outMax: i + 0.4 }),
	);
	broken(
		'too many steps',
		moving(
			[...many, out],
			[...many.slice(1).map((r, i) => w(`r${i}.out`, `${r.id}.x`)), w('r119.out', 'out.x')],
		),
		'cost',
		undefined,
		new RegExp(`more than the ${OP_LIMIT}`),
	);
	broken(
		`${MOTION_GRAPH_NODE_LIMIT + 1} nodes`,
		moving(
			Array.from({ length: MOTION_GRAPH_NODE_LIMIT + 1 }, (_, i) => n(`k${i}`, 'number')),
			[],
		),
		'motion',
		undefined,
		/at most 256/,
	);
	broken(
		'a motion graph that is not one',
		{ ...pixel, motionGraph: { nodes: 'x' } } as unknown as ShaderGraphDoc,
		'doc',
		undefined,
		/needs a nodes list/,
	);
	const inPixel = { ...pixel, nodes: [...pixel.nodes, n('m', 'motionOutput')] };
	assert(
		validateShaderGraph(inPixel).some(
			(i) =>
				i.code === 'unknown-node' &&
				i.node === 'm' &&
				/belongs in the motion graph/.test(i.message),
		),
		'the pixel graph refuses a motion-only node, saying where it belongs',
	);
	const noOutput = moving([n('a', 'abs')], []);
	const unwired = moving([n('a', 'abs'), out], []);
	const both = compileShaderEffect({ ...noOutput, nodes: [] });
	const effectOf = (graph: ShaderGraphDoc): string => {
		const result = compileShaderEffect(graph);
		return JSON.stringify(result.ok ? result.effect : result.issues);
	};
	assert(
		compileShaderMotion(noOutput).ok &&
			!(compileShaderMotion(noOutput) as { program?: unknown }).program &&
			issuesOf(noOutput).some((i) => i.level === 'warning' && /no Motion Output/.test(i.message)) &&
			!issuesOf(noOutput).some((i) => i.code === 'unreachable') &&
			compileShaderMotion(unwired).ok &&
			!(compileShaderMotion(unwired) as { program?: unknown }).program &&
			compileShaderEffect(unwired).ok &&
			effectOf(unwired) === effectOf({ ...unwired, motionGraph: undefined }) &&
			!both.ok &&
			both.issues.some((i) => i.code === 'output' && !i.graph),
		'no Motion Output (a warning, not one per node) or none of its inputs wired: no program, the effect as without one; a broken pixel graph still says so',
	);
	assert(
		analyzeShaderMotion(doc).cost === 2 + 1 + 1 + 1 &&
			analyzeShaderMotion(doc).ops === 7 &&
			analyzeShaderMotion(doc).types.outputs.time?.seconds === 'float' &&
			analyzeShaderMotion(moving([n('p', 'param', { param: 'tint' }), out], [])).types.outputs.p
				?.out === 'vec3',
		'the analysis gives the reachable cost, the program size and every port’s type (a colour param’s a vec3)',
	);

	// The effect carries the doc's curves and the program; the registry reads it.
	const curves = {
		channels: {
			alpha: [
				{ t: 0, v: 1 },
				{ t: 1, v: 0 },
			],
		},
		pivot: { x: 0.5, y: 1 },
	};
	const withCurves = compileShaderEffect({
		...doc,
		motion: { ...curves, program: { ops: [['const', 9]], outputs: { x: 0 } } } as never,
	});
	const bare = compileShaderEffect(doc);
	const read = withCurves.ok ? readCustomElementFx(withCurves.effect) : undefined;
	assert(
		withCurves.ok &&
			bare.ok &&
			JSON.stringify(withCurves.effect.motion) ===
				JSON.stringify({ ...curves, program: expected }) &&
			JSON.stringify(bare.effect.motion) === JSON.stringify({ channels: {}, program: expected }) &&
			JSON.stringify(read?.motion) === JSON.stringify(withCurves.effect.motion) &&
			withCurves.warnings.some((i) => i.graph === 'motion'),
		'the effect carries the doc’s curves (a program written into them is dropped) and the compiled program, which the registry keeps',
	);

	// The registry drops a program it cannot run, never the effect.
	const good = bare.ok ? bare.effect : (undefined as unknown as CustomElementFx);
	const withProgram = (programRaw: unknown): unknown => ({
		...good,
		motion: { channels: { alpha: [{ t: 0, v: 1 }] }, program: programRaw },
	});
	const badPrograms: [string, unknown][] = [
		[
			'an unknown op',
			{
				ops: [
					['const', 1],
					['fromTheFuture', 0],
				],
				outputs: { x: 1 },
			},
		],
		[
			'a forward operand',
			{
				ops: [
					['abs', 1],
					['const', 1],
				],
				outputs: { x: 0 },
			},
		],
		[
			'a wrong operand count',
			{
				ops: [
					['const', 1],
					['add', 0],
				],
				outputs: { x: 1 },
			},
		],
		[
			'a fraction operand',
			{
				ops: [
					['const', 1],
					['abs', 0.5],
				],
				outputs: { x: 1 },
			},
		],
		[
			`${OP_LIMIT + 1} ops`,
			{ ops: Array.from({ length: OP_LIMIT + 1 }, () => ['const', 1]), outputs: { x: 0 } },
		],
		['no ops', { ops: [], outputs: { x: 0 } }],
		['an unknown output', { ops: [['const', 1]], outputs: { skew: 0 } }],
		['a __proto__ output', JSON.parse('{"ops":[["const",1]],"outputs":{"__proto__":0}}')],
		['an output past the ops', { ops: [['const', 1]], outputs: { x: 1 } }],
		['no outputs', { ops: [['const', 1]], outputs: {} }],
		['a null const', { ops: [['const', null]], outputs: { x: 0 } }],
		['a colour param', { ops: [['param', 'tint']], outputs: { x: 0 } }],
		['a missing param', { ops: [['param', 'gone']], outputs: { x: 0 } }],
		['an input with an operand', { ops: [['progress', 0]], outputs: { x: 0 } }],
		['ops that are not a list', { ops: 'add', outputs: { x: 0 } }],
	];
	const kept = badPrograms.filter(([, p]) => {
		const effect = readCustomElementFx({
			...(withProgram(p) as object),
			spec: { ...good.spec, params: PARAMS },
		});
		return (
			!effect || effect.motion?.program !== undefined || effect.motion?.channels.alpha === undefined
		);
	});
	assert(
		!kept.length &&
			!!readCustomElementFx({
				...(withProgram(expected) as object),
				spec: { ...good.spec, params: PARAMS },
			})?.motion?.program,
		`the registry drops a program it cannot run and keeps the effect and its curves: ${badPrograms.map(([l]) => l).join(', ')}${kept.length ? ` (mishandled: ${kept.map(([l]) => l).join(', ')})` : ''}`,
	);

	// Storage keeps the motion graph clean; an empty one is dropped.
	const stored = normalizeShaderGraphDoc(
		JSON.parse(
			JSON.stringify({
				...doc,
				motionGraph: {
					nodes: [
						...doc.motionGraph!.nodes,
						'junk',
						{ id: 'v', type: 'abs', values: JSON.parse('{"__proto__":{"x":1},"x":2,"bad":{}}') },
					],
					wires: [...doc.motionGraph!.wires, { from: { node: 'v' } }, 3],
					extra: true,
				},
			}),
		),
		'moving',
	);
	assert(
		stored.motionGraph?.nodes.length === doc.motionGraph!.nodes.length + 1 &&
			JSON.stringify(stored.motionGraph?.nodes.at(-1)) ===
				JSON.stringify(n('v', 'abs', { x: 2 })) &&
			stored.motionGraph?.wires.length === doc.motionGraph!.wires.length &&
			!('extra' in (stored.motionGraph ?? {})) &&
			!(
				'motionGraph' in
				normalizeShaderGraphDoc({ ...pixel, motionGraph: { nodes: [], wires: [] } }, 'p')
			) &&
			!('motionGraph' in normalizeShaderGraphDoc({ ...pixel, motionGraph: 'x' }, 'p')) &&
			JSON.stringify(compileShaderMotion({ ...stored, params: PARAMS })) ===
				JSON.stringify(
					compileShaderMotion({
						...doc,
						motionGraph: {
							...doc.motionGraph!,
							nodes: [...doc.motionGraph!.nodes, n('v', 'abs', { x: 2 })],
						},
					}),
				),
		'storage keeps the motion graph as written, drops what is not part of it (a __proto__ value too) and an empty or malformed one',
	);

	// Without a motion graph, or with an empty one, nothing changes.
	const every = [...REFERENCE_GRAPHS, ...BUILTIN_TWINS.map((t) => t.doc), ...nodeShowcase()];
	const changed = every.filter((withMotion) => {
		// A twin's own motion graph aside: the doc without one, and with an empty one.
		const d = { ...withMotion };
		delete d.motionGraph;
		const empty = { ...d, motionGraph: { nodes: [], wires: [] } };
		const motion = analyzeShaderMotion(empty);
		return (
			JSON.stringify([compileShaderEffect(d), analyzeShaderGraph(d), validateShaderGraph(d)]) !==
				JSON.stringify([
					compileShaderEffect(empty),
					analyzeShaderGraph(empty),
					validateShaderGraph(empty),
				]) ||
			motion.issues.length ||
			motion.ops ||
			analyzeShaderMotion(d).issues.length
		);
	});
	assert(
		!changed.length,
		`${every.length} docs (references, twins, the node showcase) compile, analyse and validate the same with no motion graph and an empty one${changed.length ? `: not ${changed.map((d) => d.id).join(', ')}` : ''}`,
	);

	// The twins whose motion or room a curve or a fixed padding could not follow have motion graphs.
	const MOVING: Record<string, ElementFxMotionOutput[]> = {
		freeze: ['x'],
		petrify: ['y'],
		turnToGold: ['scale'],
		electrocute: ['x', 'y', 'rotation', 'padding'],
		poison: ['rotation', 'scaleX', 'scaleY'],
		bounce3D: ['scaleX', 'scaleY', 'padding'],
		melt: ['padding'],
		waveX: ['padding'],
		waveY: ['padding'],
		flag: ['padding'],
	};
	const unmoved = BUILTIN_TWINS.filter((twin) => {
		const result = compileShaderEffect(twin.doc);
		const motion = result.ok ? result.effect.motion : undefined;
		const program = motion?.program;
		const drives = Object.keys(program?.outputs ?? {})
			.sort()
			.join();
		const params = new Map(twin.doc.params.map((p) => [p.id, p]));
		return (
			drives !== [...(MOVING[twin.kind] ?? [])].sort().join() ||
			(program && customElementFxMotionProgramIssues(program, params).length) ||
			(program && !readCustomElementFx(result.ok ? result.effect : undefined)?.motion?.program) ||
			(result.ok && result.warnings.some((w) => w.graph === 'motion'))
		);
	});
	assert(
		!unmoved.length,
		`the ${Object.keys(MOVING).length} twins that move by the seconds played, a param, looping or the element's shape, or grow their room, compile with a motion program driving exactly that, which the registry reads, warning-free${unmoved.length ? `: not ${unmoved.map((t) => t.kind).join(', ')}` : ''}`,
	);
	const ROOM: Record<string, number> = {
		bounce3D: 1.1,
		waveX: 0.25,
		waveY: 0.25,
		flag: 0.25,
		melt: 1.16,
		electrocute: 0.15,
	};
	const fallback = BUILTIN_TWINS.filter((twin) => {
		const outputs = compileShaderMotion(twin.doc);
		const driven = outputs.ok ? Object.keys(outputs.program?.outputs ?? {}) : [];
		const pixelIds = new Set(twin.doc.nodes.map((node) => node.id));
		return (
			driven.some((c) => c in (twin.doc.motion?.channels ?? {})) ||
			(driven.includes('padding') && twin.doc.padding !== ROOM[twin.kind]) ||
			!!twin.doc.motionGraph?.nodes.some((node) => pixelIds.has(node.id))
		);
	});
	assert(
		!fallback.length,
		`no twin keeps a curve on a channel its motion graph drives; one whose graph drives the padding keeps its fixed padding as the room a runtime from before motion graphs gives it; no motion node shares an id with a pixel node${fallback.length ? `: ${fallback.map((t) => t.kind).join(', ')}` : ''}`,
	);
	const most = (kind: string, id: string): number => {
		const p = findElementFxSpec(kind as never)?.params.find((q) => q.id === id);
		return p?.kind === 'number' ? p.max : NaN;
	};
	assert(
		MOTION_PADDING_MAX === 1.45 * most('melt', 'length') * ELEMENT_FX_LIMITS.intensity.max &&
			MOTION_PADDING_MAX >=
				0.3 + 0.8 * most('bounce3D', 'height') * ELEMENT_FX_LIMITS.intensity.max &&
			MOTION_PADDING_MAX >= most('waveX', 'amplitude') * ELEMENT_FX_LIMITS.intensity.max &&
			issuesOf(
				moving(
					[n('k', 'number', { value: MOTION_PADDING_MAX + 1 }), out],
					[w('k.out', 'out.padding')],
				),
			).some((i) => i.level === 'warning' && i.node === 'out' && i.port === 'padding') &&
			!issuesOf(
				moving([n('k', 'number', { value: MOTION_PADDING_MAX }), out], [w('k.out', 'out.padding')]),
			).length,
		`a program's room may reach ${MOTION_PADDING_MAX} shares, Melt's at its longest drips and strongest play (Bounce 3D's and the waves' fit under it); a graph reaching past it at its defaults is warned of, on the Motion Output's padding`,
	);

	// Hostile motion graphs are refused fast, bounded.
	/** `plotted`: the editor's series ignores the step cap a shipped program has, so it may plot. */
	const refusedFast = (label: string, raw: unknown, pattern: RegExp, plotted = false): void => {
		const graph = normalizeShaderGraphDoc(raw, 'h');
		const heap = process.memoryUsage().heapUsed;
		const t0 = performance.now();
		const analysis = analyzeShaderMotion(graph);
		const effect = compileShaderEffect(graph);
		const series = motionGraphSeries(graph, 64).get('k0');
		const ms = performance.now() - t0;
		const grew = (process.memoryUsage().heapUsed - heap) / 1e6;
		const longest = Math.max(0, ...analysis.issues.map((i) => i.message.length));
		assert(
			!effect.ok &&
				(plotted || series === undefined) &&
				analysis.issues.some((i) => pattern.test(i.message)) &&
				ms < 500 &&
				grew < 64 &&
				longest < 400,
			`${label}: refused in ${ms.toFixed(1)} ms, the heap ${grew.toFixed(1)} MB larger, no message over 400 characters (${longest})`,
		);
	};
	refusedFast(
		'100 000 nodes',
		{
			...pixel,
			motionGraph: {
				nodes: Array.from({ length: 100_000 }, (_, i) => n(`k${i}`, 'abs')),
				wires: [],
			},
		},
		/at most/,
	);
	refusedFast(
		'100 000 wires',
		{
			...pixel,
			motionGraph: {
				nodes: [n('k0', 'abs')],
				wires: Array.from({ length: 100_000 }, () => w('k0.out', 'k0.x')),
			},
		},
		new RegExp(`at most ${MOTION_GRAPH_NODE_LIMIT} and ${MOTION_GRAPH_WIRE_LIMIT}`),
	);
	refusedFast(
		'256 nodes typed 10 000 letters each',
		{
			...pixel,
			motionGraph: {
				nodes: Array.from({ length: 256 }, (_, i) => n(`k${i}`, 'z'.repeat(10_000))),
				wires: [],
			},
		},
		/"z{40}…" is not a node/,
	);
	refusedFast(
		'a 256-node loop',
		{
			...pixel,
			motionGraph: {
				nodes: [
					...Array.from({ length: 255 }, (_, i) => n(`k${i}`, 'add')),
					n('out', 'motionOutput'),
				],
				wires: [
					...Array.from({ length: 255 }, (_, i) => w(`k${i}.out`, `k${(i + 1) % 255}.a`)),
					w('k0.out', 'out.x'),
				],
			},
		},
		/loop/,
	);
	refusedFast(
		'255 nodes each with 10 distinct constants past the step cap',
		{
			...pixel,
			motionGraph: {
				nodes: [
					...Array.from({ length: 255 }, (_, i) =>
						n(`k${i}`, 'pick', {
							index: i,
							a: i + 0.1,
							b: i + 0.2,
							c: i + 0.3,
							d: i + 0.4,
							e: i + 0.5,
							f: i + 0.6,
						}),
					),
					n('out', 'motionOutput'),
				],
				wires: [
					...Array.from({ length: 254 }, (_, i) => w(`k${i}.out`, `k${i + 1}.a`)),
					w('k254.out', 'out.x'),
				],
			},
		},
		/more than the 256/,
		true,
	);

	// Every node's value over the play, in one pass, as an editor plots it.
	const all = motionGraphSeries(doc, 5);
	const rounded = (v?: number[]) => JSON.stringify(v?.map((x) => Math.round(x * 1e9) / 1e9));
	const fedBroken = moving(
		[n('p', 'param', { param: 'gone' }), n('a', 'abs'), n('b', 'abs'), out],
		[w('p.out', 'a.x'), w('a.out', 'out.x'), w('b.out', 'out.y')],
	);
	assert(
		!!all.get('bell')?.out?.every((v, i) => Math.abs(v - Math.sin((Math.PI * i) / 4)) < 1e-12) &&
			rounded(motionGraphSeries(doc, 3, { frame: { params: { amp: 2 } } }).get('lift')?.out) ===
				'[0.5,2.5,0.5]' &&
			rounded(motionGraphSeries(doc, 3).get('out')?.padding) === '[0.5,1,0.5]' &&
			JSON.stringify(motionGraphSeries(doc, 3).get('time')?.seconds) === '[0,0.5,1]' &&
			all.get('dead')?.out?.length === 5 &&
			!('x' in (all.get('out') ?? {})) &&
			!all.has('nope') &&
			!motionGraphSeries(fedBroken, 2).has('a') &&
			!motionGraphSeries(fedBroken, 2).has('p') &&
			JSON.stringify(Object.keys(motionGraphSeries(fedBroken, 2).get('out') ?? {})) === '["y"]' &&
			!motionGraphSeries(moving([out, n('o2', 'motionOutput')], []), 2).size,
		'every node’s series over the play in one pass: Bell is sin(π t); params at their defaults unless given; a Motion Output input plots what drives it; a node reaching nothing is plotted; an unwired channel, a broken node and what it feeds have none, the rest do; a graph that cannot be walked has none',
	);

	// Nothing in the motion path throws on what storage keeps.
	const padded = (params: unknown[]): ShaderGraphDoc =>
		normalizeShaderGraphDoc(
			{
				...pixel,
				params,
				motionGraph: {
					nodes: [n('k', 'number', { value: 0.5 }), n('p', 'param', { param: 'c' }), out],
					wires: [w('k.out', 'out.padding'), w('p.out', 'out.x')],
				},
			},
			'padded',
		);
	const survives = (doc: ShaderGraphDoc): string | undefined => {
		try {
			const effect = compileShaderEffect(doc);
			analyzeShaderMotion(doc);
			compileShaderMotion(doc);
			motionGraphSeries(doc, 9);
			return effect.ok ? 'ok' : 'refused';
		} catch (error) {
			return `throws ${(error as Error).message}`;
		}
	};
	assert(
		survives(padded([{}])) === 'refused' &&
			survives(padded([{ id: 'c', label: 'C', kind: 'choice', default: 'a' }])) === 'refused' &&
			survives(padded([{ id: 'c', label: 'C', kind: 'weird', default: 1 }])) === 'refused' &&
			motionGraphSeries(padded([{}]), 3).get('out')?.padding?.length === 3,
		'a doc whose params are malformed ({}, a choice with no options, an unknown kind) with a motion graph driving the padding is refused, never thrown on; its series still plot (a malformed param reads 0)',
	);
	let seed = 7;
	const random = (): number => {
		seed = (seed * 16807) % 2147483647;
		return (seed - 1) / 2147483646;
	};
	const pickOf = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
	const junk = [{}, null, 3, 'x', [], [1, 'a'], { id: 7 }, { id: '__proto__' }, { kind: 'choice' }];
	const paramJunk = [
		...junk,
		{ id: 'c', label: 'C', kind: 'choice', default: 'a' },
		{ id: 'c', label: 'C', kind: 'number', default: 5, min: 9, max: 1 },
		{ id: 'c', label: 'C', kind: 'color', default: 'red' },
		{ id: 'c', label: 'C', kind: 'bool', default: 'yes' },
		{ id: 'c', label: 'C', kind: 'number', default: 1, min: 0, max: 2 },
	];
	const types = [...MOTION_NODE_TYPES, 'sample', 'output', 'subgraph', 'nope', '__proto__', 7];
	const ports = ['out', 'x', 'padding', 'a', 't', 'progress', '__proto__', 'nope'];
	const thrown: string[] = [];
	for (let k = 0; k < 400; k++) {
		const count = 1 + Math.floor(random() * 8);
		const nodes = Array.from({ length: count }, (_, i) => ({
			id: random() < 0.1 ? pickOf(['n0', '', '__proto__']) : `n${i}`,
			type: pickOf(types),
			values: pickOf([
				undefined,
				{ param: 'c' },
				{ param: pickOf(junk) },
				{ value: pickOf([1, NaN, 'x', [1, 2]]) },
				{ a: [1, 2, 3], hold: -5 },
			]),
		}));
		const wires = Array.from({ length: Math.floor(random() * 10) }, () =>
			random() < 0.1
				? pickOf(junk)
				: {
						from: { node: `n${Math.floor(random() * count)}`, port: pickOf(ports) },
						to: { node: `n${Math.floor(random() * count)}`, port: pickOf(ports) },
					},
		);
		const raw = {
			...pixel,
			phase: pickOf(['loop', 'exit', 'weird', 3]),
			durationMs: pickOf([1000, NaN, 'x', -5]),
			params: Array.from({ length: Math.floor(random() * 3) }, () => pickOf(paramJunk)),
			motionGraph: random() < 0.05 ? pickOf(junk) : { nodes, wires },
		};
		const verdict = survives(normalizeShaderGraphDoc(JSON.parse(JSON.stringify(raw)), 'fuzz'));
		if (verdict?.startsWith('throws')) thrown.push(verdict);
	}
	assert(
		!thrown.length,
		`400 random docs (malformed params, values, node types, ids and wires, as storage keeps them) never throw in the motion path${thrown.length ? `: ${thrown[0]}` : ''}`,
	);
}

// -------------------------------------------------------------------------------------------------
console.log('shader graph — the Break Output');
{
	const n = (id: string, type: string, values?: GraphNode['values']): GraphNode => ({
		id,
		type,
		x: 0,
		y: 0,
		...(values ? { values } : {}),
	});
	const w = (from: string, to: string): GraphWire => {
		const [fn, fp] = from.split('.');
		const [tn, tp] = to.split('.');
		return { from: { node: fn, port: fp }, to: { node: tn, port: tp } };
	};
	const PARAMS: ElementFxParamSpec[] = [
		{ id: 'shards', label: 'Shards', kind: 'number', default: 30, min: 16, max: 160 },
		{ id: 'tint', label: 'Tint', kind: 'color', default: '#336699' },
		{ id: 'on', label: 'On', kind: 'bool', default: true },
		{
			id: 'hit',
			label: 'Hit',
			kind: 'choice',
			default: 'top',
			options: ['random', 'center', 'top', 'bottom', 'left', 'right'],
		},
		{ id: 'few', label: 'Few', kind: 'choice', default: 'top', options: ['top', 'left'] },
		{
			id: 'wind',
			label: 'Wind',
			kind: 'choice',
			default: 'up',
			options: ['upRight', 'up', 'upLeft', 'right', 'left', 'down'],
		},
	];
	/** An exit doc: the Output, a Break Output `b` (`values`), and `more` nodes and wires. */
	const broken = (
		values: GraphNode['values'],
		more: GraphNode[] = [],
		wires: GraphWire[] = [],
		meta: Partial<ShaderGraphDoc> = {},
	): ShaderGraphDoc => ({
		version: 1,
		id: 'brk',
		name: 'Brk',
		phase: 'exit',
		durationMs: 1800,
		params: PARAMS,
		nodes: [n('out', 'output'), n('b', BREAK_OUTPUT, values), ...more],
		wires,
		...meta,
	});
	const breakErrors = (doc: ShaderGraphDoc): GraphIssue[] =>
		analyzeShaderGraph(doc).issues.filter((i) => i.code === 'break');
	const solo = (() => {
		const g = graphBuilder({ id: 'solo', name: 'Solo', phase: 'exit', durationMs: 1800 });
		g.node('output');
		return g.doc();
	})();
	const identity = compileShaderGraph(solo);
	const identityCost = identity.ok ? identity.shader.cost : NaN;

	// The surface the editor builds on.
	const def = graphNodeDef(
		broken({ kind: 'crystallize' }),
		n('b', BREAK_OUTPUT, { kind: 'crystallize' }),
	);
	const ice = elementFxSpec('crystallize').params;
	assert(
		JSON.stringify(BREAK_KINDS) === JSON.stringify(ELEMENT_FX_BREAK_KINDS) &&
			JSON.stringify(BREAK_KINDS) ===
				JSON.stringify(
					ELEMENT_FX_BREAK_KINDS.filter((k) => findElementFxSpec(k)?.category === 'break'),
				) &&
			BREAK_KIND_DEFAULT === 'shatter' &&
			BREAK_AT_DEFAULT === 0 &&
			isBreakKind('assemble') &&
			!isBreakKind('melt'),
		'the six break kinds in catalog order; a Break Output defaults to Shatter, starting at once',
	);
	assert(
		def?.type === BREAK_OUTPUT &&
			def.category === 'output' &&
			!def.outputs.length &&
			JSON.stringify(def.inputs.map((p) => [p.id, p.type, p.default])) ===
				JSON.stringify(
					ice.map((p) => {
						const v = elementFxParamUniform(p, p.default);
						return [p.id, PARAM_TYPE[p.kind], v.length === 1 ? v[0] : v];
					}),
				) &&
			JSON.stringify(graphNodeDef(solo, n('b', BREAK_OUTPUT))?.inputs.map((p) => p.id)) ===
				JSON.stringify(elementFxSpec('shatter').params.map((p) => p.id)) &&
			graphNodeDef(solo, n('b', BREAK_OUTPUT, { kind: 'melt' }))?.inputs.length === 0 &&
			graphNodeDef(solo, n('b', BREAK_OUTPUT), 'someSubgraph') === undefined &&
			!shaderNode(BREAK_OUTPUT) &&
			JSON.stringify(def.settings?.map((s) => s.id)) === '["kind","at"]',
		'graphNodeDef answers a Break Output with its kind’s params as ports (a number or switch or choice a float, a colour a vec3, each reading its default unwired), Shatter’s when it names none, none for a kind that is no break, and nothing inside a subgraph; it is no library node',
	);

	// It compiles to the effect's break, reaching no GLSL.
	const plain = broken({});
	const plainResult = compileShaderEffect(plain);
	const plainAnalysis = analyzeShaderGraph(plain);
	assert(
		plainResult.ok &&
			identity.ok &&
			plainResult.effect.shader.body === identity.shader.body &&
			JSON.stringify(plainResult.effect.shader.uniforms) ===
				JSON.stringify(identity.shader.uniforms) &&
			JSON.stringify(plainResult.effect.break) ===
				JSON.stringify({
					kind: 'shatter',
					at: 0,
					params: { impact: 'random', pieces: 56, crack: 0.3, gravity: 1 },
				}) &&
			!plainResult.warnings.length &&
			plainAnalysis.cost === identity.shader.cost &&
			plainAnalysis.samples === identity.shader.samples &&
			JSON.stringify(plainAnalysis.inputs.b) ===
				'{"impact":"float","pieces":"float","crack":"float","gravity":"float"}' &&
			JSON.stringify(readCustomElementFx(plainResult.effect)?.break) ===
				JSON.stringify(plainResult.effect.break),
		'a Break Output reaches no GLSL (the shader is the Output alone’s, its cost and reads too) and compiles to the effect’s break, every param of its kind at its default, which the registry reads',
	);

	// Ties, constants and its own values.
	const wired = broken(
		{ kind: 'shatter', at: 0.25, crack: 0.45 },
		[
			n('p', 'param', { param: 'hit' }),
			n('k', 'number', { value: 80 }),
			n('g', 'number', { value: 2 }),
		],
		[w('p.out', 'b.impact'), w('k.out', 'b.pieces'), w('g.out', 'b.gravity')],
	);
	const ownValues = broken(
		{ kind: 'crystallize', color: '#A0B0C0', from: 2, pieces: 20, freeze: 0.5 },
		[n('k', 'number', { value: 1.6 })],
		[],
	);
	const numbers = (value: number) =>
		compileShaderEffect(
			broken({ kind: 'shatter' }, [n('k', 'number', { value })], [w('k.out', 'b.impact')]),
		);
	const impactOf = (value: number): unknown => {
		const r = numbers(value);
		return r.ok ? r.effect.break?.params.impact : 'refused';
	};
	const colour = compileShaderEffect(
		broken(
			{ kind: 'crystallize' },
			[n('c', 'color', { value: '#ABCDEF' }), n('t', 'param', { param: 'tint' })],
			[w('c.out', 'b.color')],
		),
	);
	const wiredResult = compileShaderEffect(wired);
	const ownResult = compileShaderEffect(ownValues);
	assert(
		wiredResult.ok &&
			JSON.stringify(wiredResult.effect.break) ===
				JSON.stringify({
					kind: 'shatter',
					at: 0.25,
					params: { impact: { param: 'hit' }, pieces: 80, crack: 0.45, gravity: 2 },
				}) &&
			ownResult.ok &&
			JSON.stringify(ownResult.effect.break?.params) ===
				JSON.stringify({ color: '#a0b0c0', from: 'top', pieces: 20, freeze: 0.5, gravity: 1 }) &&
			colour.ok &&
			colour.effect.break?.params.color === '#abcdef',
		'a Param ties its port to the effect’s param; a Number or a Colour sets a constant; a port left unwired takes the node’s own value (a colour lower-cased, a choice by its option or its index), else the default',
	);
	assert(
		impactOf(1.6) === 'top' &&
			impactOf(99) === 'right' &&
			impactOf(-3) === 'random' &&
			impactOf(0.49) === 'random',
		'a Number into a choice picks the option at its index, rounded and kept in range',
	);
	const driftOf = (drift: string | number): unknown => {
		const r = compileShaderEffect(broken({ kind: 'disintegrate', drift }));
		return r.ok ? r.effect.break?.params.drift : 'refused';
	};
	const glass = (value: number) => {
		const r = compileShaderEffect(
			broken({ kind: 'shatter' }, [n('k', 'number', { value })], [w('k.out', 'b.pieces')]),
		);
		return r.ok ? r.effect.break?.params.pieces : 'refused';
	};
	assert(
		driftOf('left') === 'left' &&
			driftOf(4) === 'left' &&
			glass(16) === 16 &&
			glass(160) === 160 &&
			glass(161) === 'refused',
		'a choice stored as its index reads as its option; a constant in a number port is held to the param’s range',
	);
	// A switch: none of the six breaks has one, so its reading is held through `readBreakValue`.
	const sw = PARAMS[2];
	assert(
		readBreakValue(sw, 1) === true &&
			readBreakValue(sw, 0) === false &&
			readBreakValue(sw, 2) === undefined &&
			readBreakValue(sw, true) === undefined &&
			readBreakValue(PARAMS[1], '#ABCDEF') === '#abcdef' &&
			readBreakValue(PARAMS[1], [1, 0, 0]) === undefined &&
			readBreakValue(PARAMS[3], 'left') === 'left' &&
			readBreakValue(PARAMS[3], 1) === 'center' &&
			readBreakValue(PARAMS[3], 1.5) === undefined &&
			readBreakValue(PARAMS[3], 6) === undefined &&
			readBreakValue(PARAMS[0], 200) === undefined,
		'a value of its own reads as the break takes it: a switch 1 / 0, a #rrggbb colour, a choice’s option or whole index, a number in range; nothing else',
	);

	// Every error, each a `break` error on the Break Output (and its port).
	const errorOf = (doc: ShaderGraphDoc): string =>
		breakErrors(doc)
			.map((i) => `${i.node}.${i.port ?? ''}`)
			.join(' ');
	const cases: [string, ShaderGraphDoc, string][] = [
		['two Break Outputs', broken({}, [n('b2', BREAK_OUTPUT)]), 'b2.'],
		['a kind that is no break', broken({ kind: 'melt' }), 'b.kind'],
		['a kind that is not text', broken({ kind: 5 }), 'b.kind'],
		['a start past 1', broken({ at: 1.5 }), 'b.at'],
		['a start below 0', broken({ at: -0.1 }), 'b.at'],
		['a start as text', broken({ at: '0.5' }), 'b.at'],
		['a start as a list', broken({ at: [0.5] }), 'b.at'],
		['an exit break in a loop effect', broken({}, [], [], { phase: 'loop' }), 'b.kind'],
		['an assemble in an exit effect', broken({ kind: 'assemble' }), 'b.kind'],
		[
			'a wire from a node that is no Param or constant',
			broken({}, [n('u', 'uv')], [w('u.out', 'b.crack')]),
			'b.crack',
		],
		[
			'a Number into a colour port',
			broken({ kind: 'crystallize' }, [n('k', 'number')], [w('k.out', 'b.color')]),
			'b.color',
		],
		[
			'a Colour into a number port',
			broken({}, [n('c', 'color')], [w('c.out', 'b.gravity')]),
			'b.gravity',
		],
		[
			'a Param of another kind',
			broken({}, [n('p', 'param', { param: 'tint' })], [w('p.out', 'b.gravity')]),
			'b.gravity',
		],
		[
			'a switch Param into a number port',
			broken({}, [n('p', 'param', { param: 'on' })], [w('p.out', 'b.pieces')]),
			'b.pieces',
		],
		[
			'a choice Param with other options',
			broken({}, [n('p', 'param', { param: 'few' })], [w('p.out', 'b.impact')]),
			'b.impact',
		],
		[
			'a constant out of range',
			broken({}, [n('k', 'number', { value: 3 })], [w('k.out', 'b.pieces')]),
			'b.pieces',
		],
		['a number of its own out of range', broken({ pieces: 999 }), 'b.pieces'],
		['a number of its own as text', broken({ pieces: '56' }), 'b.pieces'],
		[
			'a colour of its own that is no colour',
			broken({ kind: 'crystallize', color: 'blue' }),
			'b.color',
		],
		['a choice of its own it lacks', broken({ impact: 'middle' }), 'b.impact'],
		['a choice index past its options', broken({ impact: 9 }), 'b.impact'],
	];
	const wrong = cases.filter(([, doc, at]) => errorOf(doc) !== at);
	assert(
		!wrong.length &&
			cases.every(
				([, doc]) =>
					!compileShaderEffect(doc).ok &&
					breakErrors(doc).every((i) => i.level === 'error' && i.message.length < 400),
			),
		`each broken Break Output is one break error on it, naming the port, and does not compile (${cases.length}: ${cases.map(([label]) => label).join('; ')})${wrong.length ? `: wrong ${wrong.map(([label, doc]) => `${label} → ${errorOf(doc) || 'none'}`).join(', ')}` : ''}`,
	);
	const phaseDoc = broken({}, [], [], { phase: 'loop' });
	const phaseAnalysis = analyzeShaderGraph(phaseDoc);
	const unpicked = broken({}, [n('p', 'param')], [w('p.out', 'b.gravity')]);
	assert(
		/set the effect’s phase to exit/.test(breakErrors(phaseDoc)[0]?.message ?? '') &&
			/set the effect’s phase to enter/.test(
				breakErrors(broken({ kind: 'assemble' }))[0]?.message ?? '',
			) &&
			/set once per play, not per pixel/.test(
				breakErrors(broken({}, [n('u', 'uv')], [w('u.out', 'b.crack')]))[0]?.message ?? '',
			) &&
			!!phaseAnalysis.inputs.b &&
			!!phaseAnalysis.inputs.out &&
			phaseAnalysis.cost === identityCost &&
			!breakErrors(unpicked).length &&
			analyzeShaderGraph(unpicked).issues.some(
				(i) => i.code === 'setting' && i.node === 'p' && i.level === 'error',
			),
		'the phase error tells the author which phase to set; a per-pixel wire says the break is set once per play; a break error leaves the port types and the cost standing; a Param with none picked wired in is the Param’s own error alone',
	);
	const reach = analyzeShaderGraph(
		broken(
			{},
			[n('p', 'param', { param: 'hit' }), n('k', 'number', { value: 1 }), n('lost', 'number')],
			[w('p.out', 'b.impact'), w('k.out', 'b.gravity')],
		),
	);
	assert(
		JSON.stringify(reach.issues.map((i) => [i.code, i.node])) === '[["unreachable","lost"]]' &&
			reach.cost === identityCost,
		'what feeds only the Break Output counts as used (no “does not reach the Output”) and costs nothing per pixel; a node reaching neither is still warned of',
	);
	const callsBreak: ShaderGraphDoc = {
		...plain,
		nodes: [n('out', 'output'), n('call', 'subgraph', { subgraph: 's' })],
		wires: [],
		subgraphs: [
			{
				id: 's',
				name: 'S',
				inputs: [],
				outputs: [{ id: 'o', label: 'O', type: 'float' }],
				nodes: [n('in', 'subgraphIn'), n('so', 'subgraphOut'), n('inner', BREAK_OUTPUT)],
				wires: [],
			},
		],
	};
	const inMotion: ShaderGraphDoc = {
		...solo,
		motionGraph: { nodes: [n('mb', BREAK_OUTPUT), n('mo', 'motionOutput')], wires: [] },
	};
	assert(
		analyzeShaderGraph(callsBreak).issues.some(
			(i) => i.node === 'call' && /belongs in the effect’s own graph/.test(i.message),
		) &&
			analyzeShaderSubgraph(callsBreak, 's').issues.some(
				(i) => i.node === 'inner' && /belongs in the effect’s own graph/.test(i.message),
			) &&
			analyzeShaderMotion(inMotion).issues.some(
				(i) => i.node === 'mb' && /belongs in the pixel graph/.test(i.message),
			),
		'a Break Output in a subgraph is refused on its call (and named, the body opened), and one in the motion graph is told it belongs in the pixel graph',
	);

	// The fade a runtime from before breaks plays: in the curves, and in a program driving alpha.
	const fadeOf = (motion: ShaderGraphDoc['motion'], at = 0.4, kind = 'crumble') => {
		const r = compileShaderEffect(broken({ kind, at }, [], [], { ...(motion ? { motion } : {}) }));
		return r.ok ? r.effect.motion : undefined;
	};
	const s0 = 0.4 + BREAK_FADE_FROM * 0.6;
	const keysAfter = [
		{ t: 0, v: 1, ease: 'in' as const },
		{ t: 0.7, v: 0.5, ease: 'out' as const },
		{ t: 0.9, v: 0.4 },
	];
	const keysBefore = [
		{ t: 0, v: 0.2, ease: 'smooth' as const },
		{ t: 0.3, v: 0.9, ease: 'out' as const },
	];
	const keysAtEnd = [
		{ t: 0, v: 1, ease: 'smooth' as const },
		{ t: 1, v: 0.6 },
	];
	const curve = (keys: ShaderGraphDoc['motion']) => fadeOf(keys)?.channels.alpha ?? [];
	const ts = Array.from({ length: 401 }, (_, i) => i / 400);
	const exactBefore = (keys: readonly { t: number; v: number; ease?: 'in' | 'out' | 'smooth' }[]) =>
		ts.every(
			(t) =>
				t > s0 ||
				sampleElementFxCurve(curve({ channels: { alpha: keys } }), t) ===
					sampleElementFxCurve(keys, t),
		) && sampleElementFxCurve(curve({ channels: { alpha: keys } }), 1) === 0;
	assert(
		s0 === 0.49 &&
			JSON.stringify(curve(undefined)) ===
				JSON.stringify([
					{ t: s0, v: 1, ease: 'smooth' },
					{ t: 1, v: 0 },
				]) &&
			JSON.stringify(curve({ channels: { alpha: keysAfter } })) ===
				JSON.stringify([keysAfter[0], { ...keysAfter[1], ease: 'smooth' }, { t: 1, v: 0 }]) &&
			JSON.stringify(curve({ channels: { alpha: keysBefore } })) ===
				JSON.stringify([...keysBefore, { t: s0, v: 0.9, ease: 'smooth' }, { t: 1, v: 0 }]) &&
			JSON.stringify(curve({ channels: { alpha: keysAtEnd } })) ===
				JSON.stringify([keysAtEnd[0], { ...keysAtEnd[1], ease: 'smooth' }, { t: 1, v: 0 }]) &&
			exactBefore(keysAfter) &&
			exactBefore(keysBefore) &&
			exactBefore(keysAtEnd) &&
			ts.every((t) => {
				const k = Math.min(1, Math.max(0, (t - s0) / (1 - s0)));
				return (
					Math.abs(sampleElementFxCurve(curve(undefined), t) - (1 - k * k * (3 - 2 * k))) < 1e-12
				);
			}),
		'an exit’s break adds an alpha fade for older runtimes: 1 until 0.15 through the break’s window, then smoothly to 0, as a break that cannot cut fades; the doc’s own curve is kept exactly up to its first key past that (none: its last value is held to it), which eases to 0 at the end (a key at the end gets a second, at 0)',
	);
	const programmedAlpha = (at: number) =>
		compileShaderEffect(
			broken({ kind: 'crumble', at }, [], [], {
				motionGraph: {
					nodes: [n('mt', 'time'), n('mo', 'motionOutput'), n('mk', 'number', { value: 2 })],
					wires: [w('mt.progress', 'mo.alpha'), w('mk.out', 'mo.x')],
				},
			}),
		);
	const program = (r: ReturnType<typeof programmedAlpha>) =>
		r.ok ? r.effect.motion?.program : undefined;
	const run = (r: ReturnType<typeof programmedAlpha>, t: number) => {
		const p = program(r);
		return p
			? runMotionProgram(p, {
					t,
					seconds: t,
					intensity: 1,
					looping: false,
					params: {},
					seed: 0,
					width: 1,
					height: 1,
				})
			: {};
	};
	const half = programmedAlpha(0.5);
	const end = programmedAlpha(1);
	const noAlpha = compileShaderEffect(
		broken({ kind: 'crumble' }, [], [], {
			motionGraph: {
				nodes: [n('mk', 'number', { value: 2 }), n('mo', 'motionOutput')],
				wires: [w('mk.out', 'mo.x')],
			},
		}),
	);
	const start = 0.5 + BREAK_FADE_FROM * 0.5;
	assert(
		ts.every((t) => t > start || run(half, t).alpha === t) &&
			run(half, 1).alpha === 0 &&
			ts.every((t) => run(half, t).x === 2) &&
			(run(half, 0.9).alpha ?? 1) < 0.9 &&
			ts.every((t) => t === 1 || run(end, t).alpha === t) &&
			run(end, 1).alpha === 0 &&
			noAlpha.ok &&
			JSON.stringify(noAlpha.effect.motion?.program?.ops) === JSON.stringify([['const', 2]]) &&
			!!readCustomElementFx(half.ok ? half.effect : undefined)?.motion?.program,
		'a motion graph driving alpha takes the same fade as steps after its own: alpha exactly as the graph drives it until the fade starts, 0 at the end (a break at the very end: a step at the end); a program driving no alpha is left as it is; the registry runs it',
	);
	const entrance = compileShaderEffect(
		broken({ kind: 'assemble', at: 0.4 }, [], [], { phase: 'enter' }),
	);
	assert(
		entrance.ok && !entrance.effect.motion && entrance.effect.break?.at === 0.4,
		'an assemble carries no fade (an entrance: an older runtime simply shows the element)',
	);
	const crowded = Array.from({ length: CURVE_KEY_LIMIT }, (_, i) => ({
		t: i / (CURVE_KEY_LIMIT * 4),
		v: 1,
	}));
	assert(
		breakErrors(
			broken({ kind: 'crumble', at: 0.5 }, [], [], { motion: { channels: { alpha: crowded } } }),
		).some((i) => /at most 30 keys/.test(i.message)) &&
			!breakErrors(
				broken({ kind: 'crumble', at: 0.5 }, [], [], {
					motion: { channels: { alpha: crowded.slice(2) } },
				}),
			).length,
		`an alpha curve too full to take the fade (${CURVE_KEY_LIMIT} keys before it starts) is an error, so a shipped effect’s curve is never one the registry would refuse`,
	);

	// Nothing else moves: the corpus compiles the same with a Break Output beside it.
	const corpus = [
		...REFERENCE_GRAPHS,
		...BUILTIN_TWINS.filter((t) => !isBreakTwin(t)).map((t) => t.doc),
		...nodeShowcase(),
	];
	const moved = corpus.filter((doc) => {
		const before = compileShaderGraph(doc);
		const withBreak = {
			...doc,
			phase: 'exit' as const,
			nodes: [...doc.nodes, n('brkProbe', BREAK_OUTPUT)],
		};
		const after = compileShaderGraph(withBreak);
		const a = analyzeShaderGraph(doc);
		const b = analyzeShaderGraph(withBreak);
		delete b.inputs.brkProbe;
		delete b.outputs.brkProbe;
		return (
			JSON.stringify(
				before.ok && [
					before.shader.body,
					before.shader.uniforms,
					before.shader.cost,
					before.shader.samples,
				],
			) !==
				JSON.stringify(
					after.ok && [
						after.shader.body,
						after.shader.uniforms,
						after.shader.cost,
						after.shader.samples,
					],
				) ||
			JSON.stringify([a.inputs, a.outputs, a.cost, a.samples]) !==
				JSON.stringify([b.inputs, b.outputs, b.cost, b.samples])
		);
	});
	assert(
		!moved.length,
		`${corpus.length} docs (references, twins, the node showcase) compile to the same shader and analyse to the same types and cost with a Break Output beside them${moved.length ? `: not ${moved.map((d) => d.id).join(', ')}` : ''}`,
	);

	// Each break twin.
	const breakTwins = BUILTIN_TWINS.filter(isBreakTwin);
	assert(
		JSON.stringify(breakTwins.map((t) => t.kind)) === JSON.stringify(ELEMENT_FX_BREAK_KINDS) &&
			breakTwins.every((t) => {
				const r = compileShaderEffect(t.doc);
				const params = elementFxSpec(t.kind).params;
				return (
					r.ok &&
					identity.ok &&
					r.effect.shader.body === identity.shader.body &&
					r.effect.break?.kind === t.kind &&
					r.effect.break.at === 0 &&
					JSON.stringify(r.effect.break.params) ===
						JSON.stringify(Object.fromEntries(params.map((p) => [p.id, { param: p.id }]))) &&
					!r.warnings.length
				);
			}),
		'each break twin is the element as it is (the Output alone’s shader) and a Break Output of its kind starting at once, every param tied by id, warning-free',
	);

	// Hostile Break Outputs are refused fast, bounded, never thrown on.
	const refusedFast = (label: string, raw: unknown, pattern: RegExp): void => {
		const heap = process.memoryUsage().heapUsed;
		const t0 = performance.now();
		let issues: GraphIssue[] = [];
		let threw = '';
		let ok = true;
		try {
			const doc = normalizeShaderGraphDoc(raw, 'h');
			issues = analyzeShaderGraph(doc).issues;
			validateShaderGraph(doc);
			ok = compileShaderEffect(doc).ok;
		} catch (error) {
			threw = (error as Error).message;
		}
		const ms = performance.now() - t0;
		const grew = (process.memoryUsage().heapUsed - heap) / 1e6;
		const longest = Math.max(0, ...issues.map((i) => i.message.length));
		assert(
			!threw &&
				!ok &&
				issues.some((i) => pattern.test(i.message)) &&
				ms < 500 &&
				grew < 64 &&
				longest < 400,
			`${label}: refused in ${ms.toFixed(1)} ms, the heap ${grew.toFixed(1)} MB larger, no message over 400 characters (${longest})${threw ? `; threw ${threw}` : ''}`,
		);
	};
	refusedFast(
		'a kind of 100 000 letters',
		broken({ kind: 'z'.repeat(100_000) }),
		/"z{40}…" is not a break/,
	);
	refusedFast('a start of 1e308', broken({ at: 1e308 }), /0…1/);
	refusedFast(
		'10 000 values of its own and 10 000 wires into it',
		broken(
			Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`v${i}`, i])),
			[n('k', 'number')],
			Array.from({ length: 10_000 }, (_, i) => w('k.out', `b.p${i}`)),
		),
		/has no input/,
	);
	refusedFast(
		'10 000 Break Outputs',
		broken(
			{},
			Array.from({ length: 10_000 }, (_, i) => n(`b${i}`, BREAK_OUTPUT)),
		),
		/one Break Output/,
	);
	refusedFast(
		'prototype names (a kind, a value, a port)',
		JSON.parse(
			JSON.stringify(
				broken({ kind: 'constructor' }, [n('k', 'number')], [w('k.out', 'b.toString')]),
			).replace(
				'"values":{"kind":"constructor"}',
				'"values":{"kind":"constructor","__proto__":{"at":2}}',
			),
		),
		/not a break/,
	);
	refusedFast(
		'values that are no map',
		{
			...broken({}),
			nodes: [n('out', 'output'), { id: 'b', type: BREAK_OUTPUT, values: 'shatter' }],
			phase: 'loop',
		},
		/phase/,
	);

	// A fuzz: what storage keeps never throws, and what compiles reads with its break.
	let seed = 11;
	const random = (): number => {
		seed = (seed * 16807) % 2147483647;
		return (seed - 1) / 2147483646;
	};
	const pickOf = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
	const junk = [undefined, null, 3, -1, 0.5, 1e9, 'x', '#ABCDEF', [], [1, 2, 3], {}, 'constructor'];
	const ports = [
		'impact',
		'pieces',
		'crack',
		'gravity',
		'color',
		'from',
		'freeze',
		'drift',
		'particles',
		'turbulence',
		'force',
		'spread',
		'nope',
		'__proto__',
		'toString',
	];
	const types = [BREAK_OUTPUT, 'param', 'number', 'color', 'uv', 'time', 'output', 'subgraph'];
	const thrown: string[] = [];
	const unread: string[] = [];
	let compiled = 0;
	for (let k = 0; k < 400; k++) {
		const count = random() < 0.5 ? 0 : 1 + Math.floor(random() * 6);
		const nodes = [
			n('out', 'output'),
			n('b', BREAK_OUTPUT, {
				kind: pickOf([...BREAK_KINDS, ...BREAK_KINDS, 'melt', 5]) as string,
				at: pickOf([0, 0.3, 0.7, 1, 1.2, -1, 'x']) as number,
				...Object.fromEntries(
					Array.from({ length: random() < 0.5 ? 0 : Math.floor(random() * 4) }, () => [
						pickOf(ports),
						pickOf(junk) as number,
					]),
				),
			}),
			...Array.from({ length: count }, (_, i) =>
				n(`n${i}`, pickOf(types), {
					param: pickOf(['shards', 'tint', 'on', 'hit', 'few', 'wind', 'gone']),
					value: pickOf(junk) as number,
				}),
			),
		];
		const wires = Array.from({ length: count ? Math.floor(random() * 6) : 0 }, () =>
			w(
				`n${Math.floor(random() * count)}.${pickOf(['out', 'progress', 'x'])}`,
				`b.${pickOf(ports)}`,
			),
		);
		const raw = broken({}, [], [], {
			phase: pickOf(['exit', 'exit', 'enter', 'loop']),
			nodes,
			wires,
			...(random() < 0.3 ? { motion: { channels: { alpha: [{ t: 0, v: random() }] } } } : {}),
		});
		try {
			const doc = normalizeShaderGraphDoc(JSON.parse(JSON.stringify(raw)), 'fuzz');
			analyzeShaderGraph(doc);
			const r = compileShaderEffect(doc);
			if (r.ok) {
				compiled++;
				const read = readCustomElementFx(r.effect);
				if (r.effect.break && JSON.stringify(read?.break) !== JSON.stringify(r.effect.break))
					unread.push(JSON.stringify(r.effect.break));
			}
		} catch (error) {
			thrown.push((error as Error).message);
		}
	}
	assert(
		!thrown.length && !unread.length && compiled > 20,
		`400 random Break Outputs (kinds, starts, values, wires and phases, as storage keeps them) never throw; each of the ${compiled} that compile ships a break the registry reads${thrown.length ? `: threw ${thrown[0]}` : ''}${unread.length ? `: unread ${unread[0]}` : ''}`,
	);
}

// -------------------------------------------------------------------------------------------------
console.log('shader graph — the Custom GLSL node');
{
	const glslNode = (
		def: CustomGlslDefinition,
		id = 'g',
		values?: GraphNode['values'],
	): GraphNode => ({
		id,
		type: CUSTOM_GLSL,
		x: 0,
		y: 0,
		glsl: JSON.parse(JSON.stringify(def)) as CustomGlslDefinition,
		...(values ? { values } : {}),
	});
	const errorsOf = (def: CustomGlslDefinition): GraphIssue[] =>
		customGlslIssues(glslNode(def)).filter((i) => i.level === 'error');
	/** The compiler's part of a body (its Custom GLSL functions declared, their bodies out), linted as
	 *  every graph is; the functions' calls must all link. */
	const lintGlsl = (b: string): string[] => [
		...lint(b.replace(/(void efxGlsl_\d+\([^)]*\))\n\{\n[\s\S]*?\n\}\n/g, '$1;\n')),
		...unknownEfxCalls(b).map((name) => `calls ${name}, which nothing declares`),
	];
	const port = (id: string, type: PortType, value?: number | number[]): SubgraphPort => ({
		id,
		label: id,
		type,
		...(value === undefined ? {} : { default: value }),
	});

	const fresh = glslNode(CUSTOM_GLSL_DEFAULT);
	const def = customGlslDef(fresh);
	const passed = compileShaderGraph(customGlslChain('passed', [CUSTOM_GLSL_DEFAULT]));
	assert(
		!customGlslIssues(fresh).length &&
			JSON.stringify(def.inputs.map((p) => [p.id, p.type])) === '[["color","vec4"]]' &&
			JSON.stringify(def.outputs.map((p) => [p.id, p.type])) === '[["color","vec4"]]' &&
			def.category === 'code' &&
			def.cost === 1 &&
			passed.ok &&
			passed.shader.body.includes('void efxGlsl_0(inout vec4 color)\n{\n    color = color;\n}\n') &&
			!lintGlsl(passed.shader.body).length,
		'a new Custom GLSL node passes the colour through (one vec4 in and out, `color`, one value), with no issue, a cost of 1 and its comments out of the GLSL',
	);

	const unexpected = VALID_GLSL.flatMap((sample) => {
		const issues = customGlslIssues(glslNode(sample));
		const errors = issues.filter((i) => i.level === 'error');
		const warned = issues.some((i) => i.level === 'warning');
		const r = compileShaderGraph(customGlslChain('valid', [sample]));
		const problems = [
			...errors.map((i) => i.message),
			...(warned === !!sample.warns ? [] : [`warning ${warned}`]),
			...(r.ok
				? lintGlsl(r.shader.body)
				: r.issues.filter((i) => i.level === 'error').map((i) => i.message)),
		];
		return problems.length ? [`${sample.name}: ${problems.join('; ')}`] : [];
	});
	assert(
		VALID_GLSL.length >= 20 && !unexpected.length,
		`${VALID_GLSL.length} sample bodies (loops, branches, matrices, integers, swizzles, the library, comments, outputs) pass the checker, compile, link and lint${unexpected.length ? `: ${unexpected.join(' | ')}` : ''}`,
	);

	const missed = INVALID_GLSL.flatMap((sample) => {
		const issues = customGlslIssues(glslNode(sample));
		const hit = issues.find(
			(i) => sample.expect.test(i.message) && i.level === (sample.warning ? 'warning' : 'error'),
		);
		const placed =
			hit &&
			hit.code === 'glsl' &&
			hit.node === 'g' &&
			hit.line === sample.line &&
			(sample.line === undefined || hit.message.startsWith(`line ${sample.line}: `));
		const compiles = compileShaderGraph(customGlslChain('invalid', [sample])).ok;
		return placed && compiles === !!sample.warning
			? []
			: [`${sample.name}: ${JSON.stringify(issues.map((i) => [i.level, i.message]))}`];
	});
	assert(
		INVALID_GLSL.length >= 100 && !missed.length,
		`${INVALID_GLSL.length} bodies and ports the checker refuses, each said on its line (line N: …, \`line\`), the effect not compiling (a warning only for an output written on some paths)${missed.length ? `: ${missed.join(' | ')}` : ''}`,
	);
	const refusals = [
		/while/,
		/do loops/,
		/discard/,
		/preprocessor/,
		/functions cannot be declared/,
		/struct declarations/,
		/uniform declarations/,
		/attribute declarations/,
		/varying declarations/,
		/precision declarations/,
		/belongs to the effect’s shader/,
		/is not declared/,
		/gl_ names/,
		/samplers/,
		/reads a texture/,
		/divided by 0/,
		/4096 bytes/,
		/600 tokens/,
		/never written/,
		/some paths only/,
		/at most 64 rounds/,
		/more than 256/,
	];
	const uncovered = refusals.filter(
		(r) =>
			!INVALID_GLSL.some(
				(sample) =>
					r.test(sample.expect.source) ||
					INVALID_GLSL.some((s2) => customGlslIssues(glslNode(s2)).some((i) => r.test(i.message))),
			),
	);
	assert(
		!uncovered.length,
		`every refusal of the subset is held by a sample${uncovered.length ? `: ${uncovered.join(', ')}` : ''}`,
	);

	// The fuzz.
	const thrown: string[] = [];
	const tripped: string[] = [];
	const mismatched: string[] = [];
	let taken = 0;
	let worst = 0;
	const began = performance.now();
	const fuzz = [
		...Array.from({ length: 700 }, (_, n) => soupGlsl(11, n)),
		...Array.from({ length: 700 }, (_, n) => mutatedGlsl(13, n)),
		...nearMissGlsl(),
	];
	for (const sample of fuzz) {
		const t0 = performance.now();
		try {
			const issues = customGlslIssues(glslNode(sample));
			if (issues.some((i) => i.message.includes(CHECKER_FAILED))) tripped.push(sample.name);
			const clean = !issues.some((i) => i.level === 'error');
			const r = compileShaderEffect(customGlslChain('fuzz', [sample]));
			if (clean) taken++;
			if (r.ok !== clean || (r.ok && lintGlsl(r.effect.shader.body).length))
				mismatched.push(
					`${sample.name}: ${r.ok ? lintGlsl(r.effect.shader.body).join('; ') : 'refused'}`,
				);
		} catch (error) {
			thrown.push(`${sample.name}: ${(error as Error).message}`);
		}
		worst = Math.max(worst, performance.now() - t0);
	}
	const fuzzMs = performance.now() - began;
	assert(
		!thrown.length && !tripped.length && !mismatched.length && taken >= 40 && worst < 100,
		`${fuzz.length} token soups, broken bodies and bodies one slip from valid never throw, never trip the checker, and compile exactly when it takes them (${taken} taken, all linting clean): ${Math.round(fuzzMs)} ms in all, ${worst.toFixed(1)} ms at worst${thrown.length ? `: threw ${thrown[0]}` : ''}${tripped.length ? `: tripped on ${tripped[0]}` : ''}${mismatched.length ? `: ${mismatched[0]}` : ''}`,
	);
	const refusedGenerated: string[] = [];
	for (let n = 0; n < 300; n++) {
		const sample = generatedGlsl(5, n);
		const errors = errorsOf(sample);
		const r = compileShaderGraph(customGlslChain('generated', [sample]));
		if (errors.length || !r.ok || lintGlsl(r.shader.body).length)
			refusedGenerated.push(
				`${sample.name}: ${errors.map((i) => i.message).join('; ')}\n${sample.code}`,
			);
	}
	assert(
		!refusedGenerated.length,
		`300 random bodies from the grammar (declarations, assignments, swizzles, branches, loops in loops, break, the library) pass the checker and compile${refusedGenerated.length ? `: ${refusedGenerated[0]}` : ''}`,
	);
	const takenBodies = [
		...VALID_GLSL,
		...fuzz,
		...Array.from({ length: 300 }, (_, n) => generatedGlsl(5, n)),
	].filter((sample) => !errorsOf(sample).length);
	const unfaithful = takenBodies.filter((sample) => {
		const emitted = customGlslFunction(glslNode(sample)).lines.join('\n');
		const checked = customGlslTokens(sample.code);
		return !checked || JSON.stringify(customGlslTokens(emitted)) !== JSON.stringify(checked);
	});
	const lineEnds = VALID_GLSL.find((sample) => sample.name === 'line ends of every kind');
	const lineEndsEmitted = lineEnds ? customGlslFunction(glslNode(lineEnds)).lines.join('\n') : '';
	assert(
		!unfaithful.length &&
			takenBodies.length > 600 &&
			!!lineEnds &&
			lineEndsEmitted.includes('color.g = -\n-color.g;') &&
			lineEndsEmitted.includes('color.b += +\n+0.5;') &&
			lineEndsEmitted.includes('int j = -\n-i;') &&
			!/--color|--i;|\+\+0/.test(lineEndsEmitted),
		`every body the checker takes (${takenBodies.length}) is given to the GPU as the very tokens it checked; a carriage return, alone or before a line feed, ends a line, so "-\\r-i" goes out as two minus signs, never as --${unfaithful.length ? `: ${unfaithful.map((s) => s.name).join(', ')}` : ''}`,
	);
	const hostile = [
		'('.repeat(4000),
		'{'.repeat(4000),
		'/*'.repeat(2000),
		'a'.repeat(4096),
		`${'x = '.repeat(1000)}1.0;`,
		`${'1.0 + '.repeat(680)}1.0`,
		'x'.repeat(5_000_000),
	];
	const hostileStart = performance.now();
	const hostileOk = hostile.every((code) => errorsOf({ ...CUSTOM_GLSL_DEFAULT, code }).length > 0);
	const hostileMs = performance.now() - hostileStart;
	assert(
		hostileOk && hostileMs < 300,
		`hostile bodies (4,000 brackets or braces, an unclosed comment, a 4 KB name, chained assignments, 5 MB) are refused in ${hostileMs.toFixed(1)} ms`,
	);

	// The GLSL.
	const shaded = (nodes: GraphNode[], wires: GraphWire[]): ShaderGraphDoc => ({
		version: 1,
		id: 'glsl',
		name: 'GLSL',
		phase: 'loop',
		durationMs: 1000,
		params: [],
		nodes,
		wires,
	});
	const glow: CustomGlslDefinition = {
		code: 'glow = color.rgb * amount; // brighter\n\tcolor.rgb += glow;   ',
		inputs: [port('color', 'vec4'), port('amount', 'float', 0.5)],
		outputs: [port('color', 'vec4'), port('glow', 'vec3')],
	};
	const wire = (from: string, fromPort: string, to: string, toPort: string): GraphWire => ({
		from: { node: from, port: fromPort },
		to: { node: to, port: toPort },
	});
	const single = compileShaderGraph(
		shaded(
			[
				{ id: 's', type: 'sample', x: 0, y: 0 },
				glslNode(glow),
				{ id: 'o', type: 'output', x: 0, y: 0 },
			],
			[wire('s', 'out', 'g', 'color'), wire('g', 'color', 'o', 'color')],
		),
	);
	const expected = [
		'uniform vec4 uFx;',
		'',
		'void efxGlsl_0(inout vec4 color, float amount, out vec3 glow)',
		'{',
		'    glow = vec3(0.0, 0.0, 0.0);',
		'    glow = color.rgb * amount;',
		'        color.rgb += glow;',
		'}',
		'',
		'void main(void)',
		'{',
		'    vec2 px = efxPx();',
		'    vec2 uv = efxToUnit(px);',
		'    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);',
		'    vec4 n0_out = efxSample(efxFromUnit(uv));',
		'    vec4 n1_o0 = n0_out;',
		'    vec3 n1_o1;',
		'    efxGlsl_0(n1_o0, 0.5, n1_o1);',
		'    vec4 outColor = clamp(n1_o0, 0.0, 1.0);',
		'    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);',
		'}',
		'',
	].join('\n');
	assert(
		body(single) === expected,
		'a Custom GLSL node compiles to its function before main (inputs in, an input and output of one id inout, each output from its default) and one call where it sits (exact)',
	);
	const twice = compileShaderGraph(
		shaded(
			[
				{ id: 's', type: 'sample', x: 0, y: 0 },
				glslNode(glow, 'a', { amount: 0.25 }),
				glslNode(glow, 'b'),
				glslNode({ ...glow, code: 'glow = vec3(amount);' }, 'c'),
				glslNode({ ...glow, code: 'glow = vec3(1.0);' }, 'unused'),
				{ id: 'o', type: 'output', x: 0, y: 0 },
			],
			[
				wire('s', 'out', 'a', 'color'),
				wire('a', 'color', 'b', 'color'),
				wire('b', 'color', 'c', 'color'),
				wire('c', 'color', 'o', 'color'),
			],
		),
	);
	assert(
		twice.ok &&
			(twice.shader.body.match(/^void efxGlsl_\d+/gm) ?? []).join() ===
				'void efxGlsl_0,void efxGlsl_1' &&
			twice.shader.body.includes('efxGlsl_0(n1_o0, 0.25, n1_o1);') &&
			twice.shader.body.includes('efxGlsl_0(n2_o0, 0.5, n2_o1);') &&
			twice.shader.body.includes('efxGlsl_1(n3_o0, 0.5, n3_o1);') &&
			twice.shader.warnings.some((w) => w.code === 'unreachable' && w.node === 'unused') &&
			!lintGlsl(twice.shader.body).length,
		'two nodes of one definition share a function; another gets its own; one that reaches nothing gets none (and a warning); an unwired input reads the value set on the node',
	);
	const examples = compileShaderEffect(customGlslChain('customGlsl', CUSTOM_GLSL_EXAMPLES));
	const exampleFile = join(SNAPSHOTS, 'customGlsl.frag');
	if (UPDATE && examples.ok) writeFileSync(exampleFile, examples.effect.shader.body);
	let exampleSnapshot = '';
	try {
		exampleSnapshot = readFileSync(exampleFile, 'utf8');
	} catch {
		// no snapshot yet: the check below fails and says how to write one
	}
	assert(
		examples.ok && examples.effect.shader.body === exampleSnapshot,
		`the example nodes (tint, ripple, blur) compile to snapshots/customGlsl.frag${UPDATE ? ' (rewritten)' : exampleSnapshot ? '' : ' (missing: run with --update)'}`,
	);

	// Ports and types.
	const typed = shaded(
		[
			{ id: 'n', type: 'number', x: 0, y: 0, values: { value: 0.5 } },
			glslNode(glow),
			{ id: 'add', type: 'add', x: 0, y: 0 },
			{ id: 'join', type: 'premultiply', x: 0, y: 0 },
			{ id: 'o', type: 'output', x: 0, y: 0 },
		],
		[
			wire('n', 'out', 'g', 'color'),
			wire('g', 'glow', 'add', 'a'),
			wire('add', 'out', 'join', 'rgb'),
			wire('join', 'out', 'o', 'color'),
		],
	);
	const typedAnalysis = analyzeShaderGraph(typed);
	const typedBody = body(compileShaderGraph(typed));
	const narrow = shaded(
		[{ id: 'u', type: 'uv', x: 0, y: 0 }, glslNode(glow), { id: 'o', type: 'output', x: 0, y: 0 }],
		[wire('u', 'out', 'g', 'color'), wire('g', 'color', 'o', 'color')],
	);
	const valued = shaded(
		[glslNode(glow, 'g', { amount: [1, 2] }), { id: 'o', type: 'output', x: 0, y: 0 }],
		[wire('g', 'color', 'o', 'color')],
	);
	assert(
		typedAnalysis.outputs.g?.glow === 'vec3' &&
			typedAnalysis.inputs.g?.color === 'vec4' &&
			typedAnalysis.outputs.add?.out === 'vec3' &&
			typedBody.includes('vec4 n1_o0 = vec4(n0_out);') &&
			codes(narrow).includes('type') &&
			validateShaderGraph(narrow).some(
				(i) => i.code === 'type' && i.node === 'g' && i.port === 'color',
			) &&
			validateShaderGraph(valued).some(
				(i) => i.code === 'value' && i.node === 'g' && i.port === 'amount',
			) &&
			JSON.stringify(graphNodeDef(typed, glslNode(glow))?.outputs.map((p) => p.type)) ===
				'["vec4","vec3"]' &&
			graphNodeDef(typed, glslNode(glow), 'anySubgraph')?.type === CUSTOM_GLSL,
		'its ports are typed as declared: a float spreads into its vec4, its vec3 output types an Add, a vec2 cannot feed its vec4 and a value of the wrong width is refused, each on its port; graphNodeDef answers it in the graph and in a body',
	);

	// Subgraphs and the motion graph.
	const broken: CustomGlslDefinition = { ...glow, code: 'glow = color.rgb;\ncolor = nope;' };
	const wrapped = (inner: CustomGlslDefinition): ShaderGraphDoc => ({
		...shaded(
			[
				{ id: 'call1', type: 'subgraph', x: 0, y: 0, values: { subgraph: 'warm' } },
				{ id: 'call2', type: 'subgraph', x: 0, y: 0, values: { subgraph: 'warm' } },
				{ id: 'o', type: 'output', x: 0, y: 0 },
			],
			[wire('call1', 'out', 'call2', 'in'), wire('call2', 'out', 'o', 'color')],
		),
		subgraphs: [
			{
				id: 'warm',
				name: 'Warm',
				inputs: [port('in', 'vec4')],
				outputs: [port('out', 'vec4')],
				nodes: [
					{ id: 'i', type: 'subgraphIn', x: 0, y: 0 },
					glslNode(inner, 'inner'),
					{ id: 'j', type: 'subgraphOut', x: 0, y: 0 },
				],
				wires: [wire('i', 'in', 'inner', 'color'), wire('inner', 'color', 'j', 'out')],
			},
		],
	});
	const flat = compileShaderGraph(wrapped(glow));
	const lifted = validateShaderGraph(wrapped(broken)).filter((i) => i.code === 'glsl');
	const alone = analyzeShaderSubgraph(wrapped(broken), 'warm').issues.filter(
		(i) => i.code === 'glsl',
	);
	const moving = analyzeShaderMotion({
		...shaded([], []),
		motionGraph: { nodes: [glslNode(glow, 'm')], wires: [] },
	}).issues;
	assert(
		flat.ok &&
			(flat.shader.body.match(/^void efxGlsl_/gm) ?? []).length === 1 &&
			(flat.shader.body.match(/efxGlsl_0\(/g) ?? []).length === 3 &&
			lifted.length === 2 &&
			lifted.every((i) => i.message === 'Warm › line 2: "nope" is not declared' && i.line === 2) &&
			lifted.map((i) => i.node).join() === 'call1,call2' &&
			alone.length === 1 &&
			alone[0].node === 'inner' &&
			alone[0].line === 2 &&
			moving.some(
				(i) =>
					i.node === 'm' &&
					i.message === 'Custom GLSL works per pixel: the motion graph cannot run it',
			),
		'in a subgraph called twice it compiles flat (one function, two calls); what is wrong in it is said on each call, with its line; the body alone says it on the node; the motion graph refuses it',
	);

	// Cost: work weighed by type.
	const workOf = (code: string): number =>
		customGlslDef(
			glslNode({ code, inputs: [port('color', 'vec4')], outputs: [port('color', 'vec4')] }),
		).cost;
	const weighed = [
		['mat4 m = mat4(1.0);\nm = m * m;', 64],
		['mat2 m = mat2(1.0);\nm = m * m;', 8],
		['color = mat4(1.0) * color;', 16],
		['color.rgb = mat3(1.0) * color.rgb;', 9],
		['color = color * 2.0;', 4],
		['color.rgb = sin(color.rgb);', 12],
		['for (int i = 0; i < 8; i++) {\n    color.r += 1.0;\n}', 24],
	] as const;
	const misweighed = weighed.filter(([code, work]) => workOf(code) !== work);
	assert(
		!misweighed.length,
		`work is weighed by type: a mat4 product 64, a mat2 product 8, a mat4 by a vec4 16, a mat3 by a vec3 9, a vec4 by a number 4, sin of a vec3 12, 8 rounds of one add 24${misweighed.length ? `: ${misweighed.map(([code]) => `${JSON.stringify(code)} ${workOf(code)}`).join(', ')}` : ''}`,
	);
	// The hand-written built-in passes as bodies (their uniforms inputs, a one-line helper inlined):
	// what the cap is weighed against.
	const passes = [
		...SHADERS.matchAll(
			/export const \w+Filter = \(\): ElementFxFilter =>\s*new ElementFxFilter\(\s*'([\w-]+)',\s*`([\s\S]*?)`,/g,
		),
	].map(([, name, source]) => {
		const main = source.slice(source.indexOf('void main(void)'));
		let code = main.slice(main.indexOf('{') + 1, main.lastIndexOf('}'));
		for (const [, fn, arg, expr] of source.matchAll(
			/float (\w+)\(vec2 (\w+)\)\n\{\n {4}return ([^;]+);\n\}/g,
		))
			code = code.replace(
				new RegExp(`\\b${fn}\\((\\w+)\\)`, 'g'),
				(_, a: string) => `(${expr.replace(new RegExp(`\\b${arg}\\b`, 'g'), a)})`,
			);
		const def: CustomGlslDefinition = {
			code: code.replace(/\bfinalColor\b/g, 'outColor').replace(/\bPI\b/g, '3.14159265'),
			inputs: [...source.matchAll(/uniform (float|vec[234]) (\w+);/g)].map(([, type, id]) =>
				port(id, type as PortType),
			),
			outputs: [port('outColor', 'vec4')],
		};
		const issues = errorsOf(def).filter(
			(i) => !/longer than 600 tokens|units of work a pixel, more than/.test(i.message),
		);
		return { name, cost: customGlslDef(glslNode(def)).cost, issues };
	});
	const passCost = (name: string): number => passes.find((p) => p.name === name)?.cost ?? 0;
	assert(
		passes.length === 17 &&
			passes.every((p) => !p.issues.length) &&
			passCost('petrify') <= CUSTOM_GLSL_COST_MAX &&
			passCost('electrocute') > CUSTOM_GLSL_COST_MAX &&
			passes.every((p) => p.name === 'electrocute' || p.cost <= CUSTOM_GLSL_COST_MAX),
		`the ${passes.length} hand-written built-in passes, as bodies, check clean but for the caps; the node cap (${CUSTOM_GLSL_COST_MAX}) takes Petrify's work (${passCost('petrify')}) and every other's but Electrocute's (${passCost('electrocute')})${passes.some((p) => p.issues.length) ? `: ${passes.flatMap((p) => p.issues.map((i) => `${p.name}: ${i.message}`)).join(' | ')}` : ''}`,
	);

	// Cost.
	const heavy = (n: number): CustomGlslDefinition => ({
		code: `float s = 0.0;\nfor (int i = 0; i < 64; i++) {\n    s += sin(s + float(i) + ${n}.0) * 0.5;\n}\ncolor.r += s;`,
		inputs: [port('color', 'vec4')],
		outputs: [port('color', 'vec4')],
	});
	const reader = (n: number): CustomGlslDefinition => ({
		code: `vec4 s = vec4(0.0);\nfor (int i = 0; i < 50; i++) {\n    s += efxSample(efxPx() + vec2(float(i), ${n}.0)) + efxSample(efxPx() - vec2(float(i), 0.0));\n    s += efxSample(efxPx() + vec2(0.0, float(i))) + efxSample(efxPx() - vec2(0.0, float(i)));\n}\ncolor = s / 200.0;`,
		inputs: [port('color', 'vec4')],
		outputs: [port('color', 'vec4')],
	});
	const heavyCost = customGlslDef(glslNode(heavy(0))).cost;
	const readerReads = customGlslDef(glslNode(reader(0))).samples ?? 0;
	const tooHeavy = Math.floor(CUSTOM_GLSL_EFFECT_COST_MAX / heavyCost) + 1;
	const tooRead = Math.floor(CUSTOM_GLSL_EFFECT_SAMPLES_MAX / readerReads) + 1;
	const heavyDoc = customGlslChain(
		'heavy',
		Array.from({ length: tooHeavy }, (_, n) => heavy(n)),
	);
	const readDoc = customGlslChain(
		'read',
		Array.from({ length: tooRead }, (_, n) => reader(n)),
	);
	const fitDoc = customGlslChain(
		'fit',
		Array.from({ length: tooHeavy - 1 }, (_, n) => heavy(n)),
	);
	const blur = customGlslDef(glslNode(CUSTOM_GLSL_EXAMPLES[2]));
	const blurDoc = analyzeShaderGraph(customGlslChain('blur', [CUSTOM_GLSL_EXAMPLES[2]]));
	assert(
		[...VALID_GLSL, ...INVALID_GLSL].every((sample) => customGlslDef(glslNode(sample)).cost >= 1) &&
			blur.samples === 25 &&
			blurDoc.samples === 26 &&
			blurDoc.cost >= blur.cost &&
			readerReads === 200 &&
			validateShaderGraph(heavyDoc).some(
				(i) => i.code === 'glsl' && /units of work a pixel together/.test(i.message),
			) &&
			validateShaderGraph(readDoc).some(
				(i) => i.code === 'glsl' && /times a pixel together/.test(i.message),
			) &&
			!validateShaderGraph(fitDoc).some((i) => i.level === 'error'),
		`a body's cost is never 0 and counts its reads (the blur's 25, the graph's 26 with the Sample); ${tooHeavy} nodes of ${heavyCost} units, or ${tooRead} of ${readerReads} reads, pass what an effect's Custom GLSL may spend together (${CUSTOM_GLSL_EFFECT_COST_MAX}, ${CUSTOM_GLSL_EFFECT_SAMPLES_MAX}); one fewer fits`,
	);

	// The registry, and older runtimes.
	const effect = examples.ok ? examples.effect : undefined;
	/** `unknownEfxCalls` as runtimes from step 6 to 8b have it: blind to a pass's own functions. */
	const before8c = (code: string): string[] => {
		const names = [...code.replace(/\/\/[^\n]*/g, '').matchAll(/\b(efx[A-Z]\w*)\s*\(/g)].map(
			([, n]) => n,
		);
		const header = [
			'efxPx',
			'efxArea',
			'efxSize',
			'efxOrigin',
			'efxCenter',
			'efxToUnit',
			'efxFromUnit',
			'efxSample',
			'efxInside',
		];
		return [...new Set(names)].filter((n) => !Object.hasOwn(EFX_GLSL, n) && !header.includes(n));
	};
	const library = EFX_GLSL as Record<string, string>;
	library.efxFuture = '\n// Test only.\nfloat efxFuture(vec2 p)\n{\n    return p.x;\n}';
	const future = compileShaderEffect(
		customGlslChain('future', [{ ...glow, code: 'glow = vec3(efxFuture(color.xy));' }]),
	);
	delete library.efxFuture;
	assert(
		!!effect &&
			!unknownEfxCalls(effect.shader.body).length &&
			!!readCustomElementFx(effect) &&
			before8c(effect.shader.body).join() === 'efxGlsl_0,efxGlsl_1,efxGlsl_2' &&
			future.ok &&
			JSON.stringify(unknownEfxCalls(future.effect.shader.body)) === '["efxFuture"]' &&
			readCustomElementFx(future.effect) === undefined,
		'the registry keeps an effect with Custom GLSL (its functions are its own); a runtime from before 8c leaves it out; a new library entry is callable at once, and a runtime without it leaves the effect out',
	);

	// The signature.
	const definitions = [glow, { ...glow, code: 'glow = vec3(1.0);' }, CUSTOM_GLSL_DEFAULT];
	const signed = (order: number[], ids: string[], inBody: number): ShaderGraphDoc => ({
		...shaded(
			order
				.filter((i) => i !== inBody)
				.map((i, k) => ({ ...glslNode(definitions[i], ids[k]), x: k * 10 })),
			[],
		),
		subgraphs: [
			{
				id: 'sub',
				name: 'Sub',
				inputs: [],
				outputs: [],
				nodes: [glslNode(definitions[inBody], 'deep')],
				wires: [],
			},
		],
	});
	const base = customGlslSignature(signed([0, 1, 2], ['a', 'b'], 2));
	const changed = (edit: (d: CustomGlslDefinition) => void): boolean => {
		const doc = signed([0, 1, 2], ['a', 'b'], 2);
		edit(doc.nodes[0].glsl as CustomGlslDefinition);
		return JSON.stringify(customGlslSignature(doc)) !== JSON.stringify(base);
	};
	const added = signed([0, 1, 2], ['a', 'b'], 2);
	added.nodes.push(glslNode(glow, 'copy'));
	const removed = signed([0, 1, 2], ['a', 'b'], 2);
	removed.nodes.pop();
	assert(
		base.length === 3 &&
			JSON.stringify(customGlslSignature(signed([2, 1, 0], ['q', 'r'], 0))) ===
				JSON.stringify(base) &&
			JSON.stringify(customGlslSignature(signed([1, 0, 2], ['x', 'y'], 2))) ===
				JSON.stringify(base) &&
			JSON.stringify(
				customGlslSignature({ ...signed([0, 1, 2], ['a', 'b'], 2), subgraphs: [] }).concat(),
			) !== JSON.stringify(base) &&
			changed((d) => (d.code += ' ')) &&
			changed((d) => (d.inputs[1].id = 'amt')) &&
			changed((d) => (d.inputs[1].label = 'Amount')) &&
			changed((d) => (d.outputs[1].type = 'vec4')) &&
			changed((d) => (d.inputs[1].default = 0.6)) &&
			changed((d) => d.outputs.push(port('more', 'float'))) &&
			JSON.stringify(customGlslSignature(added)) !== JSON.stringify(base) &&
			JSON.stringify(customGlslSignature(removed)) !== JSON.stringify(base),
		'the signature is the same however the nodes are ordered, named or placed (the graph or a body), and moves with the code, a port’s id, label, type or default, a port added, a node added or removed',
	);
	const quiet = (
		[
			null,
			undefined,
			5,
			'x',
			{},
			{ nodes: 5 },
			{ nodes: [null, 5, { type: CUSTOM_GLSL }] },
			{ subgraphs: [null, { nodes: [{ type: CUSTOM_GLSL, glsl: 5 }] }] },
		] as unknown[]
	).every((raw) => {
		try {
			customGlslSignature(raw as ShaderGraphDoc);
			hasCustomGlsl(raw as ShaderGraphDoc);
			return true;
		} catch {
			return false;
		}
	});
	assert(
		hasCustomGlsl(signed([0, 1, 2], ['a', 'b'], 2)) &&
			hasCustomGlsl({ ...signed([0], ['a'], 0), nodes: [] }) &&
			![...REFERENCE_GRAPHS, ...BUILTIN_TWINS.map((t) => t.doc), ...nodeShowcase()].some(
				(doc) =>
					hasCustomGlsl(doc as ShaderGraphDoc) || customGlslSignature(doc as ShaderGraphDoc).length,
			) &&
			quiet,
		'hasCustomGlsl finds one in the graph or a body, and none in the references, twins or showcase; neither throws on a malformed doc',
	);

	// Storage.
	const stored = normalizeShaderGraphDoc(
		{
			name: 'S',
			nodes: [
				{
					id: 'g',
					type: CUSTOM_GLSL,
					glsl: {
						code: 'color = color;',
						inputs: [{ id: 'color', type: 'vec4', junk: 1 }],
						outputs: [{ id: 'color', label: 'C', type: 'vec4', default: 1 }, 5],
						extra: true,
					},
				},
				{ id: 'h', type: CUSTOM_GLSL, glsl: { code: 12, inputs: 'no' } },
				{ id: 'n', type: 'number', glsl: { code: 'x' } },
			],
		},
		'stored',
	);
	assert(
		JSON.stringify(stored.nodes.map((n) => n.glsl ?? null)) ===
			JSON.stringify([
				{
					code: 'color = color;',
					inputs: [{ id: 'color', label: 'color', type: 'vec4' }],
					outputs: [{ id: 'color', label: 'C', type: 'vec4', default: 1 }],
				},
				{ code: '', inputs: [], outputs: [] },
				null,
			]),
		'storage keeps a Custom GLSL node’s code and ports, clean (junk fields and malformed ports out, code that is not text as empty), and no definition on any other node',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('shader graph — the particle shell and the Particle node');
{
	const glslDoc = (sample: CustomGlslDefinition, id: string): ShaderGraphDoc =>
		customGlslChain(id, [sample]);
	const accepted = (sample: CustomGlslDefinition): boolean =>
		!customGlslIssues({ id: 'g', type: CUSTOM_GLSL, x: 0, y: 0, glsl: sample }).some(
			(i) => i.level === 'error',
		);

	// The node.
	const particle = shaderNode('particle');
	const helpers = {
		color: 'efxParticleColor()',
		wave: 'efxParticleWave()',
		order: 'efxParticleOrder()',
	};
	assert(
		!!particle &&
			particle.category === 'input' &&
			!particle.inputs.length &&
			!particle.settings &&
			JSON.stringify(particle.outputs.map((p) => [p.id, p.type])) ===
				'[["color","vec4"],["wave","float"],["order","float"]]' &&
			JSON.stringify(
				particle.emit({
					in: {},
					type: 'float',
					splat: (x) => x,
					setting: () => '',
					local: (_t, x) => x,
				}),
			) === JSON.stringify(helpers) &&
			!particle.motion &&
			!particle.samples &&
			particle.cost === shaderNode('seed')?.cost &&
			particle.cost === shaderNode('size')?.cost &&
			particle.cost === shaderNode('time')?.cost,
		'the Particle node: an input with Colour (vec4), Wave index and Spawn order (floats), each its header helper; no CPU form; costed as the inputs that read what the shell hands them (Seed, Element size, Time)',
	);
	const showcase = nodeShowcase();
	const showcased = showcase.filter((doc) => doc.nodes.some((n) => n.type === 'particle'));
	const seedAlone = compileShaderGraph(
		showcase.find((doc) => doc.id === 'seed-out') as ShaderGraphDoc,
	);
	const outputsCompile = showcased.map((doc) => {
		const r = compileShaderGraph(doc);
		const port = doc.id.slice('particle-'.length) as keyof typeof helpers;
		return (
			r.ok &&
			!lint(r.shader.body).length &&
			JSON.stringify(r.shader.uniforms.map((u) => u.name)) === '["uFx"]' &&
			seedAlone.ok &&
			r.shader.cost === seedAlone.shader.cost &&
			r.shader.samples === 0 &&
			Object.entries(helpers).every(([id, call]) => r.shader.body.includes(call) === (id === port))
		);
	});
	assert(
		showcased.map((d) => d.id).join() === 'particle-color,particle-wave,particle-order' &&
			outputsCompile.every(Boolean),
		'each of its outputs compiles alone and links, calling its own helper and no other, reading nothing of the element, costing what the Seed alone does',
	);
	const elementHeader = (SHADERS.split('const HEADER')[1] ?? '').split('`;')[0];
	assert(
		elementHeader.includes('vec4 efxParticleColor() { return vec4(1.0); }') &&
			elementHeader.includes('float efxParticleWave() { return 0.0; }') &&
			elementHeader.includes('float efxParticleOrder() { return 0.0; }') &&
			HEADER_HELPERS.length === EFX_HEADER_FUNCTIONS.length,
		'on an element it reads white and opaque, 0 and 0: the element header’s helpers (`shader-compile` draws them)',
	);
	const moved = analyzeShaderMotion({
		...REFERENCE_GRAPHS[0],
		motionGraph: {
			nodes: [
				{ id: 'p', type: 'particle', x: 0, y: 0 },
				{ id: 'out', type: 'motionOutput', x: 0, y: 0 },
			],
			wires: [{ from: { node: 'p', port: 'wave' }, to: { node: 'out', port: 'x' } }],
		},
	});
	assert(
		!isMotionNode('particle') &&
			moved.issues.some((i) => i.node === 'p' && i.level === 'error' && i.graph === 'motion') &&
			!compileShaderEffect({
				...REFERENCE_GRAPHS[0],
				motionGraph: {
					nodes: [
						{ id: 'p', type: 'particle', x: 0, y: 0 },
						{ id: 'out', type: 'motionOutput', x: 0, y: 0 },
					],
					wires: [{ from: { node: 'p', port: 'wave' }, to: { node: 'out', port: 'x' } }],
				},
			}).ok,
		'the motion graph refuses it, so the effect does not compile',
	);
	const inline = graphBuilder({
		id: 'inline',
		name: 'Inline',
		phase: 'emphasis',
		durationMs: 1000,
	});
	inline.wire(inline.node('particle'), 'color', inline.node('output'), 'color');
	const inlined = inline.doc();
	const called: ShaderGraphDoc = {
		...inlined,
		id: 'called',
		subgraphs: [
			{
				id: 'body',
				name: 'Body',
				inputs: [],
				outputs: [{ id: 'color', label: 'Colour', type: 'vec4' }],
				nodes: [
					{ id: 'in', type: 'subgraphIn', x: 0, y: 0 },
					{ id: 'p', type: 'particle', x: 0, y: 0 },
					{ id: 'out', type: 'subgraphOut', x: 0, y: 0 },
				],
				wires: [{ from: { node: 'p', port: 'color' }, to: { node: 'out', port: 'color' } }],
			},
		],
		nodes: [
			{ id: 'call', type: 'subgraph', x: 0, y: 0, values: { subgraph: 'body' } },
			...inlined.nodes.filter((n) => n.type === 'output'),
		],
		wires: [
			{
				from: { node: 'call', port: 'color' },
				to: { node: inlined.nodes.find((n) => n.type === 'output')?.id ?? '', port: 'color' },
			},
		],
	};
	const inlineBody = body(compileShaderGraph(inlined));
	assert(
		inlineBody.includes('efxParticleColor()') &&
			canonical(body(compileShaderGraph(called))) === canonical(inlineBody),
		'in a subgraph body it compiles as it does in the graph',
	);

	// Nothing else moves: the corpus compiles the same with a Particle node beside it.
	const samples = [
		...VALID_GLSL,
		...Array.from({ length: 200 }, (_, n) => generatedGlsl(5, n)),
		...Array.from({ length: 700 }, (_, n) => mutatedGlsl(13, n)).filter(accepted),
		...nearMissGlsl().filter(accepted),
	];
	const corpus = [
		...REFERENCE_GRAPHS,
		...BUILTIN_TWINS.map((t) => t.doc as ShaderGraphDoc),
		...showcase.filter((doc) => !showcased.includes(doc)),
		customGlslChain('examples', [...CUSTOM_GLSL_EXAMPLES]),
		...samples.map((sample, i) => glslDoc(sample, `sample${i}`)),
	];
	const besides = corpus.filter((doc) => {
		const before = compileShaderGraph(doc);
		const withNode = {
			...doc,
			nodes: [...doc.nodes, { id: 'particleProbe', type: 'particle', x: 0, y: 0 }],
		};
		const after = compileShaderGraph(withNode);
		const a = analyzeShaderGraph(doc);
		const b = analyzeShaderGraph(withNode);
		delete b.inputs.particleProbe;
		delete b.outputs.particleProbe;
		const shader = (r: CompileResult) =>
			JSON.stringify(r.ok && [r.shader.body, r.shader.uniforms, r.shader.cost, r.shader.samples]);
		return (
			shader(before) !== shader(after) ||
			JSON.stringify([a.inputs, a.outputs, a.cost, a.samples]) !==
				JSON.stringify([b.inputs, b.outputs, b.cost, b.samples])
		);
	});
	assert(
		corpus.length > 800 && !besides.length,
		`${corpus.length} docs (references, twins, the node showcase, the Custom GLSL samples) compile to the same shader and analyse to the same types and cost with a Particle node beside them${besides.length ? `: not ${besides.map((d) => d.id).join(', ')}` : ''}`,
	);

	// The shell's text: its attributes and varyings, against WebGL1's guarantees.
	const declared = (source: string, qualifier: string) =>
		[...source.matchAll(new RegExp(`^${qualifier}\\s+(\\w+)\\s+(\\w+)\\s*;`, 'gm'))].map((m) => ({
			type: m[1],
			name: m[2],
		}));
	const attributes = declared(PARTICLE_VERTEX, 'in');
	const varyings = declared(PARTICLE_VERTEX, 'out');
	const rows = varyings.reduce(
		(sum, v) =>
			sum + (/^mat([234])$/.exec(v.type)?.[1] ? Number(/^mat([234])$/.exec(v.type)?.[1]) : 1),
		0,
	);
	assert(
		attributes.length <= 8 &&
			rows <= 8 &&
			JSON.stringify(PARTICLE_ATTRIBUTES) ===
				JSON.stringify(attributes.map((a) => ({ name: a.name, size: DIMS[a.type as PortType] }))) &&
			!/\bgl_FragCoord\b|\bgl_PointCoord\b/.test(PARTICLE_VERTEX + PARTICLE_HEADER),
		`the vertex shader takes ${attributes.length} attributes and hands on ${rows} varying rows, within WebGL1's guaranteed 8 and 8; PARTICLE_ATTRIBUTES is its attributes`,
	);
	const fragmentInputs = declared(PARTICLE_HEADER, 'in');
	assert(
		fragmentInputs.every((v) => varyings.some((o) => o.name === v.name && o.type === v.type)) &&
			['uFx:vec4', 'uSeed:float'].every((v) => varyings.some((o) => `${o.name}:${o.type}` === v)) &&
			PARTICLE_HEADER.includes('\nout vec4 finalColor;\n'),
		'every varying the fragment header reads, and the body’s time and seed, are ones the vertex shader writes, of the same type',
	);
	const headerDefined = [
		...PARTICLE_HEADER.matchAll(/^(?:vec[234]|float|bool)\s+(efx\w+)\s*\(/gm),
	].map((m) => m[1]);
	assert(
		[...headerDefined].sort().join() === [...EFX_HEADER_FUNCTIONS].sort().join(),
		`the particle header defines every pass-header helper (${headerDefined.length})`,
	);
	const globals = [
		...[PARTICLE_VERTEX, PARTICLE_HEADER].flatMap((source) => [
			...[...source.matchAll(/^(?:in|out|uniform|const)\s+\w+\s+(\w+)/gm)].map((m) => m[1]),
			...[...source.matchAll(/^(?:void|bool|float|vec[234]|mat[234])\s+(\w+)\s*\(/gm)].map(
				(m) => m[1],
			),
		]),
		'efxParticleBody',
	];
	const open = [...new Set([...globals, ...PARTICLE_SHELL_NAMES])].filter(
		(name) => name !== 'main' && !customGlslNameIssue(name),
	);
	assert(
		globals.length > 30 && !open.length,
		`every global name the particle shell declares (${new Set(globals).size}) is out of a Custom GLSL port's or local's reach${open.length ? `: not ${open.join(', ')}` : ''}`,
	);

	// Every compiled body the gates know converts.
	const particleCalls = (fragment: string): string[] => {
		const code = fragment.replace(/\/\/[^\n]*/g, '');
		const defined = new Set(
			[...code.matchAll(/^(?:void|bool|float|vec[234]|mat[234])\s+(\w+)\s*\(/gm)].map((m) => m[1]),
		);
		return [
			...new Set(
				[...code.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)]
					.map((m) => m[1])
					.filter(
						(c) => !defined.has(c) && !ES1_CALLS.has(c) && !KEYWORDS.has(c) && c !== 'texture',
					),
			),
		];
	};
	const converted = [
		...corpus,
		...showcased,
		...PARTICLE_GLSL.map((sample, i) => glslDoc(sample, `particle${i}`)),
	].map((doc) => {
		const r = compileShaderEffect(doc);
		if (!r.ok) return { doc, problem: 'does not compile' };
		const { body: source, uniforms } = r.effect.shader;
		const fragment = particleShellSource(r.effect);
		if (!fragment) return { doc, problem: 'not converted' };
		const owned = /\befxParticleColor\s*\(/.test(source.replace(/\/\/[^\n]*/g, ''));
		const time = uniforms.some((u) => u.source.kind === 'time');
		const seed = uniforms.some((u) => u.source.kind === 'seed');
		const problems = [
			!fragment.startsWith(PARTICLE_HEADER) && 'no header',
			/\buniform\s+\w+\s+(?:uFx|uSeed)\b/.test(fragment) && 'a time or seed uniform left',
			fragment.includes('\nin vec4 uFx;\n') !== time && 'uFx',
			fragment.includes('\nin float uSeed;\n') !== seed && 'uSeed',
			!uniforms
				.filter((u) => u.source.kind === 'param')
				.every((u) => fragment.includes(`\nuniform ${u.type} ${u.name};\n`)) &&
				'a param uniform lost',
			(fragment.match(/^void main\(void\)$/gm) ?? []).length !== 1 && 'not one main',
			(fragment.match(/^void efxParticleBody\(void\)$/gm) ?? []).length !== 1 && 'not one body',
			!fragment.endsWith(
				`void main(void)\n{\n    efxParticleBody();\n    finalColor *= ${owned ? '' : 'efxParticleColor() * '}uColor * uWorldColorAlpha;\n}\n`,
			) && 'not the colour rule',
			...particleCalls(fragment).map((c) => `calls ${c}, which nothing defines`),
		].filter(Boolean);
		return { doc, problem: problems.join(', '), owned };
	});
	const unconverted = converted.filter((c) => c.problem);
	const owners = converted.filter((c) => c.owned).map((c) => c.doc.id);
	assert(
		converted.length > 800 && !unconverted.length,
		`every compiled body the gates know converts (${converted.length}: references, twins, the node showcase, the Custom GLSL samples): the time and seed made varyings, the params kept, the body's main called by the shell's, the library linked${
			unconverted.length
				? `: not ${unconverted
						.slice(0, 8)
						.map((c) => `${c.doc.id} (${c.problem})`)
						.join(', ')}`
				: ''
		}`,
	);
	assert(
		owners.join() === 'particle-color,particle0',
		`the colour rule: only a body reading the particle's colour owns it (${owners.join(', ')}); every other is tinted and faded after`,
	);

	// What it refuses.
	const twin = BUILTIN_TWINS.map((t) => compileShaderEffect(t.doc as ShaderGraphDoc)).find(
		(r) => r.ok && r.effect.shader.uniforms.some((u) => u.source.kind === 'seed'),
	);
	const effect = twin?.ok ? twin.effect : undefined;
	const shader = effect?.shader ?? { body: '', uniforms: [] };
	const withBody = (edit: (b: string) => string, uniforms = shader.uniforms) => ({
		shader: { body: edit(shader.body), uniforms },
	});
	const renamed = shader.uniforms.map((u) =>
		u.source.kind === 'time' ? { ...u, name: 'uTime' } : u,
	);
	const refusals: [string, ReturnType<typeof withBody>][] = [
		['a preprocessor line', withBody((b) => `#define X 1.0\n${b}`)],
		['a backslash', withBody((b) => b.replace('{', '{ \\'))],
		['an unended comment', withBody((b) => `${b}/* never closed`)],
		['the time under another name', withBody((b) => b.replace(/\buFx\b/g, 'uTime'), renamed)],
		[
			'the time of another type',
			withBody(
				(b) => b,
				shader.uniforms.map((u) =>
					u.source.kind === 'time' ? { ...u, type: 'vec3' as const } : u,
				),
			),
		],
		[
			'the seed reported as a param',
			withBody(
				(b) => b,
				shader.uniforms.map((u) =>
					u.source.kind === 'seed' ? { ...u, source: { kind: 'param' as const, id: 'x' } } : u,
				),
			),
		],
		['two uniforms of one name', withBody((b) => b, [...shader.uniforms, shader.uniforms[0]])],
		[
			'a source of no known kind',
			withBody(
				(b) => b,
				[
					...shader.uniforms,
					{
						name: 'uOther',
						type: 'float',
						source: { kind: 'other' },
					} as unknown as (typeof shader.uniforms)[number],
				],
			),
		],
		[
			'the time declared in another form',
			withBody((b) => b.replace('uniform vec4 uFx;', 'uniform  vec4 uFx;')),
		],
		[
			'the time declared twice',
			withBody((b) => b.replace('uniform vec4 uFx;', 'uniform vec4 uFx;\nuniform vec4 uFx;')),
		],
		[
			'a local of the time’s name',
			withBody((b) =>
				b.replace('void main(void)\n{', 'void main(void)\n{\n    vec4 uFx = vec4(0.0);'),
			),
		],
		[
			'the time named with no time source',
			withBody(
				(b) => b,
				shader.uniforms.filter((u) => u.source.kind !== 'time'),
			),
		],
		[
			'the seed named with no seed source',
			withBody(
				(b) => b.replace('uniform float uSeed;', ''),
				shader.uniforms.filter((u) => u.source.kind !== 'seed'),
			),
		],
		[
			'a shell varying read',
			withBody((b) =>
				b.replace('void main(void)\n{', 'void main(void)\n{\n    vec4 v = vEfxColor;'),
			),
		],
		[
			'a shell uniform read',
			withBody((b) => b.replace('void main(void)\n{', 'void main(void)\n{\n    vec4 v = uColor;')),
		],
		[
			'an element pass name read',
			withBody((b) =>
				b.replace('void main(void)\n{', 'void main(void)\n{\n    vec2 v = vTextureCoord;'),
			),
		],
		['the shell’s body name taken', withBody((b) => `void efxParticleBody(void) {}\n${b}`)],
		['no main', withBody((b) => b.replace('void main(void)', 'void mainly(void)'))],
		['main in another form', withBody((b) => b.replace('void main(void)', 'void main()'))],
		['two mains', withBody((b) => `${b}\nvoid main(void)\n{\n}\n`)],
		['no finalColor', withBody((b) => b.replace(/\bfinalColor\b/g, 'gl_FragColor'))],
	];
	const taken = refusals
		.filter(([, e]) => particleShellSource(e) !== undefined)
		.map(([label]) => label);
	const comments = particleShellSource(
		withBody(
			(b) =>
				`// uniform vec4 uFx;\n/* void main(void)\nuniform float uSeed; */\n${b}// void main(void)\n`,
		),
	);
	assert(
		!!effect &&
			!!particleShellSource(effect) &&
			!taken.length &&
			!!comments &&
			!comments.includes('// uniform vec4 uFx;') &&
			(comments.match(/^in vec4 uFx;$/gm) ?? []).length === 1 &&
			(comments.match(/^in float uSeed;$/gm) ?? []).length === 1 &&
			(comments.match(/^void main\(void\)$/gm) ?? []).length === 1 &&
			(comments.match(/^void efxParticleBody\(void\)$/gm) ?? []).length === 1,
		`a body it cannot convert surely is refused (${refusals.length - taken.length} of ${refusals.length}: ${refusals.map(([l]) => l).join('; ')}); comments neither hide nor fake a declaration or a main${taken.length ? `: taken ${taken.join(', ')}` : ''}`,
	);

	// Custom GLSL calls the helpers, typed.
	const typed = [
		'float c = efxParticleColor();\ncolor = color;',
		'vec4 w = efxParticleWave();\ncolor = color;',
		'color = efxParticleOrder(color);',
	].map((code) => accepted({ ...CUSTOM_GLSL_DEFAULT, code }));
	assert(
		PARTICLE_GLSL.every(accepted) && typed.every((ok) => !ok),
		'a Custom GLSL body calls the three helpers, typed by their signatures (a vec4, a float, a float, no arguments)',
	);
}

console.log(
	failures
		? `\nshader graph: ${failures} check(s) FAILED`
		: `\nshader graph: all ${passes} checks passed`,
);
if (failures) process.exit(1);
