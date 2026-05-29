import { error, json } from '@sveltejs/kit';
import { requireAtlasAccess, parseManifest, effectiveConfig } from '$lib/server/atlas';
import { getObjectText } from '$lib/server/r2';
import { ENV } from '$lib/server/env';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	requireAtlasAccess(locals);

	const { region } = await request.json();
	if (!region?.name) throw error(400, 'region.name is required.');
	if (!region.prompt?.trim()) throw error(400, 'A prompt is required to generate.');

	const manifest = parseManifest(await getObjectText(ENV.ATLAS_MANIFEST_KEY));
	const config = effectiveConfig(manifest);
	const style = manifest?.style ?? {};

	const refs: Record<string, string> = {};
	const styleRef = region.style_ref || ENV.ATLAS_STYLE_REF_KEY;
	if (styleRef) refs.style_ref = styleRef;
	if (region.shape_ref) refs.shape_ref = region.shape_ref;

	const payload = { config, region, style, refs, prefix: 'atlas_maker/cloud' };

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
