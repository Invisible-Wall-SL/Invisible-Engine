import {
	instanceEventFieldOf,
	instanceEventOf,
	instanceInputOf,
	instanceTriggerOf,
	instanceValueOf,
	type FlowInstanceDecl,
	type Graph,
	type Pin,
} from 'engine-flow-v2';
import { componentsHref } from './componentLinks';

/**
 * The `/flow-v2` editor's placed-instance helpers (Rive plan §6.2, Phase 7b), pure so the gate
 * drives them: the palette's per-screen groups, the stale pins a node still has wires to, and
 * the deep links between Flow and the Scene Editor — every one carrying the project pin
 * (`?project=`, the Phase 4a lesson: a same-route navigation that names no project falls back to
 * the session's, which another tab may have moved).
 */

export interface PaletteInstanceGroup {
	container: string;
	label: string;
	instances: FlowInstanceDecl[];
}

/** The placed instances per screen, screens in `containerOrder`, instances by name. */
export function paletteInstanceGroups(
	instances: Record<string, FlowInstanceDecl>,
	containerOrder: readonly string[],
	containerLabel: (container: string) => string,
): PaletteInstanceGroup[] {
	const byContainer = new Map<string, FlowInstanceDecl[]>();
	for (const decl of Object.values(instances)) {
		const list = byContainer.get(decl.container);
		if (list) list.push(decl);
		else byContainer.set(decl.container, [decl]);
	}
	const order = [
		...containerOrder.filter((c) => byContainer.has(c)),
		...[...byContainer.keys()].filter((c) => !containerOrder.includes(c)),
	];
	return order.map((container) => ({
		container,
		label: containerLabel(container),
		instances: [...byContainer.get(container)!].sort((a, b) => a.name.localeCompare(b.name)),
	}));
}

export interface StalePin {
	id: string;
	kind: 'exec' | 'data';
}

/**
 * The pins of `nodeId` that a wire still names but the node no longer derives (the component lost
 * the input, event or value). The canvas renders each as a red placeholder pin, so xyflow has a
 * handle to draw the wire to and the author sees exactly what broke instead of a wire that
 * silently vanished.
 */
export function stalePinsOf(
	graph: Graph,
	nodeId: string,
	pins: readonly Pin[],
): { in: StalePin[]; out: StalePin[] } {
	const has = (id: string, dir: 'in' | 'out', kind: 'exec' | 'data'): boolean =>
		pins.some((p) => p.id === id && p.dir === dir && p.kind === kind);
	const out: { in: StalePin[]; out: StalePin[] } = { in: [], out: [] };
	const add = (list: StalePin[], id: string, kind: 'exec' | 'data'): void => {
		if (!list.some((p) => p.id === id)) list.push({ id, kind });
	};
	for (const e of graph.exec) {
		if (e.from.node === nodeId && !has(e.from.pin, 'out', 'exec')) add(out.out, e.from.pin, 'exec');
		if (e.to.node === nodeId && !has(e.to.pin, 'in', 'exec')) add(out.in, e.to.pin, 'exec');
	}
	for (const e of graph.data) {
		if (e.from.node === nodeId && !has(e.from.pin, 'out', 'data')) add(out.out, e.from.pin, 'data');
		if (e.to.node === nodeId && !has(e.to.pin, 'in', 'data')) add(out.in, e.to.pin, 'data');
	}
	return out;
}

/** A readable caption for a stale instance pin id (`fire:win` → `▸ win`, `event:done.amount` →
 *  `done.amount`). Any other id reads as itself. */
export function stalePinLabel(pin: string): string {
	const trigger = instanceTriggerOf(pin);
	if (trigger !== undefined) return `▸ ${trigger}`;
	const field = instanceEventFieldOf(pin);
	if (field) return `${field.event}.${field.field}`;
	return instanceInputOf(pin) ?? instanceEventOf(pin) ?? instanceValueOf(pin) ?? pin;
}

export const FLOW_INSTANCE_PARAM = 'instance';

const withProject = (projectKey: string): URLSearchParams => {
	const params = new URLSearchParams();
	if (projectKey) params.set('project', projectKey);
	return params;
};

/**
 * Why a hop to the other tool is refused right now, or `null` when the doc is clean and idle. A
 * save landing over a later edit clears the shared `SaveState`'s dirty flag without it (fixed in
 * its own PR), so the only safe hop is from a clean, idle doc; every other state names the pill's
 * own way out.
 */
export function hopRefusal(save: {
	status: 'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'scope-mismatch';
	dirty: boolean;
	readOnly?: boolean;
}): string | null {
	if (save.readOnly) return 'Another author holds this document — Take over (or reload) first.';
	switch (save.status) {
		case 'saving':
			return 'Still saving — try again in a moment.';
		case 'conflict':
			return 'Someone else saved meanwhile — choose Reload theirs or Overwrite in the save pill first.';
		case 'scope-mismatch':
			return 'This tab is on another project — reload it first.';
		case 'error':
			return 'The last save failed — Retry in the save pill first.';
		default:
			return save.dirty
				? 'Your edits are not saved yet — they save in a moment; try again then.'
				: null;
	}
}

/** `/flow-v2` opened on the node(s) naming a placed instance — the Scene Editor's *Show in Flow*.
 *  With no such node yet, the page highlights the instance in the palette. */
export function flowHrefForInstance(projectKey: string, instanceId: string): string {
	const params = withProject(projectKey);
	params.set(FLOW_INSTANCE_PARAM, instanceId);
	return `/flow-v2?${params.toString()}`;
}

/** `/editor` opened on a component, in place — Flow's *Edit component*. */
export function editorHrefForComponent(projectKey: string, componentId: string): string {
	return componentsHref(componentId, withProject(projectKey));
}

/** The placed instance a `/flow-v2` URL asks the page to open on, if any. */
export function flowDeepLink(search: URLSearchParams): { instance?: string } {
	const instance = search.get(FLOW_INSTANCE_PARAM)?.trim();
	return instance ? { instance } : {};
}

/** The first `componentInstance` node naming `instanceId`, top-level in `graph` first, then
 *  inside its groups (the id to focus; a grouped one focuses its group). */
export function nodeNamingInstance(
	graph: Graph,
	instanceId: string,
): { node: string; group?: string } | undefined {
	for (const n of graph.nodes) {
		if (n.kind === 'componentInstance' && n.instance === instanceId) return { node: n.id };
	}
	for (const n of graph.nodes) {
		if (n.kind !== 'group') continue;
		const inner = nodeNamingInstance(n.body, instanceId);
		if (inner) return { node: inner.node, group: n.id };
	}
	return undefined;
}
