/**
 * A BONUS IMPORTED FROM ANOTHER PROJECT (`docs/design/pots-overlay.md` §5 A): one feature of a source
 * project of the same client, copied into this project as a mode a pot's bonus can route to, with
 * its provenance kept so it can be re-synced from the source.
 *
 * This file owns the Game Config half — the feature's block, its strips, its symbols (merged into
 * this dictionary, a clash renamed) and the `imports` record. The launcher copies the rest (the
 * `/symbols` bindings, the mode's screens, its Flow section, its Win Text lines) under the same
 * rename map.
 *
 * WHAT CAN BE IMPORTED:
 *  - **A Hold and Win feature.** A project has ONE Hold and Win block, so importing into a host whose
 *    block is the overlay's bonus REPLACES that bonus, and only when asked; a block that is the
 *    host's base game is never replaced.
 *  - **A reels feature** — the source's free spins, or a `reels` mode of its own. It arrives as a
 *    NEW mode of this project (the source's id, `_2`-renamed when this project already has one, as
 *    `freeSpins` always does) on a NEW game type with its own strips, cycled to the host's reels. It
 *    plays as free spins in that mode (`freeSpinTrigger.mode`, engine `modeEvents.ts`). A symbol on
 *    its strips that this project defines identically is SHARED (not copied, not in the record), so a
 *    free spins imported between two games of one family brings only what differs.
 *  - A respin board, wheel or `none` mode of the source's own is refused: nothing plays one yet.
 *
 * RE-SYNC overwrites only the imported pieces — the block, its strips, its mode override and the
 * symbols it brought — reusing the stored rename map, so a symbol keeps its name (and its
 * `/symbols` binding) across syncs. What the host authored around it stays: the pots that route to
 * it and everything else in the doc.
 *
 * Pure: the input is never mutated, and the result is NOT normalized (as `./addOns`).
 */

import {
	dropUnusedSymbols,
	takeOutHoldAndWinBonus,
	takeOutImportedReelsMode,
	zeroPotsRefusal,
	type AddOnRenames,
} from './addOns';
import { holdAndWinIsOverlayBonus, isHoldAndWinSymbol } from './holdAndWin';
import { symbolsInPlayFromStrips } from './inPlay';
import {
	BASE_GAME_MODE,
	HOLD_AND_WIN_MODE,
	gameModeById,
	gameTypeForMode,
	resolveGameModes,
	type GameModeDecl,
} from './modes';
import { holdAndWinBonusFrom, type HoldAndWinBonusSource } from './potsOverlayPresets';
import { bonusImportOf, type BonusImport } from './bonusImports';
import {
	legacyHoldAndWin,
	legacyPotsOverlay,
	primaryRespinMode,
	syncBonusSplit,
	withLegacyPair,
} from './bonusGames';
import type { GameConfigDoc } from './types';

/** A feature of a source project, as the import picker offers it. */
export type ImportableFeature = {
	/** Its mode id in the source project. */
	mode: string;
	label: string;
	/** Why it cannot be imported yet; absent ⇒ it can. */
	refused?: string;
};

const BOARD_NOT_BUILT =
	'Only a Hold and Win or a reels feature can be imported: nothing plays a board of this kind from a pot yet.';

/** The features of `source` an import can pick from, in mode order. The base game is never one. */
export function importableFeatures(source: GameConfigDoc): ImportableFeature[] {
	return resolveGameModes(source)
		.filter((m) => m.id !== BASE_GAME_MODE)
		.map((m) => {
			const label = m.label ?? m.id;
			if (m.id !== HOLD_AND_WIN_MODE && m.board !== 'reels') {
				return { mode: m.id, label, refused: BOARD_NOT_BUILT };
			}
			return source.paddingReels[gameTypeForMode(m)]?.length
				? { mode: m.id, label }
				: { mode: m.id, label, refused: 'It has no strips to deal from.' };
		});
}

export type ImportOptions = {
	/** The source project's key. */
	project: string;
	/** The source feature's mode id. */
	mode: string;
	/** ISO time to record. */
	at: string;
	/** Replace a Hold and Win bonus the host already has (never its base game). */
	replace?: boolean;
	/** Pots to route to the imported mode. */
	pots?: string[];
	/** The mode it already is in this project — a re-sync's, so a reels mode keeps its id. */
	into?: string;
};

export type ImportResult =
	| {
			ok: true;
			doc: GameConfigDoc;
			/** The mode id it is in this project. */
			mode: string;
			/** Names changed because this project already used them (as `./addOns`). */
			renamed: AddOnRenames;
			/** Every imported symbol: source name → name here (the stored map). */
			symbols: Record<string, string>;
			/** Base-board-only options of the source the bonus left out. */
			leftOut: string[];
			/** Pots whose `activates` the imported feature has no special for, so it was dropped. */
			droppedActivates: string[];
			/** Whether a Hold and Win bonus the host had was replaced. */
			replaced: boolean;
	  }
	| { ok: false; reason: string };

const freeName = (wanted: string, taken: Set<string>): string => {
	if (!taken.has(wanted)) return wanted;
	let n = 2;
	while (taken.has(`${wanted}_${n}`)) n += 1;
	return `${wanted}_${n}`;
};

/**
 * Import the feature `opts.mode` of `source` into `target` (or re-sync it — see {@link resyncBonus}).
 * The host must have a pots overlay: a pot is the only thing that starts an imported bonus.
 */
export function importBonus(
	target: GameConfigDoc,
	source: HoldAndWinBonusSource,
	opts: ImportOptions,
): ImportResult {
	const overlay = legacyPotsOverlay(target);
	if (!overlay) {
		return {
			ok: false,
			reason: 'Add a pots overlay first: a full pot is what starts an imported bonus.',
		};
	}
	const feature = gameModeById(source, opts.mode);
	if (!feature || opts.mode === 'basegame') {
		return { ok: false, reason: `The source project has no "${opts.mode}" feature.` };
	}
	const unknown = opts.pots?.find((id) => !overlay.pots.some((p) => p.id === id));
	if (unknown) return { ok: false, reason: `This project has no pot "${unknown}".` };
	if (opts.mode !== HOLD_AND_WIN_MODE) {
		return feature.board === 'reels'
			? importReelsMode(target, source, feature, opts)
			: { ok: false, reason: BOARD_NOT_BUILT };
	}
	if (!legacyHoldAndWin(source)) {
		return { ok: false, reason: 'The source project has no Hold and Win block.' };
	}

	const next = withLegacyPair(structuredClone(target));
	const previous = bonusImportOf(next, HOLD_AND_WIN_MODE);
	// The HUD screen is the host's layout's, so the host's choice outlives a replace.
	const hostHud = next.modes?.find((m) => m.id === HOLD_AND_WIN_MODE)?.hud;
	let replaced = false;
	if (next.holdAndWin) {
		if (!holdAndWinIsOverlayBonus(next)) {
			return {
				ok: false,
				reason:
					"This project's Hold and Win is its base game, so an imported one cannot take its place.",
			};
		}
		if (!opts.replace) {
			return {
				ok: false,
				reason: previous
					? `This project's Hold and Win was imported from "${previous.importedFrom.project}". Re-sync it, or replace it.`
					: 'This project already has a Hold and Win bonus. Replace it to import this one.',
			};
		}
		dropUnusedSymbols(next, takeOutHoldAndWinBonus(next), isHoldAndWinSymbol);
		replaced = true;
	}
	// An imported symbol is the import's piece whatever its roles, so a re-sync takes every one back
	// (a record left behind by a hand edit included) before the source's are added again.
	dropUnusedSymbols(next, Object.values(previous?.symbols ?? {}), () => true);

	const bonus = holdAndWinBonusFrom(source, next);
	const gameType = Object.keys(bonus.paddingReels)[0];
	if (next.paddingReels[gameType]?.length) {
		return {
			ok: false,
			reason: `This project already has "${gameType}" strips, which the imported respin board would pad from. Remove them first.`,
		};
	}

	const renamed: AddOnRenames = { symbols: {}, pots: {} };
	const taken = new Set(Object.keys(next.symbols));
	const names: Record<string, string> = {};
	for (const [wanted, entry] of Object.entries(bonus.symbols)) {
		const stored = previous?.symbols[wanted];
		const name = stored && !taken.has(stored) ? stored : freeName(wanted, taken);
		taken.add(name);
		names[wanted] = name;
		if (name !== wanted) renamed.symbols[wanted] = name;
		next.symbols[name] = entry;
	}
	next.paddingReels[gameType] = (bonus.paddingReels[gameType] ?? []).map((strip) =>
		strip.map((cell) => ({ name: names[cell.name] ?? cell.name })),
	);
	next.holdAndWin = bonus.holdAndWin;

	// The source's presentation of the mode (its music, counter, label) comes with it. Its game type
	// does not, as the strips were written under this project's default, and neither does its HUD,
	// which names a screen of the SOURCE's layout: the host keeps its own.
	const authored = source.modes?.find((m) => m.id === HOLD_AND_WIN_MODE);
	const {
		gameType: _gameType,
		hud: _hud,
		holdAndWin: _rules,
		...presentation
	} = authored ?? {
		id: HOLD_AND_WIN_MODE,
		board: 'respinBoard' as const,
	};
	const override: GameModeDecl = {
		...presentation,
		id: HOLD_AND_WIN_MODE,
		...(hostHud ? { hud: hostHud } : {}),
	};
	if (authored || hostHud) next.modes = [...(next.modes ?? []), override];

	// On a coins-only host (no pots) value coins are all that can start the bonus, so the imported
	// feature must pass the same rule as going down to no pots (`zeroPotsRefusal`): a re-sync from a
	// source that dropped its coin count trigger is refused too.
	if (!next.potsOverlay!.pots.length && zeroPotsRefusal(next)) {
		return {
			ok: false,
			reason:
				'This overlay has no pots, so only value coins can start the imported Hold and Win, and it has no coin count trigger for them. Add a pot first, or import a feature whose trigger counts coins.',
		};
	}

	const pots = new Set(opts.pots ?? []);
	const specials = next.holdAndWin.specials;
	const droppedActivates: string[] = [];
	next.potsOverlay = {
		...next.potsOverlay!,
		pots: next.potsOverlay!.pots.map((pot) => {
			const bonusOf = pots.has(pot.id) ? { mode: HOLD_AND_WIN_MODE } : pot.bonus;
			if (bonusOf.mode === HOLD_AND_WIN_MODE && bonusOf.activates && !specials[bonusOf.activates]) {
				droppedActivates.push(pot.id);
				const { activates: _activates, ...kept } = bonusOf;
				return { ...pot, bonus: kept };
			}
			return { ...pot, bonus: bonusOf };
		}),
	};

	const record: BonusImport = {
		mode: HOLD_AND_WIN_MODE,
		importedFrom: { project: opts.project, mode: opts.mode, at: opts.at },
		symbols: names,
	};
	next.imports = [...(next.imports ?? []).filter((i) => i.mode !== HOLD_AND_WIN_MODE), record];
	// The blank the source's respin board draws comes with it, under its name here; a blank the host's
	// previous bonus named goes with that bonus.
	const synced = syncBonusSplit(next);
	const respin = primaryRespinMode(synced.modes);
	const blank = primaryRespinMode(source.modes)?.holdAndWin.blank;
	if (respin) {
		if (blank) respin.holdAndWin.blank = names[blank] ?? blank;
		else delete respin.holdAndWin.blank;
	}
	return {
		ok: true,
		doc: synced,
		mode: HOLD_AND_WIN_MODE,
		renamed,
		symbols: names,
		leftOut: bonus.leftOut,
		droppedActivates,
		replaced,
	};
}

/**
 * Re-sync the imported bonus `mode` from `source`, its project as recorded: the imported pieces are
 * overwritten from the source's current config and nothing else is touched. Refused when `mode` was
 * not imported.
 */
export function resyncBonus(
	target: GameConfigDoc,
	source: HoldAndWinBonusSource,
	mode: string,
	at: string,
): ImportResult {
	const record = bonusImportOf(target, mode);
	if (!record) return { ok: false, reason: `"${mode}" was not imported from another project.` };
	return importBonus(target, source, {
		project: record.importedFrom.project,
		mode: record.importedFrom.mode,
		at,
		replace: true,
		into: mode,
	});
}

/**
 * Import the source's REELS feature `feature` (its free spins, or a reels mode of its own) as a mode
 * of `target`'s own; see the file header. A re-sync (`opts.into`) takes its previous pieces back
 * first and keeps its mode id, game type and every name.
 */
function importReelsMode(
	target: GameConfigDoc,
	source: HoldAndWinBonusSource,
	feature: GameModeDecl,
	opts: ImportOptions,
): ImportResult {
	const own = source.paddingReels[gameTypeForMode(feature)] ?? [];
	if (!own.length) {
		return { ok: false, reason: `The source's "${feature.id}" has no strips to deal from.` };
	}
	const already = target.imports?.find(
		(i) =>
			i.mode !== opts.into &&
			i.importedFrom.project === opts.project &&
			i.importedFrom.mode === opts.mode,
	);
	if (already) {
		return {
			ok: false,
			reason: `"${opts.project}"'s ${feature.id} is already imported here as "${already.mode}". Re-sync it instead.`,
		};
	}
	const next = withLegacyPair(structuredClone(target));
	const previous = opts.into ? bonusImportOf(next, opts.into) : undefined;
	const previousDecl = previous && next.modes?.find((m) => m.id === previous.mode);
	if (previous) dropUnusedSymbols(next, takeOutImportedReelsMode(next, previous.mode), () => true);

	const modeIds = new Set(resolveGameModes(next).map((m) => m.id));
	const mode = previous?.mode ?? freeName(feature.id, modeIds);
	const gameTypes = new Set([
		...Object.keys(next.paddingReels),
		...resolveGameModes(next).map(gameTypeForMode),
	]);
	const gameType =
		previousDecl && !gameTypes.has(gameTypeForMode(previousDecl))
			? gameTypeForMode(previousDecl)
			: freeName(gameTypeForMode(feature), gameTypes);

	const strips = Array.from({ length: next.numReels }, (_unused, reel) => own[reel % own.length]);
	const renamed: AddOnRenames = { symbols: {}, pots: {} };
	const taken = new Set(Object.keys(next.symbols));
	const names: Record<string, string> = {};
	const owned: Record<string, string> = {};
	for (const wanted of symbolsInPlayFromStrips({ [gameType]: strips })) {
		const entry = source.symbols[wanted] ?? {};
		if (JSON.stringify(next.symbols[wanted]) === JSON.stringify(entry)) {
			names[wanted] = wanted;
			continue;
		}
		const stored = previous?.symbols[wanted];
		const name = stored && !taken.has(stored) ? stored : freeName(wanted, taken);
		taken.add(name);
		names[wanted] = owned[wanted] = name;
		if (name !== wanted) renamed.symbols[wanted] = name;
		next.symbols[name] = structuredClone(entry);
	}
	next.paddingReels[gameType] = strips.map((strip) =>
		strip.map((cell) => ({ name: names[cell.name] ?? cell.name })),
	);

	// Its presentation comes with it (music, counter, label); its HUD names a screen of the SOURCE's
	// layout, so it does not.
	const {
		hud: _hud,
		gameType: _sourceType,
		id: _sourceId,
		board: _board,
		...presentation
	} = feature;
	const decl: GameModeDecl = {
		id: mode,
		board: 'reels',
		gameType,
		...presentation,
		...(feature.id === 'freeSpins' && !feature.counter ? { counter: 'freeSpins' } : {}),
		label: previousDecl?.label ?? `${feature.label ?? feature.id} (${opts.project})`,
	};
	next.modes = [...(next.modes ?? []), decl];

	const pots = new Set(opts.pots ?? []);
	next.potsOverlay = {
		...next.potsOverlay!,
		pots: next.potsOverlay!.pots.map((pot) =>
			pots.has(pot.id)
				? { ...pot, bonus: { mode, ...(pot.bonus.spins ? { spins: pot.bonus.spins } : {}) } }
				: pot,
		),
	};

	const record: BonusImport = {
		mode,
		importedFrom: { project: opts.project, mode: opts.mode, at: opts.at },
		symbols: owned,
	};
	next.imports = [...(next.imports ?? []).filter((i) => i.mode !== mode), record];
	return {
		ok: true,
		doc: syncBonusSplit(next),
		mode,
		renamed,
		symbols: owned,
		leftOut: [],
		droppedActivates: [],
		replaced: false,
	};
}
