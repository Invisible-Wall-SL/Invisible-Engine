import { error } from '@sveltejs/kit';
import { ADMIN_PANEL_CAPABILITY, roleHasCapability } from '$lib/roles';
import { getRoleOverrides } from './roleToolAccess';

/**
 * Gate for the /comfyui actions that change the FLEET rather than use it — rebuilding the
 * pod image, and moving a pod onto a build.
 *
 * Stricter than `requireComfyAccess` on purpose. Start/Stop affect one pod for one artist
 * and are self-correcting; these two spend shared CI minutes and RESET a pod, taking any
 * session on it down with them. Same capability the admin panel uses, so there is one
 * answer to "who administers this", not two.
 */
export async function requireComfyAdmin(locals: App.Locals): Promise<void> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	if (!roleHasCapability(locals.user.role, ADMIN_PANEL_CAPABILITY, roleOverrides)) {
		throw error(403, 'Admins only — rebuilding the image and changing a pod affect everyone.');
	}
}
