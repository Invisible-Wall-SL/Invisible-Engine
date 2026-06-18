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

export interface ButtonStateFlags {
	hovered: boolean;
	pressed: boolean;
	disabled: boolean;
	active: boolean;
	spinning: boolean;
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

function imageParam(params: Record<string, unknown>, key: string): string | undefined {
	const value = params[key];
	return typeof value === 'string' && value !== '' ? value : undefined;
}

export function resolveButtonStateImage(
	params: Record<string, unknown>,
	state: ButtonStateFlags,
): string | undefined {
	if (state.spinning) return imageParam(params, 'imageSpinning');
	if (state.disabled) return imageParam(params, 'imageDisabled');
	const selected = state.active ? imageParam(params, 'imageSelected') : undefined;
	if (state.pressed) {
		return imageParam(params, 'imagePressed') ?? imageParam(params, 'imageHover') ?? selected;
	}
	if (state.hovered) return imageParam(params, 'imageHover') ?? selected;
	return selected;
}
