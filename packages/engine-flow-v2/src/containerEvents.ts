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

const capitalize = (s: string): string => (s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1));

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
 */
export const deriveContainerEvents = (
	components: ConfiguredComponentEvent[],
): ContainerEventDecl[] =>
	components
		.filter((c): c is ConfiguredComponentEvent & { event: string } => !!c.event)
		.map((c) => ({
			id: containerEventDeclId(c.componentId, c.event),
			componentId: c.componentId,
			event: c.event,
			label: containerEventPinLabel(c.event),
			payload: c.payload,
		}));
