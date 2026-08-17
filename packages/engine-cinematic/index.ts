/**
 * Invisible Cinematic — the shared evaluator.
 *
 * THE canonical copy of the cinematic blend/sampling maths, so the `/rigger` preview and the
 * in-game `<Cinematic>` player produce identical output. It is deliberately plain, dependency-free
 * ESM JavaScript rather than TypeScript: the browser loads the very same FILE (the launcher serves
 * a generated verbatim copy at `/shared/cinematicEval.mjs` — see `scripts/sync-cinematic-eval.mjs`,
 * whose `--check` mode fails if the two ever drift), and a build step that had to strip types would
 * be one more thing between the two consumers.
 *
 * Types for the engine side live in `./types.ts`.
 */
export * from './src/cinematicEval.js';
export type * from './types';
