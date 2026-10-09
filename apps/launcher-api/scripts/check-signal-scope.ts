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
 *     The pot family is gated on `pots`, so the pots overlay add-on offers it to any kind
 *     (`docs/design/pots-overlay.md` §4) without the rest of the Hold and Win families.
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
	SIGNAL_SCOPE_KINDS,
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
	ANY_SCOPE,
	createEventEmitter,
	eventScope,
	scopeKey,
	scopeMatches,
	scopeOf,
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
eq('a value-source key scopes by its id', scopeKey('jackpot.grand'), 'grand');
eq('…the platform one too', scopeKey('platformJackpot.GRAND'), 'grand');
eq('…and a pot field by its meter, not the field', scopeKey('meter.red.level'), 'red');
eq('a part of a kind', scopeOf('Meter', 'Red'), 'meter:red');
eq('…no kind ⇒ the bare key', scopeOf(undefined, 'red'), 'red');
eq('…no value ⇒ none', scopeOf('meter', ''), undefined);
eq('a reel index scopes as its digits', scopeKey(2), '2');
eq('blank ⇒ no scope', scopeKey('  '), undefined);
eq('not a number ⇒ no scope', scopeKey(Number.NaN), undefined);
eq('an object ⇒ no scope', scopeKey({ id: 'red' }), undefined);
eq(
	'an event carries its `scope`',
	eventScope({ type: 'potFull', scope: 'Meter:Red' }),
	'meter:red',
);
eq('…a list, blanks dropped', eventScope({ type: 'x', scope: ['red', ' ', 3] }), ['red', '3']);
eq('…an empty list is none', eventScope({ type: 'x', scope: [] }), undefined);
eq('…no field is none', eventScope({ type: 'x', meter: 'red' }), undefined);
check('an unscoped listener hears a scoped fire', scopeMatches(undefined, 'red'));
check('a scoped listener hears an unscoped fire', scopeMatches('red', undefined));
check('a scoped listener hears its own', scopeMatches('red', 'red'));
check('…not another', !scopeMatches('red', 'blue'));
check('…its own among several', scopeMatches('red', ['blue', 'red']));
check('…not when it is not among them', !scopeMatches('green', ['blue', 'red']));
check('the red pot skips the blue pot', !scopeMatches('meter:red', 'meter:blue'));
check('…but hears a jackpot tier, another kind of part', scopeMatches('meter:red', 'tier:grand'));
check('…and a consume that drained it', scopeMatches('meter:red', ['meter:blue', 'meter:red']));
check('a bare key matches any kind’s key', scopeMatches('red', 'meter:red'));
check('…and a kind matches a bare key', scopeMatches('meter:red', 'red'));
check('a listener normalises', scopeMatches('Meter:Red', 'meter:red'));
check('`*` hears every part', scopeMatches(ANY_SCOPE, 'meter:blue'));

// --- 2. catalog ↔ registry ---
const spyTypes = new Map<string, string[]>();
let subscribing = '';
const spy = {
	subscribe(handlers: Record<string, unknown>) {
		spyTypes.set(subscribing, [...(spyTypes.get(subscribing) ?? []), ...Object.keys(handlers)]);
		return () => true;
	},
} as unknown as FeatureEmitter;
const registered = featureComponentSignals(spy, true);
for (const [name, source] of Object.entries(registered)) {
	subscribing = name;
	source.subscribe(() => {});
}
const featureCatalog = ENGINE_SIGNAL_CATALOG.filter(
	(s) => s.capability === 'holdAndWin' || s.capability === 'pots' || s.key === 'platformJackpotWin',
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
	!engineSignalsForKind('bookOf').some((s) => s.capability !== undefined),
);
const POT_SIGNALS = ['potFill', 'potLand', 'potLevelUp', 'potStageUp', 'potFull', 'potActivate'];
eq(
	'the pot family, and only it, is gated on `pots`',
	ENGINE_SIGNAL_CATALOG.filter((s) => s.capability === 'pots').map((s) => s.key),
	POT_SIGNALS,
);
const keysOf = (entries: { key: string }[]): string[] => entries.map((s) => s.key);
const ungated = keysOf(ENGINE_SIGNAL_CATALOG.filter((s) => s.capability === undefined));
for (const kind of ['lines', 'ways', 'cluster', 'scatter', 'bookOf', 'myCustomKind', undefined]) {
	eq(
		`${kind} with no add-on is offered the ungated signals only`,
		keysOf(engineSignalsForKind(kind)),
		ungated,
	);
	eq(
		`${kind} with both add-ons off is too`,
		keysOf(engineSignalsForKind(kind, { holdAndWin: false, potsOverlay: false })),
		ungated,
	);
}
const everySignal = keysOf(ENGINE_SIGNAL_CATALOG);
eq(
	'the Hold and Win kind is offered every signal',
	keysOf(engineSignalsForKind('holdAndWin')),
	everySignal,
);
eq(
	'…with or without the overlay block',
	keysOf(engineSignalsForKind('holdAndWin', { potsOverlay: true })),
	everySignal,
);
eq(
	'a Book-of project with the pots overlay gains the pot family only',
	keysOf(engineSignalsForKind('bookOf', { potsOverlay: true })),
	keysOf(ENGINE_SIGNAL_CATALOG.filter((s) => s.capability !== 'holdAndWin')),
);
eq(
	'a Book-of project with a Hold and Win bonus gains every family and keeps its own',
	keysOf(engineSignalsForKind('bookOf', { holdAndWin: true })),
	everySignal,
);
check(
	'…but keeps the core signals and the platform jackpot (any kind)',
	['win', 'enter', 'platformJackpotWin'].every((key) =>
		engineSignalsForKind('bookOf').some((s) => s.key === key),
	),
);
eq(
	'any other kind registers only the platform jackpot, so a Hold and Win name stays an author cue',
	Object.keys(featureComponentSignals(spy, false)),
	['platformJackpotWin'],
);
eq(
	'a pots-overlay host with no Hold and Win block registers the pot family, and no other feature part',
	Object.keys(featureComponentSignals(spy, false, true)),
	[
		'platformJackpotWin',
		'potFill',
		'potLand',
		'potLevelUp',
		'potStageUp',
		'potFull',
		'potActivate',
	],
);
check(
	'the game registers the feature signals: the Hold and Win family by its respin modes, the pots by either',
	/\.\.\.featureComponentSignals\(\s*context\.eventEmitter,\s*respinModes\(\)\.length > 0,\s*respinModes\(\)\.length > 0 \|\| !!getActiveGameConfig\(\)\.coinOverlay\?\.drops,?\s*\)/.test(
		read('apps/lines/src/components/Game.svelte'),
	),
);

// --- 3. the registry fires right ---
const { eventEmitter } = createEventEmitter<EmitterEventBase & Record<string, unknown>>();
const live = featureComponentSignals(eventEmitter as unknown as FeatureEmitter, true);
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
	fire({
		type: 'potsConsume',
		meters: ['red', 'blue'],
		activates: [],
		scope: ['meter:red', 'meter:blue'],
	}),
	[{ signal: 'potActivate', scope: ['meter:red', 'meter:blue'] }],
);
eq(
	'a special landing in a meter is that pot’s potLand',
	fire({
		type: 'flightArrive',
		flight: 'toMeter:red',
		target: 'meter:red',
		index: 0,
		scope: 'meter:red',
	}),
	[{ signal: 'potLand', scope: 'meter:red' }],
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
	fire({ type: 'respinColumnComplete', reel: 2, newlyLit: false, scope: 'reel:2' }),
	[],
);
eq(
	'a newly lit letter is its reel’s letterLit',
	fire({ type: 'respinColumnComplete', reel: 2, newlyLit: true, scope: 'reel:2' }),
	[{ signal: 'letterLit', scope: 'reel:2' }],
);
eq(
	'the platform’s jackpot scopes by its tier, whatever its case',
	fire({ type: 'platformJackpotCelebration', tier: 'Grand', amount: 5, scope: 'tier:Grand' }),
	[{ signal: 'platformJackpotWin', scope: 'tier:grand' }],
);
eq(
	'a level up is scoped by its meter',
	fire({ type: 'potLevelUp', meter: 'blue', level: 4, max: 12, scope: 'meter:blue' }),
	[{ signal: 'potLevelUp', scope: 'meter:blue' }],
);
for (const unsub of unsubs) unsub();

registerComponentSignals(live);
const heard: (EventScope | undefined)[] = [];
const off = getComponentSignal('potFull').subscribe((scope) => heard.push(scope));
eventEmitter.broadcast({ type: 'potFull', meter: 'green', scope: 'meter:green' });
off();
eq('a registered signal reaches a component with its scope', heard, ['meter:green']);
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
eq(
	'the Pot scopes by its meter, as a meter',
	[POT_METER_DEF.signalScope, POT_METER_DEF.signalScopeKind],
	['meter', 'meter'],
);
check(
	'…a param it declares',
	(POT_METER_DEF.params ?? []).some((p) => p.key === POT_METER_DEF.signalScope),
);
eq(
	'the jackpot tile scopes by its source, as a tier',
	[JACKPOT_TILE_DEF.signalScope, JACKPOT_TILE_DEF.signalScopeKind],
	['source', 'tier'],
);
const defaultTile = scopeOf(
	JACKPOT_TILE_DEF.signalScopeKind,
	paramDefault(JACKPOT_TILE_DEF, 'source'),
);
eq('…so a default tile hears the GRAND tier', defaultTile, 'tier:grand');
check('…the platform’s GRAND too', scopeMatches(defaultTile, eventScope({ scope: 'tier:Grand' })));
check('…but not MAJOR', !scopeMatches(defaultTile, 'tier:major'));
check('…and still a pot’s activation, another kind', scopeMatches(defaultTile, 'meter:red'));
const kinds: readonly string[] = SIGNAL_SCOPE_KINDS;
check(
	'every scoped catalog signal names a kind a def can be scoped as',
	ENGINE_SIGNAL_CATALOG.every((s) => !s.scope || kinds.includes(s.scope)),
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
	(instance.match(/hears\(scope\)/g) ?? []).length >= 2,
);
check(
	'a nested instance inherits the scope it is placed in',
	/scopeOf\(def\.signalScopeKind[\s\S]{0,160}\?\?\s*getComponentSignalScope\(\)/.test(instance),
);
check(
	'every effect node passes its instance scope',
	(
		read('packages/engine-layout/src/lib/LayoutNodeView.svelte').match(/scope=\{signalScope\}/g) ??
		[]
	).length >= 2,
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
			{
				id: 'cleared',
				kind: 'fireCue',
				pos: { x: 600, y: 0 },
				ref: 'potFull',
				inputs: { meter: literal('green'), scope: literal('') },
			},
		],
		exec: [
			{ from: { node: 'on', pin: 'exec' }, to: { node: 'red', pin: 'exec' } },
			{ from: { node: 'red', pin: 'exec' }, to: { node: 'any', pin: 'exec' } },
			{ from: { node: 'any', pin: 'exec' }, to: { node: 'cleared', pin: 'exec' } },
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
eq('a set scope pin rides the payload; an unset or cleared one adds nothing', broadcasts, [
	{ meter: 'red', scope: 'red' },
	{ meter: 'blue' },
	{ meter: 'green' },
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
		signalScopeKind: 'meter',
	} as ComponentDef);
eq(
	'a def keeps the param its scope comes from, and its kind',
	[saved('meter').signalScope, saved('meter').signalScopeKind],
	['meter', 'meter'],
);
eq(
	'…and drops both when the param is gone',
	[saved('nope').signalScope, saved('nope').signalScopeKind],
	[undefined, undefined],
);
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
