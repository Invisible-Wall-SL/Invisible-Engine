import type { Sql } from 'postgres';
import type { ClaimedRun } from '../lease.ts';
import { transition, type RunState } from '../runState.ts';
import {
	appendMessage,
	applyTransition,
	insertEvent,
	withLease,
	type EventKind,
} from '../store.ts';
import type { Breakdown } from './analyze.ts';

/**
 * The breakdown as the `breakdown` checkpoint (ADR-0003, ADR-0005). The analysis is the breakdown
 * step's work, so submitting it is `step_done`: with the checkpoint on (the default) the run goes to
 * `waiting` on `breakdown` and a `checkpoint_open` event carries the result for the page; with it
 * off, the run moves on and the result is posted as activity. Either way the coordinator is told
 * what the breakdown found, as a message it reads on its next turn. The transition, its events and
 * that message commit in one lease-checked transaction (`withLease`), so a driver that lost the run
 * writes nothing — and `LeaseLost` is the driver's to handle, as for every other write. Nothing is
 * queued on RunPod here — the first render is the atlas artist's, after the owner confirms.
 */

export type SubmitResult = { ok: true; state: RunState } | { ok: false; error: string };

export interface BreakdownEvent {
	agent: string;
	kind: EventKind;
	tool: string | null;
	payload: Record<string, unknown>;
}

const ANALYST = 'mockup-analyst';

function summarize(breakdown: Breakdown) {
	const elements = breakdown.images.flatMap((i) => i.elements);
	return {
		images: breakdown.images.length,
		regionsMatched: breakdown.regionsMatched,
		regionsTotal: breakdown.regionsTotal,
		needsYou: elements.filter((e) => e.status === 'needs_you').length,
		leftOut: elements.filter((e) => e.status === 'left_out').length,
		usage: breakdown.usage,
	};
}

/** The events the submission appends, besides the `run_status` row `applyTransition` writes. */
export function breakdownEvents(
	to: RunState,
	breakdown: Breakdown,
	attempt: number,
): BreakdownEvent[] {
	const events: BreakdownEvent[] = [
		{
			agent: ANALYST,
			kind: 'activity',
			tool: null,
			payload: { message: 'Mockup breakdown ready', attempt, ...summarize(breakdown) },
		},
	];
	if (to.status === 'waiting' && to.waitingOn === 'breakdown') {
		events.push({
			agent: ANALYST,
			kind: 'checkpoint_open',
			tool: null,
			payload: { checkpoint: 'breakdown', attempt, breakdown },
		});
	}
	return events;
}

/**
 * What the coordinator is told: the figures it plans from, and whether the owner is reviewing the
 * breakdown or the run has already moved on. The elements' statuses are the rules' — the
 * coordinator cannot change them, only plan around them.
 */
export function breakdownReport(to: RunState, breakdown: Breakdown, attempt: number): string {
	const s = summarize(breakdown);
	const elements = breakdown.images.flatMap((i) => i.elements);
	const lines = [
		`The worker produced the mockup breakdown${attempt > 1 ? ` (attempt ${attempt}, after the owner's notes)` : ''}: ${s.regionsMatched} of ${s.regionsTotal} template regions matched across ${s.images} mockup(s); ${s.needsYou} element(s) need the owner; ${s.leftOut} left out as clashes with locked items.`,
	];
	const leftOut = elements.filter((e) => e.status === 'left_out');
	if (leftOut.length) {
		lines.push(
			`Left out (locked, never to be worked around): ${leftOut.map((e) => `${e.name} → ${e.lockedItem?.label ?? 'locked item'}`).join('; ')}.`,
		);
	}
	const needsYou = elements.filter((e) => e.status === 'needs_you');
	if (needsYou.length) {
		lines.push(`Need the owner: ${needsYou.map((e) => e.name).join('; ')}.`);
	}
	if (breakdown.uncoveredRegions.length) {
		lines.push(
			`Regions no mockup covers (designed from the notes and the palette): ${breakdown.uncoveredRegions.join(', ')}.`,
		);
	}
	if (breakdown.palette.length) {
		lines.push(`Palette: ${breakdown.palette.map((p) => `${p.name} ${p.hex}`).join(', ')}.`);
	}
	if (breakdown.fontGaps.length) {
		lines.push(`Font gaps: ${breakdown.fontGaps.map((g) => `"${g.text}"`).join(', ')}.`);
	}
	lines.push(
		to.status === 'waiting' && to.waitingOn === 'breakdown'
			? 'The owner is reviewing it at the breakdown checkpoint; you will be told their decision. Do not plan renders until then.'
			: `The breakdown checkpoint is off for this run, so the run is now in the ${to.step} step.`,
	);
	return lines.join('\n');
}

export async function submitBreakdown(
	sql: Sql,
	run: Pick<ClaimedRun, 'id' | 'lease'>,
	breakdown: Breakdown,
	attempt: number,
): Promise<SubmitResult> {
	return withLease(sql, run, async (tx, live) => {
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
		for (const event of breakdownEvents(next.state, breakdown, attempt)) {
			await insertEvent(tx, live.id, event.agent, event.kind, event.payload, event.tool);
		}
		await appendMessage(tx, live.id, 'coordinator', 'user', [
			{ type: 'text', text: breakdownReport(next.state, breakdown, attempt) },
		]);
		return { ok: true, state: next.state };
	});
}
