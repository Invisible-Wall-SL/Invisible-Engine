import type { Scene } from 'engine-layout';
import { actionBindingOf, BUILTIN_COMPONENTS } from 'engine-layout';
import {
	deriveContainerEvents,
	repeaterSelectConfiguredEvent,
	type ConfiguredComponentEvent,
	type ContainerEventDecl,
	type FlowDoc,
} from 'engine-flow-v2';

/**
 * The SCENE facts a v2 FlowDoc cannot answer on its own, projected in from the project's LayoutDoc.
 * One home for them, because two readers must agree exactly: the `/flow-v2` editor loader (live
 * Validation panel) and the publish gate (`flowV2Validation.ts`). If they drifted, a flow could be
 * green in the editor and refused at publish, or the other way round.
 */

/**
 * CONTAINER SYNC — the flow can show/hide any SCENE, so every Scene-Editor screen is a container.
 * The doc's `containers` were seeded once (the v1→v2 migration froze the then-current screens), so a
 * screen AUTHORED LATER (e.g. "Background") would otherwise never appear in the flow. Appends any
 * scene missing from `containers` (id = sceneId; a placeholder z after the last — the runtime
 * re-derives the real z from the Scene-Editor order, so this z is only a tiebreak). MUTATES `doc`.
 *
 * A `space:'background'` scene is a container like any other: under a screen-driving flow its space
 * is only the coordinate frame (cover-fit to the window), and the flow alone decides when it is on
 * screen (owner direction 2026-09-02), so it MUST be offered for show/hide.
 */
export function syncFlowContainers(doc: FlowDoc, scenes: readonly Scene[]): void {
	const seen = new Set(doc.containers.map((c) => c.sceneId));
	let z = doc.containers.reduce((m, c) => Math.max(m, c.z), 0);
	for (const scene of scenes) {
		if (seen.has(scene.id)) continue;
		z += 10;
		doc.containers.push({ id: scene.id, sceneId: scene.id, z });
	}
}

/**
 * §6.1 — the container-event surface, keyed by ContainerId. For each container, find its
 * Scene-Editor scene by `sceneId`, project the scene's nodes down to the minimal
 * `ConfiguredComponentEvent` shape, then aggregate via `deriveContainerEvents`. The fused
 * `showContainer` node reads its container's decls from this surface (`derivePins`). Best-effort: a
 * project with no scenes yields an empty map.
 */
export function projectContainerEvents(
	containers: FlowDoc['containers'],
	scenes: readonly Scene[],
): Record<string, ContainerEventDecl[]> {
	const scenesById = new Map(scenes.map((s) => [s.id, s]));
	const containerEvents: Record<string, ContainerEventDecl[]> = {};
	for (const container of containers) {
		const scene = scenesById.get(container.sceneId);
		if (!scene) continue;
		const configured: ConfiguredComponentEvent[] = (scene.nodes ?? []).flatMap((node) => {
			// A `repeater` node projects the SINGLE fused `onSelect` decl for the whole list (N cards → one
			// pin), carrying the selected item's `betModeKey` — it has no per-item `action` param, so it is
			// recognised by kind (`repeaterSelectConfiguredEvent`, the deriver's single source of that shape).
			if ((node as { kind?: string }).kind === 'repeater') {
				const canonical = repeaterSelectConfiguredEvent(node.id);
				const repeaterEvents: ConfiguredComponentEvent[] = [canonical];
				// The repeater's ITEM component may declare OTHER signals worth surfacing (a richer,
				// multi-action card), but its `select` signal IS the repeater's canonical fused `onSelect`
				// (+`betModeKey`) — so SUPPRESS that duplicate here (its event equals `canonical.event`),
				// else the `showContainer` node shows TWO `onSelect` pins and wiring the payload-less one
				// silently breaks the card press. (The `deriveContainerEvents` de-dupe is the deeper safety
				// net; this keeps the surface clean.)
				const itemId = (node as { componentId?: string }).componentId;
				const itemDef = itemId ? BUILTIN_COMPONENTS.find((d) => d.id === itemId) : undefined;
				for (const signal of itemDef?.signals ?? []) {
					if (signal.key === canonical.event) continue;
					repeaterEvents.push({ componentId: node.id, event: signal.key });
				}
				return repeaterEvents;
			}
			const events: ConfiguredComponentEvent[] = [];
			// The universal `action` binding lives on `node.params` for ANY instance (not only a def that
			// declares it — see engine-layout `engineBindings.ts`); only `componentInstance` nodes type it,
			// so read it off a widened shape. Empty/absent action ⇒ no configured event ⇒ no decl.
			const params = (node as { params?: Record<string, unknown> }).params ?? {};
			const action = actionBindingOf(params);
			if (action) events.push({ componentId: node.id, event: action });
			// A component's DECLARED signals ALSO project — one fused pin per signal — so a multi-button
			// component surfaces every press it exposes (the confirm dialog's `confirm`/`cancel`, generic
			// over any def's `signals`, never special-cased by name). Resolved from the BUILT-IN defs
			// synchronously; a CUSTOM (R2) component's signals are not yet projected here (the loader would
			// need to resolve its def) — a follow-up, flagged in the buy-flow work.
			const componentId = (node as { componentId?: string }).componentId;
			if ((node as { kind?: string }).kind === 'componentInstance' && componentId) {
				const def = BUILTIN_COMPONENTS.find((d) => d.id === componentId);
				for (const signal of def?.signals ?? []) {
					if (!events.some((e) => e.event === signal.key)) {
						events.push({ componentId: node.id, event: signal.key });
					}
				}
			}
			return events;
		});
		containerEvents[container.id] = deriveContainerEvents(configured);
	}
	return containerEvents;
}
