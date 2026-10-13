/**
 * The State Machine panel's edits and preview (Rive plan Phase 5b):
 *   pnpm --filter launcher-api check:component-state-machine-editor
 *
 *  1. editing the draft def: layers, states (the first becomes the entry), transitions (never
 *     from Exit or into Any; Entry sets the entry), conditions, positions;
 *  2. the inputs list: add (a trigger a signal declares adds nothing), remove (from `inputs`,
 *     `signals` AND every condition — reported), rename (everywhere it is read — refused when
 *     taken), defaults and sources;
 *  3. the graph the panel draws: Entry / Any / Exit, states named after their timeline, the
 *     Entry edge, transition labels;
 *  4. the stage preview: `stateMachineDrives` gives, for a state at time t, exactly what the
 *     Timeline panel's `timelineDrives` gives for that timeline at t, merges layers per property
 *     and mixes a blend — the same rules as the game's player;
 *  5. what saves: `normalizeComponent` keeps the editor's positions; the state machine still
 *     travels inside the def, so no new write exists for `check:component-links` to enumerate.
 *
 * What it cannot prove: the xyflow canvas, the panel's Svelte wiring — the owner's browser check.
 */
import { mock } from 'node:test';
import type { CinematicDoc, ComponentDef, LayoutNode, Scene } from 'engine-layout';

const bucket = new Map<string, string>();
const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;
mock.module(server('r2.ts'), {
	namedExports: {
		ConflictError: class extends Error {},
		precondition: () => undefined,
		getObjectTextWithEtag: async (key: string) => {
			const text = bucket.get(key);
			return text === undefined ? null : { text, etag: '"e"' };
		},
		putObjectText: async (key: string, text: string) => {
			bucket.set(key, text);
			return '"e"';
		},
		deleteObject: async (key: string) => void bucket.delete(key),
		deleteObjects: async (keys: string[]) => keys.forEach((k) => bucket.delete(k)),
		listAllObjects: async () => [],
		copyObject: async () => undefined,
		getObjectBytes: async () => null,
		getObjectText: async () => null,
		headObject: async () => null,
		objectExists: async () => false,
		listAllKeys: async () => [],
		listFolder: async () => ({ folders: [], files: [] }),
		listObjects: async () => ({ objects: [], folders: [] }),
		putObjectBytes: async () => '"e"',
		jsonBaseEtag: () => undefined,
		formBaseEtag: () => undefined,
		presignGet: async () => '',
		presignPut: async () => '',
		presignManifestEntries: async (entries: unknown) => entries,
		getObjectStream: async () => null,
	},
});

const E = await import('../src/lib/timeline/stateMachineEdit.ts');
const P = await import('../src/lib/timeline/stateMachinePreview.ts');
const S = await import('../src/lib/timeline/screenTimeline.ts');
const M = await import('../../../packages/engine-layout/src/lib/stateMachine.ts');
const { normalizeComponent } = await import('../src/lib/server/componentStorage.ts');

let failures = 0;
let passes = 0;
function eq(name: string, actual: unknown, expected: unknown): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		passes++;
		return;
	}
	failures++;
	console.error(`✗ ${name}\n    expected ${e}\n    got      ${a}`);
}

const def = (): ComponentDef => ({
	id: 'coin',
	name: 'Coin',
	version: 1,
	scope: 'project',
	category: 'ui',
	root: {
		id: 'root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{ id: 'n_coin', kind: 'sprite', label: 'Coin', x: 0, y: 0 },
			{ id: 'n_glow', kind: 'sprite', label: 'Glow', x: 0, y: 0 },
		],
	} as unknown as ComponentDef['root'],
	signals: [{ key: 'win' }],
});
const scene = (d: ComponentDef): Scene => ({ id: 's', name: 'Coin', nodes: d.root.children });
const timeline = (
	id: string,
	channels: Record<string, { time: number; value: number }[]>,
	target = 'Coin',
): CinematicDoc =>
	({
		...S.newComponentTimeline({ id, name: id, componentId: 'coin' }),
		duration: 1,
		stage: { sceneId: null, cast: [{ actorId: 'a', kind: 'node', target, place: {} }] },
		tracks: [{ id: 'p', kind: 'property', actorId: 'a', channels }],
	}) as unknown as CinematicDoc;
const names = new Map([
	['c_coin_idle', 'Idle'],
	['c_coin_win', 'Win'],
]);

// ---- 1. editing ------------------------------------------------------------------------------

{
	const d = def();
	const layer = E.addLayer(d, 'Main');
	eq(
		'a layer gets a slug id and its name',
		[layer.id, layer.name, layer.entry],
		['Main', 'Main', ''],
	);
	const idle = E.addState(layer, { id: 'c_coin_idle', name: 'Idle' });
	const win = E.addState(layer, { id: 'c_coin_win', name: 'Win' });
	eq(
		'states are named after their timeline, ids slugged, the first is the entry',
		[idle.id, win.id, layer.entry, idle.name],
		['Idle', 'Win', 'Idle', undefined],
	);
	eq('a state gets a default card position', idle.pos, E.defaultStatePos(0));
	const again = E.addState(layer, { id: 'c_coin_win', name: 'Win' }, { name: 'Big win' });
	eq(
		'a custom name is kept, and a duplicate id is suffixed',
		[again.id, again.name],
		['Big_win', 'Big win'],
	);
	const t = E.addTransition(layer, 'Idle', 'Win');
	eq('a transition gets a unique id', t?.id, 't_Idle_Win');
	eq(
		'…and no transition leaves Exit, enters Any or names an unknown state',
		[
			E.addTransition(layer, 'exit', 'Idle'),
			E.addTransition(layer, 'Idle', 'any'),
			E.addTransition(layer, 'Idle', 'nope'),
		],
		[undefined, undefined, undefined],
	);
	eq(
		'Any → state and state → Exit are fine',
		[E.addTransition(layer, 'any', 'Win')?.from, E.addTransition(layer, 'Win', 'exit')?.to],
		['any', 'exit'],
	);
	E.addCondition(t!, { id: 'win', kind: 'trigger' });
	E.addCondition(t!, { id: 'amount', kind: 'number' });
	eq('conditions start with the first op of the kind', t!.conditions, [
		{ input: 'win', op: 'fired' },
		{ input: 'amount', op: '>', value: 0 },
	]);
	E.removeCondition(t!, 1);
	E.removeCondition(t!, 0);
	eq('removing the last condition drops the key', 'conditions' in t!, false);
	eq(
		'Entry wired to a state sets the entry',
		[E.connect(layer, E.ENTRY_NODE, 'Win'), layer.entry],
		[undefined, 'Win'],
	);
	E.setNodePos(layer, 'Idle', { x: 10.6, y: 20.2 });
	E.setNodePos(layer, E.ANY_NODE, { x: 1, y: 2 });
	eq(
		'positions are rounded and stored on the state / the layer',
		[idle.pos, layer.pseudoPos],
		[{ x: 11, y: 20 }, { any: { x: 1, y: 2 } }],
	);
	E.removeState(layer, 'Win');
	eq(
		'removing a state drops its transitions and moves the entry',
		[layer.states.map((s) => s.id), layer.transitions.map((x) => x.id), layer.entry],
		[['Idle', 'Big_win'], [], 'Idle'],
	);
	E.removeLayer(d, 'Main');
	eq('removing the last layer drops the machine from the def', d.stateMachine, undefined);
}

// ---- 2. inputs -------------------------------------------------------------------------------

{
	const d = def();
	eq('a trigger a signal declares adds nothing', E.addInput(d, 'win', 'trigger'), undefined);
	eq(
		'a bool input starts false, a number 0',
		[E.addInput(d, 'isBig', 'bool'), E.addInput(d, 'amount', 'number')],
		[
			{ id: 'isBig', kind: 'bool', default: false },
			{ id: 'amount', kind: 'number', default: 0 },
		],
	);
	E.setInputDefault(d, 'isBig', true);
	E.setInputDefault(d, 'amount', 7);
	E.setInputSource(d, 'amount', ' winAmount ');
	eq('defaults and the source are set (trimmed)', d.inputs, [
		{ id: 'isBig', kind: 'bool', default: true },
		{ id: 'amount', kind: 'number', default: 7, source: 'winAmount' },
	]);
	E.setInputSource(d, 'amount', '');
	eq('an empty source clears it', 'source' in d.inputs![1], false);
	const layer = E.addLayer(d);
	E.addState(layer, { id: 'c_coin_idle', name: 'Idle' });
	E.addState(layer, { id: 'c_coin_win', name: 'Win' });
	const t = E.addTransition(layer, 'Idle', 'Win')!;
	E.addCondition(t, { id: 'win', kind: 'trigger' });
	E.addCondition(t, { id: 'amount', kind: 'number' });
	eq('usage lists the transitions reading an input', E.inputUsage(d, 'win'), [
		'Layer_1/t_Idle_Win',
	]);
	eq(
		'a rename is refused when empty or taken',
		[E.renameInput(d, 'win', ' '), E.renameInput(d, 'win', 'amount')],
		[false, false],
	);
	eq(
		'a rename updates the signal and the condition',
		[E.renameInput(d, 'win', 'potWin'), d.signals, t.conditions![0]],
		[true, [{ key: 'potWin' }], { input: 'potWin', op: 'fired' }],
	);
	eq(
		'…and an input row too',
		[E.renameInput(d, 'amount', 'total'), d.inputs![1].id, t.conditions![1].input],
		[true, 'total', 'total'],
	);
	eq(
		'removing a signal-declared trigger reports the transitions that lose a condition',
		[E.removeInput(d, 'potWin'), d.signals, t.conditions],
		[['Layer_1/t_Idle_Win'], undefined, [{ input: 'total', op: '>', value: 0 }]],
	);
	E.removeInput(d, 'total');
	eq(
		'removing the last condition of a transition leaves it unconditional',
		'conditions' in t,
		false,
	);
}

// ---- 3. the graph ----------------------------------------------------------------------------

{
	const d = def();
	const layer = E.addLayer(d, 'Main');
	const idle = E.addState(layer, { id: 'c_coin_idle', name: 'Idle' });
	E.addState(layer, { id: 'c_coin_win', name: 'Win' }, { name: 'Celebrate' });
	const t = E.addTransition(layer, 'Idle', 'Celebrate')!;
	E.addCondition(t, { id: 'win', kind: 'trigger' });
	t.exitTime = 0.5;
	E.addTransition(layer, 'any', 'exit');
	const g = E.layerGraph(layer, names);
	eq(
		'the graph has Entry, Any, Exit and the states, by display name',
		g.nodes.map((n) => `${n.kind}:${n.label}`),
		['entry:Entry', 'any:Any', 'exit:Exit', 'state:Idle', 'state:Celebrate'],
	);
	eq(
		'…the Entry edge first, then the transitions with their labels',
		g.edges.map((e) => [e.from, e.to, e.label]),
		[
			[E.ENTRY_NODE, 'Idle', ''],
			['Idle', 'Celebrate', 'win ▸ · @ 50%'],
			['any', 'exit', 'always'],
		],
	);
	eq('a state with no custom name is labelled by its timeline', E.stateLabel(idle, names), 'Idle');
	eq(
		'…and by its timeline id when the timeline is unknown',
		E.stateLabel({ id: 'x', timeline: 'gone' }, names),
		'gone',
	);
}

// ---- 4. the preview ----------------------------------------------------------------------------

{
	const d = def();
	const idle = timeline('c_coin_idle', { alpha: [{ time: 0, value: 0.5 }] });
	const win = timeline('c_coin_win', {
		y: [
			{ time: 0, value: -100 },
			{ time: 1, value: 0 },
		],
	});
	const glow = timeline(
		'c_coin_glow',
		{ x: [{ time: 0, value: 7 }], alpha: [{ time: 0, value: 1 }] },
		'Glow',
	);
	const docs = new Map([
		['c_coin_idle', idle],
		['c_coin_win', win],
		['c_coin_glow', glow],
	]);
	const sc = scene(d);
	const play = (
		timelineId: string,
		time: number,
		from?: { timeline?: string; time: number; progress: number },
	) => ({
		layer: 'l',
		state: 's',
		timeline: timelineId,
		time,
		prevTime: 0,
		wrapped: false,
		entered: false,
		...(from ? { from } : {}),
	});
	const drive = (m: Map<string, { bindings: unknown; sample: unknown }>) =>
		[...m.entries()].map(([k, v]) => [k, v.bindings, v.sample]);
	eq(
		'a state at t previews exactly what the Timeline panel previews for its timeline at t',
		drive(P.stateMachineDrives([play('c_coin_win', 0.25)], docs, sc)),
		drive(S.timelineDrives(win, sc, 0.25)),
	);
	eq(
		'two layers merge per property, the later winning',
		drive(
			P.stateMachineDrives(
				[
					{ ...play('c_coin_idle', 0), layer: 'a' },
					{ ...play('c_coin_win', 0.5), layer: 'b' },
				],
				docs,
				sc,
			),
		),
		[['n_coin', [{ target: 'y' }, { target: 'alpha' }], { alpha: 0.5, y: -50 }]],
	);
	const blended = P.stateMachineDrives(
		[play('c_coin_win', 0, { timeline: 'c_coin_idle', time: 0, progress: 0.5 })],
		docs,
		sc,
	).get('n_coin');
	eq(
		'a blend mixes the pose left into the new timeline (the game’s blendNodeSamples)',
		blended?.sample,
		M.blendNodeSamples({ alpha: 0.5 }, { y: -100 }, 0.5),
	);
	eq('…and binds the channels of both sides', blended?.bindings, [
		{ target: 'y' },
		{ target: 'alpha' },
	]);
	eq(
		'a layer on another node drives only that node',
		[...P.stateMachineDrives([play('c_coin_glow', 0)], docs, sc).keys()],
		['n_glow'],
	);
	eq(
		'a missing timeline, or exit, drives nothing',
		[
			P.stateMachineDrives([play('gone', 0)], docs, sc).size,
			P.stateMachineDrives([{ ...play('c_coin_idle', 0), timeline: undefined }], docs, sc).size,
		],
		[0, 0],
	);
	// The runner's own plays feed it the same way the panel does.
	const r = new M.ComponentStateMachineRunner(
		{
			layers: [
				{ id: 'l', entry: 's', states: [{ id: 's', timeline: 'c_coin_win' }], transitions: [] },
			],
		},
		[],
		new Map([['c_coin_win', 1]]),
	);
	r.advance(0.5);
	eq(
		'the runner’s plays drive the stage at its playhead',
		P.stateMachineDrives(r.plays(), docs, sc).get('n_coin')?.sample,
		{ y: -50 },
	);
}

// ---- 5. what saves -----------------------------------------------------------------------------

{
	const d = def();
	const layer = E.addLayer(d, 'Main');
	E.addState(layer, { id: 'c_coin_idle', name: 'Idle' });
	E.setNodePos(layer, 'Idle', { x: 300, y: 40 });
	E.setNodePos(layer, E.ENTRY_NODE, { x: 5, y: 6 });
	E.setNodePos(layer, E.EXIT_NODE, { x: 7, y: 8 });
	const saved = normalizeComponent(JSON.parse(JSON.stringify(d)) as ComponentDef);
	eq(
		'the normalizer keeps the cards’ positions and the pseudo-node positions',
		[saved.stateMachine?.layers[0].states[0].pos, saved.stateMachine?.layers[0].pseudoPos],
		[
			{ x: 300, y: 40 },
			{ entry: { x: 5, y: 6 }, exit: { x: 7, y: 8 } },
		],
	);
	eq(
		'…and drops a malformed position',
		normalizeComponent({
			...d,
			stateMachine: { layers: [{ ...layer, states: [{ ...layer.states[0], pos: { x: 'a' } }] }] },
		} as unknown as ComponentDef).stateMachine?.layers[0].states[0].pos,
		undefined,
	);
	eq(
		'a node list is unchanged by the editing helpers',
		(d.root as { children: LayoutNode[] }).children.length,
		2,
	);
}

console.log(
	`\n${failures === 0 ? '✅' : '❌'} component state machine editor: ${passes} passed, ${failures} failed`,
);
if (failures) process.exit(1);
