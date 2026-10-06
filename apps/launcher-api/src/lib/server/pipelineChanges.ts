import { error } from '@sveltejs/kit';
import { mapWithConcurrency } from './concurrency';
import { ENV } from './env';
import { githubApp, type GithubApp } from './githubApp';
import { listApprovals, recordApproval, type PipelineApproval } from './pipelineApprovals';
import {
	loadHarnessReport,
	unapprovableReason,
	visibleDiffs,
	type HarnessDiff,
	type HarnessReportState,
} from './pipelineReport';

/**
 * Invisible Pipeline Changes over GitHub (ADR-0007, "GitHub is the record"): the changes are the
 * open pull requests into `main`, their status is read from the checks on each head, and the
 * launcher adds only what GitHub cannot hold — the approval of a changed screen, which it then
 * reports back as the `current-games` commit status. Everything GitHub answers is read through the
 * App (`githubApp.ts`); nothing here pushes, merges or bypasses branch protection.
 */

/** The one required status context: the harness posts it, and so does an approval. */
export const HARNESS_CONTEXT = 'current-games';
/** The harness workflow's `name:`, as the Actions API reports a run. */
export const HARNESS_WORKFLOW = 'Current games';
/** Reserved for Director games, which never make a PR; a PR wearing it is not a change. */
export const DIRECTOR_GAME_LABEL = 'director-game';
/** An Agents-tab change (PLAN 5.4); listed like any other, flagged for the UI. */
export const AGENT_DEFINITION_LABEL = 'agent-definition';
const BASE_BRANCH = 'main';
const PER_CHANGE_CONCURRENCY = 4;
const PAGE = 100;
const MAX_PAGES = 5;
/** The list is read on every page load; a cache this short saves nothing a user would notice
 *  missing and spares GitHub a burst when several tabs open at once. */
const LIST_TTL_MS = 15_000;

// ── GitHub's shapes, the fields read ────────────────────────────────────────────

interface GhUser {
	login: string;
	type?: string;
}

interface GhPull {
	number: number;
	title: string;
	body: string | null;
	html_url: string;
	state: string;
	draft?: boolean;
	created_at: string;
	updated_at: string;
	head: { sha: string; ref: string };
	base: { ref: string };
	user: GhUser | null;
	labels?: { name: string }[];
	/** Only on `GET /pulls/{n}`: `dirty` is a conflict, `unknown` is GitHub still computing. */
	mergeable_state?: string;
}

interface GhCheckRun {
	id: number;
	name: string;
	status: string;
	conclusion: string | null;
	html_url: string | null;
	check_suite: { id: number } | null;
	app: { slug?: string; name?: string } | null;
	output: { title: string | null; summary: string | null } | null;
}

interface GhWorkflowRun {
	id: number;
	name: string;
	event: string;
	status: string | null;
	conclusion: string | null;
	head_sha: string;
	check_suite_id: number;
	html_url: string;
	run_attempt?: number;
	created_at: string;
}

interface GhStatus {
	context: string;
	state: string;
	description: string | null;
	target_url: string | null;
	updated_at: string;
}

interface GhFile {
	filename: string;
	status: string;
	additions: number;
	deletions: number;
	blob_url?: string;
}

// ── What the tool shows ────────────────────────────────────────────────────────

export type ChangeStatus =
	| { kind: 'testing'; done: number; total: number }
	| { kind: 'blocked'; reason: string }
	| { kind: 'ready' };

export interface ChangeSummary {
	number: number;
	title: string;
	branch: string;
	url: string;
	diffUrl: string;
	draft: boolean;
	author: string;
	openedAt: string;
	updatedAt: string;
	headSha: string;
	labels: string[];
	agentDefinition: boolean;
	status: ChangeStatus;
}

export interface ChangeList {
	changes: ChangeSummary[];
	/** Dependabot's PRs, kept apart: they are updates, not pipeline changes anyone wrote. */
	dependabot: ChangeSummary[];
	fetchedAt: string;
}

export type CheckState = 'pending' | 'pass' | 'fail' | 'skipped';

export interface CheckJob {
	name: string;
	state: CheckState;
	conclusion: string | null;
	url: string | null;
}

/** Check 1: one workflow's jobs on the head, with the pass count read from their summaries. */
export interface CheckGroup {
	workflow: string;
	url: string | null;
	state: CheckState;
	jobs: CheckJob[];
	passed: number;
	total: number;
	/** `N of M` as the jobs' own summaries count it, when they say. */
	tests: { passed: number; total: number } | null;
}

export interface HarnessStatus {
	state: string;
	description: string | null;
	url: string | null;
	updatedAt: string;
}

/** Check 2: the harness on this head. */
export interface HarnessCheck {
	status: HarnessStatus | null;
	run: { id: number; url: string; status: string | null; conclusion: string | null } | null;
	report: HarnessReportState;
	diffs: (HarnessDiff & { approval: PipelineApproval | null })[];
	approvals: PipelineApproval[];
	/** `null` when approving every diff can clear the run; else why it cannot. */
	unapprovable: string | null;
}

export interface ChangeFile {
	path: string;
	status: string;
	additions: number;
	deletions: number;
	url: string | null;
}

export interface ChangeDetail extends ChangeSummary {
	state: string;
	body: string | null;
	why: string | null;
	baseBranch: string;
	mergeableState: string | null;
	files: ChangeFile[];
	filesTruncated: boolean;
	checks: CheckGroup[];
	harness: HarnessCheck;
}

export interface ApproveResult {
	approval: PipelineApproval;
	approved: number;
	of: number;
	/** Whether this approval completed the set and `success` went to `current-games`. */
	statusPosted: boolean;
}

// ── Pure parts ─────────────────────────────────────────────────────────────────

export function isDependabot(user: GhUser | null): boolean {
	if (!user) return false;
	return (
		user.login === 'dependabot[bot]' || (user.type === 'Bot' && /^dependabot/.test(user.login))
	);
}

const labelsOf = (pull: GhPull): string[] => (pull.labels ?? []).map((l) => l.name);

export function checkState(status: string, conclusion: string | null): CheckState {
	if (status !== 'completed') return 'pending';
	if (conclusion === 'success') return 'pass';
	if (conclusion === 'skipped' || conclusion === 'neutral') return 'skipped';
	return 'fail';
}

function groupState(jobs: CheckJob[]): CheckState {
	if (jobs.some((j) => j.state === 'fail')) return 'fail';
	if (jobs.some((j) => j.state === 'pending')) return 'pending';
	if (jobs.every((j) => j.state === 'skipped')) return 'skipped';
	return 'pass';
}

/**
 * `118 of 118`, `118 passed, 2 failed`: the counts a job's SUMMARY carries, if it wrote one. A
 * bare `1/3` is not read: that is how a matrix job is named (`checks (1/3)`), not a count.
 */
export function testsInSummary(
	text: string | null | undefined,
): { passed: number; total: number } | null {
	if (!text) return null;
	const ofTotal = /(\d+)\s+of\s+(\d+)/.exec(text);
	if (ofTotal) return { passed: Number(ofTotal[1]), total: Number(ofTotal[2]) };
	const passed = /(\d+)\s+pass(?:ed|ing)?\b/i.exec(text);
	if (!passed) return null;
	const failed = /(\d+)\s+fail(?:ed|ing|ures?)?\b/i.exec(text);
	const n = Number(passed[1]);
	return { passed: n, total: n + (failed ? Number(failed[1]) : 0) };
}

/**
 * Check runs grouped by the workflow that ran them (`check_suite.id` → workflow run); a check
 * another App posts groups under that App's name. Order: the workflows as GitHub lists them.
 */
export function groupCheckRuns(
	checkRuns: GhCheckRun[],
	workflowRuns: GhWorkflowRun[],
): CheckGroup[] {
	const bySuite = new Map(workflowRuns.map((r) => [r.check_suite_id, r]));
	const groups = new Map<string, CheckGroup>();
	for (const run of checkRuns) {
		const workflow = run.check_suite ? bySuite.get(run.check_suite.id) : undefined;
		const name = workflow?.name ?? run.app?.name ?? run.name;
		let group = groups.get(name);
		if (!group) {
			group = {
				workflow: name,
				url: workflow?.html_url ?? null,
				state: 'pass',
				jobs: [],
				passed: 0,
				total: 0,
				tests: null,
			};
			groups.set(name, group);
		}
		group.jobs.push({
			name: run.name,
			state: checkState(run.status, run.conclusion),
			conclusion: run.conclusion,
			url: run.html_url,
		});
		const tests = testsInSummary(run.output?.summary);
		if (tests) {
			group.tests = {
				passed: (group.tests?.passed ?? 0) + tests.passed,
				total: (group.tests?.total ?? 0) + tests.total,
			};
		}
	}
	for (const group of groups.values()) {
		group.state = groupState(group.jobs);
		group.total = group.jobs.filter((j) => j.state !== 'skipped').length;
		group.passed = group.jobs.filter((j) => j.state === 'pass').length;
	}
	return [...groups.values()];
}

export interface StatusInput {
	mergeableState: string | null;
	checks: CheckGroup[];
	/** The `current-games` context on the head; `null` when it has not reported. */
	harness: { state: string; description: string | null } | null;
}

const conclusionWord = (c: string | null): string =>
	c === 'failure' || !c ? 'failed' : c.replace(/_/g, ' ');

/**
 * Testing / Blocked / Ready to merge (ADR-0007). Blocked wins over Testing: a failed gate is
 * something to fix now, whatever else is still running. `current-games` is required on `main`,
 * so a head it has not reported on is still testing however green the rest is.
 */
export function deriveStatus({ mergeableState, checks, harness }: StatusInput): ChangeStatus {
	if (mergeableState === 'dirty') return { kind: 'blocked', reason: 'Merge conflict with main' };
	for (const group of checks) {
		const failed = group.jobs.find((j) => j.state === 'fail');
		if (failed) {
			return {
				kind: 'blocked',
				reason: `${group.workflow}: ${failed.name} ${conclusionWord(failed.conclusion)}`,
			};
		}
	}
	if (harness && (harness.state === 'failure' || harness.state === 'error')) {
		return { kind: 'blocked', reason: `${HARNESS_CONTEXT}: ${harness.description ?? 'failed'}` };
	}
	const jobs = checks.flatMap((g) => g.jobs).filter((j) => j.state !== 'skipped');
	const done =
		jobs.filter((j) => j.state === 'pass').length + (harness?.state === 'success' ? 1 : 0);
	const total = jobs.length + 1;
	if (done < total) return { kind: 'testing', done, total };
	return { kind: 'ready' };
}

/**
 * The "why" of a change, from its PR body: a `Why` heading or a bold `Why:` lead-in when the
 * author wrote one, else the first paragraph. Markdown, as written.
 */
export function whyFromBody(body: string | null): string | null {
	if (!body) return null;
	const text = body
		.replace(/\r\n/g, '\n')
		.replace(/<!--[\s\S]*?-->/g, '')
		.trim();
	const heading = /(?:^|\n)#{1,6}[ \t]*why\b[^\n]*\n+([\s\S]*?)(?=\n#{1,6}[ \t]|$)/i.exec(text);
	if (heading) return clip(heading[1]);
	const lead =
		/(?:^|\n)[ \t]*(?:\*\*|__)?why:?(?:\*\*|__)?:?[ \t]*([^\n]+(?:\n(?![ \t]*\n)[^\n]+)*)/i.exec(
			text,
		);
	if (lead) return clip(lead[1]);
	const paragraph = text
		.split(/\n[ \t]*\n/)
		.map((p) => p.trim())
		.find((p) => p && !/^#{1,6}[ \t]/.test(p));
	return paragraph ? clip(paragraph) : null;
}

const clip = (s: string): string => {
	const t = s.trim();
	return t.length > 600 ? `${t.slice(0, 597)}…` : t;
};

// ── GitHub reads ───────────────────────────────────────────────────────────────

const repo = (): string => ENV.GITHUB_ENGINE_REPO;

async function openPulls(app: GithubApp): Promise<GhPull[]> {
	const pulls: GhPull[] = [];
	for (let page = 1; page <= MAX_PAGES; page++) {
		const batch = await app.json<GhPull[]>(
			`/repos/${repo()}/pulls?state=open&base=${BASE_BRANCH}&per_page=${PAGE}&page=${page}`,
		);
		pulls.push(...batch);
		if (batch.length < PAGE) break;
	}
	return pulls;
}

interface Head {
	checkRuns: GhCheckRun[];
	workflowRuns: GhWorkflowRun[];
	statuses: GhStatus[];
}

/** Everything that reports on a head: check runs, the workflow runs that own them, statuses. */
async function readHead(app: GithubApp, sha: string): Promise<Head> {
	const r = repo();
	const [checks, runs, combined] = await Promise.all([
		app.json<{ check_runs: GhCheckRun[] }>(
			`/repos/${r}/commits/${sha}/check-runs?per_page=${PAGE}`,
		),
		app.json<{ workflow_runs: GhWorkflowRun[] }>(
			`/repos/${r}/actions/runs?head_sha=${sha}&per_page=${PAGE}`,
		),
		app.json<{ statuses: GhStatus[] }>(`/repos/${r}/commits/${sha}/status`),
	]);
	return {
		checkRuns: checks.check_runs,
		workflowRuns: runs.workflow_runs,
		statuses: combined.statuses,
	};
}

const harnessStatusOf = (head: Head): HarnessStatus | null => {
	const s = head.statuses.find((x) => x.context === HARNESS_CONTEXT);
	return s
		? { state: s.state, description: s.description, url: s.target_url, updatedAt: s.updated_at }
		: null;
};

/**
 * The harness run that owns this head's status: a `pull_request` run first (a push run stands
 * down when the PR exists), else the newest.
 */
const harnessRunOf = (head: Head, sha: string): GhWorkflowRun | null => {
	const runs = head.workflowRuns.filter((r) => r.name === HARNESS_WORKFLOW && r.head_sha === sha);
	return runs.find((r) => r.event === 'pull_request') ?? runs[0] ?? null;
};

function summaryOf(pull: GhPull, head: Head): ChangeSummary {
	const checks = groupCheckRuns(head.checkRuns, head.workflowRuns);
	const labels = labelsOf(pull);
	return {
		number: pull.number,
		title: pull.title,
		branch: pull.head.ref,
		url: pull.html_url,
		diffUrl: `${pull.html_url}/files`,
		draft: pull.draft ?? false,
		author: pull.user?.login ?? '',
		openedAt: pull.created_at,
		updatedAt: pull.updated_at,
		headSha: pull.head.sha,
		labels,
		agentDefinition: labels.includes(AGENT_DEFINITION_LABEL),
		status: deriveStatus({
			mergeableState: pull.mergeable_state ?? null,
			checks,
			harness: harnessStatusOf(head),
		}),
	};
}

let listCache: { at: number; list: ChangeList } | null = null;

/** Every open PR into `main`, bar Director games; Dependabot's apart. */
export async function listChanges(app: GithubApp = githubApp): Promise<ChangeList> {
	if (listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.list;
	const r = repo();
	const pulls = (await openPulls(app)).filter((p) => !labelsOf(p).includes(DIRECTOR_GAME_LABEL));
	const summaries = await mapWithConcurrency(pulls, PER_CHANGE_CONCURRENCY, async (listed) => {
		// The list omits mergeability; the PR itself carries it.
		const [pull, head] = await Promise.all([
			app.json<GhPull>(`/repos/${r}/pulls/${listed.number}`),
			readHead(app, listed.head.sha),
		]);
		return summaryOf(pull, head);
	});
	const list: ChangeList = { changes: [], dependabot: [], fetchedAt: new Date().toISOString() };
	summaries.forEach((s, i) =>
		(isDependabot(pulls[i].user) ? list.dependabot : list.changes).push(s),
	);
	listCache = { at: Date.now(), list };
	return list;
}

/** One change in full: files, why, Check 1, Check 2 with its approvals. Always fresh. */
export async function getChange(number: number, app: GithubApp = githubApp): Promise<ChangeDetail> {
	const r = repo();
	const res = await app.fetch(`/repos/${r}/pulls/${number}`);
	if (res.status === 404) throw error(404, `There is no change #${number}.`);
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { message?: string } | null;
		throw error(502, `GitHub ${res.status}: ${body?.message ?? res.statusText}`);
	}
	const pull = (await res.json()) as GhPull;
	if (pull.base.ref !== BASE_BRANCH || labelsOf(pull).includes(DIRECTOR_GAME_LABEL)) {
		throw error(404, `#${number} is not a pipeline change.`);
	}
	const sha = pull.head.sha;
	const [head, files] = await Promise.all([
		readHead(app, sha),
		app.json<GhFile[]>(`/repos/${r}/pulls/${number}/files?per_page=${PAGE}`),
	]);
	const run = harnessRunOf(head, sha);
	const [report, approvals] = await Promise.all([
		loadHarnessReport(app, r, run, sha),
		listApprovals(sha),
	]);
	const diffs = visibleDiffs(report);
	const byId = new Map(approvals.map((a) => [a.diffId, a]));
	return {
		...summaryOf(pull, head),
		state: pull.state,
		body: pull.body,
		why: whyFromBody(pull.body),
		baseBranch: pull.base.ref,
		mergeableState: pull.mergeable_state ?? null,
		files: files.map((f) => ({
			path: f.filename,
			status: f.status,
			additions: f.additions,
			deletions: f.deletions,
			url: f.blob_url ?? null,
		})),
		filesTruncated: files.length >= PAGE,
		checks: groupCheckRuns(head.checkRuns, head.workflowRuns),
		harness: {
			status: harnessStatusOf(head),
			run: run && { id: run.id, url: run.html_url, status: run.status, conclusion: run.conclusion },
			report,
			diffs: diffs.map((d) => ({ ...d, approval: byId.get(d.id) ?? null })),
			approvals,
			unapprovable: unapprovableReason(report, diffs),
		},
	};
}

/** The number of the change in a URL, or a 400. */
export function parseChangeNumber(param: string): number {
	const n = Number(param);
	if (!Number.isInteger(n) || n <= 0) {
		throw error(400, 'The change number must be a positive integer.');
	}
	return n;
}

/** The head a diff id names: its first segment. */
export function headOfDiffId(diffId: string): string | null {
	const m = /^([0-9a-f]{40}):/.exec(diffId);
	return m ? m[1] : null;
}

/**
 * Approve one changed screen (ADR-0007 "Diff approval"). The caller has passed the
 * `pipelineMerge` gate. When this approval completes the set on the head — and only a run whose
 * sole failures are changed screens can be completed — `success` goes to the `current-games`
 * context on that exact SHA, naming the approver, once: a context already green is left alone.
 */
export async function approveDiff(
	input: {
		number: number;
		diffId: string;
		note: string | null;
		user: NonNullable<App.Locals['user']>;
	},
	app: GithubApp = githubApp,
): Promise<ApproveResult> {
	const sha = headOfDiffId(input.diffId);
	if (!sha) throw error(400, 'diffId must be the screen id from the current-games report.');
	const change = await getChange(input.number, app);
	if (sha !== change.headSha) {
		throw error(
			409,
			`This change has a new head (${change.headSha.slice(0, 7)}); approvals on ${sha.slice(0, 7)} are void.`,
		);
	}
	const { harness } = change;
	if (harness.report.state !== 'ready') throw error(409, harness.report.detail);
	if (!harness.diffs.some((d) => d.id === input.diffId)) {
		throw error(404, 'No such changed screen on this head.');
	}
	const approver = input.user.name?.trim() || input.user.email;
	const approval = await recordApproval({
		diffId: input.diffId,
		prNumber: input.number,
		headSha: sha,
		approverId: input.user.id,
		approver,
		note: input.note,
	});
	listCache = null;
	const approved = new Set((await listApprovals(sha)).map((a) => a.diffId));
	const done = harness.diffs.filter((d) => approved.has(d.id)).length;
	const of = harness.diffs.length;
	let statusPosted = false;
	if (done === of && !harness.unapprovable && harness.status?.state !== 'success') {
		const approvers = [
			...new Set(
				harness.diffs.map((d) => (d.id === input.diffId ? approver : d.approval?.approver)),
			),
		].filter((a): a is string => !!a);
		const description =
			`All ${of} changed screen${of === 1 ? '' : 's'} approved by ${approvers.join(', ')}`.slice(
				0,
				140,
			);
		await app.json(`/repos/${repo()}/statuses/${sha}`, {
			method: 'POST',
			body: JSON.stringify({
				state: 'success',
				context: HARNESS_CONTEXT,
				description,
				target_url: change.url,
			}),
		});
		statusPosted = true;
	}
	return { approval, approved: done, of, statusPosted };
}
