import { json } from '@sveltejs/kit';
import { mayTargetClient } from '$lib/accessRules';
import { clientGrantsOf, listClients } from '$lib/server/clients';
import { getDirectorPricing } from '$lib/server/costs/pricingConfig';
import { requireDirectorAccess } from '$lib/server/director/access';
import { NO_STORE } from '$lib/server/director/api';
import {
	DEFAULT_CHECKPOINTS,
	ESTIMATE_PROFILES,
	agentProfiles,
	listTemplates,
} from '$lib/server/director/runs';
import { selectableGameKinds } from '$lib/server/gameKinds';
import type { RequestHandler } from './$types';

/**
 * `GET /api/director/templates[?gameType=<kind>]` — what the New-game screen offers: the Director
 * templates the caller can open (each with Game Maker's GAME / USING chips, the locked items and
 * the region counts per atlas), the game kinds, the clients the caller may create a game under
 * (the same list as Game Maker's Create form), the agents a run is priced for and the checkpoint
 * defaults. Read-only; session-gated on the `director` tool.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await requireDirectorAccess(locals);
	const gameType = url.searchParams.get('gameType')?.trim() || null;
	const [templates, gameKinds, pricing, clients, grants] = await Promise.all([
		listTemplates(user, gameType),
		selectableGameKinds(),
		getDirectorPricing(),
		listClients(),
		clientGrantsOf(user.id),
	]);
	return json(
		{
			templates,
			gameKinds,
			clients: clients
				.filter((c) => mayTargetClient(user.role, c.key, grants))
				.map((c) => ({ key: c.key, name: c.name })),
			agents: agentProfiles(),
			checkpoints: DEFAULT_CHECKPOINTS,
			estimatePlaceholder: ESTIMATE_PROFILES.placeholder || pricing.pricing.runpod.placeholder,
		},
		{ headers: NO_STORE },
	);
};
