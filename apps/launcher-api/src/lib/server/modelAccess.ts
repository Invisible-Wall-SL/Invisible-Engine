import { requireTool } from './http';

/** The tool the `/api/models*` endpoints gate on: the Invisible Model Viewer (`/models`). */
export const MODELS_TOOL = 'models';

/**
 * The entitlement gate of the `/api/models*` endpoints (`docs/design/3d/assets-evaluation.md` §4):
 * the Invisible Model Viewer's own tool. The build-time export does not come through here: it
 * carries the deploy token (`/api/editor/export/models`).
 */
export const requireModelAccess = (locals: App.Locals) =>
	requireTool(locals, MODELS_TOOL, 'Invisible Model Viewer');
