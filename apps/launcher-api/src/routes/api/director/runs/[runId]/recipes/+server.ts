import { json } from '@sveltejs/kit';
import { requireDirectorAccess, requireOwnedRun } from '$lib/server/director/access';
import { NO_STORE, answering } from '$lib/server/director/api';
import { artPlanOf } from '$lib/server/director/artPlan';
import type { RequestHandler } from './$types';

/**
 * `GET /api/director/runs/[runId]/recipes` — the run's art as the owner reviews it (ADR-0008 §5,
 * §7): every stored recipe with the plan it answers to, the reviewed blueprint cards and the GPU
 * price, and the measured timings. The Live run screen builds the Art plan checkpoint, "How this
 * was made" and the before-publish licence list from it. Owner-only and read-only, like the
 * summary; an unreadable catalogue answers `catalogue: null` with the reason, never a guess.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const user = await requireDirectorAccess(locals);
	const run = await requireOwnedRun(user, params.runId);
	return answering(async () => json(await artPlanOf(user, run), { headers: NO_STORE }));
};
