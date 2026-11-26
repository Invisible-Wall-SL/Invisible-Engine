import { error, json } from '@sveltejs/kit';
import { loadRegionSet } from '$lib/server/editorRegions';
import { jsonObjectOrNull } from '$lib/server/http';
import { refuseOnThrow } from '$lib/server/refuseOnThrow';
import { assertProjectArt } from '$lib/server/projectArtScope';
import { requestSheet } from '$lib/server/riggerNewRig';
import { parseSheetMapping, sheetPreview } from '$lib/server/rigSheetFit';
import { sheetEditPreview, type SheetRigOutline } from '$lib/server/rigSheetUpdate';
import { rigTemplateForNewRig } from '$lib/server/rigTemplateStore';
import { gate } from '$lib/server/toolScope';
import type { SheetMapping } from '$lib/rigSheetMap';
import type { RequestHandler } from './$types';

/** The most slots (and attachments in a skin's slot) an open rig is read with. */
const MAX_RIG_SLOTS = 4096;
/** The longest slot or attachment name an open rig is read with. */
const MAX_NAME = 256;

/**
 * What 🗺 From my sheet's ◧ Arranged view draws (docs/design/frame-to-rig.md §13): the rig a sheet
 * mapping makes, placed by the same `sheetRig` the create runs, so the page fits nothing itself.
 * POST `{ sheet, rig? }` → `SheetPreview` (each drawing's place in the rig's world, the bones, the
 * scale and the canvas's origin). `rig` (🗺 Edit mapping): `{ slots, skins, kept }`, the open rig's
 * slots back to front, its skin's attachment names by slot (the one `madeParts` reads: at most one)
 * and the mapping it keeps, so the layers
 * are judged as 🔄 Update rig judges them (`sheetEditPreview`); without it, as 🦴 Create rig does.
 * A Layers refusal answers `{ message, layers: true }`. Writes nothing. Gated by `rigger`; the sheet
 * must be this project's art.
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
	const rig = previewRig(body?.rig);
	if (rig === false)
		throw error(
			400,
			'`rig` is { slots, skins, kept }: slot names, attachment names by slot, a mapping',
		);
	const made = refuseOnThrow(`The sheet could not be placed on the "${t.label}" template`, () =>
		rig
			? sheetEditPreview({ template: t, regions: rs.regions, was: rig.kept, mapping: sheet, rig })
			: sheetPreview(t, rs.regions, sheet),
	);
	if (made.ok) return json(made.value);
	const message = `The sheet does not fit the "${t.label}" template: ${made.problem}.`;
	if ('layers' in made) return json({ message, layers: true }, { status: 400 });
	throw error(400, message);
};

const names = (v: unknown): v is string[] =>
	Array.isArray(v) &&
	v.length <= MAX_RIG_SLOTS &&
	v.every((n) => typeof n === 'string' && n.length <= MAX_NAME);
const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** The open rig the page previews an edit of: none, or false when it is not one. */
function previewRig(raw: unknown): (SheetRigOutline & { kept: SheetMapping }) | null | false {
	if (raw === undefined || raw === null) return null;
	if (!isRecord(raw)) return false;
	const { slots, skins } = raw;
	if (!names(slots) || !Array.isArray(skins) || skins.length > 1) return false;
	const outline: SheetRigOutline['skins'][number][] = [];
	for (const s of skins) {
		if (!isRecord(s) || typeof s.name !== 'string' || s.name.length > MAX_NAME) return false;
		if (!isRecord(s.attachments)) return false;
		const by = Object.entries(s.attachments);
		if (by.length > MAX_RIG_SLOTS || !by.every(([slot, v]) => slot.length <= MAX_NAME && names(v)))
			return false;
		outline.push({ name: s.name, attachments: s.attachments as Record<string, string[]> });
	}
	const kept = parseSheetMapping(raw.kept);
	if ('problem' in kept) throw error(400, `The rig's kept mapping is unreadable: ${kept.problem}.`);
	return { slots, skins: outline, kept: kept.mapping };
}
