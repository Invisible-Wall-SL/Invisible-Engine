import { error, redirect } from '@sveltejs/kit';
import { ADMIN_PANEL_CAPABILITY, roleHasCapability } from '$lib/roles';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { podControlConfigured } from '$lib/server/runpod';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	if (!locals.user) throw redirect(303, '/login');
	// Reuse the effective manifest the parent layout already resolved (same gate,
	// fewer queries) — the tool card is only granted to entitled roles.
	const { tools } = await parent();
	if (!tools.some((t) => t.id === 'comfyui')) {
		throw error(403, 'Your role does not have access to ComfyUI.');
	}

	// Unlike /atlas + /spine we do NOT auto-redirect: the pods are external, on-demand
	// RunPod resources that may be stopped, so a straight redirect would dump the artist
	// on a RunPod error page with no context. Instead the page renders a launcher-framed
	// FLEET control panel (kept full-page, no iframe) that lists every pod with start/
	// stop + open ComfyUI, plus the R&D→blueprint guidance. `podControl` gates it: when
	// the RunPod key is missing or the fleet is empty the page shows the set-me landing.
	// The pod list itself is fetched client-side from `/comfyui/status` (live statuses).
	// `canAdmin` only decides what the page RENDERS — the endpoints re-check it themselves
	// (`requireComfyAdmin`), because a hidden button is not a permission.
	const roleOverrides = await getRoleOverrides(locals.user.role);
	return {
		podControl: await podControlConfigured(),
		canAdmin: roleHasCapability(locals.user.role, ADMIN_PANEL_CAPABILITY, roleOverrides),
	};
};
