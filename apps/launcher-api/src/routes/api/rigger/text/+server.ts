import { error, json } from '@sveltejs/kit';
import { riggerAtlasFile, riggerBundlePrefix } from '$lib/server/riggerBundle';
import {
	RIG_TEXT_PAGE_RE,
	normalizeRigTextDoc,
	rigTextDocKey,
	rigTextRegionNames,
	type RigTextDoc,
} from '$lib/server/riggerText';
import {
	ConflictError,
	deleteObjects,
	getObjectTextWithEtag,
	listAllKeys,
	objectExists,
	precondition,
	putObjectText,
} from '$lib/server/r2';
import { ensureBundleAtlasFresh } from '$lib/server/spineBundleSync';
import { gate } from '$lib/server/toolScope';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { RequestHandler } from './$types';

/**
 * A rig's TEXT document — the localized art elements whose rasterised strings are packed onto
 * a second page of the rig bundle's `.atlas` (design `invisible-cinematic.md` §12.4a; model in
 * `$lib/server/riggerText.ts`).
 *
 * GET  `?dir=<b64 bundle dir>` → `{ doc, etag, regions }`.
 * POST `{ dir, atlasFile, doc, baseEtag | force }` → conditional write + an immediate atlas
 *      re-compose, so the tool can reload the rig and see the new regions in one round trip.
 */

const MAX_ELEMENTS = 64;

export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const bundlePrefix = riggerBundlePrefix(clientKey, projectKey, url.searchParams.get('dir') ?? '');
	const obj = await getObjectTextWithEtag(rigTextDocKey(bundlePrefix));
	let doc: RigTextDoc;
	try {
		doc = normalizeRigTextDoc(obj ? JSON.parse(obj.text) : null);
	} catch {
		doc = normalizeRigTextDoc(null);
	}
	// `etag` is read off the OBJECT, never inferred from a successful parse: a corrupt doc also
	// normalizes to empty, so treating "empty" as "absent" would send a create precondition and
	// 412 forever (the `loadDocWithEtag` lesson).
	return json({ doc, etag: obj?.etag ?? null, regions: rigTextRegionNames(doc) });
};

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) throw error(400, 'bad body');

	// SCOPE GUARD — the tab resolved its project when the rig opened; this endpoint resolves it
	// from the SESSION. Switching project in another tab would otherwise write this rig's text
	// into an unrelated project's bundle. `force` deliberately does not bypass it.
	if (typeof body.projectKey === 'string' && body.projectKey !== projectKey) {
		return json(
			{
				ok: false,
				error: 'scope-mismatch',
				message:
					`This tab is editing "${body.projectKey}" but your active project is now ` +
					`"${projectKey}". Reload before saving — this write would land in the wrong project.`,
			},
			{ status: 409 },
		);
	}

	const bundlePrefix = riggerBundlePrefix(clientKey, projectKey, body.dir);
	const atlasFile = riggerAtlasFile(body.atlasFile);
	const baseEtag = writeBaseEtagJson(body);

	const doc = normalizeRigTextDoc(body.doc);
	if (doc.elements.length > MAX_ELEMENTS) {
		throw error(400, `A rig can hold at most ${MAX_ELEMENTS} text elements.`);
	}
	// The page is what the regions SAMPLE. Trust the client for the rects (it packed them) but
	// never for the page's existence — a doc pointing at pixels that were never uploaded composes
	// an atlas whose second page 404s, and a spine runtime fails that opaquely.
	if (doc.elements.length && !doc.page) {
		throw error(400, 'text elements were sent with no packed page');
	}
	if (doc.page && !(await objectExists(`${bundlePrefix}/${doc.page.file}`))) {
		throw error(400, `the text page "${doc.page.file}" was not uploaded — retry the save`);
	}

	doc.updatedAt = new Date().toISOString();

	let etag: string | null;
	try {
		etag = await putObjectText(
			rigTextDocKey(bundlePrefix),
			JSON.stringify(doc),
			'application/json',
			precondition(baseEtag),
		);
	} catch (e) {
		if (e instanceof ConflictError) {
			return json(
				{
					ok: false,
					error: 'conflict',
					message:
						'Someone else changed this rig’s text while you were editing. ' +
						'Your changes are still here — reload the rig to get their version first.',
				},
				{ status: 409 },
			);
		}
		console.error('[rigger/text] save failed:', e);
		return json(
			{
				ok: false,
				error: 'save-failed',
				message: `Could not write the rig text document: ${e instanceof Error ? e.message : String(e)}`,
			},
			{ status: 500 },
		);
	}

	// Re-compose the bundle `.atlas` NOW (force — the revision's text half just changed, but the
	// author is waiting and a lazy heal on the next read would show them a rig with no text).
	const synced = await ensureBundleAtlasFresh(clientKey, projectKey, bundlePrefix, atlasFile, {
		force: true,
	}).catch((e: unknown) => {
		console.error('[rigger/text] atlas re-compose failed:', e);
		return null;
	});

	// Sweep superseded text pages. Page filenames are content-addressed, so the CURRENT one is
	// the only one any document can reference; a leftover is either the previous bake or the
	// losing half of a race whose document write never landed.
	let swept = 0;
	try {
		const keep = doc.page?.file ?? '';
		const stale = (await listAllKeys(`${bundlePrefix}/`)).filter((k) => {
			const name = k.slice(bundlePrefix.length + 1);
			return name !== keep && !name.includes('/') && RIG_TEXT_PAGE_RE.test(name);
		});
		if (stale.length) {
			await deleteObjects(stale);
			swept = stale.length;
		}
	} catch (e) {
		console.warn('[rigger/text] stale page sweep failed (harmless):', e);
	}

	return json({
		ok: true,
		etag,
		doc,
		regions: rigTextRegionNames(doc),
		atlasSynced: !!synced,
		swept,
	});
};
