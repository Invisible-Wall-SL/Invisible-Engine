/**
 * BONUS MODES — the writers `/config` → Bonus modes uses on a project's respin modes
 * (`docs/design/bonus-games.md` §2.4, Phase 5a): add one with rules from a preset or empty, rename
 * one, remove one. Every result is in the SPLIT FORM only (`splitFormOf`, `./bonusGames`): the legacy
 * `holdAndWin` / `potsOverlay` keys are deleted, so a save regenerates the compat mirror from it.
 *
 * Pure: the input is never mutated. Like the add-ons (`./addOns`), the result is not normalized, so a
 * half-typed field elsewhere in an editor's live doc survives.
 */

import { addSymbols, dropUnusedSymbols, type AddOnRenames, type AddOnResult } from './addOns';
import {
	primaryRespinMode,
	removeHoldAndWin,
	splitFormOf,
	legacyHoldAndWin,
	legacyPotsOverlay,
} from './bonusGames';
import { normalizeCoinOverlay, retargetRoutes } from './coinOverlay';
import { resolveFreeSpins } from './freeSpins';
import { isHoldAndWinSymbol } from './holdAndWin';
import { normalizeHoldAndWinGame, splitHoldAndWin } from './holdAndWinGame';
import { HOLD_AND_WIN_PRESET_LABELS, type HoldAndWinPresetId } from './holdAndWinPresets';
import { symbolsInPlayForGameType } from './inPlay';
import {
	FREE_SPINS_MODE,
	GAME_MODE_ID,
	HOLD_AND_WIN_MODE,
	gameModeById,
	gameTypeForMode,
	holdAndWinModeDecl,
	normalizeGameModes,
	resolveGameModes,
	type GameModeDecl,
} from './modes';
import { isCoinDrop } from './potsOverlay';
import { holdAndWinBonus } from './potsOverlayPresets';
import type { GameConfigDoc } from './types';

/** The game type a new respin mode `id` pads from: `respin` for the `holdAndWin` mode, as the
 *  built-in always had it, else the id. */
export const respinGameTypeFor = (id: string): string =>
	id === HOLD_AND_WIN_MODE ? (holdAndWinModeDecl().gameType ?? id) : id;

/**
 * Why `id` cannot name a respin mode of `doc` (`current` is the mode being renamed), or `undefined`.
 * `holdAndWin` is refused beside another respin mode with rules: the compat mirror shows `holdAndWin`
 * first (`primaryRespinMode`), so it would take over the bonus the runtime plays until Phase 4.
 */
export function respinModeIdProblem(
	doc: GameConfigDoc,
	id: string,
	current?: string,
): string | undefined {
	if (!GAME_MODE_ID.test(id)) return 'Start with a letter; letters, digits, _ and - only.';
	if (id === current) return undefined;
	if (resolveGameModes(doc).some((m) => m.id === id)) return `A mode "${id}" already exists.`;
	const primary = primaryRespinMode(splitFormOf(doc).modes);
	if (id === HOLD_AND_WIN_MODE && primary && primary.id !== current) {
		return `"${HOLD_AND_WIN_MODE}" would take over from "${primary.id}" as the Hold and Win the game plays today. Pick another id.`;
	}
	return undefined;
}

/** The id a new respin mode gets: `holdAndWin` on a project without one, else `holdAndWin_2`, … */
export function nextRespinModeId(doc: GameConfigDoc): string {
	if (!respinModeIdProblem(doc, HOLD_AND_WIN_MODE)) return HOLD_AND_WIN_MODE;
	let n = 2;
	while (respinModeIdProblem(doc, `${HOLD_AND_WIN_MODE}_${n}`)) n += 1;
	return `${HOLD_AND_WIN_MODE}_${n}`;
}

/**
 * Add a respin mode `id` playing a Hold and Win game: a preset's (its rules, the symbols its respin
 * board deals and its respin strips, under free names) or, with no preset, an empty one (default
 * rules, no strips). Nothing routes to it yet: the coin overlay's triggers and pots name it. Refused
 * for an id {@link respinModeIdProblem} refuses, and for a preset whose strips' game type the project
 * already pads from.
 */
export function addRespinMode(
	doc: GameConfigDoc,
	id: string,
	preset?: HoldAndWinPresetId,
): AddOnResult {
	const problem = respinModeIdProblem(doc, id);
	if (problem) return { ok: false, reason: problem };
	const next = splitFormOf(doc);
	const renamed: AddOnRenames = { symbols: {}, pots: {} };
	const gameType = respinGameTypeFor(id);
	const decl: GameModeDecl = {
		...holdAndWinModeDecl(),
		id,
		gameType,
		label: id === HOLD_AND_WIN_MODE ? 'Hold and Win' : `Hold and Win — ${id}`,
	};
	if (preset) {
		if (next.paddingReels[gameType]) {
			return {
				ok: false,
				reason: `This project already has "${gameType}" strips, which the new respin board would pad from. Pick another id.`,
			};
		}
		const bonus = holdAndWinBonus(preset, next);
		const names = addSymbols(next, bonus.symbols, renamed);
		const strips = Object.values(bonus.paddingReels)[0] ?? [];
		next.paddingReels[gameType] = strips.map((strip) =>
			strip.map((cell) => ({ name: names[cell.name] ?? cell.name })),
		);
		decl.holdAndWin = splitHoldAndWin(bonus.holdAndWin).game;
		if (id !== HOLD_AND_WIN_MODE)
			decl.label = `Hold and Win — ${HOLD_AND_WIN_PRESET_LABELS[preset]}`;
	} else {
		decl.holdAndWin = normalizeHoldAndWinGame({});
	}
	const [mode] = normalizeGameModes([decl]) ?? [];
	next.modes = [...(next.modes ?? []), mode];
	return { ok: true, doc: next, renamed };
}

/** Every route in `doc`'s overlay that names `from` names `to` instead. In place. */
function retarget(doc: GameConfigDoc, from: string, to: string): void {
	if (!doc.coinOverlay) return;
	doc.coinOverlay = retargetRoutes(doc.coinOverlay, (mode) => (mode === from ? to : mode));
}

/**
 * Rename respin mode `from` to `to`: its declaration, every route that starts it and its import
 * record. It keeps the strips it pads from (its game type is pinned to the old one). The `holdAndWin`
 * mode is not renamed while it is the one the runtime plays (until Phase 4 the game, its screens and
 * its Flow tab know it by that id).
 */
export function renameRespinMode(doc: GameConfigDoc, from: string, to: string): AddOnResult {
	const next = splitFormOf(doc);
	const mode = next.modes?.find((m) => m.id === from && m.board === 'respinBoard');
	if (!mode) return { ok: false, reason: `"${from}" is not a respin mode of this project.` };
	if (from === HOLD_AND_WIN_MODE) {
		return {
			ok: false,
			reason: `"${HOLD_AND_WIN_MODE}" keeps its id until the game plays each mode by its own (bonus-games Phase 4).`,
		};
	}
	const problem = respinModeIdProblem(next, to, from);
	if (problem) return { ok: false, reason: problem };
	if (to === from) return { ok: true, doc: next, renamed: { symbols: {}, pots: {} } };
	mode.gameType = gameTypeForMode(mode);
	mode.id = to;
	retarget(next, from, to);
	for (const record of next.imports ?? []) if (record.mode === from) record.mode = to;
	return { ok: true, doc: next, renamed: { symbols: {}, pots: {} } };
}

/**
 * Re-route the pots that start `gone`, in place: to free spins when the project has them on, else
 * they are removed with their drops (a pot must start something). Returns what it did, to tell the
 * author.
 */
function reroutePots(doc: GameConfigDoc, gone: string): string[] {
	const overlay = doc.coinOverlay;
	const pots = (overlay?.pots ?? []).filter((p) => p.bonus.mode === gone);
	if (!overlay || !pots.length) return [];
	const ids = pots.map((p) => p.id);
	const named = `${ids.length > 1 ? 'pots' : 'pot'} ${ids.join(', ')}`;
	if (resolveFreeSpins(doc).enabled && gameModeById(doc, FREE_SPINS_MODE)) {
		for (const pot of pots) pot.bonus = { mode: FREE_SPINS_MODE };
		return [
			`The ${named} started "${gone}"; they now start free spins. Re-route them in Coin overlay.`,
		];
	}
	overlay.pots = overlay.pots!.filter((p) => !ids.includes(p.id));
	if (overlay.drops) {
		overlay.drops.table = overlay.drops.table.filter((e) => isCoinDrop(e) || !ids.includes(e.pot));
	}
	return [
		`The ${named} started "${gone}", and free spins are off, so nothing else could take them: they were removed with their drops.`,
	];
}

/**
 * Remove respin mode `id`: the mode (the primary through `removeHoldAndWin`, the ONE way to remove
 * it), every trigger and meter that starts it, its strips (unless another mode pads from them), the
 * Hold and Win symbols only those strips dealt, and its import record. A pot that started it is
 * re-routed ({@link reroutePots}); `notes` says how.
 */
export function removeRespinMode(doc: GameConfigDoc, id: string): AddOnResult {
	let next = splitFormOf(doc);
	const mode = next.modes?.find((m) => m.id === id && m.board === 'respinBoard');
	if (!mode) return { ok: false, reason: `"${id}" is not a respin mode of this project.` };
	const notes = reroutePots(next, id);

	const gameType = gameTypeForMode(mode);
	const shared = resolveGameModes(next).some((m) => m.id !== id && gameTypeForMode(m) === gameType);
	const dealt = new Set<string>();
	if (!shared && next.paddingReels[gameType]) {
		for (const name of symbolsInPlayForGameType(next, gameType)) dealt.add(name);
		delete next.paddingReels[gameType];
	}

	if (id === primaryRespinMode(next.modes)?.id) {
		next = splitFormOf(removeHoldAndWin(next));
	} else {
		next.modes = next.modes!.filter((m) => m.id !== id);
		if (next.coinOverlay) {
			const overlay = normalizeCoinOverlay(
				retargetRoutes(next.coinOverlay, (m) => (m === id ? undefined : m)),
			);
			if (overlay) next.coinOverlay = overlay;
			else delete next.coinOverlay;
		}
	}
	if (!next.modes?.length) delete next.modes;
	const imports = next.imports?.filter((i) => i.mode !== id);
	if (imports?.length) next.imports = imports;
	else delete next.imports;

	// `dropUnusedSymbols` keeps what the legacy pair names; the view shares `next.symbols`.
	const view = {
		...next,
		holdAndWin: legacyHoldAndWin(next),
		potsOverlay: legacyPotsOverlay(next),
	};
	dropUnusedSymbols(view, dealt, isHoldAndWinSymbol);
	return {
		ok: true,
		doc: next,
		renamed: { symbols: {}, pots: {} },
		...(notes.length ? { notes } : {}),
	};
}
