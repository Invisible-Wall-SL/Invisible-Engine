import { requireTool } from './http';

/**
 * The session gate of the Invisible Editor's session-authed endpoints: component defaults and their
 * `backups`, the component library, kinds and templates. Returns the user for
 * `requireProjectScope` / `requireOptionalProjectKey`: the tool grant alone is not a project grant.
 */
export const requireEditorAccess = (locals: App.Locals) =>
	requireTool(locals, 'editor', 'Invisible Editor');
