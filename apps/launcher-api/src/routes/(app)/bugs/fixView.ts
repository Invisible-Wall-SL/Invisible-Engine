import { MAX_DESCRIPTION, MAX_TITLE, bugAreaName, bugRef } from '$lib/bugReports';
import { capText, type FixFacts, type FixRunOutcome, type FixRunView } from '$lib/bugFixRuns';
import type { PillTone } from '../pipeline/view';

/**
 * What the pages decide about fix runs on pipeline bugs (ADR-0013 card 13C): which Start button a
 * caller sees on the Bugs tab and the bug page, how a run reads on its line, and the address that
 * opens the report form for a proposed second bug. Pure, so `check:bug-fix-runs` pins every state
 * as it stands. No Svelte, no browser globals.
 */

export const SEND_AND_START = 'Send and start fix';
export const START_FIX = 'Start fix';

export type FixControl =
	/** Nothing to press: no capability pair, fix runs cannot run yet, or a run is going. */
	| { kind: 'hidden' }
	/** The button. `sends` is true on an unsent bug: the click sends it, then starts the run. */
	| { kind: 'start'; label: string; sends: boolean }
	/** The button greyed, with the refusal the server would give, in words. */
	| { kind: 'blocked'; label: string; sends: boolean; why: string };

/**
 * The control for one pipeline bug. Hidden unless the viewer holds both `pipelineBugFix` and
 * pipeline triage (the server checks the same pair), and unless fix runs can run at all: the
 * workflow is on GitHub and the App is configured, so a button that can only fail is never shown.
 * A live run shows its run line (with Stop) instead of a button; any other start refusal greys the
 * button and says why.
 */
export function fixControl(facts: FixFacts, sent: boolean): FixControl {
	if (!facts.may || !facts.ready) return { kind: 'hidden' };
	if (facts.refusal?.code === 'fix_run_live') return { kind: 'hidden' };
	const label = sent ? START_FIX : SEND_AND_START;
	if (facts.refusal) return { kind: 'blocked', label, sends: !sent, why: facts.refusal.message };
	return { kind: 'start', label, sends: !sent };
}

export interface FixRunLine {
	tone: PillTone;
	/** The pill: where the run stands in one or two words. */
	label: string;
	/** The sentence, naming the run. */
	text: string;
	/** What the run reported in its own words, shown as plain text. */
	note: string | null;
	/** "$1.23", or "spend unknown" for an ended run that reported none; null while it goes. */
	spend: string | null;
	live: boolean;
}

const OUTCOME_WORDS: Partial<Record<FixRunOutcome, string>> = {
	not_reproduced: 'it did not reproduce',
	needs_person: 'it needs a person',
	second_area: 'the cause is in another area',
};

const usd = (n: number): string => `$${n.toFixed(2)}`;

/** One run as its line reads. Every word of the run's own (`summary`) goes in `note`, as text. */
export function fixRunLine(run: FixRunView): FixRunLine {
	const name = `Fix run ${run.id}`;
	const live = run.status === 'dispatched' || run.status === 'running';
	const spend = live ? null : run.spendUsd === null ? 'spend unknown' : usd(run.spendUsd);
	const note = run.summary;
	const pr = run.prNumber === null ? 'a draft pull request' : `draft pull request #${run.prNumber}`;
	const line = (tone: PillTone, label: string, text: string): FixRunLine => ({
		tone,
		label,
		text,
		note,
		spend,
		live,
	});
	switch (run.status) {
		case 'dispatched':
			return line('blue', 'Queued', `${name} is queued: the job has not started yet.`);
		case 'running':
			return line('blue', 'Working', `${name} is working on it.`);
		case 'pr_opened':
			return line(
				'green',
				'Fix proposed',
				run.outcome === 'second_area'
					? `${name} opened ${pr} for one area and found the cause also lies in another.`
					: `${name} opened ${pr}.`,
			);
		case 'no_fix': {
			const why = run.reason ?? ((run.outcome && OUTCOME_WORDS[run.outcome]) || 'no fix');
			return line('amber', 'No fix', `${name} found no fix: ${why.replace(/\.$/, '')}.`);
		}
		case 'failed':
			return line(
				'red',
				'Failed',
				run.reason ? `${name} failed: ${run.reason}` : `${name} failed.`,
			);
		case 'cancelled':
			return line(
				'muted',
				'Stopped',
				run.reason ? `${name} was stopped. ${run.reason}` : `${name} was stopped.`,
			);
	}
}

/**
 * `/bugs?new=1&for=<area>&title=…&details=…`: the report form for a run's proposed second bug,
 * filled in, the evidence led by where it came from. The run's words travel as query values, never
 * as markup; the form's own limits cap them again.
 */
export function fileSecondBugHref(
	run: Pick<FixRunView, 'id' | 'secondBug'>,
	from: number,
): string | null {
	const second = run.secondBug;
	if (!second) return null;
	const details = `Proposed by fix run ${run.id} on ${bugRef(from)}.\n\n${second.evidence}`;
	const q = new URLSearchParams({
		new: '1',
		for: second.area,
		title: capText(second.title, MAX_TITLE),
		details: capText(details, MAX_DESCRIPTION),
	});
	return `/bugs?${q}`;
}

/** "Proposed second bug: Atlas Maker — the title". */
export const secondBugText = (second: { area: string; title: string }): string =>
	`Proposed second bug: ${bugAreaName('pipeline', second.area)} — ${second.title}`;
