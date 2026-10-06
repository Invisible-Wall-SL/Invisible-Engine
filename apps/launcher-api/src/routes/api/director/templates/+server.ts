import { json } from '@sveltejs/kit';
import { getDirectorPricing } from '$lib/server/costs/pricingConfig';
import { requireDirectorAccess } from '$lib/server/director/access';
import { NO_STORE } from '$lib/server/director/api';
import {
	DEFAULT_CHECKPOINTS,
	ESTIMATE_PROFILES,
	MAX_VARIANTS_PER_REGION,
	RESOLUTIONS,
	defaultPreset,
	listTemplates,
	pricedGpus,
} from '$lib/server/director/runs';
import { selectableGameKinds } from '$lib/server/gameKinds';
import type { RequestHandler } from './$types';

/**
 * `GET /api/director/templates[?gameType=<kind>]` — what the New-game screen offers: the Director
 * templates the caller can open (each with Game Maker's GAME / USING chips, the locked items and
 * the region counts per atlas), the game kinds, the preset defaults and bounds, and the checkpoint
 * defaults. Read-only; session-gated on the `director` tool.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await requireDirectorAccess(locals);
	const gameType = url.searchParams.get('gameType')?.trim() || null;
	const [templates, gameKinds, pricing] = await Promise.all([
		listTemplates(user, gameType),
		selectableGameKinds(),
		getDirectorPricing(),
	]);
	return json(
		{
			templates,
			gameKinds,
			preset: {
				default: defaultPreset(pricing.pricing),
				resolutions: RESOLUTIONS,
				maxVariantsPerRegion: MAX_VARIANTS_PER_REGION,
				gpus: pricedGpus(pricing.pricing),
			},
			checkpoints: DEFAULT_CHECKPOINTS,
			estimatePlaceholder: ESTIMATE_PROFILES.placeholder || pricing.pricing.runpod.placeholder,
		},
		{ headers: NO_STORE },
	);
};
