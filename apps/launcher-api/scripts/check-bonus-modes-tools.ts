/**
 * Contract check for bonus-games Phase 5b — the tools read the declared bonus modes, not one Hold
 * and Win block (docs/design/bonus-games.md §2.4):
 *   pnpm --filter launcher-api check:bonus-modes-tools
 *
 * What it pins, over the REAL `addOns.ts`, `symbolsPageConfig.ts` and engine-layout scene sets:
 *  1. A lines doc with TWO respin modes: the capability is on (Hold and Win parts, coin roles);
 *     `sceneSetOptionsFor` lists both modes, each with its own `maxRows`, and reserves the tallest;
 *     the scene set seeds both modes' respin screens, tagged with distinct `modeId`s, with no id
 *     shared by two screens or two nodes; `/symbols` lists each mode's own jackpot tiers, the
 *     primary first.
 *  2. The same second mode on a `holdAndWin` kind project: its own set keeps every screen, and only
 *     the second mode's screens are added.
 *  3. A respin mode declared without rules still turns the capability on and seeds its screens.
 *  4. Every doc without a second respin mode is byte-identical to before: the add-ons equal the
 *     legacy block reads, the scene set equals the one the legacy options gave, and the first
 *     mode's jackpot tiers are the legacy block's. Stripping the legacy keys (the compat mirror
 *     Phase 7 drops) leaves the add-ons unchanged.
 */

import {
	addOnSceneIds,
	getFullSceneSet,
	kindCapabilities,
	modeScenes,
	type LayoutDoc,
	type SceneSetOptions,
} from 'engine-layout';
import {
	HOLD_AND_WIN_PRESETS,
	addPotsOverlay,
	flowAddOnsOf,
	holdAndWinModeDecl,
	normalizeGameConfigDoc,
	primaryRespinMode,
	resolveExpandingSymbol,
	type GameConfigDoc,
	type PotsOverlayPresetId,
} from 'game-config';
import { projectAddOns, sceneSetOptionsFor } from '../src/lib/addOns.ts';
import { gameConfigDefaultFor } from '../src/lib/server/gameConfigDefaults.ts';
import { symbolDefaultsFor } from '../src/lib/server/symbolDefaults.ts';
import { symbolsPageConfig } from '../src/lib/server/symbolsPageConfig.ts';

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

/** `doc` (with a Hold and Win mode) plus a second respin mode `holdAndWin_2`, saved the way a writer
 *  of the split form saves it: the legacy keys deleted. Its board grows to 6 rows and its jackpots
 *  are renamed, so both differ from the primary's. */
const SECOND = 'holdAndWin_2';
const withSecondMode = (doc: GameConfigDoc): GameConfigDoc => {
	const out = clone(doc);
	delete out.holdAndWin;
	delete out.potsOverlay;
	const game = clone(primaryRespinMode(out.modes)!.holdAndWin);
	game.expansion = { startRows: 3, maxRows: 6, rule: 'fullRow' };
	game.jackpots = game.jackpots.map((jackpot) => ({ ...jackpot, name: `GOLD_${jackpot.name}` }));
	out.modes = [
		...(out.modes ?? []),
		{ ...holdAndWinModeDecl(), id: SECOND, gameType: 'respin_2', label: 'Gold', holdAndWin: game },
	];
	out.paddingReels.respin_2 = clone(out.paddingReels.respin);
	return normalize(out);
};

const sceneSet = (kind: string, doc: GameConfigDoc | null): LayoutDoc =>
	getFullSceneSet(kind, sceneSetOptionsFor(kind, doc))!;
const ids = (doc: LayoutDoc) => doc.scenes.map((scene) => scene.id);
const duplicates = (list: string[]) => list.filter((id, at) => list.indexOf(id) !== at);
const nodeIds = (doc: LayoutDoc) => doc.scenes.flatMap((scene) => scene.nodes.map((n) => n.id));
const modeIdsOf = (doc: LayoutDoc) => [
	...new Set(doc.scenes.flatMap((scene) => (scene.role === 'mode' ? [scene.modeId] : []))),
];
const symbolsPage = (kind: string, doc: GameConfigDoc) =>
	symbolsPageConfig(kind, symbolDefaultsFor(kind), { doc, source: 'authored', etag: null });

const lines = normalize(gameConfigDefaultFor('lines'));
const linesHw = withOverlay(lines, 'threePots');

// ── 1. a lines doc with two respin modes ───────────────────────────────────────────────────────
{
	const two = withSecondMode(linesHw);
	const { addOns } = projectAddOns(two);
	const caps = kindCapabilities('lines', addOns);
	check(
		'1. two modes · the respin feature and coin roles are on',
		[caps.holdAndWin, caps.coinSymbols],
		[true, true],
	);

	const options = sceneSetOptionsFor('lines', two);
	check('1. two modes · both respin modes, each with its own maxRows', options.respinModes, [
		{ id: 'holdAndWin' },
		{ id: SECOND, maxRows: 6 },
	]);
	check('1. two modes · the tallest board is reserved', options.maxRows, 6);

	const set = sceneSet('lines', two);
	const primary = modeScenes(set.scenes, 'holdAndWin');
	const second = modeScenes(set.scenes, SECOND);
	check('1. two modes · both modes have screens', modeIdsOf(set), ['holdAndWin', SECOND]);
	check('1. two modes · the same screens per mode', second.length, primary.length);
	check(
		'1. two modes · the second mode suffixes its ids',
		second.map((scene) => scene.id),
		primary.map((scene) => `${scene.id}-${SECOND}`),
	);
	check('1. two modes · no screen id twice', duplicates(ids(set)), []);
	check('1. two modes · no node id twice', duplicates(nodeIds(set)), []);
	check(
		'1. two modes · the add-on ids name both modes',
		addOnSceneIds('lines', options).filter((id) => second.some((scene) => scene.id === id)).length,
		second.length,
	);
	const board = (scenes: typeof primary) =>
		scenes.flatMap((scene) => scene.nodes).find((node) => node.id.startsWith('locked-rows'))?.y;
	check(
		'1. two modes · each mode is laid out for its own maxRows',
		board(second) !== board(primary),
		true,
	);
	check(
		'1. two modes · the primary keeps the layout of its own (unexpanded) board',
		board(primary),
		board(modeScenes(getFullSceneSet('lines', { holdAndWin: true })!.scenes, 'holdAndWin')),
	);

	const page = symbolsPage('lines', two);
	check(
		'1. two modes · /symbols lists each mode with its own jackpot tiers, the primary first',
		page.respinModes.map((mode) => [mode.id, mode.label, mode.jackpotTiers]),
		[
			['holdAndWin', 'Hold and Win', linesHw.holdAndWin!.jackpots.map((j) => j.name)],
			[SECOND, 'Gold', linesHw.holdAndWin!.jackpots.map((j) => `GOLD_${j.name}`)],
		],
	);
	check(
		'1. two modes · /symbols shows coin role chips',
		Object.keys(page.holdAndWinRoles).length > 0,
		true,
	);
}

// ── 2. a second mode on the holdAndWin kind ─────────────────────────────────────────────────────
{
	const classic = normalize(clone(HOLD_AND_WIN_PRESETS.classic));
	const two = withSecondMode(classic);
	const own = getFullSceneSet('holdAndWin', { maxRows: 6 })!;
	const set = sceneSet('holdAndWin', two);
	check(
		'2. holdAndWin kind · its own screens kept, in order',
		ids(set).filter((id) => !id.endsWith(`-${SECOND}`)),
		ids(own),
	);
	check('2. holdAndWin kind · the second mode gets screens', modeIdsOf(set), [
		'holdAndWin',
		SECOND,
	]);
	check(
		'2. holdAndWin kind · only the second mode is an add-on',
		addOnSceneIds('holdAndWin', sceneSetOptionsFor('holdAndWin', two)),
		modeScenes(set.scenes, SECOND).map((scene) => scene.id),
	);
	check('2. holdAndWin kind · no screen id twice', duplicates(ids(set)), []);
	check('2. holdAndWin kind · no node id twice', duplicates(nodeIds(set)), []);
}

// ── 3. a respin mode without rules ──────────────────────────────────────────────────────────────
{
	const bare = normalize({
		...clone(lines),
		modes: [...(lines.modes ?? []), { ...holdAndWinModeDecl(), id: SECOND, label: 'Gold' }],
	});
	const options = sceneSetOptionsFor('lines', bare);
	check(
		'3. a rule-less respin mode · the capability is on',
		projectAddOns(bare).addOns.holdAndWin,
		true,
	);
	check('3. a rule-less respin mode · its screens are seeded', modeIdsOf(sceneSet('lines', bare)), [
		SECOND,
	]);
	check('3. a rule-less respin mode · no maxRows', options.maxRows, undefined);
	check(
		'3. a rule-less respin mode · /symbols offers the fallback tiers',
		symbolsPage('lines', bare).respinModes,
		[{ id: SECOND, label: 'Gold', jackpotTiers: [] }],
	);
}

// ── 4. every doc without a second respin mode is byte-identical to before ───────────────────────
{
	/** What `projectAddOns` gave before Phase 5b: the legacy block reads. */
	const legacyAddOns = (doc: GameConfigDoc | null) => {
		const { holdAndWin, potsOverlay } = flowAddOnsOf(doc);
		return { holdAndWin, potsOverlay, expandingSymbol: !!resolveExpandingSymbol(doc ?? undefined) };
	};
	/** What `sceneSetOptionsFor` gave before Phase 5b. */
	const legacyOptions = (kind: string, doc: GameConfigDoc | null): SceneSetOptions => {
		const addOns = legacyAddOns(doc);
		const maxRows = doc?.holdAndWin?.expansion?.maxRows;
		const potIds = projectAddOns(doc).potIds;
		const addOn =
			kind === 'holdAndWin' ? addOns.potsOverlay : addOns.holdAndWin || addOns.potsOverlay;
		return {
			...(maxRows ? { maxRows } : {}),
			...(addOn
				? {
						holdAndWin: addOns.holdAndWin,
						potsOverlay: addOns.potsOverlay,
						...(potIds ? { potIds } : {}),
					}
				: {}),
		};
	};
	const expanding = normalize(clone(HOLD_AND_WIN_PRESETS.pots));
	expanding.holdAndWin!.expansion = { startRows: 3, maxRows: 6, rule: 'fullRow' };
	const docs: [string, GameConfigDoc | null][] = [
		['no config', null],
		['lines', lines],
		...Object.entries(HOLD_AND_WIN_PRESETS).map(
			([id, doc]) => [`hw-${id}-sample`, normalize(clone(doc))] as [string, GameConfigDoc],
		),
		['an expanding Hold and Win', normalize(expanding)],
		...(['threePots', 'potsToFreeSpins'] as PotsOverlayPresetId[]).map(
			(id) => [`lines + ${id}`, withOverlay(lines, id)] as [string, GameConfigDoc],
		),
	];
	const book = normalize(gameConfigDefaultFor('bookOf'));
	const borut = withOverlay(book, 'threePots');
	borut.potsOverlay!.pots = borut.potsOverlay!.pots.map((p) =>
		p.id === 'green' ? { ...p, bonus: { mode: 'freeSpins' } } : p,
	);
	docs.push(['borut-pots-sample', normalize(borut)]);

	for (const [name, doc] of docs) {
		check(`4. ${name} · add-ons`, projectAddOns(doc).addOns, legacyAddOns(doc));
		if (doc) {
			// The capabilities come from the split form: dropping the compat mirror (Phase 7) changes
			// nothing.
			const stripped = clone(doc);
			delete stripped.holdAndWin;
			delete stripped.potsOverlay;
			check(
				`4. ${name} · the legacy keys stripped, the same add-ons`,
				projectAddOns(stripped).addOns,
				projectAddOns(doc).addOns,
			);
		}
		for (const kind of ['lines', 'bookOf', 'holdAndWin']) {
			check(
				`4. ${name} on ${kind} · scene set`,
				sceneSet(kind, doc),
				getFullSceneSet(kind, legacyOptions(kind, doc)),
			);
		}
		if (doc?.holdAndWin) {
			check(
				`4. ${name} · /symbols jackpot tiers`,
				symbolsPage('lines', doc).respinModes[0]?.jackpotTiers,
				doc.holdAndWin.jackpots.map((jackpot) => jackpot.name),
			);
		}
	}
}

if (failures) {
	console.log(`\ncheck:bonus-modes-tools — ${failures} of ${checks} checks FAILED`);
	process.exit(1);
}
console.log(`check:bonus-modes-tools — all ${checks} checks passed`);
