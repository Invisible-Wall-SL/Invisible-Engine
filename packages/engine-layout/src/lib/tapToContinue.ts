import type { ComponentParam } from './types';

/**
 * Tap-to-continue — a reusable per-instance capability any `overlay`-category
 * `componentInstance` can switch on, WITHOUT the component's def declaring it
 * (docs/design/invisible-editor.md §8.5 "declare ≠ implement"; Invisible Flow §6.2).
 *
 * It is a SHARED instance param (not bolted to one def): the editor surfaces the
 * toggle for every overlay instance, and `ComponentInstance.svelte` honours it
 * universally. When `tapToContinue` is on, the engine mounts the game-registered
 * coded press surface (`TAP_TO_CONTINUE_COMPONENT`) over the overlay's art; on a
 * tap that coded part — game-side, the `implement` half — calls the Flow holder's
 * `completeActiveScreen()` + `emitFlowSignal(tapSignal)` (the runtime APIs on
 * `flow/tap-to-continue`). The engine only DECLARES the toggle + the bind slot.
 *
 * OFF by default ⇒ no extra child is mounted ⇒ byte-identical to today. A tap with
 * no active Flow interpreter is a safe no-op (the holder helpers return false).
 */

/** Param key: enable the per-instance tap surface. `boolean`, default false. */
export const TAP_TO_CONTINUE_PARAM = 'tapToContinue';

/** Param key: the named Flow signal a tap emits (in addition to completing the
 * active screen). Empty/absent ⇒ no signal is emitted, only `completeActiveScreen`. */
export const TAP_SIGNAL_PARAM = 'tapSignal';

/** Param key: the full-screen DIM backdrop colour the tap surface draws behind its
 * hit area (`color`). Only visible when `tapDimAlpha` > 0; defaults to black. */
export const TAP_DIM_COLOR_PARAM = 'tapDimColor';

/** Param key: the full-screen DIM backdrop OPACITY (`number`, 0–1). PARITY DEFAULT
 * `0` ⇒ no dim ⇒ existing tap overlays render byte-identically; the author opts into
 * a dim by setting alpha > 0. */
export const TAP_DIM_ALPHA_PARAM = 'tapDimAlpha';

/** Param key: ARM the tap surface only AFTER the named component-scoped signal has fired for this
 * instance (e.g. a sibling spine's `completeSignal` — so "tap to continue" is dead until the intro
 * finishes). Empty/absent ⇒ armed on mount (parity — today's behaviour); before it fires, taps are
 * ignored (the hit surface is not mounted). */
export const TAP_ARM_AFTER_SIGNAL_PARAM = 'tapArmAfterSignal';

/** Param key: SHOW the engine's default press-to-continue prompt graphic over the tap
 * surface (`boolean`, default true — prompt SHOWN). History: made opt-in (default false)
 * on 2026-07-14 on the theory a flow-authored overlay always draws its own prompt; reverted
 * to default-SHOWN on 2026-07-17 (owner decision) after a shipped loading gate lost its
 * "tap to continue" text — the built-in graphic is the sensible default, an author who
 * draws their own prompt turns this OFF. The full-screen tap / Space work regardless (the
 * prompt is purely cosmetic). */
export const TAP_SHOW_PROMPT_PARAM = 'tapShowPrompt';

/**
 * The `registerBoundComponents` name the engine mounts for the tap press surface.
 * The game registers a coded component under this name (apps/lines:
 * `TapToContinue.svelte` — `OnPressFullScreen` + `OnHotkey "Space"`) that owns the
 * hit area and calls the Flow holder. Absent from the registry ⇒ the engine mounts
 * nothing (parity, safe no-op).
 */
export const TAP_TO_CONTINUE_COMPONENT = 'TapToContinue';

/**
 * The shared instance params the editor surfaces for an `overlay`-category
 * `componentInstance` (the single source of truth for key + kind + label, reused
 * by `EditorProperties.svelte`). These are NOT added to any `ComponentDef.params`;
 * they live only on the placed instance's `params`, read directly by
 * `ComponentInstance.svelte` + `resolveComponentParams` (which merges `node.params`
 * regardless of the def).
 */
export const TAP_TO_CONTINUE_PARAMS: ComponentParam[] = [
	{ key: TAP_TO_CONTINUE_PARAM, kind: 'boolean', default: false, label: 'Tap to continue' },
	{ key: TAP_SIGNAL_PARAM, kind: 'string', label: 'Tap signal' },
	{ key: TAP_DIM_COLOR_PARAM, kind: 'color', label: 'Dim colour' },
	{ key: TAP_DIM_ALPHA_PARAM, kind: 'number', label: 'Dim opacity (0–1)' },
	{ key: TAP_ARM_AFTER_SIGNAL_PARAM, kind: 'string', label: 'Arm tap after signal' },
	{ key: TAP_SHOW_PROMPT_PARAM, kind: 'boolean', default: true, label: 'Show engine prompt' },
];

/** Read whether an instance's resolved params switched the tap surface on. */
export function isTapToContinueEnabled(params: Record<string, unknown>): boolean {
	return params[TAP_TO_CONTINUE_PARAM] === true;
}

/** Read the named Flow signal an instance's tap should emit (trimmed; '' ⇒ none). */
export function tapSignalOf(params: Record<string, unknown>): string {
	const value = params[TAP_SIGNAL_PARAM];
	return typeof value === 'string' ? value.trim() : '';
}

/** Read the tap surface's dim backdrop colour (a hex number); default black. */
export function tapDimColorOf(params: Record<string, unknown>): number {
	const value = params[TAP_DIM_COLOR_PARAM];
	return typeof value === 'number' ? value : 0x000000;
}

/**
 * Read the tap surface's dim backdrop OPACITY. PARITY DEFAULT `0` (no dim) — an
 * instance with no `tapDimAlpha` set resolves to a fully transparent backdrop, so an
 * existing tap overlay is byte-identical to today; the author opts in with alpha > 0.
 */
export function tapDimAlphaOf(params: Record<string, unknown>): number {
	const value = params[TAP_DIM_ALPHA_PARAM];
	return typeof value === 'number' ? value : 0;
}

/** Read the named signal a tap surface must wait for before arming (trimmed; '' ⇒ arm on mount). */
export function tapArmAfterSignalOf(params: Record<string, unknown>): string {
	const value = params[TAP_ARM_AFTER_SIGNAL_PARAM];
	return typeof value === 'string' ? value.trim() : '';
}

/** Read whether the tap surface should SHOW the engine's default prompt graphic. Default
 * TRUE ⇒ the prompt is SHOWN unless the author explicitly turns it OFF (`=== false`); an
 * absent/unset param means shown (reverted to default-shown 2026-07-17). */
export function tapShowPromptOf(params: Record<string, unknown>): boolean {
	return params[TAP_SHOW_PROMPT_PARAM] !== false;
}

/**
 * Whether a tap-to-continue node's DIM backdrop should render BEHIND the scene content: true iff
 * the tap node is NOT the topmost (last-painted) node — i.e. the author placed content ABOVE it in
 * the outline (the paint order `LayoutScene` walks). `orderedNodeIds` is the scene's top-level node
 * ids in that paint order. A tap id not present (a nested instance) ⇒ false, the safe legacy
 * in-front placement. Lives here (not inline in `LayoutScene`) so the layer-order rule is unit
 * testable and can't silently drift.
 */
export function tapDimBehind(orderedNodeIds: readonly string[], tapId: string): boolean {
	const index = orderedNodeIds.indexOf(tapId);
	return index >= 0 && index < orderedNodeIds.length - 1;
}
