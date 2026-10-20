import { error, json } from '@sveltejs/kit';
import { loadCinematic } from '$lib/server/cinematicStorage';
import { assertReach, cinematicGate } from '$lib/server/cinematicAccess';
import { scopeMismatch } from '$lib/server/scopeGuard';
import { loadSharedCinematic } from '$lib/server/sharedCinematics';
import { linkOf, resolveLinked } from '$lib/timeline/sharedTimelines';
import type { CinematicDoc } from 'engine-layout';
import type { RequestHandler } from './$types';

/**
 * Load one cinematic, WITH the ETag its next save must match.
 *
 * The etag is returned even when `doc` is null-because-malformed: an object that exists must be
 * overwritten with `ifMatch`, never created with `ifNoneMatch:'*'` (which would 412 forever and
 * leave a corrupt cinematic permanently unsaveable).
 *
 * A LINK to a shared timeline (Rive plan Phase 9d) comes back resolved against the version it pins
 * — the timeline it plays — with `link` saying what it links to and the shared copy's latest
 * version (`updateAvailable` when that is newer). `stub` is the stored link itself, which is what
 * a save of it writes. A link whose shared version is gone has `link.missing` and its stub as doc.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey, access } = await cinematicGate(locals, cookies);
	const id = url.searchParams.get('id');
	if (!id) throw error(400, 'missing id');
	const mismatch = scopeMismatch(url.searchParams.get('projectKey') ?? undefined, projectKey);
	if (mismatch) return mismatch;

	const { doc, etag } = await loadCinematic(clientKey, projectKey, id);
	if (!doc && etag === null) throw error(404, `No cinematic "${id}" in ${projectKey}.`);
	assertReach(access, doc);
	const link = linkOf(doc);
	if (!doc || !link) return json({ ok: true, projectKey, doc, etag, malformed: !doc });
	const [pinned, latest] = await Promise.all([
		loadSharedCinematic(link.id, link.version),
		loadSharedCinematic(link.id),
	]);
	const stub = doc as unknown as CinematicDoc;
	return json({
		ok: true,
		projectKey,
		doc: pinned.doc ? resolveLinked(stub, pinned.doc) : stub,
		stub,
		etag,
		malformed: false,
		link: {
			...link,
			name: pinned.doc?.name ?? latest.doc?.name ?? link.id,
			latest: latest.doc?.version ?? null,
			missing: !pinned.doc,
		},
	});
};
