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
 * Turn a container's configured components into its aggregated `ContainerEventDecl[]`. Components with
 * no configured `event` are excluded (never auto-dumped); a configured one becomes
 * `{ id: '<componentId>.on<Event>', componentId, event, payload }`.
 */
export const deriveContainerEvents = (
	components: ConfiguredComponentEvent[],
): ContainerEventDecl[] =>
	components
		.filter((c): c is ConfiguredComponentEvent & { event: string } => !!c.event)
		.map((c) => ({
			id: `${c.componentId}.on${capitalize(c.event)}`,
			componentId: c.componentId,
			event: c.event,
			payload: c.payload,
		}));
