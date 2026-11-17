import { json } from '@sveltejs/kit';
import { riggerBundlePrefix } from '$lib/server/riggerBundle';
import { getObjectText } from '$lib/server/r2';
import { RIG_TEMPLATE_SIDECAR, rigTemplateFromSidecar } from '$lib/server/rigTemplates';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * The template an open rig was made from, with its face channels, for the Rigger's Face panel.
 * GET `?dir=<b64 bundle dir>` → `{ template }`, null when the bundle has no `template.json`.
 * Gated by `rigger`.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	const bundle = riggerBundlePrefix(clientKey, projectKey, url.searchParams.get('dir') ?? '');
	const text = await getObjectText(`${bundle}/${RIG_TEMPLATE_SIDECAR}`);
	return json({ template: rigTemplateFromSidecar(text) });
};
