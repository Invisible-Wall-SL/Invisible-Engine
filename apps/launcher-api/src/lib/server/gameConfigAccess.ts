import { requireTool } from './http';

/**
 * The session gate shared by the Invisible Game Config authoring endpoints (`/api/game-config` and
 * its `server-paytable` import) — the SAME entitlement the `/config` page checks. NOT the
 * deploy-token gate of the sibling `doc` route, which serves the build-time bake. Returns the user
 * for `requireProjectScope`: the tool grant alone is not a project grant.
 */
export const requireGameConfigAccess = (locals: App.Locals) =>
	requireTool(locals, 'gameConfig', 'Invisible Game Config');
