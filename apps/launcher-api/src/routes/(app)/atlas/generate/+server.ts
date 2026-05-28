import { error, json } from '@sveltejs/kit';
import { requireAtlasAccess, DEFAULT_ATLAS_CONFIG } from '$lib/server/atlas';
import { ENV } from '$lib/server/env';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	requireAtlasAccess(locals);

	const { regionName, prompt } = await request.json();
	if (!regionName || !prompt) throw error(400, 'regionName and prompt are required.');

	const payload = {
		config: DEFAULT_ATLAS_CONFIG,
		region: { name: regionName, prompt },
		style: {},
		refs: { style_ref: ENV.ATLAS_STYLE_REF_KEY },
		prefix: 'atlas_maker/cloud',
	};

	let res: Response;
	try {
		res = await fetch(`${ENV.ATLAS_BACKEND_URL.replace(/\/$/, '')}/generate-region`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload),
		});
	} catch (e) {
		throw error(502, `Atlas backend unreachable: ${e}`);
	}

	const body = await res.text();
	if (!res.ok) throw error(502, `Generation failed: ${body}`);
	return json(JSON.parse(body));
};
