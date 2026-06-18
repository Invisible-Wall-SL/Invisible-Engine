import { error, json } from '@sveltejs/kit';
import { r2Slug, sharedAnimationKey, sharedAnimationsIndexKey } from '$lib/server/projectPaths';
import { deleteObject, getObjectText, putObjectText } from '$lib/server/r2';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Remove one animation-library entry: delete `_shared/animations/<id>.json` and drop
 * its row from the catalog `index.json`. Gated by `rigger`; id path-guarded via
 * `r2Slug`. Body: `{ id }`.
 */
interface AnimRow {
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

	await deleteObject(sharedAnimationKey(id));

	const raw = await getObjectText(sharedAnimationsIndexKey);
	if (raw) {
		try {
			const parsed = JSON.parse(raw) as { animations?: AnimRow[] };
			if (parsed && Array.isArray(parsed.animations)) {
				parsed.animations = parsed.animations.filter((a) => a.id !== id);
				await putObjectText(sharedAnimationsIndexKey, JSON.stringify(parsed), 'application/json');
			}
		} catch {
			// A corrupt index is left untouched; the object delete above already succeeded.
		}
	}

	return json({ ok: true });
};
