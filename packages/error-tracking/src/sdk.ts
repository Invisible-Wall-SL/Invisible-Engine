/**
 * The only parts of the Sentry SDK this package calls, as the module `browser.ts` lazy-loads.
 *
 * Importing `@sentry/browser` itself dynamically hands the bundler its whole namespace — Session
 * Replay, feedback, tracing — which it cannot tree-shake, and which measured +440 KB on the game's
 * single-file bundle. Named re-exports let it keep only these and what they reach.
 */
export { captureException, init, setTags, withScope } from '@sentry/browser';
