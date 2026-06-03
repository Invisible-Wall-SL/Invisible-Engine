import { error, json } from '@sveltejs/kit';
import { assertAllowed, gate } from '$lib/server/ftpScope';
import { copyObject, deleteObjects, listAllKeys } from '$lib/server/r2';
import type { RequestHandler } from './$types';

interface MoveBody {
	from?: unknown;
	to?: unknown;
}

/**
 * Move/rename a file or folder. R2 has no native move, so we copy then delete.
 * A trailing `/` on `from` means a folder: every key under it is re-based onto
 * `to`. Source AND destination keys are validated against the project's allowed
 * prefixes before any write.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const scope = await gate(locals, cookies);

	let body: MoveBody;
	try {
		body = (await request.json()) as MoveBody;
	} catch {
		throw error(400, 'invalid json');
	}

	const from = body.from;
	const to = body.to;
	if (typeof from !== 'string' || typeof to !== 'string' || !from || !to) {
		throw error(400, 'from and to are required');
	}
	if (from === to) throw error(400, 'from and to are identical');
	assertAllowed(from, scope);
	assertAllowed(to, scope);

	if (from.endsWith('/')) {
		if (!to.endsWith('/')) throw error(400, 'folder destination must end with /');
		const keys = await listAllKeys(from);
		const toDelete: string[] = [];
		for (const key of keys) {
			const dest = to + key.slice(from.length);
			assertAllowed(dest, scope);
			await copyObject(key, dest);
			toDelete.push(key);
		}
		await deleteObjects(toDelete);
		return json({ moved: toDelete.length });
	}

	if (to.endsWith('/')) throw error(400, 'file destination must not end with /');
	await copyObject(from, to);
	await deleteObjects([from]);
	return json({ moved: 1 });
};
