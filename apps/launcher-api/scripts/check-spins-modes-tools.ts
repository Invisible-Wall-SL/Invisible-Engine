/**
 * Contract check for bonus-games Phase 8c — a SPINS bonus mode (`GameModeDecl.spins`, Phase 8a) in the
 * authoring tools and the info page:
 *   pnpm --filter launcher-api check:spins-modes-tools
 *
 * Over a lines host with a WAYS, a CLUSTER and a LINES spins mode (`spinsGame.sample.ts`), one symbol
 * dealt only by the ways mode, it pins, on the REAL modules:
 *  1. Scene Editor: each mode gets its own free-spin intro, counter and outro (`-<modeId>`, tagged
 *     `role: 'mode'` + `modeId`), right after the screen each copies; no scene or node id twice; "Add
 *     missing screens" / "＋ Add overlay screens" offer them; In-game view shows a mode's counter and
 *     not its beat screens; the game reserves every copy (`reservedModeCopies`) and draws the active
 *     mode's counter (`modeScreenFor`); each mode's board preview is its own grid.
 *  2. Flow v2: the add-ons list the spins modes; the graft gives each a tab presenting its free spins
 *     on its own screens (distinct node ids, a Mode trigger pair for its own mode in a driven flow,
 *     none in a flow that does not drive screens); the result publishes clean and warning free; a
 *     second graft adds nothing; the tab is offered the reels vocabulary; the runtime runs its graph
 *     while the mode is on the stack; the global graph and a respin tab are untouched.
 *  3. Win Text: a spins mode's win-line message and win-tier captions (`modes[<id>]`) save, resolve
 *     over the base game's, are harvested for Localization under its own section, and are what the
 *     game's `boardWinText` reads while the mode is on top.
 *  4. `/symbols`: the symbol only the ways mode deals is listed with that mode; nothing else is.
 *  5. Info page: while a mode is on top, the paytable is its game's (its own pays, its strips'
 *     symbols), and its paylines and grid; off it, the base game's, identical to an unbound config.
 *  6. Every current doc (the `hw-*` presets, the plain Hold and Win templates, `borut-pots-sample`,
 *     lines / ways / cluster / free spins, the overlay presets): scene set, add-on screens, Flow
 *     add-ons, grafted seed and verdict, Win Text, Localization, `/symbols` and info data are
 *     byte-identical to `main` (`MAIN_DIGESTS`, measured by `scripts/lib/spinsToolsFacts.ts` on main
 *     4067dfb); its `/symbols` lists no spins mode and its Flow add-ons carry no `spinsModes`.
 *
 * `--print` prints the current docs' digests instead of checking them.
 */

import { readFileSync } from 'node:fs';
import {
	flowModeGraph,
	flowOwnsSignal,
	freshDrivenSeedDoc,
	graftAddOnSteps,
	RESPIN_FEATURE_EVENTS,
	signalChainCallsAction,
	templateVocabulary,
	vocabForTab,
	withAddOns,
	type FlowDoc,
	type FlowIssue,
	type Graph,
} from 'engine-flow-v2';
import {
	addOnSceneIds,
	getFullSceneSet,
	inGameViewSceneIds,
	mergeMissingScreens,
	resolveWinText,
	resolveWinTextForMode,
	SPINS_MODE_SCREENS,
	type LayoutNode,
	type WinTextDoc,
} from 'engine-layout';
import {
	flowAddOnsOf,
	gameTypeForMode,
	resolveGrid,
	shownPaytable,
	spinsGameView,
	symbolsInPlayForGameType,
	type GameConfigDoc,
} from 'game-config';
import { compileSlice, stripSliceTypes } from '../../../scripts/lib/compile-slice.mjs';
import { createGameConfig } from '../../../packages/engine-game/src/game/gameConfig.ts';
import {
	CLUSTER_BONUS,
	LINES_BONUS,
	WAYS_BONUS,
	withSpinsModes,
} from '../../../packages/game-config/spinsGame.sample.ts';
import { modeScreenFor, reservedModeCopies } from '../../lines/src/game/respinModes.ts';
import { sceneSetOptionsFor, spinsModeDecls } from '../src/lib/addOns.ts';
import { validateFlowV2Against } from '../src/lib/server/flowV2Validation.ts';
import { gameConfigDefaultFor } from '../src/lib/server/gameConfigDefaults.ts';
import { harvestProjectWinText } from '../src/lib/server/localizationHarvest.ts';
import { symbolDefaultsFor } from '../src/lib/server/symbolDefaults.ts';
import { symbolsPageConfig } from '../src/lib/server/symbolsPageConfig.ts';
import { normalizeWinTextDoc } from '../src/lib/server/winTextStorage.ts';
import { winTextSpinsModes } from '../src/lib/winTextModes.ts';
import {
	currentDocs,
	EMPTY_LIBRARY,
	factsOf,
	normalize,
	scenesFor,
	withOverlay,
} from './lib/spinsToolsFacts.ts';

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
const errorsOf = (issues: FlowIssue[]) => issues.filter((i) => i.severity === 'error');
const describe = (issues: FlowIssue[]) => issues.map((i) => `${i.code}: ${i.message}`).join(' | ');
const duplicates = (list: string[]) => list.filter((id, at) => list.indexOf(id) !== at);

const MODES = [WAYS_BONUS, CLUSTER_BONUS, LINES_BONUS];
/** A symbol only the ways mode's strips deal. */
const WAYS_ONLY = 'WB';

/** The lines host: the sample's three spins modes, plus `WAYS_ONLY` on every 4th ways-strip cell. */
const hostOf = (kind: string): GameConfigDoc => {
	const raw = withSpinsModes(structuredClone(gameConfigDefaultFor(kind)!));
	const pays = Object.values(raw.symbols).find((s) => s.paytable?.length)!.paytable;
	raw.symbols[WAYS_ONLY] = { paytable: structuredClone(pays) };
	raw.paddingReels[WAYS_BONUS] = raw.paddingReels[WAYS_BONUS].map((strip) =>
		strip.map((cell, i) => (i % 4 === 0 ? { name: WAYS_ONLY } : cell)),
	);
	return normalize(raw);
};
const host = hostOf('lines');

const nodeIds = (nodes: readonly LayoutNode[]): string[] =>
	nodes.flatMap((n) => [n.id, ...(n.kind === 'container' ? nodeIds(n.children) : [])]);

// ── 1. Scene Editor ───────────────────────────────────────────────────────────────────────────────
const options = sceneSetOptionsFor('lines', host);
same(
	'1. the scene-set options name every spins mode',
	options.spinsModes,
	MODES.map((id) => ({ id, label: spinsModeDecls(host).find((m) => m.id === id)!.label })),
);
const set = getFullSceneSet('lines', options)!;
const base = getFullSceneSet('lines')!;
for (const mode of MODES) {
	for (const screen of SPINS_MODE_SCREENS) {
		const id = `${screen}-${mode}`;
		const at = set.scenes.findIndex((s) => s.id === id);
		const copy = set.scenes[at];
		check(`1. ${mode} · has its own ${screen}`, at >= 0);
		if (!copy) continue;
		check(
			`1. ${mode} · ${screen} is tagged with its mode`,
			copy.role === 'mode' && copy.modeId === mode,
		);
		const source = base.scenes.find((s) => s.id === screen)!;
		same(
			`1. ${mode} · ${screen}'s nodes are the reference's, suffixed with the mode`,
			nodeIds(copy.nodes),
			nodeIds(source.nodes).map((n) => `${n}-${mode}`),
		);
		const before = set.scenes.slice(0, at).map((s) => s.id);
		check(
			`1. ${mode} · ${screen} follows the screen it copies`,
			before.includes(screen) &&
				before.slice(before.indexOf(screen) + 1).every((s) => s.startsWith(`${screen}-`)),
			json(before.slice(-4)),
		);
	}
}
same('1. no scene id twice', duplicates(set.scenes.map((s) => s.id)), []);
same('1. no node id twice', duplicates(set.scenes.flatMap((s) => nodeIds(s.nodes))), []);
same(
	'1. with the copies taken out, the set is the kind’s own',
	set.scenes.filter((s) => s.role !== 'mode'),
	base.scenes,
);
const copyIds = set.scenes.filter((s) => s.role === 'mode').map((s) => s.id);
same('1. "＋ Add overlay screens" offers every copy', addOnSceneIds('lines', options), copyIds);
const topped = mergeMissingScreens(base.scenes, set.scenes, copyIds);
same('1. "Add missing screens" seeds the copies into an existing layout', topped, set.scenes);
same('1. …and a second run adds nothing', mergeMissingScreens(topped, set.scenes, copyIds), topped);
for (const kind of ['ways', 'cluster']) {
	const kindSet = getFullSceneSet(kind, sceneSetOptionsFor(kind, hostOf(kind)))!;
	same(
		`1. a ${kind} host · every mode gets its three screens`,
		kindSet.scenes.filter((s) => s.role === 'mode').length,
		MODES.length * SPINS_MODE_SCREENS.length,
	);
}
const view = inGameViewSceneIds(set.scenes, undefined, WAYS_BONUS);
check(
	'1. In-game view of the ways mode · its counter, not its intro or outro',
	view.has(`freeSpinCounter-${WAYS_BONUS}`) &&
		!view.has(`freeSpinIntro-${WAYS_BONUS}`) &&
		!view.has(`freeSpinOutro-${WAYS_BONUS}`) &&
		!view.has(`freeSpinCounter-${CLUSTER_BONUS}`),
	json([...view]),
);
check(
	'1. In-game view of the base game · no mode copy',
	copyIds.every((id) => !inGameViewSceneIds(set.scenes, undefined).has(id)),
);
const RESERVED = new Set(['freeSpinIntro', 'freeSpinCounter', 'freeSpinOutro', 'featureIntro']);
const spinsIds = new Set(MODES);
same(
	'1. the game reserves every copy, so none mounts as an always-on overlay',
	reservedModeCopies(set.scenes, (id) => id !== undefined && spinsIds.has(id), RESERVED),
	copyIds,
);
same(
	'1. …and a mode the game does not know reserves nothing',
	reservedModeCopies(set.scenes, () => false, RESERVED),
	[],
);
same(
	'1. the coded counter draws the ways mode’s own while it is on top',
	modeScreenFor(set.scenes, WAYS_BONUS, 'freeSpinCounter'),
	`freeSpinCounter-${WAYS_BONUS}`,
);
same(
	'1. …and the base game’s with no spins mode on top',
	modeScreenFor(set.scenes, undefined, 'freeSpinCounter'),
	'freeSpinCounter',
);
for (const [mode, reels, rows] of [
	[WAYS_BONUS, 6, 4],
	[CLUSTER_BONUS, 7, 7],
	[LINES_BONUS, 4, 3],
] as const) {
	const decl = spinsModeDecls(host).find((m) => m.id === mode)!;
	const grid = resolveGrid(spinsGameView(host, decl.spins));
	same(`1. ${mode} · its board preview is its own grid`, [grid.reels, grid.maxRows], [reels, rows]);
}

// ── 2. Flow v2 ────────────────────────────────────────────────────────────────────────────────────
const addOns = flowAddOnsOf(host);
same('2. the add-ons list the spins modes', addOns.spinsModes, MODES);
check('2. …and no respin feature', !addOns.holdAndWin && addOns.respinModes === undefined);
const scenes = scenesFor('lines', host);
const sceneIds = new Set(scenes.map((s) => s.id));
const seed = freshDrivenSeedDoc('lines');
const grafted = graftAddOnSteps(seed, addOns);
same(
	'2. the graft adds a tab per spins mode',
	grafted.added.filter((a) => a.startsWith('modes.')),
	MODES.map((m) => `modes.${m}`),
);
same('2. the global graph is untouched', grafted.doc.graph, seed.graph);
const shownScreens = (graph: Graph): string[] => [
	...new Set(
		graph.nodes.flatMap((n) =>
			n.kind === 'showContainer' || n.kind === 'hideContainer' ? [n.ref] : [],
		),
	),
];
const modeTriggers = (graph: Graph): string[] =>
	graph.nodes.flatMap((n) => (n.kind === 'modeTrigger' ? [`${n.modeId}:${n.on}`] : []));
for (const mode of MODES) {
	const graph = grafted.doc.modes?.[mode]?.graph;
	if (!graph) {
		check(`2. ${mode} · has a tab`, false);
		continue;
	}
	check(
		`2. ${mode} · its tab presents the free spins`,
		['freeSpinTrigger', 'updateFreeSpin', 'freeSpinEnd'].every((event) =>
			flowOwnsSignal(grafted.doc, event, mode),
		),
	);
	same(`2. ${mode} · its Mode triggers are its own`, modeTriggers(graph), [
		`${mode}:enter`,
		`${mode}:exit`,
	]);
	const screens = shownScreens(graph);
	same(
		`2. ${mode} · it shows its own intro, counter and outro, and swaps the base counter`,
		[...screens].sort(),
		[...SPINS_MODE_SCREENS.map((s) => `${s}-${mode}`), 'freeSpinCounter'].sort(),
	);
	check(
		`2. ${mode} · every screen it shows is in the scene set, declared as a container`,
		screens.every(
			(id) =>
				sceneIds.has(id) && grafted.doc.containers.some((c) => c.id === id && c.sceneId === id),
		),
	);
	const awaited = graph.nodes.flatMap((n) =>
		n.kind === 'showContainer' && n.awaitComplete ? [n.ref] : [],
	);
	same(`2. ${mode} · its intro and outro hold the round on a tap`, awaited, [
		`freeSpinIntro-${mode}`,
		`freeSpinOutro-${mode}`,
	]);
	check(
		`2. ${mode} · on the stack, its tab is the mode graph`,
		flowModeGraph(grafted.doc, mode) === graph,
	);
	check(
		`2. ${mode} · its free-spin end counts the total up`,
		signalChainCallsAction(grafted.doc, mode, 'freeSpinEnd', 'freeSpinOutroCountUp'),
	);
}
const allIds = [
	...grafted.doc.graph.nodes.map((n) => n.id),
	...Object.values(grafted.doc.modes ?? {}).flatMap((m) => m.graph.nodes.map((n) => n.id)),
];
same('2. no node id twice across the doc', duplicates(allIds), []);
check(
	"2. the host's own free spins still play off the global graph",
	flowModeGraph(grafted.doc, 'freeSpins') === undefined &&
		flowOwnsSignal(grafted.doc, 'freeSpinTrigger', 'freeSpins'),
);
const verdict = validateFlowV2Against(grafted.doc, scenes, null, EMPTY_LIBRARY, [], addOns);
check('2. the flow publishes clean', !errorsOf(verdict).length, describe(errorsOf(verdict)));
same('2. …warning free', describe(verdict), '');
same('2. a second graft adds nothing', graftAddOnSteps(grafted.doc, addOns).added, []);
const vocab = withAddOns(templateVocabulary(seed.templateId), addOns);
const tabEvents = vocabForTab(vocab, WAYS_BONUS, addOns).events.map((e) => e.name);
check(
	'2. a spins tab is offered the free-spin events and no respin feature event',
	['freeSpinTrigger', 'updateFreeSpin', 'freeSpinEnd', 'reveal'].every((e) =>
		tabEvents.includes(e),
	) && RESPIN_FEATURE_EVENTS.every((e) => !tabEvents.includes(e)),
);
const coded: FlowDoc = {
	version: 2,
	templateId: seed.templateId,
	graph: { nodes: [], exec: [], data: [] },
	containers: [],
};
const codedGraft = graftAddOnSteps(coded, addOns);
check(
	'2. a flow that does not drive the screens · no counter swap and no Mode trigger',
	MODES.every((mode) => {
		const graph = codedGraft.doc.modes?.[mode]?.graph;
		return (
			graph !== undefined &&
			modeTriggers(graph).length === 0 &&
			!shownScreens(graph).includes('freeSpinCounter') &&
			!shownScreens(graph).includes(`freeSpinCounter-${mode}`)
		);
	}),
);
const codedVerdict = validateFlowV2Against(codedGraft.doc, scenes, null, EMPTY_LIBRARY, [], addOns);
check('2. …and publishes clean', !errorsOf(codedVerdict).length, describe(errorsOf(codedVerdict)));
{
	// A respin mode's tab beside the spins modes is the one the respin graft always seeded.
	const both = withOverlay(host, 'threePots');
	const bothAddOns = flowAddOnsOf(both);
	const respinOnly = graftAddOnSteps(seed, { ...bothAddOns, spinsModes: undefined }).doc;
	const withSpins = graftAddOnSteps(seed, bothAddOns).doc;
	same(
		'2. a pots overlay beside them · the global graph is the overlay graft’s alone',
		withSpins.graph,
		respinOnly.graph,
	);
}
for (const kind of ['ways', 'cluster']) {
	const kindHost = hostOf(kind);
	const kindAddOns = flowAddOnsOf(kindHost);
	const kindGraft = graftAddOnSteps(freshDrivenSeedDoc(kind), kindAddOns);
	const kindVerdict = validateFlowV2Against(
		kindGraft.doc,
		scenesFor(kind, kindHost),
		null,
		EMPTY_LIBRARY,
		[],
		kindAddOns,
	);
	same(`2. a ${kind} host · publishes clean and warning free`, describe(kindVerdict), '');
}

// ── 3. Win Text ───────────────────────────────────────────────────────────────────────────────────
const authored: WinTextDoc = {
	version: 1,
	lineMessage: { default: '{count} {symbolName}', byCount: { '5': 'FIVE!' } },
	winLevels: { big: 'BIG WIN' },
	modes: {
		[WAYS_BONUS]: {
			lineMessage: { default: '{count} WAYS', bySymbol: { [WAYS_ONLY]: 'BONUS SYMBOL' } },
			winLevels: { mega: 'MEGA WAYS' },
		},
	},
};
const saved = normalizeWinTextDoc(JSON.parse(JSON.stringify(authored)), 'reject');
same("3. a spins mode's lines save as written", saved.modes, authored.modes);
same(
	'3. blank lines inside a spins mode are pruned on save',
	normalizeWinTextDoc({ version: 1, modes: { [CLUSTER_BONUS]: { lineMessage: { default: ' ' } } } })
		.modes,
	undefined,
);
const ways = resolveWinTextForMode(saved, WAYS_BONUS);
same('3. the ways mode speaks its own default', ways.lineMessage.default, '{count} WAYS');
same(
	"3. …its own symbol line, over the base game's count line",
	[ways.lineMessage.bySymbol[WAYS_ONLY], ways.lineMessage.byCount['5']],
	['BONUS SYMBOL', 'FIVE!'],
);
same(
	"3. …its own tier caption, the base game's for the rest",
	[ways.winLevels.mega, ways.winLevels.big],
	['MEGA WAYS', 'BIG WIN'],
);
same(
	"3. a spins mode that wrote nothing speaks the base game's lines",
	resolveWinTextForMode(saved, CLUSTER_BONUS),
	resolveWinText(saved),
);
same(
	'3. the base game never reads a mode’s lines',
	resolveWinTextForMode(saved, undefined),
	resolveWinText(saved),
);
same(
	'3. Win Text lists the spins modes',
	winTextSpinsModes(host).map((m) => m.mode),
	MODES,
);
const harvest = harvestProjectWinText(saved, 'lines', host);
const waysSection = harvest.find((s) => s.sceneId === `__winText:${WAYS_BONUS}`);
same(
	'3. Localization harvests the ways mode’s own lines under its own section',
	waysSection?.items.map((i) => i.source),
	['{count} WAYS', 'BONUS SYMBOL', 'MEGA WAYS'],
);
check(
	'3. …and none for a mode that wrote nothing',
	!harvest.some((s) => s.sceneId === `__winText:${CLUSTER_BONUS}`),
);
{
	const text = readFileSync(
		new URL('../../lines/src/game/boardWinText.ts', import.meta.url),
		'utf8',
	);
	const from = text.indexOf('export const boardWinText');
	const slice = text.slice(from, text.indexOf(';\n', from) + 2);
	const board = compileSlice({
		what: 'check-spins-modes-tools#boardWinText',
		names: ['bakedWinTextFor', 'activeSpinsGame'],
		body: `${stripSliceTypes('boardWinText.ts', slice).replace('export const', 'const')}
return boardWinText;`,
	});
	let onTop: string | undefined;
	const read = board(
		(mode: string | undefined) => resolveWinTextForMode(saved, mode),
		() => (onTop ? { mode: onTop } : undefined),
	) as () => ReturnType<typeof resolveWinText>;
	same(
		'3. the game reads the base game’s lines with no spins mode on top',
		read(),
		resolveWinText(saved),
	);
	onTop = WAYS_BONUS;
	same('3. …and the ways mode’s while it is on top', read(), ways);
}

// ── 4. /symbols ───────────────────────────────────────────────────────────────────────────────────
const symbolsPage = (kind: string, doc: GameConfigDoc | null) =>
	symbolsPageConfig(kind, symbolDefaultsFor(kind), { doc, source: 'authored', etag: null });
const page = symbolsPage('lines', host);
same(
	'4. the symbol only the ways mode deals is listed with it, and nothing else is',
	page.spinsModes.map((m) => [m.id, m.symbols]),
	MODES.map((id) => [id, id === WAYS_BONUS ? [WAYS_ONLY] : []]),
);
check('4. …and it is a row of the grid', page.symbols.includes(WAYS_ONLY));
{
	const { spinsModes: _host, ...withMode } = page;
	const plain = structuredClone(host);
	plain.modes = plain.modes?.filter((m) => !m.spins);
	const { spinsModes: _plain, ...withoutMode } = symbolsPage('lines', normalize(plain));
	same(
		'4. the base game’s bindings are the same with or without the spins modes',
		withMode.defaults,
		withoutMode.defaults,
	);
}

// ── 5. Info page ──────────────────────────────────────────────────────────────────────────────────
{
	let mode = 'base';
	const config = createGameConfig<string>({ bakedConfig: () => host, compiledConfig: host });
	const unbound = createGameConfig<string>({ bakedConfig: () => host, compiledConfig: host });
	config.bindActiveMode(() => mode);
	const info = (c: typeof config) => {
		const { symbols, inPlay } = c.activePaytableInputs();
		return {
			paytable: shownPaytable(symbols, inPlay),
			paylines: c.getPaylines(),
			board: c.boardDimensions(),
			divisor: c.payoutDivisor(),
		};
	};
	same('5. the base game · the info page is an unbound config’s', info(config), info(unbound));
	for (const id of MODES) {
		mode = id;
		const decl = spinsModeDecls(host).find((m) => m.id === id)!;
		const view = spinsGameView(host, decl.spins);
		const { paytable, paylines, board } = info(config);
		same(
			`5. ${id} · its paytable is its game's`,
			paytable,
			shownPaytable(view.symbols, symbolsInPlayForGameType(host, gameTypeForMode(decl))),
		);
		same(`5. ${id} · its grid`, [board.x, board.y], [view.numReels, view.numRows[0]]);
		same(
			`5. ${id} · its paylines`,
			paylines,
			view.winModel.type === 'lines' ? Object.values(view.paylines) : [],
		);
	}
	mode = LINES_BONUS;
	const linesDeals = symbolsInPlayForGameType(host, LINES_BONUS);
	check(
		'5. the lines mode lists only the symbols its strips deal (the base game lists every strip’s)',
		info(config).paytable.every((e) => linesDeals.includes(e.on.of)) &&
			info(unbound).paytable.some((e) => !linesDeals.includes(e.on.of)),
		json(info(config).paytable.map((e) => e.on.of)),
	);
	mode = CLUSTER_BONUS;
	const clusterDecl = spinsModeDecls(host).find((m) => m.id === CLUSTER_BONUS)!;
	const [own] = Object.keys(clusterDecl.spins.paytable ?? {});
	check(
		'5. the cluster mode prices its symbol at its own pays',
		json(info(config).paytable.filter((e) => e.on.of === own)) !==
			json(info(unbound).paytable.filter((e) => e.on.of === own)),
	);
	mode = 'freeSpins';
	same('5. the host’s own free spins · the base game’s info page', info(config), info(unbound));
}

// ── 6. every current doc is byte-identical to main ────────────────────────────────────────────────
/** `scripts/lib/spinsToolsFacts.ts` run on `main` 4067dfb. */
const MAIN_DIGESTS: Record<string, string> = {
	'no config · scenes': '5a0b7dfbcec7837b',
	'no config · addOnScreens': '4f53cda18c2baa0c',
	'no config · flowAddOns': 'c82a3e2c9448acb7',
	'no config · flowSeed': 'a571a1fb1e6895f7',
	'no config · flowVerdict': '4f53cda18c2baa0c',
	'no config · winText': 'd7702fd33d2e0e46',
	'no config · localization': '910d4f60fea71f41',
	'no config · symbols': '287ce9ff1ca88a3e',
	'no config · info': 'none',
	'lines · scenes': '5a0b7dfbcec7837b',
	'lines · addOnScreens': '4f53cda18c2baa0c',
	'lines · flowAddOns': 'c82a3e2c9448acb7',
	'lines · flowSeed': 'a571a1fb1e6895f7',
	'lines · flowVerdict': '4f53cda18c2baa0c',
	'lines · winText': 'd7702fd33d2e0e46',
	'lines · localization': '910d4f60fea71f41',
	'lines · symbols': '1f9b9ca34d4acb51',
	'lines · info': 'ab6c09744b1dcb07',
	'ways · scenes': 'a916b41d79ac520a',
	'ways · addOnScreens': '4f53cda18c2baa0c',
	'ways · flowAddOns': 'c82a3e2c9448acb7',
	'ways · flowSeed': '0d54b15b673108ce',
	'ways · flowVerdict': '4f53cda18c2baa0c',
	'ways · winText': 'd7702fd33d2e0e46',
	'ways · localization': '910d4f60fea71f41',
	'ways · symbols': '3cd878ab29ab9cdd',
	'ways · info': 'aa778c2cbed9e088',
	'cluster · scenes': '856c7d6f4504389c',
	'cluster · addOnScreens': '4f53cda18c2baa0c',
	'cluster · flowAddOns': 'c82a3e2c9448acb7',
	'cluster · flowSeed': '71ee95a251217e62',
	'cluster · flowVerdict': '4f53cda18c2baa0c',
	'cluster · winText': 'd7702fd33d2e0e46',
	'cluster · localization': '910d4f60fea71f41',
	'cluster · symbols': '1f9b9ca34d4acb51',
	'cluster · info': 'ab6c09744b1dcb07',
	'free spins (bookOf) · scenes': 'd1d6f12eabc37c9c',
	'free spins (bookOf) · addOnScreens': '4f53cda18c2baa0c',
	'free spins (bookOf) · flowAddOns': 'c82a3e2c9448acb7',
	'free spins (bookOf) · flowSeed': 'a571a1fb1e6895f7',
	'free spins (bookOf) · flowVerdict': '4f53cda18c2baa0c',
	'free spins (bookOf) · winText': 'd7702fd33d2e0e46',
	'free spins (bookOf) · localization': '910d4f60fea71f41',
	'free spins (bookOf) · symbols': '1f9b9ca34d4acb51',
	'free spins (bookOf) · info': 'ab6c09744b1dcb07',
	'hw-pots-sample · scenes': '3f585158f5da883f',
	'hw-pots-sample · addOnScreens': '4f53cda18c2baa0c',
	'hw-pots-sample · flowAddOns': '47d859a780dca139',
	'hw-pots-sample · flowSeed': 'c09029ce6a948fa2',
	'hw-pots-sample · flowVerdict': '4f53cda18c2baa0c',
	'hw-pots-sample · winText': 'f01e624e4e437402',
	'hw-pots-sample · localization': 'e1af5a4c94404885',
	'hw-pots-sample · symbols': '333c5d71227cf220',
	'hw-pots-sample · info': 'cae6a00b6e230854',
	'hw-classic-sample · scenes': '3f585158f5da883f',
	'hw-classic-sample · addOnScreens': '4f53cda18c2baa0c',
	'hw-classic-sample · flowAddOns': 'c0786005d9874dcf',
	'hw-classic-sample · flowSeed': 'c09029ce6a948fa2',
	'hw-classic-sample · flowVerdict': '4f53cda18c2baa0c',
	'hw-classic-sample · winText': 'f01e624e4e437402',
	'hw-classic-sample · localization': '55e8b1ea7e16a11c',
	'hw-classic-sample · symbols': '70859bfeee97516e',
	'hw-classic-sample · info': 'd08f10e6392cd312',
	'hw-collector-sample · scenes': '3f585158f5da883f',
	'hw-collector-sample · addOnScreens': '4f53cda18c2baa0c',
	'hw-collector-sample · flowAddOns': 'c0786005d9874dcf',
	'hw-collector-sample · flowSeed': 'c09029ce6a948fa2',
	'hw-collector-sample · flowVerdict': '4f53cda18c2baa0c',
	'hw-collector-sample · winText': 'f01e624e4e437402',
	'hw-collector-sample · localization': '55e8b1ea7e16a11c',
	'hw-collector-sample · symbols': 'f87cb49b5a84e562',
	'hw-collector-sample · info': 'b87d6cd1a8b72def',
	'holdAndWin template on · scenes': '3f585158f5da883f',
	'holdAndWin template on · addOnScreens': '4f53cda18c2baa0c',
	'holdAndWin template on · flowAddOns': 'c0786005d9874dcf',
	'holdAndWin template on · flowSeed': 'c09029ce6a948fa2',
	'holdAndWin template on · flowVerdict': '4f53cda18c2baa0c',
	'holdAndWin template on · winText': 'f01e624e4e437402',
	'holdAndWin template on · localization': '55e8b1ea7e16a11c',
	'holdAndWin template on · symbols': 'b69c6a6c6073fb03',
	'holdAndWin template on · info': 'd08f10e6392cd312',
	'holdAndWin template off · scenes': '4a58cd7d021a568c',
	'holdAndWin template off · addOnScreens': '4f53cda18c2baa0c',
	'holdAndWin template off · flowAddOns': 'c0786005d9874dcf',
	'holdAndWin template off · flowSeed': 'c09029ce6a948fa2',
	'holdAndWin template off · flowVerdict': '95b24012b66a0c60',
	'holdAndWin template off · winText': 'f01e624e4e437402',
	'holdAndWin template off · localization': 'e2bd52ffe957d69d',
	'holdAndWin template off · symbols': '83531f42717efebb',
	'holdAndWin template off · info': 'd08f10e6392cd312',
	'lines + threePots · scenes': 'ca64769b355aa04a',
	'lines + threePots · addOnScreens': '9aba0deb50cd01c6',
	'lines + threePots · flowAddOns': '736bd31d149eeb2c',
	'lines + threePots · flowSeed': '67e6f4ef349c7344',
	'lines + threePots · flowVerdict': '4f53cda18c2baa0c',
	'lines + threePots · winText': 'f01e624e4e437402',
	'lines + threePots · localization': 'e1af5a4c94404885',
	'lines + threePots · symbols': '8b90e770972d7dcc',
	'lines + threePots · info': 'ab6c09744b1dcb07',
	'lines + potsToFreeSpins · scenes': 'a61971f5ef090085',
	'lines + potsToFreeSpins · addOnScreens': '2b53c1a74bdfcc68',
	'lines + potsToFreeSpins · flowAddOns': '69009a380719e624',
	'lines + potsToFreeSpins · flowSeed': '67e55bbe7f379fb5',
	'lines + potsToFreeSpins · flowVerdict': '4f53cda18c2baa0c',
	'lines + potsToFreeSpins · winText': 'd7702fd33d2e0e46',
	'lines + potsToFreeSpins · localization': '8626ab8d47f23d31',
	'lines + potsToFreeSpins · symbols': '44a7d9504f9fac69',
	'lines + potsToFreeSpins · info': 'ab6c09744b1dcb07',
	'borut-pots-sample · scenes': '5bb7bb3572227bc7',
	'borut-pots-sample · addOnScreens': '9aba0deb50cd01c6',
	'borut-pots-sample · flowAddOns': '736bd31d149eeb2c',
	'borut-pots-sample · flowSeed': '67e6f4ef349c7344',
	'borut-pots-sample · flowVerdict': '4f53cda18c2baa0c',
	'borut-pots-sample · winText': 'f01e624e4e437402',
	'borut-pots-sample · localization': 'e1af5a4c94404885',
	'borut-pots-sample · symbols': '8b90e770972d7dcc',
	'borut-pots-sample · info': 'ab6c09744b1dcb07',
};
const printed: Record<string, string> = {};
for (const [name, kind, doc] of currentDocs()) {
	for (const [fact, value] of Object.entries(factsOf(kind, doc))) {
		const key = `${name} · ${fact}`;
		printed[key] = value;
		check(
			`6. ${key} · main's`,
			MAIN_DIGESTS[key] === value,
			`main ${MAIN_DIGESTS[key]} · now ${value}`,
		);
	}
	same(`6. ${name} · /symbols lists no spins mode`, symbolsPage(kind, doc).spinsModes, []);
	check(`6. ${name} · the Flow add-ons carry no spins modes`, !('spinsModes' in flowAddOnsOf(doc)));
	if (!doc) continue;
	same(
		`6. ${name} · the scene-set options name no spins mode`,
		sceneSetOptionsFor(kind, doc).spinsModes,
		undefined,
	);
	const config = createGameConfig<string>({ bakedConfig: () => doc, compiledConfig: doc });
	const unbound = createGameConfig<string>({ bakedConfig: () => doc, compiledConfig: doc });
	config.bindActiveMode(() => 'freeSpins');
	same(
		`6. ${name} · the info paytable reads the base game, bound or not`,
		config.activePaytableInputs(),
		unbound.activePaytableInputs(),
	);
}
same(
	'6. every current doc was measured on main',
	Object.keys(printed).sort(),
	Object.keys(MAIN_DIGESTS).sort(),
);

if (process.argv.includes('--print')) {
	console.log(JSON.stringify(printed, null, '\t'));
	process.exit(0);
}

console.log(`check:spins-modes-tools — ${checks - failures}/${checks} passed`);
if (failures) process.exit(1);
