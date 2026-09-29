import { error, json } from '@sveltejs/kit';
import { resolveMockContract, type MockContractSource } from '$lib/server/mockContract';
import { DEFAULT_PROJECT_KEY, projectAllowsRead } from '$lib/server/projects';
import type { RequestHandler } from './$types';

const SOURCES: readonly MockContractSource[] = ['published', 'live'];

/**
 * The math contract for the Invisible Test Server's mock RGS — protocol, cascade and grid
 * (dimensions, paylines, in-play symbol pool, wild, cluster/scatter shape) derived from the
 * project's Invisible Game Config.
 *
 *   GET /api/game-config/mock?project=<projectKey>&k=<readToken>[&source=published|live]
 *
 * The test server polls this per game (short TTL) and rebuilds that game's mock whenever the answer
 * CHANGES, because a contract that travels only at publish time drifts from the client the moment
 * the board is edited — the client drew 8×4 against a server dealing 5×3, every cell outside the
 * server board empty and the wins scored on a board nobody was looking at.
 *
 * `source` names the client the contract is for, since two clients now read two different configs
 * (see `mockContract.ts`): `published` (the default) is what a PLAYER boots — the project's published
 * snapshot, or its live data when it has none yet — and `live` is what an AUTHORING boot and a
 * standalone build read. The answer says which it was read from (`source`, and `snapshot` when it
 * was one), the same three values `/api/editor/runtime` reports in `X-IE-Runtime-Source`.
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
	const source = (url.searchParams.get('source') || 'published') as MockContractSource;
	if (!SOURCES.includes(source)) throw error(400, `source must be one of ${SOURCES.join(', ')}.`);

	try {
		const contract = await resolveMockContract(projectKey, source);
		return json({ projectKey, ...contract }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (e) {
		console.error(`[mock-contract] "${projectKey}" (${source}) failed:`, e);
		throw error(502, 'Failed to resolve the mock contract.');
	}
};
