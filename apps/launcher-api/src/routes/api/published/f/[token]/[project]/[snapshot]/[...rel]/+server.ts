import { DEPLOY_CORS_HEADERS, assertSafeRel, deployContentType } from '$lib/server/deployServe';
import { projectReadClient } from '$lib/server/projects';
import { isSnapshotId, snapshotDeployKey } from '$lib/server/publishedRuntime';
import { getObjectStream } from '$lib/server/r2';
import type { RequestHandler } from './$types';

/**
 * A published snapshot's frozen `deploy/` files — the `assetBase` a PLAYER boot is handed:
 *
 *   GET /api/published/f/<token>/<project>/<snapshot>/<...rel>
 *
 * The path twin of `/api/deploy/f/…` (same token gate, same relative-resolution reason for the
 * path form), except that what it serves can never change: a snapshot is written once by Publish
 * and only ever deleted. So a hit is `immutable` for a year, and a republish is a NEW snapshot id,
 * i.e. new URLs, rather than an overwrite a cache could hold on to.
 *
 * Misses are `no-store`: a snapshot being swept, or a mistyped path, must not be pinned at the edge.
 */
const miss = (status: number, message: string) =>
	new Response(message, {
		status,
		headers: { ...DEPLOY_CORS_HEADERS, 'cache-control': 'no-store' },
	});

export const GET: RequestHandler = async ({ params }) => {
	if (!params.rel || !isSnapshotId(params.snapshot)) return miss(400, 'bad path');
	assertSafeRel(params.rel);
	const client = await projectReadClient(params.project, params.token);
	if (client === null) return miss(401, 'Invalid or missing token.');
	const obj = await getObjectStream(
		snapshotDeployKey(client, params.project, params.snapshot, params.rel),
	);
	if (!obj) return miss(404, 'not found');
	return new Response(obj.body, {
		headers: {
			...DEPLOY_CORS_HEADERS,
			'content-type': deployContentType(params.rel),
			...(obj.contentLength === null ? {} : { 'content-length': String(obj.contentLength) }),
			'cache-control': 'public, max-age=31536000, immutable',
		},
	});
};

export const OPTIONS: RequestHandler = async () =>
	new Response(null, { status: 204, headers: DEPLOY_CORS_HEADERS });
