import { json } from '@sveltejs/kit';
import { riggerBundlePrefix } from '$lib/server/riggerBundle';
import { irigTarget } from '$lib/server/riggerIrigWrite';
import { getObjectText } from '$lib/server/r2';
import { RIG_TEMPLATE_SIDECAR } from '$lib/server/rigTemplates';
import { rigTemplateForSidecar } from '$lib/server/rigTemplateStore';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/** The bones of the saved `<stem>.irig`, or undefined when there is none or it does not read. */
function bonesOf(text: string | null): { name: string; x?: number; y?: number }[] | undefined {
	if (text === null) return undefined;
	try {
		const bones = (JSON.parse(text) as { bones?: unknown }).bones;
		return Array.isArray(bones) ? bones : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The template an open rig was made from, with its controls, for the Rigger's Controls section: a
 * built-in, or a template made in the Rigger at the version the rig was made from.
 * GET `?dir=<b64 bundle dir>[&stem=<file stem>]` → `{ template }`, null when the bundle has no
 * `template.json` or the template was deleted. With `stem`, on the limb lengths of the saved
 * `<stem>.irig` (⤢ Fit rig to the capture, docs/design/frame-to-rig.md §4.6a): derived on every
 * read, never stored, so it cannot disagree with the rig. Gated by `rigger`.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	const dir = url.searchParams.get('dir') ?? '';
	const stem = url.searchParams.get('stem');
	const bundle = riggerBundlePrefix(clientKey, projectKey, dir);
	const [text, irig] = await Promise.all([
		getObjectText(`${bundle}/${RIG_TEMPLATE_SIDECAR}`),
		stem ? getObjectText(irigTarget(clientKey, projectKey, dir, stem).key) : null,
	]);
	return json({ template: await rigTemplateForSidecar(text, bonesOf(irig)) });
};
