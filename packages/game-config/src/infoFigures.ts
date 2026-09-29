import { resolveBetModes } from './betModes';
import type { GameConfigDoc } from './types';

/** RTP as the rules page prints it, `96.50%`. The config states a fraction (`0.965`); a value above 1
 *  is read as already a percentage rather than printed as 9650%. */
export const formatRtp = (rtp: number): string => `${(rtp > 1 ? rtp : rtp * 100).toFixed(2)}%`;

/**
 * The figures the info page's rules state, formatted: the max win from the base bet mode (× total
 * bet), and the RTP — the config's `rtp`, else the base mode's — ONLY when `displayRTP` (the
 * operator's `showTheoreticalPayback`, false wherever nobody said otherwise). An unstated figure (0)
 * is absent, which leaves its block as the default copy. `formatNumber` is the game's locale.
 */
export const infoPageFigures = (
	doc: GameConfigDoc,
	displayRTP: boolean,
	formatNumber: (n: number) => string,
): { rtp?: string; maxWin?: string } => {
	const modes = resolveBetModes(doc);
	const base = modes.find((mode) => mode.kind === 'base') ?? modes[0];
	const rtp = doc.rtp > 0 ? doc.rtp : (base?.rtp ?? 0);
	const maxWin = base?.maxWin ?? 0;
	return {
		...(displayRTP && rtp > 0 ? { rtp: formatRtp(rtp) } : {}),
		...(maxWin > 0 ? { maxWin: formatNumber(maxWin) } : {}),
	};
};
