import { error, json } from '@sveltejs/kit';
import { requireDirectorAccess, requireOwnedRun } from '$lib/server/director/access';
import { directorSavedBy } from '$lib/server/director/adapter';
import { NO_STORE, answering } from '$lib/server/director/api';
import { atlasFetch } from '$lib/server/director/atlasClient';
import { ATLAS, MAX_IMAGE_BYTES, REGION, VARIANT_ID } from '$lib/server/director/ops/atlas';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import type { RequestHandler } from './$types';

const ATLAS_ID = new RegExp(ATLAS);
const REGION_NAME = new RegExp(REGION);
const VARIANT = new RegExp(VARIANT_ID);

/**
 * `GET /api/director/runs/[runId]/variant?atlas=<id>&region=<name>&id=<variant id>&size=thumb|full`
 * — one rendered variant's image out of the Atlas Maker, for the Live run gallery: the owner-scoped
 * twin of `atlas.get_variant_image`, asked as the run's owner through the same atlas-tool call
 * (`atlasFetch`), and read-only like it. Owner-only, like the summary. A name outside the adapter's
 * own patterns and a variant atlas-tool answers with its placeholder are the same 404. A variant
 * id's bytes never change, so the answer is kept for an hour.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const user = await requireDirectorAccess(locals);
	const run = await requireOwnedRun(user, params.runId);
	const atlas = url.searchParams.get('atlas') ?? '';
	const region = url.searchParams.get('region') ?? '';
	const id = url.searchParams.get('id') ?? '';
	const size = url.searchParams.get('size') ?? 'thumb';
	if (
		!ATLAS_ID.test(atlas) ||
		!REGION_NAME.test(region) ||
		!VARIANT.test(id) ||
		(size !== 'thumb' && size !== 'full')
	) {
		throw error(404, 'No such variant.');
	}
	return answering(async () => {
		const answer = await atlasFetch(
			{
				run,
				owner: user,
				agent: 'worker',
				scope: { clientKey: run.clientKey ?? UNASSIGNED_CLIENT, projectKey: run.projectKey },
				savedBy: directorSavedBy(run, user, 'worker'),
			},
			{
				method: 'GET',
				path: `/${size === 'full' ? 'vfull' : 'vthumb'}/${encodeURIComponent(region)}`,
				atlas,
				query: { id },
			},
		);
		const contentType = answer.contentType.split(';')[0].trim();
		// A missing variant is answered with a placeholder SVG, not a 404.
		if (!/^image\/(png|jpeg|webp)$/.test(contentType)) throw error(404, 'No such variant.');
		if (answer.bytes.length > MAX_IMAGE_BYTES) {
			return json(
				{ error: 'too_large', message: `Variant ${id} is too large to return; ask for the thumb.` },
				{ status: 413, headers: NO_STORE },
			);
		}
		// The fetch's view is typed over `ArrayBufferLike`, which `Response` refuses; it is a plain
		// `ArrayBuffer` on Node, so the exact slice is handed over without a copy of the type's doubt.
		const { buffer, byteOffset, byteLength } = answer.bytes;
		return new Response(buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer, {
			headers: {
				'content-type': contentType,
				'content-length': String(answer.bytes.length),
				'cache-control': 'private, max-age=3600',
				'x-content-type-options': 'nosniff',
				'content-security-policy': "default-src 'none'; sandbox",
			},
		});
	});
};
