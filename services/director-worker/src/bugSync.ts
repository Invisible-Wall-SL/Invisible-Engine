import type { Db } from './store.ts';
import type { RepairOutcome } from './runState.ts';

/**
 * A repair run moves its game bug's status (ADR-0012 §4), in the transaction that moves the run, so
 * the two cannot disagree after a crash. The bug tables are the launcher's; these are the same rows
 * `bugReportsStore.ts` writes, with the same names and event shapes (`status`, `repair`).
 *
 *  - start: Open → Working on, by "Director run <id>"; the status it found rides on a `repair` event;
 *  - fixed: stays Working on; a `repair` event says so (the launcher labels it "Fixed, waiting on
 *    publish" and the next Game Maker publish resolves it);
 *  - escalated: the launcher's escalation already moved it; a `repair` event records the end;
 *  - needs_person, not_reproduced, stopped: back to the status it found, unless a person changed it.
 *
 * Each is idempotent per run: a started or ended run is recorded once.
 */

export const runActor = (runId: string): string => `Director run ${runId}`;

interface BugRow {
	status: string;
	status_by: string | null;
}

async function lock(tx: Db, bug: number): Promise<BugRow | null> {
	const [row] = await tx<BugRow[]>`
		select status, status_by from bug_reports where number = ${bug} and kind = 'game' for update`;
	return row ?? null;
}

const repairEvent = (tx: Db, bug: number, runId: string, data: Record<string, unknown>) =>
	tx`insert into bug_report_events (bug_number, kind, actor_id, actor, data)
		values (${bug}, 'repair', null, ${runActor(runId)}, ${tx.json({ runId, ...data } as never)})`;

const phasedAs = async (tx: Db, bug: number, runId: string, phases: string[]) =>
	(
		await tx`select 1 from bug_report_events where bug_number = ${bug} and kind = 'repair'
			and data->>'runId' = ${runId}
			and data->>'phase' = any(string_to_array(${phases.join(',')}, ','))`
	).length > 0;

export async function repairStarted(tx: Db, runId: string, bug: number | null): Promise<void> {
	if (bug === null) return;
	const row = await lock(tx, bug);
	if (!row || (await phasedAs(tx, bug, runId, ['started']))) return;
	await repairEvent(tx, bug, runId, { phase: 'started', priorStatus: row.status });
	if (row.status !== 'open') return;
	await tx`update bug_reports set status = 'working', status_by = ${runActor(runId)},
			status_at = now(), status_auto = false, updated_at = now() where number = ${bug}`;
	await tx`insert into bug_report_events (bug_number, kind, actor_id, actor, data)
		values (${bug}, 'status', null, ${runActor(runId)},
			${tx.json({ to: 'working', because: 'repair' } as never)})`;
}

export type RepairEnd = RepairOutcome | 'stopped';

export async function repairEnded(
	tx: Db,
	runId: string,
	bug: number | null,
	end: RepairEnd,
	summary = '',
): Promise<void> {
	if (bug === null) return;
	const row = await lock(tx, bug);
	if (!row || (await phasedAs(tx, bug, runId, ['ended', 'fixed']))) return;
	const [started] = await tx<{ prior: string }[]>`
		select data->>'priorStatus' as prior from bug_report_events
		where bug_number = ${bug} and kind = 'repair' and data->>'runId' = ${runId}
			and data->>'phase' = 'started'`;
	if (!started) return;
	const fixed = end === 'fixed';
	await repairEvent(tx, bug, runId, {
		phase: fixed ? 'fixed' : 'ended',
		outcome: end,
		summary: summary.slice(0, 2000),
	});
	// A run that ends without a fix hands the bug back as it found it, unless a person has since
	// set the status themselves (then it is not the run's to touch).
	const restore =
		!fixed &&
		end !== 'escalated' &&
		started.prior === 'open' &&
		row.status === 'working' &&
		row.status_by === runActor(runId);
	if (!restore) return;
	await tx`update bug_reports set status = 'open', status_by = ${runActor(runId)},
			status_at = now(), updated_at = now() where number = ${bug}`;
	await tx`insert into bug_report_events (bug_number, kind, actor_id, actor, data)
		values (${bug}, 'status', null, ${runActor(runId)},
			${tx.json({ to: 'open', because: 'repair ended' } as never)})`;
}
