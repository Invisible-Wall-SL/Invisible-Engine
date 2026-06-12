import { error, redirect } from '@sveltejs/kit';
import { BLUEPRINT_PUBLISH_CAPABILITY, roleHasCapability } from '$lib/roles';
import { SESSION_COOKIE, getActiveScope } from '$lib/server/auth';
import { ENV } from '$lib/server/env';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { toolBarParams } from '$lib/server/toolBar';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	// The parent layout already resolved the effective tool manifest; reuse it
	// instead of re-querying the role/user overrides (same gate, fewer queries).
	const { tools } = await parent();
	if (!tools.some((t) => t.id === 'atlasTool')) {
		throw error(403, 'Your role does not have access to the Invisible Atlas Maker.');
	}

	// Full-page, no iframe: send the authenticated user straight to the tool.
	// The role check above gates it; the optional shared secret (?k=) only the
	// launcher knows is appended server-side so the tool's gate lets them in.
	// Atlas Maker is project-scoped, so the active `(client, project)` pair is
	// forwarded — the launcher is the source of truth, so the tool never needs
	// to look the client up itself.
	const base = ENV.ATLAS_TOOL_URL.replace(/\/$/, '');
	if (base) {
		const { projectKey: project, clientKey: client } = await getActiveScope(
			cookies.get(SESSION_COOKIE),
		);
		const params = new URLSearchParams();
		if (ENV.ATLAS_TOOL_SECRET) params.set('k', ENV.ATLAS_TOOL_SECRET);
		params.set('client', client);
		params.set('project', project);
		// Invisible Blueprints publish gate (design §6/§7). Everyone can READ the
		// shared library; only holders of the `blueprintPublish` capability may
		// publish. The gate is by KNOWLEDGE OF A SECRET, not a forgeable flag —
		// every atlas user already holds `?k=`, so a bare `bp=1` would gate
		// nothing. We hand off `bp=<ATLAS_BLUEPRINT_SECRET>` only when the user
		// holds the capability AND the secret is configured; the tool requires
		// param/cookie to equal the secret. Unset secret = publishing stays off
		// in the deployed tool (fail safe).
		if (ENV.ATLAS_BLUEPRINT_SECRET) {
			const roleOverrides = await getRoleOverrides(locals.user.role);
			const userOverrides = await getToolOverrides(locals.user.id);
			if (
				roleHasCapability(
					locals.user.role,
					BLUEPRINT_PUBLISH_CAPABILITY,
					roleOverrides,
					userOverrides,
				)
			) {
				params.set('bp', ENV.ATLAS_BLUEPRINT_SECRET);
			}
		}
		// Unified tool bar — the launcher bakes the role-gated tool list (`home`
		// for the emblem + `tools` for the switcher). Every link routes back
		// through the launcher, which re-gates the role and forwards the secret +
		// active project, so nothing here can bypass a gate.
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
