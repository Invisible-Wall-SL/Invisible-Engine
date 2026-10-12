import { respinModeBlocks, spinsModeDecls, type GameConfigDoc } from 'game-config';

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

/** A spins mode as Invisible Win Text and Localization list its lines (bonus-games Phase 8): its id
 *  and label. It speaks its own win-line message and win-tier captions (`WinTextDoc.modes[<id>]`). */
export type WinTextSpinsMode = { mode: string; label: string };

/** Every spins mode (`GameModeDecl.spins`), in declaration order. Empty for a doc without one. */
export function winTextSpinsModes(doc: GameConfigDoc | null | undefined): WinTextSpinsMode[] {
	if (!doc) return [];
	return spinsModeDecls(doc).map((mode) => ({ mode: mode.id, label: mode.label ?? mode.id }));
}
