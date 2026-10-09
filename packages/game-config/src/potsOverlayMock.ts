/**
 * What the mock RGS deals a pots overlay from (`withPotsOverlay` in `scripts/mock-pots-overlay.mjs`),
 * beside the host kind's own mock. One derivation, read by the launcher's mock contract and by the
 * protocol gate, so the gate proves the rounds the test server actually deals.
 */

import { legacyPotsOverlay } from './bonusGames';
import { holdAndWinIsOverlayBonus, respinIsOverlayBonus } from './holdAndWin';
import { holdAndWinMockInputs, type HoldAndWinMockInputs } from './holdAndWinMock';
import { BASE_GAME_MODE, builtinGameModes, gameModeById, gameTypeForMode } from './modes';
import { overlayDropModes, type OverlayDrops, type OverlayPot } from './potsOverlay';
import type { GameConfigDoc } from './types';

export type PotsOverlayMockInputs = {
	pots: OverlayPot[];
	/** The drop rules, with the dropping modes resolved (the base game when unauthored). */
	drops: OverlayDrops & { modes: string[] };
	/** The Hold and Win feature a pot or the value coins start — present only when the project's
	 *  `holdAndWin` block is the overlay's BONUS, never when it is the base game. */
	holdAndWin?: HoldAndWinMockInputs;
	/**
	 * The REELS modes of the project's own a pot starts (an imported free spins, `./imports`), by
	 * mode id: the game type it plays on, the strips the mock deals its spins from and the line pays
	 * (`occurs → multiplier`) of the symbols on them that pay on a line. Absent when no pot routes to
	 * one, so every overlay before imports existed is dealt exactly as before. Names are the
	 * project's; the launcher's contract puts them in the server's vocabulary.
	 */
	modes?: Record<
		string,
		{ gameType: string; strips: string[][]; paytable: Record<string, Record<string, number>> }
	>;
};

/**
 * The mock's overlay inputs for a normalized doc, or `undefined` when nothing composes over the host.
 * That is the `potsOverlay` (something drops), or — with nothing dropping — a respin mode the
 * overlay starts by a buy, a Lucky Spin or a random metre (`respinIsOverlayBonus`), as
 * `{ pots: [], drops: { table: [] } }` beside it (bonus-games Phase 7a).
 */
export function potsOverlayMockInputs(
	doc: GameConfigDoc,
	{ sellsBetModes = true }: { sellsBetModes?: boolean } = {},
): PotsOverlayMockInputs | undefined {
	const overlay = legacyPotsOverlay(doc);
	if (!overlay) {
		// A route the host mock deals: a buy only where it sells the doc's bet modes (not the book mock).
		const holdAndWin = respinIsOverlayBonus(doc) ? holdAndWinMockInputs(doc) : undefined;
		const routed =
			holdAndWin &&
			[holdAndWin, ...(holdAndWin.modes ?? [])].some(({ block }) =>
				Boolean(
					(sellsBetModes && block.trigger.buy?.length) ||
					block.trigger.luckySpin ||
					block.trigger.randomMetre,
				),
			);
		return routed
			? {
					pots: [],
					drops: { chance: 0, maxPerSpin: 1, table: [], modes: [BASE_GAME_MODE] },
					holdAndWin,
				}
			: undefined;
	}
	const holdAndWin = holdAndWinIsOverlayBonus(doc) ? holdAndWinMockInputs(doc) : undefined;
	const builtin = new Set(builtinGameModes().map((m) => m.id));
	const modes: NonNullable<PotsOverlayMockInputs['modes']> = {};
	for (const pot of overlay.pots) {
		const mode = gameModeById(doc, pot.bonus.mode);
		if (!mode || builtin.has(mode.id) || mode.board !== 'reels') continue;
		const gameType = gameTypeForMode(mode);
		const strips = (doc.paddingReels[gameType] ?? []).map((strip) => strip.map((c) => c.name));
		if (!strips.length) continue;
		const paytable: Record<string, Record<string, number>> = {};
		for (const name of new Set(strips.flat())) {
			const symbol = doc.symbols[name];
			const special = symbol?.special_properties ?? [];
			// A scatter's or wild's pay is not a line pay: the mock pays them its own way.
			if (!symbol?.paytable?.length || special.includes('scatter') || special.includes('wild')) {
				continue;
			}
			paytable[name] = Object.assign({}, ...symbol.paytable);
		}
		modes[mode.id] = { gameType, strips, paytable };
	}
	return {
		pots: overlay.pots,
		drops: { ...overlay.drops, modes: overlayDropModes(overlay.drops) },
		...(holdAndWin ? { holdAndWin } : {}),
		...(Object.keys(modes).length ? { modes } : {}),
	};
}
