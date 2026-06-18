import { error, json } from '@sveltejs/kit';
import { r2Slug, sharedAnimationKey } from '$lib/server/projectPaths';
import { getObjectText } from '$lib/server/r2';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Fetch one full animation-library entry by `?id=` (includes the heavy `animation`
 * subtree the client imports). 404 when the entry is missing. Gated by `rigger`; the
 * id is path-guarded via `r2Slug`.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const id = r2Slug(url.searchParams.get('id') ?? '');
	if (!id || id.includes('..') || id.includes('/')) throw error(400, 'bad id');

	const raw = await getObjectText(sharedAnimationKey(id));
	if (raw === null) throw error(404, 'animation not found');
	let entry: unknown;
	try {
		entry = JSON.parse(raw);
	} catch {
		throw error(500, 'animation entry is not valid JSON');
	}
	return json(entry);
};
