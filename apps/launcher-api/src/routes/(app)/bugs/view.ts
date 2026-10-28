import {
	BUG_PRIORITIES,
	BUG_PRIORITY_LABELS,
	BUG_STATUSES,
	BUG_STATUS_LABELS,
	NO_PRIORITY_LABEL,
	bugAreaName,
	bugRef,
	isBugPriority,
	isBugStatus,
	type BugKind,
	type BugPriority,
	type BugStatus,
	type LinkState,
	type PipelineWait,
} from '$lib/bugReports';
import type { BugEventView, BugSummary, LinkSync } from '$lib/server/bugReports';
import type { PillTone } from '../pipeline/view';

/**
 * Pure helpers for the two bug pages (pipeline `/bugs`, game `/game-bugs`): the filters (and their
 * round trip through the address, so a filtered overview is a link), the sort, tones and the
 * wording of each activity line. No Svelte and no browser globals, so a Node fixture can import it
 * as it is.
 */

export type PriorityFilter = BugPriority | 'none';
export type SentFilter = 'all' | 'sent' | 'notSent';
export type SortKey = 'newest' | 'updated' | 'priority';

export interface BugFilters {
	q: string;
	/** Empty = every status. */
	status: BugStatus[];
	/** Empty = every priority; `none` is "not set". */
	priority: PriorityFilter[];
	area: string;
	project: string;
	reporter: string;
	sent: SentFilter;
	mine: boolean;
	sort: SortKey;
}

/** What the overview opens on: the bugs still to do, newest first. */
export const DEFAULT_FILTERS: BugFilters = {
	q: '',
	status: ['open', 'working'],
	priority: [],
	area: '',
	project: '',
	reporter: '',
	sent: 'all',
	mine: false,
	sort: 'newest',
};

export const SORT_LABELS: Record<SortKey, string> = {
	newest: 'Newest first',
	updated: 'Recently updated',
	priority: 'Highest priority first',
};

const SENT: SentFilter[] = ['all', 'sent', 'notSent'];
const SORTS: SortKey[] = ['newest', 'updated', 'priority'];

/** The priority chips, highest first, then "not set". */
export const PRIORITY_FILTERS: PriorityFilter[] = [...BUG_PRIORITIES, 'none'];

export const priorityFilterLabel = (p: PriorityFilter): string =>
	p === 'none' ? NO_PRIORITY_LABEL : BUG_PRIORITY_LABELS[p];

export const asSentFilter = (v: string): SentFilter =>
	(SENT as string[]).includes(v) ? (v as SentFilter) : 'all';

export const asSortKey = (v: string): SortKey =>
	(SORTS as string[]).includes(v) ? (v as SortKey) : DEFAULT_FILTERS.sort;

const isPriorityFilter = (v: string): v is PriorityFilter => v === 'none' || isBugPriority(v);

export function filterBugs(bugs: BugSummary[], f: BugFilters): BugSummary[] {
	const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
	return bugs.filter((b) => {
		if (f.status.length && !f.status.includes(b.status)) return false;
		if (f.priority.length && !f.priority.includes(b.priority ?? 'none')) return false;
		if (f.area && b.area !== f.area) return false;
		if (f.project && (b.projectKey ?? '') !== f.project) return false;
		if (f.reporter && b.reporter !== f.reporter) return false;
		if (f.sent === 'sent' && !b.sentAt) return false;
		if (f.sent === 'notSent' && b.sentAt) return false;
		if (f.mine && !b.mine) return false;
		if (!words.length) return true;
		const text = [
			b.title,
			b.description,
			bugAreaName(b.kind, b.area),
			b.projectKey ?? '',
			b.reporter,
			...b.links.map((l) => l.title),
		]
			.join('\n')
			.toLowerCase();
		return words.every((w) => {
			// `BUG-12` is that bug and `#1234` that pull request — not BUG-120 or #12345.
			const ref = /^bug-(\d+)$/.exec(w);
			if (ref) return b.number === Number(ref[1]);
			const pr = /^#(\d+)$/.exec(w);
			if (pr) return b.links.some((l) => l.number === Number(pr[1]));
			return text.includes(w);
		});
	});
}

const PRIORITY_RANK: Record<PriorityFilter, number> = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
	none: 4,
};

export function sortBugs(bugs: BugSummary[], key: SortKey): BugSummary[] {
	const out = [...bugs];
	if (key === 'updated') out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	else if (key === 'priority') {
		out.sort(
			(a, b) =>
				PRIORITY_RANK[a.priority ?? 'none'] - PRIORITY_RANK[b.priority ?? 'none'] ||
				b.number - a.number,
		);
	} else out.sort((a, b) => b.number - a.number);
	return out;
}

export const statusCounts = (bugs: BugSummary[]): Record<BugStatus, number> =>
	Object.fromEntries(
		BUG_STATUSES.map((s) => [s, bugs.filter((b) => b.status === s).length]),
	) as Record<BugStatus, number>;

export const isDefaultFilters = (f: BugFilters): boolean =>
	JSON.stringify(f) === JSON.stringify(DEFAULT_FILTERS);

/**
 * The filters as an address query (only what differs from the defaults), beside `?bug=`. A game
 * list is one project's and never sent anywhere, so it has no project or sent filter — and its
 * `?project=` is the page's scope, which the page writes itself.
 */
export function filtersToQuery(f: BugFilters, kind: BugKind): URLSearchParams {
	const q = new URLSearchParams();
	const list = (a: string[], b: string[]) => a.join(',') !== b.join(',');
	if (f.q) q.set('q', f.q);
	if (list(f.status, DEFAULT_FILTERS.status)) q.set('status', f.status.join(',') || 'all');
	if (f.priority.length) q.set('priority', f.priority.join(','));
	if (f.area) q.set('area', f.area);
	if (f.project && kind === 'pipeline') q.set('project', f.project);
	if (f.reporter) q.set('reporter', f.reporter);
	if (f.sent !== 'all' && kind === 'pipeline') q.set('sent', f.sent);
	if (f.mine) q.set('mine', '1');
	if (f.sort !== DEFAULT_FILTERS.sort) q.set('sort', f.sort);
	return q;
}

/** The page's whole query: a game list's project (its scope), then the filters, then the open bug. */
export function addressQuery(
	f: BugFilters,
	kind: BugKind,
	projectKey: string | null,
	bug: number | null,
): string {
	const q = new URLSearchParams(projectKey ? { project: projectKey } : {});
	for (const [k, v] of filtersToQuery(f, kind)) q.set(k, v);
	if (bug !== null) q.set('bug', String(bug));
	return q.toString();
}

/** Back from the address; anything it does not know falls back to the default. */
export function filtersFromQuery(q: URLSearchParams, kind: BugKind): BugFilters {
	const pipeline = kind === 'pipeline';
	const status = q.get('status');
	const priority = q.get('priority');
	return {
		q: q.get('q') ?? '',
		status:
			status === null
				? DEFAULT_FILTERS.status
				: status === 'all'
					? []
					: status.split(',').filter(isBugStatus),
		priority: priority ? priority.split(',').filter(isPriorityFilter) : [],
		area: q.get('area') ?? '',
		project: pipeline ? (q.get('project') ?? '') : '',
		reporter: q.get('reporter') ?? '',
		sent: pipeline ? asSentFilter(q.get('sent') ?? '') : 'all',
		mine: q.get('mine') === '1',
		sort: asSortKey(q.get('sort') ?? ''),
	};
}

export function statusTone(status: BugStatus): PillTone {
	if (status === 'open') return 'blue';
	if (status === 'working') return 'amber';
	if (status === 'resolved') return 'green';
	return 'muted';
}

export function priorityTone(priority: BugPriority | null): PillTone {
	if (priority === 'critical') return 'red';
	if (priority === 'high') return 'amber';
	if (priority === 'medium') return 'blue';
	return 'muted';
}

export const priorityLabel = (p: BugPriority | null): string =>
	p ? BUG_PRIORITY_LABELS[p] : NO_PRIORITY_LABEL;

export const statusLabel = (s: BugStatus): string => BUG_STATUS_LABELS[s];

/** The tag a game bug carries for the pipeline bug it was handed to (ADR-0012 §3). */
export function escalationTone(state: PipelineWait): PillTone {
	if (state === 'waiting') return 'amber';
	if (state === 'fixed') return 'green';
	return 'muted';
}

export interface DerivedLabel {
	tone: PillTone;
	text: string;
	/** The pipeline bug the label names, when it does. */
	pipelineBug: number | null;
}

/**
 * The labels beside a game bug's status (list row and panel), all derived by the server: where
 * its pipeline bug stands, and a repair run's fix not yet published.
 */
export function derivedLabels(b: Pick<BugSummary, 'escalation' | 'repairLabel'>): DerivedLabel[] {
	const out: DerivedLabel[] = [];
	if (b.escalation) {
		out.push({
			tone: escalationTone(b.escalation.state),
			text: b.escalation.label,
			pipelineBug: b.escalation.number,
		});
	}
	if (b.repairLabel) out.push({ tone: 'green', text: b.repairLabel, pipelineBug: null });
	return out;
}

/** Whether the bug is still to do: only then does a run or an escalation make sense. */
export const isRepairable = (status: BugStatus): boolean =>
	status === 'open' || status === 'working';

/** What the game bug page learned on the server, to decide which repair controls to show. */
export interface RepairFacts {
	/** The viewer holds the Director tool and the game triage capability. */
	canStart: boolean;
	/** Some Director run (either kind) is live on the project. */
	liveRun: boolean;
	/** The viewer holds game triage and the Pipeline Bug Reports tool. */
	canEscalate: boolean;
}

/** A page with no repair controls: the pipeline list. */
export const NO_REPAIR: RepairFacts = { canStart: false, liveRun: false, canEscalate: false };

export const showRepairWithDirector = (
	facts: RepairFacts,
	bug: Pick<BugSummary, 'kind' | 'status'>,
): boolean => bug.kind === 'game' && facts.canStart && isRepairable(bug.status) && !facts.liveRun;

export const showEscalate = (
	facts: RepairFacts,
	bug: Pick<BugSummary, 'kind' | 'status' | 'escalation'>,
): boolean =>
	bug.kind === 'game' && facts.canEscalate && isRepairable(bug.status) && bug.escalation === null;

export interface RepairRunLine {
	runId: string;
	/** Where it stands, in words: running, fixed, handed to the pipeline… */
	state: string;
	at: string;
}

const REPAIR_END_WORDS: Record<string, string> = {
	fixed: 'fixed',
	escalated: 'handed to the pipeline',
	needs_person: 'needs a person',
	not_reproduced: 'could not be reproduced',
	stopped: 'stopped',
};

/** The bug's repair runs, newest first, each as its `repair` events last left it. */
export function repairRuns(events: readonly BugEventView[]): RepairRunLine[] {
	const runs = new Map<string, RepairRunLine>();
	for (const e of events) {
		if (e.kind !== 'repair' || typeof e.data.runId !== 'string') continue;
		const outcome = typeof e.data.outcome === 'string' ? e.data.outcome : '';
		const state = e.data.phase === 'started' ? 'running' : (REPAIR_END_WORDS[outcome] ?? 'ended');
		runs.set(e.data.runId, { runId: e.data.runId, state, at: e.at });
	}
	return [...runs.values()].reverse();
}

export function linkTone(state: LinkState): PillTone {
	if (state === 'open') return 'blue';
	if (state === 'merged') return 'green';
	return 'muted';
}

export const LINK_STATE_LABELS: Record<LinkState, string> = {
	open: 'open',
	merged: 'merged',
	closed: 'closed',
};

const BECAUSE: Record<LinkState | 'unlinked', string> = {
	open: 'opened',
	merged: 'merged',
	closed: 'closed without merging',
	unlinked: 'no longer names it',
};

const STATUS_BECAUSE: Record<string, string> = {
	repair: 'a Director repair run started',
	'repair ended': 'the repair run ended without a fix',
	escalated: 'it was handed to the pipeline',
	published: 'the fix was published',
};

/** One `repair` event, after the actor's name ("Director run abc started a repair"). */
function repairText(d: Record<string, unknown>): string {
	if (d.phase === 'started') return 'started a repair';
	if (d.phase === 'fixed') return 'fixed it: it ships with the next publish';
	if (d.phase === 'published') return 'published the fix';
	const outcome = typeof d.outcome === 'string' ? d.outcome : '';
	return `ended the repair: ${REPAIR_END_WORDS[outcome] ?? 'ended'}`;
}

/** The longer text under an activity line: a comment, or what a repair run reported. */
export function eventNote(e: BugEventView): string | null {
	if (e.kind === 'comment') return typeof e.data.text === 'string' ? e.data.text : null;
	if (e.kind === 'repair' && typeof e.data.summary === 'string' && e.data.summary.trim()) {
		return e.data.summary;
	}
	return null;
}

const word = (v: unknown, labels: Record<string, string>, none: string): string =>
	typeof v === 'string' && v in labels ? labels[v] : none;

/** One activity line, after the actor's name ("Ana set the priority to High"). */
export function eventText(e: BugEventView): string {
	const d = e.data;
	switch (e.kind) {
		case 'reported':
			return d.priority
				? `reported the bug, priority ${word(d.priority, BUG_PRIORITY_LABELS, String(d.priority))}`
				: 'reported the bug';
		case 'edited': {
			const fields = Array.isArray(d.fields) ? d.fields.map(String) : [];
			const names: Record<string, string> = {
				title: 'title',
				description: 'description',
				area: 'area',
				project: 'project',
				pageUrl: 'page address',
			};
			return `edited the ${fields.map((f) => names[f] ?? f).join(', ') || 'report'}`;
		}
		case 'comment':
			return 'commented';
		case 'priority':
			return d.to
				? `set the priority to ${word(d.to, BUG_PRIORITY_LABELS, NO_PRIORITY_LABEL)}`
				: 'cleared the priority';
		case 'status': {
			const to = word(d.to, BUG_STATUS_LABELS, String(d.to));
			if (typeof d.pr === 'number') {
				return `marked it ${to}: #${d.pr} ${word(d.because, BECAUSE, 'changed')}`;
			}
			const why = typeof d.because === 'string' ? STATUS_BECAUSE[d.because] : undefined;
			return why ? `marked it ${to}: ${why}` : `marked it ${to}`;
		}
		case 'repair':
			return repairText(d);
		case 'escalated':
			return typeof d.to === 'number'
				? `handed it to the pipeline as ${bugRef(d.to)}`
				: typeof d.from === 'number'
					? `filed this from game bug ${bugRef(d.from)}`
					: 'escalated it';
		case 'sent':
			return 'sent it to Pipeline Changes';
		case 'unsent':
			return 'took it back from Pipeline Changes';
		case 'screenshot_added':
			return 'added a screenshot';
		case 'screenshot_removed':
			return 'removed a screenshot';
		case 'unlinked':
			return `unlinked #${String(d.pr)}: it no longer names this bug`;
		case 'linked':
			return `linked #${String(d.pr)}${typeof d.title === 'string' ? ` “${d.title}”` : ''}`;
		default:
			return e.kind;
	}
}

/** The line under the linked pull requests: whether a pull request can move the status now. */
export function syncText(sync: LinkSync | null): string | null {
	if (!sync) return null;
	if (sync.state === 'off') {
		return `Linked pull requests are not read: the GitHub App is not configured (${sync.message}).`;
	}
	if (sync.state === 'error') return `Linked pull requests could not be read. ${sync.message}`;
	return null;
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** `?bug=<n>`: the bug a shared link opens. */
export function askedBug(url: URL): number | null {
	const asked = Number(url.searchParams.get('bug'));
	return Number.isSafeInteger(asked) && asked > 0 ? asked : null;
}

/** `?new=1[&for=<area>][&page=<address>]`: the report form a link opens, an unknown area dropped. */
export function askedReport(
	url: URL,
	known: (area: string) => boolean,
): { area: string; pageUrl: string } | null {
	if (url.searchParams.get('new') !== '1') return null;
	const area = url.searchParams.get('for') ?? '';
	return { area: known(area) ? area : '', pageUrl: url.searchParams.get('page') ?? '' };
}
