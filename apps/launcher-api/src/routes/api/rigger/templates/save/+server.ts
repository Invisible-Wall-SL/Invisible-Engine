import { error, json } from '@sveltejs/kit';
import { jsonObjectOrNull } from '$lib/server/http';
import { r2Slug } from '$lib/server/projectPaths';
import { irigDocProblem } from '$lib/server/riggerIrig';
import { rigTemplateFromRig } from '$lib/server/rigTemplateFromRig';
import { parseTemplateSpec } from '$lib/server/rigTemplateSchema';
import { saveUserRigTemplate } from '$lib/server/rigTemplateStore';
import { gate } from '$lib/server/toolScope';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { RequestHandler } from './$types';

/**
 * 📐 Save as template (docs/design/rig-templates.md §7): the open rig plus the author's choices
 * become the next version of a shared rig template. The template is derived from the rig here, then
 * checked (strict shape, `rigTemplateProblem`, and a rig made from it loading and posing under
 * engine-rig) before anything is written; a refusal is a 422 naming the reason.
 *
 * The rig's native constraints come with it, and so does its control layer when the page sends it
 * (`controls`, the open rig's `controls.json`, rig-controls §6.1): a rig made from the template starts
 * with both.
 *
 * Body: `{ name, rig, spec, controls?, baseEtag: string | null }`. `baseEtag: null` creates; a taken name is
 * 409 `exists` with the head's etag and who saved it; the page confirms and sends that etag, so a
 * second save in between is 409 `conflict`. Answers `{ ok, id, version, etag, notes }`. Gated by
 * `rigger`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	const body = await jsonObjectOrNull(request);
	if (!body) throw error(400, 'bad body');
	const baseEtag = writeBaseEtagJson(body);
	if (baseEtag === undefined) throw error(400, 'a template save is never forced');

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) throw error(400, 'missing name');
	const id = r2Slug(name);

	const rig = body.rig;
	if (!rig || typeof rig !== 'object' || Array.isArray(rig)) throw error(400, 'missing rig');
	const invalid = irigDocProblem(rig as Record<string, unknown>);
	if (invalid) throw error(422, `Not saved — the rig itself would not load: ${invalid}.`);

	const spec = parseTemplateSpec(body.spec);
	if (typeof spec === 'string') throw error(422, `Not saved — ${spec}.`);
	const derived = rigTemplateFromRig(rig as Record<string, unknown>, spec, id, 0, body.controls);
	if (typeof derived === 'string') throw error(422, `Not saved — ${derived}.`);

	const user = locals.user!;
	const saved = await saveUserRigTemplate(id, derived.template, baseEtag, {
		uid: user.id,
		name: user.name || user.email,
		project: projectKey,
	});
	if (!saved.ok)
		if ('problem' in saved) throw error(422, `Not saved — ${saved.problem}.`);
		else return saved.response;
	return json({ ok: true, ...saved.ref, etag: saved.etag, notes: derived.notes });
};
