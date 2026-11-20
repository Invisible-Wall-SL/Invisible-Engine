/**
 * Invisible Rigger — 2.5D rigs (docs/design/rig-2p5d.md): the bake, the sidecar's reading and writing,
 * the motion import into a 3D clip (P4), the re-bake after an edit (P3a) and the stage's turned view
 * and 3D gizmo (P3b), for the raw-WebGL `view.html` as `window.Rigger2p5d`. The same modules the save
 * path runs (`server/rigger3d.ts`), so the page bakes what the save bakes.
 */
export * from '../lib/rig2p5d';
export {
	RIG3D_VERSION,
	clipOf,
	followersOf,
	rig3dDocProblems,
	rig3dIrigProblems,
	rigOf,
	withBake,
} from '../lib/rig3d';
export {
	authoringOf,
	importClip3d,
	orientFromRotate,
	rebakeClip3d,
	rig3dFromTemplate,
} from '../lib/rig3dImport';
export * from '../lib/rig3dView';
export * from '../lib/rig3dTransitions';
