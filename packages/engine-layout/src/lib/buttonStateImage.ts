/**
 * Shared button STATE-IMAGE cascade — ONE resolution used by BOTH button
 * flavours so they can't drift:
 * - the coded-frame button (`ButtonFrame.svelte` in components-ui-pixi), and
 * - an AUTHORED art button (sprite+text def with no coded part), where
 *   `<ComponentInstance>`'s interactive wrapper owns hover/press and overrides
 *   the `image` param with the resolved state image (the def's bg sprite binds
 *   `region` → `image`).
 *
 * Cascade: an AUTHORED pressed frame → spinning (`imageSpinning`, the
 * round-in-progress frame the engine rotates) → disabled (`imageDisabled`, the
 * downstate) → pressed fallback (hover, then selected while active) → hovered
 * (`imageHover`, falls back to selected while active) → active
 * (`imageSelected`). Returns `undefined` when the current state has no authored
 * image — the caller keeps its resting look (`image` param / tile). Empty
 * strings normalize to unset so a cleared editor field behaves like an absent
 * param.
 *
 * `spinning` outranks `disabled` because a single bet's roll can set BOTH (the
 * rotating spin frame must win over the downstate grey), but an authored
 * `imagePressed` outranks `spinning`: with slam stop always on, the spin button
 * is a live STOP mid-roll and its press needs a visible downstate. Only when
 * authored — a button with no pressed frame resolves exactly as before.
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
 * (or `undefined` when that state is unmapped). Cascade: authored pressed →
 * spinning → disabled → pressed fallback (hover→selected) → hovered (→selected) →
 * active(selected). Returns `undefined` when the current state has nothing authored
 * — the caller keeps its resting value.
 *
 * `spinning` outranks `disabled` because a single bet's roll can set BOTH and the
 * spinning visual must win over the downstate. An AUTHORED pressed value outranks
 * `spinning` in turn: since slam stop is always on the spin button is a live STOP
 * while the reels roll, and without this the spin frame swallows the press so the
 * slam has no visual feedback and `imagePressed` is unreachable mid-round. Gated on
 * the value actually being authored, so a button with no pressed value keeps the
 * previous resolution exactly. `disabled` still suppresses it — a downstate button
 * must never look pressed (both callers already clear `pressed` when disabled).
 */
export function resolveButtonState<T>(
	get: (state: ButtonVisualState) => T | undefined,
	state: ButtonStateFlags,
): T | undefined {
	if (state.pressed && !state.disabled) {
		const pressed = get('pressed');
		if (pressed !== undefined) return pressed;
	}
	if (state.spinning) return get('spinning');
	if (state.disabled) return get('disabled');
	const selected = state.active ? get('selected') : undefined;
	if (state.pressed) return get('hover') ?? selected;
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

/**
 * Overlay a per-instance {@link ButtonStateAnimations} override on the def's base
 * map — a PER-STATE replace: an overridden state wins outright, an absent state
 * inherits the base. An override entry with an empty `animation` clears that state
 * for the instance (the cascade then skips it, exactly like a cleared editor
 * field). Returns `undefined` when the merged result is empty so a button with
 * neither a def map nor an override stays byte-identical to today. Used by
 * `<ComponentInstance>` so a placement can drive different state animations than
 * the def declares (the spine analogue of overriding `imageHover`/… per instance).
 */
export function mergeButtonStateAnimations(
	base: ButtonStateAnimations | undefined,
	override: ButtonStateAnimations | undefined,
): ButtonStateAnimations | undefined {
	if (!override) return base;
	const merged: ButtonStateAnimations = { ...(base ?? {}), ...override };
	return Object.keys(merged).length ? merged : undefined;
}
