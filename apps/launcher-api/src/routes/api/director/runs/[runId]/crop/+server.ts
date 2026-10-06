import { error } from '@sveltejs/kit';
import { requireDirectorAccess, requireOwnedRun } from '$lib/server/director/access';
import { cropKey } from '$lib/server/director/mockups';
import { REGION } from '$lib/server/director/ops/mockups';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { getObjectBytes } from '$lib/server/r2';
import type { RequestHandler } from './$types';

const REGION_NAME = new RegExp(REGION);

/**
 * `GET /api/director/runs/[runId]/crop?region=<name>` — the mockup crop the breakdown saved for a
 * template region in this run (`director/crops/<runId>/<region>.png`, written by the worker
 * through `mockups.save_crops`), for the Mockup-breakdown screen. Owner-only, like the summary. A
 * name outside the adapter's own region pattern and a region with no crop are the same 404. A
 * revised breakdown rewrites the crops under the same keys, so the answer is kept only briefly.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const user = await requireDirectorAccess(locals);
	const run = await requireOwnedRun(user, params.runId);
	const region = url.searchParams.get('region') ?? '';
	if (!REGION_NAME.test(region)) throw error(404, 'No crop for that region.');
	const got = await getObjectBytes(
		cropKey(run.clientKey ?? UNASSIGNED_CLIENT, run.projectKey, run.id, region),
	);
	if (!got) throw error(404, 'No crop for that region.');
	return new Response(got.body, {
		headers: {
			'content-type': 'image/png',
			'content-length': String(got.body.byteLength),
			'cache-control': 'private, max-age=300',
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox",
		},
	});
};
