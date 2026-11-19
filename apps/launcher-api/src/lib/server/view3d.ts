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
