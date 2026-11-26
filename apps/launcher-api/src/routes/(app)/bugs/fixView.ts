import { MAX_DESCRIPTION, MAX_TITLE, bugAreaName, bugRef } from '$lib/bugReports';
import {
	MAX_BUILD_NOTE,
	capText,
	type FixFacts,
	type FixOptionId,
	type FixRunDiagnosis,
	type FixRunOutcome,
	type FixRunView,
} from '$lib/bugFixRuns';
import type { PillTone } from '../pipeline/view';

/**
 * What the pages decide about fix runs on pipeline bugs (ADR-0013 card 13C): which Start button a
 * caller sees on the Bugs tab and the bug page, how a run reads on its line, and the address that
 * opens the report form for a proposed second bug. Pure, so `check:bug-fix-runs` pins every state
 * as it stands. No Svelte, no browser globals.
 */

export const SEND_AND_START = 'Send and diagnose';
export const START_FIX = 'Diagnose';

export type FixControl =
	/** Nothing to press: no capability pair, fix runs cannot run yet, or a run is going. */
	| { kind: 'hidden' }
	/** The button. `sends` is true on an unsent bug: the click sends it, then starts the run. */
	| { kind: 'start'; label: string; sends: boolean }
	/** The button greyed, with the refusal the server would give, in words. */
	| { kind: 'blocked'; label: string; sends: boolean; why: string };

/** What the Diagnose button promises: a diagnosis, never a change (ADR-0014 §1). */
export const DIAGNOSE_TIP =
	'Finds the cause and offers options for you to choose from. It changes nothing: a build starts only when you pick an option.';

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

export interface FixBanner {
	tone: PillTone;
	text: string;
	/** Set only on "Fix proposed": the Pipeline Changes address of that one change. */
	href: string | null;
	/** The newest run's own summary, in full, for the page to show as text under the banner. */
	summary: string | null;
}

const OUTCOME_WORDS: Partial<Record<FixRunOutcome, string>> = {
	not_reproduced: 'it did not reproduce',
	needs_person: 'it needs a person',
	second_area: 'the cause is in another area',
};

const usd = (n: number): string => `$${n.toFixed(2)}`;

/** "Diagnosis d2a4…", "Build b71c… of option B": which kind of run a line is about. */
function runName(run: FixRunView): string {
	if (run.mode === 'diagnose') return `Diagnosis ${run.id}`;
	return run.chosenOption
		? `Build ${run.id} of option ${run.chosenOption.optionId}`
		: `Build ${run.id}`;
}

/** One run as its line reads. Every word of the run's own (`summary`) goes in `note`, as text. */
export function fixRunLine(run: FixRunView): FixRunLine {
	const name = runName(run);
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
		case 'diagnosed': {
			const n = run.diagnosis?.options.length ?? 0;
			return line(
				'amber',
				'Diagnosed',
				`${name} is ready: ${n} option${n === 1 ? '' : 's'}. Nothing is built until you choose.`,
			);
		}
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
			return line(
				'amber',
				'No fix',
				run.mode === 'diagnose'
					? `${name} ended without options: ${why.replace(/\.$/, '')}.`
					: `${name} found no fix: ${why.replace(/\.$/, '')}.`,
			);
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

const NO_CHANGE = 'No change was made';

/**
 * The one banner at the top of a pipeline bug (ADR-0014 §4), from the bug's runs (newest first):
 * what the newest run did, or null when there is none. A diagnosis that ended `diagnosed` is
 * "Waiting on your decision" while it is the newest run; a build run is the newest once chosen.
 */
export function fixBanner(runs: FixRunView[]): FixBanner | null {
	const run = runs[0];
	if (!run) return null;
	const out = (tone: PillTone, text: string, href: string | null = null): FixBanner => ({
		tone,
		text,
		href,
		summary: run.summary,
	});
	const building = (): string => {
		const c = run.chosenOption;
		return c ? `Building option ${c.optionId} — ${c.name}…` : 'Building…';
	};
	switch (run.status) {
		case 'dispatched':
		case 'running':
			return out('blue', run.mode === 'diagnose' ? 'Diagnosing…' : building());
		case 'diagnosed': {
			const n = run.diagnosis?.options.length ?? 0;
			return out('amber', `Waiting on your decision — ${n} option${n === 1 ? '' : 's'}`);
		}
		case 'pr_opened':
			return run.prNumber === null
				? out('green', 'Fix proposed — review the draft change')
				: out(
						'green',
						`Fix proposed — review change #${run.prNumber}`,
						`/pipeline?change=${run.prNumber}`,
					);
		case 'no_fix': {
			const why = run.reason ?? ((run.outcome && OUTCOME_WORDS[run.outcome]) || 'no fix');
			return out('amber', `${NO_CHANGE} — ${why.replace(/\.$/, '')}`);
		}
		case 'failed':
			return out('red', `${NO_CHANGE} — ${(run.reason ?? 'the run failed').replace(/\.$/, '')}`);
		case 'cancelled':
			return out(
				'muted',
				`${NO_CHANGE} — ${(run.reason ?? 'the run was stopped').replace(/\.$/, '')}`,
			);
	}
}

export type BuildButton =
	/** Pressable: the label names the option. */
	| { kind: 'ready'; label: string }
	/** Greyed, with the sentence that says why. */
	| { kind: 'blocked'; label: string; why: string };

export const NO_RIGHTS_TO_BUILD =
	'A fix run needs both the “Start fix runs on pipeline bugs” and the “Triage pipeline bugs” permissions. You can read the options.';
export const PICK_FIRST = 'Pick an option first.';

/**
 * The Build button of a diagnosis card. Nothing is pre-selected: without a pick it is blocked, even
 * with a single option. `facts.canBuild` is the server's word; a viewer without the pair is told
 * so, anyone else gets the start refusal's sentence.
 */
export function buildButton(
	facts: FixFacts,
	options: FixRunDiagnosis['options'],
	picked: FixOptionId | null,
): BuildButton {
	const option = options.find((o) => o.id === picked);
	const label = option ? `Build “${option.name}”` : 'Build';
	if (!facts.may) return { kind: 'blocked', label, why: NO_RIGHTS_TO_BUILD };
	if (!facts.canBuild) {
		return {
			kind: 'blocked',
			label,
			why: facts.refusal?.message ?? 'Fix runs cannot start right now.',
		};
	}
	if (!option) return { kind: 'blocked', label, why: PICK_FIRST };
	return { kind: 'ready', label };
}

/** "412 / 1000": the note's counter. */
export const noteCounter = (note: string): string => `${note.length} / ${MAX_BUILD_NOTE}`;

/** "Chosen: B — name": the head of the card once a build run exists (who and when follow it). */
export const choiceText = (c: { optionId: string; name: string }): string =>
	`Chosen: ${c.optionId} — ${c.name}`;

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
