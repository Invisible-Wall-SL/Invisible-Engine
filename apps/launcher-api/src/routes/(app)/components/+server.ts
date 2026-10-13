import { redirect } from '@sveltejs/kit';
import { legacyComponentsRedirect } from '$lib/componentLinks';
import type { RequestHandler } from './$types';

/** The Component Editor folded into `/editor` (Rive plan Phase 4); old links land on its
 * Components side. `/editor` runs its own auth, role and project gate. */
export const GET: RequestHandler = ({ url }) => {
	throw redirect(307, legacyComponentsRedirect(url.searchParams));
};
