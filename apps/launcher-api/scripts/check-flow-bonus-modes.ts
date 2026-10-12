/**
 * Contract check for bonus-games Phase 5c — the Flow v2 vocabulary keyed on the board, not on the id
 * `holdAndWin` (docs/design/bonus-games.md §2.4 "Flow v2"):
 *   pnpm --filter launcher-api check:flow-bonus-modes
 *
 * What it pins, over the REAL `flowAddOnsOf`, `withAddOns`, `graftAddOnSteps`, publish gate
 * (`validateFlowV2Against`) and runtime ownership predicates:
 *  1. A lines doc with TWO respin modes: the add-ons list both (the primary first); the graft gives
 *     each its own starter section with the Hold and Win beats, node ids unique across the doc, a
 *     Mode trigger for its own mode and screens that are that mode's own (`-<modeId>` for the
 *     second), every one a screen of the project's scene set; the result publishes clean, warning
 *     free; a second graft adds nothing.
 *  2. The runtime runs the mode-2 graph while mode 2 is on the stack: it owns the respin signals
 *     there and its chain shows the board.
 *  3. Tabs by board: a respin tab offers and accepts the respin feature's events; a reels tab
 *     (free spins) is offered none of them, and one handled there is a warning, never an error.
 *  4. The same second mode on a `holdAndWin` kind project: the seed keeps its own section and the
 *     graft adds only the second mode's.
 *  5. Every current doc (no config, plain lines, free spins, the `hw-*` presets, an expanding Hold and
 *     Win, the overlay presets on lines and Book-of, `borut-pots-sample`) resolves byte-identical
 *     add-ons, grafted starter flow and publish verdict to `main` before Phase 5c (`MAIN_DIGESTS`).
 *     Its vocabulary is byte-identical EXCEPT the two reworded `mode` field descriptions
 *     (`respinReveal`, `holdAndWinState`; editor text only): the new wording is pinned on exactly
 *     those two fields, and the hash reads them as `main` words them. The same doc stored with the
 *     legacy keys normalizes to the same add-ons, and a current doc carries none.
 *
 * `--print` prints the digests instead of checking them.
 */

import { createHash } from 'node:crypto';
import {
	flowModeGraph,
	flowOwnsSignal,
	freshDrivenSeedDoc,
	graftAddOnSteps,
	graphHandlesSignal,
	RESPIN_FEATURE_EVENTS,
	signalChainCallsAction,
	templateVocabulary,
	vocabForTab,
	withAddOns,
	type FlowDoc,
	type FlowIssue,
	type Graph,
	type TemplateVocabulary,
} from 'engine-flow-v2';
import { engineOwnedOnly, getFullSceneSet, type Scene } from 'engine-layout';
import {
	HOLD_AND_WIN_PRESETS,
	addPotsOverlay,
	flowAddOnsOf,
	holdAndWinModeDecl,
	normalizeGameConfigDoc,
	potsOverlayOf,
	primaryHoldAndWin,
	primaryRespinMode,
	setOverlayPots,
	setPrimaryHoldAndWin,
	type GameConfigDoc,
	type PotsOverlayPresetId,
	type RawGameConfig,
} from 'game-config';
import { sceneSetOptionsFor } from '../src/lib/addOns.ts';
import { validateFlowV2Against } from '../src/lib/server/flowV2Validation.ts';
import { gameConfigDefaultFor } from '../src/lib/server/gameConfigDefaults.ts';

let failures = 0;
let checks = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	checks += 1;
	if (ok) return;
	failures += 1;
	console.log(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const json = (value: unknown): string => JSON.stringify(value);
const same = (label: string, actual: unknown, expected: unknown): void =>
	check(
		label,
		json(actual) === json(expected),
		`expected ${json(expected)}\n        actual   ${json(actual)}`,
	);

const clone = <T>(v: T): T => structuredClone(v);
const normalize = (raw: unknown): GameConfigDoc => {
	const doc = normalizeGameConfigDoc(raw);
	if (!doc) throw new Error('config did not normalize');
	return doc;
};
const withOverlay = (doc: GameConfigDoc, id: PotsOverlayPresetId): GameConfigDoc => {
	const result = addPotsOverlay(doc, id);
	if (!result.ok) throw new Error(result.reason);
	return normalize(result.doc);
};

/** `doc` plus a second respin mode. */
const SECOND = 'holdAndWin_2';
const withSecondMode = (doc: GameConfigDoc): GameConfigDoc => {
	const out = clone(doc);
	const game = clone(primaryRespinMode(out.modes)!.holdAndWin);
	out.modes = [
		...(out.modes ?? []),
		{ ...holdAndWinModeDecl(), id: SECOND, gameType: 'respin_2', label: 'Gold', holdAndWin: game },
	];
	out.paddingReels.respin_2 = clone(out.paddingReels.respin);
	return normalize(out);
};

const EMPTY_LIBRARY = { version: 2 as const, functions: [] };
const scenesFor = (kind: string, doc: GameConfigDoc | null): Scene[] =>
	engineOwnedOnly(getFullSceneSet(kind, sceneSetOptionsFor(kind, doc))!).scenes;
const errorsOf = (issues: FlowIssue[]) => issues.filter((i) => i.severity === 'error');
const describe = (issues: FlowIssue[]) => issues.map((i) => `${i.code}: ${i.message}`).join(' | ');
const allNodeIds = (doc: FlowDoc): string[] => [
	...doc.graph.nodes.map((n) => n.id),
	...Object.values(doc.modes ?? {}).flatMap((m) => m.graph.nodes.map((n) => n.id)),
];
const duplicates = (list: string[]) => list.filter((id, at) => list.indexOf(id) !== at);
const shownScreens = (graph: Graph): string[] => [
	...new Set(
		graph.nodes.flatMap((n) =>
			n.kind === 'showContainer' || n.kind === 'hideContainer' ? [n.ref] : [],
		),
	),
];
const modeTriggers = (graph: Graph): string[] =>
	graph.nodes.flatMap((n) => (n.kind === 'modeTrigger' ? [n.modeId ?? ''] : []));

const lines = normalize(gameConfigDefaultFor('lines'));
const linesHw = withOverlay(lines, 'threePots');

// ── 1. a lines doc with two respin modes ───────────────────────────────────────────────────────
const two = withSecondMode(linesHw);
const twoAddOns = flowAddOnsOf(two);
same('1. the add-ons list both respin modes, the primary first', twoAddOns.respinModes, [
	'holdAndWin',
	SECOND,
]);
check('1. …and turn the respin feature on', twoAddOns.holdAndWin);
const twoScenes = scenesFor('lines', two);
const sceneIds = new Set(twoScenes.map((s) => s.id));
const linesSeed = freshDrivenSeedDoc('lines');
const grafted = graftAddOnSteps(linesSeed, twoAddOns);
const sections = grafted.doc.modes ?? {};
check(
	'1. the graft adds a starter section for each respin mode',
	grafted.added.includes('modes.holdAndWin') && grafted.added.includes(`modes.${SECOND}`),
	json(grafted.added),
);
for (const mode of ['holdAndWin', SECOND]) {
	const graph = sections[mode]?.graph;
	if (!graph) {
		check(`1. ${mode} · has a section`, false);
		continue;
	}
	check(
		`1. ${mode} · its section handles every respin feature beat the starter wires`,
		['holdAndWinTrigger', 'respinReveal', 'holdAndWinState', 'holdAndWinEnd'].every((event) =>
			graphHandlesSignal(graph, event),
		),
	);
	same(`1. ${mode} · its Mode triggers are its own`, modeTriggers(graph), [mode, mode]);
	const screens = shownScreens(graph);
	check(
		`1. ${mode} · its screens are its own copies`,
		screens.length > 0 &&
			screens.every((id) => (mode === 'holdAndWin' ? !id.includes('-') : id.endsWith(`-${mode}`))),
		json(screens),
	);
	check(
		`1. ${mode} · every screen it shows is in the project's scene set, declared as a container`,
		screens.every(
			(id) =>
				sceneIds.has(id) && grafted.doc.containers.some((c) => c.id === id && c.sceneId === id),
		),
		json(screens.filter((id) => !sceneIds.has(id))),
	);
}
same('1. no node id twice across the doc', duplicates(allNodeIds(grafted.doc)), []);
const twoVerdict = validateFlowV2Against(
	grafted.doc,
	twoScenes,
	null,
	EMPTY_LIBRARY,
	[],
	twoAddOns,
);
check(
	'1. the two-mode flow publishes clean',
	!errorsOf(twoVerdict).length,
	describe(errorsOf(twoVerdict)),
);
check(
	'1. …with no warning about its screens or tabs',
	!twoVerdict.some(
		(i) => i.code === 'container-scene-missing' || i.code === 'respin-event-off-board',
	),
	describe(twoVerdict),
);
same('1. a second graft adds nothing', graftAddOnSteps(grafted.doc, twoAddOns).added, []);

// ── 2. the runtime runs mode 2's graph while mode 2 is on the stack ───────────────────────────
check(
	'2. mode 2 on the stack ⇒ its own section is the mode graph',
	flowModeGraph(grafted.doc, SECOND) === sections[SECOND]?.graph,
);
check(
	'2. …which owns the respin signals and presents the board',
	flowOwnsSignal(grafted.doc, 'respinReveal', SECOND) &&
		signalChainCallsAction(grafted.doc, SECOND, 'holdAndWinTrigger', 'showRespinBoard'),
);
check(
	'2. mode 1 on the stack ⇒ mode 1’s section, not mode 2’s',
	flowModeGraph(grafted.doc, 'holdAndWin') === sections.holdAndWin?.graph,
);

// ── 3. tabs by board ───────────────────────────────────────────────────────────────────────────
const vocab = withAddOns(templateVocabulary('lines'), twoAddOns);
const eventNames = (v: typeof vocab) => v.events.map((e) => e.name);
check(
	'3. the global graph is offered the whole vocabulary',
	vocabForTab(vocab, null, twoAddOns) === vocab,
);
check(
	'3. a respin tab other than holdAndWin is offered the whole vocabulary',
	vocabForTab(vocab, SECOND, twoAddOns) === vocab,
);
check(
	'3. the free-spins (reels) tab is offered no respin feature event',
	RESPIN_FEATURE_EVENTS.length > 0 &&
		RESPIN_FEATURE_EVENTS.every((e) => eventNames(vocab).includes(e)) &&
		RESPIN_FEATURE_EVENTS.every(
			(e) => !eventNames(vocabForTab(vocab, 'freeSpins', twoAddOns)).includes(e),
		),
);
check(
	'3. …but keeps the events that also arrive outside the feature (a base-game jackpot, the trigger)',
	['jackpotWin', 'holdAndWinTrigger', 'holdAndWinWheel'].every((e) =>
		eventNames(vocabForTab(vocab, 'freeSpins', twoAddOns)).includes(e),
	),
);
const offBoard: FlowDoc = {
	...grafted.doc,
	modes: {
		...sections,
		freeSpins: {
			graph: {
				nodes: [{ id: 'fs_reveal', kind: 'event', pos: { x: 0, y: 0 }, ref: 'respinReveal' }],
				exec: [],
				data: [],
			},
		},
	},
};
const offBoardVerdict = validateFlowV2Against(
	offBoard,
	twoScenes,
	null,
	EMPTY_LIBRARY,
	[],
	twoAddOns,
);
check(
	'3. a respin event in the free-spins tab is a warning there',
	offBoardVerdict.some(
		(i) =>
			i.code === 'respin-event-off-board' &&
			i.severity === 'warning' &&
			i.mode === 'freeSpins' &&
			i.at.on === 'node' &&
			i.at.node === 'fs_reveal',
	),
	describe(offBoardVerdict),
);
check(
	'3. …and never an error',
	!errorsOf(offBoardVerdict).length,
	describe(errorsOf(offBoardVerdict)),
);

// ── 4. a second mode on the holdAndWin kind ────────────────────────────────────────────────────
{
	const kindTwo = withSecondMode(normalize(clone(HOLD_AND_WIN_PRESETS.classic)));
	const addOns = flowAddOnsOf(kindTwo);
	const seed = freshDrivenSeedDoc('holdAndWin');
	const result = graftAddOnSteps(seed, addOns);
	same(
		'4. holdAndWin kind · the graft adds only the second mode',
		result.added.filter((a) => a.startsWith('modes.')),
		[`modes.${SECOND}`],
	);
	check(
		'4. holdAndWin kind · its own section is kept',
		json(result.doc.modes?.holdAndWin) === json(seed.modes?.holdAndWin),
	);
	same('4. holdAndWin kind · no node id twice', duplicates(allNodeIds(result.doc)), []);
	const verdict = validateFlowV2Against(
		result.doc,
		scenesFor('holdAndWin', kindTwo),
		null,
		EMPTY_LIBRARY,
		[],
		addOns,
	);
	check(
		'4. holdAndWin kind · publishes clean',
		!errorsOf(verdict).length,
		describe(errorsOf(verdict)),
	);
}

// ── 5. every current doc is byte-identical to main ─────────────────────────────────────────────
/** The two `mode` field descriptions' new wording, and `main`'s (Phase 5c rewords those only). */
const MODE_WORDING = 'absent ⇒ the primary respin mode';
const asMain = (text: string): string => text.replaceAll(MODE_WORDING, 'absent ⇒ `holdAndWin`');
const digest = (value: unknown): string =>
	createHash('sha256')
		.update(asMain(json(value)))
		.digest('hex')
		.slice(0, 16);

const currentDocs = (): [string, string, GameConfigDoc | null][] => {
	const expanding = normalize(clone(HOLD_AND_WIN_PRESETS.pots));
	setPrimaryHoldAndWin(expanding, {
		...primaryHoldAndWin(expanding)!,
		expansion: { startRows: 3, maxRows: 6, rule: 'fullRow', resetsRespins: true },
	});
	const book = normalize(gameConfigDefaultFor('bookOf'));
	const borut = withOverlay(book, 'threePots');
	const pots = potsOverlayOf(borut)!;
	setOverlayPots(borut, {
		...pots,
		pots: pots.pots.map((p) => (p.id === 'green' ? { ...p, bonus: { mode: 'freeSpins' } } : p)),
	});
	return [
		['no config', 'lines', null],
		['lines', 'lines', lines],
		['free spins (bookOf)', 'bookOf', book],
		...Object.entries(HOLD_AND_WIN_PRESETS).map(
			([id, doc]) =>
				[`hw-${id}-sample`, 'holdAndWin', normalize(clone(doc))] as [string, string, GameConfigDoc],
		),
		['an expanding Hold and Win', 'holdAndWin', normalize(expanding)],
		...(['threePots', 'potsToFreeSpins'] as PotsOverlayPresetId[]).map(
			(id) => [`lines + ${id}`, 'lines', withOverlay(lines, id)] as [string, string, GameConfigDoc],
		),
		['bookOf + potsToFreeSpins', 'bookOf', withOverlay(book, 'potsToFreeSpins')],
		['borut-pots-sample', 'bookOf', normalize(borut)],
	];
};

/** Section 5's facts on `main` 5743911, before Phase 5c (`--print` over that tree). */
const MAIN_DIGESTS: Record<string, string> = {
	'no config · addOns': 'c82a3e2c9448acb7',
	'no config · vocab': '323383f5409c79b2',
	'no config · seed': 'a571a1fb1e6895f7',
	'no config · verdict': '4f53cda18c2baa0c',
	'lines · addOns': 'c82a3e2c9448acb7',
	'lines · vocab': '323383f5409c79b2',
	'lines · seed': 'a571a1fb1e6895f7',
	'lines · verdict': '4f53cda18c2baa0c',
	'free spins (bookOf) · addOns': 'c82a3e2c9448acb7',
	'free spins (bookOf) · vocab': '323383f5409c79b2',
	'free spins (bookOf) · seed': 'a571a1fb1e6895f7',
	'free spins (bookOf) · verdict': '4f53cda18c2baa0c',
	'hw-pots-sample · addOns': '47d859a780dca139',
	'hw-pots-sample · vocab': '73fe676c99fd40fe',
	'hw-pots-sample · seed': 'c09029ce6a948fa2',
	'hw-pots-sample · verdict': '4f53cda18c2baa0c',
	'hw-classic-sample · addOns': 'c0786005d9874dcf',
	'hw-classic-sample · vocab': '73fe676c99fd40fe',
	'hw-classic-sample · seed': 'c09029ce6a948fa2',
	'hw-classic-sample · verdict': '4f53cda18c2baa0c',
	'hw-collector-sample · addOns': 'c0786005d9874dcf',
	'hw-collector-sample · vocab': '73fe676c99fd40fe',
	'hw-collector-sample · seed': 'c09029ce6a948fa2',
	'hw-collector-sample · verdict': '4f53cda18c2baa0c',
	'an expanding Hold and Win · addOns': '47d859a780dca139',
	'an expanding Hold and Win · vocab': '73fe676c99fd40fe',
	'an expanding Hold and Win · seed': 'c09029ce6a948fa2',
	'an expanding Hold and Win · verdict': '4f53cda18c2baa0c',
	'lines + threePots · addOns': '736bd31d149eeb2c',
	'lines + threePots · vocab': '9ad60c90b0f0169c',
	'lines + threePots · seed': '67e6f4ef349c7344',
	'lines + threePots · verdict': '4f53cda18c2baa0c',
	'lines + potsToFreeSpins · addOns': '69009a380719e624',
	'lines + potsToFreeSpins · vocab': 'e4590353a60b67d2',
	'lines + potsToFreeSpins · seed': '67e55bbe7f379fb5',
	'lines + potsToFreeSpins · verdict': '4f53cda18c2baa0c',
	'bookOf + potsToFreeSpins · addOns': '69009a380719e624',
	'bookOf + potsToFreeSpins · vocab': 'e4590353a60b67d2',
	'bookOf + potsToFreeSpins · seed': '67e55bbe7f379fb5',
	'bookOf + potsToFreeSpins · verdict': '4f53cda18c2baa0c',
	'borut-pots-sample · addOns': '736bd31d149eeb2c',
	'borut-pots-sample · vocab': '9ad60c90b0f0169c',
	'borut-pots-sample · seed': '67e6f4ef349c7344',
	'borut-pots-sample · verdict': '4f53cda18c2baa0c',
};

const printed: Record<string, string> = {};
/** Where a vocabulary carries the reworded text: `event.field` per description that has it. */
const rewordedAt = (vocab: TemplateVocabulary): string[] =>
	vocab.events.flatMap((event) =>
		event.payload.flatMap((field) =>
			field.description?.includes(MODE_WORDING) ? [`${event.name}.${field.name}`] : [],
		),
	);

for (const [name, kind, doc] of currentDocs()) {
	const addOns = flowAddOnsOf(doc);
	const docVocab = withAddOns(templateVocabulary(kind), addOns);
	if (docVocab.events.some((event) => event.name === 'respinReveal')) {
		same(`5. ${name} · the new wording is on the two mode fields alone`, rewordedAt(docVocab), [
			'respinReveal.mode',
			'holdAndWinState.mode',
		]);
	}
	const seed = graftAddOnSteps(freshDrivenSeedDoc(kind), addOns).doc;
	const facts = {
		addOns: digest(addOns),
		vocab: digest(docVocab),
		seed: digest(seed),
		verdict: digest(
			validateFlowV2Against(seed, scenesFor(kind, doc), null, EMPTY_LIBRARY, [], addOns),
		),
	};
	for (const [fact, value] of Object.entries(facts)) {
		const key = `${name} · ${fact}`;
		printed[key] = value;
		if (!process.argv.includes('--print')) {
			check(
				`5. ${key} · main's`,
				MAIN_DIGESTS[key] === value,
				`main ${MAIN_DIGESTS[key]} · now ${value}`,
			);
		}
	}
	if (doc) {
		const legacy: RawGameConfig = {
			...clone(doc),
			holdAndWin: primaryHoldAndWin(doc),
			potsOverlay: potsOverlayOf(doc),
		};
		same(
			`5. ${name} · stored with the legacy keys, the same add-ons`,
			flowAddOnsOf(normalize(legacy)),
			addOns,
		);
		same(`5. ${name} · no legacy keys`, 'holdAndWin' in doc || 'potsOverlay' in doc, false);
	}
}

if (process.argv.includes('--print')) {
	console.log(JSON.stringify(printed, null, '\t'));
	process.exit(0);
}
if (failures) {
	console.log(`\ncheck:flow-bonus-modes — ${failures} of ${checks} checks FAILED`);
	process.exit(1);
}
console.log(`check:flow-bonus-modes — all ${checks} checks passed`);
