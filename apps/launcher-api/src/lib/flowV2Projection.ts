import type { ComponentDef, LayoutNode, Scene } from 'engine-layout';
import {
	actionBindingOf,
	BUILTIN_COMPONENTS,
	componentTriggers,
	flowInstanceInterface,
	isCountRepeater,
} from 'engine-layout';
import {
	deriveContainerEvents,
	repeaterSelectConfiguredEvent,
	type ConfiguredComponentEvent,
	type ContainerEventDecl,
	type FlowDoc,
	type FlowInstanceDecl,
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
				// A count-mode repeater (a segmented counter) draws N copies of a display: nothing to select.
				if (isCountRepeater(node)) return [];
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
				for (const signal of componentTriggers(itemDef)) {
					if (signal === canonical.event) continue;
					repeaterEvents.push({ componentId: node.id, event: signal });
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
			// over any def's trigger inputs — `signals` fold into them). Resolved from the BUILT-IN defs
			// synchronously; a CUSTOM (R2) component's signals are not yet projected here (the loader would
			// need to resolve its def) — a follow-up, flagged in the buy-flow work.
			const componentId = (node as { componentId?: string }).componentId;
			if ((node as { kind?: string }).kind === 'componentInstance' && componentId) {
				const def = BUILTIN_COMPONENTS.find((d) => d.id === componentId);
				for (const signal of componentTriggers(def)) {
					if (!events.some((e) => e.event === signal)) {
						events.push({ componentId: node.id, event: signal });
					}
				}
			}
			return events;
		});
		containerEvents[container.id] = deriveContainerEvents(configured);
	}
	return containerEvents;
}

/** Resolve a component def for a placed instance: the exact pinned version, or latest unpinned. */
export type ComponentDefResolver = (id: string, version?: number) => ComponentDef | undefined;

/**
 * A resolver over a list of defs (latest ones, plus any pinned versions the caller loaded): a pin
 * resolves only a def of THAT version — except a BUILT-IN, which has one coded version that
 * `loadComponent` hands back for any pin (the engine's `resolveComponent` flags the mismatch
 * separately); no pin resolves the highest version in the list.
 */
export function instanceDefResolver(defs: readonly ComponentDef[]): ComponentDefResolver {
	return (id, version) => {
		const ofId = defs.filter((def) => def.id === id);
		if (ofId.length === 0) return undefined;
		if (version === undefined) {
			return ofId.reduce((best, def) => (def.version > best.version ? def : best));
		}
		return (
			ofId.find((def) => def.version === version) ??
			(BUILTIN_COMPONENTS.some((def) => def.id === id) ? ofId[0] : undefined)
		);
	};
}

/**
 * §6.3 — the placed, NAMED component instances, keyed by the placed node's id → what Flow sees of
 * each (`FlowInstanceDecl`): its screen (the container whose scene holds it), its name, the pinned
 * def's interface (`flowInstanceInterface`), or `missing` when the def or the exact pinned version
 * cannot be resolved. Walks every container's scene tree (an instance inside a container node is
 * placed too). An instance with no name is not offered — a Flow wire needs something to call it.
 * The ONE projection the `/flow-v2` editor, the publish gate and the localization harvest share.
 */
export function projectFlowInstances(
	containers: FlowDoc['containers'],
	scenes: readonly Scene[],
	resolve: ComponentDefResolver,
): Record<string, FlowInstanceDecl> {
	const scenesById = new Map(scenes.map((s) => [s.id, s]));
	const instances: Record<string, FlowInstanceDecl> = {};
	const empty = { inputs: [], events: [], values: [] };
	for (const container of containers) {
		const scene = scenesById.get(container.sceneId);
		if (!scene) continue;
		const walk = (node: LayoutNode): void => {
			if (node.kind === 'componentInstance') {
				const name = typeof node.label === 'string' ? node.label.trim() : '';
				// First placement wins a duplicated id (the editor never mints one): the other placement
				// then reads as unplaced on its screen, which the validator reports.
				if (name && !instances[node.id]) {
					const def = resolve(node.componentId, node.componentVersion);
					const decl: FlowInstanceDecl = {
						container: container.id,
						instance: node.id,
						name,
						componentId: node.componentId,
						...(node.componentVersion !== undefined ? { version: node.componentVersion } : {}),
						interface: def ? flowInstanceInterface(def) : empty,
					};
					if (!def) decl.missing = resolve(node.componentId) ? 'version' : 'def';
					instances[node.id] = decl;
				}
			}
			const children = (node as { children?: LayoutNode[] }).children;
			if (Array.isArray(children)) children.forEach(walk);
		};
		(scene.nodes ?? []).forEach(walk);
	}
	return instances;
}

/**
 * The projection a flow naming no instance loads with: the LATEST defs only (no pinned snapshot is
 * read). A placement pinned below latest then has no exact interface yet — it is marked `unpinned`
 * with the latest def's interface standing in, rather than `missing: 'version'`, so the palette and
 * a freshly dropped node show no warning and the page marks nothing stale; it re-reads the exact
 * pins the moment a node names a placement. `latestOf` resolves a component id to its latest def.
 */
export function unpinnedProjection(
	instances: Record<string, FlowInstanceDecl>,
	latestOf: (componentId: string) => ComponentDef | undefined,
): Record<string, FlowInstanceDecl> {
	return Object.fromEntries(
		Object.entries(instances).map(([id, decl]) => {
			if (decl.missing !== 'version') return [id, decl];
			const { missing: _missing, ...rest } = decl;
			const latest = latestOf(decl.componentId);
			return [
				id,
				{
					...rest,
					interface: latest ? flowInstanceInterface(latest) : rest.interface,
					unpinned: true,
				},
			];
		}),
	);
}
