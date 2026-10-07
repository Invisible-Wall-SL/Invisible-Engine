import { json } from '@sveltejs/kit';
import { requireDirectorAccess } from '$lib/server/director/access';
import { NO_STORE, answering, jsonBody } from '$lib/server/director/api';
import { estimateForTemplate } from '$lib/server/director/runs';
import type { RequestHandler } from './$types';

/**
 * `POST /api/director/estimate` — the New-game panel's estimate (ADR-0006), before any run exists:
 *
 *   { template, mockups?: <count>, checkpoints? }
 *   → 200 { estimate: { claude, runpod, total, checkpoints, placeholder }, template, chains, checkpoints }
 *
 * Computed from the template's region counts, the mockup count, the checkpoints and each region
 * group's default chain (the template's approved one, else the profiles' `fallbackRecipe`)
 * through `services/director-worker/estimate-profiles.json` at the current prices. A body that
 * still sends the retired `preset` is refused 400 `bad_request`. It reads the
 * template's manifests and nothing else: no RunPod call, no model call, no write. Session-gated
 * on the `director` tool; the template must be one the caller can open.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireDirectorAccess(locals);
	const body = await jsonBody(request);
	return answering(async () =>
		json(
			await estimateForTemplate(user, {
				template: body.template,
				mockups: body.mockups,
				preset: body.preset,
				checkpoints: body.checkpoints,
			}),
			{ headers: NO_STORE },
		),
	);
};
