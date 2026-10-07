import { error } from '@sveltejs/kit';
import { SESSION_COOKIE } from '$lib/server/auth';
import { fetchRigBundleFile, requireRigAccess } from '$lib/server/rig';
import { sessionProjectScope } from '$lib/server/toolScope';
import { userContentHeaders } from '$lib/server/userContent';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	await requireRigAccess(locals);

	const dirB64 = url.searchParams.get('dir') ?? '';
	const name = url.searchParams.get('name') ?? '';
	const preferPng = url.searchParams.get('pp') === '1';
	// `shared=1` pins the lookup to `_shared/spines/` — used by the engine boot-mark preview,
	// which must resolve exactly the way its export does.
	const forceShared = url.searchParams.get('shared') === '1';
	if (!dirB64 || !name) throw error(400, 'missing dir/name');

	let bundle: string;
	try {
		bundle = Buffer.from(dirB64, 'base64url').toString('utf8');
	} catch {
		throw error(400, 'bad dir');
	}
	if (bundle.includes('..') || name.includes('..') || name.includes('/')) {
		throw error(403, 'forbidden');
	}

	const { clientKey, projectKey } = await sessionProjectScope(
		locals.user,
		cookies.get(SESSION_COOKIE),
	);

	const file = await fetchRigBundleFile(clientKey, projectKey, bundle, name, preferPng, {
		forceShared,
	});
	if (!file) throw error(404, 'not found');
	return new Response(file.body, {
		headers: { ...userContentHeaders(name), 'cache-control': 'no-store' },
	});
};
