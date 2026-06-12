import { error, redirect } from '@sveltejs/kit';
import { toolBarParams } from '$lib/server/toolBar';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	if (!locals.user) throw redirect(303, '/login');
	// The parent layout already resolved the effective tool manifest; reuse it
	// for both the gate and the shared tool-bar params (fewer queries).
	const { tools } = await parent();
	if (!tools.some((t) => t.id === 'spineViewer')) {
		throw error(403, 'Your role does not have access to the Invisible Spine Viewer.');
	}
	// Full-page, no iframe: send the user straight to the viewer document. The
	// unified tool bar is fed the role-gated tool list (`home` + `tools`); the
	// viewer is same-origin, so every switcher link is a launcher URL.
	const params = toolBarParams(tools, 'spineViewer');
	throw redirect(303, `/spine/view.html?${params.toString()}`);
};
