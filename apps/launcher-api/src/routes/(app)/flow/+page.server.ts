import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { listComponents } from '$lib/server/componentStorage';
import { loadDoc } from '$lib/server/editorStorage';
import { resolveToolScope } from '$lib/server/toolScope';
import type { PageServerLoad } from './$types';

/**
 * Invisible Flow — `/flow` (Phase 1, READ-ONLY).
 *
 * The flow canvas is a client-only Svelte Flow graph (touches `window`); SSR is
 * pointless and fragile here, the same call the Scene Editor makes. `load` still runs
 * server-side and streams the data; only the component render is client-only.
 */
export const ssr = false;

/**
 * Loader: auth + role gate, then REUSE the launcher's existing R2/scenes loading
 * (`loadDoc` — the same LayoutDoc the Scene Editor reads) and the project's components
 * (`listComponents` — needed to resolve each instance's def for pin-derivation). No new
 * shared surface; this is the editor's own load minus the editor-only extras. Phase 1
 * is read-only, so there is NO save action and the tool stays unregistered (behind the
 * curtain) until Phase 2 wires authoring + `POST /api/flow/save`.
 */
export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	// Gate on the `editor` entitlement: Flow rides on the Scene Editor's screens, so a
	// user who can open the editor can read its flow. (When the tool is registered in
	// Phase 2 this becomes a `flow` gate.)
	if (!roleHasTool(locals.user.role, 'editor')) {
		throw error(403, 'Your role does not have access to Invisible Flow.');
	}
	void tools;
	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});
	const [doc, components] = await Promise.all([
		loadDoc(clientKey, projectKey),
		listComponents({ projectKey }),
	]);
	return { clientKey, projectKey, doc, components };
};
