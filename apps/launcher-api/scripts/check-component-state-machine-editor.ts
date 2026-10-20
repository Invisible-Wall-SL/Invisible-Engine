/**
 * The State Machine panel's edits and preview (Rive plan Phase 5b):
 *   pnpm --filter launcher-api check:component-state-machine-editor
 *
 *  1. editing the draft def: layers, states (the first becomes the entry), transitions (never
 *     from Exit or into Any; Entry sets the entry), conditions, positions;
 *  2. the inputs list: add (a trigger a signal declares adds nothing), remove (from `inputs` and
 *     `signals`; the conditions that read it stay and fail closed — reported), rename (everywhere
 *     it is read — refused when taken), defaults and sources, ids a saved def used never reused;
 *  3. the graph the panel draws: Entry / Any / Exit, states named after their timeline, the
 *     Entry edge, transition labels;
 *  4. the stage preview runs the game's own player through the panel's seams (`previewPlayer`,
 *     `placeLayers`, `playerDrives`): a blend, a `signal:` cue reaching the runner, a missing
 *     timeline;
 *  5. what saves: `normalizeComponent` keeps the editor's positions; the state machine still
 *     travels inside the def, so no new write exists for `check:component-links` to enumerate;
 *  6. Phase 9c: layer duplicate / reorder / disable, the blend's options and Disable on a
 *     transition, On exit rows (minted ids, usage, rename, the unsavable check), where a Problems
 *     row jumps, the Animations list's timeline duplicate, the curve widget's value helpers, a
 *     disabled layer in the preview, what saves (and a newer build's on-exit row kept), and the
 *     panels' wiring (no timeline <select>; the list's drag onto the graph; the Console's log).
 *
 * What it cannot prove: the xyflow canvas, the panel's Svelte wiring — the owner's browser check.
 */
import { readFileSync } from 'node:fs';
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
		'removing a signal-declared trigger reports the transitions that read it and LEAVES their conditions (they fail closed, flagged ⚠ — never widened)',
		[E.removeInput(d, 'potWin'), d.signals, t.conditions],
		[
			['Layer_1/t_Idle_Win'],
			undefined,
			[
				{ input: 'potWin', op: 'fired' },
				{ input: 'total', op: '>', value: 0 },
			],
		],
	);
	eq(
		'…and validation flags the orphaned condition',
		M.validateStateMachine(d, ['c_coin_idle', 'c_coin_win']).map((i) => i.code),
		['condition-input-unknown'],
	);
	// Ids a saved def used are never handed to a new item (the save grafts unknown fields by id).
	const saved = {
		stateMachine: {
			layers: [
				{
					id: 'Main',
					entry: 'Win',
					states: [{ id: 'Win', timeline: 'c_coin_win' }],
					transitions: [{ id: 't_Idle_Win', from: 'Idle', to: 'Win' }],
				},
			],
		},
	};
	const reserved = E.stateMachineIds(saved);
	eq('the saved def’s ids are collected', [...reserved].sort(), ['Main', 'Win', 't_Idle_Win']);
	const fresh = def();
	const l2 = E.addLayer(fresh, 'Main', reserved);
	const w2 = E.addState(l2, { id: 'c_coin_win', name: 'Win' }, { reserved });
	E.addState(l2, { id: 'c_coin_idle', name: 'Idle' }, { reserved });
	const t2 = E.connect(l2, 'Idle', 'Win_2', reserved);
	eq(
		'a re-created layer, state and transition take new ids',
		[l2.id, w2.id, t2?.id],
		['Main_2', 'Win_2', 't_Idle_Win_2'],
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
	// The preview runs the game's own interpreter and timeline player; these are the seams the
	// panel uses around them, driven here through the same sequences a placed instance plays.
	const d = def();
	const sc = scene(d);
	const idle = timeline('c_coin_idle', { alpha: [{ time: 0, value: 0.5 }] });
	const win = {
		...timeline('c_coin_win', {
			y: [
				{ time: 0, value: -100 },
				{ time: 1, value: 0 },
			],
		}),
		playOn: 'enter',
		tracks: [
			...timeline('c_coin_win', {
				y: [
					{ time: 0, value: -100 },
					{ time: 1, value: 0 },
				],
			}).tracks,
			{ id: 'c', kind: 'cue', actorId: '', keys: [{ time: 1, cue: 'signal:done' }] },
		],
	} as unknown as CinematicDoc;
	const docs = new Map([
		['c_coin_idle', idle],
		['c_coin_win', win],
	]);
	const player = P.previewPlayer(docs.values(), sc.nodes);
	eq(
		'the preview player binds the states’ timelines without their playOn (as instanceTimelineDocs does)',
		player.signals(),
		[],
	);
	eq('…on the component’s nodes', [...player.drivenNodes().keys()], ['n_coin']);
	const runner = new M.ComponentStateMachineRunner(
		{
			layers: [
				{
					id: 'main',
					entry: 'idle',
					states: [
						{ id: 'idle', timeline: 'c_coin_idle', loop: true },
						{ id: 'win', timeline: 'c_coin_win' },
					],
					transitions: [
						{
							id: 'w',
							from: 'idle',
							to: 'win',
							conditions: [{ input: 'win', op: 'fired' }],
							blend: 200,
						},
						{ id: 'back', from: 'win', to: 'idle', conditions: [{ input: 'done', op: 'fired' }] },
					],
				},
			],
		},
		[
			{ id: 'win', kind: 'trigger' },
			{ id: 'done', kind: 'trigger' },
			{ id: 'enter', kind: 'trigger' },
		],
		new Map([
			['c_coin_idle', 1],
			['c_coin_win', 1],
		]),
	);
	P.placeLayers(runner, player);
	eq('the entry pose is what the player samples', P.playerDrives(player).get('n_coin'), {
		bindings: [{ target: 'y' }, { target: 'alpha' }],
		sample: { alpha: 0.5 },
	});
	runner.fire('win');
	runner.advance(0.1);
	P.placeLayers(runner, player);
	runner.advance(0.1);
	P.placeLayers(runner, player);
	const mid = P.playerDrives(player).get('n_coin')?.sample;
	eq(
		'a blend previews as the player blends it (half way: alpha 0.5 → the authored 1 since win keys none, y 0 → -90)',
		[Math.round((mid?.alpha ?? 0) * 100) / 100, Math.round((mid?.y ?? 0) * 100) / 100],
		[0.75, -45],
	);
	const cues: string[] = [];
	for (let i = 0; i < 12; i++) {
		runner.advance(0.1);
		cues.push(...P.placeLayers(runner, player).map((c) => c.cue));
	}
	runner.advance(0.1);
	P.placeLayers(runner, player);
	eq(
		'a signal: cue a state timeline crosses fires the trigger of that name on the runner, so "Win → Idle on signal:done" works in the preview',
		[cues, runner.stateOf('main')],
		[['signal:done'], 'idle'],
	);
	// A missing timeline empties the layer's slot, as in game.
	const missing = new M.ComponentStateMachineRunner(
		{
			layers: [
				{
					id: 'main',
					entry: 'gone',
					states: [{ id: 'gone', timeline: 'c_coin_gone' }],
					transitions: [],
				},
			],
		},
		[],
		new Map(),
	);
	const emptyPlayer = P.previewPlayer(docs.values(), sc.nodes);
	P.placeLayers(missing, emptyPlayer);
	eq(
		'a state whose timeline is missing drives nothing on the stage',
		P.playerDrives(emptyPlayer).size,
		0,
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
	{
		const src = readFileSync(
			new URL('../src/routes/(app)/editor/EditorStateMachinePanel.svelte', import.meta.url),
			'utf8',
		);
		eq(
			'the graph answers Delete only while its tab is shown (xyflow listens on the window)',
			/deleteKey=\{active \? \['Delete', 'Backspace'\] : \[\]\}/.test(src),
			true,
		);
		eq(
			'…and drops its selection when hidden',
			/if \(!on\) \{[\s\S]*?selected = null;/.test(src),
			true,
		);
		eq(
			'…and resets its state when another component opens',
			/\$effect\.pre\(\(\) => \{\s*void def;[\s\S]*?selected = null;[\s\S]*?activeLayerId = null;[\s\S]*?previewValues = \{\};/.test(
				src,
			),
			true,
		);
		eq(
			'…and never lets a run resume after a stop or unmount',
			/if \(destroyed \|\| !active \|\| token !== runToken\) return;/.test(src),
			true,
		);
	}
	eq(
		'a node list is unchanged by the editing helpers',
		(d.root as { children: LayoutNode[] }).children.length,
		2,
	);
}

// ---- 6. Phase 9c ---------------------------------------------------------------------------------

{
	const L = await import('../src/lib/timeline/listenerEdit.ts');
	const C = await import('../src/lib/timeline/easeCurve.ts');
	const U = await import('../src/lib/server/componentUnknownFields.ts');
	const machineDef = (): ComponentDef => {
		const d = def();
		d.events = [{ id: 'left' }, { id: 'arrived' }];
		const main = E.addLayer(d, 'Main');
		E.addState(main, { id: 'c_coin_idle', name: 'Idle' });
		E.addState(main, { id: 'c_coin_win', name: 'Win' });
		E.addTransition(main, 'Idle', 'Win');
		E.addLayer(d, 'Glow');
		return d;
	};

	// Layers: duplicate, reorder, disable.
	const d = machineDef();
	const copy = E.duplicateLayer(d, 'Main', ['Main_copy']);
	eq(
		'duplicate: a new id (never a reserved one) and "<name> copy", right after the original',
		[copy?.id, copy?.name, d.stateMachine?.layers.map((l) => l.id)],
		['Main_copy_2', 'Main copy', ['Main', 'Main_copy_2', 'Glow']],
	);
	eq(
		'…with the same states, transitions and entry',
		[copy?.states.map((s) => s.id), copy?.transitions.map((t) => t.id), copy?.entry],
		[['Idle', 'Win'], ['t_Idle_Win'], 'Idle'],
	);
	copy!.states[0].name = 'changed';
	eq(
		'…as a copy: editing it leaves the original alone',
		d.stateMachine?.layers[0].states[0].name,
		undefined,
	);
	eq('duplicating an unknown layer adds nothing', E.duplicateLayer(d, 'nope'), undefined);
	eq(
		'reorder: a layer moves one place, never past either end',
		[
			E.moveLayer(d, 'Glow', -1),
			d.stateMachine?.layers.map((l) => l.id),
			E.moveLayer(d, 'Main', -1),
			E.moveLayer(d, 'Main_copy_2', 1),
			d.stateMachine?.layers.map((l) => l.id),
		],
		[true, ['Main', 'Glow', 'Main_copy_2'], false, false, ['Main', 'Glow', 'Main_copy_2']],
	);
	const glow = d.stateMachine!.layers[1];
	E.setLayerDisabled(glow, true);
	const offDisabled = glow.disabled;
	E.setLayerDisabled(glow, false);
	eq(
		'disable a layer, and enable it (nothing stored)',
		[offDisabled, 'disabled' in glow],
		[true, false],
	);

	// Transitions: blend options, disable.
	const t = d.stateMachine!.layers[0].transitions[0];
	E.setBlend(t, 250);
	E.setBlendEase(t, [0.1, 0.2, 0.3, 0.4]);
	E.setBlendFlag(t, 'pauseSource', false);
	E.setBlendFlag(t, 'allowExit', false);
	eq(
		'the blend’s interpolation and flags store only what differs from the default',
		{ blend: t.blend, ease: t.ease, pauseSource: t.pauseSource, allowExit: t.allowExit },
		{ blend: 250, ease: [0.1, 0.2, 0.3, 0.4], pauseSource: false, allowExit: false },
	);
	E.setBlendFlag(t, 'pauseSource', true);
	E.setBlendEase(t, null);
	eq(
		'…turning one back on (or Linear) removes it',
		['pauseSource' in t, 'ease' in t],
		[false, false],
	);
	E.setBlendEase(t, [0.1, 0.2, 0.3, 0.4]);
	E.setBlend(t, 0);
	eq(
		'clearing the blend clears its options with it',
		Object.keys(t).filter((k) => ['blend', 'ease', 'pauseSource', 'allowExit'].includes(k)),
		[],
	);
	E.setTransitionDisabled(t, true);
	eq('a disabled transition’s arrow says so', E.transitionLabel(t), 'off · always');
	eq(
		'…and the graph hands the panel its transition (the arrow is drawn greyed)',
		E.layerGraph(d.stateMachine!.layers[0], names).edges.find((e) => e.id === t.id)?.transition
			?.disabled,
		true,
	);
	E.setTransitionDisabled(t, false);
	eq('…enabled again, nothing is stored', 'disabled' in t, false);

	// States: on exit.
	const idle = d.stateMachine!.layers[0].states[0];
	const enter = L.addEnterAction(idle, d);
	const exit = L.addExitAction(idle, d, ['x_saved']);
	eq(
		'an on-exit row raises the first event, with a minted id no row uses',
		[exit.kind, exit.event, /^x_[a-z0-9]{6}$/.test(exit.id), exit.id !== enter.id],
		['raise', 'left', true, true],
	);
	eq('rowIds lists on-exit rows (a new row avoids them)', L.rowIds(d).has(exit.id), true);
	eq(
		'an event raised on exit is in use (the remove dialog says so)',
		L.eventUsage(d, 'left').states,
		[{ layer: 'Main', state: 'Idle' }],
	);
	L.renameEvent(d, 'left', 'gone');
	eq('renaming an event follows the on-exit raise', idle.onExit?.[0].event, 'gone');
	exit.event = '';
	eq('an on-exit row with no event cannot save (flagged)', L.unsavableRows(d), [
		'On exit of "Idle"',
	]);
	L.removeExitAction(idle, exit.id);
	eq('removing the last on-exit row removes the block', 'onExit' in idle, false);

	// Problems: where a click jumps.
	const pd = machineDef();
	pd.stateMachine!.layers[0].states[1].name = 'Big win';
	eq(
		'a state-machine issue jumps by its ids',
		E.problemTarget(pd, { layer: 'Main', transition: 't_Idle_Win' }),
		{ layer: 'Main', transition: 't_Idle_Win' },
	);
	eq(
		'an event issue names its state by display name; it jumps to the state’s id',
		E.problemTarget(pd, { layer: 'Main', state: 'Big win', event: 'x' } as never),
		{ layer: 'Main', state: 'Win' },
	);
	eq(
		'an input issue lights the input',
		E.problemTarget(pd, { input: 'win', layer: 'Main', transition: 'gone' }),
		{ input: 'win', layer: 'Main' },
	);
	eq(
		'a listener issue jumps to nothing here',
		E.problemTarget(pd, { node: 'Coin', layer: 'Main' }),
		{},
	);

	// The Animations list's duplicate.
	const src = {
		...timeline('c_coin_idle', { alpha: [{ time: 0, value: 0.5 }] }),
		name: 'Idle',
		playOn: 'enter',
	} as CinematicDoc;
	const dup = S.duplicateTimeline(
		src,
		['c_coin_idle', 'c_c_coin_Idle_copy'],
		['Idle', 'Idle copy'],
	);
	eq(
		'a duplicated timeline: same host and settings, a fresh id and "<name> copy N"',
		[dup.id, dup.name, dup.host, dup.playOn],
		['c_coin_idle_copy_2', 'Idle copy 2', src.host, 'enter'],
	);
	(dup.tracks[0] as { channels: Record<string, { value: number }[]> }).channels.alpha[0].value = 9;
	eq(
		'…its keys are a copy',
		(src.tracks[0] as { channels: Record<string, { value: number }[]> }).channels.alpha[0].value,
		0.5,
	);
	const screenDup = S.duplicateTimeline(
		S.newScreenTimeline({ id: 'base_intro', name: 'Intro', sceneId: 'base' }),
		['base_intro'],
	);
	eq(
		'…on a screen too',
		[screenDup.id, screenDup.host],
		['base_intro_copy', { kind: 'screen', sceneId: 'base' }],
	);

	// The curve widget's value helpers match the Timeline module's.
	eq(
		'parseCubic: four numbers, x clamped to 0..1, y free',
		[C.parseCubic('0.2, -0.5 1.4,2'), C.parseCubic('1,2,3'), C.parseCubic('a,b,c,d')],
		[[0.2, -0.5, 1, 2], null, null],
	);
	eq('cubicText: three decimals', C.cubicText([1 / 3, 0, 2 / 3, 1]), '0.333, 0, 0.667, 1');
	const timelineSrc = readFileSync(
		new URL('../src/lib/timeline/timeline.js', import.meta.url),
		'utf8',
	);
	eq(
		'…and the Cubic button starts where the Timeline’s does',
		timelineSrc.includes(`const DEFAULT_CUBIC = [${C.DEFAULT_CUBIC.join(', ')}];`),
		true,
	);

	// The preview: a disabled layer drives nothing on the stage.
	const docs = new Map([
		['c_coin_idle', timeline('c_coin_idle', { alpha: [{ time: 0, value: 0.5 }] })],
		['c_coin_glow', timeline('c_coin_glow', { x: [{ time: 0, value: 7 }] }, 'Glow')],
	]);
	const runner = new M.ComponentStateMachineRunner(
		{
			layers: [
				{ id: 'a', entry: 'i', states: [{ id: 'i', timeline: 'c_coin_idle' }], transitions: [] },
				{
					id: 'b',
					entry: 'g',
					states: [{ id: 'g', timeline: 'c_coin_glow' }],
					transitions: [],
					disabled: true,
				},
			],
		},
		[],
		new Map([
			['c_coin_idle', 1],
			['c_coin_glow', 1],
		]),
	);
	const player = P.previewPlayer(docs.values(), scene(def()).nodes);
	P.placeLayers(runner, player);
	eq(
		'the preview: a disabled layer drives nothing',
		[...P.playerDrives(player).keys()],
		['n_coin'],
	);

	// What saves.
	const saved = normalizeComponent(
		JSON.parse(
			JSON.stringify({
				...machineDef(),
				stateMachine: {
					layers: [
						{
							...machineDef().stateMachine!.layers[0],
							disabled: true,
							states: [
								{
									id: 'Idle',
									timeline: 'c_coin_idle',
									onExit: [{ id: 'x_aaaaaa', kind: 'raise', event: 'left' }],
								},
							],
							transitions: [
								{
									id: 't',
									from: 'Idle',
									to: 'Idle',
									blend: 100,
									ease: [0.1, 0.2, 0.3, 0.4],
									pauseSource: false,
									allowExit: false,
									disabled: true,
								},
							],
						},
					],
				},
			}),
		) as ComponentDef,
	);
	eq('what saves: the editor’s new fields round-trip', saved.stateMachine?.layers[0], {
		id: 'Main',
		entry: 'Idle',
		states: [
			{
				id: 'Idle',
				timeline: 'c_coin_idle',
				onExit: [{ id: 'x_aaaaaa', kind: 'raise', event: 'left' }],
			},
		],
		transitions: [
			{
				id: 't',
				from: 'Idle',
				to: 'Idle',
				blend: 100,
				ease: [0.1, 0.2, 0.3, 0.4],
				pauseSource: false,
				allowExit: false,
				disabled: true,
			},
		],
		name: 'Main',
		disabled: true,
	});
	const newer = {
		...saved,
		stateMachine: {
			layers: [
				{
					...saved.stateMachine!.layers[0],
					states: [
						{
							...saved.stateMachine!.layers[0].states[0],
							onExit: [
								{ id: 'x_aaaaaa', kind: 'raise', event: 'left' },
								{ id: 'x_newer1', kind: 'sound', play: 'pop' },
							],
						},
					],
				},
			],
		},
	};
	eq(
		'an on-exit row a newer build wrote (a kind this one cannot read) is put back on save',
		U.withUnknownComponentFields(saved, newer).stateMachine?.layers[0].states[0].onExit?.map(
			(a) => a.id,
		),
		['x_aaaaaa', 'x_newer1'],
	);

	// The panels' wiring (source scans; the Svelte wiring itself is the owner's browser check).
	const read = (f: string): string =>
		readFileSync(new URL(`../src/routes/(app)/editor/${f}`, import.meta.url), 'utf8');
	const timelinePanel = read('EditorTimelinePanel.svelte');
	eq(
		'the Timeline panel has no timeline <select> any more; it publishes the Animations list',
		[
			/aria-label=\{`Timelines of this/.test(timelinePanel),
			/setAnimationsPanel\(next, previewOwner\)/.test(timelinePanel),
		],
		[false, true],
	);
	eq(
		'…and withdraws it on unmount',
		/onDestroy\([\s\S]*setAnimationsPanel\(null, previewOwner\)/.test(timelinePanel),
		true,
	);
	const smPanel = read('EditorStateMachinePanel.svelte');
	const list = read('EditorAnimationsList.svelte');
	eq(
		'a timeline row drags its id; the graph takes that drag type and adds a state where it lands',
		[
			/setData\(TIMELINE_DRAG_TYPE, id\)/.test(list),
			/getData\(TIMELINE_DRAG_TYPE\)/.test(smPanel),
			/newState\(id, layer && toFlow \?/.test(smPanel),
		],
		[true, true, true],
	);
	eq(
		'the console logs each advance’s transitions before the dispatcher raises their events',
		/logFired\(step\.fired\);\s*apply\(\);\s*dispatcher\?\.transitions\(step\.fired\);/.test(
			smPanel,
		),
		true,
	);
	eq(
		'the Problems list gathers the machine’s and the events’ issues',
		/const problems = \$derived<Problem\[\]>\(\[\.\.\.issues, \.\.\.eventIssues\]\)/.test(smPanel),
		true,
	);
}

console.log(
	`\n${failures === 0 ? '✅' : '❌'} component state machine editor: ${passes} passed, ${failures} failed`,
);
if (failures) process.exit(1);
