import { UNASSIGNED_CLIENT } from './projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from './projects';

/**
 * The client a project's R2 tree sits under: its own, or `unassigned` for a project that has none —
 * and for a key with no row, so a caller that has not checked the key gets a path, never a throw.
 */
export async function clientKeyOf(projectKey: string): Promise<string> {
	return (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
}

/**
 * `?project=` as the token-gated read routes take it: the key it names, or the default project when
 * it is absent or empty. Not an access check — the route's token or `requireProjectScope` is.
 */
export function projectParam(url: URL): string {
	return url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
}
