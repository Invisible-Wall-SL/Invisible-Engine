import {
	gameTypeForMode,
	migrateLegacyBonus,
	normalizeGameConfigDoc,
	stripWidthFor,
	withCharacterSheets,
	type GameConfigDoc,
	type HoldAndWinGame,
	type AddRowsAt,
	type RowOpenStyle,
	type LegacyBonusKeys,
	type RespinPlay,
} from 'game-config';

/**
 * How `/config` shapes the doc it edits and the doc it saves. The page edits the SPLIT FORM
 * (`docs/design/bonus-games.md` §2.1): a stored, preset, template or pasted config that still
 * carries a legacy `holdAndWin` / `potsOverlay` block is migrated as it opens, and nothing the page
 * holds or sends carries one. `check:config-bonus-modes` runs these, so the page's own shaping is
 * what is gated.
 *
 * A 3D game's doc also holds two blocks `game-config` does not know and its normalizer drops: the
 * top-level `models` and `arcade.world3d` (the server carries them past it on save and load,
 * `$lib/server/gameConfig3d.ts`). A normal save sends them back untouched; an operation that
 * REPLACES the live doc goes through {@link applyPasted} or {@link resetTo}, or the next Save
 * stores the config without them. `check:game-config-3d` runs both into the real save.
 */

/** The live doc for a stored, preset, template or pasted config. */
export const openDoc = (doc: GameConfigDoc & LegacyBonusKeys): GameConfigDoc =>
	migrateLegacyBonus(doc);

const isObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);

/** The 3D blocks a live doc or a pasted value holds. */
const blocks3dOf = (from: unknown): { world3d?: unknown; models?: unknown } =>
	isObject(from)
		? { world3d: isObject(from.arcade) ? from.arcade.world3d : undefined, models: from.models }
		: {};

/** Whether `doc` holds a 3D block: what a reset keeps, so its confirmation can say so. */
export const holds3dBlocks = (doc: GameConfigDoc): boolean => {
	const { world3d, models } = blocks3dOf(doc);
	return world3d !== undefined || models !== undefined;
};

/** `onto` with the 3D blocks `from` holds, `models` and `arcade.world3d`, as `from` has them. A
 *  block `from` lacks is left as `onto` has it, and no other key changes; with nothing to carry,
 *  `onto` itself comes back. */
export const carry3dBlocks = (from: unknown, onto: GameConfigDoc): GameConfigDoc => {
	const { world3d, models } = blocks3dOf(from);
	if (world3d === undefined && models === undefined) return onto;
	const out: GameConfigDoc & { models?: unknown } = { ...onto };
	if (world3d !== undefined) out.arcade = { ...onto.arcade, world3d } as GameConfigDoc['arcade'];
	if (models !== undefined) out.models = models;
	return out;
};

/** The live doc for a config applied from Raw JSON, or `undefined` when the text does not describe
 *  a game. Its 3D blocks and its character sheets (`game-config` `characterSheet.ts`, which the
 *  normalizer drops too) are the PASTED ones, so one the author removed from the text is removed;
 *  the save normalizes and validates them. */
export const applyPasted = (pasted: unknown): GameConfigDoc | undefined => {
	const next = normalizeGameConfigDoc(pasted);
	return next && openDoc(withCharacterSheets(carry3dBlocks(pasted, next), pasted));
};

/** The live doc for a reset to `to`, the template default or a preset. Its 3D blocks are the LIVE
 *  doc's: a reset replaces the game this page's sections edit, and none of them edits either. */
export const resetTo = (to: GameConfigDoc, live: GameConfigDoc): GameConfigDoc =>
	openDoc(carry3dBlocks(live, to));

/** The doc a save PUTs: a copy of the live doc. */
export const bodyFor = (live: GameConfigDoc): GameConfigDoc => structuredClone(live);

/** The live doc after a save, from the doc the server stored. */
export const adoptSaved = (saved: GameConfigDoc): GameConfigDoc => structuredClone(saved);

/** Set how a respin mode's respins are played, in place. Only `manual` is stored: `auto` is the
 *  default, so choosing it leaves the rules as a project that never chose saved them. */
export const setRespinPlay = (rules: HoldAndWinGame, play: RespinPlay): void => {
	if (play === 'manual') rules.play = 'manual';
	else delete rules.play;
};

/** Set where a respin mode's growing board draws the rows it adds, in place. Only `above` and
 *  `split` are stored: `below` is the default, so choosing it leaves the rules as a project that
 *  never chose saved them. */
export const setAddRowsAt = (rules: HoldAndWinGame, at: AddRowsAt): void => {
	if (at === 'above' || at === 'split') rules.addRowsAt = at;
	else delete rules.addRowsAt;
};

/** Set how a respin mode's locked rows open, in place. Only `component` is stored (with its
 *  stagger); `fade` is the default, so choosing it drops both fields. */
export const setOpenStyle = (rules: HoldAndWinGame, style: RowOpenStyle): void => {
	if (style === 'component') rules.openStyle = 'component';
	else {
		delete rules.openStyle;
		delete rules.openStagger;
	}
};

/** Set the ms between rows of a component opening, in place; 0 is the default and is not stored. */
export const setOpenStagger = (rules: HoldAndWinGame, ms: number): void => {
	if (ms > 0) rules.openStagger = ms;
	else delete rules.openStagger;
};

/** Mark a respin mode as one whose server draws enhancements, in place. Only `true` is stored, so
 *  turning it off leaves the rules as a project that never had it saved them. */
export const setEnhancements = (rules: HoldAndWinGame, on: boolean): void => {
	if (on) rules.enhancements = true;
	else delete rules.enhancements;
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
