import { error, redirect } from '@sveltejs/kit';
import { SESSION_COOKIE } from '$lib/server/auth';
import { ENV } from '$lib/server/env';
import { toolBarParams } from '$lib/server/toolBar';
import { toolHandoff } from '$lib/server/toolLaunch';
import { resolveToolScope } from '$lib/server/toolScope';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	// The parent layout already resolved the effective tool manifest; reuse it
	// instead of re-querying the role/user overrides (same gate, fewer queries).
	const { tools } = await parent();
	if (!tools.some((t) => t.id === 'atlasTool')) {
		throw error(403, 'Your role does not have access to the Invisible Atlas Maker.');
	}

	// Full-page, no iframe: send the authenticated user straight to the tool. The role check
	// above gates it; the handoff (a signed launch token, or the legacy query while the signing
	// secret is unset) carries who they are, the active `(client, project)` — the launcher is
	// the source of truth, so the tool never looks the client up itself — and whether they may
	// publish Invisible Blueprints to the shared library.
	const base = ENV.ATLAS_TOOL_URL.replace(/\/$/, '');
	if (base) {
		const { projectKey, clientKey } = await resolveToolScope({
			url,
			sessionToken: cookies.get(SESSION_COOKIE),
			user: locals.user,
		});
		const { params } = await toolHandoff({
			tool: 'atlas',
			user: locals.user,
			clientKey,
			projectKey,
		});
		// Unified tool bar — the launcher bakes the role-gated tool list (`home`
		// for the emblem + `tools` for the switcher). Every link routes back
		// through the launcher, which re-gates the role and mints a fresh signed launch
		// token, so nothing here can bypass a gate.
		for (const [key, value] of toolBarParams(tools, 'atlasTool')) params.set(key, value);
		// Deep-link from the Invisible Editor: when an atlas/region is requested,
		// forward them so the tool can load the matching generation manifest (or
		// fall back to the Sheet Maker Import browser via the `sibling` link).
		const atlas = url.searchParams.get('atlas');
		if (atlas) params.set('atlas', atlas);
		const region = url.searchParams.get('region');
		if (region) params.set('region', region);
		throw redirect(303, `${base}/?${params.toString()}`);
	}
	return { configured: false };
};
