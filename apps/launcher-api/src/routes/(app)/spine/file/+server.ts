import { error } from '@sveltejs/kit';
import { SESSION_COOKIE, getActiveProjectKey } from '$lib/server/auth';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { fetchSpineBundleFile, requireSpineAccess } from '$lib/server/spine';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	await requireSpineAccess(locals);

	const dirB64 = url.searchParams.get('dir') ?? '';
	const name = url.searchParams.get('name') ?? '';
	const preferPng = url.searchParams.get('pp') === '1';
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

	const projectKey =
		(await getActiveProjectKey(cookies.get(SESSION_COOKIE))) ?? DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	const file = await fetchSpineBundleFile(clientKey, projectKey, bundle, name, preferPng);
	if (!file) throw error(404, 'not found');
	return new Response(file.body, {
		headers: { 'content-type': file.contentType, 'cache-control': 'no-store' },
	});
};
