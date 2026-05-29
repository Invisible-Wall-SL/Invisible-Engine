import { error, json } from '@sveltejs/kit';
import { requireAtlasAccess, type AtlasManifest } from '$lib/server/atlas';
import { putObjectText } from '$lib/server/r2';
import { ENV } from '$lib/server/env';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	requireAtlasAccess(locals);
	const manifest = (await request.json()) as AtlasManifest;
	if (!manifest || !Array.isArray(manifest.regions)) {
		throw error(400, 'A manifest with a regions array is required.');
	}
	await putObjectText(ENV.ATLAS_MANIFEST_KEY, JSON.stringify(manifest, null, 2));
	return json({ ok: true, key: ENV.ATLAS_MANIFEST_KEY, regions: manifest.regions.length });
};
