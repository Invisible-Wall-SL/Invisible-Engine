/**
 * Invisible Engine — game mechanics: the rules of a non-slot family, as plain logic with no
 * drawing (`docs/design/game-families.md` §4): the match-3 board, arcade motion, its camera,
 * characters and jumps, the online room (its step, its rules and the device's netcode), and the
 * card duel's rules (`docs/design/card-games.md` §2).
 *
 * Plain, dependency-free ESM JavaScript with hand-written `.d.ts` beside it, for the reason
 * `engine-cinematic` is: two very different callers share the very same file. The client reaches
 * it through this workspace package; the match-3 mock RGS (P10.6) imports `src/board.js` by
 * relative path, so a rules game and the mock can never disagree about what a match is.
 */
export * from './src/board.js';
export * from './src/motion.js';
export * from './src/camera.js';
export * from './src/behaviours.js';
export * from './src/jumps.js';
export * from './src/online.js';
export * from './src/netcode.js';
export * from './src/onlineRules.js';
export * from './src/onlineBots.js';
export * from './src/cards.js';
