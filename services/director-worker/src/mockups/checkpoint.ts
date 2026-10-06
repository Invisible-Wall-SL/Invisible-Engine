import type { Sql } from 'postgres';
import type { ClaimedRun } from '../lease.ts';
import { transition, type RunState } from '../runState.ts';
import { applyTransition, insertEvent, LeaseLost, withLease, type EventKind } from '../store.ts';
import type { Breakdown } from './analyze.ts';

/**
 * The breakdown as the `breakdown` checkpoint (ADR-0003, ADR-0005). The analysis is the breakdown
 * step's work, so submitting it is `step_done`: with the checkpoint on (the default) the run goes to
 * `waiting` on `breakdown` and a `checkpoint_open` event carries the result for the page; with it
 * off, the run moves on and the result is posted as activity. The transition and its events commit
 * in one lease-checked transaction (`withLease`), so a driver that lost the run writes nothing.
 * Either way nothing is queued on RunPod here — the first render is the atlas artist's, after the
 * owner confirms.
 */

export type SubmitResult = { ok: true; state: RunState } | { ok: false; error: string };

export interface BreakdownEvent {
	agent: string;
	kind: EventKind;
	tool: string | null;
	payload: Record<string, unknown>;
}

/** The events the submission appends, besides the `run_status` row `applyTransition` writes. */
export function breakdownEvents(to: RunState, breakdown: Breakdown): BreakdownEvent[] {
	const elements = breakdown.images.flatMap((i) => i.elements);
	const summary = {
		images: breakdown.images.length,
		regionsMatched: breakdown.regionsMatched,
		regionsTotal: breakdown.regionsTotal,
		needsYou: elements.filter((e) => e.status === 'needs_you').length,
		leftOut: elements.filter((e) => e.status === 'left_out').length,
		usage: breakdown.usage,
	};
	const events: BreakdownEvent[] = [
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
	try {
		return await withLease(sql, run, async (tx, live) => {
			if (live.state.step !== 'breakdown') {
				return { ok: false, error: `the run is in step ${live.state.step}, not breakdown` };
			}
			const next = transition(live.state, { type: 'step_done' });
			if (!next.ok) return next;
			const written = await applyTransition(
				tx,
				live.id,
				live.state,
				next.state,
				'breakdown submitted',
			);
			if (!written) return { ok: false, error: 'the run moved on' };
			for (const event of breakdownEvents(next.state, breakdown)) {
				await insertEvent(tx, live.id, event.agent, event.kind, event.payload, event.tool);
			}
			return { ok: true, state: next.state };
		});
	} catch (e) {
		if (e instanceof LeaseLost) return { ok: false, error: 'the lease was lost' };
		throw e;
	}
}
