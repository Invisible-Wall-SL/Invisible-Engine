import { DEFAULT_GAME_KIND } from 'constants-shared/gameKinds';
import { bearerToken } from '$lib/launcherGates';
import { mapWithConcurrency } from './concurrency';
import { tokensMatch } from './tokensMatch';
import type { Game, Project } from './db/schema';
import { listGames } from './games';
import { publishedPointerKey, UNASSIGNED_CLIENT } from './projectPaths';
import { listProjects } from './projects';
import { hasOwnBuiltBundle } from './publishGame';

/**
 * The game list the current-games regression harness runs against (`GET /api/pipeline/games`,
 * `docs/director/DECISIONS/0004-current-games-regression-harness.md`). Read-only, and authorized by
 * a CI bearer token alone: no session, no role, so a leaked cookie never opens it and the token
 * opens nothing else.
 */

export interface PipelineCiDenial {
	status: 401 | 503;
	error: string;
}

/** One live game, as the harness needs it. Built field by field: no project secret rides along. */
export interface PipelineGame {
	key: string;
	name: string;
	/** Null for a global (legacy, project-less) game: it has no published snapshot to render. */
	projectKey: string | null;
	/** The project's stored client; null when unassigned (its R2 tree is under `unassigned/`). */
	clientKey: string | null;
	/** The project's game kind, defaulted as `projectGameType` does; null for a global game. */
	gameType: string | null;
	version: string;
	builtAt: string | null;
	/** Where the project's published-snapshot pointer lives, computed, not probed: a never-published
	 *  project's key names no object yet. Null for a global game. */
	publishedPointerKey: string | null;
	/** A desktop build serves its own bundle (`test_server/<key>/`), not the shared runtime. */
	hasOwnBuiltBundle: boolean;
}

/** Parallel `hasOwnBuiltBundle` listings: one LIST per 1,000 objects under `test_server/<key>/`. */
const OWN_BUNDLE_CONCURRENCY = 8;

/** Why the request must be refused, or `null` when its bearer token is the configured CI token. */
export function pipelineCiDenial(
	authorization: string | null,
	configured: string,
): PipelineCiDenial | null {
	if (!configured) {
		return {
			status: 503,
			error: 'PIPELINE_CI_TOKEN is not set on the launcher, so the CI game list is disabled',
		};
	}
	const presented = bearerToken(authorization);
	if (presented === undefined || !tokensMatch(presented, configured)) {
		return { status: 401, error: 'Unauthorized' };
	}
	return null;
}

/**
 * Join games to their LIVE projects. A game whose project is soft-deleted (or gone) is dropped;
 * a global game (`projectKey` null) is kept with no project fields.
 */
export function joinPipelineGames(
	gameRows: Game[],
	projectRows: Project[],
): Omit<PipelineGame, 'hasOwnBuiltBundle'>[] {
	// `listProjects()` already drops tombstones; filtered again so this stays right for any caller.
	const live = new Map(projectRows.filter((p) => !p.deletedAt).map((p) => [p.key, p]));
	const out: Omit<PipelineGame, 'hasOwnBuiltBundle'>[] = [];
	for (const game of gameRows) {
		const project = game.projectKey === null ? null : live.get(game.projectKey);
		if (project === undefined) continue;
		out.push({
			key: game.key,
			name: game.name,
			projectKey: project?.key ?? null,
			clientKey: project?.clientKey ?? null,
			gameType: project ? project.gameType || DEFAULT_GAME_KIND : null,
			version: game.version,
			builtAt: game.builtAt ? game.builtAt.toISOString() : null,
			publishedPointerKey: project
				? publishedPointerKey(project.clientKey ?? UNASSIGNED_CLIENT, project.key)
				: null,
		});
	}
	return out;
}

export async function listPipelineGames(): Promise<PipelineGame[]> {
	const [gameRows, projectRows] = await Promise.all([listGames(), listProjects()]);
	return mapWithConcurrency(
		joinPipelineGames(gameRows, projectRows),
		OWN_BUNDLE_CONCURRENCY,
		async (game) => ({ ...game, hasOwnBuiltBundle: await hasOwnBuiltBundle(game.key) }),
	);
}
