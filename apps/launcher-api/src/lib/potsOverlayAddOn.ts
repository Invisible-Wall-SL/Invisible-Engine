import type { AddOnRenames, CoinOverlayStyle, PotsOverlayPresetId } from 'game-config';

/**
 * What the Game Maker's pots overlay add-on reports (`$lib/server/projectAddOn.ts`), shared with the
 * page that shows it.
 *
 * - `added`: written now (`added` names what);
 * - `present`: the doc already had every part;
 * - `conflict`: someone saved the doc between this read and its write — run the action again;
 * - `skipped`: nothing could be written (`note` says why);
 * - `failed`: the write threw (`note` carries the error).
 */
export type AddOnPartStatus = 'added' | 'present' | 'conflict' | 'skipped' | 'failed';

export type AddOnPart = { status: AddOnPartStatus; added: string[]; note?: string };

export type AddOnSeedReport = {
	symbols: AddOnPart;
	layout: AddOnPart;
	winText: AddOnPart;
	/** Present only when the graft was asked for. */
	flow?: AddOnPart;
};

export type AddOnOutcome =
	| { ok: true; configAdded: boolean; renamed: AddOnRenames; seeds: AddOnSeedReport }
	| { ok: false; status: 400 | 403 | 409 | 500; error: string };

/**
 * The coin overlay style each add-on preset builds ("＋ Coin overlay…", `docs/design/bonus-games.md`
 * §2.4): its pots fill from dropped tokens, or (Coins only) value coins drop and enough start a
 * Classic Hold and Win. A Collector overlay needs a collector landing on the base reels, and the
 * add-on never edits a game's strips, so no preset builds one.
 */
export const COIN_OVERLAY_PRESET_STYLE: Record<PotsOverlayPresetId, CoinOverlayStyle> = {
	threePots: 'pots',
	potsToFreeSpins: 'pots',
	coinsOnly: 'classic',
};

export const COIN_OVERLAY_ADD_ON_STYLES: {
	style: CoinOverlayStyle;
	label: string;
	none?: string;
}[] = [
	{ style: 'classic', label: 'Classic — value coins drop; enough start a Hold and Win' },
	{ style: 'pots', label: '3 Pots — tokens fill pots; a full pot starts its bonus' },
	{
		style: 'collector',
		label: 'Collector — a collector beside coins starts the bonus',
		none: "A collector lands on the base reels, and the add-on never edits this game's strips. Start from the Hold and Win template's Collector preset instead.",
	},
];
