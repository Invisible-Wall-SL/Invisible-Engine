/**
 * Guard the Flow publish gate's offline contracts.
 *
 * Run: `pnpm --filter launcher-api run check:flow-publish-gate`
 *
 * 1. **Every game type's scaffold passes its own gate.** A new project is scaffolded with the type's
 *    starter flow (`projectScaffold.ts`) beside the type's engine-owned scenes, and Publish refuses a
 *    flow with validation errors — so a starter that fails against its own scaffold would make every
 *    new game of that type unpublishable out of the box. Validated through `validateFlowV2Against`,
 *    the function the gate itself calls, with the EMPTY library a fresh launcher ships.
 * 2. **The gate sees an exec fan-out** (negative control): the same starter with a second wire out of
 *    one exec-out is an error.
 * 3. **The editor replaces, never adds, a second exec wire** (`addExecEdgeIn`), while a different
 *    out-pin on the same node keeps its own wire.
 * 4. **Every kind resolves to the starter flow + vocabulary it is recorded to** — the pin on the
 *    named fallbacks (`DRIVEN_SEED_FALLBACKS` / `VOCABULARY_FALLBACKS`). `cluster` and `scatter` own
 *    their seeds since 2026-10-01 (they borrowed the Book-of one before), and so does `holdAndWin`
 *    (Hold and Win Phase 5; it followed `lines` before). A new kind must be added here, so what it
 *    resolves to is a decision rather than a floor it fell through to.
 * 5. **Every registered starter flow validates against its OWN vocabulary** — every `DRIVEN_SEEDS`
 *    entry is keyed by its `templateId`, that id has a registered vocabulary (not a fallback), and
 *    `validateFlowDoc` finds no error. §1 reaches only the seeds a game kind resolves to; this
 *    reaches every seed.
 * 6. **Game-mode sections go through the same gate** (hold-and-win §4.5). A starter flow with a
 *    clean `modes` section still passes; an error inside a section (a Mode trigger naming no mode,
 *    an unresolved action) is refused by Publish exactly like one in the global graph, and the issue
 *    names its section. Without this a mode tab could ship anything, because only `doc.graph` was
 *    validated before modes existed.
 * 7. **Add-ons change nothing without a block** (pots overlay §2): for every kind, `withAddOns` over
 *    the add-ons of no config, or of the kind's committed default config, is the kind's vocabulary
 *    itself, and the gate's verdict on the kind's starter flow is the same with them as without.
 *    The Hold and Win kind, whose config always has the block, gets `HOLD_AND_WIN_VOCAB` back.
 * 8. **The Hold and Win kind drops what its capabilities turn off**: `HOLD_AND_WIN_KIND_CAPABILITIES`
 *    is `kindCapabilities('holdAndWin')`, and the explicit `STANDARD_CAPABILITY_ENTRIES` lists are
 *    exactly what the old name regex matched over the standard vocabulary.
 * 9. **A Book-of project with the pots overlay** (the `potsToFreeSpins` preset on the Book-of
 *    default) publishes a flow that handles `overlayDrop`, flies to a pot, fills it, fires `potFull`
 *    and reads `meter.<id>.level` — and the same flow is refused without the add-ons.
 * 10. **A Book-of project with a Hold and Win bonus** (`threePots`): its starter flow grafted with
 *    `graftAddOnSteps` passes against the Book-of scaffold scenes, alone and with the Hold and Win
 *    mode screens; its Hold and Win refs are refused without the add-ons.
 * 11. **The graft is safe**: authored nodes and wires untouched, idempotent, an existing
 *    `modes.holdAndWin` kept, no id collision, `overlayDrop` → `showTokens`, the input not mutated,
 *    and a no-op without a block. `signalChainCallsAction` (the play seam's "does this owned entry
 *    drain its pots itself" test) follows the chain of the signal's own scope.
 * 12. **Every composed vocabulary is well formed**: every struct / enum a type names is declared and
 *    no list declares a name twice, for every kind under every add-on combination.
 */
import { GAME_KINDS } from 'constants-shared/gameKinds';
import {
	BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS,
	DRIVEN_SEEDS,
	freshDrivenSeedDoc,
	graftAddOnSteps,
	HOLD_AND_WIN_DRIVEN_SEED_DOC,
	signalChainCallsAction,
	HOLD_AND_WIN_KIND_CAPABILITIES,
	HOLD_AND_WIN_VOCAB,
	STANDARD_CAPABILITY_ENTRIES,
	standardVocabulary,
	TEMPLATE_VOCABULARIES,
	templateVocabulary,
	validateFlowDoc,
	withAddOns,
	type FlowAddOns,
	type FlowDoc,
	type FlowIssue,
	type Node,
	type TemplateVocabulary,
	type TypeRef,
} from 'engine-flow-v2';
import { engineOwnedOnly, getFullSceneSet, kindCapabilities } from 'engine-layout';
import {
	flowAddOnsOf,
	holdAndWinBonus,
	normalizeGameConfigDoc,
	potsOverlayPreset,
	type GameConfigDoc,
	type PotsOverlayPresetId,
} from 'game-config';

import { gameConfigDefaultFor } from '../src/lib/server/gameConfigDefaults';
import { validateFlowV2Against } from '../src/lib/server/flowV2Validation';
import { addExecEdgeIn } from '../src/routes/(app)/flow-v2/graphOps';

let fails = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  PASS  ${name}`);
	else {
		fails++;
		console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
	}
};

const EMPTY_LIBRARY = { version: 2 as const, functions: [] };
for (const gameType of GAME_KINDS) {
	const reference = getFullSceneSet(gameType);
	if (!reference) {
		check(`1. ${gameType}: has a full scene set`, false);
		continue;
	}
	const scenes = engineOwnedOnly(reference).scenes;
	const errors = validateFlowV2Against(
		freshDrivenSeedDoc(gameType),
		scenes,
		null,
		EMPTY_LIBRARY,
	).filter((i) => i.severity === 'error');
	check(
		`1. ${gameType}: the scaffolded starter flow passes the publish gate`,
		errors.length === 0,
		errors.map((e) => `${e.code}: ${e.message}`).join(' | '),
	);
}

const seed: FlowDoc = freshDrivenSeedDoc('ways');
const firstExec = seed.graph.exec[0];
const fanned: FlowDoc = {
	...seed,
	graph: {
		...seed.graph,
		exec: [...seed.graph.exec, { from: firstExec.from, to: seed.graph.exec[1].to }],
	},
};
const waysScenes = engineOwnedOnly(getFullSceneSet('ways')!).scenes;
check(
	'2. a second wire out of one exec-out is refused by the gate',
	validateFlowV2Against(fanned, waysScenes, null, EMPTY_LIBRARY).some(
		(i) => i.code === 'exec-out-fanout' && i.severity === 'error',
	),
);

const graph: FlowDoc['graph'] = {
	nodes: [],
	exec: [
		{ from: { node: 'branch', pin: 'then' }, to: { node: 'a', pin: 'exec' } },
		{ from: { node: 'branch', pin: 'else' }, to: { node: 'b', pin: 'exec' } },
	],
	data: [],
};
const rewired = addExecEdgeIn(graph, { node: 'branch', pin: 'then' }, { node: 'c', pin: 'exec' });
const fromThen = rewired.exec.filter((e) => e.from.node === 'branch' && e.from.pin === 'then');
check(
	'3. drawing a second wire from an exec-out replaces the first',
	fromThen.length === 1 && fromThen[0].to.node === 'c',
	JSON.stringify(fromThen),
);
check(
	'3. …and leaves the node’s other exec-out alone',
	rewired.exec.some((e) => e.from.pin === 'else' && e.to.node === 'b'),
);

/** Kind → [starter flow's templateId, vocabulary templateId]. `my-custom-kind` = an author-created
 *  kind (not a built-in id). */
const RESOLVES_TO: Record<string, [string, string]> = {
	lines: ['bookOf', 'bookOf'],
	ways: ['ways', 'ways'],
	cluster: ['cluster', 'cluster'],
	scatter: ['scatter', 'scatter'],
	bookOf: ['bookOf', 'bookOf'],
	holdAndWin: ['holdAndWin', 'holdAndWin'],
	'my-custom-kind': ['bookOf', 'bookOf'],
};
for (const kind of GAME_KINDS) {
	check(`4. ${kind}: has a recorded resolution`, kind in RESOLVES_TO);
}
for (const [kind, [seedId, vocabId]] of Object.entries(RESOLVES_TO)) {
	const seeded = freshDrivenSeedDoc(kind).templateId;
	check(`4. ${kind}: starter flow is the ${seedId} seed`, seeded === seedId, seeded);
	const vocab = templateVocabulary(kind).templateId;
	check(`4. ${kind}: vocabulary is ${vocabId}`, vocab === vocabId, vocab);
}
check('4. an absent kind gets the bookOf seed', freshDrivenSeedDoc().templateId === 'bookOf');
check(
	'4. an absent templateId gets the bookOf vocabulary',
	templateVocabulary(undefined).templateId === 'bookOf',
);

for (const [id, seed] of Object.entries(DRIVEN_SEEDS)) {
	check(`5. ${id}: the seed is keyed by its templateId`, seed.templateId === id, seed.templateId);
	check(
		`5. ${id}: has a registered vocabulary of its own`,
		Object.hasOwn(TEMPLATE_VOCABULARIES, id),
	);
	const errors = validateFlowDoc(
		seed,
		templateVocabulary(seed.templateId),
		EMPTY_LIBRARY,
		BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS,
	).filter((i) => i.severity === 'error');
	check(
		`5. ${id}: the seed validates against its own vocabulary with no error`,
		errors.length === 0,
		errors.map((e) => `${e.code}: ${e.message}`).join(' | '),
	);
}

const linesSeed: FlowDoc = freshDrivenSeedDoc('lines');
const linesScenes = engineOwnedOnly(getFullSceneSet('lines')!).scenes;
const withSection = (nodes: FlowDoc['graph']['nodes']): FlowDoc => ({
	...linesSeed,
	modes: { holdAndWin: { graph: { nodes, exec: [], data: [] } } },
});
const sectionErrors = (doc: FlowDoc) =>
	validateFlowV2Against(doc, linesScenes, null, EMPTY_LIBRARY).filter(
		(i) => i.severity === 'error',
	);
const at = { x: 0, y: 0 };
const clean = sectionErrors(
	withSection([
		{ id: 'hw_enter', kind: 'modeTrigger', pos: at, modeId: 'holdAndWin' },
		{ id: 'hw_done', kind: 'exitMode', pos: at },
	]),
);
check(
	'6. a starter flow with a clean mode section passes the gate',
	clean.length === 0,
	clean.map((e) => `${e.code}: ${e.message}`).join(' | '),
);
const unset = sectionErrors(
	withSection([{ id: 'hw_x', kind: 'modeTrigger', pos: at, modeId: '' }]),
);
check(
	'6. a Mode trigger naming no mode is refused, tagged with its section',
	unset.some((i) => i.code === 'mode-unset' && i.mode === 'holdAndWin'),
	JSON.stringify(unset),
);
const ghost = sectionErrors(
	withSection([{ id: 'hw_ghost', kind: 'action', pos: at, ref: 'noSuchAction' }]),
);
check(
	'6. an unresolved action inside a mode section is refused like one in the global graph',
	ghost.some((i) => i.code === 'ref-unresolved' && i.mode === 'holdAndWin'),
	JSON.stringify(ghost),
);

const describe = (issues: FlowIssue[]): string =>
	issues.map((e) => `${e.code}: ${e.message}`).join(' | ');
const errorsOf = (issues: FlowIssue[]): FlowIssue[] => issues.filter((i) => i.severity === 'error');
const json = (value: unknown): string => JSON.stringify(value);

for (const kind of Object.keys(RESOLVES_TO)) {
	const vocab = templateVocabulary(kind);
	const kindDefault = gameConfigDefaultFor(kind);
	check(
		`7. ${kind}: no config ⇒ the kind's vocabulary itself`,
		withAddOns(vocab, flowAddOnsOf(null)) === vocab,
	);
	if (kind !== 'holdAndWin') {
		check(
			`7. ${kind}: its default config carries no add-on block ⇒ the kind's vocabulary itself`,
			!kindDefault?.holdAndWin &&
				!kindDefault?.potsOverlay &&
				withAddOns(vocab, flowAddOnsOf(kindDefault)) === vocab,
		);
	}
	const reference = getFullSceneSet(kind);
	if (!reference) continue;
	const scenes = engineOwnedOnly(reference).scenes;
	const seedDoc = freshDrivenSeedDoc(kind);
	check(
		`7. ${kind}: the starter flow's verdict is the same with the no-block add-ons`,
		json(validateFlowV2Against(seedDoc, scenes, null, EMPTY_LIBRARY)) ===
			json(validateFlowV2Against(seedDoc, scenes, null, EMPTY_LIBRARY, [], flowAddOnsOf(null))),
	);
}
const holdAndWinDefault = gameConfigDefaultFor('holdAndWin');
const holdAndWinAddOns = flowAddOnsOf(holdAndWinDefault);
check(
	'7. holdAndWin: its default config has the block (and its meters)',
	holdAndWinAddOns.holdAndWin &&
		!holdAndWinAddOns.potsOverlay &&
		holdAndWinAddOns.meters.length > 0,
	json(holdAndWinAddOns),
);
check(
	'7. holdAndWin + its own block ⇒ HOLD_AND_WIN_VOCAB itself',
	withAddOns(HOLD_AND_WIN_VOCAB, holdAndWinAddOns) === HOLD_AND_WIN_VOCAB &&
		json(withAddOns(HOLD_AND_WIN_VOCAB, { holdAndWin: true, meters: ['red'] })) ===
			json(HOLD_AND_WIN_VOCAB),
);

const holdAndWinCaps = kindCapabilities('holdAndWin');
for (const capability of Object.keys(
	STANDARD_CAPABILITY_ENTRIES,
) as (keyof typeof STANDARD_CAPABILITY_ENTRIES)[]) {
	check(
		`8. HOLD_AND_WIN_KIND_CAPABILITIES.${capability} = kindCapabilities('holdAndWin').${capability}`,
		HOLD_AND_WIN_KIND_CAPABILITIES[capability] === holdAndWinCaps[capability],
	);
}
const standard = standardVocabulary({ templateId: 'gate', symbolNames: [] });
const standardNames = [
	...new Set(
		[...standard.events, ...standard.actions, ...standard.cues, ...standard.values].map(
			(e) => e.name,
		),
	),
];
const matched: Record<keyof typeof STANDARD_CAPABILITY_ENTRIES, string[]> = {
	freeSpins: standardNames.filter((n) => /freeSpin|FreeSpin|FreeGame/.test(n)),
	stackedPictures: standardNames.filter((n) => /StackedPictures/.test(n)),
};
for (const [capability, names] of Object.entries(matched)) {
	const listed = STANDARD_CAPABILITY_ENTRIES[capability as keyof typeof matched];
	check(
		`8. STANDARD_CAPABILITY_ENTRIES.${capability} = the standard entries the old regex matched`,
		json([...listed].sort()) === json([...names].sort()),
		`listed [${listed}] matched [${names}]`,
	);
}

/** The Book-of default config with a pots overlay preset merged in (and its Hold and Win bonus). */
const bookOfWith = (preset: PotsOverlayPresetId): GameConfigDoc => {
	const host = gameConfigDefaultFor('bookOf');
	if (!host) throw new Error('no bookOf default config');
	const { potsOverlay, tokens, holdAndWin } = potsOverlayPreset(preset);
	const bonus = holdAndWin ? holdAndWinBonus(holdAndWin, host) : undefined;
	const doc = normalizeGameConfigDoc({
		...host,
		symbols: { ...host.symbols, ...tokens, ...bonus?.symbols },
		paddingReels: { ...host.paddingReels, ...bonus?.paddingReels },
		potsOverlay,
		...(bonus ? { holdAndWin: bonus.holdAndWin } : {}),
	});
	if (!doc) throw new Error(`bookOf + ${preset} does not normalize`);
	return doc;
};
const bookOfScenes = engineOwnedOnly(getFullSceneSet('bookOf')!).scenes;
const at0 = { x: 0, y: 0 };
const int = (value: number) => ({ kind: 'literal' as const, type: { t: 'int' as const }, value });
const text = (value: string) => ({
	kind: 'literal' as const,
	type: { t: 'string' as const },
	value,
});

const overlayAddOns = flowAddOnsOf(bookOfWith('potsToFreeSpins'));
const pot = overlayAddOns.meters[0];
check(
	'9. bookOf + potsToFreeSpins: the overlay block, no Hold and Win block, one pot',
	overlayAddOns.potsOverlay && !overlayAddOns.holdAndWin && overlayAddOns.meters.length === 1,
	json(overlayAddOns),
);
const overlaySeed = freshDrivenSeedDoc('bookOf');
const overlayNodes: Node[] = [
	{ id: 'gate_drop', kind: 'event', pos: at0, ref: 'overlayDrop' },
	{
		id: 'gate_fly',
		kind: 'action',
		pos: at0,
		ref: 'flyTo',
		inputs: { reel: int(0), row: int(0), target: text(`meter:${pot}`) },
	},
	{
		id: 'gate_branch',
		kind: 'branch',
		pos: at0,
		guard: {
			all: [
				{
					left: { kind: 'accessor', path: { on: 'engine', key: `meter.${pot}.level` } },
					op: 'gte',
					right: int(3),
				},
			],
		},
	},
	{ id: 'gate_full', kind: 'fireCue', pos: at0, ref: 'potFull', inputs: { meter: text(pot) } },
	// A guard's inline operands are not pins, so the meter read the validator checks is a pin's: a
	// delay's `ms` (the int-typed pin every vocabulary has).
	{
		id: 'gate_wait',
		kind: 'delay',
		pos: at0,
		inputs: { ms: { kind: 'accessor', path: { on: 'engine', key: `meter.${pot}.level` } } },
	},
	{ id: 'gate_fill_on', kind: 'event', pos: at0, ref: 'meterUpdate' },
	{
		id: 'gate_fill',
		kind: 'action',
		pos: at0,
		ref: 'fillMeter',
		inputs: { bookEvent: { kind: 'accessor', path: { on: 'trigger' } } },
	},
];
const overlayFlow: FlowDoc = {
	...overlaySeed,
	graph: {
		nodes: [...overlaySeed.graph.nodes, ...overlayNodes],
		exec: [
			...overlaySeed.graph.exec,
			{ from: { node: 'gate_drop', pin: 'exec' }, to: { node: 'gate_fly', pin: 'exec' } },
			{ from: { node: 'gate_fly', pin: 'exec' }, to: { node: 'gate_branch', pin: 'exec' } },
			{ from: { node: 'gate_branch', pin: 'then' }, to: { node: 'gate_full', pin: 'exec' } },
			{ from: { node: 'gate_full', pin: 'exec' }, to: { node: 'gate_wait', pin: 'exec' } },
			{ from: { node: 'gate_fill_on', pin: 'exec' }, to: { node: 'gate_fill', pin: 'exec' } },
		],
		data: overlaySeed.graph.data,
	},
};
const overlayWith = errorsOf(
	validateFlowV2Against(overlayFlow, bookOfScenes, null, EMPTY_LIBRARY, [], overlayAddOns),
);
check(
	'9. bookOf + overlay: the overlay chain publishes clean',
	!overlayWith.length,
	describe(overlayWith),
);
const overlayWithout = validateFlowV2Against(overlayFlow, bookOfScenes, null, EMPTY_LIBRARY);
const unresolved = (issues: FlowIssue[], ref: string, severity: FlowIssue['severity']): boolean =>
	issues.some(
		(i) => i.code === 'ref-unresolved' && i.severity === severity && i.message.includes(`'${ref}'`),
	);
check(
	'9. …and is refused without the add-ons: its actions, cue and meter read are errors',
	['flyTo', 'potFull', 'fillMeter'].every((ref) => unresolved(overlayWithout, ref, 'error')) &&
		overlayWithout.some(
			(i) =>
				i.code === 'accessor-unresolved' &&
				i.severity === 'error' &&
				i.message.includes(`meter.${pot}.level`),
		),
	describe(overlayWithout),
);
check(
	'9. …and its overlay events unknown (an event ref is open, so a warning)',
	['overlayDrop', 'meterUpdate'].every((ref) => unresolved(overlayWithout, ref, 'warning')),
	describe(overlayWithout),
);

const bonusConfig = bookOfWith('threePots');
const bonusAddOns = flowAddOnsOf(bonusConfig);
check(
	'10. bookOf + threePots: both blocks, its three pots',
	bonusAddOns.holdAndWin && bonusAddOns.potsOverlay && bonusAddOns.meters.length === 3,
	json(bonusAddOns),
);
const bookOfSeed = freshDrivenSeedDoc('bookOf');
const grafted = graftAddOnSteps(bookOfSeed, bonusAddOns);
check(
	'10. the graft adds the pot-filling beat and the Hold and Win tab',
	grafted.added.includes('meterUpdate') &&
		grafted.added.includes('modes.holdAndWin') &&
		Boolean(grafted.doc.modes?.holdAndWin),
	json(grafted.added),
);
const graftedClean = errorsOf(
	validateFlowV2Against(grafted.doc, bookOfScenes, null, EMPTY_LIBRARY, [], bonusAddOns),
);
check(
	'10. the grafted Book-of starter passes against the Book-of scaffold scenes',
	!graftedClean.length,
	describe(graftedClean),
);
const holdAndWinScenes = engineOwnedOnly(getFullSceneSet('holdAndWin')!).scenes;
const modeScreens = new Set(
	grafted.doc.containers
		.filter((c) => !bookOfSeed.containers.some((b) => b.id === c.id))
		.map((c) => c.id),
);
const withModeScenes = [...bookOfScenes, ...holdAndWinScenes.filter((s) => modeScreens.has(s.id))];
check(
	'10. …and with the Hold and Win mode screens added (each declared container has its scene)',
	modeScreens.size > 0 && [...modeScreens].every((id) => withModeScenes.some((s) => s.id === id)),
	[...modeScreens].join(),
);
const graftedWithScenes = errorsOf(
	validateFlowV2Against(grafted.doc, withModeScenes, null, EMPTY_LIBRARY, [], bonusAddOns),
);
check('10. …which pass the gate too', !graftedWithScenes.length, describe(graftedWithScenes));
const bonusWithout = errorsOf(
	validateFlowV2Against(grafted.doc, bookOfScenes, null, EMPTY_LIBRARY),
);
check(
	'10. without the add-ons its holdAndWinTrigger pin and showRespinBoard action are refused',
	unresolved(bonusWithout, 'showRespinBoard', 'error') &&
		bonusWithout.some(
			(i) => i.code === 'edge-endpoint' && i.message.includes('.holdAndWinTrigger →'),
		),
	describe(bonusWithout),
);

const NONE: FlowAddOns = flowAddOnsOf(null);
const docIds = (doc: FlowDoc): string[] => [
	...doc.graph.nodes.map((n) => n.id),
	...Object.values(doc.modes ?? {}).flatMap((m) => m.graph.nodes.map((n) => n.id)),
];
const before = json(bookOfSeed);
const once = graftAddOnSteps(bookOfSeed, bonusAddOns);
check('11. the input is not mutated', json(bookOfSeed) === before);
check(
	'11. every authored node and wire is kept byte-identical, in order',
	json(once.doc.graph.nodes.slice(0, bookOfSeed.graph.nodes.length)) ===
		json(bookOfSeed.graph.nodes) &&
		json(once.doc.graph.exec.slice(0, bookOfSeed.graph.exec.length)) ===
			json(bookOfSeed.graph.exec) &&
		json(once.doc.graph.data.slice(0, bookOfSeed.graph.data.length)) ===
			json(bookOfSeed.graph.data) &&
		json(once.doc.containers.slice(0, bookOfSeed.containers.length)) ===
			json(bookOfSeed.containers),
);
const twice = graftAddOnSteps(once.doc, bonusAddOns);
check('11. grafting twice = grafting once', twice.doc === once.doc && !twice.added.length);
const ids = docIds(once.doc);
check('11. no id collides', new Set(ids).size === ids.length);
const graftedOn = (doc: FlowDoc, event: string, action: string): boolean => {
	const node = doc.graph.nodes.find((n) => n.kind === 'event' && n.ref === event);
	const next = doc.graph.exec.find((e) => e.from.node === node?.id);
	return doc.graph.nodes.some(
		(n) => n.id === next?.to.node && n.kind === 'action' && n.ref === action,
	);
};
check(
	'11. overlayDrop is grafted onto its coded beat, showTokens; meterUpdate onto fillMeter',
	graftedOn(once.doc, 'overlayDrop', 'showTokens') &&
		graftedOn(once.doc, 'meterUpdate', 'fillMeter'),
	json(once.added),
);
check(
	'11. the grafted Hold and Win tab is the Hold and Win starter flow’s',
	json(once.doc.modes?.holdAndWin) === json(HOLD_AND_WIN_DRIVEN_SEED_DOC.modes?.holdAndWin),
);
const newX = once.doc.graph.nodes.slice(bookOfSeed.graph.nodes.length).map((n) => n.pos.x);
check(
	'11. the new nodes sit right of every authored one',
	newX.length > 0 && Math.min(...newX) > Math.max(...bookOfSeed.graph.nodes.map((n) => n.pos.x)),
);
const authoredMode: FlowDoc = {
	...bookOfSeed,
	modes: {
		holdAndWin: {
			graph: {
				nodes: [{ id: 'hw_enter', kind: 'modeTrigger', pos: at0, modeId: 'holdAndWin' }],
				exec: [],
				data: [],
			},
		},
	},
};
const keptMode = graftAddOnSteps(authoredMode, bonusAddOns);
check(
	'11. an existing modes.holdAndWin is left alone (and no container is added for it)',
	keptMode.doc.modes?.holdAndWin === authoredMode.modes?.holdAndWin &&
		!keptMode.added.includes('modes.holdAndWin') &&
		keptMode.doc.containers === authoredMode.containers,
	json(keptMode.added),
);
const clashing: FlowDoc = {
	...bookOfSeed,
	graph: {
		...bookOfSeed.graph,
		nodes: [
			...bookOfSeed.graph.nodes,
			{ id: 'overlay_on_x', kind: 'delay', pos: at0 },
			{ id: 'hw_taken', kind: 'delay', pos: at0 },
		],
	},
};
const reprefixed = graftAddOnSteps(clashing, bonusAddOns);
const reprefixedIds = docIds(reprefixed.doc);
check(
	'11. a doc already using the overlay_ / hw_ prefixes gets fresh ones, with no collision',
	new Set(reprefixedIds).size === reprefixedIds.length &&
		reprefixed.doc.graph.nodes.some((n) => n.id.startsWith('overlay2_')) &&
		(reprefixed.doc.modes?.holdAndWin?.graph.nodes ?? []).every((n) => n.id.startsWith('hw2_')),
);
const handled = graftAddOnSteps(overlayFlow, overlayAddOns);
check(
	'11. an event the doc already handles gets no second handler (nothing to add ⇒ the same doc)',
	handled.doc === overlayFlow && !handled.added.length,
	json(handled.added),
);
for (const kind of Object.keys(RESOLVES_TO)) {
	const seedDoc = freshDrivenSeedDoc(kind);
	const graft = graftAddOnSteps(seedDoc, NONE);
	check(
		`11. ${kind}: no block ⇒ the graft is a no-op`,
		graft.doc === seedDoc && !graft.added.length,
	);
}
const holdAndWinSeed = freshDrivenSeedDoc('holdAndWin');
const holdAndWinOverlay = graftAddOnSteps(holdAndWinSeed, {
	...holdAndWinAddOns,
	potsOverlay: true,
});
check(
	'11. the Hold and Win starter flow has nothing to graft but, with the overlay, the drop’s beat',
	graftAddOnSteps(holdAndWinSeed, holdAndWinAddOns).doc === holdAndWinSeed &&
		json(holdAndWinOverlay.added) === json(['overlayDrop']) &&
		graftedOn(holdAndWinOverlay.doc, 'overlayDrop', 'showTokens'),
	json(holdAndWinOverlay.added),
);
check(
	'11. signalChainCallsAction: a chain reaches its own beat, not another chain’s',
	signalChainCallsAction(once.doc, undefined, 'overlayDrop', 'showTokens') &&
		signalChainCallsAction(once.doc, undefined, 'meterUpdate', 'fillMeter') &&
		!signalChainCallsAction(once.doc, undefined, 'meterUpdate', 'showTokens') &&
		!signalChainCallsAction(once.doc, undefined, 'freeSpinTrigger', 'drainPots'),
);
const drainedEntry: FlowDoc = {
	...once.doc,
	graph: {
		nodes: [
			...once.doc.graph.nodes,
			{ id: 'x_on_fs', kind: 'event', pos: at0, ref: 'freeSpinTrigger' },
			{ id: 'x_drain', kind: 'action', pos: at0, ref: 'drainPots' },
		],
		exec: [
			...once.doc.graph.exec,
			{ from: { node: 'x_on_fs', pin: 'exec' }, to: { node: 'x_drain', pin: 'exec' } },
		],
		data: once.doc.graph.data,
	},
};
check(
	'11. …an owned entry with drainPots on its chain drains itself; a mode graph that handles the signal is the scope',
	signalChainCallsAction(drainedEntry, undefined, 'freeSpinTrigger', 'drainPots') &&
		!signalChainCallsAction(
			{
				...drainedEntry,
				modes: {
					freeSpins: {
						graph: {
							nodes: [{ id: 'm_on_fs', kind: 'event', pos: at0, ref: 'freeSpinTrigger' }],
							exec: [],
							data: [],
						},
					},
				},
			},
			'freeSpins',
			'freeSpinTrigger',
			'drainPots',
		),
);

const named = (t: TypeRef, into: { structs: Set<string>; enums: Set<string> }): void => {
	if (t.t === 'list') named(t.of, into);
	else if (t.t === 'struct') into.structs.add(t.name);
	else if (t.t === 'enum') into.enums.add(t.name);
};
const wellFormedIssues = (vocab: TemplateVocabulary): string[] => {
	const refs = { structs: new Set<string>(), enums: new Set<string>() };
	for (const s of vocab.structs) for (const f of s.fields) named(f.type, refs);
	for (const e of vocab.events) for (const p of e.payload) named(p.type, refs);
	for (const a of vocab.actions) for (const p of a.params) named(p.type, refs);
	for (const c of vocab.cues) for (const p of c.payload) named(p.type, refs);
	for (const v of vocab.values) named(v.type, refs);
	for (const c of vocab.collections) named(c.of, refs);
	const structs = new Set(vocab.structs.map((s) => s.name));
	const enums = new Set(vocab.enums.map((e) => e.name));
	const dupes = (names: string[]) => names.filter((n, i) => names.indexOf(n) !== i);
	return [
		...[...refs.structs].filter((n) => !structs.has(n)).map((n) => `struct ${n} undeclared`),
		...[...refs.enums].filter((n) => !enums.has(n)).map((n) => `enum ${n} undeclared`),
		...Object.entries({
			structs: vocab.structs,
			enums: vocab.enums,
			events: vocab.events,
			actions: vocab.actions,
			cues: vocab.cues,
			values: vocab.values,
			collections: vocab.collections,
		}).flatMap(([list, entries]) =>
			dupes(entries.map((e) => e.name)).map((n) => `${list}: ${n} twice`),
		),
	];
};
const COMBOS: Record<string, FlowAddOns> = {
	'Hold and Win': { holdAndWin: true },
	overlay: { potsOverlay: true, meters: ['red', 'gold'] },
	both: bonusAddOns,
};
for (const kind of Object.keys(RESOLVES_TO)) {
	for (const [label, addOns] of Object.entries(COMBOS)) {
		const vocab = withAddOns(templateVocabulary(kind), addOns);
		const issues = wellFormedIssues(vocab);
		check(
			`12. ${kind} + ${label}: every type resolves, no name twice`,
			!issues.length,
			issues.join(),
		);
		const base = templateVocabulary(kind);
		check(
			`12. ${kind} + ${label}: the kind's own entries are kept, in order`,
			json(vocab.events.filter((e) => base.events.some((b) => b.name === e.name))) ===
				json(base.events) &&
				json(vocab.actions.slice(0, base.actions.length)) === json(base.actions) &&
				json(vocab.values.slice(0, base.values.length)) === json(base.values),
		);
	}
}
const overlayVocab = withAddOns(templateVocabulary('bookOf'), COMBOS.overlay);
check(
	'12. the overlay adds meter.<id>.level|max|stage|full for each pot, overlayDrop after reveal',
	['red', 'gold'].every((id) =>
		['level', 'max', 'stage', 'full'].every((k) =>
			overlayVocab.values.some((v) => v.name === `meter.${id}.${k}`),
		),
	) &&
		overlayVocab.events[overlayVocab.events.findIndex((e) => e.name === 'reveal') + 1]?.name ===
			'overlayDrop',
);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
if (fails) process.exitCode = 1;
