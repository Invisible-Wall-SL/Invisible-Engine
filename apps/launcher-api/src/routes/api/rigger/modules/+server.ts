import { error, json } from '@sveltejs/kit';
import { FRAME_SOURCE_SIDECAR } from '$lib/rigFrameSource';
import { SHEET_SIDECAR } from '$lib/rigSheetMap';
import { loadRegionSet } from '$lib/server/editorRegions';
import { jsonObjectOrNull } from '$lib/server/http';
import { getObjectText, putObjectText } from '$lib/server/r2';
import { refuseOnThrow } from '$lib/server/refuseOnThrow';
import { planModules } from '$lib/server/rigFrameUpdate';
import { bundlePrefixOf, liveArtKey } from '$lib/server/rigFrameSourceStore';
import { asIrigDocument, irigDocProblem } from '$lib/server/riggerIrig';
import { irigTarget, scopeMismatch, type IrigTarget } from '$lib/server/riggerIrigWrite';
import { requestModules } from '$lib/server/riggerNewRig';
import { parseRigFit } from '$lib/server/rigTemplateFit';
import { moduleChoiceProblem, offDefault } from '$lib/server/rigTemplateModules';
import {
	RIG_TEMPLATE_SIDECAR,
	fitWithLinks,
	parseTemplateRef,
	rigTemplateById,
	type RigTemplate,
} from '$lib/server/rigTemplates';
import { userRigTemplate } from '$lib/server/rigTemplateStore';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** The rig's `template.json` (its text and what it names: the template whole, its module set). */
async function templateOf(target: IrigTarget) {
	const text = await getObjectText(`${bundlePrefixOf(target)}/${RIG_TEMPLATE_SIDECAR}`);
	const ref = parseTemplateRef(text);
	if (!ref || text === null) throw error(404, `"${target.stem}" was not made from a template.`);
	const whole: RigTemplate | undefined =
		rigTemplateById(ref.id, ref.version) ?? (await userRigTemplate(ref.id, ref.version))?.template;
	if (!whole) throw error(404, `The template "${ref.id}" "${target.stem}" was made from is gone.`);
	if (!whole.modules?.length) throw error(422, `The "${whole.label}" template has no modules.`);
	return { text, ref, whole };
}

/**
 * 🧩 Modules (docs/design/rig-modules.md §4) for a rig made with ＋ New rig: its template's module set
 * changed in place. A rig made from a sheet changes its modules in 🗺 Edit mapping (its parts are
 * mapped there); one cut from a frame keeps its template's every module for now.
 *
 * POST `{ dir, stem, projectKey, modules, skeleton }` → `{ skeleton, report, controls, modules }`:
 * the open rig with what the new set lacks taken out and what it adds made over the rig's art and
 * merged (`planModules`). Writes nothing: the page takes it as one undo step, saves the rig, then PUTs.
 *
 * PUT `{ dir, stem, projectKey, modules }`: the module set written to the rig's `template.json`.
 * Gated by `rigger`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	const body = await jsonObjectOrNull(request);
	if (!body) throw error(400, 'bad body');
	if (typeof body.projectKey === 'string' && body.projectKey !== projectKey)
		return scopeMismatch(body.projectKey, projectKey);
	const target = irigTarget(clientKey, projectKey, body.dir, body.stem);
	const bundle = bundlePrefixOf(target);
	const [sheet, frame] = await Promise.all([
		getObjectText(`${bundle}/${SHEET_SIDECAR}`),
		getObjectText(`${bundle}/${FRAME_SOURCE_SIDECAR}`),
	]);
	if (sheet !== null)
		throw error(
			422,
			'This rig was made from a sheet: change its modules in 🗺 Edit mapping, then 🔄 Update rig.',
		);
	if (frame !== null)
		throw error(422, "A rig cut from a frame keeps its template's every module for now.");
	const { text, ref, whole } = await templateOf(target);
	const modules = requestModules(body.modules) ?? {};
	const sent = body.skeleton;
	if (!isRecord(sent)) throw error(400, 'No rig was sent.');
	const current = asIrigDocument(sent) ?? sent;
	const unloadable = irigDocProblem(current);
	if (unloadable) throw error(422, `The open rig would not load: ${unloadable}.`);
	const art = await liveArtKey(bundle);
	const regions = art ? (await loadRegionSet(art)).regions : [];
	let fit = null;
	try {
		const raw = (JSON.parse(text) as { fit?: unknown }).fit;
		const parsed = raw === undefined ? null : parseRigFit(raw);
		if (parsed && 'fit' in parsed) fit = fitWithLinks(whole, parsed.fit);
	} catch {
		fit = null;
	}
	const plan = refuseOnThrow('The rig cannot take this module set', () =>
		planModules({ whole, was: ref.modules, now: modules, regions, fit, current }),
	);
	if (!plan.ok) throw error(400, plan.problem);
	const broken = irigDocProblem(plan.doc);
	if (broken) throw error(422, `The changed rig would not load (${broken}); nothing was changed.`);
	return json({
		ok: true,
		skeleton: plan.doc,
		report: plan.report,
		...(plan.controls ? { controls: plan.controls } : {}),
		modules: offDefault(whole, modules),
	});
};

export const PUT: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	const body = await jsonObjectOrNull(request);
	if (!body) throw error(400, 'bad body');
	if (typeof body.projectKey === 'string' && body.projectKey !== projectKey)
		return scopeMismatch(body.projectKey, projectKey);
	const target = irigTarget(clientKey, projectKey, body.dir, body.stem);
	const { text, whole } = await templateOf(target);
	const modules = requestModules(body.modules) ?? {};
	const bad = moduleChoiceProblem(whole, modules);
	if (bad) throw error(400, bad);
	const raw = JSON.parse(text) as Record<string, unknown>;
	const off = offDefault(whole, modules);
	if (Object.keys(off).length) raw.modules = off;
	else delete raw.modules;
	await putObjectText(
		`${bundlePrefixOf(target)}/${RIG_TEMPLATE_SIDECAR}`,
		JSON.stringify(raw),
		'application/json',
	);
	return json({ ok: true, modules: off });
};
