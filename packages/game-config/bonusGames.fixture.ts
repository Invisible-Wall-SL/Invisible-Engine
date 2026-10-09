/**
 * Offline fixture for BONUS GAMES Phase 1 — the config split + migration
 * (`docs/design/bonus-games.md` §2.1, §3 Phase 1).
 *   pnpm check:all --only bonusGames.fixture
 *
 * Pins:
 *  1. LEGACY ≡ SPLIT, for every Hold and Win preset and test fixture (the `hw-*-sample` shapes),
 *     every overlay preset on a book host, `borut-pots-sample` (3 Pots, green → free spins), a Hold
 *     and Win game that adds pots, and an imported bonus. For each normalized doc N, its legacy-only
 *     form L (what `main` stored) and its split-only form S all normalize to N; N's legacy keys are
 *     byte-identical to what the legacy normalizers give; and L, S and N give the same mock inputs
 *     (`holdAndWinMockInputs`, `potsOverlayMockInputs`), modes, meters, bonus modes and issues.
 *  2. The split shape: a declared `holdAndWin` respin mode with its rules and no base-game flags; a
 *     `coinOverlay` with the right style, the base-game flags, and every route naming its mode.
 *  3. The compat rule: a legacy edit wins; a split edit with the legacy keys deleted wins; a legacy
 *     pair without `holdAndWin` drops the mode; the `potsOverlay` key and `coinOverlay` both read.
 *  4. Two respin modes: both resolve, the mirror shows the primary, a legacy edit keeps the other.
 *     4b. The precedence rule (design §2.1 "Transition"): normalize∘normalize = normalize on the
 *     legacy, split and mixed forms of every shape; a legacy-only edit re-splits onto the primary mode
 *     and the overlay and leaves a second respin mode untouched; an unchanged mirror changes nothing
 *     (applying it is a no-op, so no equality test is needed); a split edit beside a STALE mirror
 *     loses, and wins once the legacy keys are deleted. 4c. The primary respin mode is pinned.
 *  5. Validators: a route to a missing or non-respin mode, a respin mode started inside another, a
 *     missing blank — each an error whose path names the mode; a respin mode without rules or strips
 *     is a WARNING until Phase 5a (a project saved before must still save).
 *  6. `resolveBonusModes` and `bonusCapabilityInputs`.
 *  7. Hub review of #1133: a `reels` / `none` override of the Hold and Win mode keeps the block;
 *     "Start an empty block" then a label edit keeps it; `removeHoldAndWin` removes it the same way
 *     on every doc; orphan base-game flags are pruned; an import brings the source's blank.
 *  8. Phase 4: `play` (`auto` / `manual`) normalizes, splits and mirrors losslessly, and a second
 *     mode's survives the primary's mirror; `respinModeRules` gives each respin mode its rules,
 *     strip, blank and play, and the lone default reads the legacy block and the game-wide blank.
 */

import { addPotsOverlay } from './src/addOns.ts';
import {
	bonusCapabilityInputs,
	legacyHoldAndWin,
	legacyPotsOverlay,
	primaryRespinMode,
	removeHoldAndWin,
	isLoneDefaultRespinSet,
	resolveBonusModes,
	respinModeBlank,
	respinModeRules,
} from './src/bonusGames.ts';
import { holdAndWinBlankSymbol, normalizeHoldAndWin } from './src/holdAndWin.ts';
import { holdAndWinMockInputs } from './src/holdAndWinMock.ts';
import {
	HOLD_AND_WIN_PRESETS,
	HOLD_AND_WIN_PRESET_IDS,
	HOLD_AND_WIN_TEST_FIXTURES,
} from './src/holdAndWinPresets.ts';
import { importBonus } from './src/imports.ts';
import {
	builtinGameModes,
	holdAndWinModeDecl,
	resolveGameModes,
	type GameModeDecl,
} from './src/modes.ts';
import { normalizeGameConfigDoc } from './src/normalize.ts';
import { normalizePotsOverlay, resolveMeters } from './src/potsOverlay.ts';
import { potsOverlayMockInputs } from './src/potsOverlayMock.ts';
import { POTS_OVERLAY_PRESET_IDS } from './src/potsOverlayPresets.ts';
import type { AddOnResult } from './src/addOns.ts';
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

const added = (result: AddOnResult): GameConfigDoc => {
	if (!result.ok) throw new Error(result.reason);
	return normalize(result.doc);
};

/** What `main` stored: the legacy keys, and no declared respin mode (it was built in). */
const legacyOnly = (doc: GameConfigDoc): GameConfigDoc => {
	const out = clone(doc);
	delete out.coinOverlay;
	const modes = out.modes?.filter((m) => !m.holdAndWin);
	if (modes?.length) out.modes = modes;
	else delete out.modes;
	return out;
};

/** What a writer of the split form saves: no legacy keys. */
const splitOnly = (doc: GameConfigDoc): GameConfigDoc => {
	const out = clone(doc);
	delete out.holdAndWin;
	delete out.potsOverlay;
	return out;
};

const withoutRules = (modes: GameModeDecl[]) =>
	modes.map(({ holdAndWin: _rules, ...decl }) => decl);

const issueList = (doc: GameConfigDoc) =>
	validateGameConfigDoc(doc).map((i) => `${i.severity} ${i.path}`);

/** Everything a reader outside game-config gets from a doc. */
const readings = (doc: GameConfigDoc) => ({
	holdAndWin: legacyHoldAndWin(doc) ?? null,
	potsOverlay: legacyPotsOverlay(doc) ?? null,
	holdAndWinMock: holdAndWinMockInputs(doc) ?? null,
	potsOverlayMock: potsOverlayMockInputs(doc) ?? null,
	modes: withoutRules(resolveGameModes(doc)),
	meters: resolveMeters(doc),
	bonusModes: resolveBonusModes(doc),
});

/** The equivalence gate for one shape. `raw` is the legacy input, as `main` received it. */
function equivalent(name: string, raw: unknown): GameConfigDoc {
	const n = normalize(raw);
	const l = legacyOnly(n);
	const s = splitOnly(n);
	const r = raw as Record<string, unknown>;
	check(
		`${name}: the mirror is the legacy normalizers' block, byte for byte`,
		[n.holdAndWin ?? null, n.potsOverlay ?? null],
		[normalizeHoldAndWin(r.holdAndWin) ?? null, normalizePotsOverlay(r.potsOverlay) ?? null],
	);
	check(`${name}: legacy-only normalizes to the split doc`, normalize(l), n);
	check(`${name}: split-only normalizes to the split doc`, normalize(s), n);
	check(`${name}: a normalize fixed point`, normalize(clone(n)), n);
	const want = readings(l);
	check(`${name}: split-only reads as legacy (mock inputs, modes, meters)`, readings(s), want);
	check(`${name}: the stored doc reads as legacy`, readings(n), want);
	check(`${name}: the same issues`, issueList(n), issueList(l));
	return n;
}

// ─── hosts ────────────────────────────────────────────────────────────────────────────────────

const pays = (three: number, four: number, five: number): GameConfigSymbol => ({
	paytable: [{ '3': three }, { '4': four }, { '5': five }],
});
const BOOK_STRIP = ['PIC1', 'ACE', 'SCAT', 'KING', 'TEN'].map((name) => ({ name }));
const BOOK_HOST: RawGameConfig = {
	providerName: 'invisible_wall',
	gameName: 'book_host',
	gameID: 'book_host',
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
		basegame: Array.from({ length: 5 }, () => BOOK_STRIP),
		freegame: Array.from({ length: 5 }, () => BOOK_STRIP),
	},
};
const host = normalize(BOOK_HOST);

console.log('\n1a. every Hold and Win preset (the hw-*-sample shapes) and test fixture');
const SAMPLE: Record<string, string> = {
	pots: 'hw-3pots-sample',
	classic: 'hw-classic-sample',
	collector: 'hw-collector-sample',
};
const presets: Record<string, GameConfigDoc> = {};
for (const id of HOLD_AND_WIN_PRESET_IDS) {
	presets[id] = equivalent(`${id} (${SAMPLE[id]})`, clone(HOLD_AND_WIN_PRESETS[id]));
}
for (const [id, raw] of Object.entries(HOLD_AND_WIN_TEST_FIXTURES)) equivalent(id, clone(raw));

console.log('\n1b. every overlay preset on a book host');
const overlays: Record<string, GameConfigDoc> = {};
for (const id of POTS_OVERLAY_PRESET_IDS) {
	const doc = added(addPotsOverlay(host, id));
	overlays[id] = equivalent(`${id} on a book host`, legacyOnly(doc));
}

console.log('\n1c. borut-pots-sample: 3 Pots on Book of Borut, green re-routed to free spins');
const borutLegacy = legacyOnly(overlays.threePots);
borutLegacy.potsOverlay!.pots = borutLegacy.potsOverlay!.pots.map((p) =>
	p.id === 'green' ? { ...p, bonus: { mode: 'freeSpins' } } : p,
);
const borut = equivalent('borut-pots-sample', borutLegacy);

console.log('\n1d. a Hold and Win game that adds pots, and an imported bonus');
equivalent(
	'3 Pots game + pots to free spins',
	legacyOnly(added(addPotsOverlay(presets.pots, 'potsToFreeSpins'))),
);
const goldHost = added(addPotsOverlay(host, 'potsToFreeSpins'));
const importResult = importBonus(goldHost, presets.classic, {
	project: 'grand',
	mode: 'holdAndWin',
	at: '2026-10-08T00:00:00.000Z',
	pots: ['gold'],
});
if (!importResult.ok) throw new Error(importResult.reason);
const importedDoc = equivalent(
	'an imported Classic bonus',
	legacyOnly(normalize(importResult.doc)),
);
check(
	'the import record is kept',
	importedDoc.imports?.map((i) => i.mode),
	['holdAndWin'],
);

// ─── 2. the split shape ───────────────────────────────────────────────────────────────────────

console.log('\n2. the split shape');
check(
	'the built-ins are the base game and free spins only',
	builtinGameModes().map((m) => m.id),
	['basegame', 'freeSpins'],
);
for (const id of HOLD_AND_WIN_PRESET_IDS) {
	const doc = presets[id];
	const decl = doc.modes?.[0];
	check(
		`${id}: declares the respin mode the built-in was`,
		decl && { ...decl, holdAndWin: undefined },
		{ ...holdAndWinModeDecl(), holdAndWin: undefined },
	);
	const flags = Object.values(decl?.holdAndWin?.specials ?? {}).some(
		(s) => 'landsInBaseGame' in s || 'instantCollectInBaseGame' in s,
	);
	check(`${id}: the respin game carries no base-game flag`, flags, false);
}
check(
	// Read from the legacy keys alone, which carry no style: the Collector overlay (Phase 8b) is
	// inferred as pots there, its style lives on the split form only (`addOns.fixture`).
	'styles: pots, classic, collector; 3 Pots / to free spins / Collector pots; coins only classic',
	[
		...HOLD_AND_WIN_PRESET_IDS.map((id) => presets[id].coinOverlay?.style),
		...POTS_OVERLAY_PRESET_IDS.map((id) => overlays[id].coinOverlay?.style),
	],
	['pots', 'classic', 'collector', 'pots', 'pots', 'classic', 'pots'],
);
check('pots: the base-game flags moved to the overlay', presets.pots.coinOverlay?.baseGame, {
	collector: { landsInBaseGame: true },
	multiplier: { landsInBaseGame: true },
	payer: { landsInBaseGame: true },
});
check('pots: every route names its mode', presets.pots.coinOverlay?.trigger, {
	count: {
		min: 6,
		roles: ['coin', 'jackpot', 'payer', 'collector', 'coinMultiplier'],
		mode: 'holdAndWin',
	},
	luckySpin: { mode: 'holdAndWin' },
});
check(
	'pots: the symbol-filled meters name their mode',
	presets.pots.coinOverlay?.meters?.map((m) => [m.id, m.mode, m.activates]),
	[
		['red', 'holdAndWin', 'payer'],
		['blue', 'holdAndWin', 'collector'],
		['green', 'holdAndWin', 'multiplier'],
	],
);
check(
	'classic: a buy tier names its bet mode and its bonus mode',
	presets.classic.coinOverlay?.trigger?.buy,
	[
		{ betMode: 'buy', mode: 'holdAndWin', guaranteed: [], boostedSpecials: false },
		{
			betMode: 'superBuy',
			mode: 'holdAndWin',
			guaranteed: [{ role: 'coinMultiplier', count: 2 }],
			boostedSpecials: true,
		},
	],
);
check(
	'collector: the pattern names its mode',
	presets.collector.coinOverlay?.trigger?.pattern?.mode,
	'holdAndWin',
);
check(
	'a plain lines game gets no split form',
	[host.coinOverlay, host.modes],
	[undefined, undefined],
);
check(
	"borut: the pots are the overlay's",
	borut.coinOverlay?.pots?.map((p) => [p.id, p.bonus.mode]),
	[
		['red', 'holdAndWin'],
		['blue', 'holdAndWin'],
		['green', 'freeSpins'],
	],
);

// ─── 3. the compat rule ───────────────────────────────────────────────────────────────────────

console.log('\n3. the compat rule');
{
	const edited = clone(presets.classic);
	edited.holdAndWin!.respins.start = 5;
	const after = normalize(edited);
	check('a legacy edit wins, and reaches the mode', after.modes?.[0].holdAndWin?.respins.start, 5);
	check('...and the mirror', after.holdAndWin?.respins.start, 5);

	const split = splitOnly(presets.classic);
	split.modes![0].holdAndWin!.respins.start = 6;
	split.coinOverlay!.trigger!.count!.min = 7;
	const fromSplit = normalize(split);
	check(
		'a split edit with the legacy keys deleted wins, mirrored',
		[fromSplit.holdAndWin?.respins.start, fromSplit.holdAndWin?.trigger.count?.min],
		[6, 7],
	);

	const noBlock = clone(borut);
	delete noBlock.holdAndWin;
	const gone = normalize(noBlock);
	check(
		'a legacy pair without holdAndWin drops the mode and the routes to it',
		[gone.modes, gone.coinOverlay?.trigger, gone.potsOverlay?.pots.length],
		[undefined, undefined, 3],
	);

	const key = clone(splitOnly(borut)) as GameConfigDoc & Record<string, unknown>;
	key.potsOverlay = legacyPotsOverlay(borut);
	key.holdAndWin = legacyHoldAndWin(borut);
	delete key.coinOverlay;
	check('the legacy potsOverlay key still reads', normalize(key), borut);
	const blankKept = clone(presets.pots);
	blankKept.modes![0].holdAndWin!.blank = 'BLANK';
	blankKept.holdAndWin!.respins.start = 4;
	const otherFlag = splitOnly(presets.classic);
	otherFlag.coinOverlay!.baseGame = {
		...otherFlag.coinOverlay!.baseGame,
		payer: { landsInBaseGame: true },
	};
	check(
		'a flag for a special no respin mode configures is pruned',
		normalize(otherFlag).coinOverlay?.baseGame,
		{ multiplier: { landsInBaseGame: true, instantCollectInBaseGame: true } },
	);
	const secondPayer = splitOnly(presets.classic);
	secondPayer.coinOverlay!.baseGame = {
		...secondPayer.coinOverlay!.baseGame,
		payer: { landsInBaseGame: true },
	};
	secondPayer.modes!.push({
		...holdAndWinModeDecl(),
		id: 'holdAndWin_2',
		gameType: 'respin',
		holdAndWin: presets.pots.modes![0].holdAndWin,
	});
	const flagged = normalize(secondPayer);
	check(
		"...one a second respin mode configures is kept, the primary's legacy edit or not",
		[
			flagged.coinOverlay?.baseGame?.payer,
			normalize(clone(flagged)),
			normalize(
				Object.assign(clone(flagged), {
					holdAndWin: { ...flagged.holdAndWin!, respins: { start: 4, reset: 'anySpecial' } },
				}),
			).coinOverlay?.baseGame?.payer,
		],
		[{ landsInBaseGame: true }, flagged, { landsInBaseGame: true }],
	);
	check(
		'a legacy edit keeps what the mirror cannot show (the blank)',
		normalize(blankKept).modes?.[0].holdAndWin?.blank,
		'BLANK',
	);
}

// ─── 4. two respin modes ──────────────────────────────────────────────────────────────────────

console.log('\n4. two respin modes');
const second = (doc: GameConfigDoc): GameConfigDoc => {
	const out = splitOnly(doc);
	const rules = clone(primaryRespinMode(out.modes)!.holdAndWin);
	out.modes = [
		...(out.modes ?? []),
		{
			...holdAndWinModeDecl(),
			id: 'holdAndWin_2',
			gameType: 'respin_2',
			label: 'Gold',
			holdAndWin: rules,
		},
	];
	out.paddingReels.respin_2 = clone(out.paddingReels.respin);
	out.coinOverlay!.pots = out.coinOverlay!.pots!.map((p) =>
		p.id === 'green' ? { ...p, bonus: { mode: 'holdAndWin_2' } } : p,
	);
	return normalize(out);
};
{
	const two = second(borut);
	check(
		'both respin modes resolve, in order',
		resolveGameModes(two).map((m) => [m.id, m.board, gameTypeOf(m)]),
		[
			['basegame', 'reels', 'basegame'],
			['freeSpins', 'reels', 'freegame'],
			['holdAndWin', 'respinBoard', 'respin'],
			['holdAndWin_2', 'respinBoard', 'respin_2'],
		],
	);
	check('the mirror shows the primary', two.holdAndWin, borut.holdAndWin);
	check('it validates without an error', errorsOf(two), []);
	check('a normalize fixed point', normalize(clone(two)), two);
	const edited = clone(two);
	edited.holdAndWin!.respins.start = 9;
	const after = normalize(edited);
	check(
		'a legacy edit reaches the primary and keeps the second mode and its pot',
		[
			after.modes?.map((m) => [m.id, m.holdAndWin?.respins.start]),
			after.coinOverlay?.pots?.find((p) => p.id === 'green')?.bonus.mode,
		],
		[
			[
				['holdAndWin', 9],
				['holdAndWin_2', 3],
			],
			'holdAndWin_2',
		],
	);
}

// ─── 4b. the precedence rule ──────────────────────────────────────────────────────────────────

console.log('\n4b. the precedence rule (legacy pair applied when present; design §2.1 Transition)');
{
	const two = second(borut);
	const forms: [string, GameConfigDoc][] = [
		...HOLD_AND_WIN_PRESET_IDS.map((id): [string, GameConfigDoc] => [id, presets[id]]),
		...POTS_OVERLAY_PRESET_IDS.map((id): [string, GameConfigDoc] => [id, overlays[id]]),
		['borut', borut],
		['imported', importedDoc],
		['two respin modes', two],
	];
	for (const [name, doc] of forms) {
		const shapes: [string, GameConfigDoc][] = [
			['legacy', legacyOnly(doc)],
			['split', splitOnly(doc)],
			['mixed', doc],
		];
		check(
			`${name}: normalize∘normalize is normalize on the legacy, split and mixed forms`,
			shapes.map(([, d]) => normalize(normalize(d))),
			shapes.map(([, d]) => normalize(d)),
		);
	}

	// The old HoldAndWinSection path: only the legacy block is edited.
	const edited = clone(two);
	edited.holdAndWin!.respins.start = 8;
	edited.holdAndWin!.trigger.count!.min = 5;
	const after = normalize(edited);
	const secondOf = (d: GameConfigDoc) => d.modes?.find((m) => m.id === 'holdAndWin_2');
	check(
		'a legacy-only edit re-splits onto the primary mode and the overlay',
		[after.modes?.[0].holdAndWin?.respins.start, after.coinOverlay?.trigger?.count],
		[
			8,
			{
				min: 5,
				roles: ['coin', 'jackpot', 'payer', 'collector', 'coinMultiplier'],
				mode: 'holdAndWin',
			},
		],
	);
	check('...and leaves the second respin mode untouched', secondOf(after), secondOf(two));

	// Applying a mirror that is unchanged is a no-op, so no equality test is needed to keep the
	// split form when nothing legacy moved.
	check('an unchanged mirror changes nothing (two modes kept whole)', normalize(clone(two)), two);

	// Normalization cannot tell which side was edited: a split edit beside a STALE mirror loses.
	const stale = clone(presets.classic);
	stale.modes![0].holdAndWin!.respins.start = 7;
	check(
		'a split edit beside a stale mirror: the mirror wins',
		normalize(stale).holdAndWin?.respins.start,
		3,
	);
	check(
		'...the same edit with the legacy keys deleted wins',
		normalize(splitOnly(stale)).holdAndWin?.respins.start,
		7,
	);
}

console.log('\n4c. the primary respin mode');
{
	const rules = presets.classic.modes![0].holdAndWin!;
	const respin = (id: string, withRules = true): GameModeDecl => ({
		id,
		board: 'respinBoard',
		...(withRules ? { holdAndWin: rules } : {}),
	});
	check(
		'`holdAndWin` with rules wins wherever it sits',
		primaryRespinMode([respin('a'), respin('holdAndWin')])?.id,
		'holdAndWin',
	);
	check(
		'else the first respin mode with rules',
		primaryRespinMode([respin('holdAndWin', false), respin('x', false), respin('b'), respin('c')])
			?.id,
		'b',
	);
	check(
		'a reels mode or a rule-less respin mode is never one',
		primaryRespinMode([{ id: 'fs', board: 'reels' }, respin('x', false)]),
		undefined,
	);
}

// ─── 5. validators ────────────────────────────────────────────────────────────────────────────

console.log('\n5. validators: the path names the mode');
function gameTypeOf(m: GameModeDecl): string {
	return m.gameType ?? m.id;
}
function errorsOf(doc: GameConfigDoc): string[] {
	return validateGameConfigDoc(doc)
		.filter((i) => i.severity === 'error')
		.map((i) => `${i.path}: ${i.message}`);
}
const errorPaths = (doc: GameConfigDoc) =>
	validateGameConfigDoc(doc)
		.filter((i) => i.severity === 'error')
		.map((i) => i.path);
const splitEdit = (doc: GameConfigDoc, change: (d: GameConfigDoc) => void): GameConfigDoc => {
	const out = splitOnly(doc);
	change(out);
	return normalize(out);
};
check(
	'a trigger to a mode the project lacks',
	errorPaths(
		splitEdit(presets.classic, (d) => (d.coinOverlay!.trigger!.count!.mode = 'nope')),
	).filter((p) => p.startsWith('coinOverlay')),
	['coinOverlay.trigger.count.mode'],
);
check(
	'a trigger to free spins (not a respin mode)',
	errorsOf(
		splitEdit(presets.classic, (d) => (d.coinOverlay!.trigger!.randomMetre!.mode = 'freeSpins')),
	).filter((e) => e.startsWith('coinOverlay')),
	[
		'coinOverlay.trigger.randomMetre.mode: It starts "freeSpins", but only a Hold and Win (respin board) mode is started this way.',
	],
);
{
	const ruleless = splitEdit(presets.classic, (d) =>
		d.modes!.push({ id: 'pick', board: 'respinBoard', gameType: 'pickStrips' }),
	);
	check(
		'a respin mode without rules or strips: warnings, no error (Phase 5a raises them)',
		[
			errorsOf(ruleless),
			validateGameConfigDoc(ruleless)
				.filter((i) => i.path.startsWith('modes.pick'))
				.map((i) => `${i.severity} ${i.path}: ${i.message}`),
		],
		[
			[],
			[
				'warning modes.pick.holdAndWin: The respin mode "pick" has no Hold and Win rules, so nothing can play it.',
				'warning modes.pick.gameType: The respin mode "pick" has no "pickStrips" strips to deal its respins from.',
			],
		],
	);
	const noStrips = clone(HOLD_AND_WIN_PRESETS.classic);
	delete noStrips.paddingReels.respin;
	check(
		'a Hold and Win game without respin strips saves as on main: no error',
		errorsOf(normalize(noStrips)),
		errorsOf(legacyOnly(normalize(noStrips))).filter((e) => !e.startsWith('modes.')),
	);
}
check(
	'a blank the dictionary lacks',
	errorPaths(splitEdit(presets.classic, (d) => (d.modes![0].holdAndWin!.blank = 'NOPE'))),
	['modes.holdAndWin.holdAndWin.blank'],
);
check(
	'a respin mode started inside another',
	errorsOf(
		splitEdit(second(borut), (d) => {
			d.coinOverlay!.drops!.modes = ['basegame', 'holdAndWin'];
		}),
	).filter((e) => e.includes('from inside')),
	[
		'coinOverlay.pots.0.bonus.mode: It starts the respin mode "holdAndWin" from inside the respin mode "holdAndWin"; one respin board plays at a time.',
		'coinOverlay.pots.1.bonus.mode: It starts the respin mode "holdAndWin" from inside the respin mode "holdAndWin"; one respin board plays at a time.',
		'coinOverlay.pots.2.bonus.mode: It starts the respin mode "holdAndWin_2" from inside the respin mode "holdAndWin"; one respin board plays at a time.',
		'coinOverlay.trigger.count.mode: It starts the respin mode "holdAndWin" from inside the respin mode "holdAndWin"; one respin board plays at a time.',
	],
);
check(
	'every sample validates without a new error',
	[...HOLD_AND_WIN_PRESET_IDS.map((id) => presets[id]), borut, importedDoc].map((doc) =>
		errorsOf(doc).filter((e) => e.startsWith('modes.') || e.startsWith('coinOverlay.')),
	),
	[[], [], [], [], []],
);
check(
	'the blank a respin mode draws',
	respinModeBlank(presets.pots, presets.pots.modes![0]),
	'BLANK',
);

// ─── 6. resolve ───────────────────────────────────────────────────────────────────────────────

console.log('\n6. resolveBonusModes and the capability inputs');
const routes = (doc: GameConfigDoc) =>
	resolveBonusModes(doc).map((b) => [b.mode.id, b.gameType, Boolean(b.holdAndWin), b.routes]);
check(
	'3 Pots: free spins by scatters; Hold and Win by count, lucky spin and three meters',
	routes(presets.pots),
	[
		['freeSpins', 'freegame', false, [{ kind: 'scatters' }]],
		[
			'holdAndWin',
			'respin',
			true,
			[
				{ kind: 'count' },
				{ kind: 'luckySpin' },
				{ kind: 'meter', meter: 'red' },
				{ kind: 'meter', meter: 'blue' },
				{ kind: 'meter', meter: 'green' },
			],
		],
	],
);
check(
	'borut: green starts free spins beside the scatters; red and blue Hold and Win',
	routes(borut),
	[
		['freeSpins', 'freegame', false, [{ kind: 'scatters' }, { kind: 'pot', pot: 'green' }]],
		[
			'holdAndWin',
			'respin',
			true,
			[{ kind: 'pot', pot: 'red' }, { kind: 'pot', pot: 'blue' }, { kind: 'count' }],
		],
	],
);
check(
	'classic: two buy tiers',
	resolveBonusModes(presets.classic).find((b) => b.mode.id === 'holdAndWin')?.routes,
	[
		{ kind: 'count' },
		{ kind: 'randomMetre' },
		{ kind: 'buy', betMode: 'buy' },
		{ kind: 'buy', betMode: 'superBuy' },
	],
);
check(
	'a legacy-only doc resolves the same bonus modes',
	resolveBonusModes(legacyOnly(borut)),
	resolveBonusModes(borut),
);
check(
	'capability inputs: Hold and Win game, pots to free spins, plain lines',
	[presets.classic, overlays.potsToFreeSpins, host].map(bonusCapabilityInputs),
	[
		{ respinMode: true, coinOverlay: true, potsOverlay: false },
		{ respinMode: false, coinOverlay: true, potsOverlay: true },
		{ respinMode: false, coinOverlay: false, potsOverlay: false },
	],
);

// ─── 7. hub review of #1133 ───────────────────────────────────────────────────────────────────

console.log('\n7. hub review: the board override, removing, flags, the imported blank');
for (const board of ['reels', 'none'] as const) {
	const raw = {
		...clone(HOLD_AND_WIN_PRESETS.classic),
		modes: [{ id: 'holdAndWin', board, label: 'Grand' }],
	};
	const doc = normalize(raw);
	check(
		`a "${board}" override of the Hold and Win mode keeps the block, on the respin board`,
		[
			doc.holdAndWin,
			doc.modes?.map((m) => [m.id, m.board, m.label, Boolean(m.holdAndWin)]),
			gameModeBoard(raw),
			errorsOf(doc),
		],
		[presets.classic.holdAndWin, [['holdAndWin', 'respinBoard', 'Grand', true]], 'respinBoard', []],
	);
}
function gameModeBoard(raw: unknown): string | undefined {
	return resolveGameModes(raw as GameConfigDoc).find((m) => m.id === 'holdAndWin')?.board;
}
{
	// /config: "Start an empty block" on a lines game, then the Game modes row's label is edited —
	// before the fix the entry was pushed on the reels board.
	const started = clone(host);
	started.holdAndWin = normalizeHoldAndWin({})!;
	for (const board of ['respinBoard', 'reels'] as const) {
		const edited = clone(started);
		edited.modes = [{ id: 'holdAndWin', board, label: 'Bonus' }];
		const doc = normalize(edited);
		check(
			`"Start an empty block" then a label edit (pushed on ${board}) keeps the block`,
			[Boolean(doc.holdAndWin), doc.modes?.map((m) => [m.id, m.board, m.label, m.gameType])],
			[true, [['holdAndWin', 'respinBoard', 'Bonus', 'respin']]],
		);
	}
}
{
	const removed = (doc: GameConfigDoc) => {
		const out = normalize(removeHoldAndWin(clone(doc)));
		return [
			Boolean(out.holdAndWin),
			resolveGameModes(out).some((m) => m.id === 'holdAndWin'),
			out.coinOverlay?.trigger ?? null,
		];
	};
	check('removeHoldAndWin on a plain Hold and Win game', removed(presets.classic), [
		false,
		false,
		null,
	]);
	check('removeHoldAndWin beside pots', removed(borut), [false, false, null]);
	check(
		'...the pots stay',
		normalize(removeHoldAndWin(clone(borut))).potsOverlay?.pots.map((p) => p.id),
		['red', 'blue', 'green'],
	);
}
{
	const source = splitOnly(presets.classic);
	source.modes![0].holdAndWin!.blank = 'BLANK';
	const result = importBonus(goldHost, normalize(source), {
		project: 'grand',
		mode: 'holdAndWin',
		at: '2026-10-08T00:00:00.000Z',
		pots: ['gold'],
	});
	if (!result.ok) throw new Error(result.reason);
	const doc = normalize(result.doc);
	check(
		"an import brings the source's blank, under its name here",
		[
			doc.modes?.[0].holdAndWin?.blank,
			doc.symbols[doc.modes?.[0].holdAndWin?.blank ?? '']?.special_properties,
		],
		['BLANK', ['blank']],
	);
}

// ─── 8. Phase 4: each respin mode's rules as the game plays them, and its play setting ─────────

console.log('\n8. respin mode rules + play');
{
	const preset = (id: (typeof HOLD_AND_WIN_PRESET_IDS)[number]) =>
		clone(HOLD_AND_WIN_PRESETS[id]) as RawGameConfig & { holdAndWin: Record<string, unknown> };
	check(
		'play: `auto` and `manual` are kept, anything else is dropped, absent stays absent',
		['auto', 'manual', 'sometimes', undefined].map(
			(play) => normalizeHoldAndWin({ ...preset('classic').holdAndWin, play })?.play ?? null,
		),
		['auto', 'manual', null, null],
	);
	const manualRaw = preset('pots');
	manualRaw.holdAndWin.play = 'manual';
	const manual = equivalent('a Manual Hold and Win (legacy ≡ split)', manualRaw);
	check(
		'play: a legacy `manual` lands on the respin mode and the mirror shows it',
		[manual.modes?.find((m) => m.id === 'holdAndWin')?.holdAndWin?.play, manual.holdAndWin?.play],
		['manual', 'manual'],
	);
	const two = second(borut);
	const raw = clone(two);
	raw.modes = raw.modes?.map((m) =>
		m.id === 'holdAndWin_2' ? { ...m, holdAndWin: { ...m.holdAndWin!, play: 'manual' } } : m,
	);
	const kept = normalize(raw);
	check(
		"play: a second mode's setting survives the primary's mirror, which does not show it",
		[
			kept.modes?.find((m) => m.id === 'holdAndWin_2')?.holdAndWin?.play,
			kept.holdAndWin?.play ?? null,
		],
		['manual', null],
	);
	check(
		'respinModeRules: one per respin mode, the primary first, play resolved',
		respinModeRules(kept).map((m) => [m.mode, m.gameType, m.play, m.block === kept.holdAndWin]),
		[
			['holdAndWin', 'respin', 'auto', true],
			['holdAndWin_2', 'respin_2', 'manual', false],
		],
	);
	check(
		"respinModeRules: two modes each take their own blank (the mock's pick)",
		respinModeRules(kept).map((m) => m.blank),
		kept.modes!.filter((m) => m.board === 'respinBoard').map((m) => respinModeBlank(kept, m)),
	);
	for (const id of HOLD_AND_WIN_PRESET_IDS) {
		const doc = normalize(preset(id));
		const rules = respinModeRules(doc);
		check(
			`respinModeRules ${id}: the lone default reads the legacy block and the game-wide blank`,
			[
				isLoneDefaultRespinSet(rules),
				rules.length,
				rules[0]?.block === legacyHoldAndWin(doc),
				rules[0]?.blank === holdAndWinBlankSymbol(doc),
				rules[0]?.play,
			],
			[true, 1, true, true, 'auto'],
		);
	}
	check(
		'respinModeRules: no Hold and Win ⇒ none',
		respinModeRules(normalize(clone(BOOK_HOST))),
		[],
	);
}

console.log(failures === 0 ? '\nAll bonus-games assertions passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
