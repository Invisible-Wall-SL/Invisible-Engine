import { json } from '@sveltejs/kit';
import { listEffects } from '$lib/server/fxStorage';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * List the project's authored Invisible FX effects (id + name) so the Scene Editor's palette can
 * drop an `effect` node that references one — and the Rigger can bind an effect directly to an
 * animation event key (rig-timeline direct FX binding). Gated on any tool that legitimately reads
 * the list: `editor`, or the `fx`/`rigger` alt-tools (the FX author and the Rigger author). Scope
 * bound to the SESSION's active project. Reuses `fxStorage.listEffects()` (the `/fx` picker's list).
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		altTools: ['fx', 'rigger'],
		forbiddenMessage: 'Your role does not have access to the project effects.',
	});

	const effects = await listEffects(clientKey, projectKey);
	return json({ effects });
};
