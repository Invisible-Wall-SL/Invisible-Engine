import type { GameConfigDoc } from 'game-config';
import { bearerToken } from '$lib/launcherGates';
import { UNASSIGNED_CLIENT } from './projectPaths';
import { projectClientKey, projectExists } from './projects';
import { currentPointer, publishedPointerExists, readSnapshotBundle } from './publishedRuntime';
import { tokensMatch } from './tokensMatch';

/** The game server's own game-key rule (`services/game-server/src/configSource.ts`). */
export const GAME_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;

let warnedUnset = false;

/**
 * True only when `authorization` is `Bearer <configured>`. An unset secret opens nothing: there is
 * no fallback to the deploy token, which also opens `/api/deploy` and every export.
 */
export function gameServerAuthorized(authorization: string | null, configured: string): boolean {
	if (!configured) {
		if (!warnedUnset) {
			warnedUnset = true;
			console.warn(
				'[game-server/config] GAME_SERVER_CONFIG_SECRET is not set: every read is a 401.',
			);
		}
		return false;
	}
	const presented = bearerToken(authorization);
	return presented !== undefined && tokensMatch(presented, configured);
}

export type PublishedGameConfig =
	| { found: true; snapshot: string; doc: GameConfigDoc }
	| { found: false; reason: 'no-project' | 'unpublished' | 'no-config' | 'pointer-unreadable' }
	| { found: false; reason: 'snapshot-missing'; snapshot: string };

/**
 * The game config a project's PUBLISHED snapshot ships — what its players run, read through the
 * same pointer + bundle caches as the player boot, so a republish or rollback reaches new rooms on
 * the same clock. Never the authored doc: an autosave after Publish must not reach a room. An R2
 * failure throws.
 */
export async function publishedGameConfig(projectKey: string): Promise<PublishedGameConfig> {
	if (!(await projectExists(projectKey))) return { found: false, reason: 'no-project' };
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	const pointer = await currentPointer(clientKey, projectKey);
	if (!pointer) {
		// A pointer that exists but does not parse is damage, not "never published": answering it
		// as gone would make the game server drop the game's last good config.
		return (await publishedPointerExists(clientKey, projectKey))
			? { found: false, reason: 'pointer-unreadable' }
			: { found: false, reason: 'unpublished' };
	}
	const bundle = await readSnapshotBundle(clientKey, projectKey, pointer.current);
	if (!bundle) return { found: false, reason: 'snapshot-missing', snapshot: pointer.current };
	if (!bundle.config) return { found: false, reason: 'no-config' };
	return { found: true, snapshot: pointer.current, doc: bundle.config };
}
