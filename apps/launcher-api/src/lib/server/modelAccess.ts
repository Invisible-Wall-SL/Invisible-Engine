import { requireTool } from './http';

/**
 * The entitlement gate of the `/api/models*` endpoints (`docs/design/3d/assets-evaluation.md` §4).
 * The Invisible Model Viewer (`/models`, 3D Phase 4) is not a registered tool yet, so an author who
 * places models — the Scene Editor or Invisible Characters — may upload them. The build-time export
 * does not come through here: it carries the deploy token (`/api/editor/export/models`).
 */
export const requireModelAccess = (locals: App.Locals) =>
	requireTool(locals, ['editor', 'characters'], 'the 3D models');
