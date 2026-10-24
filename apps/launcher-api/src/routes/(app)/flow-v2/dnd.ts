/**
 * Invisible Flow v2 — the palette→canvas drag-and-drop payload, carried by the shared
 * `$lib/graph/dnd` contract under this MIME. The palette WRITES it on `dragstart`; the canvas READS
 * it on `drop` and adds the node at the drop point in doc space.
 */

import type { NodeKind } from 'engine-flow-v2';

/** The custom dataTransfer type identifying a Flow v2 add-node drag. */
export const DROP_MIME = 'application/flow-v2-node';

/** What a palette entry carries onto the drag. `ref` is omitted for control kinds. */
export type DropPayload = {
	kind: NodeKind;
	ref?: string;
};
