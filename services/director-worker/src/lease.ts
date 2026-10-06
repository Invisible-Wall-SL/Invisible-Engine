import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
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
 * - every later write is conditional on `lease_holder` still being that token AND `lease_until`
 *   still in the future: **renew** here, and every state write through `withLease` (`store.ts`),
 *   which checks both in the transaction that writes. A driver that stalled past its lease finds its
 *   write refused (another claim may hold the run by then) and must drop the run;
 * - a claim ends with **release**, or with **defer** after a failed drive, which keeps the token and
 *   pushes `lease_until` out, so nobody claims the run before the retry delay has passed.
 *
 * Time is always the database's `now()`, never this process's clock, so workers on machines whose
 * clocks disagree still agree on whether a lease has expired.
 */

export const LEASE_MS = 60_000;

/** Statuses no worker drives again. */
const ENDED: readonly RunStatus[] = ['stopped', 'failed', 'handed_off'];
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

/**
 * A run `c` that has work and that no live lease holds. Work is an unhandled waking event, or — in a
 * `running` run — an agent whose last message wants a model call (the user's) or tool results (an
 * assistant turn with calls). A run with neither — waiting on the owner or on a GPU job, paused,
 * stopping until its jobs finish — is never claimed, so it costs nothing between wakes. An ended
 * run is claimed only to settle a `job_done` that landed as it ended, so the job is still billed.
 */
const claimable = (sql: Sql) => sql`
	(c.lease_until is null or c.lease_until < now())
	and (
		exists (
			select 1 from director_events e
			where e.run_id = c.id
				and e.handled_at is null
				and (
					(c.status <> all(string_to_array(${list(ENDED)}, ','))
						and e.kind = any(string_to_array(${list(WAKING_KINDS)}, ',')))
					or e.kind = 'job_done'
				)
		)
		or (
			c.status = 'running'
			and exists (
				select 1 from director_messages m
				where m.run_id = c.id
					and m.seq = (
						select max(l.seq) from director_messages l
						where l.run_id = c.id and l.agent = m.agent
					)
					and (m.role = 'user' or m.content_json @> '[{"type":"tool_use"}]'::jsonb)
			)
		)
	)`;

/**
 * Claim one run that has work (see `claimable`) and whose lease is free or expired. `runId` narrows
 * it to that run (a `director_wake` NOTIFY names one). Null when there is nothing to claim, or every
 * candidate is locked by a worker claiming it right now.
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

/**
 * End a claim whose drive failed without giving the run back yet: the token stays, and the lease
 * now runs out after `ms`, so no claim, this process's included, takes the run before then. The
 * delay lives in the run row, so every worker honours it.
 */
export async function deferLease(
	sql: Sql,
	run: Pick<ClaimedRun, 'id' | 'lease'>,
	ms: number,
): Promise<boolean> {
	const rows = await sql`
		update director_runs
		set lease_until = now() + ${ms} * interval '1 millisecond'
		where id = ${run.id} and lease_holder = ${run.lease}
		returning id`;
	return rows.length === 1;
}
