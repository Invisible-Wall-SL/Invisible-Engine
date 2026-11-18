import { json } from '@sveltejs/kit';
import { rigTemplateList } from '$lib/server/rigTemplates';
import { listUserRigTemplates } from '$lib/server/rigTemplateStore';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * The rig templates the New-rig panel offers, with the parts each expects: the built-ins, then
 * the ones made in the Rigger (docs/design/rig-templates.md §7). A store that cannot be read still
 * answers the built-ins. Gated by `rigger`.
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	let user: Awaited<ReturnType<typeof listUserRigTemplates>> = [];
	try {
		user = await listUserRigTemplates();
	} catch (e) {
		console.warn('[rigTemplates] the user templates could not be listed', e);
	}
	return json({ templates: [...rigTemplateList(), ...user] });
};
