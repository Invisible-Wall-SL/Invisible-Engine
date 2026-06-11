/**
 * Shared button STATE-IMAGE cascade — ONE resolution used by BOTH button
 * flavours so they can't drift:
 * - the coded-frame button (`ButtonFrame.svelte` in components-ui-pixi), and
 * - an AUTHORED art button (sprite+text def with no coded part), where
 *   `<ComponentInstance>`'s interactive wrapper owns hover/press and overrides
 *   the `image` param with the resolved state image (the def's bg sprite binds
 *   `region` → `image`).
 *
 * Cascade: disabled (`imageDisabled`, the downstate) → pressed (`imagePressed`,
 * falls back to hover, then to selected while active) → hovered (`imageHover`,
 * falls back to selected while active) → active (`imageSelected`). Returns
 * `undefined` when the current state has no authored image — the caller keeps
 * its resting look (`image` param / tile). Empty strings normalize to unset so
 * a cleared editor field behaves like an absent param.
 */

export interface ButtonStateFlags {
	hovered: boolean;
	pressed: boolean;
	disabled: boolean;
	active: boolean;
}

/** The `button` def's state-image param keys (resting + the four states). */
export const BUTTON_STATE_IMAGE_KEYS = [
	'image',
	'imageHover',
	'imagePressed',
	'imageSelected',
	'imageDisabled',
] as const;

function imageParam(params: Record<string, unknown>, key: string): string | undefined {
	const value = params[key];
	return typeof value === 'string' && value !== '' ? value : undefined;
}

export function resolveButtonStateImage(
	params: Record<string, unknown>,
	state: ButtonStateFlags,
): string | undefined {
	if (state.disabled) return imageParam(params, 'imageDisabled');
	const selected = state.active ? imageParam(params, 'imageSelected') : undefined;
	if (state.pressed) {
		return imageParam(params, 'imagePressed') ?? imageParam(params, 'imageHover') ?? selected;
	}
	if (state.hovered) return imageParam(params, 'imageHover') ?? selected;
	return selected;
}
