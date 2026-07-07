import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Invisible Flow v2 — `/flow-v2` (Phase 2a, DEV route).
 *
 * An UNLISTED dev route (not in the tool registry) — reached by direct URL until the
 * Phase-5 hard cut retires v1 authoring. The canvas is a client-only Svelte Flow graph
 * (touches `window`), so SSR is disabled, mirroring `/flow`. The sample `FlowDoc` +
 * vocabulary + function library are hard-coded on the client (`sample.ts`); this loader
 * only enforces login (the `(app)` layout already gates auth — this is belt-and-braces).
 */
export const ssr = false;

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');
	return {};
};
