/**
 * Spawning (`docs/design/game-families.md` §3.3, §7.2 P10.7):
 *   pnpm --filter launcher-api check:flow-spawn
 *
 *  1. THE LIVE SET (`createSpawnStore`): a spawn needs a declared layer that lists the component;
 *     the CAP refuses (and reports) a spawn over it, never grows; a cell must be on a grid layer and
 *     on its grid; ids are never reused; `live()` is a fresh array; despawn, subscribe, clear.
 *  2. THE CAP through the interpreter: forty spawns into a layer of cap 32 leave 32 live, and the
 *     Spawn node's `spawned` reads false for the refused eight.
 *  3. DESPAWN INSIDE `forEach` over `$live`: every instance below the floor goes, none is skipped —
 *     even when the env hands back its own array (the interpreter copies the read).
 *  4. INSTANCE REF: sets and fires reach the handle's address (`spawnedRef`); a despawned handle
 *     takes nothing; a spawned instance's raised event runs the ref's chain with the handle in
 *     `$trigger.instance` (and on `handle`), owned only for its component; a spawned Wait for state.
 *  5. PINS and VALIDATION: Spawn's x / y or col / row pins; `$live` typing; `spawn-layer-unknown`,
 *     `spawn-not-spawnable`, `spawn-cell-free`, an Instance ref no layer can address, a handle of the
 *     wrong component, `$item.<field>` over a live set, `instance-event-duplicate`; nothing is judged
 *     without the projection.
 *  6. THE PREVIEW runs a spawn chain on the same store and rules.
 *  7. THE SHIP CHAIN (rule 8): `collectComponentIds` and `resolveComponentClosure` collect every
 *     spawnable (and what it nests); `spawnLayerSpec` reads a malformed node safely;
 *     `projectSpawnLayers` projects the layers of the flow's screens.
 *  8. PARITY: no committed seed flow spawns; the game builds no live set for a doc that does not
 *     (source-scanned), and `<SpawnLayer>` keys each instance by its handle id.
 */
import { readFileSync } from 'node:fs';
import type {
	FlowDoc,
	FlowSpawnLayerDecl,
	FlowV2Env,
	FunctionLibraryDoc,
	InstanceInterface,
	InstanceRef,
	Node,
	RunContext,
	TemplateVocabulary,
} from 'engine-flow-v2';
import type { ComponentDef, LayoutNode, Scene, SpawnLayerNode } from 'engine-layout';

const F = await import('../../../packages/engine-flow-v2/index.ts');
const K = await import('../../../packages/engine-layout/src/lib/collectComponentIds.ts');
const S = await import('../../../packages/engine-layout/src/lib/spawnLayers.ts');
const { projectSpawnLayers, instanceDefResolver } = await import('../src/lib/flowV2Projection.ts');

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

const at = { x: 0, y: 0 };
const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };
const VOCAB: TemplateVocabulary = {
	templateId: 'fixture',
	structs: [],
	enums: [],
	events: [{ name: 'go', payload: [] }],
	actions: [{ name: 'beat', params: [], category: 'effect' }],
	cues: [],
	collections: [],
	values: [],
};
const graph = (
	nodes: Node[],
	exec: FlowDoc['graph']['exec'] = [],
	data: FlowDoc['graph']['data'] = [],
) => ({
	nodes,
	exec,
	data,
});
const doc = (g: FlowDoc['graph']): FlowDoc => ({
	version: 2,
	templateId: 'fixture',
	graph: g,
	containers: [{ id: 'field', sceneId: 'field', z: 0 }],
});
const wire = (from: string, fromPin: string, to: string, toPin: string) => ({
	from: { node: from, pin: fromPin },
	to: { node: to, pin: toPin },
});
const lit = (value: unknown, t: 'int' | 'float' | 'bool' | 'string' = 'float') => ({
	kind: 'literal' as const,
	type: { t },
	value,
});
/** A recorder env over a real live set, as the game wires one (`flowV2Runtime`). */
const envOver = (
	store: ReturnType<typeof F.createSpawnStore>,
	log: string[],
	opts: { sharedArray?: boolean } = {},
): FlowV2Env => ({
	effect: (name) => void log.push(`effect ${name}`),
	broadcast: () => undefined,
	waitForTimeout: () => Promise.resolve(),
	timeScale: () => 1,
	showContainer: () => undefined,
	hideContainer: () => undefined,
	engineRead: () => undefined,
	spawn: (layer, componentId, place) => {
		const r = store.spawn(layer, componentId, place);
		return r.ok ? r.instance : undefined;
	},
	despawn: (instance) => void store.despawn(F.spawnedIdOf(instance) ?? ''),
	liveInstances: opts.sharedArray
		? (() => {
				// A careless env: the SAME array every read, mutated in place by a despawn.
				const shared: unknown[] = [];
				return (layer: string) => {
					shared.length = 0;
					shared.push(...store.live(layer));
					const despawn = store.despawn.bind(store);
					store.despawn = (i) => {
						const gone = despawn(i);
						if (gone) shared.splice(shared.indexOf(gone), 1);
						return gone;
					};
					return shared;
				};
			})()
		: (layer) => store.live(layer),
	spawnedRef: (instance) => {
		const id = F.spawnedIdOf(instance);
		return id && store.get(id) ? { container: 'field', instance: id } : undefined;
	},
	setInstanceInput: (ref: InstanceRef, input, value) =>
		void log.push(`set ${ref.instance}.${input}=${JSON.stringify(value)}`),
	fireInstanceTrigger: (ref: InstanceRef, trigger) =>
		void log.push(`fire ${ref.instance}▸${trigger}`),
	awaitInstanceState: async (ref: InstanceRef, layer, state) =>
		void log.push(`wait ${ref.instance} ${layer}=${state}`),
});
const ctxOf = (env: FlowV2Env): RunContext => ({ vocab: VOCAB, library: LIBRARY, env });

const FIELD: Parameters<ReturnType<typeof F.createSpawnStore>['declare']>[0] = {
	id: 'field',
	spawnable: ['coin', 'bomb'],
	cap: 32,
	placement: 'free',
};
const BOARD = {
	id: 'board',
	spawnable: ['coin'],
	cap: 4,
	placement: 'grid' as const,
	grid: { cols: 3, rows: 2, pitch: 50 },
};

// ---------------------------------------------------------------------------
console.log('1. the live set');
{
	const refused: string[] = [];
	const store = F.createSpawnStore({ onRefuse: (l, c, r) => void refused.push(`${l}/${c}/${r}`) });
	eq('an undeclared layer refuses', store.spawn('field', 'coin', at), {
		ok: false,
		reason: 'unknown-layer',
	});
	store.declare(FIELD);
	store.declare(BOARD);
	eq('a component the layer does not list is refused', store.spawn('field', 'gem', at).ok, false);
	const a = store.spawn('field', 'coin', { x: 10, y: 20 });
	const b = store.spawn('field', 'bomb', { x: Number.NaN, y: 5 });
	eq('a spawn returns its handle', a.ok && { ...a.instance }, {
		id: 'field#1',
		layer: 'field',
		componentId: 'coin',
		x: 10,
		y: 20,
	});
	eq('a non-finite x lands at 0', b.ok && b.instance.x, 0);
	eq('a handle is frozen', a.ok && Object.isFrozen(a.instance), true);
	const first = store.live('field');
	first.pop();
	eq('live() is a fresh array each read', store.live('field').length, 2);
	eq(
		'… oldest first',
		store.live('field').map((i) => i.id),
		['field#1', 'field#2'],
	);
	const seen: number[] = [];
	const stop = store.subscribe('field', (l) => void seen.push(l.length));
	eq('subscribe hears the set at once', seen, [2]);
	eq('despawn returns what it removed', store.despawn('field#1')?.componentId, 'coin');
	eq('… and the subscriber heard it', seen, [2, 1]);
	eq('a despawned id is not live', store.get('field#1'), undefined);
	eq('despawning it again is nothing', store.despawn('field#1'), undefined);
	stop();
	const c = store.spawn('field', 'coin', at);
	eq('ids are never reused', c.ok && c.instance.id, 'field#3');
	eq(
		'a cell into a free layer is refused',
		store.spawn('field', 'coin', { cell: { col: 0, row: 0 } }).ok,
		false,
	);
	const cell = store.spawn('board', 'coin', { cell: { col: 2, row: 1 } });
	eq(
		'a cell lands at col × pitch, row × pitch',
		cell.ok && [cell.instance.x, cell.instance.y, cell.instance.col, cell.instance.row],
		[100, 50, 2, 1],
	);
	for (const off of [
		{ col: 3, row: 0 },
		{ col: 0, row: 2 },
		{ col: -1, row: 0 },
		{ col: 0.5, row: 0 },
	])
		eq(
			`a cell off the grid is refused (${off.col}, ${off.row})`,
			store.spawn('board', 'coin', { cell: off }).ok,
			false,
		);
	for (let i = 0; i < 5; i++) store.spawn('board', 'coin', { cell: { col: 0, row: 0 } });
	eq('the CAP holds: board keeps 4', store.live('board').length, 4);
	eq(
		'a refused spawn is reported with its reason',
		refused.includes('board/coin/cap') &&
			refused.includes('field/gem/not-spawnable') &&
			refused.includes('board/coin/cell'),
		true,
	);
	store.clear();
	eq('clear empties every layer', [store.live('field').length, store.live('board').length], [0, 0]);
	eq('… and keeps the declarations', store.spawn('field', 'coin', at).ok, true);
	eq(
		'effectiveSpawnCap',
		[undefined, 0, -3, 2.9, 999, 'x'].map((v) => F.effectiveSpawnCap(v)),
		[32, 1, 1, 2, 256, 32],
	);
}

// ---------------------------------------------------------------------------
console.log('2. the cap through the interpreter');
{
	const store = F.createSpawnStore();
	store.declare(FIELD);
	const log: string[] = [];
	const list = Array.from({ length: 40 }, (_, i) => i);
	const g = graph(
		[
			{ id: 'go', kind: 'event', ref: 'go', pos: at },
			{
				id: 'loop',
				kind: 'forEach',
				mode: 'sequence',
				pos: at,
				inputs: { in: { kind: 'literal', type: { t: 'list', of: { t: 'int' } }, value: list } },
			},
			{
				id: 'sp',
				kind: 'spawn',
				layer: 'field',
				componentId: 'coin',
				pos: at,
				inputs: { x: lit(1), y: lit(2) },
			},
			{
				id: 'br',
				kind: 'branch',
				pos: at,
				guard: { all: [{ left: { kind: 'wire' }, op: 'eq', right: lit(false, 'bool') }] },
			},
			{ id: 'refused', kind: 'action', ref: 'beat', pos: at },
		],
		[
			wire('go', 'exec', 'loop', 'exec'),
			wire('loop', 'body', 'sp', 'exec'),
			wire('sp', 'exec', 'br', 'exec'),
			wire('br', 'then', 'refused', 'exec'),
		],
		[wire('sp', 'spawned', 'br', 'all.0.left')],
	);
	await F.runFlowEvent(doc(g), ctxOf(envOver(store, log)), 'go', {});
	eq('40 spawns into cap 32 leave 32 live', store.live('field').length, 32);
	eq('`spawned` reads false for the 8 refused', log.filter((l) => l === 'effect beat').length, 8);
}

// ---------------------------------------------------------------------------
console.log('3. despawn inside forEach over $live');
for (const sharedArray of [false, true]) {
	const store = F.createSpawnStore();
	store.declare(FIELD);
	const ys = [120, 150, 10, 200, 30, 101, 99, 100];
	for (const y of ys) store.spawn('field', 'coin', { x: 0, y });
	const g = graph(
		[
			{ id: 'go', kind: 'event', ref: 'go', pos: at },
			{
				id: 'loop',
				kind: 'forEach',
				mode: 'sequence',
				pos: at,
				inputs: { in: { kind: 'accessor', path: { on: 'live', layer: 'field' } } },
			},
			{
				id: 'br',
				kind: 'branch',
				pos: at,
				guard: {
					all: [
						{
							left: { kind: 'accessor', path: { on: 'item', member: 'y' } },
							op: 'gte',
							right: lit(100),
						},
					],
				},
			},
			{
				id: 'gone',
				kind: 'despawn',
				pos: at,
				inputs: { instance: { kind: 'accessor', path: { on: 'item' } } },
			},
		],
		[
			wire('go', 'exec', 'loop', 'exec'),
			wire('loop', 'body', 'br', 'exec'),
			wire('br', 'then', 'gone', 'exec'),
		],
	);
	await F.runFlowEvent(doc(g), ctxOf(envOver(store, [], { sharedArray })), 'go', {});
	eq(
		`every instance at or below the floor goes, none skipped${sharedArray ? ' (env hands back its own array)' : ''}`,
		store.live('field').map((i) => i.y),
		[10, 30, 99],
	);
}

// ---------------------------------------------------------------------------
console.log('4. instance ref');
const COIN_INTERFACE: InstanceInterface = {
	inputs: [
		{ id: 'value', kind: 'number' },
		{ id: 'pop', kind: 'trigger' },
	],
	events: [{ id: 'hit', payload: [{ name: 'power', type: { t: 'int' } }] }],
	values: [{ id: 'main.state', layer: 'main', states: ['idle', 'gone'] }],
};
const LAYERS: Record<string, FlowSpawnLayerDecl> = {
	field: {
		container: 'field',
		layer: 'field',
		name: 'Play field',
		placement: 'free',
		cap: 32,
		spawnable: [
			{ componentId: 'coin', interface: COIN_INTERFACE },
			{ componentId: 'bomb', interface: { inputs: [], events: [], values: [] } },
		],
	},
	board: {
		container: 'field',
		layer: 'board',
		name: 'Board',
		placement: 'grid',
		grid: { cols: 3, rows: 2, pitch: 50 },
		cap: 4,
		spawnable: [{ componentId: 'coin', interface: COIN_INTERFACE }],
	},
};
{
	const store = F.createSpawnStore();
	store.declare(FIELD);
	const log: string[] = [];
	const g = graph(
		[
			{ id: 'go', kind: 'event', ref: 'go', pos: at },
			{
				id: 'sp',
				kind: 'spawn',
				layer: 'field',
				componentId: 'coin',
				pos: at,
				inputs: { x: lit(5), y: lit(6) },
			},
			{
				id: 'ref',
				kind: 'instanceRef',
				componentId: 'coin',
				pos: at,
				inputs: { 'in:value': lit(7) },
			},
			{ id: 'kill', kind: 'despawn', pos: at },
			{ id: 'ref2', kind: 'instanceRef', componentId: 'coin', pos: at },
			{
				id: 'wait',
				kind: 'waitForState',
				container: '',
				instance: '',
				componentId: 'coin',
				layer: 'main',
				state: 'gone',
				pos: at,
			},
		],
		[
			wire('go', 'exec', 'sp', 'exec'),
			wire('sp', 'exec', 'ref', 'fire:pop'),
			wire('ref', 'exec', 'wait', 'exec'),
			wire('wait', 'exec', 'kill', 'exec'),
			wire('kill', 'exec', 'ref2', 'fire:pop'),
		],
		[
			wire('sp', 'instance', 'ref', 'instance'),
			wire('sp', 'instance', 'wait', 'instance'),
			wire('ref', 'handle', 'kill', 'instance'),
			wire('sp', 'instance', 'ref2', 'instance'),
		],
	);
	await F.runFlowEvent(doc(g), ctxOf(envOver(store, log)), 'go', {});
	eq('set + fire reach the handle; a spawned wait; a despawned handle takes nothing', log, [
		'set field#1.value=7',
		'fire field#1▸pop',
		'wait field#1 main=gone',
	]);

	// Events: a spawned coin raises `hit`; the ref's chain despawns it through `handle`.
	const evStore = F.createSpawnStore();
	evStore.declare(FIELD);
	const coin = evStore.spawn('field', 'coin', at);
	const bomb = evStore.spawn('field', 'bomb', at);
	const evLog: string[] = [];
	const ev = doc(
		graph(
			[
				{ id: 'ref', kind: 'instanceRef', componentId: 'coin', pos: at },
				{ id: 'kill', kind: 'despawn', pos: at },
				{ id: 'beat', kind: 'action', ref: 'beat', pos: at },
				{
					id: 'power',
					kind: 'branch',
					pos: at,
					guard: { all: [{ left: { kind: 'wire' }, op: 'eq', right: lit(3, 'int') }] },
				},
			],
			[
				wire('ref', 'event:hit', 'kill', 'exec'),
				wire('kill', 'exec', 'power', 'exec'),
				wire('power', 'then', 'beat', 'exec'),
			],
			[
				wire('ref', 'handle', 'kill', 'instance'),
				wire('ref', 'event:hit:power', 'power', 'all.0.left'),
			],
		),
	);
	eq("the coin's `hit` is owned", F.flowOwnsSpawnedEvent(ev, 'coin', 'hit'), true);
	eq("… not the bomb's", F.flowOwnsSpawnedEvent(ev, 'bomb', 'hit'), false);
	eq("… nor a placed instance's event", F.flowOwnsInstanceEvent(ev, 'ref', 'hit'), false);
	await F.runFlowSpawnedEvent(
		ev,
		ctxOf(envOver(evStore, evLog)),
		'coin',
		'hit',
		coin.ok && coin.instance,
		{ power: 3 },
	);
	eq(
		'the raising instance despawns through `handle`',
		evStore.live('field').map((i) => i.componentId),
		['bomb'],
	);
	eq('… and its payload field reads on the chain', evLog, ['effect beat']);
	eq('the trigger carries the handle', bomb.ok, true);
}

// ---------------------------------------------------------------------------
console.log('5. pins and validation');
{
	const pins = (node: Node) =>
		F.derivePins(node, { vocab: VOCAB, library: LIBRARY, spawnLayers: LAYERS }).map(
			(p) =>
				`${p.dir}:${p.id}${p.dataType ? `:${p.dataType.t}${(p.dataType as { component?: string }).component ? `<${(p.dataType as { component?: string }).component}>` : ''}` : ''}`,
		);
	eq(
		'spawn at x / y',
		pins({ id: 's', kind: 'spawn', layer: 'field', componentId: 'coin', pos: at }),
		[
			'in:exec',
			'out:exec',
			'in:x:float',
			'in:y:float',
			'out:instance:instance<coin>',
			'out:spawned:bool',
		],
	);
	eq(
		'spawn at a cell',
		pins({
			id: 's',
			kind: 'spawn',
			layer: 'board',
			componentId: 'coin',
			at: 'cell',
			pos: at,
		}).slice(2, 4),
		['in:col:int', 'in:row:int'],
	);
	eq(
		'instance ref = the interface + instance / handle',
		pins({ id: 'r', kind: 'instanceRef', componentId: 'coin', pos: at }),
		[
			'in:set',
			'in:instance:instance<coin>',
			'in:fire:pop',
			'in:in:value:float',
			'out:exec',
			'out:event:hit',
			'out:event:hit:power:int',
			'out:value:main.state:string',
			'out:handle:instance<coin>',
		],
	);
	eq(
		'a placed wait keeps its two pins',
		pins({
			id: 'w',
			kind: 'waitForState',
			container: 'c',
			instance: 'i',
			layer: 'main',
			state: 'idle',
			pos: at,
		}),
		['in:exec', 'out:exec'],
	);
	eq(
		'`instance<coin>` → `instance` (any)',
		F.assignable({ t: 'instance', component: 'coin' }, { t: 'instance' }),
		true,
	);
	eq(
		'`instance` (any) → `instance<coin>`',
		F.assignable({ t: 'instance' }, { t: 'instance', component: 'coin' }),
		true,
	);
	eq(
		'`instance<bomb>` ↛ `instance<coin>`',
		F.assignable({ t: 'instance', component: 'bomb' }, { t: 'instance', component: 'coin' }),
		false,
	);
	eq('`instance` ↛ `string`', F.assignable({ t: 'instance' }, { t: 'string' }), false);

	const codes = (
		g: FlowDoc['graph'],
		layers: Record<string, FlowSpawnLayerDecl> | undefined = LAYERS,
	) =>
		F.validateFlowDoc(
			doc(g),
			VOCAB,
			LIBRARY,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			layers,
		)
			.map((i) => i.code)
			.sort();
	const go: Node = { id: 'go', kind: 'event', ref: 'go', pos: at };
	const spawnTo = (layer: string, componentId: string, extra: Partial<Node> = {}): Node =>
		({
			id: 's',
			kind: 'spawn',
			layer,
			componentId,
			pos: at,
			inputs: { x: lit(0), y: lit(0), col: lit(0, 'int'), row: lit(0, 'int') },
			...extra,
		}) as Node;
	/** An instance ref is entered on `set` (its exec-ins are `set` / `fire:<trigger>`). */
	const inlet = (node: Node): string => (node.kind === 'instanceRef' ? 'set' : 'exec');
	const chain = (...nodes: Node[]) =>
		graph([go, ...nodes], [wire('go', 'exec', nodes[0].id, inlet(nodes[0]))]);
	eq('a valid spawn has no issue', codes(chain(spawnTo('field', 'coin'))), []);
	eq('spawn-layer-unknown', codes(chain(spawnTo('nowhere', 'coin'))), ['spawn-layer-unknown']);
	eq('spawn-not-spawnable', codes(chain(spawnTo('board', 'bomb'))), ['spawn-not-spawnable']);
	eq('spawn-cell-free', codes(chain(spawnTo('field', 'coin', { at: 'cell' } as Partial<Node>))), [
		'spawn-cell-free',
	]);
	eq(
		'a cell into a grid layer is fine',
		codes(chain(spawnTo('board', 'coin', { at: 'cell' } as Partial<Node>))),
		[],
	);
	eq(
		'nothing is judged without the projection',
		codes(chain(spawnTo('nowhere', 'gem', { at: 'cell' } as Partial<Node>)), null),
		[],
	);
	eq(
		'an instance ref no layer lists',
		codes(chain({ id: 'r', kind: 'instanceRef', componentId: 'gem', pos: at })),
		['spawn-not-spawnable'],
	);
	eq(
		'a stored set the interface lacks',
		codes(
			chain({
				id: 'r',
				kind: 'instanceRef',
				componentId: 'coin',
				pos: at,
				inputs: { 'in:gone': lit(1) },
			}),
		),
		['instance-pin-missing'],
	);
	eq(
		'a spawned wait on a state its layer lacks',
		codes(
			chain({
				id: 'w',
				kind: 'waitForState',
				container: '',
				instance: '',
				componentId: 'coin',
				layer: 'main',
				state: 'nope',
				pos: at,
			}),
		),
		['instance-state-unknown'],
	);
	const live = (layer: string) => ({
		kind: 'accessor' as const,
		path: { on: 'live' as const, layer },
	});
	const loopOver = (
		layer: string,
		body: Node,
		extra: Node[] = [],
		data: FlowDoc['graph']['data'] = [],
	) =>
		graph(
			[
				go,
				{ id: 'loop', kind: 'forEach', mode: 'sequence', pos: at, inputs: { in: live(layer) } },
				body,
				...extra,
			],
			[wire('go', 'exec', 'loop', 'exec'), wire('loop', 'body', body.id, inlet(body))],
			data,
		);
	const despawnItem: Node = {
		id: 'd',
		kind: 'despawn',
		pos: at,
		inputs: { instance: { kind: 'accessor', path: { on: 'item' } } },
	};
	eq('a despawn of $item over $live is fine', codes(loopOver('field', despawnItem)), []);
	eq('$live of an unknown layer', codes(loopOver('nowhere', despawnItem)), ['spawn-layer-unknown']);
	eq(
		'$item.x over a live set is a float',
		codes(
			loopOver('field', {
				id: 'b',
				kind: 'branch',
				pos: at,
				guard: {
					all: [
						{
							left: { kind: 'accessor', path: { on: 'item', member: 'x' } },
							op: 'gt',
							right: lit(1),
						},
					],
				},
			}),
		),
		[],
	);
	eq(
		'$item.<not a field> over a live set',
		codes(
			loopOver('field', {
				id: 'r',
				kind: 'instanceRef',
				componentId: 'coin',
				pos: at,
				inputs: { 'in:value': { kind: 'accessor', path: { on: 'item', member: 'speed' } } },
			}),
		),
		['accessor-unresolved'],
	);
	eq(
		'a coin-only layer feeds a coin ref; a bomb ref is a type mismatch',
		[
			codes(
				loopOver('board', {
					id: 'r',
					kind: 'instanceRef',
					componentId: 'coin',
					pos: at,
					inputs: { instance: { kind: 'accessor', path: { on: 'item' } } },
				}),
			),
			codes(
				loopOver('board', {
					id: 'r',
					kind: 'instanceRef',
					componentId: 'bomb',
					pos: at,
					inputs: { instance: { kind: 'accessor', path: { on: 'item' } } },
				}),
			),
		],
		[[], ['type-mismatch']],
	);
	eq(
		'two refs wiring one spawned event',
		codes(
			graph(
				[
					{ id: 'a', kind: 'instanceRef', componentId: 'coin', pos: at },
					{ id: 'b', kind: 'instanceRef', componentId: 'coin', pos: at },
					{ id: 'x', kind: 'action', ref: 'beat', pos: at },
					{ id: 'y', kind: 'action', ref: 'beat', pos: at },
				],
				[wire('a', 'event:hit', 'x', 'exec'), wire('b', 'event:hit', 'y', 'exec')],
			),
		),
		['instance-event-duplicate'],
	);
	eq(
		'a handle is never a literal',
		codes(
			chain({ id: 'd', kind: 'despawn', pos: at, inputs: { instance: lit('field#1', 'string') } }),
		),
		['literal-type'],
	);
	eq(
		'a tick may spawn (spawning never waits)',
		codes(
			graph(
				[{ id: 't', kind: 'onTick', every: 800, pos: at }, spawnTo('field', 'coin')],
				[wire('t', 'exec', 's', 'exec')],
			),
		),
		[],
	);
}

// ---------------------------------------------------------------------------
console.log('6. the preview');
{
	const g = graph(
		[
			{ id: 'go', kind: 'event', ref: 'go', pos: at },
			{
				id: 'loop',
				kind: 'forEach',
				mode: 'sequence',
				pos: at,
				inputs: {
					in: { kind: 'literal', type: { t: 'list', of: { t: 'int' } }, value: [0, 1, 2, 3, 4, 5] },
				},
			},
			{
				id: 's',
				kind: 'spawn',
				layer: 'board',
				componentId: 'coin',
				pos: at,
				inputs: { x: lit(0), y: lit(0) },
			},
			{
				id: 'sweep',
				kind: 'forEach',
				mode: 'sequence',
				pos: at,
				inputs: { in: { kind: 'accessor', path: { on: 'live', layer: 'board' } } },
			},
			{
				id: 'd',
				kind: 'despawn',
				pos: at,
				inputs: { instance: { kind: 'accessor', path: { on: 'item' } } },
			},
		],
		[
			wire('go', 'exec', 'loop', 'exec'),
			wire('loop', 'body', 's', 'exec'),
			wire('loop', 'done', 'sweep', 'exec'),
			wire('sweep', 'body', 'd', 'exec'),
		],
	);
	const run = await F.previewFlowEvent(doc(g), { vocab: VOCAB, library: LIBRARY }, 'go', {
		spawnLayers: F.spawnSpecsOf(Object.values(LAYERS)),
	});
	eq(
		'spawns up to the cap, refuses the rest, then sweeps them all',
		run.timeline.map((e) =>
			e.kind === 'spawn'
				? (e.refused ?? e.instance)
				: e.kind === 'despawn'
					? `-${e.instance}`
					: e.kind,
		),
		[
			'board#1',
			'board#2',
			'board#3',
			'board#4',
			'cap',
			'cap',
			'-board#1',
			'-board#2',
			'-board#3',
			'-board#4',
		],
	);
	const none = await F.previewFlowEvent(doc(g), { vocab: VOCAB, library: LIBRARY }, 'go');
	eq(
		'with no layers every spawn is refused',
		none.timeline.filter((e) => e.kind === 'spawn' && e.refused === 'unknown-layer').length,
		6,
	);
}

// ---------------------------------------------------------------------------
console.log('7. the ship chain');
{
	const layerNode = (extra: Partial<SpawnLayerNode> = {}): SpawnLayerNode => ({
		id: 'field',
		kind: 'spawnLayer',
		x: 0,
		y: 0,
		spawnable: ['coin', 'bomb'],
		placement: 'free',
		cap: 8,
		...extra,
	});
	const container: LayoutNode = {
		id: 'group',
		kind: 'container',
		x: 0,
		y: 0,
		children: [layerNode()],
	} as LayoutNode;
	eq(
		'collectComponentIds collects every spawnable (inside a container too)',
		K.collectComponentIds([container]).sort(),
		['bomb', 'coin'],
	);
	const def = (id: string, children: LayoutNode[] = []): ComponentDef =>
		({
			id,
			name: id,
			version: 1,
			scope: 'project',
			category: 'ui',
			params: [],
			root: { id: 'root', kind: 'container', x: 0, y: 0, children },
		}) as unknown as ComponentDef;
	const library: Record<string, ComponentDef> = {
		coin: def('coin', [
			{ id: 'spark', kind: 'componentInstance', componentId: 'spark', x: 0, y: 0 } as LayoutNode,
		]),
		bomb: def('bomb'),
		spark: def('spark'),
	};
	const closure = await K.resolveComponentClosure([layerNode()], async (id) => library[id]);
	eq(
		'resolveComponentClosure ships the spawnables and what they nest',
		Object.keys(closure).sort(),
		['bomb', 'coin', 'spark'],
	);
	eq(
		'a doc with no spawn layer collects as before',
		K.collectComponentIds([
			{ id: 'i', kind: 'componentInstance', componentId: 'coin', x: 0, y: 0 } as LayoutNode,
		]),
		['coin'],
	);
	eq(
		'spawnLayerSpec reads a malformed node safely',
		S.spawnLayerSpec({
			...layerNode(),
			spawnable: ['coin', '', 7, 'coin', 'bomb'] as unknown as string[],
			placement: 'grid',
			grid: { cols: 0, rows: 2, pitch: 10 },
			cap: 9999,
		}),
		{ id: 'field', spawnable: ['coin', 'bomb'], cap: 256, placement: 'free' },
	);
	eq(
		'… and a whole grid',
		S.spawnLayerSpec(
			layerNode({ placement: 'grid', grid: { cols: 3, rows: 2, pitch: 40 }, cap: undefined }),
			'scene',
		),
		{
			id: 'field',
			spawnable: ['coin', 'bomb'],
			cap: 32,
			placement: 'grid',
			grid: { cols: 3, rows: 2, pitch: 40 },
			sceneId: 'scene',
		},
	);
	eq(
		'spawnable not an array reads as none',
		S.spawnableComponentIds({ ...layerNode(), spawnable: 'coin' as unknown as string[] }),
		[],
	);
	const scenes: Scene[] = [
		{ id: 'field', name: 'Field', nodes: [container] },
		{ id: 'unshown', name: 'Unshown', nodes: [layerNode({ id: 'other' })] },
	];
	const projected = projectSpawnLayers(
		[{ id: 'fieldContainer', sceneId: 'field', z: 0 }],
		scenes,
		instanceDefResolver([library.coin]),
	);
	eq("projectSpawnLayers keys the layers of the flow's screens", Object.keys(projected), ['field']);
	eq(
		'… with the screen, cap and each spawnable (missing when unresolved)',
		{
			container: projected.field.container,
			cap: projected.field.cap,
			spawnable: projected.field.spawnable.map((s) => `${s.componentId}${s.missing ? '!' : ''}`),
		},
		{ container: 'fieldContainer', cap: 8, spawnable: ['coin', 'bomb!'] },
	);
	eq(
		'sceneSpawnLayers finds the layers of every scene',
		S.sceneSpawnLayers(scenes).map((l) => `${l.sceneId}/${l.node.id}`),
		['field/field', 'unshown/other'],
	);
	eq(
		'LAYOUT_NODE_KINDS carries spawnLayer (the save keeps it)',
		source('packages/engine-layout/src/lib/types.ts').includes("\t'spawnLayer',\n] as const"),
		true,
	);
}

// ---------------------------------------------------------------------------
console.log('8. parity');
{
	eq(
		'no committed seed flow spawns',
		Object.entries(F.DRIVEN_SEEDS)
			.filter(([, seed]) => F.flowUsesSpawn(seed))
			.map(([id]) => id),
		[],
	);
	eq(
		'a doc reading $live uses spawning',
		F.flowUsesSpawn(
			doc(
				graph([
					{
						id: 'b',
						kind: 'branch',
						pos: at,
						guard: {
							all: [
								{
									left: { kind: 'accessor', path: { on: 'live', layer: 'x' } },
									op: 'eq',
									right: lit(0),
								},
							],
						},
					},
				]),
			),
		),
		true,
	);
	const runtime = source('apps/lines/src/game/flowV2Runtime.svelte.ts');
	eq(
		'the game builds its live set only for a doc that spawns',
		/const live = flowUsesSpawn\(doc\) \? spawnStore\(\) : undefined;/.test(runtime),
		true,
	);
	eq('… and wires no spawn env without one', /\.\.\.\(live\s*\?/.test(runtime), true);
	const view = source('packages/engine-layout/src/lib/SpawnLayer.svelte');
	eq(
		'<SpawnLayer> keys each instance by its handle id',
		view.includes('{#each instances as instance (instance.id)}'),
		true,
	);
	eq('… and gives its instance node that id', /id: instance\.id,/.test(view), true);
}

console.log(`\nflow-spawn: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
