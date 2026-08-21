import { error, json } from '@sveltejs/kit';
import { resolveMockContract } from '$lib/server/mockContract';
import { DEFAULT_PROJECT_KEY, projectAllowsRead } from '$lib/server/projects';
import type { RequestHandler } from './$types';

/**
 * The LIVE math contract for the Invisible Test Server's mock RGS — protocol, cascade and grid
 * (dimensions, paylines, in-play symbol pool, wild, cluster/scatter shape) derived from the
 * project's current Invisible Game Config.
 *
 *   GET /api/game-config/mock?project=<projectKey>&k=<readToken>
 *
 * The test server polls this per game (short TTL) and rebuilds that game's mock whenever the answer
 * CHANGES. It exists because the contract used to travel only at PUBLISH time, frozen into
 * `test_server/games.json`: the client reads `/config` live, so resizing the board in the tool
 * resized the CLIENT immediately while the mock kept dealing the old grid — the client drew 8×4
 * against a server dealing 5×3, every cell outside the server board empty and the wins scored on a
 * board nobody was looking at. Making the mock pull instead of being pushed removes the manual
 * "remember to republish" step entirely, which is the actual defect.
 *
 * `projectAllowsRead` is the gate — the SAME public read token (or the shared deploy token) as
 * `/api/editor/runtime` and `/api/deploy`, so the test server needs no secret of its own and this
 * leaks nothing the running game does not already fetch with that token. CORS stays closed: the only
 * caller is a server, never a browser.
 *
 * `no-store` because a cached answer here would re-introduce exactly the staleness this endpoint
 * exists to kill; the caller owns the (short) TTL.
 */
export const GET: RequestHandler = async ({ url }) => {
	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const token = url.searchParams.get('k') ?? '';
	if (!(await projectAllowsRead(projectKey, token))) throw error(401, 'Invalid or missing token.');

	try {
		const contract = await resolveMockContract(projectKey);
		return json({ projectKey, ...contract }, { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		throw error(502, 'Failed to resolve the mock contract.');
	}
};
