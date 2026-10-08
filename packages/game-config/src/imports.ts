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
 *  - A wheel or `none` mode of the source's own is refused: nothing plays one yet.
 *
 * ADD A BONUS MODE (`docs/design/bonus-games.md` §1, Phase 6) is {@link importRespinMode}: any respin
 * mode with rules of the source arrives as a NEW respin mode of this project, never in place of one
 * (an id clash takes `_2`, `_3`, …), on any host, overlay or not. Its rules travel whole (`play`
 * included), with its strips and the symbols they deal (a clash renamed); what starts it is the
 * author's pick of this project's routes ({@link ModeRoute}). It works on the split form only.
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
	normalizeGameModes,
	resolveGameModes,
	type GameModeDecl,
} from './modes';
import { holdAndWinBonusFrom, type HoldAndWinBonusSource } from './potsOverlayPresets';
import { bonusImportOf, type BonusImport } from './bonusImports';
import {
	legacyHoldAndWin,
	legacyPotsOverlay,
	primaryRespinMode,
	respinModeDecls,
	splitFormOf,
	syncBonusSplit,
	withLegacyPair,
} from './bonusGames';
import { respinGameTypeFor, respinModeIdProblem } from './bonusModes';
import { normalizeCoinOverlay, overlayRoutes, type CoinOverlay } from './coinOverlay';
import { isCoinDrop } from './potsOverlay';
import type { HoldAndWinGame } from './holdAndWinGame';
import type { GameConfigDoc, GameConfigSymbol } from './types';

/** A feature of a source project, as the import picker offers it. */
export type ImportableFeature = {
	/** Its mode id in the source project. */
	mode: string;
	label: string;
	/** What it plays on: a respin mode is added as a mode of its own (`importRespinMode`), a reels
	 *  one through the pots overlay's import. */
	board: GameModeDecl['board'];
	/** Why it cannot be imported yet; absent ⇒ it can. */
	refused?: string;
};

const BOARD_NOT_BUILT =
	'Only a Hold and Win or a reels feature can be imported: nothing plays a board of this kind from a pot yet.';

/** The features of `source` an import can pick from, in mode order. The base game is never one. */
export function importableFeatures(source: GameConfigDoc): ImportableFeature[] {
	const respin = new Set(respinModeDecls(source).map((m) => m.id));
	return resolveGameModes(source)
		.filter((m) => m.id !== BASE_GAME_MODE)
		.map((m) => {
			const feature = { mode: m.id, label: m.label ?? m.id, board: m.board };
			if (m.board === 'respinBoard' && !respin.has(m.id)) {
				return { ...feature, refused: 'It has no Hold and Win rules to play.' };
			}
			if (m.board !== 'respinBoard' && m.board !== 'reels') {
				return { ...feature, refused: BOARD_NOT_BUILT };
			}
			return source.paddingReels[gameTypeForMode(m)]?.length
				? feature
				: { ...feature, refused: 'It has no strips to deal from.' };
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
	if (record.asMode) {
		return importRespinMode(target, source, {
			project: record.importedFrom.project,
			mode: record.importedFrom.mode,
			at,
			into: mode,
		});
	}
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

// ─── add a bonus mode ─────────────────────────────────────────────────────────────────────────

/**
 * What starts an added bonus mode: one of this project's coin overlay routes taken over (a pot, a
 * trigger, a symbol-filled meter), or a buy tier on a buy-bonus bet mode. Never scatters, which start
 * free spins only (design §6 decision 6).
 */
export type ModeRoute =
	| { kind: 'pot'; pot: string }
	| { kind: 'count' | 'pattern' | 'luckySpin' | 'randomMetre' }
	| { kind: 'meter'; meter: string }
	| { kind: 'buy'; betMode: string };

export type ModeImportOptions = {
	/** This project's kind: which `routes` its mock deals ({@link modeRouteRefusal}). Read only for
	 *  `routes` (a re-sync adds none); absent ⇒ only what every kind deals. */
	hostKind?: string;
	/** The source project's key. */
	project: string;
	/** The source's respin mode id. */
	mode: string;
	/** ISO time to record. */
	at: string;
	/** What starts it here. Absent or empty ⇒ nothing yet: `/config` → Coin overlay routes it. */
	routes?: ModeRoute[];
	/** The mode it already is in this project — a re-sync's, which keeps its id, strips and routes. */
	into?: string;
};

const TRIGGER_LABELS = {
	count: 'coin count',
	pattern: 'pattern',
	luckySpin: 'Lucky Spin',
	randomMetre: 'random metre',
} as const;

/** The kind whose mock deals every route to a respin mode (bonus-games Phase 2: decided by KIND). */
const HOLD_AND_WIN_KIND = 'holdAndWin';

/**
 * Why `route` would not start a respin mode in a project of kind `hostKind`, or `undefined` when its
 * mock deals it. Only the Hold and Win kind's mock deals every route; on any other kind the coin
 * overlay composes over the host's own mock and starts a respin mode only from a full pot or from
 * enough dropped value coins (the count trigger). A route that saves but never plays is refused —
 * the dialog lists only the routes this passes. Phase 7 lifts it with the deal decision on the doc.
 */
export function modeRouteRefusal(
	doc: Pick<GameConfigDoc, 'coinOverlay' | 'potsOverlay' | 'holdAndWin' | 'modes'>,
	route: ModeRoute,
	hostKind: string | undefined,
): string | undefined {
	if (hostKind === HOLD_AND_WIN_KIND) return undefined;
	if (route.kind === 'pot') return undefined;
	const drops = legacyPotsOverlay(doc)?.drops;
	if (route.kind === 'count' && drops?.table.some(isCoinDrop)) return undefined;
	return 'On this game only a pot (or dropped value coins) starts a Hold and Win: route a pot to it — buy and trigger routes on a lines game arrive in Phase 7.';
}

/** `wanted`, or its base (any `_<n>` dropped) with the first free `_2`, `_3`… a respin mode may take. */
function freeRespinModeId(doc: GameConfigDoc, wanted: string): string {
	if (!respinModeIdProblem(doc, wanted)) return wanted;
	const base = wanted.replace(/_\d+$/, '');
	let n = 2;
	while (respinModeIdProblem(doc, `${base}_${n}`)) n += 1;
	return `${base}_${n}`;
}

/** Point `routes` of `doc`'s overlay at `mode`, playing `game`, in place; why one cannot be, or
 *  `undefined`. A pot taken over starts it plain, as an imported bonus's always has. */
function routeTo(
	doc: GameConfigDoc,
	mode: string,
	game: HoldAndWinGame,
	routes: readonly ModeRoute[],
): string | undefined {
	const overlay: Partial<CoinOverlay> = doc.coinOverlay ?? {};
	for (const route of routes) {
		if (route.kind === 'pot') {
			const pot = overlay.pots?.find((p) => p.id === route.pot);
			if (!pot) return `This project has no pot "${route.pot}".`;
			pot.bonus = { mode };
		} else if (route.kind === 'meter') {
			const meter = overlay.meters?.find((m) => m.id === route.meter);
			if (!meter) return `This project has no meter "${route.meter}".`;
			if (!game.specials[meter.activates]) {
				return `The meter "${meter.id}" activates ${meter.activates}, which "${mode}" does not deal.`;
			}
			meter.mode = mode;
		} else if (route.kind === 'buy') {
			if (!doc.betModes[route.betMode]?.buyBonus) {
				return `"${route.betMode}" is not a buy-bonus bet mode of this project.`;
			}
			const trigger = (overlay.trigger ??= {});
			const tier = trigger.buy?.find((t) => t.betMode === route.betMode);
			if (tier) tier.mode = mode;
			else {
				trigger.buy = [
					...(trigger.buy ?? []),
					{ betMode: route.betMode, mode, guaranteed: [], boostedSpecials: false },
				];
			}
		} else {
			const slot = overlay.trigger?.[route.kind];
			if (!slot) {
				return `This project's coin overlay has no ${TRIGGER_LABELS[route.kind]} trigger.`;
			}
			slot.mode = mode;
		}
	}
	if (!doc.coinOverlay && Object.keys(overlay).length) {
		doc.coinOverlay = normalizeCoinOverlay({ style: 'classic', ...overlay });
	}
	return undefined;
}

/**
 * Add the respin mode `opts.mode` of `source` to `target` as a NEW respin mode (see the file
 * header), or re-sync one added before (`opts.into`, see {@link resyncBonus}): its rules, strips and
 * symbols are taken back and copied again from the source, under the same id, game type, label, HUD
 * and names, and every route to it is kept. No other mode is touched. The result is in the split
 * form only (`splitFormOf`): saving it regenerates the compat mirror.
 */
export function importRespinMode(
	target: GameConfigDoc,
	source: HoldAndWinBonusSource,
	opts: ModeImportOptions,
): ImportResult {
	const from = respinModeDecls(source).find((m) => m.id === opts.mode);
	if (!from) {
		return { ok: false, reason: `The source project has no Hold and Win mode "${opts.mode}".` };
	}
	const own = source.paddingReels[gameTypeForMode(from)] ?? [];
	if (!own.length) {
		return { ok: false, reason: `The source's "${from.id}" has no strips to deal from.` };
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
			reason: `"${opts.project}"'s ${from.id} is already a bonus mode here as "${already.mode}". Re-sync it instead.`,
		};
	}

	const next = splitFormOf(target);
	const previous = opts.into ? bonusImportOf(next, opts.into) : undefined;
	const at = next.modes?.findIndex((m) => m.id === opts.into && m.board === 'respinBoard') ?? -1;
	if (opts.into && at < 0) {
		return { ok: false, reason: `"${opts.into}" is not a respin mode of this project any more.` };
	}
	const previousDecl = at >= 0 ? next.modes!.splice(at, 1)[0] : undefined;
	if (previousDecl) {
		delete next.paddingReels[gameTypeForMode(previousDecl)];
		// What it brought goes once nothing else deals it; `dropUnusedSymbols` keeps what the legacy
		// pair names, so it reads the pair through a view sharing `next.symbols`.
		const view = {
			...next,
			holdAndWin: legacyHoldAndWin(next),
			potsOverlay: legacyPotsOverlay(next),
		};
		dropUnusedSymbols(view, Object.values(previous?.symbols ?? {}), () => true);
	}

	const id = previousDecl?.id ?? freeRespinModeId(next, from.id);
	const gameTypes = new Set([
		...Object.keys(next.paddingReels),
		...resolveGameModes(next).map(gameTypeForMode),
	]);
	const gameType = previousDecl
		? gameTypeForMode(previousDecl)
		: freeName(respinGameTypeFor(id), gameTypes);

	const strips = Array.from({ length: next.numReels }, (_unused, reel) => own[reel % own.length]);
	const dealt = symbolsInPlayFromStrips({ [gameType]: strips });
	const game = structuredClone(from.holdAndWin);
	if (game.blank && !dealt.includes(game.blank)) dealt.push(game.blank);
	const renamed: AddOnRenames = { symbols: {}, pots: {} };
	const taken = new Set(Object.keys(next.symbols));
	const names: Record<string, string> = {};
	for (const wanted of dealt) {
		const entry: GameConfigSymbol = source.symbols[wanted] ?? {};
		// A meter's token fills the source's meter, which stays there.
		const roles = (entry.special_properties ?? []).filter((r) => r !== 'meterSpecial');
		const { special_properties: _roles, ...pays } = entry;
		const stored = previous?.symbols[wanted];
		const name = stored && !taken.has(stored) ? stored : freeName(wanted, taken);
		taken.add(name);
		names[wanted] = name;
		if (name !== wanted) renamed.symbols[wanted] = name;
		next.symbols[name] = structuredClone(
			roles.length ? { ...pays, special_properties: roles } : pays,
		);
	}
	next.paddingReels[gameType] = strips.map((strip) =>
		strip.map((cell) => ({ name: names[cell.name] ?? cell.name })),
	);
	if (game.blank) game.blank = names[game.blank] ?? game.blank;

	// Its presentation comes with it (music, counter, label); its HUD names a screen of the SOURCE's
	// layout, so the host's own stays, and so does a label the host gave it.
	const {
		hud: _hud,
		gameType: _sourceType,
		id: _sourceId,
		board: _board,
		holdAndWin: _rules,
		...presentation
	} = from;
	const [decl] =
		normalizeGameModes([
			{
				...presentation,
				id,
				board: 'respinBoard',
				gameType,
				label: previousDecl?.label ?? `${from.label ?? from.id} (${opts.project})`,
				...(previousDecl?.hud ? { hud: previousDecl.hud } : {}),
				holdAndWin: game,
			},
		]) ?? [];
	const modes = [...(next.modes ?? [])];
	modes.splice(at >= 0 ? at : modes.length, 0, decl);
	next.modes = modes;

	const undealt = (opts.routes ?? [])
		.map((route) => modeRouteRefusal(next, route, opts.hostKind))
		.find(Boolean);
	if (undealt) return { ok: false, reason: undealt };
	const refused = routeTo(next, id, game, opts.routes ?? []);
	if (refused) return { ok: false, reason: refused };
	// The primary respin mode's rules are the ones the game has always validated, a trigger included;
	// any other may wait unstarted until Coin overlay routes it.
	if (
		respinModeDecls(next)[0]?.id === id &&
		!overlayRoutes(next.coinOverlay).some((r) => r.mode === id)
	) {
		return {
			ok: false,
			reason:
				opts.hostKind === HOLD_AND_WIN_KIND || legacyPotsOverlay(next)?.pots.length
					? `"${id}" would be this project's only Hold and Win, so something must start it: pick a pot, a trigger or a buy tier.`
					: `"${id}" would be this project's only Hold and Win, so something must start it, and on this game only a pot can. Add a coin overlay with pots first (＋ Coin overlay… → 3 Pots).`,
		};
	}
	// A pot that starts it with a special its rules (re-synced) no longer deal starts it plain.
	const droppedActivates: string[] = [];
	for (const pot of next.coinOverlay?.pots ?? []) {
		const { bonus } = pot;
		if (bonus.mode !== id || !bonus.activates || game.specials[bonus.activates]) continue;
		droppedActivates.push(pot.id);
		delete bonus.activates;
	}

	const record: BonusImport = {
		mode: id,
		importedFrom: { project: opts.project, mode: opts.mode, at: opts.at },
		symbols: names,
		asMode: true,
	};
	next.imports = [...(next.imports ?? []).filter((i) => i.mode !== id), record];
	return {
		ok: true,
		doc: next,
		mode: id,
		renamed,
		symbols: names,
		leftOut: [],
		droppedActivates,
		replaced: false,
	};
}
