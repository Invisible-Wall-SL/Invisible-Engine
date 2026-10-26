/**
 * Invisible Engine — game mechanics: the rules of a non-slot family, as plain logic with no
 * drawing (`docs/design/game-families.md` §4): the match-3 board, arcade motion and characters.
 *
 * Plain, dependency-free ESM JavaScript with hand-written `.d.ts` beside it, for the reason
 * `engine-cinematic` is: two very different callers share the very same file. The client reaches
 * it through this workspace package; the match-3 mock RGS (P10.6) imports `src/board.js` by
 * relative path, so a rules game and the mock can never disagree about what a match is.
 */
export * from './src/board.js';
export * from './src/motion.js';
export * from './src/behaviours.js';
