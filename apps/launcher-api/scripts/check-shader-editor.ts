/**
 * Contract check for Invisible Shader Graph's editing model (`/shaders`,
 * `src/routes/(app)/shaders/shaderEditor.ts`): every gesture is a pure doc → doc, and the docs it
 * builds are ones the compiler takes.
 *
 *   1. A new graph compiles, and draws the element as it is.
 *   2. Building a graph from the gestures (add, wire, set a value, a param, a pass, motion) gives a
 *      doc that compiles; an input takes one wire; removing a node takes its wires; the Output
 *      stays.
 *   3. The wire rule is the compiler's: a float spreads, a vector narrows, a shorter vector never
 *      widens, nothing feeds itself, an input that follows its node's type takes anything, and no
 *      wire is taken that the compiler then refuses (a type it sets elsewhere, a loop).
 *   4. The canvas shows each node's errors on it, the resolved port types and the wired inputs,
 *      even while the effect has an error of its own; read-only, nothing on it can change.
 *   5. The client's id is the store's: `slugOf` agrees with the server's `shaderSlug`.
 *   6. Start from a built-in: a twin starts a graph that keeps its build under a new id, and the
 *      New menu lists every twin once, by the catalog's families.
 *   7. Node thumbnails: a node's probe is its upstream with an Output showing its output made
 *      visible (a float grey, a vec2 as x, y, 0, a vec3 opaque, a vec4 as it is), through library
 *      nodes; every node of every twin and reference graph gets one that compiles; an unrelated
 *      broken node spoils none, one upstream does; flat nodes and the Output get none; a key per
 *      probe changes with the node and what feeds it only; the live ones are those on screen,
 *      selected first then nearest the centre, capped.
 *   8. The cost on the canvas: each node reaching the Output carries its cost and reads, which
 *      sum to the analysis' total; one reaching nothing, or any while the graph cannot be walked,
 *      carries none; the chip's weight reads against the phone budget.
 *   9. Subgraphs: grouping a selection and ungrouping the call gives back byte-identical GLSL over
 *      seeded selections of every reference graph and twin, and the group itself compiles to the
 *      same shader (its port pass-throughs read through), cost and reads. The group's inputs and
 *      outputs are one per output crossing it, typed as the analysis resolved them. Every gesture
 *      works inside a subgraph and lands in its body; the canvas and the wire rule there are the
 *      body's (its Input and Output pinned, its errors on its nodes, outside on the call). A
 *      subgraph still called is not deleted unless its calls go too; ungrouping its last call drops
 *      it; a body cannot call itself or a caller; ports follow every call; storage keeps it all.
 *  10. The motion graph: viewing it changes nothing; its first node brings its Output; every gesture
 *      (add, wire, move, set a value, select, delete) lands in it and nowhere else, its node ids
 *      never the pixel graph's; wires join floats alone; its Output stays while other nodes do and
 *      goes with the last; deleting the whole graph leaves the rest of the doc; each step leaves the
 *      doc it was given, so undo is the doc before; its errors show on its nodes and count; read-only
 *      nothing changes; subgraph gestures are off there; the palette offers motion nodes only; the
 *      channels it drives are named for the settings; each node's curve is its value over the play,
 *      keyed like a thumbnail; a param renamed is followed there; storage keeps it.
 *  11. The Break Output: the palette offers it in the effect's own graph while it has none (greyed
 *      out in a subgraph, saying why; never in the motion graph); it adds and deletes; its header
 *      names the break, its ports are the break's params, with no thumbnail or cost chip; a kind
 *      change drops what the new break lacks, resets values past its ranges and keeps Number wires
 *      past them as errors, in one step, its notice naming each; the wire
 *      rule is the engine's over every source and port kind, and the canvas says why a port
 *      refuses a wire; each unwired port shows its value as the break reads it, and is set as the
 *      break stores it; the phase the break needs is one fix away; Starts at reads in ms; no gesture
 *      changes the doc it was given (undo); read-only nothing changes; a group never takes it or
 *      what feeds it; the six break twins start effects; storage keeps it.
 *
 *   pnpm --filter launcher-api check:shader-editor
 */
import {
	ELEMENT_FX_CATEGORIES,
	elementFxSpec,
	isCustomElementFxKind,
} from 'constants-shared/elementFx';
import {
	BREAK_AT_DEFAULT,
	BREAK_KINDS,
	BREAK_KIND_DEFAULT,
	BREAK_OUTPUT,
	BUILTIN_TWINS,
	COST_BUDGET,
	MOTION_NODE_TYPES,
	MOTION_OUTPUT,
	REFERENCE_GRAPHS,
	SAMPLE_BUDGET,
	SHADER_NODES,
	analyzeShaderGraph,
	analyzeShaderMotion,
	compileShaderEffect,
	compileShaderGraph,
	isBreakTwin,
	isMotionNode,
	readBreakValue,
	normalizeShaderGraphDoc,
	shaderNode,
	type ShaderGraphDoc,
} from 'engine-shadergraph';
import { shaderSlug } from '../src/lib/server/projectPaths.ts';
import {
	BREAK_CHOICES,
	BREAK_NOT_IN_SUBGRAPH,
	BREAK_ONLY_ONE,
	BREAK_PIXEL_ONLY,
	COST_WEIGHTS,
	CURVE_SAMPLES,
	FLAT_NODES,
	MOTION_SCOPE,
	SUBGRAPHS_PIXEL_ONLY,
	addCall,
	addNode,
	addNodeIn,
	addParam,
	addPass,
	addSubgraphPort,
	analyzeScope,
	breakEdgeMs,
	breakFeedRefusal,
	breakKindNotice,
	breakOutputOf,
	breakPaletteEntry,
	breakPhaseMismatch,
	breakPlacement,
	breakPortSources,
	breakPortValue,
	breakPortValues,
	canConnect,
	canPlace,
	canvasGraph,
	connect,
	costWeight,
	curvePoint,
	deleteMotionGraph,
	deleteSubgraph,
	docFromTwin,
	docIssues,
	drivenChannels,
	groupNodes,
	groupRefusal,
	groupable,
	hasMotionCurve,
	hasThumbnail,
	inScope,
	isMotionScope,
	libraryGroups,
	liveThumbs,
	missingBoundary,
	motionAnalysis,
	motionCurves,
	moveNode,
	newShaderDoc,
	nodeCosts,
	probeDoc,
	probeKeys,
	remove,
	removeParam,
	removePass,
	removeSubgraphPort,
	renameSubgraph,
	restCurve,
	setMotionChannel,
	setNodeValue,
	setBreakAt,
	setBreakKind,
	setBreakValue,
	setParam,
	setPass,
	setPhase,
	setPivot,
	setSubgraphPort,
	slugOf,
	subgraphCalls,
	subgraphRows,
	subgraphScope,
	twinGroups,
	undrivenChannels,
	ungroupCall,
	ungroupRefusal,
	viewOf,
	wireId,
} from '../src/routes/(app)/shaders/shaderEditor.ts';

let failures = 0;
let checks = 0;
const json = (value: unknown): string => JSON.stringify(value);
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	if (json(actual) === json(expected)) return;
	failures += 1;
	console.log(
		`FAIL  ${label}\n        expected ${json(expected)}\n        actual   ${json(actual)}`,
	);
};
const errors = (doc: ShaderGraphDoc): string[] =>
	analyzeShaderGraph(doc)
		.issues.filter((i) => i.level === 'error')
		.map((i) => i.message);

// ── 1 ──
console.log('1. a new graph');
const fresh = newShaderDoc('glow', 'Glow');
check('compiles', compileShaderEffect(fresh).ok, true);
check('as the element itself, read once', compileShaderGraph(fresh).ok, true);

// ── 2 ──
console.log('2. building one');
let doc = fresh;
const sample = addNode(doc, 'sample', { x: -900, y: 0 });
doc = sample.doc;
check('a node gets an id of its type', sample.id, 'sample1');
check('…and the next one the next', addNode(doc, 'sample', { x: 0, y: 0 }).id, 'sample2');
check(
	'an unknown type still lands (the validator names it)',
	addNode(doc, 'nope', { x: 0, y: 0 }).id,
	'nope1',
);
const split = addNode(doc, 'unpremultiply', { x: -700, y: 0 });
const tint = addNode(split.doc, 'colorize', { x: -500, y: 0 });
const join = addNode(tint.doc, 'premultiply', { x: -300, y: 0 });
const fade = addNode(join.doc, 'fade', { x: -150, y: 0 });
doc = fade.doc;
doc = connect(doc, { node: sample.id, port: 'out' }, { node: split.id, port: 'color' });
doc = connect(doc, { node: split.id, port: 'rgb' }, { node: tint.id, port: 'rgb' });
doc = connect(doc, { node: tint.id, port: 'out' }, { node: join.id, port: 'rgb' });
doc = connect(doc, { node: split.id, port: 'alpha' }, { node: join.id, port: 'alpha' });
doc = connect(doc, { node: join.id, port: 'out' }, { node: fade.id, port: 'color' });
doc = connect(doc, { node: fade.id, port: 'out' }, { node: 'out', port: 'color' });
const firstWire = doc.wires.length;
doc = connect(doc, { node: fade.id, port: 'out' }, { node: 'out', port: 'color' });
check('an input takes one wire: wiring it again replaces it', doc.wires.length, firstWire);
doc = addParam(doc, 'color');
check(
	'a param gets a fresh id',
	doc.params.map((p) => p.id),
	['color1'],
);
doc = setParam(doc, 0, { ...doc.params[0], label: 'Tint' } as ShaderGraphDoc['params'][number]);
check('…and keeps an edit', doc.params[0].label, 'Tint');
const param = addNode(doc, 'param', { x: -700, y: 160 });
doc = setNodeValue(param.doc, param.id, 'param', 'color1');
doc = connect(doc, { node: param.id, port: 'out' }, { node: tint.id, port: 'tint' });
doc = setNodeValue(doc, fade.id, 'amount', 0.5);
check(
	'a value is stored on the node',
	doc.nodes.find((n) => n.id === fade.id)?.values?.amount,
	0.5,
);
check(
	'…and cleared back to its default',
	setNodeValue(doc, fade.id, 'amount', undefined).nodes.find((n) => n.id === fade.id)?.values,
	undefined,
);
doc = addPass(doc);
doc = setPass(doc, 0, { kind: 'glow', params: { color: { param: 'color1' } } });
doc = setMotionChannel(doc, 'scale', restCurve('scale'));
doc = setPivot(doc, { x: 0.5, y: 1 });
check('the graph built from gestures compiles', errors(doc), []);
check('…to an effect', compileShaderEffect(doc).ok, true);
check(
	'a rest curve moves nothing',
	restCurve('rotation').every((k) => k.v === 0),
	true,
);
const renamed = setParam(doc, 0, {
	...doc.params[0],
	id: 'tint',
} as ShaderGraphDoc['params'][number]);
check(
	'renaming a param takes its Param nodes and pass ties with it',
	[
		renamed.nodes.find((n) => n.id === param.id)?.values?.param,
		renamed.passes?.[0].params?.color,
		errors(renamed),
	],
	['tint', { param: 'tint' }, []],
);
check(
	'clearing the last motion channel drops the motion',
	setMotionChannel(doc, 'scale', undefined).motion,
	undefined,
);
check('removing the last pass drops the passes', removePass(doc, 0).passes, undefined);
check(
	'removing a param a node reads is the validator’s to name',
	errors(removeParam(doc, 0)).length > 0,
	true,
);
const cut = remove(doc, [tint.id]);
check(
	'removing a node takes its wires',
	cut.wires.some((w) => w.from.node === tint.id || w.to.node === tint.id),
	false,
);
check(
	'removing a wire by id takes only it',
	remove(doc, [], [wireId(doc.wires[0])]).wires.length,
	doc.wires.length - 1,
);
check(
	'a move lands on whole pixels',
	moveNode(doc, tint.id, 10.6, -3.2).nodes.find((n) => n.id === tint.id)?.x,
	11,
);
check(
	'the Output never goes: the library cannot add one back',
	remove(doc, ['out']).nodes.some((n) => n.id === 'out'),
	true,
);
check('no gesture changes the doc it was given', fresh.nodes.length, 1);
check(
	'the library lists every family but leaves the Output out',
	libraryGroups().some((g) => g.nodes.some((n) => n.type === 'output')),
	false,
);

// ── 3 ──
console.log('3. the wire rule');
let wiring = newShaderDoc('w', 'W');
const f = addNode(wiring, 'number', { x: 0, y: 0 });
wiring = f.doc;
const uv = addNode(wiring, 'uv', { x: 0, y: 0 });
wiring = uv.doc;
const reader = addNode(wiring, 'sample', { x: 0, y: 0 });
wiring = reader.doc;
const a = analyzeShaderGraph(wiring);
check(
	'a float spreads into a colour',
	canConnect(wiring, a, { node: f.id, port: 'out' }, { node: 'out', port: 'color' }),
	true,
);
check(
	'a vec2 never widens into a colour',
	canConnect(wiring, a, { node: uv.id, port: 'out' }, { node: 'out', port: 'color' }),
	false,
);
check(
	'nothing feeds itself',
	canConnect(wiring, a, { node: reader.id, port: 'out' }, { node: reader.id, port: 'uv' }),
	false,
);
const add = addNode(wiring, 'add', { x: 0, y: 0 });
check(
	'an input that follows its node’s type takes anything',
	canConnect(
		add.doc,
		analyzeShaderGraph(add.doc),
		{ node: uv.id, port: 'out' },
		{ node: add.id, port: 'a' },
	),
	true,
);
const fed = connect(
	connect(add.doc, { node: reader.id, port: 'out' }, { node: add.id, port: 'a' }),
	{ node: add.id, port: 'out' },
	{ node: 'out', port: 'color' },
);
check(
	'a vec2 into an input whose node a vec4 already sets is the compiler’s type error: refused',
	canConnect(
		fed,
		analyzeShaderGraph(fed),
		{ node: uv.id, port: 'out' },
		{ node: add.id, port: 'b' },
	),
	false,
);
const add2 = addNode(fed, 'add', { x: 0, y: 0 });
const chained = connect(add2.doc, { node: add.id, port: 'out' }, { node: add2.id, port: 'a' });
check(
	'a wire that closes a loop through other nodes: refused',
	canConnect(
		chained,
		analyzeShaderGraph(chained),
		{ node: add2.id, port: 'out' },
		{ node: add.id, port: 'b' },
	),
	false,
);
check(
	'…while the same port takes a wire that keeps the graph sound',
	canConnect(
		chained,
		analyzeShaderGraph(chained),
		{ node: f.id, port: 'out' },
		{ node: add.id, port: 'b' },
	),
	true,
);
check(
	'an unknown port takes nothing',
	canConnect(wiring, a, { node: f.id, port: 'out' }, { node: 'out', port: 'nope' }),
	false,
);

// ── 4 ──
console.log('4. the canvas');
const broken = connect(doc, { node: param.id, port: 'out' }, { node: 'missing', port: 'x' });
const view = canvasGraph(broken, analyzeShaderGraph(broken), new Set([tint.id]));
check('every node is drawn', view.nodes.length, broken.nodes.length);
check(
	'the selected node is selected',
	view.nodes.filter((n) => n.selected).map((n) => n.id),
	[tint.id],
);
check('the wired inputs are marked', view.nodes.find((n) => n.id === tint.id)?.data.wired.sort(), [
	'rgb',
	'tint',
]);
check(
	'a param node reads as its param',
	view.nodes.find((n) => n.id === param.id)?.data.summary,
	'Tint',
);
check(
	'a wire to a node the graph lacks is the effect’s error, so it shows',
	docIssues(broken, analyzeShaderGraph(broken)),
	['a wire ends at a node the graph does not have'],
);
check(
	'…and no drawn node carries it',
	view.nodes.some((n) => n.data.errors.length > 0),
	false,
);
const locked = canvasGraph(doc, analyzeShaderGraph(doc), new Set(), true);
check(
	'read-only, nothing on the canvas moves, wires or deletes',
	[...locked.nodes, ...locked.edges].some(
		(e) => e.deletable || ('draggable' in e && (e.draggable || e.connectable)),
	),
	false,
);
const typed = canvasGraph(doc, analyzeShaderGraph(doc), new Set([tint.id, fade.id]));
check(
	'a selection of several stays several',
	typed.nodes.filter((n) => n.selected).map((n) => n.id),
	[tint.id, fade.id],
);
check(
	'…and when it is not, everything but the Output deletes',
	typed.nodes.filter((n) => !n.deletable).map((n) => n.id),
	['out'],
);
check(
	'an output’s resolved type colours its wire',
	typed.edges.every((e) => e.style.startsWith('stroke:#')),
	true,
);
const badValue = setNodeValue(doc, fade.id, 'amount', [1, 2, 3]);
const badView = canvasGraph(badValue, analyzeShaderGraph(badValue), new Set());
check(
	'a node’s own error shows on it',
	(badView.nodes.find((n) => n.id === fade.id)?.data.errors.length ?? 0) > 0,
	true,
);

const unnamed = analyzeShaderGraph({ ...doc, name: '' });
check(
	'a blank name is an error, and the rest is still worked out: types, cost',
	[
		unnamed.issues.some((i) => i.level === 'error'),
		unnamed.outputs[fade.id]?.out,
		unnamed.cost > 0,
	],
	[true, 'vec4', true],
);
const unpicked = addNode(doc, 'param', { x: 0, y: 0 });
check(
	'a Param node with none picked asks for one',
	analyzeShaderGraph(unpicked.doc).issues.find((i) => i.node === unpicked.id)?.message,
	"Param needs one of the effect's params picked",
);

// ── 5 ──
console.log('5. ids');
for (const name of ['Glow', 'Power Up!', '__x', '---', '', 'Ünïcode', 'a'.repeat(90), 'x/../y']) {
	check(`the client keys "${name}" as the store does`, slugOf(name), shaderSlug(name));
	check(`…a valid custom kind`, isCustomElementFxKind(`custom:${slugOf(name)}`), true);
}

// ── 6 ──
console.log('6. start from a built-in');
const powerUp = REFERENCE_GRAPHS.find((g) => g.id === 'powerUp') as ShaderGraphDoc;
const frost = REFERENCE_GRAPHS.find((g) => g.id === 'frost') as ShaderGraphDoc;
for (const kind of ['glow', 'bounce3D', 'melt'] as const) {
	const twin = BUILTIN_TWINS.find((t) => t.kind === kind);
	if (!twin) {
		check(`the ${kind} twin exists`, false, true);
		continue;
	}
	const started = docFromTwin(twin, `my_${kind}`, `My ${kind}`);
	check(
		`starting from ${kind} keeps its build under the new id and name`,
		[
			started.id,
			started.name,
			json(started.nodes) === json(twin.doc.nodes),
			json(started.params) === json(twin.doc.params),
			json(started.passes) === json(twin.doc.passes),
			json(started.motion) === json(twin.doc.motion),
			json(started.motionGraph) === json(twin.doc.motionGraph),
			started.padding === twin.doc.padding,
		],
		[`my_${kind}`, `My ${kind}`, true, true, true, true, true, true],
	);
	check('…compiles', compileShaderEffect(started).ok, true);
	check('…and leaves the twin as it was', twin.doc.id, kind);
}
const has = (kind: string, key: 'passes' | 'motion' | 'motionGraph' | 'padding'): boolean =>
	BUILTIN_TWINS.find((t) => t.kind === kind)?.doc[key] !== undefined;
check(
	'…which carry what is to keep: passes (glow), a motion graph (bounce 3D, melt), curves (melt), padding (flip)',
	[
		has('glow', 'passes'),
		has('bounce3D', 'motionGraph'),
		has('melt', 'motionGraph'),
		has('melt', 'motion'),
		has('flipX', 'padding'),
	],
	[true, true, true, true, true],
);
const groups = twinGroups([
	{ kind: 'freeze', doc: frost },
	{ kind: 'glow', doc: powerUp },
	{ kind: 'twist', doc: frost },
]);
check(
	'the menu lists each twin once, under its catalog family, families in catalog order',
	groups.map((g) => [g.id, g.twins.map((t) => t.kind)]),
	(() => {
		const byFamily = new Map<string, string[]>();
		for (const kind of ['freeze', 'glow', 'twist'] as const) {
			const family = elementFxSpec(kind).category;
			byFamily.set(family, [...(byFamily.get(family) ?? []), kind]);
		}
		return ELEMENT_FX_CATEGORIES.filter((c) => byFamily.has(c.id)).map((c) => [
			c.id,
			byFamily.get(c.id),
		]);
	})(),
);
check(
	'a menu entry is the kind’s label and description',
	twinGroups([{ kind: 'freeze', doc: frost }])[0].twins[0],
	{
		kind: 'freeze',
		label: elementFxSpec('freeze').label,
		description: elementFxSpec('freeze').description,
	},
);
check(
	'every real twin is offered exactly once',
	twinGroups()
		.flatMap((g) => g.twins.map((t) => t.kind))
		.sort(),
	BUILTIN_TWINS.map((t) => t.kind).sort(),
);

// ── 7 ──
console.log('7. node thumbnails');
const byType = (() => {
	let doc = newShaderDoc('byType', 'Typed');
	const ids: string[] = [];
	for (const type of ['noise', 'uv', 'reliefNormal', 'sample']) {
		const added = addNode(doc, type, { x: 0, y: ids.length * 120 });
		doc = added.doc;
		ids.push(added.id);
	}
	return { doc, ids };
})();
const feeding = (probe: ShaderGraphDoc, node: string, port: string) =>
	probe.wires.find((w) => w.to.node === node && w.to.port === port)?.from;
const typeOf = (probe: ShaderGraphDoc, id: string | undefined) =>
	probe.nodes.find((n) => n.id === id)?.type;
const outputOf = (probe: ShaderGraphDoc) => probe.nodes.find((n) => n.type === 'output');
const unwiredDefault = (type: string, port: string) =>
	shaderNode(type)?.inputs.find((p) => p.id === port)?.default;
const [floatId, vec2Id, vec3Id, vec4Id] = byType.ids;
const probes = byType.ids.map((id) => probeDoc(byType.doc, id, analyzeShaderGraph(byType.doc)));
check(
	"each output type's probe compiles",
	probes.map((p) => [p?.type, p ? compileShaderEffect(p.doc).ok : false]),
	[
		['float', true],
		['vec2', true],
		['vec3', true],
		['vec4', true],
	],
);
{
	const [f, v2, v3, v4] = probes.map((p) => p?.doc as ShaderGraphDoc);
	const fOut = outputOf(f)?.id ?? '';
	const fJoin = feeding(f, fOut, 'color');
	check(
		'a float shows as grey: the Output takes Join colour, its colour the float spread, its alpha 1',
		[
			typeOf(f, fJoin?.node),
			feeding(f, fJoin?.node ?? '', 'rgb'),
			feeding(f, fJoin?.node ?? '', 'alpha'),
			unwiredDefault('premultiply', 'alpha'),
		],
		['premultiply', { node: floatId, port: 'out' }, undefined, 1],
	);
	const v2Out = outputOf(v2)?.id ?? '';
	const combine = feeding(v2, v2Out, 'color');
	const split = feeding(v2, combine?.node ?? '', 'x');
	check(
		'a vec2 shows as (x, y, 0): Split into Combine, its z 0 and its alpha 1',
		[
			[typeOf(v2, combine?.node), combine?.port],
			[typeOf(v2, split?.node), split?.port],
			feeding(v2, combine?.node ?? '', 'y'),
			feeding(v2, split?.node ?? '', 'v'),
			[feeding(v2, combine?.node ?? '', 'z'), feeding(v2, combine?.node ?? '', 'w')],
			[unwiredDefault('combine', 'z'), unwiredDefault('combine', 'w')],
		],
		[
			['combine', 'xyzw'],
			['split', 'x'],
			{ node: split?.node, port: 'y' },
			{ node: vec2Id, port: 'out' },
			[undefined, undefined],
			[0, 1],
		],
	);
	const v3Join = feeding(v3, outputOf(v3)?.id ?? '', 'color');
	check(
		'a vec3 shows as an opaque colour: Join colour, alpha 1',
		[typeOf(v3, v3Join?.node), feeding(v3, v3Join?.node ?? '', 'rgb')],
		['premultiply', { node: vec3Id, port: 'out' }],
	);
	check(
		'a vec4 shows as the colour it is: straight into a Normal Output',
		[feeding(v4, outputOf(v4)?.id ?? '', 'color'), outputOf(v4)?.values?.blend ?? 'normal'],
		[{ node: vec4Id, port: 'out' }, 'normal'],
	);
	const body = (doc: ShaderGraphDoc): string => {
		const compiled = compileShaderGraph(doc);
		return compiled.ok ? compiled.shader.body : '';
	};
	check(
		'…in GLSL: grey is the float spread at alpha 1, a vec2 gets z 0 and alpha 1',
		[
			/vec4 n\d+_out = vec4\(vec3\(n\d+_out\) \* (n\d+_l0), \1\);/.test(body(f)) &&
				/float n\d+_l0 = 1\.0;/.test(body(f)),
			/vec4 n\d+_xyzw = vec4\(n\d+_x, n\d+_y, 0\.0, 1\.0\);/.test(body(v2)),
		],
		[true, true],
	);
	check(
		'a probe is a probe: no passes, no motion, no padding, the probe id, and only what the node reads',
		[f.passes, f.motion, f.padding, f.id, f.nodes.filter((n) => byType.ids.includes(n.id)).length],
		[undefined, undefined, undefined, 'probe', 1],
	);
}
let probed = 0;
const refused: string[] = [];
for (const doc of [...BUILTIN_TWINS.map((t) => t.doc), ...REFERENCE_GRAPHS]) {
	const a = analyzeShaderGraph(doc);
	for (const node of doc.nodes) {
		if (!hasThumbnail(node, a)) continue;
		const probe = probeDoc(doc, node.id, a);
		probed += 1;
		if (!probe || !compileShaderEffect(probe.doc).ok) refused.push(`${doc.id}.${node.id}`);
	}
}
check(
	`every node of every twin and reference graph has a probe that compiles (${probed})`,
	refused,
	[],
);
check('…which is hundreds of probes', probed > 500, true);
{
	// A mid-build graph: a node fed a type it cannot take, and an unknown node elsewhere.
	let doc = newShaderDoc('mid', 'Mid');
	const add = (type: string): string => {
		const added = addNode(doc, type, { x: 0, y: 0 });
		doc = added.doc;
		return added.id;
	};
	const noise = add('noise');
	const uv = add('uv');
	const join = add('premultiply');
	const after = add('oneMinus');
	doc = connect(doc, { node: uv, port: 'out' }, { node: join, port: 'rgb' });
	doc = connect(doc, { node: join, port: 'out' }, { node: after, port: 'x' });
	doc = { ...doc, nodes: [...doc.nodes, { id: 'ghost', type: 'nope', x: 0, y: 0 }] };
	const a = analyzeShaderGraph(doc);
	const compiles = (id: string): boolean => {
		const probe = probeDoc(doc, id, a);
		return !!probe && compileShaderEffect(probe.doc).ok;
	};
	check(
		'mid-build: the graph does not compile, yet a node upstream of nothing broken draws',
		[compileShaderEffect(doc).ok, compiles(noise), compiles(uv)],
		[false, true, true],
	);
	check(
		'…and a node fed a type it cannot take, and what reads it, do not (a placeholder)',
		[compiles(join), compiles(after), compiles('ghost')],
		[false, false, false],
	);
}
{
	const out = byType.doc.nodes.find(
		(n) => n.type === 'output',
	) as (typeof byType.doc.nodes)[number];
	let doc = byType.doc;
	const flats = [...FLAT_NODES].map((type) => {
		const added = addNode(doc, type, { x: 0, y: 0 });
		doc = added.doc;
		return added.id;
	});
	check(
		'the Output and the flat nodes have no thumbnail and no probe',
		[out.id, ...flats].map((id) => [
			hasThumbnail(doc.nodes.find((n) => n.id === id) as (typeof doc.nodes)[number]),
			probeDoc(doc, id),
		]),
		[out.id, ...flats].map(() => [false, undefined]),
	);
	const view = canvasGraph(doc, analyzeShaderGraph(doc), new Set());
	check(
		'…and the canvas shows one on every other node',
		view.nodes.filter((n) => n.data.thumb).map((n) => n.id),
		byType.ids,
	);
}
{
	// A flat node is one value over the element; every other node without inputs varies over it.
	const POSITION = /\b(uv|uvSquare|px|pixel)\b/;
	const varies = (type: string): boolean => {
		const emitted = shaderNode(type)?.emit({
			in: {},
			type: 'float',
			splat: (x) => x,
			setting: () => 'uP0',
			local: (_type, expr) => expr,
		});
		return Object.values(emitted ?? {}).some((glsl) => POSITION.test(glsl));
	};
	const inputless = SHADER_NODES.filter((d) => d.inputs.length === 0 && d.type !== 'output');
	check(
		'flat nodes have no inputs and read no position; every other node without inputs does',
		inputless.map((d) => [d.type, FLAT_NODES.has(d.type) ? !varies(d.type) : varies(d.type)]),
		inputless.map((d) => [d.type, true]),
	);
	check(
		'every flat node is a node',
		[...FLAT_NODES].every((type) => shaderNode(type)?.inputs.length === 0),
		true,
	);
}
{
	const cells = REFERENCE_GRAPHS.find((g) => g.nodes.some((n) => n.type === 'cells'));
	const multi = (() => {
		let doc = newShaderDoc('multi', 'Multi');
		const c = addNode(doc, 'cells', { x: 0, y: 0 });
		doc = c.doc;
		const o = addNode(doc, 'oneMinus', { x: 200, y: 0 });
		doc = o.doc;
		return { doc, cells: c.id, after: o.id };
	})();
	check(
		'a node with several outputs shows its first, until a wire takes another onward',
		[
			probeDoc(multi.doc, multi.cells)?.port,
			probeDoc(
				connect(multi.doc, { node: multi.cells, port: 'id' }, { node: multi.after, port: 'x' }),
				multi.cells,
			)?.port,
		],
		['nearest', 'id'],
	);
	check('(a reference graph has Cells)', !!cells, true);
}
{
	const twin = BUILTIN_TWINS.find((t) => t.kind === 'petrify')?.doc as ShaderGraphDoc;
	const before = probeKeys(twin);
	const target = twin.nodes.find((n) => n.type === 'noise') ?? twin.nodes[1];
	const touched = setNodeValue(twin, target.id, 'scale', 123.5);
	const after = probeKeys(touched);
	const downstream = new Set([target.id]);
	for (let grew = true; grew;) {
		grew = false;
		for (const w of twin.wires)
			if (downstream.has(w.from.node) && !downstream.has(w.to.node)) {
				downstream.add(w.to.node);
				grew = true;
			}
	}
	const changed = twin.nodes.filter((n) => before.get(n.id) !== after.get(n.id)).map((n) => n.id);
	check(
		'an edit changes the probe keys of the node and what reads it, and no other',
		changed.sort(),
		[...downstream].sort(),
	);
	check('…which is not every node', changed.length < twin.nodes.length, true);
	check(
		'moving a node changes no key',
		[...probeKeys(moveNode(twin, target.id, 999, 999)).entries()],
		[...before.entries()],
	);
	check(
		'equal keys mean equal probes (same doc, every node)',
		twin.nodes.every((n) => {
			const p = probeDoc(twin, n.id);
			const q = probeDoc(structuredClone(twin), n.id);
			return JSON.stringify(p) === JSON.stringify(q);
		}),
		true,
	);
	check(
		'a param edited changes every key (a param node may read it anywhere)',
		[...probeKeys({ ...twin, params: [...twin.params].reverse() }).entries()].some(
			([id, key]) => before.get(id) === key,
		),
		false,
	);
}
{
	const spot = (id: string, x: number, y: number, visible = true) => ({ id, x, y, visible });
	const spots = [
		spot('far', 900, 0),
		spot('near', 10, 0),
		spot('mid', 300, 0),
		spot('off', 0, 0, false),
	];
	check(
		'live thumbnails: on screen only, nearest the centre first',
		liveThumbs(spots, { x: 0, y: 0 }, new Set()),
		['near', 'mid', 'far'],
	);
	check(
		'…the selected node first, wherever it is',
		liveThumbs(spots, { x: 0, y: 0 }, new Set(['far'])),
		['far', 'near', 'mid'],
	);
	check(
		'…an off-screen selection is not drawn',
		liveThumbs(spots, { x: 0, y: 0 }, new Set(['off'])),
		['near', 'mid', 'far'],
	);
	const many = Array.from({ length: 100 }, (_, i) => spot(`n${i}`, i * 10, 0));
	check(
		'…and at most the cap (40 of 100), the nearest',
		liveThumbs(many, { x: 0, y: 0 }, new Set()),
		many.slice(0, 40).map((s) => s.id),
	);
}

// ── 8 ──
console.log('8. the cost on the canvas');
let summed = 0;
const mismatched: string[] = [];
for (const doc of [...BUILTIN_TWINS.map((t) => t.doc), ...REFERENCE_GRAPHS]) {
	const a = analyzeShaderGraph(doc);
	const costs = [...nodeCosts(doc, a).values()];
	const cost = costs.reduce((sum, c) => sum + c.cost, 0);
	const reads =
		costs.reduce((sum, c) => sum + c.samples, 0) + (costs.some((c) => c.readsPixel) ? 1 : 0);
	summed += 1;
	if (cost !== a.cost || reads !== a.samples)
		mismatched.push(`${doc.id}: ${cost}/${a.cost} cost, ${reads}/${a.samples} reads`);
}
check(`the chips sum to the analysis' cost and reads (${summed} graphs)`, mismatched, []);
{
	let doc = newShaderDoc('stray', 'Stray');
	const add = (type: string): string => {
		const added = addNode(doc, type, { x: 0, y: 0 });
		doc = added.doc;
		return added.id;
	};
	const used = add('fbm');
	const join = add('premultiply');
	const stray = add('cells');
	const out = doc.nodes.find((n) => n.type === 'output')?.id ?? '';
	doc = connect(doc, { node: used, port: 'out' }, { node: join, port: 'rgb' });
	doc = connect(doc, { node: join, port: 'out' }, { node: out, port: 'color' });
	const a = analyzeShaderGraph(doc);
	const view = canvasGraph(doc, a, new Set());
	const chip = (id: string) => view.nodes.find((n) => n.id === id)?.data.cost;
	check(
		'a node not reaching the Output has no chip; those reaching it have theirs',
		[chip(stray), chip(used)?.cost, chip(join)?.cost, chip(out)?.cost],
		[
			undefined,
			shaderNode('fbm')?.cost,
			shaderNode('premultiply')?.cost,
			shaderNode('output')?.cost,
		],
	);
	check(
		'…and they sum to the status bar total',
		[...nodeCosts(doc, a).values()].reduce((sum, c) => sum + c.cost, 0),
		a.cost,
	);
	const bogus = {
		...doc,
		wires: [
			...doc.wires,
			{ from: { node: stray, port: 'nearest' }, to: { node: join, port: 'nope' } },
		],
	};
	check(
		'a wire the analysis refuses (to a port Join colour lacks) does not give the node it leaves a chip',
		[nodeCosts(bogus, analyzeShaderGraph(bogus)).has(stray), analyzeShaderGraph(bogus).cost],
		[false, a.cost],
	);
	const flip = add('oneMinus');
	const looped = connect(
		connect(doc, { node: join, port: 'out' }, { node: flip, port: 'x' }),
		{ node: flip, port: 'out' },
		{ node: join, port: 'alpha' },
	);
	check(
		'a graph that cannot be walked (a loop) shows no chip, as its total is 0',
		[nodeCosts(looped, analyzeShaderGraph(looped)).size, analyzeShaderGraph(looped).cost],
		[0, 0],
	);
	const pixel = nodeCosts(
		newShaderDoc('plain', 'Plain'),
		analyzeShaderGraph(newShaderDoc('plain', 'Plain')),
	);
	check(
		"the pixel read is counted once, on the analysis' total, and named on the nodes reading it",
		[
			[...pixel.values()].map((c) => [c.samples, c.readsPixel]),
			analyzeShaderGraph(newShaderDoc('p', 'P')).samples,
		],
		[[[0, true]], 1],
	);
}
check(
	'weights: under 2.5% of the budget light, under 10% medium, else heavy; reads count as their share',
	[
		costWeight(9 / COST_BUDGET),
		costWeight(10 / COST_BUDGET),
		costWeight(39 / COST_BUDGET),
		costWeight(40 / COST_BUDGET),
		costWeight(1 / SAMPLE_BUDGET),
		costWeight(2 / SAMPLE_BUDGET),
		COST_WEIGHTS,
	],
	['light', 'medium', 'medium', 'heavy', 'medium', 'heavy', { medium: 0.025, heavy: 0.1 }],
);
{
	const doc = BUILTIN_TWINS.find((t) => t.kind === 'petrify')?.doc as ShaderGraphDoc;
	const costs = nodeCosts(doc, analyzeShaderGraph(doc));
	const weightOf = (type: string) =>
		costs.get(doc.nodes.find((n) => n.type === type)?.id ?? '')?.weight;
	check(
		'on Petrify: cells heavy, a relief slope heavy (4 reads), an add light',
		[weightOf('cells'), weightOf('reliefSlope'), weightOf('add')],
		['heavy', 'heavy', 'light'],
	);
}

{
	// With subgraphs: seeded groups over every reference graph and twin.
	let seed = 7;
	const rand = (): number => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed / 2147483648;
	};
	const sums: string[] = [];
	const calls: string[] = [];
	const bodies: string[] = [];
	let grouped = 0;
	let bodyProbes = 0;
	for (const doc of [...REFERENCE_GRAPHS, ...BUILTIN_TWINS.map((t) => t.doc)]) {
		if (!compileShaderGraph(doc).ok) continue;
		for (let k = 0; k < 3; k++) {
			const ids = doc.nodes.filter((n) => n.type !== 'output' && rand() < 0.4).map((n) => n.id);
			const made = ids.length ? groupNodes(doc, null, ids, 'G') : undefined;
			if (!made) continue;
			grouped += 1;
			const a = analyzeShaderGraph(made.doc);
			const costs = [...nodeCosts(made.doc, a).values()];
			const reads =
				costs.reduce((sum, c) => sum + c.samples, 0) + (costs.some((c) => c.readsPixel) ? 1 : 0);
			if (costs.reduce((sum, c) => sum + c.cost, 0) !== a.cost || reads !== a.samples)
				sums.push(`${doc.id}[${ids.length}]`);
			const call = made.doc.nodes.find(
				(n) => n.id === made.call,
			) as (typeof made.doc.nodes)[number];
			const outputs = made.doc.subgraphs?.find((sub) => sub.id === made.subgraph)?.outputs ?? [];
			const probe = probeDoc(made.doc, made.call, a);
			if (hasThumbnail(call, a, made.doc) !== outputs.length > 0)
				calls.push(`${doc.id}[${ids.length}] thumb`);
			else if (outputs.length && !(probe && compileShaderEffect(probe.doc).ok))
				calls.push(`${doc.id}[${ids.length}] probe`);
			const body = analyzeScope(made.doc, made.subgraph);
			const inBody = [...nodeCosts(made.doc, body, made.subgraph).values()];
			if (inBody.reduce((sum, c) => sum + c.cost, 0) !== body.cost)
				bodies.push(`${doc.id}[${ids.length}] cost`);
			for (const node of viewOf(made.doc, made.subgraph).nodes) {
				if (!hasThumbnail(node, body, made.doc, made.subgraph)) continue;
				bodyProbes += 1;
				const p = probeDoc(made.doc, node.id, body, made.subgraph);
				if (!p || !compileShaderEffect(p.doc).ok)
					bodies.push(`${doc.id}[${ids.length}] ${node.id}`);
			}
		}
	}
	check(
		`with a group (${grouped} seeded groups): the chips still sum to the analysis, a call carrying its body's cost`,
		sums,
		[],
	);
	check(
		'…a call with outputs shows its output through the same probe, which compiles; one without has no thumbnail',
		calls,
		[],
	);
	check(
		`…and inside a body every node's probe compiles, its inputs at their defaults (${bodyProbes} probes), its chips summing to one call's cost`,
		bodies,
		[],
	);
	check('…which were enough', grouped > 50 && bodyProbes > 200, true);

	// One group, looked at closely: Petrify's cells and what feeds them.
	const petrify = BUILTIN_TWINS.find((t) => t.kind === 'petrify')?.doc as ShaderGraphDoc;
	const cells = petrify.nodes.find((n) => n.type === 'cells') as (typeof petrify.nodes)[number];
	const feeding = new Set(
		petrify.wires.filter((w) => w.to.node === cells.id).map((w) => w.from.node),
	);
	const made = groupNodes(
		petrify,
		null,
		[cells.id, ...feeding].filter((id) =>
			petrify.nodes.some((n) => n.id === id && n.type !== 'output'),
		),
		'Cells group',
	);
	if (!made) throw new Error('no group');
	const a = analyzeShaderGraph(made.doc);
	check(
		"the call's chip is its body's cost, cells (120) included, heavy",
		[
			(nodeCosts(made.doc, a).get(made.call)?.cost ?? 0) >= 120,
			nodeCosts(made.doc, a).get(made.call)?.weight,
		],
		[true, 'heavy'],
	);
	const body = viewOf(made.doc, made.subgraph);
	const input = body.nodes.find((n) => n.type === 'subgraphIn');
	check(
		"a body's Input has no thumbnail; its Output none either",
		[
			input
				? hasThumbnail(input, analyzeScope(made.doc, made.subgraph), made.doc, made.subgraph)
				: 'no input',
			body.nodes
				.filter((n) => n.type === 'subgraphOut')
				.map((n) => hasThumbnail(n, undefined, made.doc, made.subgraph)),
		],
		[false, [false]],
	);
	const before = probeKeys(made.doc);
	const bodyBefore = probeKeys(made.doc, made.subgraph);
	const inner = body.nodes.find((n) => n.type === 'cells') as (typeof body.nodes)[number];
	const edited = inScope(made.doc, made.subgraph, (d) => setNodeValue(d, inner.id, 'scale', 3.25));
	const after = probeKeys(edited);
	const reads = new Set([made.call]);
	for (let grew = true; grew;) {
		grew = false;
		for (const w of made.doc.wires)
			if (reads.has(w.from.node) && !reads.has(w.to.node)) {
				reads.add(w.to.node);
				grew = true;
			}
	}
	check(
		'an edit inside a body changes the keys of its calls and what reads them, and no other',
		made.doc.nodes
			.filter((n) => before.get(n.id) !== after.get(n.id))
			.map((n) => n.id)
			.sort(),
		[...reads].sort(),
	);
	check(
		"…and inside the body, the edited node's and what reads it there",
		[...probeKeys(edited, made.subgraph)].filter(([id, key]) => bodyBefore.get(id) !== key).length >
			0 && [...probeKeys(edited, made.subgraph)].some(([id, key]) => bodyBefore.get(id) === key),
		true,
	);
	const twice = inScope(
		{ ...made.doc, nodes: [...made.doc.nodes, { id: 'twin1', type: 'uv', x: 0, y: 0 }] },
		made.subgraph,
		(d) => ({ ...d, nodes: [...d.nodes, { id: 'twin1', type: 'uv', x: 0, y: 0 }] }),
	);
	check(
		'one node id, alike, in the effect and in a body: two keys (a thumbnail never shows the other)',
		[
			probeKeys(twice).get('twin1') !== probeKeys(twice, made.subgraph).get('twin1'),
			!!probeKeys(twice).get('twin1'),
		],
		[true, true],
	);
}

// ── 9 ──
console.log('9. subgraphs');
{
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
	const glsl = (doc: ShaderGraphDoc): string => {
		const r = compileShaderGraph(doc);
		return r.ok ? r.shader.body : `ERRORS ${r.issues.map((i) => i.message).join('; ')}`;
	};

	// Group, then ungroup: over the reference graphs and twins, seeded selections.
	let seed = 11;
	const rand = (): number => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed / 2147483648;
	};
	let trips = 0;
	const failed: string[] = [];
	/** Selections a subgraph's 32 inputs or outputs cannot take, and what was said of them. */
	const capped: string[] = [];
	/** Selections holding a Break Output or a node wired into one (the break twins'), and why. */
	const broke: { breaks: boolean; message: string }[] = [];
	for (const doc of [...REFERENCE_GRAPHS, ...BUILTIN_TWINS.map((t) => t.doc)]) {
		const base = compileShaderGraph(doc);
		if (!base.ok) continue;
		for (let k = 0; k < 8; k++) {
			const ids = doc.nodes.filter((n) => n.type !== 'output' && rand() < 0.4).map((n) => n.id);
			if (!ids.length) continue;
			const refused = groupRefusal(doc, null, ids);
			if (refused) {
				if (refused.startsWith('The Break Output'))
					broke.push({
						breaks: doc.nodes.some((n) => n.type === BREAK_OUTPUT),
						message: refused,
					});
				else capped.push(refused);
				if (groupNodes(doc, null, ids, 'G')) failed.push(`${doc.id}: grouped though refused`);
				continue;
			}
			trips += 1;
			const grouped = groupNodes(doc, null, ids, 'G');
			const compiled = grouped && compileShaderGraph(grouped.doc);
			const back = grouped && ungroupCall(grouped.doc, null, grouped.call);
			const same =
				!!compiled?.ok &&
				!!back &&
				glsl(back.doc) === base.shader.body &&
				canonical(compiled.shader.body) === canonical(base.shader.body) &&
				compiled.shader.cost === base.shader.cost &&
				compiled.shader.samples === base.shader.samples &&
				!back.doc.subgraphs &&
				back.doc.nodes.length === doc.nodes.length;
			if (!same) failed.push(`${doc.id}[${ids.join(',')}]`);
		}
	}
	check(
		`group then ungroup, ${trips} seeded selections over every reference graph and twin: the group compiles to the same shader (its pass-throughs read through), cost and reads; ungrouping it gives byte-identical GLSL (not the same doc: nodes and wires change order) and drops the subgraph`,
		failed,
		[],
	);
	check(
		`…and there were enough of them; the ${capped.length} selections needing more than 32 inputs or outputs were refused, saying so`,
		[
			trips > 200,
			capped.length < trips / 10,
			capped.every((m) => /^A subgraph takes at most 32 inputs and 32 outputs/.test(m)),
		],
		[true, true, true],
	);
	check(
		`…the ${broke.length} selections holding a break twin’s Break Output or a Param wired into it were refused, naming them (a subgraph takes neither)`,
		[
			broke.length > 10,
			broke.every((b) => b.breaks),
			broke.every((b) =>
				/Leave (the Break Output|param\d+)(, (the Break Output|param\d+))* out of the group\.$/.test(
					b.message,
				),
			),
		],
		[true, true, true],
	);

	// Boundary typing: Pulse tint's tint grouped.
	const pulse = REFERENCE_GRAPHS.find((d) => d.id === 'pulseTint') as ShaderGraphDoc;
	const tint = groupNodes(pulse, null, ['param5', 'colorize6', 'mix7', 'output9'], 'Tint');
	const tintSub = tint?.doc.subgraphs?.[0];
	check(
		'grouping: the Output is never taken; one input per output feeding the group (two nodes read the RGB), one output per output read outside, typed as the analysis resolved them',
		tintSub && { inputs: tintSub.inputs, outputs: tintSub.outputs },
		{
			inputs: [
				{ id: 'in1', label: 'Colour', type: 'vec3' },
				{ id: 'in2', label: 'T', type: 'float' },
			],
			outputs: [{ id: 'out1', label: 'Mix', type: 'vec3' }],
		},
	);
	check(
		'…the call takes their place, wired as they were; the body holds them between its Input and Output',
		tint && {
			call: tint.doc.nodes.find((n) => n.id === tint.call),
			wires: tint.doc.wires.filter((w) => w.from.node === tint.call || w.to.node === tint.call),
			body: tintSub?.nodes.map((n) => n.type),
		},
		tint && {
			call: { id: 'subgraph1', type: 'subgraph', x: 900, y: 0, values: { subgraph: 'tint' } },
			wires: [
				{ from: { node: 'unpremultiply4', port: 'rgb' }, to: { node: 'subgraph1', port: 'in1' } },
				{ from: { node: 'multiply3', port: 'out' }, to: { node: 'subgraph1', port: 'in2' } },
				{ from: { node: 'subgraph1', port: 'out1' }, to: { node: 'premultiply8', port: 'rgb' } },
			],
			body: ['subgraphIn', 'param', 'colorize', 'mix', 'subgraphOut'],
		},
	);
	const generic = (() => {
		let doc = newShaderDoc('generic', 'Generic');
		const uv = addNode(doc, 'uv', { x: 0, y: 0 });
		const add = addNode(uv.doc, 'add', { x: 200, y: 0 });
		const len = addNode(add.doc, 'length', { x: 400, y: 0 });
		const neg = addNode(len.doc, 'oneMinus', { x: 400, y: 200 });
		doc = connect(neg.doc, { node: uv.id, port: 'out' }, { node: add.id, port: 'a' });
		doc = connect(doc, { node: add.id, port: 'out' }, { node: len.id, port: 'v' });
		doc = connect(doc, { node: add.id, port: 'out' }, { node: neg.id, port: 'x' });
		return { doc, add: add.id, len: len.id };
	})();
	const typedIn = groupNodes(generic.doc, null, [generic.len], 'L')?.doc.subgraphs?.[0].inputs;
	const typedOut = groupNodes(generic.doc, null, [generic.add], 'A');
	check(
		'an Add fed a vec2 is a vec2: a group reading it takes a vec2 input, a group of it gives a vec2 output, read by both nodes outside from one port',
		{
			in: typedIn?.map((p) => p.type),
			out: typedOut?.doc.subgraphs?.[0].outputs.map((p) => p.type),
			reads: typedOut?.doc.wires.filter((w) => w.from.node === typedOut.call).length,
		},
		{ in: ['vec2'], out: ['vec2'], reads: 2 },
	);
	check(
		'nothing to group (only the Output, or nothing) groups nothing',
		[groupNodes(pulse, null, ['output9'], 'X'), groupNodes(pulse, null, [], 'X')],
		[undefined, undefined],
	);

	// Editing inside a subgraph: every gesture lands in its body, the effect's graph untouched.
	let doc = (tint as NonNullable<typeof tint>).doc;
	const scope = 'tint';
	const effectGraph = json({ nodes: doc.nodes, wires: doc.wires });
	const added = inScope(doc, scope, (d) => addNode(d, 'oneMinus', { x: 10, y: 20 }).doc);
	const body = (d: ShaderGraphDoc) => d.subgraphs?.find((s) => s.id === scope);
	check(
		'adding a node inside lands in the body, the effect’s graph as it was',
		[body(added)?.nodes.at(-1)?.type, json({ nodes: added.nodes, wires: added.wires })],
		['oneMinus', effectGraph],
	);
	const inAnalysis = analyzeScope(added, scope);
	const fromIn = { node: 'subgraphIn1', port: 'in2' };
	check(
		'inside, the wire rule is the body’s: a float input into One minus is taken, a vec3 output fed a float from One minus is taken (it spreads), the Input’s vec3 into a float port is taken (it narrows)',
		[
			canConnect(added, inAnalysis, fromIn, { node: 'oneMinus1', port: 'x' }, scope),
			canConnect(
				added,
				inAnalysis,
				{ node: 'oneMinus1', port: 'out' },
				{ node: 'subgraphOut1', port: 'out1' },
				scope,
			),
			canConnect(
				added,
				inAnalysis,
				{ node: 'subgraphIn1', port: 'in1' },
				{ node: 'mix7', port: 't' },
				scope,
			),
		],
		[true, true, true],
	);
	check(
		'…and refuses a loop inside: the Mix into the Colorize it reads',
		canConnect(
			added,
			inAnalysis,
			{ node: 'mix7', port: 'out' },
			{ node: 'colorize6', port: 'rgb' },
			scope,
		),
		false,
	);
	const withUv = inScope(added, scope, (d) => addNode(d, 'uv', { x: 0, y: 0 }).doc);
	check(
		'…and refuses what the body would not take: a UV (vec2) into its vec3 output',
		canConnect(
			withUv,
			analyzeScope(withUv, scope),
			{ node: 'uv1', port: 'out' },
			{ node: 'subgraphOut1', port: 'out1' },
			scope,
		),
		false,
	);
	doc = inScope(added, scope, (d) => connect(d, fromIn, { node: 'oneMinus1', port: 'x' }));
	doc = inScope(doc, scope, (d) =>
		connect(d, { node: 'oneMinus1', port: 'out' }, { node: 'mix7', port: 't' }),
	);
	doc = inScope(doc, scope, (d) => setNodeValue(d, 'colorize6', 'tint', [0, 1, 0]));
	doc = inScope(doc, scope, (d) => moveNode(d, 'oneMinus1', 33.4, 44.6));
	check(
		'wiring, a value and a move inside land in the body; it compiles, the effect’s graph as it was',
		[
			body(doc)
				?.wires.filter((w) => w.to.node === 'mix7' && w.to.port === 't')
				.map((w) => w.from.node),
			body(doc)?.nodes.find((n) => n.id === 'colorize6')?.values,
			((n) => n && { x: n.x, y: n.y })(body(doc)?.nodes.find((n) => n.id === 'oneMinus1')),
			compileShaderEffect(doc).ok,
			json({ nodes: doc.nodes, wires: doc.wires }),
		],
		[['oneMinus1'], { tint: [0, 1, 0] }, { x: 33, y: 45 }, true, effectGraph],
	);
	const pinned = inScope(doc, scope, (d) =>
		remove(d, ['subgraphIn1', 'subgraphOut1', 'oneMinus1']),
	);
	check(
		'deleting inside keeps the body’s Input and Output, and takes the node’s wires',
		[
			body(pinned)?.nodes.map((n) => n.type),
			body(pinned)?.wires.some((w) => w.from.node === 'oneMinus1' || w.to.node === 'oneMinus1'),
		],
		[['subgraphIn', 'param', 'colorize', 'mix', 'subgraphOut'], false],
	);
	const inner = canvasGraph(doc, analyzeScope(doc, scope), new Set(), false, scope);
	const innerView = (id: string) => inner.nodes.find((n) => n.id === id);
	check(
		'the canvas inside shows the body: its Input and Output with the ports as declared, not deletable; the rest deletable',
		[
			inner.nodes.map((n) => n.id),
			innerView('subgraphIn1')?.data.def?.label,
			innerView('subgraphIn1')?.data.outTypes,
			innerView('subgraphOut1')?.data.inTypes,
			inner.nodes.filter((n) => !n.deletable).map((n) => n.id),
		],
		[
			['subgraphIn1', 'param5', 'colorize6', 'mix7', 'subgraphOut1', 'oneMinus1'],
			'Input',
			{ in1: 'vec3', in2: 'float' },
			{ out1: 'vec3' },
			['subgraphIn1', 'subgraphOut1'],
		],
	);
	const outerView = canvasGraph(doc, analyzeShaderGraph(doc), new Set(), false);
	const callView = outerView.nodes.find((n) => n.id === 'subgraph1');
	check(
		'outside, the call shows its subgraph’s name and ports with their types',
		[
			callView?.data.def?.label,
			callView?.data.summary,
			callView?.data.inTypes,
			callView?.data.outTypes,
		],
		['Tint', 'subgraph', { in1: 'vec3', in2: 'float' }, { out1: 'vec3' }],
	);
	const ghost = inScope(doc, scope, (d) => setNodeValue(d, 'param5', 'param', 'ghost'));
	const ghostInner = canvasGraph(ghost, analyzeScope(ghost, scope), new Set(), false, scope);
	const ghostOuter = canvasGraph(ghost, analyzeShaderGraph(ghost), new Set(), false);
	check(
		'an error inside shows on its node inside, and on the call outside led by the subgraph’s name',
		[
			ghostInner.nodes.find((n) => n.id === 'param5')?.data.errors,
			ghostOuter.nodes.find((n) => n.id === 'subgraph1')?.data.errors,
		],
		[
			['"ghost" is not one of the effect\'s params'],
			['Tint › "ghost" is not one of the effect\'s params'],
		],
	);
	const outless = (() => {
		const next = JSON.parse(json(doc)) as ShaderGraphDoc;
		const sub = body(next) as NonNullable<ReturnType<typeof body>>;
		sub.nodes = sub.nodes.filter((n) => n.type !== 'subgraphOut');
		sub.wires = sub.wires.filter((w) => w.to.node !== 'subgraphOut1');
		return next;
	})();
	check(
		'a body that lost its Output says so as the body’s own error; the palette offers it back, and only there',
		[
			docIssues(outless, analyzeScope(outless, scope), scope),
			missingBoundary(outless, scope),
			canPlace(outless, scope, 'subgraphOut'),
			canPlace(outless, scope, 'subgraphIn'),
			canPlace(outless, null, 'subgraphOut'),
			canPlace(outless, scope, 'output'),
			canPlace(outless, scope, 'noise'),
		],
		[['the subgraph has no Output node'], ['subgraphOut'], true, false, false, false, true],
	);

	// Calls: more of them, the palette, deleting.
	const second = addCall(doc, null, 'tint', { x: 700, y: 300 });
	check(
		'a call dropped from the palette names its subgraph; the palette counts both calls',
		[
			second.doc.nodes.find((n) => n.id === second.id)?.values,
			subgraphRows(second.doc, null),
			subgraphCalls(second.doc, 'tint'),
		],
		[
			{ subgraph: 'tint' },
			[{ id: 'tint', name: 'Tint', calls: 2, blocked: '' }],
			[
				{ scope: null, node: 'subgraph1' },
				{ scope: null, node: second.id },
			],
		],
	);
	const keep = ungroupCall(second.doc, null, 'subgraph1');
	check(
		'ungrouping one of two calls keeps the subgraph for the other, and still compiles',
		[keep?.doc.subgraphs?.length, keep && compileShaderEffect(keep.doc).ok],
		[1, true],
	);
	{
		// The effect's graph and its motion graph never share a node id: every id these gestures
		// could mint is already a motion node here.
		const minted = ['subgraph', 'colorize', 'mix', 'param', 'time', 'bell', 'multiply'].flatMap(
			(stem) => Array.from({ length: 12 }, (_, i) => `${stem}${i + 1}`),
		);
		const motionIds = new Set(minted);
		const crowded: ShaderGraphDoc = {
			...second.doc,
			motionGraph: {
				nodes: minted.map((id) => ({ id, type: 'number', x: 0, y: 0 })),
				wires: [],
			},
		};
		const loose = crowded.nodes.find((n) => n.type !== 'output' && n.type !== 'subgraph');
		const called = addCall(crowded, null, 'tint', { x: 0, y: 0 });
		const opened = ungroupCall(crowded, null, 'subgraph1');
		const regrouped = loose && groupNodes(crowded, null, [loose.id], 'Again');
		check(
			'a call added, a call ungrouped and a group made mint no id the motion graph has',
			[
				motionIds.has(called.id),
				!!opened?.ids.length,
				opened?.ids.some((id) => motionIds.has(id)),
				!!regrouped,
				regrouped && motionIds.has(regrouped.call),
			],
			[false, true, false, true, false],
		);
	}
	check(
		'deleting a subgraph still called is refused…',
		deleteSubgraph(second.doc, 'tint'),
		undefined,
	);
	const gone = deleteSubgraph(second.doc, 'tint', true);
	check(
		'…unless its calls go too, with their wires; an uncalled one deletes outright',
		[
			gone?.subgraphs,
			gone?.nodes.some((n) => n.type === 'subgraph'),
			gone?.wires.some((w) => w.from.node === 'subgraph1' || w.to.node === 'subgraph1'),
			gone && compileShaderEffect(gone).ok,
			deleteSubgraph(remove(doc, ['subgraph1']), 'tint')?.subgraphs,
		],
		[undefined, false, false, true, undefined],
	);

	// Nesting: a group inside a subgraph, and what a body may call.
	const nested = groupNodes(doc, scope, ['colorize6', 'mix7'], 'Blend');
	check(
		'grouping inside a subgraph nests a call in its body; the effect compiles to the same shader',
		nested && [
			body(nested.doc)
				?.nodes.filter((n) => n.type === 'subgraph')
				.map((n) => n.values?.subgraph),
			canonical(glsl(nested.doc)) === canonical(glsl(doc)),
		],
		[['blend'], true],
	);
	const rows = nested && subgraphRows(nested.doc, 'blend');
	check(
		'inside Blend, neither Blend nor Tint (which calls it) can be called; outside, both can',
		[
			rows?.map((r) => [r.id, !!r.blocked]),
			nested && subgraphRows(nested.doc, null).map((r) => !!r.blocked),
		],
		[
			[
				['blend', true],
				['tint', true],
			],
			[false, false],
		],
	);

	// Ports: added, renamed, retyped, removed, every call following.
	let ported = addSubgraphPort(second.doc, 'tint', 'inputs', 'vec2');
	ported = setNodeValue(ported, second.id, 'in3', [1, 2]);
	ported = setSubgraphPort(ported, 'tint', 'inputs', 'in3', {
		label: 'Offset',
		default: [0.5, 0.5],
	});
	const portList = body(ported)?.inputs.at(-1);
	const retyped = setSubgraphPort(ported, 'tint', 'inputs', 'in3', { type: 'vec3' });
	check(
		'a new input is a port on every call; renamed and given a default it keeps its id; retyped, a default and call values that no longer fit go',
		[
			portList,
			canvasGraph(ported, analyzeShaderGraph(ported), new Set())
				.nodes.find((n) => n.id === second.id)
				?.data.def?.inputs.map((p) => p.id),
			body(retyped)?.inputs.at(-1),
			retyped.nodes.find((n) => n.id === second.id)?.values,
		],
		[
			{ id: 'in3', label: 'Offset', type: 'vec2', default: [0.5, 0.5] },
			['in1', 'in2', 'in3'],
			{ id: 'in3', label: 'Offset', type: 'vec3' },
			{ subgraph: 'tint' },
		],
	);
	const unported = removeSubgraphPort(second.doc, 'tint', 'inputs', 'in1');
	check(
		'removing an input takes every wire to it: into each call, and from the body’s Input',
		[
			body(unported)?.inputs.map((p) => p.id),
			unported.wires.filter((w) => w.to.port === 'in1').length,
			body(unported)?.wires.filter((w) => w.from.port === 'in1').length,
			compileShaderEffect(unported).ok,
		],
		[['in2'], 0, 0, true],
	);
	const renamed = renameSubgraph(second.doc, 'tint', '  Warm tint ');
	check(
		'renaming a subgraph renames every call',
		[
			body(renamed)?.name,
			subgraphRows(renamed, null)[0].name,
			renameSubgraph(second.doc, 'tint', ' '),
		],
		['Warm tint', 'Warm tint', second.doc],
	);

	// Params followed into bodies; storage keeps it all.
	const paramIndex = doc.params.findIndex((p) => p.id === 'color');
	const reParam = setParam(doc, paramIndex, { ...doc.params[paramIndex], id: 'hue' });
	check(
		'renaming a param follows its Param nodes into subgraphs',
		[body(reParam)?.nodes.find((n) => n.id === 'param5')?.values, compileShaderEffect(reParam).ok],
		[{ param: 'hue' }, true],
	);
	const stored = normalizeShaderGraphDoc(JSON.parse(json(nested?.doc)), doc.id);
	check(
		'a doc with nested subgraphs survives storage as it was',
		[
			json(stored.subgraphs) === json(nested?.doc.subgraphs),
			glsl(stored) === glsl(nested?.doc as ShaderGraphDoc),
		],
		[true, true],
	);
	check(
		'ungroup(group(x)) on a graph edited inside first: the same GLSL as the edited graph inlined by hand',
		(() => {
			const back = ungroupCall(doc, null, 'subgraph1');
			return back ? canonical(glsl(back.doc)) === canonical(glsl(doc)) : false;
		})(),
		true,
	);

	// A retyped port: its pass-through converts, a straight wire would not, so ungroup is refused.
	const u2: ShaderGraphDoc = {
		...newShaderDoc('u2', 'U2'),
		nodes: [
			{ id: 'out', type: 'output', x: 400, y: 0 },
			{ id: 'c', type: 'subgraph', x: 200, y: 0, values: { subgraph: 's' } },
			{ id: 'col', type: 'color', x: 0, y: 0, values: { value: '#ff8000' } },
		],
		wires: [
			{ from: { node: 'col', port: 'out' }, to: { node: 'c', port: 'a' } },
			{ from: { node: 'c', port: 'r' }, to: { node: 'out', port: 'color' } },
		],
		subgraphs: [
			{
				id: 's',
				name: 'S',
				inputs: [{ id: 'a', label: 'a', type: 'float' }],
				outputs: [{ id: 'r', label: 'r', type: 'vec4' }],
				nodes: [
					{ id: 'i', type: 'subgraphIn', x: 0, y: 0 },
					{ id: 'o', type: 'subgraphOut', x: 0, y: 0 },
				],
				wires: [{ from: { node: 'i', port: 'a' }, to: { node: 'o', port: 'r' } }],
			},
		],
	};
	check(
		'the review’s case (a Colour into a float input, through to a vec4 output) compiles, and ungroup refuses it, naming both ports',
		[compileShaderGraph(u2).ok, ungroupCall(u2, null, 'c'), ungroupRefusal(u2, null, 'c')],
		[
			true,
			undefined,
			'Ungrouping would change what S draws: its input "a" is a float fed a vec3; its output "r" is a vec4 fed a float inside. Make each such port the type that feeds it, then ungroup.',
		],
	);
	const u2Fixed = setSubgraphPort(
		setSubgraphPort(u2, 's', 'inputs', 'a', { type: 'vec3' }),
		's',
		'outputs',
		'r',
		{ type: 'vec3' },
	);
	const u2Back = ungroupCall(u2Fixed, null, 'c');
	check(
		'…retyped to what feeds them, it ungroups to the same GLSL as the call',
		[
			ungroupRefusal(u2Fixed, null, 'c'),
			!!u2Back && canonical(glsl(u2Back.doc)) === canonical(glsl(u2Fixed)),
		],
		[undefined, true],
	);
	const retypedT = setSubgraphPort(second.doc, 'tint', 'inputs', 'in2', { type: 'vec2' });
	check(
		'retyping a port of a grouped call (T, a float, made a vec2) refuses ungroup, naming it; ungroup of the untouched call still goes',
		[
			ungroupRefusal(retypedT, null, 'subgraph1'),
			ungroupCall(retypedT, null, 'subgraph1'),
			ungroupRefusal(second.doc, null, 'subgraph1'),
		],
		[
			'Ungrouping would change what Tint draws: its input "T" is a vec2 fed a float. Make each such port the type that feeds it, then ungroup.',
			undefined,
			undefined,
		],
	);

	// The caps: 32 inputs and outputs, 64 subgraphs.
	const wide = (() => {
		let d = newShaderDoc('wide', 'Wide');
		const add = addNode(d, 'add', { x: 0, y: 0 });
		d = add.doc;
		for (let i = 0; i < 33; i++) {
			const num = addNode(d, 'number', { x: -200, y: i * 40 });
			const sum = addNode(num.doc, 'add', { x: 0, y: i * 40 });
			d = connect(sum.doc, { node: num.id, port: 'out' }, { node: sum.id, port: 'a' });
		}
		return d;
	})();
	const adds = wide.nodes.filter((n) => n.type === 'add').map((n) => n.id);
	check(
		'a group needing 33 inputs is refused, saying so; 32 group',
		[
			groupRefusal(wide, null, adds),
			groupNodes(wide, null, adds, 'W'),
			!!groupNodes(wide, null, adds.slice(0, 33), 'W'),
		],
		[
			'A subgraph takes at most 32 inputs and 32 outputs; these nodes would need 33 and 0. Group fewer of them.',
			undefined,
			true,
		],
	);
	const full: ShaderGraphDoc = {
		...pulse,
		subgraphs: Array.from({ length: 64 }, (_, i) => ({
			id: `s${i}`,
			name: `S${i}`,
			inputs: [],
			outputs: [],
			nodes: [],
			wires: [],
		})),
	};
	check(
		'an effect holding 64 subgraphs groups no more, saying so',
		[groupRefusal(full, null, ['mix7']), groupNodes(full, null, ['mix7'], 'X')],
		['An effect holds at most 64 subgraphs: delete one to group these nodes.', undefined],
	);
	let crowded = second.doc;
	for (let i = 0; i < 40; i++) crowded = addSubgraphPort(crowded, 'tint', 'inputs');
	check('adding ports stops at 32', body(crowded)?.inputs.length, 32);

	// Chips inside a body count what the analysis inlines: a call of the body itself is refused
	// there, so its chip is nothing, not the body once more.
	const selfish: ShaderGraphDoc = {
		...newShaderDoc('selfish', 'Selfish'),
		nodes: [
			{ id: 'out', type: 'output', x: 400, y: 0 },
			{ id: 'c', type: 'subgraph', x: 0, y: 0, values: { subgraph: 'x' } },
		],
		wires: [{ from: { node: 'c', port: 'o1' }, to: { node: 'out', port: 'color' } }],
		subgraphs: [
			{
				id: 'x',
				name: 'X',
				inputs: [],
				outputs: [
					{ id: 'o1', label: 'o1', type: 'float' },
					{ id: 'o2', label: 'o2', type: 'float' },
				],
				nodes: [
					{ id: 'i', type: 'subgraphIn', x: 0, y: 0 },
					{ id: 'cells', type: 'cells', x: 0, y: 0 },
					{ id: 'k', type: 'subgraph', x: 0, y: 0, values: { subgraph: 'x' } },
					{ id: 'o', type: 'subgraphOut', x: 0, y: 0 },
				],
				wires: [
					{ from: { node: 'cells', port: 'nearest' }, to: { node: 'o', port: 'o1' } },
					{ from: { node: 'k', port: 'o1' }, to: { node: 'o', port: 'o2' } },
				],
			},
		],
	};
	check(
		'inside X, a call of X is refused by the analysis, and its chip is nothing; the Cells beside it 120',
		[
			analyzeScope(selfish, 'x').issues.some(
				(i) => i.node === 'k' && /X calls itself/.test(i.message),
			),
			nodeCosts(viewOf(selfish, 'x'), analyzeScope(selfish, 'x'), 'x').get('k')?.cost,
			nodeCosts(viewOf(selfish, 'x'), analyzeScope(selfish, 'x'), 'x').get('cells')?.cost,
		],
		[true, 0, 120],
	);
}

// ── 10 ──
console.log('10. the motion graph');
{
	const M = MOTION_SCOPE;
	const motionErrors = (d: ShaderGraphDoc): string[] =>
		analyzeShaderMotion(d)
			.issues.filter((i) => i.level === 'error')
			.map((i) => i.message);
	const base = REFERENCE_GRAPHS.find((g) => g.id === 'pulseTint') as ShaderGraphDoc;
	const pixelOf = (d: ShaderGraphDoc): string => json({ ...d, motionGraph: undefined });
	check(
		'a graph has no motion graph until given one: the Motion view shows nothing, and viewing it changes nothing',
		[base.motionGraph, viewOf(base, M).nodes, viewOf(base, M).wires, isMotionScope(M)],
		[undefined, [], [], true],
	);
	check('…no subgraph id is its scope', [subgraphScope(M), isMotionScope('motion')], [null, false]);

	// Add: the first node brings the Output, to its right.
	const time = addNodeIn(base, M, 'time', { x: -300, y: 40 });
	let m = time.doc;
	const out = viewOf(m, M).nodes.find((n) => n.type === MOTION_OUTPUT);
	check(
		'the first motion node brings the Motion Output, to its right; the pixel graph is untouched',
		[
			viewOf(m, M)
				.nodes.map((n) => n.type)
				.sort(),
			!!out && out.x > -300,
			pixelOf(m) === pixelOf(base),
		],
		[[MOTION_OUTPUT, 'time'].sort(), true, true],
	);
	const osc = addNodeIn(m, M, 'oscillate', { x: -100, y: 40 });
	m = osc.doc;
	check(
		'a second node is added alone, with an id neither graph has',
		[
			viewOf(m, M).nodes.filter((n) => n.type === MOTION_OUTPUT).length,
			viewOf(m, M).nodes.length,
			base.nodes.some((n) => n.id === osc.id || n.id === time.id),
		],
		[1, 3, false],
	);
	const clash = addNodeIn(
		{ ...base, nodes: [...base.nodes, { id: 'time1', type: 'time', x: 0, y: 0 }] },
		M,
		'time',
		{ x: 0, y: 0 },
	);
	check('…a pixel node’s id is taken there too (time1 → time2)', clash.id, 'time2');
	const outId = out?.id ?? '';

	// Wire: floats alone.
	let a10 = motionAnalysis(m);
	check(
		'Time’s progress feeds Oscillate; Oscillate feeds the Output’s rotation',
		[
			canConnect(m, a10, { node: time.id, port: 'progress' }, { node: osc.id, port: 't' }, M),
			canConnect(m, a10, { node: osc.id, port: 'out' }, { node: outId, port: 'rotation' }, M),
		],
		[true, true],
	);
	m = inScope(m, M, (d) =>
		connect(d, { node: time.id, port: 'progress' }, { node: osc.id, port: 't' }),
	);
	m = inScope(m, M, (d) =>
		connect(d, { node: osc.id, port: 'out' }, { node: outId, port: 'rotation' }),
	);
	m = inScope(m, M, (d) => setNodeValue(d, osc.id, 'rate', 2));
	a10 = motionAnalysis(m);
	check(
		'…the wires and the value land in the motion graph, which compiles; the pixel graph is untouched',
		[
			m.motionGraph?.wires.length,
			m.motionGraph?.nodes.find((n) => n.id === osc.id)?.values?.rate,
			motionErrors(m),
			errors(m),
			compileShaderEffect(m).ok,
			pixelOf(m) === pixelOf(base),
		],
		[2, 2, [], [], true, true],
	);
	const stray = inScope(m, M, (d) => addNode(d, 'uv', { x: 0, y: 0 }).doc);
	check(
		'a vec2 never feeds a motion input, and nothing feeds itself',
		[
			canConnect(
				stray,
				motionAnalysis(stray),
				{ node: 'uv1', port: 'out' },
				{ node: outId, port: 'x' },
				M,
			),
			canConnect(m, a10, { node: osc.id, port: 'out' }, { node: osc.id, port: 'rate' }, M),
		],
		[false, false],
	);
	const adder = addNodeIn(m, M, 'add', { x: 0, y: 120 });
	const looped = inScope(adder.doc, M, (d) =>
		connect(d, { node: osc.id, port: 'out' }, { node: adder.id, port: 'a' }),
	);
	check(
		'a wire closing a loop through another node is refused there too; an unknown port takes nothing',
		[
			canConnect(
				looped,
				motionAnalysis(looped),
				{ node: adder.id, port: 'out' },
				{ node: osc.id, port: 'rate' },
				M,
			),
			canConnect(m, a10, { node: time.id, port: 'progress' }, { node: osc.id, port: 'nope' }, M),
		],
		[false, false],
	);
	check(
		'only motion nodes can be placed in it, and its Output only when it lost one; a motion-only node never in the pixel graph',
		[
			canPlace(m, M, 'oscillate'),
			canPlace(m, M, 'uv'),
			canPlace(m, M, 'sample'),
			canPlace(m, M, MOTION_OUTPUT),
			canPlace(m, null, MOTION_OUTPUT),
			canPlace(m, null, 'shape'),
			missingBoundary(m, M),
			missingBoundary(
				inScope(m, M, (d) => ({ ...d, nodes: d.nodes.filter((n) => n.id !== outId) })),
				M,
			),
		],
		[true, false, false, false, false, false, [], [MOTION_OUTPUT]],
	);
	check(
		'the channels it drives, for the settings to say so',
		[drivenChannels(base), drivenChannels(m)],
		[[], ['rotation']],
	);
	const curved = setMotionChannel({ ...m, padding: 0.25 }, 'x', restCurve('x'));
	check(
		'…what each channel left unwired plays instead: its curve, rest, or the effect’s padding',
		[undrivenChannels(curved).x, undrivenChannels(curved).y, undrivenChannels(curved).padding],
		['curve', 'rest', '0.25'],
	);

	// Move, select, delete; the canvas.
	const moved = inScope(m, M, (d) => moveNode(d, osc.id, 12.4, 80.6));
	check(
		'a move lands in the motion graph',
		[moved.motionGraph?.nodes.find((n) => n.id === osc.id)?.x, pixelOf(moved) === pixelOf(base)],
		[12, true],
	);
	const canvas = canvasGraph(m, a10, new Set([time.id, osc.id]), false, M);
	const node10 = (id: string) => canvas.nodes.find((n) => n.id === id);
	check(
		'the canvas shows the motion graph: a box selection, the Output pinned, curves not thumbnails, no cost chips',
		[
			canvas.nodes.map((n) => n.id).sort(),
			canvas.nodes
				.filter((n) => n.selected)
				.map((n) => n.id)
				.sort(),
			node10(outId)?.deletable,
			node10(osc.id)?.deletable,
			canvas.nodes.some((n) => n.data.thumb || n.data.cost),
			node10(osc.id)?.data.curve,
			node10(outId)?.data.curve,
			node10(outId)?.data.undriven?.x,
			canvas.edges.length,
		],
		[
			[outId, osc.id, time.id].sort(),
			[osc.id, time.id].sort(),
			false,
			true,
			false,
			true,
			false,
			'rest',
			2,
		],
	);
	check(
		'the Output stays while other nodes do; the wires into what goes go too',
		[
			viewOf(
				inScope(m, M, (d) => remove(d, [outId, osc.id], [], M)),
				M,
			)
				.nodes.map((n) => n.id)
				.sort(),
			inScope(m, M, (d) => remove(d, [osc.id], [], M)).motionGraph?.wires.length,
		],
		[[outId, time.id].sort(), 0],
	);
	const alone = inScope(m, M, (d) => remove(d, [time.id, osc.id], [], M));
	check(
		'alone, the Output can be deleted, and the motion graph goes with it',
		[
			canvasGraph(alone, motionAnalysis(alone), new Set(), false, M).nodes[0]?.deletable,
			inScope(alone, M, (d) => remove(d, [outId], [], M)).motionGraph,
		],
		[true, undefined],
	);
	check(
		'deleting the whole motion graph leaves everything else as it was',
		[deleteMotionGraph(m).motionGraph, pixelOf(deleteMotionGraph(m)) === pixelOf(m)],
		[undefined, true],
	);
	const locked = canvasGraph(m, a10, new Set(), true, M);
	check(
		'read-only, nothing in it moves, wires or deletes',
		locked.nodes.some((n) => n.draggable || n.connectable || n.deletable) ||
			locked.edges.some((e) => e.deletable),
		false,
	);

	// Undo: each gesture leaves the doc it was given, so the step before is the doc before.
	const before = json(m);
	inScope(m, M, (d) =>
		connect(d, { node: time.id, port: 'seconds' }, { node: osc.id, port: 'phase' }),
	);
	inScope(m, M, (d) => remove(d, [osc.id], [], M));
	inScope(m, M, (d) => setNodeValue(d, osc.id, 'rate', 5));
	addNodeIn(m, M, 'bell', { x: 0, y: 0 });
	deleteMotionGraph(m);
	check(
		'no gesture changes the doc it was given, so undo restores it exactly; undoing the first node leaves no motion graph',
		[json(m) === before, base.motionGraph],
		[true, undefined],
	);

	// Errors on their nodes, counted with the pixel graph's.
	const picked = addNodeIn(m, M, 'param', { x: -300, y: 200 });
	const unpicked = inScope(picked.doc, M, (d) =>
		connect(d, { node: picked.id, port: 'out' }, { node: outId, port: 'x' }),
	);
	const bad = canvasGraph(unpicked, motionAnalysis(unpicked), new Set(), false, M);
	check(
		'an error shows on its motion node, not on the pixel canvas, and the effect does not compile',
		[
			(bad.nodes.find((n) => n.id === picked.id)?.data.errors.length ?? 0) > 0,
			canvasGraph(unpicked, analyzeShaderGraph(unpicked), new Set()).nodes.some(
				(n) => n.data.errors.length,
			),
			motionErrors(unpicked).length > 0,
			compileShaderEffect(unpicked).ok,
		],
		[true, false, true, false],
	);
	check(
		'a motion Param reading a number param is sound; renaming the param follows it in the motion graph',
		(() => {
			const withParam = addParam(addParam(unpicked, 'number'), 'color');
			const set = inScope(withParam, M, (d) => setNodeValue(d, picked.id, 'param', 'number1'));
			const at = set.params.findIndex((p) => p.id === 'number1');
			const renamed10 = setParam(set, at, {
				...set.params[at],
				id: 'amount',
			} as ShaderGraphDoc['params'][number]);
			return [
				motionErrors(set),
				renamed10.motionGraph?.nodes.find((n) => n.id === picked.id)?.values?.param,
				motionErrors(renamed10),
			];
		})(),
		[[], 'amount', []],
	);

	// Subgraphs are the pixel graph's.
	check(
		'subgraph gestures are off in it, saying why',
		[
			groupable(m, M, [time.id, osc.id]),
			groupRefusal(m, M, [time.id]),
			groupRefusal(m, M, []),
			groupNodes(m, M, [time.id, osc.id], 'G'),
			ungroupRefusal(m, M, osc.id),
			ungroupCall(m, M, osc.id),
		],
		[[], SUBGRAPHS_PIXEL_ONLY, undefined, undefined, SUBGRAPHS_PIXEL_ONLY, undefined],
	);

	// The palette.
	const motionPalette = libraryGroups(true).flatMap((g) => g.nodes.map((n) => n.type));
	check(
		'the motion palette offers motion nodes only, by family, and no Output; the pixel palette no motion-only node',
		[
			motionPalette.length > 10,
			motionPalette.every((t) => isMotionNode(t)),
			motionPalette.includes(MOTION_OUTPUT),
			MOTION_NODE_TYPES.filter((t) => t !== MOTION_OUTPUT).every((t) => motionPalette.includes(t)),
			libraryGroups().some((g) =>
				g.nodes.some((n) => n.type === MOTION_OUTPUT || n.type === 'shape'),
			),
		],
		[true, true, false, true, false],
	);

	// Curves.
	const curves = motionCurves(m);
	const ramp = curves.get(time.id) ?? undefined;
	const wave = curves.get(osc.id) ?? undefined;
	check(
		'Time’s curve is its progress, 0…1 over the play; Oscillate at rate 2 goes round twice, −1…1',
		[
			ramp?.port,
			ramp?.values.length,
			ramp && [ramp.min, ramp.max],
			ramp && Math.abs(ramp.values[32] - 0.5) < 1e-9,
			wave && [Math.round(wave.min * 1e6) / 1e6, Math.round(wave.max * 1e6) / 1e6],
			wave && Math.abs(wave.values[8]) > 0.99,
		],
		['progress', CURVE_SAMPLES, [0, 1], true, [-1, 1], true],
	);
	check(
		'no curve for a constant (Number, Param, Seed) or the Output; a broken one has none to draw',
		[
			hasMotionCurve({ id: 'n', type: 'number', x: 0, y: 0 }),
			hasMotionCurve({ id: 's', type: 'seed', x: 0, y: 0 }),
			curves.has(outId),
			motionCurves(unpicked).get(picked.id),
		],
		[false, false, false, null],
	);
	// A curve is worked out from the whole graph each time: one that could not be (a pixel node
	// elsewhere) comes back once the graph is sound, though its own node and upstream are unchanged.
	const strayUv = addNodeIn(m, M, 'uv', { x: 0, y: 400 });
	check(
		'a curve the rest of the graph broke comes back when the graph is mended',
		[
			motionCurves(strayUv.doc).get(osc.id),
			!!motionCurves(inScope(strayUv.doc, M, (v) => remove(v, [strayUv.id], [], M))).get(osc.id),
		],
		[null, true],
	);
	{
		const chain = (n: number): ShaderGraphDoc => {
			let doc = m;
			let last = '';
			for (let i = 0; i < n; i++) {
				const add = addNodeIn(doc, M, 'add', { x: i * 10, y: 600 });
				doc = last
					? inScope(add.doc, M, (d) =>
							connect(d, { node: last, port: 'out' }, { node: add.id, port: 'a' }),
						)
					: add.doc;
				last = add.id;
			}
			return doc;
		};
		const long = chain(240);
		const began = performance.now();
		const all = motionCurves(long);
		const ms = performance.now() - began;
		check(
			`every curve of a 240-node chain comes from one pass, quickly (${ms.toFixed(0)} ms)`,
			[[...all.values()].filter((c) => c).length >= 240, ms < 300],
			[true, true],
		);
	}
	check(
		'the playhead reads the curve between its samples',
		ramp && [curvePoint(ramp, 0.25), curvePoint(ramp, 2)],
		[
			{ x: 0.25, y: 0.25 },
			{ x: 1, y: 1 },
		],
	);
	check(
		'a motion edit leaves the pixel thumbnails’ keys; a motion node has no thumbnail, cost chip or probe',
		[
			json([...probeKeys(m)]) === json([...probeKeys(base)]),
			hasThumbnail(viewOf(m, M).nodes[0], a10, m, M),
			nodeCosts(viewOf(m, M), a10, M).size,
			probeDoc(m, osc.id, a10, M),
		],
		[true, false, 0, undefined],
	);

	// A broken motion graph fails the effect, never the pixel thumbnails.
	const brokenMotion: ShaderGraphDoc = {
		...frost,
		motionGraph: { nodes: [{ id: 'm1', type: 'uv', x: 0, y: 0 }], wires: [] },
	};
	const brokenA = analyzeShaderGraph(brokenMotion);
	const drawn = brokenMotion.nodes.find((n) => hasThumbnail(n, brokenA));
	const pixelProbe = drawn && probeDoc(brokenMotion, drawn.id, brokenA);
	check(
		'a broken motion graph leaves the pixel thumbnails: a probe carries no motion graph',
		[
			compileShaderEffect(brokenMotion).ok,
			pixelProbe?.doc.motionGraph,
			!!pixelProbe && compileShaderEffect(pixelProbe.doc).ok,
		],
		[false, undefined, true],
	);

	// Storage.
	check(
		'storage keeps the motion graph as built',
		json(normalizeShaderGraphDoc(JSON.parse(json(m)), m.id).motionGraph),
		json(m.motionGraph),
	);
}

// ── 11 ──
console.log('11. the Break Output');
{
	const B = BREAK_OUTPUT;
	const breakErrors = (doc: ShaderGraphDoc, node: string, port?: string): string[] =>
		analyzeShaderGraph(doc)
			.issues.filter(
				(i) =>
					i.level === 'error' &&
					i.code === 'break' &&
					i.node === node &&
					(port === undefined || i.port === port),
			)
			.map((i) => i.message);
	const pulse = REFERENCE_GRAPHS.find((d) => d.id === 'pulseTint') as ShaderGraphDoc;
	const base: ShaderGraphDoc = { ...JSON.parse(json(pulse)), id: 'brk', name: 'Brk' };

	// The palette.
	const inGroup = groupNodes(base, null, ['colorize6'], 'G');
	check(
		'the palette offers a Break Output in the effect’s own graph while it has none, greyed out in a subgraph saying why, never in Motion; the pixel library lists none',
		[
			breakPaletteEntry(base, null),
			breakPaletteEntry(base, MOTION_SCOPE),
			inGroup && breakPaletteEntry(inGroup.doc, inGroup.subgraph),
			canPlace(base, null, B),
			canPlace(base, MOTION_SCOPE, B),
			inGroup && canPlace(inGroup.doc, inGroup.subgraph, B),
			breakPlacement(base, MOTION_SCOPE),
			libraryGroups().some((g) => g.nodes.some((n) => n.type === B)),
			libraryGroups(true).some((g) => g.nodes.some((n) => n.type === B)),
		],
		[
			{ refusal: '' },
			undefined,
			{ refusal: BREAK_NOT_IN_SUBGRAPH },
			true,
			false,
			false,
			BREAK_PIXEL_ONLY,
			false,
			false,
		],
	);

	// Add.
	const added = addNodeIn(base, null, B, { x: 360, y: 220 });
	let d = added.doc;
	const brk = added.id;
	check(
		'it adds as one node of the effect’s graph, then is offered no more (one per effect)',
		[
			brk,
			d.nodes.filter((n) => n.type === B).length,
			breakOutputOf(d)?.id,
			breakPaletteEntry(d, null),
			canPlace(d, null, B),
			breakPlacement(d, null),
			d.motionGraph,
		],
		['breakOutput1', 1, brk, undefined, false, BREAK_ONLY_ONE, undefined],
	);
	const shatter = elementFxSpec(BREAK_KIND_DEFAULT);
	let canvas = canvasGraph(d, analyzeShaderGraph(d), new Set([brk]));
	let view = canvas.nodes.find((n) => n.id === brk);
	check(
		'on the canvas: the break’s label in its header, a port per param of the break with the catalog’s labels, no output, thumbnail or cost chip; it deletes',
		[
			view?.data.summary,
			view?.data.def?.inputs.map((p) => [p.id, p.label]),
			view?.data.def?.outputs.length,
			view?.data.thumb,
			view?.data.cost,
			view?.deletable,
		],
		[shatter.label, shatter.params.map((p) => [p.id, p.label]), 0, false, undefined, true],
	);
	check(
		'…a fresh one plays the default break from the start of the play, its ports at the break’s defaults: a choice by its option',
		[view?.data.breakValues, BREAK_KIND_DEFAULT, BREAK_AT_DEFAULT],
		[
			Object.fromEntries(shatter.params.map((p) => [p.id, { text: String(p.default) }])),
			'shatter',
			0,
		],
	);
	check(
		'…its only error is the phase (a loop effect cannot break), on the node and not the doc; it costs nothing',
		[
			breakErrors(d, brk).length,
			/exit/.test(breakErrors(d, brk)[0] ?? ''),
			docIssues(d, analyzeShaderGraph(d)),
			analyzeShaderGraph(d).cost === analyzeShaderGraph(base).cost,
		],
		[1, true, [], true],
	);

	// The phase.
	const wrong = breakPhaseMismatch(d);
	const fixed = setPhase(d, wrong?.phase ?? 'exit');
	check(
		'the phase it needs is one fix away: Exit for Shatter, the fix clearing the error; Assemble needs Enter',
		[
			wrong && { kind: wrong.kind, phase: wrong.phase },
			breakErrors(fixed, brk),
			breakPhaseMismatch(fixed),
			compileShaderEffect(fixed).ok,
			breakPhaseMismatch(setBreakKind(fixed, brk, 'assemble').doc)?.phase,
			breakPhaseMismatch(setPhase(setBreakKind(fixed, brk, 'assemble').doc, 'enter')),
			setPhase(fixed, 'exit') === fixed,
		],
		[{ kind: 'shatter', phase: 'exit' }, [], undefined, true, 'enter', undefined, true],
	);
	d = fixed;
	check(
		'the effect compiles with its break: the kind, where it starts, every param at the break’s default',
		(() => {
			const r = compileShaderEffect(d);
			return r.ok ? r.effect.break : r.issues;
		})(),
		{
			kind: 'shatter',
			at: 0,
			params: Object.fromEntries(shatter.params.map((p) => [p.id, p.default])),
		},
	);

	// Values, per param kind.
	d = setBreakKind(d, brk, 'crystallize').doc;
	d = setPhase(d, 'exit');
	const crystal = elementFxSpec('crystallize');
	const set = [
		['pieces', 9999],
		['color', '#AABBCC'],
		['from', 2],
		['gravity', '1.5'],
	] as const;
	for (const [port, value] of set) d = setBreakValue(d, brk, port, value);
	const node = () => d.nodes.find((n) => n.id === brk);
	check(
		'set as the break stores them: a number kept within its range, a colour as #rrggbb, a choice by its option (from its place too), a typed number read; the break reads each and none is an error',
		[
			node()?.values,
			crystal.params.every(
				(p) =>
					node()?.values?.[p.id] === undefined ||
					readBreakValue(p, node()?.values?.[p.id]) !== undefined,
			),
			breakErrors(d, brk),
		],
		[{ kind: 'crystallize', pieces: 80, color: '#aabbcc', from: 'top', gravity: 1.5 }, true, []],
	);
	check(
		'…a value the param cannot take changes nothing; cleared, it reads the default again',
		[
			setBreakValue(d, brk, 'color', 'red') === d,
			setBreakValue(d, brk, 'from', 'sideways') === d,
			setBreakValue(d, brk, 'pieces', Number.NaN) === d,
			setBreakValue(d, brk, 'nope', 1) === d,
			setBreakValue(d, brk, 'pieces', undefined).nodes.find((n) => n.id === brk)?.values?.pieces,
		],
		[true, true, true, true, undefined],
	);
	check(
		'each unwired port shows what it reads: a number, a colour with its swatch, a choice its option, a default as such',
		breakPortValues(node() as NonNullable<ReturnType<typeof node>>),
		{
			color: { text: '#aabbcc', swatch: '#aabbcc' },
			from: { text: 'top' },
			pieces: { text: '80' },
			freeze: { text: '0.45' },
			gravity: { text: '1.5' },
		},
	);
	const sw = { id: 'on', label: 'On', kind: 'bool', default: true } as const;
	const ch = elementFxSpec('shatter').params[0];
	check(
		'…a switch on or off, a choice stored by its place, a value the break cannot read shown as it is, marked',
		[
			breakPortValue(sw, undefined),
			breakPortValue(sw, 0),
			breakPortValue(sw, 1),
			breakPortValue(ch, 3),
			breakPortValue(elementFxSpec('crash').params[0], 500),
		],
		[
			{ text: 'on' },
			{ text: 'off' },
			{ text: 'on' },
			{ text: 'bottom' },
			{ text: '500', bad: true },
		],
	);
	check(
		'Starts at: kept 0…1, cleared to the default; it reads in ms, an Assemble’s where its pieces have flown in',
		[
			setBreakAt(d, brk, 1.5).nodes.find((n) => n.id === brk)?.values?.at,
			setBreakAt(d, brk, -1).nodes.find((n) => n.id === brk)?.values?.at,
			setBreakAt(setBreakAt(d, brk, 0.4), brk, undefined).nodes.find((n) => n.id === brk)?.values
				?.at,
			setBreakAt(d, brk, Number.NaN) === d,
			breakEdgeMs('crumble', 0.3, 1800),
			breakEdgeMs('assemble', 0.3, 1800),
		],
		[1, 0, undefined, true, 540, 1260],
	);

	// The wire rule: the engine's, over every source and port kind.
	const ports = { number: 'pieces', color: 'color', choice: 'from' } as const;
	let w = setPhase(
		setBreakKind(addNodeIn(base, null, B, { x: 360, y: 220 }).doc, brk, 'crystallize').doc,
		'exit',
	);
	w = addParam(
		addParam(addParam(addParam(addParam(w, 'number'), 'color'), 'bool'), 'choice'),
		'choice',
	);
	/** `doc` with choice param `id` offering `options` (its default the first). */
	const withOptions = (
		doc: ShaderGraphDoc,
		id: string,
		options: readonly string[],
	): ShaderGraphDoc => {
		const at = doc.params.findIndex((p) => p.id === id);
		return setParam(doc, at, {
			id,
			label: doc.params[at].label,
			kind: 'choice',
			options: [...options],
			default: options[0],
		});
	};
	const fromSpec = crystal.params.find((p) => p.id === 'from');
	w = withOptions(w, 'choice1', fromSpec?.kind === 'choice' ? [...fromSpec.options].reverse() : []);
	const sources: { name: string; type: string; values?: Record<string, number | string> }[] = [
		{ name: 'a number param', type: 'param', values: { param: 'number1' } },
		{ name: 'a colour param', type: 'param', values: { param: 'color1' } },
		{ name: 'a switch param', type: 'param', values: { param: 'bool1' } },
		{ name: 'a choice param of the same options', type: 'param', values: { param: 'choice1' } },
		{ name: 'a choice param of others', type: 'param', values: { param: 'choice2' } },
		{ name: 'a Param with none picked', type: 'param' },
		{ name: 'a Number', type: 'number', values: { value: 30 } },
		{ name: 'a Colour', type: 'color', values: { value: '#336699' } },
		{ name: 'UV', type: 'uv' },
		{ name: 'Sample element', type: 'sample' },
		{ name: 'Add', type: 'add' },
		{ name: 'Time', type: 'time' },
		{ name: 'Seed', type: 'seed' },
	];
	const disagree: string[] = [];
	let pairs = 0;
	let refusedPairs = 0;
	for (const source of sources) {
		const placed = addNode(w, source.type, { x: -200, y: 400 });
		const withSource = source.values
			? Object.entries(source.values).reduce(
					(doc, [k, v]) => setNodeValue(doc, placed.id, k, v),
					placed.doc,
				)
			: placed.doc;
		const outPort = shaderNode(source.type)?.outputs[0]?.id ?? 'out';
		for (const [kind, port] of Object.entries(ports)) {
			pairs += 1;
			const from = { node: placed.id, port: outPort };
			const to = { node: brk, port };
			const taken = canConnect(withSource, analyzeShaderGraph(withSource), from, to);
			const said = breakFeedRefusal(withSource, from, to);
			const engine = breakErrors(connect(withSource, from, to), brk, port);
			if (!taken) refusedPairs += 1;
			const ok =
				taken === !engine.length &&
				(said ?? '') ===
					(engine[0] ? `${engine[0].charAt(0).toUpperCase()}${engine[0].slice(1)}.` : '');
			if (!ok)
				disagree.push(
					`${source.name} → ${kind}: taken ${taken}, said ${said}, engine ${engine.join('; ')}`,
				);
		}
	}
	check(
		`the wire rule is the engine’s over ${pairs} source × port-kind pairs (every port kind a break has: number, colour, choice; none has a switch), refusing ${refusedPairs} with the engine’s own words`,
		[
			disagree,
			refusedPairs > 20,
			refusedPairs < pairs - 5,
			BREAK_KINDS.every((k) => elementFxSpec(k).params.every((p) => p.kind !== 'bool')),
		],
		[[], true, true, true],
	);
	{
		const num = addNode(w, 'number', { x: -200, y: 400 });
		const from = { node: num.id, port: 'out' };
		const to = { node: brk, port: 'pieces' };
		const wired = connect(num.doc, from, to);
		check(
			'a Number past the port’s range is taken as a wire (mended on the Number): the error is on the Break Output until then',
			[
				canConnect(num.doc, analyzeShaderGraph(num.doc), from, to),
				breakErrors(wired, brk, 'pieces').length,
				breakErrors(setNodeValue(wired, num.id, 'value', 40), brk, 'pieces'),
				canConnect(w, analyzeShaderGraph(w), { node: brk, port: 'pieces' }, to),
			],
			[true, 1, [], false],
		);
		const uv = addNode(num.doc, 'uv', { x: -200, y: 600 });
		const shown = canvasGraph(uv.doc, analyzeShaderGraph(uv.doc), new Set()).nodes.find(
			(n) => n.id === brk,
		);
		check(
			'the canvas knows why each port refuses each node, in the engine’s words, and names none it takes',
			[
				shown?.data.refusals?.pieces?.[uv.id] ===
					breakFeedRefusal(uv.doc, { node: uv.id, port: 'out' }, to),
				!!shown?.data.refusals?.color?.[num.id],
				shown?.data.refusals?.pieces?.[num.id],
				Object.keys(shown?.data.refusals ?? {}),
				canvasGraph(uv.doc, analyzeShaderGraph(uv.doc), new Set()).nodes.find((n) => n.id === uv.id)
					?.data.refusals,
			],
			[true, true, undefined, crystal.params.map((p) => p.id), undefined],
		);
	}

	// A kind change drops what the new break lacks, in one step.
	let k = setPhase(
		setBreakKind(addNodeIn(base, null, B, { x: 360, y: 220 }).doc, brk, 'shatter').doc,
		'exit',
	);
	k = addParam(addParam(k, 'number'), 'choice');
	k = withOptions(k, 'choice1', ch.kind === 'choice' ? ch.options : []);
	const p1 = addNode(k, 'param', { x: -300, y: 300 });
	const p2 = addNode(p1.doc, 'param', { x: -300, y: 400 });
	const n1 = addNode(p2.doc, 'number', { x: -300, y: 500 });
	k = setNodeValue(
		setNodeValue(setNodeValue(n1.doc, p1.id, 'param', 'number1'), p2.id, 'param', 'choice1'),
		n1.id,
		'value',
		0.2,
	);
	k = connect(k, { node: p1.id, port: 'out' }, { node: brk, port: 'gravity' });
	k = connect(k, { node: p2.id, port: 'out' }, { node: brk, port: 'impact' });
	k = connect(k, { node: n1.id, port: 'out' }, { node: brk, port: 'crack' });
	k = setBreakValue(
		setBreakValue(setBreakAt(k, brk, 0.25), brk, 'pieces', 150),
		brk,
		'impact',
		'top',
	);
	check(
		'Shatter, wired and set, compiles with its ties',
		[
			analyzeShaderGraph(k)
				.issues.filter((i) => i.level === 'error')
				.map((i) => i.message),
			compileShaderEffect(k).ok,
		],
		[[], true],
	);
	const before = json(k);
	const toCrumble = setBreakKind(k, brk, 'crumble');
	check(
		'to Crumble: Impact (wired and set) and Cracking (wired) go, named; Gravity’s wire stays; Shards 150 stays in Crumble’s range; Starts at stays; it compiles; the notice says so',
		[
			toCrumble.dropped,
			toCrumble.reset,
			toCrumble.outOfRange,
			toCrumble.doc.wires.filter((x) => x.to.node === brk).map((x) => x.to.port),
			toCrumble.doc.nodes.find((n) => n.id === brk)?.values,
			compileShaderEffect(toCrumble.doc).ok,
			breakKindNotice(toCrumble, 'Crumble'),
		],
		[
			[
				{ label: 'Impact', wire: true, value: true },
				{ label: 'Cracking', wire: true, value: false },
			],
			[],
			[],
			['gravity'],
			{ kind: 'crumble', at: 0.25, pieces: 150 },
			true,
			'Crumble has no Impact, Cracking: what was wired or set there was dropped. Undo brings them back.',
		],
	);
	const toCrash = setBreakKind(toCrumble.doc, brk, 'crash');
	check(
		'…then to Crash: nothing to drop, but Shards 150 is past Crash’s 4…60, so it goes back to the default, and the notice says so',
		[
			toCrash.dropped,
			toCrash.reset,
			toCrash.doc.nodes.find((n) => n.id === brk)?.values,
			breakErrors(toCrash.doc, brk),
			breakKindNotice(toCrash, 'Crash'),
		],
		[
			[],
			[{ label: 'Shards', was: '150', why: 'is past Crash’s 4…60', default: '18' }],
			{ kind: 'crash', at: 0.25 },
			[],
			'Shards: 150 is past Crash’s 4…60, so it went back to 18. Undo brings it back.',
		],
	);
	{
		// A Number of 300 into Crumble's Chunks (16…600), then Shatter (16…160): the wire stays, an
		// error until the Number is mended, and the notice says so; a lone wire or value, likewise.
		const n300 = addNode(toCrumble.doc, 'number', { x: -300, y: 600 });
		const wired = connect(
			setNodeValue(n300.doc, n300.id, 'value', 300),
			{ node: n300.id, port: 'out' },
			{ node: brk, port: 'pieces' },
		);
		const toShatter = setBreakKind(wired, brk, 'shatter');
		check(
			'a Number past the new break’s range stays wired, its error named in the engine’s words and in the notice',
			[
				breakErrors(wired, brk),
				toShatter.outOfRange,
				toShatter.reset,
				toShatter.doc.wires.some((x) => x.from.node === n300.id && x.to.port === 'pieces'),
				breakErrors(toShatter.doc, brk),
				breakKindNotice(toShatter, 'Shatter (glass)'),
			],
			[
				[],
				['Shards takes 16…160, not 300'],
				[],
				true,
				['Shards takes 16…160, not 300'],
				'Shards takes 16…160, not 300: set the Number wired into it within that. Undo brings it back.',
			],
		);
		const lone = setBreakValue(
			setBreakValue(toCrumble.doc, brk, 'spread', 1.5),
			brk,
			'pieces',
			300,
		);
		const toCrash2 = setBreakKind(lone, brk, 'crash');
		check(
			'…to Crash from Crumble with Spread set and Shards 300: Spread’s value dropped and Shards reset; with Spread wired instead, its wire; a kind change touching nothing says nothing',
			[
				breakKindNotice(toCrash2, 'Crash'),
				breakKindNotice(setBreakKind(toCrumble.doc, brk, 'crumble'), 'Crumble'),
				breakKindNotice(
					setBreakKind(
						connect(toCrumble.doc, { node: p1.id, port: 'out' }, { node: brk, port: 'spread' }),
						brk,
						'crash',
					),
					'Crash',
				),
			],
			[
				'Crash has no Spread: its value was dropped. Shards: 300 is past Crash’s 4…60, so it went back to 18. Undo brings them back.',
				'',
				'Crash has no Spread: its wire was dropped. Shards: 150 is past Crash’s 4…60, so it went back to 18. Undo brings them back.',
			],
		);
	}
	check('what feeds each wired port, in words', breakPortSources(k, brk), {
		gravity: 'Param · Amount',
		impact: 'Param · Mode',
		crack: 'Number',
	});
	check(
		'no break gesture changes the doc it was given, so undo is the doc before (the wires come back in one step)',
		(() => {
			setBreakKind(k, brk, 'disintegrate');
			setBreakValue(k, brk, 'pieces', 20);
			setBreakAt(k, brk, 0.9);
			setPhase(k, 'enter');
			addNodeIn(k, null, B, { x: 0, y: 0 });
			remove(k, [brk]);
			return [
				json(k) === before,
				setBreakKind(k, brk, 'shatter'),
				setBreakKind(k, 'nope', 'crumble').doc === k,
			];
		})(),
		[
			true,
			{ doc: setBreakKind(k, brk, 'shatter').doc, dropped: [], reset: [], outOfRange: [] },
			true,
		],
	);
	const gone = remove(k, [brk]);
	check(
		'deleting it takes its wires; what fed it reaches nothing then, and says so',
		[
			breakOutputOf(gone),
			gone.wires.some((x) => x.to.node === brk),
			analyzeShaderGraph(gone).issues.some((i) => i.code === 'unreachable' && i.node === p1.id),
			analyzeShaderGraph(k).issues.some((i) => i.code === 'unreachable'),
		],
		[undefined, false, true, false],
	);

	// Read-only, grouping, the motion graph.
	const locked = canvasGraph(k, analyzeShaderGraph(k), new Set(), true).nodes.find(
		(n) => n.id === brk,
	);
	check(
		'read-only, it neither moves, wires nor deletes, and refuses nothing it would have to explain',
		[locked?.draggable, locked?.connectable, locked?.deletable, locked?.data.refusals],
		[false, false, false, {}],
	);
	check(
		'a group never takes it or a node wired into it, saying why; other nodes group as before',
		[
			/^The Break Output and the nodes wired into it/.test(groupRefusal(k, null, [brk]) ?? ''),
			/Leave param\d+ out of the group\.$/.test(groupRefusal(k, null, [p1.id, 'colorize6']) ?? ''),
			groupNodes(k, null, [brk], 'G'),
			groupRefusal(k, null, ['colorize6', 'mix7']),
			!!groupNodes(k, null, ['colorize6', 'mix7'], 'G'),
		],
		[true, true, undefined, undefined, true],
	);
	check(
		'in the motion graph it is no node: nothing places it there',
		[
			canPlace(k, MOTION_SCOPE, B),
			addNodeIn(k, MOTION_SCOPE, B, { x: 0, y: 0 }).doc.motionGraph?.nodes.length === 2,
		],
		[false, true],
	);

	// The twins and storage.
	const breakTwins = BUILTIN_TWINS.filter(isBreakTwin);
	const family = twinGroups().find((g) => g.id === 'break');
	check(
		'Start from a built-in lists the six break twins under Break, by their labels; each starts an effect that compiles with its break, its Break Output showing no error',
		[
			breakTwins.map((t) => t.kind),
			family?.twins.map((t) => t.label),
			breakTwins.every((t) => {
				const started = docFromTwin(t, `${t.kind}_copy`, 'Copy');
				const r = compileShaderEffect(started);
				const out = breakOutputOf(started);
				return (
					r.ok &&
					r.effect.break?.kind === t.kind &&
					!!out &&
					canvasGraph(started, analyzeShaderGraph(started), new Set()).nodes.every(
						(n) => !n.data.errors.length,
					)
				);
			}),
		],
		[[...BREAK_KINDS], BREAK_CHOICES.map((c) => c.label), true],
	);
	check(
		'storage keeps it as built',
		json(normalizeShaderGraphDoc(JSON.parse(json(k)), k.id).nodes.find((n) => n.id === brk)),
		json(k.nodes.find((n) => n.id === brk)),
	);
}

if (failures) {
	console.log(`\ncheck:shader-editor — ${failures} of ${checks} checks FAILED`);
	process.exit(1);
}
console.log(`\ncheck:shader-editor — all ${checks} checks passed`);
