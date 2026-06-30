import type { ComponentParam } from './types';
import { ENGINE_ACTION_CATALOG, VISIBILITY_SOURCE_KEYS } from './componentCatalog';

/**
 * Universal engine bindings — the two GENUINELY-universal per-instance bindings any
 * `componentInstance` can carry WITHOUT its def declaring the param (docs/design/
 * flow-driven-game.md §6 "Universal engine-signal/param exposure on instances",
 * requirement 2). They mirror the `tapToContinue` pattern exactly: SHARED instance
 * params (not bolted to one def), surfaced by `EditorProperties.svelte` for any
 * instance whose def LACKS them, and read by `ComponentInstance.svelte` +
 * `resolveComponentParams` regardless of the def.
 *
 * These two are universal because the RUNTIME already gates/clicks the WHOLE instance
 * from these param keys regardless of the def:
 *  - `action` → `ComponentInstance.svelte` turns the rendered art into a hit surface
 *    (the default-hit-surface path, §18.4) when the instance resolves an `ActionSource`
 *    and the def has no coded bind part — so ANY instance becomes clickable.
 *  - `visibleSource` → `ComponentInstance.svelte` wraps the subtree in a
 *    `<Container visible={liveVisible}>` gated on the registered `BoolSource` — so ANY
 *    instance becomes lifecycle-gated.
 *
 * Both UNSET ⇒ nothing resolves ⇒ byte-identical to today (an unset binding is exactly
 * an unbound def param — the runtime read sites already fall through to no-op). A def
 * that DECLARES the param (a `button` has `action`, a `freeSpinCounter` has
 * `visibleSource`) is unaffected: the editor suppresses the universal control for it so
 * the def's own param stands as the single source.
 *
 * The `value`/`signal` universal bindings are NOT here — they need a def node to consume
 * them, so they belong to a later slice.
 */

/** Param key: the engine action a tap on this instance triggers (`declare ≠ implement`:
 * the game registers the handler via `registerComponentActions`; absent ⇒ no-op). */
export const ACTION_PARAM = 'action';

/** Param key: the boolean show/hide feed that gates this instance's visibility (the
 * game registers the source via `registerComponentVisibility`; absent ⇒ ungated). */
export const VISIBLE_SOURCE_PARAM = 'visibleSource';

/**
 * The shared instance params the editor surfaces for ANY `componentInstance` whose def
 * does NOT already declare them (the single source of truth for key + kind + options +
 * label, reused by `EditorProperties.svelte`). These are NOT added to any
 * `ComponentDef.params`; they live only on the placed instance's `params`, read directly
 * by `ComponentInstance.svelte` + `resolveComponentParams` (which merges `node.params`
 * regardless of the def). `action` options = the registered HUD action catalog;
 * `visibleSource` options = the registered visibility-feed keys.
 */
export const ENGINE_BINDING_PARAMS: ComponentParam[] = [
	{ key: ACTION_PARAM, kind: 'string', label: 'Action', options: ENGINE_ACTION_CATALOG },
	{ key: VISIBLE_SOURCE_PARAM, kind: 'string', label: 'Shows during', options: VISIBILITY_SOURCE_KEYS },
];

/** Read the engine action an instance's resolved params bind to (trimmed; '' ⇒ none). */
export function actionBindingOf(params: Record<string, unknown>): string {
	const value = params[ACTION_PARAM];
	return typeof value === 'string' ? value.trim() : '';
}

/** Read the visibility feed an instance's resolved params gate on (trimmed; '' ⇒ ungated). */
export function visibleSourceBindingOf(params: Record<string, unknown>): string {
	const value = params[VISIBLE_SOURCE_PARAM];
	return typeof value === 'string' ? value.trim() : '';
}
