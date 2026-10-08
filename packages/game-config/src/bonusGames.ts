/**
 * BONUS GAMES — the split form of a project's bonuses (`docs/design/bonus-games.md` §2.1): a coin
 * overlay that triggers (`./coinOverlay`) and bonus modes that play, each respin mode carrying its
 * own Hold and Win game (`./holdAndWinGame`) on its `GameModeDecl`.
 *
 * MIGRATION. {@link normalizeBonusGames} turns a legacy `holdAndWin` and/or `potsOverlay` block into
 * the split form: the trigger half and the pots go to `coinOverlay`, the respin half to a declared
 * `holdAndWin` mode. Nothing is lost; the gate is that a legacy doc and its split form give the same
 * mock inputs, modes and meters (`bonusGames.fixture.ts`).
 *
 * THE COMPAT MIRROR. Until every reader has moved to per-mode reads (design §3 Phases 2–7), a
 * normalized doc ALSO carries the legacy `holdAndWin` and `potsOverlay` keys, derived from the split
 * form: the PRIMARY respin mode ({@link primaryRespinMode}) and the routes that start it, and the
 * overlay's pots and drops. The rule that keeps both the unmigrated writers and normalization honest:
 *
 *  - when the input carries a legacy key, the LEGACY PAIR is authoritative for everything the mirror
 *    shows — an unmigrated writer (the add-ons, the import) edits only those keys — and everything
 *    the mirror cannot show is kept from the split form;
 *  - when it carries neither, the split form is authoritative. A writer of the split form (`/config`,
 *    `./bonusModes`) therefore deletes both legacy keys before it saves ({@link splitFormOf});
 *  - Hold and Win is REMOVED only through {@link removeHoldAndWin}: deleting the `holdAndWin` key
 *    alone brings it back on a doc without a `potsOverlay` and drops it beside one.
 *
 * Read the legacy blocks through {@link legacyHoldAndWin} / {@link legacyPotsOverlay} in this package,
 * so a doc that is only in the split form reads the same.
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
	legacyPotsOverlayOf,
	normalizeCoinOverlay,
	overlayDropsTokens,
	overlayRoutes,
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
import type { GameConfigDoc } from './types';
import type { GameConfigIssue } from './validate';

type BonusDoc = Pick<GameConfigDoc, 'holdAndWin' | 'potsOverlay' | 'coinOverlay' | 'modes'>;

/** The split form: the overlay and the declared modes. */
export type BonusSplit = { coinOverlay?: CoinOverlay; modes?: GameModeDecl[] };

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const isRespinGame = (mode: GameModeDecl): mode is GameModeDecl & { holdAndWin: HoldAndWinGame } =>
	mode.board === 'respinBoard' && Boolean(mode.holdAndWin);

/**
 * The respin mode the legacy keys mirror: `holdAndWin` when it is a respin mode with rules, else the
 * first respin mode with rules. One per project until imports add a second (design §3 Phase 6).
 */
export function primaryRespinMode(
	modes: GameModeDecl[] | undefined,
): (GameModeDecl & { holdAndWin: HoldAndWinGame }) | undefined {
	const games = (modes ?? []).filter(isRespinGame);
	return games.find((m) => m.id === HOLD_AND_WIN_MODE) ?? games[0];
}

// ─── migration ────────────────────────────────────────────────────────────────────────────────

/**
 * The split form with the legacy pair applied (see the file header): the primary respin mode's rules,
 * the overlay's pots, drops and timing, the routes to the primary mode and the base-game flags come
 * from the legacy pair; the overlay's style and coins, its routes to other modes, the flags of
 * specials the primary mode does not configure, and every other mode are kept. Without a legacy
 * `holdAndWin` the primary mode is gone, with the routes to it.
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

/** The legacy pair a split form mirrors, normalized as the legacy readers have always seen it. */
function mirrorOf(split: BonusSplit): Pick<GameConfigDoc, 'holdAndWin' | 'potsOverlay'> {
	const primary = primaryRespinMode(split.modes);
	const holdAndWin = primary
		? joinHoldAndWin(primary.holdAndWin, triggerHalfFor(split.coinOverlay, primary.id))
		: undefined;
	const potsOverlay = normalizePotsOverlay(legacyPotsOverlayOf(split.coinOverlay));
	return {
		...(holdAndWin ? { holdAndWin } : {}),
		...(potsOverlay ? { potsOverlay } : {}),
	};
}

/**
 * The split form of a raw config — `coinOverlay` (or the legacy `potsOverlay` key) and `modes` —
 * with the legacy blocks migrated into it, plus the compat mirror. What `normalizeGameConfigDoc`
 * stores. Idempotent: the mirror of a normalized doc is what applying it back changes nothing with.
 */
export function normalizeBonusGames(
	raw: Record<string, unknown>,
): Pick<GameConfigDoc, 'holdAndWin' | 'potsOverlay' | 'coinOverlay' | 'modes'> {
	const holdAndWin = normalizeHoldAndWin(raw.holdAndWin);
	const potsOverlay = normalizePotsOverlay(raw.potsOverlay);
	let split: BonusSplit = {
		coinOverlay: normalizeCoinOverlay(raw.coinOverlay),
		modes: normalizeGameModes(withLegacyOverrideBoard(raw.modes, Boolean(holdAndWin))),
	};
	if (holdAndWin || potsOverlay) split = applyLegacy(split, holdAndWin, potsOverlay);
	split = pruneBaseGame(split);
	return {
		...mirrorOf(split),
		...(split.coinOverlay ? { coinOverlay: split.coinOverlay } : {}),
		...(split.modes ? { modes: split.modes } : {}),
	};
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

// ─── compat accessors ─────────────────────────────────────────────────────────────────────────

const carriesLegacy = (doc: BonusDoc): boolean => Boolean(doc.holdAndWin || doc.potsOverlay);

/** The legacy `holdAndWin` block: the doc's own when it carries the legacy pair, else the primary
 *  respin mode's rules joined with the routes that start it. */
export function legacyHoldAndWin(doc: BonusDoc): HoldAndWin | undefined {
	if (carriesLegacy(doc)) return doc.holdAndWin;
	const primary = primaryRespinMode(doc.modes);
	return primary
		? joinHoldAndWin(primary.holdAndWin, triggerHalfFor(doc.coinOverlay, primary.id))
		: undefined;
}

/** The legacy `potsOverlay` block: the doc's own when it carries the legacy pair, else the
 *  overlay's pots and drops. */
export function legacyPotsOverlay(doc: BonusDoc): PotsOverlay | undefined {
	if (carriesLegacy(doc)) return doc.potsOverlay;
	return legacyPotsOverlayOf(doc.coinOverlay);
}

/**
 * Give `doc` the legacy pair, in place, when it is only in the split form — what an unmigrated writer
 * in this package (`./addOns`, `./imports`) does first, so its legacy edits are the whole story and
 * normalization applies them over the split form (file header). Returns `doc`.
 */
export function withLegacyPair<T extends BonusDoc>(doc: T): T {
	if (carriesLegacy(doc)) return doc;
	const holdAndWin = legacyHoldAndWin(doc);
	const potsOverlay = legacyPotsOverlay(doc);
	if (holdAndWin) doc.holdAndWin = holdAndWin;
	if (potsOverlay) doc.potsOverlay = potsOverlay;
	return doc;
}

/** Rewrite `doc`'s split form from the legacy pair it carries, in place — what an unmigrated writer
 *  here does last, so its result is already the doc normalization stores. Returns `doc`. */
export function syncBonusSplit<T extends BonusDoc>(doc: T): T {
	const { coinOverlay, modes } = bonusSplitOf(doc);
	if (coinOverlay) doc.coinOverlay = coinOverlay;
	else delete doc.coinOverlay;
	if (modes) doc.modes = modes;
	else delete doc.modes;
	return doc;
}

/**
 * The doc a writer of the split form saves (design §2.1 "What writers must do"): its split form, with
 * the legacy pair applied when it carries one, and BOTH legacy keys deleted — so its edits are not
 * overwritten by a stale mirror. Normalizing it stores the same split form with the mirror
 * regenerated. A fresh copy; `doc` is not touched.
 */
export function splitFormOf<T extends GameConfigDoc>(doc: T): T {
	const out = syncBonusSplit(structuredClone(doc));
	delete out.holdAndWin;
	delete out.potsOverlay;
	return out;
}

/**
 * Take Hold and Win out of `doc`, in place: the legacy block, the primary respin mode and the routes
 * to it, with the legacy pair re-mirrored from what is left. The ONE way to remove it: deleting only
 * the `holdAndWin` key brings it back on a doc without a `potsOverlay` (the split form stands) and
 * drops it beside one (the legacy pair is applied). Returns `doc`.
 *
 * A POT that started it is left naming it: the overlay's own removal takes the pots too, and an
 * import that replaces the mode re-declares the id they name. Removing the mode on its own is
 * `removeRespinMode` (`./bonusModes`), which re-routes them.
 */
export function removeHoldAndWin<T extends BonusDoc>(doc: T): T {
	withLegacyPair(doc);
	const { coinOverlay, modes } = pruneBaseGame(
		applyLegacy(
			{ coinOverlay: normalizeCoinOverlay(doc.coinOverlay), modes: normalizeGameModes(doc.modes) },
			undefined,
			normalizePotsOverlay(doc.potsOverlay),
		),
	);
	// A legacy override of the built-in mode (no rules of its own) goes with the block too.
	const kept = modes?.filter((m) => m.id !== HOLD_AND_WIN_MODE);
	delete doc.holdAndWin;
	delete doc.potsOverlay;
	if (coinOverlay) doc.coinOverlay = coinOverlay;
	else delete doc.coinOverlay;
	if (kept?.length) doc.modes = kept;
	else delete doc.modes;
	return withLegacyPair(doc);
}

/** The split form of any doc — normalized, legacy or split — with the legacy pair applied when it
 *  carries one, so an unmigrated writer's live edit reads through. */
export function bonusSplitOf(doc: BonusDoc): BonusSplit {
	const split: BonusSplit = { coinOverlay: doc.coinOverlay, modes: doc.modes };
	if (!carriesLegacy(doc)) return structuredClone(split);
	return pruneBaseGame(
		applyLegacy(
			{
				coinOverlay: normalizeCoinOverlay(doc.coinOverlay),
				modes: normalizeGameModes(withLegacyOverrideBoard(doc.modes, Boolean(doc.holdAndWin))),
			},
			normalizeHoldAndWin(doc.holdAndWin),
			normalizePotsOverlay(doc.potsOverlay),
		),
	);
}

/** The doc as the split form reads it: the legacy pair applied, then left out, so every mode read
 *  sees only the declared modes. */
function splitView(doc: GameConfigDoc): GameConfigDoc & BonusSplit {
	const {
		holdAndWin: _hw,
		potsOverlay: _pots,
		coinOverlay: _overlay,
		modes: _modes,
		...rest
	} = doc;
	return { ...rest, ...bonusSplitOf(doc) };
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
 * each. Read through the split form ({@link bonusSplitOf}), so a legacy doc lists its Hold and Win
 * mode and the routes its block implied.
 */
export function resolveBonusModes(doc: GameConfigDoc): ResolvedBonusMode[] {
	const view = splitView(doc);
	const overlay = view.coinOverlay;
	const t = overlay?.trigger;
	const freeSpins = resolveFreeSpins(doc);
	return resolveGameModes(view)
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
 * rule-less one is inert, so it lights nothing, and every rule-bearing one has a mirror), is there
 * an overlay, and does the overlay drop tokens (the pots overlay's own parts — the predicate
 * the legacy `potsOverlay` mirror uses, so the two cannot drift). The launcher's `projectAddOns`
 * turns them into `kindCapabilities`' config.
 */
export function bonusCapabilityInputs(doc: BonusDoc): {
	respinMode: boolean;
	coinOverlay: boolean;
	potsOverlay: boolean;
} {
	const split = bonusSplitOf(doc);
	return {
		respinMode: (split.modes ?? []).some(isRespinGame),
		coinOverlay: Boolean(split.coinOverlay),
		potsOverlay: overlayDropsTokens(split.coinOverlay),
	};
}

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
	/** Its rules joined with the routes that start it. The primary's IS the legacy block
	 *  ({@link legacyHoldAndWin}), so a game with one respin mode reads what it always read. */
	block: HoldAndWin;
	/** Its declaration in the split form. */
	decl: GameModeDecl & { holdAndWin: HoldAndWinGame };
};

/** Every respin mode with rules, the primary first ({@link primaryRespinMode}); `[]` without Hold
 *  and Win. */
export function respinModeBlocks(doc: BonusDoc): RespinModeBlock[] {
	const block = legacyHoldAndWin(doc);
	if (!block) return [];
	const split = bonusSplitOf(doc);
	const primary = primaryRespinMode(split.modes);
	if (!primary) return [];
	const others = (split.modes ?? []).filter(
		(m): m is GameModeDecl & { holdAndWin: HoldAndWinGame } => m !== primary && isRespinGame(m),
	);
	return [
		{ mode: primary.id, gameType: gameTypeForMode(primary), block, decl: primary },
		...others.map((mode) => ({
			mode: mode.id,
			gameType: gameTypeForMode(mode),
			block: joinHoldAndWin(mode.holdAndWin, triggerHalfFor(split.coinOverlay, mode.id)),
			decl: mode,
		})),
	];
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
 * The legacy validator's issues for a respin mode the mirror does not show (Phase 1 owed this): the
 * doc is viewed with `id` as the primary — its rules and the routes that start it in the legacy pair
 * — and each issue about the block is reported under `modes.<id>.holdAndWin`. Doc-wide issues (the
 * win model, a symbol's paytable) are the primary's run's, so they are not repeated.
 */
function respinModeIssues(
	doc: GameConfigDoc,
	view: GameConfigDoc & BonusSplit,
	id: string,
	started: boolean,
): GameConfigIssue[] {
	const swap = (mode: string) =>
		mode === id ? HOLD_AND_WIN_MODE : mode === HOLD_AND_WIN_MODE ? STAND_IN : mode;
	const split: BonusSplit = {
		modes: (view.modes ?? []).map((m) => ({ ...m, id: swap(m.id) })),
		...(view.coinOverlay ? { coinOverlay: retargetRoutes(view.coinOverlay, swap) } : {}),
	};
	const holdAndWin = legacyHoldAndWin(split);
	const potsOverlay = legacyPotsOverlay(split);
	const asPrimary: GameConfigDoc = {
		...view,
		...split,
		...(holdAndWin ? { holdAndWin } : {}),
		...(potsOverlay ? { potsOverlay } : {}),
	};
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
 * (Phase 2). Pots are the legacy validator's (`validatePotsOverlay`, on the mirror). Paths name
 * the mode.
 */
export function validateBonusModes(doc: GameConfigDoc): GameConfigIssue[] {
	const issues: GameConfigIssue[] = [];
	const view = splitView(doc);
	const overlay = view.coinOverlay;
	const primary = primaryRespinMode(view.modes);
	/** Strip key → the respin mode that plays on it first: the key is also its bonus key on the wire. */
	const stripOwner = new Map<string, string>();

	for (const mode of resolveGameModes(view)) {
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
			issues.push(...respinModeIssues(doc, view, mode.id, started));
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
	for (const route of overlayRoutes(overlay)) {
		const path = `coinOverlay.${route.path}`;
		const target = gameModeById(view, route.mode);
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
			if (target.board !== 'respinBoard') {
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
		const host = from.find((m) => gameModeById(view, m)?.board === 'respinBoard');
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
		(view.modes ?? []).flatMap((m) => (m.holdAndWin?.jackpots ?? []).map((j) => j.name)),
	);
	overlay?.coins?.forEach((coin, i) => {
		if (coin.kind === 'jackpot' && !tiers.has(coin.jackpot)) {
			issues.push({
				severity: 'error',
				path: `coinOverlay.coins.${i}.jackpot`,
				message: `"${coin.jackpot}" is not a jackpot tier of any respin mode.`,
			});
		}
	});

	// A buy tier routed to another mode than the mirrored one is not the legacy validator's to check.
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
