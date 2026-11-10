import { requireTool } from './http';

/**
 * The session gate shared by the Invisible Symbols State Machine authoring endpoints
 * (`/api/editor/symbols` and its `backups` history) — the SAME entitlement the `/symbols` page
 * checks. NOT the deploy-token gate, which is only for the build-time export. Returns the user for
 * `requireProjectScope`: the tool grant alone is not a project grant.
 */
export const requireSymbolsAccess = (locals: App.Locals) =>
	requireTool(locals, 'symbols', 'the Invisible Symbols State Machine');
