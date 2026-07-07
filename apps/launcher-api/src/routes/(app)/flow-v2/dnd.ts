/**
 * Invisible Flow v2 — the palette→canvas drag-and-drop contract. A single stable custom
 * dataTransfer MIME (never `text/plain`, so unrelated drags never register as a node drop)
 * plus the payload shape carried on it. The palette WRITES this on `dragstart`; the canvas
 * READS it on `drop`, then maps the drop point through `screenToFlowPosition` and adds the
 * node at that doc-space position (replacing the old click-to-add-at-centroid).
 */

import type { NodeKind } from 'engine-flow-v2';

/** The custom dataTransfer type identifying a Flow v2 add-node drag. */
export const DROP_MIME = 'application/flow-v2-node';

/** What a palette entry carries onto the drag. `ref` is omitted for control kinds. */
export type DropPayload = {
	kind: NodeKind;
	ref?: string;
};
