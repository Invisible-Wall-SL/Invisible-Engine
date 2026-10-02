/**
 * What the Invisible Symbols State Machine offers each game KIND — pinned, so a kind gaining a
 * mechanic (Hold and Win, Phase 7a) cannot quietly change what every OTHER kind sees.
 *
 *   1. CAPABILITIES — the three section flags (`bookSymbolVfx`, `tumblePattern`, `symbolTransition`)
 *      are on for every built-in kind and for a custom kind, and off for `holdAndWin` alone. The
 *      whole table is pinned per kind, and the add-ons are ADDITIVE (`docs/design/pots-overlay.md`
 *      §4): a `holdAndWin` / `potsOverlay` block only turns on its own flags (`holdAndWin`,
 *      `coinSymbols`, `pots`, `potsOverlay`); without a block (or with both `false`) every kind
 *      answers exactly as before.
 *   2. COLUMNS — `visibleStatesFor` gives every existing kind exactly the columns it had before the
 *      Hold and Win states existed, under every gate; `holdAndWin` gets those and no book ones.
 *      `symbolStatesForKind` (the Scene Editor's state pickers) hides the Hold and Win states from
 *      every kind but `holdAndWin`. With an add-on: a `holdAndWin` block shows them all, a
 *      `potsOverlay` block alone only the token's three (`POTS_TOKEN_SYMBOL_STATES`).
 *   3. METER ROWS — `configMeterRows` (the `/symbols` token rows and every `toMeter:<id>` / pot name)
 *      lists nothing new for a config without an overlay, and the overlay's tokens and pots with one.
 *   4. DEFAULTS — `symbolDefaultsFor('holdAndWin')` is its own set, validates, carries every symbol
 *      of every Hold and Win preset (art for all but the blank), and is a strict SUPERSET of the
 *      `lines` set it used to fall back to, binding for binding.
 *
 * Run:  pnpm --filter launcher-api check:symbols-kind-gating
 */

import { GAME_KINDS } from 'constants-shared/gameKinds';
import {
	HOLD_AND_WIN_SYMBOL_STATES,
	kindCapabilities,
	POTS_TOKEN_SYMBOL_STATES,
	SYMBOL_STATES,
	symbolStatesForKind,
	type KindCapabilities,
	type KindCapabilityConfig,
} from 'engine-layout';
import { HOLD_AND_WIN_PRESETS, potsOverlayPreset, symbolHoldAndWinRoles } from 'game-config';
import { configAddOns, configMeterRows } from '../src/lib/configAddOns.ts';
import { symbolDefaultsFor } from '../src/lib/server/symbolDefaults.ts';
import { visibleStatesFor } from '../src/routes/(app)/symbols/symbols.client.ts';

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

// ── 1. capabilities ─────────────────────────────────────────────────────────────────────────────
for (const kind of [...GAME_KINDS, 'myCustomKind', undefined]) {
	const caps = kindCapabilities(kind);
	const on = kind !== 'holdAndWin';
	check(`${kind} · bookSymbolVfx`, caps.bookSymbolVfx, on);
	check(`${kind} · tumblePattern`, caps.tumblePattern, on);
	check(`${kind} · symbolTransition`, caps.symbolTransition, on);
	// The Scene Editor's state pickers: every state for Hold and Win, the pre-Phase-7 list otherwise.
	check(
		`${kind} · symbolStatesForKind`,
		symbolStatesForKind(kind),
		on
			? SYMBOL_STATES.filter((s) => !(HOLD_AND_WIN_SYMBOL_STATES as readonly string[]).includes(s))
			: SYMBOL_STATES,
	);
}

/** Every kind's answers with no config: the pre-add-on table, plus `pots` on its own feature. */
const LINES_CAPS: KindCapabilities = {
	freeSpins: true,
	bookReveal: false,
	stackedPictures: true,
	cascade: false,
	multiplierCollect: false,
	holdAndWin: false,
	coinSymbols: false,
	pots: false,
	potsOverlay: false,
	winLines: true,
	bookSymbolVfx: true,
	tumblePattern: true,
	symbolTransition: true,
};
const KIND_CAPS: Record<string, KindCapabilities> = {
	lines: LINES_CAPS,
	ways: { ...LINES_CAPS, winLines: false },
	cluster: { ...LINES_CAPS, cascade: true, winLines: false },
	scatter: { ...LINES_CAPS, cascade: true, multiplierCollect: true, winLines: false },
	bookOf: { ...LINES_CAPS, bookReveal: true },
	holdAndWin: {
		...LINES_CAPS,
		freeSpins: false,
		stackedPictures: false,
		holdAndWin: true,
		coinSymbols: true,
		pots: true,
		bookSymbolVfx: false,
		tumblePattern: false,
		symbolTransition: false,
	},
};
const ADD_ONS: KindCapabilityConfig[] = [
	{},
	{ holdAndWin: false, potsOverlay: false },
	{ holdAndWin: true },
	{ potsOverlay: true },
	{ holdAndWin: true, potsOverlay: true },
];
const HW_STATES_OFF = SYMBOL_STATES.filter(
	(s) => !(HOLD_AND_WIN_SYMBOL_STATES as readonly string[]).includes(s),
);
/** A pots host without the respin feature: the pre-Hold-and-Win list plus the token's states. */
const TOKEN_STATES_ON = SYMBOL_STATES.filter(
	(s) =>
		!(HOLD_AND_WIN_SYMBOL_STATES as readonly string[]).includes(s) ||
		(POTS_TOKEN_SYMBOL_STATES as readonly string[]).includes(s),
);
for (const kind of [...GAME_KINDS, 'myCustomKind', undefined]) {
	const table = KIND_CAPS[kind ?? ''] ?? LINES_CAPS;
	check(`${kind} · the whole table, no config`, kindCapabilities(kind), table);
	for (const config of ADD_ONS) {
		const label = `${kind} + ${JSON.stringify(config)}`;
		const caps = kindCapabilities(kind, config);
		const holdAndWin = table.holdAndWin || !!config.holdAndWin;
		const potsOverlay = !!config.potsOverlay;
		check(`${label} · only the add-on's own flags move`, caps, {
			...table,
			holdAndWin,
			coinSymbols: holdAndWin,
			pots: holdAndWin || potsOverlay,
			potsOverlay,
		});
		check(
			`${label} · symbolStatesForKind: all with holdAndWin, the token's with pots alone`,
			symbolStatesForKind(kind, config),
			holdAndWin ? SYMBOL_STATES : potsOverlay ? TOKEN_STATES_ON : HW_STATES_OFF,
		);
	}
}
// The two cases the pots overlay plan names (Book of Borut with each add-on).
const borutHw = kindCapabilities('bookOf', { holdAndWin: true });
check(
	'bookOf + holdAndWin block · the feature, its coins and pots',
	[borutHw.holdAndWin, borutHw.coinSymbols, borutHw.pots, borutHw.potsOverlay],
	[true, true, true, false],
);
check(
	'bookOf + holdAndWin block · keeps free spins, the book reveal and its VFX',
	[borutHw.freeSpins, borutHw.bookReveal, borutHw.bookSymbolVfx, borutHw.stackedPictures],
	[true, true, true, true],
);
const borutPots = kindCapabilities('bookOf', { potsOverlay: true });
check(
	'bookOf + potsOverlay block · pots and the overlay, no respin feature or coins',
	[borutPots.pots, borutPots.potsOverlay, borutPots.holdAndWin, borutPots.coinSymbols],
	[true, true, false, false],
);
check(
	'bookOf + potsOverlay block · keeps free spins and the book reveal',
	[borutPots.freeSpins, borutPots.bookReveal, borutPots.bookSymbolVfx],
	[true, true, true],
);

// ── 2. columns ──────────────────────────────────────────────────────────────────────────────────
const BASE = ['static', 'spin', 'land', 'win', 'postWinStatic', 'explosion'];
/** The columns a kind showed before the Hold and Win states existed, in `SYMBOL_STATES` order. */
const before = (kind: string, gates: { cascade?: boolean; emerge?: boolean; clears?: boolean }) => {
	const cascade = Boolean(gates.cascade);
	const cols = ['static', 'spin'];
	if (gates.emerge) cols.push('intro');
	cols.push('land', 'win', 'postWinStatic', 'explosion');
	if (cascade || gates.clears) cols.push('clearReel');
	if (kind === 'bookOf') cols.push('bookIntro', 'bookIdle');
	return cols;
};
const GATES = [
	{},
	{ cascade: true },
	{ emerge: true },
	{ clears: true },
	{ emerge: true, clears: true },
];
for (const kind of GAME_KINDS.filter((k) => k !== 'holdAndWin')) {
	for (const gates of GATES) {
		check(
			`${kind} ${JSON.stringify(gates)} · columns unchanged`,
			visibleStatesFor(kind, gates),
			before(kind, gates),
		);
	}
}
check('holdAndWin · base columns plus the eight H&W ones', visibleStatesFor('holdAndWin'), [
	...BASE,
	...HOLD_AND_WIN_SYMBOL_STATES,
]);
check(
	'holdAndWin · no book columns, clearReel still on its own gate',
	visibleStatesFor('holdAndWin', { clears: true }).filter((s) => !BASE.includes(s)),
	['clearReel', ...HOLD_AND_WIN_SYMBOL_STATES],
);

// The add-on columns on Book of Borut: the book's, plus the token's or the whole feature's.
const BOOK_COLS = before('bookOf', {});
const TOKEN_COLS = ['coinIdle', 'coinLand', 'flyToMeter'];
check(
	'bookOf + potsOverlay · book columns plus exactly the token states',
	visibleStatesFor('bookOf', { potsOverlay: true }),
	[...BOOK_COLS, ...TOKEN_COLS],
);
check(
	'bookOf + potsOverlay · symbolStatesForKind adds exactly the token states',
	symbolStatesForKind('bookOf', { potsOverlay: true }).filter(
		(s) => !(HW_STATES_OFF as readonly string[]).includes(s),
	),
	TOKEN_COLS,
);
check(
	'bookOf + holdAndWin · book columns plus every Hold and Win one',
	visibleStatesFor('bookOf', { holdAndWin: true }),
	[...BOOK_COLS, ...HOLD_AND_WIN_SYMBOL_STATES],
);
check(
	'bookOf + both · every Hold and Win column, once',
	visibleStatesFor('bookOf', { holdAndWin: true, potsOverlay: true }),
	[...BOOK_COLS, ...HOLD_AND_WIN_SYMBOL_STATES],
);
check(
	'bookOf + holdAndWin · symbolStatesForKind is every state, with coin symbols',
	[symbolStatesForKind('bookOf', { holdAndWin: true }), borutHw.coinSymbols],
	[SYMBOL_STATES, true],
);
check(
	'bookOf + {holdAndWin:false, potsOverlay:false} · columns unchanged',
	visibleStatesFor('bookOf', { holdAndWin: false, potsOverlay: false }),
	BOOK_COLS,
);
for (const kind of GAME_KINDS.filter((k) => k !== 'holdAndWin')) {
	check(
		`${kind} + potsOverlay {cascade, clears} · the gates still apply`,
		visibleStatesFor(kind, { cascade: true, clears: true, potsOverlay: true }),
		[...before(kind, { cascade: true, clears: true }), ...TOKEN_COLS],
	);
}

// ── 3. meter rows ───────────────────────────────────────────────────────────────────────────────
check(
	'no config · no add-ons, no meter rows',
	[configAddOns(null), configMeterRows(null)],
	[
		{ holdAndWin: false, potsOverlay: false },
		{ meterIds: [], tokens: {} },
	],
);
for (const [presetId, preset] of Object.entries(HOLD_AND_WIN_PRESETS)) {
	const meterIds = (preset.holdAndWin?.meters ?? []).map((meter) => meter.id);
	check(`${presetId} · Hold and Win meters only, no token rows`, configMeterRows(preset), {
		meterIds,
		tokens: {},
	});
	check(`${presetId} · add-ons`, configAddOns(preset), {
		holdAndWin: !!preset.holdAndWin,
		potsOverlay: false,
	});
}
const threePots = potsOverlayPreset('threePots');
const borutPotsDoc = { potsOverlay: threePots.potsOverlay };
check('threePots overlay · add-ons', configAddOns(borutPotsDoc), {
	holdAndWin: false,
	potsOverlay: true,
});
check('threePots overlay · a token row per pot, every pot a meter', configMeterRows(borutPotsDoc), {
	meterIds: ['red', 'blue', 'green'],
	tokens: { POT_RED: ['red'], POT_BLUE: ['blue'], POT_GREEN: ['green'] },
});
const hwWithOverlay = {
	holdAndWin: HOLD_AND_WIN_PRESETS.classic.holdAndWin,
	potsOverlay: potsOverlayPreset('potsToFreeSpins').potsOverlay,
};
check(
	'Hold and Win + overlay · the block meters first, then the overlay pot',
	configMeterRows(hwWithOverlay),
	{
		meterIds: [...(HOLD_AND_WIN_PRESETS.classic.holdAndWin?.meters ?? []).map((m) => m.id), 'gold'],
		tokens: { POT_GOLD: ['gold'] },
	},
);

// ── 4. defaults ─────────────────────────────────────────────────────────────────────────────────
const lines = symbolDefaultsFor('lines');
const hw = symbolDefaultsFor('holdAndWin');
check('holdAndWin has its own defaults', hw.gameType, 'holdAndWin');
check('an unknown kind still falls back to lines', symbolDefaultsFor('nope').gameType, 'lines');
for (const [name, states] of Object.entries(lines.symbols)) {
	check(`lines ${name} is carried binding for binding`, hw.symbols[name], states);
}
check('the highlight default is the same frame', hw.highlight, lines.highlight);
for (const [presetId, preset] of Object.entries(HOLD_AND_WIN_PRESETS)) {
	for (const [name, symbol] of Object.entries(preset.symbols ?? {})) {
		const blank = symbolHoldAndWinRoles(symbol).includes('blank');
		check(`${presetId} · ${name} has a row`, name in hw.symbols, true);
		check(
			`${presetId} · ${name} ${blank ? 'draws nothing' : 'has static art'}`,
			Boolean(hw.symbols[name]?.static?.assetKey),
			!blank,
		);
	}
}

console.log(
	failures === 0
		? `\nsymbols kind gating: OK (${checks} checks)`
		: `\nsymbols kind gating: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
