import { randomBytes } from 'node:crypto';
import type { Sql } from 'postgres';
import { TERMINAL_STATUSES, type RunStatus } from './runState.ts';

/**
 * The idle-deploy rule (ADR-0008 §1 "In-flight runs", owner decision 8): a worker build that
 * changes the agents' tools deploys only when no Director run could wake under the old plan. A run
 * that is `running` (an agent may be mid-turn) or `stopping` blocks the deploy; the check can pause
 * the running ones first, through the same owner `pause` request the Live run's button sends, with
 * an Activity note telling the owner why. A run waiting on the owner or already paused makes no
 * model call until the owner acts, so it is held and told, not blocking.
 *
 * A build that changes what a held run would resume under (card 8C: the brief and the fallback
 * recipe stop reading the run's preset) needs the strict form, `quiet`: no started run unended,
 * and no draft still holding a preset the old New game screen stored (`presetDrafts`), which a
 * start after the deploy would silently drop.
 */

export interface LiveRunRow {
	id: string;
	status: RunStatus;
	step: string;
	waiting_on: string | null;
}

export interface IdleVerdict {
	/** True when nothing is running or stopping: the deploy may go. */
	idle: boolean;
	running: string[];
	stopping: string[];
	/** Waiting on the owner or paused: no turn until a person acts. */
	held: string[];
	/** Drafts that still hold a stored preset (card 8C). */
	presetDrafts: string[];
	/** True when no started run is unended and no draft holds a preset: the strict deploy may go. */
	quiet: boolean;
}

export function idleVerdict(
	rows: readonly LiveRunRow[],
	presetDrafts: readonly string[] = [],
): IdleVerdict {
	const of = (status: RunStatus) => rows.filter((r) => r.status === status).map((r) => r.id);
	const running = of('running');
	const stopping = of('stopping');
	return {
		idle: running.length === 0 && stopping.length === 0,
		running,
		stopping,
		held: rows.filter((r) => r.status === 'waiting' || r.status === 'paused').map((r) => r.id),
		presetDrafts: [...presetDrafts],
		quiet: rows.length === 0 && presetDrafts.length === 0,
	};
}

/** Every started run that has not ended (drafts never ran an agent and are not listed). */
export async function liveRuns(sql: Sql): Promise<LiveRunRow[]> {
	return sql<LiveRunRow[]>`
		select id, status, step, waiting_on from director_runs
		where status <> 'draft' and status not in ${sql([...TERMINAL_STATUSES])}
		order by id`;
}

/** Drafts whose `preset_json` is not the column's `{}` default: made by the pre-8C screen. */
export async function presetDrafts(sql: Sql): Promise<string[]> {
	const rows = await sql<{ id: string }[]>`
		select id from director_runs
		where status = 'draft' and preset_json <> '{}'::jsonb
		order by id`;
	return rows.map((r) => r.id);
}

/**
 * Ask the worker to pause each running run before a deploy, and tell the owner of every live run
 * why. Returns the runs asked to pause.
 */
export async function pauseForDeploy(sql: Sql, reason: string): Promise<string[]> {
	const verdict = idleVerdict(await liveRuns(sql));
	await sql.begin(async (tx) => {
		for (const id of [...verdict.running, ...verdict.held]) {
			await tx`insert into director_events (run_id, agent, kind, payload_json)
				values (${id}, 'worker', 'activity', ${tx.json({ type: 'note', text: reason })})`;
		}
		for (const id of verdict.running) {
			await tx`insert into director_events (run_id, agent, kind, payload_json)
				values (${id}, 'owner', 'owner_request', ${tx.json({
					action: 'pause',
					requestId: `deploy-${randomBytes(8).toString('hex')}`,
					by: { uid: 'deploy', name: 'Deploy check' },
				})})`;
		}
	});
	return verdict.running;
}
