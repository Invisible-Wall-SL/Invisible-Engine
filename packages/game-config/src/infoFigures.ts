import { resolveBetModes } from './betModes';
import type { BetModeKind, GameConfigDoc, ResolvedBetMode } from './types';

/** RTP as the rules page prints it, `96.50%`. The config states a fraction (`0.965`); a value above 1
 *  is read as already a percentage rather than printed as 9650%. */
export const formatRtp = (rtp: number): string => `${(rtp > 1 ? rtp : rtp * 100).toFixed(2)}%`;

/**
 * The RTP of every mode of one kind, as the rules page prints it: one figure when they agree, the
 * lowest and highest when they do not. Modes that state none are skipped; none at all ⇒ absent.
 */
const kindRtp = (modes: ResolvedBetMode[], kind: BetModeKind): string | undefined => {
	const rtps = modes.filter((m) => m.kind === kind && m.rtp > 0).map((m) => m.rtp);
	if (!rtps.length) return undefined;
	const low = formatRtp(Math.min(...rtps));
	const high = formatRtp(Math.max(...rtps));
	return low === high ? low : `${low} – ${high}`;
};

/** Which per-mode paybacks the operator asked to see (`showBuyBonusPayback`, `showHighChancePayback`). */
export interface ModePaybackGates {
	buy?: boolean;
	ante?: boolean;
}

/**
 * The figures the info page's rules state, formatted: the max win from the base bet mode (× total
 * bet), and the RTP — the config's `rtp`, else the base mode's — ONLY when `displayRTP` (the
 * operator's `showTheoreticalPayback`, false wherever nobody said otherwise). The buy and ante
 * ("high chance") modes' RTPs follow their own operator gates the same way. An unstated figure (0)
 * is absent, which leaves its block as the default copy. `formatNumber` is the game's locale.
 */
export const infoPageFigures = (
	doc: GameConfigDoc,
	displayRTP: boolean,
	formatNumber: (n: number) => string,
	paybacks: ModePaybackGates = {},
): { rtp?: string; maxWin?: string; buyRtp?: string; anteRtp?: string } => {
	const modes = resolveBetModes(doc);
	const base = modes.find((mode) => mode.kind === 'base') ?? modes[0];
	const rtp = doc.rtp > 0 ? doc.rtp : (base?.rtp ?? 0);
	const maxWin = base?.maxWin ?? 0;
	const buyRtp = paybacks.buy ? kindRtp(modes, 'buy') : undefined;
	const anteRtp = paybacks.ante ? kindRtp(modes, 'ante') : undefined;
	return {
		...(displayRTP && rtp > 0 ? { rtp: formatRtp(rtp) } : {}),
		...(maxWin > 0 ? { maxWin: formatNumber(maxWin) } : {}),
		...(buyRtp ? { buyRtp } : {}),
		...(anteRtp ? { anteRtp } : {}),
	};
};
