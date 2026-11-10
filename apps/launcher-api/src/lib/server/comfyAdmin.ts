import { requireAdminPanel } from './admin';

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
	await requireAdminPanel(
		locals,
		'api',
		'Admins only — rebuilding the image and changing a pod affect everyone.',
	);
}
