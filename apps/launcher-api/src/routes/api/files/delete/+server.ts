import { error, json } from '@sveltejs/kit';
import { assertAllowed, gate } from '$lib/server/ftpScope';
import { deleteObjects, listAllKeys } from '$lib/server/r2';
import type { RequestHandler } from './$types';

interface DeleteBody {
	keys?: unknown;
	prefix?: unknown;
}

/**
 * Delete individual files (`keys`) or an entire folder recursively (`prefix`).
 * Every key — supplied or discovered under the prefix — is re-validated against
 * the project's allowed prefixes before deletion.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies);

	let body: DeleteBody;
	try {
		body = (await request.json()) as DeleteBody;
	} catch {
		throw error(400, 'invalid json');
	}

	let targets: string[];
	if (Array.isArray(body.keys)) {
		const keys = body.keys.filter((k): k is string => typeof k === 'string');
		if (keys.length === 0) throw error(400, 'no keys');
		for (const k of keys) assertAllowed(k, clientKey, projectKey);
		targets = keys;
	} else if (typeof body.prefix === 'string' && body.prefix) {
		assertAllowed(body.prefix, clientKey, projectKey);
		targets = await listAllKeys(body.prefix);
		for (const k of targets) assertAllowed(k, clientKey, projectKey);
	} else {
		throw error(400, 'provide keys[] or prefix');
	}

	await deleteObjects(targets);
	return json({ deleted: targets.length });
};
