import type { RigBox } from './characterSheet';

/** A rig's Bounds box as its header holds it: skeleton space (y up, `x`/`y` its bottom-left
 *  corner; absent ⇒ centred on the origin), before the load scale. */
type RigHeader = { x?: number; y?: number; width?: number; height?: number };

/**
 * A rig's box in the view's own px (y down): the Bounds box of its header (the Rigger's), at the
 * scale the rig was loaded at, or `undefined` when the header has no positive size. Shared by the
 * rig drawings that are loaded lazily (`sheetRigLook.ts`, `zoneArtRig.ts`), so neither pulls the
 * other in.
 */
export function rigHeaderBox(header: RigHeader, loadScale: number): RigBox | undefined {
	const { width = 0, height = 0 } = header;
	if (!(width > 0) || !(height > 0)) return undefined;
	const x = typeof header.x === 'number' && Number.isFinite(header.x) ? header.x : -width / 2;
	const y = typeof header.y === 'number' && Number.isFinite(header.y) ? header.y : -height / 2;
	return {
		x: x * loadScale,
		y: -(y + height) * loadScale,
		w: width * loadScale,
		h: height * loadScale,
	};
}
