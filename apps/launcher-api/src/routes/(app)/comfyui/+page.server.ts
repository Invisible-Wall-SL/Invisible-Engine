import { error, redirect } from '@sveltejs/kit';
import { ENV } from '$lib/server/env';
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

	// Unlike /atlas + /spine we do NOT auto-redirect: the pod is an external,
	// on-demand RunPod resource that may be stopped, so a straight redirect would
	// dump the artist on a RunPod error page with no context. Instead the page
	// renders a launcher-framed control panel (kept full-page, no iframe) that can
	// start/stop the pod + open ComfyUI, with the R&D→blueprint guidance. `comfyUrl`
	// empty ⇒ no pod set (set-me landing). `podControl` gates the start/stop UI: when
	// the RunPod secrets aren't set the page still shows a plain open-link landing.
	return {
		comfyUrl: ENV.COMFY_RND_URL.replace(/\/$/, ''),
		podControl: podControlConfigured(),
	};
};
