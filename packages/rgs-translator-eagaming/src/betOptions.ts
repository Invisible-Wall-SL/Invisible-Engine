/**
 * The SERVER's declaration of what a bet costs, and the HOST PAGE's declaration of which bets are
 * offerable — the two halves of a bet ladder the client used to invent.
 *
 * Until now `requestAuthenticate` returned a hardcoded $0.10–$100 ladder, because the mock never
 * supplied one. Against a real operator that is wrong twice over: the limits must be ones the RGS
 * will actually accept, and the buy/ante prices must be the math's, not the client's.
 *
 * Two sources, because the partner splits them that way:
 *
 *   - `betOptions` rides the engine's boot `config` event. It is the **credit cost of each bet
 *     option at multiplier 1**, indexed by the FIRST bet-context argument: `[10, 1000]` means
 *     `[0, M]` costs `10 × M` (base) and `[1, M]` costs `1000 × M` (buy bonus). `betOptionsName`
 *     (`["0:base","1:buybonus"]`) names them.
 *   - `betMultipliers` rides the operator's embed page (`window.params.GameSettings.config`),
 *     alongside `initialBetMultiplierIndex`. It is the list of M values the player may pick.
 *
 * Total stake = `betOptions[x] × M`. That one identity is what makes the ladder, the buy price and
 * the wire context all agree, and it is the thing to re-confirm with the partner before shipping —
 * a per-line-vs-total misread yields a game that plays correctly with every number wrong.
 *
 * ALL OF IT IS OPTIONAL. A server that declares no `betOptions` (both our mocks) leaves every
 * consumer on the pre-existing path, so this is inert until a real server switches it on.
 */

import { readHostGameSettings } from 'delivery-profile';

import { PLAY4FUN_AMOUNT_MULTIPLIER, play4FunToEngine } from './gameMappings';

export interface ServerBetOptions {
	/** Credit cost of each bet option at multiplier 1, indexed by the first bet-context argument. */
	betOptions: number[];
	/** `"<index>:<name>"` labels when the server sends them, e.g. `["0:base","1:buybonus"]`. */
	betOptionsName?: string[];
	/** The base cost. Equal to `betOptions[0]` in every sample seen; kept for the cross-check. */
	gameCost?: number;
}

export interface HostBetSettings {
	/** The M values the player may pick, from the embed page. */
	betMultipliers: number[];
	/** Index into `betMultipliers` the game should open on. */
	initialBetMultiplierIndex?: number;
}

const positiveNumbers = (value: unknown): number[] | null => {
	if (!Array.isArray(value) || value.length === 0) return null;
	const out: number[] = [];
	for (const entry of value) {
		if (typeof entry !== 'number' || !Number.isFinite(entry) || entry <= 0) return null;
		out.push(entry);
	}
	return out;
};

/**
 * Read the bet-option table out of a boot `config` context. Returns null unless the server declared
 * a usable one — the gate that keeps every legacy server (and both our mocks) on the old path.
 */
export const readServerBetOptions = (config: unknown): ServerBetOptions | null => {
	if (typeof config !== 'object' || config === null) return null;
	const source = config as Record<string, unknown>;
	const betOptions = positiveNumbers(source.betOptions);
	if (!betOptions) return null;

	const names = Array.isArray(source.betOptionsName)
		? source.betOptionsName.filter((n): n is string => typeof n === 'string')
		: undefined;

	return {
		betOptions,
		...(names && names.length ? { betOptionsName: names } : {}),
		...(typeof source.gameCost === 'number' && source.gameCost > 0
			? { gameCost: source.gameCost }
			: {}),
	};
};

/**
 * Read the multiplier list the operator's embed page published.
 *
 * The page itself is read by `delivery-profile`'s `readHostGameSettings()` — ONE reader for the
 * three consumers of that object (this ladder, the session token, and the jurisdiction flags), so a
 * second copy cannot drift from it. This function only decides what a bet ladder means.
 */
export const readHostBetSettings = (): HostBetSettings | null => {
	const config = readHostGameSettings()?.config;
	if (!config) return null;

	const betMultipliers = positiveNumbers(config.betMultipliers);
	if (!betMultipliers) return null;

	const index = config.initialBetMultiplierIndex;
	return {
		betMultipliers,
		...(typeof index === 'number' && index >= 0 && index < betMultipliers.length
			? { initialBetMultiplierIndex: index }
			: {}),
	};
};

export interface BetLadder {
	/** Selectable bet amounts in the engine's API units (millionths). */
	betLevels: number[];
	/** The level the game opens on, in the same units. */
	defaultBetLevel: number;
}

/**
 * Build the engine's bet ladder from `betOptions[0] × M`.
 *
 * The BASE option is what a ladder entry means — a buy is the same M priced through a different
 * option, not a separate rung — so the levels are the base costs and the buy price falls out of
 * {@link betOptionCostRatios}.
 */
export const buildBetLadder = (
	options: ServerBetOptions,
	host: HostBetSettings | null,
): BetLadder | null => {
	if (!host) return null;
	const baseCost = options.betOptions[0];
	const betLevels = host.betMultipliers.map((m) => play4FunToEngine(baseCost * m));
	const index = host.initialBetMultiplierIndex ?? 0;
	return { betLevels, defaultBetLevel: betLevels[index] ?? betLevels[0] };
};

/** Strip a `"0:buy bonus"` label down to a comparable key: the part after the colon, alphanumeric
 *  and lowercased, so `buybonus` matches the engine's `BUYBONUS` / `BUY_BONUS`. */
const normaliseName = (name: string): string =>
	name
		.slice(name.indexOf(':') + 1)
		.replace(/[^a-z0-9]/gi, '')
		.toLowerCase();

const normaliseMode = (mode: string): string => mode.replace(/[^a-z0-9]/gi, '').toLowerCase();

/**
 * Which bet-context argument selects `mode`, or **null when the table cannot express it**.
 *
 * Matched by NAME, because index order is not a contract — the partner's three-option game puts
 * ante at 1 and buy at 2, while a base+buy game puts buy at 1.
 *
 * Null is the important return. A game can easily have more paid modes than the math declares
 * options: Book of Borut offers three buy cards (25× / 50× / 100×) against a table of
 * `["0:base","1:buybonus"]`. Guessing — "a buy is the dearest option" — would charge all three the
 * same 100×, which looks like a working game and silently overcharges two of its cards. So an
 * unresolvable mode refuses, the caller keeps the legacy encoding, and the cross-check says so.
 */
export const betOptionIndexFor = (mode: string, options: ServerBetOptions): number | null => {
	const key = normaliseMode(mode || 'base');
	if (!key || key === 'base' || key === 'default') return 0;

	// `OPTION<n>` is the key {@link serverBetOptionEntries} mints for an UNNAMED option, so a menu
	// built from the server's own table round-trips even when the server named nothing.
	const positional = /^option(\d+)$/.exec(key);
	if (positional) {
		const index = Number(positional[1]);
		return index < options.betOptions.length ? index : null;
	}

	const names = options.betOptionsName;
	if (!names) return null;
	for (let i = 0; i < names.length; i++) {
		if (normaliseName(names[i]) === key) return i;
	}
	return null;
};

export interface ServerBetOptionEntry {
	/** The wire `mode` key for this option — the option's name uppercased, or `OPTION<index>` when
	 *  the server named nothing. Chosen so {@link betOptionIndexFor} can always resolve it back. */
	key: string;
	index: number;
	/** Cost as a multiple of the base option — what a buy card displays as its price. */
	costMultiplier: number;
}

/**
 * The server's options as menu entries — the list a game should offer, and nothing else.
 *
 * This is what makes the bet menu SERVER-AUTHORITATIVE: a game whose own config authors three buy
 * cards against a table with one buy option must show one, because the other two are prices the
 * wallet will refuse. Built here rather than in the app because only this package knows the table.
 */
export const serverBetOptionEntries = (options: ServerBetOptions): ServerBetOptionEntry[] => {
	const baseCost = options.betOptions[0];
	return options.betOptions.map((cost, index) => {
		const name = options.betOptionsName?.[index];
		const named = name ? normaliseName(name) : '';
		// Option 0 is ALWAYS keyed `BASE` when the server names nothing: `activeBetModeKey = 'BASE'`
		// is hardcoded in the engine's machines, so keying the base option anything else leaves every
		// bet-mode lookup empty — which presents as a HUD with no balance, no win and no bet amount.
		const fallback = index === 0 ? 'BASE' : `OPTION${index}`;
		return {
			key: named ? named.toUpperCase() : fallback,
			index,
			costMultiplier: cost / baseCost,
		};
	});
};

/** Each option's cost as a multiple of the base option — the number the buy card DISPLAYS as its
 *  price. Lets a mismatch against the engine's authored `costMultiplier` be reported. */
export const betOptionCostRatios = (options: ServerBetOptions): Record<string, number> => {
	const baseCost = options.betOptions[0];
	const out: Record<string, number> = {};
	options.betOptions.forEach((cost, index) => {
		const name = options.betOptionsName?.[index];
		const key = name ? normaliseName(name) : String(index);
		out[key] = cost / baseCost;
	});
	return out;
};

/**
 * The multiplier M to send for a user-display bet amount.
 *
 * `amount` is the BASE bet (the engine applies no buy premium before sending — the option index
 * carries that), so M is always measured against the base option's cost. Clamped to 1 because the
 * server has no meaning for a zero-multiplier bet.
 */
export const multiplierForAmount = (displayAmount: number, options: ServerBetOptions): number => {
	const credits = displayAmount * PLAY4FUN_AMOUNT_MULTIPLIER;
	return Math.max(1, Math.round(credits / options.betOptions[0]));
};
