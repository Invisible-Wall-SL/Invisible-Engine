/**
 * Offline fixture for BONUS GAMES Phase 5a — the split-form writers `/config` uses
 * (`docs/design/bonus-games.md` §2.1 "What writers must do", §2.4).
 *   pnpm check:all --only bonusModes.fixture
 *
 * Pins:
 *  1. A stored doc carries no legacy key, nor does the live doc `/config` opens from it
 *     (`migrateLegacyBonus`), and normalizing that gives the stored doc back for every Hold and Win
 *     preset (`hw-*-sample`), every overlay preset and `borut-pots-sample`: open → save → reload
 *     changes nothing.
 *  2. Two respin modes: `addRespinMode` adds a second one from a preset under `holdAndWin_2` (its
 *     own strips, clashing symbols renamed); pot A → mode 1 and pot B → mode 2 survive a save and a
 *     reload, an edit to mode 2's rules too; the primary view (`primaryHoldAndWin`) still shows mode 1
 *     exactly as before, so the runtime (which plays the primary through it) is unchanged.
 *  3. Per-mode validation: mode 2's rules go through `validateHoldAndWin` with paths that name it; a
 *     respin mode without rules is an error only when something starts it.
 *  4. `removeRespinMode`: the primary goes through `removeHoldAndWin`; the pots that started it are
 *     re-routed to free spins, or, with free spins off, removed with their drops — with a note; a
 *     second mode takes its strips and only-its symbols with it.
 *  5. `renameRespinMode` carries the routes along and keeps the strips; `holdAndWin` keeps its id;
 *     `holdAndWin` is refused as a new id beside another primary.
 *  6. A pot may start any respin mode with one of ITS specials active.
 */

import { addPotsOverlay, type AddOnResult } from './src/addOns.ts';
import { migrateLegacyBonus, potsOverlayOf, primaryHoldAndWin } from './src/bonusGames.ts';
import {
	addRespinMode,
	nextRespinModeId,
	removeRespinMode,
	renameRespinMode,
	respinModeIdProblem,
	startRespinRules,
} from './src/bonusModes.ts';
import { holdAndWinMockInputs } from './src/holdAndWinMock.ts';
import { HOLD_AND_WIN_PRESETS, HOLD_AND_WIN_PRESET_IDS } from './src/holdAndWinPresets.ts';
import { normalizeGameConfigDoc } from './src/normalize.ts';
import { POTS_OVERLAY_PRESET_IDS } from './src/potsOverlayPresets.ts';
import type { GameConfigDoc, GameConfigSymbol, RawGameConfig } from './src/types.ts';
import { validateGameConfigDoc } from './src/validate.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const normalize = (raw: unknown): GameConfigDoc => {
	const doc = normalizeGameConfigDoc(raw);
	if (!doc) throw new Error('config did not normalize');
	return doc;
};

const ok = (result: AddOnResult): GameConfigDoc & { notes?: string[] } => {
	if (!result.ok) throw new Error(result.reason);
	return { ...result.doc, ...(result.notes ? { notes: result.notes } : {}) };
};
const docOf = (result: AddOnResult): GameConfigDoc => {
	if (!result.ok) throw new Error(result.reason);
	return result.doc;
};

/** What `/config` does: open (the split form of the stored doc), save (normalize), reload. */
const saveAndReload = (live: GameConfigDoc): GameConfigDoc => migrateLegacyBonus(normalize(live));

const errors = (doc: GameConfigDoc) =>
	validateGameConfigDoc(doc)
		.filter((i) => i.severity === 'error')
		.map((i) => i.path);
const issuesAt = (doc: GameConfigDoc, prefix: string) =>
	validateGameConfigDoc(doc)
		.filter((i) => i.path.startsWith(prefix))
		.map((i) => `${i.severity} ${i.path}`);

const pays = (three: number, four: number, five: number): GameConfigSymbol => ({
	paytable: [{ '3': three }, { '4': four }, { '5': five }],
});
const STRIP = ['PIC1', 'ACE', 'SCAT', 'KING', 'TEN'].map((name) => ({ name }));
const HOST: RawGameConfig = {
	providerName: 'invisible_wall',
	gameName: 'lines_host',
	gameID: 'lines_host',
	rtp: 0.96,
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	betModes: { base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 } },
	paylines: { '1': [1, 1, 1, 1, 1], '2': [0, 0, 0, 0, 0], '3': [2, 2, 2, 2, 2] },
	symbols: {
		PIC1: pays(100, 1000, 5000),
		ACE: pays(5, 50, 150),
		KING: pays(5, 50, 150),
		TEN: pays(5, 20, 100),
		SCAT: { special_properties: ['scatter'] },
	},
	paddingReels: {
		basegame: Array.from({ length: 5 }, () => STRIP),
		freegame: Array.from({ length: 5 }, () => STRIP),
	},
};
const host = normalize(HOST);

console.log('\n1. open → save → reload changes nothing');
const stored: Record<string, GameConfigDoc> = {};
for (const id of HOLD_AND_WIN_PRESET_IDS) stored[`hw-${id}`] = normalize(HOLD_AND_WIN_PRESETS[id]);
for (const id of POTS_OVERLAY_PRESET_IDS) {
	stored[`${id} on a lines host`] = normalize(docOf(addPotsOverlay(host, id)));
}
const borut = clone(stored['threePots on a lines host']);
borut.coinOverlay!.pots = borut.coinOverlay!.pots!.map((p) =>
	p.id === 'green' ? { ...p, bonus: { mode: 'freeSpins' } } : p,
);
stored['borut-pots-sample'] = normalize(borut);
for (const [name, doc] of Object.entries(stored)) {
	const live = migrateLegacyBonus(doc);
	const untouched = clone(doc);
	check(
		`${name}: the stored doc has no legacy key`,
		['holdAndWin', 'potsOverlay'].filter((k) => k in doc),
		[],
	);
	check(
		`${name}: the live doc has no legacy key`,
		['holdAndWin', 'potsOverlay'].filter((k) => k in live),
		[],
	);
	check(`${name}: saving it stores the same doc`, normalize(live), doc);
	check(`${name}: the input is not touched`, doc, untouched);
}

console.log('\n2. a lines project with a coin overlay and two respin modes from different presets');
const three = migrateLegacyBonus(stored['threePots on a lines host']);
check('the next respin id beside holdAndWin', nextRespinModeId(three), 'holdAndWin_2');
check('the next respin id on a bare host', nextRespinModeId(host), 'holdAndWin');
const two = ok(addRespinMode(three, 'holdAndWin_2', 'classic'));
const second = two.modes?.find((m) => m.id === 'holdAndWin_2');
check(
	'mode 2 is a respin mode with its own rules and strips',
	[
		second?.board,
		second?.gameType,
		Boolean(second?.holdAndWin),
		two.paddingReels.holdAndWin_2?.length,
	],
	['respinBoard', 'holdAndWin_2', true, 5],
);
check(
	'the result is in the split form',
	['holdAndWin', 'potsOverlay'].filter((k) => k in two),
	[],
);
check('mode 1 is untouched', two.modes?.[0], three.modes?.[0]);
two.coinOverlay!.pots!.find((p) => p.id === 'blue')!.bonus = { mode: 'holdAndWin_2' };
second!.holdAndWin!.respins.start = 7;

const reloaded = saveAndReload(two);
check(
	'pot A → mode 1 and pot B → mode 2 survive save + reload',
	reloaded.coinOverlay?.pots?.map((p) => [p.id, p.bonus.mode]),
	[
		['red', 'holdAndWin'],
		['blue', 'holdAndWin_2'],
		['green', 'holdAndWin'],
	],
);
check(
	'an edit to mode 2 survives save + reload',
	reloaded.modes?.find((m) => m.id === 'holdAndWin_2')?.holdAndWin?.respins.start,
	7,
);
check('a second save is a fixed point', saveAndReload(reloaded), reloaded);
const saved = normalize(two);
const before = stored['threePots on a lines host'];
check(
	'the primary view is mode 1, exactly as before (the runtime plays it)',
	primaryHoldAndWin(saved),
	primaryHoldAndWin(before),
);
{
	// The dictionary is shared, so mode 2's own symbols are listed too; mode 1's are unchanged. The
	// mock's per-mode list (bonus-games Phase 2) names both, the primary first.
	const { modes, ...inputs } = holdAndWinMockInputs(saved)!;
	const kept = Object.fromEntries(
		Object.entries(inputs.symbols).filter(([name]) => name in before.symbols),
	);
	check(
		"...and the Hold and Win mock's inputs are mode 1's",
		{ ...inputs, symbols: kept },
		holdAndWinMockInputs(before),
	);
	check(
		'...and its per-mode list plays both, mode 1 first',
		modes?.map((m) => [m.mode, m.gameType]),
		[
			['holdAndWin', 'respin'],
			['holdAndWin_2', 'holdAndWin_2'],
		],
	);
}
check(
	'the pots view routes blue to mode 2',
	potsOverlayOf(saved)?.pots.map((p) => p.bonus.mode),
	['holdAndWin', 'holdAndWin_2', 'holdAndWin'],
);
check('the doc saves (no errors)', errors(saved), []);

console.log('\n3. per-mode validation');
{
	const bad = clone(two);
	const rules = bad.modes!.find((m) => m.id === 'holdAndWin_2')!.holdAndWin!;
	rules.boardEnd = { type: 'fullBoardJackpot', jackpot: 'NOPE', roles: ['coin'] };
	check(
		"mode 2's rules are validated under its own path",
		errors(normalize(bad)).filter((p) => p.includes('NOPE') || p.startsWith('modes.')),
		['modes.holdAndWin_2.holdAndWin.boardEnd.jackpot'],
	);
	const unstarted = clone(three);
	const added = docOf(addRespinMode(unstarted, 'holdAndWin_2', 'collector'));
	check(
		'a respin mode nothing starts saves: its issues are warnings, the trigger one says where to route',
		[
			errors(normalize(added)).filter((p) => p.startsWith('modes.')),
			validateGameConfigDoc(normalize(added)).find(
				(i) => i.path === 'modes.holdAndWin_2.holdAndWin.trigger',
			)?.message,
		],
		[
			[],
			'Nothing starts "holdAndWin_2" yet — route a trigger or a pot to "holdAndWin_2" in Coin overlay.',
		],
	);
	const routed = clone(added);
	routed.coinOverlay!.pots![1].bonus = { mode: 'holdAndWin_2' };
	check(
		'...and once a pot starts it, its rules are judged in full (no error here)',
		errors(normalize(routed)),
		[],
	);
	check(
		'a route to a respin mode other than holdAndWin raises nothing: the game plays it (bonus-games Phase 4)',
		issuesAt(normalize(routed), 'coinOverlay.pots.1'),
		[],
	);
	const fresh = docOf(addRespinMode(three, 'bonusC'));
	check(
		'empty rules carry a coin, so they add no coin-table error',
		errors(normalize(fresh)).filter((p) => p.includes('bonusC')),
		[],
	);
	const coined = clone(two);
	coined.coinOverlay!.coins = [
		{ kind: 'jackpot', jackpot: 'MINI', weight: 1 },
		{ kind: 'jackpot', jackpot: 'NOPE', weight: 1 },
	];
	check('a base-game coin names a jackpot tier of some respin mode', errors(normalize(coined)), [
		'coinOverlay.coins.1.jackpot',
	]);
	check(
		"mode 1's issues are not repeated under mode 2",
		issuesAt(normalize(two), 'modes.holdAndWin_2'),
		[],
	);

	const empty = docOf(addRespinMode(three, 'bonusB'));
	delete empty.modes!.find((m) => m.id === 'bonusB')!.holdAndWin;
	check(
		'a respin mode without rules that nothing starts: a warning',
		issuesAt(normalize(empty), 'modes.bonusB.holdAndWin'),
		['warning modes.bonusB.holdAndWin'],
	);
	empty.coinOverlay!.pots![1].bonus = { mode: 'bonusB' };
	check('...that a pot starts: an error', issuesAt(normalize(empty), 'modes.bonusB.holdAndWin'), [
		'error modes.bonusB.holdAndWin',
	]);
	const started = ok(startRespinRules(empty, 'bonusB'));
	check(
		'"Start empty rules" fills the declared mode and declares no sibling',
		[
			started.modes?.map((m) => [m.id, Boolean(m.holdAndWin)]),
			issuesAt(normalize(started), 'modes.bonusB.holdAndWin').filter((i) =>
				i.endsWith('modes.bonusB.holdAndWin'),
			),
		],
		[
			[
				['holdAndWin', true],
				['bonusB', true],
			],
			[],
		],
	);
	check(
		'...and is refused on a mode that has rules',
		startRespinRules(started, 'bonusB').ok,
		false,
	);
}

console.log('\n4. removing a respin mode');
{
	const out = ok(removeRespinMode(two, 'holdAndWin'));
	check(
		'the primary goes; its pots now start free spins; mode 2 keeps blue',
		[
			out.modes?.map((m) => m.id),
			out.coinOverlay?.pots?.map((p) => [p.id, p.bonus.mode]),
			out.paddingReels.respin,
		],
		[
			['holdAndWin_2'],
			[
				['red', 'freeSpins'],
				['blue', 'holdAndWin_2'],
				['green', 'freeSpins'],
			],
			undefined,
		],
	);
	check(
		'...said in a note: the re-route only — mode 2 plays under its own id (bonus-games Phase 4)',
		[out.notes?.length, out.notes?.some((n) => n.includes('rename it to'))],
		[1, false],
	);
	const renamed = ok(renameRespinMode(out, 'holdAndWin_2', 'holdAndWin'));
	check(
		'...renameRespinMode still allows renaming it holdAndWin, and the routes follow',
		[
			renamed.modes?.map((m) => m.id),
			renamed.coinOverlay?.pots?.find((p) => p.id === 'blue')?.bonus.mode,
			issuesAt(normalize(renamed), 'coinOverlay'),
		],
		[['holdAndWin'], 'holdAndWin', []],
	);
	check('...and the doc saves', errors(normalize(out)), []);
	check('mode 2 is now the primary', Boolean(primaryHoldAndWin(normalize(out))), true);

	const off = clone(two);
	off.freeSpins = { enabled: false };
	const gone = ok(removeRespinMode(off, 'holdAndWin'));
	check(
		'with free spins off, its pots go with their drops',
		[
			gone.coinOverlay?.pots?.map((p) => p.id),
			gone.coinOverlay?.drops?.table.flatMap((e) => ('pot' in e ? [e.pot] : [])),
		],
		[['blue'], ['blue']],
	);
	check('...said in a note', gone.notes?.[0]?.includes('removed with their drops'), true);

	const out2 = ok(removeRespinMode(two, 'holdAndWin_2'));
	const classicOnly = Object.keys(two.symbols).filter((s) => !(s in three.symbols));
	check(
		'mode 2 goes with its strips and the symbols only they dealt; blue starts free spins',
		[
			out2.modes?.map((m) => m.id),
			out2.paddingReels.holdAndWin_2,
			classicOnly.filter((s) => s in out2.symbols),
			out2.coinOverlay?.pots?.find((p) => p.id === 'blue')?.bonus.mode,
		],
		[['holdAndWin'], undefined, [], 'freeSpins'],
	);
	check(
		'removing mode 2 leaves the stored doc as it was before it was added',
		primaryHoldAndWin(normalize(out2)),
		primaryHoldAndWin(before),
	);
	check('a reels mode is not a respin mode', removeRespinMode(two, 'freeSpins').ok, false);
}

console.log('\n5. renaming');
{
	const out = ok(renameRespinMode(two, 'holdAndWin_2', 'grand'));
	const grand = out.modes?.find((m) => m.id === 'grand');
	check(
		'the routes follow and the strips stay',
		[
			grand?.gameType,
			out.coinOverlay?.pots?.find((p) => p.id === 'blue')?.bonus.mode,
			Boolean(out.paddingReels.holdAndWin_2),
		],
		['holdAndWin_2', 'grand', true],
	);
	check('...and it saves', errors(normalize(out)), []);
	check('holdAndWin keeps its id', renameRespinMode(two, 'holdAndWin', 'other').ok, false);
	check('a taken id is refused', renameRespinMode(two, 'holdAndWin_2', 'freeSpins').ok, false);
	check(
		'holdAndWin is refused beside another primary',
		Boolean(respinModeIdProblem(ok(removeRespinMode(two, 'holdAndWin')), 'holdAndWin')),
		true,
	);
}

console.log('\n6. a pot starts any respin mode with one of its specials active');
{
	const doc = clone(two);
	const rules = doc.modes!.find((m) => m.id === 'holdAndWin_2')!.holdAndWin!;
	const special = Object.keys(rules.specials)[0] as keyof typeof rules.specials;
	doc.coinOverlay!.pots!.find((p) => p.id === 'blue')!.bonus = {
		mode: 'holdAndWin_2',
		activates: special,
	};
	check(`blue → mode 2 with its ${special} active`, errors(normalize(doc)), []);
	const absent = (
		['collector', 'multiplier', 'payer', 'mystery', 'addRespins', 'upgrade'] as const
	).find((k) => !rules.specials[k])!;
	doc.coinOverlay!.pots!.find((p) => p.id === 'blue')!.bonus.activates = absent;
	check(`...a special mode 2 does not configure is an error`, errors(normalize(doc)), [
		'potsOverlay.pots.1.bonus.activates',
	]);
}

console.log(failures === 0 ? '\nAll bonus-modes assertions passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
