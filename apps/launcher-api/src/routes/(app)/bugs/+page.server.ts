import { error, redirect } from '@sveltejs/kit';
import { bugAreas, isBugArea } from '$lib/bugReports';
import type { PageServerLoad } from './$types';
import { askedBug, askedReport } from './view';

/**
 * Invisible Pipeline Bug Reports (`/bugs`): the tool gate, as every tool page has it, plus what the
 * page opens on: whether this user triages pipeline bugs (`pipelineBugTriage`, resolved by the
 * layout from the same override layers as the tool list), the bug a shared link names
 * (`?bug=<n>`), and a report form a link from another tool asks for
 * (`?new=1[&for=<tool id>][&page=<address>]`) with what it already knows filled in. The page itself
 * is `BugTracker`, shared with Invisible Game Bug Reports.
 */
export const load: PageServerLoad = async ({ locals, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools, bugTriage } = await parent();
	if (!tools.some((t) => t.id === 'pipelineBugs')) {
		throw error(403, 'Your role does not have access to Invisible Pipeline Bug Reports.');
	}
	return {
		canTriage: bugTriage.pipeline,
		selected: askedBug(url),
		areas: bugAreas('pipeline'),
		report: askedReport(url, (area) => isBugArea('pipeline', area)),
	};
};
