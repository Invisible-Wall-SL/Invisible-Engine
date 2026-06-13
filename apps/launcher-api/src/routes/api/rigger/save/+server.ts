import { error, json } from '@sveltejs/kit';
import { SUB } from '$lib/server/projectPaths';
import { putObjectText } from '$lib/server/r2';
import { buildSkeletonsIndex } from '$lib/server/spineIndex';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Save a Rigger-edited skeleton to R2 as `<bundle>/<stem>.irig` (Spine 4.2 JSON
 * under our extension) WITHOUT clobbering the artist's source `.json`, then rebuild
 * the project's `skeletons.json` so the saved edit is listed + re-openable in the
 * tool. Gated by `rigger` access; path-guarded; the body must be a real skeleton.
 *
 * Body: `{ dir: <base64url bundle dir, '' = spines root>, stem: <file stem>,
 *          skeleton: <object|string Spine JSON> }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) throw error(400, 'bad body');

	const dirB64 = typeof body.dir === 'string' ? body.dir : '';
	const stem = typeof body.stem === 'string' ? body.stem : '';
	if (!stem) throw error(400, 'missing stem');

	let dir = '';
	if (dirB64) {
		try {
			dir = Buffer.from(dirB64, 'base64url').toString('utf8');
		} catch {
			throw error(400, 'bad dir');
		}
	}
	if (dir.includes('..') || stem.includes('..') || stem.includes('/')) throw error(403, 'forbidden');

	let doc: Record<string, unknown> | null = null;
	const raw = body.skeleton;
	if (typeof raw === 'string') {
		try {
			doc = JSON.parse(raw) as Record<string, unknown>;
		} catch {
			throw error(400, 'skeleton is not valid JSON');
		}
	} else if (raw && typeof raw === 'object') {
		doc = raw as Record<string, unknown>;
	}
	if (!doc || !Array.isArray(doc.bones)) throw error(400, 'body.skeleton is not a skeleton (no bones[])');

	const spinesPrefix = SUB.spines(clientKey, projectKey);
	const bundlePrefix = dir ? `${spinesPrefix}/${dir}` : spinesPrefix;
	const key = `${bundlePrefix}/${stem}.irig`;
	await putObjectText(key, JSON.stringify(doc), 'application/json');

	// Re-derive the index from R2 so the new `.irig` shows up in the skeleton list
	// (same final step as the editor's spine reindex).
	const index = await buildSkeletonsIndex(spinesPrefix, spinesPrefix);
	await putObjectText(`${spinesPrefix}/skeletons.json`, JSON.stringify(index), 'application/json');

	return json({ ok: true, key, count: index.skeletons.length });
};
