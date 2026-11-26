import type { SpawnProp } from './arcadeProps.svelte';
import type { ComponentDef, LayoutNode, PropDepth, PropLength, SmLayer, SmState } from './types';

/**
 * A PROP CUT INTO ITS PIECES for one zone (`docs/design/arcade-prop-components.md` §5, P5): what the
 * runtime draws in each band. A prop def's root children are its bands, each one a piece set:
 * - a count-mode repeater: one piece per cell of the zone, its `first` / `middle` / `last` variant
 *   (one cell ⇒ `first`), with the cell's `index` (1-based) and `count` as params and as held
 *   inputs, as the repeater hands a segment them;
 * - a component instance: one piece at its `propCell`, with its own params.
 * Each piece takes the prop's zone params (`fromZone.length` / `height`, and the param the def is
 * scoped by: the zone's id), so a piece def reads the deck's height and hears its own zone's
 * triggers. A child's band is its `propDepth` (else the root's, else `sorted`) and its depth offset
 * its `propZOffset` (else 1100 `sorted`, 0 otherwise), in the original's old px; the game's field art
 * turns that into its own order (Salmons: `salmonsArt/propPlacement.ts`). Any other root child is
 * not a piece. Pure: the room, the device and the checks cut a prop the same way.
 */

/** The zone a prop is placed on: a row of cells along `x`, in world px. */
export type PropZone = { id: string; x: number; y: number; w: number; h: number; height?: number };

/** A piece, with the cell it stands at and its depth offset, before the game places it. */
export type PropPiece = Omit<SpawnProp, 'lift' | 'bias'> & { cell: number; zOffset: number };

/** The deck's depth offset (old px) when a `sorted` child names none: today's code deck. */
export const PROP_SORTED_Z = 1100;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** `length` resolved against `params`; a param that is not a finite number reads as 0. */
export const propCellOf = (
	length: PropLength | undefined,
	params: Record<string, unknown>,
): number => {
	if (length === undefined) return 0;
	if (finite(length)) return length;
	const v = params[length.param];
	return (finite(v) ? v : 0) + (length.plus ?? 0);
};

/** The pieces of `def` on `zone` (cells `cell` px wide). `[]` when `def` is not a prop. */
export function propPieces(def: ComponentDef, zone: PropZone, cell: number): PropPiece[] {
	const prop = def.prop;
	if (!prop) return [];
	const length = Math.max(1, Math.round(zone.w / cell));
	const height = zone.height ?? defaultOf(def, prop.fromZone.height);
	const shared: Record<string, unknown> = { [prop.fromZone.length]: length };
	if (prop.fromZone.height && height !== undefined) shared[prop.fromZone.height] = height;
	if (def.signalScope) shared[def.signalScope] = zone.id;
	const row = zone.y + zone.h / 2;
	const out: PropPiece[] = [];
	for (const child of def.root.children) {
		const band: PropDepth = child.propDepth ?? def.root.propDepth ?? 'sorted';
		const zOffset = child.propZOffset ?? (band === 'sorted' ? PROP_SORTED_Z : 0);
		const at = (c: number) => ({ x: zone.x + (c + 0.5) * cell, y: row });
		const piece = (c: number, componentId: string, params: Record<string, unknown>) => ({
			id: `${zone.id}:${child.id}:${c}`,
			band,
			componentId,
			cell: c,
			zOffset,
			...at(c),
			params: { ...shared, ...params },
		});
		if (child.kind === 'repeater' && child.count) {
			for (let i = 0; i < length; i++) {
				const index = i + 1;
				const values = { index, count: length };
				out.push({
					...piece(i, variantOf(child, i, length), values),
					inputValues: values,
				});
			}
		} else if (child.kind === 'componentInstance') {
			const c = propCellOf(child.propCell, shared);
			out.push(piece(c, child.componentId, { ...(child.params ?? {}) }));
		}
	}
	return out;
}

function variantOf(node: Extract<LayoutNode, { kind: 'repeater' }>, i: number, n: number): string {
	const v = node.variants;
	if (i === 0) return v?.first ?? node.componentId;
	if (i === n - 1) return v?.last ?? node.componentId;
	return v?.middle ?? node.componentId;
}

function defaultOf(def: ComponentDef, key: string | undefined): number | undefined {
	const value = key ? def.params?.find((p) => p.key === key)?.default : undefined;
	return finite(value) ? value : undefined;
}

/**
 * The state each machine layer of a piece settles in from its entry, on its held `inputs` (a
 * condition's `param` read from `params`): the first transition out of the entry whose `==`
 * conditions all hold, as the seed's pillar cells. What a surface that runs no machine (the river's
 * own layers, the Component Editor's prop view) shows of a piece.
 */
export function settledPropStates(
	layers: readonly SmLayer[],
	inputs: Record<string, unknown>,
	params: Record<string, unknown>,
): (SmState | undefined)[] {
	const holds = (c: { op: string; input: string; value?: unknown; param?: string }) =>
		c.op === '==' && inputs[c.input] === (c.param !== undefined ? params[c.param] : c.value);
	return layers.map((layer) => {
		const to = layer.transitions.find(
			(t) => t.from === layer.entry && !!t.conditions?.length && t.conditions.every(holds),
		)?.to;
		return layer.states.find((s) => s.id === (to ?? layer.entry));
	});
}
