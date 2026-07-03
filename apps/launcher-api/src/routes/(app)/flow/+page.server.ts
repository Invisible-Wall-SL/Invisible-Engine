import { error, redirect } from '@sveltejs/kit';
import { resolveFlowVocabulary } from '$lib/flowVocabularies';
import { resolveOverlayStepTable } from '$lib/flowOverlaySteps';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { listComponents } from '$lib/server/componentStorage';
import { loadDoc } from '$lib/server/editorStorage';
import { loadFlowDoc } from '$lib/server/flowStorage';
import { resolveToolScope } from '$lib/server/toolScope';
import type { PageServerLoad } from './$types';

/**
 * Invisible Flow — `/flow` (Phase 2, macro authoring).
 *
 * The flow canvas is a client-only Svelte Flow graph (touches `window`); SSR is
 * pointless and fragile here, the same call the Scene Editor makes. `load` still runs
 * server-side and streams the data; only the component render is client-only.
 */
export const ssr = false;

/**
 * Loader: auth + role gate, then REUSE the launcher's existing R2/scenes loading
 * (`loadDoc` — the same LayoutDoc the Scene Editor reads), the project's components
 * (`listComponents` — needed to resolve each instance's def for pin-derivation), and the
 * project's saved FlowDoc (`loadFlowDoc` — sibling of `scenes.json`; absent ⇒ empty doc,
 * so the canvas starts from the LayoutDoc's screens with no transitions). No new shared
 * surface; this is the editor's own load plus the FlowDoc.
 */
export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	if (!roleHasTool(locals.user.role, 'flow')) {
		throw error(403, 'Your role does not have access to Invisible Flow.');
	}
	void tools;
	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});
	const [doc, components, flow] = await Promise.all([
		loadDoc(clientKey, projectKey),
		listComponents({ projectKey }),
		loadFlowDoc(clientKey, projectKey),
	]);
	// The choreography Broadcast/effect palette offers the game's EXPORTED emitter vocabulary
	// (codegen'd from `typesEmitterEvent.ts` + `flowEffects.ts`), selected by the LayoutDoc
	// `gameType`; an unrecognized game falls back to `DEFAULT_EMITTER_VOCABULARY` (parity-safe,
	// design doc §3/§7). Authoring-fidelity only — it never changes the runtime.
	const vocabulary = resolveFlowVocabulary(doc.gameType);
	// FS-6 editor diagnostic (design doc §14) — the per-gameType overlay-step table (serializable), so
	// the canvas can run the GENERIC per-step ownership resolver and show which of screen/edge/scene
	// fails per step. Unknown gameType ⇒ undefined ⇒ the editor renders no overlay-steps section.
	const overlaySteps = resolveOverlayStepTable(doc.gameType);
	return { clientKey, projectKey, doc, components, flow, vocabulary, overlaySteps };
};
