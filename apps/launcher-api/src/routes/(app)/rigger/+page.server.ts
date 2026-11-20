import { error, redirect } from '@sveltejs/kit';
import { riggerRigHash } from '$lib/riggerLinks';
import { SESSION_COOKIE } from '$lib/server/auth';
import { BUILD_ID } from '$lib/server/buildId';
import { toolBarParams } from '$lib/server/toolBar';
import { resolveToolScope } from '$lib/server/toolScope';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent, url, cookies }) => {
	if (!locals.user) throw redirect(303, '/login');
	// Reuse the parent layout's resolved tool manifest for both the gate and the
	// shared tool-bar params (fewer queries) — same pattern as /rig-viewer.
	const { tools } = await parent();
	if (!tools.some((t) => t.id === 'rigger')) {
		throw error(403, 'Your role does not have access to the Invisible Rigger.');
	}
	// Full-page, no iframe: redirect to the static WebGL rigger app. The unified
	// tool bar is fed the role-gated tool list (`home` + `tools`); the app is
	// same-origin, so every switcher link is a launcher URL.
	const params = toolBarParams(tools, 'rigger');
	// Cache-bust the stable-name static app (view.html + vendored rigger-fx.js): a new deploy
	// changes BUILD_ID, so the browser fetches the fresh files instead of serving stale ones.
	params.set('v', BUILD_ID);
	// A link that names a project (`?project=`) opens the Rigger on it, as every tool does: the
	// static page's requests are bound to the session's project, so the choice is synced there.
	if (url.searchParams.has('project'))
		await resolveToolScope({ url, sessionToken: cookies.get(SESSION_COOKIE), user: locals.user });
	// `?rig=<bundle>` (`riggerLinkFor`) is carried as the page's hash, which it opens the rig from.
	throw redirect(303, `/rigger/view.html?${params.toString()}${riggerRigHash(url.searchParams)}`);
};
