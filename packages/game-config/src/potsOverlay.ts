/**
 * The POTS OVERLAY add-on (`docs/design/pots-overlay.md` §3.1): tokens dropped ON TOP of any kind's
 * board fly into pots, and a full pot starts the bonus it names — a Hold and Win, the host's own free
 * spins, or any other mode the project has. The block's PRESENCE is what makes a project an overlay
 * host; a config without it plays, authors and publishes exactly as before.
 *
 * Like the `holdAndWin` block, this is the frontend's contract with the math: the weights drive the
 * mock and the tool's readouts, and the RGS stays the authority on every outcome (pot levels are
 * per-player SERVER state — the client never computes one).
 *
 * Pots and value coins are each optional, but not both: an overlay may be pots only, value coins
 * only (a classic Hold and Win started by dropped coins), or both (3 Pots).
 *
 * A token is a dictionary symbol drawn OVER a cell's symbol, never dealt by a strip. That keeps the
 * strips the in-play gate: the symbol underneath still pays and triggers, and a token never does.
 *
 * Normalization is STRUCTURAL (drops what cannot be read, keeps what is merely wrong); every cross
 * reference — a pot a drop names, a bonus mode, a token on a strip — is the validator's to report.
 */

import {
	HOLD_AND_WIN_SPECIALS,
	holdAndWinIsOverlayBonus,
	type HoldAndWinSpecial,
} from './holdAndWin';
import { symbolsInPlay } from './inPlay';
import { legacyHoldAndWin, legacyPotsOverlay } from './bonusGames';
import {
	BASE_GAME_MODE,
	FREE_SPINS_MODE,
	GAME_MODE_ID,
	HOLD_AND_WIN_MODE,
	gameModeById,
	resolveGameModes,
} from './modes';
import type { GameConfigDoc } from './types';
import type { GameConfigIssue } from './validate';

/** What a full pot starts. */
export type PotBonus = {
	/** A mode `resolveGameModes` lists, never the base game: `holdAndWin`, `freeSpins`, or the
	 *  project's own. */
	mode: string;
	/** `holdAndWin` only: the special the feature starts with active (a 3 Pots pot). */
	activates?: HoldAndWinSpecial;
	/** A `reels` mode only (free spins): the mock's spin count — the RGS decides for real. */
	spins?: number;
};

/** A persistent per-player pot, filled by its token. */
export type OverlayPot = {
	/** Also its flight anchor `meter:<id>` and value sources `meter.<id>.*`, so it is unique across
	 *  every meter, the Hold and Win block's included. */
	id: string;
	/** The symbol drawn as this pot's token (tagged `meterSpecial`); never on a strip. */
	token: string;
	maxLevel: number;
	/** Levels at which the pot art steps up a size, ascending. */
	sizeStages: number[];
	bonus: PotBonus;
	label?: string;
};

/** One weighted row of the drop table: a token for a pot, or a value coin whose value is drawn
 *  from `holdAndWin.coins`. */
export type OverlayDropEntry = { pot: string; weight: number } | { coin: true; weight: number };

export type OverlayDrops = {
	/** The share of spins in a dropping mode that drop anything, in (0, 1]. */
	chance: number;
	maxPerSpin: number;
	table: OverlayDropEntry[];
	/** 0-based reels a token may land on; absent ⇒ every reel. */
	reels?: number[];
	/** Modes whose spins drop; absent ⇒ the base game only. Read through {@link overlayDropModes}. */
	modes?: string[];
};

/** When a board's tokens appear: all together once the last reel has stopped (the default), or each
 *  reel's as that reel stops. A board with no reel roll (a swap in place) always shows them together. */
export type OverlayTiming = 'afterStop' | 'perReel';

export type PotsOverlay = {
	/** 0 to {@link MAX_OVERLAY_POTS}. Empty for a coins-only overlay: value coins drop and N+ start
	 *  Hold and Win, with no pot. */
	pots: OverlayPot[];
	drops: OverlayDrops;
	/** Absent ⇒ `afterStop`, which is not stored. Presentation only: the server never sees it. */
	timing?: OverlayTiming;
};

/** The most pots one overlay holds. */
export const MAX_OVERLAY_POTS = 5;

/** The ids pots take in order, each with its own colour in the coded pots. */
export const OVERLAY_POT_IDS = ['red', 'blue', 'green', 'gold', 'purple'] as const;

export const isCoinDrop = (
	entry: OverlayDropEntry,
): entry is Extract<OverlayDropEntry, { coin: true }> => 'coin' in entry;

/** The modes whose spins drop — the base game unless the block says otherwise. */
export const overlayDropModes = (drops: Pick<OverlayDrops, 'modes'>): string[] =>
	drops.modes ?? [BASE_GAME_MODE];

// ─── normalize ────────────────────────────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) ? v : undefined;

const int = (v: unknown, min = 0): number | undefined => {
	const n = num(v);
	return n !== undefined && Number.isInteger(n) && n >= min ? n : undefined;
};

const text = (v: unknown): string | undefined =>
	typeof v === 'string' && v.trim() ? v.trim() : undefined;

const list = <T>(raw: unknown, read: (entry: unknown) => T | undefined): T[] =>
	Array.isArray(raw) ? raw.map(read).filter((e): e is T => e !== undefined) : [];

const unique = <T>(values: T[]): T[] => [...new Set(values)];

/** What a half-typed block's unread drop numbers become: values the validator accepts, so it names
 *  only what is actually missing (an empty drop table). */
const DEFAULT_CHANCE = 0.1;
const DEFAULT_MAX_PER_SPIN = 1;

const potBonus = (raw: unknown): PotBonus | undefined => {
	if (!isObject(raw)) return undefined;
	const mode = text(raw.mode);
	if (!mode) return undefined;
	const out: PotBonus = { mode };
	const activates = HOLD_AND_WIN_SPECIALS.find((s) => s === raw.activates);
	if (activates) out.activates = activates;
	const spins = num(raw.spins);
	if (spins !== undefined) out.spins = spins;
	return out;
};

export const normalizeOverlayPot = (raw: unknown): OverlayPot | undefined => {
	if (!isObject(raw)) return undefined;
	const id = text(raw.id);
	const token = text(raw.token);
	const maxLevel = num(raw.maxLevel);
	const bonus = potBonus(raw.bonus);
	if (!id || !token || maxLevel === undefined || !bonus) return undefined;
	const sizeStages = unique(list(raw.sizeStages, (s) => int(s, 1))).sort((a, b) => a - b);
	const out: OverlayPot = { id, token, maxLevel, sizeStages, bonus };
	const label = text(raw.label);
	if (label) out.label = label;
	return out;
};

/** A weight: absent ⇒ 1, so a hand-typed table without weights is an even draw. */
const dropEntry = (raw: unknown): OverlayDropEntry | undefined => {
	if (!isObject(raw)) return undefined;
	const weight = raw.weight === undefined ? 1 : num(raw.weight);
	if (weight === undefined) return undefined;
	if (raw.coin === true) return { coin: true, weight };
	const id = text(raw.pot);
	return id ? { pot: id, weight } : undefined;
};

export const normalizeOverlayDrops = (raw: unknown): OverlayDrops => {
	const r = isObject(raw) ? raw : {};
	const out: OverlayDrops = {
		chance: num(r.chance) ?? DEFAULT_CHANCE,
		maxPerSpin: num(r.maxPerSpin) ?? DEFAULT_MAX_PER_SPIN,
		table: list(r.table, dropEntry),
	};
	if (Array.isArray(r.reels)) {
		out.reels = unique(list(r.reels, (n) => int(n))).sort((a, b) => a - b);
	}
	const modes = unique(list(r.modes, text));
	if (Array.isArray(r.modes) && JSON.stringify(modes) !== JSON.stringify(overlayDropModes({}))) {
		out.modes = modes;
	}
	return out;
};

/**
 * Canonicalize a `potsOverlay` block, or `undefined` when there is none. SPARSE: a block with no pot
 * and no drop is no block, so a config that never had one normalizes byte-identically. Only the
 * defaults — the dropping modes (the base game alone) and the timing (after the stop) — are not
 * stored; an authored `reels` or `modes` list is kept as written — every reel, or none, which the
 * validator names.
 */
export function normalizePotsOverlay(raw: unknown): PotsOverlay | undefined {
	if (!isObject(raw)) return undefined;
	const pots = list(raw.pots, normalizeOverlayPot);
	const dropped = normalizeOverlayDrops(raw.drops);
	if (!pots.length && !dropped.table.length) return undefined;
	return { pots, drops: dropped, ...(raw.timing === 'perReel' ? { timing: 'perReel' } : {}) };
}

// ─── meters ───────────────────────────────────────────────────────────────────────────────────

/** Where a meter's level comes from: a reel symbol landing (a Hold and Win meter) or a token dropped
 *  over a cell (an overlay pot). */
export type MeterSource = 'symbol' | 'overlay';

/** One meter, whichever block declared it. */
export type ResolvedMeter = {
	id: string;
	source: MeterSource;
	/** The symbol that fills it — the landing symbol, or the token. */
	symbol: string;
	maxLevel: number;
	sizeStages: number[];
	bonus: PotBonus;
	label?: string;
};

/**
 * Every meter the project has: the Hold and Win block's symbol-filled meters, then the overlay's
 * pots. Read meters through here, never through either block, so a pot is a pot wherever it was
 * declared.
 */
export function resolveMeters(
	doc: Pick<GameConfigDoc, 'holdAndWin' | 'potsOverlay' | 'coinOverlay' | 'modes'> | undefined,
): ResolvedMeter[] {
	const fromSymbols = ((doc && legacyHoldAndWin(doc))?.meters ?? []).map((m): ResolvedMeter => ({
		id: m.id,
		source: 'symbol',
		symbol: m.symbol,
		maxLevel: m.maxLevel,
		sizeStages: [...m.sizeStages],
		bonus: { mode: HOLD_AND_WIN_MODE, activates: m.activates },
	}));
	const fromOverlay = ((doc && legacyPotsOverlay(doc))?.pots ?? []).map((p): ResolvedMeter => ({
		id: p.id,
		source: 'overlay',
		symbol: p.token,
		maxLevel: p.maxLevel,
		sizeStages: [...p.sizeStages],
		bonus: { ...p.bonus },
		...(p.label ? { label: p.label } : {}),
	}));
	return [...fromSymbols, ...fromOverlay];
}

// ─── validate ─────────────────────────────────────────────────────────────────────────────────

const whole = (n: number, min: number): boolean => Number.isInteger(n) && n >= min;

/**
 * Internal consistency of a normalized doc's `potsOverlay` block. Every `error` is a config the mock
 * could not deal a drop from or the board could not show; every `warning` is one that renders but
 * has a knob that does nothing.
 */
export function validatePotsOverlay(doc: GameConfigDoc): GameConfigIssue[] {
	const overlay = doc.potsOverlay;
	if (!overlay) return [];
	const issues: GameConfigIssue[] = [];
	const error = (path: string, message: string) =>
		issues.push({ severity: 'error', path: `potsOverlay.${path}`, message });
	const warning = (path: string, message: string) =>
		issues.push({ severity: 'warning', path: `potsOverlay.${path}`, message });

	const block = doc.holdAndWin;
	const modeIds = new Set(resolveGameModes(doc).map((m) => m.id));
	const inPlay = new Set(symbolsInPlay(doc));
	const meterIds = new Set(block?.meters?.map((m) => m.id));
	// Dropped value coins count toward a Hold and Win only when it is the overlay's bonus; a Hold and
	// Win game's own count trigger counts the coins landing on its reels.
	const coinsCount = Boolean(block) && holdAndWinIsOverlayBonus(doc);

	// Coins alone on a Hold and Win game's base-game block: one error for the overlay, not a warning
	// per coin row as well.
	const coinsAlone = !overlay.pots.length && Boolean(block) && !coinsCount;
	if (overlay.pots.length > MAX_OVERLAY_POTS) {
		error(
			'pots',
			`An overlay holds at most ${MAX_OVERLAY_POTS} pots (this one has ${overlay.pots.length}).`,
		);
	} else if (!overlay.pots.length && !overlay.drops.table.some(isCoinDrop)) {
		error(
			'pots',
			'The overlay has no pots and drops no value coins — it needs at least one of them.',
		);
	} else if (coinsAlone) {
		error(
			'pots',
			"This game's own Hold and Win is its base game, started by coins landing on its reels, so an overlay of value coins alone starts nothing. It needs at least one pot.",
		);
	}

	const potIds = new Set<string>();
	const tokenPot = new Map<string, string>();
	overlay.pots.forEach((p, i) => {
		const at = `pots.${i}`;
		if (!GAME_MODE_ID.test(p.id)) {
			error(
				`${at}.id`,
				`"${p.id}" is not a usable pot id: start with a letter, then only letters, digits, _ and -.`,
			);
		}
		if (potIds.has(p.id)) error(`${at}.id`, `Pot "${p.id}" is listed twice.`);
		else if (meterIds.has(p.id)) {
			error(
				`${at}.id`,
				`"${p.id}" is also a Hold and Win meter — one id names one pot (its meter:${p.id} anchor and meter.${p.id}.* values).`,
			);
		}
		potIds.add(p.id);

		const symbol = doc.symbols[p.token];
		if (!symbol) error(`${at}.token`, `${p.token} is not in the symbol dictionary.`);
		else if (!symbol.special_properties?.includes('meterSpecial')) {
			warning(`${at}.token`, `${p.token} is a pot token but is not tagged "meterSpecial".`);
		}
		if (inPlay.has(p.token)) {
			error(
				`${at}.token`,
				`${p.token} is on a reel strip, so it would land as a symbol instead of dropping as a token.`,
			);
		}
		const sharedWith = tokenPot.get(p.token);
		if (sharedWith !== undefined) {
			warning(
				`${at}.token`,
				`The ${sharedWith} and ${p.id} pots share the token ${p.token}, so a dropped token does not show which pot it fills.`,
			);
		} else tokenPot.set(p.token, p.id);

		if (!whole(p.maxLevel, 1)) {
			error(
				`${at}.maxLevel`,
				`The maximum level must be a whole number from 1 (it is ${p.maxLevel}).`,
			);
		} else if (p.sizeStages.some((s) => s >= p.maxLevel)) {
			error(`${at}.sizeStages`, `A size stage is at or past the maximum level (${p.maxLevel}).`);
		}

		const { mode, activates, spins } = p.bonus;
		if (mode === BASE_GAME_MODE) {
			error(`${at}.bonus.mode`, 'A full pot cannot start the base game — it is what is playing.');
		} else if (mode === HOLD_AND_WIN_MODE && !block) {
			error(
				`${at}.bonus.mode`,
				'A Hold and Win bonus needs a holdAndWin block — its respin rules, coins and jackpots.',
			);
		} else if (!modeIds.has(mode)) {
			error(`${at}.bonus.mode`, `"${mode}" is not a mode this project has.`);
		} else if (mode === FREE_SPINS_MODE && doc.freeSpins?.enabled === false) {
			error(
				`${at}.bonus.mode`,
				'A full pot cannot start free spins while free spins are off — switch them on in Free spins, or route the pot to another bonus.',
			);
		}
		if (activates && mode !== HOLD_AND_WIN_MODE) {
			error(
				`${at}.bonus.activates`,
				`Only a Hold and Win bonus starts with a special active; this pot starts "${mode}".`,
			);
		} else if (activates && block && !block.specials[activates]) {
			error(
				`${at}.bonus.activates`,
				`A full ${p.id} pot activates the ${activates}, which is not configured.`,
			);
		}
		if (spins !== undefined) {
			const target = gameModeById(doc, mode);
			if (target && target.board !== 'reels') {
				error(
					`${at}.bonus.spins`,
					`A spin count is for a bonus on the reels, such as free spins; "${mode}" plays on its own board.`,
				);
			}
			if (!whole(spins, 1)) {
				error(
					`${at}.bonus.spins`,
					`The spin count must be a whole number from 1 (it is ${spins}).`,
				);
			}
		}
	});

	const d = overlay.drops;
	if (!(d.chance > 0 && d.chance <= 1)) {
		error(
			'drops.chance',
			`The drop chance is a share of spins, above 0 and at most 1 (it is ${d.chance}).`,
		);
	}
	if (!whole(d.maxPerSpin, 1)) {
		error(
			'drops.maxPerSpin',
			`The most drops per spin must be a whole number from 1 (it is ${d.maxPerSpin}).`,
		);
	}
	if (!d.table.length) error('drops.table', 'The drop table is empty, so nothing ever drops.');
	d.table.forEach((entry, i) => {
		const at = `drops.table.${i}`;
		if (!(entry.weight > 0)) {
			error(`${at}.weight`, `A drop's weight must be above 0 (it is ${entry.weight}).`);
		}
		if (!isCoinDrop(entry)) {
			if (!potIds.has(entry.pot)) error(`${at}.pot`, `"${entry.pot}" is not one of the pots.`);
		} else if (!block) {
			error(
				at,
				'A value coin needs a holdAndWin block — its coin table sets the value and its count trigger starts the feature.',
			);
		} else if (!block.coins.length) {
			error(at, 'A value coin draws its value from the Hold and Win coin table, which is empty.');
		} else if (!coinsCount) {
			if (!coinsAlone) {
				warning(
					at,
					"This game's own Hold and Win starts from coins landing on its reels; dropped value coins count only toward a Hold and Win that is the overlay's bonus, so they never start anything here.",
				);
			}
		} else if (!block.trigger.count) {
			warning(
				at,
				'Value coins start Hold and Win only through its count trigger, which is not set, so they never start anything.',
			);
		}
	});
	const coinTrigger = block?.trigger.count?.min;
	if (
		coinsCount &&
		coinTrigger !== undefined &&
		d.table.some(isCoinDrop) &&
		whole(d.maxPerSpin, 1) &&
		coinTrigger > d.maxPerSpin
	) {
		warning(
			'drops.maxPerSpin',
			`At most ${d.maxPerSpin} drops land on a spin, but the Hold and Win trigger needs ${coinTrigger} coins, so dropped coins can never start it.`,
		);
	}
	if (d.reels && !d.reels.length) error('drops.reels', 'No reel can receive a token.');
	d.reels?.forEach((r) => {
		if (r >= doc.numReels) {
			error(
				'drops.reels',
				`Tokens land on reel ${r + 1}, but the grid is ${doc.numReels} reels wide.`,
			);
		}
	});
	if (d.modes && !d.modes.length) error('drops.modes', 'No mode drops, so nothing ever drops.');
	d.modes?.forEach((m) => {
		const mode = gameModeById(doc, m);
		if (!mode) error('drops.modes', `"${m}" is not a mode this project has.`);
		else if (mode.board !== 'reels') {
			error(
				'drops.modes',
				`"${m}" does not play on the reels, so it has no cell for a token to drop on.`,
			);
		}
	});

	const filled = new Set(d.table.flatMap((e) => (isCoinDrop(e) ? [] : [e.pot])));
	const dropping = d.modes ?? [BASE_GAME_MODE];
	overlay.pots.forEach((p, i) => {
		if (!filled.has(p.id))
			warning(`pots.${i}`, `No drop fills the ${p.id} pot, so it never fills.`);
		// A pot whose bonus is a mode it also fills in can refill inside its own bonus and start it
		// again, round after round, with nothing to end the chain.
		else if (
			p.bonus.mode !== BASE_GAME_MODE &&
			dropping.includes(p.bonus.mode) &&
			gameModeById(doc, p.bonus.mode)?.board === 'reels'
		) {
			warning(
				`pots.${i}.bonus.mode`,
				`The ${p.id} pot starts ${p.bonus.mode}, where tokens also drop: it can refill during its own bonus and start it again without end.`,
			);
		}
	});

	return issues;
}
