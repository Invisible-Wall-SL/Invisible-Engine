import { error, json } from '@sveltejs/kit';
import { jsonObjectOrNull } from '$lib/server/http';
import { USER_TEMPLATE_ID, deleteUserRigTemplate } from '$lib/server/rigTemplateStore';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Delete a rig template made in the Rigger, conditional on the head the author was shown (`etag`):
 * a template saved again since is 409 `conflict`, nothing deleted. Rigs made from it keep their
 * keys (ordinary timelines); only their Controls section goes. A built-in cannot be deleted.
 * Body: `{ id, etag }`. Gated by `rigger`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	const body = await jsonObjectOrNull(request);
	if (!body) throw error(400, 'bad body');
	const id = typeof body.id === 'string' ? body.id : '';
	if (!USER_TEMPLATE_ID.test(id))
		throw error(400, 'only a template made in the Rigger can be deleted');
	if (typeof body.etag !== 'string' || !body.etag)
		throw error(400, 'This delete did not say which version it saw — reload the Rigger.');
	const done = await deleteUserRigTemplate(id, body.etag);
	return done.ok ? json({ ok: true }) : done.response;
};
