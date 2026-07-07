import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { loadFlowV2Doc } from '$lib/server/flowV2Storage';
import { resolveToolScope } from '$lib/server/toolScope';
import type { PageServerLoad } from './$types';

/**
 * Invisible Flow v2 — `/flow-v2` (Phase 2a, DEV route).
 *
 * An UNLISTED dev route (not in the tool registry) — reached by direct URL until the
 * Phase-5 hard cut retires v1 authoring. The canvas is a client-only Svelte Flow graph
 * (touches `window`), so SSR is disabled, mirroring `/flow`.
 *
 * Persistence: this loader mirrors v1 `/flow`'s scope resolution (`resolveToolScope` +
 * the `flow` role gate — `/flow-v2` has no registry entry of its own, so it reuses v1
 * Flow's entitlement) and loads the project's v2 FlowDoc from R2 at `flowV2DocKey`. When
 * no project is selected OR the object is absent/malformed, `doc` is `null` and the page
 * falls back to its built-in `SAMPLE_DOC` (so the dev route still works standalone).
 *
 * OUT OF SCOPE (later increment): the template VOCABULARY + shared FUNCTION LIBRARY still
 * come from the client-side `sample.ts` (`BOOK_OF_VOCAB`, `LIBRARY`); only the project's
 * FlowDoc persists.
 */
export const ssr = false;

export const load: PageServerLoad = async ({ locals, cookies, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	if (!roleHasTool(locals.user.role, 'flow')) {
		throw error(403, 'Your role does not have access to Invisible Flow.');
	}
	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});
	const doc = await loadFlowV2Doc(clientKey, projectKey);
	return { clientKey, projectKey, doc };
};
