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
 *  2. The same second mode on a `holdAndWin` kind project: its own set keeps every screen, its own
 *     mode's screens keep the layout they have alone (only the base grid reserves the tallest), and
 *     only the second mode's screens are added.
 *  3. A respin mode declared without rules is inert: on a lines or ways project the add-ons, the
 *     capabilities (so the win model) and the scene set are main's. Rules turn it on.
 *  4. Every doc without a second respin mode is byte-identical to before: the add-ons equal the
 *     legacy block reads (now the split form's block views), the scene set equals the one the
 *     legacy options gave, and the first mode's jackpot tiers are the legacy block's. The same doc
 *     stored with the legacy keys normalizes to the same add-ons.
 */

import {
	addOnSceneIds,
	getFullSceneSet,
	kindCapabilities,
	modeScenes,
	type LayoutDoc,
	type Scene,
	type SceneSetOptions,
} from 'engine-layout';
import {
	HOLD_AND_WIN_PRESETS,
	addPotsOverlay,
	holdAndWinModeDecl,
	normalizeGameConfigDoc,
	potsOverlayOf,
	primaryHoldAndWin,
	primaryRespinMode,
	resolveExpandingSymbol,
	setOverlayPots,
	setPrimaryHoldAndWin,
	type GameConfigDoc,
	type PotsOverlayPresetId,
	type RawGameConfig,
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

/** `doc` (with a Hold and Win mode) plus a second respin mode `holdAndWin_2`. Its board grows to 6
 *  rows and its jackpots are renamed, so both differ from the primary's. */
const SECOND = 'holdAndWin_2';
const withSecondMode = (doc: GameConfigDoc): GameConfigDoc => {
	const out = clone(doc);
	const game = clone(primaryRespinMode(out.modes)!.holdAndWin);
	game.expansion = { startRows: 3, maxRows: 6, rule: 'fullRow', resetsRespins: true };
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
/** Where a set of respin screens draws its locked rows — it moves with the board's `maxRows`. */
const board = (scenes: Scene[]) =>
	scenes.flatMap((scene) => scene.nodes).find((node) => node.id.startsWith('locked-rows'))?.y;
const symbolsPage = (kind: string, doc: GameConfigDoc) =>
	symbolsPageConfig(kind, symbolDefaultsFor(kind), { doc, source: 'authored', etag: null });

/** What `projectAddOns` gave before Phase 5b: the legacy block reads. */
const legacyAddOns = (doc: GameConfigDoc | null) => ({
	holdAndWin: !!doc && !!primaryHoldAndWin(doc),
	potsOverlay: !!doc && !!potsOverlayOf(doc),
	expandingSymbol: !!resolveExpandingSymbol(doc ?? undefined),
});
/** What `sceneSetOptionsFor` gave before Phase 5b. */
const legacyOptions = (kind: string, doc: GameConfigDoc | null): SceneSetOptions => {
	const addOns = legacyAddOns(doc);
	const maxRows = doc ? primaryHoldAndWin(doc)?.expansion?.maxRows : undefined;
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
	check(
		'1. two modes · both respin modes, each with its label and own maxRows',
		options.respinModes,
		[
			{ id: 'holdAndWin', label: 'Hold and Win' },
			{ id: SECOND, label: 'Gold', maxRows: 6 },
		],
	);
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
	check(
		'1. two modes · the second mode is named by its label',
		second.every((scene) => scene.name.endsWith(' (Gold)')),
		true,
	);
	check('1. two modes · no screen id twice', duplicates(ids(set)), []);
	check('1. two modes · no node id twice', duplicates(nodeIds(set)), []);
	check(
		'1. two modes · the add-on ids name both modes',
		addOnSceneIds('lines', options).filter((id) => second.some((scene) => scene.id === id)).length,
		second.length,
	);
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
			['holdAndWin', 'Hold and Win', primaryHoldAndWin(linesHw)!.jackpots.map((j) => j.name)],
			[SECOND, 'Gold', primaryHoldAndWin(linesHw)!.jackpots.map((j) => `GOLD_${j.name}`)],
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
	check(
		'2. holdAndWin kind · its own mode keeps the layout it has alone',
		board(modeScenes(set.scenes, 'holdAndWin')),
		board(modeScenes(sceneSet('holdAndWin', classic).scenes, 'holdAndWin')),
	);
	check(
		'2. holdAndWin kind · ...while the base grid reserves the tallest board',
		set.scenes.filter((scene) => scene.role !== 'mode'),
		own.scenes.filter((scene) => scene.role !== 'mode'),
	);
	check(
		'2. holdAndWin kind · the second mode is laid out for its own 6 rows',
		board(modeScenes(set.scenes, SECOND)),
		board(modeScenes(own.scenes, 'holdAndWin')),
	);
	check('2. holdAndWin kind · no screen id twice', duplicates(ids(set)), []);
	check('2. holdAndWin kind · no node id twice', duplicates(nodeIds(set)), []);
}

// ── 3. a respin mode without rules is inert ─────────────────────────────────────────────────────
for (const kind of ['lines', 'ways']) {
	const host = normalize(gameConfigDefaultFor(kind));
	const bare = normalize({
		...clone(host),
		modes: [...(host.modes ?? []), { ...holdAndWinModeDecl(), id: SECOND, label: 'Gold' }],
	});
	check(
		`3. ${kind} + a rule-less respin mode · main's add-ons`,
		projectAddOns(bare).addOns,
		legacyAddOns(bare),
	);
	check(
		`3. ${kind} + a rule-less respin mode · main's capabilities (the win model too)`,
		kindCapabilities(kind, projectAddOns(bare).addOns),
		kindCapabilities(kind, legacyAddOns(bare)),
	);
	check(
		`3. ${kind} + a rule-less respin mode · main's scene set`,
		sceneSet(kind, bare),
		getFullSceneSet(kind, legacyOptions(kind, bare)),
	);
	check(
		`3. ${kind} + a rule-less respin mode · no tiers on /symbols`,
		symbolsPage(kind, bare).respinModes,
		[],
	);

	const ruled = withSecondMode(withOverlay(host, 'threePots'));
	check(
		`3. ${kind} + respin modes with rules · the respin feature is on`,
		kindCapabilities(kind, projectAddOns(ruled).addOns).holdAndWin,
		true,
	);
}

// ── 4. every doc without a second respin mode is byte-identical to before ───────────────────────
{
	const expanding = normalize(clone(HOLD_AND_WIN_PRESETS.pots));
	setPrimaryHoldAndWin(expanding, {
		...primaryHoldAndWin(expanding)!,
		expansion: { startRows: 3, maxRows: 6, rule: 'fullRow', resetsRespins: true },
	});
	check(
		'4. the expanding Hold and Win expands',
		primaryHoldAndWin(expanding)?.expansion?.maxRows,
		6,
	);
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
	const pots = potsOverlayOf(borut)!;
	setOverlayPots(borut, {
		...pots,
		pots: pots.pots.map((p) => (p.id === 'green' ? { ...p, bonus: { mode: 'freeSpins' } } : p)),
	});
	docs.push(['borut-pots-sample', normalize(borut)]);

	for (const [name, doc] of docs) {
		check(`4. ${name} · add-ons`, projectAddOns(doc).addOns, legacyAddOns(doc));
		if (doc) {
			// The capabilities come from the split form: the same doc stored with the legacy pair
			// normalizes to the same add-ons, and a normalized doc carries no pair.
			const legacy: RawGameConfig = {
				...clone(doc),
				holdAndWin: primaryHoldAndWin(doc),
				potsOverlay: potsOverlayOf(doc),
			};
			check(
				`4. ${name} · stored with the legacy keys, the same add-ons`,
				projectAddOns(normalize(legacy)).addOns,
				projectAddOns(doc).addOns,
			);
			check(
				`4. ${name} · no legacy keys`,
				['holdAndWin', 'potsOverlay'].filter((k) => k in doc),
				[],
			);
		}
		for (const kind of ['lines', 'bookOf', 'holdAndWin']) {
			check(
				`4. ${name} on ${kind} · scene set`,
				sceneSet(kind, doc),
				getFullSceneSet(kind, legacyOptions(kind, doc)),
			);
		}
		const block = doc && primaryHoldAndWin(doc);
		if (doc && block) {
			check(
				`4. ${name} · /symbols jackpot tiers`,
				symbolsPage('lines', doc).respinModes[0]?.jackpotTiers,
				block.jackpots.map((jackpot) => jackpot.name),
			);
		}
	}
}

if (failures) {
	console.log(`\ncheck:bonus-modes-tools — ${failures} of ${checks} checks FAILED`);
	process.exit(1);
}
console.log(`check:bonus-modes-tools — all ${checks} checks passed`);
