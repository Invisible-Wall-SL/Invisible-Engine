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
 *
 * Since slam-stop the spinning button is no longer inert — it is a live STOP —
 * so it needs its own hover/press feedback. Those are DEDICATED states
 * (`imageSpinningHover`, `imageSpinningPressed`) rather than a reuse of
 * `imageHover`/`imagePressed`: the resting frames depict SPIN, and showing them
 * over a STOP button would change the look of already-authored buttons. Unset ⇒
 * the plain spinning frame, i.e. byte-identical to before.
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
export type ButtonVisualState =
	| 'spinning'
	| 'spinningHover'
	| 'spinningPressed'
	| 'disabled'
	| 'pressed'
	| 'hover'
	| 'selected';

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
 * win over the downstate. Within it, the slam-stop button's own hover/press states
 * fall back to the plain spinning frame when unauthored.
 */
export function resolveButtonState<T>(
	get: (state: ButtonVisualState) => T | undefined,
	state: ButtonStateFlags,
): T | undefined {
	if (state.spinning) {
		if (state.pressed) return get('spinningPressed') ?? get('spinning');
		if (state.hovered) return get('spinningHover') ?? get('spinning');
		return get('spinning');
	}
	if (state.disabled) return get('disabled');
	const selected = state.active ? get('selected') : undefined;
	if (state.pressed) return get('pressed') ?? get('hover') ?? selected;
	if (state.hovered) return get('hover') ?? selected;
	return selected;
}

/**
 * THE single source of truth for the button's non-resting VISUAL STATES, in the
 * order the editor lists them (hover → pressed → selected → downstate → spinning →
 * stop hover → stop pressed). The resting state (`image` / `defaultAnimation`) is
 * the caller's fallback, not an entry here. Both authoring surfaces — the per-state
 * IMAGE picker AND the per-state spine ANIMATION picker — derive their lists from
 * this array so a newly added state can't reach one surface without the other
 * (8a2573a added the three `imageSpinning*` states to the cascade + built-in def but
 * MISSED the authored-def picker; the anim UI in turn lacked the two `spinning*`
 * feedback states even though the runtime cascade played them). `label` is the
 * editor field name; `key` is the cascade {@link ButtonVisualState}.
 *
 * Every entry's `key` is exactly one {@link ButtonVisualState}, and the set of keys
 * is exactly the states {@link resolveButtonState} resolves — a Node fixture proves
 * both by driving the cascade over all flag combinations.
 */
export const BUTTON_VISUAL_STATES: readonly { key: ButtonVisualState; label: string }[] = [
	{ key: 'hover', label: 'hover' },
	{ key: 'pressed', label: 'pressed' },
	{ key: 'selected', label: 'selected' },
	{ key: 'disabled', label: 'downstate' },
	{ key: 'spinning', label: 'spinning' },
	{ key: 'spinningHover', label: 'stop hover' },
	{ key: 'spinningPressed', label: 'stop pressed' },
];

/** A visual state's `image*` param key (`hover` → `imageHover`, `spinningPressed` →
 * `imageSpinningPressed`). The resting frame is the bare `image` param. */
function imageKeyOf(state: ButtonVisualState): string {
	return `image${state[0].toUpperCase()}${state.slice(1)}`;
}

/**
 * The button's state-image params — the resting frame (`image`) plus the seven
 * interaction states, in the order the editor lists them. THE single source for
 * the three IMAGE surfaces that must agree, each of which DERIVES from this array so
 * a newly added state can't be offered-but-not-rendered or rendered-but-not-offered
 * (8a2573a added the three `imageSpinning*` states to the cascade + built-in def
 * but MISSED the authored-def picker, making the STOP look impossible to author):
 * - {@link BUTTON_STATE_IMAGE_KEYS} — the cascade's key list (below);
 * - the built-in `button` def's inline state-image params (`builtinComponents.ts`);
 * - `BUTTON_STATE_PARAMS` (`componentCatalog.ts`) — the authored-def picker.
 * `label` is the editor field name; `key` is the stored `image*` param. Derived from
 * {@link BUTTON_VISUAL_STATES} (prefixing the resting `image` entry) so the image and
 * animation authoring surfaces share ONE ordered list of states.
 */
export const BUTTON_STATE_IMAGE_PARAMS: readonly { key: string; label: string }[] = [
	{ key: 'image', label: 'normal' },
	...BUTTON_VISUAL_STATES.map((s) => ({ key: imageKeyOf(s.key), label: s.label })),
];

/** The `button` def's state-image param keys (resting + the seven states), derived
 * from {@link BUTTON_STATE_IMAGE_PARAMS} so the key list can't drift from it. */
export const BUTTON_STATE_IMAGE_KEYS: readonly string[] = BUTTON_STATE_IMAGE_PARAMS.map(
	(p) => p.key,
);

/** State → the `image*` param key that holds its frame ref, derived from
 * {@link BUTTON_VISUAL_STATES} so it can't drift from the shared state list. */
const IMAGE_KEY = Object.fromEntries(
	BUTTON_VISUAL_STATES.map((s) => [s.key, imageKeyOf(s.key)]),
) as Record<ButtonVisualState, string>;

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
