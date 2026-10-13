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
 *  5. the live REGISTRY (`flowInstances.ts`): register / get / stash-then-apply / watch / unregister;
 *  6. the EVENT ROAD: the game's resolver routes a raised event to the instance's event pins only,
 *     with its payload, and never consults the press ownership for it;
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
const F = await import('../../../packages/engine-layout/src/lib/registerFlowPress.ts');
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
}

// ---- 5. registry -------------------------------------------------------------------------------
{
	G.clearFlowInstances();
	const log: string[] = [];
	const handle = (id: string) => ({
		instanceId: id,
		componentId: 'banner',
		fire: (t: string) => log.push(`${id} fire ${t}`),
		setInput: (i: string, v: unknown) => log.push(`${id} set ${i}=${JSON.stringify(v)}`),
		input: () => undefined,
		values: () => ({ 'main.state': 'idle' }),
		stateOf: (layer: string) => (layer === 'main' ? 'idle' : undefined),
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
		'8. ComponentInstance registers a top-level placement, unregisters on destroy, and notifies on start and on fired transitions',
		[
			instanceSvelte.includes('if (allowed && def && parentNest.depth === 0) {'),
			instanceSvelte.includes('const unregister = registerFlowInstance({'),
			instanceSvelte.includes('onDestroy(unregister);'),
			instanceSvelte.includes('sceneId: getSceneIdContext(),'),
			(instanceSvelte.match(/notifyFlowInstance\(\);/g) ?? []).length,
			instanceSvelte.includes('if (step.fired.length) notifyFlowInstance();'),
		],
		[true, true, true, true, 2, true],
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
		'8. the game env wires the four hooks and the event ownership',
		[
			'fireInstanceTrigger: async (ref, trigger) => {',
			'setInstanceInput: (ref, input, value) => {',
			'readInstanceValue: (ref, value) => getFlowInstance(ref.instance)?.values()[value],',
			'awaitInstanceState,',
			'ownsInstanceEvent: (instanceId, event) =>',
			"const unskip = roundSkip.onSkip(() => finish('▶ slammed'));",
			'else stashFlowInstanceInput(ref.instance, input, value);',
		].map((line) => runtime.includes(line)),
		[true, true, true, true, true, true, true],
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
