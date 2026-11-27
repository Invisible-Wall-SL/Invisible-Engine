/**
 * Contract check for Resolve conflict (ADR-0015, card 15C):
 *   pnpm --filter launcher-api check:merge-main-runs
 *
 * Runs the REAL modules — `$lib/mergeMainRuns.ts`, `pipelineMergeRuns.ts` (start, result, accept,
 * discard), `pipelineMergeRunsResult.ts` (the §10 parser and the rules on the files),
 * `pipelineMergeRunsBuild.ts` (the three-tree build), `pipelineMergeRunsActions.ts` (dispatch, the
 * workflow check, the backstop), `bugFixRuns.ts` (the OIDC claims every job shares), `githubOidc.ts`
 * (its verification, against keys this fixture makes), the five routes and the page's `view.ts` —
 * with the database, the settings, the prices, the pull request reads and the bug stores replaced at
 * their seams, a fake GitHub App that holds a small git (commits, trees, blobs, refs) and records
 * every call in order, a fake JWKS transport, and a fake clock.
 *
 * Pinned (each rule with a planted case):
 *  - Start: the refusals in ADR-0015 §4's order with their codes (no active workflow, closed, not in
 *    conflict, on hold, a live run, a reused request id), a fork a 404, a spent month still
 *    dispatching, the four public inputs and no others, a refused dispatch ending the run;
 *  - the job's token: every claim of a merge run's, the audience, first contact binding once;
 *  - §10: the parser (every unknown field, enum, sha and cap), the cleaning and scan of every text,
 *    each outcome's status, the spend (once per model, counted toward the monthly ceiling), a
 *    second result, a result for a run that ended, the budget spent;
 *  - the rules on the files: protected paths (but docs-append), lockfiles, hidden text, size, the
 *    rule/path/choice agreement;
 *  - the backstop: a run that never started, timed out, was cancelled, or ended without a result;
 *  - Accept: a path neither side changed is untouchable, one only one side changed takes that side,
 *    only both-changed paths take the run's content; parents, message, a fast-forward
 *    ref update with force false; stale on a moved head or a conflicted file main changed; a push
 *    over a workflow file refused by GitHub ends needs_person; a fix-run branch's decision untouched;
 *  - Discard, the page's decisions and its source (text, never HTML), the migration, the setting.
 */
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { error as httpError, isHttpError } from '@sveltejs/kit';
import { parsePricing } from 'director-costs';
import * as realGithubApp from '../src/lib/server/githubApp.ts';
import * as realOidc from '../src/lib/server/githubOidc.ts';
import type { MergeMainRun, MergeRunEnd } from '../src/lib/server/pipelineMergeRunsStore.ts';
import type { MergeRunFile, MergeRunRefusal, MergeRunStatus } from '../src/lib/mergeMainRuns.ts';

const REPO = 'Invisible-Wall-SL/Invisible-Engine';
process.env.GITHUB_ENGINE_REPO = REPO;
process.env.ORIGIN = 'https://app.example';

const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
const text = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

let checks = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	console.error(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
}

function exportNames(rel: string): string[] {
	const source = readFileSync(fileURLToPath(src(rel)), 'utf8');
	const names = new Set<string>();
	for (const m of source.matchAll(/^export (?:async )?(?:function\*?|class|const|let) (\w+)/gm)) {
		names.add(m[1]);
	}
	return [...names];
}
function fake(rel: string, impl: Record<string, unknown>): void {
	const namedExports: Record<string, unknown> = {};
	for (const name of exportNames(rel)) {
		namedExports[name] =
			name in impl
				? impl[name]
				: () => {
						throw new Error(`fixture: ${rel} ${name} is not faked`);
					};
	}
	for (const name of Object.keys(impl)) {
		if (!(name in namedExports)) throw new Error(`fixture: ${rel} has no export ${name}`);
	}
	mock.module(src(rel), { namedExports });
}

// ── The clock ─────────────────────────────────────────────────────────────────
let clock = Date.now();
const tick = () => new Date((clock += 1000));
const MIN = 60_000;

// ── Settings, prices, the bug stores ──────────────────────────────────────────
const settings = { monthly: 150, budget: 6 };
fake('lib/server/appSettings.ts', {
	getPipelineFixBudget: async () => 15,
	getPipelineDiagnoseBudget: async () => 5,
	getPipelineMergeMainBudget: async () => settings.budget,
	getPipelineFixMonthlyCap: async () => settings.monthly,
});
const PRICING = parsePricing({
	currency: 'USD',
	perMTok: {
		'claude-opus-5-5': { input: 4, output: 20 },
		'claude-haiku-x': { input: 1, output: 5 },
	},
	cacheReadMultiplier: 0.1,
	cacheWriteMultiplier: 1.25,
	runpod: {
		placeholder: true,
		perSecondByGpu: {},
		seedSecondsPerRender: 1,
		seedDelaySecondsPerJob: 1,
	},
});
fake('lib/server/costs/pricingConfig.ts', {
	getDirectorPricing: async () => ({ pricing: PRICING, source: 'file' }),
});
interface Spend {
	runId: string;
	agent: string;
	model: string;
	usd: number;
	requestId: string;
	at: Date;
}
const ledger: Spend[] = [];
/** The fix-run records the decision gate reads (ADR-0014): this fixture only reads them. */
const fixRecords = {
	runs: [] as { id: string; bugNumber: number; prNumber: number | null; status: string }[],
	decisions: [] as { id: number; data: Record<string, unknown> }[],
	reads: 0,
};
fake('lib/server/bugFixRunsStore.ts', {
	fixSpendSince: async (since: Date, agent: string) =>
		ledger.filter((s) => s.agent === agent && s.at >= since).reduce((t, s) => t + s.usd, 0),
	getFixRun: async (id: string) => {
		fixRecords.reads++;
		return fixRecords.runs.find((r) => r.id === id) ?? null;
	},
	allFixRunsOfBug: async (n: number) => fixRecords.runs.filter((r) => r.bugNumber === n),
	fixDecisionsOfBug: async () => fixRecords.decisions,
	liveFixRuns: async () => [],
});
fake('lib/server/bugReports.ts', {});
fake('lib/server/bugReportsStore.ts', {});
fake('lib/server/director/mockupPixels.ts', {});
fake('lib/server/projects.ts', {
	DEFAULT_PROJECT_KEY: 'cloud',
	accessibleProjects: async () => [],
});
fake('lib/server/roleToolAccess.ts', { getRoleOverrides: async () => ({}) });
fake('lib/server/userToolAccess.ts', { getToolOverrides: async () => ({}) });

// ── The merge runs, in memory ─────────────────────────────────────────────────
const runs: MergeMainRun[] = [];
const LIVE: MergeRunStatus[] = ['dispatched', 'running', 'proposed', 'accepting'];
const WORKING: MergeRunStatus[] = ['dispatched', 'running'];
const runOf = (id: string): MergeMainRun => runs.find((r) => r.id === id)!;
const copy = (r: MergeMainRun): MergeMainRun => ({ ...r });
let claims = 0;
const store = {
	getMergeRun: async (id: string) => {
		const r = runs.find((x) => x.id === id);
		return r ? copy(r) : null;
	},
	getMergeRunByRequest: async (requestId: string) => {
		const r = runs.find((x) => x.requestId === requestId);
		return r ? copy(r) : null;
	},
	mergeRunsOfPr: async (pr: number, limit = 10) =>
		runs
			.filter((r) => r.prNumber === pr)
			.sort((a, b) => +b.createdAt - +a.createdAt)
			.slice(0, limit)
			.map(copy),
	workingMergeRuns: async () =>
		runs
			.filter((r) => WORKING.includes(r.status))
			.sort((a, b) => +a.createdAt - +b.createdAt)
			.map(copy),
	insertMergeRun: async (
		values: Omit<MergeMainRun, never> & Record<string, unknown>,
		decide: (live: string | null) => MergeRunRefusal | null,
	) => {
		const prior = runs.find((r) => r.requestId === values.requestId);
		if (prior) return { kind: 'exists', run: copy(prior) };
		const live = runs.find((r) => r.prNumber === values.prNumber && LIVE.includes(r.status));
		const refused = decide(live?.id ?? null);
		if (refused) return { kind: 'refused', code: refused };
		if (live) return { kind: 'refused', code: 'merge_run_live' };
		const at = tick();
		const run = {
			id: values.id,
			prNumber: values.prNumber,
			branch: values.branch,
			headSha: values.headSha,
			mainSha: values.mainSha,
			baseSha: null,
			status: 'dispatched',
			reason: null,
			files: null,
			explanation: null,
			mergeSha: null,
			spendUsd: null,
			ghRunId: null,
			startedById: values.startedById,
			startedBy: values.startedBy,
			acceptedById: null,
			acceptedBy: null,
			requestId: values.requestId,
			resultAt: null,
			acceptSha: null,
			acceptingAt: null,
			acceptClaim: null,
			createdAt: at,
			updatedAt: at,
			finishedAt: null,
		} as MergeMainRun;
		runs.push(run);
		return { kind: 'created', run: copy(run) };
	},
	bindMergeRun: async (id: string, ghRunId: number) => {
		if (runs.some((r) => r.ghRunId === ghRunId)) return 'taken';
		const r = runOf(id);
		if (r.ghRunId !== null || r.status !== 'dispatched') return 'stale';
		r.ghRunId = ghRunId;
		return 'bound';
	},
	markMergeRunRunning: async (id: string) => {
		const r = runOf(id);
		if (r.status === 'dispatched') r.status = 'running';
	},
	settleMergeRun: async (
		id: string,
		from: readonly MergeRunStatus[],
		end: MergeRunEnd,
		opts: { result?: boolean; claim?: string } = {},
	) => {
		const r = runs.find((x) => x.id === id);
		if (!r || !from.includes(r.status)) return null;
		if (opts.claim !== undefined && r.acceptClaim !== opts.claim) return null;
		const at = tick();
		const wasDispatched = r.status === 'dispatched';
		r.status = end.status;
		r.reason = end.reason ?? null;
		if (end.files !== undefined) r.files = end.files;
		if (end.explanation !== undefined) r.explanation = end.explanation;
		if (end.mergeSha !== undefined) r.mergeSha = end.mergeSha;
		if (end.baseSha !== undefined) r.baseSha = end.baseSha;
		if (end.acceptedBy) {
			r.acceptedById = end.acceptedBy.id;
			r.acceptedBy = end.acceptedBy.name;
		}
		if (opts.result) r.resultAt = at;
		if (wasDispatched) r.spendUsd = r.spendUsd ?? 0;
		r.finishedAt = end.status === 'proposed' ? null : at;
		r.updatedAt = at;
		return copy(r);
	},
	/** The database's clock, here the fixture's: a claim is lapsed after `leaseMs` of real time. */
	claimAccept: async (id: string, person: { id: string; name: string }, leaseMs: number) => {
		const r = runs.find((x) => x.id === id);
		if (!r) return null;
		const lapsed = r.status === 'accepting' && +(r.acceptingAt ?? 0) < Date.now() - leaseMs;
		if (r.status !== 'proposed' && !lapsed) return null;
		r.status = 'accepting';
		r.acceptingAt = new Date();
		r.acceptClaim = `claim-${++claims}`;
		if (r.acceptSha === null) {
			r.acceptedById = person.id;
			r.acceptedBy = person.name;
		}
		return copy(r);
	},
	recordAcceptSha: async (
		id: string,
		claim: string,
		sha: string,
		person: { id: string; name: string },
		leaseMs: number,
		minLeftMs: number,
	) => {
		const r = runOf(id);
		if (r.status !== 'accepting' || r.acceptClaim !== claim) return false;
		if (+(r.acceptingAt ?? 0) <= Date.now() - (leaseMs - minLeftMs)) return false;
		r.acceptSha = sha;
		r.acceptedById = person.id;
		r.acceptedBy = person.name;
		return true;
	},
	releaseAccept: async (id: string, claim: string) => {
		const r = runOf(id);
		if (r.status !== 'accepting' || r.acceptClaim !== claim) return;
		Object.assign(r, {
			status: 'proposed',
			acceptingAt: null,
			acceptClaim: null,
			acceptSha: null,
			acceptedById: null,
			acceptedBy: null,
		});
	},
	releaseLapsedAccept: async (id: string, leaseMs: number) => {
		const r = runOf(id);
		if (r.status !== 'accepting' || r.acceptSha !== null) return false;
		if (+(r.acceptingAt ?? 0) >= Date.now() - leaseMs) return false;
		Object.assign(r, {
			status: 'proposed',
			acceptingAt: null,
			acceptClaim: null,
			acceptedById: null,
			acceptedBy: null,
		});
		return true;
	},
	lapsedAccepts: async (leaseMs: number) =>
		runs
			.filter((r) => r.status === 'accepting' && +(r.acceptingAt ?? 0) < Date.now() - leaseMs)
			.map(copy),
	recordMergeRunSpend: async (
		id: string,
		agent: string,
		rows: { model: string; usd: number }[],
	) => {
		const runId = `merge:${id}`;
		const models = new Set([
			...ledger.filter((s) => s.runId === runId).map((s) => s.model),
			...rows.map((r) => r.model),
		]);
		if (models.size > 10) return null;
		for (const r of rows) {
			const requestId = `${runId}:${r.model}`;
			if (!ledger.some((s) => s.requestId === requestId)) {
				ledger.push({ runId, agent, model: r.model, usd: r.usd, requestId, at: tick() });
			}
		}
		const total = ledger.filter((s) => s.runId === runId).reduce((t, s) => t + s.usd, 0);
		runOf(id).spendUsd = total;
		return total;
	},
};
fake('lib/server/pipelineMergeRunsStore.ts', store);

// ── GitHub: the App, holding a small git ──────────────────────────────────────
const BOT = 'invisible-pipeline[bot]';
interface Call {
	method: string;
	path: string;
	body: Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
}
interface Pull {
	number: number;
	title: string;
	state: string;
	merged: boolean;
	labels: { name: string }[];
	mergeable_state: string;
	mergeable: boolean | null;
	head: { sha: string; ref: string; repo: { full_name: string } | null };
	fork: boolean;
}
type Entry = { mode: string; type: string; sha: string };
const git = {
	blobs: new Map<string, string>(),
	trees: new Map<string, Map<string, Entry>>(),
	commits: new Map<string, { tree: string; parents: string[]; date: string; message?: string }>(),
	refs: new Map<string, string>(),
	n: 0,
};
const fresh = (): string => (++git.n).toString(16).padStart(40, '0');
const blobSha = (content: string): string => {
	// the build module's own function: the fixture asks it, so a choice's content check is the real one
	return built.blobSha(content);
};
function putBlob(content: string): string {
	const sha = blobSha(content);
	git.blobs.set(sha, content);
	return sha;
}
function putTree(files: Record<string, string | { content: string; mode: string }>): string {
	const tree = new Map<string, Entry>();
	for (const [path, v] of Object.entries(files)) {
		const content = typeof v === 'string' ? v : v.content;
		tree.set(path, {
			mode: typeof v === 'string' ? '100644' : v.mode,
			type: 'blob',
			sha: putBlob(content),
		});
	}
	const sha = fresh();
	git.trees.set(sha, tree);
	return sha;
}
function putCommit(
	tree: string,
	parents: string[],
	date = new Date(clock).toISOString(),
	message?: string,
): string {
	const sha = fresh();
	git.commits.set(sha, { tree, parents, date, message });
	return sha;
}
const filesOfCommit = (sha: string) => git.trees.get(git.commits.get(sha)!.tree)!;

const gh = {
	calls: [] as Call[],
	missing: null as string | null,
	workflow: { status: 200, state: 'active' } as { status: number; state: string },
	pulls: new Map<number, Pull>(),
	dispatch: (() => answer(200, { workflow_run_id: 9001 })) as (body: Call['body']) => Response,
	actionsRuns: new Map<
		number,
		{
			id: number;
			display_title: string;
			path: string;
			status: string;
			conclusion: string | null;
			actor: { login: string };
			created_at: string;
		}
	>(),
	listed: [] as unknown[],
	cancelStatus: 202,
	/** `METHOD /path` → refuse once with this status and message. */
	fail: new Map<string, { status: number; message: string }[]>(),
	/** How many files the compare lists, when `main` moved too far for them to be judged whole. */
	compareTooLong: 0,
	/** The compare answers with no `files` at all. */
	compareNoFiles: false,
	/** Runs once, just before a ref update is judged: another replica getting there first. */
	beforePatch: null as (() => void) | null,
	/** Runs once, just before a commit is made: the claim's lease running out or being taken over. */
	beforeCommit: null as (() => void) | null,
	truncatedTrees: new Set<string>(),
	madeCommits: [] as (Record<string, any> & { sha: string })[], // eslint-disable-line @typescript-eslint/no-explicit-any
	/** The merge base GitHub names for any compare of a head with main. */
	mergeBase: '' as string,
};
function answer(status: number, body: unknown, headers: Record<string, string> = {}): Response {
	return new Response(status === 204 ? null : JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...headers },
	});
}
const prefix = `/repos/${REPO}`;

function route(method: string, path: string, body: Call['body']): Response {
	const p = path.startsWith(prefix) ? path.slice(prefix.length) : path;
	if (p === '/actions/workflows/merge-main.yml') {
		return gh.workflow.status === 200
			? answer(200, { state: gh.workflow.state })
			: answer(gh.workflow.status, { message: 'Not Found' });
	}
	if (p === '/actions/workflows/merge-main.yml/dispatches') return gh.dispatch(body);
	if (p.startsWith('/actions/workflows/merge-main.yml/runs')) {
		return answer(200, { workflow_runs: gh.listed });
	}
	let m = /^\/actions\/runs\/(\d+)\/cancel$/.exec(p);
	if (m) return answer(gh.cancelStatus, { message: 'x' });
	m = /^\/actions\/runs\/(\d+)$/.exec(p);
	if (m) {
		const run = gh.actionsRuns.get(Number(m[1]));
		return run ? answer(200, run) : answer(404, { message: 'Not Found' });
	}
	if (p === '/git/ref/heads/main') return answer(200, { object: { sha: git.refs.get('main') } });
	m = /^\/git\/ref\/heads\/(.+)$/.exec(p);
	if (m) {
		const sha = git.refs.get(m[1]);
		return sha ? answer(200, { object: { sha } }) : answer(404, { message: 'Not Found' });
	}
	m = /^\/git\/commits\/([0-9a-f]{40})$/.exec(p);
	if (m && method === 'GET') {
		const c = git.commits.get(m[1]);
		return c
			? answer(200, {
					sha: m[1],
					tree: { sha: c.tree },
					message: c.message ?? '',
					parents: c.parents.map((sha) => ({ sha })),
				})
			: answer(404, { message: 'Not Found' });
	}
	m = /^\/commits\/([0-9a-f]{40})$/.exec(p);
	if (m) {
		const c = git.commits.get(m[1]);
		return c
			? answer(200, { commit: { committer: { date: c.date } } })
			: answer(404, { message: 'x' });
	}
	m = /^\/git\/trees\/([0-9a-f]{40})\?recursive=1$/.exec(p);
	if (m) {
		const t = git.trees.get(m[1]);
		if (!t) return answer(404, { message: 'Not Found' });
		return answer(200, {
			truncated: gh.truncatedTrees.has(m[1]),
			tree: [...t].map(([path, e]) => ({ path, ...e })),
		});
	}
	m = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(p);
	if (m && method === 'GET') {
		const content = git.blobs.get(m[1]);
		return content === undefined
			? answer(404, { message: 'Not Found' })
			: answer(200, { content: Buffer.from(content).toString('base64'), encoding: 'base64' });
	}
	if (p === '/git/blobs' && method === 'POST') {
		return answer(201, { sha: putBlob(String(body?.content ?? '')) });
	}
	if (p === '/git/trees' && method === 'POST') {
		const base = new Map(git.trees.get(String(body?.base_tree)) ?? []);
		for (const e of (body?.tree ?? []) as {
			path: string;
			mode: string;
			type: string;
			sha: string | null;
		}[]) {
			if (e.sha === null) base.delete(e.path);
			else base.set(e.path, { mode: e.mode, type: e.type, sha: e.sha });
		}
		const sha = fresh();
		git.trees.set(sha, base);
		return answer(201, { sha });
	}
	if (p === '/git/commits' && method === 'POST') {
		gh.beforeCommit?.();
		gh.beforeCommit = null;
		const sha = putCommit(
			String(body?.tree),
			(body?.parents ?? []) as string[],
			undefined,
			String(body?.message ?? ''),
		);
		gh.madeCommits.push({ sha, ...(body as object) });
		return answer(201, { sha });
	}
	m = /^\/git\/refs\/heads\/(.+)$/.exec(p);
	if (m && method === 'PATCH') {
		const hook = gh.beforePatch;
		gh.beforePatch = null;
		hook?.();
		const current = git.refs.get(m[1]);
		const sha = String(body?.sha);
		if (current === undefined) return answer(404, { message: 'Reference does not exist' });
		if (body?.force !== false || !ancestor(current, sha)) {
			return answer(422, { message: 'Update is not a fast forward' });
		}
		git.refs.set(m[1], sha);
		const pull = [...gh.pulls.values()].find((x) => x.head.ref === m![1]);
		if (pull) pull.head.sha = sha;
		return answer(200, { object: { sha } });
	}
	m = /^\/compare\/([0-9a-f]{40})\.\.\.(main|[0-9a-f]{40})(\?.*)?$/.exec(p);
	if (m) {
		const from = m[1];
		const to = m[2] === 'main' ? git.refs.get('main')! : m[2];
		if (m[2] === 'main') {
			if (from === to)
				return answer(200, { status: 'identical', ahead_by: 0, behind_by: 0, files: [] });
			if (!ancestor(from, to)) return answer(200, { status: 'diverged', files: [] });
			const a = filesOfCommit(from);
			const b = filesOfCommit(to);
			const paths = [...new Set([...a.keys(), ...b.keys()])].filter(
				(path) => a.get(path)?.sha !== b.get(path)?.sha,
			);
			const files = gh.compareTooLong
				? Array.from({ length: gh.compareTooLong }, (_, i) => ({ filename: `many/${i}.txt` }))
				: paths.map((filename) => ({ filename }));
			const page = Number(/[?&]page=(\d+)/.exec(m[3] ?? '')?.[1] ?? 1);
			return answer(200, {
				status: 'ahead',
				ahead_by: depth(to) - depth(from),
				behind_by: 0,
				...(gh.compareNoFiles ? {} : { files: page === 1 ? files.slice(0, 300) : [] }),
			});
		}
		const status = from === to ? 'identical' : ancestor(from, to) ? 'ahead' : 'diverged';
		return answer(200, {
			status,
			merge_base_commit: { sha: gh.mergeBase },
			ahead_by: 1,
			behind_by: 1,
		});
	}
	return answer(404, { message: `fixture: no route for ${method} ${path}` });
}
const depth = (sha: string): number => {
	let n = 0;
	for (let c = git.commits.get(sha); c; c = git.commits.get(c.parents[0])) n++;
	return n;
};
function ancestor(a: string, b: string): boolean {
	const seen = new Set<string>();
	const stack = [b];
	while (stack.length) {
		const s = stack.pop()!;
		if (s === a) return true;
		if (seen.has(s)) continue;
		seen.add(s);
		stack.push(...(git.commits.get(s)?.parents ?? []));
	}
	return false;
}
const app = {
	missing: () => gh.missing,
	fetch: async (path: string, init: RequestInit = {}) => {
		const method = init.method ?? 'GET';
		const body = init.body ? (JSON.parse(String(init.body)) as Call['body']) : null;
		const call = { method, path: path.startsWith(prefix) ? path.slice(prefix.length) : path, body };
		gh.calls.push(call);
		const queued = gh.fail.get(`${method} ${call.path.replace(/\?.*$/, '')}`)?.shift();
		if (queued) return answer(queued.status, { message: queued.message });
		return route(method, path, body);
	},
	json: async <T>(path: string, init?: RequestInit): Promise<T> => {
		const res = await app.fetch(path, init);
		if (!res.ok) {
			const b = (await res.json().catch(() => null)) as { message?: string } | null;
			throw new realGithubApp.GithubAppError(`GitHub ${res.status}: ${b?.message}`, res.status);
		}
		return (await res.json()) as T;
	},
	download: async () => {
		throw new Error('not used');
	},
	slug: async () => 'invisible-pipeline',
};
fake('lib/server/githubApp.ts', { ...realGithubApp, githubApp: app });
const keyOf = (c: Call) => `${c.method} ${c.path.replace(/\?.*$/, '')}`;
const callsOf = () => gh.calls.map(keyOf);

// ── The change's reads (the Changes list's module, as far as these modules use it) ────────────────────
let changesForgotten = 0;
fake('lib/server/pipelineChanges.ts', {
	approverName: (user: { name: string | null; email: string }) =>
		user.name?.trim() || user.email.split('@')[0],
	forgetChanges: () => changesForgotten++,
	isOnHold: (pull: { labels?: { name: string }[] }) =>
		(pull.labels ?? []).some((l) => l.name === 'on-hold'),
	parseChangeNumber: (param: string) => {
		const n = Number(param);
		if (!Number.isInteger(n) || n <= 0)
			throw httpError(400, 'The change number must be a positive integer.');
		return n;
	},
	readPull: async (number: number) => {
		const pull = gh.pulls.get(number);
		if (!pull) throw httpError(404, `There is no change #${number}.`);
		if (pull.fork) {
			throw httpError(
				404,
				`#${number} is from a fork; pipeline changes come from this repository's branches.`,
			);
		}
		return {
			...pull,
			head: { ...pull.head },
			html_url: `https://github.com/${REPO}/pull/${number}`,
		};
	},
});

// ── GitHub OIDC: a key of our own, served as GitHub's JWKS ────────────────────
const KID = 'fixture-key';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwksTransport = (async () =>
	new Response(
		JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig' }] }),
		{ status: 200 },
	)) as typeof fetch;
const oidc = realOidc.createGithubOidc({ transport: jwksTransport, now: () => clock });
fake('lib/server/githubOidc.ts', { ...realOidc, githubOidc: oidc });

const WORKFLOW = `${REPO}/.github/workflows/merge-main.yml@refs/heads/main`;
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
function token(
	claims: Record<string, unknown> = {},
	aud = 'invisible-launcher-merge-main',
): string {
	const now = Math.floor(clock / 1000);
	const head = b64({ alg: 'RS256', typ: 'JWT', kid: KID });
	const payload = b64({
		iss: 'https://token.actions.githubusercontent.com',
		aud,
		exp: now + 300,
		nbf: now - 5,
		iat: now - 5,
		repository: REPO,
		workflow_ref: WORKFLOW,
		job_workflow_ref: WORKFLOW,
		ref: 'refs/heads/main',
		event_name: 'workflow_dispatch',
		actor: BOT,
		environment: 'bug-fix',
		run_id: '9001',
		run_attempt: '1',
		runner_environment: 'github-hosted',
		...claims,
	});
	const sig = createSign('RSA-SHA256')
		.update(`${head}.${payload}`)
		.sign(privateKey as KeyObject, 'base64url');
	return `${head}.${payload}.${sig}`;
}

// ── The modules under test ────────────────────────────────────────────────────
const shared = await import(src('lib/mergeMainRuns.ts'));
const built = await import(src('lib/server/pipelineMergeRunsBuild.ts'));
const parsed = await import(src('lib/server/pipelineMergeRunsResult.ts'));
const server = await import(src('lib/server/pipelineMergeRuns.ts'));
const actions = await import(src('lib/server/pipelineMergeRunsActions.ts'));
const change = await import(src('lib/server/bugFixRunsChange.ts'));
const view = await import(src('routes/(app)/pipeline/view.ts'));
const resolveRoute = await import(src('routes/api/pipeline/changes/[number]/resolve/+server.ts'));
const listRoute = await import(src('routes/api/pipeline/changes/[number]/merge-runs/+server.ts'));
const acceptRoute = await import(
	src('routes/api/pipeline/changes/[number]/merge-runs/[id]/accept/+server.ts')
);
const discardRoute = await import(
	src('routes/api/pipeline/changes/[number]/merge-runs/[id]/discard/+server.ts')
);
const resultRoute = await import(src('routes/api/pipeline/merge-runs/[id]/result/+server.ts'));

type Json = Record<string, unknown>;
type Answer = { status: number; body: Json };
async function answered(run: () => Promise<Response | Json>): Promise<Answer> {
	try {
		const res = await run();
		if (!(res instanceof Response)) return { status: 200, body: res };
		return { status: res.status, body: (await res.json()) as Json };
	} catch (err) {
		if (isHttpError(err)) {
			return { status: err.status, body: { error: err.body.message, code: err.body.code } };
		}
		throw err;
	}
}
function request(init: { json?: unknown; raw?: Uint8Array; headers?: Record<string, string> }) {
	const body = init.raw ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined);
	return new Request('https://app.example/api/x', {
		method: body !== undefined ? 'POST' : 'GET',
		headers: {
			...(body !== undefined ? { 'content-type': 'application/json' } : {}),
			...init.headers,
		},
		body,
	});
}
interface TestUser {
	id: string;
	email: string;
	name: string | null;
	role: 'admin' | 'developer' | 'artist' | 'pipelineTester';
}
const ADMIN: TestUser = {
	id: 'u-admin',
	email: 'boss@example.com',
	name: 'Gualtiero',
	role: 'admin',
};
const OTHER_ADMIN: TestUser = {
	id: 'u-admin2',
	email: 'two@example.com',
	name: 'Two',
	role: 'admin',
};
const TESTER: TestUser = {
	id: 'u-tester',
	email: 'tess@example.com',
	name: 'Tess',
	role: 'pipelineTester',
};
const DEV: TestUser = { id: 'u-dev', email: 'dev@example.com', name: 'Dana', role: 'developer' };
const SKIPPER: TestUser = {
	id: 'u-skip',
	email: 'skip@example.com',
	name: 'Ann [skip ci] [skip [skip ci]ci]',
	role: 'admin',
};
const call = (
	handler: (event: unknown) => Promise<Response>,
	init: {
		user?: TestUser | null;
		params?: Record<string, string>;
		json?: unknown;
		raw?: Uint8Array;
		headers?: Record<string, string>;
	},
) =>
	answered(() =>
		handler({
			locals: { user: init.user ?? null },
			params: init.params ?? {},
			request: request(init),
			url: new URL('https://app.example/api/x'),
		}),
	);
let requestCount = 0;
const newRequest = () => `req-merge-${++requestCount}`;
const resolve = (user: TestUser | null, n: number, requestId = newRequest()) =>
	call(resolveRoute.POST, { user, params: { number: String(n) }, json: { requestId } });
const accept = (user: TestUser, n: number, id: string, headSha: string) =>
	call(acceptRoute.POST, { user, params: { number: String(n), id }, json: { headSha } });
const discard = (user: TestUser, n: number, id: string) =>
	call(discardRoute.POST, { user, params: { number: String(n), id } });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const post = (id: string, ghRunId: number, json: unknown, gzip = false) => {
	const body = JSON.stringify(json);
	return call(resultRoute.POST, {
		params: { id },
		raw: gzip ? gzipSync(body) : Buffer.from(body),
		headers: {
			...bearer(token({ run_id: String(ghRunId) })),
			...(gzip ? { 'content-encoding': 'gzip' } : {}),
		},
	});
};
const runIdOf = (a: Answer): string => (a.body.run as { id: string }).id;

// ── A world: a base, a head and a main that conflict ──────────────────────────
const BRANCH = 'claude/focused-change';
let prNumber = 1000;
interface World {
	n: number;
	base: string;
	head: string;
	main: string;
	pull: Pull;
}
function world(
	base: Record<string, string | { content: string; mode: string }>,
	head: Record<string, string | { content: string; mode: string }>,
	main: Record<string, string | { content: string; mode: string }>,
	opts: { branch?: string; fork?: boolean; labels?: string[] } = {},
): World {
	const n = ++prNumber;
	const baseC = putCommit(putTree(base), []);
	const headC = putCommit(putTree({ ...base, ...head }), [baseC]);
	const mainC = putCommit(putTree({ ...base, ...main }), [baseC]);
	git.refs.set('main', mainC);
	const branch = opts.branch ?? `${BRANCH}-${n}`;
	git.refs.set(branch, headC);
	gh.mergeBase = baseC;
	const pull: Pull = {
		number: n,
		title: 'A change',
		state: 'open',
		merged: false,
		labels: (opts.labels ?? []).map((name) => ({ name })),
		mergeable_state: 'dirty',
		mergeable: false,
		head: { sha: headC, ref: branch, repo: { full_name: REPO } },
		fork: opts.fork ?? false,
	};
	gh.pulls.set(n, pull);
	return { n, base: baseC, head: headC, main: mainC, pull };
}
const DOC_BASE = 'one\ntwo\n';
const files = (...f: Partial<MergeRunFile>[]): MergeRunFile[] =>
	f.map((x) => ({
		path: 'docs/status/a.md',
		choice: 'both',
		rule: 'docs-append',
		content: 'x\n',
		mode: '100644',
		...x,
	}));
const explanation = (paths: string[] = ['src/a.ts'], extra: Json = {}) => ({
	conflicted: paths.map((path) => ({ path, met: [{ pr: 1924, title: 'Main change' }] })),
	hunks: paths.map((path) => ({
		path,
		index: 0,
		main: 'const a = 2;',
		change: 'const a = 3;',
		result: null,
		kind: 'lines',
		takes: 'combined',
		why: 'Both lines matter.',
		nowDoes: 'It sets a to 5.',
		otherwise: null,
	})),
	outside: [],
	checks: [{ command: 'pnpm check:x', ok: true }],
	risks: 'none found',
	...extra,
});
const usage = [
	{
		model: 'claude-opus-5-5',
		inputTokens: 1_000_000,
		outputTokens: 100_000,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	},
];
function body(w: { head: string; main: string }, id: string, extra: Json = {}): Json {
	return {
		mergeRun: id,
		headSha: w.head,
		mainSha: w.main,
		baseSha: gh.mergeBase,
		outcome: 'proposed',
		reason: null,
		files: files({ path: 'src/a.ts', choice: 'combined', rule: null, content: 'const a = 5;\n' }),
		explanation: explanation(),
		usage,
		...extra,
	};
}

/** A started run bound to its Actions run, ready for a result. */
async function started(
	w: World,
	user: TestUser = ADMIN,
	ghRunId = 9001,
): Promise<{ id: string; gh: number }> {
	gh.calls.length = 0;
	gh.dispatch = () => answer(200, { workflow_run_id: ghRunId });
	const a = await resolve(user, w.n);
	const id = runIdOf(a);
	gh.actionsRuns.set(ghRunId, {
		id: ghRunId,
		display_title: `Merge main ${id}`,
		path: '.github/workflows/merge-main.yml',
		status: 'in_progress',
		conclusion: null,
		actor: { login: BOT },
		created_at: new Date(clock).toISOString(),
	});
	return { id, gh: ghRunId };
}
let nextGh = 9100;
async function proposed(
	w: World,
	f: MergeRunFile[],
	e: Json = explanation(),
): Promise<{ id: string; w: World }> {
	const ghRunId = ++nextGh;
	gh.dispatch = () => answer(200, { workflow_run_id: ghRunId });
	const a = await resolve(ADMIN, w.n);
	const id = runIdOf(a);
	gh.actionsRuns.set(ghRunId, {
		id: ghRunId,
		display_title: `Merge main ${id}`,
		path: '.github/workflows/merge-main.yml',
		status: 'in_progress',
		conclusion: null,
		actor: { login: BOT },
		created_at: new Date(clock).toISOString(),
	});
	const r = await post(id, ghRunId, body(w, id, { files: f, explanation: e, usage: [] }));
	check(`setup: a proposal for #${w.n} is kept`, [r.status, r.body.status], [200, 'proposed']);
	return { id, w };
}
const SRC_BASE = {
	'src/a.ts': 'const a = 1;\n',
	'docs/status/a.md': DOC_BASE,
	'untouched.txt': 'u\n',
};

// ═════════════════════════════════════════════════════════════════════════════
// The shared vocabulary
// ═════════════════════════════════════════════════════════════════════════════
check(
	'names: the run-name, the spend id, the agent, the audience, the workflow',
	[
		shared.mergeRunName('0123456789'),
		shared.mergeRunSpendId('0123456789'),
		shared.MERGE_RUN_AGENT,
		shared.MERGE_RUN_AUDIENCE,
		shared.MERGE_RUN_WORKFLOW_PATH,
		shared.MERGE_RUN_ENVIRONMENT,
	],
	[
		'Merge main 0123456789',
		'merge:0123456789',
		'merge-main',
		'invisible-launcher-merge-main',
		'.github/workflows/merge-main.yml',
		'bug-fix',
	],
);
check(
	'statuses: the eleven of §8 (accepting is the Accept claim); live is dispatched, running, proposed and accepting (the partial index); working is the first two',
	[
		shared.MERGE_RUN_STATUSES.length,
		shared.LIVE_MERGE_RUN_STATUSES,
		shared.WORKING_MERGE_RUN_STATUSES,
	],
	[11, ['dispatched', 'running', 'proposed', 'accepting'], ['dispatched', 'running']],
);
const facts = {
	open: true,
	conflicted: true,
	onHold: false,
	liveRun: null as string | null,
	workflowLive: true,
	plainBranch: true,
};
check(
	'refusals: the order of §4 — workflow, closed, not conflicted, hold, a live run',
	[
		shared.startRefusal({ ...facts, workflowLive: false, open: false }),
		shared.startRefusal({ ...facts, open: false, conflicted: false }),
		shared.startRefusal({ ...facts, conflicted: false, onHold: true }),
		shared.startRefusal({ ...facts, onHold: true, liveRun: 'x' }),
		shared.startRefusal({ ...facts, liveRun: 'x' }),
		shared.startRefusal({ ...facts, plainBranch: false, onHold: true }),
		shared.startRefusal({ ...facts, plainBranch: false, liveRun: 'x' }),
		shared.startRefusal(facts),
	],
	[
		'workflow_not_live',
		'not_open',
		'not_conflicted',
		'on_hold',
		'merge_run_live',
		'on_hold',
		'branch_unsafe',
		null,
	],
);
check(
	'refusals: not_conflicted says Update from main instead',
	shared.refusalMessage('not_conflicted', 7, null),
	'#7 does not conflict with main. Use Update from main instead.',
);

// ═════════════════════════════════════════════════════════════════════════════
// Start
// ═════════════════════════════════════════════════════════════════════════════
const w1 = world(SRC_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
const noCap = await resolve(TESTER, w1.n);
check(
	'start: a tester who may see Changes but not merge → 403, nothing dispatched',
	[noCap.status, callsOf()],
	[403, []],
);
const anon = await resolve(null, w1.n);
check('start: no session → 401', anon.status, 401);
gh.workflow = { status: 404, state: 'active' };
actions.forgetMergeWorkflow();
const noWorkflow = await resolve(ADMIN, w1.n);
check(
	'start: no merge-main.yml on main → 409 workflow_not_live, nothing stored',
	[noWorkflow.status, noWorkflow.body.code, runs.length],
	[409, 'workflow_not_live', 0],
);
check(
	'hidden: until the workflow is active the page learns ready: false (no Resolve button)',
	(await server.mergeRunsOfChange(w1.n)).ready,
	false,
);
gh.workflow = { status: 200, state: 'disabled_manually' };
actions.forgetMergeWorkflow();
check(
	'hidden: a disabled workflow is not ready either',
	(await server.mergeRunsOfChange(w1.n)).ready,
	false,
);
gh.workflow = { status: 200, state: 'active' };
actions.forgetMergeWorkflow();
check('hidden: an active one is', (await server.mergeRunsOfChange(w1.n)).ready, true);

check(
	'start: a number that is no change, and a fork → 404',
	[
		(await resolve(ADMIN, 999999)).status,
		(await resolve(ADMIN, world(SRC_BASE, {}, {}, { fork: true }).n)).status,
	],
	[404, 404],
);
const closed = world(SRC_BASE, { 'src/a.ts': 'x\n' }, { 'src/a.ts': 'y\n' });
closed.pull.state = 'closed';
check(
	'start: a closed change → 409 not_open',
	(await resolve(ADMIN, closed.n)).body.code,
	'not_open',
);
const clean = world(SRC_BASE, { 'src/a.ts': 'x\n' }, { 'untouched.txt': 'y\n' });
clean.pull.mergeable_state = 'behind';
const cleanRefusal = await resolve(ADMIN, clean.n);
check(
	'start: a change that merges cleanly → 409 not_conflicted, naming Update from main',
	[cleanRefusal.body.code, cleanRefusal.body.error],
	['not_conflicted', `#${clean.n} does not conflict with main. Use Update from main instead.`],
);
const held = world(SRC_BASE, { 'src/a.ts': 'x\n' }, { 'src/a.ts': 'y\n' }, { labels: ['on-hold'] });
check('start: a change on hold → 409 on_hold', (await resolve(ADMIN, held.n)).body.code, 'on_hold');
check('start: none of those wrote a run', runs.length, 0);

gh.calls.length = 0;
const monthStart = new Date(
	Date.UTC(new Date(clock).getUTCFullYear(), new Date(clock).getUTCMonth(), 1),
);
ledger.push({
	runId: 'fix:old',
	agent: 'bug-fix',
	model: 'm',
	usd: 500,
	requestId: 'old',
	at: new Date(Math.max(+monthStart, clock - 1)),
});
git.refs.set('main', w1.main);
const firstRequest = newRequest();
const first = await resolve(ADMIN, w1.n, firstRequest);
const R1 = runIdOf(first);
const dispatchCall = gh.calls.find((c) => c.path.endsWith('/dispatches'))!;
check(
	"start: even with the month's budget spent → 201, ONE dispatch on main with exactly §10's four inputs, bound to the run GitHub named",
	[
		first.status,
		first.body.created,
		/^[0-9a-f]{10}$/.test(R1),
		dispatchCall.body?.ref,
		dispatchCall.body?.inputs,
		runOf(R1).ghRunId,
		runOf(R1).headSha === w1.head &&
			runOf(R1).mainSha === w1.main &&
			runOf(R1).branch === w1.pull.head.ref,
		runOf(R1).startedBy,
	],
	[
		201,
		true,
		true,
		'main',
		{
			merge_run: R1,
			pr: String(w1.n),
			head_sha: w1.head,
			main_sha: w1.main,
			budget_usd: '0',
		},
		9001,
		true,
		'Gualtiero',
	],
);
ledger.length = 0;
const replay = await resolve(ADMIN, w1.n, firstRequest);
check(
	'start: the same request id answers the same run, dispatching nothing more',
	[replay.status, runIdOf(replay), replay.body.created, runs.length],
	[200, R1, false, 1],
);
check(
	'start: that request id for another change or another person → 409 request_id_reused',
	[
		(await resolve(ADMIN, w1.n + 1, firstRequest)).body.code,
		(await resolve(OTHER_ADMIN, w1.n, firstRequest)).body.code,
	],
	['request_id_reused', 'request_id_reused'],
);
const second = await resolve(ADMIN, w1.n);
check(
	'start: a second run while one is live → 409 merge_run_live',
	[second.status, second.body.code, runs.length],
	[409, 'merge_run_live', 1],
);
check(
	'start: a bad request id → 400',
	(
		await call(resolveRoute.POST, {
			user: ADMIN,
			params: { number: String(w1.n) },
			json: { requestId: '!' },
		})
	).status,
	400,
);

const w2 = world(SRC_BASE, { 'src/a.ts': 'x\n' }, { 'src/a.ts': 'y\n' });
gh.dispatch = () => answer(403, { message: 'Resource not accessible by integration' });
const refusedDispatch = await resolve(ADMIN, w2.n);
check(
	'dispatch: a 403 for Actions write ends the run failed with the App sentence, and is still answered as the run',
	[
		refusedDispatch.status,
		(refusedDispatch.body.run as Json).status,
		(refusedDispatch.body.run as Json).reason,
	],
	[201, 'failed', 'The GitHub App needs Actions: Read and write (docs/INFRA.md).'],
);
gh.dispatch = () => answer(404, { message: 'Not Found' });
const w3 = world(SRC_BASE, { 'src/a.ts': 'x\n' }, { 'src/a.ts': 'y\n' });
check(
	'dispatch: a 404 ends it failed naming the missing workflow',
	((await resolve(ADMIN, w3.n)).body.run as Json).reason,
	'GitHub has no .github/workflows/merge-main.yml on main for the App to run.',
);
gh.dispatch = () => answer(500, { message: 'boom' });
const w4 = world(SRC_BASE, { 'src/a.ts': 'x\n' }, { 'src/a.ts': 'y\n' });
check(
	'dispatch: a 5xx may have started a run: it stays dispatched for the backstop',
	((await resolve(ADMIN, w4.n)).body.run as Json).status,
	'dispatched',
);
let ranWithoutDetails = 0;
gh.dispatch = (b) => {
	if (b && 'return_run_details' in b)
		return answer(422, { message: 'Unexpected inputs: return_run_details' });
	ranWithoutDetails++;
	return answer(204, null);
};
const w5 = world(SRC_BASE, { 'src/a.ts': 'x\n' }, { 'src/a.ts': 'y\n' });
const r5 = await resolve(ADMIN, w5.n);
check(
	'dispatch: a 422 naming return_run_details is sent once more without it; a 204 binds nothing yet',
	[ranWithoutDetails, (r5.body.run as Json).status, runOf(runIdOf(r5)).ghRunId],
	[1, 'dispatched', null],
);
gh.dispatch = () => answer(200, { workflow_run_id: 9001 });

// the budget_usd input: the smaller of the run cap and what is left of the month, "0" once spent
check(
	'budget_usd: pure — a full month, part spent, spent, the cap the smaller, two places at most',
	[
		shared.dispatchBudget(6, 150, 0),
		shared.dispatchBudget(6, 150, 147.5),
		shared.dispatchBudget(6, 150, 150),
		shared.dispatchBudget(6, 150, 400),
		shared.dispatchBudget(6, 10, 0),
		shared.dispatchBudget(6, 150, 144.005),
		shared.dispatchBudget(500, 1000, 0),
		shared.dispatchBudget(100, 1000, 0),
	],
	['6.00', '2.50', '0', '0', '6.00', '5.99', '100.00', '100.00'],
);
const budgetSent = async (spent: number, monthly = 150, cap = 6) => {
	settings.monthly = monthly;
	settings.budget = cap;
	ledger.length = 0;
	if (spent) {
		ledger.push({
			runId: 'fix:old',
			agent: 'bug-fix',
			model: 'm',
			usd: spent / 2,
			requestId: 'b1',
			at: new Date(clock),
		});
		ledger.push({
			runId: 'merge:old',
			agent: 'merge-main',
			model: 'm',
			usd: spent / 2,
			requestId: 'b2',
			at: new Date(clock),
		});
	}
	const w = world(SRC_BASE, { 'src/a.ts': 'x\n' }, { 'src/a.ts': 'y\n' });
	gh.calls.length = 0;
	await resolve(ADMIN, w.n);
	return (
		gh.calls.find((c) => c.path.endsWith('/dispatches'))!.body as { inputs: { budget_usd: string } }
	).inputs.budget_usd;
};
check(
	'budget_usd: dispatched as a decimal string — a full month the run cap, a part-spent one what is left (both agents’ spend), a spent one "0", a small ceiling its remainder, a $500 setting still 100.00 (the job refuses more)',
	[
		await budgetSent(0),
		await budgetSent(147.5),
		await budgetSent(150),
		await budgetSent(0, 4.25),
		await budgetSent(1, 100, 0.5),
		await budgetSent(0, 1000, 500),
	],
	['6.00', '2.50', '0', '4.25', '0.50', '100.00'],
);
settings.monthly = 150;
settings.budget = 6;
ledger.length = 0;

// ═════════════════════════════════════════════════════════════════════════════
// The job's token
// ═════════════════════════════════════════════════════════════════════════════
const wt = world(SRC_BASE, { 'src/a.ts': 'x\n' }, { 'src/a.ts': 'y\n' });
const T = await started(wt, ADMIN, 9300);
const okBody = body(wt, T.id);
const tokenCall = (headers: Record<string, string>, id = T.id) =>
	call(resultRoute.POST, { params: { id }, json: okBody, headers });
check('token: none → 401', (await tokenCall({})).status, 401);
check(
	'token: the bug-fix audience is not a merge run’s → 401',
	(await tokenCall(bearer(token({ run_id: '9300' }, 'invisible-launcher-bug-fix')))).status,
	401,
);
const wrong = async (claims: Record<string, unknown>) =>
	(await tokenCall(bearer(token({ run_id: '9300', ...claims })))).body.error;
for (const [claim, value] of [
	['repository', 'someone/else'],
	['workflow_ref', `${REPO}/.github/workflows/bug-fix.yml@refs/heads/main`],
	['job_workflow_ref', `${REPO}/.github/workflows/merge-main.yml@refs/heads/other`],
	['ref', 'refs/heads/other'],
	['event_name', 'push'],
	['environment', 'production'],
	['run_attempt', '2'],
	['runner_environment', 'self-hosted'],
	['actor', 'a-person'],
] as const) {
	check(
		`token: a wrong ${claim} → 403 naming it`,
		await wrong({ [claim]: value }),
		`The token's ${claim} is not a merge run's.`,
	);
}
check(
	'token: a run_id that is not this run’s Actions run → 403 run_id',
	await wrong({ run_id: '9999' }),
	"The token's run_id is not a merge run's.",
);
check(
	'token: no such run → 404',
	(await tokenCall(bearer(token({ run_id: '9300' })), 'ffffffffff')).status,
	404,
);
runOf(T.id).ghRunId = null;
gh.actionsRuns.get(9300)!.display_title = 'Merge main 0000000000';
check(
	'token: first contact binds only an Actions run whose run-name is this run’s',
	[await wrong({ run_id: '9300' }), runOf(T.id).ghRunId],
	["The token's run_id is not a merge run's.", null],
);
gh.actionsRuns.get(9300)!.display_title = `Merge main ${T.id}`;
gh.actionsRuns.get(9300)!.path = '.github/workflows/bug-fix.yml';
check(
	'token: nor one of another workflow',
	await wrong({ run_id: '9300' }),
	"The token's run_id is not a merge run's.",
);
gh.actionsRuns.get(9300)!.path = '.github/workflows/merge-main.yml';
check(
	'token: with the title and file right it binds, once',
	[(await tokenCall(bearer(token({ run_id: '9300' })))).status, runOf(T.id).ghRunId],
	[200, 9300],
);

// ═════════════════════════════════════════════════════════════════════════════
// §10: the parser
// ═════════════════════════════════════════════════════════════════════════════
const good = body({ head: 'a'.repeat(40), main: 'b'.repeat(40) }, '0123456789');
const parse = (b: Json) => {
	try {
		return parsed.parseMergeResult(b) as unknown;
	} catch (e) {
		return (e as Error).message;
	}
};
check(
	'parser: a good result reads whole',
	[(parse(good) as Json).outcome, ((parse(good) as Json).files as unknown[]).length],
	['proposed', 1],
);
const expectBad = (label: string, b: Json, said: string) =>
	check(`parser: ${label}`, parse(b), said);
expectBad(
	'a field the contract does not name',
	{ ...good, extra: 1 },
	"The result's body has a field the launcher does not know.",
);
expectBad(
	'a mergeRun that is no id',
	{ ...good, mergeRun: 'x' },
	"The result's mergeRun is not a merge run id.",
);
expectBad(
	'an outcome it does not know',
	{ ...good, outcome: 'merged' },
	"The result's outcome is not one the launcher knows.",
);
expectBad(
	'no outcome and no failure',
	{ ...good, outcome: undefined },
	"The result's outcome is missing.",
);
expectBad(
	'a sha that is not 40 lower-case hex',
	{ ...good, headSha: 'A'.repeat(40) },
	"The result's headSha is not a 40-character SHA.",
);
expectBad(
	'a file with a field of its own',
	{ ...good, files: [{ ...(good.files as Json[])[0], x: 1 }] },
	"The result's files has a field the launcher does not know.",
);
expectBad(
	'a choice it does not know',
	{ ...good, files: [{ ...(good.files as Json[])[0], choice: 'theirs' }] },
	"The result's files has a choice the launcher does not know.",
);
expectBad(
	'a rule it does not know',
	{ ...good, files: [{ ...(good.files as Json[])[0], rule: 'magic' }] },
	"The result's files has a rule the launcher does not know.",
);
expectBad(
	'a mode other than the two',
	{ ...good, files: [{ ...(good.files as Json[])[0], mode: '120000' }] },
	"The result's files has a mode other than 100644 or 100755.",
);
expectBad(
	'content that is neither text nor null',
	{ ...good, files: [{ ...(good.files as Json[])[0], content: 3 }] },
	"The result's files has an entry whose content is neither text nor null.",
);
expectBad('files not a list', { ...good, files: {} }, "The result's files is not a list.");
expectBad(
	'more than 200 files',
	{ ...good, files: Array.from({ length: 201 }, () => (good.files as Json[])[0]) },
	"The result's files has more than 200 entries.",
);
expectBad(
	'a hunk far longer than the launcher keeps',
	{
		...good,
		explanation: explanation(['a'], {
			hunks: [{ ...explanation().hunks[0], why: 'w'.repeat(12_001) }],
		}),
	},
	"The result's a hunk is far longer than the launcher keeps.",
);
expectBad(
	'a hunk with an unknown takes',
	{
		...good,
		explanation: explanation(['a'], { hunks: [{ ...explanation().hunks[0], takes: 'neither' }] }),
	},
	"The result's hunks has a choice the launcher does not know.",
);
expectBad(
	'a hunk index that is not whole',
	{
		...good,
		explanation: explanation(['a'], { hunks: [{ ...explanation().hunks[0], index: 1.5 }] }),
	},
	"The result's hunks has an index that is not a whole number.",
);
expectBad(
	'an explanation field the contract does not name',
	{ ...good, explanation: { ...explanation(), more: [] } },
	"The result's explanation has a field the launcher does not know.",
);
expectBad(
	'risks that is not text',
	{ ...good, explanation: { ...explanation(), risks: 1 } },
	"The result's risks is not text.",
);
expectBad(
	'a met entry with a pull request that is not a number',
	{
		...good,
		explanation: explanation(['a'], {
			conflicted: [{ path: 'a', met: [{ pr: '12', title: 't' }] }],
		}),
	},
	"The result's met has a pull request that is not a number.",
);
// ── The three forms the job sends (ADR-0015 §10; every key, null where a form has none) ─────────
const SHA_A = 'a'.repeat(40);
const without = (b: Json, key: string): Json =>
	Object.fromEntries(Object.entries(b).filter(([k]) => k !== key));
const refusalForm: Json = {
	mergeRun: '0123456789',
	headSha: SHA_A,
	mainSha: 'b'.repeat(40),
	baseSha: 'c'.repeat(40),
	outcome: 'harness_conflict',
	reason: 'A conflict in .github/workflows/lint.yml.',
	files: [],
	explanation: null,
	usage: [],
};
const failureForm: Json = {
	mergeRun: '0123456789',
	headSha: SHA_A,
	mainSha: 'b'.repeat(40),
	baseSha: null,
	failure: 'it broke',
	reason: null,
	files: [],
	explanation: null,
	usage: [],
};
const formView = (b: Json): unknown[] => {
	const r = parse(b) as Json;
	return [r.outcome, r.failure, r.reason, r.baseSha, (r.files as unknown[]).length, r.explanation];
};
check(
	'parser: a refusal as the job sends it (reason, files [], explanation null, no failure key)',
	formView(refusalForm),
	['harness_conflict', null, 'A conflict in .github/workflows/lint.yml.', 'c'.repeat(40), 0, null],
);
check(
	'parser: a refusal with a null baseSha (no single merge base, or the job broke first)',
	formView({ ...refusalForm, baseSha: null }).slice(3, 4),
	[null],
);
check(
	'parser: a refusal may carry failure null',
	formView({ ...refusalForm, failure: null }).slice(0, 2),
	['harness_conflict', null],
);
check(
	'parser: a failure as the job sends it (failure, reason null, files [], explanation null, baseSha null)',
	formView(failureForm),
	[null, 'it broke', '', null, 0, null],
);
check(
	'parser: a failure may carry outcome null',
	formView({ ...failureForm, outcome: null }).slice(0, 2),
	[null, 'it broke'],
);
check(
	'parser: a proposal has reason null and a baseSha',
	[(parse(good) as Json).reason, (parse(good) as Json).baseSha === good.baseSha],
	['', true],
);
for (const [label, b, said] of [
	[
		'a proposal with a reason',
		{ ...good, reason: 'because' },
		"The result's reason is not null in a proposal.",
	],
	[
		'a proposal with no baseSha',
		{ ...good, baseSha: null },
		"The result's baseSha is not a 40-character SHA.",
	],
	[
		'a refusal that carries files',
		{ ...refusalForm, files: good.files as unknown[] },
		"The result's files is not empty without a proposal.",
	],
	[
		'a refusal that carries an explanation',
		{ ...refusalForm, explanation: explanation() },
		"The result's explanation is not null without a proposal.",
	],
	[
		'a refusal whose reason is null',
		{ ...refusalForm, reason: null },
		"The result's reason is not text.",
	],
	[
		'a failure with a reason',
		{ ...failureForm, reason: 'no' },
		"The result's reason is not null in a failure.",
	],
	[
		'a failure with an explanation',
		{ ...failureForm, explanation: explanation() },
		"The result's explanation is not null without a proposal.",
	],
	[
		'a failure with no sentence',
		{ ...failureForm, failure: '  ' },
		"The result's failure is empty.",
	],
	[
		'an outcome and a failure together',
		{ ...refusalForm, failure: 'x' },
		"The result's has both an outcome and a failure.",
	],
	[
		'a failure with no head',
		{ ...failureForm, headSha: null },
		"The result's headSha is not a 40-character SHA.",
	],
	[
		'a baseSha that is not a sha',
		{ ...refusalForm, baseSha: 'abc' },
		"The result's baseSha is not a 40-character SHA.",
	],
	['a missing key (files)', without(refusalForm, 'files'), "The result's files is missing."],
	[
		'a missing key (explanation)',
		without(failureForm, 'explanation'),
		"The result's explanation is missing.",
	],
	['a missing key (reason)', without(failureForm, 'reason'), "The result's reason is missing."],
	['a missing key (baseSha)', without(refusalForm, 'baseSha'), "The result's baseSha is missing."],
] as const) {
	expectBad(label, b as Json, said);
}
check(
	'parser: the 4x slack — a text far past its cap is refused unread, one a little over is kept (and cut later)',
	[
		typeof parse({ ...refusalForm, reason: 'r'.repeat(12_000) }),
		typeof parse({ ...refusalForm, reason: 'r'.repeat(12_001) }),
	],
	['object', 'string'],
);

// cleaning and the scan
const dirty = parsed.cleanExplanation({
	conflicted: [{ path: 'src/a.ts', met: [{ pr: 1, title: 'Fix <b>bold</b> [skip ci] @bob #12' }] }],
	hunks: [
		{
			path: 'src/a.ts',
			index: 0,
			main: '<div>{a}</div> [skip ci]‮',
			change: '\t\tconst x = 1;\n\t\treturn x;\n',
			result: '\tx\n',
			takes: 'main',
			why: 'Because <!-- hide --> [skip [skip ci]ci] BUG-7',
			nowDoes: null,
			otherwise: '  ',
		},
	],
	outside: [{ path: 'a', what: 'x'.repeat(5000) }],
	checks: [{ command: 'pnpm `rm`', ok: true }],
	risks: 'none',
});
check(
	'cleaning: tags shown as text, comments and CI-skip directives and bidi marks gone, @ and # quieted, BUG- refs unlinked',
	[
		dirty.conflicted[0].met[0].title,
		dirty.hunks[0].why,
		dirty.hunks[0].main,
		dirty.hunks[0].change,
		dirty.hunks[0].result,
		dirty.hunks[0].otherwise,
		Array.from(dirty.outside[0].what).length,
		dirty.checks[0].command,
	],
	[
		'Fix ‹b›bold‹/b› @⁠bob #⁠12',
		'Because   bug #⁠7',
		'<div>{a}</div> ',
		'\t\tconst x = 1;\n\t\treturn x;',
		'\tx',
		null,
		3000,
		"pnpm 'rm'",
	],
);
const secretText = `ghp_${'E'.repeat(36)}`;
check(
	'scan: a secret in any text, raw or cleaned, is found; plain text is not',
	[
		parsed.textsProblem([`see ${secretText}`], ['see']),
		parsed.textsProblem(['sk-<b></b>ant-api03-' + 'z'.repeat(40)], ['x']),
		parsed.textsProblem(['fine'], ['fine']),
	],
	[
		'secret scan: GitHub token in the explanation',
		'secret scan: an sk-ant- string in the explanation',
		null,
	],
);

// the rules on the files
const prob = (f: Partial<MergeRunFile>[], hunks: string[] = []) =>
	parsed.filesProblem(files(...f), new Set(hunks));
// `main`'s own entry written onto `main`'s tree changes nothing, so a protected path or a lockfile
// may be listed as main's, but only when it IS main's entry at the run's SHA (the blob and the
// mode, or absent for a deletion). Without main's tree, or with anything else, it is refused.
const LOCK_SHA = blobSha('lock: 2\n');
const mainTree = new Map([
	['pnpm-lock.yaml', { mode: '100644', type: 'blob', sha: LOCK_SHA }],
	['scripts/bug-fix/exec.sh', { mode: '100755', type: 'blob', sha: blobSha('#!/bin/sh\n') }],
]);
const lockMain = {
	path: 'pnpm-lock.yaml',
	rule: null,
	choice: 'main',
	content: 'lock: 2\n',
} as const;
const LOCK_REFUSED = 'it changes a lockfile: dependencies are for a person to decide';
check(
	'files: a protected path or a lockfile listed as main’s is allowed only when it is main’s own entry at the run’s SHA',
	[
		parsed.filesProblem(files(lockMain), new Set(), mainTree),
		parsed.filesProblem(files({ ...lockMain, content: 'lock: 3\n' }), new Set(), mainTree),
		parsed.filesProblem(files({ ...lockMain, mode: '100755' }), new Set(), mainTree),
		parsed.filesProblem(files(lockMain), new Set(), null),
		parsed.filesProblem(files(lockMain), new Set()),
		parsed.filesProblem(
			files({ path: 'scripts/bug-fix/EXEC.SH', rule: null, choice: 'main', content: null }),
			new Set(),
			mainTree,
		),
		parsed.filesProblem(files({ ...lockMain, path: 'yarn.lock' }), new Set(), mainTree),
		parsed.filesProblem(
			files({
				path: 'scripts/bug-fix/exec.sh',
				rule: null,
				choice: 'main',
				content: '#!/bin/sh\n',
				mode: '100755',
			}),
			new Set(),
			mainTree,
		),
		parsed.filesProblem(
			files({ path: 'scripts/bug-fix/exec.sh', rule: null, choice: 'main', content: 'evil\n' }),
			new Set(),
			mainTree,
		),
		parsed.filesProblem(
			files({ path: 'scripts/bug-fix/gone.mjs', rule: null, choice: 'main', content: null }),
			new Set(),
			mainTree,
		),
		parsed.filesProblem(
			files({ path: 'scripts/bug-fix/exec.sh', rule: null, choice: 'main', content: null }),
			new Set(),
			mainTree,
		),
		parsed.filesProblem(files({ ...lockMain, choice: 'change' }), new Set(), mainTree),
		parsed.filesProblem(
			files({ path: 'scripts/bug-fix/shared.mjs', rule: null, choice: 'both', content: 'x\n' }),
			new Set(),
			mainTree,
		),
		parsed.filesProblem(
			files({ path: '.github/workflows/ci.yml', rule: null, choice: 'main', content: 'x\n' }),
			new Set(),
			mainTree,
		),
	],
	[
		null,
		LOCK_REFUSED,
		LOCK_REFUSED,
		LOCK_REFUSED,
		LOCK_REFUSED,
		'it touches a protected path (scripts/bug-fix)',
		'it changes a lockfile: dependencies are for a person to decide',
		null,
		'it touches a protected path (scripts/bug-fix)',
		null,
		'it touches a protected path (scripts/bug-fix)',
		LOCK_REFUSED,
		'it touches a protected path (scripts/bug-fix)',
		'it touches a protected path (.github)',
	],
);
check(
	'files: a rule file whose build was left pending holds main’s (choice main, rule runtime-bytes)',
	[
		prob([
			{
				path: 'scripts/runtime-bytes/lines.json',
				rule: 'runtime-bytes',
				choice: 'main',
				content: '{}\n',
			},
		]),
		prob([{ path: 'src/a.ts', rule: 'runtime-bytes', choice: 'main', content: '{}\n' }]),
	],
	[null, "a build rule's file is not main's, left pending"],
);
{
	const e = (sha: string) => ({ mode: '100644', type: 'blob', sha });
	const trees = (b: Record<string, string>, h: Record<string, string>, m: Record<string, string>) =>
		[b, h, m].map((t) => new Map(Object.entries(t).map(([p, sha]) => [p, e(sha)])));
	const [b, h, m] = trees(
		{ 'same.ts': '1', 'gone.ts': '1', 'mine.ts': '1', 'a.ts': '1' },
		{ 'same.ts': '2', 'mine.ts': '2', 'a.ts': '2' },
		{ 'same.ts': '2', 'mine.ts': '1', 'a.ts': '3' },
	);
	const plan = (list: Partial<MergeRunFile>[]) => {
		const r = built.planMerge(b, h, m, files(...list));
		return 'problem' in r ? r.problem : r.plan.writes.map((w: { path: string }) => w.path);
	};
	check(
		'accept: a path both sides changed identically or deleted needs no resolution and writes nothing; a path only the head changed takes the head; one both changed to different things needs the run',
		[
			plan([{ path: 'a.ts', rule: null, choice: 'combined', content: 'merged\n' }]),
			plan([]),
			plan([
				{ path: 'a.ts', rule: null, choice: 'combined', content: 'merged\n' },
				{ path: 'same.ts', rule: null, choice: 'main', content: 'x\n' },
				{ path: 'gone.ts', rule: null, choice: 'main', content: null },
			]),
		],
		[['mine.ts', 'a.ts'], 'a path both sides changed has no resolution', ['mine.ts', 'a.ts']],
	);
}
// a checks[].command may be a sentence (a docs-only proposal): it is text, never run
check(
	'checks: a command that is a sentence is kept as text, backticks softened, never anything to run',
	parsed.cleanExplanation(
		parsed.parseMergeResult(
			body({ head: 'a'.repeat(40), main: 'b'.repeat(40) }, '0123456789', {
				explanation: explanation(['docs/a.md'], {
					checks: [{ command: 'Read the `docs/a.md` diff; no command applies', ok: true }],
				}),
			}),
		).explanation!,
	).checks,
	[{ command: "Read the 'docs/a.md' diff; no command applies", ok: true }],
);
check(
	'checks: the page shows it as a line of text',
	view
		.proposalSections({
			...explanation(['docs/a.md']),
			checks: [{ command: 'Read the diff; no command applies', ok: true }],
		})
		.find((x: { key: string }) => x.key === 'checks')?.lines,
	['passed: Read the diff; no command applies'],
);
check(
	'files: a protected path is refused, except under the docs-append rule',
	[
		prob([{ path: 'docs/knowledge/x.md', rule: null, choice: 'combined' }]),
		prob([{ path: 'docs/knowledge/x.md' }]),
		prob([{ path: '.github/workflows/ci.yml', rule: null, choice: 'combined' }]),
		prob([{ path: 'scripts/merge-main/run.mjs', rule: null, choice: 'combined' }]),
		prob([
			{
				path: 'apps/launcher-api/scripts/check-merge-main-runs.ts',
				rule: null,
				choice: 'combined',
			},
		]),
		prob([
			{
				path: 'apps/launcher-api/src/lib/server/pipelineMergeRuns.ts',
				rule: null,
				choice: 'combined',
			},
		]),
		prob([{ path: 'apps/launcher-api/src/lib/mergeMainRuns.ts', rule: null, choice: 'combined' }]),
	],
	[
		'it touches a protected path (docs/knowledge)',
		null,
		'it touches a protected path (.github)',
		'it touches a protected path (scripts/merge-main)',
		'it touches a protected path (apps/launcher-api/scripts/check-merge-main-runs.ts)',
		"it touches a protected path (Invisible Pipeline Changes' server modules)",
		'it touches a protected path (apps/launcher-api/src/lib/mergemainruns.ts)',
	],
);
check(
	'files: a docs-append file is a markdown file under docs/ taken as both; docs-append on code is refused',
	[prob([{ path: 'src/a.ts' }]), prob([{ path: 'docs/a.md', choice: 'combined' }])],
	[
		'a docs-append file is not a markdown file under docs/ taken as both',
		'a docs-append file is not a markdown file under docs/ taken as both',
	],
);
check(
	'files: lockfiles, odd paths, duplicates, NUL, hidden text, and a build rule file that is not main, pending',
	[
		prob([{ path: 'pnpm-lock.yaml', rule: null, choice: 'combined' }]),
		prob([{ path: '../x', rule: null, choice: 'combined' }]),
		prob([
			{ path: 'a.ts', rule: null, choice: 'main' },
			{ path: 'A.ts', rule: null, choice: 'main' },
		]),
		prob([{ path: 'a.ts', rule: null, choice: 'main', content: 'a\u0000b' }]),
		prob([{ path: 'a.ts', rule: null, choice: 'main', content: 'a‮b' }]),
		prob([{ path: 'src/a.ts', rule: 'runtime-bytes', choice: 'main' }]),
		prob([{ path: 'scripts/runtime-bytes/lines.json', rule: 'runtime-bytes', choice: 'combined' }]),
	],
	[
		'it changes a lockfile: dependencies are for a person to decide',
		'a path has an empty, . or .. segment',
		'it lists one path twice',
		'a file holds a NUL byte',
		'a file holds Unicode tag or bidi control characters',
		"a build rule's file is not main's, left pending",
		"a build rule's file is not main's, left pending",
	],
);
check(
	'files: a rule’s files are accepted pending (main’s) where the rule keeps them',
	[
		prob([{ path: 'scripts/runtime-bytes/lines.json', rule: 'runtime-bytes', choice: 'main' }]),
		prob([
			{
				path: 'apps/launcher-api/static/rigger/vendor/rigger-fx.js',
				rule: 'vendored-bundle',
				choice: 'main',
			},
		]),
		prob([{ path: 'svelte-check-baseline.json', rule: 'ratchet', choice: 'main' }]),
	],
	[null, null, null],
);
check(
	'files: size — a file over 2 MB, all over 4 MB; and more than 10 files by hand',
	[
		prob([{ path: 'a.ts', rule: null, choice: 'main', content: 'x'.repeat(2 * 1024 * 1024 + 1) }]),
		prob([
			{ path: 'a.ts', rule: null, choice: 'main', content: 'x'.repeat(2 * 1024 * 1024) },
			{ path: 'b.ts', rule: null, choice: 'main', content: 'x'.repeat(2 * 1024 * 1024) },
			{ path: 'c.ts', rule: null, choice: 'main', content: 'x' },
		]),
		prob(
			Array.from({ length: 11 }, (_, i) => ({
				path: `src/f${i}.ts`,
				rule: null,
				choice: 'combined' as const,
			})),
			Array.from({ length: 11 }, (_, i) => `src/f${i}.ts`),
		),
	],
	[
		'a file is larger than 2 MB',
		'the files are larger than 4 MB in all',
		'it resolves more than 10 files by hand',
	],
);

// ═════════════════════════════════════════════════════════════════════════════
// The result
// ═════════════════════════════════════════════════════════════════════════════
const w6 = world(SRC_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
const S = await started(w6, ADMIN, 9400);
const before = ledger.length;
const okResult = await post(S.id, S.gh, body(w6, S.id));
check(
	'result: a proposal is kept — status proposed, its files and cleaned explanation stored, the answer says no reason and no text',
	[
		okResult.status,
		okResult.body,
		runOf(S.id).status,
		runOf(S.id).files?.length,
		runOf(S.id).explanation?.risks,
		runOf(S.id).finishedAt,
	],
	[200, { mergeRun: S.id, status: 'proposed', spendUsd: 4 + 2 }, 'proposed', 1, 'none found', null],
);
check(
	'spend: one director_spend row per model, run_id merge:<id>, agent merge-main, priced at pricing.json (1M in at $4 + 100k out at $20)',
	[
		ledger.length - before,
		ledger.at(-1)?.runId,
		ledger.at(-1)?.agent,
		ledger.at(-1)?.usd,
		runOf(S.id).spendUsd,
	],
	[1, `merge:${S.id}`, 'merge-main', 6, 6],
);
const again = await post(S.id, S.gh, body(w6, S.id));
check(
	'result: a second result → 409 and nothing changes; its spend is not billed twice',
	[
		again.status,
		runOf(S.id).status,
		ledger.filter((s) => s.runId === `merge:${S.id}`).length,
		runOf(S.id).spendUsd,
	],
	[409, 'proposed', 1, 6],
);
check(
	'a merge run’s spend counts toward the monthly ceiling: the fix-start facts add both agents',
	text('../src/lib/server/bugReports.ts').includes('fixSpendSince(since, MERGE_RUN_AGENT)'),
	true,
);

const failFast = async (
	extra: Json,
	w = world(SRC_BASE, { 'src/a.ts': '1\n' }, { 'src/a.ts': '2\n' }),
) => {
	const r = await started(w, ADMIN, ++nextGh);
	const a = await post(r.id, r.gh, body(w, r.id, extra));
	return { a, run: runOf(r.id), id: r.id };
};
const isWorking = (status: string) => status === 'dispatched' || status === 'running';
const NO_RESULT = { files: [], explanation: null };

{
	// through the result endpoint: main's tree is read at the run's SHA, only when a file needs it
	const withLock = (content: string) =>
		files(
			{ ...lockMain, content },
			{ path: 'src/a.ts', rule: null, choice: 'combined', content: '3\n' },
		);
	const wl = world(SRC_BASE, { 'pnpm-lock.yaml': 'lock: 2\n' }, { 'pnpm-lock.yaml': 'lock: 2\n' });
	gh.calls.length = 0;
	const same = await failFast({ files: withLock('lock: 2\n') }, wl);
	check(
		'result: a lockfile both sides changed identically, listed as main’s → proposed; main’s tree was read',
		[same.run.status, gh.calls.some((c) => c.path.startsWith('/git/trees/'))],
		['proposed', true],
	);
	const wl4 = world(SRC_BASE, { 'pnpm-lock.yaml': 'lock: 2\n' }, { 'pnpm-lock.yaml': 'lock: 2\n' });
	gh.fail.set(`GET /git/commits/${wl4.main}`, [{ status: 502, message: 'bad gateway' }]);
	const blip = await failFast({ files: withLock('lock: 2\n') }, wl4);
	gh.fail.clear();
	check(
		'result: a GitHub error reading main’s tree is a 502 the job re-sends, not a refusal — the run is still working',
		[blip.a.status, isWorking(blip.run.status)],
		[502, true],
	);
	runOf(blip.id).status = 'cancelled';
	const wl2 = world(SRC_BASE, { 'pnpm-lock.yaml': 'lock: 2\n' }, { 'pnpm-lock.yaml': 'lock: 2\n' });
	const lie = await failFast({ files: withLock('lock: 9\n') }, wl2);
	check(
		'result: a lockfile listed as main’s that is not main’s → needs_person, the rule named',
		[lie.run.status, lie.run.reason],
		['needs_person', `The change was refused (${LOCK_REFUSED}).`],
	);
	const wl3 = world(SRC_BASE, { 'src/a.ts': '1\n' }, { 'src/a.ts': '2\n' });
	gh.calls.length = 0;
	const plain = await failFast({}, wl3);
	check(
		'result: with no such file main’s tree is not read',
		[plain.run.status, gh.calls.some((c) => c.path.startsWith('/git/trees/'))],
		[plain.run.status, false],
	);
	ledger.length = 0; // each posted result spends $6 of the month's $150: these runs are not what later checks count
}
const f1 = await failFast({
	outcome: undefined,
	failure: 'the job broke',
	reason: null,
	...NO_RESULT,
});
check(
	'result: a failure ends it failed, saying so in the launcher’s sentence',
	[f1.a.body.status, f1.run.reason],
	['failed', 'The job failed: the job broke'],
);
for (const [outcome, status] of [
	['needs_person', 'needs_person'],
	['harness_conflict', 'needs_person'],
	['protected_conflict', 'needs_person'],
	['too_large', 'needs_person'],
	['no_proposal', 'no_proposal'],
] as const) {
	const f = await failFast({
		outcome,
		reason: `Because of ${outcome} in src/a.ts`,
		...NO_RESULT,
	});
	check(
		`result: outcome ${outcome} → ${status}, the job's sentence kept, no files`,
		[f.run.status, f.run.reason, f.run.files],
		[status, `Because of ${outcome} in src/a.ts`, null],
	);
}
const noReason = await failFast({ outcome: 'harness_conflict', reason: '', ...NO_RESULT });
check(
	'result: an outcome with no sentence gets the launcher’s own',
	noReason.run.reason,
	"The conflict is in the harness (.github/workflows or scripts/current-games): it needs the owner's hand merge.",
);
const noExplanation = await failFast({ explanation: null });
check(
	'result: a proposal with no explanation is not a form the job sends → 400, the run still working',
	[noExplanation.a.status, noExplanation.run.status],
	[400, 'dispatched'],
);
const noUsage = await (async () => {
	const w = world(SRC_BASE, { 'src/a.ts': '1\n' }, { 'src/a.ts': '2\n' });
	const r = await started(w, ADMIN, ++nextGh);
	const { usage: _usage, ...rest } = body(w, r.id);
	return { a: await post(r.id, r.gh, rest), run: runOf(r.id) };
})();
check(
	'result: usage is always sent: a body without it → 400, the run still working',
	[noUsage.a.status, noUsage.run.status],
	[400, 'dispatched'],
);
const emptyRisks = await failFast({ explanation: { ...explanation(), risks: '' } });
check('result: empty risks → no_proposal', emptyRisks.run.status, 'no_proposal');
const bigExplanation = await failFast({
	explanation: explanation(['src/a.ts'], {
		outside: Array.from({ length: 10 }, (_, i) => ({ path: `d/${i}`, what: 'w'.repeat(2900) })),
	}),
});
check(
	'result: an explanation over 16,000 characters in all → no_proposal',
	bigExplanation.run.status,
	'no_proposal',
);
const leaky = await failFast({
	explanation: explanation(['src/a.ts'], { risks: `leaks ${secretText}` }),
});
check(
	'result: a secret in the explanation → needs_person, the scan named, nothing kept',
	[leaky.run.status, leaky.run.reason, leaky.run.files],
	['needs_person', 'The change was refused (secret scan: GitHub token in the explanation).', null],
);
const protectedFile = await failFast({
	files: files({ path: 'docs/knowledge/x.md', rule: null, choice: 'combined' }),
});
check(
	'result: a protected path → needs_person naming the rule, never the path',
	[protectedFile.run.status, protectedFile.run.reason],
	['needs_person', 'The change was refused (it touches a protected path (docs/knowledge)).'],
);
// a hunk's real lines are not prose: not under the 16,000 cap, not scanned as prose (§4, §10)
{
	const hunkWith = (over: Json) => ({
		...explanation().hunks[0],
		takes: 'both',
		nowDoes: null,
		...over,
	});
	const withHunks = (hunks: Json[]) => explanation(['src/a.ts'], { hunks });
	const real =
		'const key = process.env.ANTHROPIC_API_KEY ?? "sk-ant-api03-' + 'z'.repeat(40) + '";';
	const big = 'x'.repeat(3_900);
	const content = `${big}\n${real}\nconst a = 5;\n`;
	const five = Array.from({ length: 5 }, (_, i) =>
		hunkWith({ index: i, main: big, change: big, result: big }),
	);
	const long = await failFast({
		files: files({ path: 'src/a.ts', rule: null, choice: 'both', content }),
		explanation: withHunks(five),
	});
	check(
		'result: five hunks of ~4,000-character sides and results (over 16,000 in all) are not prose → proposed',
		long.run.status,
		'proposed',
	);
	const secretLines = await failFast({
		files: files({ path: 'src/a.ts', rule: null, choice: 'both', content }),
		explanation: withHunks([hunkWith({ main: real, change: 'const a = 1;', result: real })]),
	});
	check(
		"result: a line of code that mentions sk-ant- (as docs/INFRA.md and env.ts do) in a hunk's sides is not a secret in the prose → proposed",
		secretLines.run.status,
		'proposed',
	);
	const absent = await failFast({
		files: files({ path: 'src/a.ts', rule: null, choice: 'both', content: 'const a = 5;\n' }),
		explanation: withHunks([hunkWith({ result: 'const a = 6; // not in the file' })]),
	});
	check(
		'result: a hunk result that is not in its file → needs_person, the rule named, nothing kept',
		[absent.run.status, absent.run.reason],
		['needs_person', 'The change was refused (a hunk shows a result that is not in its file).'],
	);
	const over = await failFast({
		files: files({ path: 'src/a.ts', rule: null, choice: 'both', content: 'const a = 5;\n' }),
		explanation: withHunks(
			Array.from({ length: 13 }, (_, i) =>
				hunkWith({ index: i, main: 'm'.repeat(9_900), change: 'c'.repeat(9_900), result: null }),
			),
		),
	});
	check(
		'result: the hunks’ lines over their own cap (120,000) → no_proposal, not a prose overflow',
		[over.run.status, over.run.reason],
		['no_proposal', 'The conflicting lines are too long to show for a person to read.'],
	);
	// R2-S4: the result is the job's, so it is scanned like any text a person did not write
	const keyLine = `const k = "sk-ant-api03-${'z'.repeat(40)}";`;
	const withSecretResult = await failFast({
		files: files({
			path: 'src/a.ts',
			rule: null,
			choice: 'both',
			content: `${keyLine}\nconst a = 5;\n`,
		}),
		explanation: withHunks([
			hunkWith({ main: 'const a = 1;', change: 'const a = 2;', result: keyLine }),
		]),
	});
	check(
		'result: a secret in a result line neither side has → needs_person, the scan named',
		[withSecretResult.run.status, withSecretResult.run.reason],
		['needs_person', 'The change was refused (secret scan: a secret in a hunk result).'],
	);
	const zw = `const k = "sk-ant-api\u200B03-${'z'.repeat(40)}";`;
	const splitSecret = await failFast({
		files: files({ path: 'src/a.ts', rule: null, choice: 'both', content: `${zw}\n` }),
		explanation: withHunks([
			hunkWith({ main: 'const a = 1;', change: 'const a = 2;', result: zw }),
		]),
	});
	check(
		'result: a key split by a zero-width character is found in the cleaned form → needs_person',
		splitSecret.run.status,
		'needs_person',
	);
	const ownLine = await failFast({
		files: files({ path: 'src/a.ts', rule: null, choice: 'both', content: `${keyLine}\n` }),
		explanation: withHunks([hunkWith({ main: keyLine, change: 'const a = 2;', result: keyLine })]),
	});
	check(
		'result: a line a side already held is the repository’s own — proposed, with that line hidden on the page’s sides',
		[
			ownLine.run.status,
			(ownLine.run.explanation as { hunks: { main: string; change: string }[] }).hunks[0].main,
			(ownLine.run.explanation as { hunks: { main: string; change: string }[] }).hunks[0].change,
		],
		['proposed', '[line hidden: it looks like a secret]', 'const a = 2;'],
	);
	const tooMany = await failFast({
		explanation: withHunks([hunkWith({ main: 'm'.repeat(40_001) })]),
	});
	check(
		'parser: one side of a hunk past its own cap (10,000 × 4 slack) is refused unread',
		tooMany.a.status,
		400,
	);
	runOf(tooMany.id).status = 'cancelled'; // still working otherwise: the backstop checks below count those
	ledger.length = 0;
}
const otherHead = await failFast({ headSha: 'c'.repeat(40) });
check(
	'result: a result for another head → failed',
	[otherHead.run.status, otherHead.run.reason],
	['failed', 'The result is for another head or another main.'],
);
const wrongRun = await failFast({ mergeRun: '0000000000' });
check(
	'result: a body naming another run → 400, the run still working',
	[wrongRun.a.status, wrongRun.run.status],
	[400, 'dispatched'],
);
const junk = await failFast({ nope: 1 });
check(
	'result: an unreadable body → 400 that never echoes it; the run stays working',
	[junk.a.status, JSON.stringify(junk.a.body).includes('nope'), junk.run.status],
	[400, false, 'dispatched'],
);
const gz = await (async () => {
	const w = world(SRC_BASE, { 'src/a.ts': '1\n' }, { 'src/a.ts': '2\n' });
	const r = await started(w, ADMIN, ++nextGh);
	return { a: await post(r.id, r.gh, body(w, r.id), true), run: runOf(r.id) };
})();
check('result: gzipped JSON is read', [gz.a.status, gz.run.status], [200, 'proposed']);
const tooManyModels = await failFast({
	usage: Array.from({ length: 11 }, (_, i) => ({ ...usage[0], model: `m${i}` })),
});
check('result: usage naming more than 10 models → 400', tooManyModels.a.status, 400);

const runsBefore = runs.length;
// §10 `usage`: the job sends the fix-run shape (tokens per model, no cost), and the launcher prices it
const jobUsage = {
	model: 'claude-opus-5-5',
	inputTokens: 120,
	outputTokens: 30,
	cacheReadTokens: 5,
	cacheWriteTokens: 7,
};
const priced = await (async () => {
	const w = world(SRC_BASE, { 'src/a.ts': '1\n' }, { 'src/a.ts': '2\n' });
	const r = await started(w, ADMIN, ++nextGh);
	const rows = ledger.length;
	const a = await post(r.id, r.gh, body(w, r.id, { usage: [{ ...jobUsage, costUsd: 99 }] }));
	return { a, usd: ledger.slice(rows).map((l) => l.usd.toFixed(6)) };
})();
check(
	"usage: the job's tokens are priced from pricing.json and a cost it names is not read (120 in, 30 out, 5 cache-read, 7 cache-write at $4 / $20)",
	priced.usd,
	['0.001117'],
);
check(
	'result: the answer is { mergeRun, status, spendUsd } and nothing else (collect logs status and spendUsd)',
	[
		priced.a.status,
		Object.keys(priced.a.body).sort(),
		priced.a.body.spendUsd,
		priced.a.body.status,
	],
	[200, ['mergeRun', 'spendUsd', 'status'], 0.001117, 'proposed'],
);

// body size: the job gzips above 400 KB and sends at most 8 MB unpacked
const sizeRun = async (raw: Buffer, gzip: boolean) => {
	const w = world(SRC_BASE, { 'src/a.ts': '1\n' }, { 'src/a.ts': '2\n' });
	const r = await started(w, ADMIN, ++nextGh);
	const a = await call(resultRoute.POST, {
		params: { id: r.id },
		raw: gzip ? gzipSync(raw) : raw,
		headers: {
			...bearer(token({ run_id: String(r.gh) })),
			...(gzip ? { 'content-encoding': 'gzip' } : {}),
		},
	});
	return a.status;
};
const padded = (bytes: number): Buffer => Buffer.from(JSON.stringify({ pad: 'x'.repeat(bytes) }));
check(
	'result body: 3 MB plain and 7 MB gzipped are read (then refused as a body, 400, not as a size)',
	[await sizeRun(padded(3 * 1024 * 1024), false), await sizeRun(padded(7 * 1024 * 1024), true)],
	[400, 400],
);
check(
	'result body: over 8 MB plain, or unpacking past 8 MB gzipped → 413',
	[await sizeRun(padded(9 * 1024 * 1024), false), await sizeRun(padded(9 * 1024 * 1024), true)],
	[413, 413],
);
// the runs left working would crowd the backstop's per-sweep reads below
runs.splice(runsBefore);

// the budget
ledger.push({
	runId: 'fix:old',
	agent: 'bug-fix',
	model: 'old',
	usd: 149,
	requestId: 'old2',
	at: new Date(clock),
});
const mechanicalOnly = await (async () => {
	const w = world(
		SRC_BASE,
		{ 'docs/status/a.md': 'one\nmine\ntwo\n' },
		{ 'docs/status/a.md': 'one\nmain\ntwo\n' },
	);
	const r = await started(w, ADMIN, ++nextGh);
	const a = await post(
		r.id,
		r.gh,
		body(w, r.id, {
			files: files({ path: 'docs/status/a.md', content: 'one\nmine\nmain\ntwo\n' }),
			explanation: explanation(['docs/status/a.md']),
			usage: [],
		}),
	);
	return { a, run: runOf(r.id) };
})();
check(
	'budget spent: a mechanical-only result is still proposed',
	mechanicalOnly.run.status,
	'proposed',
);
const byModel = await failFast({ usage });
check(
	'budget spent: a resolution the model wrote is not kept — needs_person with the budget sentence',
	[byModel.run.status, byModel.run.reason, byModel.run.files],
	[
		'needs_person',
		"This month's fix-run budget is spent, so only the mechanical part could be kept; resolve the rest by hand.",
		null,
	],
);
ledger.length = 0;

// a run that ended gets no result
const w7 = world(SRC_BASE, { 'src/a.ts': '1\n' }, { 'src/a.ts': '2\n' });
const C = await started(w7, ADMIN, 9500);
const stopped = await discard(ADMIN, w7.n, C.id);
check(
	'discard: a run still working is stopped — its Actions run cancelled, the run cancelled',
	[
		stopped.status,
		(stopped.body.run as Json).status,
		callsOf().includes('POST /actions/runs/9500/cancel'),
	],
	[200, 'cancelled', true],
);
const late = await post(C.id, C.gh, body(w7, C.id));
check(
	'result: one that arrives after is 409, and its spend is still recorded',
	[late.status, ledger.some((s) => s.runId === `merge:${C.id}`)],
	[409, true],
);
ledger.length = 0;

// ═════════════════════════════════════════════════════════════════════════════
// The backstop
// ═════════════════════════════════════════════════════════════════════════════
const mk = async (
	ghRunId: number | null,
	status = 'in_progress',
	conclusion: string | null = null,
) => {
	const w = world(SRC_BASE, { 'src/a.ts': '1\n' }, { 'src/a.ts': '2\n' });
	gh.dispatch = () =>
		ghRunId === null ? answer(204, null) : answer(200, { workflow_run_id: ghRunId });
	const a = await resolve(ADMIN, w.n);
	const id = runIdOf(a);
	if (ghRunId !== null) {
		gh.actionsRuns.set(ghRunId, {
			id: ghRunId,
			display_title: `Merge main ${id}`,
			path: '.github/workflows/merge-main.yml',
			status,
			conclusion,
			actor: { login: BOT },
			created_at: new Date(clock).toISOString(),
		});
	}
	return { id, w };
};
const born = clock;
const bUnbound = await mk(null);
const bDone = await mk(9601, 'completed', 'failure');
const bCancelled = await mk(9602, 'completed', 'cancelled');
const bGone = await mk(9603);
gh.actionsRuns.delete(9603);
const bGoing = await mk(9604, 'in_progress');
const bQueued = await mk(9605, 'queued');
gh.listed = [];
await actions.backstopMergeRuns(app, born + 5 * MIN);
check(
	'backstop: an Actions run that completed with no result → failed (cancelled when GitHub cancelled it); one GitHub no longer has → failed; one going → running; a queued one waits; an unbound one is looked for',
	[bDone, bCancelled, bGone, bGoing, bQueued, bUnbound].map((b) => runOf(b.id).status),
	['failed', 'cancelled', 'failed', 'running', 'dispatched', 'dispatched'],
);
check(
	'backstop: the reasons are the launcher’s',
	[runOf(bDone.id).reason, runOf(bCancelled.id).reason, runOf(bGone.id).reason],
	[
		'The Actions run ended without a result.',
		'The Actions run was cancelled.',
		'GitHub no longer has the Actions run.',
	],
);
gh.listed = [
	{
		id: 9610,
		display_title: `Merge main ${bUnbound.id}`,
		actor: { login: BOT },
		created_at: new Date(born + 1000).toISOString(),
		status: 'queued',
	},
];
await actions.backstopMergeRuns(app, born + 6 * MIN);
check(
	'backstop: an unbound run found among the workflow’s runs by its run-name and the App’s bot is bound',
	runOf(bUnbound.id).ghRunId,
	9610,
);
gh.listed = [
	{
		id: 9611,
		display_title: `Merge main ${bUnbound.id}`,
		actor: { login: 'a-person' },
		created_at: new Date(born + 1000).toISOString(),
		status: 'queued',
	},
];
const bLost = await mk(null);
await actions.backstopMergeRuns(app, born + 16 * MIN);
check(
	'backstop: an unbound run never found after 15 minutes → failed (a person’s run of the same title does not count)',
	[runOf(bLost.id).status, runOf(bLost.id).reason],
	['failed', 'The Actions run did not start.'],
);
gh.calls.length = 0;
await actions.backstopMergeRuns(app, born + 95 * MIN);
check(
	'backstop: any run past 90 minutes → failed (timed out), its Actions run cancelled',
	[
		runOf(bGoing.id).status,
		runOf(bGoing.id).reason,
		callsOf().includes('POST /actions/runs/9604/cancel'),
	],
	['failed', 'The run timed out.', true],
);
const waiting = await proposed(
	world(SRC_BASE, { 'src/a.ts': '3\n' }, { 'src/a.ts': '2\n' }),
	files({ path: 'src/a.ts', rule: null, choice: 'combined', content: '5\n' }),
);
await actions.backstopMergeRuns(app, born + 400 * MIN);
check(
	'backstop: a proposal waiting for a person is never touched',
	runOf(waiting.id).status,
	'proposed',
);
check(
	'backstop: it rides the once-a-minute link sync (no loop of its own)',
	[
		text('../src/lib/server/bugReports.ts').includes('await backstopMergeRuns(app)'),
		/setInterval|setTimeout/.test(text('../src/lib/server/pipelineMergeRunsActions.ts')),
	],
	[true, false],
);
for (const r of runs) if (r.status === 'proposed' && r.id !== waiting.id) r.status = 'discarded';
runOf(waiting.id).status = 'discarded';

// ═════════════════════════════════════════════════════════════════════════════
// Accept
// ═════════════════════════════════════════════════════════════════════════════
const writesOf = () => gh.calls.filter((c) => c.method !== 'GET').map(keyOf);
const ACCEPT_BASE = {
	'src/a.ts': 'const a = 1;\n',
	'src/b.ts': 'const b = 1;\n',
	'src/head-only.ts': 'h0\n',
	'src/main-only.ts': 'm0\n',
	'src/exec.sh': { content: '#!/bin/sh\n', mode: '100755' },
	'docs/status/a.md': DOC_BASE,
	'untouched.txt': 'u\n',
	'scripts/runtime-bytes/lines.json': '{"a":1}\n',
};
const w8 = world(
	ACCEPT_BASE,
	{
		'src/a.ts': 'const a = 3;\n',
		'src/head-only.ts': 'h1\n',
		'src/new-head.ts': 'new\n',
		'docs/status/a.md': 'one\nmine\ntwo\n',
		'src/exec.sh': { content: '#!/bin/sh\necho head\n', mode: '100755' },
		'scripts/runtime-bytes/lines.json': '{"a":3}\n',
	},
	{
		'src/a.ts': 'const a = 2;\n',
		'src/main-only.ts': 'm1\n',
		'docs/status/a.md': 'one\nmain\ntwo\n',
		'scripts/runtime-bytes/lines.json': '{"a":2}\n',
	},
);
const P8 = await proposed(
	w8,
	[
		...files({ path: 'src/a.ts', rule: null, choice: 'combined', content: 'const a = 5;\n' }),
		...files({ path: 'docs/status/a.md', content: 'one\nmine\nmain\ntwo\n' }),
		...files({
			path: 'scripts/runtime-bytes/lines.json',
			rule: 'runtime-bytes',
			choice: 'main',
			content: '{"a":2}\n',
		}),
	],
	explanation(['src/a.ts', 'docs/status/a.md']),
);
gh.calls.length = 0;
changesForgotten = 0;
const mainBefore = git.refs.get('main');
const okAccept = await accept(ADMIN, w8.n, P8.id, w8.head);
const commit = gh.madeCommits.at(-1)!;
const treeAfter = git.trees.get(git.commits.get(commit.sha)!.tree)!;
const content = (path: string) => git.blobs.get(treeAfter.get(path)?.sha ?? '');
check(
	'accept: 200, the run accepted with the merge commit, the change list forgotten',
	[
		okAccept.status,
		okAccept.body.mergeSha === commit.sha,
		runOf(P8.id).status,
		runOf(P8.id).mergeSha === commit.sha,
		runOf(P8.id).acceptedBy,
		changesForgotten > 0,
	],
	[200, true, 'accepted', true, 'Gualtiero', true],
);
check(
	'accept: the merge commit’s parents are [head, main at the run’s SHA]; the branch moved by a fast-forward (PATCH, force false), main untouched',
	[
		commit.parents,
		gh.madeCommits.length,
		git.refs.get(w8.pull.head.ref) === commit.sha,
		git.refs.get('main') === mainBefore,
	],
	[[w8.head, w8.main], 1, true, true],
);
const patch = gh.calls.find((c) => c.method === 'PATCH')!;
check(
	'accept: the ref update is PATCH git/refs/heads/<branch> with force false',
	[patch.path, patch.body],
	[`/git/refs/heads/${w8.pull.head.ref}`, { sha: commit.sha, force: false }],
);
check(
	'accept: the writes in order — blobs for the run’s files, one tree, one commit, then the ref',
	writesOf().map((k) => k.replace(/refs\/heads\/.*/, 'refs/heads/<branch>')),
	[
		'POST /git/blobs',
		'POST /git/blobs',
		'POST /git/blobs',
		'POST /git/trees',
		'POST /git/commits',
		'PATCH /git/refs/heads/<branch>',
	],
);
check(
	'accept: a path both sides changed takes the run’s content; a pending rule file takes main’s',
	[content('src/a.ts'), content('docs/status/a.md'), content('scripts/runtime-bytes/lines.json')],
	['const a = 5;\n', 'one\nmine\nmain\ntwo\n', '{"a":2}\n'],
);
check(
	'accept: a path only the head changed takes the head’s (new, modified, mode kept); only main changed takes main’s; neither side → untouched',
	[
		content('src/head-only.ts'),
		content('src/new-head.ts'),
		treeAfter.get('src/exec.sh')?.mode,
		content('src/exec.sh'),
		content('src/main-only.ts'),
		treeAfter.get('untouched.txt')?.sha === filesOfCommit(w8.main).get('untouched.txt')?.sha,
		treeAfter.get('src/b.ts')?.sha === filesOfCommit(w8.base).get('src/b.ts')?.sha,
	],
	['h1\n', 'new\n', '100755', '#!/bin/sh\necho head\n', 'm1\n', true, true],
);
const message = String(commit.message);
check(
	'accept: the message names the branch, main’s short SHA, each file’s choice, then "Accepted by <name> in Pipeline Changes (merge run <id>)"',
	[
		message.split('\n')[0],
		message.includes(`main at ${w8.main.slice(0, 7)}`) || message.includes(w8.main.slice(0, 7)),
		message.includes('- src/a.ts: combined both'),
		message.includes('- docs/status/a.md: kept both (docs lines kept from both)'),
		message.includes(
			"- scripts/runtime-bytes/lines.json: took main's (runtime bytes still to re-record)",
		),
		message.endsWith(`Accepted by Gualtiero in Pipeline Changes (merge run ${P8.id})`),
	],
	[`Merge main into ${w8.pull.head.ref}`, true, true, true, true, true],
);
const resend = await accept(ADMIN, w8.n, P8.id, w8.head);
check(
	'accept: a resend after it landed answers the merge it made, writing nothing',
	[resend.status, resend.body.already, resend.body.mergeSha === commit.sha, gh.madeCommits.length],
	[200, true, true, 1],
);

// a path neither side changed is untouchable; one only one side changed too
const w9n = () =>
	world(
		ACCEPT_BASE,
		{ 'src/a.ts': 'const a = 3;\n', 'src/head-only.ts': 'h1\n' },
		{ 'src/a.ts': 'const a = 2;\n', 'src/main-only.ts': 'm1\n' },
	);
const refuse9 = async (f: MergeRunFile[], label: string, said: string) => {
	const p = await proposed(w9n(), f);
	gh.calls.length = 0;
	const a = await accept(ADMIN, p.w.n, p.id, p.w.head);
	check(
		`accept: ${label} → needs_person naming the rule, nothing written to GitHub`,
		[a.status, a.body.code, runOf(p.id).status, runOf(p.id).reason, writesOf()],
		[409, 'needs_person', 'needs_person', `The change was refused (${said}).`, []],
	);
};
const both = files({ path: 'src/a.ts', rule: null, choice: 'combined', content: 'const a = 5;\n' });
await refuse9(
	[...both, ...files({ path: 'untouched.txt', rule: null, choice: 'combined', content: 'evil\n' })],
	'a path neither side changed',
	'it writes a path that neither side both changed',
);
await refuse9(
	[
		...both,
		...files({ path: 'src/head-only.ts', rule: null, choice: 'combined', content: 'evil\n' }),
	],
	'a path only the head changed',
	'it writes a path that neither side both changed',
);
await refuse9(
	[
		...both,
		...files({ path: 'src/main-only.ts', rule: null, choice: 'combined', content: 'evil\n' }),
	],
	'a path only main changed',
	'it writes a path that neither side both changed',
);
await refuse9(
	files({
		path: 'scripts/runtime-bytes/lines.json',
		rule: 'runtime-bytes',
		choice: 'main',
		content: '{}\n',
	}),
	'a both-changed path with no resolution',
	'a path both sides changed has no resolution',
);
await refuse9(
	files({ path: 'src/a.ts', rule: null, choice: 'main', content: 'const a = 9;\n' }),
	'a choice of main whose content is not main’s',
	"a file's choice does not match its content",
);
await refuse9(
	files({
		path: 'src/a.ts',
		rule: null,
		choice: 'combined',
		content: 'x'.repeat(10) + `\nconst k = "ghp_${'E'.repeat(36)}";\n`,
	}),
	'a secret in a line neither side had',
	'secret scan: a secret in a line neither side had',
);
await refuse9(
	files({
		path: 'src/a.ts',
		rule: null,
		choice: 'combined',
		content: 'const a = 5;\n// eslint-disable-next-line\n',
	}),
	'a comment that switches a check off',
	'it adds a suppression comment (eslint-disable)',
);

// a choice of main / change carries that side’s own content
const w10 = world(ACCEPT_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
const P10 = await proposed(
	w10,
	files({ path: 'src/a.ts', rule: null, choice: 'main', content: 'const a = 2;\n' }),
	explanation(['src/a.ts']),
);
const a10 = await accept(ADMIN, w10.n, P10.id, w10.head);
check(
	'accept: a choice of main with main’s own content is taken',
	[a10.status, runOf(P10.id).status],
	[200, 'accepted'],
);

// stale
const w11 = world(ACCEPT_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
const P11 = await proposed(w11, both);
const newHead = putCommit(putTree({ ...ACCEPT_BASE, 'src/a.ts': 'pushed\n' }), [w11.head]);
git.refs.set(w11.pull.head.ref, newHead);
w11.pull.head.sha = newHead;
gh.calls.length = 0;
const s11 = await accept(ADMIN, w11.n, P11.id, w11.head);
check(
	'accept: the branch moved → 409 stale, the run stale with the sentence, nothing written',
	[s11.status, s11.body.code, runOf(P11.id).status, runOf(P11.id).reason, writesOf()],
	[409, 'stale', 'stale', 'The branch moved; resolve again.', []],
);
const w12 = world(ACCEPT_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
const P12 = await proposed(w12, both);
const s12 = await accept(ADMIN, w12.n, P12.id, 'f'.repeat(40));
check(
	'accept: the card showed another head → stale too',
	[s12.status, runOf(P12.id).status],
	[409, 'stale'],
);

const staleMain = async (touched: Record<string, string>, label: string, expected: string) => {
	const w = world(ACCEPT_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
	const p = await proposed(w, both);
	const newer = putCommit(putTree({ ...ACCEPT_BASE, 'src/a.ts': 'const a = 2;\n', ...touched }), [
		w.main,
	]);
	git.refs.set('main', newer);
	gh.calls.length = 0;
	const a = await accept(ADMIN, w.n, p.id, w.head);
	check(
		`accept: ${label}`,
		[a.status, runOf(p.id).status, writesOf().length],
		expected === 'goes' ? [200, 'accepted', 4] : [409, 'stale', 0],
	);
	return runOf(p.id);
};
await staleMain(
	{ 'src/a.ts': 'main moved this file again\n' },
	'main changed a conflicted file since the run → stale, nothing written',
	'stale',
);
await staleMain(
	{ 'src/b.ts': 'elsewhere\n' },
	'main changed another file → still goes, the run’s SHA stays the parent',
	'goes',
);
{
	const w = world(ACCEPT_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
	const p = await proposed(w, both);
	git.refs.set(
		'main',
		putCommit(putTree({ ...ACCEPT_BASE, 'src/a.ts': 'const a = 2;\n' }), [w.main]),
	);
	gh.compareTooLong = 300;
	gh.calls.length = 0;
	const a = await accept(ADMIN, w.n, p.id, w.head);
	gh.compareTooLong = 0;
	check(
		'accept: a compare listing 300 files is cut short, not complete: one request, no paging',
		gh.calls.filter((c) => c.path.includes('/compare/') && c.path.includes('...main')).length,
		1,
	);
	check(
		'accept: main moved too far for the compare to list whole → stale',
		[a.status, runOf(p.id).status],
		[409, 'stale'],
	);
	const w2b = world(
		ACCEPT_BASE,
		{ 'src/a.ts': 'const a = 3;\n' },
		{ 'src/a.ts': 'const a = 2;\n' },
	);
	const p2 = await proposed(w2b, both);
	git.refs.set('main', putCommit(putTree({ ...ACCEPT_BASE }), [w.base]));
	const a2 = await accept(ADMIN, w2b.n, p2.id, w2b.head);
	check(
		'accept: main no longer holds the run’s SHA (rewritten) → stale',
		[a2.status, runOf(p2.id).status],
		[409, 'stale'],
	);
}

// the merge base: a run kept its own, and Accept refuses another
{
	const w = world(ACCEPT_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
	const p = await proposed(w, both);
	check('base: the result’s baseSha is stored', runOf(p.id).baseSha, w.base);
	gh.mergeBase = 'e'.repeat(40);
	gh.calls.length = 0;
	const a = await accept(ADMIN, w.n, p.id, w.head);
	check(
		'accept: a merge base other than the stored one → stale with the sentence, nothing written',
		[a.status, a.body.code, runOf(p.id).status, runOf(p.id).reason, writesOf()],
		[
			409,
			'stale',
			'stale',
			'main and this change were merged against another base; resolve again',
			[],
		],
	);
}

// #1958's edge cases: a file and a folder in one place, and a file added in a folder the other side emptied
{
	const refuseClash = async (label: string, w: World, prep: () => void = () => {}) => {
		prep();
		const p = await proposed(w, both);
		gh.calls.length = 0;
		const a = await accept(ADMIN, w.n, p.id, w.head);
		check(
			`accept: ${label} → needs_person, nothing written`,
			[a.status, runOf(p.id).status, writesOf()],
			[409, 'needs_person', []],
		);
	};
	const treeOf = (sha: string) => git.trees.get(git.commits.get(sha)!.tree)!;
	const withDir = { ...ACCEPT_BASE, 'dir/x.txt': 'x\n' };
	const wDel = world(
		withDir,
		{ 'src/a.ts': 'const a = 3;\n', 'dir/new.txt': 'n\n' },
		{ 'src/a.ts': 'const a = 2;\n' },
	);
	await refuseClash('a file the head added in a folder main emptied', wDel, () =>
		treeOf(wDel.main).delete('dir/x.txt'),
	);
	const wMain = world(
		withDir,
		{ 'src/a.ts': 'const a = 3;\n' },
		{ 'src/a.ts': 'const a = 2;\n', 'dir/new.txt': 'n\n' },
	);
	await refuseClash('a file main added in a folder the head emptied', wMain, () =>
		treeOf(wMain.head).delete('dir/x.txt'),
	);
	const wFile = world(
		ACCEPT_BASE,
		{ 'src/a.ts': 'const a = 3;\n', clash: 'file\n' },
		{ 'src/a.ts': 'const a = 2;\n', 'clash/b.txt': 'b\n' },
	);
	await refuseClash('a file on the head where main has a folder', wFile);
	const wFolder = world(
		ACCEPT_BASE,
		{ 'src/a.ts': 'const a = 3;\n', 'clash/b.txt': 'b\n' },
		{ 'src/a.ts': 'const a = 2;\n', clash: 'file\n' },
	);
	await refuseClash('a folder on the head where main has a file', wFolder);
	const wOk = world(
		withDir,
		{ 'src/a.ts': 'const a = 3;\n', 'dir/new.txt': 'n\n' },
		{ 'src/a.ts': 'const a = 2;\n', 'dir/y.txt': 'y\n' },
	);
	const pOk = await proposed(wOk, both);
	check(
		'accept: a file added in a folder main only added to is no conflict',
		(await accept(ADMIN, wOk.n, pOk.id, wOk.head)).status,
		200,
	);
}

// a GitHub failure that may pass is waited out, never the end of the run
{
	const w = world(ACCEPT_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
	const p = await proposed(w, both);
	git.refs.set(
		'main',
		putCommit(putTree({ ...ACCEPT_BASE, 'src/a.ts': 'const a = 2;\n', 'src/b.ts': 'z\n' }), [
			w.main,
		]),
	);
	gh.fail.set(`GET /compare/${w.main}...main`, [{ status: 502, message: 'bad gateway' }]);
	const a = await accept(ADMIN, w.n, p.id, w.head);
	check(
		'accept: a 5xx reading main’s changes → 502, the proposal still waiting',
		[a.status, runOf(p.id).status],
		[502, 'proposed'],
	);
	const again = await accept(ADMIN, w.n, p.id, w.head);
	check(
		'accept: and the retry goes through',
		[again.status, runOf(p.id).status],
		[200, 'accepted'],
	);
	const w2 = world(ACCEPT_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
	const p2 = await proposed(w2, both);
	gh.fail.set(`GET /git/trees/${git.commits.get(w2.head)!.tree}`, [
		{ status: 503, message: 'down' },
	]);
	const a2 = await accept(ADMIN, w2.n, p2.id, w2.head);
	check(
		'accept: a 5xx reading a tree → 502, still proposed',
		[a2.status, runOf(p2.id).status],
		[502, 'proposed'],
	);
	gh.fail.clear();
	gh.dispatch = () => answer(429, { message: 'secondary rate limit' });
	const w3 = world(SRC_BASE, { 'src/a.ts': 'x\n' }, { 'src/a.ts': 'y\n' });
	check(
		'dispatch: a 429 is a limit to wait out — the run stays dispatched',
		((await resolve(ADMIN, w3.n)).body.run as Json).status,
		'dispatched',
	);
	gh.dispatch = () => answer(200, { workflow_run_id: 9001 });
	const bk = await mk(9701, 'in_progress');
	gh.fail.set('GET /actions/runs/9701', [{ status: 502, message: 'bad gateway' }]);
	await actions.backstopMergeRuns(app, clock + 5 * MIN);
	check(
		'backstop: a 5xx reading the Actions run leaves the run as it was for the next pass',
		runOf(bk.id).status,
		'dispatched',
	);
	gh.fail.clear();
	await actions.backstopMergeRuns(app, clock + 5 * MIN);
	check('backstop: the next pass reads it', runOf(bk.id).status, 'running');
}

// state refusals
const w13 = world(ACCEPT_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
check(
	'accept: without the merge capability → 403',
	(await accept(TESTER, w13.n, 'aaaaaaaaaa', w13.head)).status,
	403,
);
check(
	'accept: a run that is none of the change’s → 404',
	(await accept(ADMIN, w13.n, 'aaaaaaaaaa', w13.head)).status,
	404,
);
check(
	'accept: a bad head sha → 400',
	(
		await call(acceptRoute.POST, {
			user: ADMIN,
			params: { number: String(w13.n), id: 'aaaaaaaaaa' },
			json: { headSha: 'x' },
		})
	).status,
	400,
);
const P13 = await proposed(w13, both);
w13.pull.labels = [{ name: 'on-hold' }];
check(
	'accept: a change put on hold meanwhile → 409 on_hold',
	(await accept(ADMIN, w13.n, P13.id, w13.head)).body.code,
	'on_hold',
);
w13.pull.labels = [];
w13.pull.state = 'closed';
check(
	'accept: a closed change → 409 not_open',
	(await accept(ADMIN, w13.n, P13.id, w13.head)).body.code,
	'not_open',
);
w13.pull.state = 'open';
check(
	'accept: another change’s number → 404',
	(await accept(ADMIN, w13.n + 1, P13.id, w13.head)).status,
	404,
);
runOf(P13.id).status = 'discarded';
check(
	'accept: a discarded run → 409 not_proposed',
	(await accept(ADMIN, w13.n, P13.id, w13.head)).body.code,
	'not_proposed',
);

// ── the branch Accept writes to (ADR-0015 §5) ───────────────────────────────
// Git allows `#` and `%` in a branch name and `fetch` drops everything from a `#`: a conflicted
// pull request from `main#x` once PATCHed `refs/heads/main` with a commit whose parents are
// [head, main], a fast-forward that `force: false` does not stop. Accept refuses such a name, a
// branch renamed since the start, and encodes every ref it writes.
const refPatches = () => gh.calls.filter((c) => c.method === 'PATCH');
for (const [label, branch] of [
	['a # in the name', 'main#x'],
	['a % in the name', 'feat%2Fmain'],
	['a space and a ? in the name', 'feat x?y'],
	['a .. in the name', 'feat..x'],
	['a leading slash', '/feat'],
	['a segment ending .lock', 'feat/x.lock'],
	['a refs/ prefix', 'refs/heads/main'],
	['HEAD', 'HEAD'],
	['a leading dash', '-feat'],
] as const) {
	// a run is only started on a plain name (below), so make the name unsafe after the proposal
	const wb = world(ACCEPT_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
	const pb = await proposed(wb, both);
	runOf(pb.id).branch = branch;
	wb.pull.head.ref = branch;
	const mainBefore = git.refs.get('main');
	gh.calls.length = 0;
	const ab = await accept(ADMIN, wb.n, pb.id, wb.head);
	check(
		`accept: a branch with ${label} is refused with a sentence, nothing written, main not moved`,
		[
			ab.status,
			ab.body.code,
			typeof ab.body.error === 'string' && ab.body.error.includes('will not push'),
			writesOf(),
			refPatches().length,
			git.refs.get('main') === mainBefore,
			runOf(pb.id).status,
		],
		[409, 'unsafe_branch', true, [], 0, true, 'proposed'],
	);
}
{
	const wr = world(ACCEPT_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
	const pr = await proposed(wr, both);
	const ran = wr.pull.head.ref;
	wr.pull.head.ref = 'main';
	gh.calls.length = 0;
	const ar = await accept(ADMIN, wr.n, pr.id, wr.head);
	check(
		'accept: a branch renamed since the start (now `main`) → stale, nothing written',
		[ar.status, ar.body.code, runOf(pr.id).status, writesOf(), refPatches().length],
		[409, 'stale', 'stale', [], 0],
	);
	wr.pull.head.ref = ran;
}
{
	const wn = world(
		ACCEPT_BASE,
		{ 'src/a.ts': 'const a = 3;\n' },
		{ 'src/a.ts': 'const a = 2;\n' },
		{ branch: 'claude/feat-x.1_y' },
	);
	const pn = await proposed(wn, both);
	gh.calls.length = 0;
	const an = await accept(ADMIN, wn.n, pn.id, wn.head);
	check(
		'accept: a plain nested branch is pushed, to its own ref path, once',
		[an.status, refPatches().map((c) => c.path)],
		[200, ['/git/refs/heads/claude/feat-x.1_y']],
	);
}
const paths = await import(src('lib/server/githubPaths.ts'));
check(
	'githubPaths: each segment is encoded, the slashes kept; # and % cannot cut or alter a ref',
	[paths.encodePath('main#x'), paths.encodePath('a/b c/d%e?f'), paths.encodePath('feat/x')],
	['main%23x', 'a/b%20c/d%25e%3Ff', 'feat/x'],
);
check(
	'githubPaths: a plain branch name is letters, digits, - _ . and /, with no .., no edge or empty segment',
	[
		'main',
		'claude/feat-x.1_y',
		'bug-12-fix-0123456789',
		'a#b',
		'a%b',
		'a b',
		'refs/heads/x',
		'heads/x',
		'HEAD',
		'-x',
		'a..b',
		'/a',
		'a/',
		'a//b',
		'a/.b',
		'a.',
		'a.lock',
		'',
		'é',
		'a\\b',
	].map((n) => paths.isPlainBranchName(n)),
	[true, true, true, ...Array.from({ length: 17 }, () => false)],
);
{
	// a pull request from `main#x` never spends a run
	const wu = world(
		ACCEPT_BASE,
		{ 'src/a.ts': 'const a = 3;\n' },
		{ 'src/a.ts': 'const a = 2;\n' },
		{ branch: 'main#x' },
	);
	const before = runs.length;
	gh.calls.length = 0;
	const au = await resolve(ADMIN, wu.n);
	check(
		'start: a branch the pipeline will not push to is refused up front — no run, nothing dispatched',
		[au.status, au.body.code, runs.length === before, callsOf()],
		[409, 'branch_unsafe', true, []],
	);
}
{
	// Every GitHub URL path the launcher builds from a branch or another name goes through
	// refReadPath/refWritePath (githubPaths.ts), and nothing else in src builds one from a name.
	// Whole template literals are read (a path split over lines is still one), and a call site is
	// allowed by its file's repo-relative path and its template, never by a variable's name.
	const root = new URL('../', import.meta.url);
	const walk = (dir: URL): URL[] =>
		readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
			e.isDirectory()
				? walk(new URL(`${e.name}/`, dir))
				: /\.(ts|svelte)$/.test(e.name)
					? [new URL(e.name, dir)]
					: [],
		);
	/** The outermost template literals of a source, nested ones inside their `${…}` kept whole. */
	const templates = (src: string): string[] => {
		const out: string[] = [];
		const readTemplate = (from: number): number => {
			let i = from + 1;
			while (i < src.length && src[i] !== '`') {
				if (src[i] === '\\') i += 2;
				else if (src[i] === '$' && src[i + 1] === '{') i = readExpression(i + 2);
				else i++;
			}
			return i + 1;
		};
		const readExpression = (from: number): number => {
			let i = from;
			let depth = 1;
			while (i < src.length && depth > 0) {
				const c = src[i];
				if (c === '`') i = readTemplate(i);
				else if (c === "'" || c === '"') {
					i++;
					while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
					i++;
				} else {
					if (c === '{') depth++;
					else if (c === '}') depth--;
					i++;
				}
			}
			return i;
		};
		let i = 0;
		while (i < src.length) {
			if (src[i] === '`') {
				const end = readTemplate(i);
				out.push(src.slice(i, end));
				i = end;
			} else i++;
		}
		return out;
	};
	const PATTERNS = [
		/git\/refs?\/heads/,
		/git\/refs?\/\$\{/,
		/\/branches\/\$\{/,
		/matching-refs/,
		/[?&]ref=\$\{/,
		/\/compare\/[^`]*\$\{/,
		/\/commits\/\$\{/,
		/[?&]branch=\$\{/,
	];
	const ALLOWED = new Set<string>([
		'src/lib/server/bugFixRuns.ts | `/repos/${r}/git/commits/${sha}`',
		'src/lib/server/bugFixRuns.ts | `/repos/${r}/git/commits/${head}`',
		'src/lib/server/githubPaths.ts | `GET /repos/<repo>/git/ref/heads/<branch>`',
		'src/lib/server/githubPaths.ts | `/repos/${repo}/git/ref/heads/${encodePath(branch)}`',
		'src/lib/server/githubPaths.ts | `DELETE /repos/<repo>/git/refs/heads/<branch>`',
		'src/lib/server/githubPaths.ts | `/repos/${repo}/git/refs/heads/${encodePath(branch)}`',
		'src/lib/server/pipelineAgents.ts | `/repos/${repo()}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`',
		'src/lib/server/pipelineAgents.ts | `/repos/${repo()}/contents/${AGENTS_DIR}?ref=${sha}`',
		'src/lib/server/pipelineChanges.ts | `/repos/${r}/commits/${sha}/check-runs?per_page=${PAGE}`',
		'src/lib/server/pipelineChanges.ts | `/repos/${r}/commits/${sha}/status`',
		'src/lib/server/pipelineChanges.ts | `/repos/${repo()}/compare/${BASE_BRANCH}...${headSha}?per_page=1`',
		'src/lib/server/pipelineChanges.ts | `/repos/${repo()}/commits/${headSha}`',
		'src/lib/server/pipelineMerge.ts | `/repos/${repo()}/git/commits/${sha}`',
		'src/lib/server/pipelineMerge.ts | `/repos/${r}/git/commits/${merge.mergeSha}`',
		'src/lib/server/pipelineMerge.ts | `/repos/${r}/git/commits/${squash.parents[0].sha}`',
		'src/lib/server/pipelineMerge.ts | `/repos/${r}/git/commits/${tip}`',
		'src/lib/server/pipelineMergeRuns.ts | `/repos/${repo()}/compare/${from}...${BASE_BRANCH}`',
		'src/lib/server/pipelineMergeRuns.ts | `/repos/${r}/git/commits/${commit}`',
		'src/lib/server/pipelineMergeRuns.ts | `/repos/${r}/compare/${run.mainSha}...${run.headSha}?per_page=1`',
		'src/lib/server/pipelineMergeRuns.ts | `/repos/${repo()}/compare/${newest.mainSha}...${BASE_BRANCH}?per_page=1`',
		'src/lib/server/pipelineMergeRuns.ts | `/repos/${repo()}/commits/${pull.head.sha}`',
		'src/lib/server/pipelineMergeRunsActions.ts | `/repos/${repo()}/compare/${acceptSha}...${tip}`',
	]);
	const found: string[] = [];
	for (const file of walk(new URL('src/', root))) {
		const rel = file.pathname.slice(root.pathname.length);
		for (const t of templates(readFileSync(file, 'utf8'))) {
			const flat = t.replace(/\s+/g, ' ');
			if (PATTERNS.some((re) => re.test(flat))) found.push(`${rel} | ${flat}`);
		}
	}
	const strays = found.filter((f) => !ALLOWED.has(f));
	check(
		'refs: every GitHub path built from a branch or a name goes through refReadPath/refWritePath or is an allowed call site (a SHA, a launcher-made name, an encoded value)',
		strays,
		[],
	);
	check(
		'refs: Accept moves the run’s own branch through refWritePath, and no ref URL is built in pipelineMergeRuns.ts',
		[
			text('../src/lib/server/pipelineMergeRuns.ts').includes('refWritePath(r, run.branch)'),
			/git\/refs?\/heads/.test(text('../src/lib/server/pipelineMergeRuns.ts')),
		],
		[true, false],
	);
}

// the Accept claim (ADR-0015 §5): `proposed → accepting` in the database before any GitHub write,
// with a lease; Discard acts only from `proposed`, so on any replica one of them wins whole
const w0 = () =>
	world(ACCEPT_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
const lapse = (id: string) => {
	runOf(id).acceptingAt = new Date(Date.now() - 10 * MIN);
	runOf(id).acceptClaim ??= `claim-${id}`;
};
{
	const w = w0();
	const p = await proposed(w, both);
	// Whichever takes the claim first wins whole: the branch moved if and only if the row says so.
	const [a, d] = await Promise.all([accept(ADMIN, w.n, p.id, w.head), discard(ADMIN, w.n, p.id)]);
	const one = (who: Answer[], id: string, w1: World) => [
		who.filter((r) => r.status === 200).length,
		(runOf(id).status === 'accepted') === (git.refs.get(w1.pull.head.ref) !== w1.head),
	];
	check(
		'accept + discard at once: one wins, and the branch moved only if the row says accepted',
		one([a, d], p.id, w),
		[1, true],
	);
	const w2 = w0();
	const p2 = await proposed(w2, both);
	const [d2, a2] = await Promise.all([
		discard(ADMIN, w2.n, p2.id),
		accept(ADMIN, w2.n, p2.id, w2.head),
	]);
	check(
		'discard + accept at once: one wins, and the branch moved only if the row says accepted',
		one([a2, d2], p2.id, w2),
		[1, true],
	);
	// A Discard from another replica lands after Accept took the claim: it finds nothing to settle.
	const w3 = w0();
	const p3 = await proposed(w3, both);
	let late: unknown = 'not run';
	gh.beforePatch = () => {
		void store
			.settleMergeRun(p3.id, ['proposed'], { status: 'discarded', reason: 'x' })
			.then((r) => (late = r));
	};
	const a3 = await accept(ADMIN, w3.n, p3.id, w3.head);
	check(
		'accept: a Discard from another replica after the claim settles nothing; the row says accepted',
		[a3.status, late, runOf(p3.id).status, git.refs.get(w3.pull.head.ref) !== w3.head],
		[200, null, 'accepted', true],
	);
}
{
	// the claim is held (by another replica): a second Accept and a Discard are told so, nothing written
	const w = w0();
	const p = await proposed(w, both);
	runOf(p.id).status = 'accepting';
	runOf(p.id).acceptingAt = new Date();
	gh.calls.length = 0;
	const a = await accept(ADMIN, w.n, p.id, w.head);
	const d = await discard(ADMIN, w.n, p.id);
	check(
		'accept/discard: while another Accept holds the claim both are refused (409 accepting), nothing written',
		[a.status, a.body.code, d.status, d.body.code, runOf(p.id).status, writesOf()],
		[409, 'accepting', 409, 'accepting', 'accepting', []],
	);
	// its lease ran out and the branch never moved: the next Accept takes the claim over and goes
	lapse(p.id);
	const again = await accept(ADMIN, w.n, p.id, w.head);
	check(
		'accept: an expired claim is taken over and the merge goes',
		[again.status, runOf(p.id).status],
		[200, 'accepted'],
	);
}
{
	// the launcher died after the push: the lease ran out, the branch's tip is the commit it recorded
	const w = w0();
	const p = await proposed(w, both);
	const landed = putCommit(putTree({ ...ACCEPT_BASE, 'src/a.ts': 'const a = 5;\n' }), [
		w.head,
		w.main,
	]);
	git.refs.set(w.pull.head.ref, landed);
	w.pull.head.sha = landed;
	runOf(p.id).status = 'accepting';
	runOf(p.id).acceptSha = landed;
	lapse(p.id);
	gh.calls.length = 0;
	const a = await accept(ADMIN, w.n, p.id, w.head);
	check(
		'accept: a lost answer — the tip is exactly the commit this Accept recorded → accepted without writing',
		[a.status, a.body.already, runOf(p.id).status, runOf(p.id).mergeSha === landed, writesOf()],
		[200, true, 'accepted', true, []],
	);
}
{
	// anyone can push a commit with this run's two parents and its (public) id in the message
	const w = w0();
	const p = await proposed(w, both);
	const forged = putCommit(
		putTree({ ...ACCEPT_BASE, 'src/a.ts': 'evil\n' }),
		[w.head, w.main],
		undefined,
		`Merge main into x\n\nAccepted by Someone in Pipeline Changes (merge run ${p.id})`,
	);
	git.refs.set(w.pull.head.ref, forged);
	w.pull.head.sha = forged;
	runOf(p.id).status = 'accepting';
	lapse(p.id);
	gh.calls.length = 0;
	const a = await accept(ADMIN, w.n, p.id, w.head);
	check(
		'accept: a pushed commit with the run’s parents and id is NOT its merge (only the recorded SHA is) → stale, nothing written',
		[a.status, runOf(p.id).status, writesOf()],
		[409, 'stale', []],
	);
	// and a forged one over the branch is not "accepted" by the backstop either
	const w2 = w0();
	const p2 = await proposed(w2, both);
	const f2 = putCommit(putTree({ ...ACCEPT_BASE, 'src/a.ts': 'evil\n' }), [w2.head, w2.main]);
	git.refs.set(w2.pull.head.ref, f2);
	runOf(p2.id).status = 'accepting';
	runOf(p2.id).acceptSha = 'e'.repeat(40);
	lapse(p2.id);
	await actions.backstopMergeRuns(app, Date.now());
	check(
		'backstop: a lapsed claim whose recorded commit is not the tip is given back (proposed), never accepted',
		[runOf(p2.id).status, runOf(p2.id).acceptingAt, runOf(p2.id).mergeSha],
		['proposed', null, null],
	);
	const w3 = w0();
	const p3 = await proposed(w3, both);
	const mine = putCommit(putTree({ ...ACCEPT_BASE, 'src/a.ts': 'const a = 5;\n' }), [
		w3.head,
		w3.main,
	]);
	git.refs.set(w3.pull.head.ref, mine);
	runOf(p3.id).status = 'accepting';
	runOf(p3.id).acceptSha = mine;
	runOf(p3.id).acceptedById = ADMIN.id;
	runOf(p3.id).acceptedBy = 'An admin';
	lapse(p3.id);
	await actions.backstopMergeRuns(app, Date.now());
	check(
		'backstop: a lapsed claim whose recorded commit is the tip is settled accepted with it',
		[runOf(p3.id).status, runOf(p3.id).mergeSha === mine],
		['accepted', true],
	);
}
{
	// refusals under the claim give it back; a push whose answer is unknown keeps it
	const w = w0();
	const p = await proposed(w, both);
	w.pull.state = 'closed';
	const a = await accept(ADMIN, w.n, p.id, w.head);
	check(
		'accept: a change that is not open → 409 not_open and the claim is given back',
		[a.status, a.body.code, runOf(p.id).status, runOf(p.id).acceptingAt],
		[409, 'not_open', 'proposed', null],
	);
	w.pull.state = 'open';
	gh.fail.set(`PATCH /git/refs/heads/${w.pull.head.ref}`, [
		{ status: 502, message: 'bad gateway' },
	]);
	const b = await accept(ADMIN, w.n, p.id, w.head);
	check(
		'accept: a push whose answer is unknown keeps the claim, with the commit recorded for the next look',
		[b.status >= 500, runOf(p.id).status, typeof runOf(p.id).acceptSha],
		[true, 'accepting', 'string'],
	);
	gh.fail.clear();
}
{
	const w = w0();
	const p = await proposed(w, both);
	git.refs.set(
		'main',
		putCommit(putTree({ ...ACCEPT_BASE, 'src/a.ts': 'const a = 2;\n' }), [w.main]),
	);
	gh.compareTooLong = 299;
	const a = await accept(ADMIN, w.n, p.id, w.head);
	gh.compareTooLong = 0;
	check(
		'accept: a compare listing 299 files (complete) naming none of the run’s → still goes',
		[a.status, runOf(p.id).status],
		[200, 'accepted'],
	);
	const w2 = w0();
	const p2 = await proposed(w2, both);
	git.refs.set(
		'main',
		putCommit(putTree({ ...ACCEPT_BASE, 'src/a.ts': 'const a = 2;\n' }), [w2.main]),
	);
	gh.compareNoFiles = true;
	const a2 = await accept(ADMIN, w2.n, p2.id, w2.head);
	gh.compareNoFiles = false;
	check(
		'accept: a compare that is ahead but lists no files at all is unknown → stale',
		[a2.status, runOf(p2.id).status],
		[409, 'stale'],
	);
}

// the claim is a fence (R2-S1): a holder that is late, or was taken over, does not push
{
	const w = w0();
	const p = await proposed(w, both);
	gh.beforeCommit = () => {
		runOf(p.id).acceptingAt = new Date(Date.now() - 170_000); // 10 s of the 3-minute lease left
	};
	gh.calls.length = 0;
	const a = await accept(ADMIN, w.n, p.id, w.head);
	check(
		'fence: an Accept with under 30 s of its lease left at the moment it would push does not push, and gives the claim back',
		[a.status, a.body.code, refPatches().length, runOf(p.id).status],
		[409, 'accepting', 0, 'proposed'],
	);
	const w2 = w0();
	const p2 = await proposed(w2, both);
	gh.beforeCommit = () => {
		runOf(p2.id).acceptClaim = 'taken-over-by-another';
	};
	gh.calls.length = 0;
	const a2 = await accept(ADMIN, w2.n, p2.id, w2.head);
	check(
		'fence: an Accept whose claim was taken over does not push, and leaves the new holder’s claim alone',
		[a2.status, refPatches().length, runOf(p2.id).status, runOf(p2.id).acceptClaim],
		[409, 0, 'accepting', 'taken-over-by-another'],
	);
	gh.beforeCommit = null;
}
{
	// a person pulled and pushed on top of the merge after it landed (ADR §5): still the run's merge
	const w = w0();
	const p = await proposed(w, both);
	const landed = putCommit(putTree({ ...ACCEPT_BASE, 'src/a.ts': 'const a = 5;\n' }), [
		w.head,
		w.main,
	]);
	const onTop = putCommit(putTree({ ...ACCEPT_BASE, 'src/a.ts': 'const a = 6;\n' }), [landed]);
	git.refs.set(w.pull.head.ref, onTop);
	w.pull.head.sha = onTop;
	Object.assign(runOf(p.id), {
		status: 'accepting',
		acceptSha: landed,
		acceptedById: 'builder-id',
		acceptedBy: 'The builder',
	});
	lapse(p.id);
	gh.calls.length = 0;
	const a = await accept(ADMIN, w.n, p.id, w.head);
	check(
		'accept: a lost answer with a person’s commit pushed on top of the merge is still accepted — by whoever built it, nothing written',
		[
			a.status,
			a.body.already,
			runOf(p.id).status,
			runOf(p.id).acceptedBy,
			runOf(p.id).mergeSha === landed,
			writesOf(),
		],
		[200, true, 'accepted', 'The builder', true, []],
	);
	const w2 = w0();
	const p2 = await proposed(w2, both);
	const landed2 = putCommit(putTree({ ...ACCEPT_BASE, 'src/a.ts': 'const a = 5;\n' }), [
		w2.head,
		w2.main,
	]);
	const sideways = putCommit(putTree({ ...ACCEPT_BASE, 'src/a.ts': 'const a = 7;\n' }), [w2.head]);
	git.refs.set(w2.pull.head.ref, sideways);
	w2.pull.head.sha = sideways;
	Object.assign(runOf(p2.id), { status: 'accepting', acceptSha: landed2 });
	lapse(p2.id);
	await actions.backstopMergeRuns(app, Date.now());
	check(
		'backstop: a tip that does not descend from the recorded commit gives the proposal back, and one that does is accepted',
		[runOf(p2.id).status],
		['proposed'],
	);
	const w3 = w0();
	const p3 = await proposed(w3, both);
	const landed3 = putCommit(putTree({ ...ACCEPT_BASE, 'src/a.ts': 'const a = 5;\n' }), [
		w3.head,
		w3.main,
	]);
	const top3 = putCommit(putTree({ ...ACCEPT_BASE, 'src/a.ts': 'const a = 8;\n' }), [landed3]);
	git.refs.set(w3.pull.head.ref, top3);
	Object.assign(runOf(p3.id), {
		status: 'accepting',
		acceptSha: landed3,
		acceptedById: 'builder-id',
		acceptedBy: 'The builder',
	});
	lapse(p3.id);
	await actions.backstopMergeRuns(app, Date.now());
	check(
		'backstop: a person’s commit on top of the recorded merge is accepted with it, by its builder',
		[runOf(p3.id).status, runOf(p3.id).mergeSha === landed3, runOf(p3.id).acceptedBy],
		['accepted', true, 'The builder'],
	);
}
{
	// a definitive 4xx from the push (not 422, not a lost answer) gives the claim back at once
	const w = w0();
	const p = await proposed(w, both);
	gh.fail.set(`PATCH /git/refs/heads/${w.pull.head.ref}`, [
		{ status: 403, message: 'Resource not accessible' },
	]);
	const a = await accept(ADMIN, w.n, p.id, w.head);
	gh.fail.clear();
	check(
		'accept: a 403 from the push gives the claim back (proposed, nothing recorded)',
		[a.status >= 400, runOf(p.id).status, runOf(p.id).acceptSha, runOf(p.id).acceptClaim],
		[true, 'proposed', null, null],
	);
}
{
	// Discard on a lapsed claim: allowed when no commit was built, refused when one was
	const w = w0();
	const p = await proposed(w, both);
	Object.assign(runOf(p.id), { status: 'accepting' });
	lapse(p.id);
	const d = await discard(ADMIN, w.n, p.id);
	check(
		'discard: a lapsed claim that built nothing is discarded',
		[d.status, runOf(p.id).status],
		[200, 'discarded'],
	);
	const w2 = w0();
	const p2 = await proposed(w2, both);
	Object.assign(runOf(p2.id), { status: 'accepting', acceptSha: 'a'.repeat(40) });
	lapse(p2.id);
	const d2 = await discard(ADMIN, w2.n, p2.id);
	check(
		'discard: a lapsed claim that built a commit is not discarded (the branch may have moved)',
		[d2.status, d2.body.code, runOf(p2.id).status],
		[409, 'accepting', 'accepting'],
	);
}
{
	// each lapsed claim is looked at on its own: one that fails does not stop the others
	const w = w0();
	const p = await proposed(w, both);
	const w2 = w0();
	const p2 = await proposed(w2, both);
	for (const [pp, ww] of [
		[p, w],
		[p2, w2],
	] as const) {
		Object.assign(runOf(pp.id), { status: 'accepting', acceptSha: 'a'.repeat(40) });
		lapse(pp.id);
		git.refs.set(ww.pull.head.ref, ww.head);
	}
	gh.fail.set(`GET /git/ref/heads/${w.pull.head.ref}`, [{ status: 500, message: 'boom' }]);
	await actions.backstopMergeRuns(app, Date.now());
	gh.fail.clear();
	check(
		'backstop: a GitHub error on one lapsed claim leaves it for the next pass; the other is still settled',
		[runOf(p.id).status, runOf(p2.id).status],
		['accepting', 'proposed'],
	);
}
// Date never meets a raw sql template in the merge-run modules: postgres-js cannot encode it there
{
	const dir = new URL('../src/lib/server/', import.meta.url);
	const bad: string[] = [];
	for (const file of readdirSync(dir).filter((f) => /^pipelineMergeRuns.*\.ts$/.test(f))) {
		const source = readFileSync(new URL(file, dir), 'utf8');
		for (const [, body] of source.matchAll(/\bsql`([^`]*)`/g)) {
			for (const [, expr] of body.matchAll(/\$\{([^}]*)\}/g)) {
				const ok =
					/^mergeMainRuns\.\w+$/.test(expr) ||
					/^person\.(id|name)$/.test(expr) ||
					/^leaseMs \/ 1000$/.test(expr);
				if (!ok) bad.push(`${file}: \${${expr}}`);
			}
		}
	}
	check(
		'sql: only columns, the person’s id and name and the lease in seconds go into a raw sql template in pipelineMergeRuns*.ts — never a Date (it throws on postgres-js)',
		bad,
		[],
	);
}

// GitHub refusing over a workflow file
const wf = async (where: 'PATCH /git/refs/heads/', label: string) => {
	const w = world(ACCEPT_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
	const p = await proposed(w, both);
	const key = where === 'PATCH /git/refs/heads/' ? `PATCH /git/refs/heads/${w.pull.head.ref}` : '';
	gh.fail.set(key, [
		{
			status: 422,
			message:
				'refusing to allow a GitHub App to create or update workflow `.github/workflows/ci.yml` without `workflows` permission',
		},
	]);
	const a = await accept(ADMIN, w.n, p.id, w.head);
	check(
		`accept: ${label} → needs_person with GitHub’s reason and the way out, the branch untouched`,
		[
			a.status,
			a.body.code,
			runOf(p.id).status,
			/GitHub refused the push over a workflow file/.test(runOf(p.id).reason ?? ''),
			/Update branch/.test(runOf(p.id).reason ?? ''),
			/copy the merge brief/.test(runOf(p.id).reason ?? ''),
			git.refs.get(w.pull.head.ref) === w.head,
		],
		[409, 'needs_person', 'needs_person', true, true, true, true],
	);
	return runOf(p.id);
};
await wf('PATCH /git/refs/heads/', 'GitHub refusing the ref update over a workflow file');
{
	const w = world(ACCEPT_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
	const p = await proposed(w, both);
	gh.fail.set('POST /git/trees', [
		{ status: 403, message: 'Resource not accessible: workflows permission' },
	]);
	const a = await accept(ADMIN, w.n, p.id, w.head);
	check('accept: or refusing the tree', [a.status, runOf(p.id).status], [409, 'needs_person']);
}
{
	const w = world(ACCEPT_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
	const p = await proposed(w, both);
	gh.fail.set(`PATCH /git/refs/heads/${w.pull.head.ref}`, [
		{ status: 422, message: 'Update is not a fast forward' },
	]);
	const a = await accept(ADMIN, w.n, p.id, w.head);
	check(
		'accept: a ref update that is not a fast-forward → stale (the branch moved under it)',
		[a.status, runOf(p.id).status],
		[409, 'stale'],
	);
}
{
	const w = world(ACCEPT_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
	const p = await proposed(w, both);
	gh.fail.set('POST /git/commits', [{ status: 500, message: 'boom' }]);
	const a = await accept(ADMIN, w.n, p.id, w.head);
	check(
		'accept: any other GitHub failure → 502, the proposal still waiting',
		[a.status, runOf(p.id).status],
		[502, 'proposed'],
	);
}
{
	const w = world(ACCEPT_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
	const p = await proposed(w, both);
	gh.truncatedTrees.add(git.commits.get(w.main)!.tree);
	const a = await accept(ADMIN, w.n, p.id, w.head);
	check(
		'accept: a tree too large for GitHub to list whole → needs_person',
		[a.status, runOf(p.id).status],
		[409, 'needs_person'],
	);
}

// the message carries no CI-skip directive
{
	const base = { ...ACCEPT_BASE, '[skip ci].md': 'x\n' };
	const w = world(
		base,
		{ 'src/a.ts': 'const a = 3;\n', '[skip ci].md': 'head\n' },
		{ 'src/a.ts': 'const a = 2;\n', '[skip ci].md': 'main\n' },
	);
	const ghRunId = ++nextGh;
	gh.dispatch = () => answer(200, { workflow_run_id: ghRunId });
	const a = await resolve(SKIPPER, w.n);
	const id = runIdOf(a);
	gh.actionsRuns.set(ghRunId, {
		id: ghRunId,
		display_title: `Merge main ${id}`,
		path: '.github/workflows/merge-main.yml',
		status: 'in_progress',
		conclusion: null,
		actor: { login: BOT },
		created_at: new Date(clock).toISOString(),
	});
	await post(
		id,
		ghRunId,
		body(w, id, {
			files: [
				...both,
				...files({ path: '[skip ci].md', rule: null, choice: 'combined', content: 'head\nmain\n' }),
			],
			explanation: explanation(['src/a.ts', '[skip ci].md']),
		}),
	);
	await accept(SKIPPER, w.n, id, w.head);
	const m = String(gh.madeCommits.at(-1)!.message);
	check(
		'accept: no CI-skip token survives in the commit message (a path and a name spelled them)',
		[
			/\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]/i.test(m),
			m.includes('Accepted by Ann'),
		],
		[false, true],
	);
}

// a fix-run branch: ADR-0014's gate is untouched
{
	const FIXID = 'a1b2c3d4e5';
	const w = world(
		ACCEPT_BASE,
		{ 'src/a.ts': 'const a = 3;\n' },
		{ 'src/a.ts': 'const a = 2;\n' },
		{ branch: `bug-12-fix-${FIXID}` },
	);
	fixRecords.runs.push({ id: FIXID, bugNumber: 12, prNumber: w.n, status: 'pr_opened' });
	fixRecords.decisions.push({ id: 1, data: { run: 'diag', build: FIXID, option: 'A' } });
	const snapshot = JSON.stringify([fixRecords.runs, fixRecords.decisions]);
	const p = await proposed(w, both);
	const a = await accept(ADMIN, w.n, p.id, w.head);
	const shared2 = await import(src('lib/bugFixRuns.ts'));
	check(
		'fix-run branch: Accept works, the branch keeps its name (fixRunOfChange still matches it), and no fix-run record or decision was written',
		[
			a.status,
			shared2.parseFixRunBranch(w.pull.head.ref)?.id,
			JSON.stringify([fixRecords.runs, fixRecords.decisions]) === snapshot,
		],
		[200, FIXID, true],
	);
	const mod = text('../src/lib/server/pipelineMergeRuns.ts');
	check(
		'fix-run branch: the module reads no fix-run store but the spend, writes none, and never reads a decision',
		[
			/settleFixRun|insertFixRun|bindFixRun|recordFixRunSpend|fixDecisionsOfBug|allFixRunsOfBug|requireDecision/.test(
				mod,
			),
			/from '\.\/bugFixRunsStore'/.test(mod),
		],
		[false, true],
	);
}

// ═════════════════════════════════════════════════════════════════════════════
// Discard
// ═════════════════════════════════════════════════════════════════════════════
{
	const w = world(ACCEPT_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
	const p = await proposed(w, both);
	gh.calls.length = 0;
	check('discard: without the capability → 403', (await discard(TESTER, w.n, p.id)).status, 403);
	const d = await discard(ADMIN, w.n, p.id);
	check(
		'discard: a proposal ends discarded, the branch and GitHub untouched',
		[
			d.status,
			(d.body.run as Json).status,
			runOf(p.id).reason,
			writesOf(),
			git.refs.get(w.pull.head.ref) === w.head,
		],
		[200, 'discarded', 'Discarded by Gualtiero.', [], true],
	);
	check(
		'discard: a run that already ended → 409',
		[(await discard(ADMIN, w.n, p.id)).status, (await discard(ADMIN, w.n, 'bbbbbbbbbb')).status],
		[409, 404],
	);
	check('discard: then Resolve can start a new run', (await resolve(ADMIN, w.n)).status, 201);
}

// ═════════════════════════════════════════════════════════════════════════════
// What the page reads
// ═════════════════════════════════════════════════════════════════════════════
{
	const w = world(ACCEPT_BASE, { 'src/a.ts': 'const a = 3;\n' }, { 'src/a.ts': 'const a = 2;\n' });
	const p = await proposed(w, both);
	git.refs.set(
		'main',
		putCommit(putTree({ ...ACCEPT_BASE, 'src/a.ts': 'const a = 2;\n', 'src/b.ts': 'z\n' }), [
			w.main,
		]),
	);
	git.commits.get(w.head)!.date = new Date(clock - 20 * MIN).toISOString();
	const answer1 = await call(listRoute.GET, { user: ADMIN, params: { number: String(w.n) } });
	check(
		'GET merge-runs: the proposal, how far main has moved since, when the branch was last pushed, no whole-file content',
		[
			answer1.status,
			(answer1.body.run as Json).id,
			answer1.body.behindNow,
			answer1.body.headCommittedAt,
			JSON.stringify(answer1.body).includes('const a = 5'),
		],
		[200, p.id, 1, new Date(clock - 20 * MIN).toISOString(), false],
	);
	check(
		'GET merge-runs: a tester who may see Changes but not merge reads it (200); a role without the tool does not (403)',
		[
			(await call(listRoute.GET, { user: TESTER, params: { number: String(w.n) } })).status,
			(await call(listRoute.GET, { user: DEV, params: { number: String(w.n) } })).status,
		],
		[200, 403],
	);
}

// ═════════════════════════════════════════════════════════════════════════════
// The page's decisions
// ═════════════════════════════════════════════════════════════════════════════
check(
	'page: the conflict sentence is "Merge conflict with main."',
	view.BLOCKED_CONFLICT_TEXT,
	'Merge conflict with main.',
);
const d0 = { state: 'open', merged: false, mergeableState: 'dirty', onHold: false };
const run0 = (status: MergeRunStatus) => ({ status }) as never;
check(
	'page: Resolve conflict is offered only to a merge holder, once the workflow is live, on an open conflicted change that is not held and has no live run',
	[
		view.resolveOffered(d0, { ready: true, run: null }, true),
		view.resolveOffered(d0, { ready: false, run: null }, true),
		view.resolveOffered(d0, null, true),
		view.resolveOffered(d0, { ready: true, run: null }, false),
		view.resolveOffered({ ...d0, mergeableState: 'clean' }, { ready: true, run: null }, true),
		view.resolveOffered({ ...d0, onHold: true }, { ready: true, run: null }, true),
		view.resolveOffered({ ...d0, state: 'closed' }, { ready: true, run: null }, true),
		view.resolveOffered(d0, { ready: true, run: run0('proposed') }, true),
		view.resolveOffered(d0, { ready: true, run: run0('running') }, true),
		view.resolveOffered(d0, { ready: true, run: run0('discarded') }, true),
		view.resolveOffered(d0, { ready: true, run: run0('stale') }, true),
	],
	[true, false, false, false, false, false, false, false, false, true, true],
);
const rv = (status: MergeRunStatus, reason: string | null = null) =>
	({
		status,
		reason,
		createdAt: new Date(clock - 5 * MIN).toISOString(),
		startedBy: 'Gualtiero',
	}) as never;
check(
	'page: the run’s line while it works, and when it ended without a proposal',
	[
		view.mergeRunLine(rv('dispatched'), clock)?.text,
		view.mergeRunLine(rv('running'), clock)?.tone,
		view.mergeRunLine(rv('needs_person', 'Look at src/a.ts.'), clock),
		view.mergeRunLine(rv('stale'), clock)?.text,
		view.mergeRunLine(rv('failed', 'The run timed out.'), clock)?.tone,
		view.mergeRunLine(rv('proposed'), clock),
		view.mergeRunLine(rv('accepted'), clock),
		view.mergeRunLine(null, clock),
	],
	[
		'Resolving the conflict: waiting for the job (started 5 min ago by Gualtiero).',
		'blue',
		{ tone: 'amber', brief: true, text: 'Look at src/a.ts.' },
		'The branch moved; resolve again.',
		'red',
		null,
		null,
		null,
	],
);
// the result column: the job's own lines from the final file, the hunk's words only without them
const hunk = (takes: string, result: string | null, kind = 'lines') => ({
	main: '\t\tconst a = 3;',
	change: '\t\tconst a = 2;',
	result,
	kind,
	takes,
	nowDoes: 'It is five.',
});
check(
	'page: a hunk is three columns — main, this change, and the result the job found in the final file (indentation kept); a hunk without one follows what it took',
	[
		view.hunkColumns(hunk('combined', '\t\tconst a = 2;\n\t\tconst a = 5;')),
		view.hunkColumns(hunk('main', null, 'description')).result,
		view.hunkColumns(hunk('change', null, 'description')).result,
		view.hunkColumns(hunk('both', null, 'description')).result,
		view.hunkColumns(hunk('combined', null, 'description')).result,
		view.hunkColumns(hunk('main', null)).result,
		view.hunkColumns(hunk('combined', null)).result,
	],
	[
		{
			main: '\t\tconst a = 3;',
			change: '\t\tconst a = 2;',
			result: '\t\tconst a = 2;\n\t\tconst a = 5;',
		},
		'\t\tconst a = 3;',
		'\t\tconst a = 2;',
		'\t\tconst a = 2;\n\t\tconst a = 3;',
		'It is five.',
		view.RESULT_NOT_LOCATED,
		view.RESULT_NOT_LOCATED,
	],
);
{
	const accepting = (ago: number | null) =>
		({
			status: 'accepting',
			acceptedBy: 'Gualtiero',
			createdAt: new Date(clock - 20 * MIN).toISOString(),
			updatedAt: new Date(clock - 5 * MIN).toISOString(),
			startedBy: 'x',
			acceptingAt: ago === null ? null : new Date(clock - ago).toISOString(),
			mainSha: 'm'.repeat(40),
			headSha: 'h'.repeat(40),
			spendUsd: null,
		}) as never;
	const detailNow = { headSha: 'h'.repeat(40), state: 'open', onHold: false } as never;
	const facts3 = { behindNow: 0, headCommittedAt: null };
	check(
		'page: while an Accept holds the claim the card says who is accepting and offers nothing; once the lease has lapsed Accept is offered again',
		[
			view.mergeRunLine(accepting(30_000), clock)?.text,
			view.proposalBar(accepting(30_000), detailNow, facts3, true, clock),
			view.mergeRunLine(accepting(4 * MIN), clock),
			view.proposalBar(accepting(4 * MIN), detailNow, facts3, true, clock)?.canAct,
			view.acceptLapsed(accepting(4 * MIN), clock),
			view.acceptLapsed(accepting(30_000), clock),
		],
		['Accepting… by Gualtiero (just now).', null, null, true, true, false],
	);
}
check(
	'page: no whole-file content is sent, and a view of a run that is not waiting carries no hunk lines',
	[
		shared.mergeRunView(
			{
				id: 'aaaaaaaaaa',
				prNumber: 1,
				branch: 'b',
				headSha: 'h'.repeat(40),
				mainSha: 'm'.repeat(40),
				status: 'accepted',
				reason: null,
				files: files({ path: 'src/a.ts', rule: null, choice: 'combined', content: 'x\n' }),
				explanation: {
					...explanation(),
					hunks: [{ ...explanation().hunks[0], main: 'M', change: 'C', result: 'R' }],
				},
				mergeSha: null,
				spendUsd: null,
				ghRunId: null,
				startedBy: 'x',
				acceptedBy: null,
				createdAt: new Date(0),
				updatedAt: new Date(0),
				finishedAt: null,
			},
			REPO,
		),
	].map((v) => [
		'content' in v.files[0],
		v.explanation?.hunks.map((h: { main: string; change: string; result: string | null }) => [
			h.main,
			h.change,
			h.result,
		]),
	]),
	[[false, [['', '', null]]]],
);
check(
	'page: Accept posts the head THIS PAGE showed, not the run’s (a branch moved since is then refused)',
	[
		view.acceptBody({ headSha: 'c'.repeat(40) }),
		text('../src/routes/(app)/pipeline/MergeRunCards.svelte').includes(
			'const shown = acceptBody(detail);',
		) &&
			text('../src/routes/(app)/pipeline/MergeRunCards.svelte').indexOf('acceptBody(detail)') <
				text('../src/routes/(app)/pipeline/MergeRunCards.svelte').indexOf('await askConfirm'),
		text('../src/routes/(app)/pipeline/MergeRunCards.svelte').includes('headSha: run.headSha'),
	],
	[{ headSha: 'c'.repeat(40) }, true, false],
);
const bar = (
	over: Record<string, unknown> = {},
	facts2 = { behindNow: 3, headCommittedAt: null as string | null },
	can = true,
) =>
	view.proposalBar(
		{
			status: 'proposed',
			mainSha: 'abcdef1234567890'.padEnd(40, '0'),
			headSha: 'h'.repeat(40),
			spendUsd: 1.5,
			...over,
		} as never,
		{ headSha: 'h'.repeat(40), state: 'open', onHold: false } as never,
		facts2,
		can,
		clock,
	);
check(
	'page: the proposal says which main it was resolved against and how far behind now, and the cost',
	[
		bar()?.headline,
		bar()?.cost,
		bar({ spendUsd: null })?.cost,
		bar(undefined, { behindNow: 0, headCommittedAt: null })?.headline,
		bar({ status: 'accepted' }),
	],
	[
		'Resolved against main at abcdef1, 3 commits behind now.',
		'Cost $1.50',
		null,
		'Resolved against main at abcdef1, main has not moved since.',
		null,
	],
);
check(
	'page: a branch pushed in the last hour warns; an older push, or none known, does not',
	[
		bar(undefined, { behindNow: 1, headCommittedAt: new Date(clock - 59 * MIN).toISOString() })
			?.pushedRecently,
		bar(undefined, { behindNow: 1, headCommittedAt: new Date(clock - 61 * MIN).toISOString() })
			?.pushedRecently,
		bar()?.pushedRecently,
	],
	[true, false, false],
);
check(
	'page: Accept is not offered when the head moved, the change is held or closed; Accept and Discard are the merge holder’s',
	[
		bar({ headSha: 'x'.repeat(40) })?.blocked,
		bar()?.blocked,
		bar(undefined, undefined, false)?.canAct,
	],
	['The branch moved; resolve again.', null, false],
);
const sections = view.proposalSections({
	conflicted: [
		{
			path: 'a',
			met: [
				{ pr: 7, title: 'T' },
				{ pr: null, title: 'A commit' },
			],
		},
	],
	hunks: [
		{
			path: 'a',
			index: 0,
			main: '',
			change: '',
			result: null,
			takes: 'main',
			why: 'Because.',
			nowDoes: null,
			otherwise: null,
		},
	],
	outside: [],
	checks: [{ command: 'x', ok: false }],
	risks: 'r',
});
const withFollowUps = view.proposalSections(
	{ conflicted: [], hunks: [], outside: [], checks: [], risks: '' },
	[
		{ path: 'scripts/runtime-bytes/lines.json', rule: 'runtime-bytes' },
		{ path: 'apps/launcher-api/static/rigger/vendor/rigger-fx.js', rule: 'vendored-bundle' },
		{ path: 'svelte-check-baseline.json', rule: 'ratchet' },
		{ path: 'docs/a.md', rule: 'docs-append' },
	],
);
check(
	'page: the proposal says what follows Accept for each pending build rule, in plain words',
	withFollowUps.map((x: { key: string; lines: string[] }) => [x.key, x.lines]),
	[
		[
			'after-accept',
			[
				"scripts/runtime-bytes/lines.json: After Accept, CI's runtime-bytes check fails; click Re-record runtime bytes on the change.",
				"apps/launcher-api/static/rigger/vendor/rigger-fx.js: After Accept, rebuild with pnpm --filter launcher-api build:rigger-fx in the change's session.",
				"svelte-check-baseline.json: After Accept, lower the baseline in the change's session if check:svelte or lint fails.",
			],
		],
	],
);
check(
	'page: the §4 sections, plain text, empty ones left out',
	sections.map((s: { key: string; lines: string[] }) => [s.key, s.lines]),
	[
		['conflicted', ['a: met #7 T; A commit']],
		['takes', ["a (hunk 1): main's. Because."]],
		['checks', ['failed: x']],
		['risks', ['r']],
	],
);
const merged = view.mergedInCard(
	{
		status: 'accepted',
		acceptedBy: 'Gualtiero',
		finishedAt: new Date(clock).toISOString(),
		mainSha: 'a'.repeat(40),
		files: [
			{ path: 'a.ts', choice: 'combined', deleted: false },
			{ path: 'b.md', choice: 'both', deleted: true },
			{ path: 'scripts/runtime-bytes/lines.json', choice: 'main', rule: 'runtime-bytes' },
		],
	} as never,
	clock,
);
check(
	'page: the "Main merged in" card lists each choice; a combination is flagged',
	[merged?.title, merged?.rows],
	[
		'Main merged in · Gualtiero · just now · main at aaaaaaa',
		[
			{ path: 'a.ts', text: 'combined both; now differs from both sides' },
			{ path: 'b.md', text: 'kept both; deleted' },
			{
				path: 'scripts/runtime-bytes/lines.json',
				text: "took main's. After Accept, CI's runtime-bytes check fails; click Re-record runtime bytes on the change.",
			},
		],
	],
);
check(
	'page: no card for a run that is not accepted',
	view.mergedInCard({ status: 'proposed' } as never),
	null,
);
const briefText = view.mergeBrief(
	{ number: 1, branch: 'claude/x', url: 'https://github.com/o/r/pull/1', headSha: 'h'.repeat(40) },
	{
		reason: 'Needs a person.',
		mainSha: 'm'.repeat(40),
		files: [{ path: 'a.ts', choice: 'main' }],
		explanation: { hunks: [{ path: 'a.ts', index: 0, takes: 'main', why: 'Because.' }] },
	} as never,
);
check(
	'page: Copy merge brief names the branch, the SHAs, the reason, the files and the accepted choices',
	[
		briefText.includes('claude/x'),
		briefText.includes('m'.repeat(40)),
		briefText.includes('Needs a person.'),
		briefText.includes("a.ts: took main's"),
		briefText.includes("a.ts (hunk 1): main's. Because."),
	],
	[true, true, true, true, true],
);
const card = text('../src/routes/(app)/pipeline/MergeRunCards.svelte');
const panel = text('../src/routes/(app)/pipeline/ChangeDetailPanel.svelte');
check(
	'page: a run’s words are text — no {@html} anywhere in the cards or the panel',
	[/\{@html/.test(card), /\{@html/.test(panel)],
	[false, false],
);
check(
	'page: the Resolve button sits behind the workflow check, beside the conflict sentence',
	[
		/\{#if canResolve\}[\s\S]{0,200}Resolve conflict/.test(panel),
		/resolveOffered\(detail, mergeRuns, canMerge\)/.test(panel),
	],
	[true, true],
);
check(
	'page: the cards use the tool’s SectionCard, IconButton and an info tooltip — no intro paragraph',
	[/SectionCard/.test(card), /IconButton/.test(card), /snippet info\(\)/.test(card)],
	[true, true, true],
);

// ═════════════════════════════════════════════════════════════════════════════
// The data, the setting, the protected paths
// ═════════════════════════════════════════════════════════════════════════════
const migrations = readdirSync(fileURLToPath(new URL('../drizzle/', import.meta.url))).filter((f) =>
	f.endsWith('_merge_main_runs.sql'),
);
const sql = migrations.length === 1 ? text(`../drizzle/${migrations[0]}`) : '';
check(
	'migration: exactly one, creating merge_main_runs with the ten statuses, the request and Actions-run uniques and the partial live index on (pr_number)',
	[
		migrations.length,
		/CREATE TABLE "merge_main_runs"/.test(sql),
		/'dispatched', 'running', 'proposed', 'accepted', 'discarded', 'stale', 'needs_person', 'no_proposal', 'failed', 'cancelled'/.test(
			sql,
		),
		/UNIQUE INDEX "merge_main_runs_request_id_idx"/.test(sql),
		/UNIQUE INDEX "merge_main_runs_gh_run_id_idx"/.test(sql),
		/UNIQUE INDEX "merge_main_runs_live_idx" ON "merge_main_runs" USING btree \("pr_number"\) WHERE .*'dispatched', 'running', 'proposed'/.test(
			sql,
		),
	],
	[1, true, true, true, true, true],
);
check(
	'migration: every column of §8',
	[
		'id',
		'pr_number',
		'branch',
		'head_sha',
		'main_sha',
		'status',
		'reason',
		'files',
		'explanation',
		'merge_sha',
		'spend_usd',
		'gh_run_id',
		'started_by_id',
		'started_by',
		'accepted_by_id',
		'accepted_by',
		'request_id',
		'created_at',
		'updated_at',
	].filter((c) => !sql.includes(`"${c}"`)),
	[],
);
const settingsSrc = text('../src/lib/server/appSettings.ts');
const adminServer = text('../src/routes/(app)/admin/+page.server.ts');
check(
	'setting: PIPELINE_MERGE_MAIN_BUDGET_USD, $6 by default, read beside the fix budgets and listed in Admin › Settings',
	[
		/PIPELINE_MERGE_MAIN_BUDGET_KEY = 'PIPELINE_MERGE_MAIN_BUDGET_USD'/.test(settingsSrc),
		/PIPELINE_MERGE_MAIN_BUDGET_DEFAULT_USD = 6/.test(settingsSrc),
		/getPipelineMergeMainBudget\(\)/.test(adminServer),
		/setPipelineMergeMainBudget/.test(text('../src/routes/(app)/admin/+page.svelte')),
	],
	[true, true, true, true],
);
check(
	'protected: a fix run may not change the resolver, the new server modules, the vocabulary or this fixture',
	[
		change.protectedEntry('scripts/merge-main/coordinator.md'),
		change.protectedEntry('apps/launcher-api/src/lib/server/pipelineMergeRunsBuild.ts'),
		change.protectedEntry('apps/launcher-api/src/lib/mergeMainRuns.ts'),
		change.protectedEntry('apps/launcher-api/scripts/check-merge-main-runs.ts'),
		change.protectedEntry(
			'apps/launcher-api/src/routes/api/pipeline/merge-runs/[id]/result/+server.ts',
		),
		change.protectedEntry('.github/workflows/merge-main.yml'),
	],
	[
		'scripts/merge-main',
		"Invisible Pipeline Changes' server modules",
		'apps/launcher-api/src/lib/mergemainruns.ts',
		'apps/launcher-api/scripts/check-merge-main-runs.ts',
		'apps/launcher-api/src/routes/api/pipeline',
		'.github',
	],
);
check(
	'spend: the ledger’s agent for a merge run is "merge-main" and its run id "merge:<id>"',
	[ledger.every((s) => s.agent !== 'merge-main' || s.runId.startsWith('merge:'))],
	[true],
);

if (failures) {
	console.error(`\n${failures} of ${checks} merge-main-runs checks failed.`);
	process.exit(1);
}
console.log(`All ${checks} merge-main-runs checks pass.`);
