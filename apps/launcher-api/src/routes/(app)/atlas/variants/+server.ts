import { error, json } from '@sveltejs/kit';
import { requireAtlasAccess } from '$lib/server/atlas';
import { listObjects } from '$lib/server/r2';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	requireAtlasAccess(locals);
	const region = url.searchParams.get('region') ?? '';
	if (!region) throw error(400, 'region is required');

	const prefix = `atlas_maker/cloud/batch/${region}/`;
	const entries = (await listObjects(prefix))
		.filter((e) => e.key.endsWith('.png'))
		.sort((a, b) => b.lastModified - a.lastModified);

	return json({
		region,
		variants: entries.map((e) => ({ key: e.key, size: e.size, lastModified: e.lastModified })),
	});
};
