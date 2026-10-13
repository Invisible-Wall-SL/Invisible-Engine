/**
 * Flow instance nodes (Rive plan §6.2, Phase 7a) — the launcher's half:
 *   pnpm --filter launcher-api check:flow-instance-nodes
 *
 *  1. the PROJECTION (`projectFlowInstances`): every placed, NAMED instance of a screen (nested in a
 *     container too), keyed by node id, with the interface of the EXACT version it pins — an unnamed
 *     instance and a repeater are not offered; a pin the store has lost is `missing: 'version'`, an
 *     unknown component `missing: 'def'`, a built-in resolves any pin;
 *  2. the PUBLISH GATE (`validateFlowV2Against`, what Publish calls): a starter flow plus a wired
 *     instance node passes; a wire to a pin the pinned interface lacks, an unplaced instance and a
 *     lost version are refused;
 *  3. `text` inputs: the normalizer keeps the kind with a key default and drops a non-key default;
 *     a `text` row an older build kept unreadable (#1185) now reads; a state-machine condition on
 *     text is flagged and the runner never takes it;
 *  4. the LOCALIZATION HARVEST lists every literal key the flow feeds a text input (`origin: 'flow'`);
 *  5. the live REGISTRY (`flowInstances.ts`): register / get / stash-then-apply / watch / unregister,
 *     a stack per id; the HANDLE (`flowInstanceHandle.ts`): a Flow set read as the input's kind, a
 *     fire only on a trigger; a sourced number input gets no pin;
 *  6. the EVENT ROAD: the game's resolver routes a raised event to the instance's event pins only,
 *     with its payload, and never consults the press ownership for it; and the game env's WAITS
 *     (`flowInstanceWaits.ts`): slammed before the hold, slammed during it, not on screen, mounting
 *     late, never mounting, placed on another screen;
 *  7. the SHIP CHAIN (rule 8): the placed pin is what the bundle walks, the runtime registry resolves
 *     that version, and its interface equals the projection's — plus the state timelines resolve;
 *  8. the Svelte and game wiring this gate cannot mount, source-scanned.
 */
import { readFileSync } from 'node:fs';
import type { ComponentDef, LayoutNode, Scene } from 'engine-layout';
import type { FlowDoc } from 'engine-flow-v2';

const { BUILTIN_COMPONENTS } =
	await import('../../../packages/engine-layout/src/lib/builtinComponents.ts');
const R = await import('../../../packages/engine-layout/src/lib/registerComponents.ts');
const I = await import('../../../packages/engine-layout/src/lib/componentInterface.ts');
const M = await import('../../../packages/engine-layout/src/lib/stateMachine.ts');
const L = await import('../../../packages/engine-layout/src/lib/componentTimelines.ts');
const G = await import('../../../packages/engine-layout/src/lib/flowInstances.ts');
const HD = await import('../../../packages/engine-layout/src/lib/flowInstanceHandle.ts');
const { createSkipToken } = await import('../../../packages/utils-shared/skipToken.ts');
const { createInstanceWaits } = await import('../../lines/src/game/flowInstanceWaits.ts');
const F = await import('../../../packages/engine-layout/src/lib/registerFlowPress.ts');
const E = await import('../../../packages/engine-layout/src/lib/componentEvents.ts');
const N = await import('../../../packages/engine-flow-v2/src/instanceNodes.ts');
const { collectComponentPins } =
	await import('../../../packages/engine-layout/src/lib/collectComponentIds.ts');
const { freshDrivenSeedDoc } =
	await import('../../../packages/engine-flow-v2/src/reference/drivenSeed.ts');
const { engineOwnedOnly, getFullSceneSet } =
	await import('../../../packages/engine-layout/src/lib/index.ts');
const P = await import('../src/lib/flowV2Projection.ts');
const { validateFlowV2Against } = await import('../src/lib/server/flowV2Validation.ts');
const { normalizeComponent } = await import('../src/lib/server/componentStorage.ts');
const { withUnknownComponentFields } = await import('../src/lib/server/componentUnknownFields.ts');
const { harvestFlowInstanceText } = await import('../src/lib/server/localizationHarvest.ts');
const H = await import('../../lines/src/game/flowV2InterpreterHolder.ts');

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
const source = (path: string): string =>
	readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

// ---- fixtures ----------------------------------------------------------------------------------

const text = (id: string): LayoutNode => ({
	id,
	kind: 'text',
	label: id,
	x: 0,
	y: 0,
	text: 'x',
	style: {},
});
const root = (): ComponentDef['root'] => ({
	id: 'root',
	kind: 'container',
	x: 0,
	y: 0,
	children: [text('n_a')],
});
/** v2 of the banner: `win` + `amount` + `title`; event `done(amount)`; layer `main`. */
const BANNER_V2: ComponentDef = {
	id: 'banner',
	name: 'Banner',
	version: 2,
	scope: 'project',
	category: 'ui',
	root: root(),
	inputs: [
		{ id: 'win', kind: 'trigger' },
		{ id: 'amount', kind: 'number' },
		{ id: 'title', kind: 'text', default: 'Big win' },
	],
	events: [{ id: 'done', payload: [{ name: 'amount', type: { t: 'float' } }] }],
	stateMachine: {
		layers: [
			{
				id: 'main',
				entry: 'idle',
				states: [
					{ id: 'idle', timeline: 'tl_idle' },
					{ id: 'win', timeline: 'tl_win' },
				],
				transitions: [
					{ id: 't1', from: 'idle', to: 'win', conditions: [{ input: 'win', op: 'fired' }] },
					{ id: 't2', from: 'win', to: 'idle', exitTime: 1 },
				],
			},
		],
	},
};
/** v3 renamed the event and dropped `title`: a flow pinned to v2 must be judged against v2. */
const BANNER_V3: ComponentDef = {
	...BANNER_V2,
	version: 3,
	inputs: [
		{ id: 'win', kind: 'trigger' },
		{ id: 'amount', kind: 'number' },
	],
	events: [{ id: 'finished' }],
};
const instance = (id: string, label: string | undefined, version?: number): LayoutNode =>
	({
		id,
		kind: 'componentInstance',
		...(label !== undefined ? { label } : {}),
		x: 0,
		y: 0,
		componentId: 'banner',
		...(version !== undefined ? { componentVersion: version } : {}),
	}) as LayoutNode;
const SCENES: Scene[] = [
	{
		id: 'basegame',
		name: 'Base game',
		nodes: [
			instance('c_banner', 'winBanner', 2),
			instance('c_unnamed', undefined, 2),
			{
				id: 'c_box',
				kind: 'container',
				x: 0,
				y: 0,
				children: [instance('c_nested', 'nestedBanner', 3)],
			} as LayoutNode,
			{
				id: 'c_rep',
				kind: 'repeater',
				x: 0,
				y: 0,
				componentId: 'banner',
				source: 'betModes',
			} as unknown as LayoutNode,
			instance('c_lost', 'lostBanner', 9),
			{ ...instance('c_gone', 'ghost'), componentId: 'nothing' } as LayoutNode,
			{
				...instance('c_builtin', 'spin', 42),
				componentId: BUILTIN_COMPONENTS[0].id,
			} as LayoutNode,
		],
	} as Scene,
	{ id: 'hud', name: 'HUD', nodes: [instance('c_latest', 'latestBanner')] } as Scene,
];
const CONTAINERS: FlowDoc['containers'] = [
	{ id: 'basegame', sceneId: 'basegame', z: 10 },
	{ id: 'hud', sceneId: 'hud', z: 20 },
];
const DEFS = [BANNER_V3, BANNER_V2, BUILTIN_COMPONENTS[0]];

// ---- 1. projection -----------------------------------------------------------------------------
{
	const instances = P.projectFlowInstances(CONTAINERS, SCENES, P.instanceDefResolver(DEFS));
	eq(
		'1. every placed, named instance is projected under its node id, on its screen',
		Object.values(instances).map((d) => [d.instance, d.container, d.name, d.version]),
		[
			['c_banner', 'basegame', 'winBanner', 2],
			['c_nested', 'basegame', 'nestedBanner', 3],
			['c_lost', 'basegame', 'lostBanner', 9],
			['c_gone', 'basegame', 'ghost', undefined],
			['c_builtin', 'basegame', 'spin', 42],
			['c_latest', 'hud', 'latestBanner', undefined],
		],
	);
	eq(
		'1. the interface is the PINNED version’s (v2: title + done), not latest’s',
		[
			instances.c_banner.interface.inputs.map((i) => `${i.id}:${i.kind}`),
			instances.c_banner.interface.events.map((e) => e.id),
			instances.c_banner.interface.values,
		],
		[
			['win:trigger', 'amount:number', 'title:text'],
			['done'],
			[{ id: 'main.state', layer: 'main', states: ['idle', 'win', 'exit'] }],
		],
	);
	eq(
		'1. an unpinned instance follows latest (v3)',
		instances.c_latest.interface.events.map((e) => e.id),
		['finished'],
	);
	eq(
		'1. a lost version, an unknown component, a built-in with any pin',
		[instances.c_lost.missing, instances.c_gone.missing, instances.c_builtin.missing],
		['version', 'def', undefined],
	);
	eq(
		'1. no named instance ⇒ nothing projected',
		P.projectFlowInstances(
			CONTAINERS,
			[{ id: 'basegame', name: 'b', nodes: [instance('c_x', '  ', 2)] } as Scene],
			P.instanceDefResolver(DEFS),
		),
		{},
	);
}

// ---- 2. the publish gate -----------------------------------------------------------------------
{
	const seed = freshDrivenSeedDoc('lines');
	const scaffold = engineOwnedOnly(getFullSceneSet('lines')!).scenes;
	const scenes: Scene[] = [...scaffold, SCENES[0]];
	const at = { x: 0, y: 0 };
	const withNodes = (
		nodes: FlowDoc['graph']['nodes'],
		exec: FlowDoc['graph']['exec'],
	): FlowDoc => ({
		...seed,
		containers: [...seed.containers, CONTAINERS[0]],
		graph: {
			...seed.graph,
			nodes: [...seed.graph.nodes, ...nodes],
			exec: [...seed.graph.exec, ...exec],
		},
	});
	const errors = (doc: FlowDoc) =>
		validateFlowV2Against(doc, scenes, null, { version: 2, functions: [] }, DEFS)
			.filter((i) => i.severity === 'error')
			.map((i) => i.code);
	const node = (id: string, instanceId: string) => ({
		id,
		kind: 'componentInstance' as const,
		pos: at,
		container: 'basegame',
		instance: instanceId,
	});
	const ping = { id: 'p7_ping', kind: 'action' as const, pos: at, ref: 'startSpin' };
	eq(
		'2. a starter flow with an instance node wired to fire:win and event:done passes the gate',
		errors(
			withNodes(
				[node('p7_i', 'c_banner'), ping],
				[{ from: { node: 'p7_i', pin: 'event:done' }, to: { node: 'p7_ping', pin: 'exec' } }],
			),
		),
		[],
	);
	eq(
		'2. a wire to the event latest has but the pinned v2 lacks is refused',
		errors(
			withNodes(
				[node('p7_i', 'c_banner'), ping],
				[{ from: { node: 'p7_i', pin: 'event:finished' }, to: { node: 'p7_ping', pin: 'exec' } }],
			),
		),
		['instance-pin-missing'],
	);
	eq(
		'2. an unplaced instance and a lost pinned version are refused',
		[
			errors(withNodes([node('p7_a', 'c_nobody')], [])),
			errors(withNodes([node('p7_b', 'c_lost')], [])),
		],
		[['instance-missing'], ['instance-missing']],
	);
	eq(
		'2. without the defs (an unknown library) the placed instance reads as a lost def',
		validateFlowV2Against(withNodes([node('p7_i', 'c_banner')], []), scenes, null, {
			version: 2,
			functions: [],
		})
			.filter((i) => i.severity === 'error')
			.map((i) => [i.code, i.message.includes("'banner'")]),
		[['instance-missing', true]],
	);
}

// ---- 3. text inputs ----------------------------------------------------------------------------
{
	const saved = normalizeComponent({
		...BANNER_V2,
		inputs: [
			...BANNER_V2.inputs!,
			{ id: 'bad', kind: 'text', default: '123' },
			{ id: 'none', kind: 'text' },
		],
	} as ComponentDef);
	eq(
		'3. the normalizer keeps text inputs, a key default, and drops a non-key default',
		saved.inputs,
		[
			{ id: 'win', kind: 'trigger' },
			{ id: 'amount', kind: 'number' },
			{ id: 'title', kind: 'text', default: 'Big win' },
			{ id: 'bad', kind: 'text' },
			{ id: 'none', kind: 'text' },
		],
	);
	// An older build (#1185) could not read `text` and kept the row in place on its save, so the
	// stored def carries it — which the first assertion reads. In THIS build the row is readable, so
	// an author who removes it has deleted it: the save grafts nothing back.
	const olderSave = withUnknownComponentFields(
		{ ...BANNER_V2, inputs: BANNER_V2.inputs!.filter((i) => i.kind !== 'text') },
		{ ...BANNER_V2, inputs: [...BANNER_V2.inputs!, { id: 'extra', kind: 'text', default: 'Hi' }] },
	);
	eq(
		'3. a text row is readable now: removing it is a deletion, never a lost row put back',
		normalizeComponent(olderSave as ComponentDef).inputs?.map((i) => i.id),
		['win', 'amount'],
	);
	const conditioned: ComponentDef = {
		...BANNER_V2,
		stateMachine: {
			layers: [
				{
					...BANNER_V2.stateMachine!.layers[0],
					transitions: [
						{ id: 't', from: 'idle', to: 'win', conditions: [{ input: 'title', op: '==' }] },
					],
				},
			],
		},
	};
	eq(
		'3. a condition on a text input is flagged',
		M.validateStateMachine(conditioned, ['tl_idle', 'tl_win']).map((i) => i.code),
		['condition-input-text'],
	);
	const runner = new M.ComponentStateMachineRunner(
		conditioned.stateMachine!,
		I.componentInputs(conditioned),
		new Map([
			['tl_idle', 1],
			['tl_win', 1],
		]),
	);
	runner.advance(0.5);
	eq(
		'3. …and the runner never takes it; a text value is not a runner input',
		[runner.stateOf('main'), runner.setInput('title', 1 as never), runner.input('title')],
		['idle', false, undefined],
	);
	eq(
		'3. the interface lists the text input as Flow sees it',
		I.flowInstanceInterface(BANNER_V2).inputs,
		[
			{ id: 'win', kind: 'trigger' },
			{ id: 'amount', kind: 'number' },
			{ id: 'title', kind: 'text' },
		],
	);
}

// ---- 4. harvest --------------------------------------------------------------------------------
{
	const instances = P.projectFlowInstances(CONTAINERS, SCENES, P.instanceDefResolver(DEFS));
	const at = { x: 0, y: 0 };
	const doc: FlowDoc = {
		version: 2,
		templateId: 'bookOf',
		containers: CONTAINERS,
		graph: {
			nodes: [
				{
					id: 'i1',
					kind: 'componentInstance',
					pos: at,
					container: 'basegame',
					instance: 'c_banner',
					inputs: {
						'in:title': { kind: 'literal', type: { t: 'string' }, value: 'Big win!' },
						'in:amount': { kind: 'literal', type: { t: 'float' }, value: 3 },
					},
				},
			],
			exec: [],
			data: [],
		},
	};
	eq(
		'4. the harvest lists the text keys the flow feeds, owned by Flow',
		harvestFlowInstanceText(doc, instances).map((s) => [
			s.sceneId,
			s.origin,
			s.items.map((i) => [i.key, i.label]),
		]),
		[['__flowInstanceText', 'flow', [['Big win!', 'winBanner — title']]]],
	);
	eq('4. nothing fed ⇒ no section', harvestFlowInstanceText(doc, {}), []);
	const samples = ['Big win', '12', '', 'ü', 5, null, 'a b'];
	eq(
		'4. the two localization-key twins (engine-layout, engine-flow-v2) agree',
		samples.map((v) => E.isLocalizationKey(v)),
		samples.map((v) => N.isLocalizationKey(v)),
	);
}

// ---- 5. registry -------------------------------------------------------------------------------
{
	G.clearFlowInstances();
	const log: string[] = [];
	const handle = (id: string) => ({
		instanceId: id,
		componentId: 'banner',
		fire: (t: string) => log.push(`${id} fire ${t}`),
		setInput: (i: string, v: unknown) => log.push(`${id} set ${i}=${JSON.stringify(v)}`) > 0,
		input: () => undefined,
		values: () => ({ 'main.state': 'idle' }),
		stateOf: (layer: string) => (layer === 'main' ? 'idle' : undefined),
		shown: () => true,
		onChange: () => () => undefined,
	});
	const seen: (string | undefined)[] = [];
	const unwatch = G.watchFlowInstance('c_banner', (h) => seen.push(h?.instanceId));
	G.stashFlowInstanceInput('c_banner', 'amount', 5);
	G.stashFlowInstanceInput('c_banner', 'amount', 7);
	G.stashFlowInstanceInput('c_banner', 'title', 'Hi');
	eq('5. unmounted ⇒ no handle', G.getFlowInstance('c_banner'), undefined);
	const first = handle('c_banner');
	const unregister = G.registerFlowInstance(first);
	eq(
		'5. registration applies the stash (last write wins) and notifies the watcher',
		[log, seen, G.getFlowInstance('c_banner') === first],
		[['c_banner set amount=7', 'c_banner set title="Hi"'], ['c_banner'], true],
	);
	G.stashFlowInstanceInput('c_banner', 'amount', 1);
	eq('5. a mounted instance takes a value at once', log.at(-1), 'c_banner set amount=1');
	const second = handle('c_banner');
	const unregister2 = G.registerFlowInstance(second);
	unregister();
	eq(
		'5. the last mounted handle is live; an older unregister leaves it',
		[G.getFlowInstance('c_banner') === second, seen],
		[true, ['c_banner', 'c_banner']],
	);
	unregister2();
	eq(
		'5. unregister clears and notifies with undefined',
		[G.getFlowInstance('c_banner'), seen.at(-1)],
		[undefined, undefined],
	);
	unwatch();
	G.registerFlowInstance(handle('c_banner'));
	eq('5. an unsubscribed watcher hears nothing', seen.length, 3);
	G.clearFlowInstances();
	const older = handle('c_banner');
	const newer = handle('c_banner');
	const heard: (string | undefined)[] = [];
	G.watchFlowInstance('c_banner', (h) => heard.push(h === older ? 'older' : h?.instanceId));
	G.registerFlowInstance(older);
	const unregisterNewer = G.registerFlowInstance(newer);
	unregisterNewer();
	eq(
		'5. unmounting the newer of two handles hands the older one back (a stack per id)',
		[G.getFlowInstance('c_banner') === older, heard],
		[true, ['older', 'c_banner', 'older']],
	);
	G.clearFlowInstances();

	// The handle a mounted instance registers: a Flow value read as the input's kind.
	const fired: string[] = [];
	const set: [string, unknown][] = [];
	const { handle: h, notify } = HD.createFlowInstanceHandle({
		instanceId: 'c_banner',
		componentId: 'banner',
		version: 2,
		inputs: [
			{ id: 'win', kind: 'trigger' },
			{ id: 'lit', kind: 'bool' },
			{ id: 'amount', kind: 'number' },
			{ id: 'title', kind: 'text', default: 'win.title' },
		],
		shown: () => true,
		fireTrigger: (id) => void fired.push(id),
		runner: () => ({
			setInput: (id, value) => set.push([id, value]) > 0,
			input: (id) => (id === 'lit' ? false : 0),
			values: () => ({ 'main.state': 'idle' }),
			stateOf: (layer) => (layer === 'main' ? 'idle' : undefined),
		}),
	});
	eq(
		'5. a set is read as the input’s kind: a bool from a boolean or 0/1, a number from a number or a numeric string, a text key from a string',
		[
			h.setInput('lit', true),
			h.setInput('lit', 1),
			h.setInput('lit', 0),
			h.setInput('amount', 12.5),
			h.setInput('amount', '42'),
			h.setInput('title', 'win.big'),
			set,
			h.input('title'),
		],
		[
			true,
			true,
			true,
			true,
			true,
			true,
			[
				['lit', true],
				['lit', true],
				['lit', false],
				['amount', 12.5],
				['amount', 42],
			],
			'win.big',
		],
	);
	eq(
		'5. a value not of the kind, or an unknown id, is dropped and says so',
		[
			h.setInput('lit', 'true'),
			h.setInput('lit', 2),
			h.setInput('amount', 'abc'),
			h.setInput('amount', ''),
			h.setInput('title', 7),
			h.setInput('win', true),
			h.setInput('nope', 1),
			set.length,
		],
		[false, false, false, false, false, false, false, 5],
	);
	eq(
		'5. a fire takes a trigger only; the handle reads the runner; notify runs every listener',
		(() => {
			h.fire('win');
			h.fire('lit');
			h.fire('nope');
			const calls: number[] = [];
			const off = h.onChange(() => calls.push(1));
			notify();
			off();
			notify();
			return [fired, h.values(), h.stateOf('main'), h.stateOf('x'), h.input('lit'), calls];
		})(),
		[['win'], { 'main.state': 'idle' }, 'idle', undefined, false, [1]],
	);
	eq(
		'5. a number input the engine feeds (`source`) gets no Flow pin',
		I.flowInstanceInterface({
			id: 'meter',
			name: 'Meter',
			root: { id: 'r', type: 'group', name: 'r', children: [] },
			inputs: [
				{ id: 'balance', kind: 'number', source: 'balance' },
				{ id: 'amount', kind: 'number' },
			],
		} as unknown as ComponentDef).inputs.map((i) => i.id),
		['amount'],
	);
}

// ---- 6. the event road -------------------------------------------------------------------------
{
	const dispatched: string[] = [];
	const asked: string[] = [];
	H.setFlowV2({
		ownsContainerEvent: (id: string, action: string) => {
			asked.push(`press ${id}.${action}`);
			return id === 'dlg' && action === 'confirm';
		},
		dispatchContainerEvent: async (id: string, action: string) => {
			dispatched.push(`press ${id}.${action}`);
		},
		ownsInstanceEvent: (id: string, event: string) => {
			asked.push(`event ${id}.${event}`);
			return id === 'c_banner' && event === 'done';
		},
		dispatchInstanceEvent: async (id: string, event: string, payload?: Record<string, unknown>) => {
			dispatched.push(`event ${id}.${event} ${JSON.stringify(payload)}`);
		},
	} as unknown as Parameters<typeof H.setFlowV2>[0]);
	F.registerFlowPress(H.resolveFlowV2Press);
	F.getFlowPress()?.('c_banner', 'done', { amount: 9 }, 'event')?.();
	F.getFlowPress()?.('c_banner', 'confirm', undefined, 'event')?.();
	F.getFlowPress()?.('dlg', 'confirm')?.();
	eq(
		'6. a raised event reaches its instance event pin with its payload; a press reaches the press pins',
		dispatched,
		['event c_banner.done {"amount":9}', 'press dlg.confirm'],
	);
	eq(
		'6. an event never consults press ownership, and a press never consults event ownership',
		asked,
		['event c_banner.done', 'event c_banner.confirm', 'press dlg.confirm'],
	);
	eq(
		'6. an unowned event resolves nothing',
		H.resolveFlowV2Press('c_banner', 'confirm', undefined, 'event'),
		undefined,
	);
	H.setFlowV2(undefined);
	F.clearFlowPress();
	eq(
		'6. no flow ⇒ nothing',
		H.resolveFlowV2Press('c_banner', 'done', undefined, 'event'),
		undefined,
	);
}

// ---- 6b. the game env's waits ------------------------------------------------------------------
{
	const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));
	const waits = (shown: boolean, trace: string[], sceneOf?: string) => {
		const skip = createSkipToken();
		const w = createInstanceWaits({
			isShown: () => shown,
			sceneIdOf: () => sceneOf,
			getFlowInstance: G.getFlowInstance,
			watchFlowInstance: G.watchFlowInstance,
			skip,
			trace: (op, ...rest) => void trace.push([op, ...rest].join(' ')),
			graceMs: 20,
		});
		return { ...w, skip };
	};
	const liveHandle = (state: { main: string; shown: boolean }) => {
		const listeners = new Set<() => void>();
		return {
			handle: {
				instanceId: 'c_banner',
				componentId: 'banner',
				sceneId: 'basegame',
				fire: () => undefined,
				setInput: () => true,
				input: () => undefined,
				values: () => ({ 'main.state': state.main }),
				stateOf: (layer: string) => (layer === 'main' ? state.main : undefined),
				shown: () => state.shown,
				onChange: (l: () => void) => {
					listeners.add(l);
					return () => listeners.delete(l);
				},
			},
			change: () => {
				for (const l of [...listeners]) l();
			},
		};
	};
	const ref = { container: 'basegame', instance: 'c_banner' };
	G.clearFlowInstances();
	{
		// Slammed BEFORE the wait starts (a slam several book events before the hold): resolves at
		// once, and never subscribes — `onSkip` fires synchronously on a tripped token.
		const trace: string[] = [];
		const state = { main: 'idle', shown: true };
		const { handle } = liveHandle(state);
		const unregister = G.registerFlowInstance(handle);
		const w = waits(true, trace);
		w.skip.skip();
		let settled = false;
		const p = w.awaitInstanceState(ref, 'main', 'win').then(() => (settled = true));
		await p;
		eq(
			'6b. slammed before the hold ⇒ resolves at once, traced',
			[settled, trace],
			[true, ['instance wait c_banner main.state == win · skipped (round slammed)']],
		);
		unregister();
	}
	{
		// A slam DURING the hold releases it.
		const trace: string[] = [];
		const state = { main: 'idle', shown: true };
		const { handle } = liveHandle(state);
		const unregister = G.registerFlowInstance(handle);
		const w = waits(true, trace);
		let settled = false;
		const p = w.awaitInstanceState(ref, 'main', 'win').then(() => (settled = true));
		await tick();
		const held = !settled;
		w.skip.skip();
		await p;
		eq(
			'6b. a slam during the hold releases it',
			[held, settled, trace.at(-1)],
			[true, true, 'instance RELEASE c_banner main.state == win ▶ slammed'],
		);
		unregister();
	}
	{
		// Released by the state; a hidden instance releases too; a wait already satisfied holds nothing.
		const trace: string[] = [];
		const state = { main: 'idle', shown: true };
		const { handle, change } = liveHandle(state);
		const unregister = G.registerFlowInstance(handle);
		const w = waits(true, trace);
		let settled = false;
		const p = w.awaitInstanceState(ref, 'main', 'win').then(() => (settled = true));
		await tick();
		state.main = 'win';
		change();
		await p;
		const reached = trace.at(-1);
		await w.awaitInstanceState(ref, 'main', 'win');
		state.main = 'idle';
		state.shown = false;
		await w.awaitInstanceState(ref, 'main', 'win');
		eq(
			'6b. released by the state; satisfied and hidden waits hold nothing',
			[settled, reached, trace.at(-1)],
			[
				true,
				'instance RELEASE c_banner main.state == win ▶ reached',
				'instance wait c_banner main.state == win · skipped (hidden)',
			],
		);
		unregister();
	}
	{
		// Not registered and the screen not shown: skipped at once; a fire resolves to no handle.
		const trace: string[] = [];
		const w = waits(false, trace);
		await w.awaitInstanceState(ref, 'main', 'win');
		eq(
			'6b. not on screen ⇒ skipped at once, no handle for a fire',
			[trace, await w.instanceWhenMounted(ref)],
			[['instance wait c_banner main.state == win · skipped (not on screen)'], undefined],
		);
	}
	{
		// The screen is shown and the instance registers within the grace: the wait proceeds on it.
		const trace: string[] = [];
		const state = { main: 'idle', shown: true };
		const { handle, change } = liveHandle(state);
		const w = waits(true, trace);
		let settled = false;
		const p = w.awaitInstanceState(ref, 'main', 'win').then(() => (settled = true));
		await tick(5);
		const unregister = G.registerFlowInstance(handle);
		await tick();
		const held = !settled && trace.at(-1) === 'instance HOLD c_banner main.state == win ⏸';
		state.main = 'win';
		change();
		await p;
		eq(
			'6b. mounting late within the grace ⇒ the wait holds on the handle',
			[held, settled],
			[true, true],
		);
		unregister();
	}
	{
		// Never registers: the grace runs out and the wait is skipped.
		const trace: string[] = [];
		const w = waits(true, trace);
		const t0 = Date.now();
		await w.awaitInstanceState(ref, 'main', 'win');
		eq(
			'6b. never mounting ⇒ skipped after the grace',
			[Date.now() - t0 >= 15, trace],
			[true, ['instance wait c_banner main.state == win · skipped (not on screen)']],
		);
	}
	{
		// The instance leaves the screen mid-hold.
		const trace: string[] = [];
		const state = { main: 'idle', shown: true };
		const { handle } = liveHandle(state);
		const unregister = G.registerFlowInstance(handle);
		const w = waits(true, trace);
		let settled = false;
		const p = w.awaitInstanceState(ref, 'main', 'win').then(() => (settled = true));
		await tick();
		unregister();
		await p;
		eq(
			'6b. the instance leaving the screen releases the hold',
			[settled, trace.at(-1)],
			[true, 'instance RELEASE c_banner main.state == win ▶ instance left the screen'],
		);
	}
	{
		// A handle placed on ANOTHER screen is not the addressed placement.
		const trace: string[] = [];
		const state = { main: 'idle', shown: true };
		const { handle } = liveHandle(state);
		const unregister = G.registerFlowInstance(handle);
		const w = waits(true, trace, 'hud');
		eq(
			'6b. a handle on another screen is not the node’s instance',
			[await w.instanceWhenMounted(ref), trace[0]],
			[undefined, "instance c_banner · not on screen 'basegame' (on basegame)"],
		);
		unregister();
	}
	G.clearFlowInstances();
}

// ---- 7. the ship chain -------------------------------------------------------------------------
{
	eq(
		'7. the placed pin is what the bundle walks (`collectComponentPins`, as resolveReferencedDefs does)',
		collectComponentPins(SCENES.flatMap((s) => s.nodes)).some(
			(p) => p.id === 'banner' && p.version === 2,
		),
		true,
	);
	eq(
		'7. runtimeBundle loads every placed pin at its version',
		source('apps/launcher-api/src/lib/server/runtimeBundle.ts').includes(
			'loadComponent(pin.id, projectKey, pin.version)',
		),
		true,
	);
	R.clearComponents();
	R.registerComponents({ banner: BANNER_V2 });
	R.registerComponents({ banner: BANNER_V3 });
	const resolved = R.resolveComponent('banner', 2);
	eq(
		'7. the runtime registry resolves the pinned version, and its interface is the projection’s',
		[resolved.def?.version, resolved.versionMismatch, I.flowInstanceInterface(resolved.def)],
		[
			2,
			false,
			P.projectFlowInstances(CONTAINERS, SCENES, P.instanceDefResolver(DEFS)).c_banner.interface,
		],
	);
	R.clearComponents();
	L.registerComponentTimelines([
		{
			id: 'tl_idle',
			name: 'Idle',
			host: { kind: 'component', componentId: 'banner' },
			tracks: [],
			duration: 1,
		},
		{
			id: 'tl_win',
			name: 'Win',
			host: { kind: 'component', componentId: 'banner' },
			tracks: [],
			duration: 1,
		},
	] as never);
	eq(
		'7. the state timelines a placed instance plays resolve from the registered cinematics',
		[...L.instanceTimelineDocs('banner', BANNER_V2.stateMachine).durations.keys()].sort(),
		['tl_idle', 'tl_win'],
	);
	L.registerComponentTimelines([]);
}

// ---- 8. wiring guards --------------------------------------------------------------------------
{
	const instanceSvelte = source('packages/engine-layout/src/lib/ComponentInstance.svelte');
	eq(
		'8. ComponentInstance registers a top-level placement through the handle module, unregisters on destroy, and notifies on start, on fired transitions and on the visibility edge',
		[
			instanceSvelte.includes('allowed && def && parentNest.depth === 0'),
			instanceSvelte.includes('? createFlowInstanceHandle({'),
			instanceSvelte.includes(
				'if (flowInstance) onDestroy(registerFlowInstance(flowInstance.handle));',
			),
			instanceSvelte.includes('sceneId: getSceneIdContext(),'),
			instanceSvelte.includes('fireTrigger,\n\t\t\t\t\trunner: () => stateMachineRunner,'),
			(instanceSvelte.match(/notifyFlowInstance\(\);/g) ?? []).length,
			instanceSvelte.includes('if (step.fired.length) notifyFlowInstance();'),
			instanceSvelte.includes('if (selfVisible !== wasVisible) untrack(notifyFlowInstance);'),
			instanceSvelte.includes('svelte/reactivity'),
		],
		[true, true, true, true, true, 2, true, true, false],
	);
	eq(
		'8. LayoutScene provides its id',
		source('packages/engine-layout/src/lib/LayoutScene.svelte').includes(
			'setSceneIdContext(untrack(() => scene.id));',
		),
		true,
	);
	const runtime = source('apps/lines/src/game/flowV2Runtime.svelte.ts');
	eq(
		'8. the game env wires the four hooks, the waits module on the round’s slam token, and the event ownership',
		[
			'fireInstanceTrigger: async (ref, trigger) => {',
			'setInstanceInput: (ref, input, value) => {',
			'readInstanceValue: (ref, value) => getFlowInstance(ref.instance)?.values()[value],',
			'awaitInstanceState,',
			'ownsInstanceEvent: (instanceId, event) =>',
			'const { instanceWhenMounted, awaitInstanceState } = createInstanceWaits({',
			'skip: roundSkip,',
			'sceneIdOf: (container) => doc.containers.find((c) => c.id === container)?.sceneId,',
			'stashFlowInstanceInput(ref.instance, input, value);',
			"else trace('instance', line, '· dropped (no such input, or not its kind)');",
		].map((line) => runtime.includes(line)),
		[true, true, true, true, true, true, true, true, true, true],
	);
	eq(
		'8. a raised event plays no press sound',
		source('apps/lines/src/components/Game.svelte').includes(
			"if (kind === 'event') return routed;",
		),
		true,
	);
}

console.log(`flow instance nodes: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
