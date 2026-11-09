import { error } from '@sveltejs/kit';
import { getDeployToken } from './appSettings';
import { tokensMatch } from './tokensMatch';

/** How a presented `?k=` stands against the configured deploy token. */
export type DeployTokenVerdict = 'unset' | 'mismatch' | 'ok';

/**
 * `unset` when no deploy token is configured (the endpoint then refuses everyone rather than
 * opening up), otherwise a constant-time compare: an absent `?k=` is a mismatch.
 */
export function deployTokenVerdict(
	presented: string | null,
	configured: string | undefined,
): DeployTokenVerdict {
	if (!configured) return 'unset';
	return presented !== null && tokensMatch(presented, configured) ? 'ok' : 'mismatch';
}

/**
 * The `?k=<deploy token>` gate for the build/export endpoints: 503 `notConfigured` when no token
 * is configured, 401 when `?k=` is absent or wrong.
 */
export async function requireDeployToken(url: URL, notConfigured: string): Promise<void> {
	const verdict = deployTokenVerdict(url.searchParams.get('k'), await getDeployToken());
	if (verdict === 'unset') throw error(503, notConfigured);
	if (verdict === 'mismatch') throw error(401, 'Invalid or missing token.');
}
