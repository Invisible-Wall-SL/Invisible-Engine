import { json } from '@sveltejs/kit';
import { requireComfyAdmin } from '$lib/server/comfyAdmin';
import { abortPendingUploads } from '$lib/server/volumeModels';
import type { RequestHandler } from './$types';

/**
 * Abort every unfinished S3 upload on the volume that no running transfer owns. A transfer cut
 * off by a redeploy leaves its parts in `.s3compat_uploads/`, taking (billed) space.
 */
export const POST: RequestHandler = async ({ locals }) => {
	await requireComfyAdmin(locals);
	return json({ aborted: await abortPendingUploads() });
};
