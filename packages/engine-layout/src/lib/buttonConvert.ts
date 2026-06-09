import type { ComponentInstanceNode, ContainerNode } from './types';

/**
 * Single source of truth for the HUD button cluster's `bind.component` →
 * `componentInstance(button)` `params` mapping (§16 B6). Each coded
 * `UiButton*` `bind` maps to the `{ action, icon? }` the matching
 * `Button*.svelte` passes to `UiButton`:
 * - menu/buy-bonus/auto-spin/turbo/decrease/increase pass an `icon` equal to
 *   their `action`,
 * - the spin button (`UiButtonBet`) passes NO `icon` — its caption is the
 *   action's dynamic `label` (bet↔stop).
 *
 * Consumed BOTH by `referenceLayouts/hud.ts` (so the seeded parametric buttons
 * and this convert affordance can't drift) and by the editor's "Convert to
 * parametric button" handler.
 */
export const HUD_BUTTON_ACTION_MAP: Record<string, { action: string; icon?: string }> = {
	UiButtonMenu: { action: 'menu', icon: 'menu' },
	UiButtonBuyBonus: { action: 'buyBonus', icon: 'buyBonus' },
	UiButtonAutoSpin: { action: 'autoSpin', icon: 'autoSpin' },
	UiButtonBet: { action: 'spin' },
	UiButtonTurbo: { action: 'turbo', icon: 'turbo' },
	UiButtonDecrease: { action: 'decrease', icon: 'decrease' },
	UiButtonIncrease: { action: 'increase', icon: 'increase' },
};

/** True iff `component` is a known HUD button `bind.component` (a map key). */
export function isHudButtonBind(component: string | undefined): boolean {
	return component !== undefined && component in HUD_BUTTON_ACTION_MAP;
}

/**
 * Convert a HUD button `bind` container into the parametric
 * `componentInstance(button)` node the `button` ComponentDef expands. PRESERVES
 * the source transform byte-for-byte (id / label / x / y / anchor / scale /
 * overrides / zIndex / slotId / preview) so the converted node lands in the
 * exact same spot the coded button sat (B6.4 parity flip). Returns `null` when
 * `node.bind?.component` isn't a known HUD button.
 */
export function buttonBindToInstance(node: ContainerNode): ComponentInstanceNode | null {
	const component = node.bind?.component;
	if (!isHudButtonBind(component)) return null;
	const { action, icon } = HUD_BUTTON_ACTION_MAP[component as string];
	const instance: ComponentInstanceNode = {
		id: node.id,
		kind: 'componentInstance',
		componentId: 'button',
		x: node.x,
		y: node.y,
		params: icon === undefined ? { action } : { action, icon },
	};
	if (node.label !== undefined) instance.label = node.label;
	if (node.anchor !== undefined) instance.anchor = node.anchor;
	if (node.scale !== undefined) instance.scale = node.scale;
	if (node.overrides !== undefined) instance.overrides = node.overrides;
	if (node.zIndex !== undefined) instance.zIndex = node.zIndex;
	if (node.slotId !== undefined) instance.slotId = node.slotId;
	if (node.preview !== undefined) instance.preview = node.preview;
	return instance;
}
