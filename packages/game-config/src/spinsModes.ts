/**
 * The WRITERS of a spins bonus mode (`./spinsGame`, bonus-games Phase 8b): what `/config` → Bonus
 * modes and the Game Maker's import do to a doc to add one, remove one, or move it onto a grid of
 * its own. Each works on the split form only, as every bonus-mode writer does (`./bonusModes`).
 *
 * A spins mode's strips are `paddingReels[<its game type>]` and are as wide as ITS grid
 * ({@link stripWidthFor}), so the base grid's "match the width" fixes never touch them.
 */

import type { AddOnRenames, AddOnResult } from './addOns';
import { bonusImportOf } from './bonusImports';
import { splitFormOf } from './bonusGames';
import { reroutePots } from './bonusModes';
import { normalizeCoinOverlay, retargetRoutes } from './coinOverlay';
import { GAME_MODE_ID, gameTypeForMode, resolveGameModes, type GameModeDecl } from './modes';
import type { SpinsGame } from './spinsGame';
import type { GameConfigDoc, PaddingReels, WinModel, WinModelType } from './types';

/** The games a spins mode can play N spins of. */
export const SPINS_WIN_MODEL_TYPES: readonly WinModelType[] = [
	'lines',
	'ways',
	'cluster',
	'scatter',
];

/** Each win model with its usual thresholds — what picking a type in `/config` starts from. */
export function spinsWinModelFor(type: WinModelType): WinModel {
	switch (type) {
		case 'ways':
			return { type: 'ways', direction: 'ltr', minKind: 3 };
		case 'cluster':
			return { type: 'cluster', minCluster: 5, adjacency: 'orthogonal' };
		case 'scatter':
			return { type: 'scatter', minCount: 8 };
		default:
			return { type: 'lines' };
	}
}

const SPINS_MODE_ID = 'spinsBonus';
const DEFAULT_SPINS = 10;

/** The game types a strip set or a mode already uses: a new mode's own must be none of them. */
const takenGameTypes = (doc: GameConfigDoc): Set<string> =>
	new Set([...Object.keys(doc.paddingReels), ...resolveGameModes(doc).map(gameTypeForMode)]);

/** Why `id` cannot name a new spins mode (it is also its game type), or `undefined`. */
export function spinsModeIdProblem(doc: GameConfigDoc, id: string): string | undefined {
	if (!GAME_MODE_ID.test(id)) return 'Start with a letter; letters, digits, _ and - only.';
	if (resolveGameModes(doc).some((m) => m.id === id)) return `A mode "${id}" already exists.`;
	if (takenGameTypes(doc).has(id)) return `"${id}" already names a strip set of this project.`;
	return undefined;
}

/** `wanted` when free, else its base with the first free `_2`, `_3`… */
export function freeSpinsModeId(doc: GameConfigDoc, wanted = SPINS_MODE_ID): string {
	if (!spinsModeIdProblem(doc, wanted)) return wanted;
	const base = wanted.replace(/_\d+$/, '');
	let n = 2;
	while (spinsModeIdProblem(doc, `${base}_${n}`)) n += 1;
	return `${base}_${n}`;
}

/** `strips` cycled or cut to `width` reels, each a fresh copy. */
export function stripsToWidth(strips: PaddingReels[string], width: number): PaddingReels[string] {
	if (!strips.length) return [];
	return Array.from({ length: width }, (_unused, reel) =>
		strips[reel % strips.length].map((cell) => ({ ...cell })),
	);
}

/**
 * How many reels the strips of `gameType` must have: the grid of the spins mode on its own grid that
 * pads from them, else the base grid.
 */
export function stripWidthFor(
	doc: Pick<GameConfigDoc, 'holdAndWin' | 'modes' | 'numReels'>,
	gameType: string,
): number {
	const own = resolveGameModes(doc).find(
		(m) => m.spins?.numReels !== undefined && gameTypeForMode(m) === gameType,
	);
	return own?.spins?.numReels ?? doc.numReels;
}

/**
 * Add the spins mode `id`: a `reels` mode of the project's own on a game type of its own, playing
 * {@link DEFAULT_SPINS} spins of the base game (every other field the host's, sparse), with the base
 * game's strips copied as its own. Nothing starts it yet: Coin overlay routes a pot, a buy, Lucky
 * Spin or the random metre to it.
 */
export function addSpinsMode(doc: GameConfigDoc, id: string, label?: string): AddOnResult {
	const problem = spinsModeIdProblem(doc, id);
	if (problem) return { ok: false, reason: problem };
	const next = splitFormOf(doc);
	const base = next.paddingReels.basegame ?? [];
	if (!base.length) return { ok: false, reason: 'The base game has no strips to start from.' };
	next.paddingReels[id] = stripsToWidth(base, next.numReels);
	const decl: GameModeDecl = {
		id,
		board: 'reels',
		gameType: id,
		counter: 'freeSpins',
		label: label?.trim() || 'Spins bonus',
		spins: { spins: DEFAULT_SPINS },
	};
	next.modes = [...(next.modes ?? []), decl];
	return { ok: true, doc: next, renamed: { symbols: {}, pots: {} } };
}

/**
 * Remove the spins mode `id`: its declaration, its strips (unless another mode pads from them), every
 * route to it (a pot is re-routed as a removed respin mode's is), its import record and the symbols
 * only that import brought.
 */
export function removeSpinsMode(doc: GameConfigDoc, id: string): AddOnResult {
	const next = splitFormOf(doc);
	const mode = next.modes?.find((m) => m.id === id && m.spins);
	if (!mode) return { ok: false, reason: `"${id}" is not a spins mode of this project.` };
	const notes = reroutePots(next, id);
	if (next.coinOverlay) {
		const overlay = normalizeCoinOverlay(
			retargetRoutes(next.coinOverlay, (m) => (m === id ? undefined : m)),
		);
		if (overlay) next.coinOverlay = overlay;
		else delete next.coinOverlay;
	}
	const gameType = gameTypeForMode(mode);
	next.modes = next.modes!.filter((m) => m.id !== id);
	if (!next.modes.length) delete next.modes;
	if (!resolveGameModes(next).some((m) => gameTypeForMode(m) === gameType)) {
		delete next.paddingReels[gameType];
	}
	const brought = Object.values(bonusImportOf(next, id)?.symbols ?? {});
	const imports = next.imports?.filter((i) => i.mode !== id);
	if (imports?.length) next.imports = imports;
	else delete next.imports;
	const dealt = new Set(
		Object.values(next.paddingReels)
			.flat(2)
			.map((cell) => cell.name),
	);
	for (const name of brought) if (!dealt.has(name)) delete next.symbols[name];
	const renamed: AddOnRenames = { symbols: {}, pots: {} };
	return { ok: true, doc: next, renamed, ...(notes.length ? { notes } : {}) };
}

/**
 * Put the spins mode `game` (of the mode padding from `gameType`) on a grid of its own, or back on
 * the host's (`numReels` undefined), in place. Its strips are cycled or cut to the new width, and its
 * own paylines are cut or grown to it (a new cell repeats the line's last row, clamped to the
 * reel's height).
 */
export function setSpinsGrid(
	doc: GameConfigDoc,
	game: SpinsGame,
	gameType: string,
	numReels: number | undefined,
	numRows?: number[],
): void {
	if (numReels === undefined) {
		delete game.numReels;
		delete game.numRows;
	} else {
		const reels = Math.max(1, Math.floor(numReels));
		const fill = numRows?.[0] ?? game.numRows?.[0] ?? doc.numRows[0] ?? 3;
		game.numReels = reels;
		game.numRows = Array.from({ length: reels }, (_unused, i) =>
			Math.max(1, Math.floor(numRows?.[i] ?? game.numRows?.[i] ?? fill)),
		);
	}
	const width = game.numReels ?? doc.numReels;
	const heights = game.numRows ?? doc.numRows;
	const strips = doc.paddingReels[gameType];
	if (strips?.length && strips.length !== width) {
		doc.paddingReels[gameType] = stripsToWidth(strips, width);
	}
	for (const line of Object.values(game.paylines ?? {})) {
		line.length = Math.min(line.length, width);
		while (line.length < width) line.push(line[line.length - 1] ?? 0);
		line.forEach((row, reel) => (line[reel] = Math.min(row, (heights[reel] ?? 1) - 1)));
	}
}
