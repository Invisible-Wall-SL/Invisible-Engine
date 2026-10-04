import type { Sql } from 'postgres';
import { countClaimable } from './lease.ts';
import { log } from './log.ts';

/**
 * How a run gets the worker's attention (ADR-0003 "Wake-up"): the launcher NOTIFYs `director_wake`
 * (payload: the run id) after inserting an owner event, and the atlas-tool callback does the same for
 * `job_done`. A 60 s sweep catches anything a NOTIFY missed — one sent while this worker was down or
 * reconnecting. An idle run holds nothing open in between.
 *
 * Skeleton (PLAN 3.3): both paths only log. The turn loop (3.4) and owner actions (3.5) act on them.
 */

export const WAKE_CHANNEL = 'director_wake';
export const SWEEP_MS = 60_000;

export interface Wake {
	stop(): Promise<void>;
	/** Whether the last database round-trip (LISTEN or sweep) succeeded. */
	healthy(): boolean;
}

export async function startWake(sql: Sql, sweepMs = SWEEP_MS): Promise<Wake> {
	let healthy = false;

	const listener = await sql.listen(
		WAKE_CHANNEL,
		(payload) => log.info('wake', { channel: WAKE_CHANNEL, runId: payload || null }),
		() => {
			healthy = true;
			log.info('listening', { channel: WAKE_CHANNEL });
		},
	);

	const sweep = async () => {
		try {
			const claimable = await countClaimable(sql);
			healthy = true;
			log.info('sweep', { claimable });
		} catch (error) {
			healthy = false;
			log.error('sweep failed', { error });
		}
	};
	await sweep();
	const timer = setInterval(sweep, sweepMs);

	return {
		async stop() {
			clearInterval(timer);
			await listener.unlisten();
		},
		healthy: () => healthy,
	};
}
