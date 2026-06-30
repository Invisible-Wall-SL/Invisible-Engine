import type { ComponentParam } from './types';

/**
 * Complete-on-loaded — a reusable per-instance capability any `overlay`-category
 * `componentInstance` can switch on, the FEED-TRIGGERED sibling of `tapToContinue`
 * (docs/design/flow-driven-game.md §1 "the loading gate, authorable in the flow";
 * Invisible Flow §6.2). Where `tapToContinue` advances the active Flow screen on a
 * TAP, this advances it the moment the boot ASSET-LOAD completes — so the author
 * drops a loading-bar component on the `loading` screen, and the flow's `complete`
 * edge fires when loading finishes, wiring "what happens next" in `/flow` instead of
 * it being hard-coded.
 *
 * It is a SHARED instance param (not bolted to one def): the editor surfaces the
 * toggle for every overlay instance, and `ComponentInstance.svelte` honours it
 * universally. When `completeOnLoaded` is on, the engine subscribes the registered
 * `assetsLoaded` BoolSource (the same feed `visibleSource` gates on — registered by
 * the game via `registerComponentVisibility`) and, on its RISING EDGE (false→true,
 * fired exactly once), calls the Flow holder's `completeActiveScreen()` +
 * `emitFlowSignal(loadedSignal)`. The engine only DECLARES the toggle; the game owns
 * the runtime wiring (the same `declare ≠ implement` split as `tapToContinue`).
 *
 * OFF by default ⇒ no subscription ⇒ byte-identical to today. A rising edge with no
 * active Flow interpreter is a safe no-op (the holder helpers return false), AND the
 * interpreter's own `onComplete()` only fires an outgoing edge from the CURRENT active
 * screen — so once `loading` has already advanced (e.g. via the coded press-to-continue)
 * a stray `completeActiveScreen()` matches nothing (no double-fire). The component-level
 * fire-once guard is belt-and-suspenders on top of that.
 */

/** Param key: enable the per-instance complete-on-loaded behaviour. `boolean`, default false. */
export const COMPLETE_ON_LOADED_PARAM = 'completeOnLoaded';

/** Param key: the named Flow signal the loaded edge emits (in addition to completing the
 * active screen). Empty/absent ⇒ no signal is emitted, only `completeActiveScreen`. */
export const LOADED_SIGNAL_PARAM = 'loadedSignal';

/**
 * The shared instance params the editor surfaces for an `overlay`-category
 * `componentInstance` (the single source of truth for key + kind + label, reused by
 * `EditorProperties.svelte`). These are NOT added to any `ComponentDef.params`; they
 * live only on the placed instance's `params`, read directly by `ComponentInstance.svelte`
 * + `resolveComponentParams` (which merges `node.params` regardless of the def).
 */
export const COMPLETE_ON_LOADED_PARAMS: ComponentParam[] = [
	{ key: COMPLETE_ON_LOADED_PARAM, kind: 'boolean', default: false, label: 'Complete on loaded' },
	{ key: LOADED_SIGNAL_PARAM, kind: 'string', label: 'Loaded signal' },
];

/** Read whether an instance's resolved params switched the complete-on-loaded behaviour on. */
export function isCompleteOnLoadedEnabled(params: Record<string, unknown>): boolean {
	return params[COMPLETE_ON_LOADED_PARAM] === true;
}

/** Read the named Flow signal an instance's loaded edge should emit (trimmed; '' ⇒ none). */
export function loadedSignalOf(params: Record<string, unknown>): string {
	const value = params[LOADED_SIGNAL_PARAM];
	return typeof value === 'string' ? value.trim() : '';
}
