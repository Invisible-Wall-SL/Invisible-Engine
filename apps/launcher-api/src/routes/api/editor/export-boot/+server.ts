import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { exportBootSplashes } from '$lib/server/bootSplashExport';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import type { RequestHandler } from './$types';

/**
 * Build-time trigger: mirror the project's boot splash bundles into `deploy/_boot/` and write
 * `boot.json` (`$lib/server/bootSplashExport.ts`), so the deploy pull that runs next carries the
 * CURRENT splash into a desktop/delivery build. The online path does this inside
 * `ensureDeployExports`; without this entry point an offline build shipped whatever the last
 * online publish had left in `_boot/` — or nothing. Same shared deploy token (`?k=`) as the
 * other `/api/editor/export-*` routes. Idempotent; safe to re-run per build.
 */
export const POST: RequestHandler = async ({ url }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Boot splash export is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	try {
		const index = await exportBootSplashes(clientKey, projectKey);
		return json({ clientKey, projectKey, index });
	} catch (e) {
		console.error('export-boot failed:', e);
		throw error(502, 'Failed to export the boot splash.');
	}
};
