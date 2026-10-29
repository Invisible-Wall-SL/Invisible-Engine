/**
 * Flow game variables and their `var:` bindings (`docs/design/game-families.md` §3.1, §7.2):
 *   pnpm --filter launcher-api check:flow-variables
 *
 *  1. THE STORE (`createFlowState`): every variable starts at its initial; a write of the wrong kind
 *     is dropped (an int truncates, an enum keeps to its values); Change adds, subtracts, clamps and
 *     toggles; scopes reset correctly — `round` on `resetRound`, a mode's own on `enterMode(id)`,
 *     `game` never — and a reset is a write like any other.
 *  2. BATCHING: ten writes in a frame reach a subscriber once; a flush lists every write in order.
 *  3. `onVariable` THRESHOLDS (`variableEntries` + `runFlowStateEntry`): `changed` once per batch with
 *     the latest value, none when the batch left it where it was; `crosses` per crossing write, up /
 *     down / either, at-or-past the threshold; a mode's entries run while that mode is on screen, and a
 *     batch is split per variable so a mode's entry never hides a global one.
 *  4. THE INTERPRETER: Set / Change go through `env.state`; a `$var` read feeds a branch; an env with
 *     no store makes them no-ops (every doc authored before P10.3).
 *  5. VALIDATION: `variable-unknown`, `variable-type`, `variable-scope`, `variable-duplicate`,
 *     `variable-shadows-money` (a money name, a variable fed to a money param; not in a rules game),
 *     `variable-server-owned` (P11.2: a room value Flow sets or changes, one it cannot mirror, the
 *     lists the room and the vocabulary share, Salmons' flow on its layout),
 *     `$var` typing; and no committed seed flow gains a variable issue.
 *  6. `var:` BINDINGS: `variableValueSources` names `var:<id>`, passes numbers and strings, a bool as
 *     1 / 0, and hears changes once per flush; engine-layout's coercion reads 1 / 0 as on / off.
 *  7. `source` WIDENED TO BOOL / TEXT: the launcher normalizer keeps it on a bool, number and text
 *     input, never on a trigger, and drops nothing it kept before; the Component Editor's setter
 *     writes it on all three; `<ComponentInstance>` subscribes all three (source-scanned); the input
 *     row suggests only the variables of its kind.
 *  8. RENAMING a variable in `/flow-v2` (`renameVariable`) rewrites every node and `$var` read of it,
 *     in group bodies and mode graphs too.
 */
import { readFileSync } from 'node:fs';
import type {
	DataSource,
	FlowDoc,
	FlowV2Env,
	FlowVariable,
	FunctionLibraryDoc,
	Graph,
	Node,
	RunContext,
	TemplateVocabulary,
} from 'engine-flow-v2';

const F = await import('../../../packages/engine-flow-v2/index.ts');
const M = await import('../../../packages/engine-mechanics/src/onlineFlow.js');
const { SALMONS_SEED_DOC } =
	await import('../../../packages/engine-flow-v2/src/reference/salmonsSeed.ts');
const { salmonsRiver } = await import('../../../packages/engine-mechanics/src/salmons.js');
const { salmonsReferenceLayout } =
	await import('../../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts');
const { normalizeComponent } = await import('../src/lib/server/componentStorage.ts');
const { setInputSource } = await import('../src/lib/timeline/stateMachineEdit.ts');
const { coerceInstanceInput } =
	await import('../../../packages/engine-layout/src/lib/flowInstanceHandle.ts');

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
	actions: [
		{ name: 'beat', params: [], category: 'effect' },
		{ name: 'winUpdate', params: [{ name: 'amount', type: { t: 'float' } }], category: 'effect' },
	],
	cues: [],
	collections: [],
	values: [],
};
const v = (
	id: string,
	type: FlowVariable['type'],
	initial: FlowVariable['initial'],
	scope: FlowVariable['scope'] = 'game',
	values?: string[],
): FlowVariable => ({ id, type, initial, scope, ...(values ? { values } : {}) });
const int = (value: number): DataSource => ({ kind: 'literal', type: { t: 'int' }, value });
const varRead = (id: string): DataSource => ({ kind: 'accessor', path: { on: 'var', id } });
const ex = (from: string, to: string, pin = 'exec', toPin = 'exec') => ({
	from: { node: from, pin },
	to: { node: to, pin: toPin },
});
const EMPTY: Graph = { nodes: [], exec: [], data: [] };
const doc = (graph: Graph, extra: Partial<FlowDoc> = {}): FlowDoc => ({
	version: 2,
	templateId: 'fixture',
	containers: [],
	graph,
	...extra,
});

const GAME = doc(EMPTY, {
	variables: [
		v('score', 'int', 0),
		v('moves', 'int', 20, 'round'),
		v('speed', 'float', 1.5),
		v('muted', 'bool', false),
		v('name', 'string', 'p1'),
		v('mood', 'enum', 'calm', 'game', ['calm', 'angry']),
	],
	modes: { bonus: { graph: EMPTY, variables: [v('picks', 'int', 3, 'mode')] } },
});

// ---- 1. the store ------------------------------------------------------------------------------

{
	const s = F.createFlowState(GAME);
	eq(
		'every variable starts at its initial',
		['score', 'moves', 'speed', 'muted', 'name', 'mood', 'picks'].map((id) => s.read(id)),
		[0, 20, 1.5, false, 'p1', 'calm', 3],
	);
	s.write('score', 7.9);
	s.write('score', 'ten');
	s.write('muted', 1);
	s.write('mood', 'sad');
	s.write('mood', 'angry');
	s.write('ghost', 1);
	eq(
		'an int truncates, a wrong kind is dropped, 1 is on, an enum keeps to its values',
		[s.read('score'), s.read('muted'), s.read('mood'), s.read('ghost')],
		[7, true, 'angry', undefined],
	);
	s.change('score', 'add', 5, {});
	s.change('score', 'sub', undefined, {});
	s.change('score', 'add', 100, { max: 50 });
	eq('add 5, subtract 1 (blank), clamp to max 50', s.read('score'), 50);
	s.change('moves', 'sub', 30, { min: 0 });
	eq('subtract past min clamps to 0', s.read('moves'), 0);
	s.change('muted', 'toggle', undefined, {});
	s.change('score', 'toggle', undefined, {});
	s.change('muted', 'add', 1, {});
	eq(
		'a toggle flips a bool; toggling a number, adding to a bool, do nothing',
		[s.read('muted'), s.read('score')],
		[false, 50],
	);
	s.write('picks', 0);
	s.flush();
	s.resetRound();
	eq(
		'resetRound restarts the round variables only',
		[s.read('moves'), s.read('score'), s.read('picks')],
		[20, 50, 0],
	);
	eq('…and the reset is a write the next flush carries', s.flush(), [
		{ id: 'moves', previous: 0, value: 20 },
	]);
	s.enterMode('other');
	eq('entering another mode resets nothing', s.read('picks'), 0);
	s.enterMode('bonus');
	eq('entering the mode restarts its own variables', s.read('picks'), 3);
	eq('game variables never reset', s.read('score'), 50);
}

// ---- 2. batching -------------------------------------------------------------------------------

{
	const s = F.createFlowState(GAME);
	const heard: unknown[] = [];
	const off = s.subscribe('score', (value) => heard.push(value));
	for (let i = 1; i <= 10; i++) s.change('score', 'add', 1, {});
	eq('a subscriber hears the current value at once', heard, [0]);
	const batch = s.flush();
	eq('ten writes reach it once, at the flush, with the latest value', heard, [0, 10]);
	eq(
		'the flush lists every write, in order',
		batch.map((w) => w.value),
		[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
	);
	s.write('score', 10);
	eq('a write that changes nothing is no write', s.pending(), false);
	off();
	s.write('score', 11);
	s.flush();
	eq('an unsubscribed listener hears nothing', heard, [0, 10]);
}

// ---- 3. onVariable thresholds ------------------------------------------------------------------

{
	const on = (
		id: string,
		variable: string,
		extra: Partial<{
			on: 'changed' | 'crosses';
			threshold: number;
			direction: 'up' | 'down' | 'either';
		}>,
	): Node => ({ id, kind: 'onVariable', pos: at, variable, ...extra });
	const graph: Graph = {
		nodes: [
			on('changed', 'lives', {}),
			on('gameOver', 'lives', { on: 'crosses', threshold: 0, direction: 'down' }),
			on('extra', 'lives', { on: 'crosses', threshold: 5, direction: 'up' }),
			on('either', 'lives', { on: 'crosses', threshold: 2 }),
		],
		exec: [],
		data: [],
	};
	const w = (previous: number, value: number) => ({ id: 'lives', previous, value });
	const fired = (batch: ReturnType<typeof w>[]) =>
		F.variableEntries(graph, batch).map(
			(r) => `${r.node} ${String(r.previous)}→${String(r.value)}`,
		);
	eq('lives 1 → 0: changed, game over (down through 0)', fired([w(1, 0)]), [
		'changed 1→0',
		'gameOver 1→0',
	]);
	eq('lives 3 → 1 → 3: no net change, but the 2 is crossed twice', fired([w(3, 1), w(1, 3)]), [
		'either 3→1',
		'either 1→3',
	]);
	eq('lives 4 → 5: up to the threshold counts', fired([w(4, 5)]), ['changed 4→5', 'extra 4→5']);
	eq('lives 6 → 5: down to 5 is not up', fired([w(6, 5)]), ['changed 6→5']);
	eq('lives 0 → 0 never arrives (no change, no write)', fired([]), []);

	const log: string[] = [];
	const lives = doc(
		{
			nodes: [
				on('over', 'lives', { on: 'crosses', threshold: 0, direction: 'down' }),
				{ id: 'beat', kind: 'action', pos: at, ref: 'beat' },
			],
			exec: [ex('over', 'beat')],
			data: [],
		},
		{
			variables: [v('lives', 'int', 1)],
			modes: {
				bonus: {
					graph: {
						nodes: [
							on('bonusOver', 'lives', { on: 'crosses', threshold: 0 }),
							{ id: 'b2', kind: 'action', pos: at, ref: 'winUpdate' },
						],
						exec: [ex('bonusOver', 'b2')],
						data: [],
					},
				},
			},
		},
	);
	let mode = 'basegame';
	const env: FlowV2Env = {
		effect: (name) => void log.push(name),
		broadcast: () => undefined,
		waitForTimeout: async () => undefined,
		timeScale: () => 1,
		showContainer: () => undefined,
		hideContainer: () => undefined,
		engineRead: () => undefined,
	};
	const ctx: RunContext = { vocab: VOCAB, library: LIBRARY, env, activeMode: () => mode };
	await F.runFlowStateEntry(lives, ctx, { kind: 'variables', batch: [w(1, 0)] });
	mode = 'bonus';
	await F.runFlowStateEntry(lives, ctx, { kind: 'variables', batch: [w(1, 0)] });
	eq('the global graph runs at base; the mode graph runs while its mode is on screen', log, [
		'beat',
		'winUpdate',
	]);
	// One batch carrying a variable only the global graph watches and one the mode's graph watches:
	// each runs where it is watched, so a mode's On variable never hides the global game over.
	log.length = 0;
	const mixed = doc(
		{
			nodes: [
				on('over', 'lives', { on: 'crosses', threshold: 0, direction: 'down' }),
				{ id: 'beat', kind: 'action', pos: at, ref: 'beat' },
			],
			exec: [ex('over', 'beat')],
			data: [],
		},
		{
			variables: [v('lives', 'int', 1), v('combo', 'int', 0)],
			modes: {
				bonus: {
					graph: {
						nodes: [
							on('comboUp', 'combo', {}),
							{ id: 'b2', kind: 'action', pos: at, ref: 'winUpdate' },
						],
						exec: [ex('comboUp', 'b2')],
						data: [],
					},
				},
			},
		},
	);
	mode = 'bonus';
	await F.runFlowStateEntry(mixed, ctx, {
		kind: 'variables',
		batch: [w(1, 0), { id: 'combo', previous: 0, value: 1 }],
	});
	eq("a mixed batch runs the mode's entry and the global game over", log.sort(), [
		'beat',
		'winUpdate',
	]);
}

// ---- 4. the interpreter ------------------------------------------------------------------------

{
	const chain = doc(
		{
			nodes: [
				{ id: 'go', kind: 'event', pos: at, ref: 'go' },
				{ id: 'set', kind: 'setVariable', pos: at, variable: 'score', inputs: { value: int(40) } },
				{
					id: 'add',
					kind: 'changeVariable',
					pos: at,
					variable: 'score',
					op: 'add',
					inputs: { by: int(5) },
				},
				{
					id: 'big',
					kind: 'branch',
					pos: at,
					guard: { all: [{ left: varRead('score'), op: 'gte', right: int(45) }] },
				},
				{ id: 'yes', kind: 'action', pos: at, ref: 'beat' },
			],
			exec: [ex('go', 'set'), ex('set', 'add'), ex('add', 'big'), ex('big', 'yes', 'then')],
			data: [],
		},
		{ variables: [v('score', 'int', 0)] },
	);
	const log: string[] = [];
	const state = F.createFlowState(chain);
	const base: FlowV2Env = {
		effect: (name) => void log.push(name),
		broadcast: () => undefined,
		waitForTimeout: async () => undefined,
		timeScale: () => 1,
		showContainer: () => undefined,
		hideContainer: () => undefined,
		engineRead: () => undefined,
	};
	await F.runFlowEvent(
		chain,
		{ vocab: VOCAB, library: LIBRARY, env: { ...base, state } },
		'go',
		{},
	);
	eq('Set then Change write through the store, at the node', state.read('score'), 45);
	eq('a $var read sees the write before it (the branch takes then)', log, ['beat']);
	log.length = 0;
	await F.runFlowEvent(chain, { vocab: VOCAB, library: LIBRARY, env: base }, 'go', {});
	eq('an env with no store: the nodes no-op and $var reads undefined', log, []);
}

// ---- 5. validation -----------------------------------------------------------------------------

{
	const issues = (d: FlowDoc, outcome?: 'rgs' | 'rules') =>
		F.validateFlowDoc(d, VOCAB, LIBRARY, undefined, undefined, undefined, undefined, outcome)
			.map(
				(i) =>
					`${i.code}${i.mode ? `[${i.mode}]` : ''} ${i.at.on === 'variable' ? i.at.variable : i.at.on === 'node' || i.at.on === 'pin' ? i.at.node : ''}`,
			)
			.sort();
	eq(
		'declarations: a bad initial, an empty enum, a duplicate, a misplaced scope, a money name',
		issues(
			doc(EMPTY, {
				variables: [
					v('lives', 'int', 1.5),
					v('mood', 'enum', '', 'game', []),
					v('a', 'int', 0),
					v('a', 'float', 0),
					v('b', 'int', 0, 'mode'),
					v('balance', 'float', 0),
				],
				modes: { bonus: { graph: EMPTY, variables: [v('c', 'int', 0, 'round')] } },
			}),
		),
		[
			'variable-duplicate a',
			'variable-scope b',
			'variable-scope[bonus] c',
			'variable-shadows-money balance',
			'variable-type lives',
			'variable-type mood',
		],
	);
	eq(
		'a money name is only refused in an RGS game',
		issues(doc(EMPTY, { variables: [v('win', 'float', 0)] }), 'rules'),
		[],
	);
	const owned = (
		id: string,
		type: FlowVariable['type'],
		initial: FlowVariable['initial'],
		server: string,
		scope: FlowVariable['scope'] = 'game',
	): FlowVariable => ({ ...v(id, type, initial, scope), server });
	eq(
		'server-owned declarations: an unknown room value, the wrong kind, a reset scope',
		issues(
			doc(EMPTY, {
				variables: [
					owned('score', 'int', 0, 'score'),
					owned('left', 'float', 0, 'secondsLeft'),
					{
						...owned('phase', 'enum', 'waiting', 'phase'),
						values: ['waiting', 'running', 'ended'],
					},
					owned('won', 'bool', false, 'won'),
					owned('lives', 'int', 3, 'lives'),
					owned('proto', 'int', 0, 'toString'),
					owned('who', 'int', 0, 'winner'),
					owned('round', 'int', 0, 'round', 'round'),
				],
			}),
			'rules',
		),
		[
			'variable-server-owned lives',
			'variable-server-owned proto',
			'variable-server-owned round',
			'variable-type who',
		],
	);
	eq(
		'variable-server-owned: Flow may read a room value, never Set or Change it',
		issues(
			doc(
				{
					nodes: [
						{ id: 'go', kind: 'event', pos: at, ref: 'go' },
						{
							id: 'set',
							kind: 'setVariable',
							pos: at,
							variable: 'score',
							inputs: { value: int(1) },
						},
						{ id: 'add', kind: 'changeVariable', pos: at, variable: 'score', op: 'add' },
						{ id: 'mine', kind: 'changeVariable', pos: at, variable: 'mine', op: 'add' },
						{
							id: 'big',
							kind: 'branch',
							pos: at,
							guard: { all: [{ left: varRead('score'), op: 'gt', right: int(5) }] },
						},
						{ id: 'watch', kind: 'onVariable', pos: at, variable: 'score', on: 'changed' },
					],
					exec: [ex('go', 'set'), ex('set', 'add'), ex('add', 'mine'), ex('mine', 'big')],
					data: [],
				},
				{ variables: [owned('score', 'int', 0, 'score'), v('mine', 'int', 0)] },
			),
			'rules',
		),
		['variable-server-owned add', 'variable-server-owned set'],
	);
	eq(
		'the room values a variable may mirror are the ones the room gives (engine-mechanics)',
		F.SERVER_VARIABLE_SOURCES,
		M.SERVER_VALUE_KINDS,
	);
	eq(
		'the online events the arcade vocabulary declares are the ones the room raises',
		[...F.ARCADE_ONLINE_EVENTS].sort(),
		Object.values(M.ONLINE_FLOW_EVENTS).sort(),
	);
	eq(
		'…and each is an arcade event',
		F.ARCADE_ONLINE_EVENTS.filter((name) => !F.ARCADE_VOCAB.events.some((e) => e.name === name)),
		[],
	);
	const river = salmonsRiver();
	const salmons = salmonsReferenceLayout(river);
	eq(
		"Salmons' flow validates clean on its layout, its HUD reading only room values",
		[
			F.validateFlowDoc(
				SALMONS_SEED_DOC,
				F.ARCADE_VOCAB,
				LIBRARY,
				undefined,
				undefined,
				salmons.scenes.map((scene) => scene.id),
				undefined,
				'rules',
			)
				.filter((i) => i.severity === 'error')
				.map((i) => i.code),
			F.serverVariablesOf(SALMONS_SEED_DOC),
		],
		[
			[],
			[
				{ id: 'score', server: 'score' },
				{ id: 'round', server: 'round' },
				{ id: 'secondsLeft', server: 'secondsLeft' },
			],
		],
	);
	const nodes = doc(
		{
			nodes: [
				{ id: 'go', kind: 'event', pos: at, ref: 'go' },
				{ id: 'ghost', kind: 'setVariable', pos: at, variable: 'nope', inputs: { value: int(1) } },
				{ id: 'tog', kind: 'changeVariable', pos: at, variable: 'score', op: 'toggle' },
				{ id: 'addBool', kind: 'changeVariable', pos: at, variable: 'muted', op: 'add' },
				{
					id: 'cross',
					kind: 'onVariable',
					pos: at,
					variable: 'muted',
					on: 'crosses',
					threshold: 1,
				},
				{ id: 'noThreshold', kind: 'onVariable', pos: at, variable: 'score', on: 'crosses' },
				{
					id: 'badEnum',
					kind: 'setVariable',
					pos: at,
					variable: 'mood',
					inputs: { value: { kind: 'literal', type: { t: 'string' }, value: 'sad' } },
				},
				{
					id: 'wrongType',
					kind: 'setVariable',
					pos: at,
					variable: 'score',
					inputs: { value: varRead('muted') },
				},
				{ id: 'leak', kind: 'setVariable', pos: at, variable: 'picks', inputs: { value: int(1) } },
				{
					id: 'pay',
					kind: 'action',
					pos: at,
					ref: 'winUpdate',
					inputs: { amount: varRead('speed') },
				},
			],
			exec: [
				ex('go', 'ghost'),
				ex('ghost', 'tog'),
				ex('tog', 'addBool'),
				ex('addBool', 'badEnum'),
				ex('badEnum', 'wrongType'),
				ex('wrongType', 'leak'),
				ex('leak', 'pay'),
			],
			data: [],
		},
		{
			variables: [
				v('score', 'int', 0),
				v('muted', 'bool', false),
				v('speed', 'float', 1),
				v('mood', 'enum', 'calm', 'game', ['calm']),
			],
			modes: { bonus: { graph: EMPTY, variables: [v('picks', 'int', 3, 'mode')] } },
		},
	);
	eq('node checks', issues(nodes), [
		'type-mismatch wrongType',
		'variable-scope leak',
		'variable-shadows-money pay',
		'variable-type addBool',
		'variable-type badEnum',
		'variable-type cross',
		'variable-type noThreshold',
		'variable-type tog',
		'variable-unknown ghost',
	]);
	eq(
		'a mode variable used in its own section is fine',
		issues(
			doc(EMPTY, {
				modes: {
					bonus: {
						graph: {
							nodes: [
								{
									id: 's',
									kind: 'setVariable',
									pos: at,
									variable: 'picks',
									inputs: { value: int(1) },
								},
							],
							exec: [],
							data: [],
						},
						variables: [v('picks', 'int', 3, 'mode')],
					},
				},
			}),
		),
		[],
	);
	eq(
		'a variable fed to a money param through a compute is refused too; not in a rules game',
		[true, false].map(
			(rgs) =>
				issues(
					doc(
						{
							nodes: [
								{ id: 'go', kind: 'event', pos: at, ref: 'go' },
								{
									id: 'c',
									kind: 'compute',
									pos: at,
									compute: { op: 'mul', a: varRead('speed'), b: int(2) },
								},
								{
									id: 'pay',
									kind: 'action',
									pos: at,
									ref: 'winUpdate',
									inputs: { amount: { kind: 'wire' } },
								},
							],
							exec: [ex('go', 'pay')],
							data: [{ from: { node: 'c', pin: 'out' }, to: { node: 'pay', pin: 'amount' } }],
						},
						{ variables: [v('speed', 'float', 1)] },
					),
					rgs ? 'rgs' : 'rules',
				).filter((i) => i.startsWith('variable-shadows-money')).length,
		),
		[1, 0],
	);
	const NEW_CODES = [
		'variable-unknown',
		'variable-type',
		'variable-scope',
		'variable-duplicate',
		'variable-shadows-money',
		'variable-server-owned',
		'tick-async',
		'tick-fast',
		'input-unknown',
	];
	eq(
		'no committed seed flow gains a P10.3 issue',
		Object.entries(F.DRIVEN_SEEDS).flatMap(([id, seed]) =>
			F.validateFlowDoc(seed, F.templateVocabulary(seed.templateId), F.BOOK_OF_DRIVEN_SEED_LIBRARY)
				.filter((i) => NEW_CODES.includes(i.code))
				.map((i) => `${id}: ${i.code}`),
		),
		[],
	);
}

// ---- 6. var: bindings --------------------------------------------------------------------------

{
	const s = F.createFlowState(GAME);
	const sources = F.variableValueSources(s, F.docVariables(GAME));
	eq('one source per variable, named var:<id>', Object.keys(sources), [
		'var:score',
		'var:moves',
		'var:speed',
		'var:muted',
		'var:name',
		'var:mood',
		'var:picks',
	]);
	const heard: Record<string, unknown[]> = {};
	for (const name of ['var:score', 'var:muted', 'var:name']) {
		heard[name] = [];
		sources[name].subscribe((value) => heard[name].push(value));
	}
	s.change('score', 'add', 3, {});
	s.change('score', 'add', 3, {});
	s.write('muted', true);
	s.write('name', 'p2');
	s.flush();
	eq('numbers and strings as they are, a bool as 1 / 0, once per flush', heard, {
		'var:score': [0, 6],
		'var:muted': [0, 1],
		'var:name': ['p1', 'p2'],
	});
	eq(
		'a bool input reads 1 / 0 as on / off',
		[coerceInstanceInput('bool', 1), coerceInstanceInput('bool', 0)],
		[true, false],
	);
	eq(
		'variableOfSource reads the id back; anything else is not one',
		[F.variableOfSource('var:score'), F.variableOfSource('balance'), F.variableOfSource('var:')],
		['score', undefined, undefined],
	);
}

// ---- 7. source widened to bool / text ----------------------------------------------------------

{
	const def = normalizeComponent({
		id: 'readout',
		name: 'Readout',
		root: { id: 'root', type: 'container', children: [] },
		inputs: [
			{ id: 'amount', kind: 'number', source: 'balance' },
			{ id: 'lit', kind: 'bool', source: 'var:muted' },
			{ id: 'caption', kind: 'text', source: 'var:name' },
			{ id: 'pop', kind: 'trigger', source: 'var:score' },
			{ id: 'blank', kind: 'bool', source: '' },
		],
	} as unknown as Parameters<typeof normalizeComponent>[0]);
	eq(
		'the normalizer keeps source on bool / number / text, never on a trigger or blank',
		def?.inputs?.map((i) => [i.id, i.source ?? null]),
		[
			['amount', 'balance'],
			['lit', 'var:muted'],
			['caption', 'var:name'],
			['pop', null],
			['blank', null],
		],
	);
	const draft = {
		id: 'd',
		root: { id: 'root', type: 'container', children: [] },
		inputs: [
			{ id: 'n', kind: 'number' },
			{ id: 'b', kind: 'bool' },
			{ id: 't', kind: 'text' },
			{ id: 'g', kind: 'trigger' },
		],
	} as unknown as Parameters<typeof setInputSource>[0];
	for (const id of ['n', 'b', 't', 'g']) setInputSource(draft, id, ' var:x ');
	eq(
		'the Component Editor setter writes it on bool / number / text, not a trigger',
		(draft.inputs ?? []).map((i) => i.source ?? null),
		['var:x', 'var:x', 'var:x', null],
	);
	const instance = source('packages/engine-layout/src/lib/ComponentInstance.svelte');
	eq(
		'<ComponentInstance> subscribes a bool / number / text input with a source',
		[
			"if (input.kind === 'trigger' || fixedInputs?.[input.id] !== undefined) continue;",
			"(input.kind === 'number' ? passed?.[input.id] : undefined) ??",
			"if (input.kind === 'bool') stateMachineRunner?.setInput(input.id, coerced as boolean);",
			'else flowInstance?.handle.setInput(input.id, coerced);',
		].map((l) => instance.includes(l)),
		[true, true, true, true],
	);
	const properties = source('apps/launcher-api/src/routes/(app)/editor/EditorProperties.svelte');
	eq(
		'the input row suggests the flow variables of its kind as var:<id>',
		[
			'<option value={`var:${v.id}`}>{v.id} ({v.type})</option>',
			"number: ['int', 'float'],",
			"text: ['string', 'enum'],",
		].map((l) => properties.includes(l)),
		[true, true, true],
	);
	const runtime = source('apps/lines/src/game/flowV2Runtime.svelte.ts');
	eq(
		'the game registers the variables as value sources',
		runtime.includes('registerComponentValues(variableValueSources(state, docVariables(doc)))'),
		true,
	);
}

// ---- 8. renaming a variable in /flow-v2 ---------------------------------------------------------

{
	const { renameVariable } = await import('../src/routes/(app)/flow-v2/graphOps.ts');
	const before = doc(
		{
			nodes: [
				{
					id: 'set',
					kind: 'setVariable',
					pos: at,
					variable: 'score',
					inputs: { value: varRead('score') },
				},
				{
					id: 'if',
					kind: 'branch',
					pos: at,
					guard: { any: [{ left: varRead('score'), op: 'gt', right: int(1) }] },
				},
				{
					id: 'c',
					kind: 'compute',
					pos: at,
					compute: { op: 'add', a: varRead('score'), b: varRead('other') },
				},
				{
					id: 'g',
					kind: 'group',
					pos: at,
					label: 'g',
					boundary: [],
					body: {
						nodes: [{ id: 'inner', kind: 'onVariable', pos: at, variable: 'score' }],
						exec: [],
						data: [],
					},
				},
			],
			exec: [],
			data: [],
		},
		{
			variables: [v('score', 'int', 0), v('other', 'int', 0)],
			modes: {
				bonus: {
					graph: {
						nodes: [{ id: 'm', kind: 'changeVariable', pos: at, variable: 'score', op: 'add' }],
						exec: [],
						data: [],
					},
				},
			},
		},
	);
	const after = renameVariable(before, 'score', 'points');
	const text = JSON.stringify(after);
	eq(
		'a rename leaves no "score" behind and touches nothing else',
		[text.includes('"score"'), text.includes('"other"')],
		[false, true],
	);
	eq(
		'…and the renamed doc validates with no variable issue',
		F.validateFlowDoc(after, VOCAB, LIBRARY)
			.filter((i) => i.code.startsWith('variable-'))
			.map((i) => i.code),
		[],
	);
}

if (failures > 0) {
	console.error(`\nflow variables: ${failures} failed, ${passes} passed`);
	process.exit(1);
}
console.log(`flow variables: all ${passes} checks passed`);
