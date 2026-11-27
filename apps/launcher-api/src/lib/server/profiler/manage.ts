import { and, eq, inArray, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { bugRef, BUG_ACTIVE_STATUSES, BUG_STATUS_LABELS, isBugStatus } from '$lib/bugReports';
import type { Refusal, RowType } from '$lib/profilerManageTypes';
import { getDb } from '../db';
import { bugReports, perfBuilds, perfFindingBugs, perfReports } from '../db/schema';
import { deleteObject } from '../r2';
import { sqlDeleteClaims } from './purgeJob';
import { removeClaimed } from './purge';

/**
 * A person's Archive, Unarchive and Delete of readings and build records (`/api/profiler/manage`).
 *
 * - **Archive** stamps `archived_at`: the row stays, with its file, but every list, verdict,
 *   finding and comparison leaves it out unless "Show archived" is on (`store.ts` `listReports`,
 *   `builds.ts` `listBuilds`). Anything can be archived — a kept reading, one an open bug cites. An
 *   archived row is held 90 days, then the daily purge takes it unless it is kept (`purgeJob.ts`).
 * - **Delete** is the purge's own path (`purge.ts` `removeClaimed`): claim the row (`purging_at`,
 *   which hides it and which Keep cannot land on), delete its file, then the row. What it may claim
 *   is `purgeJob.ts` `deletableReport` / `deletableBuild`, decided in SQL on the locked row: not a
 *   row an open bug cites, not a kept row — except one a closed bug cites, whose Keep was the bug's.
 *   What it refuses, it says why.
 */

/** Which rows: the named ids, or every row of the project older than `before` / of a `perf:` below. */
export interface Target {
	ids?: readonly string[];
	before?: Date;
	perfBefore?: number;
}

export interface ManageResult {
	done: string[];
	refused: Refusal[];
}

/** Most ids one request names; the page asks again for more. */
export const MANAGE_IDS_MAX = 500;

function targetWhere(type: RowType, projectKey: string, target: Target): SQL | undefined {
	const t = type === 'reading' ? perfReports : perfBuilds;
	const at = type === 'reading' ? perfReports.capturedAt : perfBuilds.registeredAt;
	return and(
		eq(t.projectKey, projectKey),
		isNull(t.purgingAt),
		target.ids ? inArray(t.id, [...target.ids]) : undefined,
		target.before ? lt(at, target.before) : undefined,
		target.perfBefore !== undefined && type === 'reading'
			? lt(perfReports.perfVersion, target.perfBefore)
			: undefined,
	);
}

/** Archives (or unarchives) the rows a target names; the ids it changed. */
export async function setArchived(
	type: RowType,
	projectKey: string,
	target: Target,
	archived: boolean,
): Promise<string[]> {
	const t = type === 'reading' ? perfReports : perfBuilds;
	const rows = await getDb()
		.update(t)
		.set({ archivedAt: archived ? sql`now()` : null })
		.where(
			and(
				targetWhere(type, projectKey, target),
				archived ? isNull(t.archivedAt) : isNotNull(t.archivedAt),
			),
		)
		.returning({ id: t.id });
	return rows.map((r) => r.id);
}

/** How many rows a target would archive, for the confirm line of "Archive all before…". */
export async function countArchivable(
	type: RowType,
	projectKey: string,
	target: Target,
): Promise<number> {
	const t = type === 'reading' ? perfReports : perfBuilds;
	const [row] = await getDb()
		.select({ n: sql<number>`count(*)::int` })
		.from(t)
		.where(and(targetWhere(type, projectKey, target), isNull(t.archivedAt)));
	return row?.n ?? 0;
}

/** The open bug each of these rows is held by, if any. */
async function holdingBugs(
	type: RowType,
	projectKey: string,
	ids: readonly string[],
): Promise<Map<string, { number: number; status: string }>> {
	const links = await getDb()
		.select({
			number: bugReports.number,
			status: bugReports.status,
			cited: type === 'reading' ? perfFindingBugs.readingIds : perfFindingBugs.buildIds,
		})
		.from(perfFindingBugs)
		.innerJoin(bugReports, eq(bugReports.number, perfFindingBugs.bugNumber))
		.where(
			and(
				eq(perfFindingBugs.projectKey, projectKey),
				inArray(bugReports.status, [...BUG_ACTIVE_STATUSES]),
			),
		);
	const out = new Map<string, { number: number; status: string }>();
	for (const link of links) {
		for (const id of link.cited) if (ids.includes(id)) out.set(id, link);
	}
	return out;
}

const WORD: Record<RowType, string> = { reading: 'reading', build: 'build record' };

/** Why a row that was not claimed was not: gone, held by an open bug, or kept. */
export async function refusalReasons(
	type: RowType,
	projectKey: string,
	ids: readonly string[],
): Promise<Refusal[]> {
	if (!ids.length) return [];
	const t = type === 'reading' ? perfReports : perfBuilds;
	const [rows, bugs] = await Promise.all([
		getDb()
			.select({ id: t.id, keep: t.keep })
			.from(t)
			.where(and(eq(t.projectKey, projectKey), inArray(t.id, [...ids]))),
		holdingBugs(type, projectKey, ids),
	]);
	const kept = new Map(rows.map((r) => [r.id, r.keep]));
	return ids.map((id) => {
		const bug = bugs.get(id);
		if (bug) {
			const status = isBugStatus(bug.status) ? BUG_STATUS_LABELS[bug.status] : bug.status;
			return {
				id,
				reason: `${bugRef(bug.number)} (${status.toLowerCase()}) cites this ${WORD[type]} — archive it, and delete it once the bug is closed.`,
			};
		}
		if (!kept.has(id)) return { id, reason: 'Already deleted.' };
		return {
			id,
			reason: kept.get(id)
				? `Kept — untick Keep first, then delete.`
				: `It was just changed (kept, or cited by a bug) — try again.`,
		};
	});
}

/**
 * Deletes rows the way the purge does. Returns what went and what was refused, each with its reason;
 * a file that would not delete leaves its row claimed — hidden, and finished by the next purge.
 */
export async function deleteRows(
	type: RowType,
	projectKey: string,
	ids: readonly string[],
	now = new Date(),
): Promise<ManageResult> {
	const own = sqlDeleteClaims[type];
	// Lock the rows first, then claim as a NEW statement in the same transaction: the claim's
	// condition (is an open bug citing it?) is then read after any bug filing that held a row has
	// committed, which one statement alone — its snapshot taken before the wait — would not.
	const claimed = await getDb().transaction(async (tx) => {
		await own.lock(tx, projectKey, ids);
		return own.claim(projectKey, ids, now, tx);
	});
	const { deleted, failed } = await removeClaimed({
		claimed,
		store: own.store,
		deleteObject,
		what: type,
	});
	const claimedIds = new Set(claimed.map((c) => c.id));
	const unclaimed = ids.filter((id) => !claimedIds.has(id));
	return {
		done: [...deleted, ...failed],
		refused: await refusalReasons(type, projectKey, unclaimed),
	};
}

/** How many readings and build records of the project are archived, for the "Show archived" toggle. */
export async function archivedCounts(
	projectKey: string,
): Promise<{ readings: number; builds: number }> {
	const db = getDb();
	const [[readings], [builds]] = await Promise.all([
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(perfReports)
			.where(
				and(
					eq(perfReports.projectKey, projectKey),
					isNull(perfReports.purgingAt),
					isNotNull(perfReports.archivedAt),
				),
			),
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(perfBuilds)
			.where(
				and(
					eq(perfBuilds.projectKey, projectKey),
					isNull(perfBuilds.purgingAt),
					isNotNull(perfBuilds.archivedAt),
				),
			),
	]);
	return { readings: readings?.n ?? 0, builds: builds?.n ?? 0 };
}
