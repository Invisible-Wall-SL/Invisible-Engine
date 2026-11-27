import { error, redirect } from '@sveltejs/kit';
import { isCapturableGameUrl, PROFILER_READINGS } from '$lib/profiler';
import { effectiveBudgets, PROFILER_BUDGETS } from '$lib/profilerBudgets';
import { PROFILER_BUILDS } from '$lib/profilerBuilds';
import { findingBugTarget } from '$lib/profilerFindings/bug';
import { SESSION_COOKIE } from '$lib/server/auth';
import { listGamesOwnedByProject } from '$lib/server/games';
import { listBudgetOverrides } from '$lib/server/profiler/budgets';
import { listBuilds } from '$lib/server/profiler/builds';
import { filedFindings } from '$lib/server/profiler/findingBugs';
import { OWNERS, projectFindings } from '$lib/server/profiler/findings';
import { PROFILER_TOOL } from '$lib/server/profiler/origin';
import { listReports } from '$lib/server/profiler/store';
import { storedProjectGameType } from '$lib/server/projects';
import { resolveToolScope } from '$lib/server/toolScope';
import type { PageServerLoad } from './$types';

/**
 * Invisible Profiler (`/profiler`, `docs/design/invisible-profiler.md`): one project's `?perf=1`
 * readings, a New capture for its published games, Paste for a delivery's Copy, the readings per
 * device judged by the project's budgets (Devices), the desktop builds' breakdowns with the readings
 * taken on each and their verdicts (Builds), the rules' ranked list of what to cut (Findings), two
 * readings side by side (Compare), and the budgets themselves (Budgets). Every role has
 * it (owner decision 2026-11-16). The project is the page's scope like any project tool's.
 */
export const load: PageServerLoad = async ({ locals, parent, url, cookies, depends }) => {
	depends(PROFILER_READINGS, PROFILER_BUILDS, PROFILER_BUDGETS);
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	if (!tools.some((t) => t.id === PROFILER_TOOL)) {
		throw error(403, 'Your role does not have access to the Invisible Profiler.');
	}
	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});
	const [readings, builds, games, overrides, gameKind] = await Promise.all([
		listReports(projectKey),
		listBuilds(projectKey),
		listGamesOwnedByProject(projectKey),
		listBudgetOverrides(projectKey),
		storedProjectGameType(projectKey),
	]);
	const budgets = effectiveBudgets(overrides);
	// The other tabs never wait on a failure here: the Findings tab says it could not be read.
	const findings = await projectFindings(projectKey, readings, builds, budgets).catch((e) => {
		console.error('[profiler] findings failed', e);
		return null;
	});
	// P5: which list each finding is filed in, and the bug it already has.
	const filed = findings
		? await filedFindings(projectKey).catch((e) => {
				console.error('[profiler] filed findings failed', e);
				return null;
			})
		: null;
	const fileAs = Object.fromEntries(
		(findings ?? []).map((f) => [f.id, findingBugTarget(f, OWNERS).kind]),
	);
	const tab = url.searchParams.get('tab');
	return {
		clientKey,
		projectKey,
		readings,
		builds,
		budgets,
		/** The project's game kind: the Budgets tab lists its phase set's lines. */
		gameKind,
		findings,
		filed,
		fileAs,
		tab:
			(['devices', 'builds', 'findings', 'compare', 'budgets'] as const).find((t) => t === tab) ??
			('readings' as const),
		games: games
			.filter((g) => isCapturableGameUrl(g.url))
			.map((g) => ({ key: g.key, name: g.name })),
	};
};
