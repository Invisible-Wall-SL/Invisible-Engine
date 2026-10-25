/**
 * Invisible Flow v2 — the SPAWN checks (`docs/design/game-families.md` §3.3). Judged only when the
 * caller projected the spawn layers in (`PinContext.spawnLayers`): an absent map is an unknown
 * layout, and every check here reports nothing (never guess).
 *
 *  - `spawn-layer-unknown`  a Spawn node or a `$live` read names a layer no screen of this flow places;
 *  - `spawn-not-spawnable`  a Spawn names a component its layer does not list, or an Instance ref /
 *                           spawned Wait for state names one no layer lists (nothing could address);
 *  - `spawn-cell-free`      a Spawn at a cell into a free layer (it has no grid);
 *  - `spawn-handle-unfed`   an Instance ref / spawned Wait with nothing on its `instance` pin, off its
 *                           own component's event chain: it addresses nothing (a WARNING);
 *  - `instance-missing` / `instance-pin-missing` / `instance-state-unknown` / `instance-text-key` /
 *    `instance-event-duplicate` — the placed-instance checks, for an Instance ref or a spawned Wait.
 */

import {
	instanceInputOf,
	instanceInputPin,
	instanceEventOf,
	isLocalizationKey,
} from './instanceNodes';
import type { PinContext } from './pins';
import { SPAWN_INSTANCE_PIN, spawnableDecl } from './spawnNodes';
import type { FlowIssue } from './validate';
import type { FlowDoc, Node, Pin } from './types';

const layerNames = (ctx: PinContext): string =>
	Object.values(ctx.spawnLayers ?? {})
		.map((l) => `'${l.name}'`)
		.join(', ') || 'none';

export const spawnNodeIssues = (
	nodes: Node[],
	pinsById: Map<string, Pin[]>,
	{ exec, data }: Pick<FlowDoc['graph'], 'exec' | 'data'>,
	ctx: PinContext,
	/** Which entry chains reach each node (`triggerOwners`); a node absent from it is unreached. */
	owners: Map<string, Set<string>>,
): FlowIssue[] => {
	const issues: FlowIssue[] = [];
	const layers = ctx.spawnLayers;
	if (!layers) return issues;
	const nodeById = new Map(nodes.map((n) => [n.id, n]));
	/** Is chain owner `owner` an Instance ref's event chain of `componentId` (`instanceEventOwner`)? */
	const ownComponentChain = (owner: string, componentId: string): boolean => {
		const at = owner.lastIndexOf('.event:');
		const source = at > 0 ? nodeById.get(owner.slice(0, at)) : undefined;
		return source?.kind === 'instanceRef' && source.componentId === componentId;
	};
	for (const node of nodes) {
		if (node.kind === 'spawn') {
			const layer = layers[node.layer];
			if (!layer) {
				issues.push({
					code: 'spawn-layer-unknown',
					severity: 'error',
					message: `spawn node '${node.id}' spawns into layer '${node.layer}', which no screen of this flow places (layers: ${layerNames(ctx)}) — place a Spawn layer in /editor, or pick one`,
					at: { on: 'node', node: node.id },
				});
				continue;
			}
			const spawnable = layer.spawnable.find((s) => s.componentId === node.componentId);
			if (spawnable?.missing) {
				issues.push({
					code: 'instance-missing',
					severity: 'error',
					message: `spawn node '${node.id}' spawns '${node.componentId}', which is not in this project — it would draw nothing; restore it in /editor`,
					at: { on: 'node', node: node.id },
				});
			}
			if (!spawnable) {
				issues.push({
					code: 'spawn-not-spawnable',
					severity: 'error',
					message: `spawn node '${node.id}' spawns '${node.componentId}' into '${layer.name}', which does not list it (${layer.spawnable.map((s) => s.componentId).join(', ') || 'nothing'}) — add it to the layer's spawnable list in /editor; the game refuses it`,
					at: { on: 'node', node: node.id },
				});
			}
			if (node.at === 'cell' && layer.placement !== 'grid') {
				issues.push({
					code: 'spawn-cell-free',
					severity: 'error',
					message: `spawn node '${node.id}' spawns at a cell into '${layer.name}', a free layer with no grid — spawn at x / y, or make the layer a grid`,
					at: { on: 'node', node: node.id },
				});
			}
			continue;
		}
		const addressed =
			node.kind === 'instanceRef'
				? node.componentId
				: node.kind === 'waitForState'
					? node.componentId
					: undefined;
		if (addressed === undefined) continue;
		const label = node.kind === 'instanceRef' ? 'instance ref' : 'wait-for-state node';
		// Unfed, the node addresses the instance that raised the event its chain started from — only
		// an Instance ref's event chain of the same component has one.
		const fed =
			node.inputs?.[SPAWN_INSTANCE_PIN] !== undefined ||
			data.some((e) => e.to.node === node.id && e.to.pin === SPAWN_INSTANCE_PIN);
		const reached = owners.get(node.id);
		if (!fed && reached?.size && ![...reached].every((o) => ownComponentChain(o, addressed))) {
			issues.push({
				code: 'spawn-handle-unfed',
				severity: 'warning',
				message: `${label} '${node.id}' has nothing on its instance pin and runs on a chain no spawned '${addressed}' raised — it addresses nothing. Feed it a handle (a Spawn's instance, $item over $live), or move it onto that component's Instance-ref event chain`,
				at: { on: 'pin', node: node.id, pin: SPAWN_INSTANCE_PIN },
			});
		}
		const spawnable = spawnableDecl(ctx, addressed);
		if (!spawnable) {
			issues.push({
				code: 'spawn-not-spawnable',
				severity: 'error',
				message: `${label} '${node.id}' addresses spawned '${addressed}', which no spawn layer of this flow lists — nothing could ever be addressed`,
				at: { on: 'node', node: node.id },
			});
			continue;
		}
		if (spawnable.missing) {
			issues.push({
				code: 'instance-missing',
				severity: 'error',
				message: `${label} '${node.id}': the component '${addressed}' is not in this project — restore it in /editor`,
				at: { on: 'node', node: node.id },
			});
			continue;
		}
		if (node.kind === 'waitForState') {
			const value = spawnable.interface.values.find((v) => v.layer === node.layer);
			if (!value) {
				issues.push({
					code: 'instance-pin-missing',
					severity: 'error',
					message: `wait-for-state node '${node.id}' waits on layer '${node.layer}' of spawned '${addressed}', which its state machine does not have`,
					at: { on: 'node', node: node.id },
				});
			} else if (!value.states.includes(node.state)) {
				issues.push({
					code: 'instance-state-unknown',
					severity: 'error',
					message: `wait-for-state node '${node.id}' waits for '${addressed}' layer '${node.layer}' to reach '${node.state}', which is not one of its states (${value.states.join(', ')}) — the wait would never end`,
					at: { on: 'node', node: node.id },
				});
			}
			continue;
		}
		if (node.kind !== 'instanceRef') continue;
		const pins = pinsById.get(node.id) ?? [];
		for (const [pinId, src] of Object.entries(node.inputs ?? {})) {
			if (pins.some((p) => p.id === pinId && p.dir === 'in' && p.kind === 'data')) continue;
			const input = instanceInputOf(pinId);
			issues.push({
				code: 'instance-pin-missing',
				severity: 'error',
				message:
					input === undefined
						? `instance ref '${node.id}' stores a ${src.kind} for '${pinId}', which is not one of its inputs`
						: `instance ref '${node.id}' sets '${input}', which '${addressed}' no longer declares as a bool, number or text input — remove the stored value or restore the input`,
				at: { on: 'pin', node: node.id, pin: pinId },
			});
		}
		for (const input of spawnable.interface.inputs) {
			if (input.kind !== 'text') continue;
			const pin = instanceInputPin(input.id);
			const src = node.inputs?.[pin];
			if (src?.kind === 'literal' && !isLocalizationKey(src.value)) {
				issues.push({
					code: 'instance-text-key',
					severity: 'error',
					message: `instance ref '${node.id}' feeds text input '${input.id}' of '${addressed}' with ${JSON.stringify(src.value)}, which is not a localization key`,
					at: { on: 'pin', node: node.id, pin },
				});
			}
		}
	}
	// The runtime walks the FIRST wire out of a spawned component's event pin.
	const first = new Map<string, string>();
	for (const edge of exec) {
		const node = nodeById.get(edge.from.node);
		if (node?.kind !== 'instanceRef') continue;
		const event = instanceEventOf(edge.from.pin);
		if (event === undefined) continue;
		const key = `${node.componentId}\u0000${event}`;
		const owner = first.get(key);
		if (owner === undefined) {
			first.set(key, node.id);
			continue;
		}
		if (owner === node.id) continue;
		issues.push({
			code: 'instance-event-duplicate',
			severity: 'error',
			message: `instance ref '${node.id}' wires event '${event}' of spawned '${node.componentId}', which instance ref '${owner}' already wires — only the first wire runs; keep one per event`,
			at: { on: 'execEdge', from: edge.from, to: edge.to },
		});
	}
	return issues;
};
