import { json } from '@sveltejs/kit';
import { listProjectAssets } from '$lib/server/projectAssets';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		forbiddenMessage: 'Your role does not have access to the Invisible Editor.',
	});

	const assets = await listProjectAssets(clientKey, projectKey);
	return json({ projectKey, clientKey, assets });
};
