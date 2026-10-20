import { error, json } from '@sveltejs/kit';
import { cinematicGate } from '$lib/server/cinematicAccess';
import { loadSharedCinematic } from '$lib/server/sharedCinematics';
import type { RequestHandler } from './$types';

/**
 * One shared timeline: the latest, or `?version=N`. `etag` is the latest pointer's — what a promote
 * of this id must send as its `baseEtag` (`null` = no R2 copy yet, a starter or a new id).
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	await cinematicGate(locals, cookies);
	const id = url.searchParams.get('id');
	if (!id) throw error(400, 'missing id');
	const raw = url.searchParams.get('version');
	const version = raw === null ? undefined : Number(raw);
	if (version !== undefined && (!Number.isInteger(version) || version < 1))
		throw error(400, 'malformed version');
	const { doc, etag } = await loadSharedCinematic(id, version);
	return json({ ok: true, doc, etag });
};
