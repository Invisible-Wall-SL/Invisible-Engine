/**
 * Invisible Game Config decides which symbols every `/flow-v2` symbol picker offers — pinned for
 * every game kind and every setup a project can be in, the same setups `check:symbols-follow-config`
 * walks (`scripts/lib/configSetups.ts`).
 *
 *   1. THE ENGINE DECLARES NO SYMBOL LIST — every registered vocabulary, and the one every kind (built
 *      in, custom, none) resolves to under every add-on combination, has an EMPTY `SymbolName`, and
 *      every symbol-typed field, param and payload (add-on fragments included) names that one enum.
 *   2. THE PICKERS FOLLOW `/config` — for every kind × setup, the loader's symbols
 *      (`flowSymbolsFrom` over `resolvedGameConfigFrom`) composed by the page's own function
 *      (`composeFlowV2Vocab`) with the add-ons the loader computes list exactly `symbolsUsed` of the
 *      config `/config` opens with: in play, then the pots overlay's coins in pot order, nothing it
 *      badges unused, the rows `/symbols` shows, whether or not the config was saved — and every
 *      symbol-typed pin of that vocabulary resolves to those options.
 *   3. A STALE SYMBOL KEEPS LOADING — a flow naming a symbol `/config` took off the reels (a data-in,
 *      a branch-guard operand, a mode section, a group body, a function body, a stored list) loads
 *      unchanged, raises one `symbol-not-in-play` WARNING per stale literal at its node and pin and no
 *      error, and the publish gate's verdict does not move. Back in play, or with the project's
 *      symbols unknown, it warns nothing.
 *   4. THE INSPECTOR SHOWS AND FLAGS — `enumChoices` keeps a stale value and flags it, its options are
 *      the enum's values; the real `EnumLiteral.svelte`, compiled and rendered by Svelte, draws it.
 *   5. THE WIRING — the loader derives the symbols through the resolved config, the page composes with
 *      `data.symbols` through the gate's own function, and the inspector builds every enum editor
 *      from `EnumLiteral` / `enumChoices`.
 *
 * Run:  pnpm --filter launcher-api check:flow-symbols-follow-config
 */

import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { GAME_KINDS } from 'constants-shared/gameKinds';
import {
	freshDrivenSeedDoc,
	HOLD_AND_WIN_FRAGMENT,
	SYMBOL_ENUM,
	symbolsOf,
	TEMPLATE_VOCABULARIES,
	templateVocabulary,
	validateFlowDoc,
	validateFunctionDef,
	withAddOns,
	withSymbols,
	type DataSource,
	type FlowAddOns,
	type FlowDoc,
	type FlowIssue,
	type FunctionDef,
	type Node,
	type TemplateVocabulary,
	type TypeRef,
} from 'engine-flow-v2';
import { engineOwnedOnly, getFullSceneSet } from 'engine-layout';
import { flowAddOnsOf, potsOverlayOf, symbolsInPlay, symbolsUsed, symbolUses } from 'game-config';
import { readLF } from '../../../scripts/lib/read-lf.mjs';
import { composeFlowV2Vocab } from '../src/lib/flowV2Vocab.ts';
import { collectContainerTaps } from '../src/lib/containerTaps.ts';
import { projectContainerEvents, syncFlowContainers } from '../src/lib/flowV2Projection.ts';
import { BUILTIN_SOUND_OPTIONS } from '../src/lib/soundOptions.ts';
import { flowSymbolsFrom } from '../src/lib/server/flowV2Symbols.ts';
import { validateFlowV2Against } from '../src/lib/server/flowV2Validation.ts';
import { resolvedGameConfigFrom } from '../src/lib/server/gameConfigDefaults.ts';
import { symbolDefaultsFor } from '../src/lib/server/symbolDefaults.ts';
import { symbolsPageConfig } from '../src/lib/server/symbolsPageConfig.ts';
import { enumChoices } from '../src/routes/(app)/flow-v2/enumChoices.ts';
import { putOnReels, setups, takeOffReels, templateOf, type Stored } from './lib/configSetups.ts';

let failures = 0;
let checks = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const KINDS = [...GAME_KINDS, 'myCustomKind'];
const ADD_ON_COMBOS: Record<string, FlowAddOns | undefined> = {
	'no add-ons': undefined,
	'a Hold and Win bonus': { holdAndWin: true },
	'a pots overlay': { potsOverlay: true, meters: ['p1', 'p2'] },
	'both add-ons': { holdAndWin: true, potsOverlay: true, meters: ['p1'] },
};

/** Every declared type of a vocabulary, with where it is declared. */
function declaredTypes(vocab: Pick<TemplateVocabulary, 'structs' | 'events' | 'actions' | 'cues'>) {
	const out: Array<{ at: string; type: TypeRef }> = [];
	for (const s of vocab.structs)
		for (const f of s.fields) out.push({ at: `struct ${s.name}.${f.name}`, type: f.type });
	for (const e of vocab.events)
		for (const p of e.payload) out.push({ at: `event ${e.name}.${p.name}`, type: p.type });
	for (const a of vocab.actions)
		for (const p of a.params) out.push({ at: `action ${a.name}.${p.name}`, type: p.type });
	for (const c of vocab.cues)
		for (const p of c.payload) out.push({ at: `cue ${c.name}.${p.name}`, type: p.type });
	return out;
}

/** The enum a type names, through any lists. */
const enumOf = (type: TypeRef): string | undefined =>
	type.t === 'enum' ? type.name : type.t === 'list' ? enumOf(type.of) : undefined;

const symbolTyped = (vocab: Parameters<typeof declaredTypes>[0]) =>
	declaredTypes(vocab).filter(({ type }) => enumOf(type) === SYMBOL_ENUM);

// ── 1. the engine declares no symbol list ───────────────────────────────────────────────────────
for (const [id, vocab] of Object.entries(TEMPLATE_VOCABULARIES)) {
	check(`registered ${id} · SymbolName declares no values`, symbolsOf(vocab), []);
	check(
		`registered ${id} · SymbolName is the one symbol enum`,
		vocab.enums.map((e) => e.name).filter((name) => /symbol/i.test(name)),
		[SYMBOL_ENUM],
	);
}
{
	const vocab = templateVocabulary('lines');
	check(
		'withSymbols · no symbols is the vocabulary itself',
		withSymbols(vocab, []) === vocab,
		true,
	);
	check(
		'withSymbols · the symbols, deduped, in order',
		symbolsOf(withSymbols(vocab, ['L1', 'H1', 'L1', 'C1'])),
		['L1', 'H1', 'C1'],
	);
	check(
		'withSymbols · every other enum untouched',
		withSymbols(vocab, ['L1']).enums.filter((e) => e.name !== SYMBOL_ENUM),
		vocab.enums.filter((e) => e.name !== SYMBOL_ENUM),
	);
	check('withSymbols · the input is not mutated', symbolsOf(vocab), []);
}
for (const kind of [...KINDS, undefined]) {
	for (const [combo, addOns] of Object.entries(ADD_ON_COMBOS)) {
		const vocab = withAddOns(templateVocabulary(kind), addOns);
		const at = `templateVocabulary(${kind}) · ${combo}`;
		check(`${at} · SymbolName declares no values`, symbolsOf(vocab), []);
		check(
			`${at} · no type names a symbol enum but SymbolName`,
			declaredTypes(vocab)
				.map(({ type }) => enumOf(type) ?? '')
				.filter((name) => /symbol/i.test(name) && name !== SYMBOL_ENUM),
			[],
		);
	}
}
/** The symbol-typed surfaces, by name: each must stay typed by the one enum. */
const KNOWN_SYMBOL_SURFACES = [
	['lines', undefined, 'Win.symbol'],
	['lines', undefined, 'showMessage.symbol'],
	['lines', undefined, 'showWinLine.symbol'],
	['lines', undefined, 'hideWinLine.symbol'],
	['bookOf', undefined, 'setExpandingSymbol.symbol'],
	['bookOf', undefined, 'expandBookColumns.symbol'],
	['bookOf', undefined, 'setSpecialSymbol.symbol'],
	['bookOf', undefined, 'specialBookReveal.symbol'],
	['cluster', undefined, 'tumbleBoard.newSymbols'],
	['cluster', undefined, 'tumbleBoardInit.addingBoard'],
	['holdAndWin', undefined, 'HoldAndWinSymbol.name'],
	['lines', { potsOverlay: true, meters: [] }, 'OverlayCell.token'],
] as const;
for (const [kind, addOns, where] of KNOWN_SYMBOL_SURFACES) {
	const typed = symbolTyped(withAddOns(templateVocabulary(kind), addOns)).map(
		(d) => d.at.split(' ')[1],
	);
	check(`${kind} · ${where} is typed by SymbolName`, typed.includes(where), true);
}
check(
	'the Hold and Win fragment types its `from` fields by SymbolName',
	symbolTyped({
		...HOLD_AND_WIN_FRAGMENT,
		events: [...HOLD_AND_WIN_FRAGMENT.baseEvents, ...HOLD_AND_WIN_FRAGMENT.featureEvents],
	}).filter((d) => d.at.endsWith('.from')).length >= 2,
	true,
);

// ── 2. the pickers follow /config ───────────────────────────────────────────────────────────────
/** What `/flow-v2` lists, from the stored config, exactly as its loader and page compose it. */
function pickerVocab(kind: string, stored: Stored): TemplateVocabulary {
	return composeFlowV2Vocab(kind, {
		addOns: flowAddOnsOf(stored.doc),
		symbols: flowSymbolsFrom(stored, kind),
		sounds: BUILTIN_SOUND_OPTIONS,
		sceneCues: [],
	});
}

let combos = 0;
const kindsSeen = new Set<string>();
for (const kind of KINDS) {
	for (const { label, stored } of setups(kind)) {
		const at = `${kind} · ${label}`;
		const config = resolvedGameConfigFrom(stored, kind);
		const shown = config.doc;
		if (!shown) throw new Error(`no config for ${at}`);
		const vocab = pickerVocab(kind, stored);
		const options = symbolsOf(vocab);
		const uses = symbolUses(shown);
		const coins = (potsOverlayOf(shown)?.pots.map((pot) => pot.token) ?? []).filter(
			(name, i, all) => all.indexOf(name) === i && uses[name] === 'token',
		);
		combos += 1;
		kindsSeen.add(kind);
		check(`${at} · the options are symbolsUsed, order included`, options, symbolsUsed(shown));
		check(
			`${at} · no symbol /config badges unused is offered`,
			options.filter((name) => uses[name] === 'unused'),
			[],
		);
		check(`${at} · in play, then the coins in pot order`, options, [
			...symbolsInPlay(shown),
			...coins,
		]);
		const page = symbolsPageConfig(kind, symbolDefaultsFor(kind), config);
		check(
			`${at} · the options are /symbols' rows, its coin group last`,
			[[...options].sort(), options.slice(options.length - page.coins.length)],
			[[...page.symbols].sort(), page.coins],
		);
		check(
			`${at} · nothing depends on whether the config was saved`,
			options,
			symbolsOf(pickerVocab(kind, { doc: shown, etag: '"saved"' })),
		);
		const pins = symbolTyped(vocab);
		check(`${at} · the vocabulary has symbol-typed pins`, pins.length > 0, true);
		check(
			`${at} · every symbol-typed pin resolves to the options`,
			pins.filter(({ type }) => {
				const values = vocab.enums.find((e) => e.name === enumOf(type))?.values;
				return JSON.stringify(values) !== JSON.stringify(options);
			}),
			[],
		);
		if (flowAddOnsOf(stored.doc).potsOverlay) {
			check(
				`${at} · the overlay's token field offers the coins`,
				pins.some((p) => p.at === 'struct OverlayCell.token') &&
					coins.every((c) => options.includes(c)),
				true,
			);
		}
	}
}
check('every kind ran', [...kindsSeen].sort(), [...KINDS].sort());
check(
	'lines never saved · W (unused in its template) is not offered',
	symbolsOf(pickerVocab('lines', { doc: null, etag: null })).includes('W'),
	false,
);
check(
	'ways never saved · H5 (in play) offered, L5 (not in its config) not',
	['H5', 'L5'].map((name) =>
		symbolsOf(pickerVocab('ways', { doc: null, etag: null })).includes(name),
	),
	[true, false],
);

// ── 3. a stale symbol keeps loading ─────────────────────────────────────────────────────────────
const SYMBOL: TypeRef = { t: 'enum', name: SYMBOL_ENUM };
const literal = (type: TypeRef, value: unknown): DataSource => ({ kind: 'literal', type, value });
const pos = { x: 0, y: 0 };
const KIND = 'bookOf';
const template = templateOf(KIND);
const STALE = symbolsInPlay(template)[0];
const action = (id: string, symbol: string): Node => ({
	id,
	kind: 'action',
	ref: 'setSpecialSymbol',
	pos,
	inputs: { symbol: literal(SYMBOL, symbol) },
});
const bodyFn: FunctionDef = {
	id: 'fnArm',
	name: 'Arm',
	inputs: [],
	outputs: [],
	requires: {},
	body: {
		nodes: [
			{ id: 'fnEntry', kind: 'functionEntry', ref: 'fnArm', pos },
			action('fnSet', STALE),
			{ id: 'fnResult', kind: 'functionResult', ref: 'fnArm', pos },
		],
		exec: [
			{ from: { node: 'fnEntry', pin: 'exec' }, to: { node: 'fnSet', pin: 'exec' } },
			{ from: { node: 'fnSet', pin: 'exec' }, to: { node: 'fnResult', pin: 'exec' } },
		],
		data: [],
	},
};
const LIBRARY = { version: 2 as const, functions: [bodyFn] };
const seed = freshDrivenSeedDoc(KIND);
const staleDoc: FlowDoc = {
	...seed,
	graph: {
		...seed.graph,
		nodes: [
			...seed.graph.nodes,
			{ id: 'symEvent', kind: 'event', ref: 'setExpandingSymbol', pos },
			action('symSet', STALE),
			{
				id: 'symBranch',
				kind: 'branch',
				pos,
				guard: {
					all: [
						{
							left: { kind: 'accessor', path: { on: 'trigger', member: 'symbol' } },
							op: 'eq',
							right: literal(SYMBOL, STALE),
						},
					],
					any: [{ left: literal(SYMBOL, STALE), op: 'ne', right: literal(SYMBOL, STALE) }],
				},
			},
			{
				id: 'symGroup',
				kind: 'group',
				label: 'Arm',
				pos,
				body: { nodes: [action('symGrouped', STALE)], exec: [], data: [] },
				boundary: [],
			},
		],
		exec: [
			...seed.graph.exec,
			{ from: { node: 'symEvent', pin: 'exec' }, to: { node: 'symSet', pin: 'exec' } },
			{ from: { node: 'symSet', pin: 'exec' }, to: { node: 'symBranch', pin: 'exec' } },
		],
	},
	modes: {
		...seed.modes,
		bonus: { graph: { nodes: [action('symModed', STALE)], exec: [], data: [] } },
	},
};
const STALE_AT = [
	['symSet', 'symbol', undefined],
	['symBranch', 'all.0.right', undefined],
	['symBranch', 'any.0.left', undefined],
	['symBranch', 'any.0.right', undefined],
	['symGrouped', 'symbol', undefined],
	['symModed', 'symbol', 'bonus'],
];
const scenes = engineOwnedOnly(getFullSceneSet(KIND)!).scenes;
const takenOff: Stored = { doc: takeOffReels(template, STALE), etag: '"e"' };
const inPlay: Stored = { doc: template, etag: '"e"' };
const unknown: Stored = { doc: null, etag: null };

/** The editor's load path: the loader's container sync, then the Validation panel's two passes. */
function editorLoad(stored: FlowDoc, config: Stored, kind = KIND) {
	const doc = structuredClone(stored);
	syncFlowContainers(doc, scenes);
	const vocab = pickerVocab(kind, config);
	const issues: FlowIssue[] = [
		...validateFlowDoc(
			doc,
			vocab,
			LIBRARY,
			projectContainerEvents(doc.containers, scenes),
			collectContainerTaps(doc.containers, scenes),
			scenes.map((s) => s.id),
		),
		...LIBRARY.functions.flatMap((fn) => validateFunctionDef(fn, vocab, LIBRARY)),
	];
	return { doc, issues };
}
const notInPlay = (issues: FlowIssue[]) => issues.filter((i) => i.code === 'symbol-not-in-play');
const where = (i: FlowIssue) => [
	i.at.on === 'pin' || i.at.on === 'node' ? i.at.node : '',
	i.at.on === 'pin' ? i.at.pin : '',
	i.mode,
];
const errorsOf = (issues: FlowIssue[]) => issues.filter((i) => i.severity === 'error');

check(
	`the stale symbol (${STALE}) is in play in the ${KIND} template`,
	symbolsInPlay(template).includes(STALE),
	true,
);
check(`…and not once it is taken off the reels`, symbolsUsed(takenOff.doc!).includes(STALE), false);

const before = JSON.stringify(staleDoc);
const loaded = editorLoad(staleDoc, takenOff);
check(
	'taken off · no error',
	errorsOf(loaded.issues).map((i) => `${i.code}: ${i.message}`),
	[],
);
check(
	'taken off · one symbol-not-in-play warning per stale literal, at its node and pin',
	notInPlay(loaded.issues).map(where).sort(),
	[
		...STALE_AT.map(([node, pin, mode]) => [node, pin, mode]),
		['fnSet', 'symbol', undefined],
	].sort(),
);
check(
	'taken off · every one is a warning that names the symbol and the fix',
	notInPlay(loaded.issues).every(
		(i) =>
			i.severity === 'warning' &&
			i.message.includes(`'${STALE}'`) &&
			i.message.includes('kept as authored') &&
			i.message.includes('Invisible Game Config'),
	),
	true,
);
check('taken off · the stored doc is untouched', JSON.stringify(staleDoc), before);
{
	const synced = structuredClone(staleDoc);
	syncFlowContainers(synced, scenes);
	check(
		'taken off · the load rewrites nothing but the container sync',
		JSON.stringify(loaded.doc),
		JSON.stringify(synced),
	);
}
const gate = (doc: FlowDoc) =>
	errorsOf(validateFlowV2Against(doc, scenes, null, LIBRARY, [], flowAddOnsOf(takenOff.doc)));
check(
	'the publish gate · same verdict on the stale flow as on the seed it grew from',
	gate(staleDoc).map((i) => i.code),
	gate(seed).map((i) => i.code),
);
check('the publish gate · the stale flow is publishable', gate(staleDoc), []);
check(
	'the publish gate · judges no symbol (it composes no symbols)',
	notInPlay(validateFlowV2Against(staleDoc, scenes, null, LIBRARY, [], flowAddOnsOf(takenOff.doc))),
	[],
);
check('back in play · no warning', notInPlay(editorLoad(staleDoc, inPlay).issues), []);
check(
	'back in play · the same errors as taken off (none)',
	errorsOf(editorLoad(staleDoc, inPlay).issues),
	[],
);
check(
	'put back on the reels in /config · no warning',
	notInPlay(editorLoad(staleDoc, { doc: putOnReels(takenOff.doc!, STALE), etag: '"e"' }).issues),
	[],
);
check(
	'unknown symbols (an empty SymbolName) · no warning',
	notInPlay([
		...validateFlowDoc(staleDoc, withAddOns(templateVocabulary(KIND), undefined), LIBRARY),
		...validateFunctionDef(bodyFn, templateVocabulary(KIND), LIBRARY),
	]),
	[],
);
check(
	'a custom kind never saved resolves a config, so its symbols are known',
	flowSymbolsFrom(unknown, 'myCustomKind').length > 0,
	true,
);
{
	// A stored LIST of symbols (no pin offers a list-of-symbol literal today; the board cues take a
	// list of lists): each stale element warns once, the in-play ones do not.
	const cluster = templateOf('cluster');
	const gone = symbolsInPlay(cluster)[0];
	const kept = symbolsInPlay(cluster)[1];
	const listDoc: FlowDoc = {
		...freshDrivenSeedDoc('cluster'),
		graph: {
			nodes: [
				{ id: 'tumble', kind: 'event', ref: 'tumbleBoard', pos },
				{
					id: 'init',
					kind: 'fireCue',
					ref: 'tumbleBoardInit',
					pos,
					inputs: {
						addingBoard: literal({ t: 'list', of: { t: 'list', of: SYMBOL } }, [
							[gone, kept],
							[gone],
						]),
					},
				},
			],
			exec: [{ from: { node: 'tumble', pin: 'exec' }, to: { node: 'init', pin: 'exec' } }],
			data: [],
		},
	};
	const issues = validateFlowDoc(
		listDoc,
		pickerVocab('cluster', { doc: takeOffReels(cluster, gone), etag: '"e"' }),
		LIBRARY,
	);
	check(
		'a stored list · no error',
		errorsOf(issues).map((i) => i.code),
		[],
	);
	check('a stored list · one warning per stale element', notInPlay(issues).map(where), [
		['init', 'addingBoard', undefined],
		['init', 'addingBoard', undefined],
	]);
	check(
		'a stored list · in play, no warning',
		notInPlay(
			validateFlowDoc(listDoc, pickerVocab('cluster', { doc: cluster, etag: '"e"' }), LIBRARY),
		),
		[],
	);
}

// ── 4. the inspector shows and flags ────────────────────────────────────────────────────────────
const values = ['H1', 'H2', 'L1'];
check(
	'enumChoices · the options are the values',
	enumChoices(SYMBOL_ENUM, values, 'H1').options,
	values,
);
check(
	'enumChoices · an in-play value is not stale',
	enumChoices(SYMBOL_ENUM, values, 'H1').stale,
	[],
);
check('enumChoices · a stale value is kept and flagged', enumChoices(SYMBOL_ENUM, values, 'W'), {
	options: values,
	stale: ['W'],
	flag: 'not in play',
	note: enumChoices(SYMBOL_ENUM, values, 'W').note,
});
check(
	'enumChoices · its note says it is not in play in Invisible Game Config and kept',
	/Invisible Game Config/.test(enumChoices(SYMBOL_ENUM, values, 'W').note) &&
		/kept as authored/.test(enumChoices(SYMBOL_ENUM, values, 'W').note),
	true,
);
check(
	'enumChoices · a list keeps each stale element once',
	enumChoices(SYMBOL_ENUM, values, ['W', 'H1', 'W', 'M']).stale,
	['W', 'M'],
);
check(
	'enumChoices · nothing stored is nothing stale',
	enumChoices(SYMBOL_ENUM, values, '').stale,
	[],
);
check(
	'enumChoices · only SymbolName says "not in play"',
	enumChoices('MusicName', values, 'gone').flag,
	'not listed',
);
check(
	'enumChoices · unknown symbols are never called out of play',
	enumChoices(SYMBOL_ENUM, [], 'W').flag,
	'not listed',
);

const here = fileURLToPath(new URL('.', import.meta.url));
const route = `${here}../src/routes/(app)/flow-v2/`;
{
	// The REAL component, compiled by Svelte and rendered by its server runtime.
	const source = readLF(`${route}EnumLiteral.svelte`);
	const { js } = compile(source, { generate: 'server', filename: 'EnumLiteral.svelte' });
	const internal = import.meta.resolve('svelte/internal/server');
	const helper = pathToFileURL(`${route}enumChoices.ts`).href;
	const code = js.code
		.replaceAll(`'svelte/internal/server'`, `'${internal}'`)
		.replaceAll(`'./enumChoices'`, `'${helper}'`);
	const file = join(tmpdir(), `enum-literal-${process.pid}.mjs`);
	writeFileSync(file, code);
	try {
		const { default: EnumLiteral } = await import(pathToFileURL(file).href);
		const draw = (props: Record<string, unknown>): string =>
			render(EnumLiteral, { props: { enumName: SYMBOL_ENUM, values, commit: () => {}, ...props } })
				.body;
		const stale = draw({ value: 'W' });
		check(
			'EnumLiteral · a stale value is an option labelled not in play, with the note',
			[
				stale.includes('W — not in play'),
				stale.includes('Invisible Game Config'),
				values.every((v) => stale.includes(`>${v}</option>`)),
			],
			[true, true, true],
		);
		const fresh = draw({ value: 'H1' });
		check(
			'EnumLiteral · an in-play value draws no flag',
			[fresh.includes('not in play'), fresh.includes('Invisible Game Config')],
			[false, false],
		);
		const chips = draw({ list: true, value: ['H1', 'W'] });
		check(
			'EnumLiteral · a list draws a chip per value and a flagged chip for the stale one',
			[
				values.every((v) => chips.includes(`>${v}</button>`)),
				chips.includes('W — not in play ✕'),
				chips.includes('Click to remove it.'),
			],
			[true, true, true],
		);
	} finally {
		rmSync(file, { force: true });
	}
}

// ── 5. the wiring ───────────────────────────────────────────────────────────────────────────────
const read = (path: string): string => readLF(`${here}../src/${path}`);
const loader = read('routes/(app)/flow-v2/+page.server.ts');
const pageSource = read('routes/(app)/flow-v2/+page.svelte');
const inspector = read('routes/(app)/flow-v2/NodeInspector.svelte');
const enumLiteral = read('routes/(app)/flow-v2/EnumLiteral.svelte');
const symbolsHelper = read('lib/server/flowV2Symbols.ts');
const gateSource = read('lib/server/flowV2Validation.ts');
const holds = (source: string, code: string): boolean =>
	source.replace(/\s+/g, '').includes(code.replace(/\s+/g, ''));
check(
	'the loader resolves the kind as /config and /symbols do, and derives the symbols from the stored config',
	[
		holds(loader, 'projectGameType(projectKey),'),
		holds(loader, 'const storedConfig = await loadGameConfigDocWithEtag(clientKey, projectKey);'),
		holds(loader, 'const symbols = flowSymbolsFrom(storedConfig, gameType);'),
		holds(loader, 'symbols,\n\t};'),
	],
	[true, true, true, true],
);
check(
	'flowSymbolsFrom reads the RESOLVED config',
	[
		holds(symbolsHelper, 'const { doc } = resolvedGameConfigFrom(stored, gameType);'),
		holds(symbolsHelper, 'return doc ? symbolsUsed(doc) : [];'),
	],
	[true, true],
);
check(
	'the page composes with data.symbols through composeFlowV2Vocab, and nothing else',
	[
		holds(pageSource, 'composeFlowV2Vocab(doc.templateId, {'),
		holds(pageSource, 'symbols: data.symbols,'),
		/withAddOns\(|templateVocabulary\(/.test(pageSource),
	],
	[true, true, false],
);
check(
	'the publish gate composes through the same function, and passes it no symbols',
	[
		holds(gateSource, 'const vocab = composeFlowV2Vocab(doc.templateId, {'),
		/withAddOns\(/.test(gateSource),
		/^\s*symbols\s*[:,]/m.test(gateSource),
	],
	[true, false, false],
);
check(
	'the inspector builds its enum editors from EnumLiteral, never its own option loop',
	[
		inspector.split('<EnumLiteral').length - 1,
		/\{#each vocab\.enums\b/.test(inspector),
		holds(inspector, 'values={enumValues(lt.name)}'),
		holds(inspector, 'values={enumValues(enumName)}'),
	],
	[2, false, true, true],
);
check(
	'EnumLiteral draws its options and its stale values from enumChoices; a stale chip removes itself',
	[
		holds(
			enumLiteral,
			'{#each choices.stale as v (v)} <button type="button" class="chip stale" title="{v} — {choices.flag}. Click to remove it." onclick={() => commit(selected.filter((x) => x !== v))}>',
		),
		holds(enumLiteral, 'enumChoices(enumName, values, unset ? undefined : value)'),
		enumLiteral.split('{#each choices.stale as v (v)}').length - 1,
		enumLiteral.split('{#each choices.options as v (v)}').length - 1,
	],
	[true, true, 2, 2],
);

console.log(
	failures === 0
		? `\nflow symbols follow config: OK (${checks} checks, ${combos} kind × setup combinations)`
		: `\nflow symbols follow config: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
