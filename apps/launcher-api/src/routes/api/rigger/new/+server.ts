import { error, json } from '@sveltejs/kit';
import { loadRegionSet } from '$lib/server/editorRegions';
import { resolveRigSkeletonBody } from '$lib/server/riggerNewRig';
import { SUB } from '$lib/server/projectPaths';
import { getObjectBytes, putObjectBytes, putObjectText } from '$lib/server/r2';
import { regionsToSpineAtlas, reorientRotatedRegionsForSpine } from '$lib/server/spine';
import { buildSkeletonsIndex, spineBundleNameTaken } from '$lib/server/spineIndex';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const basename = (k: string): string => {
	const i = k.lastIndexOf('/');
	return i === -1 ? k : k.slice(i + 1);
};

/**
 * Create a NEW rig as a self-contained spine bundle under `spines/<name>/`:
 * synthesise a Spine `.atlas` from the chosen manifest's regions, copy the packed
 * page image, and write a `.irig`. When `rigId` is supplied the `.irig` body is a saved
 * library rig's skeleton (bones + animations + constraints come over intact; its
 * attachment region names intentionally won't resolve against the new atlas until the
 * user re-attaches this object's art). Otherwise it is a blank skeleton (root bone +
 * default skin). Then reindex so it appears in the skeleton list. This is the
 * Atlas-Maker→Rigger bridge — a fresh project has manifests (post-compose) but no spine
 * bundles yet. `rigger`-gated.
 *
 * With `noAtlas: true` (and no `manifestKey`) the bundle gets a 1×1 transparent
 * placeholder page + a page-only `.atlas` (no regions). The rig opens with no images
 * attached — the user wires an atlas later via "⟳ source…" (resync) or a slot's image
 * dropdown. The client's tolerant loader is what lets such a rig (and a saved rig whose
 * region names don't resolve) build without throwing.
 *
 * Body: `{ manifestKey, name, rigId? }` or `{ noAtlas: true, name, rigId? }`.
 */
// A 1×1 fully-transparent PNG — the placeholder page for atlas-less rigs.
const BLANK_PAGE_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64',
);
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const manifestKey = body && typeof body.manifestKey === 'string' ? body.manifestKey : '';
	const noAtlas = !!(body && body.noAtlas === true);
	const name = (body && typeof body.name === 'string' ? body.name : '')
		.trim()
		.replace(/[^A-Za-z0-9_-]/g, '_');
	if (!manifestKey && !noAtlas) throw error(400, 'missing manifestKey');
	if (!name) throw error(400, 'missing rig name');

	const spinesPrefix = SUB.spines(clientKey, projectKey);
	const bundle = `${spinesPrefix}/${name}`;
	if (await spineBundleNameTaken(spinesPrefix, name))
		throw error(409, `a rig named "${name}" already exists (names are case-insensitive)`);

	const rigId = body && typeof body.rigId === 'string' ? body.rigId : '';
	const skeleton = await resolveRigSkeletonBody(rigId);

	// Resolve the page image + `.atlas` text + region count for either path.
	let pageName: string;
	let pageBody: Uint8Array;
	let pageContentType = 'image/png';
	let atlasText: string;
	let regionCount = 0;
	let sidecar: string | null = null;

	if (noAtlas) {
		// Atlas-less rig: 1×1 transparent placeholder page + a page-only `.atlas`. No
		// source.json — so "⟳ source…" prompts the picker when the user attaches an atlas.
		pageName = `${name}.png`;
		pageBody = BLANK_PAGE_PNG;
		atlasText = regionsToSpineAtlas(pageName, 1, 1, []);
	} else {
		const rs = await loadRegionSet(manifestKey, clientKey, projectKey);
		if (!rs.regions.length) throw error(400, 'that atlas has no regions');
		if (!rs.pageKey) throw error(400, "couldn't resolve the atlas page image");
		if (!rs.pageWidth || !rs.pageHeight)
			throw error(400, 'atlas manifest is missing the page size');

		const page = await getObjectBytes(rs.pageKey);
		if (!page) throw error(404, 'atlas page image not found in R2');
		pageName = basename(rs.pageKey);
		pageContentType = page.contentType;
		regionCount = rs.regions.length;
		atlasText = regionsToSpineAtlas(pageName, rs.pageWidth, rs.pageHeight, rs.regions);
		// Re-orient CW-packed rotated regions to Spine's CCW `rotate:90` convention so they
		// don't render upside down in the Rigger (no-op when no region is rotated).
		pageBody = await reorientRotatedRegionsForSpine(page.body, rs.regions);
		// Remember the source atlas so a future "⟳ Re-sync atlas" is one click (re-pull
		// the latest page + re-synth the .atlas after the source is recoloured/edited).
		// Ignored by buildSkeletonsIndex (only skeleton/atlas files are indexed) and a
		// valid `/spine/file` name.
		sidecar = JSON.stringify({ manifestKey, pageName });
	}

	await putObjectBytes(`${bundle}/${pageName}`, pageBody, pageContentType);
	await putObjectText(`${bundle}/${name}.atlas`, atlasText, 'text/plain; charset=utf-8');
	await putObjectText(`${bundle}/${name}.irig`, JSON.stringify(skeleton), 'application/json');
	if (sidecar) await putObjectText(`${bundle}/source.json`, sidecar, 'application/json');

	const index = await buildSkeletonsIndex(spinesPrefix, spinesPrefix);
	await putObjectText(`${spinesPrefix}/skeletons.json`, JSON.stringify(index), 'application/json');

	return json({
		ok: true,
		dir: Buffer.from(name, 'utf8').toString('base64url'),
		stem: name,
		atlas_file: `${name}.atlas`,
		regions: regionCount,
	});
};
