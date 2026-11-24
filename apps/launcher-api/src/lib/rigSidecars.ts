import { RIG3D_SIDECAR } from './rig3d';
import { CONTROLS_SIDECAR } from './rigControls';
import { FRAME_SOURCE_SIDECAR } from './rigFrameSource';

/**
 * The authoring sidecars a rig's folder may hold beside its `.irig`, one of each, naming the rig
 * they belong to (`rig`) and marked with the `.irig` text they were written with (`irig`): the 2.5D
 * rig's 3D keys (docs/design/rig-2p5d.md §3), the control layer (docs/design/rig-controls.md §5.7)
 * and the cut a frame-made rig was made from (docs/design/frame-to-rig.md §12 F2j). Every write of
 * the `.irig` writes them with it (`server/riggerIrigWrite.ts`), in this order; every backup keeps
 * them; no game, export or runtime reads them.
 */
export const RIG_SIDECARS = [
	{ kind: 'rig3d', file: RIG3D_SIDECAR, what: '3D data' },
	{ kind: 'controls', file: CONTROLS_SIDECAR, what: 'controls' },
	{ kind: 'frame', file: FRAME_SOURCE_SIDECAR, what: 'frame source' },
] as const;

export type SidecarKind = (typeof RIG_SIDECARS)[number]['kind'];
