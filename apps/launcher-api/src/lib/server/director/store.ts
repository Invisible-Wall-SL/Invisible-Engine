import { and, asc, desc, eq, gt, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { r2SlugSql, type Queryer } from '../projectKeyLock';
import {
	directorAtlasJobs,
	directorBlueprintTimings,
	directorEvents,
	directorMessages,
	directorOps,
	directorRegions,
	directorRuns,
	directorSpend,
	directorTemplateRecipes,
	users,
	type DirectorAtlasJob,
	type DirectorEvent,
	type DirectorOp,
	type DirectorRun,
} from '../db/schema';

/**
 * Postgres access for Invisible Director's launcher side: the adapter gate (ADR-0002) — the run
 * stub, the run owner the adapters act as, the `director_ops` idempotency ledger — and the owner
 * API (PLAN 4A) — the draft run, the owner's rows, and what the run summary reads. Kept in one
 * module so each fixture can replace the database at a single seam.
 */

/** The run's stored recipes (ADR-0008 §5), as the worker wrote them; the queue gate reads them. */
export async function runRecipes(runId: string): Promise<unknown[]> {
	const rows = await getDb()
		.select({ recipe: directorRegions.recipeJson })
		.from(directorRegions)
		.where(and(eq(directorRegions.runId, runId), sql`${directorRegions.recipeJson} is not null`));
	return rows.map((r) => r.recipe);
}

/**
 * The regions the coordinator's latest `run.set_plan` names, in its order, each with its batch:
 * the same row the worker reads (`recipes.ts` `planRegions`).
 */
export async function latestPlanRegions(runId: string): Promise<Map<string, string>> {
	const [row] = await getDb()
		.select({ payload: directorEvents.payloadJson })
		.from(directorEvents)
		.where(
			and(
				eq(directorEvents.runId, runId),
				eq(directorEvents.kind, 'activity'),
				sql`${directorEvents.payloadJson}->>'type' = 'plan'`,
			),
		)
		.orderBy(desc(directorEvents.id))
		.limit(1);
	const out = new Map<string, string>();
	const batches = (row?.payload as { batches?: unknown } | undefined)?.batches;
	for (const batch of Array.isArray(batches) ? batches : []) {
		const b = batch as { name?: unknown; regions?: unknown };
		if (!Array.isArray(b.regions)) continue;
		for (const region of b.regions) {
			if (typeof region === 'string' && !out.has(region)) out.set(region, String(b.name ?? ''));
		}
	}
	return out;
}

/** Measured GPU time per (pipeline, genPx), as the worker folds it in from every `job_done`. */
export async function blueprintTimings(): Promise<
	{
		pipeline: string;
		genPx: number;
		jobs: number;
		meanExecSeconds: number;
		meanDelaySeconds: number;
	}[]
> {
	return getDb()
		.select({
			pipeline: directorBlueprintTimings.pipeline,
			genPx: directorBlueprintTimings.genPx,
			jobs: directorBlueprintTimings.jobs,
			meanExecSeconds: directorBlueprintTimings.meanExecSeconds,
			meanDelaySeconds: directorBlueprintTimings.meanDelaySeconds,
		})
		.from(directorBlueprintTimings);
}

/**
 * A template's latest default chain per region group (`director_template_recipes`), with the
 * atlases that group's recipes ran on in the run whose approval wrote it: what lets the New game
 * estimate price a template atlas at the chain its regions were made with.
 */
export async function templateDefaultChains(
	templateProjectKey: string,
): Promise<{ group: string; version: number; chain: unknown; atlases: string[] }[]> {
	const db = getDb();
	const rows = await db
		.selectDistinctOn([directorTemplateRecipes.regionGroup], {
			group: directorTemplateRecipes.regionGroup,
			version: directorTemplateRecipes.version,
			chain: directorTemplateRecipes.chainJson,
			runId: directorTemplateRecipes.runId,
		})
		.from(directorTemplateRecipes)
		.where(eq(directorTemplateRecipes.templateProjectKey, templateProjectKey))
		.orderBy(directorTemplateRecipes.regionGroup, desc(directorTemplateRecipes.version));
	if (rows.length === 0) return [];
	// The atlases each default's recipes ran on, for every group in one read.
	const ran = await db
		.selectDistinct({
			runId: directorRegions.runId,
			group: directorRegions.regionGroup,
			atlas: sql<string>`${directorRegions.recipeJson}->>'atlas'`,
		})
		.from(directorRegions)
		.where(
			and(
				sql`${directorRegions.recipeJson} is not null`,
				or(
					...rows.map((r) =>
						and(eq(directorRegions.runId, r.runId), eq(directorRegions.regionGroup, r.group)),
					),
				),
			),
		);
	return rows.map(({ runId, ...row }) => ({
		...row,
		atlases: ran
			.filter((a) => a.runId === runId && a.group === row.group && a.atlas)
			.map((a) => a.atlas),
	}));
}

/** The stored results of this run's finished calls of `op` (`<tool>.<op>`), oldest first. */
export async function doneOpResults(runId: string, op: string): Promise<unknown[]> {
	const rows = await getDb()
		.select({ result: directorOps.result })
		.from(directorOps)
		.where(
			and(eq(directorOps.runId, runId), eq(directorOps.op, op), eq(directorOps.status, 'done')),
		)
		.orderBy(asc(directorOps.createdAt));
	return rows.map((r) => r.result);
}

/** Like `doneOpResults`, over every run of the project `projectKey`. */
export async function projectOpResults(projectKey: string, op: string): Promise<unknown[]> {
	const rows = await getDb()
		.select({ result: directorOps.result })
		.from(directorOps)
		.innerJoin(directorRuns, eq(directorRuns.id, directorOps.runId))
		.where(
			and(
				eq(directorRuns.projectKey, projectKey),
				eq(directorOps.op, op),
				eq(directorOps.status, 'done'),
			),
		)
		.orderBy(asc(directorOps.createdAt));
	return rows.map((r) => r.result);
}

export async function getRun(runId: string): Promise<DirectorRun | null> {
	const [row] = await getDb().select().from(directorRuns).where(eq(directorRuns.id, runId));
	return row ?? null;
}

/**
 * The run owner as a session user — the identity every adapter call acts as (Q5). `null` when the
 * account is gone, disabled or past its expiry: the same accounts `validateSession` refuses, so a
 * disabled owner's run can do nothing a disabled owner could not.
 */
export async function getRunOwner(userId: string): Promise<NonNullable<App.Locals['user']> | null> {
	const [row] = await getDb()
		.select({
			id: users.id,
			email: users.email,
			name: users.name,
			role: users.role,
			active: users.active,
			expiresAt: users.expiresAt,
		})
		.from(users)
		.where(eq(users.id, userId));
	if (!row || !row.active) return null;
	if (row.expiresAt !== null && row.expiresAt.getTime() < Date.now()) return null;
	return { id: row.id, email: row.email, name: row.name, role: row.role };
}

/** Claim the run's project key for this run, before `create_from_template` copies anything. */
export async function markProjectCreateStarted(runId: string): Promise<void> {
	await getDb()
		.update(directorRuns)
		.set({ projectCreateStartedAt: new Date(), updatedAt: new Date() })
		.where(eq(directorRuns.id, runId));
}

/** Record the math-lock ETags on the run when its project is copied from the template (Q3). */
export async function setRunConfigEtags(
	runId: string,
	etags: { template: string | null; project: string | null },
): Promise<void> {
	await getDb()
		.update(directorRuns)
		.set({
			templateConfigEtag: etags.template,
			projectConfigEtag: etags.project,
			updatedAt: new Date(),
		})
		.where(eq(directorRuns.id, runId));
}

export type OpClaim = { claimed: true } | { claimed: false; existing: DirectorOp };

/**
 * How long a `pending` claim holds before the next call with its `opId` may reclaim it. Longer than
 * any adapter call runs (a full duplicate is capped at 4,000 objects), so a live call is never
 * taken over; a claim left by a crash stops wedging its `opId` after this.
 */
export const STALE_CLAIM_MS = 10 * 60_000;

/**
 * Claim `opId` before running a write op. The insert is the lock: of two concurrent calls with the
 * same `opId`, exactly one inserts. The other gets the row it lost to — `pending` while the first is
 * still running, `done` with the stored result after.
 */
export async function claimOp(row: {
	opId: string;
	runId: string;
	agent: string;
	op: string;
	inputHash: string;
}): Promise<OpClaim> {
	await getDb()
		.delete(directorOps)
		.where(
			and(
				eq(directorOps.opId, row.opId),
				eq(directorOps.status, 'pending'),
				lt(directorOps.createdAt, new Date(Date.now() - STALE_CLAIM_MS)),
			),
		);
	const inserted = await getDb()
		.insert(directorOps)
		.values({ ...row, status: 'pending' })
		.onConflictDoNothing({ target: directorOps.opId })
		.returning({ opId: directorOps.opId });
	if (inserted.length > 0) return { claimed: true };
	const [existing] = await getDb().select().from(directorOps).where(eq(directorOps.opId, row.opId));
	// Released between our insert and this read: nothing stored, so it is the caller's to retry.
	if (!existing) return claimOp(row);
	return { claimed: false, existing };
}

export async function completeOp(opId: string, result: unknown): Promise<void> {
	await getDb()
		.update(directorOps)
		.set({ status: 'done', result, completedAt: new Date() })
		.where(eq(directorOps.opId, opId));
}

/** Drop a claim whose op failed, so a retry runs it again rather than replaying the failure. */
export async function releaseOp(opId: string): Promise<void> {
	await getDb()
		.delete(directorOps)
		.where(and(eq(directorOps.opId, opId), eq(directorOps.status, 'pending')));
}

/** Record a still render a run queued, as atlas-tool named it, with the recipe steps it runs. */
export async function insertAtlasJob(row: {
	jobRef: string;
	runId: string;
	agent: string;
	atlas: string;
	regions: string[];
	steps: { recipe: string; n: number; region: string }[];
}): Promise<void> {
	await getDb().transaction(async (tx) => {
		const inserted = await tx
			.insert(directorAtlasJobs)
			.values({ ...row, status: 'queued' })
			.onConflictDoNothing({ target: directorAtlasJobs.jobRef })
			.returning({ jobRef: directorAtlasJobs.jobRef });
		if (inserted.length === 0) return;
		await tx.insert(directorEvents).values({
			runId: row.runId,
			agent: row.agent,
			kind: 'job_queued',
			tool: 'atlas.queue_variants',
			payloadJson: { jobRef: row.jobRef, atlas: row.atlas, regions: row.regions },
		});
	});
}

/** Every render still queued, of every run: what the fallback watches at boot. */
export async function queuedAtlasJobs(): Promise<DirectorAtlasJob[]> {
	return getDb().select().from(directorAtlasJobs).where(eq(directorAtlasJobs.status, 'queued'));
}

export async function getAtlasJob(jobRef: string): Promise<DirectorAtlasJob | null> {
	const [row] = await getDb()
		.select()
		.from(directorAtlasJobs)
		.where(eq(directorAtlasJobs.jobRef, jobRef));
	return row ?? null;
}

/**
 * The run's `job_done`: move a queued render of `runId` to its terminal status and append the
 * `job_done` event that wakes the worker, in one transaction. Conditional on it still being
 * `queued`, so of the callback, its redeliveries and the `/progress` fallback, exactly one records
 * it. Returns the settled row to that one caller, and `null` to every other.
 */
export async function settleAtlasJob(done: {
	jobRef: string;
	runId: string;
	status: 'finished' | 'failed' | 'cancelled';
	result: unknown;
	via: 'callback' | 'poll';
}): Promise<DirectorAtlasJob | null> {
	return getDb().transaction(async (tx) => {
		const [row] = await tx
			.update(directorAtlasJobs)
			.set({ status: done.status, result: done.result, doneVia: done.via, doneAt: new Date() })
			.where(
				and(
					eq(directorAtlasJobs.jobRef, done.jobRef),
					eq(directorAtlasJobs.runId, done.runId),
					eq(directorAtlasJobs.status, 'queued'),
				),
			)
			.returning();
		if (!row) return null;
		await tx.insert(directorEvents).values({
			runId: row.runId,
			agent: row.agent,
			kind: 'job_done',
			tool: 'atlas.queue_variants',
			payloadJson: {
				jobRef: row.jobRef,
				atlas: row.atlas,
				regions: row.regions,
				status: row.status,
				via: done.via,
				result: done.result,
			},
		});
		return row;
	});
}

/** The run's events after `afterId`, oldest first — the live stream's catch-up read. */
export async function listEventsAfter(
	runId: string,
	afterId: number,
	limit: number,
): Promise<DirectorEvent[]> {
	return getDb()
		.select()
		.from(directorEvents)
		.where(and(eq(directorEvents.runId, runId), gt(directorEvents.id, afterId)))
		.orderBy(asc(directorEvents.id))
		.limit(limit);
}

/**
 * The id just before the run's `count` most recent events with `id <= upTo`, or 0 when there are no
 * more than `count` — the stream's look-back start, counted in THIS run's rows (`id` is shared by
 * every run).
 */
export async function eventAnchor(runId: string, upTo: number, count: number): Promise<number> {
	const [row] = await getDb()
		.select({ id: directorEvents.id })
		.from(directorEvents)
		.where(and(eq(directorEvents.runId, runId), lte(directorEvents.id, upTo)))
		.orderBy(desc(directorEvents.id))
		.offset(count)
		.limit(1);
	return row?.id ?? 0;
}

/** One event of the run, or null — a NOTIFY names it and the stream fetches it. */
export async function getEvent(runId: string, id: number): Promise<DirectorEvent | null> {
	const [row] = await getDb()
		.select()
		.from(directorEvents)
		.where(and(eq(directorEvents.runId, runId), eq(directorEvents.id, id)));
	return row ?? null;
}

// ── The owner API (PLAN 4A) ───────────────────────────────────────────────────

export interface NewRun {
	id: string;
	projectKey: string;
	clientKey: string | null;
	templateProjectKey: string;
	ownerUserId: string;
	presetJson: unknown;
	startingPointJson: unknown;
	checkpointsJson: unknown;
}

/**
 * Insert a draft run that has claimed its project key: `project_create_started_at` is set, so a
 * `gamemaker.create_from_template` that finds the project already there resumes rather than
 * refuses. The budget cap stays null: the worker copies Settings onto the run at start
 * (ADR-0006). False when the id exists — a replayed create, which returns the run it made.
 */
export async function insertDraftRun(row: NewRun, db: Queryer = getDb()): Promise<boolean> {
	const inserted = await db
		.insert(directorRuns)
		.values({ ...row, status: 'draft', step: 'breakdown', projectCreateStartedAt: new Date() })
		.onConflictDoNothing({ target: directorRuns.id })
		.returning({ id: directorRuns.id });
	return inserted.length === 1;
}

/** Drop a draft whose project could not be created; its (empty) event history goes with it. */
export async function deleteDraftRun(runId: string): Promise<void> {
	await getDb()
		.delete(directorRuns)
		.where(and(eq(directorRuns.id, runId), eq(directorRuns.status, 'draft')));
}

/**
 * Every project key a run names, in any state — a key with a run is the run's, never a pending
 * key's to clear (`mockupCleanup.ts`, which compares them by R2 folder).
 */
export async function listRunProjectKeys(): Promise<string[]> {
	const rows = await getDb()
		.selectDistinct({ projectKey: directorRuns.projectKey })
		.from(directorRuns);
	return rows.map((r) => r.projectKey);
}

/** Whether any run, in any state, names a key whose R2 folder is `slug`; on the lock's `tx`. */
export async function runInFolder(slug: string, db: Queryer = getDb()): Promise<boolean> {
	const [row] = await db
		.select({ id: directorRuns.id })
		.from(directorRuns)
		.where(eq(r2SlugSql(directorRuns.projectKey), slug))
		.limit(1);
	return Boolean(row);
}

/** Refresh a draft's starting point; a run the worker has moved since keeps what it started with. */
export async function updateDraftStartingPoint(runId: string, startingPointJson: unknown) {
	await getDb()
		.update(directorRuns)
		.set({ startingPointJson, updatedAt: new Date() })
		.where(and(eq(directorRuns.id, runId), eq(directorRuns.status, 'draft')));
}

/** A user's runs, newest first, within one project when `projectKey` is given. */
export async function listRuns(filter: {
	ownerUserId: string;
	projectKey?: string;
}): Promise<DirectorRun[]> {
	const where =
		filter.projectKey === undefined
			? eq(directorRuns.ownerUserId, filter.ownerUserId)
			: and(
					eq(directorRuns.ownerUserId, filter.ownerUserId),
					eq(directorRuns.projectKey, filter.projectKey),
				);
	return getDb().select().from(directorRuns).where(where).orderBy(desc(directorRuns.createdAt));
}

export interface RunSpendTotals {
	claudeUsd: number;
	runpodUsd: number;
}

/** Spend so far per run, by kind, for the runs named; a run with no rows is absent. */
export async function runSpendTotals(runIds: string[]): Promise<Map<string, RunSpendTotals>> {
	const out = new Map<string, RunSpendTotals>();
	if (runIds.length === 0) return out;
	const usd = sql<number>`coalesce(sum(${directorSpend.usd}), 0)`.mapWith(Number);
	const rows = await getDb()
		.select({ runId: directorSpend.runId, kind: directorSpend.kind, usd })
		.from(directorSpend)
		.where(inArray(directorSpend.runId, runIds))
		.groupBy(directorSpend.runId, directorSpend.kind);
	for (const row of rows) {
		const totals = out.get(row.runId) ?? { claudeUsd: 0, runpodUsd: 0 };
		if (row.kind === 'claude') totals.claudeUsd += row.usd;
		else totals.runpodUsd += row.usd;
		out.set(row.runId, totals);
	}
	return out;
}

/** The run's most recent `checkpoint_open` row, or null. */
export async function latestCheckpointOpen(runId: string): Promise<DirectorEvent | null> {
	const [row] = await getDb()
		.select()
		.from(directorEvents)
		.where(and(eq(directorEvents.runId, runId), eq(directorEvents.kind, 'checkpoint_open')))
		.orderBy(desc(directorEvents.id))
		.limit(1);
	return row ?? null;
}

/** The id of the run's newest event, or 0: where a page's stream picks up. */
export async function lastEventId(runId: string): Promise<number> {
	const [row] = await getDb()
		.select({ id: directorEvents.id })
		.from(directorEvents)
		.where(eq(directorEvents.runId, runId))
		.orderBy(desc(directorEvents.id))
		.limit(1);
	return row?.id ?? 0;
}

export interface AgentConversation {
	agent: string;
	/** Whose message is last: the user's means a model call is owed. */
	lastRole: 'user' | 'assistant';
	/** An assistant message whose tool calls have no results yet. */
	hasToolUse: boolean;
	at: Date;
}

/** Each agent's last message in the run, as the worker's `pendingAgents` reads them. */
export async function agentConversations(runId: string): Promise<AgentConversation[]> {
	const rows = await getDb()
		.selectDistinctOn([directorMessages.agent], {
			agent: directorMessages.agent,
			lastRole: directorMessages.role,
			hasToolUse: sql<boolean>`${directorMessages.contentJson} @> '[{"type":"tool_use"}]'::jsonb`,
			at: directorMessages.createdAt,
		})
		.from(directorMessages)
		.where(eq(directorMessages.runId, runId))
		.orderBy(directorMessages.agent, desc(directorMessages.seq));
	return rows.map((r) => ({ ...r, hasToolUse: r.lastRole === 'assistant' && r.hasToolUse }));
}

/** The ledger row an owner request claimed (`appendOwnerEvent`), or null: what a resend is answered from. */
export async function findOwnerRequest(
	runId: string,
	requestId: string,
): Promise<DirectorOp | null> {
	const [row] = await getDb()
		.select()
		.from(directorOps)
		.where(eq(directorOps.opId, `${runId}:owner:${requestId}`));
	return row ?? null;
}

export type OwnerEventOutcome =
	{ eventId: number; replayed: boolean } | { conflict: 'reused' | 'in_progress' };

/**
 * Append ONE owner row for `requestId`, once: the request is claimed in `director_ops` under
 * `<runId>:owner:<requestId>` (the same ledger a worker write uses, so the two can never collide:
 * a worker's tail is `<step>:<seq>`), the row is inserted and the claim completed with its id in one
 * transaction, and a replay — the same request id with the same input — returns that id without
 * inserting again. The same id with another input is `reused`; one still being written is
 * `in_progress`.
 */
export async function appendOwnerEvent(args: {
	runId: string;
	requestId: string;
	action: string;
	inputHash: string;
	kind: 'owner_request' | 'owner_message' | 'checkpoint_resolved';
	payload: Record<string, unknown>;
}): Promise<OwnerEventOutcome> {
	const opId = `${args.runId}:owner:${args.requestId}`;
	const op = `owner.${args.action}`;
	const claim = await claimOp({
		opId,
		runId: args.runId,
		agent: 'owner',
		op,
		inputHash: args.inputHash,
	});
	if (!claim.claimed) {
		const { existing } = claim;
		if (existing.op !== op || existing.inputHash !== args.inputHash) return { conflict: 'reused' };
		if (existing.status !== 'done') return { conflict: 'in_progress' };
		return { eventId: (existing.result as { eventId: number }).eventId, replayed: true };
	}
	try {
		return await getDb().transaction(async (tx) => {
			const [row] = await tx
				.insert(directorEvents)
				.values({ runId: args.runId, agent: 'owner', kind: args.kind, payloadJson: args.payload })
				.returning({ id: directorEvents.id });
			await tx
				.update(directorOps)
				.set({ status: 'done', result: { eventId: row.id }, completedAt: new Date() })
				.where(eq(directorOps.opId, opId));
			return { eventId: row.id, replayed: false };
		});
	} catch (e) {
		await releaseOp(opId);
		throw e;
	}
}
