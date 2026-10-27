import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import type { BugKind, BugStatus, LinkState } from '$lib/bugReports';
import { getDb } from './db';
import {
	bugReportEvents,
	bugReportLinks,
	bugReportScreenshots,
	bugReports,
	type BugEventKind,
	type BugReport,
	type BugReportEvent,
	type BugReportLink,
	type BugReportScreenshot,
} from './db/schema';

/**
 * Postgres access for Invisible Bug Reports, kept to this one module so the bug-reports fixture can
 * replace the database at a single seam. Every write that reads first locks the bug's row, so two
 * people triaging one bug at once apply one after the other; the decisions themselves are made by
 * the callers (`bugReports.ts`) and handed in, never made here.
 */

export type { BugReport, BugReportEvent, BugReportLink, BugReportScreenshot };

/** Who did it: a user, or the launcher itself (`id` null) when a linked pull request did. */
export interface Actor {
	id: string | null;
	name: string;
}

export interface BugEventInput {
	kind: BugEventKind;
	data?: Record<string, unknown>;
}

export type NewBug = Pick<
	BugReport,
	| 'kind'
	| 'title'
	| 'description'
	| 'area'
	| 'projectKey'
	| 'pageUrl'
	| 'priority'
	| 'reporterId'
	| 'reporter'
>;

/** What a decision may change on the row; `updatedAt` is stamped here. */
export type BugPatch = Partial<
	Pick<
		BugReport,
		| 'title'
		| 'description'
		| 'area'
		| 'projectKey'
		| 'pageUrl'
		| 'priority'
		| 'status'
		| 'statusBy'
		| 'statusAt'
		| 'statusAuto'
		| 'sentAt'
		| 'sentBy'
		| 'revision'
	>
>;

/** A decision on a locked row: what to set and what to record, or `null` to change nothing. */
export type BugDecision = (bug: BugReport) => { set: BugPatch; events: BugEventInput[] } | null;

export interface BugRows {
	bugs: BugReport[];
	screenshots: Map<number, number>;
	links: Map<number, BugReportLink[]>;
}

export interface BugFull {
	bug: BugReport;
	screenshots: BugReportScreenshot[];
	events: BugReportEvent[];
	links: BugReportLink[];
}

/** A pull request as GitHub answered it, for one bug it names. */
export interface ObservedLink {
	prNumber: number;
	title: string;
	url: string;
	state: LinkState;
}

/** What reconciling one bug's links writes: the rows to upsert or drop, and the row and events. */
export type LinkPlanner = (
	bug: BugReport,
	existing: BugReportLink[],
) => { upserts: ObservedLink[]; removes: number[]; set: BugPatch; events: BugEventInput[] };

const LIST_LIMIT = 5000;

const groupBy = <T extends { bugNumber: number }>(rows: T[]): Map<number, T[]> => {
	const out = new Map<number, T[]>();
	for (const r of rows) out.set(r.bugNumber, [...(out.get(r.bugNumber) ?? []), r]);
	return out;
};

/** One kind's bugs (one project's, when named), newest first, with screenshot counts and links. */
export async function listBugRows(where: { kind: BugKind; projectKey?: string }): Promise<BugRows> {
	const db = getDb();
	const bugs = await db
		.select()
		.from(bugReports)
		.where(
			and(
				eq(bugReports.kind, where.kind),
				where.projectKey === undefined ? undefined : eq(bugReports.projectKey, where.projectKey),
			),
		)
		.orderBy(desc(bugReports.number))
		.limit(LIST_LIMIT);
	const numbers = bugs.map((b) => b.number);
	if (!numbers.length) return { bugs, screenshots: new Map(), links: new Map() };
	const [shots, links] = await Promise.all([
		db
			.select({ bugNumber: bugReportScreenshots.bugNumber, n: count() })
			.from(bugReportScreenshots)
			.where(inArray(bugReportScreenshots.bugNumber, numbers))
			.groupBy(bugReportScreenshots.bugNumber),
		db
			.select()
			.from(bugReportLinks)
			.where(inArray(bugReportLinks.bugNumber, numbers))
			.orderBy(asc(bugReportLinks.prNumber)),
	]);
	return {
		bugs,
		screenshots: new Map(shots.map((s) => [s.bugNumber, Number(s.n)])),
		links: groupBy(links),
	};
}

/** One bug with everything the detail shows, or `null`. */
export async function getBugFull(number: number): Promise<BugFull | null> {
	const db = getDb();
	const [bug] = await db.select().from(bugReports).where(eq(bugReports.number, number));
	if (!bug) return null;
	const [screenshots, events, links] = await Promise.all([
		db
			.select()
			.from(bugReportScreenshots)
			.where(eq(bugReportScreenshots.bugNumber, number))
			.orderBy(asc(bugReportScreenshots.uploadedAt)),
		db
			.select()
			.from(bugReportEvents)
			.where(eq(bugReportEvents.bugNumber, number))
			.orderBy(asc(bugReportEvents.id)),
		db
			.select()
			.from(bugReportLinks)
			.where(eq(bugReportLinks.bugNumber, number))
			.orderBy(asc(bugReportLinks.prNumber)),
	]);
	return { bug, screenshots, events, links };
}

/** One screenshot's row, only when it belongs to that bug. */
export async function getScreenshot(
	number: number,
	id: string,
): Promise<BugReportScreenshot | null> {
	const [row] = await getDb()
		.select()
		.from(bugReportScreenshots)
		.where(and(eq(bugReportScreenshots.bugNumber, number), eq(bugReportScreenshots.id, id)));
	return row ?? null;
}

/** The bugs of one kind among `numbers` that exist. */
export async function existingBugNumbers(numbers: number[], kind: BugKind): Promise<number[]> {
	if (!numbers.length) return [];
	const rows = await getDb()
		.select({ number: bugReports.number })
		.from(bugReports)
		.where(and(inArray(bugReports.number, numbers), eq(bugReports.kind, kind)));
	return rows.map((r) => r.number);
}

/** Every link still held as open, with when it was last written. */
export async function listOpenLinks(): Promise<
	{ bugNumber: number; prNumber: number; updatedAt: Date }[]
> {
	return getDb()
		.select({
			bugNumber: bugReportLinks.bugNumber,
			prNumber: bugReportLinks.prNumber,
			updatedAt: bugReportLinks.updatedAt,
		})
		.from(bugReportLinks)
		.where(eq(bugReportLinks.state, 'open'));
}

/**
 * Insert a bug and its `reported` event in one transaction. `data` rides on that event: a Director
 * run's `opId` and request (`createDirectorBug`), which is what finds the bug again.
 */
export async function insertBug(
	values: NewBug,
	actor: Actor,
	data: Record<string, unknown> = {},
): Promise<BugReport> {
	return getDb().transaction(async (tx) => {
		const [bug] = await tx.insert(bugReports).values(values).returning();
		await tx.insert(bugReportEvents).values({
			bugNumber: bug.number,
			kind: 'reported',
			actorId: actor.id,
			actor: actor.name,
			// The priority the reporter gave, if any: the one priority not set by a triager.
			data: { ...data, ...(values.priority ? { priority: values.priority } : {}) },
		});
		return bug;
	});
}

export interface ReportedBug {
	number: number;
	kind: BugKind;
	projectKey: string | null;
	status: BugStatus;
	/** Its `reported` event's data. */
	data: Record<string, unknown>;
}

/** Every bug reported under the name `reporter`, oldest first, with its `reported` event's data. */
export async function bugsReportedAs(reporter: string): Promise<ReportedBug[]> {
	return getDb()
		.select({
			number: bugReports.number,
			kind: bugReports.kind,
			projectKey: bugReports.projectKey,
			status: bugReports.status,
			data: bugReportEvents.data,
		})
		.from(bugReports)
		.innerJoin(
			bugReportEvents,
			and(eq(bugReportEvents.bugNumber, bugReports.number), eq(bugReportEvents.kind, 'reported')),
		)
		.where(eq(bugReports.reporter, reporter))
		.orderBy(asc(bugReports.number));
}

/**
 * Apply `decide` to the bug's row under a lock. `null` when there is no such bug; the row as it
 * stands when the decision changes nothing. A decision may throw to refuse, which writes nothing.
 */
export async function mutateBug(
	number: number,
	actor: Actor,
	decide: BugDecision,
): Promise<BugReport | null> {
	return getDb().transaction(async (tx) => {
		const [bug] = await tx
			.select()
			.from(bugReports)
			.where(eq(bugReports.number, number))
			.for('update');
		if (!bug) return null;
		const decision = decide(bug);
		if (!decision) return bug;
		const [updated] = await tx
			.update(bugReports)
			.set({ ...decision.set, updatedAt: new Date() })
			.where(eq(bugReports.number, number))
			.returning();
		if (decision.events.length) {
			await tx.insert(bugReportEvents).values(
				decision.events.map((e) => ({
					bugNumber: number,
					kind: e.kind,
					actorId: actor.id,
					actor: actor.name,
					data: e.data ?? {},
				})),
			);
		}
		return updated;
	});
}

/**
 * Record a screenshot whose bytes are already stored, unless the bug holds `max` of them (counted
 * under the bug's lock, so two uploads at once cannot both take the last place).
 */
export async function insertScreenshot(
	row: Omit<BugReportScreenshot, 'uploadedAt'>,
	max: number,
	actor: Actor,
): Promise<'added' | 'missing' | 'full'> {
	return getDb().transaction(async (tx) => {
		const [bug] = await tx
			.select({ number: bugReports.number })
			.from(bugReports)
			.where(eq(bugReports.number, row.bugNumber))
			.for('update');
		if (!bug) return 'missing';
		const [{ n }] = await tx
			.select({ n: count() })
			.from(bugReportScreenshots)
			.where(eq(bugReportScreenshots.bugNumber, row.bugNumber));
		if (Number(n) >= max) return 'full';
		await tx.insert(bugReportScreenshots).values(row);
		await tx
			.update(bugReports)
			.set({ updatedAt: new Date() })
			.where(eq(bugReports.number, row.bugNumber));
		await tx.insert(bugReportEvents).values({
			bugNumber: row.bugNumber,
			kind: 'screenshot_added',
			actorId: actor.id,
			actor: actor.name,
			data: { id: row.id },
		});
		return 'added';
	});
}

/** Drop a screenshot's row; the caller deletes the object after. `null` when it was not there. */
export async function deleteScreenshot(
	number: number,
	id: string,
	actor: Actor,
): Promise<BugReportScreenshot | null> {
	return getDb().transaction(async (tx) => {
		const [gone] = await tx
			.delete(bugReportScreenshots)
			.where(and(eq(bugReportScreenshots.bugNumber, number), eq(bugReportScreenshots.id, id)))
			.returning();
		if (!gone) return null;
		await tx.update(bugReports).set({ updatedAt: new Date() }).where(eq(bugReports.number, number));
		await tx.insert(bugReportEvents).values({
			bugNumber: number,
			kind: 'screenshot_removed',
			actorId: actor.id,
			actor: actor.name,
			data: { id },
		});
		return gone;
	});
}

/** Reconcile one bug's links under its lock, as `plan` decides from the rows as they stand. */
export async function reconcileLinks(
	number: number,
	actor: Actor,
	plan: LinkPlanner,
): Promise<void> {
	await getDb().transaction(async (tx) => {
		const [bug] = await tx
			.select()
			.from(bugReports)
			.where(eq(bugReports.number, number))
			.for('update');
		if (!bug) return;
		const existing = await tx
			.select()
			.from(bugReportLinks)
			.where(eq(bugReportLinks.bugNumber, number));
		const { upserts, removes, set, events } = plan(bug, existing);
		const now = new Date();
		if (removes.length) {
			await tx
				.delete(bugReportLinks)
				.where(
					and(eq(bugReportLinks.bugNumber, number), inArray(bugReportLinks.prNumber, removes)),
				);
		}
		for (const link of upserts) {
			await tx
				.insert(bugReportLinks)
				.values({ bugNumber: number, ...link, updatedAt: now })
				.onConflictDoUpdate({
					target: [bugReportLinks.bugNumber, bugReportLinks.prNumber],
					set: { title: link.title, url: link.url, state: link.state, updatedAt: now },
				});
		}
		if (Object.keys(set).length) {
			await tx
				.update(bugReports)
				.set({ ...set, updatedAt: now })
				.where(eq(bugReports.number, number));
		}
		if (events.length) {
			await tx.insert(bugReportEvents).values(
				events.map((e) => ({
					bugNumber: number,
					kind: e.kind,
					actorId: actor.id,
					actor: actor.name,
					data: e.data ?? {},
				})),
			);
		}
	});
}
