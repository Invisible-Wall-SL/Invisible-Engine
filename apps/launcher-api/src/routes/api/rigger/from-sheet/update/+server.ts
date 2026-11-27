import { error, json } from '@sveltejs/kit';
import { loadRegionSet } from '$lib/server/editorRegions';
import { jsonObjectOrNull } from '$lib/server/http';
import { refuseOnThrow } from '$lib/server/refuseOnThrow';
import { bundlePrefixOf, liveArtKey } from '$lib/server/rigFrameSourceStore';
import { asIrigDocument, irigDocProblem } from '$lib/server/riggerIrig';
import { irigTarget, scopeMismatch } from '$lib/server/riggerIrigWrite';
import { requestSheet } from '$lib/server/riggerNewRig';
import { parseSheetMapping } from '$lib/server/rigSheetFit';
import { updateSheetRig } from '$lib/server/rigSheetUpdate';
import { rigTemplateForNewRig } from '$lib/server/rigTemplateStore';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 🔄 Update rig for a rig 🗺 From my sheet made (docs/design/frame-to-rig.md §13.1b): its mapping or
 * arrangement edited, the parts built as 🦴 Create rig builds them and merged into the rig the page
 * has open (`updateSheetRig`, frame to rig's merge). Writes nothing: the page takes the answer as one
 * undo step, saves the rig through `/api/rigger/save` and then its mapping through `PUT
 * /api/rigger/from-sheet`.
 *
 * Body `{ dir, stem, projectKey, sheet, kept, skeleton, keep? }`: the edited mapping, the mapping the
 * rig holds as the page has it (`sheet.json`, or an update not saved yet), the open rig, and the
 * hand-edited parts whose mesh the author keeps. The sheet stays the rig's own (the bundle draws from
 * it). Answers the merged rig, the mapping to keep (`sheet`, a prop named past the Photoshop file's
 * name), the depths its head turn gives (`depths`, for the rig's 3D data) and what changed (`report`,
 * with the slots and bones `renamed` and `dropped` for one slot per region, for the rig's 3D data and
 * controls to follow). Gated by `rigger`.
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

	const mapping = requestSheet(body.sheet);
	if (!mapping) throw error(400, 'No mapping was sent.');
	const kept = parseSheetMapping(body.kept);
	if ('problem' in kept) throw error(400, `The rig's kept mapping is unreadable: ${kept.problem}.`);
	const was = kept.mapping;
	if (mapping.template.id !== was.template.id)
		throw error(422, `This rig is a "${was.template.id}" rig: map its sheet to that template.`);
	const art = await liveArtKey(bundlePrefixOf(target));
	if (!art) throw error(404, `"${target.stem}" draws from no sheet any more.`);
	if (mapping.manifestKey !== art || was.manifestKey !== art)
		throw error(
			422,
			"🔄 Update rig keeps the rig's own sheet: map that one, or 🦴 Create a new rig from the other.",
		);
	const template = await rigTemplateForNewRig(was.template.id);
	if (!template) throw error(404, `No rig template "${was.template.id}".`);
	const { regions } = await loadRegionSet(art);
	if (!regions.length) throw error(404, "The rig's sheet has no regions any more.");

	const sent = body.skeleton;
	if (!isRecord(sent)) throw error(400, 'No rig was sent.');
	const current = asIrigDocument(sent) ?? sent;
	const unloadable = irigDocProblem(current);
	if (unloadable) throw error(422, `The open rig would not load: ${unloadable}.`);
	const keep = new Set(
		Array.isArray(body.keep) ? body.keep.filter((p): p is string => typeof p === 'string') : [],
	);

	const made = refuseOnThrow('The rig cannot be updated from this mapping', () =>
		updateSheetRig({ template, regions, was, mapping, current, keep }),
	);
	if (!made.ok)
		throw error(400, `The sheet does not fit the "${template.label}" template: ${made.problem}.`);
	const broken = irigDocProblem(made.value.doc);
	if (broken) throw error(422, `The updated rig would not load (${broken}); nothing was changed.`);
	return json({
		ok: true,
		skeleton: made.value.doc,
		sheet: {
			...made.value.mapping,
			template: {
				id: template.id,
				version: template.version,
				...(mapping.template.modules ? { modules: mapping.template.modules } : {}),
			},
		},
		depths: made.value.depths,
		...(made.value.controls ? { controls: made.value.controls } : {}),
		report: made.value.report,
	});
};
