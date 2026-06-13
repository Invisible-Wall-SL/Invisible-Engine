import { error, redirect } from '@sveltejs/kit';
import { toolBarParams } from '$lib/server/toolBar';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	if (!locals.user) throw redirect(303, '/login');
	// Reuse the parent layout's resolved tool manifest for both the gate and the
	// shared tool-bar params (fewer queries) — same pattern as /spine.
	const { tools } = await parent();
	if (!tools.some((t) => t.id === 'rigger')) {
		throw error(403, 'Your role does not have access to the Invisible Rigger.');
	}
	// Full-page, no iframe: redirect to the static WebGL rigger app. The unified
	// tool bar is fed the role-gated tool list (`home` + `tools`); the app is
	// same-origin, so every switcher link is a launcher URL.
	const params = toolBarParams(tools, 'rigger');
	throw redirect(303, `/rigger/view.html?${params.toString()}`);
};
