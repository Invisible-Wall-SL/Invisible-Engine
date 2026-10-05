import { randomUUID } from 'node:crypto';
import type { JSONValue, Sql } from 'postgres';
import type { Checkpoint, RunState, RunStatus, RunStep } from './runState.ts';
import { checkpointSettings } from './runState.ts';

/**
 * Run leases (ADR-0001, ADR-0003). A worker drives a run only while it holds that run's lease:
 *
 * - **claim** picks one claimable run with `FOR UPDATE SKIP LOCKED`, so two workers racing for the
 *   same row never both get it — the loser skips it and takes the next one, or nothing;
 * - the claim stores a token unique to THAT claim (`<workerId>#<uuid>`) as `lease_holder`, so a
 *   second claim of the same run by the same process — its sweep re-claiming a run whose first
 *   driver stalled — is a different holder, not the same one twice;
 * - every later write (**renew**, **writeState**, **release**) is conditional on `lease_holder` still
 *   being that token AND `lease_until` still in the future. A driver that stalled past its lease
 *   finds its write refused (another claim may hold the run by then) and must drop the run.
 *
 * Time is always the database's `now()`, never this process's clock, so workers on machines whose
 * clocks disagree still agree on whether a lease has expired.
 */

export const LEASE_MS = 60_000;

/** Statuses no worker drives again. */
const ENDED: readonly RunStatus[] = ['stopped', 'failed', 'handed_off'];
/** Statuses a worker keeps driving with no new event: there is work in flight. */
const ACTIVE: readonly RunStatus[] = ['running', 'stopping'];
/** Event kinds that need the worker to act: the owner's rows and finished GPU jobs. */
export const WAKING_KINDS = [
	'owner_message',
	'owner_request',
	'checkpoint_resolved',
	'job_done',
] as const;

export interface ClaimedRun {
	id: string;
	/** This claim's token: what every guarded write for this run must present. */
	lease: string;
	state: RunState;
}

interface RunRow {
	id: string;
	status: RunStatus;
	step: RunStep;
	waiting_on: Checkpoint | null;
	checkpoints_json: unknown;
	lease_holder: string;
}

const toClaimed = (row: RunRow): ClaimedRun => ({
	id: row.id,
	lease: row.lease_holder,
	state: {
		status: row.status,
		step: row.step,
		waitingOn: row.waiting_on,
		checkpoints: checkpointSettings(row.checkpoints_json),
	},
});

/** A constant list as one text parameter, split server-side: `= any(string_to_array(…))`. */
const list = (values: readonly string[]) => values.join(',');

/** A run `c` that needs driving and that no live lease holds. */
const claimable = (sql: Sql) => sql`
	c.status <> all(string_to_array(${list(ENDED)}, ','))
	and (c.lease_until is null or c.lease_until < now())
	and (
		c.status = any(string_to_array(${list(ACTIVE)}, ','))
		or exists (
			select 1 from director_events e
			where e.run_id = c.id
				and e.handled_at is null
				and e.kind = any(string_to_array(${list(WAKING_KINDS)}, ','))
		)
	)`;

/**
 * Claim one run that needs driving — active, or with an unhandled waking event — and whose lease is
 * free or expired. `runId` narrows it to that run (a `director_wake` NOTIFY names one). Null when
 * there is nothing to claim, or every candidate is locked by a worker claiming it right now.
 */
export async function claimRun(
	sql: Sql,
	workerId: string,
	{ runId = null, leaseMs = LEASE_MS }: { runId?: string | null; leaseMs?: number } = {},
): Promise<ClaimedRun | null> {
	const rows = await sql<RunRow[]>`
		update director_runs r
		set lease_holder = ${`${workerId}#${randomUUID()}`},
			lease_until = now() + ${leaseMs} * interval '1 millisecond'
		where r.id = (
			select c.id from director_runs c
			where ${claimable(sql)}
				and (${runId}::text is null or c.id = ${runId})
			order by c.lease_until nulls first, c.updated_at
			limit 1
			for update skip locked
		)
		returning r.id, r.status, r.step, r.waiting_on, r.checkpoints_json, r.lease_holder`;
	return rows[0] ? toClaimed(rows[0]) : null;
}

/** Extend a lease this claim still holds. False = it was lost: stop driving the run. */
export async function renewLease(
	sql: Sql,
	run: Pick<ClaimedRun, 'id' | 'lease'>,
	leaseMs = LEASE_MS,
): Promise<boolean> {
	const rows = await sql`
		update director_runs
		set lease_until = now() + ${leaseMs} * interval '1 millisecond'
		where id = ${run.id} and lease_holder = ${run.lease} and lease_until > now()
		returning id`;
	return rows.length === 1;
}

/** Give a run back. A no-op when the lease was already lost. */
export async function releaseLease(
	sql: Sql,
	run: Pick<ClaimedRun, 'id' | 'lease'>,
): Promise<boolean> {
	const rows = await sql`
		update director_runs
		set lease_holder = null, lease_until = null
		where id = ${run.id} and lease_holder = ${run.lease}
		returning id`;
	return rows.length === 1;
}

/** An event a transition appends alongside its `run_status` row, in the same transaction. */
export interface WriteEvent {
	agent: string;
	kind: string;
	tool: string | null;
	payload: unknown;
}

/**
 * Persist a transition `transition()` returned, with its `run_status` event and any `events` that
 * belong to it (a checkpoint opening with its content), as one transaction — only if this claim
 * still holds a live lease AND the run is still in `from` (so a stale view of the run can never
 * overwrite a newer one). False = nothing was written; drop the run.
 */
export async function writeState(
	sql: Sql,
	run: Pick<ClaimedRun, 'id' | 'lease'>,
	from: RunState,
	to: RunState,
	cause: string,
	events: WriteEvent[] = [],
): Promise<boolean> {
	return sql.begin(async (tx) => {
		const rows = await tx`
			update director_runs
			set status = ${to.status}, step = ${to.step}, waiting_on = ${to.waitingOn}, updated_at = now()
			where id = ${run.id}
				and lease_holder = ${run.lease} and lease_until > now()
				and status = ${from.status} and step = ${from.step}
				and waiting_on is not distinct from ${from.waitingOn}
			returning id`;
		if (rows.length !== 1) return false;
		await tx`
			insert into director_events (run_id, agent, kind, payload_json)
			values (${run.id}, 'worker', 'run_status', ${tx.json({
				from: { status: from.status, step: from.step, waitingOn: from.waitingOn },
				to: { status: to.status, step: to.step, waitingOn: to.waitingOn },
				cause,
			})})`;
		for (const event of events) {
			await tx`
				insert into director_events (run_id, agent, kind, tool, payload_json)
				values (${run.id}, ${event.agent}, ${event.kind}, ${event.tool}, ${tx.json(
					event.payload as JSONValue,
				)})`;
		}
		return true;
	});
}

/** Runs the sweep would claim now — for the skeleton's log line. */
export async function countClaimable(sql: Sql): Promise<number> {
	const [row] = await sql<{ n: number }[]>`
		select count(*)::int as n from director_runs c
		where ${claimable(sql)}`;
	return row.n;
}
