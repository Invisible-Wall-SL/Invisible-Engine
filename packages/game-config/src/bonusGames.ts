/**
 * BONUS GAMES — the split form of a project's bonuses (`docs/design/bonus-games.md` §2.1): a coin
 * overlay that triggers (`./coinOverlay`) and bonus modes that play, each respin mode carrying its
 * own Hold and Win game (`./holdAndWinGame`) on its `GameModeDecl`.
 *
 * MIGRATION. {@link normalizeBonusGames} turns a legacy `holdAndWin` and/or `potsOverlay` block — a
 * stored project, a preset, an old baked bundle — into the split form: the trigger half and the pots
 * go to `coinOverlay`, the respin half to a declared `holdAndWin` mode. It is the ONLY reader of the
 * two legacy keys, and a normalized doc never carries them (Phase 7b dropped the compat mirror).
 * When the input carries a legacy key beside a split form, the legacy key wins for everything it
 * holds — the primary respin mode's rules, the routes to it and its base-game flags, the pots and
 * drops — and the rest of the split form is kept.
 *
 * The legacy SHAPES live on as views of the split form: {@link primaryHoldAndWin} (the primary respin
 * mode's rules joined with the routes that start it, what the Hold and Win validator, mock and
 * runtime read) and {@link potsOverlayOf} (the overlay's pots, drops and timing).
 */

import { resolveFreeSpins } from './freeSpins';
import {
	holdAndWinBlankSymbol,
	normalizeHoldAndWin,
	symbolsWithRole,
	validateHoldAndWin,
	type HoldAndWin,
	type RespinPlay,
} from './holdAndWin';
import { joinHoldAndWin, splitHoldAndWin, type HoldAndWinGame } from './holdAndWinGame';
import {
	normalizeCoinOverlay,
	overlayDropsTokens,
	overlayRoutes,
	potsBlockOf,
	retargetRoutes,
	routesFrom,
	triggerHalfFor,
	type CoinOverlay,
} from './coinOverlay';
import { symbolsInPlayForGameType } from './inPlay';
import {
	BASE_GAME_MODE,
	FREE_SPINS_MODE,
	HOLD_AND_WIN_MODE,
	gameModeById,
	gameTypeForMode,
	holdAndWinModeDecl,
	normalizeGameModes,
	resolveGameModes,
	type GameModeDecl,
} from './modes';
import { normalizePotsOverlay, overlayDropModes, type PotsOverlay } from './potsOverlay';
import type { GameConfigDoc, LegacyBonusKeys } from './types';
import type { GameConfigIssue } from './validate';

type BonusDoc = Pick<GameConfigDoc, 'coinOverlay' | 'modes'>;

/** The split form: the overlay and the declared modes. */
export type BonusSplit = { coinOverlay?: CoinOverlay; modes?: GameModeDecl[] };

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const isRespinGame = (mode: GameModeDecl): mode is GameModeDecl & { holdAndWin: HoldAndWinGame } =>
	mode.board === 'respinBoard' && Boolean(mode.holdAndWin);

/**
 * The PRIMARY respin mode: `holdAndWin` when it is a respin mode with rules, else the first respin
 * mode with rules. The one a legacy block migrates onto, and the one the respin-family tools speak
 * for first.
 */
export function primaryRespinMode(
	modes: GameModeDecl[] | undefined,
): (GameModeDecl & { holdAndWin: HoldAndWinGame }) | undefined {
	const games = (modes ?? []).filter(isRespinGame);
	return games.find((m) => m.id === HOLD_AND_WIN_MODE) ?? games[0];
}

// ─── migration ────────────────────────────────────────────────────────────────────────────────

/**
 * The split form with a legacy pair applied (see the file header): the primary respin mode's rules,
 * the overlay's pots, drops and timing, the routes to the primary mode and the base-game flags come
 * from the pair; the overlay's style and coins, its routes to other modes, the flags of specials the
 * primary mode does not configure, and every other mode are kept. Without a `holdAndWin` the primary
 * mode is gone, with the routes to it.
 */
function applyLegacy(
	split: BonusSplit,
	holdAndWin: HoldAndWin | undefined,
	potsOverlay: PotsOverlay | undefined,
): BonusSplit {
	const modes = structuredClone(split.modes ?? []);
	const overlay = split.coinOverlay;
	let primary = primaryRespinMode(modes);
	// With no Hold and Win in the legacy pair, a route to the built-in's id is a route to nothing.
	let primaryId = primary?.id ?? HOLD_AND_WIN_MODE;
	let fromLegacy: Pick<CoinOverlay, 'trigger' | 'meters' | 'baseGame'> = {};
	let legacyKinds = new Set<string>();
	if (holdAndWin) {
		const { game, half } = splitHoldAndWin(holdAndWin);
		if (!primary) {
			// A legacy override of the built-in mode fills in on top of it, where the built-in sat.
			const at = modes.findIndex((m) => m.id === HOLD_AND_WIN_MODE);
			const override = at >= 0 ? modes.splice(at, 1)[0] : undefined;
			// It plays on the respin board whatever the override says, or the block would be lost.
			primary = { ...holdAndWinModeDecl(), ...override, board: 'respinBoard', holdAndWin: game };
			modes.unshift(primary);
		}
		const blank = primary.holdAndWin.blank;
		primary.holdAndWin = blank ? { ...game, blank } : game;
		primaryId = primary.id;
		legacyKinds = new Set(Object.keys(game.specials));
		fromLegacy = {
			...routesFrom(half, primary.id),
			...(half.baseGame ? { baseGame: half.baseGame } : {}),
		};
	} else if (primary) {
		modes.splice(modes.indexOf(primary), 1);
	}

	const keepRoute = (route: { mode: string }) => route.mode !== primaryId;
	const kept = overlay?.trigger;
	const trigger = {
		...(kept?.count && keepRoute(kept.count) ? { count: kept.count } : {}),
		...(kept?.pattern && keepRoute(kept.pattern) ? { pattern: kept.pattern } : {}),
		...(kept?.randomMetre && keepRoute(kept.randomMetre) ? { randomMetre: kept.randomMetre } : {}),
		...(kept?.luckySpin && keepRoute(kept.luckySpin) ? { luckySpin: kept.luckySpin } : {}),
		...fromLegacy.trigger,
		buy: [...(fromLegacy.trigger?.buy ?? []), ...(kept?.buy ?? []).filter(keepRoute)],
	};
	const { pots, drops, timing } = potsOverlay ?? {};
	const body = {
		pots,
		drops,
		timing,
		coins: overlay?.coins,
		baseGame: {
			...Object.fromEntries(
				Object.entries(overlay?.baseGame ?? {}).filter(([kind]) => !legacyKinds.has(kind)),
			),
			...fromLegacy.baseGame,
		},
		trigger,
		meters: [...(fromLegacy.meters ?? []), ...(overlay?.meters ?? []).filter(keepRoute)],
	};
	// A kept style stays; a new overlay's is inferred from what it holds.
	const coinOverlay = normalizeCoinOverlay({ ...body, style: overlay?.style });
	return {
		...(coinOverlay ? { coinOverlay } : {}),
		...(modes.length ? { modes: normalizeGameModes(modes) } : {}),
	};
}

/**
 * The split form of a raw config — `coinOverlay` and `modes` — with any legacy `holdAndWin` /
 * `potsOverlay` block migrated into it. What `normalizeGameConfigDoc` stores. Idempotent.
 */
export function normalizeBonusGames(raw: Record<string, unknown>): BonusSplit {
	const holdAndWin = normalizeHoldAndWin(raw.holdAndWin);
	const potsOverlay = normalizePotsOverlay(raw.potsOverlay);
	let split: BonusSplit = {
		coinOverlay: normalizeCoinOverlay(raw.coinOverlay),
		modes: normalizeGameModes(withLegacyOverrideBoard(raw.modes, Boolean(holdAndWin))),
	};
	// The pair wins as a pair: beside one legacy key, the other's absence means none.
	if (holdAndWin || potsOverlay) split = applyLegacy(split, holdAndWin, potsOverlay);
	split = pruneBaseGame(split);
	return {
		...(split.coinOverlay ? { coinOverlay: split.coinOverlay } : {}),
		...(split.modes ? { modes: split.modes } : {}),
	};
}

/**
 * `doc` without the legacy keys, for a tool that holds a doc unnormalized (`/config`'s live doc, from
 * a stored, preset, template or pasted config): when it carries one, its bonuses are migrated into
 * the split form by {@link normalizeBonusGames} and the rest of it is left exactly as it was. A fresh
 * copy.
 */
export function migrateLegacyBonus<T extends BonusDoc>(doc: T & LegacyBonusKeys): T {
	const out = structuredClone(doc);
	if (out.holdAndWin === undefined && out.potsOverlay === undefined) return out;
	const { coinOverlay, modes } = normalizeBonusGames(doc);
	delete out.holdAndWin;
	delete out.potsOverlay;
	if (coinOverlay) out.coinOverlay = coinOverlay;
	else delete out.coinOverlay;
	if (modes) out.modes = modes;
	else delete out.modes;
	return out;
}

/** Beside a legacy block, an override of the built-in Hold and Win mode is on the respin board: it
 *  may omit the board (the built-in gave it), and a `reels` or `none` one would drop the block's
 *  rules before migration could put them on it. */
function withLegacyOverrideBoard(raw: unknown, legacy: boolean): unknown {
	if (!legacy || !Array.isArray(raw)) return raw;
	return raw.map((entry) =>
		isObject(entry) && entry.id === HOLD_AND_WIN_MODE ? { ...entry, board: 'respinBoard' } : entry,
	);
}

/** The overlay without base-game flags for a special no respin mode configures — a flag says what a
 *  special of a respin game does in the base game, so without the game it means nothing. */
function pruneBaseGame(split: BonusSplit): BonusSplit {
	const flags = split.coinOverlay?.baseGame;
	if (!flags) return split;
	const configured = new Set(
		(split.modes ?? []).flatMap((m) => Object.keys(m.holdAndWin?.specials ?? {})),
	);
	const kept = Object.fromEntries(Object.entries(flags).filter(([kind]) => configured.has(kind)));
	if (Object.keys(kept).length === Object.keys(flags).length) return split;
	const { baseGame: _flags, ...rest } = split.coinOverlay!;
	const coinOverlay = normalizeCoinOverlay({ ...rest, baseGame: kept });
	return {
		...(coinOverlay ? { coinOverlay } : {}),
		...(split.modes ? { modes: split.modes } : {}),
	};
}

// ─── the legacy shapes, as views of the split form ────────────────────────────────────────────

/** The primary respin mode's rules joined with the routes that start it and the base-game flags —
 *  the Hold and Win block shape the validator, the mock and the runtime read. */
export function primaryHoldAndWin(doc: BonusDoc): HoldAndWin | undefined {
	const primary = primaryRespinMode(doc.modes);
	return primary
		? joinHoldAndWin(primary.holdAndWin, triggerHalfFor(doc.coinOverlay, primary.id))
		: undefined;
}

/** The overlay's pots, drops and timing in the pots-overlay block shape, or `undefined` when nothing
 *  drops. */
export const potsOverlayOf = (doc: BonusDoc): PotsOverlay | undefined =>
	normalizePotsOverlay(potsBlockOf(doc.coinOverlay));

/** Write `split` onto `doc` in place, base-game flags pruned. */
function writeSplit<T extends BonusDoc>(doc: T, split: BonusSplit): T {
	const { coinOverlay, modes } = pruneBaseGame(split);
	if (coinOverlay) doc.coinOverlay = coinOverlay;
	else delete doc.coinOverlay;
	if (modes) doc.modes = modes;
	else delete doc.modes;
	return doc;
}

/**
 * Make `block` — a Hold and Win in the block shape: a preset's, or a source project's
 * {@link primaryHoldAndWin} — `doc`'s primary respin mode, in place: its rules, the routes that start
 * it and its base-game flags replace the primary's (a new primary is declared first, on the respin
 * board). Every other mode and route is kept. Returns `doc`.
 */
export function setPrimaryHoldAndWin<T extends BonusDoc>(doc: T, block: HoldAndWin): T {
	return writeSplit(doc, applyLegacy(doc, block, potsOverlayOf(doc)));
}

/**
 * Give `doc`'s coin overlay the pots, drops and timing of `pots` in place (none: `undefined`), keeping
 * its style, coins and routes. Returns `doc`.
 */
export function setOverlayPots<T extends BonusDoc>(doc: T, pots: PotsOverlay | undefined): T {
	return writeSplit(doc, applyLegacy(doc, primaryHoldAndWin(doc), pots));
}

/**
 * Take the primary respin mode out of `doc`, in place, with the routes to it (and a rule-less
 * override of the built-in `holdAndWin` mode). Returns `doc`.
 *
 * A POT that started it is left naming it: the overlay's own removal takes the pots too, and an
 * import that replaces the mode re-declares the id they name. Removing the mode on its own is
 * `removeRespinMode` (`./bonusModes`), which re-routes them.
 */
export function removeHoldAndWin<T extends BonusDoc>(doc: T): T {
	const { coinOverlay, modes } = pruneBaseGame(applyLegacy(doc, undefined, potsOverlayOf(doc)));
	return writeSplit(doc, {
		coinOverlay,
		modes: modes?.filter((m) => m.id !== HOLD_AND_WIN_MODE),
	});
}

// ─── resolve ──────────────────────────────────────────────────────────────────────────────────

/** What starts a bonus mode. */
export type BonusRoute =
	| { kind: 'pot'; pot: string }
	| { kind: 'count' | 'pattern' | 'randomMetre' | 'luckySpin' }
	| { kind: 'buy'; betMode: string }
	| { kind: 'meter'; meter: string }
	/** The base game's scatters (free spins, `./freeSpins`). */
	| { kind: 'scatters' };

/** One bonus mode: its declaration, its rules when it is a respin game, and what starts it. */
export type ResolvedBonusMode = {
	mode: GameModeDecl;
	/** The game type its board pads from. */
	gameType: string;
	/** A respin mode's Hold and Win game. */
	holdAndWin?: HoldAndWinGame;
	routes: BonusRoute[];
};

/**
 * Every bonus mode the project has — every mode but the base game, in mode order — with what starts
 * each.
 */
export function resolveBonusModes(doc: GameConfigDoc): ResolvedBonusMode[] {
	const overlay = doc.coinOverlay;
	const t = overlay?.trigger;
	const freeSpins = resolveFreeSpins(doc);
	return resolveGameModes(doc)
		.filter((mode) => mode.id !== BASE_GAME_MODE)
		.map((mode) => {
			const routes: BonusRoute[] = [
				...(mode.id === FREE_SPINS_MODE && freeSpins.enabled
					? [{ kind: 'scatters' as const }]
					: []),
				...(overlay?.pots ?? [])
					.filter((p) => p.bonus.mode === mode.id)
					.map((p) => ({ kind: 'pot' as const, pot: p.id })),
				...(['count', 'pattern', 'randomMetre', 'luckySpin'] as const)
					.filter((kind) => t?.[kind]?.mode === mode.id)
					.map((kind) => ({ kind })),
				...(t?.buy ?? [])
					.filter((tier) => tier.mode === mode.id)
					.map((tier) => ({ kind: 'buy' as const, betMode: tier.betMode })),
				...(overlay?.meters ?? [])
					.filter((m) => m.mode === mode.id)
					.map((m) => ({ kind: 'meter' as const, meter: m.id })),
			];
			return {
				mode,
				gameType: gameTypeForMode(mode),
				...(isRespinGame(mode) ? { holdAndWin: mode.holdAndWin } : {}),
				routes,
			};
		});
}

/**
 * The capability INPUTS the split form gives (design §2.4): is there a respin mode with rules (a
 * rule-less one is inert, so it lights nothing), is there an overlay, and does the overlay drop
 * tokens (the pots overlay's own parts, {@link potsOverlayOf}'s predicate). The launcher's
 * `projectAddOns` turns them into `kindCapabilities`' config.
 */
export function bonusCapabilityInputs(doc: BonusDoc): {
	respinMode: boolean;
	coinOverlay: boolean;
	potsOverlay: boolean;
} {
	return {
		respinMode: (doc.modes ?? []).some(isRespinGame),
		coinOverlay: Boolean(doc.coinOverlay),
		potsOverlay: overlayDropsTokens(doc.coinOverlay),
	};
}

/** The respin modes with rules, read off the split form: the primary first
 *  ({@link primaryRespinMode}), then the rest in declaration order; `[]` without Hold and Win. The
 *  one list the tools (Scene Editor screens, `/symbols` tiers, Flow tabs) and the runtime order by. */
export function respinModeDecls(doc: BonusDoc): (GameModeDecl & { holdAndWin: HoldAndWinGame })[] {
	const modes = (doc.modes ?? []).filter(isRespinGame);
	const primary = primaryRespinMode(modes);
	return primary ? [primary, ...modes.filter((m) => m !== primary)] : [];
}

/** {@link respinModeDecls}' ids. */
export const respinModeIds = (doc: BonusDoc): string[] => respinModeDecls(doc).map((m) => m.id);

/** The symbol an empty cell of respin mode `mode` draws: its `blank`, else the first symbol tagged
 *  `blank` its strips deal, else the wire's literal `BLANK`. */
export function respinModeBlank(doc: GameConfigDoc, mode: GameModeDecl): string {
	if (mode.holdAndWin?.blank) return mode.holdAndWin.blank;
	const dealt = new Set(symbolsInPlayForGameType(doc, gameTypeForMode(mode)));
	return symbolsWithRole(doc, 'blank').find((name) => dealt.has(name)) ?? 'BLANK';
}

/** A respin mode's rules in the legacy block's shape (design §2.3). */
export type RespinModeBlock = {
	mode: string;
	/** Its strip key: the respin board rolls `paddingReels[gameType]`. */
	gameType: string;
	/** Its rules joined with the routes that start it; the primary's is {@link primaryHoldAndWin}. */
	block: HoldAndWin;
	/** Its declaration in the split form. */
	decl: GameModeDecl & { holdAndWin: HoldAndWinGame };
};

/** Every respin mode with rules, the primary first ({@link primaryRespinMode}); `[]` without Hold
 *  and Win. */
export function respinModeBlocks(doc: BonusDoc): RespinModeBlock[] {
	const overlay = doc.coinOverlay;
	return respinModeDecls(doc).map((mode) => ({
		mode: mode.id,
		gameType: gameTypeForMode(mode),
		block: joinHoldAndWin(mode.holdAndWin, triggerHalfFor(overlay, mode.id)),
		decl: mode,
	}));
}

/** Is this respin set the lone default — `holdAndWin` on the `respin` strip, alone? Such a game's
 *  wire and mock inputs are exactly what they were before bonus modes (design §2.2). */
export const isLoneDefaultRespinSet = (modes: readonly RespinModeBlock[]): boolean =>
	modes.length === 1 && modes[0].mode === HOLD_AND_WIN_MODE && modes[0].gameType === 'respin';

/** A respin mode as the game plays it: its rules, its empty cell and how its respins are played. */
export type RespinModeRules = RespinModeBlock & {
	/** The symbol an empty cell of its board draws, as the mock picks it. */
	blank: string;
	play: RespinPlay;
};

/**
 * {@link respinModeBlocks} with each mode's blank and play setting. The lone default mode keeps the
 * blank the whole game deals (`holdAndWinBlankSymbol`), any other set each mode's own
 * (`respinModeBlank`) — the mock's pick in either case (`holdAndWinMockInputs`).
 */
export function respinModeRules(doc: GameConfigDoc): RespinModeRules[] {
	const modes = respinModeBlocks(doc);
	const loneDefault = isLoneDefaultRespinSet(modes);
	return modes.map((entry) => ({
		...entry,
		blank: loneDefault ? holdAndWinBlankSymbol(doc) : respinModeBlank(doc, entry.decl),
		play: entry.block.play ?? 'auto',
	}));
}

// ─── validate ─────────────────────────────────────────────────────────────────────────────────

/** The id the real `holdAndWin` mode takes while another mode is validated in its place. */
const STAND_IN = '__primary';

/**
 * The Hold and Win validator's issues for a respin mode other than the primary (Phase 1 owed this):
 * the doc is viewed with `id` as the primary — so {@link primaryHoldAndWin} is its rules and the
 * routes that start it — and each issue about the block is reported under `modes.<id>.holdAndWin`. Doc-wide issues (the
 * win model, a symbol's paytable) are the primary's run's, so they are not repeated.
 */
function respinModeIssues(doc: GameConfigDoc, id: string, started: boolean): GameConfigIssue[] {
	const swap = (mode: string) =>
		mode === id ? HOLD_AND_WIN_MODE : mode === HOLD_AND_WIN_MODE ? STAND_IN : mode;
	const split: BonusSplit = {
		modes: (doc.modes ?? []).map((m) => ({ ...m, id: swap(m.id) })),
		...(doc.coinOverlay ? { coinOverlay: retargetRoutes(doc.coinOverlay, swap) } : {}),
	};
	const { coinOverlay: _overlay, modes: _modes, ...rest } = doc;
	const asPrimary: GameConfigDoc = { ...rest, ...split };
	const prefix = `modes.${id}.holdAndWin`;
	return validateHoldAndWin(asPrimary).flatMap((issue): GameConfigIssue[] => {
		if (issue.path !== 'holdAndWin' && !issue.path.startsWith('holdAndWin.')) return [];
		const path = prefix + issue.path.slice('holdAndWin'.length);
		// Nothing starts it: say where to route it. An unstarted mode is inert, so none of its issues
		// blocks a save — adding a mode, then its rules, then its route never passes through an error.
		const message =
			issue.path === 'holdAndWin.trigger' && !started
				? `Nothing starts "${id}" yet — route a trigger or a pot to "${id}" in Coin overlay.`
				: issue.message;
		return [{ ...issue, path, message, ...(started ? {} : { severity: 'warning' as const }) }];
	});
}

/**
 * The split form's own rules (design §3 Phase 1): every overlay route names a declared bonus mode;
 * every trigger and meter starts a respin mode; every respin mode has rules and a strip (warnings
 * until Phase 5a can author them), and a blank it names is one it deals; no respin mode starts
 * inside another; and no two respin modes share a strip key, which is their bonus key on the wire
 * (Phase 2). Pots are `validatePotsOverlay`'s. Paths name the mode.
 */
export function validateBonusModes(doc: GameConfigDoc): GameConfigIssue[] {
	const issues: GameConfigIssue[] = [];
	const overlay = doc.coinOverlay;
	const primary = primaryRespinMode(doc.modes);
	/** Strip key → the respin mode that plays on it first: the key is also its bonus key on the wire. */
	const stripOwner = new Map<string, string>();

	for (const mode of resolveGameModes(doc)) {
		if (mode.board !== 'respinBoard') continue;
		const path = `modes.${mode.id}`;
		const strip = gameTypeForMode(mode);
		const sharer = stripOwner.get(strip);
		if (sharer) {
			issues.push({
				severity: 'error',
				path: `${path}.gameType`,
				message: `The respin modes "${sharer}" and "${mode.id}" both play on the "${strip}" strips; each respin mode needs its own.`,
			});
		} else stripOwner.set(strip, mode.id);
		const started = overlayRoutes(overlay).some((route) => route.mode === mode.id);
		if (!mode.holdAndWin) {
			// An error only where something starts the mode (Phase 5a: `/config` → Bonus modes gives it
			// rules in one click); an unstarted one is inert, and a config that saved with it still saves.
			issues.push({
				severity: started ? 'error' : 'warning',
				path: `${path}.holdAndWin`,
				message: started
					? `The respin mode "${mode.id}" is started by the coin overlay but has no Hold and Win rules to play — give it rules in Bonus modes.`
					: `The respin mode "${mode.id}" has no Hold and Win rules, so nothing can play it.`,
			});
		} else if (mode.id !== primary?.id) {
			issues.push(...respinModeIssues(doc, mode.id, started));
		}
		const gameType = gameTypeForMode(mode);
		if (!doc.paddingReels[gameType]?.length) {
			issues.push({
				severity: 'warning',
				path: `${path}.gameType`,
				message: `The respin mode "${mode.id}" has no "${gameType}" strips to deal its respins from.`,
			});
		}
		const blank = mode.holdAndWin?.blank;
		if (blank) {
			if (!doc.symbols[blank]) {
				issues.push({
					severity: 'error',
					path: `${path}.holdAndWin.blank`,
					message: `"${mode.id}"'s blank ${blank} is not in the symbol dictionary.`,
				});
			} else if (!symbolsInPlayForGameType(doc, gameType).includes(blank)) {
				issues.push({
					severity: 'warning',
					path: `${path}.holdAndWin.blank`,
					message: `"${mode.id}"'s blank ${blank} is not on its "${gameType}" strips, so no empty cell is dealt as it.`,
				});
			}
		}
	}

	// Where each route can fire: the base game for a landing, plus the dropping modes for a drop.
	const dropping = overlay?.drops ? overlayDropModes(overlay.drops) : [];
	// A spins game draws its own grid, and a respin feature on top of it would bring the base grid
	// back for its board, so nothing drops while one plays.
	for (const id of dropping) {
		if (gameModeById(doc, id)?.spins) {
			issues.push({
				severity: 'error',
				path: 'coinOverlay.drops.modes',
				message: `Tokens drop in "${id}", a spins game: nothing drops while a spins game plays.`,
			});
		}
	}
	overlay?.pots?.forEach((pot, i) => {
		const target = gameModeById(doc, pot.bonus.mode);
		if (pot.bonus.spins !== undefined && target?.spins) {
			issues.push({
				severity: 'warning',
				path: `coinOverlay.pots.${i}.bonus.spins`,
				message: `"${pot.bonus.mode}" is a spins game: it plays its own ${target.spins.spins} spins, not the pot's ${pot.bonus.spins}.`,
			});
		}
	});
	for (const route of overlayRoutes(overlay)) {
		const path = `coinOverlay.${route.path}`;
		const target = gameModeById(doc, route.mode);
		const isPot = route.path.startsWith('pots.');
		if (!isPot) {
			if (!target) {
				issues.push({
					severity: 'error',
					path,
					message: `It starts "${route.mode}", which is not a mode this project has.`,
				});
				continue;
			}
			// A spins game (`./spinsGame`) is also bought, or started by a Lucky Spin or a random metre;
			// the coin count, a pattern and a meter count coins, which belong to a respin game.
			const spinsGame = target.board === 'reels' && Boolean(target.spins);
			const spinsRoute = /^trigger\.(buy\.\d+|luckySpin|randomMetre)\.mode$/.test(route.path);
			if (spinsGame && !spinsRoute) {
				issues.push({
					severity: 'error',
					path,
					message: `It starts the spins game "${route.mode}", which only a pot, a buy, a Lucky Spin or a random metre starts.`,
				});
			} else if (target.board !== 'respinBoard' && !spinsGame) {
				issues.push({
					severity: 'error',
					path,
					message: `It starts "${route.mode}", but only a Hold and Win (respin board) mode is started this way.`,
				});
			}
		}
		const from =
			isPot || route.path === 'trigger.count.mode'
				? [BASE_GAME_MODE, ...dropping]
				: [BASE_GAME_MODE];
		const host = from.find((m) => gameModeById(doc, m)?.board === 'respinBoard');
		if (target?.board === 'respinBoard' && host) {
			issues.push({
				severity: 'error',
				path,
				message: `It starts the respin mode "${route.mode}" from inside the respin mode "${host}"; one respin board plays at a time.`,
			});
		}
	}

	// The base-game coin table names jackpot tiers of the respin games it starts.
	const tiers = new Set(
		(doc.modes ?? []).flatMap((m) => (m.holdAndWin?.jackpots ?? []).map((j) => j.name)),
	);
	// The primary's engine deals the base game, so only its tiers pay a base-game jackpot coin.
	const primaryTiers = new Set((primary?.holdAndWin.jackpots ?? []).map((j) => j.name));
	overlay?.coins?.forEach((coin, i) => {
		if (coin.kind !== 'jackpot') return;
		if (!tiers.has(coin.jackpot)) {
			issues.push({
				severity: 'error',
				path: `coinOverlay.coins.${i}.jackpot`,
				message: `"${coin.jackpot}" is not a jackpot tier of any respin mode.`,
			});
		} else if (primary && !primaryTiers.has(coin.jackpot)) {
			issues.push({
				severity: 'warning',
				path: `coinOverlay.coins.${i}.jackpot`,
				message: `"${coin.jackpot}" is not a jackpot tier of "${primary.id}", whose game deals the base-game coins, so a ${coin.jackpot} coin dropped there pays nothing.`,
			});
		}
	});

	// A buy tier routed to the primary is `validateHoldAndWin`'s to check.
	overlay?.trigger?.buy?.forEach((tier, i) => {
		if (tier.mode === primary?.id) return;
		const bet = doc.betModes[tier.betMode];
		if (!bet || !bet.buyBonus) {
			issues.push({
				severity: 'error',
				path: `coinOverlay.trigger.buy.${i}.betMode`,
				message: bet
					? `Bet mode "${tier.betMode}" is not a buy-bonus mode.`
					: `Bet mode "${tier.betMode}" does not exist.`,
			});
		}
	});
	return issues;
}
