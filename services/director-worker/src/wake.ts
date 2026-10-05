import type { Sql } from 'postgres';
import { claimRun } from './lease.ts';
import { log } from './log.ts';

/**
 * How a run gets the worker's attention (ADR-0003 "Wake-up"): an AFTER INSERT trigger on
 * `director_events` NOTIFYs `director_wake` with the run id for every owner row and `job_done`
 * (migration 0025), and a 60 s sweep catches anything a NOTIFY missed — one sent while this worker
 * was down or reconnecting. Either way the worker claims the run and drives it; an idle run holds
 * nothing open in between.
 */

export const WAKE_CHANNEL = 'director_wake';
export const SWEEP_MS = 60_000;
/** Runs one worker drives at once. */
export const CONCURRENCY = 4;

export interface Wake {
	/** Stop claiming. Drives in flight carry on; `drain` waits for them. */
	stop(): Promise<void>;
	/** Resolves when no drive is in flight, or after `timeoutMs`, whichever comes first. */
	drain(timeoutMs: number): Promise<void>;
	/** Whether the last sweep succeeded — a claim against the run tables, so a database that
	 *  answers but whose schema is behind is unhealthy too. */
	healthy(): boolean;
}

export type Drive = (claimed: NonNullable<Awaited<ReturnType<typeof claimRun>>>) => Promise<void>;

export async function startWake(
	sql: Sql,
	workerId: string,
	drive: Drive,
	sweepMs = SWEEP_MS,
): Promise<Wake> {
	let healthy = false;
	let active = 0;
	let stopping = false;
	let drained: (() => void) | null = null;

	/** Claim and drive runs until nothing (for `runId`, that run) is claimable or slots run out. */
	const pump = async (runId: string | null) => {
		while (!stopping && active < CONCURRENCY) {
			const claimed = await claimRun(sql, workerId, { runId });
			if (!claimed) return;
			active++;
			void drive(claimed)
				.catch((error) => log.error('drive failed', { runId: claimed.id, error }))
				.finally(() => {
					active--;
					if (active === 0) drained?.();
					void kick(null);
				});
			if (runId) return;
		}
	};
	const kick = async (runId: string | null) => {
		try {
			await pump(runId);
			healthy = true;
		} catch (error) {
			healthy = false;
			log.error('claim failed', { runId, error });
		}
	};

	const listener = await sql.listen(
		WAKE_CHANNEL,
		(payload) => void kick(payload || null),
		() => log.info('listening', { channel: WAKE_CHANNEL }),
	);
	await kick(null);
	const timer = setInterval(() => void kick(null), sweepMs);

	return {
		async stop() {
			stopping = true;
			clearInterval(timer);
			await listener.unlisten();
		},
		drain(timeoutMs) {
			if (active === 0) return Promise.resolve();
			return new Promise<void>((resolve) => {
				const deadline = setTimeout(resolve, timeoutMs);
				drained = () => {
					clearTimeout(deadline);
					resolve();
				};
			});
		},
		healthy: () => healthy,
	};
}
