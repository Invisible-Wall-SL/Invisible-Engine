import { error, redirect } from '@sveltejs/kit';
import { loadBuildBreakdown, UnknownBreakdownError } from '$lib/server/buildBreakdown';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { currentPointer, isSnapshotId } from '$lib/server/publishedRuntime';
import { canAccessProject, projectClientKey, projectName } from '$lib/server/projects';
import type { PageServerLoad } from './$types';

/**
 * Build breakdown of one published version — what it shipped, by category and size, and how often
 * each file and asset is referenced. Read-only, so it takes Game Maker access + project access, not
 * the `gamePublish` capability.
 */
export const load: PageServerLoad = async ({ locals, parent, params }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	if (!tools.some((t) => t.id === 'gameMaker')) {
		throw error(403, 'Your role does not have access to Invisible Game Maker.');
	}
	const { project, snapshot } = params;
	if (!isSnapshotId(snapshot)) throw error(404, 'Unknown published version.');
	if (!(await canAccessProject(locals.user.id, locals.user.role, project))) {
		throw error(403, 'Unknown project, or you do not have access to it.');
	}
	const clientKey = (await projectClientKey(project)) ?? UNASSIGNED_CLIENT;
	try {
		const [breakdown, pointer, name] = await Promise.all([
			loadBuildBreakdown(clientKey, project, snapshot),
			currentPointer(clientKey, project),
			projectName(project),
		]);
		return {
			tools,
			project,
			projectName: name ?? project,
			clientKey,
			breakdown,
			live: pointer?.current === snapshot,
			versions: (pointer?.snapshots ?? []).map((s) => ({ id: s.id, createdAt: s.createdAt })),
		};
	} catch (e) {
		if (e instanceof UnknownBreakdownError) throw error(404, e.message);
		throw e;
	}
};
