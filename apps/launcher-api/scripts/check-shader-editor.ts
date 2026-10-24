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
 *
 *   pnpm --filter launcher-api check:shader-editor
 */
import { isCustomElementFxKind } from 'constants-shared/elementFx';
import {
	analyzeShaderGraph,
	compileShaderEffect,
	compileShaderGraph,
	type ShaderGraphDoc,
} from 'engine-shadergraph';
import { shaderSlug } from '../src/lib/server/projectPaths.ts';
import {
	addNode,
	addParam,
	addPass,
	canConnect,
	canvasGraph,
	connect,
	docIssues,
	libraryGroups,
	moveNode,
	newShaderDoc,
	remove,
	removeParam,
	removePass,
	restCurve,
	setMotionChannel,
	setNodeValue,
	setParam,
	setPass,
	setPivot,
	slugOf,
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

if (failures) {
	console.log(`\ncheck:shader-editor — ${failures} of ${checks} checks FAILED`);
	process.exit(1);
}
console.log(`\ncheck:shader-editor — all ${checks} checks passed`);
