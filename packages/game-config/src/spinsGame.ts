import { MAX_FREE_SPINS_PER_ROUND, DEFAULT_FREE_SPINS_AWARD } from './freeSpins';
import { resolveGrid } from './grid';
import {
	count,
	isObject,
	normalizeNumRows,
	normalizePaylines,
	normalizePaytable,
} from './normalizeParts';
import type {
	GameConfigDoc,
	GameConfigSymbol,
	GridAlign,
	Paylines,
	PaytableRow,
	WinModel,
} from './types';
import { normalizeWinModel, resolveWinModel } from './winModel';

/**
 * A SPINS BONUS MODE (`docs/design/bonus-games.md` §0, Phase 8): a bonus that plays N spins of a
 * lines / ways / cluster / scatter game on its own grid, paylines and paytable, adds up the wins, then
 * returns to the base game. It is a `reels` mode of the project's own carrying `spins`; its strips
 * are `paddingReels[gameType]`, as for every reels mode, and its symbols live in the one dictionary.
 *
 * SPARSE with the host as the fallback: an absent win model, grid, payline table or paytable row
 * means the base game's. A reels mode without `spins` is an imported free spins (`./imports`), played
 * on the host's game with its own strips, exactly as before this block existed.
 */
export type SpinsGame = {
	/** How many spins it plays, exactly: a spins mode does not retrigger. */
	spins: number;
	/** Absent ⇒ the host's. Stored even when `lines`, because the host may be another model. */
	winModel?: WinModel;
	/** The grid, both or neither: absent ⇒ the host's. */
	numReels?: number;
	numRows?: number[];
	/** A lines game's paylines; absent ⇒ the host's. */
	paylines?: Paylines;
	/** Pays that differ from the dictionary's, by symbol. Absent ⇒ the dictionary's. */
	paytable?: Record<string, PaytableRow[]>;
};

/** A spins mode's game with every fallback to the host applied: what the mock and the board read. */
export type SpinsGameView = {
	spins: number;
	winModel: WinModel;
	numReels: number;
	numRows: number[];
	gridAlign?: GridAlign;
	paylines: Paylines;
	symbols: Record<string, GameConfigSymbol>;
};

const normalizeSpinsWinModel = (raw: unknown): WinModel | undefined =>
	isObject(raw) && raw.type === 'lines' ? { type: 'lines' } : normalizeWinModel(raw);

/** Normalize an authored `spins` block, or `undefined` when there is none. */
export function normalizeSpinsGame(raw: unknown): SpinsGame | undefined {
	if (!isObject(raw)) return undefined;
	const n = count(raw.spins);
	const game: SpinsGame = {
		spins: n && n >= 1 ? Math.min(n, MAX_FREE_SPINS_PER_ROUND) : DEFAULT_FREE_SPINS_AWARD,
	};
	const winModel = normalizeSpinsWinModel(raw.winModel);
	if (winModel) game.winModel = winModel;
	const declaredReels = count(raw.numReels);
	const numReels =
		declaredReels && declaredReels > 0
			? declaredReels
			: Array.isArray(raw.numRows) && raw.numRows.length
				? raw.numRows.length
				: undefined;
	if (numReels) {
		game.numReels = numReels;
		game.numRows = normalizeNumRows(raw.numRows, numReels);
	}
	const paylines = normalizePaylines(raw.paylines);
	if (Object.keys(paylines).length) game.paylines = paylines;
	if (isObject(raw.paytable)) {
		const paytable: Record<string, PaytableRow[]> = {};
		for (const [name, rows] of Object.entries(raw.paytable)) {
			const table = name ? normalizePaytable(rows) : undefined;
			if (table) paytable[name] = table;
		}
		if (Object.keys(paytable).length) game.paytable = paytable;
	}
	return game;
}

type HostGame = Pick<
	GameConfigDoc,
	'winModel' | 'numReels' | 'numRows' | 'gridAlign' | 'paylines' | 'symbols'
>;

/** The game a spins mode plays, its gaps filled from the host. */
export function spinsGameView(doc: HostGame, game: SpinsGame): SpinsGameView {
	const ownGrid = game.numReels !== undefined && game.numRows !== undefined;
	const symbols: Record<string, GameConfigSymbol> = { ...doc.symbols };
	for (const [name, paytable] of Object.entries(game.paytable ?? {})) {
		symbols[name] = { ...symbols[name], paytable };
	}
	return {
		spins: game.spins,
		winModel: game.winModel ?? resolveWinModel(doc),
		numReels: ownGrid ? game.numReels! : doc.numReels,
		numRows: ownGrid ? game.numRows! : doc.numRows,
		...(!ownGrid && doc.gridAlign ? { gridAlign: doc.gridAlign } : {}),
		paylines: game.paylines ?? doc.paylines,
		symbols,
	};
}

export type SpinsGameIssue = { path: string; message: string; severity: 'error' | 'warning' };

/**
 * What makes a game's board unpayable or undrawable, for the base game and every spins mode alike:
 * a win threshold the grid cannot reach, a payline off the grid. `prefix` is the path the game sits
 * at (`''` for the doc, `modes.<id>.spins.` for a mode).
 */
export function winModelIssues(
	game: Pick<SpinsGameView, 'winModel' | 'numReels' | 'numRows' | 'paylines'>,
	prefix = '',
): SpinsGameIssue[] {
	const issues: SpinsGameIssue[] = [];
	const { winModel } = game;
	const cells = game.numRows.reduce((sum, rows) => sum + rows, 0);
	if (winModel.type === 'ways' && winModel.minKind > game.numReels) {
		issues.push({
			severity: 'error',
			path: `${prefix}winModel.minKind`,
			message: `Ways wins need ${winModel.minKind} adjacent reels but the grid is only ${game.numReels} wide, so nothing can ever pay.`,
		});
	}
	if (winModel.type === 'cluster' && winModel.minCluster > cells) {
		issues.push({
			severity: 'error',
			path: `${prefix}winModel.minCluster`,
			message: `A cluster needs ${winModel.minCluster} cells but the grid only has ${cells}, so nothing can ever pay.`,
		});
	}
	if (winModel.type === 'scatter' && winModel.minCount > cells) {
		issues.push({
			severity: 'error',
			path: `${prefix}winModel.minCount`,
			message: `A scatter win needs ${winModel.minCount} symbols but the grid only has ${cells} cells, so nothing can ever pay.`,
		});
	}
	for (const [id, rows] of winModel.type === 'lines' ? Object.entries(game.paylines) : []) {
		if (rows.length !== game.numReels) {
			issues.push({
				severity: 'error',
				path: `${prefix}paylines.${id}`,
				message: `Payline ${id} covers ${rows.length} reels but the grid is ${game.numReels} wide.`,
			});
			continue;
		}
		rows.forEach((row, reel) => {
			const height = game.numRows[reel] ?? 0;
			if (row >= height) {
				issues.push({
					severity: 'error',
					path: `${prefix}paylines.${id}`,
					message: `Payline ${id} points at row ${row + 1} on reel ${reel + 1}, which has ${height} rows.`,
				});
			}
		});
	}
	return issues;
}

/**
 * What is wrong with one spins mode: its strips must fill its own grid, its game must be able to pay,
 * and every pay it states must be for a symbol the dictionary has.
 */
export function validateSpinsGame(
	doc: GameConfigDoc,
	mode: { id: string; spins: SpinsGame },
	gameType: string,
): SpinsGameIssue[] {
	const view = spinsGameView(doc, mode.spins);
	const prefix = `modes.${mode.id}.spins.`;
	const issues = winModelIssues(view, prefix);
	if (view.winModel.type === 'lines' && !Object.keys(view.paylines).length) {
		issues.push({
			severity: 'error',
			path: `${prefix}paylines`,
			message: 'A lines game needs paylines, so nothing can ever pay.',
		});
	}
	const strips = doc.paddingReels[gameType] ?? [];
	if (strips.length && strips.length !== view.numReels) {
		issues.push({
			severity: 'error',
			path: `paddingReels.${gameType}`,
			message: `${gameType} has ${strips.length} reel strips but the mode ${mode.id} is ${view.numReels} reels wide.`,
		});
	}
	const grid = resolveGrid(view);
	strips.forEach((strip, reel) => {
		const visible = grid.rowsForReel(reel);
		if (strip.length && strip.length < visible) {
			issues.push({
				severity: 'error',
				path: `paddingReels.${gameType}.${reel}`,
				message: `Reel ${reel + 1} strip has ${strip.length} cells, fewer than the ${visible} visible rows.`,
			});
		}
	});
	for (const name of Object.keys(mode.spins.paytable ?? {})) {
		if (!doc.symbols[name]) {
			issues.push({
				severity: 'warning',
				path: `${prefix}paytable.${name}`,
				message: `${name} is not in the symbol dictionary, so this pay can never be dealt.`,
			});
		}
	}
	return issues;
}
