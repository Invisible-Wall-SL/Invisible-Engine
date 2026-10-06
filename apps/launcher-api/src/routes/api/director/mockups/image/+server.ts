import { error } from '@sveltejs/kit';
import { requireDirectorAccess, requireDirectorProjectScope } from '$lib/server/director/access';
import { isUploadId, loadMockupsDoc, readMockup } from '$lib/server/director/mockups';
import type { RequestHandler } from './$types';

/**
 * `GET /api/director/mockups/image?project=<key>[&client=<key>]&id=<mockup id>` — one mockup's
 * original bytes, for the New-game thumbnails and the breakdown's picture. Gated exactly like the
 * doc (`/api/director/mockups`): the `director` tool, then the project named, which may be
 * PENDING. An id the doc does not list, and a listed image whose object is gone, are the same 404.
 * An upload id is random and never reused, so the browser may keep the answer.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await requireDirectorAccess(locals);
	const { clientKey, projectKey } = await requireDirectorProjectScope(
		user,
		url.searchParams.get('project'),
		url.searchParams.get('client'),
	);
	const id = url.searchParams.get('id') ?? '';
	if (!isUploadId(id)) throw error(404, 'No such mockup.');
	const { doc } = await loadMockupsDoc(clientKey, projectKey);
	const image = doc.images.find((img) => img.id === id);
	const bytes = image ? await readMockup(clientKey, projectKey, image) : null;
	if (!image || !bytes) throw error(404, 'No such mockup.');
	return new Response(bytes, {
		headers: {
			'content-type': image.mediaType,
			'content-length': String(bytes.byteLength),
			'cache-control': 'private, max-age=86400',
		},
	});
};
