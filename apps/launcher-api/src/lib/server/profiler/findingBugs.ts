import { error } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { bugRef, type BugKind } from '$lib/bugReports';
import { effectiveBudgets } from '$lib/profilerBudgets';
import type { PerfReportListItem } from '$lib/profiler';
import type { PerfBuildListItem } from '$lib/profilerBuilds';
import type { Finding } from '$lib/profilerFindings';
import {
	findingBugDescription,
	findingBugTarget,
	findingBugTitle,
} from '$lib/profilerFindings/bug';
import {
	activeBugFor,
	filedViews,
	type FiledView,
	type FindingLinkRow,
} from '$lib/profilerFindings/filed';
import type { BugTx } from '../bugReportsStore';
import { getDb } from '../db';
import { bugReports, perfFindingBugs } from '../db/schema';
import { ENV } from '../env';
import { userGrants } from '../http';
import { accessibleProjects } from '../projects';
import { listBudgetOverrides } from './budgets';
import { listBuilds } from './builds';
import {
	AlreadyFiled,
	EvidenceGone,
	evidenceIds,
	linkFinding,
	sqlLinkStore,
} from './findingBugLink';
import { OWNERS, projectFindings } from './findings';
import { PROFILER_TOOL } from './origin';
import { listReports } from './store';

/**
 * Invisible Profiler P5 — a finding filed through Invisible Bug Reports (`docs/design/
 * invisible-profiler.md` §5). The Findings tab links to the existing report form with the finding
 * named (`fileFindingHref`); the form's page asks {@link findingDraft} for the prefill, and the
 * form posts to `/api/bugs` like any report, carrying `finding`. `createBug` hands that to
 * {@link prepareFindingBug}, which re-reads the finding server-side (so the evidence a filing keeps
 * is the rules' own, never the request's), and files bug, link and Keep in ONE transaction:
 *
 * - **once per finding:** `perf_finding_bugs`' primary key (project, finding id). Two people filing
 *   at once both insert a bug; the second's link insert hits the key, its transaction rolls back
 *   (bug included), and it is answered 409 naming the first one's bug;
 * - **evidence kept:** the cited readings and builds get Keep (a cited row the purge claimed since
 *   the finding was read files nothing), Keep cannot be taken off while the bug exists
 *   (`findingBugLink.ts` `citingBug` — a check-then-act, so a filing landing between the check and the un-Keep can
 *   leave the badge off), and the purge never claims a cited row (`purgeJob.ts`), which is the
 *   guarantee. A deleted bug leaves its evidence kept: unpin it on the page;
 * - **again after a delete:** the link goes with its bug (on delete cascade).
 */

/** The project's findings, as the Findings tab computes them. */
export async function loadProjectFindings(projectKey: string): Promise<Finding[]> {
	const [readings, builds, overrides] = await Promise.all([
		listReports(projectKey),
		listBuilds(projectKey),
		listBudgetOverrides(projectKey),
	]);
	return projectFindings(projectKey, readings, builds, effectiveBudgets(overrides));
}

/** Every finding of the project filed as a bug that still exists. */
async function findingLinks(projectKey: string): Promise<FindingLinkRow[]> {
	const rows = await getDb()
		.select({
			findingId: perfFindingBugs.findingId,
			subject: perfFindingBugs.subject,
			filedAt: perfFindingBugs.filedAt,
			number: bugReports.number,
			kind: bugReports.kind,
			status: bugReports.status,
			statusAt: bugReports.statusAt,
		})
		.from(perfFindingBugs)
		.innerJoin(bugReports, eq(bugReports.number, perfFindingBugs.bugNumber))
		.where(eq(perfFindingBugs.projectKey, projectKey));
	return rows.map((r) => ({
		findingId: r.findingId,
		subject: r.subject,
		filedAt: r.filedAt.toISOString(),
		bug: {
			number: r.number,
			kind: r.kind,
			status: r.status,
			statusAt: r.statusAt?.toISOString() ?? null,
		},
	}));
}

/**
 * Which findings are already bugs, and where each stands (`filed.ts`): by finding id, for the
 * Findings tab. A link filed before subjects gets its subject the first time its finding is seen
 * again, so from then on its bug follows the finding to the next build.
 */
export async function filedFindings(
	projectKey: string,
	findings: readonly Finding[],
	readings: readonly Pick<PerfReportListItem, 'id' | 'capturedAt'>[],
	builds: readonly Pick<PerfBuildListItem, 'id' | 'registeredAt'>[],
): Promise<Record<string, FiledView>> {
	const links = await findingLinks(projectKey);
	for (const link of links) {
		if (link.subject) continue;
		const finding = findings.find((f) => f.id === link.findingId);
		if (!finding) continue;
		link.subject = finding.subject;
		await getDb()
			.update(perfFindingBugs)
			.set({ subject: finding.subject })
			.where(
				and(
					eq(perfFindingBugs.projectKey, projectKey),
					eq(perfFindingBugs.findingId, link.findingId),
					isNull(perfFindingBugs.subject),
				),
			)
			.catch(() => undefined);
	}
	const readingAt = new Map(readings.map((r) => [r.id, r.capturedAt]));
	const buildAt = new Map(builds.map((b) => [b.id, b.registeredAt]));
	return filedViews(
		findings,
		links,
		(e) => (e.type === 'reading' ? readingAt : buildAt).get(e.id) ?? null,
	);
}

async function filedAs(projectKey: string, findingId: string): Promise<number | null> {
	const [row] = await getDb()
		.select({ number: perfFindingBugs.bugNumber })
		.from(perfFindingBugs)
		.where(
			and(eq(perfFindingBugs.projectKey, projectKey), eq(perfFindingBugs.findingId, findingId)),
		);
	return row?.number ?? null;
}

type User = NonNullable<App.Locals['user']>;

/** What the report form opens with, or why it cannot file this finding. */
export type FindingDraft =
	| {
			finding: { id: string; project: string };
			kind: BugKind;
			area: string;
			title: string;
			description: string;
			pageUrl: string;
	  }
	| { refused: string; filed?: number };

const profilerUrl = (projectKey: string) =>
	`${ENV.ORIGIN}/profiler?project=${encodeURIComponent(projectKey)}&tab=findings`;

/**
 * The prefill for the form a finding opens. `projects` is what the viewer can open. Never throws:
 * the form opens either way, saying what went wrong.
 */
export async function findingDraft(
	user: User,
	projects: ReadonlySet<string>,
	projectKey: string,
	findingId: string,
): Promise<FindingDraft> {
	if (!projects.has(projectKey)) return { refused: 'That project is not one you can open.' };
	if (!(await userGrants(user)).hasTool(PROFILER_TOOL)) {
		return { refused: 'Your role does not have access to the Invisible Profiler.' };
	}
	const filed = await filedAs(projectKey, findingId);
	if (filed) return { refused: `This finding is already filed as ${bugRef(filed)}.`, filed };
	let finding: Finding | undefined;
	try {
		finding = (await loadProjectFindings(projectKey)).find((f) => f.id === findingId);
	} catch (e) {
		console.error('[profiler] finding draft failed', e);
		return { refused: 'The findings could not be worked out just now — try again.' };
	}
	if (!finding) {
		return { refused: 'The Profiler no longer finds this — reload its Findings tab.' };
	}
	const active = activeBugFor(finding, await findingLinks(projectKey));
	if (active) {
		return { refused: `This finding is already filed as ${bugRef(active)}.`, filed: active };
	}
	const target = findingBugTarget(finding, OWNERS);
	return {
		finding: { id: finding.id, project: projectKey },
		kind: target.kind,
		area: target.area,
		title: findingBugTitle(finding),
		description: findingBugDescription(finding, projectKey, ENV.ORIGIN, target),
		pageUrl: profilerUrl(projectKey),
	};
}

/**
 * The draft a bug page's `?finding=<id>&project=<key>` asks for, or null when the link names none.
 * The projects are the viewer's, as Bug Reports scopes them.
 */
export async function askedFindingDraft(user: User, url: URL): Promise<FindingDraft | null> {
	const findingId = url.searchParams.get('finding');
	const projectKey = url.searchParams.get('project');
	if (url.searchParams.get('new') !== '1' || !findingId || !projectKey) return null;
	const projects = new Set((await accessibleProjects(user.id, user.role)).map((p) => p.key));
	return findingDraft(user, projects, projectKey, findingId);
}

export interface FindingFiling {
	projectKey: string;
	/** Run inside `insertBug`'s transaction: the link, then Keep on the evidence. */
	within: (tx: BugTx, bug: { number: number }) => Promise<void>;
	/** Maps the transaction's failure to the 409 a second filing gets; rethrows anything else. */
	settle: (e: unknown) => Promise<never>;
}

/**
 * Checks a report that names a finding (`{ project, id }`) before `createBug` files it: the viewer
 * has the Profiler and the project, the finding is still found, the list is the finding's own, and
 * it is not filed yet. The report's text is the reporter's — they may have edited the prefill —
 * but the project and the evidence kept are the finding's.
 */
export async function prepareFindingBug(
	user: User,
	projects: ReadonlySet<string>,
	kind: BugKind,
	v: unknown,
): Promise<FindingFiling> {
	const ref = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
	const projectKey = typeof ref.project === 'string' ? ref.project : '';
	const findingId = typeof ref.id === 'string' ? ref.id : '';
	if (!projectKey || !findingId) throw error(400, 'Name the finding: { project, id }.');
	if (!projects.has(projectKey)) throw error(400, 'That project is not one you can open.');
	if (!(await userGrants(user)).hasTool(PROFILER_TOOL)) {
		throw error(403, 'Your role does not have access to the Invisible Profiler.');
	}
	const already = await filedAs(projectKey, findingId);
	if (already) throw error(409, `This finding is already filed as ${bugRef(already)}.`);
	const finding = (await loadProjectFindings(projectKey)).find((f) => f.id === findingId);
	if (!finding) throw error(409, 'The Profiler no longer finds this — reload its Findings tab.');
	const active = activeBugFor(finding, await findingLinks(projectKey));
	if (active) throw error(409, `This finding is already filed as ${bugRef(active)}.`);
	const target = findingBugTarget(finding, OWNERS);
	if (target.kind !== kind) {
		throw error(400, `This finding is filed as a ${target.kind} bug, not a ${kind} bug.`);
	}
	const evidence = evidenceIds(finding);
	return {
		projectKey,
		within: (tx, bug) =>
			linkFinding(sqlLinkStore(tx), {
				projectKey,
				findingId,
				subject: finding.subject,
				bugNumber: bug.number,
				...evidence,
			}),
		async settle(e) {
			if (e instanceof EvidenceGone) {
				throw error(
					409,
					'A reading or build this finding cites was just deleted — reload the Profiler.',
				);
			}
			if (!(e instanceof AlreadyFiled)) throw e;
			const filed = await filedAs(projectKey, findingId);
			throw error(
				409,
				filed
					? `Someone filed this finding just now, as ${bugRef(filed)}.`
					: 'Someone filed this finding just now.',
			);
		},
	};
}
