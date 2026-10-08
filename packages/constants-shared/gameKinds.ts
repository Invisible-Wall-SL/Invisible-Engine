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
 */
export const GAME_KINDS = ['lines', 'ways', 'cluster', 'scatter', 'holdAndWin'] as const;

export type GameKind = (typeof GAME_KINDS)[number];

/** The kind a project with no recorded kind is treated as. */
export const DEFAULT_GAME_KIND: GameKind = 'lines';
