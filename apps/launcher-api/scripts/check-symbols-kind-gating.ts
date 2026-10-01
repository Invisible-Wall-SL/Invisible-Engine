/**
 * What the Invisible Symbols State Machine offers each game KIND — pinned, so a kind gaining a
 * mechanic (Hold and Win, Phase 7a) cannot quietly change what every OTHER kind sees.
 *
 *   1. CAPABILITIES — the three section flags (`bookSymbolVfx`, `tumblePattern`, `symbolTransition`)
 *      are on for every built-in kind and for a custom kind, and off for `holdAndWin` alone.
 *   2. COLUMNS — `visibleStatesFor` gives every existing kind exactly the columns it had before the
 *      Hold and Win states existed, under every gate; `holdAndWin` gets those eight and no book ones.
 *      `symbolStatesForKind` (the Scene Editor's state pickers) hides the eight Hold and Win states
 *      from every kind but `holdAndWin`.
 *   3. DEFAULTS — `symbolDefaultsFor('holdAndWin')` is its own set, validates, carries every symbol
 *      of every Hold and Win preset (art for all but the blank), and is a strict SUPERSET of the
 *      `lines` set it used to fall back to, binding for binding.
 *
 * Run:  pnpm --filter launcher-api check:symbols-kind-gating
 */

import { GAME_KINDS } from 'constants-shared/gameKinds';
import {
	HOLD_AND_WIN_SYMBOL_STATES,
	kindCapabilities,
	SYMBOL_STATES,
	symbolStatesForKind,
} from 'engine-layout';
import { HOLD_AND_WIN_PRESETS, symbolHoldAndWinRoles } from 'game-config';
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

// ── 3. defaults ─────────────────────────────────────────────────────────────────────────────────
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
