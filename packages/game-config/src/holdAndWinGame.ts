/**
 * The HOLD AND WIN GAME — the respin half of the legacy `holdAndWin` block, played by a `respinBoard`
 * bonus mode (`docs/design/bonus-games.md` §2.1). It says how the respins play: the counter, what
 * sticks, how the board ends, the coins and specials that land in a respin, the jackpots, the wheel
 * and the expansion. It does NOT say what starts it or what lands in the base game: that is the coin
 * overlay's (`./coinOverlay`), and each of the overlay's triggers names the mode it starts, so one
 * project can carry several of these games.
 *
 * {@link splitHoldAndWin} and {@link joinHoldAndWin} convert between the legacy block and the split
 * form without loss — the migration (`./bonusGames`) and the compat mirror are built on them.
 */

import {
	normalizeHoldAndWin,
	type AddRespinsSpecial,
	type CollectorSpecial,
	type HoldAndWin,
	type HoldAndWinMeter,
	type HoldAndWinSpecial,
	type HoldAndWinTrigger,
	type MultiplierSpecial,
	type MysterySpecial,
	type PayerSpecial,
	type UpgradeSpecial,
} from './holdAndWin';

/** The flags a special carries in the legacy block that are about the BASE game, not the respins. */
type BaseGameFlag = 'landsInBaseGame' | 'instantCollectInBaseGame';
type RespinOnly<T> = Omit<T, BaseGameFlag>;

/** The respin game's specials: the legacy tables without the base-game flags. */
export type HoldAndWinGameSpecials = {
	collector?: RespinOnly<CollectorSpecial>;
	multiplier?: RespinOnly<MultiplierSpecial>;
	payer?: RespinOnly<PayerSpecial>;
	mystery?: MysterySpecial;
	addRespins?: RespinOnly<AddRespinsSpecial>;
	upgrade?: RespinOnly<UpgradeSpecial>;
};

/** A respin mode's rules. Its strips are `paddingReels[<the mode's game type>]`. */
export type HoldAndWinGame = Omit<HoldAndWin, 'trigger' | 'meters' | 'specials'> & {
	specials: HoldAndWinGameSpecials;
	/** The symbol an empty cell of THIS board draws. Absent ⇒ the first `blank`-tagged symbol its
	 *  strips deal (`respinModeBlank`). */
	blank?: string;
};

/** What a special does in the base game, by kind: it lands there, and (a collector or a multiplier)
 *  it collects at once beside a coin. Sparse: only a `true` is stored. */
export type BaseGameSpecialFlags = { landsInBaseGame?: true; instantCollectInBaseGame?: true };
export type BaseGameSpecials = Partial<Record<HoldAndWinSpecial, BaseGameSpecialFlags>>;

/** The trigger half of a legacy block: what starts the feature and what lands in the base game. */
export type HoldAndWinTriggerHalf = {
	trigger: HoldAndWinTrigger;
	meters?: HoldAndWinMeter[];
	baseGame?: BaseGameSpecials;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (v: unknown): string | undefined =>
	typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** The base-game flags of one legacy special, or `undefined` when it sets none. */
function flagsOf(
	special: Partial<Record<BaseGameFlag, boolean>>,
): BaseGameSpecialFlags | undefined {
	const out: BaseGameSpecialFlags = {};
	if (special.landsInBaseGame) out.landsInBaseGame = true;
	if (special.instantCollectInBaseGame) out.instantCollectInBaseGame = true;
	return Object.keys(out).length ? out : undefined;
}

/** A legacy special without its base-game flags. */
function respinOnly<T extends object>(special: T): RespinOnly<T> {
	const {
		landsInBaseGame: _lands,
		instantCollectInBaseGame: _instant,
		...rest
	} = special as T & Partial<Record<BaseGameFlag, boolean>>;
	return rest as RespinOnly<T>;
}

/** Split a legacy block into the respin game and its trigger half. Lossless: {@link joinHoldAndWin}
 *  puts it back together. */
export function splitHoldAndWin(block: HoldAndWin): {
	game: HoldAndWinGame;
	half: HoldAndWinTriggerHalf;
} {
	const { trigger, meters, specials, ...rules } = structuredClone(block);
	const gameSpecials: HoldAndWinGameSpecials = {};
	const baseGame: BaseGameSpecials = {};
	for (const kind of Object.keys(specials) as HoldAndWinSpecial[]) {
		const special = specials[kind];
		if (!special) continue;
		(gameSpecials as Record<string, object>)[kind] = respinOnly(special);
		const flags = flagsOf(special as Partial<Record<BaseGameFlag, boolean>>);
		if (flags) baseGame[kind] = flags;
	}
	return {
		game: { ...rules, specials: gameSpecials },
		half: {
			trigger,
			...(meters?.length ? { meters } : {}),
			...(Object.keys(baseGame).length ? { baseGame } : {}),
		},
	};
}

/** The legacy block a respin game and a trigger half make — normalized, so it is the block the
 *  legacy readers have always seen. A flag defaults to off, as it does in the legacy block. */
export function joinHoldAndWin(game: HoldAndWinGame, half: HoldAndWinTriggerHalf): HoldAndWin {
	const { blank: _blank, specials, ...rules } = structuredClone(game);
	const joined: Record<string, object> = {};
	for (const kind of Object.keys(specials) as HoldAndWinSpecial[]) {
		const special = specials[kind];
		if (!special) continue;
		const flags = half.baseGame?.[kind] ?? {};
		joined[kind] = {
			...special,
			landsInBaseGame: flags.landsInBaseGame === true,
			instantCollectInBaseGame: flags.instantCollectInBaseGame === true,
		};
	}
	// The legacy normalizer drops a flag a kind does not carry (a payer has no instant collect).
	return normalizeHoldAndWin({
		...rules,
		trigger: structuredClone(half.trigger),
		specials: joined,
		...(half.meters?.length ? { meters: structuredClone(half.meters) } : {}),
	})!;
}

/** Canonicalize a respin mode's rules, or `undefined` when there are none. Any object is a game, as
 *  any object is a legacy block: the validator names what it is missing. */
export function normalizeHoldAndWinGame(raw: unknown): HoldAndWinGame | undefined {
	if (!isObject(raw)) return undefined;
	const { game } = splitHoldAndWin(normalizeHoldAndWin({ ...raw, trigger: {}, meters: [] })!);
	const blank = text(raw.blank);
	return blank ? { ...game, blank } : game;
}
