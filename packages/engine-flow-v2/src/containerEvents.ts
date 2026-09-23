/**
 * Invisible Flow v2 — container-scoped component events (schema §6.1, decision #6). A container
 * SURFACES its components' CONFIGURED events as exec-out pins: the exec-out mirror of cue aggregation.
 *
 * `deriveContainerEvents` is the anti-drift deriver (same rule as `derivePins`): it turns the
 * Scene-Editor's configured components into `ContainerEventDecl[]`, never auto-dumping. A component
 * whose `event` is undefined/empty (a decorative sprite, or a button with nothing wired) yields NO
 * decl; a configured one yields exactly one `<componentId>.on<Event>` entry. The set is a 1:1 readout
 * of what the game can actually do — the flow decides only WHEN each fires.
 *
 * It stays DECOUPLED from Scene-Editor internals: it accepts the minimal structural
 * `ConfiguredComponentEvent` shape (componentId + optional configured event + optional payload), not
 * a full Scene-Editor component, so the editor projects its components down to this before calling in.
 */

import {
	REPEATER_SELECT_EVENT,
	REPEATER_SELECTED_ID,
	REPEATER_SELECTED_KEY,
	REPEATER_SELECTED_VALUE,
} from 'constants-shared/repeater';

import type { ContainerEventDecl, ParamDecl } from './types';

/**
 * The minimal projection of a Scene-Editor component this deriver reads: its stable id, the event it
 * is configured to fire (absent/empty ⇒ nothing wired), and any payload that event carries.
 */
export interface ConfiguredComponentEvent {
	componentId: string;
	event?: string; // the configured action/intent; undefined/empty ⇒ contributes no decl.
	payload?: ParamDecl[]; // data-outs; usually empty.
}

/**
 * Project a `repeater` node into its `ConfiguredComponentEvent` — the SINGLE fused `select` decl the
 * whole list contributes (N items → one pin), carrying the selected item's data-outs. This is the
 * repeater analogue of a button projecting its `action` binding: a `repeater` has no per-item
 * `action` param, so the Scene→decl projection recognises it by kind and calls in here. The runtime
 * seeds the pressed item as the fired event's trigger payload (see `constants-shared/repeater`), so
 * each data-out resolves to what was picked.
 *
 * THREE data-outs, because one repeater now serves several lists: `betModeKey` and `selectedKey` are
 * the same string under a legacy and a generic name (buy-feature docs hold edges to the first;
 * `selectBetMode` reads it unmapped), and `selectedValue` is the item's NUMBER — a bet amount, an
 * autoplay count — which is what a numeric action (`setBetAmount`) needs and a string key cannot
 * give. All three are declared unconditionally: the projection is STATIC (it reads the doc) while the
 * items are a live registry read, so which ones actually carry a value is only knowable at runtime.
 * An author wiring `selectedValue` off a key-only source just gets nothing.
 *
 * `string` (not a bet-mode enum) by design: the item set is a live registry read at RUNTIME
 * (`registerRepeaterSources`), so no enum is available at vocab-build time — the whitelisted-accessor
 * bound stays intact without inventing a type.
 */
export const repeaterSelectConfiguredEvent = (componentId: string): ConfiguredComponentEvent => ({
	componentId,
	event: REPEATER_SELECT_EVENT,
	payload: [
		{
			name: REPEATER_SELECTED_KEY,
			type: { t: 'string' },
			description: 'The selected card key (a bet-mode key for the buy-feature menu).',
		},
		{
			name: REPEATER_SELECTED_ID,
			type: { t: 'string' },
			description: 'The selected card key — the same string, under a list-agnostic name.',
		},
		{
			name: REPEATER_SELECTED_VALUE,
			type: { t: 'float' },
			description:
				'The selected card as a NUMBER (bet amount, autoplay count, limit multiplier). Empty for a list whose items are names.',
		},
	],
});

/**
 * Project a component INSTANCE's DECLARED signals into `ConfiguredComponentEvent[]` — one decl per
 * signal the referenced def exposes (`ComponentDef.signals`), keyed by the placed instance's node id.
 * The generic container-event source for a MULTI-signal component: the confirm dialog's
 * `confirm`/`cancel` buttons (`CONFIRM_DIALOG_DEF.signals`) each fuse into a `<id>.onConfirm` /
 * `<id>.onCancel` exec-out, exactly the way a button's `action` binding fuses into `<id>.onSpin` and a
 * repeater's whole list fuses into `<id>.onSelect`. No special-casing of `confirm`/`cancel` by name —
 * ANY def's declared signals project — so a downstream author can wire any two-or-more-button
 * component's presses without an engine change. Payload-less by design (a button press carries no
 * selection); a component whose signal SHOULD carry data (like the repeater's `betModeKey`) projects
 * through its own dedicated helper instead. A def with no signals ⇒ `[]` ⇒ no decls (parity).
 */
export const componentSignalConfiguredEvents = (
	componentId: string,
	signalKeys: readonly string[],
): ConfiguredComponentEvent[] => signalKeys.map((event) => ({ componentId, event }));

const capitalize = (s: string): string =>
	s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The fused exec-out pin's LABEL — the `on<Event>` tail (stable regardless of which component owns it).
 * The SINGLE source of the label format, shared by the deriver (surfacing the pin) and the runtime
 * (firing it) so the two can never drift.
 */
export const containerEventPinLabel = (event: string): string => `on${capitalize(event)}`;

/**
 * The fused exec-out pin's DECL ID — fully-qualified (`<componentId>.on<Event>`) so it is unique on the
 * `showContainer` node. The SINGLE source of the id format, shared by the deriver + the runtime.
 */
export const containerEventDeclId = (componentId: string, event: string): string =>
	`${componentId}.${containerEventPinLabel(event)}`;

/**
 * Turn a container's configured components into its aggregated `ContainerEventDecl[]`. Components with
 * no configured `event` are excluded (never auto-dumped); a configured one becomes
 * `{ id: '<componentId>.on<Event>', componentId, event, label: 'on<Event>', payload }`.
 * The `label` is the fused exec-out pin's caption (the `on<Event>` tail, stable regardless of which
 * component owns it); the `id` stays fully-qualified so the pin is unique on the `showContainer` node.
 *
 * DE-DUPE by decl `id`: two configured events can resolve to the SAME fused pin — a `repeater` node
 * projects its canonical `<id>.onSelect` (WITH a `betModeKey` data-out), and the SAME node's item
 * component (`featureCard`) also declares a `select` signal that would otherwise surface a second,
 * PAYLOAD-LESS `<id>.onSelect`. Showing both is confusing and wiring the wrong (payload-less) one
 * silently breaks the press. Keep exactly one per id, PREFERRING the decl that carries a payload (the
 * repeater's fused pin), so only the canonical `onSelect` (+`betModeKey`) is projected. A single
 * unambiguous configured event (every button, the confirm dialog's `confirm`/`cancel`) is untouched
 * — parity.
 */
export const deriveContainerEvents = (
	components: ConfiguredComponentEvent[],
): ContainerEventDecl[] => {
	const byId = new Map<string, ContainerEventDecl>();
	for (const c of components) {
		if (!c.event) continue; // no configured event ⇒ contributes no decl (never auto-dumped).
		const decl: ContainerEventDecl = {
			id: containerEventDeclId(c.componentId, c.event),
			componentId: c.componentId,
			event: c.event,
			label: containerEventPinLabel(c.event),
			payload: c.payload,
		};
		const existing = byId.get(decl.id);
		// First one wins UNLESS a later decl carries a payload the earlier one lacked (the repeater's
		// fused pin beats a payload-less same-name component signal, regardless of author order).
		if (!existing || (!existing.payload?.length && decl.payload?.length)) byId.set(decl.id, decl);
	}
	return [...byId.values()];
};
