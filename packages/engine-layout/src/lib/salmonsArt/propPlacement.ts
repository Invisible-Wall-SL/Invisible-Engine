import type { SpawnProp } from '../arcadeProps.svelte';
import { ISO_DEPTH_SPREAD, isoDepth } from '../projection';
import { propPieces, type PropPiece, type PropZone } from '../propPieces';
import type { ComponentDef } from '../types';
import { aloftDepth, deckLift } from './bridge';
import { CELL } from './scale';

/**
 * A PROP'S PIECES PLACED IN SALMONS' RIVER (`docs/design/arcade-prop-components.md` §5, P5): the
 * pieces of `propPieces` given the river's depths, so each band sorts where the code bridge's
 * pieces sort (`river.ts`'s `Z` table, by `check:prop-depth`):
 * - `sorted`: among the players at the original's z, the code's `amongZ`: a bias of
 *   `⌈(zOffset − 1000) · CELL / 16⌉` ground depth px (a player's old z is 1000);
 * - `over`: over a character standing on the prop's deck anywhere on its cell (`aloftDepth` of the
 *   deck's lift, plus a cell);
 * - `behind`: the upright layer's order, the code's `zOf`: `isoDepth + zOffset · CELL / 16`;
 * - `water`: the reflections' order, cell by cell.
 * Every piece stands as high as the ground under its row (`lift`), and a water piece gets the code
 * shimmer's phase for its bridge and cell (`b · 1.7 + i · 0.9`, as `phase` seconds).
 */

/** The original's old px of screen y, in ground depth px (`river.ts` `DEPTH_PER_OLD_PX`). */
export const DEPTH_PER_OLD_PX = CELL / 16;
/** A player's old z over its screen y (`river.ts` `Z.player`). */
export const PLAYER_Z = 1000;

/** A placed piece: a spawn-layer piece, and its upright-layer order for a `behind` one. */
export type PlacedPiece = SpawnProp & { cell: number; zIndex?: number };

/** The code's order of a `behind` piece at world `(x, y)`, `zOffset` old px over its screen y. */
export const uprightZ = (x: number, y: number, zOffset: number): number =>
	isoDepth(x, y) + zOffset * DEPTH_PER_OLD_PX;

/** The bias of a `sorted` piece `zOffset` old px over its screen y (`isoDepthOrder`'s `bias`). */
export const amongBias = (zOffset: number): number =>
	Math.ceil((zOffset - PLAYER_Z) * DEPTH_PER_OLD_PX);

/** The code's zIndex of a `sorted` piece (`river.ts` `amongZ`). */
export const amongZ = (x: number, y: number, zOffset: number): number =>
	(Math.floor(isoDepth(x, y)) + amongBias(zOffset)) * ISO_DEPTH_SPREAD;

/**
 * `def`'s pieces on bridge `b`'s zone, `lift` screen px up (the river's elevation at its row).
 */
export function placeSalmonsProp(
	def: ComponentDef,
	zone: PropZone,
	b: number,
	lift: number,
): PlacedPiece[] {
	const height = zone.height ?? 6;
	return propPieces(def, zone, CELL).map((piece: PropPiece) => {
		const { zOffset, ...rest } = piece;
		const placed: PlacedPiece = { ...rest, lift };
		if (piece.band === 'sorted') placed.bias = amongBias(zOffset);
		else if (piece.band === 'over') placed.bias = aloftDepth(deckLift(height)) + CELL;
		else if (piece.band === 'behind') placed.zIndex = uprightZ(piece.x, piece.y, zOffset);
		if (piece.band === 'water') {
			placed.params = { ...placed.params, phase: (b * 1.7 + piece.cell * 0.9) / 2.4 };
		}
		return placed;
	});
}

/** A bridge zone of a room's game: `bridge<i>`, its index the code shimmer's bridge number. */
const BRIDGE_ZONE = /^bridge(\d+)$/;

/**
 * Every bridge of a room drawn with `def` (the seed `bridgeProp` until zone art names another):
 * the pieces of each `bridge<i>` zone of `zones`, each standing on the ground raised under its row
 * (`groundAt(y)`, the river's elevation). What the arcade runtime publishes for the field's spawn
 * layer (`setSpawnProps`), and the river draws the `water` and `behind` ones of.
 */
export function placeSalmonsBridges(
	def: ComponentDef,
	zones: readonly PropZone[],
	groundAt: (y: number) => number,
): PlacedPiece[] {
	return zones.flatMap((zone) => {
		const b = BRIDGE_ZONE.exec(zone.id);
		return b ? placeSalmonsProp(def, zone, Number(b[1]), groundAt(zone.y + zone.h / 2)) : [];
	});
}
