import type { Sql } from 'postgres';
import { writeState, type ClaimedRun, type WriteEvent } from '../lease.ts';
import { transition, type RunState } from '../runState.ts';
import type { Breakdown } from './analyze.ts';

/**
 * The breakdown as the `breakdown` checkpoint (ADR-0003, ADR-0005). The analysis is the breakdown
 * step's work, so submitting it is `step_done`: with the checkpoint on (the default) the run goes to
 * `waiting` on `breakdown` and a `checkpoint_open` event carries the result for the page; with it
 * off, the run moves on and the result is posted as activity. Either way nothing is queued on RunPod
 * here — the first render is the atlas artist's, after the owner confirms.
 */

export type SubmitResult = { ok: true; state: RunState } | { ok: false; error: string };

/** The events the submission appends, besides the `run_status` row `writeState` writes itself. */
export function breakdownEvents(to: RunState, breakdown: Breakdown): WriteEvent[] {
	const summary = {
		images: breakdown.images.length,
		regionsMatched: breakdown.regionsMatched,
		regionsTotal: breakdown.regionsTotal,
		needsYou: breakdown.images.flatMap((i) => i.elements).filter((e) => e.status === 'needs_you')
			.length,
		leftOut: breakdown.images.flatMap((i) => i.elements).filter((e) => e.status === 'left_out')
			.length,
		usage: breakdown.usage,
	};
	const events: WriteEvent[] = [
		{
			agent: 'mockup-analyst',
			kind: 'activity',
			tool: 'run.submit_breakdown',
			payload: { message: 'Mockup breakdown ready', ...summary },
		},
	];
	if (to.status === 'waiting' && to.waitingOn === 'breakdown') {
		events.push({
			agent: 'mockup-analyst',
			kind: 'checkpoint_open',
			tool: null,
			payload: { checkpoint: 'breakdown', breakdown },
		});
	}
	return events;
}

export async function submitBreakdown(
	sql: Sql,
	run: ClaimedRun,
	breakdown: Breakdown,
): Promise<SubmitResult> {
	if (run.state.step !== 'breakdown') {
		return { ok: false, error: `the run is in step ${run.state.step}, not breakdown` };
	}
	const next = transition(run.state, { type: 'step_done' });
	if (!next.ok) return next;
	const written = await writeState(
		sql,
		run,
		run.state,
		next.state,
		'breakdown submitted',
		breakdownEvents(next.state, breakdown),
	);
	if (!written) return { ok: false, error: 'the lease was lost or the run moved on' };
	return { ok: true, state: next.state };
}
