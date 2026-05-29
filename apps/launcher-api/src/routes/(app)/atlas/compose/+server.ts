import { error, json } from '@sveltejs/kit';
import { requireAtlasAccess } from '$lib/server/atlas';
import { ENV } from '$lib/server/env';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	requireAtlasAccess(locals);
	const { atlas_key, images, output_prefix, padding_pct } = await request.json();
	if (!atlas_key || !images || !output_prefix) {
		throw error(400, 'atlas_key, images and output_prefix are required.');
	}

	let res: Response;
	try {
		res = await fetch(`${ENV.ATLAS_BACKEND_URL.replace(/\/$/, '')}/compose`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ atlas_key, images, output_prefix, padding_pct }),
		});
	} catch (e) {
		throw error(502, `Atlas backend unreachable: ${e}`);
	}
	const body = await res.text();
	if (!res.ok) throw error(502, `Compose failed: ${body}`);
	return json(JSON.parse(body));
};
