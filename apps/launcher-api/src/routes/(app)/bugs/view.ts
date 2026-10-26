import {
	BUG_PRIORITIES,
	BUG_PRIORITY_LABELS,
	BUG_STATUSES,
	BUG_STATUS_LABELS,
	NO_PRIORITY_LABEL,
	bugAreaName,
	isBugPriority,
	isBugStatus,
	type BugKind,
	type BugPriority,
	type BugStatus,
	type LinkState,
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

const BECAUSE: Record<LinkState, string> = {
	open: 'opened',
	merged: 'merged',
	closed: 'closed without merging',
};

const word = (v: unknown, labels: Record<string, string>, none: string): string =>
	typeof v === 'string' && v in labels ? labels[v] : none;

/** One activity line, after the actor's name ("Ana set the priority to High"). */
export function eventText(e: BugEventView): string {
	const d = e.data;
	switch (e.kind) {
		case 'reported':
			return 'reported the bug';
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
			return typeof d.pr === 'number'
				? `marked it ${to}: #${d.pr} ${word(d.because, BECAUSE, 'changed')}`
				: `marked it ${to}`;
		}
		case 'sent':
			return 'sent it to Pipeline Changes';
		case 'unsent':
			return 'took it back from Pipeline Changes';
		case 'screenshot_added':
			return 'added a screenshot';
		case 'screenshot_removed':
			return 'removed a screenshot';
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
