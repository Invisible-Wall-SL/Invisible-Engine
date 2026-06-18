import { error, json } from '@sveltejs/kit';
import { loadRegionSet } from '$lib/server/editorRegions';
import { SUB } from '$lib/server/projectPaths';
import {
	deleteObject,
	getObjectBytes,
	getObjectText,
	putObjectBytes,
	putObjectText,
} from '$lib/server/r2';
import { regionsToSpineAtlas } from '$lib/server/spine';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const basename = (k: string): string => {
	const i = k.lastIndexOf('/');
	return i === -1 ? k : k.slice(i + 1);
};

/**
 * Re-sync a rig's atlas: re-pull the latest packed page image AND re-synthesise the
 * `.atlas` from the SOURCE atlas (manifest) into the rig's self-contained bundle,
 * leaving its `.irig` (bones + animations + attachments) untouched. This is what
 * fixes "the rig still shows the OLD colour after I recoloured the source atlas" —
 * the bundle holds a COPY of the page snapshotted at creation, never auto-updated.
 *
 * The source atlas is REMEMBERED in `<bundle>/source.json` (written by `new`), so a
 * re-sync is one click. For rigs created before that sidecar existed, the client
 * passes `manifestKey` (picked once); this re-sync then writes the sidecar so it is
 * one click thereafter. `rigger`-gated; path-guarded; does NOT reindex skeletons.json
 * (the skeleton list + atlas filename are unchanged).
 *
 * Body: `{ dir: <base64url bundle dir, '' = spines root>, atlasFile: <.atlas name in
 *          the bundle>, manifestKey?: <override / picked source> }`.
 *
 * Returns `{ ok:false, needsAtlas:true }` (HTTP 200) when no source is known yet, so
 * the client can prompt for one.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) throw error(400, 'bad body');

	const dirB64 = typeof body.dir === 'string' ? body.dir : '';
	const atlasFile = typeof body.atlasFile === 'string' ? body.atlasFile : '';
	if (!atlasFile || atlasFile.includes('..') || atlasFile.includes('/')) {
		throw error(400, 'missing or bad atlasFile');
	}

	let dir = '';
	if (dirB64) {
		try {
			dir = Buffer.from(dirB64, 'base64url').toString('utf8');
		} catch {
			throw error(400, 'bad dir');
		}
	}
	if (dir.includes('..')) throw error(403, 'forbidden');

	const spinesPrefix = SUB.spines(clientKey, projectKey);
	const bundlePrefix = dir ? `${spinesPrefix}/${dir}` : spinesPrefix;

	// Resolve the source manifest: body override, else the remembered sidecar.
	let manifestKey = typeof body.manifestKey === 'string' ? body.manifestKey : '';
	if (!manifestKey) {
		const sidecar = await getObjectText(`${bundlePrefix}/source.json`);
		if (sidecar) {
			try {
				const parsed = JSON.parse(sidecar) as { manifestKey?: unknown };
				if (typeof parsed.manifestKey === 'string') manifestKey = parsed.manifestKey;
			} catch {
				/* corrupt sidecar → fall through to the picker */
			}
		}
	}
	// No source known (e.g. an upload-image rig, or a rig from before the sidecar) →
	// tell the client to show the atlas picker. Not a 4xx: this is an expected path.
	if (!manifestKey) return json({ ok: false, needsAtlas: true });

	const rs = await loadRegionSet(manifestKey, clientKey, projectKey);
	if (!rs.regions.length) throw error(400, 'that atlas has no regions');
	if (!rs.pageKey) throw error(400, "couldn't resolve the atlas page image");
	if (!rs.pageWidth || !rs.pageHeight) throw error(400, 'atlas manifest is missing the page size');

	const page = await getObjectBytes(rs.pageKey);
	if (!page) throw error(404, 'atlas page image not found in R2');
	const pageName = basename(rs.pageKey);

	// Read the bundle's CURRENT atlas to find the old page filename (first non-empty
	// trimmed line). If the page name changed, delete the orphaned old image AFTER the
	// new page is written so a failure can't leave the rig with no page at all.
	const oldAtlas = await getObjectText(`${bundlePrefix}/${atlasFile}`);
	const oldPageName = oldAtlas
		? (oldAtlas
				.split(/\r?\n/)
				.map((l) => l.trim())
				.find((l) => l !== '') ?? '')
		: '';

	const atlasText = regionsToSpineAtlas(pageName, rs.pageWidth, rs.pageHeight, rs.regions);
	await putObjectBytes(`${bundlePrefix}/${pageName}`, page.body, page.contentType);
	await putObjectText(`${bundlePrefix}/${atlasFile}`, atlasText, 'text/plain; charset=utf-8');
	// Refresh the sidecar so a picked source becomes remembered (one-click next time).
	await putObjectText(
		`${bundlePrefix}/source.json`,
		JSON.stringify({ manifestKey, pageName }),
		'application/json',
	);

	if (oldPageName && oldPageName !== pageName) {
		await deleteObject(`${bundlePrefix}/${oldPageName}`);
	}

	return json({ ok: true, pageName, regions: rs.regions.length });
};
