import { error, json } from '@sveltejs/kit';
import { jsonObjectOrNull } from '$lib/server/http';
import { SUB } from '$lib/server/projectPaths';
import { presignPut } from '$lib/server/r2';
import { releaseClaimOnCaseClash, rigBundleNameTaken } from '$lib/server/rigIndex';
import { reclaimAbandonedClaims } from '$lib/server/riggerAbandonedClaim';
import {
	IMPORT_PAGE_TYPES,
	MAX_IMPORT_PAGE_BYTES,
	importAtlasPages,
	importSkeleton,
} from '$lib/server/riggerImport';
import { claimNewIrig } from '$lib/server/riggerIrigWrite';
import { scopeMismatch } from '$lib/server/scopeGuard';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/** How long the browser has to PUT each page straight to R2. */
const PUT_TTL_SECONDS = 600;

/**
 * Begin importing an existing rig export (a 4.x skeleton JSON or an `.irig`, its `.atlas` and the
 * atlas's page images) as a NEW rig in `spines/<name>/`. The skeleton is converted here
 * (`importSkeleton`) and claimed as `<name>.irig` with a conditional create, like `＋ New rig`;
 * then each page gets a presigned PUT, since a page routinely exceeds the request-body cap. The
 * atlas is written by `import/finish` once the pages are up, so until then the folder is only the
 * claim and page images — an import abandoned there is reclaimed after 10 minutes
 * (`reclaimAbandonedClaims`) and never lists. `rigger`-gated.
 *
 * Body: `{ name, projectKey, skeleton, atlas, pages: [{ name, size }] }`, `pages` covering exactly
 * the page images the atlas names.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	const body = await jsonObjectOrNull(request);
	if (!body) throw error(400, 'bad body');
	const mismatch = scopeMismatch(body.projectKey, projectKey, { required: true });
	if (mismatch) return mismatch;
	const name = (typeof body.name === 'string' ? body.name : '')
		.trim()
		.replace(/[^A-Za-z0-9_-]/g, '_');
	if (!name) throw error(400, 'missing rig name');

	const skeleton = importSkeleton(body.skeleton);
	if (!skeleton.ok) throw error(skeleton.status, skeleton.message);
	const atlas = importAtlasPages(body.atlas);
	if (!atlas.ok) throw error(atlas.status, atlas.message);

	const sent = new Map<string, number>();
	for (const p of Array.isArray(body.pages) ? body.pages : []) {
		const rec = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
		if (typeof rec.name === 'string' && typeof rec.size === 'number') sent.set(rec.name, rec.size);
	}
	for (const page of atlas.pages) {
		const size = sent.get(page);
		if (size === undefined) throw error(400, `the atlas page "${page}" was not among the files`);
		if (!(size > 0) || size > MAX_IMPORT_PAGE_BYTES)
			throw error(400, `the page "${page}" is empty or over ${MAX_IMPORT_PAGE_BYTES >> 20} MB`);
	}

	const rigsPrefix = SUB.spines(clientKey, projectKey);
	const bundle = `${rigsPrefix}/${name}`;
	await reclaimAbandonedClaims(clientKey, projectKey, rigsPrefix, name);
	if (await rigBundleNameTaken(rigsPrefix, name))
		throw error(409, `a rig named "${name}" already exists (names are case-insensitive)`);
	const irigKey = `${bundle}/${name}.irig`;
	if (!(await claimNewIrig(irigKey, JSON.stringify(skeleton.doc))))
		throw error(409, `a rig named "${name}" was just created by someone else`);
	if (await releaseClaimOnCaseClash(rigsPrefix, name, irigKey))
		throw error(409, `a rig named like "${name}" was just created (names are case-insensitive)`);

	const uploads = await Promise.all(
		atlas.pages.map(async (page) => {
			const contentType = IMPORT_PAGE_TYPES[page.slice(page.lastIndexOf('.')).toLowerCase()];
			const url = await presignPut(`${bundle}/${page}`, contentType, PUT_TTL_SECONDS);
			return { name: page, url, contentType };
		}),
	);
	return json({
		ok: true,
		dir: Buffer.from(name, 'utf8').toString('base64url'),
		stem: name,
		irig: skeleton.doc.irig !== undefined,
		uploads,
	});
};
