import { requireTool } from './http';

/**
 * The entitlement gate every Invisible Sound endpoint shares — the doc route (`/api/sounds`) and
 * the file route (`/api/sounds/file`). Returns the user for `requireProjectScope`, which refuses a
 * `?project=` this user cannot access.
 *
 * Granted by default to `audio`, `developer`, `artist` and `pipelineTester` (and `admin`, which
 * holds every tool) — see `ROLE_TOOLS`. The build-time export (`/api/editor/export-sounds`) does
 * NOT come through here: a build runner is not a logged-in author, so it carries the deploy token
 * instead.
 */
export const requireSoundAccess = (locals: App.Locals) =>
	requireTool(locals, 'sound', 'Invisible Sound');
