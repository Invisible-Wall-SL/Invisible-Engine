import { json } from '@sveltejs/kit';
import { rigTemplateList } from '$lib/server/rigTemplates';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/** The rig templates the New-rig panel offers, with the parts each expects. Gated by `rigger`. */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	return json({ templates: rigTemplateList() });
};
