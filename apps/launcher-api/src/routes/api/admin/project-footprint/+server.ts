import { error, json } from '@sveltejs/kit';
import { ADMIN_PANEL_CAPABILITY, roleHasCapability } from '$lib/roles';
import { listGamesOwnedByProject } from '$lib/server/games';
import { projectKeyTaken } from '$lib/server/projects';
import { purgeFootprint } from '$lib/server/projectPurge';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import type { RequestHandler } from './$types';

/**
 * `GET /api/admin/project-footprint?project=<key>` — exactly what deleting or purging
 * this project would affect: its R2 roots, the live object count and byte total under
 * them, the games that would be unregistered, and any prefix collision that must block
 * a purge outright.
 *
 * The delete confirmation shows these numbers, so an admin approves a MEASURED amount
 * of destruction rather than a vague warning. The count is the whole point: the delete
 * that prompted this feature silently stranded 2,488 objects because nothing ever put
 * that number in front of anyone.
 *
 * Lazy, mirroring `/api/admin/spines`: folding an R2 listing per project into the admin
 * page load would put one full recursive listing per project on every admin page view.
 * Answers 401/403 rather than redirecting, so a fetch gets a status and not login HTML.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	if (!roleHasCapability(locals.user.role, ADMIN_PANEL_CAPABILITY, roleOverrides)) {
		throw error(403, 'Admins only.');
	}

	const projectKey = url.searchParams.get('project')?.trim();
	if (!projectKey) throw error(400, 'missing ?project=');
	// Deleted projects are still purgeable, so this deliberately accepts a tombstoned
	// key (`projectKeyTaken`) rather than a live-only `projectExists`.
	if (!(await projectKeyTaken(projectKey))) throw error(404, 'Unknown project');

	// `purgeFootprint` reads the owning client itself, so the numbers shown here and the
	// keys the purge deletes come from one source rather than two.
	const footprint = await purgeFootprint(projectKey);
	// Strictly the games this project OWNS — `listGamesForProject` also returns global
	// games, which a delete does not touch and must therefore not be named as at risk.
	const games = await listGamesOwnedByProject(projectKey);

	return json({
		projectKey,
		roots: footprint.roots,
		objects: footprint.objects,
		bytes: footprint.bytes,
		collidesWith: footprint.collidesWith,
		strayPrefixes: footprint.strayPrefixes,
		games: games.map((g) => ({ key: g.key, name: g.name })),
	});
};
