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
 * Classic Hold and Win. Each brings what its pots start (bonus-games Phase 8b): 3 Pots and Collector
 * add their specials to a Hold and Win game that lacks them.
 */
export const COIN_OVERLAY_PRESET_STYLE: Record<PotsOverlayPresetId, CoinOverlayStyle> = {
	threePots: 'pots',
	potsToFreeSpins: 'pots',
	coinsOnly: 'classic',
	collector: 'collector',
};

export const COIN_OVERLAY_ADD_ON_STYLES: {
	style: CoinOverlayStyle;
	label: string;
	none?: string;
}[] = [
	{
		style: 'classic',
		label: 'Classic — value coins drop; enough start a Hold and Win',
		none: 'No Classic preset fits this game. A Hold and Win game is the Classic style already: its coins land on its reels, so pick 3 Pots or Collector to add pots.',
	},
	{ style: 'pots', label: '3 Pots — tokens fill pots; a full pot starts its bonus' },
	{
		style: 'collector',
		label: 'Collector — a full pot starts a Hold and Win with its collector',
	},
];
