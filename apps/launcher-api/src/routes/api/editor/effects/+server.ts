import { json } from '@sveltejs/kit';
import { listEffects } from '$lib/server/fxStorage';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * List the project's authored Invisible FX effects (id + name) so the Scene Editor's palette can
 * drop an `effect` node that references one. Gated like the editor's other read endpoints
 * (`editor` OR the `fx` alt-tool — the FX author placing their own effects), scope bound to the
 * SESSION's active project. Reuses `fxStorage.listEffects()` (the same list the `/fx` picker uses).
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		altTools: ['fx'],
		forbiddenMessage: 'Your role does not have access to the Invisible Editor.',
	});

	const effects = await listEffects(clientKey, projectKey);
	return json({ effects });
};
