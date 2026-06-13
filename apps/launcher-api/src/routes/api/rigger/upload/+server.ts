import { error, json } from '@sveltejs/kit';
import { SUB } from '$lib/server/projectPaths';
import { putObjectBytes, putObjectText } from '$lib/server/r2';
import { regionsToSpineAtlas, type SynthRegion } from '$lib/server/spine';
import { buildSkeletonsIndex, spineBundleNameTaken } from '$lib/server/spineIndex';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/**
 * Create a NEW rig from RAW UPLOADED IMAGES. The browser packs the chosen images
 * onto one page (Canvas) and sends the page PNG + the region rects; this writes the
 * page, a synthesised Spine `.atlas` (`regionsToSpineAtlas`), and a blank `.irig`
 * into `spines/<name>/`, then reindexes. So a rig can be built from brand-new art
 * with no Atlas Maker step. `rigger`-gated.
 *
 * Body: `{ name, page (data URL or bare base64 PNG), pageWidth, pageHeight,
 *          regions: [{ name, x, y, w, h }] }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) throw error(400, 'bad body');
	const name = (typeof body.name === 'string' ? body.name : '').trim().replace(/[^A-Za-z0-9_-]/g, '_');
	if (!name) throw error(400, 'missing rig name');
	const pageWidth = num(body.pageWidth);
	const pageHeight = num(body.pageHeight);
	if (!(pageWidth > 0) || !(pageHeight > 0)) throw error(400, 'bad page size');

	const rawRegions = Array.isArray(body.regions) ? body.regions : [];
	if (!rawRegions.length) throw error(400, 'no regions');
	if (rawRegions.length > 1024) throw error(400, 'too many regions');
	const regions: SynthRegion[] = [];
	for (const r of rawRegions as Record<string, unknown>[]) {
		const rn = typeof r.name === 'string' ? r.name.trim() : '';
		const x = num(r.x), y = num(r.y), w = num(r.w), h = num(r.h);
		if (!rn || [x, y, w, h].some(Number.isNaN)) throw error(400, 'bad region');
		regions.push({ name: rn, x, y, w, h });
	}

	// decode the page PNG (data URL or bare base64)
	const pageStr = typeof body.page === 'string' ? body.page : '';
	const b64 = pageStr.includes(',') ? pageStr.slice(pageStr.indexOf(',') + 1) : pageStr;
	if (!b64) throw error(400, 'missing page image');
	let pageBytes: Uint8Array;
	try {
		pageBytes = new Uint8Array(Buffer.from(b64, 'base64'));
	} catch {
		throw error(400, 'page image not valid base64');
	}
	if (!pageBytes.length || pageBytes.length > 32 * 1024 * 1024) throw error(400, 'page image empty or too large');

	const spinesPrefix = SUB.spines(clientKey, projectKey);
	const bundle = `${spinesPrefix}/${name}`;
	if (await spineBundleNameTaken(spinesPrefix, name)) throw error(409, `a rig named "${name}" already exists (names are case-insensitive)`);

	const pageName = `${name}.png`;
	const atlasText = regionsToSpineAtlas(pageName, pageWidth, pageHeight, regions);
	const blank = { skeleton: { spine: '4.2' }, bones: [{ name: 'root' }], slots: [], skins: [{ name: 'default', attachments: {} }], animations: {} };

	await putObjectBytes(`${bundle}/${pageName}`, pageBytes, 'image/png');
	await putObjectText(`${bundle}/${name}.atlas`, atlasText, 'text/plain; charset=utf-8');
	await putObjectText(`${bundle}/${name}.irig`, JSON.stringify(blank), 'application/json');

	const index = await buildSkeletonsIndex(spinesPrefix, spinesPrefix);
	await putObjectText(`${spinesPrefix}/skeletons.json`, JSON.stringify(index), 'application/json');

	return json({
		ok: true,
		dir: Buffer.from(name, 'utf8').toString('base64url'),
		stem: name,
		atlas_file: `${name}.atlas`,
		regions: regions.length,
	});
};
