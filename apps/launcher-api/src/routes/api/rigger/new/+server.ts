import { error, json } from '@sveltejs/kit';
import { FRAME_SOURCE_SIDECAR, type FrameSourceDoc } from '$lib/rigFrameSource';
import { loadRegionSet, type EditorRegion } from '$lib/server/editorRegions';
import { jsonObjectOrNull } from '$lib/server/http';
import { JOB_ID } from '$lib/server/rigCutEdits';
import { frameSourceOf, madeAttachments, madeParts } from '$lib/server/rigFrameUpdate';
import { artRevision, cutFrames, readCut } from '$lib/server/rigFrameSourceStore';
import {
	newRigControls,
	requestFit,
	requestModules,
	requestSheet,
	resolveNewRigBody,
} from '$lib/server/riggerNewRig';
import { pairMark } from '$lib/server/riggerIrigWrite';
import {
	RIG_TEMPLATE_SIDECAR,
	templateReport,
	templateSidecar,
	type TemplateRig,
} from '$lib/server/rigTemplates';
import { SUB } from '$lib/server/projectPaths';
import { getObjectBytes, putObjectBytes, putObjectText } from '$lib/server/r2';
import { regionsToRigAtlas, reorientRotatedRegionsForRig } from '$lib/server/rig';
import { bundleRevision } from '$lib/server/rigBundleSync';
import { releaseClaimOnCaseClash, rigBundleNameTaken } from '$lib/server/rigIndex';
import { reindexProjectSkeletons, writeSkeletonsIndex } from '$lib/server/rigReindex';
import { reclaimAbandonedClaims } from '$lib/server/riggerAbandonedClaim';
import { SHEET_SIDECAR } from '$lib/rigSheetMap';
import { claimNewIrig } from '$lib/server/riggerIrigWrite';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const basename = (k: string): string => {
	const i = k.lastIndexOf('/');
	return i === -1 ? k : k.slice(i + 1);
};

/**
 * Create a NEW rig as a self-contained rig bundle under `spines/<name>/`:
 * synthesise a rig `.atlas` from the chosen manifest's regions, copy the packed
 * page image, and write a `.irig`. When `rigId` is supplied the `.irig` body is a saved
 * library rig's skeleton (bones + animations + constraints come over intact; its
 * attachment region names intentionally won't resolve against the new atlas until the
 * user re-attaches this object's art). Otherwise it is a blank skeleton (root bone +
 * default skin). With `templateId` it is a rig template (docs/design/rig-templates.md) over this
 * atlas's regions, remembered in the bundle's `template.json`; the answer lists the parts the art
 * lacks. With `fit` as well (docs/design/frame-to-rig.md §4.6) the template is fitted to the
 * character and the frame's pose is its `frame` animation, still an ordinary `.irig`; the fit is kept
 * in `template.json` so the Controls drive the fitted lengths. With `sheet` instead of `fit` (🗺 From
 * my sheet, frame-to-rig.md §13) the atlas's regions are mapped to the template's parts by the
 * mapping, which fits it and places each drawing; the mapping is kept in `sheet.json`. Then reindex
 * so it appears in the skeleton list. This is the
 * Atlas-Maker→Rigger bridge — a fresh project has manifests (post-compose) but no rig
 * bundles yet. `rigger`-gated.
 *
 * With `noAtlas: true` (and no `manifestKey`) the bundle gets a 1×1 transparent
 * placeholder page + a page-only `.atlas` (no regions). The rig opens with no images
 * attached — the user wires an atlas later via "⟳ source…" (resync) or a slot's image
 * dropdown. The client's tolerant loader is what lets such a rig (and a saved rig whose
 * region names don't resolve) build without throwing.
 *
 * Body: `{ manifestKey, name, rigId?, templateId?, modules?, fit? | sheet?, frame? }` or `{ noAtlas:
 * true, name, rigId?, templateId?, modules?, fit? }` (`modules`: the template's module set,
 * docs/design/rig-modules.md; a sheet's is its mapping's). `frame: { job }` (🦴 Create rig) names the cut the fit was made
 * from: the rig remembers it in `frame-source.json`, so ✂ Edit cut opens it again (frame-to-rig §12
 * F2j).
 */
/**
 * A 1×1 fully-transparent PNG — the placeholder page for atlas-less rigs.
 *
 * It MUST be a byte-valid PNG, and that is not a formality: the page is the rig bundle's only
 * image, so a browser that refuses to decode it fails the whole `Assets.load` of the bundle. The
 * rig is then missing from `loadedAssets`, `<RigProvider>` renders NOTHING — and with it none of
 * its children, including the `<RiggedEffect>` / `<RiggedFlipbook>` bindings an atlas-less
 * "carrier" rig usually exists to fire. The symbol/node simply vanishes in-game while every
 * authoring surface (which reads the `.irig` and previews clips off the timeline, never through
 * the loaded bundle) looks perfectly healthy.
 *
 * The previous literal was a splice of two different 1×1 PNGs — a grayscale+alpha IHDR
 * (`colorType 4`) carrying the IDAT of an RGBA one — so its IDAT CRC was wrong, its zlib stream
 * truncated, and Chrome answered `InvalidStateError: The source image could not be decoded`.
 * Regenerate rather than retype: 8-bit RGBA, one transparent pixel, CRCs computed.
 */
const BLANK_PAGE_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
	'base64',
);
/**
 * The `frame-source.json` of a rig 🦴 Create rig makes from the cut `frame.job` (frame-to-rig §12
 * F2j), or null when the request names no cut. The cut must be there and the rig's template's.
 */
async function newFrameSource(
	clientKey: string,
	projectKey: string,
	frame: unknown,
	made: {
		name: string;
		manifestKey: string;
		skeleton: Record<string, unknown>;
		template: TemplateRig | null;
	},
): Promise<FrameSourceDoc | null> {
	if (frame === undefined) return null;
	const job =
		typeof frame === 'object' && frame !== null ? (frame as { job?: unknown }).job : undefined;
	if (typeof job !== 'string' || !JOB_ID.test(job)) throw error(400, 'Bad frame: no cut job.');
	if (!made.template?.fit || !made.manifestKey)
		throw error(400, "A rig from a frame is a fitted template over the cut's sheet.");
	const read = await readCut(clientKey, projectKey, job);
	if (!read) throw error(404, 'That cut is gone: cut the frame again.');
	if (read.cut.template !== made.template.ref.id)
		throw error(422, 'The cut was made for another template.');
	return frameSourceOf({
		rig: made.name,
		template: made.template.ref,
		cut: read.cut,
		cutEtag: read.etag,
		frames: await cutFrames(clientKey, projectKey, read.cut),
		parts: madeParts(
			made.skeleton,
			madeAttachments(made.skeleton).map((a) => a.name),
		),
		art: made.manifestKey,
		artRevision: await artRevision(made.manifestKey),
	});
}

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const body = await jsonObjectOrNull(request);
	const manifestKey = body && typeof body.manifestKey === 'string' ? body.manifestKey : '';
	const noAtlas = !!(body && body.noAtlas === true);
	const name = (body && typeof body.name === 'string' ? body.name : '')
		.trim()
		.replace(/[^A-Za-z0-9_-]/g, '_');
	if (!manifestKey && !noAtlas) throw error(400, 'missing manifestKey');
	if (!name) throw error(400, 'missing rig name');

	const rigsPrefix = SUB.spines(clientKey, projectKey);
	const bundle = `${rigsPrefix}/${name}`;
	// A create that died after its claim holds the name from a folder nobody can see; free it.
	await reclaimAbandonedClaims(clientKey, projectKey, rigsPrefix, name);
	if (await rigBundleNameTaken(rigsPrefix, name))
		throw error(409, `a rig named "${name}" already exists (names are case-insensitive)`);

	const rigId = body && typeof body.rigId === 'string' ? body.rigId : '';
	const templateId = body && typeof body.templateId === 'string' ? body.templateId : '';
	const fit = requestFit(body?.fit);
	const sheet = requestSheet(body?.sheet);
	if (sheet && sheet.manifestKey !== manifestKey)
		throw error(400, 'the sheet mapping is of another atlas than the one picked');
	const modules = requestModules(body?.modules);

	// Resolve the page image + `.atlas` text + region count for either path.
	let pageName: string;
	let pageBody: Uint8Array;
	let pageContentType = 'image/png';
	let atlasText: string;
	let regionCount = 0;
	let sidecar: string | null = null;
	let regions: EditorRegion[] = [];

	if (noAtlas) {
		// Atlas-less rig: 1×1 transparent placeholder page + a page-only `.atlas`. No
		// source.json — so "⟳ source…" prompts the picker when the user attaches an atlas.
		pageName = `${name}.png`;
		pageBody = BLANK_PAGE_PNG;
		atlasText = regionsToRigAtlas(pageName, 1, 1, []);
	} else {
		const rs = await loadRegionSet(manifestKey);
		if (!rs.regions.length) throw error(400, 'that atlas has no regions');
		if (!rs.pageKey) throw error(400, "couldn't resolve the atlas page image");
		if (!rs.pageWidth || !rs.pageHeight)
			throw error(400, 'atlas manifest is missing the page size');

		const page = await getObjectBytes(rs.pageKey);
		if (!page) throw error(404, 'atlas page image not found in R2');
		pageName = basename(rs.pageKey);
		pageContentType = page.contentType;
		regionCount = rs.regions.length;
		regions = rs.regions;
		atlasText = regionsToRigAtlas(pageName, rs.pageWidth, rs.pageHeight, rs.regions);
		// Re-orient CW-packed rotated regions to rig's CCW `rotate:90` convention so they
		// don't render upside down in the Rigger (no-op when no region is rotated).
		pageBody = await reorientRotatedRegionsForRig(page.body, rs.regions);
		// Remember the source atlas so a future "⟳ Re-sync atlas" is one click (re-pull
		// the latest page + re-synth the .atlas after the source is recoloured/edited) AND
		// so consumers can detect a re-packed sheet: `geometryRevision` is the baseline the
		// self-healing sync (`ensureBundleAtlasFresh`) compares the live manifest against.
		// Ignored by the skeleton index (only skeleton/atlas files are indexed) and a
		// valid `/rig-viewer/file` name.
		sidecar = JSON.stringify({
			manifestKey,
			pageName,
			geometryRevision: await bundleRevision(rs),
		});
	}

	const made = await resolveNewRigBody(rigId, templateId, regions, fit, sheet, modules);
	const { skeleton, template } = made;
	const frameSource = await newFrameSource(clientKey, projectKey, body?.frame, {
		name,
		manifestKey,
		skeleton,
		template,
	});

	// The `.irig` goes FIRST and only if absent: `rigBundleNameTaken` above is a read, so two
	// creates of the same name can both pass it. The conditional create is the actual claim — the
	// loser gets a 409 before it has written a page or an atlas over the winner's. A claim on a
	// name differing only by case lands on a different key, so it is re-checked by listing.
	const irigKey = `${bundle}/${name}.irig`;
	const irigText = JSON.stringify(skeleton);
	if (!(await claimNewIrig(irigKey, irigText)))
		throw error(409, `a rig named "${name}" was just created by someone else`);
	if (await releaseClaimOnCaseClash(rigsPrefix, name, irigKey))
		throw error(409, `a rig named like "${name}" was just created (names are case-insensitive)`);
	await putObjectBytes(`${bundle}/${pageName}`, pageBody, pageContentType);
	await putObjectText(`${bundle}/${name}.atlas`, atlasText, 'text/plain; charset=utf-8');
	if (sidecar) await putObjectText(`${bundle}/source.json`, sidecar, 'application/json');
	if (template)
		await putObjectText(
			`${bundle}/${RIG_TEMPLATE_SIDECAR}`,
			templateSidecar(template),
			'application/json',
		);
	if (made.sheet)
		await putObjectText(
			`${bundle}/${SHEET_SIDECAR}`,
			JSON.stringify(made.sheet.mapping),
			'application/json',
		);
	const controls = newRigControls(template, name, irigText);
	if (controls)
		await putObjectText(`${bundle}/${controls.file}`, controls.text, 'application/json');
	if (frameSource)
		await putObjectText(
			`${bundle}/${FRAME_SOURCE_SIDECAR}`,
			JSON.stringify({ ...frameSource, irig: pairMark(irigText) }),
			'application/json',
		);

	await writeSkeletonsIndex(
		rigsPrefix,
		(await reindexProjectSkeletons(clientKey, projectKey, rigsPrefix)).index,
	);

	return json({
		ok: true,
		dir: Buffer.from(name, 'utf8').toString('base64url'),
		stem: name,
		atlas_file: `${name}.atlas`,
		regions: regionCount,
		...(template ? { template: templateReport(template) } : {}),
		...(made.sheet
			? { sheet: { scale: made.sheet.scale, face: made.sheet.face, hidden: made.sheet.hidden } }
			: {}),
	});
};
