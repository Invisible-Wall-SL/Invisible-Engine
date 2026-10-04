import type { Sql } from 'postgres';
import type { Checkpoint, RunState, RunStatus, RunStep } from './runState.ts';
import { checkpointSettings } from './runState.ts';

/**
 * Run leases (ADR-0001, ADR-0003). A worker drives a run only while it holds that run's lease:
 *
 * - **claim** picks one claimable run with `FOR UPDATE SKIP LOCKED`, so two workers racing for the
 *   same row never both get it — the loser skips it and takes the next one, or nothing;
 * - every later write (**renew**, **writeState**, **release**) is conditional on `lease_holder` still
 *   being this worker AND `lease_until` still in the future. A worker that stalled past its lease
 *   finds its write refused (another worker may have claimed the run by then) and must drop the run.
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
	state: RunState;
	handledEventId: number;
}

interface RunRow {
	id: string;
	status: RunStatus;
	step: RunStep;
	waiting_on: Checkpoint | null;
	checkpoints_json: unknown;
	handled_event_id: string | number;
}

const toClaimed = (row: RunRow): ClaimedRun => ({
	id: row.id,
	state: {
		status: row.status,
		step: row.step,
		waitingOn: row.waiting_on,
		checkpoints: checkpointSettings(row.checkpoints_json),
	},
	handledEventId: Number(row.handled_event_id),
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
				and e.id > c.handled_event_id
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
	holder: string,
	{ runId = null, leaseMs = LEASE_MS }: { runId?: string | null; leaseMs?: number } = {},
): Promise<ClaimedRun | null> {
	const rows = await sql<RunRow[]>`
		update director_runs r
		set lease_holder = ${holder},
			lease_until = now() + ${leaseMs} * interval '1 millisecond'
		where r.id = (
			select c.id from director_runs c
			where ${claimable(sql)}
				and (${runId}::text is null or c.id = ${runId})
			order by c.lease_until nulls first, c.updated_at
			limit 1
			for update skip locked
		)
		returning r.id, r.status, r.step, r.waiting_on, r.checkpoints_json, r.handled_event_id`;
	return rows[0] ? toClaimed(rows[0]) : null;
}

/** Extend a lease this worker still holds. False = it was lost: stop driving the run. */
export async function renewLease(
	sql: Sql,
	runId: string,
	holder: string,
	leaseMs = LEASE_MS,
): Promise<boolean> {
	const rows = await sql`
		update director_runs
		set lease_until = now() + ${leaseMs} * interval '1 millisecond'
		where id = ${runId} and lease_holder = ${holder} and lease_until > now()
		returning id`;
	return rows.length === 1;
}

/** Give a run back. A no-op when the lease was already lost. */
export async function releaseLease(sql: Sql, runId: string, holder: string): Promise<boolean> {
	const rows = await sql`
		update director_runs
		set lease_holder = null, lease_until = null
		where id = ${runId} and lease_holder = ${holder}
		returning id`;
	return rows.length === 1;
}

/**
 * Persist a transition `transition()` returned, with its `run_status` event, as one transaction —
 * only if this worker still holds a live lease AND the run is still in `from` (so a stale view of the
 * run can never overwrite a newer one). False = nothing was written; drop the run.
 */
export async function writeState(
	sql: Sql,
	runId: string,
	holder: string,
	from: RunState,
	to: RunState,
	cause: string,
): Promise<boolean> {
	return sql.begin(async (tx) => {
		const rows = await tx`
			update director_runs
			set status = ${to.status}, step = ${to.step}, waiting_on = ${to.waitingOn}, updated_at = now()
			where id = ${runId}
				and lease_holder = ${holder} and lease_until > now()
				and status = ${from.status} and step = ${from.step}
				and waiting_on is not distinct from ${from.waitingOn}
			returning id`;
		if (rows.length !== 1) return false;
		await tx`
			insert into director_events (run_id, agent, kind, payload_json)
			values (${runId}, 'worker', 'run_status', ${tx.json({
				from: { status: from.status, step: from.step, waitingOn: from.waitingOn },
				to: { status: to.status, step: to.step, waitingOn: to.waitingOn },
				cause,
			})})`;
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
