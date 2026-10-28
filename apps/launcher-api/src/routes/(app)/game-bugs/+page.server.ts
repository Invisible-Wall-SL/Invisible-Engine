import { error, redirect } from '@sveltejs/kit';
import { bugAreas, isBugArea } from '$lib/bugReports';
import { SESSION_COOKIE } from '$lib/server/auth';
import { liveRunOnProject } from '$lib/server/director/store';
import { resolveToolScope } from '$lib/server/toolScope';
import { askedBug, askedReport } from '../bugs/view';
import type { PageServerLoad } from './$types';

/**
 * Invisible Game Bug Reports (`/game-bugs`): one project's own bug list, on the same modules as
 * Invisible Pipeline Bug Reports. The project is the page's scope like any project tool's — the
 * `?project=` a link names when the user can open it (synced into the session), else the session's
 * — and the list holds that project's game bugs alone. Opens on what the pipeline page does
 * (`?bug=`, `?new=1&for=<part of the game>&page=`). It also learns what the repair controls need
 * (ADR-0012 §1): whether the viewer may start a Director repair run or escalate to the pipeline,
 * and whether a run is already live on the project. The endpoints check all of it again.
 */
export const load: PageServerLoad = async ({ locals, parent, url, cookies }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools, bugTriage } = await parent();
	if (!tools.some((t) => t.id === 'gameBugs')) {
		throw error(403, 'Your role does not have access to Invisible Game Bug Reports.');
	}
	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});
	const canTriage = bugTriage.game;
	const has = (id: string) => tools.some((t) => t.id === id);
	return {
		clientKey,
		projectKey,
		canTriage,
		repair: {
			canStart: canTriage && has('director'),
			liveRun: (await liveRunOnProject(projectKey)) !== null,
			canEscalate: canTriage && has('pipelineBugs'),
		},
		pipelineAreas: bugAreas('pipeline'),
		selected: askedBug(url),
		areas: bugAreas('game'),
		report: askedReport(url, (area) => isBugArea('game', area)),
	};
};
