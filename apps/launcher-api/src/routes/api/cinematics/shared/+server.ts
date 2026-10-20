import { json } from '@sveltejs/kit';
import { canPublishSharedTimeline, cinematicGate } from '$lib/server/cinematicAccess';
import { listSharedCinematics } from '$lib/server/sharedCinematics';
import type { RequestHandler } from './$types';

/**
 * The shared timeline library (`_shared/cinematics/` plus the built-in starters, Rive plan Phase
 * 9d). Anyone who may open timelines may list and place them; `canPublish` says whether this caller
 * may also promote one (the `componentPublish` capability, as for shared components).
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	await cinematicGate(locals, cookies);
	const [timelines, canPublish] = await Promise.all([
		listSharedCinematics(),
		canPublishSharedTimeline(locals),
	]);
	return json({ ok: true, timelines, canPublish });
};
