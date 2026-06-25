/**
 * Shared button STATE-IMAGE cascade — ONE resolution used by BOTH button
 * flavours so they can't drift:
 * - the coded-frame button (`ButtonFrame.svelte` in components-ui-pixi), and
 * - an AUTHORED art button (sprite+text def with no coded part), where
 *   `<ComponentInstance>`'s interactive wrapper owns hover/press and overrides
 *   the `image` param with the resolved state image (the def's bg sprite binds
 *   `region` → `image`).
 *
 * Cascade: spinning (`imageSpinning`, the round-in-progress frame the engine
 * rotates) → disabled (`imageDisabled`, the downstate) → pressed (`imagePressed`,
 * falls back to hover, then to selected while active) → hovered (`imageHover`,
 * falls back to selected while active) → active (`imageSelected`). Returns
 * `undefined` when the current state has no authored image — the caller keeps
 * its resting look (`image` param / tile). Empty strings normalize to unset so
 * a cleared editor field behaves like an absent param.
 *
 * `spinning` is checked FIRST because a single bet's roll sets BOTH `spinning`
 * and `disabled` (the button is inert while one spin rolls — there is nothing to
 * stop) and the rotating spin frame must win over the downstate grey.
 */

import type { ButtonStateAnimations, SpineStateAnimation } from './types';

export interface ButtonStateFlags {
	hovered: boolean;
	pressed: boolean;
	disabled: boolean;
	active: boolean;
	spinning: boolean;
}

/** The non-resting button states the cascade resolves, in priority order. The
 * resting state (`image` / `defaultAnimation`) is the caller's fallback, not a key. */
export type ButtonVisualState = 'spinning' | 'disabled' | 'pressed' | 'hover' | 'selected';

/**
 * The shared button-state cascade, parameterised over the looked-up value type so
 * BOTH state flavours (per-state IMAGE and per-state spine ANIMATION) resolve through
 * ONE function and can't drift. `get(state)` returns the authored value for a state
 * (or `undefined` when that state is unmapped). Cascade: spinning → disabled →
 * pressed (→hover→selected) → hovered (→selected) → active(selected). Returns
 * `undefined` when the current state has nothing authored — the caller keeps its
 * resting value.
 *
 * `spinning` is checked FIRST because a single bet's roll sets BOTH `spinning` and
 * `disabled` (the button is inert while one spin rolls) and the spinning visual must
 * win over the downstate.
 */
export function resolveButtonState<T>(
	get: (state: ButtonVisualState) => T | undefined,
	state: ButtonStateFlags,
): T | undefined {
	if (state.spinning) return get('spinning');
	if (state.disabled) return get('disabled');
	const selected = state.active ? get('selected') : undefined;
	if (state.pressed) return get('pressed') ?? get('hover') ?? selected;
	if (state.hovered) return get('hover') ?? selected;
	return selected;
}

/** The `button` def's state-image param keys (resting + the five states). */
export const BUTTON_STATE_IMAGE_KEYS = [
	'image',
	'imageHover',
	'imagePressed',
	'imageSelected',
	'imageDisabled',
	'imageSpinning',
] as const;

/** State → the `image*` param key that holds its frame ref. */
const IMAGE_KEY: Record<ButtonVisualState, string> = {
	spinning: 'imageSpinning',
	disabled: 'imageDisabled',
	pressed: 'imagePressed',
	hover: 'imageHover',
	selected: 'imageSelected',
};

function imageParam(params: Record<string, unknown>, key: string): string | undefined {
	const value = params[key];
	return typeof value === 'string' && value !== '' ? value : undefined;
}

export function resolveButtonStateImage(
	params: Record<string, unknown>,
	state: ButtonStateFlags,
): string | undefined {
	return resolveButtonState((s) => imageParam(params, IMAGE_KEY[s]), state);
}

/**
 * The spine-animation sibling of {@link resolveButtonStateImage}: resolve the current
 * interaction state to a `{ animation, loop }` from the node's `stateAnimations` map,
 * through the SAME cascade. An entry with an empty `animation` normalises to unset (a
 * cleared editor field behaves like an absent state). Returns `undefined` when the
 * current state maps to nothing — the caller falls back to `defaultAnimation`.
 */
export function resolveButtonStateAnimation(
	anims: ButtonStateAnimations | undefined,
	state: ButtonStateFlags,
): SpineStateAnimation | undefined {
	if (!anims) return undefined;
	return resolveButtonState((s) => {
		const entry = anims[s];
		return entry && entry.animation ? entry : undefined;
	}, state);
}
