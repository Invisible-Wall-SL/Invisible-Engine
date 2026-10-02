/**
 * Guard SCOPED SIGNALS — Hold and Win Phase 12a (`docs/design/hold-and-win.md` §8), offline.
 *
 * Run: `pnpm --filter launcher-api run check:signal-scope`
 *
 * WHY. A frog authored once inside the Pot component must celebrate on the pot that activated, and
 * only that one. That promise crosses six seams, and a break in any of them is silent: the frog
 * either never plays or plays on all three pots, and nothing in a build or the editor says so.
 *
 *  1. **The rule** (`utils-event-emitter`): what a value scopes by, what an event carries, who hears.
 *  2. **Catalog ↔ registry.** Every feature signal the editor offers is one the game registers, and
 *     back — an offered name nobody fires authors a dead cue; a fired name nobody offers is
 *     unauthorable. A signal the catalog calls scoped rides an emitter event that carries `scope`.
 *  3. **The registry fires right** — each feature signal on its beat (and only there), with the
 *     beat's scope: a consume scopes to every pot it drained, a meter flight to its meter.
 *  4. **Instances and effects filter** — the builtins scope by the right param, the scoped jackpot
 *     tile hears its tier (whatever case the platform names it in), effects inherit the scope.
 *  5. **Flow** — every Fire Cue has an optional scope pin; a set one rides the payload, an unset one
 *     leaves the payload exactly as before.
 *  6. **What saves** — the component's `signalScope` survives the launcher's normalizer while its
 *     param exists, and an FX trigger's scope survives the effect normalizer.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	clearComponentSignals,
	emitComponentSignal,
	ENGINE_SIGNAL_CATALOG,
	engineSignalsForKind,
	getComponentSignal,
	JACKPOT_BAR_DEF,
	JACKPOT_TILE_DEF,
	POT_METER_DEF,
	registerComponentSignals,
	RESPIN_COUNTER_DEF,
	type ComponentDef,
} from 'engine-layout';
import {
	CUE_SCOPE_PIN,
	derivePins,
	HOLD_AND_WIN_VOCAB,
	runFlowEvent,
	validateFlowDoc,
	type FlowDoc,
	type FlowV2Env,
} from 'engine-flow-v2';
import { layerTrigger, normalizeEffectDoc, type EmitterLayer } from 'engine-fx';

import {
	createEventEmitter,
	eventScope,
	scopeKey,
	scopeMatches,
	type EmitterEventBase,
	type EventScope,
} from '../../../packages/utils-event-emitter/index.ts';
import { featureComponentSignals } from '../../lines/src/game/featureSignals.ts';
import { LINES_EMITTER_VOCABULARY } from '../../lines/src/game/emitterVocabulary.ts';
import { normalizeComponent } from '../src/lib/server/componentStorage.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

let fails = 0;
const check = (name: string, ok: boolean): void => {
	if (!ok) {
		fails++;
		console.error('FAIL:', name);
	}
};
const eq = (name: string, actual: unknown, expected: unknown): void =>
	check(
		`${name} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
		JSON.stringify(actual) === JSON.stringify(expected),
	);

type FeatureEmitter = Parameters<typeof featureComponentSignals>[0];

// --- 1. the rule ---
eq('a meter id scopes as itself', scopeKey('red'), 'red');
eq('…trimmed and lower-cased', scopeKey('  Red '), 'red');
eq('a dotted source scopes by its last part', scopeKey('jackpot.grand'), 'grand');
eq('…the platform one too', scopeKey('platformJackpot.GRAND'), 'grand');
eq('a reel index scopes as its digits', scopeKey(2), '2');
eq('blank ⇒ no scope', scopeKey('  '), undefined);
eq('not a number ⇒ no scope', scopeKey(Number.NaN), undefined);
eq('an object ⇒ no scope', scopeKey({ id: 'red' }), undefined);
eq('an event carries its `scope`', eventScope({ type: 'potFull', scope: 'Red' }), 'red');
eq('…a list, blanks dropped', eventScope({ type: 'x', scope: ['red', ' ', 3] }), ['red', '3']);
eq('…an empty list is none', eventScope({ type: 'x', scope: [] }), undefined);
eq('…no field is none', eventScope({ type: 'x', meter: 'red' }), undefined);
check('an unscoped listener hears a scoped fire', scopeMatches(undefined, 'red'));
check('a scoped listener hears an unscoped fire', scopeMatches('red', undefined));
check('a scoped listener hears its own', scopeMatches('red', 'red'));
check('…not another', !scopeMatches('red', 'blue'));
check('…its own among several', scopeMatches('red', ['blue', 'red']));
check('…not when it is not among them', !scopeMatches('green', ['blue', 'red']));

// --- 2. catalog ↔ registry ---
const spyTypes = new Map<string, string[]>();
let subscribing = '';
const spy = {
	subscribe(handlers: Record<string, unknown>) {
		spyTypes.set(subscribing, [...(spyTypes.get(subscribing) ?? []), ...Object.keys(handlers)]);
		return () => true;
	},
} as unknown as FeatureEmitter;
const registered = featureComponentSignals(spy);
for (const [name, source] of Object.entries(registered)) {
	subscribing = name;
	source.subscribe(() => {});
}
const featureCatalog = ENGINE_SIGNAL_CATALOG.filter(
	(s) => s.capability === 'holdAndWin' || s.key === 'platformJackpotWin',
);
eq(
	'the catalog offers exactly the feature signals the game registers',
	featureCatalog.map((s) => s.key).sort(),
	Object.keys(registered).sort(),
);
const emitterFields = new Map(
	LINES_EMITTER_VOCABULARY.events.map((e) => [e.type, (e.fields ?? []).map((f) => f.key)]),
);
for (const entry of featureCatalog) {
	const types = spyTypes.get(entry.key) ?? [];
	check(`${entry.key} rides exactly one emitter event (${types})`, types.length === 1);
	check(`${entry.key}'s event is a real emitter event`, emitterFields.has(types[0]));
	if (entry.scope) {
		check(
			`${entry.key} is scoped by ${entry.scope}, so its event ${types[0]} carries \`scope\``,
			(emitterFields.get(types[0]) ?? []).includes('scope'),
		);
	}
}
check(
	'a Hold and Win project is offered the pot signals',
	engineSignalsForKind('holdAndWin').some((s) => s.key === 'potActivate'),
);
check(
	'a Book-of project is not',
	!engineSignalsForKind('bookOf').some((s) => s.capability === 'holdAndWin'),
);
check(
	'…but keeps the core signals and the platform jackpot (any kind)',
	['win', 'enter', 'platformJackpotWin'].every((key) =>
		engineSignalsForKind('bookOf').some((s) => s.key === key),
	),
);
check(
	'the game registers the feature signals',
	/\.\.\.featureComponentSignals\(context\.eventEmitter\)/.test(
		read('apps/lines/src/components/Game.svelte'),
	),
);

// --- 3. the registry fires right ---
const { eventEmitter } = createEventEmitter<EmitterEventBase & Record<string, unknown>>();
const live = featureComponentSignals(eventEmitter as unknown as FeatureEmitter);
const fired: { signal: string; scope: EventScope | undefined }[] = [];
const unsubs = Object.entries(live).map(([signal, source]) =>
	source.subscribe((scope) => fired.push({ signal, scope })),
);
const fire = (event: EmitterEventBase & Record<string, unknown>) => {
	fired.length = 0;
	eventEmitter.broadcast(event);
	return [...fired];
};
eq(
	'a consume activates every pot it drained',
	fire({ type: 'potsConsume', meters: ['red', 'blue'], activates: [], scope: ['red', 'blue'] }),
	[{ signal: 'potActivate', scope: ['red', 'blue'] }],
);
eq(
	'a special landing in a meter is that pot’s potLand',
	fire({
		type: 'flightArrive',
		flight: 'toMeter:red',
		target: 'meter:red',
		index: 0,
		scope: 'red',
	}),
	[{ signal: 'potLand', scope: 'red' }],
);
eq(
	'a coin landing in the Total Win bar is no potLand',
	fire({ type: 'flightArrive', flight: 'toTotal', target: 'total', index: 0 }),
	[],
);
eq(
	'a counter reset is respinReset, not respinLast',
	fire({ type: 'respinCounterUpdate', left: 1, start: 1, reset: true }),
	[{ signal: 'respinReset', scope: undefined }],
);
eq(
	'the last respin is respinLast',
	fire({ type: 'respinCounterUpdate', left: 1, start: 3, reset: false }),
	[{ signal: 'respinLast', scope: undefined }],
);
eq(
	'any other count is neither',
	fire({ type: 'respinCounterUpdate', left: 2, start: 3, reset: false }),
	[],
);
eq(
	'a column whose letter was already lit lights nothing',
	fire({ type: 'respinColumnComplete', reel: 2, newlyLit: false, scope: '2' }),
	[],
);
eq(
	'a newly lit letter is its reel’s letterLit',
	fire({ type: 'respinColumnComplete', reel: 2, newlyLit: true, scope: '2' }),
	[{ signal: 'letterLit', scope: '2' }],
);
eq(
	'the platform’s jackpot scopes by its tier, whatever its case',
	fire({ type: 'platformJackpotCelebration', tier: 'Grand', amount: 5, scope: 'Grand' }),
	[{ signal: 'platformJackpotWin', scope: 'grand' }],
);
eq(
	'a level up is scoped by its meter',
	fire({ type: 'potLevelUp', meter: 'blue', level: 4, max: 12, scope: 'blue' }),
	[{ signal: 'potLevelUp', scope: 'blue' }],
);
for (const unsub of unsubs) unsub();

registerComponentSignals(live);
const heard: (EventScope | undefined)[] = [];
const off = getComponentSignal('potFull').subscribe((scope) => heard.push(scope));
eventEmitter.broadcast({ type: 'potFull', meter: 'green', scope: 'green' });
off();
eq('a registered signal reaches a component with its scope', heard, ['green']);
const cheered: (EventScope | undefined)[] = [];
const offCue = getComponentSignal('frogCheer').subscribe((scope) => cheered.push(scope));
emitComponentSignal('frogCheer', 'red');
emitComponentSignal('frogCheer');
offCue();
eq('a Flow cue on the open bus carries its scope pin, or none', cheered, ['red', undefined]);
clearComponentSignals();

// --- 4. instances and effects ---
const paramDefault = (def: ComponentDef, key: string): unknown =>
	def.params?.find((p) => p.key === key)?.default;
eq('the Pot scopes by its meter', POT_METER_DEF.signalScope, 'meter');
check(
	'…a param it declares',
	(POT_METER_DEF.params ?? []).some((p) => p.key === POT_METER_DEF.signalScope),
);
eq('the jackpot tile scopes by its source', JACKPOT_TILE_DEF.signalScope, 'source');
eq(
	'…so a default tile hears the GRAND tier',
	scopeKey(paramDefault(JACKPOT_TILE_DEF, 'source')),
	'grand',
);
eq(
	'…and each tile of the bar its own',
	JACKPOT_BAR_DEF.root.children.map((tile) =>
		tile.kind === 'componentInstance' ? scopeKey(tile.params?.source) : undefined,
	),
	['mini', 'minor', 'major', 'grand'],
);
check(
	'the respin counter shares the panel but hears every fire',
	RESPIN_COUNTER_DEF.signalScope === undefined,
);
const instance = read('packages/engine-layout/src/lib/ComponentInstance.svelte');
check(
	'a cue and a gate both filter by the instance scope',
	(instance.match(/hears\(scope\)/g) ?? []).length === 2,
);
check(
	'a nested instance inherits the scope it is placed in',
	/def\?\.signalScope[\s\S]{0,120}\?\?\s*getComponentSignalScope\(\)/.test(instance),
);
check(
	'every effect node passes its instance scope',
	(
		read('packages/engine-layout/src/lib/LayoutNodeView.svelte').match(/scope=\{signalScope\}/g) ??
		[]
	).length === 2,
);

// --- 5. Flow ---
const cuePins = (ref: string) =>
	derivePins(
		{ id: 'c', kind: 'fireCue', pos: { x: 0, y: 0 }, ref },
		{ vocab: HOLD_AND_WIN_VOCAB, library: { version: 2, functions: [] } },
	).filter((pin) => pin.id === CUE_SCOPE_PIN);
eq(
	'a Fire Cue has one optional scope pin',
	cuePins('potFull').map((p) => [p.optional, p.dir]),
	[[true, 'in']],
);
check(
	'…the new pot cues are in the vocabulary',
	['potLevelUp', 'potStageUp'].every((name) =>
		HOLD_AND_WIN_VOCAB.cues.some((cue) => cue.name === name),
	),
);
const literal = (value: string) => ({
	kind: 'literal' as const,
	type: { t: 'string' as const },
	value,
});
const flow: FlowDoc = {
	version: 2,
	templateId: 'holdAndWin',
	graph: {
		nodes: [
			{ id: 'on', kind: 'event', pos: { x: 0, y: 0 }, ref: 'luckySpin' },
			{
				id: 'red',
				kind: 'fireCue',
				pos: { x: 200, y: 0 },
				ref: 'potFull',
				inputs: { meter: literal('red'), scope: literal('red') },
			},
			{
				id: 'any',
				kind: 'fireCue',
				pos: { x: 400, y: 0 },
				ref: 'potFull',
				inputs: { meter: literal('blue') },
			},
		],
		exec: [
			{ from: { node: 'on', pin: 'exec' }, to: { node: 'red', pin: 'exec' } },
			{ from: { node: 'red', pin: 'exec' }, to: { node: 'any', pin: 'exec' } },
		],
		data: [],
	},
	containers: [],
};
const broadcasts: Record<string, unknown>[] = [];
const env = {
	effect: async () => {},
	broadcast: async (_cue: string, payload: Record<string, unknown>) => {
		broadcasts.push(payload);
	},
	waitForTimeout: async () => {},
	timeScale: () => 1,
	showContainer: () => {},
	hideContainer: () => {},
	engineRead: () => undefined,
} as unknown as FlowV2Env;
await runFlowEvent(
	flow,
	{ vocab: HOLD_AND_WIN_VOCAB, library: { version: 2, functions: [] }, env },
	'luckySpin',
	{},
);
eq('a set scope pin rides the payload; an unset one adds nothing', broadcasts, [
	{ meter: 'red', scope: 'red' },
	{ meter: 'blue' },
]);
check(
	'an unwired scope pin is never a validation error',
	!validateFlowDoc(flow, HOLD_AND_WIN_VOCAB, { version: 2, functions: [] }).some(
		(issue) => issue.severity === 'error' && issue.message.includes(CUE_SCOPE_PIN),
	),
);
check(
	'the game forwards a cue’s scope to the component bus',
	/emitComponentSignal\(cue,\s*eventScope\(payload\)\)/.test(
		read('apps/lines/src/game/flowV2Runtime.svelte.ts'),
	),
);

// --- 6. what saves ---
const saved = (signalScope: string): ComponentDef =>
	normalizeComponent({
		id: 'myPot',
		name: 'My Pot',
		version: 1,
		scope: 'project',
		category: 'ui',
		root: { id: 'root', kind: 'container', x: 0, y: 0, children: [] },
		params: [{ key: 'meter', kind: 'string', default: 'red', author: true }],
		signalScope,
	} as ComponentDef);
eq('a def keeps the param its scope comes from', saved('meter').signalScope, 'meter');
eq('…and drops a scope whose param is gone', saved('nope').signalScope, undefined);
const effect = normalizeEffectDoc({
	version: 1,
	id: 'sparks',
	name: 'Sparks',
	layers: [
		{
			key: 'burst',
			config: {},
			art: { assetKey: '', frames: [] },
			placement: { space: 'free' },
			particleKind: 'sprite',
			trigger: { on: 'event', eventType: 'potFull', scope: ' red ' },
		},
		{
			key: 'ambient',
			config: {},
			art: { assetKey: '', frames: [] },
			placement: { space: 'free' },
			particleKind: 'sprite',
			trigger: { on: 'always', scope: 'red' },
		},
	],
});
eq('an event trigger keeps its scope', effect.layers[0]?.trigger?.scope, 'red');
eq('…an ambient one has none to keep', effect.layers[1]?.trigger?.scope, undefined);
eq(
	'the player plan carries it to the layer',
	layerTrigger(effect.layers[0] as EmitterLayer).scope,
	'red',
);
check(
	'…and an unscoped trigger plans exactly as before',
	!('scope' in layerTrigger({ ...(effect.layers[0] as EmitterLayer), trigger: { on: 'event' } })),
);

if (fails > 0) {
	console.error(`\n${fails} check(s) failed.`);
	process.exit(1);
}
console.log('signal scope: all checks passed');
