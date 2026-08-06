import type { ComponentInstanceNode, ContainerNode } from './types';

/**
 * Single source of truth for the HUD cluster's coded `bind.component` →
 * `componentInstance` conversion (§16 B6): the button map + converter below, and
 * the label/readout pair further down ({@link HUD_LABEL_SOURCE_MAP} /
 * {@link labelBindToInstance}). Each coded
 * `UiButton*` `bind` maps to the `{ action, icon? }` the matching
 * `Button*.svelte` passes to `UiButton`:
 * - menu/buy-bonus/auto-spin/turbo/decrease/increase pass an `icon` equal to
 *   their `action`,
 * - the spin button (`UiButtonBet`) passes NO `icon` — its caption is the
 *   action's dynamic `label` (bet↔stop).
 *
 * `visibleSource` (turbo / auto-spin only) is the config-feature store the parametric
 * instance gates its visibility on, so the button hides when the game config disables
 * that feature — parity with the coded `UIDefault` `{#if config.features.*}` wraps (the
 * other five buttons have no such coded gate). Kept HERE, on the single map, so the
 * seed (`referenceLayouts/hud.ts`), the editor "Convert to parametric" handler, and the
 * load-time default-HUD fallback ({@link buttonBindToInstance}) can't drift on the gate.
 *
 * Consumed BOTH by `referenceLayouts/hud.ts` (so the seeded parametric buttons
 * and this convert affordance can't drift) and by the editor's "Convert to
 * parametric button" handler.
 */
export const HUD_BUTTON_ACTION_MAP: Record<
	string,
	{ action: string; icon?: string; visibleSource?: string }
> = {
	UiButtonMenu: { action: 'menu', icon: 'menu' },
	UiButtonBuyBonus: { action: 'buyBonus', icon: 'buyBonus' },
	UiButtonAutoSpin: { action: 'autoSpin', icon: 'autoSpin', visibleSource: 'autoplayFeature' },
	UiButtonBet: { action: 'spin' },
	UiButtonTurbo: { action: 'turbo', icon: 'turbo', visibleSource: 'turboFeature' },
	UiButtonDecrease: { action: 'decrease', icon: 'decrease' },
	UiButtonIncrease: { action: 'increase', icon: 'increase' },
};

/** True iff `component` is a known HUD button `bind.component` (a map key). */
export function isHudButtonBind(component: string | undefined): boolean {
	return component !== undefined && component in HUD_BUTTON_ACTION_MAP;
}

/**
 * The readout analogue of {@link HUD_BUTTON_ACTION_MAP}: each coded HUD label
 * `bind.component` (`UiLabelBalance`/`UiLabelWin`/`UiLabelBet`) → the live VALUE
 * `source` the `hudReadout` ComponentDef feeds its caption from (`balance`/`win`/
 * `bet`). Consumed by {@link labelBindToInstance}. NB: unlike the button map, this
 * doesn't yet fully unify the label side — the reference `readoutNode`
 * (`referenceLayouts/hud.ts`) still takes `source` as a literal arg and computes
 * `countUp: source === 'win'` inline, so that count-up rule lives in two places; keep
 * them in step (or wire `readoutNode` through this map) if it ever changes.
 */
export const HUD_LABEL_SOURCE_MAP: Record<string, 'balance' | 'win' | 'bet'> = {
	UiLabelBalance: 'balance',
	UiLabelWin: 'win',
	UiLabelBet: 'bet',
};

/** True iff `component` is a known HUD label `bind.component` (a map key). */
export function isHudLabelBind(component: string | undefined): boolean {
	return component !== undefined && component in HUD_LABEL_SOURCE_MAP;
}

/**
 * Convert a HUD label `bind` container into the parametric
 * `componentInstance(hudReadout)` node the `hudReadout` ComponentDef expands — the
 * label analogue of {@link buttonBindToInstance}. PRESERVES the source transform
 * byte-for-byte (id / label / x / y / anchor / scale / overrides / zIndex / slotId /
 * preview) so the converted readout lands in the exact spot the coded label sat. The
 * def MOUNTS the coded `HudReadout` (same stacked caption+value + currency format +
 * count-up), so it renders where the `UiLabel*` `bind` did — but through the generic
 * mounter, so it also shows under a flow-v2-driven game (where the coded `<UI>` that
 * was the `UiLabel*` binds' ONLY renderer is suppressed). Returns `null` when
 * `node.bind?.component` isn't a known HUD label. `countUp` is on only for `win`
 * (matching `LabelWin`'s tween; balance/bet snap), mirroring `readoutNode`.
 *
 * KNOWN LIMITATION (shared with {@link buttonBindToInstance}): only the node TRANSFORM
 * is carried, not `bind.props` — a legacy `UiLabel*` that an author restyled via
 * `bind.props.style` loses that styling on conversion (the `hudReadout` def's own style
 * applies). Acceptable for the seeded default (no per-node style), but re-map the
 * relevant `bind.props` here if authored label styling must survive.
 */
export function labelBindToInstance(node: ContainerNode): ComponentInstanceNode | null {
	const component = node.bind?.component;
	if (!isHudLabelBind(component)) return null;
	const source = HUD_LABEL_SOURCE_MAP[component as string];
	const instance: ComponentInstanceNode = {
		id: node.id,
		kind: 'componentInstance',
		componentId: 'hudReadout',
		x: node.x,
		y: node.y,
		params: { source, label: node.label ?? '', countUp: source === 'win' },
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
	const { action, icon, visibleSource } = HUD_BUTTON_ACTION_MAP[component as string];
	const instance: ComponentInstanceNode = {
		id: node.id,
		kind: 'componentInstance',
		componentId: 'button',
		x: node.x,
		y: node.y,
		// `visibleSource` (turbo / auto-spin) gates the instance on the config-feature store so it
		// hides exactly like the coded `UIDefault` `{#if config.features.*}` wrap (parity); the other
		// buttons have no such gate. Mirrors the reference `buttonInstanceNode`.
		params: {
			...(icon === undefined ? { action } : { action, icon }),
			...(visibleSource ? { visibleSource } : {}),
		},
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
