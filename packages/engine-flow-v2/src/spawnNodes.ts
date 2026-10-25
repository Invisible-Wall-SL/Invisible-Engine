/**
 * Invisible Flow v2 — the SPAWN nodes (`docs/design/game-families.md` §3.3): `spawn`, `despawn`,
 * `instanceRef`, a `waitForState` on a spawned instance, and the `$live.<layer>` accessor. The one
 * home of their pins and of the lookups the deriver, the validator and the runtime share, so the
 * three cannot drift. Type-only over the schema, like `instanceNodes.ts`.
 *
 * Pins:
 *  - spawn        exec `exec` in / out; data-ins `x`, `y` (float) or `col`, `row` (int, `at: 'cell'`);
 *                 data-outs `instance` (`instance<componentId>`) and `spawned` (bool).
 *  - despawn      exec `exec` in / out; data-in `instance`.
 *  - instanceRef  the component's interface (`deriveInstancePins`), plus the optional data-in
 *                 `instance` (the handle to address; blank in an event chain = the raising one) and
 *                 the data-out `handle` (the handle it addressed).
 *  - waitForState with `componentId`: exec in / out and the optional data-in `instance`.
 */

import { deriveInstancePins } from './instanceNodes';
import type {
	FlowDoc,
	FlowInstanceDecl,
	FlowSpawnLayerDecl,
	FlowSpawnableDecl,
	Graph,
	InstanceRefNode,
	Node,
	Pin,
	TypeRef,
} from './types';

/** The data-in an `instanceRef`, `despawn` or spawned `waitForState` takes its handle on. */
export const SPAWN_INSTANCE_PIN = 'instance';
/** The `instanceRef` data-out carrying the handle it addressed. */
export const INSTANCE_REF_HANDLE_PIN = 'handle';
/** The `$trigger` field a spawned instance's raised event carries its handle in. */
export const SPAWN_TRIGGER_INSTANCE = 'instance';

/** What a handle carries, as `$item.<field>` over a `$live` set and a `compute` member read it. */
export const INSTANCE_HANDLE_FIELDS: Readonly<Record<string, TypeRef>> = {
	id: { t: 'string' },
	layer: { t: 'string' },
	componentId: { t: 'string' },
	x: { t: 'float' },
	y: { t: 'float' },
	col: { t: 'int' },
	row: { t: 'int' },
};

/** The `instance<…>` type of a component's handle (any instance when `component` is absent). */
export const instanceType = (component?: string): TypeRef =>
	component ? { t: 'instance', component } : { t: 'instance' };

const EXEC_IN: Pin = { id: 'exec', dir: 'in', kind: 'exec' };
const EXEC_OUT: Pin = { id: 'exec', dir: 'out', kind: 'exec' };

const dataPin = (
	id: string,
	dir: 'in' | 'out',
	dataType: TypeRef,
	label: string,
	doc: string,
	optional?: boolean,
): Pin => ({ id, dir, kind: 'data', dataType, label, doc, ...(optional ? { optional } : {}) });

/** The lookup the spawn pins need: the projected spawn layers (absent ⇒ the layout is unknown). */
export interface SpawnPinContext {
	spawnLayers?: Record<string, FlowSpawnLayerDecl>;
}

/** The first layer's entry for `componentId` (every layer lists the same def under one id). */
export const spawnableDecl = (
	ctx: SpawnPinContext,
	componentId: string,
): FlowSpawnableDecl | undefined => {
	for (const layer of Object.values(ctx.spawnLayers ?? {})) {
		const found = layer.spawnable.find((s) => s.componentId === componentId);
		if (found) return found;
	}
	return undefined;
};

/** A spawnable as the instance-node deriver reads it. */
const asInstanceDecl = (
	componentId: string,
	spawnable: FlowSpawnableDecl | undefined,
): FlowInstanceDecl | undefined =>
	spawnable && {
		container: '',
		instance: '',
		name: componentId,
		componentId,
		interface: spawnable.interface,
		...(spawnable.missing ? { missing: spawnable.missing } : {}),
	};

/** The element type of `$live.<layer>`: one spawnable ⇒ its handle type, several ⇒ any instance. */
export const liveElementType = (ctx: SpawnPinContext, layer: string): TypeRef | undefined => {
	const decl = ctx.spawnLayers?.[layer];
	if (!decl) return undefined;
	const ids = [...new Set(decl.spawnable.map((s) => s.componentId))];
	return instanceType(ids.length === 1 ? ids[0] : undefined);
};

export const deriveSpawnPins = (node: Node, ctx: SpawnPinContext): Pin[] | undefined => {
	switch (node.kind) {
		case 'spawn': {
			const at =
				node.at === 'cell'
					? [
							dataPin('col', 'in', { t: 'int' }, 'col', 'The grid column (0 = the first).'),
							dataPin('row', 'in', { t: 'int' }, 'row', 'The grid row (0 = the top).'),
						]
					: [
							dataPin('x', 'in', { t: 'float' }, 'x', "Where it appears, in the layer's space."),
							dataPin('y', 'in', { t: 'float' }, 'y', "Where it appears, in the layer's space."),
						];
			return [
				EXEC_IN,
				EXEC_OUT,
				...at,
				dataPin(
					SPAWN_INSTANCE_PIN,
					'out',
					instanceType(node.componentId || undefined),
					'instance',
					'The new instance. Empty when the layer refused it.',
				),
				dataPin(
					'spawned',
					'out',
					{ t: 'bool' },
					'spawned',
					'False when the layer refused the spawn: it is full, does not list the component, or the cell is off its grid.',
				),
			];
		}
		case 'despawn':
			return [
				EXEC_IN,
				EXEC_OUT,
				dataPin(
					SPAWN_INSTANCE_PIN,
					'in',
					instanceType(),
					'instance',
					'The instance to remove. One already gone is ignored.',
				),
			];
		case 'instanceRef': {
			const decl = asInstanceDecl(node.componentId, spawnableDecl(ctx, node.componentId));
			const pins = deriveInstancePins(decl);
			const type = instanceType(node.componentId || undefined);
			return [
				pins[0],
				dataPin(
					SPAWN_INSTANCE_PIN,
					'in',
					type,
					'instance',
					'The spawned instance to address. Blank on an event chain: the instance that raised it.',
					true,
				),
				...pins.slice(1),
				dataPin(
					INSTANCE_REF_HANDLE_PIN,
					'out',
					type,
					'instance',
					'The instance this node addressed (the one that raised the event, on an event chain).',
				),
			];
		}
		case 'waitForState':
			if (node.componentId === undefined) return undefined;
			return [
				EXEC_IN,
				EXEC_OUT,
				dataPin(
					SPAWN_INSTANCE_PIN,
					'in',
					instanceType(node.componentId || undefined),
					'instance',
					'The spawned instance to wait on. Blank on an event chain: the instance that raised it.',
					true,
				),
			];
		default:
			return undefined;
	}
};

/** The interface decl an `instanceRef` / spawned `waitForState` of `componentId` addresses. */
export const spawnedInstanceDecl = (
	ctx: SpawnPinContext,
	componentId: string,
): FlowInstanceDecl | undefined => asInstanceDecl(componentId, spawnableDecl(ctx, componentId));

const graphNodes = (graph: Graph): Node[] => {
	const out: Node[] = [];
	const scan = (nodes: Node[]): void => {
		for (const node of nodes) {
			out.push(node);
			if (node.kind === 'group' && node.body) scan(node.body.nodes);
		}
	};
	scan(graph.nodes ?? []);
	return out;
};

/** Every node of every section of the doc, group bodies included. */
const docNodes = (doc: FlowDoc): Node[] => [
	...graphNodes(doc.graph),
	...Object.values(doc.modes ?? {}).flatMap((scope) =>
		scope?.graph ? graphNodes(scope.graph) : [],
	),
];

const readsLive = (node: Node): boolean => {
	const sources = Object.values(node.inputs ?? {});
	if (node.kind === 'branch') {
		for (const c of [...(node.guard.all ?? []), ...(node.guard.any ?? [])])
			sources.push(c.left, c.right);
	}
	if (node.kind === 'compute') {
		const op = node.compute;
		if (op.op === 'member') sources.push(op.on);
		else sources.push(op.a, op.b);
	}
	return sources.some((src) => src?.kind === 'accessor' && src.path.on === 'live');
};

/**
 * Does the doc spawn anything — a spawn / despawn / instance-ref node, a spawned wait, or a `$live`
 * read? The game builds no live set, and reads no spawned instance, for a doc that does not.
 */
export const flowUsesSpawn = (doc: FlowDoc): boolean =>
	docNodes(doc).some(
		(node) =>
			node.kind === 'spawn' ||
			node.kind === 'despawn' ||
			node.kind === 'instanceRef' ||
			(node.kind === 'waitForState' && node.componentId !== undefined) ||
			readsLive(node),
	);

/** Every `instanceRef` node of a graph, group bodies included. */
export const instanceRefNodes = (graph: Graph): InstanceRefNode[] =>
	graphNodes(graph).filter((n): n is InstanceRefNode => n.kind === 'instanceRef');
