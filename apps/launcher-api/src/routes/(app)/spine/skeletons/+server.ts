import { json } from '@sveltejs/kit';
import { getObjectText } from '$lib/server/r2';
import { SPINE_PREFIX, requireSpineAccess } from '$lib/server/spine';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	await requireSpineAccess(locals);
	const text = await getObjectText(`${SPINE_PREFIX}/skeletons.json`);
	if (!text) return json({ error: 'No skeletons index in R2.', skeletons: [] });
	const data = JSON.parse(text);
	return json({ root: data.prefix ?? SPINE_PREFIX, skeletons: data.skeletons ?? [] });
};
