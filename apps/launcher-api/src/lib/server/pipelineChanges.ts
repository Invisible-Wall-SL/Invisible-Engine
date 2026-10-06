import { error } from '@sveltejs/kit';
import { PIPELINE_MERGE_CAPABILITY, roleHasCapability } from '$lib/roles';
import { createKeyedMutex, createSingleFlight, mapWithConcurrency } from './concurrency';
import { ENV } from './env';
import { githubApp, GithubAppError, type GithubApp } from './githubApp';
import {
	getApprovers,
	listApprovals,
	recordApproval,
	type PipelineApproval,
} from './pipelineApprovals';
import {
	harnessJobsBlocker,
	loadHarnessReport,
	openReportEntry,
	reportImagePaths,
	unapprovableReason,
	visibleDiffs,
	type HarnessDiff,
	type HarnessReportState,
	type ReportImages,
} from './pipelineReport';
import { getRoleOverrides } from './roleToolAccess';
import { getToolOverrides } from './userToolAccess';

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
/** The harness workflow's file: a run counts only when THIS file made it — a name is a claim any
 *  workflow a PR adds can make. */
export const HARNESS_WORKFLOW_PATH = '.github/workflows/current-games.yml';
/**
 * What makes the report: a PR that edits any of it runs its own harness on itself, so its report
 * proves nothing and the launcher refuses to approve it (such a change is merged by hand after
 * review). The workflows as a whole, because `pull_request` runs the PR's copy of each.
 */
export const HARNESS_SOURCES = [/^\.github\/workflows\//, /^scripts\/current-games\//];
/** Reserved for Director games, which never make a PR; a PR wearing it is not a change. */
export const DIRECTOR_GAME_LABEL = 'director-game';
/** An Agents-tab change (PLAN 5.4); listed like any other, flagged for the UI. */
export const AGENT_DEFINITION_LABEL = 'agent-definition';
const BASE_BRANCH = 'main';
const PER_CHANGE_CONCURRENCY = 4;
const PAGE = 100;
const MAX_PAGES = 5;
/** GitHub lists at most this many files of a PR; past it the list is cut, not paged. */
const MAX_FILES = 3000;
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
	/** `repo` is null when the head's fork was deleted; never this repository then. */
	head: { sha: string; ref: string; repo: { full_name: string } | null };
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
}

interface GhWorkflowRun {
	id: number;
	name: string;
	/** The workflow file, repository-relative. */
	path: string;
	event: string;
	status: string | null;
	conclusion: string | null;
	head_sha: string;
	check_suite_id: number;
	html_url: string;
	run_attempt?: number;
	created_at: string;
	repository: { full_name: string };
	head_repository: { full_name: string } | null;
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
	/** On a rename: where the file was. */
	previous_filename?: string;
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
	/** PRs from forks, which are never listed: the harness does not run on them and the
	 *  launcher never approves them. */
	forksSkipped: number;
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
	run: {
		id: number;
		url: string;
		status: string | null;
		conclusion: string | null;
		attempt: number;
	} | null;
	report: HarnessReportState;
	/** Each diff with the approval that counts for it — by an approver who holds `pipelineMerge`
	 *  today — or none. */
	diffs: (HarnessDiff & { approval: PipelineApproval | null })[];
	/** Every approval recorded on this head; `standing` is whether its approver still counts. */
	approvals: (PipelineApproval & { standing: boolean })[];
	/** `null` when approving every diff can clear the run; else why it cannot. */
	unapprovable: string | null;
}

export interface ChangeFile {
	path: string;
	/** On a rename: where the file was. */
	previousPath: string | null;
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
	/** Diffs approved by someone who holds `pipelineMerge` today. */
	approved: number;
	of: number;
	/** Whether this approval completed the set and `success` went to `current-games`. */
	statusPosted: boolean;
	/** Why the set is complete and yet nothing was posted: the run's jobs disagree with its report. */
	withheld: string | null;
}

// ── Pure parts ─────────────────────────────────────────────────────────────────

export function isDependabot(user: GhUser | null): boolean {
	if (!user) return false;
	return (
		user.login === 'dependabot[bot]' || (user.type === 'Bot' && /^dependabot/.test(user.login))
	);
}

const labelsOf = (pull: GhPull): string[] => (pull.labels ?? []).map((l) => l.name);

/** A PR whose head is not a branch of this repository. */
const isFork = (pull: GhPull): boolean => pull.head.repo?.full_name !== repo();

/** The files of a change that make the harness's report — where they are, or were (a rename). */
export function harnessFilesOf(files: { path: string; previousPath: string | null }[]): string[] {
	return files
		.flatMap((f) => [f.path, ...(f.previousPath ? [f.previousPath] : [])])
		.filter((p) => HARNESS_SOURCES.some((re) => re.test(p)));
}

/** Every file of a PR, paged; `truncated` when GitHub's own limit cut the list. */
async function pullFiles(
	app: GithubApp,
	number: number,
): Promise<{ files: GhFile[]; truncated: boolean }> {
	const files: GhFile[] = [];
	for (let page = 1; page <= MAX_FILES / PAGE; page++) {
		const batch = await app.json<GhFile[]>(
			`/repos/${repo()}/pulls/${number}/files?per_page=${PAGE}&page=${page}`,
		);
		files.push(...batch);
		if (batch.length < PAGE) break;
	}
	return { files, truncated: files.length >= MAX_FILES };
}

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
 * Check 1: the check runs grouped by the workflow that ran them (`check_suite.id` → workflow
 * run); a check another App posts groups under that App's name. Order: as GitHub lists them.
 * The harness's own jobs (by its workflow file, not its name) are left out — they are Check 2: its
 * `report` job exits non-zero on a failed verdict by design, and the verdict is the `current-games`
 * status, which an approval can turn green. Counting those jobs here would hold a change Blocked
 * after every diff was approved. A workflow a PR adds under the same name stays in Check 1.
 */
export function groupCheckRuns(
	checkRuns: GhCheckRun[],
	workflowRuns: GhWorkflowRun[],
): CheckGroup[] {
	const bySuite = new Map(workflowRuns.map((r) => [r.check_suite_id, r]));
	const groups = new Map<string, CheckGroup>();
	for (const run of checkRuns) {
		const workflow = run.check_suite ? bySuite.get(run.check_suite.id) : undefined;
		if (workflow?.path === HARNESS_WORKFLOW_PATH) continue;
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
			};
			groups.set(name, group);
		}
		group.jobs.push({
			name: run.name,
			state: checkState(run.status, run.conclusion),
			conclusion: run.conclusion,
			url: run.html_url,
		});
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
		/(?:^|\n)[ \t]*(?:\*\*why:?\*\*:?|__why:?__:?|why:)[ \t]*([^\n]+(?:\n(?![ \t]*\n)[^\n]+)*)/i.exec(
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
 * The harness run that owns this head's status: the one the harness's own workflow file made for
 * the PR, from this repository, on this head. Not a push run (it stands down when the PR exists)
 * and not a run that merely carries the name.
 */
const harnessRunOf = (head: Head, sha: string): GhWorkflowRun | null =>
	head.workflowRuns.find(
		(r) =>
			r.path === HARNESS_WORKFLOW_PATH &&
			r.event === 'pull_request' &&
			r.head_sha === sha &&
			r.repository?.full_name === repo() &&
			r.head_repository?.full_name === repo(),
	) ?? null;

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
const listFlight = createSingleFlight();

/** Every open PR into `main`, bar Director games; Dependabot's apart. */
export function listChanges(app: GithubApp = githubApp): Promise<ChangeList> {
	if (listCache && Date.now() - listCache.at < LIST_TTL_MS) return Promise.resolve(listCache.list);
	// Tabs opening together share one read: each PR costs four GitHub calls.
	return listFlight('list', () => readChanges(app));
}

async function readChanges(app: GithubApp): Promise<ChangeList> {
	const r = repo();
	const open = (await openPulls(app)).filter((p) => !labelsOf(p).includes(DIRECTOR_GAME_LABEL));
	const pulls = open.filter((p) => !isFork(p));
	const summaries = await mapWithConcurrency(pulls, PER_CHANGE_CONCURRENCY, async (listed) => {
		// The list omits mergeability; the PR itself carries it.
		const [pull, head] = await Promise.all([
			app.json<GhPull>(`/repos/${r}/pulls/${listed.number}`),
			readHead(app, listed.head.sha),
		]);
		return summaryOf(pull, head);
	});
	const list: ChangeList = {
		changes: [],
		dependabot: [],
		forksSkipped: open.length - pulls.length,
		fetchedAt: new Date().toISOString(),
	};
	summaries.forEach((s, i) =>
		(isDependabot(pulls[i].user) ? list.dependabot : list.changes).push(s),
	);
	listCache = { at: Date.now(), list };
	return list;
}

/** The PR behind a change number, or the 404 that says why it is not a change. */
async function readPull(number: number, app: GithubApp): Promise<GhPull> {
	const res = await app.fetch(`/repos/${repo()}/pulls/${number}`);
	if (res.status === 404) throw error(404, `There is no change #${number}.`);
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { message?: string } | null;
		throw error(502, `GitHub ${res.status}: ${body?.message ?? res.statusText}`);
	}
	const pull = (await res.json()) as GhPull;
	if (pull.base.ref !== BASE_BRANCH || labelsOf(pull).includes(DIRECTOR_GAME_LABEL)) {
		throw error(404, `#${number} is not a pipeline change.`);
	}
	if (isFork(pull)) {
		throw error(
			404,
			`#${number} is from a fork; pipeline changes come from this repository's branches.`,
		);
	}
	return pull;
}

/** One change in full: files, why, Check 1, Check 2 with its approvals. Always fresh. */
export async function getChange(number: number, app: GithubApp = githubApp): Promise<ChangeDetail> {
	const r = repo();
	const pull = await readPull(number, app);
	const sha = pull.head.sha;
	const [head, { files, truncated }] = await Promise.all([
		readHead(app, sha),
		pullFiles(app, number),
	]);
	const run = harnessRunOf(head, sha);
	const status = harnessStatusOf(head);
	const [report, approvals] = await Promise.all([
		loadHarnessReport(app, r, run, sha, status),
		listApprovals(sha),
	]);
	const diffs = visibleDiffs(report);
	const changeFiles: ChangeFile[] = files.map((f) => ({
		path: f.filename,
		previousPath: f.previous_filename ?? null,
		status: f.status,
		additions: f.additions,
		deletions: f.deletions,
		url: f.blob_url ?? null,
	}));
	const harnessFiles = harnessFilesOf(changeFiles);
	const unapprovable = truncated
		? `This change has more files than GitHub lists (${MAX_FILES}), so what it edits cannot be checked: it needs a manual merge after review.`
		: harnessFiles.length
			? `This change edits the harness (${harnessFiles.slice(0, 3).join(', ')}${harnessFiles.length > 3 ? ', …' : ''}), so its report proves nothing about it: harness changes need a manual merge after review.`
			: unapprovableReason(report, diffs);
	const standing = await standingOf(approvals);
	const counted = countApprovals(diffs, approvals, standing);
	return {
		...summaryOf(pull, head),
		state: pull.state,
		body: pull.body,
		why: whyFromBody(pull.body),
		baseBranch: pull.base.ref,
		mergeableState: pull.mergeable_state ?? null,
		files: changeFiles,
		filesTruncated: truncated,
		checks: groupCheckRuns(head.checkRuns, head.workflowRuns),
		harness: {
			status,
			run: run && {
				id: run.id,
				url: run.html_url,
				status: run.status,
				conclusion: run.conclusion,
				attempt: run.run_attempt ?? 1,
			},
			report,
			diffs: diffs.map((d) => ({ ...d, approval: counted.get(d.id) ?? null })),
			approvals: approvals.map((a) => ({ ...a, standing: standing.has(a.approverId) })),
			unapprovable,
		},
	};
}

/**
 * The approval that counts for each diff: the newest by an approver in standing, or none. The
 * detail and the post count the same way.
 */
function countApprovals(
	diffs: HarnessDiff[],
	rows: PipelineApproval[],
	standing: Set<string>,
): Map<string, PipelineApproval> {
	const counted = new Map<string, PipelineApproval>();
	for (const d of diffs) {
		const row = rows.find((a) => a.diffId === d.id && standing.has(a.approverId));
		if (row) counted.set(d.id, row);
	}
	return counted;
}

/**
 * The approvers among `rows` who hold `pipelineMerge` TODAY: an approval from an account that
 * has since lost the capability, been disabled, expired or deleted no longer counts, so a set
 * is complete only by the people entitled to complete it at the moment it is posted.
 */
async function standingOf(rows: PipelineApproval[]): Promise<Set<string>> {
	const standing = new Set<string>();
	const accounts = await getApprovers([...new Set(rows.map((a) => a.approverId))]);
	for (const [id, account] of accounts) {
		if (!account.active) continue;
		if (account.expiresAt && account.expiresAt.getTime() <= Date.now()) continue;
		const [roleOverrides, overrides] = await Promise.all([
			getRoleOverrides(account.role),
			getToolOverrides(id),
		]);
		if (roleHasCapability(account.role, PIPELINE_MERGE_CAPABILITY, roleOverrides, overrides)) {
			standing.add(id);
		}
	}
	return standing;
}

export interface ReportEntry {
	body: ReadableStream<Uint8Array>;
	contentType: string;
}

const CONTENT_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
};

interface ReportImagesEntry {
	at: number;
	images: ReportImages | null;
	/** The paths the report names: the whole set the launcher serves. */
	paths: Set<string>;
}

/** A detail opens every changed screen's three images at once; the walk from the change's number
 *  to its report (the PR, its head, the artifacts) is done once for all of them. */
const IMAGES_TTL_MS = 30_000;
const IMAGES_CACHE_SIZE = 64;
const imagesCache = new Map<number, ReportImagesEntry>();
const imagesFlight = createSingleFlight();

/** The images artifact and image list of a change's ready report, or the 404 that says why not. */
async function reportImagesOf(number: number, app: GithubApp): Promise<ReportImagesEntry> {
	const fresh = (e: ReportImagesEntry | undefined): e is ReportImagesEntry =>
		e !== undefined && Date.now() - e.at < IMAGES_TTL_MS;
	const hit = imagesCache.get(number);
	if (fresh(hit)) return hit;
	return imagesFlight(String(number), async () => {
		const landed = imagesCache.get(number);
		if (fresh(landed)) return landed;
		const pull = await readPull(number, app);
		const sha = pull.head.sha;
		const head = await readHead(app, sha);
		const run = harnessRunOf(head, sha);
		const report = await loadHarnessReport(app, repo(), run, sha, harnessStatusOf(head));
		if (report.state !== 'ready') throw error(404, report.detail);
		const entry = { at: Date.now(), images: report.images, paths: reportImagePaths(report.report) };
		if (imagesCache.size >= IMAGES_CACHE_SIZE) {
			imagesCache.delete(imagesCache.keys().next().value as number);
		}
		imagesCache.set(number, entry);
		return entry;
	});
}

/**
 * One image of a change's current-games report — a changed screen before, after or as a diff —
 * streamed out of the run's full artifact. Served only when the report the detail shows is ready
 * and names that exact path (`reportImagePaths`): the report's own list is the whitelist, so no
 * path reaches the archive that the harness did not write. `artifact`, when the caller names the
 * artifact it read the report from, must still be the current one: a re-run replaces it (409).
 */
export async function getReportEntry(
	input: { number: number; path: string; artifact: number | null },
	app: GithubApp = githubApp,
): Promise<ReportEntry> {
	let report = await reportImagesOf(input.number, app);
	// The detail hands out a new artifact id the moment a push or a re-run lands; the walk cached
	// here may still name the old one for a while, so a mismatch is looked up again, once, before
	// it is called a replaced artifact.
	if (input.artifact !== null && input.artifact !== report.images?.artifactId) {
		imagesCache.delete(input.number);
		report = await reportImagesOf(input.number, app);
	}
	if (!report.paths.has(input.path)) {
		throw error(404, 'The report has no such image.');
	}
	if (!report.images) {
		throw error(
			404,
			'The screen images are gone: GitHub keeps them for 3 days. The report still lists the differences; a new push makes new images.',
		);
	}
	if (input.artifact !== null && input.artifact !== report.images.artifactId) {
		throw error(409, 'The report was replaced by a re-run of current-games; reload the change.');
	}
	let body: ReadableStream<Uint8Array> | null;
	try {
		body = await openReportEntry(app, repo(), report.images, input.path, report.paths);
	} catch (err) {
		if (err instanceof GithubAppError) throw err;
		throw error(
			502,
			`The report artifact could not be read: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	if (!body) throw error(404, 'The report artifact holds no such image.');
	const ext = /\.([a-z0-9]+)$/i.exec(input.path)?.[1]?.toLowerCase() ?? '';
	return { body, contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream' };
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
 * How an approver is named on GitHub and in the row: the account's name, else the local part of
 * its email. The repository is public, so never the address itself.
 */
export function approverName(user: { name: string | null; email: string }): string {
	return user.name?.trim() || user.email.split('@')[0];
}

/** Approvals on one head run one at a time, so the last two cannot both post the status. */
const approving = createKeyedMutex();

/**
 * Approve one changed screen (ADR-0007 "Diff approval"). The caller has passed the
 * `pipelineMerge` gate. When this approval completes the set on the head — and only a run whose
 * sole failures are changed screens can be completed — `success` goes to the `current-games`
 * context on that exact SHA, naming the approvers, once: a context already green is left alone.
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
	return approving(sha, async () => {
		const change = await getChange(input.number, app);
		if (sha !== change.headSha) {
			throw error(
				409,
				`This change has a new head (${change.headSha.slice(0, 7)}); approvals on ${sha.slice(0, 7)} are void.`,
			);
		}
		const { harness } = change;
		if (harness.report.state !== 'ready') throw error(409, harness.report.detail);
		if (change.filesTruncated || harnessFilesOf(change.files).length) {
			throw error(409, harness.unapprovable ?? 'This change edits the harness.');
		}
		if (!harness.diffs.some((d) => d.id === input.diffId)) {
			throw error(404, 'No such changed screen on this head.');
		}
		const approval = await recordApproval({
			diffId: input.diffId,
			prNumber: input.number,
			headSha: sha,
			approverId: input.user.id,
			approver: approverName(input.user),
			note: input.note,
		});
		listCache = null;
		const ids = new Set(harness.diffs.map((d) => d.id));
		const recorded = (await listApprovals(sha)).filter((a) => ids.has(a.diffId));
		const standing = await standingOf(recorded);
		const counted = countApprovals(harness.diffs, recorded, standing);
		const done = counted.size;
		const of = harness.diffs.length;
		let statusPosted = false;
		let withheld: string | null = null;
		if (done < of) {
			// Diffs with an approval on record that no longer counts: say whose, rather than leave
			// a set that looks complete with nothing posted.
			const lapsed = recorded.filter((a) => !counted.has(a.diffId) && !standing.has(a.approverId));
			if (lapsed.length) {
				const who = [...new Set(lapsed.map((a) => a.approver))].join(', ');
				const screens = [...new Set(lapsed.map((a) => a.diffId.split(':')[2]))].join(', ');
				withheld = `The approval of ${screens} by ${who} no longer counts: ${who} no longer holds "Merge pipeline changes". Someone who does must approve it again.`;
			}
		}
		if (done === of && !harness.unapprovable && harness.status?.state !== 'success') {
			withheld = harness.run
				? await harnessJobsBlocker(app, repo(), harness.run.id, harness.run.attempt)
				: 'No harness run of this repository on this head.';
		}
		if (done === of && !harness.unapprovable && harness.status?.state !== 'success' && !withheld) {
			const approvers = [...new Set([...counted.values()].map((a) => a.approver))].join(', ');
			const description =
				`All ${of} changed screen${of === 1 ? '' : 's'} approved by ${approvers}`.slice(0, 140);
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
		return { approval, approved: done, of, statusPosted, withheld };
	});
}
