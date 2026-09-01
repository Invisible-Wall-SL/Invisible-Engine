/**
 * Offline fixture for the unexposed-gate warning — run with `node` (Node ≥ 22.18 / 24 strips the
 * types):
 *   node apps/launcher-api/blueprintGates.fixture.ts
 *
 * Runs directly because `src/lib/blueprintGates.ts` is dependency-free by design. This app's
 * `build` is a bare `vite build` that strips types without checking them, so a green build proves
 * nothing here; these assertions are the gate (the `artBounds.fixture.ts` precedent).
 *
 * What it pins, and why each one is a way this has gone wrong:
 *
 *  * It runs against the REAL built-in graph, and the answer it gives is exactly the pair of
 *    booleans that blueprint's own hand-written manifest exposes as params. A heuristic that
 *    disagrees with the one blueprint we know is correctly authored is wrong, whatever it finds.
 *  * The RELAY hop. A gate inside a ComfyUI subgraph is republished as a `Primitive*` node, so the
 *    top-level knob drives nothing that looks like a switch. Counting only direct consumers finds
 *    NOTHING on the graph this whole warning exists for.
 *  * `on_true` / `on_false` are inputs on the switch node itself. Matching the switch by CLASS
 *    rather than by input NAME counts every switch three times.
 *  * A gate already bound to a role, or already exposed as a param, is reachable and must drop off
 *    the list — otherwise the warning never clears and the author learns to ignore it.
 */

import { findUnexposedGates } from './src/lib/blueprintGates.ts';
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.error(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
};

const BUILTIN = '../../services/atlas-tool/blueprints_src/wan22_i2v_flipbook';
const read = (p: string) =>
	JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as Record<string, never>;

console.log('\nthe built-in blueprint is the reference answer');
{
	const graph = read(`${BUILTIN}/workflow.json`);
	const manifest = read(`${BUILTIN}/blueprint.json`) as unknown as {
		params: { key: string; type: string; node: string; field: string }[];
	};
	const gates = findUnexposedGates(graph);
	check(
		'both of its mode switches are found, the one driving the most first',
		gates.map((g) => `${g.node}.${g.field}=${g.value} x${g.switches}`),
		['171.value=false x5', '203.value=false x1'],
	);
	// The blueprint every other one is copied from was authored by hand, months before this
	// warning existed. If the heuristic and that author disagree, the heuristic is wrong.
	//
	// Compared against the manifest's own bool params, narrowed to the ones on a single-input
	// node — the other three booleans it exposes (`lossless`, `refine_foreground`,
	// `invert_output`) sit alongside a dozen siblings on a save/RMBG node, which is a baked
	// setting and not a mode switch. That narrowing is stated here, not read back off `gates`,
	// so this is an equality and not a subset check that would pass on an empty answer.
	const declaredGates = manifest.params
		.filter((p) => p.type === 'bool' && Object.keys(graph[p.node]?.inputs ?? {}).length === 1)
		.map((p) => `${p.node}::${p.field}`)
		.sort();
	check(
		'and they are exactly the mode switches its hand-written manifest exposes',
		gates.map((g) => `${g.node}::${g.field}`).sort(),
		declaredGates,
	);
	check('which is a real answer, not an empty one', declaredGates, ['171::value', '203::value']);
	check('nothing else in a 35-node graph is flagged', gates.length, 2);
	check(
		'a gate already exposed as a param drops off the list',
		findUnexposedGates(graph, [], ['171::value']).map((g) => g.node),
		['203'],
	);
	check(
		'and so does one bound to a role',
		findUnexposedGates(graph, ['171::value', '203::value'], []),
		[],
	);
}

console.log('\nthe relay hop through a subgraph');
{
	// The shape of the imported graph that caused the outage, reduced to its bones: a top-level
	// boolean whose ONLY consumer is a `Primitive*` republished inside a subgraph, which is what
	// actually reaches the switches. The gate drives no switch directly.
	const graph = {
		'361': { class_type: 'PrimitiveBoolean', inputs: { value: false } },
		'129:131': { class_type: 'PrimitiveBoolean', inputs: { value: ['361', 0] } },
		'129:116': {
			class_type: 'ComfySwitchNode',
			inputs: { switch: ['129:131', 0], on_false: ['129:95', 0], on_true: ['129:101', 0] },
		},
		'129:119': {
			class_type: 'ComfySwitchNode',
			inputs: { switch: ['129:131', 0], on_false: ['129:128', 0], on_true: ['129:118', 0] },
		},
		'129:95': { class_type: 'UNETLoader', inputs: { unet_name: 'high.safetensors' } },
		'129:101': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['129:95', 0] } },
		'129:118': { class_type: 'PrimitiveInt', inputs: { value: 4 } },
		'129:128': { class_type: 'PrimitiveInt', inputs: { value: 50 } },
	};
	const gates = findUnexposedGates(graph);
	check('the gate is found through the relay', gates.length, 1);
	check('as the top-level knob, not the subgraph copy', gates[0]?.node, '361');
	check('counting both switches it reaches', gates[0]?.switches, 2);
	check(
		'the relay itself is not offered — its value is wired, so it is not a knob',
		gates.some((g) => g.node === '129:131'),
		false,
	);
	check(
		'and a switch is counted ONCE, not once per data input',
		findUnexposedGates({
			b: { class_type: 'PrimitiveBoolean', inputs: { value: true } },
			s: {
				class_type: 'ComfySwitchNode',
				inputs: { switch: ['b', 0], on_false: ['b', 0], on_true: ['b', 0] },
			},
		})[0]?.switches,
		1,
	);
}

console.log('\nwhat must NOT be flagged');
{
	check(
		'a boolean nothing switches on is just a baked setting',
		findUnexposedGates({
			b: { class_type: 'PrimitiveBoolean', inputs: { value: true } },
			s: { class_type: 'BiRefNetRMBG', inputs: { invert_output: ['b', 0] } },
		}),
		[],
	);
	check(
		'a non-boolean knob is not a gate, however far it fans out',
		findUnexposedGates({
			i: { class_type: 'PrimitiveInt', inputs: { value: 50 } },
			s: { class_type: 'ComfySwitchNode', inputs: { switch: ['i', 0] } },
		}),
		[],
	);
	check(
		'a multi-input node is not a knob even when one input is a boolean',
		findUnexposedGates({
			n: { class_type: 'SaveAnimatedWEBP', inputs: { lossless: true, quality: 80 } },
			s: { class_type: 'ComfySwitchNode', inputs: { switch: ['n', 0] } },
		}),
		[],
	);
	check('an empty graph is not an error', findUnexposedGates({}), []);
	check('nor is a missing one', findUnexposedGates(null), []);
	check(
		'a cycle through relays terminates',
		findUnexposedGates({
			b: { class_type: 'PrimitiveBoolean', inputs: { value: true } },
			r1: { class_type: 'PrimitiveBoolean', inputs: { value: ['b', 0] } },
			r2: { class_type: 'PrimitiveBoolean', inputs: { value: ['r1', 0] } },
			s: { class_type: 'ComfySwitchNode', inputs: { switch: ['r2', 0] } },
		})[0]?.switches,
		1,
	);
}

console.log('\nthe Atlas Maker twin agrees with this one');
{
	// The same warning exists in `services/atlas-tool/ui_server.py`, hand-written in the inline JS
	// of a Python-rendered page. It CANNOT import this module — that page is on the other side of
	// the A/B line in docs/ui-inventory.md — so "keep the two in step by hand" is otherwise just a
	// comment, and the previous pair of hand-maintained heuristics in these two modals did drift
	// until an owner hit it (PR #534). This runs the twin's own source against the same graphs.
	const py = readFileSync(
		new URL('../../services/atlas-tool/ui_server.py', import.meta.url),
		'utf8',
	);
	/** One `function name(...){...}` out of the page source, brace-matched. The page is a
	 * `.format()` template, so its JS braces are DOUBLED — undoubling them is exactly what
	 * `PAGE.format()` does at serve time. */
	const lift = (name: string): string => {
		const at = py.indexOf(`function ${name}(`);
		if (at < 0) throw new Error(`${name} is gone from ui_server.py`);
		let i = py.indexOf('{{', at);
		let depth = 0;
		for (let j = i; j < py.length; j += 2) {
			if (py.startsWith('{{', j)) depth += 1;
			else if (py.startsWith('}}', j)) depth -= 1;
			else {
				j -= 1;
				continue;
			}
			if (depth === 0)
				return py
					.slice(at, j + 2)
					.replaceAll('{{', '{')
					.replaceAll('}}', '}');
		}
		throw new Error(`${name} is unbalanced in ui_server.py`);
	};
	/** The gate-input list is a plain const, not a function — lifted the same way so a change to
	 * the names a switch is recognised by has to be made on both sides or this fails. */
	const gateInputs = py.match(/^const BP_GATE_INPUTS=.*$/m)?.[0];
	if (!gateInputs) throw new Error('BP_GATE_INPUTS is gone from ui_server.py');
	const names = ['bpLinkSource', 'bpFeedIndex', 'bpGateReach', 'bpUnexposedGates'];
	// `bpBoundTargets` and the exposed-param scan both read the live modal DOM; with nothing bound
	// and no rows added, both are empty — which is the state right after a graph is imported, and
	// the moment the warning has to be right.
	const twin = new Function(
		'graph',
		`const _bpGraph = graph;
		 const document = { querySelectorAll: () => [] };
		 const bpBoundTargets = () => new Set();
		 ${gateInputs}
		 ${names.map(lift).join('\n')}
		 return bpUnexposedGates();`,
	) as (g: unknown) => { node: string; field: string; value: boolean; switches: number }[];

	for (const [label, graph] of [
		['the built-in graph', read(`${BUILTIN}/workflow.json`)],
		[
			'a subgraph relay',
			{
				'361': { class_type: 'PrimitiveBoolean', inputs: { value: false } },
				'129:131': { class_type: 'PrimitiveBoolean', inputs: { value: ['361', 0] } },
				a: { class_type: 'ComfySwitchNode', inputs: { switch: ['129:131', 0] } },
				b: { class_type: 'ComfySwitchNode', inputs: { switch: ['129:131', 0] } },
			},
		],
	] as [string, Record<string, never>][]) {
		check(
			`on ${label}, the Atlas Maker twin returns exactly what this module does`,
			twin(graph),
			findUnexposedGates(graph),
		);
	}
}

console.log();
if (failures) {
	console.error(`${failures} FAILED`);
	process.exit(1);
}
console.log('all blueprint-gate fixtures pass');
