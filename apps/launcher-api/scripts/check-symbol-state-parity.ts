/**
 * Parity check between the two rules that decide WHICH ART a symbol×state cell shows:
 *
 *   - the ENGINE's `resolveSymbolState` (`apps/lines/src/game/symbolCell.ts`) — what ships;
 *   - the TOOL's `effectiveCell` (`/symbols`) — what the author is shown.
 *
 * They are separate implementations (one is dependency-free and runs in the game, the other merges
 * an override doc over published defaults in the browser), and they drifted: `tumbleExplosion`
 * inherited `explosion` in the game but read `unset` in the grid, so an empty column that silently
 * worked kept getting re-authored by hand. This pins them together.
 *
 * ONE divergence is deliberate and asserted here rather than fixed: the engine's LAST resort, where
 * any unauthored state falls back to `static`. That arm is a crash-guard — mirroring it in the grid
 * would paint every unbound cell with the symbol's resting art and destroy the only signal the grid
 * has for "nothing is bound here". The tool says `unset` and puts the fallback in the tooltip.
 *
 * Run:  npx tsx scripts/check-symbol-state-parity.ts     (from apps/launcher-api)
 */

import { resolveSymbolState, type StateMapLike } from '../../lines/src/game/symbolCell.ts';
import {
	SYMBOL_STATES,
	effectiveCell,
	type SymbolCell,
	type SymbolState,
	type SymbolsDoc,
	type SymbolDefaults,
} from '../src/routes/(app)/symbols/symbols.client.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const spine = (assetKey: string): SymbolCell => ({ type: 'spine', assetKey });

/** The states the tool models as inheriting another's binding. Everything else the engine resolves
 *  by its `static` last resort, which the tool deliberately does not draw (see the header). */
const TOOL_INHERITS: Partial<Record<SymbolState, SymbolState>> = {
	bookIntro: 'win',
	bookIdle: 'win',
	tumbleExplosion: 'explosion',
};

/**
 * Run one symbol's state map through BOTH rules, for every state, and assert they agree.
 * `where` says whether the map is an authored override or a published default — the tool merges
 * them into the same lookup the engine gets, so both placements must give the same answer.
 */
function parity(label: string, map: Record<string, SymbolCell>, where: 'doc' | 'defaults'): void {
	const states = map as StateMapLike;
	const doc: SymbolsDoc = { version: 1, symbols: where === 'doc' ? { X: map } : {} };
	const defaults: SymbolDefaults = {
		version: 1,
		gameType: 'lines',
		symbols: where === 'defaults' ? { X: map } : {},
	};

	for (const state of SYMBOL_STATES) {
		const drawn = resolveSymbolState(states, state);
		const eff = effectiveCell(doc, defaults, 'X', state);
		const at = `${label} [${where}] · ${state}`;

		if (drawn === state) {
			check(`${at} → its own binding`, eff.cell, map[state]);
			check(`${at} → not marked inherited`, eff.inheritedFrom, undefined);
			continue;
		}
		if (drawn && drawn === TOOL_INHERITS[state]) {
			check(`${at} → inherits ${drawn}`, eff.cell, map[drawn]);
			check(`${at} → names its donor`, eff.inheritedFrom, drawn);
			continue;
		}
		// The engine reached its `static` last resort (or found nothing at all). The tool shows the
		// cell as unbound — the documented divergence, pinned so it stays a decision, not a drift.
		check(`${at} → unset in the grid (engine draws ${drawn ?? 'nothing'})`, eff.cell, undefined);
	}
}

const FULL = {
	static: spine('x_static'),
	spin: spine('x_spin'),
	land: spine('x_land'),
	win: spine('x_win'),
	postWinStatic: spine('x_post'),
	explosion: spine('x_boom'),
	tumbleExplosion: spine('x_tumble_boom'),
	bookIntro: spine('x_book_intro'),
	bookIdle: spine('x_book_idle'),
	stacked: spine('x_stacked'),
};

// Every state bound: nothing inherits, both rules return the cell's own binding.
parity('every state bound', FULL, 'doc');
parity('every state bound', FULL, 'defaults');

// The reported case: one explosion bound, the cascade column left empty. The engine plays the
// `explosion` binding; the grid used to say `unset`.
const { tumbleExplosion: _t, bookIntro: _bi, bookIdle: _bd, ...ONE_EXPLOSION } = FULL;
parity('one explosion, no tumble binding', ONE_EXPLOSION, 'doc');
parity('one explosion, no tumble binding', ONE_EXPLOSION, 'defaults');

// A published default binds `bookIntro` itself. The tool used to jump straight to `win` and show
// the wrong art for a state the game resolves to its own binding.
const OWN_BOOK_INTRO = { static: FULL.static, win: FULL.win, bookIntro: FULL.bookIntro };
parity('bookIntro bound in its own right', OWN_BOOK_INTRO, 'defaults');

// Nothing but `static` — every other state hits the engine's last resort and reads `unset` here.
parity('static only', { static: FULL.static }, 'doc');

// The crash shape from `symbolCell.fixture.ts`: typed, but with nothing to render.
const doc: SymbolsDoc = { version: 1, symbols: { X: { win: { type: 'spine', assetKey: '' } } } };
const defaults: SymbolDefaults = { version: 1, gameType: 'lines', symbols: {} };
check(
	'an assetless cell is not a binding',
	effectiveCell(doc, defaults, 'X', 'win').cell?.assetKey,
	'',
);
check(
	'...and is not inherited by a book state',
	effectiveCell(doc, defaults, 'X', 'bookIntro').cell,
	undefined,
);

console.log(
	failures === 0 ? '\nsymbol-state parity: OK' : `\nsymbol-state parity: ${failures} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
