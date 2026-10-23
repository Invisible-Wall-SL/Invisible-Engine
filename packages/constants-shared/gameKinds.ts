/**
 * The built-in game kinds — THE one list. A project's recorded kind (`projects.game_type`, a
 * LayoutDoc's `gameType`) picks its scene set, flow vocabulary + starter flow, mock protocol and
 * which options each authoring tool offers (`kindCapabilities` in `engine-layout`).
 *
 * Lives here because this package is dependency-free and already imported by the launcher,
 * `engine-layout`, `engine-flow-v2` and `game-spec`, so every consumer derives from it instead of
 * keeping a hand-copied list that a new kind silently misses. Author-created custom kinds (editor
 * §21) are NOT listed: they are arbitrary ids stored in R2, and every consumer treats an id it
 * does not know as a custom kind.
 *
 * `match3` and `arcade` are the first kinds that are not slots (`docs/design/game-families.md`).
 * A consumer that only makes sense for slots derives from {@link SLOT_GAME_KINDS} instead.
 */

/** The built-in kinds that are slots: every kind a slot-only consumer may offer. */
export const SLOT_GAME_KINDS = [
	'lines',
	'ways',
	'cluster',
	'scatter',
	'bookOf',
	'holdAndWin',
] as const;

export const GAME_KINDS = [...SLOT_GAME_KINDS, 'match3', 'arcade'] as const;

export type GameKind = (typeof GAME_KINDS)[number];

/** The kind a project with no recorded kind is treated as. */
export const DEFAULT_GAME_KIND: GameKind = 'lines';

/** The ways of playing a kind belongs to. Every kind before Phase 10 is a slot. */
export const GAME_FAMILIES = ['slot', 'match3', 'arcade'] as const;

export type GameFamily = (typeof GAME_FAMILIES)[number];

const FAMILY_OF_KIND: Readonly<Record<string, GameFamily>> = { match3: 'match3', arcade: 'arcade' };

/** The family a kind plays as. A custom kind, or none, is a slot, as every consumer treats it. */
export const familyOfKind = (kind: string | null | undefined): GameFamily =>
	kind && Object.hasOwn(FAMILY_OF_KIND, kind) ? FAMILY_OF_KIND[kind] : 'slot';
