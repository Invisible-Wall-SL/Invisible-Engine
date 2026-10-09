import {
	gameTypeForMode,
	splitFormOf,
	stripWidthFor,
	type GameConfigDoc,
	type HoldAndWinGame,
	type RespinPlay,
} from 'game-config';

/**
 * How `/config` shapes the doc it edits and the doc it saves. The page is a writer of the SPLIT FORM
 * (`docs/design/bonus-games.md` §2.1): it never holds or sends the legacy `holdAndWin` /
 * `potsOverlay` keys, because a stale copy of them would win over its edits on save. The server
 * regenerates them. `check:config-bonus-modes` runs these, so the page's own shaping is what is
 * gated.
 */

/** The live doc for a stored, preset, template or pasted config. */
export const openDoc = (doc: GameConfigDoc): GameConfigDoc => splitFormOf(doc);

/** The doc a save PUTs: the live doc, with no legacy key whatever an edit left on it. */
export const bodyFor = (live: GameConfigDoc): GameConfigDoc => splitFormOf(live);

/** The live doc after a save, from the doc the server stored (which carries the mirror again). */
export const adoptSaved = (saved: GameConfigDoc): GameConfigDoc => splitFormOf(saved);

/** Set how a respin mode's respins are played, in place. Only `manual` is stored: `auto` is the
 *  default, so choosing it leaves the rules as a project that never chose saved them. */
export const setRespinPlay = (rules: HoldAndWinGame, play: RespinPlay): void => {
	if (play === 'manual') rules.play = 'manual';
	else delete rules.play;
};

/** The strip sets as wide as the base grid: every one but a spins mode's on a grid of its own
 *  (bonus-games Phase 8b), which follow that grid and are never grown or cut to the base one. */
export const baseWidthGameTypes = (doc: GameConfigDoc): string[] => {
	const own = new Set(
		(doc.modes ?? []).filter((m) => m.spins?.numReels !== undefined).map(gameTypeForMode),
	);
	return Object.keys(doc.paddingReels).filter((g) => !own.has(g));
};

/** Any strip set not as wide as its own grid (`stripWidthFor`), or a payline not as wide as the base
 *  grid: what the Grid's "Match grid" fixes. */
export const gridMismatch = (doc: GameConfigDoc): boolean =>
	Object.keys(doc.paddingReels).some(
		(g) => (doc.paddingReels[g]?.length ?? 0) !== stripWidthFor(doc, g),
	) || Object.keys(doc.paylines).some((id) => doc.paylines[id].length !== doc.numReels);
