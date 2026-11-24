import { error, json } from '@sveltejs/kit';
import { loadRegionSet } from '$lib/server/editorRegions';
import { jsonObjectOrNull } from '$lib/server/http';
import { refuseOnThrow } from '$lib/server/refuseOnThrow';
import { assertProjectArt } from '$lib/server/projectArtScope';
import { requestSheet } from '$lib/server/riggerNewRig';
import { sheetPreview } from '$lib/server/rigSheetFit';
import { rigTemplateForNewRig } from '$lib/server/rigTemplateStore';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * What 🗺 From my sheet's ◧ Arranged view draws (docs/design/frame-to-rig.md §13): the rig a sheet
 * mapping makes, placed by the same `sheetRig` the create runs, so the page fits nothing itself.
 * POST `{ sheet }` → `SheetPreview` (each drawing's place in the rig's world, the bones, the scale
 * and the canvas's origin). Writes nothing. Gated by `rigger`; the sheet must be this project's art.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey, prefixes } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
		includeSharedSheets: true,
	});
	const body = await jsonObjectOrNull(request);
	const sheet = requestSheet(body?.sheet);
	if (!sheet) throw error(400, 'missing sheet mapping');
	await assertProjectArt(sheet.manifestKey, prefixes, clientKey, projectKey);
	const t = await rigTemplateForNewRig(sheet.template.id);
	if (!t) throw error(404, `no rig template "${sheet.template.id}"`);
	const rs = await loadRegionSet(sheet.manifestKey);
	if (!rs.regions.length) throw error(400, 'that atlas has no regions');
	const made = refuseOnThrow(`The sheet could not be placed on the "${t.label}" template`, () =>
		sheetPreview(t, rs.regions, sheet),
	);
	if (!made.ok)
		throw error(400, `The sheet does not fit the "${t.label}" template: ${made.problem}.`);
	return json(made.value);
};
