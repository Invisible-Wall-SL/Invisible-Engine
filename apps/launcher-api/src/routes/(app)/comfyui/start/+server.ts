import { json } from '@sveltejs/kit';
import { getRunpodIdleConfig } from '$lib/server/appSettings';
import { requireComfyAccess } from '$lib/server/comfyAccess';
import { comfyReady, podControlConfigured, podResume, podStatus } from '$lib/server/runpod';
import { markActivity } from '$lib/server/runpodActivity';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * RESUME the pod (an artist clicked Start). Records activity first so the idle
 * watchdog doesn't immediately re-stop it, then resumes. Returns the fresh status
 * plus any `error` (e.g. GPU unavailable) so the card can show a retry.
 */
export const POST: RequestHandler = async ({ locals }) => {
	await requireComfyAccess(locals);
	markActivity();

	const resume = await podResume();
	const [status, ready, idle] = await Promise.all([
		podControlConfigured() ? podStatus() : Promise.resolve('unknown' as const),
		comfyReady(),
		getRunpodIdleConfig(),
	]);

	return json(
		{
			configured: podControlConfigured(),
			podStatus: status,
			comfyReady: ready,
			idleEnabled: idle.enabled,
			idleMinutes: idle.minutes,
			error: resume.ok ? undefined : resume.error,
		},
		{ headers: NO_STORE },
	);
};
