/**
 * What the mock RGS deals a pots overlay from (`withPotsOverlay` in `scripts/mock-pots-overlay.mjs`),
 * beside the host kind's own mock. One derivation, read by the launcher's mock contract and by the
 * protocol gate, so the gate proves the rounds the test server actually deals.
 */

import { holdAndWinIsOverlayBonus } from './holdAndWin';
import { holdAndWinMockInputs, type HoldAndWinMockInputs } from './holdAndWinMock';
import { overlayDropModes, type OverlayDrops, type OverlayPot } from './potsOverlay';
import type { GameConfigDoc } from './types';

export type PotsOverlayMockInputs = {
	pots: OverlayPot[];
	/** The drop rules, with the dropping modes resolved (the base game when unauthored). */
	drops: OverlayDrops & { modes: string[] };
	/** The Hold and Win feature a pot or the value coins start — present only when the project's
	 *  `holdAndWin` block is the overlay's BONUS, never when it is the base game. */
	holdAndWin?: HoldAndWinMockInputs;
};

/** The mock's overlay inputs for a normalized doc, or `undefined` when it has no `potsOverlay`. */
export function potsOverlayMockInputs(doc: GameConfigDoc): PotsOverlayMockInputs | undefined {
	const overlay = doc.potsOverlay;
	if (!overlay) return undefined;
	const holdAndWin = holdAndWinIsOverlayBonus(doc) ? holdAndWinMockInputs(doc) : undefined;
	return {
		pots: overlay.pots,
		drops: { ...overlay.drops, modes: overlayDropModes(overlay.drops) },
		...(holdAndWin ? { holdAndWin } : {}),
	};
}
