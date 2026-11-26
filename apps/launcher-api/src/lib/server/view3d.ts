import { getObjectText } from './r2';
import { gameConfigDocKey } from './projectPaths';
import { isView3dConfig } from '$lib/view3dConfig';

/** {@link isView3dConfig} of the project's stored Game Config; false when there is none. */
export async function projectIsView3d(clientKey: string, projectKey: string): Promise<boolean> {
	const text = await getObjectText(gameConfigDocKey(clientKey, projectKey));
	if (!text) return false;
	try {
		return isView3dConfig(JSON.parse(text));
	} catch {
		return false;
	}
}

const TTL_MS = 30_000;
const cache = new Map<string, { value: boolean; expires: number }>();

/**
 * {@link projectIsView3d}, cached briefly: the `(app)` layout asks on every navigation of an arcade
 * project, to offer Invisible Model Viewer only to a 3D game. A Game Config save clears the entry
 * ({@link forgetProjectIsView3d}), so turning 3D on shows the tool on the next page.
 */
export async function cachedProjectIsView3d(
	clientKey: string,
	projectKey: string,
): Promise<boolean> {
	const key = `${clientKey}/${projectKey}`;
	const hit = cache.get(key);
	if (hit && hit.expires > Date.now()) return hit.value;
	const value = await projectIsView3d(clientKey, projectKey).catch(() => false);
	cache.set(key, { value, expires: Date.now() + TTL_MS });
	return value;
}

export function forgetProjectIsView3d(clientKey: string, projectKey: string): void {
	cache.delete(`${clientKey}/${projectKey}`);
}
