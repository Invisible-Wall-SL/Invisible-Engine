import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Finding } from '$lib/profilerFindings/finding';
import type { BugTx } from '../bugReportsStore';
import type { FindingDraft } from './findingBugs';
import { getDb } from '../db';
import { perfBuilds, perfFindingBugs, perfReports } from '../db/schema';

/**
 * What filing a Profiler finding writes beside its bug, in the bug's own transaction
 * (`findingBugs.ts`): the link — once per finding, by `perf_finding_bugs`' primary key — then Keep
 * on the readings and builds it cites. Apart from `findingBugs.ts` (which reads the rules through
 * `import.meta.glob`) so `scripts/check-profiler-bugs.ts` runs it over an in-memory store.
 */

export interface FindingLink {
	projectKey: string;
	findingId: string;
	bugNumber: number;
	readingIds: string[];
	buildIds: string[];
}

export interface FindingLinkStore {
	/** False when the finding already has a bug — another filing got there first. */
	link(row: FindingLink): Promise<boolean>;
	/** Keep on these rows of the project, except one the purge has already claimed: how many. */
	keep(projectKey: string, type: 'reading' | 'build', ids: readonly string[]): Promise<number>;
}

/** The finding got its bug meanwhile: thrown inside the transaction, which rolls the bug back. */
export class AlreadyFiled extends Error {}

/**
 * A cited row is gone or claimed by the purge since the finding was read: the bug would point at
 * evidence about to be deleted, so nothing is filed.
 */
export class EvidenceGone extends Error {}

/** The readings and builds a finding cites, as it is filed. */
export const evidenceIds = (finding: Pick<Finding, 'evidence'>) => ({
	readingIds: finding.evidence.filter((e) => e.type === 'reading').map((e) => e.id),
	buildIds: finding.evidence.filter((e) => e.type === 'build').map((e) => e.id),
});

export async function linkFinding(store: FindingLinkStore, row: FindingLink): Promise<void> {
	if (!(await store.link(row))) throw new AlreadyFiled();
	for (const [type, ids] of [
		['reading', [...new Set(row.readingIds)]],
		['build', [...new Set(row.buildIds)]],
	] as const) {
		if (ids.length && (await store.keep(row.projectKey, type, ids)) < ids.length) {
			throw new EvidenceGone();
		}
	}
}

/**
 * On Postgres. Two filings at once: the second insert waits on the first's uncommitted key, then
 * `on conflict do nothing` inserts nothing once it commits (or inserts, if it rolled back).
 */
export const sqlLinkStore = (tx: BugTx): FindingLinkStore => ({
	async link(row) {
		const linked = await tx
			.insert(perfFindingBugs)
			.values(row)
			.onConflictDoNothing()
			.returning({ bugNumber: perfFindingBugs.bugNumber });
		return linked.length > 0;
	},
	async keep(projectKey, type, ids) {
		// `purging_at IS NULL`, as the page's Keep: a claimed row's file is being deleted.
		if (type === 'reading') {
			const kept = await tx
				.update(perfReports)
				.set({ keep: true })
				.where(
					and(
						eq(perfReports.projectKey, projectKey),
						inArray(perfReports.id, [...ids]),
						isNull(perfReports.purgingAt),
					),
				)
				.returning({ id: perfReports.id });
			return kept.length;
		}
		const kept = await tx
			.update(perfBuilds)
			.set({ keep: true })
			.where(
				and(
					eq(perfBuilds.projectKey, projectKey),
					inArray(perfBuilds.id, [...ids]),
					isNull(perfBuilds.purgingAt),
				),
			)
			.returning({ id: perfBuilds.id });
		return kept.length;
	},
});

/** The query behind {@link citingBug}, apart so the gate reads its SQL. */
export function citingQuery(projectKey: string, type: 'reading' | 'build', id: string) {
	const list = type === 'reading' ? perfFindingBugs.readingIds : perfFindingBugs.buildIds;
	return getDb()
		.select({ number: perfFindingBugs.bugNumber })
		.from(perfFindingBugs)
		.where(and(eq(perfFindingBugs.projectKey, projectKey), sql`${id} = any(${list})`))
		.limit(1);
}

/** The bug that cites a reading or build of the project, if one does: its Keep stays on. */
export async function citingBug(
	projectKey: string,
	type: 'reading' | 'build',
	id: string,
): Promise<number | null> {
	const [row] = await citingQuery(projectKey, type, id);
	return row?.number ?? null;
}

/**
 * The bug pages' draft for a `?finding=` link (`findingBugs.ts` `askedFindingDraft`), imported only
 * when a link names one: the rules read `owners.json` through `import.meta.glob`, which the Node
 * fixtures importing the bug pages cannot load.
 */
export async function findingDraftOf(
	user: NonNullable<App.Locals['user']>,
	url: URL,
): Promise<FindingDraft | null> {
	if (!url.searchParams.has('finding')) return null;
	const { askedFindingDraft } = await import('./findingBugs');
	return askedFindingDraft(user, url);
}
