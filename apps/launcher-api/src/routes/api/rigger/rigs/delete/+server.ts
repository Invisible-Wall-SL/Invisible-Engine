import { error, json } from '@sveltejs/kit';
import { r2Slug, sharedRigKey, sharedRigsIndexKey } from '$lib/server/projectPaths';
import { deleteObject, getObjectText, putObjectText } from '$lib/server/r2';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Remove one rig-library entry: delete `_shared/rigs/<id>.json` and drop its row from
 * the catalog `index.json`. Gated by `rigger`; id path-guarded via `r2Slug`.
 * Body: `{ id }`.
 */
interface RigRow {
	id: string;
	[k: string]: unknown;
}

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) throw error(400, 'bad body');
	const id = r2Slug(typeof body.id === 'string' ? body.id : '');
	if (!id || id.includes('..') || id.includes('/')) throw error(400, 'bad id');

	await deleteObject(sharedRigKey(id));

	const raw = await getObjectText(sharedRigsIndexKey);
	if (raw) {
		try {
			const parsed = JSON.parse(raw) as { rigs?: RigRow[] };
			if (parsed && Array.isArray(parsed.rigs)) {
				parsed.rigs = parsed.rigs.filter((rrow) => rrow.id !== id);
				await putObjectText(sharedRigsIndexKey, JSON.stringify(parsed), 'application/json');
			}
		} catch {
			// A corrupt index is left untouched; the object delete above already succeeded.
		}
	}

	return json({ ok: true });
};
