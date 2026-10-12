/**
 * The mock the Invisible Test Server deals a game from: its protocol's mock, built from the game's
 * contract (shape-checked by `validGrid`), with what composes over it (the coin overlay, the bet
 * table it sells). Its own module,
 * free of the server's start-up, so a gate can build exactly the mock the server builds
 * (`apps/launcher-api/scripts/check-deal-parity.ts`).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	createMockRgs as createLinesMock,
	MAX_ROUND_FREE_SPINS,
} from '../../scripts/mock-rgs-server.mjs';
import { createMockRgs as createBookMock } from '../../scripts/mock-rgs-server-book.mjs';
import { createMockRgs as createHoldAndWinMock } from '../../scripts/mock-rgs-server-holdandwin.mjs';
import { withPotsOverlay } from '../../scripts/mock-pots-overlay.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The lines game's authored grid, from the committed Game Config template default
 * (`gameConfig/lines.json`, generated from `apps/lines`' `config.ts` and drift-gated to match it).
 * The lines mock deals THIS grid so a spin shows the board the game draws (Invisible Game Config's
 * numReels/numRows/paylines) — the mock/game agree on dimensions AND paylines instead of the mock's
 * old fixed 5×3 + 5-line subset. Unreadable/odd JSON ⇒ null ⇒ the mock keeps its faithful defaults.
 *
 * Paylines come from the config as `{ id: rows[] }`; the mock wants `rows[][]`. They MUST be
 * numReels-wide — the config validator guarantees that, and passing them together with the reel
 * count keeps the two in lock-step.
 */
const linesGrid = (() => {
	try {
		const path = join(HERE, '../../apps/launcher-api/src/lib/data/gameConfig/lines.json');
		const doc = JSON.parse(readFileSync(path, 'utf8'));
		const reels = Math.max(1, Math.round(Number(doc.numReels)));
		const declared = doc.numRows ?? [3];
		const rows = Math.max(1, Math.round(Math.max(...declared)));
		const perReel = Array.from({ length: reels }, (_unused, i) =>
			Math.max(1, Math.round(Number(declared[i] ?? declared[declared.length - 1]))),
		);
		const paylines = Object.values(doc.paylines ?? {});
		if (!Number.isFinite(reels) || !paylines.length) return null;
		// `rowsPerReel` only when the columns differ — a rectangular board passes the exact object it
		// passed before stepped grids existed.
		const stepped = perReel.some((r) => r !== perReel[0]);
		return stepped ? { reels, rows, rowsPerReel: perReel, paylines } : { reels, rows, paylines };
	} catch {
		return null;
	}
})();

// `grid` is THIS project's own board, from its Game Config — read LIVE by `refreshContract` below,
// with the manifest entry's copy as the fallback. When present it deals the project's real
// numReels/numRows/paylines so the mock matches the client that authored e.g. 5 rows; absent ⇒ the
// shared `linesGrid` default (apps/lines). Book keeps its own shape and takes only the paytable.
/**
 * Protocols that cascade BY DEFAULT. A `cluster` / `scatter` game IS a tumble game — the cells that
 * paid leave the board and the survivors fall into the gap — so for those the cascade is the
 * MECHANIC, not a test fixture, and a game of that type that never tumbles is simply broken. Adding
 * a future tumble type here is the whole change needed on this side.
 *
 * Keying it off the protocol keeps every bit of safety the allowlist below was built for: a
 * `lines` or `book` game still cannot cascade by accident, so the shipped Book of Borut is
 * untouched with no env set at all.
 */
const CASCADE_PROTOCOLS = new Set(['cluster', 'scatter']);

/**
 * OVERRIDE for the protocols that do not cascade on their own, as a comma-separated list of game
 * keys (`CASCADE_GAMES=test1`), or `*` for all. This is how a `lines` game is made to exercise the
 * tumble overlay; for `cluster`/`scatter` it is redundant.
 *
 * Per-GAME rather than a bare on/off, because this one process serves every game: a global flag
 * would make the shipped Book of Borut cascade on every spin.
 */
const CASCADE_GAMES = new Set(
	(process.env.CASCADE_GAMES ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean),
);
/**
 * Does this game tumble, and WHY? The project's OWN authored answer wins (`cascade` in its manifest
 * entry, synced from its Game Config at publish), then the protocol default, then the env override.
 * A project can therefore turn the cascade off on a cluster game, or on for a lines game, which an
 * env-only gate could never express per project.
 *
 * The WHY matters as much as the answer, and used to be thrown away here. Only the env override is a
 * DEMO — a tumble bolted onto a game that does not have one, so a dead spin still tumbles and the
 * overlay is visible. A cascade the project declared (or the protocol implies) is the game's
 * MECHANIC, and a mechanic must not fire on a spin that paid nothing. Passing only the boolean left
 * the mock to guess from the win model, so an authored `ways` cascade was treated as a demo and blew
 * non-paying symbols off the board on every losing spin. Returns `{ on, demo }`.
 */
const cascadeEnabledFor = (gameKey, protocol, authored) => {
	if (typeof authored === 'boolean') return { on: authored, demo: false };
	if (CASCADE_PROTOCOLS.has(protocol)) return { on: true, demo: false };
	const forced = CASCADE_GAMES.has('*') || CASCADE_GAMES.has(gameKey);
	return { on: forced, demo: forced };
};

/**
 * The grid a lines-family mock is built from, less its bet TABLE unless the game prices one: served
 * from the shared runtime, or a desktop build stamped `tableCapable` (its manifest entry).
 *
 * The runtime has read `betOptions` since 2026-09-16, so it prices a table correctly. A desktop build
 * ships its own bundle, and one built before then sends `[5, betPerLine]` whatever the table says, so
 * every spin would be `invalid bet option 5` until it is rebuilt (`test1build`, `hotfruits`). Such a
 * game keeps the line-config game it was built against; a rebuild stamps it (`register-game`).
 */
const sellableGrid = (grid, sells) => {
	if (!grid?.betModes || sells) return grid;
	const board = { ...grid };
	delete board.betModes;
	return board;
};

/** Games already told their Hold and Win contract could not be dealt, so it is said once. */
const holdAndWinFallbackWarned = new Set();

/**
 * A Hold and Win game's mock, built from the `holdAndWin` inputs its contract carries (the project's
 * block, symbols and line pays — `holdAndWinMockInputs` in game-config). Inputs that are malformed,
 * or that the mock cannot stand up, leave the game dealt as the lines game its base game is, and it
 * says so once: a respin feature that never comes is otherwise indistinguishable from a broken one.
 */
const makeHoldAndWinMock = (label, grid, gameKey, runtime, twin, sells) => {
	try {
		if (grid.holdAndWinRejected) throw new Error('its holdAndWin inputs are malformed');
		// Forcing an outcome (a jackpot on demand) is an authoring tool: a runtime game's players
		// never get it, its authoring twin and a standalone build's one mock do.
		const allowForce = twin || !runtime;
		const opts = { label, allowForce, ...sellableGrid(grid, sells) };
		// A coin overlay over the Hold and Win base (bonus-games Phase 7a): its pots start this game's
		// own respin modes and free spins. One that cannot stand up deals the game without it.
		if (grid.potsOverlay) {
			try {
				return withPotsOverlay(createHoldAndWinMock, grid.potsOverlay)(opts);
			} catch (e) {
				if (!potsOverlayFallbackWarned.has(gameKey)) {
					potsOverlayFallbackWarned.add(gameKey);
					console.warn(
						`[test-server] '${gameKey}' has a pots overlay but ${e.message} — dealing its Hold ` +
							'and Win game with no pots. Check its Game Config coin overlay.',
					);
				}
			}
		}
		return createHoldAndWinMock(opts);
	} catch (e) {
		if (!holdAndWinFallbackWarned.has(gameKey)) {
			holdAndWinFallbackWarned.add(gameKey);
			console.warn(
				`[test-server] '${gameKey}' is a Hold and Win game but ${e.message} — dealing its base ` +
					'game as lines, with no respin feature. Check its Game Config holdAndWin block.',
			);
		}
		return null;
	}
};

/** Games already told their pots overlay could not be dealt, so it is said once. */
const potsOverlayFallbackWarned = new Set();

/**
 * A book game's mock, with the POTS OVERLAY composed over it when its contract carries the project's
 * `potsOverlay` inputs (`potsOverlayMockInputs` in game-config; `scripts/mock-pots-overlay.mjs`).
 * Without them it is the book mock exactly. An overlay that cannot be built deals the plain book game
 * and says so once, for the reason `makeHoldAndWinMock` gives.
 */
const makeBookMock = (label, grid, gameKey, runtime, twin) => {
	// The project's free-spins rule (`validGrid` shape-checked it), only where it departs: the overlay
	// composes over this same host, so it is passed through `withPotsOverlay` too.
	const opts = {
		label,
		symbolPaytable: grid?.symbolPaytable,
		symbols: grid?.symbols,
		...(grid?.freeSpins === false ? { freeSpins: false } : {}),
		...(grid?.freeSpinsTrigger ? { freeSpinsTrigger: grid.freeSpinsTrigger } : {}),
		...(grid?.freeSpinsAwards ? { freeSpinsAwards: grid.freeSpinsAwards } : {}),
	};
	if (!grid?.potsOverlay) return createBookMock(opts);
	try {
		// Forcing a beat is an authoring tool, as on the Hold and Win mock.
		return withPotsOverlay(
			createBookMock,
			grid.potsOverlay,
		)({ ...opts, allowForce: twin || !runtime });
	} catch (e) {
		if (!potsOverlayFallbackWarned.has(gameKey)) {
			potsOverlayFallbackWarned.add(gameKey);
			console.warn(
				`[test-server] '${gameKey}' has a pots overlay but ${e.message} — dealing its book game ` +
					'with no pots. Check its Game Config potsOverlay block.',
			);
		}
		return createBookMock(opts);
	}
};

/** Whether a game's client prices a bet-option table: a runtime game, or a desktop build stamped
 *  table-capable. The one rule `makeMock` sells by and every carry of a session follows. */
export const sellsTable = (meta) => Boolean(meta?.runtime) || meta?.tableCapable === true;

export const makeMock = (
	protocol,
	label,
	grid,
	gameKey,
	cascade,
	runtime,
	twin = false,
	tableCapable = false,
) => {
	// Whether this game's client prices a bet-option table (see `sellableGrid`).
	const sells = sellsTable({ runtime, tableCapable });
	// A Hold and Win game: a lines contract carrying the base-game Hold and Win inputs (the launcher
	// sends them for a `holdAndWin`-kind project, with its coin overlay's `potsOverlay` when one
	// drops; another kind's overlay bonus rides `potsOverlay` alone), or ones
	// that were sent but rejected, which its mock reports before the game is dealt as lines.
	if (protocol === 'lines' && (grid?.holdAndWin || grid?.holdAndWinRejected)) {
		const mock = makeHoldAndWinMock(label, grid, gameKey, runtime, twin, sells);
		if (mock) return mock;
	}
	if (grid?.holdAndWinRejected) {
		grid = { ...grid };
		delete grid.holdAndWinRejected;
	}
	// `book` owns its board and paylines; what it reads of the contract is the project's authored line
	// table, so it pays (and declares) what `/config` set rather than its captured one, its in-play
	// pool, so it never deals a symbol `/config` marks unused, its pots overlay and its free-spins rule.
	if (protocol === 'book') return makeBookMock(label, grid, gameKey, runtime, twin);
	// A Hold and Win game lands here only when its own mock could not be built (above).
	// `ways` reuses the lines mock entirely and only swaps how wins are DECIDED — the session, round
	// lifecycle, scatter pass and event vocabulary are identical between them, which is why this is
	// an option rather than a third forked mock. See docs/design/game-type-templates.md (Phase D).
	const winModel = ['ways', 'cluster', 'scatter'].includes(protocol) ? protocol : 'lines';
	const tumble = cascadeEnabledFor(gameKey, protocol, cascade);
	const opts = {
		label,
		winModel,
		// Explicit boolean either way — an absent value would let the mock fall back to the
		// process-wide `CASCADE` env and cascade every game on this server.
		cascade: tumble.on,
		// …and whether it is the game's MECHANIC or the demo override, which only this side knows.
		cascadeDemo: tumble.demo,
		...(sellableGrid(grid, sells) ?? linesGrid ?? {}),
	};
	// The pots overlay composes over the lines mock as over the book mock (`makeBookMock`): with the
	// project's `potsOverlay` inputs it is the add-on over this game, without them the game exactly. One
	// that cannot be built deals the plain game and says so once.
	if (!grid?.potsOverlay) return createLinesMock(opts);
	try {
		return withPotsOverlay(
			createLinesMock,
			grid.potsOverlay,
		)({ ...opts, allowForce: twin || !runtime });
	} catch (e) {
		if (!potsOverlayFallbackWarned.has(gameKey)) {
			potsOverlayFallbackWarned.add(gameKey);
			console.warn(
				`[test-server] '${gameKey}' has a pots overlay but ${e.message} — dealing its game ` +
					'with no pots. Check its Game Config potsOverlay block.',
			);
		}
		return createLinesMock(opts);
	}
};

const BET_MODE_KINDS = new Set(['base', 'ante', 'buy']);
/** Names the client's `betOptionIndexFor` reads as something else: the base option, or an unnamed
 *  option by position. An extra mode called either could never be bought. */
const RESERVED_BET_MODE = /^(base|default|option\d+)$/;

/**
 * A manifest's `betModes` (BASE FIRST, then each ante/buy the project authored), or null. Validated
 * WHOLE: a malformed entry drops the list rather than leaving a price table with a hole in it, and a
 * dropped list leaves the game a line-config game, which is what it was before this existed. Names
 * must stay distinct once normalised, because the client matches an option to its card by name.
 */
const validBetModes = (raw) => {
	if (!Array.isArray(raw) || raw.length < 2) return null;
	const seen = new Set();
	for (const [index, entry] of raw.entries()) {
		const key =
			typeof entry?.mode === 'string' ? entry.mode.replace(/[^a-z0-9]/gi, '').toLowerCase() : '';
		const isBase = index === 0;
		const ok =
			key &&
			!seen.has(key) &&
			(isBase || !RESERVED_BET_MODE.test(key)) &&
			typeof entry.cost === 'number' &&
			Number.isFinite(entry.cost) &&
			entry.cost > 0 &&
			BET_MODE_KINDS.has(entry.kind) &&
			isBase === (entry.kind === 'base');
		if (!ok) return null;
		seen.add(key);
	}
	return raw.map(({ mode, cost, kind }) => ({ mode, cost, kind }));
};

/** Lists already reported, so a contract re-read every few seconds says it once, not every time. */
const droppedBetModes = new Set();
/** A dropped list turns the game back into "the card shows a price, the base stake is charged" —
 *  the very bug the table exists to fix — so it is never dropped quietly. */
const warnDroppedBetModes = (raw) => {
	const text = JSON.stringify(raw);
	if (droppedBetModes.has(text)) return;
	droppedBetModes.add(text);
	console.warn(`[test-server] ignored a malformed betModes list, so no bet table: ${text}`);
};

/** Accept a manifest `grid` only when it is well-formed (reels + rows + numReels-wide paylines); any
 *  malformed entry ⇒ null ⇒ the mock keeps its shared default. Defensive: the manifest is external.
 *  A well-formed `wild` ({ paytable: occurs→multiplier }) is passed through so the mock deals + pays
 *  the project's in-play wild; a malformed wild is simply dropped (the grid still stands). */
/** Bounds on an expanding-special draw table from an external manifest (see `validGrid`). */
const MAX_EXPANDING_CANDIDATES = 32;
const MAX_EXPANDING_WEIGHT = 1_000_000;

export const validGrid = (grid) => {
	if (!grid || typeof grid !== 'object') return null;
	const reels = Math.round(Number(grid.reels));
	const rows = Math.round(Number(grid.rows));
	const paylines = Array.isArray(grid.paylines) ? grid.paylines : [];
	// Per-column heights, defensively validated like everything else off the external manifest: it
	// must be a `reels`-long list of positive integers, or it is dropped and the board stays
	// rectangular. A malformed entry must not be able to deal a column of NaN cells.
	const rawPerReel = Array.isArray(grid.rowsPerReel) ? grid.rowsPerReel.map(Number) : null;
	const rowsPerReel =
		rawPerReel &&
		rawPerReel.length === reels &&
		rawPerReel.every((r) => Number.isFinite(r) && r > 0 && r <= rows)
			? rawPerReel.map((r) => Math.round(r))
			: null;
	// A `cluster` grid legitimately carries NO paylines (nothing pays along a line), so the payline
	// requirement holds only when there are paylines to check. An empty list is valid; a malformed
	// one is still rejected.
	const shaped =
		reels > 0 && rows > 0 && paylines.every((line) => Array.isArray(line) && line.length === reels);
	if (!shaped) return null;
	const wildPay = grid.wild && typeof grid.wild === 'object' ? grid.wild.paytable : null;
	const wild =
		wildPay && typeof wildPay === 'object' && Object.keys(wildPay).length
			? { paytable: wildPay }
			: null;
	// `stacked` (set at publish when the project turned stacked-pictures ON) makes the mock deal
	// contiguous tall-symbol runs — incl. guaranteed edge cutoffs — so the stacked-picture reel mode has
	// data to render. Absent/false ⇒ the normal weighted deal. See mock-rgs-server `spinReelsStacked`.
	const stacked = grid.stacked === true;
	// `symbols` (set at publish from the project's in-play Game Config) is the allowed line-symbol pool
	// in the mock's SERVER vocabulary (PIC*/SCAT). The mock draws its board ONLY from it, so a symbol the
	// user marked UNUSED never lands. Accepted only as a non-empty array of strings; absent/malformed ⇒
	// dropped ⇒ the mock keeps its full default pool. See `createMockRgs({ symbols })` in mock-rgs-server
	// and mock-rgs-server-book.
	const symbols =
		Array.isArray(grid.symbols) &&
		grid.symbols.every((s) => typeof s === 'string') &&
		grid.symbols.length
			? grid.symbols
			: null;
	// Cluster geometry, forwarded verbatim so the mock pays the shape the project's win model
	// declares. Defensive like the rest: a malformed value is dropped and the mock's own defaults
	// (5 / orthogonal, matching `normalizeWinModel`) stand.
	const minCluster =
		Number.isFinite(Number(grid.minCluster)) && Number(grid.minCluster) >= 2
			? Math.round(Number(grid.minCluster))
			: null;
	const adjacency =
		grid.adjacency === 'diagonal' || grid.adjacency === 'orthogonal' ? grid.adjacency : null;
	const minCount =
		Number.isFinite(Number(grid.minCount)) && Number(grid.minCount) >= 2
			? Math.round(Number(grid.minCount))
			: null;
	// The project's count-keyed paytable, forwarded verbatim. Shape-checked rather than trusted: the
	// manifest is external, and a malformed table would leave every scatter win silently unpriced.
	const symbolPaytable =
		grid.symbolPaytable &&
		typeof grid.symbolPaytable === 'object' &&
		Object.keys(grid.symbolPaytable).length &&
		Object.values(grid.symbolPaytable).every(
			(row) =>
				row && typeof row === 'object' && Object.values(row).every((v) => typeof v === 'number'),
		)
			? grid.symbolPaytable
			: null;
	// The project's authored SCATTER pays (count → × total stake), same shape rule as the line table.
	const scatterPaytable =
		grid.scatterPaytable &&
		typeof grid.scatterPaytable === 'object' &&
		Object.keys(grid.scatterPaytable).length &&
		Object.values(grid.scatterPaytable).every((v) => typeof v === 'number')
			? grid.scatterPaytable
			: null;
	// `multiplier` (set at publish when the project declares a multiplier symbol IN PLAY) lets a
	// cascading scatter game land multiplier cells during a tumble and collect them afterwards.
	// Absent/false ⇒ the mock deals none, so a project with no multiplier art never gets blank
	// cells. See mock-rgs-server `collectFixture`.
	const multiplier = grid.multiplier === true;
	// The authored bet modes, when the project sells something beyond the base bet: the lines mock
	// declares a `betOptions` table from them and prices `bet [x, M]` by it. See `validBetModes`.
	const betModes = validBetModes(grid.betModes);
	if (grid.betModes !== undefined && !betModes) warnDroppedBetModes(grid.betModes);
	// `freeSpins: false` (the project turned free spins OFF in `/config`) stops the lines mock
	// entering the feature; scatters still land and pay. Only `false` is forwarded; absent ⇒ on.
	const freeSpinsOff = grid.freeSpins === false;
	// The free-spins TRIGGER when it departs from 3+ SCAT: a server symbol name and a count.
	// Malformed ⇒ dropped ⇒ the mock's own 3+ SCAT rule.
	const trigger = grid.freeSpinsTrigger;
	const freeSpinsTrigger =
		trigger &&
		typeof trigger === 'object' &&
		typeof trigger.symbol === 'string' &&
		trigger.symbol.length > 0 &&
		Number.isInteger(trigger.count) &&
		trigger.count >= 1
			? { symbol: trigger.symbol, count: trigger.count }
			: null;
	// The free-spins AWARDS when they depart from the mock's own defaults (10 / +5 on the lines mock,
	// 10 / +10 on the book mock) or random is on: two tables of `{ count, spins, maxSpins? }` rows and
	// the random switch. Validated WHOLE, like `betModes` — a table with a hole in it is worse than
	// the default — so malformed ⇒ the mock's own defaults.
	// Bounded too: no row awards past a round's cap (`MAX_ROUND_FREE_SPINS`), and a table has no more
	// rows than the board has cells — the count it could ever land.
	const spinCount = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_ROUND_FREE_SPINS;
	const awardRows = (table) =>
		Array.isArray(table) &&
		table.length > 0 &&
		table.length <= reels * rows &&
		table.every(
			(row) =>
				row &&
				Number.isInteger(row.count) &&
				row.count >= 1 &&
				spinCount(row.spins) &&
				(row.maxSpins === undefined || (spinCount(row.maxSpins) && row.maxSpins >= row.spins)),
		)
			? table.map(({ count, spins, maxSpins }) => ({
					count,
					spins,
					...(maxSpins === undefined ? {} : { maxSpins }),
				}))
			: null;
	const awards = grid.freeSpinsAwards;
	const entryAwards = awards && typeof awards === 'object' ? awardRows(awards.awards) : null;
	const retriggerAwards = awards && typeof awards === 'object' ? awardRows(awards.retrigger) : null;
	const freeSpinsAwards =
		entryAwards && retriggerAwards && typeof awards.random === 'boolean'
			? { awards: entryAwards, retrigger: retriggerAwards, random: awards.random }
			: null;
	// The Book-of expanding special (game-config's `resolveExpandingSymbol`, in server names): a
	// candidate per symbol it may be drawn as. Validated WHOLE — a draw table with a hole in it would
	// deal a different game — so malformed ⇒ dropped ⇒ no special. Bounded like the award tables: no
	// more candidates than a pool has names, and a weight a draw can sum without losing precision.
	const candidates = grid.expandingSymbol?.candidates;
	const expandingSymbol =
		Array.isArray(candidates) &&
		candidates.length > 0 &&
		candidates.length <= MAX_EXPANDING_CANDIDATES &&
		candidates.every(
			(c) =>
				c &&
				typeof c.symbol === 'string' &&
				c.symbol.length > 0 &&
				Number.isFinite(c.weight) &&
				c.weight > 0 &&
				c.weight <= MAX_EXPANDING_WEIGHT &&
				Number.isInteger(c.minReels) &&
				c.minReels >= 1 &&
				c.minReels <= reels,
		)
			? {
					candidates: candidates.map(({ symbol, weight, minReels }) => ({
						symbol,
						weight,
						minReels,
					})),
				}
			: null;
	// The in-play scatter is also wild (the Book-of book): it substitutes on lines. Only `true`.
	const scatterWild = grid.scatterWild === true;
	// A Hold and Win game's inputs: its block, line symbols and symbol roles/pays. Shape-checked only
	// as far as the mock needs to stand up; everything inside was normalized by the launcher.
	const symbolsShaped = (symbols) =>
		Boolean(symbols) &&
		typeof symbols === 'object' &&
		Object.values(symbols).every((sym) => sym && Array.isArray(sym.roles));
	// Its respin modes, when it has more than the default one: each its id, strip key, rules, blank and
	// the symbols it deals.
	const respinModesShaped = (modes) =>
		modes === undefined ||
		(Array.isArray(modes) &&
			modes.length > 0 &&
			modes.every(
				(m) =>
					m &&
					typeof m.mode === 'string' &&
					typeof m.gameType === 'string' &&
					typeof m.blank === 'string' &&
					m.block &&
					typeof m.block === 'object' &&
					symbolsShaped(m.symbols),
			));
	const holdAndWinShaped = (hw) =>
		Boolean(
			hw &&
			typeof hw === 'object' &&
			hw.block &&
			typeof hw.block === 'object' &&
			Array.isArray(hw.lineSymbols) &&
			hw.lineSymbols.every((s) => typeof s === 'string') &&
			symbolsShaped(hw.symbols) &&
			respinModesShaped(hw.modes),
		);
	const holdAndWin = holdAndWinShaped(grid.holdAndWin) ? grid.holdAndWin : null;
	// Present but malformed: still a Hold and Win game, whose mock says why it cannot be dealt.
	const holdAndWinRejected = grid.holdAndWin !== undefined && !holdAndWin;
	// A spins mode's own game (`packages/game-config/src/spinsGame.ts`): its grid, model, paylines
	// and spin count, as `reelsModeMockInput` builds it.
	const spinsGameShaped = (game) =>
		Boolean(game) &&
		Number.isInteger(game.reels) &&
		game.reels > 0 &&
		Array.isArray(game.rows) &&
		game.rows.length === game.reels &&
		game.rows.every((r) => Number.isInteger(r) && r > 0) &&
		['lines', 'ways', 'cluster', 'scatter'].includes(game.winModel?.type) &&
		Array.isArray(game.paylines) &&
		game.paylines.every((l) => Array.isArray(l) && l.length === game.reels) &&
		Number.isInteger(game.spins) &&
		game.spins > 0;
	// An overlay's REELS modes of the project's own (an imported free spins, or a spins mode with a
	// `game` of its own): per mode, the strips its spins are drawn from (one per reel, names) and the
	// line pays of its own symbols.
	const reelsModesShaped = (modes) =>
		Boolean(modes) &&
		typeof modes === 'object' &&
		Object.values(modes).every(
			(m) =>
				m &&
				typeof m.gameType === 'string' &&
				Array.isArray(m.strips) &&
				m.strips.length > 0 &&
				m.strips.every(
					(s) => Array.isArray(s) && s.length && s.every((n) => typeof n === 'string'),
				) &&
				m.paytable &&
				typeof m.paytable === 'object' &&
				(m.game === undefined || spinsGameShaped(m.game)),
		);
	// A pots overlay's inputs (a book game's add-on), shape-checked as far as the overlay needs to
	// stand up; its Hold and Win bonus, when it has one, like a Hold and Win game's. `pots: []` is a
	// coins-only overlay; one with neither pots nor coins is refused by the overlay itself, loudly.
	const po = grid.potsOverlay;
	const potsOverlay =
		po &&
		typeof po === 'object' &&
		Array.isArray(po.pots) &&
		po.pots.every(
			(p) =>
				p &&
				typeof p.id === 'string' &&
				typeof p.token === 'string' &&
				Number.isFinite(Number(p.maxLevel)) &&
				typeof p.bonus?.mode === 'string',
		) &&
		po.drops &&
		typeof po.drops === 'object' &&
		Array.isArray(po.drops.table) &&
		(po.holdAndWin === undefined || holdAndWinShaped(po.holdAndWin)) &&
		(po.modes === undefined || reelsModesShaped(po.modes))
			? po
			: null;
	// A malformed overlay deals the game without it, so say so rather than lose it silently.
	if (po && !potsOverlay) {
		console.warn(
			'[test-server] ignored a malformed potsOverlay (its pots, drops, Hold and Win or reels modes)',
		);
	}
	return {
		reels,
		rows,
		...(rowsPerReel ? { rowsPerReel } : {}),
		paylines,
		...(wild ? { wild } : {}),
		...(multiplier ? { multiplier: true } : {}),
		...(stacked ? { stacked: true } : {}),
		...(symbols ? { symbols } : {}),
		...(minCluster ? { minCluster } : {}),
		...(adjacency ? { adjacency } : {}),
		...(minCount ? { minCount } : {}),
		...(symbolPaytable ? { symbolPaytable } : {}),
		...(scatterPaytable ? { scatterPaytable } : {}),
		...(betModes ? { betModes } : {}),
		...(holdAndWin ? { holdAndWin } : {}),
		...(holdAndWinRejected ? { holdAndWinRejected: true } : {}),
		...(potsOverlay ? { potsOverlay } : {}),
		...(freeSpinsOff ? { freeSpins: false } : {}),
		...(freeSpinsTrigger ? { freeSpinsTrigger } : {}),
		...(freeSpinsAwards ? { freeSpinsAwards } : {}),
		...(expandingSymbol ? { expandingSymbol } : {}),
		...(scatterWild ? { scatterWild: true } : {}),
	};
};
