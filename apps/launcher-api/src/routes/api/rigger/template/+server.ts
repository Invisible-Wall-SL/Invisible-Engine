import { error, json } from '@sveltejs/kit';
import { jsonObjectOrNull } from '$lib/server/http';
import { riggerBundlePrefix } from '$lib/server/riggerBundle';
import { irigTarget, scopeMismatch } from '$lib/server/riggerIrigWrite';
import { getObjectText } from '$lib/server/r2';
import { keepRigLengths } from '$lib/server/rigLengthsSidecar';
import { RIG_TEMPLATE_SIDECAR } from '$lib/server/rigTemplates';
import { rigTemplateForSidecar } from '$lib/server/rigTemplateStore';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const GATE = {
	tool: 'rigger',
	forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
} as const;

/**
 * The template an open rig was made from, with its controls, for the Rigger's Controls section: a
 * built-in, or a template made in the Rigger at the version the rig was made from.
 * GET `?dir=<b64 bundle dir>` → `{ template }`, null when the bundle has no `template.json` or the
 * template was deleted. Gated by `rigger`.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	const bundle = riggerBundlePrefix(clientKey, projectKey, url.searchParams.get('dir') ?? '');
	const text = await getObjectText(`${bundle}/${RIG_TEMPLATE_SIDECAR}`);
	return json({ template: await rigTemplateForSidecar(text) });
};

/**
 * After a save of a rig whose limbs ⤢ Fit rig to the capture refitted (docs/design/frame-to-rig.md
 * §4.6a): its `template.json` takes the limb lengths of the SAVED `.irig` (`keepRigLengths`), so the
 * Controls of every tab drive the rig's own limbs. Body `{ dir, stem, projectKey }` →
 * `{ ok, template, changed }`, the template as the rig's `template.json` now fits it.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	const body = await jsonObjectOrNull(request);
	if (!body) throw error(400, 'bad body');
	if (typeof body.projectKey === 'string' && body.projectKey !== projectKey)
		return scopeMismatch(body.projectKey, projectKey);
	const target = irigTarget(clientKey, projectKey, body.dir, body.stem);
	const res = await keepRigLengths(
		target,
		riggerBundlePrefix(clientKey, projectKey, body.dir ?? ''),
	);
	if (!res.ok) return json({ ok: false, message: res.message }, { status: res.status });
	return json(res);
};
