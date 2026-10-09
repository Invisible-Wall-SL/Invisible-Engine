import { normalizeHoldAndWinGame, type HoldAndWinGame } from './holdAndWinGame';
import { normalizeSpinsGame, validateSpinsGame, type SpinsGame } from './spinsGame';
import type { GameConfigDoc } from './types';

/**
 * GAME MODES — the registry a bonus switches into (`docs/design/hold-and-win.md` §4.5).
 *
 * A mode is a different game with its own board, screens, HUD, counter, music and rules: the base
 * game, free spins, a Hold and Win respin feature, a wheel, a pick game. The engine keeps a stack of
 * active modes plus a queue of pending ones; this file only says which modes a project HAS and what
 * each one is made of.
 *
 * SPARSE and departure-only, like every other Invisible-Engine block in this config. The modes every
 * game already has are BUILT IN ({@link builtinGameModes}) — `basegame` and `freeSpins` — so a config
 * that never mentions modes resolves to exactly the two-value world the engine ran before this file
 * existed. `doc.modes` stores an override of a built-in mode or a mode of the project's own, never a
 * restatement of a default.
 *
 * A BONUS MODE is a game of its own (`docs/design/bonus-games.md` §1): a `respinBoard` mode carries
 * its Hold and Win rules (`holdAndWin`), so a project may have several. A respin mode exists because
 * it is declared — normalization declares `holdAndWin` for a config that still carries the legacy
 * `holdAndWin` block (`./bonusGames`), and {@link resolveGameModes} reads such an unnormalized config
 * the same way.
 */

/** What a mode plays on. `reels` is the shared column-strip board; the rest are their own surfaces. */
export const GAME_MODE_BOARDS = ['reels', 'respinBoard', 'wheel', 'none'] as const;
export type GameModeBoard = (typeof GAME_MODE_BOARDS)[number];

/** The base game's id — the bottom of every mode stack, and the mode a round returns to. */
export const BASE_GAME_MODE = 'basegame';

/** The id the Hold and Win respin mode a legacy `holdAndWin` block migrates to is declared under. */
export const HOLD_AND_WIN_MODE = 'holdAndWin';

/** The free-spins feature's id — built in for every kind that can trigger it. */
export const FREE_SPINS_MODE = 'freeSpins';

export type GameModeDecl = {
	/** The mode id the engine, the flow and the scenes name it by (`freeSpins`, `holdAndWin`, …). */
	id: string;
	/** What it plays on. */
	board: GameModeBoard;
	/**
	 * The value `stateGame.gameType` takes while the mode is on top — the `paddingReels` key a `reels`
	 * mode fills its padding from, and the value a book's `reveal.gameType` names. Absent ⇒ the id.
	 *
	 * It is a separate field because the two names already differ on the oldest mode: free spins are
	 * the mode `freeSpins` but the game type `freegame`, which every math export, every mock and the
	 * Play4Fun facade write. Renaming the game type would change the board every live free spin pads
	 * from, so the id is the new name and the game type keeps the old one.
	 */
	gameType?: string;
	/** The HUD variant the mode shows — a Scene Editor `hud_*` screen id. Absent ⇒ the base HUD. */
	hud?: string;
	/** The music cue the mode plays on enter. Absent ⇒ the music does not change. */
	music?: string;
	/** Where the mode's counter reads from (`freeSpins`, `respins`, …). Absent ⇒ no counter. */
	counter?: string;
	/** The values the mode exposes to the flow and the HUD (`total`, `respinsLeft`, …). */
	values?: string[];
	/** The name the authoring tools show. Absent ⇒ the id. */
	label?: string;
	/** A `respinBoard` mode only: the Hold and Win game it plays (`./holdAndWinGame`). */
	holdAndWin?: HoldAndWinGame;
	/** A `reels` mode of the project's own only: the game it plays N spins of (`./spinsGame`). */
	spins?: SpinsGame;
};

/** The Hold and Win mode as the built-in used to declare it — what migration and a new respin mode
 *  start from. A fresh copy, safe to edit. */
export const holdAndWinModeDecl = (): GameModeDecl => ({
	id: HOLD_AND_WIN_MODE,
	board: 'respinBoard',
	gameType: 'respin',
	counter: 'respins',
	label: 'Hold and Win',
	values: ['total', 'respinsLeft'],
});

/** The modes every project has without authoring any: the base game, and free spins for every kind
 *  that can trigger them. */
export function builtinGameModes(): GameModeDecl[] {
	return [
		{ id: BASE_GAME_MODE, board: 'reels', label: 'Base game' },
		{
			id: FREE_SPINS_MODE,
			board: 'reels',
			gameType: 'freegame',
			counter: 'freeSpins',
			label: 'Free spins',
		},
	];
}

/**
 * The modes the doc declares. An unnormalized LEGACY config — a `holdAndWin` block and no respin mode
 * carrying rules — declares its Hold and Win mode implicitly, ahead of its own modes and with any
 * authored override of it on top, which is exactly where and how the built-in used to resolve.
 */
function declaredModes(
	doc: Pick<GameConfigDoc, 'holdAndWin' | 'modes'> | undefined,
): GameModeDecl[] {
	const own = doc?.modes ?? [];
	if (!doc?.holdAndWin || own.some((m) => m.board === 'respinBoard' && m.holdAndWin)) return own;
	const at = own.findIndex((m) => m.id === HOLD_AND_WIN_MODE);
	// The block plays on the respin board whatever an override of the mode says.
	return [
		{ ...holdAndWinModeDecl(), ...own[at], board: 'respinBoard' },
		...own.filter((_unused, i) => i !== at),
	];
}

/**
 * Every mode this project has: the built-ins with the authored overrides applied field by field, then
 * the project's own modes in the order they were authored. Read modes through here, never through
 * `doc.modes`, so "absent means the built-in" lives in one place.
 */
export function resolveGameModes(
	doc: Pick<GameConfigDoc, 'holdAndWin' | 'modes'> | undefined,
): GameModeDecl[] {
	const resolved = builtinGameModes();
	for (const authored of declaredModes(doc)) {
		const at = resolved.findIndex((mode) => mode.id === authored.id);
		if (at >= 0) resolved[at] = { ...resolved[at], ...authored };
		else resolved.push(authored);
	}
	return resolved;
}

/** The one mode named `id`, or `undefined` when the project has no such mode. */
export function gameModeById(
	doc: Pick<GameConfigDoc, 'holdAndWin' | 'modes'> | undefined,
	id: string,
): GameModeDecl | undefined {
	return resolveGameModes(doc).find((mode) => mode.id === id);
}

/**
 * The REELS mode of the project's own that plays on `gameType` (an imported free spins,
 * `./imports`), or `undefined`. A built-in mode, a mode that is not on the reels, and a game type a
 * built-in mode already plays on (`basegame`, `freegame`) are never one — so a project
 * without such a mode answers `undefined` for every game type, as before it could have one.
 */
export function ownReelsModeForGameType(
	doc: Pick<GameConfigDoc, 'holdAndWin' | 'modes'> | undefined,
	gameType: string,
): GameModeDecl | undefined {
	const builtins = builtinGameModes();
	if (builtins.some((mode) => gameTypeForMode(mode) === gameType)) return undefined;
	return resolveGameModes(doc).find(
		(mode) =>
			mode.board === 'reels' &&
			gameTypeForMode(mode) === gameType &&
			!builtins.some((b) => b.id === mode.id),
	);
}

/** The `stateGame.gameType` value a mode sets while it is on top (its `gameType`, else its id). */
export function gameTypeForMode(mode: Pick<GameModeDecl, 'id' | 'gameType'>): string {
	return mode.gameType ?? mode.id;
}

/**
 * The mode a `gameType` value belongs to — the inverse of {@link gameTypeForMode}, so a book's
 * `reveal.gameType: 'freegame'` reads as the `freeSpins` mode. An unknown game type is its own id.
 */
export function modeIdForGameType(
	doc: Pick<GameConfigDoc, 'holdAndWin' | 'modes'> | undefined,
	gameType: string,
): string {
	const modes = resolveGameModes(doc);
	return (
		modes.find((mode) => mode.gameType === gameType)?.id ??
		modes.find((mode) => mode.id === gameType)?.id ??
		gameType
	);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (v: unknown): string | undefined =>
	typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** A mode id's shape — also a pot's, since both become anchors and value-source path segments. */
export const GAME_MODE_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * Normalize authored modes, or `undefined` when nothing departs from the built-ins.
 *
 * A half-typed entry (no id, a malformed id, an unknown board) is dropped, as the rest of this config
 * drops what cannot be interpreted. A field that merely RESTATES the built-in is dropped too, and an
 * override left with nothing in it disappears, so a config that agrees with the defaults stores no
 * `modes` at all and normalizes byte-identically to one authored before modes existed.
 */
export function normalizeGameModes(raw: unknown): GameModeDecl[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const builtins = builtinGameModes();
	const out: GameModeDecl[] = [];
	const seen = new Set<string>();
	for (const entry of raw) {
		if (!isObject(entry)) continue;
		const id = text(entry.id);
		if (!id || !GAME_MODE_ID.test(id) || seen.has(id)) continue;
		const builtin = builtins.find((mode) => mode.id === id);
		const board = GAME_MODE_BOARDS.find((b) => b === entry.board) ?? builtin?.board;
		if (!board) continue;
		seen.add(id);
		const mode: GameModeDecl = { id, board };
		for (const key of ['gameType', 'hud', 'music', 'counter', 'label'] as const) {
			const value = text(entry[key]);
			if (value) mode[key] = value;
		}
		if (Array.isArray(entry.values)) {
			const values = [...new Set(entry.values.map(text).filter((v): v is string => !!v))];
			if (values.length) mode.values = values;
		}
		const rules = board === 'respinBoard' ? normalizeHoldAndWinGame(entry.holdAndWin) : undefined;
		if (rules) mode.holdAndWin = rules;
		const spins = board === 'reels' && !builtin ? normalizeSpinsGame(entry.spins) : undefined;
		if (spins) mode.spins = spins;
		if (builtin) {
			const departure = departureFrom(builtin, mode);
			if (departure) out.push(departure);
		} else {
			out.push(mode);
		}
	}
	return out.length ? out : undefined;
}

/** The fields of `mode` that differ from `builtin`, plus the id; `undefined` when none differ. */
function departureFrom(builtin: GameModeDecl, mode: GameModeDecl): GameModeDecl | undefined {
	const out: Partial<GameModeDecl> = {};
	let departs = false;
	for (const key of Object.keys(mode) as (keyof GameModeDecl)[]) {
		if (key === 'id') continue;
		if (JSON.stringify(mode[key]) === JSON.stringify(builtin[key])) continue;
		(out as Record<string, unknown>)[key] = mode[key];
		departs = true;
	}
	return departs ? ({ id: builtin.id, board: builtin.board, ...out } as GameModeDecl) : undefined;
}

export type GameModeIssue = { path: string; message: string; severity: 'error' | 'warning' };

/**
 * What is wrong with the resolved modes. A `reels` mode must pad from a strip set the config deals;
 * the base game must stay on the reels, because every round starts and ends there; a spins mode's
 * game must fill its own grid and be able to pay.
 */
export function validateGameModes(doc: GameConfigDoc): GameModeIssue[] {
	const issues: GameModeIssue[] = [];
	for (const mode of resolveGameModes(doc)) {
		const path = `modes.${mode.id}`;
		if (mode.id === BASE_GAME_MODE && mode.board !== 'reels') {
			issues.push({
				path: `${path}.board`,
				severity: 'error',
				message: 'The base game plays on the reels: every round starts and ends there.',
			});
		}
		const gameType = gameTypeForMode(mode);
		const ownsStrips =
			(doc.modes ?? []).some((m) => m.id === mode.id) || mode.id === BASE_GAME_MODE;
		if (mode.board === 'reels' && ownsStrips && !doc.paddingReels[gameType]?.length) {
			issues.push({
				path: `${path}.gameType`,
				severity: 'warning',
				message: `No padding strips for game type "${gameType}"; the reels pad from nothing in this mode.`,
			});
		}
		if (mode.spins)
			issues.push(...validateSpinsGame(doc, { id: mode.id, spins: mode.spins }, gameType));
		// A spins game on a grid of its own has strips of its own: sharing another mode's would size
		// that mode's strips to this grid, or this grid's to that mode's.
		const sharedWith =
			mode.spins?.numReels !== undefined
				? resolveGameModes(doc).find((m) => m.id !== mode.id && gameTypeForMode(m) === gameType)
				: undefined;
		if (sharedWith) {
			issues.push({
				path: `${path}.gameType`,
				severity: 'error',
				message: `The spins game "${mode.id}" has a grid of its own, so it needs strips of its own: "${gameType}" is also "${sharedWith.id}"'s.`,
			});
		}
	}
	return issues;
}

/** The base kinds whose mock deals a bonus on its own board, not a spins game of another type. */
const NO_SPINS_GAMES_KINDS: Record<string, string> = {
	bookOf: 'a Book-of game',
	holdAndWin: 'a Hold and Win game',
};

/**
 * An ERROR on each spins mode (`./spinsGame`) of a game of kind `baseKind` that does not play one:
 * the book mock and the Hold and Win engine deal their bonuses on their own board, so a spins game's
 * grid and pays would be drawn by the client and never dealt (bonus-games Phase 8a). The base kind
 * is the project's, so this sits beside the doc's own validator where the kind is known (`/config`).
 */
export function spinsModeKindIssues(
	doc: Pick<GameConfigDoc, 'holdAndWin' | 'modes'>,
	baseKind: string | undefined,
): GameModeIssue[] {
	const kind = baseKind ? NO_SPINS_GAMES_KINDS[baseKind] : undefined;
	if (!kind) return [];
	return resolveGameModes(doc)
		.filter((mode) => mode.spins)
		.map((mode) => ({
			path: `modes.${mode.id}.spins`,
			severity: 'error' as const,
			message: `"${mode.id}" is a spins game, which ${kind} does not play: its bonuses play on its own board. Play it from a lines, ways, cluster or scatter game.`,
		}));
}
