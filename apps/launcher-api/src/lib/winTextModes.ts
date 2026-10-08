import { respinModeBlocks, type GameConfigDoc } from 'game-config';

/** A respin mode as Invisible Win Text and Localization list its lines (`docs/design/bonus-games.md`
 *  §2.4): its id and label, its own jackpot tiers in config order, and whether it spins a wheel. */
export type WinTextRespinMode = {
	mode: string;
	label: string;
	jackpotTiers: string[];
	hasWheel: boolean;
};

/**
 * Every respin mode with rules, the PRIMARY first — the one whose lines are the doc's top-level
 * families. Read from the split form (each mode's own rules), never from the legacy mirror.
 */
export function winTextRespinModes(doc: GameConfigDoc | null | undefined): WinTextRespinMode[] {
	if (!doc) return [];
	return respinModeBlocks(doc).map(({ mode, decl }) => ({
		mode,
		label: decl.label ?? mode,
		jackpotTiers: (decl.holdAndWin.jackpots ?? []).map((jackpot) => jackpot.name),
		hasWheel: Boolean(decl.holdAndWin.wheel),
	}));
}
